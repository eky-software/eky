import { createHash } from 'node:crypto';

import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { assertUpdateJournalAuthority } from '../../update/updateJournalStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';

export async function captureDeletionTarget(input: {
  installationRoot: string;
  workspaceId: string;
  typedLabel: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertAuthority(): void;
}) {
  const workspaceId = validateWorkspaceId(input.workspaceId);
  const typedLabel = validateWorkspaceLabel(input.typedLabel);
  const installationRoot = input.installationRoot;
  const authority = input.assertAuthority.bind(input);
  const read = input.registry.inspectSlots.bind(input.registry);
  let invalid = false;
  const assertValid = () => {
    if (invalid) fail();
    try {
      assertUpdateJournalAuthority(authority);
      if (invalid) fail();
    } catch (error) {
      invalid = true;
      throw error;
    }
  };
  assertValid();
  const slots = captureSlots(await read());
  assertValid();
  // Confirmation never repairs or publishes a registry recovery slot.
  if (slots.current?.value.formatVersion !== 2 ||
      slots.next !== undefined || slots.backup !== undefined) fail();
  const registry = slots.current.value;
  const entry = registry.workspaces.find(value => value.workspaceId === workspaceId);
  if (entry === undefined || !matchesDeletionLabel(typedLabel, entry.workspaceLabel)) fail();
  const paths = deriveWorkspaceRoot(installationRoot, workspaceId, entry.layoutVersion);
  await inspectWorkspaceRoot(paths);
  assertValid();
  const rootIdentity = await readWorkspaceProcessReservationIdentity(paths.workspaceRoot);
  assertValid();
  const target = Object.freeze({
    workspaceId,
    workspaceLabel: entry.workspaceLabel,
    profileId: entry.lineageIdentity.profileId,
    lifecycleState: entry.lifecycleState,
    previousActiveWorkspaceId: registry.activeWorkspaceId,
    registrySha256: hash(slots.current.bytes),
    registryEntrySha256: hash(Buffer.from(JSON.stringify(entry))),
    rootIdentity,
  });
  const assertCurrent = async () => {
    try {
      assertValid();
      assertSameSlots(slots, captureSlots(await read()));
      assertValid();
      await inspectWorkspaceRoot(paths);
      assertValid();
      if (await readWorkspaceProcessReservationIdentity(paths.workspaceRoot) !== rootIdentity) fail();
      assertValid();
      assertSameSlots(slots, captureSlots(await read()));
      assertValid();
    } catch (error) {
      invalid = true;
      throw error;
    }
  };
  await assertCurrent();
  return Object.freeze({ target, assertCurrent, assertValid, invalidate() { invalid = true; } });
}

function matchesDeletionLabel(typed: unknown, currentLabel: unknown): boolean {
  try {
    return validateWorkspaceLabel(typed).normalize('NFC') ===
      validateWorkspaceLabel(currentLabel).normalize('NFC');
  } catch { return false; }
}

function captureSlots(
  slots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>,
): ReadOnlyJournalSlots<LocalWorkspaceRegistry> {
  const copy: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlots<LocalWorkspaceRegistry>['current']> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const key of ['current', 'next', 'backup'] as const) {
    const slot = slots[key];
    if (slot === undefined) continue;
    if (slot.identity === undefined) fail();
    const bytes = Uint8Array.from(slot.bytes);
    copy[key] = Object.freeze({
      bytes,
      value: parseWorkspaceRegistryBytes(bytes),
      identity: Object.freeze({ ...slot.identity }),
    });
  }
  return Object.freeze(copy);
}

function assertSameSlots(
  expected: ReadOnlyJournalSlots<LocalWorkspaceRegistry>,
  actual: ReadOnlyJournalSlots<LocalWorkspaceRegistry>,
): void {
  for (const key of ['current', 'next', 'backup'] as const) {
    const left = expected[key];
    const right = actual[key];
    if (left === undefined) {
      if (right !== undefined) fail();
      continue;
    }
    if (right === undefined || left.identity === undefined || right.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(left.identity, right.identity) ||
        !Buffer.from(left.bytes).equals(Buffer.from(right.bytes))) fail();
  }
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(): never {
  throw new Error('WORKSPACE_DELETE_STALE_CONFIRMATION');
}
