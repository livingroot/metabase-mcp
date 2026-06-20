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
import { z } from "zod";
import { MetabaseClient, MetabaseApiError } from "./client.js";
import type { MetabaseDatabase, MetabaseDatabaseMetadata, MetabaseTableQueryMetadata } from "./types.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats a MetabaseDatabaseMetadata object as a hierarchical Markdown string.
 *
 * Output structure:
 *   ## Database: {name} (id={id}, engine={engine})
 *
 *   ### Table: {name} (id={id}, schema={schema}, ~N rows)
 *   | Column | Display Name | Type | Semantic Type | Required |
 *   |--------|-------------|------|---------------|---------|
 *   | col    | Col          | type/X | type/PK     | yes     |
 *
 * null estimated_row_count is rendered as "row count unknown" (Pitfall 2).
 * Simple template-literal joins — no padding library (Don't Hand-Roll).
 */
function formatDatabaseSchema(db: MetabaseDatabaseMetadata): string {
  const lines: string[] = [
    `## Database: ${db.name} (id=${db.id}, engine=${db.engine})`,
    "",
  ];

  for (const table of db.tables) {
    const rowCount =
      table.estimated_row_count != null
        ? `~${table.estimated_row_count.toLocaleString()} rows`
        : "row count unknown";
    lines.push(
      `### Table: ${table.name} (id=${table.id}, schema=${table.schema ?? "default"}, ${rowCount})`,
    );
    lines.push("| Column | Display Name | Type | Semantic Type | Required |");
    lines.push("|--------|-------------|------|---------------|---------|");
    for (const field of table.fields) {
      lines.push(
        `| ${field.name} | ${field.display_name} | ${field.base_type} | ${field.semantic_type ?? "—"} | ${field.database_required ? "yes" : "no"} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

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

  // -------------------------------------------------------------------------
  // Tool: databases_list (SCHEMA-01)
  // -------------------------------------------------------------------------
  // Lists all databases connected to this Metabase instance.
  // Handles both plain-array and { data: [] } envelope response shapes (Pitfall 1).
  // Per-handler MetabaseClient instantiation (Pitfall 4): env vars read at call time.

  server.tool(
    "databases_list",
    "List all databases connected to this Metabase instance. Returns ID, name, engine type, and sync status as a Markdown table.",
    {}, // no parameters
    async () => {
      try {
        const client = new MetabaseClient({});
        const result = await client.listDatabases();
        // Normalise both response shapes: bare array or { data: MetabaseDatabase[] } envelope
        const dbs: MetabaseDatabase[] = Array.isArray(result)
          ? (result as MetabaseDatabase[])
          : ((result as { data: MetabaseDatabase[] }).data ?? []);

        const header = "| ID | Name | Engine | Full Sync |\n|----|------|--------|-----------|";
        const rows = dbs
          .map(
            (db) =>
              `| ${db.id} | ${db.name} | ${db.engine} | ${db.is_full_sync ? "yes" : "no"} |`,
          )
          .join("\n");
        const text = rows.length > 0 ? `${header}\n${rows}` : `${header}`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `databases_list error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: databases_get_schema (SCHEMA-02)
  // -------------------------------------------------------------------------
  // Returns the full DB → tables → fields schema tree for a database.
  // Validates database_id with z.number() (T-02-01: path injection prevention).
  // Renders null estimated_row_count as "row count unknown" (Pitfall 2).
  // Per-handler MetabaseClient instantiation (Pitfall 4).

  server.tool(
    "databases_get_schema",
    "Retrieve the full schema tree for a database: all tables with columns, data types, and display labels. A single call returns the complete DB → tables → fields metadata.",
    { database_id: z.number().describe("Metabase database ID") },
    async ({ database_id }) => {
      try {
        const client = new MetabaseClient({});
        const db = await client.getDatabaseMetadata(database_id);
        const text = formatDatabaseSchema(db);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-02-02: never echo METABASE_API_KEY or full request URL
        return {
          isError: true,
          content: [{ type: "text", text: `databases_get_schema error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: tables_list (SCHEMA-03)
  // -------------------------------------------------------------------------
  // Lists all tables in a database as a flat Markdown table.
  // Reuses getDatabaseMetadata — no N+1 calls, no per-table GET /api/table.
  // Renders only table-level summary: ID, Name, Schema, Est. Rows.
  // null estimated_row_count → "—" (Pitfall 2, T-02-SC).
  // Validates database_id with z.number() (T-02-04: path injection prevention).
  // Per-handler MetabaseClient instantiation (Pitfall 4).

  server.tool(
    "tables_list",
    "List all tables in a database. Returns ID, name, schema name, and estimated row count as a flat Markdown table. Does not include column-level detail.",
    { database_id: z.number().describe("Metabase database ID") },
    async ({ database_id }) => {
      try {
        const client = new MetabaseClient({});
        const db = await client.getDatabaseMetadata(database_id);
        const header = "| ID | Name | Schema | Est. Rows |\n|----|------|--------|-----------|\n";
        const rows = db.tables
          .map((t) => {
            const rows =
              t.estimated_row_count != null
                ? t.estimated_row_count.toLocaleString()
                : "—";
            return `| ${t.id} | ${t.name} | ${t.schema ?? "default"} | ${rows} |`;
          })
          .join("\n");
        const text = rows.length > 0 ? `${header}${rows}` : header;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-02-05: never echo METABASE_API_KEY
        return {
          isError: true,
          content: [{ type: "text", text: `tables_list error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: tables_get (SCHEMA-04)
  // -------------------------------------------------------------------------
  // Returns column-level metadata for a single table.
  // Calls GET /api/table/:id/query_metadata via getTableQueryMetadata.
  // Renders a Markdown table: Column, Display Name, Type, Semantic Type, Required, Visibility.
  // database_required → Required column (NOT NULL proxy; true → "yes", false → "no").
  // null estimated_row_count → "—" in the table heading (Pitfall 2).
  // Validates table_id with z.number() (T-02-04: path injection prevention).
  // Per-handler MetabaseClient instantiation (Pitfall 4).

  server.tool(
    "tables_get",
    "Retrieve column-level metadata for a specific table: column names, data types, semantic types, display names, and nullable/required flags.",
    { table_id: z.number().describe("Metabase table ID") },
    async ({ table_id }) => {
      try {
        const client = new MetabaseClient({});
        const table: MetabaseTableQueryMetadata = await client.getTableQueryMetadata(table_id);
        const rowCount =
          table.estimated_row_count != null
            ? `~${table.estimated_row_count.toLocaleString()} rows`
            : "row count unknown";
        const heading = `## Table: ${table.name} (id=${table.id}, schema=${table.schema ?? "default"}, ${rowCount})\n`;
        const header =
          "| Column | Display Name | Type | Semantic Type | Required | Visibility |\n" +
          "|--------|--------------|------|---------------|----------|------------|\n";
        const rows = table.fields
          .map(
            (f) =>
              `| ${f.name} | ${f.display_name} | ${f.base_type} | ${f.semantic_type ?? "—"} | ${f.database_required ? "yes" : "no"} | ${f.visibility_type} |`,
          )
          .join("\n");
        const text = `${heading}${header}${rows}`;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-02-05: never echo METABASE_API_KEY
        return {
          isError: true,
          content: [{ type: "text", text: `tables_get error: ${msg}` }],
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
