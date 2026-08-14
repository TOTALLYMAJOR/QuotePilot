import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS,
  assertProjectedConnectAdmin,
  buildConnectAuthorityProjection,
  normalizeConnectAuthorityProjection
} = require("../../../functions-connect/authorityProjection.js");

const NOW_MS = Date.parse("2026-08-14T15:00:00.000Z");

function projection(overrides = {}) {
  return buildConnectAuthorityProjection({
    organizationId: "org_alpha",
    authorityRevision: 7,
    organizationActive: true,
    ownerUid: "owner_uid",
    members: [
      {
        uid: "admin_uid",
        email: "admin@example.test",
        role: "admin",
        emailVerified: true,
        disabled: false
      },
      {
        uid: "owner_uid",
        email: "owner@example.test",
        role: "admin",
        emailVerified: true,
        disabled: false
      }
    ],
    sourceReceiptId: "role-snapshot:org_alpha:7",
    sourceReceiptDigest: "a".repeat(64),
    observedAtISO: new Date(NOW_MS).toISOString(),
    expiresAtISO: new Date(NOW_MS + CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS * 1000).toISOString(),
    ...overrides
  }, { nowMs: NOW_MS });
}

describe("Stripe Connect authority projection", () => {
  test("builds an exact receipt-bound projection and authorizes only its current admin set", () => {
    const current = projection();
    expect(current).toMatchObject({
      schemaVersion: 1,
      policyRevision: 1,
      organizationId: "org_alpha",
      authorityRevision: 7,
      ownerUid: "owner_uid",
      payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(assertProjectedConnectAdmin({
      uid: "admin_uid",
      organizationId: "org_alpha",
      email: "admin@example.test"
    }, current, NOW_MS)).toMatchObject({ actorIsOwner: false });
    expect(assertProjectedConnectAdmin({
      uid: "owner_uid",
      organizationId: "org_alpha",
      email: "owner@example.test"
    }, current, NOW_MS)).toMatchObject({ actorIsOwner: true });
    expect(() => assertProjectedConnectAdmin({
      uid: "removed_admin",
      organizationId: "org_alpha",
      email: "removed@example.test"
    }, current, NOW_MS)).toThrow(/current same-organization admin/i);
  });

  test("fails closed for expiry, inactive organizations, disabled members, and owner omission", () => {
    const current = projection();
    expect(() => normalizeConnectAuthorityProjection(current, {
      nowMs: NOW_MS + CONNECT_AUTHORITY_MAX_VALIDITY_SECONDS * 1000 + 1
    })).toThrow(/expired/i);
    expect(() => projection({ organizationActive: false })).toThrow(/inactive organization/i);
    expect(() => projection({
      members: [{
        uid: "owner_uid",
        email: "owner@example.test",
        role: "admin",
        emailVerified: true,
        disabled: true
      }]
    })).toThrow(/enabled, verified administrators/i);
    expect(() => projection({
      members: [{
        uid: "admin_uid",
        email: "admin@example.test",
        role: "admin",
        emailVerified: true,
        disabled: false
      }]
    })).toThrow(/canonical owner/i);
  });

  test("rejects unsorted or duplicate members and exact-payload tampering", () => {
    expect(() => projection({
      members: [
        {
          uid: "owner_uid",
          email: "owner@example.test",
          role: "admin",
          emailVerified: true,
          disabled: false
        },
        {
          uid: "admin_uid",
          email: "admin@example.test",
          role: "admin",
          emailVerified: true,
          disabled: false
        }
      ]
    })).toThrow(/sorted by UID/i);

    const current = projection();
    expect(() => normalizeConnectAuthorityProjection({
      ...current,
      authorityRevision: current.authorityRevision + 1
    }, { nowMs: NOW_MS })).toThrow(/payload digest/i);
    expect(() => normalizeConnectAuthorityProjection({
      ...current,
      unexpected: true
    }, { nowMs: NOW_MS })).toThrow(/exact supported fields/i);
  });
});
