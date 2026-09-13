import { fileURLToPath } from 'node:url';
import { parseUpgradeCallerArguments, validateUpgradeCallerBinding, validateUpgradeCallerResult } from './upgradeCallerResult.mjs';
import { runCallerResultProcess } from './callerResultProcess.mjs';

try {
  const args = process.argv.slice(2);
  if (args.at(-2) !== '--command-exit' || !['0', '1', '2', '64'].includes(args.at(-1))) throw new Error();
  const parsed = parseUpgradeCallerArguments(args.slice(0, -2));
  const result = await runCallerResultProcess({ operation: 'verify', resultPath: parsed.resultPath,
    payload: parsed.binding, commandExit: Number(args.at(-1)),
    fileAdapter: fileURLToPath(new URL('./upgradeCallerResultFile.mjs', import.meta.url)),
    validateBinding: validateUpgradeCallerBinding, validateResult: validateUpgradeCallerResult });
  process.exitCode = result.status === 'completed' && result.exitCode === 0 && result.directProcessAbsent ? 0 : 1;
} catch { process.exitCode = 1; }
