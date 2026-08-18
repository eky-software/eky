import { mkdir, readdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { inspectSqliteProfileDatabase } from '../../../backend/src/runtime/profileSnapshot/inspectSqliteProfileDatabase.js';
import { EmptyWorkspaceCreationCoordinator } from '../../../desktop/src/workspaces/creation/emptyWorkspaceCreationCoordinator.js';
import type {
  EmptyWorkspaceBootstrapResult,
} from '../../../desktop/src/workspaces/creation/emptyWorkspaceCreationPorts.js';
import { validateWorkspaceCreationOperationId } from '../../../desktop/src/workspaces/creation/workspaceCreationOperationId.js';
import { deriveWorkspaceCreationPaths } from '../../../desktop/src/workspaces/creation/workspaceCreationPaths.js';
import { WorkspaceCreationJournalStore } from '../../../desktop/src/workspaces/creation/workspaceCreationJournalStore.js';
import { WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../../../desktop/src/workspaces/creation/workspaceCreationJournalPaths.js';
import {
  PrivateEmptyWorkspaceBootstrapAdapter,
  type PrivateEmptyWorkspaceBootstrapRuntime,
} from '../../../desktop/src/workspaces/creation/privateEmptyWorkspaceBootstrapAdapter.js';
import { NodeWorkspaceCreationRootStore } from '../../../desktop/src/workspaces/creation/workspaceCreationRootStore.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../../desktop/src/workspaces/maintenance/workspaceMaintenanceLease.js';
import { validateWorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../../../desktop/src/workspaces/registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceLifecyclePort } from '../../../desktop/src/workspaces/runtime/activeWorkspaceLifecyclePort.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../../../desktop/src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../../../desktop/src/workspaces/registry/workspaceRegistryStore.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../../src/environment/e2eEnvironmentTypes.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import {
  startE2eBackendProcess,
  type StartedE2eBackend,
} from '../../src/environment/startE2eBackendProcess.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';

const operationId = validateWorkspaceCreationOperationId(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
const workspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const migrationsDirectory = resolve(
  import.meta.dirname,
  '../../../backend/src/database/migrations',
);

test('WORKSPACE-CREATE-001 @critical @security creates an isolated ready workspace through the real backend', async () => {
  const runRoot = createE2eRunRoot();
  const userDataRoot = join(runRoot, 'user-data');
  const lifecycleEvents: string[] = [];
  const startedBackends: StartedE2eBackend[] = [];
  const usedPorts: number[] = [];

  await mkdir(userDataRoot, { mode: 0o700 });
  const registry = new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  });
  const creationJournal = new WorkspaceCreationJournalStore({
    filePath: join(userDataRoot, WORKSPACE_CREATION_JOURNAL_FILE_NAME),
    installationRoot: userDataRoot,
  });
  const rootStore = new NodeWorkspaceCreationRootStore();
  const lifecycle = createRecordingLifecycle(lifecycleEvents);
  const bootstrap = new PrivateEmptyWorkspaceBootstrapAdapter({
    start: async (input) => {
      lifecycleEvents.push('bootstrap.start');
      const workerPaths = createE2eWorkerPaths(
        runRoot,
        'WORKSPACE-CREATE-BOOTSTRAP',
      );
      const paths: E2eWorkerPaths = {
        ...workerPaths,
        databaseFilePath: input.databaseFilePath,
        documentsRoot: input.artifactRoot,
        workerRoot: runRoot,
      };
      const backendPort = await reserveLoopbackPort();
      usedPorts.push(backendPort);
      const backend = await startE2eBackendProcess({
        backendPort,
        paths,
        runRoot,
        scenarioId: 'WORKSPACE-CREATE-BOOTSTRAP',
      });
      startedBackends.push(backend);
      return createStoppedBackendInspectionRuntime({
        backend,
        backendPort,
        databaseFilePath: input.databaseFilePath,
        artifactRoot: input.artifactRoot,
        lifecycleEvents,
      });
    },
  });
  const coordinator = new EmptyWorkspaceCreationCoordinator({
    activeWorkspaceLifecycle: lifecycle,
    bootstrap,
    creationJournal,
    generateOperationId: () => operationId,
    generateWorkspaceId: () => workspaceId,
    maintenanceLease: new InMemoryWorkspaceMaintenanceLease(),
    now: () => new Date('2026-08-18T10:00:00.000Z'),
    registry,
    rootStore,
    userDataRoot,
  });

  try {
    await expect(coordinator.create('Tyhja testiyritys')).resolves.toEqual({
      workspaceId,
      workspaceLabel: 'Tyhja testiyritys',
    });

    const paths = deriveWorkspaceCreationPaths(
      userDataRoot,
      operationId,
      workspaceId,
    );
    await expectPathEntries(paths.finalRoot, ['runtime']);
    await expectPathEntries(join(paths.finalRoot, 'runtime'), [
      'data',
      'storage',
    ]);
    await expectPathEntries(join(paths.finalRoot, 'runtime', 'data'), [
      'eky.sqlite',
    ]);
    await expectPathEntries(join(paths.finalRoot, 'runtime', 'storage'), [
      'invoices',
    ]);
    await expectPathEntries(paths.publishedArtifactRoot, []);
    await expect(readdir(paths.operationRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const publishedRegistry = await registry.read();
    expect(publishedRegistry).toMatchObject({
      activeWorkspaceId: workspaceId,
      formatVersion: 1,
      workspaces: [
        {
          lifecycleState: 'ready',
          workspaceId,
          workspaceLabel: 'Tyhja testiyritys',
        },
      ],
    });
    expect(await creationJournal.read()).toBeUndefined();

    const databaseInspection = inspectSqliteProfileDatabase(
      paths.publishedDatabaseFilePath,
      migrationsDirectory,
      'exactCurrentManifest',
    );
    expect(databaseInspection.migrationChainIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(databaseInspection.profileId).toBe(
      publishedRegistry?.workspaces[0]?.lineageIdentity.profileId,
    );
    expect(readIdentity(paths.publishedDatabaseFilePath)).toMatchObject({
      actor_id: 'local-owner',
      company_id: expect.stringMatching(/^local-company-[0-9a-f]{32}$/),
      installation_id: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(lifecycleEvents).toEqual([
      'active.quiesce.empty',
      'active.stop.empty',
      'bootstrap.start',
      'bootstrap.stop',
      'bootstrap.inspect',
      'active.restart.empty',
    ]);
    expect(
      startedBackends.every(
        ({ managedProcess }) =>
          managedProcess.child.exitCode !== null ||
          managedProcess.child.signalCode !== null,
      ),
    ).toBe(true);
    for (const port of usedPorts) {
      await expect(waitForLoopbackPortRelease(port)).resolves.toBeUndefined();
    }
  } finally {
    await Promise.allSettled(startedBackends.map((backend) => backend.stop()));
    await removeE2eRunRoot(runRoot);
  }
});

function createRecordingLifecycle(
  events: string[],
): ActiveWorkspaceLifecyclePort {
  const describe = (value: WorkspaceId | null) => value ?? 'empty';
  return {
    quiesceWrites: async (previousActiveWorkspaceId) => {
      events.push(`active.quiesce.${describe(previousActiveWorkspaceId)}`);
    },
    stopAndProveHandlesClosed: async (previousActiveWorkspaceId) => {
      events.push(`active.stop.${describe(previousActiveWorkspaceId)}`);
      return { handlesClosed: true };
    },
    restartPreviousWorkspace: async (previousActiveWorkspaceId) => {
      events.push(`active.restart.${describe(previousActiveWorkspaceId)}`);
    },
  };
}

function createStoppedBackendInspectionRuntime(input: {
  readonly backend: StartedE2eBackend;
  readonly backendPort: number;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
  readonly lifecycleEvents: string[];
}): PrivateEmptyWorkspaceBootstrapRuntime {
  let stopped = false;
  return {
    stopAndProveHandlesClosed: async () => {
      if (stopped) return true;
      input.lifecycleEvents.push('bootstrap.stop');
      await input.backend.stop();
      await waitForLoopbackPortRelease(input.backendPort);
      const handleProbePath = `${input.databaseFilePath}.handle-probe`;
      await rename(input.databaseFilePath, handleProbePath);
      await rename(handleProbePath, input.databaseFilePath);
      stopped = true;
      return true;
    },
    inspectStoppedReadiness: async () => {
      if (!stopped) throw new Error('BACKEND_HANDLES_NOT_CLOSED');
      input.lifecycleEvents.push('bootstrap.inspect');
      const databaseInspection = inspectSqliteProfileDatabase(
        input.databaseFilePath,
        migrationsDirectory,
        'exactCurrentManifest',
      );
      const identity = readIdentity(input.databaseFilePath);
      if (
        identity.actor_id !== 'local-owner' ||
        typeof identity.company_id !== 'string' ||
        !/^local-company-[0-9a-f]{32}$/.test(identity.company_id) ||
        typeof identity.installation_id !== 'string' ||
        !/^[0-9a-f]{32}$/.test(identity.installation_id) ||
        (await readdir(input.artifactRoot)).length !== 0
      ) {
        throw new Error('EMPTY_WORKSPACE_READINESS_INVALID');
      }
      return Object.freeze({
        actorId: 'local-owner',
        artifactRootHealth: 'ready',
        companyId: identity.company_id,
        databaseHealth: 'healthy',
        foreignKeyHealth: 'healthy',
        handlesClosed: true,
        lineageIdentity: Object.freeze({
          formatVersion: 1,
          profileId: databaseInspection.profileId,
        }),
        migrationChainIdentity: databaseInspection.migrationChainIdentity,
        migrationState: 'current',
      } satisfies EmptyWorkspaceBootstrapResult);
    },
  };
}

function readIdentity(databaseFilePath: string): Record<string, unknown> {
  const rows = readE2eSqliteRows(
    databaseFilePath,
    `
      SELECT actor_id, company_id, installation_id
      FROM local_runtime_identity
      WHERE singleton_key = 'local-runtime'
    `,
  );
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error('EMPTY_WORKSPACE_IDENTITY_MISSING');
  }
  return rows[0];
}

async function expectPathEntries(
  path: string,
  expectedEntries: readonly string[],
): Promise<void> {
  expect((await readdir(path)).sort()).toEqual([...expectedEntries].sort());
}
