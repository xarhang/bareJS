import { BareJS, Context } from '../src/bare';
import { bench, group, run } from 'mitata';

const app = new BareJS();

// --- 1. Setup Deep Nested Routes ---
// จำลองการมี Middleware ทุกชั้น และ Route ที่ยาวเป็นพิเศษ
const mw = (ctx: Context, next: any) => next();
app.use(mw);

app.get('/api/v1/user/:id/profile/settings/:category', (ctx: Context) => {
  return { id: ctx.params.id, category: ctx.params.category };
});

// --- 2. Setup Middleware Overload ---
// ใส่ Middleware 10 ตัวรวดก่อนถึง Handler
const heavyMiddlewares = Array.from({ length: 10 }, () => (ctx: Context, next: any) => next());
app.get('/heavy', ...heavyMiddlewares, (ctx: Context) => "ok");

// app.compile();

// --- 3. Start Benchmarking ---
group('BareJS Stress Testing', () => {

  // ทดสอบ Static vs Dynamic (Base latency)
  bench('Static Route (Base)', () => {
    app.fetch(new Request('http://localhost/heavy'));
  });

  // ทดสอบ Params + Deep Path
  bench('Deep Nested (Params Extraction)', () => {
    app.fetch(new Request('http://localhost/api/v1/user/123/profile/settings/security'));
  });

  // ทดสอบ Memory Pressure (จำลองการทำงานต่อเนื่อง)
  bench('High-Throughput (Context Creation)', () => {
    for (let i = 0; i < 100; i++) {
      app.fetch(new Request('http://localhost/heavy'));
    }
  });
});

await run();