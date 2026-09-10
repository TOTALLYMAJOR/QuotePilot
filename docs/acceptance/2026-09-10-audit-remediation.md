# Audit Remediation Current-Head Reconciliation

Last updated: 2026-09-10 16:49:18 CDT

## Review binding and evidence boundary

- Captured source base: `f84234d9d6174c0762cbb1a405dfa88967d42285`.
- Isolated review branch: `review/audit-remediation-current-f84234d9`.
- Release integration base: current `origin/main`
  `2f4246846496f066e909d16fb46886cd0cc193fc`, which preserves `v0.18.2`, its
  deployment receipts, the merged population retry corrections, and the
  split-deployment activation receipt correction.
- Isolated release branch: `release/v0.18.3`; it contains only the remediation
  delta above the current main release base.
- Historical candidate base: `961e688bb3d651862161599e48264b890a98e8e2`.
- The historical base is an ancestor of the captured base. The six intervening
  commits were inspected by source diff and scoped implementation review, not
  by subject line alone.
- The latest intervening commit changes `CHANGELOG.md` and
  `e2e/ambient-intelligence-accessibility.spec.js`. Its future fixture expiry
  and explanatory changelog entry are preserved verbatim in this candidate.
- All evidence below is local source/test evidence. The reconciled current-main
  core lane passes, while exact release-branch CI, hosted candidate UAT,
  semantic tagging, production mutation, provider outcome,
  assistive-technology review, and human acceptance remain unclaimed.

## Finding classifications

| Finding | Captured-base classification | Current candidate result and evidence |
|---|---|---|
| Inventory receipt/projection arrival ordering and fixed point | `STILL_OPEN` | Repaired. `InventoryWorkspace` now confirms either arrival order only against the matching current projection and reaches a stable state. Component tests cover receipt-first, projection-first, already-present, cached, pending, mismatched, and late-result cases. |
| Client Preview containment and repeat blocker focus | `PARTIAL` | Repaired by reusing `useModalDialog` plus one shared background-isolation primitive. Component tests cover Escape, Tab/Shift+Tab, exact attribute restoration, sibling/late DOM scopes, return focus, and repeated blocker activation under StrictMode. Feature-enabled browser tests prove preview focus return. |
| Tenant-calendar Attention refresh | `PARTIAL` | Repaired. The mounted hook schedules the next date boundary in the tenant timezone instead of device midnight. Fake-timer tests cover timezone disagreement, setting changes, delayed wake, cleanup, and 23/25-hour Chicago days while retaining stale/read-generation behavior. |
| Native primary workspace destinations | `STILL_OPEN` | Repaired. True destinations are anchors with real `href` values; ordinary clicks still delegate to the existing route/dirty-draft guard and contextual actions remain buttons. Existing button-only CSS selectors were also corrected. Unit tests and a Chromium modified-click test prove a new Operations tab opens while the source dirty draft remains intact. |
| Inventory identifiers, disclosure, and 200-identity boundary | `PARTIAL` | Repaired without changing server limits or authority. Optional references use the existing request-ID primitive, remain stable through rejection/uncertainty, and rotate only after confirmed completion. Source detail is disclosed progressively; new identity creation stops at the bounded projection while existing stock/cost actions remain independent. |
| GOV-01 machine state and status-document boundary | `ALREADY_FIXED` | The intervening documentation reconciliation commits already updated the machine ledger and current proof-event boundary. `npm run check:project-state` passes with 12 capabilities, 10 blockers, one proof event, and five commercial evidence records; this candidate does not rewrite `.project/state.json`. |
| CR-02 shared-v2 live-preview pricing parity | `STILL_OPEN` | Not changed. The repository still has v1 browser/scenario consumers alongside authoritative pricing v2. Closure requires the governed shared-v2 adapter, explicit incomplete/unavailable/error states, and exact-money/calendar parity without rewriting the characterized v1 corpus. |
| UX-01 durable incomplete working drafts | `STILL_OPEN` | Not changed. Browser-local tab recovery passes, but it is not principal/tenant-scoped cross-device persistence. A governed server-owned working-draft or existing intake authority, rules/emulator proof, conflict handling, recovery, and supported promotion remain required. |
| Bulk receiving and ingredient-context actions | `STILL_OPEN` | Not implemented. Pagination would not expand the existing 200-identity server policy. |
| Historical documentation hunks | `COLLISION` | Resolved in this promoted candidate. Six historical candidate docs were rewritten against current authority, and the later `f84234d9` fixture-expiry changelog entry was preserved instead of overwritten. |

## Local validation

| Check | Result |
|---|---|
| `npm run lane:core` | Pass: capability and field-state contracts; 487 unit files passed, 3 skipped; 5,697 tests passed, 99 skipped; compatibility build; docs governance; bundle budget; 136 Truthloop tests. |
| `npm run test:rules:firestore` | Pass: 93/93 against the local Firestore emulator. Expected denied-operation emulator warnings were observed; the command exited 0. |
| Focused affected integration set | Pass: 10 files, 116 tests. |
| Feature-enabled affected browser matrix | Pass: 17/17 across Operations, Ambient Now, Workbench, Calm Four, modal return focus, reduced motion, 390/768/1440 layouts, and native modified-click/new-tab behavior. |
| Standalone Proposal Composer browser profile | Pass: 14/14, including local tab-loss recovery and 390/1440 contrast checks. This does not close durable cross-device drafts. |
| Preserved Ambient staffing fixture regression | Pass: the feature-enabled mobile accessibility test stages the staffing recommendation as visible unsaved editor work using the retained future expiry. |
| `npm run check:project-state` | Pass: 12 capabilities, 10 blockers, one proof event, five commercial evidence records. |
| Production-like enabled build | Pass: 455 modules. A pre-existing mixed static/dynamic import warning for `quoteCatalogRevisionReview.js` remains non-fatal. |
| `npm run check:env` | Blocked only by absent local Firebase browser configuration: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`. No values were inspected or printed. |

An exploratory all-flags-at-once browser run produced 54 passes and 32 failures
because it combined mutually different legacy and Ambient rollout profiles.
Those failures were not relabeled as product regressions: affected suites were
rerun under their documented profiles, producing the passing matrices above.

## Remaining release boundary

The historical generated patch remains bound to captured `f84234d9`; it must
not be applied to current main. Its remediation delta has instead been
reconciled onto the isolated `release/v0.18.3` branch from current main. The
previous changelog collision is resolved. CR-02, UX-01, broader Inventory UX,
exact PR/main CI, candidate UAT, production, provider outcomes,
assistive-technology review, and human acceptance remain open.
