import { fork } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId } from './workspaceDeletionDataTestSupport.js';

export type DeletionProcessCut = 'authorized' | 'payloadAbsent' | 'registryPublished' | 'originalFailure';
type ChildMessage = { event: 'cut' | 'completed' | 'failed'; pid: number; cut?: DeletionProcessCut;
  receiptCount?: number; completion?: { formatVersion: 1; status: 'completed'; navigation: 'selector' | 'reopenPrevious' } };
const maximumOutputBytes = 64 * 1024;

export async function assertDeletionReservationBusy(acquire: () => Promise<{ release(): Promise<void> }>) {
  const probe = async () => {
    const owner = await acquire();
    try { return owner; }
    finally { await owner.release(); }
  };
  await expect(probe()).rejects.toMatchObject({ reason: 'busy' });
}

function startChild(test: TestContext, config: Record<string, unknown>) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(fileURLToPath(new URL('../../../scripts/workspaceDeletionProcess.fixture.mjs', import.meta.url)), [], {
    env, execArgv: ['--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages: ChildMessage[] = [], waiters = new Set<() => void>();
  let closed = false, first: unknown;
  let stdout: Buffer = Buffer.alloc(0), stderr: Buffer = Buffer.alloc(0);
  const fail = (error: unknown) => { first ??= error; for (const wake of waiters) wake(); };
  const collect = (source: Buffer, chunk: Buffer) => {
    if (source.length + chunk.length > maximumOutputBytes) {
      fail(new Error('DELETION_PROCESS_OUTPUT_LIMIT'));
      return source;
    }
    return Buffer.concat([source, chunk]);
  };
  child.stdout!.on('data', (chunk: Buffer) => { stdout = collect(stdout, chunk); });
  child.stderr!.on('data', (chunk: Buffer) => { stderr = collect(stderr, chunk); });
  child.on('error', fail);
  child.on('message', (value: unknown) => {
    const message = value as ChildMessage;
    if (message === null || typeof message !== 'object' || message.pid !== child.pid ||
      !['cut', 'completed', 'failed'].includes(message.event) || messages.length >= 4) {
      fail(new Error('DELETION_PROCESS_MESSAGE_INVALID')); return;
    }
    messages.push(message);
    for (const wake of waiters) wake();
  });
  const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); for (const wake of waiters) wake(); });
  });
  const cancel = () => {
    fail(test.signal.reason ?? new Error('DELETION_PROCESS_TEST_ENDED'));
    if (child.connected) child.disconnect();
    if (!closed) child.kill('SIGKILL');
  };
  test.signal.addEventListener('abort', cancel, { once: true });
  child.send(config, error => { if (error) fail(error); });
  return {
    pid: child.pid,
    async message(event: ChildMessage['event']) {
      while (true) {
        test.signal.throwIfAborted();
        if (first !== undefined) throw first;
        const found = messages.find(message => message.event === event);
        if (found) return found;
        if (closed || messages.some(message => message.event === 'failed')) throw new Error('DELETION_PROCESS_PHASE_NOT_REACHED');
        await new Promise<void>(resolve => { const wake = () => { waiters.delete(wake); resolve(); }; waiters.add(wake); });
      }
    },
    async killAndJoin() {
      expect(closed).toBe(false);
      expect(child.kill('SIGKILL')).toBe(true);
      const result = await close;
      expect(result.code === 0).toBe(false);
      if (first !== undefined) throw first;
      expect(stdout.length === 0 && stderr.length === 0).toBe(true);
    },
    async successfulExit() {
      const result = await close;
      if (first !== undefined) throw first;
      expect(result).toEqual({ code: 0, signal: null });
      expect(stdout.length === 0 && stderr.length === 0).toBe(true);
    },
    async finish() {
      test.signal.removeEventListener('abort', cancel);
      if (!closed) { if (child.connected) child.disconnect(); child.kill('SIGKILL'); }
      await close;
      return { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), closed };
    },
  };
}

export async function deletionProcessFixture(test: TestContext, lastWorkspace = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eky-delete-process-')));
  await chmod(directory, 0o700);
  const root = join(directory, 'installation');
  await mkdir(root, { mode: 0o700 });
  const children: ReturnType<typeof startChild>[] = [];
  test.onTestFinished(async () => {
    const results = await Promise.allSettled(children.map(child => child.finish()));
    const cleanupErrors = results.filter(result => result.status === 'rejected');
    await writeFile(join(directory, 'children.private.json'), JSON.stringify(results), { flag: 'wx', mode: 0o600 });
    expect(cleanupErrors.length).toBe(0);
    if (test.task.result?.state === 'pass') await rm(directory, { recursive: true, force: true });
  });
  const initial = { ...createSwitchRegistry(lastWorkspace ? TEST_TARGET_WORKSPACE_ID : TEST_SOURCE_WORKSPACE_ID),
    formatVersion: 2 as const, ...(lastWorkspace ? { workspaces: [createSwitchRegistry().workspaces[1]!] } : {}) };
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  await registry.write(initial);
  const target = deriveWorkspaceRoot(root, TEST_TARGET_WORKSPACE_ID, 1);
  const targetProfile = createDesktopProfilePaths(target.workspaceRoot);
  const snapshots = createProfileSnapshotRuntimePaths(targetProfile.runtimeRoot);
  const targetFiles = [targetProfile.databaseFilePath, join(targetProfile.invoiceDocumentStorageRoot, 'synthetic.pdf'),
    join(targetProfile.runtimeRoot, 'activity', 'synthetic.json'), join(snapshots.recoveryPointsRoot, 'synthetic', 'snapshot'),
    ...['', '.backup', '.next'].map(slot => join(targetProfile.runtimeRoot, 'secrets', `company-email-smtp-v1.dat${slot}`))];
  for (const path of targetFiles) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, 'synthetic-not-a-database', { flag: 'wx', mode: 0o600 }); }
  const other = deriveWorkspaceRoot(root, TEST_SOURCE_WORKSPACE_ID, 1);
  const retained = [join(directory, 'external-backup.eky'), join(directory, 'external.pdf'), join(root, 'installation-sentinel')];
  if (!lastWorkspace) retained.push(join(other.workspaceRoot, 'runtime', 'data', 'eky.sqlite'), join(other.workspaceRoot, 'runtime', 'secrets', 'company-email-smtp-v1.dat'));
  for (const path of retained) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, 'retained-independent-bytes', { flag: 'wx', mode: 0o600 }); }
  const registryBytes = await readFile(registryPath);
  const targetRootIdentity = await readWorkspaceProcessReservationIdentity(target.workspaceRoot);
  const targetParentIdentity = await readWorkspaceProcessReservationIdentity(target.workspacesRoot);
  const operationId = deletionTestId(401);
  return { root, registry, registryPath, registryBytes, operationId, target, targetFiles, retained, targetRootIdentity, targetParentIdentity,
    start(mode: 'publish' | 'resume', cut: DeletionProcessCut | null) {
      const child = startChild(test, { root, operationId, workspaceId: TEST_TARGET_WORKSPACE_ID,
        label: initial.workspaces.at(-1)!.workspaceLabel, mode, cut, testId: test.task.id });
      children.push(child); return child;
    },
    async assertRetained() { for (const path of retained) expect(await readFile(path, 'utf8')).toBe('retained-independent-bytes'); },
  };
}
