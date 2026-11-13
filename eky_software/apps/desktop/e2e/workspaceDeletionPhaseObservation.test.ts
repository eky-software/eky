import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';
import type { TestContext } from 'vitest';

import { PHASE_WIRE_CATALOG, PHASE_WIRE_LEGACY_CATALOG, PHASE_WIRE_LEGACY_PHASES,
  PHASE_WIRE_LIMITS, PHASE_WIRE_PHASES, WORKSPACE_DELETION_MAIN_PHASE_COVERAGE,
  createWorkspaceDeletionRawPhaseRecorder, phaseWireLegacySnapshot, phaseWireSnapshot } from './workspaceDeletionPhaseObservation.js';
import { bindPhaseHandoffCapture, capturePhaseHandoffExpected,
  deliverPhaseHandoffObservation, encodePhaseHandoffEnvelope, parsePhaseHandoffEnvelope,
  validatePhaseHandoffCollector, validatePhaseHandoffParent } from './workspaceDeletionPhaseHandoff.js';
import type { PhaseHandoffExpected } from './workspaceDeletionPhaseHandoff.js';
import type { LegacyPhaseWireSnapshot, PhaseWireSignal,
  WorkspaceDeletionRawPhaseSnapshot } from './workspaceDeletionPhaseObservation.js';

const runtime = '11111111-1111-4111-8111-111111111111';
const otherRuntime = '44444444-4444-4444-8444-444444444444';
const runName = 'run-33333333-3333-4333-8333-333333333333';
const expected: PhaseHandoffExpected = Object.freeze({
  selection: Object.freeze({ runtimeInstanceId: runtime, scenarioId: 'DESK-DELETE-RECOVERY-001', testAttempt: 1, repeatEachIndex: 2 }),
  delivery: Object.freeze({ binding: Object.freeze({ kind: 'local' }), relativePath: `${runName}/synthetic-case/failure.private.json` }),
});
const ciEnv: Record<string, string | undefined> = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765',
  GITHUB_RUN_ATTEMPT: '3', GITHUB_JOB: 'phase-observation', EKY_EVIDENCE_JOB_KEY: 'phase-observation-0', GITHUB_SHA: 'a'.repeat(40) };
const job = { runId: '98765', attempt: '3', job: 'phase-observation', jobKey: 'phase-observation-0', sourceRevision: 'a'.repeat(40) };
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');
const signal = (phase: PhaseWireSignal['phase'], callId: number, event: PhaseWireSignal['event'] = 'entered',
  operation = 'phase', scope: PhaseWireSignal['scope'] = 'group'): PhaseWireSignal => ({ phase, callId, event, operation, scope });
const recorder = (now = () => 100, coverage: unknown = PHASE_WIRE_CATALOG) =>
  createWorkspaceDeletionRawPhaseRecorder(runtime, now, coverage);
const terminalPhases = ['finalization', 'inventoryRetirement', 'terminalJournalClear', 'postClearVerification'] as const;
function legacyRaw() {
  const snapshot: LegacyPhaseWireSnapshot = {
    state: 'captured', invocationState: 'observing', preparationAttempts: 1, publicationAttempts: 0,
    sequence: 2, coverage: PHASE_WIRE_LEGACY_CATALOG,
    phases: { preparation: { entered: 1, fulfilled: 1, rejected: 0 },
      sourceComparison: { entered: 0, fulfilled: 0, rejected: 0 }, selectionHandoff: { entered: 0, fulfilled: 0, rejected: 0 },
      journalPublication: { entered: 0, fulfilled: 0, rejected: 0 }, fullSelection: { entered: 0, fulfilled: 0, rejected: 0 },
      slotIo: { entered: 0, fulfilled: 0, rejected: 0 }, reservation: { entered: 0, fulfilled: 0, rejected: 0 } },
    watermarks: { preparation: 1, sourceComparison: 0, selectionHandoff: 0, journalPublication: 0,
      fullSelection: 0, slotIo: 0, reservation: 0 }, active: [],
    events: [{ ...signal('preparation', 1), sequence: 1, atMs: 0, durationMs: null },
      { ...signal('preparation', 1, 'fulfilled'), sequence: 2, atMs: 1, durationMs: 1 }],
    clock: { invalid: false, lastMs: 1 }, shutdownSequence: null,
    omissions: { eventLimit: false, activeLimit: false, counterOverflow: false, invalidSignal: false,
      lateCall: false, ambiguousInvocation: false, missingCoverage: false },
  };
  return { runtimeInstanceId: runtime, invocation: 1 as const, availability: 'captured' as const, snapshot };
}
function validRaw() {
  const raw = recorder();
  raw.observePhase(runtime, { phase: 'preparation', event: 'entered', callId: 1 });
  raw.observePhase(runtime, { phase: 'preparation', event: 'fulfilled', callId: 1 });
  return raw.freeze();
}
function envelope(raw: WorkspaceDeletionRawPhaseSnapshot = validRaw(), context = expected) {
  const result = bindPhaseHandoffCapture(raw, context);
  if (result === undefined) throw new Error('SYNTHETIC_CAPTURE_MISSING');
  return result;
}
function roundtrip(raw: WorkspaceDeletionRawPhaseSnapshot) {
  const value = envelope(raw), text = encodePhaseHandoffEnvelope(value, expected);
  expect(text).toBeTypeOf('string');
  expect(Buffer.byteLength(text!, 'utf8')).toBeLessThanOrEqual(PHASE_WIRE_LIMITS.bytes);
  expect(parsePhaseHandoffEnvelope(Buffer.from(text!))).toEqual(value);
  return raw.snapshot;
}
function corrupt(path: readonly string[], replacement: unknown, input: unknown = envelope()) {
  const value = structuredClone(input) as Record<string, unknown>;
  let node = value;
  for (const part of path.slice(0, -1)) node = node[part] as Record<string, unknown>;
  node[path.at(-1)!] = replacement;
  return value;
}
async function tempFixture(context: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eky-phase-observation-')));
  let completed = false;
  context.onTestFinished(async result => {
    if (completed && result.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  return { root, complete() { completed = true; } };
}
async function deliveryFixture(context: TestContext, env: Record<string, string | undefined> = ciEnv) {
  const f = await tempFixture(context), runDirectory = join(f.root, runName);
  const attemptDirectory = join(runDirectory, 'synthetic-case-electron-development-retry1');
  await mkdir(attemptDirectory, { recursive: true });
  const testInfo = { retry: 1, repeatEachIndex: 2, project: { outputDir: runDirectory },
    outputPath: (name: string) => join(attemptDirectory, name) };
  const input = { runtimeInstanceId: String(runtime), scenarioId: 'DESK-DELETE-RECOVERY-001' as const, testInfo, env };
  const captured = capturePhaseHandoffExpected(input);
  const delivery: Parameters<typeof deliverPhaseHandoffObservation>[0] = { ...captured, failed: true };
  return { ...f, input, captured, path: testInfo.outputPath('failure.private.json'), delivery };
}

it('keeps v1 legacy maps exact and read-only while producing explicit raw2 and envelope2', () => {
  expect(PHASE_WIRE_LEGACY_PHASES).toEqual(['preparation', 'sourceComparison', 'selectionHandoff',
    'journalPublication', 'fullSelection', 'slotIo', 'reservation']);
  const old = legacyRaw(), legacy = bindPhaseHandoffCapture(old, expected)!;
  expect(legacy).toEqual({ schemaVersion: 1, kind: 'workspaceDeletionPhaseObservation', ...expected,
    invocation: 1, availability: 'captured', snapshot: old.snapshot });
  expect(phaseWireSnapshot(old.snapshot, 1)).toEqual(old.snapshot);
  expect(phaseWireLegacySnapshot(old.snapshot)).toEqual(old.snapshot);
  expect(phaseWireSnapshot(old.snapshot)).toBeUndefined();
  expect(phaseWireSnapshot(old.snapshot, 2)).toBeUndefined();
  const encoded = encodePhaseHandoffEnvelope(legacy, expected)!;
  expect(parsePhaseHandoffEnvelope(Buffer.from(encoded))).toEqual(legacy);
  if (legacy.availability !== 'captured') throw new Error('SYNTHETIC_CAPTURE_MISSING');
  expect(Object.keys(legacy.snapshot.phases)).toEqual([...PHASE_WIRE_LEGACY_PHASES]);
  expect(Object.keys(legacy.snapshot.watermarks)).toEqual([...PHASE_WIRE_LEGACY_PHASES]);
  expect(Object.isFrozen(legacy.snapshot.phases)).toBe(true);
  expect(Object.isFrozen(legacy.snapshot.watermarks)).toBe(true);
  expect(legacy.snapshot.phases).not.toHaveProperty('finalization');
  const current = validRaw(), currentEnvelope = envelope(current);
  expect(current.schemaVersion).toBe(2); expect(currentEnvelope.schemaVersion).toBe(2);
  expect(Object.keys(current.snapshot.phases)).toEqual([...PHASE_WIRE_PHASES]);
  expect(phaseWireSnapshot(current.snapshot, 1)).toBeUndefined();
  for (const value of [{ ...legacy, schemaVersion: 2 }, { ...currentEnvelope, schemaVersion: 1 }]) {
    expect(parsePhaseHandoffEnvelope(bytes(value))).toBeUndefined();
    expect(encodePhaseHandoffEnvelope(value, expected)).toBeUndefined();
  }
  const { schemaVersion: _version, ...unversioned } = current;
  expect(bindPhaseHandoffCapture(unversioned, expected)).toBeUndefined();
  expect(bindPhaseHandoffCapture({ ...old, schemaVersion: 1 }, expected)).toBeUndefined();
  expect(bindPhaseHandoffCapture({ ...old, schemaVersion: 2 }, expected)).toBeUndefined();
  for (const value of [PHASE_WIRE_PHASES, PHASE_WIRE_LEGACY_PHASES, PHASE_WIRE_CATALOG, PHASE_WIRE_LEGACY_CATALOG])
    expect(Object.isFrozen(value)).toBe(true);
  expect(PHASE_WIRE_LIMITS).toEqual({ bytes: 32768, events: 64, active: 16 });
});

it.each([0, 3, -1, '1', '2', null, NaN, {}, true])('rejects unknown snapshot and envelope version %s', version => {
  for (const value of [legacyRaw().snapshot, validRaw().snapshot]) {
    expect(() => phaseWireSnapshot(value, version as never)).not.toThrow();
    expect(phaseWireSnapshot(value, version as never)).toBeUndefined();
  }
  for (const raw of [legacyRaw(), validRaw()]) {
    expect(bindPhaseHandoffCapture({ ...raw, schemaVersion: version }, expected)).toBeUndefined();
  }
  for (const value of [bindPhaseHandoffCapture(legacyRaw(), expected), envelope()]) {
    const invalid = { ...value, schemaVersion: version };
    expect(parsePhaseHandoffEnvelope(bytes(invalid))).toBeUndefined();
    expect(encodePhaseHandoffEnvelope(invalid, expected)).toBeUndefined();
  }
});

it.for([1, 2] as const)('reads unavailable v%s without inventing observed work', version => {
  const unavailable = { schemaVersion: version, kind: 'workspaceDeletionPhaseObservation', ...expected,
    invocation: 1, availability: 'unavailable' };
  expect(parsePhaseHandoffEnvelope(bytes(unavailable))).toEqual(unavailable);
  expect(encodePhaseHandoffEnvelope(unavailable, expected)).toBe(JSON.stringify(unavailable));
  expect(parsePhaseHandoffEnvelope(bytes({ ...unavailable, snapshot: legacyRaw().snapshot }))).toBeUndefined();
});

it.each([
  ['missing counter', ['snapshot', 'phases', 'reservation'], undefined],
  ['unknown counter', ['snapshot', 'phases', 'extra'], { entered: 0, fulfilled: 0, rejected: 0 }],
  ['unknown watermark', ['snapshot', 'watermarks', 'extra'], 0],
  ['clock mismatch', ['snapshot', 'clock', 'lastMs'], 999],
  ['prefix sequence', ['snapshot', 'events', '0', 'sequence'], 9],
  ['prefix duration', ['snapshot', 'events', '1', 'durationMs'], 99],
  ['omissions inconsistency', ['snapshot', 'omissions', 'missingCoverage'], true],
  ['missing omission', ['snapshot', 'omissions', 'lateCall'], undefined],
  ['invalid active', ['snapshot', 'active'], [{ phase: 'reservation', operation: 'phase', scope: 'group',
    callId: 99, enteredSequence: 1, atMs: 0 }]],
  ['active limit', ['snapshot', 'active'], Array.from({ length: 17 }, () => ({}))],
  ['event limit', ['snapshot', 'events'], Array.from({ length: 65 }, () => ({}))],
  ['counter underflow', ['snapshot', 'phases', 'preparation', 'entered'], 0],
  ['terminal coverage with seven maps', ['snapshot', 'coverage'], [...PHASE_WIRE_LEGACY_CATALOG,
    { phase: 'finalization', operation: 'phase', scope: 'group' }]],
  ['terminal entered event', ['snapshot', 'events', '0', 'phase'], 'finalization'],
  ['terminal fulfilled event', ['snapshot', 'events', '1', 'phase'], 'terminalJournalClear'],
  ['terminal active', ['snapshot', 'active'], [{ phase: 'inventoryRetirement', operation: 'phase', scope: 'group',
    callId: 1, enteredSequence: 2, atMs: 1 }]],
  ['terminal zero watermark', ['snapshot', 'watermarks', 'postClearVerification'], 0],
  ['terminal zero counter', ['snapshot', 'phases', 'terminalJournalClear'], { entered: 0, fulfilled: 0, rejected: 0 }],
] as const)('rejects malformed legacy %s without throwing or normalizing', (_label, path, replacement) => {
  const invalid = corrupt(path, replacement, bindPhaseHandoffCapture(legacyRaw(), expected));
  expect(() => phaseWireSnapshot(invalid.snapshot, 1)).not.toThrow();
  expect(phaseWireLegacySnapshot(invalid.snapshot)).toBeUndefined();
  expect(encodePhaseHandoffEnvelope(invalid, expected)).toBeUndefined();
  expect(parsePhaseHandoffEnvelope(bytes(invalid))).toBeUndefined();
});

it.for(terminalPhases)('keeps %s active start and counts after the full event prefix', phase => {
  let time = 100;
  const raw = recorder(() => time++);
  raw.observePhase(runtime, { phase: 'preparation', callId: 1, event: 'entered' });
  raw.observePhase(runtime, { phase: 'preparation', callId: 1, event: 'fulfilled' });
  for (let id = 1; id <= 40; id++) {
    raw.observePhase(runtime, { phase: 'reservation', callId: id, event: 'entered' });
    raw.observePhase(runtime, { phase: 'reservation', callId: id, event: 'fulfilled' });
  }
  raw.observePhase(otherRuntime, { phase, callId: 1, event: 'entered' });
  expect(raw.snapshot().snapshot.phases[phase].entered).toBe(0);
  raw.observePhase(runtime, { phase, callId: 1, event: 'entered' });
  const first = raw.snapshot();
  raw.observePhase(runtime, { phase: 'reservation', callId: 41, event: 'entered' });
  raw.observePhase(runtime, { phase: 'reservation', callId: 41, event: 'fulfilled' });
  const snapshot = roundtrip(raw.snapshot());
  expect(snapshot.active).toEqual([{ phase, operation: 'phase', scope: 'group', callId: 1,
    enteredSequence: 83, atMs: 82 }]);
  expect(snapshot.active).toEqual(first.snapshot.active);
  expect(snapshot.clock.lastMs).toBe(84);
  expect(snapshot.events).toHaveLength(64); expect(snapshot.omissions.eventLimit).toBe(true);
  expect(snapshot.phases[phase]).toEqual({ entered: 1, fulfilled: 0, rejected: 0 });
  expect(snapshot.watermarks[phase]).toBe(1);
  const captured = envelope(raw.snapshot());
  for (const [path, value] of [
    [['snapshot', 'active', '0', 'enteredSequence'], 1],
    [['snapshot', 'active', '0', 'atMs'], 61],
    [['snapshot', 'active', '0', 'callId'], 2],
    [['snapshot', 'watermarks', phase], 0],
    [['snapshot', 'phases', phase, 'entered'], 0],
  ] as const) {
    const invalid = corrupt(path, value, captured);
    expect(encodePhaseHandoffEnvelope(invalid, expected)).toBeUndefined();
    expect(parsePhaseHandoffEnvelope(bytes(invalid))).toBeUndefined();
  }
  raw.markShutdown(runtime);
  raw.observePhase(runtime, { phase, callId: 1, event: 'fulfilled' });
  const done = roundtrip(raw.freeze());
  expect(done.phases[phase]).toEqual({ entered: 1, fulfilled: 1, rejected: 0 });
  expect(done.active).toEqual([]); expect(done.shutdownSequence).toBe(86);
  expect(done.events.some(event => event.phase === phase)).toBe(false);
  expect(done.clock.lastMs).toBe(85);
});

it.for(terminalPhases)('requires every v2 %s counter and watermark without field filling', phase => {
  for (const map of ['phases', 'watermarks'] as const) {
    const value = structuredClone(validRaw());
    delete (value.snapshot[map] as Record<string, unknown>)[phase];
    expect(phaseWireSnapshot(value.snapshot)).toBeUndefined();
    expect(bindPhaseHandoffCapture(value, expected)).toBeUndefined();
  }
});

it.for([1, 2] as const)('rejects proxy and accessor snapshots without executing them in v%s', version => {
  const snapshot = version === 1 ? legacyRaw().snapshot : validRaw().snapshot;
  const trap = vi.fn(() => { throw new Error('SYNTHETIC_SNAPSHOT_TRAP'); });
  const getter = Object.defineProperty({ ...snapshot }, 'state', { get: trap });
  const proxy = new Proxy(snapshot, { ownKeys: trap, get: trap });
  for (const value of [getter, proxy]) expect(phaseWireSnapshot(value, version)).toBeUndefined();
  expect(trap).not.toHaveBeenCalled();
});

it('roundtrips all eleven phases and keeps group and I/O attempt durations separate', () => {
  let time = 100;
  const raw = recorder(() => time++);
  const ids = Object.fromEntries(PHASE_WIRE_PHASES.map(phase => [phase, 0])) as Record<PhaseWireSignal['phase'], number>;
  for (const item of PHASE_WIRE_CATALOG) {
    const id = ++ids[item.phase];
    raw.observe(runtime, { ...item, callId: id, event: 'entered' });
    raw.observe(runtime, { ...item, callId: id, event: id % 2 ? 'fulfilled' : 'rejected' });
  }
  const snapshot = roundtrip(raw.freeze());
  expect(snapshot.state).toBe('partial');
  expect(snapshot.omissions.eventLimit).toBe(true); expect(snapshot.events).toHaveLength(64);
  expect(snapshot.active).toEqual([]);
  expect(Object.keys(snapshot.phases)).toEqual([...PHASE_WIRE_PHASES]);
  expect(snapshot.events.filter(event => event.event !== 'entered').every(event => event.durationMs === 1)).toBe(true);
});

it('distinguishes unavailable, validated notStarted and the four deliberately unwired leaves', () => {
  const raw = recorder();
  raw.observe(runtime, signal('reservation', 1));
  raw.observe(runtime, signal('reservation', 1, 'fulfilled'));
  const snapshot = roundtrip(raw.snapshot());
  expect(snapshot.invocationState).toBe('notStarted');
  expect(snapshot.events).toEqual([]);
  expect(snapshot.clock).toEqual({ invalid: false, lastMs: null });
  const unavailable = { schemaVersion: 1, kind: 'workspaceDeletionPhaseObservation', ...expected, invocation: 1, availability: 'unavailable' };
  expect(parsePhaseHandoffEnvelope(bytes(unavailable))).toEqual(unavailable);
  expect(parsePhaseHandoffEnvelope(bytes({ ...unavailable, snapshot }))).toBeUndefined();
  expect(parsePhaseHandoffEnvelope(bytes({ ...unavailable, availability: 'captured' }))).toBeUndefined();
  const coverage = WORKSPACE_DELETION_MAIN_PHASE_COVERAGE;
  expect(PHASE_WIRE_CATALOG.filter(item => !coverage.includes(item)).map(item => item.operation))
    .toEqual(['pathLstat', 'pathRealpath', 'pathMkdir', 'pathChmod']);
  expect(new Set(coverage.map(item => item.phase))).toEqual(new Set(PHASE_WIRE_PHASES));
  const partial = recorder(() => 0, coverage);
  expect(roundtrip(partial.snapshot()).omissions.missingCoverage).toBe(true);
  expect(partial.snapshot().snapshot.state).toBe('partial');
  partial.observe(runtime, signal('preparation', 1));
  partial.observeSlotIo(runtime, { operation: 'pathLstat', scope: 'ioAttempt', event: 'entered', callId: 1 });
  expect(roundtrip(partial.freeze()).omissions.invalidSignal).toBe(true);
  expect(() => recorder(() => 0, [PHASE_WIRE_CATALOG[0], PHASE_WIRE_CATALOG[0]])).toThrow('INVALID_PHASE_WIRE_COVERAGE');
  expect(() => createWorkspaceDeletionRawPhaseRecorder('not-a-runtime', () => 0, coverage)).toThrow('INVALID_PHASE_RUNTIME');
});

it.each([
  ['unknown top', ['error'], 'SYNTHETIC_EXCLUDED'], ['unknown snapshot', ['snapshot', 'path'], 'SYNTHETIC_EXCLUDED'],
  ['unknown selection', ['selection', 'extra'], 0], ['unknown delivery', ['delivery', 'extra'], 0],
  ['unknown job', ['delivery', 'binding', 'extra'], 0], ['unknown phase', ['snapshot', 'phases', 'other'], {}],
  ['unknown count', ['snapshot', 'phases', 'preparation', 'duration'], 0],
  ['unknown omission', ['snapshot', 'omissions', 'other'], true], ['unknown clock', ['snapshot', 'clock', 'now'], 0],
  ['unknown event', ['snapshot', 'events', '0', 'result'], 'SYNTHETIC_EXCLUDED'],
  ['schema', ['schemaVersion'], '1'], ['kind', ['kind'], 'other'], ['invocation', ['invocation'], 2],
  ['availability', ['availability'], 'other'], ['partial without reason', ['snapshot', 'state'], 'partial'],
  ['phase', ['snapshot', 'events', '0', 'phase'], 'other'], ['operation', ['snapshot', 'events', '0', 'operation'], 'fileWrite'],
  ['scope', ['snapshot', 'events', '0', 'scope'], 'ioAttempt'], ['event', ['snapshot', 'events', '0', 'event'], 'complete'],
  ['zero call', ['snapshot', 'events', '0', 'callId'], 0], ['string call', ['snapshot', 'events', '0', 'callId'], '1'],
  ['unsafe call', ['snapshot', 'events', '0', 'callId'], Number.MAX_SAFE_INTEGER + 1],
  ['negative count', ['snapshot', 'phases', 'preparation', 'entered'], -1],
  ['unsafe count', ['snapshot', 'phases', 'preparation', 'entered'], Number.MAX_SAFE_INTEGER + 1],
  ['fractional count', ['snapshot', 'phases', 'preparation', 'entered'], 1.5],
  ['count mismatch', ['snapshot', 'phases', 'preparation', 'entered'], 2],
  ['negative time', ['snapshot', 'events', '1', 'atMs'], -1], ['invented duration', ['snapshot', 'events', '1', 'durationMs'], 1],
  ['null clock', ['snapshot', 'events', '1', 'atMs'], null], ['clock mismatch', ['snapshot', 'clock', 'lastMs'], 99],
  ['sequence', ['snapshot', 'sequence'], 3], ['shutdown', ['snapshot', 'shutdownSequence'], 99],
  ['watermark', ['snapshot', 'watermarks', 'preparation'], 0], ['coverage', ['snapshot', 'coverage', '0', 'phase'], 'other'],
  ['negative selection', ['selection', 'testAttempt'], -1], ['fractional selection', ['selection', 'repeatEachIndex'], 1.5],
] as const)('rejects malformed %s with the same parser and encoder', (_label, path, value) => {
  const malformed = corrupt(path, value);
  expect(parsePhaseHandoffEnvelope(bytes(malformed))).toBeUndefined();
  expect(encodePhaseHandoffEnvelope(malformed, expected)).toBeUndefined();
});

it('rejects nonfinite, negative-zero and overflowing numeric summaries without wrapping', () => {
  for (const value of [NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1]) {
    expect(encodePhaseHandoffEnvelope(corrupt(['snapshot', 'phases', 'preparation', 'entered'], value), expected)).toBeUndefined();
    expect(encodePhaseHandoffEnvelope(corrupt(['snapshot', 'events', '1', 'durationMs'], value), expected)).toBeUndefined();
  }
  const value = corrupt(['snapshot', 'phases', 'preparation', 'entered'], Number.MAX_SAFE_INTEGER);
  expect(encodePhaseHandoffEnvelope(value, expected)).toBeUndefined();
  const maximum = { ...expected, selection: { ...expected.selection, testAttempt: Number.MAX_SAFE_INTEGER, repeatEachIndex: Number.MAX_SAFE_INTEGER } };
  const unavailable = { schemaVersion: 1, kind: 'workspaceDeletionPhaseObservation', ...maximum, invocation: 1, availability: 'unavailable' };
  expect(parsePhaseHandoffEnvelope(bytes(unavailable))).toEqual(unavailable);
});

it('uses fatal UTF8 and rejects nested, discarded and escaped duplicate keys at byte ingress', () => {
  const text = encodePhaseHandoffEnvelope(envelope(), expected)!;
  for (const malformed of [
    text.replace('"schemaVersion":2', '"schemaVersion":{"discarded":"SYNTHETIC"},"schemaVersion":2'),
    text.replace('"testAttempt":1', '"testAttempt":7,"testAttempt":1'),
    text.replace('"schemaVersion":2', '"schemaVersion":2,"\\u0073chemaVersion":2'),
    text.replace('"entered":1', '"entered":0,"\\u0065ntered":1'), 'null', '[]', '{',
  ]) expect(parsePhaseHandoffEnvelope(Buffer.from(malformed))).toBeUndefined();
  const replacement = { ...envelope(), delivery: { ...expected.delivery, relativePath: `${runName}/synthetic-\ufffd/failure.private.json` } };
  const unicode = bytes(replacement), at = unicode.indexOf(Buffer.from('\ufffd'));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(parsePhaseHandoffEnvelope(unicode)).toEqual(replacement);
  const invalid = Buffer.concat([unicode.subarray(0, at), Buffer.from([0xff]), unicode.subarray(at + 3)]);
  expect(JSON.parse(invalid.toString('utf8'))).toEqual(replacement);
  expect(parsePhaseHandoffEnvelope(invalid)).toBeUndefined();
  expect(parsePhaseHandoffEnvelope(text)).toBeUndefined();
});

it('enforces the inclusive 32KiB whole-envelope byte limit', () => {
  const value = envelope(), original = bytes(value);
  const boundary = Buffer.concat([original, Buffer.alloc(PHASE_WIRE_LIMITS.bytes - original.length, 0x20)]);
  expect(boundary.length).toBe(32 * 1024);
  expect(parsePhaseHandoffEnvelope(boundary)).toEqual(value);
  expect(parsePhaseHandoffEnvelope(Buffer.concat([boundary, Buffer.from(' ')]))).toBeUndefined();
  expect(parsePhaseHandoffEnvelope(Buffer.from('"' + '\u00e4'.repeat(PHASE_WIRE_LIMITS.bytes / 2) + '"'))).toBeUndefined();
});

it('copies and deeply freezes observations without retaining mutable producer data', () => {
  const coverage = PHASE_WIRE_CATALOG.map(item => ({ ...item })), raw = recorder(() => 0, coverage);
  coverage[0]!.operation = 'changed';
  const event = { ...signal('preparation', 1) };
  raw.observe(runtime, event); event.operation = 'changed';
  const first = raw.snapshot();
  raw.observe(runtime, signal('preparation', 1, 'fulfilled'));
  expect(first.snapshot.active).toHaveLength(1);
  expect(raw.snapshot().snapshot.active).toHaveLength(0);
  function frozen(value: unknown) {
    if (value !== null && typeof value === 'object') {
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) frozen(child);
    }
  }
  frozen(first); frozen(parsePhaseHandoffEnvelope(bytes(envelope(first))));
});

it.for(['observe', 'observePhase', 'observeSlotIo'] as const)('rejects closed-descriptor violations in %s without callback authority', method => {
  const calls: string[] = [];
  const valid = method === 'observe' ? signal('preparation', 1)
    : method === 'observePhase' ? { phase: 'preparation', event: 'entered', callId: 1 }
      : { operation: 'fileRead', scope: 'ioAttempt', event: 'entered', callId: 1 };
  const getter = Object.defineProperty({ ...valid }, 'callId', { get() { calls.push('getter'); return 1; } });
  const proxy = new Proxy(valid, { ownKeys() { calls.push('proxy'); return []; }, get() { calls.push('get'); return undefined; } });
  const revoked = Proxy.revocable(valid, {}); revoked.revoke();
  for (const value of [undefined, null, getter, proxy, revoked.proxy, { ...valid, extra: 0 },
    { ...valid, work() { calls.push('work'); } }, { ...valid, [Symbol('extra')]: 0 }]) {
    const raw = recorder(); raw[method](runtime, value);
    const snapshot = roundtrip(raw.freeze());
    expect(snapshot.omissions.invalidSignal).toBe(true);
    expect(snapshot.events).toEqual([]);
  }
  expect(calls).toEqual([]);
});

it('rejects accessors, proxies, sparse arrays and foreign iterators throughout the envelope', () => {
  const calls: string[] = [];
  const getter = { ...envelope() };
  Object.defineProperty(getter, 'schemaVersion', { get() { calls.push('getter'); return 1; } });
  expect(encodePhaseHandoffEnvelope(getter, expected)).toBeUndefined();
  const proxy = new Proxy({}, { ownKeys() { calls.push('proxy'); return []; } });
  expect(encodePhaseHandoffEnvelope(proxy, expected)).toBeUndefined();
  expect(parsePhaseHandoffEnvelope(new Proxy(bytes(envelope()), {}))).toBeUndefined();
  const foreign = Object.create(Array.prototype) as Record<PropertyKey, unknown>;
  Object.defineProperty(foreign, Symbol.iterator, { get() { calls.push('iterator'); throw new Error('SYNTHETIC'); } });
  for (const field of ['events', 'active', 'coverage']) {
    const array = Object.setPrototypeOf([], foreign);
    expect(encodePhaseHandoffEnvelope(corrupt(['snapshot', field], array), expected)).toBeUndefined();
    expect(encodePhaseHandoffEnvelope(corrupt(['snapshot', field], new Array(1)), expected)).toBeUndefined();
    expect(encodePhaseHandoffEnvelope(corrupt(['snapshot', field], proxy), expected)).toBeUndefined();
  }
  expect(() => recorder(() => 0, Object.setPrototypeOf([], foreign))).toThrow('INVALID_PHASE_WIRE_COVERAGE');
  expect(calls).toEqual([]);
});

it('accepts the exact 64-event prefix then keeps counters, active calls and watermarks current', () => {
  let time = 0;
  const raw = recorder(() => time++);
  raw.observe(runtime, signal('preparation', 1)); raw.observe(runtime, signal('preparation', 1, 'fulfilled'));
  for (let id = 1; id <= 31; id++) {
    raw.observe(runtime, signal('slotIo', id, 'entered', 'fileRead', 'ioAttempt'));
    raw.observe(runtime, signal('slotIo', id, 'fulfilled', 'fileRead', 'ioAttempt'));
  }
  expect(roundtrip(raw.snapshot()).state).toBe('captured');
  for (let id = 32; id <= 100; id++) {
    raw.observe(runtime, signal('slotIo', id, 'entered', 'fileRead', 'ioAttempt'));
    raw.observe(runtime, signal('slotIo', id, 'fulfilled', 'fileRead', 'ioAttempt'));
  }
  raw.observeSlotIo(runtime, { operation: 'fileSync', scope: 'ioAttempt', event: 'entered', callId: 101 });
  const pending = roundtrip(raw.snapshot());
  expect(pending.events).toHaveLength(64); expect(pending.sequence).toBe(203);
  expect(pending.phases.slotIo).toEqual({ entered: 101, fulfilled: 100, rejected: 0 });
  expect(pending.active).toEqual([{ phase: 'slotIo', operation: 'fileSync', scope: 'ioAttempt', callId: 101, enteredSequence: 203, atMs: 202 }]);
  expect(pending.omissions.eventLimit).toBe(true); expect(pending.state).toBe('partial');
  expect(Object.keys(pending.watermarks)).toHaveLength(11); expect(pending.watermarks.slotIo).toBe(101);
  raw.markShutdown(runtime);
  raw.observeSlotIo(runtime, { operation: 'fileSync', scope: 'ioAttempt', event: 'rejected', callId: 101 });
  const settled = roundtrip(raw.snapshot());
  expect(settled.active).toEqual([]); expect(settled.phases.slotIo.rejected).toBe(1); expect(settled.shutdownSequence).toBe(204);
  raw.observe(runtime, signal('slotIo', 101, 'rejected', 'fileSync', 'ioAttempt'));
  expect(roundtrip(raw.freeze()).omissions.lateCall).toBe(true);
});

it('seals at the active-call limit without pretending to know later work', () => {
  const raw = recorder(); raw.observe(runtime, signal('preparation', 1));
  for (let id = 1; id <= 15; id++) raw.observe(runtime, signal('sourceComparison', id));
  expect(roundtrip(raw.snapshot()).active).toHaveLength(16);
  raw.observe(runtime, signal('sourceComparison', 16));
  raw.observe(runtime, signal('sourceComparison', 1, 'fulfilled'));
  const snapshot = roundtrip(raw.freeze());
  expect(snapshot.omissions.activeLimit).toBe(true); expect(snapshot.active).toHaveLength(16);
  expect(snapshot.phases.sourceComparison).toEqual({ entered: 15, fulfilled: 0, rejected: 0 });
});

it('rejects duplicate active sequence identities and unwired counts even after prefix truncation', () => {
  let time = 0;
  const raw = recorder(() => time++, PHASE_WIRE_CATALOG.filter(item => item.phase !== 'fullSelection'));
  raw.observe(runtime, signal('preparation', 1)); raw.observe(runtime, signal('preparation', 1, 'fulfilled'));
  for (let id = 1; id <= 32; id++) {
    raw.observe(runtime, signal('sourceComparison', id)); raw.observe(runtime, signal('sourceComparison', id, 'fulfilled'));
  }
  raw.observe(runtime, signal('sourceComparison', 33)); raw.observe(runtime, signal('sourceComparison', 34));
  roundtrip(raw.snapshot());
  const original = envelope(raw.snapshot());
  if (original.availability !== 'captured') throw new Error('SYNTHETIC_CAPTURE_MISSING');
  const duplicate = { ...original, snapshot: { ...original.snapshot, active: original.snapshot.active.map(item =>
    ({ ...item, enteredSequence: original.snapshot.active[0]!.enteredSequence })) } };
  const unwired = { ...original, snapshot: { ...original.snapshot, sequence: original.snapshot.sequence + 2,
    watermarks: { ...original.snapshot.watermarks, fullSelection: 1 },
    phases: { ...original.snapshot.phases, fullSelection: { entered: 1, fulfilled: 1, rejected: 0 } } } };
  for (const value of [duplicate, unwired]) {
    expect(encodePhaseHandoffEnvelope(value, expected)).toBeUndefined(); expect(parsePhaseHandoffEnvelope(bytes(value))).toBeUndefined();
  }
});

it.each([NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('marks invalid clock %s as null, not zero duration', value => {
  const raw = recorder(() => value);
  raw.observe(runtime, signal('preparation', 1)); raw.observe(runtime, signal('preparation', 1, 'fulfilled'));
  const snapshot = roundtrip(raw.freeze());
  expect(snapshot.clock).toEqual({ invalid: true, lastMs: null }); expect(snapshot.state).toBe('partial');
  expect(snapshot.events.map(event => [event.atMs, event.durationMs])).toEqual([[null, null], [null, null]]);
});

it('keeps backward or throwing clocks invalid even when later values could recover', () => {
  for (const throws of [false, true]) {
    let calls = 0;
    const raw = recorder(() => { calls++; if (throws && calls === 2) throw new Error('SYNTHETIC_CLOCK'); return calls === 2 ? 99 : 100; });
    raw.observe(runtime, signal('preparation', 1)); raw.observe(runtime, signal('sourceComparison', 1));
    raw.observe(runtime, signal('sourceComparison', 1, 'fulfilled'));
    const snapshot = roundtrip(raw.freeze());
    expect(snapshot.events[0]!.atMs).toBe(0); expect(snapshot.events[2]!.durationMs).toBeNull(); expect(calls).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain('SYNTHETIC_CLOCK');
  }
});

it.each(['preparation', 'journalPublication'] as const)('seals a second %s attempt as ambiguous without mixing events', phase => {
  const raw = recorder(); raw.observe(runtime, signal('preparation', 1));
  if (phase === 'journalPublication') raw.observe(runtime, signal(phase, 1));
  const first = raw.snapshot(); raw.observe(runtime, signal(phase, 2)); raw.observe(runtime, signal('sourceComparison', 1));
  const snapshot = roundtrip(raw.freeze());
  expect(snapshot.invocationState).toBe('ambiguous'); expect(snapshot.events).toEqual(first.snapshot.events);
});

it('ignores stale runtimes and freezes late callbacks and shutdown markers', () => {
  const raw = recorder();
  raw.observePhase(otherRuntime, undefined); raw.observeSlotIo(otherRuntime, undefined); raw.markShutdown(otherRuntime);
  expect(raw.snapshot().snapshot.invocationState).toBe('notStarted');
  raw.observe(runtime, signal('preparation', 1)); raw.markShutdown(runtime); raw.markShutdown(runtime);
  const frozen = raw.freeze();
  raw.observePhase(runtime, { phase: 'preparation', event: 'fulfilled', callId: 1 }); raw.observeSlotIo(runtime, undefined); raw.markShutdown(runtime);
  expect(raw.snapshot()).toBe(frozen); expect(raw.freeze()).toBe(frozen); expect(roundtrip(frozen).shutdownSequence).toBe(2);
});

it('allows out-of-order ends but rejects reused identifiers, mismatched operations and unknown ends', () => {
  for (const bad of [signal('sourceComparison', 1), signal('sourceComparison', 3, 'fulfilled'),
    signal('slotIo', 1, 'fulfilled', 'fileSync', 'ioAttempt')]) {
    const raw = recorder(); raw.observe(runtime, signal('preparation', 1));
    raw.observe(runtime, signal('sourceComparison', 1)); raw.observe(runtime, signal('sourceComparison', 2));
    raw.observe(runtime, signal('sourceComparison', 1, 'fulfilled')); raw.observe(runtime, signal('sourceComparison', 2, 'rejected'));
    raw.observe(runtime, signal('slotIo', 1, 'entered', 'fileRead', 'ioAttempt'));
    expect(roundtrip(raw.snapshot()).phases.sourceComparison).toEqual({ entered: 2, fulfilled: 1, rejected: 1 });
    raw.observe(runtime, bad); expect(roundtrip(raw.freeze()).omissions.lateCall).toBe(true);
  }
});

it('imports the compiled raw host standalone without any source-tree tooling helpers', async context => {
  const f = await tempFixture(context), directory = join(f.root, 'e2e-dist', 'e2e');
  await mkdir(directory, { recursive: true });
  const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
  const source = await readFile(new URL('./workspaceDeletionPhaseObservation.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
  expect(compiled.diagnostics).toEqual([]);
  const path = join(directory, 'workspaceDeletionPhaseObservation.mjs');
  await writeFile(path, compiled.outputText, { flag: 'wx' });
  await expect(lstat(join(f.root, 'test-reporters'))).rejects.toHaveProperty('code', 'ENOENT');
  await expect(lstat(join(f.root, 'e2e-dist', 'installer'))).rejects.toHaveProperty('code', 'ENOENT');
  // Use Node's loader, so Vitest cannot remap this isolated file into the source tree.
  const isolated = createRequire(import.meta.url)(path) as typeof import('./workspaceDeletionPhaseObservation.js');
  const raw = isolated.createWorkspaceDeletionRawPhaseRecorder(runtime, () => 1, isolated.WORKSPACE_DELETION_MAIN_PHASE_COVERAGE);
  raw.observePhase(runtime, { phase: 'preparation', event: 'entered', callId: 1 });
  raw.observeSlotIo(runtime, { operation: 'fileOpen', scope: 'ioAttempt', event: 'entered', callId: 1 });
  raw.observeSlotIo(runtime, { operation: 'fileOpen', scope: 'ioAttempt', event: 'fulfilled', callId: 1 });
  raw.observePhase(runtime, { phase: 'preparation', event: 'fulfilled', callId: 1 }); raw.markShutdown(runtime);
  const value = raw.freeze();
  expect(Object.keys(value)).toEqual(['schemaVersion', 'runtimeInstanceId', 'invocation', 'availability', 'snapshot']);
  expect(value.schemaVersion).toBe(2);
  expect(value.snapshot.phases.slotIo).toEqual({ entered: 1, fulfilled: 1, rejected: 0 });
  expect(value.snapshot.shutdownSequence).toBe(5); expect(value.snapshot.omissions.missingCoverage).toBe(true);
  expect(raw.snapshot()).toBe(value);
  f.complete();
});

it('captures parent context once across restart and rejects a wrong raw response before delivery', async context => {
  const f = await deliveryFixture(context), captured = envelope(validRaw(), f.captured.expected);
  expect(bindPhaseHandoffCapture({ ...validRaw(), runtimeInstanceId: otherRuntime }, f.captured.expected)).toBeUndefined();
  expect(bindPhaseHandoffCapture({ ...validRaw(), invocation: 2 }, f.captured.expected)).toBeUndefined();
  expect(bindPhaseHandoffCapture({ ...validRaw(), testAttempt: 9 }, f.captured.expected)).toBeUndefined();
  f.input.runtimeInstanceId = otherRuntime; f.input.testInfo.retry = 9; f.input.testInfo.repeatEachIndex = 8;
  expect(f.captured.expected.selection).toEqual(expected.selection); expect(Object.isFrozen(f.captured.expected.selection)).toBe(true);
  expect(await deliverPhaseHandoffObservation({ ...f.delivery, envelope: captured })).toBe('recorded');
  expect(parsePhaseHandoffEnvelope(await readFile(f.path))).toEqual(captured);
  expect((await lstat(f.path)).nlink).toBe(1);
  f.complete();
});

it.for(['runtimeInstanceId', 'scenarioId', 'testAttempt', 'repeatEachIndex'] as const)('compares expected parent %s before opening', async (field, context) => {
  const f = await deliveryFixture(context), openFile = vi.fn(open);
  const value = field === 'runtimeInstanceId' ? otherRuntime : field === 'scenarioId' ? 'DESK-OTHER-001' : 7;
  const changed = { ...f.captured.envelope, selection: { ...f.captured.expected.selection, [field]: value } };
  expect(await deliverPhaseHandoffObservation({ ...f.delivery, envelope: changed }, openFile)).toBe('deliveryFailed');
  expect(openFile).not.toHaveBeenCalled(); await expect(readFile(f.path)).rejects.toHaveProperty('code', 'ENOENT'); f.complete();
});

it.for(['runId', 'attempt', 'job', 'jobKey', 'sourceRevision'] as const)('independently compares collector CI %s', async (field, context) => {
  const f = await deliveryFixture(context), value = bytes(f.captured.envelope), relative = f.captured.expected.delivery.relativePath;
  const changed = { ...job, [field]: field === 'sourceRevision' ? 'b'.repeat(40) : field === 'runId' || field === 'attempt' ? '6' : 'other' };
  expect(validatePhaseHandoffCollector(value, changed, relative)).toBeUndefined();
  expect(validatePhaseHandoffCollector(value, job, relative)).toEqual(f.captured.envelope); f.complete();
});

it('keeps explicit job keys distinct from the githubJob fallback', async context => {
  const f = await deliveryFixture(context, { ...ciEnv, EKY_EVIDENCE_JOB_KEY: '' }), value = bytes(f.captured.envelope);
  const relative = f.captured.expected.delivery.relativePath;
  expect(f.captured.expected.delivery.binding).toMatchObject({ jobKeySource: 'githubJob', jobKey: job.job });
  expect(validatePhaseHandoffCollector(value, { ...job, jobKey: 'other-matrix-key' }, relative)).toEqual(f.captured.envelope);
  expect(validatePhaseHandoffCollector(value, { ...job, job: 'other' }, relative)).toBeUndefined(); f.complete();
});

it('records local unavailability without inventing CI identity or observed zero work', async context => {
  const f = await deliveryFixture(context, {});
  expect(f.captured.expected.delivery.binding).toEqual({ kind: 'local' });
  expect(await deliverPhaseHandoffObservation(f.delivery)).toBe('recorded');
  const value = await readFile(f.path);
  expect(parsePhaseHandoffEnvelope(value)).toEqual(f.captured.envelope);
  expect(parsePhaseHandoffEnvelope(value)).not.toHaveProperty('snapshot');
  expect(validatePhaseHandoffCollector(value, job, f.captured.expected.delivery.relativePath)).toBeUndefined(); f.complete();
});

it.for(['sibling', 'otherRun', 'wrongName', 'nested'] as const)('rejects the actual collector path mismatch %s', async (mode, context) => {
  const f = await deliveryFixture(context), path = f.captured.expected.delivery.relativePath;
  const changed = mode === 'sibling' ? path.replace('synthetic-case', 'sibling-case') : mode === 'otherRun' ? path.replace('33333333', '55555555')
    : mode === 'wrongName' ? path.replace('failure.private.json', 'process-output.private.json') : path.replace('/failure.', '/nested/failure.');
  expect(validatePhaseHandoffCollector(bytes(f.captured.envelope), job, changed)).toBeUndefined(); f.complete();
});

it('uses direct output paths and never infers the retry from a directory name', async context => {
  const f = await deliveryFixture(context);
  const captured = capturePhaseHandoffExpected({ ...f.input, testInfo: { ...f.input.testInfo, retry: 17 } });
  expect(captured.expected.selection.testAttempt).toBe(17); expect(captured.attemptDirectory).toBe(f.captured.attemptDirectory);
  expect(() => capturePhaseHandoffExpected({ ...f.input, testInfo: { ...f.input.testInfo, outputPath: name => join(f.root, name) } }))
    .toThrow('INVALID_PHASE_HANDOFF_CONTEXT'); f.complete();
});

it.for(['runtimeInstanceId', 'testAttempt', 'repeatEachIndex'] as const)(
  'characterizes accepted same-path postwrite %s tampering, not secure provenance', async (field, context) => {
    const f = await deliveryFixture(context);
    expect(await deliverPhaseHandoffObservation(f.delivery)).toBe('recorded');
    const changed = { ...f.captured.envelope, selection: { ...f.captured.expected.selection, [field]: field === 'runtimeInstanceId' ? otherRuntime : 19 } };
    await writeFile(f.path, JSON.stringify(changed));
    expect(validatePhaseHandoffParent(changed, f.captured.expected)).toBeUndefined();
    expect(validatePhaseHandoffCollector(await readFile(f.path), job, f.captured.expected.delivery.relativePath)).toEqual(changed);
    f.complete();
  });

it('does no content, helper or path work for a passing test', async context => {
  const f = await deliveryFixture(context), outputPath = vi.fn(() => { throw new Error('SYNTHETIC_UNREACHABLE'); });
  expect(await deliverPhaseHandoffObservation({ ...f.delivery, failed: false, envelope: null, outputPath })).toBe('notRequired');
  expect(outputPath).not.toHaveBeenCalled(); await expect(readFile(f.path)).rejects.toHaveProperty('code', 'ENOENT'); f.complete();
});

it.for(['unknown', 'throws', 'outside', 'wrongName', 'nestedAttempt', 'aliasedRun', 'sibling'] as const)(
  'rejects writer input %s without opening a destination', async (mode, context) => {
    const f = await deliveryFixture(context), openFile = vi.fn(open), input = { ...f.delivery };
    if (mode === 'unknown') input.envelope = { ...f.captured.envelope, extra: 'SYNTHETIC_EXCLUDED' };
    if (mode === 'throws') input.outputPath = () => { throw new Error('SYNTHETIC_OUTPUT'); };
    if (mode === 'outside') input.outputPath = () => join(f.root, 'failure.private.json');
    if (mode === 'wrongName') input.outputPath = () => join(input.attemptDirectory, 'process-output.private.json');
    if (mode === 'nestedAttempt') input.attemptDirectory = join(input.attemptDirectory, 'nested');
    if (mode === 'aliasedRun') input.runDirectory += '/.';
    if (mode === 'sibling') {
      input.attemptDirectory = join(input.runDirectory, 'sibling'); await mkdir(input.attemptDirectory);
      input.outputPath = name => join(input.attemptDirectory, name);
    }
    expect(await deliverPhaseHandoffObservation(input, openFile)).toBe('deliveryFailed'); expect(openFile).not.toHaveBeenCalled();
    await expect(readFile(f.path)).rejects.toHaveProperty('code', 'ENOENT'); f.complete();
  });

it.for(['ordinary', 'hardlink', 'symlink'] as const)('retains an existing %s destination byte-for-byte as a collision', async (mode, context) => {
  const f = await deliveryFixture(context), original = join(f.root, 'synthetic-original'), previous = Buffer.from('SYNTHETIC_KEEP_EXISTING');
  await writeFile(original, previous, { flag: 'wx' });
  if (mode === 'ordinary') await writeFile(f.path, previous, { flag: 'wx' });
  // These are deliberate hostile link fixtures, not artifact clones.
  if (mode === 'hardlink') await link(original, f.path);
  if (mode === 'symlink') await symlink(original, f.path, 'file');
  expect(await deliverPhaseHandoffObservation(f.delivery)).toBe('deliveryFailed');
  expect((await readFile(original)).equals(previous)).toBe(true); expect((await readFile(f.path)).equals(previous)).toBe(true); f.complete();
});

it('rejects a redirected attempt directory without touching its target', async context => {
  const f = await deliveryFixture(context), target = join(f.root, 'synthetic-external');
  await mkdir(target); await rm(f.delivery.attemptDirectory, { recursive: true });
  await symlink(target, f.delivery.attemptDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  expect(await deliverPhaseHandoffObservation(f.delivery)).toBe('deliveryFailed');
  await expect(readFile(join(target, 'failure.private.json'))).rejects.toHaveProperty('code', 'ENOENT'); f.complete();
});

it.for(['partialWrite', 'postWriteSize', 'postWriteIdentity', 'multipleLinks', 'parentIdentity', 'closeFailure'] as const)(
  'closes the owned writer once and retains evidence after %s', async (mode, context) => {
    const f = await deliveryFixture(context);
    let native: Awaited<ReturnType<typeof open>> | undefined, closes = 0, stats = 0;
    context.onTestFinished(async () => { if (native && native.fd !== -1) await native.close(); });
    const retained = join(f.root, 'synthetic-retained-attempt');
    const status = await deliverPhaseHandoffObservation(f.delivery, async (path, flags, permissions) => {
      expect(path).toBe(f.path); expect(flags).toBe('wx'); expect(permissions).toBe(0o600);
      if (mode === 'parentIdentity') {
        await rename(f.delivery.attemptDirectory, retained);
        await mkdir(f.delivery.attemptDirectory);
      }
      native = await open(path, flags, permissions); const file = native;
      return {
        async stat() {
          const result = await file.stat(); stats++;
          if (stats === 1 && mode === 'multipleLinks') result.nlink = 2;
          if (stats === 2 && mode === 'postWriteSize') result.size++;
          if (stats === 2 && mode === 'postWriteIdentity') {
            const originalDev = result.dev;
            result.dev = originalDev === 0 ? 1 : 0;
            expect(result.dev).not.toBe(originalDev);
          }
          return result;
        },
        async writeFile(data, options) {
          if (mode === 'partialWrite') { await file.writeFile('SYNTHETIC_PARTIAL'); throw new Error('SYNTHETIC_WRITE_FAILED'); }
          await file.writeFile(data, options);
        },
        async close() { closes++; await file.close(); if (mode === 'closeFailure') throw new Error('SYNTHETIC_CLOSE_FAILED'); },
      };
    });
    expect(status).toBe('deliveryFailed'); expect(closes).toBe(1); expect(native?.fd).toBe(-1);
    const value = await readFile(f.path);
    if (mode === 'partialWrite') expect(value.toString('utf8')).toBe('SYNTHETIC_PARTIAL');
    else if (mode === 'multipleLinks') expect(value.length).toBe(0);
    else expect(parsePhaseHandoffEnvelope(value)).toEqual(f.captured.envelope);
    if (mode === 'parentIdentity') expect(await readdir(retained)).toEqual([]);
    expect(await deliverPhaseHandoffObservation(f.delivery)).toBe('deliveryFailed');
    expect((await readFile(f.path)).equals(value)).toBe(true); f.complete();
  });
