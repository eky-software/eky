import { createHash, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, type TestContext } from 'vitest';

import {
  writeBackupContainer,
  type BackupContainerSourceEntry,
} from '../container/backupContainerWriter.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { ProfileRestoreStagingService } from './profileRestoreStagingService.js';

const password = 'Eky restore staging password 2026!';
const migrationChainIdentity = 'b'.repeat(64);
const profileId = 'a'.repeat(64);

describe('profile restore staging service', () => {
  it('RESTORE-STAGE-001 @critical creates a pre-restore point and retains a validated same-profile staging tree', withOwnedRoots(async (roots) => {
    const fixture = await createFixture(roots);
    const inspection = await fixture.service.inspect({
      containerPath: fixture.containerPath,
      password,
    });
    fixture.events.length = 0;

    const prepared = await fixture.service.stage({
      inspectionId: inspection.inspectionId,
      password,
    });

    expect(prepared).toMatchObject({
      operationId: fixture.operationIds[2],
      targetDisposition: 'replaceActiveProfile',
    });
    expect(fixture.events).toEqual(['preRestore', 'validate']);
    expect(fixture.operationalEvents).toEqual([
      expect.objectContaining({
        eventName: 'restore.inspectionCompleted',
        stage: 'inspection',
      }),
      expect.objectContaining({
        eventName: 'restore.stagingCompleted',
        stage: 'staging',
      }),
    ]);
    await expect(
      fileSystem.readFile(
        join(
          fixture.stagingRoot,
          prepared.operationId,
          'profile.sqlite',
        ),
        'utf8',
      ),
    ).resolves.toBe('synthetic sqlite');
    expect(
      (
        await fileSystem.readdir(
          join(fixture.stagingRoot, prepared.operationId),
          { recursive: true },
        )
      ).some((name) => name.endsWith('.next')),
    ).toBe(false);
    await expect(
      fileSystem.readFile(fixture.activeSentinelPath, 'utf8'),
    ).resolves.toBe('active profile remains untouched');
  }));

  it('allows a foreign profile only when the active installation is demonstrably empty', withOwnedRoots(async (roots) => {
    const fixture = await createFixture(roots, {
      activeProfileIsEmpty: true,
      profileMatchesActive: false,
    });
    const inspection = await fixture.service.inspect({
      containerPath: fixture.containerPath,
      password,
    });

    await expect(
      fixture.service.stage({
        inspectionId: inspection.inspectionId,
        password,
      }),
    ).resolves.toMatchObject({
      targetDisposition: 'replaceEmptyProfile',
    });
  }));

  it('RESTORE-CROSS-COMPANY-001 @security rejects a foreign profile over a non-empty installation and removes staging', withOwnedRoots(async (roots) => {
    const fixture = await createFixture(roots, {
      activeProfileIsEmpty: false,
      profileMatchesActive: false,
    });
    const inspection = await fixture.service.inspect({
      containerPath: fixture.containerPath,
      password,
    });

    await expect(
      fixture.service.stage({
        inspectionId: inspection.inspectionId,
        password,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_TARGET_NOT_EMPTY',
    });
    await expect(
      fileSystem.readdir(fixture.stagingRoot),
    ).resolves.toEqual([]);
    expect(fixture.operationalEvents.at(-1)).toEqual(
      expect.objectContaining({
        errorCode: 'PROFILE_RESTORE_TARGET_NOT_EMPTY',
        eventName: 'restore.stagingFailed',
      }),
    );
  }));

  it('rejects a different valid container selected after inspection', withOwnedRoots(async (roots) => {
    const fixture = await createFixture(roots);
    const inspection = await fixture.service.inspect({
      containerPath: fixture.containerPath,
      password,
    });
    await fileSystem.rm(fixture.containerPath);
    await writeFixture(fixture, 1_775_347_200_000n);

    await expect(
      fixture.service.stage({
        inspectionId: inspection.inspectionId,
        password,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_SOURCE_CHANGED',
    });
    await expect(
      fileSystem.readdir(fixture.stagingRoot),
    ).resolves.toEqual([]);
  }));

  it('does not stage when the required pre-restore point fails', withOwnedRoots(async (roots) => {
    const fixture = await createFixture(roots, {
      preRestoreError: new Error('safeStorage unavailable'),
    });
    const inspection = await fixture.service.inspect({
      containerPath: fixture.containerPath,
      password,
    });
    fixture.events.length = 0;

    await expect(
      fixture.service.stage({
        inspectionId: inspection.inspectionId,
        password,
      }),
    ).rejects.toThrow('safeStorage unavailable');
    expect(fixture.events).toEqual(['preRestore']);
    await expect(
      fileSystem.readdir(fixture.stagingRoot),
    ).resolves.toEqual([]);
  }));

  it('expires and consumes inspection identifiers', withOwnedRoots(async (roots) => {
    const fixture = await createFixture(roots);
    const inspection = await fixture.service.inspect({
      containerPath: fixture.containerPath,
      password,
    });
    fixture.now.setTime(fixture.now.getTime() + 10 * 60_000 + 1);

    await expect(
      fixture.service.stage({
        inspectionId: inspection.inspectionId,
        password,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_INSPECTION_EXPIRED',
    });
    await expect(
      fixture.service.stage({
        inspectionId: inspection.inspectionId,
        password,
      }),
    ).rejects.toMatchObject({
      code: 'PROFILE_RESTORE_INSPECTION_EXPIRED',
    });
  }));
});

describe('restore staging test root ownership', () => {
  it('removes only the settled successful test roots', withOwnedRoots(async (roots, context) => {
    const parent = await createCleanupProbeRoot(roots);
    const root = join(parent, 'successful');
    const completion = captureCompletion(context);
    await withOwnedRoots(async (ownedRoots) => {
      ownedRoots.push(root);
      await fileSystem.mkdir(root);
    })(completion.context);

    await expect(fileSystem.stat(root)).resolves.toBeDefined();
    await completion.finish('pass');
    await expect(fileSystem.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  }));

  it.for([false, true])('retains pending and late-created roots independently of the next test (late rejection: %s)', (lateRejection, context) => withOwnedRoots(async (roots) => {
    const parent = await createCleanupProbeRoot(roots);
    const firstRoot = join(parent, 'first');
    const lateRoot = join(parent, 'late');
    const secondRoot = join(parent, 'second');
    let markEntered!: () => void;
    let releaseBody!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const released = new Promise<void>((resolve) => { releaseBody = resolve; });
    const first = captureCompletion(context);
    const second = captureCompletion(context);
    const originalConsoleError = console.error;
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lateFailure = new Error('synthetic late staging failure');
    const pending = withOwnedRoots(async (ownedRoots) => {
      ownedRoots.push(firstRoot);
      await fileSystem.mkdir(firstRoot);
      markEntered();
      await released;
      ownedRoots.push(lateRoot);
      await fileSystem.mkdir(lateRoot);
      if (lateRejection) throw lateFailure;
    })(first.context);
    // Observe late rejection immediately; the probe must not leak a rejection
    // or skip restoring its console spy while settling its simulated timeout.
    const outcome = pending.then(() => undefined, (error: unknown) => error);
    try {
      await Promise.race([entered, outcome]);
      // Even a premature pass notification cannot delete a running body.
      await first.finish('pass');
      first.abort();
      await first.finish('fail');
      await expect(fileSystem.stat(firstRoot)).resolves.toBeDefined();

      await withOwnedRoots(async (ownedRoots) => {
        ownedRoots.push(secondRoot);
        await fileSystem.mkdir(secondRoot);
      })(second.context);
      releaseBody();
      expect(await outcome).toBe(lateRejection ? lateFailure : undefined);
      await second.finish('pass');
      await first.finish('fail');

      await expect(fileSystem.stat(secondRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fileSystem.stat(firstRoot)).resolves.toBeDefined();
      await expect(fileSystem.stat(lateRoot)).resolves.toBeDefined();
      expect(diagnostic.mock.calls).toEqual([
        [JSON.stringify({ diagnostic: 'restoreStagingTest', bodySettled: false, rootsRetained: true })],
        [JSON.stringify({ diagnostic: 'restoreStagingTest', bodySettled: false, rootsRetained: true })],
        [JSON.stringify({ diagnostic: 'restoreStagingTest', bodySettled: true, rootsRetained: true })],
      ]);
    } finally {
      releaseBody();
      try {
        await outcome;
      } finally {
        diagnostic.mockRestore();
      }
    }
    expect(console.error).toBe(originalConsoleError);
  })(context));

  it('preserves the original failure without attempting destructive cleanup', withOwnedRoots(async (roots, context) => {
    const parent = await createCleanupProbeRoot(roots);
    const root = join(parent, 'failed');
    const original = new Error('synthetic staging failure');
    const completion = captureCompletion(context);
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(withOwnedRoots(async (ownedRoots) => {
        ownedRoots.push(root);
        await fileSystem.mkdir(root);
        throw original;
      })(completion.context)).rejects.toBe(original);
      await expect(completion.finish('fail')).resolves.toBeUndefined();
      await expect(completion.finish('pass')).resolves.toBeUndefined();
      await expect(fileSystem.stat(root)).resolves.toBeDefined();
    } finally {
      diagnostic.mockRestore();
    }
  }));

  it('does not treat an aborted successful body as safe to delete', withOwnedRoots(async (roots, context) => {
    const parent = await createCleanupProbeRoot(roots);
    const root = join(parent, 'aborted');
    const completion = captureCompletion(context);
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withOwnedRoots(async (ownedRoots) => {
        ownedRoots.push(root);
        await fileSystem.mkdir(root);
      })(completion.context);
      completion.abort();
      await completion.finish('pass');
      await expect(fileSystem.stat(root)).resolves.toBeDefined();
    } finally {
      diagnostic.mockRestore();
    }
  }));

  it('reports cleanup failure after attempting every owned root', withOwnedRoots(async (roots, context) => {
    const parent = await createCleanupProbeRoot(roots);
    const retainedRoot = join(parent, 'retained');
    const removedRoot = join(parent, 'removed');
    const completion = captureCompletion(context);
    await withOwnedRoots(async (ownedRoots) => {
      ownedRoots.push(retainedRoot, removedRoot);
      await fileSystem.mkdir(retainedRoot);
      await fileSystem.mkdir(removedRoot);
    })(completion.context);
    const failure = new Error('synthetic cleanup failure');
    const remove = fileSystem.rm;
    const cleanup = vi.spyOn(fileSystem, 'rm').mockImplementation(async (path, options) => {
      if (path === retainedRoot) throw failure;
      await remove(path, options);
    });
    try {
      await expect(completion.finish('pass')).rejects.toMatchObject({ errors: [failure] });
      expect(cleanup).toHaveBeenCalledTimes(2);
      await expect(fileSystem.stat(retainedRoot)).resolves.toBeDefined();
      await expect(fileSystem.stat(removedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      cleanup.mockRestore();
    }
  }));
});

function withOwnedRoots(body: (roots: string[], context: TestContext) => Promise<void>) {
  return async (context: TestContext): Promise<void> => {
    const roots: string[] = [];
    let bodySettled = false;
    let bodySucceeded = false;
    context.onTestFinished(async ({ task }) => {
      // A timeout does not settle the body. Keep its roots out of subsequent
      // test cleanup, including roots registered by a late continuation.
      if (task.result?.state !== 'pass' || !bodySettled || !bodySucceeded || context.signal.aborted) {
        console.error(JSON.stringify({ diagnostic: 'restoreStagingTest', bodySettled, rootsRetained: true }));
        return;
      }
      const results = await Promise.allSettled(roots.map((root) =>
        fileSystem.rm(root, { force: true, recursive: true }),
      ));
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        throw new AggregateError(failures.map((result) => result.reason), 'Restore staging test cleanup failed');
      }
    });
    try {
      context.signal.throwIfAborted();
      await body(roots, context);
      bodySucceeded = true;
    } finally {
      bodySettled = true;
    }
  };
}

function captureCompletion(context: TestContext) {
  let finish: Parameters<TestContext['onTestFinished']>[0] | undefined;
  const controller = new AbortController();
  return {
    context: {
      ...context,
      signal: controller.signal,
      onTestFinished(callback: Parameters<TestContext['onTestFinished']>[0]) {
        finish = callback;
      },
    },
    abort: () => controller.abort(),
    async finish(state: 'pass' | 'fail') {
      if (!finish) throw new Error('Completion hook was not registered');
      await finish({ ...context, task: { ...context.task, result: { state } } });
    },
  };
}

async function createCleanupProbeRoot(roots: string[]): Promise<string> {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-restore-cleanup-'));
  roots.push(root);
  return root;
}

interface Fixture {
  activeSentinelPath: string;
  containerPath: string;
  events: string[];
  now: Date;
  operationIds: string[];
  operationalEvents: ProfileRecoveryOperationalEvent[];
  service: ProfileRestoreStagingService;
  sourceEntries: BackupContainerSourceEntry[];
  stagingRoot: string;
}

async function createFixture(
  ownedRoots: string[],
  options: {
    activeProfileIsEmpty?: boolean;
    preRestoreError?: Error;
    profileMatchesActive?: boolean;
  } = {},
): Promise<Fixture> {
  const root = await fileSystem.mkdtemp(
    join(tmpdir(), 'eky-restore-staging-'),
  );
  ownedRoots.push(root);
  const sourceRoot = join(root, 'source');
  const quarantineRoot = join(root, 'quarantine');
  const stagingRoot = join(root, 'staging');
  const activeRoot = join(root, 'active');
  await Promise.all(
    [sourceRoot, quarantineRoot, stagingRoot, activeRoot].map((path) =>
      fileSystem.mkdir(path, { mode: 0o700 }),
    ),
  );
  const databasePath = join(sourceRoot, 'profile.sqlite');
  const catalogPath = join(sourceRoot, 'snapshot-catalog-v1.json');
  const pdfPath = join(sourceRoot, 'invoice.pdf');
  await fileSystem.writeFile(databasePath, 'synthetic sqlite');
  await fileSystem.writeFile(
    catalogPath,
    '{"artifacts":[],"formatVersion":1}\n',
  );
  await fileSystem.writeFile(
    pdfPath,
    '%PDF-1.7\nsynthetic invoice\n%%EOF',
  );
  const activeSentinelPath = join(activeRoot, 'sentinel.txt');
  await fileSystem.writeFile(
    activeSentinelPath,
    'active profile remains untouched',
  );
  const sourceEntries = [
    await createEntry(databasePath, 'profile.sqlite', 'database'),
    await createEntry(
      catalogPath,
      'snapshot-catalog-v1.json',
      'artifactCatalog',
    ),
    await createEntry(
      pdfPath,
      `artifacts/invoicing/invoice-documents/${'c'.repeat(64)}.pdf`,
      'businessArtifact',
    ),
  ];
  const operationIds = [randomUUID(), randomUUID(), randomUUID()];
  const events: string[] = [];
  const operationalEvents: ProfileRecoveryOperationalEvent[] = [];
  const now = new Date('2026-08-04T12:00:00.000Z');
  const containerPath = join(root, 'backup.ekybackup');
  const fixtureBase = {
    activeSentinelPath,
    containerPath,
    events,
    now,
    operationIds,
    operationalEvents,
    sourceEntries,
    stagingRoot,
  };
  await writeFixture(fixtureBase);
  let operationIndex = 0;
  const validateProfileSnapshot = vi.fn(async () => {
    events.push('validate');
    return {
      activeProfileIsEmpty: options.activeProfileIsEmpty ?? false,
      artifactCount: 1,
      artifactTotalByteSize: 30,
      databaseHealth: 'healthy' as const,
      migrationChainIdentity,
      profileId,
      profileMatchesActive: options.profileMatchesActive ?? true,
      type: 'profileSnapshotValidation' as const,
    };
  });

  return {
    ...fixtureBase,
    service: new ProfileRestoreStagingService({
      now: () => now,
      observer: { observe: (event) => operationalEvents.push(event) },
      operationIdFactory: () => operationIds[operationIndex++]!,
      profileSnapshotClient: { validateProfileSnapshot },
      quarantineRoot,
      recoveryPointService: {
        async createPreRestore() {
          events.push('preRestore');
          if (options.preRestoreError !== undefined) {
            throw options.preRestoreError;
          }
          return {} as never;
        },
      },
      stagingRoot,
    }),
  };
}

async function writeFixture(
  fixture: Pick<Fixture, 'containerPath' | 'sourceEntries'>,
  createdAtEpochMilliseconds = 1_775_260_800_000n,
): Promise<void> {
  await writeBackupContainer({
    destinationPath: fixture.containerPath,
    entries: fixture.sourceEntries,
    manifest: {
      appVersion: '0.1.0-alpha.1',
      createdAtEpochMilliseconds,
      migrationChainIdentity,
      profileId,
    },
    password,
  });
}

async function createEntry(
  sourcePath: string,
  logicalPath: string,
  type: BackupContainerSourceEntry['type'],
): Promise<BackupContainerSourceEntry> {
  const content = await fileSystem.readFile(sourcePath);
  return {
    contentLength: BigInt(content.byteLength),
    logicalPath,
    sha256: createHash('sha256').update(content).digest('hex'),
    sourcePath,
    type,
  };
}
