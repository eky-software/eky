import type {
  InvoiceDraftFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  NewInvoiceBasicInfoField,
  NewInvoiceFormState,
} from '../form/newInvoiceFormState.js';
import styles from './InvoicePerformancePeriodSection.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoicePerformancePeriodSectionProps {
  errors: InvoiceDraftFormErrors | undefined;
  form: NewInvoiceFormState;
  onFieldChange<FieldName extends NewInvoiceBasicInfoField>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void;
}

export function InvoicePerformancePeriodSection({
  errors,
  form,
  onFieldChange,
}: InvoicePerformancePeriodSectionProps): React.JSX.Element {
  return (
    <div className={styles.section}>
      <label className={styles.field}>
        <span>{uiText.invoicing.performancePeriod}</span>
        <select
          name="performancePeriodType"
          value={form.performancePeriodType}
          onChange={(event) =>
            onFieldChange(
              'performancePeriodType',
              event.currentTarget.value as NewInvoiceFormState['performancePeriodType'],
            )
          }
        >
          <option value="invoiceDate">
            {uiText.invoicing.performancePeriodInvoiceDate}
          </option>
          <option value="singleDate">
            {uiText.invoicing.performancePeriodSingleDate}
          </option>
          <option value="dateRange">
            {uiText.invoicing.performancePeriodDateRange}
          </option>
        </select>
      </label>

      {form.performancePeriodType === 'singleDate' ? (
        <PerformanceDateField
          errorMessage={errors?.performanceDate}
          label={uiText.invoicing.performanceDate}
          name="performanceDate"
          value={form.performanceDate}
          onChange={(value) => onFieldChange('performanceDate', value)}
        />
      ) : null}

      {form.performancePeriodType === 'dateRange' ? (
        <>
          <PerformanceDateField
            errorMessage={errors?.performancePeriodStart}
            label={uiText.invoicing.performancePeriodStart}
            name="performancePeriodStart"
            value={form.performancePeriodStart}
            onChange={(value) =>
              onFieldChange('performancePeriodStart', value)
            }
          />
          <PerformanceDateField
            errorMessage={errors?.performancePeriodEnd}
            label={uiText.invoicing.performancePeriodEnd}
            name="performancePeriodEnd"
            value={form.performancePeriodEnd}
            onChange={(value) =>
              onFieldChange('performancePeriodEnd', value)
            }
          />
        </>
      ) : null}
    </div>
  );
}

function PerformanceDateField({
  errorMessage,
  label,
  name,
  onChange,
  value,
}: {
  errorMessage: string | undefined;
  label: string;
  name:
    | 'performanceDate'
    | 'performancePeriodEnd'
    | 'performancePeriodStart';
  onChange(value: string): void;
  value: string;
}): React.JSX.Element {
  const errorId = `${name}-error`;

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        aria-describedby={errorMessage === undefined ? undefined : errorId}
        aria-invalid={errorMessage === undefined ? undefined : true}
        name={name}
        type="date"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {errorMessage !== undefined ? (
        <small className={styles.error} id={errorId} role="alert">
          {errorMessage}
        </small>
      ) : null}
    </label>
  );
}
