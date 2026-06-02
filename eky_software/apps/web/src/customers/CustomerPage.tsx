import {
  createEkyApiClient,
  EkyApiError,
  type CreateCustomerRequest,
  type Customer,
  type UpdateCustomerRequest,
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
  customerNumberMode: 'auto',
  customerType: 'company',
  email: '',
  managedByCustomerId: '',
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
      const createdCustomer = await apiClient.createCustomer(customerForm);

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
    fieldName: keyof CreateCustomerRequest,
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
    <div className="customer-workspace">
      <section className="page-intro customer-page-header">
        <div>
          <p className="eyebrow">{uiText.customers.customerModule}</p>
          <h2>{uiText.customers.customerRegister}</h2>
          <p>{uiText.customers.description}</p>
        </div>
        <button
          className="primary-action"
          onClick={openCreatePanel}
          type="button"
        >
          {uiText.customers.newCustomerAction}
        </button>
      </section>

      <div className={panelMode === null ? 'customer-view-grid' : 'customer-view-grid has-side-panel'}>
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

function createDummyCustomerForm(propertyManagers: Customer[]): CreateCustomerRequest {
  const customerType = getRandomItem([
    'company',
    'housingCompany',
    'privatePerson',
    'propertyManager',
  ] as const);
  const city = getRandomItem(['Helsinki', 'Espoo', 'Vantaa', 'Turku', 'Tampere', 'Lahti']);
  const postalCode = getRandomItem(['00100', '02100', '01300', '20100', '33100', '15110']);
  const phoneSuffix = String(getRandomInteger(1000000, 9999999));
  const name = createDummyCustomerName(customerType);
  const managedByCustomerId =
    customerType === 'housingCompany' && propertyManagers.length > 0
      ? getRandomItem(propertyManagers).id
      : '';

  return {
    businessId: createDummyBusinessId(),
    city,
    comment: getRandomItem([
      'Testiasiakas paikallista kokeilua varten.',
      'Dummy-dataa käyttöliittymän testaamiseen.',
      'Luotu testinapilla.',
      '',
    ]),
    customerNumber: '',
    customerNumberMode: 'auto',
    customerType,
    email: createDummyEmail(name),
    managedByCustomerId,
    name,
    phone: `040 ${phoneSuffix.slice(0, 3)} ${phoneSuffix.slice(3)}`,
    postalCode,
    status: 'active',
    streetAddress: `${getRandomItem(['Kotikatu', 'Testitie', 'Puistokuja', 'Satamakatu'])} ${getRandomInteger(
      1,
      88,
    )}`,
  };
}

function toCustomerForm(customer: Customer): CreateCustomerRequest {
  return {
    businessId: customer.businessId,
    city: customer.city,
    comment: customer.comment,
    customerNumber: customer.customerNumber,
    customerNumberMode: 'manual',
    customerType: customer.customerType,
    email: customer.email,
    managedByCustomerId: customer.managedByCustomerId,
    name: customer.name,
    phone: customer.phone,
    postalCode: customer.postalCode,
    status: customer.status,
    streetAddress: customer.streetAddress,
  };
}

function createDummyCustomerName(customerType: CreateCustomerRequest['customerType']): string {
  const baseName = getRandomItem([
    'Aurora',
    'Kivikko',
    'Sininen Kulma',
    'Koivupuisto',
    'Satamapiha',
    'Pohjolan Tähti',
  ]);

  if (customerType === 'housingCompany') {
    return `Asunto Oy ${baseName}`;
  }

  if (customerType === 'propertyManager') {
    return `${baseName} Isännöinti Oy`;
  }

  if (customerType === 'privatePerson') {
    return `${getRandomItem(['Matti', 'Maija', 'Tiina', 'Teppo'])} ${getRandomItem([
      'Testinen',
      'Mallikas',
      'Esimerkki',
    ])}`;
  }

  return `${baseName} Rakennus Oy`;
}

function createDummyBusinessId(): string {
  return `${getRandomInteger(1000000, 9999999)}-${getRandomInteger(1, 9)}`;
}

function createDummyEmail(name: string): string {
  const normalizedName = name
    .toLowerCase()
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')
    .replaceAll('å', 'a')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');

  return `${normalizedName || 'testiasiakas'}@example.fi`;
}

function getRandomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomItem<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];

  if (item === undefined) {
    throw new Error('Cannot select a random item from an empty list.');
  }

  return item;
}

function toUpdateCustomerRequest(form: CreateCustomerRequest): UpdateCustomerRequest {
  return {
    businessId: form.businessId,
    city: form.city,
    comment: form.comment,
    customerNumber: form.customerNumber ?? '',
    customerType: form.customerType,
    email: form.email,
    managedByCustomerId: form.managedByCustomerId,
    name: form.name,
    phone: form.phone,
    postalCode: form.postalCode,
    status: form.status,
    streetAddress: form.streetAddress,
  };
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
