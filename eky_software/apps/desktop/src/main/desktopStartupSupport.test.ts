import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { expect, it, vi, type TestContext } from 'vitest';

import type { DesktopLifecycleHandle, StartDesktopCompositionOptions, DesktopWorkspaceStartupSupportReceipt } from './desktopComposition.js';
import { createRecoveryObservationExperiment } from './desktopRecoveryStartupExperimentTestSupport.js';
import { selectDesktopWorkspaceRecoveryChoice } from './desktopWorkspaceRecoveryChoice.js';
import type { runSafeDesktopStartup } from './earlyStartup.js';
import { readPackagedSmokeResult } from './packagedSmoke.js';
import { parseW6b2PackagedProofResult, W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
  W6B2_PACKAGED_PROOF_MARKER_FILE, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH,
  W6B2_PACKAGED_PROOF_SWITCH } from './w6b2PackagedProof.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import { readSupportBundleDesktopData } from '../supportBundle/supportBundleDesktopData.js';
import { writeSupportBundleAtomically } from '../supportBundle/supportBundleFileStore.js';

type StartupOptions = Parameters<typeof runSafeDesktopStartup>[0];

it.for(['unavailable', 'available'] as const)('index exports the supplied %s receipt without a window', async (status, context) => {
  const f = await fixture(context, { status });
  await f.finished();
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(f.runtimeDesktopDataRead).toHaveBeenCalled();
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  expect(f.showSaveDialog).toHaveBeenCalledOnce();
  expect(f.showErrorBox).not.toHaveBeenCalled();
  const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
  const inspected = inspector.inspectSupportBundle(f.targetPath);
  expect(inspected.summary).toMatchObject({ formatVersion: 3, kind: 'desktopOnly', observationStatus: status,
    backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' });
  expect(inspected.document.observation).toEqual(f.receipt().observation);
  expect(inspected.document.system).toMatchObject({ appVersion: '0.3.0', buildRevision: 'development', electronVersion: '43.8.1' });
  expect(JSON.stringify(inspected.document)).not.toContain(f.root);
  expect((await readFile(f.targetPath)).length).toBeGreaterThan(0);
  expect(f.logger.write.mock.calls.map(([event]) => event.eventName)).toEqual([
    'supportBundle.creationStarted', 'supportBundle.creationCompleted',
  ]);
});

it('index consumes the real admitted composition failure without a window', async context => {
  const f = await fixture(context, { actualCompositionFailure: true });
  await f.finished();
  expect(f.realWorkspaceFailure).toHaveBeenCalledOnce();
  expect(f.receiptDelivery).toHaveBeenCalledOnce();
  expect(f.runtimeDesktopDataRead).toHaveBeenCalled();
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(f.showMessageBox).toHaveBeenCalledOnce(); expect(f.showSaveDialog).toHaveBeenCalledOnce();
  expect(f.showErrorBox).not.toHaveBeenCalled();
  const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
  const inspected = inspector.inspectSupportBundle(f.targetPath);
  expect(inspected.summary).toMatchObject({ formatVersion: 3, kind: 'desktopOnly', observationStatus: 'unavailable',
    backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' });
  expect(inspected.document.observation).toEqual(f.receipt().observation);
  expect(f.receipt().operationalIdentity).toEqual({ appVersion: '0.3.0', buildRevision: 'development',
    runtimeInstanceId: f.compositionOptions().runtimeInstanceId });
  const document = JSON.stringify(inspected.document);
  for (const excluded of [f.root, 'SYNTHETIC_REAL_WORKSPACE_STARTUP_ORIGINAL']) expect(document).not.toContain(excluded);
  // No workspace, backend or window was created. The real reservation was closed.
  expect(existsSync(join(f.app.getPath('userData'), 'workspaces'))).toBe(false);
  await f.proveReservationReleased();
});

it.for(['confirmation', 'save'] as const)('index consumes cancellation at %s without a file', async (cancelledAt, context) => {
  const f = await fixture(context, { cancelledAt });
  await f.finished();
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  expect(f.showSaveDialog).toHaveBeenCalledTimes(cancelledAt === 'confirmation' ? 0 : 1);
  expect(existsSync(f.targetPath)).toBe(false);
  await f.startupOptions().onFailure('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(f.showMessageBox).toHaveBeenCalledOnce();
  expect(f.showErrorBox).not.toHaveBeenCalled();
});

it.for(['confirmation', 'save'] as const)('index rejects a late %s result after quit without waiting for itself', async (heldAt, context) => {
  const gate = deferred();
  const f = await fixture(context, { heldAt, gate });
  try {
    expect(await Promise.race([gate.entered.then(() => 'held'), f.finished().then(() => 'settled')])).toBe('held');
    context.signal.throwIfAborted();
    const preventDefault = vi.fn();
    f.app.emit('before-quit', { preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(f.exit).not.toHaveBeenCalled();
    gate.release();
    await f.finished();
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.showErrorBox).not.toHaveBeenCalled();
    expect(existsSync(f.targetPath)).toBe(false);
    expect(f.logger.write.mock.calls.some(([event]) => event.eventName === 'supportBundle.creationCompleted')).toBe(false);
  } finally { gate.release(); await f.finished(); }
});

it('index rejects owner loss even when the instance flag later returns', async context => {
  const gate = deferred();
  const f = await fixture(context, { heldAt: 'confirmation', gate });
  try {
    expect(await Promise.race([gate.entered.then(() => 'held'), f.finished().then(() => 'settled')])).toBe('held');
    f.state.current = false;
    gate.release();
    await f.finished();
    f.state.current = true;
    await f.startupOptions().onFailure('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(f.showMessageBox).toHaveBeenCalledOnce();
    expect(f.showSaveDialog).not.toHaveBeenCalled();
    expect(f.showErrorBox).not.toHaveBeenCalled();
    expect(existsSync(f.targetPath)).toBe(false);
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
  } finally { gate.release(); await f.finished(); }
});

it.for(['missing', 'runtime', 'build', 'eventRuntime', 'rawObservation'] as const)('index does not grant export for a %s receipt', async (invalid, context) => {
  const f = await fixture(context, { invalid });
  await f.finished();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(existsSync(f.targetPath)).toBe(false);
  expect(f.showErrorBox).toHaveBeenCalledExactlyOnceWith('Eky ei käynnistynyt',
    'Paikallista sovellusta ei voitu käynnistää turvallisesti.');
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
});

it.for([false, true])('index does not borrow a receipt after startup succeeds (earlier receipt: %s)', async (earlierReceipt, context) => {
  const f = await fixture(context, { successfulStartup: true, ...(earlierReceipt ? {} : { invalid: 'missing' as const }) });
  await f.finished();
  f.compositionOptions().observeWorkspaceStartupFailure!(f.receipt());
  await f.startupOptions().onFailure('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  expect(f.showMessageBox).not.toHaveBeenCalled();
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(f.showErrorBox).toHaveBeenCalledOnce();
  expect(f.exit).not.toHaveBeenCalled();
});

it('index closes reporting before a relaunch requested by the failed owner', async context => {
  const f = await fixture(context, { relaunch: true });
  await f.finished();
  expect(f.app.relaunch).toHaveBeenCalledOnce();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(f.showErrorBox).not.toHaveBeenCalled();
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
});

it('index preserves the existing restore-recovery dialog instead of using support as fallback', async context => {
  const f = await fixture(context, { startupErrorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cancelledAt: 'confirmation' });
  await f.finished();
  expect(f.showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    buttons: ['Sulje', 'Avaa lokikansio'], title: 'Palautus vaatii tarkistuksen',
  }));
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(f.showErrorBox).not.toHaveBeenCalled();
  expect(f.logger.write).not.toHaveBeenCalled();
  expect(existsSync(f.targetPath)).toBe(false);
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
});

it.for(['smoke', 'proof'] as const)('index preserves %s failure output without granting native support', async (excludedMode, context) => {
  const f = await fixture(context, { excludedMode, status: 'available' });
  await f.finished();
  const composition = f.compositionOptions();
  expect(composition).toBeDefined();
  expect(f.receiptDelivery).toHaveBeenCalledExactlyOnceWith(composition.observeWorkspaceStartupFailure, f.receipt());
  expect(f.runtimeDesktopDataRead).not.toHaveBeenCalled();
  expect(f.receipt().operationalIdentity).toEqual({ appVersion: composition.appVersion,
    buildRevision: composition.buildInfo.buildRevision, runtimeInstanceId: composition.runtimeInstanceId });
  const validatedReceiptData = readSupportBundleDesktopData({
    system: { appVersion: composition.appVersion, buildRevision: composition.buildInfo.buildRevision,
      architecture: process.arch, platform: process.platform, electronVersion: process.versions.electron },
    availability: { backend: f.receipt().backendState, database: 'notInspected',
      diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
    observation: f.receipt().observation,
  });
  expect(validatedReceiptData.observation).toMatchObject({ status: 'available',
    firstError: { runtimeInstanceId: composition.runtimeInstanceId } });
  const result: unknown = JSON.parse(await readFile(f.excludedResultPath()!, 'utf8'));
  if (excludedMode === 'smoke') {
    expect(composition.smokeConfiguration.enabled).toBe(true);
    expect(composition.w6b2PackagedProof).toBeUndefined();
    expect(result).toEqual({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', stage: 'startup', status: 'failed' });
    expect(readPackagedSmokeResult(result)).toEqual(result);
  } else {
    expect(composition.smokeConfiguration.enabled).toBe(false);
    expect(composition.w6b2PackagedProof?.configuration).toMatchObject({
      enabled: true, controlFormatVersion: 1, phase: 'sourceHandoff', role: 'source',
    });
    expect(result).toEqual({ errorCode: 'W6B2_PROOF_UNEXPECTED', formatVersion: 1,
      phase: 'sourceHandoff', status: 'failed' });
    expect(parseW6b2PackagedProofResult(result)).toEqual(result);
  }
  expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(f.nativeExportCreation).not.toHaveBeenCalled();
  expect(f.supportDataLoad).not.toHaveBeenCalled();
  expect(f.supportWrite).not.toHaveBeenCalled();
  expect(f.showMessageBox).not.toHaveBeenCalled();
  expect(f.showSaveDialog).not.toHaveBeenCalled();
  expect(f.showErrorBox).not.toHaveBeenCalled();
  expect(f.logger.write).not.toHaveBeenCalled();
  expect(existsSync(f.targetPath)).toBe(false);
});

it.for([0, 1, 2])('index joins the native choice before quit and rejects late response %s, including synchronous abort reentry', async (response, context) => {
  const gate = deferred(), observation = createRecoveryObservationExperiment();
  const acceptChoice = vi.fn();
  const showMessageBox = vi.fn(async (_options: unknown) => { await gate.wait(); return { response }; });
  // This index contract controls the dialog and source boundary, not native ownership.
  const ownership = { assertCurrent: observation.assertCurrent,
    async assertOwned() { observation.assertCurrent(); } };
  const readSelected = vi.fn(async (authority: typeof ownership) => {
    authority.assertCurrent(); await authority.assertOwned(); authority.assertCurrent();
  });
  const f = await fixture(context, { gate, invalid: 'missing', async recoveryWork(input) {
    input.recoveryStartup!.registerObservation(observation);
    try {
      const choice = await observation.run(() => selectDesktopWorkspaceRecoveryChoice({
        selection: { target: { workspaceLabel: 'Synthetic interrupted recovery' },
          assertCurrent: observation.assertCurrent, readSelected },
        ownership, signal: observation.signal, showMessageBox,
      }));
      acceptChoice(choice);
    }
    catch (error) { if (error !== observation.signal.reason) throw error; }
    finally { observation.closeAdmission(); await observation.waitForSettlement(); }
    return undefined;
  } });
  try {
    expect(await Promise.race([gate.entered.then(() => 'held'), f.finished().then(() => 'settled')])).toBe('held');
    context.signal.throwIfAborted();
    expect(showMessageBox).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      buttons: ['Jatka palautumista', 'Rajattu hallinta', 'Sulje'],
      defaultId: 0, cancelId: 2, noLink: true, signal: observation.signal,
    }));
    expect(readSelected).toHaveBeenCalledOnce();
    const repeated = { preventDefault: vi.fn() };
    observation.signal.addEventListener('abort', () => f.app.emit('before-quit', repeated), { once: true });
    const event = { preventDefault: vi.fn() };
    f.app.emit('before-quit', event);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(repeated.preventDefault).toHaveBeenCalledOnce();
    await nextTurn();
    expect(f.app.quit).not.toHaveBeenCalled(); expect(f.exit).not.toHaveBeenCalled();
    expect(observation.signal.aborted).toBe(true);
    expect(acceptChoice).not.toHaveBeenCalled();
    gate.release(); await f.finished(); await nextTurn();
    expect(f.app.quit).toHaveBeenCalledOnce(); expect(f.exit).not.toHaveBeenCalled();
    expect(acceptChoice).not.toHaveBeenCalled(); expect(readSelected).toHaveBeenCalledOnce();
    expect(showMessageBox).toHaveBeenCalledOnce(); expect(f.app.relaunch).not.toHaveBeenCalled();
    expect(f.showErrorBox).not.toHaveBeenCalled(); expect(f.showMessageBox).not.toHaveBeenCalled();
    expect(f.showSaveDialog).not.toHaveBeenCalled();
  } finally { gate.release(); await f.finished(); }
});

it('index drains a late lifecycle instead of publishing or focusing it after quit', async context => {
  const construction = deferred(), stopping = deferred();
  const lifecycle = syntheticLifecycle(() => stopping.wait());
  const f = await fixture(context, { gate: construction, invalid: 'missing', async recoveryWork(input) {
    input.recoveryStartup!.registerObservation({ closeAdmission() {}, waitForSettlement: async () => undefined });
    await construction.wait(); return lifecycle;
  } });
  try {
    await construction.entered;
    f.app.emit('before-quit', { preventDefault: vi.fn() });
    construction.release(); await stopping.entered;
    expect(lifecycle.shutdown).toHaveBeenCalledOnce(); expect(f.app.quit).not.toHaveBeenCalled();
    f.app.emit('activate'); f.app.emit('second-instance');
    expect(lifecycle.focusApplicationWindow).not.toHaveBeenCalled();
    stopping.release(); await f.finished(); await nextTurn();
    expect(f.app.quit).toHaveBeenCalledOnce(); expect(f.exit).not.toHaveBeenCalled();
  } finally { construction.release(); stopping.release(); await f.finished(); }
});

it('index preserves the first startup error and joins local failure before presentation and direct exit', async context => {
  const gate = deferred();
  const original = new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', { cause: new Error('SYNTHETIC_FIRST_STARTUP_CAUSE') });
  const cleanup = new Error('SYNTHETIC_STARTUP_CLOSE_CAUSE');
  const f = await fixture(context, { gate, invalid: 'missing', async recoveryWork(input) {
    const observation = createRecoveryObservationExperiment();
    input.recoveryStartup!.registerObservation(observation);
    void observation.run(async () => { await gate.wait(); throw cleanup; }).catch(() => undefined);
    throw original;
  } });
  try {
    await gate.entered;
    expect(f.showErrorBox).not.toHaveBeenCalled(); expect(f.exit).not.toHaveBeenCalled();
    gate.release(); await f.finished();
    expect(f.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(f.firstFailure()?.error).toMatchObject({ message: original.message,
      cause: { errors: [original, { errors: [cleanup] }] } });
    expect(JSON.stringify(f.showErrorBox.mock.calls)).not.toMatch(/SYNTHETIC_FIRST_STARTUP_CAUSE|SYNTHETIC_STARTUP_CLOSE_CAUSE/);
  } finally { gate.release(); await f.finished(); }
});

it('index rejects a relaunch dispatched after external quit', async context => {
  const gate = deferred();
  const f = await fixture(context, { gate, invalid: 'missing', async recoveryWork(input) {
    input.recoveryStartup!.registerObservation({ closeAdmission() {}, waitForSettlement: async () => undefined });
    await gate.wait(); input.relaunchApplication(); return undefined;
  } });
  try {
    await gate.entered; f.app.emit('before-quit', { preventDefault: vi.fn() });
    gate.release(); await f.finished(); await nextTurn();
    expect(f.app.relaunch).not.toHaveBeenCalled(); expect(f.app.quit).toHaveBeenCalledOnce();
  } finally { gate.release(); await f.finished(); }
});

it('index permits a legitimate relaunch without confusing reporting invalidation with external stop', async context => {
  const f = await fixture(context, { invalid: 'missing', async recoveryWork(input) {
    input.recoveryStartup!.registerObservation({ closeAdmission() {}, waitForSettlement: async () => undefined });
    input.relaunchApplication(); return undefined;
  } });
  await f.finished(); await nextTurn();
  expect(f.app.relaunch).toHaveBeenCalledOnce(); expect(f.exit).not.toHaveBeenCalled();
});

it('index preserves the closing latch and single owner after a successful lifecycle handoff', async context => {
  const lifecycle = syntheticLifecycle(async () => undefined);
  const f = await fixture(context, { invalid: 'missing', async recoveryWork(input) {
    input.recoveryStartup!.registerObservation({ closeAdmission() {}, waitForSettlement: async () => undefined });
    return lifecycle;
  } });
  await f.finished();
  f.app.emit('activate'); expect(lifecycle.focusApplicationWindow).toHaveBeenCalledOnce();
  f.app.emit('before-quit', { preventDefault: vi.fn() }); await nextTurn();
  f.app.emit('activate'); f.app.emit('second-instance');
  expect(lifecycle.focusApplicationWindow).toHaveBeenCalledOnce();
  expect(lifecycle.shutdown).toHaveBeenCalledOnce(); expect(f.app.quit).toHaveBeenCalledOnce();
});

function syntheticLifecycle(shutdown: () => Promise<void>) {
  return { applicationWindow: {} as DesktopLifecycleHandle['applicationWindow'],
    focusApplicationWindow: vi.fn(), shutdown: vi.fn(shutdown),
    isInstallerHandoffPending: () => false, deferQuitForInstallerHandoff: () => false };
}

it('index does not latch recovery closure when installer handoff defers quit', async context => {
  let installerPending = true;
  const lifecycle = { ...syntheticLifecycle(async () => undefined),
    isInstallerHandoffPending: () => installerPending, deferQuitForInstallerHandoff: () => installerPending };
  const f = await fixture(context, { invalid: 'missing', async recoveryWork(input) {
    input.recoveryStartup!.registerObservation({ closeAdmission() {}, waitForSettlement: async () => undefined });
    return lifecycle;
  } });
  await f.finished();
  const event = { preventDefault: vi.fn() };
  f.app.emit('before-quit', event);
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(lifecycle.shutdown).not.toHaveBeenCalled();
  expect(f.compositionOptions().recoveryStartup!.isClosing()).toBe(false);
  f.app.emit('activate'); expect(lifecycle.focusApplicationWindow).toHaveBeenCalledOnce();
  installerPending = false;
  f.app.emit('before-quit', { preventDefault: vi.fn() }); await nextTurn();
  expect(f.compositionOptions().recoveryStartup!.isClosing()).toBe(true);
  expect(lifecycle.shutdown).toHaveBeenCalledOnce();
});

async function fixture(context: TestContext, options: {
  status?: 'unavailable' | 'available';
  invalid?: 'missing' | 'runtime' | 'build' | 'eventRuntime' | 'rawObservation';
  cancelledAt?: 'confirmation' | 'save';
  heldAt?: 'confirmation' | 'save';
  gate?: ReturnType<typeof deferred>;
  successfulStartup?: boolean;
  relaunch?: boolean;
  startupErrorCode?: string;
  excludedMode?: 'smoke' | 'proof';
  actualCompositionFailure?: boolean;
  recoveryWork?(input: StartDesktopCompositionOptions): Promise<DesktopLifecycleHandle | undefined>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-startup-support-'));
  const paths: Record<string, string> = { userData: join(root, 'user-data'), appData: root, temp: root };
  const targetPath = join(root, 'support.json.gz');
  const descriptor = Object.getOwnPropertyDescriptor(process, 'versions')!;
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'versions', { configurable: true,
    value: { ...process.versions, electron: '43.8.1' } });
  if (options.actualCompositionFailure) Object.defineProperty(process, 'resourcesPath', {
    configurable: true, value: join(root, 'resources'),
  });
  let startupWork: Promise<void> | undefined;
  let reservationProofWork: Promise<void> | undefined;
  let fixtureClosing = false;
  let startupInput: StartupOptions | undefined;
  let compositionInput: StartDesktopCompositionOptions | undefined;
  let originalReceipt: Readonly<DesktopWorkspaceStartupSupportReceipt> | undefined;
  let firstStartupFailure: { error: unknown; phase: 'earlyStartup' | 'compositionStartup' } | undefined;
  let firstSupportFailure: { error: unknown } | undefined;
  let excludedResultPath: string | undefined;
  context.onTestFailed(async () => {
    const observed = firstSupportFailure ?? firstStartupFailure;
    if (observed === undefined) return;
    try {
      const { createRunnerFailureSink } = await import('../../../../test-reporters/runnerFailureEvidence.mjs');
      const sink = createRunnerFailureSink();
      const task = context.task;
      const retryCount = task.result?.retryCount ?? 0, repeatCount = task.result?.repeatCount ?? 0;
      sink.record({ runner: 'vitest', phase: firstSupportFailure === undefined ? firstStartupFailure!.phase : 'supportBundleNativeCreationCatch',
        error: observed.error, testName: task.fullTestName, testId: task.id, file: task.file.filepath,
        ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
        ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
      await sink.flush();
    } catch { /* Evidence cannot replace the test result. */ }
  });
  const state = { current: true };
  const exit = vi.fn();
  const logger = { write: vi.fn<(event: ReturnType<typeof createDesktopOperationalEvent>) => void>() };
  const nativeExportCreation = vi.fn();
  const supportDataLoad = vi.fn();
  const supportWrite = vi.fn(writeSupportBundleAtomically);
  const runtimeDesktopDataRead = vi.fn(readSupportBundleDesktopData);
  const receiptDelivery = vi.fn((observe: NonNullable<StartDesktopCompositionOptions['observeWorkspaceStartupFailure']>,
    receipt: Readonly<DesktopWorkspaceStartupSupportReceipt>) => observe(receipt));
  const realWorkspaceFailure = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_REAL_WORKSPACE_STARTUP_ORIGINAL'); });
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, commandLine: { hasSwitch: (name: string) =>
      (options.excludedMode === 'smoke' && name === 'desktop-smoke') ||
      (options.excludedMode === 'proof' && name === W6B2_PACKAGED_PROOF_SWITCH) },
    getAppPath: () => join(root, 'app'), getVersion: () => options.excludedMode === 'proof' ? '0.2.7' : '0.3.0',
    getPath: (name: string) => paths[name] ?? root,
    setPath(name: string, value: string) { paths[name] = value; },
    requestSingleInstanceLock: () => true, hasSingleInstanceLock: () => state.current,
    whenReady: async () => undefined, exit, relaunch: vi.fn(),
    quit: vi.fn(() => { app.emit('before-quit', { preventDefault: vi.fn() }); }),
  });
  const showMessageBox = vi.fn(async () => {
    if (options.heldAt === 'confirmation') await options.gate!.wait();
    return { response: options.cancelledAt === 'confirmation' ? 0 : 1, checkboxChecked: false };
  });
  const showSaveDialog = vi.fn(async () => {
    if (options.heldAt === 'save') await options.gate!.wait();
    return { canceled: options.cancelledAt === 'save', filePath: targetPath };
  });
  const showErrorBox = vi.fn();
  const release = () => options.gate?.release();
  context.signal.addEventListener('abort', release, { once: true });
  context.onTestFinished(async ({ task }) => {
    fixtureClosing = true;
    release();
    const settled = await Promise.allSettled([startupWork, reservationProofWork]);
    try {
      const failures = settled.filter(result => result.status === 'rejected');
      if (failures.length !== 0) throw new AggregateError(failures.map(result => result.reason), 'STARTUP_SUPPORT_FIXTURE_WORK_FAILED');
    }
    finally {
      context.signal.removeEventListener('abort', release);
      Object.defineProperty(process, 'versions', descriptor);
      if (options.actualCompositionFailure) {
        if (resourcesDescriptor === undefined) Reflect.deleteProperty(process, 'resourcesPath');
        else Object.defineProperty(process, 'resourcesPath', resourcesDescriptor);
      }
      vi.doUnmock('electron'); vi.doUnmock('./earlyStartup.js'); vi.doUnmock('./desktopComposition.js');
      vi.doUnmock('../supportBundle/supportBundleCapability.js');
      vi.doUnmock('../supportBundle/supportBundleDesktopData.js');
      vi.doUnmock('./packagedSmoke.js'); vi.doUnmock('./w6b2PackagedProof.js');
      vi.resetModules();
    }
    if (task.result?.state === 'pass' && !context.signal.aborted) await rm(root, { recursive: true, force: true });
  });
  vi.resetModules();
  // Unit boundary: synthetic tokens/resources use real parsers and result writers, not build admission.
  if (options.excludedMode === 'smoke') {
    vi.doMock('./packagedSmoke.js', async importOriginal => {
      const actual = await importOriginal<typeof import('./packagedSmoke.js')>();
      return { ...actual, createPackagedSmokeConfiguration(input: Parameters<typeof actual.createPackagedSmokeConfiguration>[0]) {
        const configuration = actual.createPackagedSmokeConfiguration({ ...input, tokenValue: 'a'.repeat(32) });
        excludedResultPath = join(configuration.root!, 'result', 'desktop-smoke-result.json');
        return configuration;
      } };
    });
  } else if (options.excludedMode === 'proof') {
    const token = 'a'.repeat(64);
    const proofRoot = join(root, W6B2_PACKAGED_PROOF_DIRECTORY_NAME, token.slice(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH));
    const resourcesPath = join(root, 'resources');
    await mkdir(join(proofRoot, 'control'), { recursive: true });
    await mkdir(join(resourcesPath, 'backend'), { recursive: true });
    await writeFile(join(proofRoot, 'control', 'phase.json'), JSON.stringify({ formatVersion: 1, phase: 'sourceHandoff' }));
    await writeFile(join(resourcesPath, 'backend', W6B2_PACKAGED_PROOF_MARKER_FILE),
      JSON.stringify({ appVersion: app.getVersion(), formatVersion: 1, role: 'source' }));
    vi.doMock('./w6b2PackagedProof.js', async importOriginal => {
      const actual = await importOriginal<typeof import('./w6b2PackagedProof.js')>();
      return { ...actual,
        createW6b2PackagedProofBootstrapConfiguration(input: Parameters<typeof actual.createW6b2PackagedProofBootstrapConfiguration>[0]) {
          return actual.createW6b2PackagedProofBootstrapConfiguration({ ...input, tokenValue: token });
        },
        async readW6b2PackagedProofConfiguration(input: Parameters<typeof actual.readW6b2PackagedProofConfiguration>[0]) {
          const configuration = await actual.readW6b2PackagedProofConfiguration({ ...input, resourcesPath });
          excludedResultPath = configuration?.resultFilePath;
          return configuration;
        },
      };
    });
  }
  vi.doMock('electron', () => ({ app, dialog: { showMessageBox, showSaveDialog, showErrorBox },
    protocol: { registerSchemesAsPrivileged: vi.fn() }, shell: { openPath: vi.fn(async () => '') } }));
  vi.doMock('./earlyStartup.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./earlyStartup.js')>();
    return { ...actual, runSafeDesktopStartup(input: StartupOptions) {
      startupInput = input;
      startupWork = actual.runSafeDesktopStartup({ ...input, observeStartupException(error) {
        firstStartupFailure ??= { error, phase: 'earlyStartup' };
        input.observeStartupException?.(error);
      } });
      return startupWork;
    } };
  });
  vi.doMock('../supportBundle/supportBundleDesktopData.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../supportBundle/supportBundleDesktopData.js')>();
    runtimeDesktopDataRead.mockImplementation(actual.readSupportBundleDesktopData);
    return { ...actual, readSupportBundleDesktopData: runtimeDesktopDataRead };
  });
  vi.doMock('../supportBundle/supportBundleCapability.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../supportBundle/supportBundleCapability.js')>();
    return { ...actual, createDesktopOnlySupportBundleExport(input: Parameters<typeof actual.createDesktopOnlySupportBundleExport>[0]) {
      nativeExportCreation();
      return actual.createDesktopOnlySupportBundleExport({ ...input, writeArchive: supportWrite,
        loadDesktopData() { supportDataLoad(); return input.loadDesktopData(); }, observeFailure(error) {
        firstSupportFailure ??= { error };
        input.observeFailure?.(error);
      } });
    } };
  });
  vi.doMock('./desktopComposition.js', async importOriginal => {
    if (options.actualCompositionFailure) {
      const actual = await importOriginal<typeof import('./desktopComposition.js')>();
      return { ...actual, async startDesktopComposition(input: StartDesktopCompositionOptions) {
        compositionInput = input;
        return actual.startDesktopComposition({ ...input,
          dependencies: { ...input.dependencies, resolveActiveWorkspace: realWorkspaceFailure },
          observeStartupException(error, phase, excluded) {
            firstStartupFailure ??= { error, phase: 'compositionStartup' };
            input.observeStartupException?.(error, phase, excluded);
          },
          observeWorkspaceStartupFailure(receipt) {
            originalReceipt = receipt;
            if (input.observeWorkspaceStartupFailure !== undefined) receiptDelivery(input.observeWorkspaceStartupFailure, receipt);
          },
        });
      } };
    }
    // Controlled receipt cases exercise only index consumption, not build admission.
    return { async startDesktopComposition(input: StartDesktopCompositionOptions) {
    compositionInput = input;
    if (options.recoveryWork !== undefined) return options.recoveryWork(input);
    await mkdir(join(app.getPath('userData'), 'runtime'), { recursive: true, mode: 0o700 });
    const operationalIdentity = { appVersion: input.appVersion, buildRevision: input.buildInfo.buildRevision,
      runtimeInstanceId: input.runtimeInstanceId };
    const failure = createDesktopOperationalEvent({ eventName: 'workspaceManagement.operationFailed',
      correlationId: '11111111-1111-4111-8111-111111111111', durationMs: 1,
      errorCode: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED', retryable: false, sideEffectState: 'unknown',
      stage: 'operation', operationId: 'workspace.import' } as const, operationalIdentity);
    originalReceipt = Object.freeze({ operationalIdentity: Object.freeze(operationalIdentity), operationalLogger: logger,
      backendState: 'exitUnconfirmed', observation: options.status === 'available'
        ? Object.freeze({ scope: 'currentOperation', status: 'available', firstError: failure, cleanupError: null })
        : Object.freeze({ scope: 'currentOperation', status: 'unavailable' }) });
    if (options.invalid !== 'missing') {
      const receipt = options.invalid === 'runtime' || options.invalid === 'build'
        ? { ...originalReceipt, operationalIdentity: { ...operationalIdentity,
            ...(options.invalid === 'runtime' ? { runtimeInstanceId: '22222222-2222-4222-8222-222222222222' }
              : { buildRevision: 'a'.repeat(40) }) } }
        : options.invalid === 'eventRuntime' ? { ...originalReceipt, observation: {
            scope: 'currentOperation', status: 'available', cleanupError: null,
            firstError: { ...failure, runtimeInstanceId: '22222222-2222-4222-8222-222222222222' },
          } }
        : options.invalid === 'rawObservation' ? { ...originalReceipt, observation: { error: new Error('SYNTHETIC_PRIVATE_ERROR') } }
        : originalReceipt;
      if (input.observeWorkspaceStartupFailure !== undefined) {
        receiptDelivery(input.observeWorkspaceStartupFailure, receipt as Readonly<DesktopWorkspaceStartupSupportReceipt>);
      }
    }
    if (options.relaunch) input.relaunchApplication();
    if (!options.successfulStartup) throw new Error(options.startupErrorCode ?? 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    } };
  });
  await import('./index.js');
  return { root, targetPath, app, state, exit, logger, showMessageBox, showSaveDialog, showErrorBox,
    nativeExportCreation, supportDataLoad, supportWrite, runtimeDesktopDataRead, receiptDelivery, realWorkspaceFailure,
    proveReservationReleased() {
      context.signal.throwIfAborted();
      if (fixtureClosing) throw new Error('STARTUP_SUPPORT_FIXTURE_CLOSED');
      return reservationProofWork ??= Promise.resolve().then(async () => {
        const { acquireWorkspaceProcessReservation } = await import('../runtime/workspaceProcessReservation.js');
        const reopened = await acquireWorkspaceProcessReservation({ userDataRoot: app.getPath('userData'), signal: context.signal });
        try { await reopened.assertOwned(); } finally { await reopened.release(); }
      });
    },
    excludedResultPath: () => excludedResultPath,
    finished: () => startupWork!, receipt: () => originalReceipt!, firstFailure: () => firstStartupFailure,
    startupOptions: () => startupInput!, compositionOptions: () => compositionInput! };
}

function deferred() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, wait() { enter(); return waiting; } };
}
