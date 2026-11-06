import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi, type TestContext } from 'vitest';

import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import { workspaceDeletionFailureCodes } from '../observability/workspaceManagementFailureContext.js';
import { createDesktopOnlySupportBundleArchive } from './supportBundleArchive.js';
import { readSupportBundleDesktopData } from './supportBundleDesktopData.js';
import { writeSupportBundleAtomically } from './supportBundleFileStore.js';

const identity = { appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111' };
const correlationId = '22222222-2222-4222-8222-222222222222';
const createdAt = new Date('2026-11-06T10:00:00.000Z');

describe('desktop-only support projection', () => {
  it('keeps unavailable data explicit and freezes a detached projection', () => {
    const input = data();
    const result = readSupportBundleDesktopData(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    for (const section of [result, result.system, result.availability, result.observation]) expect(Object.isFrozen(section)).toBe(true);
    input.system.appVersion = '9.9.9';
    expect(result.system.appVersion).toBe(identity.appVersion);
    expect(JSON.stringify(result)).not.toMatch(/backendVersion|health|count|databasePath|workspaceId|profileId|lineage|password/i);
  });

  it.each(['notRunning', 'exitUnconfirmed'])(
    'accepts backend metadata %s without treating it as authority', (backend) => {
      expect(readSupportBundleDesktopData({ ...data(), availability: { ...data().availability, backend } }).availability.backend).toBe(backend);
    },
  );

  it.each(['win32', 'linux', 'darwin'])(
    'validates metadata for %s without adding a runtime capability', (platform) => {
      for (const architecture of ['x64', 'arm64']) {
        expect(readSupportBundleDesktopData({ ...data(), system: { ...data().system, architecture, platform } }).system)
          .toMatchObject({ architecture, platform });
      }
    },
  );

  it('preserves the current explicit development identity, not a missing build fallback', () => {
    expect(readSupportBundleDesktopData({ ...data(), system: { ...data().system, buildRevision: 'development' } }).system.buildRevision)
      .toBe('development');
  });

  it.each(workspaceDeletionFailureCodes)('uses the existing safe deletion code %s', (errorCode) => {
    for (const operationId of ['workspace.delete', 'workspace.deleteResume'] as const) {
      const firstError = managementFailure({ errorCode, operationId, stage: 'deletePurge' });
      const result = readSupportBundleDesktopData(data({ scope: 'currentOperation', status: 'available', firstError, cleanupError: null }));
      if (result.observation.status !== 'available') throw new Error('SAFE_OBSERVATION_MISSING');
      expect(result.observation.firstError).toEqual(firstError);
      expect(result.observation.firstError).not.toBe(firstError);
      expect(Object.isFrozen(result.observation.firstError)).toBe(true);
    }
  });

  it('keeps primary and cleanup failures distinct, including cleanup without a primary', () => {
    const firstError = managementFailure();
    const cleanupError = managementFailure({ errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', stage: 'deleteCleanup' });
    for (const primary of [firstError, null]) {
      expect(readSupportBundleDesktopData(data({ scope: 'currentOperation', status: 'available', firstError: primary, cleanupError })).observation)
        .toEqual({ scope: 'currentOperation', status: 'available', firstError: primary, cleanupError });
    }
  });

  it.each(['import', 'replace'] as const)('accepts the current %s observer families for one operation', (stage) => {
    const firstError = backupFailure('workspaceBackup.operationFailed', stage);
    const cleanupError = backupFailure('workspaceBackup.cleanupFailed', stage);
    const management = managementFailure({ errorCode: stage === 'import' ? 'WORKSPACE_MANAGEMENT_IMPORT_FAILED' : 'WORKSPACE_MANAGEMENT_REPLACE_FAILED',
      operationId: stage === 'import' ? 'workspace.import' : 'workspace.replace', stage: 'operation' });
    for (const primary of [firstError, management]) {
      expect(readSupportBundleDesktopData(data({ scope: 'currentOperation', status: 'available', firstError: primary, cleanupError })).observation)
        .toEqual({ scope: 'currentOperation', status: 'available', firstError: primary, cleanupError });
    }
  });

  it.each([
    ['appVersion', undefined], ['appVersion', '0.2'], ['appVersion', ' 0.2.81'], ['appVersion', '1.0.0+' + 'x'.repeat(100)],
    ['electronVersion', null], ['electronVersion', 'private text'], ['buildRevision', ''], ['buildRevision', 'a'.repeat(41)],
    ['buildRevision', 'DEVELOPMENT'], ['platform', 'win32\nprivate'], ['platform', 'other'], ['architecture', 'ia32'],
    ['backendVersion', '1.0.0'], ['databasePath', 'C:\\private\\workspace.sqlite'],
  ])('rejects invalid or excess system field %s %#', (key, value) => {
    expectInvalid({ ...data(), system: { ...data().system, [key as string]: value } });
  });

  it.each([
    ['backend', 'running'], ['backend', false], ['database', 'healthy'], ['database', null],
    ['diagnosticHistory', 'collected'], ['incidentHistory', []], ['count', 0],
  ])('rejects invented availability %s %#', (key, value) => {
    expectInvalid({ ...data(), availability: { ...data().availability, [key as string]: value } });
  });

  it.each([
    undefined, null, [], {}, { scope: 'currentOperation', status: 'available', firstError: null, cleanupError: null },
    { scope: 'history', status: 'unavailable' }, { scope: 'currentOperation', status: 'unavailable', firstError: null },
    { scope: 'currentOperation', status: 'unavailable', events: [] },
  ])('rejects missing, historical or contradictory observations %#', (observation) => {
    expectInvalid({ ...data(), observation });
  });

  it.each([
    { errorCode: 'WORKSPACE_DELETE_UNKNOWN' }, { errorCode: 'WORKSPACE_DELETE_IO_FAILED private detail' },
    { durationMs: -1 }, { durationMs: 0.5 }, { retryable: true }, { sideEffectState: 'none' },
    { eventId: 'private-original-id' }, { timestamp: '2026-11-06T10:00:00Z' },
    { appVersion: '0.2.80' }, { buildRevision: 'b'.repeat(40) }, { stage: 'unknown' },
    { message: 'synthetic private message' }, { cause: new Error('synthetic cause') }, { workspaceId: correlationId },
    { errorCode: '\nWORKSPACE_DELETE_IO_FAILED' },
  ])('rejects unsafe or silently normalized event data %#', (patch) => {
    expectInvalid(data({ scope: 'currentOperation', status: 'available', firstError: { ...managementFailure(), ...patch }, cleanupError: null }));
  });

  it.each([
    { correlationId: '33333333-3333-4333-8333-333333333333' },
    { runtimeInstanceId: '33333333-3333-4333-8333-333333333333' },
    { operationId: 'workspace.delete' }, { errorCode: 'WORKSPACE_DELETE_IO_FAILED' },
  ])('rejects a cleanup from another operation or role %#', (patch) => {
    expectInvalid(data({ scope: 'currentOperation', status: 'available', firstError: managementFailure(),
      cleanupError: { ...managementFailure({ errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', stage: 'deleteCleanup' }), ...patch } }));
  });

  it('rejects swapped roles and duplicated event identities', () => {
    const firstError = managementFailure();
    const cleanupError = managementFailure({ errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', stage: 'deleteCleanup' });
    expectInvalid(data({ scope: 'currentOperation', status: 'available', firstError: cleanupError, cleanupError: firstError }));
    expectInvalid(data({ scope: 'currentOperation', status: 'available', firstError, cleanupError: { ...cleanupError, eventId: firstError.eventId } }));
  });

  it.each(['root', 'system', 'availability', 'observation', 'event'] as const)(
    'rejects accessors in %s without invoking them', (section) => {
      const firstError = { ...managementFailure() };
      const input = data({ scope: 'currentOperation', status: 'available', firstError, cleanupError: null });
      const getter = vi.fn(() => { throw new Error('synthetic accessor must not run'); });
      const targets = { root: [input, 'system'], system: [input.system, 'appVersion'],
        availability: [input.availability, 'backend'], observation: [input.observation, 'status'], event: [firstError, 'errorCode'] } as const;
      const [target, key] = targets[section];
      Object.defineProperty(target, key, { get: getter });
      expectInvalid(input);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('rejects inherited, hidden, symbol and proxy fields with a safe fixed error', () => {
    const input = data();
    for (const value of [Object.assign(Object.create({ privateField: true }), input),
      Object.defineProperty({ ...input }, 'privateField', { value: true }), { ...input, [Symbol('private')]: true },
      new Proxy({}, { getPrototypeOf() { throw new Error('synthetic private trap'); } })]) expectInvalid(value);
  });
});

describe('desktop-only support archive', () => {
  it('creates only three independent v3 sections with checksums of their exact bytes', () => {
    const archive = createDesktopOnlySupportBundleArchive({ desktopData: data(), createdAt, creationCorrelationId: correlationId });
    const document = JSON.parse(gunzipSync(archive.compressed).toString('utf8')) as {
      manifest: { sectionChecksums: Record<string, string> }; [key: string]: unknown };
    expect(archive.fileName).toBe('eky-support-2026-11-06.json.gz');
    expect(Object.keys(document)).toEqual(['manifest', 'system', 'availability', 'observation']);
    expect(document.manifest).toEqual({ supportBundleFormatVersion: 3, kind: 'desktopOnly',
      createdAt: createdAt.toISOString(), creationCorrelationId: correlationId,
      sectionChecksums: expect.any(Object) });
    expect(Object.keys(document.manifest.sectionChecksums)).toEqual(['system', 'availability', 'observation']);
    for (const section of ['system', 'availability', 'observation']) {
      expect(document.manifest.sectionChecksums[section]).toBe(createHash('sha256').update(JSON.stringify(document[section])).digest('hex'));
    }
    expect(document).not.toHaveProperty('database');
    expect(document).not.toHaveProperty('diagnosticEvents');
    expect(document).not.toHaveProperty('incidentSummaries');
  });

  it.each([new Date(Number.NaN), '2026-11-06', {}])('rejects an invalid creation date %#', (date) => {
    expect(() => createDesktopOnlySupportBundleArchive({ desktopData: data(), createdAt: date as Date }))
      .toThrow('SUPPORT_BUNDLE_DESKTOP_DATA_INVALID');
  });

  it.each(['private-id', 1, { toString: () => correlationId }])('rejects an invalid creation identifier %#', (id) => {
    expect(() => createDesktopOnlySupportBundleArchive({ desktopData: data(), creationCorrelationId: id as string }))
      .toThrow('SUPPORT_BUNDLE_DESKTOP_DATA_INVALID');
  });
});

describe('desktop-only support file and official reader', () => {
  for (const status of ['unavailable', 'available'] as const) {
    it(`roundtrips ${status} through the real writer and official reader`, async (context) => {
    const root = retainedRoot(context);
    const runtimeRoot = join(root, 'runtime');
    mkdirSync(runtimeRoot);
    const targetPath = join(root, 'support.json.gz');
    const neighborPath = join(root, 'neighbor.txt');
    const neighbor = Buffer.from('synthetic unrelated export');
    writeFileSync(neighborPath, neighbor);
    const observation = status === 'unavailable' ? { scope: 'currentOperation', status } : {
      scope: 'currentOperation', status, firstError: managementFailure(),
      cleanupError: managementFailure({ errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', stage: 'deleteCleanup' }),
    };
    const archive = createDesktopOnlySupportBundleArchive({ desktopData: data(observation), createdAt, creationCorrelationId: correlationId });
    writeSupportBundleAtomically({ archive: archive.compressed, runtimeRoot, targetPath });
    const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
    const inspected = inspector.inspectSupportBundle(targetPath);
    expect(readFileSync(targetPath)).toEqual(archive.compressed);
    expect(inspected.document).toEqual(JSON.parse(gunzipSync(archive.compressed).toString('utf8')));
    expect(inspected.summary).toMatchObject({ formatVersion: 3, kind: 'desktopOnly', backend: 'exitUnconfirmed',
      database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected', observationStatus: status });
    expect(inspected.summary).not.toHaveProperty('appliedMigrationCount');
    expect(inspected.summary).not.toHaveProperty('diagnosticEventCount');
    expect(inspected.summary).not.toHaveProperty('incidentSummaryCount');
    const output = inspector.formatSupportBundleSummary(inspected.summary);
    expect(output).toContain('notInspected');
    expect(output).toContain('notCollected');
    expect(output).toContain(status);
    expect(output).not.toMatch(/Migraatioita:|Diagnostiikkatapahtumia:|Incident-yhteenvetoja:/);
    const jsonPath = join(root, 'inspected.json');
    inspector.writeSupportBundleJson(inspected.document, jsonPath);
    const reread = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(reread).toEqual(inspected.document);
    writeFileSync(join(root, 'roundtrip.ekysupport'), gzipSync(JSON.stringify(reread)));
    expect(inspector.inspectSupportBundle(join(root, 'roundtrip.ekysupport')).document).toEqual(inspected.document);
    expect(readdirSync(join(runtimeRoot, 'support-bundles', 'temporary'))).toEqual([]);
    expect(readdirSync(root).filter(name => name.endsWith('.next'))).toEqual([]);
    expect(readFileSync(neighborPath)).toEqual(neighbor);
    });
  }

  for (const [index, patch] of [
    { eventId: 'not-a-safe-uuid' }, { errorCode: 'WORKSPACE_DELETE_UNKNOWN' },
    { message: 'synthetic private original' }, { timestamp: '2026-11-06T10:00:00Z' },
    { buildRevision: 'b'.repeat(40) }, { stage: 'deleteCleanup' }, { durationMs: -1 },
    { operationId: 'workspace.import' }, { retryable: true }, { sideEffectState: 'none' },
    { operationId: 'workspace.create', stage: 'operation', errorCode: ['WORKSPACE_MANAGEMENT_CREATE_FAILED'] },
  ].entries()) {
    it(`rejects the same unsafe event on both runtime and wire boundaries ${index}`, async (context) => {
    const root = retainedRoot(context);
    const input = data({ scope: 'currentOperation', status: 'available',
      firstError: { ...managementFailure(), ...patch }, cleanupError: null });
    expectInvalid(input);
    const document = JSON.parse(gunzipSync(createDesktopOnlySupportBundleArchive({ desktopData: data(), createdAt,
      creationCorrelationId: correlationId }).compressed).toString('utf8'));
    document.observation = input.observation;
    document.manifest.sectionChecksums.observation = createHash('sha256').update(JSON.stringify(document.observation)).digest('hex');
    const path = join(root, 'invalid.json.gz');
    writeFileSync(path, gzipSync(JSON.stringify(document)));
    const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
    expect(() => inspector.inspectSupportBundle(path)).toThrow('SUPPORT_BUNDLE_JSON_INVALID');
    });
  }

  it('keeps valid wire key order and catches altered section bytes independently of schema', async (context) => {
    const root = retainedRoot(context);
    const archive = createDesktopOnlySupportBundleArchive({ desktopData: data(), createdAt, creationCorrelationId: correlationId });
    const document = JSON.parse(gunzipSync(archive.compressed).toString('utf8'));
    document.system = Object.fromEntries(Object.entries(document.system).reverse());
    document.manifest.sectionChecksums.system = createHash('sha256').update(JSON.stringify(document.system)).digest('hex');
    const path = join(root, 'ordered.json.gz');
    writeFileSync(path, gzipSync(JSON.stringify(document)));
    const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
    const inspected = inspector.inspectSupportBundle(path);
    expect(Object.keys(inspected.document.system)).toEqual(Object.keys(document.system));
    const replay = join(root, 'replay.json.gz');
    writeFileSync(replay, gzipSync(JSON.stringify(inspected.document)));
    expect(inspector.inspectSupportBundle(replay).document).toEqual(document);
    document.availability.backend = 'notRunning';
    writeFileSync(path, gzipSync(JSON.stringify(document)));
    expect(() => inspector.inspectSupportBundle(path)).toThrow('SUPPORT_BUNDLE_CHECKSUM_FAILED');
  });
});

function retainedRoot(context: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-support-bundle-'));
  context.onTestFinished(({ task }) => {
    if (task.result?.state === 'pass' && !context.signal.aborted) rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function data(observation: unknown = { scope: 'currentOperation', status: 'unavailable' }) {
  return { system: { appVersion: identity.appVersion, architecture: 'x64', buildRevision: identity.buildRevision,
    electronVersion: '43.8.1', platform: 'win32' },
  availability: { backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
  observation };
}

function managementFailure(options: { errorCode?: string; operationId?: 'workspace.delete' | 'workspace.deleteResume' | 'workspace.import' | 'workspace.replace';
  stage?: 'deletePurge' | 'deleteCleanup' | 'operation' } = {}) {
  const errorCode = options.errorCode ?? 'WORKSPACE_DELETE_IO_FAILED';
  return createDesktopOperationalEvent({ eventName: 'workspaceManagement.operationFailed', correlationId,
    durationMs: 1, errorCode, operationId: options.operationId ?? 'workspace.deleteResume',
    retryable: errorCode === 'WORKSPACE_MANAGEMENT_BUSY', sideEffectState: 'unknown', stage: options.stage ?? 'deletePurge' },
  { ...identity, timestamp: createdAt.toISOString() });
}

function backupFailure(eventName: 'workspaceBackup.operationFailed' | 'workspaceBackup.cleanupFailed', stage: 'import' | 'replace') {
  return createDesktopOperationalEvent({ eventName, correlationId, durationMs: 1, errorCode: 'WORKSPACE_CANDIDATE_DATABASE_INVALID',
    retryable: false, sideEffectState: 'unknown', stage }, { ...identity, timestamp: createdAt.toISOString() });
}

function expectInvalid(value: unknown) {
  expect(() => readSupportBundleDesktopData(value)).toThrow('SUPPORT_BUNDLE_DESKTOP_DATA_INVALID');
}
