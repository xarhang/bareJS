export interface ClientRequestOptions {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: any;
  headers?: Record<string, string>;
}

export interface BareClientOptions {
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

type ExtractParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractParams<`/${Rest}`>]: string | number }
    : Path extends `${string}:${infer Param}`
      ? { [K in Param]: string | number }
      : Record<string, never>;

export interface RouteEndpoint {
  method: string;
  path?: string;
  params?: Record<string, any>;
  query?: Record<string, any>;
  headers?: Record<string, any>;
  body?: any;
  response?: any;
}

export type RouteSchema = Record<string, RouteEndpoint>;

type RouteKey<M extends string, P extends string> = `${M} ${P}`;

type PathsForMethod<Routes extends RouteSchema, M extends string> = {
  [K in keyof Routes]: Routes[K]['method'] extends M
    ? (Routes[K]['path'] extends string ? Routes[K]['path'] : K & string)
    : never;
}[keyof Routes] & string;

type LookupRoute<Routes extends RouteSchema, M extends string, P extends string> =
  RouteKey<M, P> extends keyof Routes
    ? Routes[RouteKey<M, P>]
    : P extends keyof Routes
      ? Routes[P]
      : never;

type EndpointOptions<R extends RouteEndpoint, P extends string, WithBody extends boolean> =
  Omit<ClientRequestOptions, 'params' | 'query' | 'headers' | (WithBody extends true ? 'body' : never)> & {
    params?: R['params'] extends Record<string, any> ? R['params'] : ExtractParams<P>;
    query?: R['query'] extends Record<string, any> ? R['query'] : ClientRequestOptions['query'];
    headers?: R['headers'] extends Record<string, any> ? R['headers'] & Record<string, string> : ClientRequestOptions['headers'];
  } & (WithBody extends true ? { body?: R['body'] } : {});

export interface BareClient<Routes extends RouteSchema = RouteSchema> {
  get<P extends PathsForMethod<Routes, 'GET'> | (string & {})>(
    path: P,
    options?: LookupRoute<Routes, 'GET', P & string> extends infer R extends RouteEndpoint
      ? EndpointOptions<R, P & string, false>
      : ClientRequestOptions
  ): Promise<LookupRoute<Routes, 'GET', P & string> extends infer R extends RouteEndpoint ? R['response'] : any>;

  post<P extends PathsForMethod<Routes, 'POST'> | (string & {})>(
    path: P,
    options?: LookupRoute<Routes, 'POST', P & string> extends infer R extends RouteEndpoint
      ? EndpointOptions<R, P & string, true>
      : ClientRequestOptions
  ): Promise<LookupRoute<Routes, 'POST', P & string> extends infer R extends RouteEndpoint ? R['response'] : any>;

  put<P extends PathsForMethod<Routes, 'PUT'> | (string & {})>(
    path: P,
    options?: LookupRoute<Routes, 'PUT', P & string> extends infer R extends RouteEndpoint
      ? EndpointOptions<R, P & string, true>
      : ClientRequestOptions
  ): Promise<LookupRoute<Routes, 'PUT', P & string> extends infer R extends RouteEndpoint ? R['response'] : any>;

  patch<P extends PathsForMethod<Routes, 'PATCH'> | (string & {})>(
    path: P,
    options?: LookupRoute<Routes, 'PATCH', P & string> extends infer R extends RouteEndpoint
      ? EndpointOptions<R, P & string, true>
      : ClientRequestOptions
  ): Promise<LookupRoute<Routes, 'PATCH', P & string> extends infer R extends RouteEndpoint ? R['response'] : any>;

  delete<P extends PathsForMethod<Routes, 'DELETE'> | (string & {})>(
    path: P,
    options?: LookupRoute<Routes, 'DELETE', P & string> extends infer R extends RouteEndpoint
      ? EndpointOptions<R, P & string, false>
      : ClientRequestOptions
  ): Promise<LookupRoute<Routes, 'DELETE', P & string> extends infer R extends RouteEndpoint ? R['response'] : any>;
}

const buildUrl = (baseUrl: string, path: string, options?: ClientRequestOptions): string => {
  let finalPath = path;
  if (options?.params) {
    const params = options.params;
    finalPath = finalPath.replace(/:([a-zA-Z0-9_]+)(?=\/|\?|$)/g, (match, key) =>
      Object.hasOwn(params, key) ? encodeURIComponent(String(params[key])) : match
    );
  }
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = finalPath.startsWith('/') ? finalPath : `/${finalPath}`;
  let url = `${base}${normalizedPath}`;

  if (options?.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const str = qs.toString();
    if (str) url += (url.includes('?') ? '&' : '?') + str;
  }
  return url;
};

export const bareClient = <AppOrRoutes = any>(
  baseUrlOrApp: string | ({ fetch: (req: Request) => any } & AppOrRoutes),
  clientOptions: BareClientOptions = {}
): BareClient<AppOrRoutes extends { __routes?: infer R extends RouteSchema } ? R : RouteSchema> => {
  const isApp = typeof baseUrlOrApp === 'object' && baseUrlOrApp !== null && typeof baseUrlOrApp.fetch === 'function';
  const baseUrl = isApp ? 'http://localhost' : (baseUrlOrApp as string);
  const fetchImpl = clientOptions.fetch ?? (isApp ? ((input: any, init?: RequestInit) => baseUrlOrApp.fetch(new Request(String(input), init))) as any : fetch);
  const defaultHeaders = clientOptions.headers ?? {};

  const request = async (method: string, path: string, options?: ClientRequestOptions) => {
    const url = buildUrl(baseUrl, path, options);
    const headers = new Headers();
    for (const [k, v] of Object.entries(defaultHeaders)) {
      headers.set(k, v);
    }
    if (options?.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        headers.set(k, v);
      }
    }

    const init: RequestInit = { method, headers };
    if (options?.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      const b = options.body;
      const isRawBody =
        typeof b === 'string' ||
        b instanceof FormData ||
        b instanceof URLSearchParams ||
        b instanceof Blob ||
        b instanceof ArrayBuffer ||
        ArrayBuffer.isView(b) ||
        (typeof ReadableStream !== 'undefined' && b instanceof ReadableStream);

      if (isRawBody) {
        init.body = b as RequestInit['body'];
      } else {
        if (!headers.has('content-type')) {
          headers.set('Content-Type', 'application/json');
        }
        init.body = JSON.stringify(b);
      }
    }

    const res = await fetchImpl(url, init);
    let data: any = null;
    if (res.status !== 204 && res.status !== 205 && res.status !== 304) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json') || ct.includes('+json')) {
        const text = await res.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        } else {
          data = null;
        }
      } else {
        data = await res.text();
      }
    }
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  return {
    get: (path: string, options?: ClientRequestOptions) => request('GET', path, options),
    post: (path: string, options?: ClientRequestOptions) => request('POST', path, options),
    put: (path: string, options?: ClientRequestOptions) => request('PUT', path, options),
    patch: (path: string, options?: ClientRequestOptions) => request('PATCH', path, options),
    delete: (path: string, options?: ClientRequestOptions) => request('DELETE', path, options)
  } as any;
};
