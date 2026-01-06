import { $ } from "bun";

console.log("🛠  Building BareJS for Release...");

// 1. Clean up old dist folder
await $`rm -rf dist`;

// 2. Build everything using src/index.ts as the entrypoint
const result = await Bun.build({
  entrypoints: ['./src/index.ts'], // <-- เปลี่ยนเป็น index เพื่อมัดรวมทุกอย่าง
  outdir: './dist',
  target: 'bun',
  minify: true,
  naming: "[name].[ext]" // จะได้ไฟล์ dist/index.js
});

if (result.success) {
  console.log("✅ Build core success!");
} else {
  console.error("❌ Build failed", result.logs);
  process.exit(1);
}

// 3. Generate Type Definitions for the entire project
// เราจะใช้ tsc จัดการทุกไฟล์ใน src เพื่อให้ได้ Type ครบถ้วน
await $`bun x tsc --declaration --emitDeclarationOnly --outDir dist --module esnext --target esnext --moduleResolution bundler --skipLibCheck`;

// 4. Rename index.d.ts if needed (or ensure it points correctly)
console.log("🚀 BareJS is ready to fly!");