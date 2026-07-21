import { useEffect, useReducer, useRef, useState } from 'react';
import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceResult,
  InvoiceDraft,
} from '@eky/api-client';

import { InvoicingPageView } from './InvoicingPageView.js';
import { reduceInvoicingPageMode } from '../state/invoicingPageState.js';
import { useInvoiceDrafts } from '../hooks/useInvoiceDrafts.js';
import { useInvoiceCustomers } from '../hooks/useInvoiceCustomers.js';
import { useInvoiceCompanySettings } from '../hooks/useInvoiceCompanySettings.js';
import { useInvoicePaymentDefaults } from '../hooks/useInvoicePaymentDefaults.js';
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

interface InvoicingPageProps {
  navigationRevision: number;
  openInvoicePdfPreview?(invoiceId: string): Promise<void>;
}

export function InvoicingPage({
  navigationRevision,
  openInvoicePdfPreview,
}: InvoicingPageProps): React.JSX.Element {
  const draftState = useInvoiceDrafts();
  const customerListState = useInvoiceCustomers();
  const companySettingsState = useInvoiceCompanySettings();
  const invoicePaymentDefaultsState = useInvoicePaymentDefaults();
  const draftEditorState = useInvoiceDraftEditor();
  const approvedInvoiceState = useApprovedInvoice();
  const approvedInvoiceListState = useApprovedInvoices();
  const approvedInvoicePdfState = useApprovedInvoicePdf();
  const approvedInvoiceEmailState = useApprovedInvoiceEmailDryRun();
  const sendApprovedInvoiceEmailState = useSendApprovedInvoiceEmailDryRun();
  const sendApprovedInvoiceEmailSmtpTestState =
    useSendApprovedInvoiceEmailSmtpTest();
  const sendApprovedInvoiceEmailSmtpState = useSendApprovedInvoiceEmailSmtp();
  const deleteState = useDeleteInvoiceDraft();
  const reopenApprovedInvoiceState = useReopenApprovedInvoiceForEditing();
  const markApprovedInvoiceSentState = useMarkApprovedInvoiceSent();
  const copyApprovedInvoiceState = useCopyApprovedInvoiceToDraft();
  const invoiceDeliveryEventListState = useInvoiceDeliveryEvents();
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<
    string | null
  >(null);
  const previousNavigationRevision = useRef(navigationRevision);
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
    setPendingDeleteDraftId(null);
    dispatch({ type: 'showDraftList' });
  }

  function handleOpenDraft(id: string): void {
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
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openEditInvoice' });
    void draftEditorState.openDraft(id);
  }

  function handleOpenApprovedInvoice(id: string): void {
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
    setPendingDeleteDraftId(null);
    dispatch({ type: 'openApprovedInvoice' });
    void approvedInvoiceState.openApprovedInvoice(id);
    void approvedInvoicePdfState.loadPdfMetadata(id);
    void invoiceDeliveryEventListState.loadEvents(id);
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
    void approvedInvoiceListState.refreshApprovedInvoices();
    void invoiceDeliveryEventListState.loadEvents(id);
  }

  async function handleCopyApprovedInvoiceToDraft(id: string): Promise<void> {
    const copiedDraft =
      await copyApprovedInvoiceState.copyApprovedInvoiceToDraft(id);

    if (copiedDraft === null) {
      return;
    }

    approvedInvoiceState.clearApprovedInvoice();
    approvedInvoicePdfState.clearPdf();
    approvedInvoiceEmailState.clearEmail();
    sendApprovedInvoiceEmailState.clearStatus();
    sendApprovedInvoiceEmailSmtpTestState.clearStatus();
    sendApprovedInvoiceEmailSmtpState.clearStatus();
    draftEditorState.replaceDraft(copiedDraft);
    dispatch({ type: 'openEditInvoice' });
    void draftState.refreshDrafts();
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
    void approvedInvoiceListState.refreshApprovedInvoices();
  }

  useEffect(() => {
    if (previousNavigationRevision.current === navigationRevision) {
      return;
    }

    previousNavigationRevision.current = navigationRevision;
    handleBackToDrafts();
  }, [navigationRevision]);

  return (
    <InvoicingPageView
      {...draftState}
      activeView={activeView}
      approvedInvoiceListState={approvedInvoiceListState}
      approvedInvoiceEmailState={approvedInvoiceEmailState}
      approvedInvoicePdfState={approvedInvoicePdfState}
      approvedInvoiceState={approvedInvoiceState}
      customerListState={customerListState}
      companySettingsState={companySettingsState}
      copyApprovedInvoiceState={copyApprovedInvoiceState}
      deleteState={deleteState}
      draftEditorState={draftEditorState}
      invoicePaymentDefaultsState={invoicePaymentDefaultsState}
      invoiceDeliveryEventListState={invoiceDeliveryEventListState}
      markApprovedInvoiceSentState={markApprovedInvoiceSentState}
      pendingDeleteDraftId={pendingDeleteDraftId}
      reopenApprovedInvoiceState={reopenApprovedInvoiceState}
      sendApprovedInvoiceEmailState={sendApprovedInvoiceEmailState}
      sendApprovedInvoiceEmailSmtpTestState={
        sendApprovedInvoiceEmailSmtpTestState
      }
      sendApprovedInvoiceEmailSmtpState={sendApprovedInvoiceEmailSmtpState}
      onBackToDrafts={handleBackToDrafts}
      onCancelDeleteDraft={handleCancelDeleteDraft}
      onConfirmDeleteDraft={(id) => void handleConfirmDeleteDraft(id)}
      onDraftApproved={handleDraftApproved}
      onDraftSaved={handleDraftSaved}
      onOpenApprovedInvoice={handleOpenApprovedInvoice}
      onCreateApprovedInvoicePdf={(id) =>
        void approvedInvoicePdfState.createPdf(id)
      }
      onCopyApprovedInvoiceToDraft={(id) =>
        void handleCopyApprovedInvoiceToDraft(id)
      }
      onEditApprovedInvoice={(id) => void handleEditApprovedInvoice(id)}
      onMarkApprovedInvoiceSent={(id) =>
        void handleMarkApprovedInvoiceSent(id)
      }
      onOpenApprovedInvoicePdf={(id) =>
        void handleOpenApprovedInvoicePdf(id)
      }
      onPrepareApprovedInvoiceEmail={(id) =>
        void handlePrepareApprovedInvoiceEmail(id)
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
      onRequestDeleteDraft={handleRequestDeleteDraft}
      onNewInvoice={() => dispatch({ type: 'openNewInvoice' })}
    />
  );
}
