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
import {
  openPreservedInvoicePdf,
  type PreservedInvoicePdfTarget,
} from '../approved/openPreservedInvoicePdf.js';
import {
  openInvoiceDeliveryEventPdf,
  type DeliveryEventPdfTarget,
} from '../approved/openInvoiceDeliveryEventPdf.js';
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
import {
  resolveActiveInvoiceCustomerId,
  type InvoicingNavigationRequest,
} from '../invoicingNavigation.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoicingPageProps {
  apiClient: EkyApiClient;
  navigationRequest: InvoicingNavigationRequest;
  openInvoicePdfPreview?(invoiceId: string, target?: PreservedInvoicePdfTarget | DeliveryEventPdfTarget): Promise<void>;
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
  const [initialCustomerId, setInitialCustomerId] = useState<string | null>(
    null,
  );
  const [navigationErrorMessage, setNavigationErrorMessage] = useState<
    string | null
  >(null);
  const previousNavigationRevision = useRef(-1);
  const approvedSelectionGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++approvedSelectionGeneration.current;
      // StrictMode replays setup after cancelling the first navigation request.
      previousNavigationRevision.current = -1;
    };
  }, []);
  const [activeView, dispatch] = useReducer(
    reduceInvoicingPageMode,
    'draftList',
  );

  function clearApprovedSelection(): void {
    ++approvedSelectionGeneration.current;
    approvedInvoiceState.clearApprovedInvoice();
  }

  function handleBackToDrafts(): void {
    setInitialCustomerId(null);
    setNavigationErrorMessage(null);
    clearApprovedSelection();
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
    void draftState.refreshDrafts();
  }

  function handleOpenNewInvoice(customerId: string | null): void {
    handleBackToDrafts();
    setInitialCustomerId(customerId);
    dispatch({ type: 'openNewInvoice' });
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
      clearApprovedSelection();
      draftEditorState.clearDraft();
      approveCreditInvoiceDraftState.clearError();
      setPendingDeleteDraftId(null);
      dispatch({ type: 'openCreditInvoice' });
      void creditInvoiceDraftState.openDraft(id);
      return;
    }

    creditInvoiceDraftState.clearDraft();
    approveCreditInvoiceDraftState.clearError();
    clearApprovedSelection();
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
    const selectionGeneration = ++approvedSelectionGeneration.current;
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
    void invoiceDeliveryEventListState.loadEvents(id);
    const invoice = await approvedInvoiceState.openApprovedInvoice(id);
    if (invoice === null || selectionGeneration !== approvedSelectionGeneration.current) return;
    void approvedInvoicePdfState.loadPdfMetadata(id);

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
    if (!draftEditorState.replaceDraft(savedDraft)) {
      return;
    }
    dispatch({ type: 'draftSaved' });
    void draftState.refreshDrafts();
  }

  function handleDraftApproved(_approvedInvoice: ApprovedInvoiceResult): void {
    void draftState.refreshDrafts();
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  async function handleEditApprovedInvoice(id: string): Promise<void> {
    const selectionGeneration = approvedSelectionGeneration.current;
    const reopenedInvoice =
      await reopenApprovedInvoiceState.reopenApprovedInvoice(id);

    if (reopenedInvoice === null || !mounted.current) {
      return;
    }
    void draftState.refreshDrafts();
    void approvedInvoiceListState.refreshApprovedInvoices();
    if (selectionGeneration !== approvedSelectionGeneration.current) return;

    clearApprovedSelection();
    dispatch({ type: 'openEditInvoice' });
    void draftEditorState.openDraft(reopenedInvoice.invoiceDraftId);
  }

  async function handleMarkApprovedInvoiceSent(id: string): Promise<void> {
    const selectionGeneration = approvedSelectionGeneration.current;
    const sentInvoice =
      await markApprovedInvoiceSentState.markApprovedInvoiceSent(
        id,
        'manual',
      );

    if (sentInvoice === null || !mounted.current) {
      return;
    }
    void approvedInvoiceListState.refreshApprovedInvoices();
    if (selectionGeneration !== approvedSelectionGeneration.current) return;

    approvedInvoiceState.replaceApprovedInvoice(sentInvoice);
    void approvedInvoicePdfState.loadPdfMetadata(id);
    void invoiceCreditContextState.loadCreditContext(id);
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
    const selectionGeneration = approvedSelectionGeneration.current;
    const copiedDraft =
      await copyApprovedInvoiceState.copyApprovedInvoiceToDraft(id);

    if (copiedDraft === null || !mounted.current) {
      return;
    }
    void draftState.refreshDrafts();
    if (selectionGeneration !== approvedSelectionGeneration.current) return;

    clearApprovedSelection();
    invoiceCreditContextState.clearCreditContext();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    draftEditorState.openLoadedDraft(copiedDraft);
    dispatch({ type: 'openEditInvoice' });
  }

  async function handleCancelApprovedInvoice(
    id: string,
    input: CancelApprovedInvoiceInput,
  ): Promise<void> {
    const selectionGeneration = approvedSelectionGeneration.current;
    const cancellation =
      await cancelApprovedInvoiceState.cancelApprovedInvoice(id, input);

    if (cancellation === null || !mounted.current) {
      return;
    }
    void approvedInvoiceListState.refreshApprovedInvoices();
    if (selectionGeneration !== approvedSelectionGeneration.current) return;

    clearApprovedSelection();
    invoiceCreditContextState.clearCreditContext();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    invoiceDeliveryEventListState.clearEvents();
    dispatch({ type: 'showDraftList' });
  }

  async function handleCreateCreditInvoiceDraft(
    invoiceId: string,
  ): Promise<void> {
    clearApprovedSelection();
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
    const selectionGeneration = approvedSelectionGeneration.current;
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    const email = await approvedInvoiceEmailState.prepareEmail(id);
    if (selectionGeneration !== approvedSelectionGeneration.current) return;
    if (email !== null && email.documentTarget.kind === 'revision') {
      void approvedInvoicePdfState.loadPdfMetadata(id);
    }
  }

  async function handleSendApprovedInvoiceEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): Promise<void> {
    const selectionGeneration = approvedSelectionGeneration.current;
    await sendApprovedInvoiceEmailState.sendEmailDryRun(id, input);
    if (selectionGeneration === approvedSelectionGeneration.current) {
      void invoiceDeliveryEventListState.loadEvents(id);
    }
  }

  async function handleSendApprovedInvoiceEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): Promise<void> {
    const selectionGeneration = approvedSelectionGeneration.current;
    await sendApprovedInvoiceEmailSmtpTestState.sendEmailSmtpTest(id, input);
    if (selectionGeneration === approvedSelectionGeneration.current) {
      void invoiceDeliveryEventListState.loadEvents(id);
    }
  }

  async function handleSendApprovedInvoiceEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): Promise<void> {
    const selectionGeneration = approvedSelectionGeneration.current;
    const result = await sendApprovedInvoiceEmailSmtpState.sendEmailSmtp(
      id,
      input,
    );
    if (!mounted.current) return;
    if (result !== null) void approvedInvoiceListState.refreshApprovedInvoices();
    if (selectionGeneration !== approvedSelectionGeneration.current) return;
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
  }

  useEffect(() => {
    if (
      previousNavigationRevision.current === navigationRequest.revision
    ) {
      return;
    }

    if (navigationRequest.target === null) {
      previousNavigationRevision.current = navigationRequest.revision;
      handleBackToDrafts();
      return;
    }

    if (
      navigationRequest.target.type === 'createInvoiceForCustomer'
    ) {
      if (customerListState.isLoading) {
        return;
      }

      previousNavigationRevision.current = navigationRequest.revision;
      const customerId = resolveActiveInvoiceCustomerId(
        customerListState.customers,
        navigationRequest.target.customerId,
      );

      if (
        customerListState.errorMessage !== null ||
        customerId === null
      ) {
        handleBackToDrafts();
        setNavigationErrorMessage(
          uiText.invoicing.createInvoiceCustomerUnavailable,
        );
        return;
      }

      handleOpenNewInvoice(customerId);
      return;
    }

    previousNavigationRevision.current = navigationRequest.revision;
    setInitialCustomerId(null);
    setNavigationErrorMessage(null);

    if (navigationRequest.target.type === 'draft') {
      handleOpenDraft(
        navigationRequest.target.id,
        navigationRequest.target.invoiceKind,
      );
      return;
    }

    void handleOpenApprovedInvoice(navigationRequest.target.id);
  }, [
    customerListState.customers,
    customerListState.errorMessage,
    customerListState.isLoading,
    navigationRequest,
  ]);

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
      initialCustomerId={initialCustomerId}
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
      navigationErrorMessage={navigationErrorMessage}
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
      onOpenPreservedPdf={(invoiceId, documentId) => openPreservedInvoicePdf({
        invoiceId,
        documentId,
        getPdfUrl: (id, document) => apiClient.getPreservedLegacyInvoicePdfUrl(id, document),
        openBrowserWindow: window.open.bind(window),
        ...(openInvoicePdfPreview === undefined
          ? {}
          : { openDesktopPreview: openInvoicePdfPreview }),
      })}
      onOpenDeliveryEventPdf={(invoiceId, eventId) => openInvoiceDeliveryEventPdf({
        invoiceId,
        eventId,
        getPdfUrl: (id, event) => apiClient.getInvoiceDeliveryEventPdfUrl(id, event),
        openBrowserWindow: window.open.bind(window),
        ...(openInvoicePdfPreview === undefined
          ? {}
          : { openDesktopPreview: openInvoicePdfPreview }),
      })}
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
      onNewInvoice={() => handleOpenNewInvoice(null)}
    />
  );
}
