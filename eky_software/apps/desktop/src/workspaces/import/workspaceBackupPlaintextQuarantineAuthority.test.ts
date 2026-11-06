import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { WorkspaceBackupPlaintextQuarantine } from './workspaceBackupPlaintextQuarantine.js';

const boundary = vi.hoisted(() => ({
  afterStat: undefined as undefined | ((path: string) => Promise<void>),
  afterMutation: undefined as undefined | ((kind: 'mkdir' | 'chmod', path: string) => Promise<void>),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, lstat: async (...args: Parameters<typeof fs.lstat>) => {
    const result = await fs.lstat(...args); await boundary.afterStat?.(String(args[0])); return result;
  }, mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
    const result = await fs.mkdir(...args); await boundary.afterMutation?.('mkdir', String(args[0])); return result;
  }, chmod: async (...args: Parameters<typeof fs.chmod>) => {
    await fs.chmod(...args); await boundary.afterMutation?.('chmod', String(args[0]));
  } };
});

async function fixture(context: TestContext, withPayload = true) {
  boundary.afterStat = undefined;
  boundary.afterMutation = undefined;
  const root = await mkdtemp(join(tmpdir(), 'eky-quarantine-authority-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => {
    boundary.afterStat = undefined;
    boundary.afterMutation = undefined;
    if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const quarantine = new WorkspaceBackupPlaintextQuarantine({ userDataRoot: root });
  const path = withPayload ? await quarantine.createPayloadPath() : undefined;
  if (path !== undefined) await writeFile(path, 'synthetic retained plaintext', { mode: 0o600 });
  const state = { current: true };
  const authority = { async assertCurrent() { if (!state.current) throw new Error('SYNTHETIC_COLD_OWNER_EXPIRED'); },
    assertMutationCurrent() { if (!state.current) throw new Error('SYNTHETIC_COLD_OWNER_EXPIRED'); } };
  return { root, quarantine, path: path!, state, authority,
    operationsRoot: join(root, 'workspace-operations'),
    quarantineRoot: join(root, 'workspace-operations', 'workspace-import-plaintext-quarantine') };
}

it('guarded recovery removes only the current private payload and leaves unrelated data', async context => {
  const f = await fixture(context); const other = join(f.root, 'other');
  await writeFile(other, 'preserved synthetic file');
  await f.quarantine.recoverStalePayloads(f.authority);
  expect(await readdir(f.quarantineRoot)).toEqual([]);
  expect(await readFile(other, 'utf8')).toBe('preserved synthetic file');
});

it('expired cold ownership prevents even quarantine directory preparation', async context => {
  const f = await fixture(context, false); f.state.current = false;
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED' });
  expect(await readdir(f.root)).toEqual([]);
});

it('losing ownership during private entry inspection preserves plaintext', async context => {
  const f = await fixture(context);
  boundary.afterStat = async path => { if (path === f.path) f.state.current = false; };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(await readFile(f.path, 'utf8')).toBe('synthetic retained plaintext');
});

it('a delayed inspection cannot later delete after its owner expires', async context => {
  const f = await fixture(context); let entered!: () => void, finish!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let once = false;
  boundary.afterStat = async path => { if (!once && path === f.path) { once = true; entered(); await gate; } };
  const work = f.quarantine.recoverStalePayloads(f.authority); const failed = expect(work).rejects.toThrow();
  await reached; f.state.current = false; finish(); await failed;
  expect(await readFile(f.path, 'utf8')).toBe('synthetic retained plaintext');
});

it('a same-byte replacement after entry selection is not adopted for removal', async context => {
  const f = await fixture(context); let observed = 0;
  boundary.afterStat = async path => {
    if (path !== f.path || ++observed !== 2) return;
    await rename(f.path, join(f.root, 'retained-original'));
    await writeFile(f.path, 'synthetic retained plaintext', { flag: 'wx', mode: 0o600 });
  };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(observed).toBeGreaterThanOrEqual(3);
  expect(await readFile(f.path, 'utf8')).toBe('synthetic retained plaintext');
  expect(await readFile(join(f.root, 'retained-original'), 'utf8')).toBe('synthetic retained plaintext');
});

it('a replaced operations parent cannot redirect a selected private cleanup', async context => {
  const f = await fixture(context); let observed = 0;
  boundary.afterStat = async path => {
    if (path !== f.path || ++observed !== 3) return;
    await rename(f.operationsRoot, join(f.root, 'retained-operations'));
    await mkdir(f.quarantineRoot, { recursive: true, mode: 0o700 });
    await writeFile(f.path, 'not the selected file', { flag: 'wx', mode: 0o600 });
  };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(await readFile(f.path, 'utf8')).toBe('not the selected file');
  const retained = join(f.root, 'retained-operations', 'workspace-import-plaintext-quarantine', basename(f.path));
  expect(await readFile(retained, 'utf8')).toBe('synthetic retained plaintext');
});

it('uses captured authority methods rather than replacements supplied after an await', async context => {
  const f = await fixture(context);
  const authority = { ...f.authority, async assertCurrent() {
    authority.assertMutationCurrent = () => { throw new Error('REPLACED_CALLBACK'); };
    await f.authority.assertCurrent();
  } };
  await f.quarantine.recoverStalePayloads(authority);
  expect(await readdir(f.quarantineRoot)).toEqual([]);
});

it('rejects an asynchronous mutation guard before preparing private directories', async context => {
  const f = await fixture(context, false);
  await expect(f.quarantine.recoverStalePayloads({ ...f.authority, assertMutationCurrent: async () => {} })).rejects.toThrow();
  expect(await readdir(f.root)).toEqual([]);
});

it('checks synchronous authority immediately before the actual unlink', async context => {
  const f = await fixture(context); let observed = 0;
  boundary.afterStat = async path => {
    if (path === f.path) observed++;
    if (observed >= 2 && path === f.quarantineRoot) f.state.current = false;
  };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(await readFile(f.path, 'utf8')).toBe('synthetic retained plaintext');
});

it('rechecks the selected payload after the final asynchronous root and authority checks', async context => {
  const f = await fixture(context); let observed = 0, replaced = false;
  boundary.afterStat = async path => {
    if (path === f.path) observed++;
    if (!replaced && observed >= 2 && path === f.quarantineRoot) {
      replaced = true;
      await rename(f.path, join(f.root, 'retained-before-final-check'));
      await writeFile(f.path, 'different file at the same approved path', { flag: 'wx', mode: 0o600 });
    }
  };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(await readFile(f.path, 'utf8')).toBe('different file at the same approved path');
  expect(await readFile(join(f.root, 'retained-before-final-check'), 'utf8')).toBe('synthetic retained plaintext');
});

it('refuses removal when ownership expires during the final payload lstat', async context => {
  const f = await fixture(context); let observed = 0;
  boundary.afterStat = async path => { if (path === f.path && ++observed === 4) f.state.current = false; };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(observed).toBe(4);
  expect(await readFile(f.path, 'utf8')).toBe('synthetic retained plaintext');
});

it('stops directory preparation after losing ownership during mkdir', async context => {
  const f = await fixture(context, false); let reached = false;
  boundary.afterMutation = async (kind, path) => {
    if (kind === 'mkdir' && path === f.operationsRoot) { reached = true; f.state.current = false; }
  };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(reached).toBe(true); expect(await readdir(f.root)).toEqual(['workspace-operations']);
  expect(await readdir(f.operationsRoot)).toEqual([]);
});

it.skipIf(process.platform === 'win32')('stops directory preparation after losing ownership during POSIX chmod', async context => {
  const f = await fixture(context, false); let reached = false;
  boundary.afterMutation = async (kind, path) => {
    if (kind === 'chmod' && path === f.operationsRoot) { reached = true; f.state.current = false; }
  };
  await expect(f.quarantine.recoverStalePayloads(f.authority)).rejects.toThrow();
  expect(reached).toBe(true); expect(await readdir(f.operationsRoot)).toEqual([]);
});
