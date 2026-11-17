import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import {
  BareJS,
  Context,
  Type,
  Hash,
  bareAuth,
  createToken,
  hasRole,
  securityHeaders,
  rateLimit,
  timeout
} from "../src/index";

describe("Real-World Production Test: SQLite DB + Processing + Reports + Concurrency", () => {
  let db: Database;
  let app: BareJS;
  let server: any;
  let baseUrl: string;
  const JWT_SECRET = "prod_test_jwt_secret_key_32chars!";
  const COOKIE_SECRET = "prod_test_cookie_secret_32chars!";

  beforeAll(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        qty INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'paid',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_orders_cat ON orders(category);
    `);

    app = new BareJS();
    app.use(securityHeaders());
    app.use(timeout(5000));
    app.use(rateLimit({ windowMs: 60_000, max: 2000 }));

    app.onStop(() => {
      db.close();
    });

    // 1. Register (Argon2id + SQLite)
    app.post(
      "/auth/register",
      {
        body: Type.Object({
          email: Type.String({ minLength: 3 }),
          password: Type.String({ minLength: 6 }),
          role: Type.Optional(Type.String())
        })
      },
      async (ctx: Context) => {
        const hash = await Hash.make(ctx.body.password);
        const role = ctx.body.role === "admin" ? "admin" : "user";
        const stmt = db.query("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?) RETURNING id, email, role");
        const user = stmt.get(ctx.body.email, hash, role) as any;
        return ctx.status(201).json({ user, requestId: ctx.requestId });
      }
    );

    // 2. Login (Argon2id verify + JWT + Signed Cookie)
    app.post(
      "/auth/login",
      {
        body: Type.Object({
          email: Type.String(),
          password: Type.String()
        })
      },
      async (ctx: Context) => {
        const user = db.query("SELECT * FROM users WHERE email = ?").get(ctx.body.email) as any;
        if (!user || !(await Hash.verify(ctx.body.password, user.password_hash))) {
          return ctx.status(401).json({ error: "Invalid credentials" });
        }
        const token = await createToken({ sub: String(user.id), email: user.email, role: user.role }, JWT_SECRET, 3600);
        ctx.setCookie("sid", String(user.id), { secret: COOKIE_SECRET, httpOnly: true, sameSite: "Lax" });
        return { token, role: user.role };
      }
    );

    // 3. Create Order (Authenticated + Schema Validation + SQLite Transaction)
    app.post(
      "/orders",
      bareAuth(JWT_SECRET),
      {
        body: Type.Object({
          category: Type.String({ minLength: 1 }),
          amount: Type.Number({ minimum: 0.01 }),
          qty: Type.Integer({ minimum: 1 })
        })
      },
      (ctx: Context) => {
        const userId = Number(ctx.get('user').sub);
        const row = db
          .query(
            "INSERT INTO orders (user_id, category, amount, qty, status, created_at) VALUES (?, ?, ?, ?, 'paid', ?) RETURNING *"
          )
          .get(userId, ctx.body.category, ctx.body.amount, ctx.body.qty, new Date().toISOString()) as any;
        return ctx.status(201).json({ order: row, requestId: ctx.requestId });
      }
    );

    // 4. Data Processing & Analytics Report (Admin Only + Query Coercion + SQL Aggregation)
    app.get(
      "/reports/summary",
      bareAuth(JWT_SECRET),
      hasRole("admin"),
      {
        query: Type.Object({
          minTotal: Type.Optional(Type.Number()),
          category: Type.Optional(Type.String())
        })
      },
      (ctx: Context) => {
        const minTotal = ctx.query.minTotal ?? 0;
        const catFilter = ctx.query.category;

        const rows = catFilter
          ? (db
              .query(
                `SELECT category, COUNT(*) as orderCount, SUM(qty) as totalQty, SUM(amount * qty) as revenue
                 FROM orders WHERE category = ? GROUP BY category HAVING revenue >= ?`
              )
              .all(catFilter, minTotal) as any[])
          : (db
              .query(
                `SELECT category, COUNT(*) as orderCount, SUM(qty) as totalQty, SUM(amount * qty) as revenue
                 FROM orders GROUP BY category HAVING revenue >= ? ORDER BY revenue DESC`
              )
              .all(minTotal) as any[]);

        const grandTotal = rows.reduce((acc, r) => acc + Number(r.revenue || 0), 0);
        return {
          generatedAt: new Date().toISOString(),
          requestId: ctx.requestId,
          grandTotal,
          categories: rows
        };
      }
    );

    // 5. Export CSV Report
    app.get("/reports/export.csv", bareAuth(JWT_SECRET), hasRole("admin"), () => {
      const rows = db.query("SELECT id, user_id, category, amount, qty, status FROM orders ORDER BY id ASC").all() as any[];
      const lines = ["id,user_id,category,amount,qty,total,status"];
      for (const r of rows) {
        lines.push(`${r.id},${r.user_id},${JSON.stringify(r.category)},${r.amount},${r.qty},${(r.amount * r.qty).toFixed(2)},${r.status}`);
      }
      return new Response(lines.join("\n"), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="orders-report.csv"'
        }
      });
    });

    // 6. Receipt Upload
    app.post("/orders/receipt", bareAuth(JWT_SECRET), async (ctx: Context) => {
      const { fields, files } = await ctx.upload({
        maxFileSize: 1024 * 100,
        allowedTypes: ["text/plain", "application/pdf"]
      });
      return { orderId: fields.orderId, uploaded: files.map((f) => f.safeName) };
    });

    // 7. Streaming Report Progress via SSE
    app.get("/reports/stream", bareAuth(JWT_SECRET), (ctx: Context) =>
      ctx.sse(async (send) => {
        const count = (db.query("SELECT COUNT(*) as c FROM orders").get() as any).c;
        send({ step: "query", totalOrders: count }, "progress", "1");
        send({ step: "done" }, "complete", "2");
      })
    );

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    server = app.listen(0, "127.0.0.1", false);
    process.env.NODE_ENV = prevEnv;
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await app.stop(true);
  });

  test("End-to-End Real DB Workflow: Register -> Login -> Orders -> SQL Aggregation -> CSV Export -> Upload -> SSE", async () => {
    // Register admin & regular user
    const regAdmin = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@shop.la", password: "AdminPassword123!", role: "admin" })
    });
    expect(regAdmin.status).toBe(201);

    const regUser = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "buyer@shop.la", password: "BuyerPassword123!" })
    });
    expect(regUser.status).toBe(201);

    // Login both
    const loginAdmin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@shop.la", password: "AdminPassword123!" })
    });
    expect(loginAdmin.status).toBe(200);
    const adminToken = (await loginAdmin.json()).token;

    const loginUser = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "buyer@shop.la", password: "BuyerPassword123!" })
    });
    const userToken = (await loginUser.json()).token;

    // Create orders
    const ordersToCreate = [
      { category: "electronics", amount: 500, qty: 2 },
      { category: "electronics", amount: 250, qty: 1 },
      { category: "books", amount: 25, qty: 4 }
    ];
    for (const o of ordersToCreate) {
      const r = await fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify(o)
      });
      expect(r.status).toBe(201);
    }

    // RBAC check: regular user blocked from admin report (403)
    const userReport = await fetch(`${baseUrl}/reports/summary`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    expect(userReport.status).toBe(403);

    // Admin report aggregation + query coercion (?minTotal=200)
    const adminReport = await fetch(`${baseUrl}/reports/summary?minTotal=200`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(adminReport.status).toBe(200);
    const reportJson = await adminReport.json();
    expect(reportJson.grandTotal).toBe(1250);
    expect(reportJson.categories.length).toBe(1);
    expect(reportJson.categories[0].category).toBe("electronics");
    expect(reportJson.categories[0].orderCount).toBe(2);

    // SQL Injection attempt in query parameter -> safely parameterized -> returns empty, no error!
    const sqliRes = await fetch(
      `${baseUrl}/reports/summary?category=${encodeURIComponent("' OR 1=1 --")}`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(sqliRes.status).toBe(200);
    expect((await sqliRes.json()).categories.length).toBe(0);

    // CSV Report Export + security headers preserved on Response
    const csvRes = await fetch(`${baseUrl}/reports/export.csv`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("x-content-type-options")).toBe("nosniff");
    const csvText = await csvRes.text();
    expect(csvText).toContain("id,user_id,category,amount,qty,total,status");
    expect(csvText).toContain('"electronics",500,2,1000.00,paid');

    // Receipt upload
    const fd = new FormData();
    fd.append("orderId", "1");
    fd.append("receipt", new File(["paid receipt"], "../../receipt.txt", { type: "text/plain" }));
    const upRes = await fetch(`${baseUrl}/orders/receipt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
      body: fd
    });
    expect(upRes.status).toBe(200);
    expect((await upRes.json()).uploaded).toEqual(["receipt.txt"]);

    // SSE Streaming Report Progress
    const sseRes = await fetch(`${baseUrl}/reports/stream`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(sseRes.status).toBe(200);
    const sseText = await sseRes.text();
    expect(sseText).toContain('"totalOrders":3');
    expect(sseText).toContain("event: complete");
  });

  test("Concurrent Production Load: 1000 parallel DB writes + reads with zero leakage", async () => {
    const loginAdmin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@shop.la", password: "AdminPassword123!" })
    });
    const adminToken = (await loginAdmin.json()).token;

    const tasks = Array.from({ length: 1000 }, (_, i) => {
      if (i % 2 === 0) {
        return fetch(`${baseUrl}/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`,
            "X-Request-Id": `load-${i}`
          },
          body: JSON.stringify({ category: "load", amount: 10, qty: 1 })
        }).then(async (r) => ({ status: r.status, body: await r.json(), expectedId: `load-${i}` }));
      }
      return fetch(`${baseUrl}/reports/summary`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "X-Request-Id": `load-${i}`
        }
      }).then(async (r) => ({ status: r.status, body: await r.json(), expectedId: `load-${i}` }));
    });

    const results = await Promise.all(tasks);
    for (const res of results) {
      expect(res.status === 200 || res.status === 201).toBe(true);
      expect(res.body.requestId).toBe(res.expectedId);
    }

    // Verify all 500 concurrent writes persisted accurately (500 * 10 = 5000)
    const finalReport = await fetch(`${baseUrl}/reports/summary?category=load`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const finalJson = await finalReport.json();
    expect(finalJson.categories[0].orderCount).toBe(500);
    expect(finalJson.categories[0].revenue).toBe(5000);
  });
});
