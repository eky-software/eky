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
