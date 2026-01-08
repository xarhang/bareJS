import { $ } from "bun";

console.log("🛠  Building BareJS for Release...");

await $`rm -rf dist`;

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  minify: true,
  naming: "[name].[ext]"
});

if (result.success) {
  console.log("✅ Build core success!");
} else {
  console.error("❌ Build failed", result.logs);
  process.exit(1);
}

await $`bun x tsc`;
console.log("🚀 BareJS is ready to fly!");