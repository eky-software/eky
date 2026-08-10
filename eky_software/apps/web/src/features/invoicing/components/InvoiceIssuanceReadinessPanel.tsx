import type { InvoiceIssuanceReadinessIssue } from '@eky/api-client';

import styles from './InvoiceApprovalPanel.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceIssuanceReadinessPanelProps {
  issues: InvoiceIssuanceReadinessIssue[];
}

export function InvoiceIssuanceReadinessPanel({
  issues,
}: InvoiceIssuanceReadinessPanelProps): React.JSX.Element {
  return (
    <section
      aria-labelledby="invoice-issuance-readiness-heading"
      className={`message error-message ${styles.panel}`}
      role="alert"
    >
      <div>
        <h3 id="invoice-issuance-readiness-heading">
          {uiText.invoicing.invoiceIssuanceReadinessTitle}
        </h3>
        <p>{uiText.invoicing.invoiceIssuanceReadinessIntro}</p>
        <ul className={styles.issueList}>
          {issues.map((issue) => (
            <li key={issue}>
              {uiText.invoicing.invoiceIssuanceReadinessIssue[issue]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
