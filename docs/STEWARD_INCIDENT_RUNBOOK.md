# QuotePilot Steward Incident and Data-Control Runbook

Last updated: 2026-08-21 00:06:22 CDT

Status: Phase 0 source policy; no Steward runtime, provider call, or private
record persistence exists yet

## Purpose

This runbook governs containment, rollback, evidence handling, and deletion for
QuotePilot Steward. It does not authorize an operator, browser, model, or future
callable to mutate quotes, menus, workflows, provider settings, payments, or
customer communications.

## Trigger conditions

Open an incident and hold the narrowest safe scope when any of these occurs:

- suspected cross-tenant or unauthorized-resource access;
- a secret, sensitive personal datum, protected trait, or raw prompt/response
  appears in a provider packet, log, analytics event, or stored record;
- a provider, billing, configuration, messaging, deployment, or other mutation
  is attempted outside its existing authority;
- cost, concurrency, token, retry, or usage behavior exceeds a governed cap;
- a model, prompt, schema, policy, or source revision drifts from its approved
  snapshot;
- a packet passes with missing, stale, unsupported, or fabricated evidence;
- audit receipts are missing, mutable, or inconsistent with execution.

## Immediate containment

1. Set the global hold when tenant isolation, credentials, provider integrity,
   or audit completeness is uncertain. Otherwise hold the affected provider,
   organization, task, or model snapshot.
2. Preserve the manual and deterministic QuotePilot paths. Never disable core
   quoting merely because Steward is unavailable.
3. Stop new provider reservations and do not automatically retry, replay,
   stage, apply, send, contact, configure, charge, refund, deploy, or reconcile.
4. Rotate or revoke a suspected credential through its owning provider process;
   never paste the replacement into Steward or a browser field.
5. Notify the product owner and security owner. Billing, privacy, provider, or
   legal owners join when their boundary is implicated.

## Evidence handling

Preserve only allowlisted server metadata: pseudonymous organization, actor,
and request digests; task and outcome; policy/model snapshot; packet digest;
bounded token counts; reason codes; server time; and deletion deadline. Do not
copy raw prompts, responses, customer notes, provider credentials, protected
traits, or cross-tenant identifiers into incident records.

Evidence is append-only and browser-denied. A hold may be released only by an
admin or owner directive that cites the SHA-256 digest of reviewed recovery
evidence.

## Recovery and rollback

1. Fix the deterministic policy, adapter, schema, source authorization, or
   provider configuration through its existing owner.
2. Run the focused negative corpus and all affected auth/rules, capability,
   build, and security checks against an exact source revision.
3. Pin the approved policy and model snapshots. Do not release an alias that
   can drift without a new evaluation.
4. Record reviewed recovery evidence and issue the narrow release directive.
5. Canary only consenting internal/pilot users. Keep customer contact and every
   mutation disabled until their separate acceptance gates pass.

## Deletion and retention

Deletion requests are validated into non-executing, trusted-server-only plans.
Organization-wide deletion requires owner authority. Client, packet, and run
scope require admin or owner authority and exact tenant binding. Execution must
delete the matching private QuotePilot records, request provider-side deletion
where applicable, and write a pseudonymous deletion receipt without preserving
the deleted content.

Maximum source retention is 30 days for run metadata and Decision Packets, 180
days from review for client-memory facts, 395 days for audit/usage/deletion and
incident evidence, and seven years for entitlement receipts and immutable
policy-version evidence. Earlier explicit expiry wins. Raw prompts and raw
responses have no retention category and must not be stored. Backup expiry and
provider deletion remain separate operational proof gates.

## Release criteria

A Steward hold stays active until the affected negative test passes, exact
policy/model/source revisions are recorded, the recovery evidence digest is
reviewed, and the authorized release is narrow and attributable. A successful
local test does not prove deployment, provider deletion, production isolation,
or human acceptance.
