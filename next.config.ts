import { withAui } from "@assistant-ui/next";
import { withMcpUse, type NextConfigLike } from "mcp-use/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Next writes AGENTS.md and CLAUDE.md into the project root on dev start
   * unless this is off. Declined: they would appear as untracked files in a
   * contributor's working tree the first time they run `npm run dev`, which
   * reads as the repo doing something behind their back.
   */
  agentRules: false,

  /** Packages Next must not bundle into the server build. */
  serverExternalPackages: [
    // A native module: it loads a `.node` binary at runtime, which the bundler
    // cannot trace or inline. Left external so it stays a plain require.
    "better-sqlite3",
    // Left external for a different reason: mcp-use resolves part of itself
    // through a `#`-prefixed subpath import in its own package.json, whose
    // target lives in ITS nested node_modules. Bundling drags that specifier
    // into the app's resolution scope, where it does not exist —
    // "Can't resolve '#mcp-use-skills-loader'". Node resolves it correctly from
    // inside the package, so the fix is to let Node do it.
    "mcp-use",
  ],

  /**
   * `/import` was the creation page until 2026-07-31. It is `/create` now,
   * because "import" named the mechanism (pasting YouTube links) while every
   * control pointing at it says "New course" — and two independent design
   * passes both assumed `/create` without checking, which is the clearest
   * signal there is about what a page should be called.
   *
   * Permanent (308) rather than temporary: the path is not coming back, and a
   * 308 preserves the method, so a bookmark and a form post both survive.
   */
  async redirects() {
    return [{ source: "/import", destination: "/create", permanent: true }];
  },
};

/**
 * `withMcpUse` builds the MCP server entry and compiles every view under
 * `mcp/views/` when Next evaluates this file, so `next dev` and `next build`
 * both produce the widget bundles without a separate prebuild step. It is async
 * — that build is real work — hence the top-level await.
 *
 * Outermost, so assistant-ui has already finished shaping the config it cares
 * about before mcp-use adds its CORS headers, Turbopack aliases and output
 * tracing on top.
 *
 * Restart the dev server after editing `mcp/server.ts` or a view: this runs at
 * config-evaluation time, which is once per server start.
 *
 * Exported as an async FUNCTION rather than an awaited value: Next compiles this
 * file to CommonJS, where top-level await is a `ReferenceError`. Next awaits a
 * function export, so the build runs at the same moment either way.
 *
 * The cast is a structural-typing detail, not a suppression: mcp-use models the
 * config as an open record so it can augment it without depending on Next's
 * types, while Next's own `TurbopackOptions` is a closed interface. The two
 * describe the same object and neither is assignable to the other.
 */
export default async function config(): Promise<NextConfig> {
  const withMcp = await withMcpUse(withAui(nextConfig) as NextConfigLike, {
    // All three stated, none inferred. `viewsDir` is derived from `mcpDir`
    // rather than from `entry`, so passing only `entry` leaves the views
    // directory unset — the build then reports "views directory not configured"
    // and refuses the view-bound tool, which reads like a missing file.
    mcpDir: "mcp",
    entry: "mcp/server.ts",
    viewsDir: "mcp/views",
    basePath: "/api/mcp",
  });
  return withMcp as NextConfig;
}
