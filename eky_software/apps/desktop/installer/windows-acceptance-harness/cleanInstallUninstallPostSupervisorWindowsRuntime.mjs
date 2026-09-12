import { createInstallerProductCode } from '../installerIdentity.mjs';
import { createInstallerProductOperationRuntime } from './installerProductOperationRuntime.mjs';

export function createCleanInstallUninstallPostSupervisorWindowsRuntime({ manifest, scenarioRoot }, dependencies) {
  const operations = createInstallerProductOperationRuntime({ scenarioRoot,
    environmentErrorCode: 'WINDOWS_ACCEPTANCE_CLEAN_ENVIRONMENT_INVALID' }, dependencies);
  const productCode = `{${createInstallerProductCode(manifest.msiProductVersion)}}`;
  async function verifyExactProductState() {
    const result = await operations.inspect(productCode);
    if (result.status !== 'completed') return result;
    const present = result.state.productState >= 1;
    return Object.freeze({ status: 'completed', resultCode: present ? 'exactProductPresent' : 'exactProductAbsent',
      exactProductPresent: present });
  }
  return Object.freeze({ verifyExactProductState, cleanupExactProduct: () => operations.uninstall(productCode),
    outcome: operations.outcome });
}
