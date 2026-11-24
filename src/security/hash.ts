// src/security/hash.ts
import { BARE_CONFIG } from '../core/config';
import { runtime } from '../runtime';

export const Hash = {
  make: (data: string): Promise<string> => {
    if (!data) return Promise.reject(new Error('Password cannot be empty'));
    return runtime.password.hash(data, BARE_CONFIG.hash);
  },

  verify: async (data: string, hash: string): Promise<boolean> => {
    if (!hash || typeof hash !== 'string') return false;
    try {
      return await runtime.password.verify(data, hash);
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
    if (hash.startsWith('$scrypt$')) {
      return !hash.startsWith('$scrypt$N=16384,r=8,p=1$');
    }
    if (!hash.startsWith(`$${algorithm}$`)) return true;
    const mMatch = hash.match(/(?:^|[,$])m=(\d+)(?:[,$]|$)/);
    const tMatch = hash.match(/(?:^|[,$])t=(\d+)(?:[,$]|$)/);
    return !mMatch || Number(mMatch[1]) !== memoryCost || !tMatch || Number(tMatch[1]) !== timeCost;
  }
};