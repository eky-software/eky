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
      createProfileSnapshotBrokerRequest({
        operation: 'createSqliteSnapshot',
        operationId,
        requestId,
      }),
    ).toMatchObject({
      operation: 'createSqliteSnapshot',
      operationId,
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
        result: {
          databaseByteSize: 8_192,
          logicalPath: 'profile.sqlite',
          sha256: 'a'.repeat(64),
          totalPages: 2,
          type: 'sqliteSnapshot',
        },
      }),
    ).toMatchObject({
      ok: true,
      result: {
        databaseByteSize: 8_192,
        logicalPath: 'profile.sqlite',
        sha256: 'a'.repeat(64),
        totalPages: 2,
        type: 'sqliteSnapshot',
      },
    });
    expect(
      parseProfileSnapshotBrokerResponse({
        ok: true,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        result: {
          databaseByteSize: 8_192,
          filePath: 'C:\\private\\profile.sqlite',
          logicalPath: 'profile.sqlite',
          sha256: 'a'.repeat(64),
          totalPages: 2,
          type: 'sqliteSnapshot',
        },
      }),
    ).toBeUndefined();
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
