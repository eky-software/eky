import {
  formatApprovedInvoiceDate,
  formatApprovedInvoiceIban,
  formatApprovedInvoicePercent,
  hasApprovedInvoiceValue,
} from '../approved/approvedInvoiceFormatting.js';
import type {
  ApprovedInvoiceKind,
  InvoicePerformancePeriod,
  InvoiceTaxTreatment,
} from '@eky/api-client';
import { ApprovedInvoiceDefinitionRow } from './ApprovedInvoiceDefinitionRow.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceFactsProps {
  approvedAt: string;
  creditedInvoiceDate: string | null;
  creditedInvoiceNumber: string | null;
  deliveryAddressText: string;
  dueDate: string;
  invoiceDate: string;
  invoiceKind: ApprovedInvoiceKind;
  latePaymentInterestBasisPoints: number;
  note: string;
  orderNumber: string;
  paymentTermDays: number;
  referenceNumber: string;
  refundIbanSnapshot: string;
  reminderPeriodDays: number;
  subject: string;
  taxLegalBasisSnapshot: string;
  taxTreatment: InvoiceTaxTreatment;
  taxTreatmentLabelSnapshot: string;
  performancePeriod: InvoicePerformancePeriod;
}

export function ApprovedInvoiceFacts({
  approvedAt,
  creditedInvoiceDate,
  creditedInvoiceNumber,
  deliveryAddressText,
  dueDate,
  invoiceDate,
  invoiceKind,
  latePaymentInterestBasisPoints,
  note,
  orderNumber,
  paymentTermDays,
  referenceNumber,
  refundIbanSnapshot,
  reminderPeriodDays,
  subject,
  taxLegalBasisSnapshot,
  taxTreatment,
  taxTreatmentLabelSnapshot,
  performancePeriod,
}: ApprovedInvoiceFactsProps): React.JSX.Element {
  const isCreditInvoice = invoiceKind === 'credit';

  return (
    <section className={styles.box}>
      <h3>{uiText.invoicing.basicInformation}</h3>
      <dl className={styles.detailList}>
        <ApprovedInvoiceDefinitionRow
          label={uiText.invoicing.invoiceDate}
          value={formatApprovedInvoiceDate(invoiceDate)}
        />
        {taxTreatment === 'reverseChargeConstruction' ? (
          <>
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.taxTreatment}
              value={taxTreatmentLabelSnapshot}
            />
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.taxLegalBasis}
              value={taxLegalBasisSnapshot}
            />
          </>
        ) : null}
        {performancePeriod.type === 'singleDate' ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.performanceDate}
            value={formatApprovedInvoiceDate(performancePeriod.date)}
          />
        ) : null}
        {performancePeriod.type === 'dateRange' ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.performancePeriodDateRange}
            value={`${formatApprovedInvoiceDate(
              performancePeriod.startDate,
            )}–${formatApprovedInvoiceDate(performancePeriod.endDate)}`}
          />
        ) : null}
        {isCreditInvoice && creditedInvoiceNumber !== null ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.creditedInvoiceNumber}
            value={creditedInvoiceNumber}
          />
        ) : null}
        {isCreditInvoice && creditedInvoiceDate !== null ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.creditedInvoiceDate}
            value={formatApprovedInvoiceDate(creditedInvoiceDate)}
          />
        ) : null}
        {isCreditInvoice && hasApprovedInvoiceValue(refundIbanSnapshot) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.creditDraftRefundIban}
            value={formatApprovedInvoiceIban(refundIbanSnapshot)}
          />
        ) : null}
        {!isCreditInvoice ? (
          <>
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.dueDate}
              value={formatApprovedInvoiceDate(dueDate)}
            />
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.paymentTermDays}
              value={`${paymentTermDays}`}
            />
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.reminderPeriodDays}
              value={`${reminderPeriodDays}`}
            />
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.latePaymentInterest}
              value={formatApprovedInvoicePercent(
                latePaymentInterestBasisPoints,
              )}
            />
            <ApprovedInvoiceDefinitionRow
              label={uiText.invoicing.referenceNumber}
              value={referenceNumber}
            />
          </>
        ) : null}
        <ApprovedInvoiceDefinitionRow
          label={uiText.invoicing.approvedAt}
          value={formatApprovedInvoiceDate(approvedAt.slice(0, 10))}
        />
        {hasApprovedInvoiceValue(orderNumber) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.orderNumber}
            value={orderNumber}
          />
        ) : null}
        {hasApprovedInvoiceValue(deliveryAddressText) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.deliveryAddressText}
            value={deliveryAddressText}
          />
        ) : null}
        {hasApprovedInvoiceValue(subject) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.subject}
            value={subject}
          />
        ) : null}
        {hasApprovedInvoiceValue(note) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.note}
            value={note}
          />
        ) : null}
      </dl>
    </section>
  );
}
