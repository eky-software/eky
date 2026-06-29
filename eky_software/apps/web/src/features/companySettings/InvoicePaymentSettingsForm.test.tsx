import type { InvoicePaymentSettingsView } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoicePaymentSettingsForm } from './InvoicePaymentSettingsForm.js';
import {
  initialInvoicePaymentSettingsForm,
} from './invoicePaymentSettingsFormModel.js';
import { uiText } from '../../i18n/fi.js';

describe('InvoicePaymentSettingsForm', () => {
  it('renders invoice payment settings without native browser-required validation', () => {
    const html = renderForm();

    expect(html).toContain(uiText.companySettings.invoicePaymentHeading);
    expect(html).toContain(uiText.companySettings.invoicePaymentLateInterest);
    expect(html).toContain(uiText.companySettings.invoicePaymentReminderPeriodDays);
    expect(html).toContain('noValidate=""');
    expect(html).not.toContain('required=""');
  });

  it('renders default settings info', () => {
    const html = renderForm({
      settings: createSettings({ isPersisted: false }),
    });

    expect(html).toContain(uiText.companySettings.invoicePaymentDefaultInfo);
  });

  it('renders validation errors safely', () => {
    const html = renderForm({
      validationErrors: {
        defaultLatePaymentInterestPercent:
          uiText.companySettings.invoicePaymentValidation.latePaymentInterestInvalid,
      },
    });

    expect(html).toContain(
      uiText.companySettings.invoicePaymentValidation.latePaymentInterestInvalid,
    );
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });
});

function renderForm(
  props: Partial<React.ComponentProps<typeof InvoicePaymentSettingsForm>> = {},
): string {
  return renderToStaticMarkup(
    <InvoicePaymentSettingsForm
      errorMessage={null}
      form={initialInvoicePaymentSettingsForm}
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
  overrides: Partial<InvoicePaymentSettingsView> = {},
): InvoicePaymentSettingsView {
  return {
    defaultLatePaymentInterestBasisPoints: 0,
    defaultReminderPeriodDays: 8,
    isPersisted: true,
    ...overrides,
  };
}
