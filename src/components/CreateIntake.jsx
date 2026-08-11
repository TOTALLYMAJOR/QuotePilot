import { useState } from "react";
import { INTENT_EXTRACTION_MODEL, extractIntentDraft } from "./intentExtraction";
import { deriveGuestBand } from "./pricingBand";
import DecisionCard from "./DecisionCard";
import { loadEventShapeMemory } from "../lib/eventShapeMemory";

// Pilot gate for event-shape memory (docs/POST_COMPETITIVE_DESIGN.md
// §4.10; owner-decided scope 2026-08-11, production-bound 2026-08-11):
// the ninth production-bound gate, alongside the original seven and the
// decision-room gate, taking effect at the next release from this
// branch. Generic and local builds still default to off.
const PILOT_MEMORY_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MEMORY_ENABLED || "").trim().toLowerCase()
);

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
  // Event-shape memory read states: loading/empty/partial/success land
  // from one fetch attempt; error offers a retry, and a retry that also
  // fails becomes "recovery" ("still unreachable, safe to try again") —
  // the same escalation language used elsewhere for a read that keeps
  // retrying safely rather than risking a duplicate side effect. There is
  // no "stale" variant: nothing is cached, every attempt reads fresh.
  const [memory, setMemory] = useState({ phase: "ready" });
  const [memoryApplied, setMemoryApplied] = useState(false);

  const loadMemory = async (eventTypeId, guests, hadPriorError) => {
    setMemory({ phase: "loading" });
    try {
      const shape = await loadEventShapeMemory({ organizationId, eventTypeId, guests });
      if (!shape) {
        setMemory({ phase: "ready" });
        return;
      }
      setMemory(shape.sampleSize === 0
        ? { phase: "empty", shape }
        : shape.sufficient
          ? { phase: "success", shape }
          : { phase: "partial", shape });
    } catch (loadError) {
      setMemory({
        phase: hadPriorError ? "recovery" : "error",
        eventTypeId,
        guests,
        message: String(loadError?.message || "Similar-event history is unreachable.")
      });
    }
  };

  const structure = () => {
    setAppliedAt("");
    setConfirmedIds([]);
    setMemory({ phase: "ready" });
    setMemoryApplied(false);
    const next = extractIntentDraft(text, { eventTypes, styles, nowDate: nowDate || new Date() });
    setResult(next);
    const eventTypeId = next?.draft?.eventTypeId;
    const guests = next?.draft?.guests;
    if (PILOT_MEMORY_ENABLED && organizationId && eventTypeId && Number(guests) > 0) {
      void loadMemory(eventTypeId, guests, false);
    }
  };

  const applyMemory = () => {
    if (memory.phase !== "success") return;
    const { staffing, hours } = memory.shape;
    const payload = {};
    if (staffing) {
      payload.servers = staffing.servers;
      payload.chefs = staffing.chefs;
      payload.bartenders = staffing.bartenders;
    }
    if (hours !== null && hours !== undefined) payload.hours = hours;
    if (!Object.keys(payload).length) return;
    onApplyDraft?.(payload);
    setMemoryApplied(true);
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

      {PILOT_MEMORY_ENABLED && memory.phase !== "ready" && (
        <div
          className="create-intake-memory"
          data-capability-id="event-shape-memory"
          data-capability-state={memory.phase}
          aria-live="polite"
        >
          {memory.phase === "loading" && (
            <p className="source-note" role="status">Checking similar past events...</p>
          )}
          {memory.phase === "empty" && (
            <p className="source-note" role="status">
              No past {eventTypes.find((t) => t.id === memory.shape.eventTypeId)?.name || "matching"} events
              of a similar size yet — nothing to suggest from history.
            </p>
          )}
          {memory.phase === "partial" && (
            <p className="source-note" role="status">
              Only {memory.shape.sampleSize} similar past event{memory.shape.sampleSize === 1 ? "" : "s"} on
              file — not enough yet for a confident suggestion.
            </p>
          )}
          {memory.phase === "success" && (
            <DecisionCard
              signal="attend"
              family="event_shape_memory"
              label="From your own history"
              title={`Similar ${eventTypes.find((t) => t.id === memory.shape.eventTypeId)?.name || "events"} typically staff ${memory.shape.staffing.servers} servers, ${memory.shape.staffing.chefs} chefs, ${memory.shape.staffing.bartenders} bartenders over ${memory.shape.hours} hours`}
              meta={`Based on ${memory.shape.sampleSize} of your booked events (${memory.shape.band} guests)`}
              sentence={memory.shape.rentals.length
                ? `Also commonly included: ${memory.shape.rentals.map((r) => r.name).join(", ")}.`
                : ""}
              impact="Applying only sets staffing and hours — nothing here is priced or saved."
              actions={memoryApplied ? [] : [{ id: "apply", kind: "primary", label: "Apply to draft" }]}
              onAction={applyMemory}
            />
          )}
          {memoryApplied && <p className="source-note" role="status">Applied to this draft.</p>}
          {memory.phase === "error" && (
            <>
              <p className="error-note" role="alert">{memory.message}</p>
              <button
                type="button"
                className="ghost compact"
                onClick={() => void loadMemory(memory.eventTypeId, memory.guests, true)}
              >
                Retry
              </button>
            </>
          )}
          {memory.phase === "recovery" && (
            <>
              <p className="source-note" role="status">
                Still unreachable. {memory.message} Safe to try again.
              </p>
              <button
                type="button"
                className="ghost compact"
                onClick={() => void loadMemory(memory.eventTypeId, memory.guests, true)}
              >
                Try again
              </button>
            </>
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
