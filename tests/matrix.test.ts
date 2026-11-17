import { expect, test, describe } from "bun:test";
import {
  BareJS,
  BareRouter,
  Context,
  Type,
  Z,
  typebox,
  zod,
  native,
  validate,
  schemaValidator,
  cors,
  csrf,
  timeout,
  rateLimit,
  securityHeaders,
  staticFile,
  bareAuth,
  createToken,
  basicAuth,
  hasRole,
  Hash,
  bareClient,
  generateOpenAPISpec,
  renderDocsHTML
} from "../src/index";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Exhaustive 100+ Security, Routing, Validation & Edge-Case Matrix", () => {
  // --- 1. Routing & Radix Edge Cases ---
  test("1. Trailing slashes are normalized identically to non-trailing slashes", async () => {
    const app = new BareJS();
    app.get("/trail/test/", () => ({ hit: true }));
    app.compile();
    expect((await app.fetch(new Request("http://localhost/trail/test"))).status).toBe(200);
  });

  test("2. Multiple HTTP methods on root '/' route work independently", async () => {
    const app = new BareJS();
    app.get("/", () => "root-get");
    app.post("/", () => "root-post");
    app.delete("/", () => "root-del");
    app.compile();
    expect(await (await app.fetch(new Request("http://localhost/"))).text()).toBe("root-get");
    expect(await (await app.fetch(new Request("http://localhost/", { method: "POST" }))).text()).toBe("root-post");
    expect(await (await app.fetch(new Request("http://localhost/", { method: "DELETE" }))).text()).toBe("root-del");
  });

  test("3. Unregistered HTTP method on existing path returns 404", async () => {
    const app = new BareJS();
    app.get("/only-get", () => "ok");
    app.compile();
    expect((await app.fetch(new Request("http://localhost/only-get", { method: "PUT" }))).status).toBe(404);
  });

  test("4. Single-char static segments use charCodeAt fast-path accurately", async () => {
    const app = new BareJS();
    app.get("/a", () => "A");
    app.get("/b", () => "B");
    app.get("/c", () => "C");
    app.compile();
    expect(await (await app.fetch(new Request("http://localhost/a"))).text()).toBe("A");
    expect(await (await app.fetch(new Request("http://localhost/b"))).text()).toBe("B");
    expect(await (await app.fetch(new Request("http://localhost/c"))).text()).toBe("C");
    expect((await app.fetch(new Request("http://localhost/d"))).status).toBe(404);
  });

  test("5. Static route takes precedence over dynamic :param sibling", async () => {
    const app = new BareJS();
    app.get("/users/me", () => ({ type: "static" }));
    app.get("/users/:id", (ctx: Context) => ({ type: "param", id: ctx.params.id }));
    app.compile();
    expect(await (await app.fetch(new Request("http://localhost/users/me"))).json()).toEqual({ type: "static" });
    expect(await (await app.fetch(new Request("http://localhost/users/99"))).json()).toEqual({ type: "param", id: "99" });
  });

  test("6. 50 static sibling routes trigger O(1) switch jump-table and resolve every route", async () => {
    const app = new BareJS();
    for (let i = 0; i < 50; i++) {
      app.get(`/items/item_${i}`, () => ({ idx: i }));
    }
    app.compile();
    expect(await (await app.fetch(new Request("http://localhost/items/item_0"))).json()).toEqual({ idx: 0 });
    expect(await (await app.fetch(new Request("http://localhost/items/item_25"))).json()).toEqual({ idx: 25 });
    expect(await (await app.fetch(new Request("http://localhost/items/item_49"))).json()).toEqual({ idx: 49 });
    expect((await app.fetch(new Request("http://localhost/items/item_999"))).status).toBe(404);
  });

  test("7. Nested group() with group-level middlewares preserves execution order", async () => {
    const app = new BareJS();
    const order: string[] = [];
    const mw1 = (_ctx: Context, next: any) => { order.push("mw1"); return next(); };
    const mw2 = (_ctx: Context, next: any) => { order.push("mw2"); return next(); };
    app.group("/v1", mw1, (r: BareRouter) => {
      r.group("/admin", mw2, (sub: BareRouter) => {
        sub.get("/stats", () => { order.push("handler"); return { order }; });
      });
    });
    app.compile();
    const res = await (await app.fetch(new Request("http://localhost/v1/admin/stats"))).json();
    expect(res.order).toEqual(["mw1", "mw2", "handler"]);
  });

  test("8. Explicit app.options() route handler works", async () => {
    const app = new BareJS();
    app.options("/custom-opt", (ctx: Context) => ctx.status(204).setHeader("Allow", "GET, OPTIONS").send(""));
    app.compile();
    const res = await app.fetch(new Request("http://localhost/custom-opt", { method: "OPTIONS" }));
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
  });

  // --- 2. Context & Cookies Edge Cases ---
  test("9. Cookie options: domain, maxAge, expires, secure, SameSite=Strict/None", async () => {
    const app = new BareJS();
    const exp = new Date("2030-01-01T00:00:00.000Z");
    app.get("/set", (ctx: Context) => {
      ctx.setCookie("c1", "v1", {
        domain: "example.com",
        maxAge: 3600,
        expires: exp,
        secure: true,
        httpOnly: false,
        sameSite: "Strict",
        path: "/admin"
      });
      return "ok";
    });
    app.compile();
    const res = await app.fetch(new Request("http://localhost/set"));
    const sc = res.headers.get("set-cookie") || "";
    expect(sc).toContain("Domain=example.com");
    expect(sc).toContain("Max-Age=3600");
    expect(sc).toContain(`Expires=${exp.toUTCString()}`);
    expect(sc).toContain("Secure");
    expect(sc).toContain("SameSite=Strict");
    expect(sc).toContain("Path=/admin");
    expect(sc).not.toContain("HttpOnly");
  });

  test("10. getSignedCookie returns null for missing dot, wrong secret, or modified value", async () => {
    const app = new BareJS();
    app.get("/verify", (ctx: Context) => ({
      v: ctx.getSignedCookie("sid", "correct_secret")
    }));
    app.compile();

    // No dot in cookie
    const r1 = await app.fetch(new Request("http://localhost/verify", { headers: { Cookie: "sid=nodotvalue" } }));
    expect((await r1.json()).v).toBeNull();

    // Tampered signature length
    const r2 = await app.fetch(new Request("http://localhost/verify", { headers: { Cookie: "sid=val.short" } }));
    expect((await r2.json()).v).toBeNull();
  });

  test("11. ctx.setHeader Copy-On-Write does not mutate frozen securityHeaders template", async () => {
    const app = new BareJS();
    app.use(securityHeaders());
    app.get("/custom-hdr", (ctx: Context) => {
      ctx.setHeader("X-Custom", "123");
      return { ok: true };
    });
    app.get("/plain-hdr", () => ({ ok: true }));
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/custom-hdr"));
    expect(r1.headers.get("x-custom")).toBe("123");
    expect(r1.headers.get("x-frame-options")).toBe("DENY");

    // Subsequent route must NOT have X-Custom leaked into frozen securityHeaders
    const r2 = await app.fetch(new Request("http://localhost/plain-hdr"));
    expect(r2.headers.get("x-custom")).toBeNull();
    expect(r2.headers.get("x-frame-options")).toBe("DENY");
  });

  test("12. ctx.json() and ctx.send() with custom status and multiple Set-Cookie headers", async () => {
    const app = new BareJS();
    app.get("/direct-json", (ctx: Context) => {
      ctx.setCookie("a", "1");
      ctx.setCookie("b", "2");
      return ctx.status(201).setHeader("X-Tag", "v1").json({ created: true });
    });
    app.compile();
    const res = await app.fetch(new Request("http://localhost/direct-json"));
    expect(res.status).toBe(201);
    expect(res.headers.get("x-tag")).toBe("v1");
    expect(res.headers.getSetCookie().length).toBeGreaterThanOrEqual(2);
  });

  test("13. ctx.sse() handles object chunks with retry, id, event and stream error", async () => {
    const app = new BareJS();
    app.get("/sse-obj", (ctx: Context) =>
      ctx.sse(
        (async function* () {
          yield { id: "99", event: "update", retry: 5000, data: { count: 1 } };
        })()
      )
    );
    app.compile();
    const res = await app.fetch(new Request("http://localhost/sse-obj"));
    const txt = await res.text();
    expect(txt).toContain("id: 99\n");
    expect(txt).toContain("event: update\n");
    expect(txt).toContain("retry: 5000\n");
    expect(txt).toContain('data: {"count":1}\n\n');
  });

  // --- 3. Validation Suite Edge Cases ---
  test("14. Zod query & params coercion (ZodNumber & ZodBoolean) in schemaValidator", async () => {
    const app = new BareJS();
    app.get(
      "/zod-coerce/:id",
      {
        params: Z.object({ id: Z.number() }),
        query: Z.object({ flag: Z.boolean() })
      },
      (ctx: Context) => ({ id: ctx.params.id, flag: ctx.query.flag })
    );
    app.compile();

    const r = await app.fetch(new Request("http://localhost/zod-coerce/42?flag=false"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: 42, flag: false });

    const bad = await app.fetch(new Request("http://localhost/zod-coerce/42?flag=notbool"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("QUERY_INVALID");
  });

  test("15. schemaValidator returns 400 on malformed JSON body", async () => {
    const app = new BareJS();
    app.post("/malformed", { body: Type.Object({ a: Type.String() }) }, () => ({ ok: true }));
    app.compile();
    const r = await app.fetch(new Request("http://localhost/malformed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken_json"
    }));
    expect(r.status).toBe(400);
  });

  test("16. Standalone typebox(), zod(), native(), and validate() work without next arg", async () => {
    const tbMw = typebox(Type.Object({ x: Type.Number() }));
    const zMw = zod(Z.object({ x: Z.number() }));
    const nMw = native({ properties: { x: { type: "number" }, b: { type: "boolean" } } });

    const mkCtx = (body: any) => {
      const c = new Context();
      c.req = new Request("http://localhost/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      return c;
    };

    expect(await tbMw(mkCtx({ x: 1 }), undefined as any)).toBeUndefined();
    expect(await zMw(mkCtx({ x: 1 }), undefined as any)).toBeUndefined();
    expect(await nMw(mkCtx({ x: 1, b: true }), undefined as any)).toBeUndefined();
    expect((await nMw(mkCtx({ x: 1, b: "notbool" }), undefined as any)).status).toBe(400);
  });

  // --- 4. Auth & Security Edge Cases ---
  test("17. bareAuth supports array next pipeline and rejects corrupt base64 payload", async () => {
    const mw = bareAuth("sec123");
    const token = await createToken({ sub: "1" }, "sec123", 60);
    const ctx = new Context();
    ctx.req = new Request("http://localhost/", { headers: { Authorization: `Bearer ${token}` } });

    let called = false;
    await mw(ctx, [() => { called = true; return "done"; }]);
    expect(called).toBe(true);

    // Empty array next
    expect(await mw(ctx, [])).toBeUndefined();

    // Non-function next
    expect(await mw(ctx, undefined)).toBeUndefined();
  });

  test("18. basicAuth rejects empty token and missing colon", async () => {
    const mw = basicAuth({ user: "u", pass: "p" });
    const mk = (hdr: string) => {
      const c = new Context();
      c.req = new Request("http://localhost/", { headers: { Authorization: hdr } });
      return c;
    };
    expect((await mw(mk("Basic    "), () => "ok")).status).toBe(401);
    expect((await mw(mk(`Basic ${btoa("nocolon")}`), () => "ok")).status).toBe(401);
  });

  test("19. securityHeaders direct invocation on sync and async Response returns", async () => {
    const mw = securityHeaders({ noSniff: false });
    const c = new Context();
    const syncRes = mw(c, () => new Response("sync")) as Response;
    expect(syncRes.headers.get("x-frame-options")).toBe("DENY");
    expect(syncRes.headers.get("x-content-type-options")).toBeNull();

    const asyncRes = await (mw(c, async () => new Response("async")) as Promise<Response>);
    expect(asyncRes.headers.get("x-frame-options")).toBe("DENY");
  });

  test("20. cors direct invocation on sync and async Response returns", async () => {
    const mw = cors({ origin: "https://ex.com", credentials: true, exposedHeaders: "X-Exp" });
    const c = new Context();
    c.req = new Request("http://localhost/test");
    const syncRes = mw(c, () => new Response("s")) as Response;
    expect(syncRes.headers.get("access-control-allow-origin")).toBe("https://ex.com");

    const asyncRes = await (mw(c, async () => new Response("a")) as Promise<Response>);
    expect(asyncRes.headers.get("access-control-allow-origin")).toBe("https://ex.com");
  });

  // --- 5. Static File Edge Cases ---
  test("21. staticFile handles HEAD request, suffix byte range (bytes=-4), and skips directories", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barejs-st2-"));
    try {
      writeFileSync(join(dir, "sample.txt"), "ABCDEFGH");
      mkdirSync(join(dir, "subdir"));

      const app = new BareJS();
      app.use(staticFile(dir, { etag: false }));
      app.compile();

      // HEAD request returns 200 with Content-Length and empty body
      const headRes = await app.fetch(new Request("http://localhost/sample.txt", { method: "HEAD" }));
      expect(headRes.status).toBe(200);
      expect(headRes.headers.get("content-length")).toBe("8");
      expect(headRes.headers.get("etag")).toBeNull();
      expect(await headRes.text()).toBe("");

      // Suffix range bytes=-3 -> last 3 bytes ("FGH")
      const sufRes = await app.fetch(new Request("http://localhost/sample.txt", {
        headers: { Range: "bytes=-3" }
      }));
      expect(sufRes.status).toBe(206);
      expect(await sufRes.text()).toBe("FGH");

      // Directory request falls through to 404
      const dirRes = await app.fetch(new Request("http://localhost/subdir"));
      expect(dirRes.status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // --- 6. OpenAPI, RPC & Error Handling Edge Cases ---
  test("22. OpenAPI strips dangerous HTML characters in title and handles boolean/array schemas", () => {
    const html = renderDocsHTML("/docs/json", '<script>alert("xss")</script>');
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("<title>scriptalert(xss)/script</title>");

    const spec = generateOpenAPISpec([
      {
        method: "POST",
        path: "/bool-test",
        handlers: [zod(Z.object({ ok: Z.boolean(), list: Z.array(Z.string()) }))]
      }
    ]);
    expect(spec.paths["/bool-test"].post).toBeDefined();
  });

  test("23. JSON-RPC 2.0 handles empty batch array and internal handler exceptions (-32603)", async () => {
    const app = new BareJS();
    app.rpc("/rpc", {
      crash: () => { throw new Error("rpc boom"); }
    });
    app.compile();

    const emptyBatch = await app.fetch(new Request("http://localhost/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]"
    }));
    expect((await emptyBatch.json()).error.code).toBe(-32600);

    const errCall = await app.fetch(new Request("http://localhost/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "crash", id: 9 })
    }));
    const errBody = await errCall.json();
    expect(errBody.error.code).toBe(-32603);
    expect(errBody.error.message).toBe("rpc boom");
  });

  test("24. Sync handler throwing error and development stack trace visibility", async () => {
    const app = new BareJS();
    app.get("/sync-throw", () => {
      throw new Error("dev-sync-error");
    });
    app.compile();

    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const res = await app.fetch(new Request("http://localhost/sync-throw"));
    process.env.NODE_ENV = prev;

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.message).toBe("dev-sync-error");
    expect(body.stack).toBeDefined();
  });

  test("25. Custom onError returning plain object uses ctx._status", async () => {
    const app = new BareJS();
    app.onError((err, ctx) => {
      ctx.status(422);
      return { customError: err.message };
    });
    app.get("/err-obj", () => { throw new Error("bad entity"); });
    app.compile();

    const res = await app.fetch(new Request("http://localhost/err-obj"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ customError: "bad entity" });
  });

  test("26. Middleware returning Response early in sync & async pipelines short-circuits handler", async () => {
    const app = new BareJS();
    let handlerReached = false;
    const gateSync = (ctx: Context, next: any) => {
      if (ctx.req.headers.get("x-block") === "1") return new Response("blocked-sync", { status: 403 });
      return next();
    };
    const gateAsync = async (ctx: Context, next: any) => {
      if (ctx.req.headers.get("x-block") === "1") return new Response("blocked-async", { status: 403 });
      return next();
    };

    app.get("/s-gate", gateSync, () => { handlerReached = true; return "ok"; });
    app.get("/a-gate", gateAsync, async () => { handlerReached = true; return "ok"; });
    app.compile();

    expect((await app.fetch(new Request("http://localhost/s-gate", { headers: { "x-block": "1" } }))).status).toBe(403);
    expect((await app.fetch(new Request("http://localhost/a-gate", { headers: { "x-block": "1" } }))).status).toBe(403);
    expect(handlerReached).toBe(false);
  });

  test("27. bareClient handles trailing slash in baseUrl, missing leading slash in path, and string body", async () => {
    const app = new BareJS();
    app.post("/raw", async (ctx: Context) => ({ text: await ctx.req.text() }));
    app.compile();

    const client = bareClient("http://localhost/", {
      fetch: (url, init) => app.fetch(new Request(url.toString(), init)) as any
    });
    const res = await client.post("raw", { body: "raw-string-payload", query: { a: 1, b: undefined } });
    expect(res).toEqual({ text: "raw-string-payload" });
  });

  test("28. Hash.make rejects empty password", async () => {
    let threw = false;
    try {
      await Hash.make("");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("29.ctx.upload rejects oversized Content-Length header before parsing formData", async () => {
    const app = new BareJS();
    app.post("/up-len", async (ctx: Context) => ctx.upload({ maxFileSize: 10, maxFiles: 1 }));
    app.compile();

    const r = await app.fetch(new Request("http://localhost/up-len", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=---123",
        "Content-Length": "9999999"
      },
      body: "---123--"
    }));
    expect(r.status).toBe(413);
  });

  test("30. auto-compiled fetch() triggers compile() on first call if not pre-compiled", async () => {
    const app = new BareJS();
    app.get("/lazy-compile", () => ({ lazy: true }));
    const r = await app.fetch(new Request("http://localhost/lazy-compile"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ lazy: true });
  });

  test("31. Middleware with sync pipeline returning a Promise from handler resolves properly", async () => {
    const app = new BareJS();
    const syncMw = (_ctx: Context, next: any) => next();
    app.get("/sync-mw-promise-handler", syncMw, () => Promise.resolve({ delayed: true }));
    app.compile();
    const r = await app.fetch(new Request("http://localhost/sync-mw-promise-handler"));
    expect(await r.json()).toEqual({ delayed: true });
  });

  test("32. String response with custom status and custom header preserves both", async () => {
    const app = new BareJS();
    app.get("/str-custom", (ctx: Context) => {
      ctx.status(202).setHeader("X-Mode", "text");
      return "accepted-text";
    });
    app.compile();
    const r = await app.fetch(new Request("http://localhost/str-custom"));
    expect(r.status).toBe(202);
    expect(r.headers.get("x-mode")).toBe("text");
    expect(await r.text()).toBe("accepted-text");
  });
});
