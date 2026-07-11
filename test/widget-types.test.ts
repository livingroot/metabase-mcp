/**
 * widget-types.test.ts
 *
 * Unit tests for the FIX-02 widget-type compatibility matrix:
 * field classification, per-category defaults, and allowed widget-type lists.
 */

import { describe, it, expect } from "vitest";
import {
  classifyField,
  defaultWidgetType,
  allowedWidgetTypes,
  WIDGET_TYPE_MATRIX,
  WIDGET_TYPE_MATRIX_DOC,
} from "../src/widget-types.js";

describe("classifyField", () => {
  it("classifies semantic_type type/PK as id even on a numeric base_type", () => {
    expect(classifyField({ base_type: "type/BigInteger", semantic_type: "type/PK" })).toBe("id");
  });

  it("classifies semantic_type type/FK as id even on a numeric base_type", () => {
    expect(classifyField({ base_type: "type/Integer", semantic_type: "type/FK" })).toBe("id");
  });

  it("classifies type/DateTime as temporal", () => {
    expect(classifyField({ base_type: "type/DateTime", semantic_type: null })).toBe("temporal");
  });

  it("classifies type/DateTimeWithLocalTZ as temporal (prefix match)", () => {
    expect(classifyField({ base_type: "type/DateTimeWithLocalTZ", semantic_type: null })).toBe("temporal");
  });

  it("classifies type/Time as temporal", () => {
    expect(classifyField({ base_type: "type/Time", semantic_type: null })).toBe("temporal");
  });

  it("classifies each numeric base_type as number", () => {
    for (const baseType of ["type/Integer", "type/BigInteger", "type/Float", "type/Decimal"]) {
      expect(classifyField({ base_type: baseType, semantic_type: null })).toBe("number");
    }
  });

  it("classifies type/Text as text", () => {
    expect(classifyField({ base_type: "type/Text", semantic_type: null })).toBe("text");
  });

  it("falls back to text for type/Boolean and unknown base types", () => {
    expect(classifyField({ base_type: "type/Boolean", semantic_type: null })).toBe("text");
    expect(classifyField({ base_type: "type/JSON", semantic_type: null })).toBe("text");
  });
});

describe("defaultWidgetType", () => {
  it("returns id for PK/FK fields", () => {
    expect(defaultWidgetType({ base_type: "type/Integer", semantic_type: "type/FK" })).toBe("id");
  });

  it("returns date/all-options for date fields", () => {
    expect(defaultWidgetType({ base_type: "type/Date", semantic_type: null })).toBe("date/all-options");
  });

  it("returns number/= for numeric fields", () => {
    expect(defaultWidgetType({ base_type: "type/Float", semantic_type: null })).toBe("number/=");
  });

  it("returns string/= for text fields", () => {
    expect(defaultWidgetType({ base_type: "type/Text", semantic_type: null })).toBe("string/=");
  });
});

describe("allowedWidgetTypes", () => {
  it("allows all six date widgets for a datetime field and no string widgets", () => {
    const allowed = allowedWidgetTypes({ base_type: "type/DateTime", semantic_type: null });
    expect(allowed).toContain("date/single");
    expect(allowed).toContain("date/range");
    expect(allowed).toContain("date/all-options");
    expect(allowed).not.toContain("string/=");
  });

  it("allows only id for a PK field", () => {
    expect(allowedWidgetTypes({ base_type: "type/BigInteger", semantic_type: "type/PK" })).toEqual(["id"]);
  });

  it("never allows 'category' in any field category (fails at execution on v0.59)", () => {
    for (const spec of Object.values(WIDGET_TYPE_MATRIX)) {
      expect(spec.allowed).not.toContain("category");
    }
  });
});

describe("WIDGET_TYPE_MATRIX_DOC", () => {
  it("mentions every default so tool descriptions cannot drift from the matrix", () => {
    for (const spec of Object.values(WIDGET_TYPE_MATRIX)) {
      expect(WIDGET_TYPE_MATRIX_DOC).toContain(spec.default);
    }
  });
});
