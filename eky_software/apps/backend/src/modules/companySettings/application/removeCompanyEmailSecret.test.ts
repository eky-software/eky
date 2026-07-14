import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { removeCompanyEmailSecret } from './removeCompanyEmailSecret.js';

describe('removeCompanyEmailSecret', () => {
  it('removes the secret from the actor company without returning it', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>();
    const appendAuditEvent = vi.fn<
      CompanyEmailSecretAuditWriter['appendCompanyEmailSecretAuditEvent']
    >();
    const status = await removeCompanyEmailSecret(
      {
        actorContext: createEmailSecretActorContext(),
        occurredAt: '2026-07-14T20:00:00.000Z',
      },
      {
        companyEmailSecretAuditWriter: createAuditWriter(appendAuditEvent),
        companyEmailSecretStore: createSecretStore({ removeSecret }),
      },
    );

    expect(removeSecret).toHaveBeenCalledWith('example-company');
    expect(appendAuditEvent).toHaveBeenCalledWith({
      actorId: 'local-user',
      companyId: 'example-company',
      eventType: 'company_email_secret_removed',
      occurredAt: '2026-07-14T20:00:00.000Z',
    });
    expect(appendAuditEvent.mock.calls[0]?.[0]).not.toHaveProperty('secret');
    expect(status).toEqual({ configured: false });
    expect(status).not.toHaveProperty('secret');
  });

  it('denies access before touching the secret store', async () => {
    const removeSecret = vi.fn<CompanyEmailSecretStore['removeSecret']>();
    const appendAuditEvent = vi.fn<
      CompanyEmailSecretAuditWriter['appendCompanyEmailSecretAuditEvent']
    >();

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
          companyEmailSecretAuditWriter: createAuditWriter(appendAuditEvent),
          companyEmailSecretStore: createSecretStore({ removeSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(removeSecret).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });
});

function createAuditWriter(
  appendCompanyEmailSecretAuditEvent: CompanyEmailSecretAuditWriter['appendCompanyEmailSecretAuditEvent'] =
    vi.fn(async () => undefined),
): CompanyEmailSecretAuditWriter {
  return { appendCompanyEmailSecretAuditEvent };
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
