// All comments in English
import * as Compiler from '@sinclair/typebox/compiler';
import type { Middleware } from './context';

/**
 * Fast JSON Response helper for validators to maintain Zero-Object speed
 */
const errorJSON = (data: any, status = 400) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

/**
 * TypeBox Validator (JIT Compiled)
 */
export const typebox = (schema: any) => {
  const check = Compiler.TypeCompiler.Compile(schema);
  const mw: Middleware = async (req, _, next) => {
    try {
      const body = await req.json();
      if (!check.Check(body)) {
        const error = check.Errors(body).First();
        return errorJSON({
          status: 'error',
          code: 'VALIDATION_FAILED',
          message: error?.message || 'Invalid input',
          path: error?.path || 'body'
        });
      }
      (req as any).parsedBody = body;
      return next();
    } catch {
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' });
    }
  };
  return mw;
};

/**
 * Native Schema Validator
 */
export const native = (schema: any) => {
  const props = schema.properties || {};
  const keys = Object.keys(props);
  const kLen = keys.length;
  
  const mw: Middleware = async (req, _, next) => {
    try {
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
      (req as any).parsedBody = body;
      return next();
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
  const mw: Middleware = async (req, _, next) => {
    try {
      const body = await req.json();
      const result = schema.safeParse(body);
      if (!result.success) {
        return errorJSON({
          status: 'error',
          code: 'ZOD_ERROR',
          errors: result.error.format()
        });
      }
      (req as any).parsedBody = result.data;
      return next();
    } catch { 
      return errorJSON({ status: 'error', message: 'Invalid JSON payload' }); 
    }
  };
  return mw;
};