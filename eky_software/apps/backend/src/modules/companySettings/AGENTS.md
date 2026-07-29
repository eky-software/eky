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
- hourly rate shortcut used as an invoicing UI default
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

`hourlyRateShortcut` belongs to Company Settings. It is a UI convenience
setting, not an authoritative invoice calculation rule.

`customer.hourlyRateOverrideCents` belongs to Customers.

Invoicing later owns the used hourly rate snapshot on invoices or invoice lines.

Do not move customer-specific pricing into Company Settings.

## Security

The verified local-session profile resolves a database-persisted local runtime
identity. Browser development uses the same persisted identity but remains an
explicit unauthenticated development exception.

HTTP routes must read the company from the backend-verified `ActorContext` and
must not define their own development company constants. Updating the complete
company settings master data requires `manageCompanySettings`; email secret
operations require the separate `manageCompanyEmailSecret` permission.

Future cloud auth must produce the same application-level actor contract from
a separately verified identity and company membership.

## Tests

Add or update tests when changing:

- company settings domain rules
- get/update application services
- HTTP route behavior
- repository port behavior
- default hourly rate behavior
- hourly rate shortcut validation and persistence
- email secret input validation and secret store port behavior

Email secrets must never be returned to the frontend, written to ordinary
SQLite fields, included in logs, or placed in test fixtures as real values.
Use only clearly synthetic secret values in tests.

Email secret lifecycle application services must take the company only from a
validated `ActorContext`, require `manageCompanyEmailSecret`, and return only
secret configuration status. HTTP input must never choose the secret's company.
Setting and removing a secret must create one `pending` audit operation before
the secret store call and complete the same row as `succeeded` or `failed`.
If the store succeeds but audit completion fails, the row remains `pending` for
later reconciliation. The row contains only operation metadata, actor, company,
action, lifecycle timestamps, status, and a safe failure code. Never audit the
secret, secret hash, secret length, secret reference, or another derived value.

Company Settings owns the retention adapter for its master-data audit and
email-secret lifecycle audit. Retention must preserve unresolved `pending`
secret operations and delete completed events only before the documented
calendar-year cutoff.

`CompanyEmailSecretReader` is backend-only and reserved for an approved email
delivery provider. It must not be injected into Company Settings HTTP routes,
the API client, preload, renderer, or web UI.

## Business Audit And Logs

Company Settings owns audit writes for company master data and email-secret
lifecycle actions. Master-data audit contains only a fixed action, actor and
company identifiers, timestamp, outcome and allowlisted changed-field
categories. It never stores setting values. In particular, do not audit or log
IBAN, BIC, sender email, SMTP username, password, secret reference, secret
length or derived secret values.

Settings persistence and its mandatory audit event share a transaction.
Secret-store lifecycle keeps the existing pending/terminal reconciliation
model because the OS secret store and SQLite cannot share one transaction.
Read `docs/architecture/observability-and-audit-plan.md` before changing these
boundaries.

Update the R0 E2E matrix when Company Settings gains a significant setting,
secret lifecycle action or delivery integration. Include a successful UI/API
journey, a permission/company denial and a failure/recovery scenario. E2E must
use only synthetic secret data behind the test composition and must never add
a secret-read or fault-control HTTP endpoint.

Preserve `COMPANY-UI-001` and `COMPANY-AUDIT-001` when changing contact,
banking or non-secret email settings. The web journey must continue to prove
refresh persistence while Activity, Diagnostics and operational logs omit
IBANs, email addresses and old/new master-data values.

## Naming

Code is written in English.

Use terms such as `CompanySettings`, `CompanyName`, `BusinessId`,
`DefaultHourlyRate`, and `HourlyRateShortcut`.

Do not use Finnish code identifiers.
