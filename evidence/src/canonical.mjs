// Canonical serialization.
//
// The reconciler's value depends on a finding still being reproducible weeks
// later. That requires the same source state to serialize to the same bytes,
// so key order is sorted everywhere and the digest is taken over that canonical
// form. Two exporter runs over identical source state must produce identical
// files, including the digest.

import { createHash } from "node:crypto";

/** Recursively sort object keys; arrays keep their (meaningful) order. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value, { indent = 2 } = {}) {
  return JSON.stringify(canonicalize(value), null, indent);
}

export function digestSha256(value) {
  return createHash("sha256")
    .update(canonicalJson(value, { indent: 0 }))
    .digest("hex");
}
