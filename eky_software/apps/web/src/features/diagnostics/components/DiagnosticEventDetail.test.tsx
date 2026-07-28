import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DiagnosticEventDetail } from './DiagnosticEventDetail.js';

describe('DiagnosticEventDetail', () => {
  it('renders only explicitly modelled safe technical context', () => {
    const html = renderToStaticMarkup(
      <DiagnosticEventDetail
        event={{
          appVersion: '0.1.0-alpha.1',
          buildRevision: 'abcdef123456',
          category: 'smtp',
          component: 'backend',
          correlationId: '11111111-1111-4111-8111-111111111111',
          durationMs: 120,
          errorCode: 'SMTP_TLS_FAILED',
          eventName: 'smtp.tlsFailed',
          fingerprint: 'smtp.tlsFailed:SMTP_TLS_FAILED',
          id: 'backend:event-1',
          level: 'error',
          occurredAt: '2026-07-27T12:00:00.000Z',
          operationId: 'send-attempt-1',
          outcome: 'failure',
          retryable: true,
          runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
          sideEffectState: 'none',
          stage: 'tlsHandshake',
        }}
      />,
    );

    expect(html).toContain('<details');
    expect(html).toContain('Näytä tiedot');
    expect(html).toContain('11111111-1111-4111-8111-111111111111');
    expect(html).toContain('120 ms');
    expect(html).toContain('tlsHandshake');
    expect(html).not.toContain('companyId');
    expect(html).not.toContain('actorUserId');
    expect(html).not.toContain('entityId');
    expect(html).not.toContain('responseBody');
  });

  it('omits optional context that is not available', () => {
    const html = renderToStaticMarkup(
      <DiagnosticEventDetail
        event={{
          category: 'runtime',
          component: 'desktop',
          errorCode: null,
          eventName: 'desktop.started',
          id: 'desktop:event-1',
          level: 'info',
          occurredAt: '2026-07-27T12:00:00.000Z',
          outcome: 'success',
        }}
      />,
    );

    expect(html).toContain('Luokka');
    expect(html).not.toContain('Korrelaatiotunniste');
    expect(html).not.toContain('Kesto');
  });
});
