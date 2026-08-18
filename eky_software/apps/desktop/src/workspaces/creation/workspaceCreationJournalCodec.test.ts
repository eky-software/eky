import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_CREATION_JOURNAL_MAX_BYTES,
  parseWorkspaceCreationJournalBytes,
} from './workspaceCreationJournalBytes.js';
import {
  WORKSPACE_CREATION_JOURNAL_INVALID,
  WorkspaceCreationJournalValidationError,
} from './workspaceCreationJournalError.js';
import {
  generateWorkspaceCreationOperationId,
  validateWorkspaceCreationOperationId,
} from './workspaceCreationOperationId.js';
import {
  assertCanonicalWorkspaceCreationJournalRoundTrip,
  serializeWorkspaceCreationJournal,
} from './workspaceCreationJournalSerializer.js';
import type {
  WorkspaceCreationJournalState,
  WorkspaceCreationJournalV1,
} from './workspaceCreationTypes.js';
import {
  assertWorkspaceCreationJournalTransition,
  validateWorkspaceCreationJournal,
} from './workspaceCreationJournalValidation.js';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const previousWorkspaceId = '22222222-2222-4222-8222-222222222222';
const profileId = 'a'.repeat(64);

describe('workspace creation journal codec', () => {
  it('serializes canonically, parses strictly and freezes validated data', () => {
    const journal = createJournal('bootstrapCompleted');
    const bytes = serializeWorkspaceCreationJournal(journal);
    const expected =
      `{"formatVersion":1,"operationId":"${operationId}",` +
      `"workspaceId":"${workspaceId}","workspaceLabel":"Oma yritys",` +
      `"previousActiveWorkspaceId":"${previousWorkspaceId}",` +
      '"state":"bootstrapCompleted",' +
      '"createdAt":"2026-08-18T10:00:00.000Z",' +
      `"lineageIdentity":{"formatVersion":1,"profileId":"${profileId}"}}\n`;

    expect(new TextDecoder().decode(bytes)).toBe(expected);
    const parsed = parseWorkspaceCreationJournalBytes(bytes);
    expect(parsed).toEqual(journal);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.lineageIdentity)).toBe(true);
    expect(assertCanonicalWorkspaceCreationJournalRoundTrip(bytes)).toEqual(
      parsed,
    );
  });

  it('generates and validates only canonical lowercase UUID v4 operation ids', () => {
    expect(generateWorkspaceCreationOperationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(validateWorkspaceCreationOperationId(operationId)).toBe(operationId);
    expectInvalid(() => validateWorkspaceCreationOperationId(operationId.toUpperCase()));
    expectInvalid(() => validateWorkspaceCreationOperationId(
      '11111111-1111-1111-8111-111111111111',
    ));
  });

  it('rejects empty, oversized, malformed and invalid UTF-8 input', () => {
    expectInvalid(() => parseWorkspaceCreationJournalBytes(new Uint8Array()));
    expectInvalid(() => parseWorkspaceCreationJournalBytes(new Uint8Array([0xc3, 0x28])));
    expectInvalid(() => parseWorkspaceCreationJournalBytes(encode('{')));
    expectInvalid(() =>
      parseWorkspaceCreationJournalBytes(
        new Uint8Array(WORKSPACE_CREATION_JOURNAL_MAX_BYTES + 1),
      ),
    );
  });

  it.each([
    [
      'root key',
      `{"formatVersion":1,"operationId":"${operationId}",` +
        `"operationId":"${operationId}","workspaceId":"${workspaceId}",` +
        '"workspaceLabel":"Oma yritys","previousActiveWorkspaceId":null,' +
        '"state":"prepared","createdAt":"2026-08-18T10:00:00.000Z",' +
        '"lineageIdentity":null}',
    ],
    [
      'lineage key',
      `{"formatVersion":1,"operationId":"${operationId}",` +
        `"workspaceId":"${workspaceId}","workspaceLabel":"Oma yritys",` +
        '"previousActiveWorkspaceId":null,"state":"bootstrapCompleted",' +
        '"createdAt":"2026-08-18T10:00:00.000Z",' +
        `"lineageIdentity":{"formatVersion":1,"profileId":"${profileId}",` +
        `"profileId":"${profileId}"}}`,
    ],
    [
      'escaped decoded key',
      `{"formatVersion":1,"operationId":"${operationId}",` +
        `"workspaceId":"${workspaceId}","workspaceLabel":"Oma yritys",` +
        '"previousActiveWorkspaceId":null,"state":"prepared",' +
        '"createdAt":"2026-08-18T10:00:00.000Z","lineageIdentity":null,' +
        '"work\\u0073paceLabel":"Oma yritys"}',
    ],
  ])('rejects duplicate JSON %s', (_description, source) => {
    expectInvalid(() => parseWorkspaceCreationJournalBytes(encode(source)));
  });

  it('rejects unknown, accessor and prototype-pollution fields', () => {
    expectInvalid(() => validateWorkspaceCreationJournal({
      ...createJournal('prepared'),
      unknown: true,
    }));
    const source = new TextDecoder().decode(
      serializeWorkspaceCreationJournal(createJournal('prepared')),
    ).trimEnd();
    expectInvalid(() => parseWorkspaceCreationJournalBytes(encode(
      `${source.slice(0, -1)},"__proto__":{"polluted":true}}`,
    )));

    const accessor = createJournal('prepared') as Record<string, unknown>;
    Object.defineProperty(accessor, 'workspaceLabel', {
      enumerable: true,
      get: () => 'Oma yritys',
    });
    expectInvalid(() => validateWorkspaceCreationJournal(accessor));
  });

  it('requires lineage exactly from bootstrap completion onwards', () => {
    expectInvalid(() => validateWorkspaceCreationJournal({
      ...createJournal('prepared'),
      lineageIdentity: { formatVersion: 1, profileId },
    }));
    expectInvalid(() => validateWorkspaceCreationJournal({
      ...createJournal('bootstrapCompleted'),
      lineageIdentity: null,
    }));
    expect(validateWorkspaceCreationJournal(createJournal('candidateValidated')).state)
      .toBe('candidateValidated');
  });

  it('maps reused registry validators to the journal validation boundary', () => {
    for (const invalid of [
      { ...createJournal('prepared'), workspaceId: 'invalid' },
      { ...createJournal('prepared'), workspaceLabel: ' padded ' },
      { ...createJournal('prepared'), createdAt: 'not-a-timestamp' },
      {
        ...createJournal('bootstrapCompleted'),
        lineageIdentity: { formatVersion: 1, profileId: 'invalid' },
      },
    ]) {
      expectInvalid(() => validateWorkspaceCreationJournal(invalid));
    }
  });

  it('rejects noncanonical bytes in the explicit round-trip check', () => {
    expectInvalid(() => assertCanonicalWorkspaceCreationJournalRoundTrip(
      encode(JSON.stringify(createJournal('prepared'), null, 2)),
    ));
  });
});

describe('workspace creation journal transitions', () => {
  it('accepts only prepared as the first state', () => {
    expect(() => assertWorkspaceCreationJournalTransition(
      undefined,
      validateWorkspaceCreationJournal(createJournal('prepared')),
    )).not.toThrow();
    expectInvalid(() => assertWorkspaceCreationJournalTransition(
      undefined,
      validateWorkspaceCreationJournal(createJournal('bootstrapCompleted')),
    ));
  });

  it('accepts an idempotent state and each immediate next state', () => {
    const states: readonly WorkspaceCreationJournalState[] = [
      'prepared',
      'candidateRootCreated',
      'bootstrapCompleted',
      'candidateValidated',
      'rootPublished',
      'registryPublished',
    ];
    for (const [index, state] of states.entries()) {
      const current = validateWorkspaceCreationJournal(createJournal(state));
      expect(() => assertWorkspaceCreationJournalTransition(current, current))
        .not.toThrow();
      const nextState = states[index + 1];
      if (nextState !== undefined) {
        expect(() => assertWorkspaceCreationJournalTransition(
          current,
          validateWorkspaceCreationJournal(createJournal(nextState)),
        )).not.toThrow();
      }
    }
  });

  it('rejects skipped, reversed and immutable-field transitions', () => {
    const prepared = validateWorkspaceCreationJournal(createJournal('prepared'));
    expectInvalid(() => assertWorkspaceCreationJournalTransition(
      prepared,
      validateWorkspaceCreationJournal(createJournal('bootstrapCompleted')),
    ));
    const validated = validateWorkspaceCreationJournal(
      createJournal('candidateValidated'),
    );
    expectInvalid(() => assertWorkspaceCreationJournalTransition(
      validated,
      validateWorkspaceCreationJournal(createJournal('bootstrapCompleted')),
    ));

    for (const changed of [
      { ...createJournal('candidateRootCreated'), operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { ...createJournal('candidateRootCreated'), workspaceId: previousWorkspaceId },
      { ...createJournal('candidateRootCreated'), workspaceLabel: 'Muu yritys' },
      { ...createJournal('candidateRootCreated'), previousActiveWorkspaceId: null },
      { ...createJournal('candidateRootCreated'), createdAt: '2026-08-18T10:00:01.000Z' },
    ]) {
      expectInvalid(() => assertWorkspaceCreationJournalTransition(
        prepared,
        validateWorkspaceCreationJournal(changed),
      ));
    }
  });

  it('rejects lineage mutation after bootstrap', () => {
    const current = validateWorkspaceCreationJournal(
      createJournal('bootstrapCompleted'),
    );
    expectInvalid(() => assertWorkspaceCreationJournalTransition(
      current,
      validateWorkspaceCreationJournal({
        ...createJournal('candidateValidated'),
        lineageIdentity: { formatVersion: 1, profileId: 'b'.repeat(64) },
      }),
    ));
  });
});

function createJournal(
  state: WorkspaceCreationJournalState,
): Readonly<WorkspaceCreationJournalV1> {
  const hasLineage = [
    'bootstrapCompleted',
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(state);
  return {
    formatVersion: 1,
    operationId: operationId as WorkspaceCreationJournalV1['operationId'],
    workspaceId: workspaceId as WorkspaceCreationJournalV1['workspaceId'],
    workspaceLabel: 'Oma yritys',
    previousActiveWorkspaceId:
      previousWorkspaceId as WorkspaceCreationJournalV1['previousActiveWorkspaceId'],
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
    throw new Error('Expected workspace creation journal validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceCreationJournalValidationError);
    expect((error as Error).message).toBe(WORKSPACE_CREATION_JOURNAL_INVALID);
  }
}
