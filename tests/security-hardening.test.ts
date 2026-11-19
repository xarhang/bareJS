import { describe, expect, it } from 'bun:test';
import {
  BareJS,
  bareAuth,
  createToken,
  compress,
  idempotency,
  redisStore,
  staticFile
} from '../src/index';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const b64url = (input: string | Uint8Array) => Buffer.from(input).toString('base64url');

describe('Security Hardening & Bug Fixes', () => {
  it('bareAuth rejects non-object JWT payload and enforces issuer & audience', async () => {
    const secret = 'hardening-secret';
    const app = new BareJS();

    app.get('/protected', bareAuth({ secret, issuer: 'https://auth.example.com', audience: 'api-v1' }), (ctx) => ({ user: ctx.user }));

    // Non-object payload (array)
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const arrayPayload = b64url(JSON.stringify(['admin']));
    const { createHmac } = await import('node:crypto');
    const sig = b64url(createHmac('sha256', secret).update(`${header}.${arrayPayload}`).digest());
    const resArr = await app.request('/protected', {
      headers: { Authorization: `Bearer ${header}.${arrayPayload}.${sig}` }
    });
    expect(resArr.status).toBe(401);

    // Wrong issuer
    const badIss = await createToken({ sub: '1', iss: 'https://evil.com', aud: 'api-v1' }, secret);
    const resIss = await app.request('/protected', {
      headers: { Authorization: `Bearer ${badIss}` }
    });
    expect(resIss.status).toBe(401);

    // Wrong audience
    const badAud = await createToken({ sub: '1', iss: 'https://auth.example.com', aud: 'other-api' }, secret);
    const resAud = await app.request('/protected', {
      headers: { Authorization: `Bearer ${badAud}` }
    });
    expect(resAud.status).toBe(401);

    // Valid issuer and array audience
    const valid = await createToken({ sub: '1', iss: 'https://auth.example.com', aud: ['web', 'api-v1'] }, secret);
    const resOk = await app.request('/protected', {
      headers: { Authorization: `Bearer ${valid}` }
    });
    expect(resOk.status).toBe(200);
    expect((await resOk.json()).user.sub).toBe('1');
  });

  it('bareAuth JWKS enforces cooldown on unknown kid and skips enc keys', async () => {
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    let fetchCount = 0;

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount++;
      return Response.json({
        keys: [
          { ...jwk, kid: 'enc-key', use: 'enc', alg: 'ES256' },
          { ...jwk, kid: 'sig-key', use: 'sig', alg: 'ES256' }
        ]
      });
    }) as any;

    try {
      const app = new BareJS();
      app.get('/jwks', bareAuth({ jwksUri: 'https://idp.test/jwks.json', algorithms: ['ES256'] }), () => ({ ok: true }));

      const signJwt = async (kid: string) => {
        const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
        const payload = b64url(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 60 }));
        const data = `${header}.${payload}`;
        const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(data));
        return `${data}.${b64url(new Uint8Array(sig))}`;
      };

      // Reject enc key
      const encToken = await signJwt('enc-key');
      const rEnc = await app.request('/jwks', { headers: { Authorization: `Bearer ${encToken}` } });
      expect(rEnc.status).toBe(401);

      // Spamming unknown kid should NOT re-fetch JWKS repeatedly (cooldown active)
      const beforeSpam = fetchCount;
      for (let i = 0; i < 5; i++) {
        const badTok = await signJwt(`unknown-${i}`);
        const rBad = await app.request('/jwks', { headers: { Authorization: `Bearer ${badTok}` } });
        expect(rBad.status).toBe(401);
      }
      expect(fetchCount).toBe(beforeSpam);

      // Valid sig key still works
      const goodTok = await signJwt('sig-key');
      const rOk = await app.request('/jwks', { headers: { Authorization: `Bearer ${goodTok}` } });
      expect(rOk.status).toBe(200);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('idempotency externalStore writes cache before releasing lock', async () => {
    const ops: string[] = [];
    const store = {
      data: new Map<string, any>(),
      async get(k: string) {
        return this.data.get(k);
      },
      async set(k: string, entry: any) {
        await new Promise((r) => setTimeout(r, 15));
        ops.push('set');
        this.data.set(k, entry);
      },
      async acquire() {
        ops.push('acquire');
        return true;
      },
      async release() {
        ops.push('release');
      }
    };

    const app = new BareJS();
    app.post('/pay', idempotency({ store }), (ctx) => ctx.status(201).json({ paid: true }));

    const res = await app.request('/pay', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'k-order-1' }
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 40));

    expect(ops).toEqual(['acquire', 'set', 'release']);
  });

  it('redisStore recovers missing TTL (-1) and preserves empty rawBodyBase64', async () => {
    const kv = new Map<string, string>();
    const pexpireCalls: string[] = [];
    const mockClient = {
      async send(cmd: string, args: string[]) {
        if (cmd === 'INCR') {
          const next = Number(kv.get(args[0]!) || '0') + 1;
          kv.set(args[0]!, String(next));
          return next;
        }
        if (cmd === 'PTTL') return -1; // Simulate missing TTL
        if (cmd === 'PEXPIRE') {
          pexpireCalls.push(args[0]!);
          return 1;
        }
        if (cmd === 'GET') return kv.get(args[0]!) ?? null;
        if (cmd === 'SET') {
          kv.set(args[0]!, args[1]!);
          return 'OK';
        }
        if (cmd === 'DEL') {
          kv.delete(args[0]!);
          return 1;
        }
        return null;
      }
    };

    const store = redisStore(mockClient, { prefix: 'test:' });
    // Simulate count === 2 with PTTL === -1
    kv.set('test:rl:ip1', '1');
    const rl = await store.increment('ip1', 5000);
    expect(rl.count).toBe(2);
    expect(pexpireCalls).toContain('test:rl:ip1');

    // Empty rawBodyBase64 should still return rawBody (0-byte ArrayBuffer)
    await store.set('empty-res', { status: 204, rawBody: new ArrayBuffer(0), contentType: 'text/plain', expiresAt: Date.now() + 5000 }, 5000);
    const got = await store.get('empty-res');
    expect(got?.rawBody).toBeInstanceOf(ArrayBuffer);
    expect(got?.rawBody?.byteLength).toBe(0);
  });

  it('compress respects q=0 in Accept-Encoding', async () => {
    const app = new BareJS();
    app.use(compress({ minSize: 10, encodings: ['zstd', 'br', 'gzip'] }));
    app.get('/data', () => 'x'.repeat(200));

    const res = await app.request('/data', {
      headers: { 'Accept-Encoding': 'zstd;q=0, br;q=0, gzip' }
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');

    const resNone = await app.request('/data', {
      headers: { 'Accept-Encoding': 'zstd;q=0, br;q=0, gzip;q=0' }
    });
    expect(resNone.headers.get('content-encoding')).toBeNull();
  });

  it('staticFile serves realFile safely when cacheMetadata is enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bare-static-sec-'));
    const outside = mkdtempSync(join(tmpdir(), 'bare-outside-'));
    try {
      writeFileSync(join(dir, 'hello.txt'), 'hello-safe');
      writeFileSync(join(outside, 'secret.txt'), 'top-secret');
      symlinkSync(join(outside, 'secret.txt'), join(dir, 'escape.txt'));

      const app = new BareJS();
      app.use(staticFile(dir, { cacheMetadata: { maxEntries: 10, ttlMs: 5000 } }));

      const ok1 = await app.request('/hello.txt');
      expect(ok1.status).toBe(200);
      expect(await ok1.text()).toBe('hello-safe');

      // Cache hit
      const ok2 = await app.request('/hello.txt');
      expect(ok2.status).toBe(200);
      expect(await ok2.text()).toBe('hello-safe');

      // Symlink escape blocked
      const esc = await app.request('/escape.txt');
      expect(esc.status).toBe(403);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('jsonBody rejects oversized payload even with non-numeric Content-Length', async () => {
    const app = new BareJS();
    app.post('/limited', async (ctx) => {
      const body = await ctx.jsonBody(20);
      return { body };
    });

    const bigPayload = JSON.stringify({ data: 'a'.repeat(50) });
    const res = await app.request('/limited', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': 'invalid-number'
      },
      body: bigPayload
    });
    expect(res.status).toBe(413);
  });

  it('setCookie sanitizes name/path/domain and applies Set-Cookie on redirect/html/text without duplicates', async () => {
    const { Context } = await import('../src/index');
    const c = new Context();
    expect(() => c.setCookie('bad;name', '1')).toThrow();
    expect(() => c.setCookie('ok', '1', { path: '/\r\nSet-Cookie: evil=1' })).toThrow();
    expect(() => c.setCookie('ok', '1', { domain: 'a.com; evil' })).toThrow();

    const app = new BareJS();
    app.get('/mw-redirect', (ctx, next) => {
      ctx.setCookie('sid', 'abc123');
      return ctx.redirect('/login');
    }, () => ({ unreachable: true }));

    app.get('/html-cookie', (ctx) => ctx.setCookie('theme', 'dark').html('<h1>hi</h1>'));

    const redir = await app.request('/mw-redirect');
    expect(redir.status).toBe(302);
    expect(redir.headers.get('set-cookie')).toContain('sid=abc123');

    const html = await app.request('/html-cookie');
    expect(html.status).toBe(200);
    expect(html.headers.getSetCookie()).toHaveLength(1);
    expect(html.headers.get('set-cookie')).toContain('theme=dark');
  });

  it('getQuery ignores Object.prototype keys and response projector ignores __proto__', async () => {
    const { Type, createResponseFilter } = await import('../src/index');
    const app = new BareJS();
    app.get('/q', (ctx) => ({
      toStringVal: ctx.getQuery('toString') ?? null,
      constructorVal: ctx.getQuery('constructor') ?? null,
      real: ctx.getQuery('a') ?? null
    }));

    const res = await app.request('/q?a=1');
    const data = await res.json();
    expect(data).toEqual({ toStringVal: null, constructorVal: null, real: '1' });

    const schema = Type.Object({ name: Type.String(), ['__proto__']: Type.Optional(Type.Any()) } as any);
    const filter = createResponseFilter(schema);
    const out = filter({ name: 'alice', extra: 'secret' });
    expect(out).toEqual({ name: 'alice' });
  });
});
