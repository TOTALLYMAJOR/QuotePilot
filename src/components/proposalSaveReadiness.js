export function buildDraftSaveBlockers({
  form = {},
  totals = {},
  catalogLoading = false,
  selectedMenuItemCount = 0,
  quoteEditUnavailable = false,
  pilotScenarioReviewPending = false,
  draftIntentReviewPending = false,
  changeImpactReviewRequired = false,
  changeImpactAuthorizationRequired = false
} = {}) {
  const blockers = [];
  const add = (id, message) => blockers.push({ id, message });
  const email = String(form.email || "").trim();

  if (catalogLoading) {
    add("catalog-loading", "Wait for the current catalog to finish loading.");
  }
  if (quoteEditUnavailable) {
    add("quote-edit-loading", "Reload the saved quote before editing or saving it.");
  }
  if (pilotScenarioReviewPending) {
    add("pilot-scenario-review", "Resolve the pending Pilot scenario review.");
  }
  if (draftIntentReviewPending) {
    add("draft-intent-review", "Resolve the pending Package or Menu review.");
  }
  if (changeImpactReviewRequired) {
    add("change-impact-review", "Build and review a current Change Impact simulation.");
  } else if (changeImpactAuthorizationRequired) {
    add("change-impact-authorization", "Authorize and apply governed dependencies from Change Impact.");
  }
  if (Math.max(0, Number(totals.guests) || 0) <= 0) {
    add("guest-count", "Set a guest count above zero.");
  }
  if (!String(form.name || "").trim()) {
    add("client-name", "Add the client name.");
  }
  if (!email) {
    add("client-email", "Add the client email.");
  } else if (!/^\S+@\S+\.\S+$/.test(email)) {
    add("client-email-format", "Correct the client email format.");
  }
  if (!String(form.eventTypeId || "").trim()) {
    add("event-type", "Choose an event type.");
  }
  if (!String(form.date || "").trim()) {
    add("event-date", "Add the event date.");
  }
  if (!String(form.eventName || "").trim()) {
    add("event-name", "Add the event name.");
  }
  if (!String(form.venue || "").trim()) {
    add("venue", "Add the venue.");
  }
  if (Math.max(0, Number(selectedMenuItemCount) || 0) < 1) {
    add("menu-selection", "Select at least one menu item.");
  }

  return blockers;
}
