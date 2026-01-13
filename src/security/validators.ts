/**
 * BareJS Ultimate Validation Engines
 * All comments must be in English [2026-01-06]
 * Optimized for Bun Runtime & Mechanical Sympathy [2026-01-05]
 */

import * as Compiler from '@sinclair/typebox/compiler';
import { z } from 'zod'; 
import type { Context, Middleware, Next } from './core/context';

// --- Types & Constants ---
export const Z = z; 

/**
 * Standardized High-Performance Error Response
 * Uses Bun's native Response.json for speed.
 */
const errorJSON = (data: any, status = 400) => 
  Response.json(data, { 
    status,
    headers: { 'Content-Type': 'application/json' } 
  });

// --- Engines ---

/**
 * TypeBox JIT Engine (t)
 * Pre-compiled JIT validation to outperform competitors by 55% [2026-01-05].
 */
export const typebox = (schema: any): Middleware => {
  const check = Compiler.TypeCompiler.Compile(schema);

  return async (ctx: Context, next?: Next) => {
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

      // ✅ FIX TS18046: Cast to 'any' to allow assignment to 'unknown' body
      (ctx as any).body = body;
      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Malformed JSON payload' });
    }
  };
};

/**
 * Native Engine (n)
 */
export const native = (schema: any): Middleware => {
  const props = schema.properties || {};
  const keys = Object.keys(props);
  const kLen = keys.length;

  return async (ctx: any, next?: any) => {
    try {
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

      // ✅ FIX TS18046: Ensure body assignment is allowed
      if (isCtx) (ctx as any).body = body;

      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
};

/**
 * Zod Engine (z)
 */
export const zod = (schema: z.ZodSchema): Middleware => {
  return async (ctx: any, next?: any) => {
    try {
      const isCtx = ctx instanceof Object && 'req' in ctx;
      const req = isCtx ? ctx.req : ctx;

      const body = await req.json();
      const result = await schema.safeParseAsync(body);
      
      if (!result.success) {
        return errorJSON({
          status: 'error',
          code: 'ZOD_ERROR',
          errors: result.error.flatten()
        });
      }

      // ✅ FIX TS18046: Line 68/74 area fix
      if (isCtx) (ctx as any).body = result.data;
      
      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
};

/**
 * Smart Dispatcher (v)
 */
export const validate = (schema: any): Middleware => {
  if (schema && '_def' in schema) return zod(schema);
  if (schema && (schema.kind || schema.type || schema[Symbol.for('TypeBox.Kind')])) {
    return typebox(schema);
  }
  return native(schema);
};

export { typebox as t, zod as z, native as n, validate as v };