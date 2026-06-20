/**
 * schema.tools.test.ts
 *
 * Tool-level tests for the databases_list and databases_get_schema MCP tools.
 * Drives the registered tools through an in-process InMemoryTransport client
 * with fetch stubbed to return seeded Metabase metadata.
 *
 * Mirrors the skeleton.e2e.test.ts connection pattern (InMemoryTransport,
 * single beforeAll setup).
 *
 * RED state: Tests FAIL until plan 02-01 Task 2 implements the client methods
 * and registers the tools in src/index.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Seed data for mocked Metabase responses
// ---------------------------------------------------------------------------

const SEED_DB_ARRAY = [
  { id: 1, name: "Sample Database", engine: "h2", is_full_sync: true, is_sample: true },
  { id: 2, name: "Production", engine: "postgres", is_full_sync: true, is_sample: false },
];

const SEED_DB_ENVELOPE = {
  data: SEED_DB_ARRAY,
  total: 2,
};

const SEED_METADATA = {
  id: 2,
  name: "Production",
  engine: "postgres",
  tables: [
    {
      id: 10,
      name: "orders",
      display_name: "Orders",
      schema: "public",
      db_id: 2,
      description: null,
      estimated_row_count: 18765,
      fields: [
        {
          id: 101,
          name: "id",
          display_name: "ID",
          base_type: "type/Integer",
          semantic_type: "type/PK",
          visibility_type: "normal",
          database_required: false,
          fk_target_field_id: null,
        },
        {
          id: 102,
          name: "created_at",
          display_name: "Created At",
          base_type: "type/DateTimeWithLocalTZ",
          semantic_type: "type/CreationTimestamp",
          visibility_type: "normal",
          database_required: false,
          fk_target_field_id: null,
        },
      ],
    },
    {
      id: 11,
      name: "products",
      display_name: "Products",
      schema: "public",
      db_id: 2,
      description: null,
      estimated_row_count: null, // null row count — must render gracefully
      fields: [
        {
          id: 201,
          name: "sku",
          display_name: "SKU",
          base_type: "type/Text",
          semantic_type: null,
          visibility_type: "normal",
          database_required: true,
          fk_target_field_id: null,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("MCP schema tools — databases_list and databases_get_schema", () => {
  let client: Client;

  beforeAll(async () => {
    // Stub env vars so MetabaseClient constructors inside handlers don't throw
    process.env["METABASE_URL"] = "http://metabase.test";
    process.env["METABASE_API_KEY"] = "test-key-schema-tools";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "schema-tools-test-client", version: "0.0.1" });
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

  it("registers databases_list and databases_get_schema tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("databases_list");
    expect(names).toContain("databases_get_schema");
  });

  // -------------------------------------------------------------------------
  // databases_list — Markdown table output
  // -------------------------------------------------------------------------

  describe("databases_list", () => {
    it("output is a Markdown table with ID, Name, Engine, and sync columns", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DB_ARRAY));

      const res = await client.callTool({ name: "databases_list", arguments: {} });

      expect(res.isError).toBeFalsy();
      expect(res.content).toBeDefined();
      const text = (res.content[0] as { type: string; text: string }).text;

      // Header row must name the four required columns
      expect(text).toMatch(/ID/i);
      expect(text).toMatch(/Name/i);
      expect(text).toMatch(/Engine/i);
      // sync column (Full Sync, Sync, etc.)
      expect(text).toMatch(/sync/i);
    });

    it("body contains the seeded database name", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DB_ARRAY));

      const res = await client.callTool({ name: "databases_list", arguments: {} });

      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("Sample Database");
      expect(text).toContain("Production");
    });

    it("normalises the { data: [] } envelope response shape", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DB_ENVELOPE));

      const res = await client.callTool({ name: "databases_list", arguments: {} });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Should render both databases even from the envelope shape
      expect(text).toContain("Sample Database");
    });
  });

  // -------------------------------------------------------------------------
  // databases_get_schema — hierarchical Markdown tree
  // -------------------------------------------------------------------------

  describe("databases_get_schema", () => {
    it("output contains a table heading", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "databases_get_schema",
        arguments: { database_id: 2 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Should contain a heading for the "orders" table
      expect(text).toMatch(/orders/i);
    });

    it("output contains a column row with a base_type value for a seeded table", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "databases_get_schema",
        arguments: { database_id: 2 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      // Column table must show the base_type string
      expect(text).toContain("type/Integer");
    });

    it("renders a row-count-unknown marker when estimated_row_count is null", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "databases_get_schema",
        arguments: { database_id: 2 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      // The "products" table has estimated_row_count: null — must not render "null"
      expect(text).not.toMatch(/\bnull\b/);
    });

    it("returns isError: true when the API returns a 404", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

      const res = await client.callTool({
        name: "databases_get_schema",
        arguments: { database_id: 9999 },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      // Error message must name the tool (not expose the API key)
      expect(text).toContain("databases_get_schema");
      expect(text).not.toContain("test-key-schema-tools");
    });
  });
});
