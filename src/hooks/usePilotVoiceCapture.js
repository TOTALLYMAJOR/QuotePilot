import { useCallback, useEffect, useRef, useState } from "react";

export const PILOT_VOICE_PHASES = Object.freeze({
  IDLE: "idle",
  REQUESTING: "requesting",
  LISTENING: "listening",
  PREPARING: "preparing",
  CAPTURED_WAITING_RELEASE: "captured_waiting_release",
  PREVIEW_READY: "preview_ready",
  NO_SPEECH: "no_speech",
  PERMISSION_BLOCKED: "permission_blocked",
  SPEECH_UNAVAILABLE: "speech_unavailable",
  NO_MICROPHONE: "no_microphone",
  NETWORK_ERROR: "network_error",
  CANCELED: "canceled",
  ERROR: "error"
});

const VOICE_PRESENTATION = Object.freeze({
  idle: Object.freeze({
    buttonLabel: "Hold to speak",
    status: "Hold while you speak. Release to preview."
  }),
  requesting: Object.freeze({
    buttonLabel: "Waiting for microphone…",
    status: "Waiting for microphone access. Release when you are done; nothing changes without a preview."
  }),
  listening: Object.freeze({
    buttonLabel: "Release to preview",
    status: "Listening while you hold. Release to preview."
  }),
  preparing: Object.freeze({
    buttonLabel: "Preparing preview…",
    status: "Preparing your preview. Nothing has changed."
  }),
  captured_waiting_release: Object.freeze({
    buttonLabel: "Release to preview",
    status: "Voice captured. Release to preview; nothing has changed."
  }),
  preview_ready: Object.freeze({
    buttonLabel: "Hold to speak again",
    status: "Voice captured. Review before applying."
  }),
  no_speech: Object.freeze({
    buttonLabel: "Hold to try again",
    status: "No words were captured. Hold to try again or type your request."
  }),
  permission_blocked: Object.freeze({
    buttonLabel: "Try voice again",
    status: "Microphone access is blocked. Allow it in your browser or type your request."
  }),
  speech_unavailable: Object.freeze({
    buttonLabel: "Try voice again",
    status: "Speech input is unavailable here. Type your request instead."
  }),
  no_microphone: Object.freeze({
    buttonLabel: "Try voice again",
    status: "No usable microphone was found. Check your device or type your request."
  }),
  network_error: Object.freeze({
    buttonLabel: "Try voice again",
    status: "The speech service could not be reached. Your draft is unchanged; try again or type your request."
  }),
  canceled: Object.freeze({
    buttonLabel: "Hold to speak",
    status: "Voice capture canceled. Your draft is unchanged."
  }),
  error: Object.freeze({
    buttonLabel: "Try voice again",
    status: "Voice capture could not finish. Try again or type your request."
  })
});

export function getPilotSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function joinedTranscript(results) {
  if (!results) return "";
  return Array.from(results)
    .map((result) => result?.[0]?.transcript || "")
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function errorPhase(errorName) {
  const normalized = String(errorName || "").trim().toLowerCase();
  if (normalized === "not-allowed") return PILOT_VOICE_PHASES.PERMISSION_BLOCKED;
  if (["service-not-allowed", "language-not-supported"].includes(normalized)) {
    return PILOT_VOICE_PHASES.SPEECH_UNAVAILABLE;
  }
  if (normalized === "audio-capture") return PILOT_VOICE_PHASES.NO_MICROPHONE;
  if (normalized === "network") return PILOT_VOICE_PHASES.NETWORK_ERROR;
  if (["no-speech", "nomatch"].includes(normalized)) return PILOT_VOICE_PHASES.NO_SPEECH;
  if (normalized === "aborted") return PILOT_VOICE_PHASES.CANCELED;
  return PILOT_VOICE_PHASES.ERROR;
}

export function pilotVoicePresentation(phase) {
  return VOICE_PRESENTATION[phase] || VOICE_PRESENTATION.idle;
}

export function usePilotVoiceCapture({ onPreview }) {
  const [phase, setPhase] = useState(PILOT_VOICE_PHASES.IDLE);
  const activeCaptureRef = useRef(null);
  const captureSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const previewRef = useRef(onPreview);
  const supported = Boolean(getPilotSpeechRecognitionConstructor());

  useEffect(() => {
    previewRef.current = onPreview;
  }, [onPreview]);

  const clearTimers = useCallback((capture) => {
    if (capture?.fallbackTimer) {
      clearTimeout(capture.fallbackTimer);
      capture.fallbackTimer = null;
    }
    if (capture?.safetyTimer) {
      clearTimeout(capture.safetyTimer);
      capture.safetyTimer = null;
    }
  }, []);

  const finish = useCallback((capture) => {
    if (!capture || capture.settled || activeCaptureRef.current?.id !== capture.id) return;
    capture.settled = true;
    clearTimers(capture);
    activeCaptureRef.current = null;
    if (capture.canceled || !mountedRef.current) return;
    const transcript = String(capture.transcript || "").replace(/\s+/gu, " ").trim();
    if (!transcript) {
      setPhase(PILOT_VOICE_PHASES.NO_SPEECH);
      return;
    }
    setPhase(PILOT_VOICE_PHASES.PREVIEW_READY);
    previewRef.current?.(transcript);
  }, [clearTimers]);

  const cancel = useCallback(() => {
    const capture = activeCaptureRef.current;
    if (!capture || capture.settled) return false;
    capture.canceled = true;
    capture.settled = true;
    clearTimers(capture);
    activeCaptureRef.current = null;
    try {
      capture.recognition.abort?.();
    } catch {
      // The capture is already canceled locally; browser cleanup is best effort.
    }
    if (mountedRef.current) setPhase(PILOT_VOICE_PHASES.CANCELED);
    return true;
  }, [clearTimers]);

  const requestRecognitionStop = useCallback((capture) => {
    if (!capture || capture.settled || capture.stopRequested) return false;
    capture.stopRequested = true;
    capture.fallbackTimer = setTimeout(() => {
      finish(capture);
      try {
        capture.recognition.abort?.();
      } catch {
        // The local fallback already ended the UI capture safely.
      }
    }, 1500);
    try {
      capture.recognition.stop();
      return true;
    } catch {
      finish(capture);
      return false;
    }
  }, [finish]);

  const start = useCallback(() => {
    if (activeCaptureRef.current && !activeCaptureRef.current.settled) return false;
    const Recognition = getPilotSpeechRecognitionConstructor();
    if (!Recognition) return false;

    captureSequenceRef.current += 1;
    const recognition = new Recognition();
    const capture = {
      id: captureSequenceRef.current,
      recognition,
      transcript: "",
      started: false,
      ended: false,
      released: false,
      stopRequested: false,
      canceled: false,
      settled: false,
      fallbackTimer: null,
      safetyTimer: null
    };
    activeCaptureRef.current = capture;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (activeCaptureRef.current?.id !== capture.id || capture.settled) return;
      capture.transcript = joinedTranscript(event?.results).slice(0, 1000);
    };
    recognition.onerror = (event) => {
      if (activeCaptureRef.current?.id !== capture.id || capture.settled) return;
      capture.settled = true;
      clearTimers(capture);
      activeCaptureRef.current = null;
      if (mountedRef.current) setPhase(errorPhase(event?.error));
    };
    recognition.onnomatch = () => {
      if (activeCaptureRef.current?.id !== capture.id || capture.settled) return;
      capture.settled = true;
      clearTimers(capture);
      activeCaptureRef.current = null;
      if (mountedRef.current) setPhase(PILOT_VOICE_PHASES.NO_SPEECH);
    };
    recognition.onend = () => {
      if (activeCaptureRef.current?.id !== capture.id || capture.settled) return;
      capture.ended = true;
      if (!capture.released) {
        clearTimers(capture);
        setPhase(PILOT_VOICE_PHASES.CAPTURED_WAITING_RELEASE);
        return;
      }
      finish(capture);
    };
    recognition.onstart = () => {
      if (activeCaptureRef.current?.id !== capture.id || capture.settled) return;
      capture.started = true;
      if (capture.released) {
        setPhase(PILOT_VOICE_PHASES.PREPARING);
        requestRecognitionStop(capture);
        return;
      }
      setPhase(PILOT_VOICE_PHASES.LISTENING);
    };

    // This state change is synchronous with the user's intent, so a slow
    // permission prompt or speech service never looks like a dead click.
    setPhase(PILOT_VOICE_PHASES.REQUESTING);
    capture.safetyTimer = setTimeout(() => {
      if (activeCaptureRef.current?.id !== capture.id || capture.settled) return;
      capture.canceled = true;
      capture.settled = true;
      clearTimers(capture);
      activeCaptureRef.current = null;
      try {
        recognition.abort?.();
      } catch {
        // The local timeout receipt is authoritative for this UI capture.
      }
      if (mountedRef.current) setPhase(PILOT_VOICE_PHASES.ERROR);
    }, 30000);
    try {
      recognition.start();
      return true;
    } catch {
      capture.settled = true;
      clearTimers(capture);
      activeCaptureRef.current = null;
      if (mountedRef.current) setPhase(PILOT_VOICE_PHASES.ERROR);
      return false;
    }
  }, [clearTimers, requestRecognitionStop]);

  const stop = useCallback(() => {
    const capture = activeCaptureRef.current;
    if (!capture || capture.settled || capture.released) return false;
    capture.released = true;
    setPhase(PILOT_VOICE_PHASES.PREPARING);
    if (capture.ended) {
      finish(capture);
      return true;
    }
    // If the permission prompt is still open, `stop()` is not legal yet.
    // Record the release and stop immediately when the browser confirms start.
    if (!capture.started) return true;
    return requestRecognitionStop(capture);
  }, [requestRecognitionStop]);

  const toggle = useCallback(() => {
    const capture = activeCaptureRef.current;
    return capture && !capture.settled ? stop() : start();
  }, [start, stop]);

  useEffect(() => {
    const cancelWhenContextLeaves = () => {
      // A browser microphone permission prompt may temporarily move window
      // focus before recognition starts. Do not cancel that request; once
      // capture has started, leaving the window discards it safely.
      if (activeCaptureRef.current?.started) cancel();
    };
    const cancelWhenHidden = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    window.addEventListener("blur", cancelWhenContextLeaves);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancelWhenContextLeaves);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
    };
  }, [cancel, phase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const capture = activeCaptureRef.current;
      if (!capture || capture.settled) return;
      capture.canceled = true;
      capture.settled = true;
      clearTimers(capture);
      try {
        capture.recognition.abort?.();
      } catch {
        // The component is gone; browser cleanup is best effort.
      }
      activeCaptureRef.current = null;
    };
  }, [clearTimers]);

  return Object.freeze({
    supported,
    phase,
    presentation: pilotVoicePresentation(phase),
    listening: phase === PILOT_VOICE_PHASES.LISTENING,
    pending: phase === PILOT_VOICE_PHASES.PREPARING,
    start,
    stop,
    cancel,
    toggle
  });
}
