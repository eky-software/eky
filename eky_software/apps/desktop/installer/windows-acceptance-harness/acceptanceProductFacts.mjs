import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { validateInstallerProductStateResult } from './cleanInstallUninstallWindowsRuntime.mjs';
import { validateProductOperationWorkerResult } from './installerProductOperationResult.mjs';
import { classifyUpgradeRollbackProductStates } from './upgradeRollbackPostSupervisorWindowsRuntime.mjs';

// Read-only product facts. A prior inspection is not permission to uninstall.
export function validateAcceptanceProductFacts(products, history) {
  if (!products || Object.getPrototypeOf(products) !== Object.prototype) throw new Error('productOperationResultInvalid');
  for (const [phase, value] of Object.entries(products)) {
    const item = history.find((entry) => entry.phase === phase);
    if (!item || !/^(inspect(Source|Target)(Before|After|Cleanup|Final)|uninstall(Source|Target))$/.test(phase)) {
      throw new Error('productOperationResultInvalid');
    }
    validateProductOperationWorkerResult(value, { nonce: item.runNonce,
      operation: phase.startsWith('inspect') ? 'inspect' : 'uninstall' });
    if (phase.startsWith('uninstall')) {
      if (value.state !== null) throw new Error('productOperationResultInvalid');
    } else if (value.status === 'completed') inspection(value);
  }
}

function inspection(value) {
  if (!value || value.status !== 'completed' || value.resultCleanup !== 'completed') return null;
  if (typeof value.state !== 'string' || value.state.length > 90_000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.state)) throw new Error('productOperationResultInvalid');
  const state = validateInstallerProductStateResult(parseStrictJsonObjectBytes(Buffer.from(value.state, 'base64'), {
    maximumBytes: 65536, errorCode: 'productOperationResultInvalid',
  }));
  return { exactProductPresent: state.productState >= 1 || state.productName !== null ||
    state.productVersion !== null || state.localPackagePresent, installerRegistryPresent: state.ownedRegistryExists };
}

export function acceptanceProductPair(products, suffix) {
  const source = inspection(products[`inspectSource${suffix}`]);
  const target = inspection(products[`inspectTarget${suffix}`]);
  return source && target ? classifyUpgradeRollbackProductStates(source, target)
    : { status: 'failed', errorCode: 'productStateVerificationFailed' };
}

export function acceptanceProductCleanup(products) {
  const pair = acceptanceProductPair(products, 'Cleanup');
  if (pair.status !== 'completed') return pair;
  return ['Source', 'Target'].some((role) => pair[`${role.toLowerCase()}Present`] &&
    (products[`uninstall${role}`]?.status !== 'completed' || products[`uninstall${role}`]?.resultCleanup !== 'completed'))
    ? { status: 'failed', errorCode: 'semanticCleanupFailed' }
    : { status: 'completed', resultCode: 'semanticCleanupCompleted' };
}
