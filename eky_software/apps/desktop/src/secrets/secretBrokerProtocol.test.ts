import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createSecretBrokerRequest,
  parseSecretBrokerRequest,
  parseSecretBrokerResponse,
  secretBrokerProtocolVersion,
} from './secretBrokerProtocol.js';

describe('secretBrokerProtocol', () => {
  it('accepts only the four explicit operations and exact fields', () => {
    const requestId = randomUUID();

    expect(
      parseSecretBrokerRequest({
        companyId: 'example-company',
        operation: 'hasCompanyEmailSecret',
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeDefined();
    expect(
      parseSecretBrokerRequest({
        companyId: 'example-company',
        operation: 'listSecrets',
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
    expect(
      parseSecretBrokerRequest({
        companyId: 'example-company',
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
      operation: 'setCompanyEmailSecret',
      requestId,
      secret: '  synthetic-password  ',
    });

    expect(request).toEqual(
      expect.objectContaining({ secret: '  synthetic-password  ' }),
    );
    expect(
      parseSecretBrokerRequest({ ...request, secret: 'line\nbreak' }),
    ).toBeUndefined();
    expect(
      parseSecretBrokerRequest({ ...request, secret: '😀'.repeat(1_025) }),
    ).toBeUndefined();
  });

  it('rejects malformed ids, company ids, versions, and unknown response fields', () => {
    const requestId = randomUUID();
    const request = createSecretBrokerRequest({
      companyId: 'example-company',
      operation: 'hasCompanyEmailSecret',
      requestId,
    });

    expect(parseSecretBrokerRequest({ ...request, requestId: 'unsafe' })).toBeUndefined();
    expect(parseSecretBrokerRequest({ ...request, companyId: ' company ' })).toBeUndefined();
    expect(parseSecretBrokerRequest({ ...request, protocolVersion: 2 })).toBeUndefined();
    expect(
      parseSecretBrokerResponse({
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
        errorCode: 'SECRET_STORAGE_UNAVAILABLE',
        ok: false,
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeDefined();
    expect(
      parseSecretBrokerResponse({
        errorCode: 'C:\\private\\secret.dat',
        ok: false,
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
  });
});
