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
- the C1 local update foundation may expose only the zero-argument
  `selectLocalUpdate()` capability; Electron main owns the native manifest
  dialog and renderer receives only a safe summary without paths, manifest
  payload, MSI bytes, executable or arguments
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

Oikeaa SMTP-tunnusta saa käyttää vain erikseen hyväksytyssä, salatussa ja
käyttäjän vahvistamassa Electron-polussa. Testilähetys pakotetaan määritettyyn
testivastaanottajaan. Asiakaslähetyksen toteutus ei yksin tee keskeneräisestä
desktop-artifactista tuotantojulkaisua: oikea asiakas- ja laskutusdata sekä
normaali asiakaslähetys sallitaan vasta erillisen release security gaten,
paketointitarkistusten ja projektin omistajan hyväksynnän jälkeen.
