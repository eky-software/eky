import type { CreateCustomerRequest, Customer } from '@eky/api-client';

export function createDummyCustomerForm(propertyManagers: Customer[]): CreateCustomerRequest {
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

export function createDummyCustomerName(customerType: CreateCustomerRequest['customerType']): string {
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

export function createDummyBusinessId(): string {
  return `${getRandomInteger(1000000, 9999999)}-${getRandomInteger(1, 9)}`;
}

export function createDummyEmail(name: string): string {
  const normalizedName = name
    .toLowerCase()
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')
    .replaceAll('å', 'a')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');

  return `${normalizedName || 'testiasiakas'}@example.fi`;
}

export function getRandomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRandomItem<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];

  if (item === undefined) {
    throw new Error('Cannot select a random item from an empty list.');
  }

  return item;
}
