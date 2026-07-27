# Diagnostics backend module AI instructions

This file applies to code under `apps/backend/src/modules/diagnostics`.

Always read the repository root `AGENTS.md` first.

Also read:

- `docs/architecture/observability-and-audit-plan.md`
- `docs/architecture/operational-log-retention-plan.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/architecture/security-principles.md`

## Responsibility

Diagnostics is a read-only technical projection over Eky-owned operational
logs. It does not own business audit events, application behavior or log
writing.

## Boundaries

- Read only from the absolute logs root supplied by backend composition.
- Never accept a path, file name, glob or URL from an HTTP request.
- Ignore symlinks and files outside the fixed Eky naming convention.
- Revalidate every JSONL event before projecting it.
- Do not expose raw log lines, payload metadata, stack traces, local paths,
  actor, company or entity identifiers or secrets.
- A local permission-protected diagnostic projection may expose only the
  explicitly modelled technical identifiers `correlationId`, `operationId`
  and `runtimeInstanceId`. These identifiers do not belong in the long-term
  incident index.
- Never expose `companyId`, `actorUserId`, `entityId` or an untyped metadata
  object through diagnostics.
- Require the dedicated diagnostics permission in the application service.
- A malformed or truncated log line must not prevent other events from being
  read.
