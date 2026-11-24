import assert from 'node:assert/strict';
import { BareJS, Type, cors, securityHeaders, bareAuth, createToken, compress } from '../dist/node.js';

const app = new BareJS();
app.use(cors());
app.use(securityHeaders());
app.docs('/docs', { title: 'BareJS Node Smoke' });

const secret = 'node-smoke-secret-1234567890123456';

app.get('/health', () => ({ status: 'ok', runtime: 'node' }));
app.post(
  '/orders/:id',
  {
    params: Type.Object({ id: Type.Integer() }),
    body: Type.Object({ item: Type.String(), qty: Type.Integer({ minimum: 1 }) }),
    response: Type.Object({ id: Type.Number(), item: Type.String(), qty: Type.Number() })
  },
  (ctx) => ({
    id: ctx.params.id,
    item: ctx.body.item,
    qty: ctx.body.qty,
    secret_field: 'should-be-stripped'
  })
);
app.get('/protected', bareAuth({ secret }), (ctx) => ({ sub: ctx.user?.sub }));
app.get('/big', compress({ minSize: 32, encodings: ['gzip'] }), () => ({
  text: 'hello-node-'.repeat(20)
}));
app.get('/sse', (ctx) =>
  ctx.sse((async function* () {
    yield { data: 'hello' };
    yield { event: 'done', data: 'bye' };
  })())
);

const server = app.listen(0, '127.0.0.1', false);
if (!server.listening) await new Promise((r) => server.once('listening', r));
const addr = server.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;
assert.ok(port > 0, 'Node server should bind to an ephemeral port');
const base = `http://127.0.0.1:${port}`;

try {
  // 1. Static fast-path GET
  const r1 = await fetch(`${base}/health`);
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { status: 'ok', runtime: 'node' });
  assert.equal(r1.headers.get('x-content-type-options'), 'nosniff');

  // 2. Dynamic params + TypeBox validation + response secret stripping
  const r2 = await fetch(`${base}/orders/7`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'laptop', qty: 2 })
  });
  assert.equal(r2.status, 200);
  assert.deepEqual(await r2.json(), { id: 7, item: 'laptop', qty: 2 });

  // 3. Invalid body -> 400
  const rBad = await fetch(`${base}/orders/7`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'laptop', qty: 0 })
  });
  assert.equal(rBad.status, 400);

  // 4. JWT Auth
  const token = await createToken({ sub: 'node-user' }, secret);
  const r401 = await fetch(`${base}/protected`);
  assert.equal(r401.status, 401);
  const rAuth = await fetch(`${base}/protected`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(rAuth.status, 200);
  assert.deepEqual(await rAuth.json(), { sub: 'node-user' });

  // 5. OpenAPI /docs/json
  const rDocs = await fetch(`${base}/docs/json`);
  assert.equal(rDocs.status, 200);
  const spec = await rDocs.json();
  assert.equal(spec.info.title, 'BareJS Node Smoke');
  assert.ok(spec.paths['/orders/{id}']);

  // 6. Gzip compression
  const rGz = await fetch(`${base}/big`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(rGz.status, 200);
  const gzBody = await rGz.json();
  assert.ok(gzBody.text.startsWith('hello-node-'));

  // 7. SSE streaming
  const rSse = await fetch(`${base}/sse`);
  assert.equal(rSse.status, 200);
  const sseText = await rSse.text();
  assert.ok(sseText.includes('data: hello'));
  assert.ok(sseText.includes('event: done'));

  console.log('✅ Real Node.js smoke test passed all assertions!');
} finally {
  await app.stop(true);
}
