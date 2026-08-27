import { createNextHandler } from "mcp-use/next";
import server from "@/mcp/server";

/**
 * The MCP endpoint, at `/api/mcp`.
 *
 * Mounting it inside the Next app rather than as a separate process is what lets
 * the MCP tools import `lib/` and `db/` directly — one core, two front doors —
 * and lets `withMcpUse` compile the view under `mcp/views/` as part of the same
 * build.
 */
export const { GET, POST, DELETE, OPTIONS } = createNextHandler(server);

// The tools read and write the local SQLite file on every call; a cached route
// would serve one course's outline for another's request.
export const dynamic = "force-dynamic";
