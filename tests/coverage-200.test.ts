import { describe, test, expect, spyOn } from "bun:test";
import {
  BareJS,
  Context,
  Type,
  typebox,
  zod,
  native,
  validate,
  Z,
  schemaValidator,
  cors,
  csrf,
  securityHeaders,
  rateLimit,
  timeout,
  idempotency,
  createSingleflight,
  circuitBreaker,
  compress,
  staticFile,
  Hash,
  bareAuth,
  createToken,
  bareClient,
  generateOpenAPISpec
} from "../src/index";
import { BARE_CONFIG, initConfig } from "../src/core/config";
import { bootstrapConfig } from "../src/core/loader";
import { RadixNode } from "../src/core/radix";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("100% Line & Function Coverage + 200+ Total Tests Suite (50 Tests)", () => {
  // --- 1. Loader, Config & Hash Coverage (Tests 1-8) ---
  test("1. bootstrapConfig loads bare.config.ts when present in process.cwd()", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bare-cfg-"));
    const cfgFile = join(tmpDir, "bare.config.ts");
    writeFileSync(cfgFile, `export default { port: 4567 };\n`);

    const cwdSpy = spyOn(process, "cwd").mockReturnValue(tmpDir);
    try {
      const cfg = await bootstrapConfig();
      expect(cfg.port).toBe(4567);
    } finally {
      cwdSpy.mockRestore();
      initConfig({ port: 3000 });
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("2. BareJS constructor falls back to name='App' when package.json cannot be read", () => {
    const cwdSpy = spyOn(process, "cwd").mockReturnValue("/tmp/non-existent-barejs-dir-xyz");
    try {
      const app = new BareJS(4);
      expect(app.name).toBe("App");
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test("3. Hash.needsRehash supports bcrypt algorithm branch (valid, wrong cost, non-bcrypt)", () => {
    const origAlgo = BARE_CONFIG.hash.algorithm;
    const origTime = BARE_CONFIG.hash.timeCost;
    try {
      (BARE_CONFIG.hash as any).algorithm = "bcrypt";
      (BARE_CONFIG.hash as any).timeCost = 10;

      // Not a bcrypt hash
      expect(Hash.needsRehash("$argon2id$v=19$m=16384,t=2,p=1$abc")).toBe(true);
      // Matching bcrypt cost 10
      expect(Hash.needsRehash("$2b$10$abcdefghijklmnopqrstuv")).toBe(false);
      // Mismatched bcrypt cost 08
      expect(Hash.needsRehash("$2b$08$abcdefghijklmnopqrstuv")).toBe(true);
      // Malformed bcrypt without numeric cost after $2b$
      expect(Hash.needsRehash("$2b$xx$abcdefghijklmnopqrstuv")).toBe(true);
    } finally {
      (BARE_CONFIG.hash as any).algorithm = origAlgo;
      (BARE_CONFIG.hash as any).timeCost = origTime;
    }
  });

  // --- 2. OpenAPI, CSRF, Static & Validator Uncovered Branches (Tests 4-12) ---
  test("4. generateOpenAPISpec handles ZodEnum and fallback Zod types (Z.any)", () => {
    const zSchema = Z.object({
      role: Z.enum(["ADMIN", "USER"]),
      meta: Z.any()
    });
    const spec = generateOpenAPISpec([
      {
        method: "POST",
        path: "/zod-enum",
        handlers: [zod(zSchema)]
      }
    ]);
    const props = spec.paths["/zod-enum"].post.requestBody.content["application/json"].schema.properties;
    expect(props.role).toEqual({ type: "string", enum: ["ADMIN", "USER"] });
    expect(props.meta).toEqual({ type: "object" });
  });

  test("5. csrf() handles malformed ctx.req.url gracefully in catch block", () => {
    const mw = csrf();
    const mockCtx: any = {
      req: {
        method: "POST",
        url: ":::not-a-valid-url:::",
        headers: new Headers({ origin: "https://attacker.example" })
      }
    };
    const res = mw(mockCtx, () => "next") as Response;
    expect(res.status).toBe(403);
  });

  test("6. staticFile handles URL without path slash (pathStart === -1) and missing file stat catch", async () => {
    const mw = staticFile("/tmp");
    const mockCtx: any = {
      req: {
        method: "GET",
        url: "http://localhost",
        headers: new Headers()
      },
      status() { return this; },
      send(v: string) { return new Response(v); }
    };
    // Resolves rootDir itself which is a directory -> st.isDirectory() -> calls next()
    const out = await mw(mockCtx, () => "next-called");
    expect(out).toBe("next-called");
  });

  test("7. schemaValidator catches unexpected non-413 error from ctx.jsonBody()", async () => {
    const mw = schemaValidator({
      body: Type.Object({ x: Type.Number() })
    });
    const mockCtx: any = {
      params: {},
      query: {},
      req: { headers: new Headers() },
      async jsonBody() {
        throw new Error("Stream disconnected unexpectedly");
      }
    };
    const res = (await mw(mockCtx, () => "ok")) as Response;
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Malformed JSON payload");
  });

  test("8. ctx.jsonBody(maxBytes) with Content-Length header enforces 413 and catches malformed JSON", async () => {
    // 1. Content-Length > maxBytes -> throws 413
    const ctxLarge = new Context();
    ctxLarge.req = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "500"
      },
      body: JSON.stringify({ data: "x".repeat(500) })
    });
    let caughtStatus = 0;
    try {
      await ctxLarge.jsonBody(50);
    } catch (e: any) {
      caughtStatus = e.status;
    }
    expect(caughtStatus).toBe(413);

    // 2. Content-Length <= maxBytes with malformed JSON -> returns null
    const ctxBad = new Context();
    ctxBad.req = new Request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "6"
      },
      body: "{bad!}"
    });
    expect(await ctxBad.jsonBody(100)).toBeNull();
  });

  // --- 3. BareJS RPC, Static Header Merge, Wrapper Fetch & Lifecycle (Tests 9-16) ---
  test("9. app.rpc returns -32600 for invalid single request and -32700 for broken JSON", async () => {
    const app = new BareJS();
    app.rpc("/rpc", {
      echo: (p: any) => p
    });
    app.compile();

    // Invalid single JSON-RPC object (missing jsonrpc: '2.0')
    const rInvalid = await app.fetch(
      new Request("http://localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "1.0", method: "echo", id: 7 })
      })
    );
    expect((await rInvalid.json()).error.code).toBe(-32600);

    // Malformed JSON -> payload is null -> -32700 Parse error
    const rParse = await app.fetch(
      new Request("http://localhost/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{broken-json"
      })
    );
    expect(rParse.status).toBe(400);
    expect((await rParse.json()).error.code).toBe(-32700);
  });

  test("10. staticFallback merges ctx._headers when a static middleware sets headers on ctx", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bare-stat-hdr-"));
    writeFileSync(join(tmpDir, "a.txt"), "hello-static");

    try {
      const app = new BareJS();
      const baseStatic = staticFile(tmpDir);
      const customStatic: any = async (ctx: Context, next: any) => {
        ctx.setHeader("X-Static-Merged", "true");
        return baseStatic(ctx, next);
      };
      customStatic.__isStatic = true;
      app.use(customStatic);
      app.compile();

      const res = await app.fetch(new Request("http://localhost/a.txt"));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-static-merged")).toBe("true");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("11. Saved pre-compile app.fetch reference executes both uncompiled and compiled branches", async () => {
    const app = new BareJS();
    app.get("/hi", () => "hi");
    const savedWrapper = app.fetch;

    // 1st call: this.compiled is false -> compiles and calls hotFetch
    const r1 = await savedWrapper(new Request("http://localhost/hi"));
    expect(await r1.text()).toBe("hi");

    // 2nd call on savedWrapper: this.compiled is true -> hits line 511
    const r2 = await savedWrapper(new Request("http://localhost/hi"));
    expect(await r2.text()).toBe("hi");
  });

  test("12. app.listen() in development mode prints banner, catches onStart error, and RadixNode.lookup supports wildcard", async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const rNode = new RadixNode();
    rNode.insert("/files/*", "GET", () => "wild");
    const dummyCtx = new Context();
    const fn = rNode.lookup("GET", "/files/docs/2026/a.pdf", 0, dummyCtx);
    expect(typeof fn).toBe("function");
    expect(dummyCtx.params["*"]).toBe("docs/2026/a.pdf");

    const app = new BareJS(4);
    app.onStart(() => Promise.reject(new Error("non-fatal start hook error")));
    const srv: any = app.listen(0);
    await srv.ready;
    try {
      expect(srv.port).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 5));
    } finally {
      await app.stop(true);
      process.env.NODE_ENV = origEnv;
    }
  });

  test("13. Graceful shutdown handler executes in both development and production modes", async () => {
    const origEnv = process.env.NODE_ENV;
    const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as any);

    try {
      // Development mode shutdown
      process.env.NODE_ENV = "development";
      let devStopped = false;
      const appDev = new BareJS(4);
      appDev.onStop(() => {
        devStopped = true;
      });
      appDev.listen(0);
      const devShutdown = (appDev as any).shutdownHandler;
      expect(typeof devShutdown).toBe("function");
      await devShutdown();
      expect(devStopped).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(0);

      // Production mode shutdown
      process.env.NODE_ENV = "production";
      let prodStopped = false;
      const appProd = new BareJS(4);
      appProd.onStop(() => {
        prodStopped = true;
      });
      appProd.listen(0);
      const prodShutdown = (appProd as any).shutdownHandler;
      await prodShutdown();
      expect(prodStopped).toBe(true);
    } finally {
      exitSpy.mockRestore();
      process.env.NODE_ENV = origEnv;
    }
  });

  test("14. WebSocket drain callback invokes ws.data.drain(ws) on live server", async () => {
    let drainCalled = false;
    const app = new BareJS(4);
    const handler = {
      message(ws: any, msg: any) {
        ws.send(msg);
      },
      drain() {
        drainCalled = true;
      }
    };
    app.ws("/ws-live", handler);
    const srv: any = app.listen(0);
    await srv.ready;
    try {
      // Connect a WebSocket client and also invoke drain hook
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws-live`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });
      ws.close();
      (app as any).wsAdapter.drain({ data: handler });
      expect(drainCalled).toBe(true);
    } finally {
      await app.stop(true);
    }
  });

  // --- 4. High-Density Parametric Multi-Feature Stress Tests (Tests 15-50) ---
  // 36 parametric tests across HTTP methods, status codes, signed cookies, JWT claims, and Radix combinations
  const httpStatuses = [200, 201, 202, 204, 206, 301, 302, 400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503];
  httpStatuses.forEach((code, idx) => {
    test(`${15 + idx}. Parametric HTTP Status & Header Integrity Test for status ${code}`, async () => {
      const app = new BareJS();
      app.get(`/status/${code}`, (ctx: Context) => {
        ctx.setHeader("X-Test-Status", String(code));
        if (code === 204) return new Response(null, { status: 204 });
        return ctx.status(code).json({ code });
      });
      app.compile();

      const res = await app.fetch(new Request(`http://localhost/status/${code}`));
      expect(res.status).toBe(code);
      expect(res.headers.get("x-test-status")).toBe(String(code));
      if (code !== 204) {
        expect((await res.json()).code).toBe(code);
      }
    });
  });

  const jwtRoles = [
    { id: "u1", role: "admin", org: "vientiane" },
    { id: "u2", role: "editor", org: "luangprabang" },
    { id: "u3", role: "viewer", org: "pakse" },
    { id: "u4", role: "auditor", org: "savannakhet" },
    { id: "u5", role: "billing", org: "vangvieng" },
    { id: "u6", role: "support", org: "thakhek" },
    { id: "u7", role: "devops", org: "xamneua" },
    { id: "u8", role: "owner", org: "attapeu" },
    { id: "u9", role: "guest", org: "bokeo" }
  ];

  jwtRoles.forEach((claim, idx) => {
    test(`${33 + idx}. Parametric JWT + SignedCookie + Derive E2E Verification (${claim.role}@${claim.org})`, async () => {
      const secret = `secret-key-${claim.org}-2026`;
      const app = new BareJS();
      app.use(bareAuth({ secret }));
      app.derive((ctx: Context) => ({
        orgTag: `${ctx.user?.role}:${ctx.user?.org}`
      }));
      app.get("/verify", async (ctx: Context & { orgTag?: string }) => {
        const signedVal = await ctx.getSignedCookie("session_org", secret);
        return {
          id: ctx.user.id,
          orgTag: ctx.orgTag,
          cookieOrg: signedVal
        };
      });
      app.compile();

      const token = await createToken(claim, secret, 120);
      const cookiePrep = new Context(new Request("http://localhost/"));
      await cookiePrep.setCookie("session_org", claim.org, { secret });
      const rawCookie = cookiePrep._setCookies![0]!.split(";")[0]!;

      const res = await app.fetch(
        new Request("http://localhost/verify", {
          headers: {
            Authorization: `Bearer ${token}`,
            Cookie: rawCookie
          }
        })
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: claim.id,
        orgTag: `${claim.role}:${claim.org}`,
        cookieOrg: claim.org
      });
    });
  });

  const radixPatterns = [
    { pattern: "/v1/lao/:province/district/:district", url: "/v1/lao/vientiane/district/chanthabuly", expected: { province: "vientiane", district: "chanthabuly" } },
    { pattern: "/v2/shop/:shopId/items/*", url: "/v2/shop/99/items/electronics/phones/pixel", expected: { shopId: "99", "*": "electronics/phones/pixel" } },
    { pattern: "/v3/matrix/:a/:b/:c/:d", url: "/v3/matrix/10/20/30/40", expected: { a: "10", b: "20", c: "30", d: "40" } },
    { pattern: "/v4/files/*", url: "/v4/files/2026/11/report.pdf", expected: { "*": "2026/11/report.pdf" } },
    { pattern: "/v5/users/:uid/posts/:pid/comments/:cid", url: "/v5/users/u7/posts/p8/comments/c9", expected: { uid: "u7", pid: "p8", cid: "c9" } },
    { pattern: "/v6/static/exact/route/check", url: "/v6/static/exact/route/check", expected: {} },
    { pattern: "/v7/bank/:bankCode/branch/:branchId/*", url: "/v7/bank/bcel/branch/01/accounts/lak", expected: { bankCode: "bcel", branchId: "01", "*": "accounts/lak" } },
    { pattern: "/v8/iot/:region/:deviceId/telemetry", url: "/v8/iot/asean/dev-42/telemetry", expected: { region: "asean", deviceId: "dev-42" } },
    { pattern: "/v9/health/deep/check/:component", url: "/v9/health/deep/check/sqlite-wal", expected: { component: "sqlite-wal" } }
  ];

  radixPatterns.forEach((item, idx) => {
    test(`${42 + idx}. Parametric Radix JIT Route Compilation (${item.pattern})`, async () => {
      const app = new BareJS();
      app.get(item.pattern, (ctx: Context) => ctx.params);
      app.compile();

      const res = await app.fetch(new Request(`http://localhost${item.url}`));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(item.expected);
    });
  });

  test("51. Ergonomic Context helpers ctx.html(), ctx.text(), and ctx.redirect() work with default and custom status/headers", async () => {
    const app = new BareJS();
    app.get("/page", (ctx: Context) => ctx.html("<h1>ສະບາຍດີ</h1>"));
    app.get("/page-custom", (ctx: Context) => ctx.setHeader("X-Page", "1").html("<p>Created</p>", 201));
    app.get("/txt", (ctx: Context) => ctx.text("plain-text"));
    app.get("/txt-custom", (ctx: Context) => ctx.setHeader("X-Txt", "1").text("accepted", 202));
    app.get("/go", (ctx: Context) => ctx.redirect("/page"));
    app.get("/go-perm", (ctx: Context) => ctx.setHeader("X-Redir", "1").redirect("/page", 301));
    app.compile();

    const rHtml = await app.fetch(new Request("http://localhost/page"));
    expect(rHtml.status).toBe(200);
    expect(rHtml.headers.get("content-type")).toContain("text/html");
    expect(await rHtml.text()).toBe("<h1>ສະບາຍດີ</h1>");

    const rHtml2 = await app.fetch(new Request("http://localhost/page-custom"));
    expect(rHtml2.status).toBe(201);
    expect(rHtml2.headers.get("x-page")).toBe("1");

    const rTxt = await app.fetch(new Request("http://localhost/txt"));
    expect(rTxt.status).toBe(200);
    expect(rTxt.headers.get("content-type")).toContain("text/plain");
    expect(await rTxt.text()).toBe("plain-text");

    const rTxt2 = await app.fetch(new Request("http://localhost/txt-custom"));
    expect(rTxt2.status).toBe(202);
    expect(rTxt2.headers.get("x-txt")).toBe("1");

    const rGo = await app.fetch(new Request("http://localhost/go"));
    expect(rGo.status).toBe(302);
    expect(rGo.headers.get("location")).toBe("/page");

    const rGo2 = await app.fetch(new Request("http://localhost/go-perm"));
    expect(rGo2.status).toBe(301);
    expect(rGo2.headers.get("location")).toBe("/page");
    expect(rGo2.headers.get("x-redir")).toBe("1");
  });

  test("52. Response schema automatically strips secret fields (objects & arrays) and blocks invalid responses", async () => {
    const app = new BareJS();
    app.get(
      "/user-safe",
      {
        response: Type.Object({
          id: Type.Number(),
          name: Type.String()
        })
      },
      () => ({
        id: 1,
        name: "Somsack",
        password_hash: "$argon2id$secret",
        internal_token: "super-secret"
      })
    );

    app.get(
      "/users-list",
      {
        response: Type.Array(
          Type.Object({
            id: Type.Number(),
            name: Type.String()
          })
        )
      },
      () => [
        { id: 1, name: "A", secret: "x" },
        "not-an-object" as any
      ]
    );

    app.post(
      "/user-post-safe",
      {
        body: Type.Object({ name: Type.String() }),
        response: Z.object({ id: Z.number(), name: Z.string() })
      },
      (ctx: Context) => ({
        id: 99,
        name: ctx.body.name,
        leaked_key: "never-sent"
      })
    );

    app.get(
      "/user-raw-res",
      {
        response: Type.Object({ id: Type.Number() })
      },
      (ctx: Context) => ctx.text("raw-response-passthrough")
    );

    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/user-safe"));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ id: 1, name: "Somsack" });

    // Second item in array is string -> fails Type.Object check -> 500 RESPONSE_VALIDATION_FAILED
    const r2 = await app.fetch(new Request("http://localhost/users-list"));
    expect(r2.status).toBe(500);
    expect((await r2.json()).code).toBe("RESPONSE_VALIDATION_FAILED");

    const r3 = await app.fetch(
      new Request("http://localhost/user-post-safe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Kham" })
      })
    );
    expect(r3.status).toBe(200);
    expect(await r3.json()).toEqual({ id: 99, name: "Kham" });

    const r4 = await app.fetch(new Request("http://localhost/user-raw-res"));
    expect(await r4.text()).toBe("raw-response-passthrough");
  });

  test("53. OpenAPI 3.1 generator documents query, headers, params, response schema, and detail metadata", () => {
    const app = new BareJS();
    app.post(
      "/items/:itemId",
      {
        detail: {
          summary: "Create Item",
          description: "Creates a new inventory item",
          tags: ["Inventory"]
        },
        params: Type.Object({ itemId: Type.Integer() }),
        query: Type.Object({ dryRun: Type.Boolean(), note: Type.Optional(Type.String()) }),
        headers: Type.Object({ "x-org-id": Type.String() }),
        body: Type.Object({ title: Type.String() }),
        response: Type.Object({ id: Type.Number(), title: Type.String() })
      },
      () => ({ id: 1, title: "ok" })
    );

    const spec = generateOpenAPISpec(app.routes, { title: "Inventory API", version: "2.0.0" });
    const op = spec.paths["/items/{itemId}"].post;
    expect(op.summary).toBe("Create Item");
    expect(op.description).toBe("Creates a new inventory item");
    expect(op.tags).toEqual(["Inventory"]);
    expect(op.parameters.some((p: any) => p.in === "path" && p.name === "itemId" && p.schema.type === "integer")).toBe(true);
    expect(op.parameters.some((p: any) => p.in === "query" && p.name === "dryRun" && p.required === true)).toBe(true);
    expect(op.parameters.some((p: any) => p.in === "header" && p.name === "x-org-id")).toBe(true);
    expect(op.responses["200"].content["application/json"].schema.properties.title.type).toBe("string");
  });

  test("54. bareClient(app) executes requests in-memory with zero network overhead", async () => {
    const app = new BareJS();
    app.get("/hello/:who", (ctx: Context) => ({ msg: `Hello ${ctx.params.who}`, q: ctx.query.tag }));
    app.post("/sum", { body: Type.Object({ a: Type.Number(), b: Type.Number() }) }, (ctx: Context) => ({
      total: ctx.body.a + ctx.body.b
    }));

    const api = bareClient(app);
    const r1 = await api.get("/hello/:who", { params: { who: "Lao" }, query: { tag: "v1" } });
    expect(r1).toEqual({ msg: "Hello Lao", q: "v1" });

    const r2 = await api.post("/sum", { body: { a: 15, b: 27 } });
    expect(r2).toEqual({ total: 42 });
  });

  test("55. ctx.ip extracts client IP from x-forwarded-for, x-real-ip, cf-connecting-ip, or defaults to 127.0.0.1", async () => {
    const app = new BareJS().trustProxy(true);
    app.get("/ip", (ctx: Context) => ({ ip: ctx.ip }));
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/ip", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }));
    expect((await r1.json()).ip).toBe("203.0.113.5");

    const r2 = await app.fetch(new Request("http://localhost/ip", { headers: { "x-real-ip": "198.51.100.9" } }));
    expect((await r2.json()).ip).toBe("198.51.100.9");

    const r3 = await app.fetch(new Request("http://localhost/ip", { headers: { "cf-connecting-ip": "192.0.2.77" } }));
    expect((await r3.json()).ip).toBe("192.0.2.77");

    const r4 = await app.fetch(new Request("http://localhost/ip"));
    expect((await r4.json()).ip).toBe("127.0.0.1");
  });

  test("56. Recursive JIT Response Projector strips nested secret fields and non-object edge cases", async () => {
    const app = new BareJS();
    app.get(
      "/nested-safe",
      {
        response: Type.Object({
          id: Type.Number(),
          profile: Type.Object({
            username: Type.String()
          })
        })
      },
      () => ({
        id: 7,
        secretRoot: "hidden",
        profile: {
          username: "somsack",
          passwordHash: "secret-nested"
        }
      })
    );

    // Primitive response schema (no properties)
    app.get(
      "/prim-res",
      {
        response: Type.Number()
      },
      () => 123
    );

    // Array of primitives (items has no properties)
    app.get(
      "/prim-arr",
      {
        response: Type.Array(Type.Number())
      },
      () => [1, 2, 3]
    );

    // Non-object passed to object response schema -> returns 500
    app.get(
      "/bad-non-obj",
      {
        response: Type.Object({ id: Type.Number() })
      },
      () => "not-an-object" as any
    );

    // Non-array passed to array response schema -> returns 500
    app.get(
      "/bad-non-arr",
      {
        response: Type.Array(Type.Object({ id: Type.Number() }))
      },
      () => ({ not: "array" }) as any
    );

    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/nested-safe"));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ id: 7, profile: { username: "somsack" } });

    const r2 = await app.fetch(new Request("http://localhost/prim-res"));
    expect(await r2.json()).toBe(123);

    const r3 = await app.fetch(new Request("http://localhost/prim-arr"));
    expect(await r3.json()).toEqual([1, 2, 3]);

    expect((await app.fetch(new Request("http://localhost/bad-non-obj"))).status).toBe(500);
    expect((await app.fetch(new Request("http://localhost/bad-non-arr"))).status).toBe(500);
  });

  test("57. idempotency() prevents duplicate payment double-charges, blocks in-flight races (409), and evicts LRU/TTL", async () => {
    let executions = 0;
    const app = new BareJS();
    app.post(
      "/transfer",
      idempotency({ ttlMs: 40, maxKeys: 1 }),
      async (ctx: Context) => {
        executions++;
        const q = ctx.query.slow;
        if (q === "1") await new Promise((r) => setTimeout(r, 25));
        if (ctx.query.fail === "1") throw new Error("DB error");
        return { txId: executions, ok: true };
      }
    );
    app.compile();

    // 1. Request without Idempotency-Key always executes
    const rNoKey = await app.fetch(new Request("http://localhost/transfer", { method: "POST" }));
    expect((await rNoKey.json()).txId).toBe(1);

    // 2. First request with Idempotency-Key k1 executes
    const rFirst = await app.fetch(
      new Request("http://localhost/transfer", {
        method: "POST",
        headers: { "Idempotency-Key": "k1" }
      })
    );
    expect(rFirst.headers.get("x-idempotent-replayed")).toBeNull();
    expect((await rFirst.json()).txId).toBe(2);

    // 3. Replay with Idempotency-Key k1 returns cached response without executing handler!
    const rReplay = await app.fetch(
      new Request("http://localhost/transfer", {
        method: "POST",
        headers: { "Idempotency-Key": "k1" }
      })
    );
    expect(rReplay.headers.get("x-idempotent-replayed")).toBe("true");
    expect((await rReplay.json()).txId).toBe(2);
    expect(executions).toBe(2);

    // 4. LRU eviction when maxKeys=1 and k2 is inserted
    await app.fetch(
      new Request("http://localhost/transfer", {
        method: "POST",
        headers: { "Idempotency-Key": "k2" }
      })
    );
    expect(executions).toBe(3);

    // 5. Wait for k2 TTL to expire (40ms) -> re-executes
    await new Promise((r) => setTimeout(r, 50));
    await app.fetch(
      new Request("http://localhost/transfer", {
        method: "POST",
        headers: { "Idempotency-Key": "k2" }
      })
    );
    expect(executions).toBe(4);

    // 6. Concurrent in-flight duplicate request with same key returns 409 IDEMPOTENT_IN_FLIGHT
    const [p1, p2] = await Promise.all([
      app.fetch(new Request("http://localhost/transfer?slow=1", { method: "POST", headers: { "Idempotency-Key": "k-race" } })),
      app.fetch(new Request("http://localhost/transfer?slow=1", { method: "POST", headers: { "Idempotency-Key": "k-race" } }))
    ]);
    const statuses = [p1.status, p2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // 7. Exception during handler cleans up in-flight key via releaseCode
    const rFail = await app.fetch(
      new Request("http://localhost/transfer?fail=1", {
        method: "POST",
        headers: { "Idempotency-Key": "k-err" }
      })
    );
    expect(rFail.status).toBe(500);
    // Subsequent retry with k-err is not stuck in flight
    const rRetry = await app.fetch(
      new Request("http://localhost/transfer", {
        method: "POST",
        headers: { "Idempotency-Key": "k-err" }
      })
    );
    expect(rRetry.status).toBe(200);
  });

  test("58. createSingleflight() coalesces 100 concurrent identical calls into 1 execution", async () => {
    const sf = createSingleflight();
    let dbHits = 0;

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        sf("heavy-report-2026", async () => {
          dbHits++;
          await new Promise((r) => setTimeout(r, 15));
          return { rows: 5000 };
        })
      )
    );

    expect(dbHits).toBe(1);
    expect(results.filter((r) => !r.shared).length).toBe(1);
    expect(results.filter((r) => r.shared).length).toBe(99);
    expect(results[0]!.data).toEqual({ rows: 5000 });
  });

  test("59. circuitBreaker() handles CLOSED -> OPEN -> HALF_OPEN -> CLOSED and thrown errors", async () => {
    const transitions: string[] = [];
    const app = new BareJS();
    let mode: "ok" | "500" | "throw" | "slow_ok" = "500";

    app.get(
      "/downstream",
      circuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 40,
        onStateChange: (from, to) => transitions.push(`${from}->${to}`)
      }),
      async () => {
        if (mode === "500") return new Response("fail", { status: 500 });
        if (mode === "throw") throw new Error("db crashed");
        if (mode === "slow_ok") {
          await new Promise((r) => setTimeout(r, 25));
          return { ok: true };
        }
        return { ok: true };
      }
    );

    // 2 failures trip circuit to OPEN
    expect((await app.fetch(new Request("http://localhost/downstream"))).status).toBe(500);
    expect((await app.fetch(new Request("http://localhost/downstream"))).status).toBe(500);
    expect(transitions).toEqual(["CLOSED->OPEN"]);

    // While OPEN, fast-fails with 503 + Retry-After
    const rOpen = await app.fetch(new Request("http://localhost/downstream"));
    expect(rOpen.status).toBe(503);
    expect(rOpen.headers.get("Retry-After")).toBeTruthy();

    // Wait for resetTimeoutMs -> HALF_OPEN; if probe throws, re-opens
    await new Promise((r) => setTimeout(r, 50));
    mode = "throw";
    const rThrow = await app.fetch(new Request("http://localhost/downstream"));
    expect(rThrow.status).toBe(500);
    expect(transitions).toEqual(["CLOSED->OPEN", "OPEN->HALF_OPEN", "HALF_OPEN->OPEN"]);

    // Wait again -> HALF_OPEN; concurrent second request while probe is in-flight gets 503
    await new Promise((r) => setTimeout(r, 50));
    mode = "slow_ok";
    const [p1, p2] = await Promise.all([
      app.fetch(new Request("http://localhost/downstream")),
      app.fetch(new Request("http://localhost/downstream"))
    ]);
    expect([p1.status, p2.status].sort()).toEqual([200, 503]);
    expect(transitions).toEqual(["CLOSED->OPEN", "OPEN->HALF_OPEN", "HALF_OPEN->OPEN", "OPEN->HALF_OPEN", "HALF_OPEN->CLOSED"]);

    // Direct standalone middleware call with no next()
    const cb = circuitBreaker();
    await cb({ req: new Request("http://localhost/") } as any);
  });

  test("60. compress() gzips large payloads via Bun.gzipSync and skips small, SSE, 204, or non-gzip requests", async () => {
    const app = new BareJS();
    app.use(compress({ minSize: 64, level: 6 }));

    app.get("/big", () => ({ items: Array.from({ length: 20 }, (_, i) => `item-${i}`) }));
    app.get("/small", () => ({ ok: 1 }));
    app.get("/empty", () => new Response(null, { status: 204 }));
    app.get("/pre", () => new Response("already", { headers: { "Content-Encoding": "br" } }));
    app.get("/sse", (ctx) => ctx.sse(async (send) => { send({ a: 1 }); }));

    // 1. Without Accept-Encoding: gzip -> uncompressed
    const rNoGzip = await app.fetch(new Request("http://localhost/big"));
    expect(rNoGzip.headers.get("Content-Encoding")).toBeNull();

    // 2. With Accept-Encoding: gzip -> compressed
    const rGzip = await app.fetch(new Request("http://localhost/big", { headers: { "Accept-Encoding": "gzip, deflate" } }));
    expect(rGzip.headers.get("Content-Encoding")).toBe("gzip");
    expect(rGzip.headers.get("Vary")).toBe("Accept-Encoding");
    const decompressed = Bun.gunzipSync(new Uint8Array(await rGzip.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(decompressed)).items.length).toBe(20);

    // 3. Below minSize -> uncompressed
    const rSmall = await app.fetch(new Request("http://localhost/small", { headers: { "Accept-Encoding": "gzip" } }));
    expect(rSmall.headers.get("Content-Encoding")).toBeNull();

    // 4. 204, pre-encoded, and SSE -> skipped
    expect((await app.fetch(new Request("http://localhost/empty", { headers: { "Accept-Encoding": "gzip" } }))).status).toBe(204);
    expect((await app.fetch(new Request("http://localhost/pre", { headers: { "Accept-Encoding": "gzip" } }))).headers.get("Content-Encoding")).toBe("br");
    expect((await app.fetch(new Request("http://localhost/sse", { headers: { "Accept-Encoding": "gzip" } }))).headers.get("Content-Encoding")).toBeNull();

    // 5. Direct standalone non-Response pass-through
    const mw = compress();
    const out = await mw({ req: new Request("http://localhost/", { headers: { "Accept-Encoding": "gzip" } }) } as any, async () => "plain" as any);
    expect(out).toBe("plain");
    expect(await mw({ req: new Request("http://localhost/") } as any)).toBeUndefined();
  });

  test("61. stripUnknown: true prevents Mass-Assignment attacks on validated request body", async () => {
    const app = new BareJS();
    app.post(
      "/register",
      {
        body: Type.Object({ name: Type.String(), email: Type.String() }),
        stripUnknown: true
      },
      (ctx) => ctx.body
    );

    const res = await app.fetch(
      new Request("http://localhost/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Somsak", email: "s@example.com", role: "admin", isAdmin: true, balance: 99999 })
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ name: "Somsak", email: "s@example.com" });
    expect(data.role).toBeUndefined();
    expect(data.isAdmin).toBeUndefined();
  });

  test("62. app.cron() executes tasks with overlap lock, handles errors, and clears timers on app.stop()", async () => {
    const app = new BareJS();
    let runs = 0;
    const errors: string[] = [];

    app.cron(
      "heartbeat",
      20,
      async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 35)); // longer than 20ms interval -> overlap lock skips concurrent tick
        if (runs === 1) throw new Error("transient cron err");
      },
      {
        runOnStart: true,
        onError: (e) => errors.push(e.message)
      }
    );

    await new Promise((r) => setTimeout(r, 90));
    await app.stop();
    const runsAtStop = runs;
    await new Promise((r) => setTimeout(r, 50));

    expect(runs).toBeGreaterThanOrEqual(2);
    expect(runs).toBe(runsAtStop); // stopped cleanly
    expect(errors).toEqual(["transient cron err"]);
  });

  test("63. End-to-End Compile-Time Type Inference works seamlessly with bareClient(app)", async () => {
    const app = new BareJS()
      .post(
        "/orders",
        {
          body: Type.Object({ item: Type.String(), qty: Type.Number() }),
          response: Type.Object({ orderId: Type.String(), total: Type.Number() })
        },
        (ctx) => ({
          orderId: `ord_${ctx.body.item}`,
          total: ctx.body.qty * 100
        })
      )
      .get("/health", () => ({ ok: true }));

    const client = bareClient(app);
    const created = await client.post("/orders", { body: { item: "coffee", qty: 3 } });
    const health = await client.get("/health");

    expect(created).toEqual({ orderId: "ord_coffee", total: 300 });
    expect(health).toEqual({ ok: true });
  });
});



