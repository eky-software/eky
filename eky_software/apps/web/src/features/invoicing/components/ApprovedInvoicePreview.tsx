import type {
  ApprovedInvoiceEmailDryRunSendInput,
  ApprovedInvoiceEmailPreview as ApprovedInvoiceEmailPreviewData,
  ApprovedInvoiceEmailSmtpTestPrepareInput,
  ApprovedInvoiceLine,
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
} from '@eky/api-client';

import { ApprovedInvoiceEmailPreview } from './ApprovedInvoiceEmailPreview.js';
import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
  formatApprovedInvoiceDiscount,
  formatApprovedInvoiceIban,
  formatApprovedInvoicePercent,
  formatApprovedInvoiceQuantity,
  formatApprovedInvoiceUnit,
  hasApprovedInvoiceValue,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoicePreviewProps {
  copyErrorMessage: string | null;
  invoice: ApprovedInvoiceView;
  isCopyingInvoice: boolean;
  isCreatingPdf: boolean;
  isMarkingSent: boolean;
  isPreparingEmail: boolean;
  isSendingEmailDryRun: boolean;
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
  pdfErrorMessage: string | null;
  reopenErrorMessage: string | null;
  onBack(): void;
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
  onSendEmailSmtpTest(
    id: string,
    input: ApprovedInvoiceEmailSmtpTestPrepareInput,
  ): void;
}

export function ApprovedInvoicePreview({
  copyErrorMessage,
  invoice,
  isCopyingInvoice,
  isCreatingPdf,
  isMarkingSent,
  isPreparingEmail,
  isSendingEmailDryRun,
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
  pdfErrorMessage,
  reopenErrorMessage,
  onBack,
  onCopyInvoice,
  onCreatePdf,
  onEditInvoice,
  onMarkSent,
  onOpenPdf,
  onPrepareEmail,
  onSendEmailDryRun,
  onSendEmailSmtpTest,
}: ApprovedInvoicePreviewProps): React.JSX.Element {
  const isSent = invoice.status === 'sent';

  return (
    <section className={`panel ${styles.preview}`}>
      <header className={styles.header}>
        <div>
          <p className="panel-kicker">{uiText.invoicing.approvedInvoiceKicker}</p>
          <h2>
            {uiText.invoicing.invoice} {invoice.invoiceNumber}
          </h2>
          <p className={styles.muted}>
            {uiText.invoicing.approvedInvoicePreviewHelp}
          </p>
          <p className={styles.status}>
            <span className="status-pill status-pill-active">
              {isSent
                ? uiText.invoicing.statusSent
                : uiText.invoicing.statusApproved}
            </span>
          </p>
        </div>
        <div className={styles.headerActions}>
          {!isPdfAvailable ? (
            <button
              className="secondary-action"
              disabled={isCreatingPdf}
              onClick={() => onCreatePdf(invoice.id)}
              type="button"
            >
              {isCreatingPdf
                ? uiText.invoicing.approvedInvoicePdfCreating
                : uiText.invoicing.approvedInvoicePdfCreate}
            </button>
          ) : null}
          {isPdfAvailable ? (
            <button
              className={`secondary-action ${styles.actionLink}`}
              disabled={isCreatingPdf}
              onClick={() => onOpenPdf(invoice.id)}
              type="button"
            >
              {isCreatingPdf
                ? uiText.invoicing.approvedInvoicePdfCreating
                : uiText.invoicing.approvedInvoiceOpenPdf}
            </button>
          ) : null}
          <button
            className="secondary-action"
            disabled={isCreatingPdf || isPreparingEmail}
            onClick={() => onPrepareEmail(invoice.id)}
            type="button"
          >
            {isPreparingEmail
              ? uiText.invoicing.invoiceEmailPreparing
              : uiText.invoicing.invoiceEmailPrepare}
          </button>
          {isSent ? (
            <button
              className="secondary-action"
              disabled={isCopyingInvoice}
              onClick={() => onCopyInvoice(invoice.id)}
              type="button"
            >
              {isCopyingInvoice
                ? uiText.invoicing.copiedApprovedInvoice
                : uiText.invoicing.copyApprovedInvoice}
            </button>
          ) : null}
          {!isSent ? (
            <>
              <button
                className="secondary-action"
                disabled={isCreatingPdf || isMarkingSent}
                onClick={() => onMarkSent(invoice.id)}
                type="button"
              >
                {isCreatingPdf
                  ? uiText.invoicing.approvedInvoicePdfCreating
                  : isMarkingSent
                    ? uiText.invoicing.markingApprovedInvoiceSent
                    : uiText.invoicing.markApprovedInvoiceSent}
              </button>
              <button
                className="secondary-action"
                disabled={isReopening}
                onClick={() => onEditInvoice(invoice.id)}
                type="button"
              >
                {isReopening
                  ? uiText.invoicing.reopeningApprovedInvoice
                  : uiText.invoicing.editApprovedInvoice}
              </button>
            </>
          ) : null}
          <button className="ghost-button" onClick={onBack} type="button">
            {uiText.invoicing.backToDrafts}
          </button>
        </div>
      </header>

      {reopenErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {reopenErrorMessage}
        </p>
      ) : null}
      {pdfErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {pdfErrorMessage}
        </p>
      ) : null}
      {markSentErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {markSentErrorMessage}
        </p>
      ) : null}
      {copyErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {copyErrorMessage}
        </p>
      ) : null}
      {emailErrorMessage !== null ? (
        <p className="message error-message" role="alert">
          {emailErrorMessage}
        </p>
      ) : null}

      {email !== null ? (
        <ApprovedInvoiceEmailPreview
          email={email}
          errorMessage={emailSendErrorMessage}
          isSending={isSendingEmailDryRun}
          isSendingSmtpTest={isSendingEmailSmtpTest}
          smtpTestErrorMessage={emailSmtpTestErrorMessage}
          smtpTestRecipient={emailSmtpTestRecipient}
          smtpTestUnavailableMessage={emailSmtpTestUnavailableMessage}
          smtpTestSuccessMessage={emailSmtpTestSuccessMessage}
          successMessage={emailSendSuccessMessage}
          onSendDryRun={(input) => onSendEmailDryRun(invoice.id, input)}
          onSendSmtpTest={(input) =>
            onSendEmailSmtpTest(invoice.id, input)
          }
        />
      ) : null}

      <div className={styles.detailsStack}>
        <PartyBox
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
        <InvoiceFacts invoice={invoice} />
        <PartyBox
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
        <PartyBox
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

      <InvoiceLineTable
        lines={invoice.lines}
        priceInputMode={invoice.priceInputMode}
      />

      <div className={styles.totalsGrid}>
        <VatBreakdown breakdown={invoice.vatBreakdown} />
        <Totals invoice={invoice} />
      </div>

      <PaymentDetails invoice={invoice} />
    </section>
  );
}

interface PartyBoxProps {
  businessId: string;
  city: string;
  customerNumber?: string;
  email: string;
  name: string;
  phone: string;
  postalCode: string;
  streetAddress: string;
  title: string;
  vatNumber?: string;
  website?: string;
}

function PartyBox({
  businessId,
  city,
  customerNumber,
  email,
  name,
  phone,
  postalCode,
  streetAddress,
  title,
  vatNumber,
  website,
}: PartyBoxProps): React.JSX.Element {
  return (
    <section className={styles.box}>
      <h3>{title}</h3>
      <dl className={styles.detailList}>
        <DefinitionRow label={uiText.customers.name} value={name} />
        {hasApprovedInvoiceValue(customerNumber ?? '') ? (
          <DefinitionRow
            label={uiText.customers.customerNumber}
            value={customerNumber ?? ''}
          />
        ) : null}
        {hasApprovedInvoiceValue(businessId) ? (
          <DefinitionRow
            label={uiText.customers.businessId}
            value={businessId}
          />
        ) : null}
        {hasApprovedInvoiceValue(vatNumber ?? '') ? (
          <DefinitionRow
            label={uiText.companySettings.vatNumber}
            value={vatNumber ?? ''}
          />
        ) : null}
        {hasApprovedInvoiceValue(streetAddress) ? (
          <DefinitionRow
            label={uiText.companySettings.streetAddress}
            value={streetAddress}
          />
        ) : null}
        {hasApprovedInvoiceValue(postalCode) ||
        hasApprovedInvoiceValue(city) ? (
          <DefinitionRow
            label={uiText.invoicing.postalCodeAndCity}
            value={[postalCode, city].filter(hasApprovedInvoiceValue).join(' ')}
          />
        ) : null}
        {hasApprovedInvoiceValue(email) ? (
          <DefinitionRow label={uiText.companySettings.email} value={email} />
        ) : null}
        {hasApprovedInvoiceValue(phone) ? (
          <DefinitionRow label={uiText.companySettings.phone} value={phone} />
        ) : null}
        {hasApprovedInvoiceValue(website ?? '') ? (
          <DefinitionRow
            label={uiText.companySettings.website}
            value={website ?? ''}
          />
        ) : null}
      </dl>
    </section>
  );
}

function InvoiceFacts({
  invoice,
}: {
  invoice: ApprovedInvoiceView;
}): React.JSX.Element {
  return (
    <section className={styles.box}>
      <h3>{uiText.invoicing.basicInformation}</h3>
      <dl className={styles.detailList}>
        <DefinitionRow
          label={uiText.invoicing.invoiceDate}
          value={formatApprovedInvoiceDate(invoice.invoiceDate)}
        />
        <DefinitionRow
          label={uiText.invoicing.dueDate}
          value={formatApprovedInvoiceDate(invoice.dueDate)}
        />
        <DefinitionRow
          label={uiText.invoicing.paymentTermDays}
          value={`${invoice.paymentTermDays}`}
        />
        <DefinitionRow
          label={uiText.invoicing.reminderPeriodDays}
          value={`${invoice.reminderPeriodDays}`}
        />
        <DefinitionRow
          label={uiText.invoicing.latePaymentInterest}
          value={formatApprovedInvoicePercent(
            invoice.latePaymentInterestBasisPoints,
          )}
        />
        <DefinitionRow
          label={uiText.invoicing.referenceNumber}
          value={invoice.referenceNumber}
        />
        <DefinitionRow
          label={uiText.invoicing.approvedAt}
          value={formatApprovedInvoiceDate(invoice.approvedAt.slice(0, 10))}
        />
        {hasApprovedInvoiceValue(invoice.orderNumber) ? (
          <DefinitionRow
            label={uiText.invoicing.orderNumber}
            value={invoice.orderNumber}
          />
        ) : null}
        {hasApprovedInvoiceValue(invoice.deliveryAddressText) ? (
          <DefinitionRow
            label={uiText.invoicing.deliveryAddressText}
            value={invoice.deliveryAddressText}
          />
        ) : null}
        {hasApprovedInvoiceValue(invoice.subject) ? (
          <DefinitionRow label={uiText.invoicing.subject} value={invoice.subject} />
        ) : null}
        {hasApprovedInvoiceValue(invoice.note) ? (
          <DefinitionRow label={uiText.invoicing.note} value={invoice.note} />
        ) : null}
      </dl>
    </section>
  );
}

function DefinitionRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}

function InvoiceLineTable({
  lines,
  priceInputMode,
}: {
  lines: ApprovedInvoiceLine[];
  priceInputMode: ApprovedInvoiceView['priceInputMode'];
}): React.JSX.Element {
  const unitPriceLabel =
    priceInputMode === 'net'
      ? uiText.invoicing.priceInputNet
      : uiText.invoicing.priceInputGross;

  return (
    <section>
      <h3>{uiText.invoicing.invoiceRows}</h3>
      <div className={styles.lines} role="table">
        <div className={styles.lineHeader} role="row">
          <span role="columnheader">{uiText.invoicing.rowCode}</span>
          <span role="columnheader">{uiText.invoicing.rowDescription}</span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowQuantity}
          </span>
          <span role="columnheader">{uiText.invoicing.rowUnit}</span>
          <span className={styles.number} role="columnheader">
            {unitPriceLabel}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowVat}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.rowDiscountType}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.total}
          </span>
        </div>
        {lines.map((line) => (
          <InvoiceLineRow
            key={line.id}
            line={line}
            priceInputMode={priceInputMode}
          />
        ))}
      </div>
    </section>
  );
}

function InvoiceLineRow({
  line,
  priceInputMode,
}: {
  line: ApprovedInvoiceLine;
  priceInputMode: ApprovedInvoiceView['priceInputMode'];
}): React.JSX.Element {
  const discount = formatApprovedInvoiceDiscount(line.discount);
  const lineTotal =
    priceInputMode === 'net' ? line.netCents : line.grossCents;

  return (
    <div className={styles.lineRow} role="row">
      <span role="cell">{line.code}</span>
      <span role="cell">{line.description}</span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceQuantity(line.quantityHundredths)}
      </span>
      <span role="cell">{formatApprovedInvoiceUnit(line.unit)}</span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceCurrency(line.unitPriceCents)}
      </span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoicePercent(line.vatRateBasisPoints)}
      </span>
      <span className={styles.number} role="cell">
        {discount ?? ''}
      </span>
      <span className={styles.number} role="cell">
        {formatApprovedInvoiceCurrency(lineTotal)}
      </span>
    </div>
  );
}

function VatBreakdown({
  breakdown,
}: {
  breakdown: ApprovedInvoiceVatBreakdown[];
}): React.JSX.Element {
  return (
    <section className={styles.box}>
      <h3>{uiText.invoicing.vatBreakdown}</h3>
      <div className={styles.vatTable} role="table">
        <div className={styles.vatHeader} role="row">
          <span role="columnheader">{uiText.invoicing.rowVat}</span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.netAmount}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.vatAmount}
          </span>
          <span className={styles.number} role="columnheader">
            {uiText.invoicing.grossTotal}
          </span>
        </div>
        {breakdown.map((item) => (
          <div className={styles.vatRow} key={item.vatRateBasisPoints} role="row">
            <span role="cell">
              {formatApprovedInvoicePercent(item.vatRateBasisPoints)}
            </span>
            <span className={styles.number} role="cell">
              {formatApprovedInvoiceCurrency(item.netCents)}
            </span>
            <span className={styles.number} role="cell">
              {formatApprovedInvoiceCurrency(item.vatCents)}
            </span>
            <strong className={styles.number} role="cell">
              {formatApprovedInvoiceCurrency(item.grossCents)}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function Totals({
  invoice,
}: {
  invoice: ApprovedInvoiceView;
}): React.JSX.Element {
  return (
    <section className={styles.box}>
      <h3>{uiText.invoicing.invoiceTotals}</h3>
      <div className={styles.totalsTable}>
        <div>
          <span>{uiText.invoicing.netTotal}</span>
          <span>{formatApprovedInvoiceCurrency(invoice.totals.netTotalCents)}</span>
        </div>
        <div>
          <span>{uiText.invoicing.vatTotal}</span>
          <span>{formatApprovedInvoiceCurrency(invoice.totals.vatTotalCents)}</span>
        </div>
        <div className={styles.grandTotal}>
          <span>{uiText.invoicing.total}</span>
          <span>{formatApprovedInvoiceCurrency(invoice.totals.grossTotalCents)}</span>
        </div>
      </div>
    </section>
  );
}

function PaymentDetails({
  invoice,
}: {
  invoice: ApprovedInvoiceView;
}): React.JSX.Element {
  return (
    <section className={`${styles.box} ${styles.payment}`}>
      <h3>{uiText.invoicing.paymentDetails}</h3>
      <dl className={styles.detailList}>
        {hasApprovedInvoiceValue(invoice.companyBankNameSnapshot) ? (
          <DefinitionRow
            label={uiText.companySettings.bankName}
            value={invoice.companyBankNameSnapshot}
          />
        ) : null}
        {hasApprovedInvoiceValue(invoice.companyIbanSnapshot) ? (
          <DefinitionRow
            label={uiText.companySettings.iban}
            value={formatApprovedInvoiceIban(invoice.companyIbanSnapshot)}
          />
        ) : null}
        {hasApprovedInvoiceValue(invoice.companyBicSnapshot) ? (
          <DefinitionRow
            label={uiText.companySettings.bic}
            value={invoice.companyBicSnapshot}
          />
        ) : null}
        <DefinitionRow
          label={uiText.invoicing.referenceNumber}
          value={invoice.referenceNumber}
        />
        <DefinitionRow
          label={uiText.invoicing.dueDate}
          value={formatApprovedInvoiceDate(invoice.dueDate)}
        />
        <DefinitionRow
          label={uiText.invoicing.total}
          value={formatApprovedInvoiceCurrency(invoice.totals.grossTotalCents)}
        />
      </dl>
    </section>
  );
}
