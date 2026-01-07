import type {  AuthUser, Next } from './context';

/**
 * UTILS: Internal Crypto Helpers using Native Web Crypto
 * Optimized for Bun performance and type safety.
 */
const encoder = new TextEncoder();

/**
 * SIGN: Creates a HMAC-SHA256 signature
 */
const signData = async (data: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(data)
  );

  return Buffer.from(signature).toString("hex");
};

/**
 * VERIFY: Checks signature integrity using Constant-Time comparison
 */
const verifyData = async (data: string, signature: string, secret: string): Promise<boolean> => {
  const expectedSignature = await signData(data, secret);
  
  const a = encoder.encode(signature);
  const b = encoder.encode(expectedSignature);

  // Critical: timingSafeEqual requires buffers of identical length
  if (a.byteLength !== b.byteLength) return false;
  
  return (Bun as any).crypto.timingSafeEqual(a, b);
};

/**
 * 1. BARE TOKEN AUTH (Stateless Middleware)
 * High-performance JWT alternative for BareJS
 */
export const bareAuth = (secret: string) => {
  return async (ctx: any, next: Next) => {
    // 1. Extract Header
    const authHeader = ctx.req.headers.get('Authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return ctx.status(401).json({ status: 'error', message: 'Bearer token required' });
    }

    // 2. Extract Token
    const token = authHeader.split(' ')[1];
    if (!token) {
      return ctx.status(401).json({ status: 'error', message: 'Invalid token format' });
    }

    // 3. Split Payload and Signature
    const parts = token.split('.');
    if (parts.length !== 2) {
      return ctx.status(401).json({ status: 'error', message: 'Malformed token' });
    }

    const [payloadBase64, signature] = parts;

    try {
      // 4. Decode and Verify
      const payloadRaw = Buffer.from(payloadBase64!, 'base64').toString();
      const isValid = await verifyData(payloadRaw, signature!, secret);

      if (!isValid) {
        return ctx.status(401).json({ status: 'error', message: 'Invalid signature' });
      }
      // 5. Attach User to Context
      const user: AuthUser = JSON.parse(payloadRaw);
      ctx.set('user', user);

      return next();
    } catch (e) {
      console.error("[Auth] Verification Error:", e);
      return ctx.status(401).json({ status: 'error', message: 'Token verification failed' });
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
 * 3. PASSWORD UTILS (Bun Native)
 * Uses Argon2id - the gold standard for password hashing
 */
export const Password = {
  hash: (password: string) => Bun.password.hash(password, { 
    algorithm: "argon2id",
    memoryCost: 65536, // 64MB
    timeCost: 2 
  }),
  verify: (password: string, hash: string) => Bun.password.verify(password, hash)
};

/**
 * 4. TOKEN GENERATOR
 * Creates a "Bare Token" consisting of base64(payload).hex(signature)
 */
export const createToken = async (payload: object, secret: string): Promise<string> => {
  const payloadStr = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadStr).toString('base64');
  const signature = await signData(payloadStr, secret);
  return `${payloadBase64}.${signature}`;
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