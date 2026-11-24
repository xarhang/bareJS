export class Database {
  private inner: any;
  constructor(path: string = ":memory:") {
    try {
      // @ts-ignore node:sqlite in Deno 2.2+
      const sqlite = (process as any).getBuiltinModule?.("node:sqlite");
      if (!sqlite) throw new Error("node:sqlite unavailable");
      this.inner = new sqlite.DatabaseSync(path);
    } catch {
      throw new Error("node:sqlite is not available in this Deno version");
    }
  }
  exec(sql: string) {
    return this.inner.exec(sql);
  }
  run(sql: string, ...params: any[]) {
    return this.inner.prepare(sql).run(...params);
  }
  query(sql: string) {
    return this.inner.prepare(sql);
  }
  prepare(sql: string) {
    return this.inner.prepare(sql);
  }
  close() {
    return this.inner.close();
  }
}
export default Database;
