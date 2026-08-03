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

Oikeaa SMTP-tunnusta saa käyttää vain erikseen hyväksytyssä, salatussa ja
käyttäjän vahvistamassa Electron-polussa. Testilähetys pakotetaan määritettyyn
testivastaanottajaan. Asiakaslähetyksen toteutus ei yksin tee keskeneräisestä
desktop-artifactista tuotantojulkaisua: oikea asiakas- ja laskutusdata sekä
normaali asiakaslähetys sallitaan vasta erillisen release security gaten,
paketointitarkistusten ja projektin omistajan hyväksynnän jälkeen.
