/**
 * client.ts
 *
 * D-01: Owns MetabaseClient and MetabaseApiError.
 * D-05: Auth via X-Api-Key header; credentials from METABASE_URL + METABASE_API_KEY env vars.
 * D-06: Native fetch only — no got, axios, or other HTTP clients.
 * D-09: All logging via console.error() — console.log() is forbidden (stdout = JSON-RPC channel).
 *
 * MetabaseApiError: typed error thrown on any non-2xx response.
 * MetabaseClient:   HTTP client scoped to a single Metabase instance.
 */

import type { MetabaseUser, MetabaseDatabaseMetadata, MetabaseDatabaseListResponse, MetabaseTableQueryMetadata, MetabaseField, MetabaseFieldValues, MetabaseDatasetResponse, MetabaseQueryParameter, MetabaseCardListItem, MetabaseCard } from "./types.js";

// ---------------------------------------------------------------------------
// MetabaseApiError
// ---------------------------------------------------------------------------

/**
 * Thrown by MetabaseClient when Metabase returns a non-2xx HTTP response.
 * Carries the HTTP status code and the API-provided error message (or a
 * fallback status-line string when the response body is not valid JSON).
 */
export class MetabaseApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "MetabaseApiError";
    this.status = status;
    this.body = body;
    // Restore correct prototype chain (required in TypeScript when extending Error)
    Object.setPrototypeOf(this, MetabaseApiError.prototype);
  }
}

// ---------------------------------------------------------------------------
// MetabaseClient options
// ---------------------------------------------------------------------------

export interface MetabaseClientOptions {
  /** Base URL of the Metabase instance, e.g. "http://localhost:3000". */
  baseUrl?: string;
  /** Metabase API key created in Admin > Settings > Authentication > API Keys. */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// MetabaseClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for the Metabase REST API.
 *
 * Injects the X-Api-Key header on every request and throws a typed
 * MetabaseApiError on any non-2xx response.
 *
 * Usage:
 *   const client = new MetabaseClient({ baseUrl, apiKey });
 *   // or rely on METABASE_URL + METABASE_API_KEY env vars:
 *   const client = new MetabaseClient({});
 */
export class MetabaseClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: MetabaseClientOptions) {
    const baseUrl = options.baseUrl ?? process.env["METABASE_URL"];
    const apiKey = options.apiKey ?? process.env["METABASE_API_KEY"];

    if (!baseUrl) {
      throw new Error(
        "MetabaseClient: METABASE_URL is required (pass options.baseUrl or set the METABASE_URL env var)",
      );
    }
    if (!apiKey) {
      throw new Error(
        "MetabaseClient: METABASE_API_KEY is required (pass options.apiKey or set the METABASE_API_KEY env var)",
      );
    }

    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.apiKey = apiKey;
  }

  // -------------------------------------------------------------------------
  // Private request helper
  // -------------------------------------------------------------------------

  /**
   * Makes an authenticated HTTP request to the Metabase API.
   *
   * Prepends baseUrl, injects X-Api-Key + Accept: application/json headers,
   * and on a non-2xx response reads the body and throws MetabaseApiError.
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const mergedHeaders: Record<string, string> = {
      "X-Api-Key": this.apiKey,
      Accept: "application/json",
      // Allow callers to override Content-Type etc.
      ...(init.headers as Record<string, string> | undefined),
    };

    const response = await fetch(url, {
      ...init,
      headers: mergedHeaders,
    });

    if (!response.ok) {
      // Attempt to extract the API-provided error message from the JSON body.
      // Fall back to plain text, then a status-line string — never throw from
      // error handling itself (T-01-08: untrusted Metabase JSON response).
      let errorMessage: string;
      let rawBody: unknown;
      try {
        // Read body once as text — calling .json() then .text() on the same
        // undici ReadableStream throws "body used already" in Node.js 18+.
        const text = await response.text();
        try {
          rawBody = JSON.parse(text);
          const body = rawBody as { message?: string };
          errorMessage = body.message ?? `Metabase API error ${response.status}: ${response.statusText}`;
        } catch {
          rawBody = text;
          errorMessage = text.length > 0
            ? `Metabase API error ${response.status}: ${text}`
            : `Metabase API error ${response.status}: ${response.statusText}`;
        }
      } catch {
        rawBody = undefined;
        errorMessage = `Metabase API error ${response.status}: ${response.statusText}`;
      }

      throw new MetabaseApiError(errorMessage, response.status, rawBody);
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // API methods
  // -------------------------------------------------------------------------

  /**
   * Returns the currently authenticated user.
   * Calls GET /api/user/current.
   *
   * Validates the API key on startup — a 401 response means the key is
   * invalid or belongs to a user without sufficient permissions (INFRA-02).
   */
  async getUser(): Promise<MetabaseUser> {
    return this.request<MetabaseUser>("/api/user/current");
  }

  /**
   * Returns the list of databases connected to this Metabase instance.
   * Calls GET /api/database.
   *
   * Returns the raw response (either a plain array or a { data, total } envelope).
   * The tool handler in src/index.ts normalises the shape with an Array.isArray guard
   * (Pitfall 1 from 02-RESEARCH.md).
   */
  async listDatabases(): Promise<MetabaseDatabaseListResponse | unknown[]> {
    return this.request<MetabaseDatabaseListResponse | unknown[]>("/api/database");
  }

  /**
   * Returns the full schema tree for a database: all tables with their fields.
   * Calls GET /api/database/:id/metadata.
   *
   * A single call returns the complete DB → tables → fields tree (SCHEMA-02).
   * Throws MetabaseApiError on non-2xx responses (e.g. 404 for unknown database_id).
   */
  async getDatabaseMetadata(databaseId: number): Promise<MetabaseDatabaseMetadata> {
    return this.request<MetabaseDatabaseMetadata>(`/api/database/${databaseId}/metadata`);
  }

  /**
   * Returns column-level metadata for a single table.
   * Calls GET /api/table/:id/query_metadata.
   *
   * Returns the table with its full fields array — each field carries base_type,
   * semantic_type, visibility_type, and database_required (NOT NULL proxy).
   * Throws MetabaseApiError on non-2xx responses (e.g. 404 for unknown table_id).
   */
  async getTableQueryMetadata(tableId: number): Promise<MetabaseTableQueryMetadata> {
    return this.request<MetabaseTableQueryMetadata>(`/api/table/${tableId}/query_metadata`);
  }

  /**
   * Returns metadata for a single field (column).
   * Calls GET /api/field/:id.
   *
   * Returns a MetabaseField object including base_type, semantic_type,
   * has_field_values, and display_name.
   * Throws MetabaseApiError on non-2xx responses (e.g. 404 for unknown field_id).
   */
  async getField(fieldId: number): Promise<MetabaseField> {
    return this.request<MetabaseField>(`/api/field/${fieldId}`);
  }

  /**
   * Returns the enumerated valid values for a low-cardinality field.
   * Calls GET /api/field/:id/values.
   *
   * Should only be called when MetabaseField.has_field_values === "list"
   * (Pitfall 3 from 02-RESEARCH.md: skip for "search", "none", and null).
   * Returns values as an array of arrays (e.g. [["pending"], ["shipped"]]).
   * Throws MetabaseApiError on non-2xx responses.
   */
  async getFieldValues(fieldId: number): Promise<MetabaseFieldValues> {
    return this.request<MetabaseFieldValues>(`/api/field/${fieldId}/values`);
  }

  // -------------------------------------------------------------------------
  // Phase 3: Query Execution methods
  // -------------------------------------------------------------------------

  /**
   * Executes a saved Metabase question (card) by ID.
   * Calls POST /api/card/:id/query with Content-Type: application/json.
   *
   * Maps each parameter from simplified {name, value, type?} to Metabase's
   * internal wire format: {type, value, target: ["variable", ["template-tag", name]]}.
   * type defaults to "category" when omitted (D-05 from 03-CONTEXT.md).
   *
   * The request body contains only parameters — no database/native fields
   * because the card carries its own stored query (D-14 from 03-CONTEXT.md).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async executeCard(
    cardId: number,
    parameters: MetabaseQueryParameter[] = [],
  ): Promise<MetabaseDatasetResponse> {
    return this.request<MetabaseDatasetResponse>(`/api/card/${cardId}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parameters: parameters.map((p) => ({
          type: p.type ?? "category",
          value: p.value,
          target: ["variable", ["template-tag", p.name]],
        })),
      }),
    });
  }

  /**
   * Executes raw SQL against a Metabase database.
   * Calls POST /api/dataset with Content-Type: application/json.
   *
   * Maps each parameter from simplified {name, value, type?} to Metabase's
   * internal wire format: {type, value, target: ["variable", ["template-tag", name]]}.
   * type defaults to "category" when omitted (D-05 from 03-CONTEXT.md).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async executeSQL(
    databaseId: number,
    sql: string,
    parameters: MetabaseQueryParameter[] = [],
  ): Promise<MetabaseDatasetResponse> {
    return this.request<MetabaseDatasetResponse>("/api/dataset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        database: databaseId,
        type: "native",
        native: { query: sql, template_tags: {} },
        parameters: parameters.map((p) => ({
          type: p.type ?? "category",
          value: p.value,
          target: ["variable", ["template-tag", p.name]],
        })),
      }),
    });
  }

  // -------------------------------------------------------------------------
  // Phase 4: Card CRUD methods
  // -------------------------------------------------------------------------

  /**
   * Returns the list of saved questions (cards) from this Metabase instance.
   * Calls GET /api/card or GET /api/card?q=<nameFilter> when a filter is provided.
   *
   * GET /api/card returns a bare array — NOT a {data, total} envelope (Pitfall 1).
   * When nameFilter is provided:
   *   1. Appends ?q=<nameFilter> for server-side filtering (CARDS-02).
   *   2. Applies client-side .filter() as a safety net in case server q param
   *      semantics differ (Open Question 1 from 04-RESEARCH.md).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async listCards(nameFilter?: string): Promise<MetabaseCardListItem[]> {
    const path = nameFilter
      ? `/api/card?q=${encodeURIComponent(nameFilter)}`
      : "/api/card";
    const result = await this.request<MetabaseCardListItem[]>(path);
    // Client-side filter as safety net — cheap and correct (Open Question 1)
    if (nameFilter) {
      const lower = nameFilter.toLowerCase();
      return result.filter((c) => c.name.toLowerCase().includes(lower));
    }
    return result;
  }

  /**
   * Returns the full saved question (card) including its query definition.
   * Calls GET /api/card/:id.
   *
   * The response includes dataset_query (with native.query for SQL cards),
   * visualization_settings, and result_metadata (CARDS-03).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async getCard(cardId: number): Promise<MetabaseCard> {
    return this.request<MetabaseCard>(`/api/card/${cardId}`);
  }

  /**
   * Exports a full query result set as raw CSV, bypassing Metabase's silent
   * 2,000-row JSON cap by using the /api/dataset/csv endpoint.
   *
   * IMPORTANT: This method does NOT use this.request<T>() because that helper
   * always calls response.json(), which would throw on raw CSV text (Pitfall 2).
   *
   * The endpoint requires application/x-www-form-urlencoded encoding with a
   * single `query` field containing the URL-encoded JSON query body (Pitfall 1 —
   * sending application/json causes a 400 error).
   *
   * Maps each parameter from simplified {name, value, type?} to Metabase's
   * internal wire format, identical to executeSQL (D-05 from 03-CONTEXT.md).
   *
   * Returns the raw CSV text on success (D-08 from 03-CONTEXT.md).
   * Throws MetabaseApiError on non-2xx responses without including the API key
   * or raw URL (T-03-08).
   */
  async exportCSV(
    databaseId: number,
    sql: string,
    parameters: MetabaseQueryParameter[] = [],
  ): Promise<string> {
    const queryBody = {
      database: databaseId,
      type: "native",
      native: { query: sql, template_tags: {} },
      parameters: parameters.map((p) => ({
        type: p.type ?? "category",
        value: p.value,
        target: ["variable", ["template-tag", p.name]],
      })),
    };

    const url = `${this.baseUrl}/api/dataset/csv`;
    const body = `query=${encodeURIComponent(JSON.stringify(queryBody))}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Api-Key": this.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      // Read error body as text — never call .json() on error responses either.
      // T-03-08: error message must not include apiKey or raw url.
      const text = await response.text();
      throw new MetabaseApiError(
        `Metabase API error ${response.status}: ${text}`,
        response.status,
        text,
      );
    }

    return response.text();
  }
}
