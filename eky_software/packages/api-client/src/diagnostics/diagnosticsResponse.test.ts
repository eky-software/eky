import { describe, expect, it } from 'vitest';

import { EkyApiError } from '../http.js';
import { readDiagnosticsResponse } from './diagnosticsResponse.js';
import type { DiagnosticEventDirection, DiagnosticEventReadResult, DiagnosticReadState } from './diagnosticsTypes.js';

const cursor = '0123456789abcdefghijklmnopqrst_-';
const complete: Extract<DiagnosticReadState, { status: 'complete' }> = { status: 'complete', reasons: [] };
const ready = {
  state: 'ready', diagnosticEvents: [], readState: complete,
  older: { state: 'end' }, newer: { state: 'end' },
} as const;
const responses: DiagnosticEventReadResult[] = [
  { state: 'scanning', cursor },
  { ...ready, diagnosticEvents: [] },
  { state: 'limited', diagnosticEvents: [], readState: { status: 'partial', reasons: ['limitReached'] } },
  { state: 'unavailable', diagnosticEvents: [], readState: { status: 'unavailable', reasons: ['notConfigured'] } },
  { state: 'unavailable', diagnosticEvents: [], readState: { status: 'unavailable', reasons: ['sourceUnavailable'] } },
];
const invalidCursors: unknown[] = [
  undefined, null, 1, [], {}, '', 'a'.repeat(31), 'a'.repeat(33),
  `${'a'.repeat(31)}+`, `${'a'.repeat(31)}/`, `${'a'.repeat(31)}=`,
  `${'a'.repeat(31)} `, `${'a'.repeat(31)}\n`, `${cursor}\n`,
];

describe('diagnostic browsing response envelope', () => {
  it.each(responses)('reads the exact $state envelope %#', response => {
    expect(readDiagnosticsResponse(response)).toEqual(response);
  });

  it.each(responses)('rejects extra and cross-variant fields for $state %#', response => {
    for (const [field, value] of Object.entries({
      cursor, diagnosticEvents: [], readState: complete,
      older: { state: 'end' }, newer: { state: 'end' },
      rawError: 'synthetic-private-detail', path: '/synthetic/private',
      companyId: 'synthetic-company', status: 'complete',
    })) {
      if (field in response) continue;
      expect(() => readDiagnosticsResponse({ ...response, [field]: value }))
        .toThrow(EkyApiError);
    }
    for (const field of Object.keys(response)) {
      const missing = { ...response } as Record<string, unknown>;
      delete missing[field];
      expect(() => readDiagnosticsResponse(missing)).toThrow(EkyApiError);
    }
  });

  it('accepts every direction pair, including an empty page with an available continuation', () => {
    const directions: DiagnosticEventDirection[] = [
      { state: 'available', cursor }, { state: 'end' }, { state: 'unknown' },
    ];
    for (const older of directions) {
      for (const newer of directions) {
        for (const readState of [complete, { status: 'partial', reasons: ['invalidEntries'] }]) {
          const page = { ...ready, older, newer, readState };
          expect(readDiagnosticsResponse(page)).toEqual(page);
        }
      }
    }
  });

  it.each(invalidCursors.map(value => ({ value })))('rejects invalid cursors in scanning and both directions %#', ({ value }) => {
    expect(() => readDiagnosticsResponse({ state: 'scanning', cursor: value })).toThrow(EkyApiError);
    for (const direction of ['older', 'newer']) {
      expect(() => readDiagnosticsResponse({
        ...ready, [direction]: { state: 'available', cursor: value },
      })).toThrow(EkyApiError);
    }
  });

  it.each([
    undefined, null, [], 'end', {}, { cursor }, { state: 'other' },
    { state: 'end', cursor }, { state: 'unknown', cursor },
    { state: 'available', cursor, path: '/synthetic/private' },
    { state: 'end', rawError: 'synthetic-private-detail' },
    { state: 'unknown', rawError: 'synthetic-private-detail' },
  ].map(direction => ({ direction })))('rejects malformed or extended directions %#', ({ direction }) => {
    for (const field of ['older', 'newer']) {
      expect(() => readDiagnosticsResponse({ ...ready, [field]: direction })).toThrow(EkyApiError);
    }
  });

  it('rejects legacy and unknown envelope states', () => {
    for (const state of [undefined, null, 'complete', 'stale', 'busy', 'other', 1]) {
      expect(() => readDiagnosticsResponse({ ...ready, state })).toThrow(EkyApiError);
    }
    expect(() => readDiagnosticsResponse({ diagnosticEvents: [], readState: complete })).toThrow(EkyApiError);
  });

  it('enforces the existing 200-event bound on ready pages', () => {
    const event = {
      category: 'invoicePdfArchive', component: 'desktop', eventName: 'invoicePdfArchive.taskQueued',
      id: 'synthetic-archive', occurredAt: '2026-10-24T10:00:00.000Z',
      level: 'info', outcome: 'success', errorCode: null,
    };
    const diagnosticEvents = Array.from({ length: 200 }, (_, index) => ({ ...event, id: `synthetic-${index}` }));
    expect(readDiagnosticsResponse({ ...ready, diagnosticEvents })).toEqual({ ...ready, diagnosticEvents });
    expect(() => readDiagnosticsResponse({ ...ready, diagnosticEvents: [...diagnosticEvents, event] })).toThrow(EkyApiError);
  });

  it('requires the exact read state and empty event list for terminal failures', () => {
    for (const response of responses.filter(value => value.state === 'limited' || value.state === 'unavailable')) {
      for (const diagnosticEvents of [[{}], null, {}, 'events']) {
        expect(() => readDiagnosticsResponse({ ...response, diagnosticEvents })).toThrow(EkyApiError);
      }
    }
    for (const readState of [
      complete,
      { status: 'partial', reasons: ['invalidEntries'] },
      { status: 'partial', reasons: ['sourceUnavailable'] },
      { status: 'partial', reasons: ['limitReached', 'invalidEntries'] },
      { status: 'unavailable', reasons: ['sourceUnavailable'] },
      { status: 'partial', reasons: ['limitReached'], rawError: 'synthetic-private-detail' },
    ]) {
      expect(() => readDiagnosticsResponse({ state: 'limited', diagnosticEvents: [], readState })).toThrow(EkyApiError);
    }
    for (const readState of [complete, { status: 'partial', reasons: ['limitReached'] }]) {
      expect(() => readDiagnosticsResponse({ state: 'unavailable', diagnosticEvents: [], readState })).toThrow(EkyApiError);
    }
    for (const reason of ['sourceUnavailable', 'notConfigured']) {
      expect(() => readDiagnosticsResponse({
        ...ready, readState: { status: 'unavailable', reasons: [reason] },
      })).toThrow(EkyApiError);
    }
  });
});
