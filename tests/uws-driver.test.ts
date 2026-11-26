import { describe, expect, it } from 'bun:test';
import { BareJS } from '../src/core/bare';
import { serveUws } from '../src/runtime/uws';

function createMockUws() {
  const routes: Record<string, Record<string, Function>> = { get: {}, head: {}, del: {}, options: {} };
  let anyHandler: Function | null = null;
  let wsConfig: any = null;
  let closedSocket: any = null;

  const mockModule = {
    us_socket_local_port: () => 43210,
    us_listen_socket_close: (tok: any) => { closedSocket = tok; },
    App() {
      const appObj: any = {
        get: (p: string, fn: Function) => { routes.get[p] = fn; return appObj; },
        head: (p: string, fn: Function) => { routes.head[p] = fn; return appObj; },
        del: (p: string, fn: Function) => { routes.del[p] = fn; return appObj; },
        options: (p: string, fn: Function) => { routes.options[p] = fn; return appObj; },
        any: (_p: string, fn: Function) => { anyHandler = fn; return appObj; },
        ws: (_p: string, cfg: any) => { wsConfig = cfg; return appObj; },
        listen: (_host: string, _port: number, cb: Function) => { cb({ id: 'sock-1' }); }
      };
      return appObj;
    }
  };

  function makeRes() {
    const headers: Record<string, string | string[]> = {};
    const chunks: Buffer[] = [];
    let status = '200 OK';
    let ended = false;
    let abortedCb: Function | null = null;
    let dataCb: Function | null = null;
    let upgradedData: any = null;

    const res: any = {
      writeStatus: (s: string) => { status = s; return res; },
      writeHeader: (k: string, v: string) => {
        const lk = k.toLowerCase();
        if (lk === 'set-cookie') {
          const prev = headers[lk];
          headers[lk] = Array.isArray(prev) ? [...prev, v] : prev ? [prev, v] : [v];
        } else {
          headers[lk] = v;
        }
        return res;
      },
      write: (d: any) => { chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))); return true; },
      end: (d?: any) => {
        if (d !== undefined) chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
        ended = true;
        return res;
      },
      cork: (fn: Function) => fn(),
      close: () => { ended = true; },
      onAborted: (cb: Function) => { abortedCb = cb; return res; },
      onData: (cb: Function) => { dataCb = cb; return res; },
      getRemoteAddressAsText: () => Buffer.from('127.0.0.1'),
      upgrade: (ud: any) => { upgradedData = ud; },
      _triggerAbort: () => abortedCb?.(),
      _pushData: (buf: Buffer, isLast: boolean) => dataCb?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), isLast),
      _result: () => ({ status, headers, body: Buffer.concat(chunks).toString('utf8'), ended, upgradedData })
    };
    return res;
  }

  function makeReq(method: string, url: string, query = '', hdrs: Record<string, string> = {}, params: string[] = []) {
    return {
      getMethod: () => method.toLowerCase(),
      getUrl: () => url,
      getQuery: () => query,
      getHeader: (k: string) => hdrs[k.toLowerCase()] || '',
      getParameter: (i: number) => params[i] ?? '',
      forEach: (cb: (k: string, v: string) => void) => {
        for (const [k, v] of Object.entries(hdrs)) cb(k.toLowerCase(), v);
      }
    };
  }

  return { mockModule, routes, getAny: () => anyHandler, getWs: () => wsConfig, getClosedSocket: () => closedSocket, makeRes, makeReq };
}

describe('uWebSockets.js driver (serveUws)', () => {
  it('handles Tier 1 static, zero-arg, UwsContext sync/async/abort, Tier 2 streaming/413/404, and WebSockets', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { mockModule, routes, getAny, getWs, getClosedSocket, makeRes, makeReq } = createMockUws();

    const wsEvents: string[] = [];
    const wsRoutes = new Map<string, any>([
      ['/chat/:room', {
        open: (ws: any) => wsEvents.push(`open:${ws.data.params.room}`),
        message: (ws: any, msg: any) => { wsEvents.push(`msg:${msg}`); ws.send(`echo:${msg}`); },
        drain: () => wsEvents.push('drain'),
        close: (_ws: any, code: number, reason: string) => wsEvents.push(`close:${code}:${reason}`)
      }]
    ]);

    const handle: any = serveUws({
      port: 0,
      hostname: '127.0.0.1',
      reusePort: false,
      maxRequestBodySize: 16,
      uwsRoutes: [
        { method: 'GET', path: '/ping', paramNames: [], rawHandler: () => 'pong', isPureStaticString: true, isTrulyZeroArg: true },
        { method: 'GET', path: '/zero-json', paramNames: [], rawHandler: () => ({ z: 1 }), isPureStaticString: false, isTrulyZeroArg: true },
        {
          method: 'GET',
          path: '/user/:id',
          paramNames: ['id'],
          rawHandler: (ctx: any) => ctx.json({ id: ctx.params.id, q: ctx.query.q, h: ctx.getHeader('x-t') }),
          isPureStaticString: false,
          isTrulyZeroArg: false
        },
        {
          method: 'GET',
          path: '/async-ctx',
          paramNames: [],
          rawHandler: async (ctx: any) => {
            await new Promise((r) => setTimeout(r, 5));
            return ctx.text('async-done');
          },
          isPureStaticString: false,
          isTrulyZeroArg: false
        }
      ],
      fetch: async (req) => {
        const u = new URL(req.url);
        if (u.pathname === '/sse') {
          const stream = new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode('data: hello\n\n'));
              ctrl.close();
            }
          });
          return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
        }
        if (req.method === 'POST' && u.pathname === '/echo') {
          const body = await req.text();
          return Response.json({ body }, { status: 201 });
        }
        return Response.json({ status: 404, message: 'Not Found' }, { status: 404 });
      },
      ws: {
        routes: wsRoutes,
        adapter: {
          open(ws: any) { ws.data?.open?.(ws); },
          message(ws: any, msg: any) { ws.data?.message?.(ws, msg); },
          close(ws: any, code: any, reason: any) { ws.data?.close?.(ws, code, reason); },
          drain(ws: any) { ws.data?.drain?.(ws); }
        }
      }
    }, mockModule);

    await handle.ready;
    expect(handle.port).toBe(43210);

    try {
      // 1. Tier 1 pure static Buffer
      const rPing = makeRes();
      routes.get['/ping']!(rPing, makeReq('GET', '/ping'));
      expect(rPing._result().body).toBe('pong');

      // 2. Tier 1 zero-arg JSON
      const rZero = makeRes();
      routes.get['/zero-json']!(rZero, makeReq('GET', '/zero-json'));
      expect(JSON.parse(rZero._result().body)).toEqual({ z: 1 });

      // 3. Tier 1 UwsContext params + query + header
      const rUser = makeRes();
      routes.get['/user/:id']!(rUser, makeReq('GET', '/user/42', 'q=lao', { 'x-t': 'ok' }, ['42']));
      expect(JSON.parse(rUser._result().body)).toEqual({ id: '42', q: 'lao', h: 'ok' });

      // 4. Tier 1 async UwsContext
      const rAsync = makeRes();
      routes.get['/async-ctx']!(rAsync, makeReq('GET', '/async-ctx'));
      await new Promise((r) => setTimeout(r, 20));
      expect(rAsync._result().body).toBe('async-done');

      // 5. Tier 1 async aborted before resolve (must not throw or write)
      const rAbort = makeRes();
      routes.get['/async-ctx']!(rAbort, makeReq('GET', '/async-ctx'));
      rAbort._triggerAbort();
      await new Promise((r) => setTimeout(r, 20));
      expect(rAbort._result().ended).toBe(false);

      // 6. Tier 2 streaming SSE
      const anyFn = getAny()!;
      const rSse = makeRes();
      anyFn(rSse, makeReq('GET', '/sse'));
      await new Promise((r) => setTimeout(r, 20));
      expect(rSse._result().headers['content-type']).toBe('text/event-stream');
      expect(rSse._result().body).toBe('data: hello\n\n');

      // 7. Tier 2 POST body & 413 guard
      const rPost = makeRes();
      anyFn(rPost, makeReq('POST', '/echo'));
      rPost._pushData(Buffer.from('hi'), true);
      await new Promise((r) => setTimeout(r, 20));
      expect(rPost._result().status).toBe('201 Created');
      expect(JSON.parse(rPost._result().body)).toEqual({ body: 'hi' });

      const r413 = makeRes();
      anyFn(r413, makeReq('POST', '/echo'));
      r413._pushData(Buffer.from('0123456789abcdef_overflow'), true);
      expect(r413._result().status).toBe('413 Payload Too Large');

      // 8. Native uWS WebSocket lifecycle
      const wsCfg = getWs()!;
      const wsUpgradeRes = makeRes();
      wsCfg.upgrade(wsUpgradeRes, makeReq('GET', '/chat/vip', '', { 'sec-websocket-key': 'k' }), {});
      const ud = wsUpgradeRes._result().upgradedData;
      expect(ud.handler.params).toEqual({ room: 'vip' });

      const sent: string[] = [];
      const mockWs: any = {
        getUserData: () => ud,
        send: (d: any) => sent.push(String(d)),
        end: () => {}
      };
      wsCfg.open(mockWs);
      wsCfg.message(mockWs, Buffer.from('sabai'), false);
      wsCfg.drain(mockWs);
      wsCfg.close(mockWs, 1000, Buffer.from('bye'));
      expect(wsEvents).toEqual(['open:vip', 'msg:sabai', 'drain', 'close:1000:bye']);
      expect(sent).toEqual(['echo:sabai']);
    } finally {
      handle.stop();
      expect(getClosedSocket()).toEqual({ id: 'sock-1' });
      process.env.NODE_ENV = prevEnv;
    }
  });
});

describe('Structured JSON useLog()', () => {
  it('emits structured JSON log entries via custom onLog sink with level, status, path, and durationMs', async () => {
    const entries: any[] = [];
    const app = new BareJS().useLog({ format: 'json', onLog: (e) => entries.push(e) });
    app.get('/ok', () => 'ok');
    app.get('/fail', (ctx) => ctx.status(400).json({ err: true }));

    const r1 = await app.fetch(new Request('http://localhost/ok'), '10.0.0.1');
    expect(r1.status).toBe(200);
    const r2 = await app.fetch(new Request('http://localhost/fail'), '10.0.0.2');
    expect(r2.status).toBe(400);

    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ level: 'info', method: 'GET', path: '/ok', status: 200, ip: '10.0.0.1' });
    expect(typeof entries[0].durationMs).toBe('number');
    expect(entries[1]).toMatchObject({ level: 'warn', method: 'GET', path: '/fail', status: 400, ip: '10.0.0.2' });
  });
});
