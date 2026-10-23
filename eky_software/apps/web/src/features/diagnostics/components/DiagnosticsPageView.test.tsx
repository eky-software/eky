import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DiagnosticsPageView } from './DiagnosticsPageView.js';

const completedReadProps = { isSummaryLoading: false, summaryErrorMessage: null,
  readState: { status: 'complete' as const, reasons: [] as [] } };

describe('DiagnosticsPageView', () => {
  it('renders only the safe diagnostic projection', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[
          {
            category: 'smtp',
            component: 'backend',
            errorCode: 'SMTP_TLS_FAILED',
            eventName: 'smtp.tlsFailed',
            id: 'backend:event-1',
            level: 'error',
            occurredAt: '2026-07-27T12:00:00.000Z',
            outcome: 'failure',
          },
        ]}
        isLoading={false}
        summary={null}
      />,
    );

    expect(html).toContain('smtp.tlsFailed');
    expect(html).toContain('SMTP_TLS_FAILED');
    expect(html).toContain('Näytä tiedot');
    expect(html).not.toContain('rawMetadata');
    expect(html).not.toContain('companyId');
    expect(html).not.toContain('stack');
  });

  it('renders the business audit retention event exposed by the packaged contract', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[
          {
            category: 'businessAudit',
            component: 'backend',
            errorCode: null,
            eventName: 'businessAudit.retentionCompleted',
            id: 'backend:event-1',
            level: 'info',
            occurredAt: '2026-07-27T12:00:00.000Z',
            outcome: 'success',
          },
        ]}
        isLoading={false}
        summary={null}
      />,
    );

    expect(html).toContain('businessAudit.retentionCompleted');
    expect(html).not.toContain('Diagnostiikkaa ei voitu ladata');
  });

  it('renders loading, empty and safe error states', () => {
    const loading = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[]}
        isLoading
        summary={null}
      />,
    );
    const empty = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[]}
        isLoading={false}
        summary={null}
      />,
    );
    const error = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage="Diagnostiikkaa ei voitu ladata."
        events={[]}
        isLoading={false}
        summary={null}
      />,
    );

    expect(loading).toContain('Ladataan diagnostiikkaa');
    expect(empty).toContain('Diagnostiikkatapahtumia ei ole');
    expect(error).toContain('role="alert"');
  });

  it('shows the log folder command only when the desktop capability exists', () => {
    const browserHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[]}
        isLoading={false}
        summary={null}
      />,
    );
    const desktopHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[]}
        isLoading={false}
        openOperationalLogFolder={async () => undefined}
        summary={null}
      />,
    );

    expect(browserHtml).not.toContain('Avaa lokikansio');
    expect(desktopHtml).toContain('Avaa lokikansio');
  });

  it('shows support bundle creation only for the desktop capability', () => {
    const browserHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        errorMessage={null}
        events={[]}
        isLoading={false}
        summary={null}
      />,
    );
    const desktopHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        {...completedReadProps}
        createSupportBundle={async () => 'created'}
        errorMessage={null}
        events={[]}
        isLoading={false}
        summary={null}
      />,
    );

    expect(browserHtml).not.toContain('Luo tukipaketti');
    expect(desktopHtml).toContain('Luo tukipaketti');
  });

  it('keeps partial events visible without presenting the end of history', () => {
    const html = renderToStaticMarkup(<DiagnosticsPageView {...completedReadProps}
      readState={{ status: 'partial', reasons: ['sourceUnavailable', 'limitReached'] }}
      events={[diagnosticEvent]} errorMessage={null} isLoading={false} summary={null} />);
    expect(html).toContain('Diagnostiikkatiedot ovat osittaiset');
    expect(html).toContain('database.openFailed');
    expect(html).toContain('<table');
    expect(html).not.toContain('Diagnostiikkatapahtumia ei ole vielä');
  });

  it.each(['sourceUnavailable', 'notConfigured'] as const)('does not turn %s into a healthy empty history', reason => {
    const readState = reason === 'notConfigured'
      ? { status: 'unavailable' as const, reasons: ['notConfigured'] as ['notConfigured'] }
      : { status: 'unavailable' as const, reasons: ['sourceUnavailable'] as ['sourceUnavailable'] };
    const html = renderToStaticMarkup(<DiagnosticsPageView {...completedReadProps}
      readState={readState} events={[]} errorMessage={null} isLoading={false} summary={null} />);
    expect(html).not.toContain('Diagnostiikkatapahtumia ei ole vielä');
    expect(html).not.toContain('<table');
    expect(html).toContain(reason === 'notConfigured'
      ? 'ei ole määritetty diagnostiikan lokilähdettä' : 'Diagnostiikkatietoja ei voitu lukea');
    expect(html.includes('role="alert"')).toBe(reason === 'sourceUnavailable');
  });

  it('keeps the successful event list beside a summary request error', () => {
    const html = renderToStaticMarkup(<DiagnosticsPageView {...completedReadProps}
      summaryErrorMessage="Yhteenvetoa ei voitu ladata." events={[diagnosticEvent]}
      errorMessage={null} isLoading={false} summary={null} />);
    expect(html).toContain('Yhteenvetoa ei voitu ladata.');
    expect(html).toContain('database.openFailed');
    expect(html).toContain('<table');
  });

  it('keeps summary loading visible after the event list has completed', () => {
    const html = renderToStaticMarkup(<DiagnosticsPageView {...completedReadProps}
      isSummaryLoading events={[diagnosticEvent]} summary={null}
      errorMessage={null} isLoading={false} />);
    expect(html).toContain('Ladataan järjestelmäyhteenvetoa...');
    expect(html).toContain('role="status"');
    expect(html).toContain('<table');
    expect(html).not.toContain('Ladataan diagnostiikkaa...');
  });
});

const diagnosticEvent = {
  category: 'database', component: 'backend' as const, errorCode: 'DATABASE_OPEN_FAILED',
  eventName: 'database.openFailed' as const, id: 'backend:synthetic-event', level: 'error' as const,
  occurredAt: '2026-07-27T12:00:00.000Z', outcome: 'failure' as const,
};
