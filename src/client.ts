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

import type { MetabaseUser, MetabaseDatabaseMetadata, MetabaseDatabaseListResponse, MetabaseTableQueryMetadata, MetabaseField, MetabaseFieldValues, MetabaseDatasetResponse, MetabaseQueryParameter, MetabaseCardListItem, MetabaseCard, MetabaseDashboardListItem, MetabaseDashboard, MetabaseDashboardParameter, MetabaseDashboardTab, MetabaseDashcard, MetabaseParameterMapping } from "./types.js";

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
// Helpers
// ---------------------------------------------------------------------------

export interface TagConfig {
  type: string;
  field_id?: number;
  widget_type?: string;
  display_name?: string;
}

/**
 * Applies tagConfigs overrides to an already-built template-tags map.
 * When field_id is set, also writes the dimension and widget-type fields
 * required for a working Metabase dashboard dimension filter.
 */
function applyTagConfigs(tags: Record<string, unknown>, tagConfigs: Record<string, TagConfig>): void {
  for (const [tagName, config] of Object.entries(tagConfigs)) {
    if (tags[tagName] === undefined) continue;
    const tag = tags[tagName] as Record<string, unknown>;
    tag["type"] = config.type;
    if (config.field_id !== undefined) {
      tag["dimension"] = ["field", config.field_id, null];
      tag["widget-type"] = config.widget_type ?? "string/=";
    }
    if (config.display_name !== undefined) {
      tag["display-name"] = config.display_name;
    }
  }
}

/**
 * Parses {{tag_name}} placeholders from native SQL and returns a Metabase
 * template-tags object. Each tag gets type "text" by default unless overridden
 * via tagTypes (e.g. {"start_date": "date", "amount": "number"}).
 *
 * The id field intentionally uses the tag name (not a random UUID) so that
 * cards created with the same SQL produce identical, deterministic tag objects.
 * Metabase accepts any unique string as a tag id.
 */
function buildTemplateTags(sql: string, tagTypes?: Record<string, string>): Record<string, unknown> {
  const tags: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const [, name] of sql.matchAll(/\{\{\s*([^\s}]+)\s*\}\}/g)) {
    if (seen.has(name)) continue;
    seen.add(name);
    // Skip card/model references ({{#id-slug}}) — these need the source card's tag definition
    if (name.startsWith("#")) continue;
    tags[name] = {
      id: name,
      name,
      "display-name": name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      type: tagTypes?.[name] ?? "text",
      required: false,
    };
  }
  return tags;
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
   * Creates a native SQL saved question (card) in Metabase.
   * Calls POST /api/card with Content-Type: application/json.
   *
   * Builds the minimal valid body for a native SQL card:
   *   - name, display: "table", visualization_settings: {} (all required by the API)
   *   - dataset_query.native uses the hyphenated "template-tags" key (Pitfall 2 —
   *     NOT the underscore form used by the /api/dataset execution endpoint)
   *
   * Only sends description when it is provided (never sends null to avoid clearing).
   * Returns the created MetabaseCard including its new id.
   * Throws MetabaseApiError on non-2xx responses.
   */
  async createCard(
    databaseId: number,
    sql: string,
    name: string,
    description?: string,
    tagTypes?: Record<string, string>,
    tagConfigs?: Record<string, TagConfig>,
    display?: string,
  ): Promise<MetabaseCard> {
    const templateTags = buildTemplateTags(sql, tagTypes);
    if (tagConfigs) {
      applyTagConfigs(templateTags, tagConfigs);
    }
    const body: Record<string, unknown> = {
      name,
      display: display ?? "table",
      visualization_settings: {},
      dataset_query: {
        database: databaseId,
        type: "native",
        native: {
          query: sql,
          "template-tags": templateTags,
        },
      },
    };
    if (description !== undefined) {
      body["description"] = description;
    }
    return this.request<MetabaseCard>("/api/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Updates an existing saved question (card) with partial changes.
   * Calls PUT /api/card/:id with Content-Type: application/json.
   *
   * Only includes keys whose value is defined in updates — never sends null
   * to avoid accidentally clearing stored fields (T-04-08 / Anti-Pattern).
   * When updating SQL, the full dataset_query envelope is required including
   * the database ID (Pitfall 3).
   *
   * Returns the updated MetabaseCard.
   * Throws MetabaseApiError on non-2xx responses.
   */
  async updateCard(
    cardId: number,
    updates: {
      name?: string;
      description?: string;
      sql?: string;
      databaseId?: number;
      refCardId?: number;
      tagTypes?: Record<string, string>;
      tagConfigs?: Record<string, TagConfig>;
      display?: string;
      visualizationSettings?: Record<string, unknown>;
    },
  ): Promise<MetabaseCard> {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) {
      body["name"] = updates.name;
    }
    if (updates.description !== undefined) {
      body["description"] = updates.description;
    }
    if (updates.display !== undefined) {
      body["display"] = updates.display;
    }
    if (updates.visualizationSettings !== undefined) {
      body["visualization_settings"] = updates.visualizationSettings;
    }
    if (updates.sql !== undefined) {
      if (updates.databaseId === undefined) {
        throw new Error("updateCard: databaseId is required when updating sql");
      }
      // When refCardId is provided, copy template-tags AND format from that card.
      // Otherwise fetch the card's own dataset_query to preserve format and tags.
      const sourceCardId = updates.refCardId ?? cardId;
      const sourceCard = await this.getCard(sourceCardId);

      // Detect pMBQL (v0.59+) vs legacy native format
      const nativeStageIdx = sourceCard.dataset_query.stages?.findIndex(
        (s) => s["lib/type"] === "mbql.stage/native",
      ) ?? -1;
      const nativeStage = nativeStageIdx >= 0
        ? sourceCard.dataset_query.stages![nativeStageIdx]
        : undefined;

      const sourceTags = (
        nativeStage?.["template-tags"] ??
        sourceCard.dataset_query.native?.["template-tags"] ??
        {}
      ) as Record<string, unknown>;

      // Merge template-tags: prefer source card config over generated text defaults
      const newTags = buildTemplateTags(updates.sql);
      const mergedTags: Record<string, unknown> = {};
      for (const name of Object.keys(newTags)) {
        mergedTags[name] = sourceTags[name] ?? newTags[name];
      }
      // Also carry card/model reference tags ({{#id-slug}}) from source
      for (const [, refName] of updates.sql.matchAll(/\{\{\s*(#[^\s}]+)\s*\}\}/g)) {
        if (sourceTags[refName] !== undefined) {
          mergedTags[refName] = sourceTags[refName];
        }
      }
      // tagTypes overrides take highest priority — applied after the merge so they
      // win over both the source card's stored types and the generated defaults.
      if (updates.tagTypes) {
        for (const [tagName, tagType] of Object.entries(updates.tagTypes)) {
          if (mergedTags[tagName] !== undefined) {
            (mergedTags[tagName] as Record<string, unknown>)["type"] = tagType;
          }
        }
      }
      // tagConfigs takes highest priority and also writes dimension/widget-type
      // fields required for dimension filter tags to work on dashboards.
      if (updates.tagConfigs) {
        applyTagConfigs(mergedTags, updates.tagConfigs);
      }

      // Build dataset_query in the SAME FORMAT as the source card so Metabase
      // does not silently discard the update (v0.59 rejects legacy format for
      // cards that were stored in pMBQL format, returning 200 but saving {}).
      if (nativeStage !== undefined && sourceCard.dataset_query.stages) {
        // pMBQL format: clone stages array, replace the native stage
        const stages = [...sourceCard.dataset_query.stages];
        stages[nativeStageIdx] = {
          ...nativeStage,
          native: updates.sql,
          "template-tags": mergedTags,
        };
        body["dataset_query"] = {
          ...sourceCard.dataset_query,
          database: updates.databaseId,
          stages,
        };
      } else {
        // Legacy native format (or source card dataset_query is {} — fall back to legacy)
        body["dataset_query"] = {
          database: updates.databaseId,
          type: "native",
          native: {
            query: updates.sql,
            "template-tags": mergedTags,
          },
        };
      }
    }
    return this.request<MetabaseCard>(`/api/card/${cardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Deletes a saved question (card) by ID.
   * Calls DELETE /api/card/:id.
   *
   * DELETE returns 204 No Content with no JSON body. This method does NOT use
   * this.request<T>() because that helper always calls response.json() and would
   * throw on an empty response body.
   *
   * Note: DELETE is the v0.59 hard-delete path. The soft-delete alternative is
   * PUT /api/card/:id with {archived:true} — archived cards are excluded from
   * the default GET /api/card response and satisfy CARDS-06 equally (Pitfall 5).
   *
   * Throws MetabaseApiError on non-2xx responses without including the API key
   * or raw URL in the message (T-04-02 — mirrors the exportCSV error pattern).
   */
  async deleteCard(cardId: number): Promise<void> {
    const url = `${this.baseUrl}/api/card/${cardId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-Api-Key": this.apiKey,
      },
    });

    if (!response.ok) {
      // T-04-02: error message must not include apiKey or raw url
      let text: string;
      try {
        text = await response.text();
      } catch {
        text = response.statusText;
      }
      throw new MetabaseApiError(
        `Metabase API error ${response.status}: ${text}`,
        response.status,
        text,
      );
    }
    // 204 No Content — return void
  }

  // -------------------------------------------------------------------------
  // Phase 5: Dashboard methods
  // -------------------------------------------------------------------------

  /**
   * Returns the list of dashboards from this Metabase instance.
   * Calls GET /api/dashboard.
   *
   * NOTE: GET /api/dashboard has NO server-side name filter parameter (unlike
   * GET /api/card which supports ?q=). Client-side .filter() is the only
   * substring-search approach for dashboard names (A2 from 05-RESEARCH.md).
   *
   * When nameFilter is provided, applies a case-insensitive client-side filter.
   * Returns a bare array — NOT a {data, total} envelope (A1).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async listDashboards(nameFilter?: string): Promise<MetabaseDashboardListItem[]> {
    const result = await this.request<MetabaseDashboardListItem[]>("/api/dashboard");
    if (nameFilter) {
      const lower = nameFilter.toLowerCase();
      return result.filter((d) => d.name.toLowerCase().includes(lower));
    }
    return result;
  }

  /**
   * Returns the full dashboard including filter parameters and all placed cards.
   * Calls GET /api/dashboard/:id.
   *
   * Returns MetabaseDashboard with parameters[] and dashcards[] (DASH-03).
   * This method is reused by the read-modify-write tools in Plan 03:
   * dashboards_update_card, dashboards_add_filter, and dashboards_connect_filter
   * all call getDashboard() first to fetch current state before mutating.
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async getDashboard(dashboardId: number): Promise<MetabaseDashboard> {
    return this.request<MetabaseDashboard>(`/api/dashboard/${dashboardId}`);
  }

  /**
   * Creates a new empty dashboard in Metabase.
   * Calls POST /api/dashboard with Content-Type: application/json.
   *
   * Only name is required. parameters: [] is the correct empty value for the
   * parameters array — NEVER send parameters: null (null causes validation
   * errors — Anti-Pattern from 05-RESEARCH.md Pattern 2).
   *
   * Only adds description to the body when it is defined (never sends null,
   * mirroring createCard). Returns the created MetabaseDashboard including its
   * new id (DASH-04).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async createDashboard(name: string, description?: string): Promise<MetabaseDashboard> {
    const body: Record<string, unknown> = { name, parameters: [] };
    if (description !== undefined) {
      body["description"] = description;
    }
    return this.request<MetabaseDashboard>("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Updates an existing dashboard with partial changes.
   * Calls PUT /api/dashboard/:id with Content-Type: application/json.
   *
   * Only includes keys whose value is defined in updates — never sends null
   * to avoid accidentally clearing stored fields (T-5-null — Anti-Pattern).
   *
   * The optional parameters branch is used by dashboards_add_filter in Plan 03,
   * which performs a read-modify-write of the full parameters array. Although
   * no Plan 02 tool passes parameters, implementing the branch now avoids
   * Plan 03 having to re-edit this method (DASH-05).
   *
   * Returns the updated MetabaseDashboard.
   * Throws MetabaseApiError on non-2xx responses.
   */
  async updateDashboard(
    dashboardId: number,
    updates: {
      name?: string;
      description?: string;
      parameters?: MetabaseDashboardParameter[];
      tabs?: MetabaseDashboardTab[];
      auto_apply_filters?: boolean;
      width?: string;
    },
  ): Promise<MetabaseDashboard> {
    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body["name"] = updates.name;
    if (updates.description !== undefined) body["description"] = updates.description;
    if (updates.parameters !== undefined) body["parameters"] = updates.parameters;
    if (updates.tabs !== undefined) body["tabs"] = updates.tabs;
    if (updates.auto_apply_filters !== undefined) body["auto_apply_filters"] = updates.auto_apply_filters;
    if (updates.width !== undefined) body["width"] = updates.width;
    return this.request<MetabaseDashboard>(`/api/dashboard/${dashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Creates a new tab on a dashboard.
   * Uses PUT /api/dashboard/:id with tabs array containing existing tabs + a new entry with id: -1.
   * Returns the newly created tab (found by comparing before/after IDs).
   */
  async addDashboardTab(dashboardId: number, name: string): Promise<MetabaseDashboardTab> {
    const dashboard = await this.getDashboard(dashboardId);
    const existingIds = new Set((dashboard.tabs ?? []).map((t) => t.id));
    const response = await this.request<MetabaseDashboard>(`/api/dashboard/${dashboardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tabs: [
          ...(dashboard.tabs ?? []).map((t) => ({ id: t.id, name: t.name })),
          { id: -1, name },
        ],
        dashcards: dashboard.dashcards.map((dc) => ({
          id: dc.id,
          card_id: dc.card_id,
          row: dc.row,
          col: dc.col,
          size_x: dc.size_x,
          size_y: dc.size_y,
          parameter_mappings: dc.parameter_mappings,
          visualization_settings: dc.visualization_settings ?? {},
          series: dc.series ?? [],
          dashboard_tab_id: dc.dashboard_tab_id ?? null,
        })),
      }),
    });
    const newTab = (response.tabs ?? []).find((t) => !existingIds.has(t.id));
    if (!newTab) {
      throw new Error(`addDashboardTab: new tab not found in PUT response`);
    }
    return newTab;
  }

  /**
   * Deletes a dashboard by ID.
   * Calls DELETE /api/dashboard/:id.
   *
   * DELETE returns 204 No Content with no JSON body. This method does NOT use
   * this.request<T>() because that helper always calls response.json() and would
   * throw on an empty response body (Pitfall 7 from 05-RESEARCH.md — identical
   * to deleteCard's established pattern).
   *
   * Note: DELETE is the v0.59 hard-delete path. The soft-delete alternative is
   * PUT /api/dashboard/:id with {archived:true} — archived dashboards are excluded
   * from the default GET /api/dashboard response and satisfy DASH-06 equally.
   *
   * Throws MetabaseApiError on non-2xx responses without including the API key
   * or raw URL in the message (T-5-02).
   */
  async deleteDashboard(dashboardId: number): Promise<void> {
    const url = `${this.baseUrl}/api/dashboard/${dashboardId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-Api-Key": this.apiKey,
      },
    });

    if (!response.ok) {
      // T-5-02: error message must not include apiKey or raw url
      let text: string;
      try {
        text = await response.text();
      } catch {
        text = response.statusText;
      }
      throw new MetabaseApiError(
        `Metabase API error ${response.status}: ${text}`,
        response.status,
        text,
      );
    }
    // 204 No Content — return void
  }

  /**
   * Replaces the full set of dashcards on a dashboard.
   *
   * Two paths depending on whether the dashboard has tabs:
   *
   * TABBED (orderedTabs.length > 0):
   *   Uses PUT /api/dashboard/:id with existing positive tab IDs and dashcard IDs.
   *   This endpoint preserves both tab IDs and dashcard IDs in place — safe for
   *   parameter_mappings updates, repositions, and removal. Avoids PUT /cards which
   *   wipes tabs and DELETE+re-INSERTs all dashcards (causing ID churn and FK
   *   violations when tab IDs are referenced).
   *
   * TABLESS (orderedTabs.length === 0):
   *   Uses PUT /api/dashboard/:id/cards which is an upsert-by-ID when no tabs
   *   exist. dashboard_tab_id must be null (no tabs to reference).
   *
   * IMPORTANT — FULL REPLACEMENT in both paths: ALL existing dashcards must be
   * included in the `cards` array. Omitting a dashcard removes it silently (Pitfall 2).
   *
   * Returns void. Throws MetabaseApiError on non-2xx.
   */
  async updateDashboardCards(
    dashboardId: number,
    cards: Array<{
      id: number;
      card_id: number | null;
      row: number;
      col: number;
      size_x: number;
      size_y: number;
      parameter_mappings: MetabaseParameterMapping[];
      visualization_settings?: Record<string, unknown>;
      series?: unknown[];
      dashboard_tab_id?: number | null;
      action_id?: number | null;
    }>,
    orderedTabs: MetabaseDashboardTab[] = [],
  ): Promise<void> {
    if (orderedTabs.length > 0) {
      await this.request<unknown>(`/api/dashboard/${dashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabs: orderedTabs.map((t) => ({ id: t.id, name: t.name })),
          dashcards: cards.map((c) => ({
            id: c.id,
            card_id: c.card_id,
            row: c.row,
            col: c.col,
            size_x: c.size_x,
            size_y: c.size_y,
            parameter_mappings: c.parameter_mappings,
            visualization_settings: c.visualization_settings ?? {},
            series: c.series ?? [],
            dashboard_tab_id: c.dashboard_tab_id ?? null,
          })),
        }),
      });
    } else {
      await this.request<unknown>(`/api/dashboard/${dashboardId}/cards`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: cards.map((c) => ({
            id: c.id,
            card_id: c.card_id,
            row: c.row,
            col: c.col,
            size_x: c.size_x,
            size_y: c.size_y,
            parameter_mappings: c.parameter_mappings,
            visualization_settings: c.visualization_settings ?? {},
            series: c.series ?? [],
            dashboard_tab_id: null,
            action_id: c.action_id ?? null,
          })),
          ordered_tabs: [],
        }),
      });
    }
  }

  /**
   * Adds an existing saved question to a dashboard.
   *
   * Two paths depending on whether the dashboard has tabs:
   *
   * TABBED: Uses PUT /api/dashboard/:id with existing positive tab IDs. This
   *   preserves all tab IDs and dashcard IDs. The new card uses id: -1 as a
   *   server-side placeholder and gets a fresh positive ID. Existing dashcards
   *   keep their IDs throughout.
   *
   * TABLESS: Uses PUT /api/dashboard/:id/cards. The new card uses id: -1.
   *   Existing dashcards keep their IDs (PUT /cards is an upsert when no tabs).
   *
   * Returns the created MetabaseDashcard containing the dashcard placement
   * `id` — different from the saved question's `card_id` (Pitfall 1).
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async addDashboardCard(
    dashboardId: number,
    cardId: number,
    position?: { row: number; col: number; size_x: number; size_y: number; tab_id?: number },
  ): Promise<MetabaseDashcard> {
    const dashboard = await this.getDashboard(dashboardId);
    const existingIds = new Set(dashboard.dashcards.map((dc) => dc.id));
    const tabs = dashboard.tabs ?? [];

    const row = position?.row ?? 0;
    const col = position?.col ?? 0;
    const size_x = position?.size_x ?? 4;
    const size_y = position?.size_y ?? 4;
    const tabId = tabs.length > 0 ? (position?.tab_id ?? tabs[0].id) : null;

    let newDashcard: MetabaseDashcard | undefined;

    if (tabs.length > 0) {
      const response = await this.request<MetabaseDashboard>(`/api/dashboard/${dashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabs: tabs.map((t) => ({ id: t.id, name: t.name })),
          dashcards: [
            ...dashboard.dashcards.map((dc) => ({
              id: dc.id,
              card_id: dc.card_id,
              row: dc.row,
              col: dc.col,
              size_x: dc.size_x,
              size_y: dc.size_y,
              parameter_mappings: dc.parameter_mappings,
              visualization_settings: dc.visualization_settings ?? {},
              series: dc.series ?? [],
              dashboard_tab_id: dc.dashboard_tab_id ?? null,
            })),
            {
              id: -1,
              card_id: cardId,
              row,
              col,
              size_x,
              size_y,
              parameter_mappings: [],
              visualization_settings: {},
              series: [],
              dashboard_tab_id: tabId,
            },
          ],
        }),
      });
      newDashcard = response.dashcards.find((dc) => !existingIds.has(dc.id));
    } else {
      const allCards = [
        ...dashboard.dashcards.map((dc) => ({
          id: dc.id,
          card_id: dc.card_id,
          row: dc.row,
          col: dc.col,
          size_x: dc.size_x,
          size_y: dc.size_y,
          parameter_mappings: dc.parameter_mappings,
          visualization_settings: dc.visualization_settings ?? {},
          series: dc.series ?? [],
          dashboard_tab_id: null,
          action_id: null,
        })),
        {
          id: -1,
          card_id: cardId,
          row,
          col,
          size_x,
          size_y,
          parameter_mappings: [] as MetabaseParameterMapping[],
          visualization_settings: {},
          series: [],
          dashboard_tab_id: null,
          action_id: null,
        },
      ];
      const response = await this.request<{ cards: MetabaseDashcard[] }>(
        `/api/dashboard/${dashboardId}/cards`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cards: allCards, ordered_tabs: [] }),
        },
      );
      newDashcard = response.cards.find((dc) => !existingIds.has(dc.id));
    }

    if (!newDashcard) {
      throw new Error(
        `dashboards_add_card: new dashcard for card_id=${cardId} not found in PUT response`,
      );
    }
    return newDashcard;
  }

  /**
   * Removes a single card from a dashboard by its dashcard placement ID.
   *
   * Metabase v0.59 removed DELETE /api/dashboard/:id/cards?dashcardId=. The
   * only write path is PUT /api/dashboard/:id/cards with a full replacement
   * array. Omitting a dashcard from the array removes it (Pitfall 2). This
   * method:
   *   1. GETs the current dashboard to collect existing dashcards.
   *   2. Filters out the target dashcard by its placement ID.
   *   3. PUTs the remaining dashcards as the new full set.
   *
   * Throws MetabaseApiError on non-2xx responses.
   */
  async removeDashboardCard(dashboardId: number, dashcardId: number): Promise<void> {
    const dashboard = await this.getDashboard(dashboardId);
    const remaining = dashboard.dashcards.filter((dc) => dc.id !== dashcardId);
    await this.updateDashboardCards(dashboardId, remaining, dashboard.tabs ?? []);
  }

  /**
   * Adds a virtual card (text block or heading) to a dashboard.
   * Virtual cards have card_id: null and carry their content in visualization_settings.
   * Uses the same PUT paths as addDashboardCard (tabbed vs tabless).
   */
  async addDashboardTextCard(
    dashboardId: number,
    text: string,
    display: "text" | "heading",
    position?: { row: number; col: number; size_x: number; size_y: number; tab_id?: number },
  ): Promise<MetabaseDashcard> {
    const dashboard = await this.getDashboard(dashboardId);
    const existingIds = new Set(dashboard.dashcards.map((dc) => dc.id));
    const tabs = dashboard.tabs ?? [];

    const row = position?.row ?? 0;
    const col = position?.col ?? 0;
    const size_x = position?.size_x ?? 12;
    const size_y = position?.size_y ?? (display === "heading" ? 1 : 2);
    const tabId = tabs.length > 0 ? (position?.tab_id ?? tabs[0].id) : null;

    const virtualCard = {
      id: -1,
      card_id: null,
      row,
      col,
      size_x,
      size_y,
      visualization_settings: {
        virtual_card: {
          name: "",
          display,
          visualization_settings: {},
          dataset_query: {},
        },
        text,
      },
      parameter_mappings: [] as MetabaseParameterMapping[],
      dashboard_tab_id: tabId,
    };

    let newDashcard: MetabaseDashcard | undefined;

    if (tabs.length > 0) {
      const response = await this.request<MetabaseDashboard>(`/api/dashboard/${dashboardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabs: tabs.map((t) => ({ id: t.id, name: t.name })),
          dashcards: [
            ...dashboard.dashcards.map((dc) => ({
              id: dc.id,
              card_id: dc.card_id,
              row: dc.row,
              col: dc.col,
              size_x: dc.size_x,
              size_y: dc.size_y,
              parameter_mappings: dc.parameter_mappings,
              visualization_settings: dc.visualization_settings ?? {},
              series: dc.series ?? [],
              dashboard_tab_id: dc.dashboard_tab_id ?? null,
            })),
            virtualCard,
          ],
        }),
      });
      newDashcard = response.dashcards.find((dc) => !existingIds.has(dc.id));
    } else {
      const response = await this.request<{ cards: MetabaseDashcard[] }>(
        `/api/dashboard/${dashboardId}/cards`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cards: [
              ...dashboard.dashcards.map((dc) => ({
                id: dc.id,
                card_id: dc.card_id,
                row: dc.row,
                col: dc.col,
                size_x: dc.size_x,
                size_y: dc.size_y,
                parameter_mappings: dc.parameter_mappings,
                visualization_settings: dc.visualization_settings ?? {},
                series: dc.series ?? [],
                dashboard_tab_id: null,
                action_id: null,
              })),
              { ...virtualCard, action_id: null },
            ],
            ordered_tabs: [],
          }),
        },
      );
      newDashcard = response.cards.find((dc) => !existingIds.has(dc.id));
    }

    if (!newDashcard) {
      throw new Error(`addDashboardTextCard: new dashcard not found in PUT response`);
    }
    return newDashcard;
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
      let text: string;
      try {
        text = await response.text();
      } catch {
        text = response.statusText;
      }
      throw new MetabaseApiError(
        `Metabase API error ${response.status}: ${text}`,
        response.status,
        text,
      );
    }

    return response.text();
  }
}
