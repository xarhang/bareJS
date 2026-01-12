export type Params = Record<string, string>;
export type Next = () => Promise<any> | any;
export type Middleware = (ctx: Context, next: Next) => Promise<any> | any;
export type Handler = (ctx: Context) => Promise<any> | any;
export type GroupCallback = (router: any) => void;
export type AuthUser = Record<string, any>;

export class Context {
  public req!: Request;
  public params: Params = {};
  public _status = 200;
  public _headers?: Record<string, string>;
  public store = new Map<string, any>();
  public body: any = undefined; // เก็บ Cache ที่ Parse แล้ว

  constructor() { }

  // ⚡ เมธอดใหม่สำหรับดึง Body แบบ Lazy & Async
  public async jsonBody(): Promise<any> {
    // 1. ถ้าเคย Parse ไปแล้ว (เช่น Middleware ตัวก่อนหน้าเรียกใช้) ให้คืนค่าจาก Cache ทันที
    if (this.body !== undefined) return this.body;

    // 2. เช็คเบื้องต้นว่ามีข้อมูลส่งมาจริงไหม
    const contentType = this.req.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      try {
        // 3. Parse และเก็บลง Cache
        return this.body = await this.req.json();
      } catch {
        return this.body = null;
      }
    }
    return this.body = null;
  }

  // ส่วน reset() และอื่นๆ ยังคงเดิม (ตัดต่อกับ BareJS JIT ได้ทันที)
  public reset(req: Request): this {
    this.req = req;
    this._status = 200;
    this._headers = undefined;
    if (this.store.size > 0) this.store.clear();
    this.params = {};
    this.body = undefined; // สำคัญ: ต้องรีเซ็ต Cache เสมอ
    return this;
  }

  public status(code: number): this {
    this._status = code;
    return this;
  }

  public json(data: any): Response {
    if (this._headers) {
      if (!this._headers["content-type"]) this._headers["content-type"] = "application/json";
      return Response.json(data, {
        status: this._status,
        headers: this._headers
      });
    }

    if (this._status === 200) {
      return Response.json(data);
    }

    return Response.json(data, { status: this._status });
  }

  public set(key: string, value: any): this {
    this.store.set(key, value);
    return this;
  }

  public get(key: string): any {
    return this.store.get(key);
  }
}