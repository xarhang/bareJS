// All comments in English
import { readFileSync, writeFileSync, existsSync } from 'fs';

const FILE = 'result.json';
const README = 'README.md';

if (!existsSync(FILE)) {
  console.error("❌ Result file not found");
  process.exit(1);
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

  const b = findValue('BareJS');
  const e = findValue('Elysia');
  const h = findValue('Hono');

  const fmt = (v: number) => v > 1000 ? `${(v/1000).toFixed(2)} µs` : `${v.toFixed(2)} ns`;

  const table = `| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(b)}** | **Baseline** |
| Elysia | ${fmt(e)} | ${(e/b).toFixed(2)}x slower |
| Hono | ${fmt(h)} | ${(h/b).toFixed(2)}x slower |`;

  let readme = readFileSync(README, 'utf8');

  const startTag = '<!-- MARKER: PERFORMANCE_TABLE_START -->';
  const endTag = '<!-- MARKER: PERFORMANCE_TABLE_END -->';

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = readme.substring(0, startIndex + startTag.length);
    const after = readme.substring(endIndex);
    
    // Add a timestamp for CI tracking
    const timestamp = `\n\n> Last Updated: ${new Date().toUTCString()}\n`;
    const newContent = `${before}\n\n${table}${timestamp}\n${after}`;
    
    writeFileSync(README, newContent);
    console.log(`✅ README updated: BareJS is ${(e/b).toFixed(2)}x faster than Elysia.`);
  } else {
    console.warn("⚠️ Markers missing or broken in README.md");
  }
} catch (e: any) {
  console.error("❌ Update failed:", e.message);
  process.exit(1);
}