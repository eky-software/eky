import { join } from 'node:path';
import { createWorkspaceDeletionJournalPaths } from './workspaceDeletionJournalStore.js';
import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureWorkspaceRemnantBindingKey, workspaceRemnantBindingInvalidCode as invalidCode,
  type WorkspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';

const bindingDirectories = Object.freeze({
  workspaceReplacement: 'workspace-replacement-bindings',
  workspaceActivationMigration: 'workspace-activation-migration-bindings',
  workspaceImport: 'workspace-import-bindings',
  workspaceLegacyAdoption: 'workspace-legacy-adoption-bindings',
  profileInspection: 'profile-inspection-bindings',
});

export function createWorkspaceRemnantBindingOwnerDirectoryPaths(userDataRoot: string, owner: WorkspaceRemnantBindingKey['owner']) {
  const state = createWorkspaceDeletionJournalPaths(userDataRoot);
  if (typeof owner !== 'string' || !Object.hasOwn(bindingDirectories, owner)) return invalidDeletionData(invalidCode);
  const directoryPath = join(state.directoryPath, bindingDirectories[owner]);
  return Object.freeze({ directoryPath, ancestors: Object.freeze([userDataRoot, state.directoryPath, directoryPath]) });
}

function bindingStem(key: WorkspaceRemnantBindingKey) {
  return key.owner === 'workspaceLegacyAdoption' ? key.workspaceId
    : key.owner === 'profileInspection' ? `${key.operationId}-${key.generationId}` : key.operationId;
}

export function createWorkspaceRemnantBindingPaths(userDataRoot: string, value: unknown) {
  const key = captureWorkspaceRemnantBindingKey(value);
  const { directoryPath } = createWorkspaceRemnantBindingOwnerDirectoryPaths(userDataRoot, key.owner);
  const id = bindingStem(key);
  const currentPath = join(directoryPath, `${id}.json`);
  return Object.freeze({ directoryPath, currentPath, nextPath: `${currentPath}.next`, backupPath: `${currentPath}.backup` });
}

export function parseWorkspaceRemnantBindingSlotName(owner: WorkspaceRemnantBindingKey['owner'], name: string) {
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes('\0')) return invalidDeletionData(invalidCode);
  const slot = name.endsWith('.next') ? 'next' : name.endsWith('.backup') ? 'backup' : 'current';
  const currentName = slot === 'current' ? name : name.slice(0, -(`.${slot}`.length));
  if (!currentName.endsWith('.json')) return invalidDeletionData(invalidCode);
  const stem = currentName.slice(0, -'.json'.length);
  let key: WorkspaceRemnantBindingKey;
  if (owner === 'workspaceLegacyAdoption') key = captureWorkspaceRemnantBindingKey({ owner, workspaceId: stem });
  else if (owner === 'profileInspection') {
    // The two existing, independently validated UUID fields have equal width.
    const split = (stem.length - 1) / 2;
    if (!Number.isInteger(split) || stem[split] !== '-') return invalidDeletionData(invalidCode);
    key = captureWorkspaceRemnantBindingKey({ owner, operationId: stem.slice(0, split), generationId: stem.slice(split + 1) });
  } else key = captureWorkspaceRemnantBindingKey({ owner, operationId: stem });
  if (bindingStem(key) !== stem) return invalidDeletionData(invalidCode);
  return Object.freeze({ key, slot, stem });
}
