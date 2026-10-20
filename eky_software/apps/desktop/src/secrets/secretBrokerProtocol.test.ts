import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createSecretBrokerRequest,
  parseSecretBrokerRequest,
  parseSecretBrokerResponse,
  secretBrokerProtocolVersion,
} from './secretBrokerProtocol.js';

describe('secretBrokerProtocol', () => {
  const generationId = randomUUID();
  it('accepts only the four explicit operations and exact fields', () => {
    const requestId = randomUUID();

    expect(
      parseSecretBrokerRequest({
        companyId: 'example-company',
        generationId,
        operation: 'hasCompanyEmailSecret',
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeDefined();
    expect(
      parseSecretBrokerRequest({
        companyId: 'example-company',
        generationId,
        operation: 'listSecrets',
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
    expect(
      parseSecretBrokerRequest({
        companyId: 'example-company',
        generationId,
        operation: 'hasCompanyEmailSecret',
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
        secret: 'unexpected',
      }),
    ).toBeUndefined();
  });

  it('preserves secret whitespace while rejecting controls and oversized input', () => {
    const requestId = randomUUID();
    const request = createSecretBrokerRequest({
      companyId: 'example-company',
      generationId,
      operation: 'setCompanyEmailSecret',
      requestId,
      secret: '  synthetic-password  ',
    });

    expect('secret' in request && request.secret === '  synthetic-password  ').toBe(true);
    expect(
      parseSecretBrokerRequest({ ...request, secret: 'line\nbreak' }) === undefined,
    ).toBe(true);
    expect(
      parseSecretBrokerRequest({ ...request, secret: '😀'.repeat(1_025) }) === undefined,
    ).toBe(true);
  });

  it('rejects malformed ids, company ids, versions, and unknown response fields', () => {
    const requestId = randomUUID();
    const request = createSecretBrokerRequest({
      companyId: 'example-company',
      generationId,
      operation: 'hasCompanyEmailSecret',
      requestId,
    });

    expect(parseSecretBrokerRequest({ ...request, requestId: 'unsafe' })).toBeUndefined();
    expect(parseSecretBrokerRequest({ ...request, companyId: ' company ' })).toBeUndefined();
    expect(parseSecretBrokerRequest({ ...request, protocolVersion: 1 })).toBeUndefined();
    expect(
      parseSecretBrokerResponse({
        companyId: 'example-company', generationId, operation: 'hasCompanyEmailSecret',
        ok: true,
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
        result: { configured: true },
        technicalDetails: 'must not cross the broker',
      }),
    ).toBeUndefined();
  });

  it('accepts only predefined safe error codes', () => {
    const requestId = randomUUID();

    expect(
      parseSecretBrokerResponse({
        companyId: 'example-company', generationId, operation: 'hasCompanyEmailSecret', effect: 'unknown',
        errorCode: 'SECRET_STORAGE_UNAVAILABLE',
        ok: false,
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeDefined();
    expect(
      parseSecretBrokerResponse({
        companyId: 'example-company', generationId, operation: 'hasCompanyEmailSecret', effect: 'unknown',
        errorCode: 'C:\\private\\secret.dat',
        ok: false,
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
  });

  it.each([
    ['setCompanyEmailSecret', { configured: true }, true],
    ['setCompanyEmailSecret', { configured: false }, false],
    ['removeCompanyEmailSecret', { configured: false }, true],
    ['removeCompanyEmailSecret', { configured: true }, false],
    ['hasCompanyEmailSecret', { configured: false }, true],
    ['hasCompanyEmailSecret', { secret: null }, false],
    ['readCompanyEmailSecret', { secret: null }, true],
    ['readCompanyEmailSecret', { secret: 'synthetic' }, true],
    ['readCompanyEmailSecret', { configured: true }, false],
  ])('validates the operation-specific result for %s (case %#)', (operation, result, accepted) => {
    expect(parseSecretBrokerResponse({
      companyId: 'example-company', generationId, operation, result,
      ok: true, protocolVersion: secretBrokerProtocolVersion, requestId: randomUUID(),
    }) !== undefined).toBe(accepted);
  });

  it('requires every v2 binding field and explicit effect in error responses', () => {
    const response = {
      companyId: 'example-company', generationId, operation: 'hasCompanyEmailSecret',
      protocolVersion: secretBrokerProtocolVersion, requestId: randomUUID(),
      ok: false, effect: 'noEffect', errorCode: 'SECRET_STORAGE_UNAVAILABLE',
    };
    for (const key of Object.keys(response)) {
      const malformed: Record<string, unknown> = { ...response };
      delete malformed[key];
      expect(parseSecretBrokerResponse(malformed) === undefined).toBe(true);
    }
    expect(parseSecretBrokerResponse({ ...response, effect: 'none' })).toBeUndefined();
  });

  it.each([undefined, null, '', 'invalid', '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid or absent request generation (case %#)', value => {
      expect(parseSecretBrokerRequest({
        companyId: 'example-company', generationId: value, operation: 'hasCompanyEmailSecret',
        protocolVersion: secretBrokerProtocolVersion, requestId: randomUUID(),
      }) === undefined).toBe(true);
    },
  );
});
