import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WORKSPACE_SUCCESS_PHASES, workspaceSuccessResultPath, writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';
import { workspaceFaultPlan, workspaceFaultResultPath } from './workspaceFaultContracts.mjs';

// Synthetic business/product facts injected into the real fixed command.
// Process ownership, phase publication and command exit are never replaced.
export function workspaceCommandFixture(input, testCase, hold) {
  const source = { productCode: '00000000-0000-0000-0000-000000000001', packageSha256: 'c'.repeat(64),
    packageSize: 1, manifest: { packageFilename: 'source.msi' } };
  const target = { productCode: '00000000-0000-0000-0000-000000000002', packageSha256: 'd'.repeat(64),
    packageSize: 1, manifest: { packageFilename: 'target.msi' } };
  const fault = input.commandKind === 'workspaceFault';
  return {
    async inventoryProfile() { return { present: testCase === 'profileChanged' && input.phase === 'inventoryAfter', inventory: [] }; },
    async materializeFixture(_input, fixtureRoot) {
      await mkdir(fixtureRoot);
      await writeFile(resolve(fixtureRoot, 'private-evidence'), 'synthetic');
      return { artifactRoot: fixtureRoot, descriptorSha256: input.commandArguments[3],
        buildRevision: input.commandArguments[5], source, target };
    },
    async prepareFixture() {},
    async verifyArtifact() {
      if (testCase === 'artifactChanged' && input.phase === 'artifact') throw new Error('artifactInvalid');
      return { source, target };
    },
    async verifySemantic() {
      if (testCase === 'businessFailed') throw new Error('profileEvidenceInvalid');
      return { status: 'completed', resultCode: fault ? 'workspaceFaultSemanticProofValidated' : 'workspaceSemanticProofValidated' };
    },
    async verifySessions() {
      if (testCase === 'sessionFailed') throw new Error('sessionProofInvalid');
      return { status: 'completed', resultCode: 'workspaceFaultSessionsValidated' };
    },
    async verifyRemoval() {
      if (testCase === 'footprintFailed') throw new Error('installerFootprintUnverified');
      return { status: 'completed', resultCode: 'installerFootprintAbsent' };
    },
    async removeFixture(root) { if (testCase === 'removalHold') hold(); return rm(root, { recursive: true }); },
    async executeProduct(request) {
      if (testCase === 'uninstallHold' && input.phase === 'uninstallTarget') hold();
      const installed = input.phase.endsWith('After') || input.phase.endsWith('Cleanup') || testCase === 'preconditionFailed';
      const role = fault ? workspaceFaultPlan(input.commandArguments[7]).installedRole : 'target';
      const present = installed && input.phase.toLowerCase().includes(role);
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
      const phases = fault ? workspaceFaultPlan(request.faultScenario).phases : WORKSPACE_SUCCESS_PHASES;
      const result = { schemaVersion: 1, scenario: request.scenario, runNonce: request.runNonce,
        artifactDescriptorSha256: request.artifactDescriptorSha256, ...(fault ? { faultScenario: request.faultScenario } : {}),
        status: failed ? 'failed' : 'completed', resultCode: (fault ? 'workspaceFault' : 'workspaceSuccess') + (failed ? 'Failed' : 'Completed'),
        errorCode: failed ? 'sourceInstallFailed' : null, completedPhases: failed ? [] : phases, failedPhase: failed ? phases[0] : null };
      await writeJsonAtomicExclusive((fault ? workspaceFaultResultPath : workspaceSuccessResultPath)(requestPath), result);
      await writeJsonAtomicExclusive(resolve(dirname(requestPath), 'worker-result.json'), { ...request,
        status: result.status, resultCode: result.resultCode, errorCode: result.errorCode });
      return failed ? 1 : 0;
    },
  };
}
