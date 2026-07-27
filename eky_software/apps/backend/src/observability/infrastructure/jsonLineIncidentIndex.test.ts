import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsonLineIncidentIndex } from './jsonLineIncidentIndex.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('JsonLineIncidentIndex', () => {
  it('writes only the minimal anonymous incident projection', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-incident-'));
    temporaryDirectories.push(root);
    const index = new JsonLineIncidentIndex(join(root, 'logs'));

    index.write({
      appVersion: '0.0.0',
      buildRevision: '123456789abc',
      component: 'backend',
      errorCode: 'DATABASE_OPEN_FAILED',
      eventName: 'database.openFailed',
      fingerprint: 'database.openFailed:DATABASE_OPEN_FAILED',
      outcome: 'failure',
      timestamp: '2026-07-26T20:00:00.000Z',
    });

    const line = readFileSync(
      join(
        root,
        'logs',
        'incident-index',
        'backend-incident-index-2026.jsonl',
      ),
      'utf8',
    );
    expect(JSON.parse(line)).toEqual({
      appVersion: '0.0.0',
      buildRevision: '123456789abc',
      component: 'backend',
      errorCode: 'DATABASE_OPEN_FAILED',
      eventName: 'database.openFailed',
      fingerprint: 'database.openFailed:DATABASE_OPEN_FAILED',
      outcome: 'failure',
      timestamp: '2026-07-26T20:00:00.000Z',
    });
    expect(line).not.toContain('companyId');
    expect(line).not.toContain('entityId');
    expect(line).not.toContain('actorUserId');
    expect(line).not.toContain('runtimeInstanceId');
  });

  it('drops malformed entries without throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'eky-incident-'));
    temporaryDirectories.push(root);
    const index = new JsonLineIncidentIndex(join(root, 'logs'));

    expect(() =>
      index.write({
        appVersion: '0.0.0',
        buildRevision: '123456789abc',
        component: 'backend',
        errorCode: 'person@example.test',
        eventName: 'database.openFailed',
        fingerprint: 'unsafe',
        outcome: 'failure',
        timestamp: '2026-07-26T20:00:00.000Z',
      }),
    ).not.toThrow();
  });
});
