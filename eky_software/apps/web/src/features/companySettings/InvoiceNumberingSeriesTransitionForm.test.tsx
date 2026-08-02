import type {
  InvoiceNumberingSeriesActivationPreviewView,
  InvoiceNumberingSeriesOverviewView,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceNumberingSeriesTransitionForm } from './InvoiceNumberingSeriesTransitionForm.js';
import { createInvoiceNumberingSeriesTransitionForm } from './invoiceNumberingSeriesTransitionFormModel.js';
import { uiText } from '../../i18n/fi.js';

describe('InvoiceNumberingSeriesTransitionForm', () => {
  it('shows backend preview data and keeps technical identifiers hidden', () => {
    const overview = createOverview();
    const html = renderToStaticMarkup(
      <InvoiceNumberingSeriesTransitionForm
        activationErrorMessage={null}
        form={createInvoiceNumberingSeriesTransitionForm(
          overview,
          '2026-08-02',
        )}
        isActivating={false}
        isPreviewLoading={false}
        onActivate={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onFieldChange={vi.fn()}
        onPreview={vi.fn()}
        overview={overview}
        preview={createPreview()}
        previewErrorMessage={null}
        step="configure"
        validationErrors={{}}
      />,
    );

    expect(html).toContain(
      uiText.companySettings.invoiceNumberingSeriesMinimum,
    );
    expect(html).toContain('100');
    expect(html).toContain('20260100');
    expect(html).toContain(
      uiText.companySettings.invoiceNumberingSeriesPreviewWarning,
    );
    expect(html).not.toContain('seriesKey');
    expect(html).not.toContain('companyId');
  });

  it('renders the destructive confirmation empty and disabled by default', () => {
    const overview = createOverview();
    const html = renderToStaticMarkup(
      <InvoiceNumberingSeriesTransitionForm
        activationErrorMessage={null}
        form={createInvoiceNumberingSeriesTransitionForm(
          overview,
          '2026-08-02',
        )}
        isActivating={false}
        isPreviewLoading={false}
        onActivate={vi.fn()}
        onCancel={vi.fn()}
        onContinue={vi.fn()}
        onFieldChange={vi.fn()}
        onPreview={vi.fn()}
        overview={overview}
        preview={createPreview()}
        previewErrorMessage={null}
        step="confirm"
        validationErrors={{}}
      />,
    );

    expect(html).toContain(overview.activationConfirmationText);
    expect(html).toContain('autofocus');
    expect(html).toMatch(
      /<input[^>]*id="invoice-numbering-series-confirmation"[^>]*value=""/,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
  });
});

function createOverview(): InvoiceNumberingSeriesOverviewView {
  return {
    activeSeries: {
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      activatedAt: '2026-01-01T00:00:00.000Z',
    },
    activationConfirmationText: 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN',
    history: [],
    revision: 1,
  };
}

function createPreview(): InvoiceNumberingSeriesActivationPreviewView {
  return {
    capacity: 'available',
    maximumSequenceNumber: 9999,
    minimumFirstSequenceNumber: 100,
    previewDate: '2026-08-02',
    previewInvoiceNumber: '20260100',
  };
}
