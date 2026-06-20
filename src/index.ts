/**
 * index.ts
 *
 * D-01: Owns the MCP server setup and all tool registrations.
 * D-02: All tool handlers registered inline here — no src/tools/ directory.
 * D-03: Compiled entry point is dist/index.js.
 * D-09: Logging via console.error() only — console.log() is forbidden (stdout = JSON-RPC channel).
 * D-10: Tool naming follows resource_verb convention (e.g. server_ping).
 *
 * Exports createServer() so tests can instantiate the server without
 * auto-connecting a StdioServerTransport (test isolation).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MetabaseClient, MetabaseApiError } from "./client.js";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a configured McpServer instance with all tools registered.
 * Does NOT connect the server to any transport — callers (including tests)
 * are responsible for connecting (e.g. server.connect(transport)).
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "metabase-mcp",
    version: "0.1.0",
  });

  // -------------------------------------------------------------------------
  // Tool: server_ping (D-10 resource_verb naming)
  // -------------------------------------------------------------------------
  // Stub tool for the walking skeleton. Validates that the MCP server is
  // reachable and returns a JSON status object.
  // Wrapped in try/catch per ARCHITECTURE: unhandled handler exceptions are
  // invisible to the LLM; always return isError:true on error (T-01-07).

  server.tool(
    "server_ping",
    "Ping the MCP server to verify it is running and reachable.",
    {}, // empty Zod schema — no parameters (Zod v3, D-07)
    async () => {
      try {
        const payload = JSON.stringify({
          ok: true,
          server: "metabase-mcp",
          version: "0.1.0",
        });
        return {
          content: [{ type: "text", text: payload }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `server_ping error: ${msg}` }],
        };
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Stdio bootstrap
// ---------------------------------------------------------------------------

/**
 * main() starts the server on stdio transport.
 * Guarded by the import.meta check so it does NOT run when imported by tests.
 *
 * On startup, attempts to validate the API key by calling GET /api/user/current.
 * Logs the authenticated user identity (or any auth failure) to stderr.
 */
async function main(): Promise<void> {
  const server = createServer();

  // Validate API key on startup when env vars are present (T-01-05 mitigation).
  // Auth failure is logged but does NOT prevent the server from starting —
  // the LLM will receive a MetabaseApiError when it attempts a real tool call.
  if (process.env["METABASE_URL"] && process.env["METABASE_API_KEY"]) {
    try {
      const client = new MetabaseClient({});
      const user = await client.getUser();
      console.error(
        `[metabase-mcp] Authenticated as ${user.common_name} <${user.email}> (id=${user.id})`,
      );
    } catch (err) {
      if (err instanceof MetabaseApiError) {
        console.error(
          `[metabase-mcp] WARNING: Metabase auth validation failed — status ${err.status}: ${err.message}`,
        );
        console.error(`[metabase-mcp] Check METABASE_URL and METABASE_API_KEY.`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[metabase-mcp] WARNING: Could not reach Metabase: ${msg}`);
      }
    }
  } else {
    console.error(
      `[metabase-mcp] METABASE_URL or METABASE_API_KEY not set — skipping startup auth check.`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[metabase-mcp] Server running on stdio transport.`);
}

// Run only when this module is the entry point (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("[metabase-mcp] Fatal error:", err);
    process.exit(1);
  });
}
