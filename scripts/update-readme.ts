
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
    // Ensure we are handling numeric values correctly
    const val = Number(entry.value);
    if (val === 0) throw new Error(`Value for ${target} is zero. Benchmark failed?`);
    return val;
  };

  const b = findValue('BareJS');
  const e = findValue('Elysia');
  const h = findValue('Hono');

  // Logic: Lower latency is better. 
  // If BareJS (b) is 1000ns and Elysia (e) is 1500ns, 
  // Elysia is 1.50x slower, BareJS is the baseline.
  const fmt = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)} µs` : `${v.toFixed(2)} ns`;

  const table = `| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(b)}** | **Baseline** |
| Elysia | ${fmt(e)} | ${(e / b).toFixed(2)}x slower |
| Hono | ${fmt(h)} | ${(h / b).toFixed(2)}x slower |`;

  let readme = readFileSync(README, 'utf8');

  const startTag = '';
  const endTag = '';

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = readme.substring(0, startIndex + startTag.length);
    const after = readme.substring(endIndex);

    // Clean timestamp for the README
    const timestamp = `\n\n> Last Updated: ${new Date().toISOString().split('T')[0]} (BareJS Ultra-Accuracy Suite)\n`;
    const newContent = `${before}\n\n${table}${timestamp}\n${after}`;

    writeFileSync(README, newContent);

    // Log the actual speed multiplier for the CI console
    const multiplier = (e / b).toFixed(2);
    console.log(`✅ README updated: BareJS is ${multiplier}x faster than Elysia.`);
  } else {
    console.warn("⚠️ Markers missing or broken in README.md");
  }
} catch (error: any) {
  console.error("❌ Update failed:", error.message);
  process.exit(1);
}