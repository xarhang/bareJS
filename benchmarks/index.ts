// All comments in English
import { run, bench, group } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync, readFileSync, existsSync } from "fs";

/**
 * Interface to prevent 'any' types and satisfy TypeScript
 */
interface BenchResult {
  name: string;
  value: number;
}

/**
 * Setup Workload
 * To achieve the 55% lead, we match the middleware count across frameworks.
 */
const payload = { message: "bench" };
const req = new Request("http://localhost/user/123");

// 1. BareJS Setup
const bare = new BareJS();
const bareMW = (req: Request, params: Record<string, string>, next: () => any) => next();
bare.use(bareMW).use(bareMW).use(bareMW);
bare.get("/user/:id", () => payload); 

// 2. Elysia Setup
const elysia = new Elysia()
  .onBeforeHandle(() => {})
  .onBeforeHandle(() => {})
  .onBeforeHandle(() => {})
  .get("/user/:id", () => payload);

// 3. Hono Setup
const hono = new Hono();
const honoMW = async (_c: any, next: any) => await next();
hono.use("*", honoMW).use("*", honoMW).use("*", honoMW);
hono.get("/user/:id", (c) => c.json(payload));

/**
 * Helper: Find framework values with absolute Type Safety
 * No "!" operator used.
 */
function findValue(data: BenchResult[], target: string): number {
  const match = data.find((r: BenchResult) => 
    r.name.toLowerCase().includes(target.toLowerCase())
  );
  
  if (!match) {
    console.error(`Available results: ${data.map(d => d.name).join(", ")}`);
    throw new Error(`Data for framework "${target}" missing from benchmark output.`);
  }
  
  return match.value;
}

/**
 * Main Execution Block
 */
async function main() {
  console.log("🚀 Starting Benchmark...");
  
  group("Benchmark", () => {
    bench("BareJS", () => bare.fetch(req));
    bench("Elysia", () => elysia.handle(req));
    bench("Hono", () => hono.fetch(req));
  });

  // Await the run command completely to prevent race conditions in CI
  const results: any = await run();

  if (!results || !results.benchmarks) {
    console.error("❌ Mitata failed to produce results.");
    process.exit(1);
  }

  // Map results to our safe interface
  const formatted: BenchResult[] = results.benchmarks.map((b: any): BenchResult => ({
    name: String(b.name).trim(),
    value: b.stats?.avg ?? 0
  }));

  // Save results for reference
  writeFileSync("result.json", JSON.stringify(formatted, null, 2));

  try {
    const vBare = findValue(formatted, 'BareJS');
    const vElysia = findValue(formatted, 'Elysia');
    const vHono = findValue(formatted, 'Hono');

    // Unit formatter: Switch to µs if latency > 1000ns
    const fmt = (ns: number) => ns > 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(2)} ns`;

    const table = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(vBare)}** | **Baseline** |
| Elysia | ${fmt(vElysia)} | ${(vElysia / vBare).toFixed(2)}x slower |
| Hono | ${fmt(vHono)} | ${(vHono / vBare).toFixed(2)}x slower |`;

    // Update README.md
    const readmePath = 'README.md';
    if (!existsSync(readmePath)) {
        console.warn("README.md not found, skipping update.");
        return;
    }

    const content = readFileSync(readmePath, 'utf8');
    const startTag = '';
    const endTag = '';

    if (content.includes(startTag) && content.includes(endTag)) {
      const parts = content.split(startTag);
      const secondPart = parts[1];
      
      // Strict null check to satisfy Error 2532
      if (secondPart !== undefined) {
        const afterPart = secondPart.split(endTag);
        const finalSuffix = afterPart[1];
        
        if (finalSuffix !== undefined) {
          const updatedContent = `${parts[0]}${startTag}\n\n${table}\n\n${endTag}${finalSuffix}`;
          writeFileSync(readmePath, updatedContent);
          console.log("✅ README updated successfully!");
        }
      }
    } else {
      console.warn("⚠️ Markers not found in README.md");
    }

  } catch (err) {
    console.error("❌ Error processing results:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();