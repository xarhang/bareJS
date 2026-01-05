import { readFileSync, writeFileSync } from 'fs';

try {
  // 1. Load results
  const results = JSON.parse(readFileSync('result.json', 'utf8'));
  const bareJS = results.find((r: any) => r.name.includes('BareJS'))?.value;
  const elysia = results.find((r: any) => r.name === 'Elysia')?.value;
  const hono = results.find((r: any) => r.name === 'Hono')?.value;

  if ([bareJS, elysia, hono].some(v => typeof v !== 'number')) {
    throw new Error('Benchmark data is missing or invalid in result.json');
  }

  // 2. Prepare the Table
  const tableContent = `| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **${bareJS.toFixed(2)} ns/iter** | **Baseline (1.0x)** |
| Elysia | ${elysia.toFixed(2)} ns/iter | ${(elysia / bareJS).toFixed(2)}x slower |
| Hono | ${hono.toFixed(2)} ns/iter | ${(hono / bareJS).toFixed(2)}x slower |`;

  // 3. Update README
  const readmePath = 'README.md';
  const content = readFileSync(readmePath, 'utf8');

  const startTag = '<!-- MARKER: PERFORMANCE_TABLE_START -->';
  const endTag = '<!-- MARKER: PERFORMANCE_TABLE_END -->';

  const startIdx = content.indexOf(startTag);
  const endIdx = content.indexOf(endTag);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Markers not found. Check if ${startTag} and ${endTag} exist in README.md`);
  }

  const before = content.substring(0, startIdx + startTag.length);
  const after = content.substring(endIdx);

  const finalContent = `${before}\n${tableContent}\n${after}`;

  writeFileSync(readmePath, finalContent);
  console.log('✅ README updated successfully!');

} catch (err) {
  console.error('❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
