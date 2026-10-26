import { expect, it } from 'vitest';

import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../workspaces/registry/workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from '../workspaces/registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryV2 } from '../workspaces/registry/workspaceRegistryTypes.js';
import { createWorkspaceSelectorSwitchJournal } from '../workspaces/switch/workspaceSelectorSwitchState.js';
import { serializeVersionedWorkspaceSwitchJournal, type WorkspaceSwitchJournal } from '../workspaces/switch/workspaceSwitchJournal.js';
import { serializeWorkspaceFirstStartMigrationJournal } from '../workspaces/update/workspaceFirstStartMigrationJournalCodec.js';
import type { WorkspaceFirstStartMigrationJournalV1 } from '../workspaces/update/workspaceFirstStartMigrationJournalTypes.js';
import { calculateWorkspaceRegistrySha256, markPassiveWorkspacesRecoveryRequired } from '../workspaces/update/workspaceFirstStartMigrationRegistryTransitions.js';
import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { planDeferredBusinessLocalUpdateState, type DeferredBusinessLocalUpdateState } from './deferredBusinessLocalUpdateState.js';

const at = '2026-10-26T12:00:00.000Z';
const source = { formatVersion: 1 as const, releaseChannel: 'pilot' as const,
  appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: at };
const target = { ...source, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) };
const selector = createSelectorAcceptedBuildMetadata(source, target);
const accepted = createBusinessAcceptedBuildMetadata(selector, target);
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const sourceRegistry = parseWorkspaceRegistryBytes(encode({
  formatVersion: 2, activeWorkspaceId: '11111111-1111-4111-8111-111111111111',
  workspaces: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map((workspaceId, index) => ({
    workspaceId, workspaceLabel: `Synthetic ${index}`, layoutVersion: 1, lifecycleState: 'ready',
    createdAt: at, lineageIdentity: { formatVersion: 1, profileId: (index === 0 ? 'c' : 'd').repeat(64) },
  })),
})) as Readonly<LocalWorkspaceRegistryV2>;
const activeId = sourceRegistry.activeWorkspaceId!;
const passiveId = sourceRegistry.workspaces[1]!.workspaceId;
const transitionedRegistry = markPassiveWorkspacesRecoveryRequired(sourceRegistry, activeId, [passiveId]);
const prepared: Readonly<WorkspaceFirstStartMigrationJournalV1> = {
  formatVersion: 1, operationId: '33333333-3333-4333-8333-333333333333', state: 'prepared',
  sourceBuild: { appVersion: source.appVersion, buildRevision: source.buildRevision },
  targetBuild: { appVersion: target.appVersion, buildRevision: target.buildRevision },
  activeWorkspaceId: activeId, passiveRecoveryWorkspaceIds: [passiveId],
  sourceRegistrySha256: calculateWorkspaceRegistrySha256(sourceRegistry),
  transitionedRegistrySha256: calculateWorkspaceRegistrySha256(transitionedRegistry),
  createdAt: at, updatedAt: at,
};
const transitioned = { ...prepared, state: 'registryTransitioned' as const };
const switchPrepared = createWorkspaceSelectorSwitchJournal(
  { ...sourceRegistry, activeWorkspaceId: null }, activeId,
  '44444444-4444-4444-8444-444444444444', at,
);
const switchSelected = { ...switchPrepared, state: 'targetSelected' as const };
type Values<T> = Partial<Record<'current' | 'next' | 'backup', Readonly<T>>>;
function records<T>(values: Values<T> = {}, serialize: (value: Readonly<T>) => Uint8Array = encode): ReadOnlyJournalSlots<T> {
  const record = (value: Readonly<T> | undefined) => value === undefined ? undefined
    : { bytes: serialize(value), value };
  return { current: record(values.current), next: record(values.next), backup: record(values.backup) };
}
const metadata = (values: Values<VersionedAcceptedBuildMetadata>) => records(values);
const registry = (values: Values<LocalWorkspaceRegistry>) => records(values, serializeWorkspaceRegistry);
const journal = (values: Values<WorkspaceFirstStartMigrationJournalV1>) => records(values, serializeWorkspaceFirstStartMigrationJournal);
const switching = (values: Values<WorkspaceSwitchJournal>) => records(values, serializeVersionedWorkspaceSwitchJournal);
function state(overrides: Partial<DeferredBusinessLocalUpdateState> = {}): DeferredBusinessLocalUpdateState {
  return { metadata: metadata({ current: selector }), legacyMetadata: records(), updateJournal: records(),
    legacyUpdateJournal: records(), directSetupRecovery: records(), registry: registry({ current: sourceRegistry }),
    switchJournal: records(), firstStartJournal: records(), runningBuild: target, ...overrides };
}

it.each([
  { current: selector }, { current: selector, next: accepted },
  { backup: selector, next: accepted }, { current: accepted, backup: selector }, { backup: selector },
])('admits publication interruption %# without mistaking next for accepted business', values => {
  const input = state({ metadata: metadata(values) });
  const before = structuredClone(input);
  const result = planDeferredBusinessLocalUpdateState(input);
  expect(result.businessAccepted).toBe(values.current === accepted);
  expect(result.metadata).toEqual(values.current ?? selector);
  expect(result.selectorMetadata).toEqual(selector);
  expect(result.sourceRegistry).toEqual(sourceRegistry);
  expect(structuredClone(input)).toEqual(before);
});

it.each([
  {}, { next: accepted }, { current: accepted }, { current: selector, backup: selector },
  { current: selector, next: accepted, backup: selector },
  { current: selector, next: selector }, { current: accepted, backup: accepted },
  { current: source },
])('rejects absent, unrelated or impossible metadata slots %#', values => {
  expect(() => planDeferredBusinessLocalUpdateState(state({ metadata: metadata(values) }))).toThrow();
});

it.each(['legacyMetadata', 'updateJournal', 'legacyUpdateJournal', 'directSetupRecovery'] as const)(
  'does not consume the other recovery owner %s', key => {
    for (const slot of ['current', 'next', 'backup'] as const) {
      const input = state({ [key]: records({ [slot]: { synthetic: true } }) });
      expect(() => planDeferredBusinessLocalUpdateState(input)).toThrow();
    }
  },
);

it.each(['appVersion', 'buildRevision', 'releaseChannel'] as const)('rejects a different running %s', key => {
  const runningBuild = { ...target, [key]: key === 'appVersion' ? '0.4.0' : key === 'buildRevision' ? 'e'.repeat(40) : 'stable' };
  expect(() => planDeferredBusinessLocalUpdateState(state({ runningBuild }))).toThrow();
});

it.each(['prepared', 'registryTransitioned'] as const)('admits retained %s around the exact passive transition', phase => {
  for (const value of [sourceRegistry, transitionedRegistry]) {
    const result = planDeferredBusinessLocalUpdateState(state({
      registry: registry({ current: value }), firstStartJournal: journal({ current: { ...prepared, state: phase } }),
    }));
    expect(result.sourceRegistry).toEqual(sourceRegistry);
    expect(result.businessAccepted).toBe(false);
  }
});

it.each([
  { current: prepared }, { next: prepared }, { backup: prepared },
  { current: prepared, next: transitioned }, { backup: prepared, next: transitioned },
  { current: transitioned, backup: prepared }, { current: transitioned },
])('admits W6 slot interruptions %# only with the matching transition', values => {
  const result = planDeferredBusinessLocalUpdateState(state({
    registry: registry({ current: values.next?.state === 'registryTransitioned' || values.current?.state === 'registryTransitioned'
      ? transitionedRegistry : sourceRegistry }), firstStartJournal: journal(values),
  }));
  expect(result.firstStartJournal).toEqual(values.current ?? values.backup ?? values.next);
});

it.each([
  { next: transitioned }, { current: transitioned, next: prepared },
  { current: prepared, next: transitioned, backup: prepared },
  { current: prepared, next: { ...transitioned, operationId: '55555555-5555-4555-8555-555555555555' } },
])('rejects invalid W6 publication %#', values => {
  expect(() => planDeferredBusinessLocalUpdateState(state({ firstStartJournal: journal(values) }))).toThrow();
});

it('does not admit a transition journal publication before the registry write', () => {
  expect(() => planDeferredBusinessLocalUpdateState(state({
    firstStartJournal: journal({ current: prepared, next: transitioned }),
  }))).toThrow();
});

it.each(['sourceBuild', 'targetBuild', 'activeWorkspaceId', 'sourceRegistrySha256', 'transitionedRegistrySha256'] as const)(
  'rejects W6 %s disagreement', key => {
    const changed = { ...prepared, [key]: key.endsWith('Build')
      ? { ...prepared[key as 'sourceBuild' | 'targetBuild'], buildRevision: 'e'.repeat(40) }
      : key === 'activeWorkspaceId' ? passiveId : 'e'.repeat(64) };
    expect(() => planDeferredBusinessLocalUpdateState(state({ firstStartJournal: records({ current: changed }) }))).toThrow();
  },
);

it.each(['prepared', 'registryTransitioned'] as const)('does not roll back accepted business with a retained %s journal', phase => {
  const input = state({ metadata: metadata({ current: accepted, backup: selector }),
    registry: registry({ current: transitionedRegistry }), firstStartJournal: journal({ current: { ...prepared, state: phase } }) });
  expect(planDeferredBusinessLocalUpdateState(input).businessAccepted).toBe(true);
  expect(() => planDeferredBusinessLocalUpdateState({ ...input, registry: registry({ current: sourceRegistry }) })).toThrow();
});

it('allows equal source/transition hashes when no passive entry changes', () => {
  const noPassive = { ...prepared, passiveRecoveryWorkspaceIds: [], transitionedRegistrySha256: prepared.sourceRegistrySha256 };
  expect(planDeferredBusinessLocalUpdateState(state({ metadata: metadata({ current: accepted, backup: selector }),
    firstStartJournal: journal({ current: noPassive }) })).businessAccepted).toBe(true);
});

it.each([switchPrepared, switchSelected])('admits selected source-null switch state $state', switchValue => {
  const result = planDeferredBusinessLocalUpdateState(state({ switchJournal: switching({ current: switchValue }) }));
  expect(result.registry).toEqual(sourceRegistry);
});

it('requires switch and W6 to agree before any repairing read', () => {
  const input = state({ switchJournal: switching({ current: switchSelected }), firstStartJournal: journal({ current: prepared }) });
  expect(planDeferredBusinessLocalUpdateState(input).firstStartJournal).toEqual(prepared);
  expect(() => planDeferredBusinessLocalUpdateState({ ...input, firstStartJournal: journal({ current: transitioned }) })).toThrow();
  expect(() => planDeferredBusinessLocalUpdateState({ ...input, registry: registry({ current: transitionedRegistry }) })).toThrow();
  expect(() => planDeferredBusinessLocalUpdateState({ ...input, metadata: metadata({ current: accepted, backup: selector }) })).toThrow();
});

it('admits interrupted initial W6 preparation while the selected switch is retained', () => {
  expect(planDeferredBusinessLocalUpdateState(state({
    switchJournal: switching({ current: switchSelected }), firstStartJournal: journal({ next: prepared }),
  })).firstStartJournal).toEqual(prepared);
});

it('rejects a transitioned registry before initial W6 preparation was published', () => {
  expect(() => planDeferredBusinessLocalUpdateState(state({
    registry: registry({ current: transitionedRegistry }), firstStartJournal: journal({ next: prepared }),
  }))).toThrow();
});

it('rejects source rollback before the W6 transition publication slots settled', () => {
  expect(() => planDeferredBusinessLocalUpdateState(state({
    firstStartJournal: journal({ current: transitioned, backup: prepared }),
  }))).toThrow();
});

it.each([
  { current: sourceRegistry, next: transitionedRegistry },
  { backup: sourceRegistry, next: transitionedRegistry },
  { current: transitionedRegistry, backup: sourceRegistry },
])('rejects forward registry publication %# after the transition journal is published', values => {
  expect(() => planDeferredBusinessLocalUpdateState(state({
    registry: registry(values), firstStartJournal: journal({ current: transitioned }),
  }))).toThrow();
  expect(() => planDeferredBusinessLocalUpdateState(state({
    registry: registry(values), firstStartJournal: journal({ current: prepared }),
  }))).not.toThrow();
});

it.each([
  { current: transitionedRegistry, next: sourceRegistry },
  { backup: transitionedRegistry, next: sourceRegistry },
  { current: sourceRegistry, backup: transitionedRegistry },
])('admits reverse registry publication %# in source recovery', values => {
  for (const firstStart of [prepared, transitioned]) {
    expect(planDeferredBusinessLocalUpdateState(state({
      registry: registry(values), firstStartJournal: journal({ current: firstStart }),
    })).sourceRegistry).toEqual(sourceRegistry);
  }
});

it('rejects source-only backup left over from forward publication after the transition journal', () => {
  expect(() => planDeferredBusinessLocalUpdateState(state({
    registry: registry({ backup: sourceRegistry }), firstStartJournal: journal({ current: transitioned }),
  }))).toThrow();
  expect(planDeferredBusinessLocalUpdateState(state({
    registry: registry({ backup: transitionedRegistry }), firstStartJournal: journal({ current: transitioned }),
  })).sourceRegistry).toEqual(sourceRegistry);
});

it.each(['rollbackSelected', 'recoveryRequired'] as const)('leaves switch %s to its recovery route', phase => {
  expect(() => planDeferredBusinessLocalUpdateState(state({ switchJournal: switching({ current: { ...switchSelected, state: phase } }) }))).toThrow();
});

it('rejects simultaneous unpublished metadata and another writer', () => {
  const input = state({ metadata: metadata({ current: selector, next: accepted }) });
  for (const overrides of [
    { switchJournal: switching({ current: switchSelected }) },
    { registry: registry({ current: sourceRegistry, next: transitionedRegistry }), firstStartJournal: journal({ current: prepared }) },
    { firstStartJournal: journal({ current: prepared, next: transitioned }), registry: registry({ current: transitionedRegistry }) },
  ]) expect(() => planDeferredBusinessLocalUpdateState({ ...input, ...overrides })).toThrow();
});

it.each(['metadata', 'registry', 'firstStartJournal'] as const)('checks original %s bytes, not just a supplied parsed value', key => {
  const input = state({ firstStartJournal: journal({ current: prepared }) });
  const original = input[key].current!;
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{'), encode({ ...original.value, extra: true })]) {
    const changed = { ...input, [key]: { ...input[key], current: { ...original, bytes } } };
    expect(() => planDeferredBusinessLocalUpdateState(changed)).toThrow();
  }
  const duplicate = encode(original.value).toString().replace('"formatVersion":', '"formatVersion":1,"formatVersion":');
  expect(() => planDeferredBusinessLocalUpdateState({ ...input, [key]: {
    ...input[key], current: { ...original, bytes: Buffer.from(duplicate) },
  } })).toThrow();
});

it('does not accept a different decoded value even when both shapes are valid', () => {
  const input = state();
  expect(() => planDeferredBusinessLocalUpdateState({ ...input,
    metadata: { ...input.metadata, current: { bytes: encode(selector), value: accepted } },
  })).toThrow();
});
