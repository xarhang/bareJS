export interface OpenAPIOptions {
  title?: string;
  version?: string;
  description?: string;
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
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return zodToJsonSchema(def.innerType);
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

  for (const route of routes) {
    if (route.path === '/docs' || route.path === '/docs/json') continue;

    const openApiPath = ('/' + route.path)
      .replace(/\/+/g, '/')
      .replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

    if (!paths[openApiPath]) paths[openApiPath] = {};

    const method = route.method.toLowerCase();
    const params: any[] = [];
    const paramMatches = route.path.matchAll(/:([a-zA-Z0-9_]+)/g);
    for (const m of paramMatches) {
      params.push({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' }
      });
    }

    let requestBody: any = undefined;
    for (const h of route.handlers) {
      if (h && (h as any).__schema) {
        requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: extractSchema((h as any).__schema)
            }
          }
        };
        break;
      }
    }

    paths[openApiPath][method] = {
      summary: `${route.method} ${openApiPath}`,
      ...(params.length ? { parameters: params } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        '200': { description: 'Success' }
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
