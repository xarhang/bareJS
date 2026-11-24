import { BareJS, Type, cors, securityHeaders, bareAuth, createToken, Hash } from '../dist/index.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

const app = new BareJS();
app.use(cors());
app.use(securityHeaders());

const secret = 'deno-smoke-secret-1234567890123456';

app.get('/health', () => ({ status: 'ok', runtime: 'deno' }));
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
  // 1. Static GET + security headers
  const r1 = await fetch(`${base}/health`);
  assert(r1.status === 200, 'health status 200');
  const b1 = await r1.json();
  assert(b1.runtime === 'deno', 'runtime deno');
  assert(r1.headers.get('x-content-type-options') === 'nosniff', 'nosniff header');

  // 2. Dynamic params + TypeBox validation + secret stripping
  const r2 = await fetch(`${base}/orders/7`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'book', qty: 3 })
  });
  assert(r2.status === 200, 'orders status 200');
  const b2 = await r2.json();
  assert(b2.id === 7 && b2.item === 'book' && b2.qty === 3 && !('secret_field' in b2), 'secret stripped');

  // 3. JWT Auth
  const token = await createToken({ sub: 'deno-user' }, secret);
  const r401 = await fetch(`${base}/protected`);
  assert(r401.status === 401, '401 without token');
  const rAuth = await fetch(`${base}/protected`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert(rAuth.status === 200, '200 with token');
  assert((await rAuth.json()).sub === 'deno-user', 'sub matches');

  // 4. Native scrypt Password Hashing
  const hashed = await Hash.make('deno-secret-pass');
  assert(hashed.startsWith('$scrypt$'), 'scrypt prefix');
  assert((await Hash.verify('deno-secret-pass', hashed)) === true, 'verify valid');
  assert((await Hash.verify('wrong', hashed)) === false, 'verify invalid');

  // 5. Native Deno.upgradeWebSocket
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

  console.log('✅ Real Deno 2 smoke test passed all assertions!');
} finally {
  ac.abort();
  await server.finished;
}
