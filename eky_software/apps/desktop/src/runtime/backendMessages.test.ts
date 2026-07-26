import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseDesktopBackendCommand,
  parseDesktopBackendStatus,
} from './backendMessages.js';

describe('desktop backend process messages', () => {
  it('accepts only absolute trusted runtime paths', () => {
    const runtimeRoot = resolve('desktop-test-runtime');

    expect(
      parseDesktopBackendCommand({
        config: {
          appVersion: '0.0.0',
          backendRoot: resolve(runtimeRoot, 'backend'),
          createSmokePdf: true,
          databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
          invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
          migrationsDirectory: resolve(
            runtimeRoot,
            'backend',
            'dist',
            'database',
            'migrations',
          ),
          operationalLogsRoot: resolve(runtimeRoot, 'logs'),
          runtimeSessionSecret: 'a'.repeat(43),
          smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
        },
        type: 'start',
      }),
    ).toBeDefined();
    expect(
      parseDesktopBackendCommand({
        config: {
          appVersion: '0.0.0',
          backendRoot: '..\\backend',
          createSmokePdf: true,
          databaseFilePath: 'eky.sqlite',
          invoiceDocumentStorageRoot: 'storage',
          migrationsDirectory: 'migrations',
          operationalLogsRoot: 'logs',
          runtimeSessionSecret: 'a'.repeat(43),
          smokePdfPath: 'invoice.pdf',
        },
        type: 'start',
      }),
    ).toBeUndefined();
  });

  it('requires a valid private runtime session in the start message', () => {
    const runtimeRoot = resolve('desktop-test-runtime');
    const createCommand = (runtimeSessionSecret: unknown) => ({
      config: {
        appVersion: '0.0.0',
        backendRoot: resolve(runtimeRoot, 'backend'),
        createSmokePdf: false,
        databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
        invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
        migrationsDirectory: resolve(runtimeRoot, 'migrations'),
        operationalLogsRoot: resolve(runtimeRoot, 'logs'),
        runtimeSessionSecret,
        smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
      },
      type: 'start',
    });

    expect(parseDesktopBackendCommand(createCommand('a'.repeat(43)))).toBeDefined();
    expect(parseDesktopBackendCommand(createCommand(undefined))).toBeUndefined();
    expect(parseDesktopBackendCommand(createCommand('too-short'))).toBeUndefined();
  });

  it('rejects malformed readiness messages', () => {
    expect(
      parseDesktopBackendStatus({ port: 32100, smokePdfCreated: true, type: 'ready' }),
    ).toBeUndefined();
    expect(
      parseDesktopBackendStatus({
        port: 32100,
        smokePdfCreated: true,
        smokeSecretBrokerVerified: true,
        type: 'ready',
      }),
    ).toEqual({
      port: 32100,
      smokePdfCreated: true,
      smokeSecretBrokerVerified: true,
      type: 'ready',
    });
    expect(parseDesktopBackendStatus({ port: 0, type: 'ready' })).toBeUndefined();
    expect(parseDesktopBackendStatus({ error: 'sensitive details', type: 'failed' })).toBeUndefined();
  });

  it('accepts only predefined safe backend failure codes', () => {
    expect(
      parseDesktopBackendStatus({
        code: 'BACKEND_SECRET_BROKER_FAILED',
        type: 'failed',
      }),
    ).toEqual({ code: 'BACKEND_SECRET_BROKER_FAILED', type: 'failed' });
    expect(
      parseDesktopBackendStatus({
        code: 'SQLITE_ERROR: C:\\private\\eky.sqlite',
        type: 'failed',
      }),
    ).toBeUndefined();
  });
});
