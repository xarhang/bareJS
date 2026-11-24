# BareJS Comprehensive Guide

Complete examples covering validation, cookies, file uploads, security middlewares, context derivation, real-time APIs, OpenAPI 3.1, JSON-RPC 2.0, and production hardening.

---

## 1. Unified Route Validation & Auto-Coercion (`body`, `query`, `params`, `headers`)

Pass a schema object directly before your handler. BareJS automatically coerces numeric and boolean strings in `params` and `query`, enforces `maxBodySize` (`413 Payload Too Large`), and registers the route in OpenAPI `/docs`.

```typescript
import { BareJS, Type, Z, native, type Context } from 'barejs';

const app = new BareJS();

// Declarative RouteSchemas (works with TypeBox, Zod, or Native JSON Schema)
app.post('/orders/:orderId', {
  detail: { summary: 'Create Order', tags: ['Orders'] },
  params: Type.Object({ orderId: Type.Integer() }),              // "42" -> 42
  query:  Type.Object({ notify: Type.Optional(Type.Boolean()) }), // "true" -> true
  headers: Type.Object({ 'x-api-version': Type.Optional(Type.String()) }),
  body: Type.Object({
    item: Type.String({ minLength: 1 }),
    qty: Type.Integer({ minimum: 1 })
  }),
  // Response schema automatically strips undeclared secret fields (e.g. internal_cost)
  response: Type.Object({
    orderId: Type.Number(),
    notify: Type.Optional(Type.Boolean()),
    body: Type.Object({ item: Type.String(), qty: Type.Number() })
  }),
  maxBodySize: 512 * 1024 // 512 KB limit (returns 413 if exceeded)
}, (ctx: Context) => ({
  orderId: ctx.params.orderId, // number
  notify: ctx.query.notify,    // boolean | undefined
  body: ctx.body,              // validated body
  internal_cost: 9999          // automatically stripped before sending to client
}));

// Standalone middleware validators are also supported:
app.post('/zod', Z.object({ email: Z.string().email() }), (ctx) => ctx.body);
app.post('/native', native({
  properties: { title: { type: 'string' }, priority: { type: 'number' } },
  required: ['title'] // 'priority' is optional
}), (ctx) => ctx.body);
```

---

## 2. Cookies, HMAC Signed Cookies & Safe File Uploads

```typescript
// HMAC-SHA256 Signed Cookies (HttpOnly & SameSite=Lax by default)
app.post('/session', async (ctx) => {
  await ctx.setCookie('session_id', 'user_42', {
    secret: process.env.COOKIE_SECRET!,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 3600
  });
  return { loggedIn: true };
});

app.get('/session', async (ctx) => {
  const userId = await ctx.getSignedCookie('session_id', process.env.COOKIE_SECRET!);
  if (!userId) return ctx.status(401).json({ error: 'Invalid or tampered cookie' });
  return { userId };
});

// Safe Multipart File Upload (enforces size, file count, MIME allowlist & filename sanitization)
app.post('/upload', async (ctx) => {
  const { fields, files } = await ctx.upload({
    maxFileSize: 5 * 1024 * 1024, // 5 MB -> 413 if exceeded
    maxFiles: 3,                  // -> 413 if exceeded
    allowedTypes: ['image/png', 'image/jpeg', 'application/pdf'] // -> 415 if unsupported
  });
  return {
    fields,
    uploaded: files.map((f) => ({ safeName: f.safeName, size: f.size, type: f.type }))
  };
});

// True Streaming Multipart Upload (constant O(chunk) memory for large files)
app.post('/upload-stream', async (ctx) => {
  const uploaded: string[] = [];
  for await (const part of ctx.uploadStream({ maxFileSize: 500 * 1024 * 1024 })) {
    if (part.type === 'file' && part.stream) {
      await Bun.write(`./uploads/${part.safeName}`, new Response(part.stream));
      uploaded.push(part.safeName!);
    }
  }
  return { uploaded };
});
```

---

## 3. Production Security Suite, Idempotency & Singleflight

```typescript
import {
  BareJS, securityHeaders, cors, csrf, timeout, rateLimit,
  idempotency, createSingleflight, redisStore, compress,
  bareAuth, createToken, hasRole, Hash, staticFile
} from 'barejs';

const app = new BareJS();
const SECRET = process.env.JWT_SECRET || 'super-secret-key';
const store = redisStore(Bun.redis, { prefix: 'myapp:' }); // Optional: omit for in-memory Map

app.use(securityHeaders());
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use(csrf({ allowedOrigins: ['https://app.example.com'] }));
app.use(timeout(10_000)); // Returns 408 if handler exceeds 10s
app.use(compress({ minSize: 1024, encodings: ['zstd', 'br', 'gzip'] }));
app.use(rateLimit({ windowMs: 60_000, max: 100, store }));
app.use(staticFile('public', { maxAge: 3600, etag: true, cacheMetadata: { maxEntries: 1024, ttlMs: 30_000 } }));

// Payment/Order Double-Charge Protection (Idempotency-Key header)
app.post('/payments', idempotency({ ttlMs: 86_400_000, store }), async (ctx) => {
  const body = await ctx.jsonBody();
  return { chargeId: 'ch_101', amount: body.amount, status: 'paid' };
});

// Cache-Stampede / Thundering-Herd Request Coalescing
const singleflight = createSingleflight();
app.get('/reports/daily', async () => {
  return singleflight.do('daily-report', async () => ({ revenue: 125_000, generatedAt: Date.now() }));
});

// Argon2id Password Hashing & JWT Creation
app.post('/login', async (ctx) => {
  const { password } = await ctx.jsonBody();
  const hash = await Hash.make(password);
  const valid = await Hash.verify(password, hash);
  if (!valid) return ctx.status(401).send('Invalid credentials');

  const token = await createToken({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return { token };
});

// Protect routes with constant-time HS256 JWT or asymmetric RS256/ES256/JWKS
app.get('/admin', bareAuth({ secret: SECRET, revocationStore: store }), hasRole('admin'), (ctx) => ({
  user: ctx.user,
  requestId: ctx.requestId
}));
app.get('/sso', bareAuth({ algorithms: ['RS256', 'ES256'], jwksUri: 'https://auth.example.com/.well-known/jwks.json' }), (ctx) => ctx.user);
```

---

## 4. Type-Safe Context Derivation (`app.derive`), Plugins & Lifecycle Hooks

```typescript
// Enrich ctx with full TypeScript inference (auto-cleaned on pool release)
const appWithContext = app.derive((ctx) => ({
  requestTime: Date.now(),
  traceId: ctx.requestId
}));

appWithContext.get('/trace', (ctx) => ({
  traceId: ctx.traceId,         // typed as string
  requestTime: ctx.requestTime  // typed as number
}));

// Register a modular plugin
app.use({
  name: 'health-plugin',
  install(instance) {
    instance.get('/healthz', (ctx: any) => ({ ok: true, traceId: ctx.traceId }));
  }
});

// Server Lifecycle & Error Masking
app.onStart(() => console.log('Database ready'));
app.onDrain(async () => console.log('Draining in-flight requests...'));
app.onStop(async () => console.log('Cleaned up resources'));
app.onError((err, ctx) => ctx.status(err.status || 500).json({
  status: 'error',
  message: err.message,
  requestId: ctx.requestId
}));
```

---

## 5. Real-Time (WebSocket, SSE), OpenAPI 3.1, JSON-RPC 2.0 & Client

```typescript
import { BareJS, BareRouter, bareClient, Type } from 'barejs';

const usersRouter = new BareRouter().get('/users/:id', {
  params: Type.Object({ id: Type.Integer() }),
  query: Type.Object({ full: Type.Optional(Type.Boolean()) }),
}, (ctx) => ({ id: ctx.params.id, full: ctx.query.full }));

const app = new BareJS().route('/api', usersRouter);

// Native Bun WebSocket (or `ws` peer dep on Node.js)
app.ws('/ws/chat', {
  open: (ws) => ws.send('connected'),
  message: (ws, msg) => ws.send(`echo: ${msg}`)
});

// Server-Sent Events (SSE)
app.get('/events', (ctx) => ctx.sse(async (send) => {
  send({ step: 1, msg: 'streaming...' }, 'progress', '1');
}));

// JSON-RPC 2.0 Endpoint (single, batch & notifications)
app.rpc('/rpc', {
  add: ({ a, b }: { a: number; b: number }) => a + b
});

// Auto OpenAPI 3.1 Spec (/docs/json) + Scalar UI (/docs)
app.docs('/docs', { title: 'My BareJS API', version: '1.0.0' });

// Ergonomic in-memory test helper
const res = await app.request('/api/users/42?full=true');

// Type-Safe Client (Zero-Network In-Memory for tests/SSR OR Network URL)
const inMemoryClient = bareClient(app);
const localRes = await inMemoryClient.get('/api/users/:id', { params: { id: 42 }, query: { full: true } });

const httpClient = bareClient('http://localhost:3000');
const remoteRes = await httpClient.get('/api/users/:id', { params: { id: 42 }, query: { full: true } });
```

---

## 6. Production Observability & Zero-Trust Hardening

```typescript
import { BareJS, logger, healthcheck, bareAuth, revokeToken } from 'barejs';

const app = new BareJS()
  .trustProxy(false)
  .use(logger({ format: 'json' }))
  .use(healthcheck({
    path: '/health',
    readyPath: '/ready',
    version: '1.0.0',
    checks: { db: async () => true }
  }))
  .use(bareAuth({
    secret: process.env.JWT_SECRET!,
    isRevoked: async (payload) => isBlockedInRedis(payload.jti)
  }));

revokeToken('compromised-jti-123', 3600_000);

app.docs('/docs', {
  title: 'Production API',
  securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  security: [{ bearerAuth: [] }]
});

// Enforce server-level maxRequestBodySize (default: 10MB)
app.listen(3000, '0.0.0.0', true, { maxRequestBodySize: 2 * 1024 * 1024 });
```
