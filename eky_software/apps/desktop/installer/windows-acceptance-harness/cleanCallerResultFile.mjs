import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { callerResultFile } from './callerResultFile.mjs';
import { CLEAN_CALLER_RESULT_MAX_BYTES, validateCleanCallerBinding, validateCleanCallerResult,
  parseCleanCallerResult, cleanCallerResultIdentity } from './cleanCallerResult.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export function cleanCallerResultFile(operation, path, payload, commandExit = null) {
  return callerResultFile(operation, path, payload, commandExit, {
    validateBinding: validateCleanCallerBinding, validateResult: validateCleanCallerResult,
    parseResult: parseCleanCallerResult, identity: cleanCallerResultIdentity });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [operation, path, encoded, exit, ...extra] = process.argv.slice(2);
    if (!['prepare', 'publish', 'verify'].includes(operation) || extra.length || typeof encoded !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > Math.ceil(CLEAN_CALLER_RESULT_MAX_BYTES / 3) * 4 ||
      !['0', '1', '2', '64'].includes(exit)) throw new Error();
    await cleanCallerResultFile(operation, path, parseStrictJsonObjectBytes(Buffer.from(encoded, 'base64'), {
      maximumBytes: CLEAN_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid' }), Number(exit));
  } catch { process.exitCode = 1; }
}
