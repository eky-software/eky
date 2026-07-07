# API client package

Tämä paketti sisältää frontendin hallitun yhteyden backend API:in.

Vastuut:

- piilottaa backend-reitit web-sovellukselta
- tarjota tyyppiturvallisia API-funktioita
- keskittää perusmuotoinen virheenkäsittely
- lisätä myöhemmin auth-token kutsuihin

React-komponentit eivät saa tehdä raakaa `fetch`-kutsua suoraan, jos api-client-funktio on olemassa.

## Rakenne

API-client on jaettu moduulipohjaisiin toiminnallisiin kansioihin:

```text
src/
  client.ts
  http.ts
  index.ts

  customers/
    customersClient.ts
    customersTypes.ts

  companySettings/
    companySettingsClient.ts
    companySettingsTypes.ts

  invoicing/
    invoiceDrafts/
      invoiceDraftsClient.ts
      invoiceDraftsTypes.ts
      invoiceDraftsSerialization.ts
      invoiceDraftsResponse.ts

    approvedInvoices/
      approvedInvoicesClient.ts
      approvedInvoicesTypes.ts
      approvedInvoicesResponse.ts

    invoiceNumbering/
      invoiceNumberingClient.ts
      invoiceNumberingTypes.ts
      invoiceNumberingSerialization.ts
      invoiceNumberingResponse.ts

    invoicePaymentSettings/
      invoicePaymentSettingsClient.ts
      invoicePaymentSettingsTypes.ts
      invoicePaymentSettingsSerialization.ts
      invoicePaymentSettingsResponse.ts
```

Moduulikansio kokoaa samaan liiketoimintamoduuliin kuuluvat API-kokonaisuudet.
Feature-kansio omistaa kyseisen HTTP-sopimuksen tyypit, kutsut ja tarvittavat
request/response-muunnokset. `src/client.ts` kokoaa feature-clientit yhteen ja
`src/index.ts` säilyy paketin julkisena pääexporttina.

Uudet API-kokonaisuudet lisätään omiin selkeästi nimettyihin kansioihinsa.
Jos uudella moduulilla on useita API-alikokonaisuuksia, ne sijoitetaan moduulin
oman kansion alle heti alusta asti.
Pakettiin ei luoda yleisiä `utils`, `helpers`, `common` tai `everything`
-kaatopaikkoja.

## Toteutetut API-kokonaisuudet

Paketti tarjoaa tällä hetkellä hallitut kutsut:

- `createEkyApiClient().createCustomer(...)`
- `createEkyApiClient().listCustomers()`
- `createEkyApiClient().updateCustomer(...)`
- `createEkyApiClient().getCompanySettings()`
- `createEkyApiClient().updateCompanySettings(...)`
- `createEkyApiClient().createInvoiceDraft(...)`
- `createEkyApiClient().deleteInvoiceDraft(...)`
- `createEkyApiClient().getInvoiceDraft(...)`
- `createEkyApiClient().listInvoiceDrafts(...)`
- `createEkyApiClient().updateInvoiceDraft(...)`
- `createEkyApiClient().getInvoiceNumberingSettings()`
- `createEkyApiClient().updateInvoiceNumberingSettings(...)`

Tämä paketti ei tunne Reactia, Honoa, SQLitea, backendin repository-rakennetta tai domainin sisäistä toteutusta.

Paketti käyttää selaimen tai ajonaikaisen ympäristön tarjoamaa `fetch`-rajapintaa. Testeissä `fetch` annetaan sisään fake-toteutuksena.

Ensimmäisen web customer UI -palan rajaus on kuvattu dokumentissa `docs/architecture/web-customer-ui-plan.md`.

Laskuluonnos-client välittää backendille vain käyttäjän syöttämät kentät. Se ei lähetä `companyId`-arvoa, palvelimen omistamia tunnisteita, laskettuja summia tai teknisiä aikaleimoja eikä suorita auktoritatiivista laskentalogiikkaa.

Laskunumerointiasetusten client välittää backendille vain käyttäjän muokattavat asetuskentät. Se ei lähetä `companyId`-, `seriesKey`-, `hasUsedNumbering`-, `isPersisted`- tai aikaleimakenttiä.
