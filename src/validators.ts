// src/validators.ts
import * as Compiler from '@sinclair/typebox/compiler';
import type { Context, Next } from './context';

/**
 * TypeBox Validator (JIT Compiled)
 * Fastest validation for Bun environment
 */
export const typebox = (schema: any) => {
  const check = Compiler.TypeCompiler.Compile(schema);
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json();
      if (!check.Check(body)) {
        const error = check.Errors(body).First();
        return ctx.status(400).json({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: error?.message || 'Invalid input',
          path: error?.path || 'body'
        });
      }
      ctx.body = body;
      return next();
    } catch { 
      return ctx.status(400).json({ status: 'error', message: 'Invalid JSON payload' }); 
    }
  };
};

/**
 * Native Schema Validator
 * Lightweight, manual type checking without external dependencies
 */
export const native = (schema: any) => {
  const props = schema.properties || {};
  const keys = Object.keys(props);
  const kLen = keys.length;
  
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json() as any;
      
      for (let i = 0; i < kLen; i++) {
        const k = keys[i]!;
        if (typeof body[k] !== props[k]?.type) {
          return ctx.status(400).json({
            status: 'error',
            code: 'TYPE_MISMATCH',
            message: `Field '${k}' must be of type ${props[k]?.type}`,
            field: k
          });
        }
      }
      
      ctx.body = body;
      return next();
    } catch { 
      return ctx.status(400).json({ status: 'error', message: 'Invalid JSON payload' }); 
    }
  };
};

/**
 * Zod Validator
 * Industry standard for flexibility and developer experience
 */
export const zod = (schema: any) => {
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json();
      const result = schema.safeParse(body);
      if (!result.success) {
        return ctx.status(400).json({
          status: 'error',
          code: 'ZOD_ERROR',
          errors: result.error.format()
        });
      }
      ctx.body = result.data;
      return next();
    } catch { 
      return ctx.status(400).json({ status: 'error', message: 'Invalid JSON payload' }); 
    }
  };
};