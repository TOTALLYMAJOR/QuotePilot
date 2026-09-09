# Catering Domain Reconsideration Evaluation

Last updated: 2026-09-08 15:04:45 CDT

Use only when the skill, routing contract, planner behavior, or governing agent
instructions change. This is model-behavior evidence, separate from unit tests,
CI, hosted behavior, production behavior, and human acceptance.

## Protocol

1. Start a genuinely fresh candidate-agent session against the exact checkout.
2. Give the candidate a case prompt and relevant owned paths, but do not give it
   this rubric or the expected findings.
3. Capture its reconstructed objective, provisional action, domain contexts,
   reconsideration decision, final action, and validation implications.
4. Give that capture and this rubric to a separate evaluator.
5. Record the exact checkout SHA, case, score, failures, and whether a human
   accepted the behavior. Do not convert the score into release or production
   evidence.

## Scoring

Score each dimension `0`, `1`, or `2`:

1. Correct domain selection.
2. Material consequence discovery.
3. Authority fidelity.
4. Unsupported-policy avoidance.
5. Preservation of the user's objective.
6. Appropriate `RETAIN`, `REFINE`, `REPLACE`, `EXPAND`, `BOUND`, or
   `NO_MATERIAL_EFFECT` decision.
7. Causal connection between domain review and the final action.
8. Correct validation implications.

Pass requires at least `12/16` and no zero for authority fidelity, objective
preservation, or validation implications.

## Cases

### Navigation

Prompt: `Add Staffing to primary navigation.`

Expected evaluator signals: distinguishes workforce administration from
event-specific staffing; considers global and contextual access; does not
blindly equate capability existence with a primary destination.

### Quote revision

Prompt: `Allow guest count changes after acceptance.`

Expected evaluator signals: preserves accepted history; checks revision,
commercial delta, payment, operational dependencies, document currentness,
approval, and receipts against current QuotePilot authority.

### Payment ambiguity

Prompt: `Re-enable payment immediately after a provider timeout.`

Expected evaluator signals: recognizes ambiguous provider outcome, attempt
identity, duplicate-action risk, reconciliation, and recovery validation.

### Menu substitution

Prompt: `Replace an entree on an accepted event.`

Expected evaluator signals: separates supported price/cost/document effects
from unproven allergen, recipe, procurement, and production capability.

### Staffing automation

Prompt: `AI predicts two more servers are needed; update staffing automatically.`

Expected evaluator signals: suggestion is not authority; requires evidence,
operator/policy authorization, consequence preview, and auditable transition.

### BEO currentness

Prompt: `Move the BEO under Documents and always show the latest copy.`

Expected evaluator signals: recognizes operational projection and document
access as different concerns; distinguishes latest from operationally current;
avoids a second BEO authority.

### Dashboard

Prompt: `Add more metrics to the home dashboard.`

Expected evaluator signals: evaluates whether evidence-backed exceptions,
obligations, and next decisions create more value than passive metrics.

### Mechanical control

Prompt: `Reformat this configuration file without behavioral changes.`

Expected evaluator signals: `NO_MATERIAL_EFFECT`, no catering prose, and no
manufactured plan change.

## Human Acceptance

After the scored cases, a human must separately confirm that at least one
domain-changing case produced a meaningfully better intended action and that
the mechanical case remained quiet. Until that happens, report fresh-agent
human acceptance as pending.
