import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomicExclusive } from '../cleanInstallUninstallContracts.mjs';
import { runInstallerProductCommand } from '../installerProductOperationWorker.mjs';
import { parseStrictJsonObjectBytes } from '../strictJsonObject.mjs';
import { prepareMsiFileVersionPolicyFixture } from './buildMsiFileVersionPolicyFixture.mjs';
import { exerciseMsiFileVersionPolicy, MSI_POLICY_VARIANTS, msiPolicyErrorCode } from './msiFileVersionPolicyLifecycle.mjs';
import { createMsiPolicyRuntime, hashBytes, readMsiPolicyDescriptor, readPolicyBytes } from './msiFileVersionPolicyRuntime.mjs';

export function requireHostedMsiPolicyEnvironment(env, platform = process.platform) {
  if (platform !== 'win32' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      env.RUNNER_OS !== 'Windows') throw new Error('msiPolicyHostedRunnerRequired');
}

export async function runMsiPolicyWorker(mode, requestPath, descriptorPath) {
  if (!['prepare', ...MSI_POLICY_VARIANTS].includes(mode) || !isAbsolute(requestPath)) {
    throw new Error('msiPolicyRequestInvalid');
  }
  const request = parseStrictJsonObjectBytes(await readPolicyBytes(requestPath),
    { maximumBytes: 64 * 1024, errorCode: 'msiPolicyRequestInvalid' });
  const root = dirname(requestPath);
  if (request.schemaVersion !== 1 || request.scenario !== 'msiFileVersionPolicy' ||
      request.workingDirectory !== root || !/^[0-9a-f]{64}$/.test(request.runNonce) ||
      !/^[0-9a-f]{64}$/.test(request.artifactDescriptorSha256)) throw new Error('msiPolicyRequestInvalid');
  const binding = { schemaVersion: 1, runNonce: request.runNonce, scenario: request.scenario,
    artifactDescriptorSha256: request.artifactDescriptorSha256 };
  let result = { variant: mode, status: 'failed', phase: 'preparation', errorCode: 'preparationFailed', causeCode: null,
    sourceVerified: false, policyVerified: false, cleanupStatus: 'notAttempted', cleanupErrorCode: null, cleanupCauseCode: null };
  try {
    if (mode === 'prepare') {
      const authoringPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../wix/Package.wxs');
      if (hashBytes(await readPolicyBytes(authoringPath)) !== binding.artifactDescriptorSha256) {
        throw new Error('msiPolicyInputChanged');
      }
      const fixtureRoot = resolve(root, 'fixture');
      await mkdir(fixtureRoot);
      const descriptor = await prepareMsiFileVersionPolicyFixture({ root: fixtureRoot, runNonce: request.runNonce,
        execute: async (command, args, { cwd }) => { await runInstallerProductCommand(command, args, cwd); return 0; } });
      const preparedPath = resolve(fixtureRoot, 'descriptor.json');
      await writeJsonAtomicExclusive(preparedPath, descriptor);
      result.phase = 'metadata';
      result.errorCode = 'metadataFailed';
      await createMsiPolicyRuntime(descriptor, preparedPath, root).metadata();
      result.status = 'completed';
      result.phase = 'preparation';
      result.errorCode = null;
    } else {
      requireHostedMsiPolicyEnvironment(process.env);
      const descriptor = await readMsiPolicyDescriptor(descriptorPath, request.artifactDescriptorSha256);
      const runtime = createMsiPolicyRuntime(descriptor, descriptorPath, root);
      result.phase = 'metadata';
      result.errorCode = 'metadataFailed';
      await runtime.metadata();
      result = await exerciseMsiFileVersionPolicy(mode, runtime);
    }
  } catch (error) { result.causeCode = msiPolicyErrorCode(error); }
  await writeJsonAtomicExclusive(resolve(root, 'policy-result.json'), { binding, result });
  await writeJsonAtomicExclusive(resolve(root, 'worker-result.json'), {
    ...binding, status: result.status,
    resultCode: result.status === 'completed' ? 'msiPolicyCompleted' : 'msiPolicyFailed',
    errorCode: result.status === 'completed' ? null : result.errorCode ?? result.cleanupErrorCode ?? 'msiPolicyFailed',
  });
  return result.status === 'completed' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) throw new Error('msiPolicyRequestInvalid');
    process.exitCode = await runMsiPolicyWorker(...process.argv.slice(2));
  } catch { process.exitCode = 1; }
}
