import { join } from 'node:path';
import { isProxy } from 'node:util/types';

import type { DesktopCompositionDependencies } from '../src/main/desktopComposition.js';
import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../src/main/startupExceptionEvidence.js';
import { assertUpdateJournalAuthority } from '../src/update/updateJournalStore.js';
import { createWorkspaceDeletionCommand } from '../src/workspaces/deletion/workspaceDeletionCommand.js';
import { createWorkspaceManagementCapability } from '../src/workspaces/management/workspaceManagementCapability.js';
import type { WorkspaceManagementCapability } from '../src/workspaces/management/workspaceManagementCapability.js';
import type { WorkspaceManagementService } from '../src/workspaces/management/workspaceManagementService.js';
import type { WorkspaceDeletionPreparationLifetime } from '../src/workspaces/management/workspaceManagementTypes.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { isWorkspaceDeletionExecutionProofScenario, workspaceDeletionExecutionProofFailureCode } from './workspaceDeletionProofProtocol.js';

interface WorkspaceDeletionExecutionFailures {
  execution: ReturnType<typeof projectExceptionChain> | undefined;
  executionRelated: ReturnType<typeof projectExceptionChain>[];
}

// Test assembly only: the real main binding owns publication and continuation.
export function createWorkspaceDeletionExecutionProof(input: Readonly<{
  scenarioId: string;
  userDataRoot: string;
  sessionSecret: string;
  assertMainCurrent(): void;
  backendIsRunning(): boolean;
}>) {
  if (!isWorkspaceDeletionExecutionProofScenario(input.scenarioId)) {
    throw new Error('E2E_WORKSPACE_DELETION_SCENARIO_INVALID');
  }
  const assertMain = input.assertMainCurrent.bind(input), running = input.backendIsRunning.bind(input);
  const current = () => assertUpdateJournalAuthority(assertMain);
  const secret = input.sessionSecret;
  const registry = new WorkspaceRegistryStore({ installationRoot: input.userDataRoot,
    filePath: join(input.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME) });
  const command = createWorkspaceDeletionCommand({ userDataRoot: input.userDataRoot, registry,
    async assertWritersAbsent() {
      // The main binding separately proves its real lifecycle and reservation.
      current(); if (running() !== false) throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE'); current();
    } });
  let service: Pick<WorkspaceManagementService, 'deleteWorkspace'> | undefined;
  let capability: WorkspaceManagementCapability | undefined;
  let ready = false, sealed = false, used = false;
  let state: 'notStarted' | 'pending' | 'completed' | 'failed' = 'notStarted';
  let firstFailure: { error: unknown } | undefined;
  const assertCurrent = () => {
    if (sealed) throw new Error('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
    current();
  };
  const createCapability: DesktopCompositionDependencies['createWorkspaceManagementCapability'] = options => {
    assertCurrent();
    if (capability !== undefined || service !== undefined || !('deleteWorkspace' in options.service) ||
        typeof options.service.deleteWorkspace !== 'function') {
      throw new Error('E2E_WORKSPACE_DELETION_EXECUTION_SERVICE_INVALID');
    }
    service = options.service as typeof options.service & Pick<WorkspaceManagementService, 'deleteWorkspace'>;
    capability = createWorkspaceManagementCapability(options);
    return capability;
  };
  return Object.freeze({
    command: Object.freeze({ publish: command.publish, resume: command.resume }),
    createCapability,
    ready() {
      assertCurrent();
      if (ready || service === undefined || capability === undefined) {
        throw new Error('E2E_WORKSPACE_DELETION_EXECUTION_SERVICE_INVALID');
      }
      ready = true;
    },
    close() { sealed = true; ready = false; service = undefined; capability = undefined; },
    async execute(request: unknown) {
      if (used) {
        throw new Error('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
      }
      used = true; state = 'pending';
      let active = true;
      try {
        assertCurrent();
        if (!ready || service === undefined || capability === undefined) {
          throw new Error('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
        }
        const execute = service.deleteWorkspace.bind(service), closeAdmission = capability.closeAdmission.bind(capability);
        const lifetime: WorkspaceDeletionPreparationLifetime = Object.freeze({
          assertCurrent() {
            if (!active) throw new Error('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
            assertCurrent();
          },
          closeAdmissionForOwnStop() { lifetime.assertCurrent(); closeAdmission(); lifetime.assertCurrent(); },
        });
        const result = await execute(request, lifetime);
        state = 'completed'; return result;
      } catch (error) {
        firstFailure ??= { error }; state = 'failed';
        throw new Error(workspaceDeletionExecutionProofFailureCode);
      } finally { active = false; }
    },
    snapshot() { return { ready, sealed, request: state }; },
    readFailures(): WorkspaceDeletionExecutionFailures {
      return firstFailure === undefined ? { execution: undefined, executionRelated: [] }
        : projectWorkspaceDeletionExecutionFailure(firstFailure.error, secret);
    },
  });
}

// Preserve sibling failures without changing the existing cause-chain format.
export function projectWorkspaceDeletionExecutionFailure(error: unknown, secret: string) {
  const execution = projectSafeExecutionChain(error, secret);
  const executionRelated: ReturnType<typeof projectExceptionChain>[] = [];
  const pending: unknown[] = [error], visited = new Set<unknown>();
  const maximum = STARTUP_EXCEPTION_LIMITS.depth;
  const data = (value: object, key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return undefined;
    if (!Object.hasOwn(descriptor, 'value')) { execution.incomplete = true; return undefined; }
    return descriptor.value;
  };
  let inspected = 0;
  while (pending.length !== 0 && inspected < maximum * maximum) {
    const value = pending.shift();
    if (visited.has(value) || value === null || typeof value !== 'object') continue;
    visited.add(value); inspected++;
    try {
      if (isProxy(value)) { execution.incomplete = true; continue; }
      const cause = data(value, 'cause');
      if (cause !== undefined) pending.push(cause);
      const errors = data(value, 'errors');
      if (errors === undefined) continue;
      if (isProxy(errors) || !Array.isArray(errors)) { execution.incomplete = true; continue; }
      const length = data(errors, 'length');
      if (typeof length !== 'number') { execution.incomplete = true; continue; }
      if (length > maximum) execution.incomplete = true;
      for (let index = 0; index < Math.min(length, maximum); index++) {
        const part = data(errors, String(index));
        pending.push(part);
        if (part === cause || visited.has(part)) continue;
        if (isProxy(part)) { execution.incomplete = true; continue; }
        if (executionRelated.length === maximum) { execution.incomplete = true; continue; }
        executionRelated.push(projectSafeExecutionChain(part, secret));
      }
    } catch { execution.incomplete = true; }
  }
  if (pending.length !== 0) execution.incomplete = true;
  return { execution, executionRelated };
}

function projectSafeExecutionChain(error: unknown, secret: string) {
  let current = error;
  // Preflight each node the shared projector can visit, without invoking traps.
  for (let depth = 0; depth < STARTUP_EXCEPTION_LIMITS.depth; depth++) {
    if (isProxy(current)) return projectExceptionChain(undefined, [secret]);
    if (current === null || typeof current !== 'object') break;
    const cause = Object.getOwnPropertyDescriptor(current, 'cause');
    if (cause === undefined) break;
    if (!Object.hasOwn(cause, 'value')) return projectExceptionChain(undefined, [secret]);
    current = cause.value;
  }
  return projectExceptionChain(error, [secret]);
}
