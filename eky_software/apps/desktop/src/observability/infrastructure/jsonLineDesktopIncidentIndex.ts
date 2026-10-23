import {
  appendFileSync,
  lstatSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { DesktopOperationalEvent } from '../desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../desktopOperationalLogger.js';
import {
  desktopIncidentIndexBudgetBytes,
  maintainDesktopIncidentIndex,
} from './desktopIncidentIndexRetention.js';

export interface DesktopIncidentIndexEntry {
  schemaVersion: 1;
  appVersion: string;
  buildRevision: string;
  component: 'desktop';
  errorCode: string;
  eventName: string;
  fingerprint: string;
  outcome: DesktopOperationalEvent['outcome'];
  timestamp: string;
}

export class DesktopIncidentIndexingOperationalLogger
  implements DesktopOperationalLogger
{
  readonly #detailedLogger: DesktopOperationalLogger;
  readonly #logsRoot: string;

  constructor(
    detailedLogger: DesktopOperationalLogger,
    logsRoot: string,
  ) {
    this.#detailedLogger = detailedLogger;
    this.#logsRoot = requireAbsoluteRoot(logsRoot);
  }

  write(event: DesktopOperationalEvent): void {
    this.#detailedLogger.write(event);

    if (event.level !== 'error' && event.category !== 'security') {
      return;
    }

    const errorCode = 'errorCode' in event
      ? event.errorCode : 'DESKTOP_SECURITY_EVENT_BLOCKED';
    writeDesktopIncidentIndexEntry(this.#logsRoot, {
      schemaVersion: 1,
      appVersion: event.appVersion,
      buildRevision: event.buildRevision,
      component: 'desktop',
      errorCode,
      eventName: event.eventName,
      fingerprint: 'fingerprint' in event && event.fingerprint !== undefined
        ? event.fingerprint : `${event.eventName}:${errorCode}`,
      outcome: event.outcome,
      timestamp: event.timestamp,
    });
  }
}

// Shared only by normal incident projection and the nonrecursive writer fallback.
export function writeDesktopIncidentIndexEntry(
  logsRoot: string,
  entry: DesktopIncidentIndexEntry,
): void {
  try {
    const directory = join(logsRoot, 'incident-index');
    mkdirSync(directory, { mode: 0o700, recursive: true });
    const directoryStats = lstatSync(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      return;
    }

    const line = `${JSON.stringify(entry)}\n`;
    const year = Number(entry.timestamp.slice(0, 4));
    const maintenance = maintainDesktopIncidentIndex({
      activeYear: year,
      logsRoot,
    });

    if (
      maintenance.totalByteCount +
        Buffer.byteLength(line, 'utf8') >
      desktopIncidentIndexBudgetBytes
    ) {
      return;
    }

    appendFileSync(
      join(
        directory,
        `desktop-incident-index-${entry.timestamp.slice(0, 4)}.jsonl`,
      ),
      line,
      { encoding: 'utf8', flag: 'a', mode: 0o600 },
    );
  } catch {
    // The minimal incident index must never change runtime behavior.
  }
}

function requireAbsoluteRoot(logsRoot: string): string {
  const absolute = resolve(logsRoot);
  if (absolute !== logsRoot) {
    throw new Error('Desktop incident index root must be absolute.');
  }
  return absolute;
}
