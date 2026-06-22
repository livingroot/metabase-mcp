/**
 * cold-start.integration.test.ts
 *
 * Ordered cold-start integration scenario covering the full MCP tool chain:
 *   databases_list -> databases_get_schema -> tables_list -> queries_execute_sql
 *   -> cards_create -> cards_execute -> dashboards_create -> dashboards_add_card
 *   -> dashboards_add_filter -> dashboards_connect_filter -> dashboards_get
 *   -> dashboards_delete + cards_delete (cleanup)
 *
 * Guards with describe.runIf(process.env.INTEGRATION) so the suite is a no-op
 * under `npx vitest run` (unit runner) and only executes under:
 *   INTEGRATION=true vitest --config vitest.integration.ts run
 *
 * Reads credentials from globalSetup.integration.ts via inject("apiKey") and
 * inject("baseUrl") (Finding 3). Drives all tools through an in-process MCP
 * client over InMemoryTransport connected to createServer() (Finding 8).
 */

import { inject, describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

describe.runIf(process.env.INTEGRATION)("Cold-start scenario", () => {
  let client: Client;

  // IDs threaded through ordered steps
  let dbId: number;
  let cardId: number;
  let dashId: number;
  let dashcardId: number;

  const timestamp = Date.now();

  beforeAll(async () => {
    // Read credentials from globalSetup (Finding 3)
    const apiKey = inject("apiKey") as string;
    const baseUrl = inject("baseUrl") as string;

    // Set env vars so MetabaseClient reads them in tool handlers (Pitfall 6)
    process.env.METABASE_API_KEY = apiKey;
    process.env.METABASE_URL = baseUrl;

    // Build in-process MCP client over InMemoryTransport
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "cold-start-test-client", version: "0.0.1" });
        await client.connect(clientTransport);
      })(),
    ]);
  });

  afterAll(async () => {
    await client?.close?.();
  });

  // -------------------------------------------------------------------------
  // STEP 1: databases_list (SCHEMA-01)
  // -------------------------------------------------------------------------
  it("STEP 1: databases_list returns at least one database", async () => {
    const res = await client.callTool({ name: "databases_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // Extract first numeric ID from Markdown table row: | ID | Name | ...
    const match = text.match(/\|\s*(\d+)\s*\|/);
    expect(match, `Expected a numeric DB ID in:\n${text}`).toBeTruthy();
    dbId = parseInt(match![1], 10);
    console.error(`[cold-start] STEP 1 dbId=${dbId}`);
  });

  // -------------------------------------------------------------------------
  // STEP 2: databases_get_schema (SCHEMA-02)
  // -------------------------------------------------------------------------
  it("STEP 2: databases_get_schema returns table heading", async () => {
    const res = await client.callTool({
      name: "databases_get_schema",
      arguments: { database_id: dbId },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // formatDatabaseSchema emits "### Table:" for each table
    expect(text).toContain("### Table:");
  });

  // -------------------------------------------------------------------------
  // STEP 3: tables_list (SCHEMA-03)
  // -------------------------------------------------------------------------
  it("STEP 3: tables_list returns table listing", async () => {
    const res = await client.callTool({
      name: "tables_list",
      arguments: { database_id: dbId },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // tables_list header row is always present
    expect(text).toContain("| ID |");
  });

  // -------------------------------------------------------------------------
  // STEP 4: queries_execute_sql (QUERY-01)
  // -------------------------------------------------------------------------
  it("STEP 4: queries_execute_sql returns query result with column name", async () => {
    const res = await client.callTool({
      name: "queries_execute_sql",
      arguments: { database_id: dbId, sql: "SELECT 1 AS test_col", max_rows: 5 },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // The column header row must contain our alias
    expect(text).toContain("test_col");
  });

  // -------------------------------------------------------------------------
  // STEP 5: cards_create (CARDS-04)
  // -------------------------------------------------------------------------
  it("STEP 5: cards_create returns a card ID", async () => {
    const res = await client.callTool({
      name: "cards_create",
      arguments: {
        database_id: dbId,
        sql: "SELECT 1 AS n",
        name: `Integration Test Card ${timestamp}`,
      },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // src/index.ts emits: "Card created successfully. Card ID: N"
    const match = text.match(/Card ID:\s*(\d+)/);
    expect(match, `Expected 'Card ID: N' in:\n${text}`).toBeTruthy();
    cardId = parseInt(match![1], 10);
    console.error(`[cold-start] STEP 5 cardId=${cardId}`);
  });

  // -------------------------------------------------------------------------
  // STEP 6: cards_execute (QUERY-03)
  // -------------------------------------------------------------------------
  it("STEP 6: cards_execute runs the created card", async () => {
    const res = await client.callTool({
      name: "cards_execute",
      arguments: { card_id: cardId },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // Column alias "n" must appear in the result table
    expect(text).toContain("n");
  });

  // -------------------------------------------------------------------------
  // STEP 7: dashboards_create (DASH-04)
  // -------------------------------------------------------------------------
  it("STEP 7: dashboards_create returns a dashboard ID", async () => {
    const res = await client.callTool({
      name: "dashboards_create",
      arguments: { name: `Integration Test Dashboard ${timestamp}` },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // src/index.ts emits: "Dashboard created successfully. Dashboard ID: N"
    const match = text.match(/Dashboard ID:\s*(\d+)/);
    expect(match, `Expected 'Dashboard ID: N' in:\n${text}`).toBeTruthy();
    dashId = parseInt(match![1], 10);
    console.error(`[cold-start] STEP 7 dashId=${dashId}`);
  });

  // -------------------------------------------------------------------------
  // STEP 8: dashboards_add_card (DASH-07)
  // -------------------------------------------------------------------------
  it("STEP 8: dashboards_add_card returns a dashcard ID", async () => {
    const res = await client.callTool({
      name: "dashboards_add_card",
      arguments: { dashboard_id: dashId, card_id: cardId },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // src/index.ts emits: "Card added to dashboard. Dashcard ID: N ..."
    const match = text.match(/Dashcard ID:\s*(\d+)/);
    expect(match, `Expected 'Dashcard ID: N' in:\n${text}`).toBeTruthy();
    dashcardId = parseInt(match![1], 10);
    console.error(`[cold-start] STEP 8 dashcardId=${dashcardId}`);
  });

  // -------------------------------------------------------------------------
  // STEP 9: dashboards_add_filter (DASH-10)
  // -------------------------------------------------------------------------
  it("STEP 9: dashboards_add_filter adds a category filter parameter", async () => {
    const res = await client.callTool({
      name: "dashboards_add_filter",
      arguments: {
        dashboard_id: dashId,
        parameter_id: "test-filter-1",
        name: "Status",
        type: "category",
      },
    });
    expect(res.isError).toBeFalsy();
  });

  // -------------------------------------------------------------------------
  // STEP 10: dashboards_connect_filter (DASH-11)
  // -------------------------------------------------------------------------
  it("STEP 10: dashboards_connect_filter wires filter to dashcard", async () => {
    const res = await client.callTool({
      name: "dashboards_connect_filter",
      arguments: {
        dashboard_id: dashId,
        dashcard_id: dashcardId,
        parameter_id: "test-filter-1",
        tag_name: "status",
      },
    });
    expect(res.isError).toBeFalsy();
  });

  // -------------------------------------------------------------------------
  // STEP 11: dashboards_get (DASH-03)
  // -------------------------------------------------------------------------
  it("STEP 11: dashboards_get reflects full dashboard state", async () => {
    const res = await client.callTool({
      name: "dashboards_get",
      arguments: { dashboard_id: dashId },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // src/index.ts always emits "### Filter Parameters" and "### Cards" sections
    expect(text).toContain("### Filter Parameters");
    expect(text).toContain("test-filter-1");
    expect(text).toContain("### Cards");
    expect(text).toContain(String(dashcardId));
  });

  // -------------------------------------------------------------------------
  // STEP 12: Cleanup — dashboards_delete + cards_delete (DASH-06, CARDS-06)
  // -------------------------------------------------------------------------
  it("STEP 12: dashboards_delete removes the test dashboard", async () => {
    const res = await client.callTool({
      name: "dashboards_delete",
      arguments: { dashboard_id: dashId },
    });
    expect(res.isError).toBeFalsy();
  });

  it("STEP 12b: cards_delete removes the test card", async () => {
    const res = await client.callTool({
      name: "cards_delete",
      arguments: { card_id: cardId },
    });
    expect(res.isError).toBeFalsy();
  });
});
