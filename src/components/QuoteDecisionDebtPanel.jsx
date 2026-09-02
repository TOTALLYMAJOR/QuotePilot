import { useCallback, useEffect, useRef, useState } from "react";
import { getDecisionDebtSnapshot } from "../lib/decisionDebtClient";
import DecisionDebtPanel from "./DecisionDebtPanel";

function text(value) {
  return String(value ?? "").trim();
}

function normalizeTimeZone(value) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "";
  }
}

export default function QuoteDecisionDebtPanel({
  organizationId = "",
  quoteId = "",
  tenantTimeZone = "",
  available = true,
  onOpenWorkflow,
  onReadStateChange
}) {
  const generationRef = useRef(0);
  const [read, setRead] = useState({
    loading: true,
    result: null,
    error: "",
    stale: false
  });

  const load = useCallback(async () => {
    const scopedOrganizationId = text(organizationId);
    const scopedQuoteId = text(quoteId);
    const scopedTimeZone = normalizeTimeZone(tenantTimeZone);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    if (!available || !scopedOrganizationId || !scopedQuoteId) {
      setRead({
        loading: false,
        result: null,
        error: "Decisions to review require a connected quote from this workspace.",
        stale: false
      });
      return;
    }
    if (!scopedTimeZone) {
      setRead({
        loading: false,
        result: null,
        error: "Configure an explicit tenant IANA time zone in Library pricing before deriving Decision Debt.",
        stale: false
      });
      return;
    }
    setRead((current) => ({
      ...current,
      loading: true,
      error: "",
      stale: false
    }));
    try {
      const result = await getDecisionDebtSnapshot({
        organizationId: scopedOrganizationId,
        quoteId: scopedQuoteId,
        limit: 25
      });
      if (generationRef.current !== generation) return;
      setRead({ loading: false, result, error: "", stale: false });
    } catch (error) {
      if (generationRef.current !== generation) return;
      setRead((current) => ({
        loading: false,
        result: current.result,
        error: error?.message || "Decisions to review are unavailable for this quote.",
        stale: Boolean(current.result)
      }));
    }
  }, [available, organizationId, quoteId, tenantTimeZone]);

  useEffect(() => {
    load();
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (typeof onReadStateChange !== "function") return;
    onReadStateChange({
      organizationId: text(organizationId),
      quoteId: text(quoteId),
      loading: read.loading,
      stale: read.stale,
      error: read.error,
      result: read.loading || read.stale || read.error ? null : read.result
    });
  }, [onReadStateChange, organizationId, quoteId, read.error, read.loading, read.result, read.stale]);

  const items = Array.isArray(read.result?.snapshot?.items)
    ? read.result.snapshot.items
    : [];
  return (
    <section
      className="quote-decision-debt-panel"
      data-capability-id="cwf-15-decision-debt-quote-record"
      data-quote-id={text(quoteId) || "unscoped"}
    >
      <DecisionDebtPanel
        snapshot={read.result}
        loading={read.loading}
        error={read.error}
        stale={read.stale}
        partial={read.result?.snapshot?.bounds?.truncated === true}
        onRetry={load}
        showPolicyControls={false}
      />
      {items.length > 0 && typeof onOpenWorkflow === "function" && (
        <div className="workspace-inline-actions">
          <button
            type="button"
            className="ghost compact"
            data-capability-action="open-decision-debt-workflow"
            onClick={() => onOpenWorkflow({
              quoteId: text(quoteId),
              attentionType: "decision_debt",
              requestId: text(items[0]?.id)
            })}
          >
            Open in Workflow
          </button>
          <span className="source-note">
            Workflow opens the exact quote context; this read does not resolve a dependency.
          </span>
        </div>
      )}
    </section>
  );
}
