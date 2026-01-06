// All comments in English
import { run, bench, group } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync, readFileSync, existsSync } from "fs";

/**
 * Setup Data
 */
const payload = { message: "bench" };
const req = new Request("http://localhost/user/123");

const bare = new BareJS();
const bareMW = (req: Request, params: Record<string, string>, next: () => any) => next();
bare.use(bareMW).use(bareMW).use(bareMW);
bare.get("/user/:id", () => payload); 

const elysia = new Elysia()
  .onBeforeHandle(() => {})
  .onBeforeHandle(() => {})
  .onBeforeHandle(() => {})
  .get("/user/:id", () => payload);

const hono = new Hono();
const honoMW = async (_c: any, next: any) => await next();
hono.use("*", honoMW).use("*", honoMW).use("*", honoMW);
hono.get("/user/:id", (c) => c.json(payload));

/**
 * Execution
 */
group("Benchmark", () => {
  bench("BareJS", () => bare.fetch(req));
  bench("Elysia", () => elysia.handle(req));
  bench("Hono", () => hono.fetch(req));
});

const results: any = await run();

// 1. Safety check for Mitata output
if (!results || !results.benchmarks) {
  console.error("❌ Error: Benchmark failed to produce results.");
  process.exit(1);
}

const formatted = results.benchmarks.map((b: any) => ({
  name: String(b.name),
  value: b.stats?.avg ?? 0
}));

writeFileSync("result.json", JSON.stringify(formatted, null, 2));

/**
 * Update README Logic (integrated for safety)
 */
try {
  const getVal = (name: string): number => {
    const res = formatted.find((r: any) => r.name.toLowerCase().includes(name.toLowerCase()));
    if (!res || typeof res.value !== 'number') {
      throw new Error(`Data for ${name} is missing.`);
    }
    return res.value;
  };

  const vBare = getVal('BareJS');
  const vElysia = getVal('Elysia');
  const vHono = getVal('Hono');

  const fmt = (ns: number) => ns > 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(2)} ns`;

  const table = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(vBare)}** | **Baseline** |
| Elysia | ${fmt(vElysia)} | ${(vElysia / vBare).toFixed(2)}x slower |
| Hono | ${fmt(vHono)} | ${(vHono / vBare).toFixed(2)}x slower |`;

  const readmePath = 'README.md';
  if (!existsSync(readmePath)) throw new Error("README.md not found");
  
  const content = readFileSync(readmePath, 'utf8');
  const startTag = '';
  const endTag = '';

  const parts = content.split(startTag);
  if (parts.length < 2) throw new Error("Start marker missing");
  
  const afterEnd = parts[1]!.split(endTag);
  if (afterEnd.length < 2) throw new Error("End marker missing");

  const finalContent = `${parts[0]}${startTag}\n\n${table}\n\n${endTag}${afterEnd[1]}`;

  writeFileSync(readmePath, finalContent);
  console.log('✅ Benchmark complete & README updated!');

} catch (err) {
  console.error('❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}