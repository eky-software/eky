import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import type { CompanyEmailSecretAuditWriter } from '../ports/companyEmailSecretAuditWriter.js';
import { setCompanyEmailSecret } from './setCompanyEmailSecret.js';

describe('setCompanyEmailSecret', () => {
  it('stores the unchanged secret for the actor company', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const appendAuditEvent = vi.fn<
      CompanyEmailSecretAuditWriter['appendCompanyEmailSecretAuditEvent']
    >();
    const status = await setCompanyEmailSecret(
      {
        actorContext: createEmailSecretActorContext(),
        occurredAt: '2026-07-14T20:00:00.000Z',
        secret: '  synthetic password  ',
      },
      {
        companyEmailSecretAuditWriter: createAuditWriter(appendAuditEvent),
        companyEmailSecretStore: createSecretStore({ setSecret }),
      },
    );

    expect(setSecret).toHaveBeenCalledWith({
      companyId: 'example-company',
      secret: '  synthetic password  ',
    });
    expect(appendAuditEvent).toHaveBeenCalledWith({
      actorId: 'local-user',
      companyId: 'example-company',
      eventType: 'company_email_secret_set',
      occurredAt: '2026-07-14T20:00:00.000Z',
    });
    expect(appendAuditEvent.mock.calls[0]?.[0]).not.toHaveProperty('secret');
    expect(status).toEqual({ configured: true });
    expect(status).not.toHaveProperty('secret');
  });

  it('denies access before touching the secret store', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const appendAuditEvent = vi.fn<
      CompanyEmailSecretAuditWriter['appendCompanyEmailSecretAuditEvent']
    >();

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
          companyEmailSecretAuditWriter: createAuditWriter(appendAuditEvent),
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(setSecret).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('does not store an invalid secret', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const appendAuditEvent = vi.fn<
      CompanyEmailSecretAuditWriter['appendCompanyEmailSecretAuditEvent']
    >();

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createEmailSecretActorContext(),
          occurredAt: '2026-07-14T20:00:00.000Z',
          secret: '',
        },
        {
          companyEmailSecretAuditWriter: createAuditWriter(appendAuditEvent),
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toThrow('Email secret is required.');
    expect(setSecret).not.toHaveBeenCalled();
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
