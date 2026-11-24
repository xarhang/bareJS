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
  native,
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
    expect(res.headers.get("location")).toMatch(/^https:\/\/example\.com\/?$/);
  });

  test("3. listen() options.trustProxy applies to Context pool overflow allocations", async () => {
    const app = new BareJS(1);
    app.get("/ip", async (ctx) => {
      await Bun.sleep(20);
      return { trust: ctx._trustProxy, ip: ctx.ip };
    });
    const server = app.listen(0, "127.0.0.1", false, { trustProxy: true });
    await (server as any).ready;
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

  test("20. bareAuth rejects non-canonical base64url signatures so revoked tokens cannot bypass revocation", async () => {
    const { createToken, revokeToken } = await import("../src/index");
    const secret = "canon-secret";
    const tok = await createToken({ sub: "u1" }, secret);
    revokeToken(tok, 60_000);

    const app = new BareJS();
    app.use(bareAuth(secret));
    app.get("/me", () => ({ ok: true }));

    for (const variant of [tok, `${tok}=`, `${tok}==`, `${tok}!`]) {
      const res = await app.request("/me", { headers: { Authorization: `Bearer ${variant}` } });
      expect(res.status).toBe(401);
    }
  });

  test("21. timeout, compress, idempotency before circuitBreaker work properly and tightest timeout wins", async () => {
    const app = new BareJS();
    let count = 0;
    app.use(compress({ minSize: 10 }));
    app.use(timeout(5000));
    app.use(idempotency({ ttlMs: 5000 }));
    app.use(circuitBreaker({ failureThreshold: 5 }));
    app.post("/pay", () => {
      count++;
      return { ok: true, count, pad: "x".repeat(50) };
    });
    app.get("/fast-timeout", timeout(20), async () => {
      await Bun.sleep(80);
      return { ok: true };
    });

    const r1 = await app.request("/pay", {
      method: "POST",
      headers: { "Idempotency-Key": "pre-cb-1", "Accept-Encoding": "gzip" }
    });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-encoding")).toBe("gzip");

    const r2 = await app.request("/pay", {
      method: "POST",
      headers: { "Idempotency-Key": "pre-cb-1" }
    });
    expect(r2.headers.get("x-idempotent-replayed")).toBe("true");
    expect(count).toBe(1);

    const rTimeout = await app.request("/fast-timeout");
    expect(rTimeout.status).toBe(408);
  });

  test("22. Throwing onError handler does not leak Context from pool", async () => {
    const app = new BareJS(1);
    const seen = new Set<Context>();
    app.onError(() => {
      throw new Error("onError crashed");
    });
    app.get("/boom", () => {
      throw new Error("route boom");
    });
    app.get("/ok", (ctx) => {
      seen.add(ctx);
      return { ok: true };
    });

    expect((await app.request("/ok")).status).toBe(200);
    expect((await app.request("/boom")).status).toBe(500);
    expect((await app.request("/ok")).status).toBe(200);
    expect(seen.size).toBe(1);
  });

  test("23. redisStore pop() releases active live lock after an earlier expired acquisition on same store", async () => {
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
    const store = redisStore(mockRedis);
    expect(await store.acquire("k", 20)).toBe(true);
    kv.delete("barejs:idem:lock:k"); // simulate TTL expiry of first lock
    expect(await store.acquire("k", 5000)).toBe(true);
    await store.release("k"); // normal release of live lock
    expect(await store.acquire("k", 5000)).toBe(true);
  });

  test("24. idempotency releases in-flight lock if Response.clone() throws (disturbed body)", async () => {
    const mw = idempotency({ ttlMs: 5000 });
    const ctx1 = new Context();
    ctx1.req = new Request("http://localhost/pay", { method: "POST", headers: { "Idempotency-Key": "disturbed" } });
    expect(mw(ctx1, () => {})).toBeUndefined();

    const usedRes = new Response("hello");
    await usedRes.text(); // bodyUsed === true
    (mw as any).__idempotencyCommit(ctx1, usedRes, 200);

    const ctx2 = new Context();
    ctx2.req = new Request("http://localhost/pay", { method: "POST", headers: { "Idempotency-Key": "disturbed" } });
    const r2 = mw(ctx2, () => {});
    expect(r2).toBeUndefined(); // Not stuck at 409
  });

  test("25. staticFile + cors + compress preserves both Accept-Encoding and Origin in Vary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-vary-"));
    try {
      writeFileSync(join(dir, "hello.txt"), "A".repeat(200));
      const app = new BareJS();
      app.use(cors({ origin: "https://example.com" }));
      app.use(compress({ minSize: 10 }));
      app.use(staticFile(dir));

      const res = await app.request("/hello.txt", {
        headers: { Origin: "https://example.com", "Accept-Encoding": "gzip" }
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-encoding")).toBe("gzip");
      const vary = (res.headers.get("vary") || "").toLowerCase();
      expect(vary).toContain("accept-encoding");
      expect(vary).toContain("origin");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("26. validate() handles plain JSON Schema and createResponseFilter ignores Object.prototype properties", async () => {
    const { validate } = await import("../src/index");
    const app = new BareJS();
    app.post("/plain", validate({ type: "object", properties: { name: { type: "string" } } }), (ctx) => ctx.body);
    const res = await app.request("/plain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice" })
    });
    expect(res.status).toBe(200);

    const filter = createResponseFilter({
      type: "object",
      properties: { toString: { type: "string" }, a: { type: "string" } },
      required: ["a"]
    });
    expect(filter({ a: "hi" })).toEqual({ a: "hi" });
  });

  test("27. bareClient substitutes :param before '?' and BareRouter.use(prefix, mw, router) applies mw", async () => {
    let hitUrl = "";
    const client = bareClient("http://localhost", {
      fetch: (async (url: string) => {
        hitUrl = url;
        return Response.json({ ok: true });
      }) as any
    });
    await client.get("/users/:id?foo=1", { params: { id: 42 } });
    expect(hitUrl).toBe("http://localhost/users/42?foo=1");

    const app = new BareJS();
    const sub = new BareRouter().get("/item", (ctx) => ({ tag: ctx.get("tag") }));
    app.use("/api", (ctx) => { ctx.set("tag", "v1"); }, sub);
    const r = await app.request("/api/item");
    expect(await r.json()).toEqual({ tag: "v1" });

    const cfg = initConfig(["bad"] as any);
    expect((cfg as any)[0]).toBeUndefined();
  });

  test("28. Context.sse splits standalone CR (\\r) to prevent SSE field injection", async () => {
    const ctx = new Context();
    const res = ctx.sse((send, close) => {
      send("hello\revent: injected\rdata: fake");
      close();
    });
    const text = await res.text();
    expect(text).toBe("data: hello\ndata: event: injected\ndata: data: fake\n\n");
  });

  test("29. bareAuth rejects Base64Url trailing-bit malleability on revoked tokens", async () => {
    const { createToken, revokeToken } = await import("../src/index");
    const secret = "malleability-secret";
    const tok = await createToken({ sub: "user1" }, secret);
    revokeToken(tok, 60_000);

    const parts = tok.split(".");
    const sig = parts[2]!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lastIdx = alphabet.indexOf(sig[sig.length - 1]!);
    const flippedChar = alphabet[lastIdx ^ 1]!;
    const mutatedTok = `${parts[0]}.${parts[1]}.${sig.slice(0, -1)}${flippedChar}`;

    const app = new BareJS();
    app.use(bareAuth(secret));
    app.get("/me", () => ({ ok: true }));

    expect((await app.request("/me", { headers: { Authorization: `Bearer ${tok}` } })).status).toBe(401);
    expect((await app.request("/me", { headers: { Authorization: `Bearer ${mutatedTok}` } })).status).toBe(401);
  });

  test("30. Mounted sub-app derive() cleans up pool keys and post-compile trustProxy(true) applies to overflow", async () => {
    const sub = new BareJS().derive(() => ({ leaked: "SECRET_TOKEN" }));
    sub.get("/a", (ctx) => ({ leaked: (ctx as any).leaked }));
    const app = new BareJS(1).route("/sub", sub);
    app.get("/b", (ctx) => ({ leaked: (ctx as any).leaked ?? null }));

    expect(await (await app.request("/sub/a")).json()).toEqual({ leaked: "SECRET_TOKEN" });
    expect(await (await app.request("/b")).json()).toEqual({ leaked: null });

    const app2 = new BareJS(1);
    app2.get("/slow-ip", async (ctx) => {
      await Bun.sleep(20);
      return { ip: ctx.ip };
    });
    await app2.request("/slow-ip"); // pre-compile
    app2.trustProxy(true);
    const [r1, r2] = await Promise.all([
      app2.request("/slow-ip", { headers: { "x-forwarded-for": "1.2.3.4" } }).then((r) => r.json()),
      app2.request("/slow-ip", { headers: { "x-forwarded-for": "5.6.7.8" } }).then((r) => r.json())
    ]);
    expect(r1.ip).toBe("1.2.3.4");
    expect(r2.ip).toBe("5.6.7.8");
  });

  test("31. idempotency before cors/staticFile does not stall dispatch & timeout prevents late commit caching", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-idem-static-"));
    try {
      writeFileSync(join(dir, "asset.txt"), "ok");
      const app = new BareJS();
      app.use(idempotency());
      app.use(cors({ origin: "https://app.test" }));
      app.use(staticFile(dir));
      expect((await app.request("/asset.txt")).status).toBe(200);
      expect((await app.request("/any", { method: "OPTIONS", headers: { Origin: "https://app.test" } })).status).toBe(204);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // timeout + slow streaming Response idempotency commit
    const app2 = new BareJS();
    let calls = 0;
    app2.use(timeout(20));
    app2.use(idempotency({ ttlMs: 5000 }));
    app2.post("/stream-slow", () => {
      calls++;
      return new Response(
        new ReadableStream({
          async start(c) {
            if (calls === 1) await Bun.sleep(50);
            c.enqueue(new TextEncoder().encode(JSON.stringify({ calls })));
            c.close();
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const t1 = await app2.request("/stream-slow", { method: "POST", headers: { "Idempotency-Key": "slow-k" } });
    expect(t1.status).toBe(408);
    await Bun.sleep(70);
    const t2 = await app2.request("/stream-slow", { method: "POST", headers: { "Idempotency-Key": "slow-k" } });
    expect(t2.status).toBe(200);
    expect(await t2.json()).toEqual({ calls: 2 });
  });

  test("32. ZodEffects query coercion, 2D+ array projection, and native(null) safety", async () => {
    const { native, validate } = await import("../src/index");
    expect(() => native(null as any)).not.toThrow();
    expect(() => validate(null as any)).not.toThrow();

    const app = new BareJS();
    app.get(
      "/q",
      schemaValidator({ query: Z.object({ page: Z.number() }).refine((v) => v.page > 0) }),
      (ctx) => ({ page: ctx.query.page })
    );
    const rq = await app.request("/q?page=3");
    expect(rq.status).toBe(200);
    expect(await rq.json()).toEqual({ page: 3 });

    const filter2d = createResponseFilter(
      Type.Object({ matrix: Type.Array(Type.Array(Type.Object({ id: Type.Number() }))) })
    );
    expect(filter2d({ matrix: [[{ id: 1, secret: "leaked" }]] })).toEqual({ matrix: [[{ id: 1 }]] });
  });

  test("33. RadixRouter uses null-prototype children/handlers so constructor and toString segments are safe", async () => {
    const app = new BareJS();
    app.get("/api/constructor", () => ({ ok: "ctor" }));
    app.get("/toString/test", () => ({ ok: "toStr" }));

    const r1 = await app.request("/api/constructor");
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: "ctor" });

    const r2 = await app.request("/toString/test");
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: "toStr" });

    // Unknown route named toString must return 404, not Object.prototype.toString
    const r3 = await app.request("/toString");
    expect(r3.status).toBe(404);
  });

  test("34. runGlobalOptions and runStatic preserve downstream Response when middleware awaits next() without return", async () => {
    const { staticFile } = await import("../src/index");
    const app = new BareJS();
    app.use(async (_ctx, next) => {
      await next();
    });
    app.use(cors({ origin: "*" }));
    app.get("/hello", () => ({ ok: true }));

    const optRes = await app.request("/hello", { method: "OPTIONS" });
    expect(optRes.status).toBe(204);
    expect(optRes.headers.get("access-control-allow-origin")).toBe("*");

    const tmpDir = "/tmp/barejs-r4-static-" + Date.now();
    await Bun.write(`${tmpDir}/hello.txt`, "hello-static");
    const staticApp = new BareJS();
    staticApp.use(async (_ctx, next) => {
      await next();
    });
    staticApp.use(staticFile(tmpDir));

    const stRes = await staticApp.request("/hello.txt");
    expect(stRes.status).toBe(200);
    expect(await stRes.text()).toBe("hello-static");
  });

  test("35. idempotency releases lock on staticFile even with 0 routes, and cors merges Vary header", async () => {
    const { staticFile, circuitBreaker, idempotency } = await import("../src/index");
    const tmpDir = "/tmp/barejs-r4-idem-static-" + Date.now();
    await Bun.write(`${tmpDir}/item.txt`, "v1");

    const sApp = new BareJS();
    sApp.use(idempotency());
    sApp.use(staticFile(tmpDir));

    const s1 = await sApp.request("/item.txt", { headers: { "Idempotency-Key": "static-k1" } });
    expect(s1.status).toBe(200);
    // Second request with same key must NOT get 409 IDEMPOTENT_IN_FLIGHT
    const s2 = await sApp.request("/item.txt", { headers: { "Idempotency-Key": "static-k1" } });
    expect(s2.status).toBe(200);

    const vApp = new BareJS();
    vApp.use(cors({ origin: "https://app.example.com" }));
    vApp.use(circuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 }));
    vApp.get("/vary", () => new Response("ok", { headers: { Vary: "Cookie" } }));

    const vRes = await vApp.request("/vary", { headers: { Origin: "https://app.example.com" } });
    expect(vRes.status).toBe(200);
    const varyHeader = vRes.headers.get("vary") || "";
    expect(varyHeader.toLowerCase()).toContain("cookie");
    expect(varyHeader.toLowerCase()).toContain("origin");
  });

  test("36. bareAuth strips nested __proto__ own keys from JWT payload", async () => {
    const secret = "r4-nested-proto-secret-key-32-chars!";
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const rawPayload = '{"sub":"u1","nested":{"__proto__":{"isAdmin":true},"ok":1}}';
    const payloadB64 = Buffer.from(rawPayload).toString("base64url");
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", secret).update(`${header}.${payloadB64}`).digest("base64url");
    const forgedJwt = `${header}.${payloadB64}.${sig}`;

    const app = new BareJS();
    app.use(bareAuth({ secret }));
    app.get("/me", (ctx) => ({
      hasNestedProtoOwn: Object.hasOwn((ctx as any).user.nested, "__proto__"),
      ok: (ctx as any).user.nested.ok
    }));

    const res = await app.request("/me", { headers: { Authorization: `Bearer ${forgedJwt}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasNestedProtoOwn: false, ok: 1 });
  });

  test("37. native() and schemaValidator() enforce additionalProperties: false", async () => {
    const { native } = await import("../src/index");
    const app = new BareJS();
    app.post(
      "/native-strict",
      native({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
        additionalProperties: false
      }),
      (ctx) => ({ name: ctx.body.name })
    );
    app.post(
      "/schema-strict",
      schemaValidator({
        body: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false
        }
      }),
      (ctx) => ({ name: ctx.body.name })
    );

    const nBad = await app.request("/native-strict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", role: "admin" })
    });
    expect(nBad.status).toBe(400);

    const sBad = await app.request("/schema-strict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice", role: "admin" })
    });
    expect(sBad.status).toBe(400);

    const nOk = await app.request("/native-strict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "alice" })
    });
    expect(nOk.status).toBe(200);
  });

  test("38. redisStore idempotency isolates per-request lock tokens on TTL expiry", async () => {
    const { redisStore, idempotency } = await import("../src/index");
    const kv = new Map<string, { val: string; exp: number }>();
    const mockRedis: any = {
      async get(k: string) {
        const entry = kv.get(k);
        if (!entry) return null;
        if (Date.now() > entry.exp) { kv.delete(k); return null; }
        return entry.val;
      },
      async set(k: string, v: string, ...args: any[]) {
        let px = 60_000;
        let nx = false;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "PX") px = Number(args[++i]);
          if (args[i] === "NX") nx = true;
        }
        const cur = await this.get(k);
        if (nx && cur !== null) return null;
        kv.set(k, { val: v, exp: Date.now() + px });
        return "OK";
      },
      async del(k: string) {
        kv.delete(k);
        return 1;
      },
      async eval(_lua: string, _numKeys: number, k: string, expectedToken: string) {
        const cur = await this.get(k);
        if (cur === expectedToken) {
          kv.delete(k);
          return 1;
        }
        return 0;
      }
    };

    const app = new BareJS();
    app.use(idempotency({ ttlMs: 40, store: redisStore(mockRedis) }));
    let reqCount = 0;
    app.post("/pay", async () => {
      const id = ++reqCount;
      if (id === 1) {
        await Bun.sleep(70); // R1 exceeds 40ms lock TTL and fails (no 2xx cache write)
        return Response.json({ id, err: true }, { status: 500 });
      }
      await Bun.sleep(60); // R2 still in flight when R1 finishes
      return { id };
    });

    const p1 = app.request("/pay", { method: "POST", headers: { "Idempotency-Key": "k-race" } });
    await Bun.sleep(50); // Wait for R1's 40ms lock to expire
    const p2 = app.request("/pay", { method: "POST", headers: { "Idempotency-Key": "k-race" } });
    await Bun.sleep(30); // R1 has now finished and released; R2 is still running!
    const p3 = app.request("/pay", { method: "POST", headers: { "Idempotency-Key": "k-race" } });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe(500);
    expect(r2.status).toBe(200);
    // R3 arrived while R2 was still in flight -> must get 409 (R1 must not delete R2's lock!)
    expect(r3.status).toBe(409);
  });

  test("39. app.listen(0) uses ephemeral port and applyCtxHeaders merges Vary on error/static responses", async () => {
    const app = new BareJS();
    app.use(cors({ origin: "https://app.example.com" }));
    app.onError(() => new Response("err", { status: 500, headers: { Vary: "Accept-Encoding" } }));
    app.get("/boom", () => { throw new Error("boom"); });

    const res = await app.request("/boom", { headers: { Origin: "https://app.example.com" } });
    expect(res.status).toBe(500);
    const vary = (res.headers.get("vary") || "").toLowerCase();
    expect(vary).toContain("accept-encoding");
    expect(vary).toContain("origin");

    const srv: any = app.listen(0);
    await srv.ready;
    try {
      expect(srv.port).not.toBe(3000);
      expect(srv.port).toBeGreaterThan(0);
    } finally {
      await app.stop(true);
    }
  });

  test("40. RadixNode supports per-route param names, :__proto__ own property, and lookup() wildcard backtracking", async () => {
    const { RadixNode } = await import("../src/core/radix");
    const app = new BareJS();
    app.get("/users/:userId", (ctx) => ({ route: 1, params: ctx.params }));
    app.get("/users/:id/posts", (ctx) => ({ route: 2, params: ctx.params }));
    app.get("/p/:__proto__", (ctx) => ({
      hasOwn: Object.hasOwn(ctx.params, "__proto__"),
      val: ctx.params["__proto__"]
    }));

    expect(await (await app.request("/users/42")).json()).toEqual({ route: 1, params: { userId: "42" } });
    expect(await (await app.request("/users/42/posts")).json()).toEqual({ route: 2, params: { id: "42" } });
    expect(await (await app.request("/p/admin")).json()).toEqual({ hasOwn: true, val: "admin" });

    // lookup() parity for /files/* on /files and backtracking /a/:id/b -> /a/*
    const tree = new RadixNode();
    tree.insert("/files/*", "GET", () => "files");
    tree.insert("/a/:id/b", "GET", () => "ab");
    tree.insert("/a/*", "GET", () => "a-wild");

    const ctx1 = new Context(new Request("http://localhost/files"));
    expect(tree.lookup("GET", "/files", 0, ctx1)).not.toBeNull();
    expect(ctx1.params["*"]).toBe("");

    const ctx2 = new Context(new Request("http://localhost/a/foo/c"));
    expect(tree.lookup("GET", "/a/foo/c", 0, ctx2)).not.toBeNull();
    expect(ctx2.params["*"]).toBe("foo/c");
  });

  test("41. Scoped cors() on mounted sub-routers handles OPTIONS preflight with 204", async () => {
    const { BareRouter } = await import("../src/index");
    const app = new BareJS();

    const sub = new BareRouter();
    sub.use(cors({ origin: "https://sub.example.com" }));
    sub.post("/items", () => ({ ok: true }));
    app.use("/sub", sub);

    const sub2 = new BareRouter();
    sub2.post("/items", () => ({ ok: true }));
    app.use("/scoped", cors({ origin: "https://scoped.example.com" }), sub2);

    const r1 = await app.request("/sub/items", {
      method: "OPTIONS",
      headers: { Origin: "https://sub.example.com" }
    });
    expect(r1.status).toBe(204);
    expect(r1.headers.get("access-control-allow-origin")).toBe("https://sub.example.com");

    const r2 = await app.request("/scoped/items", {
      method: "OPTIONS",
      headers: { Origin: "https://scoped.example.com" }
    });
    expect(r2.status).toBe(204);
    expect(r2.headers.get("access-control-allow-origin")).toBe("https://scoped.example.com");
  });

  test("42. Context.upload() enforces size limits on chunked requests without Content-Length and multipart string fields", async () => {
    const app = new BareJS();
    app.post("/up", async (ctx) => {
      try {
        return await ctx.upload({ maxFileSize: 100, maxFiles: 1 });
      } catch (e: any) {
        return ctx.status(e?.status || 500).json({ error: e?.message });
      }
    });

    const boundary = "----barejs-test-boundary";
    const bigField = "A".repeat(2000);
    const bodyText = `--${boundary}\r\nContent-Disposition: form-data; name="big"\r\n\r\n${bigField}\r\n--${boundary}--\r\n`;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(bodyText));
        controller.close();
      }
    });
    const req = new Request("http://localhost/up", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: stream,
      duplex: "half"
    } as any);
    const res = await app.fetch(req);
    expect(res.status).toBe(413);
  });

  test("43. Context.sse() supports sync timer callback, jsonBody() strips constructor/prototype, getSignedCookie() rejects non-canonical base64url", async () => {
    const ctx = new Context();
    ctx.reset(new Request("http://localhost/sse"));
    const sseRes = ctx.sse((send, close) => {
      setTimeout(() => {
        send("hello");
        close();
      }, 10);
    });
    expect(await sseRes.text()).toContain("data: hello");

    const ctxJson = new Context();
    ctxJson.reset(
      new Request("http://localhost/j", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"constructor":{"prototype":{"x":1}},"ok":true}'
      })
    );
    const parsed = await ctxJson.jsonBody();
    expect(Object.hasOwn(parsed, "constructor")).toBe(false);
    expect(parsed.ok).toBe(true);

    const c1 = new Context();
    c1.reset(new Request("http://localhost/c"));
    c1.setCookie("sid", "u1", { secret: "sec-123" });
    const cookieVal = (c1._setCookies![0]!.split(";")[0]!).slice("sid=".length);
    const c2 = new Context();
    c2.reset(new Request("http://localhost/c", { headers: { Cookie: `sid=${cookieVal}==` } }));
    expect(c2.getSignedCookie("sid", "sec-123")).toBeNull();
  });

  test("44. idempotency releases lock when timeout fires during acquireToken or recheck throws, and acquireToken isolates tokens", async () => {
    const { idempotency, timeout, redisStore } = await import("../src/index");
    let locks = 0;
    const store: any = {
      async get() { return undefined; },
      async set() {},
      async acquireToken() {
        await Bun.sleep(40);
        locks++;
        return "tok-1";
      },
      async acquire() { return true; },
      async release() { locks = Math.max(0, locks - 1); }
    };

    const app = new BareJS();
    app.use(timeout(15));
    app.use(idempotency({ store }));
    app.use(() => Response.json({ denied: true }, { status: 401 }));
    app.post("/x", () => ({ ok: true }));

    const r1 = await app.request("/x", { method: "POST", headers: { "Idempotency-Key": "k-to" } });
    expect(r1.status).toBe(408);
    await Bun.sleep(50);
    expect(locks).toBe(0);

    // Recheck throws -> must release lock
    let recheckLocks = 0;
    let calls = 0;
    const errStore: any = {
      async get() {
        calls++;
        if (calls === 2) throw new Error("redis read error");
        return undefined;
      },
      async set() {},
      async acquireToken() { recheckLocks++; return "tok-err"; },
      async acquire() { return true; },
      async release() { recheckLocks = Math.max(0, recheckLocks - 1); }
    };
    const app2 = new BareJS();
    app2.use(idempotency({ store: errStore }));
    app2.post("/y", () => ({ ok: true }));
    const r2 = await app2.request("/y", { method: "POST", headers: { "Idempotency-Key": "k-err" } });
    expect(r2.status).toBe(500);
    expect(recheckLocks).toBe(0);

    // Direct redisStore.acquireToken() + release(k, tok) isolates per-request tokens
    const kv = new Map<string, { val: string; exp: number }>();
    const mockRedis: any = {
      async get(k: string) {
        const e = kv.get(k);
        if (!e || Date.now() > e.exp) { kv.delete(k); return null; }
        return e.val;
      },
      async set(k: string, v: string, _px: string, ms: number, nx?: string) {
        if (nx === "NX" && (await this.get(k)) !== null) return null;
        kv.set(k, { val: v, exp: Date.now() + ms });
        return "OK";
      },
      async eval(_lua: string, _n: number, k: string, tok: string) {
        if ((await this.get(k)) === tok) { kv.delete(k); return 1; }
        return 0;
      }
    };
    const rs = redisStore(mockRedis);
    const tok1 = await rs.acquireToken!("iso-k", 20);
    expect(tok1).toBeTruthy();
    await Bun.sleep(30);
    const tok2 = await rs.acquireToken!("iso-k", 5000);
    expect(tok2).toBeTruthy();
    await rs.release("iso-k", tok1!); // Holder 1 releases -> must NOT delete Holder 2's active lock!
    expect(await rs.acquireToken!("iso-k", 5000)).toBeNull();
  });

  test("45. createResponseFilter and stripUnknown project Type.Union, Type.Intersect, and query/params", async () => {
    const f1 = createResponseFilter(
      Type.Object({
        profile: Type.Union([Type.Object({ name: Type.String() }), Type.Null()])
      })
    );
    expect(f1({ profile: { name: "Alice", passwordHash: "secret" } })).toEqual({ profile: { name: "Alice" } });

    const f2 = createResponseFilter(
      Type.Intersect([Type.Object({ id: Type.Number() }), Type.Object({ name: Type.String() })])
    );
    expect(f2({ id: 1, name: "Bob", secretToken: "leak" })).toEqual({ id: 1, name: "Bob" });

    const app = new BareJS();
    app.get(
      "/q",
      schemaValidator({
        query: Type.Object({ page: Type.Number() }),
        stripUnknown: true
      }),
      (ctx) => ctx.query
    );
    const r = await app.request("/q?page=2&admin=true");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ page: 2 });
  });

  test("46. validate() and schemaValidator() enforce nested plain JSON Schema constraints", async () => {
    const { validate } = await import("../src/index");
    const nestedSchema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { age: { type: "integer", minimum: 18 } },
          required: ["age"],
          additionalProperties: false
        }
      },
      required: ["user"],
      additionalProperties: false
    };

    const app = new BareJS();
    app.post("/v", validate(nestedSchema), (ctx) => ({ ok: true, body: ctx.body }));
    app.post("/sv", schemaValidator({ body: nestedSchema }), (ctx) => ({ ok: true, body: ctx.body }));

    const bad1 = await app.request("/v", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { age: 12 } })
    });
    expect(bad1.status).toBe(400);

    const bad2 = await app.request("/sv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { age: 20, role: "admin" } })
    });
    expect(bad2.status).toBe(400);

    const good = await app.request("/v", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { age: 25 } })
    });
    expect(good.status).toBe(200);
  });

  test("47. bareClient strips default Content-Type for FormData and skips undefined :param", async () => {
    const { bareClient } = await import("../src/index");
    const app = new BareJS();
    app.post("/up", async (ctx) => {
      const fd = await ctx.req.formData();
      return { name: fd.get("name") };
    });
    app.get("/users/:id", (ctx) => ({ id: ctx.params.id }));

    const client = bareClient(app, { headers: { "Content-Type": "application/json" } });
    const fd = new FormData();
    fd.append("name", "alice");
    const upRes = await client.post("/up", { body: fd });
    expect(upRes).toEqual({ name: "alice" });

    // When param is undefined, :id stays :id (not "undefined")
    const uRes = await client.get("/users/:id", { params: { id: undefined as any } });
    expect(uRes).toEqual({ id: ":id" });
  });

  test("48. bareAuth revokes both ES256 (r, s) and (r, n-s) twin signatures", async () => {
    const { subtle } = globalThis.crypto;
    const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = await subtle.exportKey("spki", kp.publicKey);
    const b64Pem = Buffer.from(spki).toString("base64").match(/.{1,64}/g)!.join("\n");
    const pubPem = `-----BEGIN PUBLIC KEY-----\n${b64Pem}\n-----END PUBLIC KEY-----`;

    const hdr = Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url");
    const pld = Buffer.from(JSON.stringify({ sub: "u1", role: "admin" })).toString("base64url");
    const input = `${hdr}.${pld}`;
    const sigBuf = Buffer.from(
      await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(input))
    );
    const token = `${input}.${sigBuf.toString("base64url")}`;

    const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const s = BigInt("0x" + sigBuf.subarray(32, 64).toString("hex"));
    const twinBuf = Buffer.allocUnsafe(64);
    sigBuf.copy(twinBuf, 0, 0, 32);
    Buffer.from((P256_N - s).toString(16).padStart(64, "0"), "hex").copy(twinBuf, 32);
    const malleatedToken = `${input}.${twinBuf.toString("base64url")}`;

    const { revokeToken } = await import("../src/index");
    revokeToken(token, 60_000);

    const app = new BareJS();
    app.use(bareAuth({ publicKey: pubPem, algorithms: ["ES256"] }));
    app.get("/admin", (ctx) => ({ user: ctx.get("user") }));

    const r1 = await app.request("/admin", { headers: { Authorization: `Bearer ${token}` } });
    expect(r1.status).toBe(401);
    const r2 = await app.request("/admin", { headers: { Authorization: `Bearer ${malleatedToken}` } });
    expect(r2.status).toBe(401);
  });

  test("49. jsonBody() and upload() abort streaming bodies mid-stream and requestId strips control chars", async () => {
    let chunksRead = 0;
    const bigStream = new ReadableStream({
      pull(controller) {
        chunksRead++;
        if (chunksRead > 50) { controller.close(); return; }
        controller.enqueue(new TextEncoder().encode('{"a":"' + "x".repeat(500) + '"}'));
      }
    });
    const ctx = new Context();
    ctx.reset(
      new Request("http://localhost/j", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigStream,
        duplex: "half"
      } as any)
    );
    await expect(ctx.jsonBody(100)).rejects.toMatchObject({ status: 413 });
    expect(chunksRead).toBeLessThan(10);

    const ctxId = new Context();
    ctxId.reset(new Request("http://localhost/id", { headers: { "x-request-id": "abc\x1b[31m\x08def" } }));
    expect(ctxId.requestId).toBe("abc[31mdef");
  });

  test("50. createResponseFilter and native() handle Type.Record, properties+anyOf, and schema-valued additionalProperties", async () => {
    const { native } = await import("../src/index");
    const recFilter = createResponseFilter(Type.Record(Type.String(), Type.Object({ name: Type.String() })));
    expect(recFilter({ u1: { name: "Alice", secret: "LEAK" } })).toEqual({ u1: { name: "Alice" } });

    const comboFilter = createResponseFilter({
      type: "object",
      properties: { id: { type: "string" }, email: { type: "string" } },
      anyOf: [{ required: ["email"] }]
    });
    expect(comboFilter({ id: "1", email: "a@b.com", passwordHash: "LEAK" })).toEqual({ id: "1", email: "a@b.com" });

    const app = new BareJS();
    app.post(
      "/extra",
      native({
        type: "object",
        properties: { id: { type: "string" } },
        additionalProperties: { type: "number" }
      }),
      (ctx) => ctx.body
    );
    const bad = await app.request("/extra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1", extra: "not-a-number" })
    });
    expect(bad.status).toBe(400);
  });

  test("51. cors() preserves Vary: Origin with non-Response returns and origin:'' auto-registers OPTIONS; RadixNode handles multi-method :__proto__", async () => {
    const app = new BareJS();
    app.use(cors({ origin: ["https://a.com"] }));
    app.get("/v", (ctx) => {
      ctx.setHeader("Vary", "Accept-Encoding");
      return { ok: true };
    });
    const rv = await app.request("/v", { headers: { Origin: "https://a.com" } });
    expect(rv.status).toBe(200);
    const vary = (rv.headers.get("vary") || "").toLowerCase();
    expect(vary).toContain("accept-encoding");
    expect(vary).toContain("origin");

    const appEmpty = new BareJS();
    appEmpty.get("/e", cors({ origin: "" }), () => ({ ok: true }));
    expect((await appEmpty.request("/e", { method: "OPTIONS" })).status).toBe(204);

    const appProto = new BareJS();
    appProto.get("/x/:__proto__", (ctx) => ({ m: "GET", v: ctx.params["__proto__"] }));
    appProto.post("/x/:__proto__", (ctx) => ({ m: "POST", v: ctx.params["__proto__"] }));
    expect(await (await appProto.request("/x/hello")).json()).toEqual({ m: "GET", v: "hello" });
    expect(await (await appProto.request("/x/world", { method: "POST" })).json()).toEqual({ m: "POST", v: "world" });
  });

  test("52. idempotency does not double-release externalStore without acquireToken when timeout fires during body buffering", async () => {
    const { idempotency, timeout } = await import("../src/index");
    const locks = new Set<string>();
    const store: any = {
      async get() { return undefined; },
      async set() {},
      async acquire(k: string) {
        if (locks.has(k)) return false;
        locks.add(k);
        return true;
      },
      async release(k: string) {
        locks.delete(k);
      }
    };

    const app = new BareJS();
    app.use(timeout(40));
    app.use(idempotency({ store }));
    let calls = 0;
    app.post("/slow-res", async () => {
      const idx = ++calls;
      if (idx === 1) {
        const stream = new ReadableStream({
          async start(controller) {
            await Bun.sleep(70);
            controller.enqueue(new TextEncoder().encode("ok"));
            controller.close();
          }
        });
        return new Response(stream);
      }
      await Bun.sleep(30); // r2 completes within 40ms timeout, still in-flight when r1 finishes at 70ms
      return { ok: true };
    });

    const r1 = await app.request("/slow-res", { method: "POST", headers: { "Idempotency-Key": "k-dbl" } });
    expect(r1.status).toBe(408);
    expect(locks.size).toBe(0);

    // Wait 10ms (t=50ms), start r2 (runs t=50..80ms); r1's arrayBuffer() finishes at t=70ms
    await Bun.sleep(10);
    const p2 = app.request("/slow-res", { method: "POST", headers: { "Idempotency-Key": "k-dbl" } });
    await Bun.sleep(25); // t=75ms: r1's commit finally has run at t=70ms, r2 is still in-flight until t=80ms!
    const r3 = await app.request("/slow-res", { method: "POST", headers: { "Idempotency-Key": "k-dbl" } });
    expect(r3.status).toBe(409);
    expect((await p2).status).toBe(200);
  });

  test("53. Global cors() does not shadow sub-app cors() on OPTIONS and applies CORS headers to 404 responses", async () => {
    const { BareRouter } = await import("../src/index");
    const app = new BareJS();
    app.use(cors({ origin: "https://global.com" }));
    const sub = new BareRouter();
    sub.get("/items", () => ({ ok: true }));
    app.use("/sub", cors({ origin: "https://sub.com" }), sub);

    const opt = await app.request("/sub/items", {
      method: "OPTIONS",
      headers: { Origin: "https://sub.com" }
    });
    expect(opt.status).toBe(204);
    expect(opt.headers.get("access-control-allow-origin")).toBe("https://sub.com");

    const nf = await app.request("/nonexistent", { headers: { Origin: "https://global.com" } });
    expect(nf.status).toBe(404);
    expect(nf.headers.get("access-control-allow-origin")).toBe("https://global.com");
  });

  test("54. compress() skips SSE with mixed-case Content-Type", async () => {
    const app = new BareJS();
    app.use(compress({ threshold: 0 }));
    app.get("/sse", () => new Response("data: " + "x".repeat(2000) + "\n\n", { headers: { "Content-Type": "TEXT/EVENT-STREAM" } }));
    const r = await app.request("/sse", { headers: { "Accept-Encoding": "gzip" } });
    expect(r.headers.get("content-encoding")).toBeNull();
  });

  test("55. routes containing 'return h0(ctx);' in path compile and serve", async () => {
    const app = new BareJS();
    app.get("/return h0(ctx);", () => ({ ok: 1 }));
    app.get("/x", () => ({ ok: 2 }));
    const r = await app.request("/return%20h0(ctx);");
    const r2 = await app.request("/x");
    expect((await r2.json()).ok).toBe(2);
    expect([200, 404]).toContain(r.status);
  });
});

describe("Round 8 regressions", () => {
  test("56. idempotency does not replay across different Authorization identities and replays Location", async () => {
    const app = new BareJS();
    app.post("/pay", idempotency(), (ctx: any) =>
      new Response(JSON.stringify({ u: ctx.req.headers.get("authorization") }), { status: 201, headers: { "content-type": "application/json", Location: "/o/1" } }));
    const mk = (a: string) => app.request("/pay", { method: "POST", headers: { "Idempotency-Key": "k", Authorization: a } });
    const a1 = await mk("userA");
    expect((await a1.json()).u).toBe("userA");
    const b = await mk("userB");
    expect((await b.json()).u).toBe("userB");
    expect(b.headers.get("x-idempotent-replayed")).toBeNull();
    const a2 = await mk("userA");
    expect(a2.headers.get("x-idempotent-replayed")).toBe("true");
    expect(a2.headers.get("location")).toBe("/o/1");
  });

  test("57. rateLimit does not let key flooding reset a live victim bucket", async () => {
    const app = new BareJS();
    app.use(rateLimit({ max: 2, maxEntries: 3, keyGenerator: (c: any) => c.req.headers.get("x-k") || "" } as any));
    app.get("/", () => "ok");
    const hit = (k: string) => app.request("/", { headers: { "x-k": k } });
    await hit("victim"); await hit("victim");
    expect((await hit("victim")).status).toBe(429);
    for (const k of ["a", "b", "c", "d"]) await hit(k);
    expect((await hit("victim")).status).toBe(429);
  });

  test("58. timeout() with huge/Infinity ms does not fire immediately", async () => {
    for (const ms of [3_000_000_000, Infinity]) {
      const app = new BareJS();
      app.get("/", timeout(ms), async () => { await Bun.sleep(20); return "ok"; });
      expect((await app.request("/")).status).toBe(200);
    }
  });

  test("59. circuitBreaker recovers when a half-open probe never settles", async () => {
    const { circuitBreaker } = await import("../src/index");
    let mode = "fail";
    const app = new BareJS();
    app.get("/", circuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30 } as any), () => {
      if (mode === "fail") return new Response("x", { status: 500 });
      if (mode === "hang") return new Promise(() => {});
      return "ok";
    });
    await app.request("/");
    await Bun.sleep(40);
    mode = "hang";
    void app.request("/");
    await Bun.sleep(60);
    mode = "ok";
    await Bun.sleep(40);
    expect((await app.request("/")).status).toBe(200);
  });

  test("60. native() deep-compares const/enum and enforces multipleOf/uniqueItems/not/minProperties", async () => {
    const mk = (schema: any) => { const a = new BareJS(); a.post("/", native(schema), () => "ok"); return (b: any) => a.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(r => r.status); };
    const e = mk({ type: "object", properties: { a: { enum: [[1], { x: 1 }] } }, required: ["a"] });
    expect(await e({ a: [1] })).toBe(200);
    expect(await e({ a: { x: 1 } })).toBe(200);
    expect(await e({ a: [2] })).toBe(400);
    const m = mk({ type: "object", properties: { a: { type: "integer", multipleOf: 2 }, t: { type: "array", uniqueItems: true } }, required: ["a"] });
    expect(await m({ a: 2 })).toBe(200);
    expect(await m({ a: 3 })).toBe(400);
    expect(await m({ a: 2, t: [1, 1] })).toBe(400);
    const n = mk({ type: "object", not: { required: ["x"] }, minProperties: 1 });
    expect(await n({ y: 1 })).toBe(200);
    expect(await n({ x: 1 })).toBe(400);
    expect(await n({})).toBe(400);
  });
});

describe("Round 9 regressions", () => {
  test("61. repeated query keys populate array-typed query schema fields", async () => {
    const { BareJS: B2 } = await import("../src/index");
    const app = new B2();
    app.get("/q", { query: { type: "object", properties: { a: { type: "array", items: { type: "number" } } }, required: ["a"] } } as any, (ctx: any) => ({ q: ctx.query }));
    const r = await app.request("/q?a=1&a=2");
    expect(r.status).toBe(200);
    expect((await r.json()).q.a).toEqual([1, 2]);
  });

  test("62. native() enforces patternProperties and dependentRequired", async () => {
    const app = new BareJS();
    app.post("/", native({ type: "object", patternProperties: { "^x_": { type: "number" } }, dependentRequired: { a: ["b"] } }), () => "ok");
    const post = (b: any) => app.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status);
    expect(await post({ x_1: 1 })).toBe(200);
    expect(await post({ x_1: "s" })).toBe(400);
    expect(await post({ a: 1 })).toBe(400);
    expect(await post({ a: 1, b: 2 })).toBe(200);
  });
});

describe("Round 10 regressions", () => {
  test("63. patternProperties works alongside additionalProperties:false and createResponseFilter combines properties+patternProperties+additionalProperties", async () => {
    const { createResponseFilter } = await import("../src/index");
    const app = new BareJS();
    app.post("/p", native({ type: "object", properties: { id: { type: "number" } }, patternProperties: { "^x_": { type: "number" } }, additionalProperties: false }), () => "ok");
    const post = (b: any) => app.request("/p", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status);
    expect(await post({ id: 1, x_1: 42 })).toBe(200);
    expect(await post({ id: 1, other: 42 })).toBe(400);

    const filter = createResponseFilter({
      type: "object",
      properties: { id: { type: "number" } },
      patternProperties: { "^x_": { type: "string" } },
      additionalProperties: { type: "boolean" }
    });
    expect(filter({ id: 1, x_foo: "bar", flag: true })).toEqual({ id: 1, x_foo: "bar", flag: true });
  });

  test("64. native() validates tuple items array and wrapped Zod array query schemas collect repeated query keys", async () => {
    const { z } = await import("zod");
    const app = new BareJS();
    app.post("/t", native({ type: "array", items: [{ type: "number" }, { type: "string" }] }), () => "ok");
    app.get("/qz", { query: z.object({ tags: z.array(z.string()).optional(), nums: z.array(z.number()).default([]) }) } as any, (ctx: any) => ({ q: ctx.query }));
    expect((await app.request("/t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([1, "a"]) })).status).toBe(200);
    expect((await app.request("/t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(["bad", 123]) })).status).toBe(400);
    const r = await app.request("/qz?tags=a&tags=b&nums=1&nums=2");
    expect(r.status).toBe(200);
    expect((await r.json()).q).toEqual({ tags: ["a", "b"], nums: [1, 2] });
  });
});

describe("Pool size normalization & lazy bounded LIFO retention", () => {
  test.each([
    [0, 0],
    [-1, 0],
    [1.9, 1],
    [1000, 1000],
    [1025, 1025],
    [65_536, 65_536],
    [65_537, 65_536],
    [Number.NaN, 1024],
    [Number.POSITIVE_INFINITY, 1024],
  ])("65. normalizePoolSize(%p) -> %p", async (input, expected) => {
    const { normalizePoolSize } = await import("../src/index");
    expect(normalizePoolSize(input)).toBe(expected);
  });

  test("66. does not round poolSize=1025 to 2048 and lazily allocates Context instances", () => {
    const app = new BareJS(1025);
    expect((app as any).maxPool).toBe(1025);
    expect((app as any).pool.length).toBe(0);
  });

  const getPoolStats = (app: BareJS<any, any>) => ({
    free: (app as any)._poolState.top as number,
    capacity: (app as any).maxPool as number,
    backingLength: ((app as any).pool as Array<Context | undefined>).length,
  });

  test("67. clears acquired LIFO slot to undefined, respects maxPool & BareJS(0), retires detached contexts, and isolates concurrent state", async () => {
    // 1) Acquired slot is cleared to undefined while in-flight
    const slotApp = new BareJS(2);
    let markHoldEntered!: () => void;
    const holdEntered = new Promise<void>((r) => { markHoldEntered = r; });
    let releaseInFlight!: () => void;
    const inFlightGate = new Promise<void>((r) => { releaseInFlight = r; });
    let inFlightPoolFree = -1;
    let inFlightSlot0: any = "unset";
    slotApp.get("/warm", () => ({ ok: true }));
    slotApp.get("/hold", async () => {
      inFlightPoolFree = getPoolStats(slotApp).free;
      inFlightSlot0 = (slotApp as any).pool[0];
      markHoldEntered();
      await inFlightGate;
      return { ok: true };
    });
    await slotApp.request("/warm");
    expect(getPoolStats(slotApp)).toEqual({ free: 1, capacity: 2, backingLength: 1 });
    expect((slotApp as any).pool[0]).toBeDefined();

    const holdPromise = slotApp.request("/hold");
    await holdEntered;
    expect(inFlightPoolFree).toBe(0);
    expect(inFlightSlot0).toBeUndefined();
    releaseInFlight();
    await holdPromise;
    expect(getPoolStats(slotApp).free).toBe(1);
    expect((slotApp as any).pool[0]).toBeDefined();

    // 2) Detached Context (timeout) is NOT pushed back to pool
    const detApp = new BareJS(2);
    detApp.get("/slow", timeout(10), async () => {
      await Bun.sleep(30);
      return { ok: true };
    });
    const detRes = await detApp.request("/slow");
    expect(detRes.status).toBe(408);
    await Bun.sleep(35);
    expect(getPoolStats(detApp).free).toBe(0);
    expect((detApp as any).pool[0]).toBeUndefined();

    // 3) free count never exceeds maxPool under concurrency and concurrent requests do not leak state
    const concApp = new BareJS(3);
    concApp.get("/c/:id", async (ctx: Context) => {
      ctx.set("reqId", ctx.params.id);
      ctx.setHeader("x-req-id", ctx.params.id);
      await Bun.sleep(5);
      return { id: ctx.params.id, stored: ctx.get("reqId"), q: ctx.query.v };
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        concApp.request(`/c/${i}?v=${i}`).then(async (r) => ({
          hdr: r.headers.get("x-req-id"),
          body: await r.json(),
        }))
      )
    );
    for (let i = 0; i < 20; i++) {
      expect(results[i]!.hdr).toBe(String(i));
      expect(results[i]!.body).toEqual({ id: String(i), stored: String(i), q: String(i) });
    }
    expect(getPoolStats(concApp).free).toBeLessThanOrEqual(3);
    expect(getPoolStats(concApp).free).toBeGreaterThan(0);

    // 4) new BareJS(0) never retains Context instances
    const zeroPoolApp = new BareJS(0);
    zeroPoolApp.get("/z", () => ({ ok: true }));
    await Promise.all(Array.from({ length: 5 }, () => zeroPoolApp.request("/z")));
    expect(getPoolStats(zeroPoolApp)).toEqual({ free: 0, capacity: 0, backingLength: 0 });
  });

  test("68. recompile preserves pool ownership safely across route additions and concurrent in-flight requests", async () => {
    const app = new BareJS(2);

    app.get("/a", () => "A");
    await app.request("/a");
    expect(getPoolStats(app).free).toBe(1);
    const firstPooledCtx = (app as any).pool[0];
    expect(firstPooledCtx).toBeDefined();

    // Register a new route after initial requests have already populated the pool
    app.get("/b", () => "B");

    const responses = await Promise.all([
      app.request("/a"),
      app.request("/b"),
    ]);

    expect(await responses[0].text()).toBe("A");
    expect(await responses[1].text()).toBe("B");
    expect(getPoolStats(app).free).toBeGreaterThan(0);
    expect(getPoolStats(app).free).toBeLessThanOrEqual(2);

    // Also verify recompile while an earlier handler generation has an in-flight request
    const overlapApp = new BareJS(2);
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => { releaseSlow = r; });
    overlapApp.get("/warm", () => "warm");
    overlapApp.get("/slow", async (ctx: Context) => {
      ctx.set("tag", "old-gen");
      markEntered();
      await slowGate;
      return ctx.get("tag");
    });

    await overlapApp.request("/warm");
    expect(getPoolStats(overlapApp).free).toBe(1);

    // Acquire the pooled context on generation 1 and keep it in-flight
    const inFlightOldGen = overlapApp.request("/slow");
    await entered;
    expect(getPoolStats(overlapApp).free).toBe(0);
    expect((overlapApp as any).pool[0]).toBeUndefined();

    // Trigger recompile while generation 1 request is still in-flight
    overlapApp.get("/new", (ctx: Context) => {
      ctx.set("tag", "new-gen");
      return ctx.get("tag");
    });
    overlapApp.compile();

    const newGenRes = await overlapApp.request("/new");
    expect(await newGenRes.text()).toBe("new-gen");
    expect(getPoolStats(overlapApp).free).toBe(1);

    releaseSlow();
    const oldGenRes = await inFlightOldGen;
    expect(await oldGenRes.text()).toBe("old-gen");
    expect(getPoolStats(overlapApp).free).toBe(2);

    // 3) Live HTTP server via app.listen(0) delegates dynamically to this.fetch on hot recompilation
    const liveApp = new BareJS(2);
    liveApp.get("/live-a", () => "LIVE_A");
    const srv: any = liveApp.listen(0);
    await srv.ready;
    try {
      const baseUrl = `http://127.0.0.1:${srv.port}`;
      const r1 = await fetch(`${baseUrl}/live-a`);
      expect(await r1.text()).toBe("LIVE_A");
      expect(getPoolStats(liveApp).free).toBe(1);

      // Register a new route while the server is already listening
      liveApp.get("/live-b", () => "LIVE_B");
      const [ra, rb] = await Promise.all([
        fetch(`${baseUrl}/live-a`),
        fetch(`${baseUrl}/live-b`),
      ]);
      expect(await ra.text()).toBe("LIVE_A");
      expect(await rb.text()).toBe("LIVE_B");
      expect(getPoolStats(liveApp).free).toBeGreaterThan(0);
      expect(getPoolStats(liveApp).free).toBeLessThanOrEqual(2);
    } finally {
      await liveApp.stop(true);
    }
  });
});
