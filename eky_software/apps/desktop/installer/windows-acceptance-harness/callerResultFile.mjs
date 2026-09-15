import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';
export const CALLER_RESULT_MAX_BYTES = 8192;

async function readRegular(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
    before.size < 2n || before.size > BigInt(CALLER_RESULT_MAX_BYTES)) throw new Error('callerResultInvalid');
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1n || opened.size !== before.size) throw new Error('callerResultInvalid');
    const bytes = await handle.readFile();
    const after = await lstat(path, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1n || after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs) throw new Error('callerResultInvalid');
    return bytes;
  } finally { await handle.close(); }
}

async function writeExclusive(path, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (bytes.length > CALLER_RESULT_MAX_BYTES) throw new Error('callerResultInvalid');
  const file = await open(path, 'wx');
  try { await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
}

// One bounded filesystem group; never reads profiles or owns scenario cleanup.
export async function callerResultFile(operation, path, payload, commandExit, contract) {
  const expected = contract.validateBinding(operation === 'publish' ? payload.binding : payload);
  const identity = contract.identity(path, expected);
  if (identity.invocationId !== expected.invocationId) throw new Error('callerResultInvalid');
  const root = dirname(path);
  const temporaryRoot = await realpath(dirname(root));
  const allowedRoots = [await realpath(tmpdir())];
  if (process.env.RUNNER_TEMP) allowedRoots.push(await realpath(process.env.RUNNER_TEMP));
  if (!allowedRoots.includes(temporaryRoot)) throw new Error('callerResultInvalid');
  if (operation === 'prepare') await mkdir(root);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== resolve(temporaryRoot, basename(root))) {
    throw new Error('callerResultInvalid');
  }
  const bindingPath = resolve(root, 'binding.json');
  if (operation === 'prepare') { await writeExclusive(bindingPath, expected); return; }
  const binding = contract.validateBinding(parseStrictJsonObjectBytes(await readRegular(bindingPath), {
    maximumBytes: CALLER_RESULT_MAX_BYTES, errorCode: 'callerResultInvalid',
  }));
  if (Object.keys(expected).some((key) => expected[key] !== binding[key])) throw new Error('callerResultInvalid');
  if (operation === 'publish') {
    const result = contract.validateResult(payload, expected);
    // Refuse stale output instead of replacing a preceding invocation's evidence.
    await lstat(path).then(() => { throw new Error('callerResultInvalid'); }, (error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const pending = resolve(root, 'result.pending');
    await writeExclusive(pending, result);
    // Atomic no-overwrite publication, not artifact cloning. The temporary
    // JSON link is removed before the final single-link validation.
    await link(pending, path);
    await unlink(pending);
    contract.parseResult(await readRegular(path), expected);
  } else if (operation === 'verify') {
    const result = contract.parseResult(await readRegular(path), expected);
    if (commandExit !== 0 || result.outcome.status !== 'completed') throw new Error('callerResultRejected');
  } else throw new Error('callerResultInvalid');
}
