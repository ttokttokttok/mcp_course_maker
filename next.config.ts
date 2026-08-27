import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * better-sqlite3 is a native module: it loads a `.node` binary at runtime,
   * which the bundler cannot trace or inline. Listing it here leaves it as a
   * plain `require` from node_modules on the server, which is the only way it
   * resolves in a built app.
   */
  serverExternalPackages: ["better-sqlite3"],

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

export default withAui(nextConfig);
