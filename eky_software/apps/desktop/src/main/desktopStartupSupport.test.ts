import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi, type TestContext } from 'vitest';

import type { StartDesktopCompositionOptions, DesktopWorkspaceStartupSupportReceipt } from './desktopComposition.js';
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
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-startup-support-'));
  const paths: Record<string, string> = { userData: join(root, 'user-data'), appData: root, temp: root };
  const targetPath = join(root, 'support.json.gz');
  const descriptor = Object.getOwnPropertyDescriptor(process, 'versions')!;
  Object.defineProperty(process, 'versions', { configurable: true,
    value: { ...process.versions, electron: '43.8.1' } });
  let startupWork: Promise<void> | undefined;
  let startupInput: StartupOptions | undefined;
  let compositionInput: StartDesktopCompositionOptions | undefined;
  let originalReceipt: Readonly<DesktopWorkspaceStartupSupportReceipt> | undefined;
  let firstStartupFailure: { error: unknown } | undefined;
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
      sink.record({ runner: 'vitest', phase: firstSupportFailure === undefined ? 'earlyStartup' : 'supportBundleNativeCreationCatch',
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
    release();
    try { await startupWork; }
    finally {
      context.signal.removeEventListener('abort', release);
      Object.defineProperty(process, 'versions', descriptor);
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
        firstStartupFailure ??= { error };
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
  // This fake producer exercises index consumption, not real composition/build admission.
  vi.doMock('./desktopComposition.js', () => ({ async startDesktopComposition(input: StartDesktopCompositionOptions) {
    compositionInput = input;
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
  } }));
  await import('./index.js');
  return { root, targetPath, app, state, exit, logger, showMessageBox, showSaveDialog, showErrorBox,
    nativeExportCreation, supportDataLoad, supportWrite, runtimeDesktopDataRead, receiptDelivery,
    excludedResultPath: () => excludedResultPath,
    finished: () => startupWork!, receipt: () => originalReceipt!,
    startupOptions: () => startupInput!, compositionOptions: () => compositionInput! };
}

function deferred() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, wait() { enter(); return waiting; } };
}
