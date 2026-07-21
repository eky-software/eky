import {
  formatApprovedInvoiceDate,
  formatApprovedInvoicePercent,
  hasApprovedInvoiceValue,
} from '../approved/approvedInvoiceFormatting.js';
import { ApprovedInvoiceDefinitionRow } from './ApprovedInvoiceDefinitionRow.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoiceFactsProps {
  approvedAt: string;
  deliveryAddressText: string;
  dueDate: string;
  invoiceDate: string;
  latePaymentInterestBasisPoints: number;
  note: string;
  orderNumber: string;
  paymentTermDays: number;
  referenceNumber: string;
  reminderPeriodDays: number;
  subject: string;
}

export function ApprovedInvoiceFacts({
  approvedAt,
  deliveryAddressText,
  dueDate,
  invoiceDate,
  latePaymentInterestBasisPoints,
  note,
  orderNumber,
  paymentTermDays,
  referenceNumber,
  reminderPeriodDays,
  subject,
}: ApprovedInvoiceFactsProps): React.JSX.Element {
  return (
    <section className={styles.box}>
      <h3>{uiText.invoicing.basicInformation}</h3>
      <dl className={styles.detailList}>
        <ApprovedInvoiceDefinitionRow
          label={uiText.invoicing.invoiceDate}
          value={formatApprovedInvoiceDate(invoiceDate)}
        />
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
