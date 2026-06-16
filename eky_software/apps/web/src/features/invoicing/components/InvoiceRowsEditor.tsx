import { InvoiceRowEditor } from './InvoiceRowEditor.js';
import type {
  InvoiceDraftLineFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  InvoiceRowForm,
  InvoiceRowFormField,
} from '../form/invoiceRowFormState.js';
import styles from './InvoiceRowsEditor.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceRowsEditorProps {
  errorsByRowId: Record<string, InvoiceDraftLineFormErrors> | undefined;
  rows: InvoiceRowForm[];
  onAdd(): void;
  onChange<FieldName extends InvoiceRowFormField>(
    rowId: string,
    fieldName: FieldName,
    value: InvoiceRowForm[FieldName],
  ): void;
  onRemove(rowId: string): void;
}

export function InvoiceRowsEditor({
  errorsByRowId,
  rows,
  onAdd,
  onChange,
  onRemove,
}: InvoiceRowsEditorProps): React.JSX.Element {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h3>{uiText.invoicing.invoiceRows}</h3>
          <p>{uiText.invoicing.invoiceRowsHelp}</p>
        </div>
        <button className="ghost-button" type="button" onClick={onAdd}>
          {uiText.invoicing.addRow}
        </button>
      </header>

      <div className={styles.editor}>
        <div className={styles.head} aria-hidden="true">
          <span>{uiText.invoicing.row}</span>
          <span>{uiText.invoicing.rowDescription}</span>
          <span>{uiText.invoicing.rowQuantity}</span>
          <span>{uiText.invoicing.rowUnit}</span>
          <span>{uiText.invoicing.rowUnitPrice}</span>
          <span>{uiText.invoicing.rowVat}</span>
          <span>{uiText.invoicing.rowDiscountType}</span>
          <span>{uiText.invoicing.rowDiscountValue}</span>
          <span>{uiText.invoicing.rowActions}</span>
        </div>

        {rows.map((row, index) => (
          <InvoiceRowEditor
            key={row.id}
            canRemove={rows.length > 1}
            errors={errorsByRowId?.[row.id]}
            position={index + 1}
            row={row}
            onChange={onChange}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}
