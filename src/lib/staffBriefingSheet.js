import { jsPDF } from "jspdf";
import { buildDefaultEmailAppHandoff } from "./defaultEmailApp";

function text(value, fallback = "") {
  return String(value ?? "").trim() || fallback;
}

function dateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function roleLabel(role) {
  return ({ lead: "Event lead", server: "Server", chef: "Chef", bartender: "Bartender" })[role] || "Event team";
}

function roleSpecificLines(assignment) {
  const event = assignment?.event || {};
  const selection = assignment?.selection || {};
  const lines = [];
  if (assignment?.role === "lead") {
    lines.push(["Coverage", text(assignment?.coverage?.state, "Review the current staffing plan")]);
  }
  if (["server", "lead"].includes(assignment?.role)) {
    lines.push(["Service style", text(event.style, "Confirm with the event lead")]);
  }
  if (["chef", "lead"].includes(assignment?.role)) {
    lines.push(["Package", text(selection.packageName, "Confirm with the event lead")]);
    lines.push(["Menu", Array.isArray(selection.menuItemNames) && selection.menuItemNames.length
      ? selection.menuItemNames.join(", ")
      : "Confirm with the event lead"]);
    lines.push(["Dietary notes", text(event.dietaryRestrictions, "None recorded")]);
  }
  if (["bartender", "lead"].includes(assignment?.role)) {
    lines.push(["Bar service window", `${dateTime(assignment?.eventWindow?.startAtISO)}–${dateTime(assignment?.eventWindow?.endAtISO)}`]);
  }
  return lines;
}

export function buildStaffBriefing({ entry, assignment, organizationName = "" } = {}) {
  if (!entry?.profile || !entry?.record || !assignment) {
    throw new Error("Choose an assigned staff member and event before creating a briefing sheet.");
  }
  const profile = entry.profile;
  const record = entry.record;
  const event = assignment.event || {};
  const defaults = record.assignmentDefaults || {};
  const briefing = record.briefingDefaults || {};
  return Object.freeze({
    staffId: profile.staffId,
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.planRevision,
    quoteId: assignment.quoteId,
    quoteRevisionId: assignment.quoteRevisionId,
    organizationName: text(organizationName, "Catering team"),
    recipientName: text(record.preferredName || profile.displayName, profile.displayName),
    recipientEmail: text(record.contact?.email),
    role: assignment.role,
    roleLabel: roleLabel(assignment.role),
    eventName: text(event.name, "Event"),
    eventDate: text(event.date),
    venue: text(event.venue, "Venue to be confirmed"),
    venueAddress: text(event.venueAddress),
    guestCount: Math.max(0, Number(event.guests || 0)),
    callTime: dateTime(assignment.eventWindow?.startAtISO),
    shiftEnd: dateTime(assignment.eventWindow?.endAtISO),
    department: text(defaults.department),
    station: text(defaults.station),
    reportingLocation: text(defaults.reportingLocation),
    arrivalInstructions: text(defaults.arrivalInstructions),
    uniform: text(briefing.uniform),
    parking: text(briefing.parking),
    entrance: text(briefing.entrance),
    mealPolicy: text(briefing.mealPolicy),
    responsibilities: text(briefing.responsibilities),
    roleSpecific: Object.freeze(roleSpecificLines(assignment)),
    boundary: "This briefing reflects the named staffing-plan and quote revisions. Opening an email app does not prove sending, delivery, acknowledgement, attendance, or payroll readiness."
  });
}

function briefingRows(briefing) {
  return [
    ["Event", briefing.eventName],
    ["Your role", briefing.roleLabel],
    ["Event date", briefing.eventDate || "Not recorded"],
    ["Call time", briefing.callTime],
    ["Expected finish", briefing.shiftEnd],
    ["Venue", [briefing.venue, briefing.venueAddress].filter(Boolean).join(" — ")],
    ["Guests", briefing.guestCount || "Not recorded"],
    ["Department", briefing.department || "Confirm with the event lead"],
    ["Station", briefing.station || "Confirm with the event lead"],
    ["Report to", briefing.reportingLocation || "Confirm with the event lead"],
    ["Arrival", briefing.arrivalInstructions || "No additional instructions recorded"],
    ["Uniform", briefing.uniform || "Confirm with the event lead"],
    ["Parking", briefing.parking || "Confirm with the event lead"],
    ["Entrance", briefing.entrance || "Confirm with the event lead"],
    ["Meal policy", briefing.mealPolicy || "Confirm with the event lead"],
    ["Responsibilities", briefing.responsibilities || "Follow the event lead's briefing"],
    ...briefing.roleSpecific
  ];
}

function drawStaffBriefing(briefing) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const left = 46;
  const width = doc.internal.pageSize.getWidth() - 92;
  let y = 54;
  const ensure = (height = 30) => {
    if (y + height < 730) return;
    doc.addPage();
    y = 54;
  };
  doc.setFillColor(249, 246, 238);
  doc.roundedRect(left, y, width, 86, 12, 12, "F");
  doc.setTextColor(44, 38, 28);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Event briefing", left + 18, y + 30);
  doc.setFontSize(12);
  doc.text(`${briefing.recipientName} · ${briefing.roleLabel}`, left + 18, y + 54);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(105, 91, 67);
  doc.text(`${briefing.organizationName} · Plan ${briefing.assignmentRevision}`, left + 18, y + 72);
  y += 116;
  briefingRows(briefing).forEach(([label, value]) => {
    const lines = doc.splitTextToSize(text(value, "—"), width - 148);
    ensure(Math.max(28, lines.length * 15 + 10));
    doc.setTextColor(118, 97, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(label.toUpperCase(), left, y);
    doc.setTextColor(42, 37, 29);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(lines, left + 122, y);
    y += Math.max(28, lines.length * 15 + 8);
    doc.setDrawColor(231, 224, 210);
    doc.line(left, y - 9, left + width, y - 9);
  });
  ensure(60);
  doc.setFillColor(244, 240, 250);
  const boundaryLines = doc.splitTextToSize(briefing.boundary, width - 24);
  doc.roundedRect(left, y, width, boundaryLines.length * 13 + 24, 8, 8, "F");
  doc.setTextColor(82, 68, 103);
  doc.setFontSize(8.5);
  doc.text(boundaryLines, left + 12, y + 17);
  return doc;
}

function filename(briefing) {
  const base = `${briefing.eventDate || "event"}-${briefing.recipientName}-briefing`
    .replace(/[^\w.-]+/gu, "_")
    .replace(/_+/gu, "_");
  return `${base || "staff-briefing"}.pdf`;
}

export function exportStaffBriefingSheet(briefing, { output = "save", openWindow = globalThis.open } = {}) {
  const doc = drawStaffBriefing(briefing);
  const pdfFilename = filename(briefing);
  if (output === "blob") return { blob: doc.output("blob"), filename: pdfFilename };
  if (output === "print") {
    const blob = doc.output("blob");
    const objectUrl = URL.createObjectURL(blob);
    const popup = typeof openWindow === "function" ? openWindow(objectUrl, "_blank") : null;
    if (!popup) {
      URL.revokeObjectURL(objectUrl);
      throw new Error("The print preview was blocked. Allow pop-ups, then try again.");
    }
    try {
      popup.opener = null;
    } catch {
      // Some browsers expose opener as read-only; the isolated blob URL still
      // contains no app authority and is revoked below.
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return { filename: pdfFilename, printPreviewOpened: true };
  }
  doc.save(pdfFilename);
  return { filename: pdfFilename };
}

export function buildStaffBriefingEmail(briefing) {
  if (!briefing.recipientEmail) {
    throw new Error("Add an email address to this staff record before opening the default email app.");
  }
  if (briefing.boundary && briefing.recipientEmail) {
    const subject = `${briefing.eventName} — ${briefing.roleLabel} briefing`;
    const body = [
      `Hi ${briefing.recipientName},`,
      "",
      `Here are your current details for ${briefing.eventName}:`,
      `Role: ${briefing.roleLabel}`,
      `Call time: ${briefing.callTime}`,
      `Expected finish: ${briefing.shiftEnd}`,
      `Venue: ${[briefing.venue, briefing.venueAddress].filter(Boolean).join(" — ")}`,
      briefing.reportingLocation ? `Report to: ${briefing.reportingLocation}` : "",
      briefing.uniform ? `Uniform: ${briefing.uniform}` : "",
      briefing.parking ? `Parking: ${briefing.parking}` : "",
      briefing.arrivalInstructions ? `Arrival notes: ${briefing.arrivalInstructions}` : "",
      briefing.responsibilities ? `Responsibilities: ${briefing.responsibilities}` : "",
      "",
      "Please reply to confirm that you received these details or tell us what needs attention.",
      "",
      briefing.organizationName
    ].filter((line) => line !== "").join("\n");
    return buildDefaultEmailAppHandoff({
      to: briefing.recipientEmail,
      subject,
      body
    });
  }
  throw new Error("The staff briefing is incomplete.");
}
