import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { DiagnosticEventReadResult } from '../domain/diagnosticEventReadResult.js';
import { unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';
import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { observeDiagnosticReadFailure } from './observeDiagnosticReadFailure.js';

export const defaultDiagnosticEventLimit = 100;
export const maximumDiagnosticEventLimit = 200;

export interface ListDiagnosticEventsInput {
  actorContext: ActorContext;
  limit?: number;
}

export class DiagnosticEventValidationError extends Error {
  readonly code = 'diagnostic_event_validation_error';

  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticEventValidationError';
  }
}

export async function listDiagnosticEvents(
  input: ListDiagnosticEventsInput,
  reader: DiagnosticEventReader,
  failureObserver?: DiagnosticReadFailureObserver,
): Promise<DiagnosticEventReadResult> {
  requirePermission(input.actorContext, 'viewDiagnostics');
  const limit = validateLimit(input.limit);
  try {
    return await reader.listRecentDiagnosticEvents(limit);
  } catch (error) {
    observeDiagnosticReadFailure(failureObserver, error);
    return { diagnosticEvents: [], readState: unavailableDiagnosticReadState };
  }
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return defaultDiagnosticEventLimit;
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumDiagnosticEventLimit
  ) {
    throw new DiagnosticEventValidationError(
      `Diagnostic event limit must be an integer between 1 and ${maximumDiagnosticEventLimit}.`,
    );
  }
  return limit;
}

