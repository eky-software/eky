import { fileURLToPath } from 'node:url';
import { runCallerResultProcess } from './callerResultProcess.mjs';
import { validateLegacyCallerBinding, validateLegacyCallerResult } from './legacyCallerResult.mjs';

const FILE_ADAPTER = fileURLToPath(new URL('./legacyCallerResultFile.mjs', import.meta.url));
export function runLegacyCallerResultProcess(options) {
  return runCallerResultProcess({ ...options, fileAdapter: FILE_ADAPTER,
    validateBinding: validateLegacyCallerBinding, validateResult: validateLegacyCallerResult });
}
