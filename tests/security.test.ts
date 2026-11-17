import { expect, test, describe } from "bun:test";
import {
  BareJS,
  Context,
  bareAuth,
  createToken,
  basicAuth,
  hasRole,
  cors,
  rateLimit,
  securityHeaders,
  staticFile,
  Hash
} from "../src/index";

describe("Security Suite", () => {
  describe("JWT (bareAuth) & RBAC (hasRole)", () => {
    const SECRET = "super_secret_key";

    test("Rejects expired exp and future nbf claims", async () => {
      const app = new BareJS();
      app.get("/me", bareAuth(SECRET), (ctx: Context) => ctx.get("user"));
      app.compile();

      const now = Math.floor(Date.now() / 1000);
      const expired = await createToken({ sub: "1", exp: now - 5 }, SECRET);
      const rExp = await app.fetch(new Request("http://localhost/me", {
        headers: { Authorization: `Bearer ${expired}` }
      }));
      expect(rExp.status).toBe(401);
      expect((await rExp.json()).msg).toBe("Token expired");

      const future = await createToken({ sub: "1", nbf: now + 60 }, SECRET);
      const rNbf = await app.fetch(new Request("http://localhost/me", {
        headers: { Authorization: `Bearer ${future}` }
      }));
      expect(rNbf.status).toBe(401);
      expect((await rNbf.json()).msg).toBe("Token not active");
    });

    test("Rejects malformed JWT parts and algorithm mismatch", async () => {
      const app = new BareJS();
      app.get("/me", bareAuth(SECRET), () => "ok");
      app.compile();

      const rTwo = await app.fetch(new Request("http://localhost/me", {
        headers: { Authorization: "Bearer a.b" }
      }));
      expect(rTwo.status).toBe(401);

      const rFour = await app.fetch(new Request("http://localhost/me", {
        headers: { Authorization: "Bearer a.b.c.d" }
      }));
      expect(rFour.status).toBe(401);

      // Sign a token with alg: "none" using valid HMAC to test alg check
      const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const p = Buffer.from(JSON.stringify({ sub: "1" })).toString("base64url");
      const { createHmac } = await import("node:crypto");
      const sig = createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
      const rAlg = await app.fetch(new Request("http://localhost/me", {
        headers: { Authorization: `Bearer ${h}.${p}.${sig}` }
      }));
      expect(rAlg.status).toBe(401);
      expect((await rAlg.json()).msg).toBe("Unsupported token algorithm");
    });

    test("hasRole enforces role after bareAuth", async () => {
      const app = new BareJS();
      app.get("/admin", bareAuth(SECRET), hasRole("admin"), () => ({ access: true }));
      app.compile();

      const userTok = await createToken({ sub: "1", role: "user" }, SECRET);
      const rForbidden = await app.fetch(new Request("http://localhost/admin", {
        headers: { Authorization: `Bearer ${userTok}` }
      }));
      expect(rForbidden.status).toBe(403);

      const adminTok = await createToken({ sub: "1", role: "admin" }, SECRET);
      const rOk = await app.fetch(new Request("http://localhost/admin", {
        headers: { Authorization: `Bearer ${adminTok}` }
      }));
      expect(rOk.status).toBe(200);
    });
  });

  describe("Basic Auth", () => {
    test("Supports passwords containing colons and rejects invalid creds", async () => {
      const app = new BareJS();
      app.get("/basic", basicAuth({ user: "root", pass: "a:b:c" }), () => "ok");
      app.compile();

      const good = Buffer.from("root:a:b:c").toString("base64");
      expect((await app.fetch(new Request("http://localhost/basic", {
        headers: { Authorization: `Basic ${good}` }
      }))).status).toBe(200);

      const bad = Buffer.from("root:wrong").toString("base64");
      expect((await app.fetch(new Request("http://localhost/basic", {
        headers: { Authorization: `Basic ${bad}` }
      }))).status).toBe(401);

      expect((await app.fetch(new Request("http://localhost/basic"))).status).toBe(401);
    });
  });

  describe("CORS", () => {
    test("Handles OPTIONS preflight and sets Vary: Origin for specific origin", async () => {
      const app = new BareJS();
      app.use(cors({ origin: "https://app.example.com", methods: "GET,POST" }));
      app.get("/data", () => ({ ok: true }));
      app.compile();

      const pre = await app.fetch(new Request("http://localhost/data", { method: "OPTIONS" }));
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
      expect(pre.headers.get("vary")).toBe("Origin");

      const get = await app.fetch(new Request("http://localhost/data"));
      expect(get.status).toBe(200);
      expect(get.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
      expect(get.headers.get("vary")).toBe("Origin");
    });
  });

  describe("Rate Limiter & Security Headers", () => {
    test("rateLimit resets after windowMs and evicts oldest keys past maxEntries", async () => {
      const app = new BareJS();
      app.use(rateLimit({
        max: 1,
        windowMs: 40,
        maxEntries: 2,
        keyGenerator: (ctx) => ctx.getQuery("k") || "default"
      }));
      app.get("/rl", () => "ok");
      app.compile();

      expect((await app.fetch(new Request("http://localhost/rl?k=a"))).status).toBe(200);
      const blocked = await app.fetch(new Request("http://localhost/rl?k=a"));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("1");

      // Wait for window expiry
      await new Promise((r) => setTimeout(r, 50));
      expect((await app.fetch(new Request("http://localhost/rl?k=a"))).status).toBe(200);

      // Eviction when maxEntries=2
      expect((await app.fetch(new Request("http://localhost/rl?k=b"))).status).toBe(200);
      expect((await app.fetch(new Request("http://localhost/rl?k=c"))).status).toBe(200);
    });

    test("securityHeaders supports custom CSP and disabling headers", async () => {
      const app = new BareJS();
      app.use(securityHeaders({
        contentSecurityPolicy: "default-src 'self'",
        frameOptions: "SAMEORIGIN",
        hsts: false
      }));
      app.get("/sec", () => "ok");
      app.compile();

      const res = await app.fetch(new Request("http://localhost/sec"));
      expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(res.headers.get("strict-transport-security")).toBeNull();
    });
  });

  describe("Static File Middleware", () => {
    test("Blocks path traversal, null bytes, malformed URIs, and falls through on POST", async () => {
      const mw = staticFile("public");
      const mkCtx = (url: string, method = "GET") => ({
        req: { url, method },
        _status: 200,
        status(c: number) { this._status = c; return this; },
        send(m: string) { return new Response(m, { status: this._status }); }
      });

      expect((await mw(mkCtx("http://localhost/%2e%2e/%2e%2e/etc/passwd"), () => "next")).status).toBe(403);
      expect((await mw(mkCtx("http://localhost/foo%00bar"), () => "next")).status).toBe(400);
      expect((await mw(mkCtx("http://localhost/%E0%A4%A"), () => "next")).status).toBe(400);
      expect(await mw(mkCtx("http://localhost/test.txt", "POST"), () => "next")).toBe("next");
      expect(await mw(mkCtx("http://localhost/nonexistent-file-xyz.txt"), () => "next")).toBe("next");
    });
  });

  describe("Password Hashing (Hash)", () => {
    test("Hash.make, Hash.verify, and Hash.needsRehash", async () => {
      const h = await Hash.make("my_password");
      expect(await Hash.verify("my_password", h)).toBe(true);
      expect(await Hash.verify("wrong_password", h)).toBe(false);
      expect(Hash.needsRehash(h)).toBe(false);
      expect(Hash.needsRehash("$argon2id$v=19$m=655360,t=2,p=1$abc$def")).toBe(true);
      expect(Hash.needsRehash("$argon2id$v=19$m=65536,t=3,p=1$abc$def")).toBe(true);
    });
  });
});
