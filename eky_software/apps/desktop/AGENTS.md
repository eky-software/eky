# Desktop Runtime Instructions

Read the root `AGENTS.md`, ADR-0007, the local desktop implementation plan,
the local desktop dependency review, the local runtime trust plan, and the
security principles before changing this package.

When changing Electron, `better-sqlite3`, N-API packaging, or native-runtime
compatibility, also read the Electron 43 / better-sqlite3 13 compatibility
plan and preserve its checkpoint-based validation model.

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
- W6A.2B alone may later connect the plan to production first start, create the
  active workspace preMigration point, authorize its pending migrations,
  prove backend readiness and accept the target build
- use one main-owned installation-scoped `WorkspaceMaintenanceLease` for
  backup, restore, update and workspace ownership changes; keep each module's
  narrower local guard and preserve the documented lock order
- workspace backup import must authenticate the container through the backup
  owner's private port, stop the active runtime before full SQLite validation,
  publish the root before the registry entry, and restore the previous runtime
  on every terminal success or failure path
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
