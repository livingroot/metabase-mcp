/**
 * query.tools.test.ts
 *
 * Wave-0 failing test scaffold for all Phase 3 query tools:
 *   - queries_execute_sql (Plan 01 — goes GREEN in Task 3)
 *   - cards_execute       (Plan 02 — RED until Plan 02 implements it)
 *   - queries_export      (Plan 03 — RED until Plan 03 implements it)
 *
 * Uses the same InMemoryTransport + makeFetchMock pattern as test/schema.tools.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SEED_DATASET_2ROWS = {
  data: {
    cols: [
      { name: "id", display_name: "ID" },
      { name: "status", display_name: "Status" },
    ],
    rows: [
      [1, "shipped"],
      [2, "pending"],
    ],
  },
  row_count: 2,
  status: "completed",
};

const SEED_DATASET_0ROWS = {
  data: {
    cols: [
      { name: "id", display_name: "ID" },
      { name: "status", display_name: "Status" },
    ],
    rows: [],
  },
  row_count: 0,
  status: "completed",
};

const SEED_DATASET_2000ROWS = {
  data: {
    cols: [
      { name: "id", display_name: "ID" },
      { name: "val", display_name: "Val" },
    ],
    rows: Array.from({ length: 2000 }, (_, i) => [i, "x"]),
  },
  row_count: 2000,
  status: "completed",
};

const SEED_DATASET_5ROWS = {
  data: {
    cols: [
      { name: "id", display_name: "ID" },
      { name: "status", display_name: "Status" },
    ],
    rows: [
      [1, "a"],
      [2, "b"],
      [3, "c"],
      [4, "d"],
      [5, "e"],
    ],
  },
  row_count: 5,
  status: "completed",
};

// ---------------------------------------------------------------------------
// Helpers (verbatim from schema.tools.test.ts)
// ---------------------------------------------------------------------------

function makeFetchMock(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

/**
 * Creates a fetch mock that returns different responses for sequential calls.
 * Each entry is [status, body] for one sequential call.
 */
function makeSequentialFetchMock(calls: Array<[number, unknown]>): typeof fetch {
  const mockFn = vi.fn();
  for (const [status, body] of calls) {
    mockFn.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : status === 404 ? "Not Found" : "Error",
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }
  return mockFn as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("MCP query tools — queries_execute_sql, cards_execute, queries_export", () => {
  let client: Client;

  beforeAll(async () => {
    // Stub env vars so MetabaseClient constructors inside handlers don't throw
    process.env["METABASE_URL"] = "http://metabase.test";
    process.env["METABASE_API_KEY"] = "test-key-query-tools";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "query-tools-test-client", version: "0.0.1" });
        await client.connect(clientTransport);
      })(),
    ]);
  });

  afterAll(async () => {
    await client?.close?.();
    delete process.env["METABASE_URL"];
    delete process.env["METABASE_API_KEY"];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Tool registration
  // -------------------------------------------------------------------------

  it("registers queries_execute_sql, cards_execute, and queries_export tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("queries_execute_sql");
    expect(names).toContain("cards_execute");
    expect(names).toContain("queries_export");
  });

  // -------------------------------------------------------------------------
  // queries_execute_sql — happy path (2-row result)
  // -------------------------------------------------------------------------

  describe("queries_execute_sql", () => {
    it("happy path: 2-row dataset renders a Markdown table with column display_names as headers", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_2ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Header must use display_name values (not internal column names)
      expect(text).toContain("ID");
      expect(text).toContain("Status");
      // Data rows
      expect(text).toContain("shipped");
      expect(text).toContain("pending");
    });

    it("no-truncation: 2-row result ends with *(2 rows)* footer and no ⚠ warning", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_2ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders" },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("*(2 rows)*");
      expect(text).not.toContain("⚠");
    });

    it("max_rows cap: 5-row dataset with max_rows=2 renders warning beginning with exact D-01 prefix", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_5ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders", max_rows: 2 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // D-01 exact prefix for agent cap
      expect(text).toContain("⚠ Results capped at 2 rows (your max_rows limit).");
      // Must appear BEFORE the table (warning comes before first | character)
      const warnIndex = text.indexOf("⚠");
      const tableIndex = text.indexOf("|");
      expect(warnIndex).toBeLessThan(tableIndex);
    });

    it("max_rows cap: only max_rows data rows are present in the table body", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_5ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders", max_rows: 2 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      // Rows 1 and 2 (a, b) present; row 5 (e) absent
      expect(text).toContain("a");
      expect(text).toContain("b");
      expect(text).not.toContain("e");
    });

    it("Metabase cap: 2000-row result renders D-01 Metabase cap warning before the table", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_2000ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, val FROM big_table" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // D-01 exact prefix for Metabase cap
      expect(text).toContain("⚠ Metabase returned exactly 2,000 rows — its silent limit.");
      // Warning appears BEFORE the table
      const warnIndex = text.indexOf("⚠");
      const tableIndex = text.indexOf("|");
      expect(warnIndex).toBeLessThan(tableIndex);
    });

    it("zero rows: renders header row + separator + *(0 rows)* with no ⚠", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_0ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders WHERE 1=0" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Header row and separator must exist
      expect(text).toContain("| ID");
      expect(text).toContain("---");
      // Footer
      expect(text).toContain("*(0 rows)*");
      // No warning
      expect(text).not.toContain("⚠");
    });

    it("parameters mapping: fetch body contains Metabase wire format target for each parameter", async () => {
      const mockFetch = makeFetchMock(200, SEED_DATASET_2ROWS);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "queries_execute_sql",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{status}}",
          parameters: [{ name: "status", value: "shipped" }],
        },
      });

      // Inspect what was sent to fetch
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const init = calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string) as {
        parameters: Array<{ type: string; value: string; target: unknown[] }>;
      };
      expect(body.parameters).toHaveLength(1);
      expect(body.parameters[0].target).toEqual(["variable", ["template-tag", "status"]]);
      expect(body.parameters[0].value).toBe("shipped");
      expect(body.parameters[0].type).toBe("category"); // default when type omitted
    });

    it("parameters optional: queries_execute_sql succeeds when parameters is omitted", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_2ROWS));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders" },
      });

      expect(res.isError).toBeFalsy();
    });

    it("returns isError: true on a non-2xx API response", async () => {
      vi.stubGlobal("fetch", makeFetchMock(500, { message: "Internal Server Error" }));

      const res = await client.callTool({
        name: "queries_execute_sql",
        arguments: { database_id: 1, sql: "SELECT 1" },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("queries_execute_sql");
      expect(text).not.toContain("test-key-query-tools");
    });
  });

  // -------------------------------------------------------------------------
  // cards_execute — same Markdown format as queries_execute_sql
  // RED until Plan 02 implements cards_execute
  // -------------------------------------------------------------------------

  describe("cards_execute", () => {
    it("2-row dataset renders a Markdown table with column display_names and *(2 rows)* footer", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DATASET_2ROWS));

      const res = await client.callTool({
        name: "cards_execute",
        arguments: { card_id: 42 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("ID");
      expect(text).toContain("Status");
      expect(text).toContain("shipped");
      expect(text).toContain("*(2 rows)*");
    });

    it("returns isError: true on a non-2xx API response", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Card not found." }));

      const res = await client.callTool({
        name: "cards_execute",
        arguments: { card_id: 9999 },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("cards_execute");
      expect(text).not.toContain("test-key-query-tools");
    });
  });

  // -------------------------------------------------------------------------
  // queries_export — raw CSV text response
  // RED until Plan 03 implements queries_export
  // -------------------------------------------------------------------------

  describe("queries_export", () => {
    it("calls POST /api/dataset/csv and returns raw CSV text as the single content item", async () => {
      const csvBody = "id,status\n1,shipped\n2,pending\n";
      // CSV endpoint returns text, not JSON — mock text() to return CSV
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.reject(new Error("not JSON")),
        text: () => Promise.resolve(csvBody),
      } as unknown as Response);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "queries_export",
        arguments: { database_id: 1, sql: "SELECT id, status FROM orders" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toBe(csvBody);
    });

    it("returns isError: true on a non-2xx response from /api/dataset/csv", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () => Promise.reject(new Error("not JSON")),
        text: () => Promise.resolve("value must be a valid JSON string"),
      } as unknown as Response);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "queries_export",
        arguments: { database_id: 1, sql: "SELECT 1" },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("queries_export");
      expect(text).not.toContain("test-key-query-tools");
    });
  });
});
