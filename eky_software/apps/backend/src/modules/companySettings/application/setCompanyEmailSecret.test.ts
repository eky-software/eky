import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import {
  CompanyEmailSecretOperationError,
} from './executeCompanyEmailSecretOperation.js';
import { setCompanyEmailSecret } from './setCompanyEmailSecret.js';

describe('setCompanyEmailSecret', () => {
  it('stores the unchanged secret between pending and succeeded audit states', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const auditWriter = createAuditWriter();
    const status = await setCompanyEmailSecret(
      {
        actorContext: createEmailSecretActorContext(),
        occurredAt: '2026-07-14T20:00:00.000Z',
        secret: '  synthetic password  ',
      },
      {
        companyEmailSecretAuditWriter: auditWriter,
        companyEmailSecretStore: createSecretStore({ setSecret }),
      },
    );

    expect(setSecret).toHaveBeenCalledWith({
      companyId: 'example-company',
      secret: '  synthetic password  ',
    });
    expect(auditWriter.startCompanyEmailSecretAuditOperation).toHaveBeenCalledWith({
      action: 'set',
      actorId: 'local-user',
      companyId: 'example-company',
      completedAt: null,
      failureCode: null,
      operationId: expect.any(String),
      startedAt: '2026-07-14T20:00:00.000Z',
      status: 'pending',
    });
    const operationId = vi.mocked(
      auditWriter.startCompanyEmailSecretAuditOperation,
    ).mock.calls[0]?.[0].operationId;
    expect(auditWriter.completeCompanyEmailSecretAuditOperation).toHaveBeenCalledWith({
      completedAt: '2026-07-14T20:00:00.000Z',
      failureCode: null,
      operationId,
      status: 'succeeded',
    });
    expect(
      vi.mocked(auditWriter.startCompanyEmailSecretAuditOperation).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      setSecret.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(
      vi.mocked(auditWriter.startCompanyEmailSecretAuditOperation).mock.calls[0]?.[0],
    ).not.toHaveProperty('secret');
    expect(status).toEqual({ configured: true });
    expect(status).not.toHaveProperty('secret');
  });

  it('denies access before touching the secret store or audit', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const auditWriter = createAuditWriter();

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createActorContext({
            actorId: 'local-user',
            authenticationMode: 'local',
            companyId: 'example-company',
            permissions: [],
          }),
          occurredAt: '2026-07-14T20:00:00.000Z',
          secret: 'synthetic-password',
        },
        {
          companyEmailSecretAuditWriter: auditWriter,
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(setSecret).not.toHaveBeenCalled();
    expect(auditWriter.startCompanyEmailSecretAuditOperation).not.toHaveBeenCalled();
  });

  it('rejects invalid input before touching the secret store or audit', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const auditWriter = createAuditWriter();

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createEmailSecretActorContext(),
          occurredAt: '2026-07-14T20:00:00.000Z',
          secret: '',
        },
        {
          companyEmailSecretAuditWriter: auditWriter,
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toThrow('Email secret is required.');
    expect(setSecret).not.toHaveBeenCalled();
    expect(auditWriter.startCompanyEmailSecretAuditOperation).not.toHaveBeenCalled();
  });

  it('marks the pending audit failed with a safe code when storage fails', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>(async () => {
      throw new Error('Synthetic secret store failure with private details.');
    });
    const auditWriter = createAuditWriter();

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createEmailSecretActorContext(),
          occurredAt: '2026-07-14T20:00:00.000Z',
          secret: 'synthetic-password',
        },
        {
          companyEmailSecretAuditWriter: auditWriter,
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
      }),
    );

    const operationId = vi.mocked(
      auditWriter.startCompanyEmailSecretAuditOperation,
    ).mock.calls[0]?.[0].operationId;
    expect(auditWriter.completeCompanyEmailSecretAuditOperation).toHaveBeenCalledWith({
      completedAt: '2026-07-14T20:00:00.000Z',
      failureCode: 'SECRET_OPERATION_FAILED',
      operationId,
      status: 'failed',
    });
    expect(
      vi.mocked(auditWriter.completeCompanyEmailSecretAuditOperation).mock.calls[0]?.[0],
    ).not.toEqual(
      expect.objectContaining({
        failureCode: expect.stringContaining('private'),
      }),
    );
  });

  it('leaves a successful store operation pending when audit completion fails', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const auditWriter = createAuditWriter({
      completeCompanyEmailSecretAuditOperation: vi.fn(async () => {
        throw new Error('Synthetic audit failure.');
      }),
    });

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createEmailSecretActorContext(),
          occurredAt: '2026-07-14T20:00:00.000Z',
          secret: 'synthetic-password',
        },
        {
          companyEmailSecretAuditWriter: auditWriter,
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(CompanyEmailSecretOperationError);
    expect(setSecret).toHaveBeenCalledOnce();
    expect(auditWriter.startCompanyEmailSecretAuditOperation).toHaveBeenCalledOnce();
    expect(auditWriter.completeCompanyEmailSecretAuditOperation).toHaveBeenCalledOnce();
  });
});

function createAuditWriter(
  overrides: Partial<CompanyEmailSecretAuditWriter> = {},
): CompanyEmailSecretAuditWriter {
  return {
    completeCompanyEmailSecretAuditOperation: vi.fn(async () => undefined),
    startCompanyEmailSecretAuditOperation: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createEmailSecretActorContext() {
  return createActorContext({
    actorId: 'local-user',
    authenticationMode: 'local',
    companyId: 'example-company',
    permissions: ['manageCompanyEmailSecret'],
  });
}

function createSecretStore(
  overrides: Partial<CompanyEmailSecretStore> = {},
): CompanyEmailSecretStore {
  return {
    hasSecret: vi.fn(async () => false),
    removeSecret: vi.fn(async () => undefined),
    setSecret: vi.fn(async () => undefined),
    ...overrides,
  };
}
