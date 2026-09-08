import { parseWorkspaceCallerCliArguments, validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { runWorkspaceCallerResultProcess } from './workspaceCallerResultProcess.mjs';

export async function runWorkspaceCallerCli(args, { parseScenario, runScenario, failureDetails, errorCode,
  resultProcess = runWorkspaceCallerResultProcess }) {
  let request;
  try {
    request = parseWorkspaceCallerCliArguments(args, parseScenario);
    const prepared = await resultProcess({ operation: 'prepare', resultPath: request.resultPath, payload: request.binding });
    if (prepared.status !== 'completed' || prepared.exitCode !== 0 || !prepared.directProcessAbsent) return 2;
  } catch { return 64; }
  let outcome;
  try { outcome = await runScenario(request.scenarioArgs); }
  catch (error) {
    outcome = failureDetails(error) ?? { schemaVersion: 1, scenario: request.binding.scenario,
      ...(request.binding.faultScenario ? { faultScenario: request.binding.faultScenario } : {}),
      status: 'failed', errorCode: errorCode(error) };
  }
  try {
    const payload = validateWorkspaceCallerResult({ binding: request.binding, outcome }, request.binding);
    const published = await resultProcess({ operation: 'publish', resultPath: request.resultPath, payload });
    if (published.status !== 'completed' || published.exitCode !== 0 || !published.directProcessAbsent) return 2;
    return outcome.status === 'completed' ? 0 : 1;
  } catch { return 2; }
}
