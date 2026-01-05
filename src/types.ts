// src/context.ts
export class Context {
  public res: Response;

  constructor(public req: Request) {
    this.res = new Response("Not Found", { status: 404 });
  }

  json(data: any) {
    this.res = new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }


  setResHeader(key: string, value: string) {
    const newHeaders = new Headers(this.res.headers);
    newHeaders.set(key, value);
    this.res = new Response(this.res.body, {
      status: this.res.status,
      headers: newHeaders,
    });
  }
}