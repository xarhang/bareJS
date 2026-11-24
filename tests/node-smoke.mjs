import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import {
  BareJS,
  BareRouter,
  Type,
  Z,
  native,
  cors,
  csrf,
  securityHeaders,
  rateLimit,
  idempotency,
  createSingleflight,
  circuitBreaker,
  timeout,
  bareAuth,
  basicAuth,
  hasRole,
  revokeToken,
  createToken,
  Hash,
  compress,
  staticFile,
  logger,
  healthcheck,
  bareClient
} from '../dist/node.js';

const staticDir = mkdtempSync(join(tmpdir(), 'barejs-node-static-'));
writeFileSync(join(staticDir, 'hello.txt'), 'Hello Static BareJS!');

const app = new BareJS();
const secret = 'node-smoke-secret-1234567890123456';
const cookieSecret = 'node-cookie-secret-12345678901234';

app.use(securityHeaders());
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use(healthcheck({ path: '/healthz', readyPath: '/readyz', version: '1.0.0', checks: { ok: () => true } }));
app.use(logger({ onLog: () => {} }));
app.docs('/docs', { title: 'BareJS Node Full Suite' });

// Sub-router & derive
const sub = new BareRouter().get('/items/:id', {
  params: Type.Object({ id: Type.Integer() })
}, (ctx) => ({ subId: ctx.params.id }));
app.route('/sub', sub);

app.get('/health', () => ({ status: 'ok', runtime: 'node' }));
app.get('/files/*', (ctx) => ({ wildcard: ctx.params['*'] }));
app.get('/query-all', (ctx) => ({ tags: ctx.queryAll('tag') }));

// Validation: TypeBox + coercion + secret stripping
app.post(
  '/orders/:id',
  {
    params: Type.Object({ id: Type.Integer() }),
    query: Type.Object({ notify: Type.Optional(Type.Boolean()) }),
    body: Type.Object({ item: Type.String(), qty: Type.Integer({ minimum: 1 }) }),
    response: Type.Object({ id: Type.Number(), notify: Type.Optional(Type.Boolean()), item: Type.String(), qty: Type.Number() }),
    maxBodySize: 1024
  },
  (ctx) => ({
    id: ctx.params.id,
    notify: ctx.query.notify,
    item: ctx.body.item,
    qty: ctx.body.qty,
    secret_field: 'should-be-stripped'
  })
);

// Zod & Native validation
app.post('/zod', { body: Z.object({ email: Z.string().email() }) }, (ctx) => ctx.body);
app.post('/native', native({ properties: { name: { type: 'string' } }, required: ['name'] }), (ctx) => ctx.body);

// Auth, RBAC, Revocation, BasicAuth
app.get('/protected', bareAuth({ secret }), hasRole('admin'), (ctx) => ({ sub: ctx.user?.sub }));
app.get('/basic', basicAuth({ user: 'admin', pass: 'pass' }), () => ({ ok: true }));

// Signed Cookies
app.post('/cookie', async (ctx) => {
  await ctx.setCookie('sid', 'user_99', { secret: cookieSecret, httpOnly: true });
  return { set: true };
});
app.get('/cookie', async (ctx) => {
  const sid = await ctx.getSignedCookie('sid', cookieSecret);
  return sid ? { sid } : ctx.status(401).json({ error: 'invalid' });
});

// CSRF & RateLimit
app.post('/csrf-test', csrf({ allowedOrigins: ['https://app.example.com'] }), () => ({ ok: true }));
app.get('/limited', rateLimit({ windowMs: 60_000, max: 2 }), () => ({ ok: true }));

// Resilience: Idempotency, Singleflight, CircuitBreaker, Timeout
app.post('/pay', idempotency({ ttlMs: 10_000 }), () => ({ paid: true }));
const sf = createSingleflight();
let sfCalls = 0;
app.get('/sf', () => sf('k', async () => { await new Promise((r) => setTimeout(r, 30)); return { calls: ++sfCalls }; }));
app.get('/cb', circuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 }), () => {
  throw new Error('boom');
});
app.get('/slow', timeout(20), async () => {
  await new Promise((r) => setTimeout(r, 80));
  return { ok: true };
});

// Compression (gzip & br)
app.get('/big', compress({ minSize: 32, encodings: ['br', 'gzip'] }), () => ({
  text: 'hello-node-'.repeat(20)
}));

// Static files
app.use(staticFile(staticDir, { maxAge: 60, etag: true }));

// SSE, Upload, UploadStream, JSON-RPC 2.0, WebSocket
app.get('/sse', (ctx) =>
  ctx.sse((async function* () {
    yield { data: 'hello' };
    yield { event: 'done', data: 'bye' };
  })())
);
app.post('/upload', async (ctx) => {
  const { fields, files } = await ctx.upload({ maxFileSize: 1024 * 1024, allowedTypes: ['text/plain'] });
  return { fields, files: files.map((f) => ({ safeName: f.safeName, size: f.size })) };
});
app.post('/upload-stream', async (ctx) => {
  const names = [];
  for await (const part of ctx.uploadStream({ maxFileSize: 1024 * 1024 })) {
    if (part.type === 'file' && part.stream) {
      const reader = part.stream.getReader();
      while (!(await reader.read()).done) {}
      names.push(part.safeName);
    }
  }
  return { names };
});
app.rpc('/rpc', { add: ({ a, b }) => a + b });
app.ws('/ws/:room', {
  open: (ws) => ws.send(`joined:${ws.data.params.room}`),
  message: (ws, msg) => ws.send(`echo:${msg}`)
});

const server = app.listen(0, '127.0.0.1', false);
if (!server.listening) await new Promise((r) => server.once('listening', r));
const addr = server.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;
assert.ok(port > 0, 'Node server should bind to an ephemeral port');
const base = `http://127.0.0.1:${port}`;

try {
  // 1. Routing, wildcard, sub-router, queryAll, healthcheck
  const r1 = await fetch(`${base}/health`);
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { status: 'ok', runtime: 'node' });
  assert.equal(r1.headers.get('x-content-type-options'), 'nosniff');

  const rWild = await fetch(`${base}/files/a/b/c.txt`);
  assert.deepEqual(await rWild.json(), { wildcard: 'a/b/c.txt' });

  const rSub = await fetch(`${base}/sub/items/42`);
  assert.deepEqual(await rSub.json(), { subId: 42 });

  const rQa = await fetch(`${base}/query-all?tag=a&tag=b`);
  assert.deepEqual(await rQa.json(), { tags: ['a', 'b'] });

  const rHz = await fetch(`${base}/healthz`);
  assert.equal(rHz.status, 200);

  // 2. Validation (TypeBox, Zod, Native) + secret stripping + 413
  const r2 = await fetch(`${base}/orders/7?notify=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'laptop', qty: 2 })
  });
  assert.equal(r2.status, 200);
  assert.deepEqual(await r2.json(), { id: 7, notify: true, item: 'laptop', qty: 2 });

  const r413 = await fetch(`${base}/orders/7`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'x'.repeat(2000), qty: 1 })
  });
  assert.equal(r413.status, 413);

  const rZod = await fetch(`${base}/zod`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' })
  });
  assert.equal(rZod.status, 400);

  const rNat = await fetch(`${base}/native`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'barejs' })
  });
  assert.equal(rNat.status, 200);

  // 3. Auth, RBAC, Revocation, BasicAuth, Signed Cookies, CSRF, RateLimit
  const token = await createToken({ sub: 'node-user', role: 'admin', jti: 'jti-1' }, secret);
  assert.equal((await fetch(`${base}/protected`)).status, 401);
  const rAuth = await fetch(`${base}/protected`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(rAuth.status, 200);
  revokeToken('jti-1', 60_000);
  assert.equal((await fetch(`${base}/protected`, { headers: { authorization: `Bearer ${token}` } })).status, 401);

  assert.equal(
    (await fetch(`${base}/basic`, { headers: { authorization: 'Basic ' + Buffer.from('admin:pass').toString('base64') } })).status,
    200
  );

  const rSetCookie = await fetch(`${base}/cookie`, { method: 'POST' });
  const setCookieHdr = rSetCookie.headers.get('set-cookie');
  assert.ok(setCookieHdr);
  const cookiePair = setCookieHdr.split(';')[0];
  const rGetCookie = await fetch(`${base}/cookie`, { headers: { cookie: cookiePair } });
  assert.deepEqual(await rGetCookie.json(), { sid: 'user_99' });

  assert.equal((await fetch(`${base}/csrf-test`, { method: 'POST', headers: { origin: 'https://evil.com' } })).status, 403);
  assert.equal((await fetch(`${base}/limited`)).status, 200);
  assert.equal((await fetch(`${base}/limited`)).status, 200);
  assert.equal((await fetch(`${base}/limited`)).status, 429);

  // 4. Resilience: Idempotency, Singleflight, CircuitBreaker, Timeout
  const idem1 = await fetch(`${base}/pay`, { method: 'POST', headers: { 'idempotency-key': 'k-1' } });
  assert.equal(idem1.status, 200);
  const idem2 = await fetch(`${base}/pay`, { method: 'POST', headers: { 'idempotency-key': 'k-1' } });
  assert.equal(idem2.headers.get('x-idempotent-replayed'), 'true');

  await Promise.all([fetch(`${base}/sf`), fetch(`${base}/sf`), fetch(`${base}/sf`)]);
  assert.equal(sfCalls, 1);

  assert.equal((await fetch(`${base}/cb`)).status, 500);
  assert.equal((await fetch(`${base}/cb`)).status, 503);
  assert.equal((await fetch(`${base}/slow`)).status, 408);

  // 5. OpenAPI, JSON-RPC 2.0, bareClient
  const spec = await (await fetch(`${base}/docs/json`)).json();
  assert.equal(spec.info.title, 'BareJS Node Full Suite');
  const rpcRes = await (await fetch(`${base}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'add', params: { a: 4, b: 5 }, id: 1 })
  })).json();
  assert.equal(rpcRes.result, 9);

  const client = bareClient(base);
  assert.deepEqual(await client.get('/health'), { status: 'ok', runtime: 'node' });

  // 6. Static files (200, 304, 206), Compression (gzip & br), SSE, Upload, UploadStream
  const rStatic = await fetch(`${base}/hello.txt`);
  assert.equal(rStatic.status, 200);
  const etag = rStatic.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(`${base}/hello.txt`, { headers: { 'if-none-match': etag } })).status, 304);
  const rRange = await fetch(`${base}/hello.txt`, { headers: { range: 'bytes=0-4' } });
  assert.equal(rRange.status, 206);
  assert.equal(await rRange.text(), 'Hello');

  const rGz = await fetch(`${base}/big`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(rGz.headers.get('content-encoding'), 'gzip');
  assert.ok((await rGz.json()).text.startsWith('hello-node-'));

  const rBr = await fetch(`${base}/big`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(rBr.headers.get('content-encoding'), 'br');
  assert.ok((await rBr.json()).text.startsWith('hello-node-'));

  const sseText = await (await fetch(`${base}/sse`)).text();
  assert.ok(sseText.includes('data: hello') && sseText.includes('event: done'));

  const fd = new FormData();
  fd.append('title', 'doc');
  fd.append('file', new Blob(['abc123'], { type: 'text/plain' }), '../evil.txt');
  const rUp = await (await fetch(`${base}/upload`, { method: 'POST', body: fd })).json();
  assert.equal(rUp.files[0].safeName, 'evil.txt');

  const fd2 = new FormData();
  fd2.append('file', new Blob(['stream-data'], { type: 'text/plain' }), 'stream.txt');
  const rUpS = await (await fetch(`${base}/upload-stream`, { method: 'POST', body: fd2 })).json();
  assert.deepEqual(rUpS.names, ['stream.txt']);

  // 7. Native scrypt Password Hashing (zero peer deps)
  const hashed = await Hash.make('node-secret-pass');
  assert.ok(hashed.startsWith('$scrypt$'));
  assert.equal(await Hash.verify('node-secret-pass', hashed), true);
  assert.equal(await Hash.verify('wrong-pass', hashed), false);

  // 8. WebSocket handshake + echo (works on Node 20 & 22)
  const WS = globalThis.WebSocket ?? (await import('ws')).WebSocket;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Node WS timeout')), 3000);
    const client = new WS(`ws://127.0.0.1:${port}/ws/vientiane`);
    const msgs = [];
    client.onmessage = (ev) => {
      msgs.push(String(ev.data));
      if (msgs.length === 1) {
        client.send('sabai');
      } else if (msgs.length === 2) {
        clearTimeout(timer);
        assert.deepEqual(msgs, ['joined:vientiane', 'echo:sabai']);
        client.close();
        resolve();
      }
    };
    client.onerror = (e) => {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error('Node WS error'));
    };
  });

  console.log('✅ Real Node.js full feature suite passed all assertions!');
} finally {
  await app.stop(true);
  rmSync(staticDir, { recursive: true, force: true });
}
