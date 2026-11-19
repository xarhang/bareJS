import { resolve, sep } from 'node:path';
import { stat, realpath } from 'node:fs/promises';

export interface StaticMetadataCacheOptions {
  /** Maximum cached file metadata entries (default: 1000) */
  maxEntries?: number;
  /** Cache TTL in milliseconds (default: 30_000) */
  ttlMs?: number;
}

export interface StaticOptions {
  maxAge?: number;
  etag?: boolean;
  /** Optional LRU metadata cache for realpath, stat, and ETag to avoid repeated syscalls */
  cacheMetadata?: boolean | StaticMetadataCacheOptions;
}

interface StaticMetaEntry {
  realFile: string;
  fileSize: number;
  mtimeMs: number;
  etag: string;
  expiresAt: number;
}

export const staticFile = (root: string = 'public', options: StaticOptions = {}) => {
  const rootDir = resolve(process.cwd(), root);
  const rootPrefix = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  let realRootPromise: Promise<string> | null = null;
  const maxAge = options.maxAge ?? 3600;
  const enableEtag = options.etag !== false;

  const cacheOpt = options.cacheMetadata;
  const useCache = Boolean(cacheOpt);
  const cacheMax = typeof cacheOpt === 'object' ? (cacheOpt.maxEntries ?? 1000) : 1000;
  const cacheTtl = typeof cacheOpt === 'object' ? (cacheOpt.ttlMs ?? 30_000) : 30_000;
  const metaCache = useCache ? new Map<string, StaticMetaEntry>() : null;

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

    let realFile = filePath;
    let fileSize = 0;
    let mtimeMs = 0;
    let etag = '';

    const cached = metaCache?.get(filePath);
    if (cached && Date.now() < cached.expiresAt) {
      // Refresh LRU position
      metaCache!.delete(filePath);
      metaCache!.set(filePath, cached);
      realFile = cached.realFile;
      fileSize = cached.fileSize;
      mtimeMs = cached.mtimeMs;
      etag = cached.etag;
    } else {
      try {
        const [realRoot, resolvedFile] = await Promise.all([
          (realRootPromise ??= realpath(rootDir)),
          realpath(filePath)
        ]);
        const realPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
        if (resolvedFile !== realRoot && !resolvedFile.startsWith(realPrefix)) {
          return ctx.status(403).send('Forbidden');
        }
        const st = await stat(resolvedFile);
        if (st.isDirectory()) return next();
        realFile = resolvedFile;
        fileSize = st.size;
        mtimeMs = Math.floor(st.mtimeMs);
        etag = enableEtag ? `W/"${fileSize.toString(16)}-${mtimeMs.toString(16)}"` : '';

        if (metaCache) {
          if (metaCache.size >= cacheMax) {
            const oldest = metaCache.keys().next().value;
            if (oldest !== undefined) metaCache.delete(oldest);
          }
          metaCache.set(filePath, {
            realFile,
            fileSize,
            mtimeMs,
            etag,
            expiresAt: Date.now() + cacheTtl
          });
        }
      } catch {
        return next();
      }
    }

    const file = Bun.file(realFile);

    const headers: Record<string, string> = {
      'Cache-Control': `public, max-age=${maxAge}`,
      'Accept-Ranges': 'bytes'
    };

    if (enableEtag) {
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