import { CustomerPicker } from './CustomerPicker.js';
import { SelectedCustomerDetails } from './SelectedCustomerDetails.js';
import type {
  InvoiceDraftFormErrors,
} from '../form/invoiceDraftFormValidation.js';
import type {
  NewInvoiceBasicInfoField,
  NewInvoiceFormState,
} from '../form/newInvoiceFormState.js';
import type { InvoiceCustomerListState } from '../hooks/useInvoiceCustomers.js';
import styles from './InvoiceBasicInfoSection.module.css';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceBasicInfoSectionProps {
  customerListState: InvoiceCustomerListState;
  errors: InvoiceDraftFormErrors | undefined;
  form: NewInvoiceFormState;
  onFieldChange<FieldName extends NewInvoiceBasicInfoField>(
    fieldName: FieldName,
    value: NewInvoiceFormState[FieldName],
  ): void;
}

export function InvoiceBasicInfoSection({
  customerListState,
  errors,
  form,
  onFieldChange,
}: InvoiceBasicInfoSectionProps): React.JSX.Element {
  const selectedCustomer =
    customerListState.customers.find(
      (customer) => customer.id === form.customerId,
    ) ?? null;
  const propertyManager =
    selectedCustomer?.managedByCustomerId
      ? customerListState.customers.find(
          (customer) =>
            customer.id === selectedCustomer.managedByCustomerId &&
            customer.customerType === 'propertyManager',
        ) ?? null
      : null;

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h3>{uiText.invoicing.basicInformation}</h3>
        <p>{uiText.invoicing.basicInformationHelp}</p>
      </header>

      <div className={styles.grid}>
        <CustomerPicker
          {...customerListState}
          validationErrorMessage={errors?.customerId}
          value={form.customerId}
          onChange={(customerId) =>
            onFieldChange('customerId', customerId)
          }
        />

        {selectedCustomer !== null ? (
          <SelectedCustomerDetails
            customer={selectedCustomer}
            propertyManager={propertyManager}
          />
        ) : null}

        <label className={styles.field}>
          <span>{uiText.invoicing.invoiceDate}</span>
          <input
            aria-describedby={
              errors?.invoiceDate === undefined
                ? undefined
                : 'invoice-date-error'
            }
            aria-invalid={errors?.invoiceDate === undefined ? undefined : true}
            name="invoiceDate"
            type="date"
            value={form.invoiceDate}
            onChange={(event) =>
              onFieldChange('invoiceDate', event.target.value)
            }
          />
          {errors?.invoiceDate ? (
            <small
              className={styles.fieldError}
              id="invoice-date-error"
              role="alert"
            >
              {errors.invoiceDate}
            </small>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>{uiText.invoicing.paymentTermDays}</span>
          <input
            aria-describedby={
              errors?.paymentTermDays === undefined
                ? undefined
                : 'invoice-payment-term-error'
            }
            aria-invalid={
              errors?.paymentTermDays === undefined ? undefined : true
            }
            inputMode="numeric"
            min="0"
            name="paymentTermDays"
            step="1"
            type="number"
            value={form.paymentTermDays}
            onChange={(event) =>
              onFieldChange('paymentTermDays', event.target.value)
            }
          />
          {errors?.paymentTermDays ? (
            <small
              className={styles.fieldError}
              id="invoice-payment-term-error"
              role="alert"
            >
              {errors.paymentTermDays}
            </small>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>{uiText.invoicing.dueDate}</span>
          <input
            aria-describedby={
              errors?.dueDate === undefined
                ? undefined
                : 'invoice-due-date-error'
            }
            aria-invalid={errors?.dueDate === undefined ? undefined : true}
            name="dueDate"
            type="date"
            value={form.dueDate}
            onChange={(event) =>
              onFieldChange('dueDate', event.target.value)
            }
          />
          {errors?.dueDate ? (
            <small
              className={styles.fieldError}
              id="invoice-due-date-error"
              role="alert"
            >
              {errors.dueDate}
            </small>
          ) : null}
        </label>

        <label className={`${styles.field} ${styles.wideField}`}>
          <span>{uiText.invoicing.subject}</span>
          <input
            name="subject"
            placeholder={uiText.invoicing.subjectPlaceholder}
            type="text"
            value={form.subject}
            onChange={(event) =>
              onFieldChange('subject', event.target.value)
            }
          />
        </label>

        <label className={styles.field}>
          <span>{uiText.invoicing.orderNumber}</span>
          <input
            name="orderNumber"
            placeholder={uiText.invoicing.orderNumberPlaceholder}
            type="text"
            value={form.orderNumber}
            onChange={(event) =>
              onFieldChange('orderNumber', event.target.value)
            }
          />
        </label>

        <fieldset className={styles.priceMode}>
          <legend>{uiText.invoicing.priceInputMode}</legend>
          <div className="segmented-control">
            <label>
              <input
                checked={form.priceInputMode === 'net'}
                name="priceInputMode"
                type="radio"
                value="net"
                onChange={() => onFieldChange('priceInputMode', 'net')}
              />
              <span>{uiText.invoicing.priceInputNet}</span>
            </label>
            <label>
              <input
                checked={form.priceInputMode === 'gross'}
                name="priceInputMode"
                type="radio"
                value="gross"
                onChange={() => onFieldChange('priceInputMode', 'gross')}
              />
              <span>{uiText.invoicing.priceInputGross}</span>
            </label>
          </div>
        </fieldset>

        <label className={`${styles.field} ${styles.wideField}`}>
          <span>{uiText.invoicing.note}</span>
          <textarea
            name="note"
            placeholder={uiText.invoicing.notePlaceholder}
            value={form.note}
            onChange={(event) => onFieldChange('note', event.target.value)}
          />
        </label>
      </div>
    </section>
  );
}
