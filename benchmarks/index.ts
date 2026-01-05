import { run, bench, group } from "mitata";
import { BareJS } from "../src/bare";
import { Elysia } from "elysia";
import { Hono } from "hono";

// Setup servers... (โค้ดเหมือนเดิม)
// แต่เปลี่ยนจากการ listen ค้างไว้ เป็นการใช้เครื่องมือวัดผลโดยตรง:

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

await run();