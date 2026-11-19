import { realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { setTimeout as nextObservation } from 'node:timers/promises';
import { parseStrictJsonObjectBytes } from '../../../../windows-acceptance-harness/strictJsonObject.mjs';

const same = (left, right) => left.isFile() && right.isFile() &&
  ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
const invalid = code => { throw new Error(code); };
const assertRegular = info => {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) invalid('SOURCE_PUBLICATION_IDENTITY_INVALID');
};

// Private candidate only. A successful bounded read is not process-launch authority.
// Open before inspecting length: an exclusive writer may still own even complete bytes.
export async function readPublishedResult(path, maximumBytes, {
  verifyRoot, assertActive, openFile = open,
}) {
  assertActive();
  await verifyRoot();
  assertActive();
  let file;
  try { file = await openFile(path, 'r'); }
  catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
    assertActive();
    return { status: 'notReady', code: error.code };
  }
  let primary, result;
  try {
    assertActive();
    const before = await file.stat({ bigint: true });
    assertActive();
    assertRegular(before);
    if (before.size < 2n || before.size > BigInt(maximumBytes)) invalid('SOURCE_PUBLICATION_SIZE_INVALID');
    const pathBefore = await lstat(path, { bigint: true });
    assertActive();
    assertRegular(pathBefore);
    if (!same(before, pathBefore) || realpathSync.native(path).toLowerCase() !== path.toLowerCase())
      invalid('SOURCE_PUBLICATION_IDENTITY_INVALID');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset);
      assertActive();
      if (read.bytesRead === 0) invalid('SOURCE_PUBLICATION_TRUNCATED');
      offset += read.bytesRead;
    }
    const tail = await file.read(Buffer.alloc(1), 0, 1, bytes.length);
    assertActive();
    if (tail.bytesRead !== 0) invalid('SOURCE_PUBLICATION_CHANGED');
    const heldAfter = await file.stat({ bigint: true });
    const pathAfter = await lstat(path, { bigint: true });
    assertActive();
    assertRegular(heldAfter);
    assertRegular(pathAfter);
    if (!same(before, heldAfter) || !same(before, pathAfter)) invalid('SOURCE_PUBLICATION_CHANGED');
    await verifyRoot();
    assertActive();
    if (bytes.at(-1) !== 10) invalid('SOURCE_PUBLICATION_FRAME_INVALID');
    result = { status: 'ready', bytes, value: parseStrictJsonObjectBytes(bytes,
      { maximumBytes, errorCode: 'SOURCE_PUBLICATION_JSON_INVALID' }) };
  } catch (error) { primary = error; }
  try { await file.close(); }
  catch (error) {
    if (primary) throw new AggregateError([primary, error], 'SOURCE_PUBLICATION_READ_AND_CLOSE_FAILED', { cause: primary });
    throw error;
  }
  if (primary) throw primary;
  assertActive();
  return result;
}

// This is a readiness pulse under the existing enclosing owner, not another deadline.
// No fs.watch callback or final close notification is required for progress.
export async function waitForPublishedResult(read, { signal, assertActive, observedNotReady = () => {} }) {
  for (;;) {
    assertActive();
    const value = await read();
    assertActive();
    if (value.status === 'ready') return value;
    if (value.status !== 'notReady' || !['ENOENT', 'EBUSY'].includes(value.code))
      invalid('SOURCE_PUBLICATION_STATE_INVALID');
    observedNotReady(value.code);
    try { await nextObservation(20, undefined, { signal }); }
    catch (error) {
      if (signal.aborted && error.name === 'AbortError') throw signal.reason;
      throw error;
    }
  }
}
