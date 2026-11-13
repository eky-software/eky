import { fork } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { createLocalUpdateRuntimePaths } from '../../update/localUpdateRuntimePaths.js';
import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { createProfileSnapshotRuntimePaths } from '../../profileBackup/profileSnapshotRuntimePaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { createSwitchRegistry, TEST_SOURCE_WORKSPACE_ID, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId } from './workspaceDeletionDataTestSupport.js';
import type { WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';

export type DeletionProcessCut = 'reservationAcquired' | 'authorized' | 'payloadAbsent' | 'registryPublished' | 'originalFailure' |
  `${'before' | 'after'}:${Exclude<WorkspaceDeletionJournal['phase'], 'authorized'>}`;
type ChildMessage = { event: 'cut' | 'completed' | 'failed'; pid: number; cut?: DeletionProcessCut;
  receiptCount?: number; coldSettled?: boolean;
  completion?: { formatVersion: 1; status: 'completed'; navigation: 'selector' | 'reopenPrevious' } };
const maximumOutputBytes = 64 * 1024;

export async function assertDeletionReservationBusy(acquire: () => Promise<{ release(): Promise<void> }>) {
  const probe = async () => {
    const owner = await acquire();
    try { return owner; }
    finally { await owner.release(); }
  };
  await expect(probe()).rejects.toMatchObject({ reason: 'busy' });
}

export function startDeletionProcessChild(test: TestContext, config: Record<string, unknown>) {
  const context = Object.freeze({
    testId: typeof config.testId === 'string' ? config.testId : null,
    mode: typeof config.mode === 'string' && ['publish', 'resume', 'resumeCold'].includes(config.mode) ? config.mode : null,
    cut: typeof config.cut === 'string' ? config.cut : null,
  });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(fileURLToPath(new URL('../../../scripts/workspaceDeletionProcess.fixture.mjs', import.meta.url)), [], {
    env, execArgv: ['--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages: ChildMessage[] = [], messageEvents: ChildMessage['event'][] = [], waiters = new Set<() => void>();
  let closed = false, terminationRequested = false, first: unknown;
  const waiting = { cut: 0, completed: 0, failed: 0, termination: 0, exit: 0 };
  const observe = () => Object.freeze({ waiting: Object.freeze({ ...waiting }),
    messages: Object.freeze([...messageEvents]), closed, terminationRequested });
  let atAbort: ReturnType<typeof observe> | null = null;
  let closeResult: Readonly<{ code: number | null; signal: NodeJS.Signals | null }> | null = null;
  const wait = async <T>(kind: keyof typeof waiting, work: () => Promise<T>): Promise<T> => {
    waiting[kind]++;
    try { return await work(); }
    finally { waiting[kind]--; }
  };
  let stdout: Buffer = Buffer.alloc(0), stderr: Buffer = Buffer.alloc(0);
  const wakeWaiters = () => { for (const wake of waiters) wake(); };
  const fail = (error: unknown) => { first ??= error; wakeWaiters(); };
  const collect = (source: Buffer, chunk: Buffer) => {
    if (source.length + chunk.length > maximumOutputBytes) {
      fail(new Error('DELETION_PROCESS_OUTPUT_LIMIT'));
      return source;
    }
    return Buffer.concat([source, chunk]);
  };
  child.stdout!.on('data', (chunk: Buffer) => { stdout = collect(stdout, chunk); });
  child.stderr!.on('data', (chunk: Buffer) => { stderr = collect(stderr, chunk); });
  child.stdout!.on('error', fail);
  child.stderr!.on('error', fail);
  child.on('error', fail);
  child.on('message', (value: unknown) => {
    const message = value as ChildMessage;
    if (message === null || typeof message !== 'object' || message.pid !== child.pid ||
      !['cut', 'completed', 'failed'].includes(message.event) || messages.length >= 4) {
      fail(new Error('DELETION_PROCESS_MESSAGE_INVALID')); return;
    }
    messages.push(message);
    messageEvents.push(message.event);
    for (const wake of waiters) wake();
  });
  const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('close', (code, signal) => {
      closed = true; closeResult = Object.freeze({ code, signal });
      resolve(closeResult); for (const wake of waiters) wake();
    });
  });
  const terminate = () => {
    if (closed || terminationRequested) return;
    terminationRequested = true;
    // Keep IPC attached so Node can account for its EOF in the real close event.
    try { return child.kill('SIGKILL'); }
    catch (error) { fail(error); return false; }
  };
  const cancel = () => {
    atAbort ??= observe();
    wakeWaiters();
    terminate();
  };
  test.signal.addEventListener('abort', cancel, { once: true });
  child.send(config, error => { if (error) fail(error); });
  return {
    pid: child.pid,
    readEvidence() { return Object.freeze({ context, atAbort, after: observe(), close: closeResult }); },
    async message(event: ChildMessage['event']) {
      return wait(event, async () => {
        while (true) {
          test.signal.throwIfAborted();
          if (first !== undefined) throw first;
          const found = messages.find(message => message.event === event);
          if (found) return found;
          if (closed || messages.some(message => message.event === 'failed')) throw new Error('DELETION_PROCESS_PHASE_NOT_REACHED');
          await new Promise<void>(resolve => { const wake = () => { waiters.delete(wake); resolve(); }; waiters.add(wake); });
        }
      });
    },
    async killAndJoin() {
      return wait('termination', async () => {
        expect(closed).toBe(false);
        expect(terminate()).toBe(true);
        const result = await close;
        expect(result.code === 0).toBe(false);
        if (first !== undefined) throw first;
        expect(stdout.length === 0 && stderr.length === 0).toBe(true);
      });
    },
    async successfulExit() {
      return wait('exit', async () => {
        const result = await close;
        if (first !== undefined) throw first;
        expect(result).toEqual({ code: 0, signal: null });
        expect(stdout.length === 0 && stderr.length === 0).toBe(true);
      });
    },
    async finish() {
      test.signal.removeEventListener('abort', cancel);
      terminate();
      await close;
      if (first !== undefined) throw first;
      return { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), closed };
    },
  };
}

export async function deletionProcessFixture(test: TestContext, lastWorkspace = false) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eky-delete-process-')));
  await chmod(directory, 0o700);
  const root = join(directory, 'installation');
  await mkdir(root, { mode: 0o700 });
  const children: ReturnType<typeof startDeletionProcessChild>[] = [];
  test.onTestFinished(async () => {
    const results = await Promise.allSettled(children.map(child => child.finish()));
    const cleanupErrors = results.filter(result => result.status === 'rejected');
    await writeFile(join(directory, 'children.private.json'), JSON.stringify(results.map((result, index) => ({
      ...result, observed: children[index]!.readEvidence(),
    }))), { flag: 'wx', mode: 0o600 });
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors.map(result => result.reason),
      'DELETION_PROCESS_CLEANUP_FAILED', { cause: cleanupErrors[0]!.reason });
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
  const time = '2026-10-25T12:00:00.000Z';
  const buildInfo = { schemaVersion: 1, appVersion: '0.2.81', buildRevision: 'a'.repeat(40), buildCreatedAt: time, buildDirty: false };
  const releaseInfo = { schemaVersion: 1, appIdentity: 'Eky', appVersion: '0.2.81', msiProductVersion: '0.2.81',
    buildRevision: 'a'.repeat(40), platform: 'win32', architecture: 'x64', releaseChannel: 'pilot', upgradeCode: deletionTestId(50) };
  const update = createLocalUpdateRuntimePaths({ userDataPath: root, legacyRuntimeRoot: createDesktopProfilePaths(root).runtimeRoot });
  await mkdir(dirname(update.acceptedBuildMetadataPath), { recursive: true, mode: 0o700 });
  await writeFile(update.acceptedBuildMetadataPath, JSON.stringify({ formatVersion: 1, acceptedAt: time,
    appVersion: buildInfo.appVersion, buildRevision: buildInfo.buildRevision, releaseChannel: releaseInfo.releaseChannel }), { flag: 'wx', mode: 0o600 });
  return { root, registry, registryPath, registryBytes, operationId, target, targetFiles, retained, targetRootIdentity, targetParentIdentity,
    start(mode: 'publish' | 'resume' | 'resumeCold', cut: DeletionProcessCut | null) {
      const child = startDeletionProcessChild(test, { root, operationId, workspaceId: TEST_TARGET_WORKSPACE_ID,
        label: initial.workspaces.at(-1)!.workspaceLabel, mode, cut, testId: test.task.id, buildInfo, releaseInfo });
      children.push(child); return child;
    },
    async assertRetained() { for (const path of retained) expect(await readFile(path, 'utf8')).toBe('retained-independent-bytes'); },
  };
}
