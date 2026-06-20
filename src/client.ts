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

import type { MetabaseUser, MetabaseDatabaseMetadata, MetabaseDatabaseListResponse } from "./types.js";

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
        rawBody = await response.json();
        const body = rawBody as { message?: string };
        errorMessage = body.message ?? `Metabase API error ${response.status}: ${response.statusText}`;
      } catch {
        try {
          const text = await response.text();
          rawBody = text;
          errorMessage = text.length > 0
            ? `Metabase API error ${response.status}: ${text}`
            : `Metabase API error ${response.status}: ${response.statusText}`;
        } catch {
          rawBody = undefined;
          errorMessage = `Metabase API error ${response.status}: ${response.statusText}`;
        }
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
}
