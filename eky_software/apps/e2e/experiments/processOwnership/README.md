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

## Initial T3a checkpoint 2026-09-25

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

## Approved T3b-E dependency correction

The owner separately approved a versioned, minimal correction to
`playwright-core@1.62.1`, its regressions and the two unchanged Electron
experiments. The initial failed evidence above remains failed. The correction
observes the three concurrently started launch waits immediately, while keeping
their original promises and preserving the original launch error. Cleanup
failure or cancellation adds the closed call-log marker
`electronLaunchCleanupUnverified`; the experiment rejects such an error rather
than accepting it as the expected launch failure. Absence of that marker is not
tree-absence proof: the independent native terminal receipt is still required.

The patch belongs in `patches/playwright-core@1.62.1.patch`, with an exact pnpm
workspace mapping and lockfile identity. No runtime monkey-patching, copied
Electron launch implementation, global rejection suppression, version increase
or new dependency is authorized. The canonical package `test` command must
include the actual installed-bundle regressions, and a wiring contract protects
that inclusion. These controlled dependency tests do not launch a real Electron
process and are not R28 integration acceptance.

On a dependency update, review both patch hunks, the original registry integrity,
patched bundle digest, LICENSE/NOTICE and normal/error-path regressions. Remove
the patch only after demonstrating an equivalent upstream fix with those tests.
Keep the dependency audit, signature check, frozen installation and production
payload exclusion checks. Test evidence is recorded in the
[owning T3b-E checkpoint](../../../../docs/architecture/e2e-test-environment.md#t3b-en-täsmällinen-riippuvuusehdotus);
the existence of this maintenance contract is not a claim that these checks have
already passed.

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

## Approved T3c experiments

The owner approved the separate Windows adapter and Linux namespace experiments
on 2026-09-26. Their canonical limits and decision boundaries are in the
[T3c-W plan](../../../../docs/architecture/e2e-test-environment.md#t3c-wn-neljän-tapauksen-adapterikoe-päätösehdotus)
and [T3c-L plan](../../../../docs/architecture/e2e-test-environment.md#t3c-ln-rajattu-namespace-koe-päätösehdotus).
The four bounded Windows cases passed after implementation and independent
review; the [checkpoint](../../../../docs/architecture/e2e-test-environment.md#t3c-wn-rajatun-kokeen-checkpoint)
records their scope and unresolved earlier failures. Both first Linux CI
experiments failed before GO with `bootstrapUnknown`; the ordinary system and
web suites passed before them. The [failure checkpoint](../../../../docs/architecture/e2e-test-environment.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys)
preserves the evidence limits; neither namespace support nor a missing
prerequisite was established. Final
mechanism selection and fixture migration require a separate decision; these
experiments do not complete T3/R28. Existing T3a cases and T3b-E dependency
regressions remain unchanged.

The Windows adapter has two modes in a separate framework-dependent apphost:
an owner outside Playwright's shell/bridge subtree, and a byte-relaying bridge
passed as `executablePath`. Only the owner launches the pinned Electron binary
in its inner Job. Four cases require distinct evidence: normal Page/API and
close, Electron-created leaf before a deliberate pre-ready failure, root exit
with remaining descendants, and deliberate bridge exit with a live runtime.
The last case is an expected workload failure, never a successful workload.
The driver must accept the inner terminal and owner exit before exiting itself.
The unchanged T3a native owner supplies outer emergency containment; any outer
intervention rejects the adapter experiment. The external sentinel must answer
fresh challenges before and after that boundary and then exit separately.

The private configuration binds a fresh generation, one-use launch nonce,
executable, working directory and explicit isolated environment. The caller
uses one named-pipe session with monotonically increasing request sequences.
Control frames are at most 4 KiB including their delimiter; stdout and stderr
are separate bounded byte channels, not a reimplementation of Playwright's
debugger protocol. Disk and pipe terminals have separate closed schemas.
Raw failures and paths stay in the retained synthetic OS-temp root. A failed
or unverified experiment never deletes that root or starts the next case.

Pure Node contracts are reached by the ordinary `@eky/e2e` test command. They
do not launch these experiments. Native protocol tests and offline apphost
prerequisites must also pass, followed by independent review, before running
the four-case Windows experiment. No application, installer, normal E2E fixture,
timeout or release version is changed by this experiment.

After those gates, build and inspect the separate apphost with the existing
Windows toolchain. Its NuGet configuration has no package sources: an absent
SDK/framework/apphost pack is a prerequisite failure, not permission to install.

```powershell
dotnet build apps/e2e/experiments/processOwnership/adapterNative/Eky.ProcessOwnershipAdapter.csproj --configuration Release
$adapter = (Resolve-Path apps/e2e/.artifacts/t3c-adapter/bin/Eky.ProcessOwnershipAdapter/release_win-x64/Eky.ProcessOwnershipAdapter.exe).Path
$env:DOTNET_ROOT = Split-Path (Get-Command dotnet.exe).Source
& $adapter --self-test
$env:EKY_E2E = '1'
node apps/e2e/experiments/processOwnership/runWindowsAdapterExperiment.mjs --dotnet (Get-Command dotnet.exe).Source --adapter $adapter normal
```

The unchanged T3a native assembly must already be available at its documented
artifact location. Inspect the complete normal result before invoking any of
`beforeReady`, `rootFirst` or `bridgeExit`, one case at a time. Preserve the first
failure and stop subsequent cases. The runner retains each root, raw bounded
diagnostics, inner/outer receipts, sentinel checks and executable digests; do
not publish those local files. Only validated control-channel messages establish
readiness or terminal state. Standard output is diagnostic/byte relay only.

Root exit and stream closure are separate observations. In a root-first case,
the driver first proves that the root exited while descendants remain, then
requests the owner's tree stop before awaiting the bridge's closed streams.
Waiting for bridge closure before that stop can form a cycle when a surviving
writer retains a stream. This ordering does not permit dropped output, a longer
deadline, or a weaker terminal receipt. A bridge drain record is supplementary
pre-exit evidence, never proof that a process exited. Failed Playwright launch
does not expose a public process handle; its intended bridge exit code must not
be reported as an observed exit code.

The Linux experiment is an explicit, default-off
`linux_pid_namespace_experiment` input on the existing caller/reusable chain.
Each existing Linux job first completes its ordinary test command successfully.
Only then may the bounded experiment use the already available `unshare` tool;
there is no installation, privilege fallback or change to existing test status.
The approved namespace capabilities, lifecycle proof, deadlines and closed CI
result are defined in the owning plan. A negative prerequisite observation is
not ownership support, and an unknown or post-launch failure is not a skip.

The approved T3c-LD follow-up added only bounded startup diagnostics. Its result
schema was version 2, with a nullable, strictly validated `bootstrapDiagnostic`.
Version 1 results remain historical evidence, not new diagnostics. Init can
attempt one 128-byte ASCII failure marker before GO; it never waits for that
write or retries it. The driver reports closed categories from its bootstrap
decision snapshot, never raw stderr, process IDs, identity values or paths.
A marker is not READY, proof of cleanup, or permission to classify a failure
as a missing prerequisite. Original classification and all budgets remain.
See the [owning LD scope](../../../../docs/architecture/e2e-test-environment.md#t3c-ld-rajatun-käynnistysdiagnostiikan-päätösehdotus).
The [LD CI result](../../../../docs/architecture/e2e-test-environment.md#t3c-ldn-rajatun-ci-kokeen-havainto)
remains failed before READY in both consumers; all other test groups passed.
The [LS follow-up proposal](../../../../docs/architecture/e2e-test-environment.md#t3c-ls-suljetun-stderr-luokan-tarkennuksen-päätösehdotus)
was approved on 2026-09-26. Its exact-message diagnostic table and schema 3
passed regression tests and independent source/reader review; one new observed
CI cycle is next. The table applies only before READY and GO, after wrapper
close and stderr end without read/size failure. It never changes acceptance.
Schemas 1/2 remain historical evidence; do not reinterpret earlier results.
