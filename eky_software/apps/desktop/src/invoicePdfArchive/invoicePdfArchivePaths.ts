import { basename, isAbsolute, join } from 'node:path';

import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';

const configFileName = 'invoice-pdf-archive-v1.json';
const journalFileName = 'invoice-pdf-archive-journal-v1.json';
const maximumPathCharacters = 4_096;

export interface InvoicePdfArchiveRuntimePaths {
  configFilePath: string;
  journalFilePath: string;
}

export function createInvoicePdfArchiveRuntimePaths(
  runtimeRoot: string,
): InvoicePdfArchiveRuntimePaths {
  requireAbsolutePath(runtimeRoot);

  return {
    configFilePath: join(runtimeRoot, 'settings', configFileName),
    journalFilePath: join(runtimeRoot, 'archive', journalFileName),
  };
}

export function requireInvoicePdfArchiveConfigFilePath(
  filePath: string,
): string {
  return requireKnownFilePath(filePath, configFileName);
}

export function requireInvoicePdfArchiveJournalFilePath(
  filePath: string,
): string {
  return requireKnownFilePath(filePath, journalFileName);
}

export function requireInvoicePdfArchiveDirectoryPath(
  directoryPath: string,
): string {
  requireAbsolutePath(directoryPath);

  if (directoryPath.trim() !== directoryPath) {
    throw new InvoicePdfArchiveError('ARCHIVE_DIRECTORY_UNAVAILABLE', true);
  }

  return directoryPath;
}

function requireKnownFilePath(filePath: string, fileName: string): string {
  requireAbsolutePath(filePath);

  if (basename(filePath) !== fileName) {
    throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
  }

  return filePath;
}

function requireAbsolutePath(value: string): void {
  if (
    !isAbsolute(value) ||
    value.length < 1 ||
    value.length > maximumPathCharacters ||
    value.includes('\0')
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_STORAGE_FAILED', true);
  }
}
