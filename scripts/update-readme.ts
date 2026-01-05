// scripts/update-readme.ts
import { readFileSync, writeFileSync } from 'fs';

try {
  const results = JSON.parse(readFileSync('result.json', 'utf8'));

  const bareJS = results.find((r: any) => r.name.includes('BareJS')).value;
  const elysia = results.find((r: any) => r.name === 'Elysia').value;
  const hono = results.find((r: any) => r.name === 'Hono').value;

  const table = `
### 🚀 Latest Benchmark Results
*Last updated: ${new Date().toUTCString()}*

| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS (Your Engine)** | **${bareJS.toFixed(2)} ns/iter** | **Baseline (1.0x)** |
| Elysia | ${elysia.toFixed(2)} ns/iter | ${(elysia / bareJS).toFixed(2)}x slower |
| Hono | ${hono.toFixed(2)} ns/iter | ${(hono / bareJS).toFixed(2)}x slower |

> [!TIP]
> 📈 **Performance Dashboard:** View historical charts [here](https://xarhang.github.io/bareJS/dev/benchmarks/)
`;

  const readmePath = 'README.md';
  const readmeContent = readFileSync(readmePath, 'utf8');

  const startTag = '';
  const endTag = '';

  // ตรวจสอบว่ามี Tag ครบไหม
  if (!readmeContent.includes(startTag) || !readmeContent.includes(endTag)) {
    throw new Error('❌ Missing benchmark tags in README.md');
  }

  // แยกส่วนหัวและส่วนท้าย เพื่อรักษากลางไว้
  const before = readmeContent.split(startTag)[0];
  const after = readmeContent.split(endTag)[1];

  // รวมไฟล์ใหม่: (เนื้อหาเดิมส่วนบน) + (Tag เปิด) + (ตารางใหม่) + (Tag ปิด) + (เนื้อหาเดิมส่วนล่าง)
  const newContent = `${before}${startTag}\n${table}\n${endTag}${after}`;

  writeFileSync(readmePath, newContent);
  console.log('✅ README.md updated successfully while preserving other content!');
} catch (error) {
  if (error instanceof Error) {
    console.error('❌ Update failed:', error.message);
  } else {
    console.error('❌ Update failed:', String(error));
  }
  process.exit(1);
}