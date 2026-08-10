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

  it('renders a safe customer navigation error without technical details', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: {
        customers: [],
        errorMessage: null,
        isLoading: false,
      },
      drafts: [],
      draftErrorMessage: null,
      isDraftListLoading: false,
      draftEditorState: createDraftEditorState(),
      navigationErrorMessage:
        uiText.invoicing.createInvoiceCustomerUnavailable,
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(
      uiText.invoicing.createInvoiceCustomerUnavailable,
    );
    expect(html).not.toContain('customer-does-not-exist');
    expect(html).not.toContain('stack');
  });

});

type InvoicingPageViewProps = React.ComponentProps<typeof InvoicingPageView>;

function renderPage(
  props: Omit<
    InvoicingPageViewProps,
    | 'companySettingsState'
    | 'apiClient'
    | 'approvedInvoiceEmailState'
    | 'approvedInvoiceListState'
    | 'approvedInvoicePdfState'
    | 'approvedInvoiceState'
    | 'approveCreditInvoiceDraftState'
    | 'cancelApprovedInvoiceState'
    | 'copyApprovedInvoiceState'
    | 'creditInvoiceDraftState'
    | 'deleteState'
    | 'invoicePaymentDefaultsState'
    | 'invoiceVatRatesState'
    | 'initialCustomerId'
    | 'invoiceDeliveryEventListState'
    | 'invoiceCreditContextState'
    | 'invoicePaymentState'
    | 'markApprovedInvoiceSentState'
    | 'navigationErrorMessage'
    | 'reopenApprovedInvoiceState'
    | 'sendApprovedInvoiceEmailState'
    | 'sendApprovedInvoiceEmailSmtpState'
    | 'sendApprovedInvoiceEmailSmtpTestState'
    | 'onCancelDeleteDraft'
    | 'onCancelApprovedInvoice'
    | 'onApproveCreditInvoiceDraft'
    | 'onConfirmDeleteDraft'
    | 'onCreateApprovedInvoicePdf'
    | 'onCopyApprovedInvoiceToDraft'
    | 'onCreateCreditInvoiceDraft'
    | 'onDraftApproved'
    | 'onDraftSaved'
    | 'onEditApprovedInvoice'
    | 'onMarkApprovedInvoiceSent'
    | 'onMarkInvoicePaid'
    | 'onOpenApprovedInvoice'
    | 'onOpenApprovedInvoicePdf'
    | 'onPrepareApprovedInvoiceEmail'
    | 'onRevertInvoicePaidMark'
    | 'onSendApprovedInvoiceEmailDryRun'
    | 'onSendApprovedInvoiceEmailSmtp'
    | 'onSendApprovedInvoiceEmailSmtpTest'
    | 'onRequestDeleteDraft'
    | 'onSaveCreditInvoiceDraft'
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
        | 'approveCreditInvoiceDraftState'
        | 'cancelApprovedInvoiceState'
        | 'copyApprovedInvoiceState'
        | 'creditInvoiceDraftState'
        | 'deleteState'
        | 'invoicePaymentDefaultsState'
        | 'invoiceVatRatesState'
        | 'initialCustomerId'
        | 'invoiceDeliveryEventListState'
        | 'invoiceCreditContextState'
        | 'invoicePaymentState'
        | 'markApprovedInvoiceSentState'
        | 'navigationErrorMessage'
        | 'reopenApprovedInvoiceState'
        | 'sendApprovedInvoiceEmailState'
        | 'sendApprovedInvoiceEmailSmtpState'
        | 'sendApprovedInvoiceEmailSmtpTestState'
        | 'onCancelDeleteDraft'
        | 'onCancelApprovedInvoice'
        | 'onApproveCreditInvoiceDraft'
        | 'onConfirmDeleteDraft'
        | 'onCreateApprovedInvoicePdf'
        | 'onCopyApprovedInvoiceToDraft'
        | 'onCreateCreditInvoiceDraft'
        | 'onDraftApproved'
        | 'onDraftSaved'
        | 'onEditApprovedInvoice'
        | 'onMarkApprovedInvoiceSent'
        | 'onMarkInvoicePaid'
        | 'onOpenApprovedInvoice'
        | 'onOpenApprovedInvoicePdf'
        | 'onPrepareApprovedInvoiceEmail'
        | 'onRevertInvoicePaidMark'
        | 'onSendApprovedInvoiceEmailDryRun'
        | 'onSendApprovedInvoiceEmailSmtp'
        | 'onSendApprovedInvoiceEmailSmtpTest'
        | 'onRequestDeleteDraft'
        | 'onSaveCreditInvoiceDraft'
        | 'pendingDeleteDraftId'
      >
    >,
): string {
  return renderToStaticMarkup(
    <InvoicingPageView
      apiClient={createApiClient()}
      approvedInvoiceEmailState={createApprovedInvoiceEmailState()}
      approvedInvoiceListState={createApprovedInvoiceListState()}
      approvedInvoicePdfState={createApprovedInvoicePdfState()}
      approvedInvoiceState={createApprovedInvoiceState()}
      approveCreditInvoiceDraftState={{
        approveDraft: vi.fn(async () => null),
        clearError: vi.fn(),
        errorMessage: null,
        isApproving: false,
      }}
      cancelApprovedInvoiceState={createCancelApprovedInvoiceState()}
      companySettingsState={createCompanySettingsState()}
      copyApprovedInvoiceState={createCopyApprovedInvoiceState()}
      creditInvoiceDraftState={{
        clearDraft: vi.fn(),
        createDraft: vi.fn(async () => null),
        draft: null,
        errorMessage: null,
        isLoading: false,
        isSaving: false,
        openDraft: vi.fn(async () => null),
        saveDraft: vi.fn(async () => null),
        successMessage: null,
      }}
      deleteState={createDeleteState()}
      invoicePaymentDefaultsState={createInvoicePaymentDefaultsState()}
      invoiceVatRatesState={createInvoiceVatRatesState()}
      initialCustomerId={null}
      invoiceDeliveryEventListState={createInvoiceDeliveryEventListState()}
      invoiceCreditContextState={createInvoiceCreditContextState()}
      invoicePaymentState={{
        clearStatus: vi.fn(),
        errorMessage: null,
        isUpdating: false,
        markPaid: vi.fn(async () => null),
        revertPaidMark: vi.fn(async () => null),
        successMessage: null,
      }}
      markApprovedInvoiceSentState={createMarkApprovedInvoiceSentState()}
      navigationErrorMessage={null}
      reopenApprovedInvoiceState={createReopenApprovedInvoiceState()}
      sendApprovedInvoiceEmailState={createSendApprovedInvoiceEmailState()}
      sendApprovedInvoiceEmailSmtpState={
        createSendApprovedInvoiceEmailSmtpState()
      }
      sendApprovedInvoiceEmailSmtpTestState={
        createSendApprovedInvoiceEmailSmtpTestState()
      }
      onCancelDeleteDraft={vi.fn()}
      onCancelApprovedInvoice={vi.fn()}
      onApproveCreditInvoiceDraft={vi.fn()}
      onConfirmDeleteDraft={vi.fn()}
      onCreateApprovedInvoicePdf={vi.fn()}
      onCopyApprovedInvoiceToDraft={vi.fn()}
      onCreateCreditInvoiceDraft={vi.fn()}
      onDraftApproved={vi.fn()}
      onDraftSaved={vi.fn()}
      onEditApprovedInvoice={vi.fn()}
      onMarkApprovedInvoiceSent={vi.fn()}
      onMarkInvoicePaid={vi.fn()}
      onOpenApprovedInvoice={vi.fn()}
      onOpenApprovedInvoicePdf={vi.fn()}
      onPrepareApprovedInvoiceEmail={vi.fn()}
      onRevertInvoicePaidMark={vi.fn()}
      onSendApprovedInvoiceEmailDryRun={vi.fn()}
      onSendApprovedInvoiceEmailSmtp={vi.fn()}
      onSendApprovedInvoiceEmailSmtpTest={vi.fn()}
      onRequestDeleteDraft={vi.fn()}
      onSaveCreditInvoiceDraft={vi.fn()}
      pendingDeleteDraftId={null}
      {...props}
    />,
  );
}

function createApiClient(): InvoicingPageViewProps['apiClient'] {
  return {
    approveInvoiceDraft: vi.fn(),
    createInvoiceDraft: vi.fn(),
    getInvoiceIssuanceReadiness: vi.fn(async () => ({
      isReady: true,
      issues: [],
    })),
    updateInvoiceDraft: vi.fn(),
  };
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
    approved: createApprovedInvoicePageState(),
    cancelled: createApprovedInvoicePageState(),
    credited: createApprovedInvoicePageState(),
    paid: createApprovedInvoicePageState(),
    refreshApprovedInvoices: vi.fn(),
    sent: createApprovedInvoicePageState(),
    ...overrides,
  };
}

function createApprovedInvoicePageState(): InvoicingPageViewProps[
  'approvedInvoiceListState'
]['approved'] {
  return {
    controls: {
      fiscalYearStartYear: 2026,
      month: '2026-07',
      page: 1,
      pageSize: 20,
      periodMode: 'all',
      sort: 'invoiceDateDesc',
    },
    errorMessage: null,
    goToPage: vi.fn(),
    invoiceGroups: [],
    invoices: [],
    isFiscalYearFilterAvailable: true,
    isLoading: false,
    refresh: vi.fn(async () => undefined),
    setFiscalYearStartYear: vi.fn(),
    setMonth: vi.fn(),
    setPageSize: vi.fn(),
    setPeriodMode: vi.fn(),
    setSort: vi.fn(),
    totalCount: 0,
    totalPages: 0,
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

function createInvoiceCreditContextState(): InvoicingPageViewProps['invoiceCreditContextState'] {
  return {
    clearCreditContext: vi.fn(),
    creditContext: null,
    errorMessage: null,
    isLoading: false,
    loadCreditContext: vi.fn(async () => null),
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

function createCancelApprovedInvoiceState(
  overrides: Partial<
    InvoicingPageViewProps['cancelApprovedInvoiceState']
  > = {},
): InvoicingPageViewProps['cancelApprovedInvoiceState'] {
  return {
    cancelApprovedInvoice: vi.fn(async () => null),
    clearError: vi.fn(),
    errorMessage: null,
    isCancelling: false,
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

function createInvoiceVatRatesState() {
  return {
    errorMessage: null,
    isLoading: false,
    settings: {
      isPersisted: true,
      vatRates: [
        {
          isActive: true,
          isDefault: true,
          label: 'Yleinen ALV',
          rateBasisPoints: 2550,
          sortOrder: 0,
        },
      ],
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
    taxTreatment: 'normalVat' as const,
    performancePeriod: { type: 'invoiceDate' as const },
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
