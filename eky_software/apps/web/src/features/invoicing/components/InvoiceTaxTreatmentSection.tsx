import type { Customer, InvoiceTaxTreatment } from '@eky/api-client';

import type {
  InvoiceDraftFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  NewInvoiceFormState,
} from '../form/newInvoiceFormState.js';
import styles from './InvoiceTaxTreatmentSection.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceTaxTreatmentSectionProps {
  errors: InvoiceDraftFormErrors | undefined;
  form: NewInvoiceFormState;
  selectedCustomer: Customer | null;
  onTaxTreatmentChange(taxTreatment: InvoiceTaxTreatment): void;
}

export function InvoiceTaxTreatmentSection({
  errors,
  form,
  selectedCustomer,
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

      </div>
    </details>
  );
}
