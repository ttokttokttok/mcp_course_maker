import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    /**
     * The database layer is SQLite, so the tests that exercise it run against a
     * real one rather than a mock — in memory, created fresh from `db/index.ts`'s
     * own DDL, one per test file (vitest isolates module state per file).
     *
     * A file-backed default would let one test run's leftovers decide the next
     * one's assertions, so the path is pinned here rather than left to
     * `db/index.ts`'s `./data/app.db`.
     */
    env: { DATABASE_PATH: ":memory:" },
    /**
     * The route tests `await import("./route")`, which pulls in the AI SDK and
     * assistant-ui behind it. That first import is charged to whichever test
     * runs first in the file, and on a slow filesystem it alone can exceed the
     * 5s default — which then fails a passing test AND leaks its in-flight call
     * into the next one's mock assertions.
     */
    testTimeout: 30_000,
  },
});
