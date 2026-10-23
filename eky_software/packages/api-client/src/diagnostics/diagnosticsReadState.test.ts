import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type DiagnosticEventItem,
  type DiagnosticEventReadResult,
  type DiagnosticReadState,
  type RuntimeDiagnosticSummary,
} from '../index.js';
import { isDiagnosticReadState } from './diagnosticsReadState.js';

const complete: DiagnosticReadState = { status: 'complete', reasons: [] };
const availableStates: DiagnosticReadState[] = [
  complete,
  { status: 'partial', reasons: ['sourceUnavailable'] },
  { status: 'partial', reasons: ['invalidEntries'] },
  { status: 'partial', reasons: ['limitReached'] },
  { status: 'partial', reasons: ['sourceUnavailable', 'invalidEntries'] },
  { status: 'partial', reasons: ['sourceUnavailable', 'limitReached'] },
  { status: 'partial', reasons: ['invalidEntries', 'limitReached'] },
  { status: 'partial', reasons: ['sourceUnavailable', 'invalidEntries', 'limitReached'] },
  { status: 'partial', reasons: ['limitReached', 'invalidEntries', 'sourceUnavailable'] },
];
const unavailableStates: DiagnosticReadState[] = [
  { status: 'unavailable', reasons: ['notConfigured'] },
  { status: 'unavailable', reasons: ['sourceUnavailable'] },
];
const invalidReadStates: Array<[string, unknown]> = [
  ['missing state', undefined],
  ['null state', null],
  ['array state', []],
  ['string state', 'complete'],
  ['missing status', { reasons: [] }],
  ['unknown status', { status: 'healthy', reasons: [] }],
  ['missing reasons', { status: 'complete' }],
  ['null reasons', { status: 'partial', reasons: null }],
  ['object reasons', { status: 'partial', reasons: {} }],
  ['string reasons', { status: 'partial', reasons: 'invalidEntries' }],
  ['unknown field', { ...complete, message: 'synthetic-private-detail' }],
  ['unknown reason', { status: 'partial', reasons: ['unexpected'] }],
  ['raw reason text', { status: 'partial', reasons: ['synthetic private failure'] }],
  ['object reason', { status: 'partial', reasons: [{ code: 'invalidEntries' }] }],
  ['numeric reason', { status: 'partial', reasons: [1] }],
  ['null reason', { status: 'partial', reasons: [null] }],
  ['complete with reason', { status: 'complete', reasons: ['limitReached'] }],
  ['partial without reason', { status: 'partial', reasons: [] }],
  ['partial not configured', { status: 'partial', reasons: ['notConfigured'] }],
  ['partial mixed not configured', { status: 'partial', reasons: ['notConfigured', 'invalidEntries'] }],
  ['duplicate partial reason', { status: 'partial', reasons: ['sourceUnavailable', 'sourceUnavailable'] }],
  ['oversized reasons', { status: 'partial', reasons: ['sourceUnavailable', 'invalidEntries', 'limitReached', 'notConfigured'] }],
  ['unavailable without reason', { status: 'unavailable', reasons: [] }],
  ['unavailable invalid entries', { status: 'unavailable', reasons: ['invalidEntries'] }],
  ['unavailable limit reached', { status: 'unavailable', reasons: ['limitReached'] }],
  ['unavailable mixed reasons', { status: 'unavailable', reasons: ['notConfigured', 'sourceUnavailable'] }],
  ['duplicate unavailable reason', { status: 'unavailable', reasons: ['sourceUnavailable', 'sourceUnavailable'] }],
];

const event: DiagnosticEventItem = {
  category: 'runtime',
  component: 'backend',
  errorCode: null,
  eventName: 'backend.started',
  id: 'backend:synthetic-start',
  level: 'info',
  occurredAt: '2026-10-23T10:00:00.000Z',
  outcome: 'success',
};
const observedLogMetrics = {
  latestErrorAt: '2026-10-23T10:00:00.000Z',
  latestSecurityEventAt: '2026-10-23T10:01:00.000Z',
  latestWarningAt: '2026-10-23T10:02:00.000Z',
  operationalLogNewestMonth: '2026-10',
  operationalLogOldestMonth: '2026-09',
  operationalLogTotalBytes: 1024,
};

describe('diagnostics HTTP read state contract', () => {
  it('rejects sparse reasons at the shared validator', () => {
    expect(isDiagnosticReadState({ status: 'partial', reasons: new Array(1) })).toBe(false);
  });

  it.each(availableStates)('retains $status/$reasons with empty or observed events', async readState => {
    for (const diagnosticEvents of [[], [event]]) {
      const result: DiagnosticEventReadResult = { diagnosticEvents, readState };
      await expect(clientFor(result).listDiagnosticEvents()).resolves.toEqual(result);
    }
  });

  it.each(unavailableStates)('accepts unavailable/$reasons only without events', async readState => {
    const result: DiagnosticEventReadResult = { diagnosticEvents: [], readState };
    await expect(clientFor(result).listDiagnosticEvents()).resolves.toEqual(result);
    await expect(clientFor({ ...result, diagnosticEvents: [event] }).listDiagnosticEvents())
      .rejects.toBeInstanceOf(EkyApiError);
  });

  it.each(invalidReadStates)('rejects %s on both HTTP read boundaries', async (_label, readState) => {
    await expect(clientFor({ diagnosticEvents: [], readState }).listDiagnosticEvents())
      .rejects.toBeInstanceOf(EkyApiError);
    await expect(clientFor({ ...createSummary(complete), operationalLogReadState: readState }).getDiagnosticSummary())
      .rejects.toBeInstanceOf(EkyApiError);
  });

  it.each([
    {},
    [],
    null,
    { diagnosticEvents: [] },
    { readState: complete },
    { diagnosticEvents: null, readState: complete },
    { diagnosticEvents: {}, readState: complete },
    { diagnosticEvents: 'synthetic', readState: complete },
    { diagnosticEvents: [], readState: complete, rawError: 'synthetic-private-detail' },
  ].map(body => ({ body })))('rejects malformed or legacy event envelopes %#', async ({ body }) => {
    await expect(clientFor(body).listDiagnosticEvents()).rejects.toBeInstanceOf(EkyApiError);
  });

  it.each(availableStates)('keeps event validation strict for $status/$reasons', async readState => {
    for (const invalidEvent of [
      { ...event, eventName: 'backend.unknown' },
      { ...event, rawMetadata: { value: 'synthetic-private-detail' } },
      { ...event, correlationId: 'not-a-uuid' },
      { ...event, occurredAt: 'not-a-timestamp' },
      { ...event, errorCode: undefined },
      null,
    ]) {
      await expect(clientFor({ diagnosticEvents: [event, invalidEvent], readState }).listDiagnosticEvents())
        .rejects.toBeInstanceOf(EkyApiError);
    }
  });
});

describe('runtime summary operational log read state', () => {
  it.each(availableStates)('preserves observed metrics for $status/$reasons', async readState => {
    const summary = { ...createSummary(readState), ...observedLogMetrics };
    await expect(clientFor(summary).getDiagnosticSummary()).resolves.toEqual(summary);
  });

  it.each(availableStates)('accepts a readable empty root for $status/$reasons', async readState => {
    const summary = createSummary(readState);
    expect(summary.operationalLogsAvailable).toBe(true);
    await expect(clientFor(summary).getDiagnosticSummary()).resolves.toEqual(summary);
  });

  it.each(unavailableStates)('accepts unavailable/$reasons with no log observations', async readState => {
    const summary = createSummary(readState);
    await expect(clientFor(summary).getDiagnosticSummary()).resolves.toEqual(summary);
  });

  it.each(availableStates)('rejects unavailable metrics for $status/$reasons', async readState => {
    await expect(clientFor({ ...createSummary(readState), operationalLogsAvailable: false }).getDiagnosticSummary())
      .rejects.toBeInstanceOf(EkyApiError);
  });

  it.each(unavailableStates)('rejects every observed metric for unavailable/$reasons', async readState => {
    for (const [field, value] of Object.entries({ ...observedLogMetrics, operationalLogsAvailable: true })) {
      await expect(clientFor({ ...createSummary(readState), [field]: value }).getDiagnosticSummary())
        .rejects.toBeInstanceOf(EkyApiError);
    }
  });

  it('rejects unknown summary fields', async () => {
    await expect(clientFor({ ...createSummary(complete), unknown: true }).getDiagnosticSummary())
      .rejects.toBeInstanceOf(EkyApiError);
  });

  it.each([...availableStates, ...unavailableStates])('does not infer database health from $status/$reasons', async readState => {
    for (const databaseHealth of ['ok', 'failed', 'unavailable'] as const) {
      const summary = {
        ...createSummary(readState),
        databaseHealth,
        appliedMigrationCount: null,
        latestMigrationName: null,
      };
      await expect(clientFor(summary).getDiagnosticSummary()).resolves.toEqual(summary);
    }
    for (const change of [
      { databaseHealth: 'unknown' },
      { appliedMigrationCount: -1 },
      { latestMigrationName: 'unsafe/name' },
      { runtimeInstanceId: 'not-a-uuid' },
      { buildRevision: 'not a revision' },
    ]) {
      await expect(clientFor({ ...createSummary(readState), ...change }).getDiagnosticSummary())
        .rejects.toBeInstanceOf(EkyApiError);
    }
  });
});

function createSummary(operationalLogReadState: DiagnosticReadState): RuntimeDiagnosticSummary {
  return {
    appVersion: '0.3.0',
    appliedMigrationCount: 1,
    architecture: 'x64',
    buildCreatedAt: '2026-10-23T09:00:00.000Z',
    buildDirty: false,
    buildRevision: 'abcdef123456',
    databaseHealth: 'ok',
    electronVersion: null,
    latestErrorAt: null,
    latestMigrationName: '001_example.sql',
    latestSecurityEventAt: null,
    latestWarningAt: null,
    nodeVersion: 'v24.0.0',
    operationalLogNewestMonth: null,
    operationalLogOldestMonth: null,
    operationalLogReadState,
    operationalLogsAvailable: operationalLogReadState.status !== 'unavailable',
    operationalLogTotalBytes: 0,
    platform: 'synthetic',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}

function clientFor(body: unknown) {
  return createEkyApiClient({
    baseUrl: '',
    fetch: async () => new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}
