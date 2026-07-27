# Eky Desktop

`apps/desktop` is the secure Electron runtime shell for Eky Local. The normal
browser/Vite development workflow remains available in `apps/web`.

The initial Windows packaging spike uses synthetic data only. The Electron
runtime now creates an in-memory local session, injects it into restricted
backend requests in the main process, and lets the backend create ActorContext
only after verification. This is still not a production release and must not
be used with real customer data before the remaining release-security phases
are complete. A real SMTP credential may be used only through the encrypted
secret-store path for an explicit, confirmed DNA test-recipient check. That
controlled test path is not yet the customer delivery flow.

## Commands

From the repository root on Windows:

```text
pnpm --filter @eky/desktop package:windows
pnpm --filter @eky/desktop smoke:windows
```

The unpacked spike is created under `apps/desktop/out/Eky-win32-x64`.

The package command:

- builds web, backend, auth, permissions, and desktop artifacts
- deploys only the backend production files
- rebuilds the staged `better-sqlite3` copy for the pinned Electron ABI
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

Early startup failures are reduced to an allowlisted code for smoke and a
fixed Finnish message for users. Raw module errors, stack traces, ASAR paths
and local user paths are not shown. Once the operational logger exists, the
same boundary records only a safe `desktop.bootstrapFailed` event.

The support bundle capability accepts no renderer arguments. Electron main
owns the confirmation, backend request with the runtime session, save dialog,
strict response parsing, archive creation, and file write. Browser development
does not expose support bundle export. The resulting `.ekysupport` file is a
sanitized gzip JSON diagnostic artifact, not an encrypted backup.
