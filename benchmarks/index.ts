// All comments in English
import { run, bench, group } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync, readFileSync } from "fs";

// Setup Data
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

group("Benchmark", () => {
  bench("BareJS", () => bare.fetch(req));
  bench("Elysia", () => elysia.handle(req));
  bench("Hono", () => hono.fetch(req));
});

const results: any = await run();

// 1. Extract and format results safely
const formatted = results.benchmarks.map((b: any) => ({
  name: String(b.name),
  value: b.stats?.avg ?? 0
}));

// Save for GitHub Action Benchmark tool
writeFileSync("result.json", JSON.stringify(formatted, null, 2));

try {
  // 2. Helper to find values using case-insensitive partial match
  const getVal = (target: string): number => {
    const entry = formatted.find((r: any) => 
      r.name.toLowerCase().includes(target.toLowerCase())
    );
    if (!entry) throw new Error(`Data for ${target} is missing.`);
    return entry.value as number;
  };

  const vBare = getVal('BareJS');
  const vElysia = getVal('Elysia');
  const vHono = getVal('Hono');

  // Convert ns to µs for human-readable display if values are high
  const fmt = (ns: number) => ns > 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(2)} ns`;

  const table = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(vBare)}** | **Baseline** |
| Elysia | ${fmt(vElysia)} | ${(vElysia / vBare).toFixed(2)}x slower |
| Hono | ${fmt(vHono)} | ${(vHono / vBare).toFixed(2)}x slower |`;

  // 3. Update README safely using split/join to avoid index errors
  const readmePath = 'README.md';
  const content = readFileSync(readmePath, 'utf8');
  const startTag = '';
  const endTag = '';

  if (!content.includes(startTag) || !content.includes(endTag)) {
    throw new Error("Markers not found in README.md");
  }

  const parts = content.split(startTag);
  const afterEnd = parts[1]!.split(endTag)[1];
  const finalContent = `${parts[0]}${startTag}\n\n${table}\n\n${endTag}${afterEnd}`;

  writeFileSync(readmePath, finalContent);
  console.log('✅ Benchmark and README update successful!');

} catch (err) {
  console.error('❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}