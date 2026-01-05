import { TypeCompiler } from '@sinclair/typebox/compiler';
import type { TSchema } from '@sinclair/typebox';

export const validate = (schema: TSchema) => {

  const check = TypeCompiler.Compile(schema);

  return async (ctx: any, next: () => Promise<any> | any) => {
    try {
      const body = await ctx.req.json();

      if (!check.Check(body)) {
        return new Response(JSON.stringify({
          error: "Validation Failed",
          details: [...check.Errors(body)].map(e => ({ path: e.path, message: e.message }))
        }), { 
          status: 400, 
          headers: { "Content-Type": "application/json" } 
        });
      }

  
      ctx.body = body;
      return next();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
  };
};