import { formatInvoiceDraftDate } from '../drafts/invoiceDraftFormatting.js';
import type { NewInvoiceFormState } from '../form/newInvoiceFormState.js';
import styles from './InvoiceDraftAdditionalDetailsPreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDraftAdditionalDetailsPreviewProps {
  form: NewInvoiceFormState;
}

interface PreviewLine {
  label: string;
  value: string;
}

export function InvoiceDraftAdditionalDetailsPreview({
  form,
}: InvoiceDraftAdditionalDetailsPreviewProps): React.JSX.Element | null {
  const lines = createPreviewLines(form);

  if (lines.length === 0) {
    return null;
  }

  return (
    <dl
      aria-label={uiText.invoicing.invoiceAdditionalDetailsPreview}
      className={styles.details}
    >
      {lines.map((line) => (
        <div key={line.label}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function createPreviewLines(form: NewInvoiceFormState): PreviewLine[] {
  const lines: PreviewLine[] = [];

  if (form.performancePeriodType === 'singleDate') {
    addLine(
      lines,
      uiText.invoicing.performanceDate,
      formatInvoiceDraftDate(form.performanceDate),
    );
  } else if (form.performancePeriodType === 'dateRange') {
    const startDate = formatInvoiceDraftDate(form.performancePeriodStart);
    const endDate = formatInvoiceDraftDate(form.performancePeriodEnd);

    addLine(
      lines,
      uiText.invoicing.performancePeriodDateRange,
      startDate === '' || endDate === '' ? '' : `${startDate}–${endDate}`,
    );
  }

  addLine(
    lines,
    uiText.invoicing.deliveryAddressText,
    form.deliveryAddressText,
  );
  addLine(lines, uiText.invoicing.note, form.note);

  return lines;
}

function addLine(lines: PreviewLine[], label: string, value: string): void {
  const trimmedValue = value.trim();

  if (trimmedValue !== '') {
    lines.push({ label, value: trimmedValue });
  }
}
