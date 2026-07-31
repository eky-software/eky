import type { SentInvoiceGroup } from '@eky/api-client';

import tableStyles from './InvoiceDraftList.module.css';
import styles from './SentInvoiceGroupList.module.css';
import { uiText } from '../../../i18n/fi.js';
import {
  formatInvoiceListCurrency,
  InvoiceListTable,
  type InvoiceListTableLabels,
  type InvoiceListTableRow,
} from '../../../shared/invoiceList/index.js';

interface SentInvoiceGroupListProps {
  groups: SentInvoiceGroup[];
  listLabel: string;
  onOpenApprovedInvoice(id: string): void;
  showPaidOn?: boolean;
}

export function SentInvoiceGroupList({
  groups,
  listLabel,
  onOpenApprovedInvoice,
  showPaidOn = false,
}: SentInvoiceGroupListProps): React.JSX.Element {
  return (
    <InvoiceListTable
      ariaLabel={listLabel}
      labels={invoiceListLabels}
      rows={groups.flatMap((group): InvoiceListTableRow[] => [
        {
          customer: formatCustomer(group.rootInvoice),
          dueDate: group.rootInvoice.dueDate,
          invoiceDate: group.rootInvoice.invoiceDate,
          key: group.rootInvoice.id,
          paidOn: group.rootInvoice.paidOn,
          reference: (
            <div className={tableStyles.mainCell}>
              <button
                className={tableStyles.openButton}
                onClick={() => onOpenApprovedInvoice(group.rootInvoice.id)}
                type="button"
              >
                {uiText.invoicing.invoiceNumber}{' '}
                {group.rootInvoice.invoiceNumber}
              </button>
              {group.creditStatus !== 'none' ? (
                <span className={styles.remaining}>
                  {uiText.invoicing.remainingCreditableAmount(
                    formatInvoiceListCurrency(
                      group.remainingCreditableGrossCents,
                    ),
                  )}
                </span>
              ) : null}
            </div>
          ),
          status: (
            <span className="status-pill status-pill-active">
              {group.creditStatus === 'full'
                ? uiText.invoicing.statusCredited
                : group.creditStatus === 'partial'
                  ? uiText.invoicing.creditStatusPartial
                  : group.rootInvoice.paymentState === 'paid'
                    ? uiText.invoicing.statusPaid
                    : uiText.invoicing.statusSent}
            </span>
          ),
          totalCents: group.rootInvoice.grossTotalCents,
        },
        ...group.creditInvoices.map(
          (creditInvoice): InvoiceListTableRow => ({
            className: styles.creditRow,
            customer: formatCustomer(creditInvoice),
            dueDate: null,
            invoiceDate: creditInvoice.invoiceDate,
            key: creditInvoice.id,
            reference: (
              <div className={tableStyles.mainCell}>
                <button
                  className={`${tableStyles.openButton} ${styles.creditLink}`}
                  onClick={() => onOpenApprovedInvoice(creditInvoice.id)}
                  type="button"
                >
                  <span aria-hidden="true">↳ </span>
                  {uiText.invoicing.creditInvoice}{' '}
                  {creditInvoice.invoiceNumber}
                </button>
              </div>
            ),
            status: (
              <span className="status-pill status-pill-active">
                {uiText.invoicing.statusSent}
              </span>
            ),
            totalCents: -Math.abs(creditInvoice.grossTotalCents),
          }),
        ),
      ])}
      showCustomer
      showPaidOn={showPaidOn}
    />
  );
}

function formatCustomer(
  invoice: SentInvoiceGroup['rootInvoice'],
): string {
  return `${invoice.customerNumberSnapshot} – ${invoice.customerNameSnapshot}`;
}

const invoiceListLabels: InvoiceListTableLabels = {
  actions: uiText.customers.actions,
  creditRelation: uiText.customers.creditRelation,
  customer: uiText.invoicing.customer,
  dueDate: uiText.invoicing.dueDate,
  invoice: uiText.invoicing.invoice,
  invoiceDate: uiText.invoicing.invoiceDate,
  paidOn: uiText.invoicing.invoicePaymentDate,
  status: uiText.invoicing.status,
  total: uiText.invoicing.total,
};
