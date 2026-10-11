import { useEffect, useRef, useState } from "react";

const PREFIX = "quotepilot:commercial-apply-recovery:";
const SCHEMA = "commercial-apply-recovery-v1";
const FIELDS = ["schemaVersion", "organizationId", "principalId", "quoteId", "simulationReceiptId", "authorizationReceiptId", "applyRequestId", "expectedBaseRevisionId", "recordedAtISO"];
const opaqueId = value => typeof value === "string" && value.length > 0 && value.length <= 256
  && !/[\s/?#\\\u0000-\u001f\u007f]/u.test(value)
  && value !== "." && value !== ".." && !/^[^@]+@[^@]+$/u.test(value);
function scopeKey(scope) {
  return [scope?.organizationId, scope?.principalId, scope?.quoteId].every(opaqueId)
    ? PREFIX + JSON.stringify([scope.organizationId, scope.principalId, scope.quoteId])
    : "";
}
function validIdentity(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(key => FIELDS.includes(key))
    && value.schemaVersion === SCHEMA && scopeKey(value)
    && opaqueId(value.expectedBaseRevisionId)
    && /^ccs_[a-f0-9]{48}$/u.test(value.simulationReceiptId)
    && (value.authorizationReceiptId === "" || /^cca_[a-f0-9]{48}$/u.test(value.authorizationReceiptId))
    && /^change_apply_[a-f0-9]{32}$/u.test(value.applyRequestId)
    && typeof value.recordedAtISO === "string" && value.recordedAtISO.length === 24
    && Number.isFinite(Date.parse(value.recordedAtISO))
    && new Date(value.recordedAtISO).toISOString() === value.recordedAtISO;
}
function recoveryKeys(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}
export function readCommercialApplyRecovery(storage, scope) {
  const key = scopeKey(scope);
  if (!key) return null;
  if (!storage) throw new Error("Browser recovery storage is unavailable. Applying changes is blocked.");
  const raw = storage.getItem(key);
  if (raw === null) return null;
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 4096) {
    throw new Error("The saved apply recovery identity is too large or invalid. Applying changes is blocked.");
  }
  let identity;
  try { identity = JSON.parse(raw); } catch { /* Invalid recovery never frees a new apply. */ }
  if (!validIdentity(identity) || scopeKey(identity) !== key) {
    throw new Error("The saved apply recovery identity is invalid. Applying changes is blocked.");
  }
  return Object.freeze(identity);
}
export function listCommercialApplyRecoveries(storage, scope) {
  if (![scope?.organizationId, scope?.principalId].every(opaqueId)) return [];
  if (!storage) throw new Error("Browser recovery storage is unavailable. Applying changes is blocked.");
  const keys = recoveryKeys(storage);
  if (keys.length > 64) throw new Error("Too many saved recovery identities. Applying changes is blocked.");
  return keys.flatMap(key => {
    let owner;
    try { owner = JSON.parse(key.slice(PREFIX.length)); } catch { return []; }
    if (owner[0] !== scope.organizationId || owner[1] !== scope.principalId) return [];
    const identity = readCommercialApplyRecovery(storage, { ...scope, quoteId: owner[2] });
    return identity ? [identity] : [];
  }).sort((a, b) => a.recordedAtISO.localeCompare(b.recordedAtISO));
}
export function recordCommercialApplyRecovery(storage, input) {
  const identity = { ...input, authorizationReceiptId: input?.authorizationReceiptId || "" };
  if (!validIdentity(identity)) return null;
  try {
    if (readCommercialApplyRecovery(storage, identity) || recoveryKeys(storage).length >= 64) return null;
    const raw = JSON.stringify(identity);
    if (new TextEncoder().encode(raw).length > 4096) return null;
    storage.setItem(scopeKey(identity), raw);
    return readCommercialApplyRecovery(storage, identity)?.applyRequestId === identity.applyRequestId
      ? Object.freeze(identity) : null;
  } catch { return null; }
}
export function resolveCommercialApplyRecovery(storage, identity, result) {
  const receipt = result?.outcomeReceipt;
  if (!validIdentity(identity) || receipt?.authority !== "server_authoritative"
    || receipt.receiptType !== "outcome" || !["committed", "not_committed"].includes(receipt.state)
    || receipt.organizationId !== identity.organizationId || receipt.quoteId !== identity.quoteId
    || receipt.requestId !== identity.applyRequestId || receipt.simulationReceiptId !== identity.simulationReceiptId
    || (receipt.authorizationReceiptId || "") !== identity.authorizationReceiptId
    || receipt.baseRevisionId !== identity.expectedBaseRevisionId) return false;
  try {
    if (readCommercialApplyRecovery(storage, identity)?.applyRequestId !== identity.applyRequestId) return false;
    storage.removeItem(scopeKey(identity));
    return storage.getItem(scopeKey(identity)) === null;
  } catch { return false; }
}
function browserStorage() {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

// Persist identity only. The existing authority client owns all server receipt validation.
export function useCommercialApplyRecovery({ organizationId = "", principalId = "", quoteId = "", ready = true, storage = browserStorage() }) {
  const scope = { organizationId, principalId, quoteId };
  let key = scopeKey(scope);
  const scopeIdentity = JSON.stringify([organizationId, principalId, quoteId, ready]);
  const activeRef = useRef({ scopeIdentity, generation: 0 });
  if (activeRef.current.scopeIdentity !== scopeIdentity) {
    activeRef.current = { scopeIdentity, generation: activeRef.current.generation + 1 };
  }
  const generation = activeRef.current.generation;
  const mountedRef = useRef(true);
  const originRef = useRef("");
  const inFlightRef = useRef(null);
  const consumedRef = useRef({ owner: JSON.stringify([organizationId, principalId]), identities: new Map() });
  const owner = JSON.stringify([organizationId, principalId]);
  if (consumedRef.current.owner !== owner) consumedRef.current = { owner, identities: new Map() };
  const [state, setState] = useState({ key, busy: false, error: "", outcome: null });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  let pending = null;
  let readError = "";
  if (ready) {
    try {
      pending = key ? readCommercialApplyRecovery(storage, scope) : listCommercialApplyRecoveries(storage, scope)[0] || null;
      if (!key) {
        const stateOwner = state.key ? JSON.parse(state.key.slice(PREFIX.length)) : [];
        key = pending ? scopeKey(pending)
          : stateOwner[0] === organizationId && stateOwner[1] === principalId ? state.key : "";
      }
    }
    catch (error) { readError = error?.message || "Browser recovery storage is unavailable. Applying changes is blocked."; }
  }
  useEffect(() => {
    if (!ready || !storage) return;
    try {
      for (const entryKey of recoveryKeys(storage)) {
        let owner;
        try { owner = JSON.parse(entryKey.slice(PREFIX.length)); } catch { owner = []; }
        if (owner[0] !== organizationId || owner[1] !== principalId) storage.removeItem(entryKey);
      }
    } catch { /* Storage access failures remain blocked by the read guard. */ }
  }, [organizationId, principalId, ready, storage]);

  const isCurrent = () => mountedRef.current && activeRef.current.generation === generation;
  const getPending = (targetQuoteId = quoteId) => ready && isCurrent()
    ? readCommercialApplyRecovery(storage, { ...scope, quoteId: targetQuoteId }) : null;
  function begin(input, createRequestId) {
    const targetScope = { ...scope, quoteId: input.quoteId || quoteId };
    if (!isCurrent() || !ready || !scopeKey(targetScope)) return null;
    const consumed = consumedRef.current.identities.get(scopeKey(targetScope));
    if (consumed && (input.simulationReceiptId === consumed.simulationReceiptId || input.applyRequestId === consumed.applyRequestId)) return null;
    try {
      if (readCommercialApplyRecovery(storage, targetScope)) return null;
    } catch { return null; }
    const saved = recordCommercialApplyRecovery(storage, {
      ...input, ...targetScope, schemaVersion: SCHEMA,
      applyRequestId: input.applyRequestId || createRequestId?.(),
      recordedAtISO: new Date().toISOString()
    });
    if (!saved) {
      setState({ key: scopeKey(targetScope), busy: false, outcome: null, error: "The apply request could not be retained for recovery. No edit was submitted. Enable browser session storage, then try again." });
      return null;
    }
    originRef.current = saved.applyRequestId;
    setState({ key: scopeKey(targetScope), busy: false, outcome: null, error: "" });
    return saved;
  }
  async function reconcileQuote(targetQuoteId, send) {
    if (!isCurrent() || !ready || inFlightRef.current?.generation === generation) return null;
    const identity = getPending(targetQuoteId);
    if (!identity) return null;
    const targetKey = scopeKey(identity);
    const flight = { generation };
    inFlightRef.current = flight;
    setState({ key: targetKey, busy: true, outcome: null, error: "" });
    try {
      const result = await send({
        organizationId, quoteId: identity.quoteId, simulationReceiptId: identity.simulationReceiptId,
        authorizationReceiptId: identity.authorizationReceiptId,
        applyRequestId: identity.applyRequestId, expectedBaseRevisionId: identity.expectedBaseRevisionId
      });
      if (!isCurrent()) return null;
      if (!resolveCommercialApplyRecovery(storage, identity, result)) {
        throw new Error("The exact apply outcome could not be retained safely. Retry reconciliation before applying again.");
      }
      consumedRef.current.identities.set(targetKey, identity);
      setState({ key: targetKey, busy: false, error: "", outcome: result });
      return result;
    } catch (error) {
      if (!isCurrent()) return null;
      setState({ key: targetKey, busy: false, outcome: null, error: error?.message || "The exact apply outcome is still uncertain. Retry this request before applying again." });
      throw error;
    } finally {
      if (inFlightRef.current === flight) inFlightRef.current = null;
    }
  }
  return {
    pending, restored: Boolean(pending && pending.applyRequestId !== originRef.current),
    blocked: Boolean(pending || readError || !ready || !key),
    error: readError || (state.key === key ? state.error : ""),
    busy: state.key === key && state.busy,
    outcome: state.key === key ? state.outcome : null,
    recoveryQuoteId: pending?.quoteId || (state.key === key ? state.outcome?.outcomeReceipt?.quoteId : "") || quoteId,
    requiresFreshPreview: (targetQuoteId, simulationReceiptId, applyRequestId) => {
      const consumed = consumedRef.current.identities.get(scopeKey({ ...scope, quoteId: targetQuoteId }));
      return Boolean(consumed && (consumed.simulationReceiptId === simulationReceiptId || consumed.applyRequestId === applyRequestId));
    },
    markUncertain: targetQuoteId => {
      if (!isCurrent() || !getPending(targetQuoteId)) return;
      originRef.current = "";
      setState({ key: scopeKey({ ...scope, quoteId: targetQuoteId }), busy: false, outcome: null, error: "The original apply request is retained. Check its exact outcome before another edit." });
    },
    begin, reconcile: send => reconcileQuote(pending?.quoteId || quoteId, send), reconcileQuote, getPending, isCurrent
  };
}
