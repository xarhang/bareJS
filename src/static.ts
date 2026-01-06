import type { Context, Next } from './context';
import { join, normalize, sep } from 'path';

/**
 * Static File Serving Middleware
 * Optimized for Bun with zero-copy file streaming
 */
export const staticFile = (root: string = 'public', options = { index: 'index.html' }) => {
  return async (ctx: Context, next: Next) => {
    // 1. Only allow GET and HEAD methods for security
    if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') {
      return next();
    }

    const url = new URL(ctx.req.url);
    let path = decodeURIComponent(url.pathname);

    // 2. Prevent Directory Traversal (Security)
    // Ensures users can't use ../../ to access system files
    const safePath = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
    
    // 3. Resolve file path
    let filePath = join(process.cwd(), root, safePath);

    // 4. Handle Directory Access (serving index.html)
    if (filePath.endsWith(sep) || (await Bun.file(filePath).exists() === false)) {
        const indexFile = join(filePath, options.index);
        if (await Bun.file(indexFile).exists()) {
            filePath = indexFile;
        } else {
            // If file doesn't exist, move to next middleware (or 404)
            return next();
        }
    }

    const file = Bun.file(filePath);

    // 5. Check existence again for final safety
    if (await file.exists()) {
      return new Response(file);
    }

    return next();
  };
};