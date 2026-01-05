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

    // 2. Prepare the Table
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

    // 3. Read and Update README
    const readmePath = 'README.md';
    const readmeContent = readFileSync(readmePath, 'utf8');

    const startTag = '';
    const endTag = '';

    // Regex Explanation:
    // ([\s\S]*?) -> Capture everything before the tag
    // ${startTag}[\s\S]*?${endTag} -> Match the tags and whatever is currently inside them
    // ([\s\S]*) -> Capture everything after the tags
    const regex = new RegExp(`([\\s\\S]*?)${startTag}[\\s\\S]*?${endTag}([\\s\\S]*)`);

    if (!regex.test(readmeContent)) {
        throw new Error('Could not find the benchmark tags in your README.md. Ensure they exist exactly as written.');
    }

    // Replace the entire file content with: [Before] + [Tags + New Table] + [After]
    const updatedContent = readmeContent.replace(regex, `$1${startTag}\n${table}\n${endTag}$2`);

    writeFileSync(readmePath, updatedContent);
    console.log('✅ README.md updated surgically. All other content preserved.');

} catch (error) {
    if (error instanceof Error) {
        console.error('❌ Update failed:', error.message);
    } else {
        console.error('❌ Unexpected error occurred');
    }
    process.exit(1);
}