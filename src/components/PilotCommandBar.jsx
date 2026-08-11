import { useRef, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import {
  CHANGE_REQUEST_PARSE_MODEL,
  buildChangeImpact,
  parseChangeRequest
} from "./changeRequestParse";

// Flag-gated Pilot command bar for the quote builder
// (docs/POST_COMPETITIVE_DESIGN.md §4.6 and §4.11): the operator types or
// dictates a change in plain words, the same deterministic parser that
// reads client requests turns it into proposals, and every proposal shows
// its live preview delta BEFORE anything touches the draft — the
// preview-confirm contract. Applying stages draft edits only; saving
// remains the sole authority. Voice input is a progressive enhancement on
// the browser's own speech recognition and is absent when unsupported.
export const PILOT_COMMAND_MODEL = CHANGE_REQUEST_PARSE_MODEL;

function speechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function PilotCommandBar({
  form,
  catalog,
  settings,
  styles = [],
  onStageProposal
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [appliedIds, setAppliedIds] = useState([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const voiceSupported = Boolean(speechRecognitionCtor());

  const runPreview = () => {
    if (!text.trim()) return;
    setAppliedIds([]);
    setPreview(parseChangeRequest(text, { form, catalog, styles }));
  };

  const clearPreview = () => {
    setPreview(null);
    setAppliedIds([]);
  };

  const apply = (proposal) => {
    if (appliedIds.includes(proposal.id)) return;
    onStageProposal?.(proposal);
    setAppliedIds((prev) => [...prev, proposal.id]);
  };

  const toggleVoice = () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const impactLine = (proposal) => {
    if (appliedIds.includes(proposal.id)) return "Applied to this draft.";
    const impact = buildChangeImpact({ form, catalog, settings, proposal });
    if (!impact) return "";
    const sign = impact.delta > 0 ? "+" : impact.delta < 0 ? "−" : "±";
    return `${sign}${currency(Math.abs(impact.delta))} total (preview, fee and tax cascade included).`;
  };

  return (
    <section className="pilot-command" aria-label="Pilot command bar" data-pilot-command={PILOT_COMMAND_MODEL}>
      <div className="pilot-command-row">
        <input
          type="text"
          className="pilot-command-input"
          value={text}
          placeholder='Tell the draft what to do — "add another bartender", "switch to buffet", "what if we are at 150 guests"'
          aria-label="Command for this draft"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runPreview();
          }}
        />
        {voiceSupported && (
          <button
            type="button"
            className={`ghost compact${listening ? " is-listening" : ""}`}
            onClick={toggleVoice}
            aria-pressed={listening}
          >
            {listening ? "Listening…" : "Speak"}
          </button>
        )}
        <button type="button" className="cta" onClick={runPreview} disabled={!text.trim()}>
          Preview
        </button>
      </div>

      {preview && (
        <div className="pilot-command-preview" aria-live="polite">
          {preview.proposals.map((proposal) => (
            <div key={proposal.id} className="pilot-command-proposal">
              <div>
                <strong>{proposal.title}</strong>
                <small>{impactLine(proposal)}</small>
              </div>
              <button
                type="button"
                className="cta compact"
                onClick={() => apply(proposal)}
                disabled={appliedIds.includes(proposal.id)}
              >
                {appliedIds.includes(proposal.id) ? "Applied" : "Apply"}
              </button>
            </div>
          ))}
          {preview.ambiguities.map((ambiguity) => (
            <p key={ambiguity.id} className="source-note">
              “{ambiguity.clause}” matches more than one catalog item — say which one you mean.
            </p>
          ))}
          {preview.unparsedClauses.map((clause) => (
            <p key={clause} className="source-note">“{clause}” — nothing was read from this; the draft is unchanged.</p>
          ))}
          {preview.proposals.length === 0 && preview.ambiguities.length === 0
            && preview.unparsedClauses.length === 0 && (
            <p className="source-note">Nothing was read from that; the draft is unchanged.</p>
          )}
          <div className="pilot-command-actions">
            <button type="button" className="ghost compact" onClick={clearPreview}>Discard preview</button>
            <small>Nothing changes until you apply. Saving still re-prices on the server.</small>
          </div>
        </div>
      )}
    </section>
  );
}
