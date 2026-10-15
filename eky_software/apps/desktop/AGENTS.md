# Desktop Runtime Instructions

Read the application-root AGENTS.md and its mandatory documentation route in
docs/README.md before changing this package. Resolve paths from the application
root unless a link says otherwise. The route is mandatory, not optional
background. Read each applicable owner in full before work; follow its scoped
mandatory references. Recheck newly affected boundaries as scope expands.

Always read these application-relative owners before desktop changes:
- docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md
- docs/architecture/local-desktop-implementation-plan.md
- docs/architecture/local-desktop-dependency-review.md
- docs/architecture/local-runtime-trust-and-authorization-plan.md
- docs/architecture/security-principles.md
Use the root precedence and stop rule when an owner is unclear or contracts conflict.

## Local Boundaries

- Desktop owns infrastructure, windows, validated transport, resource roots,
  process lifecycle and packaging, not business rules, tenant authorization,
  invoice calculations, email decisions or secret values.
- Disable Node integration; retain context isolation, sandbox and webSecurity.
  Deny remote code, navigation, new windows, webviews and permissions by default.
  Validate privileged messages. Expose only named, bounded capabilities, never
  raw Electron/Node, filesystem, shell or process APIs.
- Keep runtime sessions, secrets, keys, manifests, journals and private paths
  out of renderer, public HTTP, URLs, command lines, logs and renderer storage.
  Do not accept encryption parameters, executables, arguments or installer
  commands from renderer. Preserve browser development.
- Keep native dialogs, password windows, archive I/O and backup/update
  orchestration in main. Main must not open workspace SQLite or import its
  driver. Business modules expose only named snapshot/validation ports.
- Do not package local data, development databases, secrets or fixtures.
  Keep package:windows on main-owned Eky Test; only package:windows:pilot
  and installer use the normal Eky root with pilot build admission.
  Derive workspace roots from trusted runtime configuration.
- Uncertainty is not cleanup authority. Preserve journals, original failures
  and evidence; close business admission until the owning contract proves
  continuation. A missing process handle, kill return, expired lease, slot
  census or journal alone is not process absence or mutation authority.
- Keep ordinary backup, update and restore ownership/fences distinct.
  Invalid continuation must not reopen business writes. Preserve the exact
  operation, fresh authority checks after awaits and installation lease order.
- No plaintext portable backup or silent encryption/safeStorage fallback.
  Installer owns binaries only, never business data, secrets, recovery points,
  logs or external archives. No migrating update before a validated recovery
  point. No forced kill as a successful strict update/restore shutdown.
- Unsigned pilot is only the approved local-media, confirmed pilot policy.
  A hash is not publisher trust. Do not broaden it to stable, network,
  background or silent updates or weaken operating-system protections.
- Root security, privacy, tenant, dependency approval and release gates remain
  mandatory. A documentation move never grants a new capability or exception.

## Mandatory Contract Owners

The documents below own the complete contracts, including negative cases,
ordering, authority renewal, evidence retention and acceptance gates. Read
the applicable documents before implementation, tests or review; this local
summary does not replace them. All paths below start at the application root.

- Process startup, reservation, ordinary/update/restore shutdown, ownership
  before a returned backend handle, callback settlement, quit guards and
  clean-shutdown marking:
  docs/architecture/local-desktop-implementation-plan.md.
- Workspace registry, creation/import/adoption/switch/replacement, capabilities,
  build admission, installation lease and lock order, cold admission and
  journal-v2 evidence, serial inventory, passive transitions and first start:
  docs/decisions/ADR-0011-local-multi-workspace-company-model.md and
  docs/architecture/local-company-workspace-plan.md. Preserve ADR-0008's
  enduring lineage boundary. W7 deletion is not authorized by this route.
- Backup/recovery/restore: docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md,
  docs/architecture/local-backup-and-restore-plan.md and
  docs/architecture/local-backup-artifact-inventory.md. Interrupted restore,
  rollback and manual recovery also require
  docs/architecture/local-restore-recovery-runbook.md.
  Schema attestation and the narrow owned-local hot-journal exception are
  owned by docs/architecture/local-database-implementation-plan.md.
  Preserve exact selected journal, slot identity, fresh receipt, content and
  lineage proof, original absence and named cleanup authority.
- Installer/update/Setup/signing/channel, accepted-build persistence, rollback,
  direct-Setup record, installer-not-applied proof and named cache operations:
  docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md,
  docs/architecture/windows-installer-and-update-plan.md,
  docs/architecture/windows-update-operational-runbook.md and
  docs/architecture/release-versioning-policy.md.
- Invoice archive paths, private broker, exact delivery PDF and retry journal:
  docs/architecture/local-invoice-pdf-archive-plan.md. It is not a backup.
- Electron/native compatibility also requires
  docs/architecture/electron-43-better-sqlite3-13-compatibility-plan.md and its
  checkpoint model; dependency approval remains separate.

## Verification And Evidence

Read docs/ai/testing-rules.md and docs/ai/workflow.md for applicable tests,
first-failure retention, the bounded retry rule, CI monitoring and exact PR
and post-merge main gates. For Electron E2E/packaged coverage also read
docs/architecture/e2e-testing-strategy.md, r0-e2e-test-matrix.md and
e2e-test-environment.md in that directory, and docs/ai/e2e-test-authoring-guide.md.
Installer harness/process/timeout/cadence work additionally requires
docs/architecture/windows-installer-acceptance-harness-v2.md.

Preserve the two-process hardened Windows backup -> inspect -> restore ->
restart -> compare gate for profile paths, backup containers, recovery points,
staging, activation,
rollback, backend startup/process lifecycle, runtime sessions, safeStorage,
SQLite or authoritative-artifact ownership changes. Compare database before
backend open and artifacts after restart, reject the old session and exclude
machine-local secrets. Coordination state contains only synthetic hashes and
identifiers. Verify the owned process tree and loopback release before
deletion of the validated run-* temp root. Bounded filesystem retries may
absorb transient handle release only; persistent cleanup failure fails the test.

Build distributable candidates from a clean commit once and verify those exact
bytes. Require first start, graceful stop, second start on the same synthetic
profile, no orphan processes and, for update-boundary work, a prior accepted
lower identity. Pending, cancelled, flaky or failing required checks are not
release readiness. Do not replace evidence with a rebuild.

Real SMTP credentials require separately approved encrypted Electron use and
explicit confirmation; test delivery is forced to the configured test recipient.
Real customer/invoice data and normal customer delivery require the separate
release security gate, packaging checks and owner approval.
