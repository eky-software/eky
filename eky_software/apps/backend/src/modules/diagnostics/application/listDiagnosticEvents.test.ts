import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import {
  DiagnosticEventValidationError,
  listDiagnosticEvents,
} from './listDiagnosticEvents.js';
import { completeDiagnosticReadState, unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';

describe('listDiagnosticEvents', () => {
  it('requires the dedicated permission before reading logs', async () => {
    const reader = { browseDiagnosticEvents: vi.fn(), close: vi.fn() };

    await expect(
      listDiagnosticEvents(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          },
        },
        reader,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(reader.browseDiagnosticEvents).not.toHaveBeenCalled();
  });

  it('uses the bounded public limit', async () => {
    const reader = {
      browseDiagnosticEvents: vi.fn().mockResolvedValue({ state: 'ready', diagnosticEvents: [], readState: completeDiagnosticReadState,
        older: { state: 'end' }, newer: { state: 'end' } }), close: vi.fn(),
    };

    await listDiagnosticEvents(
      {
        actorContext: {
          actorId: 'actor-1',
          authenticationMode: 'local',
          companyId: 'company-1',
          permissions: ['viewDiagnostics'],
        },
        limit: 25,
      },
      reader,
    );

    expect(reader.browseDiagnosticEvents).toHaveBeenCalledWith({ limit: 25 }, JSON.stringify(['local', 'actor-1', 'company-1']));
  });

  it('rejects an excessive limit before reading logs', async () => {
    const reader = { browseDiagnosticEvents: vi.fn(), close: vi.fn() };

    await expect(
      listDiagnosticEvents(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: ['viewDiagnostics'],
          },
          limit: 201,
        },
        reader,
      ),
    ).rejects.toBeInstanceOf(DiagnosticEventValidationError);
    expect(reader.browseDiagnosticEvents).not.toHaveBeenCalled();
  });

  it('preserves partial results and safely classifies an unexpected source failure', async () => {
    const input = { actorContext: { actorId: 'actor-1', authenticationMode: 'local' as const,
      companyId: 'company-1', permissions: ['viewDiagnostics'] as const } };
    const partial = { state: 'ready', older: { state: 'unknown' }, newer: { state: 'unknown' }, diagnosticEvents: [], readState: {
      status: 'partial' as const, reasons: ['invalidEntries'] as const,
    } };
    const reader = { browseDiagnosticEvents: vi.fn().mockResolvedValueOnce(partial)
      .mockRejectedValueOnce(new Error('synthetic private original source error')), close: vi.fn() };
    await expect(listDiagnosticEvents(input, reader)).resolves.toBe(partial);
    await expect(listDiagnosticEvents(input, reader)).resolves.toEqual({
      state: 'unavailable', diagnosticEvents: [], readState: unavailableDiagnosticReadState,
    });
  });

  it.each(['a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(32)}\n`])('rejects a nonexact cursor before reader access', async cursor => {
    const reader = { browseDiagnosticEvents: vi.fn(), close: vi.fn() };
    await expect(listDiagnosticEvents({ cursor, actorContext: {
      actorId: 'synthetic-actor', authenticationMode: 'local', companyId: 'synthetic-company',
      permissions: ['viewDiagnostics'],
    } }, reader)).rejects.toBeInstanceOf(DiagnosticEventValidationError);
    expect(reader.browseDiagnosticEvents).not.toHaveBeenCalled();
  });

  it('rechecks permission and binds a continuation to the complete trusted actor identity', async () => {
    const reader = { browseDiagnosticEvents: vi.fn().mockResolvedValue({ state: 'scanning', cursor: 'b'.repeat(32) }), close: vi.fn() };
    const actorContext = { actorId: 'actor', authenticationMode: 'local' as const, companyId: 'one', permissions: ['viewDiagnostics'] as const };
    const cursor = 'a'.repeat(32);
    await listDiagnosticEvents({ actorContext, cursor }, reader);
    expect(reader.browseDiagnosticEvents).toHaveBeenLastCalledWith({ cursor }, '["local","actor","one"]');
    await listDiagnosticEvents({ actorContext: { ...actorContext, companyId: 'two' }, cursor }, reader);
    expect(reader.browseDiagnosticEvents).toHaveBeenLastCalledWith({ cursor }, '["local","actor","two"]');
    reader.browseDiagnosticEvents.mockClear();
    await expect(listDiagnosticEvents({ actorContext: { ...actorContext, permissions: [] }, cursor }, reader)).rejects.toBeInstanceOf(AuthorizationError);
    expect(reader.browseDiagnosticEvents).not.toHaveBeenCalled();
  });
});

