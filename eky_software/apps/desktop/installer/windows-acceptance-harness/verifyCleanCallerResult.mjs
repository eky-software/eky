import { fileURLToPath } from 'node:url';
import { parseCleanCallerArguments, validateCleanCallerBinding, validateCleanCallerResult } from './cleanCallerResult.mjs';
import { runCallerResultProcess } from './callerResultProcess.mjs';

try {
  const args = process.argv.slice(2);
  if (args.at(-2) !== '--command-exit' || !['0', '1', '2', '64'].includes(args.at(-1))) throw new Error();
  const parsed = parseCleanCallerArguments(args.slice(0, -2));
  const result = await runCallerResultProcess({ operation: 'verify', resultPath: parsed.resultPath,
    payload: parsed.binding, commandExit: Number(args.at(-1)),
    fileAdapter: fileURLToPath(new URL('./cleanCallerResultFile.mjs', import.meta.url)),
    validateBinding: validateCleanCallerBinding, validateResult: validateCleanCallerResult });
  process.exitCode = result.status === 'completed' && result.exitCode === 0 && result.directProcessAbsent ? 0 : 1;
} catch { process.exitCode = 1; }
