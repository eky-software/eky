import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { registerAcceptanceCommandEntrypointContracts } from './acceptanceCommandEntrypointContract.mjs';

const WORKFLOW_URL = new URL(
  '../../../../../.github/workflows/windows-acceptance-v2-legacy-diagnostic.yml',
  import.meta.url,
);

test('shared feasibility binds the verified SDK before every process-contract mode', async () => {
  const source = await readFile(new URL(
    '../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml',
    import.meta.url,
  ), 'utf8');
  const bindingIndex = source.indexOf('      - name: Bind the verified SDK executable for all process contracts');
  assert.ok(bindingIndex >= 0);
  const nextStep = source.indexOf('\n      - name:', bindingIndex + 1);
  const binding = source.slice(bindingIndex, nextStep);
  assert.doesNotMatch(binding, /\bif:\s|inputs\.mode/u);
  assert.match(binding, /Get-Command dotnet\.exe -CommandType Application -ErrorAction Stop/u);
  assert.match(binding, /IsPathFullyQualified\(\$dotnet\)/u);
  assert.match(binding, /& \$dotnet --version/u);
  assert.match(binding, /EKY_DOTNET_EXE=\$dotnet/u);
  const contractJob = source.slice(source.indexOf('  job-object-feasibility:'), source.indexOf('  packaged-boundary-diagnostic:'));
  assert.equal(contractJob.match(/EKY_DOTNET_EXE=\$dotnet/gu)?.length, 1);
  assert.ok(bindingIndex < source.indexOf('      - name: Build Windows process supervisor'));
  assert.ok(bindingIndex < source.indexOf('      - name: Run supervisor unit and process contracts'));
});

test('packaged boundary diagnostic reuses exact artifacts without becoming a normal acceptance gate', async () => {
  const source = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const diagnostic = source.slice(source.indexOf('  packaged-boundary-diagnostic:'));
  assert.match(diagnostic, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'packaged-boundary-diagnostic'/u);
  assert.match(source, /job-object-feasibility:\s+if: inputs\.mode != 'packaged-boundary-diagnostic'/u);
  assert.match(diagnostic, /diagnosticOnly = \$true/u);
  assert.match(diagnostic, /harnessRevision = \$head; artifactBuildRevision = \$env:EXPECTED_BUILD_REVISION/u);
  assert.match(diagnostic, /artifact-ids: \$\{\{ inputs\.artifact_id \}\}/u);
  assert.match(diagnostic, /run-id: \$\{\{ inputs\.artifact_run_id \}\}/u);
  assert.match(diagnostic, /repository: \$\{\{ github\.repository \}\}/u);
  assert.match(diagnostic, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/u);
  assert.doesNotMatch(diagnostic, /artifact:build|package:windows|upload-artifact|retry|continue-on-error|permissions:\s+contents: write/u);
  assert.ok(diagnostic.indexOf('Validate closed diagnostic identity') < diagnostic.indexOf('uses: actions/download-artifact'));
  assert.match(diagnostic, /\$commandExit = \$LASTEXITCODE/u);
  assert.match(diagnostic, /--command-exit \$commandExit/u);
  assert.match(diagnostic, /\$commandExit -ne 0 -or \$LASTEXITCODE -ne 0/u);
  assert.match(diagnostic, /always\(\) && steps\.download\.outcome == 'success'/u);
  assert.match(diagnostic, /inputs\.artifact_kind == 'legacy' && 37 \|\| 30/u);
  assert.match(diagnostic, /inputs\.artifact_kind == 'legacy' && 27 \|\| 25/u);
});

test('external inspector capture is opt-in and never replaces command or artifact outcomes', async () => {
  const source = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const diagnostic = source.slice(source.indexOf('  packaged-boundary-diagnostic:'));
  assert.match(source, /inspector_capture:[\s\S]*?type: boolean\s+default: false/u);
  assert.match(diagnostic, /if: inputs\.inspector_capture && inputs\.artifact_kind == 'legacy'/u);
  assert.ok(diagnostic.indexOf('-Mode start') < diagnostic.indexOf('Run existing caller and mandatory result verifier once'));
  assert.ok(diagnostic.indexOf('-Mode stop') > diagnostic.indexOf('--command-exit $commandExit'));
  assert.match(diagnostic, /always\(\) && \(steps\.capture\.outcome == 'success' \|\| steps\.capture\.outcome == 'failure' \|\| steps\.capture\.outcome == 'cancelled'\)/u);
  assert.match(diagnostic, /always\(\) && steps\.capture_stop\.outcome == 'success'/u);
  assert.ok(diagnostic.indexOf('Reverify immutable artifact') < diagnostic.indexOf('-Mode analyze'));
  assert.doesNotMatch(diagnostic, /continue-on-error|upload-artifact|wpr.*-cancel|symbols/u);
});

test('inspector analysis diagnosis reuses one native hold without a packaged lifecycle', async () => {
  const source = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const job = source.slice(source.indexOf('  job-object-feasibility:'), source.indexOf('  packaged-boundary-diagnostic:'));
  const steps = job.slice(job.indexOf('      - name: Start bounded inspector analysis fixture capture'));
  assert.match(job, /inputs\.mode == 'inspector-external-diagnostic'\) && '\[1\]'/u);
  assert.match(steps, /--test-name-pattern="\^legacy fixed command entrypoint completes the real phase chain: productInspectionNativeHold\$"/u);
  assert.match(steps, /legacyCommandEntrypoint\.process\.test\.mjs/u);
  assert.ok(steps.indexOf('-Mode start') < steps.indexOf('node --test'));
  assert.ok(steps.indexOf('-Mode stop') > steps.indexOf('node --test'));
  assert.ok(steps.indexOf('-Mode analyze') > steps.indexOf('-Mode stop'));
  assert.match(steps, /always\(\).*steps\.inspector_analysis_start\.outcome != 'skipped'/u);
  assert.match(steps, /always\(\).*steps\.inspector_analysis_stop\.outcome == 'success'/u);
  assert.match(steps, /\$exitCode = \$LASTEXITCODE/u);
  assert.match(steps, /\$summaries\.Count -ne 1/u);
  assert.match(steps, /comCreationStarted/u);
  assert.match(steps, /switchIntervalAfterLastEvent/u);
  assert.doesNotMatch(job, /download-artifact|upload-artifact|package:windows|artifact:build|continue-on-error|retry/u);
});

test('external-only inspector diagnosis uses one real query and two views of one stopped trace', async () => {
  const source = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const job = source.slice(source.indexOf('  job-object-feasibility:'), source.indexOf('  packaged-boundary-diagnostic:'));
  assert.match(job, /inputs\.mode == 'inspector-external-diagnostic'\) && '\[1\]'/u);
  assert.match(job, /--test-name-pattern="\^legacy fixed command entrypoint completes the real phase chain: productInspectionReadOnly\$"/u);
  assert.ok(job.indexOf('-Mode start') < job.indexOf('productInspectionReadOnly'));
  assert.ok(job.indexOf('-Mode stop') > job.indexOf('productInspectionReadOnly'));
  assert.ok(job.indexOf('-Mode compareEvents') > job.indexOf('-Mode stop'));
  assert.match(job, /always\(\) && inputs\.mode == 'inspector-external-diagnostic' && steps\.inspector_analysis_stop\.outcome == 'success'/u);
  assert.doesNotMatch(job, /download-artifact|upload-artifact|artifact:build|package:windows|continue-on-error|retry/u);
});

test('V2.5 phase acceptance requires all same-revision contract groups before its producer', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  const contracts = source.slice(source.indexOf('  legacy_contracts:'), source.indexOf('  legacy_artifact_producer:'));
  const producer = source.slice(source.indexOf('  legacy_artifact_producer:'), source.indexOf('  legacy_consumer:'));
  assert.match(source, /name: V2\.5 packaged legacy phase acceptance/u);
  assert.match(source, /acceptanceScope = 'V2\.5-phase'/u);
  assert.match(source, /workflow_call:\s+inputs:\s+risk_plan:/u);
  assert.doesNotMatch(source.split('permissions:')[0], /push:/u);
  assert.doesNotMatch(source, /pull_request:|\bmain\b|continue-on-error|retry|workflow_run:/u);
  assert.match(source, /cancel-in-progress: false/u);
  assert.ok(contracts.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(contracts, /group: \[core, commands, legacy-entry, workspace-success-entry, workspace-fault-entry\]/u);
  assert.ok(contracts.includes('name: V2.5 ${{ matrix.group }} contracts run ${{ matrix.repetition }}'));
  assert.ok(contracts.includes('name: Run legacy ${{ matrix.group }} contracts'));
  assert.ok(contracts.includes('run: pnpm installer:test:windows-supervisor-v2-legacy-${{ matrix.group }}'));
  assert.equal(contracts.match(/run: pnpm installer:supervisor:build/gu)?.length, 1);
  assert.ok(contracts.indexOf('name: Prepare locked package manager') < contracts.indexOf('name: Build existing supervisor once'));
  assert.match(contracts, /\$actual = pnpm --version/u);
  assert.match(contracts, /Get-Content ..\/..\/package.json -Raw/u);
  assert.match(contracts, /fail-fast: false/u);
  assert.match(producer, /needs: legacy_contracts/u);
  assert.equal(source.match(/ref: \$\{\{ github\.sha \}\}/gu)?.length, 3);
  assert.equal(source.match(/EKY_DOTNET_EXE=\$dotnet/gu)?.length, 3);
});

test('legacy contract groups partition the complete existing inventory without omissions or duplicates', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const command = 'installer:test:windows-supervisor-v2-legacy';
  const names = ['core', 'commands', 'legacy-entry', 'workspace-success-entry', 'workspace-fault-entry'];
  assert.equal(scripts[command], ['pnpm installer:supervisor:build', ...names.map((name) => `pnpm ${command}-${name}`)].join(' && '));
  const groups = names.map((name) => {
    const parts = scripts[`${command}-${name}`].split(' ');
    assert.deepEqual(parts.splice(0, 3), ['node', '--test', '--test-concurrency=1']);
    return parts;
  });
  const expected = [
    ...['acceptanceCommandPhaseInput', 'boundedWindowsAdapterProcess', 'supervisorProcessLaunch',
      'buildWindowsApplicationCloseFixture', 'closedDirectoryInventory', 'inspectWindowsInstallerProductState', 'installerProductInspectionTrace',
      'installerProductOperationWorker', 'installerProductOperationProcess', 'installerProductOperationResult',
      'installerProductOperationDeadline.process', 'legacyCallerResult', 'legacyCommandCompletion.process',
      'legacyCommandEntrypoint.process', 'workspaceSuccessCommandEntrypoint.process', 'workspaceFaultCommandEntrypoint.process',
      'legacyUpgradeBudget', 'legacyUpgradeFilesystem', 'legacyUpgradeContracts', 'legacyUpgradeFailureBoundary',
      'legacyUpgradeLifecycle', 'legacyUpgradePostcondition', 'legacyUpgradeProfileEvidence', 'legacyUpgradeSourceSmoke',
      'legacyUpgradeStartupObserver', 'legacyUpgradeWindowsRuntime', 'fixtures/windowsApplicationCloseFixtureIdentity',
      'requestWindowsApplicationClose', 'legacyUpgradeAdmission', 'runLegacyUpgradeWorker',
      'upgradeRollbackPostSupervisorWindowsRuntime'].map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`),
    ...['windowsAcceptanceSupervisorResult', 'windowsAcceptanceSupervisor.contract']
      .map((name) => `installer/windows-process-supervisor/tests/${name}.test.mjs`),
  ];
  assert.equal(new Set(groups.flat()).size, expected.length);
  assert.deepEqual(groups.flat().sort(), expected.sort());
  assert.deepEqual(groups[1], ['installerProductOperationDeadline.process', 'legacyCommandCompletion.process']
    .map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`));
  assert.deepEqual(groups.slice(2), ['legacyCommandEntrypoint', 'workspaceSuccessCommandEntrypoint', 'workspaceFaultCommandEntrypoint']
    .map((name) => [`installer/windows-acceptance-harness/${name}.process.test.mjs`]));
});

test('entrypoint groups register every original command contract exactly once', async () => {
  const original = ['completed', 'blockedEvidence', 'preparationHold', 'productInspectionHold', 'scenarioHold',
    'uninstallHold', 'resultBeforeExit', 'cleanupFailed', 'scenarioAndCleanupFailed', 'removalHold',
    'publicationBeforeExit', 'productMissingResult', 'preconditionFailed', 'scenarioMissing', 'businessFailed',
    'profileChanged', 'artifactChanged'];
  const all = [];
  for (const [file, kind, extra] of [
    ['legacyCommandEntrypoint', 'legacy', ['productInspectionNativeHold', 'productInspectionReadOnly']],
    ['workspaceSuccessCommandEntrypoint', 'workspace-success', ['footprintFailed']],
    ['workspaceFaultCommandEntrypoint', 'workspace-fault', ['footprintFailed', 'sessionFailed']],
  ]) {
    const registrations = [];
    registerAcceptanceCommandEntrypointContracts(kind, (name, options, callback) => {
      registrations.push(name);
      assert.equal(typeof callback, 'function');
      assert.equal(options.timeout, name.includes('public command') ? 60_000 : 90_000);
    });
    assert.deepEqual(registrations, [
      `${kind} public command resolves the real worker and rejects an invalid artifact before installation`,
      ...[...original, ...extra].map((name) => `${kind} fixed command entrypoint completes the real phase chain: ${name}`),
    ]);
    const source = await readFile(new URL(`./${file}.process.test.mjs`, import.meta.url), 'utf8');
    assert.equal(source.match(/registerAcceptanceCommandEntrypointContracts\('/gu)?.length, 1);
    assert.ok(source.includes(`registerAcceptanceCommandEntrypointContracts('${kind}');`));
    all.push(...registrations);
  }
  assert.equal(all.length, 59);
  assert.equal(new Set(all).size, all.length);
});

test('V2.5 phase acceptance builds once and both consumers only verify and consume', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  const consumer = source.slice(source.indexOf('  legacy_consumer:'));
  assert.equal(source.match(/installer:v2-legacy-artifact:build /gu)?.length, 1);
  assert.equal(source.match(/installer:v2-legacy-artifact:verify /gu)?.length, 3);
  assert.match(consumer, /needs: legacy_artifact_producer/u);
  assert.ok(consumer.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(consumer, /max-parallel: 2/u);
  assert.equal(consumer.match(/Eky\.WindowsProcessSupervisor\.dll --legacy-command --artifact-descriptor/gu)?.length, 1);
  const command = consumer.slice(consumer.indexOf('      - name: Run existing supervised legacy lifecycle once'),
    consumer.indexOf('      - name:', consumer.indexOf('      - name: Run existing supervised legacy lifecycle once') + 1));
  assert.match(command, /\$commandExit = \$LASTEXITCODE/u);
  assert.match(command, /verifyLegacyCallerResult\.mjs.*--command-exit \$commandExit/u);
  assert.equal(command.match(/--expected-descriptor-sha256 \$env:EXPECTED_DESCRIPTOR_SHA256/gu)?.length, 2);
  assert.equal(command.match(/--expected-build-revision \$env:EXPECTED_BUILD_REVISION/gu)?.length, 2);
  assert.equal(command.match(/--result-path \$resultPath/gu)?.length, 2);
  assert.match(command, /\$commandExit -ne 0 -or \$LASTEXITCODE -ne 0/u);
  assert.doesNotMatch(consumer, /artifact:build|package:windows|installer:release/u);
  assert.match(consumer, /always\(\) && steps\.download\.outcome == 'success'/u);
  assert.match(consumer, /needs\.legacy_artifact_producer\.outputs\.descriptor_sha256/u);
  assert.match(consumer, /needs\.legacy_artifact_producer\.outputs\.build_revision/u);
  assert.doesNotMatch(source, /installer:w6b|installer:upgrade|installer:update-e2e/u);
});

test('V2.5 phase acceptance transfers only the verified short lived artifact with approved actions', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  const consumer = source.slice(source.indexOf('  legacy_consumer:'));
  assert.equal(source.match(/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/gu)?.length, 1);
  assert.equal(source.match(/actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/gu)?.length, 1);
  assert.match(source, /EKY_V25_ARTIFACT_NAME: eky-v25-phase-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.equal(source.match(/name: \$\{\{ env\.EKY_V25_ARTIFACT_NAME \}\}/gu)?.length, 1);
  assert.match(consumer, /artifact-ids: \$\{\{ needs\.legacy_artifact_producer\.outputs\.artifact_id \}\}/u);
  assert.equal(source.match(/path: \$\{\{ runner\.temp \}\}\/eky-v25-legacy-artifact/gu)?.length, 2);
  for (const setting of ['retention-days: 1', 'compression-level: 0', 'if-no-files-found: error', 'overwrite: false', 'include-hidden-files: false']) {
    assert.ok(source.includes(setting));
  }
  assert.doesNotMatch(source, /upload.*(?:log|profile)|actions\/[a-z-]+@v\d/iu);
  assert.ok(source.indexOf('Verify produced artifact before upload') < source.indexOf('uses: actions/upload-artifact@'));
});

test('V2.5 phase acceptance preserves bounded V2 jobs and locked toolchain', async () => {
  const source = await readFile(WORKFLOW_URL, 'utf8');
  for (const minutes of [10, 30, 22, 37, 27, 3]) {
    assert.match(source, new RegExp(`timeout-minutes: ${minutes}\\b`, 'u'));
  }
  assert.equal(source.match(/pnpm install --frozen-lockfile/gu)?.length, 2);
  assert.equal(source.match(/persist-credentials: false/gu)?.length, 3);
  assert.equal(source.match(/dotnet-version: 10\.0\.302/gu)?.length, 3);
  assert.match(source, /installer:verify-restore-lock/u);
  assert.match(source, /sourceArtifactClass -cne 'historical-source-rebuild'/u);
  assert.match(source, /targetPayloadIdentity -cnotmatch/u);
  assert.doesNotMatch(source, /permissions:\s+contents: write|pull-requests: write/u);
});
