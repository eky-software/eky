import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

import type { WorkspaceManagementCapability } from '../src/workspaces/management/workspaceManagementCapability.js';
import type { WorkspaceManagementService } from '../src/workspaces/management/workspaceManagementService.js';
import type { WorkspaceDeletionPreparationLifetime } from '../src/workspaces/management/workspaceManagementTypes.js';
import { deleteWorkspaceIpcChannel } from '../src/workspaces/management/workspaceManagementCapabilityProtocol.js';
import { createDesktopRecoveryStartup } from '../src/main/desktopRecoveryStartup.js';
import type { DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import { readElectronE2eQuitLifecycle, startElectronE2eRecoveryComposition } from './electronE2eRecoveryComposition.js';
import { readSelectorTestRelease, usesSelectorTestBackend } from './electronSelectorTestRelease.js';
import { createWorkspaceDeletionExecutionProof, projectWorkspaceDeletionExecutionFailure } from './workspaceDeletionExecutionProof.js';
import { workspaceDeletionExecutionProofScenarioIds, workspaceDeletionProofPreload,
  workspaceDeletionProofChannel, workspaceDeletionPublicProofScenarioId, workspaceDeletionRecoveryProofScenarioId } from './workspaceDeletionProofProtocol.js';
import { WORKSPACE_DELETION_MAIN_PHASE_COVERAGE } from './workspaceDeletionPhaseObservation.js';
import { bindPhaseHandoffCapture } from './workspaceDeletionPhaseHandoff.js';
import { createWorkspaceDeletionPhaseProducer } from '../src/main/desktopSelectorComposition.js';
import { createWorkspaceDeletionCommand } from '../src/workspaces/deletion/workspaceDeletionCommand.js';
import { createWorkspaceDeletionFinalizationTestFixture } from '../src/workspaces/deletion/workspaceDeletionFinalizationTestSupport.js';

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
  vi.doUnmock('./workspaceRecoveryDeletionFixture.js');
});

it.each(workspaceDeletionExecutionProofScenarioIds.filter(id => id !== workspaceDeletionRecoveryProofScenarioId))(
  'uses the real backend but no preload for %s', scenario => {
  expect(usesSelectorTestBackend(scenario)).toBe(true);
  expect(readSelectorTestRelease(scenario)?.appVersion).toBe('0.2.0');
  expect(workspaceDeletionProofPreload(scenario)).toBe('');
});

it('adds only the recovery execution call to the isolated preload copy', () => {
  const preload = workspaceDeletionProofPreload(workspaceDeletionRecoveryProofScenarioId);
  expect(usesSelectorTestBackend(workspaceDeletionRecoveryProofScenarioId)).toBe(true);
  expect(preload).toContain('deleteWorkspace:');
  expect(preload).toContain(workspaceDeletionProofChannel);
  expect(preload).not.toContain('prepareDeletion:');
  expect(workspaceDeletionProofPreload('DESK-UNRELATED-001')).toBe('');
});

it('keeps the public deletion UI scenario free of internal command and preload injection', () => {
  expect(usesSelectorTestBackend('DESK-DELETE-UI-001')).toBe(true);
  expect(readSelectorTestRelease('DESK-DELETE-UI-001')?.appVersion).toBe('0.2.0');
  expect(workspaceDeletionProofPreload('DESK-DELETE-UI-001')).toBe('');
});

it('captures the public fulfilled error without an internal IPC or command bypass', async () => {
  const f = await fixture(workspaceDeletionPublicProofScenarioId);
  const original = new Error(`SYNTHETIC_PUBLIC_EXECUTION ${f.input.sessionSecret}`,
    { cause: new Error('SYNTHETIC_PUBLIC_EXECUTION_CAUSE') });
  f.execute.mockRejectedValueOnce(original);
  f.install(); f.proof.ready();
  expect(f.handlers.has(workspaceDeletionProofChannel)).toBe(false);
  await expect(f.proof.execute(request)).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  expect(f.execute).not.toHaveBeenCalled();
  const event = { sender: f.options.mainWindow.webContents, senderFrame: f.options.mainWindow.webContents.mainFrame };
  const result = await track(f.handlers.get(deleteWorkspaceIpcChannel)!(event as never, request));
  expect(result).toEqual({ formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED',
    sideEffectState: 'unknown', nextAction: 'restartRequired' });
  const failure = f.proof.readFailures().execution;
  expect(failure?.chain.map(part => part.message)).toEqual([
    'SYNTHETIC_PUBLIC_EXECUTION [redacted]', 'SYNTHETIC_PUBLIC_EXECUTION_CAUSE',
  ]);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_');
  expect(JSON.stringify(failure)).not.toContain(f.input.sessionSecret);
});

it('does not register recovery deletion on its initial ordinary selector', async () => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  f.install(); f.proof.ready(); f.proof.registerRecoveryChannel();
  expect(f.handlers.has(workspaceDeletionProofChannel)).toBe(false);
  await expect(f.proof.execute(request)).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  expect(f.execute).not.toHaveBeenCalled();
});

it('publishes readiness once through the exact isolated recovery entry wrapper', async () => {
  const f = await fixture();
  const lifecycle: DesktopLifecycleHandle = { applicationWindow: f.options.mainWindow,
    focusApplicationWindow() {}, shutdown: vi.fn(async () => {}),
    isInstallerHandoffPending: () => false, deferQuitForInstallerHandoff: () => false };
  const startup = createDesktopRecoveryStartup<DesktopLifecycleHandle>(), publish = vi.fn();
  try {
    await startElectronE2eRecoveryComposition({ startup, compose: async () => lifecycle, publish });
    expect(publish).toHaveBeenCalledExactlyOnceWith(lifecycle);
  } finally { await startup.shutdown(); }
});

it('does not run readiness after a fulfilled quit in the exact isolated entry wrapper', async () => {
  const f = await fixture();
  const shutdown = vi.fn(async () => {}), publish = vi.fn();
  const lifecycle: DesktopLifecycleHandle = { applicationWindow: f.options.mainWindow, focusApplicationWindow() {}, shutdown,
    isInstallerHandoffPending: () => false, deferQuitForInstallerHandoff: () => false };
  const startup = createDesktopRecoveryStartup<DesktopLifecycleHandle>();
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const starting = track(startElectronE2eRecoveryComposition({ startup,
    async compose() { entered(); await held; return lifecycle; }, publish }));
  try {
    await Promise.race([began, starting]);
    const stopping = track(startup.shutdown());
    release(); await starting; await stopping;
    expect(publish).not.toHaveBeenCalled(); expect(shutdown).toHaveBeenCalledOnce();
  } finally { release(); await startup.shutdown(); }
});

it('retains composition and separate close errors without publishing readiness', async () => {
  const startup = createDesktopRecoveryStartup<DesktopLifecycleHandle>(), publish = vi.fn();
  const primary = new Error('SYNTHETIC_ENTRY_COMPOSITION'), cleanup = new Error('SYNTHETIC_ENTRY_CLOSE');
  const result = await startElectronE2eRecoveryComposition({ startup, publish,
    async compose(port) {
      port.registerObservation({ closeAdmission() { throw cleanup; }, async waitForSettlement() {} });
      throw primary;
    },
  }).catch(error => error);
  expect(result.message).toBe('DESKTOP_START_FAILED');
  expect(result.cause.cause).toBe(primary);
  expect(result.cause.errors[0]).toBe(primary);
  expect(result.cause.errors[1].errors).toContain(cleanup);
  expect(publish).not.toHaveBeenCalled();
});

it('leaves an ordinary or missing quit lifecycle unchanged without recovery preparation', () => {
  const owner = { shutdown: vi.fn(async () => {}) }, wait = vi.fn(async () => {});
  expect(readElectronE2eQuitLifecycle(owner, undefined)).toBe(owner);
  expect(readElectronE2eQuitLifecycle(undefined, wait)).toBeUndefined();
  expect(wait).not.toHaveBeenCalled(); expect(owner.shutdown).not.toHaveBeenCalled();
});

it.for(['owner', 'preparation'] as const)('waits for held %s work in the exact isolated quit wrapper', async heldAt => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const owner = { shutdown: vi.fn(async () => { if (heldAt === 'owner') await held; }),
    deferQuitForInstallerHandoff: vi.fn(() => true) };
  const wait = vi.fn(async () => { if (heldAt === 'preparation') await held; });
  const lifecycle = readElectronE2eQuitLifecycle(owner, wait)!;
  expect(lifecycle.deferQuitForInstallerHandoff?.()).toBe(true);
  expect(owner.deferQuitForInstallerHandoff).toHaveBeenCalledOnce();
  let settled = false;
  const stopping = track(lifecycle.shutdown().finally(() => { settled = true; }));
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(owner.shutdown).toHaveBeenCalledOnce(); expect(wait).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release(); await stopping; expect(settled).toBe(true);
  } finally { release(); await stopping; }
});

it.for(['owner', 'preparation'] as const)('joins both quit tasks after a synchronous %s failure', async failedAt => {
  const original = new Error('SYNTHETIC_QUIT_OWNER'), cleanup = new Error('SYNTHETIC_QUIT_PREPARATION');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const failOwner = () => { throw original; }, failPreparation = () => { throw cleanup; };
  const owner = { shutdown: vi.fn(failedAt === 'owner' ? failOwner : async () => { await held; throw original; }) };
  const wait = vi.fn(failedAt === 'preparation' ? failPreparation : async () => { await held; throw cleanup; });
  let settled = false;
  const stopping = track(readElectronE2eQuitLifecycle(owner, wait)!.shutdown()
    .then(() => undefined, error => error).finally(() => { settled = true; }));
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(owner.shutdown).toHaveBeenCalledOnce(); expect(wait).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    release(); const error = await stopping;
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([original, cleanup]); expect(error.cause).toBe(original);
  } finally { release(); await stopping; }
});

it('forwards the original IPC event through the real capability and removes its test channel on close', async () => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId, true);
  f.install(); f.proof.ready(); f.proof.registerRecoveryChannel();
  const invoke = f.handlers.get(workspaceDeletionProofChannel)!;
  const event = { sender: f.options.mainWindow.webContents, senderFrame: f.options.mainWindow.webContents.mainFrame };
  await expect(track(invoke(event as never, request))).resolves.toEqual(completed);
  expect(f.execute).toHaveBeenCalledOnce();
  expect(f.complete).toHaveBeenCalledWith(completed);
  f.proof.close();
  expect(f.handlers.has(workspaceDeletionProofChannel)).toBe(false);
  await expect(invoke(event as never, request)).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  expect(f.execute).toHaveBeenCalledOnce();
});

it.each(['sender', 'frame', 'arity'] as const)('preserves the actual capability %s rejection', async invalid => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId, true);
  f.install(); f.proof.ready(); f.proof.registerRecoveryChannel();
  const event = { sender: invalid === 'sender' ? {} : f.options.mainWindow.webContents,
    senderFrame: invalid === 'frame' ? {} : f.options.mainWindow.webContents.mainFrame };
  const invoke = f.handlers.get(workspaceDeletionProofChannel)!;
  await expect(track(invoke(event as never, ...(invalid === 'arity' ? [] : [request]))))
    .rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.proof.readFailures().execution?.chain[0]?.message).toBe('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
});

it.each(['service', 'completion'] as const)('retains the original %s error behind a fulfilled recovery result', async phase => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId, true);
  const original = new Error(`SYNTHETIC_RECOVERY_${phase} ${f.input.sessionSecret}`,
    { cause: new Error('SYNTHETIC_RECOVERY_ORIGINAL_CAUSE') });
  if (phase === 'service') f.execute.mockRejectedValueOnce(original);
  else f.complete.mockRejectedValueOnce(original);
  f.install(); f.proof.ready(); f.proof.registerRecoveryChannel();
  const invoke = f.handlers.get(workspaceDeletionProofChannel)!;
  const event = { sender: f.options.mainWindow.webContents, senderFrame: f.options.mainWindow.webContents.mainFrame };
  const result = await track(invoke(event as never, request));
  expect(result).toEqual({ formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED',
    sideEffectState: 'unknown', nextAction: 'restartRequired' });
  expect(f.proof.snapshot().request).toBe('failed');
  const failure = f.proof.readFailures().execution;
  expect(failure?.chain.map(part => part.message)).toEqual([
    `SYNTHETIC_RECOVERY_${phase} [redacted]`, 'SYNTHETIC_RECOVERY_ORIGINAL_CAUSE',
  ]);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_RECOVERY');
  expect(JSON.stringify(failure)).not.toContain(f.input.sessionSecret);
});

it('joins held fixture file work after admission closes before permitting quit settlement', async () => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  f.install(); f.proof.ready();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const file = join(f.root, 'owned-fixture-work.txt');
  vi.doMock('./workspaceRecoveryDeletionFixture.js', () => ({
    async prepareWorkspaceRecoveryDeletionFixture(input: { assertAdmissionCurrent(): void }) {
      await writeFile(file, 'started', { flag: 'wx' });
      entered();
      try { await held; input.assertAdmissionCurrent(); }
      finally { await writeFile(file, ':settled', { flag: 'a' }); }
    },
  }));
  const pending = track(f.proof.prepareRecovery({ workspaceId: request.workspaceId }, async () => {}));
  let settled = false;
  try {
    await Promise.race([started, pending]);
    f.proof.close();
    const joining = track(f.proof.waitForPreparation().finally(() => { settled = true; }));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(await readFile(file, 'utf8')).toBe('started');
    release();
    await expect(pending).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
    await expect(joining).rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
    expect(settled).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('started:settled');
    expect(f.proof.readFailures().execution?.chain[0]?.message).toBe('E2E_WORKSPACE_DELETION_EXECUTION_UNAVAILABLE');
  } finally { release(); }
});

it('validates recovery preparation before closing and retains the original shutdown failure', async () => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  f.install(); f.proof.ready();
  const shutdown = vi.fn(async () => { throw new Error('SYNTHETIC_RECOVERY_PREPARATION_SHUTDOWN'); });
  await expect(f.proof.prepareRecovery({ workspaceId: request.workspaceId, extra: true }, shutdown))
    .rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  expect(shutdown).not.toHaveBeenCalled();
  const valid = await fixture(workspaceDeletionRecoveryProofScenarioId);
  valid.install(); valid.proof.ready();
  await expect(valid.proof.prepareRecovery({ workspaceId: request.workspaceId }, shutdown))
    .rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  expect(shutdown).toHaveBeenCalledOnce();
  expect(valid.proof.readFailures().execution?.chain[0]?.message).toBe('SYNTHETIC_RECOVERY_PREPARATION_SHUTDOWN');
  await expect(valid.proof.prepareRecovery({ workspaceId: request.workspaceId }, shutdown))
    .rejects.toThrow('E2E_WORKSPACE_DELETION_EXECUTION_FAILED');
  expect(shutdown).toHaveBeenCalledOnce();
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

const phaseRuntime = '11111111-1111-4111-8111-111111111111';
const terminalChainTimeoutMs = 30_000;

it('keeps four real command terminal spans in the proof after a full history', { timeout: terminalChainTimeoutMs }, async test => {
  const f = await createWorkspaceDeletionFinalizationTestFixture(test, true, true);
  const proof = createWorkspaceDeletionExecutionProof({ scenarioId: workspaceDeletionRecoveryProofScenarioId,
    userDataRoot: f.root, sessionSecret: 'SYNTHETIC_TEST_SECRET',
    assertMainCurrent: f.authority.assertCurrent, backendIsRunning: () => false,
    observationRuntimeInstanceId: phaseRuntime });
  try {
    proof.observePhase({ phase: 'preparation', event: 'entered', callId: 1 });
    proof.observePhase({ phase: 'preparation', event: 'fulfilled', callId: 1 });
    for (let id = 1; id <= 40; id++) {
      proof.observePhase({ phase: 'reservation', event: 'entered', callId: id });
      proof.observePhase({ phase: 'reservation', event: 'fulfilled', callId: id });
    }
    const command = createWorkspaceDeletionCommand({ userDataRoot: f.root, registry: f.registry,
      async assertWritersAbsent() { f.authority.assertCurrent(); }, observeTerminalPhase: proof.observePhase });
    const receipt = vi.fn();
    const result = await f.track(command.resumeSelected(f.journal, { ...f.authority, recordRemoved: receipt }));
    expect(result.status).toBe('completed'); expect(receipt).toHaveBeenCalledTimes(1);
    const raw = proof.readPhaseObservation()!;
    expect(raw).toBeDefined(); expect(raw.schemaVersion).toBe(2);
    const snapshot = raw.snapshot;
    expect(snapshot.events).toHaveLength(64); expect(snapshot.omissions.eventLimit).toBe(true);
    expect(snapshot.omissions.invalidSignal).toBe(false); expect(snapshot.active).toEqual([]);
    for (const phase of ['finalization', 'inventoryRetirement', 'terminalJournalClear', 'postClearVerification'] as const) {
      expect(snapshot.phases[phase]).toEqual({ entered: 1, fulfilled: 1, rejected: 0 });
      expect(snapshot.events.some(event => event.phase === phase)).toBe(false);
    }
    expect((await f.store.inspect(f.authority.assertCurrent)).plan.mode).toBe('absent');
    await f.preserved();
  } finally { proof.close(); }
});

it.for(['fulfilled', 'rejected'] as const)('observes the actual main producer without replacing its promise: %s', async mode => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  const proof = createWorkspaceDeletionExecutionProof({ ...f.input, observationRuntimeInstanceId: phaseRuntime });
  const first = new Error('SYNTHETIC_SOURCE_ORIGINAL'), observe = createWorkspaceDeletionPhaseProducer(proof.observePhase);
  const original = mode === 'fulfilled' ? Promise.resolve('SYNTHETIC_VALUE') : Promise.reject(first);
  let calls = 0;
  try {
    const returned = observe('preparation', () => { calls++; return original; });
    expect(returned).toBe(original);
    if (mode === 'fulfilled') expect(await returned).toBe('SYNTHETIC_VALUE');
    else await expect(returned).rejects.toBe(first);
    expect(calls).toBe(1);
    expect(proof.readPhaseObservation()!.snapshot.phases.preparation).toEqual({ entered: 1,
      fulfilled: mode === 'fulfilled' ? 1 : 0, rejected: mode === 'rejected' ? 1 : 0 });
    expect(proof.readPhaseObservation()!.snapshot.omissions.missingCoverage).toBe(true);
    expect(proof.readFailures().execution).toBeUndefined();
  } finally { proof.close(); }
});

it('keeps the unobserved proof path free of a recorder and read payload', async () => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  f.proof.observePhase({ phase: 'preparation', event: 'entered', callId: 1 }); f.proof.markPhaseShutdown();
  expect(f.proof.readPhaseObservation()).toBeUndefined();
});

it('records only runtime-bound data and leaves command state and failures independent', async () => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  const input = { ...f.input, observationRuntimeInstanceId: String(phaseRuntime) };
  const proof = createWorkspaceDeletionExecutionProof(input);
  try {
    input.observationRuntimeInstanceId = '44444444-4444-4444-8444-444444444444';
    const before = proof.snapshot();
    proof.observePhase({ phase: 'preparation', event: 'entered', callId: 1 });
    proof.observePhase({ phase: 'journalPublication', event: 'entered', callId: 2 });
    proof.observeSlotIo({ operation: 'fileWrite', scope: 'ioAttempt', event: 'entered', callId: 1 });
    proof.observeSlotIo({ operation: 'fileWrite', scope: 'ioAttempt', event: 'rejected', callId: 1 });
    proof.observePhase({ phase: 'journalPublication', event: 'rejected', callId: 2 });
    proof.observePhase({ phase: 'preparation', event: 'rejected', callId: 1 });
    proof.markPhaseShutdown(); proof.markPhaseShutdown();
    const raw = proof.readPhaseObservation()!;
    expect(Object.keys(raw).sort()).toEqual(['availability', 'invocation', 'runtimeInstanceId', 'schemaVersion', 'snapshot']);
    expect(raw.schemaVersion).toBe(2);
    expect(raw.runtimeInstanceId).toBe(phaseRuntime);
    for (const phase of ['preparation', 'journalPublication', 'slotIo'] as const)
      expect(raw.snapshot.phases[phase]).toEqual({ entered: 1, fulfilled: 0, rejected: 1 });
    expect(raw.snapshot.shutdownSequence).toBe(7);
    expect(raw.snapshot.state).toBe('partial'); expect(raw.snapshot.omissions.missingCoverage).toBe(true);
    expect(raw.snapshot.coverage).toEqual(WORKSPACE_DELETION_MAIN_PHASE_COVERAGE);
    expect(proof.snapshot()).toEqual(before); expect(proof.readFailures()).toEqual({ execution: undefined, executionRelated: [] });
    const expected = { selection: { runtimeInstanceId: phaseRuntime, scenarioId: 'DESK-DELETE-RECOVERY-001' as const,
      testAttempt: 1, repeatEachIndex: 2 }, delivery: { binding: { kind: 'local' as const },
      relativePath: 'run-33333333-3333-4333-8333-333333333333/synthetic/failure.private.json' } };
    expect(bindPhaseHandoffCapture(raw, expected)?.availability).toBe('captured');
    expect(bindPhaseHandoffCapture(raw, { ...expected, selection: { ...expected.selection,
      runtimeInstanceId: '44444444-4444-4444-8444-444444444444' } })).toBeUndefined();
  } finally { proof.close(); }
});

it.for(['invalidData', 'repeatAttempt'] as const)('records %s without changing the actual proof outcome', async kind => {
  const f = await fixture(workspaceDeletionRecoveryProofScenarioId);
  const proof = createWorkspaceDeletionExecutionProof({ ...f.input, observationRuntimeInstanceId: phaseRuntime });
  let reads = 0;
  try {
    if (kind === 'invalidData') {
      proof.observePhase({ get phase() { reads++; throw new Error('SYNTHETIC_ACCESSOR'); } } as never);
      expect(reads).toBe(0);
    } else {
      proof.observePhase({ phase: 'preparation', event: 'entered', callId: 1 });
      proof.observePhase({ phase: 'preparation', event: 'fulfilled', callId: 1 });
      proof.observePhase({ phase: 'preparation', event: 'entered', callId: 2 });
    }
    const snapshot = proof.readPhaseObservation()!.snapshot;
    expect(snapshot.invocationState).toBe(kind === 'invalidData' ? 'notStarted' : 'ambiguous');
    expect(snapshot.preparationAttempts).toBe(kind === 'invalidData' ? 0 : 2);
    expect(snapshot.omissions.invalidSignal).toBe(kind === 'invalidData');
    expect(snapshot.omissions.ambiguousInvocation).toBe(kind === 'repeatAttempt');
    expect(proof.readFailures().execution).toBeUndefined();
  } finally { proof.close(); }
});

it('rejects phase observation outside the single approved recovery scenario', async () => {
  const f = await fixture(workspaceDeletionPublicProofScenarioId);
  expect(() => createWorkspaceDeletionExecutionProof({ ...f.input, observationRuntimeInstanceId: phaseRuntime })).toThrow('INVALID_PHASE_RUNTIME');
});

async function fixture(scenarioId = 'DESK-DELETE-LAST-001', recoveryStatus = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-deletion-execution-'));
  let current = true;
  const input = { scenarioId, userDataRoot: root, sessionSecret: 's'.repeat(43),
    assertMainCurrent() { if (!current) throw new Error('SYNTHETIC_MAIN_REVOKED'); }, backendIsRunning: () => false };
  const proof = createWorkspaceDeletionExecutionProof(input);
  const unused = async (): Promise<never> => { throw new Error('UNEXPECTED_FIXTURE_OPERATION'); };
  const prepare = vi.fn(unused);
  const execute = vi.fn<WorkspaceManagementService['deleteWorkspace']>(async () => completed);
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>();
  const complete = vi.fn(async () => {});
  const service = { createEmpty: unused, getStatus: unused, getRecoveryManagementStatus: unused, importBackupAsNew: unused, rename: unused,
    replaceActiveFromBackup: unused, switchTo: unused, prepareDeletion: prepare, deleteWorkspace: execute };
  const options: Parameters<typeof proof.createCapability>[0] = {
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler as never); }, removeHandler(channel) { handlers.delete(channel); } },
    mainWindow: mainWindow as never,
    passwordWindow: { requestPassword: unused }, confirmActiveWorkspaceReplacement: unused,
    selectBackupSource: unused, selectReplacementBackupSource: unused, showSafeError() {}, service,
    ...(recoveryStatus ? { statusMode: 'recoveryManagement' as const,
      captureStatusPublication: () => ({ assertCurrent() {} }) } : {}),
    ...(recoveryStatus || scenarioId === workspaceDeletionPublicProofScenarioId ? {
      deletionRuntime: { complete, readNextAction: () => 'restartRequired' as const,
        projectFailure: () => ({ formatVersion: 1 as const, status: 'recoveryRequired' as const,
          errorCode: 'WORKSPACE_DELETE_FAILED' as const, sideEffectState: 'unknown' as const, nextAction: 'restartRequired' as const }) } } : {}),
  };
  const f = { root, input, proof, options, execute, prepare, handlers, complete,
    capability: undefined as WorkspaceManagementCapability | undefined,
    revokeMain() { current = false; }, install() { f.capability = proof.createCapability(options); } };
  fixtures.push(f); return f;
}
