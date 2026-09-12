import { runWorkspaceCallerResultProcess } from './workspaceCallerResultProcess.mjs';
import { parseWorkspaceCallerCliArguments } from './workspaceCallerResult.mjs';
import { parseWorkspaceSuccessArguments, parseWorkspaceFaultArguments } from './workspaceCommandAdmission.mjs';

try {
  const args = process.argv.slice(2);
  if (args.at(-2) !== '--command-exit' || !['0', '1', '2', '64'].includes(args.at(-1))) throw new Error();
  const commandExit = Number(args.at(-1));
  const base = args.slice(0, -2);
  const parsed = parseWorkspaceCallerCliArguments(base, base.includes('--fault-scenario') ? parseWorkspaceFaultArguments : parseWorkspaceSuccessArguments);
  const result = await runWorkspaceCallerResultProcess({ operation: 'verify', resultPath: parsed.resultPath,
    payload: parsed.binding, commandExit });
  process.exitCode = result.status === 'completed' && result.exitCode === 0 && result.directProcessAbsent ? 0 : 1;
} catch { process.exitCode = 1; }
