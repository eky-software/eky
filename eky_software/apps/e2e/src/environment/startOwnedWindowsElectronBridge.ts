import { _electron as electron, type ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';

import { createElectronSpawnObservation, type ElectronSpawnObservationFailureCode } from './electronSpawnObservation.js';
import { assertElectronSpawnObservationVersions } from './electronSpawnObservationVersions.js';
import { prepareWindowsServiceConfiguration, type WindowsElectronServiceInput } from './windowsServiceConfiguration.js';
import { createWindowsOwnerSession, windowsServiceDependencies, type OwnedWindowsServiceDependencies,
  OwnedWindowsServiceStartupFailure, type OwnedWindowsServiceInput, type WindowsOwnerCleanupEvidence,
  type WindowsOwnerSession } from './startOwnedWindowsService.js';

export const electronBridgeEnvironmentKeys = Object.freeze({
  config: 'EKY_E2E_ELECTRON_BRIDGE_CONFIG',
  generation: 'EKY_E2E_ELECTRON_BRIDGE_GENERATION',
  nonce: 'EKY_E2E_ELECTRON_BRIDGE_NONCE',
  bootstrap: 'EKY_E2E_ELECTRON_BRIDGE_BOOTSTRAP',
});
const registrationPollMilliseconds = 10;
export interface OwnedWindowsElectronBridgeInput extends WindowsElectronServiceInput, OwnedWindowsServiceInput {}
type OwnerDependencies = OwnedWindowsServiceDependencies<'electronBridge', OwnedWindowsElectronBridgeInput>;
interface Dependencies {
  owner: OwnerDependencies;
  assertVersions(): void;
  observe: typeof createElectronSpawnObservation;
  launch: typeof electron.launch;
}
const defaults: Dependencies = {
  owner: windowsServiceDependencies('electronBridge', input =>
    prepareWindowsServiceConfiguration({ profile: 'electronBridge', input })),
  assertVersions: assertElectronSpawnObservationVersions,
  observe: createElectronSpawnObservation,
  launch: options => electron.launch(options),
};

export interface ElectronBridgeCleanupEvidence {
  readonly owner: Readonly<WindowsOwnerCleanupEvidence>;
  readonly bridge: 'pending' | 'notLaunched' | 'closed' | 'unverified';
  readonly observerFailure: ElectronSpawnObservationFailureCode | null;
  readonly launchFailure: boolean;
  readonly goSent: boolean;
  readonly bridgeExit: 'pending' | 'notLaunched' | 'notCreated' | 'withoutWorkload' | 'matched' | 'unexpected';
}
export class ElectronBridgeCallerFailure extends Error {
  readonly #failure: Readonly<{ error: unknown }> | undefined;
  constructor(code: 'START_FAILED' | 'CLEANUP_UNVERIFIED', failure?: Readonly<{ error: unknown }>) {
    super('E2E_ELECTRON_BRIDGE_' + code);
    this.#failure = failure;
  }
  readPrivateFailure() { return this.#failure; }
}
export interface OwnedWindowsElectronBridge {
  readonly application: Promise<ElectronApplication>;
  readonly workload: WindowsOwnerSession<'electronBridge'>['service']['workload'];
  stop(): Promise<void>;
  readCleanupEvidence(): Readonly<ElectronBridgeCleanupEvidence>;
  readPrivateLaunchFailure(): Readonly<{ error: unknown }> | undefined;
  readPrivateFailure(): Readonly<{ error: unknown }> | undefined;
}

// A staged caller of the existing owner, not another workload/process-tree owner.
export function startOwnedWindowsElectronBridge(
  input: OwnedWindowsElectronBridgeInput, overrides: Partial<Dependencies> = {},
): OwnedWindowsElectronBridge {
  const dependencies = { ...defaults, ...overrides };
  let owner: WindowsOwnerSession<'electronBridge'>;
  try {
    dependencies.assertVersions();
    owner = createWindowsOwnerSession('electronBridge', input, dependencies.owner);
  } catch (error) {
    throw new ElectronBridgeCallerFailure('START_FAILED', error instanceof OwnedWindowsServiceStartupFailure
      ? error.readPrivateFailure() ?? Object.freeze({ error }) : Object.freeze({ error }));
  }
  let observer: ReturnType<typeof createElectronSpawnObservation> | undefined;
  let launchInvoked = false;
  let stopping = false;
  let goSent = false;
  let bridge: ElectronBridgeCleanupEvidence['bridge'] = 'pending';
  let privateLaunchFailure: Readonly<{ error: unknown }> | undefined;
  let privateFailure: Readonly<{ error: unknown }> | undefined;
  let retainedChild: ChildProcess | undefined;
  let bridgeExit: ElectronBridgeCleanupEvidence['bridgeExit'] = 'pending';
  let sealedEvidence: Readonly<ElectronBridgeCleanupEvidence> | undefined;
  let orchestration: Promise<ElectronApplication>;
  let stopResult: Promise<void> | undefined;
  const safeFailure = (code: 'START_FAILED' | 'CLEANUP_UNVERIFIED') => new ElectronBridgeCallerFailure(code, privateFailure);
  const requireOpen = () => {
    owner.requireStartupOpen();
    if (stopping) throw safeFailure('START_FAILED');
  };
  const readCleanupEvidence = (): Readonly<ElectronBridgeCleanupEvidence> => sealedEvidence ?? Object.freeze({
    owner: owner.readCleanupEvidence(), bridge,
    observerFailure: observer?.readState().failure ?? null,
    launchFailure: privateLaunchFailure !== undefined, goSent, bridgeExit,
  });

  async function beforeCloseDeadline<T>(operation: Promise<T>): Promise<T> {
    void operation.catch(() => {});
    let cancel = () => {};
    let rejectExpired!: (error: Error) => void;
    const expired = new Promise<never>((_, reject) => { rejectExpired = reject; });
    const update = (deadline: number) => {
      cancel();
      const remaining = deadline - dependencies.owner.now();
      if (!Number.isFinite(remaining) || remaining <= 0) rejectExpired(safeFailure('CLEANUP_UNVERIFIED'));
      else cancel = dependencies.owner.schedule(() => rejectExpired(safeFailure('CLEANUP_UNVERIFIED')), remaining);
    };
    const unsubscribe = owner.subscribeCleanupDeadline(update);
    try {
      update(owner.readCleanupDeadline() ?? NaN);
      const result = await Promise.race([operation, expired]);
      if (dependencies.owner.now() >= (owner.readCleanupDeadline() ?? -Infinity)) throw safeFailure('CLEANUP_UNVERIFIED');
      return result;
    } finally { cancel(); unsubscribe(); }
  }

  function classifyExit(): void {
    if (!launchInvoked) { bridgeExit = 'notLaunched'; return; }
    if (observer?.readState().spawnObserved === false) { bridgeExit = 'notCreated'; return; }
    const code = retainedChild?.exitCode;
    if (retainedChild?.signalCode !== null || !Number.isInteger(code)) { bridgeExit = 'unexpected'; return; }
    const workloadCode = owner.service.workload.readExitCode();
    bridgeExit = workloadCode === null ? code === 0 ? 'withoutWorkload' : 'unexpected'
      : code === workloadCode ? 'matched' : 'unexpected';
  }

  function stop(): Promise<void> {
    if (stopResult !== undefined) return stopResult;
    stopping = true;
    retainedChild ??= observer?.readRetainedProcesses()[0];
    observer?.stop();
    // Repeated native timing receipts may only shorten the same close wait.
    const unsubscribe = owner.subscribeCleanupDeadline(deadline => {
      if (launchInvoked) void observer!.waitForClose(deadline).catch(() => {});
    });
    const ownerStop = owner.stop();
    void ownerStop.catch(error => { privateFailure ??= owner.readPrivateFailure() ?? Object.freeze({ error }); });
    stopResult = (async () => {
      try {
        const deadline = owner.readCleanupDeadline();
        const close = launchInvoked && deadline !== undefined
          ? observer!.waitForClose(deadline).then(() => { bridge = 'closed'; }, () => { bridge = 'unverified'; })
          : Promise.resolve().then(() => { bridge = launchInvoked ? 'unverified' : 'notLaunched'; });
        await beforeCloseDeadline(Promise.allSettled([ownerStop, close,
          orchestration.then(() => {}, () => {})]));
        classifyExit();
        if (owner.readCleanupEvidence().status !== 'processTreeAbsent' ||
          bridge !== 'closed' && bridge !== 'notLaunched') throw safeFailure('CLEANUP_UNVERIFIED');
        const observationFailure = observer?.readState().failure;
        if (bridgeExit === 'unexpected' || owner.readCleanupEvidence().firstFailure !== null || privateLaunchFailure !== undefined ||
          observationFailure != null && observationFailure !== 'stopped') throw safeFailure('START_FAILED');
      } catch (error) {
        if (bridge === 'pending') bridge = 'unverified';
        throw error;
      } finally { unsubscribe(); sealedEvidence = readCleanupEvidence(); }
    })();
    void stopResult.catch(() => {});
    return stopResult;
  }

  async function launch(): Promise<ElectronApplication> {
    try {
      const sample = await owner.ready;
      requireOpen();
      const config = owner.config;
      const binding = config.bridge;
      if (binding === undefined) throw safeFailure('START_FAILED');
      const remaining = Math.floor(config.workDeadline - dependencies.owner.now());
      if (!Number.isSafeInteger(remaining) || remaining < 1) throw safeFailure('START_FAILED');
      const armed = await owner.request({ kind: 'arm', launchNonce: config.launchNonce,
        workDeadlineElapsedMilliseconds: sample.elapsedMilliseconds + remaining });
      requireOpen();
      if (armed.kind !== 'armed' || typeof armed.bootstrap !== 'string') throw safeFailure('START_FAILED');
      observer = dependencies.observe({ executable: config.executable, cwd: binding.cwd,
        generation: config.generation, launchNonce: config.launchNonce,
        generationEnvironmentKey: electronBridgeEnvironmentKeys.generation,
        nonceEnvironmentKey: electronBridgeEnvironmentKeys.nonce, workDeadline: config.workDeadline },
      { now: dependencies.owner.now, schedule: dependencies.owner.schedule, assertVersions: dependencies.assertVersions });
      const timeout = Math.floor(Math.min(input.startupDeadline, config.workDeadline) - dependencies.owner.now());
      if (!Number.isSafeInteger(timeout) || timeout < 1) throw safeFailure('START_FAILED');
      const launchPromise = observer.run(() => {
        requireOpen();
        launchInvoked = true;
        return dependencies.launch({ executablePath: config.executable, cwd: binding.cwd,
          args: [binding.entrypoint], timeout,
          env: { ...config.ownerEnvironment,
            [electronBridgeEnvironmentKeys.config]: config.configPath,
            [electronBridgeEnvironmentKeys.generation]: config.generation,
            [electronBridgeEnvironmentKeys.nonce]: config.launchNonce,
            [electronBridgeEnvironmentKeys.bootstrap]: armed.bootstrap!,
          } });
      });
      void launchPromise.catch(error => {
        privateLaunchFailure ??= Object.freeze({ error });
        privateFailure ??= owner.readPrivateFailure() ?? Object.freeze({ error });
        void stop().catch(() => {});
      });
      await owner.beforeStartupDeadline(observer.waitForSpawn());
      const candidate = observer.requireGoCandidate();
      retainedChild = candidate.child;
      const requireCandidate = () => {
        requireOpen();
        const current = observer!.requireGoCandidate();
        if (current.child !== candidate.child || current.pid !== candidate.pid) throw safeFailure('START_FAILED');
      };
      const registered = await owner.request({ kind: 'register', launchNonce: config.launchNonce,
        observedBridgePid: candidate.pid }, requireCandidate);
      if (registered.kind !== 'registering') throw safeFailure('START_FAILED');
      let receipt: string | undefined;
      while (receipt === undefined) {
        const status = await owner.request({ kind: 'status' }, requireCandidate);
        if (status.kind !== 'status') throw safeFailure('START_FAILED');
        if (typeof status.registration === 'string') { receipt = status.registration; break; }
        let cancel = () => {};
        try {
          await owner.beforeStartupDeadline(new Promise<void>(resolve => {
            cancel = dependencies.owner.schedule(resolve, registrationPollMilliseconds);
          }));
        } finally { cancel(); }
      }
      await owner.request({ kind: 'go', registration: receipt }, () => {
        requireCandidate();
        if (goSent) throw safeFailure('START_FAILED');
        goSent = true;
      });
      const application = await owner.beforeStartupDeadline(launchPromise);
      requireCandidate();
      if (application.process() !== candidate.child) throw safeFailure('START_FAILED');
      return application;
    } catch (error) {
      privateFailure ??= owner.readPrivateFailure() ?? Object.freeze({ error });
      privateLaunchFailure ??= observer?.readPrivateLaunchFailure();
      throw safeFailure('START_FAILED');
    }
  }
  orchestration = launch();
  const application = orchestration.catch(async error => {
    try { await stop(); } catch { /* Separate cleanup evidence remains authoritative. */ }
    throw error;
  });
  void application.catch(() => {});
  return { application, workload: owner.service.workload, stop, readCleanupEvidence,
    readPrivateLaunchFailure: () => privateLaunchFailure ?? observer?.readPrivateLaunchFailure(),
    readPrivateFailure: () => privateFailure };
}
