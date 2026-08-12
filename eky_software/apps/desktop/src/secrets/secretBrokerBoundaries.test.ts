import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { invoicePdfPreviewIpcChannel } from '../pdf/invoicePdfPreviewTypes.js';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('desktop secret broker boundaries', () => {
  it('exposes only the named desktop capabilities through preload', async () => {
    const preloadSource = await readFile(
      join(sourceRoot, 'preload', 'index.cts'),
      'utf8',
    );

    expect(preloadSource).not.toMatch(/safeStorage|secretBroker|MessagePort/i);
    expect(preloadSource).not.toMatch(/node:fs|shell|process\.|openUrl|openFile|rawIpc/i);
    expect(preloadSource.match(/ipcRenderer\.invoke/g)).toHaveLength(19);
    expect(preloadSource).toContain('invoicePdfPreviewIpcChannel');
    expect(preloadSource).toContain(
      `invoicePdfPreviewIpcChannel = '${invoicePdfPreviewIpcChannel}'`,
    );
    expect(preloadSource).toContain('openInvoicePdf');
    expect(preloadSource).toContain('openOperationalLogFolder');
    expect(preloadSource).toContain('createSupportBundle');
    expect(preloadSource).toContain('getInvoicePdfArchiveStatus');
    expect(preloadSource).toContain('chooseInvoicePdfArchiveDirectory');
    expect(preloadSource).toContain('openInvoicePdfArchiveDirectory');
    expect(preloadSource).toContain('disableInvoicePdfArchive');
    expect(preloadSource).toContain('retryPendingInvoicePdfArchiveTasks');
    expect(preloadSource).toContain('createEncryptedProfileBackup');
    expect(preloadSource).toContain('selectLocalUpdate');
    expect(preloadSource).toContain('getLocalUpdateStatus');
    expect(preloadSource).toContain('discardSelectedLocalUpdate');
    expect(preloadSource).toContain('confirmLocalUpdate');
    expect(preloadSource).toContain('cancelLocalUpdate');
    expect(preloadSource).toContain('getProfileBackupStatus');
    expect(preloadSource).toContain('inspectEncryptedProfileBackup');
    expect(preloadSource).toContain('prepareEncryptedProfileRestore');
    expect(preloadSource).toContain('activatePreparedProfileRestore');
    expect(preloadSource).toContain('createManualRecoveryPoint');
  });

  it('does not expose the broker or secret read operation to web source code', async () => {
    const webSourceRoot = resolve(sourceRoot, '../../web/src');
    const webFiles = await listSourceFiles(webSourceRoot);
    const combinedSource = (
      await Promise.all(webFiles.map((filePath) => readFile(filePath, 'utf8')))
    ).join('\n');

    expect(combinedSource).not.toMatch(
      /readCompanyEmailSecret|safeStorage|secretBroker/i,
    );
  });
});

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(entryPath)));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}
