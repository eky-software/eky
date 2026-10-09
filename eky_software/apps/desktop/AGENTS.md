# Desktop Runtime Instructions

Read the root `AGENTS.md`, ADR-0007, the local desktop implementation plan,
the local desktop dependency review, the local runtime trust plan, and the
security principles before changing this package.

When changing Electron, `better-sqlite3`, N-API packaging, or native-runtime
compatibility, also read the Electron 43 / better-sqlite3 13 compatibility
plan and preserve its checkpoint-based validation model.

For backup, restore, recovery-point, restore-staging or profile rollback work, read
[ADR-0009](../../docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md)
and the [backup/restore plan](../../docs/architecture/local-backup-and-restore-plan.md).
For manual checks after interrupted restore or rollback, also read the
[restore recovery runbook](../../docs/architecture/local-restore-recovery-runbook.md).

For Windows installer, Setup, update orchestration, signing or release-channel
work, read [ADR-0010](../../docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md),
the [installer/update plan](../../docs/architecture/windows-installer-and-update-plan.md)
and the [release versioning policy](../../docs/architecture/release-versioning-policy.md).
For installer acceptance harness or W6B-family scenario work, including their
process ownership, timeout/cleanup or heavy Windows CI cadence, also read the
[acceptance harness V2 contract](../../docs/architecture/windows-installer-acceptance-harness-v2.md).

For Electron E2E or packaged-smoke coverage work, read the
[E2E strategy](../../docs/architecture/e2e-testing-strategy.md),
[R0 E2E matrix](../../docs/architecture/r0-e2e-test-matrix.md) and
[E2E environment](../../docs/architecture/e2e-test-environment.md).
For test runs and CI follow-up, use the canonical
[run monitoring and failure evidence instructions](../../docs/ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet).

`apps/desktop` is an infrastructure/runtime shell. It may own Electron window
configuration, packaged resource paths, backend process lifecycle, a narrowly
validated desktop transport, and packaging scripts.

It must not own business rules, tenant authorization, invoice calculations,
customer rules, email delivery decisions, or secret values.

Mandatory boundaries:

- keep `nodeIntegration` disabled
- keep context isolation, renderer sandboxing, and `webSecurity` enabled
- do not expose raw Electron or Node APIs to the renderer
- do not load remote application code
- deny navigation, new windows, permissions, and webviews by default
- validate every privileged message and transport input
- never pass a runtime session in a URL, command line, renderer storage, log,
  or renderer-readable environment value
- do not package development databases, `.env` files, storage, fixtures, or
  local customer/invoice data
- keep browser development available through `apps/web`
- add no desktop dependency without a documented dependency/security review
- keep delivered invoice PDF archive paths, journal data and file operations
  in Electron main; the renderer may receive only the documented safe status
  and named zero-argument capabilities
- keep the invoice archive broker private between the backend utility process
  and Electron main; never add the raw path or archive task to public HTTP
- keep backup, restore, recovery-point and update orchestration in Electron
  main infrastructure; business modules expose only narrowly named snapshot or
  validation ports
- keep update maintenance distinct from ordinary backup release in the private
  snapshot broker: expiry, drain failure or disconnect invalidates the update
  but must not reopen business writes; assertions require a drained, valid
  operation, and awaited results must recheck their captured owner before
  acknowledgement (see the [update fence contract](../../docs/architecture/local-backup-and-restore-plan.md#päivityksen-kirjoitussuojan-erillinen-vapautussääntö))
- when changing local workspace registry, creation, import, replacement,
  switching or adoption, read ADR-0011 and the local company workspace plan;
  Electron main may coordinate lifecycle and filesystem roots but must not
  open workspace SQLite or import a database driver
- run the main-owned build admission before workspace resolution or adoption
  can mutate filesystem state; a same-version/different-revision build,
  downgrade or unknown update identity must fail closed with zero workspace
  side effects
- keep the unpacked `package:windows` development artifact on its fixed,
  main-owned `Eky Test` userData root; only `package:windows:pilot` and the
  installer may use the normal `Eky` profile and pilot build admission
- recover interrupted legacy adoption automatically only when the journal,
  intact legacy source and exact derived unpublished candidate/final roots
  prove one documented recovery case; a published registry entry, active
  pointer, unsafe link, changed source or unknown trace must fail closed
- W5B.1 exposes only the versioned status, create-empty, import-as-new,
  switch and rename workspace capabilities to the trusted main frame; do not
  add raw IPC, paths, `companyId`, lineage, session, journal or secret values
  to the renderer contract
- workspace backup import keeps the native file chooser and the existing
  password window owned by Electron main; the renderer may provide only the
  validated workspace label
- active exact-lineage replacement remains outside the renderer contract
  until W5B.2, and workspace deletion remains deferred to W7
- W6A.1 may inventory only strict-registry `ready` workspaces, serially and
  read-only through a private backend utility; Electron main must not open
  SQLite, and preload, renderer, web and public HTTP must not receive the
  inventory capability or private paths
- W6A.1 must not write the registry, migrate a workspace, create a recovery
  point, start a business runtime or change accepted-build state; startup
  orchestration and `recoveryRequired` transitions belong to W6A.2
- W6A.2A may only resolve a deterministic internal first-start migration plan
  and journal a crash-safe passive-workspace registry transition; it must stay
  disconnected from production startup, migration execution, recovery-point
  creation, backend startup, accepted-build writes and renderer capabilities
- the W6A.2A plan must exactly match strict-registry `ready` entries to the
  W6A.1 inventory; only passive `invalidHistory` entries may transition to
  `recoveryRequired`, while active invalid history fails the whole plan and a
  passive compatible prefix remains byte-identical
- W6A.2A recovery may restore or accept registry bytes only when the journal,
  accepted source/target build identity and canonical registry hashes prove
  the exact state; unknown or conflicting state remains recovery-required
  without guessed repair or journal cleanup
- W6A.2B connects the plan to production first start: the main-owned workspace
  orchestrator coordinates inventory, plan and passive registry transitions,
  while the existing `FirstStartUpdateCoordinator` alone authorizes the active
  workspace preMigration point, pending migrations, backend readiness and
  target-build acceptance
- use one main-owned installation-scoped `WorkspaceMaintenanceLease` for
  backup, restore, update and workspace ownership changes; keep each module's
  narrower local guard and preserve the documented lock order
- workspace backup import must authenticate the container through the backup
  owner's private port, stop the active runtime before full SQLite validation,
  publish the root before the registry entry, and restore the previous runtime
  on every ordinary in-session terminal success or failure path; the explicit
  before-runtime-start recovery mode instead proves runtime absence, exact
  registry/root consistency and the ready continuation before journal removal,
  leaving startup and health validation to their normal owners
  ([ADR-0011 cold terminal](../../docs/decisions/ADR-0011-local-multi-workspace-company-model.md#createimport-recoveryn-kylmäkäynnistyksen-terminal))
- cold create/import admission must derive competing journal paths from main's
  root, the authoritative registry and the selected operation before any
  repairing store read; include passive and recovery-required profiles, preserve
  lazy slot precedence, and repeat admission under the installation lease;
  read-only admission is not runtime-absence or recovery authorization (see the
  [workspace recovery contract](../../docs/architecture/local-company-workspace-plan.md))
- the cold recovery's required admission callback must freshly assert the
  selected owner after acquiring its lease and proving absence, before any
  repairing read or plaintext cleanup; preserve its existing safe recovery
  code through startup without allowing raw error suffixes
- expose no generic active-profile restore capability to the renderer in the
  multi-workspace product; a different lineage is imported as a new workspace,
  and active data replacement is allowed only through the exact-lineage
  workspace replacement capability
- when a legacy profile-restore activation journal is found for a registered
  active workspace, defer transaction acceptance until backend validation and
  the registry lineage assertion both pass; a mismatch must roll back while
  the journal still owns the rollback slot and then relaunch the previous
  profile
- own the pending restore decision immediately after deferred validation,
  before any later health/session check; rollback may replace profile files
  only after backend shutdown succeeds, otherwise retain recovery evidence
  and keep business UI closed
- failed backend startup before a returned handle still owns its process;
  recovery requires observed absence and a settled migration callback, or
  proof that startup was never attempted; missing handles and kill return
  values do not authorize profile mutation or another runtime (see the
  [startup ownership contract](../../docs/architecture/local-desktop-implementation-plan.md#käynnistyksen-omistajuus-ennen-backend-kahvaa))
- never expose a backup password, derived key, recovery-point key, raw
  manifest or local backup/update path to the renderer
- never accept encryption parameters, an executable, process arguments, a
  URL or an installer command from the renderer
- never write a plaintext portable backup or silently fall back when
  encryption or `safeStorage` is unavailable
- keep restore staging, profile activation, rollback and update journals
  private to the desktop runtime; do not expose them through public HTTP
- the installer owns application binaries only and must not mutate or delete
  business data, logs, secrets, recovery points or external PDF archives
- do not start an update that can migrate business data before a validated
  pre-update recovery point exists
- launch an external installer/updater with a fixed executable and separate
  validated arguments; never construct a shell command string
- keep the R0 `localUnsignedPilot` trust policy behind a named desktop port;
  it accepts only the pilot channel, local media and explicit confirmation,
  and must never be generalized into stable, network, background or silent
  updates
- the local update UI may expose only the named zero-argument capabilities
  `getLocalUpdateStatus()`, `selectLocalUpdate()`,
  `discardSelectedLocalUpdate()`, `confirmLocalUpdate()` and
  `cancelLocalUpdate()`; Electron main owns native dialogs, package cache,
  manifests, MSI bytes, journal and installer handoff, and the renderer
  receives only a bounded status without paths, full hashes, session data,
  executable or arguments
- `confirmLocalUpdate()` must use only Electron main's current revalidated
  candidate slot; it must not accept a candidate identity or other update
  input from the renderer
- C1 may inspect and private-stage a candidate and register a matching current
  rollback package, but it must not launch MSI, stop the runtime, create a
  pre-update point, write the orchestration journal or mutate business data
- keep the C2 migration gate private between Electron main and the packaged
  backend startup protocol; never expose first-start, migration continuation,
  accepted-build metadata or update-journal controls to the renderer or public
  HTTP
- C2 may prepare and test the guarded installer handoff internally, but it must
  not expose a runnable update capability or open business UI from an
  unresolved first-start state before the C3 rollback and pilot-release gates
- update shutdown must complete gracefully before installer handoff; a forced
  backend kill is an ordinary shutdown fallback only and never a successful
  update-shutdown acknowledgement
- the private update shutdown command must bind the same snapshot-broker
  operation: require completed startup and assert the fence before server
  close and after its awaited completion, before closing the broker; preserve
  the first shutdown intent, reject conflicting update operations and attempt
  every owned close without converting a failure into exit-zero
- ordinary and update shutdown share the first stop task and its actual outcome;
  update callers may join only the same operation-bound update stop, never an
  ordinary stop even when its exit is zero; preserve that operation through
  composition, lifecycle, process sender and packaged proof adapters;
  strict failure must not fall back to ordinary kill or reopen admission, all
  owned closes are attempted, and clean-shutdown marking follows successful
  cleanup plus graceful exit (see the
  [update shutdown contract](../../docs/architecture/local-desktop-implementation-plan.md#päivityksen-hallittu-sulku))
- retain one live update lease and operation fence from pre-update snapshot
  through handoff; a journal alone cannot recreate that live authority;
  use non-mutating journal admission, latch the first ownership ambiguity and
  mark write uncertainty before awaiting publication; only a verified terminal
  write/readback plus valid fence may release before shutdown starts, while
  uncertain writes or any started shutdown keep ownership until restart
- commit accepted-build and accepted-journal state before best-effort recovery
  protection cleanup; cleanup failure may leave an extra protected point but
  must not turn a committed acceptance into rollback-required state
- keep update journals and accepted-build metadata installation-scoped under
  Electron `userData`; profile-local legacy state may only be migrated through
  the strict, idempotent C3A migration and never through generic file copying
- persist direct-Setup migration recovery before the first pending migration
  write; a restart must restore the originally bound pre-migration point or
  stop failed-safe, never create a new point from partially migrated data
- distinguish an installer that was not applied from a candidate first start
  only with accepted-build, running-build, cache and migration-prefix proof;
  mixed or unknown state must remain failed-safe
- do not add generic update-cache clear or repair capabilities; candidate
  discard and current repair must be named, journal-aware, contained and
  identity-validated operations owned by Electron main
- never present an unsigned sidecar or SHA-256 hash as publisher trust, and do
  not weaken SmartScreen, Defender or other operating-system protections
- preserve the two-process hardened Windows backup/restore smoke when changing
  profile paths, backup containers, recovery points, activation, rollback,
  backend startup, runtime sessions, `safeStorage`, SQLite or business
  artifact ownership
- packaged restore verification must compare the restored database before the
  backend opens it, compare authoritative artifacts after restart, reject the
  old runtime session and prove that machine-local secrets are not imported
  from the portable backup
- smoke coordination state may contain only synthetic hashes and identifiers;
  never store a backup password, runtime session, raw path or business data in
  it
- build a distributable desktop or installer candidate only from a clean
  commit, run the documented release-candidate smoke against the exact output
  bytes, and never replace those bytes with an untested rebuild
- a final candidate must prove first start, graceful shutdown, second start
  with the same synthetic profile, and no orphan Electron/backend processes;
  update-boundary changes must also start over a synthetic prior accepted
  lower release identity
- do not describe desktop work as release-ready while a required local,
  pull-request, or exact post-merge `main` check is pending, cancelled, flaky,
  or failing
- Windows E2E cleanup must stop the complete managed process tree and release
  loopback ports before deleting its validated `run-*` temp root; bounded
  filesystem retries may absorb transient handle release only, and persistent
  cleanup failure remains a test failure

Oikeaa SMTP-tunnusta saa käyttää vain erikseen hyväksytyssä, salatussa ja
käyttäjän vahvistamassa Electron-polussa. Testilähetys pakotetaan määritettyyn
testivastaanottajaan. Asiakaslähetyksen toteutus ei yksin tee keskeneräisestä
desktop-artifactista tuotantojulkaisua: oikea asiakas- ja laskutusdata sekä
normaali asiakaslähetys sallitaan vasta erillisen release security gaten,
paketointitarkistusten ja projektin omistajan hyväksynnän jälkeen.
