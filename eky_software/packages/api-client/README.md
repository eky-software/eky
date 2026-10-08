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

  activity/
    activityClient.ts
    activityTypes.ts
    activityResponse.ts

  diagnostics/
    diagnosticsClient.ts
    diagnosticsTypes.ts
    diagnosticsResponse.ts

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

- `createEkyApiClient().listActivity(...)`
- `createEkyApiClient().listDiagnosticEvents(...)`
- `createEkyApiClient().createCustomer(...)`
- `createEkyApiClient().listCustomers()`
- `createEkyApiClient().updateCustomer(...)`
- `createEkyApiClient().getCompanySettings()`
- `createEkyApiClient().updateCompanySettings(...)`
- `createEkyApiClient().getCompanyEmailSecretStatus()`
- `createEkyApiClient().setCompanyEmailSecret(...)`
- `createEkyApiClient().removeCompanyEmailSecret()`
- `createEkyApiClient().approveInvoiceDraft(...)`
- `createEkyApiClient().createInvoiceDraft(...)`
- `createEkyApiClient().deleteInvoiceDraft(...)`
- `createEkyApiClient().getInvoiceDraft(...)`
- `createEkyApiClient().getInvoiceDraftDeliveryHistory(...)`
- `createEkyApiClient().listInvoiceDrafts(...)`
- `createEkyApiClient().updateInvoiceDraft(...)`
- `createEkyApiClient().listApprovedInvoices(query)`
- `createEkyApiClient().listInvoiceDeliveryEvents(...)`
- `createEkyApiClient().getInvoiceDeliveryEventPdfUrl(invoiceId, eventId)`
- `createEkyApiClient().getApprovedInvoice(...)`
- `createEkyApiClient().markApprovedInvoiceSent(...)`
- `createEkyApiClient().reopenApprovedInvoiceForEditing(...)`
- `createEkyApiClient().createApprovedInvoicePdf(...)`
- `createEkyApiClient().getApprovedInvoicePdfMetadata(...)`
- `createEkyApiClient().getApprovedInvoicePdfUrl(...)`
- `createEkyApiClient().prepareApprovedInvoiceEmailDryRun(...)`
- `createEkyApiClient().sendApprovedInvoiceEmailDryRun(...)`
- `createEkyApiClient().prepareApprovedInvoiceEmailSmtpTest(...)`
- `createEkyApiClient().sendApprovedInvoiceEmailSmtpTest(...)`
- `createEkyApiClient().prepareApprovedInvoiceEmailSmtp(...)`
- `createEkyApiClient().sendApprovedInvoiceEmailSmtp(...)`
- `createEkyApiClient().getInvoiceNumberingSettings()`
- `createEkyApiClient().updateInvoiceNumberingSettings(...)`
- `createEkyApiClient().getInvoicePaymentSettings()`
- `createEkyApiClient().updateInvoicePaymentSettings(...)`
- `createEkyApiClient().getInvoiceVatRates()`
- `createEkyApiClient().updateInvoiceVatRates(...)`

Tämä paketti ei tunne Reactia, Honoa, SQLitea, backendin repository-rakennetta tai domainin sisäistä toteutusta.

Muokattavan tavallisen luonnoksen toimitushistoria luetaan erillisestä
GET-rajapinnasta. Vain backend palauttaa siihen liittyvän laskuidentiteetin;
client ei päättele sitä luonnoksen tunnisteesta tai aiemmasta näkymästä.
Null-identiteetin yhteydessä sallitaan vain tyhjä tapahtumalista. Projektiota
ei lisätä luonnoksen kirjoitus-DTO:hon, eikä lukukutsu anna lähetysvaltuutta.

Paketti käyttää selaimen tai ajonaikaisen ympäristön tarjoamaa `fetch`-rajapintaa. Testeissä `fetch` annetaan sisään fake-toteutuksena.

Ensimmäisen web customer UI -palan rajaus on kuvattu dokumentissa `docs/architecture/web-customer-ui-plan.md`.

Laskuluonnos-client välittää backendille vain käyttäjän syöttämät kentät. Se ei lähetä `companyId`-arvoa, palvelimen omistamia tunnisteita, laskettuja summia tai teknisiä aikaleimoja eikä suorita auktoritatiivista laskentalogiikkaa.

Laskunumerointiasetusten client välittää backendille vain käyttäjän muokattavat asetuskentät. Se ei lähetä `companyId`-, `seriesKey`-, `hasUsedNumbering`-, `isPersisted`- tai aikaleimakenttiä.

Laskutuksen PDF-client käyttää hyväksytyn laskun snapshot-dataan perustuvia
backend-reittejä. API-client ei renderöi PDF:ää, ei hae master-dataa eikä
päätä, onko lasku lähetetty.

Toimitushistorian `sendMode` ja `documentSource` ovat backendin nimeämiä,
clientin validoimia suljettuja luokkia. Niistä ei päätellä lähetyslupaa tai
PDF:n tavujen eheyttä. `getInvoiceDeliveryEventPdfUrl` muodostaa vain tarkan
tapahtuma-PDF:n GET-osoitteen; se ei generoi dokumenttia eikä käytä nykyistä
PDF:ää varavaihtoehtona. Tietojen puuttuessa parseri hylkää vastauksen
arvaamatta vanhan tapahtuman tarkoitusta. Omistava sopimus on
[toimitustapahtumien suunnitelmassa](../../docs/architecture/invoice-delivery-events-plan.md).

Laskutuksen maksuasetusten client välittää backendille vain käyttäjän
muokattavat maksuasetuskentät. Se ei päätä viivästyskoron, huomautusajan tai
pankkitietojen liiketoimintasääntöjä.
