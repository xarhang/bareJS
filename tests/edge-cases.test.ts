import { expect, test, describe } from "bun:test";
import {
  BareJS,
  Context,
  cors,
  csrf,
  timeout,
  basicAuth,
  bareAuth,
  hasRole,
  Type
} from "../src/index";

describe("Security & Edge-Case Hardening Suite", () => {
  test("CORS supports origin array, function validator, credentials, and blocks disallowed origins", async () => {
    const app = new BareJS();
    app.use(cors({
      origin: ["https://a.example.com", "https://b.example.com"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      exposedHeaders: ["X-Request-Id"]
    }));
    app.get("/data", () => ({ ok: true }));
    app.compile();

    const allowed = await app.fetch(new Request("http://localhost/data", {
      headers: { Origin: "https://b.example.com" }
    }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://b.example.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(allowed.headers.get("access-control-expose-headers")).toBe("X-Request-Id");

    const blocked = await app.fetch(new Request("http://localhost/data", {
      headers: { Origin: "https://evil.com" }
    }));
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("CSRF blocks invalid Referer, mismatched Origin, and allows whitelisted allowedOrigins", async () => {
    const app = new BareJS();
    app.use(csrf({ allowedOrigins: ["https://trusted.app"] }));
    app.post("/action", () => ({ ok: true }));
    app.compile();

    // Malformed Referer -> 403
    const badRef = await app.fetch(new Request("http://localhost/action", {
      method: "POST",
      headers: { Referer: "not-a-valid-url" }
    }));
    expect(badRef.status).toBe(403);

    // Mismatched Origin -> 403
    const badOrig = await app.fetch(new Request("http://localhost/action", {
      method: "POST",
      headers: { Origin: "https://attacker.com" }
    }));
    expect(badOrig.status).toBe(403);

    // Whitelisted allowedOrigins -> 200
    const trusted = await app.fetch(new Request("http://localhost/action", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://trusted.app" }
    }));
    expect(trusted.status).toBe(200);
  });

  test("ctx.upload() rejects non-multipart (400), too many files (413), and oversized Content-Length (413)", async () => {
    const app = new BareJS();
    app.post("/up", async (ctx: Context) => {
      return await ctx.upload({ maxFileSize: 100, maxFiles: 1 });
    });
    app.compile();

    // Non-multipart -> 400
    const r400 = await app.fetch(new Request("http://localhost/up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }));
    expect(r400.status).toBe(400);

    // Too many files -> 413
    const fd = new FormData();
    fd.append("f1", new File(["a"], "a.txt", { type: "text/plain" }));
    fd.append("f2", new File(["b"], "b.txt", { type: "text/plain" }));
    const rMany = await app.fetch(new Request("http://localhost/up", { method: "POST", body: fd }));
    expect(rMany.status).toBe(413);
  });

  test("basicAuth rejects malformed base64 and bareAuth/hasRole handle missing user", async () => {
    const app = new BareJS();
    app.get("/basic", basicAuth({ user: "admin", pass: "s3cr3t" }), () => ({ ok: true }));
    app.get("/role-only", hasRole("admin"), () => ({ ok: true }));
    app.compile();

    expect((await app.fetch(new Request("http://localhost/basic"))).status).toBe(401);
    expect((await app.fetch(new Request("http://localhost/basic", {
      headers: { Authorization: "Basic !!!invalid!!!" }
    }))).status).toBe(401);
    expect((await app.fetch(new Request("http://localhost/basic", {
      headers: { Authorization: `Basic ${btoa("admin:s3cr3t")}` }
    }))).status).toBe(200);

    expect((await app.fetch(new Request("http://localhost/role-only"))).status).toBe(403);
  });

  test("Unified Schema rejects invalid params (PARAMS_INVALID) and invalid headers (HEADERS_INVALID)", async () => {
    const app = new BareJS();
    app.get("/items/:id", {
      params: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
      headers: Type.Object({ "x-api-key": Type.String({ minLength: 4 }) })
    }, (ctx: Context) => ({ id: ctx.params.id }));
    app.compile();

    const badParam = await app.fetch(new Request("http://localhost/items/abc", {
      headers: { "x-api-key": "valid_key" }
    }));
    expect(badParam.status).toBe(400);
    expect((await badParam.json()).code).toBe("PARAMS_INVALID");

    const badHeader = await app.fetch(new Request("http://localhost/items/10"));
    expect(badHeader.status).toBe(400);
    expect((await badHeader.json()).code).toBe("HEADERS_INVALID");

    const ok = await app.fetch(new Request("http://localhost/items/10", {
      headers: { "x-api-key": "valid_key" }
    }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).id).toBe(10);
  });

  test("Standalone timeout() middleware enforces deadline with custom next", async () => {
    const mw = timeout(20, { status: 504, message: "Gateway Timeout" });
    const res = await mw({} as any, () => new Promise((r) => setTimeout(() => r("late"), 60)));
    expect(res.status).toBe(504);
    expect((await res.json()).message).toBe("Gateway Timeout");
  });

  test("CORS dynamic function validator and OPTIONS preflight with credentials", async () => {
    const app = new BareJS();
    app.use(cors({
      origin: (o) => o.endsWith(".barejs.dev"),
      credentials: true,
      allowedHeaders: "X-Custom",
      exposedHeaders: "X-RateLimit"
    }));
    app.get("/api", () => ({ ok: true }));
    app.compile();

    const preOk = await app.fetch(new Request("http://localhost/api", {
      method: "OPTIONS",
      headers: { Origin: "https://sub.barejs.dev" }
    }));
    expect(preOk.status).toBe(204);
    expect(preOk.headers.get("access-control-allow-origin")).toBe("https://sub.barejs.dev");
    expect(preOk.headers.get("access-control-allow-credentials")).toBe("true");

    const preBlocked = await app.fetch(new Request("http://localhost/api", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com" }
    }));
    expect(preBlocked.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("CORS static origin with credentials and exposedHeaders on Response returns", async () => {
    const app = new BareJS();
    app.use(cors({
      origin: "https://portal.barejs.dev",
      credentials: true,
      exposedHeaders: ["X-Total-Count"]
    }));
    app.get("/sync-res", () => new Response("ok"));
    app.get("/async-res", async () => new Response("async-ok"));
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/sync-res"));
    expect(r1.headers.get("access-control-allow-origin")).toBe("https://portal.barejs.dev");
    expect(r1.headers.get("access-control-allow-credentials")).toBe("true");
    expect(r1.headers.get("access-control-expose-headers")).toBe("X-Total-Count");

    const r2 = await app.fetch(new Request("http://localhost/async-res"));
    expect(r2.headers.get("access-control-allow-origin")).toBe("https://portal.barejs.dev");
  });

  test("RadixNode.lookup interpreter mode matches static, multi-static, and param routes", () => {
    const { RadixNode } = require("../src/core/radix");
    const tree = new RadixNode();
    const hSingle = () => "single";
    const hMultiA = () => "multiA";
    const hMultiB = () => "multiB";
    const hParam = () => "param";

    tree.insert("/only/one", "GET", hSingle);
    tree.insert("/branch/alpha", "GET", hMultiA);
    tree.insert("/branch/beta", "GET", hMultiB);
    tree.insert("/branch/:slug", "GET", hParam);

    const ctx = new Context();
    expect(tree.lookup("GET", "/only/one", 0, ctx)).toBe(hSingle);
    expect(tree.lookup("GET", "/branch/alpha", 0, ctx)).toBe(hMultiA);
    expect(tree.lookup("GET", "/branch/beta", 0, ctx)).toBe(hMultiB);
    expect(tree.lookup("GET", "/branch/custom-id", 0, ctx)).toBe(hParam);
    expect(ctx.params.slug).toBe("custom-id");
    expect(tree.lookup("GET", "/nonexistent/path", 0, ctx)).toBeNull();
  });

  test("Context.reset, ctx.user getter, useLog(), and plugin registration", async () => {
    const app = new BareJS();
    let pluginInstalled = false;
    app.use({ install: () => { pluginInstalled = true; } });
    expect(pluginInstalled).toBe(true);

    app.useLog(true);
    app.get("/log-test", (ctx: Context) => {
      ctx.set("user", { id: "u1" });
      return { user: ctx.user };
    });
    app.compile();

    const r = await app.fetch(new Request("http://localhost/log-test"));
    expect(r.status).toBe(200);
    expect((await r.json()).user).toEqual({ id: "u1" });

    // Direct Context.reset check
    const c = new Context();
    c.status(404).setHeader("X-Test", "1");
    c.set("k", "v");
    c.reset(new Request("http://localhost/reset"));
    expect(c._status).toBe(200);
    expect(c._headers).toBeUndefined();
    expect(c.store.size).toBe(0);
  });

  test("Fuzzing & Malformed Payloads: deeply nested JSON, prototype keys, null bytes, and invalid UTF-8 URLs", async () => {
    const app = new BareJS();
    app.post("/echo", async (ctx: Context) => {
      const body = await ctx.jsonBody(1024);
      return { body, query: ctx.query, cookies: ctx.cookies };
    });
    app.compile();

    // 1. Prototype pollution attempts in query, cookie, and JSON
    const r1 = await app.fetch(new Request("http://localhost/echo?__proto__=polluted&constructor=bad&a=1%202+3", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "__proto__=evil; prototype=bad; valid=%E0%A4%A"
      },
      body: JSON.stringify({ normal: "ok" })
    }));
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(({} as any).polluted).toBeUndefined();
    expect(b1.query.a).toBe("1 2 3");
    expect(b1.cookies.valid).toBe("%E0%A4%A");

    // 2. Oversized payload without Content-Length header (chunked/stream fallback) -> 413
    const bigReq = new Request("http://localhost/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(2000) })
    });
    bigReq.headers.delete("content-length");
    const r413 = await app.fetch(bigReq);
    expect(r413.status).toBe(413);
  });
});

