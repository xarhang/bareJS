/**
 * Component 6 Research Benchmark:
 * Compares Response.json(project(val)) vs Fused compileProjector + JSON Stringifier
 * across small flat objects, medium nested objects, and large arrays.
 *
 * Run: bun run benchmarks/stringify-research.ts
 */
import { bench, group, run } from 'mitata';
import { Type } from '@sinclair/typebox';
import { createResponseFilter } from '../src/security/validators';

const JSON_HDR = { 'content-type': 'application/json; charset=utf-8' };

// Safe RFC 8259 string escaper with fast-path when no special chars exist
const ESC_RE = /["\\\x00-\x1f]/;
function escStr(s: string): string {
  return ESC_RE.test(s) ? JSON.stringify(s) : `"${s}"`;
}

// 1. Small flat object (~100B)
const smallSchema = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  active: Type.Boolean(),
  role: Type.String()
});
const smallFilter = createResponseFilter(smallSchema);
const smallData = { id: 1, name: 'Alice', active: true, role: 'admin', secret: 'strip-me' };
const smallFused = (o: any) =>
  `{"id":${Number.isFinite(o.id) ? o.id : 'null'},"name":${escStr(String(o.name))},"active":${Boolean(o.active)},"role":${escStr(String(o.role))}}`;

// 2. Large array (500 items, ~50KB)
const itemSchema = Type.Object({
  id: Type.Number(),
  title: Type.String(),
  price: Type.Number(),
  inStock: Type.Boolean()
});
const arraySchema = Type.Array(itemSchema);
const arrayFilter = createResponseFilter(arraySchema);
const arrayData = Array.from({ length: 500 }, (_, i) => ({
  id: i + 1,
  title: `Product Item #${i + 1}`,
  price: (i + 1) * 1.5,
  inStock: i % 2 === 0,
  internalCost: 999
}));
const arrayFused = (arr: any[]) => {
  let out = '[';
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (i > 0) out += ',';
    out += `{"id":${Number.isFinite(o.id) ? o.id : 'null'},"title":${escStr(String(o.title))},"price":${Number.isFinite(o.price) ? o.price : 'null'},"inStock":${Boolean(o.inStock)}}`;
  }
  return out + ']';
};

group('Small Flat Object (~100B)', () => {
  bench('Response.json(project)', () => Response.json(smallFilter(smallData)));
  bench('Fused Stringifier + new Response', () => new Response(smallFused(smallData), { headers: JSON_HDR }));
});

group('Large Array (500 items, ~50KB)', () => {
  bench('Response.json(project)', () => Response.json(arrayFilter(arrayData)));
  bench('Fused Stringifier + new Response', () => new Response(arrayFused(arrayData), { headers: JSON_HDR }));
});

await run();
