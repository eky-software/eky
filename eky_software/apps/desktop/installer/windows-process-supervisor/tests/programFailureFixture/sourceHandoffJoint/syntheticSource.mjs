import assert from 'node:assert/strict';
import { readSync, realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { setTimeout as nextObservation } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';

const [reportFlag, reportPath, releaseFlag, releasePath, exitFlag, exitCode, separator, ...arguments_] = process.argv.slice(2);
assert.equal(reportFlag, '--report');
assert.equal(releaseFlag, '--release');
assert.equal(exitFlag, '--exit-code');
assert.equal(separator, '--');
assert.equal(exitCode, '0');
assert.equal(dirname(resolve(reportPath)), process.cwd());
assert.equal(dirname(resolve(releasePath)), process.cwd());
const root = await lstat(process.cwd(), { bigint: true });
assert(root.isDirectory() && !root.isSymbolicLink());
const same = (left, right) => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs']
  .every(key => left[key] === right[key]);
const samePath = path => realpathSync.native(path).toLowerCase() === path.toLowerCase();
async function verifyRoot() {
  const now = await lstat(process.cwd(), { bigint: true });
  assert(now.isDirectory() && !now.isSymbolicLink() && now.dev === root.dev && now.ino === root.ino);
  assert(samePath(process.cwd()));
}

async function writeIgnored(stream) {
  stream.on('error', () => {});
  return new Promise(resolvePromise => {
    try { stream.write('SYNTHETIC_IGNORED_STDIO\n', error => resolvePromise(error === undefined || error === null)); }
    catch { resolvePromise(false); }
  });
}

const environment = Object.fromEntries(['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'UNCHANGED',
  'UNICODE_VALUE', 'EMPTY_VALUE', 'EKY_W6B2_PROOF_TOKEN'].map(key => [key, process.env[key] ?? null]));
environment.excludedEkyOverridePresent = Object.keys(process.env).some(key => /^EKY_FAKE$/i.test(key));
environment.excludedNodeOverridePresent = Object.keys(process.env).some(key => /^ELECTRON_RUN_AS_NODE$/i.test(key));
let stdinEof = false;
try { stdinEof = readSync(0, Buffer.alloc(1), 0, 1, null) === 0; } catch { /* Not ignored-stdin proof. */ }
const report = { schemaVersion: 1, arguments: arguments_, cwd: process.cwd(), environment, stdinEof,
  stdoutWritable: await writeIgnored(process.stdout), stderrWritable: await writeIgnored(process.stderr) };
const bytes = Buffer.from(JSON.stringify(report) + '\n');
assert(bytes.length <= 64 * 1024);
await verifyRoot();
const file = await open(reportPath, 'wx');
let first, reportIdentity;
try {
  const held = await file.stat({ bigint: true });
  assert(held.isFile() && held.nlink === 1n && samePath(reportPath));
  await file.writeFile(bytes);
  await file.sync();
  const written = await file.stat({ bigint: true });
  reportIdentity = written;
  const selected = await lstat(reportPath, { bigint: true });
  assert(written.isFile() && selected.isFile() && !selected.isSymbolicLink() &&
    written.nlink === 1n && written.size === BigInt(bytes.length) && same(written, selected));
  await verifyRoot();
} catch (error) { first = error; }
try { await file.close(); }
catch (error) {
  if (first) throw new AggregateError([first, error], 'SOURCE_REPORT_WRITE_AND_CLOSE_FAILED', { cause: first });
  throw error;
}
if (first) throw first;
await verifyRoot();
assert(same(reportIdentity, await lstat(reportPath, { bigint: true })) && samePath(reportPath));
// Readiness only: the report reader still validates every payload byte and identity.
const ready = await open(reportPath + '.ready', 'wx');
let readyFailure;
try {
  const info = await ready.stat({ bigint: true });
  assert(info.isFile() && info.nlink === 1n && info.size === 0n && samePath(reportPath + '.ready'));
  await verifyRoot();
} catch (error) { readyFailure = error; }
try { await ready.close(); }
catch (error) {
  if (readyFailure) throw new AggregateError([readyFailure, error], 'SOURCE_READY_AND_CLOSE_FAILED', { cause: readyFailure });
  throw error;
}
if (readyFailure) throw readyFailure;
await verifyRoot();

// Only this fixed synthetic child waits here; the existing native Job owns its deadline.
for (;;) {
  await verifyRoot();
  let release;
  try { release = await open(releasePath, 'r'); }
  catch (error) {
    if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error;
    await nextObservation(20);
    continue;
  }
  let failure;
  try {
    const held = await release.stat({ bigint: true });
    const selected = await lstat(releasePath, { bigint: true });
    assert(held.isFile() && selected.isFile() && !selected.isSymbolicLink() &&
      held.nlink === 1n && held.size === 0n && same(held, selected) && samePath(releasePath));
    await verifyRoot();
  } catch (error) { failure = error; }
  try { await release.close(); }
  catch (error) {
    if (failure) throw new AggregateError([failure, error], 'SOURCE_RELEASE_READ_AND_CLOSE_FAILED', { cause: failure });
    throw error;
  }
  if (failure) throw failure;
  break;
}
process.exitCode = 0;
