import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReadOnlyJournalSlotPaths } from '../management/mainOwnedWorkspaceManagementOperationGuard.js';
import { hasAnyJournalSlot, hasTerminalJournalConflict } from './readOnlyJournalSlots.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
const maximumBytes = 64;
const terminalJson = '{"state":"accepted"}';
const parse = (value: unknown) => {
  if (typeof value !== 'object' || value === null || !('state' in value)) {
    throw new Error('invalid');
  }
  return { state: value.state };
};
const isTerminal = (record: { readonly state: unknown }) => record.state === 'accepted';

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { force: true, recursive: true });
});

async function createFixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'eky-read-only-journal-'));
  roots.push(root);
  const paths = createReadOnlyJournalSlotPaths(join(root, 'journal.json'));
  return {
    root, paths,
    inspect: () => hasTerminalJournalConflict(paths, maximumBytes, parse, isTerminal),
  };
}

describe('read-only journal slots', () => {
  it('does not create missing journal directories', async () => {
    const { root } = await createFixture();
    const paths = createReadOnlyJournalSlotPaths(join(root, 'missing', 'nested', 'journal.json'));
    await expect(hasAnyJournalSlot(paths)).resolves.toBe(false);
    await expect(hasTerminalJournalConflict(paths, maximumBytes, parse, isTerminal)).resolves.toBe(false);
    await expect(fs.lstat(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a linked parent even when the leaf and intermediate directories do not exist', async () => {
    const { root } = await createFixture();
    const target = join(root, 'target');
    const linked = join(root, 'linked');
    await fs.mkdir(target, { mode: 0o700 });
    await fs.symlink(target, linked, 'junction');
    for (const directory of [linked, join(linked, 'missing')]) {
      const paths = createReadOnlyJournalSlotPaths(join(directory, 'journal.json'));
      await expect(hasAnyJournalSlot(paths)).rejects.toThrow();
    }
    expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
  });

  it('rejects a dangling linked parent instead of treating it as a missing directory', async () => {
    const { root } = await createFixture();
    const linked = join(root, 'dangling');
    await fs.symlink(join(root, 'absent-target'), linked, 'junction');
    for (const directory of [linked, join(linked, 'missing')]) {
      const paths = createReadOnlyJournalSlotPaths(join(directory, 'journal.json'));
      await expect(hasAnyJournalSlot(paths)).rejects.toThrow();
      await expect(hasTerminalJournalConflict(paths, maximumBytes, parse, isTerminal)).rejects.toThrow();
    }
    expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
  });

  it('does not read terminal bytes while a companion slot exists', async () => {
    const { paths, inspect } = await createFixture();
    await fs.writeFile(paths.currentPath, terminalJson);
    await fs.writeFile(paths.nextPath, 'partial write');
    const open = vi.mocked(fs.open);
    open.mockClear();
    await expect(inspect()).resolves.toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readFile(paths.currentPath, 'utf8')).toBe(terminalJson);
    expect(await fs.readFile(paths.nextPath, 'utf8')).toBe('partial write');
  });

  it('reads exactly the configured byte budget and rejects a larger file', async () => {
    const { paths, inspect } = await createFixture();
    const exact = terminalJson.padEnd(maximumBytes, ' ');
    await fs.writeFile(paths.currentPath, exact);
    await expect(inspect()).resolves.toBe(false);
    expect(await fs.readFile(paths.currentPath, 'utf8')).toBe(exact);
    await fs.appendFile(paths.currentPath, ' ');
    await expect(inspect()).rejects.toThrow();
    expect((await fs.readFile(paths.currentPath)).byteLength).toBe(maximumBytes + 1);
  });

  it('detects file growth between metadata and open without parsing it', async () => {
    const { paths } = await createFixture();
    await fs.writeFile(paths.currentPath, terminalJson);
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const parser = vi.fn(parse);
    vi.mocked(fs.open).mockImplementationOnce(async (path, flags, mode) => {
      expect(flags).toBe('r');
      await fs.appendFile(paths.currentPath, ' '.repeat(maximumBytes));
      return real.open(path, flags, mode);
    });
    await expect(hasTerminalJournalConflict(paths, maximumBytes, parser, isTerminal)).rejects.toThrow();
    expect(parser).not.toHaveBeenCalled();
    expect((await fs.readFile(paths.currentPath)).byteLength).toBe(terminalJson.length + maximumBytes);
  });

  it('rejects malformed UTF-8 rather than replacing bytes inside a valid record', async () => {
    const { paths, inspect } = await createFixture();
    const bytes = Buffer.concat([
      Buffer.from('{"state":"accepted","extra":"'),
      Buffer.from([0xff]), Buffer.from('"}'),
    ]);
    await fs.writeFile(paths.currentPath, bytes);
    await expect(inspect()).rejects.toThrow();
    expect(await fs.readFile(paths.currentPath)).toEqual(bytes);
  });

  it('propagates read access failure rather than claiming an absent journal', async () => {
    const { paths, inspect } = await createFixture();
    await fs.writeFile(paths.currentPath, terminalJson);
    vi.mocked(fs.open).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(inspect()).rejects.toThrow();
    expect(await fs.readFile(paths.currentPath, 'utf8')).toBe(terminalJson);
  });
});
