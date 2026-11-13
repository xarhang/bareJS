// src/security/hash.ts
import { BARE_CONFIG } from '../core/config';

export const Hash = {
  make: (data: string): Promise<string> => 
    Bun.password.hash(data, BARE_CONFIG.hash),

  verify: (data: string, hash: string): Promise<boolean> => 
    Bun.password.verify(data, hash),

  needsRehash: (hash: string): boolean => {
    const { algorithm, memoryCost, timeCost } = BARE_CONFIG.hash;
    if (algorithm === 'bcrypt') {
      if (!/^\$2[aby]\$/.test(hash)) return true;
      const costMatch = hash.match(/^\$2[aby]\$(\d+)\$/);
      return !costMatch || Number(costMatch[1]) !== timeCost;
    }
    if (!hash.startsWith(`$${algorithm}$`)) return true;
    const mMatch = hash.match(/(?:^|[,$])m=(\d+)(?:[,$]|$)/);
    const tMatch = hash.match(/(?:^|[,$])t=(\d+)(?:[,$]|$)/);
    return !mMatch || Number(mMatch[1]) !== memoryCost || !tMatch || Number(tMatch[1]) !== timeCost;
  }
};