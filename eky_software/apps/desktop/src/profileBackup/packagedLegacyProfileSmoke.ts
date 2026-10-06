import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PackagedSmokeStage } from '../main/packagedSmoke.js';
import { localRuntimeSessionHeaderName } from '../main/protocolPolicy.js';
import type { WorkspaceManagementService } from '../workspaces/management/workspaceManagementService.js';
import type { PortableProfileBackupService } from './portableProfileBackup.js';
import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import {
  assertMutationState, captureActiveProfileEntries, createRestoreMutation,
  setSyntheticEmailSecret, writeSmokeState,
} from './packagedProfileBackupSmoke.js';

export const legacyPackagedSmokePassword = 'Synthetic legacy packaged fixture password, not a real secret';

interface LegacyProfileSmokeOptions {
  smokeRoot: string;
  backendPort: number;
  runtimeSessionSecret: string;
}

export async function runPackagedLegacyProfileBeforeRestore(options: LegacyProfileSmokeOptions & {
  runtimeInstanceId: string;
  stagingRoot: string;
  backupService: Pick<PortableProfileBackupService, 'inspect'>;
  management: Pick<WorkspaceManagementService, 'getStatus' | 'replaceActiveFromBackup'>;
  profileSnapshotClient: Pick<ProfileSnapshotBrokerClient,
    'beginMaintenance' | 'createProfileSnapshot' | 'endMaintenance' | 'validateProfileSnapshot'>;
  reportStage(stage: PackagedSmokeStage): Promise<void>;
}): Promise<void> {
  await verifyPackagedLegacyInvoice(options);
  await options.reportStage('profileBackup');
  const expectedEntries = await captureActiveProfileEntries({
    profileSnapshotClient: options.profileSnapshotClient,
    stagingRoot: options.stagingRoot,
    reportSnapshotStage: options.reportStage,
  });
  await options.reportStage('profileSnapshotCaptured');
  const containerPath = join(options.smokeRoot, 'legacy-input', 'original.ekybackup');
  const inspection = await options.backupService.inspect({ containerPath, password: legacyPackagedSmokePassword });
  if (inspection.databaseHealth !== 'healthy' || inspection.profileMatchStatus !== 'same') {
    throw new Error('DESKTOP_SMOKE_LEGACY_BACKUP_INVALID');
  }
  await options.reportStage('profileBackupVerified');
  await createRestoreMutation(options.backendPort, options.runtimeSessionSecret);
  await setSyntheticEmailSecret(options.backendPort, options.runtimeSessionSecret);
  await assertMutationState(options.backendPort, options.runtimeSessionSecret, true);
  await options.reportStage('profileMutationCreated');
  await writeSmokeState(options.smokeRoot, {
    expectedEntries, formatVersion: 1,
    originalRuntimeInstanceId: options.runtimeInstanceId,
    originalRuntimeSessionSha256: createHash('sha256').update(options.runtimeSessionSecret).digest('hex'),
  });
  const status = await options.management.getStatus();
  if (status.operationState !== 'idle' || status.activeWorkspaceId === null ||
      status.workspaces.length !== 1 || status.workspaces[0]?.availability !== 'ready') {
    throw new Error('DESKTOP_SMOKE_LEGACY_WORKSPACE_INVALID');
  }
  await options.reportStage('profileRestore');
  // The service completes its deferred relaunch in finally. All expectations
  // must be durable before this call, not in code after a successful return.
  await options.reportStage('restoreRestart');
  await options.management.replaceActiveFromBackup({
    containerPath, password: legacyPackagedSmokePassword,
    targetWorkspaceId: status.activeWorkspaceId,
  });
}

export async function verifyPackagedLegacyInvoice(options: LegacyProfileSmokeOptions): Promise<void> {
  const expected = await readLegacyPackagedSmokeIdentity(options.smokeRoot);
  const invoicePath = `/invoices/${expected.invoiceId}`;
  const request = (path: string) => fetch(`http://127.0.0.1:${options.backendPort}${path}`, {
    headers: { [localRuntimeSessionHeaderName]: options.runtimeSessionSecret },
    signal: AbortSignal.timeout(5_000),
  });
  const invoiceResponse = await request(invoicePath);
  const historyResponse = await request(`${invoicePath}/delivery-events`);
  if (!invoiceResponse.ok || !historyResponse.ok) throw new Error('DESKTOP_SMOKE_LEGACY_READ_FAILED');
  const invoice: unknown = await invoiceResponse.json();
  const history: unknown = await historyResponse.json();
  if (!record(invoice) || !record(invoice.invoice) || invoice.invoice.id !== expected.invoiceId ||
      invoice.invoice.invoiceNumber !== expected.invoiceNumber || invoice.invoice.status !== 'sent' ||
      !record(history) || !Array.isArray(history.events) || history.events.length !== 1) {
    throw new Error('DESKTOP_SMOKE_LEGACY_CONTENT_FAILED');
  }
  const event: unknown = history.events[0];
  if (!record(event) || event.id !== expected.eventId || event.status !== 'succeeded' ||
      event.documentSource !== 'legacyOriginal' || event.sendMode !== 'legacyUnknown') {
    throw new Error('DESKTOP_SMOKE_LEGACY_CONTENT_FAILED');
  }
  const pdfResponse = await request(`${invoicePath}/delivery-events/${expected.eventId}/pdf`);
  if (!pdfResponse.ok) throw new Error('DESKTOP_SMOKE_LEGACY_PDF_FAILED');
  const bytes = Buffer.from(await pdfResponse.arrayBuffer());
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      createHash('sha256').update(bytes).digest('hex') !== expected.pdfSha256) {
    throw new Error('DESKTOP_SMOKE_LEGACY_PDF_FAILED');
  }
}

export async function readLegacyPackagedSmokeIdentity(smokeRoot: string) {
  const path = join(smokeRoot, 'legacy-input', 'identity.json');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 2_048) {
    throw new Error('DESKTOP_SMOKE_LEGACY_IDENTITY_INVALID');
  }
  return parseLegacyPackagedSmokeIdentity(JSON.parse(await readFile(path, 'utf8')));
}

export function parseLegacyPackagedSmokeIdentity(value: unknown) {
  if (!record(value) || value.formatVersion !== 1 ||
      Object.keys(value).sort().join(',') !== 'eventId,formatVersion,invoiceId,invoiceNumber,pdfSha256,profileId' ||
      value.invoiceId !== 'invoice-1' || value.eventId !== 'legacy-event' ||
      typeof value.invoiceNumber !== 'string' || !/^[0-9]{1,50}$/.test(value.invoiceNumber) ||
      typeof value.pdfSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.pdfSha256) ||
      typeof value.profileId !== 'string' || !/^[a-f0-9]{64}$/.test(value.profileId)) {
    throw new Error('DESKTOP_SMOKE_LEGACY_IDENTITY_INVALID');
  }
  return { formatVersion: 1 as const, invoiceId: value.invoiceId, invoiceNumber: value.invoiceNumber,
    eventId: value.eventId, pdfSha256: value.pdfSha256, profileId: value.profileId };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
