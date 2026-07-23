import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceEmailSmtpPrepareInput,
  ApprovedInvoiceView,
  CancelApprovedInvoiceInput,
  InvoiceDeliveryEventSummary,
} from '@eky/api-client';

import { ApprovedInvoiceActions } from './ApprovedInvoiceActions.js';
import { ApprovedInvoiceEmailPreview } from './ApprovedInvoiceEmailPreview.js';
import { ApprovedInvoiceFacts } from './ApprovedInvoiceFacts.js';
import { ApprovedInvoiceLineTable } from './ApprovedInvoiceLineTable.js';
import { ApprovedInvoicePartyDetails } from './ApprovedInvoicePartyDetails.js';
import { ApprovedInvoicePaymentDetails } from './ApprovedInvoicePaymentDetails.js';
import { ApprovedInvoiceTotals } from './ApprovedInvoiceTotals.js';
import { InvoiceDeliveryHistory } from './InvoiceDeliveryHistory.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoicePreviewProps {
  cancellationErrorMessage: string | null;
  copyErrorMessage: string | null;
  invoice: ApprovedInvoiceView;
  isCancellingInvoice: boolean;
  isCopyingInvoice: boolean;
  isCreatingPdf: boolean;
  isMarkingSent: boolean;
  isPreparingEmail: boolean;
  isSendingEmailDryRun: boolean;
  isSendingEmailSmtp: boolean;
  isSendingEmailSmtpTest: boolean;
  isPdfAvailable: boolean;
  isReopening: boolean;
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
  reopenErrorMessage: string | null;
  onBack(): void;
  onCancelInvoice(id: string, input: CancelApprovedInvoiceInput): void;
  onCopyInvoice(id: string): void;
  onCreatePdf(id: string): void;
  onEditInvoice(id: string): void;
  onMarkSent(id: string): void;
  onOpenPdf(id: string): void;
  onPrepareEmail(id: string): void;
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
  invoice,
  isCancellingInvoice,
  isCopyingInvoice,
  isCreatingPdf,
  isMarkingSent,
  isPreparingEmail,
  isSendingEmailDryRun,
  isSendingEmailSmtp,
  isSendingEmailSmtpTest,
  isPdfAvailable,
  isReopening,
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
  reopenErrorMessage,
  onBack,
  onCancelInvoice,
  onCopyInvoice,
  onCreatePdf,
  onEditInvoice,
  onMarkSent,
  onOpenPdf,
  onPrepareEmail,
  onSendEmailDryRun,
  onSendEmailSmtp,
  onSendEmailSmtpTest,
}: ApprovedInvoicePreviewProps): React.JSX.Element {
  const isSent = invoice.status === 'sent';

  return (
    <section className={`panel ${styles.preview}`}>
      <ApprovedInvoiceActions
        cancellationErrorMessage={cancellationErrorMessage}
        copyErrorMessage={copyErrorMessage}
        emailErrorMessage={emailErrorMessage}
        invoiceId={invoice.id}
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
        onCreatePdf={onCreatePdf}
        onEditInvoice={onEditInvoice}
        onMarkSent={onMarkSent}
        onOpenPdf={onOpenPdf}
        onPrepareEmail={onPrepareEmail}
      />

      {email !== null ? (
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
          deliveryAddressText={invoice.deliveryAddressText}
          dueDate={invoice.dueDate}
          invoiceDate={invoice.invoiceDate}
          latePaymentInterestBasisPoints={
            invoice.latePaymentInterestBasisPoints
          }
          note={invoice.note}
          orderNumber={invoice.orderNumber}
          paymentTermDays={invoice.paymentTermDays}
          referenceNumber={invoice.referenceNumber}
          reminderPeriodDays={invoice.reminderPeriodDays}
          subject={invoice.subject}
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
        lines={invoice.lines}
        priceInputMode={invoice.priceInputMode}
      />

      <ApprovedInvoiceTotals
        breakdown={invoice.vatBreakdown}
        totals={invoice.totals}
      />

      <ApprovedInvoicePaymentDetails
        bankName={invoice.companyBankNameSnapshot}
        bic={invoice.companyBicSnapshot}
        dueDate={invoice.dueDate}
        grossTotalCents={invoice.totals.grossTotalCents}
        iban={invoice.companyIbanSnapshot}
        referenceNumber={invoice.referenceNumber}
      />
    </section>
  );
}
