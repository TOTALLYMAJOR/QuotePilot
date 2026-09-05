# Portable Codex Governance Prompt Series

Last updated: 2026-08-31 20:02:26 CDT

## Purpose

This is the first portable prompt series for recreating the underlying agentic
governance architecture used in this repository without copying its product,
stack, provider, path, or domain-specific rules.

The target is a software organization whose teams will use Codex in the ChatGPT
desktop app against existing repositories. The organization is assumed to have
software, governance, and delivery practices already in place; the prompts must
discover and preserve those practices before creating or changing agent
infrastructure.

The archetype is **Commanding Governance Overlay**:

- Organization and repository invariants are explicit and durable.
- Local teams may extend the system, but they may not silently weaken a
  non-delegable invariant.
- Human and platform authority remain above repository instructions.
- Machine checks, permissions, and review gates enforce critical rules; prose
  alone is not treated as enforcement.
- The overlay adapts to the current software system instead of replacing it
  with a fashionable greenfield framework.

“Commanding” is an operating-model description, not a claim that a repository
file can override OpenAI platform instructions, managed configuration, security
controls, source-system permissions, or explicit human approval requirements.

## What Transfers And What Does Not

Transfer these concepts:

- A concise root `AGENTS.md` as the repository instruction entry point.
- Canonical documents with one declared owner for each kind of truth.
- Discovery and current-state reconciliation before prescription.
- Explicit task scope, owned files, dependencies, risks, and validations.
- Progressive disclosure through narrowly triggered skills.
- Machine-readable task planning and completion records.
- Focused validation followed by risk-appropriate repository gates.
- Separation of source, local, CI, hosted, provider, production, human, and
  outcome evidence.
- Promotion of repeated lessons into checks, skills, or canonical policy only
  after evidence shows the pattern is durable.

Do not transfer these details:

- Product names, customer workflows, commercial rules, or domain vocabulary.
- Framework, language, database, cloud, payment, messaging, or hosting choices.
- Repository paths, scripts, branch names, environment IDs, or provider names.
- Existing risk classifications, state names, validation commands, or release
  policies without verifying that they fit the target organization.
- This repository's skill names or implementation-specific invariants.

## Current Codex Constraints This Series Respects

As of this document's update date:

- Codex builds its `AGENTS.md` instruction chain when a run starts. It reads
  from the project root toward the current directory, and nearer instructions
  appear later and can override earlier guidance.
- At a given directory, `AGENTS.override.md` takes precedence over `AGENTS.md`.
  A durable organization baseline should therefore not depend on an unnoticed
  temporary override file.
- The combined project-instruction size has a configured limit, so the root
  file should remain concise and link to deeper canonical material.
- Repository skills belong in `.agents/skills/` and use progressive disclosure:
  Codex initially sees skill metadata and reads the full `SKILL.md` only when
  the task triggers it.
- Workspace access, local runtime policy, Codex cloud, Platform API access,
  plugins/connectors, and connected-system permissions are separate control
  boundaries. Repository configuration cannot grant access in any of them.
- Managed local requirements such as permission profiles are an administrative
  policy layer, separate from repository instructions.

Before executing this series, verify these behaviors against the current
[OpenAI `AGENTS.md` documentation](https://developers.openai.com/codex/guides/agents-md),
[skills documentation](https://developers.openai.com/codex/skills/), and
[enterprise rollout guide](https://developers.openai.com/codex/enterprise/admin-setup/).
Do not hard-code a setting whose current name or precedence has not been
verified.

## Target Architecture

```text
Organization authority and managed runtime policy
                         |
                         v
Repository AGENTS.md --> canonical authority map and documentation ownership
                         |
                         v
Task compiler --> bounded scope and ownership --> selected skills
                         |
                         v
Focused checks --> risk lanes --> evidence-separated completion packet
                         |
                         v
Human review / CI / deployment / outcome observation
                         |
                         v
Repeated learning promoted into policy, checks, skills, or templates
```

The architecture has two planes that must not be collapsed:

1. **Organization plane:** workspace identity, roles, managed local runtime
   requirements, app deployment, model/tool/plugin controls, audit, and
   connected-system permissions.
2. **Repository plane:** instructions, canonical software truth, task planning,
   scoped execution, validation, evidence, and delivery workflow.

## How To Use The Series

1. Select one representative pilot repository. Do not begin with an
   organization-wide rollout.
2. Replace the placeholders in the shared context block.
3. Start from the verified physical Git root in Codex Desktop.
4. Paste Prompt 0 once to establish the operating contract.
5. Run Prompts 1 through 10 in order. Preserve each accepted artifact for the
   next prompt.
6. Stop at every named human decision gate. A prompt is authorization to do only
   what that prompt explicitly permits.
7. Start a fresh Codex run for the final instruction-discovery tests because
   `AGENTS.md` guidance is assembled when a run starts.

### Shared Context Block

Prepend this block to Prompts 1 through 10:

```text
ORGANIZATION: {{ORG_NAME}}
PILOT REPOSITORY: {{PILOT_REPOSITORY}}
PRIMARY BRANCH: {{PRIMARY_BRANCH}}
REPOSITORY OWNER: {{REPOSITORY_OWNER}}
SECURITY OR RISK OWNER: {{SECURITY_OWNER}}
RELEASE AUTHORITY: {{RELEASE_AUTHORITY}}
TARGET CODEX SURFACE: Codex in the ChatGPT desktop app
OTHER ENABLED SURFACES: {{CLI_IDE_CLOUD_OR_NONE}}
REGULATORY OR DATA CONSTRAINTS: {{CONSTRAINTS_OR_UNKNOWN}}

Use the Commanding Governance Overlay archetype. Preserve existing software and
governance truth. Do not import product-specific, stack-specific, provider-
specific, or path-specific rules from another environment. Verify the physical
Git root, branch, worktree status, instruction sources, and current official
Codex behavior before relying on them.
```

## Prompt 0 — Commanding Overlay Controller

Use this once at the start of the pilot.

```text
Act as an organizational agent-governance architect and repository operating-
system engineer.

Our goal is to install a Commanding Governance Overlay for Codex Desktop in an
existing software organization. “Commanding” means the repository has a clear,
durable control plane whose non-delegable invariants cannot be silently weakened
by local convention. It does not authorize bypassing platform instructions,
managed policy, sandboxing, source-system permissions, or human approval.

Governing method:

1. Discover before prescribing.
2. Verify before classifying.
3. Preserve before replacing.
4. Mechanize critical invariants before adding explanatory prose.
5. Prefer progress, but stop when a missing human decision would materially
   change authority, security, data handling, production, or rollout scope.

For every phase:

- Resolve the physical repository root and inspect Git status before edits.
- Treat existing changes as user-owned unless proven otherwise.
- Inventory existing AGENTS files, governance documents, CI, scripts, skills,
  ownership rules, protected paths, and delivery gates before creating peers.
- Distinguish observed facts, strong inferences, unknowns, recommendations, and
  decisions requiring approval.
- Reuse or adapt an existing authority instead of creating a parallel one.
- Lock the smallest coherent read, write, and validation scope before edits.
- Keep organization-plane controls separate from repository-plane controls.
- Never print, copy, or commit secrets or private provider payloads.
- Separate analyze, edit, commit, push, merge, deploy, provider mutation,
  production change, and human acceptance as different authorities.
- After each implementation phase report changed files, validations and exact
  outcomes, skipped checks with reasons, residual risks, and the next approval.

Nested instructions may specialize commands and local workflows. They may not
silently weaken organization-wide security, privacy, authorization, production,
or evidence-integrity invariants. Because instruction precedence alone cannot
guarantee that rule, propose a machine check and review rule for conflicts.

Do not implement the whole architecture in one patch. Follow the numbered
series, and do not advance past an explicit decision gate without approval.

First response: restate the target outcome, list the authority boundaries you
will preserve, identify the evidence needed to begin Prompt 1, and report any
blocking ambiguity. Do not edit files in this response.
```

Acceptance: the response recognizes that the goal is a layered, enforceable
governance system, not merely a long `AGENTS.md` prompt.

## Prompt 1 — Organization And Codex Desktop Boundary Map

```text
Create a read-only organization-plane assessment for adopting Codex in the
ChatGPT desktop app. Do not change workspace settings, managed configuration,
devices, plugins, connectors, repositories, or provider permissions.

Verify current official OpenAI documentation first. Then map these boundaries:

- workspace membership, groups, roles, and accountable administrators;
- intended Codex Desktop audiences and representative pilot users;
- local runtime policy, permission profiles, filesystem access, network access,
  approval behavior, and Computer Use policy;
- desktop application deployment and update ownership;
- model and feature availability;
- skills, plugins, connectors, MCP servers, hooks, and their data/action scope;
- Codex cloud and Platform API access, if enabled, as separate boundaries;
- source-control roles, repository permissions, and branch protections;
- audit, analytics, compliance export, retention, and incident ownership;
- connected-system authorization and least-privilege testing.

For each boundary record: current authority, owner, observed state, unknowns,
desired pilot state, evidence needed, and who may approve a change. Do not infer
that workspace access grants repository, file, network, API, plugin, or provider
access.

Recommend the smallest pilot cohort and a reversible rollout sequence. Identify
which requirements belong in administrative managed configuration and which
belong in the repository. Do not generate a requirements.toml until its current
schema, delivery mechanism, and owner are verified.

Output a decision-ready assessment in chat. If authorized to persist it, adapt
the existing canonical governance location or create one clearly named rollout
plan; do not establish a second authority.

Decision gate: workspace administrator, security/risk owner, repository owner,
and release authority accept the pilot boundaries and owners.
```

## Prompt 2 — Repository Governance Archaeology

```text
Perform a read-only current-state audit of the pilot repository before proposing
new agent files.

Inspect, using bounded searches:

- the physical Git root, current branch, upstream, worktrees, and dirty state;
- all AGENTS.md and AGENTS.override.md files from the repository root to relevant
  working directories;
- repository and user-facing setup documentation;
- architecture decisions, ownership maps, contribution rules, security policy,
  runbooks, release policy, status, backlog, and changelog authorities;
- package/build/test commands, CI workflows, protected branches, code owners,
  high-risk paths, migrations, and deployment entry points;
- existing .agents or .codex configuration, rules, skills, hooks, plugins, MCP
  configuration, and task automation;
- evidence, acceptance, incident, rollback, and handoff practices.

Build four outputs:

1. Current authority map: each truth category and its present owner/source.
2. Instruction chain map: files, scope, precedence, duplication, conflicts, and
   truncation risk.
3. Request-to-outcome path: request, planning, execution, checks, review,
   delivery, observation, and learning.
4. Gap classification: preserve, repair, consolidate, mechanize, defer, or
   remove only with explicit approval.

Label every conclusion observed, inferred, unknown, or recommended. Search for
contradictory and stale authorities. Do not score missing artifacts as defects
until you verify that an equivalent mechanism does not already exist.

Do not edit files. End with the smallest architecture delta that would create a
coherent commanding overlay in this repository.

Decision gate: repository and governance owners accept the current-state map
and the proposed delta.
```

## Prompt 3 — Authority Charter And Canonical Documentation Map

```text
Using the accepted current-state audit, implement the smallest coherent
authority layer. Adapt existing canonical documents; do not create parallel
status, backlog, architecture, release, or policy authorities.

The result must declare:

- the mission and boundaries of the repository;
- the categories of truth the repository must maintain;
- exactly one canonical owner/source for each category;
- update triggers for code, architecture, process, security, release, current
  state, backlog, and historical changes;
- the precedence and conflict-resolution rule between source, tests, generated
  artifacts, documentation, CI, hosted state, and human decisions;
- non-delegable organization/repository invariants;
- which decisions local teams may specialize;
- named human approval boundaries for destructive, security-sensitive,
  provider, production, merge, deployment, and release actions;
- a migration path for redundant or stale documents rather than silent deletion.

Prefer a concise canonical ownership map that other files link to. Create an
executable documentation-integrity check when the repository has a suitable
test or script framework. The check should detect missing canonical updates,
broken authority links, and prohibited duplicate authorities without requiring
product-specific vocabulary.

Update existing contributor or process entry points as required by the
repository's own documentation policy. Preserve unrelated work.

Validate the changed documentation and checker with focused tests before any
broad lane. Report what the checker proves and what remains a human judgment.

Decision gate: repository owner accepts the authority map and non-delegable
invariants.
```

## Prompt 4 — Concise Root AGENTS.md

```text
Create or revise the repository-root AGENTS.md as the concise entry point for
Codex. It must point to deeper canonical authorities rather than duplicate them.
Target a small file that leaves ample room under the combined instruction-size
limit for legitimate nested instructions.

Derive all content from the accepted repository audit and authority map. Include
only:

- mission and essential current software facts;
- the mandatory discovery and planning sequence;
- the canonical documentation/authority entry point;
- smallest-safe-scope and dirty-worktree rules;
- risk-triggered skills and validation routing;
- non-delegable security, privacy, authorization, data-integrity, production,
  and evidence-integrity invariants;
- high-risk paths or path classes discovered in this repository;
- definition of done and completion-report requirements;
- where repository skills and deeper governance policy live.

Do not copy commands, frameworks, providers, or invariants from another
repository. Do not use AGENTS.override.md as the durable organization baseline.
If an override file already exists, determine its owner, purpose, scope, and
expiry; surface any conflict before changing it.

Define nested-instruction policy: local files may add closer commands, tests,
and domain context, but weakening a non-delegable root invariant requires a
named exception record and owner approval. Add a machine-readable invariant
registry or checker if this repository can support one safely.

Verify the active instruction chain from the root and at least one nested
working directory in a fresh Codex run. Report every loaded instruction source
in precedence order and any size/truncation risk.

Decision gate: repository owner approves the root instruction contract.
```

## Prompt 5 — Machine-Readable Task Compiler

```text
Implement a stack-appropriate task compiler using the repository's existing
automation language and command conventions. Do not introduce a new runtime
solely for governance.

The compiler must accept at least:

- a concrete task description;
- an explicit candidate file/path set;
- a lifecycle phase such as plan, update, or complete.

It must emit a human-readable view and a machine-readable form containing:

- task profile and risk level;
- the files used for classification;
- read-first canonical dependencies;
- required skills;
- documentation obligations;
- focused and global validation commands in order;
- a dependency-aware task graph;
- authority/approval requirements;
- lifecycle phase and exact UTC timestamp;
- recommended model/reasoning tier only if the external runner can consume it.

The repository may recommend a model but must not claim that a running agent
changed its own model. Classification must fail closed for unknown high-risk
paths and must not widen because of unrelated dirty-tree changes when an
explicit path set is provided.

Store routing policy in a reviewable machine-readable contract. Add fixtures
for documentation-only, routine code, UI, security/authorization, data
migration, provider, production, and release tasks using this repository's real
path families. Test deterministic classification, missing paths, deleted paths,
and conflicting rules.

Update AGENTS.md only with the concise command and lifecycle rule; keep policy
details in the canonical governance documentation.

Decision gate: maintainers accept the classifications, escalation behavior, and
validation mappings.
```

## Prompt 6 — Bounded Scope, Ownership, And Dependency Contracts

```text
Implement a repository-native bounded-execution contract that prevents Codex
tasks from silently expanding across files, repositories, devices, providers,
or processes.

Each meaningful editing task must declare:

- verified physical Git root and starting ref;
- allowed read scope;
- exclusively owned write paths;
- explicit external targets, if any;
- task dependencies and artifacts they must produce;
- validation commands;
- approval requirements;
- intended completion evidence.

Requirements:

- preserve unrelated tracked and untracked work;
- detect overlapping ownership before parallel work;
- serialize shared-file ownership or use isolated worktrees;
- reject repository-root, home-directory, device-root, or provider-wide
  destructive targets;
- require explicit expansion for sibling repositories or external systems;
- distinguish a read-only investigation from authorization to edit or mutate;
- keep task plans immutable during execution or record reviewed revisions;
- never turn a task packet into permission to commit, push, merge, deploy, or
  mutate a provider unless that authority is explicit.

Integrate the contract with the task compiler and existing CI/task tooling.
Implement the smallest useful guard; do not build a general orchestration
platform if an existing mechanism can carry ownership and dependencies.

Test dirty trees, symlinks, overlapping paths, deleted files, external paths,
stale task manifests, and dependency cycles.

Decision gate: maintainers approve enforcement and recovery behavior.
```

## Prompt 7 — Progressive Repository Skills

```text
Create repository skills only for workflows that are repeated, consequential,
and sufficiently stable to deserve reusable instructions.

Use the current Codex skill standard and repository location
.agents/skills/<skill-name>/SKILL.md unless current official documentation or
existing accepted repository policy requires another supported location.

From repository evidence, identify at most three initial skills. Good categories
may include routine maintenance, release readiness, security review, migration
safety, or a repository-specific domain workflow, but choose only what this
repository repeatedly needs.

For each skill:

- write a precise name and trigger description;
- state when it must and must not activate;
- define authority and side-effect boundaries;
- link canonical repository truth rather than copying it;
- include focused steps, failure modes, and verification;
- put long references, scripts, and templates in the skill's optional
  subdirectories for progressive disclosure;
- prefer existing scripts over retyping commands;
- add deterministic tests for any executable helper;
- state that the skill cannot override platform, managed, repository, or human
  authority.

Keep the initial skill catalog small. Do not turn every document into a skill.
Verify explicit invocation and implicit trigger matching in a fresh Codex run,
including a negative example for each skill.

Decision gate: workflow owners approve skill triggers and side effects.
```

## Prompt 8 — Validation Lanes And CI Enforcement

```text
Map the repository's real tests and checks into a small risk-based lane system.
Reuse existing commands and CI workflows. Do not fabricate a green command or
describe a missing test as implemented.

At minimum distinguish:

- fast local preflight for environment, secrets, formatting, and governance;
- core correctness for unit/integration/build/documentation checks;
- high-risk lanes for the repository's actual authorization, data, migration,
  security, provider, or critical-domain boundaries;
- release qualification, which may compose prior lanes but remains separate
  from deployment and human acceptance.

The task compiler must select lanes from the explicit task scope. CI must use
the same canonical commands so local and CI labels cannot drift. Define branch
and mainline behavior, cancellation of stale runs, failure artifacts, and
rollback/recovery expectations using the current source-control platform.

Add checks for:

- canonical documentation synchronization;
- instruction/invariant conflicts;
- task scope and ownership integrity;
- secret exposure;
- stale or missing validation targets;
- any architecture invariant that is critical and mechanically testable.

For every lane, document exactly what a pass proves and what it does not prove.
A build or CI pass is not deployment, provider, production, human-acceptance,
or outcome evidence.

Decision gate: maintainers, security/risk owner, and release authority approve
the lane-to-risk map.
```

## Prompt 9 — Evidence, Completion, And Learning Loop

```text
Implement a lightweight completion and evidence contract that minimizes human
reconstruction without creating a new source of product or operational truth.

Every meaningful task completion must report:

- task identity and exact lifecycle timestamp;
- starting and ending Git identity;
- changed files;
- validations, exact outcomes, and skipped checks with reasons;
- approvals exercised and actions not authorized;
- residual risks, blockers, rollback or recovery path;
- evidence classes kept separate: source, local, CI, hosted, provider,
  production, human, and outcome;
- next decision or proof event.

Create ignored local task records only if they are useful for handoff and can be
kept free of secrets, prompts, raw logs, private payloads, and sensitive source
bodies. The record is evidence about work performed, not a replacement for
canonical status, architecture, release, incident, or source-control truth.

Provide a read-only index that surfaces repeated failed checks, recurring risks,
missing evidence, and unresolved next actions. Promote a pattern into a new
policy, check, skill, template, or planner rule only when multiple tasks or a
structurally important incident justify the added weight. Record one-off events
without turning them into permanent ceremony.

Test malformed records, stale timestamps, unknown evidence classes, secret-like
content, missing Git identity, and attempts to label local evidence as
production or human acceptance.

Decision gate: governance and security owners approve retention, redaction, and
promotion rules.
```

## Prompt 10 — Adversarial Pilot And Scale Decision

```text
Run an adversarial acceptance pilot of the completed Commanding Governance
Overlay. Use a fresh Codex Desktop run and one real, reversible, low-risk task.
Do not deploy, merge, mutate providers, or expand to other repositories.

Test at least these cases:

1. Root instruction discovery from the repository root.
2. Instruction discovery from a nested directory.
3. A nested instruction that legitimately specializes a command.
4. A nested instruction that attempts to weaken a non-delegable invariant.
5. An unexpected AGENTS.override.md.
6. Combined instruction-size or truncation pressure.
7. A dirty worktree with unrelated changes.
8. An explicit narrow file set versus broad dirty-tree classification.
9. A missing or failing validation target.
10. A high-risk path that must fail closed or escalate.
11. An attempted external/provider/production action without authority.
12. A completion packet that tries to promote local evidence into CI,
    production, human, or outcome proof.
13. Skill positive and negative trigger cases.
14. Canonical-document drift and duplicate-authority detection.
15. Recovery after an interrupted task.

For each case record expected behavior, observed behavior, evidence, verdict,
and remediation. Distinguish local/source proof from workspace-admin, CI,
hosted, provider, production, human, and outcome proof.

Produce a pilot decision with one of these outcomes:

- ACCEPTED FOR CONTROLLED SCALE;
- ACCEPTED WITH NAMED CONDITIONS;
- NOT ACCEPTED — REMEDIATION REQUIRED.

Only after acceptance, propose a reusable organization template or bootstrap
generator. The generator must parameterize organization, repository, stack,
authorities, risk paths, commands, and evidence sources; it must begin with
discovery and must never copy pilot-specific facts into another repository.

Decision gate: workspace administrator, security/risk owner, repository owner,
and release authority approve or reject controlled scale.
```

## Series Acceptance Criteria

The first series is successful when:

- Existing governance was reconciled rather than overwritten.
- Organization and repository control planes are explicit and separate.
- Root instructions are concise, discoverable, and linked to canonical truth.
- Non-delegable invariants have machine or review enforcement where feasible.
- Task planning, scope, ownership, skills, validation, and completion evidence
  form one coherent path.
- Critical actions still require the correct human and system authority.
- A fresh Codex Desktop run proves instruction and skill discovery.
- The pilot passes adversarial cases before organizational scale.
- The resulting template contains placeholders and discovery logic, not the
  pilot repository's facts.

## Largest Remaining Design Choice

The largest unresolved choice is the unit of organization-wide distribution:

- **Recommended:** versioned repository template plus managed runtime policy.
  This keeps software truth close to each repository while administrators own
  device/runtime restrictions.
- **Alternative:** a global user-level `AGENTS.md`. This is useful for personal
  working preferences but is weaker for organizational consistency because it
  is user-local and can drift from the repository.
- **Alternative:** a plugin or centrally distributed skill pack. This is useful
  after workflows stabilize across multiple repositories, but it should not be
  the first authority layer or a substitute for repository truth.

Choose the distribution model only after Prompt 10 shows which controls must be
shared and which must remain repository-specific.
