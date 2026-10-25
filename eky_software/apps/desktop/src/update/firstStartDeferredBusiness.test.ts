import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import {
  createBusinessAcceptedBuildMetadata,
  createSelectorAcceptedBuildMetadata,
  type AcceptedBuildMetadata,
  type VersionedAcceptedBuildMetadata,
} from './acceptedBuildMetadata.js';
import { AcceptedBuildMetadataStore, acceptedBuildMetadataFileName } from './acceptedBuildMetadataStore.js';
import { FirstStartUpdateCoordinator, FirstStartUpdateError, type MigrationStartupInspection } from './firstStartUpdateCoordinator.js';
import { createDirectSetupMigrationRecovery, type DirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import { parseUpdateJournal, type UpdateJournal } from './updateJournal.js';

const at = '2026-10-25T12:00:00.000Z';
const baseline: Readonly<AcceptedBuildMetadata> = {
  formatVersion: 1, appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: at, releaseChannel: 'pilot',
};
const target = { ...baseline, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) };
const selector = createSelectorAcceptedBuildMetadata(baseline, target);
const chain = 'c'.repeat(64);
const inspection = { profileState: 'existing' as const, appliedMigrationCount: 39,
  pendingMigrationCount: 0, migrationChainIdentity: chain };

it('publishes business-v2 only after fresh content, secret and authority checks', async context => {
  const f = await fixture(context);
  await f.start();
  expect(await f.store.read()).toEqual(selector);
  expect(f.write).not.toHaveBeenCalled();
  await f.subject.acceptAfterBackendReady();
  expect(await f.store.read()).toEqual(createBusinessAcceptedBuildMetadata(selector, target));
  expect(f.validate).toHaveBeenCalledOnce();
  expect(f.secret).toHaveBeenCalledTimes(2);
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.noOtherOwner).not.toHaveBeenCalled();
  expect(f.observer).not.toHaveBeenCalled();
  await expect(f.subject.recoverFromStartupFailure()).resolves.toBe(false);
});

it.for(['pending', 'empty', 'prefix', 'wrongTarget', 'wrongMetadata', 'missingMetadata', 'businessScope', 'updateJournal', 'directSetup'] as const)(
  'rejects %s before authorizing SQL or publishing business acceptance', async (variant, context) => {
    const f = await fixture(context);
    const observed: MigrationStartupInspection = { ...inspection };
    switch (variant) {
      case 'pending': observed.pendingMigrationCount = 1; break;
      case 'empty': observed.profileState = 'empty'; break;
      case 'prefix': observed.migrationChainIdentity = 'd'.repeat(64); break;
      case 'wrongTarget': f.release.appVersion = '0.4.0'; break;
      case 'wrongMetadata': await f.store.write(createSelectorAcceptedBuildMetadata(selector, { ...target, appVersion: '0.4.0' })); break;
      case 'missingMetadata': await f.store.clear(); break;
      case 'businessScope': await f.store.write(createBusinessAcceptedBuildMetadata(selector, target)); break;
      case 'updateJournal': f.state.journal = foreignJournal('accepted'); break;
      case 'directSetup': f.state.direct = foreignRecovery(); break;
    }
    const before = await f.store.read();
    f.write.mockClear();
    await expect(f.start(observed)).rejects.toBeInstanceOf(FirstStartUpdateError);
    expect(await f.store.read()).toEqual(before);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled();
    expect(f.noOtherOwner).not.toHaveBeenCalled();
  },
);

it.for(['update', 'profileRestore'] as const)('does not accept selector state through the old %s path', async (authority, context) => {
  const f = await fixture(context);
  await expect(f.subject.beforeMigrations(inspection, { migrationAuthority: authority })).rejects.toBeInstanceOf(FirstStartUpdateError);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.noOtherOwner).not.toHaveBeenCalled();
});

it.for(['beforeStart', 'secretRead', 'beforeAccept', 'contentRead', 'finalSecretRead'] as const)(
  'rejects stale generation/selection at %s without changing accepted bytes', async (stage, context) => {
    const f = await fixture(context);
    const original = await readFile(f.path);
    if (stage === 'beforeStart') f.state.current = false;
    if (stage === 'secretRead') f.secret.mockImplementationOnce(async () => { f.state.current = false; return null; });
    if (stage === 'beforeStart' || stage === 'secretRead') {
      await expect(f.start()).rejects.toBeInstanceOf(FirstStartUpdateError);
    } else {
      await f.start();
      if (stage === 'beforeAccept') f.state.current = false;
      if (stage === 'contentRead') f.validate.mockImplementationOnce(async () => { f.state.current = false; return validProfile(); });
      if (stage === 'finalSecretRead') f.secret.mockImplementationOnce(async () => { f.state.current = false; return null; });
      await expect(f.subject.acceptAfterBackendReady()).rejects.toBeInstanceOf(FirstStartUpdateError);
    }
    expect(await readFile(f.path)).toEqual(original);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noOtherOwner).not.toHaveBeenCalled();
  },
);

it.for(['secret', 'profileChain', 'metadata', 'journal', 'directSetup'] as const)(
  'rejects changed %s after the migration gate', async (variant, context) => {
    const f = await fixture(context);
    await f.start();
    if (variant === 'secret') f.secret.mockResolvedValue('d'.repeat(64));
    if (variant === 'profileChain') f.validate.mockResolvedValue({ ...validProfile(), migrationChainIdentity: 'd'.repeat(64) });
    if (variant === 'metadata') await f.store.write(createSelectorAcceptedBuildMetadata(selector, { ...target, appVersion: '0.4.0' }));
    if (variant === 'journal') f.state.journal = foreignJournal('accepted');
    if (variant === 'directSetup') f.state.direct = foreignRecovery();
    const before = await readFile(f.path);
    f.write.mockClear();
    await expect(f.subject.acceptAfterBackendReady()).rejects.toBeInstanceOf(FirstStartUpdateError);
    expect(await readFile(f.path)).toEqual(before);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noOtherOwner).not.toHaveBeenCalled();
  },
);

it.for(['beforePublication', 'lostAcknowledgement', 'readback', 'authorityAfterPublication'] as const)(
  'retains actual persisted state and the original cause for %s', async (stage, context) => {
    const f = await fixture(context);
    await f.start();
    const original = new Error('synthetic acceptance failure', { cause: new Error('synthetic root') });
    const persist = f.store.write.bind(f.store);
    if (stage === 'beforePublication') f.write.mockRejectedValueOnce(original);
    if (stage === 'lostAcknowledgement') f.write.mockImplementationOnce(async value => {
      await persist(value); throw original;
    });
    if (stage === 'readback') f.write.mockImplementationOnce(async value => {
      await persist(value);
      vi.spyOn(f.store, 'read').mockRejectedValueOnce(original);
    });
    if (stage === 'authorityAfterPublication') f.write.mockImplementationOnce(async value => {
      await persist(value);
      f.assertCurrent.mockRejectedValueOnce(original);
    });
    const failure = await f.subject.acceptAfterBackendReady().then(() => undefined, error => error);
    expect(failure).toBeInstanceOf(FirstStartUpdateError);
    expect(failure.cause).toBe(original);
    expect(f.observer).toHaveBeenCalledExactlyOnceWith(original);
    expect(await f.store.read()).toEqual(stage === 'beforePublication'
      ? selector : createBusinessAcceptedBuildMetadata(selector, target));
    expect(f.write).toHaveBeenCalledOnce();
    expect(f.noOtherOwner).not.toHaveBeenCalled();
    await expect(f.subject.recoverFromStartupFailure()).resolves.toBe(false);
  },
);

it('does not treat a successful write with mismatched readback as acceptance', async context => {
  const f = await fixture(context);
  await f.start();
  f.write.mockResolvedValueOnce(undefined);
  await expect(f.subject.acceptAfterBackendReady()).rejects.toBeInstanceOf(FirstStartUpdateError);
  expect(await f.store.read()).toEqual(selector);
  expect(f.noOtherOwner).not.toHaveBeenCalled();
});

it('normal business-v2 startup remains a no-write path', async context => {
  const f = await fixture(context);
  const business = createBusinessAcceptedBuildMetadata(selector, target);
  await f.store.write(business);
  f.write.mockClear();
  await f.subject.beforeMigrations(inspection);
  await f.subject.acceptAfterBackendReady();
  expect(await f.store.read()).toEqual(business);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.noOtherOwner).not.toHaveBeenCalled();
});

it('rejects a pending unrelated recovery without changing its journal', async context => {
  const f = await fixture(context);
  const recovery = foreignRecovery();
  f.state.direct = recovery;
  await expect(f.start()).rejects.toBeInstanceOf(FirstStartUpdateError);
  expect(f.state.direct).toBe(recovery);
  expect(f.noOtherOwner).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it('does not acquire a late update recovery after deferred admission was rejected', async context => {
  const f = await fixture(context);
  f.state.current = false;
  await expect(f.start()).rejects.toBeInstanceOf(FirstStartUpdateError);
  f.state.journal = foreignJournal('rollbackRequired');
  await expect(f.subject.recoverFromStartupFailure()).resolves.toBe(false);
  expect(f.noOtherOwner).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

function foreignRecovery() {
  return createDirectSetupMigrationRecovery({
    appliedMigrationCount: 38,
    at,
    correlationId: '11111111-1111-4111-8111-111111111111',
    migrationPrefixIdentity: chain,
    previousAcceptedBuildIdentity: {
      appVersion: baseline.appVersion, buildRevision: baseline.buildRevision,
    },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: {
      appVersion: target.appVersion, buildRevision: target.buildRevision,
    },
  });
}

function foreignJournal(state: 'accepted' | 'rollbackRequired') {
  return parseUpdateJournal({
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: { buildRevision: target.buildRevision,
      msiProductVersion: target.appVersion, packageSha256: 'd'.repeat(64), packageSize: 100 },
    correlationId: '33333333-3333-4333-8333-333333333333',
    createdAt: at,
    currentPackageIdentity: { buildRevision: baseline.buildRevision,
      msiProductVersion: baseline.appVersion, packageSha256: 'e'.repeat(64), packageSize: 100 },
    currentVersion: baseline.appVersion,
    formatVersion: 1,
    handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: chain,
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    releaseChannel: 'pilot',
    revision: 4,
    state,
    targetVersion: target.appVersion,
    updatedAt: at,
  });
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deferred-business-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const path = join(root, acceptedBuildMetadataFileName);
  const store = new AcceptedBuildMetadataStore(path);
  await store.write(selector);
  const persist = store.write.bind(store);
  // A separate port spy allows injecting a lost acknowledgement after real persistence.
  const write = vi.fn((value: VersionedAcceptedBuildMetadata) => persist(value));
  const state = { current: true, journal: undefined as UpdateJournal | undefined,
    direct: undefined as DirectSetupMigrationRecovery | undefined };
  const assertCurrent = vi.fn(async () => { if (!state.current) throw new Error('SYNTHETIC_AUTHORITY_LOST'); });
  const noOtherOwner = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_SECOND_OWNER_FORBIDDEN'); });
  const validate = vi.fn(async () => validProfile());
  const secret = vi.fn(async (): Promise<string | null> => null);
  const observer = vi.fn();
  const release = { schemaVersion: 1 as const, appIdentity: 'Eky' as const, appVersion: target.appVersion,
    buildRevision: target.buildRevision, msiProductVersion: target.appVersion, releaseChannel: 'pilot' as const,
    platform: 'win32' as const, architecture: 'x64' as const, upgradeCode: '11111111-1111-4111-8111-111111111111' };
  const subject = new FirstStartUpdateCoordinator({
    acceptedBuildStore: { read: () => store.read(), write },
    buildInfo: { buildDirty: false, buildRevision: target.buildRevision },
    releaseInfo: release, now: () => new Date(at), observeStartupException: observer,
    journalStore: { read: async () => state.journal, write: noOtherOwner },
    directSetupRecoveryStore: { read: async () => state.direct, write: noOtherOwner, clear: noOtherOwner },
    cache: { normalizeRolledBackPackages: noOtherOwner, promoteAcceptedCandidate: noOtherOwner, revalidateJournalPackage: noOtherOwner },
    profileProtection: { createValidatedPreMigrationPoint: noOtherOwner, releaseProtectedPoint: noOtherOwner, validateActiveProfile: validate },
    readSecretStorageIdentity: secret,
  });
  const start = (value: MigrationStartupInspection = inspection) => subject.beforeMigrations(value, {
    migrationAuthority: 'deferredBusiness', authority: { acceptedBuild: selector, migrationChainIdentity: chain, assertCurrent },
  });
  return { path, store, subject, state, write, start, validate, secret, observer, release, noOtherOwner, assertCurrent };
}

function validProfile() {
  return { artifactCount: 1, artifactTotalByteSize: 32, databaseHealth: 'healthy' as const, migrationChainIdentity: chain };
}
