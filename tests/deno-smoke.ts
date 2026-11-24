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
} from '../dist/index.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

const staticDir = await Deno.makeTempDir({ prefix: 'barejs-deno-static-' });
await Deno.writeTextFile(`${staticDir}/hello.txt`, 'Hello Static BareJS!');

const app = new BareJS();
const secret = 'deno-smoke-secret-1234567890123456';
const cookieSecret = 'deno-cookie-secret-12345678901234';

app.use(securityHeaders());
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use(healthcheck({ path: '/healthz', readyPath: '/readyz', version: '1.0.0', checks: { ok: () => true } }));
app.use(logger({ onLog: () => {} }));
app.docs('/docs', { title: 'BareJS Deno Full Suite' });

const sub = new BareRouter().get('/items/:id', {
  params: Type.Object({ id: Type.Integer() })
}, (ctx) => ({ subId: ctx.params.id }));
app.route('/sub', sub);

app.get('/health', () => ({ status: 'ok', runtime: 'deno' }));
app.get('/files/*', (ctx) => ({ wildcard: ctx.params['*'] }));
app.get('/query-all', (ctx) => ({ tags: ctx.queryAll('tag') }));

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

app.post('/zod', { body: Z.object({ email: Z.string().email() }) }, (ctx) => ctx.body);
app.post('/native', native({ properties: { name: { type: 'string' } }, required: ['name'] }), (ctx) => ctx.body);

app.get('/protected', bareAuth({ secret }), hasRole('admin'), (ctx) => ({ sub: ctx.user?.sub }));
app.get('/basic', basicAuth({ user: 'admin', pass: 'pass' }), () => ({ ok: true }));

app.post('/cookie', async (ctx) => {
  await ctx.setCookie('sid', 'user_99', { secret: cookieSecret, httpOnly: true });
  return { set: true };
});
app.get('/cookie', async (ctx) => {
  const sid = await ctx.getSignedCookie('sid', cookieSecret);
  return sid ? { sid } : ctx.status(401).json({ error: 'invalid' });
});

app.post('/csrf-test', csrf({ allowedOrigins: ['https://app.example.com'] }), () => ({ ok: true }));
app.get('/limited', rateLimit({ windowMs: 60_000, max: 2 }), () => ({ ok: true }));

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

app.get('/big', compress({ minSize: 32, encodings: ['br', 'gzip'] }), () => ({
  text: 'hello-deno-'.repeat(20)
}));

app.use(staticFile(staticDir, { maxAge: 60, etag: true }));

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
  const names: string[] = [];
  for await (const part of ctx.uploadStream({ maxFileSize: 1024 * 1024 })) {
    if (part.type === 'file' && part.stream) {
      const reader = part.stream.getReader();
      while (!(await reader.read()).done) {}
      names.push(part.safeName!);
    }
  }
  return { names };
});
app.rpc('/rpc', { add: ({ a, b }: { a: number; b: number }) => a + b });
app.ws('/ws/:room', {
  open: (ws: any) => ws.send(`joined:${ws.data.params.room}`),
  message: (ws: any, msg: any) => ws.send(`echo:${msg}`)
});
app.compile();

const ac = new AbortController();
let boundPort = 0;
const server = Deno.serve(
  {
    port: 0,
    hostname: '127.0.0.1',
    signal: ac.signal,
    onListen({ port }) {
      boundPort = port;
    }
  },
  (req, info) => app.fetch(req, (info.remoteAddr as Deno.NetAddr)?.hostname)
);

const base = `http://127.0.0.1:${boundPort}`;

try {
  // 1. Routing, wildcard, sub-router, queryAll, healthcheck
  const r1 = await fetch(`${base}/health`);
  assert(r1.status === 200 && (await r1.json()).runtime === 'deno', 'health ok');
  assert(r1.headers.get('x-content-type-options') === 'nosniff', 'security headers');
  assert((await (await fetch(`${base}/files/a/b/c.txt`)).json()).wildcard === 'a/b/c.txt', 'wildcard');
  assert((await (await fetch(`${base}/sub/items/42`)).json()).subId === 42, 'sub-router');
  assert((await (await fetch(`${base}/query-all?tag=a&tag=b`)).json()).tags.length === 2, 'queryAll');
  assert((await fetch(`${base}/healthz`)).status === 200, 'healthcheck');

  // 2. Validation (TypeBox, Zod, Native) + secret stripping + 413
  const r2 = await fetch(`${base}/orders/7?notify=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'book', qty: 3 })
  });
  const b2 = await r2.json();
  assert(r2.status === 200 && b2.id === 7 && b2.notify === true && !('secret_field' in b2), 'TypeBox + strip');
  assert((await fetch(`${base}/orders/7`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'x'.repeat(2000), qty: 1 })
  })).status === 413, 'maxBodySize 413');
  assert((await fetch(`${base}/zod`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bad' })
  })).status === 400, 'Zod validation');
  assert((await fetch(`${base}/native`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'barejs' })
  })).status === 200, 'Native validation');

  // 3. Auth, RBAC, Revocation, BasicAuth, Signed Cookies, CSRF, RateLimit
  const token = await createToken({ sub: 'deno-user', role: 'admin', jti: 'd-jti-1' }, secret);
  assert((await fetch(`${base}/protected`)).status === 401, '401 no token');
  assert((await fetch(`${base}/protected`, { headers: { authorization: `Bearer ${token}` } })).status === 200, '200 with token');
  revokeToken('d-jti-1', 60_000);
  assert((await fetch(`${base}/protected`, { headers: { authorization: `Bearer ${token}` } })).status === 401, 'revoked token');
  assert((await fetch(`${base}/basic`, { headers: { authorization: 'Basic ' + btoa('admin:pass') } })).status === 200, 'basicAuth');

  const rSetCookie = await fetch(`${base}/cookie`, { method: 'POST' });
  const cookiePair = rSetCookie.headers.get('set-cookie')!.split(';')[0];
  assert((await (await fetch(`${base}/cookie`, { headers: { cookie: cookiePair } })).json()).sid === 'user_99', 'signed cookie');

  assert((await fetch(`${base}/csrf-test`, { method: 'POST', headers: { origin: 'https://evil.com' } })).status === 403, 'csrf');
  assert((await fetch(`${base}/limited`)).status === 200, 'rateLimit 1');
  assert((await fetch(`${base}/limited`)).status === 200, 'rateLimit 2');
  assert((await fetch(`${base}/limited`)).status === 429, 'rateLimit 429');

  // 4. Resilience
  assert((await fetch(`${base}/pay`, { method: 'POST', headers: { 'idempotency-key': 'dk-1' } })).status === 200, 'idem 1');
  assert((await fetch(`${base}/pay`, { method: 'POST', headers: { 'idempotency-key': 'dk-1' } })).headers.get('x-idempotent-replayed') === 'true', 'idem replay');
  await Promise.all([fetch(`${base}/sf`), fetch(`${base}/sf`), fetch(`${base}/sf`)]);
  assert(sfCalls === 1, 'singleflight');
  assert((await fetch(`${base}/cb`)).status === 500, 'cb trip');
  assert((await fetch(`${base}/cb`)).status === 503, 'cb open');
  assert((await fetch(`${base}/slow`)).status === 408, 'timeout 408');

  // 5. OpenAPI, JSON-RPC 2.0, bareClient
  assert((await (await fetch(`${base}/docs/json`)).json()).info.title === 'BareJS Deno Full Suite', 'OpenAPI');
  const rpcRes = await (await fetch(`${base}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'add', params: { a: 4, b: 5 }, id: 1 })
  })).json();
  assert(rpcRes.result === 9, 'JSON-RPC');
  assert((await bareClient(base).get('/health')).runtime === 'deno', 'bareClient');

  // 6. Static files, Compression, SSE, Upload, UploadStream
  const rStatic = await fetch(`${base}/hello.txt`);
  assert(rStatic.status === 200, 'static 200');
  const etag = rStatic.headers.get('etag')!;
  assert((await fetch(`${base}/hello.txt`, { headers: { 'if-none-match': etag } })).status === 304, 'static 304');
  const rRange = await fetch(`${base}/hello.txt`, { headers: { range: 'bytes=0-4' } });
  assert(rRange.status === 206 && (await rRange.text()) === 'Hello', 'static 206');

  const rGz = await fetch(`${base}/big`, { headers: { 'accept-encoding': 'gzip' } });
  assert(rGz.headers.get('content-encoding') === 'gzip' && (await rGz.json()).text.startsWith('hello-deno-'), 'gzip');

  const sseText = await (await fetch(`${base}/sse`)).text();
  assert(sseText.includes('data: hello') && sseText.includes('event: done'), 'sse');

  const fd = new FormData();
  fd.append('file', new Blob(['abc123'], { type: 'text/plain' }), '../evil.txt');
  const rUp = await (await fetch(`${base}/upload`, { method: 'POST', body: fd })).json();
  assert(rUp.files[0].safeName === 'evil.txt', 'upload');

  const fd2 = new FormData();
  fd2.append('file', new Blob(['stream-data'], { type: 'text/plain' }), 'stream.txt');
  const rUpS = await (await fetch(`${base}/upload-stream`, { method: 'POST', body: fd2 })).json();
  assert(rUpS.names[0] === 'stream.txt', 'uploadStream');

  // 7. Native scrypt Password Hashing
  const hashed = await Hash.make('deno-secret-pass');
  assert(hashed.startsWith('$scrypt$'), 'scrypt prefix');
  assert((await Hash.verify('deno-secret-pass', hashed)) === true, 'verify valid');
  assert((await Hash.verify('wrong', hashed)) === false, 'verify invalid');

  // 8. Native Deno.upgradeWebSocket
  const received: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${boundPort}/ws/luangprabang`);
    const timer = setTimeout(() => reject(new Error('Deno WS timeout')), 3000);
    ws.onmessage = (ev) => {
      received.push(String(ev.data));
      if (received.length === 1) ws.send('sabai');
      else if (received.length === 2) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(e);
    };
  });
  assert(received[0] === 'joined:luangprabang' && received[1] === 'echo:sabai', 'WS echo matches');

  console.log('✅ Real Deno 2 full feature suite passed all assertions!');
} finally {
  ac.abort();
  await server.finished;
  await Deno.remove(staticDir, { recursive: true });
}
