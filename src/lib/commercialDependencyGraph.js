import commercialDependencyGraphCore from "commercial-dependency-graph-core";

export const COMMERCIAL_DEPENDENCY_GRAPH_ID = commercialDependencyGraphCore
  .COMMERCIAL_DEPENDENCY_GRAPH_ID;
export const COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES = commercialDependencyGraphCore
  .COMMERCIAL_DEPENDENCY_GRAPH_ERROR_CODES;
export const COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION = commercialDependencyGraphCore
  .COMMERCIAL_DEPENDENCY_GRAPH_SCHEMA_VERSION;
export const COMMERCIAL_DEPENDENCY_GRAPH_V1 = commercialDependencyGraphCore
  .COMMERCIAL_DEPENDENCY_GRAPH_V1;
export const COMMERCIAL_DEPENDENCY_GRAPH_VERSION = commercialDependencyGraphCore
  .COMMERCIAL_DEPENDENCY_GRAPH_VERSION;
export const CommercialDependencyGraphError = commercialDependencyGraphCore
  .CommercialDependencyGraphError;
export const canonicalSerialize = commercialDependencyGraphCore.canonicalSerialize;
export const evaluateCommercialDependencyImpact = commercialDependencyGraphCore
  .evaluateCommercialDependencyImpact;
export const validateCommercialDependencyGraph = commercialDependencyGraphCore
  .validateCommercialDependencyGraph;

// Stable browser-adapter failures; canonical input rejection retains the core
// `invalid_canonical_value` code before Web Crypto is invoked.
export const COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES = Object.freeze({
  UNAVAILABLE: "hash_unavailable",
  FAILED: "hash_failed"
});

export async function sha256CanonicalValue(value, { cryptoApi = globalThis.crypto } = {}) {
  const canonical = canonicalSerialize(value);
  if (
    typeof TextEncoder !== "function"
    || !cryptoApi?.subtle
    || typeof cryptoApi.subtle.digest !== "function"
  ) {
    throw new CommercialDependencyGraphError(
      COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES.UNAVAILABLE,
      "SHA-256 Web Crypto is unavailable for the dependency fingerprint."
    );
  }

  let digest;
  try {
    digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  } catch {
    throw new CommercialDependencyGraphError(
      COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES.FAILED,
      "SHA-256 dependency fingerprint generation failed."
    );
  }
  const bytes = new Uint8Array(digest);
  if (bytes.length !== 32) {
    throw new CommercialDependencyGraphError(
      COMMERCIAL_DEPENDENCY_HASH_ERROR_CODES.FAILED,
      "SHA-256 dependency fingerprint generation returned an invalid digest."
    );
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
