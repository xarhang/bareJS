// All comments in English
import { run, bench } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync, readFileSync, existsSync } from "fs";

interface BenchResult {
  name: string;
  value: number;
}

const payload = { message: "bench" };
const req = new Request("http://localhost/user/123");

// Framework Instances
const bare = new BareJS();
bare.get("/user/:id", () => payload); 

const elysia = new Elysia().get("/user/:id", () => payload);
const hono = new Hono().get("/user/:id", (c) => c.json(payload));

/**
 * Strict Type Guard for finding values
 */
function findValue(data: BenchResult[], target: string): number {
  const match = data.find((r: BenchResult) => 
    r.name.toLowerCase().includes(target.toLowerCase())
  );
  
  if (!match) {
    const available = data.map(d => `"${d.name}"`).join(", ");
    throw new Error(`Framework "${target}" not found. Available: [${available}]`);
  }
  
  return match.value;
}

async function main() {
  console.log("🚀 Starting Performance Benchmark...");
  
  // Register benchmarks
  bench("BareJS", () => bare.fetch(req));
  bench("Elysia", () => elysia.handle(req));
  bench("Hono", () => hono.fetch(req));

  // 1. Await full completion
  const results: any = await run();

  if (!results || !results.benchmarks) {
    console.error("❌ Benchmark failed: No results returned from Mitata.");
    process.exit(1);
  }

  // 2. Safe mapping with name-extraction fallback
  const formatted: BenchResult[] = results.benchmarks.map((b: any): BenchResult => {
    // Some Mitata versions store names in b.name, others in b.alias or b.id
    const rawName = b.name ?? b.alias ?? b.id ?? "Unknown";
    return {
      name: String(rawName).trim(),
      value: b.stats?.avg ?? 0
    };
  });

  // Write for persistence
  writeFileSync("result.json", JSON.stringify(formatted, null, 2));

  try {
    const vBare = findValue(formatted, 'BareJS');
    const vElysia = findValue(formatted, 'Elysia');
    const vHono = findValue(formatted, 'Hono');

    const fmt = (ns: number) => ns > 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(2)} ns`;

    const table = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(vBare)}** | **Baseline** |
| Elysia | ${fmt(vElysia)} | ${(vElysia / vBare).toFixed(2)}x slower |
| Hono | ${fmt(vHono)} | ${(vHono / vBare).toFixed(2)}x slower |`;

    // 3. Update README using safe split logic
    const readmePath = 'README.md';
    if (!existsSync(readmePath)) return;

    const content = readFileSync(readmePath, 'utf8');
    const startTag = '';
    const endTag = '';

    if (content.includes(startTag) && content.includes(endTag)) {
      const parts = content.split(startTag);
      const afterStart = parts[1];
      
      if (afterStart !== undefined) {
        const subParts = afterStart.split(endTag);
        const finalSuffix = subParts[1];
        
        if (finalSuffix !== undefined) {
          const newReadme = `${parts[0]}${startTag}\n\n${table}\n\n${endTag}${finalSuffix}`;
          writeFileSync(readmePath, newReadme);
          console.log("✅ Benchmark data successfully injected into README.md");
        }
      }
    }
  } catch (err) {
    console.error("❌ CI Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();