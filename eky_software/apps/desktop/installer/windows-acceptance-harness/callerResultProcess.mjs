import { dirname } from 'node:path';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { CALLER_RESULT_MAX_BYTES } from './callerResultFile.mjs';

export async function runCallerResultProcess({ operation, resultPath, payload, commandExit = 0,
  runProcess = runBoundedWindowsAdapterProcess, fileAdapter, validateBinding, validateResult }) {
  if (!['prepare', 'publish', 'verify'].includes(operation)) throw new Error('callerResultInvalid');
  const checked = operation === 'publish' ? validateResult(payload, payload.binding) : validateBinding(payload);
  const bytes = Buffer.from(JSON.stringify(checked));
  if (bytes.length > CALLER_RESULT_MAX_BYTES) throw new Error('callerResultInvalid');
  return runProcess({ command: process.execPath, arguments: [fileAdapter, operation, resultPath, bytes.toString('base64'), String(commandExit)],
    cwd: dirname(fileAdapter), timeoutMilliseconds: 30_000, terminationTimeoutMilliseconds: 5_000 });
}
