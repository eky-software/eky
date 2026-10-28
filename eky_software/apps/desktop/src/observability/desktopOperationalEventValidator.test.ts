import { describe, expect, it } from 'vitest';

import { createDesktopOperationalEvent } from './createDesktopOperationalEvent.js';
import type { DesktopOperationalEventPayloadMap } from './desktopOperationalEvent.js';
import {
  DesktopOperationalEventValidationError,
  validateDesktopOperationalEvent,
} from './desktopOperationalEventValidator.js';
import { workspaceManagementOperationIds } from './workspaceManagementFailureContext.js';

type ManagementFailureCase = Pick<
  DesktopOperationalEventPayloadMap['workspaceManagement.operationFailed'],
  'operationId' | 'errorCode' | 'stage' | 'retryable'
>;

const options = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  eventId: 'desktop-event-1',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  timestamp: '2026-07-26T20:00:00.000Z',
};

describe('desktop operational event contracts', () => {
  const existingOperations = ['create', 'import', 'replace', 'switch', 'rename'] as const;
  const managementFailures = existingOperations.flatMap<ManagementFailureCase>(operation => [
    { operationId: workspaceManagementOperationIds[operation], errorCode: `WORKSPACE_MANAGEMENT_${operation.toUpperCase()}_FAILED`, stage: 'operation', retryable: false },
    { operationId: workspaceManagementOperationIds[operation], errorCode: 'WORKSPACE_MANAGEMENT_INVALID', stage: 'operation', retryable: false },
    { operationId: workspaceManagementOperationIds[operation], errorCode: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', stage: 'operation', retryable: false },
    { operationId: workspaceManagementOperationIds[operation], errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'operation', retryable: true },
    { operationId: workspaceManagementOperationIds[operation], errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage: 'admission', retryable: true },
  ]);
  const deletionFailures = (['admission', 'deletePreparation'] as const).flatMap<ManagementFailureCase>(stage => [
    { operationId: workspaceManagementOperationIds.delete, errorCode: 'WORKSPACE_MANAGEMENT_BUSY', stage, retryable: true },
    ...['WORKSPACE_MANAGEMENT_INVALID', 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'WORKSPACE_DELETE_FAILED']
      .map<ManagementFailureCase>(errorCode => ({ operationId: workspaceManagementOperationIds.delete, errorCode, stage, retryable: false })),
  ]);

  const namedFailures: ManagementFailureCase[] = [
    { operationId: workspaceManagementOperationIds.replace, errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', stage: 'lineageCheck', retryable: false },
    { operationId: workspaceManagementOperationIds.create, errorCode: 'WORKSPACE_CREATION_LABEL_EXISTS', stage: 'operation', retryable: false },
    { operationId: workspaceManagementOperationIds.import, errorCode: 'WORKSPACE_IMPORT_LABEL_EXISTS', stage: 'operation', retryable: false },
    ...(['create', 'import', 'rename'] as const).map<ManagementFailureCase>(operation => ({
      operationId: workspaceManagementOperationIds[operation], errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS', stage: 'operation', retryable: false,
    })),
  ];

  it.each([...managementFailures, ...deletionFailures, ...namedFailures])(
    'validates $operationId $errorCode at $stage without opening other operations', entry => {
      const event = createDesktopOperationalEvent({
        ...entry, eventName: 'workspaceManagement.operationFailed',
        correlationId: options.runtimeInstanceId, durationMs: 2, sideEffectState: 'unknown',
      }, options);
      expect(validateDesktopOperationalEvent(event)).toEqual(event);
      const none = { ...event, sideEffectState: 'none' };
      if (entry.operationId === 'workspace.delete' && entry.stage === 'deletePreparation' && !entry.retryable) {
        expect(() => validateDesktopOperationalEvent(none)).toThrow(DesktopOperationalEventValidationError);
      } else {
        expect(validateDesktopOperationalEvent(none)).toMatchObject({ sideEffectState: 'none' });
      }
      for (const change of [
        { category: 'backup' }, { component: 'backend' }, { level: 'info' }, { outcome: 'success' },
        { eventName: 'workspaceManagement.operationCompleted' },
        { eventName: 'workspaceManagement.operationPrepared' },
        { eventName: 'workspaceManagement.operationCancelled' },
        { operationId: 'workspace.deleteResume' }, { stage: 'deleteAuthorization' },
        { stage: 'deletePurge' }, { stage: 'deleteRegistry' }, { stage: 'deleteCleanup' },
        { correlationId: undefined }, { durationMs: undefined }, { operationId: undefined },
        { correlationId: 'synthetic-not-a-uuid' }, { durationMs: -1 }, { durationMs: 1.5 },
        { durationMs: Number.MAX_SAFE_INTEGER + 1 }, { errorCode: undefined },
        { retryable: !entry.retryable }, { sideEffectState: undefined }, { stage: undefined },
        { sideEffectState: 'committed' }, { sideEffectState: 'completed' }, { sideEffectState: 'rolledBack' },
        { rawError: 'synthetic-private' }, { cause: {} }, { stack: 'synthetic-private' },
        { workspaceId: 'synthetic-workspace' }, { workspaceLabel: 'Synthetic' },
        { lineageIdentity: 'synthetic-lineage' }, { inventory: [] }, { path: '/synthetic/private' },
        { fingerprint: 'synthetic-private' }, { companyId: 'synthetic-company' },
        ...(entry.operationId === 'workspace.delete'
          ? [{ stage: 'operation' }, { stage: 'lineageCheck' },
            ...['WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'WORKSPACE_MANAGEMENT_DELETE_FAILED',
              ...existingOperations.map(operation => `WORKSPACE_MANAGEMENT_${operation.toUpperCase()}_FAILED`),
              'WORKSPACE_CREATION_LABEL_EXISTS', 'WORKSPACE_IMPORT_LABEL_EXISTS', 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH',
              'WORKSPACE_MANAGEMENT_LABEL_EXISTS', 'WORKSPACE_DELETE_STALE_CONFIRMATION',
              'WORKSPACE_DELETE_BACKUP_UNAVAILABLE', 'WORKSPACE_DELETE_INVENTORY_INVALID',
              'WORKSPACE_DELETE_JOURNAL_CONFLICT', 'WORKSPACE_DELETE_IO_FAILED', 'WORKSPACE_DELETE_CLEANUP_FAILED']
              .map(errorCode => ({ errorCode }))]
          : [{ stage: 'deletePreparation' },
            { errorCode: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' }, { errorCode: 'WORKSPACE_DELETE_FAILED' }]),
        ...(entry.errorCode.endsWith('_LABEL_EXISTS')
          ? [{ stage: 'admission' }, { stage: 'lineageCheck' },
            ...Object.values(workspaceManagementOperationIds).filter(operationId => entry.errorCode === 'WORKSPACE_MANAGEMENT_LABEL_EXISTS'
              ? !['workspace.create', 'workspace.import', 'workspace.rename'].includes(operationId)
              : operationId !== entry.operationId).map(operationId => ({ operationId }))] : []),
        ...((entry.errorCode.endsWith('_FAILED') && entry.operationId !== 'workspace.delete') || entry.stage === 'lineageCheck'
          ? [{ operationId: entry.operationId === 'workspace.create' ? 'workspace.replace' : 'workspace.create' }, { stage: 'admission' }] : []),
      ]) expect(() => validateDesktopOperationalEvent({ ...event, ...change })).toThrow(DesktopOperationalEventValidationError);
    },
  );

  it.each(['acceptancePreparation', 'acceptanceCommit', 'acceptedCleanup'] as const)(
    'validates the closed acceptance failure at %s', stage => {
      const event = createDesktopOperationalEvent({
        eventName: 'restore.acceptanceFailed', stage, correlationId: options.runtimeInstanceId,
        durationMs: 1, errorCode: 'PROFILE_INSPECTION_TIMEOUT', retryable: false, sideEffectState: 'unknown',
      }, options);
      expect(validateDesktopOperationalEvent(event)).toEqual(event);
      for (const change of [
        { stage: 'restoredProfile' }, { correlationId: undefined }, { durationMs: undefined },
        { errorCode: 'PRIVATE_CODE' }, { retryable: undefined }, { retryable: true },
        { sideEffectState: undefined }, { sideEffectState: 'committed' },
        { companyId: 'synthetic-company' }, { rawError: 'synthetic raw error' },
      ]) expect(() => validateDesktopOperationalEvent({ ...event, ...change })).toThrow();
      expect(validateDesktopOperationalEvent({ ...event, errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED' }))
        .toMatchObject({ errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
    },
  );

  it('creates a catalog-owned desktop security event', () => {
    expect(
      createDesktopOperationalEvent(
        {
          eventName: 'applicationWindow.navigationBlocked',
          stage: 'will-navigate',
        },
        options,
      ),
    ).toEqual({
      appVersion: '0.0.0',
      buildRevision: '123456789abc',
      category: 'security',
      component: 'desktop',
      eventId: 'desktop-event-1',
      eventName: 'applicationWindow.navigationBlocked',
      level: 'warn',
      outcome: 'blocked',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      schemaVersion: 1,
      stage: 'will-navigate',
      timestamp: '2026-07-26T20:00:00.000Z',
    });
  });

  it('rejects unknown event names, fields and raw errors', () => {
    const event = createDesktopOperationalEvent(
      { eventName: 'desktop.starting' },
      options,
    );

    expect(() =>
      validateDesktopOperationalEvent({ ...event, extra: true }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        eventName: 'desktop.unknown',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() => validateDesktopOperationalEvent(new Error('synthetic'))).toThrow(
      DesktopOperationalEventValidationError,
    );
  });

  it('rejects events that omit a required payload field', () => {
    const event = createDesktopOperationalEvent(
      {
        errorCode: 'DESKTOP_FAILED',
        eventName: 'desktop.shutdownFailed',
      },
      options,
    );
    const { errorCode: _errorCode, ...withoutErrorCode } = event;

    expect(() =>
      validateDesktopOperationalEvent(withoutErrorCode),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('requires a safe correlation id for support bundle events', () => {
    const event = createDesktopOperationalEvent(
      {
        correlationId: '00000000-0000-4000-8000-000000000001',
        eventName: 'supportBundle.creationStarted',
        stage: 'create',
      },
      options,
    );
    const { correlationId: _correlationId, ...withoutCorrelationId } = event;

    expect(event).toMatchObject({
      category: 'supportBundle',
      correlationId: '00000000-0000-4000-8000-000000000001',
      eventName: 'supportBundle.creationStarted',
    });
    expect(() =>
      validateDesktopOperationalEvent(withoutCorrelationId),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it.each([
    ['password', 'synthetic'],
    ['authorization', 'Bearer synthetic'],
    ['details', 'raw details'],
  ])('rejects forbidden field %s', (key, value) => {
    const event = createDesktopOperationalEvent(
      { eventName: 'desktop.starting' },
      options,
    );

    expect(() =>
      validateDesktopOperationalEvent({ ...event, [key]: value }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it.each([
    'person@example.test',
    'FI07 2318 3500 0008 38',
    'C:\\Users\\Example\\Desktop',
  ])('rejects sensitive values: %s', (stage) => {
    expect(() =>
      createDesktopOperationalEvent(
        {
          errorCode: 'DESKTOP_FAILED',
          eventName: 'desktop.shutdownFailed',
          stage,
        },
        options,
      ),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('sanitizes control characters', () => {
    const event = createDesktopOperationalEvent(
      {
        errorCode: 'DESKTOP_FAILED',
        eventName: 'desktop.shutdownFailed',
        stage: 'shutdown\r\n\0finally',
      },
      options,
    );

    expect(event.stage).toBe('shutdownfinally');
  });

  it('allows only the classified permission request fields', () => {
    const event = createDesktopOperationalEvent(
      {
        eventName: 'electron.permissionRequestBlocked',
        frameClass: 'mainFrame',
        originClass: 'eky',
        permissionType: 'notifications',
        stage: 'request',
      },
      options,
    );

    expect(event).toMatchObject({
      eventName: 'electron.permissionRequestBlocked',
      frameClass: 'mainFrame',
      originClass: 'eky',
      permissionType: 'notifications',
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        permissionType: 'https://example.test/private',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('allows only a safe code in a bootstrap failure event', () => {
    const event = createDesktopOperationalEvent(
      {
        errorCode: 'DESKTOP_START_FAILED',
        eventName: 'desktop.bootstrapFailed',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'startup',
      },
      options,
    );

    expect(event).toMatchObject({
      errorCode: 'DESKTOP_START_FAILED',
      eventName: 'desktop.bootstrapFailed',
      outcome: 'failure',
    });
    expect(() =>
      createDesktopOperationalEvent(
        {
          errorCode: 'C:\\Users\\Example\\application.asar',
          eventName: 'desktop.bootstrapFailed',
        },
        options,
      ),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('accepts only data-minimized invoice PDF archive events', () => {
    const event = createDesktopOperationalEvent(
      {
        attemptCount: 2,
        durationMs: 35,
        errorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
        eventName: 'invoicePdfArchive.copyFailed',
        retryable: true,
        sideEffectState: 'none',
      },
      options,
    );

    expect(event).toMatchObject({
      attemptCount: 2,
      category: 'invoicePdfArchive',
      eventName: 'invoicePdfArchive.copyFailed',
      level: 'warn',
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        invoiceNumber: '20260001',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        attemptCount: -1,
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('accepts only catalogued recovery metadata', () => {
    const event = createDesktopOperationalEvent(
      {
        correlationId: '22222222-2222-4222-8222-222222222222',
        durationMs: 25,
        eventName: 'recoveryPoint.completed',
        recoveryPointKind: 'preRestore',
        stage: 'creation',
      },
      options,
    );

    expect(event).toMatchObject({
      category: 'recoveryPoint',
      recoveryPointKind: 'preRestore',
      stage: 'creation',
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        stage: 'C:\\Users\\Example\\backup',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        recoveryPointKind: 'customerInvoice',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        manifest: { entries: ['private'] },
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('requires the closed restore activation failure contract', () => {
    const event = createDesktopOperationalEvent(
      {
        correlationId: '22222222-2222-4222-8222-222222222222',
        durationMs: 25,
        errorCode: 'PROFILE_RESTORE_ACTIVATION_FAILED',
        eventName: 'restore.activationFailed',
        retryable: false,
        sideEffectState: 'none',
        stage: 'activation',
      },
      options,
    );

    expect(event).toMatchObject({
      category: 'restore',
      eventName: 'restore.activationFailed',
      level: 'error',
      outcome: 'failure',
    });
    const withoutDuration = Object.fromEntries(
      Object.entries(event).filter(([key]) => key !== 'durationMs'),
    );
    expect(() => validateDesktopOperationalEvent(withoutDuration)).toThrow(
      DesktopOperationalEventValidationError,
    );
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        stage: 'startupRollback',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it.each(['activation', 'failedSafeJournal'] as const)(
    'allows recovery-required only with minimized metadata at %s', (stage) => {
    const event = createDesktopOperationalEvent(
      {
        correlationId: '22222222-2222-4222-8222-222222222222',
        errorCode: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
        eventName: 'restore.recoveryRequired',
        retryable: false,
        sideEffectState: 'unknown',
        stage,
      },
      options,
    );

    expect(event).toMatchObject({
      eventName: 'restore.recoveryRequired',
      stage,
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        journalPhase: 'failedSafe',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        retryable: true,
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        stage: 'staging',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });

  it('accepts only minimized update lifecycle events with a closed stage', () => {
    const event = createDesktopOperationalEvent(
      {
        correlationId: '22222222-2222-4222-8222-222222222222',
        durationMs: 42,
        errorCode: 'UPDATE_FIRST_START_FAILED',
        eventName: 'update.operationFailed',
        retryable: false,
        sideEffectState: 'unknown',
        stage: 'firstStartValidation',
      },
      options,
    );

    expect(event).toMatchObject({
      category: 'update',
      eventName: 'update.operationFailed',
      stage: 'firstStartValidation',
    });
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        stage: 'C:\\Users\\Example\\update',
      }),
    ).toThrow(DesktopOperationalEventValidationError);
    expect(() =>
      validateDesktopOperationalEvent({
        ...event,
        packageSha256: 'a'.repeat(64),
      }),
    ).toThrow(DesktopOperationalEventValidationError);
  });
});
