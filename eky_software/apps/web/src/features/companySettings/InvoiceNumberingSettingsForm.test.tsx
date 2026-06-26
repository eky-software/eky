import type { InvoiceNumberingSettingsView } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceNumberingSettingsForm } from './InvoiceNumberingSettingsForm.js';
import {
  initialInvoiceNumberingSettingsForm,
} from './invoiceNumberingSettingsFormModel.js';
import { uiText } from '../../i18n/fi.js';

describe('InvoiceNumberingSettingsForm', () => {
  it('renders default invoice numbering settings', () => {
    const html = renderForm({
      settings: createSettings({ isPersisted: false }),
    });

    expect(html).toContain(uiText.companySettings.invoiceNumberingHeading);
    expect(html).toContain(
      uiText.companySettings.invoiceNumberingModes.calendarYearSequence,
    );
    expect(html).toContain(uiText.companySettings.invoiceNumberingDefaultInfo);
    expect(html).toContain('default');
    expect(html).toContain(uiText.companySettings.no);
  });

  it('disables editing when numbering has already been used', () => {
    const html = renderForm({
      settings: createSettings({
        hasUsedNumbering: true,
        isPersisted: true,
      }),
    });

    expect(html).toContain(uiText.companySettings.invoiceNumberingUsedWarning);
    expect(html).toContain(uiText.companySettings.invoiceNumberingLocked);
    expect(html).toContain('disabled=""');
  });

  it('renders validation errors without native browser-required validation', () => {
    const html = renderForm({
      validationErrors: {
        firstSequenceNumber:
          uiText.companySettings.invoiceNumberingValidation.firstSequenceNumberInvalid,
      },
    });

    expect(html).toContain(
      uiText.companySettings.invoiceNumberingValidation.firstSequenceNumberInvalid,
    );
    expect(html).toContain('noValidate=""');
    expect(html).not.toContain('required=""');
  });

  it('renders a safe API error without technical response data', () => {
    const html = renderForm({
      errorMessage: uiText.companySettings.invoiceNumberingSaveError,
    });

    expect(html).toContain(uiText.companySettings.invoiceNumberingSaveError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });
});

function renderForm(
  props: Partial<React.ComponentProps<typeof InvoiceNumberingSettingsForm>> = {},
): string {
  return renderToStaticMarkup(
    <InvoiceNumberingSettingsForm
      errorMessage={null}
      form={initialInvoiceNumberingSettingsForm}
      isSaving={false}
      onFieldChange={vi.fn()}
      onSubmit={vi.fn()}
      settings={createSettings()}
      successMessage={null}
      validationErrors={{}}
      {...props}
    />,
  );
}

function createSettings(
  overrides: Partial<InvoiceNumberingSettingsView> = {},
): InvoiceNumberingSettingsView {
  return {
    firstSequenceNumber: 1,
    fiscalYearStartMonth: 1,
    hasUsedNumbering: false,
    isPersisted: true,
    mode: 'calendarYearSequence',
    sequencePadding: 3,
    seriesKey: 'default',
    ...overrides,
  };
}
