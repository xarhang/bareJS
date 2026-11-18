// All comments in English
import { readFileSync, writeFileSync, existsSync } from 'fs';

const FILE = 'result.json';
const FAIR_FILE = 'fair-suite-result.json';
const PROD_FILE = 'production-result.json';
const README = 'README.md';

if (!existsSync(FILE)) {
  console.error("❌ Result file not found");
  process.exit(1);
}

function replaceMarkerBlock(content: string, startTag: string, endTag: string, inner: string): string {
  const startIndex = content.indexOf(startTag);
  const endIndex = content.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = content.substring(0, startIndex + startTag.length);
    const after = content.substring(endIndex);
    return `${before}\n\n${inner}\n\n${after}`;
  }

  console.warn(`⚠️ Markers missing or broken for ${startTag}`);
  return content;
}

function fmtNs(ns: number): string {
  if (!ns || ns <= 0) return '—';
  if (ns < 1000) return `${Math.round(ns)} ns`;
  return `${(ns / 1000).toFixed(2)} µs`;
}

function fmtCell(entry: { avg: number; min?: number; p99?: number } | undefined, isFastest: boolean): string {
  if (!entry || !entry.avg) return '—';
  const avgStr = fmtNs(entry.avg);
  const main = isFastest ? `**\`${avgStr}\`**` : `\`${avgStr}\``;
  if (entry.p99 && entry.p99 > 0) {
    return `${main} (\`p99: ${fmtNs(entry.p99)}\`)`;
  }
  return main;
}

try {
  const rawData = readFileSync(FILE, 'utf8');
  const data = JSON.parse(rawData);

  console.log("📊 Data loaded from JSON:", rawData);

  const findValue = (target: string): number => {
    const entry = data.find((r: any) => r.name.toLowerCase().includes(target.toLowerCase()));
    if (!entry) throw new Error(`Missing ${target}`);
    const val = Number(entry.value);
    if (val === 0) throw new Error(`Value for ${target} is zero. Benchmark failed?`);
    return val;
  };

  const b = findValue('BareJS'); // e.g., 1551.57 (Latency in ns)
  const e = findValue('Elysia'); // e.g., 2304.12 (Latency in ns)
  const h = findValue('Hono');   // e.g., 9647.76 (Latency in ns)

  const calculateSlower = (competitor: number, baseline: number) => {
    return (competitor / baseline).toFixed(2);
  };

  const fmt = (ns: number) => `${(ns / 1000).toFixed(2)} µs`;

  const headToHeadTable = `| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(b)}** | **Baseline** |
| Elysia | ${fmt(e)} | ${calculateSlower(e, b)}x slower |
| Hono | ${fmt(h)} | ${calculateSlower(h, b)}x slower |`;

  const today = new Date().toISOString().split('T')[0];
  const timestamp = `\n\n> Last Updated: ${today} (github action)`;

  let readme = readFileSync(README, 'utf8');
  readme = replaceMarkerBlock(
    readme,
    '<!-- MARKER: PERFORMANCE_TABLE_START -->',
    '<!-- MARKER: PERFORMANCE_TABLE_END -->',
    `${headToHeadTable}${timestamp}`
  );

  // Update Multi-Scenario table if fair-suite-result.json or production-result.json exist
  const multiScenarios: any[] = [];
  if (existsSync(FAIR_FILE)) {
    multiScenarios.push(...JSON.parse(readFileSync(FAIR_FILE, 'utf8')));
  }
  if (existsSync(PROD_FILE)) {
    multiScenarios.push(...JSON.parse(readFileSync(PROD_FILE, 'utf8')));
  }

  if (multiScenarios.length > 0) {
    const rows = multiScenarios.map((s: any) => {
      const list = s.results || [];
      const bare = list.find((r: any) => r.name.toLowerCase().includes('barejs'));
      const elysia = list.find((r: any) => r.name.toLowerCase().includes('elysia'));
      const hono = list.find((r: any) => r.name.toLowerCase().includes('hono'));

      const validAvgs = [bare?.avg, elysia?.avg, hono?.avg].filter((v): v is number => typeof v === 'number' && v > 0);
      const minAvg = validAvgs.length > 0 ? Math.min(...validAvgs) : 0;

      const bareCell = fmtCell(bare, bare?.avg === minAvg);
      const elysiaCell = fmtCell(elysia, elysia?.avg === minAvg);
      const honoCell = fmtCell(hono, hono?.avg === minAvg);

      return `| **${s.scenario}** | ${bareCell} | ${elysiaCell} | ${honoCell} |`;
    });

    const multiTable = [
      '| Scenario (`benchmarks/fair-suite.ts` & `production-bench.ts`) | **BareJS** 🏆 | **ElysiaJS** | **Hono** |',
      '| :--- | :---: | :---: | :---: |',
      ...rows
    ].join('\n');

    readme = replaceMarkerBlock(
      readme,
      '<!-- MARKER: MULTI_BENCH_START -->',
      '<!-- MARKER: MULTI_BENCH_END -->',
      `${multiTable}${timestamp}`
    );
  }

  writeFileSync(README, readme);

  const multiplier = (e / b).toFixed(2);
  console.log(`✅ README updated: BareJS is ${multiplier}x faster than Elysia.`);
} catch (error: any) {
  console.error("❌ Update failed:", error.message);
  process.exit(1);
}