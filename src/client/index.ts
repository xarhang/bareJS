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

export type RouteSchema = Record<string, {
  method: string;
  params?: Record<string, any>;
  body?: any;
  response?: any;
}>;

type PathsForMethod<Routes extends RouteSchema, M extends string> = {
  [K in keyof Routes]: Routes[K]['method'] extends M ? K : never;
}[keyof Routes] & string;

export interface BareClient<Routes extends RouteSchema = RouteSchema> {
  get<P extends PathsForMethod<Routes, 'GET'> | (string & {})>(
    path: P,
    options?: ClientRequestOptions & (P extends keyof Routes ? { params?: ExtractParams<P & string> } : {})
  ): Promise<P extends keyof Routes ? Routes[P]['response'] : any>;

  post<P extends PathsForMethod<Routes, 'POST'> | (string & {})>(
    path: P,
    options?: ClientRequestOptions & (P extends keyof Routes ? { params?: ExtractParams<P & string>; body?: Routes[P]['body'] } : {})
  ): Promise<P extends keyof Routes ? Routes[P]['response'] : any>;

  put<P extends PathsForMethod<Routes, 'PUT'> | (string & {})>(
    path: P,
    options?: ClientRequestOptions & (P extends keyof Routes ? { params?: ExtractParams<P & string>; body?: Routes[P]['body'] } : {})
  ): Promise<P extends keyof Routes ? Routes[P]['response'] : any>;

  patch<P extends PathsForMethod<Routes, 'PATCH'> | (string & {})>(
    path: P,
    options?: ClientRequestOptions & (P extends keyof Routes ? { params?: ExtractParams<P & string>; body?: Routes[P]['body'] } : {})
  ): Promise<P extends keyof Routes ? Routes[P]['response'] : any>;

  delete<P extends PathsForMethod<Routes, 'DELETE'> | (string & {})>(
    path: P,
    options?: ClientRequestOptions & (P extends keyof Routes ? { params?: ExtractParams<P & string> } : {})
  ): Promise<P extends keyof Routes ? Routes[P]['response'] : any>;
}

const buildUrl = (baseUrl: string, path: string, options?: ClientRequestOptions): string => {
  let finalPath = path;
  if (options?.params) {
    for (const [k, v] of Object.entries(options.params)) {
      finalPath = finalPath.replace(`:${k}`, encodeURIComponent(String(v)));
    }
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
    if (str) url += `?${str}`;
  }
  return url;
};

export const bareClient = <AppOrRoutes = any>(
  baseUrl: string,
  clientOptions: BareClientOptions = {}
): BareClient<AppOrRoutes extends { __routes?: infer R extends RouteSchema } ? R : RouteSchema> => {
  const fetchImpl = clientOptions.fetch ?? fetch;
  const defaultHeaders = clientOptions.headers ?? {};

  const request = async (method: string, path: string, options?: ClientRequestOptions) => {
    const url = buildUrl(baseUrl, path, options);
    const headers: Record<string, string> = {
      ...defaultHeaders,
      ...(options?.headers ?? {})
    };

    const init: RequestInit = { method, headers };
    if (options?.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await fetchImpl(url, init);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
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
