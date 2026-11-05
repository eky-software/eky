import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import {
  assertPackagedSmokeBuildAcceptance,
  createPackagedSmokeConfiguration,
  createPackagedSmokeFailureMessage,
  createPackagedSmokeProgressReporter,
  createPackagedSmokeTimeoutMessage,
  packagedSmokeStages,
  packagedSmokeBackendObservationPrefix,
  readPackagedSmokeBackend,
  readPackagedDiagnosticEvents,
  readPackagedSmokeResult,
  resolvePackagedSmokeTempPath,
  reportPackagedSmokeBackend,
  runPackagedSelectorSmoke,
  type PackagedSmokeStage,
} from './packagedSmoke.js';

const acceptedBuild = {
  acceptedAt: '2026-08-21T10:00:00.000Z',
  appVersion: '0.2.6',
  buildRevision: '123456789abc',
  formatVersion: 1 as const,
  releaseChannel: 'pilot' as const,
};

describe('packaged backend port observation', () => {
  const configuration = { enabled: true, phase: 'initial' as const, root: undefined, userDataPath: undefined };
  const message = (phase: string, port: unknown = 12345) => packagedSmokeBackendObservationPrefix +
    JSON.stringify({ schemaVersion: 1, phase, port });

  it('roundtrips only the ready backend technical observation, never a secret or profile', () => {
    const output: string[] = [];
    reportPackagedSmokeBackend(configuration, 12345, text => output.push(text));
    expect(output).toEqual([message('initial') + '\n']);
    expect(readPackagedSmokeBackend('unrelated output\n' + output[0], 'initial')).toBe(12345);
    expect(readPackagedSmokeBackend(output[0]!.replace('\n', '\r\n'), 'initial')).toBe(12345);
    reportPackagedSmokeBackend({ ...configuration, phase: 'restoredProfile' }, 54321, text => output.push(text));
    expect(readPackagedSmokeBackend(output[1]!, 'restoredProfile')).toBe(54321);
  });

  it('does not emit in normal use and refuses a backend in selector verification', () => {
    const write = vi.fn();
    reportPackagedSmokeBackend({ ...configuration, enabled: false }, 12345, write);
    expect(write).not.toHaveBeenCalled();
    expect(() => reportPackagedSmokeBackend({ ...configuration, phase: 'selectorVerification' }, 12345, write)).toThrow();
    expect(readPackagedSmokeBackend('unrelated output\n', 'selectorVerification')).toBeUndefined();
    expect(() => readPackagedSmokeBackend(message('initial'), 'selectorVerification')).toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it.each([0, -1, 65536, 1.5, NaN, Infinity])('refuses invalid port %s without emitting', port => {
    const write = vi.fn();
    expect(() => reportPackagedSmokeBackend(configuration, port, write)).toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(() => readPackagedSmokeBackend(message('initial', port) + '\n', 'initial')).toThrow();
  });

  it.each([
    '', 'unrelated output\n', message('restoredProfile'), message('initial') + '\n' + message('initial'),
    packagedSmokeBackendObservationPrefix + '{}', packagedSmokeBackendObservationPrefix + 'not-json',
    packagedSmokeBackendObservationPrefix + '{"schemaVersion":1,"phase":"initial","port":12345,"extra":true}',
    packagedSmokeBackendObservationPrefix + '{"schemaVersion":1,"phase":"initial","port":7,"port":12345}',
    message('initial', '12345'), message('initial', null),
  ])('refuses missing, stale, duplicated or noncanonical evidence: %s', text => {
    expect(() => readPackagedSmokeBackend(text + '\n', 'initial')).toThrow('DESKTOP_SMOKE_BACKEND_OBSERVATION_INVALID');
  });

  it('preserves the original output writer failure', () => {
    const first = new Error('synthetic stdout failure');
    expect(() => reportPackagedSmokeBackend(configuration, 12345, () => { throw first; })).toThrow(first);
  });

  it.each(['initial', 'restoredProfile', 'selectorVerification'] as const)(
    'rejects malformed reserved markers and incomplete framing in %s', phase => {
      const malformed = [packagedSmokeBackendObservationPrefix.trimEnd() + '\n',
        packagedSmokeBackendObservationPrefix.trimEnd() + ': malformed\n',
        ' ' + message('initial') + '\n', message('initial')];
      for (const text of malformed) {
        expect(() => readPackagedSmokeBackend(text, phase)).toThrow();
        if (phase !== 'selectorVerification') {
          expect(() => readPackagedSmokeBackend(message(phase) + '\n' + text, phase)).toThrow();
        }
      }
    },
  );
});

describe('packaged diagnostic continuation', () => {
  it('consumes only validated continuation tokens before reading the ready page', async () => {
    const queries: string[] = [];
    const names = await readPackagedDiagnosticEvents(async query => {
      queries.push(query.toString());
      return queries.length === 1 ? { state: 'scanning', cursor: 'a'.repeat(32) }
        : { state: 'ready', readState: { status: 'complete', reasons: [] },
          older: { state: 'available', cursor: 'b'.repeat(32) }, newer: { state: 'end' },
          diagnosticEvents: [{ eventName: 'backend.started' }] };
    });
    expect(names).toEqual(['backend.started']);
    expect(queries).toEqual(['limit=200', `cursor=${'a'.repeat(32)}`]);
  });

  it.each([
    { state: 'scanning', cursor: '../private' },
    { state: 'scanning', cursor: `${'a'.repeat(32)}\n` },
    { state: 'scanning', cursor: 'a'.repeat(32), path: 'synthetic' },
    { state: 'limited', diagnosticEvents: [] },
    { state: 'unavailable', diagnosticEvents: [] },
    { diagnosticEvents: [{ eventName: 'backend.started' }] },
    { state: 'ready', readState: { status: 'partial' }, diagnosticEvents: [] },
    { state: 'ready', readState: { status: 'complete' }, diagnosticEvents: [{}] },
  ])('rejects incomplete or invalid smoke evidence: %j', async body => {
    await expect(readPackagedDiagnosticEvents(async () => body))
      .rejects.toThrow('DESKTOP_SMOKE_DIAGNOSTICS_HTTP_FAILED');
  });

  it('propagates the original request failure without retrying it', async () => {
    const failure = new Error('synthetic transport failure');
    let calls = 0;
    await expect(readPackagedDiagnosticEvents(async () => { calls++; throw failure; })).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it('ends a continuation chain at the existing step bound', async () => {
    let calls = 0;
    await expect(readPackagedDiagnosticEvents(async () => {
      calls++;
      return { state: 'scanning', cursor: 'a'.repeat(32) };
    })).rejects.toThrow('DESKTOP_SMOKE_DIAGNOSTICS_HTTP_FAILED');
    expect(calls).toBe(4_096);
  });
});

describe('packaged smoke progress', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) =>
          rm(directory, { force: true, recursive: true }),
        ),
    );
  });

  it('requires pilot acceptance only from pilot packages', () => {
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild: undefined,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: false,
      }),
    ).not.toThrow();
  });

  it('rejects missing pilot acceptance and development acceptance state', () => {
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild: undefined,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: true,
      }),
    ).toThrow('DESKTOP_SMOKE_FIRST_START_ACCEPTANCE_FAILED');
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: false,
      }),
    ).toThrow('DESKTOP_SMOKE_FIRST_START_ACCEPTANCE_FAILED');
  });

  it('requires business scope even when the accepted selector version and revision match', () => {
    const scoped = { formatVersion: 2 as const, acceptanceScope: 'selector' as const,
      acceptedBuild, businessBaseline: { ...acceptedBuild, appVersion: '0.1.0' } };
    const input = { acceptedBuild: scoped, appVersion: acceptedBuild.appVersion,
      buildRevision: acceptedBuild.buildRevision, requiresPilotAcceptance: true };
    expect(() => assertPackagedSmokeBuildAcceptance(input)).toThrow('DESKTOP_SMOKE_FIRST_START_ACCEPTANCE_FAILED');
    expect(() => assertPackagedSmokeBuildAcceptance({ ...input, acceptedBuild: {
      ...scoped, acceptanceScope: 'business', businessBaseline: acceptedBuild,
    } })).not.toThrow();
  });

  it('writes every allowlisted stage in the required order', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'eky-packaged-smoke-test-'),
    );
    temporaryDirectories.push(temporaryDirectory);
    const configuration = createPackagedSmokeConfiguration({
      hasSmokeSwitch: true,
      tempPath: temporaryDirectory,
      tokenValue: 'a'.repeat(32),
    });
    const reporter = createPackagedSmokeProgressReporter(configuration);

    for (const stage of packagedSmokeStages) {
      await reporter.reportStage(stage);
      expect(reporter.currentStage()).toBe(stage);
      expect(await readResult(configuration.root)).toEqual({
        stage,
        status: 'started',
      });
    }
  });

  it('canonicalizes the smoke temp root before deriving runtime paths', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'eky-packaged-smoke-path-test-'),
    );
    temporaryDirectories.push(temporaryDirectory);
    const nestedDirectory = join(temporaryDirectory, 'nested');
    await mkdir(nestedDirectory);
    const nonCanonicalTempPath = join(nestedDirectory, '..');
    const canonicalTempPath = resolvePackagedSmokeTempPath(temporaryDirectory);

    const configuration = createPackagedSmokeConfiguration({
      hasSmokeSwitch: true,
      tempPath: nonCanonicalTempPath,
      tokenValue: 'b'.repeat(32),
    });

    expect(configuration.root).toBe(
      join(canonicalTempPath, 'eky-desktop-smoke', 'b'.repeat(32)),
    );
    expect(configuration.userDataPath).toBe(
      join(
        canonicalTempPath,
        'eky-desktop-smoke',
        'b'.repeat(32),
        'user-data',
      ),
    );
  });

  it('rejects an unavailable smoke temp root without exposing its path', () => {
    const unavailablePath = join(
      tmpdir(),
      `eky-packaged-smoke-missing-${'c'.repeat(32)}`,
    );

    expect(() => resolvePackagedSmokeTempPath(unavailablePath)).toThrow(
      'DESKTOP_SMOKE_PATH_INVALID',
    );
  });

  it('does not resolve the temp root when packaged smoke is disabled', () => {
    expect(
      createPackagedSmokeConfiguration({
        hasSmokeSwitch: false,
        tempPath: 'C:\\private\\path-that-does-not-exist',
        tokenValue: undefined,
      }),
    ).toEqual({
      enabled: false,
      phase: 'initial',
      root: undefined,
      userDataPath: undefined,
    });
  });

  it('rejects unknown, skipped and repeated stages', async () => {
    const reporter = createPackagedSmokeProgressReporter({
      enabled: false,
      phase: 'initial',
      root: undefined,
      userDataPath: undefined,
    });

    await expect(
      reporter.reportStage('backend'),
    ).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
    await expect(
      reporter.reportStage('unsafe' as never),
    ).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');

    await reporter.reportStage('startup');
    await expect(
      reporter.reportStage('startup'),
    ).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
  });

  it('derives selector verification only from the existing admitted smoke root', () => {
    const options = { hasSmokeSwitch: true, hasSelectorVerificationSwitch: true,
      tempPath: tmpdir(), tokenValue: 'd'.repeat(32) };
    const configuration = createPackagedSmokeConfiguration(options);
    expect(configuration).toEqual({ enabled: true, phase: 'selectorVerification',
      root: join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', options.tokenValue),
      userDataPath: join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', options.tokenValue, 'user-data') });
  });

  it.each([
    { hasRestoredProfileSwitch: true }, { hasLegacyInvoiceSwitch: true },
  ])('rejects competing admitted selector verification modes: %j', conflict => {
    const options = { hasSmokeSwitch: true, hasSelectorVerificationSwitch: true,
      tempPath: tmpdir(), tokenValue: 'd'.repeat(32), ...conflict };
    expect(() => createPackagedSmokeConfiguration(options)).toThrow('DESKTOP_SMOKE_CONFIGURATION_INVALID');
  });

  it.each([
    { hasSmokeSwitch: false, tokenValue: undefined },
    { hasSmokeSwitch: true, tokenValue: undefined },
    { hasSmokeSwitch: true, tokenValue: '../untrusted' },
  ])('does not admit selector verification without ordinary smoke authority: %j', admission => {
    const options = { ...admission, hasSelectorVerificationSwitch: true,
      tempPath: 'synthetic-missing-temp-root' };
    expect(createPackagedSmokeConfiguration(options)).toEqual({ enabled: false, phase: 'initial',
      root: undefined, userDataPath: undefined });
  });

  it('does not enable selector verification with a token but without the ordinary smoke switch', () => {
    expect(createPackagedSmokeConfiguration({ hasSmokeSwitch: false, hasSelectorVerificationSwitch: true,
      tempPath: tmpdir(), tokenValue: 'd'.repeat(32) })).toEqual({ enabled: false, phase: 'initial',
      root: join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', 'd'.repeat(32)), userDataPath: undefined });
  });

  it('restricts selector verification to startup and settled shutdown', async () => {
    const options = { hasSmokeSwitch: true, hasSelectorVerificationSwitch: true,
      tempPath: tmpdir(), tokenValue: 'd'.repeat(32) };
    const reporter = createPackagedSmokeProgressReporter({ ...createPackagedSmokeConfiguration(options), enabled: false });
    await expect(reporter.reportStage('shutdown')).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
    await reporter.reportStage('startup');
    await expect(reporter.reportStage('backend')).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
    await expect(reporter.reportStage('startup')).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
    await reporter.reportStage('shutdown');
    await expect(reporter.reportStage('shutdown')).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
  });

  it('continues a restored profile run after the restart boundary', async () => {
    const reporter = createPackagedSmokeProgressReporter({
      enabled: false,
      phase: 'restoredProfile',
      root: undefined,
      userDataPath: undefined,
    });

    await reporter.reportStage('restoredStartup');
    await reporter.reportStage('restoreActivationJournalLoaded');
    await reporter.reportStage('restoredBackend');
    await reporter.reportStage('restoredSessionValidated');
    await reporter.reportStage('profileComparison');
    await reporter.reportStage('secondBackup');
    await reporter.reportStage('shutdown');

    expect(reporter.currentStage()).toBe('shutdown');
  });

  it('reports only the last safe stage in timeout messages', () => {
    expect(
      createPackagedSmokeTimeoutMessage({
        code: 'C:\\Users\\Example\\secret',
        stage: 'supportBundle',
        status: 'started',
      }),
    ).toBe(
      'Packaged desktop smoke check timed out (stage supportBundle).',
    );
    expect(
      createPackagedSmokeTimeoutMessage({
        stage: 'C:\\Users\\Example\\secret',
        status: 'started',
      }),
    ).toBe('Packaged desktop smoke check timed out (stage startup).');
  });

  it('admits legacy smoke only with the normal smoke token and switch', async () => {
    const disabled = createPackagedSmokeConfiguration({ hasLegacyInvoiceSwitch: true,
      hasSmokeSwitch: false, tempPath: tmpdir(), tokenValue: undefined });
    expect(disabled.scenario).toBeUndefined();
    const configuration = createPackagedSmokeConfiguration({ hasLegacyInvoiceSwitch: true,
      hasSmokeSwitch: true, tempPath: tmpdir(), tokenValue: 'a'.repeat(32) });
    expect(configuration.scenario).toBe('legacyInvoice');
    const reporter = createPackagedSmokeProgressReporter({ ...configuration, enabled: false });
    await reporter.reportStage('startup');
    await reporter.reportStage('backend');
    await expect(reporter.reportStage('emptyArtifactSnapshot')).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
    for (const stage of ['profileBackup', 'profileSnapshotMaintenance', 'profileSnapshotCreated',
      'profileSnapshotCaptured', 'profileBackupVerified', 'profileMutationCreated',
      'profileRestore', 'restoreRestart'] as const) await reporter.reportStage(stage);
    const restored = createPackagedSmokeProgressReporter({ ...configuration, enabled: false, phase: 'restoredProfile' });
    for (const stage of ['restoredStartup', 'restoreActivationJournalLoaded', 'restoredBackend',
      'restoredSessionValidated', 'profileComparison', 'secondBackup', 'shutdown'] as const) {
      await restored.reportStage(stage);
    }
    expect(restored.currentStage()).toBe('shutdown');
  });

  it('reports only the safe smoke code and stage in failure messages', () => {
    expect(
      createPackagedSmokeFailureMessage(
        {
          code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          stage: 'profileSnapshotMaintenance',
          status: 'failed',
        },
        1,
      ),
    ).toBe(
      'Packaged desktop smoke check failed (PROFILE_SNAPSHOT_BROKER_UNAVAILABLE, stage profileSnapshotMaintenance, process code 1).',
    );

    expect(
      createPackagedSmokeFailureMessage(
        {
          code: 'C:\\Users\\Example\\secret',
          stage: 'C:\\Users\\Example\\secret',
          status: 'failed',
        },
        null,
      ),
    ).toBe(
      'Packaged desktop smoke check failed (DESKTOP_SMOKE_FAILED, stage startup, process code null).',
    );
  });

  it('accepts only allowlisted result shapes', () => {
    expect(
      readPackagedSmokeResult({
        code: 'PACKAGED_SMOKE_FAILED',
        stage: 'backend',
        status: 'failed',
      }),
    ).toEqual({
      code: 'PACKAGED_SMOKE_FAILED',
      stage: 'backend',
      status: 'failed',
    });
    expect(
      readPackagedSmokeResult({
        code: 'raw path C:\\Users\\Example',
        stage: 'backend',
        status: 'failed',
      }),
    ).toBeUndefined();
    expect(
      readPackagedSmokeResult({
        electronVersion: '42.8.0',
        stage: 'shutdown',
        status: 'ok',
      }),
    ).toEqual({
      electronVersion: '42.8.0',
      stage: 'shutdown',
      status: 'ok',
    });
    expect(
      readPackagedSmokeResult({
        electronVersion: '^42.8.0',
        stage: 'shutdown',
        status: 'ok',
      }),
    ).toBeUndefined();
    expect(
      readPackagedSmokeResult({
        stage: 'backend',
        status: 'ok',
      }),
    ).toBeUndefined();
  });
});

describe('packaged selector smoke shutdown', () => {
  it('writes success and quits only after the original selector closes', async context => {
    const f = await selectorFixture(context);
    await f.run();
    expect(f.events).toEqual(['shutdown', 'close', 'destroy', 'quit']);
    expect(await readResult(f.root)).toEqual({ stage: 'shutdown', status: 'ok', electronVersion: '0.0.0' });
    expect(f.close).toHaveBeenCalledOnce();
  });

  it('rejects a premature quit at the actual result-read boundary', async context => {
    const f = await selectorFixture(context);
    expect(await readResult(f.root)).toEqual({ stage: 'startup', status: 'started' });
    expect(() => f.quit()).toThrow();
    expect(f.events).toEqual([]);
    expect(f.close).not.toHaveBeenCalled();
  });

  it.for(['report', 'close', 'both'] as const)('retains %s failure without accepting shutdown', async (variant, context) => {
    const f = await selectorFixture(context), first = new Error('SYNTHETIC_SMOKE_REPORT_FAILURE');
    const cleanup = new Error('SYNTHETIC_SMOKE_CLOSE_FAILURE');
    if (variant !== 'close') f.report.mockRejectedValueOnce(first);
    if (variant !== 'report') f.close.mockRejectedValueOnce(cleanup);
    const failure = await f.run().then(() => undefined, error => error);
    if (variant === 'both') {
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.errors).toEqual([first, cleanup]);
      expect(failure.cause).toBe(first);
    } else expect(failure).toBe(variant === 'report' ? first : cleanup);
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.destroy).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
    expect(await readResult(f.root)).toMatchObject({ status: 'started' });
  });

  it.for(['report', 'close'] as const)('does not mistake an undefined %s rejection for success', async (kind, context) => {
    const f = await selectorFixture(context);
    (kind === 'report' ? f.report : f.close).mockRejectedValueOnce(undefined);
    await expect(f.run()).rejects.toBeUndefined();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.destroy).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
    expect(await readResult(f.root)).toMatchObject({ status: 'started' });
  });

  it.for(['report', 'close'] as const)('joins held %s work before accepting the result', async (kind, context) => {
    const f = await selectorFixture(context);
    await duringSelectorWork(f, kind, async () => {
      if (kind === 'report') expect(f.close).not.toHaveBeenCalled();
      expect(f.destroy).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
      expect(await readResult(f.root)).toMatchObject({ status: 'started' });
    });
    expect(await readResult(f.root)).toMatchObject({ status: 'ok' });
  });

  it('captures original callbacks and configuration before awaiting reporting', async context => {
    const f = await selectorFixture(context);
    const otherClose = vi.fn(async () => {}), otherDestroy = vi.fn(), otherQuit = vi.fn();
    await duringSelectorWork(f, 'report', async () => {
      f.options.configuration = { ...f.options.configuration, phase: 'initial', root: join(f.root, 'wrong') };
      f.options.electronVersion = 'invalid';
      f.options.lifecycle = { shutdown: otherClose, applicationWindow: { destroy: otherDestroy } };
      f.options.quitApplication = otherQuit;
    });
    expect(f.close).toHaveBeenCalledOnce(); expect(f.destroy).toHaveBeenCalledOnce(); expect(f.quit).toHaveBeenCalledOnce();
    expect(otherClose).not.toHaveBeenCalled(); expect(otherDestroy).not.toHaveBeenCalled(); expect(otherQuit).not.toHaveBeenCalled();
    expect(await readResult(f.root)).toEqual({ stage: 'shutdown', status: 'ok', electronVersion: '0.0.0' });
  });

  it('does not publish success if the original window cannot be destroyed', async context => {
    const f = await selectorFixture(context), failure = new Error('SYNTHETIC_SMOKE_DESTROY_FAILURE');
    f.destroy.mockImplementationOnce(() => { throw failure; });
    await expect(f.run()).rejects.toBe(failure);
    expect(f.close).toHaveBeenCalledOnce(); expect(f.quit).not.toHaveBeenCalled();
    expect(await readResult(f.root)).toMatchObject({ status: 'started' });
  });

  it('does not quit when existing result validation fails', async context => {
    const f = await selectorFixture(context); f.options.electronVersion = 'invalid';
    await expect(f.run()).rejects.toThrow('DESKTOP_SMOKE_RESULT_INVALID');
    expect(f.close).toHaveBeenCalledOnce(); expect(f.destroy).toHaveBeenCalledOnce(); expect(f.quit).not.toHaveBeenCalled();
    expect(await readResult(f.root)).toMatchObject({ status: 'started' });
  });

  it.for(['disabled', 'phase', 'scenario', 'root', 'userData'] as const)('rejects %s before taking ownership of a lifecycle', async (variant, context) => {
    const f = await selectorFixture(context);
    f.options.configuration = { ...f.options.configuration,
      ...(variant === 'disabled' ? { enabled: false } : {}),
      ...(variant === 'phase' ? { phase: 'initial' as const } : {}),
      ...(variant === 'scenario' ? { scenario: 'legacyInvoice' as const } : {}),
      ...(variant === 'root' ? { root: undefined } : {}),
      ...(variant === 'userData' ? { userDataPath: join(f.root, 'wrong') } : {}),
    };
    await expect(f.run()).rejects.toThrow('DESKTOP_SMOKE_CONFIGURATION_INVALID');
    expect(f.report).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
    expect(f.destroy).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
  });

  it('ends a held-work test when the helper rejects before entering the held phase', async context => {
    const f = await selectorFixture(context), inspect = vi.fn(async () => {});
    f.options.configuration = { ...f.options.configuration, enabled: false };
    await expect(duringSelectorWork(f, 'report', inspect)).rejects.toThrow('DESKTOP_SMOKE_CONFIGURATION_INVALID');
    expect(inspect).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
  });

  it('retains the test first failure while joining a later close failure', async context => {
    const f = await selectorFixture(context), first = new Error('SYNTHETIC_SMOKE_TEST_FIRST');
    const cleanup = new Error('SYNTHETIC_SMOKE_TEST_CLOSE');
    f.close.mockRejectedValueOnce(cleanup);
    const failure = await duringSelectorWork(f, 'report', async () => { throw first; }).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([first, cleanup]); expect(failure.cause).toBe(first);
    expect(f.close).toHaveBeenCalledOnce(); expect(f.quit).not.toHaveBeenCalled();
  });
});

async function duringSelectorWork(
  f: Awaited<ReturnType<typeof selectorFixture>>, kind: 'report' | 'close', inspect: () => Promise<void>,
) {
  let enter!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  if (kind === 'report') f.report.mockImplementationOnce(async stage => { enter(); await held; await f.baseReport(stage); });
  else f.close.mockImplementationOnce(async () => { enter(); await held; });
  const outcome = f.run().then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
  let first: { error: unknown } | undefined;
  try {
    const reached = await Promise.race([entered.then(() => true as const), outcome]);
    if (reached !== true) throw reached.ok ? new Error('SELECTOR_SMOKE_ENDED_BEFORE_HELD_PHASE') : reached.error;
    await inspect();
  } catch (error) { first = { error }; }
  finally { finish(); }
  const settled = await outcome;
  if (first !== undefined) {
    if (!settled.ok && settled.error !== first.error) throw new AggregateError([first.error, settled.error],
      'SELECTOR_SMOKE_TEST_AND_CLOSE_FAILED', { cause: first.error });
    throw first.error;
  }
  if (!settled.ok) throw settled.error;
}

async function selectorFixture(context: TestContext) {
  const temporary = await mkdtemp(join(tmpdir(), 'eky-selector-smoke-contract-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass' && !context.signal.aborted) await rm(temporary, { recursive: true });
  });
  const configuration = createPackagedSmokeConfiguration({ hasSmokeSwitch: true,
    hasSelectorVerificationSwitch: true, tempPath: temporary, tokenValue: 'e'.repeat(32) });
  const reporter = createPackagedSmokeProgressReporter(configuration);
  await reporter.reportStage('startup');
  const events: string[] = [];
  const baseReport = async (stage: PackagedSmokeStage) => { events.push(stage); await reporter.reportStage(stage); };
  const report = vi.fn(baseReport), close = vi.fn(async () => { events.push('close'); });
  const destroy = vi.fn(() => { events.push('destroy'); });
  const quit = vi.fn(() => {
    const bytes = readFileSync(join(configuration.root!, 'result', 'desktop-smoke-result.json'), 'utf8');
    expect(readPackagedSmokeResult(JSON.parse(bytes))).toEqual({ stage: 'shutdown', status: 'ok', electronVersion: '0.0.0' });
    events.push('quit');
  });
  const options: Parameters<typeof runPackagedSelectorSmoke>[0] = { configuration, electronVersion: '0.0.0',
    lifecycle: { shutdown: close, applicationWindow: { destroy } }, reportStage: report, quitApplication: quit };
  return { options, root: configuration.root!, events, baseReport, report, close, destroy, quit,
    run: () => runPackagedSelectorSmoke(options) };
}

async function readResult(root: string | undefined) {
  if (root === undefined) {
    throw new Error('DESKTOP_SMOKE_TEST_ROOT_MISSING');
  }

  return JSON.parse(
    await readFile(
      join(root, 'result', 'desktop-smoke-result.json'),
      'utf8',
    ),
  ) as unknown;
}
