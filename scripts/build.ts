// scripts/build.ts
import { $ } from "bun";

console.log("🛠  Building BareJS for Release...");


await $`rm -rf dist`;


const result = await Bun.build({
  entrypoints: ['./src/bare.ts'],
  outdir: './dist',
  target: 'bun',
  minify: true,
});

if (result.success) {
  console.log("✅ Build core success!");
} else {
  console.error("❌ Build failed", result.logs);
  process.exit(1);
}


await $`bun x tsc src/bare.ts --declaration --emitDeclarationOnly --outFile dist/bare.d.ts --module esnext --target esnext --moduleResolution bundler`;

console.log("🚀 BareJS is ready to fly!");