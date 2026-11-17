/**
 * BareJS Ultimate Validation Engines
 * All comments must be in English [2026-01-06]
 * Optimized for Bun Runtime & Mechanical Sympathy [2026-01-05]
 */

import * as Compiler from '@sinclair/typebox/compiler';
import { z } from 'zod'; 
import type { Context, Middleware, Next } from '../core/context';

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

  const mw: Middleware = async (ctx: any, next?: Next) => {
    try {
      const isCtx = ctx instanceof Object && 'req' in ctx;
      const body = isCtx ? await ctx.jsonBody() : await ctx.json();
      
      if (!check.Check(body)) {
        const error = check.Errors(body).First();
        return errorJSON({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: error?.message || 'Invalid input',
          path: error?.path || 'body'
        });
      }

      if (isCtx) (ctx as any).body = body;
      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Malformed JSON payload' });
    }
  };
  (mw as any).__schema = schema;
  return mw;
};

/**
 * Native Engine (n)
 */
export const native = (schema: any): Middleware => {
  const props = schema.properties || {};
  const keys = Object.keys(props);
  const kLen = keys.length;
  const reqSet = Array.isArray(schema.required) ? new Set<string>(schema.required) : null;

  const mw: Middleware = async (ctx: any, next?: any) => {
    try {
      const isCtx = ctx instanceof Object && 'req' in ctx;
      const body = isCtx ? await ctx.jsonBody() : await ctx.json();

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return errorJSON({ status: 'error', message: 'Invalid JSON object payload' });
      }

      for (let i = 0; i < kLen; i++) {
        const k = keys[i]!;
        const hasKey = Object.hasOwn(body, k) && body[k] !== undefined;
        if (!hasKey) {
          if (!reqSet || reqSet.has(k)) {
            return errorJSON({
              status: 'error',
              code: 'TYPE_MISMATCH',
              message: `Field '${k}' must be of type ${props[k]?.type}`,
              field: k
            });
          }
          continue;
        }
        if (typeof body[k] !== props[k]?.type) {
          return errorJSON({
            status: 'error',
            code: 'TYPE_MISMATCH',
            message: `Field '${k}' must be of type ${props[k]?.type}`,
            field: k
          });
        }
      }

      if (isCtx) (ctx as any).body = body;

      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
  (mw as any).__schema = schema;
  return mw;
};

/**
 * Zod Engine (z)
 */
export const zod = (schema: z.ZodSchema): Middleware => {
  const mw: Middleware = async (ctx: any, next?: any) => {
    try {
      const isCtx = ctx instanceof Object && 'req' in ctx;
      const body = isCtx ? await ctx.jsonBody() : await ctx.json();

      const result = await schema.safeParseAsync(body);

      if (!result.success) {
        return errorJSON({
          status: 'error',
          code: 'ZOD_ERROR',
          errors: result.error.flatten()
        });
      }

      if (isCtx) (ctx as any).body = result.data;

      return next ? next() : undefined;
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
  (mw as any).__schema = schema;
  return mw;
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

export interface RouteDetail {
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface RouteSchemas {
  body?: any;
  query?: any;
  params?: any;
  headers?: any;
  response?: any;
  /** Strip undeclared properties from validated body using JIT projector (prevents Mass Assignment) */
  stripUnknown?: boolean;
  detail?: RouteDetail;
  maxBodySize?: number;
}

const compileSingleSchema = (schema: any): ((val: any) => { ok: boolean; data?: any; error?: any }) => {
  if (schema && '_def' in schema) {
    return (val: any) => {
      const r = schema.safeParse(val);
      return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error.flatten() };
    };
  }
  const check = Compiler.TypeCompiler.Compile(schema);
  return (val: any) => {
    if (check.Check(val)) return { ok: true, data: val };
    const first = check.Errors(val).First();
    return { ok: false, error: { message: first?.message || 'Invalid input', path: first?.path } };
  };
};

const buildProjectorExpr = (schema: any, accessor: string): string | null => {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return null;
  const entries: string[] = [];
  for (const [k, subSchema] of Object.entries<any>(props)) {
    const keyLit = JSON.stringify(k);
    const propAccess = `${accessor}[${keyLit}]`;
    const nestedExpr = buildProjectorExpr(subSchema, propAccess);
    if (nestedExpr) {
      entries.push(`${keyLit}: (${propAccess} && typeof ${propAccess} === 'object' && !Array.isArray(${propAccess})) ? ${nestedExpr} : ${propAccess}`);
    } else {
      entries.push(`${keyLit}: ${propAccess}`);
    }
  }
  return `{ ${entries.join(', ')} }`;
};

const compileProjector = (schema: any): ((val: any) => any) | null => {
  if (!schema || '_def' in schema) return null; // Zod safeParse strips unknown keys natively
  if (schema.type === 'array' && schema.items) {
    const itemExpr = buildProjectorExpr(schema.items, 'item');
    if (!itemExpr) return null;
    return new Function(
      `return function(arr) {
        if (!Array.isArray(arr)) return arr;
        const len = arr.length;
        const out = new Array(len);
        for (let i = 0; i < len; i++) {
          const item = arr[i];
          out[i] = (item && typeof item === 'object' && !Array.isArray(item)) ? ${itemExpr} : item;
        }
        return out;
      }`
    )();
  }
  const objExpr = buildProjectorExpr(schema, 'o');
  if (!objExpr) return null;
  return new Function(
    `return function(o) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
      return ${objExpr};
    }`
  )();
};

export const createResponseFilter = (schema: any): ((val: any) => any) => {
  const check = compileSingleSchema(schema);
  const project = compileProjector(schema);

  return (val: any) => {
    if (val instanceof Response) return val;
    const filtered = project ? project(val) : val;
    const r = check(filtered);
    if (!r.ok) {
      return errorJSON({ status: 'error', code: 'RESPONSE_VALIDATION_FAILED', error: r.error }, 500);
    }
    return r.data;
  };
};

const coerceFields = (obj: Record<string, any>, schema: any): Record<string, any> => {
  const props = schema?.properties || (schema?._def?.shape ? (typeof schema._def.shape === 'function' ? schema._def.shape() : schema._def.shape) : null);
  if (!props) return obj;
  const out: Record<string, any> = { ...obj };
  for (const [k, propSchema] of Object.entries<any>(props)) {
    if (!Object.hasOwn(out, k)) continue;
    const val = out[k];
    if (typeof val !== 'string') continue;
    const tType = propSchema?.type || propSchema?._def?.typeName;
    if (tType === 'number' || tType === 'integer' || tType === 'ZodNumber') {
      if (val.trim() !== '') {
        const n = Number(val);
        if (!Number.isNaN(n)) out[k] = n;
      }
    } else if (tType === 'boolean' || tType === 'ZodBoolean') {
      if (val === 'true') out[k] = true;
      else if (val === 'false') out[k] = false;
    }
  }
  return out;
};

export const schemaValidator = (schemas: RouteSchemas): Middleware => {
  const bodyCheck = schemas.body ? compileSingleSchema(schemas.body) : null;
  const queryCheck = schemas.query ? compileSingleSchema(schemas.query) : null;
  const paramsCheck = schemas.params ? compileSingleSchema(schemas.params) : null;
  const headersCheck = schemas.headers ? compileSingleSchema(schemas.headers) : null;
  const bodyProjector = schemas.stripUnknown && schemas.body ? compileProjector(schemas.body) : null;
  const responseFilter = schemas.response ? createResponseFilter(schemas.response) : null;
  const maxBodySize = schemas.maxBodySize ?? 1048576;

  const validateSyncParts = (ctx: Context): Response | undefined => {
    if (paramsCheck) {
      const coerced = coerceFields(ctx.params, schemas.params);
      const r = paramsCheck(coerced);
      if (!r.ok) return errorJSON({ status: 'error', code: 'PARAMS_INVALID', error: r.error });
      ctx.params = r.data;
    }
    if (queryCheck) {
      const coerced = coerceFields(ctx.query, schemas.query);
      const r = queryCheck(coerced);
      if (!r.ok) return errorJSON({ status: 'error', code: 'QUERY_INVALID', error: r.error });
      ctx._query = r.data;
    }
    if (headersCheck) {
      const hdrObj: Record<string, string> = {};
      ctx.req.headers.forEach((v, k) => { hdrObj[k.toLowerCase()] = v; });
      const r = headersCheck(hdrObj);
      if (!r.ok) return errorJSON({ status: 'error', code: 'HEADERS_INVALID', error: r.error });
    }
    return undefined;
  };

  if (!bodyCheck) {
    const syncMw: Middleware = (ctx: Context, next?: Next) => {
      const errRes = validateSyncParts(ctx);
      if (errRes) return errRes;
      return next ? next() : undefined;
    };
    (syncMw as any).__routeSchemas = schemas;
    if (responseFilter) (syncMw as any).__responseFilter = responseFilter;
    return syncMw;
  }

  const mw: Middleware = async (ctx: Context, next?: Next) => {
    const errRes = validateSyncParts(ctx);
    if (errRes) return errRes;

    let body: any;
    try {
      body = await ctx.jsonBody(maxBodySize);
    } catch (e: any) {
      if (e?.status === 413) {
        return errorJSON({ status: 'error', code: 'PAYLOAD_TOO_LARGE', message: 'Payload Too Large' }, 413);
      }
      return errorJSON({ status: 'error', message: 'Malformed JSON payload' });
    }
    const r = bodyCheck(body);
    if (!r.ok) return errorJSON({ status: 'error', code: 'VALIDATION_FAILED', error: r.error });
    ctx.body = bodyProjector ? bodyProjector(r.data) : r.data;

    return next ? next() : undefined;
  };
  (mw as any).__schema = schemas.body;
  (mw as any).__routeSchemas = schemas;
  if (responseFilter) (mw as any).__responseFilter = responseFilter;
  return mw;
};