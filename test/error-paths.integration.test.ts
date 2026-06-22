/**
 * error-paths.integration.test.ts
 *
 * Error-path coverage (INFRA-03): verifies that three classes of errors surface
 * as typed, meaningful tool responses rather than raw thrown exceptions.
 *
 *   1. Invalid API key      → res.isError === true, text contains "401"
 *   2. SQL syntax error     → res.isError === true, meaningful message (> 20 chars,
 *                             contains "queries_execute_sql error" prefix)
 *   3. Non-existent card    → res.isError === true, text contains "cards_get error"
 *      Non-existent dashboard → res.isError === true, text contains "dashboards_get error"
 *
 * Guards with describe.runIf(process.env.INTEGRATION) so the suite is a no-op
 * under `npx vitest run` (unit runner).
 *
 * CRITICAL — env var restoration (T-06-04 / Pitfall 6):
 * The invalid-key test temporarily sets METABASE_API_KEY to a bogus value.
 * vi.stubEnv() is used for auto-restoration after each test so no subsequent
 * test inherits the poisoned key — even if the assertion throws.
 */

import {
  inject,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

describe.runIf(process.env.INTEGRATION)("Error paths", () => {
  let client: Client;
  let dbId: number;

  beforeAll(async () => {
    const apiKey = inject("apiKey") as string;
    const baseUrl = inject("baseUrl") as string;

    // Set env vars for the real (valid) API key
    process.env.METABASE_API_KEY = apiKey;
    process.env.METABASE_URL = baseUrl;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();

    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "error-path-test-client", version: "0.0.1" });
        await client.connect(clientTransport);
      })(),
    ]);

    // Resolve a valid database ID for the SQL error test
    const listRes = await client.callTool({ name: "databases_list", arguments: {} });
    const listText = (listRes.content[0] as { text: string }).text;
    const dbMatch = listText.match(/\|\s*(\d+)\s*\|/);
    if (!dbMatch) throw new Error(`databases_list returned no parseable DB ID:\n${listText}`);
    dbId = parseInt(dbMatch[1], 10);
    console.error(`[error-paths] resolved dbId=${dbId}`);
  });

  afterAll(async () => {
    await client?.close?.();
  });

  // =========================================================================
  // Error class 1: Invalid API key (INFRA-03)
  // =========================================================================

  it("invalid API key → isError=true and response contains '401'", async () => {
    // vi.stubEnv auto-restores the original env var value after this test completes,
    // even if the assertion throws — preventing Pitfall 6 key poisoning (T-06-04).
    vi.stubEnv("METABASE_API_KEY", "invalid-key-that-will-never-work-12345");

    // Tool handlers instantiate MetabaseClient({}) which reads from process.env.
    // With the bogus key, the Metabase API returns 401, which MetabaseClient
    // converts to a MetabaseApiError, which the tool handler catches and returns
    // as an isError response.
    const res = await client.callTool({ name: "databases_list", arguments: {} });

    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("401");

    // vi.stubEnv auto-restores at test boundary — verify real key is restored
    vi.unstubAllEnvs();
    const restoredKey = inject("apiKey") as string;
    process.env.METABASE_API_KEY = restoredKey;
    console.error("[error-paths] Invalid-key test passed; real key restored");
  });

  // =========================================================================
  // Error class 2: SQL syntax error (QUERY-01 / INFRA-03)
  // =========================================================================

  it("SQL syntax error → isError=true and meaningful error message", async () => {
    const res = await client.callTool({
      name: "queries_execute_sql",
      arguments: {
        database_id: dbId,
        sql: "SELECT FROM WHERE BROKEN",
        max_rows: 5,
      },
    });

    // The query handler returns isError for both Metabase status:"failed" and
    // a thrown MetabaseApiError — both paths produce a non-trivial message.
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;

    // Must be a meaningful message (not just "error") — at least 20 chars
    expect(text.length).toBeGreaterThan(20);

    // Must carry the tool's error prefix (src/index.ts emits this prefix)
    expect(text).toContain("queries_execute_sql error");

    console.error(`[error-paths] SQL error message (${text.length} chars): ${text.slice(0, 80)}`);
  });

  // =========================================================================
  // Error class 3: Non-existent card (CARDS-03 / INFRA-03)
  // =========================================================================

  it("non-existent card → isError=true and structured 'cards_get error' prefix", async () => {
    const res = await client.callTool({
      name: "cards_get",
      arguments: { card_id: 999999 },
    });

    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;

    // Confirms the MetabaseApiError was caught and re-emitted as isError (INFRA-03)
    // rather than propagating as a raw throw — the structured prefix proves it.
    expect(text).toContain("cards_get error");

    console.error(`[error-paths] Not-found card message: ${text.slice(0, 80)}`);
  });

  // =========================================================================
  // Error class 4: Non-existent dashboard (DASH-03 / INFRA-03)
  // =========================================================================

  it("non-existent dashboard → isError=true and structured 'dashboards_get error' prefix", async () => {
    const res = await client.callTool({
      name: "dashboards_get",
      arguments: { dashboard_id: 999999 },
    });

    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;

    // Confirms the MetabaseApiError was caught and re-emitted as isError (INFRA-03)
    expect(text).toContain("dashboards_get error");

    console.error(`[error-paths] Not-found dashboard message: ${text.slice(0, 80)}`);
  });
});
