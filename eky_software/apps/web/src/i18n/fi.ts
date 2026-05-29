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
    created: 'Luotu',
    customerList: 'Asiakaslista',
    customerModule: 'Asiakasmoduuli',
    customerRegister: 'Asiakaskortisto',
    customers: 'Asiakkaat',
    description:
      'Ensimmäinen paikallinen asiakasnäkymä. Data kulkee API-clientin kautta paikalliseen backendiin ja SQLite-tietokantaan.',
    empty: 'Asiakkaita ei ole vielä.',
    fallbackError: 'Jotain meni vikaan.',
    loading: 'Ladataan asiakkaita...',
    name: 'Nimi',
    newCustomer: 'Uusi asiakas',
    placeholderName: 'Esimerkki Asiakas Oy',
    saving: 'Tallennetaan',
    tenant: 'Yritys',
  },
  apiErrors: {
    'API request failed.': 'API-pyyntö epäonnistui.',
    'Customer name is required.': 'Asiakkaan nimi on pakollinen.',
    'Customer name must be 200 characters or less.':
      'Asiakkaan nimi saa olla enintään 200 merkkiä.',
    'Invalid customer response.': 'Asiakastietojen vastaus oli virheellinen.',
    'Invalid customers response.': 'Asiakaslistan vastaus oli virheellinen.',
    'Invalid JSON body.': 'Pyyntö oli virheellinen.',
    'Invalid JSON response.': 'Palvelimen vastaus oli virheellinen.',
  },
} as const;

export function getFinnishApiErrorMessage(message: string): string {
  return uiText.apiErrors[message as keyof typeof uiText.apiErrors] ?? message;
}
