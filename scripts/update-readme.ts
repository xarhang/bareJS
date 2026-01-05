import { readFileSync, writeFileSync } from 'fs';

try {
    const results = JSON.parse(readFileSync('result.json', 'utf8'));
    const bareJS = results.find((r: any) => r.name.includes('BareJS'))?.value;
    const elysia = results.find((r: any) => r.name === 'Elysia')?.value;
    const hono = results.find((r: any) => r.name === 'Hono')?.value;

    if (typeof bareJS !== 'number' || typeof elysia !== 'number' || typeof hono !== 'number') {
        throw new Error('Benchmark values are missing or invalid in result.json');
    }

    const table = `
### 🚀 Latest Benchmark Results
*Last updated: ${new Date().toUTCString()} (GitHub Actions)*

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

    // FIX: Using destructuring and explicit check to satisfy TypeScript
    const parts = readmeContent.split(startTag);
    const contentBefore = parts[0];
    const rest = parts[1];

    // This check tells TypeScript that 'rest' is definitely a string, not undefined
    if (rest === undefined || !rest.includes(endTag)) {
        throw new Error(`Required tags ${startTag} or ${endTag} are missing or improperly placed in README.md`);
    }

    const contentAfter = rest.split(endTag)[1] || '';

    const finalContent = `${contentBefore}${startTag}\n${table}\n${endTag}${contentAfter}`;

    writeFileSync(readmePath, finalContent);
    console.log('✅ README.md updated successfully!');

} catch (error) {
    if (error instanceof Error) {
        console.error('❌ Update failed:', error.message);
    } else {
        console.error('❌ Unexpected error occurred');
    }
    process.exit(1);
}