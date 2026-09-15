import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
import { callerResultFile } from './callerResultFile.mjs';
import { WORKSPACE_CALLER_RESULT_MAX_BYTES, parseWorkspaceCallerResult,
  validateWorkspaceCallerBinding, validateWorkspaceCallerResult, workspaceCallerResultIdentity } from './workspaceCallerResult.mjs';

export function workspaceCallerResultFile(operation, path, payload, commandExit = null) {
  return callerResultFile(operation, path, payload, commandExit, {
    validateBinding: validateWorkspaceCallerBinding, validateResult: validateWorkspaceCallerResult,
    parseResult: parseWorkspaceCallerResult,
    identity: (resultPath, expected) => workspaceCallerResultIdentity(resultPath, {
      expectedBuildRevision: expected.buildRevision, expectedDescriptorSha256: expected.artifactDescriptorSha256,
      ...(expected.faultScenario === null ? {} : { faultScenario: expected.faultScenario }),
    }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [operation, resultPath, encoded, exit, ...extra] = process.argv.slice(2);
    if (!['prepare', 'publish', 'verify'].includes(operation) || extra.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      encoded.length > Math.ceil(WORKSPACE_CALLER_RESULT_MAX_BYTES / 3) * 4 || !['0', '1', '2', '64'].includes(exit)) throw new Error();
    const payload = parseStrictJsonObjectBytes(Buffer.from(encoded, 'base64'), {
      maximumBytes: WORKSPACE_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid',
    });
    await workspaceCallerResultFile(operation, resultPath, payload, Number(exit));
  } catch { process.exitCode = 1; }
}
