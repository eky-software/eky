# Web app

Tämä sovellus sisältää Eky-järjestelmän web-käyttöliittymän.

Vastuut:

- näyttää käyttöliittymä
- käsitellä käyttäjän vuorovaikutus
- käyttää `api-client`-pakettia backend-yhteyksiin
- käyttää myöhemmin `ui`-pakettia jaettuihin käyttöliittymäkomponentteihin, jos tarve syntyy
- käyttää myöhemmin `validation`-pakettia lomakkeiden tukena, jos tarve syntyy
- käyttää myöhemmin `permissions`-pakettia käyttökokemusta parantaviin tarkistuksiin

Tämä sovellus ei saa sisältää varsinaista liiketoimintalogiikkaa, tehdä suoria tietokantakutsuja tai kutsua Firebasea suoraan komponenteista.

## Nykyiset lukureitit

Web sisältää Customers-, Company Settings-, Invoicing-, Activity- ja
Diagnostics-featuret. [Web-rakenne](../../docs/architecture/web-frontend-structure.md)
omistaa app/features/shared/layout/i18n-rajat;
[UI-periaatteet](../../docs/design/ui-principles.md) käyttöliittymän.
Moduulin oma vastuuohje ja soveltuva AGENTS luetaan ennen muutosta.
Ensimmäinen [Customer create/list -resepti](../../docs/architecture/web-customer-ui-plan.md)
on historiaa, ei kaikkien web-tehtävien pakollinen aloitusreitti.

UI käyttää `@eky/api-client`-pakettia, ei komponenttien raakaa fetchiä.
Selainkehitys on vain paikallinen autentikoimaton kehityspoikkeus:
ei verkkonäkyvyyttä, oikeaa asiakasdataa tai SMTP-lähetystä. Electronin
vahvistettu runtime-session on eri luottamusraja. Uudet riippuvuudet
vaativat erillisen hyväksynnän, myös historiallisessa reseptissä nimetyt.

## Local development

Käynnistä ensin backend.

Webin Vite-dev-palvelin proxyaa paikalliseen backendiin osoitteeseen `http://127.0.0.1:3000` ne API-polut, joita web käyttää local development -tilassa:

- `/activity`
- `/company-settings`
- `/customers`
- `/diagnostics`
- `/invoice-drafts`
- `/invoices`
- `/invoice-numbering-settings`
- `/invoice-numbering-series`
- `/invoice-payment-settings`
- `/invoice-vat-rates`
- `/sent-invoice-groups`

Lista seuraa [kehitysproxyn omistavaa konfiguraatiota](src/app/developmentBackendProxy.ts).
Se ei ole Electronin allowlist tai lupa laajentaa backendin verkkonäkyvyyttä.

Käynnistä web:

```sh
pnpm --filter @eky/web dev
```
