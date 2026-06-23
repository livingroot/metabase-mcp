/**
 * dashboard.tools.test.ts
 *
 * Wave-0 failing test scaffold for all Phase 5 dashboard tools:
 *   - dashboards_list     (Plan 01 — goes GREEN in Task 3)
 *   - dashboards_get      (Plan 01 — goes GREEN in Task 4)
 *   - dashboards_create   (Plan 02 — RED until Plan 02 implements it)
 *   - dashboards_update   (Plan 02 — RED until Plan 02 implements it)
 *   - dashboards_delete   (Plan 02 — RED until Plan 02 implements it)
 *   - dashboards_add_card        (Plan 03 — RED until Plan 03 implements it)
 *   - dashboards_remove_card     (Plan 03 — RED until Plan 03 implements it)
 *   - dashboards_update_card     (Plan 03 — RED until Plan 03 implements it)
 *   - dashboards_add_filter      (Plan 03 — RED until Plan 03 implements it)
 *   - dashboards_connect_filter  (Plan 03 — RED until Plan 03 implements it)
 *
 * Uses the same InMemoryTransport + makeFetchMock pattern as test/card.tools.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SEED_DASHBOARD_LIST = [
  {
    id: 1,
    name: "Sales Overview",
    description: "Q3 sales",
    updated_at: "2026-06-01T12:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    archived: false,
    dashcards: [
      { id: 11, card_id: 101, dashboard_id: 1, row: 0, col: 0, size_x: 12, size_y: 8, parameter_mappings: [] },
      { id: 12, card_id: 102, dashboard_id: 1, row: 8, col: 0, size_x: 12, size_y: 8, parameter_mappings: [] },
    ],
  },
  {
    id: 2,
    name: "Marketing Funnel",
    description: null,
    updated_at: "2026-06-10T08:30:00Z",
    created_at: "2026-02-01T00:00:00Z",
    archived: false,
    dashcards: [],
  },
  {
    id: 3,
    name: "Ops Metrics",
    description: "daily ops",
    updated_at: "2026-06-15T14:00:00Z",
    created_at: "2026-03-01T00:00:00Z",
    archived: false,
    dashcards: [
      { id: 31, card_id: 301, dashboard_id: 3, row: 0, col: 0, size_x: 6, size_y: 4, parameter_mappings: [] },
    ],
  },
];

const SEED_DASHBOARD_DETAIL = {
  id: 1,
  name: "Sales Overview",
  description: "Q3 sales",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-06-01T12:00:00Z",
  parameters: [
    { id: "p_status", name: "Status", type: "category", slug: "status" },
  ],
  dashcards: [
    { id: 11, card_id: 101, dashboard_id: 1, row: 0, col: 0, size_x: 12, size_y: 8, parameter_mappings: [] },
    { id: 12, card_id: 102, dashboard_id: 1, row: 8, col: 0, size_x: 12, size_y: 8, parameter_mappings: [] },
  ],
};

const SEED_DASHBOARD_CREATED = {
  id: 42,
  name: "New Dashboard",
  description: null,
  parameters: [],
  dashcards: [],
  created_at: "2026-06-21T00:00:00Z",
  updated_at: "2026-06-21T00:00:00Z",
};

const SEED_DASHCARD_ADDED = {
  id: 99,
  card_id: 101,
  dashboard_id: 1,
  row: 0,
  col: 0,
  size_x: 12,
  size_y: 8,
  parameter_mappings: [],
};

// ---------------------------------------------------------------------------
// Helpers (verbatim from card.tools.test.ts)
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

describe("MCP dashboard tools", () => {
  let client: Client;

  beforeAll(async () => {
    // Stub env vars so MetabaseClient constructors inside handlers don't throw
    process.env["METABASE_URL"] = "http://metabase.test";
    process.env["METABASE_API_KEY"] = "test-key-dashboard-tools";

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "dashboard-tools-test-client", version: "0.0.1" });
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

  it("registers all ten dashboard tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("dashboards_list");
    expect(names).toContain("dashboards_get");
    expect(names).toContain("dashboards_create");
    expect(names).toContain("dashboards_update");
    expect(names).toContain("dashboards_delete");
    expect(names).toContain("dashboards_add_card");
    expect(names).toContain("dashboards_remove_card");
    expect(names).toContain("dashboards_update_card");
    expect(names).toContain("dashboards_add_filter");
    expect(names).toContain("dashboards_connect_filter");
    // Assert count of dashboards_* tools is at least 10
    const dashTools = names.filter((n) => n.startsWith("dashboards_"));
    expect(dashTools.length).toBeGreaterThanOrEqual(10);
  });

  // -------------------------------------------------------------------------
  // dashboards_list (DASH-01/02)
  // -------------------------------------------------------------------------

  describe("dashboards_list", () => {
    it("returns a Markdown table with ID, name, description, card count, and updated date", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DASHBOARD_LIST));

      const res = await client.callTool({
        name: "dashboards_list",
        arguments: {},
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Header columns
      expect(text).toContain("ID");
      expect(text).toContain("Name");
      expect(text).toContain("Description");
      expect(text).toContain("Cards");
      expect(text).toContain("Updated");
      // Sales Overview: 2 dashcards
      expect(text).toContain("Sales Overview");
      expect(text).toContain("2");
      // Marketing Funnel: 0 dashcards
      expect(text).toContain("Marketing Funnel");
      expect(text).toContain("0");
      // Ops Metrics: 1 dashcard
      expect(text).toContain("Ops Metrics");
      expect(text).toContain("1");
    });

    it("empty array result renders the header row and separator only (no data rows)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, []));

      const res = await client.callTool({
        name: "dashboards_list",
        arguments: {},
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("| ID |");
      expect(text).not.toContain("Sales Overview");
    });

    it("name_filter 'Sales' includes 'Sales Overview' and excludes 'Marketing Funnel'", async () => {
      // Mock returns the full array; client-side filter narrows
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DASHBOARD_LIST));

      const res = await client.callTool({
        name: "dashboards_list",
        arguments: { name_filter: "Sales" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("Sales Overview");
      expect(text).not.toContain("Marketing Funnel");
    });

    it("name_filter 'zzznomatch' renders header only", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DASHBOARD_LIST));

      const res = await client.callTool({
        name: "dashboards_list",
        arguments: { name_filter: "zzznomatch" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("| ID |");
      expect(text).not.toContain("Sales Overview");
      expect(text).not.toContain("Marketing Funnel");
    });

    it("returns isError: true on a non-2xx API response and does not leak the API key", async () => {
      vi.stubGlobal("fetch", makeFetchMock(500, { message: "Internal Server Error" }));

      const res = await client.callTool({
        name: "dashboards_list",
        arguments: {},
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("dashboards_list");
      expect(text).not.toContain("test-key-dashboard-tools");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_get (DASH-03)
  // -------------------------------------------------------------------------

  describe("dashboards_get", () => {
    it("renders dashboard name, parameters section, and dashcard table with both IDs and positions", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DASHBOARD_DETAIL));

      const res = await client.callTool({
        name: "dashboards_get",
        arguments: { dashboard_id: 1 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Dashboard name
      expect(text).toContain("Sales Overview");
      // Parameters section
      expect(text).toContain("Status");
      expect(text).toContain("p_status");
      // Dashcard table — both dashcard ids and card_ids
      expect(text).toContain("11");
      expect(text).toContain("12");
      expect(text).toContain("101");
      expect(text).toContain("102");
    });

    it("dashboard with parameters:[] and dashcards:[] is not isError and surfaces '(none)'", async () => {
      const emptyDashboard = {
        ...SEED_DASHBOARD_DETAIL,
        parameters: [],
        dashcards: [],
      };
      vi.stubGlobal("fetch", makeFetchMock(200, emptyDashboard));

      const res = await client.callTool({
        name: "dashboards_get",
        arguments: { dashboard_id: 1 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      // Should surface "(none)" for empty sections
      expect(text).toContain("(none)");
    });

    it("returns isError: true on a non-2xx API response and does not leak the API key", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Dashboard not found." }));

      const res = await client.callTool({
        name: "dashboards_get",
        arguments: { dashboard_id: 9999 },
      });

      expect(res.isError).toBe(true);
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("dashboards_get");
      expect(text).not.toContain("test-key-dashboard-tools");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_create (DASH-04, RED until Plan 02)
  // -------------------------------------------------------------------------

  describe("dashboards_create", () => {
    it("calls POST to a URL ending /api/dashboard with name and parameters:[] in body", async () => {
      const mockFetch = makeFetchMock(200, SEED_DASHBOARD_CREATED);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_create",
        arguments: { name: "New Dashboard" },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toMatch(/\/api\/dashboard$/);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as {
        name: string;
        parameters: unknown[];
      };
      expect(body.name).toBe("New Dashboard");
      expect(Array.isArray(body.parameters)).toBe(true);
    });

    it("response text includes the created dashboard id (42)", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DASHBOARD_CREATED));

      const res = await client.callTool({
        name: "dashboards_create",
        arguments: { name: "New Dashboard" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("42");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_update (DASH-05, RED until Plan 02)
  // -------------------------------------------------------------------------

  describe("dashboards_update", () => {
    it("with only name provided, calls PUT to /api/dashboard/:id and body contains name but NOT description", async () => {
      const mockFetch = makeFetchMock(200, { ...SEED_DASHBOARD_DETAIL, name: "Renamed Dashboard" });
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_update",
        arguments: { dashboard_id: 1, name: "Renamed Dashboard" },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toMatch(/\/api\/dashboard\/1$/);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["name"]).toBe("Renamed Dashboard");
      expect(body["description"]).toBeUndefined();
    });

    it("returns a confirmation message containing 'updated'", async () => {
      vi.stubGlobal("fetch", makeFetchMock(200, SEED_DASHBOARD_DETAIL));

      const res = await client.callTool({
        name: "dashboards_update",
        arguments: { dashboard_id: 1, name: "Renamed Dashboard" },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text.toLowerCase()).toContain("updated");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_delete (DASH-06, RED until Plan 02)
  // -------------------------------------------------------------------------

  describe("dashboards_delete", () => {
    it("calls DELETE to a URL ending /api/dashboard/:id", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: "No Content",
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(""),
      } as unknown as Response);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_delete",
        arguments: { dashboard_id: 1 },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toMatch(/\/api\/dashboard\/1$/);
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("DELETE");
    });

    it("returns a confirmation message containing 'deleted'", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: "No Content",
        json: () => Promise.resolve(null),
        text: () => Promise.resolve(""),
      } as unknown as Response);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "dashboards_delete",
        arguments: { dashboard_id: 1 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text.toLowerCase()).toContain("deleted");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_add_card (DASH-07, RED until Plan 03)
  // -------------------------------------------------------------------------

  describe("dashboards_add_card", () => {
    it("issues GET to fetch current dashcards then PUT to /api/dashboard/:id/cards with new card", async () => {
      // v0.59: POST /api/dashboard/:id/cards removed; implementation now does GET+PUT
      // Call 1: GET /api/dashboard/1 (fetch current state)
      // Call 2: PUT /api/dashboard/1/cards (full replacement with new card appended)
      const putResponse = { cards: [...SEED_DASHBOARD_DETAIL.dashcards, SEED_DASHCARD_ADDED] };
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, putResponse],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_add_card",
        arguments: { dashboard_id: 1, card_id: 101, row: 0, col: 0, size_x: 12, size_y: 8 },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      // First call: GET to fetch current dashboard state
      const getUrl = calls[0][0] as string;
      expect(getUrl).toMatch(/\/api\/dashboard\/1$/);
      // Second call: PUT with full cards array including new card (id: -1)
      const putUrl = calls[1][0] as string;
      expect(putUrl).toMatch(/\/api\/dashboard\/1\/cards$/);
      const putInit = calls[1][1] as RequestInit;
      expect(putInit.method).toBe("PUT");
      const putBody = JSON.parse(putInit.body as string) as { cards: unknown[] };
      const newCard = putBody.cards.find((c: unknown) => (c as Record<string, unknown>)["id"] === -1) as Record<string, unknown>;
      expect(newCard).toBeTruthy();
      expect(newCard["card_id"]).toBe(101);
    });

    it("response text includes the dashcard id (99) returned by the PUT", async () => {
      const putResponse = { cards: [...SEED_DASHBOARD_DETAIL.dashcards, SEED_DASHCARD_ADDED] };
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, putResponse],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "dashboards_add_card",
        arguments: { dashboard_id: 1, card_id: 101 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("99");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_remove_card (DASH-08, RED until Plan 03)
  // -------------------------------------------------------------------------

  describe("dashboards_remove_card", () => {
    it("issues GET to fetch current dashcards then PUT to /api/dashboard/:id/cards with target omitted", async () => {
      // v0.59: DELETE /api/dashboard/:id/cards?dashcardId= removed; implementation does GET+PUT
      // Omitting a dashcard from the PUT array removes it (Pitfall 2)
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],  // GET: fetch current state
        [200, { cards: [SEED_DASHBOARD_DETAIL.dashcards[1]] }],  // PUT: returns remaining
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_remove_card",
        arguments: { dashboard_id: 1, dashcard_id: 11 },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const getUrl = calls[0][0] as string;
      expect(getUrl).toMatch(/\/api\/dashboard\/1$/);
      const putUrl = calls[1][0] as string;
      expect(putUrl).toMatch(/\/api\/dashboard\/1\/cards$/);
      const putInit = calls[1][1] as RequestInit;
      expect(putInit.method).toBe("PUT");
      // dashcard 11 must NOT appear in the PUT body (it was removed)
      const putBody = JSON.parse(putInit.body as string) as { cards: unknown[] };
      const hasRemoved = putBody.cards.some((c: unknown) => (c as Record<string, unknown>)["id"] === 11);
      expect(hasRemoved).toBe(false);
    });

    it("returns a confirmation message containing 'removed'", async () => {
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, { cards: [SEED_DASHBOARD_DETAIL.dashcards[1]] }],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "dashboards_remove_card",
        arguments: { dashboard_id: 1, dashcard_id: 11 },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text.toLowerCase()).toContain("removed");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_update_card (DASH-09, RED until Plan 03)
  // -------------------------------------------------------------------------

  describe("dashboards_update_card", () => {
    it("the PUT body.cards array has length 2 (both existing dashcards preserved)", async () => {
      // Two sequential calls: GET (fetch current state) then PUT (update position)
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, {}],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_update_card",
        arguments: { dashboard_id: 1, dashcard_id: 11, row: 2, col: 4, size_x: 6, size_y: 4 },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      // Second fetch is the PUT
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const putUrl = calls[1][0] as string;
      expect(putUrl).toMatch(/\/api\/dashboard\/1\/cards$/);
      const putInit = calls[1][1] as RequestInit;
      expect(putInit.method).toBe("PUT");
      const putBody = JSON.parse(putInit.body as string) as { cards: unknown[] };
      // Both existing dashcards must be present (Pitfall 2 — bulk PUT replaces ALL dashcards)
      expect(putBody.cards.length).toBe(2);
    });

    it("the updated dashcard (id=11) has new position; dashcard id=12 is still present", async () => {
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, {}],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_update_card",
        arguments: { dashboard_id: 1, dashcard_id: 11, row: 2, col: 4, size_x: 6, size_y: 4 },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      const putInit = calls[1][1] as RequestInit;
      const putBody = JSON.parse(putInit.body as string) as {
        cards: Array<{ id: number; row: number; col: number; size_x: number; size_y: number }>;
      };
      const updated = putBody.cards.find((c) => c.id === 11);
      expect(updated).toBeDefined();
      expect(updated!.row).toBe(2);
      expect(updated!.col).toBe(4);
      expect(updated!.size_x).toBe(6);
      expect(updated!.size_y).toBe(4);
      // Other dashcard must still be present
      const preserved = putBody.cards.find((c) => c.id === 12);
      expect(preserved).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_add_filter (DASH-10, RED until Plan 03)
  // -------------------------------------------------------------------------

  describe("dashboards_add_filter", () => {
    it("the PUT targets /api/dashboard/1 and body.parameters includes both existing and new parameter", async () => {
      // Two sequential calls: GET (fetch current state) then PUT (update parameters)
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, {}],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_add_filter",
        arguments: {
          dashboard_id: 1,
          parameter_id: "p_region",
          name: "Region",
          type: "category",
        },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const putUrl = calls[1][0] as string;
      expect(putUrl).toMatch(/\/api\/dashboard\/1$/);
      const putInit = calls[1][1] as RequestInit;
      expect(putInit.method).toBe("PUT");
      const putBody = JSON.parse(putInit.body as string) as {
        parameters: Array<{ id: string; name: string; type: string; slug: string }>;
      };
      // Should include the pre-existing p_status parameter AND the new p_region parameter
      const ids = putBody.parameters.map((p) => p.id);
      expect(ids).toContain("p_status");
      expect(ids).toContain("p_region");
    });

    it("returns a confirmation message containing the new parameter_id", async () => {
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, {}],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      const res = await client.callTool({
        name: "dashboards_add_filter",
        arguments: {
          dashboard_id: 1,
          parameter_id: "p_region",
          name: "Region",
          type: "category",
        },
      });

      expect(res.isError).toBeFalsy();
      const text = (res.content[0] as { type: string; text: string }).text;
      expect(text).toContain("p_region");
    });
  });

  // -------------------------------------------------------------------------
  // dashboards_connect_filter (DASH-11, RED until Plan 03)
  // -------------------------------------------------------------------------

  describe("dashboards_connect_filter", () => {
    it("the PUT body targets /api/dashboard/1/cards and the target dashcard has correct parameter_mappings", async () => {
      // Two sequential calls: GET (fetch current state) then PUT (update dashcards)
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, {}],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_connect_filter",
        arguments: {
          dashboard_id: 1,
          dashcard_id: 11,
          parameter_id: "p_status",
          tag_name: "status",
        },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const putUrl = calls[1][0] as string;
      expect(putUrl).toMatch(/\/api\/dashboard\/1\/cards$/);
      const putInit = calls[1][1] as RequestInit;
      expect(putInit.method).toBe("PUT");
      const putBody = JSON.parse(putInit.body as string) as {
        cards: Array<{
          id: number;
          card_id: number;
          parameter_mappings: Array<{
            parameter_id: string;
            card_id: number;
            target: unknown;
          }>;
        }>;
      };
      // Target dashcard must have the parameter_mappings with correct target format
      const targetCard = putBody.cards.find((c) => c.id === 11);
      expect(targetCard).toBeDefined();
      expect(targetCard!.parameter_mappings.length).toBeGreaterThanOrEqual(1);
      const mapping = targetCard!.parameter_mappings[0];
      expect(mapping.parameter_id).toBe("p_status");
      expect(mapping.card_id).toBe(101);
      // Native SQL template tag target format (Pitfall 5)
      expect(mapping.target).toEqual(["variable", ["template-tag", "status"]]);
    });

    it("the OTHER dashcard's parameter_mappings is preserved (still an array, not dropped)", async () => {
      const mockFetch = makeSequentialFetchMock([
        [200, SEED_DASHBOARD_DETAIL],
        [200, {}],
      ]);
      vi.stubGlobal("fetch", mockFetch);

      await client.callTool({
        name: "dashboards_connect_filter",
        arguments: {
          dashboard_id: 1,
          dashcard_id: 11,
          parameter_id: "p_status",
          tag_name: "status",
        },
      });

      const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
      const putInit = calls[1][1] as RequestInit;
      const putBody = JSON.parse(putInit.body as string) as {
        cards: Array<{ id: number; parameter_mappings: unknown[] }>;
      };
      // Dashcard id=12 (the other one) must still be present with its parameter_mappings array
      const otherCard = putBody.cards.find((c) => c.id === 12);
      expect(otherCard).toBeDefined();
      expect(Array.isArray(otherCard!.parameter_mappings)).toBe(true);
    });
  });
});
