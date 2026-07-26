import { describe, expect, it, vi } from 'vitest';

import { createBackendOperationalEvent } from '../createOperationalEvent.js';
import { IncidentIndexingOperationalLogger } from './incidentIndexingOperationalLogger.js';

const eventOptions = {
  appVersion: '0.0.0',
  eventId: 'event-1',
  timestamp: '2026-07-26T20:00:00.000Z',
};

describe('IncidentIndexingOperationalLogger', () => {
  it('indexes failures without company, actor or entity identifiers', () => {
    const detailedLogger = { write: vi.fn() };
    const incidentIndex = { write: vi.fn() };
    const logger = new IncidentIndexingOperationalLogger(
      detailedLogger,
      incidentIndex,
    );

    logger.write(
      createBackendOperationalEvent(
        {
          companyId: 'company-1',
          entityId: 'invoice-1',
          entityType: 'approvedInvoice',
          errorCode: 'INVOICE_PDF_GENERATION_FAILED',
          eventName: 'invoicePdf.generationFailed',
        },
        eventOptions,
      ),
    );

    expect(detailedLogger.write).toHaveBeenCalledTimes(1);
    expect(incidentIndex.write).toHaveBeenCalledWith({
      appVersion: '0.0.0',
      component: 'backend',
      errorCode: 'INVOICE_PDF_GENERATION_FAILED',
      eventName: 'invoicePdf.generationFailed',
      fingerprint:
        'invoicePdf.generationFailed:INVOICE_PDF_GENERATION_FAILED',
      outcome: 'failure',
      timestamp: '2026-07-26T20:00:00.000Z',
    });
  });

  it('does not index successful operational events', () => {
    const incidentIndex = { write: vi.fn() };
    const logger = new IncidentIndexingOperationalLogger(
      { write: vi.fn() },
      incidentIndex,
    );

    logger.write(
      createBackendOperationalEvent(
        { eventName: 'backend.started' },
        eventOptions,
      ),
    );

    expect(incidentIndex.write).not.toHaveBeenCalled();
  });
});
