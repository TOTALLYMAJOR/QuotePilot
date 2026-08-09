import { jsPDF } from "jspdf";
import {
  BEO_ARTIFACT_PROVENANCE_DISCLAIMER,
  createBeoArtifactFingerprint
} from "./beoArtifactFingerprint";
import { buildBeoPayload } from "./beoPayload";

function text(v) {
  return String(v ?? "-");
}

function sectionItemLabel(label, count) {
  return count > 0 ? `${label} (${count} item${count === 1 ? "" : "s"})` : label;
}

function summarizeList(items, limit = 5) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safeItems.length) return "";
  const preview = safeItems.slice(0, limit).join(", ");
  return safeItems.length > limit ? `${preview}...` : preview;
}

function formatStaffCount(role, count) {
  const safeCount = Math.max(0, Number(count || 0));
  return safeCount > 0 ? `${safeCount} ${role}${safeCount === 1 ? "" : "s"}` : "";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || 0);
  if (!bytes.length) return "";
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Export-time-only freshness cue (uses new Date() deliberately - this lives in
// the renderer, not the payload, so buildBeoPayload stays pure/testable).
function formatGeneratedTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// Mirrors proposalExport.js's appendFooterToAllPages shape, kept local (not
// imported - that function closes over proposalExport.js's own doc/palette
// state). Plain black-on-white, no palette theming, per this doc's style.
function appendFooterToAllPages({ doc, beo, left, right, pageHeight }) {
  const pageCount = doc.getNumberOfPages();
  const revSuffix = beo.version.number > 0 ? ` · Rev ${beo.version.number}` : "";
  const discardWarning = beo.version.number > 1 ? " · Discard earlier revisions." : "";
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.line(left, pageHeight - 34, right, pageHeight - 34);
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Quote ${text(beo.quoteNumber)}${revSuffix}${discardWarning}`, left, pageHeight - 22);
    doc.text(`Page ${page} of ${pageCount}`, right, pageHeight - 22, { align: "right" });
  }
}

export async function exportKitchenBeo(quote, { output = "save" } = {}) {
  if (!quote) {
    throw new Error("Missing quote data for kitchen BEO export.");
  }

  const generatedAt = new Date();
  const beo = buildBeoPayload(quote);
  const artifactFingerprint = await createBeoArtifactFingerprint(beo);
  const doc = new jsPDF({
    unit: "pt",
    format: "letter"
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 44;
  const right = pageWidth - 44;
  const maxWidth = right - left;
  const lineGap = 16;
  const contentBottomPadding = 54;
  let y = 56;

  const ensureSpace = (needed = 24) => {
    if (y + needed <= pageHeight - contentBottomPadding) return;
    doc.addPage();
    y = 48;
  };

  const section = (label) => {
    ensureSpace(34);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.line(left, y, right, y);
    y += 14;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label.toUpperCase(), left, y);
    y += 16;
  };

  const row = (label, value) => {
    const safeValue = text(value);
    const wrapped = doc.splitTextToSize(safeValue, maxWidth - 150);
    ensureSpace(lineGap * Math.max(1, wrapped.length) + 4);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${label}:`, left, y);
    doc.setFont("helvetica", "normal");
    doc.text(wrapped, left + 140, y);
    y += lineGap * Math.max(1, wrapped.length);
  };

  const listRow = (label, items) => {
    const safeItems = Array.isArray(items) ? items : [];
    row(sectionItemLabel(label, safeItems.length), safeItems.length ? "" : "-");
    if (!safeItems.length) return;
    const itemPreview = summarizeList(safeItems, 5);
    if (!itemPreview) return;
    const wrapped = doc.splitTextToSize(itemPreview, maxWidth - 140);
    ensureSpace((9 * Math.max(1, wrapped.length)) + 2);
    doc.setTextColor(80, 80, 80);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.text(wrapped, left + 140, y);
    y += (9 * Math.max(1, wrapped.length)) + 2;
  };

  // Plain header: org name, quote number, event name/date. No logo, no color theming -
  // this is an internal kitchen document, not the customer-facing proposal.
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Kitchen Banquet Event Order", left, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    [
      beo.organizationName,
      `Quote #${text(beo.quoteNumber)}`,
      beo.event.name,
      beo.version.number > 0
        ? `Rev ${beo.version.number}${beo.version.createdOn !== "-" ? ` (${beo.version.createdOn})` : ""}`
        : ""
    ].filter(Boolean).join(" · ") || "-",
    left,
    y
  );
  y += 14;
  doc.text(beo.event.date || "-", left, y);
  y += 14;
  doc.setTextColor(80, 80, 80);
  doc.setFontSize(8);
  doc.text(`Generated ${formatGeneratedTimestamp(generatedAt)}`, left, y);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  y += 18;

  // Safety-critical callout - bordered so it can't be missed on a quick scan.
  // No box (and no reserved space) when there's nothing to warn about.
  if (beo.event.dietaryRestrictions) {
    const boxPadding = 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(beo.event.dietaryRestrictions, maxWidth - boxPadding * 2);
    const boxHeight = 22 + (11 * wrapped.length) + boxPadding;
    ensureSpace(boxHeight + 12);
    const boxTop = y;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.rect(left, boxTop, maxWidth, boxHeight);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("DIETARY / ALLERGENS", left + boxPadding, boxTop + 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(wrapped, left + boxPadding, boxTop + 28);
    y = boxTop + boxHeight + 14;
  }

  section("Event & Timing");
  row("Event Name", beo.event.name || "-");
  row("Date", beo.event.date || "-");
  row("Start Time", beo.event.time || "-");
  row("Venue", beo.event.venue || "-");
  row("Venue Address", beo.event.venueAddress || "-");
  row("Guests", beo.event.guests);
  row("Duration (hours)", beo.event.hours);
  row("Service Style", beo.event.style || "-");
  row("Dietary Restrictions", beo.event.dietaryRestrictions || "-");

  section("Staffing");
  const staffCounts = [
    formatStaffCount("server", beo.staffing.servers),
    formatStaffCount("chef", beo.staffing.chefs),
    formatStaffCount("bartender", beo.staffing.bartenders)
  ].filter(Boolean).join(" · ");
  row("Team", staffCounts || "-");
  row("Staff Lead", beo.staffing.staffLead || "Unassigned");

  section("Day-of Contacts");
  row("Client", [beo.contacts.clientName, beo.contacts.clientPhone].filter(Boolean).join(" · ") || "-");
  row("Staff Lead", beo.staffing.staffLead || "Unassigned");
  row("Venue", [beo.event.venue, beo.event.venueAddress].filter(Boolean).join(" · ") || "-");
  if (beo.contacts.businessPhone) {
    row("Office", beo.contacts.businessPhone);
  }

  section("Kitchen Timeline");
  if (beo.checkpoints.length) {
    beo.checkpoints.forEach((checkpoint) => {
      row(checkpoint.label, `${checkpoint.timeLabel} (${checkpoint.id})`);
    });
  } else {
    row("Checkpoints", "Add an event start time to generate kitchen checkpoints.");
  }

  section("Menu & Selections");
  row("Package", beo.selections.packageName || "-");
  listRow("Menu Items", beo.selections.menuItemNames);
  listRow("Add-ons", beo.selections.addons);
  listRow("Rentals", beo.selections.rentals);

  section("Production Checklist");
  beo.productionChecklist.forEach((group) => {
    ensureSpace(18);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(group.group, left, y);
    y += 14;
    group.items.forEach((item) => {
      const mark = item.completed ? "[x]" : "[ ]";
      const detail = item.completed
        ? [item.completedByEmail, item.completedAtISO].filter(Boolean).join(" · ")
        : "";
      row(`${mark} ${item.label}`, detail || "-");
    });
  });

  section("Artifact provenance");
  row("Artifact type", artifactFingerprint.artifactType);
  row("Commercial source revision", beo.version.id);
  if (beo.version.createdAtISO) {
    row("Source revision created", beo.version.createdAtISO);
  }
  row("Graph", `${artifactFingerprint.graphId} · ${artifactFingerprint.graphVersion}`);
  row("Input schema", artifactFingerprint.fingerprintSchemaVersion);
  row("Canonical schema", artifactFingerprint.canonicalSchemaVersion);
  row("Dependency fingerprint", `sha256:${artifactFingerprint.dependencyFingerprint}`);
  row("Proof boundary", BEO_ARTIFACT_PROVENANCE_DISCLAIMER);

  section("Sign-off");
  ensureSpace(50);
  const signOffLineY = y + 24;
  const signOffHalfWidth = (maxWidth - 24) / 2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1);
  doc.line(left, signOffLineY, left + signOffHalfWidth, signOffLineY);
  doc.line(right - signOffHalfWidth, signOffLineY, right, signOffLineY);
  doc.setTextColor(80, 80, 80);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Prepared by / date", left, signOffLineY + 12);
  doc.text("Chef sign-off / date", right - signOffHalfWidth, signOffLineY + 12);
  doc.setTextColor(0, 0, 0);
  y = signOffLineY + 24;

  section("Day-of Notes");
  for (let noteLine = 0; noteLine < 4; noteLine += 1) {
    ensureSpace(22);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.line(left, y, right, y);
    y += 22;
  }

  appendFooterToAllPages({ doc, beo, left, right, pageHeight });

  const filename = [
    text(beo.quoteNumber || "quote"),
    text(beo.event.date || ""),
    beo.version.number > 0 ? `rev${beo.version.number}` : "",
    "kitchen-beo"
  ]
    .filter(Boolean)
    .join("-")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^-+|-+$/g, "");
  const pdfFilename = `${filename || "kitchen-beo"}.pdf`;

  if (output === "base64") {
    const arrayBuffer = doc.output("arraybuffer");
    return {
      filename: pdfFilename,
      mimeType: "application/pdf",
      base64: arrayBufferToBase64(arrayBuffer)
    };
  }

  doc.save(pdfFilename);
  return {
    filename: pdfFilename
  };
}
