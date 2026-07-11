/**
 * card.tools.test.ts
 *
 * Wave-0 failing test scaffold for all Phase 4 card tools:
 *   - cards_list    (Plan 01 — goes GREEN in Task 3)
 *   - cards_get     (Plan 01 — goes GREEN in Task 4)
 *   - cards_create  (Plan 02 — RED until Plan 02 implements it)
 *   - cards_update  (Plan 02 — RED until Plan 02 implements it)
 *   - cards_delete  (Plan 02 — RED until Plan 02 implements it)
 *
 * Uses the same InMemoryTransport + makeFetchMock pattern as test/query.tools.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SEED_CARD_LIST = [
  {
    id: 1,
    name: "Monthly Revenue",
    description: "Total revenue per month",
    database_id: 1,
    creator: { id: 10, common_name: "Alice Smith", email: "alice@example.com" },
    creator_id: 10,
    updated_at: "2026-06-01T12:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    display: "table",
    archived: false,
  },
  {
    id: 2,
    name: "Daily Signups",
    description: "New user signups per day",
    database_id: 1,
    creator: { id: 11, common_name: "Bob Jones", email: "bob@example.com" },
    creator_id: 11,
    updated_at: "2026-06-10T08:30:00Z",
    created_at: "2026-02-01T00:00:00Z",
    display: "line",
    archived: false,
  },
  {
    id: 3,
    name: "Weekly Active Users",
    description: null,
    database_id: 2,
    creator: { id: 10, common_name: "Alice Smith", email: "alice@example.com" },
    creator_id: 10,
    updated_at: "2026-06-15T14:00:00Z",
    created_at: "2026-03-01T00:00:00Z",
    display: "bar",
    archived: false,
  },
];

const SEED_CARD_DETAIL_NATIVE = {
  id: 1,
  name: "Monthly Revenue",
  description: "Total revenue per month",
  database_id: 1,
  creator: { id: 10, common_name: "Alice Smith", email: "alice@example.com" },
  creator_id: 10,
  updated_at: "2026-06-01T12:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  display: "table",
  archived: false,
  dataset_query: {
    type: "native",
    database: 1,
    native: {
      query: "SELECT * FROM orders",
      "template-tags": {},
    },
  },
  visualization_settings: {},
  result_metadata: [],
};

const SEED_CARD_DETAIL_MBQL = {
  id: 4,
  name: "GUI Question",
  description: null,
  database_id: 1,
  creator: { id: 10, common_name: "Alice Smith", email: "alice@example.com" },
  creator_id: 10,
  updated_at: "2026-06-01T12:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  display: "table",
  archived: false,
  dataset_query: {
    type: "query",
    database: 1,
    query: { "source-table": 5 },
  },
  visualization_settings: {},
  result_metadata: [],
};

const SEED_CARD_CREATED = {
  id: 101,
  name: "New Card",
  description: null,
  database_id: 1,
  creator: { id: 10, common_name: "Alice Smith", email: "alice@example.com" },
  creator_id: 10,
  updated_at: "2026-06-20T00:00:00Z",
  created_at: "2026-06-20T00:00:00Z",
  display: "table",
  archived: false,
  dataset_query: {
    type: "native",
    database: 1,
    native: {
      query: "SELECT * FROM new_table",
      "template-tags": {},
    },
  },
  visualization_settings: {},
  result_metadata: [],
};

// ---------------------------------------------------------------------------
// Helpers (verbatim from query.tools.test.ts)
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

describe("MCP card tools", () => {
  let client: Client;

  beforeAll(async () => {
    // Stub env vars so MetabaseClient constructors inside handlers don't throw
    process.env["METABASE_URL"] = "http://metabase.test";
    process.env["METABASE_API_KEY"] = "test-key-card-tools";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "card-tools-test-client", version: "0.0.1" });
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

  it("registers cards_list, cards_get, cards_create, cards_update, cards_delete tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("cards_list");
    expect(names).toContain("cards_get");
    expect(names).toContain("cards_create");
    expect(names).toContain("cards_update");
    expect(names).toContain("cards_delete");
  });

  // -------------------------------------------------------------------------
  // cards_list (CARDS-01/02)
  // -------------------------------------------------------------------------

  describe("cards_list", () => {
    it("returns a Markdown table containing each card id, name, database_id, and creator common_name", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_CARD_LIST));

      const res = await client.callTool({
        name: "cards_list",
        arguments: {},
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Header columns
      expect(text).toContain("ID");
      expect(text).toContain("Name");
      expect(text).toContain("Description");
      expect(text).toContain("Database ID");
      expect(text).toContain("Creator");
      expect(text).toContain("Updated");
      // First card data
      expect(text).toContain("1");
      expect(text).toContain("Monthly Revenue");
      expect(text).toContain("Alice Smith");
      // Second card data
      expect(text).toContain("2");
      expect(text).toContain("Daily Signups");
      expect(text).toContain("Bob Jones");
    });

    it("empty array result renders the header row and separator only (no data rows)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, []));

      const res = await client.callTool({
        name: "cards_list",
        arguments: {},
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Header must exist
      expect(text).toContain("| ID |");
      // No data rows — should not contain actual IDs from seed data
      expect(text).not.toContain("| 1 |");
      expect(text).not.toContain("Monthly Revenue");
    });

    it("name_filter matching one card includes that card and excludes non-matching cards", async () => {
      // Server returns only matching cards when q param is used
      vi.stubGlobal("fetch", makeFetchMock(200, [SEED_CARD_LIST[0]]));

      const res = await client.callTool({
        name: "cards_list",
        arguments: { name_filter: "Monthly" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("Monthly Revenue");
      expect(text).not.toContain("Daily Signups");
    });

    it("name_filter matching nothing renders header only", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, []));

      const res = await client.callTool({
        name: "cards_list",
        arguments: { name_filter: "zzznomatch" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("| ID |");
      expect(text).not.toContain("Monthly Revenue");
      expect(text).not.toContain("Daily Signups");
    });

    it("returns isError: true on a non-2xx API response and does not leak the API key", async () => {
      vi.stubGlobal("fetch", makeFetchMock(500, { message: "Internal Server Error" }));

      const res = await client.callTool({
        name: "cards_list",
        arguments: {},
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("cards_list");
      expect(text).not.toContain("test-key-card-tools");
    });
  });

  // -------------------------------------------------------------------------
  // cards_get (CARDS-03)
  // -------------------------------------------------------------------------

  describe("cards_get", () => {
    it("native card: response contains the SQL text 'SELECT * FROM orders'", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_CARD_DETAIL_NATIVE));

      const res = await client.callTool({
        name: "cards_get",
        arguments: { card_id: 1 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("SELECT * FROM orders");
    });

    it("MBQL card: response is NOT isError and the tool does not throw (surfaces non-native notice)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_CARD_DETAIL_MBQL));

      const res = await client.callTool({
        name: "cards_get",
        arguments: { card_id: 4 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Should not throw and should surface a non-native notice
      expect(text).toContain("Non-native");
    });

    it("returns isError: true on a non-2xx API response and does not leak the API key", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Card not found." }));

      const res = await client.callTool({
        name: "cards_get",
        arguments: { card_id: 9999 },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("cards_get");
      expect(text).not.toContain("test-key-card-tools");
    });
  });

  // -------------------------------------------------------------------------
  // cards_create (CARDS-04, RED until Plan 02)
  // -------------------------------------------------------------------------

  describe("cards_create", () => {
    it("calls POST to a URL ending /api/card with correct native SQL body structure", async () => {
      const mockFetch = makeFetchMock(200, SEED_CARD_CREATED);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "cards_create",
        arguments: { database_id: 1, sql: "SELECT * FROM orders", name: "New Card" },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toMatch(/\/api\/card$/);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as {
        dataset_query: {
          type: string;
          native: { query: string; "template-tags": Record<string, unknown> };
        };
        display: string;
        visualization_settings: unknown;
      };
      expect(body.dataset_query.type).toBe("native");
      expect(body.dataset_query.native.query).toBe("SELECT * FROM orders");
      expect(body.dataset_query.native["template-tags"]).toBeDefined();
      expect(body.display).toBe("table");
      expect(body.visualization_settings).toBeDefined();
    });

    it("response text includes the created card id (101)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_CARD_CREATED));

      const res = await client.callTool({
        name: "cards_create",
        arguments: { database_id: 1, sql: "SELECT * FROM orders", name: "New Card" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("101");
    });

    it("returns isError: true on a non-2xx API response and does not leak the API key", async () => {
      vi.stubGlobal("fetch", makeFetchMock(400, { message: "Invalid query" }));

      const res = await client.callTool({
        name: "cards_create",
        arguments: { database_id: 1, sql: "SELECT 1", name: "Test" },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("cards_create");
      expect(text).not.toContain("test-key-card-tools");
    });
  });

  // -------------------------------------------------------------------------
  // cards_update (CARDS-05, RED until Plan 02)
  // -------------------------------------------------------------------------

  describe("cards_update", () => {
    it("calls PUT to /api/card/:id and when only name provided, body contains name but NOT dataset_query", async () => {
      const mockFetch = makeFetchMock(200, { ...SEED_CARD_DETAIL_NATIVE, name: "Renamed Card" });
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "cards_update",
        arguments: { card_id: 1, name: "Renamed Card" },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toMatch(/\/api\/card\/1$/);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["name"]).toBe("Renamed Card");
      expect(body["dataset_query"]).toBeUndefined();
    });

    it("returns a confirmation message containing 'updated'", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_CARD_DETAIL_NATIVE));

      const res = await client.callTool({
        name: "cards_update",
        arguments: { card_id: 1, name: "Renamed Card" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text.toLowerCase()).toContain("updated");
    });

    it("returns isError: true when sql is provided without database_id", async () => {
      // No fetch mock needed — guard fires before any API call
      const res = await client.callTool({
        name: "cards_update",
        arguments: { card_id: 1, sql: "SELECT 1" },
      });
      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("database_id is required");
    });

    it("returns isError: true on a non-2xx API response and does not leak the API key", async () => {
      vi.stubGlobal(
        "fetch",
        makeFetchMock(403, { message: "Forbidden" }),
      );
      const res = await client.callTool({
        name: "cards_update",
        arguments: { card_id: 1, name: "Attempt" },
      });
      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("cards_update");
      expect(text).not.toContain("test-key-card-tools");
    });
  });

  // -------------------------------------------------------------------------
  // FIX-02: widget_type auto-detection & validation for Field Filter tags
  // -------------------------------------------------------------------------

  describe("FIX-02: widget_type auto-detection & validation", () => {
    const SEED_FIELD_DATE = {
      id: 205,
      name: "created_at",
      display_name: "Created At",
      base_type: "type/DateTimeWithLocalTZ",
      semantic_type: null,
      visibility_type: "normal",
      database_required: false,
      fk_target_field_id: null,
    };

    const SEED_FIELD_FK = {
      id: 301,
      name: "org_id",
      display_name: "Org ID",
      base_type: "type/Integer",
      semantic_type: "type/FK",
      visibility_type: "normal",
      database_required: false,
      fk_target_field_id: 42,
    };

    const SEED_FIELD_TEXT = {
      id: 410,
      name: "status",
      display_name: "Status",
      base_type: "type/Text",
      semantic_type: null,
      visibility_type: "normal",
      database_required: false,
      fk_target_field_id: null,
    };

    function tagBody(mockFetch: typeof fetch, callIdx: number): Record<string, Record<string, unknown>> {
      const init = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[callIdx][1] as RequestInit;
      const body = JSON.parse(init.body as string) as {
        dataset_query: { native: { "template-tags": Record<string, Record<string, unknown>> } };
      };
      return body.dataset_query.native["template-tags"];
    }

    it("cards_create auto-detects date/all-options for a date field when widget_type is omitted", async () => {
      const mockFetch = makeSequentialFetchMock([[200, SEED_FIELD_DATE], [200, SEED_CARD_CREATED]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_create",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{start_date}}",
          name: "Date Filtered",
          tag_configs: { start_date: { type: "dimension", field_id: 205 } },
        },
      });

      expect(res.isError).toBeFalsy();
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0] as string).toMatch(/\/api\/field\/205$/);
      expect(calls[1][0] as string).toMatch(/\/api\/card$/);
      const tags = tagBody(mockFetch, 1);
      expect(tags["start_date"]["widget-type"]).toBe("date/all-options");
      expect(tags["start_date"]["dimension"]).toEqual(["field", 205, null]);
    });

    it("cards_create auto-detects the id widget for an FK field", async () => {
      const mockFetch = makeSequentialFetchMock([[200, SEED_FIELD_FK], [200, SEED_CARD_CREATED]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_create",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{org}}",
          name: "Org Filtered",
          tag_configs: { org: { type: "dimension", field_id: 301 } },
        },
      });

      expect(res.isError).toBeFalsy();
      expect(tagBody(mockFetch, 1)["org"]["widget-type"]).toBe("id");
    });

    it("cards_create passes through an explicit valid widget_type unchanged", async () => {
      const mockFetch = makeSequentialFetchMock([[200, SEED_FIELD_TEXT], [200, SEED_CARD_CREATED]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_create",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{status}}",
          name: "Status Filtered",
          tag_configs: { status: { type: "dimension", field_id: 410, widget_type: "string/contains" } },
        },
      });

      expect(res.isError).toBeFalsy();
      // Field metadata is still fetched to validate the explicit widget_type
      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string).toMatch(/\/api\/field\/410$/);
      expect(tagBody(mockFetch, 1)["status"]["widget-type"]).toBe("string/contains");
    });

    it("cards_create rejects an invalid widget_type/field-type combination before saving", async () => {
      const mockFetch = makeSequentialFetchMock([[200, SEED_FIELD_TEXT]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_create",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{status}}",
          name: "Broken Filter",
          tag_configs: { status: { type: "dimension", field_id: 410, widget_type: "date/all-options" } },
        },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("tag_configs.status");
      expect(text).toContain('"date/all-options" is not valid for field 410');
      expect(text).toContain("string/=");
      // Only the field GET happened — the card was never POSTed
      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it("cards_create rejects widget_type without field_id, with no API call at all", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_create",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{status}}",
          name: "Orphan Widget",
          tag_configs: { status: { type: "dimension", widget_type: "string/=" } },
        },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("widget_type requires field_id");
      expect(mockFetch.mock.calls.length).toBe(0);
    });

    it("fetches field metadata once when two tags share the same field_id", async () => {
      const mockFetch = makeSequentialFetchMock([[200, SEED_FIELD_DATE], [200, SEED_CARD_CREATED]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_create",
        arguments: {
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{from_date}} AND {{to_date}}",
          name: "Double Date",
          tag_configs: {
            from_date: { type: "dimension", field_id: 205 },
            to_date: { type: "dimension", field_id: 205 },
          },
        },
      });

      expect(res.isError).toBeFalsy();
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(2); // one field GET + one card POST
      const tags = tagBody(mockFetch, 1);
      expect(tags["from_date"]["widget-type"]).toBe("date/all-options");
      expect(tags["to_date"]["widget-type"]).toBe("date/all-options");
    });

    it("cards_update auto-detects the widget_type when updating sql with tag_configs", async () => {
      // Sequence: field GET (resolve) → source card GET (merge) → PUT
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_FIELD_DATE],
        [200, SEED_CARD_DETAIL_NATIVE],
        [200, SEED_CARD_DETAIL_NATIVE],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_update",
        arguments: {
          card_id: 1,
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{start_date}}",
          tag_configs: { start_date: { type: "dimension", field_id: 205 } },
        },
      });

      expect(res.isError).toBeFalsy();
      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0] as string).toMatch(/\/api\/field\/205$/);
      expect((calls[2][1] as RequestInit).method).toBe("PUT");
      expect(tagBody(mockFetch, 2)["start_date"]["widget-type"]).toBe("date/all-options");
    });

    it("cards_update rejects an invalid combination before reading or writing the card", async () => {
      const mockFetch = makeSequentialFetchMock([[200, SEED_FIELD_TEXT]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_update",
        arguments: {
          card_id: 1,
          database_id: 1,
          sql: "SELECT * FROM orders WHERE {{status}}",
          tag_configs: { status: { type: "dimension", field_id: 410, widget_type: "number/=" } },
        },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain('"number/=" is not valid for field 410');
      // Only the field GET happened — no card GET, no PUT
      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // cards_delete (CARDS-06, RED until Plan 02)
  // -------------------------------------------------------------------------

  describe("cards_delete", () => {
    it("calls DELETE to /api/card/:id", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: "No Content",
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(""),
      } as unknown as Response);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "cards_delete",
        arguments: { card_id: 1 },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toMatch(/\/api\/card\/1$/);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("DELETE");
    });

    it("returns a confirmation message containing 'deleted'", async () => {
      const mockFetch = makeSequentialFetchMock([[204, null]]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "cards_delete",
        arguments: { card_id: 1 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text.toLowerCase()).toContain("deleted");
    });
  });
});
