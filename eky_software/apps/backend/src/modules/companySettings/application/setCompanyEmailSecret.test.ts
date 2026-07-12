import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import type { CompanyEmailSecretStore } from '../ports/companyEmailSecretStore.js';
import { setCompanyEmailSecret } from './setCompanyEmailSecret.js';

describe('setCompanyEmailSecret', () => {
  it('stores the unchanged secret for the actor company', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();
    const status = await setCompanyEmailSecret(
      {
        actorContext: createEmailSecretActorContext(),
        secret: '  synthetic password  ',
      },
      {
        companyEmailSecretStore: createSecretStore({ setSecret }),
      },
    );

    expect(setSecret).toHaveBeenCalledWith({
      companyId: 'example-company',
      secret: '  synthetic password  ',
    });
    expect(status).toEqual({ configured: true });
    expect(status).not.toHaveProperty('secret');
  });

  it('denies access before touching the secret store', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createActorContext({
            actorId: 'local-user',
            authenticationMode: 'local',
            companyId: 'example-company',
            permissions: [],
          }),
          secret: 'synthetic-password',
        },
        {
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it('does not store an invalid secret', async () => {
    const setSecret = vi.fn<CompanyEmailSecretStore['setSecret']>();

    await expect(
      setCompanyEmailSecret(
        {
          actorContext: createEmailSecretActorContext(),
          secret: '',
        },
        {
          companyEmailSecretStore: createSecretStore({ setSecret }),
        },
      ),
    ).rejects.toThrow('Email secret is required.');
    expect(setSecret).not.toHaveBeenCalled();
  });
});

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
