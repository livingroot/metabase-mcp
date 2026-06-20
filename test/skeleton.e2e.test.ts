/**
 * skeleton.e2e.test.ts
 *
 * RED state: This test FAILS until plan 01-02 creates src/index.ts.
 *
 * Purpose: Define the happy-path contract for the server_ping stub tool.
 * The test connects an MCP Client to the server over an in-process
 * InMemoryTransport pair, verifies the tool is registered, calls it,
 * and asserts a valid non-error MCP text result is returned.
 *
 * Tool naming follows D-10: resource_verb convention (server_ping).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/index.js";

describe("MCP server — server_ping stub tool (walking skeleton e2e)", () => {
  let client: Client;

  beforeAll(async () => {
    // Create a linked in-process transport pair (no subprocess, no network)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    // Instantiate the server (NOT auto-connected to stdio)
    const server = createServer();

    // Connect both ends in parallel
    await Promise.all([
      server.connect(serverTransport),
      (async () => {
        client = new Client({ name: "skeleton-test-client", version: "0.0.1" });
        await client.connect(clientTransport);
      })(),
    ]);
  });

  afterAll(async () => {
    await client?.close?.();
  });

  it("registers a tool named server_ping", async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("server_ping");
  });

  it("calls server_ping and returns a valid non-error MCP text result", async () => {
    const res = await client.callTool({ name: "server_ping", arguments: {} });

    // Must not be an error result
    expect(res.isError).toBeFalsy();

    // Must have at least one content item
    expect(res.content).toBeDefined();
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content.length).toBeGreaterThan(0);

    // First content item must be a text type
    const first = res.content[0] as { type: string; text: string };
    expect(first.type).toBe("text");

    // The text payload must be non-empty (stub returns a known JSON status string)
    expect(typeof first.text).toBe("string");
    expect(first.text.length).toBeGreaterThan(0);
  });
});
