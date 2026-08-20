import { httpsCallable } from "firebase/functions";
import { cloudFunctions } from "./firebase";

// Client boundary for the model-assisted intake lane
// (docs/INTENT_INTAKE_ADR.md): staff-only, stateless, and dormant until
// the server flag, provider, and key all exist. A failed-precondition
// reply is the DESIGNED dormant outcome, surfaced distinctly so the UI
// can say "model lane is off" instead of "something broke"; every other
// failure is a retryable availability problem. Facts arrive already
// forced to low confidence server-side — nothing here upgrades them.
export async function parseIntentDraftWithModel({ organizationId, text }) {
  const callable = httpsCallable(cloudFunctions, "parseIntentDraft");
  try {
    const response = await callable({ organizationId, text });
    const payload = response?.data || {};
    return {
      ok: true,
      provider: String(payload.provider || ""),
      model: String(payload.model || ""),
      routing: payload?.routing && typeof payload.routing === "object" ? payload.routing : null,
      facts: Array.isArray(payload.facts) ? payload.facts : [],
      notes: Array.isArray(payload.notes) ? payload.notes : []
    };
  } catch (error) {
    const code = String(error?.code || "").replace(/^functions\//, "");
    if (code === "failed-precondition") {
      return { ok: false, disabled: true, message: String(error?.message || "The model-assisted lane is disabled.") };
    }
    return { ok: false, disabled: false, message: String(error?.message || "The model parser is unreachable.") };
  }
}
