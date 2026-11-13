import { resolve, sep } from 'node:path';

export const staticFile = (root: string = 'public') => {
  const rootDir = resolve(process.cwd(), root);
  const rootPrefix = rootDir.endsWith(sep) ? rootDir : rootDir + sep;

  return async (ctx: any, next: any) => {
    const method = ctx.req.method;
    if (method !== 'GET' && method !== 'HEAD') return next();

    const rawUrl: string = ctx.req.url;
    const pathStart = rawUrl.indexOf('/', 8);
    const queryStart = pathStart === -1 ? -1 : rawUrl.indexOf('?', pathStart);
    const rawPath = pathStart === -1
      ? ''
      : (queryStart === -1 ? rawUrl.slice(pathStart) : rawUrl.slice(pathStart, queryStart));

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      return ctx.status(400).send('Bad Request');
    }

    if (decodedPath.includes('\0')) {
      return ctx.status(400).send('Bad Request');
    }

    const relativePath = decodedPath.replace(/^\/+/, '');
    const filePath = resolve(rootDir, relativePath);

    if (filePath !== rootDir && !filePath.startsWith(rootPrefix)) {
      return ctx.status(403).send('Forbidden');
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return next();
  };
};