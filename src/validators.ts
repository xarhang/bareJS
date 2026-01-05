// src/validators.ts
import * as Compiler from '@sinclair/typebox/compiler';
import type { Context, Next } from './context';

export const typebox = (schema: any) => {
  const check = Compiler.TypeCompiler.Compile(schema);
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json();
      if (!check.Check(body)) return new Response("Validation Failed", { status: 400 });
      ctx.body = body;
      return next();
    } catch { 
      return new Response("Invalid JSON", { status: 400 }); 
    }
  };
};

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
          return new Response(`Validation Failed: ${k}`, { status: 400 });
        }
      }
      
      ctx.body = body;
      return next();
    } catch { 
      return new Response("Invalid JSON", { status: 400 }); 
    }
  };
};

export const zod = (schema: any) => {
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json();
      const result = schema.safeParse(body);
      if (!result.success) return new Response(JSON.stringify(result.error), { status: 400 });
      ctx.body = result.data;
      return next();
    } catch { 
      return new Response("Invalid JSON", { status: 400 }); 
    }
  };
};
