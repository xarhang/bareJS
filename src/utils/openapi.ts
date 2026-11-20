export interface OpenAPIOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  securitySchemes?: Record<string, Record<string, any>>;
  security?: Array<Record<string, string[]>>;
  excludePaths?: string[];
}

const zodToJsonSchema = (schema: any): Record<string, any> => {
  if (!schema || !schema._def) return { type: 'object' };
  const def = schema._def;
  const typeName = def.typeName;

  if (typeName === 'ZodObject') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape || {})) {
      const child = v as any;
      properties[k] = zodToJsonSchema(child);
      if (child?._def?.typeName !== 'ZodOptional' && child?._def?.typeName !== 'ZodDefault') {
        required.push(k);
      }
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }
  if (typeName === 'ZodString') return { type: 'string' };
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodArray') return { type: 'array', items: zodToJsonSchema(def.type) };
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable') return zodToJsonSchema(def.innerType);
  if (typeName === 'ZodEnum') return { type: 'string', enum: def.values };
  return { type: 'object' };
};

const extractSchema = (schema: any): Record<string, any> => {
  if (!schema) return { type: 'object' };
  if ('_def' in schema) return zodToJsonSchema(schema);
  // TypeBox or plain JSON Schema
  return JSON.parse(JSON.stringify(schema));
};

export const generateOpenAPISpec = (routes: any[], options: OpenAPIOptions = {}) => {
  const paths: Record<string, Record<string, any>> = {};
  const excluded = new Set<string>(['/docs', '/docs/json', ...(options.excludePaths || [])]);

  for (const route of routes) {
    if (excluded.has(route.path)) continue;

    const openApiPath = ('/' + route.path)
      .replace(/\/+/g, '/')
      .replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

    if (!paths[openApiPath]) paths[openApiPath] = {};

    const method = route.method.toLowerCase();
    const params: any[] = [];
    let requestBody: any = undefined;
    let responseSchema: any = undefined;
    let detail: any = undefined;
    let paramSchemaObj: Record<string, any> | null = null;

    for (const h of route.handlers) {
      if (!h) continue;
      const rs = (h as any).__routeSchemas;
      if (rs) {
        if (rs.detail) detail = rs.detail;
        if (rs.params) paramSchemaObj = extractSchema(rs.params);
        if (rs.query) {
          const qSchema = extractSchema(rs.query);
          const qReq = new Set<string>(qSchema.required || []);
          for (const [k, prop] of Object.entries(qSchema.properties || {})) {
            params.push({ name: k, in: 'query', required: qReq.has(k), schema: prop });
          }
        }
        if (rs.headers) {
          const hSchema = extractSchema(rs.headers);
          const hReq = new Set<string>(hSchema.required || []);
          for (const [k, prop] of Object.entries(hSchema.properties || {})) {
            params.push({ name: k, in: 'header', required: hReq.has(k), schema: prop });
          }
        }
        if (rs.response) {
          responseSchema = extractSchema(rs.response);
        }
      }
      if ((h as any).__schema && !requestBody) {
        requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: extractSchema((h as any).__schema)
            }
          }
        };
      }
    }

    const paramMatches = route.path.matchAll(/:([a-zA-Z0-9_]+)/g);
    for (const m of paramMatches) {
      const pName = m[1]!;
      const pProp = paramSchemaObj?.properties?.[pName] || { type: 'string' };
      params.unshift({
        name: pName,
        in: 'path',
        required: true,
        schema: pProp
      });
    }

    paths[openApiPath][method] = {
      summary: detail?.summary || `${route.method} ${openApiPath}`,
      ...(detail?.description ? { description: detail.description } : {}),
      ...(detail?.tags ? { tags: detail.tags } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        '200': {
          description: 'Success',
          ...(responseSchema
            ? { content: { 'application/json': { schema: responseSchema } } }
            : {})
        }
      }
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title || 'BareJS API',
      version: options.version || '1.0.0',
      ...(options.description ? { description: options.description } : {})
    },
    ...(options.servers?.length ? { servers: options.servers } : {}),
    ...(options.tags?.length ? { tags: options.tags } : {}),
    ...(options.securitySchemes
      ? { components: { securitySchemes: options.securitySchemes } }
      : {}),
    ...(options.security?.length ? { security: options.security } : {}),
    paths
  };
};

export const renderDocsHTML = (specUrl: string, title: string = 'BareJS API Docs'): string => {
  const safeTitle = title.replace(/[<>&"]/g, '');
  const safeSpecUrl = JSON.stringify(specUrl);
  return `<!doctype html>
<html>
  <head>
    <title>${safeTitle}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url=${safeSpecUrl}></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
};
