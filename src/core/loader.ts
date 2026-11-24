// src/core/loader.ts
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initConfig } from "./config";

const req = createRequire(import.meta.url);

export async function bootstrapConfig() {
  const cwd = process.cwd();
  const candidates = ["bare.config.ts", "bare.config.js", "bare.config.mjs"];
  const configPath = candidates.map((f) => join(cwd, f)).find((p) => existsSync(p));
  if (!configPath) {
    return initConfig();
  }
  try {
    const resolved = req.resolve(configPath);
    delete req.cache[resolved];
    const userModule = req(resolved);
    return initConfig(userModule?.default ?? userModule);
  } catch (err: any) {
    console.warn(`[BareJS] Failed to load ${configPath}:`, err?.message || err);
    return initConfig();
  }
}