import { describe, test, expect } from 'bun:test';
import { BareJS, type Context } from '../src/index';

describe('Enterprise Features: Graceful Drain, Dev UAF Guard & Streaming Upload', () => {
  test('1. app.onDrain() and app.drain() execute drain hooks and stop server gracefully', async () => {
    const app = new BareJS();
    const events: string[] = [];

    app.onDrain(async () => {
      await new Promise((r) => setTimeout(r, 10));
      events.push('drain-1');
    });
    app.onDrain(() => {
      throw new Error('drain hook failure');
    });
    app.onDrain(() => {
      events.push('drain-2');
    });
    app.onStop(() => {
      events.push('stop');
    });

    app.get('/ping', () => 'pong');
    const server = app.listen(0);
    const res = await fetch(`http://localhost:${server.port}/ping`);
    expect(await res.text()).toBe('pong');

    // Calling drain() twice is idempotent
    await app.drain();
    await app.drain();

    expect(events).toEqual(['drain-1', 'drain-2', 'stop']);
  });

  test('2. app.listen() handles IPC DRAIN_REQUEST message and cleans up on stop()', async () => {
    const app = new BareJS();
    let drained = false;
    app.onDrain(() => {
      drained = true;
    });

    const origExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code?: number) => {
      exitCode = code ?? 0;
    };

    try {
      app.listen(0);
      process.emit('message' as any, { type: 'DRAIN_REQUEST' });
      await new Promise((r) => setTimeout(r, 30));
      expect(drained).toBe(true);
      expect(exitCode).toBe(0);
    } finally {
      (process as any).exit = origExit;
      await app.stop();
    }
  });

  test('3. Dev-mode Use-after-free Guard warns when ctx is accessed after response release (even after pool reuse)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      const app = new BareJS(4);
      let leakedCtx: Context | undefined;

      app.get('/leak', (ctx) => {
        ctx.set('secret', 'req-1-secret');
        leakedCtx = ctx;
        return ctx.status(201).setHeader('x-test', 'ok').json({ ok: true });
      });

      app.get('/other', (ctx) => {
        ctx.set('secret', 'req-2-secret');
        return { ok: true };
      });

      const res1 = await app.request('/leak');
      expect(res1.status).toBe(201);
      expect(res1.headers.get('x-test')).toBe('ok');
      expect(warnings.length).toBe(0);

      // Recycle the same Context into a second request
      const res2 = await app.request('/other');
      expect(res2.status).toBe(200);
      expect(warnings.length).toBe(0);

      // Now access the leaked ctx from request 1 -> must warn!
      void leakedCtx!.get('secret');
      leakedCtx!.set('x', 1);
      expect(warnings.length).toBeGreaterThanOrEqual(2);
      expect(warnings[0]).toContain('Use-after-free detected');
    } finally {
      console.warn = origWarn;
      process.env.NODE_ENV = prevEnv;
    }
  });

  test('4. Production mode emits zero UAF warnings (zero overhead path)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    try {
      const app = new BareJS(4);
      let leakedCtx: Context | undefined;
      app.get('/prod', (ctx) => {
        leakedCtx = ctx;
        return { ok: true };
      });

      const res = await app.request('/prod');
      expect(res.status).toBe(200);
      void leakedCtx!.get('anything');
      expect(warnings.length).toBe(0);
    } finally {
      console.warn = origWarn;
      process.env.NODE_ENV = prevEnv;
    }
  });

  test('5. ctx.uploadStream() streams fields and files across tiny chunk boundaries with filename sanitization', async () => {
    const app = new BareJS();

    app.post('/stream-upload', async (ctx) => {
      const fields: Record<string, string> = {};
      const files: Array<{ fieldName: string; safeName: string; content: string; contentType?: string }> = [];

      for await (const part of ctx.uploadStream({ maxFileSize: 1024 * 1024 })) {
        if (part.type === 'field') {
          fields[part.fieldName] = part.value!;
        } else if (part.type === 'file' && part.stream) {
          const text = await new Response(part.stream).text();
          files.push({
            fieldName: part.fieldName,
            safeName: part.safeName!,
            content: text,
            contentType: part.contentType
          });
        }
      }

      return { fields, files };
    });

    const boundary = '----BareStreamBoundary123';
    const rawPayload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="title"\r\n\r\n` +
      `Hello Streaming\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="doc"; filename="../../evil file!.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `First file content across chunks!\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="second"; filename="data.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n` +
      `SecondPayload\r\n` +
      `--${boundary}--\r\n`;

    // Slice payload into tiny 7-byte chunks to stress-test boundary splitting
    const bytes = new TextEncoder().encode(rawPayload);
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.byteLength; i += 7) {
          controller.enqueue(bytes.subarray(i, i + 7));
        }
        controller.close();
      }
    });

    const res = await app.fetch(
      new Request('http://localhost/stream-upload', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary="${boundary}"` },
        body: bodyStream
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fields).toEqual({ title: 'Hello Streaming' });
    expect(json.files).toEqual([
      {
        fieldName: 'doc',
        safeName: 'evil_file_.txt',
        content: 'First file content across chunks!',
        contentType: 'text/plain'
      },
      {
        fieldName: 'second',
        safeName: 'data.bin',
        content: 'SecondPayload',
        contentType: 'application/octet-stream'
      }
    ]);
  });

  test('6. ctx.uploadStream() enforces allowedTypes (415), maxFileSize (413), and skips unconsumed streams', async () => {
    const app = new BareJS();

    app.post('/upload-limited', async (ctx) => {
      const seen: string[] = [];
      for await (const part of ctx.uploadStream({
        allowedTypes: ['text/plain'],
        maxFileSize: 10
      })) {
        if (part.type === 'file') {
          seen.push(part.safeName!);
          if (part.safeName === 'skip.txt') {
            // Intentionally do not read part.stream
            continue;
          }
          await new Response(part.stream!).arrayBuffer();
        }
      }
      return { seen };
    });

    const mkReq = (body: string) =>
      new Request('http://localhost/upload-limited', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=B' },
        body
      });

    // Skip unconsumed stream + read second file
    const rSkip = await app.fetch(
      mkReq(
        '--B\r\nContent-Disposition: form-data; name="a"; filename="skip.txt"\r\nContent-Type: text/plain\r\n\r\n12345\r\n' +
          '--B\r\nContent-Disposition: form-data; name="b"; filename="keep.txt"\r\nContent-Type: text/plain\r\n\r\n123\r\n--B--\r\n'
      )
    );
    expect(rSkip.status).toBe(200);
    expect(await rSkip.json()).toEqual({ seen: ['skip.txt', 'keep.txt'] });

    // Unsupported MIME -> 415
    const rMime = await app.fetch(
      mkReq('--B\r\nContent-Disposition: form-data; name="a"; filename="a.exe"\r\nContent-Type: application/x-msdownload\r\n\r\nhi\r\n--B--\r\n')
    );
    expect(rMime.status).toBe(415);

    // Exceeds maxFileSize (10 bytes) -> 413
    const rSize = await app.fetch(
      mkReq('--B\r\nContent-Disposition: form-data; name="a"; filename="big.txt"\r\nContent-Type: text/plain\r\n\r\n0123456789ABCDEF\r\n--B--\r\n')
    );
    expect(rSize.status).toBe(413);
  });
});
