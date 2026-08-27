/**
 * The object form rather than Next's array-of-strings shorthand.
 *
 * Two toolchains read this file: Next (for the app's Tailwind) and the Vite
 * build that mcp-use runs for the MCP views. Vite's postcss loader rejects a
 * bare plugin name — "Invalid PostCSS Plugin found at: plugins[0]" — while both
 * accept the object map, so this is the one spelling that satisfies each.
 */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
