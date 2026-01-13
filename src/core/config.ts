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
  BARE_CONFIG = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    hash: { ...DEFAULT_CONFIG.hash, ...userConfig.hash }
  };
  return BARE_CONFIG;
};