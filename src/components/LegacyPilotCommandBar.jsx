import { useRef, useState } from "react";
import { currency } from "../lib/quoteCalculator";
import {
  CHANGE_REQUEST_PARSE_MODEL,
  buildChangeImpact,
  parseChangeRequest
} from "./changeRequestParse";

// Production currently enables Pilot Command while Ambient remains off. Keep
// the established v0.7 draft-only surface in its own build-time branch so the
// Ambient query, scenario, sensory, and command-policy graph is absent from the
// rollback bundle. Saving remains the sole write and pricing authority.
export const PILOT_COMMAND_MODEL = CHANGE_REQUEST_PARSE_MODEL;

const PILOT_MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);

function speechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default function LegacyPilotCommandBar({
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
    setAppliedIds((current) => [...current, proposal.id]);
  };

  const toggleVoice = () => {
    const Recognition = speechRecognitionCtor();
    if (!Recognition) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ")
        .trim();
      if (transcript) setText((current) => current ? `${current} ${transcript}` : transcript);
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
    const marginNote = PILOT_MARGINS_ENABLED && impact.marginDelta
      ? ` Margin ${(impact.marginDelta.beforePct * 100).toFixed(1)}% → ${(impact.marginDelta.afterPct * 100).toFixed(1)}%.`
      : "";
    return `${sign}${currency(Math.abs(impact.delta))} total (preview, fee and tax cascade included).${marginNote}`;
  };

  return (
    <section
      className="pilot-command"
      aria-label="Pilot command bar"
      data-pilot-command={PILOT_COMMAND_MODEL}
      data-pilot-expanded="false"
    >
      <div className="pilot-command-row">
        <input
          type="text"
          className="pilot-command-input"
          value={text}
          placeholder={'Tell the draft what to do — "add another bartender", "switch to buffet", "what if we are at 150 guests"'}
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
                {appliedIds.includes(proposal.id) ? "Applied to draft" : "Apply to draft"}
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
