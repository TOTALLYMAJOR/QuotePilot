import { useState } from "react";
import { INTENT_EXTRACTION_MODEL, extractIntentDraft } from "./intentExtraction";
import { deriveGuestBand } from "./pricingBand";

// Pure apply contract: the draft field map plus the guest band derived from
// the operator's own uncertainty phrasing (null when the count was exact).
export function buildApplyPayload(result) {
  const draft = result?.draft || {};
  const guestFact = (result?.facts || []).find((fact) => fact.id === "guests") || null;
  return { draft, guestBand: deriveGuestBand(guestFact) };
}

// Flag-gated CREATE intake canvas (docs/INTENT_INTAKE_ADR.md). The operator
// types or pastes anything; the deterministic extractor structures what it
// can read, shows each fact with its source excerpt, and prefills the
// ordinary editable draft form only when the operator applies it. No I/O,
// no provider, no invention; low-confidence facts require one-tap
// confirmation and everything unread stays the operator's text.
export default function CreateIntake({
  eventTypes = [],
  styles = [],
  onApplyDraft,
  nowDate = null,
  initialText = "",
  autoStructure = false,
  organizationId = "",
  onModelParse = null
}) {
  const [text, setText] = useState(initialText);
  // Model-assist read states (docs/INTENT_INTAKE_ADR.md): the lane is
  // dormant server-side by default, so "recovery" (lane off, deterministic
  // extractor remains the floor) is an expected outcome, not an error.
  const [modelParse, setModelParse] = useState({ phase: "ready" });

  const runModelParse = async () => {
    if (typeof onModelParse !== "function" || !text.trim()) return;
    setModelParse({ phase: "loading" });
    const outcome = await onModelParse({ organizationId, text: text.trim() });
    if (!outcome?.ok) {
      setModelParse(outcome?.disabled
        ? { phase: "recovery", message: outcome.message }
        : { phase: "error", message: outcome?.message || "The model parser is unreachable." });
      return;
    }
    if (!outcome.facts.length && !outcome.notes.length) {
      setModelParse({ phase: "empty" });
      return;
    }
    setModelParse({
      phase: outcome.notes.length ? "partial" : "success",
      facts: outcome.facts,
      notes: outcome.notes
    });
  };
  const [result, setResult] = useState(() => (
    autoStructure && initialText.trim()
      ? extractIntentDraft(initialText, { eventTypes, styles, nowDate: nowDate || new Date() })
      : null
  ));
  const [appliedAt, setAppliedAt] = useState("");
  const [confirmedIds, setConfirmedIds] = useState([]);

  const structure = () => {
    setAppliedAt("");
    setConfirmedIds([]);
    setResult(extractIntentDraft(text, { eventTypes, styles, nowDate: nowDate || new Date() }));
  };

  const applyAll = () => {
    if (!result || !Object.keys(result.draft).length) return;
    const payload = buildApplyPayload(result);
    onApplyDraft?.(payload.draft, payload);
    setAppliedAt("all");
  };

  const confirmFact = (fact) => {
    if (!fact?.field) return;
    onApplyDraft?.({ [fact.field]: fact.value });
    setConfirmedIds((prev) => (prev.includes(fact.id) ? prev : [...prev, fact.id]));
  };

  const hasDraft = Boolean(result && Object.keys(result.draft).length);

  return (
    <section
      className="panel create-intake-panel"
      aria-labelledby="create-intake-title"
      data-create-intake={INTENT_EXTRACTION_MODEL}
    >
      <div className="create-intake-head">
        <div>
          <p className="eyebrow">Create</p>
          <h2 id="create-intake-title">What are you planning?</h2>
          <p className="create-intake-sub">
            Type or paste anything — an email, call notes, a text thread. QuotePilot
            structures what it can read and leaves the rest to you. Nothing is saved
            or sent from here; the draft below stays yours to review.
          </p>
        </div>
      </div>

      <textarea
        className="create-intake-input"
        rows={4}
        value={text}
        placeholder={'"Corporate dinner for about 80 on September 12, upscale but relaxed, plated, budget around $12k."'}
        onChange={(event) => setText(event.target.value)}
        aria-label="Describe the event in your own words"
      />
      <div className="create-intake-actions">
        <button type="button" className="cta" onClick={structure} disabled={!text.trim()}>
          Structure it
        </button>
        {result && !result.empty && (
          <button type="button" className="ghost" onClick={() => { setResult(null); setAppliedAt(""); setConfirmedIds([]); }}>
            Clear reading
          </button>
        )}
        {typeof onModelParse === "function" && (
          <button
            type="button"
            className="ghost"
            onClick={() => void runModelParse()}
            disabled={!text.trim() || modelParse.phase === "loading"}
          >
            {modelParse.phase === "loading" ? "Asking the model..." : "Model assist"}
          </button>
        )}
      </div>

      {typeof onModelParse === "function" && modelParse.phase !== "ready" && (
        <div
          className="create-intake-model"
          data-capability-id="model-assisted-intent-parse"
          data-capability-state={modelParse.phase}
          aria-live="polite"
        >
          {modelParse.phase === "loading" && (
            <p className="source-note" role="status">Asking the model to read your note...</p>
          )}
          {modelParse.phase === "empty" && (
            <p className="source-note" role="status">
              The model read nothing usable from this note. The deterministic
              reading above is unchanged.
            </p>
          )}
          {(modelParse.phase === "success" || modelParse.phase === "partial") && (
            <>
              <p className="create-intake-group-label">Model suggestions — confirm each before it touches the draft</p>
              <ul className="create-intake-facts">
                {modelParse.facts.map((fact) => (
                  <li key={fact.id}>
                    <span>{fact.field}</span>
                    <strong>{fact.displayValue || fact.value}</strong>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => confirmFact(fact)}
                      disabled={confirmedIds.includes(fact.id)}
                    >
                      {confirmedIds.includes(fact.id) ? "Confirmed" : "Confirm"}
                    </button>
                  </li>
                ))}
              </ul>
              {modelParse.phase === "partial" && modelParse.notes.map((note) => (
                <p key={note} className="source-note">“{note}” — left for you to read.</p>
              ))}
            </>
          )}
          {modelParse.phase === "error" && (
            <>
              <p className="error-note" role="alert">{modelParse.message}</p>
              <button type="button" className="ghost compact" onClick={() => void runModelParse()}>
                Retry model assist
              </button>
            </>
          )}
          {modelParse.phase === "recovery" && (
            <p className="source-note" role="status">
              {modelParse.message} Typed structuring above keeps working exactly
              the same.
            </p>
          )}
        </div>
      )}

      {result && !result.empty && (
        <div className="create-intake-result" aria-live="polite">
          {result.facts.length > 0 && (
            <>
              <p className="create-intake-group-label">Read from your note</p>
              <ul className="create-intake-facts">
                {result.facts.map((fact) => (
                  <li key={fact.id} className="create-intake-fact" data-confidence={fact.confidence}>
                    <span className="create-intake-fact-label">{fact.label}</span>
                    <strong>{fact.displayValue}</strong>
                    <small>from “{fact.source}”</small>
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.needsConfirmation.length > 0 && (
            <>
              <p className="create-intake-group-label">Needs your confirmation</p>
              <ul className="create-intake-facts">
                {result.needsConfirmation.map((fact) => (
                  <li key={fact.id} className="create-intake-fact is-unconfirmed" data-confidence={fact.confidence}>
                    <span className="create-intake-fact-label">{fact.label}</span>
                    <strong>{fact.displayValue}</strong>
                    <small>from “{fact.source}”</small>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => confirmFact(fact)}
                      disabled={confirmedIds.includes(fact.id)}
                    >
                      {confirmedIds.includes(fact.id) ? "Used" : `Use as ${fact.label.toLowerCase()}`}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.notes.map((note) => (
            <p key={note.id} className="source-note">{note.text}</p>
          ))}

          {result.facts.length === 0 && result.needsConfirmation.length === 0 && (
            <p className="source-note">
              Nothing structured could be read from that. The builder below is ready —
              nothing was changed.
            </p>
          )}

          {hasDraft && (
            <div className="create-intake-apply">
              <button type="button" className="cta" onClick={applyAll} disabled={appliedAt === "all"}>
                {appliedAt === "all" ? "Applied — review below" : `Apply ${result.facts.length} fact${result.facts.length === 1 ? "" : "s"} to the draft`}
              </button>
              <small>Applying prefills the builder below. Every value stays editable, and saving re-prices on the server.</small>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
