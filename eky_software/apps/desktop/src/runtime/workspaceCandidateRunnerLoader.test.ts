import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceCandidatePrepareCommand,
  createWorkspaceCandidateShutdownCommand,
  createWorkspaceCandidateStartCommand,
  parseWorkspaceCandidateProcessStatus,
  workspaceCandidateStartupTimeoutMilliseconds,
  type WorkspaceCandidateProcessOperation,
} from './workspaceCandidateMessages.js';
import {
  loadBackendWorkspaceCandidateOperation,
  startWorkspaceCandidateRunner,
} from './workspaceCandidateRunner.js';

const pathChecks = vi.hoisted(() => ({ realpath: vi.fn<(path: string) => Promise<string>>() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  realpath: pathChecks.realpath,
}));

const request = {
  operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  runtimeSession: 'a'.repeat(43),
};

describe('candidate runner production module loader', () => {
  let root: string;
  let moduleRoot: string;
  let operation: WorkspaceCandidateProcessOperation;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eky-candidate-loader-'));
    moduleRoot = join(root, 'backend', 'dist', 'runtime', 'workspaceCandidate');
    const migrationsDirectory = join(root, 'backend', 'dist', 'database', 'migrations');
    await mkdir(moduleRoot, { recursive: true });
    await mkdir(migrationsDirectory, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(moduleRoot, 'runWorkspaceCandidateOperation.js'), [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(new URL('./evaluated.txt', import.meta.url), 'evaluated');",
      'export async function runWorkspaceCandidateOperation() {',
      `  return { kind: 'migration', migrationChainIdentity: '${'d'.repeat(64)}', profileId: '${'c'.repeat(64)}' };`,
      '}',
    ].join('\n'));
    operation = {
      appVersion: '0.2.6',
      artifactRoot: join(root, 'candidate', 'artifacts'),
      backendRoot: join(root, 'backend'),
      buildRevision: 'development',
      candidateRoot: join(root, 'candidate'),
      databaseFilePath: join(root, 'candidate', 'profile.sqlite'),
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    };
    pathChecks.realpath.mockReset().mockImplementation(async (path) => path);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true });
  });

  it.each(['shutdown', 'reservationLost', 'startupDeadline'] as const)(
    'does not evaluate the module after %s during a path check', async (cause) => {
      vi.useFakeTimers();
      let finishPathCheck!: (path: string) => void;
      pathChecks.realpath.mockImplementationOnce(() => new Promise<string>((resolvePath) => {
        finishPathCheck = resolvePath;
      }));
      const invalidation = new AbortController();
      const exit = vi.fn();
      let message!: (event: { data: unknown }) => void;
      const posted: unknown[] = [];
      const prepare = createWorkspaceCandidatePrepareCommand({
        ...request,
        reservation: {
          generationId: request.requestId, identity: 'e'.repeat(64), userDataRoot: resolve(root),
        },
      });
      startWorkspaceCandidateRunner({
        acquireReservation: async () => ({
          identity: prepare.reservation.identity,
          invalidated: invalidation.signal,
          assertOwned: async () => {},
          release: async () => { throw new Error('must retain until exit'); },
        }),
        exit,
        loadOperation: loadBackendWorkspaceCandidateOperation,
        parentPort: {
          on: (_event, listener) => { message = listener; },
          postMessage: (value) => { posted.push(value); },
        },
      });
      message({ data: prepare });
      await vi.advanceTimersByTimeAsync(0);
      message({ data: createWorkspaceCandidateStartCommand({ ...request, operation }) });
      await vi.advanceTimersByTimeAsync(0);
      expect(pathChecks.realpath).toHaveBeenCalledTimes(1);
      if (cause === 'shutdown') {
        message({ data: createWorkspaceCandidateShutdownCommand(request) });
      } else if (cause === 'reservationLost') {
        invalidation.abort();
      } else {
        await vi.advanceTimersByTimeAsync(workspaceCandidateStartupTimeoutMilliseconds);
      }
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(vi.getTimerCount()).toBe(0);
      finishPathCheck(operation.backendRoot);
      await vi.advanceTimersByTimeAsync(0);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(posted.map((value) => parseWorkspaceCandidateProcessStatus(value)?.type))
        .toEqual(['ready', 'reservationReady', 'failed']);
      await expect(readFile(join(moduleRoot, 'evaluated.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('evaluates the real module only after the synchronous load gate succeeds', async () => {
    const beginLoad = vi.fn();
    const run = await loadBackendWorkspaceCandidateOperation(operation, { beginLoad });
    expect(beginLoad).toHaveBeenCalledTimes(1);
    expect(pathChecks.realpath).toHaveBeenCalledTimes(3);
    expect(await readFile(join(moduleRoot, 'evaluated.txt'), 'utf8')).toBe('evaluated');
    const { backendRoot: _backendRoot, ...input } = operation;
    expect(await run(input, { signal: new AbortController().signal })).toMatchObject({ kind: 'migration' });
  });
});
