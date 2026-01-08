import { BareJS, Context } from '../src/bare';
import { Elysia } from 'elysia';
import { Hono } from 'hono';
import { bench, group, run } from 'mitata';

const MW_COUNT = 10;
const DEEP_PATH = '/api/v1/user/:id/profile/settings/:category';
const REQUEST_URL = 'http://localhost/api/v1/user/123/profile/settings/security';
const req = new Request(REQUEST_URL);

// 1. Setup BareJS
const bare = new BareJS();
for (let i = 0; i < MW_COUNT; i++) {
  bare.use((ctx: Context, next: any) => next());
}
bare.get(DEEP_PATH, (ctx: Context) => ctx.json({ id: ctx.params.id }));
// Force compile once before benchmark // remove because use it on fetch in bareJS fetch
// bare.compile();

// 2. Setup Elysia (Fixed Error 2349)
const elysia = new Elysia();
for (let i = 0; i < MW_COUNT; i++) {
  // Elysia's closest equivalent to a pass-through middleware
  elysia.onBeforeHandle(() => { });
}
elysia.get(DEEP_PATH, ({ params }) => ({ id: params.id }));

// 3. Setup Hono
const hono = new Hono();
for (let i = 0; i < MW_COUNT; i++) {
  hono.use('*', async (c, next) => await next());
}
hono.get(DEEP_PATH, (c) => c.json({ id: c.req.param('id') }));

// --- BENCHMARK ---
group('The "Real World" Stress Test (10 MW + Deep Path)', () => {

  bench('BareJS', () => {
    bare.fetch(req);
  });

  bench('Elysia', () => {
    elysia.handle(req);
  });

  bench('Hono', async () => {
    await hono.fetch(req);
  });
});

await run();