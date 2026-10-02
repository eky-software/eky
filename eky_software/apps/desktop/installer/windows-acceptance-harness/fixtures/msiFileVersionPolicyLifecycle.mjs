export const MSI_POLICY_VARIANTS = Object.freeze(['uiDefault', 'uiOverride']);
const SAFE_ERRORS = new Set([
  'unknown', 'productCommandFailed', 'installerStateInspectionFailed', 'msiPolicyAuthoringInvalid', 'msiPolicyToolchainInvalid',
  'msiPolicyRequestInvalid', 'msiPolicyPreparationFailed', 'msiPolicyCompileFailed',
  'msiPolicyPayloadInvalid', 'msiPolicyRestoreFailed', 'msiPolicyBuildFailed',
  'msiPolicyOutputInvalid', 'msiPolicyInputChanged', 'msiPolicyFileInvalid',
  'msiPolicyFileChanged', 'msiPolicyDescriptorInvalid', 'msiPolicyDescriptorChanged',
  'msiPolicyInstallerChanged', 'msiPolicyPayloadChanged', 'msiPolicyVariantInvalid',
  'msiPolicyStateInvalid', 'msiPolicyProductStateInvalid', 'msiPolicyInstalledFileMismatch',
  'msiPolicyMetadataInvalid', 'msiPolicyFootprintRemains', 'msiPolicyDirectoryRemains',
  'msiPolicyLogInvalid', 'msiPolicyVersionMissing', 'msiPolicyIdentityInvalid',
  'msiPolicyUpgradeSequenceInvalid', 'msiPolicyInventoryInvalid', 'msiPolicyFileVersionInvalid',
  'msiPolicyFileAttributesInvalid', 'msiPolicyComponentInvalid', 'msiPolicyRegistryInvalid',
  'msiPolicyReaderInvalid', 'msiPolicyLanguageInvalid', 'msiPolicyComponentIdentityInvalid',
  'msiPolicyDirectoryInvalid', 'msiPolicyHostedRunnerRequired',
  'INSTALLER_REINSTALL_POLICY_READ_FAILED', 'INSTALLER_REINSTALL_MODE_INVALID',
  'INSTALLER_REINSTALL_FORBIDDEN', 'INSTALLER_CUSTOM_ACTION_FORBIDDEN',
  'INSTALLER_REINSTALL_SEQUENCE_INVALID',
]);

export function msiPolicyErrorCode(error) {
  return SAFE_ERRORS.has(error?.message) ? error.message : 'unknown';
}

export function validateMsiPolicyResult(mode, value) {
  const keys = ['variant', 'status', 'phase', 'errorCode', 'causeCode', 'sourceVerified',
    'policyVerified', 'cleanupStatus', 'cleanupErrorCode', 'cleanupCauseCode'].sort();
  const phases = ['preparation', 'metadata', 'preflight', 'sourceInstall', 'sourceVerification',
    'targetInstall', 'policyVerification'];
  if (!['prepare', ...MSI_POLICY_VARIANTS].includes(mode) || !value || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== keys.join(',') || value.variant !== mode ||
      !['completed', 'failed'].includes(value.status) || !phases.includes(value.phase) ||
      typeof value.sourceVerified !== 'boolean' || typeof value.policyVerified !== 'boolean' ||
      (value.policyVerified && !value.sourceVerified) ||
      !['notAttempted', 'completed', 'failed'].includes(value.cleanupStatus) ||
      (value.errorCode === null ? value.causeCode !== null
        : value.errorCode !== `${value.phase}Failed` || !SAFE_ERRORS.has(value.causeCode)) ||
      (value.cleanupStatus === 'failed'
        ? !['productRemovalFailed', 'absenceVerificationFailed'].includes(value.cleanupErrorCode) ||
          !SAFE_ERRORS.has(value.cleanupCauseCode)
        : value.cleanupErrorCode !== null || value.cleanupCauseCode !== null)) {
    throw new Error('msiPolicyResultInvalid');
  }
  const completed = value.errorCode === null && value.causeCode === null &&
    (mode === 'prepare'
      ? value.phase === 'preparation' && !value.sourceVerified && !value.policyVerified && value.cleanupStatus === 'notAttempted'
      : value.phase === 'policyVerification' && value.sourceVerified && value.policyVerified && value.cleanupStatus === 'completed');
  if ((value.status === 'completed') !== completed ||
      (value.status === 'failed' && value.errorCode === null && value.cleanupStatus !== 'failed')) {
    throw new Error('msiPolicyResultInvalid');
  }
  return value;
}

// This is an installer-policy fixture, not an alternative EKY payload validator.
export async function exerciseMsiFileVersionPolicy(variant, runtime) {
  if (!MSI_POLICY_VARIANTS.includes(variant)) throw new Error('msiPolicyVariantInvalid');
  const result = {
    variant, status: 'failed', phase: 'preflight', errorCode: null, causeCode: null,
    sourceVerified: false, policyVerified: false,
    cleanupStatus: 'notAttempted', cleanupErrorCode: null, cleanupCauseCode: null,
  };
  let owned = false;
  try {
    await runtime.verifyAbsent();
    // Only an absent, uniquely named synthetic pair grants cleanup ownership.
    owned = true;
    result.phase = 'sourceInstall';
    await runtime.install('source', variant);
    result.phase = 'sourceVerification';
    await runtime.verifySource();
    result.sourceVerified = true;
    result.phase = 'targetInstall';
    await runtime.install('target', variant);
    result.phase = 'policyVerification';
    await runtime.verifyPolicy(variant);
    result.policyVerified = true;
  } catch (error) {
    result.errorCode = `${result.phase}Failed`;
    result.causeCode = msiPolicyErrorCode(error);
  } finally {
    if (owned) {
      // Attempt both exact products even when the first cleanup fails.
      for (const role of ['target', 'source']) {
        try { await runtime.removeIfOwned(role); }
        catch (error) {
          result.cleanupErrorCode ??= 'productRemovalFailed';
          result.cleanupCauseCode ??= msiPolicyErrorCode(error);
        }
      }
      try { await runtime.verifyAbsent(); }
      catch (error) {
        result.cleanupErrorCode ??= 'absenceVerificationFailed';
        result.cleanupCauseCode ??= msiPolicyErrorCode(error);
      }
      result.cleanupStatus = result.cleanupErrorCode === null ? 'completed' : 'failed';
    }
  }
  if (result.errorCode === null && result.cleanupStatus === 'completed') result.status = 'completed';
  return Object.freeze(result);
}

export function verifyMsiPolicyUiLog(text, variant, productCode) {
  if (typeof text !== 'string' || text.length > 32 * 1024 * 1024 ||
      !MSI_POLICY_VARIANTS.includes(variant) || !/^\{[0-9A-F-]{36}\}$/.test(productCode ?? '')) {
    throw new Error('msiPolicyLogInvalid');
  }
  // Only the target invocation's own client/server property dump is evidence.
  const expected = variant === 'uiDefault' ? 'emus' : 'omus';
  for (const channel of ['C', 'S']) {
    const blocks = text.match(new RegExp(`(?:^Property\\(${channel}\\): [^\\r\\n]*(?:\\r?\\n|$))+`, 'gm')) ?? [];
    const bound = blocks.filter(block => block.split(/\r?\n/).includes(`Property(${channel}): ProductCode = ${productCode}`));
    if (bound.length !== 1) throw new Error('msiPolicyLogInvalid');
    const values = [...bound[0].matchAll(new RegExp(`^Property\\(${channel}\\): REINSTALLMODE = ([a-z]+)\\r?$`, 'gm'))];
    if (values.length !== 1 || values[0][1] !== expected) throw new Error('msiPolicyLogInvalid');
  }
  const action = /^MSI \(c\) [^\r\n]*: Doing action: EkySetReinstallMode\r?$/m.exec(text);
  const costing = /^MSI \(c\) [^\r\n]*: Doing action: CostInitialize\r?$/m.exec(text);
  if (!costing) throw new Error('msiPolicyLogInvalid');
  if (variant === 'uiDefault') {
    const assignment = /^MSI \(c\) [^\r\n]*: PROPERTY CHANGE: Adding REINSTALLMODE property\. Its value is 'emus'\.\r?$/m.exec(text);
    if (!action || !assignment || action.index >= assignment.index || assignment.index >= costing.index) {
      throw new Error('msiPolicyLogInvalid');
    }
  } else if (action || /^MSI \(c\) [^\r\n]*: PROPERTY CHANGE: (?:Adding|Modifying|Deleting) REINSTALLMODE property\./m.test(text)) {
    // A command-line property is recorded as Adding on some MSI versions.
    // Only a matching initial assignment is allowed, never a modification.
    const changes = [...text.matchAll(/^MSI \(c\) [^\r\n]*: PROPERTY CHANGE: ([^\r\n]*REINSTALLMODE property[^\r\n]*)\r?$/gm)];
    if (action || changes.some(match => match[1] !== "Adding REINSTALLMODE property. Its value is 'omus'.")) {
      throw new Error('msiPolicyLogInvalid');
    }
  }
  return true;
}
