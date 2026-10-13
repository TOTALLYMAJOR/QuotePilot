#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadFirebaseAdmin } from "./firebase-admin-modular.mjs";

const LOOPBACK_EMULATOR_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/;
let admin;

export function assertE2EEmulatorSafety({ projectId, authHost, firestoreHost }) {
  if (
    !String(projectId || "").startsWith("demo-")
    || !LOOPBACK_EMULATOR_HOST.test(String(authHost || "").trim())
    || !LOOPBACK_EMULATOR_HOST.test(String(firestoreHost || "").trim())
  ) {
    throw new Error(
      "E2E auth seeding is restricted to a demo-* project with loopback Auth and Firestore emulators."
    );
  }
}

function readArg(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return String(process.argv[idx + 1] || "").trim() || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value, fallback = "e2e-org") {
  const raw = String(value || fallback).trim().toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

async function ensureUser({ auth, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  try {
    const existing = await auth.getUserByEmail(normalizedEmail);
    await auth.updateUser(existing.uid, { password, email: normalizedEmail, emailVerified: true });
    return existing.uid;
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const created = await auth.createUser({
    email: normalizedEmail,
    password,
    emailVerified: true
  });
  return created.uid;
}

async function seedPortalConversationFixture({ db, organizationId, uid, email }) {
  const quoteId = "conversation-e2e-quote";
  const portalKey = "conversation-e2e-portal-token-1234567890";
  const fixtureClockMs = Date.now();
  const portalIssuedAtISO = new Date(fixtureClockMs - 60_000).toISOString();
  const portalExpiresAtISO = new Date(fixtureClockMs + (29 * 24 * 60 * 60 * 1000)).toISOString();
  const revisionId = `v0001@${portalIssuedAtISO}`;
  const providerAcceptedAtISO = new Date(fixtureClockMs).toISOString();
  const deliveryEvidence = {
    revisionId,
    state: "provider_accepted",
    portalActivationState: "active",
    portalKey,
    portalIssuedAtISO,
    providerAcceptedAtISO
  };
  const quote = {
    id: quoteId,
    organizationId,
    ownerUid: uid,
    ownerEmail: email,
    quoteNumber: "QP-CONVERSATION-E2E",
    activeVersionId: "v0001",
    latestVersionNumber: 1,
    status: "sent",
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    expiresAtISO: portalExpiresAtISO,
    customerNameKey: "portal conversation customer",
    customerEmailKey: "portal-conversation@example.com",
    customer: {
      name: "Portal Conversation Customer",
      email: "portal-conversation@example.com"
    },
    eventTypeId: "wedding",
    event: {
      name: "Conversation Reception",
      date: "2027-06-12",
      time: "18:00",
      hours: 5,
      guests: 80,
      style: "buffet",
      venue: "Conversation Hall",
      venueAddress: "100 Quote Way",
      dietaryRestrictions: ""
    },
    selection: {
      eventTypeId: "wedding",
      packageName: "Signature",
      menuItems: ["menu-item-1"],
      menuItemNames: ["Smoked Chicken"]
    },
    totals: {
      base: 2000,
      addons: 0,
      rentals: 0,
      menu: 0,
      labor: 0,
      travel: 0,
      serviceFee: 0,
      tax: 0,
      total: 2000,
      deposit: 600
    },
    payment: { depositStatus: "unpaid", depositLink: "" },
    booking: {},
    portalDecision: {},
    quoteMeta: {
      organizationName: "E2E Organization",
      brandName: "E2E Organization",
      businessEmail: email
    },
    workflow: {
      quoteDelivery: {
        ...deliveryEvidence,
        provider: "resend",
        providerMessageId: "conversation-e2e-provider-message"
      }
    },
    lifecycle: { sentAtISO: providerAcceptedAtISO },
    createdAtISO: portalIssuedAtISO,
    updatedAtISO: providerAcceptedAtISO,
    createdAt: admin.FieldValue.serverTimestamp(),
    updatedAt: admin.FieldValue.serverTimestamp()
  };
  const portal = {
    quoteId,
    organizationId,
    portalKey,
    portalIssuedAtISO,
    portalExpiresAtISO,
    portalExpiresAtMs: Date.parse(portalExpiresAtISO),
    quoteNumber: quote.quoteNumber,
    customerName: quote.customer.name,
    customerEmail: quote.customer.email,
    eventName: quote.event.name,
    eventDate: quote.event.date,
    eventTime: quote.event.time,
    eventHours: quote.event.hours,
    eventGuests: quote.event.guests,
    eventStyle: quote.event.style,
    venue: quote.event.venue,
    venueAddress: quote.event.venueAddress,
    dietaryRestrictions: "",
    total: quote.totals.total,
    deposit: quote.totals.deposit,
    totals: quote.totals,
    selection: {
      packageName: quote.selection.packageName,
      addons: [],
      rentals: [],
      menuItems: quote.selection.menuItemNames
    },
    quoteMeta: quote.quoteMeta,
    status: quote.status,
    expiresAtISO: quote.expiresAtISO,
    payment: quote.payment,
    booking: quote.booking,
    portalDecision: {},
    deliveryEvidence,
    lifecycle: quote.lifecycle,
    createdAtISO: quote.createdAtISO,
    updatedAtISO: quote.updatedAtISO,
    createdAt: admin.FieldValue.serverTimestamp(),
    updatedAt: admin.FieldValue.serverTimestamp()
  };
  await Promise.all([
    db.doc(`organizations/${organizationId}/quotes/${quoteId}`).set(quote),
    db.doc(`customerPortalQuotes/${portalKey}`).set(portal)
  ]);
}

async function main() {
  const projectId = readArg("--project", process.env.E2E_FIREBASE_PROJECT_ID || "demo-e2e");
  const organizationId = slugify(readArg("--organization", process.env.E2E_FIREBASE_ORG_ID || "e2e-org"));
  const email = normalizeEmail(readArg("--email", process.env.E2E_FIREBASE_EMAIL || "e2e-admin@local.test"));
  const password = readArg("--password", process.env.E2E_FIREBASE_PASSWORD || "Passw0rd!");
  const skipConversation = hasFlag("--skip-conversation");

  if (!email || !password) {
    throw new Error("email and password are required.");
  }

  assertE2EEmulatorSafety({
    projectId,
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST
  });

  admin = loadFirebaseAdmin();

  if (!admin.getApps().length) {
    admin.initializeApp({ projectId });
  }

  const auth = admin.getAuth();
  const db = admin.getFirestore();
  const uid = await ensureUser({ auth, email, password });
  const now = admin.FieldValue.serverTimestamp();

  await db.doc(`organizations/${organizationId}`).set({
    name: "E2E Organization",
    slug: organizationId,
    ownerUid: uid,
    ownerEmail: email,
    active: true,
    archived: false,
    status: "active",
    updatedAt: now,
    updatedAtISO: new Date().toISOString(),
    createdAt: now
  }, { merge: true });

  await db.doc(`userRoles/${uid}`).set({
    role: "admin",
    organizationId,
    email,
    updatedAt: now,
    createdAt: now
  }, { merge: true });

  if (!skipConversation) {
    await seedPortalConversationFixture({ db, organizationId, uid, email });
  }

  console.log(`Seeded e2e auth user: ${email} (${uid}) in org ${organizationId}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error("E2E auth seed failed:", error?.message || error);
    process.exitCode = 1;
  });
}
