export const uiText = {
  common: {
    later: 'Myöhemmin',
  },
  layout: {
    appMode: 'Paikallinen käyttöliittymä',
    currentRuntimeMode: 'Nykyinen ajotila',
    localBackend: 'Paikallinen backend',
    modules: 'Moduulit',
  },
  modules: {
    customers: 'Asiakkaat',
    sites: 'Kohteet',
    workOrders: 'Työmääräykset',
    invoicing: 'Laskutus',
  },
  customers: {
    add: 'Lisää',
    addCustomer: 'Lisää asiakas',
    address: 'Osoite',
    active: 'Aktiivinen',
    businessId: 'Y-tunnus',
    created: 'Luotu',
    city: 'Kaupunki',
    comment: 'Kommentti',
    customerList: 'Asiakaslista',
    customerModule: 'Asiakasmoduuli',
    customerNumber: 'Asiakasnumero',
    customerRegister: 'Asiakaskortisto',
    customers: 'Asiakkaat',
    customerType: 'Asiakastyyppi',
    description:
      'Ensimmäinen paikallinen asiakasnäkymä. Data kulkee API-clientin kautta paikalliseen backendiin ja SQLite-tietokantaan.',
    email: 'Sähköposti',
    empty: 'Asiakkaita ei ole vielä.',
    fallbackError: 'Jotain meni vikaan.',
    housingCompany: 'Taloyhtiö',
    inactive: 'Passivoitu',
    loading: 'Ladataan asiakkaita...',
    name: 'Nimi',
    newCustomer: 'Uusi asiakas',
    organization: 'Yritys',
    other: 'Muu',
    phone: 'Puhelin',
    placeholderBusinessId: '1234567-8',
    placeholderCity: 'Kaupunki',
    placeholderComment: 'Sisäinen kommentti',
    placeholderCustomerNumber: '1001',
    placeholderEmail: 'asiakas@example.fi',
    placeholderName: 'Esimerkki Asiakas Oy',
    placeholderPhone: '040 123 4567',
    placeholderPostalCode: '00100',
    placeholderStreetAddress: 'Katuosoite 1',
    postalCode: 'Postinumero',
    privatePerson: 'Yksityishenkilö',
    propertyManager: 'Isännöitsijätoimisto',
    saving: 'Tallennetaan',
    status: 'Tila',
    streetAddress: 'Katuosoite',
  },
  apiErrors: {
    'API request failed.': 'API-pyyntö epäonnistui.',
    'Customer business id must be 200 characters or less.':
      'Y-tunnus saa olla enintään 200 merkkiä.',
    'Customer city must be 200 characters or less.':
      'Kaupunki saa olla enintään 200 merkkiä.',
    'Customer comment must be 1000 characters or less.':
      'Kommentti saa olla enintään 1000 merkkiä.',
    'Customer email must be 200 characters or less.':
      'Sähköposti saa olla enintään 200 merkkiä.',
    'Customer name is required.': 'Asiakkaan nimi on pakollinen.',
    'Customer name must be 200 characters or less.':
      'Asiakkaan nimi saa olla enintään 200 merkkiä.',
    'Customer number is required.': 'Asiakasnumero on pakollinen.',
    'Customer number already exists.': 'Asiakasnumero on jo käytössä.',
    'Customer number must be 50 characters or less.':
      'Asiakasnumero saa olla enintään 50 merkkiä.',
    'Customer phone must be 200 characters or less.':
      'Puhelinnumero saa olla enintään 200 merkkiä.',
    'Customer postal code must be 200 characters or less.':
      'Postinumero saa olla enintään 200 merkkiä.',
    'Customer status is invalid.': 'Asiakkaan tila on virheellinen.',
    'Customer street address must be 200 characters or less.':
      'Katuosoite saa olla enintään 200 merkkiä.',
    'Customer type is invalid.': 'Asiakastyyppi on virheellinen.',
    'Invalid customer response.': 'Asiakastietojen vastaus oli virheellinen.',
    'Invalid customers response.': 'Asiakaslistan vastaus oli virheellinen.',
    'Invalid JSON body.': 'Pyyntö oli virheellinen.',
    'Invalid JSON response.': 'Palvelimen vastaus oli virheellinen.',
  },
} as const;

export function getFinnishApiErrorMessage(message: string): string {
  return uiText.apiErrors[message as keyof typeof uiText.apiErrors] ?? message;
}
