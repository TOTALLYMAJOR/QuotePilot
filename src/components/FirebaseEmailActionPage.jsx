import {
  completeFirebaseEmailVerification,
  FIREBASE_EMAIL_ACTION_PATH,
  parseFirebaseEmailVerificationAction
} from "../lib/firebaseEmailAction";

const title = (state) => state === "receipt"
  ? "Your email is verified"
  : state === "uncertain"
    ? "Verification is uncertain"
    : state === "error"
      ? "This link cannot be used"
      : state === "recovery"
        ? "This link is incomplete"
        : "Verify your email";

export function renderFirebaseEmailActionState(root, state, continueUrl = "/app") {
  const busy = state === "submitting" || state === "reconciliation";
  const receipt = state === "receipt";
  root.innerHTML = `<main class="auth-shell container"><section class="panel auth-card" data-capability-id="firebase-email-verification-handler" data-capability-state="${state}"${busy ? ' aria-busy="true"' : ""}><strong class="auth-product-brand">QuotePilot</strong><h1>${title(state)}</h1><div class="auth-actions">${state === "ready" ? '<button type="button" class="cta">Verify email</button>' : ""}<a class="ghost button-link" href="${receipt ? continueUrl : "/app"}">Return to QuotePilot</a></div></section></main>`;
  return root.querySelector("button");
}

export function mountFirebaseEmailActionPage(root) {
  let action;
  try {
    action = parseFirebaseEmailVerificationAction(window.location.href);
    window.history.replaceState(window.history.state, "", FIREBASE_EMAIL_ACTION_PATH);
  } catch {
    renderFirebaseEmailActionState(root, "recovery");
    return;
  }
  const button = renderFirebaseEmailActionState(root, "ready");
  button.addEventListener("click", async () => {
    renderFirebaseEmailActionState(root, "submitting");
    try {
      await completeFirebaseEmailVerification(action, () => renderFirebaseEmailActionState(root, "reconciliation"));
      renderFirebaseEmailActionState(root, "receipt", action.continueUrl);
    } catch (error) {
      renderFirebaseEmailActionState(root, error.kind === "uncertain" ? "uncertain" : "error");
    }
  }, { once: true });
}
