import assert from 'node:assert/strict';
import { withoutOptionalEvidenceAllowance } from '../../../../../.github/scripts/ciFailureEvidenceTestContract.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(ROOT, '../../../../../.github/workflows/windows-acceptance-v2-workspace.yml');

function assertArtifactOnlyScope(source) {
  const call = source.split('  workflow_call:')[1].split('  workflow_dispatch:')[0];
  assert.doesNotMatch(call, /artifact_only/);
  assert.match(source, /workflow_dispatch:\s+inputs:\s+artifact_only:\s+description: [^\n]+\s+type: boolean\s+default: false/);
  const success = source.split('  workspace_consumer:')[1].split('  workspace_fault_consumer:')[0];
  const fault = source.split('  workspace_fault_consumer:')[1];
  assert.match(success, /if: github\.event_name != 'workflow_dispatch' \|\| inputs\.artifact_only != true/);
  assert.ok(fault.includes("if: (github.event_name != 'workflow_dispatch' || inputs.artifact_only != true) && (inputs.risk_plan == '' || fromJSON(inputs.risk_plan).gates.workspaceFault)"));
  const preparation = source.split('jobs:')[1].split('  workspace_consumer:')[0];
  assert.doesNotMatch(preparation, /inputs\.artifact_only/);
}

test('artifact-only preparation is explicit manual scope and cannot replace ordinary acceptance', async () => {
  assertArtifactOnlyScope(await readFile(WORKFLOW, 'utf8'));
});

function prerequisiteJob(source, name) {
  const sections = source.split(`\n  ${name}:\n`);
  assert.equal(sections.length, 2, `Missing or duplicate workspace job: ${name}`);
  return sections[1].split(/\n  [\w-]+:\n/u)[0];
}

function assertWorkspacePrerequisites(source) {
  assertArtifactOnlyScope(source);
  assert.match(source, /workflow_call:\n    inputs:\n      risk_plan:\n        type: string\n        required: true\n  workflow_dispatch:/u);
  const setup = ['Check out repository', 'Set up Node.js'];
  const contracts = [
    ...setup, 'Prepare locked package manager', 'Install dependencies',
    'Verify workspace artifact behavior and workflow contract',
    'Verify encrypted evidence contracts without MSI',
    'Verify workspace lifecycle and read-only Windows adapters',
    'Verify workspace fault lifecycle and terminal contracts',
    'Set up .NET SDK for command contracts', 'Verify mandatory caller results and bounded phase writer',
    'Preserve encrypted CI failure evidence',
  ];
  const producer = [
    ...setup, 'Set up .NET SDK', 'Verify exact .NET SDK', 'Prepare locked package manager',
    'Install dependencies', 'Verify packaged smoke driver contracts without MSI',
    'Restore locked WiX toolchain', 'Build workspace artifact once',
    'Verify produced workspace artifact', 'Upload exact workspace artifact',
    'Preserve encrypted CI failure evidence',
  ];
  for (const [id, minutes, names] of [
    ['workspace_artifact_contracts', 10, contracts], ['workspace_artifact_producer', 30, producer],
  ]) {
    const job = prerequisiteJob(source, id);
    const header = job.split('    steps:\n')[0];
    assert.deepEqual(header.match(/^    runs-on: .+$/gmu), ['    runs-on: windows-latest']);
    assert.deepEqual(header.match(/^    timeout-minutes: .+$/gmu), [`    timeout-minutes: ${minutes}`]);
    assert.deepEqual(header.match(/^        working-directory: .+$/gmu), ['        working-directory: eky_software']);
    assert.deepEqual(header.match(/^    needs: .+$/gmu) ?? [],
      id === 'workspace_artifact_producer' ? ['    needs: workspace_artifact_contracts'] : []);
    assert.doesNotMatch(header, /^    (?:if|continue-on-error):/mu);
    const required = withoutOptionalEvidenceAllowance(job, 1);
    assert.doesNotMatch(required, /continue-on-error:/u);
    const steps = job.split(/(?=^      - )/mu).slice(1).map(value => value.trimEnd());
    assert.deepEqual(steps.map(step => step.split('\n')[0]), names.map(name => `      - name: ${name}`));
    for (const step of steps.slice(0, -1)) {
      assert.doesNotMatch(step, /^        if:|\|\||;\s*exit 0|\n\s+exit 0|\$LASTEXITCODE\s*=\s*0/mu);
      if (!step.startsWith('      - name: Prepare locked package manager\n')) {
        assert.doesNotMatch(step, /^        working-directory:/mu);
      }
    }
    const step = name => steps[names.indexOf(name)];
    assert.equal(step('Prepare locked package manager'),
      '      - name: Prepare locked package manager\n        working-directory: .\n        run: node .github/scripts/prepareLockedPnpm.mjs');
    assert.equal(step('Install dependencies'), '      - name: Install dependencies\n        run: pnpm install --frozen-lockfile');
    assert.equal(step('Check out repository'), [
      '      - name: Check out repository',
      '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      '        with:', '          persist-credentials: false',
      ...(id === 'workspace_artifact_producer' ? ['          fetch-depth: 0'] : []),
    ].join('\n'));
    assert.equal(step('Set up Node.js'), [
      '      - name: Set up Node.js',
      '        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
      '        with:', '          node-version-file: eky_software/.node-version',
      '          package-manager-cache: false',
    ].join('\n'));
    const dotnet = id === 'workspace_artifact_producer' ? 'Set up .NET SDK' : 'Set up .NET SDK for command contracts';
    assert.equal(step(dotnet), [
      `      - name: ${dotnet}`,
      '        uses: actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
      '        with:', '          dotnet-version: 10.0.302',
    ].join('\n'));
    const commands = id === 'workspace_artifact_contracts' ? {
      'Verify workspace artifact behavior and workflow contract': 'installer:test:windows-acceptance-workspace-artifact',
      'Verify encrypted evidence contracts without MSI': 'installer:test:encrypted-evidence:core',
      'Verify workspace lifecycle and read-only Windows adapters': 'installer:test:windows-acceptance-workspace',
      'Verify workspace fault lifecycle and terminal contracts': 'installer:test:windows-acceptance-workspace-fault',
      'Verify mandatory caller results and bounded phase writer': 'installer:test:windows-acceptance-phase-writer',
    } : {
      'Verify packaged smoke driver contracts without MSI': 'installer:test:packaged-smoke-driver',
      'Restore locked WiX toolchain': 'installer:verify-restore-lock',
    };
    for (const [name, command] of Object.entries(commands)) assert.equal(step(name),
      `      - name: ${name}\n        run: pnpm --filter @eky/desktop ${command}`);
    if (id === 'workspace_artifact_producer') {
      assert.equal(step('Verify exact .NET SDK'), [
        '      - name: Verify exact .NET SDK', '        shell: pwsh', '        run: |',
        "          if ((dotnet --version) -ne '10.0.302') { throw 'WINDOWS_ACCEPTANCE_WORKSPACE_DOTNET_SDK_INVALID' }",
      ].join('\n'));
      assert.deepEqual(step('Build workspace artifact once').match(/^        timeout-minutes: .+$/gmu),
        ['        timeout-minutes: 22']);
      assert.match(step('Build workspace artifact once'), /if \(\$LASTEXITCODE -ne 0\) \{ throw 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_FAILED' \}/u);
      assert.match(step('Verify produced workspace artifact'), /if \(\$LASTEXITCODE -ne 0\) \{ throw 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_VERIFICATION_FAILED' \}/u);
    }
  }
  for (const id of ['workspace_consumer', 'workspace_fault_consumer']) {
    assert.deepEqual(prerequisiteJob(source, id).match(/^    needs: .+$/gmu),
      ['    needs: workspace_artifact_producer']);
  }
}

test('workspace prerequisites require core then the prepared driver before WiX, build, verification and upload', async () => {
  assertWorkspacePrerequisites((await readFile(WORKFLOW, 'utf8')).replaceAll('\r\n', '\n'));
});

test('workspace prerequisite wiring rejects omitted, masked, conditional and reordered 10+1 routes', async () => {
  const source = (await readFile(WORKFLOW, 'utf8')).replaceAll('\r\n', '\n');
  assertWorkspacePrerequisites(source);
  const driver = '      - name: Verify packaged smoke driver contracts without MSI\n        run: pnpm --filter @eky/desktop installer:test:packaged-smoke-driver';
  for (const id of ['workspace_artifact_contracts', 'workspace_artifact_producer']) {
    const job = prerequisiteJob(source, id);
    const marker = id === 'workspace_artifact_producer' ? driver :
      '      - name: Verify encrypted evidence contracts without MSI\n        run: pnpm --filter @eky/desktop installer:test:encrypted-evidence:core';
    for (const changed of [
      job.replace(marker, ''), job.replace(marker, `${marker}\n${marker}`),
      job.replace(marker, marker.replace('without MSI', 'renamed')),
      job.replace('runs-on: windows-latest', 'runs-on: ubuntu-latest'),
      job.replace('timeout-minutes: ' + (id === 'workspace_artifact_producer' ? 30 : 10), 'timeout-minutes: 60'),
      job.replace('working-directory: eky_software', 'working-directory: .'),
      ...['if: false', "if: inputs.risk_plan != ''", 'if: inputs.artifact_only != true',
        "if: vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT != ''", 'continue-on-error: true']
        .map(line => job.replace('    runs-on:', `    ${line}\n    runs-on:`)),
      ...['Install dependencies', marker.split('\n')[0].slice('      - name: '.length),
        ...(id === 'workspace_artifact_producer' ? ['Restore locked WiX toolchain', 'Build workspace artifact once',
          'Verify produced workspace artifact', 'Upload exact workspace artifact'] : [])]
        .flatMap(name => ['if: always()', 'if: false', 'continue-on-error: true'].map(line =>
          job.replace(`      - name: ${name}\n`, `      - name: ${name}\n        ${line}\n`))),
      job.replace(marker, `${marker} || true`), job.replace(marker, `${marker}\n          exit 0`),
      job.replace(marker, marker.replace('        run:', '        working-directory: .\n        run:')),
      job.replace('pnpm install --frozen-lockfile', 'pnpm install'),
      job.replace('node .github/scripts/prepareLockedPnpm.mjs', 'node --version'),
    ]) {
      assert.notEqual(changed, job);
      assert.throws(() => assertWorkspacePrerequisites(source.replace(job, changed)), { code: 'ERR_ASSERTION' });
    }
  }
  const producer = prerequisiteJob(source, 'workspace_artifact_producer');
  for (const name of ['Check out repository', 'Set up Node.js', 'Set up .NET SDK', 'Verify exact .NET SDK',
    'Prepare locked package manager', 'Install dependencies', 'Build workspace artifact once',
    'Verify produced workspace artifact', 'Upload exact workspace artifact']) {
    const reordered = producer.replace(driver, '').replace(`      - name: ${name}\n`, `${driver}\n      - name: ${name}\n`);
    assert.notEqual(reordered, producer);
    assert.throws(() => assertWorkspacePrerequisites(source.replace(producer, reordered)), { code: 'ERR_ASSERTION' });
  }
  for (const [before, after] of [
    ['needs: workspace_artifact_contracts', 'needs: []'],
    ['    needs: workspace_artifact_contracts\n', ''],
    ['timeout-minutes: 22', 'timeout-minutes: 30'],
    ['installer:test:packaged-smoke-driver', 'installer:test:encrypted-evidence'],
    ['dotnet-version: 10.0.302', 'dotnet-version: 10.0.x'],
  ]) {
    const changed = producer.replace(before, after);
    assert.notEqual(changed, producer);
    assert.throws(() => assertWorkspacePrerequisites(source.replace(producer, changed)), { code: 'ERR_ASSERTION' });
  }
  for (const id of ['workspace_consumer', 'workspace_fault_consumer']) {
    const consumer = prerequisiteJob(source, id);
    assert.throws(() => assertWorkspacePrerequisites(source.replace(consumer,
      consumer.replace('needs: workspace_artifact_producer', 'needs: workspace_artifact_contracts'))), { code: 'ERR_ASSERTION' });
  }
});

test('V2.6 contract checkpoint is a bounded read-only-permission Windows job with pinned actions', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /(?:contents|actions|pull-requests): write/);
  assert.match(source, /runs-on: windows-latest/);
  assert.match(source, /timeout-minutes: 10/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /pnpm install --frozen-lockfile/);
  const actions = [...source.matchAll(/uses: ([^\s]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)], [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
    './.github/actions/collect-ci-failure-evidence',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  ]);
});

test('V2.6 fast checkpoint runs its executable contracts, not a packaged acceptance substitute', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.match(source, /pnpm --filter @eky\/desktop installer:test:windows-acceptance-workspace-artifact/);
  const script = desktop.scripts['installer:test:windows-acceptance-workspace-artifact'];
  assert.equal(script, 'node --test --test-concurrency=1 --test-reporter=../../test-reporters/nodeFailureReporter.mjs installer/windows-acceptance-harness/workspaceSuccessArtifact.test.mjs installer/windows-acceptance-harness/workspaceSuccessArtifactWorkflow.test.mjs');
  const contracts = source.split('  workspace_artifact_producer:')[0];
  assert.doesNotMatch(contracts, /installer:v2-workspace-artifact:build|msiexec|upload-artifact|installer:w6b2/);
});

test('V2.6 runtime checkpoint executes lifecycle, failure and read-only Windows adapter behavior', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.match(source, /pnpm --filter @eky\/desktop installer:test:windows-acceptance-workspace\s/);
  const script = desktop.scripts['installer:test:windows-acceptance-workspace'];
  assert.equal(script, 'pnpm e2e:prepare-electron-runtime && pnpm e2e:build && node --test --test-concurrency=1 --test-reporter=../../test-reporters/nodeFailureReporter.mjs ' + [
    'workspaceInstallationObservation',
    'workspaceSuccessContracts', 'workspaceSuccessLifecycle', 'workspaceSuccessWindowsRuntime',
    'workspaceSuccessFailureBoundary', 'inspectWorkspaceSuccessMsiActivity',
    'workspaceSuccessProfileEvidence', 'workspaceSuccessPostcondition',
    'workspaceSuccessSessionProof',
    'runWorkspaceSuccessWorker', 'workspaceCommandAdmission',
  ].map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`).join(' '));
  assert.equal(desktop.scripts['installer:v2-workspace-success'],
    'pnpm installer:supervisor:build && pnpm e2e:prepare-electron-runtime && pnpm e2e:build && dotnet installer/bin/windows-process-supervisor/Release/net10.0/Eky.WindowsProcessSupervisor.dll --workspace-success-command');
});

test('producer publishes exactly one immutable pair and consumers use the same artifact ID and descriptor binding', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const producer = source.split('  workspace_artifact_producer:')[1].split('  workspace_consumer:')[0];
  const consumer = source.split('  workspace_consumer:')[1].split('  workspace_fault_consumer:')[0];
  assert.match(producer, /needs: workspace_artifact_contracts/);
  assert.match(producer, /installer:verify-restore-lock/);
  assert.equal(producer.match(/installer:v2-workspace-artifact:build/g).length, 1);
  assert.match(producer, /artifact_id: \$\{\{ steps.upload.outputs.artifact-id \}\}/);
  assert.match(producer, /retention-days: 1/);
  assert.match(producer, /overwrite: false/);
  assert.match(producer, /include-hidden-files: false/);
  assert.match(consumer, /needs: workspace_artifact_producer/);
  assert.ok(consumer.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(consumer, /fail-fast: false/);
  assert.match(consumer, /artifact-ids: \$\{\{ needs.workspace_artifact_producer.outputs.artifact_id \}\}/);
  assert.match(consumer, /merge-multiple: true/);
  assert.doesNotMatch(consumer, /installer:v2-workspace-artifact:build|installer:w6b2|msiexec|retry|rerun/);
  const upload = consumer.split('      - name: Upload encrypted workspace evidence only')[1];
  assert.ok(upload);
  assert.match(upload, /steps\.evidence_seal\.outcome == 'success' && steps\.evidence_seal\.outputs\.sealed == 'true'/);
  assert.match(upload, /path: \$\{\{ steps\.evidence_seal\.outputs\.ciphertext \}\}/);
  assert.match(upload, /retention-days: 1/);
  assert.match(upload, /overwrite: false/);
  assert.equal(consumer.match(/--workspace-success-command --artifact-descriptor/g).length, 1);
  assert.equal(consumer.match(/installer:v2-workspace-artifact:verify/g).length, 2);
  assert.match(consumer, /always\(\) && steps.download.outcome == 'success'/);
  const boundCommands = consumer.split('\n').filter((line) =>
    /installer:v2-workspace-artifact:verify|--workspace-success-command|verifyWorkspaceCallerResult\.mjs/.test(line));
  assert.equal(boundCommands.length, 4);
  for (const command of boundCommands) {
    assert.match(command, /--expected-descriptor-sha256 \$env:EXPECTED_DESCRIPTOR_SHA256/);
    assert.match(command, /--expected-build-revision \$env:EXPECTED_BUILD_REVISION/);
  }
});

test('V2.7 uses two consumers of the same producer and all five existing fault contracts without rebuilding packages', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const contracts = source.split('  workspace_artifact_producer:')[0];
  assert.match(contracts, /installer:test:windows-acceptance-workspace-fault/);
  const consumer = source.split('  workspace_fault_consumer:')[1];
  assert.match(consumer, /needs: workspace_artifact_producer/);
  assert.ok(consumer.includes("repetition: ${{ fromJSON(inputs.risk_plan != '' && fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]') }}"));
  assert.match(consumer, /fail-fast: false/);
  assert.match(consumer, /artifact-ids: \$\{\{ needs.workspace_artifact_producer.outputs.artifact_id \}\}/);
  assert.match(consumer, /always\(\) && steps.download.outcome == 'success'/);
  assert.doesNotMatch(withoutOptionalEvidenceAllowance(consumer, 1),
    /installer:v2-workspace-artifact:build|installer:w6b2|msiexec|upload-artifact|retry|rerun|continue-on-error/);
  assert.equal(consumer.match(/installer:supervisor:build/g).length, 1);
  assert.equal(consumer.match(/ e2e:build/g).length, 1);
  assert.equal(consumer.match(/installer:v2-workspace-artifact:verify/g).length, 2);
  const commands = consumer.split('\n').filter((line) => line.includes('--workspace-fault-command'));
  assert.equal(commands.length, 5);
  assert.deepEqual(commands.map((command) => command.match(/--fault-scenario (\w+)/)[1]), [
    'preUpdateRecoveryPointFailure', 'activeWorkspaceFirstStartFailure', 'acceptanceInterruption',
    'passiveWorkspaceMigrationFailure', 'binaryRollbackFailure',
  ]);
  for (const command of commands) {
    assert.match(command, /^\s+dotnet apps\/desktop\/installer\/bin\/windows-process-supervisor\/Release\/net10\.0\/Eky\.WindowsProcessSupervisor\.dll --workspace-fault-command/);
    assert.match(command, /--artifact-descriptor \$descriptorPath/);
    assert.match(command, /--expected-descriptor-sha256 \$env:EXPECTED_DESCRIPTOR_SHA256/);
    assert.match(command, /--expected-build-revision \$env:EXPECTED_BUILD_REVISION/);
  }
  assert.equal(consumer.match(/timeout-minutes: 25/g).length, 5);
  assert.match(consumer, /timeout-minutes: 140/);
});

test('V2.7 canonical commands retain the same worker, terminal, session and readonly contracts used by CI', async () => {
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.equal(desktop.scripts['installer:v2-workspace-fault'],
    'pnpm installer:supervisor:build && pnpm e2e:prepare-electron-runtime && pnpm e2e:build && dotnet installer/bin/windows-process-supervisor/Release/net10.0/Eky.WindowsProcessSupervisor.dll --workspace-fault-command');
  assert.equal(desktop.scripts['installer:test:windows-acceptance-workspace-fault'],
    'pnpm e2e:prepare-electron-runtime && pnpm e2e:build && node --test --test-concurrency=1 --test-reporter=../../test-reporters/nodeFailureReporter.mjs ' + [
      'workspaceInstallationObservation',
      'workspaceFaultContracts', 'workspaceFaultLifecycle', 'workspaceFaultSessionProof', 'workspaceFaultSessionEvidence',
      'workspaceFaultPostcondition', 'workspaceFaultFailureBoundary', 'runWorkspaceFaultWorker', 'workspaceCommandAdmission',
      'workspaceSuccessProfileEvidence', 'workspaceSuccessLifecycle', 'workspaceSuccessWindowsRuntime',
    ].map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`).join(' '));
});

test('both consumers prepare the same readers once outside lifecycle execution without rebuilding the artifact', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const consumers = [source.split('  workspace_consumer:')[1].split('  workspace_fault_consumer:')[0],
    source.split('  workspace_fault_consumer:')[1]];
  const preparation = consumers.map((consumer) => consumer.split('      - name:')
    .find((block) => block.startsWith(' Prepare existing supervisor and proof readers once')));
  assert.ok(preparation.every(Boolean));
  assert.equal(preparation[0], preparation[1]);
  for (const consumer of consumers) {
    for (const command of ['installer:supervisor:build', ' e2e:prepare-electron-runtime', ' e2e:build']) {
      assert.equal(consumer.split(command).length - 1, 1);
    }
    const preparedIndex = consumer.indexOf(preparation[0]);
    const lifecycleIndex = consumer.indexOf('timeout-minutes: 25');
    assert.ok(preparedIndex >= 0 && preparedIndex < lifecycleIndex);
    assert.doesNotMatch(consumer.slice(lifecycleIndex), /installer:supervisor:build| e2e:build|installer:v2-workspace-(success|fault) /);
  }
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  const script = ['core', 'commands', 'legacy-entry', 'clean-upgrade-entry', 'workspace-success-entry', 'workspace-fault-entry'].map((group) =>
    desktop.scripts[`installer:test:windows-supervisor-v2-legacy-${group}`]).join(' ');
  for (const name of ['installerProductOperationWorker', 'installerProductOperationResult', 'legacyCommandCompletion.process']) {
    assert.equal(script.split(`installer/windows-acceptance-harness/${name}.test.mjs`).length - 1, 1);
  }
});

test('each workspace consumer requires its own bound caller result and the actual command exit', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const contracts = source.split('  workspace_artifact_producer:')[0];
  assert.match(contracts, /installer:test:windows-acceptance-phase-writer/);
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  for (const name of ['workspaceCallerResult', 'workspacePhaseWriter', 'workspacePhaseWriter.process']) {
    assert.ok(desktop.scripts['installer:test:windows-acceptance-phase-writer'].includes(`${name}.test.mjs`));
  }
  const blocks = source.split('      - name:').filter((block) =>
    /--workspace-success-command --artifact-descriptor|--workspace-fault-command --artifact-descriptor/.test(block));
  assert.equal(blocks.length, 6);
  for (const block of blocks) {
    assert.match(block, /eky-workspace-caller-.*\[Guid\]::NewGuid\(\)\.ToString\('N'\)/);
    const lines = block.split('\n');
    const caller = lines.findIndex((line) => /--workspace-success-command --artifact-descriptor|--workspace-fault-command --artifact-descriptor/.test(line));
    assert.match(lines[caller], /--result-path \$resultPath$/);
    assert.equal(lines[caller + 1].trim(), '$commandExit = $LASTEXITCODE');
    assert.match(lines[caller + 2], /verifyWorkspaceCallerResult.mjs .*--result-path \$resultPath --command-exit \$commandExit$/);
    assert.match(lines[caller + 3], /if \(\$commandExit -ne 0 -or \$LASTEXITCODE -ne 0\)/);
    assert.equal(lines[caller].split(' --artifact-descriptor ')[1],
      lines[caller + 2].split(' --artifact-descriptor ')[1].replace(' --command-exit $commandExit', ''));
    assert.doesNotMatch(block, /Get-Content|Write-Output|continue-on-error|upload-artifact/);
  }
});
