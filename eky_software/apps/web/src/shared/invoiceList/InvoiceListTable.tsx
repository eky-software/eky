import type { ReactNode } from 'react';

import {
  formatInvoiceListCurrency,
  formatInvoiceListDate,
} from './invoiceListFormatting.js';
import styles from './InvoiceListTable.module.css';

export interface InvoiceListTableLabels {
  actions: string;
  creditRelation: string;
  customer: string;
  dueDate: string;
  invoice: string;
  invoiceDate: string;
  status: string;
  total: string;
}

export interface InvoiceListTableRow {
  action?: ReactNode;
  className?: string | undefined;
  creditRelation?: ReactNode;
  customer?: ReactNode;
  dueDate: string | null;
  invoiceDate: string;
  key: string;
  reference: ReactNode;
  status: ReactNode;
  statusDetail?: ReactNode;
  totalCents: number;
}

interface InvoiceListTableProps {
  ariaLabel: string;
  labels: InvoiceListTableLabels;
  rows: readonly InvoiceListTableRow[];
  showActions?: boolean;
  showCreditRelation?: boolean;
  showCustomer?: boolean;
}

export function InvoiceListTable({
  ariaLabel,
  labels,
  rows,
  showActions = false,
  showCreditRelation = false,
  showCustomer = false,
}: InvoiceListTableProps): React.JSX.Element {
  return (
    <div className={styles.frame}>
      <table aria-label={ariaLabel} className={styles.table}>
        <colgroup>
          <col className={styles.referenceColumn} />
          {showCustomer ? <col className={styles.customerColumn} /> : null}
          <col className={styles.dateColumn} />
          <col className={styles.dateColumn} />
          <col className={styles.totalColumn} />
          <col className={styles.statusColumn} />
          {showCreditRelation ? (
            <col className={styles.relationColumn} />
          ) : null}
          {showActions ? <col className={styles.actionColumn} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{labels.invoice}</th>
            {showCustomer ? <th scope="col">{labels.customer}</th> : null}
            <th scope="col">{labels.invoiceDate}</th>
            <th scope="col">{labels.dueDate}</th>
            <th className={styles.numeric} scope="col">
              {labels.total}
            </th>
            <th scope="col">{labels.status}</th>
            {showCreditRelation ? (
              <th scope="col">{labels.creditRelation}</th>
            ) : null}
            {showActions ? (
              <th aria-label={labels.actions} scope="col" />
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className={row.className} key={row.key}>
              <td className={styles.reference}>{row.reference}</td>
              {showCustomer ? <td>{row.customer}</td> : null}
              <td>
                <time dateTime={row.invoiceDate}>
                  {formatInvoiceListDate(row.invoiceDate)}
                </time>
              </td>
              <td>
                {row.dueDate === null ? (
                  '–'
                ) : (
                  <time dateTime={row.dueDate}>
                    {formatInvoiceListDate(row.dueDate)}
                  </time>
                )}
              </td>
              <td className={`${styles.numeric} ${styles.total}`}>
                {formatInvoiceListCurrency(row.totalCents)}
              </td>
              <td>
                <div className={styles.status}>
                  {row.status}
                  {row.statusDetail ? (
                    <span className={styles.statusDetail}>
                      {row.statusDetail}
                    </span>
                  ) : null}
                </div>
              </td>
              {showCreditRelation ? <td>{row.creditRelation || '–'}</td> : null}
              {showActions ? (
                <td className={styles.action}>{row.action}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
