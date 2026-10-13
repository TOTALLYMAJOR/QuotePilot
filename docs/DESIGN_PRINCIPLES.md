# QuotePilot Design Principles

**Status:** Living document. Every design, copy, and feature decision gets checked against these five commitments.
**Owner:** Michael Major
Last updated: 2026-09-10 15:09:08 CDT

## Purpose

QuotePilot is built on a point of view: running a catering business is hard, monotonous work, and software should carry weight the operator shouldn't have to. These principles turn that point of view into a review lens. When a screen, a sentence of copy, or a feature idea is on the table, it passes or fails against the five commitments below — not against taste, trend, or what competitors do.

## The Five Commitments

### 1. Help the user grow

The app is a growth tool for the business owner, not just software that stores their data. Every surface should leave the operator more in control of their business than they were before opening it.

**In practice:** Copy speaks to business outcomes (margin protected, deposit collected, kitchen never cooking from a stale sheet), not capabilities ("versioned revisions," "approval workflow"). Features earn their place by changing what the operator can do, not by filling a comparison chart.

**Where it lives today:** The landing page tells the burden story — what running events costs you — before it mentions the product. Living Opportunity and Operations lead with exact state, evidence-backed blockers, and one safe next action rather than a blended readiness claim.

**Rules out:** Feature lists as a value proposition. Dashboards that report without pointing at an action.

**Review questions:** What does the operator gain here, in their words? If this shipped and nothing else changed, is their business better run?

### 2. Eliminate noise

Strip anything that doesn't serve the user's next decision. Noise isn't just clutter — it's every element that makes the user do sorting work the app should have done.

**In practice:** One idea per section. Detail collapses behind disclosure; the status and the one-sentence outcome stay visible. Internal vocabulary never leaks to users ("Deterministic intelligence" became "Quote insights"; "Data confidence" became "Data freshness"). Domain vocabulary the user owns — BEO, covers, service charge — stays, because to a caterer that's signal, not jargon.

**Where it lives today:** The neutral workspace retheme (calm near-white system, one gold accent, hairline borders). Evidence rails and methodology prose demoted behind `<details>`. The quotes sheet showing outcomes first, provenance on request.

**Rules out:** Decorative gradients and chrome. Explaining the system's internals to someone who just wants their event handled. Two sections that make the same point.

**Review questions:** What decision does this element serve? If the user skipped it, would they lose anything? What can collapse behind a disclosure without hiding the outcome?

### 3. Use incentives, honestly

Running a business is monotonous. The app breaks that monotony with game theory and reward — and there are two distinct readings of that, both deliberate:

**a. Reward the operator for using the tools.** The reward is the business visibly coming under control, celebrated at real state transitions: the PAID stamp landing, the revision chip flipping, the kitchen copy going CURRENT, or an exact blocker resolving from named evidence. We celebrate outcomes the operator actually cares about. We do not invent blended readiness scores, points, badges, or streaks detached from the business.

**b. Give the operator mechanism design against real counterparties.** The caterer's hardest games are with clients who ghost, change scope late, and sit on deposits. Choice architecture (Good/Better/Best tiering), deposit deadlines, quote expiry, and risk reversal (the $1 test access) change the payoffs of those games in the operator's favor. This is the deeper read of "incentives" and the harder one for competitors to copy.

**The honesty constraint is absolute:** no fake urgency, no manufactured scarcity, no hidden terms, no invented metrics or testimonials. An incentive that needs a lie isn't on-brand; it's a liability. (House precedent: a screenshot slot with no real screenshot got labeled "Illustrative, not a product screenshot" rather than faking one.)

**Review questions:** What behavior does this reward, and is it a behavior that grows the business? Would this incentive survive the user reading exactly how it works? Is this celebrating a real state change or decorating an empty one?

### 4. The brand speaks through UI, UX, and copy — and it tells a story

The product transforms and narrates rather than describes. A QuotePilot surface should be recognizable with the logo covered: editorial serif (Bodoni Moda) reserved for brand moments, Manrope doing the working text, DM Mono for document artifacts, paper that stays paper.

**In practice:** Show the problem happening, then show the product answering it. The Document hero doesn't claim the product handles change — it performs a BEO revising itself, the margin slipping, the OUT OF DATE stamp landing. Sections continue one narrative thread instead of resetting to generic SaaS blocks.

**Rules out:** Interchangeable copy that could sit on any competitor's site. Typography drift (serif leaking into body text, mono leaking out of documents). A hero that tells a story followed by sections that abandon it.

**Review questions:** Could a competitor ship this section unchanged? Does it continue the story the page started, or restart from zero? Is the transformation shown or merely claimed?

### 5. Compress decisions, never multiply them

Every screen should make the user's next decision easier — obvious next step, predictable click consequences, one primary action per context.

**In practice:** CTA labels say what happens next. Summary before detail (the Quote Summary rail, the readiness donut: one glance, one number, one action). Options are framed so choosing is easy — tiering does the comparison work for the buyer instead of handing them a research project.

**Rules out:** Competing CTAs of equal weight. Copy the user must re-read. Buttons whose consequence is a surprise. Settings where a default would do.

**Review questions:** At this point on the screen, what should the user do next — and is that visually undeniable? Before clicking, do they know what happens after? Did we make a choice easier, or just present it?

## Governing Interaction Truth

The five commitments operate inside one non-negotiable state rule: the product
must not make the operator infer whether a value is absent, inherited, merely
suggested, locally edited, being saved, server-confirmed, active, stale, or
failed. Availability, origin, editability, persistence, and evidence remain
separate even when one primary status leads the presentation.

This rules out false choices and silent outcomes. Zero choices explain the
blocker and recovery; one choice becomes static context; many choices remain an
explicit decision. A user-triggered async action shows eligibility, progress,
outcome, and recovery beside the action. Imported and prepopulated values retain
their source. Saved is not Published, and Pending is not success. The canonical
state vocabulary and adopted-surface registry live in
`field-state-contract.json` and `field-state-surface-contracts.json`.

**Review questions:** What does the system actually know? Who or what supplied
the value? May this user change it here? What exact receipt establishes the
outcome? If it fails or goes stale, can the operator understand and recover
without leaving this surface?

## Using This Document

In any design or copy review, walk the five commitments in order and ask the review questions. A change that scores well on four but fails one is not done — the commitments are a system, not a menu. Noise elimination without storytelling is sterile; incentives without honesty are poison; story without decision compression is theater.

When two commitments tension each other (a story beat adds length; an incentive adds a decision), resolve toward the user's next decision — commitment 5 is the tiebreaker, because a confused user grows nothing.

**Hard constraints that no principle overrides:** the buyer access gate (marketing surfaces never leak staff-workspace access), claims discipline (no unverifiable numbers, no fabricated social proof), and server-authoritative pricing.
