# Company Settings backend module AI instructions

This file applies to code under `apps/backend/src/modules/companySettings`.

Always read the repository root `AGENTS.md` first.

Also read:

- `docs/modules/company-settings.md`
- `docs/architecture/company-settings-implementation-plan.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/product/glossary.md`

## Responsibility

Company Settings owns the data and defaults of the company using Eky.

It owns:

- own company name
- own company business id
- own company contact and address data
- default hourly rate
- later explicitly approved invoicing settings

It does not own customers, customer-specific hourly rate overrides, invoices, work orders, work entries, material entries, or invoice snapshots.

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

## Pricing Boundary

`defaultHourlyRateCents` belongs to Company Settings.

`customer.hourlyRateOverrideCents` belongs to Customers.

Invoicing later owns the used hourly rate snapshot on invoices or invoice lines.

Do not move customer-specific pricing into Company Settings.

## Security

The current local MVP uses `dev-company` only as a temporary local development company id.

`dev-company` is not authentication, tenant isolation, or a permission model.

Future auth and permission work must move company context to a trusted backend-verified source.

## Tests

Add or update tests when changing:

- company settings domain rules
- get/update application services
- HTTP route behavior
- repository port behavior
- default hourly rate behavior

## Naming

Code is written in English.

Use terms such as `CompanySettings`, `CompanyName`, `BusinessId`, and `DefaultHourlyRate`.

Do not use Finnish code identifiers.
