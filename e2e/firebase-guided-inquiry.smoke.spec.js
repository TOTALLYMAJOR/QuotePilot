import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { loadFirebaseAdmin } from "../scripts/firebase-admin-modular.mjs";

const PROJECT_ID = process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e";
const ORGANIZATION_ID = process.env.E2E_FIREBASE_ORG_ID || "e2e-org";
const OTHER_ORGANIZATION_ID = process.env.E2E_FIREBASE_SECOND_ORG_ID || "e2e-org-blank";
const ADMIN_EMAIL = process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test";
const ADMIN_PASSWORD = process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!";
const OTHER_ADMIN_EMAIL = process.env.E2E_FIREBASE_SECOND_EMAIL || "e2e-admin-blank@local.test";
const OTHER_ADMIN_PASSWORD = process.env.E2E_FIREBASE_SECOND_PASSWORD || "Passw0rd!";
const RATE_LIMIT_SECRET = process.env.INQUIRY_RATE_LIMIT_SECRET || "guided-inquiry-emulator-rate-limit-only";
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SLUG = "e2e-guided-events";

let admin;
let db;
let activePublication;
let submittedInquiry;

function collectionCounts() {
  return Promise.all([
    db.collection(`organizations/${ORGANIZATION_ID}/customerInquiries`).get(),
    db.collection("publicInquiryRequests").get(),
    db.collectionGroup("receipts").get(),
    db.collection(`organizations/${ORGANIZATION_ID}/quotes`).get(),
    db.collection(`organizations/${ORGANIZATION_ID}/customers`).get(),
    db.collection("customerPortalQuotes").get()
  ]).then(([inquiries, requests, receipts, quotes, customers, portals]) => ({
    inquiries: inquiries.size,
    requests: requests.size,
    receipts: receipts.size,
    quotes: quotes.size,
    customers: customers.size,
    portals: portals.size
  }));
}

async function signIn(page, email, password) {
  await page.goto("/app");
  const signInHeading = page.getByRole("heading", { name: "Staff Sign In" });
  await expect(signInHeading).toBeVisible({ timeout: 45_000 });
  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(password);
  await page.locator(".auth-actions").getByRole("button", { name: "Sign In" }).click();
  await expect.poll(
    () => page.evaluate(async () => (await import("/src/lib/firebase.js")).auth?.currentUser?.email || null),
    { timeout: 45_000 }
  ).toBe(email);
}

async function callInquiry(page, method, request) {
  return page.evaluate(async ({ method: nextMethod, request: nextRequest }) => {
    const api = await import("/src/lib/inquiryShowcaseClient.js");
    try {
      return { ok: true, value: await api[nextMethod](nextRequest) };
    } catch (error) {
      return { ok: false, code: error?.code || "unknown", message: error?.message || String(error) };
    }
  }, { method, request });
}

function submissionRequest(publication, suffix, recoverySecret = `recovery-${suffix}-${"x".repeat(24)}`) {
  return {
    slug: SLUG,
    publicationVersionId: publication.publicationVersionId,
    requestId: `inquiry_request_${suffix}_${"r".repeat(20)}`,
    recoverySecret,
    turnstileToken: TURNSTILE_TOKEN,
    fields: {
      name: "Emulator Customer",
      email: `guided-${suffix}@example.test`,
      phone: "312-555-0100",
      organization: "Guided Inquiry Test",
      eventType: "Wedding",
      eventDate: "2027-06-12",
      estimatedGuests: 80,
      location: "Chicago",
      notes: "Outdoor if possible",
      serviceResponseConsent: true
    },
    preferenceRefs: publication.entries.slice(0, 2).map(({ entryId }) => ({ entryId }))
  };
}

function quoteFormFromPreview(preview, packageId, menuItemId) {
  return {
    ...preview.prefill,
    pkg: packageId,
    menuItems: [menuItemId],
    addons: [],
    rentals: [],
    eventName: preview.prefill.eventName,
    date: preview.prefill.date,
    time: "12:00",
    venue: preview.prefill.venue,
    venueAddress: preview.prefill.venueAddress,
    guests: preview.prefill.guests,
    hours: 4,
    servers: 0,
    chefs: 0,
    bartenders: 0,
    dietaryRestrictions: "",
    style: "",
    taxRegion: "",
    seasonProfileId: "auto",
    milesRT: 0,
    includeDisposables: true,
    payMethod: "card"
  };
}

test.beforeAll(async () => {
  admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId: PROJECT_ID });
  db = admin.getFirestore();
});

test.describe.serial("Guided Inquiry Firebase-emulator acceptance", () => {
  test("denies cross-tenant staff access through the callable boundary", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, OTHER_ADMIN_EMAIL, OTHER_ADMIN_PASSWORD);
    const crossTenant = await callInquiry(page, "getInquiryQueue", { organizationId: ORGANIZATION_ID });
    expect(crossTenant.ok).toBe(false);
    expect(crossTenant.code).toBe("permission-denied");
  });

  test("publishes only an exact active version and rejects stale or paused publication state", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const adminState = await callInquiry(page, "getInquiryShowcaseAdminState", { organizationId: ORGANIZATION_ID });
    expect(adminState.ok).toBe(true);
    const references = adminState.value.catalogReferences.filter((item) => item.active && item.customerSafe);
    const offer = references.find((item) => item.referenceType === "offer");
    const menuItem = references.find((item) => item.referenceType === "menu_item");
    expect(offer).toBeTruthy();
    expect(menuItem).toBeTruthy();

    const saved = await callInquiry(page, "saveInquiryShowcaseDraft", {
      organizationId: ORGANIZATION_ID,
      tenantEnabled: true,
      draft: {
        slug: SLUG,
        pageTitle: "Plan your gathering",
        introduction: "Tell us what you are considering.",
        responsePromise: "We will follow up with a quote-ready next step.",
        entries: [
          { referenceType: "offer", referenceId: offer.referenceId, publicTitle: "A relaxed catered event", shortDescription: "A preference to discuss.", displayOrder: 1 },
          { referenceType: "menu_item", referenceId: menuItem.referenceId, publicTitle: "A menu starting point", shortDescription: "A preference, not confirmed scope.", displayOrder: 2 }
        ]
      }
    });
    expect(saved).toMatchObject({ ok: true, value: { tenantEnabled: true } });
    const published = await callInquiry(page, "publishInquiryShowcase", { organizationId: ORGANIZATION_ID });
    expect(published.ok).toBe(true);

    const anonymousContext = await browser.newContext();
    const anonymousPage = await anonymousContext.newPage();
    await anonymousPage.goto("/");
    const exact = await callInquiry(anonymousPage, "getPublishedInquiryShowcase", { slug: SLUG });
    expect(exact.ok).toBe(true);
    expect(exact.value.showcase.publicationVersionId).toBe(published.value.versionId);
    expect(JSON.stringify(exact.value.showcase)).not.toMatch(/ppp|price|cost|margin|availability|inclusion/iu);
    const missing = await callInquiry(anonymousPage, "getPublishedInquiryShowcase", { slug: "missing-guided-inquiry" });
    expect(missing).toMatchObject({ ok: false, code: "not-found" });

    const paused = await callInquiry(page, "pauseInquiryShowcase", { organizationId: ORGANIZATION_ID });
    expect(paused.ok).toBe(true);
    expect(await callInquiry(anonymousPage, "getPublishedInquiryShowcase", { slug: SLUG })).toMatchObject({ ok: false, code: "not-found" });

    const republished = await callInquiry(page, "republishInquiryShowcaseVersion", {
      organizationId: ORGANIZATION_ID,
      versionId: published.value.versionId
    });
    expect(republished.ok).toBe(true);
    const refreshed = await callInquiry(anonymousPage, "getPublishedInquiryShowcase", { slug: SLUG });
    expect(refreshed.ok).toBe(true);
    activePublication = refreshed.value.showcase;

    const beforeStale = await collectionCounts();
    const stale = await callInquiry(anonymousPage, "submitPublicInquiry", {
      ...submissionRequest({ ...activePublication, publicationVersionId: published.value.versionId }, "stale"),
      publicationVersionId: published.value.versionId
    });
    expect(stale).toMatchObject({ ok: false, code: "aborted" });
    const afterStale = await collectionCounts();
    expect(afterStale.inquiries).toBe(beforeStale.inquiries);
    expect(afterStale.requests).toBe(beforeStale.requests);
    expect(afterStale.receipts).toBe(beforeStale.receipts);
    await anonymousContext.close();
  });

  test("keeps submission recovery idempotent and isolates notification failure", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const request = submissionRequest(activePublication, "accepted");
    const before = await collectionCounts();
    const created = await callInquiry(page, "submitPublicInquiry", request);
    expect(created).toMatchObject({ ok: true, value: { idempotent: false } });
    const repeated = await callInquiry(page, "submitPublicInquiry", request);
    expect(repeated).toMatchObject({ ok: true, value: { idempotent: true } });
    expect(repeated.value.inquiryId).toBe(created.value.inquiryId);
    expect(repeated.value.receiptId).toBe(created.value.receiptId);

    const wrongSecret = await callInquiry(page, "resolveInquirySubmission", {
      slug: SLUG,
      requestId: request.requestId,
      recoverySecret: `wrong-${"z".repeat(32)}`
    });
    expect(wrongSecret.ok).toBe(false);
    const recovered = await callInquiry(page, "resolveInquirySubmission", {
      slug: SLUG,
      requestId: request.requestId,
      recoverySecret: request.recoverySecret
    });
    expect(recovered).toMatchObject({ ok: true, value: { outcome: "received", receiptId: created.value.receiptId } });

    const after = await collectionCounts();
    expect(after.inquiries).toBe(before.inquiries + 1);
    expect(after.requests).toBe(before.requests + 1);
    const inquirySnap = await db.doc(`organizations/${ORGANIZATION_ID}/customerInquiries/${created.value.inquiryId}`).get();
    expect(inquirySnap.data()?.notification?.state).toMatch(/^(?:failed|not_configured)$/u);
    submittedInquiry = { ...created.value, request };
  });

  test("rejects tenant and IP quota edges without creating inquiry authority", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const limits = await db.collection("inquiryRateLimits").get();
    const tenantDoc = limits.docs.find((doc) => doc.data()?.scope === "tenant_hour");
    const ipDoc = limits.docs.find((doc) => doc.data()?.scope === "tenant_ip_hour");
    expect(tenantDoc).toBeTruthy();
    expect(ipDoc).toBeTruthy();

    const beforeTenant = await collectionCounts();
    await tenantDoc.ref.set({ count: 40 }, { merge: true });
    const tenantLimited = await callInquiry(page, "submitPublicInquiry", submissionRequest(activePublication, "tenant-limit"));
    expect(tenantLimited).toMatchObject({ ok: false, code: "resource-exhausted" });
    expect(await collectionCounts()).toMatchObject(beforeTenant);

    await tenantDoc.ref.set({ count: 1 }, { merge: true });
    await ipDoc.ref.set({ count: 8 }, { merge: true });
    const beforeIp = await collectionCounts();
    const ipLimited = await callInquiry(page, "submitPublicInquiry", submissionRequest(activePublication, "ip-limit"));
    expect(ipLimited).toMatchObject({ ok: false, code: "resource-exhausted" });
    expect(await collectionCounts()).toMatchObject(beforeIp);
    await ipDoc.ref.set({ count: 1 }, { merge: true });
  });

  test("fails stale conversion closed and creates one atomic authoritative artifact set", async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const acknowledged = await callInquiry(page, "acknowledgeInquiry", {
      organizationId: ORGANIZATION_ID,
      inquiryId: submittedInquiry.inquiryId,
      expectedRevision: 1
    });
    expect(acknowledged).toMatchObject({ ok: true, value: { state: "acknowledged", revision: 2 } });
    const preview = await callInquiry(page, "previewInquiryConversion", {
      organizationId: ORGANIZATION_ID,
      inquiryId: submittedInquiry.inquiryId
    });
    expect(preview.ok).toBe(true);

    const state = await callInquiry(page, "getInquiryShowcaseAdminState", { organizationId: ORGANIZATION_ID });
    const offer = state.value.catalogReferences.find((item) => item.referenceType === "offer" && item.active && item.customerSafe);
    const menuItem = state.value.catalogReferences.find((item) => item.referenceType === "menu_item" && item.active && item.customerSafe);
    const resolutions = preview.value.drift
      .filter((item) => item.requiresResolution)
      .map((item) => ({ entryId: item.entryId, resolution: item.state === "changed" ? "use_current" : "remove" }));
    const payload = {
      organizationId: ORGANIZATION_ID,
      inquiryId: submittedInquiry.inquiryId,
      expectedInquiryRevision: preview.value.inquiryRevision,
      expectedCatalogRevision: preview.value.catalogRevision,
      conversionRequestId: `inq_convert_${"c".repeat(24)}`,
      identityChoice: "create_new",
      resolutions,
      quoteForm: quoteFormFromPreview(preview.value, offer.referenceId, menuItem.referenceId)
    };

    const before = await collectionCounts();
    const staleInquiry = await callInquiry(page, "convertInquiryToQuoteDraft", {
      ...payload,
      expectedInquiryRevision: preview.value.inquiryRevision - 1
    });
    expect(staleInquiry).toMatchObject({ ok: false, code: "aborted" });
    const staleCatalog = await callInquiry(page, "convertInquiryToQuoteDraft", {
      ...payload,
      expectedCatalogRevision: preview.value.catalogRevision - 1
    });
    expect(staleCatalog).toMatchObject({ ok: false, code: "aborted" });
    expect(await collectionCounts()).toMatchObject(before);

    const attempts = await page.evaluate(async (request) => {
      const { convertInquiryToQuoteDraft } = await import("/src/lib/inquiryShowcaseClient.js");
      return Promise.allSettled([
        convertInquiryToQuoteDraft(request),
        convertInquiryToQuoteDraft(request)
      ]).then((results) => results.map((result) => result.status === "fulfilled"
        ? { status: result.status, value: result.value }
        : { status: result.status, code: result.reason?.code || "unknown", message: result.reason?.message || "" }));
    }, payload);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const successful = attempts.find(({ status }) => status === "fulfilled").value;

    const quoteSnap = await db.doc(`organizations/${ORGANIZATION_ID}/quotes/${successful.id}`).get();
    const versionSnap = await db.doc(`organizations/${ORGANIZATION_ID}/quotes/${successful.id}/versions/${successful.activeVersionId}`).get();
    const inquirySnap = await db.doc(`organizations/${ORGANIZATION_ID}/customerInquiries/${submittedInquiry.inquiryId}`).get();
    const conversionReceiptSnap = await db.doc(`organizations/${ORGANIZATION_ID}/customerInquiries/${submittedInquiry.inquiryId}/receipts/${successful.conversionReceiptId}`).get();
    const portalSnap = await db.doc(`customerPortalQuotes/${successful.portalKey}`).get();
    expect([quoteSnap.exists, versionSnap.exists, conversionReceiptSnap.exists, portalSnap.exists]).toEqual([true, true, true, true]);
    expect(quoteSnap.data()?.inquiryProvenance).toMatchObject({
      inquiryId: submittedInquiry.inquiryId,
      publicationVersionId: activePublication.publicationVersionId,
      commercialStatus: "unconfirmed_preferences"
    });
    expect(versionSnap.data()?.snapshot?.inquiryProvenance?.inquiryId).toBe(submittedInquiry.inquiryId);
    expect(inquirySnap.data()).toMatchObject({ state: "converted", conversion: { quoteId: successful.id } });
    expect(conversionReceiptSnap.data()).toMatchObject({
      receiptType: "inquiry_converted",
      quoteId: successful.id,
      conversionRequestId: payload.conversionRequestId
    });

    const after = await collectionCounts();
    expect(after.quotes).toBe(before.quotes + 1);
    expect(after.customers).toBe(before.customers + 1);
    expect(after.portals).toBe(before.portals + 1);
  });
});
