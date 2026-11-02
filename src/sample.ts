type Schema = Record<string, unknown>;

const FORMATS: Record<string, string> = {
  "date-time": "2026-01-15T09:30:00Z",
  date: "2026-01-15",
  time: "09:30:00",
  email: "someone@example.com",
  uri: "https://example.com/",
  url: "https://example.com/",
  uuid: "123e4567-e89b-42d3-a456-426614174000",
  hostname: "example.com",
  ipv4: "192.0.2.1",
};

function firstType(schema: Schema): string | undefined {
  const t = schema.type;
  if (Array.isArray(t)) return t.find((x) => x !== "null") ?? t[0];
  if (typeof t === "string") return t;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return undefined;
}

/**
 * Builds a small value that should satisfy the schema: required properties only,
 * preferring const, default, examples and enum values the author supplied.
 */
export function sampleValue(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== "object" || depth > 8) return null;
  const s = schema as Schema;
  if ("const" in s) return s.const;
  if ("default" in s) return s.default;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  for (const key of ["anyOf", "oneOf"]) {
    const branches = s[key];
    if (Array.isArray(branches) && branches.length) {
      const pick = branches.find((b) => (b as Schema)?.type !== "null") ?? branches[0];
      return sampleValue(pick, depth + 1);
    }
  }
  if (Array.isArray(s.allOf) && s.allOf.length) {
    return Object.assign({}, ...s.allOf.map((b) => {
      const v = sampleValue(b, depth + 1);
      return v && typeof v === "object" ? v : {};
    }));
  }

  switch (firstType(s)) {
    case "string": {
      if (typeof s.format === "string" && FORMATS[s.format]) return FORMATS[s.format];
      const min = typeof s.minLength === "number" ? s.minLength : 0;
      const max = typeof s.maxLength === "number" ? s.maxLength : Infinity;
      let v = "test";
      while (v.length < min) v += "x";
      return v.slice(0, Math.max(min, Math.min(v.length, max)));
    }
    case "integer":
    case "number": {
      const lo = typeof s.minimum === "number" ? s.minimum
        : typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum + 1 : undefined;
      const hi = typeof s.maximum === "number" ? s.maximum
        : typeof s.exclusiveMaximum === "number" ? s.exclusiveMaximum - 1 : undefined;
      let v = lo ?? (hi !== undefined ? Math.min(1, hi) : 1);
      if (firstType(s) === "integer") v = Math.ceil(v);
      return v;
    }
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      const n = typeof s.minItems === "number" ? s.minItems : 0;
      return Array.from({ length: n }, () => sampleValue(s.items, depth + 1));
    }
    case "object": {
      const out: Record<string, unknown> = {};
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = Array.isArray(s.required) ? (s.required as string[]) : [];
      for (const key of required) out[key] = sampleValue(props[key] ?? {}, depth + 1);
      return out;
    }
    default:
      return "test";
  }
}

/** Sample arguments for a tool, always an object. */
export function sampleArguments(inputSchema: unknown): Record<string, unknown> {
  const v = sampleValue(inputSchema ?? { type: "object" });
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
