import { describe, expect, test } from "vitest";

import {
  STAGING_CONNECT_DATABASE_ID,
  STAGING_CONNECT_PROJECT_ID,
  STAGING_CONNECT_PROJECT_NUMBER,
  STAGING_CONNECT_WEB_APP_ID,
  evaluateStripeConnectStagingLive,
  formatStripeConnectStagingLiveReport
} from "../../../scripts/check-stripe-connect-staging-live.mjs";

function buildProject() {
  return {
    projectId: STAGING_CONNECT_PROJECT_ID,
    projectNumber: STAGING_CONNECT_PROJECT_NUMBER,
    resources: {
      hostingSite: STAGING_CONNECT_PROJECT_ID
    },
    state: "ACTIVE"
  };
}

function buildWebApp() {
  return {
    platform: "WEB",
    appId: STAGING_CONNECT_WEB_APP_ID,
    state: "ACTIVE"
  };
}

describe("Stripe Connect staging live preflight", () => {
  test("fails closed when the named database is still missing", () => {
    const result = evaluateStripeConnectStagingLive({
      projects: [buildProject()],
      apps: [buildWebApp()],
      databases: [
        {
          name: `projects/${STAGING_CONNECT_PROJECT_ID}/databases/(default)`,
          locationId: "nam5",
          type: "FIRESTORE_NATIVE",
          databaseEdition: "STANDARD",
          deleteProtectionState: "DELETE_PROTECTION_DISABLED"
        }
      ]
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain(
      `named Firestore database ${STAGING_CONNECT_DATABASE_ID} is missing from the staging project.`
    );
    expect(formatStripeConnectStagingLiveReport(result)).toContain("BLOCKED");
  });

  test("accepts only the exact reviewed staging inventory", () => {
    const result = evaluateStripeConnectStagingLive({
      projects: [buildProject()],
      apps: [buildWebApp()],
      databases: [
        {
          name: `projects/${STAGING_CONNECT_PROJECT_ID}/databases/${STAGING_CONNECT_DATABASE_ID}`,
          locationId: "nam5",
          type: "FIRESTORE_NATIVE",
          databaseEdition: "STANDARD",
          deleteProtectionState: "DELETE_PROTECTION_ENABLED"
        }
      ]
    });

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(formatStripeConnectStagingLiveReport(result)).toContain("READY");
  });

  test("fails closed when the exact staging web app identity drifts", () => {
    const result = evaluateStripeConnectStagingLive({
      projects: [buildProject()],
      apps: [{ ...buildWebApp(), appId: "1:844470813106:web:different" }],
      databases: [
        {
          name: `projects/${STAGING_CONNECT_PROJECT_ID}/databases/${STAGING_CONNECT_DATABASE_ID}`,
          locationId: "nam5",
          type: "FIRESTORE_NATIVE",
          databaseEdition: "STANDARD",
          deleteProtectionState: "DELETE_PROTECTION_ENABLED"
        }
      ]
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain(
      `staging Firebase WEB app ${STAGING_CONNECT_WEB_APP_ID} is missing or changed.`
    );
  });
});
