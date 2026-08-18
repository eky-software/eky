import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_REGISTRY_MAX_BYTES,
  parseWorkspaceRegistryBytes,
} from './workspaceRegistryBytes.js';
import {
  WORKSPACE_REGISTRY_INVALID,
  WorkspaceRegistryValidationError,
} from './workspaceRegistryError.js';
import { generateWorkspaceId } from './workspaceIdGeneration.js';
import {
  assertCanonicalWorkspaceRegistryRoundTrip,
  serializeWorkspaceRegistry,
} from './workspaceRegistrySerializer.js';
import { WORKSPACE_REGISTRY_MAX_ENTRIES } from './workspaceRegistryValidation.js';

const firstWorkspaceId = '11111111-1111-4111-8111-111111111111';
const secondWorkspaceId = '22222222-2222-4222-8222-222222222222';
const firstProfileId = 'a'.repeat(64);
const secondProfileId = 'b'.repeat(64);

describe('workspace registry codec', () => {
  it('parses and deeply freezes an empty registry', () => {
    const registry = parseJson(createRegistry());

    expect(registry).toEqual(createRegistry());
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.workspaces)).toBe(true);
  });

  it('parses one and two workspace registries with duplicate labels', () => {
    const one = parseJson(createRegistry({
      activeWorkspaceId: firstWorkspaceId,
      workspaces: [createEntry()],
    }));
    const two = parseJson(createRegistry({
      activeWorkspaceId: firstWorkspaceId,
      workspaces: [
        createEntry(),
        createEntry({
          workspaceId: secondWorkspaceId,
          profileId: secondProfileId,
        }),
      ],
    }));

    expect(one.workspaces).toHaveLength(1);
    expect(two.workspaces).toHaveLength(2);
    expect(two.workspaces[0]?.workspaceLabel).toBe('Oma yritys');
    expect(two.workspaces[1]?.workspaceLabel).toBe('Oma yritys');
    expect(Object.isFrozen(two.workspaces[0])).toBe(true);
    expect(Object.isFrozen(two.workspaces[0]?.lineageIdentity)).toBe(true);
  });

  it('serializes deterministically with canonical field order and one newline', () => {
    const value = createRegistry({
      activeWorkspaceId: firstWorkspaceId,
      workspaces: [createEntry()],
    });
    const expected =
      `{"formatVersion":1,"activeWorkspaceId":"${firstWorkspaceId}",` +
      `"workspaces":[{"workspaceId":"${firstWorkspaceId}",` +
      '"workspaceLabel":"Oma yritys",' +
      `"lineageIdentity":{"formatVersion":1,"profileId":"${firstProfileId}"},` +
      '"layoutVersion":1,"lifecycleState":"ready",' +
      '"createdAt":"2026-08-18T10:00:00.000Z"}]}\n';

    const bytes = serializeWorkspaceRegistry(value);
    expect(new TextDecoder().decode(bytes)).toBe(expected);
    expect(serializeWorkspaceRegistry(parseWorkspaceRegistryBytes(bytes))).toEqual(
      bytes,
    );
    expect(assertCanonicalWorkspaceRegistryRoundTrip(bytes)).toEqual(
      parseWorkspaceRegistryBytes(bytes),
    );
  });

  it('rejects noncanonical bytes in the explicit canonical round-trip check', () => {
    expectInvalid(() =>
      assertCanonicalWorkspaceRegistryRoundTrip(
        encode(JSON.stringify(createRegistry(), null, 2)),
      ),
    );
  });

  it('generates canonical lowercase UUID v4 workspace identifiers', () => {
    expect(generateWorkspaceId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('rejects invalid UTF-8, zero bytes and input over the byte limit', () => {
    expectInvalid(() => parseWorkspaceRegistryBytes(new Uint8Array()));
    expectInvalid(() =>
      parseWorkspaceRegistryBytes(new Uint8Array([0xc3, 0x28])),
    );
    expectInvalid(() =>
      parseWorkspaceRegistryBytes(
        new Uint8Array(WORKSPACE_REGISTRY_MAX_BYTES + 1),
      ),
    );
  });

  it('rejects more than the maximum workspace count', () => {
    const workspaces = Array.from(
      { length: WORKSPACE_REGISTRY_MAX_ENTRIES + 1 },
      (_, index) => createEntry({
        workspaceId: createWorkspaceId(index),
        profileId: index.toString(16).padStart(64, '0'),
      }),
    );
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: workspaces[0]?.workspaceId ?? null,
        workspaces,
      })),
    );
  });

  it.each([
    [
      'root',
      '{"formatVersion":1,"formatVersion":1,"activeWorkspaceId":null,"workspaces":[]}',
    ],
    [
      'entry',
      `{"formatVersion":1,"activeWorkspaceId":"${firstWorkspaceId}","workspaces":[` +
        `{"workspaceId":"${firstWorkspaceId}","workspaceId":"${secondWorkspaceId}",` +
        `"workspaceLabel":"Oma yritys","lineageIdentity":{"formatVersion":1,"profileId":"${firstProfileId}"},` +
        '"layoutVersion":1,"lifecycleState":"ready","createdAt":"2026-08-18T10:00:00.000Z"}]}',
    ],
    [
      'lineage',
      `{"formatVersion":1,"activeWorkspaceId":"${firstWorkspaceId}","workspaces":[` +
        `{"workspaceId":"${firstWorkspaceId}","workspaceLabel":"Oma yritys",` +
        `"lineageIdentity":{"formatVersion":1,"profileId":"${firstProfileId}","profileId":"${secondProfileId}"},` +
        '"layoutVersion":1,"lifecycleState":"ready","createdAt":"2026-08-18T10:00:00.000Z"}]}',
    ],
    [
      'escaped decoded key',
      '{"formatVersion":1,"activeWorkspaceId":null,"workspaces":[],"work\\u0073paces":[]}',
    ],
  ])('rejects duplicate JSON keys at the %s level', (_name, source) => {
    expectInvalid(() => parseWorkspaceRegistryBytes(encode(source)));
  });

  it.each([
    ['root', { ...createRegistry(), unknown: true }],
    [
      'entry',
      createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [{ ...createEntry(), unknown: true }],
      }),
    ],
    [
      'lineage',
      createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [createEntry({ lineageExtra: true })],
      }),
    ],
  ])('rejects unknown fields at the %s level', (_name, value) => {
    expectInvalid(() => parseJson(value));
  });

  it.each([
    ['root', '{"formatVersion":1,"activeWorkspaceId":null,"workspaces":[],"__proto__":{}}'],
    [
      'entry',
      `{"formatVersion":1,"activeWorkspaceId":"${firstWorkspaceId}","workspaces":[` +
        `{"workspaceId":"${firstWorkspaceId}","workspaceLabel":"Oma yritys",` +
        `"lineageIdentity":{"formatVersion":1,"profileId":"${firstProfileId}"},` +
        '"layoutVersion":1,"lifecycleState":"ready","createdAt":"2026-08-18T10:00:00.000Z","constructor":{}}]}',
    ],
    [
      'lineage',
      `{"formatVersion":1,"activeWorkspaceId":"${firstWorkspaceId}","workspaces":[` +
        `{"workspaceId":"${firstWorkspaceId}","workspaceLabel":"Oma yritys",` +
        `"lineageIdentity":{"formatVersion":1,"profileId":"${firstProfileId}","prototype":{}},` +
        '"layoutVersion":1,"lifecycleState":"ready","createdAt":"2026-08-18T10:00:00.000Z"}]}',
    ],
  ])('rejects prototype keys at the %s level', (_name, source) => {
    expectInvalid(() => parseWorkspaceRegistryBytes(encode(source)));
  });

  it.each([
    null,
    [],
    createRegistry({ workspaces: null }),
    createRegistry({ workspaces: {} }),
    createRegistry({ workspaces: [null] }),
    createRegistry({ workspaces: [[]] }),
    createRegistry({ workspaces: [createEntry({ lineage: null })] }),
    createRegistry({ workspaces: [createEntry({ lineage: [] })] }),
  ])('rejects null and array/object type confusion', (value) => {
    expectInvalid(() => parseJson(value));
  });

  it.each([
    createRegistry({ formatVersion: 2 }),
    createRegistry({
      activeWorkspaceId: firstWorkspaceId,
      workspaces: [createEntry({ layoutVersion: 2 })],
    }),
    createRegistry({
      activeWorkspaceId: firstWorkspaceId,
      workspaces: [createEntry({ lineageFormatVersion: 2 })],
    }),
  ])('rejects unknown format and layout versions', (value) => {
    expectInvalid(() => parseJson(value));
  });

  it.each([
    'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF',
    '11111111-1111-5111-8111-111111111111',
    '11111111-1111-4111-7111-111111111111',
    '11111111111141118111111111111111',
    '../workspace',
  ])('rejects invalid workspace identifier %s', (workspaceId) => {
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: workspaceId,
        workspaces: [createEntry({ workspaceId })],
      })),
    );
  });

  it('rejects duplicate workspace and lineage identities', () => {
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [
          createEntry(),
          createEntry({ workspaceId: firstWorkspaceId, profileId: secondProfileId }),
        ],
      })),
    );
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [
          createEntry(),
          createEntry({ workspaceId: secondWorkspaceId, profileId: firstProfileId }),
        ],
      })),
    );
  });

  it.each([
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    'g'.repeat(64),
  ])('rejects invalid lineage profile ID %s', (profileId) => {
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [createEntry({ profileId })],
      })),
    );
  });

  it.each([
    '',
    '   ',
    ' Oma yritys',
    'Oma yritys ',
    'a'.repeat(81),
    'a\nb',
    'a\u0000b',
    'a\u0085b',
    'a\u2028b',
    'a\u202eb',
    'a\u2066b',
    '\ud800',
  ])('rejects unsafe workspace label', (workspaceLabel) => {
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [createEntry({ workspaceLabel })],
      })),
    );
  });

  it('counts Unicode code points rather than UTF-16 code units in labels', () => {
    const label = '😀'.repeat(80);
    expect(parseJson(createRegistry({
      activeWorkspaceId: firstWorkspaceId,
      workspaces: [createEntry({ workspaceLabel: label })],
    })).workspaces[0]?.workspaceLabel).toBe(label);
  });

  it.each([
    '2026-08-18T10:00:00Z',
    '2026-08-18T10:00:00.00Z',
    '2026-08-18T10:00:00.000+00:00',
    '2026-02-30T10:00:00.000Z',
    '2026-08-18t10:00:00.000z',
  ])('rejects invalid or noncanonical timestamps', (createdAt) => {
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [createEntry({ createdAt })],
      })),
    );
  });

  it('enforces the active workspace invariant', () => {
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: null,
        workspaces: [createEntry()],
      })),
    );
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: secondWorkspaceId,
        workspaces: [createEntry()],
      })),
    );
    expectInvalid(() =>
      parseJson(createRegistry({
        activeWorkspaceId: firstWorkspaceId,
        workspaces: [createEntry({ lifecycleState: 'recoveryRequired' })],
      })),
    );

    expect(parseJson(createRegistry({
      activeWorkspaceId: null,
      workspaces: [createEntry({ lifecycleState: 'recoveryRequired' })],
    })).activeWorkspaceId).toBeNull();
  });

  it('returns only the closed safe validation error', () => {
    try {
      parseWorkspaceRegistryBytes(encode('{"secret":"do-not-leak"}'));
      throw new Error('Expected parsing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceRegistryValidationError);
      expect(error).toMatchObject({
        code: WORKSPACE_REGISTRY_INVALID,
        message: WORKSPACE_REGISTRY_INVALID,
      });
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('do-not-leak');
    }
  });
});

function parseJson(value: unknown) {
  return parseWorkspaceRegistryBytes(encode(JSON.stringify(value)));
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrow(WORKSPACE_REGISTRY_INVALID);
}

function createRegistry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    formatVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
    ...overrides,
  };
}

interface EntryOverrides {
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  readonly profileId?: string;
  readonly lineageFormatVersion?: number;
  readonly layoutVersion?: number;
  readonly lifecycleState?: string;
  readonly createdAt?: string;
  readonly lineage?: unknown;
  readonly lineageExtra?: boolean;
}

function createEntry(overrides: EntryOverrides = {}): Record<string, unknown> {
  const lineageIdentity = 'lineage' in overrides
    ? overrides.lineage
    : {
        formatVersion: overrides.lineageFormatVersion ?? 1,
        profileId: overrides.profileId ?? firstProfileId,
        ...(overrides.lineageExtra === true ? { unknown: true } : {}),
      };
  return {
    workspaceId: overrides.workspaceId ?? firstWorkspaceId,
    workspaceLabel: overrides.workspaceLabel ?? 'Oma yritys',
    lineageIdentity,
    layoutVersion: overrides.layoutVersion ?? 1,
    lifecycleState: overrides.lifecycleState ?? 'ready',
    createdAt: overrides.createdAt ?? '2026-08-18T10:00:00.000Z',
  };
}

function createWorkspaceId(index: number): string {
  const suffix = (index + 1).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}
