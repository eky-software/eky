import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDirectSetupMigrationRecovery,
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import {
  directSetupMigrationRecoveryFileName,
  DirectSetupMigrationRecoveryStore,
} from './directSetupMigrationRecoveryStore.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('direct Setup migration recovery store', () => {
  it('writes and reads the exact validated record', async () => {
    const fixture = await createFixture();
    const store = new DirectSetupMigrationRecoveryStore(fixture.filePath);
    const record = createRecord();

    await store.write(record);

    await expect(store.read()).resolves.toEqual(record);
    expect(JSON.parse(await readFile(fixture.filePath, 'utf8'))).toEqual(record);
  });

  it('restores the original backup after an interrupted replacement', async () => {
    const fixture = await createFixture();
    const original = createRecord();
    const next = transitionDirectSetupMigrationRecovery(original, {
      at: '2026-08-12T18:01:00.000Z',
      state: 'migrationRunning',
    });
    await writeSlot(`${fixture.filePath}.backup`, original);
    await writeSlot(`${fixture.filePath}.next`, next);

    await expect(
      new DirectSetupMigrationRecoveryStore(fixture.filePath).read(),
    ).resolves.toEqual(original);
    await expect(readFile(`${fixture.filePath}.next`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('promotes next only when current and backup are absent', async () => {
    const fixture = await createFixture();
    const record = createRecord();
    await writeSlot(`${fixture.filePath}.next`, record);

    await expect(
      new DirectSetupMigrationRecoveryStore(fixture.filePath).read(),
    ).resolves.toEqual(record);
  });

  it('fails closed on corrupt current instead of hiding it with backup', async () => {
    const fixture = await createFixture();
    await mkdir(dirname(fixture.filePath), { recursive: true });
    await writeFile(fixture.filePath, '{');
    await writeSlot(`${fixture.filePath}.backup`, createRecord());

    await expect(
      new DirectSetupMigrationRecoveryStore(fixture.filePath).read(),
    ).rejects.toThrow('DIRECT_SETUP_RECOVERY_INVALID');
  });

  it('rejects stale or unrelated writes and clears every slot', async () => {
    const fixture = await createFixture();
    const store = new DirectSetupMigrationRecoveryStore(fixture.filePath);
    const original = createRecord();
    const running = transitionDirectSetupMigrationRecovery(original, {
      at: '2026-08-12T18:01:00.000Z',
      state: 'migrationRunning',
    });
    await store.write(running);

    await expect(store.write(original)).rejects.toThrow(
      'DIRECT_SETUP_RECOVERY_CONFLICT',
    );
    await expect(
      store.write({
        ...running,
        correlationId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toThrow('DIRECT_SETUP_RECOVERY_CONFLICT');

    await writeSlot(`${fixture.filePath}.next`, running);
    await writeSlot(`${fixture.filePath}.backup`, running);
    await store.clear();
    await expect(store.read()).resolves.toBeUndefined();
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-direct-setup-recovery-'));
  roots.push(root);
  return {
    filePath: join(root, 'update-state', directSetupMigrationRecoveryFileName),
  };
}

async function writeSlot(
  path: string,
  value: Readonly<DirectSetupMigrationRecovery>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function createRecord(): Readonly<DirectSetupMigrationRecovery> {
  return createDirectSetupMigrationRecovery({
    appliedMigrationCount: 37,
    at: '2026-08-12T18:00:00.000Z',
    correlationId: '11111111-1111-4111-8111-111111111111',
    migrationPrefixIdentity: 'a'.repeat(64),
    previousAcceptedBuildIdentity: {
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'aaaaaaaaaaaa',
    },
    recoveryPointReference: '22222222-2222-4222-8222-222222222222',
    runningTargetBuildIdentity: {
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'bbbbbbbbbbbb',
    },
  });
}
