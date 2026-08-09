import { useEffect, useRef, useState } from "react";
import "./digitRoll.css";

// DigitRoll renders a formatted currency string (e.g. "$1,024.00") and, when
// the value changes, rolls each CHANGED digit vertically like an odometer.
// Non-digit characters (currency symbol, commas, periods) stay static.
//
// Design notes:
// - At rest (and on SSR / static renders) the component is just the plain
//   formatted string — no odometer machinery in the DOM. Strips exist only
//   for the duration of a roll and unmount afterwards (one-shot cleanup).
// - During a roll an invisible "ghost" copy of the text keeps layout stable
//   while an absolutely positioned per-character track animates on top.
// - Digits are diffed right-aligned so digit-count changes ($999 -> $1,024)
//   pair the cents/decimals correctly; brand-new digit positions roll in
//   from a blank slot.
// - Roll direction follows the overall value change (increase rolls up,
//   decrease rolls down), staggered a few ms per digit right-to-left.
// - Animates transform only; durations come from the --motion-base token.
// - Reduced motion: no roll is scheduled at all — the text just snaps.
// - Intentionally silent: repricing is too frequent for audio cues.

const BLANK_GLYPH = "\u00a0"; // NBSP keeps the blank slot one line-box tall
const DEFAULT_STAGGER_MS = 20;
const FALLBACK_ROLL_MS = 240; // mirrors --motion-base
const SETTLE_BUFFER_MS = 160;

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readMotionBaseMs() {
  if (
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function" ||
    typeof document === "undefined" ||
    !document.documentElement
  ) {
    return FALLBACK_ROLL_MS;
  }
  try {
    const raw = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-base")
      .trim();
    let ms = NaN;
    if (raw.endsWith("ms")) ms = parseFloat(raw);
    else if (raw.endsWith("s")) ms = parseFloat(raw) * 1000;
    return Number.isFinite(ms) && ms >= 0 ? ms : FALLBACK_ROLL_MS;
  } catch {
    return FALLBACK_ROLL_MS;
  }
}

// Pure digit-splitting helper: breaks a formatted value into per-character
// entries, classifying which ones are rollable digits.
export function splitFormattedValue(text) {
  return String(text ?? "")
    .split("")
    .map((char) => ({
      char,
      isDigit: char >= "0" && char <= "9"
    }));
}

// Pure helper: best-effort numeric reading of a formatted currency string so
// the roll direction can follow the overall value change.
export function numericValueOfFormatted(text) {
  const cleaned = String(text ?? "").replace(/[^0-9.]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Pure helper: right-aligned diff of two formatted strings into render cells.
// Each cell: { key, char, isDigit, changed, delayMs, glyphs, from, to }.
// `glyphs` is the 2-slot vertical strip for a changed digit; `from`/`to` are
// the strip positions (0 = first glyph visible, 1 = second glyph visible).
export function buildRollPlan(previousText, nextText, staggerMs = DEFAULT_STAGGER_MS) {
  const next = splitFormattedValue(nextText);
  const prev = splitFormattedValue(previousText);
  const offset = next.length - prev.length;
  const direction = numericValueOfFormatted(nextText) >= numericValueOfFormatted(previousText)
    ? "up"
    : "down";

  const cells = next.map((entry, index) => {
    // Right-aligned pairing so cents/decimals line up when digits are added
    // or removed on the left (e.g. "$999.00" -> "$1,024.00").
    const prevEntry = prev[index - offset] || null;
    const prevDigit = prevEntry && prevEntry.isDigit ? prevEntry.char : null;
    const changed = entry.isDigit && prevDigit !== entry.char;
    const cell = {
      key: `c${next.length - 1 - index}`, // identity anchored from the right
      char: entry.char,
      isDigit: entry.isDigit,
      changed,
      delayMs: 0,
      glyphs: null,
      from: 0,
      to: 0
    };
    if (changed) {
      const fromGlyph = prevDigit === null ? BLANK_GLYPH : prevDigit;
      if (direction === "down") {
        cell.glyphs = [entry.char, fromGlyph];
        cell.from = 1;
        cell.to = 0;
      } else {
        cell.glyphs = [fromGlyph, entry.char];
        cell.from = 0;
        cell.to = 1;
      }
    }
    return cell;
  });

  // Stagger changed digits right-to-left: rightmost rolls first.
  let order = 0;
  let maxDelayMs = 0;
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    if (cells[i].changed) {
      cells[i].delayMs = order * Math.max(0, staggerMs);
      maxDelayMs = Math.max(maxDelayMs, cells[i].delayMs);
      order += 1;
    }
  }

  return { cells, direction, changedCount: order, maxDelayMs };
}

export default function DigitRoll({ value, className = "" }) {
  const text = String(value ?? "");
  const [roll, setRoll] = useState(null); // null = resting plain text
  const prevTextRef = useRef(text);
  const rollIdRef = useRef(0);

  useEffect(() => {
    const previousText = prevTextRef.current;
    if (text === previousText) return undefined;
    prevTextRef.current = text;

    // Reduced motion: skip all JS-driven animation work and snap.
    if (prefersReducedMotion()) {
      setRoll(null);
      return undefined;
    }

    const plan = buildRollPlan(previousText, text);
    if (!plan.changedCount) {
      setRoll(null);
      return undefined;
    }

    rollIdRef.current += 1;
    const rollId = rollIdRef.current;
    setRoll({ id: rollId, cells: plan.cells, direction: plan.direction, engaged: false });

    // Two-phase: paint strips at their "from" position, then engage the
    // transition on the next frame so CSS animates from -> to.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setRoll((current) => (current && current.id === rollId ? { ...current, engaged: true } : current));
      });
    });

    // One-shot cleanup: once the roll (plus stagger) finishes, unmount the
    // strips so the resting DOM is the plain formatted string again.
    const settleTimer = setTimeout(() => {
      setRoll((current) => (current && current.id === rollId ? null : current));
    }, readMotionBaseMs() + plan.maxDelayMs + SETTLE_BUFFER_MS);

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      clearTimeout(settleTimer);
    };
  }, [text]);

  const baseClass = `digit-roll ${className}`.trim();

  if (!roll) {
    // SSR / static renders and resting state: just the formatted string.
    return (
      <span className={baseClass} data-digit-roll="static">
        {text}
      </span>
    );
  }

  return (
    <span
      className={`${baseClass} digit-roll-rolling`}
      data-digit-roll="rolling"
      data-direction={roll.direction}
    >
      <span className="digit-roll-sr">{text}</span>
      <span className="digit-roll-ghost" aria-hidden="true">
        {text}
      </span>
      <span className="digit-roll-track" aria-hidden="true">
        {roll.cells.map((cell) =>
          cell.changed ? (
            <span
              key={cell.key}
              className="digit-roll-cell digit-roll-cell-roll"
              style={{ "--dr-delay": `${cell.delayMs}ms` }}
            >
              <span
                className="digit-roll-strip"
                style={{ "--dr-pos": roll.engaged ? cell.to : cell.from }}
              >
                {cell.glyphs.map((glyph, glyphIndex) => (
                  <span key={glyphIndex} className="digit-roll-glyph">
                    {glyph}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span key={cell.key} className="digit-roll-cell">
              {cell.char}
            </span>
          )
        )}
      </span>
    </span>
  );
}
