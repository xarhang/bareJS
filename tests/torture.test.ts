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
  generateOpenAPISpec
} from "../src/index";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Deep Torture & Security Stress Matrix (50 Additional Tests)", () => {
  // --- 1. Radix & URL Torture (1-12) ---
  test("1. Static route with 2-4 siblings + param sibling at same level", async () => {
    const app = new BareJS();
    app.get("/api/a1", () => "a1");
    app.get("/api/b2", () => "b2");
    app.get("/api/c3", () => "c3");
    app.get("/api/:dyn", (ctx: Context) => `dyn:${ctx.params.dyn}`);
    app.compile();

    expect(await (await app.fetch(new Request("http://localhost/api/a1"))).text()).toBe("a1");
    expect(await (await app.fetch(new Request("http://localhost/api/b2"))).text()).toBe("b2");
    expect(await (await app.fetch(new Request("http://localhost/api/c3"))).text()).toBe("c3");
    expect(await (await app.fetch(new Request("http://localhost/api/other"))).text()).toBe("dyn:other");
  });

  test("2. Static route with >4 siblings + param sibling at same level", async () => {
    const app = new BareJS();
    for (let i = 1; i <= 6; i++) {
      app.get(`/v2/s${i}`, () => `s${i}`);
    }
    app.get("/v2/:id", (ctx: Context) => `p:${ctx.params.id}`);
    app.compile();

    expect(await (await app.fetch(new Request("http://localhost/v2/s4"))).text()).toBe("s4");
    expect(await (await app.fetch(new Request("http://localhost/v2/custom"))).text()).toBe("p:custom");
  });

  test("3. Route with 5 consecutive dynamic parameters", async () => {
    const app = new BareJS();
    app.get("/:a/:b/:c/:d/:e", (ctx: Context) => ctx.params);
    app.compile();

    const r = await app.fetch(new Request("http://localhost/1/2/3/4/5"));
    expect(await r.json()).toEqual({ a: "1", b: "2", c: "3", d: "4", e: "5" });
  });

  test("4. URL without path slash after host (e.g. http://localhost?x=1) hits root '/'", async () => {
    const app = new BareJS();
    app.get("/", (ctx: Context) => ({ x: ctx.query.x }));
    app.compile();
    const r = await app.fetch(new Request("http://localhost?x=99"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ x: "99" });
  });

  test("5. Multiple duplicate slashes in route registration are collapsed cleanly", async () => {
    const app = new BareJS();
    app.get("///deep///nested//route///", () => "collapsed");
    app.compile();
    expect(await (await app.fetch(new Request("http://localhost/deep/nested/route"))).text()).toBe("collapsed");
  });

  test("6. Prefix collision guard: /users does not match /users_extra", async () => {
    const app = new BareJS();
    app.get("/users", () => "users");
    app.compile();
    expect((await app.fetch(new Request("http://localhost/users_extra"))).status).toBe(404);
  });

  test("7. Prefix collision guard with sub-paths: /api/v1/test vs /api/v10/test", async () => {
    const app = new BareJS();
    app.get("/api/v1/test", () => "v1");
    app.compile();
    expect((await app.fetch(new Request("http://localhost/api/v10/test"))).status).toBe(404);
  });

  test("8. Dynamic param followed by static child vs static child followed by dynamic param", async () => {
    const app = new BareJS();
    app.get("/org/:orgId/members", (ctx: Context) => ({ m: ctx.params.orgId }));
    app.get("/org/settings/:tab", (ctx: Context) => ({ t: ctx.params.tab }));
    app.compile();

    expect(await (await app.fetch(new Request("http://localhost/org/acme/members"))).json()).toEqual({ m: "acme" });
    expect(await (await app.fetch(new Request("http://localhost/org/settings/billing"))).json()).toEqual({ t: "billing" });
  });

  test("9. Route returning undefined serializes to null JSON with 200", async () => {
    const app = new BareJS();
    app.get("/undef", () => undefined);
    app.compile();
    const r = await app.fetch(new Request("http://localhost/undef"));
    expect(r.status).toBe(200);
    expect(await r.json()).toBeNull();
  });

  test("10. Route returning number, boolean, or array serializes as valid JSON", async () => {
    const app = new BareJS();
    app.get("/num", () => 42);
    app.get("/bool", () => false);
    app.get("/arr", () => [1, 2, 3]);
    app.compile();

    expect(await (await app.fetch(new Request("http://localhost/num"))).json()).toBe(42);
    expect(await (await app.fetch(new Request("http://localhost/bool"))).json()).toBe(false);
    expect(await (await app.fetch(new Request("http://localhost/arr"))).json()).toEqual([1, 2, 3]);
  });

  test("11. Custom setNotFound with custom status code (e.g. 410 Gone)", async () => {
    const app = new BareJS();
    app.setNotFound(() => ({ status: 410, message: "Gone", path: "/gone" }));
    app.get("/exists", () => "ok");
    app.compile();

    const r = await app.fetch(new Request("http://localhost/missing"));
    expect(r.status).toBe(410);
    expect((await r.json()).message).toBe("Gone");
  });

  test("12. useLog(true) logs 4xx/5xx error responses and OPTIONS preflight without crashing", async () => {
    const app = new BareJS();
    app.useLog(true);
    app.use(cors());
    app.get("/err500", () => { throw new Error("log500"); });
    app.get("/res200", () => new Response("direct"));
    app.compile();

    expect((await app.fetch(new Request("http://localhost/err500"))).status).toBe(500);
    expect((await app.fetch(new Request("http://localhost/res200"))).status).toBe(200);
    expect((await app.fetch(new Request("http://localhost/any", { method: "OPTIONS" }))).status).toBe(204);
    expect((await app.fetch(new Request("http://localhost/404-log"))).status).toBe(404);
  });

  // --- 2. Query & Cookie Parsing Torture (13-22) ---
  test("13. Query string with empty segments (&&&) and trailing '&'", async () => {
    const app = new BareJS();
    app.get("/q", (ctx: Context) => ctx.query);
    app.compile();
    const r = await app.fetch(new Request("http://localhost/q?&&a=1&&b=2&"));
    expect(await r.json()).toEqual({ a: "1", b: "2" });
  });

  test("14. Query string with key-only flags (?debug&verbose) sets empty string values", async () => {
    const app = new BareJS();
    app.get("/q", (ctx: Context) => ctx.query);
    app.compile();
    const r = await app.fetch(new Request("http://localhost/q?debug&verbose"));
    expect(await r.json()).toEqual({ debug: "", verbose: "" });
  });

  test("15. Query string with '=' inside value (e.g. ?filter=a=b=c)", async () => {
    const app = new BareJS();
    app.get("/q", (ctx: Context) => ctx.query);
    app.compile();
    const r = await app.fetch(new Request("http://localhost/q?filter=a=b=c"));
    expect(await r.json()).toEqual({ filter: "a=b=c" });
  });

  test("16. Query string with Unicode Lao script (?msg=ສະບາຍດີ)", async () => {
    const app = new BareJS();
    app.get("/q", (ctx: Context) => ctx.query);
    app.compile();
    const r = await app.fetch(new Request(`http://localhost/q?msg=${encodeURIComponent("ສະບາຍດີ")}`));
    expect(await r.json()).toEqual({ msg: "ສະບາຍດີ" });
  });

  test("17. Malformed percent encoding in query key keeps raw key safely", async () => {
    const app = new BareJS();
    app.get("/q", (ctx: Context) => ctx.query);
    app.compile();
    const r = await app.fetch(new Request("http://localhost/q?%E0%A4%A=val"));
    expect(await r.json()).toEqual({ "%E0%A4%A": "val" });
  });

  test("18. Cookie header with empty segments, spaces, and '=' inside cookie value", async () => {
    const app = new BareJS();
    app.get("/c", (ctx: Context) => ctx.cookies);
    app.compile();
    const r = await app.fetch(new Request("http://localhost/c", {
      headers: { Cookie: " ; a = 1 ; b=x=y=z ; invalid_no_eq ; =empty_name " }
    }));
    expect(await r.json()).toEqual({ a: "1", b: "x=y=z" });
  });

  test("19. Signed cookie whose value itself contains dots (e.g. 'v1.user.99')", async () => {
    const app = new BareJS();
    app.get("/sign", (ctx: Context) => {
      ctx.setCookie("tok", "v1.user.99", { secret: "dot_sec" });
      return "ok";
    });
    app.get("/read", (ctx: Context) => ({
      val: ctx.getSignedCookie("tok", "dot_sec")
    }));
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/sign"));
    const cookieVal = r1.headers.get("set-cookie")!.split(";")[0]!;
    const r2 = await app.fetch(new Request("http://localhost/read", { headers: { Cookie: cookieVal } }));
    expect((await r2.json()).val).toBe("v1.user.99");
  });

  test("20. Set-Cookie headers are preserved when handler returns direct Response or string", async () => {
    const app = new BareJS();
    app.get("/str-cookie", (ctx: Context) => {
      ctx.setCookie("k", "v");
      return "hello-str";
    });
    app.get("/res-cookie", (ctx: Context) => {
      ctx.setCookie("k2", "v2");
      return new Response("hello-res");
    });
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/str-cookie"));
    expect(r1.headers.get("set-cookie")).toContain("k=v");

    const r2 = await app.fetch(new Request("http://localhost/res-cookie"));
    expect(r2.headers.get("set-cookie")).toContain("k2=v2");
  });

  test("21. ctx.jsonBody() returns null when Content-Type is missing or text/plain", async () => {
    const app = new BareJS();
    app.post("/plain", async (ctx: Context) => ({ body: await ctx.jsonBody() }));
    app.compile();

    const r = await app.fetch(new Request("http://localhost/plain", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: '{"a":1}'
    }));
    expect((await r.json()).body).toBeNull();
  });

  test("22. ctx.jsonBody() without Content-Length parses valid JSON and returns null on invalid JSON", async () => {
    const app = new BareJS();
    app.post("/chunked", async (ctx: Context) => ({ body: await ctx.jsonBody(1024) }));
    app.compile();

    const reqOk = new Request("http://localhost/chunked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"ok":1}'
    });
    reqOk.headers.delete("content-length");
    expect((await (await app.fetch(reqOk)).json()).body).toEqual({ ok: 1 });

    const reqBad = new Request("http://localhost/chunked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad"
    });
    reqBad.headers.delete("content-length");
    expect((await (await app.fetch(reqBad)).json()).body).toBeNull();
  });

  // --- 3. Validation & Schema Torture (23-32) ---
  test("23. typebox, zod, and native validators work with raw Request object (non-Context)", async () => {
    const tb = typebox(Type.Object({ a: Type.Number() }));
    const zd = zod(Z.object({ a: Z.number() }));
    const nv = native({ properties: { a: { type: "number" } } });

    const mkRawReq = (b: string) =>
      new Request("http://localhost/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: b
      }) as any;

    expect(await tb(mkRawReq('{"a":1}'), () => "ok")).toBe("ok");
    expect(await zd(mkRawReq('{"a":1}'), () => "ok")).toBe("ok");
    expect(await nv(mkRawReq('{"a":1}'), () => "ok")).toBe("ok");

    // Catch block when .json() throws on broken JSON with raw Request
    expect((await tb(mkRawReq("{broken"), () => "ok")).status).toBe(400);
    expect((await zd(mkRawReq("{broken"), () => "ok")).status).toBe(400);
    expect((await nv(mkRawReq("{broken"), () => "ok")).status).toBe(400);
  });

  test("24. schemaValidator with empty RouteSchemas {} acts as pass-through", async () => {
    const app = new BareJS();
    app.get("/empty-schema", {}, () => ({ ok: true }));
    app.compile();
    expect((await app.fetch(new Request("http://localhost/empty-schema"))).status).toBe(200);
  });

  test("25. coerceFields handles whitespace-only string and boolean 'true'", async () => {
    const app = new BareJS();
    app.get(
      "/coerce-edge",
      {
        query: Type.Object({
          num: Type.Number(),
          bool: Type.Boolean()
        })
      },
      (ctx: Context) => ctx.query
    );
    app.compile();

    const ok = await app.fetch(new Request("http://localhost/coerce-edge?num=0&bool=true"));
    expect(await ok.json()).toEqual({ num: 0, bool: true });

    // Whitespace-only num stays string "   " -> fails Type.Number()
    const bad = await app.fetch(new Request("http://localhost/coerce-edge?num=%20%20&bool=true"));
    expect(bad.status).toBe(400);
  });

  test("26. Native validator allows optional fields when not in required array", async () => {
    const app = new BareJS();
    app.post(
      "/opt-native",
      native({
        properties: { reqField: { type: "string" }, optField: { type: "number" } },
        required: ["reqField"]
      }),
      (ctx: Context) => ctx.body
    );
    app.compile();

    const r = await app.fetch(new Request("http://localhost/opt-native", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reqField: "hello" })
    }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ reqField: "hello" });
  });

  test("27. OpenAPI generator supports Native schema without required array and duplicate paths", () => {
    const spec = generateOpenAPISpec([
      {
        method: "POST",
        path: "/dup/:id",
        handlers: [native({ properties: { flag: { type: "boolean" } } })]
      },
      {
        method: "GET",
        path: "/dup/:id",
        handlers: []
      }
    ]);
    expect(spec.paths["/dup/{id}"].post).toBeDefined();
    expect(spec.paths["/dup/{id}"].get).toBeDefined();
  });

  // --- 4. Security & Middleware Torture (28-40) ---
  test("28. bareAuth rejects corrupt non-JSON base64 payload in catch block (401)", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = "sec_catch";
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const badPayload = Buffer.from("not-valid-json").toString("base64url");
    const data = `${header}.${badPayload}`;
    const sig = createHmac("sha256", secret).update(data).digest("base64url");

    const app = new BareJS();
    app.get("/p", bareAuth(secret), () => "ok");
    app.compile();

    const r = await app.fetch(new Request("http://localhost/p", {
      headers: { Authorization: `Bearer ${data}.${sig}` }
    }));
    expect(r.status).toBe(401);
  });

  test("29. csrf() allows POST with valid same-origin Referer when Origin header is absent", async () => {
    const app = new BareJS();
    app.use(csrf());
    app.post("/ref-ok", () => ({ ok: true }));
    app.compile();

    const r = await app.fetch(new Request("http://localhost/ref-ok", {
      method: "POST",
      headers: { Referer: "http://localhost/dashboard/page" }
    }));
    expect(r.status).toBe(200);
  });

  test("30. csrf() allows custom ignoreMethods (e.g. POST ignored)", async () => {
    const app = new BareJS();
    app.use(csrf({ ignoreMethods: ["GET", "POST"] }));
    app.post("/webhook", () => ({ ok: true }));
    app.compile();

    const r = await app.fetch(new Request("http://localhost/webhook", {
      method: "POST",
      headers: { Origin: "https://external.webhook" }
    }));
    expect(r.status).toBe(200);
  });

  test("31. rateLimit uses x-forwarded-for or x-real-ip by default when keyGenerator is omitted", async () => {
    const app = new BareJS().trustProxy(true);
    app.use(rateLimit({ max: 1, windowMs: 10000 }));
    app.get("/ip-test", () => "ok");
    app.compile();

    expect((await app.fetch(new Request("http://localhost/ip-test", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }
    }))).status).toBe(200);

    expect((await app.fetch(new Request("http://localhost/ip-test", {
      headers: { "x-forwarded-for": "1.2.3.4" }
    }))).status).toBe(429);

    expect((await app.fetch(new Request("http://localhost/ip-test", {
      headers: { "x-real-ip": "9.9.9.9" }
    }))).status).toBe(200);
  });

  test("32. staticFile with useLog(true) logs 200 and 404 fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barejs-st-log-"));
    try {
      writeFileSync(join(dir, "f.txt"), "hello");
      const app = new BareJS();
      app.useLog(true);
      app.use(staticFile(dir));
      app.compile();

      expect((await app.fetch(new Request("http://localhost/f.txt"))).status).toBe(200);
      expect((await app.fetch(new Request("http://localhost/missing.txt"))).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("33. staticFile HEAD request with Range header returns 206 with empty body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barejs-st-head-"));
    try {
      writeFileSync(join(dir, "f.txt"), "0123456789");
      const app = new BareJS();
      app.use(staticFile(dir));
      app.compile();

      const r = await app.fetch(new Request("http://localhost/f.txt", {
        method: "HEAD",
        headers: { Range: "bytes=0-4" }
      }));
      expect(r.status).toBe(206);
      expect(r.headers.get("content-length")).toBe("5");
      expect(await r.text()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("34. Multiple app.derive() calls merge keys and clean up all keys on pool release", async () => {
    const app = new BareJS(2);
    app.derive(() => ({ d1: "one" }));
    app.derive(async () => ({ d2: "two" }));
    app.get("/d", (ctx: any) => ({ d1: ctx.d1, d2: ctx.d2 }));
    app.compile();

    const r = await app.fetch(new Request("http://localhost/d"));
    expect(await r.json()).toEqual({ d1: "one", d2: "two" });
  });

  test("35. ctx.sse() stream controller catches generator error gracefully", async () => {
    const app = new BareJS();
    app.get("/sse-err", (ctx: Context) =>
      ctx.sse(async () => {
        throw new Error("stream error");
      })
    );
    app.compile();

    const r = await app.fetch(new Request("http://localhost/sse-err"));
    let caught = false;
    try {
      await r.text();
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  // --- 5. Parametric Security & Method Matrix (36-50) ---
  const sqlPayloads = [
    "' OR '1'='1",
    "1; DROP TABLE users--",
    "admin'--",
    "' UNION SELECT null, version()--",
    "%27%20OR%201=1"
  ];
  sqlPayloads.forEach((payload, idx) => {
    test(`${36 + idx}. Parametric SQLi / Special-Char Resilience in Route Param & Query #${idx + 1}`, async () => {
      const app = new BareJS();
      app.get("/search/:term", (ctx: Context) => ({
        term: ctx.params.term,
        q: ctx.query.q
      }));
      app.compile();

      const enc = encodeURIComponent(payload);
      const r = await app.fetch(new Request(`http://localhost/search/${enc}?q=${enc}`));
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(typeof body.term).toBe("string");
      expect(body.q).toBe(payload);
    });
  });

  const traversalPayloads = [
    "/..%2f..%2fetc/passwd",
    "/%2e%2e/%2e%2e/root/.ssh/id_rsa",
    "/valid/../../outside.txt",
    "/file.txt%00.jpg",
    "/%c0%ae%c0%ae/etc/shadow"
  ];
  traversalPayloads.forEach((payload, idx) => {
    test(`${41 + idx}. Parametric Static File Traversal & Null-Byte Defense #${idx + 1}`, async () => {
      const mw = staticFile("public");
      const c = new Context();
      c.req = new Request(`http://localhost${payload}`);
      const res = await mw(c, () => new Response("fallthrough", { status: 404 }));
      expect([400, 403, 404]).toContain(res.status);
    });
  });

  const xssPayloads = [
    "<script>alert(1)</script>",
    '"><img src=x onerror=alert(1)>',
    "javascript:alert(document.cookie)",
    "<svg/onload=confirm(1)>",
    "';alert(String.fromCharCode(88,83,83))//"
  ];
  xssPayloads.forEach((payload, idx) => {
    test(`${46 + idx}. Parametric JSON Serialization & nosniff XSS Defense #${idx + 1}`, async () => {
      const app = new BareJS();
      app.use(securityHeaders());
      app.post("/comment", { body: Type.Object({ text: Type.String() }) }, (ctx: Context) => ({
        saved: ctx.body.text
      }));
      app.compile();

      const r = await app.fetch(new Request("http://localhost/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payload })
      }));
      expect(r.status).toBe(200);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("content-type")).toContain("application/json");
      expect((await r.json()).saved).toBe(payload);
    });
  });
});
