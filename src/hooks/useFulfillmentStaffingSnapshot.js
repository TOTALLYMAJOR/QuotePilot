import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOperationalStaffingSnapshot } from "../lib/operationalStaffingClient";
import { scheduleDeferredClientWork } from "../lib/deferredClientWork";

export const FULFILLMENT_STAFFING_MAX_AGE_MS = 5 * 60 * 1_000;

function text(value) {
  return String(value ?? "").trim();
}

function initialRead(identity = "") {
  return {
    identity,
    state: "not_evaluated",
    envelope: null,
    retained: false,
    error: "",
    observedAtISO: "",
    refreshedAtMs: 0
  };
}

export function deriveFulfillmentStaffingRead({
  envelope,
  organizationId,
  quoteId,
  savedQuoteRevisionId,
  refreshedAtMs = Date.now()
} = {}) {
  const exactOrganizationId = text(organizationId);
  const exactQuoteId = text(quoteId);
  const exactRevisionId = text(savedQuoteRevisionId);
  if (!envelope || typeof envelope !== "object") {
    return { ...initialRead(`${exactOrganizationId}\u0000${exactQuoteId}\u0000${exactRevisionId}`) };
  }
  const exactScope = text(envelope.organizationId) === exactOrganizationId
    && text(envelope.quoteId) === exactQuoteId;
  const revisionCurrent = text(envelope.activeQuoteRevisionId) === exactRevisionId;
  const sourceState = text(envelope.state).toLowerCase();
  const state = !exactScope || !revisionCurrent
    ? "stale"
    : ["current", "empty", "partial", "stale"].includes(sourceState)
      ? sourceState
      : "unavailable";
  return {
    identity: `${exactOrganizationId}\u0000${exactQuoteId}\u0000${exactRevisionId}`,
    state,
    envelope,
    retained: false,
    error: "",
    observedAtISO: text(envelope.observedAtISO),
    refreshedAtMs
  };
}

export function expireFulfillmentStaffingRead(
  read,
  { nowMs = Date.now(), maxAgeMs = FULFILLMENT_STAFFING_MAX_AGE_MS } = {}
) {
  if (!read || !["current", "empty", "partial"].includes(read.state)
    || !Number.isFinite(read.refreshedAtMs)
    || read.refreshedAtMs <= 0
    || nowMs - read.refreshedAtMs < maxAgeMs) return read;
  return {
    ...read,
    state: "stale",
    retained: Boolean(read.envelope),
    error: "Staffing evidence exceeded its bounded freshness window. Refresh before relying on it."
  };
}

/**
 * Reads the exact bounded staffing snapshot once per organization, quote, and
 * saved quote revision. Proposed guest-count edits are deliberately absent
 * from the identity: pure Fulfillment composition reacts locally without
 * reloading the staff directory on every keystroke.
 *
 * The first read yields to the quote editor's initial browser work when idle
 * scheduling is available. Explicit refreshes and focus refreshes remain
 * immediate, and the authority/read contract is otherwise unchanged.
 */
export function useFulfillmentStaffingSnapshot({
  active = false,
  organizationId = "",
  quoteId = "",
  savedQuoteRevisionId = ""
} = {}) {
  const identity = useMemo(() => [organizationId, quoteId, savedQuoteRevisionId]
    .map(text).join("\u0000"), [organizationId, quoteId, savedQuoteRevisionId]);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const [read, setRead] = useState(() => initialRead(identity));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const load = useCallback(async ({ retain = true } = {}) => {
    const exactOrganizationId = text(organizationId);
    const exactQuoteId = text(quoteId);
    const exactRevisionId = text(savedQuoteRevisionId);
    const requestedIdentity = [exactOrganizationId, exactQuoteId, exactRevisionId].join("\u0000");
    if (!active || !exactOrganizationId || !exactQuoteId || !exactRevisionId) {
      setRead(initialRead(requestedIdentity));
      return null;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setRead((current) => ({
      identity: requestedIdentity,
      state: "loading",
      envelope: retain && current.identity === requestedIdentity ? current.envelope : null,
      retained: Boolean(retain && current.identity === requestedIdentity && current.envelope),
      error: "",
      observedAtISO: retain && current.identity === requestedIdentity ? current.observedAtISO : "",
      refreshedAtMs: retain && current.identity === requestedIdentity ? current.refreshedAtMs : 0
    }));
    try {
      const envelope = await getOperationalStaffingSnapshot({
        organizationId: exactOrganizationId,
        quoteId: exactQuoteId
      });
      if (!mountedRef.current || generationRef.current !== generation) return envelope;
      setRead(deriveFulfillmentStaffingRead({
        envelope,
        organizationId: exactOrganizationId,
        quoteId: exactQuoteId,
        savedQuoteRevisionId: exactRevisionId
      }));
      return envelope;
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) throw error;
      setRead((current) => ({
        ...current,
        state: "unavailable",
        retained: Boolean(current.envelope),
        error: text(error?.message) || "Current staffing evidence is unavailable."
      }));
      throw error;
    }
  }, [active, organizationId, quoteId, savedQuoteRevisionId]);

  useEffect(() => {
    generationRef.current += 1;
    if (!active || !text(organizationId) || !text(quoteId) || !text(savedQuoteRevisionId)) {
      setRead(initialRead(identity));
      return undefined;
    }
    return scheduleDeferredClientWork(() => {
      void load({ retain: false }).catch(() => {});
    });
  }, [active, identity, load, organizationId, quoteId, savedQuoteRevisionId]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const refreshOnFocus = () => {
      void load({ retain: true }).catch(() => {});
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [active, load]);

  useEffect(() => {
    if (!["current", "empty", "partial"].includes(read.state) || !read.refreshedAtMs) {
      return undefined;
    }
    const ageMs = Math.max(0, Date.now() - read.refreshedAtMs);
    const remainingMs = Math.max(0, FULFILLMENT_STAFFING_MAX_AGE_MS - ageMs);
    const timerId = window.setTimeout(() => {
      setRead((current) => expireFulfillmentStaffingRead(current));
    }, remainingMs);
    return () => window.clearTimeout(timerId);
  }, [read.identity, read.refreshedAtMs, read.state]);

  const refresh = useCallback(() => load({ retain: true }), [load]);

  return useMemo(() => ({
    read,
    refresh,
    loading: read.state === "loading",
    current: ["current", "empty"].includes(read.state) && !read.retained
  }), [read, refresh]);
}

export default useFulfillmentStaffingSnapshot;
