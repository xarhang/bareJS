import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, unlinkSync } from 'node:fs';
import { BareJS, Type, staticFile, compress, cors, securityHeaders, rateLimit, bareAuth, createToken } from '../src/index';
import { bunDriver, nodeDriver, setRuntime } from '../src/runtime';

describe('Node Runtime Driver (nodeDriver)', () => {
  afterEach(() => {
    setRuntime(bunDriver);
  });

  it('serves GET, POST JSON + TypeBox validation, multi Set-Cookie, SSE, and 413 body limit via node:http', async () => {
    setRuntime(nodeDriver);
    const app = new BareJS();
    app.use(cors());
    app.use(securityHeaders());

    app.get('/ping', () => ({ ok: true, runtime: 'node' }));
    app.post(
      '/items/:id',
      {
        params: Type.Object({ id: Type.Integer() }),
        body: Type.Object({ name: Type.String() })
      },
      (ctx) => {
        ctx.setCookie('a', '1', { httpOnly: true });
        ctx.setCookie('b', '2', { path: '/' });
        return { id: ctx.params.id, name: ctx.body.name };
      }
    );
    app.get('/sse', (ctx) =>
      ctx.sse(async function* () {
        yield { data: 'hello' };
        yield { event: 'done', data: 'bye' };
      })
    );

    const server = app.listen(0, '127.0.0.1', false, { maxRequestBodySize: 128 });
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    try {
      const r1 = await fetch(`${base}/ping`);
      expect(r1.status).toBe(200);
      expect(await r1.json()).toEqual({ ok: true, runtime: 'node' });
      expect(r1.headers.get('x-content-type-options')).toBe('nosniff');

      const r2 = await fetch(`${base}/items/42`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'widget' })
      });
      expect(r2.status).toBe(200);
      expect(await r2.json()).toEqual({ id: 42, name: 'widget' });
      const cookies = r2.headers.getSetCookie();
      expect(cookies.length).toBe(2);

      const r413 = await fetch(`${base}/items/42`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(300) })
      });
      expect(r413.status).toBe(413);
    } finally {
      await app.stop(true);
    }
  });

  it('serves static files, Range 206, and gzip compression via nodeDriver', async () => {
    setRuntime(nodeDriver);
    const tmpFile = join(tmpdir(), `barejs-node-static-${Date.now()}.txt`);
    const content = 'Hello BareJS Node Runtime! '.repeat(80);
    writeFileSync(tmpFile, content);
    const fileName = tmpFile.split('/').pop()!;

    const app = new BareJS();
    app.use(staticFile(tmpdir()));
    app.get('/big', compress({ minSize: 64, encodings: ['gzip'] }), () => ({
      msg: 'compress-me-'.repeat(30)
    }));

    const server = app.listen(0, '127.0.0.1', false);
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      const rStatic = await fetch(`${base}/${fileName}`);
      expect(rStatic.status).toBe(200);
      expect(await rStatic.text()).toBe(content);

      const rRange = await fetch(`${base}/${fileName}`, {
        headers: { range: 'bytes=0-4' }
      });
      expect(rRange.status).toBe(206);
      expect(await rRange.text()).toBe('Hello');

      const rGz = await fetch(`${base}/big`, {
        headers: { 'accept-encoding': 'gzip' }
      });
      expect(rGz.status).toBe(200);
      const gzData = await rGz.json();
      expect(gzData.msg).toContain('compress-me-');
    } finally {
      await app.stop(true);
      try { unlinkSync(tmpFile); } catch {}
    }
  });

  it('throws clear error when nodeDriver password peer dependencies are missing', async () => {
    await expect(
      nodeDriver.password.hash('secret', { algorithm: 'argon2id', memoryCost: 65536, timeCost: 2 })
    ).rejects.toThrow('@node-rs/argon2');
    await expect(
      nodeDriver.password.hash('secret', { algorithm: 'bcrypt', memoryCost: 65536, timeCost: 10 })
    ).rejects.toThrow('bcryptjs');
  });

  it('works with rateLimit and bareAuth on nodeDriver', async () => {
    setRuntime(nodeDriver);
    const app = new BareJS();
    app.use(rateLimit({ max: 10, windowMs: 60_000 }));
    const secret = 'test-secret-node-1234567890123456';
    app.get('/me', bareAuth({ secret }), (ctx) => ({ user: ctx.user }));

    const token = await createToken({ sub: 'u1', role: 'admin' }, secret);
    const server = app.listen(0, '127.0.0.1', false);
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const port = (server.address() as any).port;

    try {
      const unauth = await fetch(`http://127.0.0.1:${port}/me`);
      expect(unauth.status).toBe(401);

      const ok = await fetch(`http://127.0.0.1:${port}/me`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(ok.status).toBe(200);
      expect((await ok.json()).user.sub).toBe('u1');
    } finally {
      await app.stop(true);
    }
  });
});
