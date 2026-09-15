import { dirname, resolve } from 'node:path';
import { WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME } from './workspaceSuccessArtifactDescriptor.mjs';
import { workspaceFaultPlan } from './workspaceFaultContracts.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export function parseWorkspaceSuccessArguments(args) {
  if (args.length !== 6 || args[0] !== '--artifact-descriptor' || args[2] !== '--expected-descriptor-sha256' ||
    args[4] !== '--expected-build-revision' || !/^[0-9a-f]{64}$/.test(args[3]) || !/^[0-9a-f]{40}$/.test(args[5])) {
    throw new Error('requestInvalid');
  }
  const descriptor = parseAbsoluteWindowsAcceptancePath(args[1], 'requestInvalid');
  if (resolve(dirname(descriptor), WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME) !== descriptor) throw new Error('requestInvalid');
  return { artifactRoot: dirname(descriptor), expectedDescriptorSha256: args[3], expectedBuildRevision: args[5] };
}

export function parseWorkspaceFaultArguments(args) {
  if (args.length !== 8 || args[6] !== '--fault-scenario') throw new Error('requestInvalid');
  try { workspaceFaultPlan(args[7]); }
  catch { throw new Error('requestInvalid'); }
  return { ...parseWorkspaceSuccessArguments(args.slice(0, 6)), faultScenario: args[7] };
}
