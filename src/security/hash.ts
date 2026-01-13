// src/security/hash.ts
import { BARE_CONFIG } from '../core/config';

export const Hash = {
  make: (data: string): Promise<string> => 
    Bun.password.hash(data, BARE_CONFIG.hash),

  verify: (data: string, hash: string): Promise<boolean> => 
    Bun.password.verify(data, hash),

  needsRehash: (hash: string): boolean => {
    const { algorithm, memoryCost, timeCost } = BARE_CONFIG.hash;
    if (!hash.startsWith(`$${algorithm}$`)) return true;
    
    return !(
      hash.includes(`m=${memoryCost}`) && 
      hash.includes(`t=${timeCost}`)
    );
  }
};