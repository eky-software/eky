import type {
  ApprovedInvoiceSummary,
  ApprovedInvoiceView,
  Customer,
  InvoiceDraftSummary,
} from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoicingPageView } from './InvoicingPage.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoicingPageView', () => {
  it('renders invoice draft summaries and the new invoice placeholder', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [createInvoiceDraftSummary()],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain('Testilasku');
    expect(html).toContain('1001 – Esimerkki Asiakas Oy');
    expect(html).not.toContain('customer-1');
    expect(html).not.toContain('draft-1');
    expect(html).toContain('13.06.2026');
    expect(html).toContain('27.06.2026');
    expect(html).toContain('178,84');
    expect(html).toContain(uiText.invoicing.statusDraft);
    expect(html).toContain(`aria-label="${uiText.invoicing.deleteDraft}"`);
    expect(html).toContain(uiText.invoicing.newInvoice);
    expect(html).toContain(uiText.invoicing.approvedInvoiceList);
    expect(html).toContain('Laskunumero 20260001');
    expect(html).toContain('<button');
    expect(html).not.toContain(uiText.invoicing.saveDraft);
  });

  it('renders an inline confirmation before deleting a draft', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [createInvoiceDraftSummary()],
      errorMessage: null,
      isLoading: false,
      pendingDeleteDraftId: 'draft-1',
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.deleteDraftConfirm);
    expect(html).toContain(uiText.invoicing.deleteDraftConfirmAction);
    expect(html).toContain(uiText.invoicing.deleteDraftCancel);
  });

  it('renders a safe draft deletion error without technical response data', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      deleteState: createDeleteState({
        errorMessage: uiText.invoicing.deleteDraftError,
      }),
      drafts: [createInvoiceDraftSummary()],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.deleteDraftError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the empty state', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.empty);
  });

  it('splits approved and sent invoices into separate lists', () => {
    const html = renderPage({
      activeView: 'draftList',
      approvedInvoiceListState: createApprovedInvoiceListState({
        approvedInvoices: [
          createApprovedInvoiceSummary(),
          createApprovedInvoiceSummary({
            id: 'invoice-2',
            invoiceNumber: '20260002',
            status: 'sent',
          }),
        ],
      }),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onCopyApprovedInvoiceToDraft: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.approvedInvoiceList);
    expect(html).toContain(uiText.invoicing.sentInvoiceList);
    expect(html).toContain('Laskunumero 20260001');
    expect(html).toContain('Laskunumero 20260002');
    expect(html).not.toContain(uiText.invoicing.copyApprovedInvoice);
  });

  it('renders a safe sent invoice copy error without technical data', () => {
    const html = renderPage({
      activeView: 'approvedInvoice',
      approvedInvoiceState: createApprovedInvoiceState({
        approvedInvoice: createApprovedInvoiceView({
          status: 'sent',
        }),
      }),
      copyApprovedInvoiceState: createCopyApprovedInvoiceState({
        errorMessage: uiText.invoicing.copyApprovedInvoiceError,
      }),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.copyApprovedInvoiceError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders a safe error state without technical response data', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: uiText.invoicing.loadError,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.loadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders the loading state', () => {
    const html = renderPage({
      activeView: 'draftList',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: true,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.loading);
  });

  it('renders the new invoice Classic form shell', () => {
    const html = renderPage({
      activeView: 'newInvoice',
      customerListState: {
        customers: [],
        errorMessage: null,
        isLoading: true,
      },
      drafts: [],
      errorMessage: null,
      isLoading: false,
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

  it('renders the edit loading state while an invoice draft is opening', () => {
    const html = renderPage({
      activeView: 'editInvoice',
      approvedInvoiceState: createApprovedInvoiceState(),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState({
        isLoading: true,
      }),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.openingDraft);
  });

  it('renders a safe edit open error without technical response data', () => {
    const html = renderPage({
      activeView: 'editInvoice',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState({
        errorMessage: uiText.invoicing.openDraftError,
      }),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.openDraftError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('hydrates an opened invoice draft into the edit form', () => {
    const html = renderPage({
      activeView: 'editInvoice',
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState({
        draft: createInvoiceDraft(),
      }),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

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

  it('renders the approved invoice loading state', () => {
    const html = renderPage({
      activeView: 'approvedInvoice',
      approvedInvoiceState: createApprovedInvoiceState({
        isLoading: true,
      }),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.approvedInvoiceLoading);
  });

  it('renders a safe approved invoice loading error', () => {
    const html = renderPage({
      activeView: 'approvedInvoice',
      approvedInvoiceState: createApprovedInvoiceState({
        errorMessage: uiText.invoicing.approvedInvoiceLoadError,
      }),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.approvedInvoiceLoadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('renders an approved invoice preview from snapshot data', () => {
    const html = renderPage({
      activeView: 'approvedInvoice',
      approvedInvoiceState: createApprovedInvoiceState({
        approvedInvoice: createApprovedInvoiceView(),
      }),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain('Lasku 20260001');
    expect(html).toContain('202600017');
    expect(html).toContain('Example Builder Oy');
    expect(html).toContain('FI76543210');
    expect(html).toContain('Example Customer Oy');
    expect(html).toContain('Billing Recipient Oy');
    expect(html).toContain('Work row');
    expect(html).toContain('25,50 %');
    expect(html).toContain('125,50');
    expect(html).toContain(uiText.invoicing.approvedInvoicePdfCreate);
    expect(html).not.toContain(uiText.invoicing.approvedInvoiceOpenPdf);
  });

  it('renders a safe approved invoice PDF error without technical response data', () => {
    const html = renderPage({
      activeView: 'approvedInvoice',
      approvedInvoicePdfState: createApprovedInvoicePdfState({
        errorMessage: uiText.invoicing.approvedInvoicePdfError,
      }),
      approvedInvoiceState: createApprovedInvoiceState({
        approvedInvoice: createApprovedInvoiceView(),
      }),
      customerListState: createCustomerListState(),
      drafts: [],
      errorMessage: null,
      isLoading: false,
      draftEditorState: createDraftEditorState(),
      onBackToDrafts: vi.fn(),
      onOpenDraft: vi.fn(),
      onNewInvoice: vi.fn(),
    });

    expect(html).toContain(uiText.invoicing.approvedInvoicePdfError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
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
    | 'markApprovedInvoiceSentState'
    | 'reopenApprovedInvoiceState'
    | 'sendApprovedInvoiceEmailState'
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
    | 'onSendApprovedInvoiceEmailSmtpTest'
    | 'onRequestDeleteDraft'
    | 'pendingDeleteDraftId'
    | 'refreshDrafts'
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
        | 'markApprovedInvoiceSentState'
        | 'reopenApprovedInvoiceState'
        | 'sendApprovedInvoiceEmailState'
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
        | 'onSendApprovedInvoiceEmailSmtpTest'
        | 'onRequestDeleteDraft'
        | 'pendingDeleteDraftId'
        | 'refreshDrafts'
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
      markApprovedInvoiceSentState={createMarkApprovedInvoiceSentState()}
      reopenApprovedInvoiceState={createReopenApprovedInvoiceState()}
      sendApprovedInvoiceEmailState={createSendApprovedInvoiceEmailState()}
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
      onSendApprovedInvoiceEmailSmtpTest={vi.fn()}
      onRequestDeleteDraft={vi.fn()}
      pendingDeleteDraftId={null}
      refreshDrafts={vi.fn()}
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
    approvedInvoices: [createApprovedInvoiceSummary()],
    errorMessage: null,
    isLoading: false,
    refreshApprovedInvoices: vi.fn(),
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
    markApprovedInvoiceSent: vi.fn(async () => createApprovedInvoiceView({
      status: 'sent',
    })),
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
      emailSmtpSecurity: 'starttls' as const,
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

function createInvoiceDraftSummary(): InvoiceDraftSummary {
  return {
    id: 'draft-1',
    customerId: 'customer-1',
    status: 'draft',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    subject: 'Testilasku',
    netTotalCents: 14_250,
    vatTotalCents: 3634,
    grossTotalCents: 17_884,
    updatedAt: '2026-06-13T18:00:00.000Z',
  };
}

function createApprovedInvoiceSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
  return {
    id: 'invoice-1',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Esimerkki Asiakas Oy',
    billingRecipientNameSnapshot: 'Esimerkki Asiakas Oy',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    grossTotalCents: 17_884,
    approvedAt: '2026-06-13T18:00:00.000Z',
    updatedAt: '2026-06-13T18:00:00.000Z',
    ...overrides,
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

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientPhoneSnapshot: '',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    companyBankNameSnapshot: 'Example Bank',
    companyBicSnapshot: 'NDEAFIHH',
    companyBusinessIdSnapshot: '7654321-0',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyId: 'dev-company',
    companyNameSnapshot: 'Example Builder Oy',
    companyPhoneSnapshot: '03 123 4567',
    companyPostalCodeSnapshot: '33100',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyVatNumberSnapshot: 'FI76543210',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    createdAt: '2026-06-13T10:00:00.000Z',
    customerBusinessIdSnapshot: '1234567-8',
    customerCitySnapshot: 'Helsinki',
    customerEmailSnapshot: '',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '',
    customerPostalCodeSnapshot: '00100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: '',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: '',
        description: 'Work row',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        lineOrder: 1,
        netCents: 10000,
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: '',
    numberingMode: 'calendarYearSequence',
    orderNumber: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 8,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'approved',
    subject: 'Approved invoice',
    totals: {
      grossTotalCents: 12550,
      netTotalCents: 10000,
      vatBreakdown: [
        {
          grossCents: 12550,
          netCents: 10000,
          vatCents: 2550,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2550,
    },
    updatedAt: '2026-06-13T10:00:00.000Z',
    vatBreakdown: [
      {
        grossCents: 12550,
        netCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    ...overrides,
  };
}
