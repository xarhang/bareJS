import { resolve, sep } from 'node:path';
import { stat } from 'node:fs/promises';

export interface StaticOptions {
  maxAge?: number;
  etag?: boolean;
}

export const staticFile = (root: string = 'public', options: StaticOptions = {}) => {
  const rootDir = resolve(process.cwd(), root);
  const rootPrefix = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  const maxAge = options.maxAge ?? 3600;
  const enableEtag = options.etag !== false;

  const mw = async (ctx: any, next: any) => {
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

    let fileSize = 0;
    let mtimeMs = 0;
    try {
      const st = await stat(filePath);
      if (st.isDirectory()) return next();
      fileSize = st.size;
      mtimeMs = Math.floor(st.mtimeMs);
    } catch {
      return next();
    }
    const file = Bun.file(filePath);

    const headers: Record<string, string> = {
      'Cache-Control': `public, max-age=${maxAge}`,
      'Accept-Ranges': 'bytes'
    };

    if (enableEtag) {
      const etag = `W/"${fileSize.toString(16)}-${mtimeMs.toString(16)}"`;
      headers['ETag'] = etag;
      const ifNoneMatch = ctx.req.headers?.get?.('if-none-match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers });
      }
    }

    const rangeHeader = ctx.req.headers?.get?.('range');
    if (rangeHeader && rangeHeader.startsWith('bytes=') && fileSize > 0) {
      const [startStr, endStr] = rangeHeader.slice(6).split('-');
      let start = startStr ? Number(startStr) : 0;
      let end = endStr ? Number(endStr) : fileSize - 1;
      if (!startStr && endStr) {
        start = Math.max(0, fileSize - Number(endStr));
        end = fileSize - 1;
      }
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= fileSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${fileSize}` }
        });
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
      headers['Content-Length'] = String(end - start + 1);
      if (file.type) headers['Content-Type'] = file.type;
      return new Response(method === 'HEAD' ? null : file.slice(start, end + 1), {
        status: 206,
        headers
      });
    }

    if (file.type) headers['Content-Type'] = file.type;
    headers['Content-Length'] = String(fileSize);
    return new Response(method === 'HEAD' ? null : file, { status: 200, headers });
  };
  (mw as any).__isStatic = true;
  return mw;
};