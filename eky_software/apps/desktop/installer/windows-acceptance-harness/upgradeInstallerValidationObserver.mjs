import { watch } from 'node:fs';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';

const MAX_LOG_BYTES = 32 * 1024 * 1024;
const invalid = () => new Error('runningUpgradeValidationInvalid');

export function hasInstallerValidationStarted(bytes) {
  if (bytes.length > MAX_LOG_BYTES) throw invalid();
  const text = bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.subarray(2, bytes.length - (bytes.length % 2)).toString('utf16le')
    : bytes.toString('utf8');
  return text.split('\n').some((line) =>
    /^MSI \(s\) \([0-9A-Fa-f]+:[0-9A-Fa-f]+\) \[[0-9:.]+\]: Doing action: InstallValidate\r?$/.test(line));
}

// One private MSI file observation; no clock, process owner, or success decision.
export async function createInstallerValidationObserver(path) {
  await writeFile(path, '', { flag: 'wx' });
  const canonical = await realpath(path);
  const before = await lstat(canonical, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw invalid();
  let closed = false, scanning = false, again = false, watcher;
  let scan = Promise.resolve();
  let done, reject;
  const completion = new Promise((resolvePromise, rejectPromise) => { done = resolvePromise; reject = rejectPromise; });
  completion.catch(() => undefined);
  const fail = () => { closed = true; watcher?.close(); reject(invalid()); };
  const inspect = () => {
    if (closed) return;
    if (scanning) { again = true; return; }
    scanning = true;
    scan = (async () => {
      const current = await lstat(canonical, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n ||
        current.dev !== before.dev || current.ino !== before.ino || current.size > BigInt(MAX_LOG_BYTES)) throw invalid();
      const bytes = await readFile(canonical);
      if (!closed && hasInstallerValidationStarted(bytes)) {
        closed = true;
        watcher.close();
        done();
      }
    })().catch(fail).finally(() => {
      scanning = false;
      if (again && !closed) { again = false; inspect(); }
    });
  };
  try {
    watcher = watch(canonical, { persistent: false }, inspect);
    watcher.once('error', fail);
    inspect();
  } catch { fail(); }
  return Object.freeze({ completion, async close() { closed = true; watcher?.close(); await scan; } });
}
