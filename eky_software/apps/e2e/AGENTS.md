# E2E Test Instructions

Read the repository root `AGENTS.md`, testing rules, security principles,
review checklist, E2E strategy, R0 E2E matrix and E2E environment document
before changing this package.

`apps/e2e` owns cross-layer system, browser and Electron development tests. It
is test infrastructure, not a business module.

Mandatory boundaries:

- use only synthetic data and loopback hosts
- keep every database, document, log, incident, temp and support path under
  the test-specific OS temp root
- refuse to run unless `EKY_E2E=1` and all safety guards pass
- never use `%APPDATA%\Eky`, repository storage, real SMTP, DNS, credentials,
  production sessions or customer/invoice data
- block non-loopback browser requests
- never add production HTTP controls, test buttons, reset endpoints or
  renderer-controlled fault injection
- keep production backend and desktop builds free of E2E entrypoints
- do not weaken Electron sandbox, fuses, navigation, permissions or preload
  boundaries for testability
- collect only bounded, synthetic failure artifacts

Use accessibility locators in this order: role, label, visible text,
placeholder. Add `data-testid` only when a meaningful accessible locator cannot
identify the target. Do not use XPath, long CSS paths, `nth-child`,
`page.waitForTimeout` or random sleeps.

Keep helpers responsibility-specific. Do not create generic `utils`,
`helpers`, `common`, base page objects, service locators or fixture dumping
grounds before concrete duplication exists.

The only dependency approved for this package at foundation time is
`@playwright/test` version `1.61.1`. No other dependency may be added without
the repository dependency approval gate.

Update `docs/architecture/r0-e2e-test-matrix.md` whenever a scenario is added,
removed, split, blocked or changes test level. Never label lower-level
coverage as implemented E2E.

Keep normal E2E and endurance separate:

- system, web and the critical Electron development project may run in pull
  request CI
- `endurance-baseline` is manual and runs only through `pnpm test:e2e:stress`
- `electron-endurance` is manual and runs only through
  `pnpm test:e2e:desktop-stress` or `pnpm test:e2e:desktop-soak`
- do not include the endurance project in the ordinary `e2e:all` command
- record each endurance run as synthetic measurement data, not as a universal
  production capacity promise
- do not add process metrics to production HTTP endpoints for testability
- restart tests must rotate the runtime session, retain only test-scoped
  persistence and prove that every managed process and port is released
