import { createEkyApiClient, EkyApiError, type Customer } from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

import { CustomerForm } from './CustomerForm.js';
import { CustomerList } from './CustomerList.js';

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

  async function handleCreateCustomer(): Promise<void> {
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
    <div className="customer-workspace">
      <section className="page-intro">
        <div>
          <p className="eyebrow">Customer module</p>
          <h2>Customer register</h2>
        </div>
        <p>
          First local customer workflow. Data flows through the API client to the local backend and
          SQLite.
        </p>
      </section>

      <div className="content-grid">
        <CustomerForm
          customerName={customerName}
          isSaving={isSaving}
          onCustomerNameChange={setCustomerName}
          onSubmit={() => void handleCreateCustomer()}
        />
        <CustomerList customers={customers} errorMessage={errorMessage} isLoading={isLoading} />
      </div>
    </div>
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
