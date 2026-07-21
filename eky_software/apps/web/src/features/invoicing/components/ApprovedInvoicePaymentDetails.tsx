import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
  formatApprovedInvoiceIban,
  hasApprovedInvoiceValue,
} from '../approved/approvedInvoiceFormatting.js';
import { ApprovedInvoiceDefinitionRow } from './ApprovedInvoicePartyDetails.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoicePaymentDetailsProps {
  bankName: string;
  bic: string;
  dueDate: string;
  grossTotalCents: number;
  iban: string;
  referenceNumber: string;
}

export function ApprovedInvoicePaymentDetails({
  bankName,
  bic,
  dueDate,
  grossTotalCents,
  iban,
  referenceNumber,
}: ApprovedInvoicePaymentDetailsProps): React.JSX.Element {
  return (
    <section className={`${styles.box} ${styles.payment}`}>
      <h3>{uiText.invoicing.paymentDetails}</h3>
      <dl className={styles.detailList}>
        {hasApprovedInvoiceValue(bankName) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.bankName}
            value={bankName}
          />
        ) : null}
        {hasApprovedInvoiceValue(iban) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.iban}
            value={formatApprovedInvoiceIban(iban)}
          />
        ) : null}
        {hasApprovedInvoiceValue(bic) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.bic}
            value={bic}
          />
        ) : null}
        <ApprovedInvoiceDefinitionRow
          label={uiText.invoicing.referenceNumber}
          value={referenceNumber}
        />
        <ApprovedInvoiceDefinitionRow
          label={uiText.invoicing.dueDate}
          value={formatApprovedInvoiceDate(dueDate)}
        />
        <ApprovedInvoiceDefinitionRow
          label={uiText.invoicing.total}
          value={formatApprovedInvoiceCurrency(grossTotalCents)}
        />
      </dl>
    </section>
  );
}
