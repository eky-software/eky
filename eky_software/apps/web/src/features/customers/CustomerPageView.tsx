import {
  EkyApiError,
  type Customer,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { CustomerForm } from './CustomerForm.js';
import { CustomerList } from './CustomerList.js';
import { createDummyCustomerForm } from './customerDummyData.js';
import {
  initialCustomerForm,
  toCreateCustomerRequest,
  toCustomerForm,
  toUpdateCustomerRequest,
  type CustomerFormModel,
} from './customerFormModel.js';
import styles from './CustomerPageView.module.css';
import { getFinnishApiErrorMessage, uiText } from '../../i18n/fi.js';

type CustomerPageClient = Pick<
  EkyApiClient,
  'createCustomer' | 'listCustomers' | 'updateCustomer'
>;

interface CustomerPageProps {
  apiClient: CustomerPageClient;
}

export function CustomerPage({ apiClient }: CustomerPageProps): React.JSX.Element {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerForm, setCustomerForm] = useState<CustomerFormModel>(initialCustomerForm);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<'create' | 'edit' | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const propertyManagerCustomers = customers.filter(
    (customer) => customer.customerType === 'propertyManager',
  );

  useEffect(() => {
    let isActive = true;

    async function loadCustomers(): Promise<void> {
      setIsLoading(true);
      setLoadErrorMessage(null);

      try {
        const loadedCustomers = await apiClient.listCustomers();

        if (isActive) {
          setCustomers(loadedCustomers);
        }
      } catch (error) {
        if (isActive) {
          setLoadErrorMessage(getErrorMessage(error));
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
    setSaveErrorMessage(null);

    try {
      const createdCustomer = await apiClient.createCustomer(toCreateCustomerRequest(customerForm));

      setCustomers((currentCustomers) => [...currentCustomers, createdCustomer]);
      setCustomerForm(initialCustomerForm);
      setPanelMode(null);
      setSelectedCustomerId(null);
    } catch (error) {
      setSaveErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateCustomer(): Promise<void> {
    if (isSaving || selectedCustomerId === null) {
      return;
    }

    setIsSaving(true);
    setSaveErrorMessage(null);

    try {
      const updatedCustomer = await apiClient.updateCustomer(
        selectedCustomerId,
        toUpdateCustomerRequest(customerForm),
      );

      setCustomers((currentCustomers) =>
        currentCustomers.map((customer) =>
          customer.id === updatedCustomer.id ? updatedCustomer : customer,
        ),
      );
      setCustomerForm(initialCustomerForm);
      setPanelMode(null);
      setSelectedCustomerId(null);
    } catch (error) {
      setSaveErrorMessage(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  function openCreatePanel(): void {
    setSaveErrorMessage(null);
    setSelectedCustomerId(null);
    setCustomerForm(initialCustomerForm);
    setPanelMode('create');
  }

  function openEditPanel(customer: Customer): void {
    setSaveErrorMessage(null);
    setSelectedCustomerId(customer.id);
    setCustomerForm(toCustomerForm(customer));
    setPanelMode('edit');
  }

  function closePanel(): void {
    if (isSaving) {
      return;
    }

    setSaveErrorMessage(null);
    setSelectedCustomerId(null);
    setCustomerForm(initialCustomerForm);
    setPanelMode(null);
  }

  function fillDummyCustomer(): void {
    setSaveErrorMessage(null);
    setCustomerForm(createDummyCustomerForm(propertyManagerCustomers));
  }

  function handleCustomerFormFieldChange(
    fieldName: keyof CustomerFormModel,
    value: string,
  ): void {
    setCustomerForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value,
      ...(fieldName === 'customerType' && value !== 'housingCompany'
        ? { managedByCustomerId: '' }
        : {}),
    }));
  }

  return (
    <div className={styles.workspace}>
      <section className={`page-intro ${styles.pageHeader}`}>
        <div>
          <p className="eyebrow">{uiText.customers.customerWorkspace}</p>
          <h2>{uiText.customers.customerRegister}</h2>
          <p>{uiText.customers.description}</p>
        </div>
      </section>

      <div
        className={
          panelMode === null
            ? styles.viewGrid
            : `${styles.viewGrid} ${styles.viewGridWithSidePanel}`
        }
      >
        <CustomerList
          customers={customers}
          errorMessage={loadErrorMessage}
          isLoading={isLoading}
          onCreateClick={openCreatePanel}
          onCustomerSelect={openEditPanel}
        />
        {panelMode !== null ? (
          <CustomerForm
            errorMessage={saveErrorMessage}
            form={customerForm}
            isSaving={isSaving}
            mode={panelMode}
            onCancel={closePanel}
            onFillDummy={panelMode === 'create' ? fillDummyCustomer : undefined}
            onFieldChange={handleCustomerFormFieldChange}
            onSubmit={() =>
              panelMode === 'create' ? void handleCreateCustomer() : void handleUpdateCustomer()
            }
            propertyManagers={propertyManagerCustomers}
          />
        ) : null}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    return getFinnishApiErrorMessage(error.message);
  }

  if (error instanceof Error && error.message === 'Invalid hourly rate.') {
    return uiText.customers.invalidHourlyRate;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return uiText.customers.fallbackError;
}
