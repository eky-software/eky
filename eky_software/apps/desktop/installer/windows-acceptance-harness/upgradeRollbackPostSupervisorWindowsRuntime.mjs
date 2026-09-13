export { INSPECTOR_TIMEOUT_MILLISECONDS, SEMANTIC_CLEANUP_TIMEOUT_MILLISECONDS,
  DIRECT_PROCESS_TERMINATION_TIMEOUT_MILLISECONDS } from './installerProductOperationRuntime.mjs';

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
