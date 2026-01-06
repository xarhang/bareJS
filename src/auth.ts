import type { Context, Next } from './context';

/**
 * UTILS: Internal Crypto Helpers using Native Web Crypto
 * This approach is Type-safe and highly compatible with Bun
 */
const encoder = new TextEncoder();

const signData = async (data: string, secret: string): Promise<string> => {
  // Using Bun.crypto.hmac with 'any' cast to bypass version-specific type issues
  const hmac = (Bun as any).crypto.hmac("sha256", secret, data);
  return Buffer.from(hmac).toString("hex");
};

const verifyData = async (data: string, signature: string, secret: string): Promise<boolean> => {
  const expectedSignature = await signData(data, secret);
  // Using crypto.subtle.timingSafeEqual or Bun's native timingSafeEqual
  return (Bun as any).crypto.timingSafeEqual(
    encoder.encode(signature),
    encoder.encode(expectedSignature)
  );
};

/**
 * 1. BARE TOKEN AUTH (High Performance JWT-like)
 */
export const bareAuth = (secret: string) => {
  return async (ctx: Context, next: Next) => {
    const authHeader = ctx.req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return ctx.status(401).json({ status: 'error', message: 'Bearer token required' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) return ctx.status(401).json({ status: 'error', message: 'Invalid token format' });

    const parts = token.split('.');
    if (parts.length !== 2) {
      return ctx.status(401).json({ status: 'error', message: 'Malformed token' });
    }

    const [payloadBase64, signature] = parts;

    try {
      const payloadRaw = Buffer.from(payloadBase64!, 'base64').toString();
      const isValid = await verifyData(payloadRaw, signature!, secret);

      if (!isValid) {
        return ctx.status(401).json({ status: 'error', message: 'Invalid signature' });
      }

      ctx.set('user', JSON.parse(payloadRaw));
      return next();
    } catch (e) {
      return ctx.status(401).json({ status: 'error', message: 'Token verification failed' });
    }
  };
};

/**
 * 2. BASIC AUTH
 */
export const basicAuth = (credentials: { user: string; pass: string }) => {
  return async (ctx: Context, next: Next) => {
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
 */
export const Password = {
  hash: (password: string) => Bun.password.hash(password, { algorithm: "argon2id" }),
  verify: (password: string, hash: string) => Bun.password.verify(password, hash)
};

/**
 * 4. TOKEN GENERATOR
 */
export const createToken = async (payload: object, secret: string): Promise<string> => {
  const payloadStr = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(payloadStr).toString('base64');
  const signature = await signData(payloadStr, secret);
  return `${payloadBase64}.${signature}`;
};