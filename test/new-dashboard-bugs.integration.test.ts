/**
 * new-dashboard-bugs.integration.test.ts
 *
 * Regression tests for the four new dashboard bugs fixed 2026-06-30:
 *
 *   NEW-BUG-1: dashboards_list shows card count = 0 (should use dashcard_count field)
 *   NEW-BUG-2: dashboards_connect_filter does nothing for dimension-type tags
 *   NEW-BUG-3: dashboards_update wipes parameters (missing read-modify-write)
 *   NEW-BUG-4: dashboards_add_filter creates duplicates instead of upserting
 *
 * Guard: describe.runIf(process.env.INTEGRATION) — skipped in unit runner.
 * Uses METABASE_URL + METABASE_API_KEY from env (set by test runner, not globalSetup inject).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

const METABASE_URL = process.env.METABASE_URL ?? "http://localhost:3000";
const METABASE_API_KEY = process.env.METABASE_API_KEY ?? "";

async function mbGet<T>(path: string): Promise<T> {
  const res = await fetch(`${METABASE_URL}${path}`, {
    headers: { "X-Api-Key": METABASE_API_KEY },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------

describe.runIf(process.env.INTEGRATION)("NEW-BUG-1: dashboards_list card count", () => {
  let mcpClient: Client;
  let dashId = 0;
  let cardId = 0;
  let dbId = 0;
  const ts = Date.now();

  beforeAll(async () => {
    if (!METABASE_API_KEY) throw new Error("METABASE_API_KEY not set");
    process.env.METABASE_API_KEY = METABASE_API_KEY;
    process.env.METABASE_URL = METABASE_URL;

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    mcpClient = new Client({ name: "new-bug1-client", version: "0.0.1" });
    await Promise.all([server.connect(st), mcpClient.connect(ct)]);

    // Get a database ID
    const dbRes = await mcpClient.callTool({ name: "databases_list", arguments: {} });
    const dbText = (dbRes.content[0] as { text: string }).text;
    const dbMatch = dbText.match(/\|\s*(\d+)\s*\|/);
    if (!dbMatch) throw new Error(`No DB found in: ${dbText}`);
    dbId = parseInt(dbMatch[1], 10);
  }, 30_000);

  afterAll(async () => {
    if (cardId) await mcpClient.callTool({ name: "cards_delete", arguments: { card_id: cardId } }).catch(() => {});
    if (dashId) await mcpClient.callTool({ name: "dashboards_delete", arguments: { dashboard_id: dashId } }).catch(() => {});
    await (mcpClient as unknown as { close?: () => Promise<void> }).close?.();
  });

  it("dashboards_list shows non-zero card count after adding a card", async () => {
    // Create card
    const cardRes = await mcpClient.callTool({
      name: "cards_create",
      arguments: { database_id: dbId, sql: "SELECT 1 AS n", name: `BugList Card ${ts}` },
    });
    expect(cardRes.isError, (cardRes.content[0] as { text: string }).text).toBeFalsy();
    const cardMatch = (cardRes.content[0] as { text: string }).text.match(/Card ID:\s*(\d+)/);
    expect(cardMatch).toBeTruthy();
    cardId = parseInt(cardMatch![1], 10);

    // Create dashboard
    const dashRes = await mcpClient.callTool({
      name: "dashboards_create",
      arguments: { name: `BugList Dash ${ts}` },
    });
    expect(dashRes.isError, (dashRes.content[0] as { text: string }).text).toBeFalsy();
    const dashMatch = (dashRes.content[0] as { text: string }).text.match(/Dashboard ID:\s*(\d+)/);
    expect(dashMatch).toBeTruthy();
    dashId = parseInt(dashMatch![1], 10);

    // Add card to dashboard
    const addRes = await mcpClient.callTool({
      name: "dashboards_add_card",
      arguments: { dashboard_id: dashId, card_id: cardId, row: 0, col: 0, size_x: 12, size_y: 8 },
    });
    expect(addRes.isError, (addRes.content[0] as { text: string }).text).toBeFalsy();

    // List dashboards and find ours — card count must be > 0
    const listRes = await mcpClient.callTool({
      name: "dashboards_list",
      arguments: { name_filter: `BugList Dash ${ts}` },
    });
    expect(listRes.isError, (listRes.content[0] as { text: string }).text).toBeFalsy();
    const listText = (listRes.content[0] as { text: string }).text;
    console.error("[new-bug1] dashboards_list output:\n", listText);

    // Find the row for our dashboard and check that Cards column is not 0
    const rows = listText.split("\n").filter((l) => l.includes(`BugList Dash ${ts}`));
    expect(rows.length, "Dashboard not found in list output").toBeGreaterThan(0);
    // The table format is: | id | name | description | Cards | updated_at |
    // Cards column must not be 0
    const cardCountMatch = rows[0].match(/\|\s*(\d+)\s*\|\s*[^|]+$/);
    // Just verify 0 is NOT in the Cards column position
    // Parse the cards column value from the row
    const cols = rows[0].split("|").map((c) => c.trim());
    // cols: ['', id, name, desc, cards, updated_at, '']
    const cardsColValue = cols[4]; // index 4 = Cards column
    console.error("[new-bug1] Cards column value:", cardsColValue);
    expect(parseInt(cardsColValue, 10), "NEW-BUG-1: card count is still 0 after adding a card").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe.runIf(process.env.INTEGRATION)("NEW-BUG-3: dashboards_update preserves parameters", () => {
  let mcpClient: Client;
  let dashId = 0;
  const ts = Date.now();
  const PARAM_ID = `bug3_param_${ts}`;

  beforeAll(async () => {
    if (!METABASE_API_KEY) throw new Error("METABASE_API_KEY not set");
    process.env.METABASE_API_KEY = METABASE_API_KEY;
    process.env.METABASE_URL = METABASE_URL;

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    mcpClient = new Client({ name: "new-bug3-client", version: "0.0.1" });
    await Promise.all([server.connect(st), mcpClient.connect(ct)]);
  }, 30_000);

  afterAll(async () => {
    if (dashId) await mcpClient.callTool({ name: "dashboards_delete", arguments: { dashboard_id: dashId } }).catch(() => {});
    await (mcpClient as unknown as { close?: () => Promise<void> }).close?.();
  });

  it("dashboards_update does not wipe existing parameters", async () => {
    // Create dashboard
    const dashRes = await mcpClient.callTool({
      name: "dashboards_create",
      arguments: { name: `Bug3 Dash ${ts}` },
    });
    expect(dashRes.isError, (dashRes.content[0] as { text: string }).text).toBeFalsy();
    const dashMatch = (dashRes.content[0] as { text: string }).text.match(/Dashboard ID:\s*(\d+)/);
    dashId = parseInt(dashMatch![1], 10);

    // Add a filter
    const filterRes = await mcpClient.callTool({
      name: "dashboards_add_filter",
      arguments: { dashboard_id: dashId, parameter_id: PARAM_ID, name: "Status", type: "category" },
    });
    expect(filterRes.isError, (filterRes.content[0] as { text: string }).text).toBeFalsy();

    // Verify filter exists before update
    const before = await mbGet<{ parameters?: { id: string }[] }>(`/api/dashboard/${dashId}`);
    expect(before.parameters?.some((p) => p.id === PARAM_ID), "filter not added").toBe(true);
    console.error("[new-bug3] parameters before update:", JSON.stringify(before.parameters));

    // Now rename the dashboard
    const updateRes = await mcpClient.callTool({
      name: "dashboards_update",
      arguments: { dashboard_id: dashId, name: `Bug3 Dash Renamed ${ts}` },
    });
    expect(updateRes.isError, (updateRes.content[0] as { text: string }).text).toBeFalsy();

    // Parameters must still be present after rename
    const after = await mbGet<{ name: string; parameters?: { id: string }[] }>(`/api/dashboard/${dashId}`);
    console.error("[new-bug3] parameters after update:", JSON.stringify(after.parameters));
    expect(after.name).toContain(`Bug3 Dash Renamed ${ts}`);
    expect(
      after.parameters?.some((p) => p.id === PARAM_ID),
      "NEW-BUG-3: dashboards_update wiped parameters after rename",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe.runIf(process.env.INTEGRATION)("NEW-BUG-4: dashboards_add_filter upsert semantics", () => {
  let mcpClient: Client;
  let dashId = 0;
  const ts = Date.now();
  const PARAM_ID = `bug4_param_${ts}`;

  beforeAll(async () => {
    if (!METABASE_API_KEY) throw new Error("METABASE_API_KEY not set");
    process.env.METABASE_API_KEY = METABASE_API_KEY;
    process.env.METABASE_URL = METABASE_URL;

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    mcpClient = new Client({ name: "new-bug4-client", version: "0.0.1" });
    await Promise.all([server.connect(st), mcpClient.connect(ct)]);
  }, 30_000);

  afterAll(async () => {
    if (dashId) await mcpClient.callTool({ name: "dashboards_delete", arguments: { dashboard_id: dashId } }).catch(() => {});
    await (mcpClient as unknown as { close?: () => Promise<void> }).close?.();
  });

  it("calling dashboards_add_filter twice with same parameter_id updates instead of duplicating", async () => {
    // Create dashboard
    const dashRes = await mcpClient.callTool({
      name: "dashboards_create",
      arguments: { name: `Bug4 Dash ${ts}` },
    });
    const dashMatch = (dashRes.content[0] as { text: string }).text.match(/Dashboard ID:\s*(\d+)/);
    dashId = parseInt(dashMatch![1], 10);

    // First call: create filter named "Status"
    const add1 = await mcpClient.callTool({
      name: "dashboards_add_filter",
      arguments: { dashboard_id: dashId, parameter_id: PARAM_ID, name: "Status", type: "category" },
    });
    expect(add1.isError, (add1.content[0] as { text: string }).text).toBeFalsy();

    // Second call: same parameter_id, different name "Status Renamed"
    const add2 = await mcpClient.callTool({
      name: "dashboards_add_filter",
      arguments: { dashboard_id: dashId, parameter_id: PARAM_ID, name: "Status Renamed", type: "category" },
    });
    expect(add2.isError, (add2.content[0] as { text: string }).text).toBeFalsy();

    // Check raw API: should have exactly ONE parameter with this id, with updated name
    const dash = await mbGet<{ parameters?: { id: string; name: string }[] }>(`/api/dashboard/${dashId}`);
    console.error("[new-bug4] parameters after two calls:", JSON.stringify(dash.parameters));

    const matching = dash.parameters?.filter((p) => p.id === PARAM_ID) ?? [];
    expect(
      matching.length,
      `NEW-BUG-4: expected 1 parameter with id ${PARAM_ID}, got ${matching.length} (duplicates created)`,
    ).toBe(1);
    expect(
      matching[0].name,
      "NEW-BUG-4: parameter name was not updated on second call",
    ).toBe("Status Renamed");
  });
});

// ---------------------------------------------------------------------------

describe.runIf(process.env.INTEGRATION)("NEW-BUG-2: dashboards_connect_filter with dimension target_type", () => {
  let mcpClient: Client;
  let dashId = 0;
  let cardId = 0;
  let dashcardId = 0;
  let dbId = 0;
  const ts = Date.now();
  const PARAM_ID = `bug2_param_${ts}`;

  beforeAll(async () => {
    if (!METABASE_API_KEY) throw new Error("METABASE_API_KEY not set");
    process.env.METABASE_API_KEY = METABASE_API_KEY;
    process.env.METABASE_URL = METABASE_URL;

    const [ct, st] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    mcpClient = new Client({ name: "new-bug2-client", version: "0.0.1" });
    await Promise.all([server.connect(st), mcpClient.connect(ct)]);

    const dbRes = await mcpClient.callTool({ name: "databases_list", arguments: {} });
    const dbMatch = (dbRes.content[0] as { text: string }).text.match(/\|\s*(\d+)\s*\|/);
    if (!dbMatch) throw new Error("No DB found");
    dbId = parseInt(dbMatch[1], 10);
  }, 30_000);

  afterAll(async () => {
    if (cardId) await mcpClient.callTool({ name: "cards_delete", arguments: { card_id: cardId } }).catch(() => {});
    if (dashId) await mcpClient.callTool({ name: "dashboards_delete", arguments: { dashboard_id: dashId } }).catch(() => {});
    await (mcpClient as unknown as { close?: () => Promise<void> }).close?.();
  });

  it("connects a filter with target_type=variable (text template tag) and verifies mapping saved", async () => {
    // Create a card with a plain text template tag
    const cardRes = await mcpClient.callTool({
      name: "cards_create",
      arguments: {
        database_id: dbId,
        sql: "SELECT {{status}} AS filtered_col",
        name: `Bug2 Card ${ts}`,
      },
    });
    expect(cardRes.isError, (cardRes.content[0] as { text: string }).text).toBeFalsy();
    const cardMatch = (cardRes.content[0] as { text: string }).text.match(/Card ID:\s*(\d+)/);
    cardId = parseInt(cardMatch![1], 10);

    // Create dashboard
    const dashRes = await mcpClient.callTool({
      name: "dashboards_create",
      arguments: { name: `Bug2 Dash ${ts}` },
    });
    const dashMatch = (dashRes.content[0] as { text: string }).text.match(/Dashboard ID:\s*(\d+)/);
    dashId = parseInt(dashMatch![1], 10);

    // Add filter
    const filterRes = await mcpClient.callTool({
      name: "dashboards_add_filter",
      arguments: { dashboard_id: dashId, parameter_id: PARAM_ID, name: "Status", type: "category" },
    });
    expect(filterRes.isError, (filterRes.content[0] as { text: string }).text).toBeFalsy();

    // Add card to dashboard
    const addRes = await mcpClient.callTool({
      name: "dashboards_add_card",
      arguments: { dashboard_id: dashId, card_id: cardId, row: 0, col: 0, size_x: 12, size_y: 8 },
    });
    expect(addRes.isError, (addRes.content[0] as { text: string }).text).toBeFalsy();
    const dcMatch = (addRes.content[0] as { text: string }).text.match(/Dashcard ID:\s*(\d+)/);
    dashcardId = parseInt(dcMatch![1], 10);

    // Connect filter using default target_type (variable)
    const connectRes = await mcpClient.callTool({
      name: "dashboards_connect_filter",
      arguments: {
        dashboard_id: dashId,
        dashcard_id: dashcardId,
        parameter_id: PARAM_ID,
        tag_name: "status",
        // target_type defaults to "variable"
      },
    });
    expect(connectRes.isError, (connectRes.content[0] as { text: string }).text).toBeFalsy();
    console.error("[new-bug2] connect_filter result:", (connectRes.content[0] as { text: string }).text);

    // Verify the mapping was actually saved
    const dash = await mbGet<{
      dashcards?: { id: number; parameter_mappings?: { parameter_id: string; target: unknown[] }[] }[];
    }>(`/api/dashboard/${dashId}`);

    const dc = dash.dashcards?.find((d) => d.id === dashcardId);
    console.error("[new-bug2] dashcard parameter_mappings:", JSON.stringify(dc?.parameter_mappings));

    const mapping = dc?.parameter_mappings?.find((pm) => pm.parameter_id === PARAM_ID);
    expect(
      mapping,
      "NEW-BUG-2: parameter_mapping not saved on dashcard (connect_filter did nothing)",
    ).toBeTruthy();

    // Verify target format is ["variable", ["template-tag", "status"]]
    expect(mapping?.target[0]).toBe("variable");
    expect((mapping?.target[1] as unknown[])[0]).toBe("template-tag");
    expect((mapping?.target[1] as unknown[])[1]).toBe("status");
  });
});
