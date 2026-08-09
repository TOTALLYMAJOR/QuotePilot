// Subtle synthesized chime for shimmer reveals. No audio assets; everything is
// generated with the Web Audio API so the payload cost is zero and the timbre
// can follow the reveal tone (positive / negative / neutral net-cash effect).
//
// Autoplay policy: contexts only produce sound after the page has sticky user
// activation. Reveals are always downstream of a staff click, so resume()
// normally succeeds; when it does not, we fail silent — sound is garnish here.

let sharedContext = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext || sharedContext.state === "closed") {
    try {
      sharedContext = new Ctor();
    } catch {
      sharedContext = null;
    }
  }
  return sharedContext;
}

const TONE_PROFILES = Object.freeze({
  // Ascending glassy third→fifth: reads as "value went up".
  positive: { notes: [659.25, 987.77], tilt: 1, brightness: 2600 },
  // Descending, slightly darker: reads as "value went down" without alarm.
  negative: { notes: [493.88, 369.99], tilt: -1, brightness: 1900 },
  // Single soft tick for a neutral delta.
  neutral: { notes: [880], tilt: 0, brightness: 2200 }
});

function scheduleGrain(context, destination, frequency, at, peak, duration, detune = 0) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, at);
  if (detune) oscillator.detune.setValueAtTime(detune, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(at);
  oscillator.stop(at + duration + 0.05);
}

// Plays a ~0.5s chime: two soft primary notes plus a scatter of tiny detuned
// grains that mirror the visual particle field. Peak gain stays under ~0.05 so
// the cue registers without startling anyone. Returns true if scheduling was
// attempted, false when audio is unavailable or blocked.
export function playShimmerChime(tone = "neutral", { random = Math.random } = {}) {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") {
      // Fire-and-forget; if the browser refuses, nothing is scheduled audibly.
      context.resume().catch(() => {});
    }
    if (context.state === "closed") return false;

    const profile = TONE_PROFILES[tone] || TONE_PROFILES.neutral;
    const master = context.createGain();
    master.gain.setValueAtTime(1, context.currentTime);
    const softener = context.createBiquadFilter();
    softener.type = "lowpass";
    softener.frequency.setValueAtTime(profile.brightness, context.currentTime);
    master.connect(softener);
    softener.connect(context.destination);

    const start = context.currentTime + 0.02;
    profile.notes.forEach((frequency, index) => {
      scheduleGrain(context, master, frequency, start + index * 0.09, 0.042, 0.34);
    });

    // Particle shimmer: eight whisper-level grains scattered across ~0.28s,
    // drifting up or down with the tone's tilt.
    const base = profile.notes[profile.notes.length - 1];
    for (let i = 0; i < 8; i += 1) {
      scheduleGrain(
        context,
        master,
        base * (1.5 + random() * 0.75) * (profile.tilt < 0 ? 0.5 : 1),
        start + 0.05 + random() * 0.23,
        0.008 + random() * 0.007,
        0.12 + random() * 0.1,
        (random() - 0.5) * 40 * (profile.tilt || 1)
      );
    }
    return true;
  } catch {
    return false;
  }
}

function withContext(run) {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    if (context.state === "closed") return false;
    run(context);
    return true;
  } catch {
    return false;
  }
}

// Soft UI tick for micro-interactions (selections, count changes). Two quick
// grains a fifth apart read as a "click-chirp" that survives normal room
// noise while staying well under notification-sound loudness.
export function playTick() {
  return withContext((context) => {
    const at = context.currentTime + 0.01;
    scheduleGrain(context, context.destination, 1318.5, at, 0.034, 0.1);
    scheduleGrain(context, context.destination, 1975.5, at + 0.035, 0.02, 0.08);
  });
}

// Low, weighty "seal" for commitment moments (acceptance, payment confirmed):
// a soft thud with a mid tap riding on top.
export function playSeal() {
  return withContext((context) => {
    const at = context.currentTime + 0.02;
    scheduleGrain(context, context.destination, 98, at, 0.05, 0.28);
    scheduleGrain(context, context.destination, 196, at + 0.03, 0.028, 0.18);
    scheduleGrain(context, context.destination, 587.33, at + 0.06, 0.012, 0.12);
  });
}
