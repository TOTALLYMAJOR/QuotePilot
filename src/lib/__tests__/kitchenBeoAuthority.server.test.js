import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  BEO_DECLARED_INPUT_NODE_IDS,
  createBeoArtifactFingerprint
} from "../beoArtifactFingerprint";
import { buildBeoPayload } from "../beoPayload";
import { proposalPayloadFixtureQuote } from "./fixtures/proposalPayloadFixture";

const require = createRequire(import.meta.url);
const graphCore = require("../commercialDependencyGraphCore.cjs");
const {
  KITCHEN_BEO_DECLARED_INPUT_NODE_IDS,
  KITCHEN_BEO_FRESHNESS_STATES,
  KITCHEN_BEO_MAX_ARTIFACT_BYTES,
  KitchenBeoAuthorityError,
  createKitchenBeoAuthority
} = require("../../../functions/kitchenBeoAuthority.js");

const authority = createKitchenBeoAuthority({ graphCore });

function canonicalQuote(overrides = {}) {
  return {
    ...proposalPayloadFixtureQuote,
    id: "quote-a",
    organizationId: "org-a",
    activeVersionId: "v0014",
    latestVersionNumber: 14,
    versionMeta: {
      versionId: "v0014",
      versionNumber: 14,
      createdAt: "2026-08-09T14:30:00.000Z"
    },
    ...overrides
  };
}

function trustedContext(overrides = {}) {
  return {
    organizationId: "org-a",
    quoteId: "quote-a",
    nowISO: "2026-08-09T15:00:00.000Z",
    actor: {
      uid: "staff-a",
      email: "Staff@Example.test",
      role: "sales"
    },
    ...overrides
  };
}

function generationClaim(quote = canonicalQuote(), request = { requestId: "request-a" }) {
  return authority.buildGenerationClaim({
    canonicalQuote: quote,
    request,
    trustedContext: trustedContext()
  });
}

function generationReceipt({
  quote = canonicalQuote(),
  request = { requestId: "request-a" },
  bytes = Buffer.from("%PDF-1.4\ntrusted-kitchen-beo\n", "utf8")
} = {}) {
  return authority.buildGenerationReceipt({
    claim: generationClaim(quote, request),
    artifact: {
      bytes,
      filename: "Q-2026-0042-kitchen-beo.pdf",
      mimeType: "application/pdf"
    },
    trustedCompletion: {
      generatedAtISO: "2026-08-09T15:00:01.000Z"
    }
  });
}

function statusInput(overrides = {}) {
  return {
    canonicalQuote: canonicalQuote(),
    trustedReceipt: generationReceipt(),
    invalidations: [],
    sourceState: "available",
    trustedContext: trustedContext({
      nowISO: "2026-08-09T15:05:00.000Z"
    }),
    ...overrides
  };
}

describe("server Kitchen BEO authority foundation", () => {
  test("uses the injected canonical graph and stays byte-identical to the existing BEO adapter", async () => {
    const quote = canonicalQuote();
    const serverPayload = authority.buildCanonicalPayload(quote);
    const browserPayload = buildBeoPayload(quote);
    const serverFingerprint = authority.createFingerprint(serverPayload);
    const browserFingerprint = await createBeoArtifactFingerprint(browserPayload);

    expect(serverPayload).toEqual(browserPayload);
    expect(KITCHEN_BEO_DECLARED_INPUT_NODE_IDS).toEqual(BEO_DECLARED_INPUT_NODE_IDS);
    expect(serverFingerprint).toMatchObject({
      graphId: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.graphId,
      graphVersion: graphCore.COMMERCIAL_DEPENDENCY_GRAPH_V1.graphVersion,
      dependencyFingerprint: browserFingerprint.dependencyFingerprint
    });
  });

  test("requires the canonical graph core instead of embedding another registry", () => {
    expect(() => createKitchenBeoAuthority()).toThrow(KitchenBeoAuthorityError);
    expect(() => createKitchenBeoAuthority({ graphCore: {} })).toThrow(
      /canonical Commercial Dependency Graph core must be injected/i
    );
  });

  test("derives receipt identity, revision, actor, time, and fingerprint only from trusted inputs", () => {
    const baseline = generationClaim();
    const forged = generationClaim(canonicalQuote(), {
      requestId: "request-a",
      dependencyFingerprint: "f".repeat(64),
      commercialSourceRevisionId: "v9999",
      receiptId: "beo_forged",
      generatedAtISO: "1999-01-01T00:00:00.000Z",
      actor: {
        uid: "attacker",
        email: "attacker@example.test",
        role: "admin"
      }
    });

    expect(forged).toEqual(baseline);
    expect(forged).toMatchObject({
      authority: "server_authoritative",
      requestId: "request-a",
      organizationId: "org-a",
      quoteId: "quote-a",
      commercialSourceRevisionId: "v0014",
      claimedAtISO: "2026-08-09T15:00:00.000Z",
      claimedBy: {
        uid: "staff-a",
        email: "staff@example.test",
        role: "sales"
      }
    });
    expect(forged.receiptId).toMatch(/^beo_[a-f0-9]{48}$/);
    expect(forged.dependencyFingerprint).not.toBe("f".repeat(64));
  });

  test("makes exact receipt replay idempotent and rejects identity reuse with different bytes", () => {
    const first = generationReceipt();
    const repeated = generationReceipt();
    const replay = authority.reconcileReceiptReplay({
      existingReceipt: first,
      proposedReceipt: repeated
    });

    expect(replay).toEqual({ receipt: first, idempotent: true });
    expect(first.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.generatedBy.email).toBe("staff@example.test");

    const conflicting = generationReceipt({
      bytes: Buffer.from("%PDF-1.4\ndifferent immutable bytes\n", "utf8")
    });
    expect(() => authority.reconcileReceiptReplay({
      existingReceipt: first,
      proposedReceipt: conflicting
    })).toThrow(/already bound to different immutable evidence/i);
  });

  test("validates an immutable stored receipt before its exact bytes may be downloaded", () => {
    const bytes = Buffer.from("%PDF-1.4\nimmutable kitchen BEO bytes\n", "utf8");
    const receipt = generationReceipt({ bytes });
    expect(authority.validateGenerationReceipt(receipt)).toEqual(receipt);
    expect(authority.validateStoredArtifact({
      ...receipt,
      artifactBase64: bytes.toString("base64")
    })).toEqual({
      receipt,
      artifact: {
        mimeType: "application/pdf",
        filename: receipt.filename,
        base64: bytes.toString("base64")
      }
    });
    expect(() => authority.validateGenerationReceipt({
      ...receipt,
      artifactSha256: "browser-claimed-success"
    })).toThrow(/generation receipt is invalid/i);
    expect(() => authority.validateGenerationReceipt({
      ...receipt,
      quoteId: "quote-b"
    })).toThrow(/generation receipt identity is invalid/i);
    expect(() => authority.validateStoredArtifact({
      ...receipt,
      artifactBase64: Buffer.from("%PDF-1.4\ntampered\n", "utf8").toString("base64")
    })).toThrow(/do not match the immutable receipt/i);
    expect(() => authority.validateStoredArtifact({
      ...receipt,
      artifactBase64: "not base64"
    })).toThrow(/artifact bytes are invalid/i);
  });

  test("bounds immutable PDF evidence below the Firestore document ceiling", () => {
    expect(() => generationReceipt({
      bytes: Buffer.alloc(KITCHEN_BEO_MAX_ARTIFACT_BYTES + 1, 1)
    })).toThrow(/must be between 1 and 700000 bytes/i);
  });

  test("fails closed on cross-tenant identity and legacy unversioned canonical sources", () => {
    expect(() => authority.buildGenerationClaim({
      canonicalQuote: canonicalQuote(),
      request: { requestId: "request-a" },
      trustedContext: trustedContext({ organizationId: "org-b" })
    })).toThrow(/outside the trusted organization/i);

    expect(() => authority.buildGenerationClaim({
      canonicalQuote: canonicalQuote({
        activeVersionId: "",
        latestVersionNumber: 0,
        versionMeta: {}
      }),
      request: { requestId: "request-a" },
      trustedContext: trustedContext()
    })).toThrow(/canonical active quote revision is required/i);
  });
});

describe("server-derived Kitchen BEO freshness", () => {
  test("covers CURRENT, STALE, REVIEW, NOT_GENERATED, and UNKNOWN without browser authority", () => {
    const current = authority.deriveArtifactStatus(statusInput());
    expect(current).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.CURRENT,
      authority: "server_derived",
      reasonCodes: ["trusted_receipt_matches_canonical_source"]
    });

    const changedQuote = canonicalQuote({
      event: {
        ...proposalPayloadFixtureQuote.event,
        guests: proposalPayloadFixtureQuote.event.guests + 25
      }
    });
    const stale = authority.deriveArtifactStatus(statusInput({
      canonicalQuote: changedQuote
    }));
    expect(stale.state).toBe(KITCHEN_BEO_FRESHNESS_STATES.STALE);
    expect(stale.reasonCodes).toContain("declared_inputs_changed");

    const unsupportedReceipt = {
      ...generationReceipt(),
      graphVersion: "commercial-dependency-graph-v0"
    };
    const review = authority.deriveArtifactStatus(statusInput({
      trustedReceipt: unsupportedReceipt
    }));
    expect(review).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.REVIEW,
      reasonCodes: ["receipt_contract_requires_review"]
    });

    const notGenerated = authority.deriveArtifactStatus(statusInput({
      trustedReceipt: null
    }));
    expect(notGenerated).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.NOT_GENERATED,
      receiptId: "",
      reasonCodes: ["trusted_receipt_missing"]
    });

    const unknown = authority.deriveArtifactStatus(statusInput({
      sourceState: "error"
    }));
    expect(unknown).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      reasonCodes: ["canonical_source_error"]
    });
  });

  test("treats revision drift and open invalidations as authoritative non-current evidence", () => {
    const revisionDrift = authority.deriveArtifactStatus(statusInput({
      canonicalQuote: canonicalQuote({
        activeVersionId: "v0015",
        latestVersionNumber: 15,
        versionMeta: {
          versionId: "v0015",
          versionNumber: 15,
          createdAt: "2026-08-09T16:00:00.000Z"
        }
      })
    }));
    expect(revisionDrift.state).toBe(KITCHEN_BEO_FRESHNESS_STATES.STALE);
    expect(revisionDrift.reasonCodes).toContain("commercial_source_revision_changed");

    const openReview = authority.deriveArtifactStatus(statusInput({
      invalidations: [{
        id: "invalidation-review",
        artifactNodeId: "artifact.kitchen_beo",
        state: "open",
        classification: "REVIEW"
      }]
    }));
    expect(openReview).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.REVIEW,
      unresolvedInvalidationIds: ["invalidation-review"]
    });

    const openStale = authority.deriveArtifactStatus(statusInput({
      invalidations: [{
        id: "invalidation-stale",
        artifactNodeId: "artifact.kitchen_beo",
        state: "open",
        classification: "STALE"
      }]
    }));
    expect(openStale).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.STALE,
      unresolvedInvalidationIds: ["invalidation-stale"]
    });
    expect(openStale.reasonCodes).toContain("authorized_invalidation_open");

    const resolved = authority.deriveArtifactStatus(statusInput({
      invalidations: [{
        id: "invalidation-resolved",
        artifactNodeId: "artifact.kitchen_beo",
        state: "resolved",
        classification: "STALE"
      }]
    }));
    expect(resolved).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.CURRENT,
      unresolvedInvalidationIds: []
    });
  });

  test("does not collapse corrupt or cross-scope receipt evidence into CURRENT", () => {
    const corrupt = authority.deriveArtifactStatus(statusInput({
      trustedReceipt: {
        ...generationReceipt(),
        artifactSha256: "browser-claimed-success"
      }
    }));
    expect(corrupt).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      reasonCodes: ["trusted_receipt_invalid"]
    });

    const wrongQuote = authority.deriveArtifactStatus(statusInput({
      trustedReceipt: {
        ...generationReceipt(),
        quoteId: "quote-b"
      }
    }));
    expect(wrongQuote).toMatchObject({
      state: KITCHEN_BEO_FRESHNESS_STATES.UNKNOWN,
      reasonCodes: ["trusted_receipt_scope_mismatch"]
    });
  });
});
