import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createProfileSnapshotBrokerReady,
  createProfileSnapshotBrokerRequest,
  parseProfileSnapshotBrokerReady,
  parseProfileSnapshotBrokerRequest,
  parseProfileSnapshotBrokerResponse,
  profileSnapshotBrokerProtocolVersion,
} from './profileSnapshotBrokerProtocol.js';

describe('profile snapshot broker protocol', () => {
  it('accepts only the exact versioned ready handshake', () => {
    expect(
      parseProfileSnapshotBrokerReady(
        createProfileSnapshotBrokerReady(),
      ),
    ).toEqual({
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      type: 'profileSnapshotBrokerReady',
    });
    expect(
      parseProfileSnapshotBrokerReady({
        protocolVersion: profileSnapshotBrokerProtocolVersion - 1,
        type: 'profileSnapshotBrokerReady',
      }),
    ).toBeUndefined();
    expect(
      parseProfileSnapshotBrokerReady({
        path: 'C:\\private',
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        type: 'profileSnapshotBrokerReady',
      }),
    ).toBeUndefined();
  });

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
        operation: 'createProfileSnapshot',
        operationId,
        requestId,
      }),
    ).toMatchObject({
      operation: 'createProfileSnapshot',
      operationId,
    });
    expect(
      createProfileSnapshotBrokerRequest({
        operation: 'prepareProfileRestoreActivation',
        operationId,
        requestId,
      }),
    ).toMatchObject({
      operation: 'prepareProfileRestoreActivation',
      operationId,
    });
    expect(
      createProfileSnapshotBrokerRequest({
        operation: 'validateProfileSnapshot',
        operationId,
        requestId,
      }),
    ).toMatchObject({
      operation: 'validateProfileSnapshot',
      operationId,
    });
    expect(
      createProfileSnapshotBrokerRequest({
        operation: 'validateActiveProfile',
        requestId,
      }),
    ).toEqual({
      operation: 'validateActiveProfile',
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
        result: {
          artifactCatalog: {
            artifactCount: 1,
            artifactTotalByteSize: 2_048,
            catalogByteSize: 512,
            logicalPath: 'snapshot-catalog-v1.json',
            sha256: 'b'.repeat(64),
          },
          database: {
            databaseByteSize: 8_192,
            logicalPath: 'profile.sqlite',
            sha256: 'a'.repeat(64),
            totalPages: 2,
          },
          type: 'profileSnapshot',
        },
      }),
    ).toMatchObject({
      ok: true,
      result: {
        artifactCatalog: {
          artifactCount: 1,
          artifactTotalByteSize: 2_048,
        },
        database: {
          databaseByteSize: 8_192,
          logicalPath: 'profile.sqlite',
        },
        type: 'profileSnapshot',
      },
    });
    expect(
      parseProfileSnapshotBrokerResponse({
        ok: true,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        result: {
          artifactCount: 2,
          artifactTotalByteSize: 4_096,
          type: 'profileRestoreActivationPrepared',
        },
      }),
    ).toEqual({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: {
        artifactCount: 2,
        artifactTotalByteSize: 4_096,
        type: 'profileRestoreActivationPrepared',
      },
    });
    expect(
      parseProfileSnapshotBrokerResponse({
        ok: true,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        result: {
          artifactCount: 2,
          artifactTotalByteSize: 4_096,
          databaseHealth: 'healthy',
          migrationChainIdentity: 'c'.repeat(64),
          type: 'activeProfileValidation',
        },
      }),
    ).toEqual({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: {
        artifactCount: 2,
        artifactTotalByteSize: 4_096,
        databaseHealth: 'healthy',
        migrationChainIdentity: 'c'.repeat(64),
        type: 'activeProfileValidation',
      },
    });
    expect(
      parseProfileSnapshotBrokerResponse({
        ok: true,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        result: {
          artifactCatalog: {
            artifactCount: 1,
            artifactTotalByteSize: 2_048,
            catalogByteSize: 512,
            logicalPath: 'snapshot-catalog-v1.json',
            sha256: 'b'.repeat(64),
          },
          database: {
            databaseByteSize: 8_192,
            logicalPath: 'profile.sqlite',
            sha256: 'a'.repeat(64),
            totalPages: 2,
          },
          filePath: 'C:\\private\\profile.sqlite',
          type: 'profileSnapshot',
        },
      }),
    ).toBeUndefined();
    expect(
      parseProfileSnapshotBrokerResponse({
        ok: true,
        protocolVersion: profileSnapshotBrokerProtocolVersion,
        requestId,
        result: {
          activeProfileIsEmpty: false,
          artifactCount: 2,
          artifactTotalByteSize: 4_096,
          databaseHealth: 'healthy',
          migrationChainIdentity: 'c'.repeat(64),
          profileId: 'd'.repeat(64),
          profileMatchesActive: false,
          type: 'profileSnapshotValidation',
        },
      }),
    ).toEqual({
      ok: true,
      protocolVersion: profileSnapshotBrokerProtocolVersion,
      requestId,
      result: {
        activeProfileIsEmpty: false,
        artifactCount: 2,
        artifactTotalByteSize: 4_096,
        databaseHealth: 'healthy',
        migrationChainIdentity: 'c'.repeat(64),
        profileId: 'd'.repeat(64),
        profileMatchesActive: false,
        type: 'profileSnapshotValidation',
      },
    });
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
