# Conversation Arrival Accessibility Acceptance Matrix

Last updated: 2026-08-28 03:22:25 CDT

## Purpose

Define the proof required for the exact Living Opportunity-to-Conversation
arrival without converting automated checks into a claim of manual assistive-
technology or human acceptance. This matrix applies only to the quote-scoped
Conversation handoff and its connected Messaging Station destination.

## Evidence Classes

| Evidence class | Meaning | Not sufficient for |
|---|---|---|
| Source contract | Code and tests define the expected focus, state, and semantic identity | Runtime behavior |
| Local automated | Vitest, Playwright, axe, keyboard, or reflow proxy passes in this checkout | Manual screen-reader, hosted, production, or human acceptance |
| Local connected | The Firebase emulator exercises authenticated reads and exact quote data | Hosted authentication, production latency/data, or provider outcomes |
| Manual assistive technology | A named browser and assistive technology complete the scenario | Other AT/browser combinations or human product comprehension |
| Human acceptance | A representative user completes and understands the journey | Production/provider correctness |

## Exact Conversation Matrix

| AC ID | User-visible outcome | Current evidence | Status | Open stronger gate |
|---|---|---|---|---|
| CA-A11Y-001 | **Finding Conversation** remains exposed while every matching body read is pending; **Conversation ready** appears only after exact event focus | Connected Firebase Playwright holds every matching callable POST and asserts pending/resolved state plus exact heading focus | Local connected pass | Hosted authenticated latency and production data |
| CA-A11Y-002 | Keyboard users can open Conversation details, traverse **Why this view** and the named evidence region, dismiss with Escape, and return to the exact trigger | Browser-local Playwright keyboard regression at 390 and 1440 | Local automated pass | Manual switch control and representative keyboard user |
| CA-A11Y-003 | The Conversation dialog and resolved Messaging Station have no automatically detectable axe violations in the tested state | Browser-local dialog axe scan plus connected Messaging Station axe scan | Local automated pass | Manual screen-reader reading order and announcements |
| CA-A11Y-004 | Content reflows without two-dimensional page scrolling at a 640 CSS-pixel viewport, used as a layout proxy for 200% zoom on a 1280-pixel-wide viewport | Connected Playwright checks document and key-surface horizontal bounds and captures the resolved route | Local automated proxy | Manual browser zoom at 200% |
| CA-A11Y-005 | Content reflows without two-dimensional page scrolling at a 320 CSS-pixel viewport, used as a layout proxy for 400% zoom on a 1280-pixel-wide viewport | Connected Playwright checks document and key-surface horizontal bounds and captures the resolved route | Local automated proxy | Manual browser zoom at 400% |
| CA-A11Y-006 | Controls and focus remain distinguishable in forced-colors mode | Existing Ambient accessibility regression checks visible focus and explicit controls at 768 pixels | Local automated pass | Windows High Contrast with manual keyboard/AT |
| CA-A11Y-007 | Pending and ready announcements, event identity, thread log, and composer are understandable in reading order | Semantic source/tests and axe coverage only | Unverified | NVDA/Chrome, NVDA/Firefox, and VoiceOver/Safari manual runs |
| CA-A11Y-008 | Switch users can reach the exact continuation, Conversation controls, and return path without timing dependence | Keyboard model only | Unverified | Manual Switch Control or equivalent scan-input run |

## Required Manual Script

For every available browser/assistive-technology pair:

1. Sign in as staff and open the seeded exact opportunity.
2. Open **Conversation details** and confirm the dialog name, initial close
   control, disclosure, named details region, and exact return focus.
3. Choose **Open event conversation** while the body read is delayed. Confirm
   the pending status is announced without claiming readiness.
4. Release the read. Confirm **Conversation ready**, the exact event name,
   event thread, message log, and composer are announced in a sensible order.
5. At 200% and 400% browser zoom, confirm no two-dimensional page scrolling is
   required to read or operate the exact thread.
6. Record browser, version, assistive technology, version, viewport, result,
   failure text, screenshot or recording path, operator, and timestamp.

## Current Non-Claims

- The 640px and 320px checks are responsive-layout proxies, not proof of real
  browser zoom behavior.
- Axe and keyboard automation do not establish screen-reader, switch-control,
  comprehension, hosted, provider, production, or human acceptance.
- Firebase emulator evidence remains local connected evidence.
