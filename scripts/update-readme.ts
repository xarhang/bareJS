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

  const b = findValue('BareJS'); // e.g., 1551.57 (Latency in ns)
  const e = findValue('Elysia'); // e.g., 2304.12 (Latency in ns)
  const h = findValue('Hono');   // e.g., 9647.76 (Latency in ns)

  /**
   * CORRECT LATENCY LOGIC:
   * 'Slower' factor = Competitor Latency / Baseline Latency
   * Example: 2304 / 1551 = 1.48x slower
   */
  const calculateSlower = (competitor: number, baseline: number) => {
    return (competitor / baseline).toFixed(2);
  };

  // Convert nanoseconds to microseconds for display
  const fmt = (ns: number) => `${(ns / 1000).toFixed(2)} µs`;

  const table = `| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(b)}** | **Baseline** |
| Elysia | ${fmt(e)} | ${calculateSlower(e, b)}x slower |
| Hono | ${fmt(h)} | ${calculateSlower(h, b)}x slower |`;

  let readme = readFileSync(README, 'utf8');

  const startTag = '<!-- MARKER: PERFORMANCE_TABLE_START -->';
  const endTag = '<!-- MARKER: PERFORMANCE_TABLE_END -->';

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = readme.substring(0, startIndex + startTag.length);
    const after = readme.substring(endIndex);

    const timestamp = `\n\n> Last Updated: ${new Date().toISOString().split('T')[0]} (BareJS Ultra-Accuracy Suite)\n`;
    const newContent = `${before}\n\n${table}${timestamp}\n${after}`;

    writeFileSync(README, newContent);

    // Correcting the log for clarity
    const multiplier = (e / b).toFixed(2);
    console.log(`✅ README updated: BareJS is ${multiplier}x faster than Elysia.`);
  } else {
    console.warn("⚠️ Markers missing or broken in README.md");
  }
} catch (error: any) {
  console.error("❌ Update failed:", error.message);
  process.exit(1);
}