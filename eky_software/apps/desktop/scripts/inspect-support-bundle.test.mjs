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

test('inspects a valid v2 support bundle without exposing event content', () => {
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

function createFixture(
  mutate = () => {},
  options = { refreshChecksums: true },
) {
  const root = createRoot();
  const sourcePath = join(root, 'fixture.ekysupport');
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
