import { describe, expect, it, vi } from 'vitest';

import { migrateLegacyLocalUpdateState } from './migrateLegacyLocalUpdateState.js';

const accepted = Object.freeze({
  acceptedAt: '2026-08-11T18:00:00.000Z',
  appVersion: '0.1.0-alpha.1',
  buildRevision: 'abcdef012345',
  formatVersion: 1 as const,
  releaseChannel: 'pilot' as const,
});
const journal = Object.freeze({ correlationId: 'journal' });

describe('legacy local update state migration', () => {
  it('moves legacy state only after verifying the new store', async () => {
    const fixture = createFixture({ accepted, journal });

    await migrateLegacyLocalUpdateState(fixture.stores as never);

    expect(fixture.currentAccepted.value).toEqual(accepted);
    expect(fixture.currentJournal.value).toEqual(journal);
    expect(fixture.legacyAccepted.clear).toHaveBeenCalledTimes(1);
    expect(fixture.legacyJournal.clear).toHaveBeenCalledTimes(1);
  });

  it('finishes cleanup idempotently after an interrupted verified write', async () => {
    const fixture = createFixture({ accepted, journal });
    fixture.currentAccepted.value = accepted;
    fixture.currentJournal.value = journal;

    await migrateLegacyLocalUpdateState(fixture.stores as never);
    await migrateLegacyLocalUpdateState(fixture.stores as never);

    expect(fixture.currentAccepted.write).not.toHaveBeenCalled();
    expect(fixture.currentJournal.write).not.toHaveBeenCalled();
    expect(fixture.legacyAccepted.clear).toHaveBeenCalledTimes(1);
    expect(fixture.legacyJournal.clear).toHaveBeenCalledTimes(1);
  });

  it('fails closed when current and legacy values conflict', async () => {
    const fixture = createFixture({ accepted, journal });
    fixture.currentAccepted.value = { ...accepted, buildRevision: '1234567' };

    await expect(
      migrateLegacyLocalUpdateState(fixture.stores as never),
    ).rejects.toThrow('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
    expect(fixture.legacyAccepted.clear).not.toHaveBeenCalled();
  });

  it('does not clear legacy state when new-state verification fails', async () => {
    const fixture = createFixture({ accepted, journal });
    fixture.currentAccepted.readAfterWrite = undefined;

    await expect(
      migrateLegacyLocalUpdateState(fixture.stores as never),
    ).rejects.toThrow('LOCAL_UPDATE_STATE_MIGRATION_FAILED');
    expect(fixture.legacyAccepted.clear).not.toHaveBeenCalled();
  });
});

function createFixture(input: { accepted: unknown; journal: unknown }) {
  const currentAccepted = createStore(undefined);
  const currentJournal = createStore(undefined);
  const legacyAccepted = createStore(input.accepted);
  const legacyJournal = createStore(input.journal);
  return {
    currentAccepted,
    currentJournal,
    legacyAccepted,
    legacyJournal,
    stores: {
      acceptedBuild: { current: currentAccepted, legacy: legacyAccepted },
      journal: { current: currentJournal, legacy: legacyJournal },
    },
  };
}

function createStore(initial: unknown) {
  const store = {
    value: initial,
    readAfterWrite: Symbol('default') as unknown,
    clear: vi.fn(async () => {
      store.value = undefined;
    }),
    read: vi.fn(async () =>
      store.readAfterWrite === undefined
        ? undefined
        : store.value,
    ),
    write: vi.fn(async (value: unknown) => {
      store.value = value;
    }),
  };
  return store;
}
