import { createInstallerProductOperationRuntime } from './installerProductOperationRuntime.mjs';
export { INSPECTOR_TIMEOUT_MILLISECONDS, SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS,
  DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS } from './installerProductOperationRuntime.mjs';

function exactProductPresent(state) {
  return state.productState >= 1 || state.productName !== null ||
    state.productVersion !== null || state.localPackagePresent;
}

export function classifyUpgradeRollbackProductStates(source, target) {
  if (typeof source.exactProductPresent !== 'boolean' || typeof target.exactProductPresent !== 'boolean' ||
    typeof source.installerRegistryPresent !== 'boolean' || typeof target.installerRegistryPresent !== 'boolean' ||
    source.installerRegistryPresent !== target.installerRegistryPresent) {
    return Object.freeze({ status: 'failed', errorCode: 'productStateVerificationFailed' });
  }
  const sourcePresent = source.exactProductPresent;
  const targetPresent = target.exactProductPresent;
  const installerRegistryPresent = source.installerRegistryPresent;
  const resultCode = sourcePresent ? targetPresent ? 'multipleProductsPresent' : 'sourceProductPresent'
    : targetPresent ? 'targetProductPresent' : installerRegistryPresent ? 'installerRegistryPresent' : 'exactProductsAbsent';
  return Object.freeze({ status: 'completed', resultCode, sourcePresent, targetPresent, installerRegistryPresent });
}

export function createUpgradeRollbackPostSupervisorWindowsRuntime({ artifact, scenarioRoot }, dependencies) {
  const operations = createInstallerProductOperationRuntime({ scenarioRoot,
    environmentErrorCode: 'WINDOWS_ACCEPTANCE_UPGRADE_ENVIRONMENT_INVALID' }, dependencies);
  const code = (roleName) => `{${artifact.roles[roleName].productCode}}`;
  async function inspectProduct(roleName) {
    const result = await operations.inspect(code(roleName));
    if (result.status !== 'completed') return result;
    const present = exactProductPresent(result.state);
    return Object.freeze({ status: 'completed', resultCode: present ? 'exactProductPresent' : 'exactProductAbsent',
      exactProductPresent: present, installerRegistryPresent: result.state.ownedRegistryExists });
  }
  async function verifyExactProductStates() {
    const source = await inspectProduct('source');
    if (!operations.outcome().productProcessAbsent) return source;
    const target = await inspectProduct('target');
    if (source.status === 'failed' || target.status === 'failed') return source.status === 'failed' ? source : target;
    return classifyUpgradeRollbackProductStates(source, target);
  }
  async function cleanupExactProducts() {
    const state = await verifyExactProductStates();
    if (state.status === 'failed') return state;
    let failure = null;
    for (const [roleName, present] of [['target', state.targetPresent], ['source', state.sourcePresent]]) {
      if (!present) continue;
      const result = await operations.uninstall(code(roleName));
      if (result.status === 'failed') failure ??= result;
      if (!operations.outcome().productProcessAbsent) break;
    }
    return failure ?? Object.freeze({ status: 'completed', resultCode: 'semanticCleanupCompleted' });
  }
  return Object.freeze({ cleanupExactProducts, verifyExactProductStates, outcome: operations.outcome });
}
