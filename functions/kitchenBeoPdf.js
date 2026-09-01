"use strict";

const PAGE = Object.freeze({ width: 612, height: 792, margin: 44 });
const BODY_WIDTH = PAGE.width - (PAGE.margin * 2);

function text(value, fallback = "-") {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) && value.length
    ? value.map((item) => text(item)).join(", ")
    : "-";
}

function filenamePart(value, fallback) {
  const normalized = text(value, fallback)
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return normalized || fallback;
}

function buildKitchenBeoPdfFilename(payload = {}) {
  const quote = filenamePart(payload.quoteNumber, "quote");
  const eventDate = filenamePart(payload.event?.date, "event");
  const revision = Number(payload.version?.number) > 0
    ? `rev${Math.trunc(Number(payload.version.number))}`
    : "source";
  return `${quote}-${eventDate}-${revision}-kitchen-beo.pdf`;
}

function renderKitchenBeoPdf({ payload, provenance } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Canonical Kitchen BEO payload is required.");
  }
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    throw new TypeError("Server Kitchen BEO provenance is required.");
  }

  // Keep the native/encoding-heavy renderer out of Firebase manifest discovery.
  // Cloud Functions loads it only when an authorized request renders a BEO.
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  let y = PAGE.margin;

  const ensureSpace = (height = 28) => {
    if (y + height <= PAGE.height - 56) return;
    doc.addPage();
    y = PAGE.margin;
  };
  const rule = () => {
    ensureSpace(12);
    doc.setDrawColor(205, 210, 218);
    doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
    y += 14;
  };
  const heading = (label) => {
    ensureSpace(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(29, 41, 57);
    doc.text(text(label), PAGE.margin, y);
    y += 17;
  };
  const row = (label, value) => {
    const lines = doc.splitTextToSize(text(value), BODY_WIDTH - 132);
    ensureSpace(Math.max(24, (lines.length * 12) + 8));
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(77, 87, 101);
    doc.text(text(label), PAGE.margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(24, 32, 45);
    doc.text(lines, PAGE.margin + 132, y);
    y += Math.max(22, lines.length * 12 + 5);
  };

  doc.setFillColor(21, 31, 46);
  doc.rect(0, 0, PAGE.width, 118, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("KITCHEN BEO", PAGE.margin, 52);
  doc.setFontSize(12);
  doc.text(text(payload.organizationName, "QuotePilot workspace"), PAGE.margin, 76);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Quote ${text(payload.quoteNumber)} · Source ${text(payload.version?.id, "unversioned")}`,
    PAGE.margin,
    97
  );
  y = 146;

  heading("Event brief");
  row("Event", payload.event?.name);
  row("Date / time", `${text(payload.event?.date)} · ${text(payload.event?.time)}`);
  row("Venue", [payload.event?.venue, payload.event?.venueAddress].map((item) => text(item, "")).filter(Boolean).join(" · "));
  row("Guests", payload.event?.guests);
  row("Duration / style", `${text(payload.event?.hours)} hours · ${text(payload.event?.style)}`);
  row("Dietary constraints", payload.event?.dietaryRestrictions);
  rule();

  heading("Contacts and staffing");
  row("Customer", `${text(payload.contacts?.clientName)} · ${text(payload.contacts?.clientPhone)}`);
  row("Staff lead", payload.staffing?.staffLead || "Unassigned");
  row(
    "Staffing",
    `${Number(payload.staffing?.servers) || 0} servers · ${Number(payload.staffing?.chefs) || 0} chefs · ${Number(payload.staffing?.bartenders) || 0} bartenders`
  );
  rule();

  heading("Menu, additions, and rentals");
  row("Package", payload.selections?.packageName);
  row("Menu", list(payload.selections?.menuItemNames));
  row("Add-ons", list(payload.selections?.addons));
  row("Rentals", list(payload.selections?.rentals));
  rule();

  heading("Kitchen checkpoints");
  const checkpoints = Array.isArray(payload.checkpoints) ? payload.checkpoints : [];
  if (!checkpoints.length) row("Schedule", "Add an event start time to establish checkpoints.");
  checkpoints.forEach((checkpoint) => row(checkpoint.label || checkpoint.id, checkpoint.time || checkpoint.timeInput));
  rule();

  heading("Production checklist");
  const checklistGroups = Array.isArray(payload.productionChecklist)
    ? payload.productionChecklist
    : [];
  checklistGroups.forEach((group) => {
    const items = Array.isArray(group.items) ? group.items : [];
    row(
      group.group,
      items.map((item) => `${item.completed === true ? "[x]" : "[ ]"} ${text(item.label)}`).join("\n")
    );
  });
  rule();

  heading("Authoritative generation evidence");
  row("Commercial source", provenance.commercialSourceRevisionId);
  row("Dependency fingerprint", provenance.dependencyFingerprint);
  row("Graph", `${text(provenance.graphId)} · ${text(provenance.graphVersion)}`);
  row("Request", provenance.requestId);
  row("Generated", provenance.generatedAtISO);
  row("Proof boundary", "This server receipt proves generation from the named canonical source and declared dependency fingerprint. It does not prove kitchen review, operational completion, customer delivery, payment, or revenue.");

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 108, 120);
    doc.text(`Internal operations · Page ${page} of ${pageCount}`, PAGE.margin, PAGE.height - 28);
    doc.text(text(provenance.dependencyFingerprint, "").slice(0, 20), PAGE.width - PAGE.margin, PAGE.height - 28, { align: "right" });
  }

  return {
    bytes: Buffer.from(doc.output("arraybuffer")),
    filename: buildKitchenBeoPdfFilename(payload),
    mimeType: "application/pdf"
  };
}

module.exports = {
  buildKitchenBeoPdfFilename,
  renderKitchenBeoPdf
};
