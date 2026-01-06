// src/cors.ts
import type { Context, Next } from './context';

export const cors = (options: { origin?: string; methods?: string } = {}) => {
  return async (ctx: Context, next: Next) => {
    const origin = options.origin || '*';
    const methods = options.methods || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

    // Set CORS Headers
    ctx.set('Access-Control-Allow-Origin', origin);
    ctx.set('Access-Control-Allow-Methods', methods);
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle Preflight
    if (ctx.req.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    return next();
  };
};