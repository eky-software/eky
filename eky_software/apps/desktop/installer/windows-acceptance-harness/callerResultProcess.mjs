import { dirname } from 'node:path';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { CALLER_RESULT_MAX_BYTES } from './callerResultFile.mjs';

export const CALLER_RESULT_TIMEOUT_MS = 30_000;
export const CALLER_RESULT_TERMINATION_MS = 5_000;

export async function runCallerResultProcess({ operation, resultPath, payload, commandExit = 0,
  runProcess = runBoundedWindowsAdapterProcess, fileAdapter, validateBinding, validateResult }) {
  if (!['prepare', 'publish', 'verify'].includes(operation)) throw new Error('callerResultInvalid');
  const checked = operation === 'publish' ? validateResult(payload, payload.binding) : validateBinding(payload);
  const bytes = Buffer.from(JSON.stringify(checked));
  if (bytes.length > CALLER_RESULT_MAX_BYTES) throw new Error('callerResultInvalid');
  return runProcess({ command: process.execPath, arguments: [fileAdapter, operation, resultPath, bytes.toString('base64'), String(commandExit)],
    cwd: dirname(fileAdapter), timeoutMilliseconds: CALLER_RESULT_TIMEOUT_MS, terminationTimeoutMilliseconds: CALLER_RESULT_TERMINATION_MS });
}
