/**
 * client.test.ts
 *
 * Unit tests for MetabaseClient and MetabaseApiError.
 * All fetch calls are mocked — no real network required.
 *
 * Covers:
 *   1. X-Api-Key header injection on every request
 *   2. getUser() success shape (MetabaseUser interface)
 *   3. 401 non-2xx → throws MetabaseApiError with status 401
 *   4. Non-JSON non-2xx body → still throws MetabaseApiError (no unhandled throw)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetabaseClient, MetabaseApiError } from "../src/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(
  status: number,
  body: unknown,
  { asText = false } = {},
): typeof fetch {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : status === 401 ? "Unauthorized" : "Error",
    json: asText
      ? () => Promise.reject(new SyntaxError("not json"))
      : () => Promise.resolve(body),
    text: () => Promise.resolve(asText ? String(body) : JSON.stringify(body)),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("MetabaseClient", () => {
  const BASE_URL = "http://metabase.example.com";
  const API_KEY = "test-api-key-12345";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Construction & env var fallback
  // -------------------------------------------------------------------------

  it("can be constructed with explicit baseUrl and apiKey", () => {
    expect(() => new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY })).not.toThrow();
  });

  it("throws a plain Error (not MetabaseApiError) when METABASE_URL is missing", () => {
    const orig = process.env.METABASE_URL;
    delete process.env.METABASE_URL;
    delete process.env.METABASE_API_KEY;
    expect(() => new MetabaseClient({})).toThrow(/METABASE_URL/);
    if (orig !== undefined) process.env.METABASE_URL = orig;
  });

  it("throws a plain Error (not MetabaseApiError) when METABASE_API_KEY is missing", () => {
    const origUrl = process.env.METABASE_URL;
    const origKey = process.env.METABASE_API_KEY;
    process.env.METABASE_URL = BASE_URL;
    delete process.env.METABASE_API_KEY;
    expect(() => new MetabaseClient({})).toThrow(/METABASE_API_KEY/);
    if (origUrl !== undefined) process.env.METABASE_URL = origUrl;
    else delete process.env.METABASE_URL;
    if (origKey !== undefined) process.env.METABASE_API_KEY = origKey;
  });

  // -------------------------------------------------------------------------
  // Header injection
  // -------------------------------------------------------------------------

  it("injects X-Api-Key header on every request", async () => {
    const mockFetch = makeFetchMock(200, { id: 1, email: "u@example.com", first_name: "U", last_name: "S", common_name: "U S", is_superuser: false, is_active: true });
    vi.stubGlobal("fetch", mockFetch);

    const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    await client.getUser();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];

    // URL must be prefixed with baseUrl
    expect(url).toBe(`${BASE_URL}/api/user/current`);

    // X-Api-Key must be present and equal to the provided key
    const headers = init?.headers as Record<string, string>;
    expect(headers).toBeDefined();
    expect(headers["X-Api-Key"]).toBe(API_KEY);
    expect(headers["Accept"]).toBe("application/json");
  });

  // -------------------------------------------------------------------------
  // getUser() success
  // -------------------------------------------------------------------------

  it("getUser() returns a MetabaseUser-shaped object on 200", async () => {
    const userData = {
      id: 42,
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      common_name: "Admin User",
      is_superuser: true,
      is_active: true,
    };
    vi.stubGlobal("fetch", makeFetchMock(200, userData));

    const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
    const user = await client.getUser();

    expect(user.id).toBe(42);
    expect(user.email).toBe("admin@example.com");
    expect(user.first_name).toBe("Admin");
    expect(user.last_name).toBe("User");
    expect(user.common_name).toBe("Admin User");
    expect(user.is_superuser).toBe(true);
    expect(user.is_active).toBe(true);
  });

  // -------------------------------------------------------------------------
  // MetabaseApiError on non-2xx (JSON body)
  // -------------------------------------------------------------------------

  it("getUser() throws MetabaseApiError with status 401 for a 401 response", async () => {
    const errorBody = { message: "You do not have permission to do that." };
    vi.stubGlobal("fetch", makeFetchMock(401, errorBody));

    const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    await expect(client.getUser()).rejects.toThrow(MetabaseApiError);

    try {
      await client.getUser();
    } catch (err) {
      // Re-stub because the first getUser() consumed the mock
      // (this block is unreachable — test is already done by rejects.toThrow)
      // Keeping the catch-shape test below instead.
      expect(err).toBeDefined();
    }
  });

  it("MetabaseApiError carries .status === 401 and a non-empty .message", async () => {
    const errorBody = { message: "You do not have permission to do that." };
    vi.stubGlobal("fetch", makeFetchMock(401, errorBody));

    const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    let caught: unknown;
    try {
      await client.getUser();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MetabaseApiError);
    const apiErr = caught as MetabaseApiError;
    expect(apiErr.status).toBe(401);
    expect(apiErr.message.length).toBeGreaterThan(0);
    expect(apiErr.name).toBe("MetabaseApiError");
  });

  it("MetabaseApiError.message prefers API-provided message over status fallback", async () => {
    const errorBody = { message: "Invalid API Key" };
    vi.stubGlobal("fetch", makeFetchMock(401, errorBody));

    const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    let caught: unknown;
    try {
      await client.getUser();
    } catch (err) {
      caught = err;
    }

    const apiErr = caught as MetabaseApiError;
    expect(apiErr.message).toContain("Invalid API Key");
  });

  // -------------------------------------------------------------------------
  // MetabaseApiError on non-2xx (non-JSON body)
  // -------------------------------------------------------------------------

  it("non-JSON non-2xx body still throws MetabaseApiError with correct status", async () => {
    vi.stubGlobal("fetch", makeFetchMock(503, "Service Unavailable", { asText: true }));

    const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

    let caught: unknown;
    try {
      await client.getUser();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MetabaseApiError);
    const apiErr = caught as MetabaseApiError;
    expect(apiErr.status).toBe(503);
    expect(apiErr.message.length).toBeGreaterThan(0);
  });
});
