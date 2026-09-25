# T3a process ownership experiment

Manual, Windows-only feasibility evidence for
[T3](../../../../docs/architecture/e2e-test-environment.md#t3-koko-prosessipuun-poistumistodiste).
This is not an ordinary fixture adapter, a production feature, an installer
protocol change, or acceptance of R28. Linux inspection has a separate
read-only scope. Do not run this against an application or real company profile.

## Scope

The experiment links existing Windows Job primitives into a separate native
owner without changing their sources. The owner creates the synthetic Node
driver suspended and atomically assigned to a non-inherited, kill-on-close Job.
Only verified membership permits resume. The whole Playwright driver, including
its Electron descendants, runs inside that Job. This does not replace the
Electron executable with a transparent wrapper.

The parent generates an isolated direct child of the canonical OS temporary
directory. Copies are independent files, never hardlinks. Child temporary,
profile and Electron storage locations are contained in the case directory.
The launch environment excludes inherited execution hooks and unrelated values.
The Electron page is static, hidden and sandboxed; external page requests,
navigation, new windows and permissions are denied. Playwright's local debug
connections are part of the synthetic tree, not an exposed EKY backend.

Cases:

- `nodeStop`: stop while root and detached, portless leaf are alive.
- `nodeRootFirst`: root exits successfully while its leaf remains alive.
- `nodeRootFailure`: root exits with 23 while its leaf remains alive.
- `electronNormal`: real Playwright launch, isolated paths, arguments,
  environment, bounded stdout/stderr, hidden sandboxed window and normal close.
  Process identity and application/process exit order are observations, not
  assumptions about which process `application.process()` represents.
- `electronLaunchFailure`: Electron deliberately exits before ready; launch
  must reject without a launch timeout. A separately acknowledged leaf inside
  the same owned driver session survives until Job cleanup.

The last case is intended to test session cleanup after launch rejection. It does not
prove that the surviving leaf was an Electron child or that every Playwright
launch-failure branch has been tested.

## Manual execution

Use existing approved Windows Node, .NET 10 and locked workspace dependencies.
Do not install or change tools to satisfy an unmet prerequisite automatically.
From the `eky_software` directory in Windows PowerShell:

```powershell
node --test apps/e2e/experiments/processOwnership/experimentContract.test.mjs
dotnet build apps/e2e/experiments/processOwnership/native/Eky.ProcessOwnershipExperiment.csproj --configuration Release --artifacts-path apps/e2e/.artifacts/t3a-native
$env:EKY_E2E = '1'
node apps/e2e/experiments/processOwnership/runExperiment.mjs --dotnet (Get-Command dotnet.exe).Source nodeStop
```

First inspect the `nodeStop` result and receipt. Only then run the other cases
by replacing `nodeStop` with explicit case names from the list above. No normal
test command or CI workflow invokes this experiment. Run serially with active
monitoring and retain the first failure before modifying or repeating anything.

## Evidence and failure handling

The runner prints the private temporary root. Each case preserves `owned.json`,
`workload.json`, `root-exited.json` when observed, and `terminal.json`; the root
contains `summary.json` with the native artifact digest. Native publication is
create-new plus rename. Generation and case must match before acceptance.
Logs with `.private.log` suffix and the complete temporary root remain local.
Never commit, upload or copy host-specific evidence into shared documentation.

Root exit alone is not a cleanup receipt. The native owner must report settled
creation, root exit where applicable, and zero active Job members. Failure or
missing evidence prevents the next case and leaves the root intact. A deliberate
workload exit 23 remains 23; a successful feasibility assertion is not a passing
production test. The normal Electron case may briefly have Job members after
driver exit; only eventual native whole-tree absence permits acceptance.

The native session has a 30-second total experiment budget with 5 seconds
reserved for cleanup. The runner's independent 35-second watchdog can terminate
only its directly spawned, still-open owner process handle. Kill-on-close is
emergency containment, not an absence receipt: this path cannot pass. These are
new experiment budgets, not changes to existing tests or CI. If owner exit or
tree absence cannot be verified, stop, retain evidence and resolve ownership
before any cleanup or restart; never use PID/name searches or broad taskkill.

This prototype does not yet prove launch cancellation during native creation,
owner crash, foreign receipt, restart rejection, outside-sentinel survival or
Linux cgroup ownership. Contract tests are not substitutes for those real
process cases. Ordinary fixture migration and final T3 acceptance require the
owner-approved session contract, platform prerequisites and full matrix.

## Checkpoint 2026-09-25

Feasibility observations are complete, not all accepted: the three Node cases
and normal Electron case passed. `electronLaunchFailure` remains failed.
Its before-ready fault was reached, but Playwright emitted an unhandled
`Process failed to launch!` rejection during launch. The fixture fails on that
event; it is not converted into the expected, caught launch rejection.
The first failure and two separately instrumented diagnostic attempts remain
retained. Neither the fault trigger nor the timeouts/assertions were weakened.

The native receipts reported settled creation and an empty owned Job also in
the failed attempts. Their overall runner result remains failed with
`terminalAccepted=false` and conservative `cleanupUnverified`; a late raw
receipt alone does not grant permission to restart or delete a fixture.
Normal Electron's `application.process()` did not identify its main process;
the future adapter must preserve that distinction instead of equating the two.

There has been no fixture migration, dependency change, ordinary CI run or
PR/main acceptance for this experiment. Next decisions and the complete
remaining acceptance matrix stay in the owning T3 plan. Do not bypass the
unhandled rejection or modify installed dependency code to make the case green.

## T3b-L read-only CI prerequisites

The separately approved prerequisite probe does not run the Windows experiment
or a Linux workload. It inspects only its own cgroup v2 mapping and bounded
metadata, using Node builtins. It never writes a cgroup, reads a process member
list, queries systemd, installs tools or changes permissions.

Use the existing **V2 risk-based CI** manual dispatch with
`linux_ownership_prerequisites=true`. The default remains false. The probe runs
inside each existing Linux system/web test step immediately before its normal
command, after the normal dependency/browser preparation. This dispatch still
runs the complete existing CI matrix; it is not a probe-only workflow.

The entrypoint requires `EKY_E2E=1`, the GitHub Actions context, a validated
run ID/attempt, and the actual checkout SHA read by the step. Do not substitute
a PR head SHA for a merge checkout. Its single bounded JSON line contains only
closed observations and CI binding. The step separately records the closed
`LINUX_PREREQUISITE_EXIT_OK` or `LINUX_PREREQUISITE_EXIT_UNVERIFIED` marker.
Only a complete, matching JSON result AND normal exit permit an observation
to be used; an already queued JSON line cannot erase a later output deadline.
There is no separate artifact. Paths,
process IDs, accounts, environment contents and raw failures are not published.

An incomplete or missing observation remains unverified. A complete negative
observation is not Linux ownership support. Access metadata is only a hint:
it cannot prove child creation, migration, termination, reaping or owner-loss
cleanup. The normal test always runs independently and its exit status is kept.

`pnpm test:ci` and the CI cadence contracts include the pure parser/schema/
redaction tests and the workflow wiring contract. The latter uses the existing
Bash tool with inert shell functions on both runner platforms, never the host
probe or a real E2E workload. Real Linux metadata is collected only in the
explicitly enabled CI steps. Final T3 ownership acceptance remains separate.
