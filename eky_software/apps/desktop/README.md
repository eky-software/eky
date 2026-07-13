# Eky Desktop

`apps/desktop` is the secure Electron runtime shell for Eky Local. The normal
browser/Vite development workflow remains available in `apps/web`.

The initial Windows packaging spike uses synthetic data only. It is not a
production release and must not be used with real customer data or SMTP
credentials before the local-session and authorization phases are complete.

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
packaged PDFKit stack. Smoke data is written under a random operating-system
temporary directory and removed after the check.
