export interface WebSocketRouteHandler {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}

export interface WsMatchResult {
  handler: WebSocketRouteHandler;
  params?: Record<string, string>;
}

/**
 * Matches a request URL (or path) against registered WebSocket route patterns
 * supporting exact paths, `:param` segments, and `*` catch-all wildcards.
 */
export function matchWsRoute(
  wsRoutes: Map<string, WebSocketRouteHandler>,
  urlOrPath: string
): WsMatchResult | undefined {
  let path = urlOrPath;
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://') || urlOrPath.startsWith('ws://') || urlOrPath.startsWith('wss://')) {
    const s = urlOrPath.indexOf('/', 8);
    const q = s === -1 ? -1 : urlOrPath.indexOf('?', s);
    path = s === -1 ? '/' : (q === -1 ? urlOrPath.slice(s) : urlOrPath.slice(s, q));
  } else {
    const q = urlOrPath.indexOf('?');
    if (q !== -1) path = urlOrPath.slice(0, q);
  }
  const collapsed = path.replace(/\/+/g, '/');
  const normalized = collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;

  const exact = wsRoutes.get(normalized);
  if (exact) return { handler: exact };

  const reqParts = normalized.split('/').filter(Boolean);
  for (const [pattern, h] of wsRoutes) {
    if (!pattern.includes(':') && !pattern.includes('*')) continue;
    const patParts = pattern.split('/').filter(Boolean);
    const matched: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < patParts.length; i++) {
      const pp = patParts[i]!;
      if (pp === '*') {
        matched['*'] = reqParts.slice(i).join('/');
        break;
      }
      if (i >= reqParts.length) { ok = false; break; }
      if (pp.startsWith(':')) {
        matched[pp.slice(1)] = reqParts[i]!;
      } else if (pp !== reqParts[i]) {
        ok = false; break;
      }
    }
    if (ok && (patParts.includes('*') || patParts.length === reqParts.length)) {
      return { handler: h, params: matched };
    }
  }
  return undefined;
}
