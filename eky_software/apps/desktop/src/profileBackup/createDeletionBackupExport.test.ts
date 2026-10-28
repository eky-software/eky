import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { fixture, password, sourceId } from './portableDeletionBackupTestSupport.js';
import { createDeletionBackupExport } from './createDeletionBackupExport.js';

it.each(['missing', 'lowercase', 'uppercase'] as const)('rechecks the existing encrypted exporter\'s authenticated bytes with a %s suffix without retaining the password', async suffix => {
  const f = await fixture();
  const selectedPath = suffix === 'missing' ? join(dirname(f.destinationPath), 'synthetic') :
    suffix === 'uppercase' ? join(dirname(f.destinationPath), 'synthetic.EKYBACKUP') : f.destinationPath;
  const exportedPath = suffix === 'missing' ? f.destinationPath : selectedPath;
  const selected = vi.fn(async (_defaultFileName: string) => selectedPath);
  const passwordWindow = { requestPassword: vi.fn(async () => password) };
  const exporter = createDeletionBackupExport({ backupService: f.service, passwordWindow,
    readActiveWorkspaceLabel: async () => 'Synthetic company', selectBackupTarget: selected });
  const content = await exporter.createBackup({ operationId: sourceId, assertValid: f.assertFence,
    async assertCurrent() { f.assertFence(); await f.broker.assertDeleteMaintenance(sourceId); f.assertFence(); } });
  expect(content).not.toBeNull();
  const bytes = await readFile(exportedPath);
  const identity = await exporter.recheckExport();
  expect(identity).toMatchObject({ byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  expect(identity.sha256).toBe(content!.exported.containerSha256);
  expect(identity.fileIdentity).toBe([
    content!.exported.authenticatedFileIdentity.dev, content!.exported.authenticatedFileIdentity.ino,
    content!.exported.authenticatedFileIdentity.size, content!.exported.authenticatedFileIdentity.mtimeNs,
    content!.exported.authenticatedFileIdentity.ctimeNs,
  ].join(':'));
  expect(passwordWindow.requestPassword).toHaveBeenCalledExactlyOnceWith('create');
  expect(selected.mock.calls[0]![0]).toMatch(/^Eky-varmuuskopio-Synthetic company-\d{4}-\d{2}-\d{2}\.ekybackup$/u);
  expect(f.lease.readState()).toBe('busy');
  expect(JSON.stringify(identity)).not.toContain(password);
});

it.each(['label', 'target', 'password'] as const)('rejects a revoked request after the %s wait without starting the next side effect', async boundary => {
  const f = controls(boundary);
  await expect(f.exporter.createBackup(f.owner)).rejects.toThrow('SYNTHETIC_REVOKED');
  expect(f.backup).not.toHaveBeenCalled();
  expect(f.passwordWindow.requestPassword).toHaveBeenCalledTimes(boundary === 'password' ? 1 : 0);
  expect(f.select).toHaveBeenCalledTimes(boundary === 'label' ? 0 : 1);
  await expect(f.exporter.recheckExport()).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it.each(['target', 'password'] as const)('does not convert %s cancellation into consent or export evidence', async boundary => {
  const f = controls();
  if (boundary === 'target') f.select.mockResolvedValueOnce(null);
  else f.passwordWindow.requestPassword.mockResolvedValueOnce(null);
  await expect(f.exporter.createBackup(f.owner)).resolves.toBeNull();
  expect(f.backup).not.toHaveBeenCalled();
  await expect(f.exporter.recheckExport()).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
  await expect(f.exporter.createBackup(f.owner)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it('retains the original exporter failure rather than replacing it with a generic native error', async () => {
  const f = controls();
  const first = new Error('SYNTHETIC_ORIGINAL_EXPORT_FAILURE', { cause: new Error('SYNTHETIC_INNER_CAUSE') });
  f.backup.mockRejectedValueOnce(first);
  await expect(f.exporter.createBackup(f.owner)).rejects.toBe(first);
  await expect(f.exporter.recheckExport()).rejects.toThrow('WORKSPACE_DELETE_BACKUP_UNAVAILABLE');
});

it('requires a current active label before opening a destination or password window', async () => {
  const f = controls();
  f.label.mockResolvedValueOnce(undefined);
  await expect(f.exporter.createBackup(f.owner)).rejects.toThrow('WORKSPACE_DELETE_BACKUP_OWNER_UNAVAILABLE');
  expect(f.select).not.toHaveBeenCalled();
  expect(f.passwordWindow.requestPassword).not.toHaveBeenCalled();
  expect(f.backup).not.toHaveBeenCalled();
});

function controls(revokeAt?: 'label' | 'target' | 'password') {
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error('SYNTHETIC_REVOKED'); };
  const label = vi.fn(async (): Promise<string | undefined> => {
    if (revokeAt === 'label') current = false;
    return 'Synthetic company';
  });
  const select = vi.fn(async (): Promise<string | null> => {
    if (revokeAt === 'target') current = false;
    return 'unused-native-selection';
  });
  const passwordWindow = { requestPassword: vi.fn(async (): Promise<string | null> => {
    if (revokeAt === 'password') current = false;
    return password;
  }) };
  const backup = vi.fn(async (): Promise<never> => { throw new Error('UNEXPECTED_EXPORT'); });
  const exporter = createDeletionBackupExport({ backupService: { createForDeletion: backup }, passwordWindow,
    readActiveWorkspaceLabel: label, selectBackupTarget: select });
  return { exporter, label, select, passwordWindow, backup,
    owner: { operationId: sourceId, assertValid: assertCurrent, async assertCurrent() { assertCurrent(); } } };
}
