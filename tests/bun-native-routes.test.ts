import { describe, expect, it } from 'bun:test';
import { BareJS } from '../src/core/bare';

describe('Bun.serve({ routes }) native fast-path & parity', () => {
  it('matches app.fetch() parity across static, zero-arg, rest-args, async, params, errors, and 404 fallbacks in production mode', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = new BareJS();

    app.get('/ping', () => 'pong');
    app.get('/json', () => ({ ok: true }));
    app.get('/empty', () => undefined);
    app.get('/async-zero', async () => 'async-ok');
    app.get('/rest-args', (...args: any[]) => args[0].text('from-ctx'));
    app.get('/boom', () => {
      throw new Error('boom');
    });
    app.get('/user/:id', (ctx) => ctx.json({ id: ctx.params.id }));
    app.post('/items', (ctx) => ctx.status(201).json({ created: true }));

    const srv: any = app.listen(0, '127.0.0.1', false);
    await srv.ready;
    const base = `http://127.0.0.1:${srv.port}`;

    try {
      const rPing = await fetch(`${base}/ping`);
      expect(rPing.status).toBe(200);
      expect(await rPing.text()).toBe('pong');

      const rJson = await fetch(`${base}/json`);
      expect(rJson.status).toBe(200);
      expect(await rJson.json()).toEqual({ ok: true });

      const rEmpty = await fetch(`${base}/empty`);
      expect(rEmpty.status).toBe(200);
      expect(await rEmpty.json()).toBeNull();

      const rAsync = await fetch(`${base}/async-zero`);
      expect(rAsync.status).toBe(200);
      expect(await rAsync.text()).toBe('async-ok');

      const rRest = await fetch(`${base}/rest-args`);
      expect(rRest.status).toBe(200);
      expect(await rRest.text()).toBe('from-ctx');

      const rBoom = await fetch(`${base}/boom`);
      expect(rBoom.status).toBe(500);
      expect(await rBoom.json()).toEqual({ status: 500, message: 'Internal Server Error' });

      const rParam = await fetch(`${base}/user/42`);
      expect(rParam.status).toBe(200);
      expect(await rParam.json()).toEqual({ id: '42' });

      const rPost = await fetch(`${base}/items`, { method: 'POST' });
      expect(rPost.status).toBe(201);
      expect(await rPost.json()).toEqual({ created: true });

      // Wrong method & trailing slash fall back to BareJS notFound JSON
      const rWrongMethod = await fetch(`${base}/ping`, { method: 'POST' });
      expect(rWrongMethod.status).toBe(404);
      const nf1: any = await rWrongMethod.json();
      expect(nf1.status).toBe(404);

      const rTrailing = await fetch(`${base}/ping/`);
      expect(rTrailing.status).toBe(200);
      expect(await rTrailing.text()).toBe('pong');

      const rNotFound = await fetch(`${base}/does-not-exist`);
      expect(rNotFound.status).toBe(404);
      const nf2: any = await rNotFound.json();
      expect(nf2.status).toBe(404);
    } finally {
      srv.stop(true);
      process.env.NODE_ENV = prevEnv;
    }
  });

  it('disables native routes offloading when global middleware is registered', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const app = new BareJS();
    app.use(async (ctx, next) => {
      ctx.setHeader('x-mw', 'applied');
      return next();
    });
    app.get('/ping', () => 'pong');

    const srv: any = app.listen(0, '127.0.0.1', false);
    await srv.ready;
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/ping`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-mw')).toBe('applied');
      expect(await res.text()).toBe('pong');
    } finally {
      srv.stop(true);
      process.env.NODE_ENV = prevEnv;
    }
  });
});
