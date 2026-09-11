import { dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { LEGACY_UPGRADE_DESCRIPTOR_FILENAME } from './legacyUpgradeArtifact.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export async function resolveLegacyUpgradeTemporaryRoot(temporaryRoot = tmpdir()) {
  try { return await realpath(resolve(temporaryRoot)); }
  catch { throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ENVIRONMENT_INVALID'); }
}

export function parseLegacyUpgradeArguments(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== '--artifact-descriptor') {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID');
  }
  const descriptorPath = parseAbsoluteWindowsAcceptancePath(arguments_[1], 'WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID');
  if (descriptorPath !== resolve(dirname(descriptorPath), LEGACY_UPGRADE_DESCRIPTOR_FILENAME)) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID');
  }
  return Object.freeze({ descriptorPath });
}

export function requireLegacyUpgradeProductPrecondition(result) {
  if (result?.status !== 'completed' || result.resultCode !== 'exactProductsAbsent' ||
    result.sourcePresent !== false || result.targetPresent !== false || result.installerRegistryPresent !== false) {
    throw new Error('WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED');
  }
}
