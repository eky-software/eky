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

## Ensimmäinen web-pala

Ensimmäinen toteutettu näkymä on rajattu Customer create/list -käyttöön dokumentin `docs/architecture/web-customer-ui-plan.md` mukaisesti.

Näkymä käyttää `@eky/api-client`-pakettia eikä tee raakaa `fetch`-kutsua React-komponentista.

Ensimmäisessä vaiheessa ei käytetä TanStack Queryä, React Hook Formia, routing-kirjastoa, Zodia, UI-kirjastoa tai `packages/ui`-pakettia.

## Local development

Käynnistä ensin backend.

Webin Vite-dev-palvelin proxyaa `/customers`-kutsut paikalliseen backendiin osoitteeseen `http://127.0.0.1:3000`.

Käynnistä web:

```sh
pnpm --filter @eky/web dev
```
