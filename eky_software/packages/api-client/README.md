# API client package

Tämä paketti sisältää frontendin hallitun yhteyden backend API:in.

Vastuut:

- piilottaa backend-reitit web-sovellukselta
- tarjota tyyppiturvallisia API-funktioita
- keskittää perusmuotoinen virheenkäsittely
- lisätä myöhemmin auth-token kutsuihin

React-komponentit eivät saa tehdä raakaa `fetch`-kutsua suoraan, jos api-client-funktio on olemassa.

## Toteutetut API-kokonaisuudet

Paketti tarjoaa tällä hetkellä hallitut kutsut:

- `createEkyApiClient().createCustomer(...)`
- `createEkyApiClient().listCustomers()`
- `createEkyApiClient().updateCustomer(...)`
- `createEkyApiClient().getCompanySettings()`
- `createEkyApiClient().updateCompanySettings(...)`
- `createEkyApiClient().createInvoiceDraft(...)`
- `createEkyApiClient().getInvoiceDraft(...)`
- `createEkyApiClient().listInvoiceDrafts(...)`
- `createEkyApiClient().updateInvoiceDraft(...)`

Tämä paketti ei tunne Reactia, Honoa, SQLitea, backendin repository-rakennetta tai domainin sisäistä toteutusta.

Paketti käyttää selaimen tai ajonaikaisen ympäristön tarjoamaa `fetch`-rajapintaa. Testeissä `fetch` annetaan sisään fake-toteutuksena.

Ensimmäisen web customer UI -palan rajaus on kuvattu dokumentissa `docs/architecture/web-customer-ui-plan.md`.

Laskuluonnos-client välittää backendille vain käyttäjän syöttämät kentät. Se ei lähetä `companyId`-arvoa, palvelimen omistamia tunnisteita, laskettuja summia tai teknisiä aikaleimoja eikä suorita auktoritatiivista laskentalogiikkaa.
