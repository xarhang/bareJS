import { readFileSync, writeFileSync } from 'fs';

try {
  const results = JSON.parse(readFileSync('result.json', 'utf8'));

  const bareJS = results.find((r: any) => r.name.includes('BareJS')).value;
  const elysia = results.find((r: any) => r.name === 'Elysia').value;
  const hono = results.find((r: any) => r.name === 'Hono').value;

  const table = `
### 🚀 Latest Benchmark Results
*Last updated: ${new Date().toUTCString()} (Running on GitHub Actions)*

| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS (Your Engine)** | **${bareJS.toFixed(2)} ns/iter** | **Baseline (1.0x)** |
| Elysia | ${elysia.toFixed(2)} ns/iter | ${(elysia / bareJS).toFixed(2)}x slower |
| Hono | ${hono.toFixed(2)} ns/iter | ${(hono / bareJS).toFixed(2)}x slower |

> [!TIP]
> View performance history and charts [here](https://xarhang.github.io/bareJS/dev/benchmarks/)
`;

  const readmePath = 'README.md';
  const readmeContent = readFileSync(readmePath, 'utf8');

  const startTag = '';
  const endTag = '';

  const newContent = readmeContent.replace(
    new RegExp(`${startTag}[\\s\\S]*${endTag}`),
    `${startTag}\n${table}\n${endTag}`
  );

  writeFileSync(readmePath, newContent);
  console.log('✅ README.md has been updated!');
} catch (error) {
  console.error('❌ Failed to update README:', error);
  process.exit(1);
}