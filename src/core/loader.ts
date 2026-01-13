// src/core/loader.ts
import { join } from "node:path";
import { initConfig } from "./config";

export async function bootstrapConfig() {
  const configPath = join(process.cwd(), "bare.config.ts");
  try {
    const userModule = await import(configPath);
    return initConfig(userModule.default);
  } catch {
    return initConfig();
  }
}