import { defineConfig } from "vitest/config";
import path from "node:path";

const hasNodeSqlite = (() => {
  try {
    return Boolean((process as any).getBuiltinModule?.("node:sqlite"));
  } catch {
    return false;
  }
})();

const exclude = ["**/node_modules/**", "**/dist/**", "tests/playwright.test.ts"];
if (!hasNodeSqlite) {
  exclude.push("tests/production-db.test.ts");
}

export default defineConfig({
  resolve: {
    alias: {
      "bun:test": path.resolve(__dirname, "tests/shims/bun-test-node.ts"),
      "bun:sqlite": path.resolve(__dirname, "tests/shims/bun-sqlite-node.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude,
    setupFiles: ["tests/shims/setup-node.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "threads",
    poolOptions: {
      threads: {
        execArgv: ["--expose-gc"],
      },
    },
  },
});
