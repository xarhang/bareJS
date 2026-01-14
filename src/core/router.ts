import {
  type Middleware,
  type Handler,
  type GroupCallback
} from '../core/context';

type HandlersChain = (Middleware | Handler)[];

export class BareRouter {
  public routes: any[] = [];

  constructor(
    public prefix: string = "",
    public groupMiddleware: any[] = []
  ) { }

  private _add(method: string, path: string, handlers: HandlersChain) {
    // ⚡️ แก้ไข: ไม่ต้องเติม / นำหน้า และกำจัด // ออกให้หมด
    let fullPath = (this.prefix + "/" + path)
        .replace(/\/+/g, "/")    // ยุบ // ให้เหลือ /
        // .replace(/^\//, "");     // 🚩 ลบ / ตัวหน้าสุดออก (เช่น /api -> api)

    // ลบ / ตัวท้ายออกถ้ามี
    if (fullPath.endsWith("/")) fullPath = fullPath.slice(0, -1);

    this.routes.push({
      method: method.toUpperCase(),
      path: fullPath || "", // หน้าแรกจะเป็นค่าว่าง "" แทน "/"
      handlers: [...this.groupMiddleware, ...handlers]
    });
    return this;
}

  public get = (path: string, ...h: HandlersChain) => this._add("GET", path, h);
  public post = (path: string, ...h: HandlersChain) => this._add("POST", path, h);
  public put = (path: string, ...h: HandlersChain) => this._add("PUT", path, h);
  public patch = (path: string, ...h: HandlersChain) => this._add("PATCH", path, h);
  public delete = (path: string, ...h: HandlersChain) => this._add("DELETE", path, h);

  public group = (path: string, ...args: any[]) => {
    const callback = args.pop();
    const middleware = args;

    // ส่ง prefix ต่อไปโดยคงรูปแบบเดิม
    const newPrefix = (this.prefix + "/" + path).replace(/\/+/g, "/");
    const subRouter = new BareRouter(newPrefix, [...this.groupMiddleware, ...middleware]);

    callback(subRouter);
    this.routes.push(...subRouter.routes);
    return this;
};

  public use(mw: any) {
    if (mw instanceof BareRouter || (mw && mw.routes)) {
      // ดึงมาตรงๆ ไม่ต้องบวก prefix ซ้ำ เพราะใน subRouter มันคำนวณมาแล้ว
      this.routes.push(...mw.routes);
    } else {
      this.groupMiddleware.push(mw);
    }
    return this;
  }
}
