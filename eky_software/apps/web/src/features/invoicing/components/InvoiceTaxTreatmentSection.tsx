import type { Customer, InvoiceTaxTreatment } from '@eky/api-client';

import type {
  InvoiceDraftFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  NewInvoiceBasicInfoField,
  NewInvoiceFormState,
} from '../form/newInvoiceFormState.js';
import styles from './InvoiceTaxTreatmentSection.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceTaxTreatmentSectionProps {
  errors: InvoiceDraftFormErrors | undefined;
  form: NewInvoiceFormState;
  selectedCustomer: Customer | null;
  onFieldChange<FieldName extends NewInvoiceBasicInfoField>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void;
  onTaxTreatmentChange(taxTreatment: InvoiceTaxTreatment): void;
}

export function InvoiceTaxTreatmentSection({
  errors,
  form,
  selectedCustomer,
  onFieldChange,
  onTaxTreatmentChange,
}: InvoiceTaxTreatmentSectionProps): React.JSX.Element {
  const isReverseCharge =
    form.taxTreatment === 'reverseChargeConstruction';

  return (
    <details className={styles.section} open={isReverseCharge}>
      <summary>{uiText.invoicing.advancedInvoiceSettings}</summary>
      <div className={styles.content}>
        <label className={styles.field}>
          <span>{uiText.invoicing.taxTreatment}</span>
          <select
            name="taxTreatment"
            value={form.taxTreatment}
            onChange={(event) =>
              onTaxTreatmentChange(
                event.currentTarget.value as InvoiceTaxTreatment,
              )
            }
          >
            <option value="normalVat">
              {uiText.invoicing.taxTreatmentNormalVat}
            </option>
            <option value="reverseChargeConstruction">
              {uiText.invoicing.taxTreatmentReverseChargeConstruction}
            </option>
          </select>
        </label>

        {isReverseCharge ? (
          <div className={`message ${styles.warning}`} role="status">
            <strong>{uiText.invoicing.reverseChargeWarningTitle}</strong>
            <p>{uiText.invoicing.reverseChargeWarning}</p>
            <dl>
              <div>
                <dt>{uiText.invoicing.reverseChargeLegalCustomer}</dt>
                <dd>
                  {selectedCustomer?.name ||
                    uiText.invoicing.reverseChargeCustomerMissing}
                </dd>
              </div>
              <div>
                <dt>{uiText.invoicing.businessId}</dt>
                <dd>
                  {selectedCustomer?.businessId ||
                    uiText.invoicing.reverseChargeBusinessIdMissing}
                </dd>
              </div>
            </dl>
            {errors?.taxTreatment ? (
              <small className={styles.error} role="alert">
                {errors.taxTreatment}
              </small>
            ) : null}
          </div>
        ) : null}

        <fieldset className={styles.performance}>
          <legend>{uiText.invoicing.performancePeriod}</legend>
          <label>
            <input
              checked={form.performancePeriodType === 'invoiceDate'}
              name="performancePeriodType"
              type="radio"
              onChange={() =>
                onFieldChange('performancePeriodType', 'invoiceDate')
              }
            />
            <span>{uiText.invoicing.performancePeriodInvoiceDate}</span>
          </label>
          <label>
            <input
              checked={form.performancePeriodType === 'singleDate'}
              name="performancePeriodType"
              type="radio"
              onChange={() =>
                onFieldChange('performancePeriodType', 'singleDate')
              }
            />
            <span>{uiText.invoicing.performancePeriodSingleDate}</span>
          </label>
          <label>
            <input
              checked={form.performancePeriodType === 'dateRange'}
              name="performancePeriodType"
              type="radio"
              onChange={() =>
                onFieldChange('performancePeriodType', 'dateRange')
              }
            />
            <span>{uiText.invoicing.performancePeriodDateRange}</span>
          </label>
        </fieldset>

        {form.performancePeriodType === 'singleDate' ? (
          <label className={styles.field}>
            <span>{uiText.invoicing.performanceDate}</span>
            <input
              aria-invalid={
                errors?.performanceDate === undefined ? undefined : true
              }
              name="performanceDate"
              type="date"
              value={form.performanceDate}
              onChange={(event) =>
                onFieldChange('performanceDate', event.currentTarget.value)
              }
            />
            {errors?.performanceDate ? (
              <small className={styles.error} role="alert">
                {errors.performanceDate}
              </small>
            ) : null}
          </label>
        ) : null}

        {form.performancePeriodType === 'dateRange' ? (
          <div className={styles.dateRange}>
            <label className={styles.field}>
              <span>{uiText.invoicing.performancePeriodStart}</span>
              <input
                aria-invalid={
                  errors?.performancePeriodStart === undefined
                    ? undefined
                    : true
                }
                name="performancePeriodStart"
                type="date"
                value={form.performancePeriodStart}
                onChange={(event) =>
                  onFieldChange(
                    'performancePeriodStart',
                    event.currentTarget.value,
                  )
                }
              />
              {errors?.performancePeriodStart ? (
                <small className={styles.error} role="alert">
                  {errors.performancePeriodStart}
                </small>
              ) : null}
            </label>
            <label className={styles.field}>
              <span>{uiText.invoicing.performancePeriodEnd}</span>
              <input
                aria-invalid={
                  errors?.performancePeriodEnd === undefined
                    ? undefined
                    : true
                }
                name="performancePeriodEnd"
                type="date"
                value={form.performancePeriodEnd}
                onChange={(event) =>
                  onFieldChange(
                    'performancePeriodEnd',
                    event.currentTarget.value,
                  )
                }
              />
              {errors?.performancePeriodEnd ? (
                <small className={styles.error} role="alert">
                  {errors.performancePeriodEnd}
                </small>
              ) : null}
            </label>
          </div>
        ) : null}
      </div>
    </details>
  );
}
