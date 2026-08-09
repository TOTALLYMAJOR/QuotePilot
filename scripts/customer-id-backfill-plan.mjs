function text(value, maxLength = 500) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

export function normalizeCustomerEmail(value) {
  return text(value, 254).toLowerCase();
}

export function normalizeCustomerNameKey(value) {
  return text(value, 160).toLowerCase().replace(/\s+/g, " ");
}

function recordData(entry) {
  return entry?.data && typeof entry.data === "object" && !Array.isArray(entry.data)
    ? entry.data
    : {};
}

function customerRecordEmail(entry) {
  const data = recordData(entry);
  const email = normalizeCustomerEmail(data.email);
  const emailKey = normalizeCustomerEmail(data.emailKey);
  if (email && emailKey && email !== emailKey) return "";
  return emailKey || email;
}

function customerRecordHasEmailConflict(entry) {
  const data = recordData(entry);
  const email = normalizeCustomerEmail(data.email);
  const emailKey = normalizeCustomerEmail(data.emailKey);
  return Boolean(email && emailKey && email !== emailKey);
}

function quoteCustomerEmail(entry) {
  const data = recordData(entry);
  return normalizeCustomerEmail(data.customerEmailKey || data.customer?.email);
}

export function planLegacyCustomerIdBackfill({
  quotes = [],
  customers = [],
  versions = [],
  organizationId,
  nowISO
} = {}) {
  const orgId = text(organizationId, 128);
  const timestamp = new Date(nowISO || Date.now()).toISOString();
  if (!orgId) throw new Error("organizationId is required.");

  const scopedCustomers = customers
    .filter((entry) => text(recordData(entry).organizationId, 128) === orgId)
    .map((entry) => ({ id: text(entry?.id), data: recordData(entry) }))
    .filter((entry) => entry.id);
  const customersByEmail = new Map();
  const customersById = new Map(scopedCustomers.map((customer) => [customer.id, customer]));
  for (const customer of scopedCustomers) {
    const emailKey = customerRecordEmail(customer);
    if (!emailKey) continue;
    const matches = customersByEmail.get(emailKey) || [];
    matches.push(customer);
    customersByEmail.set(emailKey, matches);
  }

  const entries = [];
  const conflicts = [];
  const summary = {
    sourceQuotes: 0,
    wouldBind: 0,
    wouldBindQuotes: 0,
    wouldBindVersions: 0,
    wouldNormalizeCustomers: 0,
    alreadyBound: 0,
    missingEmail: 0,
    missingCustomerMatch: 0,
    duplicateCustomerMatch: 0,
    invalidOrganization: 0,
    customerIdentityConflict: 0,
    versionIdentityConflict: 0
  };

  const versionsByQuoteId = new Map();
  for (const entry of versions) {
    const versionId = text(entry?.id);
    const quoteId = text(entry?.quoteId || recordData(entry).quoteId);
    if (!versionId || !quoteId) continue;
    const scoped = versionsByQuoteId.get(quoteId) || [];
    scoped.push({ id: versionId, quoteId, data: recordData(entry) });
    versionsByQuoteId.set(quoteId, scoped);
  }

  const orderedQuotes = [...quotes]
    .map((entry) => ({ id: text(entry?.id), data: recordData(entry) }))
    .filter((entry) => entry.id)
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const quote of orderedQuotes) {
    summary.sourceQuotes += 1;
    if (text(quote.data.organizationId, 128) !== orgId) {
      summary.invalidOrganization += 1;
      conflicts.push({ quoteId: quote.id, state: "invalid_organization" });
      continue;
    }
    const emailKey = quoteCustomerEmail(quote);
    const existingQuoteCustomerId = text(quote.data.customerId);
    if (!emailKey && !existingQuoteCustomerId) {
      summary.missingEmail += 1;
      conflicts.push({ quoteId: quote.id, state: "missing_email" });
      continue;
    }
    let customer;
    if (existingQuoteCustomerId) {
      customer = customersById.get(existingQuoteCustomerId);
      if (!customer) {
        summary.missingCustomerMatch += 1;
        conflicts.push({ quoteId: quote.id, state: "missing_bound_customer" });
        continue;
      }
    } else {
      const matches = customersByEmail.get(emailKey) || [];
      if (matches.length === 0) {
        summary.missingCustomerMatch += 1;
        conflicts.push({ quoteId: quote.id, state: "missing_customer_match" });
        continue;
      }
      if (matches.length > 1) {
        summary.duplicateCustomerMatch += 1;
        conflicts.push({
          quoteId: quote.id,
          state: "duplicate_customer_match",
          matchCount: matches.length
        });
        continue;
      }
      [customer] = matches;
    }

    if (customerRecordHasEmailConflict(customer)) {
      summary.customerIdentityConflict += 1;
      conflicts.push({ quoteId: quote.id, state: "customer_email_identity_conflict" });
      continue;
    }
    const resolvedEmailKey = customerRecordEmail(customer) || emailKey;
    const customerName = text(customer.data.name || quote.data.customer?.name, 160);
    const nameKey = normalizeCustomerNameKey(customerName);
    const quoteNeedsBinding = !existingQuoteCustomerId;
    const customerNeedsNormalization = (
      text(customer.data.customerId) !== customer.id
      || normalizeCustomerEmail(customer.data.emailKey) !== resolvedEmailKey
      || normalizeCustomerNameKey(customer.data.nameKey) !== nameKey
    );
    const versionPatches = [];
    let versionConflict = false;
    for (const version of (versionsByQuoteId.get(quote.id) || []).sort((left, right) => (
      left.id.localeCompare(right.id)
    ))) {
      const versionCustomerId = text(version.data.customerId);
      const snapshotCustomerId = text(version.data.snapshot?.customerId);
      if (
        (versionCustomerId && versionCustomerId !== customer.id)
        || (snapshotCustomerId && snapshotCustomerId !== customer.id)
      ) {
        versionConflict = true;
        break;
      }
      if (versionCustomerId !== customer.id || snapshotCustomerId !== customer.id) {
        versionPatches.push({
          versionId: version.id,
          patch: {
            customerId: customer.id,
            ...(version.data.snapshot && typeof version.data.snapshot === "object"
              ? { "snapshot.customerId": customer.id }
              : {})
          }
        });
      }
    }
    if (versionConflict) {
      summary.versionIdentityConflict += 1;
      conflicts.push({ quoteId: quote.id, state: "version_identity_conflict" });
      continue;
    }
    if (!quoteNeedsBinding && !customerNeedsNormalization && versionPatches.length === 0) {
      summary.alreadyBound += 1;
      continue;
    }

    entries.push({
      quoteId: quote.id,
      customerId: customer.id,
      emailKey: resolvedEmailKey,
      quotePatch: quoteNeedsBinding ? { customerId: customer.id } : {},
      customerPatch: {
        customerId: customer.id,
        organizationId: orgId,
        emailKey: resolvedEmailKey,
        nameKey,
        customerIdentityBackfilledAtISO: timestamp
      },
      versionPatches
    });
    if (quoteNeedsBinding) {
      summary.wouldBind += 1;
      summary.wouldBindQuotes += 1;
    }
    summary.wouldBindVersions += versionPatches.length;
    if (customerNeedsNormalization) summary.wouldNormalizeCustomers += 1;
  }

  return { organizationId: orgId, timestamp, entries, conflicts, summary };
}
