import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';

import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import { createDesktopOnlySupportBundleArchive, createSupportBundleArchive } from '../supportBundle/supportBundleArchive.js';
import type { SupportBundleDiagnosticEvent, SupportBundleIncidentSummary } from '../supportBundle/supportBundleBackendData.js';
import type { SupportBundleDesktopSystem } from '../supportBundle/supportBundleDesktopData.js';
import { writeSupportBundleAtomically } from '../supportBundle/supportBundleFileStore.js';
import {
  runPackagedSupportBundleSmoke,
  validateDesktopOnlySupportBundleDocument,
  validateSupportBundleDocument,
} from './packagedSupportBundleSmoke.js';
import { createSupportBundleSmokeFailureCapture } from './packagedSupportBundleSmokeTestSupport.js';

it('offers the original smoke failure before its public conversion even if the observer fails', async context => {
  const root = await mkdtemp(join(tmpdir(), 'eky-g-support-failure-'));
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await rm(root, { force: true, recursive: true });
  });
  const original = new Error('synthetic G4 original failure', { cause: new Error('synthetic G4 cause') });
  const observeFailure = vi.fn(() => { throw new Error('synthetic observer failure'); });
  const mainWindow = { webContents: { executeJavaScript: async () => { throw original; } } } as unknown as BrowserWindow;
  await expect(runPackagedSupportBundleSmoke({
    ...expectedIdentity, mainWindow, observeFailure, supportBundlePath: join(root, 'support.json.gz'),
  })).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  expect(observeFailure).toHaveBeenCalledExactlyOnceWith(original);
});

describe('support smoke file delivery', () => {
  it.for(['full', 'desktopOnly'] as const)('consumes and removes the real %s file without changing its neighbor', async (kind, context) => {
    const f = await supportSmokeFixture(context, kind);
    await runPackagedSupportBundleSmoke(f.options);
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0]?.[1]).toBe(true);
    if (kind === 'full') expect(f.execute).toHaveBeenCalledExactlyOnceWith('window.ekyDesktop.createSupportBundle()', true);
    else expect(f.execute.mock.calls[0]?.[0]).toContain('window.ekyDesktop.createSupportBundle()');
    expect(f.inspected()).toMatchObject({ formatVersion: kind === 'full' ? 2 : 3 });
    expect(f.observeFailure).not.toHaveBeenCalled();
    await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
  });

  it('does not infer the reader or fall back from a foreign wire format', async context => {
    const f = await supportSmokeFixture(context, 'desktopOnly');
    f.setDocument(createDocument());
    await expect(runPackagedSupportBundleSmoke(f.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.inspected()).toMatchObject({ formatVersion: 2 });
    expect(f.observeFailure).toHaveBeenCalledOnce();
    await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
  });

  it('rejects an unknown main-selected mode before invoking the bridge', async context => {
    const f = await supportSmokeFixture(context, 'desktopOnly');
    Object.assign(f.options, { kind: 'unknown', supportBundlePath: f.neighbor });
    await expect(runPackagedSupportBundleSmoke(f.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    expect(f.execute).not.toHaveBeenCalled();
    expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
  });

  it('captures the original identity and target before the export settles', async context => {
    const f = await supportSmokeFixture(context, 'desktopOnly');
    const write = f.execute.getMockImplementation()!;
    f.execute.mockImplementationOnce(async () => {
      const result = await write();
      if (f.options.kind !== 'desktopOnly') throw new Error('SYNTHETIC_MODE_MISSING');
      Object.assign(f.options.system, { buildRevision: 'b'.repeat(40) });
      Object.assign(f.options, { kind: 'full', supportBundlePath: f.neighbor });
      return result;
    });
    await runPackagedSupportBundleSmoke(f.options);
    await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
    expect(f.observeFailure).not.toHaveBeenCalled();
  });

  it('offers the original v3 export failure before its safe code and never retries', async context => {
    const f = await supportSmokeFixture(context, 'desktopOnly');
    const original = new Error('synthetic v3 export failure', { cause: new Error('synthetic v3 source cause') });
    f.execute.mockRejectedValueOnce(original);
    await expect(runPackagedSupportBundleSmoke(f.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    expect(f.observeFailure).toHaveBeenCalledExactlyOnceWith(original);
    expect(f.execute).toHaveBeenCalledOnce();
    await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
  });

  it.for(['full', 'desktopOnly'] as const)('retains the %s file failure when cleanup also fails', async (kind, context) => {
    const f = await supportSmokeFixture(context, kind);
    await mkdir(f.target, { recursive: true });
    const retainedPath = join(f.target, 'retained.txt');
    await writeFile(retainedPath, 'synthetic invalid export target');
    f.execute.mockResolvedValueOnce('created');
    const failure = await runPackagedSupportBundleSmoke(f.options).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toBe('DESKTOP_SMOKE_SUPPORT_BUNDLE_FILE_FAILED');
    expect(failure.cause).toBe(failure.errors[0]);
    expect(failure.errors[1].message).toBe('DESKTOP_SMOKE_SUPPORT_BUNDLE_CLEANUP_FAILED');
    expect(f.observeFailure).toHaveBeenCalledTimes(2);
    expect(f.observeFailure.mock.calls[0]?.[0]).toBe(failure.cause);
    expect(f.observeFailure.mock.calls[1]?.[0]).toBeInstanceOf(Error);
    expect(failure.errors[1]).not.toBe(f.observeFailure.mock.calls[1]?.[0]);
    expect(await readFile(retainedPath, 'utf8')).toBe('synthetic invalid export target');
    expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
  });
});

describe('selector support smoke readiness', () => {
  it('waits for the rendered support control before its one export request', async context => {
    const f = await supportSmokeFixture(context, 'desktopOnly');
    const button = { textContent: 'Luo tukipaketti', disabled: true };
    const renderer = selectorRenderer(f, [button], polls => {
      expect(renderer.request).not.toHaveBeenCalled();
      if (polls === 2) button.disabled = false;
    });
    await runPackagedSupportBundleSmoke(f.options);
    expect(renderer.polls()).toBe(2);
    expect(renderer.request).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.observeFailure).not.toHaveBeenCalled();
    expect(f.inspected()).toMatchObject({ formatVersion: 3 });
    await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.for(['missing', 'disabled', 'ambiguous'] as const)(
    'never exports through a %s selector control', async (state, context) => {
      const f = await supportSmokeFixture(context, 'desktopOnly');
      const button = { textContent: 'Luo tukipaketti', disabled: state === 'disabled' };
      const renderer = selectorRenderer(f, state === 'missing' ? [] : state === 'ambiguous' ? [button, { ...button }] : [button]);
      await expect(runPackagedSupportBundleSmoke(f.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_CREATE_FAILED');
      expect(renderer.request).not.toHaveBeenCalled();
      expect(f.execute).toHaveBeenCalledOnce();
      await expect(readFile(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(f.neighbor, 'utf8')).toBe('synthetic unrelated export');
    },
  );

  it('keeps a ready selector export failure first without retrying the request', async context => {
    const f = await supportSmokeFixture(context, 'desktopOnly');
    const renderer = selectorRenderer(f, [{ textContent: 'Luo tukipaketti', disabled: false }]);
    const original = new Error('synthetic selector export first failure');
    renderer.request.mockRejectedValueOnce(original);
    await expect(runPackagedSupportBundleSmoke(f.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    expect(renderer.request).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.observeFailure).toHaveBeenCalledExactlyOnceWith(original);
  });

  it('keeps the full support export independent of selector controls', async context => {
    const f = await supportSmokeFixture(context, 'full');
    const renderer = selectorRenderer(f, []);
    await runPackagedSupportBundleSmoke(f.options);
    expect(renderer.polls()).toBe(0);
    expect(renderer.request).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledExactlyOnceWith('window.ekyDesktop.createSupportBundle()', true);
    expect(f.inspected()).toMatchObject({ formatVersion: 2 });
  });
});

describe('support smoke exception capture', () => {
  it('records at most the first two values only after an unexpected failure', async context => {
    const f = captureFixture(context);
    const cleanup = new Error('synthetic cleanup'), ignored = new Error('synthetic later value');
    f.capture(undefined); f.capture(cleanup); f.capture(ignored);
    expect(f.sink.record).not.toHaveBeenCalled();
    await f.fail();
    expect(f.sink.record).toHaveBeenCalledTimes(2);
    expect(f.sink.record.mock.calls[0]?.[0]).toMatchObject({ runner: 'vitest', phase: 'supportBundleSmokeCatch',
      error: undefined, testName: context.task.fullTestName, testId: context.task.id,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    expect(f.sink.record.mock.calls[1]?.[0]).toMatchObject({ phase: 'supportBundleSmokeCleanupCatch', error: cleanup });
    expect(f.sink.flush).toHaveBeenCalledOnce();
  });

  it.for(['empty', 'expected'] as const)('does not deliver a %s failure', async (variant, context) => {
    const f = captureFixture(context, variant === 'expected');
    if (variant === 'expected') f.capture(new Error('synthetic expected exception'));
    await f.fail();
    expect(f.sink.record).not.toHaveBeenCalled(); expect(f.sink.flush).not.toHaveBeenCalled();
  });

  it.for(['record', 'flush'] as const)('does not throw when private %s fails', async (variant, context) => {
    const f = captureFixture(context);
    const original = new Error('synthetic original'), delivery = new Error('synthetic private delivery failure');
    if (variant === 'record') f.sink.record.mockImplementationOnce(() => { throw delivery; });
    else f.sink.flush.mockRejectedValueOnce(delivery);
    f.capture(original);
    await expect(f.fail()).resolves.toBeUndefined();
    expect(f.sink.record.mock.calls[0]?.[0].error).toBe(original);
  });

  it.for([{ retryCount: 1, repeatCount: 0 }, { retryCount: 0, repeatCount: 1 }])(
    'reads current retry/repeat counters without inventing an attempt: %j', async (counters, context) => {
      const f = captureFixture(context);
      f.capture(new Error('synthetic current attempt'));
      Object.assign(f.task, { result: { ...f.task.result, ...counters } });
      await f.fail();
      expect(f.sink.record.mock.calls[0]?.[0]).toMatchObject(counters);
      expect(Object.hasOwn(f.sink.record.mock.calls[0]![0], 'attempt')).toBe(false);
    },
  );
});

describe('validateSupportBundleDocument', () => {
  it('accepts a version 2 archive with matching identity and checksums', () => {
    const document = createDocument();

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).not.toThrow();
  });

  it('rejects checksum changes and forbidden personal metadata', () => {
    const document = createDocument();

    expect(() =>
      validateSupportBundleDocument(
        {
          ...document,
          database: {
            ...(document.database as Record<string, unknown>),
            appliedMigrationCount: 999,
          },
        },
        expectedIdentity,
      ),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_CHECKSUM_FAILED');

    expect(() =>
      validateSupportBundleDocument(
        {
          ...document,
          companyId: 'must-not-exist',
        },
        expectedIdentity,
      ),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('rejects an archive without the smoke security incident', () => {
    const document = createDocument([]);

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('rejects an archive without the current smoke diagnostic event', () => {
    const document = createDocument(undefined, []);

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('rejects a complete smoke source marked as diagnostic truncated', () => {
    const document = createDocument();
    (
      document.manifest as Record<string, unknown>
    ).truncatedSections = ['diagnosticEvents'];

    expect(() =>
      validateSupportBundleDocument(document, expectedIdentity),
    ).toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it.each([
    'invoicePdfArchive.queueFailed', 'invoicePdfArchive.copyFailed',
    'update.packageInspectionFailed', 'update.businessRollbackSucceeded',
    'workspaceManagement.operationFailed',
  ])('requires the G representative %s even with valid old sentinels', name => {
    const document = createDocument();
    document.diagnosticEvents = (document.diagnosticEvents as SupportBundleDiagnosticEvent[])
      .filter(event => event.eventName !== name);
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_G_EVIDENCE_FAILED');
  });

  it.each([
    ['invoicePdfArchive.queueFailed', { retryable: false }],
    ['invoicePdfArchive.copyFailed', { attemptCount: 1 }],
    ['invoicePdfArchive.copyFailed', { path: 'private-path' }],
    ['update.packageInspectionFailed', { stage: 'businessRollback' }],
    ['update.packageInspectionFailed', { targetVersion: '0.3.0' }],
    ['update.businessRollbackSucceeded', { outcome: 'failure' }],
    ['workspaceManagement.operationFailed', { operationId: 'workspace.create' }],
    ['workspaceManagement.operationFailed', { durationMs: '1' }],
    ['workspaceManagement.operationFailed', { companyId: 'private-company' }],
  ] as const)('rejects a checksum-correct invalid G event %s (%j)', (name, change) => {
    const document = createDocument();
    const events = document.diagnosticEvents as SupportBundleDiagnosticEvent[];
    // Keep all valid representatives: even an additional invalid G row must fail.
    events.push({ ...events.find(event => event.eventName === name)!, ...change } as SupportBundleDiagnosticEvent);
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });

  it.each([
    { count: 0 }, { runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    { eventName: 'workspaceManagement.unknown' }, { fingerprint: 'invented' },
    { errorCode: 'UNKNOWN_CODE' }, { outcome: 'unknown' },
  ])('rejects a checksum-correct invalid extra G incident (%j)', change => {
    const document = createDocument();
    const incidents = document.incidentSummaries as SupportBundleIncidentSummary[];
    incidents.push({ ...incidents.find(item => item.eventName === 'workspaceManagement.operationFailed')!, ...change } as SupportBundleIncidentSummary);
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity)).toThrow();
  });

  it('requires a G incident as well as the old minimized incident', () => {
    const document = createDocument();
    document.incidentSummaries = (document.incidentSummaries as SupportBundleIncidentSummary[])
      .filter(item => item.eventName === 'applicationWindow.newWindowBlocked');
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_G_EVIDENCE_FAILED');
  });

  it('rejects info in the support artifact even when all required events remain', () => {
    const document = createDocument();
    (document.diagnosticEvents as SupportBundleDiagnosticEvent[]).push({
      id: 'accepted', appVersion: expectedIdentity.appVersion,
      buildRevision: expectedIdentity.buildRevision, occurredAt: '2026-07-27T12:00:00.000Z',
      eventName: 'update.accepted', category: 'update', component: 'desktop',
      level: 'info', outcome: 'success', stage: 'firstStartValidation', errorCode: null,
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    refreshChecksums(document);
    expect(() => validateSupportBundleDocument(document, expectedIdentity))
      .toThrow('SUPPORT_BUNDLE_BACKEND_DATA_INVALID');
  });
});

describe('validateDesktopOnlySupportBundleDocument', () => {
  it.each(['unavailable', 'available'] as const)('accepts a v3 archive with an %s observation', status => {
    const document = createDesktopOnlyDocument(status);

    const result = validateDesktopOnlySupportBundleDocument(document, expectedDesktopIdentity);

    expect(result).toEqual({
      system: document.system, availability: document.availability, observation: document.observation,
    });
    expect(result.observation.status).toBe(status);
    expect(Object.keys(result)).toEqual(['system', 'availability', 'observation']);
  });

  it('rejects a valid v2 archive instead of treating it as desktop-only', () => {
    expect(() => validateDesktopOnlySupportBundleDocument(createDocument(), expectedDesktopIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('keeps a valid v3 archive outside the existing v2 reader', () => {
    expect(() => validateSupportBundleDocument(createDesktopOnlyDocument(), expectedIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it.each([
    ['supportBundleFormatVersion', '3'],
    ['kind', 'full'],
    ['createdAt', undefined],
    ['diagnosticPeriodDays', 30],
    ['createdAt', 'not-a-date'],
    ['createdAt', '2026-07-27T12:30:00Z'],
    ['creationCorrelationId', 'correlation-1'],
  ] as const)('rejects an invalid or excess v3 manifest field %s (%j)', (key, value) => {
    const document = createDesktopOnlyDocument();
    const manifest = document.manifest as Record<string, unknown>;
    if (value === undefined) delete manifest[key];
    else manifest[key] = value;

    expect(() => validateDesktopOnlySupportBundleDocument(document, expectedDesktopIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it.each(['missing', 'extra'] as const)('rejects a %s checksum key as an invalid manifest', change => {
    const document = createDesktopOnlyDocument();
    const manifest = document.manifest as Record<string, unknown>;
    const sums = manifest.sectionChecksums as Record<string, string>;
    if (change === 'missing') delete sums.observation;
    else sums.diagnosticEvents = '0'.repeat(64);

    expect(() => validateDesktopOnlySupportBundleDocument(document, expectedDesktopIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it.each(['database', 'diagnosticEvents'] as const)('rejects an additional v2 section %s', section => {
    const document = { ...createDesktopOnlyDocument(), [section]: [] };

    expect(() => validateDesktopOnlySupportBundleDocument(document, expectedDesktopIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it.each([
    ['appVersion', '0.1.0-alpha.2'],
    ['architecture', 'arm64'],
    ['buildRevision', 'bbbbbbb12345'],
    ['electronVersion', '43.8.1'],
    ['platform', 'linux'],
  ] as const)('rejects a trusted %s mismatch even with valid wire checksums', (key, value) => {
    const document = createDesktopOnlyDocument();

    expect(() => validateDesktopOnlySupportBundleDocument(document, { ...expectedDesktopIdentity, [key]: value }))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('rejects development even when the wire and trusted identity match', () => {
    const system = { ...expectedDesktopIdentity, buildRevision: 'development' };

    expect(() => validateDesktopOnlySupportBundleDocument(createDesktopOnlyDocument('unavailable', system), system))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  });

  it('accepts a matching seven-hex revision allowed by the build identity owner', () => {
    const system = { ...expectedDesktopIdentity, buildRevision: 'abcdef1' };

    expect(validateDesktopOnlySupportBundleDocument(createDesktopOnlyDocument('unavailable', system), system).system)
      .toEqual(system);
  });

  it('rejects a valid availability change without a matching wire checksum', () => {
    const document = createDesktopOnlyDocument();
    document.availability = { ...(document.availability as Record<string, unknown>), backend: 'notRunning' };

    expect(() => validateDesktopOnlySupportBundleDocument(document, expectedDesktopIdentity))
      .toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_CHECKSUM_FAILED');
  });

  it('checks the original wire key order rather than the projected section order', () => {
    const document = createDesktopOnlyDocument();
    const data = { system: document.system, availability: document.availability, observation: document.observation };
    for (const section of ['system', 'availability', 'observation'] as const) {
      document[section] = Object.fromEntries(Object.entries(document[section] as Record<string, unknown>).reverse());
    }
    refreshChecksums(document);

    expect(validateDesktopOnlySupportBundleDocument(document, expectedDesktopIdentity)).toEqual(data);
  });
});

const expectedIdentity = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: 'abcdef123456',
  runtimeSessionSecret: 'private-runtime-session',
};

const expectedDesktopIdentity: Readonly<SupportBundleDesktopSystem> = {
  appVersion: expectedIdentity.appVersion, buildRevision: expectedIdentity.buildRevision,
  architecture: 'x64', electronVersion: '42.7.0', platform: 'win32',
};

function captureFixture(context: TestContext, expected = false) {
  let report: () => unknown = () => { throw new Error('SYNTHETIC_FAILURE_HOOK_MISSING'); };
  const selected = { task: { ...context.task, result: { ...context.task.result }, fails: expected },
    onTestFailed(callback: () => unknown) { report = callback; } } as unknown as TestContext;
  const sink = { record: vi.fn<(input: { error: unknown }) => void>(), flush: vi.fn(async () => ({ status: 'recorded' })) };
  const capture = createSupportBundleSmokeFailureCapture(selected, sink);
  return { capture, sink, task: selected.task, fail: async () => { await report(); } };
}

async function supportSmokeFixture(context: TestContext, kind: 'full' | 'desktopOnly') {
  const root = await mkdtemp(join(tmpdir(), 'eky-support-smoke-file-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass' && !context.signal.aborted) await rm(root, { recursive: true });
  });
  const runtimeRoot = join(root, 'runtime'), target = join(root, 'export', 'support.json.gz');
  const neighbor = join(root, 'neighbor.txt');
  await mkdir(runtimeRoot);
  await writeFile(neighbor, 'synthetic unrelated export');
  let document = kind === 'full' ? createDocument() : createDesktopOnlyDocument();
  let inspected: unknown;
  const execute = vi.fn<(source?: string, userGesture?: boolean) => Promise<unknown>>(async () => {
    const archive = gzipSync(JSON.stringify(document));
    writeSupportBundleAtomically({ archive, runtimeRoot, targetPath: target });
    expect(await readFile(target)).toEqual(archive);
    const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
    inspected = inspector.inspectSupportBundle(target).summary;
    return 'created';
  });
  const mainWindow = { webContents: { executeJavaScript: execute } } as unknown as BrowserWindow;
  const observeFailure = vi.fn(createSupportBundleSmokeFailureCapture(context));
  const common = { mainWindow, observeFailure, supportBundlePath: target };
  const options: Parameters<typeof runPackagedSupportBundleSmoke>[0] = kind === 'full'
    ? { ...common, ...expectedIdentity }
    : { ...common, kind, system: { ...expectedDesktopIdentity } };
  return { options, execute, observeFailure, target, neighbor,
    setDocument(value: Record<string, unknown>) { document = value; }, inspected: () => inspected };
}

function selectorRenderer(
  fixture: Awaited<ReturnType<typeof supportSmokeFixture>>,
  buttons: { textContent: string; disabled: boolean }[],
  onPoll?: (polls: number) => void,
) {
  const write = fixture.execute.getMockImplementation()!;
  let clock = 0, polls = 0;
  const request = vi.fn(async () => write());
  fixture.execute.mockImplementation(async source => {
    if (typeof source !== 'string') throw new Error('SYNTHETIC_SELECTOR_SCRIPT_MISSING');
    return await runInNewContext(source, {
      window: { ekyDesktop: { createSupportBundle: request } },
      document: { querySelectorAll: () => buttons }, Date: { now: () => clock },
      setTimeout(resolve: () => void, delay: number) {
        clock += delay; polls += 1;
        if (polls > 101) throw new Error('SYNTHETIC_SELECTOR_READINESS_UNBOUNDED');
        onPoll?.(polls); resolve();
      },
    });
  });
  return { request, polls: () => polls };
}

function createDesktopOnlyDocument(
  status: 'unavailable' | 'available' = 'unavailable',
  system: Readonly<SupportBundleDesktopSystem> = expectedDesktopIdentity,
): Record<string, unknown> {
  const archive = createDesktopOnlySupportBundleArchive({
    createdAt: new Date('2026-07-27T12:30:00.000Z'),
    creationCorrelationId: '22222222-2222-4222-8222-222222222222',
    desktopData: {
      system,
      availability: {
        backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected',
      },
      observation: status === 'unavailable' ? { scope: 'currentOperation', status } : {
        scope: 'currentOperation', status, cleanupError: null,
        firstError: createDesktopOperationalEvent({
          eventName: 'workspaceManagement.operationFailed',
          correlationId: '33333333-3333-4333-8333-333333333333',
          durationMs: 1, errorCode: 'WORKSPACE_DELETE_IO_FAILED', operationId: 'workspace.deleteResume',
          retryable: false, sideEffectState: 'unknown', stage: 'deletePurge',
        }, {
          appVersion: system.appVersion, buildRevision: system.buildRevision,
          runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
          eventId: '44444444-4444-4444-8444-444444444444', timestamp: '2026-07-27T12:00:00.000Z',
        }),
      },
    },
  });
  return JSON.parse(gunzipSync(archive.compressed).toString('utf8')) as Record<string, unknown>;
}

function createDocument(
  incidentSummaries: SupportBundleIncidentSummary[] = [
    {
      appVersion: expectedIdentity.appVersion,
      buildRevision: expectedIdentity.buildRevision,
      count: 1,
      errorCode: 'DESKTOP_SECURITY_EVENT_BLOCKED',
      eventName: 'applicationWindow.newWindowBlocked',
      fingerprint:
        'applicationWindow.newWindowBlocked:DESKTOP_SECURITY_EVENT_BLOCKED',
      firstOccurredAt: '2026-07-27T12:00:00.000Z',
      lastOccurredAt: '2026-07-27T12:00:00.000Z',
      outcome: 'blocked' as const,
    },
    ...gEvents().filter(event => event.level === 'error').map(event => ({
      appVersion: expectedIdentity.appVersion, buildRevision: expectedIdentity.buildRevision,
      count: 1, errorCode: event.errorCode!, eventName: event.eventName,
      fingerprint: `${event.eventName}:${event.errorCode}`,
      firstOccurredAt: event.occurredAt, lastOccurredAt: event.occurredAt, outcome: 'failure' as const,
    })),
  ],
  diagnosticEvents: SupportBundleDiagnosticEvent[] = [
    {
      appVersion: expectedIdentity.appVersion,
      buildRevision: expectedIdentity.buildRevision,
      category: 'security',
      component: 'desktop' as const,
      errorCode: null,
      eventName: 'applicationWindow.newWindowBlocked',
      id: 'desktop-smoke-security-event',
      level: 'warn' as const,
      occurredAt: '2026-07-27T12:00:00.000Z',
      outcome: 'blocked' as const,
      stage: 'window-open',
    },
    ...gEvents(),
  ],
): Record<string, unknown> {
  const archive = createSupportBundleArchive({
    appVersion: expectedIdentity.appVersion,
    architecture: 'x64',
    backendData: {
      backendVersion: expectedIdentity.appVersion,
      database: {
        appliedMigrationCount: 35,
        health: 'ok',
        latestMigrationName: '035_example.sql',
      },
      diagnosticEvents,
      diagnosticPeriodDays: 30,
      incidentSummaries,
      incidentSummariesTruncated: false,
      runtimeSummary: {
        appVersion: expectedIdentity.appVersion,
        appliedMigrationCount: 35,
        architecture: 'x64',
        buildCreatedAt: '2026-07-27T10:00:00.000Z',
        buildDirty: false,
        buildRevision: expectedIdentity.buildRevision,
        databaseHealth: 'ok',
        electronVersion: '42.7.0',
        latestErrorAt: null,
        latestMigrationName: '035_example.sql',
        latestSecurityEventAt: null,
        latestWarningAt: null,
        nodeVersion: 'v24.11.0',
        operationalLogNewestMonth: null,
        operationalLogOldestMonth: null,
        operationalLogsAvailable: false,
        operationalLogTotalBytes: 0,
        platform: 'win32',
        runtimeInstanceId:
          'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      },
      truncated: false,
    },
    createdAt: new Date('2026-07-27T12:30:00.000Z'),
    creationCorrelationId: 'correlation-1',
    platform: 'win32',
  });

  return JSON.parse(
    gunzipSync(archive.compressed).toString('utf8'),
  ) as Record<string, unknown>;
}

function gEvents(): SupportBundleDiagnosticEvent[] {
  const common = {
    appVersion: expectedIdentity.appVersion, buildRevision: expectedIdentity.buildRevision,
    occurredAt: '2026-07-27T12:00:00.000Z', outcome: 'failure' as const,
  };
  return [
    { ...common, id: 'queue', eventName: 'invoicePdfArchive.queueFailed', category: 'invoicePdfArchive',
      component: 'backend', level: 'warn', errorCode: 'INVOICE_PDF_ARCHIVE_QUEUE_FAILED',
      stage: 'queue', retryable: true, sideEffectState: 'none' },
    { ...common, id: 'copy', eventName: 'invoicePdfArchive.copyFailed', category: 'invoicePdfArchive',
      component: 'desktop', level: 'warn', errorCode: 'INVOICE_PDF_ARCHIVE_WRITE_FAILED',
      durationMs: 1, retryable: true, sideEffectState: 'none' },
    { ...common, id: 'update', eventName: 'update.packageInspectionFailed', category: 'update',
      component: 'desktop', level: 'error', errorCode: 'UPDATE_PACKAGE_INVALID',
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', stage: 'packageInspection',
      durationMs: 1, retryable: false, sideEffectState: 'none' },
    { ...common, id: 'rollback', eventName: 'update.businessRollbackSucceeded', category: 'update',
      component: 'desktop', level: 'warn', outcome: 'success', errorCode: null,
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', stage: 'businessRollback', durationMs: 1 },
    { ...common, id: 'lineage', eventName: 'workspaceManagement.operationFailed', category: 'workspaceManagement',
      component: 'desktop', level: 'error', errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
      correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', operationId: 'workspace.replace',
      stage: 'lineageCheck', durationMs: 1, retryable: false, sideEffectState: 'none' },
  ];
}

function refreshChecksums(document: Record<string, unknown>): void {
  const manifest = document.manifest as Record<string, unknown>;
  const sums = manifest.sectionChecksums as Record<string, string>;
  for (const name of Object.keys(sums)) {
    sums[name] = createHash('sha256').update(JSON.stringify(document[name])).digest('hex');
  }
}
