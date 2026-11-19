import { realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const same = (left, right) =>
  ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const invalid = code => { throw new Error(code); };
const assertEmptyRegular = info => {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n)
    invalid('SOURCE_PUBLICATION_READY_IDENTITY_INVALID');
  if (info.size !== 0n) invalid('SOURCE_PUBLICATION_READY_SIZE_INVALID');
};

// A private fixture readiness observation only, not payload, exit or Job authority.
export async function readPublicationReady(path, { verifyRoot, assertActive, openFile = open }) {
  assertActive();
  await verifyRoot();
  assertActive();
  let file;
  try { file = await openFile(path, 'r'); }
  catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
    assertActive();
    await verifyRoot();
    assertActive();
    return { status: 'notReady', code: error.code };
  }
  let primary;
  try {
    assertActive();
    const before = await file.stat({ bigint: true });
    assertActive();
    assertEmptyRegular(before);
    const pathBefore = await lstat(path, { bigint: true });
    assertActive();
    assertEmptyRegular(pathBefore);
    if (!same(before, pathBefore) || realpathSync.native(path).toLowerCase() !== path.toLowerCase())
      invalid('SOURCE_PUBLICATION_READY_IDENTITY_INVALID');
    const heldAfter = await file.stat({ bigint: true });
    assertActive();
    const pathAfter = await lstat(path, { bigint: true });
    assertActive();
    assertEmptyRegular(heldAfter);
    assertEmptyRegular(pathAfter);
    if (!same(before, heldAfter) || !same(before, pathAfter))
      invalid('SOURCE_PUBLICATION_READY_CHANGED');
    await verifyRoot();
    assertActive();
  } catch (error) { primary = { error }; }
  finally {
    try { await file.close(); }
    catch (error) {
      if (primary) throw new AggregateError([primary.error, error],
        'SOURCE_PUBLICATION_READY_READ_AND_CLOSE_FAILED', { cause: primary.error });
      throw error;
    }
  }
  if (primary) throw primary.error;
  assertActive();
  return { status: 'ready' };
}
