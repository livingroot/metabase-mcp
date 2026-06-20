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
// Seed data for mocked Metabase responses (shared by databases_* and tables_* tests)
// ---------------------------------------------------------------------------

// Seed data for GET /api/field/:id (fields_get — list field)
const SEED_FIELD_LIST = {
  id: 102,
  name: "status",
  display_name: "Status",
  base_type: "type/Text",
  semantic_type: "type/Category",
  visibility_type: "normal",
  database_required: true,
  fk_target_field_id: null,
  has_field_values: "list",
  description: null,
};

// Seed data for GET /api/field/:id (fields_get — search field, no values fetch)
const SEED_FIELD_SEARCH = {
  id: 103,
  name: "user_id",
  display_name: "User ID",
  base_type: "type/Integer",
  semantic_type: "type/FK",
  visibility_type: "normal",
  database_required: false,
  fk_target_field_id: 1,
  has_field_values: "search",
  description: null,
};

// Seed data for GET /api/field/:id/values (only for list fields)
const SEED_FIELD_VALUES = {
  field_id: 102,
  values: [["pending"], ["shipped"], ["return_requested"], ["returned"]],
  human_readable_values: [],
};

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

// Seed data for GET /api/table/:id/query_metadata (tables_get)
const SEED_TABLE_QUERY_METADATA = {
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
      name: "status",
      display_name: "Status",
      base_type: "type/Text",
      semantic_type: "type/Category",
      visibility_type: "normal",
      database_required: true,
      fk_target_field_id: null,
    },
    {
      id: 103,
      name: "note",
      display_name: "Note",
      base_type: "type/Text",
      semantic_type: null,
      visibility_type: "details-only",
      database_required: false,
      fk_target_field_id: null,
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

/**
 * Creates a fetch mock that returns different responses for sequential calls.
 * Used for fields_get which makes two calls: metadata then values.
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

// ---------------------------------------------------------------------------
// MCP table tools: tables_list and tables_get
// RED state: Tests FAIL until plan 02-02 Task 2 implements the client method
// and registers the tools in src/index.ts.
// ---------------------------------------------------------------------------

describe("MCP schema tools — tables_list and tables_get", () => {
  let client: Client;

  beforeAll(async () => {
    process.env["METABASE_URL"] = "http://metabase.test";
    process.env["METABASE_API_KEY"] = "test-key-table-tools";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "table-tools-test-client", version: "0.0.1" });
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

  it("registers tables_list and tables_get tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("tables_list");
    expect(names).toContain("tables_get");
  });

  // -------------------------------------------------------------------------
  // tables_list — flat Markdown table (reuses getDatabaseMetadata endpoint)
  // -------------------------------------------------------------------------

  describe("tables_list", () => {
    it("output is a Markdown table with ID, Name, Schema, and estimated-rows columns", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "tables_list",
        arguments: { database_id: 2 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;

      expect(text).toMatch(/ID/i);
      expect(text).toMatch(/Name/i);
      expect(text).toMatch(/Schema/i);
      // Estimated rows column — any of: "Est. Rows", "Rows", "Row", "Estimated"
      expect(text).toMatch(/row/i);
    });

    it("output contains one row per seeded table", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "tables_list",
        arguments: { database_id: 2 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("orders");
      expect(text).toContain("products");
    });

    it("renders an unknown marker when estimated_row_count is null", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "tables_list",
        arguments: { database_id: 2 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      // products table has estimated_row_count: null — must NOT render literal "null"
      expect(text).not.toMatch(/\bnull\b/);
    });

    it("output does NOT contain nested field/column detail", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_METADATA));

      const res = await client.callTool({
        name: "tables_list",
        arguments: { database_id: 2 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      // The tables_list tool must not expose field-level detail
      // (type/Integer and type/PK are field-level data from the seed)
      expect(text).not.toContain("type/Integer");
      expect(text).not.toContain("type/PK");
    });

    it("returns isError: true when the API returns a 404", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

      const res = await client.callTool({
        name: "tables_list",
        arguments: { database_id: 9999 },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("tables_list");
      expect(text).not.toContain("test-key-table-tools");
    });
  });

  // -------------------------------------------------------------------------
  // tables_get — column-metadata Markdown table
  // -------------------------------------------------------------------------

  describe("tables_get", () => {
    it("output is a Markdown table with display_name, base_type, semantic_type, required flag, and visibility", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_TABLE_QUERY_METADATA));

      const res = await client.callTool({
        name: "tables_get",
        arguments: { table_id: 10 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;

      // Column headers
      expect(text).toMatch(/Display Name/i);
      expect(text).toMatch(/Type/i);
      expect(text).toMatch(/Semantic/i);
      expect(text).toMatch(/Required/i);
      expect(text).toMatch(/Visibility/i);
    });

    it("output contains a row for each seeded field with correct base_type", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_TABLE_QUERY_METADATA));

      const res = await client.callTool({
        name: "tables_get",
        arguments: { table_id: 10 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("type/Integer");
      expect(text).toContain("type/Text");
    });

    it("required flag reflects database_required: true → 'yes', false → 'no'", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_TABLE_QUERY_METADATA));

      const res = await client.callTool({
        name: "tables_get",
        arguments: { table_id: 10 },
      });

      const text = (res.content[0] as { type: string; text: string }).text;
      // id field has database_required: false → "no"
      // status field has database_required: true → "yes"
      expect(text).toContain("yes");
      expect(text).toContain("no");
    });

    it("returns isError: true on MetabaseApiError (404) with tool name in message", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

      const res = await client.callTool({
        name: "tables_get",
        arguments: { table_id: 9999 },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("tables_get");
      expect(text).not.toContain("test-key-table-tools");
    });
  });
});

// ---------------------------------------------------------------------------
// MCP field tool: fields_get
// RED state: Tests FAIL until plan 02-03 Task 2 implements the client methods
// and registers the tool in src/index.ts.
// ---------------------------------------------------------------------------

describe("MCP schema tools — fields_get", () => {
  let client: Client;

  beforeAll(async () => {
    process.env["METABASE_URL"] = "http://metabase.test";
    process.env["METABASE_API_KEY"] = "test-key-fields-tools";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "field-tools-test-client", version: "0.0.1" });
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

  it("registers fields_get tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("fields_get");
  });

  // -------------------------------------------------------------------------
  // fields_get — list branch: metadata + values (two fetch calls)
  // -------------------------------------------------------------------------

  describe("fields_get — list branch (has_field_values = 'list')", () => {
    it("fetches metadata and values (two sequential fetch calls) and returns both", async () => {
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_FIELD_LIST],
        [200, SEED_FIELD_VALUES],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({ name: "fields_get", arguments: { field_id: 102 } });

      expect(res.isError).toBeFalsy();
      // stubbed fetch must have been called exactly twice
      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });

    it("output contains metadata: display name, data type, and semantic type", async () => {
      vi.stubGlobal(
        "fetch",
        makeSequentialFetchMock([
          [200, SEED_FIELD_LIST],
          [200, SEED_FIELD_VALUES],
        ]),
      );

      const res = await client.callTool({ name: "fields_get", arguments: { field_id: 102 } });

      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("Status");           // display_name
      expect(text).toContain("type/Text");         // base_type (data type)
      expect(text).toContain("type/Category");     // semantic_type
    });

    it("output contains a Valid Values section listing the seeded enum values", async () => {
      vi.stubGlobal(
        "fetch",
        makeSequentialFetchMock([
          [200, SEED_FIELD_LIST],
          [200, SEED_FIELD_VALUES],
        ]),
      );

      const res = await client.callTool({ name: "fields_get", arguments: { field_id: 102 } });

      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("pending");
      expect(text).toContain("shipped");
      expect(text).toContain("return_requested");
      expect(text).toContain("returned");
    });
  });

  // -------------------------------------------------------------------------
  // fields_get — search branch (has_field_values = 'search'): single fetch call, not-applicable marker
  // -------------------------------------------------------------------------

  describe("fields_get — non-list branch (has_field_values = 'search')", () => {
    it("makes exactly one fetch call (no /values call) for a search-type field", async () => {
      const mockFetch = makeFetchMock(200, SEED_FIELD_SEARCH);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({ name: "fields_get", arguments: { field_id: 103 } });

      expect(res.isError).toBeFalsy();
      // Only metadata call — no /values fetch
      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it("output contains a not-applicable values marker for a search-type field", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_FIELD_SEARCH));

      const res = await client.callTool({ name: "fields_get", arguments: { field_id: 103 } });

      const text = (res.content[0] as { type: string; text: string }).text;
      // Should signal not applicable — not list values
      expect(text).toMatch(/N\/A|not applicable|high.?cardinality|search/i);
    });
  });

  // -------------------------------------------------------------------------
  // fields_get — error: getField returns 404
  // -------------------------------------------------------------------------

  it("returns isError: true on a 404 from getField with tool name in message", async () => {
    vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

    const res = await client.callTool({ name: "fields_get", arguments: { field_id: 9999 } });

    expect(res.isError).toBe(true);
    const text = (res.content[0] as { type: string; text: string }).text;
    expect(text).toContain("fields_get");
    expect(text).not.toContain("test-key-fields-tools");
  });

  // -------------------------------------------------------------------------
  // fields_get — graceful degradation: getFieldValues rejects, metadata still returned
  // -------------------------------------------------------------------------

  it("still returns metadata when getFieldValues call rejects (graceful degradation)", async () => {
    // First call (getField) succeeds, second call (getFieldValues) fails with 500
    const mockFetch = makeSequentialFetchMock([
      [200, SEED_FIELD_LIST],
      [500, { message: "Internal Server Error" }],
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const res = await client.callTool({ name: "fields_get", arguments: { field_id: 102 } });

    // Must NOT be isError — metadata is returned even when values call fails
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { type: string; text: string }).text;
    // Metadata must still be present
    expect(text).toContain("Status");
    expect(text).toContain("type/Text");
  });
});
