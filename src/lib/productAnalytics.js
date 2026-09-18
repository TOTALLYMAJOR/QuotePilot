// Compatibility facade. Production entry points should import the always-on
// legacy API from productAnalyticsCore and load productAnalyticsAmbient only
// inside the default-off Ambient build.
export {
  PRODUCT_ANALYTICS_STORAGE_KEYS,
  beginWizardAnalyticsSession,
  flushProductAnalyticsEvents,
  getProductAnalyticsSummary,
  recordProductAnalyticsEvent
} from "./productAnalyticsCore";

export {
  PRODUCT_ANALYTICS_DEAD_CLICK_DEADLINE_MS,
  PRODUCT_ANALYTICS_ISSUE_CATEGORIES,
  PRODUCT_ANALYTICS_MAX_ACKNOWLEDGEMENT_MS,
  PRODUCT_ANALYTICS_MAX_DURATION_MS,
  recordProductAnalyticsAmbientAssessment,
  recordProductAnalyticsFirstIntent,
  recordProductAnalyticsIssueResolved,
  recordProductAnalyticsIssueSurfaced,
  recordProductAnalyticsPricedDraftReceipt,
  recordQuoteCompletionActionResolved,
  recordQuoteCompletionActionShown,
  recordQuoteCompletionSendableReached,
  resetProductAnalyticsIssueObservationState
} from "./productAnalyticsAmbient";
