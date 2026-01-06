// All comments in English
import { run, bench, group } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync, readFileSync, existsSync } from "fs";

/**
 * Interface for Type Safety
 */
interface BenchResult {
  name: string;
  value: number;
}

/**
 * Setup Data & Workload
 * To beat Elysia by 55%, we match the 3-middleware workload
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
 * Helper: Find value without using "!" (Non-null assertion)
 * Ensures 100% Type Safety
 */
function findFrameworkValue(results: BenchResult[], target: string): number {
  const match = results.find((r: BenchResult) => 
    r.name.toLowerCase().includes(target.toLowerCase())
  );
  
  if (!match) {
    console.error(`Available benchmarks: ${results.map((r: BenchResult) => r.name).join(", ")}`);
    throw new Error(`Data for ${target} was not found in results.`);
  }
  
  return match.value;
}

/**
 * Execution
 */
async function startBench() {
  const results: any = await run();

  // 1. Process Results safely
  const rawBenchmarks = results?.benchmarks ?? [];
  const formatted: BenchResult[] = rawBenchmarks.map((b: any): BenchResult => ({
    name: String(b.name).trim(),
    value: b.stats?.avg ?? 0
  }));

  // Save raw data for other tools
  writeFileSync("result.json", JSON.stringify(formatted, null, 2));

  try {
    // 2. Extract Values safely using Type Guard helper
    const vBare = findFrameworkValue(formatted, 'BareJS');
    const vElysia = findFrameworkValue(formatted, 'Elysia');
    const vHono = findFrameworkValue(formatted, 'Hono');

    // 3. Format units (Auto-switch between ns and µs)
    const fmt = (ns: number) => ns > 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(2)} ns`;

    const table = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(vBare)}** | **Baseline** |
| Elysia | ${fmt(vElysia)} | ${(vElysia / vBare).toFixed(2)}x slower |
| Hono | ${fmt(vHono)} | ${(vHono / vBare).toFixed(2)}x slower |`;

    // 4. Update README with Safety logic
    const readmePath = 'README.md';
    if (!existsSync(readmePath)) return;

    const content = readFileSync(readmePath, 'utf8');
    const startTag = '';
    const endTag = '';

    if (content.includes(startTag) && content.includes(endTag)) {
      const parts = content.split(startTag);
      
      // ตรวจสอบว่ามีเนื้อหาหลัง startTag หรือไม่
      const secondPart = parts[1]; 
      if (secondPart) {
        const afterPart = secondPart.split(endTag);
        
        // ตรวจสอบว่ามีเนื้อหาหลัง endTag หรือไม่ (แก้ Error บรรทัด 97)
        const finalSuffix = afterPart[1];
        if (finalSuffix !== undefined) {
          const updatedContent = `${parts[0]}${startTag}\n\n${table}\n\n${endTag}${finalSuffix}`;
          writeFileSync(readmePath, updatedContent);
          console.log('🚀 BareJS Benchmarks updated in README!');
        } else {
          console.error('❌ Error: End tag marker is malformed.');
        }
      }
    } else {
      console.warn('⚠️ Warning: Markers not found in README.md. Skip update.');
    }

  } catch (err) {
    console.error('❌ Error updating results:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

startBench();