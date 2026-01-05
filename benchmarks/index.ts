import { run, bench, group } from "mitata";
import { BareJS } from "../src/bare";
import { Elysia } from "elysia";
import { Hono } from "hono";

group("Web Framework Speed Test", () => {
  const payload = { message: "bench" };
  
  const bare = new BareJS();
  bare.get("/", () => payload);

  const elysia = new Elysia().get("/", () => payload);
  const hono = new Hono().get("/", (c) => c.json(payload));
const req = new Request("http://localhost/");
  bench("BareJS (Your Engine)", async () => {
    await bare.fetch(req);
  });

  bench("Elysia", async () => {
    await elysia.handle(req);
  });

  bench("Hono", async () => {
    await hono.fetch(req);
  });
});


const results: any = await run();

import { writeFileSync } from "fs";

const formatted = results.benchmarks.map((b: any) => {
  
  const stats = b.runs && b.runs[0] ? b.runs[0].stats : null;
  
  return {
    
    name: String(b.alias || "Unknown"),
    unit: "ns/iter",
    
    value: stats ? Number(stats.avg) : 0
  };
});

writeFileSync("result.json", JSON.stringify(formatted, null, 2));


console.log("✅ Deep Probe - result.json content:");
console.log(JSON.stringify(formatted, null, 2));
