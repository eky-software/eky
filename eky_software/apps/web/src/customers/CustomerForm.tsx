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
          <p className="panel-kicker">New customer</p>
          <h2 id="create-customer-heading">Add customer</h2>
        </div>
      </div>

      <form
        className="customer-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="customer-name">Name</label>
        <div className="form-row">
          <input
            id="customer-name"
            name="customerName"
            onChange={(event) => onCustomerNameChange(event.target.value)}
            placeholder="Example Customer Oy"
            type="text"
            value={customerName}
          />
          <button disabled={isSaving} type="submit">
            {isSaving ? 'Saving' : 'Add'}
          </button>
        </div>
      </form>
    </section>
  );
}
