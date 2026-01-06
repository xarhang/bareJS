import { join, normalize } from 'node:path';

export const staticFile = (root: string = 'public') => {
  return async (ctx: any, next: any) => {
    // 1. Log that the middleware actually started
    // console.log(`📡 [Static] Checking disk for: ${ctx.req.url}`);

    if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') return next();

    const url = new URL(ctx.req.url);
    const pathName = decodeURIComponent(url.pathname).replace(/^\//, '');

    // Resolve path (Windows compatible)
    const filePath = join(process.cwd(), root, pathName);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      // console.log(`✅ [Static] Found file: ${filePath}`);
      return new Response(file);
    }

    // 2. Log if the file was NOT found before moving to 404
    // console.log(`❌ [Static] Not found on disk: ${filePath}`);
    return next();
  };
};