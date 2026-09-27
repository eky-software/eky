import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';

import { createWindowsOwnerSession } from '../../src/environment/startOwnedWindowsService.js';
import { startOwnedWindowsElectronBridge, electronBridgeEnvironmentKeys,
  ElectronBridgeCallerFailure } from '../../src/environment/startOwnedWindowsElectronBridge.js';
import { electronSpawnStartChannel } from '../../src/environment/electronSpawnObservation.js';
import { createWindowsServiceControl } from '../../src/environment/windowsServiceControl.js';
import { windowsServiceProfiles } from '../../src/environment/windowsServiceProfile.js';
import type { WindowsElectronBridgeCommand, WindowsServiceReply, WindowsServiceRequestKind,
  WindowsServiceState } from '../../src/environment/windowsServiceProtocol.js';

const generation = 'a'.repeat(64);
const nonce = 'b'.repeat(64);
const receipt = 'c'.repeat(64);
const bootstrap = JSON.stringify({ generation, launchNonce: nonce, opaqueClock: '123' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  let now = 100; let sequence = 0; let closed = false; let created = false; let registered = false;
  let cleanupStart: number | null = null;
  let connection!: Parameters<ReturnType<typeof createWindowsServiceControl<'electronBridge'>>['connectWindowsServiceControl']>[0];
  const commands: (WindowsElectronBridgeCommand | { kind: WindowsServiceRequestKind })[] = [];
  const seen = new Set<string>();
  const signals = new Map<string, ReturnType<typeof deferred<void>>>();
  const holds = new Map<string, ReturnType<typeof deferred<void>>>();
  const signal = (name: string) => { seen.add(name); signals.get(name)?.resolve(undefined); };
  const when = (name: string) => {
    if (seen.has(name)) return Promise.resolve();
    const waiting = signals.get(name) ?? deferred<void>(); signals.set(name, waiting); return waiting.promise;
  };
  const timers = new Set<{ due: number; callback: () => void }>();
  const launchResult = deferred<ElectronApplication>();
  void launchResult.promise.catch(() => {});
  const flags = { observation: 'normal' as 'normal' | 'missing' | 'duplicate' | 'beforeOs',
    settleOnStop: true, receipt: true, ownerCloseCode: 0, bridgeExitCode: 0,
    launchCalls: 0, ownerSpawns: 0, kills: 0, destroyedConnections: 0 };
  const hooks = { beforeReply: (_kind: string) => {}, assertVersions: () => {} };
  const input = { repositoryRoot: join(tmpdir(), 'uncreated-eky-repository'), runRoot: join(tmpdir(), 'uncreated-eky-run'),
    runtimeRoot: join(tmpdir(), 'uncreated-eky-run', 'runtime'),
    runtimeConfigPath: join(tmpdir(), 'uncreated-eky-run', 'runtime', 'electron-config.json'),
    environment: { EKY_E2E: '1', EKY_ELECTRON_E2E_CONFIG: 'synthetic-runtime-only' },
    lifetime: { readRemainingWorkMilliseconds: () => 8_000 - now }, startupDeadline: 4_000, redactedValues: [] };
  const config = { generation, launchNonce: nonce, configPath: join(input.runRoot, 'private-config.json'),
    executable: join(tmpdir(), 'unexecuted-bridge.exe'), repositoryRoot: input.repositoryRoot, workDeadline: 8_000,
    bridge: { cwd: input.runRoot, entrypoint: join(input.repositoryRoot, 'apps', 'desktop', 'e2e-dist') },
    ownerEnvironment: { EKY_E2E: '1', EKY_E2E_OS_TEMP_ROOT: tmpdir(), SystemRoot: 'synthetic-system',
      WINDIR: 'synthetic-system', TEMP: 'synthetic-temp', DOTNET_ROOT: 'synthetic-dotnet' } };
  const child = Object.assign(new EventEmitter(), { spawnfile: config.executable,
    pid: undefined as number | undefined, exitCode: null, signalCode: null,
    kill() { throw new Error('PROCESS_KILL_FORBIDDEN'); }, spawn() { throw new Error('PROCESS_SPAWN_FORBIDDEN'); } });
  Object.setPrototypeOf(child, ChildProcess.prototype);
  const application = { process: () => child } as unknown as ElectronApplication;
  const closeChild = () => {
    Object.assign(child, { exitCode: flags.bridgeExitCode });
    child.emit('exit', flags.bridgeExitCode, null); child.emit('close', flags.bridgeExitCode, null);
  };
  const closeOwner = (code: number) => {
    if (closed) return;
    closed = true; owner.emit('close', code, null);
  };
  const owner = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: () => closeOwner(1) }),
    kill: () => { flags.kills++; closeOwner(1); return true; } });
  let state: WindowsServiceState = { created: false, started: false, creationCompleted: false, launchClosed: false,
    identity: null, workload: 'pending', exitCode: null, assignedBeforeResume: false, activeProcesses: 0,
    stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null };
  async function request(command: WindowsElectronBridgeCommand | { kind: WindowsServiceRequestKind }): Promise<WindowsServiceReply<'electronBridge'>> {
    const { kind } = command;
    commands.push(command); signal(kind);
    if (holds.has(kind)) await holds.get(kind)!.promise;
    hooks.beforeReply(kind);
    if (kind === 'register') registered = true;
    if (kind === 'go') {
      created = true;
      state = { ...state, created: true, started: true, creationCompleted: true, launchClosed: true,
        identity: { pid: 77, creationTimeFileTimeHex: '0123456789abcdef' }, workload: 'running', assignedBeforeResume: true,
        activeProcesses: 2 };
      launchResult.resolve(application);
    }
    if (kind === 'stop') {
      cleanupStart ??= now - 100;
      state = { ...state, creationCompleted: true, launchClosed: true, workload: created ? 'exited' : 'pending',
        exitCode: created ? 0 : null, activeProcesses: 0, stdioSettled: true, cleanup: 'processTreeAbsent' };
      closeChild();
      if (flags.settleOnStop) launchResult.reject(new Error('synthetic private stopped launch'));
    }
    const reply: WindowsServiceReply<'electronBridge'> = {
      protocol: windowsServiceProfiles.electronBridge.protocol, schemaVersion: 1, generation, sequence: ++sequence,
      replyTo: sequence, kind: kind === 'arm' ? 'armed' : kind === 'register' ? 'registering'
        : kind === 'go' || kind === 'launch' ? 'started' : kind === 'stop' ? 'terminal' : kind,
      state, rssBytes: kind === 'rss' ? 4_096 : null, elapsedMilliseconds: now - 100,
      cleanupStartedElapsedMilliseconds: cleanupStart,
      remainingCleanupMilliseconds: cleanupStart === null ? null : Math.max(0, cleanupStart + 3_000 - (now - 100)),
      registration: kind === 'status' && registered && !created && flags.receipt ? receipt : null,
      bootstrap: kind === 'arm' ? bootstrap : null,
    };
    connection.onReply(reply, now); return reply;
  }
  const control = { request: (kind: WindowsServiceRequestKind) => request({ kind }), requestBridge: request,
    finish: async () => { closeOwner(flags.ownerCloseCode); },
    destroy() { flags.destroyedConnections++; signal('connectionDestroyed'); } };
  const launchOptions: Parameters<NonNullable<NonNullable<Parameters<typeof startOwnedWindowsElectronBridge>[1]>['launch']>>[0][] = [];
  const dependencies: NonNullable<Parameters<typeof startOwnedWindowsElectronBridge>[1]> = {
    assertVersions: () => hooks.assertVersions(),
    owner: {
      prepare: () => config,
      spawnOwner: () => { flags.ownerSpawns++; return owner as unknown as ChildProcessWithoutNullStreams; },
      connect: async value => { connection = value; signal('connect');
        if (holds.has('connect')) await holds.get('connect')!.promise;
        return control; },
      now: () => now,
      schedule: (callback, milliseconds) => {
        const timer = { due: now + milliseconds, callback }; timers.add(timer);
        return () => { timers.delete(timer); };
      },
    },
    launch: options => {
      flags.launchCalls++; launchOptions.push(options); signal('launch');
      if (flags.observation !== 'missing') {
        const message = { process: child, options: { file: config.executable, cwd: config.bridge.cwd,
          envPairs: Object.entries(options?.env ?? {}).map(([key, value]) => `${key}=${value}`) } };
        channel(electronSpawnStartChannel).publish(message);
        if (flags.observation === 'duplicate') channel(electronSpawnStartChannel).publish(message);
        if (flags.observation === 'beforeOs') child.emit('error', new Error('synthetic private spawn failure'));
        else { child.pid = 42; child.emit('spawn'); }
      }
      return launchResult.promise;
    },
  };
  return { input, config, flags, hooks, commands, timers, child, owner, launchResult, application, launchOptions, when,
    start: () => startOwnedWindowsElectronBridge(input, dependencies),
    session: () => createWindowsOwnerSession('electronBridge', input, dependencies.owner!),
    hold(kind: string) { const value = deferred<void>(); holds.set(kind, value); return () => value.resolve(undefined); },
    setNow(value: number) { now = value; },
    expire(value: number) {
      now = value;
      for (const timer of [...timers].sort((a, b) => a.due - b.due)) {
        if (timers.has(timer) && timer.due <= now) { timers.delete(timer); timer.callback(); }
      }
    },
    setFailure(failure: string) { state = { ...state, firstFailure: failure }; },
  };
}

test.describe('staged shared Windows owner and public Electron launch driver @security', () => {
  test('arms before public launch and registers before GO while Playwright is pending', async () => {
    const f = fixture(); const driver = f.start();
    expect(await driver.application).toBe(f.application);
    expect(f.commands.map(command => command.kind)).toEqual(['status', 'arm', 'register', 'status', 'go']);
    expect(f.commands[1]).toEqual({ kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 7_900 });
    expect(f.commands[2]).toEqual({ kind: 'register', launchNonce: nonce, observedBridgePid: 42 });
    expect(f.flags.ownerSpawns).toBe(1);
    expect(f.launchOptions[0]).toEqual({ executablePath: f.config.executable, cwd: f.config.bridge.cwd,
      args: [f.config.bridge.entrypoint], timeout: 3_900, env: { ...f.config.ownerEnvironment,
        [electronBridgeEnvironmentKeys.config]: f.config.configPath,
        [electronBridgeEnvironmentKeys.generation]: generation,
        [electronBridgeEnvironmentKeys.nonce]: nonce,
        [electronBridgeEnvironmentKeys.bootstrap]: bootstrap } });
    expect(f.input.environment).toEqual({ EKY_E2E: '1', EKY_ELECTRON_E2E_CONFIG: 'synthetic-runtime-only' });
    expect(await driver.workload.readRssBytes()).toBe(4_096);
    await driver.stop();
    expect(driver.readCleanupEvidence()).toMatchObject({ bridge: 'closed', owner: { status: 'processTreeAbsent' }, goSent: true });
    expect(f.flags.kills).toBe(0); expect(f.timers.size).toBe(0);
  });

  test('version rejection precedes even owner creation', () => {
    const f = fixture(); const original = new Error('E2E_ELECTRON_OBSERVATION_VERSION_UNVERIFIED');
    f.hooks.assertVersions = () => { throw original; };
    let failure: unknown;
    try { f.start(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ElectronBridgeCallerFailure);
    expect((failure as ElectronBridgeCallerFailure).readPrivateFailure()?.error).toBe(original);
    expect(f.flags.ownerSpawns).toBe(0); expect(f.flags.launchCalls).toBe(0);
  });

  for (const stage of ['connect', 'arm', 'register']) {
    test(`stop during pending ${stage} permanently seals admission`, async () => {
      const f = fixture(); const release = f.hold(stage); const driver = f.start();
      await f.when(stage);
      const stopping = driver.stop(); const settled = stopping.catch(() => {});
      expect(driver.stop()).toBe(stopping);
      release(); await settled;
      await expect(driver.application).rejects.toThrow('E2E_ELECTRON_BRIDGE_START_FAILED');
      expect(f.commands.some(command => command.kind === 'go')).toBe(false);
      expect(driver.readCleanupEvidence()).toMatchObject({ owner: { status: 'processTreeAbsent' },
        bridge: stage === 'register' ? 'closed' : 'notLaunched' });
      expect(f.flags.launchCalls).toBe(stage === 'register' ? 1 : 0);
      expect(f.timers.size).toBe(0);
    });
  }

  test('failed startup does not await a pending connection and destroys its late delivery', async () => {
    const f = fixture(); const release = f.hold('connect'); const driver = f.start();
    await f.when('connect');
    f.expire(f.input.startupDeadline);
    await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(driver.readCleanupEvidence()).toMatchObject({ bridge: 'notLaunched', owner: {
      status: 'cleanupUnverified', firstFailure: 'startupDeadlineExceeded' } });
    expect(f.timers.size).toBe(0);
    release(); await f.when('connectionDestroyed');
    expect(f.flags.destroyedConnections).toBe(1);
    expect(f.flags.launchCalls).toBe(0);
    expect(f.commands).toEqual([]);
  });

  test('staged session itself does not launch and refuses GO without arm/register', async () => {
    const f = fixture(); const session = f.session();
    await session.ready;
    expect(f.commands.map(command => command.kind)).toEqual(['status']);
    await expect(session.request({ kind: 'go', registration: receipt })).rejects.toThrow('OWNER_START_FAILED');
    await session.stop();
    expect(f.commands.some(command => command.kind === 'go')).toBe(false);
    expect(session.readCleanupEvidence().firstFailure).toBe('launchFailed');
  });

  test('repeated arm cannot renew the original bound', async () => {
    const f = fixture(); const session = f.session();
    await session.ready;
    await session.request({ kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 500 });
    await expect(session.request({ kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 9_000 })).rejects.toThrow();
    await session.stop();
    expect(f.commands.filter(command => command.kind === 'arm')).toHaveLength(1);
  });

  test('rechecks the candidate inside GO dispatch after registration', async () => {
    const f = fixture();
    f.hooks.beforeReply = kind => {
      if (kind === 'status' && f.commands.some(command => command.kind === 'register')) f.child.emit('exit', 0, null);
    };
    const driver = f.start();
    await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(f.commands.some(command => command.kind === 'go')).toBe(false);
    expect(driver.readCleanupEvidence().bridge).toBe('closed');
  });

  for (const observation of ['duplicate', 'beforeOs'] as const) {
    test(`${observation} observation cannot register or GO but can prove separate closure`, async () => {
      const f = fixture(); f.flags.observation = observation; const driver = f.start();
      await expect(driver.application).rejects.toThrow('START_FAILED');
      expect(f.commands.some(command => command.kind === 'register' || command.kind === 'go')).toBe(false);
      expect(driver.readCleanupEvidence()).toMatchObject({ bridge: 'closed', owner: { status: 'processTreeAbsent' },
        observerFailure: observation === 'duplicate' ? 'duplicateObservation' : 'spawnFailed' });
    });
  }

  test('retains original rejection separately from successful cleanup and safe public error', async () => {
    const f = fixture(); const release = f.hold('register'); const driver = f.start(); await f.when('register');
    const original = new Error('synthetic private path args environment');
    f.launchResult.reject(original); release();
    await expect(driver.application).rejects.toThrow('E2E_ELECTRON_BRIDGE_START_FAILED');
    expect(driver.readPrivateLaunchFailure()?.error).toBe(original);
    expect(driver.readCleanupEvidence()).toMatchObject({ launchFailure: true, bridge: 'closed', owner: { status: 'processTreeAbsent' } });
    expect(JSON.stringify(driver.readCleanupEvidence())).not.toContain('synthetic private');
    expect(f.commands.some(command => command.kind === 'go')).toBe(false);
    expect(f.timers.size).toBe(0);
  });

  test('retains the actual registration exception independently of the Playwright rejection', async () => {
    const f = fixture(); const original = new Error('synthetic private registration detail');
    f.hooks.beforeReply = kind => { if (kind === 'register') throw original; };
    const driver = f.start();
    await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(driver.readPrivateFailure()?.error).toBe(original);
    expect(driver.readPrivateLaunchFailure()?.error).not.toBe(original);
    expect(JSON.stringify(driver.readCleanupEvidence())).not.toContain('synthetic private');
  });

  test('a pending Playwright promise is not close proof even after child close and native terminal', async () => {
    const f = fixture(); f.flags.settleOnStop = false; const release = f.hold('register');
    const driver = f.start(); await f.when('register');
    const stop = driver.stop(); const checked = expect(stop).rejects.toThrow('CLEANUP_UNVERIFIED');
    release(); await f.when('stop'); f.expire(3_101); await checked;
    await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(driver.readCleanupEvidence().bridge).toBe('unverified');
    const evidence = driver.readCleanupEvidence();
    f.launchResult.reject(new Error('synthetic late rejection'));
    await Promise.resolve();
    expect(driver.readCleanupEvidence()).toBe(evidence);
    expect(f.commands.some(command => command.kind === 'go')).toBe(false);
    expect(f.timers.size).toBe(0);
  });

  test('missing observation cannot become absence proof from a settled launch alone', async () => {
    const f = fixture(); f.flags.observation = 'missing'; const driver = f.start(); await f.when('launch');
    f.launchResult.reject(new Error('synthetic missing spawn'));
    await f.when('stop'); f.expire(3_101);
    await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(driver.readCleanupEvidence().bridge).toBe('unverified');
    expect(f.commands.some(command => command.kind === 'register')).toBe(false);
  });

  test('delayed armed reply spends the original startup budget rather than renewing it', async () => {
    const f = fixture(); f.hooks.beforeReply = kind => { if (kind === 'arm') f.setNow(3_999); };
    const driver = f.start(); await driver.application;
    expect(f.launchOptions[0]?.timeout).toBe(1);
    await driver.stop();
  });

  test('expired armed reply cannot invoke Playwright', async () => {
    const f = fixture(); f.hooks.beforeReply = kind => { if (kind === 'arm') f.setNow(4_000); };
    const driver = f.start(); await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(f.flags.launchCalls).toBe(0);
    expect(driver.readCleanupEvidence().bridge).toBe('notLaunched');
  });

  test('repeated stop preserves one cleanup deadline and a nonzero owner exit is not proof', async () => {
    const f = fixture(); f.flags.ownerCloseCode = 1; const session = f.session(); await session.ready;
    const stop = session.stop(); const checked = expect(stop).rejects.toThrow();
    const deadline = session.readCleanupDeadline(); f.setNow(300);
    expect(session.stop()).toBe(stop); expect(session.readCleanupDeadline()).toBe(deadline);
    await checked; expect(session.readCleanupEvidence().status).toBe('cleanupUnverified');
  });

  test('native first failure remains separate from successful terminal cleanup', async () => {
    const f = fixture(); const driver = f.start(); await driver.application;
    f.setFailure('stdioFailed');
    await expect(driver.stop()).rejects.toThrow('START_FAILED');
    expect(driver.readCleanupEvidence()).toMatchObject({ bridge: 'closed', owner: {
      status: 'processTreeAbsent', firstFailure: 'observationLost' } });
  });

  test('bridge relay failure exit cannot pass stop when the native root exited zero', async () => {
    const f = fixture(); const driver = f.start(); await driver.application;
    f.flags.bridgeExitCode = 1;
    await expect(driver.stop()).rejects.toThrow('START_FAILED');
    expect(driver.readCleanupEvidence()).toMatchObject({ bridge: 'closed', bridgeExit: 'unexpected',
      owner: { status: 'processTreeAbsent' } });
  });

  test('pre-GO bridge failure stays separate from native no-workload cleanup', async () => {
    const f = fixture(); f.flags.bridgeExitCode = 1; const release = f.hold('register');
    const driver = f.start(); await f.when('register');
    const stop = driver.stop(); const checked = expect(stop).rejects.toThrow('START_FAILED'); release(); await checked;
    await expect(driver.application).rejects.toThrow('START_FAILED');
    expect(driver.readCleanupEvidence()).toMatchObject({ bridgeExit: 'unexpected',
      owner: { status: 'processTreeAbsent' }, goSent: false });
  });
});
