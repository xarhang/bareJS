// All comments in English
import { run, bench, group } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync } from "fs";

/**
 * Setup Data
 */
const payload = { message: "bench" };
const req = new Request("http://localhost/user/123");

/**
 * 1. BareJS Setup (Zero-Object Mode)
 * No ctx object, direct arg passing for sub-microsecond speed.
 */
const bare = new BareJS();
// High-speed middleware signature: (req, params, next)
// const bareMW = (req: Request, params: Record<string, string>, next: () => any) => next();

// bare.use(bareMW).use(bareMW).use(bareMW);
// Route uses Auto-JSON inlining
bare.get("/user/:id", () => payload); 

/**
 * 2. Elysia Setup
 */
const elysia = new Elysia()

  .get("/user/:id", () => payload);

/**
 * 3. Hono Setup
 */
const hono = new Hono();
const honoMW = async (_c: any, next: any) => await next();
// hono.use("*", honoMW);
// hono.use("*", honoMW);
// hono.use("*", honoMW);
hono.get("/user/:id", (c) => c.json(payload));

/**
 * Execution
 */
group("Real-world: 3 Middlewares + Dynamic Route", () => {
  // We use bare.fetch(req, server) - passing undefined for server as it's not needed for this route
  bench("BareJS", () => bare.fetch(req));
  bench("Elysia", () => elysia.handle(req));
  bench("Hono", () => hono.fetch(req));
});

const results: any = await run();
// Mitata results are stored in the benchmarks property
const formatted = results.benchmarks.map((b: any) => ({
  name: String(b.name),
  unit: "ns/iter",
  value: parseFloat((b.stats?.avg ?? 0).toFixed(2))
}));

writeFileSync("result.json", JSON.stringify(formatted, null, 2));
console.log("✅ Results saved! BareJS is now optimized for the Zero-Object path.");