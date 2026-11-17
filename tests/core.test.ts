import { expect, test, describe, beforeEach } from "bun:test";
import { BareJS, Context } from "../src/core/bare";
import { bareAuth, createToken } from "../src/security/auth"; // Adjusted paths

describe("BareJS Ultra-Accuracy Suite - Extended", () => {
  let app: BareJS;
  const SECRET = "default_secret";
  beforeEach(() => {
    app = new BareJS();
  });

  describe("Auth & Security Precision", () => {
    test("Auth Middleware - Valid Token Lifecycle", async () => {
      // 1. Setup route with the middleware
      app.get("/protected", bareAuth(SECRET), (ctx: Context) => {
        return ctx.json({ user: ctx.get('user') });
      });
      app.compile();

      // 2. Generate a valid token
      const payload = { id: 1, username: "tester", role: "admin" };
      const token = await createToken(payload, SECRET);

      // 3. Request with valid Bearer header
      const res = await app.fetch(new Request("http://localhost/protected", {
        headers: { "Authorization": `Bearer ${token}` }
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user.username).toBe("tester");
    });

    test("Auth Middleware - Tampered Token Rejection", async () => {
      app.get("/secure", bareAuth(SECRET), () => "hidden");
      app.compile();

      const validToken = await createToken({ id: 1 }, SECRET);
      // Manually tamper with the signature part
      const tamperedToken = validToken.substring(0, validToken.length - 5) + "fail";

      const res = await app.fetch(new Request("http://localhost/secure", {
        headers: { "Authorization": `Bearer ${tamperedToken}` }
      }));

      // Should fail signature verification (using manualTimingSafeEqual)
      expect(res.status).toBe(401);
    });

    test("Auth Middleware - Malformed Header Rejection", async () => {
      app.get("/secure", bareAuth(SECRET), () => "hidden");
      app.compile();

      // Missing 'Bearer ' prefix
      const res = await app.fetch(new Request("http://localhost/secure", {
        headers: { "Authorization": "JustATokenString" }
      }));

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.msg).toBe("Bearer token required");
    });
    test("Exports - Typebox Available", () => {
      const { typebox, t } = require("../src/core/bare");
      expect(typebox).toBeDefined();
      expect(t).toBeDefined();
      expect(t.String).toBeDefined();
    });
  });

  describe("Router Composition", () => {
    test("Mounting Sub-Router (app.use(router))", async () => {
      // Logic mirroring Example/index.ts
      const { BareRouter } = await import("../src/core/router");
      const api = new BareRouter("/api");
      api.get("/ping", (ctx: Context) => ctx.json({ msg: "pong" }));

      app.use(api);

      const res = await app.fetch(new Request("http://localhost/api/ping"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.msg).toBe("pong");
    });

    test("Deeply Nested Router (e.g. /api/v1/auth/login)", async () => {
      const { BareRouter } = await import("../src/core/router");
      const api = new BareRouter("/api");

      api.group("/v1", (v1: any) => {
        v1.group("/auth", (auth: any) => {
          auth.get("/login", (ctx: Context) => ctx.json({ status: "login" }));
        });
      });

      app.use(api);

      const res = await app.fetch(new Request("http://localhost/api/v1/auth/login"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("login");
    });
  });

  describe("Middleware Chain (The 'H is not a function' Fix)", () => {
    test("Multiple Middleware Propagation", async () => {
      let count = 0;

      const mid1 = async (ctx: Context, next: any) => {
        count++;
        return await next();
      };
      const mid2 = async (ctx: Context, next: any) => {
        count++;
        return await next();
      };

      app.get("/chain", mid1, mid2, () => "finish");
      app.compile();

      const res = await app.fetch(new Request("http://localhost/chain"));

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("finish");
      expect(count).toBe(2); // Ensure both middlewares were executed
    });
  });

  describe("Memory & Static Reference Performance", () => {
    test("Logger as Static Reference vs Factory", async () => {
      // Mock logger that doesn't use factory ()
      const logger = async (ctx: Context, next: any) => {
        ctx.set("logged", true);
        return await next();
      };

      app.use(logger); // Direct reference
      app.get("/static-check", (ctx: Context) => ctx.get("logged") ? "ok" : "no");
      app.compile();

      const res = await app.fetch(new Request("http://localhost/static-check"));
      expect(await res.text()).toBe("ok");
    });
  });

  describe("Context Integrity", () => {
    test("Context Store Isolation (Concurrency Check)", async () => {
      app.get("/set/:val", (ctx: Context) => {
        ctx.set("data", ctx.params.val);
        // Simulate slight delay to catch race conditions if any
        return new Promise(r => setTimeout(() => r(ctx.json({ stored: ctx.get("data") })), 5));
      });
      app.compile();

      // Send multiple requests simultaneously
      const [res1, res2] = await Promise.all([
        app.fetch(new Request("http://localhost/set/A")),
        app.fetch(new Request("http://localhost/set/B"))
      ]);

      const data1 = await res1.json();
      const data2 = await res2.json();

      // Each request context must maintain its own store
      expect(data1.stored).toBe("A");
      expect(data2.stored).toBe("B");
    });
  });

  describe("New Features & Production Suite", () => {
    test("Lazy Query Parser (ctx.query & ctx.getQuery)", async () => {
      app.get("/search", (ctx: Context) => ({
        q: ctx.getQuery("q"),
        page: ctx.query.page
      }));
      app.compile();

      const res1 = await app.fetch(new Request("http://localhost/search?q=bare+js&page=2"));
      expect(res1.status).toBe(200);
      expect(await res1.json()).toEqual({ q: "bare js", page: "2" });

      // Ensure pooled Context does not leak query across requests
      const res2 = await app.fetch(new Request("http://localhost/search"));
      expect(await res2.json()).toEqual({});
    });

    test("Custom onError Hook (sync & async)", async () => {
      app.onError((err, ctx) => {
        ctx.status(418);
        return { customError: err.message };
      });
      app.get("/boom", () => {
        throw new Error("kaboom");
      });
      app.get("/async-boom", async () => {
        throw new Error("async-kaboom");
      });
      app.compile();

      const r1 = await app.fetch(new Request("http://localhost/boom"));
      expect(r1.status).toBe(418);
      expect(await r1.json()).toEqual({ customError: "kaboom" });

      const r2 = await app.fetch(new Request("http://localhost/async-boom"));
      expect(r2.status).toBe(418);
      expect(await r2.json()).toEqual({ customError: "async-kaboom" });
    });

    test("Server-Sent Events (ctx.sse)", async () => {
      app.get("/events", (ctx: Context) => {
        return ctx.sse(async (send) => {
          send({ msg: "hello" }, "greeting", "1");
          send("world");
        });
      });
      app.compile();

      const res = await app.fetch(new Request("http://localhost/events"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const text = await res.text();
      expect(text).toContain("id: 1\nevent: greeting\ndata: {\"msg\":\"hello\"}\n\n");
      expect(text).toContain("data: world\n\n");
    });

    test("Rate Limiter & Security Headers", async () => {
      const { rateLimit, securityHeaders } = await import("../src/index");
      app.use(securityHeaders());
      app.use(rateLimit({ max: 2, windowMs: 10_000 }));
      app.get("/limited", () => ({ ok: true }));
      app.compile();

      const r1 = await app.fetch(new Request("http://localhost/limited"));
      expect(r1.status).toBe(200);
      expect(r1.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r1.headers.get("x-frame-options")).toBe("DENY");
      expect(r1.headers.get("x-ratelimit-remaining")).toBe("1");

      const r2 = await app.fetch(new Request("http://localhost/limited"));
      expect(r2.status).toBe(200);

      const r3 = await app.fetch(new Request("http://localhost/limited"));
      expect(r3.status).toBe(429);
    });

    test("AOT OpenAPI Docs (/docs & /docs/json)", async () => {
      const { t, Type } = await import("../src/index");
      app.post("/users/:id", t(Type.Object({ name: Type.String() })), () => ({ created: true }));
      app.docs("/docs", { title: "Test API", version: "2.0.0" });
      app.compile();

      const specRes = await app.fetch(new Request("http://localhost/docs/json"));
      expect(specRes.status).toBe(200);
      const spec = await specRes.json();
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.info.title).toBe("Test API");
      expect(spec.paths["/users/{id}"].post.requestBody).toBeDefined();

      const htmlRes = await app.fetch(new Request("http://localhost/docs"));
      expect(htmlRes.status).toBe(200);
      expect(await htmlRes.text()).toContain("@scalar/api-reference");
    });

    test("Type-Safe RPC Client (bareClient)", async () => {
      const { bareClient } = await import("../src/index");
      app.post("/items/:id", async (ctx: Context) => {
        const body = await ctx.jsonBody();
        return { id: ctx.params.id, q: ctx.getQuery("mode"), body };
      });
      app.compile();

      const client = bareClient("http://localhost", {
        fetch: (input, init) => app.fetch(new Request(input, init))
      });

      const data = await client.post("/items/:id", {
        params: { id: "99" },
        query: { mode: "fast" },
        body: { title: "BareJS" }
      });
      expect(data).toEqual({ id: "99", q: "fast", body: { title: "BareJS" } });
    });
  });
});