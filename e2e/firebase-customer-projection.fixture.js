import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { cloudFunctions, db } from "../src/lib/firebase";

export async function exerciseCustomerProjectionTransactions() {
  const organizationId = "e2e-org";
  const unique = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const normalizedEmail = `projection-${unique}@example.com`;
  const importedBatchId = `batch-${unique}`;
  const createCustomerImport = httpsCallable(cloudFunctions, "createCustomerImportBatch");
  const imported = (await createCustomerImport({
    organizationId,
    organizationName: "Authoritative Pricing E2E",
    fileName: "customer-projection.csv",
    importBatchId: importedBatchId,
    records: [{
      rowNumber: 2,
      record: {
        name: "Imported Projection Customer",
        email: normalizedEmail,
        phone: "205-555-0142",
        company: "Imported Customer Company",
        notes: "Preserve this imported customer note."
      }
    }]
  })).data;
  const importedCustomerId = String(imported?.createdRecords?.[0]?.id || "");
  if (imported?.ok !== true || imported?.createdCount !== 1 || !importedCustomerId) {
    throw new Error("The authoritative customer import did not create one customer fixture.");
  }
  const importedCustomerSnapshot = await getDoc(doc(
    db,
    "organizations",
    organizationId,
    "customers",
    importedCustomerId
  ));
  const importedCreatedAtISO = String(importedCustomerSnapshot.data()?.createdAtISO || "");
  if (!importedCustomerSnapshot.exists() || !importedCreatedAtISO) {
    throw new Error("The authoritative customer import fixture is unavailable.");
  }

  const [packageSnapshot, menuSnapshot] = await Promise.all([
    getDocs(collection(db, "organizations", organizationId, "catalogPackages")),
    getDocs(collection(db, "organizations", organizationId, "menuItems"))
  ]);
  const selectedPackage = [...packageSnapshot.docs]
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  const selectedMenuItem = [...menuSnapshot.docs]
    .filter((snapshot) => snapshot.data()?.active !== false)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!selectedPackage || !selectedMenuItem) {
    throw new Error("Authoritative catalog fixtures are unavailable.");
  }

  const baseForm = {
    name: "Projection Customer",
    email: normalizedEmail,
    phone: "",
    clientOrg: "",
    eventName: "Concurrent Projection",
    date: "2026-10-10",
    time: "18:30",
    venue: "Projection Hall",
    venueAddress: "100 Transaction Way",
    guests: 40,
    hours: 4,
    servers: 0,
    chefs: 0,
    bartenders: 0,
    dietaryRestrictions: "",
    style: "Buffet",
    pkg: selectedPackage.id,
    addons: [],
    rentals: [],
    menuItems: [selectedMenuItem.id],
    addonQuantities: {},
    rentalQuantities: {},
    menuItemQuantities: {},
    eventTypeId: String(selectedMenuItem.data()?.eventTypeId || ""),
    bartenderRateTypeId: "",
    staffingRateTypeId: "",
    bartenderRateOverride: "",
    serverRateOverride: "",
    chefRateOverride: "",
    serverRateMixCsv: "",
    chefRateMixCsv: "",
    eventTemplateId: "custom",
    taxRegion: "",
    seasonProfileId: "auto",
    milesRT: 0,
    includeDisposables: true,
    payMethod: "card"
  };
  const createQuote = httpsCallable(cloudFunctions, "createQuoteDraft");
  const createResponses = await Promise.all([
    createQuote({
      organizationId,
      form: {
        ...baseForm,
        email: normalizedEmail.toUpperCase(),
        eventName: "Concurrent Projection A"
      }
    }),
    createQuote({
      organizationId,
      form: {
        ...baseForm,
        email: `  ${normalizedEmail}  `,
        eventName: "Concurrent Projection B"
      }
    })
  ]);
  const createdQuotes = createResponses.map((response) => response.data);
  if (
    createdQuotes.some((quote) => quote?.ok !== true || !quote?.id)
    || new Set(createdQuotes.map((quote) => quote.id)).size !== 2
  ) {
    throw new Error("Concurrent quote creation did not return two distinct trusted drafts.");
  }

  const updateQuote = httpsCallable(cloudFunctions, "updateQuoteDraft");
  const editedQuoteId = createdQuotes[0].id;
  const editResponses = await Promise.all([
    updateQuote({
      organizationId,
      quoteId: editedQuoteId,
      form: {
        ...baseForm,
        name: "Projection Customer Edit A",
        eventName: "Atomic Projection Edit A",
        date: "2026-10-11"
      }
    }),
    updateQuote({
      organizationId,
      quoteId: editedQuoteId,
      form: {
        ...baseForm,
        name: "Projection Customer Edit B",
        eventName: "Atomic Projection Edit B",
        date: "2026-10-12"
      }
    })
  ]);
  if (editResponses.some((response) => response.data?.ok !== true)) {
    throw new Error("Concurrent quote edits did not complete through the trusted transaction path.");
  }

  const customerSnapshot = await getDocs(query(
    collection(db, "organizations", organizationId, "customers"),
    where("email", "==", normalizedEmail)
  ));
  const finalQuoteSnapshot = await getDoc(doc(
    db,
    "organizations",
    organizationId,
    "quotes",
    editedQuoteId
  ));
  const customerDocs = customerSnapshot.docs.map((snapshot) => ({
    id: snapshot.id,
    ...snapshot.data()
  }));
  return {
    normalizedEmail,
    importedCustomerId,
    importedBatchId,
    importedCreatedAtISO,
    createdQuoteIds: createdQuotes.map((quote) => quote.id),
    customerDocs,
    finalQuote: finalQuoteSnapshot.exists()
      ? { id: finalQuoteSnapshot.id, ...finalQuoteSnapshot.data() }
      : null
  };
}
