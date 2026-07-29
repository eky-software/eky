# Invoicing backend module AI instructions

This file applies to code under `apps/backend/src/modules/invoicing`.

Always read the repository root `AGENTS.md` first.

Also read the documents required by the task, including at minimum:

- `docs/modules/invoicing.md`
- `docs/architecture/invoicing-workflow-boundaries.md`
- `docs/architecture/invoicing-mvp-implementation-plan.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/error-handling-principles.md`

Approval, numbering, snapshot, PDF, delivery and email work also requires the
corresponding architecture documents named in the root `AGENTS.md`.

## Responsibility

Invoicing owns invoice drafts and lines, authoritative invoice calculations,
numbering and payment settings, approved invoice snapshots, invoice documents,
delivery events and invoice-specific audit transitions.

It does not own customer master data, company master data, email secrets,
work orders, work entries, material entries, inventory or reporting data.

## Layers And Dependencies

Keep domain and application code independent of Hono, React, Electron, SQLite,
storage implementations, email providers and API-client code. HTTP validates
and maps requests. Infrastructure implements the ports and owns SQL, storage,
PDF and provider details. Composition wires concrete adapters outside the
module.

Do not import another business module's infrastructure, repository adapter or
HTTP code. Do not add a generic manager, service locator, base repository or
shared helper layer to shorten explicit Invoicing dependencies.

Implement independent Invoicing repository and read-model ports in separate
adapters. Do not combine invoice detail, credit context, sent grouping or
future reporting reads back into one general SQLite reader.

## Trust And Permissions

HTTP routes take `ActorContext` and `companyId` only from the backend-verified
runtime context. Request bodies, query parameters and renderer values are not
trusted as identity or company boundaries.

Application services that require a permission must enforce it in the backend
with deny-by-default behavior. Do not rely on a hidden or disabled UI action as
authorization.

## Cross-Module Contracts

Customer membership checks use Invoicing's `CustomerAccessReader` port.
Invoice email settings use Invoicing's `InvoiceEmailSettingsReader` port.
Cross-module writes must call the owning module's application contract and may
not update its tables directly.

The current approval snapshot adapter's parameterized, company-scoped reads
from customer and company settings tables are a documented persistence
exception in `docs/architecture/current-module-conformance-audit.md`. Do not
expand or copy that exception without an explicit architecture decision.

## Tests

Add or update tests for changed domain rules, application behavior, permission
and company boundaries, HTTP contracts, transaction rollback, persistence
guards, PDF snapshots, delivery outcomes and module dependency directions as
the change requires.

Use synthetic data only. Never place real customer data, invoice data,
credentials or secrets in tests, fixtures, snapshots or logs.

Update the R0 E2E matrix for every new invoice state transition, delivery
outcome, correction workflow or cross-module read. Keep representative
successful lifecycle, permission/company denial, concurrency/idempotency and
failure/recovery scenarios. E2E uses fake SMTP and isolated document storage;
never expose invoice reset, seed or fault controls through production HTTP.

Preserve the representative Playwright journeys for lifecycle, immutable
snapshot, reverse charge, cancellation, credit, refresh, duplicate commands
and hostile text. Delivery and persistence changes must also preserve the
typed PDF, fake SMTP, transaction rollback, SQLite lock, operational writer
and restart/recovery scenarios listed in the R0 E2E matrix.

## Observability

Invoicing owns its business audit and delivery events. Critical audit writes
remain in the same transaction as the invoice transition. Operational logs
must not replace these tables or contain invoice content, customer contact
data, IBAN values, email bodies, PDF bytes, secrets, raw errors or stacks.

Activity readers may expose only company-scoped safe projections such as an
invoice number and a translation key. Technical incident indexes must not
contain invoice, customer, actor or company identifiers.

Invoicing owns the audit events for invoice VAT rates, numbering settings and
payment settings even when their forms are rendered under Company Settings.
Their values must not be copied into audit rows. Invoicing also owns the
retention adapter for these setting audit rows; the startup coordinator may
call only the narrow module port.

Read `docs/architecture/observability-and-audit-plan.md` and
`docs/architecture/r0-observability-event-catalog.md` before changing audit,
activity, diagnostics or logging behavior.
