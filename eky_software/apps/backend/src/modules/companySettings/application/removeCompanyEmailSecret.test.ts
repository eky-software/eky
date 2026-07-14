import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { removeCompanyEmailSecret } from './removeCompanyEmailSecret.js';

describe('removeCompanyEmailSecret', () => {
  it('removes the actor company secret between pending and succeeded audit states', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>();
    const auditWriter = createAuditWriter();
    const status = await removeCompanyEmailSecret(
      {
        actorContext: createEmailSecretActorContext(),
        occurredAt: '2026-07-14T20:00:00.000Z',
      },
      {
        companyEmailSecretAuditWriter: auditWriter,
        companyEmailSecretStore: createSecretStore({ removeSecret }),
      },
    );

    expect(removeSecret).toHaveBeenCalledWith('example-company');
    expect(auditWriter.startCompanyEmailSecretAuditOperation).toHaveBeenCalledWith({
      action: 'remove',
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
    expect(status).toEqual({ configured: false });
    expect(status).not.toHaveProperty('secret');
  });

  it('denies access before touching the secret store or audit', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>();
    const auditWriter = createAuditWriter();

    await expect(
      removeCompanyEmailSecret(
        {
          actorContext: createActorContext({
            actorId: 'local-user',
            authenticationMode: 'local',
            companyId: 'example-company',
            permissions: [],
          }),
          occurredAt: '2026-07-14T20:00:00.000Z',
        },
        {
          companyEmailSecretAuditWriter: auditWriter,
          companyEmailSecretStore: createSecretStore({ removeSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(removeSecret).not.toHaveBeenCalled();
    expect(auditWriter.startCompanyEmailSecretAuditOperation).not.toHaveBeenCalled();
  });

  it('marks the pending audit failed with a safe code when removal fails', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>(
      async () => {
        throw new Error('Synthetic secret store failure with private details.');
      },
    );
    const auditWriter = createAuditWriter();

    await expect(
      removeCompanyEmailSecret(
        {
          actorContext: createEmailSecretActorContext(),
          occurredAt: '2026-07-14T20:00:00.000Z',
        },
        {
          companyEmailSecretAuditWriter: auditWriter,
          companyEmailSecretStore: createSecretStore({ removeSecret }),
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
      }),
    );

    expect(auditWriter.completeCompanyEmailSecretAuditOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: 'SECRET_OPERATION_FAILED',
        status: 'failed',
      }),
    );
  });
});

function createAuditWriter(): CompanyEmailSecretAuditWriter {
  return {
    completeCompanyEmailSecretAuditOperation: vi.fn(async () => undefined),
    startCompanyEmailSecretAuditOperation: vi.fn(async () => undefined),
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
