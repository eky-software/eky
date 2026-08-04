import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createProfileSnapshotBrokerRequest,
  parseProfileSnapshotBrokerRequest,
  parseProfileSnapshotBrokerResponse,
  profileSnapshotBrokerProtocolVersion,
} from './profileSnapshotBrokerProtocol.js';

describe('profile snapshot broker protocol', () => {
  it('accepts only the named maintenance operations and exact fields', () => {
    const requestId = randomUUID();
    const operationId = randomUUID();

    expect(
      createProfileSnapshotBrokerRequest({
        operation: 'beginProfileMaintenance',
        operationId,
        requestId,
      }),
    ).toEqual({
      operation: 'beginProfileMaintenance',
      operationId,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
    });
    expect(
      parseProfileSnapshotBrokerRequest({
        operation: 'openFile',
        path: 'C:\\private',
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
  });

  it('rejects nulls, unknown fields and malformed identifiers', () => {
    const requestId = randomUUID();

    expect(
      parseProfileSnapshotBrokerRequest({
        operation: 'getProfileMaintenanceStatus',
        operationId: null,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
    expect(
      parseProfileSnapshotBrokerRequest({
        operation: 'beginProfileMaintenance',
        operationId: '../profile',
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
    expect(
      parseProfileSnapshotBrokerRequest({
        operation: 'getProfileMaintenanceStatus',
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        url: 'file:///private',
      }),
    ).toBeUndefined();
  });

  it('rejects malformed and over-specified responses', () => {
    const requestId = randomUUID();

    expect(
      parseProfileSnapshotBrokerResponse({
        ok: true,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        result: { status: 'normal', operationId: null },
      }),
    ).toBeUndefined();
    expect(
      parseProfileSnapshotBrokerResponse({
        errorCode: 'RAW_INTERNAL_ERROR',
        ok: false,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
      }),
    ).toBeUndefined();
  });
});
