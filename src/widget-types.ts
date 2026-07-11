// ---------------------------------------------------------------------------
// Field Filter widget-type compatibility matrix (FIX-02)
// ---------------------------------------------------------------------------
// A template-tag Field Filter's widget-type must match the target field's
// data type or Metabase misbehaves: some mismatches 400 at save, others save
// fine and only break at execution or on the rendered dashboard. This module
// is the single source of truth for which widget-types are valid per field
// category and which one to pick when the caller omits widget_type.
//
// "category" is intentionally absent: it saves without error but fails at
// execution for template-tag Field Filters (observed on Metabase v0.59).

import type { MetabaseField } from "./types.js";

export type FieldCategory = "id" | "temporal" | "number" | "text";

type FieldTypeInfo = Pick<MetabaseField, "base_type" | "semantic_type">;

const NUMBER_BASE_TYPES = new Set([
  "type/Integer",
  "type/BigInteger",
  "type/Float",
  "type/Decimal",
]);

interface CategorySpec {
  /** Human-readable field-type description for docs and error messages. */
  label: string;
  allowed: readonly string[];
  default: string;
}

export const WIDGET_TYPE_MATRIX: Record<FieldCategory, CategorySpec> = {
  id: {
    label: "PK/FK fields (semantic_type type/PK or type/FK)",
    allowed: ["id"],
    default: "id",
  },
  temporal: {
    label: "date/time fields (base_type type/Date*, type/Time*)",
    allowed: [
      "date/single",
      "date/range",
      "date/relative",
      "date/month-year",
      "date/quarter-year",
      "date/all-options",
    ],
    default: "date/all-options",
  },
  number: {
    label: "numeric fields (type/Integer, type/BigInteger, type/Float, type/Decimal)",
    allowed: ["number/=", "number/!=", "number/between", "number/>=", "number/<="],
    default: "number/=",
  },
  text: {
    label: "text and all other fields",
    allowed: [
      "string/=",
      "string/!=",
      "string/contains",
      "string/does-not-contain",
      "string/starts-with",
      "string/ends-with",
    ],
    default: "string/=",
  },
};

/**
 * Classifies a field for widget-type purposes. semantic_type wins over
 * base_type so that numeric PK/FK columns get the id widget, matching the
 * Metabase UI. Unknown base types fall back to the string palette.
 */
export function classifyField(field: FieldTypeInfo): FieldCategory {
  if (field.semantic_type === "type/PK" || field.semantic_type === "type/FK") {
    return "id";
  }
  if (field.base_type.startsWith("type/Date") || field.base_type.startsWith("type/Time")) {
    return "temporal";
  }
  if (NUMBER_BASE_TYPES.has(field.base_type)) {
    return "number";
  }
  return "text";
}

/** The widget-type to use when the caller omits widget_type for a dimension tag. */
export function defaultWidgetType(field: FieldTypeInfo): string {
  return WIDGET_TYPE_MATRIX[classifyField(field)].default;
}

/** All widget-types Metabase accepts for a Field Filter bound to this field. */
export function allowedWidgetTypes(field: FieldTypeInfo): readonly string[] {
  return WIDGET_TYPE_MATRIX[classifyField(field)].allowed;
}

/**
 * Compact matrix rendering embedded in the cards_create/cards_update tool
 * schemas — generated from WIDGET_TYPE_MATRIX so docs cannot drift from code.
 */
export const WIDGET_TYPE_MATRIX_DOC: string = (Object.keys(WIDGET_TYPE_MATRIX) as FieldCategory[])
  .map((cat) => {
    const spec = WIDGET_TYPE_MATRIX[cat];
    return `${spec.label}: ${spec.allowed.join(", ")} (default ${spec.default})`;
  })
  .join("; ");
