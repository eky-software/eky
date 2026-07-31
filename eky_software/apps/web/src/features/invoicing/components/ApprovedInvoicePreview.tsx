import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceView,
  CancelApprovedInvoiceInput,
  InvoiceDeliveryEventSummary,
  InvoiceCreditContext,
} from '@eky/api-client';

import { ApprovedInvoiceActions } from './ApprovedInvoiceActions.js';
import { ApprovedInvoiceEmailPreview } from './ApprovedInvoiceEmailPreview.js';
import { ApprovedInvoiceFacts } from './ApprovedInvoiceFacts.js';
import { ApprovedInvoiceLineTable } from './ApprovedInvoiceLineTable.js';
import { ApprovedInvoicePartyDetails } from './ApprovedInvoicePartyDetails.js';
import { ApprovedInvoicePaymentDetails } from './ApprovedInvoicePaymentDetails.js';
import { ApprovedInvoiceTotals } from './ApprovedInvoiceTotals.js';
import { InvoiceDeliveryHistory } from './InvoiceDeliveryHistory.js';
import { InvoiceCreditRelations } from './InvoiceCreditRelations.js';
import { InvoicePaymentPanel } from './InvoicePaymentPanel.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoicePreviewProps {
  cancellationErrorMessage: string | null;
  copyErrorMessage: string | null;
  creditContext: InvoiceCreditContext | null;
  creditContextErrorMessage: string | null;
  invoice: ApprovedInvoiceView;
  isCancellingInvoice: boolean;
  isCopyingInvoice: boolean;
  isCreatingPdf: boolean;
  isLoadingCreditContext: boolean;
  isMarkingSent: boolean;
  isPreparingEmail: boolean;
  isSendingEmailDryRun: boolean;
  isSendingEmailSmtp: boolean;
  isSendingEmailSmtpTest: boolean;
  isPdfAvailable: boolean;
  isReopening: boolean;
  isUpdatingPayment: boolean;
  markSentErrorMessage: string | null;
  email: ApprovedInvoiceEmailPreviewData | null;
  emailErrorMessage: string | null;
  emailSendErrorMessage: string | null;
  emailSendSuccessMessage: string | null;
  emailSmtpTestErrorMessage: string | null;
  emailSmtpTestRecipient: string | null;
  emailSmtpTestUnavailableMessage: string | null;
  emailSmtpTestSuccessMessage: string | null;
  emailSmtpErrorMessage: string | null;
  emailSmtpSuccessMessage: string | null;
  emailSmtpUnavailableMessage: string | null;
  deliveryEvents: InvoiceDeliveryEventSummary[];
  deliveryEventsErrorMessage: string | null;
  isLoadingDeliveryEvents: boolean;
  pdfErrorMessage: string | null;
  paymentMutationErrorMessage: string | null;
  paymentMutationSuccessMessage: string | null;
  reopenErrorMessage: string | null;
  onBack(): void;
  onCancelInvoice(id: string, input: CancelApprovedInvoiceInput): void;
  onCopyInvoice(id: string): void;
  onCreateCreditDraft(id: string): void;
  onCreatePdf(id: string): void;
  onEditInvoice(id: string): void;
  onMarkSent(id: string): void;
  onMarkInvoicePaid(id: string, paidOn: string): void;
  onOpenPdf(id: string): void;
  onOpenRelatedDraft(id: string): void;
  onOpenRelatedInvoice(id: string): void;
  onPrepareEmail(id: string): void;
  onRevertInvoicePaidMark(id: string): void;
  onSendEmailDryRun(
    id: string,
    input: ApprovedInvoiceEmailDryRunSendInput,
  ): void;
  onSendEmailSmtp(
    id: string,
    input: ApprovedInvoiceEmailSmtpPrepareInput,
  ): void;
  onSendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): void;
}

export function ApprovedInvoicePreview({
  cancellationErrorMessage,
  copyErrorMessage,
  creditContext,
  creditContextErrorMessage,
  invoice,
  isCancellingInvoice,
  isCopyingInvoice,
  isCreatingPdf,
  isLoadingCreditContext,
  isMarkingSent,
  isPreparingEmail,
  isSendingEmailDryRun,
  isSendingEmailSmtp,
  isSendingEmailSmtpTest,
  isPdfAvailable,
  isReopening,
  isUpdatingPayment,
  markSentErrorMessage,
  email,
  emailErrorMessage,
  emailSendErrorMessage,
  emailSendSuccessMessage,
  emailSmtpTestErrorMessage,
  emailSmtpTestRecipient,
  emailSmtpTestUnavailableMessage,
  emailSmtpTestSuccessMessage,
  emailSmtpErrorMessage,
  emailSmtpSuccessMessage,
  emailSmtpUnavailableMessage,
  deliveryEvents,
  deliveryEventsErrorMessage,
  isLoadingDeliveryEvents,
  pdfErrorMessage,
  paymentMutationErrorMessage,
  paymentMutationSuccessMessage,
  reopenErrorMessage,
  onBack,
  onCancelInvoice,
  onCopyInvoice,
  onCreateCreditDraft,
  onCreatePdf,
  onEditInvoice,
  onMarkSent,
  onMarkInvoicePaid,
  onOpenPdf,
  onOpenRelatedDraft,
  onOpenRelatedInvoice,
  onPrepareEmail,
  onRevertInvoicePaidMark,
  onSendEmailDryRun,
  onSendEmailSmtp,
  onSendEmailSmtpTest,
}: ApprovedInvoicePreviewProps): React.JSX.Element {
  const isSent = invoice.status === 'sent';
  const isCancelled = invoice.status === 'cancelled';

  return (
    <section className={`panel ${styles.preview}`}>
      <ApprovedInvoiceActions
        canCreateCreditDraft={
          invoice.invoiceKind === 'standard' &&
          invoice.status === 'sent' &&
          creditContext !== null &&
          creditContext.remainingCreditableGrossCents > 0 &&
          creditContext.activeCreditDraftId === null
        }
        cancellationErrorMessage={cancellationErrorMessage}
        copyErrorMessage={copyErrorMessage}
        emailErrorMessage={emailErrorMessage}
        invoiceId={invoice.id}
        invoiceKind={invoice.invoiceKind}
        invoiceNumber={invoice.invoiceNumber}
        invoiceStatus={invoice.status}
        isCancellingInvoice={isCancellingInvoice}
        isCopyingInvoice={isCopyingInvoice}
        isCreatingPdf={isCreatingPdf}
        isMarkingSent={isMarkingSent}
        isPdfAvailable={isPdfAvailable}
        isPreparingEmail={isPreparingEmail}
        isReopening={isReopening}
        markSentErrorMessage={markSentErrorMessage}
        pdfErrorMessage={pdfErrorMessage}
        reopenErrorMessage={reopenErrorMessage}
        onBack={onBack}
        onCancelInvoice={onCancelInvoice}
        onCopyInvoice={onCopyInvoice}
        onCreateCreditDraft={onCreateCreditDraft}
        onCreatePdf={onCreatePdf}
        onEditInvoice={onEditInvoice}
        onMarkSent={onMarkSent}
        onOpenPdf={onOpenPdf}
        onPrepareEmail={onPrepareEmail}
      />

      <InvoiceCreditRelations
        context={creditContext}
        errorMessage={creditContextErrorMessage}
        invoice={invoice}
        isLoading={isLoadingCreditContext}
        onOpenDraft={onOpenRelatedDraft}
        onOpenInvoice={onOpenRelatedInvoice}
      />

      <InvoicePaymentPanel
        creditContext={creditContext}
        creditContextErrorMessage={creditContextErrorMessage}
        invoice={invoice}
        isLoadingCreditContext={isLoadingCreditContext}
        isUpdating={isUpdatingPayment}
        mutationErrorMessage={paymentMutationErrorMessage}
        mutationSuccessMessage={paymentMutationSuccessMessage}
        onMarkPaid={onMarkInvoicePaid}
        onRevertPaidMark={onRevertInvoicePaidMark}
      />

      {!isCancelled && email !== null ? (
        <ApprovedInvoiceEmailPreview
          email={email}
          errorMessage={emailSendErrorMessage}
          isSending={isSendingEmailDryRun}
          isSendingSmtp={isSendingEmailSmtp}
          isSendingSmtpTest={isSendingEmailSmtpTest}
          isResend={isSent}
          smtpErrorMessage={emailSmtpErrorMessage}
          smtpSuccessMessage={emailSmtpSuccessMessage}
          smtpUnavailableMessage={emailSmtpUnavailableMessage}
          smtpTestErrorMessage={emailSmtpTestErrorMessage}
          smtpTestRecipient={emailSmtpTestRecipient}
          smtpTestUnavailableMessage={emailSmtpTestUnavailableMessage}
          smtpTestSuccessMessage={emailSmtpTestSuccessMessage}
          successMessage={emailSendSuccessMessage}
          onSendDryRun={(input) => onSendEmailDryRun(invoice.id, input)}
          onSendSmtp={(input) => onSendEmailSmtp(invoice.id, input)}
          onSendSmtpTest={(input) =>
            onSendEmailSmtpTest(invoice.id, input)
          }
        />
      ) : null}

      <InvoiceDeliveryHistory
        errorMessage={deliveryEventsErrorMessage}
        events={deliveryEvents}
        isLoading={isLoadingDeliveryEvents}
      />

      <div className={styles.detailsStack}>
        <ApprovedInvoicePartyDetails
          businessId={invoice.companyBusinessIdSnapshot}
          city={invoice.companyCitySnapshot}
          email={invoice.companyEmailSnapshot}
          name={invoice.companyNameSnapshot}
          phone={invoice.companyPhoneSnapshot}
          postalCode={invoice.companyPostalCodeSnapshot}
          streetAddress={invoice.companyStreetAddressSnapshot}
          title={uiText.invoicing.seller}
          vatNumber={invoice.companyVatNumberSnapshot}
          website={invoice.companyWebsiteSnapshot}
        />
        <ApprovedInvoiceFacts
          approvedAt={invoice.approvedAt}
          creditedInvoiceDate={invoice.creditedInvoiceDate}
          creditedInvoiceNumber={invoice.creditedInvoiceNumber}
          deliveryAddressText={invoice.deliveryAddressText}
          dueDate={invoice.dueDate}
          invoiceDate={invoice.invoiceDate}
          invoiceKind={invoice.invoiceKind}
          latePaymentInterestBasisPoints={
            invoice.latePaymentInterestBasisPoints
          }
          note={invoice.note}
          orderNumber={invoice.orderNumber}
          paymentTermDays={invoice.paymentTermDays}
          referenceNumber={invoice.referenceNumber}
          refundIbanSnapshot={invoice.refundIbanSnapshot}
          reminderPeriodDays={invoice.reminderPeriodDays}
          subject={invoice.subject}
          taxLegalBasisSnapshot={invoice.taxLegalBasisSnapshot}
          taxTreatment={invoice.taxTreatment}
          taxTreatmentLabelSnapshot={
            invoice.taxTreatmentLabelSnapshot
          }
          performancePeriod={invoice.performancePeriod}
        />
        <ApprovedInvoicePartyDetails
          businessId={invoice.customerBusinessIdSnapshot}
          city={invoice.customerCitySnapshot}
          customerNumber={invoice.customerNumberSnapshot}
          email={invoice.customerEmailSnapshot}
          name={invoice.customerNameSnapshot}
          phone={invoice.customerPhoneSnapshot}
          postalCode={invoice.customerPostalCodeSnapshot}
          streetAddress={invoice.customerStreetAddressSnapshot}
          title={uiText.invoicing.customer}
        />
        <ApprovedInvoicePartyDetails
          businessId={invoice.billingRecipientBusinessIdSnapshot}
          city={invoice.billingRecipientCitySnapshot}
          customerNumber={invoice.billingRecipientCustomerNumberSnapshot}
          email={invoice.billingRecipientEmailSnapshot}
          name={invoice.billingRecipientNameSnapshot}
          phone={invoice.billingRecipientPhoneSnapshot}
          postalCode={invoice.billingRecipientPostalCodeSnapshot}
          streetAddress={invoice.billingRecipientStreetAddressSnapshot}
          title={uiText.invoicing.invoiceRecipient}
        />
      </div>

      <ApprovedInvoiceLineTable
        invoiceKind={invoice.invoiceKind}
        lines={invoice.lines}
        priceInputMode={invoice.priceInputMode}
        taxTreatment={invoice.taxTreatment}
      />

      <ApprovedInvoiceTotals
        breakdown={invoice.vatBreakdown}
        invoiceKind={invoice.invoiceKind}
        totals={invoice.totals}
        taxTreatment={invoice.taxTreatment}
      />

      {invoice.invoiceKind === 'standard' ? (
        <ApprovedInvoicePaymentDetails
          bankName={invoice.companyBankNameSnapshot}
          bic={invoice.companyBicSnapshot}
          dueDate={invoice.dueDate}
          grossTotalCents={invoice.totals.grossTotalCents}
          iban={invoice.companyIbanSnapshot}
          referenceNumber={invoice.referenceNumber}
        />
      ) : null}
    </section>
  );
}
