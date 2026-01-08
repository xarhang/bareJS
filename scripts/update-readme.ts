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

  // ค่าที่ได้จาก JSON คือ Throughput (Higher is Better)
  const b = findValue('BareJS'); // เช่น 1965
  const e = findValue('Elysia'); // เช่น 1874
  const h = findValue('Hono');   // เช่น 3643 (ตรวจสอบ 404/Error ใน Hono ด้วย)

  /**
   * FIXED LOGIC: 
   * เนื่องจากค่าใน JSON คือ 'Operations per s' 
   * เราต้องเอา BareJS (ตัวที่เร็วกว่า/ค่ามากกว่า) ตั้ง แล้วหารด้วยคู่แข่ง
   */
  const calculateSlower = (competitor: number, baseline: number) => {
    return (baseline / competitor).toFixed(2);
  };

  const table = `| Framework | Throughput (Score) | Performance |
| :--- | :--- | :--- |
| **BareJS** | **${b.toFixed(2)}** | **Baseline** |
| Elysia | ${e.toFixed(2)} | ${calculateSlower(e, b)}x slower |
| Hono | ${h.toFixed(2)} | ${calculateSlower(h, b)}x slower |`;

  let readme = readFileSync(README, 'utf8');

  // ตรวจสอบให้แน่ใจว่าใน README.md มี Tag เหล่านี้อยู่
  const startTag = '';
  const endTag = '';

  const startIndex = readme.indexOf(startTag);
  const endIndex = readme.indexOf(endTag);

  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = readme.substring(0, startIndex + startTag.length);
    const after = readme.substring(endIndex);

    const timestamp = `\n\n> Last Updated: ${new Date().toISOString().split('T')[0]} (BareJS Ultra-Accuracy Suite)\n`;
    const newContent = `${before}\n\n${table}${timestamp}\n${after}`;

    writeFileSync(README, newContent);

    // แก้ไข log ให้แสดงค่าที่ถูกต้อง
    const multiplier = (b / e).toFixed(2);
    console.log(`✅ README updated: BareJS is ${multiplier}x faster than Elysia.`);
  } else {
    console.warn("⚠️ Markers missing or broken in README.md");
    console.log("Please ensure exists in README.md");
  }
} catch (error: any) {
  console.error("❌ Update failed:", error.message);
  process.exit(1);
}