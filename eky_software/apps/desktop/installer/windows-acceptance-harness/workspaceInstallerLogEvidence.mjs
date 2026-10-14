import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_RECEIPT,
  W6B2_INSTALLER_LOG_MAX_BYTES } from '../../src/main/w6b2PackagedInstallerLog.ts';
import { ordinaryPath, retain, retentionFailureCode } from './workspaceEncryptedEvidence.mjs';
import { readCommandPhaseJson } from './acceptanceCommandPhaseInput.mjs';
import { validateWorkspaceCallerBinding, workspaceCallerResultIdentity } from './workspaceCallerResult.mjs';
import { writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';

// The existing bounded fixture-cleanup phase owns this copy, not process exit.
// Preserve the original fixture on any uncertain copy; never infer cleanup from a log.
export async function retainWorkspaceInstallerLog({ proofRoot, resultPath, binding, processTreeAbsent }) {
  if (!processTreeAbsent) return false;
  const callerRoot = dirname(resultPath);
  const expected = validateWorkspaceCallerBinding(binding);
  const identity = workspaceCallerResultIdentity(resultPath, {
    expectedBuildRevision: expected.buildRevision,
    expectedDescriptorSha256: expected.artifactDescriptorSha256,
    ...(expected.faultScenario === null ? {} : { faultScenario: expected.faultScenario }),
  });
  if (identity.invocationId !== expected.invocationId) throw new Error('callerResultInvalid');
  await ordinaryPath(await realpath(dirname(callerRoot)), callerRoot, true);
  if (!isDeepStrictEqual(await readCommandPhaseJson(join(callerRoot, 'binding.json')), expected)) {
    throw new Error('callerResultInvalid');
  }
  const receipt = { binding: expected, status: 'unverified' };
  const temporaryRoot = await realpath(tmpdir());
  const source = join(proofRoot, 'result', W6B2_INSTALLER_LOG_FILE);
  let sourceObserved = false;
  try {
    await ordinaryPath(temporaryRoot, source);
    sourceObserved = true;
    Object.assign(receipt, await retain(temporaryRoot, source,
      join(callerRoot, W6B2_INSTALLER_LOG_FILE), W6B2_INSTALLER_LOG_MAX_BYTES), { status: 'retained' });
  } catch (error) {
    receipt.status = !sourceObserved && error?.code === 'ENOENT' ? 'missing' : 'unverified';
    receipt.failureCode = retentionFailureCode(error);
  }
  await writeJsonAtomicExclusive(join(callerRoot, W6B2_INSTALLER_LOG_RECEIPT), receipt);
  // Historical test packages did not create this optional diagnostic file.
  return receipt.status === 'retained' || receipt.status === 'missing';
}
