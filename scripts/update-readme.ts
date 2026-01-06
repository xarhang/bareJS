// All comments in English
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

  const fmt = (v: number) => v > 1000 ? `${(v/1000).toFixed(2)} µs` : `${v.toFixed(2)} ns`;

  const table = `| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **${fmt(b)}** | **Baseline** |
| Elysia | ${fmt(e)} | ${(e/b).toFixed(2)}x slower |
| Hono | ${fmt(h)} | ${(h/b).toFixed(2)}x slower |`;

  let readme = readFileSync(README, 'utf8');

  // FIX: Use specific markers instead of matching the whole file
  const startTag = '<!-- MARKER: PERFORMANCE_TABLE_START -->';
  const endTag = '<!-- MARKER: PERFORMANCE_TABLE_END -->';

  // This Regex looks for the tags and matches everything inside them
  const markerRegex = new RegExp(`${startTag}[\\s\\S]*${endTag}`);
  const replacement = `${startTag}\n\n${table}\n\n${endTag}`;

  if (readme.includes(startTag) && readme.includes(endTag)) {
    readme = readme.replace(markerRegex, replacement);
    writeFileSync(README, readme);
    console.log("✅ README updated safely.");
  } else {
    // If tags are missing, don't overwrite! Append to the end instead.
    console.warn("⚠️ Markers not found. Appending table to end of file to prevent data loss.");
    writeFileSync(README, `${readme}\n\n${startTag}\n\n${table}\n\n${endTag}`);
  }
} catch (e: any) {
  console.error("Update failed:", e.message);
  process.exit(1);
}