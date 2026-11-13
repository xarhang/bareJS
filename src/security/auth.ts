import type { Next } from '../core/context';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * UTILS: Internal Crypto Helpers using Native Web Crypto & Node Crypto
 * Optimized for Bun performance and constant-time security.
 */
const encoder = new TextEncoder();

// Base64Url Helpers (RFC 4648) using native C++ Buffer encoding
const base64Url = (input: Uint8Array | string): string => {
  return typeof input === 'string'
    ? Buffer.from(input).toString('base64url')
    : Buffer.from(input).toString('base64url');
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

/**
 * 1. BARE TOKEN AUTH (Standard JWT Middleware)
 * High-performance, constant-time JWT middleware for BareJS
 */
export const bareAuth = (secret: string) => {
  return (ctx: any, next: any) => {
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
      const nowSec = Date.now() * 0.001;
      if (typeof decoded.exp === 'number' && nowSec >= decoded.exp) {
        return ctx.status(401).send("Token expired");
      }
      if (typeof decoded.nbf === 'number' && nowSec < decoded.nbf) {
        return ctx.status(401).send("Token not active");
      }

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