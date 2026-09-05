#!/usr/bin/env node
// Adds synthetic sign-in/display fixtures and native-planned local acceptance/booking after the real matrix.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const delivery = require('../functions/quoteDelivery.js');
const acceptance = require('../functions/proposalAcceptance.js');
const { buildCanonicalPortalSnapshot } = require('../functions/quoteCreation.js');
const { planContractConversion } = require('../functions/contractWorkflow.js');
const { buildQuoteCatalogRevisionReview } = require('../functions/quoteCatalogRevisionReview.js');
const attendance = require('../functions/quoteAttendance.js');
import { fileURLToPath } from 'node:url';
import { loadFirebaseAdmin } from './firebase-admin-modular.mjs';
import { assertRehearsalEmulators, REHEARSAL_PROJECT, REHEARSAL_ORIGIN } from './tenant-operating-model-local-rehearsal.mjs';

export async function prepareRehearsalCatalog() {
  assertRehearsalEmulators(process.env);
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId: REHEARSAL_PROJECT });
  const db = admin.getFirestore();
  const org = db.collection('organizations').doc('workflow-configuration-local');
  assert.equal((await org.get()).exists, false, 'Catalog fixture preparation requires fresh demo emulators.');
  const batch = db.batch();
  batch.create(org.collection('eventTypes').doc('pack-event'), { name: 'Synthetic catering event', active: true });
  batch.create(org.collection('menuCategories').doc('pack-entrees'), { name: 'Synthetic entrees', eventTypeId: 'pack-event', active: true });
  await batch.commit();
  console.log('Prepared synthetic event/menu taxonomy before pricing confirmation and native quote creation.');
}

export async function seedRehearsal() {
  assertRehearsalEmulators(process.env);
  const admin = loadFirebaseAdmin();
  if (!admin.getApps().length) admin.initializeApp({ projectId: REHEARSAL_PROJECT });
  const auth = admin.getAuth(); const db = admin.getFirestore();
  const organizationId = 'workflow-configuration-local';
  const org = db.collection('organizations').doc(organizationId);
  const settings = (await org.collection('settings').doc('config').get()).data();
  assert.equal(settings?.eventOperatingSpineEnabled, true);
  assert.equal(settings?.commercialChangeAuthorityEnabled, true);
  // Generate a fresh credential for this disposable emulator session only.
  const password = randomBytes(24).toString('base64url');
  for (const [email, role] of [['event-admin@local.test', 'admin'], ['event-sales@local.test', 'sales']]) {
    const user = await auth.getUserByEmail(email);
    assert.equal(user.customClaims?.organizationId, organizationId);
    assert.equal(user.customClaims?.role, role);
    assert.equal((await db.collection('userRoles').doc(user.uid).get()).data()?.role, role);
    await auth.updateUser(user.uid, { password, displayName: `Synthetic ${role} operator` });
  }
  await org.set({ name: 'Synthetic local catering rehearsal' }, { merge: true });
  const seededAtISO = new Date().toISOString();
  // Native pure owners build this explicitly synthetic acceptance and booking.
  // Delivery success below is local fixture input; no email or provider is called.
  const candidates = (await org.collection('quotes').get()).docs.filter((doc) => doc.data().status === 'draft' && doc.data().pricingCatalogAuthority);
  assert.equal(candidates.length, 1, 'Expected the real matrix current-catalog commercial draft.');
  const candidate = candidates[0]; const draft = candidate.data();
  const activeVersion = (await candidate.ref.collection('versions').doc(draft.activeVersionId).get()).data();
  const beforeNative = JSON.stringify({ version: activeVersion, payment: draft.payment, pricing: draft.pricing, authority: draft.pricingCatalogAuthority });
  const revisionId = delivery.resolveQuoteDeliveryRevisionId(draft, candidate.id);
  const claimed = delivery.claimQuoteDelivery({ quote: draft, quoteId: candidate.id, organizationId, expectedRevisionId: revisionId,
    actorEmail: 'event-admin@local.test', attemptId: 'local-rehearsal-synthetic-delivery', attemptProvider: 'resend', payloadSha256: 'd'.repeat(64), nowISO: seededAtISO });
  assert.equal(claimed.state, 'acquired');
  const success = delivery.buildQuoteDeliverySuccess({ delivery: claimed.delivery, email: { provider: 'resend', messageId: 'local-fixture-no-provider-send' },
    nowISO: seededAtISO, portalKey: draft.portalKey, portalIssuedAtISO: draft.portalIssuedAtISO });
  const sent = { ...draft, status: 'sent', workflow: { ...draft.workflow, quoteDelivery: success } };
  const signed = acceptance.planProposalAcceptance({ quoteId: candidate.id, quote: sent, portal: buildCanonicalPortalSnapshot(candidate.id, sent),
    portalKey: sent.portalKey, signerName: 'Synthetic local customer', consentVersion: acceptance.ACCEPTANCE_CONSENT_VERSION,
    expectedRevisionId: revisionId, expectedPortalIssuedAtISO: sent.portalIssuedAtISO, acceptedAtISO: seededAtISO,
    receiptId: `local-rehearsal-acceptance-${candidate.id}`, actor: {} });
  const accepted = { ...sent, ...signed.quotePatch };
  const booking = planContractConversion({ quoteId: candidate.id, quote: accepted, peerQuotes: [], actorEmail: 'event-admin@local.test',
    nowISO: seededAtISO, contractNumber: 'C-LOCAL-REHEARSAL', capacityLimit: 400 });
  const booked = { ...accepted, ...booking.quotePatch };
  assert.equal(booked.status, 'booked');
  attendance.resolveAcceptedSource({ organizationId, quoteId: candidate.id, sourceQuote: booked, sourceVersion: activeVersion, acceptanceReceiptDocument: signed.receiptDocument });
  assert.equal(buildQuoteCatalogRevisionReview({ organizationId, quoteId: candidate.id, quote: booked, settings, observedAtISO: seededAtISO }).state, 'current');
  assert.equal(JSON.stringify({ version: activeVersion, payment: booked.payment, pricing: booked.pricing, authority: booked.pricingCatalogAuthority }), beforeNative);
  const fixtureBatch = db.batch();
  fixtureBatch.set(candidate.ref, booked);
  fixtureBatch.set(db.collection('customerPortalQuotes').doc(booked.portalKey), buildCanonicalPortalSnapshot(candidate.id, booked));
  fixtureBatch.create(org.collection('proposalAcceptanceReceipts').doc(signed.receiptDocument.receiptId), signed.receiptDocument);
  await fixtureBatch.commit();
  const amendmentQuoteId = candidate.id;
  for (const quoteId of ['pack-operating-event', 'pack-closeout-event']) {
    const ref = org.collection('quotes').doc(quoteId);
    const quote = (await ref.get()).data();
    assert.ok(quote?.customerId, 'The accepted local fixture must already exist.');
    const name = quoteId === 'pack-operating-event' ? 'Synthetic event customer' : 'Synthetic closeout customer';
    await org.collection('customers').doc(quote.customerId).set({
      customerId: quote.customerId, organizationId, name, nameKey: name.toLowerCase(),
      email: `${quoteId}@local.test`, emailKey: `${quoteId}@local.test`, phone: '', company: 'Local rehearsal',
      createdAtISO: seededAtISO, updatedAtISO: seededAtISO, lastQuoteId: quoteId,
      lastQuoteNumber: quoteId, lastEventName: name, lastEventDate: quote.event.date
    });
    // This is the current local fixture creation time for directory ordering.
    // No commercial, acceptance, native event or receipt fields are replaced.
    if (!quote.createdAt) await ref.update({ createdAt: admin.FieldValue.serverTimestamp() });
  }
  console.log('\nSynthetic local rehearsal ready. These accounts have no hosted access.');
  console.log(`App: ${REHEARSAL_ORIGIN}/app`);
  console.log('Admin: event-admin@local.test | Sales: event-sales@local.test');
  console.log(`Local-only password: ${password}`);
  console.log(`Studio: ${REHEARSAL_ORIGIN}/app/catalog (Business workflows)`);
  console.log(`Event room: ${REHEARSAL_ORIGIN}/app/events/pack-operating-event/live`);
  console.log(`Attendance: ${REHEARSAL_ORIGIN}/app/quotes/pack-operating-event`);
  console.log(`Closeout: ${REHEARSAL_ORIGIN}/app/customers/customer-pack-closeout-event`);
  console.log(`Verified current-catalog booked amendment source: ${REHEARSAL_ORIGIN}/app/quotes/${encodeURIComponent(amendmentQuoteId)}`);
  console.log('The explicitly seeded accepted event fixtures are for operations and attendance; the separate booked amendment source was built with native acceptance/booking owners and verified against its unchanged current-catalog version. Synthetic acceptance and delivery fixtures are not provider or customer proof.');
  console.log('Published definitions in the acceptance fixture were retired deliberately. Existing pins remain readable; publish a reviewed new version in Studio for fresh instances.');
  console.log('Canonical native facts, tenant definitions and workflow progress are separate. Reopen/acknowledge tasks does not rewrite native records.');
  console.log('Stop: Ctrl+C in this terminal. Restart starts a new disposable fixture.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 1 && args[0] === '--catalog-only', 'Unsupported rehearsal seed arguments.');
  const action = args.length ? prepareRehearsalCatalog : seedRehearsal;
  action().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
