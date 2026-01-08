// All comments in English
import { BareJS, Context } from '../src/bare';
import { Elysia } from 'elysia';
import { Hono } from 'hono';
import { bench, group, run } from 'mitata';
import { writeFileSync } from 'fs';

const MW_COUNT = 10;
const DEEP_PATH = '/api/v1/user/:id/profile/settings/:category';
const REQUEST_URL = 'http://localhost/api/v1/user/123/profile/settings/security';
const req = new Request(REQUEST_URL);

// 1. Setup BareJS
const bare = new BareJS();
for (let i = 0; i < MW_COUNT; i++) {
  bare.use((ctx: Context, next: any) => next());
}
bare.get(DEEP_PATH, (ctx: Context) => ctx.json({ id: ctx.params.id }));

// 2. Setup Elysia
const elysia = new Elysia();
for (let i = 0; i < MW_COUNT; i++) {
  elysia.onBeforeHandle(() => { });
}
elysia.get(DEEP_PATH, ({ params }) => ({ id: params.id }));

// 3. Setup Hono
const hono = new Hono();
for (let i = 0; i < MW_COUNT; i++) {
  hono.use('*', async (c, next) => await next());
}
hono.get(DEEP_PATH, (c) => c.json({ id: c.req.param('id') }));

// --- BENCHMARK ---
async function main() {
  console.log('🚀 Running "Real World" Stress Test (10 MW + Deep Path)...');

  group('The "Real World" Stress Test', () => {
    bench('BareJS', () => {
      bare.fetch(req);
    });

    bench('Elysia', () => {
      elysia.handle(req);
    });

    bench('Hono', async () => {
      await hono.fetch(req);
    });
  });

  const results: any = await run();

  // Extracting average latency (nanoseconds)
  const formatted = results.benchmarks.map((b: any) => {
    let avg = 0;

    // Mitata structure check
    if (b.stats?.avg) {
      avg = b.stats.avg;
    } else if (b.runs && b.runs.length > 0) {
      const stats = b.runs[0].stats;
      avg = stats?.avg ?? stats?.mean ?? 0;
    }

    return {
      name: String(b.alias || b.name || "Unknown").trim(),
      value: avg // Keeping raw nanoseconds for update-readme logic
    };
  });

  // Log to console for debugging
  console.log("📊 Final Benchmark Data:", JSON.stringify(formatted, null, 2));

  // Save to JSON for update-readme.ts
  writeFileSync("result.json", JSON.stringify(formatted, null, 2));
  console.log("✅ result.json generated successfully.");
}

main();