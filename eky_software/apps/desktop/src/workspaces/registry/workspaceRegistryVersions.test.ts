import { describe, expect, it } from 'vitest';

import { validateWorkspaceId } from './workspaceIdValidation.js';
import { parseWorkspaceRegistryBytes, WORKSPACE_REGISTRY_MAX_BYTES } from './workspaceRegistryBytes.js';
import { WORKSPACE_REGISTRY_INVALID } from './workspaceRegistryError.js';
import {
  appendReadyWorkspaceEntry,
  appendRecoveredWorkspaceEntry,
  renameWorkspaceLabel,
  selectActiveWorkspace,
  selectSourceAndRequireTargetRecovery,
  WorkspaceRegistryMutationError,
} from './workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry, assertCanonicalWorkspaceRegistryRoundTrip } from './workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryEntryV1 } from './workspaceRegistryTypes.js';
import { validateWorkspaceRegistry, WORKSPACE_REGISTRY_MAX_ENTRIES } from './workspaceRegistryValidation.js';

const first = entry(1);
const second = entry(2);

describe('versioned workspace registry', () => {
  it('permits an unselected ready entry only in v2 and deeply freezes it', () => {
    const value = { formatVersion: 2, activeWorkspaceId: null, workspaces: [first] };
    const parsed = validateWorkspaceRegistry(value);
    expect(parsed).toEqual(value);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.workspaces)).toBe(true);
    expect(Object.isFrozen(parsed.workspaces[0])).toBe(true);
    expect(Object.isFrozen(parsed.workspaces[0]!.lineageIdentity)).toBe(true);
    expect(() => validateWorkspaceRegistry({ ...value, formatVersion: 1 }))
      .toThrow(WORKSPACE_REGISTRY_INVALID);
    expect(() => validateWorkspaceRegistry(undefined)).toThrow(WORKSPACE_REGISTRY_INVALID);
  });

  it('changes only the root version in canonical selected v1 bytes', () => {
    const v1 = registry(1);
    const before = serializeWorkspaceRegistry(v1);
    const v2 = { ...v1, formatVersion: 2 };
    const bytes = serializeWorkspaceRegistry(v2);
    const text = new TextDecoder().decode(before);
    expect(new TextDecoder().decode(bytes)).toBe('{"formatVersion":2' + text.slice('{"formatVersion":1'.length));
    expect(assertCanonicalWorkspaceRegistryRoundTrip(bytes)).toEqual(v2);
    expect(serializeWorkspaceRegistry(v1)).toEqual(before);
  });

  it.each([0, 3, 2.1, '2', null])('rejects unsupported root version %s', (formatVersion) => {
    expect(() => validateWorkspaceRegistry({ ...registry(2), formatVersion }))
      .toThrow(WORKSPACE_REGISTRY_INVALID);
  });

  it('retains byte, UTF-8 and decoded duplicate-key rejection for v2', () => {
    expect(() => parseWorkspaceRegistryBytes(new Uint8Array(WORKSPACE_REGISTRY_MAX_BYTES + 1)))
      .toThrow(WORKSPACE_REGISTRY_INVALID);
    const prefix = new TextEncoder().encode('{"formatVersion":2,"workspaceLabel":"');
    expect(() => parseWorkspaceRegistryBytes(new Uint8Array([...prefix, 0xc3, 0x28])))
      .toThrow(WORKSPACE_REGISTRY_INVALID);
    expect(() => parseWorkspaceRegistryBytes(new TextEncoder().encode(
      '{"formatVersion":2,"activeWorkspaceId":null,"workspaces":[],"work\\u0073paces":[]}',
    ))).toThrow(WORKSPACE_REGISTRY_INVALID);
  });

  it('does not auto-select on v2 creation, recovered publication or rename', () => {
    const empty = validateWorkspaceRegistry({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
    const created = appendReadyWorkspaceEntry(empty, first);
    const recovered = appendRecoveredWorkspaceEntry(created, { ...second, workspaceLabel: first.workspaceLabel });
    const renamed = renameWorkspaceLabel(recovered, second.workspaceId, 'Distinct');
    for (const value of [created, recovered, renamed]) {
      expect(value.formatVersion).toBe(2);
      expect(value.activeWorkspaceId).toBeNull();
      expect(assertCanonicalWorkspaceRegistryRoundTrip(serializeWorkspaceRegistry(value))).toEqual(value);
    }
    expect(renameWorkspaceLabel(recovered, first.workspaceId, first.workspaceLabel)).toBe(recovered);
    expect(() => appendReadyWorkspaceEntry(created, { ...second, workspaceLabel: first.workspaceLabel }))
      .toThrow(WorkspaceRegistryMutationError);
  });

  describe.each([1, 2] as const)('v%i shared invariants', (formatVersion) => {
    it.each(['missing', 'nonReady'] as const)('rejects %s selection', (kind) => {
      expect(() => validateWorkspaceRegistry({
        formatVersion,
        activeWorkspaceId: first.workspaceId,
        workspaces: kind === 'missing' ? [] : [{ ...first, lifecycleState: 'recoveryRequired' }],
      })).toThrow(WORKSPACE_REGISTRY_INVALID);
    });

    it.each([
      { ...first, workspaceId: '../invalid' },
      { ...first, layoutVersion: 2 },
      { ...first, lineageIdentity: { ...first.lineageIdentity, formatVersion: 2 } },
      { ...first, companyId: 'not-a-registry-field' },
      { ...first, workspaceLabel: ' invalid ' },
      { ...first, lifecycleState: 'deleted' },
      { ...first, createdAt: 'not-a-date' },
    ])('retains entry validation', (invalidEntry) => {
      expect(() => validateWorkspaceRegistry({ ...registry(formatVersion), workspaces: [invalidEntry] }))
        .toThrow(WORKSPACE_REGISTRY_INVALID);
    });

    it('retains identity uniqueness and the maximum entry count', () => {
      for (const workspaces of [
        [first, { ...second, workspaceId: first.workspaceId }],
        [first, { ...second, lineageIdentity: first.lineageIdentity }],
        Array.from({ length: WORKSPACE_REGISTRY_MAX_ENTRIES + 1 }, (_, index) => entry(index + 1)),
      ]) {
        expect(() => validateWorkspaceRegistry({ ...registry(formatVersion), workspaces }))
          .toThrow(WORKSPACE_REGISTRY_INVALID);
      }
    });

    it('preserves selection and version through append, rename, switch and failed-target recovery', () => {
      const source = registry(formatVersion);
      const appended = appendReadyWorkspaceEntry(source, second);
      const renamed = renameWorkspaceLabel(appended, second.workspaceId, 'Renamed');
      const selected = selectActiveWorkspace(renamed, first.workspaceId, second.workspaceId);
      const recovered = selectSourceAndRequireTargetRecovery({
        registry: selected, sourceWorkspaceId: first.workspaceId, targetWorkspaceId: second.workspaceId,
      });
      for (const value of [appended, renamed, selected, recovered]) {
        expect(value.formatVersion).toBe(formatVersion);
        expect(assertCanonicalWorkspaceRegistryRoundTrip(serializeWorkspaceRegistry(value))).toEqual(value);
      }
      expect(appended.activeWorkspaceId).toBe(first.workspaceId);
      expect(recovered.activeWorkspaceId).toBe(first.workspaceId);
      expect(recovered.workspaces[1]!.lifecycleState).toBe('recoveryRequired');
      expect(source.workspaces).toEqual([first]);
    });

    it('keeps capacity, identity and lineage failure precedence before labels', () => {
      const cases = [
        { source: registry(formatVersion), next: first, failure: 'workspaceIdExists' },
        { source: registry(formatVersion), next: { ...second, lineageIdentity: first.lineageIdentity }, failure: 'lineageExists' },
        { source: { ...registry(formatVersion), workspaces: Array.from({ length: WORKSPACE_REGISTRY_MAX_ENTRIES }, (_, index) => entry(index + 1)) }, next: first, failure: 'capacityExceeded' },
      ];
      for (const { source, next, failure } of cases) {
        const before = serializeWorkspaceRegistry(source);
        expect(() => appendReadyWorkspaceEntry(source, next)).toThrow(
          expect.objectContaining({ failure, message: 'WORKSPACE_REGISTRY_MUTATION_REJECTED' }),
        );
        expect(serializeWorkspaceRegistry(source)).toEqual(before);
      }
    });
  });
});

function registry(formatVersion: 1 | 2): LocalWorkspaceRegistry {
  return { formatVersion, activeWorkspaceId: first.workspaceId, workspaces: [first] };
}

function entry(index: number): LocalWorkspaceRegistryEntryV1 {
  return {
    workspaceId: validateWorkspaceId(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
    workspaceLabel: `Synthetic company ${index}`,
    lineageIdentity: { formatVersion: 1, profileId: index.toString(16).padStart(64, '0') },
    layoutVersion: 1,
    lifecycleState: 'ready',
    createdAt: '2026-10-25T10:00:00.000Z',
  };
}
