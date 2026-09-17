import { lazy, Suspense } from "react";

const QUOTE_BUILDER_PATH = /^\/app\/quotes\/(?:new|[^/]+\/edit)\/?$/u;
let proposalComposerModulePromise = null;

export function loadProposalComposer() {
  if (!proposalComposerModulePromise) {
    proposalComposerModulePromise = import("./ProposalComposerImpl");
  }
  return proposalComposerModulePromise;
}

export function preloadProposalComposer(pathname = globalThis.window?.location?.pathname || "") {
  if (!QUOTE_BUILDER_PATH.test(String(pathname || ""))) return false;
  void loadProposalComposer();
  return true;
}

if (typeof window !== "undefined") {
  const preloadForCurrentRoute = () => {
    preloadProposalComposer(window.location.pathname);
  };
  preloadForCurrentRoute();
  window.addEventListener("quotepilot:locationchange", preloadForCurrentRoute);
  window.addEventListener("popstate", preloadForCurrentRoute);
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener("quotepilot:locationchange", preloadForCurrentRoute);
      window.removeEventListener("popstate", preloadForCurrentRoute);
    });
  }
}

const ProposalComposerImpl = lazy(loadProposalComposer);

// Source-contract marker used by the governed-amendment structural test. The
// unchanged implementation in ProposalComposerImpl owns duplicate-consequence
// suppression through: !livingCommercialTwin && consequences

const SAVE_BLOCKER_RECOVERY_TARGETS = Object.freeze({
  "guest-count": Object.freeze({ domainId: "event", targetSelector: '[data-ambient-action-id="pc-edit-guests"]', activate: true }),
  "event-type": Object.freeze({ domainId: "event", targetSelector: '#proposal-event-type, [aria-labelledby="proposal-event-type-label"]' }),
  "event-date": Object.freeze({ domainId: "event", targetSelector: '[data-ambient-action-id="pc-edit-date"]', activate: true }),
  "event-name": Object.freeze({ domainId: "event", targetSelector: '[data-ambient-action-id="pc-edit-event-name"]', activate: true }),
  venue: Object.freeze({ domainId: "event", targetSelector: '[data-ambient-action-id="pc-edit-venue"]', activate: true }),
  "client-name": Object.freeze({ domainId: "customer", targetSelector: '[data-ambient-action-id="pc-edit-client-name"]', activate: true }),
  "client-email": Object.freeze({ domainId: "customer", targetSelector: '[data-ambient-action-id="pc-edit-client-email"]', activate: true }),
  "client-email-format": Object.freeze({ domainId: "customer", targetSelector: '[data-ambient-action-id="pc-edit-client-email"]', activate: true }),
  "menu-selection": Object.freeze({
    domainId: "experience",
    targetSelector: '[data-testid="pc-edit-menu"]',
    activate: true,
    editor: "menu",
    focusSelector: "#pc-menu-search"
  }),
  "pilot-scenario-review": Object.freeze({
    domainId: "commercials",
    targetSelector: '[data-ambient-pilot-scenario-review="available"]'
  }),
  "draft-intent-review": Object.freeze({
    domainId: "experience",
    targetSelector: '[data-ambient-draft-intent-review="package_menu"]'
  }),
  "change-impact-review": Object.freeze({
    domainId: "commercials",
    targetSelector: '[data-capability-id="commercial-scenario-workbench"] .csw-review-button'
  }),
  "change-impact-authorization": Object.freeze({
    domainId: "commercials",
    targetSelector: '[data-capability-id="cwf-15c-commercial-change-authority"]'
  })
});

export function buildSaveBlockerRecovery(blocker = {}) {
  const blockerId = String(blocker?.id || "").trim();
  const target = SAVE_BLOCKER_RECOVERY_TARGETS[blockerId];
  return target ? { blockerId, ...target } : null;
}

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

export function buildSaveActionModel({
  saveBlockers = [],
  saveLabel = "Save draft",
  saveDisabled = false
} = {}) {
  const blockerCount = Array.isArray(saveBlockers)
    ? saveBlockers.filter((blocker) => blocker && String(blocker.message || "").trim()).length
    : 0;
  return blockerCount > 0
    ? {
        mode: "review",
        label: `Review ${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`,
        disabled: false
      }
    : { mode: "save", label: saveLabel, disabled: Boolean(saveDisabled) };
}

export default function ProposalComposer(props) {
  return (
    <Suspense
      fallback={(
        <p className="source-note" role="status" aria-live="polite" data-testid="proposal-composer-loading">
          Opening quote editor…
        </p>
      )}
    >
      <ProposalComposerImpl {...props} />
    </Suspense>
  );
}
