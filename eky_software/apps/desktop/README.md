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
Windows installer/update architecture is accepted but remains unimplemented.
The current unpacked `out/Eky-win32-x64` directory is a development/package
artifact, not an installer or an automatically updating release.

## Commands

From the repository root on Windows:

```text
pnpm --filter @eky/desktop package:windows
pnpm --filter @eky/desktop smoke:windows
```

The unpacked spike is created under `apps/desktop/out/Eky-win32-x64`.

The packaged application version comes from `apps/desktop/package.json`.
Packaging writes a validated `dist/build-info.json` containing the version,
Git revision, UTC build time, and dirty-worktree state. A distributable
artifact must be built from a clean worktree. Development builds use the
explicit `development` revision and are marked dirty.

The package command:

- builds web, backend, auth, permissions, and desktop artifacts
- deploys only the backend production files
- validates and packages the bundled `better-sqlite3` Windows x64 N-API runtime
- packages the renderer into ASAR
- copies backend and utility-process runtime as explicit resources
- applies and verifies production Electron fuses

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
