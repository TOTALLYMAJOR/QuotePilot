import { useEffect, useRef, useState } from "react";
import { Microphone } from "@phosphor-icons/react";
import { currency } from "../lib/quoteCalculator";
import {
  CHANGE_REQUEST_PARSE_MODEL,
  parseChangeRequest,
  buildChangeImpact
} from "./changeRequestParse";
import { classifyPilotDraftProposal } from "../lib/pilotCommandPolicy";
import {
  PILOT_DETERMINISTIC_COMMAND_MODEL,
  buildPilotCommandPreview
} from "../lib/pilotDeterministicCommands";
import {
  generatePilotBoundedScenarios,
  parsePilotBoundedScenarioIntent
} from "../lib/pilotBoundedScenarios";
import {
  AMBIENT_FEEDBACK_TYPES,
  routeAmbientFeedback
} from "./ambient/ambientFeedback";
import {
  getPilotSpeechRecognitionConstructor,
  PILOT_VOICE_PHASES,
  usePilotVoiceCapture
} from "../hooks/usePilotVoiceCapture";

// Flag-gated Pilot command bar for the quote builder
// (docs/POST_COMPETITIVE_DESIGN.md §4.6 and §4.11): the operator types or
// dictates a change in plain words, the same deterministic parser that
// reads client requests turns it into proposals, and every proposal shows
// its live preview delta BEFORE anything touches the draft. This preserves the
// preview-confirm contract. Applying stages draft edits only; saving
// remains the sole authority. Voice input is a progressive enhancement on
// the browser's own speech recognition and is absent when unsupported.
export const PILOT_COMMAND_MODEL = PILOT_DETERMINISTIC_COMMAND_MODEL;

// Same default-off gate as every other margin surface; costs are tenant
// catalog data and margin never renders in any customer-facing projection.
const PILOT_MARGINS_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_PILOT_MARGINS_ENABLED || "").trim().toLowerCase()
);

function scenarioStateTitle(state) {
  if (state === "available") return "Options found";
  if (state === "satisfied") return "This draft already meets the goal";
  if (state === "no_match") return "No option fits safely";
  return "Refresh this opportunity first";
}

function scenarioIntentLabel(intent) {
  if (intent?.kind === "under_budget") return `Under ${currency(intent.budget)}`;
  if (intent?.kind === "improve_margin" && intent.targetMarginPct !== null) {
    return `Improve margin to ${(intent.targetMarginPct * 100).toFixed(1)}%`;
  }
  if (intent?.kind === "improve_margin") return "Improve margin using recorded costs";
  return "Price exploration";
}

function previewBoundary(preview) {
  if (preview.proposals.length > 0) {
    return "Nothing is saved yet. Applying an option changes only this draft; QuotePilot recalculates the price when you save.";
  }
  if (preview.scenario) {
    return "This preview changes nothing. Open an available option for draft review when you are ready.";
  }
  if (preview.queries.length > 0) {
    return "This answer changes no draft, saved quote, or customer state.";
  }
  return "Nothing changed. Refine your request or discard this preview.";
}

function provenanceLabel(entry) {
  if (!entry || typeof entry !== "object") return "";
  return [
    entry.source,
    Number.isSafeInteger(entry.catalogRevision) ? `revision ${entry.catalogRevision}` : "",
    entry.freshness,
    entry.observedAtISO,
    entry.authority
  ].filter(Boolean).join(" | ");
}

function withoutScenarioClauses(clauses, scenarioIntent) {
  if (!scenarioIntent) return clauses;
  return clauses.filter((clause) => {
    if (parsePilotBoundedScenarioIntent(clause)) return false;
    const normalized = String(clause || "").trim().toLowerCase();
    if (scenarioIntent.kind === "under_budget") {
      if (/\b(?:under|below|within|budget)\b/u.test(normalized)) return false;
      // The shared change parser treats a thousands separator as a clause
      // break. Suppress only the resulting numeric continuation after the
      // complete command has already passed the strict scenario parser.
      if (/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return false;
    }
    if (scenarioIntent.kind === "improve_margin" && /\bmargin\b/u.test(normalized)) return false;
    return true;
  });
}

export default function PilotCommandBar({
  ambientEnabled = false,
  form,
  catalog,
  settings,
  styles = [],
  canViewStaffMargin = false,
  onStageProposal,
  scenarioOrganizationId = "",
  scenarioCatalogEvidence = null,
  scenarioStaffingEvidence = null,
  scenarioLockedScope = [],
  onHandoffScenarioToDraftReview,
  contextLabel = "",
  focusRequest = null,
  onFocusRequestResolution = null,
  voiceCaptureMode = "toggle"
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [appliedIds, setAppliedIds] = useState([]);
  const [handedOffScenarioIds, setHandedOffScenarioIds] = useState([]);
  const [scenarioHandoffStatus, setScenarioHandoffStatus] = useState(null);
  const [legacyVoiceListening, setLegacyVoiceListening] = useState(false);
  const commandRef = useRef(null);
  const inputRef = useRef(null);
  const textValueRef = useRef("");
  const legacyRecognitionRef = useRef(null);
  const suppressNextVoiceClickRef = useRef(false);
  const handledFocusRequestRef = useRef("");
  const focusResolutionRef = useRef(onFocusRequestResolution);
  const expandedCommandsEnabled = ambientEnabled === true;
  const holdVoiceEnabled = expandedCommandsEnabled && voiceCaptureMode === "hold";

  useEffect(() => {
    focusResolutionRef.current = onFocusRequestResolution;
  }, [onFocusRequestResolution]);

  useEffect(() => {
    const requestId = String(focusRequest?.id || "").trim();
    if (!requestId || handledFocusRequestRef.current === requestId) return undefined;
    handledFocusRequestRef.current = requestId;
    const focusInput = () => {
      const input = inputRef.current;
      if (!input || input.isConnected === false) {
        focusResolutionRef.current?.({
          requestId,
          status: "recovery",
          reason: "The contextual Pilot command field is not mounted."
        });
        return;
      }
      input.scrollIntoView?.({ block: "center", behavior: "smooth" });
      input.focus({ preventScroll: true });
      focusResolutionRef.current?.({
        requestId,
        status: typeof document === "undefined" || document.activeElement === input
          ? "focused"
          : "recovery",
        reason: typeof document === "undefined" || document.activeElement === input
          ? ""
          : "The contextual Pilot command field could not receive focus."
      });
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const frame = window.requestAnimationFrame(focusInput);
      return () => window.cancelAnimationFrame?.(frame);
    }
    const timer = setTimeout(focusInput, 0);
    return () => clearTimeout(timer);
  }, [focusRequest?.id]);

  const previewCommand = (commandText) => {
    const normalizedCommand = String(commandText || "").trim();
    if (!normalizedCommand) return;
    setAppliedIds([]);
    setHandedOffScenarioIds([]);
    setScenarioHandoffStatus(null);
    const commandContext = {
      form,
      catalog,
      settings,
      styles,
      allowPackageChanges: expandedCommandsEnabled,
      marginEnabled: PILOT_MARGINS_ENABLED,
      marginAuthorized: canViewStaffMargin === true
    };
    const commandPreview = expandedCommandsEnabled
      ? buildPilotCommandPreview(normalizedCommand, commandContext)
      : parseChangeRequest(normalizedCommand, commandContext);
    const scenarioIntent = expandedCommandsEnabled
      ? parsePilotBoundedScenarioIntent(normalizedCommand)
      : null;
    const scenario = scenarioIntent
      ? generatePilotBoundedScenarios({
          intent: scenarioIntent,
          organizationId: scenarioOrganizationId,
          form,
          catalogEvidence: scenarioCatalogEvidence,
          settings,
          staffingEvidence: scenarioStaffingEvidence,
          lockedScope: scenarioLockedScope,
          marginEnabled: PILOT_MARGINS_ENABLED,
          marginAuthorized: canViewStaffMargin === true
        })
      : null;
    setPreview({
      ...commandPreview,
      command: normalizedCommand,
      queries: Array.isArray(commandPreview.queries) ? commandPreview.queries : [],
      scenario,
      unparsedClauses: withoutScenarioClauses(commandPreview.unparsedClauses, scenarioIntent)
    });
  };

  const voice = usePilotVoiceCapture({
    onPreview: (transcript) => {
      const nextCommand = [
        String(textValueRef.current || "").trim(),
        String(transcript || "").trim()
      ]
        .filter(Boolean)
        .join(" ");
      textValueRef.current = nextCommand;
      setText(nextCommand);
      previewCommand(nextCommand);
      inputRef.current?.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    if (!holdVoiceEnabled) return undefined;
    let type = null;
    if (voice.phase === PILOT_VOICE_PHASES.PREVIEW_READY) {
      type = AMBIENT_FEEDBACK_TYPES.RECALCULATED;
    } else if ([
      PILOT_VOICE_PHASES.PERMISSION_BLOCKED,
      PILOT_VOICE_PHASES.SPEECH_UNAVAILABLE,
      PILOT_VOICE_PHASES.NO_MICROPHONE,
      PILOT_VOICE_PHASES.NETWORK_ERROR,
      PILOT_VOICE_PHASES.ERROR
    ].includes(voice.phase)) {
      type = AMBIENT_FEEDBACK_TYPES.WARNING;
    }
    if (!type) return undefined;
    const routed = routeAmbientFeedback({
      type,
      causalText: voice.presentation.status,
      objectId: "pilot-voice-capture"
    }, {
      element: commandRef.current,
      announcement: false,
      sound: false,
      haptics: false
    });
    return routed.cancelVisual;
  }, [holdVoiceEnabled, voice.phase, voice.presentation.status]);

  const beginVoiceCapture = () => {
    return voice.start();
  };

  const toggleLegacyVoice = () => {
    const Recognition = getPilotSpeechRecognitionConstructor();
    if (!Recognition) return;
    if (legacyVoiceListening) {
      legacyRecognitionRef.current?.stop();
      setLegacyVoiceListening(false);
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
      if (transcript) {
        setText((current) => {
          const next = current ? `${current} ${transcript}` : transcript;
          textValueRef.current = next;
          return next;
        });
      }
    };
    recognition.onend = () => setLegacyVoiceListening(false);
    recognition.onerror = () => setLegacyVoiceListening(false);
    legacyRecognitionRef.current = recognition;
    setLegacyVoiceListening(true);
    recognition.start();
  };

  const voiceSupported = holdVoiceEnabled
    ? voice.supported
    : Boolean(getPilotSpeechRecognitionConstructor());
  const voicePhase = holdVoiceEnabled
    ? voice.phase
    : legacyVoiceListening ? PILOT_VOICE_PHASES.LISTENING : PILOT_VOICE_PHASES.IDLE;

  useEffect(() => () => {
    const recognition = legacyRecognitionRef.current;
    legacyRecognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.abort?.();
    } catch {
      // The legacy flag-off control is leaving; browser cleanup is best effort.
    }
  }, []);

  const runPreview = () => previewCommand(text);
  const previewMatchesText = Boolean(preview && preview.command === text.trim());

  const clearPreview = () => {
    setPreview(null);
    setAppliedIds([]);
    setHandedOffScenarioIds([]);
    setScenarioHandoffStatus(null);
  };

  const apply = (proposal) => {
    if (appliedIds.includes(proposal.id)) return;
    const policy = classifyPilotDraftProposal(proposal);
    if (!policy.allowed) return;
    onStageProposal?.(proposal);
    setAppliedIds((prev) => [...prev, proposal.id]);
  };

  const handoffScenario = (proposal) => {
    if (
      typeof onHandoffScenarioToDraftReview !== "function"
      || handedOffScenarioIds.includes(proposal.id)
      || !Object.isFrozen(proposal)
    ) return;
    setScenarioHandoffStatus({
      proposalId: proposal.id,
      state: "pending",
      message: "Opening this option for review. Nothing has changed yet."
    });
    const resolveHandoff = (result) => {
      if (result?.ok === false) {
        const reason = String(result.acknowledgement?.reason || "This option could not be opened for review.").trim();
        const consequence = String(result.acknowledgement?.consequence || "Your draft is unchanged.").trim();
        const next = Array.isArray(result.acknowledgement?.nextResolutions)
          ? result.acknowledgement.nextResolutions.join(" ")
          : "Review the current draft, then run this option again.";
        setScenarioHandoffStatus({
          proposalId: proposal.id,
          state: "recovery",
          message: `${reason} ${consequence} ${next}`
        });
        return;
      }
      setHandedOffScenarioIds((current) => current.includes(proposal.id)
        ? current
        : [...current, proposal.id]);
      setScenarioHandoffStatus({
        proposalId: proposal.id,
        state: "receipt",
        message: "This option is open for review. It is not applied or saved."
      });
    };
    try {
      // This is an immutable review handoff only. The host decides how to open
      // its draft-review seam; Pilot does not apply, stage, or save the patch.
      const result = onHandoffScenarioToDraftReview(proposal);
      if (result && typeof result.then === "function") {
        result.then(resolveHandoff).catch((error) => {
          setScenarioHandoffStatus({
            proposalId: proposal.id,
            state: "recovery",
            message: `${String(error?.message || "This option could not be opened for review.").trim()} Your draft is unchanged. Run it again from the current draft.`
          });
        });
      } else {
        resolveHandoff(result);
      }
    } catch (error) {
      setScenarioHandoffStatus({
        proposalId: proposal.id,
        state: "recovery",
        message: `${String(error?.message || "This option could not be opened for review.").trim()} Your draft is unchanged. Run it again from the current draft.`
      });
    }
  };

  const impactLine = (proposal) => {
    if (appliedIds.includes(proposal.id)) return "Applied to this draft.";
    const impact = buildChangeImpact({ form, catalog, settings, proposal });
    if (!impact) return "";
    const sign = impact.delta > 0 ? "+" : impact.delta < 0 ? "−" : "±";
    const marginNote = PILOT_MARGINS_ENABLED && canViewStaffMargin === true && impact.marginDelta
      ? ` Margin ${(impact.marginDelta.beforePct * 100).toFixed(1)}% → ${(impact.marginDelta.afterPct * 100).toFixed(1)}%.`
      : "";
    return `${sign}${currency(Math.abs(impact.delta))} total (preview includes fee and tax changes).${marginNote}`;
  };

  return (
    <section
      ref={commandRef}
      className="pilot-command"
      aria-label="Pilot command bar"
      data-pilot-command={expandedCommandsEnabled ? PILOT_COMMAND_MODEL : CHANGE_REQUEST_PARSE_MODEL}
      data-pilot-expanded={expandedCommandsEnabled ? "true" : "false"}
      data-pilot-voice-mode={holdVoiceEnabled ? "hold" : "toggle"}
      data-pilot-voice-state={voiceSupported ? voicePhase : "unsupported"}
    >
      {String(contextLabel || "").trim() && (
        <header className="pilot-command-context">
          <span>Current draft</span>
          <strong>{String(contextLabel).trim()}</strong>
          <small>Describe a change or ask for an explanation.</small>
        </header>
      )}
      <div className="pilot-command-row">
        <input
          ref={inputRef}
          type="text"
          className="pilot-command-input"
          value={text}
          placeholder='Ask Pilot to change or explain this draft: "add another bartender", "get this under $8,000", or "explain this price"'
          aria-label="Command for this draft"
          onChange={(event) => {
            textValueRef.current = event.target.value;
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") runPreview();
          }}
        />
        {voiceSupported && (
          <button
            type="button"
            className={`ghost compact${holdVoiceEnabled ? " pilot-command-voice" : ""}${voicePhase === PILOT_VOICE_PHASES.LISTENING ? " is-listening" : ""}`}
            onPointerDown={holdVoiceEnabled ? (event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              beginVoiceCapture();
            } : undefined}
            onPointerUp={holdVoiceEnabled ? (event) => {
              if (event.button !== 0) return;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              voice.stop();
            } : undefined}
            onPointerCancel={holdVoiceEnabled ? (event) => {
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              voice.cancel();
            } : undefined}
            onKeyDown={holdVoiceEnabled ? (event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                voice.cancel();
                return;
              }
              if (!["Enter", " "].includes(event.key)) return;
              event.preventDefault();
              if (!event.repeat) beginVoiceCapture();
            } : undefined}
            onKeyUp={holdVoiceEnabled ? (event) => {
              if (!["Enter", " "].includes(event.key)) return;
              event.preventDefault();
              suppressNextVoiceClickRef.current = true;
              voice.stop();
            } : undefined}
            onClick={(event) => {
              if (!holdVoiceEnabled) {
                toggleLegacyVoice();
                return;
              }
              if (suppressNextVoiceClickRef.current) {
                suppressNextVoiceClickRef.current = false;
                return;
              }
              // Pointer release already completed the press-and-hold action.
              // Detail-zero activation keeps a click-only assistive fallback.
              if (event.detail > 0) return;
              voice.toggle();
            }}
            aria-pressed={voicePhase === PILOT_VOICE_PHASES.LISTENING}
            aria-describedby={holdVoiceEnabled ? "pilot-command-voice-status" : undefined}
          >
            {holdVoiceEnabled && (
              <Microphone className="pilot-command-voice-mark" size={18} weight="duotone" aria-hidden="true" />
            )}
            <span>
              {holdVoiceEnabled
                ? voice.presentation.buttonLabel
                : legacyVoiceListening ? "Listening…" : "Speak"}
            </span>
          </button>
        )}
        <button
          type="button"
          className={previewMatchesText ? "ghost" : "cta"}
          onClick={runPreview}
          disabled={!text.trim()}
        >
          {previewMatchesText ? "Refresh preview" : "Preview"}
        </button>
      </div>
      {holdVoiceEnabled && voice.supported && (
        <p
          id="pilot-command-voice-status"
          className="pilot-command-voice-status"
          role={[
            PILOT_VOICE_PHASES.PERMISSION_BLOCKED,
            PILOT_VOICE_PHASES.SPEECH_UNAVAILABLE,
            PILOT_VOICE_PHASES.NO_MICROPHONE,
            PILOT_VOICE_PHASES.NETWORK_ERROR,
            PILOT_VOICE_PHASES.ERROR
          ].includes(voice.phase) ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          {voice.presentation.status}
        </p>
      )}

      {preview && (
        <div className="pilot-command-preview" aria-live="polite">
          {preview.scenario && (
            <article
              className="pilot-command-scenario"
              data-pilot-command-class="simulation"
              data-pilot-scenario-model={preview.scenario.modelId}
              data-pilot-scenario-state={preview.scenario.state}
            >
              <header className="pilot-command-scenario-header">
                <span className="pilot-command-scenario-kicker">Pilot options</span>
                <div>
                  <h4>{scenarioStateTitle(preview.scenario.state)}</h4>
                  <p>{scenarioIntentLabel(preview.scenario.intent)}</p>
                </div>
              </header>

              {preview.scenario.baseline?.clientPreview && (
                <dl className="pilot-command-scenario-baseline" aria-label="Current client preview">
                  <div>
                    <dt>Current total</dt>
                    <dd>{currency(preview.scenario.baseline.clientPreview.total)}</dd>
                  </div>
                  <div>
                    <dt>Current deposit</dt>
                    <dd>{currency(preview.scenario.baseline.clientPreview.deposit)}</dd>
                  </div>
                </dl>
              )}

              {preview.scenario.proposals.map((proposal) => {
                const handedOff = handedOffScenarioIds.includes(proposal.id);
                const handoffPending = scenarioHandoffStatus?.proposalId === proposal.id
                  && scenarioHandoffStatus.state === "pending";
                const canShowMargin = PILOT_MARGINS_ENABLED
                  && canViewStaffMargin === true
                  && proposal.marginEvidence?.before?.available === true
                  && proposal.marginEvidence?.after?.available === true;
                return (
                  <section
                    key={proposal.id}
                    className="pilot-command-scenario-proposal"
                    data-pilot-scenario-proposal={proposal.id}
                  >
                    <header>
                      <h5>{proposal.title}</h5>
                      <p>{proposal.summary}</p>
                    </header>

                    <dl className="pilot-command-scenario-preview" aria-label="Before and after client preview">
                      <div>
                        <dt>Current preview</dt>
                        <dd>{currency(proposal.clientPreview.before.total)}</dd>
                        <small>Deposit {currency(proposal.clientPreview.before.deposit)}</small>
                      </div>
                      <div>
                        <dt>Scenario preview</dt>
                        <dd>{currency(proposal.clientPreview.after.total)}</dd>
                        <small>Deposit {currency(proposal.clientPreview.after.deposit)}</small>
                      </div>
                      {canShowMargin && (
                        <div>
                          <dt>Recorded-cost margin</dt>
                          <dd>
                            {(proposal.marginEvidence.before.marginPct * 100).toFixed(1)}%
                            {" → "}
                            {(proposal.marginEvidence.after.marginPct * 100).toFixed(1)}%
                          </dd>
                          <small>{proposal.marginEvidence.deltaPercentagePoints.toFixed(2)} percentage points</small>
                        </div>
                      )}
                    </dl>

                    <div className="pilot-command-scenario-compromises">
                      <strong>What changes in this option</strong>
                      <ul>
                        {proposal.compromises.map((compromise, index) => (
                          <li key={`${proposal.id}:${compromise.dimension}:${index}`}>
                            <span>{compromise.before} → {compromise.after}</span>
                            <small>{compromise.why}</small>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pilot-command-scenario-judgment">
                      <p><strong>Why this option</strong>{proposal.why}</p>
                      <p><strong>What this affects</strong>{proposal.consequence}</p>
                      <p><strong>If you do nothing</strong>{proposal.doNothing}</p>
                    </div>

                    <div className="pilot-command-scenario-evidence">
                      <p><strong>Confidence: {proposal.confidence.level}</strong>{proposal.confidence.basis}</p>
                      <ul aria-label="Sources behind this option">
                        {proposal.provenance.map((entry, index) => (
                          <li key={`${proposal.id}:provenance:${index}`}>{provenanceLabel(entry)}</li>
                        ))}
                      </ul>
                      {proposal.unavailableReasons.map((reason) => <p key={reason}>{reason}</p>)}
                      <p>{proposal.boundary}</p>
                      <p>{proposal.adoption.boundary}</p>
                    </div>

                    {typeof onHandoffScenarioToDraftReview === "function" && (
                      <button
                        type="button"
                        className="cta compact pilot-command-scenario-adopt"
                        onClick={() => handoffScenario(proposal)}
                        disabled={handedOff || handoffPending || proposal.adoption.allowedAfterExplicitConfirmation !== true}
                        aria-label={`${proposal.adoption.outcomeLabel}: ${proposal.title}`}
                      >
                        {handedOff ? "Handed to draft review" : handoffPending ? "Opening draft review…" : "Adopt in draft review"}
                      </button>
                    )}
                    {scenarioHandoffStatus?.proposalId === proposal.id && (
                      <p
                        className={`pilot-command-scenario-handoff-status is-${scenarioHandoffStatus.state}`}
                        role={scenarioHandoffStatus.state === "recovery" ? "alert" : "status"}
                      >
                        {scenarioHandoffStatus.message}
                      </p>
                    )}
                  </section>
                );
              })}

              {preview.scenario.proposals.length > 0
                && typeof onHandoffScenarioToDraftReview !== "function" && (
                <p className="pilot-command-scenario-handoff-unavailable">
                  This option cannot be opened for draft review here. Nothing has changed; run it again from the current quote when review is available.
                </p>
              )}

              {preview.scenario.unavailableReasons.length > 0 && (
                <ul className="pilot-command-scenario-reasons" aria-label="Scenario limits and recovery">
                  {preview.scenario.unavailableReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}

              <div className="pilot-command-scenario-judgment is-result">
                <p><strong>Why</strong>{preview.scenario.why}</p>
                <p><strong>What this affects</strong>{preview.scenario.consequence}</p>
                <p><strong>If you do nothing</strong>{preview.scenario.doNothing}</p>
              </div>

              <footer className="pilot-command-scenario-footer">
                <p><strong>Confidence: {preview.scenario.confidence.level}</strong>{preview.scenario.confidence.basis}</p>
                {preview.scenario.provenance.length > 0 && (
                  <ul aria-label="Sources behind these options">
                    {preview.scenario.provenance.map((entry, index) => (
                      <li key={`scenario-provenance:${index}`}>{provenanceLabel(entry)}</li>
                    ))}
                  </ul>
                )}
                {preview.scenario.state !== "unavailable" && (
                  <p>
                    Checked {preview.scenario.bounds.candidatesEvaluated} supported options for this quote;
                    {preview.scenario.bounds.truncated ? " showing results within the current limit." : " all supported options in this search are shown."}
                  </p>
                )}
                <p>{preview.scenario.boundary}</p>
                <p>{preview.scenario.adoption.boundary}</p>
              </footer>
            </article>
          )}
          {preview.queries.map((query, index) => (
            <article
              key={`${query.id}:${index}`}
              className="pilot-command-query"
              data-pilot-command-class={query.commandClass}
              data-pilot-query-kind={query.kind}
              data-pilot-query-state={query.state}
            >
              <header>
                <span className="pilot-command-query-kicker">Pilot answer</span>
                <h4>{query.title}</h4>
                <p>{query.summary}</p>
              </header>
              {query.facts.length > 0 && (
                <dl className="pilot-command-query-facts">
                  {query.facts.map((fact, factIndex) => (
                    <div key={`${fact.label}:${factIndex}`}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                      {fact.detail && <small>{fact.detail}</small>}
                    </div>
                  ))}
                </dl>
              )}
              <div className="pilot-command-query-judgment">
                <p><strong>What this affects</strong>{query.consequence}</p>
                <p><strong>If you do nothing</strong>{query.doNothing}</p>
              </div>
              <footer>
                <span>{query.confidence}</span>
                <span>{query.provenance}</span>
                <span>{query.boundary}</span>
              </footer>
            </article>
          ))}
          {preview.proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="pilot-command-proposal"
              data-pilot-command-class={classifyPilotDraftProposal(proposal).commandClass}
              data-pilot-command-executable={classifyPilotDraftProposal(proposal).allowed ? "true" : "false"}
            >
              <div>
                <strong>{proposal.title}</strong>
                <small>{impactLine(proposal)}</small>
              </div>
              <button
                type="button"
                className="cta compact"
                onClick={() => apply(proposal)}
                disabled={appliedIds.includes(proposal.id) || !classifyPilotDraftProposal(proposal).allowed}
              >
                {appliedIds.includes(proposal.id) ? "Applied to draft" : "Apply to draft"}
              </button>
            </div>
          ))}
          {preview.ambiguities.map((ambiguity) => (
            <p key={ambiguity.id} className="source-note">
              “{ambiguity.clause}” matches more than one catalog item. Say which one you mean.
            </p>
          ))}
          {preview.unparsedClauses.map((clause) => (
            <p key={clause} className="source-note">“{clause}”: nothing was read from this; the draft is unchanged.</p>
          ))}
          {!preview.scenario && preview.proposals.length === 0 && preview.queries.length === 0 && preview.ambiguities.length === 0
            && preview.unparsedClauses.length === 0 && (
            <p className="source-note">Nothing was read from that; the draft is unchanged.</p>
          )}
          <div className="pilot-command-actions">
            <button type="button" className="ghost compact" onClick={clearPreview}>Discard preview</button>
            <small>{previewBoundary(preview)}</small>
          </div>
        </div>
      )}
    </section>
  );
}
