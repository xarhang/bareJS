import * as Compiler from '@sinclair/typebox/compiler';

/**
 * 1. TypeBox Validator: Highest Performance (JIT Optimized)
 * Best for: Production and Benchmarking
 */
export const typebox = (schema: any) => {
  const check = Compiler.TypeCompiler.Compile(schema);
  return async (ctx: any, next: any) => {
    try {
      const body = await ctx.req.json();
      if (!check.Check(body)) return new Response("TypeBox Validation Failed", { status: 400 });
      ctx.body = body;
      return next();
    } catch { return new Response("Invalid JSON", { status: 400 }); }
  };
};

/**
 * 2. Native Validator: Zero Dependency
 * Best for: Avoiding Runtime bugs or keeping the bundle lightweight.
 */
export const native = (schema: any) => {
  const properties = schema.properties || {};
  const keys = Object.keys(properties);
  return async (ctx: any, next: any) => {
    try {
      const body = await ctx.req.json();
      for (const key of keys) {
        if (typeof body[key] !== properties[key].type) 
          return new Response(`Native Validation Failed: ${key} is not ${properties[key].type}`, { status: 400 });
      }
      ctx.body = body;
      return next();
    } catch { return new Response("Invalid JSON", { status: 400 }); }
  };
};

/**
 * 3. Zod Validator: Best Developer Experience
 * Note: Requires 'npm install zod'
 */
export const zod = (schema: any) => {
  return async (ctx: any, next: any) => {
    try {
      const body = await ctx.req.json();
      const result = schema.safeParse(body);
      if (!result.success) return new Response(JSON.stringify(result.error), { status: 400 });
      ctx.body = result.data;
      return next();
    } catch { return new Response("Invalid JSON", { status: 400 }); }
  };
};