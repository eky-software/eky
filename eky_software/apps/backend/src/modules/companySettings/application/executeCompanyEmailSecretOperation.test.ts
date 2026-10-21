import { createActorContext } from '@eky/auth';
import { describe, expect, it, vi } from 'vitest';

import { CompanyEmailSecretStoreError } from '../ports/companyEmailSecretStoreError.js';
import { executeCompanyEmailSecretOperation } from './executeCompanyEmailSecretOperation.js';

const actorContext = createActorContext({
  actorId: 'test-actor', authenticationMode: 'local', companyId: 'test-company',
  permissions: ['manageCompanyEmailSecret'],
});

function setup() {
  const writer = {
    startCompanyEmailSecretAuditOperation: vi.fn(async () => undefined),
    completeCompanyEmailSecretAuditOperation: vi.fn(async (): Promise<void> => undefined),
  };
  const run = (operation: (operationId: string) => Promise<void>, action: 'set' | 'remove' = 'set') =>
    executeCompanyEmailSecretOperation({
      action, actorContext, companyEmailSecretAuditWriter: writer,
      occurredAt: '2026-10-20T10:00:00.000Z', operation,
    });
  return { run, writer };
}

describe('secret operation outcome ownership', () => {
  for (const action of ['set', 'remove'] as const) {
    it.each(['unclassified', 'unknown'] as const)(`${action}: preserves pending for %s effect`, async kind => {
      const { run, writer } = setup();
      await expect(run(async () => {
        throw kind === 'unknown' ? new CompanyEmailSecretStoreError() : new Error('synthetic-private-cause');
      }, action)).rejects.toMatchObject({ code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' });
      expect(writer.startCompanyEmailSecretAuditOperation).toHaveBeenCalledOnce();
      expect(writer.completeCompanyEmailSecretAuditOperation).not.toHaveBeenCalled();
    });
  }

  it('does not call storage when pending audit cannot be created', async () => {
    const { run, writer } = setup();
    const failure = new Error('synthetic-audit-start');
    writer.startCompanyEmailSecretAuditOperation.mockRejectedValueOnce(failure);
    const operation = vi.fn(async () => undefined);
    await expect(run(operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
    expect(writer.completeCompanyEmailSecretAuditOperation).not.toHaveBeenCalled();
  });

  it.each(['success', 'noEffect'] as const)('keeps incomplete audit distinct after %s', async outcome => {
    const { run, writer } = setup();
    writer.completeCompanyEmailSecretAuditOperation.mockRejectedValueOnce(new Error('synthetic-audit-end'));
    await expect(run(async () => {
      if (outcome === 'noEffect') throw new CompanyEmailSecretStoreError('noEffect');
    })).rejects.toMatchObject({ code: 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE' });
    expect(writer.completeCompanyEmailSecretAuditOperation).toHaveBeenCalledOnce();
  });

  it('does not settle the application operation before final audit completes', async () => {
    const { run, writer } = setup();
    let finish!: () => void;
    writer.completeCompanyEmailSecretAuditOperation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    let settled = false;
    const operation = run(async () => undefined).then(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(writer.completeCompanyEmailSecretAuditOperation).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
    } finally {
      finish?.();
      await operation;
    }
    expect(settled).toBe(true);
  });
});
