import type { Next } from '../core/context';
import type { RevocationStore } from './store';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * UTILS: Internal Crypto Helpers using Native Web Crypto & Node Crypto
 * Optimized for Bun performance and constant-time security.
 */
const encoder = new TextEncoder();

// Base64Url Helpers (RFC 4648) using native C++ Buffer encoding
const base64Url = (input: Uint8Array | string): string => {
  return Buffer.from(input).toString('base64url');
};

const fromBase64Url = (str: string): string => {
  return Buffer.from(str, 'base64url').toString('utf-8');
};

// PERF: Cache CryptoKeys to avoid repeated async importKey calls for createToken
const keyCache = new Map<string, CryptoKey>();

const importKey = async (secret: string): Promise<CryptoKey> => {
  if (keyCache.has(secret)) return keyCache.get(secret)!;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  keyCache.set(secret, key);
  return key;
};

/**
 * 4. TOKEN GENERATOR (Standard JWT)
 */
export const createToken = async (payload: object, secret: string): Promise<string> => {
  const header = JSON.stringify({ alg: "HS256", typ: "JWT" });
  const body = JSON.stringify(payload);

  const encodedHeader = base64Url(header);
  const encodedBody = base64Url(body);
  const data = `${encodedHeader}.${encodedBody}`;

  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const encodedSig = base64Url(new Uint8Array(signature));

  return `${data}.${encodedSig}`;
};

const revokedTokens = new Map<string, number>();

/**
 * Revoke a JWT token or JTI for ttlMs (default: 1 hour).
 * Optionally delegates to an external RevocationStore (e.g. redisStore).
 */
export function revokeToken(tokenOrJti: string, ttlMs?: number): void;
export function revokeToken(tokenOrJti: string, ttlMs: number, store: RevocationStore): Promise<void>;
export function revokeToken(tokenOrJti: string, ttlMs: number = 3600_000, store?: RevocationStore): void | Promise<void> {
  if (store) {
    return store.revoke(tokenOrJti, ttlMs);
  }
  if (revokedTokens.size >= 10_000) {
    const now = Date.now();
    for (const [k, exp] of revokedTokens) {
      if (now >= exp) revokedTokens.delete(k);
    }
    if (revokedTokens.size >= 10_000) {
      const oldest = revokedTokens.keys().next().value;
      if (oldest !== undefined) revokedTokens.delete(oldest);
    }
  }
  revokedTokens.set(tokenOrJti, Date.now() + ttlMs);
}

export function isTokenRevoked(tokenOrJti: string): boolean;
export function isTokenRevoked(tokenOrJti: string, store: RevocationStore): Promise<boolean>;
export function isTokenRevoked(tokenOrJti: string, store?: RevocationStore): boolean | Promise<boolean> {
  if (store) {
    return store.isRevoked(tokenOrJti);
  }
  const exp = revokedTokens.get(tokenOrJti);
  if (exp === undefined) return false;
  if (Date.now() >= exp) {
    revokedTokens.delete(tokenOrJti);
    return false;
  }
  return true;
}

export type JwtAlgorithm = 'HS256' | 'RS256' | 'ES256';

export interface BareAuthOptions {
  secret?: string;
  algorithms?: JwtAlgorithm[];
  publicKey?: string | CryptoKey;
  jwksUri?: string;
  jwksCacheTtlMs?: number;
  issuer?: string | string[];
  audience?: string | string[];
  revocationStore?: RevocationStore;
  isRevoked?: (payload: any, token: string) => boolean | Promise<boolean>;
}

const pemKeyCache = new Map<string, CryptoKey>();

const getAsymmetricAlgParams = (alg: 'RS256' | 'ES256') =>
  alg === 'RS256'
    ? ({ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const)
    : ({ name: 'ECDSA', namedCurve: 'P-256' } as const);

const getVerifyParams = (alg: 'RS256' | 'ES256') =>
  alg === 'RS256'
    ? ({ name: 'RSASSA-PKCS1-v1_5' } as const)
    : ({ name: 'ECDSA', hash: 'SHA-256' } as const);

const pemToDer = (pem: string): ArrayBuffer => {
  const b64 = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const importPublicKey = async (keyOrPem: string | CryptoKey, alg: 'RS256' | 'ES256'): Promise<CryptoKey> => {
  if (typeof keyOrPem !== 'string') return keyOrPem;
  const cacheKey = `${alg}:${keyOrPem}`;
  const cached = pemKeyCache.get(cacheKey);
  if (cached) return cached;
  const imported = await crypto.subtle.importKey(
    'spki',
    pemToDer(keyOrPem),
    getAsymmetricAlgParams(alg),
    false,
    ['verify']
  );
  pemKeyCache.set(cacheKey, imported);
  return imported;
};

/**
 * 1. BARE TOKEN AUTH (Standard JWT Middleware)
 * High-performance, constant-time JWT middleware for BareJS.
 * Supports HS256 (sync fast-path), RS256, ES256, and JWKS with kid caching.
 */
export const bareAuth = (secretOrOpts: string | BareAuthOptions) => {
  const opts: BareAuthOptions = typeof secretOrOpts === 'string' ? { secret: secretOrOpts } : secretOrOpts;
  const secret = opts.secret ?? '';
  const customRevoked = opts.isRevoked;
  const revocationStore = opts.revocationStore;
  const publicKey = opts.publicKey;
  const jwksUri = opts.jwksUri;
  const jwksCacheTtlMs = opts.jwksCacheTtlMs ?? 300_000;
  const allowedAlgs: JwtAlgorithm[] = opts.algorithms ?? (publicKey || jwksUri ? ['RS256', 'ES256'] : ['HS256']);
  const expectedIss = opts.issuer === undefined ? null : (Array.isArray(opts.issuer) ? opts.issuer : [opts.issuer]);
  const expectedAud = opts.audience === undefined ? null : (Array.isArray(opts.audience) ? opts.audience : [opts.audience]);

  const finishAuth = (ctx: any, decoded: any, next: any) => {
    ctx.set('user', decoded);
    if (Array.isArray(next)) {
      if (next.length === 0) return;
      const [current, ...rest] = next;
      return current(ctx, rest);
    }
    if (typeof next === 'function') {
      return next();
    }
    return;
  };

  const checkClaimsAndRevocation = (ctx: any, decoded: any, token: string, next: any) => {
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return ctx.status(401).send("Invalid token payload");
    }

    const nowSec = Date.now() * 0.001;
    if (typeof decoded.exp === 'number' && nowSec >= decoded.exp) {
      return ctx.status(401).send("Token expired");
    }
    if (typeof decoded.nbf === 'number' && nowSec < decoded.nbf) {
      return ctx.status(401).send("Token not active");
    }
    if (expectedIss && (typeof decoded.iss !== 'string' || !expectedIss.includes(decoded.iss))) {
      return ctx.status(401).send("Invalid token issuer");
    }
    if (expectedAud) {
      const tokenAud = Array.isArray(decoded.aud) ? decoded.aud : (typeof decoded.aud === 'string' ? [decoded.aud] : []);
      if (!tokenAud.some((a: any) => typeof a === 'string' && expectedAud.includes(a))) {
        return ctx.status(401).send("Invalid token audience");
      }
    }

    if (isTokenRevoked(token) || (decoded?.jti && isTokenRevoked(String(decoded.jti)))) {
      return ctx.status(401).send("Token revoked");
    }

    if (revocationStore) {
      const checkStore = async () => {
        if (await revocationStore.isRevoked(token)) return ctx.status(401).send("Token revoked");
        if (decoded?.jti && await revocationStore.isRevoked(String(decoded.jti))) {
          return ctx.status(401).send("Token revoked");
        }
        if (customRevoked) {
          const rev = await customRevoked(decoded, token);
          if (rev) return ctx.status(401).send("Token revoked");
        }
        return finishAuth(ctx, decoded, next);
      };
      return checkStore();
    }

    if (customRevoked) {
      const rev = customRevoked(decoded, token);
      if (rev && typeof (rev as Promise<boolean>).then === 'function') {
        return (rev as Promise<boolean>).then((isRev) =>
          isRev ? ctx.status(401).send("Token revoked") : finishAuth(ctx, decoded, next)
        );
      }
      if (rev) return ctx.status(401).send("Token revoked");
    }

    return finishAuth(ctx, decoded, next);
  };

  // Preserve zero-overhead synchronous HS256 fast path when no asymmetric keys/JWKS are configured
  const isSymmetricOnly =
    !publicKey &&
    !jwksUri &&
    allowedAlgs.length === 1 &&
    allowedAlgs[0] === 'HS256';

  if (isSymmetricOnly) {
    const verifySync = (ctx: any, next: any) => {
      const authHeader = ctx.req.headers.get('Authorization');

      if (!authHeader?.startsWith('Bearer ')) {
        return ctx.status(401).send("Bearer token required");
      }

      const token = authHeader.slice(7);
      const firstDot = token.indexOf('.');
      const secondDot = firstDot === -1 ? -1 : token.indexOf('.', firstDot + 1);
      if (firstDot === -1 || secondDot === -1 || token.indexOf('.', secondDot + 1) !== -1) {
        return ctx.status(401).send("Malformed JWT token");
      }

      const headerB64 = token.slice(0, firstDot);
      const payloadB64 = token.slice(firstDot + 1, secondDot);
      const sigB64 = token.slice(secondDot + 1);
      const data = token.slice(0, secondDot);

      try {
        const expectedSig = createHmac('sha256', secret).update(data).digest();
        const actualSig = Buffer.from(sigB64, 'base64url');

        if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
          return ctx.status(401).send("Invalid signature");
        }

        const headerObj = JSON.parse(fromBase64Url(headerB64));
        if (!headerObj || headerObj.alg !== 'HS256') {
          return ctx.status(401).send("Unsupported token algorithm");
        }

        const decoded = JSON.parse(fromBase64Url(payloadB64));
        return checkClaimsAndRevocation(ctx, decoded, token, next);
      } catch {
        return ctx.status(401).send("Token verification failed");
      }
    };

    if (customRevoked || revocationStore) {
      return async (ctx: any, next: any) => verifySync(ctx, next);
    }
    return verifySync;
  }

  // Asymmetric (RS256 / ES256) and/or JWKS verification path
  let jwksFetchedAt = 0;
  let lastForceRefreshAt = 0;
  let jwksKeys: any[] = [];
  let inFlightJwks: Promise<any[]> | null = null;
  const jwkKeyCache = new Map<string, CryptoKey>();
  const JWKS_FORCE_COOLDOWN_MS = 15_000;

  const loadJwks = async (forceRefresh = false): Promise<any[]> => {
    const now = Date.now();
    if (!forceRefresh && jwksKeys.length > 0 && now - jwksFetchedAt < jwksCacheTtlMs) {
      return jwksKeys;
    }
    if (forceRefresh && now - lastForceRefreshAt < JWKS_FORCE_COOLDOWN_MS && jwksKeys.length > 0) {
      return jwksKeys;
    }
    if (inFlightJwks) return inFlightJwks;

    if (forceRefresh) lastForceRefreshAt = now;
    inFlightJwks = (async () => {
      const res = await fetch(jwksUri!, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
      const body = (await res.json()) as { keys?: any[] };
      jwksKeys = Array.isArray(body?.keys) ? body.keys : [];
      jwksFetchedAt = Date.now();
      if (forceRefresh) jwkKeyCache.clear();
      return jwksKeys;
    })().finally(() => {
      inFlightJwks = null;
    });
    return inFlightJwks;
  };

  const matchJwk = (keys: any[], kid: string | undefined, alg: 'RS256' | 'ES256') => {
    const isUsable = (k: any) =>
      k &&
      k.use !== 'enc' &&
      (!k.alg || k.alg === alg);
    return kid
      ? keys.find((k) => k.kid === kid && isUsable(k))
      : keys.find((k) => isUsable(k));
  };

  const resolveJwksKey = async (kid: string | undefined, alg: 'RS256' | 'ES256'): Promise<CryptoKey | null> => {
    const cacheId = `${alg}:${kid ?? '__default__'}`;
    const cached = jwkKeyCache.get(cacheId);
    if (cached && Date.now() - jwksFetchedAt < jwksCacheTtlMs) return cached;

    let keys = await loadJwks(false);
    let match = matchJwk(keys, kid, alg);
    if (!match && kid) {
      keys = await loadJwks(true);
      match = matchJwk(keys, kid, alg);
    }
    if (!match) return null;

    const imported = await crypto.subtle.importKey(
      'jwk',
      match,
      getAsymmetricAlgParams(alg),
      false,
      ['verify']
    );
    jwkKeyCache.set(cacheId, imported);
    return imported;
  };

  return async (ctx: any, next: any) => {
    const authHeader = ctx.req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return ctx.status(401).send("Bearer token required");
    }

    const token = authHeader.slice(7);
    const firstDot = token.indexOf('.');
    const secondDot = firstDot === -1 ? -1 : token.indexOf('.', firstDot + 1);
    if (firstDot === -1 || secondDot === -1 || token.indexOf('.', secondDot + 1) !== -1) {
      return ctx.status(401).send("Malformed JWT token");
    }

    const headerB64 = token.slice(0, firstDot);
    const payloadB64 = token.slice(firstDot + 1, secondDot);
    const sigB64 = token.slice(secondDot + 1);
    const data = token.slice(0, secondDot);

    try {
      const headerObj = JSON.parse(fromBase64Url(headerB64));
      const alg = headerObj?.alg as JwtAlgorithm | undefined;
      if (!alg || !allowedAlgs.includes(alg)) {
        return ctx.status(401).send("Unsupported token algorithm");
      }

      if (alg === 'HS256') {
        if (!secret) return ctx.status(401).send("Unsupported token algorithm");
        const expectedSig = createHmac('sha256', secret).update(data).digest();
        const actualSig = Buffer.from(sigB64, 'base64url');
        if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
          return ctx.status(401).send("Invalid signature");
        }
      } else {
        let verifyKey: CryptoKey | null = null;
        if (jwksUri) {
          verifyKey = await resolveJwksKey(headerObj?.kid, alg);
        } else if (publicKey) {
          verifyKey = await importPublicKey(publicKey, alg);
        }
        if (!verifyKey) {
          return ctx.status(401).send("Invalid signature");
        }
        const sigBuf = Buffer.from(sigB64, 'base64url');
        const sigBytes = sigBuf.buffer.slice(sigBuf.byteOffset, sigBuf.byteOffset + sigBuf.byteLength);
        const valid = await crypto.subtle.verify(
          getVerifyParams(alg),
          verifyKey,
          sigBytes,
          encoder.encode(data)
        );
        if (!valid) {
          return ctx.status(401).send("Invalid signature");
        }
      }

      const decoded = JSON.parse(fromBase64Url(payloadB64));
      return checkClaimsAndRevocation(ctx, decoded, token, next);
    } catch {
      return ctx.status(401).send("Token verification failed");
    }
  };
};

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * 2. BASIC AUTH
 * Useful for internal tools and simple admin panels
 */
export const basicAuth = (credentials: { user: string; pass: string }) => {
  const expectedUserHash = sha256(credentials.user);
  const expectedPassHash = sha256(credentials.pass);

  return async (ctx: any, next: Next) => {
    const authHeader = ctx.req.headers.get('Authorization');
    if (!authHeader?.startsWith('Basic ')) {
      return ctx.status(401).json({ status: 'error', message: 'Basic Auth required' });
    }

    const token = authHeader.slice(6).trim();
    if (!token) return ctx.status(401).json({ status: 'error', message: 'Missing credentials' });

    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      return ctx.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    const user = decoded.slice(0, colonIdx);
    const pass = decoded.slice(colonIdx + 1);

    const userMatch = timingSafeEqual(sha256(user), expectedUserHash);
    const passMatch = timingSafeEqual(sha256(pass), expectedPassHash);

    if (userMatch && passMatch) {
      return next();
    }

    return ctx.status(401).json({ status: 'error', message: 'Invalid credentials' });
  };
};

/**
 * 5. ROLE AUTHORIZATION (Bonus Max Function)
 * Ensures user has specific permissions after bareAuth
 */
export const hasRole = (role: string) => {
  return async (ctx: any, next: Next) => {
    const user = ctx.get('user');
    if (!user || user.role !== role) {
      return ctx.status(403).json({ status: 'error', message: `Required role: ${role}` });
    }
    return next();
  };
};