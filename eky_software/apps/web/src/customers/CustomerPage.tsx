import {
  createEkyApiClient,
  EkyApiError,
  type CreateCustomerRequest,
  type Customer,
} from '@eky/api-client';
import { useEffect, useMemo, useState } from 'react';

import { CustomerForm } from './CustomerForm.js';
import { CustomerList } from './CustomerList.js';
import { getFinnishApiErrorMessage, uiText } from '../i18n/fi.js';

const apiBaseUrl = import.meta.env.VITE_EKY_API_BASE_URL ?? '';

const initialCustomerForm: CreateCustomerRequest = {
  businessId: '',
  city: '',
  comment: '',
  customerNumber: '',
  customerType: 'company',
  email: '',
  name: '',
  phone: '',
  postalCode: '',
  status: 'active',
  streetAddress: '',
};

export function CustomerPage(): React.JSX.Element {
  const apiClient = useMemo(() => createEkyApiClient({ baseUrl: apiBaseUrl }), []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerForm, setCustomerForm] = useState<CreateCustomerRequest>(initialCustomerForm);
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
      const createdCustomer = await apiClient.createCustomer(customerForm);

      setCustomers((currentCustomers) => [...currentCustomers, createdCustomer]);
      setCustomerForm(initialCustomerForm);
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
          <p className="eyebrow">{uiText.customers.customerModule}</p>
          <h2>{uiText.customers.customerRegister}</h2>
        </div>
        <p>{uiText.customers.description}</p>
      </section>

      <div className="content-grid">
        <CustomerForm
          form={customerForm}
          isSaving={isSaving}
          onFieldChange={(fieldName, value) =>
            setCustomerForm((currentForm) => ({ ...currentForm, [fieldName]: value }))
          }
          onSubmit={() => void handleCreateCustomer()}
        />
        <CustomerList customers={customers} errorMessage={errorMessage} isLoading={isLoading} />
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return getFinnishApiErrorMessage(error.message);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return uiText.customers.fallbackError;
}
