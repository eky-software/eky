import type { Customer } from '@eky/api-client';

import { CustomerFormActions } from './CustomerFormActions.js';
import { CustomerFormFields } from './CustomerFormFields.js';
import type { CustomerFormModel } from './customerFormModel.js';
import styles from './CustomerForm.module.css';
import { uiText } from '../../i18n/fi.js';
import { MessageBanner } from '../../shared/ui/index.js';

interface CustomerFormProps {
  errorMessage: string | null;
  form: CustomerFormModel;
  isSaving: boolean;
  mode: 'create' | 'edit';
  onCancel(): void;
  onFieldChange(fieldName: keyof CustomerFormModel, value: string): void;
  onSubmit(): void;
  propertyManagers: Customer[];
}

export function CustomerForm({
  errorMessage,
  form,
  isSaving,
  mode,
  onCancel,
  onFieldChange,
  onSubmit,
  propertyManagers,
}: CustomerFormProps): React.JSX.Element {
  const isManualNumber =
    mode === 'edit' || form.customerNumberMode === 'manual';
  const isSubmitDisabled =
    isSaving ||
    form.name.trim().length === 0 ||
    (isManualNumber && !form.customerNumber?.trim());
  const heading =
    mode === 'create'
      ? uiText.customers.addCustomer
      : uiText.customers.editCustomer;
  const kicker =
    mode === 'create'
      ? uiText.customers.newCustomer
      : uiText.customers.customerCard;

  return (
    <section
      aria-labelledby="customer-form-heading"
      className={`panel ${styles.panel}`}
    >
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{kicker}</p>
          <h2 id="customer-form-heading">{heading}</h2>
        </div>
        <button
          className="ghost-button"
          disabled={isSaving}
          onClick={onCancel}
          type="button"
        >
          {mode === 'create'
            ? uiText.customers.backToCustomerList
            : uiText.customers.backToCustomerOverview}
        </button>
      </div>

      <p className="panel-description">{uiText.customers.formDescription}</p>
      {errorMessage ? (
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <CustomerFormFields
          form={form}
          mode={mode}
          onFieldChange={onFieldChange}
          propertyManagers={propertyManagers}
        />
        <CustomerFormActions
          isSaving={isSaving}
          isSubmitDisabled={isSubmitDisabled}
          mode={mode}
          onCancel={onCancel}
        />
      </form>
    </section>
  );
}
