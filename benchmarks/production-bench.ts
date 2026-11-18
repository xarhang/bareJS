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

const prevEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const sBare = bareApp.listen(0, "127.0.0.1", false);
const sElysia = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: elysiaApp.fetch });
const sHono = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: honoApp.fetch });
process.env.NODE_ENV = prevEnv;

const baseBare = `http://127.0.0.1:${sBare.port}`;
const baseElysia = `http://127.0.0.1:${sElysia.port}`;
const baseHono = `http://127.0.0.1:${sHono.port}`;

const payload = JSON.stringify({ category: "electronics", amount: 150, qty: 2 });

async function runConcurrencyTest(name: string, baseUrl: string, count = 1000) {
  const start = performance.now();
  const tasks = Array.from({ length: count }, (_, i) => {
    if (i % 2 === 0) {
      return fetch(`${baseUrl}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      }).then((r) => r.text().then(() => r.status));
    }
    return fetch(`${baseUrl}/reports?category=electronics`).then((r) => r.text().then(() => r.status));
  });
  const statuses = await Promise.all(tasks);
  const ms = performance.now() - start;
  const ok = statuses.filter((s) => s === 200).length;
  const rps = Math.round((count / ms) * 1000);
  console.log(`  ${name.padEnd(8)} | ${count} reqs in ${ms.toFixed(2)} ms | ${rps.toLocaleString()} req/s | OK: ${ok}/${count}`);
}

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

  group("A. Live HTTP DB Report (SQL Aggregation + Query)", () => {
    bench("BareJS", async () => {
      const r = await fetch(`${baseBare}/reports?category=electronics`);
      await r.arrayBuffer();
    });
    bench("Elysia", async () => {
      const r = await fetch(`${baseElysia}/reports?category=electronics`);
      await r.arrayBuffer();
    });
    bench("Hono", async () => {
      const r = await fetch(`${baseHono}/reports?category=electronics`);
      await r.arrayBuffer();
    });
  });

  group("B. Live HTTP DB Write (POST JSON + Validation + INSERT)", () => {
    bench("BareJS", async () => {
      const r = await fetch(`${baseBare}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      });
      await r.arrayBuffer();
    });
    bench("Elysia", async () => {
      const r = await fetch(`${baseElysia}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      });
      await r.arrayBuffer();
    });
    bench("Hono", async () => {
      const r = await fetch(`${baseHono}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      });
      await r.arrayBuffer();
    });
  });

  // Fair warmup for all 3 HTTP + SQLite servers before measurement
  for (let i = 0; i < 50; i++) {
    await fetch(`${baseBare}/reports?category=electronics`).then((r) => r.arrayBuffer());
    await fetch(`${baseElysia}/reports?category=electronics`).then((r) => r.arrayBuffer());
    await fetch(`${baseHono}/reports?category=electronics`).then((r) => r.arrayBuffer());
    await fetch(`${baseBare}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }).then((r) => r.arrayBuffer());
    await fetch(`${baseElysia}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }).then((r) => r.arrayBuffer());
    await fetch(`${baseHono}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload }).then((r) => r.arrayBuffer());
  }

  const results: any = await run();
  const benches = (results?.benchmarks || []).map(extractStats);

  const scenarios = [
    { scenario: "7. Live SQLite Report (`SUM`/`AVG`/`GROUP BY`)", results: benches.slice(0, 3) },
    { scenario: "8. Live SQLite Write (`POST` + Validate + `INSERT`)", results: benches.slice(3, 6) }
  ];

  writeFileSync("production-result.json", JSON.stringify(scenarios, null, 2));
  console.log("✅ production-result.json generated successfully.");

  console.log("\n🔥 C. 1,000 Concurrent Mixed DB Requests (500 Writes + 500 Report Reads):");
  await runConcurrencyTest("BareJS", baseBare, 1000);
  await runConcurrencyTest("Elysia", baseElysia, 1000);
  await runConcurrencyTest("Hono", baseHono, 1000);

  sBare.stop(true);
  sElysia.stop(true);
  sHono.stop(true);
  dbBare.close();
  dbElysia.close();
  dbHono.close();
}

main();
