# Customers backend module AI instructions

This file applies to code under `apps/backend/src/modules/customers`.

Always read the repository root `AGENTS.md` first.

Also read:

- `docs/modules/customers.md`
- `docs/architecture/customer-vertical-slice-plan.md`
- `docs/architecture/customer-ui-ux-plan.md`
- `docs/architecture/customer-overview-plan.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/product/glossary.md`

## Responsibility

The customers module owns customer master data.

It owns:

- customer identity and visible customer number
- customer type
- customer contact and address data
- property manager and housing company relationship
- customer-specific hourly rate override
- customer status

It does not own invoices, work orders, work entries, material entries, inventory, reports, or company settings default hourly rate.

`managedByCustomerId` describes the current customer master-data relationship.
Do not use it to infer historical invoice ownership or billing recipients.
Those semantics and projections belong to Invoicing.

## Layer Rules

Keep the module onion intact:

```text
http
  -> application
    -> domain
      -> ports
        -> infrastructure
```

Domain code must not import Hono, React, SQLite, better-sqlite3, SQL helpers, or API-client code.

Application services may use repository ports, but they must not use SQL, Hono, React, or database connection types.

Repository ports must expose only domain/application level types.

SQLite and SQL are allowed only in `infrastructure`.

## Security

Customer HTTP routes take `companyId` only from the backend-verified
`ActorContext`. They must not define local development company constants or
trust a request body or query parameter as the company boundary.

The verified Electron local-session uses a persistent local runtime identity.
The browser development profile remains a development-only exception and is
not a production authentication model.

## Tests

Add or update tests when changing:

- customer domain rules
- create/update/list application services
- HTTP route behavior
- repository port behavior
- customer form-facing data contracts
- customer number, property manager, status, or hourly rate behavior

Update the R0 E2E matrix when Customers gains a significant workflow or trust
boundary. Keep at least one representative create/update/search journey, one
permission or company-isolation denial and one persistence failure/recovery
scenario. Do not add customer test-control HTTP routes.

Preserve `CUS-UI-001` and `CUS-INPUT-001` when changing customer create, edit,
customer-number/address search, refresh or input limits. Business values must
remain absent from Activity projections and operational logs.

## Business Audit

Customers owns its business audit writes. Customer create, update, activate
and deactivate events must be written atomically with the customer change.
Audit rows contain only actor/company/customer identifiers, a fixed action,
timestamp, outcome and allowlisted changed-field categories. Never store old
or new values, names, addresses, emails, phone numbers, business IDs or free
text in audit rows or technical logs.

Activity exposes only a company-scoped safe projection using the customer
number, not the customer name. Read
`docs/architecture/observability-and-audit-plan.md` before changing these
boundaries.

Customers owns the retention adapter for customer audit rows. Startup
maintenance may delete expired rows only through the narrow module port and
must not copy customer identifiers or changed-field categories into technical
logs.

## Naming

Code is written in English.

Use terms such as `Customer`, `CustomerNumber`, `CustomerType`, `CustomerStatus`, `PropertyManager`, and `HousingCompany`.

Do not use Finnish code identifiers.
