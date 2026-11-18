import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BareJS,
  Type,
  logger,
  healthcheck,
  staticFile,
  csrf,
  native,
  bareAuth,
  createToken,
  revokeToken,
  isTokenRevoked,
  rateLimit
} from "../src/index";

describe("Security Audit, Vulnerability Hunt & 100% Coverage Suite", () => {
  test("1. staticFile() blocks symlink escape outside root directory (403 Forbidden)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barejs-sym-"));
    try {
      const linkPath = join(dir, "leak.json");
      symlinkSync(join(process.cwd(), "package.json"), linkPath);

      const app = new BareJS().use(staticFile(dir));
      app.compile();

      const res = await app.fetch(new Request("http://localhost/leak.json"));
      expect(res.status).toBe(403);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("2. JSON prototype pollution payloads never pollute Object.prototype", async () => {
    const app = new BareJS()
      .post("/raw", async (ctx) => {
        const b = await ctx.jsonBody();
        return { receivedKeys: Object.keys(b || {}) };
      })
      .post(
        "/native",
        native({ name: "string" }),
        (ctx) => ctx.body
      );
    app.compile();

    const evilPayload = '{"name":"bob","__proto__":{"polluted":true},"constructor":{"prototype":{"pwned":true}}}';

    await app.fetch(
      new Request("http://localhost/raw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: evilPayload
      })
    );
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).pwned).toBeUndefined();

    const natRes = await app.fetch(
      new Request("http://localhost/native", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: evilPayload
      })
    );
    expect([200, 400]).toContain(natRes.status);
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).pwned).toBeUndefined();
  });

  test("3. CRLF / Header Injection attempts in redirect and setHeader cannot split HTTP headers", async () => {
    const app = new BareJS()
      .get("/redir", (ctx) => ctx.redirect("/safe\r\nX-Injected: evil"))
      .get("/hdr", (ctx) => {
        ctx.setHeader("x-user", "alice\r\nSet-Cookie: admin=1");
        return "ok";
      });
    app.compile();

    // Bun's Response/Headers either rejects CRLF with TypeError (caught -> 500) or strips it; never leaks X-Injected
    const r1 = await app.fetch(new Request("http://localhost/redir"));
    expect(r1.headers.get("x-injected")).toBeNull();

    const r2 = await app.fetch(new Request("http://localhost/hdr"));
    expect(r2.headers.get("set-cookie")).toBeNull();
  });

  test("4. Production mode (NODE_ENV=production) never leaks error messages or stack traces", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = new BareJS().get("/boom", () => {
        throw new Error("DB_PASSWORD=supersecret connection failed");
      });
      app.compile();

      const res = await app.fetch(new Request("http://localhost/boom"));
      expect(res.status).toBe(500);
      const body = (await res.json()) as any;
      expect(body.message).toBe("Internal Server Error");
      expect(body.stack).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("DB_PASSWORD");
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  test("5. Pathological ReDoS / oversized query string completes fast without backtracking", async () => {
    const app = new BareJS().get("/q", (ctx) => ({ count: Object.keys(ctx.query).length }));
    app.compile();

    const longQuery = Array.from({ length: 500 }, (_, i) => `k${i}=${"a".repeat(20)}`).join("&");
    const t0 = performance.now();
    const res = await app.fetch(new Request(`http://localhost/q?${longQuery}`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).count).toBe(500);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  test("6. Randomized Adversarial Fuzzer (500 malformed requests) never crashes server", async () => {
    const app = new BareJS()
      .use(csrf({ ignoreMethods: ["GET", "HEAD", "OPTIONS"] }))
      .get("/items/:id", (ctx) => ({ id: ctx.params.id, q: ctx.query }))
      .post("/items", { body: Type.Object({ x: Type.Number() }) }, (ctx) => ctx.body);
    app.compile();

    const badPaths = [
      "/items/%ZZ",
      "/items/%E0%A4%A",
      "/items/..%2f..%2fetc%00",
      "/items/1?a=%ZZ&b=&&&c=",
      "//items///123//",
      "/items/🔥?msg=ສະບາຍດີ"
    ];

    for (let i = 0; i < 500; i++) {
      const path = badPaths[i % badPaths.length]!;
      const method = i % 3 === 0 ? "POST" : "GET";
      const res = await app.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: method === "POST" ? { "content-type": "application/json", origin: "http://localhost" } : {},
          body: method === "POST" ? (i % 2 === 0 ? "{broken json" : '{"x":"not-a-number"}') : undefined
        })
      );
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(500);
    }
  });

  test("7. Memory-leak soak test: 20,000 pooled requests keep heap growth bounded", async () => {
    const app = new BareJS(512).get("/soak/:id", (ctx) => ({ id: ctx.params.id, q: ctx.query.x }));
    app.compile();

    // Warm up JIT & pool
    for (let i = 0; i < 1000; i++) {
      await app.fetch(new Request(`http://localhost/soak/${i}?x=1`));
    }
    Bun.gc(true);
    const beforeHeap = process.memoryUsage().heapUsed;

    for (let i = 0; i < 20_000; i++) {
      const res = await app.fetch(new Request(`http://localhost/soak/${i}?x=${i}`));
      if (res.status !== 200) throw new Error("Unexpected status");
    }
    Bun.gc(true);
    const afterHeap = process.memoryUsage().heapUsed;

    // Heap delta after GC over 20k requests should remain small (< 15MB)
    expect(afterHeap - beforeHeap).toBeLessThan(15 * 1024 * 1024);
  });

  test("8. logger() default console sinks (pretty & json) + healthcheck() throwing check (100% branch coverage)", async () => {
    const origLog = console.log;
    const captured: string[] = [];
    console.log = (...args: any[]) => {
      captured.push(args.join(" "));
    };

    try {
      const app = new BareJS()
        .use(logger({ format: "json" }))
        .use(logger({ format: "pretty" }))
        .use(
          healthcheck({
            checks: {
              exploding: () => {
                throw new Error("socket closed");
              }
            }
          })
        )
        .get("/ping", () => "pong");
      app.compile();

      const res = await app.fetch(new Request("http://localhost/ping"));
      expect(res.status).toBe(200);
      expect(captured.some((l) => l.includes('"method":"GET"'))).toBe(true);
      expect(captured.some((l) => l.includes("GET /ping"))).toBe(true);

      const hRes = await app.fetch(new Request("http://localhost/health"));
      expect(hRes.status).toBe(503);
      const hJson = (await hRes.json()) as any;
      expect(hJson.checks.exploding).toBe("fail");
    } finally {
      console.log = origLog;
    }
  });

  test("9. Graceful SIGINT shutdown handler executes cleanly in both dev and production modes", async () => {
    const origExit = process.exit;
    const origEnv = process.env.NODE_ENV;
    const origWrite = process.stdout.write;
    const origLog = console.log;
    let exitCalls = 0;

    (process as any).exit = () => {
      exitCalls++;
    };
    (process.stdout as any).write = () => true;
    console.log = () => {};

    try {
      // Dev mode SIGINT
      process.env.NODE_ENV = "development";
      const appDev = new BareJS().get("/ok", () => "ok");
      appDev.listen(0);
      const devListeners = process.listeners("SIGINT");
      await (devListeners[devListeners.length - 1] as any)();
      expect(exitCalls).toBe(1);

      // Production mode SIGINT
      process.env.NODE_ENV = "production";
      const appProd = new BareJS().get("/ok", () => "ok");
      appProd.listen(0);
      const prodListeners = process.listeners("SIGINT");
      await (prodListeners[prodListeners.length - 1] as any)();
      expect(exitCalls).toBe(2);
    } finally {
      (process as any).exit = origExit;
      process.env.NODE_ENV = origEnv;
      (process.stdout as any).write = origWrite;
      console.log = origLog;
    }
  });

  test("10. WebSocket wildcard (/ws/files/*) and non-matching upgrade path fallback", async () => {
    const app = new BareJS();
    let captured = "";
    app.ws("/ws/files/*", {
      open(ws) {
        captured = ws.data?.params?.["*"] || "";
        ws.send(captured);
      }
    });

    const server = app.listen(0);
    try {
      // Non-matching WS path should fall back to normal HTTP 404
      const miss = await fetch(`http://localhost:${server.port}/ws/other/a/b`, {
        headers: { upgrade: "websocket" }
      });
      expect(miss.status).toBe(404);

      const ws = new WebSocket(`ws://localhost:${server.port}/ws/files/docs/readme.md`);
      const msg = await new Promise<string>((resolve, reject) => {
        ws.onmessage = (ev) => {
          ws.close();
          resolve(String(ev.data));
        };
        ws.onerror = reject;
      });
      expect(captured).toBe("docs/readme.md");
      expect(msg).toBe("docs/readme.md");
    } finally {
      await app.stop(true);
    }
  });

  test("11. trustProxy(false) prevents X-Forwarded-For / X-Real-IP spoofing bypass of rateLimit", async () => {
    const app = new BareJS()
      .trustProxy(false)
      .use(rateLimit({ max: 2, windowMs: 10_000 }))
      .get("/limited", (ctx) => ({ ip: ctx.ip }));
    app.compile();

    // Attacker tries different X-Forwarded-For on every request -> still resolves to peer IP and gets 429 on 3rd try!
    const r1 = await app.fetch(new Request("http://localhost/limited", { headers: { "x-forwarded-for": "1.1.1.1" } }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ip: "127.0.0.1" });

    const r2 = await app.fetch(new Request("http://localhost/limited", { headers: { "x-forwarded-for": "2.2.2.2" } }));
    expect(r2.status).toBe(200);

    const r3 = await app.fetch(new Request("http://localhost/limited", { headers: { "x-forwarded-for": "3.3.3.3" } }));
    expect(r3.status).toBe(429);
  });

  test("12. bareAuth() supports revokeToken (token, jti, TTL, eviction) and sync/async isRevoked hooks", async () => {
    const secret = "revocation-secret";
    const asyncRevoked = new Set<string>(["blocked-jti"]);

    const app = new BareJS()
      .use(
        bareAuth({
          secret,
          isRevoked: async (payload) => asyncRevoked.has(payload.jti)
        })
      )
      .get("/me", (ctx) => ctx.user);

    const appSync = new BareJS()
      .use(
        bareAuth({
          secret,
          isRevoked: (payload) => payload.jti === "sync-blocked"
        })
      )
      .get("/me", (ctx) => ctx.user);

    app.compile();
    appSync.compile();

    const tValid = await createToken({ sub: "u1", jti: "jti-1" }, secret);
    const tAsyncBlocked = await createToken({ sub: "u2", jti: "blocked-jti" }, secret);
    const tSyncBlocked = await createToken({ sub: "u3", jti: "sync-blocked" }, secret);

    expect((await app.fetch(new Request("http://localhost/me", { headers: { authorization: `Bearer ${tValid}` } }))).status).toBe(200);
    expect((await app.fetch(new Request("http://localhost/me", { headers: { authorization: `Bearer ${tAsyncBlocked}` } }))).status).toBe(401);
    expect((await appSync.fetch(new Request("http://localhost/me", { headers: { authorization: `Bearer ${tSyncBlocked}` } }))).status).toBe(401);

    // Revoke by jti
    revokeToken("jti-1", 5000);
    expect(isTokenRevoked("jti-1")).toBe(true);
    expect((await app.fetch(new Request("http://localhost/me", { headers: { authorization: `Bearer ${tValid}` } }))).status).toBe(401);

    // TTL expiry cleanup + bounded eviction
    revokeToken("short-lived", 1);
    await Bun.sleep(5);
    expect(isTokenRevoked("short-lived")).toBe(false);

    for (let i = 0; i < 10_005; i++) {
      revokeToken(`bulk-${i}`, i < 5 ? 0 : 60_000);
    }
    expect(isTokenRevoked("bulk-10004")).toBe(true);
  });

  test("13. listen() enforces maxRequestBodySize and trustProxy option at server level", async () => {
    const app = new BareJS().post("/body", async (ctx) => ({ len: (await ctx.req.text()).length }));
    const server = app.listen(0, "127.0.0.1", false, { maxRequestBodySize: 64, trustProxy: false });
    try {
      const ok = await fetch(`http://127.0.0.1:${server.port}/body`, { method: "POST", body: "small" });
      expect(ok.status).toBe(200);

      const big = await fetch(`http://127.0.0.1:${server.port}/body`, { method: "POST", body: "x".repeat(256) });
      expect(big.status).toBe(413);
    } finally {
      await app.stop(true);
    }
  });
});
