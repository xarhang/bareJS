import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BareJS,
  Context,
  bareAuth,
  createToken,
  idempotency,
  native,
  staticFile,
  circuitBreaker,
  bareClient,
  generateOpenAPISpec,
  Z
} from "../src/index";

describe("Security & QA Deep Audit v2 Fixes", () => {
  test("1. Non-async middleware returning a Promise<Response> short-circuits and is awaited", async () => {
    const app = new BareJS();
    let handlerReached = false;

    const promiseAuth = (_ctx: Context) =>
      new Promise<Response>((resolve) => {
        setTimeout(() => resolve(Response.json({ error: "Denied" }, { status: 401 })), 5);
      });

    app.get("/protected", promiseAuth, () => {
      handlerReached = true;
      return { ok: true };
    });

    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Denied" });
    expect(handlerReached).toBe(false);
  });

  test("2. Non-async middleware returning Promise<undefined> continues to handler", async () => {
    const app = new BareJS();
    const promisePass = (ctx: Context) =>
      new Promise<undefined>((resolve) => {
        setTimeout(() => {
          ctx.set("tag", "passed");
          resolve(undefined);
        }, 5);
      });

    app.get("/ok", promisePass, (ctx: Context) => ({ tag: ctx.get("tag") }));

    const res = await app.request("/ok");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tag: "passed" });
  });

  test("3. bareAuth does not mask downstream synchronous handler errors as 401", async () => {
    const secret = "super-secret-key";
    const token = await createToken({ sub: "u1" }, secret);
    const mw = bareAuth(secret);

    const ctx = new Context();
    ctx.req = new Request("http://localhost/fail", {
      headers: { Authorization: `Bearer ${token}` }
    });

    expect(() =>
      mw(ctx, () => {
        throw new Error("Database connection lost");
      })
    ).toThrow("Database connection lost");
  });

  test("4. In-memory idempotency skips SSE streams and prevents concurrent race during Response buffering", async () => {
    const app = new BareJS();
    let sseCalls = 0;
    app.use(idempotency({ ttlMs: 5000 }));

    app.post("/stream", (ctx: Context) => {
      sseCalls++;
      return ctx.sse((send, close) => {
        send({ step: sseCalls });
        close();
      });
    });

    const r1 = await app.request("/stream", {
      method: "POST",
      headers: { "Idempotency-Key": "sse-1" }
    });
    expect(r1.status).toBe(200);
    await r1.text();

    const r2 = await app.request("/stream", {
      method: "POST",
      headers: { "Idempotency-Key": "sse-1" }
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("X-Idempotent-Replayed")).toBeNull();
    expect(sseCalls).toBe(2);

    // Handler returning undefined replays cleanly as null JSON
    const app2 = new BareJS();
    app2.use(idempotency({ ttlMs: 5000 }));
    app2.post("/empty", () => undefined);
    const e1 = await app2.request("/empty", {
      method: "POST",
      headers: { "Idempotency-Key": "empty-1" }
    });
    expect(e1.status).toBe(200);
    expect(await e1.json()).toBeNull();

    const e2 = await app2.request("/empty", {
      method: "POST",
      headers: { "Idempotency-Key": "empty-1" }
    });
    expect(e2.status).toBe(200);
    expect(e2.headers.get("X-Idempotent-Replayed")).toBe("true");
    expect(await e2.json()).toBeNull();
  });

  test("5. Context.setCookie rejects invalid sameSite and ignores non-finite maxAge", () => {
    const ctx = new Context();
    expect(() => ctx.setCookie("sid", "abc", { sameSite: "Lax\r\nX-Evil: 1" as any })).toThrow();

    ctx.setCookie("sid", "abc", { maxAge: Number.NaN });
    const res = ctx.json({ ok: true });
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).not.toContain("Max-Age=NaN");
  });

  test("6. Context.jsonBody strips __proto__ key and Context.reset clears _requestId & _detached", async () => {
    const ctx = new Context();
    ctx.req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "req-1" },
      body: '{"name":"alice","__proto__":{"polluted":true}}'
    });
    expect(ctx.requestId).toBe("req-1");
    ctx._detached = true;
    const body = await ctx.jsonBody();
    expect(body.name).toBe("alice");
    expect(Object.hasOwn(body, "__proto__")).toBe(false);
    expect(({} as any).polluted).toBeUndefined();

    ctx.reset(new Request("http://localhost/test2"));
    expect(ctx._detached).toBe(false);
    expect(ctx.requestId).not.toBe("req-1");
  });

  test("7. Context.redirect rejects CRLF header injection", () => {
    const ctx = new Context();
    expect(() => ctx.redirect("https://example.com\r\nSet-Cookie: evil=1")).toThrow();
  });

  test("8. Context.sse handles stream cancel() without throwing on subsequent send()", async () => {
    const ctx = new Context();
    let sendFn!: (data: any) => void;
    const res = ctx.sse((send) => {
      sendFn = send;
      send("first");
    });

    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("data: first");
    await reader.cancel();
    expect(() => sendFn("after-cancel")).not.toThrow();
  });

  test("9. Context.upload throws 400 on malformed multipart body", async () => {
    const ctx = new Context();
    ctx.req = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=invalid" },
      body: "not-a-valid-multipart-payload"
    });
    let err: any;
    try {
      await ctx.upload();
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.status).toBe(400);
  });

  test("10. BareRouter.use rejects string prefix without BareRouter and supports multiple middlewares", async () => {
    const app = new BareJS();
    expect(() => app.use("/api", (() => {}) as any)).toThrow(TypeError);

    app.use(
      (ctx: Context) => { ctx.set("m1", 1); },
      (ctx: Context) => { ctx.set("m2", 2); }
    );
    app.get("/multi", (ctx: Context) => ({ m1: ctx.get("m1"), m2: ctx.get("m2") }));

    const res = await app.request("/multi");
    expect(await res.json()).toEqual({ m1: 1, m2: 2 });
  });

  test("11. Custom app.docs('/swagger') excludes custom docs routes from OpenAPI spec and supports ZodNullable", async () => {
    const app = new BareJS();
    app.get("/items", { query: Z.object({ tag: Z.string().nullable() }) }, () => []);
    app.docs("/swagger");

    const res = await app.request("/swagger/json");
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths["/items"]).toBeDefined();
    expect(spec.paths["/swagger"]).toBeUndefined();
    expect(spec.paths["/swagger/json"]).toBeUndefined();

    const direct = generateOpenAPISpec(app.routes, { excludePaths: ["/swagger", "/swagger/json"] });
    expect(direct.paths["/swagger"]).toBeUndefined();
  });

  test("12. native() validator allows properties without explicit type", async () => {
    const app = new BareJS();
    app.post("/any-prop", native({ properties: { meta: {} }, required: ["meta"] }), (ctx: Context) => ctx.body);

    const res = await app.request("/any-prop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: { nested: [1, 2] } })
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ meta: { nested: [1, 2] } });
  });

  test("13. staticFile rejects empty 'bytes=-' Range header with 416", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barejs-static-"));
    try {
      writeFileSync(join(dir, "hello.txt"), "hello world");
      const app = new BareJS().use(staticFile(dir));

      const res = await app.request("/hello.txt", {
        headers: { Range: "bytes=-" }
      });
      expect(res.status).toBe(416);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("14. bareClient handles +json content-type and malformed JSON error bodies safely", async () => {
    const mockFetch = (async (url: string) => {
      if (url.endsWith("/problem")) {
        return new Response(JSON.stringify({ title: "Conflict", detail: "Already exists" }), {
          status: 409,
          headers: { "Content-Type": "application/problem+json" }
        });
      }
      return new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }) as any;

    const client = bareClient("http://localhost", { fetch: mockFetch });

    let err1: any;
    try { await client.get("/problem"); } catch (e) { err1 = e; }
    expect(err1.status).toBe(409);
    expect(err1.data).toEqual({ title: "Conflict", detail: "Already exists" });

    let err2: any;
    try { await client.get("/bad-gateway"); } catch (e) { err2 = e; }
    expect(err2.status).toBe(502);
    expect(err2.data).toBe("<html>Bad Gateway</html>");
  });

  test("15. circuitBreaker isolates throwing onStateChange callback", async () => {
    const app = new BareJS();
    app.use(
      circuitBreaker({
        failureThreshold: 1,
        onStateChange: () => {
          throw new Error("metrics sink down");
        }
      })
    );
    app.get("/fail", () => new Response("err", { status: 500 }));

    const r1 = await app.request("/fail");
    expect(r1.status).toBe(500);

    const r2 = await app.request("/fail");
    expect(r2.status).toBe(503);
  });

  test("16. JIT router does not read past urlLen into query string (GET /users?profile/sub != /users/profile)", async () => {
    const app = new BareJS();
    app.post("/users", () => ({ created: true }));
    app.get("/posts", () => ({ posts: [] }));
    app.get("/users/profile", () => ({ secret: "profile" }));

    const res = await app.request("/users?profile/sub");
    expect(res.status).toBe(404);

    const valid = await app.request("/users/profile");
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ secret: "profile" });
  });

  test("17. app.stop() executes all onStop hooks even if an earlier hook throws", async () => {
    const app = new BareJS();
    const calls: string[] = [];
    app.onStop(() => {
      calls.push("first");
      throw new Error("cleanup failure");
    });
    app.onStop(() => {
      calls.push("second");
    });

    await app.stop();
    expect(calls).toEqual(["first", "second"]);
  });

  test("18. csrf() normalizes x-forwarded-proto with trailing colon when trustProxy is enabled", async () => {
    const { csrf } = await import("../src/index");
    const app = new BareJS().trustProxy(true);
    app.use(csrf());
    app.post("/submit", () => ({ ok: true }));

    const res = await app.request("http://internal/submit", {
      method: "POST",
      headers: {
        Origin: "https://app.example.com",
        "X-Forwarded-Host": "app.example.com",
        "X-Forwarded-Proto": "https:"
      }
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("19. BareJS.cron rejects non-positive or non-finite intervalMs", () => {
    const app = new BareJS();
    expect(() => app.cron("bad-zero", 0, () => {})).toThrow(RangeError);
    expect(() => app.cron("bad-neg", -100, () => {})).toThrow(RangeError);
    expect(() => app.cron("bad-nan", Number.NaN, () => {})).toThrow(RangeError);
  });

  test("20. timeout() releases idempotency in-flight lock so retries are not stuck with 409", async () => {
    const { timeout } = await import("../src/index");
    const app = new BareJS();
    let attempt = 0;
    app.use(timeout(15));
    app.use(idempotency({ ttlMs: 5000 }));
    app.post("/pay", async () => {
      attempt++;
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 80));
      }
      return { ok: true, attempt };
    });

    const r1 = await app.request("/pay", {
      method: "POST",
      headers: { "Idempotency-Key": "retry-after-timeout" }
    });
    expect(r1.status).toBe(408);

    const r2 = await app.request("/pay", {
      method: "POST",
      headers: { "Idempotency-Key": "retry-after-timeout" }
    });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: true, attempt: 2 });
  });

  test("21. RadixNode.lookup() ignores query string when matching path segments", async () => {
    const { RadixNode } = await import("../src/core/radix");
    const tree = new RadixNode();
    const fn = () => "matched";
    tree.insert("/users/:id", "GET", fn);

    const ctx = new Context();
    const hit = tree.lookup("GET", "/users/42?tab=profile", 0, ctx);
    expect(hit).toBe(fn);
    expect(ctx.params.id).toBe("42");
  });
});
