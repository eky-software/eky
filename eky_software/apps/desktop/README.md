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
Electron preview window. Smoke data is written under a random operating-system
temporary directory and removed after the check.
