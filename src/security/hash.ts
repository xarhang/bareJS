// src/security/hash.ts
import { BARE_CONFIG } from '../core/config';

export const Hash = {
  make: (data: string): Promise<string> => {
    if (BARE_CONFIG.hash.algorithm === 'bcrypt') {
      const cost = Math.max(4, Math.min(31, BARE_CONFIG.hash.timeCost));
      return Bun.password.hash(data, { algorithm: 'bcrypt', cost });
    }
    return Bun.password.hash(data, BARE_CONFIG.hash);
  },

  verify: async (data: string, hash: string): Promise<boolean> => {
    if (!hash || typeof hash !== 'string') return false;
    try {
      return await Bun.password.verify(data, hash);
    } catch {
      return false;
    }
  },

  needsRehash: (hash: string): boolean => {
    if (!hash || typeof hash !== 'string') return true;
    const { algorithm, memoryCost, timeCost } = BARE_CONFIG.hash;
    if (algorithm === 'bcrypt') {
      if (!/^\$2[aby]\$/.test(hash)) return true;
      const costMatch = hash.match(/^\$2[aby]\$(\d+)\$/);
      const expectedCost = Math.max(4, Math.min(31, timeCost));
      return !costMatch || Number(costMatch[1]) !== expectedCost;
    }
    if (!hash.startsWith(`$${algorithm}$`)) return true;
    const mMatch = hash.match(/(?:^|[,$])m=(\d+)(?:[,$]|$)/);
    const tMatch = hash.match(/(?:^|[,$])t=(\d+)(?:[,$]|$)/);
    return !mMatch || Number(mMatch[1]) !== memoryCost || !tMatch || Number(tMatch[1]) !== timeCost;
  }
};