import { httpsCallable } from "firebase/functions";
import { cloudFunctions, firebaseReady } from "./firebase";

const CHANNELS = ["phase", "work", "actuals"];
const CATEGORIES = ["labor", "purchasing", "other"];
const CHECKPOINTS = ["venue_access", "team_briefing", "service_handoff", "pack_down"];
const PHASES = ["prepared", "in_progress", "completed"];
const id = (value) => typeof value === "string" && /^[^\s/?#\\\u0000]{1,256}$/u.test(value) && ![".", ".."].includes(value);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const plain = (value, required = false) => typeof value === "string" && value.length <= 240 && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const cursorValid = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,4096}$/u.test(value);
function fail(message = "Operational history could not be verified.", code = "invalid-server-response") { throw Object.assign(new Error(message), { code }); }
function exact(value, fields) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((field) => !Object.hasOwn(value, field))) fail(); }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function receiptId(value, channel) { return typeof value === "string" && new RegExp(`^${{ phase: "event_ops_command_", work: "event_work_command_", actuals: "event_actuals_command_" }[channel]}[a-f0-9]{48}$`, "u").test(value); }
export function compareEventHistoryRows(left, right) { return right.recordedAtISO.localeCompare(left.recordedAtISO) || CHANNELS.indexOf(left.channel) - CHANNELS.indexOf(right.channel) || right.resultRevision - left.resultRevision; }
function entry(value) {
  exact(value, ["category", "state", "description", "costCents", "durationMinutes", "laborRole"]);
  if (!CATEGORIES.includes(value.category) || !["active", "voided"].includes(value.state) || !plain(value.description, true) || !integer(value.costCents, 1_000_000_000)) fail();
  if (value.category === "labor" ? !["lead", "server", "chef", "bartender", "other"].includes(value.laborRole) || !integer(value.durationMinutes, 10_080) || value.durationMinutes < 1 : value.laborRole !== "" || value.durationMinutes !== null) fail();
}
function issue(value) { exact(value, ["state", "description", "severity"]); if (!["open", "resolved"].includes(value.state) || !["normal", "urgent"].includes(value.severity) || !plain(value.description, true)) fail(); }
function declaration(value) { exact(value, ["state", "note"]); if (!["not_declared", "partial", "complete", "not_applicable"].includes(value.state) || !plain(value.note) || (["complete", "not_applicable"].includes(value.state) && !plain(value.note, true)) || (value.state === "not_declared" && value.note !== "")) fail(); }
function row(value, snapshot) {
  exact(value, ["channel", "receiptId", "requestId", "priorRevision", "resultRevision", "command", "recordedAtISO", "actor", "targetType", "targetId", "before", "after", "note"]);
  if (!CHANNELS.includes(value.channel) || !receiptId(value.receiptId, value.channel) || !id(value.requestId) || !integer(value.priorRevision) || value.resultRevision !== value.priorRevision + 1 || !iso(value.recordedAtISO) || !plain(value.note)) fail();
  exact(value.actor, ["uid", "role"]); if (!id(value.actor.uid) || value.actor.role !== "admin") fail();
  const anchor = snapshot.anchors[value.channel]; if (value.resultRevision > anchor.revision || (value.resultRevision === anchor.revision && value.receiptId !== anchor.receiptId)) fail();
  if (value.channel === "phase") {
    exact(value.before, ["phase"]); exact(value.after, ["phase"]);
    if (value.targetType !== "phase" || value.targetId !== snapshot.ledgerId || value.note !== "" || !PHASES.includes(value.after.phase)) fail();
    if (value.command === "initialize" ? value.before.phase !== null || value.after.phase !== "prepared" || value.priorRevision !== 0 : value.command !== "transition" || !PHASES.slice(0, 2).includes(value.before.phase) || PHASES.indexOf(value.after.phase) !== PHASES.indexOf(value.before.phase) + 1) fail();
  } else if (value.channel === "work") {
    if (value.targetType === "checkpoint") {
      exact(value.before, ["state"]); exact(value.after, ["state"]);
      if (!CHECKPOINTS.includes(value.targetId) || !["not_recorded", "recorded", "reopened"].includes(value.before.state)) fail();
      if (value.command === "checkpoint_record" ? !["not_recorded", "reopened"].includes(value.before.state) || value.after.state !== "recorded" : value.command !== "checkpoint_reopen" || value.before.state !== "recorded" || value.after.state !== "reopened" || !plain(value.note, true)) fail();
    } else if (value.targetType === "issue") {
      if (!/^event_issue_[a-f0-9]{32}$/u.test(value.targetId)) fail(); issue(value.after);
      if (value.command === "issue_open") { if (value.before !== null || value.after.state !== "open" || value.after.description !== value.note || !plain(value.note, true)) fail(); }
      else { issue(value.before); if (!plain(value.note, true) || value.before.description !== value.after.description || value.before.severity !== value.after.severity || (value.command === "issue_resolve" ? value.before.state !== "open" || value.after.state !== "resolved" : value.command !== "issue_reopen" || value.before.state !== "resolved" || value.after.state !== "open")) fail(); }
    } else fail();
  } else if (value.targetType === "actual_entry") {
    if (!/^event_actual_[a-f0-9]{32}$/u.test(value.targetId)) fail(); entry(value.after);
    if (value.command === "record") { if (value.before !== null || value.after.state !== "active" || value.note !== "") fail(); }
    else { entry(value.before); if (!plain(value.note, true) || value.before.state !== "active" || value.before.category !== value.after.category || (value.command === "correct" ? value.after.state !== "active" : value.command !== "void" || value.after.state !== "voided")) fail(); if (value.command === "void" && ["category", "description", "costCents", "durationMinutes", "laborRole"].some((field) => value.before[field] !== value.after[field])) fail(); }
  } else if (value.targetType === "actuals_category") {
    declaration(value.before); declaration(value.after);
    if (value.command !== "declare_category" || !CATEGORIES.includes(value.targetId) || value.after.state === "not_declared" || !plain(value.note, true) || value.note !== value.after.note) fail();
  } else fail();
  return value;
}
function normalize(value, scope) {
  exact(value, ["ok", "storage", "organizationId", "quoteId", "snapshot"]);
  if (value.ok !== true || value.storage !== "firebase" || value.organizationId !== scope.organizationId || value.quoteId !== scope.quoteId) fail();
  const s = value.snapshot; exact(s, ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "ledgerId", "availability", "reasonCode", "rows", "anchors", "pageSize", "nextCursor", "hasMore", "completeForAnchors", "newerAvailable", "historyCoverage", "evidenceBoundary"]);
  if (s.organizationId !== scope.organizationId || s.quoteId !== scope.quoteId || !id(s.sourceVersionId) || !id(s.acceptanceReceiptId) || !/^event_ops_[a-f0-9]{48}$/u.test(s.ledgerId) || s.pageSize !== 20 || s.historyCoverage !== "operational_channels_at_anchors" || typeof s.evidenceBoundary !== "string" || !s.evidenceBoundary || s.evidenceBoundary.length > 2000 || !Array.isArray(s.rows) || s.rows.length > 20 || [s.hasMore, s.completeForAnchors, s.newerAvailable].some((item) => typeof item !== "boolean") || (s.nextCursor !== null && !cursorValid(s.nextCursor)) || s.hasMore !== (s.nextCursor !== null)) fail();
  exact(s.anchors, CHANNELS);
  for (const channel of CHANNELS) { const anchor = s.anchors[channel]; exact(anchor, ["revision", "receiptId"]); if (!integer(anchor.revision) || (anchor.revision === 0 ? anchor.receiptId !== "" : !receiptId(anchor.receiptId, channel))) fail(); }
  if (s.availability === "not_yet_available") { if (s.reasonCode !== "phase_ledger_missing" || s.rows.length || CHANNELS.some((channel) => s.anchors[channel].revision !== 0) || s.hasMore || s.completeForAnchors || s.newerAvailable) fail(); }
  else if (s.availability !== "available" || s.reasonCode !== "" || s.anchors.phase.revision < 1 || s.completeForAnchors === s.hasMore || (s.hasMore && s.rows.length !== 20)) fail();
  s.rows.forEach((item) => row(item, s));
  if (new Set(s.rows.map((item) => item.receiptId)).size !== s.rows.length || s.rows.some((item, index) => index > 0 && compareEventHistoryRows(s.rows[index - 1], item) > 0)) fail();
  return freeze(structuredClone(value));
}
export function mergeEventHistoryPages(previous, next) {
  if (!previous) {
    const merged = { ...next, rows: [...next.rows] }; validateCoverage(merged); return freeze(merged);
  }
  if (!previous.hasMore || ["organizationId", "quoteId", "sourceVersionId", "acceptanceReceiptId", "ledgerId"].some((field) => previous[field] !== next[field]) || JSON.stringify(previous.anchors) !== JSON.stringify(next.anchors)) fail("The Replay source changed. Refresh to start a new history read.", "aborted");
  const rows = [...previous.rows, ...next.rows];
  if (new Set(rows.map((item) => item.receiptId)).size !== rows.length || rows.some((item, index) => index > 0 && compareEventHistoryRows(rows[index - 1], item) > 0)) fail();
  const merged = { ...next, rows, newerAvailable: previous.newerAvailable || next.newerAvailable }; validateCoverage(merged); return freeze(merged);
}
function validateCoverage(snapshot) {
  for (const channel of CHANNELS) {
    const rows = snapshot.rows.filter((item) => item.channel === channel);
    if (rows.some((item, index) => item.resultRevision !== snapshot.anchors[channel].revision - index)) fail("A Replay receipt is missing. Refresh this read.");
    if (snapshot.completeForAnchors && rows.length !== snapshot.anchors[channel].revision) fail("Replay does not cover its verified receipt anchors.");
  }
}
export async function getEventOperatingHistory(input = {}) {
  if (!firebaseReady || !cloudFunctions) fail("Replay requires a connected workspace.", "unavailable");
  if (!id(input.organizationId) || !id(input.quoteId) || Object.keys(input).some((field) => !["organizationId", "quoteId", "cursor"].includes(field)) || (input.cursor !== undefined && !cursorValid(input.cursor))) fail("An exact event and valid history position are required.", "invalid-argument");
  const scope = { organizationId: input.organizationId, quoteId: input.quoteId }; const request = input.cursor === undefined ? scope : { ...scope, cursor: input.cursor };
  try { return normalize((await httpsCallable(cloudFunctions, "getEventOperatingHistory")(request)).data, scope); }
  catch (error) { const code = String(error?.code || "unknown").replace(/^functions\//u, ""); throw Object.assign(new Error(code === "aborted" ? "The accepted source changed. Refresh Replay from the beginning." : ["permission-denied", "unauthenticated", "failed-precondition"].includes(code) ? "Replay requires current authorized access to this accepted event." : "Operational history could not be verified. Refresh to retry this read."), { code }); }
}
