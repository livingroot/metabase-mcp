/**
 * Hand-written Metabase TypeScript interfaces.
 *
 * No official OpenAPI spec exists for the Metabase REST API (see CLAUDE.md).
 * These interfaces are scoped strictly to the endpoints this server uses.
 * They are not exhaustive Metabase type definitions.
 */

/**
 * Represents the authenticated user returned by GET /api/user/current.
 * Used by MetabaseClient.getUser() to validate API key auth.
 */
export interface MetabaseUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  common_name: string;
  is_superuser: boolean;
  is_active: boolean;
}

/**
 * Represents a Metabase database returned by GET /api/database.
 * Used by schema discovery tools in Phase 2.
 */
export interface MetabaseDatabase {
  id: number;
  name: string;
  engine: string;
  is_full_sync: boolean;
  is_sample: boolean;
}

/**
 * Represents a table within a Metabase database.
 * Returned as part of GET /api/database/:id/metadata.
 */
export interface MetabaseTable {
  id: number;
  name: string;
  display_name: string;
  schema: string | null;
  db_id: number;
  description: string | null;
}

/**
 * Represents a saved question (card) as returned in the list by GET /api/card.
 * Used by cards_list and as the base for MetabaseCard.
 *
 * Note: creator is marked optional because list items in some Metabase versions
 * may carry only creator_id (Open Question 3 from 04-RESEARCH.md). Handlers
 * should fall back to creator_id when creator is absent.
 */
export interface MetabaseCardListItem {
  id: number;
  name: string;
  description: string | null;
  database_id: number | null;
  creator?: {
    id: number;
    common_name: string;
    email: string;
  };
  creator_id: number;
  updated_at: string;
  created_at: string;
  display: string;
  archived: boolean;
}

/**
 * Represents a saved question (card) returned by GET /api/card/:id.
 * Extends MetabaseCardListItem with the full query definition, visualization
 * settings, and result metadata. Used by card CRUD tools in Phase 4.
 *
 * Metabase v0.59+ switched to pMBQL: dataset_query no longer has a top-level
 * "type" field; instead, stages[i]["lib/type"] === "mbql.stage/native" marks a
 * native SQL card, and stages[i].native is the SQL string (not an object).
 * Legacy format (< v0.59) uses dataset_query.type === "native" and
 * dataset_query.native.query. Both shapes are represented here.
 */
export interface MetabaseCard extends MetabaseCardListItem {
  type?: string;                       // v0.59+: "question" | "model" (top-level)
  dataset_query: {
    // Legacy format (< v0.59)
    type?: string;                     // "native" | "query"
    // v0.59+ pMBQL format
    "lib/type"?: string;               // "mbql/query"
    database: number;
    // Legacy native sub-object
    native?: {
      query: string;
      "template-tags": Record<string, unknown>;
    };
    query?: Record<string, unknown>;
    // v0.59+ stages array — each stage has lib/type and (for native) a string native field
    stages?: Array<{
      "lib/type": string;              // "mbql.stage/native" | "mbql.stage/mbql"
      native?: string;                 // SQL string (v0.59+ native stage only)
      "template-tags"?: Record<string, unknown>; // Template tag configs (v0.59+ pMBQL native stage)
    }>;
  };
  visualization_settings: Record<string, unknown>;
  result_metadata: unknown[] | null;
}

/**
 * A tab on a dashboard (Metabase v0.50+).
 * Returned in GET /api/dashboard/:id as `tabs[]`.
 * Must be sent back verbatim in PUT /api/dashboard/:id/cards as `ordered_tabs[]`.
 */
export interface MetabaseDashboardTab {
  id: number;
  name: string;
  position?: number;
  dashboard_id?: number;
}

/**
 * Represents a dashboard returned by GET /api/dashboard/:id.
 * Used by dashboard CRUD tools in Phase 5.
 */
export interface MetabaseDashboard {
  id: number;
  name: string;
  description: string | null;
  parameters: MetabaseDashboardParameter[];
  dashcards: MetabaseDashcard[];
  /** Tab definitions — present only when the dashboard has tabs. */
  tabs?: MetabaseDashboardTab[];
  created_at: string;
  updated_at: string;
}

/**
 * A filter parameter attached to a dashboard.
 *
 * values_source_type controls where dropdown values come from:
 *   "card"        — values from a saved question (needs values_source_config.card_id + value_field)
 *   "static-list" — hardcoded list (needs values_source_config.values: string[][])
 *   "fields"      — values from connected fields (default when type=dimension filter)
 *   absent/null   — Metabase default: derives values from connected field
 */
export interface MetabaseDashboardParameter {
  id: string;
  name: string;
  type: string;
  slug: string;
  default?: unknown;
  values_source_type?: "card" | "static-list" | "fields" | null;
  values_source_config?: Record<string, unknown>;
}

/**
 * A card placed on a dashboard (dashboard card).
 */
export interface MetabaseDashcard {
  id: number;
  card_id: number;
  dashboard_id: number;
  row: number;
  col: number;
  size_x: number;
  size_y: number;
  parameter_mappings: MetabaseParameterMapping[];
  /** Tab this card belongs to — null/absent when dashboard has no tabs. */
  dashboard_tab_id?: number | null;
  visualization_settings?: Record<string, unknown>;
  series?: unknown[];
}

/**
 * Links a dashboard parameter to a field within a dashcard's query.
 * Three-layer consistency required: dashboard.parameters + dashcard.parameter_mappings
 * + query parameters must all reference the same parameter_id.
 */
export interface MetabaseParameterMapping {
  parameter_id: string;
  card_id: number;
  target: unknown;
}

/**
 * GET /api/dashboard list response item shape.
 *
 * Simpler than the full MetabaseDashboard detail shape — list items may not
 * include the complete dashcards array. Card count must be derived defensively:
 *   d.dashcard_count ?? (d.dashcards ?? d.ordered_cards ?? []).length
 * because Metabase has used both field names across versions (Pitfall 6).
 * Metabase v0.59 returns a dedicated `dashcard_count` integer field on list items
 * instead of embedding the full dashcards array, so prefer that when present.
 *
 * Both dashcards and ordered_cards are optional because the list endpoint
 * response shape is not guaranteed to include either field.
 */
export interface MetabaseDashboardListItem {
  id: number;
  name: string;
  description: string | null;
  updated_at: string;
  created_at: string;
  archived: boolean;
  /**
   * Number of cards on this dashboard — present on list items in Metabase v0.59.
   * Prefer this over computing .length on the dashcards array (which may be absent).
   */
  dashcard_count?: number;
  /** Cards placed on this dashboard (may be absent on list items). */
  dashcards?: MetabaseDashcard[];
  /** Alternate field name used in some Metabase versions — see Pitfall 6. */
  ordered_cards?: MetabaseDashcard[];
}

/**
 * A non-2xx HTTP response from the Metabase API.
 * Thrown by MetabaseClient on failed requests.
 */
export interface MetabaseApiErrorBody {
  message?: string;
  errors?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Phase 2: Schema Discovery types
// ---------------------------------------------------------------------------

/**
 * A field (column) within a Metabase table.
 * Returned as part of GET /api/database/:id/metadata and GET /api/table/:id/query_metadata.
 */
export interface MetabaseField {
  id: number;
  name: string;
  display_name: string;
  base_type: string;             // e.g. "type/Integer", "type/Text", "type/DateTime"
  semantic_type: string | null;  // e.g. "type/PK", "type/FK", "type/Name", null
  visibility_type: string;       // "normal" | "details-only" | "hidden" | "retired"
  database_required: boolean;    // NOT NULL constraint proxy
  fk_target_field_id: number | null;
  has_field_values?: string | null; // "list" | "search" | "none" | null
  description?: string | null;
}

/**
 * Response shape for GET /api/database/:id/metadata.
 * Contains the complete database → tables → fields tree.
 */
export interface MetabaseDatabaseMetadata {
  id: number;
  name: string;
  engine: string;
  tables: MetabaseTableWithFields[];
}

/**
 * Table as returned within database metadata — extends MetabaseTable with
 * estimated row count and nested fields array.
 * Used by GET /api/database/:id/metadata.
 */
export interface MetabaseTableWithFields extends MetabaseTable {
  estimated_row_count: number | null;
  fields: MetabaseField[];
}

/**
 * Response shape for GET /api/database (list endpoint).
 * The endpoint may return a plain array OR this envelope — both shapes are handled.
 */
export interface MetabaseDatabaseListResponse {
  data: MetabaseDatabase[];
  total: number;
}

/**
 * Response shape for GET /api/table/:id/query_metadata.
 * Extends MetabaseTable with estimated row count and the full fields array.
 * Used by the tables_get tool (SCHEMA-04).
 *
 * Reuses MetabaseField from the database metadata types above — identical field
 * shape across both endpoints (database metadata and table query metadata).
 */
export interface MetabaseTableQueryMetadata extends MetabaseTable {
  estimated_row_count: number | null;
  fields: MetabaseField[];
}

/**
 * Response shape for GET /api/field/:id/values.
 * Contains the enumerated valid values for a low-cardinality (list) field.
 * Only fetched when MetabaseField.has_field_values === "list" (Pitfall 3).
 *
 * The values array is an array of arrays: each inner array is [rawValue] or
 * [rawValue, displayValue] when Metabase has human-readable remappings (A5).
 * Used by the fields_get tool (SCHEMA-05).
 */
export interface MetabaseFieldValues {
  field_id: number;
  values: unknown[][];           // e.g. [["pending"], ["shipped"]] or [["1", "Active"]]
  human_readable_values: unknown[];
}

// ---------------------------------------------------------------------------
// Phase 3: Query Execution types
// ---------------------------------------------------------------------------

/**
 * A column descriptor returned within a dataset response.
 * Used by formatQueryResult() to build Markdown table headers.
 *
 * name:         internal column identifier (e.g. "created_at")
 * display_name: human-readable label used as the Markdown column header
 * base_type:    optional data type string (e.g. "type/Integer")
 * special_type: semantic type alias on older Metabase versions
 */
export interface MetabaseDatasetColumn {
  name: string;
  display_name: string;
  base_type?: string;
  special_type?: string;
}

/**
 * Response shape for POST /api/dataset and POST /api/card/:id/query.
 *
 * data, data.cols, and data.rows are intentionally optional (?) per Pitfall 4:
 * MBQL (GUI-built) saved questions may omit them; handlers must guard defensively.
 *
 * row_count: number of rows in this response (same as data.rows.length in practice)
 * status:    "completed" | "failed"
 * error:     present when status === "failed"
 */
export interface MetabaseDatasetResponse {
  data?: {
    cols?: MetabaseDatasetColumn[];
    rows?: unknown[][];
  };
  row_count: number;
  status: string;
  error?: string;
}

/**
 * Simplified parameter shape exposed to agents for queries_execute_sql and cards_execute.
 *
 * The MCP server maps this to Metabase's internal wire format:
 *   { type, value, target: ["variable", ["template-tag", name]] }
 *
 * name:  template tag name — must match {{name}} placeholder in SQL (case-sensitive)
 * value: value to bind to this tag
 * type:  Metabase parameter type (e.g. "category", "date/single"); defaults to "category"
 */
export interface MetabaseQueryParameter {
  name: string;
  value: string;
  type?: string;
}
