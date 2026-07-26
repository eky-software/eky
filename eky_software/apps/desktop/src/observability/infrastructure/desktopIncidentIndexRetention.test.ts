import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { maintainDesktopIncidentIndex } from './desktopIncidentIndexRetention.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('maintainDesktopIncidentIndex', () => {
  it('removes incident files older than ten years without touching unknown files', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-incident-retention-'));
    temporaryDirectories.push(root);
    const logsRoot = join(root, 'logs');
    const directory = join(logsRoot, 'incident-index');
    mkdirSync(directory, { recursive: true });
    const expired = join(directory, 'desktop-incident-index-2015.jsonl');
    const retained = join(directory, 'backend-incident-index-2016.jsonl');
    const unknown = join(directory, 'notes.txt');
    writeFileSync(expired, 'expired\n');
    writeFileSync(retained, 'retained\n');
    writeFileSync(unknown, 'unknown\n');

    const result = maintainDesktopIncidentIndex({
      logsRoot,
      now: new Date('2026-07-26T20:00:00.000Z'),
    });

    expect(result.deletedFileCount).toBe(1);
    expect(() => readFileSync(expired)).toThrow();
    expect(readFileSync(retained, 'utf8')).toBe('retained\n');
    expect(readFileSync(unknown, 'utf8')).toBe('unknown\n');
  });
});
