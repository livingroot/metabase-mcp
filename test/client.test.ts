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

  // -------------------------------------------------------------------------
  // listDatabases()
  // -------------------------------------------------------------------------

  describe("listDatabases()", () => {
    it("returns the raw response when fetch resolves a plain array body", async () => {
      const mockData = [
        { id: 1, name: "Sample Database", engine: "h2", is_full_sync: true, is_sample: true },
        { id: 2, name: "Production", engine: "postgres", is_full_sync: true, is_sample: false },
      ];
      vi.stubGlobal("fetch", makeFetchMock(200, mockData));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      const result = await client.listDatabases();

      // Client returns the raw response; handler normalises shape
      expect(result).toEqual(mockData);
    });

    it("returns the raw envelope object when fetch resolves a { data: [], total } body", async () => {
      const mockEnvelope = {
        data: [{ id: 1, name: "Sample Database", engine: "h2", is_full_sync: true, is_sample: true }],
        total: 1,
      };
      vi.stubGlobal("fetch", makeFetchMock(200, mockEnvelope));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      const result = await client.listDatabases();

      // Raw envelope returned as-is — handler normalises with Array.isArray guard
      expect(result).toEqual(mockEnvelope);
    });

    it("issues GET /api/database with the X-Api-Key header", async () => {
      const mockFetch = makeFetchMock(200, []);
      vi.stubGlobal("fetch", mockFetch);

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      await client.listDatabases();

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/database`);
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe(API_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // getTableQueryMetadata()
  // -------------------------------------------------------------------------

  describe("getTableQueryMetadata()", () => {
    it("returns an object whose fields array carries base_type, semantic_type, database_required, and visibility_type", async () => {
      const mockTableMetadata = {
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
        ],
      };
      vi.stubGlobal("fetch", makeFetchMock(200, mockTableMetadata));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      const result = await client.getTableQueryMetadata(10);

      expect(result.id).toBe(10);
      expect(result.fields[0].base_type).toBe("type/Integer");
      expect(result.fields[0].semantic_type).toBe("type/PK");
      expect(result.fields[0].database_required).toBe(false);
      expect(result.fields[0].visibility_type).toBe("normal");
      expect(result.fields[1].database_required).toBe(true);
    });

    it("issues GET /api/table/:id/query_metadata with the X-Api-Key header", async () => {
      const mockFetch = makeFetchMock(200, {
        id: 10,
        name: "orders",
        display_name: "Orders",
        schema: "public",
        db_id: 2,
        description: null,
        estimated_row_count: null,
        fields: [],
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      await client.getTableQueryMetadata(10);

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/table/10/query_metadata`);
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe(API_KEY);
    });

    it("throws MetabaseApiError with status 404 when the table does not exist", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

      let caught: unknown;
      try {
        await client.getTableQueryMetadata(9999);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(MetabaseApiError);
      expect((caught as MetabaseApiError).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // getField()
  // -------------------------------------------------------------------------

  describe("getField()", () => {
    it("returns an object exposing base_type, semantic_type, and has_field_values", async () => {
      const mockField = {
        id: 101,
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
      vi.stubGlobal("fetch", makeFetchMock(200, mockField));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      const result = await client.getField(101);

      expect(result.base_type).toBe("type/Text");
      expect(result.semantic_type).toBe("type/Category");
      expect(result.has_field_values).toBe("list");
    });

    it("issues GET /api/field/:id with the X-Api-Key header", async () => {
      const mockFetch = makeFetchMock(200, {
        id: 101,
        name: "status",
        display_name: "Status",
        base_type: "type/Text",
        semantic_type: "type/Category",
        visibility_type: "normal",
        database_required: true,
        fk_target_field_id: null,
        has_field_values: "list",
        description: null,
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      await client.getField(101);

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/field/101`);
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe(API_KEY);
    });

    it("throws MetabaseApiError with status 404 when field does not exist", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

      let caught: unknown;
      try {
        await client.getField(9999);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(MetabaseApiError);
      expect((caught as MetabaseApiError).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // getFieldValues()
  // -------------------------------------------------------------------------

  describe("getFieldValues()", () => {
    it("returns an object whose values is an array of arrays", async () => {
      const mockValues = {
        field_id: 101,
        values: [["pending"], ["shipped"], ["return_requested"], ["returned"]],
        human_readable_values: [],
      };
      vi.stubGlobal("fetch", makeFetchMock(200, mockValues));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      const result = await client.getFieldValues(101);

      expect(Array.isArray(result.values)).toBe(true);
      expect(result.values[0]).toEqual(["pending"]);
      expect(result.values.length).toBe(4);
    });

    it("issues GET /api/field/:id/values with the X-Api-Key header", async () => {
      const mockFetch = makeFetchMock(200, {
        field_id: 101,
        values: [["pending"], ["shipped"]],
        human_readable_values: [],
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      await client.getFieldValues(101);

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/field/101/values`);
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe(API_KEY);
    });
  });

  // -------------------------------------------------------------------------
  // getDatabaseMetadata()
  // -------------------------------------------------------------------------

  describe("getDatabaseMetadata()", () => {
    it("returns an object whose tables[0].fields[0] carries base_type and semantic_type", async () => {
      const mockMetadata = {
        id: 2,
        name: "Production DB",
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
            ],
          },
        ],
      };
      vi.stubGlobal("fetch", makeFetchMock(200, mockMetadata));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      const result = await client.getDatabaseMetadata(2);

      expect(result.id).toBe(2);
      expect(result.tables[0].fields[0].base_type).toBe("type/Integer");
      expect(result.tables[0].fields[0].semantic_type).toBe("type/PK");
    });

    it("issues GET /api/database/:id/metadata with the X-Api-Key header", async () => {
      const mockFetch = makeFetchMock(200, { id: 1, name: "db", engine: "h2", tables: [] });
      vi.stubGlobal("fetch", mockFetch);

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });
      await client.getDatabaseMetadata(1);

      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/database/1/metadata`);
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Api-Key"]).toBe(API_KEY);
    });

    it("throws MetabaseApiError with status 404 when the database does not exist", async () => {
      vi.stubGlobal("fetch", makeFetchMock(404, { message: "Not found." }));

      const client = new MetabaseClient({ baseUrl: BASE_URL, apiKey: API_KEY });

      let caught: unknown;
      try {
        await client.getDatabaseMetadata(9999);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(MetabaseApiError);
      expect((caught as MetabaseApiError).status).toBe(404);
    });
  });
});
