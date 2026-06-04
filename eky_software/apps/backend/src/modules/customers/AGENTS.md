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

The current local MVP uses `dev-company` only as a temporary local development company id.

`dev-company` is not authentication, tenant isolation, or a permission model.

Future auth and permission work must move company context to a trusted backend-verified source.

## Tests

Add or update tests when changing:

- customer domain rules
- create/update/list application services
- HTTP route behavior
- repository port behavior
- customer form-facing data contracts
- customer number, property manager, status, or hourly rate behavior

## Naming

Code is written in English.

Use terms such as `Customer`, `CustomerNumber`, `CustomerType`, `CustomerStatus`, `PropertyManager`, and `HousingCompany`.

Do not use Finnish code identifiers.
