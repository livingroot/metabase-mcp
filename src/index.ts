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

  server.tool(
    "databases_get_schema",
    "Retrieve the full schema tree for a database: all tables with columns, data types, and display labels. A single call returns the complete DB → tables → fields metadata.",
    { database_id: z.number().int().positive().describe("Metabase database ID") },
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
    { database_id: z.number().int().positive().describe("Metabase database ID") },
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

  server.tool(
    "tables_get",
    "Retrieve column-level metadata for a specific table: column names, data types, semantic types, display names, and nullable/required flags.",
    { table_id: z.number().int().positive().describe("Metabase table ID") },
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

  server.tool(
    "fields_get",
    "Retrieve metadata and valid values for a specific field (column): data type, display name, semantic type, and enumerated valid values for low-cardinality fields.",
    { field_id: z.number().int().positive().describe("Metabase field ID") },
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

  server.tool(
    "queries_execute_sql",
    "Execute raw SQL against a database and return results as a Markdown table. Defaults to 50 rows; pass max_rows to adjust. Use queries_export for result sets exceeding 2,000 rows.",
    {
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

  server.tool(
    "cards_execute",
    "Run a saved Metabase question (card) by ID and return results as a Markdown table. Defaults to 50 rows; pass max_rows to adjust. Only native SQL cards are fully supported.",
    {
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

  server.tool(
    "queries_export",
    "Export a full query result set as raw CSV text via /api/dataset/csv. Bypasses the 2,000-row JSON cap that queries_execute_sql hits. Returns the complete result set with no row limit.",
    {
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

  server.tool(
    "cards_list",
    "List saved questions (cards). Optionally filter by name substring. Returns ID, name, description, database ID, creator, and last-updated date as a Markdown table.",
    {
      name_filter: z
        .string()
        .optional()
        .describe("Optional case-insensitive substring to filter card names"),
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

  server.tool(
    "cards_get",
    "Retrieve the full saved question including its SQL query definition, visualization settings, and result metadata. Returns SQL in a fenced code block for native SQL cards.",
    {
      card_id: z
        .number()
        .int()
        .positive()
        .describe("Metabase saved question (card) ID"),
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

        // SQL extraction — guard for MBQL cards (Pitfall 4)
        if (card.dataset_query.type === "native") {
          const sql = card.dataset_query.native?.query ?? "(empty)";
          // Escape triple-backtick sequences so they cannot break the fenced block
          const safeSql = sql.replace(/```/g, "\\`\\`\\`");
          lines.push("**Query (SQL):**");
          lines.push("```sql");
          lines.push(safeSql);
          lines.push("```");
        } else {
          lines.push(
            `(Non-native card — dataset_query type: ${escapeMd(card.dataset_query.type)}. SQL not available; this server creates only native SQL cards.)`,
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

  server.tool(
    "cards_create",
    "Create a native SQL saved question in Metabase from a database ID, SQL query, and display name. Returns the new card ID.",
    {
      database_id: z
        .number()
        .int()
        .positive()
        .describe("Metabase database ID the SQL runs against"),
      sql: z.string().min(1).describe("Native SQL query body"),
      name: z.string().min(1).describe("Display name for the saved question"),
      description: z.string().optional().describe("Optional description"),
    },
    async ({ database_id, sql, name, description }) => {
      try {
        const client = new MetabaseClient({});
        const created = await client.createCard(database_id, sql, name, description);
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

  server.tool(
    "cards_update",
    "Update a saved question's name, description, or SQL. Only the provided fields are changed. Requires database_id when updating sql.",
    {
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
    },
    async ({ card_id, name, description, sql, database_id }) => {
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
        await client.updateCard(card_id, { name, description, sql, databaseId: database_id });
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

  server.tool(
    "cards_delete",
    "Delete a saved question by ID. Permanently removes the card from Metabase.",
    {
      card_id: z
        .number()
        .int()
        .positive()
        .describe("Card ID to delete"),
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
