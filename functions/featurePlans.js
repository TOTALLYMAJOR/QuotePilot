"use strict";

const FEATURE_FLAG_KEYS = Object.freeze([
  "customerPortal",
  "eventSchedule",
  "integrationsOps",
  "diagnostics",
  "reportingDashboard",
  "quoteCompare",
  "crmSync",
  "guidedSelling",
  "aiAssist",
  "aiAutopilot"
]);

const FEATURE_FLAG_LABELS = Object.freeze({
  customerPortal: "Customer Portal",
  eventSchedule: "Event Schedule",
  integrationsOps: "Integrations Ops",
  diagnostics: "Diagnostics",
  reportingDashboard: "Reporting Dashboard",
  quoteCompare: "Quote Compare",
  crmSync: "CRM Sync",
  guidedSelling: "Guided Selling",
  aiAssist: "AI Assist (Suggestions)",
  aiAutopilot: "AI Autopilot (Auto Apply)"
});

const FEATURE_PLAN_PRESETS = Object.freeze({
  starter: Object.freeze(["customerPortal", "eventSchedule", "guidedSelling", "aiAssist"]),
  growth: Object.freeze([
    "customerPortal",
    "eventSchedule",
    "guidedSelling",
    "quoteCompare",
    "reportingDashboard",
    "aiAssist"
  ]),
  enterprise: Object.freeze([...FEATURE_FLAG_KEYS])
});

module.exports = {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  FEATURE_PLAN_PRESETS
};
