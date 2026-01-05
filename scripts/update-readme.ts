import { readFileSync, writeFileSync } from 'fs';

try {
    // 1. Load results
    const results = JSON.parse(readFileSync('result.json', 'utf8'));
    const bareJS = results.find((r: any) => r.name.includes('BareJS'))?.value;
    const elysia = results.find((r: any) => r.name === 'Elysia')?.value;
    const hono = results.find((r: any) => r.name === 'Hono')?.value;

    if (typeof bareJS !== 'number' || typeof elysia !== 'number' || typeof hono !== 'number') {
        throw new Error('Benchmark values are missing or invalid in result.json');
    }

    // 2. Prepare the English table
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

    // 3. Update README
    const readmePath = 'README.md';
    const readmeContent = readFileSync(readmePath, 'utf8');

    const startTag = '';
    const endTag = '';

    // Split logic with explicit safety
    const parts = readmeContent.split(startTag);
    if (parts.length < 2) throw new Error(`Missing ${startTag}`);

    const contentBefore = parts[0];
    const rest = parts[1];

    if (!rest || !rest.includes(endTag)) {
        throw new Error(`Missing ${endTag}`);
    }

    const contentAfter = rest.split(endTag)[1];
    
    // Final check for contentAfter to satisfy TS
    if (contentAfter === undefined) {
        throw new Error('Failed to parse content after the benchmark tag');
    }

    const finalContent = `${contentBefore}${startTag}\n${table}\n${endTag}${contentAfter}`;

    writeFileSync(readmePath, finalContent);
    console.log('✅ README.md successfully updated and type-checked!');

} catch (error) {
    if (error instanceof Error) {
        console.error('❌ Update failed:', error.message);
    } else {
        console.error('❌ Unexpected error occurred');
    }
    process.exit(1);
}