import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoicingPageView } from './InvoicingPageView.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoicingPageView', () => {
  it('renders the new invoice Classic form shell', () => {
    const html = renderPage({
      activeView: 'newInvoice',
      customerListState: {
        customers: [],
        errorMessage: null,
        isLoading: true,
      },
      drafts: [],
      draftErrorMessage: null,
      isDraftListLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.backToDrafts);
    expect(html).toContain(uiText.invoicing.customerLoading);
    expect(html).toContain(uiText.invoicing.invoiceDate);
    expect(html).toContain(uiText.invoicing.paymentTermDays);
    expect(html).toContain(uiText.invoicing.dueDate);
    expect(html).toContain(uiText.invoicing.subject);
    expect(html).toContain(uiText.invoicing.orderNumber);
    expect(html).toContain(uiText.invoicing.note);
    expect(html).toContain(uiText.invoicing.priceInputNet);
    expect(html).toContain(uiText.invoicing.priceInputGross);
    expect(html).toContain(uiText.invoicing.invoiceRowsHelp);
    expect(html).toContain(uiText.invoicing.addRow);
    expect(html).toContain(uiText.invoicing.rowDescriptionPlaceholder);
    expect(html).toContain(uiText.invoicing.invoiceTotalsPreviewHelp);
    expect(html).toContain(uiText.invoicing.invoiceTotalsUnavailable);
    expect(html).toContain('noValidate=""');
    expect(html).toContain(uiText.invoicing.fillDummyInvoice);
    expect(html).not.toContain(uiText.invoicing.validateForm);
    expect(html).toContain(uiText.invoicing.save);
    expect(html).not.toContain(uiText.invoicing.saveDraftLater);
    expect(html).not.toContain(uiText.invoicing.approveDraft);
    expect(html).not.toContain('required=""');
  });

});

type InvoicingPageViewProps = React.ComponentProps<typeof InvoicingPageView>;

function renderPage(
  props: Omit<
    InvoicingPageViewProps,
    | 'companySettingsState'
    | 'approvedInvoiceEmailState'
    | 'approvedInvoiceListState'
    | 'approvedInvoicePdfState'
    | 'approvedInvoiceState'
    | 'copyApprovedInvoiceState'
    | 'deleteState'
    | 'invoicePaymentDefaultsState'
    | 'invoiceDeliveryEventListState'
    | 'markApprovedInvoiceSentState'
    | 'reopenApprovedInvoiceState'
    | 'sendApprovedInvoiceEmailState'
    | 'sendApprovedInvoiceEmailSmtpState'
    | 'sendApprovedInvoiceEmailSmtpTestState'
    | 'onCancelDeleteDraft'
    | 'onConfirmDeleteDraft'
    | 'onCreateApprovedInvoicePdf'
    | 'onCopyApprovedInvoiceToDraft'
    | 'onDraftApproved'
    | 'onDraftSaved'
    | 'onEditApprovedInvoice'
    | 'onMarkApprovedInvoiceSent'
    | 'onOpenApprovedInvoice'
    | 'onOpenApprovedInvoicePdf'
    | 'onPrepareApprovedInvoiceEmail'
    | 'onSendApprovedInvoiceEmailDryRun'
    | 'onSendApprovedInvoiceEmailSmtp'
    | 'onSendApprovedInvoiceEmailSmtpTest'
    | 'onRequestDeleteDraft'
    | 'pendingDeleteDraftId'
  > &
    Partial<
      Pick<
        InvoicingPageViewProps,
        | 'companySettingsState'
        | 'approvedInvoiceEmailState'
        | 'approvedInvoiceListState'
        | 'approvedInvoicePdfState'
        | 'approvedInvoiceState'
        | 'copyApprovedInvoiceState'
        | 'deleteState'
        | 'invoicePaymentDefaultsState'
        | 'invoiceDeliveryEventListState'
        | 'markApprovedInvoiceSentState'
        | 'reopenApprovedInvoiceState'
        | 'sendApprovedInvoiceEmailState'
        | 'sendApprovedInvoiceEmailSmtpState'
        | 'sendApprovedInvoiceEmailSmtpTestState'
        | 'onCancelDeleteDraft'
        | 'onConfirmDeleteDraft'
        | 'onCreateApprovedInvoicePdf'
        | 'onCopyApprovedInvoiceToDraft'
        | 'onDraftApproved'
        | 'onDraftSaved'
        | 'onEditApprovedInvoice'
        | 'onMarkApprovedInvoiceSent'
        | 'onOpenApprovedInvoice'
        | 'onOpenApprovedInvoicePdf'
        | 'onPrepareApprovedInvoiceEmail'
        | 'onSendApprovedInvoiceEmailDryRun'
        | 'onSendApprovedInvoiceEmailSmtp'
        | 'onSendApprovedInvoiceEmailSmtpTest'
        | 'onRequestDeleteDraft'
        | 'pendingDeleteDraftId'
      >
    >,
): string {
  return renderToStaticMarkup(
    <InvoicingPageView
      approvedInvoiceEmailState={createApprovedInvoiceEmailState()}
      approvedInvoiceListState={createApprovedInvoiceListState()}
      approvedInvoicePdfState={createApprovedInvoicePdfState()}
      approvedInvoiceState={createApprovedInvoiceState()}
      companySettingsState={createCompanySettingsState()}
      copyApprovedInvoiceState={createCopyApprovedInvoiceState()}
      deleteState={createDeleteState()}
      invoicePaymentDefaultsState={createInvoicePaymentDefaultsState()}
      invoiceDeliveryEventListState={createInvoiceDeliveryEventListState()}
      markApprovedInvoiceSentState={createMarkApprovedInvoiceSentState()}
      reopenApprovedInvoiceState={createReopenApprovedInvoiceState()}
      sendApprovedInvoiceEmailState={createSendApprovedInvoiceEmailState()}
      sendApprovedInvoiceEmailSmtpState={
        createSendApprovedInvoiceEmailSmtpState()
      }
      sendApprovedInvoiceEmailSmtpTestState={
        createSendApprovedInvoiceEmailSmtpTestState()
      }
      onCancelDeleteDraft={vi.fn()}
      onConfirmDeleteDraft={vi.fn()}
      onCreateApprovedInvoicePdf={vi.fn()}
      onCopyApprovedInvoiceToDraft={vi.fn()}
      onDraftApproved={vi.fn()}
      onDraftSaved={vi.fn()}
      onEditApprovedInvoice={vi.fn()}
      onMarkApprovedInvoiceSent={vi.fn()}
      onOpenApprovedInvoice={vi.fn()}
      onOpenApprovedInvoicePdf={vi.fn()}
      onPrepareApprovedInvoiceEmail={vi.fn()}
      onSendApprovedInvoiceEmailDryRun={vi.fn()}
      onSendApprovedInvoiceEmailSmtp={vi.fn()}
      onSendApprovedInvoiceEmailSmtpTest={vi.fn()}
      onRequestDeleteDraft={vi.fn()}
      pendingDeleteDraftId={null}
      {...props}
    />,
  );
}

function createSendApprovedInvoiceEmailState(
  overrides: Partial<
    InvoicingPageViewProps['sendApprovedInvoiceEmailState']
  > = {},
): InvoicingPageViewProps['sendApprovedInvoiceEmailState'] {
  return {
    clearStatus: vi.fn(),
    errorMessage: null,
    isSending: false,
    sendEmailDryRun: vi.fn(async () => null),
    successMessage: null,
    ...overrides,
  };
}

function createSendApprovedInvoiceEmailSmtpTestState(
  overrides: Partial<
    InvoicingPageViewProps['sendApprovedInvoiceEmailSmtpTestState']
  > = {},
): InvoicingPageViewProps['sendApprovedInvoiceEmailSmtpTestState'] {
  return {
    clearStatus: vi.fn(),
    errorMessage: null,
    isSending: false,
    sendEmailSmtpTest: vi.fn(async () => null),
    successMessage: null,
    ...overrides,
  };
}

function createSendApprovedInvoiceEmailSmtpState(
  overrides: Partial<
    InvoicingPageViewProps['sendApprovedInvoiceEmailSmtpState']
  > = {},
): InvoicingPageViewProps['sendApprovedInvoiceEmailSmtpState'] {
  return {
    clearStatus: vi.fn(),
    errorMessage: null,
    isSending: false,
    sendEmailSmtp: vi.fn(async () => null),
    successMessage: null,
    ...overrides,
  };
}

function createApprovedInvoiceEmailState(
  overrides: Partial<InvoicingPageViewProps['approvedInvoiceEmailState']> = {},
): InvoicingPageViewProps['approvedInvoiceEmailState'] {
  return {
    clearEmail: vi.fn(),
    clearError: vi.fn(),
    email: null,
    errorMessage: null,
    isPreparing: false,
    prepareEmail: vi.fn(async () => null),
    ...overrides,
  };
}

function createApprovedInvoicePdfState(
  overrides: Partial<InvoicingPageViewProps['approvedInvoicePdfState']> = {},
): InvoicingPageViewProps['approvedInvoicePdfState'] {
  return {
    clearError: vi.fn(),
    clearPdf: vi.fn(),
    createPdf: vi.fn(async () => null),
    document: null,
    errorMessage: null,
    getPdfUrl: vi.fn((id: string) => `/invoices/${id}/pdf`),
    isChecking: false,
    isCreating: false,
    loadPdfMetadata: vi.fn(async () => null),
    ...overrides,
  };
}

function createApprovedInvoiceListState(
  overrides: Partial<InvoicingPageViewProps['approvedInvoiceListState']> = {},
): InvoicingPageViewProps['approvedInvoiceListState'] {
  return {
    approvedInvoices: [],
    errorMessage: null,
    isLoading: false,
    refreshApprovedInvoices: vi.fn(),
    ...overrides,
  };
}

function createInvoiceDeliveryEventListState(
  overrides: Partial<
    InvoicingPageViewProps['invoiceDeliveryEventListState']
  > = {},
): InvoicingPageViewProps['invoiceDeliveryEventListState'] {
  return {
    clearEvents: vi.fn(),
    errorMessage: null,
    events: [],
    isLoading: false,
    loadEvents: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createApprovedInvoiceState(
  overrides: Partial<InvoicingPageViewProps['approvedInvoiceState']> = {},
): InvoicingPageViewProps['approvedInvoiceState'] {
  return {
    approvedInvoice: null,
    clearApprovedInvoice: vi.fn(),
    errorMessage: null,
    isLoading: false,
    openApprovedInvoice: vi.fn(),
    replaceApprovedInvoice: vi.fn(),
    ...overrides,
  };
}

function createMarkApprovedInvoiceSentState(
  overrides: Partial<InvoicingPageViewProps['markApprovedInvoiceSentState']> = {},
): InvoicingPageViewProps['markApprovedInvoiceSentState'] {
  return {
    clearError: vi.fn(),
    errorMessage: null,
    isMarkingSent: false,
    markApprovedInvoiceSent: vi.fn(async () => null),
    ...overrides,
  };
}

function createCopyApprovedInvoiceState(
  overrides: Partial<InvoicingPageViewProps['copyApprovedInvoiceState']> = {},
): InvoicingPageViewProps['copyApprovedInvoiceState'] {
  return {
    clearError: vi.fn(),
    copiedInvoiceId: null,
    copyApprovedInvoiceToDraft: vi.fn(async () => createInvoiceDraft()),
    errorMessage: null,
    isCopying: false,
    ...overrides,
  };
}

function createDeleteState(
  overrides: Partial<InvoicingPageViewProps['deleteState']> = {},
): InvoicingPageViewProps['deleteState'] {
  return {
    clearError: vi.fn(),
    deleteDraft: vi.fn(async () => true),
    deletingDraftId: null,
    errorMessage: null,
    ...overrides,
  };
}

function createReopenApprovedInvoiceState(
  overrides: Partial<InvoicingPageViewProps['reopenApprovedInvoiceState']> = {},
): InvoicingPageViewProps['reopenApprovedInvoiceState'] {
  return {
    clearError: vi.fn(),
    errorMessage: null,
    isReopening: false,
    reopenApprovedInvoice: vi.fn(async () => ({
      invoiceDraftId: 'draft-1',
      invoiceId: 'invoice-1',
    })),
    ...overrides,
  };
}

function createCompanySettingsState() {
  return {
    companySettings: {
      businessId: '',
      city: '',
      companyId: 'dev-company',
      companyName: 'Example Builder Oy',
      createdAt: '2026-06-13T18:00:00.000Z',
      defaultHourlyRateCents: 6500,
      email: '',
      emailDeliveryProvider: 'dryRun' as const,
      emailSenderName: '',
      emailSenderAddress: '',
      emailSmtpHost: '',
      emailSmtpPort: null,
      emailSmtpSecurity: 'tls' as const,
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

function createInvoicePaymentDefaultsState() {
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

function createCustomerListState() {
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

function createDraftEditorState(
  overrides: Partial<React.ComponentProps<typeof InvoicingPageView>['draftEditorState']> = {},
) {
  return {
    clearDraft: vi.fn(),
    draft: null,
    errorMessage: null,
    isLoading: false,
    openDraft: vi.fn(),
    replaceDraft: vi.fn(),
    ...overrides,
  };
}

function createInvoiceDraft() {
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
        discount: {
          type: 'none' as const,
        },
        discountCents: 0,
        grossCents: 12_331,
        id: 'line-1',
        netCents: 9825,
        position: 1,
        priceInputMode: 'net' as const,
        quantityHundredths: 150,
        unit: 'h' as const,
        unitPriceCents: 6550,
        vatCents: 2506,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Saate',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net' as const,
    reminderPeriodDays: 0,
    status: 'draft' as const,
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
