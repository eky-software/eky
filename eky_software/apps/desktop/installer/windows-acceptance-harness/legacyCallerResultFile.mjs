import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { callerResultFile } from './callerResultFile.mjs';
import { LEGACY_CALLER_RESULT_MAX_BYTES, validateLegacyCallerBinding, validateLegacyCallerResult,
  parseLegacyCallerResult, legacyCallerResultIdentity } from './legacyCallerResult.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export function legacyCallerResultFile(operation, path, payload, commandExit = null) {
  return callerResultFile(operation, path, payload, commandExit, {
    validateBinding: validateLegacyCallerBinding, validateResult: validateLegacyCallerResult,
    parseResult: parseLegacyCallerResult, identity: legacyCallerResultIdentity,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [operation, path, encoded, exit, ...extra] = process.argv.slice(2);
    if (!['prepare', 'publish', 'verify'].includes(operation) || extra.length || typeof encoded !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > Math.ceil(LEGACY_CALLER_RESULT_MAX_BYTES / 3) * 4 ||
      !['0', '1', '2', '64'].includes(exit)) throw new Error();
    await legacyCallerResultFile(operation, path, parseStrictJsonObjectBytes(Buffer.from(encoded, 'base64'), {
      maximumBytes: LEGACY_CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid',
    }), Number(exit));
  } catch { process.exitCode = 1; }
}
