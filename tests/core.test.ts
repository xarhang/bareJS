import { expect, test, describe, beforeEach } from "bun:test";
import { BareJS, Context, typebox } from "../src/bare";
import { bareAuth, createToken } from "../src/auth"; // Adjusted paths

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
        return ctx.json({ user: ctx.user });
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
      expect(data.message).toBe("Bearer token required");
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
});