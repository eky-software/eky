import { validateInstallerProductStateResult } from '../../../../windows-acceptance-harness/cleanInstallUninstallWindowsRuntime.mjs';

export const PREPARED_PRODUCT_REPORT = 'workspace-inspection-1.json';

export function requirePreparedProductAbsent(report) {
  const product = validateInstallerProductStateResult(report);
  if (product.productState !== -1 || product.productName !== null || product.productVersion !== null ||
    product.localPackagePresent || product.ownedRegistryExists || product.ekyProcessCount !== 0) {
    throw new Error('JOINT_FIXTURE_PRODUCT_REPORT_INVALID');
  }
}
