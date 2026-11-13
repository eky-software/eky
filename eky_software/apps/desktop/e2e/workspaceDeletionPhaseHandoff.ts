import { lstat as phaseDeliveryLstat, open as phaseDeliveryOpen, realpath as phaseDeliveryRealpath } from 'node:fs/promises';
import { basename as handoffBasename, dirname as handoffDirname, join as handoffJoin, resolve as handoffResolve,
  basename as phaseDeliveryBasename, dirname as phaseDeliveryDirname, resolve as phaseDeliveryResolve } from 'node:path';
import { isProxy as phaseWireIsProxy } from 'node:util/types';

import type { PhaseWireSnapshot, LegacyPhaseWireSnapshot } from './workspaceDeletionPhaseObservation.js';

// This source-only adapter is not loaded by the compiled raw observation host.
const { runnerFailureBinding } = await import(new URL('../../../test-reporters/runnerFailureEvidence.mjs', import.meta.url).href) as {
  runnerFailureBinding(env: Record<string, string | undefined>): HandoffJobBinding;
};
const { parseStrictJsonObjectBytes } = await import(new URL('../installer/windows-acceptance-harness/strictJsonObject.mjs', import.meta.url).href) as {
  parseStrictJsonObjectBytes(bytes: Uint8Array, options: { errorCode: string; maximumBytes: number }): unknown;
};
const { ordinaryPath } = await import(new URL('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs', import.meta.url).href) as {
  ordinaryPath(root: string, path: string, directory?: boolean): Promise<import('node:fs').Stats>;
};
const phaseWire = await import(new URL('./workspaceDeletionPhaseObservation.ts', import.meta.url).href) as
  typeof import('./workspaceDeletionPhaseObservation.js');
const { phaseWireInteger, phaseWireRecord, phaseWireSnapshot, phaseWireLegacySnapshot, phaseWireUuid } = phaseWire;
export const PHASE_WIRE_LIMITS = phaseWire.PHASE_WIRE_LIMITS;

type HandoffJobBinding = Readonly<{ kind: 'local' }> | Readonly<{ kind: 'github'; runId: string;
  attempt: string; job: string; jobKey: string; sourceRevision: string; jobKeySource: 'explicit' | 'githubJob' }>;
export type PhaseHandoffSelection = Readonly<{ runtimeInstanceId: string; scenarioId: 'DESK-DELETE-RECOVERY-001';
  testAttempt: number; repeatEachIndex: number }>;
type HandoffDelivery = Readonly<{ binding: HandoffJobBinding; relativePath: string }>;
export type PhaseHandoffExpected = Readonly<{ selection: PhaseHandoffSelection; delivery: HandoffDelivery }>;
export type PhaseHandoffEnvelope = Readonly<{ schemaVersion: 1 | 2; kind: 'workspaceDeletionPhaseObservation';
  selection: PhaseHandoffSelection; delivery: HandoffDelivery; invocation: 1 }> &
  (Readonly<{ availability: 'unavailable' }> | Readonly<{ availability: 'captured'; snapshot: PhaseWireSnapshot | LegacyPhaseWireSnapshot }>);
const handoffSelectionKeys = ['runtimeInstanceId', 'scenarioId', 'testAttempt', 'repeatEachIndex'];
const handoffJobKeys = ['kind', 'runId', 'attempt', 'job', 'jobKey', 'sourceRevision', 'jobKeySource'];

function handoffSelection(value: unknown): PhaseHandoffSelection | undefined {
  if (!phaseWireRecord(value, handoffSelectionKeys) || typeof value.runtimeInstanceId !== 'string' ||
      !phaseWireUuid.test(value.runtimeInstanceId) || value.scenarioId !== 'DESK-DELETE-RECOVERY-001' ||
      !phaseWireInteger(value.testAttempt) || !phaseWireInteger(value.repeatEachIndex)) return undefined;
  return Object.freeze({ runtimeInstanceId: value.runtimeInstanceId, scenarioId: value.scenarioId,
    testAttempt: value.testAttempt, repeatEachIndex: value.repeatEachIndex });
}
function handoffJob(value: unknown): HandoffJobBinding | undefined {
  if (phaseWireRecord(value, ['kind']) && value.kind === 'local') return Object.freeze({ kind: 'local' });
  if (!phaseWireRecord(value, handoffJobKeys) || value.kind !== 'github' ||
      !['explicit', 'githubJob'].includes(value.jobKeySource as string) ||
      handoffJobKeys.some(key => typeof value[key] !== 'string')) return undefined;
  try {
    const normalized = runnerFailureBinding({ GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: value.runId as string, GITHUB_RUN_ATTEMPT: value.attempt as string,
      GITHUB_JOB: value.job as string, GITHUB_SHA: value.sourceRevision as string,
      EKY_EVIDENCE_JOB_KEY: value.jobKeySource === 'explicit' ? value.jobKey as string : undefined });
    return handoffJobKeys.every(key => normalized[key as keyof typeof normalized] === value[key])
      ? Object.freeze(normalized) : undefined;
  } catch { return undefined; }
}
function handoffRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 3 && parts[0]!.startsWith('run-') && phaseWireUuid.test(parts[0]!.slice(4)) &&
    parts[1] !== '' && parts[1] !== '.' && parts[1] !== '..' && !/[\\:\u0000-\u001f\u007f]/u.test(parts[1]!) &&
    parts[2] === 'failure.private.json';
}
function handoffDelivery(value: unknown): HandoffDelivery | undefined {
  if (!phaseWireRecord(value, ['binding', 'relativePath']) || !handoffRelativePath(value.relativePath)) return undefined;
  const binding = handoffJob(value.binding);
  return binding === undefined ? undefined : Object.freeze({ binding, relativePath: value.relativePath });
}
function handoffEnvelope(value: unknown): PhaseHandoffEnvelope | undefined {
  if (value === null || typeof value !== 'object' || phaseWireIsProxy(value)) return undefined;
  const captured = Object.getOwnPropertyDescriptor(value, 'availability')?.value === 'captured';
  if (!phaseWireRecord(value, ['schemaVersion', 'kind', 'selection', 'delivery', 'invocation', 'availability',
    ...(captured ? ['snapshot'] : [])]) || (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
      value.kind !== 'workspaceDeletionPhaseObservation' || value.invocation !== 1) return undefined;
  const selection = handoffSelection(value.selection), delivery = handoffDelivery(value.delivery);
  if (selection === undefined || delivery === undefined) return undefined;
  const top = { schemaVersion: value.schemaVersion as 1 | 2, kind: 'workspaceDeletionPhaseObservation' as const,
    selection, delivery, invocation: 1 as const };
  if (value.availability === 'unavailable') return Object.freeze({ ...top, availability: 'unavailable' });
  if (!captured) return undefined;
  const snapshot = value.schemaVersion === 1 ? phaseWireLegacySnapshot(value.snapshot) : phaseWireSnapshot(value.snapshot);
  return snapshot === undefined ? undefined : Object.freeze({ ...top, availability: 'captured', snapshot });
}
export function parsePhaseHandoffEnvelope(bytes: unknown): PhaseHandoffEnvelope | undefined {
  try {
    if (phaseWireIsProxy(bytes) || !(bytes instanceof Uint8Array)) return undefined;
    return handoffEnvelope(parseStrictJsonObjectBytes(bytes,
      { errorCode: 'INVALID_PHASE_HANDOFF_BYTES', maximumBytes: PHASE_WIRE_LIMITS.bytes }));
  } catch { return undefined; }
}
export function validatePhaseHandoffParent(value: unknown, expected: PhaseHandoffExpected): PhaseHandoffEnvelope | undefined {
  try {
    const envelope = handoffEnvelope(value), selection = handoffSelection(expected.selection),
      delivery = handoffDelivery(expected.delivery);
    if (envelope === undefined || selection === undefined || delivery === undefined ||
        !handoffSelectionKeys.every(key => envelope.selection[key as keyof PhaseHandoffSelection] === selection[key as keyof PhaseHandoffSelection]) ||
        envelope.delivery.relativePath !== delivery.relativePath ||
        JSON.stringify(envelope.delivery.binding) !== JSON.stringify(delivery.binding)) return undefined;
    return envelope;
  } catch { return undefined; }
}
export function encodePhaseHandoffEnvelope(value: unknown, expected: PhaseHandoffExpected): string | undefined {
  const envelope = validatePhaseHandoffParent(value, expected);
  if (envelope === undefined) return undefined;
  const text = JSON.stringify(envelope);
  return Buffer.byteLength(text, 'utf8') <= PHASE_WIRE_LIMITS.bytes ? text : undefined;
}
export function bindPhaseHandoffCapture(value: unknown, expected: PhaseHandoffExpected): PhaseHandoffEnvelope | undefined {
  try {
    if (value === null || typeof value !== 'object' || phaseWireIsProxy(value)) return undefined;
    const captured = Object.getOwnPropertyDescriptor(value, 'availability')?.value === 'captured';
    const version = Object.getOwnPropertyDescriptor(value, 'schemaVersion')?.value ?? 1;
    if ((version !== 1 && version !== 2) || !phaseWireRecord(value,
      [...(version === 2 ? ['schemaVersion'] : []), 'runtimeInstanceId', 'invocation', 'availability', ...(captured ? ['snapshot'] : [])]) ||
        value.runtimeInstanceId !== expected.selection.runtimeInstanceId || value.invocation !== 1) return undefined;
    return validatePhaseHandoffParent({ schemaVersion: version, kind: 'workspaceDeletionPhaseObservation',
      selection: expected.selection, delivery: expected.delivery, invocation: 1, availability: value.availability,
      ...(captured ? { snapshot: value.snapshot } : {}) }, expected);
  } catch { return undefined; }
}
export function validatePhaseHandoffCollector(bytes: unknown,
  job: Readonly<{ runId: string; attempt: string; job: string; jobKey: string; sourceRevision: string }>,
  relativePath: string): PhaseHandoffEnvelope | undefined {
  const envelope = parsePhaseHandoffEnvelope(bytes);
  if (envelope === undefined || !handoffRelativePath(relativePath) || envelope.delivery.relativePath !== relativePath ||
      envelope.delivery.binding.kind !== 'github') return undefined;
  const binding = envelope.delivery.binding;
  if (['runId', 'attempt', 'job', 'sourceRevision'].some(key => binding[key as keyof typeof binding] !== job[key as keyof typeof job]) ||
      (binding.jobKeySource === 'explicit' ? binding.jobKey !== job.jobKey : binding.jobKey !== job.job)) return undefined;
  return envelope;
}

// Capture trusted parent context once, independently of the main response.
export function capturePhaseHandoffExpected(input: Readonly<{ runtimeInstanceId: string;
  scenarioId: 'DESK-DELETE-RECOVERY-001'; env: Record<string, string | undefined>;
  testInfo: Readonly<{ retry: number; repeatEachIndex: number; project: Readonly<{ outputDir: string }>;
    outputPath(name: string): string }> }>) {
  const selection = handoffSelection({ runtimeInstanceId: input.runtimeInstanceId, scenarioId: input.scenarioId,
    testAttempt: input.testInfo.retry, repeatEachIndex: input.testInfo.repeatEachIndex });
  const runDirectory = input.testInfo.project.outputDir;
  const destination = input.testInfo.outputPath('failure.private.json'), attemptDirectory = handoffDirname(destination);
  const relativePath = `${handoffBasename(runDirectory)}/${handoffBasename(attemptDirectory)}/failure.private.json`;
  const delivery = handoffDelivery({ binding: runnerFailureBinding(input.env), relativePath });
  if (selection === undefined || delivery === undefined || handoffResolve(runDirectory) !== runDirectory ||
      handoffDirname(attemptDirectory) !== runDirectory ||
      destination !== handoffJoin(attemptDirectory, 'failure.private.json')) throw new Error('INVALID_PHASE_HANDOFF_CONTEXT');
  const expected = Object.freeze({ selection, delivery });
  const envelope: PhaseHandoffEnvelope = Object.freeze({ schemaVersion: 2, kind: 'workspaceDeletionPhaseObservation',
    ...expected, invocation: 1, availability: 'unavailable' });
  return Object.freeze({ runDirectory, attemptDirectory, expected, envelope,
    outputPath: (name: string) => handoffJoin(attemptDirectory, name) });
}

// Exclusive private delivery; failures retain existing bytes and never replace the test result.
const PHASE_DELIVERY_FILENAME = 'failure.private.json';
type PhaseDeliveryInput = Readonly<{
  failed: boolean;
  runDirectory: string;
  attemptDirectory: string;
  outputPath(name: string): string;
  expected: PhaseHandoffExpected;
  envelope: unknown;
}>;
type PhaseDeliveryStatus = 'notRequired' | 'recorded' | 'deliveryFailed';
type PhaseDeliveryFile = {
  stat(): Promise<import('node:fs').Stats>;
  writeFile(data: string, options: { encoding: 'utf8' }): Promise<void>;
  close(): Promise<void>;
};
export async function deliverPhaseHandoffObservation(input: PhaseDeliveryInput,
  openFile: (path: string, flags: 'wx', mode: number) => Promise<PhaseDeliveryFile> = phaseDeliveryOpen,
): Promise<PhaseDeliveryStatus> {
  if (!input.failed) return 'notRequired';
  try {
    const text = encodePhaseHandoffEnvelope(input.envelope, input.expected);
    if (text === undefined) return 'deliveryFailed';
    const run = phaseDeliveryResolve(input.runDirectory), attempt = phaseDeliveryResolve(input.attemptDirectory);
    if (run !== input.runDirectory || attempt !== input.attemptDirectory ||
        phaseDeliveryDirname(attempt) !== run ||
        !/^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(phaseDeliveryBasename(run))) return 'deliveryFailed';
    const runInfo = await phaseDeliveryLstat(run);
    if (!runInfo.isDirectory() || runInfo.isSymbolicLink() || await phaseDeliveryRealpath(run) !== run) return 'deliveryFailed';
    const before = await ordinaryPath(run, attempt, true);
    const destination = input.outputPath(PHASE_DELIVERY_FILENAME);
    if (destination !== handoffJoin(attempt, PHASE_DELIVERY_FILENAME)) return 'deliveryFailed';
    if (input.expected.delivery.relativePath !==
        `${phaseDeliveryBasename(run)}/${phaseDeliveryBasename(attempt)}/${PHASE_DELIVERY_FILENAME}`) return 'deliveryFailed';
    const file = await openFile(destination, 'wx', 0o600);
    let wrote = false;
    try {
      const identity = await file.stat();
      if (!identity.isFile() || identity.nlink !== 1) return 'deliveryFailed';
      await file.writeFile(text, { encoding: 'utf8' });
      const after = await file.stat();
      const current = await ordinaryPath(run, destination);
      const parent = await ordinaryPath(run, attempt, true);
      wrote = after.size === Buffer.byteLength(text, 'utf8') && after.nlink === 1 &&
        identity.dev === after.dev && identity.ino === after.ino &&
        current.dev === after.dev && current.ino === after.ino && current.size === after.size &&
        before.dev === parent.dev && before.ino === parent.ino;
    } finally { await file.close(); }
    return wrote ? 'recorded' : 'deliveryFailed';
  } catch { return 'deliveryFailed'; }
}
