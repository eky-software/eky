import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setInterval } from 'node:timers';
import { readOwnedProductOperationResult } from './installerProductOperationResult.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';

const mode = process.argv[2];
assert(['hold', 'unread', 'consumeOwnedProduct', '--phase-request'].includes(mode));
if (mode === '--phase-request') {
  const { runLegacyCommandPhase } = await import('./legacyCommandPhase.mjs');
  const { writeLegacyUpgradeWorkerOutcome } = await import('./runLegacyUpgradeWorker.mjs');
  const input = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const phaseRoot = dirname(process.argv[3]);
  const fixtureRoot = dirname(input.commandArguments[1]);
  const { testCase } = JSON.parse(await readFile(input.commandArguments[1], 'utf8'));
  if (input.phase === 'prepare') await writeFile(join(fixtureRoot, 'command-root.txt'), dirname(phaseRoot));
  const role = { productCode: '00000000-0000-0000-0000-000000000001' };
  const hold = () => spawnSync(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  if (testCase === 'preparationHold' && input.phase === 'prepare') hold();
  const code = input.commandKind !== 'legacy'
    ? await (await import('./workspaceCommandPhase.mjs')).runWorkspaceCommandPhase(process.argv.slice(2),
      (await import('./workspaceCommandFixture.mjs')).workspaceCommandFixture(input, testCase, hold))
    : await runLegacyCommandPhase(process.argv.slice(2), {
    async filesystem({ operation, payload }) {
      if (operation === 'inventory') return testCase === 'profileChanged' && input.phase === 'inventoryAfter'
        ? [{ path: 'synthetic.txt', kind: 'file', size: 1, sha256: 'f'.repeat(64) }] : [];
      if (operation === 'materialize') {
        await mkdir(payload.fixtureRoot);
        await writeFile(join(payload.fixtureRoot, 'private-evidence'), 'synthetic');
        return { artifactRoot: payload.fixtureRoot, descriptorSha256: input.commandArguments[3],
          buildRevision: input.commandArguments[5], sourceArtifactRoot: fixtureRoot,
          source: { ...role, artifactClass: 'historical-source-rebuild', appVersion: '0.2.6', packageSha256: 'c'.repeat(64) },
          target: { ...role, productCode: '00000000-0000-0000-0000-000000000002', appVersion: '0.2.7', packageSha256: 'd'.repeat(64) } };
      }
      if (operation === 'semantic') {
        if (testCase === 'businessFailed') throw new Error('legacySemanticProofFailed');
        return { status: 'completed', resultCode: 'legacySemanticProofValidated',
          businessDataPreserved: true, adoptedWorkspaceCount: 1, idempotentSecondStartup: true };
      }
      if (operation === 'remove') {
        if (testCase === 'removalHold') hold();
        return rm(payload.root, { recursive: true });
      }
      assert.equal(operation, 'artifact');
      if (testCase === 'artifactChanged') throw new Error('syntheticArtifactChanged');
    },
    async verifyProductArtifact() { return { source: role, target: { ...role, productCode: '00000000-0000-0000-0000-000000000002' } }; },
    async executeProduct(request) {
      if (testCase === 'uninstallHold' && input.phase === 'uninstallTarget') hold();
      const installed = input.phase.endsWith('After') || input.phase.endsWith('Cleanup') || testCase === 'preconditionFailed';
      const present = installed && input.phase.includes('Target');
      const value = { schemaVersion: 1, productState: present ? 5 : -1, productName: present ? 'Eky' : null,
        productVersion: present ? '0.2.7' : null, localPackagePresent: present, ownedRegistryExists: installed, ekyProcessCount: 0 };
      const failed = ['cleanupFailed', 'scenarioAndCleanupFailed'].includes(testCase) && request.operation === 'uninstall';
      return { schemaVersion: 1, nonce: request.nonce, operation: request.operation, status: failed ? 'failed' : 'completed',
        state: request.operation === 'inspect' ? Buffer.from(JSON.stringify(value)).toString('base64') : null,
        errorCode: failed ? 'commandFailed' : null, resultCleanup: 'completed' };
    },
    async runScenario([, requestPath]) {
      if (testCase === 'scenarioHold') hold();
      if (testCase === 'scenarioMissing') return 0;
      const request = JSON.parse(await readFile(requestPath, 'utf8'));
      const failed = testCase === 'scenarioAndCleanupFailed';
      return writeLegacyUpgradeWorkerOutcome(requestPath, request, { schemaVersion: 1,
        status: failed ? 'failed' : 'completed', resultCode: failed ? 'historicalLegacyUpgradeFailed' : 'historicalLegacyUpgradeCompleted',
        errorCode: failed ? 'sourcePackagedSmokeFailed' : null, sourceInstallExitCode: 0, upgradeExitCode: failed ? null : 0,
        sourceStateValidated: true, sourceNormalStartupValidated: true, sourcePackagedSmokeValidated: !failed,
        legacyBusinessFixtureValidated: !failed, majorUpgradeValidated: !failed, targetFirstStartupValidated: !failed,
        targetSecondStartupValidated: !failed, artifactBytesValidated: true });
    },
  });
  if (testCase === 'resultBeforeExit' && input.phase === 'uninstallTarget') hold();
  if (testCase === 'publicationBeforeExit' && input.phase === 'publish') hold();
  if (testCase === 'productMissingResult' && input.phase === 'uninstallTarget')
    await rm(join(phaseRoot, 'worker-result.json'));
  process.exitCode = code;
} else if (mode === 'consumeOwnedProduct') {
  const input = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const productInput = JSON.parse(await readFile(input.productInputPath, 'utf8'));
  const supervisorResult = JSON.parse(await readFile(input.supervisorResultPath, 'utf8'));
  if (input.holdBeforeRead) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  const result = await readOwnedProductOperationResult({ ...productInput,
    supervisorResult, supervisorExitCode: input.supervisorExitCode });
  assert.equal(result.status, input.status);
  assert.equal(result.resultCode, input.resultCode);
  assert.equal(result.directProcessAbsent, true);
  if (result.status === 'completed') assert.equal(result.state.productState, -1);
  await writeFile(join(dirname(process.argv[3]), 'consumer-result.json'), JSON.stringify(result), { flag: 'wx' });
  await writeJsonAtomicExclusive(join(dirname(process.argv[3]), 'worker-result.json'), {
    ...input.binding, status: 'completed', resultCode: 'productOutcomeValidated', errorCode: null,
  });
} else if (mode === 'hold') setInterval(() => {}, 1000);
else {
  // Saturate an actual unread pipe inside the scenario Job. Deliberate fault,
  // not a readiness signal or a timing-based completion condition.
  const event = JSON.stringify({ schemaVersion: 1, operation: 'historicalLegacyUpgradeLifecycle',
    scenario: 'historicalLegacyUpgrade', phase: 'majorUpgrade', status: 'started',
    durationMs: 0, elapsedMs: 0, resultCode: 'started' });
  for (;;) console.error(event);
}
