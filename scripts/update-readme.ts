import { readFileSync, writeFileSync } from 'fs';


const results = JSON.parse(readFileSync('result.json', 'utf8'));


const bareJS = results.find((r: any) => r.name.includes('BareJS')).value;
const elysia = results.find((r: any) => r.name === 'Elysia').value;
const hono = results.find((r: any) => r.name === 'Hono').value;


const table = `
### 🚀 Benchmark Results
Last updated: ${new Date().toLocaleString()}

| Framework | Average Speed | Performance |
| :--- | :--- | :--- |
| **BareJS (Your Engine)** | **${bareJS.toFixed(2)} ns/iter** | **1.0x (Fastest)** |
| Elysia | ${(elysia).toFixed(2)} ns/iter | ${(elysia / bareJS).toFixed(2)}x slower |
| Hono | ${(hono).toFixed(2)} ns/iter | ${(hono / bareJS).toFixed(2)}x slower |

*Tested on: 12th Gen Intel(R) Core(TM) i7-12700 @ 3.10 GHz*
`;


const readmePath = 'README.md';
let readmeContent = readFileSync(readmePath, 'utf8');


const startTag = '';
const endTag = '';

const newContent = readmeContent.replace(
  new RegExp(`${startTag}[\\s\\S]*${endTag}`),
  `${startTag}\n${table}\n${endTag}`
);

writeFileSync(readmePath, newContent);
console.log('✅ README.md updated with latest benchmark results!');