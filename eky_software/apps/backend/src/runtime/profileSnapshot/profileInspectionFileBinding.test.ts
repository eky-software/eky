import { createHash } from 'node:crypto';
import { promises as files } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindProfileInspectionFile } from './profileInspectionFileBinding.js';

const roots: string[] = [];
const handles: Awaited<ReturnType<typeof files.open>>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.close();
  for (const root of roots.splice(0)) await files.rm(root, { recursive: true, force: true });
});

describe('profile inspection file handle binding', () => {
  it('hashes actual bytes through one handle and closes it before returning', async () => {
    const fixture = await createFixture();
    const originalOpen = files.open;
    const open = vi.spyOn(files, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      handles.push(handle);
      return handle;
    });
    await expect(bindProfileInspectionFile(fixture.path, fixture.bytes.length, fixture.signal, Buffer.from('%PDF-')))
      .resolves.toMatchObject({ byteSize: fixture.bytes.length,
        sha256: createHash('sha256').update(fixture.bytes).digest('hex') });
    expect(open).toHaveBeenCalledOnce();
    expect(handles[0]?.fd).toBe(-1);
  });

  it('rejects replacing the selected path while retaining the opened original', async () => {
    const fixture = await createFixture();
    const retained = join(fixture.root, 'retained.pdf');
    const originalOpen = files.open;
    vi.spyOn(files, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      handles.push(handle);
      await files.rename(fixture.path, retained);
      await files.writeFile(fixture.path, fixture.bytes);
      return handle;
    });
    await expect(bindProfileInspectionFile(fixture.path, fixture.bytes.length, fixture.signal))
      .rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(handles[0]?.fd).toBe(-1);
    expect(await files.readFile(retained)).toEqual(fixture.bytes);
    expect(await files.readFile(fixture.path)).toEqual(fixture.bytes);
  });

  it('rejects an abort before opening any source handle', async () => {
    const fixture = await createFixture();
    const open = vi.spyOn(files, 'open');
    const cancellation = new AbortController();
    cancellation.abort();
    await expect(bindProfileInspectionFile(fixture.path, fixture.bytes.length, cancellation.signal))
      .rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves cancellation before a later handle-close failure', async () => {
    const fixture = await createFixture();
    const cancellation = new AbortController();
    const originalOpen = files.open;
    vi.spyOn(files, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      handles.push(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'close').mockImplementationOnce(async () => {
        await close();
        throw new Error('synthetic-file-close-failure');
      });
      cancellation.abort();
      return handle;
    });
    const error = await bindProfileInspectionFile(fixture.path, fixture.bytes.length, cancellation.signal)
      .catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((cause: Error) => cause.message))
      .toEqual(['PROFILE_INSPECTION_TIMEOUT', 'synthetic-file-close-failure']);
    expect(handles[0]?.fd).toBe(-1);
    expect(await files.readFile(fixture.path)).toEqual(fixture.bytes);
  });

  it.each(['size', 'signature', 'link'] as const)('rejects a violated %s binding', async target => {
    const fixture = await createFixture();
    if (target === 'link') await files.link(fixture.path, join(fixture.root, 'retained.pdf'));
    await expect(bindProfileInspectionFile(fixture.path,
      target === 'size' ? fixture.bytes.length - 1 : fixture.bytes.length, fixture.signal,
      target === 'signature' ? Buffer.from('%NOT-') : undefined)).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    expect(await files.readFile(fixture.path)).toEqual(fixture.bytes);
  });
});

async function createFixture() {
  const root = await files.mkdtemp(join(tmpdir(), 'eky-handle-binding-'));
  roots.push(root);
  const path = join(root, 'document.pdf');
  const bytes = Buffer.from('%PDF-1.7\nsynthetic handle binding\n');
  await files.writeFile(path, bytes);
  return { root, path, bytes, signal: new AbortController().signal };
}
