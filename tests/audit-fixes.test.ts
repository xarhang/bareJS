import { describe, expect, test } from "bun:test";
import { BareJS, BareRouter, cors, securityHeaders, idempotency, bareAuth, createToken } from "../src/index";

describe("Audit Fixes (trustProxy, peerIp, error headers, async onError, prefix mounting, idempotency Response)", () => {
  test("1. trustProxy(false) persists on pool overflow and peerIp is forwarded", async () => {
    const app = new BareJS(2).trustProxy(false);
    app.get("/ip", async (ctx) => {
      await new Promise((r) => setTimeout(r, 10));
      return { ip: ctx.ip };
    });

    // Fire 6 concurrent requests so poolSize (2) overflows and creates new Context() instances
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        app.fetch(
          new Request("http://localhost/ip", {
            headers: { "x-forwarded-for": "1.2.3.4" }
          }),
          `10.0.0.${i + 1}`
        )
      )
    );

    for (let i = 0; i < responses.length; i++) {
      const data = await responses[i]!.json();
      expect(data.ip).toBe(`10.0.0.${i + 1}`);
    }
  });

  test("2. BareJS.listen() forwards server.requestIP(req) into ctx.ip when trustProxy(false)", async () => {
    const app = new BareJS().trustProxy(false);
    app.get("/who", (ctx) => ({ ip: ctx.ip }));
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const srv = app.listen(0, "127.0.0.1", false);
    process.env.NODE_ENV = prevEnv;

    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/who`, {
        headers: { "x-forwarded-for": "9.9.9.9" }
      });
      const data = await res.json();
      expect(data.ip).toBe("127.0.0.1");
    } finally {
      await app.stop(true);
    }
  });

  test("3. Error responses (401/500) preserve cors() and securityHeaders()", async () => {
    const app = new BareJS();
    app.use(securityHeaders());
    app.use(cors({ origin: "https://app.example.com" }));
    app.get("/protected", bareAuth({ secret: "s3cr3t" }), () => ({ ok: true }));
    app.get("/boom", () => {
      throw new Error("explode");
    });

    const res401 = await app.fetch(
      new Request("http://localhost/protected", {
        headers: { origin: "https://app.example.com" }
      })
    );
    expect(res401.status).toBe(401);
    expect(res401.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res401.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

    const res500 = await app.fetch(
      new Request("http://localhost/boom", {
        headers: { origin: "https://app.example.com" }
      })
    );
    expect(res500.status).toBe(500);
    expect(res500.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res500.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
  });

  test("4. async onError() returning plain object or string is awaited and preserves headers", async () => {
    const app = new BareJS();
    app.use(securityHeaders());
    app.onError(async (err, ctx) => {
      await Promise.resolve();
      ctx.status(418);
      return { customError: err.message };
    });
    app.get("/fail", () => {
      throw new Error("teapot");
    });

    const res = await app.fetch(new Request("http://localhost/fail"));
    expect(res.status).toBe(418);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ customError: "teapot" });
  });

  test("5. BareRouter prefix mounting via app.route() and app.use()", async () => {
    const api = new BareRouter();
    api.get("/users", () => ({ list: [1, 2] }));
    api.get("/", () => ({ root: true }));

    const v2 = new BareRouter();
    v2.get("/status", () => ({ v2: true }));

    const app = new BareJS();
    app.use(securityHeaders());
    app.route("/api", api);
    app.use("/v2", v2);

    const r1 = await app.fetch(new Request("http://localhost/api/users"));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await r1.json()).toEqual({ list: [1, 2] });

    const r2 = await app.fetch(new Request("http://localhost/api"));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ root: true });

    const r3 = await app.fetch(new Request("http://localhost/v2/status"));
    expect(r3.status).toBe(200);
    expect(await r3.json()).toEqual({ v2: true });
  });

  test("6. idempotency() caches ctx.status(201).json(...) Response objects", async () => {
    let calls = 0;
    const app = new BareJS();
    app.use(idempotency());
    app.post("/orders", (ctx) => {
      calls++;
      return ctx.status(201).json({ orderId: calls });
    });

    const makeReq = () =>
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "idempotency-key": "order-abc-123" }
      });

    const first = await app.fetch(makeReq());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ orderId: 1 });

    // Allow microtask for Response.clone().arrayBuffer() to settle
    await new Promise((r) => setTimeout(r, 10));

    const second = await app.fetch(makeReq());
    expect(second.status).toBe(201);
    expect(second.headers.get("x-idempotent-replayed")).toBe("true");
    expect(await second.json()).toEqual({ orderId: 1 });
    expect(calls).toBe(1);
  });
});
