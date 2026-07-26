import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { maintainIncidentIndex } from './incidentIndexRetention.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('maintainIncidentIndex', () => {
  it('removes index files older than ten years without deleting the active year', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-incident-retention-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const directory = join(logsRoot, 'incident-index');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'backend-incident-index-2015.jsonl'),
      'x\n',
    );
    writeFileSync(
      join(directory, 'desktop-incident-index-2026.jsonl'),
      'y\n',
    );

    expect(
      maintainIncidentIndex({
        activeYear: 2026,
        logsRoot,
        now: new Date('2026-07-26T20:00:00.000Z'),
      }),
    ).toEqual({
      deletedByteCount: 2,
      deletedFileCount: 1,
      totalByteCount: 2,
    });
  });
});
