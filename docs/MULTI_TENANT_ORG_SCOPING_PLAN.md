# Multi-Tenant Organization Scoping Plan

Last updated: 2026-09-10 15:09:08 CDT
Status: Implemented (Phases 1-8 complete; additive migration mode active)

## Implementation Status
- Completed in phased rollout (Phase 1 through Phase 8).
- Org-scoped paths are active for menu, catalog, quotes, versions, and primary function workflows.
- Firestore rules and indexes were deployed to `tonicatering` on March 20, 2026.
- Legacy fallback remains intentionally enabled during additive migration and should be retired after full data migration and cross-org denial verification.

## Objective
Transform the app from single-tenant to organization-scoped multi-tenant architecture using org subcollections and additive migration.

## Context
The current app uses global Firestore collections and bootstrap-admin assumptions. We need SaaS-ready org isolation without breaking quote/menu workflows.

## Decisions
- Use `organizations/{orgId}` as the tenant root.
- Store business data in org subcollections.
- Keep migration additive first.
- Use server-side or privileged bootstrap for org creation.
- Nest quote versions under each quote.
- Keep legacy fallback only temporarily.

## Target Data Model
```text
organizations/{orgId}
  settings/config
  eventTypes/{eventTypeId}
  menuCategories/{categoryId}
  menuItems/{itemId}
  customers/{customerId}
  quotes/{quoteId}
  quotes/{quoteId}/versions/{versionId}
  catalogPackages/{packageId}
  catalogAddons/{addonId}
  catalogRentals/{rentalId}
```

## File Scope
- `src/lib/organizationService.js`
- `src/context/OrganizationContext.jsx`
- `src/lib/menuService.js`
- `src/lib/quoteStore.js`
- `src/hooks/useCatalogData.js`
- `src/hooks/useAuthSession.js`
- `firestore.rules`
- `firestore.indexes.json`
- `scripts/seed-firestore-menu.mjs`
- `scripts/migrate-to-multi-tenant.mjs`
- `functions/index.js`
- `src/main.jsx`

## Required Changes
- [x] Create `organizations` root collection and org profile schema.
- [x] Add `organizationId` to `userRoles/{uid}`.
- [x] Implement org bootstrap via callable or transaction-safe privileged path.
- [x] Add `OrganizationContext` with org readiness state.
- [x] Refactor menu/catalog reads+writes to org paths.
- [x] Refactor quote/history/version operations to org paths.
- [x] Store quote versions at `quotes/{quoteId}/versions/{versionId}`.
- [x] Update Firestore rules to enforce same-org access.
- [x] Replace generic ownership checks with tokenized or explicitly modeled customer portal access.
- [x] Update seed script to require `--organization <orgId>` and seed org defaults.
- [x] Add migration script to copy legacy global data into a default org.
- [x] Add temporary dual-read fallback behind a feature flag.
- [x] Add only indexes required by org-scoped query paths.
- [x] Update functions to read/write org-scoped collections.

## Constraints
- No breaking change to current quote-creation flow during migration.
- No client-only trust for tenant creation.
- Legacy fallback must be removable.
- Rules must deny cross-org access.
- Emulator and local dev must continue working.

## Verification
- First admin bootstrap creates exactly one org and links the user.
- Org-scoped menu and quote reads/writes work.
- Cross-org reads/writes are denied in emulator tests.
- Seed script populates only the targeted org.
- Legacy data migrates into a default org successfully.
- Quote version history remains attached to the correct parent quote.
- Migration dry-run evidence follows `docs/ORCHESTRATION_RUNBOOK.md` ("Migration Dry-Run Evidence Standard (P0 Execution)") before production migration writes are approved.

## Risk Areas
- Bootstrap race conditions.
- Rules complexity growth.
- Legacy fallback lingering too long.
- Over-indexing before stable query patterns are verified.

## Validation Signals
- Every business record is traceable by org path.
- No component loads catalog/quotes without org context.
- Bootstrap creates exactly one org for initial admin.
- Cross-org denial tests pass before deploy.

## Best-Practice Tips
- Tenant creation is a control-plane action; keep it out of regular client CRUD.
- Use path-based tenancy as source of truth; duplicate `organizationId` only when needed for querying/analytics.
