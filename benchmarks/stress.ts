import { BareJS, Context } from '../src/core/bare';
import { bench, group, run } from 'mitata';

const app = new BareJS();

// --- 1. Setup Deep Nested Routes ---
const mw = (ctx: Context, next: any) => next();
app.use(mw);

app.get('/api/v1/user/:id/profile/settings/:category', (ctx: Context) => {
  return { id: ctx.params.id, category: ctx.params.category };
});

// --- 2. Setup Middleware Overload ---
const heavyMiddlewares = Array.from({ length: 10 }, () => (ctx: Context, next: any) => next());
app.get('/heavy', ...heavyMiddlewares, (ctx: Context) => "ok");

// app.compile();

// --- 3. Start Benchmarking ---
group('BareJS Stress Testing', () => {

  bench('Static Route (Base)', () => {
    app.fetch(new Request('http://localhost/heavy'));
  });
  bench('Deep Nested (Params Extraction)', () => {
    app.fetch(new Request('http://localhost/api/v1/user/123/profile/settings/security'));
  });

  bench('High-Throughput (Context Creation)', () => {
    for (let i = 0; i < 100; i++) {
      app.fetch(new Request('http://localhost/heavy'));
    }
  });
});

await run();