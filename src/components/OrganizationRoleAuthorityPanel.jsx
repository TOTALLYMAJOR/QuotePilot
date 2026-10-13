import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getCurrentUserReauthenticationMethods,
  getCurrentUserRecentAuthState,
  reauthenticateCurrentUser
} from "../lib/authClient";
import {
  getOrganizationRoleRoster,
  mutateOrganizationRole
} from "../lib/organizationService";

const ROLE_LABELS = Object.freeze({ admin: "Admin", sales: "Sales", none: "No staff access" });

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `role-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new Error("A secure browser is required to prepare an access change.");
}

function actionLabel(nextRole) {
  if (nextRole === "admin") return "Grant admin access";
  if (nextRole === "sales") return "Grant sales access";
  return "Remove staff access";
}

function consequenceFor(nextRole) {
  if (nextRole === "admin") {
    return "They can manage workspace settings, customers, quotes, and sales-team access. Only the owner can change admin authority.";
  }
  if (nextRole === "sales") {
    return "They can work with customer and opportunity data, but cannot manage admins or provider settings.";
  }
  return "Their authoritative role is removed immediately. Any cached sign-in claims are retired separately and cannot preserve server access.";
}

function isIndeterminateMutationError(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  return ["deadline-exceeded", "internal", "unavailable", "unknown"].includes(code);
}

export default function OrganizationRoleAuthorityPanel() {
  const [roster, setRoster] = useState({
    loading: true,
    error: "",
    roles: [],
    authority: "admin",
    appCheck: "monitoring",
    truncated: false
  });
  const [targetEmail, setTargetEmail] = useState("");
  const [nextRole, setNextRole] = useState("sales");
  const [preview, setPreview] = useState(null);
  const [recentAuth, setRecentAuth] = useState(null);
  const [methods, setMethods] = useState([]);
  const [password, setPassword] = useState("");
  const [state, setState] = useState({
    phase: "ready",
    busy: false,
    error: "",
    receipt: null
  });

  const loadRoster = useCallback(async () => {
    setRoster((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await getOrganizationRoleRoster();
      setRoster({
        loading: false,
        error: "",
        roles: Array.isArray(result.roles) ? result.roles : [],
        authority: result.authority === "owner" ? "owner" : "admin",
        appCheck: result.appCheck === "verified" ? "verified" : "monitoring",
        truncated: result.truncated === true
      });
    } catch {
      setRoster((current) => ({
        ...current,
        loading: false,
        error: "Team access could not reach its trusted service."
      }));
    }
  }, []);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const exactTarget = useMemo(() => {
    const email = normalizeEmail(targetEmail);
    return roster.roles.find((row) => normalizeEmail(row.email) === email) || null;
  }, [roster.roles, targetEmail]);
  const currentRole = exactTarget?.role || "none";
  const availableOutcomes = roster.authority === "owner"
    ? ["admin", "sales", "none"]
    : ["sales", "none"];
  const targetEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(targetEmail));
  const protectedRosterRowsVisible = roster.roles.some((row) => (
    row.owner || (row.role === "admin" && roster.authority !== "owner")
  ));
  const prepareBlocker = roster.loading
    ? "The trusted team roster is still loading."
    : roster.error
      ? "Refresh the trusted team roster before preparing an access change."
      : !targetEmailValid
        ? "Enter one complete verified email address to review an access change."
        : exactTarget?.owner && nextRole !== "admin"
          ? "The organization owner is protected and cannot be changed through this surface."
          : roster.authority !== "owner" && currentRole === "admin"
            ? "Only the organization owner can change an administrator's access."
            : currentRole === nextRole
              ? `${ROLE_LABELS[currentRole]} is already the authoritative role for this person.`
              : !availableOutcomes.includes(nextRole)
                ? "This role outcome is unavailable with your current authority."
                : "";
  const canPrepare = !prepareBlocker
    && availableOutcomes.includes(nextRole)
    && currentRole !== nextRole;

  const prepare = async () => {
    setState({ phase: "ready", busy: false, error: "", receipt: null });
    try {
      const prepared = {
        requestId: createRequestId(),
        targetEmail: normalizeEmail(targetEmail),
        expectedCurrentRole: currentRole,
        nextRole
      };
      setPreview(prepared);
      const [authState, supportedMethods] = await Promise.all([
        getCurrentUserRecentAuthState(),
        Promise.resolve(getCurrentUserReauthenticationMethods())
      ]);
      setRecentAuth(authState);
      setMethods(supportedMethods);
    } catch (error) {
      setPreview(null);
      setState({
        phase: "error",
        busy: false,
        error: error?.message || "This change could not be prepared.",
        receipt: null
      });
    }
  };

  const confirmIdentity = async (method) => {
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await reauthenticateCurrentUser({ method, password });
      setRecentAuth(result);
      setPassword("");
      setState((current) => ({ ...current, busy: false, error: "" }));
    } catch (error) {
      setState({
        phase: "error",
        busy: false,
        error: error?.message || "Identity confirmation failed.",
        receipt: null
      });
    }
  };

  const apply = async ({ reconcile = false } = {}) => {
    if (!preview || recentAuth?.recent !== true) return;
    setState({
      phase: reconcile ? "reconciliation" : "submitting",
      busy: true,
      error: "",
      receipt: null
    });
    try {
      const result = await mutateOrganizationRole(preview);
      setState({ phase: "receipt", busy: false, error: "", receipt: result });
      setPreview(null);
      setRecentAuth(null);
      setTargetEmail("");
      await loadRoster();
    } catch (error) {
      const uncertain = isIndeterminateMutationError(error);
      setState({
        phase: uncertain ? "uncertain" : "error",
        busy: false,
        error: uncertain
          ? "QuotePilot could not confirm whether the exact access change finished. The request is preserved so it can be checked safely."
          : error?.message || "Access could not be changed.",
        receipt: null
      });
    }
  };

  return (
    <section
      className="admin-section role-authority-panel"
      data-capability="organization-role-authority"
      data-capability-state={state.phase}
    >
      <div className="admin-section-head">
        <div>
          <p className="eyebrow">Team access</p>
          <h3>Keep the right people close to the work</h3>
          <p className="source-note">
            Access follows the signed-in organization. {roster.authority === "owner"
              ? "You can shape admin and sales access."
              : "You can shape sales access; the owner keeps admin authority."}
          </p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => void loadRoster()}
          disabled={roster.loading}
          aria-describedby={roster.loading ? "role-authority-roster-loading" : undefined}
        >
          {roster.loading ? "Checking…" : "Refresh team"}
        </button>
      </div>

      {roster.loading && (
        <p id="role-authority-roster-loading" className="source-note" role="status">
          Checking the trusted team roster before another action can begin.
        </p>
      )}
      {roster.error && <p className="error-note">{roster.error} Refresh this exact team view to recover.</p>}
      {!roster.error && !roster.loading && roster.roles.length === 0 && (
        <p className="source-note">No staff roles are visible yet. Add the first verified team member below.</p>
      )}
      {roster.roles.length > 0 && (
        <div className="role-authority-roster" aria-label="Current team access">
          {roster.roles.map((row) => {
            const protectedRow = row.owner || (row.role === "admin" && roster.authority !== "owner");
            return (
              <button
                type="button"
                className="role-authority-person"
                key={row.uid}
                onClick={() => {
                  setTargetEmail(row.email);
                  setNextRole(
                    roster.authority === "owner"
                      ? (row.role === "admin" ? "sales" : "admin")
                      : "none"
                  );
                  setPreview(null);
                  setState({ phase: "ready", busy: false, error: "", receipt: null });
                }}
                disabled={protectedRow}
                aria-describedby={protectedRow ? "role-authority-protected-person" : undefined}
              >
                <span><strong>{row.email}</strong><small>{row.owner ? "Owner" : ROLE_LABELS[row.role]}</small></span>
                <span aria-hidden="true">→</span>
              </button>
            );
          })}
        </div>
      )}
      {protectedRosterRowsVisible && (
        <p id="role-authority-protected-person" className="source-note">
          Protected access stays visible here, but only the organization owner can change an administrator; the owner record cannot be changed on this surface.
        </p>
      )}
      {roster.truncated && <p className="warning-note">Only the first 200 role records are shown. Narrow this change by exact email.</p>}

      <div className="role-authority-compose">
        <label>
          <span>Who needs a change?</span>
          <input
            type="email"
            value={targetEmail}
            placeholder="verified.person@example.com"
            onChange={(event) => {
              setTargetEmail(event.target.value);
              setPreview(null);
              setState({ phase: "ready", busy: false, error: "", receipt: null });
            }}
          />
        </label>
        <div>
          <span className="role-authority-label">Outcome</span>
          <div className="role-authority-outcomes">
            {availableOutcomes.map((role) => {
              const outcomeUnavailable = currentRole === role || (exactTarget?.owner && role !== "admin");
              return (
                <button
                  key={role}
                  type="button"
                  className={nextRole === role ? "active" : "ghost"}
                  onClick={() => {
                    setNextRole(role);
                    setPreview(null);
                    setState({ phase: "ready", busy: false, error: "", receipt: null });
                  }}
                  disabled={outcomeUnavailable}
                  aria-describedby={outcomeUnavailable ? "role-authority-outcome-blocker" : undefined}
                >
                  {role === "none" ? "Remove" : ROLE_LABELS[role]}
                </button>
              );
            })}
          </div>
          <p id="role-authority-outcome-blocker" className="source-note">
            {exactTarget?.owner
              ? "The owner role is protected on this surface."
              : `${ROLE_LABELS[currentRole]} is the current role, so choosing it again would make no change.`}
          </p>
        </div>
        <div className="role-authority-inference" aria-live="polite">
          <span>Current</span>
          <strong>{ROLE_LABELS[currentRole]}</strong>
          <small>{exactTarget ? "From the authoritative team roster" : "No same-organization role found for this email"}</small>
        </div>
      </div>

      {!preview && (
        <>
          <div className="right-actions">
            <button
              type="button"
              className="cta"
              disabled={!canPrepare}
              aria-describedby={!canPrepare ? "role-authority-prepare-blocker" : undefined}
              onClick={() => void prepare()}
            >
              Review this access change
            </button>
          </div>
          {!canPrepare && (
            <p id="role-authority-prepare-blocker" className="source-note" role="status">
              {prepareBlocker}
            </p>
          )}
        </>
      )}

      {preview && (
        <div className="role-authority-preview" aria-live="polite">
          <p className="eyebrow">Before anything changes</p>
          <h4>{actionLabel(preview.nextRole)} for {preview.targetEmail}</h4>
          <dl>
            <div><dt>Why this is available</dt><dd>{roster.authority === "owner" ? "Canonical owner authority" : "Same-organization admin authority for sales access"}</dd></div>
            <div><dt>Consequence</dt><dd>{consequenceFor(preview.nextRole)}</dd></div>
            <div><dt>If you do nothing</dt><dd>{ROLE_LABELS[preview.expectedCurrentRole]} remains unchanged.</dd></div>
            <div><dt>Confidence and source</dt><dd>Exact verified email + authoritative role record; no inferred identity match.</dd></div>
          </dl>

          {recentAuth?.recent !== true && (
            <div className="role-authority-reauth">
              <p><strong>Confirm it’s you</strong><br /><span id="role-authority-reauth-requirement" className="source-note">Sensitive access changes need a sign-in from the last five minutes.</span></p>
              {methods.includes("password") && (
                <label>
                  <span>Password</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                </label>
              )}
              {methods.includes("password") && !password && !state.busy && (
                <p id="role-authority-password-required" className="source-note">
                  Enter your current password to use password confirmation.
                </p>
              )}
              <div className="right-actions">
                {methods.includes("password") && (
                  <button
                    type="button"
                    disabled={state.busy || !password}
                    aria-describedby={state.busy ? "role-authority-mutation-busy" : !password ? "role-authority-password-required" : undefined}
                    onClick={() => void confirmIdentity("password")}
                  >
                    Confirm with password
                  </button>
                )}
                {methods.includes("google") && (
                  <button
                    type="button"
                    disabled={state.busy}
                    aria-describedby={state.busy ? "role-authority-mutation-busy" : undefined}
                    onClick={() => void confirmIdentity("google")}
                  >
                    Confirm with Google
                  </button>
                )}
              </div>
              {methods.length === 0 && <p className="error-note">This sign-in provider cannot confirm sensitive changes. Sign out and return with password or Google.</p>}
            </div>
          )}

          <div className="right-actions">
            <button
              type="button"
              className="ghost"
              disabled={state.busy}
              aria-describedby={state.busy ? "role-authority-mutation-busy" : undefined}
              onClick={() => {
                setPreview(null);
                setState({ phase: "ready", busy: false, error: "", receipt: null });
              }}
            >
              Keep current access
            </button>
            {!['uncertain', 'error'].includes(state.phase) && (
              <button
                type="button"
                className="cta"
                disabled={state.busy || recentAuth?.recent !== true}
                aria-describedby={state.busy
                  ? "role-authority-mutation-busy"
                  : recentAuth?.recent !== true ? "role-authority-reauth-requirement" : undefined}
                onClick={() => void apply()}
              >
                {state.phase === "reconciliation"
                  ? "Checking exact change…"
                  : state.busy ? "Applying access…" : actionLabel(preview.nextRole)}
              </button>
            )}
          </div>
        </div>
      )}

      {state.busy && (
        <p id="role-authority-mutation-busy" className="source-note" role="status">
          {state.phase === "reconciliation"
            ? "Checking the exact prior access request before another action is available."
            : "This exact access action is in progress. Wait for its confirmed outcome before choosing another action."}
        </p>
      )}
      {state.error && (
        <div className="role-authority-recovery" role="alert">
          <p className={state.phase === "uncertain" ? "warning-note" : "error-note"}>{state.error}</p>
          <div className="right-actions">
            {state.phase === "uncertain" && preview && recentAuth?.recent === true && (
              <button
                type="button"
                disabled={state.busy}
                aria-describedby={state.busy ? "role-authority-mutation-busy" : undefined}
                onClick={() => void apply({ reconcile: true })}
              >
                Check exact change
              </button>
            )}
            {state.phase === "error" && (
              <button
                type="button"
                className="ghost"
                onClick={() => setState((current) => ({ ...current, phase: "recovery", error: "" }))}
              >
                Return to this review
              </button>
            )}
          </div>
        </div>
      )}
      {state.phase === "recovery" && (
        <p className="source-note" role="status">Nothing was discarded. Review the same person and outcome, then continue when ready.</p>
      )}
      {state.receipt && (
        <p className={state.receipt.claimsSync?.succeeded ? "success-note" : "warning-note"} role="status">
          {state.receipt.claimsSync?.succeeded
            ? `${ROLE_LABELS[state.receipt.nextRole]} is now authoritative for ${state.receipt.targetEmail}.`
            : state.receipt.claimsSync?.message}
        </p>
      )}
      <p className="source-note role-authority-boundary">
        App verification: {roster.appCheck === "verified" ? "verified" : "monitoring before enforcement"}. Browser role writes remain blocked.
      </p>
    </section>
  );
}
