import * as Compiler from '@sinclair/typebox/compiler';
import type { Context, Middleware } from './context';

const errorJSON = (data: any, status = 400) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

export const typebox = (schema: any) => {
  const check = Compiler.TypeCompiler.Compile(schema);

  return async (ctx: Context, next: any) => {
    try {
      const body = await ctx.req.json();
      if (!check.Check(body)) {
        const error = check.Errors(body).First();
        return errorJSON({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: error?.message || 'Invalid input',
          path: error?.path || 'body'
        });
      }

      ctx.body = body;
      // ✅ FIX TS2722: Check if next exists before calling
      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
};

/**
 * Native Schema Validator
 */
export const native = (schema: any) => {
  const props = schema.properties || {};
  const keys = Object.keys(props);
  const kLen = keys.length;

  const mw: Middleware = async (ctx: any, next?: any) => {
    try {
      // Handle both (ctx, next) and (req, params, next) styles
      const isCtx = ctx instanceof Object && 'req' in ctx;
      const req = isCtx ? ctx.req : ctx;

      const body = await req.json() as any;
      for (let i = 0; i < kLen; i++) {
        const k = keys[i]!;
        if (typeof body[k] !== props[k]?.type) {
          return errorJSON({
            status: 'error',
            code: 'TYPE_MISMATCH',
            message: `Field '${k}' must be of type ${props[k]?.type}`,
            field: k
          });
        }
      }

      if (isCtx) ctx.body = body;

      // ✅ FIX TS2722: Check next
      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
  return mw;
};

/**
 * Zod Validator
 */
export const zod = (schema: any) => {
  const mw: Middleware = async (ctx: any, next?: any) => {
    try {
      const isCtx = ctx instanceof Object && 'req' in ctx;
      const req = isCtx ? ctx.req : ctx;

      const body = await req.json();
      const result = schema.safeParse(body);
      if (!result.success) {
        return errorJSON({
          status: 'error',
          code: 'ZOD_ERROR',
          errors: result.error.format()
        });
      }

      if (isCtx) ctx.body = result.data;

      // ✅ FIX TS2722: Check next
      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
  return mw;
};