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
 * Represents a saved question (card) returned by GET /api/card/:id.
 * Used by card CRUD tools in Phase 4.
 */
export interface MetabaseCard {
  id: number;
  name: string;
  description: string | null;
  display: string;
  type: string;
  database_id: number | null;
  dataset_query: Record<string, unknown>;
  visualization_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

/**
 * A filter parameter attached to a dashboard.
 */
export interface MetabaseDashboardParameter {
  id: string;
  name: string;
  type: string;
  slug: string;
  default?: unknown;
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
