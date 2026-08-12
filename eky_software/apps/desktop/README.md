# Eky Desktop

`apps/desktop` is the secure Electron runtime shell for Eky Local. The normal
browser/Vite development workflow remains available in `apps/web`.

The initial Windows packaging spike uses synthetic data only. The Electron
runtime now creates an in-memory local session, injects it into restricted
backend requests in the main process, and lets the backend create ActorContext
only after verification. This is still not a production release and must not
be used with real customer data before the remaining release-security phases
are complete. A real SMTP credential may be used only through the encrypted
secret-store path. Confirmed customer delivery is implemented, but real-data
use remains blocked until the documented release-security gates are complete.

Encrypted portable backup and machine-local encrypted recovery-point creation,
health checking, scheduling, rotation, private restore staging, crash-safe
activation and rollback are implemented behind Electron main process
boundaries. Oma yritys exposes only the named desktop backup/restore
capabilities. The hardened Windows smoke proves the encrypted backup ->
inspect -> restore -> second process -> exact database/PDF comparison chain,
a new runtime session and machine-local secret continuity with synthetic data.
A restricted per-user x64 MSI prototype is implemented. Its install, repair,
uninstall, two-version major upgrade, downgrade rejection, and Windows
Installer binary rollback boundaries are verified with synthetic data. The
update coordinator, code signing, and automatic update path remain
unimplemented. The unpacked `out/Eky-win32-x64` directory is still a
development/package artifact rather than an automatically updating release.

## Commands

From the repository root on Windows:

```text
pnpm --filter @eky/desktop package:windows
pnpm --filter @eky/desktop package:windows:pilot
pnpm --filter @eky/desktop smoke:windows
pnpm --filter @eky/desktop profile:audit
pnpm --filter @eky/desktop installer:test
pnpm --filter @eky/desktop installer:build
pnpm --filter @eky/desktop installer:inspect -- -MsiPath <path-to-msi>
pnpm --filter @eky/desktop installer:lifecycle -- -MsiPath <path-to-msi> -PayloadRoot <path-to-payload> -ProductCode <product-code>
pnpm --filter @eky/desktop installer:release
pnpm --filter @eky/desktop installer:verify-restore-lock
pnpm --filter @eky/desktop installer:verify-release
pnpm --filter @eky/desktop installer:release-lifecycle
pnpm --filter @eky/desktop installer:build-upgrade-fixture
pnpm --filter @eky/desktop installer:upgrade -- -FixturePath <path-to-fixture.json>
```

The unpacked spike is created under `apps/desktop/out/Eky-win32-x64`.

`package:windows` remains the development packaging command and may produce a
dirty, explicitly non-distributable build. `package:windows:pilot` is the
stricter pre-installer gate: it requires a clean worktree, matching Git HEAD,
valid SemVer/build identity, the `pilot` channel, a closed artifact inventory
and a validated sidecar manifest. This still produces an unpacked pilot
application, not an installer.

The MSI is built from the exact hardened `out/Eky-win32-x64` payload and owns
only application binaries, static resources, its fixed per-user installation
root under `%LOCALAPPDATA%\\Programs\\Eky`, and the Eky Start Menu shortcut.
It never owns or searches `%APPDATA%\\Eky`, SQLite databases, profiles,
business PDFs, logs, safeStorage secrets, backups, recovery points, support
bundles, or an external invoice PDF archive. The current unsigned MSI is an
engineering prototype and must not be distributed for real-data use.

`installer:release` requires a clean worktree and full Git HEAD revision. It
builds the MSI exactly once, runs the read-only MSI inspector, and then writes
a closed `.manifest.json` sidecar bound to the exact MSI filename, release
identity, Git revision, byte size, and SHA-256. `installer:verify-release`
rechecks the same bytes without rebuilding, and `installer:release-lifecycle`
uses only that verified MSI for install, repair, and uninstall checks. The CI
gate does not yet upload, sign, or distribute the prototype artifacts.

The locked WiX restore runs twice and rejects any `packages.lock.json` drift.
Only the documented per-user `ICE91` warning is suppressed; every other WiX
or ICE warning fails the build. Upgrade tests reuse the exact bound N MSI,
exercise N -> N+1 while the Electron main and utility/backend processes are
running, and verify that uninstall removes installer-owned HKCU and ARP state.
WiX and .NET build tools are never part of the MSI runtime payload.

The sidecar status `unsigned-prototype` and its SHA-256 prove byte integrity,
not publisher trust. A future signed release must sign before creating the
final hash and manifest, and all lifecycle tests must then use those exact
signed bytes.

The current application version remains the prerelease SemVer
`0.1.0-alpha.2`. Windows Installer separately compares the numeric MSI
ProductVersion `0.1.2`. Removing `alpha` is a future explicit stable-release
decision, not an installer formatting change.

`profile:audit` is a Windows-only, copy-only local profile audit. Close Eky
before running it. The command never opens the active SQLite database for
writing and reports only bounded counts, health states and one of the
documented safe classifications. It does not print company, customer, invoice,
email, bank, secret or filesystem values and never repairs or resets a profile.

The packaged application version comes from `apps/desktop/package.json`.
Packaging writes a validated `dist/build-info.json` containing the version,
Git revision, UTC build time, and dirty-worktree state. A distributable
artifact must be built from a clean worktree. Development builds use the
explicit `development` revision and are marked dirty.

The package command:

- builds web, backend, auth, permissions, and desktop artifacts
- deploys only the backend production files as a hoisted, link-free tree
- validates and packages the bundled `better-sqlite3` Windows x64 N-API runtime
- packages the renderer into ASAR
- copies backend and utility-process runtime as explicit resources
- applies and verifies production Electron fuses
- inventories application, backend, desktop-runtime and final package trees
  and rejects databases, business PDFs, backups, support/log artifacts,
  environment files, secret blobs, tests, fixtures, source directories and
  symbolic links

## Runtime data isolation

- normal desktop: `%APPDATA%/Eky/runtime/data/eky.sqlite` through Electron's
  resolved `userData` path
- packaged smoke: private canonicalized OS temp root, enabled only by the
  smoke switch and valid token
- browser/backend development: `apps/backend/data/eky-dev.sqlite` or the
  development `.env` override
- E2E: test-owned private `eky-e2e.sqlite`

Only the first path is the normal local business profile. None of these paths
belongs to the installer payload. The clean pilot profile is a separately
audited runtime profile on the managed pilot machine, not data copied into the
application package.

The smoke command starts the packaged backend through Electron
`utilityProcess`, runs SQLite migrations into the application data directory,
loads the packaged React/Vite renderer through the restricted `eky://app`
protocol, checks `/health`, and renders a synthetic invoice PDF with the
packaged PDFKit stack. It also creates a synthetic approved invoice through
the authenticated backend routes and loads its current PDF into the secured
Electron preview window. The Chromium PDF component is enabled only for that
sandboxed preview window, and the smoke check verifies that the window paints
non-blank content in addition to loading the authenticated PDF response. Smoke
also verifies that the sandbox-compatible CommonJS preload exposes only the
named PDF preview, operational log folder, and support bundle capabilities to
the packaged renderer. It checks the Diagnostics HTTP endpoint and the actual
packaged Diagnostics view, and exercises the operational log folder capability
with a main-process stub so no Explorer window is opened. Smoke data is written
under a random operating-system temporary directory and removed after the
check.

The packaged smoke uses two Electron processes for restore acceptance. The
first process creates and inspects an encrypted synthetic profile backup,
mutates the active profile, sets a synthetic `safeStorage` SMTP secret, stages
the restore and activates it. The runner then starts a second process against
the restored profile. Before backend startup it compares the exact SQLite file
with the backup hash; after startup it compares the authoritative invoice PDF
catalog, proves that the later mutation disappeared, that the machine-local
secret remained outside the backup, and that the runtime session changed. It
then creates and inspects a second backup and removes the synthetic secret.

Early startup failures are reduced to an allowlisted code for smoke and a
fixed Finnish message for users. Raw module errors, stack traces, ASAR paths
and local user paths are not shown. Once the operational logger exists, the
same boundary records only a safe `desktop.bootstrapFailed` event.

The support bundle capability accepts no renderer arguments. Electron main
owns the confirmation, backend request with the runtime session, save dialog,
strict response parsing, archive creation, and file write. Browser development
does not expose support bundle export. The resulting `.json.gz` file is a
sanitized gzip JSON diagnostic artifact, not an encrypted backup.

For local inspection without opening event contents by default, run:

```text
pnpm support:inspect -- "C:\path\eky-support-2026-07-28.json.gz"
```

The development-only inspector validates the bounded gzip/JSON artifact,
format version and section checksums regardless of the file extension. It also
accepts legacy `.ekysupport` archives. 7-Zip can extract `.json.gz` directly
to JSON, but `support:inspect` is the official validation method. Eky does not
create a ZIP archive or invoke an external Windows compression process.
Packaged smoke keeps its own validator; the production runtime does not depend
on the inspector script.

Operational logs are stored below Electron's fixed user-data root. On Windows
the default location is `%APPDATA%\Eky\runtime\logs`. The renderer cannot
choose this path. Every desktop launch creates a new runtime instance ID that
is shared with its managed backend for diagnostics only; it is not a session,
user identity, permission, or installation identifier.

The optional delivered-invoice PDF archive is machine-local and owned by
Electron main. A selected directory is persisted only after the application
proves the exact exclusive-temp, write, fsync and hard-link finalization used
for real archive copies. Archive delivery tasks survive restart in a bounded
retry journal. A missing directory leaves the already completed invoice
delivery unchanged, while an existing file with different content is treated
as a non-overwriting conflict. The renderer receives neither the raw path nor
invoice, document or delivery identifiers through the archive status API.

See `docs/architecture/release-versioning-policy.md` for version and build
identity rules. Backup/restore and installer/update boundaries are documented
in:

- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
- `docs/architecture/windows-installer-and-update-plan.md`
