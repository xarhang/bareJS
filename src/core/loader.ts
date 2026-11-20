// src/core/loader.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initConfig } from "./config";

export async function bootstrapConfig() {
  const configPath = join(process.cwd(), "bare.config.ts");
  if (!existsSync(configPath)) {
    return initConfig();
  }
  try {
    const userModule = await import(configPath);
    return initConfig(userModule.default);
  } catch {
    return initConfig();
  }
}