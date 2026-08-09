import { createHash, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  writeBackupContainer,
  type BackupContainerSourceEntry,
} from '../container/backupContainerWriter.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { ProfileRestoreStagingService } from './profileRestoreStagingService.js';

const password = 'Eky restore staging password 2026!';
const migrationChainIdentity = 'b'.repeat(64);
const profileId = 'a'.repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fileSystem.rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('profile restore staging service', () => {
  it('RESTORE-STAGE-001 @critical creates a pre-restore point and retains a validated same-profile staging tree', async () => {
    const fixture = await createFixture();
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
  });

  it('allows a foreign profile only when the active installation is demonstrably empty', async () => {
    const fixture = await createFixture({
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
  });

  it('RESTORE-CROSS-COMPANY-001 @security rejects a foreign profile over a non-empty installation and removes staging', async () => {
    const fixture = await createFixture({
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
  });

  it('rejects a different valid container selected after inspection', async () => {
    const fixture = await createFixture();
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
  });

  it('does not stage when the required pre-restore point fails', async () => {
    const fixture = await createFixture({
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
  });

  it('expires and consumes inspection identifiers', async () => {
    const fixture = await createFixture();
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
  });
});

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
  options: {
    activeProfileIsEmpty?: boolean;
    preRestoreError?: Error;
    profileMatchesActive?: boolean;
  } = {},
): Promise<Fixture> {
  const root = await fileSystem.mkdtemp(
    join(tmpdir(), 'eky-restore-staging-'),
  );
  temporaryRoots.push(root);
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
