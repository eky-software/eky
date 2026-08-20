import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  parseWorkspaceCandidateProcessCommand,
  type WorkspaceCandidateProcessCommand,
  type WorkspaceCandidateProcessOperation,
  type WorkspaceCandidateProcessResult,
} from './workspaceCandidateMessages.js';

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
  readonly exit: (code: number) => void;
  readonly loadOperation: (
    operation: WorkspaceCandidateProcessOperation,
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
  let phase: 'awaitingStart' | 'running' | 'terminal' | 'exiting' =
    'awaitingStart';
  let boundRequest: BoundRequest | undefined;
  let abortController: AbortController | undefined;
  let operationTask: Promise<void> | undefined;
  let shutdownRequested = false;
  let protocolInvalid = false;
  let terminalSent = false;
  let terminalOutcome: 'completed' | 'failed' | undefined;
  let exited = false;

  const exitOnce = (code: number): void => {
    if (exited) return;
    exited = true;
    phase = 'exiting';
    options.exit(code);
  };

  const postFailedOnce = (request: BoundRequest): void => {
    if (terminalSent) return;
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
    if (phase === 'awaitingStart' || boundRequest === undefined) {
      exitOnce(1);
      return;
    }
    if (phase === 'terminal') {
      exitOnce(1);
      return;
    }
    abortController?.abort();
    void operationTask?.finally(() => exitOnce(1));
  };

  const identitiesMatch = (
    command: WorkspaceCandidateProcessCommand,
  ): boolean =>
    boundRequest !== undefined &&
    command.operationId === boundRequest.operationId &&
    command.requestId === boundRequest.requestId &&
    command.runtimeSession === boundRequest.runtimeSession;

  const runOperation = async (
    command: Extract<WorkspaceCandidateProcessCommand, { type: 'start' }>,
  ): Promise<void> => {
    try {
      const operation = await options.loadOperation(command.operation);
      const { backendRoot: _backendRoot, ...backendOperation } =
        command.operation;
      const result = await operation(backendOperation, {
        signal: abortController!.signal,
      });
      if (
        phase !== 'running' ||
        protocolInvalid ||
        abortController!.signal.aborted
      ) {
        throw new Error('WORKSPACE_CANDIDATE_OPERATION_CANCELLED');
      }
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
      postFailedOnce(boundRequest!);
      phase = 'terminal';
    } finally {
      if (shutdownRequested || protocolInvalid) {
        exitOnce(terminalOutcome === 'completed' && !protocolInvalid ? 0 : 1);
      }
    }
  };

  options.parentPort.on('message', (event) => {
    const command = parseWorkspaceCandidateProcessCommand(event.data);
    if (command === undefined) {
      failProtocol();
      return;
    }

    if (command.type === 'start') {
      if (phase !== 'awaitingStart') {
        failProtocol();
        return;
      }
      boundRequest = {
        operationId: command.operationId,
        requestId: command.requestId,
        runtimeSession: command.runtimeSession,
      };
      abortController = new AbortController();
      phase = 'running';
      operationTask = runOperation(command);
      return;
    }

    if (phase === 'awaitingStart') {
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
    if (phase === 'running') {
      shutdownRequested = true;
      abortController?.abort();
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

async function loadBackendWorkspaceCandidateOperation(
  operation: WorkspaceCandidateProcessOperation,
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
    exit: (code) => process.exit(code),
    loadOperation: loadBackendWorkspaceCandidateOperation,
    parentPort: utilityParentPort,
  });
}
