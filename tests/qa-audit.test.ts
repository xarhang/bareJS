import { describe, expect, it } from 'bun:test';
import {
  BareJS,
  T,
  Z,
  cors,
  csrf,
  securityHeaders,
  rateLimit,
  timeout,
  logger,
  bareAuth,
  idempotency,
  typebox,
  zod,
  native,
  Hash,
  type IdempotencyStore,
  type CachedIdempotentEntry
} from '../src/index';

describe('QA & Security Audit Regression Suite', () => {
  it('1. Short-circuiting middleware (rateLimit, bareAuth, csrf) retains cors, securityHeaders, logger x-request-id, and cookies', async () => {
    const app = new BareJS();
    app.use(cors({ origin: 'https://app.example.com' }));
    app.use(securityHeaders());
    app.use(logger({ onLog: () => {} }));
    app.use((ctx, next) => {
      ctx.setCookie('trace', 'abc', { httpOnly: true });
      return next?.();
    });
    app.use(rateLimit({ max: 1, windowMs: 10_000 }));
    app.get('/test', () => ({ ok: true }));

    const r1 = await app.request('/test', { headers: { 'x-request-id': 'req-1' } });
    expect(r1.status).toBe(200);

    const r2 = await app.request('/test', { headers: { 'x-request-id': 'req-2' } });
    expect(r2.status).toBe(429);
    expect(r2.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(r2.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r2.headers.get('x-request-id')).toBe('req-2');
    expect(r2.headers.get('set-cookie')).toContain('trace=abc');

    const authApp = new BareJS();
    authApp.use(cors({ origin: 'https://app.example.com' }));
    authApp.use(securityHeaders());
    authApp.use(bareAuth('secret'));
    authApp.get('/priv', () => ({ ok: true }));
    const unauth = await authApp.request('/priv');
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(unauth.headers.get('x-frame-options')).toBe('DENY');
  });

  it('2. timeout() 408 response retains cors and securityHeaders', async () => {
    const app = new BareJS();
    app.use(cors({ origin: 'https://app.example.com' }));
    app.use(securityHeaders());
    app.get('/slow', timeout(15), async () => {
      await Bun.sleep(60);
      return { ok: true };
    });

    const res = await app.request('/slow');
    expect(res.status).toBe(408);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('3. OPTIONS preflight with logger/csrf global middleware does not crash when next is omitted', async () => {
    const app = new BareJS();
    app.use(logger({ onLog: () => {} }));
    app.use(csrf());
    app.get('/hello', () => ({ ok: true }));

    const res = await app.request('/hello', { method: 'OPTIONS' });
    expect(res.status).toBeLessThan(500);
  });

  it('4. Context.ip falls back when X-Forwarded-For first segment is empty', async () => {
    const app = new BareJS().trustProxy(true);
    app.get('/ip', (ctx) => ({ ip: ctx.ip }));

    const res1 = await app.fetch(
      new Request('http://localhost/ip', {
        headers: { 'x-forwarded-for': ', 10.0.0.1', 'x-real-ip': '203.0.113.5' }
      }),
      '192.0.2.1'
    );
    expect(await res1.json()).toEqual({ ip: '203.0.113.5' });

    const res2 = await app.fetch(
      new Request('http://localhost/ip', {
        headers: { 'x-forwarded-for': '  ,  ' }
      }),
      '192.0.2.9'
    );
    expect(await res2.json()).toEqual({ ip: '192.0.2.9' });
  });

  it('5. Context.sse() prevents CR/LF injection in id/event and formats multi-line data', async () => {
    const app = new BareJS();
    app.get('/events', (ctx) =>
      ctx.sse(async (send, close) => {
        send('line1\nline2', 'msg\nevent: injected', '1\r\nretry: 1');
        close();
      })
    );

    const res = await app.request('/events');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id: 1retry: 1\n');
    expect(body).toContain('event: msgevent: injected\n');
    expect(body).toContain('data: line1\ndata: line2\n\n');
  });

  it('6. Context.upload() matches allowedTypes case-insensitively', async () => {
    const app = new BareJS();
    app.post('/upload', async (ctx) => {
      const result = await ctx.upload({ allowedTypes: [' Image/PNG '] });
      return { count: result.files.length, name: result.files[0]?.safeName };
    });

    const form = new FormData();
    form.append('avatar', new File(['pngbytes'], 'avatar.png', { type: 'image/png' }));

    const res = await app.request('/upload', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1, name: 'avatar.png' });
  });

  it('7. schemaValidator stripUnknown strips extra keys without adding undefined optional keys', async () => {
    const app = new BareJS();
    app.post(
      '/users',
      {
        stripUnknown: true,
        body: T.Object({
          name: T.String(),
          age: T.Optional(T.Number())
        })
      },
      (ctx) => ({
        body: ctx.body,
        hasAgeKey: Object.hasOwn(ctx.body, 'age')
      })
    );

    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', role: 'admin' })
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ body: { name: 'Alice' }, hasAgeKey: false });
  });

  it('8. native() validator checks array, integer, and object types accurately', async () => {
    const app = new BareJS();
    app.post(
      '/native',
      native({
        properties: {
          tags: { type: 'array' },
          count: { type: 'integer' },
          meta: { type: 'object' }
        },
        required: ['tags', 'count', 'meta']
      }),
      (ctx) => ctx.body
    );

    const ok = await app.request('/native', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['a'], count: 3, meta: { ok: true } })
    });
    expect(ok.status).toBe(200);

    const badFloat = await app.request('/native', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['a'], count: 3.5, meta: { ok: true } })
    });
    expect(badFloat.status).toBe(400);

    const badNullObj = await app.request('/native', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['a'], count: 3, meta: null })
    });
    expect(badNullObj.status).toBe(400);

    const badArrObj = await app.request('/native', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['a'], count: 3, meta: [] })
    });
    expect(badArrObj.status).toBe(400);
  });

  it('9. schemaValidator coerces optional/default/nullable Zod query fields', async () => {
    const app = new BareJS();
    app.get(
      '/items',
      {
        query: Z.object({
          page: Z.number().optional(),
          active: Z.boolean().default(false)
        })
      },
      (ctx) => ctx.query
    );

    const res = await app.request('/items?page=3&active=true');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ page: 3, active: true });
  });

  it('10. Standalone typebox, zod, and native validators return 413 on oversized payloads', async () => {
    const bigPayload = JSON.stringify({ a: 'x'.repeat(1_100_000) });

    for (const mw of [
      typebox(T.Object({ a: T.String() })),
      zod(Z.object({ a: Z.string() })),
      native({ properties: { a: { type: 'string' } }, required: ['a'] })
    ]) {
      const app = new BareJS();
      app.post('/big', mw, (ctx) => ctx.body);
      const res = await app.request('/big', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: bigPayload
      });
      expect(res.status).toBe(413);
    }
  });

  it('11. idempotency ignores whitespace-only keys and skips caching SSE streams', async () => {
    let setCalled = false;
    let releaseCalled = false;
    const store: IdempotencyStore = {
      get: () => undefined,
      set: () => { setCalled = true; },
      acquire: () => true,
      release: () => { releaseCalled = true; }
    };

    const app = new BareJS();
    app.use(idempotency({ store }));
    let calls = 0;
    app.post('/pay', () => ({ count: ++calls }));
    app.post('/stream', (ctx) =>
      ctx.sse(async (send, close) => {
        send('hi');
        close();
      })
    );

    const w1 = await app.request('/pay', { method: 'POST', headers: { 'idempotency-key': '   ' } });
    const w2 = await app.request('/pay', { method: 'POST', headers: { 'idempotency-key': '   ' } });
    expect(await w1.json()).toEqual({ count: 1 });
    expect(await w2.json()).toEqual({ count: 2 });

    const sseRes = await app.request('/stream', { method: 'POST', headers: { 'idempotency-key': 'sse-1' } });
    expect(sseRes.status).toBe(200);
    await Bun.sleep(10);
    expect(setCalled).toBe(false);
    expect(releaseCalled).toBe(true);
  });

  it('12. Hash.needsRehash safely handles null, undefined, and empty strings', () => {
    expect(Hash.needsRehash('')).toBe(true);
    expect(Hash.needsRehash(null as any)).toBe(true);
    expect(Hash.needsRehash(undefined as any)).toBe(true);
  });
});
