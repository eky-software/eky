import { basename } from 'node:path';
import { stat } from 'node:fs/promises';

import { InvoicePdfArchiveAtomicJsonFile } from './invoicePdfArchiveAtomicJsonFile.js';
import {
  requireInvoicePdfArchiveConfigFilePath,
  requireInvoicePdfArchiveDirectoryPath,
} from './invoicePdfArchivePaths.js';
import {
  invoicePdfArchiveSchemaVersion,
  InvoicePdfArchiveError,
  type InvoicePdfArchiveConfig,
} from './invoicePdfArchiveTypes.js';

export class InvoicePdfArchiveConfigStore {
  private readonly file: InvoicePdfArchiveAtomicJsonFile<InvoicePdfArchiveConfig>;

  constructor(filePath: string) {
    this.file = new InvoicePdfArchiveAtomicJsonFile(
      requireInvoicePdfArchiveConfigFilePath(filePath),
      parseInvoicePdfArchiveConfig,
      'ARCHIVE_CONFIG_INVALID',
    );
  }

  async disable(): Promise<void> {
    await this.file.remove();
  }

  async enable(directoryPath: string): Promise<InvoicePdfArchiveConfig> {
    const config = {
      directoryPath: await requireExistingDirectory(directoryPath),
      enabled: true,
      schemaVersion: invoicePdfArchiveSchemaVersion,
    } satisfies InvoicePdfArchiveConfig;

    await this.file.write(config);
    return config;
  }

  async read(): Promise<InvoicePdfArchiveConfig | null> {
    const config = await this.file.read();

    if (config === null) {
      return null;
    }

    await requireExistingDirectory(config.directoryPath);
    return config;
  }

  async readDisplayName(): Promise<string | null> {
    const config = await this.read();
    return config === null ? null : basename(config.directoryPath);
  }
}

export function parseInvoicePdfArchiveConfig(
  value: unknown,
): InvoicePdfArchiveConfig {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['directoryPath', 'enabled', 'schemaVersion']) ||
    value.schemaVersion !== invoicePdfArchiveSchemaVersion ||
    value.enabled !== true ||
    typeof value.directoryPath !== 'string'
  ) {
    throw new InvoicePdfArchiveError('ARCHIVE_CONFIG_INVALID', false);
  }

  try {
    return {
      directoryPath: requireInvoicePdfArchiveDirectoryPath(
        value.directoryPath,
      ),
      enabled: true,
      schemaVersion: invoicePdfArchiveSchemaVersion,
    };
  } catch {
    throw new InvoicePdfArchiveError('ARCHIVE_CONFIG_INVALID', false);
  }
}

export async function requireExistingDirectory(
  directoryPath: string,
): Promise<string> {
  let stats;

  try {
    stats = await stat(requireInvoicePdfArchiveDirectoryPath(directoryPath));
  } catch {
    throw new InvoicePdfArchiveError('ARCHIVE_DIRECTORY_UNAVAILABLE', true);
  }

  if (!stats.isDirectory()) {
    throw new InvoicePdfArchiveError('ARCHIVE_DIRECTORY_UNAVAILABLE', true);
  }

  return directoryPath;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
