import * as Compiler from '@sinclair/typebox/compiler';
// ใช้ import type สำหรับ Types เพื่อความปลอดภัยของ TS
import type { Context, Next } from './context';

export const typebox = (schema: any) => {
  const check = Compiler.TypeCompiler.Compile(schema);
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json();
      if (!check.Check(body)) return new Response("TypeBox Validation Failed", { status: 400 });
      ctx.body = body;
      return next();
    } catch { return new Response("Invalid JSON", { status: 400 }); }
  };
};

export const native = (schema: any) => {
  const properties = schema.properties || {};
  const keys = Object.keys(properties);
  return async (ctx: Context, next: Next) => {
    try {
      const body = await ctx.req.json() as any; // Cast เป็น any เพื่อแก้ปัญหา 'unknown'
      for (const key of keys) {
        if (typeof body[key] !== properties[key].type) 
          return new Response(`Native Validation Failed: ${key}`, { status: 400 });
      }
      ctx.body = body;
      return next();
    } catch { return new Response("Invalid JSON", { status: 400 }); }
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
    } catch { return new Response("Invalid JSON", { status: 400 }); }
  };
};