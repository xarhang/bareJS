import { BareJS, Context, Type } from "../src/index";
import { Elysia, t } from "elysia";
import { Hono } from "hono";
import { bench, group, run } from "mitata";

// ============================================================================
// Fair, Unbiased Multi-Scenario Benchmark Suite
// All frameworks use identical inputs, identical fresh Request objects when
// reading bodies, and identical calling conventions.
// ============================================================================

// ----------------------------------------------------------------------------
// Scenario 1: 100 Routes + Dynamic Params (Radix Tree Routing Scale)
// ----------------------------------------------------------------------------
const bare100 = new BareJS();
const elysia100 = new Elysia();
const hono100 = new Hono();

for (let i = 0; i < 99; i++) {
  const path = `/api/v1/resource${i}/:id/sub/:subId`;
  bare100.get(path, (ctx: Context) => ctx.json({ i, id: ctx.params.id }));
  elysia100.get(path, ({ params }) => ({ i, id: params.id }));
  hono100.get(path, (c) => c.json({ i, id: c.req.param("id") }));
}
const TARGET_100 = "/api/v1/resource77/:id/sub/:subId";
bare100.get(TARGET_100, (ctx: Context) => ctx.json({ id: ctx.params.id, sub: ctx.params.subId }));
elysia100.get(TARGET_100, ({ params }) => ({ id: params.id, sub: params.subId }));
hono100.get(TARGET_100, (c) => c.json({ id: c.req.param("id"), sub: c.req.param("subId") }));
bare100.compile();

const req100 = new Request("http://localhost/api/v1/resource77/abc/sub/xyz");

// ----------------------------------------------------------------------------
// Scenario 2: 10 Middlewares + Deep Path (Fair calling convention)
// ----------------------------------------------------------------------------
const bareMw = new BareJS();
const elysiaMw = new Elysia();
const honoMw = new Hono();

for (let i = 0; i < 10; i++) {
  bareMw.use((ctx: Context, next: any) => next());
  elysiaMw.onBeforeHandle(() => {});
  honoMw.use("*", (c, next) => next());
}
const DEEP_PATH = "/api/v1/user/:id/profile/settings/:category";
bareMw.get(DEEP_PATH, (ctx: Context) => ctx.json({ id: ctx.params.id }));
elysiaMw.get(DEEP_PATH, ({ params }) => ({ id: params.id }));
honoMw.get(DEEP_PATH, (c) => c.json({ id: c.req.param("id") }));
bareMw.compile();

const reqMw = new Request("http://localhost/api/v1/user/123/profile/settings/security");

// ----------------------------------------------------------------------------
// Scenario 3: POST JSON + TypeBox Schema Validation
// ----------------------------------------------------------------------------
const bareVal = new BareJS();
bareVal.post(
  "/users",
  { body: Type.Object({ name: Type.String(), age: Type.Number() }) },
  (ctx: Context) => ctx.json({ ok: true, name: ctx.body.name, age: ctx.body.age })
);
bareVal.compile();

const elysiaVal = new Elysia().post(
  "/users",
  ({ body }) => ({ ok: true, name: body.name, age: body.age }),
  { body: t.Object({ name: t.String(), age: t.Number() }) }
);

const honoVal = new Hono().post("/users", async (c) => {
  const body = await c.req.json();
  if (typeof body?.name !== "string" || typeof body?.age !== "number") {
    return c.json({ error: "Invalid" }, 400);
  }
  return c.json({ ok: true, name: body.name, age: body.age });
});

const jsonPayload = JSON.stringify({ name: "Alice", age: 25 });
const makePostReq = () =>
  new Request("http://localhost/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: jsonPayload
  });

// ----------------------------------------------------------------------------
// Scenario 4: Query Parsing + Async Handler
// ----------------------------------------------------------------------------
const bareQuery = new BareJS();
bareQuery.get("/search", async (ctx: Context) =>
  ctx.json({ q: ctx.query.q, page: ctx.query.page, sort: ctx.query.sort })
);
bareQuery.compile();

const elysiaQuery = new Elysia().get("/search", async ({ query }) => ({
  q: query.q,
  page: query.page,
  sort: query.sort
}));

const honoQuery = new Hono().get("/search", async (c) =>
  c.json({
    q: c.req.query("q"),
    page: c.req.query("page"),
    sort: c.req.query("sort")
  })
);

const reqQuery = new Request("http://localhost/search?q=barejs&page=2&sort=desc");

// ----------------------------------------------------------------------------
// Scenario 5: Response Schema Secret Stripping & Validation
// ----------------------------------------------------------------------------
const bareResSchema = new BareJS();
bareResSchema.get(
  "/user-safe",
  {
    response: Type.Object({
      id: Type.Number(),
      name: Type.String(),
      role: Type.String()
    })
  },
  () => ({
    id: 1,
    name: "Somsack",
    role: "admin",
    password_hash: "$argon2id$v=19$m=65536,t=2,p=1$secret",
    internal_token: "super-secret-key"
  })
);
bareResSchema.compile();

const elysiaResSchema = new Elysia().get(
  "/user-safe",
  () => ({
    id: 1,
    name: "Somsack",
    role: "admin",
    password_hash: "$argon2id$v=19$m=65536,t=2,p=1$secret",
    internal_token: "super-secret-key"
  }),
  {
    response: t.Object({
      id: t.Number(),
      name: t.String(),
      role: t.String()
    })
  }
);

const reqResSchema = new Request("http://localhost/user-safe");

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
  group("1. 100 Routes + Dynamic Params", () => {
    bench("BareJS", () => bare100.fetch(req100));
    bench("Elysia", () => elysia100.handle(req100));
    bench("Hono", () => hono100.fetch(req100));
  });

  group("2. 10 Middlewares + Deep Path", () => {
    bench("BareJS", () => bareMw.fetch(reqMw));
    bench("Elysia", () => elysiaMw.handle(reqMw));
    bench("Hono", () => honoMw.fetch(reqMw));
  });

  group("3. POST JSON + Schema Validation", () => {
    bench("BareJS", () => bareVal.fetch(makePostReq()));
    bench("Elysia", () => elysiaVal.handle(makePostReq()));
    bench("Hono", () => honoVal.fetch(makePostReq()));
  });

  group("4. Async Handler + Query Parsing", () => {
    bench("BareJS", () => bareQuery.fetch(reqQuery));
    bench("Elysia", () => elysiaQuery.handle(reqQuery));
    bench("Hono", () => honoQuery.fetch(reqQuery));
  });

  group("5. Response Schema Secret Stripping", () => {
    bench("BareJS", () => bareResSchema.fetch(reqResSchema));
    bench("Elysia", () => elysiaResSchema.handle(reqResSchema));
  });

  const results: any = await run();
  const benches = (results?.benchmarks || []).map(extractStats);

  const scenarios = [
    { scenario: "1. 100 Routes + Dynamic Params", results: benches.slice(0, 3) },
    { scenario: "2. 10 Middlewares + Deep Path", results: benches.slice(3, 6) },
    { scenario: "3. POST JSON + Schema Validation", results: benches.slice(6, 9) },
    { scenario: "4. Async Handler + Query Parsing", results: benches.slice(9, 12) },
    { scenario: "5. Response Schema Secret Stripping", results: benches.slice(12, 14) }
  ];

  writeFileSync("fair-suite-result.json", JSON.stringify(scenarios, null, 2));
  console.log("✅ fair-suite-result.json generated successfully.");
}

main();

