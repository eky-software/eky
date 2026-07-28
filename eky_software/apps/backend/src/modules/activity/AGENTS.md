# Activity backend module AI instructions

This file applies to code under `apps/backend/src/modules/activity`.

Always read the repository root `AGENTS.md` first.

Also read:

- `docs/modules/activity.md`
- `docs/architecture/observability-and-audit-plan.md`
- `docs/architecture/r0-observability-event-catalog.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`

## Responsibility

Activity is a read-only composition module. It combines safe, company-scoped
business activity projections supplied by the owning business modules.

Activity does not own business audit writes, audit tables, operational logs,
diagnostics, customer data, company settings or invoices.

## Boundaries

- Read data only through narrow module-owned reader ports.
- Do not import another module's infrastructure, repository or HTTP code.
- Expose changed-field information only as the documented, module-owned safe
  category allowlists. Never expose field names, old/new values or raw audit
  metadata.
- Do not expose actor ids, customer names, contact data, invoice contents or
  technical logs.
- Take `companyId` only from the backend-verified `ActorContext`.
- Require the dedicated Activity permission in the application service.
- Keep the HTTP route thin and validate every query parameter.
- Interpret the selected month as a `Europe/Helsinki` calendar month, convert
  its local midnight boundaries to UTC, and keep stored timestamps in UTC.

## Tests

Test permission denial, company isolation, Helsinki month boundaries including
DST transitions, safe category allowlists, outcome filters, stable pagination,
unknown query parameters and the absence of disallowed fields from the public
projection.
