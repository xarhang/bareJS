import type {  Next } from './context';
import { join, normalize, sep } from 'path';

/**
 * Static File Serving Middleware
 * Optimized for Bun with zero-copy file streaming
 */
export const staticFile = (root: string = 'public', options = { index: 'index.html' }) => {
  return async (ctx: any, next: Next) => {
    if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') return next();

    const url = new URL(ctx.req.url);
    // Remove leading slash so join() doesn't get confused
    const pathName = decodeURIComponent(url.pathname).replace(/^\//, '');

    // Prevent Directory Traversal
    const safePath = normalize(pathName).replace(/^(\.\.(\/|\\|$))+/, '');
    
    // Resolve absolute path
    let filePath = join(process.cwd(), root, safePath);

    let file = Bun.file(filePath);

    // If it's a directory or file doesn't exist, try index.html
    if (!(await file.exists())) {
        const indexFile = join(filePath, options.index);
        const indexExists = await Bun.file(indexFile).exists();
        
        if (indexExists) {
            file = Bun.file(indexFile);
        } else {
            return next(); // Real 404 behavior
        }
    }

    return new Response(file);
  };
};