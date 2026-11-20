// src/core/loader.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initConfig } from "./config";

const req = createRequire(import.meta.url);

export async function bootstrapConfig() {
  const configPath = join(process.cwd(), "bare.config.ts");
  if (!existsSync(configPath)) {
    return initConfig();
  }
  try {
    const resolved = req.resolve(configPath);
    delete req.cache[resolved];
    const userModule = req(resolved);
    return initConfig(userModule?.default ?? userModule);
  } catch (err: any) {
    console.warn(`[BareJS] Failed to load bare.config.ts:`, err?.message || err);
    return initConfig();
  }
}