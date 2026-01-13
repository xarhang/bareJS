import type { AuthUser, Next } from '../core/context';
// import { timingSafeEqual } from 'node:crypto';

/**
 * UTILS: Internal Crypto Helpers using Native Web Crypto
 * Optimized for Bun performance and type safety.
 */
const encoder = new TextEncoder();

// ⚡ Base64Url Helpers (RFC 4648)
const base64Url = (input: Uint8Array | string): string => {
  let base64 = typeof input === 'string'
    ? Buffer.from(input).toString('base64')
    : Buffer.from(input).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (str: string): string => {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString();
};

// ⚡ PERF: Cache CryptoKeys to avoid repeated async importKey calls
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

/**
 * 1. BARE TOKEN AUTH (Standard JWT Middleware)
 * High-performance JWT alternative for BareJS
 */
export const bareAuth = (secret: string) => {
  return async (ctx: any, next: any) => {
    const authHeader = ctx.req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return ctx.status(401).json({ message: "Bearer token required" });
    }

    const token = authHeader.slice(7);
    const parts = token.split('.');

    if (parts.length !== 3) {
      return ctx.status(401).json({ message: 'Malformed JWT token' });
    }

    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;

    try {
      const key = await importKey(secret);

      // Verify Signature
      const expectedSig = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(data)
      );

      const validSig = base64Url(new Uint8Array(expectedSig));

      if (signature !== validSig) {
        return ctx.status(401).json({ message: 'Invalid signature' });
      }

      // Decode Payload
      const decoded = JSON.parse(fromBase64Url(payload!));
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

    } catch (e) {
      console.error("[Auth] Error:", e);
      return ctx.status(401).json({ message: 'Token verification failed' });
    }
  };
};

/**
 * 2. BASIC AUTH
 * Useful for internal tools and simple admin panels
 */
export const basicAuth = (credentials: { user: string; pass: string }) => {
  return async (ctx: any, next: Next) => {
    const authHeader = ctx.req.headers.get('Authorization');
    if (!authHeader?.startsWith('Basic ')) {
      return ctx.status(401).json({ status: 'error', message: 'Basic Auth required' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) return ctx.status(401).json({ status: 'error', message: 'Missing credentials' });

    const decoded = Buffer.from(token, 'base64').toString();
    const [user, pass] = decoded.split(':');

    if (user === credentials.user && pass === credentials.pass) {
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