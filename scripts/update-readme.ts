import { readFileSync, writeFileSync, existsSync } from 'fs';

const FILE = 'result.json';
const README = 'README.md';

if (!existsSync(FILE)) {
  console.error("Result file not found");
  process.exit(1);
}

try {
  const data = JSON.parse(readFileSync(FILE, 'utf8'));

  const findValue = (target: string): number => {
    const entry = data.find((r: any) => r.name.toLowerCase().includes(target.toLowerCase()));
    if (!entry) throw new Error(`Missing ${target}`);
    return entry.value as number;
  };

  const b = findValue('BareJS');
  const e = findValue('Elysia');
  const h = findValue('Hono');

  const fmt = (v: number) => v > 1000 ? `${(v / 1000).toFixed(2)} µs` : `${v.toFixed(2)} ns`;

  const table = `| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(b)}** | **Baseline** |
| Elysia | ${fmt(e)} | ${(e / b).toFixed(2)}x slower |
| Hono | ${fmt(h)} | ${(h / b).toFixed(2)}x slower |`;

  let readme = readFileSync(README, 'utf8');

  const startTag = '<!-- MARKER: PERFORMANCE_TABLE_START -->';
  const endTag = '<!-- MARKER: PERFORMANCE_TABLE_END -->';

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  console.log(`Current Bench - BareJS: ${b}, Elysia: ${e}, Hono: ${h}`);
  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = readme.substring(0, startIndex + startTag.length);
    const after = readme.substring(endIndex);


    const lastUpdate = `\n> Last Updated: ${new Date().toISOString()}\n`;
    const newContent = `${before}\n\n${table}${lastUpdate}\n${after}`;

    writeFileSync(README, newContent);
    console.log("✅ README updated and synced.");
  } else {

    console.warn("⚠️ [Warning]: Cannot find valid markers in README.md");

    if (startIndex === -1) console.log(`   Missing: ${startTag}`);
    if (endIndex === -1) console.log(`   Missing: ${endTag}`);
    if (startIndex >= endIndex && startIndex !== -1) {
      console.log("   Error: Start tag is placed AFTER End tag!");
    }

    console.log("💡 Action: Please check if README.md has both markers correctly.");
  }
} catch (e: any) {
  console.error("Update failed:", e.message);
  process.exit(1);
}