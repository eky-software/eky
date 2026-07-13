import { describe, expect, it } from 'vitest';

import {
  parseDesktopBackendCommand,
  parseDesktopBackendStatus,
} from './backendMessages.js';

describe('desktop backend process messages', () => {
  it('accepts only absolute trusted runtime paths', () => {
    expect(
      parseDesktopBackendCommand({
        config: {
          backendRoot: 'C:\\Eky\\backend',
          createSmokePdf: true,
          databaseFilePath: 'C:\\Eky\\data\\eky.sqlite',
          invoiceDocumentStorageRoot: 'C:\\Eky\\storage',
          migrationsDirectory: 'C:\\Eky\\backend\\dist\\database\\migrations',
          smokePdfPath: 'C:\\Eky\\smoke\\invoice.pdf',
        },
        type: 'start',
      }),
    ).toBeDefined();
    expect(
      parseDesktopBackendCommand({
        config: {
          backendRoot: '..\\backend',
          createSmokePdf: true,
          databaseFilePath: 'eky.sqlite',
          invoiceDocumentStorageRoot: 'storage',
          migrationsDirectory: 'migrations',
          smokePdfPath: 'invoice.pdf',
        },
        type: 'start',
      }),
    ).toBeUndefined();
  });

  it('rejects malformed readiness messages', () => {
    expect(
      parseDesktopBackendStatus({ port: 32100, smokePdfCreated: true, type: 'ready' }),
    ).toEqual({ port: 32100, smokePdfCreated: true, type: 'ready' });
    expect(parseDesktopBackendStatus({ port: 0, type: 'ready' })).toBeUndefined();
    expect(parseDesktopBackendStatus({ error: 'sensitive details', type: 'failed' })).toBeUndefined();
  });

  it('accepts only predefined safe backend failure codes', () => {
    expect(
      parseDesktopBackendStatus({
        code: 'BACKEND_SERVER_START_FAILED',
        type: 'failed',
      }),
    ).toEqual({ code: 'BACKEND_SERVER_START_FAILED', type: 'failed' });
    expect(
      parseDesktopBackendStatus({
        code: 'SQLITE_ERROR: C:\\private\\eky.sqlite',
        type: 'failed',
      }),
    ).toBeUndefined();
  });
});
