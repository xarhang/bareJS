import { expect, test, describe } from "bun:test";
import { BareJS, Context, Type, Z, staticFile, csrf, timeout } from "../src/index";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Cookies, Unified Schema Validation, Derive & Static Caching", () => {
  test("Lazy Cookies, Signed Cookies (HMAC + timingSafeEqual), and deleteCookie", async () => {
    const SECRET = "cookie_secret_key";
    const app = new BareJS();

    app.post("/login-cookie", (ctx: Context) => {
      ctx.setCookie("sid", "user_42", { secret: SECRET, httpOnly: true, sameSite: "Strict", maxAge: 3600 });
      ctx.setCookie("theme", "dark", { httpOnly: false });
      return { ok: true };
    });

    app.get("/me-cookie", (ctx: Context) => ({
      sid: ctx.getSignedCookie("sid", SECRET),
      theme: ctx.cookies.theme,
      hasProto: Object.prototype.hasOwnProperty.call(ctx.cookies, "__proto__")
    }));

    app.post("/logout-cookie", (ctx: Context) => {
      ctx.deleteCookie("sid");
      return "logged out";
    });

    app.compile();

    const rLogin = await app.fetch(new Request("http://localhost/login-cookie", { method: "POST" }));
    const setCookies = rLogin.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies[0]).toContain("sid=user_42.");
    expect(setCookies[0]).toContain("HttpOnly");
    expect(setCookies[0]).toContain("SameSite=Strict");
    expect(setCookies[1]).toContain("theme=dark");

    const sidPair = setCookies[0]!.split(";")[0]!;
    const rMe = await app.fetch(new Request("http://localhost/me-cookie", {
      headers: { Cookie: `${sidPair}; theme=dark; __proto__=evil` }
    }));
    expect(await rMe.json()).toEqual({ sid: "user_42", theme: "dark", hasProto: false });

    // Tampered cookie signature must return null
    const rTampered = await app.fetch(new Request("http://localhost/me-cookie", {
      headers: { Cookie: "sid=user_42.tampered_sig" }
    }));
    expect((await rTampered.json()).sid).toBeNull();

    // Delete cookie
    const rOut = await app.fetch(new Request("http://localhost/logout-cookie", { method: "POST" }));
    expect(rOut.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  test("Unified Route Schemas: params/query auto-coercion, headers, and maxBodySize (413)", async () => {
    const app = new BareJS();

    app.post("/items/:id", {
      params: Type.Object({ id: Type.Number() }),
      query: Type.Object({ active: Type.Boolean(), limit: Type.Number() }),
      headers: Type.Object({ "x-api-key": Type.String() }),
      body: Z.object({ name: Z.string().min(2) }),
      maxBodySize: 64
    }, (ctx: Context) => ({
      id: ctx.params.id,
      idType: typeof ctx.params.id,
      query: ctx.query,
      body: ctx.body
    }));

    app.compile();

    const rOk = await app.fetch(new Request("http://localhost/items/123?active=true&limit=10", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": "secret" },
      body: JSON.stringify({ name: "Widget" })
    }));
    expect(rOk.status).toBe(200);
    expect(await rOk.json()).toEqual({
      id: 123,
      idType: "number",
      query: { active: true, limit: 10 },
      body: { name: "Widget" }
    });

    // NaN / non-numeric param rejected
    const rBadParam = await app.fetch(new Request("http://localhost/items/abc?active=true&limit=10", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": "secret" },
      body: JSON.stringify({ name: "Widget" })
    }));
    expect(rBadParam.status).toBe(400);
    expect((await rBadParam.json()).code).toBe("PARAMS_INVALID");

    // Missing required header rejected
    const rNoHdr = await app.fetch(new Request("http://localhost/items/1?active=true&limit=10", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Widget" })
    }));
    expect(rNoHdr.status).toBe(400);
    expect((await rNoHdr.json()).code).toBe("HEADERS_INVALID");

    // Oversized body rejected with 413 Payload Too Large
    const rTooBig = await app.fetch(new Request("http://localhost/items/1?active=true&limit=10", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": "secret" },
      body: JSON.stringify({ name: "A".repeat(100) })
    }));
    expect(rTooBig.status).toBe(413);
    expect((await rTooBig.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("app.derive enriches ctx safely and cleans up pooled Context", async () => {
    const app = new BareJS(2);
    app.derive((ctx) => ({
      requestTag: ctx.getQuery("tag") || "none"
    }));
    app.get("/derived", (ctx: any) => ({ tag: ctx.requestTag }));
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/derived?tag=alpha"));
    expect(await r1.json()).toEqual({ tag: "alpha" });

    const r2 = await app.fetch(new Request("http://localhost/derived"));
    expect(await r2.json()).toEqual({ tag: "none" });
  });

  test("staticFile supports ETag, 304 Not Modified, Cache-Control, and Range (206 / 416)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barejs-static-"));
    try {
      writeFileSync(join(dir, "hello.txt"), "0123456789ABCDEF");
      const app = new BareJS();
      app.use(staticFile(dir, { maxAge: 600 }));
      app.get("/fallback", () => "fallback");
      app.compile();

      const r1 = await app.fetch(new Request("http://localhost/hello.txt"));
      expect(r1.status).toBe(200);
      expect(r1.headers.get("cache-control")).toBe("public, max-age=600");
      const etag = r1.headers.get("etag");
      expect(etag).toBeTruthy();
      expect(await r1.text()).toBe("0123456789ABCDEF");

      // 304 Not Modified
      const r304 = await app.fetch(new Request("http://localhost/hello.txt", {
        headers: { "If-None-Match": etag! }
      }));
      expect(r304.status).toBe(304);

      // 206 Partial Content
      const r206 = await app.fetch(new Request("http://localhost/hello.txt", {
        headers: { Range: "bytes=0-3" }
      }));
      expect(r206.status).toBe(206);
      expect(r206.headers.get("content-range")).toBe("bytes 0-3/16");
      expect(await r206.text()).toBe("0123");

      // 416 Range Not Satisfiable
      const r416 = await app.fetch(new Request("http://localhost/hello.txt", {
        headers: { Range: "bytes=100-200" }
      }));
      expect(r416.status).toBe(416);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Production Safety: CSRF, Timeout, Safe Upload, RequestId & Lifecycle", () => {
  test("csrf() blocks cross-site/origin-mismatched POST and supports double-submit token", async () => {
    const app = new BareJS();
    app.use(csrf({ requireToken: true }));
    app.post("/transfer", () => ({ ok: true }));
    app.get("/form", () => ({ ok: true }));
    app.compile();

    // GET is exempt
    expect((await app.fetch(new Request("http://localhost/form"))).status).toBe(200);

    // Cross-site blocked
    const cross = await app.fetch(new Request("http://localhost/transfer", {
      method: "POST",
      headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.com" }
    }));
    expect(cross.status).toBe(403);

    // Same-origin but missing CSRF token -> 403
    const noToken = await app.fetch(new Request("http://localhost/transfer", {
      method: "POST",
      headers: { Origin: "http://localhost" }
    }));
    expect(noToken.status).toBe(403);

    // Valid same-origin + matching double-submit cookie & header -> 200
    const valid = await app.fetch(new Request("http://localhost/transfer", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Cookie: "csrf_token=tok123",
        "X-CSRF-Token": "tok123"
      }
    }));
    expect(valid.status).toBe(200);
  });

  test("timeout() returns 408 when handler exceeds deadline and passes fast handlers", async () => {
    const app = new BareJS();
    app.use(timeout(30));
    app.get("/fast", () => ({ ok: true }));
    app.get("/slow", async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true };
    });
    app.compile();

    expect((await app.fetch(new Request("http://localhost/fast"))).status).toBe(200);
    const slowRes = await app.fetch(new Request("http://localhost/slow"));
    expect(slowRes.status).toBe(408);
    expect((await slowRes.json()).code).toBe("REQUEST_TIMEOUT");
  });

  test("ctx.upload() sanitizes filenames, enforces allowedTypes (415) & maxFileSize (413)", async () => {
    const app = new BareJS();
    app.post("/upload", async (ctx: Context) => {
      const { fields, files } = await ctx.upload({
        maxFileSize: 50,
        maxFiles: 2,
        allowedTypes: ["text/plain"]
      });
      return { fields, files: files.map((f) => ({ safeName: f.safeName, size: f.size, type: f.type })) };
    });
    app.compile();

    // Valid upload with path traversal in filename -> sanitized
    const fd1 = new FormData();
    fd1.append("title", "hello");
    fd1.append("doc", new File(["hello world"], "../../etc/passwd.txt", { type: "text/plain" }));
    const r1 = await app.fetch(new Request("http://localhost/upload", { method: "POST", body: fd1 }));
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.fields.title).toBe("hello");
    expect(b1.files[0].safeName).toBe("passwd.txt");

    // Disallowed MIME type -> 415
    const fd2 = new FormData();
    fd2.append("doc", new File(["<script>"], "evil.html", { type: "text/html" }));
    const r2 = await app.fetch(new Request("http://localhost/upload", { method: "POST", body: fd2 }));
    expect(r2.status).toBe(415);

    // Oversized file -> 413
    const fd3 = new FormData();
    fd3.append("doc", new File(["x".repeat(100)], "big.txt", { type: "text/plain" }));
    const r3 = await app.fetch(new Request("http://localhost/upload", { method: "POST", body: fd3 }));
    expect(r3.status).toBe(413);
  });

  test("ctx.requestId, lifecycle hooks (onStart/onStop/stop), and production error masking", async () => {
    let started = false;
    let stopped = false;

    const app = new BareJS();
    app.onStart(() => { started = true; });
    app.onStop(() => { stopped = true; });
    app.get("/id", (ctx: Context) => ({ id: ctx.requestId }));
    app.get("/boom", () => { throw new Error("secret db password leaked"); });

    // RequestId respects header or generates UUID, and resets across pool
    const rId1 = await app.fetch(new Request("http://localhost/id", { headers: { "X-Request-Id": "req-abc" } }));
    expect((await rId1.json()).id).toBe("req-abc");
    const rId2 = await app.fetch(new Request("http://localhost/id"));
    expect((await rId2.json()).id).not.toBe("req-abc");

    // Production error masking
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const boomRes = await app.fetch(new Request("http://localhost/boom"));
    expect(boomRes.status).toBe(500);
    const boomBody = await boomRes.json();
    expect(boomBody.message).toBe("Internal Server Error");
    expect(boomBody.stack).toBeUndefined();

    // Live listen + onStart + stop + onStop
    app.listen(0, "127.0.0.1", false);
    process.env.NODE_ENV = prevEnv;
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(true);
    await app.stop(true);
    expect(stopped).toBe(true);
  });
});

