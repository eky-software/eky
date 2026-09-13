import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInstallerProductCode } from '../installerIdentity.mjs';
import { upgradeRollbackResultPathForRequest, writeJsonAtomicExclusive } from './upgradeRollbackContracts.mjs';
import { initialUpgradeRollbackResult } from './upgradeRollbackLifecycle.mjs';
import { executeProductOperation } from './installerProductOperationWorker.mjs';

export function syntheticUpgradeScenario(request, { failed = false, applicationCleanupUnverified = false } = {}) {
  return { ...initialUpgradeRollbackResult(), runNonce: request.runNonce, scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256, status: failed ? 'failed' : 'completed',
    resultCode: failed ? 'upgradeRollbackFailed' : 'upgradeRollbackCompleted', errorCode: failed ? 'sourceInstallFailed' : null,
    cleanupResultCode: failed ? 'cleanupFailed' : 'notRequired',
    sourceInstallExitCode: failed ? 1603 : 0, upgradeExitCode: failed ? null : 0,
    runningUpgradeInitialExitCode: failed ? null : 0, downgradeExitCode: failed ? null : 1638,
    binaryRollbackExitCode: failed ? null : 0, windowsInstallerRollbackExitCode: failed ? null : 1603,
    finalUninstallExitCode: failed ? null : 0, sourceInstalledStateValidated: !failed, majorUpgradeValidated: !failed,
    runningApplicationUpgradeValidated: !failed, installedPayloadValidated: !failed, downgradeRejected: !failed,
    binaryRollbackRestoredSource: !failed, windowsInstallerRollbackRestoredSource: !failed,
    finalStateValidated: !failed, artifactBytesValidated: !failed,
    applicationCleanupResultCode: applicationCleanupUnverified ? 'cleanupUnverified' : 'completed' };
}

// Only scenario/artifact facts are synthetic. The actual fixed command and
// its phase ownership, result transport and exit are used without a fallback.
export function upgradeCommandFixture(input, testCase, hold) {
  const needsCleanup = ['uninstallHold', 'resultBeforeExit', 'cleanupFailed', 'scenarioAndCleanupFailed',
    'productMissingResult', 'scenarioHold', 'scenarioMissing', 'businessFailed', 'postconditionFailed',
    'scenarioAndProfileFailed', 'scenarioAndRemovalFailed'].includes(testCase);
  const roles = Object.fromEntries(['source', 'target', 'windowsRollback'].map((role) => {
    const version = role === 'source' ? '0.2.7' : '0.2.8';
    return [role, { appVersion: version, productCode: createInstallerProductCode(
      testCase === 'temporaryRootAlias' ? (role === 'source' ? '255.255.65534' : '255.255.65535') : version), packageSha256: 'c'.repeat(64) }];
  }));
  return {
    async inventoryProfile() {
      return ['profileChanged', 'scenarioAndProfileFailed'].includes(testCase) && input.phase === 'inventoryAfter'
        ? [{ path: 'synthetic.txt', kind: 'file', size: 1, sha256: 'f'.repeat(64) }] : [];
    },
    async materializeFixture(descriptor, root) {
      await mkdir(root);
      await writeFile(resolve(root, 'private-evidence'), 'synthetic');
      return { artifactRoot: root, sourceArtifactRoot: dirname(descriptor), roles,
        descriptorSha256: input.commandArguments[3], buildRevision: input.commandArguments[5] };
    },
    async verifyProductArtifact() { return { roles }; },
    async verifyArtifact() { if (testCase === 'artifactChanged') throw new Error('syntheticArtifactChanged'); },
    async removeRunRoot(root) {
      if (testCase === 'removalHold') hold();
      if (testCase === 'scenarioAndRemovalFailed') throw new Error('syntheticRemovalFailed');
      await rm(root, { recursive: true });
    },
    async executeProduct(request) {
      if (testCase === 'temporaryRootAlias' && input.phase.endsWith('Before')) return executeProductOperation(request);
      if (testCase === 'uninstallHold' && request.operation === 'uninstall') hold();
      const registry = testCase === 'preconditionFailed' || (needsCleanup &&
        (input.phase.endsWith('After') || input.phase.endsWith('Cleanup')));
      const present = registry && input.phase.includes('Target');
      const value = { schemaVersion: 1, productState: present ? 5 : -1, productName: present ? 'Eky' : null,
        productVersion: present ? '0.2.8' : null, localPackagePresent: present, ownedRegistryExists: registry, ekyProcessCount: 0 };
      const failed = ['cleanupFailed', 'scenarioAndCleanupFailed'].includes(testCase) && request.operation === 'uninstall';
      return { schemaVersion: 1, nonce: request.nonce, operation: request.operation, status: failed ? 'failed' : 'completed',
        state: request.operation === 'inspect' ? Buffer.from(JSON.stringify(value)).toString('base64') : null,
        errorCode: failed ? 'commandFailed' : null, resultCleanup: 'completed' };
    },
    async runScenario([, path]) {
      if (testCase === 'scenarioHold') hold();
      if (testCase === 'scenarioMissing') return 0;
      const request = JSON.parse(await readFile(path, 'utf8'));
      const failed = (needsCleanup && testCase !== 'postconditionFailed') || testCase === 'applicationCleanupUnverified';
      await writeJsonAtomicExclusive(upgradeRollbackResultPathForRequest(path), syntheticUpgradeScenario(request, {
        failed, applicationCleanupUnverified: testCase === 'applicationCleanupUnverified' }));
      return 0;
    },
  };
}
