import { runCallerResultProcess } from './callerResultProcess.mjs';
import { fileURLToPath } from 'node:url';

import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { validateWorkspaceCallerBinding, validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';

const FILE_ADAPTER = fileURLToPath(new URL('./workspaceCallerResultFile.mjs', import.meta.url));

export async function runWorkspaceCallerResultProcess({ operation, resultPath, payload, commandExit = 0,
  runProcess = runBoundedWindowsAdapterProcess }) {
  return runCallerResultProcess({ operation, resultPath, payload, commandExit, runProcess,
    fileAdapter: FILE_ADAPTER, validateBinding: validateWorkspaceCallerBinding, validateResult: validateWorkspaceCallerResult });
}
