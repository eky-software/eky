import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readProfileInspectionFailureCause } from './profileInspectionFailure.js';
import { createProfileSnapshotArtifactIdentity } from './profileInspectionArtifactIdentity.js';
import { writeProfileInspectionDocumentBindings } from './profileInspectionDocumentBindingsFile.js';
import {
  createProfileInspectionStatus, parseProfileInspectionCommand,
  parseColdProfileInspectionReceipt, parseOriginalProfileInspectionReceipt, parseProfileInspectionReceipt,
  profileInspectionProtocolVersion, profileInspectionWorkMilliseconds,
  resolveProfileInspectionCopyRoot,
  type ProfileInspectionCommand, type ProfileInspectionDeployment,
  type ProfileInspectionMigrationPolicy,
  type ColdProfileInspectionReceipt, type ProfileInspectionColdSources, type OriginalProfileInspectionReceipt, type ProfileInspectionOriginalSources,
  type ProfileInspectionReceipt, type ProfileInspectionRequestIdentity, type ProfileInspectionStatus,
} from './profileInspectionMessages.js';
import { acquireWorkspaceProcessReservation, type WorkspaceProcessReservation } from './workspaceProcessReservation.js';

interface InspectionOperationBase {
  readonly operationId: string;
  readonly inspectionRoot: string;
  readonly migrationsDirectory: string;
  readonly nativeResourceRoot: string;
}

type InspectionOperation = InspectionOperationBase & (
  | { readonly kind: 'inspect' | 'prepareRestoreActivation'; readonly migrationPolicy: ProfileInspectionMigrationPolicy; readonly stagingRoot: string }
  | (ProfileInspectionColdSources & { readonly kind: 'inspectColdRestoreContent'; readonly stagingRoot: string })
  | (ProfileInspectionOriginalSources & { readonly kind: 'inspectColdRestoreOriginal'; readonly anchorRoot: string })
);

type RunInspection = (
  operation: InspectionOperation,
  control: { readonly signal: AbortSignal; readonly assertOwned: () => Promise<void>;
    readonly createArtifactIdentity: typeof createProfileSnapshotArtifactIdentity;
    readonly writeDocumentBindings: (artifacts: Parameters<typeof writeProfileInspectionDocumentBindings>[1]) =>
      ReturnType<typeof writeProfileInspectionDocumentBindings> },
) => Promise<ProfileInspectionReceipt | ColdProfileInspectionReceipt | OriginalProfileInspectionReceipt>;

export interface ProfileInspectionRunnerPort {
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): void;
  postMessage(value: unknown): void;
}

export function startProfileInspectionRunner(options: {
  readonly parentPort: ProfileInspectionRunnerPort;
  readonly acquireReservation: typeof acquireWorkspaceProcessReservation;
  readonly loadOperation: (deployment: ProfileInspectionDeployment, beginLoad: () => void,
    kind: InspectionOperation['kind']) => Promise<RunInspection>;
  readonly exit: (code: number) => void;
}): void {
  let phase: 'awaitingPreparation' | 'acquiring' | 'awaitingGrant' | 'loading' | 'running' | 'terminal' | 'exiting' = 'awaitingPreparation';
  let prepared: Extract<ProfileInspectionCommand, { type: 'prepare' }> | undefined;
  let reservation: WorkspaceProcessReservation | undefined;
  let pending: Promise<void> | undefined;
  let terminalSent = false;
  let exitCode = 1;
  let firstFailure: Error | undefined;
  const cancellation = new AbortController();
  const deadline = performance.now() + profileInspectionWorkMilliseconds;
  const timer = setTimeout(() => fail(new Error('PROFILE_INSPECTION_TIMEOUT')), profileInspectionWorkMilliseconds);

  const exitOnce = (code: number) => {
    if (phase === 'exiting') return;
    phase = 'exiting';
    clearTimeout(timer);
    reservation?.invalidated.removeEventListener('abort', reservationLost);
    cancellation.abort();
    // Do not release before real process exit: a message is not absence.
    options.exit(code);
  };
  const postFailure = () => {
    if (prepared === undefined || terminalSent || phase === 'exiting') return;
    terminalSent = true;
    exitCode = 1;
    phase = 'terminal';
    options.parentPort.postMessage(createProfileInspectionStatus({
      ...identity(prepared), type: 'failed',
      causeCode: readProfileInspectionFailureCause(firstFailure) ?? 'unknown',
    }));
  };
  const fail = (error: Error) => {
    if (phase === 'exiting') return;
    firstFailure ??= error;
    cancellation.abort();
    const settle = () => {
      try { postFailure(); } catch { /* A broken parent channel still requires exit. */ }
      exitOnce(1);
    };
    if (pending === undefined) settle();
    else void pending.then(settle, settle);
  };
  const reservationLost = () => fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
  const assertCurrent = () => {
    if (cancellation.signal.aborted || firstFailure !== undefined || performance.now() >= deadline) {
      throw firstFailure ?? new Error('PROFILE_INSPECTION_TIMEOUT');
    }
    if (reservation === undefined || reservation.invalidated.aborted) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
  };
  const assertOwned = async () => {
    assertCurrent();
    await reservation!.assertOwned();
    assertCurrent();
  };
  const prepare = async (command: Extract<ProfileInspectionCommand, { type: 'prepare' }>) => {
    try {
      reservation = await options.acquireReservation({
        userDataRoot: command.reservation.userDataRoot,
        expectedIdentity: command.reservation.identity,
        signal: cancellation.signal,
      });
      assertCurrent();
      if (reservation.identity !== command.reservation.identity) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      reservation.invalidated.addEventListener('abort', reservationLost, { once: true });
      phase = 'awaitingGrant';
      options.parentPort.postMessage(createProfileInspectionStatus({
        ...identity(command), type: 'reservationReady', reservation: command.reservation,
      }));
    } catch (error) {
      firstFailure ??= error instanceof Error ? error : new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      try { postFailure(); } catch { /* The native exit remains the terminal fallback. */ }
      exitOnce(1);
    }
  };
  const run = async () => {
    try {
      const command = prepared!;
      await assertOwned();
      const operation = await options.loadOperation(command.deployment, () => {
        assertCurrent();
        if (phase !== 'loading') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
        phase = 'running';
      }, command.kind);
      assertCurrent();
      if (phase !== 'running') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      await assertOwned();
      const result = await operation({
        ...(command.kind === 'inspectColdRestoreOriginal'
          ? { kind: command.kind, ...command.sources, anchorRoot: command.reservation.userDataRoot }
          : command.kind === 'inspectColdRestoreContent'
            ? { kind: command.kind, ...command.sources, stagingRoot: dirname(command.reservation.userDataRoot) }
            : { kind: command.kind, migrationPolicy: command.migrationPolicy, stagingRoot: dirname(command.reservation.userDataRoot) }),
        operationId: command.operationId,
        inspectionRoot: resolveProfileInspectionCopyRoot(command.reservation),
        migrationsDirectory: command.deployment.migrationsDirectory,
        nativeResourceRoot: command.deployment.nativeResourceRoot,
      }, { signal: cancellation.signal, assertOwned, createArtifactIdentity: createProfileSnapshotArtifactIdentity,
        writeDocumentBindings: artifacts => writeProfileInspectionDocumentBindings(
          resolveProfileInspectionCopyRoot(command.reservation), artifacts, cancellation.signal,
        ),
      });
      await assertOwned();
      let terminal: ProfileInspectionStatus;
      if (command.kind === 'inspectColdRestoreContent') {
        const content = parseColdProfileInspectionReceipt(result);
        if (content === undefined || content.databaseSlot !== command.sources.databaseSlot ||
            content.documentsSlot !== command.sources.documentsSlot) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
        terminal = createProfileInspectionStatus({ ...identity(command), type: 'coldCompleted', result: content });
      } else if (command.kind === 'inspectColdRestoreOriginal') {
        const original = parseOriginalProfileInspectionReceipt(result);
        if (original === undefined || original.layout !== command.sources.layout ||
            original.databaseSlot !== command.sources.databaseSlot || original.documentsSlot !== command.sources.documentsSlot) {
          throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
        }
        terminal = createProfileInspectionStatus({ ...identity(command), type: 'originalCompleted', result: original });
      } else {
        const portable = parseProfileInspectionReceipt(result);
        if (portable === undefined || portable.migrationPolicy !== command.migrationPolicy) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
        terminal = createProfileInspectionStatus({ ...identity(command), type: 'completed', result: portable });
      }
      terminalSent = true;
      exitCode = 0;
      phase = 'terminal';
      options.parentPort.postMessage(terminal);
    } catch (error) {
      firstFailure ??= error instanceof Error ? error : new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      if (terminalSent) { exitOnce(1); return; }
      try { postFailure(); } catch { exitOnce(1); }
    }
  };

  options.parentPort.on('message', event => {
    if (phase === 'exiting') return;
    const command = parseProfileInspectionCommand(event.data);
    if (command === undefined) { fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return; }
    if (command.type === 'prepare') {
      if (phase !== 'awaitingPreparation') { fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return; }
      prepared = command;
      phase = 'acquiring';
      pending = prepare(command);
      return;
    }
    if (prepared === undefined || !sameIdentity(prepared, command)) {
      fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID')); return;
    }
    if (command.type === 'grant' && phase === 'awaitingGrant') {
      phase = 'loading';
      pending = run();
      return;
    }
    if (command.type === 'shutdown') {
      if (phase === 'terminal') exitOnce(exitCode);
      else fail(new Error('PROFILE_INSPECTION_TIMEOUT'));
      return;
    }
    fail(new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'));
  });
  try {
    options.parentPort.postMessage(createProfileInspectionStatus({ type: 'ready', protocolVersion: profileInspectionProtocolVersion }));
  } catch { exitOnce(1); }
}

function identity(command: ProfileInspectionRequestIdentity): ProfileInspectionRequestIdentity {
  return { protocolVersion: profileInspectionProtocolVersion, generationId: command.generationId,
    operationId: command.operationId, runtimeSession: command.runtimeSession };
}

function sameIdentity(first: ProfileInspectionRequestIdentity, second: ProfileInspectionRequestIdentity): boolean {
  return first.operationId === second.operationId && first.generationId === second.generationId && first.runtimeSession === second.runtimeSession;
}

export async function loadBackendProfileInspection(
  deployment: ProfileInspectionDeployment,
  beginLoad: () => void,
  kind: InspectionOperation['kind'] = 'inspect',
): Promise<RunInspection> {
  const root = resolve(deployment.backendRoot);
  const exportName = kind === 'inspectColdRestoreOriginal' ? 'runColdOriginalProfileInspection'
    : kind === 'inspectColdRestoreContent' ? 'runColdProfileInspection' : 'runProfileInspection';
  const moduleName = kind === 'inspectColdRestoreOriginal' ? 'runColdProfileInspection' : exportName;
  const modulePath = join(root, 'dist', 'runtime', 'profileSnapshot', `${moduleName}.js`);
  const withinRoot = relative(root, deployment.migrationsDirectory);
  if (withinRoot === '' || withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  for (const path of [root, deployment.migrationsDirectory, deployment.nativeResourceRoot, modulePath]) {
    const canonical = await realpath(path);
    if (process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
  }
  beginLoad();
  const module = await import(pathToFileURL(modulePath).href) as Partial<Record<typeof exportName, RunInspection>>;
  const operation = module[exportName];
  if (typeof operation !== 'function') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return operation;
}

const utilityParentPort = process.parentPort;
if (utilityParentPort !== undefined) {
  startProfileInspectionRunner({ parentPort: utilityParentPort,
    acquireReservation: acquireWorkspaceProcessReservation,
    loadOperation: loadBackendProfileInspection, exit: code => process.exit(code) });
}
