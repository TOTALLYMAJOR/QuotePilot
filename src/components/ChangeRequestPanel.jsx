import { useMemo, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import DecisionCard from "./DecisionCard";
import {
  CHANGE_REQUEST_PARSE_MODEL,
  buildChangeImpact,
  parseChangeRequest
} from "./changeRequestParse";

// Flag-gated client-request panel in the quote editor
// (docs/POST_COMPETITIVE_DESIGN.md §4.8). The customer's stored freeform
// request is shown verbatim and parsed deterministically into stageable
// proposals, each priced as a preview delta by the same calculator the rail
// uses. Staging edits the draft only; the operator's ordinary save remains
// the approval that re-prices authoritatively and creates the next version.
export default function ChangeRequestPanel({
  message,
  submittedAtISO = "",
  requestId = "",
  form,
  catalog,
  settings,
  styles = [],
  onStageProposal,
  onRecordParse = null
}) {
  const [stagedProposals, setStagedProposals] = useState([]);
  const [recordState, setRecordState] = useState({ phase: "ready" });
  const stagedIds = stagedProposals.map((proposal) => proposal.id);
  const parsed = useMemo(
    () => parseChangeRequest(message, { form, catalog, styles }),
    [message, form, catalog, styles]
  );

  if (!parsed.message) return null;

  const stage = (proposal) => {
    if (stagedIds.includes(proposal.id)) return;
    onStageProposal?.(proposal);
    setStagedProposals((prev) => [...prev, proposal]);
    setRecordState((prev) => (prev.phase === "receipt" ? { phase: "ready" } : prev));
  };

  const recordPayload = () => {
    const byId = new Map(parsed.proposals.map((proposal) => [proposal.id, proposal]));
    for (const proposal of stagedProposals) byId.set(proposal.id, proposal);
    return {
      requestId,
      submittedAtISO,
      parseModelId: parsed.modelId,
      proposals: [...byId.values()],
      stagedProposalIds: stagedIds
    };
  };

  // Recording is replay-stable server-side (deterministic record identity),
  // so an ambiguous outcome reconciles safely: the same call either finds
  // the existing record or creates it once. Definitive server rejection is
  // terminal here; transient failure keeps a safe retry.
  const recordReview = async (mode = "submit") => {
    if (typeof onRecordParse !== "function" || !stagedProposals.length) return;
    setRecordState({ phase: mode === "submit" ? "submitting" : "reconciliation" });
    try {
      const receipt = await onRecordParse(recordPayload());
      setRecordState({ phase: "receipt", receipt });
    } catch (error) {
      if (error?.definitive === true) {
        setRecordState({ phase: "error" });
        return;
      }
      setRecordState({ phase: mode === "submit" ? "uncertain" : "recovery" });
    }
  };

  const impactLine = (proposal) => {
    if (stagedIds.includes(proposal.id)) return "Staged in this draft.";
    const impact = buildChangeImpact({ form, catalog, settings, proposal });
    if (!impact) return "";
    const sign = impact.delta > 0 ? "+" : impact.delta < 0 ? "−" : "±";
    const depositSign = impact.depositDelta > 0 ? "+" : impact.depositDelta < 0 ? "−" : "±";
    return `${sign}${currency(Math.abs(impact.delta))} total after the fee and tax cascade · deposit ${depositSign}${currency(Math.abs(impact.depositDelta))} (preview).`;
  };

  const submittedLabel = submittedAtISO
    ? new Date(submittedAtISO).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
      })
    : "";

  return (
    <section
      className="panel change-request-panel"
      aria-labelledby="change-request-title"
      data-change-request={CHANGE_REQUEST_PARSE_MODEL}
    >
      <div className="create-intake-head">
        <div>
          <p className="eyebrow">Client request</p>
          <h2 id="change-request-title">They asked for changes</h2>
          <p className="create-intake-sub">
            Parsed from the exact message below. Staging edits this draft only —
            saving creates the next version through the standard path, and nothing
            is promised to the client until you send.
          </p>
        </div>
      </div>

      <blockquote className="change-request-message">
        <p>“{parsed.message}”</p>
        {submittedLabel && <footer>Received {submittedLabel}</footer>}
      </blockquote>

      {parsed.proposals.length > 0 && (
        <div className="now-stream">
          {parsed.proposals.map((proposal) => (
            <DecisionCard
              key={proposal.id}
              signal="attend"
              family="customer_action"
              label="Client request"
              title={proposal.title}
              meta={proposal.meta}
              sentence={`They wrote: “${proposal.clause}”`}
              impact={impactLine(proposal)}
              why={[
                `Model: ${CHANGE_REQUEST_PARSE_MODEL} over the stored client message.`,
                `Matched clause: “${proposal.clause}”`,
                "The delta is a live preview at this draft's current inputs; saving re-prices authoritatively on the server."
              ]}
              actions={[{
                id: "stage",
                kind: "primary",
                label: stagedIds.includes(proposal.id) ? "Staged" : "Stage this",
                disabled: stagedIds.includes(proposal.id)
              }]}
              onAction={() => stage(proposal)}
            />
          ))}
        </div>
      )}

      {parsed.ambiguities.map((ambiguity) => (
        <div key={ambiguity.id} className="change-request-ambiguity">
          <p className="create-intake-group-label">Which one did they mean?</p>
          <p className="change-request-ambiguity-clause">“{ambiguity.clause}”</p>
          <div className="now-card-actions">
            {ambiguity.candidates.map((candidate) => (
              <button
                key={`${ambiguity.id}-${candidate.itemType}-${candidate.itemId}`}
                type="button"
                className="ghost"
                onClick={() => stage({
                  id: `${ambiguity.id}-${candidate.itemId}`,
                  kind: ambiguity.verb === "remove" ? "remove_item" : "add_item",
                  ...candidate,
                  title: `${ambiguity.verb === "remove" ? "Remove" : "Add"} ${candidate.itemName}`,
                  meta: "Chosen by you",
                  clause: ambiguity.clause
                })}
                disabled={stagedIds.includes(`${ambiguity.id}-${candidate.itemId}`)}
              >
                {ambiguity.verb === "remove" ? "Remove" : "Add"} {candidate.itemName}
              </button>
            ))}
          </div>
        </div>
      ))}

      {parsed.unparsedClauses.length > 0 && (
        <div className="change-request-unparsed">
          <p className="create-intake-group-label">For you to read</p>
          {parsed.unparsedClauses.map((clause) => (
            <p key={clause} className="source-note">“{clause}” — nothing was staged for this.</p>
          ))}
        </div>
      )}

      {parsed.proposals.length === 0 && parsed.ambiguities.length === 0 && (
        <p className="source-note">
          Nothing stageable could be read from this message — it stays yours to
          act on directly. Nothing was changed.
        </p>
      )}

      {typeof onRecordParse === "function" && stagedProposals.length > 0 && (
        <div
          className="change-request-record"
          data-capability-id="structured-change-request-record"
          data-capability-state={recordState.phase}
        >
          {recordState.phase === "ready" && (
            <>
              <button type="button" className="ghost" onClick={() => recordReview("submit")}>
                Record this review
              </button>
              <small>
                Creates an internal audit record binding the exact request, the
                parsed proposals, and what you staged to the current quote
                revision. It does not reply to the customer, change the
                proposal, or create a version.
              </small>
            </>
          )}
          {recordState.phase === "submitting" && (
            <p className="source-note" role="status">Recording the review...</p>
          )}
          {recordState.phase === "receipt" && (
            <p className="source-note" role="status">
              Recorded — resolution {String(recordState.receipt?.resolutionId || "").slice(0, 16)}
              {recordState.receipt?.alreadyRecorded ? " (already on file)" : ""}. Internal
              audit record only; nothing was sent to the customer and no version
              was created.
            </p>
          )}
          {recordState.phase === "uncertain" && (
            <>
              <p className="source-note" role="status">
                The record's outcome is unclear. Recording is replay-stable, so
                reconciling checks safely without creating a duplicate. The
                staged draft is unchanged.
              </p>
              <button type="button" className="ghost" onClick={() => recordReview("reconcile")}>
                Reconcile record
              </button>
            </>
          )}
          {recordState.phase === "reconciliation" && (
            <p className="source-note" role="status">Reconciling the record...</p>
          )}
          {recordState.phase === "recovery" && (
            <>
              <p className="source-note" role="status">
                Still unreachable. The staged draft is unchanged and reconciling
                remains safe to repeat.
              </p>
              <button type="button" className="ghost" onClick={() => recordReview("reconcile")}>
                Try again
              </button>
            </>
          )}
          {recordState.phase === "error" && (
            <p className="error-note" role="alert">
              The server declined this record — the stored customer request may
              have changed since this parse. Re-open the quote to review the
              current request. The staged draft is unchanged.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
