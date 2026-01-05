import { readFileSync, writeFileSync } from 'fs';

try {
    const results = JSON.parse(readFileSync('result.json', 'utf8'));
    const bareJS = results.find((r: any) => r.name.includes('BareJS'))?.value;
    const elysia = results.find((r: any) => r.name === 'Elysia')?.value;
    const hono = results.find((r: any) => r.name === 'Hono')?.value;

    if (typeof bareJS !== 'number' || typeof elysia !== 'number' || typeof hono !== 'number') {
        throw new Error('Could not find benchmark numbers in result.json');
    }

    const tableContent = `
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
    let content = readFileSync(readmePath, 'utf8');

    const startTag = '';
    const endTag = '';

    // Check if both tags exist
    if (!content.includes(startTag) || !content.includes(endTag)) {
        console.error("❌ ERROR: Could not find markers in README.md");
        console.log("Please ensure your README has these EXACT tags:");
        console.log(startTag);
        console.log(endTag);
        process.exit(1);
    }

    // Surgical replacement using Regex
    const regex = new RegExp(`${startTag}[\\s\\S]*?${endTag}`, 'g');
    const newContent = content.replace(regex, `${startTag}${tableContent}${endTag}`);

    writeFileSync(readmePath, newContent);
    console.log('✅ README.md surgically updated!');

} catch (err: any) {
    console.error('❌ Failed to update README:', err.message);
    process.exit(1);
}