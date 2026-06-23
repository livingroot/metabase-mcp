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
import type { MetabaseDatabase, MetabaseDatabaseMetadata, MetabaseTableQueryMetadata, MetabaseField, MetabaseFieldValues, MetabaseDatasetResponse, MetabaseCard } from "./types.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Escapes characters that break Markdown table cells: pipes and newlines. */
function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\n\r]/g, " ");
}

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
    `## Database: ${escapeMd(db.name)} (id=${db.id}, engine=${escapeMd(db.engine)})`,
    "",
  ];

  for (const table of db.tables) {
    const rowCount =
      table.estimated_row_count != null
        ? `~${table.estimated_row_count.toLocaleString()} rows`
        : "row count unknown";
    lines.push(
      `### Table: ${escapeMd(table.name)} (id=${table.id}, schema=${escapeMd(table.schema ?? "default")}, ${rowCount})`,
    );
    lines.push("| Column | Display Name | Type | Semantic Type | Required |");
    lines.push("|--------|-------------|------|---------------|---------|");
    for (const field of table.fields) {
      lines.push(
        `| ${escapeMd(field.name)} | ${escapeMd(field.display_name)} | ${escapeMd(field.base_type)} | ${escapeMd(field.semantic_type ?? "—")} | ${field.database_required ? "yes" : "no"} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Formats a MetabaseDatasetResponse as a Markdown table with truncation signals.
 *
 * Truncation detection order (Pitfall 3 — check UNSLICED array first):
 *   1. metabaseCap: allRows.length === 2000 — Metabase's undocumented hard limit.
 *      Emits D-01 Metabase cap warning BEFORE the table.
 *   2. agentCap: allRows.length > maxRows (only when metabaseCap is false).
 *      Emits D-01 agent cap warning BEFORE the table; table shows first maxRows rows.
 *   3. No truncation: appends *(N rows)* footer AFTER the table.
 *
 * D-04: Zero-row input renders header + separator + empty body + *(0 rows)* footer.
 * T-03-03: escapeMd() applied to every column header and cell value.
 */
function formatQueryResult(response: MetabaseDatasetResponse, maxRows: number): string {
  const cols = response.data?.cols ?? [];
  const allRows = response.data?.rows ?? [];

  // Detect Metabase cap on the UNSLICED array (Pitfall 3)
  const metabaseCap = allRows.length === 2000;
  const agentCap = !metabaseCap && allRows.length > maxRows;
  const displayRows = agentCap ? allRows.slice(0, maxRows) : allRows;

  const lines: string[] = [];

  // Truncation notice BEFORE the table (D-02)
  if (metabaseCap) {
    lines.push(
      `⚠ Metabase returned exactly 2,000 rows — its silent limit.\nAdd a SQL LIMIT clause to refine the result set.`,
    );
    lines.push(""); // blank line before table
  } else if (agentCap) {
    lines.push(
      `⚠ Results capped at ${maxRows} rows (your max_rows limit).\nPass max_rows=${allRows.length + 1} to see more.`,
    );
    lines.push(""); // blank line before table
  }

  // Header row and separator
  lines.push(`| ${cols.map((c) => escapeMd(c.display_name)).join(" | ")} |`);
  lines.push(`| ${cols.map(() => "---").join(" | ")} |`);

  // Data rows (D-04: zero rows — loop adds nothing, header/sep still rendered)
  for (const row of displayRows) {
    lines.push(
      `| ${(row as unknown[]).map((v) => escapeMd(v == null ? "" : String(v))).join(" | ")} |`,
    );
  }

  // Row count footer when no truncation (D-03)
  if (!metabaseCap && !agentCap) {
    lines.push("");
    lines.push(`*(${displayRows.length} rows)*`);
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

  server.registerTool(
    "server_ping",
    { description: "Ping the MCP server to verify it is running and reachable." },
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

  server.registerTool(
    "databases_list",
    { description: "List all databases connected to this Metabase instance. Returns ID, name, engine type, and sync status as a Markdown table." },
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
              `| ${db.id} | ${escapeMd(db.name)} | ${escapeMd(db.engine)} | ${db.is_full_sync ? "yes" : "no"} |`,
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

  server.registerTool(
    "databases_get_schema",
    {
      description: "Retrieve the full schema tree for a database: all tables with columns, data types, and display labels. A single call returns the complete DB → tables → fields metadata.",
      inputSchema: { database_id: z.number().int().positive().describe("Metabase database ID") },
    },
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

  server.registerTool(
    "tables_list",
    {
      description: "List all tables in a database. Returns ID, name, schema name, and estimated row count as a flat Markdown table. Does not include column-level detail.",
      inputSchema: { database_id: z.number().int().positive().describe("Metabase database ID") },
    },
    async ({ database_id }) => {
      try {
        const client = new MetabaseClient({});
        const db = await client.getDatabaseMetadata(database_id);
        const header = "| ID | Name | Schema | Est. Rows |\n|----|------|--------|-----------|\n";
        const rows = db.tables
          .map((t) => {
            const rowCount =
              t.estimated_row_count != null
                ? t.estimated_row_count.toLocaleString()
                : "—";
            return `| ${t.id} | ${escapeMd(t.name)} | ${escapeMd(t.schema ?? "default")} | ${rowCount} |`;
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

  server.registerTool(
    "tables_get",
    {
      description: "Retrieve column-level metadata for a specific table: column names, data types, semantic types, display names, and nullable/required flags.",
      inputSchema: { table_id: z.number().int().positive().describe("Metabase table ID") },
    },
    async ({ table_id }) => {
      try {
        const client = new MetabaseClient({});
        const table: MetabaseTableQueryMetadata = await client.getTableQueryMetadata(table_id);
        const rowCount =
          table.estimated_row_count != null
            ? `~${table.estimated_row_count.toLocaleString()} rows`
            : "row count unknown";
        const heading = `## Table: ${escapeMd(table.name)} (id=${table.id}, schema=${escapeMd(table.schema ?? "default")}, ${rowCount})\n`;
        const header =
          "| Column | Display Name | Type | Semantic Type | Required | Visibility |\n" +
          "|--------|--------------|------|---------------|----------|------------|\n";
        const rows = table.fields
          .map(
            (f) =>
              `| ${escapeMd(f.name)} | ${escapeMd(f.display_name)} | ${escapeMd(f.base_type)} | ${escapeMd(f.semantic_type ?? "—")} | ${f.database_required ? "yes" : "no"} | ${escapeMd(f.visibility_type)} |`,
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

  // -------------------------------------------------------------------------
  // Tool: fields_get (SCHEMA-05)
  // -------------------------------------------------------------------------
  // Returns metadata for a single field plus its enumerated valid values when
  // the field is low-cardinality (has_field_values === "list").
  //
  // Two-call pattern (SCHEMA-05 implementation steps 1-3, Pitfall 3):
  //   1. Call getField(field_id) for metadata.
  //   2. If has_field_values === "list", call getFieldValues(field_id) inside
  //      its own try/catch — a failure degrades to a "not available" note rather
  //      than failing the whole tool (Pitfall 3 graceful degradation).
  //   3. For any other has_field_values value (search, none, null): skip the
  //      second call entirely; render a not-applicable marker.
  //
  // Validates field_id with z.number() (T-02-06: path injection prevention).
  // Per-handler MetabaseClient instantiation (Pitfall 4).
  // Optionally logs has_field_values to stderr (A3 from 02-RESEARCH.md).

  server.registerTool(
    "fields_get",
    {
      description: "Retrieve metadata and valid values for a specific field (column): data type, display name, semantic type, and enumerated valid values for low-cardinality fields.",
      inputSchema: { field_id: z.number().int().positive().describe("Metabase field ID") },
    },
    async ({ field_id }) => {
      try {
        const client = new MetabaseClient({});
        const field: MetabaseField = await client.getField(field_id);

        // Log the observed has_field_values sentinel to stderr for debugging (A3).
        console.error(
          `[metabase-mcp] fields_get: field_id=${field_id} has_field_values=${String(field.has_field_values ?? "null")}`,
        );

        const lines: string[] = [
          `**Field:** ${escapeMd(field.name)} (id=${field.id})`,
          `**Display Name:** ${escapeMd(field.display_name)}`,
          `**Type:** ${escapeMd(field.base_type)}`,
          `**Semantic Type:** ${escapeMd(field.semantic_type ?? "—")}`,
          `**Required:** ${field.database_required ? "yes" : "no"}`,
          "",
        ];

        if (field.has_field_values === "list") {
          // Fetch valid values — degrade gracefully on failure (Pitfall 3).
          try {
            const fieldValues: MetabaseFieldValues = await client.getFieldValues(field_id);
            // Flatten inner arrays: [["pending"], ["shipped"]] → "pending, shipped"
            const valueList = fieldValues.values
              .map((innerArr) => escapeMd(String(innerArr[0] ?? "")))
              .filter((v) => v.length > 0)
              .join(", ");
            lines.push("**Valid Values:**");
            lines.push(valueList.length > 0 ? valueList : "(none)");
          } catch (valErr) {
            // Values call failed — return metadata only (graceful degradation).
            const valMsg = valErr instanceof Error ? valErr.message : String(valErr);
            console.error(`[metabase-mcp] fields_get: values call failed — ${valMsg}`);
            lines.push("**Valid Values:** (not available — values fetch failed)");
          }
        } else {
          // High-cardinality or non-enumerable field — skip /values call.
          // has_field_values is "search", "none", or null.
          lines.push("**Valid Values:** N/A (high cardinality or search-type field)");
        }

        const text = lines.join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-02-08: never echo METABASE_API_KEY
        return {
          isError: true,
          content: [{ type: "text", text: `fields_get error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: queries_execute_sql (QUERY-01, QUERY-02, QUERY-05)
  // -------------------------------------------------------------------------
  // Executes raw SQL against a Metabase database and returns results as a
  // Markdown table with truncation-aware messaging.
  //
  // Truncation signals (D-01 from 03-CONTEXT.md):
  //   - Agent cap (max_rows hit): ⚠ Results capped at N rows... (before table)
  //   - Metabase cap (exactly 2000 rows): ⚠ Metabase returned exactly 2,000 rows... (before table)
  //   - No truncation: *(N rows)* footer after table
  //
  // T-03-01: database_id validated with z.number().int().positive()
  // T-03-02: error messages never include METABASE_API_KEY or request URL
  // T-03-03: escapeMd() applied to all column headers and cell values (in formatQueryResult)
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "queries_execute_sql",
    {
      description: "Execute raw SQL against a database and return results as a Markdown table. Defaults to 50 rows; pass max_rows to adjust. Use queries_export for result sets exceeding 2,000 rows.",
      inputSchema: {
        database_id: z.number().int().positive().describe("Metabase database ID"),
        sql: z.string().describe("SQL query to execute"),
        max_rows: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe("Maximum rows to return (default 50)"),
        parameters: z
          .array(
            z.object({
              name: z
                .string()
                .describe("Template tag name matching {{name}} in SQL"),
              value: z.string().describe("Value to bind to this tag"),
              type: z
                .string()
                .optional()
                .describe(
                  "Metabase param type, e.g. 'category', 'date/single', 'number/='. Defaults to 'category'.",
                ),
            }),
          )
          .optional()
          .describe("Filter parameters for {{template_tag}} placeholders in SQL"),
      },
    },
    async ({ database_id, sql, max_rows, parameters }) => {
      try {
        const client = new MetabaseClient({});
        const response = await client.executeSQL(database_id, sql, parameters);
        // Guard for Metabase query failures (bad SQL, missing table, permission denied)
        if (response.status === "failed") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `queries_execute_sql error: Query failed — ${response.error ?? "unknown error"}`,
              },
            ],
          };
        }
        const text = formatQueryResult(response, max_rows);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-03-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `queries_execute_sql error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_execute (QUERY-03)
  // -------------------------------------------------------------------------
  // Runs a saved Metabase question (card) by ID and returns results in the
  // same Markdown format as queries_execute_sql (D-14 from 03-CONTEXT.md).
  //
  // T-03-05: card_id validated with z.number().int().positive() — prevents
  //          string/float/negative values from being interpolated into URL path.
  // T-03-06: missing response.data.cols guard — MBQL cards may return a
  //          different envelope; return a typed isError message instead of throwing.
  // T-03-02: error messages never include METABASE_API_KEY or request URL.
  // D-12: per-handler MetabaseClient instantiation.
  // D-14: NO card-metadata header — output is identical in shape to queries_execute_sql.

  server.registerTool(
    "cards_execute",
    {
      description: "Run a saved Metabase question (card) by ID and return results as a Markdown table. Defaults to 50 rows; pass max_rows to adjust. Only native SQL cards are fully supported.",
      inputSchema: {
        card_id: z.number().int().positive().describe("Metabase saved question (card) ID"),
        max_rows: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe("Maximum rows to return (default 50)"),
        parameters: z
          .array(
            z.object({
              name: z
                .string()
                .describe("Template tag name matching {{name}} in the saved question SQL"),
              value: z.string().describe("Value to bind to this tag"),
              type: z
                .string()
                .optional()
                .describe(
                  "Metabase param type, e.g. 'category', 'date/single', 'number/='. Defaults to 'category'.",
                ),
            }),
          )
          .optional()
          .describe("Filter parameters for {{template_tag}} placeholders in the saved question"),
      },
    },
    async ({ card_id, max_rows, parameters }) => {
      try {
        const client = new MetabaseClient({});
        const response = await client.executeCard(card_id, parameters);
        // T-03-06: Guard for MBQL / unsupported card types where data.cols may be absent
        if (response.data?.cols === undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "cards_execute error: Unsupported card type — only native SQL cards are fully supported.",
              },
            ],
          };
        }
        // Guard for Metabase query failures (bad SQL, missing table, permission denied)
        if (response.status === "failed") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `cards_execute error: Query failed — ${response.error ?? "unknown error"}`,
              },
            ],
          };
        }
        const text = formatQueryResult(response, max_rows);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-03-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `cards_execute error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: queries_export (QUERY-04)
  // -------------------------------------------------------------------------
  // Exports a full query result set as raw CSV text by calling the
  // /api/dataset/csv endpoint, which bypasses Metabase's silent 2,000-row
  // JSON cap that queries_execute_sql hits.
  //
  // No max_rows parameter — CSV export returns the full result set (D-08).
  // Returns raw CSV as a single text content item with no Markdown formatting (D-08).
  //
  // T-03-07: database_id validated with z.number().int().positive()
  // T-03-08: error messages never include METABASE_API_KEY or request URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "queries_export",
    {
      description: "Export a full query result set as raw CSV text via /api/dataset/csv. Bypasses the 2,000-row JSON cap that queries_execute_sql hits. Returns the complete result set with no row limit.",
      inputSchema: {
        database_id: z.number().int().positive().describe("Metabase database ID"),
        sql: z.string().describe("SQL query to export"),
        parameters: z
          .array(
            z.object({
              name: z
                .string()
                .describe("Template tag name matching {{name}} in SQL"),
              value: z.string().describe("Value to bind to this tag"),
              type: z
                .string()
                .optional()
                .describe(
                  "Metabase param type, e.g. 'category', 'date/single', 'number/='. Defaults to 'category'.",
                ),
            }),
          )
          .optional()
          .describe("Filter parameters for {{template_tag}} placeholders in SQL"),
      },
    },
    async ({ database_id, sql, parameters }) => {
      try {
        const client = new MetabaseClient({});
        const csv = await client.exportCSV(database_id, sql, parameters);
        return { content: [{ type: "text", text: csv }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-03-08: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `queries_export error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_list (CARDS-01, CARDS-02)
  // -------------------------------------------------------------------------
  // Lists saved questions with optional name substring filter.
  // Returns a Markdown table with ID, name, description, database ID, creator,
  // and last-updated date.
  //
  // T-04-02: error messages never include METABASE_API_KEY or raw URL
  // T-04-03: encodeURIComponent applied to name_filter in GET /api/card?q=
  // T-04-05: escapeMd() applied to all name/description/creator cells
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "cards_list",
    {
      description: "List saved questions (cards). Optionally filter by name substring. Returns ID, name, description, database ID, creator, and last-updated date as a Markdown table.",
      inputSchema: {
        name_filter: z
          .string()
          .optional()
          .describe("Optional case-insensitive substring to filter card names"),
      },
    },
    async ({ name_filter }) => {
      try {
        const client = new MetabaseClient({});
        const cards = await client.listCards(name_filter);
        const header =
          "| ID | Name | Description | Database ID | Creator | Updated |\n" +
          "|----|------|-------------|-------------|---------|---------|";
        const rows = cards
          .map(
            (c) =>
              `| ${c.id} | ${escapeMd(c.name)} | ${escapeMd(c.description ?? "—")} | ${c.database_id ?? "—"} | ${escapeMd(c.creator?.common_name ?? String(c.creator_id))} | ${escapeMd(c.updated_at)} |`,
          )
          .join("\n");
        const text = rows.length > 0 ? `${header}\n${rows}` : header;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-04-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `cards_list error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_find (CARDS-02b)
  // -------------------------------------------------------------------------
  // Searches saved questions by name substring and returns full SQL for each
  // match. One call replaces cards_list + N×cards_get when the agent needs to
  // locate a card by name and inspect its query.
  // Results capped at 10 to avoid large responses.

  server.registerTool(
    "cards_find",
    {
      description: "Find saved questions by name and return their SQL. Use this when you know (part of) the card name. Returns ID, name, and SQL for each match — no need to call cards_get separately.",
      inputSchema: {
        name: z.string().min(1).describe("Name substring to search for (case-insensitive)"),
      },
    },
    async ({ name }) => {
      try {
        const client = new MetabaseClient({});
        const cards = await client.listCards(name);
        if (cards.length === 0) {
          return { content: [{ type: "text", text: `No cards found matching "${name}".` }] };
        }
        const capped = cards.slice(0, 10);
        const lines: string[] = [
          `Found ${cards.length} card(s) matching "${name}"${cards.length > 10 ? " (showing first 10)" : ""}:`,
          "",
        ];
        for (const item of capped) {
          try {
            const card = await client.getCard(item.id);
            const nativeStage = card.dataset_query.stages?.find(
              (s) => s["lib/type"] === "mbql.stage/native",
            );
            const sql = nativeStage?.native ?? card.dataset_query.native?.query;
            lines.push(`### ${escapeMd(card.name)} (id=${card.id})`);
            if (sql) {
              lines.push("```sql");
              lines.push(sql.replace(/```/g, "\\`\\`\\`"));
              lines.push("```");
            } else {
              lines.push("*(non-native card — SQL not available)*");
            }
            lines.push("");
          } catch {
            lines.push(`### ${escapeMd(item.name)} (id=${item.id})`);
            lines.push("*(could not load details)*");
            lines.push("");
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `cards_find error: ${msg}` }] };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_get (CARDS-03)
  // -------------------------------------------------------------------------
  // Returns the full saved question including its SQL query definition,
  // visualization settings presence, and metadata.
  //
  // T-04-01: card_id validated with z.number().int().positive() — prevents
  //          string/path injection into /api/card/:id
  // T-04-02: error messages never include METABASE_API_KEY or raw URL
  // T-04-05: escapeMd() applied to text metadata fields
  // Pitfall 4: MBQL cards have no native.query — guard with type === "native" check
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "cards_get",
    {
      description: "Retrieve the full saved question including its SQL query definition, visualization settings, and result metadata. Returns SQL in a fenced code block for native SQL cards.",
      inputSchema: {
        card_id: z
          .number()
          .int()
          .positive()
          .describe("Metabase saved question (card) ID"),
      },
    },
    async ({ card_id }) => {
      try {
        const client = new MetabaseClient({});
        const card: MetabaseCard = await client.getCard(card_id);
        const lines: string[] = [
          `## ${escapeMd(card.name)} (id=${card.id})`,
          `**Description:** ${escapeMd(card.description ?? "—")}`,
          `**Database ID:** ${card.database_id ?? "—"}`,
          `**Updated:** ${escapeMd(card.updated_at)}`,
          "",
        ];

        // SQL extraction — support both legacy format (dataset_query.type === "native")
        // and Metabase v0.59+ pMBQL format (stages[i]["lib/type"] === "mbql.stage/native")
        const nativeStage = card.dataset_query.stages?.find(
          (s) => s["lib/type"] === "mbql.stage/native",
        );
        const isNative =
          card.dataset_query.type === "native" || nativeStage !== undefined;

        if (isNative) {
          // v0.59+ pMBQL: SQL is stages[i].native (string); legacy: native.query
          const sql =
            nativeStage?.native ??
            card.dataset_query.native?.query ??
            "(empty)";
          // Escape triple-backtick sequences so they cannot break the fenced block
          const safeSql = sql.replace(/```/g, "\\`\\`\\`");
          lines.push("**Query (SQL):**");
          lines.push("```sql");
          lines.push(safeSql);
          lines.push("```");
        } else {
          const queryType = card.dataset_query.type ?? card.dataset_query["lib/type"] ?? "unknown";
          lines.push(
            `(Non-native card — dataset_query type: ${escapeMd(queryType)}. SQL not available; this server creates only native SQL cards.)`,
          );
        }

        const text = lines.join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-04-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `cards_get error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_create (CARDS-04)
  // -------------------------------------------------------------------------
  // Creates a native SQL saved question in Metabase and returns the new card ID.
  //
  // T-04-01: database_id validated with z.number().int().positive() — prevents
  //          string/path injection into the POST body
  // T-04-02: error messages never include METABASE_API_KEY or raw URL
  // T-04-08: createCard sends only defined fields — never null
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "cards_create",
    {
      description: "Create a native SQL saved question in Metabase from a database ID, SQL query, and display name. Returns the new card ID.",
      inputSchema: {
        database_id: z
          .number()
          .int()
          .positive()
          .describe("Metabase database ID the SQL runs against"),
        sql: z.string().min(1).describe("Native SQL query body"),
        name: z.string().min(1).describe("Display name for the saved question"),
        description: z.string().optional().describe("Optional description"),
        tag_types: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Override the Metabase type for specific {{template_tag}} variables. Map of tag name to type: 'text' | 'date' | 'number' | 'dimension'. Example: {\"start_date\": \"date\", \"amount\": \"number\"}",
          ),
      },
    },
    async ({ database_id, sql, name, description, tag_types }) => {
      try {
        const client = new MetabaseClient({});
        const created = await client.createCard(database_id, sql, name, description, tag_types);
        return {
          content: [{ type: "text", text: `Card created successfully. Card ID: ${created.id}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-04-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `cards_create error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_update (CARDS-05)
  // -------------------------------------------------------------------------
  // Updates a card's name, description, or SQL. Only provided fields are sent
  // in the PUT body — undefined fields are never sent (T-04-08).
  //
  // When updating SQL, database_id is required because Metabase's PUT /api/card/:id
  // requires a complete dataset_query envelope when changing the query (Pitfall 3).
  //
  // T-04-01: card_id validated with z.number().int().positive()
  // T-04-02: error messages never include METABASE_API_KEY or raw URL
  // T-04-08: updateCard only includes keys whose value is defined; never sends null
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "cards_update",
    {
      description: "Update a saved question's name, description, or SQL. Only the provided fields are changed. Requires database_id when updating sql. Pass ref_card_id to copy template-tag types from another card (fixes broken filter types).",
      inputSchema: {
        card_id: z
          .number()
          .int()
          .positive()
          .describe("Card ID to update"),
        name: z.string().min(1).optional().describe("New display name"),
        description: z.string().optional().describe("New description"),
        sql: z.string().min(1).optional().describe("New SQL query body"),
        database_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Required when updating sql — the database the SQL runs against"),
        ref_card_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Card ID to copy template-tag types from. Use this to restore broken filter types by providing a reference card with correct types."),
        tag_types: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Override the Metabase type for specific {{template_tag}} variables when updating SQL. Map of tag name to type: 'text' | 'date' | 'number' | 'dimension'. Takes priority over source-card types. Example: {\"start_date\": \"date\"}",
          ),
        display: z
          .string()
          .optional()
          .describe(
            "Visualization type: 'table' | 'line' | 'bar' | 'area' | 'pie' | 'scalar' | 'row' | 'combo'. Example: 'bar'",
          ),
        visualization_settings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Visualization settings object. For bar/line charts use graph.dimensions and graph.metrics to set axes. Example: {\"graph.dimensions\": [\"День\"], \"graph.metrics\": [\"Общая сумма\"]}",
          ),
      },
    },
    async ({ card_id, name, description, sql, database_id, ref_card_id, tag_types, display, visualization_settings }) => {
      // Pitfall 3: dataset_query.database is mandatory when changing SQL
      if (sql !== undefined && database_id === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "cards_update error: database_id is required when updating sql",
            },
          ],
        };
      }
      try {
        const client = new MetabaseClient({});
        await client.updateCard(card_id, { name, description, sql, databaseId: database_id, refCardId: ref_card_id, tagTypes: tag_types, display, visualizationSettings: visualization_settings });
        return {
          content: [{ type: "text", text: "Card updated successfully." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-04-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `cards_update error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: cards_delete (CARDS-06)
  // -------------------------------------------------------------------------
  // Deletes a saved question by ID. Uses the v0.59 DELETE /api/card/:id endpoint
  // (hard delete — card is removed permanently).
  //
  // T-04-01: card_id validated with z.number().int().positive() — prevents
  //          string/path injection into the DELETE /api/card/:id URL path
  // T-04-02: error messages never include METABASE_API_KEY or raw URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "cards_delete",
    {
      description: "Delete a saved question by ID. Permanently removes the card from Metabase.",
      inputSchema: {
        card_id: z
          .number()
          .int()
          .positive()
          .describe("Card ID to delete"),
      },
    },
    async ({ card_id }) => {
      try {
        const client = new MetabaseClient({});
        await client.deleteCard(card_id);
        return {
          content: [{ type: "text", text: "Card deleted successfully." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-04-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `cards_delete error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_list (DASH-01, DASH-02)
  // -------------------------------------------------------------------------
  // Lists dashboards with optional name substring filter (client-side only —
  // GET /api/dashboard has no ?q= param unlike GET /api/card).
  // Returns a Markdown table with ID, name, description, card count, updated date.
  //
  // Card count computed defensively: (d.dashcards ?? d.ordered_cards ?? []).length
  // (Pitfall 6 — list items may carry dashcards OR ordered_cards or neither).
  //
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // T-5-05: escapeMd() applied to all name/description cells
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_list",
    {
      description: "List dashboards. Optionally filter by name substring. Returns ID, name, description, card count, and last-updated date as a Markdown table.",
      inputSchema: {
        name_filter: z
          .string()
          .optional()
          .describe("Optional case-insensitive substring to filter dashboard names"),
      },
    },
    async ({ name_filter }) => {
      try {
        const client = new MetabaseClient({});
        const dashboards = await client.listDashboards(name_filter);
        const header =
          "| ID | Name | Description | Cards | Updated |\n" +
          "|----|------|-------------|-------|---------|";
        const rows = dashboards
          .map((d) => {
            // Pitfall 6: list items may carry dashcards OR ordered_cards or neither
            const cards = (d.dashcards ?? d.ordered_cards ?? []).length;
            return `| ${d.id} | ${escapeMd(d.name)} | ${escapeMd(d.description ?? "—")} | ${cards} | ${escapeMd(d.updated_at)} |`;
          })
          .join("\n");
        const text = rows.length > 0 ? `${header}\n${rows}` : header;
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_list error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_get (DASH-03)
  // -------------------------------------------------------------------------
  // Returns full dashboard details: name, description, filter parameter
  // definitions, and all placed cards with positions and two-tier IDs.
  //
  // The "Dashcard ID" column is the placement id the agent must use for
  // remove/update/connect operations (Pitfall 1 — two-tier ID model).
  //
  // T-5-path: dashboard_id validated with z.number().int().positive() — prevents
  //           string/path injection into /api/dashboard/:id
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // T-5-05: escapeMd() applied to all name/description/parameter cells
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_get",
    {
      description: "Retrieve full dashboard details: name, description, filter parameter definitions, and all placed cards with their positions, sizes, and dashcard IDs.",
      inputSchema: {
        dashboard_id: z
          .number()
          .int()
          .positive()
          .describe("Metabase dashboard ID"),
      },
    },
    async ({ dashboard_id }) => {
      try {
        const client = new MetabaseClient({});
        const dashboard = await client.getDashboard(dashboard_id);

        const lines: string[] = [
          `## ${escapeMd(dashboard.name)} (id=${dashboard.id})`,
          `**Description:** ${escapeMd(dashboard.description ?? "—")}`,
          `**Updated:** ${escapeMd(dashboard.updated_at)}`,
          "",
          "### Filter Parameters",
        ];

        if (dashboard.parameters.length === 0) {
          lines.push("(none)");
        } else {
          lines.push("| Parameter ID | Name | Type | Slug |");
          lines.push("|-------------|------|------|------|");
          for (const p of dashboard.parameters) {
            lines.push(
              `| ${escapeMd(p.id)} | ${escapeMd(p.name)} | ${escapeMd(p.type)} | ${escapeMd(p.slug)} |`,
            );
          }
        }

        lines.push("");
        lines.push("### Cards");

        if (dashboard.dashcards.length === 0) {
          lines.push("(none)");
        } else {
          // "Dashcard ID" = placement id; "Card ID" = saved question id (Pitfall 1)
          lines.push("| Dashcard ID | Card ID | Row | Col | Width | Height |");
          lines.push("|------------|---------|-----|-----|-------|--------|");
          for (const dc of dashboard.dashcards) {
            lines.push(
              `| ${dc.id} | ${dc.card_id} | ${dc.row} | ${dc.col} | ${dc.size_x} | ${dc.size_y} |`,
            );
          }
        }

        const text = lines.join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_get error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_create (DASH-04)
  // -------------------------------------------------------------------------
  // Creates a new empty dashboard and returns the new dashboard ID.
  // parameters:[] (empty array) is always sent — never parameters:null
  // (null causes Metabase validation errors — Anti-Pattern).
  //
  // T-5-val: name validated with z.string().min(1) — rejects empty/missing name
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_create",
    {
      description: "Create a new empty dashboard. Requires a name; description is optional. Returns the new dashboard ID.",
      inputSchema: {
        name: z.string().min(1).describe("Display name for the dashboard"),
        description: z.string().optional().describe("Optional dashboard description"),
      },
    },
    async ({ name, description }) => {
      try {
        const client = new MetabaseClient({});
        const created = await client.createDashboard(name, description);
        return {
          content: [{ type: "text", text: `Dashboard created successfully. Dashboard ID: ${created.id}` }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_create error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_update (DASH-05)
  // -------------------------------------------------------------------------
  // Renames a dashboard or changes its description. Only provided fields are
  // sent in the PUT body — undefined fields are never sent (T-5-null).
  //
  // Note: parameters management is handled by dashboards_add_filter in Plan 03;
  // this tool covers DASH-05 rename/description only.
  //
  // T-5-path: dashboard_id validated with z.number().int().positive() — prevents
  //           string/path injection into /api/dashboard/:id
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // T-5-null: updateDashboard only sends keys whose value is defined; never null
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_update",
    {
      description: "Rename a dashboard or change its description. Only the provided fields are changed.",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID to update"),
        name: z.string().min(1).optional().describe("New display name"),
        description: z.string().optional().describe("New description"),
      },
    },
    async ({ dashboard_id, name, description }) => {
      try {
        const client = new MetabaseClient({});
        await client.updateDashboard(dashboard_id, { name, description });
        return {
          content: [{ type: "text", text: "Dashboard updated successfully." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_update error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_delete (DASH-06)
  // -------------------------------------------------------------------------
  // Deletes a dashboard by ID. Uses the v0.59 DELETE /api/dashboard/:id endpoint
  // (hard delete — dashboard is removed permanently). The soft-delete alternative
  // PUT /api/dashboard/:id {archived:true} is equally valid for DASH-06 purposes
  // since archived dashboards are excluded from the default GET /api/dashboard list.
  //
  // T-5-path: dashboard_id validated with z.number().int().positive() — prevents
  //           string/path injection into the DELETE URL path
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_delete",
    {
      description: "Delete a dashboard by ID. Permanently removes the dashboard from Metabase.",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID to delete"),
      },
    },
    async ({ dashboard_id }) => {
      try {
        const client = new MetabaseClient({});
        await client.deleteDashboard(dashboard_id);
        return {
          content: [{ type: "text", text: "Dashboard deleted successfully." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_delete error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_add_card (DASH-07)
  // -------------------------------------------------------------------------
  // Adds an existing saved question (card) to a dashboard at an optional grid
  // position. Returns the dashcard placement ID — agents must store this value;
  // it is required for remove/reposition/connect-filter operations and is
  // distinct from the saved question's card_id (Pitfall 1 — two-tier IDs).
  //
  // Under the hood: POST /api/dashboard/:id/cards with camelCase cardId in body
  // (Pitfall 3), then PUT /api/dashboard/:id/cards to set the grid position.
  //
  // T-5-path: dashboard_id / card_id validated with z.number().int().positive()
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_add_card",
    {
      description: "Add an existing saved question to a dashboard at an optional grid position. Returns the dashcard ID — capture it; it is the placement ID needed for remove/reposition/filter-connect operations (it is NOT the card ID).",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID"),
        card_id: z.number().int().positive().describe("Saved question (card) ID to place"),
        row: z.number().int().min(0).optional().describe("Row position, 0-indexed (default 0)"),
        col: z.number().int().min(0).optional().describe("Column position, 0-indexed (default 0)"),
        size_x: z.number().int().min(1).max(24).optional().describe("Width in grid units (default 12)"),
        size_y: z.number().int().min(1).optional().describe("Height in grid units (default 8)"),
      },
    },
    async ({ dashboard_id, card_id, row, col, size_x, size_y }) => {
      try {
        const client = new MetabaseClient({});
        const dashcard = await client.addDashboardCard(dashboard_id, card_id, {
          row: row ?? 0,
          col: col ?? 0,
          size_x: size_x ?? 12,
          size_y: size_y ?? 8,
        });
        return {
          content: [
            {
              type: "text",
              text: `Card added to dashboard. Dashcard ID: ${dashcard.id} (use this dashcard_id — not the card_id — for remove/reposition/connect-filter).`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_add_card error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_remove_card (DASH-08)
  // -------------------------------------------------------------------------
  // Removes a single card from a dashboard using its dashcard placement ID
  // (the id returned by dashboards_add_card or shown by dashboards_get).
  //
  // IMPORTANT: dashcard_id is the placement id, NOT the saved question's card_id
  // (Pitfall 1 — two-tier IDs). Using card_id here will 404 or remove the wrong card.
  //
  // Under the hood: DELETE /api/dashboard/:id/cards?dashcardId=<dashcard_id>
  //
  // T-5-path: dashboard_id / dashcard_id validated with z.number().int().positive()
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_remove_card",
    {
      description: "Remove a single card from a dashboard using its dashcard placement ID (the ID returned by dashboards_add_card or shown in dashboards_get — NOT the card ID).",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID"),
        dashcard_id: z.number().int().positive().describe("Dashcard placement ID to remove (NOT the card_id)"),
      },
    },
    async ({ dashboard_id, dashcard_id }) => {
      try {
        const client = new MetabaseClient({});
        await client.removeDashboardCard(dashboard_id, dashcard_id);
        return {
          content: [{ type: "text", text: "Card removed from dashboard." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_remove_card error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_update_card (DASH-09)
  // -------------------------------------------------------------------------
  // Repositions or resizes a single card on a dashboard by its dashcard placement
  // ID. Other cards on the dashboard are preserved (read-modify-write pattern).
  //
  // Read-modify-write (Pitfall 2):
  //   1. GET /api/dashboard/:id — fetch current dashcards array
  //   2. Modify the target dashcard's position fields
  //   3. PUT /api/dashboard/:id/cards — send ALL dashcards (omitting one removes it)
  //
  // T-5-path: dashboard_id / dashcard_id validated with z.number().int().positive()
  // T-5-rmw: preservation test asserts PUT body.cards includes all existing dashcards
  // T-5-02: error messages never include METABASE_API_KEY or raw URL
  // D-12: per-handler MetabaseClient instantiation

  server.registerTool(
    "dashboards_update_card",
    {
      description: "Reposition or resize a card on a dashboard. Identified by its dashcard placement ID. Other cards on the dashboard are preserved.",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID"),
        dashcard_id: z.number().int().positive().describe("Dashcard placement ID to reposition/resize (NOT the card_id)"),
        row: z.number().int().min(0).optional().describe("New row position"),
        col: z.number().int().min(0).optional().describe("New column position"),
        size_x: z.number().int().min(1).max(24).optional().describe("New width in grid units"),
        size_y: z.number().int().min(1).optional().describe("New height in grid units"),
      },
    },
    async ({ dashboard_id, dashcard_id, row, col, size_x, size_y }) => {
      try {
        const client = new MetabaseClient({});
        // Step 1: fetch current dashboard state (read-modify-write — Pitfall 2)
        const dashboard = await client.getDashboard(dashboard_id);
        // Step 2: locate the target dashcard
        const target = dashboard.dashcards.find((dc) => dc.id === dashcard_id);
        if (!target) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `dashboards_update_card error: dashcard ${dashcard_id} not found on dashboard ${dashboard_id}`,
              },
            ],
          };
        }
        // Step 3: build the FULL cards array — every dashcard must be included
        // (omitting any dashcard removes it from the dashboard — Pitfall 2)
        const fullCardsArray = dashboard.dashcards.map((dc) => ({
          id: dc.id,
          card_id: dc.card_id,
          row: dc.id === dashcard_id ? (row ?? dc.row) : dc.row,
          col: dc.id === dashcard_id ? (col ?? dc.col) : dc.col,
          size_x: dc.id === dashcard_id ? (size_x ?? dc.size_x) : dc.size_x,
          size_y: dc.id === dashcard_id ? (size_y ?? dc.size_y) : dc.size_y,
          parameter_mappings: dc.parameter_mappings ?? [],
          dashboard_tab_id: dc.dashboard_tab_id ?? null,
        }));
        // Step 4: PUT full replacement — preserve tabs (ordered_tabs must include current tabs)
        await client.updateDashboardCards(dashboard_id, fullCardsArray, dashboard.tabs ?? []);
        return {
          content: [{ type: "text", text: "Card repositioned." }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // T-5-02: never echo METABASE_API_KEY or raw request URL
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_update_card error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_add_filter (DASH-10)
  // -------------------------------------------------------------------------

  server.registerTool(
    "dashboards_add_filter",
    {
      description: "Add a filter parameter to a dashboard. Provide a unique parameter_id string; reuse the same parameter_id in dashboards_connect_filter to wire it to a card.",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID"),
        parameter_id: z
          .string()
          .min(1)
          .describe(
            "Unique string ID for this parameter (reuse it verbatim in dashboards_connect_filter)",
          ),
        name: z.string().min(1).describe("Display name for the filter, e.g. 'Status'"),
        type: z
          .enum([
            "category",
            "id",
            "date/single",
            "date/range",
            "date/relative",
            "date/month-year",
            "date/quarter-year",
            "date/all-options",
            "number/=",
            "number/!=",
            "number/between",
            "number/>=",
            "number/<=",
            "string/=",
            "string/!=",
            "string/contains",
            "string/does-not-contain",
            "string/starts-with",
            "string/ends-with",
            "location/city",
            "location/state",
            "location/zip_code",
            "location/country",
          ])
          .describe("Filter type"),
      },
    },
    async ({ dashboard_id, parameter_id, name, type }) => {
      try {
        const client = new MetabaseClient({});
        // Step 1: fetch current dashboard state (read-modify-write pattern)
        const dashboard = await client.getDashboard(dashboard_id);
        // Step 2: build the new parameter
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const newParam = { id: parameter_id, name, type, slug };
        // Step 3: PUT with existing parameters preserved + new parameter appended.
        // Send tabs too — Metabase v0.59 may wipe them if omitted from the PUT body.
        await client.updateDashboard(dashboard_id, {
          parameters: [...dashboard.parameters, newParam],
          tabs: dashboard.tabs,
        });
        return {
          content: [
            {
              type: "text",
              text: `Filter '${name}' added (parameter_id=${parameter_id}). Use dashboards_connect_filter with this parameter_id to wire it to a card.`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_add_filter error: ${msg}` }],
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // Tool: dashboards_connect_filter (DASH-11)
  // -------------------------------------------------------------------------

  server.registerTool(
    "dashboards_connect_filter",
    {
      description: "Wire a dashboard filter parameter to a native SQL card's template tag so the filter affects that card's results. The parameter_id must match one added via dashboards_add_filter; tag_name is the {{tag_name}} variable in the card's SQL.",
      inputSchema: {
        dashboard_id: z.number().int().positive().describe("Dashboard ID"),
        dashcard_id: z
          .number()
          .int()
          .positive()
          .describe("Dashcard placement ID of the card to wire (NOT the card_id)"),
        parameter_id: z
          .string()
          .min(1)
          .describe(
            "The dashboard parameter_id to connect (must match one from dashboards_add_filter)",
          ),
        tag_name: z
          .string()
          .min(1)
          .describe(
            "The SQL template-tag variable name (the {{tag_name}} in the card's native SQL)",
          ),
      },
    },
    async ({ dashboard_id, dashcard_id, parameter_id, tag_name }) => {
      try {
        const client = new MetabaseClient({});
        // Step 1: fetch current dashboard state (read-modify-write pattern)
        const dashboard = await client.getDashboard(dashboard_id);
        // Step 2: verify the parameter_id exists (Pitfall 4 — fail loudly instead of silent no-op)
        if (!dashboard.parameters.some((p) => p.id === parameter_id)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `dashboards_connect_filter error: parameter_id '${parameter_id}' not found on dashboard ${dashboard_id} — add it first with dashboards_add_filter`,
              },
            ],
          };
        }
        // Step 3: locate the target dashcard
        const target = dashboard.dashcards.find((dc) => dc.id === dashcard_id);
        if (!target) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `dashboards_connect_filter error: dashcard ${dashcard_id} not found on dashboard ${dashboard_id}`,
              },
            ],
          };
        }
        // Step 4: build the FULL cards array preserving ALL dashcards (Pitfall 2)
        const fullCardsArray = dashboard.dashcards.map((dc) => {
          if (dc.id === dashcard_id) {
            // Add the new parameter_mapping to this dashcard (native SQL target format — Pitfall 5)
            return {
              id: dc.id,
              card_id: dc.card_id,
              row: dc.row,
              col: dc.col,
              size_x: dc.size_x,
              size_y: dc.size_y,
              parameter_mappings: [
                ...(target.parameter_mappings ?? []),
                {
                  parameter_id,
                  card_id: target.card_id,
                  target: ["variable", ["template-tag", tag_name]],
                },
              ],
              dashboard_tab_id: dc.dashboard_tab_id ?? null,
            };
          }
          // Preserve every other dashcard with its existing parameter_mappings
          return {
            id: dc.id,
            card_id: dc.card_id,
            row: dc.row,
            col: dc.col,
            size_x: dc.size_x,
            size_y: dc.size_y,
            parameter_mappings: dc.parameter_mappings ?? [],
            dashboard_tab_id: dc.dashboard_tab_id ?? null,
          };
        });
        // Step 5: PUT the full cards array — preserve tabs (ordered_tabs must include current tabs)
        await client.updateDashboardCards(dashboard_id, fullCardsArray, dashboard.tabs ?? []);
        return {
          content: [
            {
              type: "text",
              text: `Filter '${parameter_id}' connected to dashcard ${dashcard_id} via template tag '${tag_name}'.`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `dashboards_connect_filter error: ${msg}` }],
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
