import { parseLegacyUpgradeArguments } from './legacyUpgradeAdmission.mjs';
import { parseLegacyCallerArguments } from './legacyCallerResult.mjs';
import { runLegacyCallerResultProcess } from './legacyCallerResultProcess.mjs';

try {
  const args = process.argv.slice(2);
  if (args.at(-2) !== '--command-exit' || !['0', '1', '2', '64'].includes(args.at(-1))) throw new Error();
  const parsed = parseLegacyCallerArguments(args.slice(0, -2), parseLegacyUpgradeArguments);
  const result = await runLegacyCallerResultProcess({ operation: 'verify', resultPath: parsed.resultPath,
    payload: parsed.binding, commandExit: Number(args.at(-1)) });
  process.exitCode = result.status === 'completed' && result.exitCode === 0 && result.directProcessAbsent ? 0 : 1;
} catch { process.exitCode = 1; }
