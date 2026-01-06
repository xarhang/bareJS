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

  // Use a helper with a defined return type to satisfy TS
  const findValue = (target: string): number => {
    const entry = data.find((r: any) => r.name.toLowerCase().includes(target.toLowerCase()));
    if (!entry) throw new Error(`Missing ${target}`);
    return entry.value as number;
  };

  const b = findValue('BareJS');
  const e = findValue('Elysia');
  const h = findValue('Hono');

  const fmt = (v: number) => v > 1000 ? `${(v/1000).toFixed(2)} µs` : `${v.toFixed(2)} ns`;

  const table = `| Framework | Latency | Speed |\n| :--- | :--- | :--- |\n| **BareJS** | **${fmt(b)}** | **1.0x** |\n| Elysia | ${fmt(e)} | ${(e/b).toFixed(2)}x slower |\n| Hono | ${fmt(h)} | ${(h/b).toFixed(2)}x slower |`;

  let readme = readFileSync(README, 'utf8');
  const marker = /[\s\S]*/;
  
  readme = readme.replace(marker, `\n\n${table}\n\n`);
  
  writeFileSync(README, readme);
  console.log("README Updated.");
} catch (e: any) {
  console.error("Update failed:", e.message);
  process.exit(1);
}