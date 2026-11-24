// All comments in English
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { cpus } from 'os';

const FILE = 'result.json';
const FAIR_FILE = 'fair-suite-result.json';
const PROD_FILE = 'production-result.json';
const README = 'README.md';
const BENCHMARKS_MD = 'BENCHMARKS.md';

if (!existsSync(FILE)) {
  console.error('❌ Result file not found');
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
    return `${main}<br><sub>\`p99: ${fmtNs(entry.p99)}\`</sub>`;
  }
  return main;
}

function getPkgVersion(name: string): string {
  try {
    const pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
    return pkg.version || 'latest';
  } catch {
    return 'latest';
  }
}

try {
  const rawData = readFileSync(FILE, 'utf8');
  const data = JSON.parse(rawData);

  const findValue = (target: string): number => {
    const entry = data.find((r: any) => r.name.toLowerCase().includes(target.toLowerCase()));
    if (!entry) throw new Error(`Missing ${target}`);
    const val = Number(entry.value);
    if (val === 0) throw new Error(`Value for ${target} is zero. Benchmark failed?`);
    return val;
  };

  const b = findValue('BareJS');
  const e = findValue('Elysia');

  const today = new Date().toISOString().split('T')[0];
  const bunVer = typeof Bun !== 'undefined' ? Bun.version : 'unknown';
  const elysiaVer = getPkgVersion('elysia');
  const honoVer = getPkgVersion('hono');
  const cpuModel = cpus()[0]?.model?.trim() || 'x86_64 CPU';
  const envFooter = `\n\n> Last Updated: ${today} (github action — \`${process.platform}\`, ${cpuModel}, Bun \`${bunVer}\`, Elysia \`${elysiaVer}\`, Hono \`${honoVer}\`)`;

  const multiScenarios: any[] = [];
  if (existsSync(FAIR_FILE)) {
    multiScenarios.push(...JSON.parse(readFileSync(FAIR_FILE, 'utf8')));
  }
  if (existsSync(PROD_FILE)) {
    multiScenarios.push(...JSON.parse(readFileSync(PROD_FILE, 'utf8')));
  }

  if (multiScenarios.length > 0) {
    const buildRows = (scenarios: any[]) =>
      scenarios.map((s: any) => {
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

    const header = [
      '| Scenario | **BareJS** | **ElysiaJS** | **Hono** |',
      '| :--- | :---: | :---: | :---: |',
    ];

    const fullTable = [...header, ...buildRows(multiScenarios)].join('\n');
    const summaryTable = [...header, ...buildRows(multiScenarios.slice(0, 4))].join('\n');

    if (existsSync(BENCHMARKS_MD)) {
      let benchMd = readFileSync(BENCHMARKS_MD, 'utf8');
      benchMd = replaceMarkerBlock(
        benchMd,
        '<!-- MARKER: MULTI_BENCH_START -->',
        '<!-- MARKER: MULTI_BENCH_END -->',
        `${fullTable}${envFooter}`
      );
      writeFileSync(BENCHMARKS_MD, benchMd);
    }

    if (existsSync(README)) {
      let readme = readFileSync(README, 'utf8');
      readme = replaceMarkerBlock(
        readme,
        '<!-- MARKER: MULTI_BENCH_SUMMARY_START -->',
        '<!-- MARKER: MULTI_BENCH_SUMMARY_END -->',
        `${summaryTable}${envFooter}`
      );
      writeFileSync(README, readme);
    }
  }

  const multiplier = (e / b).toFixed(2);
  console.log(`✅ Benchmark docs updated (BareJS vs Elysia ratio: ${multiplier}x).`);
} catch (error: any) {
  console.error('❌ Update failed:', error.message);
  process.exit(1);
}