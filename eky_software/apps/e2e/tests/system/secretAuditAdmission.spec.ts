import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { createSecretAdmissionCompositionFixture } from '../../../backend/e2e/createSecretAdmissionCompositionFixture.js';
import { CompanyEmailSecretStoreError } from '../../../backend/src/modules/companySettings/ports/companyEmailSecretStoreError.js';
import { CompanyEmailSecretBrokerClient } from '../../../desktop/src/secrets/secretBrokerClient.js';
import { SecretBrokerError } from '../../../desktop/src/secrets/secretBrokerErrors.js';
import { readSecretBrokerBinding } from '../../../desktop/src/secrets/secretBrokerProtocol.js';
import { ControlledSecretTransport, createSecretGate } from '../../../desktop/src/secrets/secretBrokerTestSupport.js';

test('SYS-SECRET-ADMISSION-001 @critical @security fences queued mutations on audit failure without losing the active audit', async () => {
  const marker = process.env.EKY_E2E;
  process.env.EKY_E2E = '1';
  const transport = new ControlledSecretTransport();
  const client = new CompanyEmailSecretBrokerClient(transport, { generationId: randomUUID() });
  const admitted = [createSecretGate(), createSecretGate(), createSecretGate()];
  const requests: Promise<Response>[] = [];
  let fixture: Awaited<ReturnType<typeof createSecretAdmissionCompositionFixture>> | undefined;
  let calls = 0;
  let seals = 0;
  try {
    fixture = await createSecretAdmissionCompositionFixture({
      store: {
        hasSecret: companyId => client.hasSecret(companyId),
        setSecret: input => client.setSecret(input),
        async removeSecret(companyId, operationId) {
          const removal = client.removeSecret(companyId, operationId);
          admitted[calls++]?.resolve();
          try { await removal; }
          catch (error) {
            throw new CompanyEmailSecretStoreError(error instanceof SecretBrokerError ? error.effect : 'unknown');
          }
        },
      },
      sealAdmission() { seals++; client.sealAdmission(); },
    });
    const reply = () => transport.receive({
      ...readSecretBrokerBinding(transport.messages.at(-1)), ok: true, result: { configured: false },
    });
    for (const gate of admitted) {
      const request = fixture.remove();
      requests.push(request);
      await Promise.race([gate.promise, request.then(() => {
        throw new Error('Synthetic request completed before broker admission.');
      })]);
    }
    expect(transport.messages.length).toBe(1);
    reply(); // A settles; B is already dispatched before A's audit rejects.
    expect(transport.messages.length).toBe(2);
    expect((await requests[0]!).status).toBe(503);
    expect(await requests[0]!.then(response => response.json())).toMatchObject({ code: 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE' });
    expect(seals).toBe(1);
    expect((await requests[2]!).status).toBe(503);
    expect(await requests[2]!.then(response => response.json())).toMatchObject({ code: 'COMPANY_EMAIL_SECRET_OPERATION_FAILED' });
    expect(fixture.audit()).toEqual([{ status: 'pending' }, { status: 'pending' }, { status: 'failed' }]);
    expect(transport.closeCount).toBe(0);
    expect(() => client.assertSettled()).toThrow();
    reply();
    expect((await requests[1]!).status).toBe(200);
    expect(fixture.audit()).toEqual([{ status: 'pending' }, { status: 'succeeded' }, { status: 'failed' }]);
    expect((await fixture.remove()).status).toBe(503);
    expect(calls).toBe(3);
    expect(transport.messages.length).toBe(2);
    expect(() => client.assertSettled()).not.toThrow();
    expect(fixture.assertSettled).toThrow();
    expect(seals).toBe(1);
  } finally {
    try {
      client.close();
      await Promise.allSettled(requests);
    } finally {
      fixture?.close();
      if (marker === undefined) delete process.env.EKY_E2E;
      else process.env.EKY_E2E = marker;
    }
  }
});
