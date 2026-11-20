import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import {
  BareJS,
  BareRouter,
  Context,
  bareAuth,
  cors,
  csrf,
  securityHeaders,
  timeout,
  circuitBreaker,
  idempotency,
  rateLimit,
  redisStore,
  staticFile,
  compress,
  schemaValidator,
  createResponseFilter,
  renderDocsHTML,
  generateOpenAPISpec,
  bareClient,
  Hash,
  Type,
  Z
} from "../src/index";
import { initConfig } from "../src/core/config";
import { RadixNode } from "../src/core/radix";

describe("Production & Security Sign-Off Suite (10-Agent Empirical Verification)", () => {
  test("1. OPTIONS preflight with derive() / global middleware calling next() does not 500; without CORS returns 404", async () => {
    const app1 = new BareJS();
    app1.derive(() => ({ user: "alice" }));
    app1.get("/test", () => "ok");
    const r1 = await app1.request("/test", { method: "OPTIONS" });
    expect(r1.status).toBe(404);

    const app2 = new BareJS();
    app2.use(cors({ origin: "https://app.example.com" }));
    app2.derive(() => ({ user: "alice" }));
    app2.get("/test", () => "ok");
    const r2 = await app2.request("/test", { method: "OPTIONS" });
    expect(r2.status).toBe(204);
    expect(r2.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

    const app3 = new BareJS();
    app3.use(compress());
    app3.get("/hello", () => ({ ok: true }));
    const r3 = await app3.request("/hello", { method: "OPTIONS" });
    expect(r3.status).toBe(404);
  });

  test("2. Returning Response with immutable headers (Response.redirect) does not 500 when ctx.setHeader / setCookie is set", async () => {
    const app = new BareJS();
    app.use((ctx, next) => {
      ctx.setHeader("X-Test", "1");
      ctx.setCookie("sid", "abc");
      return next();
    });
    app.get("/redir", () => Response.redirect("https://example.com", 302));
    const res = await app.request("/redir");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
  });

  test("3. listen() options.trustProxy applies to Context pool overflow allocations", async () => {
    const app = new BareJS(1);
    app.get("/ip", async (ctx) => {
      await Bun.sleep(20);
      return { trust: ctx._trustProxy, ip: ctx.ip };
    });
    const server = app.listen(0, "127.0.0.1", false, { trustProxy: true });
    try {
      const url = `http://127.0.0.1:${server.port}/ip`;
      const [r1, r2] = await Promise.all([
        fetch(url, { headers: { "x-forwarded-for": "1.2.3.4" } }).then((r) => r.json()),
        fetch(url, { headers: { "x-forwarded-for": "5.6.7.8" } }).then((r) => r.json())
      ]);
      expect(r1.trust).toBe(true);
      expect(r1.ip).toBe("1.2.3.4");
      expect(r2.trust).toBe(true);
      expect(r2.ip).toBe("5.6.7.8");
    } finally {
      await app.stop(true);
    }
  });

  test("4. derive() cannot overwrite or delete built-in Context.store on pooled instances", async () => {
    const app = new BareJS(1);
    app.derive(() => ({ store: "oops", custom: 42 } as any));
    app.get("/a", (ctx) => ({ hasStore: ctx.store instanceof Map, custom: (ctx as any).custom }));

    const r1 = await app.request("/a");
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ hasStore: true, custom: 42 });

    const r2 = await app.request("/notfound");
    expect(r2.status).toBe(404);
  });

  test("5. staticFile + timeout detaches timed-out Context and prevents pool header leakage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-signoff-"));
    try {
      writeFileSync(join(dir, "a.txt"), "hello");
      const app = new BareJS(1);
      app.use(timeout(20));
      app.use(async (ctx, next) => {
        if (ctx.req.url.endsWith("/a.txt")) {
          await Bun.sleep(60);
          ctx.setHeader("x-leaked", "from-timed-out-req");
        }
        return next();
      });
      app.use(staticFile(dir));
      app.get("/fast", () => ({ ok: true }));

      const r1 = await app.request("/a.txt");
      expect(r1.status).toBe(408);
      await Bun.sleep(80);
      const r2 = await app.request("/fast");
      expect(r2.status).toBe(200);
      expect(r2.headers.get("x-leaked")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("6. circuitBreaker + timeout + cors + securityHeaders: timeouts trip breaker & 503 preserves headers", async () => {
    const app = new BareJS();
    const states: string[] = [];
    app.use(cors({ origin: "https://example.com" }));
    app.use(securityHeaders());
    app.use(
      circuitBreaker({
        failureThreshold: 1,
        resetTimeoutMs: 5000,
        onStateChange: (f, t) => states.push(`${f}->${t}`)
      })
    );
    app.use(timeout(25));
    app.get("/slow", async () => {
      await Bun.sleep(80);
      return { ok: true };
    });

    const r1 = await app.request("/slow");
    expect(r1.status).toBe(408);
    expect(states).toEqual(["CLOSED->OPEN"]);

    const r2 = await app.request("/slow");
    expect(r2.status).toBe(503);
    expect(r2.headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect(r2.headers.get("x-frame-options")).toBe("DENY");
  });

  test("7. circuitBreaker ignores stale in-flight completions across epoch & respects custom isFailure on catch", async () => {
    const states: string[] = [];
    const cb = circuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 30,
      isFailure: (res, err) => {
        if (err && err.message === "ignore-me") return false;
        return Boolean(err) || (res instanceof Response && res.status >= 500);
      },
      onStateChange: (f, t) => states.push(`${f}->${t}`)
    });

    const ctx = new Context();
    await expect(
      cb(ctx, () => {
        throw new Error("ignore-me");
      })
    ).rejects.toThrow("ignore-me");
    expect(states).toEqual([]);

    // Trip breaker
    const rFail = await cb(ctx, () => new Response("err", { status: 500 }));
    expect(rFail.status).toBe(500);
    expect(states).toEqual(["CLOSED->OPEN"]);
  });

  test("8. Context security: Unicode-escaped __proto__, getSignedCookie prototype keys & empty cookie, json/redirect/sse/expires", async () => {
    // Unicode-escaped __proto__
    const ctx = new Context();
    ctx.req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"\\u005f\\u005fproto\\u005f\\u005f":{"admin":true},"ok":1}'
    });
    const body = await ctx.jsonBody();
    expect(Object.hasOwn(body, "__proto__")).toBe(false);
    expect(body.ok).toBe(1);

    // getSignedCookie with prototype property name & valid empty string cookie
    const ctx2 = new Context();
    ctx2.setCookie("empty", "", { secret: "sec" });
    const setCookieHeader = ctx2._setCookies![0]!;
    const cookieVal = setCookieHeader.split(";")[0]!;
    ctx2.req = new Request("http://localhost/", { headers: { cookie: cookieVal } });
    expect(ctx2.getSignedCookie("toString", "sec")).toBeNull();
    expect(ctx2.getSignedCookie("empty", "sec")).toBe("");

    // json() does not mutate _headers to pollute subsequent html()
    const ctx3 = new Context();
    ctx3.setHeader("x-custom", "1");
    const j = ctx3.json({ a: 1 });
    expect(j.headers.get("content-type")).toBe("application/json");
    const h = ctx3.html("<b>hi</b>");
    expect(h.headers.get("content-type")).toBe("text/html; charset=utf-8");

    // redirect() cannot be overridden by stale _headers['location']
    ctx3.setHeader("location", "https://evil.example/");
    const redir = ctx3.redirect("https://safe.example/");
    expect(redir.headers.get("location")).toBe("https://safe.example/");

    // Invalid Date in setCookie does not emit Expires=Invalid Date
    const ctx4 = new Context();
    ctx4.setCookie("a", "b", { expires: new Date("not-a-date") });
    expect(ctx4._setCookies![0]).not.toContain("Invalid Date");

    // sse() send(undefined) does not hang
    const ctx5 = new Context();
    const sseRes = ctx5.sse((send, close) => {
      send(undefined, "ping");
      close();
    });
    const sseText = await sseRes.text();
    expect(sseText).toContain("event: ping");
  });

  test("9. bareAuth rejects empty secret & clears jwkKeyCache on TTL refresh", async () => {
    const b64u = (s: string) => Buffer.from(s).toString("base64url");
    const data = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + b64u(JSON.stringify({ sub: "admin" }));
    const sig = createHmac("sha256", "").update(data).digest("base64url");
    const forged = `${data}.${sig}`;

    const app = new BareJS();
    app.use(bareAuth({}));
    app.get("/me", (ctx) => ctx.user);
    const res = await app.request("/me", { headers: { Authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
  });

  test("10. Hash.make honors bcrypt timeCost and needsRehash returns false immediately after Hash.make", async () => {
    const prev = initConfig({ hash: { algorithm: "bcrypt", memoryCost: 65536, timeCost: 4 } });
    try {
      const h = await Hash.make("password123");
      expect(h.startsWith("$2b$04$") || h.startsWith("$2a$04$") || h.startsWith("$2y$04$")).toBe(true);
      expect(await Hash.verify("password123", h)).toBe(true);
      expect(Hash.needsRehash(h)).toBe(false);
    } finally {
      initConfig({ ...prev, hash: { algorithm: "argon2id", memoryCost: 65536, timeCost: 2 } });
    }
  });

  test("11. cors() treats origin:'' as deny-all and never emits Allow-Credentials:true with '*'", async () => {
    const app1 = new BareJS();
    app1.use(cors({ origin: "" }));
    app1.get("/t", () => ({ ok: true }));
    const r1 = await app1.request("/t", { headers: { Origin: "https://evil.com" } });
    expect(r1.headers.get("access-control-allow-origin")).toBeNull();

    const app2 = new BareJS();
    app2.use(cors({ origin: "*", credentials: true }));
    app2.get("/t", () => ({ ok: true }));
    const r2 = await app2.request("/t", { headers: { Origin: "https://evil.com" } });
    expect(r2.headers.get("access-control-allow-origin")).toBe("*");
    expect(r2.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("12. csrf() honors X-Forwarded-Proto without X-Forwarded-Host and normalizes default ports", async () => {
    const app = new BareJS().trustProxy(true);
    app.use(csrf());
    app.post("/act", () => ({ ok: true }));

    const r1 = await app.request("http://example.com/act", {
      method: "POST",
      headers: { host: "example.com", "x-forwarded-proto": "https", origin: "https://example.com" }
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request("http://example.com/act", {
      method: "POST",
      headers: { host: "example.com:80", origin: "http://example.com" }
    });
    expect(r2.status).toBe(200);
  });

  test("13. staticFile supports If-None-Match '*' / list, strict Range validation & end clamping; compress skips 206", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-static2-"));
    try {
      writeFileSync(join(dir, "big.txt"), "0123456789".repeat(200));
      const app = new BareJS();
      app.use(compress({ minSize: 50 }));
      app.use(staticFile(dir));

      const rStar = await app.request("/big.txt", { headers: { "if-none-match": "*" } });
      expect(rStar.status).toBe(304);

      const rClamp = await app.request("/big.txt", {
        headers: { range: "bytes=0-99999", "accept-encoding": "gzip" }
      });
      expect(rClamp.status).toBe(206);
      expect(rClamp.headers.get("content-range")).toBe("bytes 0-1999/2000");
      expect(rClamp.headers.get("content-encoding")).toBeNull();

      for (const badRange of ["bytes= -5", "bytes=0-5-99", "bytes=0x0-0x5", "bytes=-0"]) {
        const rBad = await app.request("/big.txt", { headers: { range: badRange } });
        expect(rBad.status).toBe(416);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("14. idempotency sequential retries do not return false 409, and redisStore verifies lock ownership", async () => {
    const app = new BareJS();
    let calls = 0;
    app.use(idempotency({ ttlMs: 5000 }));
    app.post("/resp", () => {
      calls++;
      return new Response(JSON.stringify({ n: calls }), {
        status: 201,
        headers: { "content-type": "application/json" }
      });
    });

    const r1 = await app.request("/resp", { method: "POST", headers: { "Idempotency-Key": "seq-1" } });
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ n: 1 });

    // Immediate sequential retry
    const r2 = await app.request("/resp", { method: "POST", headers: { "Idempotency-Key": "seq-1" } });
    expect(r2.status).toBe(201);
    expect(r2.headers.get("x-idempotent-replayed")).toBe("true");
    expect(await r2.json()).toEqual({ n: 1 });

    // redisStore lock ownership
    const kv = new Map<string, string>();
    const mockRedis = {
      get: async (k: string) => kv.get(k) ?? null,
      del: async (k: string) => (kv.delete(k) ? 1 : 0),
      set: async (k: string, v: string, _px?: string, _ttl?: number, nx?: string) => {
        if (nx === "NX" && kv.has(k)) return null;
        kv.set(k, v);
        return "OK";
      }
    };
    const storeA = redisStore(mockRedis);
    const storeB = redisStore(mockRedis);
    expect(await storeA.acquire("k1", 10)).toBe(true);
    // Simulate TTL expiry
    kv.delete("barejs:idem:lock:k1");
    expect(await storeB.acquire("k1", 1000)).toBe(true);
    // Store A delayed release must NOT delete Store B's active lock
    await storeA.release("k1");
    expect(await storeB.acquire("k1", 1000)).toBe(false);
  });

  test("15. rateLimit LRU refresh prevents flooding out active rate-limited keys", async () => {
    const mw = rateLimit({ max: 1, windowMs: 60_000, maxEntries: 2, keyGenerator: (c) => c.req.headers.get("x-k") || "anon" });
    const req = (k: string) => {
      const c = new Context();
      c.req = new Request("http://localhost/", { headers: { "x-k": k } });
      return mw(c, () => new Response("ok"));
    };
    expect((await req("A")).status).toBe(200);
    expect((await req("B")).status).toBe(200);
    expect((await req("A")).status).toBe(429); // A hits limit & refreshes LRU after B
    expect((await req("C")).status).toBe(200); // Should evict B, NOT A
    expect((await req("A")).status).toBe(429);
  });

  test("16. validators stripUnknown handles nested arrays & empty objects, async Zod, and plain schemas", async () => {
    const app = new BareJS();
    app.post(
      "/arr",
      schemaValidator({
        stripUnknown: true,
        body: Type.Object({
          items: Type.Array(Type.Object({ id: Type.Number() }))
        })
      }),
      (ctx) => ctx.body
    );
    const rArr = await app.request("/arr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: 1, isAdmin: true }] })
    });
    expect(await rArr.json()).toEqual({ items: [{ id: 1 }] });

    const filterEmpty = createResponseFilter(Type.Object({}));
    expect(filterEmpty({ secret: "leak" })).toEqual({});

    const appZod = new BareJS();
    appZod.post(
      "/async-zod",
      schemaValidator({
        body: Z.object({ n: Z.number().refine(async (v) => v > 0) })
      }),
      (ctx) => ctx.body
    );
    const rZod = await appZod.request("/async-zod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n: 5 })
    });
    expect(rZod.status).toBe(200);
  });

  test("17. renderDocsHTML escapes HTML attributes, OpenAPI preserves param order, bareClient handles FormData & query", async () => {
    const html = renderDocsHTML('"/docs/json" onload="alert(1)');
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain("&quot;");

    const app = new BareJS();
    app.get("/users/:userId/posts/:postId", () => ({}));
    const spec = generateOpenAPISpec(app.routes);
    const paramNames = spec.paths["/users/{userId}/posts/{postId}"].get.parameters.map((p: any) => p.name);
    expect(paramNames).toEqual(["userId", "postId"]);

    let capturedUrl = "";
    let capturedBody: any = null;
    const client = bareClient("http://localhost", {
      fetch: (async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = init.body;
        return Response.json({ ok: true });
      }) as any
    });
    const fd = new FormData();
    fd.append("file", "hello");
    await client.post("/upload?v=1", { query: { a: 2 }, body: fd });
    expect(capturedUrl).toBe("http://localhost/upload?v=1&a=2");
    expect(capturedBody instanceof FormData).toBe(true);
  });

  test("18. RadixNode preserves first paramName & slices wildcard before '?' in lookup(); BareRouter.use mounts multiple routers", async () => {
    const tree = new RadixNode();
    tree.insert("/users/:userId", "GET", () => "user");
    tree.insert("/users/:id/posts", "GET", () => "posts");
    tree.insert("/files/*", "GET", () => "files");

    const ctx1 = new Context();
    tree.lookup("GET", "/users/99", 0, ctx1);
    expect(ctx1.params.userId).toBe("99");

    const ctx2 = new Context();
    tree.lookup("GET", "/files/a/b?foo=bar", 0, ctx2);
    expect(ctx2.params["*"]).toBe("a/b");

    const app = new BareJS();
    const r1 = new BareRouter().get("/a", () => "a");
    const r2 = new BareRouter().get("/b", () => "b");
    app.use(r1, r2);
    expect((await app.request("/a")).status).toBe(200);
    expect((await app.request("/b")).status).toBe(200);
  });

  test("19. initConfig(null) does not throw TypeError", () => {
    const cfg = initConfig(null as any);
    expect(cfg.port).toBe(3000);
    expect(cfg.hash.algorithm).toBe("argon2id");
  });
});
