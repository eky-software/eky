import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  createWorkspaceCandidateShutdownCommand,
  createWorkspaceCandidateStartCommand,
  parseWorkspaceCandidateProcessCommand,
  parseWorkspaceCandidateProcessStatus,
  workspaceCandidateProtocolVersion,
} from './workspaceCandidateMessages.js';

const runtimeSession = 'a'.repeat(43);
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profileId = 'c'.repeat(64);
const migrationChainIdentity = 'd'.repeat(64);

function commonOperation() {
  const backendRoot = resolve('backend');
  const candidateRoot = resolve('private-candidate');
  return {
    appVersion: '0.2.6',
    artifactRoot: resolve(candidateRoot, 'artifacts'),
    backendRoot,
    buildRevision: 'development',
    candidateRoot,
    databaseFilePath: resolve(candidateRoot, 'profile.sqlite'),
    migrationsDirectory: resolve(
      backendRoot,
      'dist',
      'database',
      'migrations',
    ),
  };
}

function startCommand() {
  return createWorkspaceCandidateStartCommand({
    operation: {
      ...commonOperation(),
      operation: 'bootstrapEmpty',
    },
    operationId,
    requestId,
    runtimeSession,
  });
}

describe('workspace candidate process messages', () => {
  it('creates a versioned exact private start and shutdown contract', () => {
    const start = startCommand();
    const shutdown = createWorkspaceCandidateShutdownCommand({
      operationId,
      requestId,
      runtimeSession,
    });

    expect(parseWorkspaceCandidateProcessCommand(start)).toEqual(start);
    expect(parseWorkspaceCandidateProcessCommand(shutdown)).toEqual(shutdown);
    expect(start.protocolVersion).toBe(workspaceCandidateProtocolVersion);
    expect(Object.keys(start).sort()).toEqual([
      'operation',
      'operationId',
      'protocolVersion',
      'requestId',
      'runtimeSession',
      'type',
    ]);
  });

  it('rejects unknown operations, fields and non-contained private paths', () => {
    const start = startCommand();

    expect(
      parseWorkspaceCandidateProcessCommand({ ...start, backendUrl: 'x' }),
    ).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        operation: { ...start.operation, operation: 'rawSql' },
      }),
    ).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        operation: {
          ...start.operation,
          databaseFilePath: resolve('outside', 'profile.sqlite'),
        },
      }),
    ).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        operation: {
          ...start.operation,
          migrationsDirectory: resolve('outside', 'migrations'),
        },
      }),
    ).toBeUndefined();
  });

  it('requires canonical request and operation identifiers', () => {
    const start = startCommand();

    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        operationId: operationId.toUpperCase(),
      }),
    ).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        requestId: 'not-a-request-id',
      }),
    ).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        protocolVersion: workspaceCandidateProtocolVersion + 1,
      }),
    ).toBeUndefined();
  });

  it('rejects null, non-plain and prototype-bearing message values', () => {
    const start = startCommand();
    const nullPrototype = Object.assign(Object.create(null), start);
    const inherited = Object.assign(
      Object.create({ injected: true }),
      start,
    );

    expect(parseWorkspaceCandidateProcessCommand(null)).toBeUndefined();
    expect(parseWorkspaceCandidateProcessCommand(nullPrototype)).toBeUndefined();
    expect(parseWorkspaceCandidateProcessCommand(inherited)).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        operation: Object.assign(
          Object.create({ injected: true }),
          start.operation,
        ),
      }),
    ).toBeUndefined();
  });

  it('rejects oversized and non-serializable messages', () => {
    const start = startCommand();
    expect(
      parseWorkspaceCandidateProcessCommand({
        ...start,
        ignored: 'x'.repeat(40_000),
      }),
    ).toBeUndefined();

    const cyclic: Record<string, unknown> = { ...start };
    cyclic.self = cyclic;
    expect(parseWorkspaceCandidateProcessCommand(cyclic)).toBeUndefined();
  });

  it('accepts only bounded ready and request-scoped terminal statuses', () => {
    const ready = createWorkspaceCandidateReadyStatus();
    const completed = createWorkspaceCandidateCompletedStatus({
      operationId,
      requestId,
      result: {
        kind: 'migration',
        migrationChainIdentity,
        profileId,
      },
      runtimeSession,
    });
    const failed = createWorkspaceCandidateFailedStatus({
      operationId,
      requestId,
      runtimeSession,
    });

    expect(parseWorkspaceCandidateProcessStatus(ready)).toEqual(ready);
    expect(parseWorkspaceCandidateProcessStatus(completed)).toEqual(completed);
    expect(parseWorkspaceCandidateProcessStatus(failed)).toEqual(failed);
    expect(
      parseWorkspaceCandidateProcessStatus({ ...ready, requestId }),
    ).toBeUndefined();
    expect(
      parseWorkspaceCandidateProcessStatus({
        ...failed,
        code: 'RAW_SQLITE_FAILURE',
      }),
    ).toBeUndefined();
  });

  it('keeps paths and extra data out of readiness status', () => {
    const completed = {
      ...createWorkspaceCandidateCompletedStatus({
        operationId,
        requestId,
        result: {
          actorId: 'local-owner' as const,
          artifactRootHealth: 'ready' as const,
          companyId: 'local-company-1234567890abcdef1234567890abcdef',
          databaseHealth: 'healthy' as const,
          foreignKeyHealth: 'healthy' as const,
          kind: 'readiness' as const,
          migrationChainIdentity,
          profileId,
        },
        runtimeSession,
      }),
      result: {
        actorId: 'local-owner',
        artifactRootHealth: 'ready',
        companyId: 'local-company-1234567890abcdef1234567890abcdef',
        databaseHealth: 'healthy',
        foreignKeyHealth: 'healthy',
        kind: 'readiness',
        migrationChainIdentity,
        path: resolve('private'),
        profileId,
      },
    };

    expect(parseWorkspaceCandidateProcessStatus(completed)).toBeUndefined();
  });
});
