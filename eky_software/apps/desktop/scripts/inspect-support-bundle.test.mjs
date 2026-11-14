import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  formatSupportBundleSummary,
  inspectSupportBundle,
  runSupportBundleInspectorCli,
  supportBundleInspectorErrorCodes,
  supportBundleInspectorExitCodes,
  writeSupportBundleJson,
} from './inspect-support-bundle.mjs';

const roots = [];

test.afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test('inspects a valid v2 .json.gz support bundle without exposing event content', () => {
  const fixture = createFixture();
  const result = inspectSupportBundle(fixture.sourcePath);

  assert.deepEqual(result.summary, {
    appVersion: '0.1.0-alpha.1',
    appliedMigrationCount: 42,
    buildRevision: 'abcdef123456',
    createdAt: '2026-07-28T18:00:00.000Z',
    databaseHealth: 'ok',
    diagnosticEventCount: 1,
    formatVersion: 2,
    incidentSummaryCount: 1,
    latestMigrationName: '042_example.sql',
    truncatedSections: [],
  });

  const output = createOutputCapture();
  assert.equal(
    runSupportBundleInspectorCli(
      ['--', fixture.sourcePath],
      output,
    ),
    0,
  );
  assert.match(output.lines.join('\n'), /Checksumit: kunnossa/);
  assert.doesNotMatch(output.lines.join('\n'), /SMTP_TLS_FAILED/);
});

test('accepts current .json.gz and legacy .ekysupport archives by content', () => {
  const current = createFixture();
  const legacy = createFixture(
    () => {},
    {
      fileName: 'fixture.ekysupport',
      refreshChecksums: true,
    },
  );

  assert.equal(
    inspectSupportBundle(current.sourcePath).summary.formatVersion,
    2,
  );
  assert.equal(
    inspectSupportBundle(legacy.sourcePath).summary.formatVersion,
    2,
  );
});

test('rejects a support bundle with a mismatching section checksum', () => {
  const fixture = createFixture((document) => {
    document.database.appliedMigrationCount = 43;
  }, { refreshChecksums: false });

  assertInspectorError(
    () => inspectSupportBundle(fixture.sourcePath),
    supportBundleInspectorErrorCodes.checksumFailed,
  );
});

test('rejects an unsupported support bundle format', () => {
  const fixture = createFixture((document) => {
    document.manifest.supportBundleFormatVersion = 3;
  }, { refreshChecksums: false });

  assertInspectorError(
    () => inspectSupportBundle(fixture.sourcePath),
    supportBundleInspectorErrorCodes.formatUnsupported,
  );
});

test('rejects malformed gzip and malformed JSON with stable safe codes', () => {
  const root = createRoot();
  const invalidGzipPath = join(root, 'invalid-gzip.ekysupport');
  const invalidJsonPath = join(root, 'invalid-json.ekysupport');
  writeFileSync(invalidGzipPath, 'not gzip', 'utf8');
  writeFileSync(invalidJsonPath, gzipSync(Buffer.from('{', 'utf8')));

  assertInspectorError(
    () => inspectSupportBundle(invalidGzipPath),
    supportBundleInspectorErrorCodes.gzipInvalid,
  );
  assertInspectorError(
    () => inspectSupportBundle(invalidJsonPath),
    supportBundleInspectorErrorCodes.jsonInvalid,
  );
});

test('rejects support bundles exceeding the 25 MiB uncompressed limit', () => {
  const root = createRoot();
  const sourcePath = join(root, 'too-large.ekysupport');
  writeFileSync(
    sourcePath,
    gzipSync(Buffer.alloc(25 * 1024 * 1024 + 1, 0)),
  );

  assertInspectorError(
    () => inspectSupportBundle(sourcePath),
    supportBundleInspectorErrorCodes.tooLarge,
  );
});

test('rejects missing and extra top-level sections', () => {
  const missing = createFixture((document) => {
    delete document.incidentSummaries;
  }, { refreshChecksums: false });
  const extra = createFixture((document) => {
    document.privateSection = { value: 'not allowed' };
  }, { refreshChecksums: false });

  assertInspectorError(
    () => inspectSupportBundle(missing.sourcePath),
    supportBundleInspectorErrorCodes.jsonInvalid,
  );
  assertInspectorError(
    () => inspectSupportBundle(extra.sourcePath),
    supportBundleInspectorErrorCodes.jsonInvalid,
  );
});

test('reports truncated sections in the safe summary', () => {
  const fixture = createFixture((document) => {
    document.manifest.truncatedSections = [
      'diagnosticEvents',
      'incidentSummaries',
    ];
  });

  assert.deepEqual(
    inspectSupportBundle(fixture.sourcePath).summary
      .truncatedSections,
    ['diagnosticEvents', 'incidentSummaries'],
  );
});

test('does not overwrite a JSON output unless force is explicit', () => {
  const fixture = createFixture();
  const targetPath = join(fixture.root, 'support.json');
  writeFileSync(targetPath, 'existing', 'utf8');

  assertInspectorError(
    () =>
      writeSupportBundleJson(
        inspectSupportBundle(fixture.sourcePath).document,
        targetPath,
      ),
    supportBundleInspectorErrorCodes.outputExists,
  );
  assert.equal(readFileSync(targetPath, 'utf8'), 'existing');
});

test('writes pretty JSON atomically without changing the original archive', () => {
  const fixture = createFixture();
  const original = readFileSync(fixture.sourcePath);
  const targetPath = join(fixture.root, 'support.json');
  const output = createOutputCapture();

  assert.equal(
    runSupportBundleInspectorCli(
      [
        fixture.sourcePath,
        '--write-json',
        targetPath,
      ],
      output,
    ),
    0,
  );

  const prettyJson = readFileSync(targetPath, 'utf8');
  assert.match(prettyJson, /\n  "manifest": \{/);
  assert.deepEqual(JSON.parse(prettyJson), fixture.document);
  assert.deepEqual(readFileSync(fixture.sourcePath), original);
  assert.match(
    output.warnings.join('\n'),
    /purettu JSON ei ole salattu/,
  );
  assert.doesNotMatch(output.lines.join('\n'), new RegExp(targetPath));
});

test('maps output-exists failures to the documented exit code', () => {
  const fixture = createFixture();
  const targetPath = join(fixture.root, 'support.json');
  const output = createOutputCapture();
  writeFileSync(targetPath, 'existing', 'utf8');

  assert.equal(
    runSupportBundleInspectorCli(
      [
        fixture.sourcePath,
        '--write-json',
        targetPath,
      ],
      output,
    ),
    supportBundleInspectorExitCodes.SUPPORT_BUNDLE_OUTPUT_EXISTS,
  );
  assert.deepEqual(output.errors, [
    'SUPPORT_BUNDLE_OUTPUT_EXISTS',
  ]);
});

test('inspects desktopOnly v3 without inventing database or history metrics', t => {
  for (const backend of ['notRunning', 'exitUnconfirmed']) {
    const fixture = createDesktopFixture(t, document => { document.availability.backend = backend; });
    const { document, summary } = inspectSupportBundle(fixture.sourcePath);
    assert.equal(JSON.stringify(document), JSON.stringify(fixture.document));
    assert.deepEqual(summary, {
      appVersion: '0.3.0', buildRevision: 'abcdef123456',
      createdAt: '2026-11-06T12:00:00.000Z', formatVersion: 3, kind: 'desktopOnly',
      backend, database: 'notInspected', diagnosticHistory: 'notCollected',
      incidentHistory: 'notCollected', observationStatus: 'unavailable',
    });
    const output = createOutputCapture();
    assert.equal(runSupportBundleInspectorCli([fixture.sourcePath], output), 0);
    assert.equal(output.lines[0], formatSupportBundleSummary(summary));
    assert.match(output.lines[0], new RegExp(`Backend: ${backend}`));
    assert.match(output.lines[0], /notInspected/);
    assert.match(output.lines[0], /notCollected/);
    assert.match(output.lines[0], /unavailable/);
    assert.doesNotMatch(output.lines[0], /Migraatioita|tapahtumia|yhteenvetoja|health/);
  }
});

test('v3 preserves key order and checksums through JSON export and another inspection', t => {
  const fixture = createDesktopFixture(t, document => {
    document.system = Object.fromEntries(Object.entries(document.system).reverse());
    document.availability = Object.fromEntries(Object.entries(document.availability).reverse());
    document.observation = { cleanupError: desktopFailure({
      stage: 'deleteCleanup', errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', eventId: cleanupEventId,
    }), firstError: desktopFailure(), status: 'available', scope: 'currentOperation' };
  });
  const original = readFileSync(fixture.sourcePath);
  const inspected = inspectSupportBundle(fixture.sourcePath);
  assert.equal(JSON.stringify(inspected.document), JSON.stringify(fixture.document));
  assert.equal(inspected.summary.firstErrorCode, 'WORKSPACE_DELETE_IO_FAILED');
  assert.equal(inspected.summary.cleanupErrorCode, 'WORKSPACE_DELETE_CLEANUP_FAILED');
  const text = formatSupportBundleSummary(inspected.summary);
  assert.match(text, /Nykyisen operaation havainto: available/);
  assert.match(text, /Ensivirheen koodi: WORKSPACE_DELETE_IO_FAILED/);
  assert.match(text, /Siivousvirheen koodi: WORKSPACE_DELETE_CLEANUP_FAILED/);
  assert.doesNotMatch(text, /eventId|correlationId|runtimeInstanceId|deletePurge/);
  const target = join(fixture.root, 'desktop.json');
  writeSupportBundleJson(inspected.document, target);
  assert.equal(JSON.stringify(JSON.parse(readFileSync(target, 'utf8'))), JSON.stringify(fixture.document));
  const second = join(fixture.root, 'roundtrip.json.gz');
  writeFileSync(second, gzipSync(readFileSync(target)));
  assert.deepEqual(inspectSupportBundle(second).summary, inspected.summary);
  assert.ok(readFileSync(fixture.sourcePath).equals(original));
});

test('v3 accepts current management operations and import/replace failure projections', t => {
  const firstErrors = [
    ...['create', 'import', 'replace', 'switch', 'rename'].map(operation => desktopFailure({
      operationId: `workspace.${operation}`, stage: 'operation',
      errorCode: `WORKSPACE_MANAGEMENT_${operation.toUpperCase()}_FAILED`,
    })),
    desktopFailure({ operationId: 'workspace.deleteResume' }),
    desktopFailure({ stage: 'admission', sideEffectState: 'none', errorCode: 'WORKSPACE_MANAGEMENT_INVALID' }),
    desktopFailure({ stage: 'deletePreparation', sideEffectState: 'none', errorCode: 'WORKSPACE_MANAGEMENT_BUSY', retryable: true }),
    desktopFailure({ operationId: 'workspace.replace', stage: 'lineageCheck', errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH' }),
    desktopBackupFailure(),
    desktopBackupFailure({ stage: 'replace', errorCode: 'unknown' }),
  ];
  for (const firstError of firstErrors) {
    const fixture = createDesktopFixture(t, document => {
      document.observation = { scope: 'currentOperation', status: 'available', firstError, cleanupError: null };
    });
    assert.equal(inspectSupportBundle(fixture.sourcePath).summary.firstErrorCode, firstError.errorCode);
  }
  for (const firstError of [desktopBackupFailure(), desktopFailure({
    operationId: 'workspace.import', stage: 'operation', errorCode: 'WORKSPACE_MANAGEMENT_IMPORT_FAILED',
  }), null]) {
    const fixture = createDesktopFixture(t, document => {
      document.observation = { scope: 'currentOperation', status: 'available', firstError,
        cleanupError: desktopBackupFailure({ eventName: 'workspaceBackup.cleanupFailed', eventId: cleanupEventId }) };
    });
    const summary = inspectSupportBundle(fixture.sourcePath).summary;
    assert.equal(summary.cleanupErrorCode, 'PROFILE_INSPECTION_TIMEOUT');
    assert.equal(Object.hasOwn(summary, 'firstErrorCode'), firstError !== null);
  }
});

test('v3 rejects extra or missing fields at every closed boundary with valid checksums', t => {
  for (const select of [document => document, document => document.manifest,
    document => document.system, document => document.availability, document => document.observation,
    document => document.observation.firstError]) {
    for (const mode of ['extra', 'missing']) {
      assertDesktopRejected(t, document => {
        const value = select(document);
        if (mode === 'extra') value.rawError = { message: 'synthetic-private' };
        else delete value[Object.keys(value).find(key => key !== 'manifest')];
      });
    }
  }
  assertDesktopRejected(t, document => { document.observation.thirdError = desktopFailure(); });
  assertDesktopRejected(t, document => { document.observation = {
    scope: 'currentOperation', status: 'unavailable', firstError: null,
  }; });
});

test('v3 rejects invalid system, availability and observation values', t => {
  for (const mutate of [
    document => { document.system.appVersion = '01.2.3'; },
    document => { document.system.electronVersion = 'not-a-version'; },
    document => { document.system.buildRevision = 'ABCDEF1'; },
    document => { document.system.architecture = 'ia32'; },
    document => { document.system.platform = 'unknown'; },
    document => { document.availability.backend = 'running'; },
    document => { document.availability.database = 'ok'; },
    document => { document.availability.diagnosticHistory = []; },
    document => { document.availability.incidentHistory = 0; },
    document => { document.observation.scope = 'history'; },
    document => { document.observation.status = 'unknown'; },
    document => { document.observation.firstError = null; },
  ]) assertDesktopRejected(t, mutate);
});

test('v3 rejects unknown codes, wrong roles, event semantics and normalization', t => {
  for (const changes of [
    { errorCode: 'WORKSPACE_DELETE_FUTURE_CODE' }, { errorCode: 'unknown' },
    { stage: 'deleteCleanup' }, { stage: 'operation' }, { retryable: true },
    { sideEffectState: 'none' }, { operationId: 'workspace.deleteResume', sideEffectState: 'none', stage: 'admission' },
    { eventName: 'desktop.shutdownFailed' }, { category: 'backup' }, { component: 'backend' },
    { level: 'warn' }, { outcome: 'success' }, { schemaVersion: 2 },
    { appVersion: '0.3.1' }, { buildRevision: 'abcdef123457' },
    { durationMs: -1 }, { durationMs: 1.5 }, { durationMs: Number.MAX_SAFE_INTEGER + 1 },
    { eventId: 'not-a-uuid' }, { correlationId: 'not-a-uuid' }, { runtimeInstanceId: 'not-a-uuid' },
    { timestamp: '2026-11-06T12:00:00Z' }, { timestamp: '2026-02-30T12:00:00.000Z' },
    { errorCode: 'WORKSPACE_DELETE_IO_FAILED\n' }, { stage: ' deletePurge' },
    { errorCode: 'WORKSPACE_MANAGEMENT_CREATE_FAILED', operationId: 'workspace.rename', stage: 'operation' },
    { errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', operationId: 'workspace.import', stage: 'lineageCheck' },
    { operationId: 'workspace.switch', errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS', stage: 'operation' },
  ]) assertDesktopRejected(t, document => { Object.assign(document.observation.firstError, changes); });
  for (const changes of [{ errorCode: 'FUTURE_CODE' }, { stage: 'deletePurge' }, { retryable: true },
    { sideEffectState: 'rolledBack' }, { operationId: 'workspace.import' },
    { eventName: 'workspaceBackup.cleanupFailed' }]) {
    assertDesktopRejected(t, document => { document.observation.firstError = desktopBackupFailure(changes); });
  }
  assertDesktopRejected(t, document => {
    document.observation.cleanupError = desktopFailure({ eventId: cleanupEventId });
  });
  assertDesktopRejected(t, document => {
    document.observation.cleanupError = desktopFailure({ stage: 'deleteCleanup',
      errorCode: 'WORKSPACE_DELETE_IO_FAILED', eventId: cleanupEventId });
  });
});

test('v3 rejects coercible non-string management failure codes', t => {
  for (const errorCode of [['WORKSPACE_MANAGEMENT_CREATE_FAILED'], null, 1,
    { toString: 'WORKSPACE_MANAGEMENT_CREATE_FAILED' }]) {
    assertDesktopRejected(t, document => {
      document.observation.firstError = desktopFailure({ operationId: 'workspace.create', stage: 'operation', errorCode });
    });
  }
});

test('v3 binds a failure pair to the same operation, correlation and runtime with distinct events', t => {
  for (const changes of [{ operationId: 'workspace.deleteResume' }, { correlationId: otherUuid },
    { runtimeInstanceId: otherUuid }, { eventId: firstEventId }]) {
    assertDesktopRejected(t, document => {
      document.observation.cleanupError = desktopFailure({ stage: 'deleteCleanup',
        errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', eventId: cleanupEventId, ...changes });
    });
  }
});

test('v3 rejects malformed manifest, version, checksum keys and unknown kinds', t => {
  for (const mutate of [
    document => { document.manifest.createdAt = '2026-11-06T12:00:00Z'; },
    document => { document.manifest.createdAt = '2026-02-30T12:00:00.000Z'; },
    document => { document.manifest.creationCorrelationId = 'not-a-uuid'; },
    document => { document.manifest.supportBundleFormatVersion = '3'; },
    document => { document.manifest.kind = 'future'; },
    document => { document.manifest.sectionChecksums.raw = 'a'.repeat(64); },
    document => { delete document.manifest.sectionChecksums.system; },
    document => { document.manifest.sectionChecksums.system = 'A'.repeat(64); },
  ]) assertDesktopRejected(t, mutate, { refreshChecksums: false });
  for (const version of [2, 4]) {
    assertDesktopRejected(t, document => { document.manifest.supportBundleFormatVersion = version; },
      { expectedCode: supportBundleInspectorErrorCodes.formatUnsupported });
  }
});

test('v3 checks all three section checksums independently', t => {
  for (const name of ['system', 'availability', 'observation']) {
    assertDesktopRejected(t, document => { document.manifest.sectionChecksums[name] = '0'.repeat(64); },
      { refreshChecksums: false, expectedCode: supportBundleInspectorErrorCodes.checksumFailed });
  }
});

const firstEventId = '11111111-1111-4111-8111-111111111111';
const cleanupEventId = '22222222-2222-4222-8222-222222222222';
const otherUuid = '33333333-3333-4333-8333-333333333333';

function desktopFailure(changes = {}) {
  return {
    appVersion: '0.3.0', buildRevision: 'abcdef123456', category: 'workspaceManagement',
    component: 'desktop', correlationId: '44444444-4444-4444-8444-444444444444',
    durationMs: 12, errorCode: 'WORKSPACE_DELETE_IO_FAILED', eventId: firstEventId,
    eventName: 'workspaceManagement.operationFailed', level: 'error', outcome: 'failure',
    retryable: false, runtimeInstanceId: '55555555-5555-4555-8555-555555555555',
    schemaVersion: 1, sideEffectState: 'unknown', stage: 'deletePurge',
    timestamp: '2026-11-06T12:00:00.000Z', operationId: 'workspace.delete', ...changes,
  };
}

function desktopBackupFailure(changes = {}) {
  const { operationId: _operationId, ...event } = desktopFailure();
  return { ...event, category: 'backup', eventName: 'workspaceBackup.operationFailed',
    stage: 'import', errorCode: 'PROFILE_INSPECTION_TIMEOUT', ...changes };
}

function createDesktopFixture(t, mutate = () => {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eky-desktop-support-inspector-'));
  t.after(() => { if (t.passed === true) rmSync(root, { force: true, recursive: true }); });
  const sourcePath = join(root, 'desktop.json.gz');
  const document = {
    manifest: { supportBundleFormatVersion: 3, kind: 'desktopOnly',
      createdAt: '2026-11-06T12:00:00.000Z', creationCorrelationId: otherUuid, sectionChecksums: {} },
    system: { appVersion: '0.3.0', architecture: 'x64', buildRevision: 'abcdef123456',
      electronVersion: '43.0.0', platform: 'win32' },
    availability: { backend: 'notRunning', database: 'notInspected',
      diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
    observation: options.observed === true
      ? { scope: 'currentOperation', status: 'available', firstError: desktopFailure(), cleanupError: null }
      : { scope: 'currentOperation', status: 'unavailable' },
  };
  const refresh = () => { document.manifest.sectionChecksums = Object.fromEntries(
    ['system', 'availability', 'observation'].map(name => [name, checksum(document[name] ?? null)]),
  ); };
  refresh();
  mutate(document);
  if (options.refreshChecksums !== false) refresh();
  writeFileSync(sourcePath, gzipSync(Buffer.from(JSON.stringify(document), 'utf8')));
  return { document, root, sourcePath };
}

function assertDesktopRejected(t, mutate, options = {}) {
  const fixture = createDesktopFixture(t, document => {
    mutate(document);
  }, { ...options, observed: true });
  const expectedCode = options.expectedCode ?? supportBundleInspectorErrorCodes.jsonInvalid;
  assertInspectorError(() => inspectSupportBundle(fixture.sourcePath), expectedCode);
  const output = createOutputCapture();
  assert.equal(runSupportBundleInspectorCli([fixture.sourcePath], output), supportBundleInspectorExitCodes[expectedCode]);
  assert.deepEqual(output.errors, [expectedCode]);
  assert.deepEqual(output.lines, []);
}

function createFixture(
  mutate = () => {},
  options = {},
) {
  const root = createRoot();
  const sourcePath = join(
    root,
    options.fileName ?? 'fixture.json.gz',
  );
  const document = createDocument();
  mutate(document);
  if (options.refreshChecksums !== false) {
    document.manifest.sectionChecksums =
      createSectionChecksums(document);
  }
  writeFileSync(
    sourcePath,
    gzipSync(Buffer.from(JSON.stringify(document), 'utf8')),
  );
  return { document, root, sourcePath };
}

function createDocument() {
  const document = {
    manifest: {
      createdAt: '2026-07-28T18:00:00.000Z',
      creationCorrelationId:
        '11111111-1111-4111-8111-111111111111',
      diagnosticPeriodDays: 30,
      sectionChecksums: {},
      supportBundleFormatVersion: 2,
      truncatedSections: [],
    },
    system: {
      appVersion: '0.1.0-alpha.1',
      architecture: 'x64',
      backendVersion: '0.1.0-alpha.1',
      platform: 'win32',
    },
    database: {
      appliedMigrationCount: 42,
      health: 'ok',
      latestMigrationName: '042_example.sql',
    },
    operationalSummary: {
      eventCount: 1,
      byComponent: { backend: 1, desktop: 0 },
      byLevel: { error: 1, info: 0, warn: 0 },
    },
    runtimeSummary: {
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'abcdef123456',
    },
    incidentSummaries: [
      {
        eventName: 'smtp.tlsFailed',
        errorCode: 'SMTP_TLS_FAILED',
      },
    ],
    diagnosticEvents: [
      {
        eventName: 'smtp.tlsFailed',
        errorCode: 'SMTP_TLS_FAILED',
      },
    ],
  };
  document.manifest.sectionChecksums =
    createSectionChecksums(document);
  return document;
}

function createSectionChecksums(document) {
  return Object.fromEntries(
    [
      'database',
      'diagnosticEvents',
      'incidentSummaries',
      'operationalSummary',
      'runtimeSummary',
      'system',
    ].map((name) => [name, checksum(document[name])]),
  );
}

function checksum(value) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function createRoot() {
  const root = mkdtempSync(
    join(tmpdir(), 'eky-support-inspector-'),
  );
  roots.push(root);
  return root;
}

function createOutputCapture() {
  const lines = [];
  const warnings = [];
  const errors = [];
  return {
    errors,
    lines,
    warnings,
    error(value) {
      errors.push(String(value));
    },
    log(value) {
      lines.push(String(value));
    },
    warn(value) {
      warnings.push(String(value));
    },
  };
}

function assertInspectorError(operation, expectedCode) {
  assert.throws(operation, (error) => {
    assert.equal(error?.code, expectedCode);
    assert.equal(error?.message, expectedCode);
    return true;
  });
}
