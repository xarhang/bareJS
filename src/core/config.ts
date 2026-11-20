// src/core/config.ts

export interface BareConfig {
  hash: {
    algorithm: "argon2id" | "bcrypt";
    memoryCost: number;
    timeCost: number;
  };
  port: number;
  
}

export const DEFAULT_CONFIG: BareConfig = {
  hash: {
    algorithm: "argon2id",
    memoryCost: 65536, // 64MB
    timeCost: 2
  },
  port: 3000
};

export let BARE_CONFIG = DEFAULT_CONFIG;


export const initConfig = (userConfig: Partial<BareConfig> = {}) => {
  const cfg = userConfig && typeof userConfig === 'object' && !Array.isArray(userConfig) ? userConfig : {};
  BARE_CONFIG = {
    ...DEFAULT_CONFIG,
    ...cfg,
    hash: { ...DEFAULT_CONFIG.hash, ...(cfg.hash && typeof cfg.hash === 'object' && !Array.isArray(cfg.hash) ? cfg.hash : {}) }
  };
  return BARE_CONFIG;
};