export class Database {
  private inner: any;
  constructor(path: string = ":memory:") {
    try {
      // Node 22.5+ built-in sqlite
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sqlite = process.getBuiltinModule?.("node:sqlite") ?? require("node:sqlite");
      this.inner = new sqlite.DatabaseSync(path);
    } catch {
      throw new Error("node:sqlite is not available in this Node.js version");
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
