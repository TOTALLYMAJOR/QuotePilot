# Commercial Platform Acceptance Matrix

Last updated: 2026-09-04 13:41:00 CDT

This matrix closes the source-level acceptance contract for the QuotePilot UX
Convergence Execution Refinement. `PASS` means the cited source and local test
evidence exists on this branch. It does not prove deployment, hosted runtime,
provider delivery, production data, human visual acceptance, assistive-
technology acceptance, adoption, or commercial outcome. AC-120 stays pending
until required CI passes at the single pushed exact head.

Evidence keys: **ARCH** = `docs/COMMERCIAL_PLATFORM_PROGRAM.md` and ADR-0003;
**CORE** = `functions/commercialPlatformCore.cjs` and its unit tests; **P1** =
Golden Pricing Corpus; **P2** = pricing-v2 core, authoritative pricing, and
differential tests; **PAY** = quote/payment/acceptance tests; **LIB** = Ambient
Library tests; **PACK** = starter-pack tests; **REG** = full unit/build/
governance regression qualification; **DOC** = canonical documentation set.

| AC | Status | Evidence / disposition |
|---|---|---|
| AC-001 | PASS | ARCH; existing quote, catalog, and pricing authorities are reused. |
| AC-002 | PASS | ARCH; no parallel quote state exists. |
| AC-003 | PASS | ARCH; catalog and server pricing remain singular. |
| AC-004 | PASS | ARCH; catering is the complete reference vertical. |
| AC-005 | PASS | CORE neutral kernel contract and vertical-pack fixture. |
| AC-006 | PASS | LIB presents catering-native labels. |
| AC-007 | PASS | CORE vertical configuration cannot bypass validation. |
| AC-008 | PASS | P2 server authority and tenant revision fences. |
| AC-009 | PASS | CORE adapters and P1 legacy derivation. |
| AC-010 | PASS | P1 plus immutable saved version behavior in REG. |
| AC-011 | PASS | CORE Package-to-Offer adapter. |
| AC-012 | PASS | CORE and P1 inclusion characterization. |
| AC-013 | PASS | CORE minimum-choice tests. |
| AC-014 | PASS | CORE maximum-choice tests. |
| AC-015 | PASS | CORE zero-minimum groups. |
| AC-016 | PASS | P2 explicit inclusion adjustment and exact zero charge. |
| AC-017 | PASS | P2 authoritative selected-component validation. |
| AC-018 | PASS | CORE inactive/missing reference rejection. |
| AC-019 | PASS | CORE references retain catalog price ownership. |
| AC-020 | PASS | Existing consequence-preview authority retained; REG. |
| AC-021 | PASS | CORE Event Template adapter and REG. |
| AC-022 | PASS | CORE applies into one draft. |
| AC-023 | PASS | ARCH and P2; templates are inputs only. |
| AC-024 | PASS | CORE publication validation. |
| AC-025 | PASS | CORE explicit-field preservation test. |
| AC-026 | PASS | CORE application provenance. |
| AC-027 | PASS | CORE collision detection test. |
| AC-028 | PASS | CORE shared Commercial Template adapter. |
| AC-029 | PASS | CORE repeated-evaluation equality. |
| AC-030 | PASS | CORE unknown-operator rejection. |
| AC-031 | PASS | CORE enumerated data-only grammar. |
| AC-032 | PASS | CORE immutable-context test. |
| AC-033 | PASS | CORE normalized reason/evidence output. |
| AC-034 | PASS | CORE exact component/target conflict output. |
| AC-035 | PASS | CORE mandatory-conflict rejection. |
| AC-036 | PASS | Existing staffing semantics retained in P2/REG. |
| AC-037 | PASS | Legacy upsell remains; bounded rules are additive. |
| AC-038 | PASS | CORE rule version and provenance. |
| AC-039 | PASS | P2 line catalog/base minor units. |
| AC-040 | PASS | P2 adjustment source policy IDs. |
| AC-041 | PASS | P2 exact waterfall reconciliation tests. |
| AC-042 | PASS | P2 bundle-inclusion adjustment evidence. |
| AC-043 | PASS | P2 contextual/season adjustment evidence. |
| AC-044 | PASS | P2 discount total is explicitly zero. |
| AC-045 | PASS | P2 waterfall is part of saved pricing output. |
| AC-046 | PASS | P2 waterfall contains its immutable numeric evidence. |
| AC-047 | PASS | P1 frozen before v2 implementation. |
| AC-048 | PASS | P1 contains 80 named cases. |
| AC-049 | PASS | P1 covers every current pricing family. |
| AC-050 | PASS | Pricing Constitution records v1 defects. |
| AC-051 | PASS | 400-demand maximum is named in code/docs. |
| AC-052 | PASS | P2 rounded-subtotal service-fee basis. |
| AC-053 | PASS | P2 package/components plus fee taxable basis. |
| AC-054 | PASS | P2 grand-total deposit basis. |
| AC-055 | PASS | P2 invalid explicit tax region fails closed. |
| AC-056 | PASS | P2 overlapping fee tiers rejected. |
| AC-057 | PASS | P2 invalid tier bounds rejected. |
| AC-058 | PASS | P2 explicit/default/specific/standard precedence. |
| AC-059 | PASS | P2 excludes full-year fallback from specific matching. |
| AC-060 | PASS | P2 overlapping specific seasons require unique priority. |
| AC-061 | PASS | P2 uses integer minor units and BigInt intermediates. |
| AC-062 | PASS | P2 grand total is a safe integer in cents. |
| AC-063 | PASS | P2 line half-up test. |
| AC-064 | PASS | P2 service-fee half-up test. |
| AC-065 | PASS | P2 tax half-up test. |
| AC-066 | PASS | P2 deposit half-up test. |
| AC-067 | PASS | P2 exact charge-line sum invariant. |
| AC-068 | PASS | P2 exact deposit plus balance invariant. |
| AC-069 | PASS | `pricing-v2` stored on output/receipt. |
| AC-070 | PASS | Legacy derivation explicitly labels `pricing-v1`. |
| AC-071 | PASS | Fixed-seed differential test executes 5,000 valid cases. |
| AC-072 | PASS | P2 exact browser/server projections match. |
| AC-073 | PASS | No mismatch remained; test identifies case index on failure. |
| AC-074 | PASS | Differential projection compares exact minor units. |
| AC-075 | PASS | Browser authority remains `client_preview`. |
| AC-076 | PASS | Callable output remains `server_authoritative`. |
| AC-077 | PASS | Existing current-revision confirmation gate retained. |
| AC-078 | PASS | Existing during-read abort test passes. |
| AC-079 | PASS | Existing trusted-write authority recheck passes. |
| AC-080 | PASS | CORE publication validates Offer/Template/Rule refs. |
| AC-081 | PASS | PAY stores and projects authoritative deposit cents. |
| AC-082 | PASS | PAY browser remains non-authoritative. |
| AC-083 | PASS | PAY exact final balance plus paid-evidence ledger. |
| AC-084 | PASS | Existing payment identity/idempotency tests pass. |
| AC-085 | PASS | PACK all versioned packs install/validate. |
| AC-086 | PASS | PACK frozen v1 hashes and record baselines pass. |
| AC-087 | PASS | PACK installs with pricing unconfirmed. |
| AC-088 | PASS | PACK replacement customization fences pass. |
| AC-089 | PASS | PACK derives Offers, Templates, and disabled review-gated Rules. |
| AC-090 | PASS | ARCH explicitly requires no second production vertical. |
| AC-091 | PASS | LIB exposes all five commercial building blocks. |
| AC-092 | PASS | LIB labels Offers, Components, Templates, Pricing, Rules. |
| AC-093 | PASS | LIB uses ordinary business language. |
| AC-094 | PASS | Existing catalog save/revision gate remains the only editor path. |
| AC-095 | PASS | ARCH records branch, PR, commits, and reused implementation. |
| AC-096 | PASS | Original checkout WIP remains outside this worktree. |
| AC-097 | PASS | Reuse/change ledger records retained capabilities. |
| AC-098 | PASS | Scope manifest records the widened implementation directories. |
| AC-099 | PASS | Workbench/Operations consume existing quote authority. |
| AC-100 | PASS | No alternate Quote Builder was added. |
| AC-101 | PASS | ARCH records Kernel -> Pack -> Tenant -> UX. |
| AC-102 | PASS | ADR documents catering as reference, not kernel boundary. |
| AC-103 | PASS | DOC reflects Offer/Template/Rule inputs. |
| AC-104 | PASS | DOC and LIB reflect expanded Library responsibility. |
| AC-105 | PASS | `docs/PRICING_CONSTITUTION.md`. |
| AC-106 | PASS | Feature Matrix distinguishes source status and external proof. |
| AC-107 | PASS | Project Status/State updated to candidate truth. |
| AC-108 | PASS | CHANGELOG records the local candidate accurately. |
| AC-109 | PASS | Superseded pricing-v1-as-default statements amended. |
| AC-110 | PASS | REG trusted quote-creation suite. |
| AC-111 | PASS | REG quote edit/version suite. |
| AC-112 | PASS | REG Guided creation suite. |
| AC-113 | PASS | P1/P2 inclusion parity tests. |
| AC-114 | PASS | REG scenario comparison tests. |
| AC-115 | PASS | REG change-impact preview tests. |
| AC-116 | PASS | REG proposal/client preview tests. |
| AC-117 | PASS | REG margin evidence remains fail closed. |
| AC-118 | PASS | PACK/onboarding regression tests. |
| AC-119 | PASS | PACK installation regression tests. |
| AC-120 | PENDING | Requires required CI success at the single pushed exact head. |

## Residual acceptance boundary

The source candidate does not claim hosted or production deployment. Visual
review beyond deterministic component tests, cross-browser/device acceptance,
assistive-technology acceptance, production tenant migration, and payment-
provider runtime readback remain separate proof events.
