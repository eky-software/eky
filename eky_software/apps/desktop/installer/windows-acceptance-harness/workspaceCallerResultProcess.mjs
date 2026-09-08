import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { validateWorkspaceCallerBinding, validateWorkspaceCallerResult, WORKSPACE_CALLER_RESULT_MAX_BYTES } from './workspaceCallerResult.mjs';

const FILE_ADAPTER = fileURLToPath(new URL('./workspaceCallerResultFile.mjs', import.meta.url));

export async function runWorkspaceCallerResultProcess({ operation, resultPath, payload, commandExit = 0,
  runProcess = runBoundedWindowsAdapterProcess }) {
  if (!['prepare', 'publish', 'verify'].includes(operation)) throw new Error('callerResultInvalid');
  const checked = operation === 'publish' ? validateWorkspaceCallerResult(payload, payload.binding) : validateWorkspaceCallerBinding(payload);
  const bytes = Buffer.from(JSON.stringify(checked));
  if (bytes.length > WORKSPACE_CALLER_RESULT_MAX_BYTES) throw new Error('callerResultInvalid');
  return runProcess({ command: process.execPath, arguments: [FILE_ADAPTER, operation, resultPath, bytes.toString('base64'), String(commandExit)],
    cwd: dirname(FILE_ADAPTER), timeoutMilliseconds: 30_000, terminationTimeoutMilliseconds: 5_000 });
}
