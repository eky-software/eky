import type {
  CrashSafeFileSlotFileSystem,
  CrashSafeFileSlotNextWriter,
} from './crashSafeFileSlot.js';

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

  async recoverAndRead<T>(
    validateBytes: (bytes: Uint8Array) => T,
  ): Promise<T | undefined> {
    const currentBytes = await this.fileSystem.readSlot('current');
    if (currentBytes !== undefined) {
      const current = validateBytes(currentBytes);
      const removedNext = await this.fileSystem.removeSlot('next');
      const removedBackup = await this.fileSystem.removeSlot('backup');
      if (removedNext || removedBackup) await this.fileSystem.syncDirectory();
      return current;
    }

    const backupBytes = await this.fileSystem.readSlot('backup');
    if (backupBytes !== undefined) {
      const backup = validateBytes(backupBytes);
      await this.fileSystem.removeSlot('next');
      await this.fileSystem.moveSlot('backup', 'current');
      await this.fileSystem.syncDirectory();
      return backup;
    }

    const nextBytes = await this.fileSystem.readSlot('next');
    if (nextBytes !== undefined) {
      const next = validateBytes(nextBytes);
      await this.fileSystem.moveSlot('next', 'current');
      await this.fileSystem.syncDirectory();
      return next;
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
