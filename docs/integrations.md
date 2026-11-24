# External Integrations

Because BareJS is built on Web Standard `Request` (`ctx.req`) and `Response`, most modern TypeScript ecosystem libraries plug in directly in 1–5 lines without framework-specific adapters.

---

## 1. Better-Auth

Mount Better-Auth's Web Standard `handler(req)` directly on `/api/auth/*`:

```typescript
import { BareJS } from 'barejs';
import { auth } from './auth'; // betterAuth({ ... })

const app = new BareJS();

app.all('/api/auth/*', (ctx) => auth.handler(ctx.req));

// Optional: protect routes using Better-Auth session
app.derive(async (ctx) => {
  const session = await auth.api.getSession({ headers: ctx.req.headers });
  return { session };
});
```

---

## 2. GraphQL Yoga

Mount GraphQL Yoga's `yoga.fetch(req)` directly on `/graphql`:

```typescript
import { BareJS } from 'barejs';
import { createSchema, createYoga } from 'graphql-yoga';

const yoga = createYoga({
  schema: createSchema({
    typeDefs: `type Query { hello: String }`,
    resolvers: { Query: { hello: () => 'Hello from BareJS + Yoga!' } }
  })
});

const app = new BareJS();
app.all('/graphql', (ctx) => yoga.fetch(ctx.req));
```

---

## 3. Auth0 (Built-in JWKS Verification — Zero Extra SDK)

BareJS's built-in `bareAuth` supports `RS256` / `ES256` with automatic JWKS fetching, key rotation caching, and `issuer` / `audience` checks:

```typescript
import { BareJS, bareAuth } from 'barejs';

const app = new BareJS();

app.use('/api/*', bareAuth({
  algorithms: ['RS256'],
  jwksUri: 'https://YOUR_TENANT.auth0.com/.well-known/jwks.json',
  issuer: 'https://YOUR_TENANT.auth0.com/',
  audience: 'https://api.example.com'
}));

app.get('/api/profile', (ctx) => ({ user: ctx.user }));
```

---

## 4. Clerk (`@clerk/backend` or Built-in JWKS)

Use `@clerk/backend`'s `authenticateRequest(ctx.req)` or BareJS's built-in `bareAuth({ jwksUri })`:

```typescript
import { BareJS } from 'barejs';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
const app = new BareJS();

app.use('/api/*', async (ctx, next) => {
  const requestState = await clerk.authenticateRequest(ctx.req);
  if (!requestState.isSignedIn) {
    return ctx.status(401).json({ error: 'Unauthorized' });
  }
  ctx.set('auth', requestState.toAuth());
  return next();
});
```

---

## 5. Sentry (`@sentry/bun` / `@sentry/node`)

`@sentry/bun` and `@sentry/node` instrument the runtime HTTP server automatically. Add `app.onError()` to capture handled/unhandled route errors with `requestId` context:

```typescript
import * as Sentry from '@sentry/bun'; // or '@sentry/node'
import { BareJS } from 'barejs';

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = new BareJS();

app.onError((err, ctx) => {
  Sentry.captureException(err, {
    extra: { requestId: ctx.requestId, url: ctx.req.url, method: ctx.req.method }
  });
  return ctx.status(err.status || 500).json({ error: 'Internal Server Error', requestId: ctx.requestId });
});
```

---

## 6. OpenTelemetry (`@opentelemetry/api`)

`@opentelemetry/instrumentation-http` captures HTTP spans at the runtime layer. Add a lightweight middleware to attach route metadata and `requestId`:

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { BareJS } from 'barejs';

const tracer = trace.getTracer('barejs-app');
const app = new BareJS();

app.use(async (ctx, next) => {
  return tracer.startActiveSpan(`${ctx.req.method} ${new URL(ctx.req.url).pathname}`, async (span) => {
    span.setAttribute('http.request_id', ctx.requestId);
    try {
      const res = await next();
      if (res instanceof Response) span.setAttribute('http.status_code', res.status);
      return res;
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
});
```
