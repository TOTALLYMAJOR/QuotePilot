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
  form,
  catalog,
  settings,
  styles = [],
  onStageProposal
}) {
  const [stagedIds, setStagedIds] = useState([]);
  const parsed = useMemo(
    () => parseChangeRequest(message, { form, catalog, styles }),
    [message, form, catalog, styles]
  );

  if (!parsed.message) return null;

  const stage = (proposal) => {
    if (stagedIds.includes(proposal.id)) return;
    onStageProposal?.(proposal);
    setStagedIds((prev) => [...prev, proposal.id]);
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
    </section>
  );
}
