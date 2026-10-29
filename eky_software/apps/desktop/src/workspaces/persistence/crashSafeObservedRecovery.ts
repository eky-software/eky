import {
  CrashSafeFileSlotError,
  sameCrashSafeFileSlotIdentity,
  type CrashSafeFileSlot,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity,
  type CrashSafeFileSlotMutationGuard,
} from './crashSafeFileSlot.js';

const priority = ['current', 'backup', 'next'] as const;
type Identities = Record<CrashSafeFileSlot, Readonly<CrashSafeFileSlotIdentity> | undefined>;

// Observation is not admission. The cold owner supplies independent C/R18 proof.
export interface ObservedRecoverySelection {
  readonly identities: Readonly<Identities>;
  readonly source: CrashSafeFileSlot | undefined;
  readonly bytes: Uint8Array | undefined;
}

export interface ObservedRecoveryAuthority {
  assertAuthority(): void;
  assertExternalSelection(): Promise<void>;
  onUncertain(error: unknown): void;
}

export async function inspectObservedRecovery(
  fileSystem: CrashSafeFileSlotFileSystem,
  assertAuthority: () => void,
): Promise<ObservedRecoverySelection> {
  const check = checkedAuthority(assertAuthority);
  const identities = await observeIdentities(fileSystem, check);
  const source = priority.find(slot => identities[slot] !== undefined);
  let bytes: Uint8Array | undefined;
  if (source !== undefined) bytes = await readSelectedSource(fileSystem, source, identities[source]!, check);
  await assertIdentities(fileSystem, identities, check);
  return Object.freeze({ identities: Object.freeze(identities), source, bytes });
}

export async function recoverObservedSelection(
  fileSystem: CrashSafeFileSlotFileSystem,
  observation: ObservedRecoverySelection,
  authority: ObservedRecoveryAuthority,
): Promise<Readonly<{ bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> }>> {
  // Capture callbacks and caller-owned values before the first await.
  const check = checkedAuthority(authority.assertAuthority.bind(authority));
  const external = authority.assertExternalSelection.bind(authority);
  const uncertain = authority.onUncertain.bind(authority);
  let failed = false;
  let first: unknown;
  const fail = (error: unknown): never => {
    if (!failed) {
      failed = true; first = error;
      try { const result: unknown = uncertain(error); if (result !== undefined) void Promise.resolve(result).catch(() => undefined); }
      catch { /* The notification must not replace the original failure. */ }
    }
    throw first;
  };
  const assertAuthority = () => { if (failed) throw first; try { check(); } catch (error) { fail(error); } };
  try {
    const identities = captureIdentities(observation.identities);
    let source = priority.find(slot => identities[slot] !== undefined);
    if (source === undefined || source !== observation.source || !(observation.bytes instanceof Uint8Array) ||
        observation.bytes.byteLength < 1 || observation.bytes.byteLength !== identities[source]!.size) invalid();
    const bytes = Uint8Array.from(observation.bytes);
    const guard: CrashSafeFileSlotMutationGuard = { assertAuthority, async beforeMutation() {
      try {
        assertAuthority(); await external(); assertAuthority();
        await assertIdentities(fileSystem, identities, assertAuthority);
        const actual = await readSelectedSource(fileSystem, source!, identities[source!]!, assertAuthority);
        if (!sameBytes(bytes, actual)) invalid();
        await external(); assertAuthority();
      } catch (error) { fail(error); }
    } };
    await guard.beforeMutation();
    for (const slot of ['next', 'backup'] as const) {
      if (slot === source || identities[slot] === undefined) continue;
      if (!await fileSystem.removeSlot(slot, guard)) invalid();
      assertAuthority();
      identities[slot] = undefined;
      await guard.beforeMutation();
    }
    if (source !== 'current') {
      const previous = identities[source]!;
      await fileSystem.moveSlot(source, 'current', guard);
      assertAuthority();
      let moved: Readonly<CrashSafeFileSlotIdentity> | undefined;
      const actual = await fileSystem.readSlot('current', value => { moved = value; });
      assertAuthority();
      if (moved === undefined || moved.dev !== previous.dev || moved.ino !== previous.ino ||
          moved.size !== previous.size || moved.mtimeMs !== previous.mtimeMs || actual === undefined || !sameBytes(bytes, actual)) invalid();
      identities[source] = undefined;
      identities.current = Object.freeze({ ...moved });
      source = 'current';
    }
    await fileSystem.syncDirectory(guard);
    await guard.beforeMutation();
    return Object.freeze({ bytes, identity: Object.freeze({ ...identities.current! }) });
  } catch (error) { return fail(error); }
}

async function observeIdentities(fileSystem: CrashSafeFileSlotFileSystem, check: () => void): Promise<Identities> {
  const inspect = fileSystem.inspectSlotIdentity?.bind(fileSystem);
  if (inspect === undefined) invalid();
  const result: Identities = { current: undefined, backup: undefined, next: undefined };
  for (const slot of priority) {
    check(); const identity = await inspect(slot); check();
    result[slot] = identity === undefined ? undefined : captureIdentity(identity);
  }
  return result;
}

async function assertIdentities(fileSystem: CrashSafeFileSlotFileSystem, expected: Identities, check: () => void) {
  const actual = await observeIdentities(fileSystem, check);
  for (const slot of priority) {
    const before = expected[slot], after = actual[slot];
    if (before === undefined ? after !== undefined : after === undefined || !sameCrashSafeFileSlotIdentity(before, after)) invalid();
  }
}

async function readSelectedSource(fileSystem: CrashSafeFileSlotFileSystem, source: CrashSafeFileSlot,
  expected: Readonly<CrashSafeFileSlotIdentity>, check: () => void): Promise<Uint8Array> {
  check();
  let identity: Readonly<CrashSafeFileSlotIdentity> | undefined;
  const bytes = await fileSystem.readSlot(source, value => { identity = value; });
  check();
  if (bytes === undefined || identity === undefined || !sameCrashSafeFileSlotIdentity(expected, identity)) invalid();
  return Uint8Array.from(bytes);
}

function captureIdentities(value: Readonly<Identities>): Identities {
  return { current: value.current === undefined ? undefined : captureIdentity(value.current),
    backup: value.backup === undefined ? undefined : captureIdentity(value.backup),
    next: value.next === undefined ? undefined : captureIdentity(value.next) };
}

function captureIdentity(value: Readonly<CrashSafeFileSlotIdentity>): Readonly<CrashSafeFileSlotIdentity> {
  if (value.ino === 0 || !Number.isSafeInteger(value.size) || value.size < 0 ||
    ![value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].every(Number.isFinite)) invalid();
  return Object.freeze({ dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs });
}

function checkedAuthority(authority: () => void): () => void {
  return () => {
    const result: unknown = authority();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); invalid(); }
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function invalid(): never { throw new CrashSafeFileSlotError('invalid'); }
