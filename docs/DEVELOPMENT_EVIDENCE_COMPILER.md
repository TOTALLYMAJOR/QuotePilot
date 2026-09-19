# Development Evidence Compiler

Last updated: 2026-09-18 20:58:00 CDT

## Purpose
The Development Evidence Compiler is the lightweight repository-local mechanism
for recording what a task actually proved. It closes the loop between request,
planner output, implementation, validation, handoff, and later learning without
creating a new governance hierarchy.

## Command
```bash
npm run evidence:task -- \
  --task "Fix Proposal Composer mobile overflow" \
  --phase complete \
  --planner-recorded-at "2026-08-27T23:39:55.434Z" \
  --pre-change-sha "<starting-commit-sha>" \
  --files src/components/ProposalComposer.jsx,src/components/proposalComposer.css \
  --validation "npm run check:env | passed" \
  --validation "npm run build | passed" \
  --local-proof "Build passed on local checkout" \
  --residual-risk "Hosted browser proof not run"
```

By default the command writes an ignored JSON record under:

```text
.cache/development-evidence/
```

Use `--dry-run` to print the record without writing it.

`postChangeSha` is captured from `HEAD` when the record is created.
`preChangeSha` is `null` unless the caller supplies the exact starting commit
with `--pre-change-sha`; the recorder never guesses historical provenance.

Summarize ignored local records with:

```bash
npm run evidence:index
```

Use JSON output for agents or scripts:

```bash
npm run evidence:index -- --json
```

## Evidence Classes
Each record separates:

| Class | Meaning |
|---|---|
| `source` | Git identity, files, and repository-local artifact changes |
| `local` | Local commands, tests, browser checks, screenshots, or generated artifacts |
| `ci` | CI workflow result for the exact commit or PR |
| `hosted` | Hosted environment behavior for a named URL/deployment |
| `provider` | External provider receipt or verified callback |
| `production` | Production deployment or production-data proof |
| `human` | Explicit owner, reviewer, operator, or customer acceptance |
| `outcome` | Later product or operational result |

No class implies another. A local build is not CI proof. CI is not production
proof. Provider acceptance is not recipient acceptance. Human acceptance is not
automated verification.


## Visual Evidence Bundle

Successful qualifying Playwright lanes retain a bounded visual-proof artifact
instead of discarding every successful browser capture with the runner. The
dedicated proof cohort uses synthetic repository fixtures only and currently
covers Staff action-feedback state transitions at 390, 768, and 1440 pixels.
Each viewport captures the state before save, the uncertain outcome, the exact
return focus, and the resolved return state.

Run the proof cohort locally with:

```bash
rm -rf output/playwright test-results .cache/playwright-evidence
mkdir -p .cache/playwright-evidence
PLAYWRIGHT_JSON_OUTPUT_NAME=.cache/playwright-evidence/results.json \
VITE_CUSTOMER_CENTERED_WORKSPACE_ENABLED=true \
VITE_AMBIENT_UI_ENABLED=true \
VITE_PILOT_NOW_ENABLED=true \
npm run test:e2e:visual-evidence -- --reporter=line,json
```

Compile retained captures with:

```bash
npm run evidence:visual -- \
  --require-screenshots \
  --playwright-json .cache/playwright-evidence/results.json
```

In `lane:playwright-smoke`, CI clears the proof directories, reruns the
bounded proof cohort, writes a Playwright JSON report, and uploads
`quotepilot-visual-evidence-<GITHUB_SHA>` for 90 days. The bundle contains
the image bytes, the Playwright report, a manifest, and a SHA-256 digest of that
manifest. Every image receives its own SHA-256 digest and source path.

The compiler verifies that the requested evidence SHA matches the actual Git
checkout SHA when both are available. Pull-request head/base SHAs are recorded
separately from the executed checkout SHA so a merge-candidate run is not
misrepresented as a head-only render.

Filename/path markers classify captures as `before`, `after`, `current`,
or generic `proof`. Classification does not invent a baseline: a bundle
contains before/after evidence only when those bytes were actually captured in
that run.

A successful visual bundle is **CI evidence only**. Synthetic screenshots do
not establish hosted behavior, provider acceptance, production data or writes,
human visual acceptance, or product outcomes.

## Runtime Diagnostics Boundary
Session diagnostics are the app-local runtime observability path. They record
bounded route/error/session events for staff inspection and export, but remain
local browser evidence unless a separate hosted, provider, production, or human
acceptance artifact explicitly says otherwise.

Diagnostic payloads must stay privacy-bounded: strip URL query/hash values,
redact email, phone, token-like, and sensitive-key context values, and hash
stable user identifiers or stack traces rather than storing raw values.

## Required Record Shape
The command emits JSON with:

- `schemaVersion`
- `recordedAt`
- `task`
- `phase`
- `branch`
- `preChangeSha`
- `postChangeSha`
- `dirty`
- `plannerRecordedAt`
- `files`
- `validations`
- `evidence`
- `humanDecision`
- `residualRisks`
- `nextAction`

## Index Shape
`npm run evidence:index -- --json` emits:

- record totals,
- invalid-record totals,
- dirty-record count,
- failed-validation count,
- missing planner or human-decision counts,
- record counts by phase and branch,
- evidence-class coverage,
- repeated residual risks,
- repeated next actions,
- recent records,
- recommendations.

## Product Truth Digest Relationship

The approved Product Truth Digest will consume this index as one input. It does
not change the task-record schema and does not promote a task's evidence into a
stronger class. Task records answer what one task proved; the planned digest
reconciles those records with independent Git, canonical-document, capability,
release, reachability, provider, production, human, and outcome sources.

Implementation remains pending under `QP-OBS-018`. Until it lands, do not claim
that `status:product` or `check:product-drift` exists. The governing decision,
design, and work plan are linked from `docs/DOC_SYSTEM.md`.

## Promotion Rule
Evidence is a record, not a rule. Promote a repeated lesson only when one of
these is true:

- it prevented a meaningful defect,
- it removed repeated human intervention,
- it shortened discovery for similar tasks,
- it clarified an authority boundary,
- it made acceptance executable,
- it improved recovery from failed work.

Promotion targets, in preferred order:

1. Existing script/check.
2. Existing planner contract.
3. Existing canonical doc.
4. Existing repo-local skill.
5. New artifact only if no current owner fits.

## Security
Do not include provider secrets, tokens, private keys, raw customer data,
signed URLs, or private provider payloads. Record proof type, command, file
identity, status, and opaque external receipt identifiers instead.
