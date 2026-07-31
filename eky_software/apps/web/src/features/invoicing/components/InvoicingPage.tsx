import { useEffect, useReducer, useRef, useState } from 'react';
import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceResult,
  CancelApprovedInvoiceInput,
  EkyApiClient,
  InvoiceDraft,
  InvoiceKind,
  UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';

import { InvoicingPageView } from './InvoicingPageView.js';
import { reduceInvoicingPageMode } from '../state/invoicingPageState.js';
import { useInvoiceDrafts } from '../hooks/useInvoiceDrafts.js';
import { useInvoiceCustomers } from '../hooks/useInvoiceCustomers.js';
import { useInvoiceCompanySettings } from '../hooks/useInvoiceCompanySettings.js';
import { useInvoicePaymentDefaults } from '../hooks/useInvoicePaymentDefaults.js';
import { useInvoiceVatRates } from '../hooks/useInvoiceVatRates.js';
import { useInvoiceDraftEditor } from '../hooks/useInvoiceDraftEditor.js';
import { useApprovedInvoice } from '../hooks/useApprovedInvoice.js';
import { useApprovedInvoices } from '../hooks/useApprovedInvoices.js';
import { useApprovedInvoicePdf } from '../hooks/useApprovedInvoicePdf.js';
import { useApprovedInvoiceEmailDryRun } from '../hooks/useApprovedInvoiceEmailDryRun.js';
import { openApprovedInvoicePdf } from '../approved/openApprovedInvoicePdf.js';
import { useSendApprovedInvoiceEmailDryRun } from '../hooks/useSendApprovedInvoiceEmailDryRun.js';
import { useSendApprovedInvoiceEmailSmtpTest } from '../hooks/useSendApprovedInvoiceEmailSmtpTest.js';
import { useSendApprovedInvoiceEmailSmtp } from '../hooks/useSendApprovedInvoiceEmailSmtp.js';
import {
  deleteInvoiceDraftAndRefresh,
  useDeleteInvoiceDraft,
} from '../hooks/useDeleteInvoiceDraft.js';
import { useReopenApprovedInvoiceForEditing } from '../hooks/useReopenApprovedInvoiceForEditing.js';
import { useMarkApprovedInvoiceSent } from '../hooks/useMarkApprovedInvoiceSent.js';
import { useCopyApprovedInvoiceToDraft } from '../hooks/useCopyApprovedInvoiceToDraft.js';
import { useInvoiceDeliveryEvents } from '../hooks/useInvoiceDeliveryEvents.js';
import { useCancelApprovedInvoice } from '../hooks/useCancelApprovedInvoice.js';
import { useCreditInvoiceDraft } from '../hooks/useCreditInvoiceDraft.js';
import { useApproveCreditInvoiceDraft } from '../hooks/useApproveCreditInvoiceDraft.js';
import { useInvoiceCreditContext } from '../hooks/useInvoiceCreditContext.js';
import { useInvoicePayment } from '../hooks/useInvoicePayment.js';
import type { InvoicingNavigationRequest } from '../invoicingNavigation.js';

interface InvoicingPageProps {
  apiClient: EkyApiClient;
  navigationRequest: InvoicingNavigationRequest;
  openInvoicePdfPreview?(invoiceId: string): Promise<void>;
}

export function InvoicingPage({
  apiClient,
  navigationRequest,
  openInvoicePdfPreview,
}: InvoicingPageProps): React.JSX.Element {
  const draftState = useInvoiceDrafts(apiClient);
  const customerListState = useInvoiceCustomers(apiClient);
  const companySettingsState = useInvoiceCompanySettings(apiClient);
  const invoicePaymentDefaultsState = useInvoicePaymentDefaults(apiClient);
  const invoiceVatRatesState = useInvoiceVatRates(apiClient);
  const draftEditorState = useInvoiceDraftEditor(apiClient);
  const approvedInvoiceState = useApprovedInvoice(apiClient);
  const approvedInvoiceListState = useApprovedInvoices(apiClient);
  const approvedInvoicePdfState = useApprovedInvoicePdf(apiClient);
  const approvedInvoiceEmailState = useApprovedInvoiceEmailDryRun(apiClient);
  const sendApprovedInvoiceEmailState =
    useSendApprovedInvoiceEmailDryRun(apiClient);
  const sendApprovedInvoiceEmailSmtpTestState =
    useSendApprovedInvoiceEmailSmtpTest(apiClient);
  const sendApprovedInvoiceEmailSmtpState =
    useSendApprovedInvoiceEmailSmtp(apiClient);
  const deleteState = useDeleteInvoiceDraft(apiClient);
  const reopenApprovedInvoiceState =
    useReopenApprovedInvoiceForEditing(apiClient);
  const markApprovedInvoiceSentState = useMarkApprovedInvoiceSent(apiClient);
  const copyApprovedInvoiceState = useCopyApprovedInvoiceToDraft(apiClient);
  const invoiceDeliveryEventListState = useInvoiceDeliveryEvents(apiClient);
  const cancelApprovedInvoiceState = useCancelApprovedInvoice(apiClient);
  const creditInvoiceDraftState = useCreditInvoiceDraft(apiClient);
  const approveCreditInvoiceDraftState =
    useApproveCreditInvoiceDraft(apiClient);
  const invoiceCreditContextState = useInvoiceCreditContext(apiClient);
  const invoicePaymentState = useInvoicePayment(apiClient);
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<
    string | null
  >(null);
  const previousNavigationRevision = useRef(-1);
  const [activeView, dispatch] = useReducer(
    reduceInvoicingPageMode,
    'draftList',
  );

  function handleBackToDrafts(): void {
    approvedInvoiceState.clearApprovedInvoice();
    draftEditorState.clearDraft();
    deleteState.clearError();
    reopenApprovedInvoiceState.clearError();
    markApprovedInvoiceSentState.clearError();
    copyApprovedInvoiceState.clearError();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    invoiceDeliveryEventListState.clearEvents();
    cancelApprovedInvoiceState.clearError();
    creditInvoiceDraftState.clearDraft();
    approveCreditInvoiceDraftState.clearError();
    invoiceCreditContextState.clearCreditContext();
    invoicePaymentState.clearStatus();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'showDraftList' });
  }

  function handleOpenDraft(
    id: string,
    requestedInvoiceKind?: InvoiceKind,
  ): void {
    invoiceCreditContextState.clearCreditContext();
    invoicePaymentState.clearStatus();
    const draft = draftState.drafts.find((item) => item.id === id);
    const invoiceKind = requestedInvoiceKind ?? draft?.invoiceKind;

    if (invoiceKind === 'credit') {
      approvedInvoiceState.clearApprovedInvoice();
      draftEditorState.clearDraft();
      approveCreditInvoiceDraftState.clearError();
      setPendingDeleteDraftId(null);
      dispatch({ type: 'openCreditInvoice' });
      void creditInvoiceDraftState.openDraft(id);
      return;
    }

    creditInvoiceDraftState.clearDraft();
    approveCreditInvoiceDraftState.clearError();
    approvedInvoiceState.clearApprovedInvoice();
    reopenApprovedInvoiceState.clearError();
    markApprovedInvoiceSentState.clearError();
    copyApprovedInvoiceState.clearError();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    invoiceDeliveryEventListState.clearEvents();
    cancelApprovedInvoiceState.clearError();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openEditInvoice' });
    void draftEditorState.openDraft(id);
  }

  async function handleOpenApprovedInvoice(id: string): Promise<void> {
    creditInvoiceDraftState.clearDraft();
    draftEditorState.clearDraft();
    deleteState.clearError();
    reopenApprovedInvoiceState.clearError();
    markApprovedInvoiceSentState.clearError();
    copyApprovedInvoiceState.clearError();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    invoiceDeliveryEventListState.clearEvents();
    cancelApprovedInvoiceState.clearError();
    invoiceCreditContextState.clearCreditContext();
    invoicePaymentState.clearStatus();
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openApprovedInvoice' });
    const invoice = await approvedInvoiceState.openApprovedInvoice(id);
    void approvedInvoicePdfState.loadPdfMetadata(id);
    void invoiceDeliveryEventListState.loadEvents(id);

    if (invoice?.invoiceKind === 'standard' && invoice.status === 'sent') {
      void invoiceCreditContextState.loadCreditContext(id);
    }
  }

  function handleRequestDeleteDraft(id: string): void {
    deleteState.clearError();
    setPendingDeleteDraftId(id);
  }

  function handleCancelDeleteDraft(): void {
    deleteState.clearError();
    setPendingDeleteDraftId(null);
  }

  async function handleConfirmDeleteDraft(id: string): Promise<void> {
    const wasDeleted = await deleteInvoiceDraftAndRefresh(
      id,
      deleteState.deleteDraft,
      draftState.refreshDrafts,
    );

    if (!wasDeleted) {
      return;
    }

    setPendingDeleteDraftId(null);
  }

  function handleDraftSaved(savedDraft: InvoiceDraft): void {
    draftEditorState.replaceDraft(savedDraft);
    dispatch({ type: 'draftSaved' });
    void draftState.refreshDrafts();
  }

  function handleDraftApproved(_approvedInvoice: ApprovedInvoiceResult): void {
    void draftState.refreshDrafts();
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleEditApprovedInvoice(id: string): Promise<void> {
    const reopenedInvoice =
      await reopenApprovedInvoiceState.reopenApprovedInvoice(id);

    if (reopenedInvoice === null) {
      return;
    }

    approvedInvoiceState.clearApprovedInvoice();
    dispatch({ type: 'openEditInvoice' });
    void draftState.refreshDrafts();
    void approvedInvoiceListState.refreshApprovedInvoices();
    void draftEditorState.openDraft(reopenedInvoice.invoiceDraftId);
  }

  async function handleMarkApprovedInvoiceSent(id: string): Promise<void> {
    const pdfMetadata = await approvedInvoicePdfState.createPdf(id);

    if (pdfMetadata === null) {
      return;
    }

    const sentInvoice =
      await markApprovedInvoiceSentState.markApprovedInvoiceSent(
        id,
        'manual',
      );

    if (sentInvoice === null) {
      return;
    }

    approvedInvoiceState.replaceApprovedInvoice(sentInvoice);
    void invoiceCreditContextState.loadCreditContext(id);
    void approvedInvoiceListState.refreshApprovedInvoices();
    void invoiceDeliveryEventListState.loadEvents(id);
  }

  async function handleMarkInvoicePaid(
    id: string,
    paidOn: string,
  ): Promise<void> {
    const payment = await invoicePaymentState.markPaid(id, paidOn);
    const currentInvoice = approvedInvoiceState.approvedInvoice;

    if (payment === null || currentInvoice?.id !== id) {
      return;
    }

    approvedInvoiceState.replaceApprovedInvoice({
      ...currentInvoice,
      paidAmountCents: payment.paidAmountCents,
      paidOn: payment.paidOn,
      paymentSource: payment.paymentSource,
      paymentState: payment.paymentState,
    });
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleRevertInvoicePaidMark(id: string): Promise<void> {
    const payment = await invoicePaymentState.revertPaidMark(id);
    const currentInvoice = approvedInvoiceState.approvedInvoice;

    if (payment === null || currentInvoice?.id !== id) {
      return;
    }

    approvedInvoiceState.replaceApprovedInvoice({
      ...currentInvoice,
      paidAmountCents: payment.paidAmountCents,
      paidOn: payment.paidOn,
      paymentSource: payment.paymentSource,
      paymentState: payment.paymentState,
    });
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleCopyApprovedInvoiceToDraft(id: string): Promise<void> {
    const copiedDraft =
      await copyApprovedInvoiceState.copyApprovedInvoiceToDraft(id);

    if (copiedDraft === null) {
      return;
    }

    approvedInvoiceState.clearApprovedInvoice();
    invoiceCreditContextState.clearCreditContext();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    draftEditorState.replaceDraft(copiedDraft);
    dispatch({ type: 'openEditInvoice' });
    void draftState.refreshDrafts();
  }

  async function handleCancelApprovedInvoice(
    id: string,
    input: CancelApprovedInvoiceInput,
  ): Promise<void> {
    const cancellation =
      await cancelApprovedInvoiceState.cancelApprovedInvoice(id, input);

    if (cancellation === null) {
      return;
    }

    approvedInvoiceState.clearApprovedInvoice();
    invoiceCreditContextState.clearCreditContext();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    invoiceDeliveryEventListState.clearEvents();
    dispatch({ type: 'showDraftList' });
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleCreateCreditInvoiceDraft(
    invoiceId: string,
  ): Promise<void> {
    dispatch({ type: 'openCreditInvoice' });
    const creditDraft = await creditInvoiceDraftState.createDraft(invoiceId);

    if (creditDraft !== null) {
      void draftState.refreshDrafts();
    }
  }

  async function handleSaveCreditInvoiceDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): Promise<void> {
    const savedDraft = await creditInvoiceDraftState.saveDraft(
      invoiceDraftId,
      input,
    );

    if (savedDraft !== null) {
      void draftState.refreshDrafts();
    }
  }

  async function handleApproveCreditInvoiceDraft(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): Promise<void> {
    const savedDraft = await creditInvoiceDraftState.saveDraft(
      invoiceDraftId,
      input,
    );

    if (savedDraft === null) {
      return;
    }

    const approvedInvoice =
      await approveCreditInvoiceDraftState.approveDraft(invoiceDraftId);

    if (approvedInvoice === null) {
      return;
    }

    creditInvoiceDraftState.clearDraft();
    void draftState.refreshDrafts();
    void approvedInvoiceListState.refreshApprovedInvoices();
    void handleOpenApprovedInvoice(approvedInvoice.invoiceId);
  }

  async function handleOpenApprovedInvoicePdf(id: string): Promise<void> {
    await openApprovedInvoicePdf({
      createPdf: approvedInvoicePdfState.createPdf,
      getPdfUrl: approvedInvoicePdfState.getPdfUrl,
      id,
      openBrowserWindow: window.open.bind(window),
      ...(openInvoicePdfPreview === undefined
        ? {}
        : { openDesktopPreview: openInvoicePdfPreview }),
    });
  }

  async function handlePrepareApprovedInvoiceEmail(id: string): Promise<void> {
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    const metadata = await approvedInvoicePdfState.createPdf(id);

    if (metadata === null) {
      return;
    }

    await approvedInvoiceEmailState.prepareEmail(id);
  }

  async function handleSendApprovedInvoiceEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): Promise<void> {
    await sendApprovedInvoiceEmailState.sendEmailDryRun(id, input);
  }

  async function handleSendApprovedInvoiceEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): Promise<void> {
    await sendApprovedInvoiceEmailSmtpTestState.sendEmailSmtpTest(id, input);
  }

  async function handleSendApprovedInvoiceEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): Promise<void> {
    const result = await sendApprovedInvoiceEmailSmtpState.sendEmailSmtp(
      id,
      input,
    );
    void invoiceDeliveryEventListState.loadEvents(id);

    if (result === null) {
      return;
    }

    approvedInvoiceState.replaceApprovedInvoice(result.invoice);
    if (
      result.invoice.invoiceKind === 'standard' &&
      result.invoice.status === 'sent'
    ) {
      void invoiceCreditContextState.loadCreditContext(id);
    }
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  useEffect(() => {
    if (
      previousNavigationRevision.current === navigationRequest.revision
    ) {
      return;
    }

    previousNavigationRevision.current = navigationRequest.revision;

    if (navigationRequest.target === null) {
      handleBackToDrafts();
      return;
    }

    if (navigationRequest.target.type === 'draft') {
      handleOpenDraft(
        navigationRequest.target.id,
        navigationRequest.target.invoiceKind,
      );
      return;
    }

    void handleOpenApprovedInvoice(navigationRequest.target.id);
  }, [navigationRequest]);

  return (
    <InvoicingPageView
      activeView={activeView}
      apiClient={apiClient}
      approveCreditInvoiceDraftState={approveCreditInvoiceDraftState}
      approvedInvoiceListState={approvedInvoiceListState}
      approvedInvoiceEmailState={approvedInvoiceEmailState}
      approvedInvoicePdfState={approvedInvoicePdfState}
      approvedInvoiceState={approvedInvoiceState}
      cancelApprovedInvoiceState={cancelApprovedInvoiceState}
      customerListState={customerListState}
      companySettingsState={companySettingsState}
      copyApprovedInvoiceState={copyApprovedInvoiceState}
      creditInvoiceDraftState={creditInvoiceDraftState}
      deleteState={deleteState}
      drafts={draftState.drafts}
      draftErrorMessage={draftState.errorMessage}
      draftEditorState={draftEditorState}
      invoicePaymentDefaultsState={invoicePaymentDefaultsState}
      invoiceVatRatesState={invoiceVatRatesState}
      invoiceDeliveryEventListState={invoiceDeliveryEventListState}
      invoiceCreditContextState={invoiceCreditContextState}
      invoicePaymentState={invoicePaymentState}
      markApprovedInvoiceSentState={markApprovedInvoiceSentState}
      isDraftListLoading={draftState.isLoading}
      pendingDeleteDraftId={pendingDeleteDraftId}
      reopenApprovedInvoiceState={reopenApprovedInvoiceState}
      sendApprovedInvoiceEmailState={sendApprovedInvoiceEmailState}
      sendApprovedInvoiceEmailSmtpTestState={
        sendApprovedInvoiceEmailSmtpTestState
      }
      sendApprovedInvoiceEmailSmtpState={sendApprovedInvoiceEmailSmtpState}
      onBackToDrafts={handleBackToDrafts}
      onApproveCreditInvoiceDraft={(id, input) =>
        void handleApproveCreditInvoiceDraft(id, input)
      }
      onCancelApprovedInvoice={(id, input) =>
        void handleCancelApprovedInvoice(id, input)
      }
      onCancelDeleteDraft={handleCancelDeleteDraft}
      onConfirmDeleteDraft={(id) => void handleConfirmDeleteDraft(id)}
      onDraftApproved={handleDraftApproved}
      onDraftSaved={handleDraftSaved}
      onOpenApprovedInvoice={(id) => void handleOpenApprovedInvoice(id)}
      onCreateApprovedInvoicePdf={(id) =>
        void approvedInvoicePdfState.createPdf(id)
      }
      onCopyApprovedInvoiceToDraft={(id) =>
        void handleCopyApprovedInvoiceToDraft(id)
      }
      onCreateCreditInvoiceDraft={(id) =>
        void handleCreateCreditInvoiceDraft(id)
      }
      onEditApprovedInvoice={(id) => void handleEditApprovedInvoice(id)}
      onMarkApprovedInvoiceSent={(id) =>
        void handleMarkApprovedInvoiceSent(id)
      }
      onMarkInvoicePaid={(id, paidOn) =>
        void handleMarkInvoicePaid(id, paidOn)
      }
      onOpenApprovedInvoicePdf={(id) =>
        void handleOpenApprovedInvoicePdf(id)
      }
      onPrepareApprovedInvoiceEmail={(id) =>
        void handlePrepareApprovedInvoiceEmail(id)
      }
      onRevertInvoicePaidMark={(id) =>
        void handleRevertInvoicePaidMark(id)
      }
      onSendApprovedInvoiceEmailDryRun={(id, input) =>
        void handleSendApprovedInvoiceEmailDryRun(id, input)
      }
      onSendApprovedInvoiceEmailSmtpTest={(id, input) =>
        void handleSendApprovedInvoiceEmailSmtpTest(id, input)
      }
      onSendApprovedInvoiceEmailSmtp={(id, input) =>
        void handleSendApprovedInvoiceEmailSmtp(id, input)
      }
      onOpenDraft={handleOpenDraft}
      onSaveCreditInvoiceDraft={(id, input) =>
        void handleSaveCreditInvoiceDraft(id, input)
      }
      onRequestDeleteDraft={handleRequestDeleteDraft}
      onNewInvoice={() => dispatch({ type: 'openNewInvoice' })}
    />
  );
}
