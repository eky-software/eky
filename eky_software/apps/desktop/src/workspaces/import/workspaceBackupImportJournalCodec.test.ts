import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES,
  parseWorkspaceBackupImportJournalBytes,
} from './workspaceBackupImportJournalBytes.js';
import {
  WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID,
  WorkspaceBackupImportJournalValidationError,
} from './workspaceBackupImportJournalError.js';
import {
  generateWorkspaceBackupImportOperationId,
  validateWorkspaceBackupImportOperationId,
} from './workspaceBackupImportOperationId.js';
import {
  assertCanonicalWorkspaceBackupImportJournalRoundTrip,
  serializeWorkspaceBackupImportJournal,
} from './workspaceBackupImportJournalSerializer.js';
import type {
  WorkspaceBackupImportJournalState,
  WorkspaceBackupImportJournalV1,
} from './workspaceBackupImportTypes.js';
import {
  assertWorkspaceBackupImportJournalTransition,
  validateWorkspaceBackupImportJournal,
} from './workspaceBackupImportJournalValidation.js';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const previousWorkspaceId = '22222222-2222-4222-8222-222222222222';
const profileId = 'a'.repeat(64);

describe('workspace backup import journal codec', () => {
  it('serializes canonically, parses strictly and freezes validated data', () => {
    const journal = createJournal('candidateValidated');
    const bytes = serializeWorkspaceBackupImportJournal(journal);
    const expected =
      `{"formatVersion":1,"operationId":"${operationId}",` +
      `"workspaceId":"${workspaceId}","workspaceLabel":"Tuotu yritys",` +
      `"previousActiveWorkspaceId":"${previousWorkspaceId}",` +
      '"state":"candidateValidated",' +
      '"createdAt":"2026-08-18T10:00:00.000Z",' +
      `"lineageIdentity":{"formatVersion":1,"profileId":"${profileId}"}}\n`;

    expect(new TextDecoder().decode(bytes)).toBe(expected);
    const parsed = parseWorkspaceBackupImportJournalBytes(bytes);
    expect(parsed).toEqual(journal);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.lineageIdentity)).toBe(true);
    expect(assertCanonicalWorkspaceBackupImportJournalRoundTrip(bytes)).toEqual(
      parsed,
    );
  });

  it('generates and validates only canonical lowercase UUID v4 operation ids', () => {
    expect(generateWorkspaceBackupImportOperationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(validateWorkspaceBackupImportOperationId(operationId)).toBe(
      operationId,
    );
    expectInvalid(() =>
      validateWorkspaceBackupImportOperationId(operationId.toUpperCase()),
    );
    expectInvalid(() =>
      validateWorkspaceBackupImportOperationId(
        '11111111-1111-1111-8111-111111111111',
      ),
    );
  });

  it('rejects empty, oversized, malformed and invalid UTF-8 input', () => {
    expectInvalid(() =>
      parseWorkspaceBackupImportJournalBytes(new Uint8Array()),
    );
    expectInvalid(() =>
      parseWorkspaceBackupImportJournalBytes(new Uint8Array([0xc3, 0x28])),
    );
    expectInvalid(() => parseWorkspaceBackupImportJournalBytes(encode('{')));
    expectInvalid(() =>
      parseWorkspaceBackupImportJournalBytes(
        new Uint8Array(WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES + 1),
      ),
    );
  });

  it.each([
    [
      'root key',
      `{"formatVersion":1,"operationId":"${operationId}",` +
        `"operationId":"${operationId}","workspaceId":"${workspaceId}",` +
        '"workspaceLabel":"Tuotu yritys","previousActiveWorkspaceId":null,' +
        '"state":"prepared","createdAt":"2026-08-18T10:00:00.000Z",' +
        '"lineageIdentity":null}',
    ],
    [
      'lineage key',
      `{"formatVersion":1,"operationId":"${operationId}",` +
        `"workspaceId":"${workspaceId}","workspaceLabel":"Tuotu yritys",` +
        '"previousActiveWorkspaceId":null,"state":"candidateValidated",' +
        '"createdAt":"2026-08-18T10:00:00.000Z",' +
        `"lineageIdentity":{"formatVersion":1,"profileId":"${profileId}",` +
        `"profileId":"${profileId}"}}`,
    ],
    [
      'escaped decoded key',
      `{"formatVersion":1,"operationId":"${operationId}",` +
        `"workspaceId":"${workspaceId}","workspaceLabel":"Tuotu yritys",` +
        '"previousActiveWorkspaceId":null,"state":"prepared",' +
        '"createdAt":"2026-08-18T10:00:00.000Z","lineageIdentity":null,' +
        '"work\\u0073paceLabel":"Tuotu yritys"}',
    ],
  ])('rejects duplicate JSON %s', (_description, source) => {
    expectInvalid(() => parseWorkspaceBackupImportJournalBytes(encode(source)));
  });

  it('rejects unknown, accessor and prototype-pollution fields', () => {
    expectInvalid(() =>
      validateWorkspaceBackupImportJournal({
        ...createJournal('prepared'),
        unknown: true,
      }),
    );
    const source = new TextDecoder()
      .decode(serializeWorkspaceBackupImportJournal(createJournal('prepared')))
      .trimEnd();
    expectInvalid(() =>
      parseWorkspaceBackupImportJournalBytes(
        encode(`${source.slice(0, -1)},"__proto__":{"polluted":true}}`),
      ),
    );

    const accessor = createJournal('prepared') as Record<string, unknown>;
    Object.defineProperty(accessor, 'workspaceLabel', {
      enumerable: true,
      get: () => 'Tuotu yritys',
    });
    expectInvalid(() => validateWorkspaceBackupImportJournal(accessor));
  });

  it('requires lineage exactly from candidate validation onwards', () => {
    expectInvalid(() =>
      validateWorkspaceBackupImportJournal({
        ...createJournal('backupStaged'),
        lineageIdentity: { formatVersion: 1, profileId },
      }),
    );
    expectInvalid(() =>
      validateWorkspaceBackupImportJournal({
        ...createJournal('candidateValidated'),
        lineageIdentity: null,
      }),
    );
  });

  it('rejects noncanonical bytes in the explicit round-trip check', () => {
    expectInvalid(() =>
      assertCanonicalWorkspaceBackupImportJournalRoundTrip(
        encode(JSON.stringify(createJournal('prepared'), null, 2)),
      ),
    );
  });
});

describe('workspace backup import journal transitions', () => {
  it('accepts only prepared as the first state', () => {
    expect(() =>
      assertWorkspaceBackupImportJournalTransition(
        undefined,
        validateWorkspaceBackupImportJournal(createJournal('prepared')),
      ),
    ).not.toThrow();
    expectInvalid(() =>
      assertWorkspaceBackupImportJournalTransition(
        undefined,
        validateWorkspaceBackupImportJournal(
          createJournal('candidateRootCreated'),
        ),
      ),
    );
  });

  it('accepts idempotent states and each immediate next state', () => {
    for (const [index, state] of states.entries()) {
      const current = validateWorkspaceBackupImportJournal(
        createJournal(state),
      );
      expect(() =>
        assertWorkspaceBackupImportJournalTransition(current, current),
      ).not.toThrow();
      const nextState = states[index + 1];
      if (nextState !== undefined) {
        expect(() =>
          assertWorkspaceBackupImportJournalTransition(
            current,
            validateWorkspaceBackupImportJournal(createJournal(nextState)),
          ),
        ).not.toThrow();
      }
    }
  });

  it('rejects skipped, reversed and immutable-field transitions', () => {
    const prepared = validateWorkspaceBackupImportJournal(
      createJournal('prepared'),
    );
    expectInvalid(() =>
      assertWorkspaceBackupImportJournalTransition(
        prepared,
        validateWorkspaceBackupImportJournal(createJournal('backupStaged')),
      ),
    );
    expectInvalid(() =>
      assertWorkspaceBackupImportJournalTransition(
        validateWorkspaceBackupImportJournal(
          createJournal('candidateValidated'),
        ),
        validateWorkspaceBackupImportJournal(createJournal('backupStaged')),
      ),
    );

    for (const changed of [
      {
        ...createJournal('candidateRootCreated'),
        operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      { ...createJournal('candidateRootCreated'), workspaceId: previousWorkspaceId },
      { ...createJournal('candidateRootCreated'), workspaceLabel: 'Muu yritys' },
      { ...createJournal('candidateRootCreated'), previousActiveWorkspaceId: null },
      {
        ...createJournal('candidateRootCreated'),
        createdAt: '2026-08-18T10:00:01.000Z',
      },
    ]) {
      expectInvalid(() =>
        assertWorkspaceBackupImportJournalTransition(
          prepared,
          validateWorkspaceBackupImportJournal(changed),
        ),
      );
    }
  });

  it('rejects lineage mutation after validation', () => {
    const current = validateWorkspaceBackupImportJournal(
      createJournal('candidateValidated'),
    );
    expectInvalid(() =>
      assertWorkspaceBackupImportJournalTransition(
        current,
        validateWorkspaceBackupImportJournal({
          ...createJournal('rootPublished'),
          lineageIdentity: {
            formatVersion: 1,
            profileId: 'b'.repeat(64),
          },
        }),
      ),
    );
  });
});

const states: readonly WorkspaceBackupImportJournalState[] = [
  'prepared',
  'candidateRootCreated',
  'backupStaged',
  'candidateMigrated',
  'candidateValidated',
  'rootPublished',
  'registryPublished',
];

function createJournal(
  state: WorkspaceBackupImportJournalState,
): Readonly<WorkspaceBackupImportJournalV1> {
  const hasLineage = [
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(state);
  return {
    formatVersion: 1,
    operationId:
      operationId as WorkspaceBackupImportJournalV1['operationId'],
    workspaceId: workspaceId as WorkspaceBackupImportJournalV1['workspaceId'],
    workspaceLabel: 'Tuotu yritys',
    previousActiveWorkspaceId:
      previousWorkspaceId as WorkspaceBackupImportJournalV1['previousActiveWorkspaceId'],
    state,
    createdAt: '2026-08-18T10:00:00.000Z',
    lineageIdentity: hasLineage ? { formatVersion: 1, profileId } : null,
  };
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function expectInvalid(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected workspace backup import journal to be invalid');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceBackupImportJournalValidationError);
    expect((error as Error).message).toBe(
      WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID,
    );
  }
}
