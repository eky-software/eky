import { createEkyApiClient, EkyApiError, type Customer } from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

export function CustomerPage(): React.JSX.Element {
  const apiClient = useMemo(() => createEkyApiClient({ baseUrl: apiBaseUrl }), []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadCustomers(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const loadedCustomers = await apiClient.listCustomers();

        if (isActive) {
          setCustomers(loadedCustomers);
        }
      } catch (error) {
        if (isActive) {
          setErrorMessage(getErrorMessage(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadCustomers();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  async function handleCreateCustomer(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const createdCustomer = await apiClient.createCustomer({ name: customerName });

      setCustomers((currentCustomers) => [...currentCustomers, createdCustomer]);
      setCustomerName('');
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">Eky Base</p>
            <h1>Customers</h1>
          </div>
          <span className="status-badge">Local first</span>
        </header>

        <div className="content-grid">
          <section className="panel form-panel" aria-labelledby="create-customer-heading">
            <h2 id="create-customer-heading">Add customer</h2>
            <form className="customer-form" onSubmit={(event) => void handleCreateCustomer(event)}>
              <label htmlFor="customer-name">Name</label>
              <div className="form-row">
                <input
                  id="customer-name"
                  name="customerName"
                  onChange={(event) => setCustomerName(event.target.value)}
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

          <section className="panel list-panel" aria-labelledby="customer-list-heading">
            <div className="section-heading">
              <h2 id="customer-list-heading">Customer list</h2>
              <span>{customers.length}</span>
            </div>

            {errorMessage ? <p className="message error-message">{errorMessage}</p> : null}
            {isLoading ? <p className="message">Loading customers...</p> : null}
            {!isLoading && customers.length === 0 ? (
              <p className="message">No customers yet.</p>
            ) : null}

            <ul className="customer-list">
              {customers.map((customer) => (
                <li className="customer-item" key={customer.id}>
                  <div>
                    <strong>{customer.name}</strong>
                    <span>{customer.companyId}</span>
                  </div>
                  <time dateTime={customer.createdAt}>{formatDate(customer.createdAt)}</time>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('fi-FI', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
