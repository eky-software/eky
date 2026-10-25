import {
  sameCrashSafeFileSlotIdentity,
  type CrashSafeFileSlotIdentity,
  type CrashSafeFileSlot,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotNextWriter,
  type CrashSafeFileSlotMutationGuard,
} from './crashSafeFileSlot.js';

export type SelectedByteSlots = Readonly<Record<CrashSafeFileSlot, Uint8Array | undefined>>;
export type SelectedSlotIdentities = Readonly<Record<CrashSafeFileSlot, Readonly<CrashSafeFileSlotIdentity> | undefined>>;

export interface CrashSafeByteSlotSelection {
  readonly expectedSlots: SelectedByteSlots;
  readonly expectedIdentities: SelectedSlotIdentities;
  assertAuthority(): void;
  assertExternalSelection(): Promise<void>;
}

export class CrashSafeByteSlotStoreError extends Error {
  constructor() {
    super('CRASH_SAFE_BYTE_SLOT_UNAVAILABLE');
    this.name = 'CrashSafeByteSlotStoreError';
  }
}

export class CrashSafeByteSlotStore {
  constructor(
    private readonly fileSystem: CrashSafeFileSlotFileSystem,
  ) {}

  // Selected operations never infer admission or roll back on a lost reply.
  // The owning journal supplies semantic admission and live external guards.
  async replaceSelected(bytes: Uint8Array, selection: CrashSafeByteSlotSelection): Promise<void> {
    const selected = captureSelectedSlots(selection);
    if (selected.slots.next !== undefined || selected.slots.backup !== undefined) {
      throw new CrashSafeByteSlotStoreError();
    }
    const content = Uint8Array.from(bytes);
    const guard = this.selectedGuard(selected);
    await guard.beforeMutation();
    await this.fileSystem.prepareDirectory(guard);
    const writer = await this.fileSystem.createNextWriter(guard);
    let failure: unknown;
    let failed = false;
    let createdIdentity: CrashSafeFileSlotIdentity | undefined;
    try {
      guard.assertAuthority();
      if (await writer.write(content) !== content.byteLength) throw new CrashSafeByteSlotStoreError();
      guard.assertAuthority();
      await writer.sync();
      guard.assertAuthority();
      if (writer.readIdentity === undefined) throw new CrashSafeByteSlotStoreError();
      createdIdentity = await writer.readIdentity();
      guard.assertAuthority();
    } catch (error) { failed = true; failure = error; }
    try { await writer.close(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'CRASH_SAFE_BYTE_SLOT_UNAVAILABLE');
      throw error;
    }
    if (failed) throw failure;
    selected.slots.next = content;
    selected.identities.next = await this.readOwnedIdentity('next', createdIdentity!, content, selected.assertAuthority, true);
    await guard.beforeMutation();
    if (selected.slots.current !== undefined) {
      await this.moveSelected('current', 'backup', selected, guard);
    }
    await this.moveSelected('next', 'current', selected, guard);
    await this.fileSystem.syncDirectory(guard);
    if (selected.slots.backup !== undefined) {
      if (!await this.fileSystem.removeSlot('backup', guard)) throw new CrashSafeByteSlotStoreError();
      selected.slots.backup = undefined;
      selected.identities.backup = undefined;
      await this.fileSystem.syncDirectory(guard);
    }
    await guard.beforeMutation();
  }

  async recoverSelected(selection: CrashSafeByteSlotSelection): Promise<void> {
    const selected = captureSelectedSlots(selection);
    const guard = this.selectedGuard(selected);
    if ((selected.slots.current === undefined && selected.slots.backup === undefined) ||
        (selected.slots.current !== undefined && selected.slots.next !== undefined && selected.slots.backup !== undefined)) {
      throw new CrashSafeByteSlotStoreError();
    }
    await guard.beforeMutation();
    if (selected.slots.next !== undefined) {
      if (!await this.fileSystem.removeSlot('next', guard)) throw new CrashSafeByteSlotStoreError();
      selected.slots.next = undefined;
      selected.identities.next = undefined;
    }
    if (selected.slots.current === undefined) {
      await this.moveSelected('backup', 'current', selected, guard);
    } else if (selected.slots.backup !== undefined) {
      if (!await this.fileSystem.removeSlot('backup', guard)) throw new CrashSafeByteSlotStoreError();
      selected.slots.backup = undefined;
      selected.identities.backup = undefined;
    }
    await this.fileSystem.syncDirectory(guard);
    await guard.beforeMutation();
  }

  async clearSelected(selection: CrashSafeByteSlotSelection): Promise<void> {
    const selected = captureSelectedSlots(selection);
    const guard = this.selectedGuard(selected);
    await guard.beforeMutation();
    for (const slot of ['next', 'backup', 'current'] as const) {
      if (selected.slots[slot] === undefined) continue;
      if (!await this.fileSystem.removeSlot(slot, guard)) throw new CrashSafeByteSlotStoreError();
      selected.slots[slot] = undefined;
      selected.identities[slot] = undefined;
    }
    await this.fileSystem.syncDirectory(guard);
    await guard.beforeMutation();
  }

  private selectedGuard(selected: ReturnType<typeof captureSelectedSlots>): CrashSafeFileSlotMutationGuard {
    const assertAuthority = selected.assertAuthority;
    return {
      assertAuthority,
      beforeMutation: async () => {
        assertAuthority();
        await selected.assertExternalSelection();
        assertAuthority();
        for (const slot of ['current', 'next', 'backup'] as const) {
          let identity: CrashSafeFileSlotIdentity | undefined;
          const actual = await this.fileSystem.readSlot(slot, value => { identity = value; });
          assertAuthority();
          const expected = selected.slots[slot];
          if (expected === undefined ? actual !== undefined : actual === undefined ||
            expected.byteLength !== actual.byteLength || !expected.every((value, index) => value === actual[index])) {
            throw new CrashSafeByteSlotStoreError();
          }
          const expectedIdentity = selected.identities[slot];
          if (expected !== undefined && (expectedIdentity === undefined || identity === undefined ||
            !sameCrashSafeFileSlotIdentity(expectedIdentity, identity))) throw new CrashSafeByteSlotStoreError();
        }
        await selected.assertExternalSelection();
        assertAuthority();
      },
    };
  }

  private async moveSelected(
    source: CrashSafeFileSlot, destination: CrashSafeFileSlot,
    selected: ReturnType<typeof captureSelectedSlots>, guard: CrashSafeFileSlotMutationGuard,
  ): Promise<void> {
    const content = selected.slots[source];
    const identity = selected.identities[source];
    if (content === undefined || identity === undefined) throw new CrashSafeByteSlotStoreError();
    await this.fileSystem.moveSlot(source, destination, guard);
    selected.identities[destination] = await this.readOwnedIdentity(destination, identity, content, selected.assertAuthority, false);
    selected.slots[destination] = content;
    selected.slots[source] = undefined;
    selected.identities[source] = undefined;
  }

  private async readOwnedIdentity(
    slot: CrashSafeFileSlot, original: CrashSafeFileSlotIdentity, content: Uint8Array,
    assertAuthority: () => void, newlyWritten: boolean,
  ): Promise<CrashSafeFileSlotIdentity> {
    assertAuthority();
    let identity: CrashSafeFileSlotIdentity | undefined;
    const actual = await this.fileSystem.readSlot(slot, value => { identity = value; });
    assertAuthority();
    if (identity === undefined || original.ino === 0 || identity.ino !== original.ino || identity.dev !== original.dev ||
      identity.size !== content.byteLength || (!newlyWritten && identity.mtimeMs !== original.mtimeMs) ||
      actual === undefined || actual.byteLength !== content.byteLength || !content.every((value, index) => value === actual[index])) {
      throw new CrashSafeByteSlotStoreError();
    }
    return identity;
  }

  async recoverAndRead<T>(
    validateBytes: (bytes: Uint8Array) => T,
  ): Promise<T | undefined> {
    const selected = await this.inspect(validateBytes);
    if (selected === undefined) return undefined;

    if (selected.slot === 'current') {
      const removedNext = await this.fileSystem.removeSlot('next');
      const removedBackup = await this.fileSystem.removeSlot('backup');
      if (removedNext || removedBackup) await this.fileSystem.syncDirectory();
    } else if (selected.slot === 'backup') {
      await this.fileSystem.removeSlot('next');
      await this.fileSystem.moveSlot('backup', 'current');
      await this.fileSystem.syncDirectory();
    } else {
      await this.fileSystem.moveSlot('next', 'current');
      await this.fileSystem.syncDirectory();
    }
    return selected.value;
  }

  // Inspect uses the same authority as recovery, but never repairs its slots.
  async inspect<T>(
    validateBytes: (bytes: Uint8Array) => T,
  ): Promise<Readonly<{ slot: CrashSafeFileSlot; value: T }> | undefined> {
    for (const slot of ['current', 'backup', 'next'] as const) {
      const bytes = await this.fileSystem.readSlot(slot);
      if (bytes !== undefined) {
        return Object.freeze({ slot, value: validateBytes(bytes) });
      }
    }
    return undefined;
  }

  async replace(
    bytes: Uint8Array,
    hadCurrentValue: boolean,
  ): Promise<void> {
    await this.fileSystem.prepareDirectory();

    let writer: CrashSafeFileSlotNextWriter | undefined;
    let currentMovedToBackup = false;
    let nextPublished = false;
    try {
      writer = await this.fileSystem.createNextWriter();
      const bytesWritten = await writer.write(bytes);
      if (bytesWritten !== bytes.byteLength) {
        throw new CrashSafeByteSlotStoreError();
      }
      await writer.sync();
      await writer.close();
      writer = undefined;

      if (hadCurrentValue) {
        await this.fileSystem.moveSlot('current', 'backup');
        currentMovedToBackup = true;
      }
      try {
        await this.fileSystem.moveSlot('next', 'current');
        nextPublished = true;
      } catch (error) {
        if (currentMovedToBackup) await this.restoreBackupBestEffort();
        throw error;
      }
      await this.fileSystem.syncDirectory();
      if (currentMovedToBackup) {
        await this.fileSystem.removeSlot('backup');
        await this.fileSystem.syncDirectory();
      }
    } finally {
      await writer?.close().catch(() => undefined);
      if (!nextPublished) {
        await this.fileSystem.removeSlot('next').catch(() => undefined);
      }
    }
  }

  async clear(): Promise<void> {
    await this.fileSystem.removeSlot('next');
    await this.fileSystem.removeSlot('backup');
    await this.fileSystem.removeSlot('current');
    await this.fileSystem.syncDirectory();
  }

  private async restoreBackupBestEffort(): Promise<void> {
    try {
      await this.fileSystem.moveSlot('backup', 'current');
      await this.fileSystem.syncDirectory();
    } catch {
      // The owning journal or registry validates recovery on the next read.
    }
  }
}

function captureSelectedSlots(selection: CrashSafeByteSlotSelection) {
  if (typeof selection.assertAuthority !== 'function' || typeof selection.assertExternalSelection !== 'function') {
    throw new CrashSafeByteSlotStoreError();
  }
  const authority = selection.assertAuthority.bind(selection);
  const slots: Record<CrashSafeFileSlot, Uint8Array | undefined> = { current: undefined, next: undefined, backup: undefined };
  const identities: Record<CrashSafeFileSlot, CrashSafeFileSlotIdentity | undefined> = { current: undefined, next: undefined, backup: undefined };
  for (const slot of ['current', 'next', 'backup'] as const) {
    const bytes = selection.expectedSlots[slot];
    const identity = selection.expectedIdentities[slot];
    if (bytes !== undefined) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw new CrashSafeByteSlotStoreError();
      slots[slot] = Uint8Array.from(bytes);
      if (identity === undefined || identity.ino === 0 || identity.size !== bytes.byteLength ||
        ![identity.dev, identity.ino, identity.size, identity.mtimeMs, identity.ctimeMs].every(Number.isFinite)) {
        throw new CrashSafeByteSlotStoreError();
      }
      identities[slot] = Object.freeze({ ...identity });
    } else if (identity !== undefined) {
      throw new CrashSafeByteSlotStoreError();
    }
  }
  return {
    slots,
    identities,
    assertExternalSelection: selection.assertExternalSelection.bind(selection),
    assertAuthority() {
      const result: unknown = authority();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new CrashSafeByteSlotStoreError();
      }
    },
  };
}
