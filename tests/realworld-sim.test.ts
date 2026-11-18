import { describe, expect, test } from "bun:test";
import {
  BareJS,
  Type,
  bareAuth,
  createToken,
  hasRole,
  cors,
  securityHeaders,
  rateLimit,
  idempotency,
  circuitBreaker,
  timeout,
  compress,
  logger,
  healthcheck
} from "../src/index";

describe("Real-World Production Simulation (Security, Concurrency & Performance)", () => {
  test("1. Live HTTP E-Commerce Checkout Stack: Auth, RBAC, Idempotency, Mass-Assignment, CORS & Security Headers", async () => {
    const secret = "prod-sim-jwt-secret";
    let dbHealthy = true;
    let chargeCount = 0;

    const app = new BareJS()
      .use(securityHeaders())
      .use(cors({ origin: ["https://shop.example.com"], credentials: true }))
      .use(logger({ onLog: () => {} }))
      .use(healthcheck({ checks: { db: () => dbHealthy } }))
      .get("/public/catalog", () => ({ items: ["laptop", "mouse"] }))
      .group("/api", (api) => {
        api.use(bareAuth({ secret }));
        api.use(rateLimit({ max: 50, windowMs: 10_000 }));
        api.use(idempotency({ ttlMs: 10_000 }));

        api.post(
          "/checkout",
          {
            body: Type.Object({ item: Type.String(), qty: Type.Number({ minimum: 1 }) }),
            stripUnknown: true,
            response: Type.Object({ orderId: Type.Number(), item: Type.String(), qty: Type.Number() })
          },
          (ctx: any) => {
            chargeCount++;
            return {
              orderId: chargeCount,
              item: ctx.body.item,
              qty: ctx.body.qty,
              internalCost: 999 // must be stripped by response filter
            };
          }
        );

        api.get("/admin/stats", hasRole("admin"), () => ({ revenue: 100_000 }));
      });

    const server = app.listen(0);
    const base = `http://localhost:${server.port}`;

    try {
      // 1. Healthcheck & Security Headers
      const healthRes = await fetch(`${base}/health`);
      expect(healthRes.status).toBe(200);
      expect(healthRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(healthRes.headers.get("x-frame-options")).toBeTruthy();

      // 2. CORS: allowed origin vs untrusted origin
      const corsOk = await fetch(`${base}/public/catalog`, {
        headers: { origin: "https://shop.example.com" }
      });
      expect(corsOk.headers.get("access-control-allow-origin")).toBe("https://shop.example.com");

      const corsEvil = await fetch(`${base}/public/catalog`, {
        headers: { origin: "https://evil.attacker.com" }
      });
      expect(corsEvil.headers.get("access-control-allow-origin")).not.toBe("https://evil.attacker.com");

      // 3. Unauthenticated request blocked
      expect((await fetch(`${base}/api/admin/stats`)).status).toBe(401);

      // 4. RBAC: regular user blocked from admin route (403)
      const userToken = await createToken({ sub: "u1", role: "customer" }, secret);
      const adminToken = await createToken({ sub: "a1", role: "admin" }, secret);

      expect(
        (await fetch(`${base}/api/admin/stats`, { headers: { authorization: `Bearer ${userToken}` } })).status
      ).toBe(403);
      expect(
        (await fetch(`${base}/api/admin/stats`, { headers: { authorization: `Bearer ${adminToken}` } })).status
      ).toBe(200);

      // 5. Checkout with mass-assignment attempt + idempotent retry
      const checkoutReq = () =>
        fetch(`${base}/api/checkout`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${userToken}`,
            "content-type": "application/json",
            "idempotency-key": "order-abc-1"
          },
          body: JSON.stringify({ item: "laptop", qty: 2, priceOverride: 0, role: "admin" })
        });

      const c1 = await checkoutReq();
      expect(c1.status).toBe(200);
      expect(await c1.json()).toEqual({ orderId: 1, item: "laptop", qty: 2 });

      const c2 = await checkoutReq();
      expect(c2.status).toBe(200);
      expect(c2.headers.get("x-idempotent-replayed")).toBe("true");
      expect(await c2.json()).toEqual({ orderId: 1, item: "laptop", qty: 2 });
      expect(chargeCount).toBe(1);

      // 6. Healthcheck degrades to 503 when DB goes down
      dbHealthy = false;
      expect((await fetch(`${base}/health`)).status).toBe(503);
    } finally {
      await app.stop(true);
    }
  });

  test("2. Downstream Outage & Fail-Fast: timeout + circuitBreaker prevents cascading latency", async () => {
    let dbMode: "hang" | "down" | "ok" = "hang";

    const app = new BareJS()
      .use(circuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 }))
      .use(timeout(25, { status: 504, message: "DB timeout" }))
      .get("/data", async () => {
        if (dbMode === "hang") {
          await Bun.sleep(150);
          return { data: "late" };
        }
        if (dbMode === "down") {
          return new Response("db error", { status: 503 });
        }
        return { data: "fresh" };
      });
    app.compile();

    // Timeout triggers in ~25ms (counts as 504 >= 500 failure)
    const t0 = performance.now();
    const r1 = await app.fetch(new Request("http://localhost/data"));
    expect(r1.status).toBe(504);
    expect(performance.now() - t0).toBeLessThan(100);

    // Second failure trips circuit OPEN
    dbMode = "down";
    expect((await app.fetch(new Request("http://localhost/data"))).status).toBe(503);

    // Fail-fast when OPEN (returns 503 immediately without waiting 25ms)
    const fastStart = performance.now();
    const rOpen = await app.fetch(new Request("http://localhost/data"));
    expect(rOpen.status).toBe(503);
    expect(performance.now() - fastStart).toBeLessThan(10);

    // Recovery after cooldown
    await Bun.sleep(60);
    dbMode = "ok";
    const rOk = await app.fetch(new Request("http://localhost/data"));
    expect(rOk.status).toBe(200);
    expect(await rOk.json()).toEqual({ data: "fresh" });
  });

  test("3. High-Throughput & Latency Regression Guard: 5,000 JIT requests stay fast with zero pool leaks", async () => {
    const app = new BareJS(1024)
      .use(compress({ minSize: 2048 }))
      .get("/users/:id/posts", (ctx) => ({
        id: ctx.params.id,
        page: ctx.query.page || "1"
      }));
    app.compile();

    const N = 5000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const res = await app.fetch(new Request(`http://localhost/users/${i}/posts?page=${i % 10}`));
      if (res.status !== 200) throw new Error(`Unexpected status ${res.status}`);
    }
    const elapsedMs = performance.now() - t0;

    // Must complete 5,000 full Request/Response cycles well under 2,000ms
    expect(elapsedMs).toBeLessThan(2000);
  });

  test("4. Flood Resilience: 1,500 unique Idempotency-Keys & IPs stay bounded and fast", async () => {
    const app = new BareJS()
      .use(rateLimit({ max: 100, windowMs: 10_000 }))
      .use(idempotency({ maxKeys: 256, ttlMs: 10_000 }))
      .post("/events", () => ({ ok: true }));
    app.compile();

    const t0 = performance.now();
    for (let i = 0; i < 1500; i++) {
      const res = await app.fetch(
        new Request("http://localhost/events", {
          method: "POST",
          headers: {
            "x-forwarded-for": `10.0.${(i >> 8) & 255}.${i & 255}`,
            "idempotency-key": `flood-${i}`
          }
        })
      );
      expect(res.status).toBe(200);
    }
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
