# Desktop Runtime Instructions

Read the root `AGENTS.md`, ADR-0007, the local desktop implementation plan,
the local desktop dependency review, the local runtime trust plan, and the
security principles before changing this package.

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

The packaging spike and local-session trust layer use synthetic data only.
Session verification is necessary but does not by itself make the incomplete
desktop release suitable for real customer data, invoice data, or SMTP
credentials.
