import {
  EkyApiError,
  type Customer,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useReducer, useState } from 'react';

import { CustomerForm } from './CustomerForm.js';
import { CustomerList } from './CustomerList.js';
import {
  customerListViewReducer,
  initialCustomerListViewState,
} from './customerListViewState.js';
import type { CustomerInvoiceNavigationTarget } from './customerInvoiceNavigation.js';
import { CustomerOverviewWorkspace } from './CustomerOverviewWorkspace.js';
import {
  initialCustomerForm,
  toCreateCustomerRequest,
  toCustomerForm,
  toUpdateCustomerRequest,
  type CustomerFormModel,
} from './customerFormModel.js';
import {
  customerWorkspaceReducer,
  initialCustomerWorkspaceState,
} from './customerWorkspaceState.js';
import { useCustomerActivity } from './hooks/useCustomerActivity.js';
import { useCustomerInvoices } from './hooks/useCustomerInvoices.js';
import styles from './CustomerPageView.module.css';
import { getFinnishApiErrorMessage, uiText } from '../../i18n/fi.js';

type CustomerPageClient = Pick<
  EkyApiClient,
  | 'createCustomer'
  | 'getCompanySettings'
  | 'getCustomer'
  | 'listApprovedInvoices'
  | 'listCustomerActivity'
  | 'listCustomers'
  | 'listInvoiceDrafts'
  | 'listSentInvoiceGroups'
  | 'updateCustomer'
>;

interface CustomerPageProps {
  apiClient: CustomerPageClient;
  onOpenInvoice(target: CustomerInvoiceNavigationTarget): void;
}

export function CustomerPage({
  apiClient,
  onOpenInvoice,
}: CustomerPageProps): React.JSX.Element {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerForm, setCustomerForm] =
    useState<CustomerFormModel>(initialCustomerForm);
  const [customerDetail, setCustomerDetail] = useState<Customer | null>(null);
  const [defaultHourlyRateCents, setDefaultHourlyRateCents] = useState<
    number | null
  >(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(
    null,
  );
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [listViewState, dispatchListView] = useReducer(
    customerListViewReducer,
    initialCustomerListViewState,
  );
  const [workspaceState, dispatchWorkspace] = useReducer(
    customerWorkspaceReducer,
    initialCustomerWorkspaceState,
  );
  const selectedCustomerId =
    workspaceState.mode === 'overview' || workspaceState.mode === 'edit'
      ? workspaceState.customerId
      : null;
  const activityState = useCustomerActivity(apiClient, selectedCustomerId);
  const invoiceState = useCustomerInvoices(apiClient, selectedCustomerId);
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
          setLoadErrorMessage(
            getSafeErrorMessage(error, uiText.customers.fallbackError),
          );
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

  useEffect(() => {
    let isActive = true;

    async function loadCompanyDefault(): Promise<void> {
      try {
        const companySettings = await apiClient.getCompanySettings();

        if (isActive) {
          setDefaultHourlyRateCents(companySettings.defaultHourlyRateCents);
        }
      } catch {
        if (isActive) {
          setDefaultHourlyRateCents(null);
        }
      }
    }

    void loadCompanyDefault();

    return () => {
      isActive = false;
    };
  }, [apiClient]);

  useEffect(() => {
    if (selectedCustomerId === null) {
      setCustomerDetail(null);
      setDetailErrorMessage(null);
      setIsDetailLoading(false);
      return;
    }

    const customerId = selectedCustomerId;
    let isActive = true;
    setCustomerDetail(null);
    setDetailErrorMessage(null);
    setIsDetailLoading(true);

    async function loadCustomerDetail(): Promise<void> {
      try {
        const loadedCustomer = await apiClient.getCustomer(customerId);

        if (isActive) {
          setCustomerDetail(loadedCustomer);
        }
      } catch (error) {
        if (isActive) {
          setDetailErrorMessage(
            getSafeErrorMessage(error, uiText.customers.customerLoadError),
          );
        }
      } finally {
        if (isActive) {
          setIsDetailLoading(false);
        }
      }
    }

    void loadCustomerDetail();

    return () => {
      isActive = false;
    };
  }, [apiClient, selectedCustomerId]);

  async function handleCreateCustomer(): Promise<void> {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveErrorMessage(null);

    try {
      const createdCustomer = await apiClient.createCustomer(
        toCreateCustomerRequest(customerForm),
      );

      setCustomers((currentCustomers) => [
        ...currentCustomers,
        createdCustomer,
      ]);
      setCustomerDetail(createdCustomer);
      setCustomerForm(initialCustomerForm);
      dispatchWorkspace({
        customerId: createdCustomer.id,
        type: 'showCustomerOverview',
      });
    } catch (error) {
      setSaveErrorMessage(
        getSafeErrorMessage(error, uiText.customers.fallbackError),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateCustomer(): Promise<void> {
    if (isSaving || workspaceState.mode !== 'edit') {
      return;
    }

    setIsSaving(true);
    setSaveErrorMessage(null);

    try {
      const updatedCustomer = await apiClient.updateCustomer(
        workspaceState.customerId,
        toUpdateCustomerRequest(customerForm),
      );

      setCustomers((currentCustomers) =>
        currentCustomers.map((customer) =>
          customer.id === updatedCustomer.id ? updatedCustomer : customer,
        ),
      );
      setCustomerDetail(updatedCustomer);
      setCustomerForm(initialCustomerForm);
      dispatchWorkspace({
        customerId: updatedCustomer.id,
        type: 'showCustomerOverview',
      });
    } catch (error) {
      setSaveErrorMessage(
        getSafeErrorMessage(error, uiText.customers.fallbackError),
      );
    } finally {
      setIsSaving(false);
    }
  }

  function openCreateWorkspace(): void {
    setSaveErrorMessage(null);
    setCustomerForm(initialCustomerForm);
    dispatchWorkspace({ type: 'createCustomer' });
  }

  function openCustomerOverview(customer: Customer): void {
    setSaveErrorMessage(null);
    dispatchWorkspace({
      customerId: customer.id,
      type: 'showCustomerOverview',
    });
  }

  function openEditWorkspace(): void {
    if (customerDetail === null) {
      return;
    }

    setSaveErrorMessage(null);
    setCustomerForm(toCustomerForm(customerDetail));
    dispatchWorkspace({
      customerId: customerDetail.id,
      type: 'editCustomer',
    });
  }

  function returnFromForm(): void {
    if (isSaving) {
      return;
    }

    setSaveErrorMessage(null);
    setCustomerForm(initialCustomerForm);

    if (workspaceState.mode === 'edit') {
      dispatchWorkspace({
        customerId: workspaceState.customerId,
        type: 'showCustomerOverview',
      });
      return;
    }

    dispatchWorkspace({ type: 'showCustomerList' });
  }

  function returnToCustomerList(): void {
    setSaveErrorMessage(null);
    setCustomerForm(initialCustomerForm);
    dispatchWorkspace({ type: 'showCustomerList' });
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
      {workspaceState.mode === 'list' ? (
        <>
          <section className={`page-intro ${styles.pageHeader}`}>
            <div>
              <p className="eyebrow">
                {uiText.customers.customerWorkspace}
              </p>
              <h2>{uiText.customers.customerRegister}</h2>
              <p>{uiText.customers.description}</p>
            </div>
          </section>
          <CustomerList
            activeFilter={listViewState.activeFilter}
            customers={customers}
            errorMessage={loadErrorMessage}
            expandedPropertyManagerIds={
              listViewState.expandedPropertyManagerIds
            }
            isLoading={isLoading}
            onActiveFilterChange={(activeFilter) =>
              dispatchListView({ activeFilter, type: 'changeFilter' })
            }
            onCreateClick={openCreateWorkspace}
            onCustomerSelect={openCustomerOverview}
            onPropertyManagerToggle={(customerId) =>
              dispatchListView({
                customerId,
                type: 'togglePropertyManager',
              })
            }
            onSearchQueryChange={(searchQuery) =>
              dispatchListView({ searchQuery, type: 'changeSearchQuery' })
            }
            onSortChange={(sortKey) =>
              dispatchListView({ sortKey, type: 'updateSort' })
            }
            searchQuery={listViewState.searchQuery}
            sortState={listViewState.sortState}
          />
        </>
      ) : null}

      {workspaceState.mode === 'create' ? (
        <CustomerForm
          errorMessage={saveErrorMessage}
          form={customerForm}
          isSaving={isSaving}
          mode="create"
          onCancel={returnFromForm}
          onFieldChange={handleCustomerFormFieldChange}
          onSubmit={() => void handleCreateCustomer()}
          propertyManagers={propertyManagerCustomers}
        />
      ) : null}

      {workspaceState.mode === 'edit' ? (
        <CustomerForm
          errorMessage={saveErrorMessage}
          form={customerForm}
          isSaving={isSaving}
          mode="edit"
          onCancel={returnFromForm}
          onFieldChange={handleCustomerFormFieldChange}
          onSubmit={() => void handleUpdateCustomer()}
          propertyManagers={propertyManagerCustomers}
        />
      ) : null}

      {workspaceState.mode === 'overview' ? (
        <CustomerOverviewWorkspace
          activityState={activityState}
          customer={customerDetail}
          customers={customers}
          defaultHourlyRateCents={defaultHourlyRateCents}
          errorMessage={detailErrorMessage}
          invoiceState={invoiceState}
          isLoading={isDetailLoading}
          onBack={returnToCustomerList}
          onEdit={openEditWorkspace}
          onOpenInvoice={onOpenInvoice}
        />
      ) : null}
    </div>
  );
}

function getSafeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof EkyApiError) {
    return getFinnishApiErrorMessage(error.message);
  }

  if (error instanceof Error && error.message === 'Invalid hourly rate.') {
    return uiText.customers.invalidHourlyRate;
  }

  return fallbackMessage;
}
