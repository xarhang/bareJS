// All comments in English
import { run, bench } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync } from "fs";

const payload = { message: "bench" };
const req = new Request("http://localhost/user/123");

const bare = new BareJS().get("/user/:id", () => payload);
// bare.get("/user/:id", () => payload); 

const elysia = new Elysia().get("/user/:id", () => payload);
const hono = new Hono().get("/user/:id", (c) => c.json(payload));


// All comments in English
async function main() {
  console.log("🚀 Starting Performance Benchmark...");
  
  bench("BareJS", () => bare.fetch(req));
  bench("Elysia", () => elysia.handle(req));
  bench("Hono", () => hono.fetch(req));

  const results: any = await run();

  const formatted = results.benchmarks.map((b: any) => {
    let avg = 0;

    // 1. Check if stats.avg exists
    if (b.stats?.avg) {
      avg = b.stats.avg;
    } 
    // 2. Fallback: Calculate from the 'runs' array (Common in Bun/Windows Mitata)
    else if (b.runs && b.runs.length > 0) {
      // Some versions nest metrics inside runs[0].stats
      const stats = b.runs[0].stats;
      avg = stats?.avg ?? stats?.mean ?? 0;
    }

    return {
      name: String(b.alias || b.name || "Unknown").trim(),
      value: avg
    };
  });

  // Final validation: If still 0, print the whole object so we can see the structure
  if (formatted[0].value === 0) {
    console.log("⚠️ Summary failed. Deep Inspecting first benchmark object:");
    console.dir(results.benchmarks[0], { depth: null });
  }

  console.log("Extracted Data:", JSON.stringify(formatted, null, 2));

  writeFileSync("result.json", JSON.stringify(formatted, null, 2));
  console.log("✅ result.json generated.");
}

main();