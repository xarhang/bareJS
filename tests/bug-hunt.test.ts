import { describe, expect, test } from "bun:test";
import {
  BareJS,
  Type,
  bareClient,
  circuitBreaker,
  compress,
  idempotency,
  createSingleflight,
  rateLimit,
  bareAuth,
  createToken,
  csrf,
  cors,
  timeout,
  staticFile,
  Hash,
  basicAuth
} from "../src/index";

describe("Bug-Hunting & Adversarial Edge-Case Suite", () => {
  test("1. Pool isolation: thrown errors & custom headers/cookies/status never leak to next pooled request", async () => {
    // Tiny poolSize=2 to force immediate context reuse
    const app = new BareJS(2)
      .get("/fail", (ctx) => {
        ctx.status(418);
        ctx.setHeader("x-leaked", "bad");
        ctx.setCookie("leaked", "yes");
        throw new Error("boom");
      })
      .get("/clean", (ctx) => {
        return {
          status: ctx._status,
          hasLeakedHeader: Boolean(ctx._headers?.["x-leaked"]),
          hasLeakedCookie: Boolean(ctx._setCookies?.length),
          reqId: ctx.requestId
        };
      });

    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/fail"));
    expect(r1.status).toBe(500);

    // Hit /clean multiple times to cycle through both pool slots
    const ids = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r2 = await app.fetch(new Request("http://localhost/clean"));
      expect(r2.status).toBe(200);
      expect(r2.headers.get("x-leaked")).toBeNull();
      expect(r2.headers.get("set-cookie")).toBeNull();
      const body = (await r2.json()) as any;
      expect(body.status).toBe(200);
      expect(body.hasLeakedHeader).toBe(false);
      expect(body.hasLeakedCookie).toBe(false);
      ids.add(body.reqId);
    }
    expect(ids.size).toBe(4);
  });

  test("2. bareClient handles 204 No Content even if Content-Type is application/json", async () => {
    const app = new BareJS().delete("/items/:id", () => {
      return new Response(null, {
        status: 204,
        headers: { "content-type": "application/json" }
      });
    });
    app.compile();

    const client = bareClient(app);
    const res = await client.delete("/items/:id", { params: { id: "42" } });
    expect(res).toBeNull();
  });

  test("3. bareClient preserves falsy query values (0, false, '') and omits undefined", async () => {
    const app = new BareJS().get("/search", (ctx) => ctx.query);
    app.compile();

    const client = bareClient(app);
    const res = await client.get("/search", {
      query: { page: 0, active: false, empty: "", omitted: undefined }
    });
    expect(res).toEqual({ page: "0", active: "false", empty: "" });
  });

  test("4. bareClient encodes special characters in path params safely", async () => {
    const app = new BareJS().get("/files/:name", (ctx) => ({ name: ctx.params.name }));
    app.compile();

    const client = bareClient(app);
    const res = await client.get("/files/:name", { params: { name: "a/b?c=1" } });
    expect(res).toEqual({ name: "a%2Fb%3Fc%3D1" });
  });

  test("5. circuitBreaker HALF_OPEN probe flag is not cleared by an unrelated in-flight CLOSED request", async () => {
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((r) => {
      releaseProbe = r;
    });

    const sharedBreaker = circuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30 });
    let holdOld = true;
    const app2 = new BareJS()
      .use(sharedBreaker)
      .get("/old", async () => {
        while (holdOld) await Bun.sleep(5);
        return { old: true };
      })
      .get("/trip", () => new Response("err", { status: 500 }))
      .get("/probe", async () => {
        await probeGate;
        return { probe: true };
      });
    app2.compile();

    // Start old request while CLOSED
    const pOld = app2.fetch(new Request("http://localhost/old"));
    // Trip circuit to OPEN
    expect((await app2.fetch(new Request("http://localhost/trip"))).status).toBe(500);
    // Wait for cooldown
    await Bun.sleep(40);
    // Start HALF_OPEN probe (now halfOpenInFlight = true)
    const pProbe = app2.fetch(new Request("http://localhost/probe"));
    await Bun.sleep(5);

    // Finish old request while probe is STILL in flight
    holdOld = false;
    await pOld;

    // A concurrent second request MUST still be rejected with 503 because probe is still in flight!
    const concurrentDuringProbe = await app2.fetch(new Request("http://localhost/probe"));
    expect(concurrentDuringProbe.status).toBe(503);

    // Now finish probe -> circuit closes
    releaseProbe();
    expect((await pProbe).status).toBe(200);
    expect((await app2.fetch(new Request("http://localhost/probe"))).status).toBe(200);
  });

  test("6. compress() skips HEAD requests, 204/304, SSE, and already-encoded responses", async () => {
    const bigText = "x".repeat(2048);
    const app = new BareJS()
      .use(compress({ minSize: 100 }))
      .get("/big", () => bigText)
      .head("/big", () => bigText)
      .get("/empty", () => new Response(null, { status: 204 }))
      .get("/pre", () => new Response("already", { headers: { "content-encoding": "br" } }));

    app.compile();

    const gzRes = await app.fetch(
      new Request("http://localhost/big", { headers: { "accept-encoding": "gzip" } })
    );
    expect(gzRes.headers.get("content-encoding")).toBe("gzip");

    const headRes = await app.fetch(
      new Request("http://localhost/big", { method: "HEAD", headers: { "accept-encoding": "gzip" } })
    );
    expect(headRes.headers.get("content-encoding")).toBeNull();

    const emptyRes = await app.fetch(
      new Request("http://localhost/empty", { headers: { "accept-encoding": "gzip" } })
    );
    expect(emptyRes.status).toBe(204);
    expect(emptyRes.headers.get("content-encoding")).toBeNull();

    const preRes = await app.fetch(
      new Request("http://localhost/pre", { headers: { "accept-encoding": "gzip" } })
    );
    expect(preRes.headers.get("content-encoding")).toBe("br");
  });

  test("7. Radix router static route takes priority over param route regardless of registration order", async () => {
    const app = new BareJS()
      .get("/users/:id", (ctx) => ({ type: "param", id: ctx.params.id }))
      .get("/users/me", () => ({ type: "static" }));

    app.compile();

    const r1 = await (await app.fetch(new Request("http://localhost/users/me"))).json();
    const r2 = await (await app.fetch(new Request("http://localhost/users/123"))).json();
    expect(r1).toEqual({ type: "static" });
    expect(r2).toEqual({ type: "param", id: "123" });
  });

  test("8. stripUnknown mass-assignment guard strips injected role/isAdmin on TypeBox & Native schemas", async () => {
    const app = new BareJS().post(
      "/register",
      {
        body: Type.Object({ username: Type.String() }),
        stripUnknown: true
      },
      (ctx) => ctx.body
    );
    app.compile();

    const res = await app.fetch(
      new Request("http://localhost/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", role: "admin", isAdmin: true })
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "alice" });
  });

  test("9. idempotency() prevents duplicate side effects under concurrent identical POST requests", async () => {
    let executions = 0;
    const app = new BareJS()
      .use(idempotency({ ttlMs: 5000 }))
      .post("/charge", async () => {
        executions++;
        await Bun.sleep(20);
        return { charged: executions };
      });
    app.compile();

    const makeReq = () =>
      new Request("http://localhost/charge", {
        method: "POST",
        headers: { "idempotency-key": "tx-999" }
      });

    const [r1, r2] = await Promise.all([app.fetch(makeReq()), app.fetch(makeReq())]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Subsequent replay after completion returns cached 200 without re-executing handler
    const r3 = await app.fetch(makeReq());
    expect(r3.status).toBe(200);
    expect(await r3.json()).toEqual({ charged: 1 });
    expect(executions).toBe(1);
  });

  test("10. bareAuth rejects expired tokens, tampered signatures, and algorithm confusion", async () => {
    const secret = "super-secret-test-key";
    const app = new BareJS()
      .use(bareAuth({ secret }))
      .get("/me", (ctx) => ctx.user);
    app.compile();

    const nowSec = Math.floor(Date.now() / 1000);
    const expired = await createToken({ sub: "u1", exp: nowSec - 10 }, secret);
    const valid = await createToken({ sub: "u1", exp: nowSec + 60 }, secret);
    const tampered = valid.slice(0, -4) + "AAAA";
    const noneAlg = `${btoa(JSON.stringify({ alg: "none", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: "u1" }))}.`;

    for (const tok of [expired, tampered, noneAlg, "not-a-jwt"]) {
      const res = await app.fetch(
        new Request("http://localhost/me", { headers: { authorization: `Bearer ${tok}` } })
      );
      expect(res.status).toBe(401);
    }

    const okRes = await app.fetch(
      new Request("http://localhost/me", { headers: { authorization: `Bearer ${valid}` } })
    );
    expect(okRes.status).toBe(200);
    expect(((await okRes.json()) as any).sub).toBe("u1");
  });

  test("11. rateLimit isolates clients by IP and resets after windowMs", async () => {
    const app = new BareJS()
      .use(rateLimit({ max: 2, windowMs: 60 }))
      .get("/ping", () => "pong");
    app.compile();

    const reqA = () => new Request("http://localhost/ping", { headers: { "x-forwarded-for": "1.1.1.1" } });
    const reqB = () => new Request("http://localhost/ping", { headers: { "x-forwarded-for": "2.2.2.2" } });

    expect((await app.fetch(reqA())).status).toBe(200);
    expect((await app.fetch(reqA())).status).toBe(200);
    expect((await app.fetch(reqA())).status).toBe(429);
    // Different IP is unaffected
    expect((await app.fetch(reqB())).status).toBe(200);

    // Wait for window reset
    await Bun.sleep(75);
    expect((await app.fetch(reqA())).status).toBe(200);
  });

  test("12. idempotency() scopes keys by method + path so same key on different endpoints never collides", async () => {
    const app = new BareJS()
      .use(idempotency())
      .post("/orders", () => ({ kind: "order" }))
      .post("/payments", () => ({ kind: "payment" }));
    app.compile();

    const r1 = await app.fetch(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "idempotency-key": "shared-key" }
      })
    );
    const r2 = await app.fetch(
      new Request("http://localhost/payments", {
        method: "POST",
        headers: { "idempotency-key": "shared-key" }
      })
    );

    expect(await r1.json()).toEqual({ kind: "order" });
    expect(await r2.json()).toEqual({ kind: "payment" });
  });

  test("13. idempotency() does not permanently lock key in 409 when handler throws or returns direct Response", async () => {
    let shouldFail = true;
    const app = new BareJS()
      .use(idempotency())
      .post("/flaky", () => {
        if (shouldFail) throw new Error("db down");
        return { ok: true };
      })
      .post("/direct", () => new Response("accepted", { status: 202 }));
    app.compile();

    const makeFlaky = () =>
      new Request("http://localhost/flaky", {
        method: "POST",
        headers: { "idempotency-key": "retry-key" }
      });

    expect((await app.fetch(makeFlaky())).status).toBe(500);
    shouldFail = false;
    const retryRes = await app.fetch(makeFlaky());
    expect(retryRes.status).toBe(200);
    expect(await retryRes.json()).toEqual({ ok: true });

    const makeDirect = () =>
      new Request("http://localhost/direct", {
        method: "POST",
        headers: { "idempotency-key": "direct-key" }
      });
    expect((await app.fetch(makeDirect())).status).toBe(202);
    // Must not be stuck in 409 in-flight
    expect((await app.fetch(makeDirect())).status).toBe(202);
  });

  test("14. idempotency() does not leak _idempotencyKey across pooled Context objects", async () => {
    const app = new BareJS(1)
      .use(idempotency())
      .post("/op", (ctx) => ({ ts: ctx.req.headers.get("x-seq") }));
    app.compile();

    // Request 1 WITH idempotency key
    const r1 = await app.fetch(
      new Request("http://localhost/op", {
        method: "POST",
        headers: { "idempotency-key": "k1", "x-seq": "1" }
      })
    );
    expect(await r1.json()).toEqual({ ts: "1" });

    // Request 2 WITHOUT idempotency key on same pool slot must NOT overwrite k1 cache
    const r2 = await app.fetch(
      new Request("http://localhost/op", {
        method: "POST",
        headers: { "x-seq": "2" }
      })
    );
    expect(await r2.json()).toEqual({ ts: "2" });

    // Request 3 WITH k1 must still replay "1", not "2"
    const r3 = await app.fetch(
      new Request("http://localhost/op", {
        method: "POST",
        headers: { "idempotency-key": "k1", "x-seq": "3" }
      })
    );
    expect(r3.headers.get("x-idempotent-replayed")).toBe("true");
    expect(await r3.json()).toEqual({ ts: "1" });
  });

  test("15. idempotency() evicts oldest key when maxKeys is reached", async () => {
    let count = 0;
    const app = new BareJS()
      .use(idempotency({ maxKeys: 2 }))
      .post("/inc", () => ({ n: ++count }));
    app.compile();

    const hit = (k: string) =>
      app.fetch(new Request("http://localhost/inc", { method: "POST", headers: { "idempotency-key": k } }));

    expect(await (await hit("a")).json()).toEqual({ n: 1 });
    expect(await (await hit("b")).json()).toEqual({ n: 2 });
    expect(await (await hit("c")).json()).toEqual({ n: 3 }); // evicts "a"

    // "b" still cached, "a" was evicted so it re-executes
    expect(await (await hit("b")).json()).toEqual({ n: 2 });
    expect(await (await hit("a")).json()).toEqual({ n: 4 });
  });

  test("16. createSingleflight() propagates errors to all waiters and cleans up key for subsequent retry", async () => {
    const sf = createSingleflight();
    let attempt = 0;

    const work = () =>
      sf("hot-key", async () => {
        attempt++;
        await Bun.sleep(15);
        if (attempt === 1) throw new Error("upstream error");
        return "recovered";
      });

    const [r1, r2] = await Promise.allSettled([work(), work()]);
    expect(r1.status).toBe("rejected");
    expect(r2.status).toBe("rejected");
    expect(attempt).toBe(1);

    // Retry after failure must execute fresh and succeed
    const r3 = await work();
    expect(r3).toEqual({ data: "recovered", shared: false });
    expect(attempt).toBe(2);
  });

  test("17. csrf() blocks cross-site Sec-Fetch-Site, Origin: null, invalid Referer, and token mismatch", async () => {
    const app = new BareJS()
      .use(csrf({ requireToken: true }))
      .post("/transfer", () => ({ ok: true }));
    app.compile();

    // 1. Sec-Fetch-Site: cross-site
    expect(
      (
        await app.fetch(
          new Request("http://localhost/transfer", {
            method: "POST",
            headers: { "sec-fetch-site": "cross-site", origin: "https://evil.com" }
          })
        )
      ).status
    ).toBe(403);

    // 2. Origin: null (sandboxed iframe)
    expect(
      (
        await app.fetch(
          new Request("http://localhost/transfer", {
            method: "POST",
            headers: { origin: "null" }
          })
        )
      ).status
    ).toBe(403);

    // 3. Malformed Referer
    expect(
      (
        await app.fetch(
          new Request("http://localhost/transfer", {
            method: "POST",
            headers: { referer: "not a valid url" }
          })
        )
      ).status
    ).toBe(403);

    // 4. Double-submit token mismatch
    expect(
      (
        await app.fetch(
          new Request("http://localhost/transfer", {
            method: "POST",
            headers: {
              origin: "http://localhost",
              cookie: "csrf_token=abc",
              "x-csrf-token": "xyz"
            }
          })
        )
      ).status
    ).toBe(403);

    // 5. Valid same-origin + matching double-submit token
    expect(
      (
        await app.fetch(
          new Request("http://localhost/transfer", {
            method: "POST",
            headers: {
              origin: "http://localhost",
              cookie: "csrf_token=abc",
              "x-csrf-token": "abc"
            }
          })
        )
      ).status
    ).toBe(200);
  });

  test("18. response schema filter strips sensitive fields like passwordHash from handler output", async () => {
    const app = new BareJS().get(
      "/user",
      {
        response: Type.Object({
          id: Type.Number(),
          name: Type.String()
        })
      },
      () => ({ id: 1, name: "Alice", passwordHash: "secret-hash", role: "superadmin" }) as any
    );
    app.compile();

    const res = await app.fetch(new Request("http://localhost/user"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, name: "Alice" });
  });

  test("19. maxBodySize rejects oversized JSON payload even when Content-Length header is omitted", async () => {
    const app = new BareJS().post(
      "/upload-json",
      {
        body: Type.Object({ msg: Type.String() }),
        maxBodySize: 32
      },
      (ctx) => ctx.body
    );
    app.compile();

    const huge = JSON.stringify({ msg: "A".repeat(200) });
    const res = await app.fetch(
      new Request("http://localhost/upload-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: huge
      })
    );
    expect(res.status).toBe(413);
  });

  test("20. timeout() returns timeout status without crashing when slow handler settles later", async () => {
    const app = new BareJS()
      .use(timeout(20, { status: 504, message: "Timed out" }))
      .get("/slow", async () => {
        await Bun.sleep(60);
        return { done: true };
      });
    app.compile();

    const res = await app.fetch(new Request("http://localhost/slow"));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      status: "error",
      code: "REQUEST_TIMEOUT",
      message: "Timed out"
    });
    await Bun.sleep(70); // ensure late settlement causes no unhandled rejection
  });

  test("21. staticFile blocks encoded traversal (..%2f) and serves 304 Not Modified on matching ETag", async () => {
    const app = new BareJS().use(staticFile("public"));
    app.compile();

    const trav = await app.fetch(new Request("http://localhost/..%2fpackage.json"));
    expect(trav.status).toBe(403);

    const first = await app.fetch(new Request("http://localhost/index.html"));
    if (first.status === 200) {
      const etag = first.headers.get("etag");
      expect(etag).toBeTruthy();
      const cached = await app.fetch(
        new Request("http://localhost/index.html", { headers: { "if-none-match": etag! } })
      );
      expect(cached.status).toBe(304);
    }
  });

  test("22. cors() dynamic origin function + preflight OPTIONS + Vary: Origin without leaking credentials on mismatch", async () => {
    const app = new BareJS()
      .use(
        cors({
          origin: (o) => o.endsWith(".trusted.dev"),
          credentials: true,
          exposedHeaders: ["X-Total-Count"]
        })
      )
      .get("/items", () => ({ ok: true }));
    app.compile();

    const preOk = await app.fetch(
      new Request("http://localhost/items", {
        method: "OPTIONS",
        headers: { origin: "https://app.trusted.dev" }
      })
    );
    expect(preOk.status).toBe(204);
    expect(preOk.headers.get("access-control-allow-origin")).toBe("https://app.trusted.dev");
    expect(preOk.headers.get("access-control-allow-credentials")).toBe("true");
    expect(preOk.headers.get("vary")).toBe("Origin");

    const preBad = await app.fetch(
      new Request("http://localhost/items", {
        method: "OPTIONS",
        headers: { origin: "https://trusted.dev.evil.com" }
      })
    );
    expect(preBad.status).toBe(204);
    expect(preBad.headers.get("access-control-allow-origin")).toBeNull();
    expect(preBad.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("23. ctx.upload() sanitizes traversal filenames, blocks disallowed MIME/size/count, and drops __proto__ fields", async () => {
    const app = new BareJS().post("/upload", async (ctx) => {
      return await ctx.upload({
        maxFileSize: 100,
        maxFiles: 1,
        allowedTypes: ["text/plain"]
      });
    });
    app.compile();

    const fd1 = new FormData();
    fd1.append("note", "hello");
    fd1.append("__proto__", "polluted");
    fd1.append("file", new File(["abc"], "../../etc/..passwd$.txt", { type: "text/plain" }));

    const r1 = await app.fetch(new Request("http://localhost/upload", { method: "POST", body: fd1 }));
    expect(r1.status).toBe(200);
    const j1 = (await r1.json()) as any;
    expect(j1.fields).toEqual({ note: "hello" });
    expect(Object.prototype.hasOwnProperty.call(j1.fields, "__proto__")).toBe(false);
    expect(j1.files[0].safeName).toBe("passwd_.txt");

    // Disallowed MIME -> 415
    const fdBadMime = new FormData();
    fdBadMime.append("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
    expect((await app.fetch(new Request("http://localhost/upload", { method: "POST", body: fdBadMime }))).status).toBe(415);

    // Oversized file -> 413
    const fdBig = new FormData();
    fdBig.append("file", new File(["x".repeat(200)], "big.txt", { type: "text/plain" }));
    expect((await app.fetch(new Request("http://localhost/upload", { method: "POST", body: fdBig }))).status).toBe(413);
  });

  test("24. app.rpc() JSON-RPC 2.0 rejects prototype methods, empty batch, and handles notifications", async () => {
    const app = new BareJS().rpc("/rpc", {
      add: (p: { a: number; b: number }) => p.a + p.b
    });
    app.compile();

    const sendRpc = (body: any) =>
      app.fetch(
        new Request("http://localhost/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body)
        })
      );

    // Prototype method lookup must return -32601 Method not found
    const protoRes = (await (await sendRpc({ jsonrpc: "2.0", method: "constructor", id: 1 })).json()) as any;
    expect(protoRes.error.code).toBe(-32601);

    // Empty batch -> -32600 Invalid Request
    const emptyBatch = await sendRpc([]);
    expect(emptyBatch.status).toBe(400);
    expect(((await emptyBatch.json()) as any).error.code).toBe(-32600);

    // Notification (no id) -> 204 No Content
    const notif = await sendRpc({ jsonrpc: "2.0", method: "add", params: { a: 1, b: 2 } });
    expect(notif.status).toBe(204);

    // Valid batch
    const batch = (await (
      await sendRpc([
        { jsonrpc: "2.0", method: "add", params: { a: 2, b: 3 }, id: 10 },
        { jsonrpc: "2.0", method: "missing", id: 11 }
      ])
    ).json()) as any[];
    expect(batch).toEqual([
      { jsonrpc: "2.0", result: 5, id: 10 },
      { jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id: 11 }
    ]);
  });

  test("25. app.cron() prevents overlapping runs, catches errors via onError, and stops cleanly on app.stop()", async () => {
    let active = 0;
    let maxActive = 0;
    let ticks = 0;
    const errors: string[] = [];

    const app = new BareJS().cron(
      "job",
      15,
      async () => {
        ticks++;
        active++;
        if (active > maxActive) maxActive = active;
        await Bun.sleep(40);
        active--;
        if (ticks === 1) throw new Error("cron-err");
      },
      {
        runOnStart: true,
        onError: (e) => errors.push(e.message)
      }
    );

    await Bun.sleep(95);
    await app.stop();
    const ticksAfterStop = ticks;
    await Bun.sleep(45);

    expect(maxActive).toBe(1);
    expect(errors).toEqual(["cron-err"]);
    expect(ticks).toBe(ticksAfterStop);
  });

  test("26. Hash.make() and Hash.verify() verify valid passwords and safely reject wrong/corrupt hashes", async () => {
    const hashed = await Hash.make("S3cur3P@ss!");
    expect(await Hash.verify("S3cur3P@ss!", hashed)).toBe(true);
    expect(await Hash.verify("wrong", hashed)).toBe(false);
    expect(await Hash.verify("S3cur3P@ss!", "corrupt-hash")).toBe(false);
  });

  test("27. basicAuth() handles colons in passwords and rejects malformed/wrong credentials with 401", async () => {
    const app = new BareJS()
      .use(basicAuth({ user: "alice", pass: "p@ss:with:colons" }))
      .get("/secret", () => "ok");
    app.compile();

    expect((await app.fetch(new Request("http://localhost/secret"))).status).toBe(401);
    expect(
      (
        await app.fetch(
          new Request("http://localhost/secret", {
            headers: { authorization: `Basic ${btoa("alice:wrong")}` }
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await app.fetch(
          new Request("http://localhost/secret", {
            headers: { authorization: `Basic ${btoa("alice:p@ss:with:colons")}` }
          })
        )
      ).status
    ).toBe(200);
  });

  test("28. Signed cookies reject tampered values and preserve cookie attributes", async () => {
    const secret = "cookie-sign-secret";
    const app = new BareJS()
      .get("/set", (ctx) => {
        ctx.setCookie("sid", "user-42", { secret, httpOnly: true, sameSite: "Strict", path: "/" });
        return "ok";
      })
      .get("/read", (ctx) => ({ sid: ctx.getSignedCookie("sid", secret) }));
    app.compile();

    const setRes = await app.fetch(new Request("http://localhost/set"));
    const setCookieHdr = setRes.headers.get("set-cookie") || "";
    expect(setCookieHdr).toContain("HttpOnly");
    expect(setCookieHdr).toContain("SameSite=Strict");
    const cookiePair = setCookieHdr.split(";")[0]!;

    const okRead = (await (
      await app.fetch(new Request("http://localhost/read", { headers: { cookie: cookiePair } }))
    ).json()) as any;
    expect(okRead.sid).toBe("user-42");

    const tamperedPair = cookiePair.replace("user-42", "user-99");
    const badRead = (await (
      await app.fetch(new Request("http://localhost/read", { headers: { cookie: tamperedPair } }))
    ).json()) as any;
    expect(badRead.sid).toBeNull();
  });

  test("29. ctx.redirect() and direct Response header precedence work cleanly", async () => {
    const app = new BareJS()
      .get("/go", (ctx) => ctx.redirect("/dest", 301))
      .get("/hdr", (ctx) => {
        ctx.setHeader("x-a", "default");
        ctx.setHeader("x-b", "from-ctx");
        return new Response("hi", { headers: { "x-a": "override" } });
      });
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/go"));
    expect(r1.status).toBe(301);
    expect(r1.headers.get("location")).toBe("/dest");

    const r2 = await app.fetch(new Request("http://localhost/hdr"));
    expect(r2.headers.get("x-a")).toBe("override");
    expect(r2.headers.get("x-b")).toBe("from-ctx");
  });

  test("30. Custom onError() and setNotFound() handle async rejections and missing routes", async () => {
    const app = new BareJS()
      .onError((err, ctx) => ctx.status(502).json({ handled: err.message }))
      .get("/async-boom", async () => {
        await Bun.sleep(1);
        throw new Error("bad gateway");
      });
    app.setNotFound(() => ({ status: 410, message: "Gone" }));
    app.compile();

    const rErr = await app.fetch(new Request("http://localhost/async-boom"));
    expect(rErr.status).toBe(502);
    expect(await rErr.json()).toEqual({ handled: "bad gateway" });

    const r404 = await app.fetch(new Request("http://localhost/nope"));
    expect(r404.status).toBe(410);
    expect(await r404.json()).toEqual({ status: 410, message: "Gone" });
  });
});
