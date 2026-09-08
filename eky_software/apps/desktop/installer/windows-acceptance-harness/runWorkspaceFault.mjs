import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runWorkspaceCallerCli } from './workspaceCallerCli.mjs';
import { runWorkspaceFault, parseWorkspaceFaultArguments, workspaceCommandErrorCode,
  workspaceSuccessCommandFailureDetails } from './runWorkspaceSuccess.mjs';

export { runWorkspaceFault } from './runWorkspaceSuccess.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runWorkspaceCallerCli(process.argv.slice(2), { parseScenario: parseWorkspaceFaultArguments,
    runScenario: runWorkspaceFault, failureDetails: workspaceSuccessCommandFailureDetails,
    errorCode: (error) => workspaceCommandErrorCode(error, true) });
}
