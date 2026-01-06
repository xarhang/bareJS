// All comments in English
import { run, bench, group } from "mitata";
import { BareJS } from "../src/index";
import { Elysia } from "elysia";
import { Hono } from "hono";
import { writeFileSync, readFileSync } from "fs";

/**
 * Setup Data
 */
const payload = { message: "bench" };
const req = new Request("http://localhost/user/123");

const bare = new BareJS();
const bareMW = (req: Request, params: Record<string, string>, next: () => any) => next();
bare.use(bareMW).use(bareMW).use(bareMW);
bare.get("/user/:id", () => payload); 

// Match work-load: Adding 3 hooks to Elysia for a fair 55% comparison
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

// ✅ Fix: Add checks to ensure results.benchmarks exists
if (!results?.benchmarks) {
  console.error("❌ Mitata failed to return benchmarks.");
  process.exit(1);
}

const formatted = results.benchmarks.map((b: any) => ({
  name: String(b.name),
  // ✅ Fix: Use optional chaining and default to 0 to avoid 'undefined'
  value: parseFloat((b.stats?.avg ?? 0).toFixed(2))
}));

writeFileSync("result.json", JSON.stringify(formatted, null, 2));

try {
  // ✅ Fix: Use ! (non-null assertion) or check existence explicitly
  const getVal = (name: string) => formatted.find((r: any) => r.name.includes(name))?.value;
  
  const vBare = getVal('BareJS');
  const vElysia = getVal('Elysia');
  const vHono = getVal('Hono');

  // Strict check for the values
  if (vBare === undefined || vElysia === undefined || vHono === undefined) {
    throw new Error('Could not find all framework results in benchmark output.');
  }

  const tableContent = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${vBare.toFixed(2)} ns** | **Baseline** |
| Elysia | ${vElysia.toFixed(2)} ns | ${(vElysia / vBare).toFixed(2)}x slower |
| Hono | ${vHono.toFixed(2)} ns | ${(vHono / vBare).toFixed(2)}x slower |`;

  const readmePath = 'README.md';
  let content = readFileSync(readmePath, 'utf8');

  const startTag = '';
  const endTag = '';

  if (content.includes(startTag) && content.includes(endTag)) {
    const parts = content.split(startTag);
    const afterEnd = parts[1]!.split(endTag)[1];
    const finalContent = `${parts[0]}${startTag}\n\n${tableContent}\n\n${endTag}${afterEnd}`;
    writeFileSync(readmePath, finalContent);
    console.log('✅ README updated successfully!');
  }

} catch (err) {
  console.error('❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}