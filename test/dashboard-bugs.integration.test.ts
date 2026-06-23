/**
 * dashboard-bugs.integration.test.ts
 *
 * Regression tests for three bugs fixed in the dashboard tools:
 *   BUG-1: ordered_tabs: [] in PUT /api/dashboard/:id/cards destroyed tab layout
 *   BUG-2: missing dashboard_tab_id in fullCardsArray prevented filter from connecting
 *   BUG-3: dashboards_add_filter wiped tabs because updateDashboard omitted tabs in PUT body
 *
 * Scenario: fully-featured dashboard with 2 tabs, 1 card with a template tag,
 * 1 filter, filter connected to the card. Verifies that:
 *   - tabs survive dashboards_add_filter                     (BUG-3)
 *   - tabs survive dashboards_add_card                       (BUG-1)
 *   - filter is actually connected after dashboards_connect_filter (BUG-2)
 *   - tabs survive dashboards_connect_filter                 (BUG-1)
 *   - tabs survive dashboards_update_card                    (BUG-1)
 *   - filter mapping survives dashboards_update_card         (BUG-2)
 *   - tabs survive dashboards_remove_card                    (BUG-1)
 *
 * Uses METABASE_URL + METABASE_API_KEY env vars directly (no globalSetup inject).
 * Guard: describe.runIf(process.env.INTEGRATION) — skipped in unit runner.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

const METABASE_URL = process.env.METABASE_URL ?? "http://localhost:3000";
const METABASE_API_KEY = process.env.METABASE_API_KEY ?? "";

/** Raw Metabase API call, bypassing the MCP server. */
async function mbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${METABASE_URL}${path}`, {
    headers: { "X-Api-Key": METABASE_API_KEY },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function mbPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${METABASE_URL}${path}`, {
    method: "PUT",
    headers: { "X-Api-Key": METABASE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------

describe.runIf(process.env.INTEGRATION)("Dashboard tab & filter regression (BUG-1/2/3)", () => {
  let mcpClient: Client;
  let dbId: number;
  const ts = Date.now();

  let dashId = 0;
  let cardId = 0;
  let dashcardId = 0;
  const PARAM_ID = `status_${ts}`;

  // -------------------------------------------------------------------------

  beforeAll(async () => {
    if (!METABASE_API_KEY) throw new Error("METABASE_API_KEY is not set");

    process.env.METABASE_API_KEY = METABASE_API_KEY;
    process.env.METABASE_URL = METABASE_URL;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        mcpClient = new Client({ name: "bug-regression-client", version: "0.0.1" });
        await mcpClient.connect(clientTransport);
      })(),
    ]);

    // Resolve a database ID
    const listRes = await mcpClient.callTool({ name: "databases_list", arguments: {} });
    const listText = (listRes.content[0] as { text: string }).text;
    const m = listText.match(/\|\s*(\d+)\s*\|/);
    if (!m) throw new Error(`databases_list returned no DB:\n${listText}`);
    dbId = parseInt(m[1], 10);
    console.error(`[bug-regression] dbId=${dbId}`);
  }, 30_000);

  afterAll(async () => {
    if (dashId) {
      try {
        await mcpClient.callTool({ name: "dashboards_delete", arguments: { dashboard_id: dashId } });
        console.error("[bug-regression] dashboard cleaned up");
      } catch { /* ignore */ }
    }
    if (cardId) {
      try {
        await mcpClient.callTool({ name: "cards_delete", arguments: { card_id: cardId } });
        console.error("[bug-regression] card cleaned up");
      } catch { /* ignore */ }
    }
    await (mcpClient as unknown as { close?: () => Promise<void> }).close?.();
  });

  // -------------------------------------------------------------------------
  // 1. Create a card with a {{status}} template tag
  // -------------------------------------------------------------------------

  it("1 · creates a card with a template tag in SQL", async () => {
    const res = await mcpClient.callTool({
      name: "cards_create",
      arguments: {
        database_id: dbId,
        sql: "SELECT {{status}} AS filtered_col",
        name: `BugReg Card ${ts}`,
      },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    const m = text.match(/Card ID:\s*(\d+)/);
    expect(m, `Expected 'Card ID: N' in: ${text}`).toBeTruthy();
    cardId = parseInt(m![1], 10);
    console.error(`[bug-regression] cardId=${cardId}`);
  });

  // -------------------------------------------------------------------------
  // 2. Create a dashboard, then add 2 tabs via raw API
  // -------------------------------------------------------------------------

  it("2 · creates dashboard with 2 tabs via Metabase API", async () => {
    // Create empty dashboard via MCP tool
    const res = await mcpClient.callTool({
      name: "dashboards_create",
      arguments: { name: `BugReg Dashboard ${ts}`, description: "Regression test dashboard" },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    const m = text.match(/Dashboard ID:\s*(\d+)/);
    expect(m, `Expected 'Dashboard ID: N' in: ${text}`).toBeTruthy();
    dashId = parseInt(m![1], 10);
    console.error(`[bug-regression] dashId=${dashId}`);

    // Add 2 tabs via raw API (negative IDs → server assigns real IDs)
    await mbPut(`/api/dashboard/${dashId}/cards`, {
      cards: [],
      ordered_tabs: [
        { id: -1, name: "Main", position: 0 },
        { id: -2, name: "Details", position: 1 },
      ],
    });

    // Verify 2 tabs exist
    const dash = await mbGet<{ tabs?: { id: number; name: string }[] }>(`/api/dashboard/${dashId}`);
    expect(dash.tabs?.length, "Expected 2 tabs after creation").toBe(2);
    console.error(`[bug-regression] tabs after creation: ${JSON.stringify(dash.tabs)}`);
  });

  // -------------------------------------------------------------------------
  // 3. BUG-3: add_filter must NOT destroy tabs
  // -------------------------------------------------------------------------

  it("3 · [BUG-3] dashboards_add_filter preserves tab layout", async () => {
    const res = await mcpClient.callTool({
      name: "dashboards_add_filter",
      arguments: {
        dashboard_id: dashId,
        parameter_id: PARAM_ID,
        name: "Status",
        type: "category",
      },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();

    const dash = await mbGet<{
      tabs?: { id: number }[];
      parameters?: { id: string }[];
    }>(`/api/dashboard/${dashId}`);

    expect(
      dash.tabs?.length,
      "BUG-3: dashboards_add_filter destroyed tabs — tabs count wrong",
    ).toBe(2);

    expect(
      dash.parameters?.some((p) => p.id === PARAM_ID),
      "dashboards_add_filter did not add the parameter",
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. BUG-1: add_card must NOT destroy tabs
  // -------------------------------------------------------------------------

  it("4 · [BUG-1] dashboards_add_card preserves tab layout", async () => {
    const res = await mcpClient.callTool({
      name: "dashboards_add_card",
      arguments: {
        dashboard_id: dashId,
        card_id: cardId,
        row: 0,
        col: 0,
        size_x: 12,
        size_y: 8,
      },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    const m = text.match(/Dashcard ID:\s*(\d+)/);
    expect(m, `Expected 'Dashcard ID: N' in: ${text}`).toBeTruthy();
    dashcardId = parseInt(m![1], 10);
    console.error(`[bug-regression] dashcardId=${dashcardId}`);

    const dash = await mbGet<{ tabs?: { id: number }[] }>(`/api/dashboard/${dashId}`);
    expect(
      dash.tabs?.length,
      "BUG-1: dashboards_add_card destroyed tabs",
    ).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 5. BUG-1 + BUG-2: connect_filter must preserve tabs AND actually wire filter
  // -------------------------------------------------------------------------

  it("5 · [BUG-1+2] dashboards_connect_filter preserves tabs and wires filter", async () => {
    const res = await mcpClient.callTool({
      name: "dashboards_connect_filter",
      arguments: {
        dashboard_id: dashId,
        dashcard_id: dashcardId,
        parameter_id: PARAM_ID,
        tag_name: "status",
      },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();

    const dash = await mbGet<{
      tabs?: { id: number }[];
      dashcards?: { id: number; parameter_mappings?: { parameter_id: string }[] }[];
    }>(`/api/dashboard/${dashId}`);

    // Tabs must survive
    expect(
      dash.tabs?.length,
      "BUG-1: dashboards_connect_filter destroyed tabs",
    ).toBe(2);

    // Filter must be connected
    const dc = dash.dashcards?.find((d) => d.id === dashcardId);
    expect(dc, `dashcard ${dashcardId} not found after connect_filter`).toBeTruthy();
    const isConnected = dc?.parameter_mappings?.some((pm) => pm.parameter_id === PARAM_ID);
    expect(
      isConnected,
      "BUG-2: filter parameter_mapping was not saved on dashcard",
    ).toBe(true);

    console.error(`[bug-regression] parameter_mappings: ${JSON.stringify(dc?.parameter_mappings)}`);
  });

  // -------------------------------------------------------------------------
  // 6. BUG-1: update_card must preserve tabs AND not break filter mapping
  // -------------------------------------------------------------------------

  it("6 · [BUG-1] dashboards_update_card preserves tabs and filter mapping", async () => {
    const res = await mcpClient.callTool({
      name: "dashboards_update_card",
      arguments: {
        dashboard_id: dashId,
        dashcard_id: dashcardId,
        row: 4,
        col: 0,
        size_x: 24,
        size_y: 10,
      },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();

    const dash = await mbGet<{
      tabs?: { id: number }[];
      dashcards?: {
        id: number;
        row: number;
        col: number;
        size_x: number;
        size_y: number;
        parameter_mappings?: { parameter_id: string }[];
      }[];
    }>(`/api/dashboard/${dashId}`);

    // Tabs must survive
    expect(dash.tabs?.length, "BUG-1: dashboards_update_card destroyed tabs").toBe(2);

    // Position must be updated
    const dc = dash.dashcards?.find((d) => d.id === dashcardId);
    expect(dc?.row, "row was not updated").toBe(4);
    expect(dc?.size_x, "size_x was not updated").toBe(24);
    expect(dc?.size_y, "size_y was not updated").toBe(10);

    // Filter mapping must still be present
    const isConnected = dc?.parameter_mappings?.some((pm) => pm.parameter_id === PARAM_ID);
    expect(
      isConnected,
      "BUG-2: filter mapping was lost after dashboards_update_card",
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. BUG-1: remove_card must preserve tabs
  // -------------------------------------------------------------------------

  it("7 · [BUG-1] dashboards_remove_card preserves tab layout", async () => {
    const res = await mcpClient.callTool({
      name: "dashboards_remove_card",
      arguments: { dashboard_id: dashId, dashcard_id: dashcardId },
    });
    expect(res.isError, (res.content[0] as { text: string }).text).toBeFalsy();

    const dash = await mbGet<{
      tabs?: { id: number }[];
      dashcards?: { id: number }[];
    }>(`/api/dashboard/${dashId}`);

    expect(dash.tabs?.length, "BUG-1: dashboards_remove_card destroyed tabs").toBe(2);
    expect(
      dash.dashcards?.find((d) => d.id === dashcardId),
      "dashcard should be gone after remove",
    ).toBeFalsy();
  });

  // -------------------------------------------------------------------------
  // 8. Snapshot: final dashboard state is internally consistent
  // -------------------------------------------------------------------------

  it("8 · final dashboard state: 2 tabs, 0 cards, 1 filter, name unchanged", async () => {
    const dash = await mbGet<{
      name: string;
      tabs?: { id: number }[];
      dashcards?: unknown[];
      parameters?: { id: string }[];
    }>(`/api/dashboard/${dashId}`);

    expect(dash.name).toContain(`BugReg Dashboard ${ts}`);
    expect(dash.tabs?.length).toBe(2);
    expect(dash.dashcards?.length ?? 0).toBe(0);
    expect(dash.parameters?.some((p) => p.id === PARAM_ID)).toBe(true);
  });
});
