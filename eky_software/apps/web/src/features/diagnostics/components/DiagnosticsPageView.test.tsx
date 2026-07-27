import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DiagnosticsPageView } from './DiagnosticsPageView.js';

describe('DiagnosticsPageView', () => {
  it('renders only the safe diagnostic projection', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPageView
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
      />,
    );

    expect(html).toContain('smtp.tlsFailed');
    expect(html).toContain('SMTP_TLS_FAILED');
    expect(html).not.toContain('rawMetadata');
    expect(html).not.toContain('companyId');
    expect(html).not.toContain('stack');
  });

  it('renders the business audit retention event exposed by the packaged contract', () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPageView
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
      />,
    );

    expect(html).toContain('businessAudit.retentionCompleted');
    expect(html).not.toContain('Diagnostiikkaa ei voitu ladata');
  });

  it('renders loading, empty and safe error states', () => {
    const loading = renderToStaticMarkup(
      <DiagnosticsPageView errorMessage={null} events={[]} isLoading />,
    );
    const empty = renderToStaticMarkup(
      <DiagnosticsPageView
        errorMessage={null}
        events={[]}
        isLoading={false}
      />,
    );
    const error = renderToStaticMarkup(
      <DiagnosticsPageView
        errorMessage="Diagnostiikkaa ei voitu ladata."
        events={[]}
        isLoading={false}
      />,
    );

    expect(loading).toContain('Ladataan diagnostiikkaa');
    expect(empty).toContain('Diagnostiikkatapahtumia ei ole');
    expect(error).toContain('role="alert"');
  });

  it('shows the log folder command only when the desktop capability exists', () => {
    const browserHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        errorMessage={null}
        events={[]}
        isLoading={false}
      />,
    );
    const desktopHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        errorMessage={null}
        events={[]}
        isLoading={false}
        openOperationalLogFolder={async () => undefined}
      />,
    );

    expect(browserHtml).not.toContain('Avaa lokikansio');
    expect(desktopHtml).toContain('Avaa lokikansio');
  });

  it('shows support bundle creation only for the desktop capability', () => {
    const browserHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        errorMessage={null}
        events={[]}
        isLoading={false}
      />,
    );
    const desktopHtml = renderToStaticMarkup(
      <DiagnosticsPageView
        createSupportBundle={async () => 'created'}
        errorMessage={null}
        events={[]}
        isLoading={false}
      />,
    );

    expect(browserHtml).not.toContain('Luo tukipaketti');
    expect(desktopHtml).toContain('Luo tukipaketti');
  });
});
