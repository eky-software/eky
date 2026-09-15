import { runCallerResultCli } from './callerResultCli.mjs';
import { parseWorkspaceCallerCliArguments, validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { runWorkspaceCallerResultProcess } from './workspaceCallerResultProcess.mjs';

export async function runWorkspaceCallerCli(args, { parseScenario, runScenario, failureDetails, errorCode,
  resultProcess = runWorkspaceCallerResultProcess }) {
  return runCallerResultCli(args, { parseArguments: (input) => parseWorkspaceCallerCliArguments(input, parseScenario),
    runScenario, failureDetails, errorCode, resultProcess, validateResult: validateWorkspaceCallerResult });
}
