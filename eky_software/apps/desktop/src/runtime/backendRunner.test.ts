import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopBackendReadinessTimeoutMilliseconds } from './backendMessages.js';
import { captureOwnedLocalDatabaseRecoverySelection, type OwnedLocalDatabaseRecovery } from './ownedLocalDatabaseRecovery.js';
import { createDesktopProfilePaths } from './desktopProfilePaths.js';

const runtime = vi.hoisted(() => ({
  acquireReservation: vi.fn(),
  assertReservation: vi.fn(),
  archiveClose: vi.fn(),
  assertRestore: vi.fn(),
  assertUpdate: vi.fn(),
  secretClose: vi.fn(),
  secretAssertSettled: vi.fn(),
  secretSealAdmission: vi.fn(),
  secretGet: vi.fn(),
  secretHas: vi.fn(),
  secretSet: vi.fn(),
  secretRemove: vi.fn(),
  serverClose: vi.fn(),
  snapshotClose: vi.fn(),
  snapshotRegistration: vi.fn(),
  releaseReservation: vi.fn(),
  serverImport: vi.fn(),
  startServer: vi.fn(),
}));

vi.mock('./workspaceProcessReservation.js', async importOriginal => ({
  ...await importOriginal<typeof import('./workspaceProcessReservation.js')>(),
  acquireWorkspaceProcessReservation: runtime.acquireReservation,
}));

vi.mock('../secrets/secretBrokerClient.js', () => ({
  CompanyEmailSecretBrokerClient: class {
    close = runtime.secretClose;
    assertSettled = runtime.secretAssertSettled;
    sealAdmission = runtime.secretSealAdmission;
    getSecret = runtime.secretGet;
    hasSecret = runtime.secretHas;
    setSecret = runtime.secretSet;
    removeSecret = runtime.secretRemove;
  },
}));
vi.mock('../secrets/electronSecretBrokerTransport.js', () => ({
  createUtilitySecretBrokerTransport: () => ({}),
}));
vi.mock('../invoicePdfArchive/invoicePdfArchiveBrokerClient.js', () => ({
  InvoicePdfArchiveBrokerClient: class { close = runtime.archiveClose; },
}));
vi.mock('../invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js', () => ({
  createInvoicePdfArchiveBrokerTransport: () => ({}),
}));
vi.mock('../profileBackup/electronProfileSnapshotBrokerTransport.js', () => ({
  createProfileSnapshotBrokerTransport: () => ({}),
}));
vi.mock('../profileBackup/profileSnapshotBrokerBackend.js', () => ({
  startProfileSnapshotBrokerBackend: (input: unknown) => {
    runtime.snapshotRegistration(input);
    return {
      assertRestoreMaintenance: runtime.assertRestore,
      assertUpdateMaintenance: runtime.assertUpdate,
      close: runtime.snapshotClose,
    };
  },
}));

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let fixtureRoot: string | undefined;
let fixtureControlKey: string | undefined;
let stopFixture: (() => Promise<void>) | undefined;
const originalParentPort = Object.getOwnPropertyDescriptor(process, 'parentPort');

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

afterEach(async () => {
  await stopFixture?.();
  stopFixture = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalParentPort !== undefined) {
    Object.defineProperty(process, 'parentPort', originalParentPort);
  } else {
    Reflect.deleteProperty(process, 'parentPort');
  }
  if (fixtureRoot !== undefined) {
    await rm(fixtureRoot, { force: true, recursive: true });
    fixtureRoot = undefined;
  }
  if (fixtureControlKey !== undefined) {
    Reflect.deleteProperty(globalThis, fixtureControlKey);
    fixtureControlKey = undefined;
  }
});

describe('backend runner shutdown command boundary', () => {
  it('connects backend admission sealing to the existing broker without disposing active work', async () => {
    const f = await startFixture();
    const options = runtime.startServer.mock.calls[0]![0] as {
      appOptions: { sealCompanyEmailSecretAdmission(): void };
    };
    options.appOptions.sealCompanyEmailSecretAdmission();
    expect(runtime.secretSealAdmission).toHaveBeenCalledTimes(1);
    expect(runtime.secretClose).not.toHaveBeenCalled();
    f.send({ type: 'shutdown' });
    await f.expectExit(0);
  });
  it.each(['noEffect', 'unknown', 'unclassified'] as const)('maps the secret adapter %s result without leaking its message', async effect => {
    const fixture = await startFixture();
    // resetModules reloads the runner; inject the constructor from that same module graph.
    const { SecretBrokerError } = await import('../secrets/secretBrokerErrors.js');
    const options = runtime.startServer.mock.calls[0]![0] as {
      appOptions: {
        companyEmailSecretReader: { getSecret(companyId: string): Promise<unknown> };
        companyEmailSecretStore: {
          hasSecret(companyId: string): Promise<unknown>;
          setSecret(input: { companyId: string; operationId: string; secret: string }): Promise<void>;
          removeSecret(companyId: string, operationId: string): Promise<void>;
        };
      };
    };
    const error = effect === 'unclassified' ? new Error('synthetic-private-adapter-detail')
      : new SecretBrokerError('SECRET_WRITE_FAILED', effect);
    for (const method of [runtime.secretGet, runtime.secretHas, runtime.secretSet, runtime.secretRemove]) method.mockRejectedValue(error);
    const { companyEmailSecretReader: reader, companyEmailSecretStore: store } = options.appOptions;
    for (const action of [
      () => reader.getSecret('synthetic-company'),
      () => store.hasSecret('synthetic-company'),
      () => store.setSecret({ companyId: 'synthetic-company', operationId, secret: 'synthetic-value' }),
      () => store.removeSecret('synthetic-company', operationId),
    ]) {
      await expect(action()).rejects.toMatchObject({ effect: effect === 'noEffect' ? 'noEffect' : 'unknown',
        message: 'Secret storage failed.' });
    }
    expect(runtime.secretRemove).toHaveBeenCalledExactlyOnceWith('synthetic-company', operationId);
    expect(runtime.secretSet).toHaveBeenCalledExactlyOnceWith({ companyId: 'synthetic-company', operationId, secret: 'synthetic-value' });
    fixture.send({ type: 'shutdown' });
    await fixture.expectExit(0);
    expect(runtime.serverClose.mock.invocationCallOrder[0]).toBeLessThan(runtime.secretAssertSettled.mock.invocationCallOrder[0]!);
    expect(runtime.secretAssertSettled.mock.invocationCallOrder[0]).toBeLessThan(runtime.secretClose.mock.invocationCallOrder[0]!);
  });

  it('connects the lightweight context reader only to the registered backend service', async () => {
    const fixture = await startFixture(false);
    const context = { activeProfileId: 'd'.repeat(64), activeProfileIsEmpty: true };
    const read = vi.fn(() => context);
    runtime.startServer.mockImplementationOnce(async (options: {
      appOptions: {
        profileSnapshotServiceRegistration: { register(service: unknown): void };
        beforeMigrations(inspection: unknown): Promise<void>;
      };
    }) => {
      const broker = runtime.snapshotRegistration.mock.calls[0]![0] as {
        snapshot: { readProfileInspectionContext(): unknown };
      };
      expect(Object.keys(broker.snapshot).sort()).toEqual([
        'createProfileSnapshot', 'readProfileInspectionContext',
      ]);
      expect(() => broker.snapshot.readProfileInspectionContext()).toThrow('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
      options.appOptions.profileSnapshotServiceRegistration.register({ readProfileInspectionContext: read });
      expect(broker.snapshot.readProfileInspectionContext()).toBe(context);
      await options.appOptions.beforeMigrations({
        appliedMigrationCount: 1, migrationChainIdentity: 'a'.repeat(64),
        pendingMigrationCount: 0, profileState: 'existing',
      });
      return { close: runtime.serverClose, port: 32100 };
    });
    await fixture.start();
    await fixture.expectReady();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('delivers a non-serializable local recovery capability bound to this generation and revokes it on reservation loss', async () => {
    const fixture = await startFixture(false);
    const workspaceRoot = resolve(fixture.backendRoot, 'workspaces', '11111111-1111-4111-8111-111111111111');
    await mkdir(workspaceRoot, { recursive: true });
    const selection = await captureOwnedLocalDatabaseRecoverySelection(workspaceRoot);
    const databaseFilePath = createDesktopProfilePaths(workspaceRoot).databaseFilePath;
    await fixture.start({ databaseFilePath, ownedLocalDatabaseRecovery: selection });
    await fixture.expectReady();
    const options = runtime.startServer.mock.calls[0]![0] as {
      appOptions: { ownedLocalDatabaseRecovery: OwnedLocalDatabaseRecovery };
    };
    const authority = options.appOptions.ownedLocalDatabaseRecovery;
    expect(authority.assertOwnedDatabase).toBeTypeOf('function');
    expect(authority).not.toHaveProperty('workspaceRoot');
    expect(authority).not.toHaveProperty('workspaceIdentity');
    await authority.assertOwnedDatabase(databaseFilePath);
    await expect(authority.assertOwnedDatabase(resolve(workspaceRoot, 'imported.sqlite'))).rejects.toThrow();
    fixture.loseReservation();
    await fixture.expectExit(1);
    await expect(authority.assertOwnedDatabase(databaseFilePath)).rejects.toThrow();
  });

  it('rejects a selected-root/database mismatch before importing or invoking the backend', async () => {
    const fixture = await startFixture(false);
    const workspaceRoot = resolve(fixture.backendRoot, 'workspaces', '11111111-1111-4111-8111-111111111111');
    await mkdir(workspaceRoot, { recursive: true });
    await fixture.start({
      databaseFilePath: resolve(workspaceRoot, 'imported.sqlite'),
      ownedLocalDatabaseRecovery: await captureOwnedLocalDatabaseRecoverySelection(workspaceRoot),
    });
    await fixture.expectExit(1);
    expect(runtime.serverImport).not.toHaveBeenCalled();
    expect(runtime.startServer).not.toHaveBeenCalled();
  });

  it('checks the same update fence on both sides of server close before exit', async () => {
    const fixture = await startFixture();
    fixture.send({ type: 'shutdownForUpdate', operationId });
    await fixture.expectExit(0);
    expect(fixture.steps).toEqual([
      'assert', 'server', 'assert', 'secret', 'archive', 'snapshot', 'exit:0',
    ]);
    expect(runtime.assertUpdate.mock.calls).toEqual([[operationId], [operationId]]);
  });

  it.each(['wrong operation', 'invalid fence'] as const)(
    'rejects %s before closing the server and never reports success', async (failure) => {
      const fixture = await startFixture();
      if (failure === 'invalid fence') fixture.invalidate();
      fixture.send({
        type: 'shutdownForUpdate',
        operationId: failure === 'wrong operation' ? otherOperationId : operationId,
      });
      await fixture.expectExit(1);
      expect(runtime.serverClose).not.toHaveBeenCalled();
      fixture.expectBrokerCleanup();
      expect(fixture.postMessage.mock.calls.flat()).not.toContainEqual(
        expect.objectContaining({ code: expect.stringContaining('private') }),
      );
    },
  );

  it('rejects fence expiry or disconnect during the awaited server close', async () => {
    const fixture = await startFixture();
    const closing = deferred();
    runtime.serverClose.mockImplementationOnce(() => closing.promise);
    fixture.send({ type: 'shutdownForUpdate', operationId });
    expect(runtime.assertUpdate).toHaveBeenCalledTimes(1);
    expect(fixture.exit).not.toHaveBeenCalled();
    fixture.invalidate();
    closing.resolve();
    await fixture.expectExit(1);
    expect(runtime.assertUpdate).toHaveBeenCalledTimes(2);
    fixture.expectBrokerCleanup();
  });

  it('does not let an ordinary or identical follower bypass an update close', async () => {
    const fixture = await startFixture();
    const closing = deferred();
    runtime.serverClose.mockImplementationOnce(() => closing.promise);
    fixture.send({ type: 'shutdownForUpdate', operationId });
    fixture.send({ type: 'shutdown' });
    fixture.send({ type: 'shutdownForUpdate', operationId });
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.exit).not.toHaveBeenCalled();
    closing.resolve();
    await fixture.expectExit(0);
    expect(runtime.assertUpdate).toHaveBeenCalledTimes(2);
    fixture.expectBrokerCleanup();
  });

  it.each(['ordinary first', 'other update first'] as const)(
    'latches a conflicting update request as failure: %s', async (order) => {
      const fixture = await startFixture();
      const closing = deferred();
      runtime.serverClose.mockImplementationOnce(() => closing.promise);
      fixture.send(order === 'ordinary first'
        ? { type: 'shutdown' }
        : { type: 'shutdownForUpdate', operationId });
      fixture.send({
        type: 'shutdownForUpdate',
        operationId: order === 'ordinary first' ? operationId : otherOperationId,
      });
      expect(fixture.exit).not.toHaveBeenCalled();
      closing.resolve();
      await fixture.expectExit(1);
      expect(runtime.serverClose).toHaveBeenCalledTimes(1);
      fixture.expectBrokerCleanup();
    },
  );

  it.each(['serverClose', 'secretAssertSettled', 'secretClose', 'archiveClose', 'snapshotClose'] as const)(
    'keeps %s failure sticky while attempting all broker closes', async (name) => {
      const fixture = await startFixture();
      runtime[name].mockImplementationOnce(() => {
        throw new Error('synthetic private close failure');
      });
      fixture.send({ type: 'shutdownForUpdate', operationId });
      await fixture.expectExit(1);
      fixture.expectBrokerCleanup();
      expect(fixture.postMessage.mock.calls).toHaveLength(3);
    },
  );

  it('handles a rejected asynchronous server close without an unhandled rejection', async () => {
    const fixture = await startFixture();
    runtime.serverClose.mockRejectedValueOnce(new Error('synthetic private failure'));
    fixture.send({ type: 'shutdownForUpdate', operationId });
    await fixture.expectExit(1);
    expect(runtime.assertUpdate).toHaveBeenCalledTimes(1);
    fixture.expectBrokerCleanup();
  });

  it('preserves ordinary shutdown without requiring update maintenance', async () => {
    const fixture = await startFixture();
    fixture.invalidate();
    fixture.send({ type: 'shutdown' });
    fixture.send({ type: 'shutdown' });
    await fixture.expectExit(0);
    expect(runtime.assertUpdate).not.toHaveBeenCalled();
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    fixture.expectBrokerCleanup();
  });

  it('rejects update shutdown before a backend is started', async () => {
    const fixture = await startFixture(false);
    fixture.send({ type: 'shutdownForUpdate', operationId });
    await fixture.expectExit(1);
    fixture.grant();
    expect(runtime.startServer).not.toHaveBeenCalled();
    expect(runtime.assertUpdate).not.toHaveBeenCalled();
    expect(fixture.postMessage).not.toHaveBeenCalled();
  });

  it('requires completed startup even when the server and brokers already exist', async () => {
    const fixture = await startFixture(false);
    const rendererRoot = resolve(fixture.backendRoot,
      'dist/modules/invoicing/infrastructure/pdf');
    await mkdir(rendererRoot, { recursive: true });
    const rendererPath = resolve(rendererRoot, 'approvedInvoicePdfRenderer.js');
    await writeFile(rendererPath,
      'export const control = {};\n' +
      'export const renderApprovedInvoicePdf = () => control.render();\n');
    await writeFile(resolve(rendererRoot, 'approvedInvoicePdfSample.js'),
      'export const createApprovedInvoicePdfSample = () => ({});\n');
    const renderer = await import(pathToFileURL(rendererPath).href);
    const rendering = deferred();
    const finishRendering = deferred();
    renderer.control.render = async () => {
      rendering.resolve();
      await finishRendering.promise;
      return new TextEncoder().encode('%PDF synthetic');
    };
    await fixture.start({ createSmokePdf: true });
    await rendering.promise;
    fixture.send({ type: 'shutdownForUpdate', operationId });
    try {
      expect(fixture.exit).not.toHaveBeenCalled();
      expect(runtime.assertUpdate).not.toHaveBeenCalled();
      expect(runtime.serverClose).not.toHaveBeenCalled();
    } finally {
      finishRendering.resolve();
      await fixture.expectExit(1);
    }
    fixture.expectBrokerCleanup();
    expect(fixture.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
  });

  it('ignores malformed commands without allowing an ordinary fallback', async () => {
    const fixture = await startFixture();
    fixture.send({ type: 'shutdown', operationId });
    fixture.send({ type: 'shutdownForUpdate', operationId: '../private' });
    expect(runtime.serverClose).not.toHaveBeenCalled();
    expect(fixture.exit).not.toHaveBeenCalled();
    fixture.send({ type: 'shutdownForUpdate', operationId });
    await fixture.expectExit(0);
  });
});

describe('backend runner protected restore shutdown', () => {
  it('checks the restore owner before and after server close without accepting an update fence', async () => {
    const fixture = await startFixture();
    fixture.send({ type: 'shutdownForRestore', operationId });
    await fixture.expectExit(0);
    expect(fixture.steps).toEqual([
      'assertRestore', 'server', 'assertRestore', 'secret', 'archive', 'snapshot', 'exit:0',
    ]);
    expect(runtime.assertRestore.mock.calls).toEqual([[operationId], [operationId]]);
    expect(runtime.assertUpdate).not.toHaveBeenCalled();
  });

  it.each(['wrong owner', 'invalid fence'] as const)(
    'rejects a %s before server close while closing all brokers', async (failure) => {
      const fixture = await startFixture();
      if (failure === 'invalid fence') fixture.invalidateRestore();
      fixture.send({ type: 'shutdownForRestore',
        operationId: failure === 'wrong owner' ? otherOperationId : operationId });
      await fixture.expectExit(1);
      expect(runtime.serverClose).not.toHaveBeenCalled();
      fixture.expectBrokerCleanup();
    },
  );

  it('cannot acknowledge lost restore protection during the awaited close', async () => {
    const fixture = await startFixture();
    const closing = deferred();
    runtime.serverClose.mockImplementationOnce(() => closing.promise);
    fixture.send({ type: 'shutdownForRestore', operationId });
    fixture.send({ type: 'shutdown' });
    fixture.send({ type: 'shutdownForRestore', operationId });
    expect(runtime.assertRestore).toHaveBeenCalledTimes(1);
    expect(fixture.exit).not.toHaveBeenCalled();
    fixture.invalidateRestore();
    closing.resolve();
    await fixture.expectExit(1);
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    expect(runtime.assertRestore).toHaveBeenCalledTimes(2);
    fixture.expectBrokerCleanup();
  });

  it('accepts identical restore and ordinary followers while the original fence stays valid', async () => {
    const fixture = await startFixture();
    const closing = deferred();
    runtime.serverClose.mockImplementationOnce(() => closing.promise);
    fixture.send({ type: 'shutdownForRestore', operationId });
    fixture.send({ type: 'shutdown' });
    fixture.send({ type: 'shutdownForRestore', operationId });
    expect(fixture.exit).not.toHaveBeenCalled();
    closing.resolve();
    await fixture.expectExit(0);
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    expect(runtime.assertRestore.mock.calls).toEqual([[operationId], [operationId]]);
    fixture.expectBrokerCleanup();
  });

  it.each([
    ['shutdown', 'shutdownForRestore', operationId],
    ['shutdownForUpdate', 'shutdownForRestore', operationId],
    ['shutdownForRestore', 'shutdownForUpdate', operationId],
    ['shutdownForRestore', 'shutdownForRestore', otherOperationId],
  ] as const)('keeps first intent %s when a conflicting %s arrives', async (first, follower, owner) => {
    const fixture = await startFixture();
    const closing = deferred();
    runtime.serverClose.mockImplementationOnce(() => closing.promise);
    fixture.send(first === 'shutdown' ? { type: first } : { type: first, operationId });
    fixture.send({ type: follower, operationId: owner });
    fixture.send(first === 'shutdown' ? { type: first } : { type: first, operationId });
    fixture.send({ type: 'shutdown' });
    expect(fixture.exit).not.toHaveBeenCalled();
    closing.resolve();
    await fixture.expectExit(1);
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    fixture.expectBrokerCleanup();
  });

  it.each(['serverClose', 'secretAssertSettled', 'secretClose', 'archiveClose', 'snapshotClose'] as const)(
    'retains %s failure while attempting every owned broker close', async (name) => {
      const fixture = await startFixture();
      runtime[name].mockImplementationOnce(() => {
        throw new Error('synthetic private restore close failure');
      });
      fixture.send({ type: 'shutdownForRestore', operationId });
      await fixture.expectExit(1);
      fixture.expectBrokerCleanup();
      expect(fixture.postMessage.mock.calls).toHaveLength(3);
    },
  );

  it('rejects restore shutdown before business startup completes', async () => {
    const fixture = await startFixture(false);
    fixture.send({ type: 'shutdownForRestore', operationId });
    await fixture.expectExit(1);
    fixture.grant();
    expect(runtime.startServer).not.toHaveBeenCalled();
    expect(runtime.assertRestore).not.toHaveBeenCalled();
  });
});

describe('backend runner reservation and work grant', () => {
  it('acquires the prepared identity but does not import until the matching grant', async () => {
    const fixture = await startFixture(false);
    await fixture.prepare();
    expect(runtime.acquireReservation).toHaveBeenCalledExactlyOnceWith({
      expectedIdentity: fixture.reservation.identity,
      signal: expect.any(AbortSignal),
      userDataRoot: fixture.backendRoot,
    });
    expect(runtime.serverImport).not.toHaveBeenCalled();
    fixture.grant();
    await fixture.expectReady();
    expect(runtime.serverImport).toHaveBeenCalledTimes(1);
    expect(runtime.releaseReservation).not.toHaveBeenCalled();
    fixture.send({ type: 'shutdown' });
    await fixture.expectExit(0);
    expect(runtime.releaseReservation).not.toHaveBeenCalled();
  });

  it.each(['unprepared', 'acquiring', 'wrong generation', 'duplicate prepare', 'extra port'] as const)(
    'rejects an invalid grant order: %s', async (order) => {
      const fixture = await startFixture(false);
      const acquired = deferred();
      if (order === 'acquiring') {
        runtime.acquireReservation.mockImplementationOnce(async () => {
          await acquired.promise;
          return fixture.heldReservation;
        });
        fixture.send({ type: 'prepare', reservation: fixture.reservation });
      } else if (order === 'extra port') {
        fixture.send({ type: 'prepare', reservation: fixture.reservation }, [{}]);
      } else if (order !== 'unprepared') {
        await fixture.prepare();
      }
      if (order === 'duplicate prepare') {
        fixture.send({ type: 'prepare', reservation: fixture.reservation });
      } else if (order !== 'extra port') {
        fixture.grant({}, order === 'wrong generation' ? otherOperationId : operationId);
      }
      await fixture.expectExit(1);
      acquired.resolve();
      await vi.waitFor(() => expect(runtime.acquireReservation.mock.settledResults
        .every((result) => result.type !== 'incomplete')).toBe(true));
      expect(runtime.serverImport).not.toHaveBeenCalled();
      expect(runtime.startServer).not.toHaveBeenCalled();
      fixture.expectReservationFailure();
    },
  );

  it('does not reset the ungranted deadline after preparing the reservation', async () => {
    vi.useFakeTimers();
    const fixture = await startFixture(false);
    await vi.advanceTimersByTimeAsync(desktopBackendReadinessTimeoutMilliseconds - 1);
    await fixture.prepare();
    expect(fixture.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await fixture.expectExit(1);
    fixture.grant();
    expect(runtime.serverImport).not.toHaveBeenCalled();
    fixture.expectReservationFailure();
  });

  it('exits an unprepared orphan at the existing readiness deadline', async () => {
    vi.useFakeTimers();
    const fixture = await startFixture(false);
    await vi.advanceTimersByTimeAsync(desktopBackendReadinessTimeoutMilliseconds);
    await fixture.expectExit(1);
    expect(runtime.acquireReservation).not.toHaveBeenCalled();
    expect(runtime.serverImport).not.toHaveBeenCalled();
  });

  it('does not wait for stuck acquisition or allow its late resolution to import', async () => {
    const fixture = await startFixture(false);
    const acquired = deferred();
    runtime.acquireReservation.mockImplementationOnce(async () => {
      await acquired.promise;
      return fixture.heldReservation;
    });
    fixture.send({ type: 'prepare', reservation: fixture.reservation });
    fixture.send({ type: 'shutdown' });
    await fixture.expectExit(0);
    acquired.resolve();
    await vi.waitFor(() => expect(runtime.acquireReservation.mock.settledResults[0]?.type).toBe('fulfilled'));
    fixture.grant();
    expect(runtime.serverImport).not.toHaveBeenCalled();
    expect(fixture.postMessage).not.toHaveBeenCalled();
  });

  it.each(['shutdown', 'loss', 'duplicate grant', 'deadline'] as const)(
    'prevents late import after grant verification is interrupted by %s', async (interruption) => {
      vi.useFakeTimers();
      const fixture = await startFixture(false);
      await fixture.prepare();
      const verified = deferred();
      runtime.assertReservation.mockImplementationOnce(() => verified.promise);
      fixture.grant();
      expect(runtime.serverImport).not.toHaveBeenCalled();
      if (interruption === 'shutdown') fixture.send({ type: 'shutdown' });
      if (interruption === 'loss') fixture.loseReservation();
      if (interruption === 'duplicate grant') fixture.grant();
      if (interruption === 'deadline') {
        await vi.advanceTimersByTimeAsync(desktopBackendReadinessTimeoutMilliseconds);
      }
      await fixture.expectExit(interruption === 'shutdown' ? 0 : 1);
      verified.resolve();
      await vi.waitFor(() => expect(runtime.assertReservation.mock.settledResults[1]?.type).toBe('fulfilled'));
      expect(runtime.serverImport).not.toHaveBeenCalled();
      expect(runtime.startServer).not.toHaveBeenCalled();
    },
  );

  it('preserves the safe reservation cause when ownership verification rejects', async () => {
    const fixture = await startFixture(false);
    await fixture.prepare();
    runtime.assertReservation.mockRejectedValueOnce(new Error('private root unavailable'));
    fixture.grant();
    await fixture.expectExit(1);
    fixture.expectReservationFailure();
    expect(runtime.serverImport).not.toHaveBeenCalled();
  });

  it('waits for an already evaluating module before exit and never starts its server after cancel', async () => {
    const fixture = await startFixture(false);
    const imported = deferred();
    const finishImport = deferred();
    runtime.serverImport.mockImplementationOnce(async () => {
      imported.resolve();
      await finishImport.promise;
    });
    await fixture.start();
    await imported.promise;
    fixture.send({ type: 'shutdown' });
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(runtime.releaseReservation).not.toHaveBeenCalled();
    finishImport.resolve();
    await fixture.expectExit(0);
    expect(runtime.startServer).not.toHaveBeenCalled();
    expect(runtime.secretClose).toHaveBeenCalledTimes(1);
    expect(runtime.archiveClose).toHaveBeenCalledTimes(1);
  });

  it('settles the pending migration gate on controlled shutdown instead of waiting for itself', async () => {
    const fixture = await startFixture(false);
    fixture.holdMigrationGate();
    await fixture.start();
    await vi.waitFor(() => expect(fixture.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'migrationGateReady' }),
    ));
    fixture.send({ type: 'shutdown' });
    await fixture.expectExit(0);
    fixture.expectBrokerCleanup();
    expect(fixture.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
    expect(fixture.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'failed' }));
  });

  it('waits for a pending server start and closes its returned handle before exit', async () => {
    const fixture = await startFixture(false);
    const starting = deferred();
    const finishStart = deferred();
    runtime.startServer.mockImplementationOnce(async () => {
      starting.resolve();
      await finishStart.promise;
      return { close: runtime.serverClose, port: 32100 };
    });
    await fixture.start();
    await starting.promise;
    fixture.send({ type: 'shutdown' });
    expect(fixture.exit).not.toHaveBeenCalled();
    finishStart.resolve();
    await fixture.expectExit(0);
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    fixture.expectBrokerCleanup();
    expect(fixture.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
  });

  it('latches lost ownership during server close as failure without a second close', async () => {
    const fixture = await startFixture();
    const closed = deferred();
    runtime.serverClose.mockImplementationOnce(() => closed.promise);
    fixture.send({ type: 'shutdown' });
    fixture.loseReservation();
    expect(fixture.exit).not.toHaveBeenCalled();
    closed.resolve();
    await fixture.expectExit(1);
    expect(runtime.serverClose).toHaveBeenCalledTimes(1);
    fixture.expectReservationFailure();
    fixture.expectBrokerCleanup();
  });
});

async function startFixture(startBackend = true) {
  fixtureRoot = await mkdtemp(resolve(tmpdir(), 'eky-backend-runner-'));
  const backendRoot = fixtureRoot;
  const serverPath = resolve(backendRoot, 'dist/http/server.js');
  const maintenanceRoot = resolve(backendRoot, 'dist/runtime/profileMaintenance');
  await mkdir(resolve(backendRoot, 'dist/http'), { recursive: true });
  await mkdir(maintenanceRoot, { recursive: true });
  await writeFile(resolve(backendRoot, 'package.json'), '{"type":"module"}');
  fixtureControlKey = `eky-backend-runner:${fixtureRoot}`;
  Object.defineProperty(globalThis, fixtureControlKey, {
    configurable: true,
    value: { onImport: runtime.serverImport, startServer: runtime.startServer },
  });
  // Do not preload the module: evaluation itself is the observed write boundary.
  await writeFile(serverPath,
    `const control = globalThis[${JSON.stringify(fixtureControlKey)}];\n` +
    'await control.onImport();\n' +
    'export const startServer = (...args) => control.startServer(...args);\n' +
    'export class CompanyEmailSecretStoreError extends Error { constructor(effect) { super("Secret storage failed."); this.effect = effect; } }\n');
  await writeFile(resolve(maintenanceRoot, 'profileMaintenanceState.js'),
    'export class ProfileMaintenanceState {}\n');
  const steps: string[] = [];
  let validFence = true;
  let continueMigrations = true;
  const reservationLost = new AbortController();
  const reservation = { generationId: operationId, identity: 'a'.repeat(64), userDataRoot: backendRoot };
  const heldReservation = {
    identity: reservation.identity,
    invalidated: reservationLost.signal,
    assertOwned: runtime.assertReservation,
    release: runtime.releaseReservation,
  };
  runtime.acquireReservation.mockResolvedValue(heldReservation);
  runtime.assertReservation.mockResolvedValue(undefined);
  const prepared = deferred();
  let listener: (event: { data: unknown; ports: unknown[] }) => void;
  const send = (data: unknown, ports: unknown[] = []) => listener({ data, ports });
  const postMessage = vi.fn((message: { type: string }) => {
    if (message.type === 'reservationReady') prepared.resolve();
    if (message.type === 'migrationGateReady' && continueMigrations) {
      queueMicrotask(() => send({ type: 'continueStartup' }));
    }
  });
  Object.defineProperty(process, 'parentPort', {
    configurable: true,
    value: {
      on: (_event: string, callback: typeof listener) => { listener = callback; },
      postMessage,
    },
  });
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    steps.push(`exit:${code}`);
    return undefined as never;
  });
  runtime.assertUpdate.mockImplementation((id: string) => {
    steps.push('assert');
    if (!validFence || id !== operationId) throw new Error('synthetic private fence failure');
  });
  let validRestoreFence = true;
  runtime.assertRestore.mockImplementation((id: string) => {
    steps.push('assertRestore');
    if (!validRestoreFence || id !== operationId) throw new Error('synthetic private restore fence failure');
  });
  runtime.serverClose.mockImplementation(async () => { steps.push('server'); });
  runtime.secretClose.mockImplementation(() => { steps.push('secret'); });
  runtime.archiveClose.mockImplementation(() => { steps.push('archive'); });
  runtime.snapshotClose.mockImplementation(() => {
    steps.push('snapshot');
    validFence = false;
    validRestoreFence = false;
  });
  runtime.startServer.mockImplementation(async (options: {
    appOptions: { beforeMigrations(inspection: unknown): Promise<void> };
  }) => {
    await options.appOptions.beforeMigrations({
      appliedMigrationCount: 1,
      migrationChainIdentity: 'a'.repeat(64),
      pendingMigrationCount: 0,
      profileState: 'existing',
    });
    return { close: runtime.serverClose, port: 32100 };
  });
  await import('./backendRunner.js');
  const prepare = async () => {
    send({ type: 'prepare', reservation });
    await prepared.promise;
    expect(postMessage).toHaveBeenCalledWith({ type: 'reservationReady', reservation });
  };
  const grant = (configOverrides: Record<string, unknown> = {}, generationId = operationId) => {
    const command = startCommand(backendRoot);
    send({ ...command, generationId, config: { ...command.config, ...configOverrides } }, [{}, {}, {}]);
  };
  const start = async (configOverrides: Record<string, unknown> = {}) => {
    await prepare();
    grant(configOverrides);
  };
  const expectReady = async () => {
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
      port: 32100, smokePdfCreated: false, smokeSecretBrokerVerified: false, type: 'ready',
    }));
  };
  stopFixture = async () => {
    send({ type: 'shutdown' });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    expect(runtime.releaseReservation).not.toHaveBeenCalled();
  };
  if (startBackend) {
    await start();
    await expectReady();
  }
  return {
    backendRoot, exit, postMessage, send, start, grant, prepare, steps, reservation,
    heldReservation, expectReady,
    holdMigrationGate: () => { continueMigrations = false; },
    loseReservation: () => reservationLost.abort(),
    invalidate: () => { validFence = false; },
    invalidateRestore: () => { validRestoreFence = false; },
    expectReservationFailure: () => {
      expect(postMessage.mock.calls.filter(([message]) => message.type === 'failed')).toEqual([
        [{ code: 'BACKEND_PROCESS_RESERVATION_FAILED', type: 'failed' }],
      ]);
    },
    expectExit: async (code: number) => {
      await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(code));
    },
    expectBrokerCleanup: () => {
      for (const close of [runtime.secretClose, runtime.archiveClose, runtime.snapshotClose]) {
        expect(close).toHaveBeenCalledTimes(1);
      }
    },
  };
}

function startCommand(backendRoot: string) {
  const root = resolve(backendRoot, 'profile');
  return {
    type: 'start',
    generationId: operationId,
    config: {
      appVersion: '0.3.0', architecture: 'x64', backendRoot,
      buildCreatedAt: '2026-10-08T00:00:00.000Z', buildDirty: false,
      buildRevision: 'a'.repeat(40), createSmokePdf: false,
      databaseFilePath: resolve(root, 'profile.sqlite'), electronVersion: '43.7.6',
      invoiceDocumentStorageRoot: resolve(root, 'artifacts'),
      migrationsDirectory: resolve(backendRoot, 'dist/database/migrations'),
      migrationStartupPolicy: 'exactCurrentManifest',
      operationalLogsRoot: resolve(root, 'logs'), platform: 'win32',
      profileSnapshotStagingRoot: resolve(root, 'staging'), runtimeInstanceId: operationId,
      runtimeSessionSecret: 'a'.repeat(43), smokePdfPath: resolve(root, 'smoke.pdf'),
      verifySmokeSecretBroker: false,
      secretBrokerGenerationId: operationId,
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
