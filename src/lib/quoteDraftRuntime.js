import {
  normalizeAmbientDraftIntent,
  normalizeAmbientQuoteDraftPatch
} from "./ambientQuoteDraftPatch";
import {
  hydrateSavedQuoteDraftBase,
  immutableQuoteDraftValue,
  resolveQuoteDraftRevisionId
} from "./quoteDraftRuntimeBase";

export {
  AMBIENT_DRAFT_FIELD_BOUNDS,
  AMBIENT_DRAFT_PATCH_SOURCES,
  AMBIENT_EVENT_LOGISTICS_DRAFT_INTENTS,
  AMBIENT_PACKAGE_MENU_DRAFT_INTENTS,
  normalizeAmbientDraftIntent,
  normalizeAmbientEventLogisticsDraftIntent,
  normalizeAmbientPackageMenuDraftIntent,
  normalizeAmbientQuoteDraftPatch
} from "./ambientQuoteDraftPatch";

export {
  hydrateSavedQuoteDraftBase,
  resolveQuoteDraftRevisionId
} from "./quoteDraftRuntimeBase";

export function hydrateSavedQuoteDraft(input = {}) {
  if (input.ambientEnabled && input.draftPatch && input.draftIntent) {
    return immutableQuoteDraftValue({
      ok: false,
      code: "ambient_draft_handoff_ambiguous",
      reason: "The Ambient handoff contains both a value patch and an event-logistics focus intent.",
      consequence: "The priced editor was not opened and the saved quote remains unchanged.",
      nextResolution: "Return to the opportunity and choose one exact object outcome before opening the editor."
    });
  }
  const normalizedPatch = normalizeAmbientQuoteDraftPatch({
    quote: input.quote,
    draftPatch: input.draftPatch,
    enabled: input.ambientEnabled
  });
  const normalizedDraftIntent = normalizeAmbientDraftIntent({
    quote: input.quote,
    draftIntent: input.draftIntent,
    catalogContext: input.ambientCatalogContext,
    enabled: input.ambientEnabled
  });
  return hydrateSavedQuoteDraftBase({ ...input, normalizedPatch, normalizedDraftIntent });
}
