import {
  type Middleware,
  type Handler,
  type GroupCallback
} from './context';

// กำหนด Type ให้ยืดหยุ่น เพื่อรับ Middleware หลายตัวต่อด้วย Handler 1 ตัว
type HandlersChain = (Middleware | Handler)[];

export class BareRouter {
  // เก็บข้อมูลดิบของ Route ไว้ก่อนนำไป Compile ใน BareJS
  public routes: { method: string; path: string; handlers: any[] }[] = [];

  constructor(
    public prefix: string = "",
    public groupMiddleware: any[] = []
  ) { }

  /**
   * 🛠️ Internal method สำหรับการบันทึก Route
   * มีการทำ Path Normalization เพื่อลดภาระของ Router ตอนทำงานจริง
   */
  private _add(method: string, path: string, handlers: HandlersChain) {
    // กำจัด // ซ้ำซ้อนให้เหลือ / ตัวเดียว
    const fullPath = (this.prefix + path).replace(/\/+/g, "/") || "/";

    this.routes.push({
      method: method.toUpperCase(),
      path: fullPath,
      handlers: [...this.groupMiddleware, ...handlers]
    });
    return this;
  }

  // HTTP Methods ที่รองรับ
  public get = (path: string, ...h: HandlersChain) => this._add("GET", path, h);
  public post = (path: string, ...h: HandlersChain) => this._add("POST", path, h);
  public put = (path: string, ...h: HandlersChain) => this._add("PUT", path, h);
  public patch = (path: string, ...h: HandlersChain) => this._add("PATCH", path, h);
  public delete = (path: string, ...h: HandlersChain) => this._add("DELETE", path, h);

  /**
   * 📂 Grouping Logic
   * ช่วยให้จัดการ Prefix และ Middleware แยกตามส่วนของ API ได้
   */
  public group = (path: string, ...args: any[]) => {
    // แยก Callback (ตัวสุดท้าย) ออกจาก Middleware ที่ระบุมา
    const callback = args.pop() as GroupCallback;
    const middleware = args;

    const subRouter = new BareRouter(
      (this.prefix + path).replace(/\/+/g, "/"),
      [...this.groupMiddleware, ...middleware]
    );

    // รัน callback เพื่อจดทะเบียน routes ใน subRouter
    callback(subRouter);

    // ดึง routes ทั้งหมดจาก subRouter กลับมาที่ router หลัก
    this.routes.push(...subRouter.routes);
    return this;
  };

  /**
   * 🔗 Use: Mounts a router or middleware
   * Supports nested routers with automatic path prefixing
   */
  public use(mw: any) {
    if (mw && mw.routes && Array.isArray(mw.routes)) {
      // Merge routes from the sub-router
      const mergedRoutes = mw.routes.map((r: any) => ({
        ...r,
        // Prepend current router's prefix to the sub-router's path
        // e.g. v1 (/v1) using auth (/auth/login) -> /v1/auth/login
        path: (this.prefix + r.path).replace(/\/+/g, "/") || "/",
        handlers: [...this.groupMiddleware, ...r.handlers]
      }));
      this.routes.push(...mergedRoutes);
    } else {
      this.groupMiddleware.push(mw);
    }
    return this;
  }
}