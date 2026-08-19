import { describe, expect, it } from 'vitest';

import {
  assertWorkspaceSwitchTransition,
  parseWorkspaceSwitchJournalBytes,
  serializeWorkspaceSwitchJournal,
  validateWorkspaceSwitchJournal,
  WorkspaceSwitchJournalStore,
} from './workspaceSwitchJournal.js';
import {
  createSwitchJournal,
  TEST_SWITCH_OPERATION_ID,
} from './workspaceSwitchTestSupport.js';

describe('workspace switch journal codec', () => {
  it('serializes and parses only canonical bytes', () => {
    const journal = createSwitchJournal('prepared');
    const bytes = serializeWorkspaceSwitchJournal(journal);

    expect(parseWorkspaceSwitchJournalBytes(bytes)).toEqual(journal);
    expect(Object.isFrozen(parseWorkspaceSwitchJournalBytes(bytes))).toBe(true);
    expect(() =>
      parseWorkspaceSwitchJournalBytes(
        encode(JSON.stringify(journal, null, 2)),
      ),
    ).toThrowError('WORKSPACE_SWITCH_INVALID');
  });

  it.each([
    `{"formatVersion":1,"operationId":"${TEST_SWITCH_OPERATION_ID}",` +
      `"operationId":"${TEST_SWITCH_OPERATION_ID}",` +
      '"sourceWorkspaceId":"11111111-1111-4111-8111-111111111111",' +
      '"targetWorkspaceId":"22222222-2222-4222-8222-222222222222",' +
      '"state":"prepared","createdAt":"2026-08-19T10:00:00.000Z"}',
    `{"formatVersion":1,"operationId":"${TEST_SWITCH_OPERATION_ID}",` +
      '"sourceWorkspaceId":"11111111-1111-4111-8111-111111111111",' +
      '"targetWorkspaceId":"22222222-2222-4222-8222-222222222222",' +
      '"state":"prepared","createdAt":"2026-08-19T10:00:00.000Z",' +
      '"st\\u0061te":"prepared"}',
  ])('rejects duplicate decoded JSON keys', (source) => {
    expect(() => parseWorkspaceSwitchJournalBytes(encode(source)))
      .toThrowError('WORKSPACE_SWITCH_INVALID');
  });

  it('rejects unknown fields, equal workspace ids and invalid identifiers', () => {
    expect(() => validateWorkspaceSwitchJournal({
      ...createSwitchJournal('prepared'),
      unknown: true,
    })).toThrowError('WORKSPACE_SWITCH_INVALID');
    expect(() => validateWorkspaceSwitchJournal({
      ...createSwitchJournal('prepared'),
      targetWorkspaceId: createSwitchJournal('prepared').sourceWorkspaceId,
    })).toThrowError('WORKSPACE_SWITCH_INVALID');
    expect(() => validateWorkspaceSwitchJournal({
      ...createSwitchJournal('prepared'),
      operationId: 'invalid',
    })).toThrowError('WORKSPACE_SWITCH_INVALID');
  });
});

describe('workspace switch journal transitions', () => {
  it('allows only safe forward and recovery transitions', () => {
    const prepared = createSwitchJournal('prepared');
    expect(() => assertWorkspaceSwitchTransition(undefined, prepared))
      .not.toThrow();
    expect(() => assertWorkspaceSwitchTransition(
      prepared,
      createSwitchJournal('targetSelected'),
    )).not.toThrow();
    expect(() => assertWorkspaceSwitchTransition(
      createSwitchJournal('targetSelected'),
      createSwitchJournal('rollbackSelected'),
    )).not.toThrow();
    expect(() => assertWorkspaceSwitchTransition(
      createSwitchJournal('rollbackSelected'),
      createSwitchJournal('recoveryRequired'),
    )).not.toThrow();
  });

  it('rejects invalid initial, reverse and identity-changing transitions', () => {
    expect(() => assertWorkspaceSwitchTransition(
      undefined,
      createSwitchJournal('targetSelected'),
    )).toThrowError('WORKSPACE_SWITCH_INVALID');
    expect(() => assertWorkspaceSwitchTransition(
      createSwitchJournal('rollbackSelected'),
      createSwitchJournal('targetSelected'),
    )).toThrowError('WORKSPACE_SWITCH_INVALID');
    expect(() => assertWorkspaceSwitchTransition(
      createSwitchJournal('prepared'),
      {
        ...createSwitchJournal('targetSelected'),
        operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    )).toThrowError('WORKSPACE_SWITCH_INVALID');
  });
});

describe('workspace switch journal root validation', () => {
  it('rejects a relative user data root', () => {
    expect(() => new WorkspaceSwitchJournalStore('relative'))
      .toThrowError('WORKSPACE_SWITCH_STORAGE_FAILED');
  });
});

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
