import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  LongTermIncidentIndex,
  LongTermIncidentIndexEntry,
} from '../longTermIncidentIndex.js';
import {
  incidentIndexBudgetBytes,
  maintainIncidentIndex,
} from './incidentIndexRetention.js';

const safeTextPattern = /^[A-Za-z0-9._:-]+$/;

export class JsonLineIncidentIndex implements LongTermIncidentIndex {
  readonly #logsRoot: string;

  constructor(logsRoot: string) {
    this.#logsRoot = requireAbsoluteRoot(logsRoot);
  }

  write(entry: LongTermIncidentIndexEntry): void {
    try {
      const validated = validateEntry(entry);
      const directory = join(this.#logsRoot, 'incident-index');
      mkdirSync(directory, { mode: 0o700, recursive: true });
      const directoryStats = lstatSync(directory);
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        return;
      }

      const year = validated.timestamp.slice(0, 4);
      const filePath = join(
        directory,
        `backend-incident-index-${year}.jsonl`,
      );
      const line = `${JSON.stringify(validated)}\n`;
      const currentSize = readSafeFileSize(filePath);
      const maintenance = maintainIncidentIndex({
        activeYear: Number(year),
        logsRoot: this.#logsRoot,
      });
      if (
        maintenance.totalByteCount + Buffer.byteLength(line, 'utf8') >
          incidentIndexBudgetBytes ||
        currentSize + Buffer.byteLength(line, 'utf8') >
          incidentIndexBudgetBytes
      ) {
        return;
      }

      appendFileSync(filePath, line, {
        encoding: 'utf8',
        flag: 'a',
        mode: 0o600,
      });
    } catch {
      // The incident index is diagnostic and never changes business outcomes.
    }
  }
}

function validateEntry(
  entry: LongTermIncidentIndexEntry,
): LongTermIncidentIndexEntry {
  if (
    entry.component !== 'backend' ||
    !['blocked', 'failure', 'unknown'].includes(entry.outcome) ||
    !isSafeText(entry.appVersion, 80) ||
    !isSafeText(entry.errorCode, 120) ||
    !isSafeText(entry.eventName, 120) ||
    !isSafeText(entry.fingerprint, 200) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
      entry.timestamp,
    )
  ) {
    throw new Error('Incident index entry is invalid.');
  }

  return Object.freeze({ ...entry });
}

function readSafeFileSize(filePath: string): number {
  try {
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Incident index target is not a safe regular file.');
    }
    return statSync(filePath).size;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return 0;
    }
    throw error;
  }
}

function isSafeText(value: string, maximumLength: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    safeTextPattern.test(value)
  );
}

function requireAbsoluteRoot(logsRoot: string): string {
  if (resolve(logsRoot) !== logsRoot) {
    throw new Error('Incident index root must be absolute and normalized.');
  }
  return logsRoot;
}
