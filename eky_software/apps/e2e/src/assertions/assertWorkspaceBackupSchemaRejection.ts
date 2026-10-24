import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { supportBundleFormatVersion } from '../../../desktop/src/supportBundle/supportBundleArchive.js';
import { expect, type IsolatedElectronHarness } from '../fixtures/isolatedElectronTest.js';
import { readDiagnosticPage } from './readDiagnosticPage.js';
import { readElectronOperationalEvents, type ElectronOperationalEvent } from './readElectronOperationalEvents.js';

interface SupportBundleEvidence {
  readonly manifest: {
    readonly supportBundleFormatVersion: number;
    readonly sectionChecksums: Readonly<Record<string, string>>;
  };
  readonly diagnosticEvents: readonly ElectronOperationalEvent[];
  readonly [section: string]: unknown;
}

export async function assertWorkspaceBackupSchemaRejection(input: {
  readonly harness: IsolatedElectronHarness;
  readonly oldObservationsPath: string;
  readonly oldSessionSecret: string;
  readonly stage: 'import' | 'replace';
  readonly preservedCustomerName: string;
  readonly preservedInvoiceId: string;
}): Promise<void> {
  const fixture = input.harness.workspaceBackupFixture;
  if (fixture === undefined) throw new Error('SCHEMA_FIXTURE_BACKUP_MISSING');
  const readNativeEvents = (path: string): ElectronOperationalEvent[] => readFileSync(path, 'utf8')
    .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as ElectronOperationalEvent);
  const oldNativeEvents = readNativeEvents(input.oldObservationsPath);
  expect(oldNativeEvents.filter((event) => event.operation === 'showOpenDialog')).toEqual([
    { operation: 'showOpenDialog', canceled: false, purpose: input.stage === 'import' ? 'workspaceBackupImport' : 'workspaceBackupReplacement' },
  ]);
  expect(oldNativeEvents.filter((event) => event.operation === 'showMessageBox')).toEqual(
    input.stage === 'replace' ? [{ operation: 'showMessageBox', response: 1 }] : [],
  );
  expect(oldNativeEvents.filter((event) => event.operation === 'workspaceRelaunchRequested')).toHaveLength(1);

  const logsRoot = join(input.harness.runtime.userDataPath, 'runtime', 'logs');
  const detailed = readElectronOperationalEvents(join(logsRoot, 'desktop'));
  const failures = detailed.filter((event) => event.eventName === 'workspaceBackup.operationFailed');
  expect(failures).toHaveLength(1);
  const first = failures[0];
  if (first === undefined) throw new Error('SCHEMA_FAILURE_EVENT_MISSING');
  expect(first).toMatchObject({ errorCode: 'PROFILE_SCHEMA_UNSUPPORTED', stage: input.stage, retryable: false, sideEffectState: 'unknown' });
  expect(detailed.filter((event) => event.eventName === 'workspaceBackup.cleanupFailed')).toHaveLength(0);
  const incidents = readElectronOperationalEvents(join(logsRoot, 'incident-index'));
  const failureIncidents = incidents.filter((event) => event.eventName === 'workspaceBackup.operationFailed');
  expect(failureIncidents).toHaveLength(1);
  expect(failureIncidents[0]).toMatchObject({
    schemaVersion: 1, component: 'desktop', errorCode: first.errorCode,
    fingerprint: 'workspaceBackup.operationFailed:PROFILE_SCHEMA_UNSUPPORTED', outcome: 'failure', timestamp: first.timestamp,
  });
  expect(Object.keys(failureIncidents[0] ?? {}).sort()).toEqual([
    'appVersion', 'buildRevision', 'component', 'errorCode', 'eventName', 'fingerprint', 'outcome', 'schemaVersion', 'timestamp',
  ].sort());

  const { diagnosticEvents: diagnostics } = await readDiagnosticPage(input.harness.api);
  const diagnosticFailure = diagnostics.filter((event) => event.eventName === 'workspaceBackup.operationFailed');
  expect(diagnosticFailure).toHaveLength(1);
  expect(diagnosticFailure[0]).toMatchObject({
    errorCode: first.errorCode,
    stage: input.stage,
    correlationId: first.correlationId,
    sideEffectState: first.sideEffectState,
    retryable: first.retryable,
  });
  expect(await input.harness.page.evaluate(async () => {
    return (window as typeof window & { ekyDesktop: { createSupportBundle(): Promise<string> } }).ekyDesktop.createSupportBundle();
  })).toBe('created');
  const repositoryRoot = resolve(import.meta.dirname, '../../../..');
  execFileSync(process.execPath, [join(repositoryRoot, 'apps/desktop/scripts/inspect-support-bundle.mjs'), input.harness.runtime.supportBundlePath], {
    cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe', timeout: 15_000, windowsHide: true,
  });
  const support = JSON.parse(gunzipSync(readFileSync(input.harness.runtime.supportBundlePath)).toString('utf8')) as SupportBundleEvidence;
  expect(support.manifest.supportBundleFormatVersion).toBe(supportBundleFormatVersion);
  const supportFailure = support.diagnosticEvents.filter((event) => event.eventName === 'workspaceBackup.operationFailed');
  expect(supportFailure).toHaveLength(1);
  expect(supportFailure[0]).toMatchObject({
    errorCode: first.errorCode,
    stage: input.stage,
    correlationId: first.correlationId,
    sideEffectState: first.sideEffectState,
    retryable: first.retryable,
  });
  for (const section of ['database', 'diagnosticEvents', 'incidentSummaries', 'operationalSummary', 'runtimeSummary', 'system']) {
    expect(support.manifest.sectionChecksums[section]).toBe(createHash('sha256').update(JSON.stringify(support[section])).digest('hex'));
  }

  const renderer = await input.harness.page.locator('body').textContent();
  expect(renderer).not.toContain('PROFILE_SCHEMA_UNSUPPORTED');
  const secrets = [fixture.password, fixture.profileId, fixture.sourceDatabaseFilePath, fixture.backupPath, input.oldSessionSecret, input.harness.runtime.sessionSecret];
  // Decode JSON first: serialized backslashes must not hide Windows-path leaks.
  expect(containsPrivateValue(JSON.parse(JSON.stringify({ nested: [{ path: fixture.backupPath }] })), fixture.backupPath)).toBe(true);
  expect(containsPrivateValue({ [fixture.backupPath]: true }, fixture.backupPath)).toBe(true);
  for (const content of [renderer, diagnostics, support, oldNativeEvents, readNativeEvents(input.harness.runtime.observationsPath), detailed, incidents]) {
    for (const secret of secrets) expect(containsPrivateValue(content, secret)).toBe(false);
  }
  for (const content of [diagnostics, support, detailed, incidents]) {
    for (const value of [fixture.customerName, input.preservedCustomerName, fixture.invoiceId, input.preservedInvoiceId]) {
      expect(containsPrivateValue(content, value)).toBe(false);
    }
  }
}

function containsPrivateValue(value: unknown, forbiddenValue: string): boolean {
  if (typeof value === 'string') return value.includes(forbiddenValue);
  if (Array.isArray(value)) return value.some((entry) => containsPrivateValue(entry, forbiddenValue));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => key.includes(forbiddenValue) || containsPrivateValue(entry, forbiddenValue));
  }
  return false;
}
