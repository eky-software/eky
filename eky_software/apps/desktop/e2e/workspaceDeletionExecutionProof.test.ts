import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import type { WorkspaceManagementCapability } from '../src/workspaces/management/workspaceManagementCapability.js';
import type { WorkspaceManagementService } from '../src/workspaces/management/workspaceManagementService.js';
import type { WorkspaceDeletionPreparationLifetime } from '../src/workspaces/management/workspaceManagementTypes.js';
import { readSelectorTestRelease, usesSelectorTestBackend } from './electronSelectorTestRelease.js';
import { createWorkspaceDeletionExecutionProof, projectWorkspaceDeletionExecutionFailure } from './workspaceDeletionExecutionProof.js';
import { workspaceDeletionExecutionProofScenarioIds, workspaceDeletionProofPreload } from './workspaceDeletionProofProtocol.js';

const work: Promise<unknown>[] = [];
const fixtures: { proof: ReturnType<typeof createWorkspaceDeletionExecutionProof>;
  root: string; capability: WorkspaceManagementCapability | undefined }[] = [];
const request = Object.freeze({ formatVersion: 1, workspaceId: '11111111-1111-4111-8111-111111111111',
  typedLabel: 'Synthetic deletion', backupChoice: 'explicitDataLoss' });
const completed = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const,
  navigation: 'selector' as const });

afterEach(async () => {
  for (const f of fixtures) f.proof.close();
  await Promise.allSettled(work.splice(0));
  for (const f of fixtures.splice(0)) {
    await f.capability?.shutdown();
    await rm(f.root, { recursive: true, force: true });
  }
});

it.each(workspaceDeletionExecutionProofScenarioIds)('uses the real backend but no preload for %s', scenario => {
  expect(usesSelectorTestBackend(scenario)).toBe(true);
  expect(readSelectorTestRelease(scenario)?.appVersion).toBe('0.2.0');
  expect(workspaceDeletionProofPreload(scenario)).toBe('');
});

it('rejects other scenarios and requires one captured service before readiness', async () => {
  const f = await fixture();
  expect(() => createWorkspaceDeletionExecutionProof({ ...f.input, scenarioId: 'DESK-DELETE-PREPARE-001' }))
    .toThrow('E2E_WORKSPACE_DELETION_SCENARIO_INVALID');
  expect(() => f.proof.ready()).toThrow('E2E_WORKSPACE_DELETION_EXECUTION_SERVICE_INVALID');
  f.install(); f.proof.ready();
  expect(() => f.proof.ready()).toThrow('E2E_WORKSPACE_DELETION_EXECUTION_SERVICE_INVALID');
  expect(() => f.proof.createCapability(f.options)).toThrow('E2E_WORKSPACE_DELETION_EXECUTION_SERVICE_INVALID');
});

it('returns the actual main-service receipt once and expires the requester after completion', async () => {
  const f = await fixture(); f.install(); f.proof.ready();
  let retained: WorkspaceDeletionPreparationLifetime | undefined;
  f.execute.mockImplementationOnce(async (value, lifetime) => {
    expect(value).toBe(request); retained = lifetime;
    lifetime.assertCurrent(); lifetime.closeAdmissionForOwnStop(); return completed;
  });
  await expect(track(f.proof.execute(request))).resolves.toBe(completed);
  expect(f.proof.snapshot()).toEqual({ ready: true, sealed: false, request: 'completed' });
  expect(() => retained!.assertCurrent()).toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  await expect(f.proof.execute(request)).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.prepare).not.toHaveBeenCalled();
});

it('retains a cancelled receipt instead of claiming completed deletion', async () => {
  const f = await fixture(); f.install(); f.proof.ready();
  const cancelled = Object.freeze({ formatVersion: 1 as const, status: 'cancelled' as const });
  f.execute.mockResolvedValueOnce(cancelled);
  await expect(track(f.proof.execute(request))).resolves.toBe(cancelled);
  expect(f.proof.readFailures().execution).toBeUndefined();
});

it('preserves a real service completion after its durable handoff even if the test admission closes', async () => {
  const f = await fixture(); f.install(); f.proof.ready();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.execute.mockImplementationOnce(async (_value, lifetime) => {
    lifetime.assertCurrent(); lifetime.closeAdmissionForOwnStop();
    await held;
    // The actual service owns durable authority after its handoff.
    return completed;
  });
  const pending = track(f.proof.execute(request));
  try {
    f.proof.close(); await Promise.resolve();
    expect(f.proof.snapshot().request).toBe('pending');
  } finally { release(); }
  await expect(pending).resolves.toBe(completed);
  expect(f.proof.readFailures().execution).toBeUndefined();
});

it('does not settle held work when main seals admission and preserves its original failure', async () => {
  const f = await fixture(); f.install(); f.proof.ready();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  f.execute.mockImplementationOnce(async (_value, lifetime) => {
    await held; lifetime.assertCurrent(); return completed;
  });
  const pending = track(f.proof.execute(request));
  try {
    expect(f.proof.snapshot().request).toBe('pending');
    f.proof.close(); await Promise.resolve();
    expect(f.proof.snapshot()).toEqual({ ready: false, sealed: true, request: 'pending' });
  } finally { release(); }
  await expect(pending).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  expect(f.proof.readFailures().execution?.chain[0]?.message).toBe('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
});

it('captures the original chain before safe conversion and never replaces it on a second call', async () => {
  const f = await fixture(); f.install(); f.proof.ready();
  f.execute.mockRejectedValueOnce(new Error(`SYNTHETIC_EXECUTION_FIRST ${f.input.sessionSecret}`,
    { cause: new Error('SYNTHETIC_EXECUTION_CAUSE') }));
  await expect(track(f.proof.execute(request))).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  const original = f.proof.readFailures().execution;
  expect(original?.chain[0]?.message).toBe('SYNTHETIC_EXECUTION_FIRST [redacted]');
  expect(original?.chain[1]?.message).toBe('SYNTHETIC_EXECUTION_CAUSE');
  expect(original?.chain[0]?.stack).toContain('workspaceDeletionExecutionProof.test.ts');
  expect(JSON.stringify(original)).not.toContain(f.input.sessionSecret);
  await expect(f.proof.execute(request)).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  expect(f.proof.readFailures().execution).toEqual(original);
});

it('keeps command and lease-release failures as distinct bounded projections', async () => {
  const f = await fixture(); f.install(); f.proof.ready();
  const first = new Error('SYNTHETIC_COMMAND_FIRST', { cause: new Error('SYNTHETIC_COMMAND_CAUSE') });
  f.execute.mockRejectedValueOnce(new AggregateError([first, new Error('SYNTHETIC_RELEASE_FAILURE')],
    'SYNTHETIC_COMBINED', { cause: first }));
  await expect(track(f.proof.execute(request))).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  const failure = f.proof.readFailures();
  expect(failure.execution?.chain.map(part => part.message))
    .toEqual(['SYNTHETIC_COMBINED', 'SYNTHETIC_COMMAND_FIRST', 'SYNTHETIC_COMMAND_CAUSE']);
  expect(failure.executionRelated.map(value => value.chain[0]?.message)).toEqual(['SYNTHETIC_RELEASE_FAILURE']);
});

it('retains both native read and close failures when an aggregate has no cause', () => {
  const result = projectWorkspaceDeletionExecutionFailure(new Error('SYNTHETIC_WRAPPER', { cause:
    new AggregateError([new Error('SYNTHETIC_READ'), new Error('SYNTHETIC_CLOSE')], 'SYNTHETIC_NATIVE') }), 'secret');
  expect(result.executionRelated.map(value => value.chain[0]?.message)).toEqual(['SYNTHETIC_READ', 'SYNTHETIC_CLOSE']);
  expect(result.execution.incomplete).toBe(false);
});

it('bounds aggregate siblings and marks omitted or unreadable content incomplete', () => {
  const result = projectWorkspaceDeletionExecutionFailure(
    new AggregateError(Array.from({ length: 20 }, (_, index) => new Error(`SYNTHETIC_${index}`))), 'secret');
  expect(result.executionRelated).toHaveLength(4);
  expect(result.execution.incomplete).toBe(true);
  const invalid = new AggregateError([]);
  const getter = vi.fn(() => { throw new Error('SYNTHETIC_GETTER'); });
  Object.defineProperty(invalid, 'errors', { get: getter });
  expect(projectWorkspaceDeletionExecutionFailure(invalid, 'secret').execution.incomplete).toBe(true);
  expect(getter).not.toHaveBeenCalled();
});

it('does not invoke aggregate array methods, element getters or proxy traps during capture', () => {
  const getter = vi.fn(() => { throw new Error('SYNTHETIC_ARRAY_GETTER'); });
  const errors = [new Error('SYNTHETIC_ARRAY_FIRST')];
  Object.defineProperty(errors, '0', { get: getter });
  Object.defineProperty(errors, 'slice', { get: getter });
  const invalid = new AggregateError([]);
  Object.defineProperty(invalid, 'errors', { value: errors });
  expect(projectWorkspaceDeletionExecutionFailure(invalid, 'secret').execution.incomplete).toBe(true);
  const proxy = new Proxy(new Error('SYNTHETIC_PROXY'), { getOwnPropertyDescriptor: getter });
  expect(projectWorkspaceDeletionExecutionFailure(proxy, 'secret').execution.incomplete).toBe(true);
  expect(getter).not.toHaveBeenCalled();
});

it('does not pass nested cause proxies to the shared projector in primary or sibling chains', () => {
  const trap = vi.fn(() => { throw new Error('SYNTHETIC_PROXY_TRAP'); });
  const proxy = new Proxy(new Error('SYNTHETIC_NESTED_PROXY'), { getOwnPropertyDescriptor: trap });
  const outer = new Error('SYNTHETIC_OUTER', { cause: proxy });
  const primary = projectWorkspaceDeletionExecutionFailure(outer, 'secret');
  expect(primary.execution.incomplete).toBe(true);
  const related = projectWorkspaceDeletionExecutionFailure(new AggregateError([outer]), 'secret');
  expect(related.executionRelated[0]?.incomplete).toBe(true);
  expect(trap).not.toHaveBeenCalled();
});

it.each(['notReady', 'closed', 'lostMain'] as const)('rejects %s without starting the service', async invalid => {
  const f = await fixture(); f.install();
  if (invalid !== 'notReady') f.proof.ready();
  if (invalid === 'closed') f.proof.close();
  if (invalid === 'lostMain') f.revokeMain();
  await expect(track(f.proof.execute(request))).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  expect(f.execute).not.toHaveBeenCalled();
});

function track<T>(promise: Promise<T>): Promise<T> {
  work.push(promise); void promise.catch(() => undefined); return promise;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-execution-'));
  let current = true;
  const input = { scenarioId: 'DESK-DELETE-LAST-001', userDataRoot: root, sessionSecret: 's'.repeat(43),
    assertMainCurrent() { if (!current) throw new Error('SYNTHETIC_MAIN_REVOKED'); }, backendIsRunning: () => false };
  const proof = createWorkspaceDeletionExecutionProof(input);
  const unused = async (): Promise<never> => { throw new Error('UNEXPECTED_FIXTURE_OPERATION'); };
  const prepare = vi.fn(unused);
  const execute = vi.fn<WorkspaceManagementService['deleteWorkspace']>(async () => completed);
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const service = { createEmpty: unused, getStatus: unused, importBackupAsNew: unused, rename: unused,
    replaceActiveFromBackup: unused, switchTo: unused, prepareDeletion: prepare, deleteWorkspace: execute };
  const options: Parameters<typeof proof.createCapability>[0] = {
    ipcMain: { handle() {}, removeHandler() {} }, mainWindow: mainWindow as never,
    passwordWindow: { requestPassword: unused }, confirmActiveWorkspaceReplacement: unused,
    selectBackupSource: unused, selectReplacementBackupSource: unused, showSafeError() {}, service,
  };
  const f = { root, input, proof, options, execute, prepare,
    capability: undefined as WorkspaceManagementCapability | undefined,
    revokeMain() { current = false; }, install() { f.capability = proof.createCapability(options); } };
  fixtures.push(f); return f;
}
