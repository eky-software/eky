import { uiText } from '../i18n/fi.js';

interface CustomerFormProps {
  customerName: string;
  isSaving: boolean;
  onCustomerNameChange(customerName: string): void;
  onSubmit(): void;
}

export function CustomerForm({
  customerName,
  isSaving,
  onCustomerNameChange,
  onSubmit,
}: CustomerFormProps): React.JSX.Element {
  return (
    <section className="panel customer-form-panel" aria-labelledby="create-customer-heading">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.customers.newCustomer}</p>
          <h2 id="create-customer-heading">{uiText.customers.addCustomer}</h2>
        </div>
      </div>

      <form
        className="customer-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="customer-name">{uiText.customers.name}</label>
        <div className="form-row">
          <input
            id="customer-name"
            name="customerName"
            onChange={(event) => onCustomerNameChange(event.target.value)}
            placeholder={uiText.customers.placeholderName}
            type="text"
            value={customerName}
          />
          <button disabled={isSaving} type="submit">
            {isSaving ? uiText.customers.saving : uiText.customers.add}
          </button>
        </div>
      </form>
    </section>
  );
}
