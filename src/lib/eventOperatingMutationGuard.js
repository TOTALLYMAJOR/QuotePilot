// Memory-only event command ownership. Unresolved commands are never evicted.
const records = new Map();
const listeners = new Map();
const ownerSet = new Set(["phase", "work", "actuals", "workflow"]);
const key = ({ principalId, organizationId, quoteId }) => JSON.stringify([principalId, organizationId, quoteId]);
function publish(scopeKey) { for (const listener of listeners.get(scopeKey) || []) listener(); }
function deny(message) { throw Object.assign(new Error(message), { code: "event-mutation-blocked" }); }
export function readEventOperatingMutationGuard(scope) { return records.get(key(scope))?.view || null; }
export function subscribeEventOperatingMutations(scope, listener) {
  const scopeKey = key(scope);
  const set = listeners.get(scopeKey) || new Set(); set.add(listener); listeners.set(scopeKey, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(scopeKey); };
}
export function beginEventOperatingMutation(scope, owner, command) {
  if (!ownerSet.has(owner) || !scope.principalId || !scope.organizationId || !scope.quoteId || !command?.requestId) deny("An exact signed-in event command is required.");
  const scopeKey = key(scope), current = records.get(scopeKey), payload = JSON.stringify(command);
  if (current) {
    if (current.view.owner !== owner || current.payload !== payload) deny("Check the existing event request before starting another phase, checkpoint, issue, actuals, or coordination change.");
    if (["submitting", "reconciliation"].includes(current.view.status)) deny("The original event request is still running.");
    current.view = Object.freeze({ ...current.view, status: "reconciliation" }); publish(scopeKey);
    return current.view;
  }
  if (records.size >= 25) deny("Check an unresolved event request before starting another.");
  const view = Object.freeze({ owner, requestId: command.requestId, status: "submitting" });
  records.set(scopeKey, { payload, view, uncertainEver: false }); publish(scopeKey); return view;
}
export function failEventOperatingMutation(scope, owner, requestId, definitive) {
  const scopeKey = key(scope), current = records.get(scopeKey);
  if (!current || current.view.owner !== owner || current.view.requestId !== requestId) return null;
  current.uncertainEver = current.uncertainEver || !definitive;
  const status = current.uncertainEver ? "uncertain" : "rejected";
  current.view = Object.freeze({ owner, requestId, status }); publish(scopeKey); return current.view;
}
export function releaseEventOperatingMutation(scope, owner, requestId, { reviewedReset = false } = {}) {
  const scopeKey = key(scope), current = records.get(scopeKey);
  if (!current || current.view.owner !== owner || current.view.requestId !== requestId || (reviewedReset && current.view.status !== "rejected")) return false;
  records.delete(scopeKey); publish(scopeKey); return true;
}
