import { Database } from "bun:sqlite";
import { BareJS, Context, Type, securityHeaders } from "../src/index";
import { Elysia, t } from "elysia";
import { Hono } from "hono";
import { bench, group, run } from "mitata";

// ============================================================================
// Real-World Production Benchmark: SQLite DB + Validation + Aggregation + 1000 Concurrency
// ============================================================================

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      qty INTEGER NOT NULL
    );
    CREATE INDEX idx_cat ON orders(category);
  `);
  const ins = db.query("INSERT INTO orders (category, amount, qty) VALUES (?, ?, ?)");
  for (let i = 0; i < 200; i++) {
    ins.run(i % 2 === 0 ? "electronics" : "books", 100 + (i % 50), 2);
  }
  return db;
}

const dbBare = setupDb();
const dbElysia = setupDb();
const dbHono = setupDb();

// 1. BareJS
const bareApp = new BareJS()
  .use(securityHeaders())
  .post(
    "/orders",
    { body: Type.Object({ category: Type.String(), amount: Type.Number(), qty: Type.Integer() }) },
    (ctx: Context) => {
      const row = dbBare
        .query("INSERT INTO orders (category, amount, qty) VALUES (?, ?, ?) RETURNING id")
        .get(ctx.body.category, ctx.body.amount, ctx.body.qty) as any;
      return { ok: true, id: row.id };
    }
  )
  .get("/reports", (ctx: Context) => {
    const cat = ctx.query.category || "electronics";
    const row = dbBare
      .query("SELECT category, COUNT(*) as count, SUM(amount * qty) as revenue FROM orders WHERE category = ?")
      .get(cat) as any;
    return { report: row };
  });

// 2. Elysia
const elysiaApp = new Elysia()
  .onAfterHandle(({ set }) => {
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["x-frame-options"] = "DENY";
    set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
    set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
    set.headers["x-xss-protection"] = "0";
  })
  .post(
    "/orders",
    ({ body }) => {
      const row = dbElysia
        .query("INSERT INTO orders (category, amount, qty) VALUES (?, ?, ?) RETURNING id")
        .get(body.category, body.amount, body.qty) as any;
      return { ok: true, id: row.id };
    },
    { body: t.Object({ category: t.String(), amount: t.Number(), qty: t.Integer() }) }
  )
  .get("/reports", ({ query }) => {
    const cat = query.category || "electronics";
    const row = dbElysia
      .query("SELECT category, COUNT(*) as count, SUM(amount * qty) as revenue FROM orders WHERE category = ?")
      .get(cat) as any;
    return { report: row };
  });

// 3. Hono
const honoApp = new Hono()
  .use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "strict-origin-when-cross-origin");
    c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    c.header("x-xss-protection", "0");
  })
  .post("/orders", async (c) => {
    const body = await c.req.json();
    if (typeof body?.category !== "string" || typeof body?.amount !== "number" || !Number.isInteger(body?.qty)) {
      return c.json({ error: "Invalid" }, 400);
    }
    const row = dbHono
      .query("INSERT INTO orders (category, amount, qty) VALUES (?, ?, ?) RETURNING id")
      .get(body.category, body.amount, body.qty) as any;
    return c.json({ ok: true, id: row.id });
  })
  .get("/reports", (c) => {
    const cat = c.req.query("category") || "electronics";
    const row = dbHono
      .query("SELECT category, COUNT(*) as count, SUM(amount * qty) as revenue FROM orders WHERE category = ?")
      .get(cat) as any;
    return c.json({ report: row });
  });

bareApp.compile();

const payload = JSON.stringify({ category: "electronics", amount: 150, qty: 2 });
const reqReport = new Request("http://localhost/reports?category=electronics");
const makeOrderReq = () =>
  new Request("http://localhost/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload
  });

import { writeFileSync } from "fs";

function extractStats(b: any) {
  const stats = b?.stats ?? b?.runs?.[0]?.stats ?? {};
  return {
    name: String(b?.alias || b?.name || "Unknown").trim(),
    avg: Number(stats.avg ?? stats.mean ?? 0),
    min: Number(stats.min ?? 0),
    p99: Number(stats.p99 ?? 0)
  };
}

async function main() {
  console.log("🚀 Production DB Benchmark (SQLite + Security Headers + Validation + Reports)\n");

  group("6. SQLite Report (SUM/AVG/GROUP BY)", () => {
    bench("BareJS", () => bareApp.fetch(reqReport));
    bench("Elysia", () => elysiaApp.handle(reqReport));
    bench("Hono", () => honoApp.fetch(reqReport));
  });

  group("7. SQLite Write (POST + Validate + INSERT)", () => {
    bench("BareJS", () => bareApp.fetch(makeOrderReq()));
    bench("Elysia", () => elysiaApp.handle(makeOrderReq()));
    bench("Hono", () => honoApp.fetch(makeOrderReq()));
  });

  const results: any = await run();
  const benches = (results?.benchmarks || []).map(extractStats);

  const scenarios = [
    { scenario: "6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)", results: benches.slice(0, 3) },
    { scenario: "7. SQLite Write (`POST` + Validate + `INSERT`)", results: benches.slice(3, 6) }
  ];

  writeFileSync("production-result.json", JSON.stringify(scenarios, null, 2));
  console.log("✅ production-result.json generated successfully.");

  dbBare.close();
  dbElysia.close();
  dbHono.close();
}

main();
