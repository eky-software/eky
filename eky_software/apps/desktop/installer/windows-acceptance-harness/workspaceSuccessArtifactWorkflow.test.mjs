import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = resolve(ROOT, '../../../../../.github/workflows/windows-acceptance-v2-workspace.yml');

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
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  ]);
});

test('V2.6 fast checkpoint runs its executable contracts, not a packaged acceptance substitute', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.match(source, /pnpm --filter @eky\/desktop installer:test:windows-acceptance-workspace-artifact/);
  const script = desktop.scripts['installer:test:windows-acceptance-workspace-artifact'];
  assert.equal(script, 'node --test --test-concurrency=1 installer/windows-acceptance-harness/workspaceSuccessArtifact.test.mjs installer/windows-acceptance-harness/workspaceSuccessArtifactWorkflow.test.mjs');
  const contracts = source.split('  workspace_artifact_producer:')[0];
  assert.doesNotMatch(contracts, /installer:v2-workspace-artifact:build|msiexec|upload-artifact|installer:w6b2/);
});

test('V2.6 runtime checkpoint executes lifecycle, failure and read-only Windows adapter behavior', async () => {
  const source = await readFile(WORKFLOW, 'utf8');
  const desktop = JSON.parse(await readFile(resolve(ROOT, '../../package.json'), 'utf8'));
  assert.match(source, /pnpm --filter @eky\/desktop installer:test:windows-acceptance-workspace\s/);
  const script = desktop.scripts['installer:test:windows-acceptance-workspace'];
  assert.equal(script, 'pnpm e2e:prepare-electron-runtime && pnpm e2e:build && node --test --test-concurrency=1 ' + [
    'workspaceSuccessContracts', 'workspaceSuccessLifecycle', 'workspaceSuccessWindowsRuntime',
    'workspaceSuccessFailureBoundary', 'inspectWorkspaceSuccessMsiActivity',
    'workspaceSuccessProfileEvidence', 'workspaceSuccessPostcondition',
    'workspaceSuccessSessionProof',
    'runWorkspaceSuccessWorker', 'runWorkspaceSuccess',
  ].map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`).join(' '));
  assert.equal(desktop.scripts['installer:v2-workspace-success'],
    'pnpm installer:supervisor:build && pnpm e2e:prepare-electron-runtime && pnpm e2e:build && node installer/windows-acceptance-harness/runWorkspaceSuccess.mjs');
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
  assert.match(consumer, /repetition: \[1, 2\]/);
  assert.match(consumer, /fail-fast: false/);
  assert.match(consumer, /artifact-ids: \$\{\{ needs.workspace_artifact_producer.outputs.artifact_id \}\}/);
  assert.match(consumer, /merge-multiple: true/);
  assert.doesNotMatch(consumer, /installer:v2-workspace-artifact:build|installer:w6b2|msiexec|upload-artifact|retry|rerun/);
  assert.equal(consumer.match(/installer:v2-workspace-success --artifact-descriptor/g).length, 1);
  assert.equal(consumer.match(/installer:v2-workspace-artifact:verify/g).length, 2);
  assert.match(consumer, /always\(\) && steps.download.outcome == 'success'/);
  for (const command of consumer.split('\n').filter((line) => /pnpm.*installer:v2/.test(line))) {
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
  assert.match(consumer, /repetition: \[1, 2\]/);
  assert.match(consumer, /fail-fast: false/);
  assert.match(consumer, /artifact-ids: \$\{\{ needs.workspace_artifact_producer.outputs.artifact_id \}\}/);
  assert.match(consumer, /always\(\) && steps.download.outcome == 'success'/);
  assert.doesNotMatch(consumer, /installer:v2-workspace-artifact:build|installer:w6b2|msiexec|upload-artifact|retry|rerun|continue-on-error/);
  assert.equal(consumer.match(/installer:supervisor:build/g).length, 1);
  assert.equal(consumer.match(/ e2e:build/g).length, 1);
  assert.equal(consumer.match(/installer:v2-workspace-artifact:verify/g).length, 2);
  const commands = consumer.split('\n').filter((line) => line.includes('runWorkspaceFault.mjs'));
  assert.equal(commands.length, 5);
  assert.deepEqual(commands.map((command) => command.match(/--fault-scenario (\w+)/)[1]), [
    'preUpdateRecoveryPointFailure', 'activeWorkspaceFirstStartFailure', 'acceptanceInterruption',
    'passiveWorkspaceMigrationFailure', 'binaryRollbackFailure',
  ]);
  for (const command of commands) {
    assert.match(command, /pnpm --filter @eky\/desktop exec node installer\/windows-acceptance-harness\/runWorkspaceFault.mjs/);
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
    'pnpm installer:supervisor:build && pnpm e2e:prepare-electron-runtime && pnpm e2e:build && node installer/windows-acceptance-harness/runWorkspaceFault.mjs');
  assert.equal(desktop.scripts['installer:test:windows-acceptance-workspace-fault'],
    'pnpm e2e:prepare-electron-runtime && pnpm e2e:build && node --test --test-concurrency=1 ' + [
      'workspaceFaultContracts', 'workspaceFaultLifecycle', 'workspaceFaultSessionProof', 'workspaceFaultSessionEvidence',
      'workspaceFaultPostcondition', 'workspaceFaultFailureBoundary', 'runWorkspaceFaultWorker', 'runWorkspaceSuccess',
      'workspaceSuccessProfileEvidence', 'workspaceSuccessLifecycle', 'workspaceSuccessWindowsRuntime',
    ].map((name) => `installer/windows-acceptance-harness/${name}.test.mjs`).join(' '));
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
    /installer:v2-workspace-success --artifact-descriptor|runWorkspaceFault.mjs --artifact-descriptor/.test(block));
  assert.equal(blocks.length, 6);
  for (const block of blocks) {
    assert.match(block, /eky-workspace-caller-.*\[Guid\]::NewGuid\(\)\.ToString\('N'\)/);
    const lines = block.split('\n');
    const caller = lines.findIndex((line) => /installer:v2-workspace-success --artifact-descriptor|runWorkspaceFault.mjs --artifact-descriptor/.test(line));
    assert.match(lines[caller], /--result-path \$resultPath$/);
    assert.equal(lines[caller + 1].trim(), '$commandExit = $LASTEXITCODE');
    assert.match(lines[caller + 2], /verifyWorkspaceCallerResult.mjs .*--result-path \$resultPath --command-exit \$commandExit$/);
    assert.match(lines[caller + 3], /if \(\$commandExit -ne 0 -or \$LASTEXITCODE -ne 0\)/);
    assert.equal(lines[caller].split(' --artifact-descriptor ')[1],
      lines[caller + 2].split(' --artifact-descriptor ')[1].replace(' --command-exit $commandExit', ''));
    assert.doesNotMatch(block, /Get-Content|Write-Output|continue-on-error|upload-artifact/);
  }
});
