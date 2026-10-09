import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  createWorkspaceCandidateReservationReadyStatus,
  parseWorkspaceCandidateProcessCommand,
  workspaceCandidateStartupTimeoutMilliseconds,
  type WorkspaceCandidateProcessCommand,
  type WorkspaceCandidateProcessOperation,
  type WorkspaceCandidateProcessResult,
} from './workspaceCandidateMessages.js';
import {
  acquireWorkspaceProcessReservation,
  type WorkspaceProcessReservation,
} from './workspaceProcessReservation.js';

type BackendWorkspaceCandidateOperation = Omit<
  WorkspaceCandidateProcessOperation,
  'backendRoot'
>;

type RunWorkspaceCandidateOperation = (
  operation: BackendWorkspaceCandidateOperation,
  control: { readonly signal: AbortSignal },
) => Promise<WorkspaceCandidateProcessResult>;

interface WorkspaceCandidateBackendModule {
  runWorkspaceCandidateOperation?: RunWorkspaceCandidateOperation;
}

export interface WorkspaceCandidateRunnerPort {
  on(
    event: 'message',
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  postMessage(value: unknown): void;
}

export interface WorkspaceCandidateRunnerOptions {
  readonly acquireReservation: typeof acquireWorkspaceProcessReservation;
  readonly exit: (code: number) => void;
  readonly loadOperation: (
    operation: WorkspaceCandidateProcessOperation,
    control: { readonly beginLoad: () => void },
  ) => Promise<RunWorkspaceCandidateOperation>;
  readonly parentPort: WorkspaceCandidateRunnerPort;
}

interface BoundRequest {
  readonly operationId: string;
  readonly requestId: string;
  readonly runtimeSession: string;
}

export function startWorkspaceCandidateRunner(
  options: Readonly<WorkspaceCandidateRunnerOptions>,
): void {
  let phase: 'awaitingPreparation' | 'acquiringReservation' | 'awaitingGrant'
    | 'verifyingGrant' | 'loading'
    | 'running' | 'terminal' | 'exiting' = 'awaitingPreparation';
  let boundRequest: BoundRequest | undefined;
  const abortController = new AbortController();
  let reservation: WorkspaceProcessReservation | undefined;
  let operationTask: Promise<void> | undefined;
  let shutdownRequested = false;
  let protocolInvalid = false;
  let terminalSent = false;
  let terminalOutcome: 'completed' | 'failed' | undefined;
  let exited = false;
  // One startup budget includes preparation, acquisition and the work grant.
  const startupTimer = setTimeout(
    () => failProtocol(), workspaceCandidateStartupTimeoutMilliseconds,
  );

  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    phase = 'exiting';
    clearTimeout(startupTimer);
    abortController.abort();
    reservation?.invalidated.removeEventListener('abort', failProtocol);
    // The process exit releases the reservation, never an earlier terminal message.
    options.exit(code);
  };

  const postFailedOnce = (request: BoundRequest): void => {
    if (terminalSent || exited) return;
    terminalSent = true;
    terminalOutcome = 'failed';
    try {
      options.parentPort.postMessage(
        createWorkspaceCandidateFailedStatus(request),
      );
    } catch {
      protocolInvalid = true;
    }
  };

  const failProtocol = (): void => {
    if (phase === 'exiting') return;
    protocolInvalid = true;
    shutdownRequested = true;
    abortController.abort();
    if (phase !== 'running') {
      if (boundRequest !== undefined) postFailedOnce(boundRequest);
      exitOnce(1);
      return;
    }
    void operationTask?.finally(() => exitOnce(1));
  };

  const identitiesMatch = (
    command: WorkspaceCandidateProcessCommand,
  ): boolean =>
    boundRequest !== undefined &&
    command.operationId === boundRequest.operationId &&
    command.requestId === boundRequest.requestId &&
    command.runtimeSession === boundRequest.runtimeSession;

  const prepare = async (
    command: Extract<WorkspaceCandidateProcessCommand, { type: 'prepare' }>,
  ): Promise<void> => {
    try {
      const acquired = await options.acquireReservation({
        expectedIdentity: command.reservation.identity,
        signal: abortController.signal,
        userDataRoot: command.reservation.userDataRoot,
      });
      if (phase !== 'acquiringReservation' || abortController.signal.aborted) return;
      reservation = acquired;
      if (acquired.identity !== command.reservation.identity || acquired.invalidated.aborted) {
        failProtocol();
        return;
      }
      acquired.invalidated.addEventListener('abort', failProtocol, { once: true });
      phase = 'awaitingGrant';
      options.parentPort.postMessage(createWorkspaceCandidateReservationReadyStatus(command));
    } catch {
      failProtocol();
    }
  };

  const assertGrantValid = (): void => {
    if (exited || protocolInvalid || abortController.signal.aborted
      || reservation === undefined || reservation.invalidated.aborted) {
      throw new Error('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
    }
  };

  const assertWorkAllowed = (): void => {
    assertGrantValid();
    if (phase !== 'running') throw new Error('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
  };

  const runOperation = async (
    command: Extract<WorkspaceCandidateProcessCommand, { type: 'start' }>,
  ): Promise<void> => {
    try {
      assertGrantValid();
      await reservation!.assertOwned();
      assertGrantValid();
      phase = 'loading';
      const operation = await options.loadOperation(command.operation, {
        beginLoad: () => {
          assertGrantValid();
          if (phase !== 'loading') throw new Error('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
          // Before this synchronous boundary the loader may only validate paths.
          phase = 'running';
          clearTimeout(startupTimer);
        },
      });
      assertWorkAllowed();
      await reservation!.assertOwned();
      assertWorkAllowed();
      const { backendRoot: _backendRoot, ...backendOperation } =
        command.operation;
      const result = await operation(backendOperation, {
        signal: abortController.signal,
      });
      assertWorkAllowed();
      terminalSent = true;
      terminalOutcome = 'completed';
      try {
        options.parentPort.postMessage(
          createWorkspaceCandidateCompletedStatus({
            ...boundRequest!,
            result,
          }),
        );
      } catch {
        protocolInvalid = true;
        shutdownRequested = true;
        terminalOutcome = 'failed';
      }
      phase = 'terminal';
    } catch {
      if (exited) return;
      postFailedOnce(boundRequest!);
      phase = 'terminal';
    } finally {
      clearTimeout(startupTimer);
      if (shutdownRequested || protocolInvalid) {
        exitOnce(terminalOutcome === 'completed' && !protocolInvalid ? 0 : 1);
      }
    }
  };

  options.parentPort.on('message', (event) => {
    if (exited) return;
    const command = parseWorkspaceCandidateProcessCommand(event.data);
    if (command === undefined) {
      failProtocol();
      return;
    }

    if (command.type === 'prepare') {
      if (phase !== 'awaitingPreparation') {
        failProtocol();
        return;
      }
      boundRequest = {
        operationId: command.operationId,
        requestId: command.requestId,
        runtimeSession: command.runtimeSession,
      };
      phase = 'acquiringReservation';
      void prepare(command);
      return;
    }

    if (command.type === 'start') {
      if (phase !== 'awaitingGrant' || !identitiesMatch(command)) {
        failProtocol();
        return;
      }
      phase = 'verifyingGrant';
      operationTask = runOperation(command);
      return;
    }

    if (phase === 'awaitingPreparation') {
      boundRequest = {
        operationId: command.operationId,
        requestId: command.requestId,
        runtimeSession: command.runtimeSession,
      };
      postFailedOnce(boundRequest);
      exitOnce(1);
      return;
    }
    if (!identitiesMatch(command)) {
      failProtocol();
      return;
    }
    if (phase === 'acquiringReservation' || phase === 'awaitingGrant'
      || phase === 'verifyingGrant' || phase === 'loading') {
      failProtocol();
      return;
    }
    if (phase === 'running') {
      shutdownRequested = true;
      abortController.abort();
      void operationTask?.finally(() =>
        exitOnce(terminalOutcome === 'completed' ? 0 : 1),
      );
      return;
    }
    if (phase === 'terminal') {
      exitOnce(terminalOutcome === 'completed' ? 0 : 1);
      return;
    }
    failProtocol();
  });

  try {
    options.parentPort.postMessage(createWorkspaceCandidateReadyStatus());
  } catch {
    exitOnce(1);
  }
}

export async function loadBackendWorkspaceCandidateOperation(
  operation: WorkspaceCandidateProcessOperation,
  control: { readonly beginLoad: () => void },
): Promise<RunWorkspaceCandidateOperation> {
  const backendRoot = resolve(operation.backendRoot);
  const migrationsDirectory = resolve(operation.migrationsDirectory);
  const modulePath = resolve(
    backendRoot,
    'dist',
    'runtime',
    'workspaceCandidate',
    'runWorkspaceCandidateOperation.js',
  );
  if (
    !isAbsolute(backendRoot) ||
    !isStrictlyContainedPath(backendRoot, modulePath) ||
    !isStrictlyContainedPath(backendRoot, migrationsDirectory) ||
    !pathsAreEqual(await realpath(backendRoot), backendRoot) ||
    !pathsAreEqual(
      await realpath(migrationsDirectory),
      migrationsDirectory,
    ) ||
    !pathsAreEqual(await realpath(modulePath), modulePath)
  ) {
    throw new Error('WORKSPACE_CANDIDATE_MODULE_INVALID');
  }
  control.beginLoad();
  const module = (await import(
    pathToFileURL(modulePath).href
  )) as WorkspaceCandidateBackendModule;
  if (typeof module.runWorkspaceCandidateOperation !== 'function') {
    throw new Error('WORKSPACE_CANDIDATE_MODULE_INVALID');
  }
  return module.runWorkspaceCandidateOperation;
}

function isStrictlyContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

const utilityParentPort = process.parentPort;
if (utilityParentPort !== undefined) {
  startWorkspaceCandidateRunner({
    acquireReservation: acquireWorkspaceProcessReservation,
    exit: (code) => process.exit(code),
    loadOperation: loadBackendWorkspaceCandidateOperation,
    parentPort: utilityParentPort,
  });
}
