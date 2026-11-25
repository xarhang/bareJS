import { $ } from "bun";

console.log("🛠  Building BareJS for Release...");

await $`rm -rf dist`;

const bunBuild = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'bun',
  minify: true,
  naming: "[name].[ext]",
  external: ['ws', '@node-rs/argon2', 'bcryptjs', 'uWebSockets.js']
});

if (!bunBuild.success) {
  console.error("❌ Bun build failed", bunBuild.logs);
  process.exit(1);
}
console.log("✅ Build core (bun) success!");

const nodeBuild = await Bun.build({
  entrypoints: ['./src/node.ts'],
  outdir: './dist',
  target: 'node',
  minify: true,
  naming: "[name].[ext]",
  external: ['ws', '@node-rs/argon2', 'bcryptjs', 'uWebSockets.js']
});

if (!nodeBuild.success) {
  console.error("❌ Node build failed", nodeBuild.logs);
  process.exit(1);
}
console.log("✅ Build node target success!");

await $`bun x tsc`;
console.log("🚀 BareJS is ready to fly!");