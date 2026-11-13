import { isProxy as phaseWireIsProxy } from 'node:util/types';

// Private test observation only. It grants no work, cleanup or acceptance authority.
export const PHASE_WIRE_LIMITS = Object.freeze({ bytes: 32 * 1024, events: 64, active: 16 });
export const PHASE_WIRE_LEGACY_PHASES = Object.freeze(['preparation', 'sourceComparison', 'selectionHandoff',
  'journalPublication', 'fullSelection', 'slotIo', 'reservation'] as const);
export const PHASE_WIRE_PHASES = Object.freeze([...PHASE_WIRE_LEGACY_PHASES, 'finalization',
  'inventoryRetirement', 'terminalJournalClear', 'postClearVerification'] as const);
const phaseWireGroups = Object.freeze(['readSlot', 'prepareDirectory', 'inspectSlotIdentity', 'createNextWriter',
  'moveSlot', 'removeSlot', 'syncDirectory', 'writerReadIdentity', 'writerWrite', 'writerSync', 'writerClose']);
const phaseWireAttempts = Object.freeze(['fileOpen', 'fileStat', 'fileRead', 'fileWrite', 'fileSync', 'fileClose',
  'fileChmod', 'pathLstat', 'pathRealpath', 'pathMkdir', 'pathRename', 'pathRemove', 'pathChmod']);
type PhaseWirePhase = typeof PHASE_WIRE_PHASES[number];
type PhaseWireCounts = { entered: number; fulfilled: number; rejected: number };
export type PhaseWireSignal = Readonly<{ phase: PhaseWirePhase; operation: string; scope: 'group' | 'ioAttempt';
  event: 'entered' | 'fulfilled' | 'rejected'; callId: number }>;
type PhaseWireEvent = PhaseWireSignal & Readonly<{ sequence: number; atMs: number | null; durationMs: number | null }>;
type PhaseWireActive = Readonly<{ phase: PhaseWirePhase; operation: string; scope: 'group' | 'ioAttempt';
  callId: number; enteredSequence: number; atMs: number | null }>;
type PhaseWireCoverage = Readonly<Pick<PhaseWireSignal, 'phase' | 'operation' | 'scope'>>;
function phaseWireCatalog(phases: readonly PhaseWirePhase[]): readonly PhaseWireCoverage[] { return Object.freeze([
  ...phases.filter(phase => phase !== 'slotIo').map(phase =>
    Object.freeze({ phase, operation: 'phase', scope: 'group' as const })),
  ...phaseWireGroups.map(operation => Object.freeze({ phase: 'slotIo' as const, operation, scope: 'group' as const })),
  ...phaseWireAttempts.map(operation => Object.freeze({ phase: 'slotIo' as const, operation, scope: 'ioAttempt' as const })),
]); }
export const PHASE_WIRE_LEGACY_CATALOG = phaseWireCatalog(PHASE_WIRE_LEGACY_PHASES);
export const PHASE_WIRE_CATALOG = phaseWireCatalog(PHASE_WIRE_PHASES);
type PhaseWireVersion = 1 | 2;
type PhaseWirePolicy = Readonly<{ phases: readonly PhaseWirePhase[]; catalog: readonly PhaseWireCoverage[] }>;
const phaseWirePolicies = Object.freeze({
  1: Object.freeze({ phases: PHASE_WIRE_LEGACY_PHASES, catalog: PHASE_WIRE_LEGACY_CATALOG }),
  2: Object.freeze({ phases: PHASE_WIRE_PHASES, catalog: PHASE_WIRE_CATALOG }),
});
type PhaseWireOmissions = { eventLimit: boolean; activeLimit: boolean; counterOverflow: boolean;
  invalidSignal: boolean; lateCall: boolean; ambiguousInvocation: boolean; missingCoverage: boolean };
export type PhaseWireSnapshot = Readonly<{ state: 'captured' | 'partial';
  invocationState: 'notStarted' | 'observing' | 'ambiguous'; preparationAttempts: number; publicationAttempts: number;
  sequence: number; coverage: readonly PhaseWireCoverage[]; phases: Readonly<Record<PhaseWirePhase, Readonly<PhaseWireCounts>>>;
  watermarks: Readonly<Record<PhaseWirePhase, number>>;
  active: readonly PhaseWireActive[]; events: readonly PhaseWireEvent[];
  clock: Readonly<{ invalid: boolean; lastMs: number | null }>; shutdownSequence: number | null;
  omissions: Readonly<PhaseWireOmissions> }>;
export const phaseWireUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const phaseWireSignalKeys = ['phase', 'operation', 'scope', 'event', 'callId'];
const phaseWireOmissionKeys = ['eventLimit', 'activeLimit', 'counterOverflow', 'invalidSignal', 'lateCall', 'ambiguousInvocation', 'missingCoverage'];
export const phaseWireInteger = (value: unknown): value is number => typeof value === 'number' &&
  Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const phaseWireTime = (value: unknown): value is number | null => value === null ||
  (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER && !Object.is(value, -0));

export function phaseWireRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || phaseWireIsProxy(value) || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}

function phaseWireSignal(value: unknown, policy: PhaseWirePolicy, keys = phaseWireSignalKeys): PhaseWireSignal | undefined {
  if (!phaseWireRecord(value, keys) || !policy.phases.includes(value.phase as PhaseWirePhase) ||
      !['entered', 'fulfilled', 'rejected'].includes(value.event as string) ||
      !phaseWireInteger(value.callId) || value.callId < 1) return undefined;
  if (value.phase === 'slotIo') {
    const names = value.scope === 'group' ? phaseWireGroups : value.scope === 'ioAttempt' ? phaseWireAttempts : [];
    if (typeof value.operation !== 'string' || !names.includes(value.operation)) return undefined;
  } else if (value.scope !== 'group' || value.operation !== 'phase') return undefined;
  return Object.freeze({ phase: value.phase, operation: value.operation, scope: value.scope,
    event: value.event, callId: value.callId }) as PhaseWireSignal;
}

const phaseWireKey = (value: Pick<PhaseWireSignal, 'phase' | 'callId'>) => `${value.phase}:${value.callId}`;
const phaseWireCounters = (policy: PhaseWirePolicy) => Object.fromEntries(policy.phases.map(phase =>
  [phase, { entered: 0, fulfilled: 0, rejected: 0 }])) as Record<PhaseWirePhase, PhaseWireCounts>;
function phaseWireIncrement(value: number): number | undefined {
  return phaseWireInteger(value) && value < Number.MAX_SAFE_INTEGER ? value + 1 : undefined;
}

function phaseWireArray(value: unknown, maximum: number): value is unknown[] {
  if (value === null || typeof value !== 'object' || phaseWireIsProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === value.length + 1 && keys.every(key => key === 'length' ||
    (typeof key === 'string' && /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')));
}

function phaseWireCoverage(value: unknown, policy: PhaseWirePolicy): readonly PhaseWireCoverage[] | undefined {
  if (!phaseWireArray(value, policy.catalog.length)) return undefined;
  const copy: PhaseWireCoverage[] = [], seen = new Set<string>();
  for (const entry of value) {
    if (!phaseWireRecord(entry, ['phase', 'operation', 'scope'])) return undefined;
    const allowed = policy.catalog.find(item => item.phase === entry.phase &&
      item.operation === entry.operation && item.scope === entry.scope);
    if (allowed === undefined) return undefined;
    const key = `${allowed.phase}:${allowed.scope}:${allowed.operation}`;
    if (seen.has(key)) return undefined;
    seen.add(key); copy.push(Object.freeze({ ...allowed }));
  }
  return Object.freeze(copy);
}

export type LegacyPhaseWireSnapshot = Omit<PhaseWireSnapshot, 'phases' | 'watermarks'> & Readonly<{
  phases: Readonly<Record<typeof PHASE_WIRE_LEGACY_PHASES[number], Readonly<PhaseWireCounts>>>;
  watermarks: Readonly<Record<typeof PHASE_WIRE_LEGACY_PHASES[number], number>>;
}>;
export function phaseWireSnapshot(value: unknown, version: 1): LegacyPhaseWireSnapshot | undefined;
export function phaseWireSnapshot(value: unknown, version?: 2): PhaseWireSnapshot | undefined;
export function phaseWireSnapshot(value: unknown, version: PhaseWireVersion): LegacyPhaseWireSnapshot | PhaseWireSnapshot | undefined;
export function phaseWireSnapshot(value: unknown, version: PhaseWireVersion = 2): LegacyPhaseWireSnapshot | PhaseWireSnapshot | undefined {
  if (version !== 1 && version !== 2) return undefined;
  const policy = phaseWirePolicies[version];
  if (!phaseWireRecord(value, ['state', 'invocationState', 'preparationAttempts', 'publicationAttempts', 'sequence',
    'coverage', 'phases', 'watermarks', 'active', 'events', 'clock', 'shutdownSequence', 'omissions']) ||
      !['captured', 'partial'].includes(value.state as string) ||
      !['notStarted', 'observing', 'ambiguous'].includes(value.invocationState as string) ||
      !phaseWireInteger(value.preparationAttempts) || value.preparationAttempts > 2 ||
      !phaseWireInteger(value.publicationAttempts) || value.publicationAttempts > 2 || !phaseWireInteger(value.sequence) ||
      !phaseWireRecord(value.phases, policy.phases) || !phaseWireRecord(value.watermarks, policy.phases) ||
      !phaseWireArray(value.events, PHASE_WIRE_LIMITS.events) ||
      !phaseWireArray(value.active, PHASE_WIRE_LIMITS.active) ||
      !phaseWireRecord(value.clock, ['invalid', 'lastMs']) || typeof value.clock.invalid !== 'boolean' ||
      !phaseWireTime(value.clock.lastMs) || (value.clock.invalid && value.clock.lastMs !== null) ||
      !phaseWireRecord(value.omissions, phaseWireOmissionKeys) ||
      !Object.values(value.omissions).every(flag => typeof flag === 'boolean') ||
      !(value.shutdownSequence === null || (phaseWireInteger(value.shutdownSequence) && value.shutdownSequence > 0))) return undefined;
  const omissions = { ...value.omissions } as PhaseWireOmissions;
  const coverage = phaseWireCoverage(value.coverage, policy);
  if (coverage === undefined || omissions.missingCoverage !== (coverage.length !== policy.catalog.length)) return undefined;
  const partial = value.clock.invalid || Object.values(omissions).some(Boolean);
  if ((value.state === 'partial') !== partial ||
      (value.invocationState === 'ambiguous') !== omissions.ambiguousInvocation ||
      omissions.ambiguousInvocation !== (value.preparationAttempts === 2 || value.publicationAttempts === 2)) return undefined;
  const events: PhaseWireEvent[] = [], prefixActive = new Map<string, PhaseWireActive>();
  const prefixCounters = phaseWireCounters(policy), counters = phaseWireCounters(policy);
  const watermarks = Object.fromEntries(policy.phases.map(phase => [phase, 0])) as Record<PhaseWirePhase, number>;
  let sequence = 0, lastMs: number | null = null, nullClock = false;
  for (const raw of value.events) {
    const signal = phaseWireSignal(raw, policy, [...phaseWireSignalKeys, 'sequence', 'atMs', 'durationMs']);
    if (signal === undefined || !phaseWireRecord(raw, [...phaseWireSignalKeys, 'sequence', 'atMs', 'durationMs']) ||
        !phaseWireInteger(raw.sequence) || !phaseWireTime(raw.atMs) || !phaseWireTime(raw.durationMs)) return undefined;
    if (!coverage.some(item => item.phase === signal.phase && item.operation === signal.operation && item.scope === signal.scope)) return undefined;
    sequence++;
    if (sequence === value.shutdownSequence) sequence++;
    if (raw.sequence !== sequence || (raw.atMs === null && !value.clock.invalid) ||
        (events.length === 0 && raw.atMs !== null && raw.atMs !== 0) ||
        (nullClock && raw.atMs !== null) || (raw.atMs !== null && lastMs !== null && raw.atMs < lastMs)) return undefined;
    if (raw.atMs === null) nullClock = true;
    else lastMs = raw.atMs;
    const key = phaseWireKey(signal), start = prefixActive.get(key);
    if (signal.event === 'entered') {
      if (signal.callId <= watermarks[signal.phase] || raw.durationMs !== null ||
          prefixActive.size === PHASE_WIRE_LIMITS.active) return undefined;
      watermarks[signal.phase] = signal.callId;
      prefixActive.set(key, { phase: signal.phase, operation: signal.operation, scope: signal.scope,
        callId: signal.callId, enteredSequence: sequence, atMs: raw.atMs });
    } else {
      if (start === undefined || start.operation !== signal.operation || start.scope !== signal.scope) return undefined;
      const duration = raw.atMs === null || start.atMs === null ? null : raw.atMs - start.atMs;
      if (raw.durationMs !== duration) return undefined;
      prefixActive.delete(key);
    }
    prefixCounters[signal.phase][signal.event]++;
    events.push(Object.freeze({ ...signal, sequence, atMs: raw.atMs, durationMs: raw.durationMs }));
  }
  const prefixSequence = sequence;
  let total = 0;
  for (const phase of policy.phases) {
    const raw = value.phases[phase], watermark = value.watermarks[phase];
    if (!phaseWireRecord(raw, ['entered', 'fulfilled', 'rejected']) || !phaseWireInteger(watermark)) return undefined;
    for (const event of ['entered', 'fulfilled', 'rejected'] as const) {
      const count = raw[event];
      if (!phaseWireInteger(count) || count < prefixCounters[phase][event] ||
          (!omissions.eventLimit && count !== prefixCounters[phase][event])) return undefined;
      counters[phase][event] = count; total += count;
      if (!phaseWireInteger(total)) return undefined;
    }
    const counts = counters[phase], hasCoverage = coverage.some(item => item.phase === phase);
    if (!phaseWireInteger(counts.fulfilled + counts.rejected) || counts.fulfilled + counts.rejected > counts.entered ||
        watermark < watermarks[phase] || watermark < counts.entered ||
        (counts.entered === 0 && watermark !== 0) || (!hasCoverage && counts.entered !== 0) ||
        (!omissions.eventLimit && watermark !== watermarks[phase])) return undefined;
  }
  const finalSequence = total + (value.shutdownSequence === null ? 0 : 1);
  if (!phaseWireInteger(finalSequence) || finalSequence !== value.sequence ||
      (value.shutdownSequence !== null && value.shutdownSequence > finalSequence) ||
      (omissions.eventLimit && (events.length !== PHASE_WIRE_LIMITS.events || total <= events.length)) ||
      (!omissions.eventLimit && total !== events.length) ||
      (!value.clock.invalid && (omissions.eventLimit ? value.clock.lastMs === null ||
        (lastMs !== null && value.clock.lastMs < lastMs) : value.clock.lastMs !== lastMs))) return undefined;
  const notStarted = events.length === 0;
  if (value.publicationAttempts === 2 && counters.journalPublication.entered !== 1) return undefined;
  if ((value.invocationState === 'notStarted') !== notStarted ||
      (notStarted && (value.preparationAttempts !== 0 || value.publicationAttempts !== 0)) ||
      (!notStarted && (events[0]!.phase !== 'preparation' || events[0]!.event !== 'entered' ||
        counters.preparation.entered !== 1 || counters.journalPublication.entered > 1 ||
        value.preparationAttempts !== (omissions.ambiguousInvocation && value.preparationAttempts === 2 ? 2 : 1) ||
        value.publicationAttempts !== (omissions.ambiguousInvocation && value.publicationAttempts === 2 ? 2 : counters.journalPublication.entered)))) return undefined;
  const activeCopy: PhaseWireActive[] = [], activeKeys = new Set<string>(), activeSequences = new Set<number>();
  const activeCounts = Object.fromEntries(policy.phases.map(phase => [phase, 0])) as Record<PhaseWirePhase, number>;
  for (const raw of value.active) {
    if (!phaseWireRecord(raw, ['phase', 'operation', 'scope', 'callId', 'enteredSequence', 'atMs']) ||
        !phaseWireInteger(raw.enteredSequence) || raw.enteredSequence < 1 || raw.enteredSequence > finalSequence ||
        raw.enteredSequence === value.shutdownSequence || !phaseWireTime(raw.atMs) ||
        (raw.atMs === null && !value.clock.invalid) ||
        (!value.clock.invalid && raw.atMs !== null && value.clock.lastMs !== null && raw.atMs > value.clock.lastMs)) return undefined;
    const signal = phaseWireSignal({ phase: raw.phase, operation: raw.operation, scope: raw.scope, callId: raw.callId, event: 'entered' }, policy);
    if (signal === undefined || !coverage.some(item => item.phase === signal.phase && item.operation === signal.operation && item.scope === signal.scope) ||
        signal.callId > (value.watermarks[signal.phase] as number)) return undefined;
    const key = phaseWireKey(signal), expected = prefixActive.get(key);
    if (activeKeys.has(key) || activeSequences.has(raw.enteredSequence) ||
        (raw.enteredSequence <= prefixSequence ? expected === undefined ||
        !Object.entries(expected).every(([field, part]) => raw[field] === part) :
        signal.callId <= watermarks[signal.phase] || (raw.atMs !== null && (nullClock || (lastMs !== null && raw.atMs < lastMs))))) return undefined;
    activeKeys.add(key); activeSequences.add(raw.enteredSequence); activeCounts[signal.phase]++;
    activeCopy.push(Object.freeze({ phase: signal.phase, operation: signal.operation, scope: signal.scope,
      callId: signal.callId, enteredSequence: raw.enteredSequence, atMs: raw.atMs }));
  }
  for (const phase of policy.phases) {
    if (activeCounts[phase] !== counters[phase].entered - counters[phase].fulfilled - counters[phase].rejected) return undefined;
    Object.freeze(counters[phase]); watermarks[phase] = value.watermarks[phase] as number;
  }
  if (omissions.activeLimit && activeCopy.length !== PHASE_WIRE_LIMITS.active) return undefined;
  return Object.freeze({ state: value.state, invocationState: value.invocationState,
    preparationAttempts: value.preparationAttempts, publicationAttempts: value.publicationAttempts,
    sequence: finalSequence, coverage, phases: Object.freeze(counters), watermarks: Object.freeze(watermarks),
    active: Object.freeze(activeCopy), events: Object.freeze(events),
    clock: Object.freeze({ invalid: value.clock.invalid, lastMs: value.clock.lastMs }),
    shutdownSequence: value.shutdownSequence, omissions: Object.freeze(omissions) }) as PhaseWireSnapshot;
}

export const phaseWireLegacySnapshot = (value: unknown) => phaseWireSnapshot(value, 1);

export type WorkspaceDeletionRawPhaseSnapshot = Readonly<{ schemaVersion: 2; runtimeInstanceId: string; invocation: 1;
  availability: 'captured'; snapshot: PhaseWireSnapshot }>;
function copyWorkspaceDeletionRawSnapshot(value: unknown, runtimeInstanceId: string): WorkspaceDeletionRawPhaseSnapshot | undefined {
  if (!phaseWireRecord(value, ['schemaVersion', 'runtimeInstanceId', 'invocation', 'availability', 'snapshot']) || value.schemaVersion !== 2 ||
      value.runtimeInstanceId !== runtimeInstanceId || value.invocation !== 1 || value.availability !== 'captured') return undefined;
  const snapshot = phaseWireSnapshot(value.snapshot);
  return snapshot === undefined ? undefined : Object.freeze({ schemaVersion: 2, runtimeInstanceId, invocation: 1, availability: 'captured', snapshot });
}
export const WORKSPACE_DELETION_MAIN_PHASE_COVERAGE = Object.freeze(PHASE_WIRE_CATALOG.filter(item =>
  item.phase !== 'slotIo' || !['pathLstat', 'pathRealpath', 'pathMkdir', 'pathChmod'].includes(item.operation)));

export function createWorkspaceDeletionRawPhaseRecorder(runtimeInstanceId: string, now: () => number, declaredCoverage: unknown) {
  if (typeof runtimeInstanceId !== 'string' || !phaseWireUuid.test(runtimeInstanceId)) throw new Error('INVALID_PHASE_RUNTIME');
  const binding = Object.freeze({ runtimeInstanceId });
  const policy = phaseWirePolicies[2];
  const top = { schemaVersion: 2 as const, runtimeInstanceId, invocation: 1 as const };
  const coverage = phaseWireCoverage(declaredCoverage, policy);
  if (coverage === undefined) throw new Error('INVALID_PHASE_WIRE_COVERAGE');
  const phases = phaseWireCounters(policy), events: PhaseWireEvent[] = [], active = new Map<string, PhaseWireActive>();
  const watermarks = Object.fromEntries(PHASE_WIRE_PHASES.map(phase => [phase, 0])) as Record<PhaseWirePhase, number>;
  const omissions: PhaseWireOmissions = { eventLimit: false, activeLimit: false, counterOverflow: false,
    invalidSignal: false, lateCall: false, ambiguousInvocation: false,
    missingCoverage: coverage.length !== PHASE_WIRE_CATALOG.length };
  let preparationAttempts = 0, publicationAttempts = 0, sequence = 0, shutdownSequence: number | null = null;
  let origin: number | undefined, previous: number | undefined, lastMs: number | null = null, clockInvalid = false;
  let stopped = false, frozen: WorkspaceDeletionRawPhaseSnapshot | undefined;
  const stop = (reason: keyof PhaseWireOmissions) => { omissions[reason] = true; stopped = true; };
  const tick = () => {
    if (clockInvalid) return null;
    try {
      const value = now();
      if (!phaseWireTime(value) || value === null || (previous !== undefined && value < previous)) throw new Error();
      origin ??= value; previous = value;
      const relative = value - origin;
      if (!phaseWireTime(relative)) throw new Error();
      lastMs = relative; return relative;
    } catch { clockInvalid = true; lastMs = null; return null; }
  };
  const snapshot = (): WorkspaceDeletionRawPhaseSnapshot => {
    if (frozen !== undefined) return frozen;
    const value = { ...top, availability: 'captured', snapshot: {
      state: clockInvalid || Object.values(omissions).some(Boolean) ? 'partial' : 'captured',
      invocationState: omissions.ambiguousInvocation ? 'ambiguous' : preparationAttempts === 0 ? 'notStarted' : 'observing',
      preparationAttempts, publicationAttempts, sequence, coverage, phases, watermarks, active: [...active.values()], events,
      clock: { invalid: clockInvalid, lastMs }, shutdownSequence, omissions } };
    const copy = copyWorkspaceDeletionRawSnapshot(value, binding.runtimeInstanceId);
    if (copy === undefined || Buffer.byteLength(JSON.stringify(copy), 'utf8') > PHASE_WIRE_LIMITS.bytes) throw new Error('INVALID_PHASE_WIRE_SNAPSHOT');
    return copy;
  };
  const recorder = Object.freeze({
    observe(runtimeInstanceId: string, value: unknown): void {
      if (runtimeInstanceId !== binding.runtimeInstanceId || frozen !== undefined || stopped) return;
      let signal: PhaseWireSignal | undefined;
      try { signal = phaseWireSignal(value, policy); } catch { /* Never run producer-supplied accessors or proxy traps. */ }
      if (signal === undefined) { stop('invalidSignal'); return; }
      if (!coverage.some(item => item.phase === signal!.phase && item.operation === signal!.operation && item.scope === signal!.scope)) {
        stop('invalidSignal'); return;
      }
      if (preparationAttempts === 0 && !(signal.phase === 'preparation' && signal.event === 'entered')) return;
      if (signal.event === 'entered' && (signal.phase === 'preparation' || signal.phase === 'journalPublication')) {
        const repeated = signal.phase === 'preparation' ? preparationAttempts === 1 : publicationAttempts === 1;
        if (repeated) {
          if (signal.phase === 'preparation') preparationAttempts = 2; else publicationAttempts = 2;
          stop('ambiguousInvocation'); return;
        }
      }
      const key = phaseWireKey(signal), start = active.get(key);
      if (signal.event === 'entered' ? signal.callId <= watermarks[signal.phase] : start === undefined ||
          start.operation !== signal.operation || start.scope !== signal.scope) { stop('lateCall'); return; }
      if (signal.event === 'entered' && active.size === PHASE_WIRE_LIMITS.active) { stop('activeLimit'); return; }
      const next = phaseWireIncrement(sequence), count = phaseWireIncrement(phases[signal.phase][signal.event]);
      if (next === undefined || count === undefined) { stop('counterOverflow'); return; }
      const atMs = tick(), durationMs = signal.event === 'entered' || atMs === null || start?.atMs == null ? null : atMs - start.atMs;
      sequence = next; phases[signal.phase][signal.event] = count;
      if (signal.event === 'entered') {
        if (signal.phase === 'preparation') preparationAttempts = 1;
        if (signal.phase === 'journalPublication') publicationAttempts = 1;
        watermarks[signal.phase] = signal.callId;
        active.set(key, { phase: signal.phase, operation: signal.operation, scope: signal.scope,
          callId: signal.callId, enteredSequence: sequence, atMs });
      } else active.delete(key);
      if (events.length === PHASE_WIRE_LIMITS.events) omissions.eventLimit = true;
      else events.push({ ...signal, sequence, atMs, durationMs });
    },
    observePhase(runtimeInstanceId: string, value: unknown): void {
      if (runtimeInstanceId !== binding.runtimeInstanceId || frozen !== undefined || stopped) return;
      recorder.observe(runtimeInstanceId, phaseWireRecord(value, ['phase', 'event', 'callId'])
        ? { phase: value.phase, event: value.event, callId: value.callId, operation: 'phase', scope: 'group' } : undefined);
    },
    observeSlotIo(runtimeInstanceId: string, value: unknown): void {
      if (runtimeInstanceId !== binding.runtimeInstanceId || frozen !== undefined || stopped) return;
      recorder.observe(runtimeInstanceId, phaseWireRecord(value, ['operation', 'scope', 'event', 'callId'])
        ? { phase: 'slotIo', operation: value.operation, scope: value.scope, event: value.event, callId: value.callId } : undefined);
    },
    markShutdown(runtimeInstanceId: string): void {
      if (runtimeInstanceId !== binding.runtimeInstanceId || frozen !== undefined || shutdownSequence !== null) return;
      const next = phaseWireIncrement(sequence);
      if (next === undefined) { stop('counterOverflow'); return; }
      shutdownSequence = sequence = next;
    },
    snapshot,
    freeze() { frozen ??= snapshot(); return frozen; },
  });
  return recorder;
}
