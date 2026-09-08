import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { WORKSPACE_FAULT_SCENARIO } from './workspaceFaultContracts.mjs';
import { runWorkspaceFault, workspaceCommandErrorCode,
  workspaceSuccessCommandFailureDetails } from './runWorkspaceSuccess.mjs';

export { runWorkspaceFault } from './runWorkspaceSuccess.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runWorkspaceFault(process.argv.slice(2)))); }
  catch (error) {
    console.error(JSON.stringify(workspaceSuccessCommandFailureDetails(error) ?? {
      schemaVersion: 1, scenario: WORKSPACE_FAULT_SCENARIO, status: 'failed',
      errorCode: workspaceCommandErrorCode(error, true),
    }));
    process.exitCode = 1;
  }
}
