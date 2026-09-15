import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
const regularFile = (info) => info.isFile() && !info.isSymbolicLink();

// Only the compiled GUI contract fixture; this is not an artifact trust policy.
export async function readWindowsApplicationCloseFixtureIdentity(executable, runRoot) {
  try {
    if (!isAbsolute(executable) || !isAbsolute(runRoot) ||
        resolve(executable) !== resolve(runRoot, 'WindowContract.exe')) throw new Error();
    const root = await lstat(runRoot, { bigint: true });
    const before = await lstat(executable, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink() || !regularFile(before)) throw new Error();
    const canonicalRoot = await realpath(runRoot);
    const canonicalPath = await realpath(executable);
    if (dirname(canonicalPath) !== canonicalRoot) throw new Error();

    const handle = await open(executable, 'r');
    let sha256;
    try {
      const opened = await handle.stat({ bigint: true });
      if (!regularFile(opened) || !sameFile(before, opened) || before.size !== opened.size) {
        throw new Error();
      }
      sha256 = createHash('sha256').update(await handle.readFile()).digest('hex');
      const finished = await handle.stat({ bigint: true });
      if (!sameFile(opened, finished) || opened.size !== finished.size) throw new Error();
    } finally {
      await handle.close();
    }

    const after = await lstat(executable, { bigint: true });
    const rootAfter = await lstat(runRoot, { bigint: true });
    if (!regularFile(after) || !sameFile(before, after) || before.size !== after.size ||
        !sameFile(root, rootAfter) || rootAfter.isSymbolicLink() ||
        await realpath(executable) !== canonicalPath || await realpath(runRoot) !== canonicalRoot) {
      throw new Error();
    }
    return {
      canonicalRoot, canonicalPath, rootDevice: root.dev, rootFileId: root.ino,
      device: after.dev, fileId: after.ino, size: after.size, sha256, links: Number(after.nlink),
    };
  } catch {
    throw new Error('nativeFixtureIdentityInvalid');
  }
}

export function assertWindowsApplicationCloseFixtureIdentity(expected, current) {
  const samePath = expected.canonicalRoot === current.canonicalRoot &&
    expected.canonicalPath === current.canonicalPath;
  const sameIdentity = expected.rootDevice === current.rootDevice &&
    expected.rootFileId === current.rootFileId && expected.device === current.device &&
    expected.fileId === current.fileId;
  const sameBytes = expected.size === current.size && expected.sha256 === current.sha256;
  if (!samePath || !sameIdentity || !sameBytes) throw new Error('nativeFixtureIdentityChanged');
  return { samePath, sameFile: sameIdentity, sameBytes, linkCount: current.links };
}
