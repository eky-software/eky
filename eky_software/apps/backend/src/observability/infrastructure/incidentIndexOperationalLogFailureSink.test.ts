import { describe, expect, it, vi } from 'vitest';

import { IncidentIndexOperationalLogFailureSink } from './incidentIndexOperationalLogFailureSink.js';

describe('IncidentIndexOperationalLogFailureSink', () => {
  it('records one non-recursive safe summary for each failure and stream', () => {
    const write = vi.fn();
    const sink = new IncidentIndexOperationalLogFailureSink({
      incidentIndex: { write },
      operationalIdentity: {
        appVersion: '1.2.3',
        buildRevision: '123456789abc',
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      },
    });

    sink.recordFailure({
      errorCode: 'LOG_CAPACITY_REACHED',
      stream: 'backend-warning-error',
    });
    sink.recordFailure({
      errorCode: 'LOG_CAPACITY_REACHED',
      stream: 'backend-warning-error',
    });
    sink.recordFailure({
      errorCode: 'LOG_WRITE_FAILED',
      stream: 'backend-warning-error',
    });

    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        appVersion: '1.2.3',
        buildRevision: '123456789abc',
        errorCode: 'LOG_CAPACITY_REACHED',
        eventName: 'operationalLog.capacityReached',
        fingerprint: 'LOG_CAPACITY_REACHED:backend-warning-error',
      }),
    );
    expect(write).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        errorCode: 'LOG_WRITE_FAILED',
        eventName: 'operationalLog.writeFailed',
      }),
    );
  });
});
