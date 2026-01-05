import { readFileSync, writeFileSync } from 'fs';

try {
  // 1. Load results with safety checks
  const results = JSON.parse(readFileSync('result.json', 'utf8'));
  const bareJS = results.find((r: any) => r.name.includes('BareJS'))?.value;
  const elysia = results.find((r: any) => r.name === 'Elysia')?.value;
  const hono = results.find((r: any) => r.name === 'Hono')?.value;

  if (typeof bareJS !== 'number' || typeof elysia !== 'number' || typeof hono !== 'number') {
    throw new Error('Benchmark data is missing in result.json');
  }

  // 2. Prepare the Table
  const tableContent = `
### 🚀 Latest Benchmark Results
*Last updated: ${new Date().toUTCString()}*

| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS (Your Engine)** | **${bareJS.toFixed(2)} ns/iter** | **Baseline (1.0x)** |
| Elysia | ${elysia.toFixed(2)} ns/iter | ${(elysia / bareJS).toFixed(2)}x slower |
| Hono | ${hono.toFixed(2)} ns/iter | ${(hono / bareJS).toFixed(2)}x slower |
`;

  // 3. Update README
  const readmePath = 'README.md';
  const content = readFileSync(readmePath, 'utf8');

  const startTag = '';
  const endTag = '';

  // FIX: Use destructuring to ensure variables are defined
  const [before, rest] = content.split(startTag);
  
  // If 'rest' is undefined, the start tag wasn't found
  if (rest === undefined) {
    throw new Error(`Tag ${startTag} not found`);
  }

  const afterParts = rest.split(endTag);
  const after = afterParts[1];

  // If 'after' is undefined, the end tag wasn't found
  if (after === undefined) {
    throw new Error(`Tag ${endTag} not found`);
  }

  // Re-assemble the file: 
  // [Everything before tags] + [Start Tag] + [New Table] + [End Tag] + [Everything after tags]
  const finalContent = `${before}${startTag}\n${tableContent}\n${endTag}${after}`;

  writeFileSync(readmePath, finalContent);
  console.log('✅ README updated successfully with no duplicates.');

} catch (err) {
  if (err instanceof Error) {
    console.error('❌ Error:', err.message);
  }
  process.exit(1);
}