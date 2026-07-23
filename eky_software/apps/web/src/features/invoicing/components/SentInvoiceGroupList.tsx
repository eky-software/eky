import type { SentInvoiceGroup } from '@eky/api-client';

import {
  formatApprovedInvoiceDate,
  formatApprovedInvoicePresentedCurrency,
} from '../approved/approvedInvoiceFormatting.js';
import tableStyles from './InvoiceDraftList.module.css';
import styles from './SentInvoiceGroupList.module.css';
import { uiText } from '../../../i18n/fi.js';

interface SentInvoiceGroupListProps {
  groups: SentInvoiceGroup[];
  listLabel: string;
  onOpenApprovedInvoice(id: string): void;
}

export function SentInvoiceGroupList({
  groups,
  listLabel,
  onOpenApprovedInvoice,
}: SentInvoiceGroupListProps): React.JSX.Element {
  return (
    <div
      aria-label={listLabel}
      className={`${tableStyles.table} ${tableStyles.invoiceStatusTable}`}
      role="table"
    >
      <div className={`${tableStyles.row} ${tableStyles.head}`} role="row">
        <span role="columnheader">{uiText.invoicing.invoice}</span>
        <span role="columnheader">{uiText.invoicing.customer}</span>
        <span role="columnheader">{uiText.invoicing.invoiceDate}</span>
        <span role="columnheader">{uiText.invoicing.dueDate}</span>
        <span className={tableStyles.totalHeader} role="columnheader">
          {uiText.invoicing.total}
        </span>
        <span role="columnheader">{uiText.invoicing.status}</span>
      </div>

      {groups.flatMap((group) => [
        <div className={tableStyles.row} key={group.rootInvoice.id} role="row">
          <div className={tableStyles.mainCell} role="cell">
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
                  formatApprovedInvoicePresentedCurrency(
                    group.remainingCreditableGrossCents,
                    'standard',
                  ),
                )}
              </span>
            ) : null}
          </div>
          <span role="cell">{formatCustomer(group.rootInvoice)}</span>
          <time dateTime={group.rootInvoice.invoiceDate} role="cell">
            {formatApprovedInvoiceDate(group.rootInvoice.invoiceDate)}
          </time>
          <time dateTime={group.rootInvoice.dueDate} role="cell">
            {formatApprovedInvoiceDate(group.rootInvoice.dueDate)}
          </time>
          <strong className={tableStyles.total} role="cell">
            {formatApprovedInvoicePresentedCurrency(
              group.rootInvoice.grossTotalCents,
              'standard',
            )}
          </strong>
          <span className="status-pill status-pill-active" role="cell">
            {group.creditStatus === 'full'
              ? uiText.invoicing.statusCredited
              : uiText.invoicing.statusSent}
          </span>
        </div>,
        ...group.creditInvoices.map((creditInvoice) => (
          <div
            className={`${tableStyles.row} ${styles.creditRow}`}
            key={creditInvoice.id}
            role="row"
          >
            <div className={tableStyles.mainCell} role="cell">
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
            <span role="cell">{formatCustomer(creditInvoice)}</span>
            <time dateTime={creditInvoice.invoiceDate} role="cell">
              {formatApprovedInvoiceDate(creditInvoice.invoiceDate)}
            </time>
            <span role="cell">–</span>
            <strong className={tableStyles.total} role="cell">
              {formatApprovedInvoicePresentedCurrency(
                creditInvoice.grossTotalCents,
                'credit',
              )}
            </strong>
            <span className="status-pill status-pill-active" role="cell">
              {uiText.invoicing.statusSent}
            </span>
          </div>
        )),
      ])}
    </div>
  );
}

function formatCustomer(
  invoice: SentInvoiceGroup['rootInvoice'],
): string {
  return `${invoice.customerNumberSnapshot} – ${invoice.customerNameSnapshot}`;
}
