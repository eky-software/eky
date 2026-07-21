import type { Customer, InvoiceDraft } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceDraftEditorView } from './InvoiceDraftEditorView.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceDraftEditorView', () => {
  it('renders the loading state while an invoice draft is opening', () => {
    const html = renderEditor({ isDraftLoading: true });

    expect(html).toContain(uiText.invoicing.openingDraft);
  });

  it('renders a safe open error without technical response data', () => {
    const html = renderEditor({
      draftErrorMessage: uiText.invoicing.openDraftError,
    });

    expect(html).toContain(uiText.invoicing.openDraftError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the empty editor prompt when no draft is open', () => {
    const html = renderEditor();

    expect(html).toContain(uiText.invoicing.openDraftPrompt);
    expect(html).toContain(uiText.invoicing.backToDrafts);
  });

  it('hydrates an opened invoice draft into the edit form', () => {
    const html = renderEditor({ draft: createInvoiceDraft() });

    expect(html).toContain(uiText.invoicing.editInvoice);
    expect(html).toContain('Työlasku');
    expect(html).toContain('Saate');
    expect(html).toContain('ORDER-1');
    expect(html).toContain('Työtunti');
    expect(html).toContain('65,50');
    expect(html).toContain(uiText.invoicing.approveDraft);
    expect(html).not.toContain(
      uiText.invoicing.approveDraftConfirmationTitle,
    );
    expect(html).toContain(uiText.invoicing.save);
    expect(html).not.toContain(uiText.invoicing.saveDraftChanges);
  });
});

type InvoiceDraftEditorViewProps = React.ComponentProps<
  typeof InvoiceDraftEditorView
>;

function renderEditor(
  overrides: Partial<InvoiceDraftEditorViewProps> = {},
): string {
  return renderToStaticMarkup(
    <InvoiceDraftEditorView
      apiClient={createApiClient()}
      companySettingsState={createCompanySettingsState()}
      customerListState={createCustomerListState()}
      draft={null}
      draftErrorMessage={null}
      invoicePaymentDefaultsState={createInvoicePaymentDefaultsState()}
      isDraftLoading={false}
      onBack={vi.fn()}
      onDraftApproved={vi.fn()}
      onDraftSaved={vi.fn()}
      onOpenApprovedInvoice={vi.fn()}
      {...overrides}
    />,
  );
}

function createApiClient(): InvoiceDraftEditorViewProps['apiClient'] {
  return {
    approveInvoiceDraft: vi.fn(),
    createInvoiceDraft: vi.fn(),
    updateInvoiceDraft: vi.fn(),
  };
}

function createCompanySettingsState(): InvoiceDraftEditorViewProps['companySettingsState'] {
  return {
    companySettings: {
      businessId: '',
      city: '',
      companyId: 'dev-company',
      companyName: 'Example Builder Oy',
      createdAt: '2026-06-13T18:00:00.000Z',
      defaultHourlyRateCents: 6500,
      email: '',
      emailDeliveryProvider: 'dryRun',
      emailSenderName: '',
      emailSenderAddress: '',
      emailSmtpHost: '',
      emailSmtpPort: null,
      emailSmtpSecurity: 'tls',
      emailUsername: '',
      emailTestRecipientOverride: '',
      emailSecretConfigured: false,
      website: '',
      hourlyRateShortcut: 'työ',
      vatNumber: '',
      iban: '',
      bic: '',
      bankName: '',
      id: 'settings-1',
      phone: '',
      postalCode: '',
      streetAddress: '',
      updatedAt: '2026-06-13T18:00:00.000Z',
    },
    errorMessage: null,
    isLoading: false,
  };
}

function createInvoicePaymentDefaultsState(): InvoiceDraftEditorViewProps['invoicePaymentDefaultsState'] {
  return {
    errorMessage: null,
    isLoading: false,
    settings: {
      defaultLatePaymentInterestBasisPoints: 950,
      defaultReminderPeriodDays: 8,
      isPersisted: true,
    },
  };
}

function createCustomerListState(): InvoiceDraftEditorViewProps['customerListState'] {
  return {
    customers: [createCustomer()],
    errorMessage: null,
    isLoading: false,
  };
}

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Helsinki',
    comment: '',
    companyId: 'dev-company',
    createdAt: '2026-06-13T18:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'testi@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Asiakas Oy',
    phone: '040 123 4567',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 1',
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
}

function createInvoiceDraft(): InvoiceDraft {
  return {
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerId: 'customer-1',
    billingRecipientCustomerId: null,
    deliveryAddressText: '',
    dueDate: '2026-06-30',
    id: 'draft-1',
    invoiceDate: '2026-06-16',
    lines: [
      {
        baseCents: 9825,
        code: '',
        description: 'Työtunti',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12_331,
        id: 'line-1',
        netCents: 9825,
        position: 1,
        priceInputMode: 'net',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 6550,
        vatCents: 2506,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Saate',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    reminderPeriodDays: 0,
    status: 'draft',
    subject: 'Työlasku',
    totals: {
      grossTotalCents: 12_331,
      netTotalCents: 9825,
      vatBreakdown: [
        {
          grossCents: 12_331,
          netCents: 9825,
          vatCents: 2506,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2506,
    },
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}
