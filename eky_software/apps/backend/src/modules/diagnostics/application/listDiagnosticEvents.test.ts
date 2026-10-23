import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it, vi } from 'vitest';

import {
  DiagnosticEventValidationError,
  listDiagnosticEvents,
} from './listDiagnosticEvents.js';
import { completeDiagnosticReadState, unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';

describe('listDiagnosticEvents', () => {
  it('requires the dedicated permission before reading logs', async () => {
    const reader = { listRecentDiagnosticEvents: vi.fn() };

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
    expect(reader.listRecentDiagnosticEvents).not.toHaveBeenCalled();
  });

  it('uses the bounded public limit', async () => {
    const reader = {
      listRecentDiagnosticEvents: vi.fn().mockResolvedValue({ diagnosticEvents: [], readState: completeDiagnosticReadState }),
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

    expect(reader.listRecentDiagnosticEvents).toHaveBeenCalledWith(25);
  });

  it('rejects an excessive limit before reading logs', async () => {
    const reader = { listRecentDiagnosticEvents: vi.fn() };

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
    expect(reader.listRecentDiagnosticEvents).not.toHaveBeenCalled();
  });

  it('preserves partial results and safely classifies an unexpected source failure', async () => {
    const input = { actorContext: { actorId: 'actor-1', authenticationMode: 'local' as const,
      companyId: 'company-1', permissions: ['viewDiagnostics'] as const } };
    const partial = { diagnosticEvents: [], readState: {
      status: 'partial' as const, reasons: ['invalidEntries'] as const,
    } };
    const reader = { listRecentDiagnosticEvents: vi.fn().mockResolvedValueOnce(partial)
      .mockRejectedValueOnce(new Error('synthetic private original source error')) };
    await expect(listDiagnosticEvents(input, reader)).resolves.toBe(partial);
    await expect(listDiagnosticEvents(input, reader)).resolves.toEqual({
      diagnosticEvents: [], readState: unavailableDiagnosticReadState,
    });
  });
});

