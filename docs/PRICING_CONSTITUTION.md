# QuotePilot Pricing Constitution

Last updated: 2026-09-04 13:06:37 CDT

## Purpose

This is the canonical policy and arithmetic contract for QuotePilot pricing.
It describes current pricing-v1 behavior, deliberately corrected pricing-v2
behavior, authority, rounding, historical compatibility, and payment amount
provenance.

## Authority

- Browser pricing is an immediate preview.
- Server pricing is authoritative and uses the organization-scoped catalog
  read protected by current catalog revision, settings fingerprint, pricing
  confirmation, actor/time evidence, and trusted-write revalidation.
- Templates, offers, rules, starter packs, and tenant configuration are inputs.
  They cannot become independent pricing authority.
- A saved quote revision snapshots its pricing version, normalized inputs,
  line evidence, pricing rules, catalog authority, and price waterfall.

## Pricing-v1 characterization

Pricing-v1 remains readable and is never recalculated. Its characterized
policies are:

- Priced demand quantity is clamped to 400 guests.
- Package pricing is per guest.
- Add-ons and menu components support per-guest, per-item, or per-event modes;
  rentals support the same modes and may derive default quantity from guests.
- Package inclusions add no incremental charge.
- Staffing uses declared rate types/overrides and either hourly or per-event
  per-staff charging.
- Travel uses the standard rate through the configured mileage threshold and
  the long-distance rate after it.
- Service charge basis is package + add-ons + rentals + menu + labor + travel.
- Taxable basis is package + add-ons + rentals + menu + service charge; labor
  and travel are excluded under the current catering policy.
- Deposit basis is the grand total.

Characterized v1 defects/ambiguities are retained as evidence, not promoted to
v2 policy: an invalid explicit tax region can fall back; first-array seasonal
matching can let a generic full-year profile shadow a specific profile; fee
tier overlap and malformed ranges can normalize instead of fail; monetary
arithmetic uses floating major units and can contain fractional cents.

The Golden Pricing Corpus freezes 80 named v1 cases across package, add-on,
rental, menu, staffing, travel, fee/tax/deposit, seasonality, zero, and boundary
states before v2 changes are introduced.

## Pricing-v2 policy

Pricing-v2 deliberately corrects only declared safety and exactness defects:

- Monetary inputs cross the boundary as integer minor units.
- Positive USD calculations use deterministic half-up rounding.
- Each line extension is rounded once after quantity and declared contextual
  multiplier are applied.
- Service charge is calculated from the sum of rounded service-charge-basis
  lines and rounded once.
- Tax is calculated from the sum of rounded taxable lines plus the rounded
  service charge and rounded once.
- Deposit is calculated from exact grand-total minor units and rounded once.
- Remaining balance is `grandTotalMinor - depositMinor`.
- Charge lines + service fee + tax equal grand total exactly.
- Deposit + remaining balance equal grand total exactly.
- Unsupported discounts remain absent and `discountTotalMinor` is zero.

## Policy validation

- Explicit selected season -> configured fixed default -> matching specific
  season -> standard fallback.
- A full-year standard profile cannot shadow a matching specific profile.
- Overlapping specific seasonal profiles fail publication unless an explicit
  unique priority resolves them.
- An explicit unknown tax-region reference fails closed. No explicit region
  uses the configured default.
- Service-fee tiers require unique IDs, non-negative percentages, valid
  inclusive bounds, and no overlaps. Gaps intentionally fall back to the
  scalar service-fee percentage.
- Maximum priced demand quantity is 400.
- Quantity normalization rejects non-finite and negative quantities; bounded
  component quantities use deterministic integers.
- Declared staff rate overrides take precedence over selected rate types, then
  configured defaults.

## Price waterfall

Every pricing-v2 charge line records catalog/base minor units, supported
context adjustment, bundle-inclusion adjustment when applicable, effective
unit/line value, source policy, reason, and authority. Waterfalls are immutable
inside the saved pricing receipt and do not read mutable current catalog state.

## Payment handoff

Pricing-v2 deposit checkout and final-balance logic consume exact stored minor
units. They do not independently recompute cents from browser dollars. Legacy
pricing-v1 quotes remain supported through the existing checked major-to-minor
compatibility path.

## Version strategy

- Historical receipts without a version are interpreted as pricing-v1.
- Existing stored pricing-v1 receipts remain untouched.
- New authoritative calculations request and store pricing-v2.
- A rollback may stop creation of new v2 receipts but may not rewrite already
  certified v2 or historical v1 revisions.
