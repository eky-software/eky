# Company Settings implementation plan

Tämä dokumentti kuvaa Company Settings / Oma yritys -moduulin ensimmäisen toteutussuunnitelman.

Tämä ei ole vielä koodimuutos. Tavoite on rajata ensimmäinen toteutettava pystysuora pala ennen tietokantamigraatiota, backend-koodia, api-clientiä tai web-näkymää.

## MVP-Tavoite

Ensimmäinen Company Settings MVP mahdollistaa yhden Oma yritys -asetuskokonaisuuden per `companyId`.

Toteutus sisältää:

- oman yrityksen perustiedot
- oman yrityksen yhteystiedot
- oman yrityksen osoitteen
- oman yrityksen Y-tunnuksen
- oletustuntihinnan `defaultHourlyRate`
- backend-reitit:
  - `GET /company-settings`
  - `PUT /company-settings`
- api-client-kutsut:
  - `getCompanySettings()`
  - `updateCompanySettings(input)`
- web-näkymän:
  - `Oma yritys`
  - perustiedot
  - oletustuntihinta

Ensimmäinen toteutus todistaa saman arkkitehtuurisen ketjun kuin customer-slice:

```text
React UI
  -> packages/api-client
    -> backend HTTP route
      -> application service
        -> domain/rules
          -> repository port
            -> SQLite adapter
```

## Ei Vielä Customer Hourly Rate Overridea

Asiakkaan `hourlyRateOverride` toteutetaan vasta seuraavassa vaiheessa.

Tässä vaiheessa toteutetaan vain:

- Company Settings
- oman yrityksen perustiedot
- `defaultHourlyRate`

Näin muutos pysyy pienenä ja moduulirajat selkeinä.

Seuraava erillinen vaihe voi lisätä customers-moduuliin:

```ts
hourlyRateOverride: number | null
```

Tällöin asiakkaan tuntihintapoikkeus käyttää jo olemassa olevaa Company Settings -oletushintaa taustaperiaatteena.

## SQLite-Taulu

Ensimmäinen SQLite-taulu:

```text
company_settings
```

Alustavat kentät:

- `id`
- `company_id`
- `company_name`
- `business_id`
- `street_address`
- `postal_code`
- `city`
- `email`
- `phone`
- `default_hourly_rate`
- `created_at`
- `updated_at`

Säännöt:

- `company_id` on uniikki
- ensimmäisessä local MVP:ssä käytetään samaa väliaikaista `dev-company`-arvoa kuin customer-moduulissa
- `dev-company` ei ole auth-, tenant- tai permission-malli
- myöhemmin auth ja tenant-konteksti määrittävät `companyId`-arvon luotettavasti

### Default Hourly Rate

Suositus ensimmäiseen toteutukseen:

- `default_hourly_rate` on nullable
- `null` tarkoittaa, että oletustuntihintaa ei ole vielä asetettu
- `0` tarkoittaa oikeasti nolla euroa tunnilta

Tämä vastaa samaa semantiikkaa, jota myöhemmin käytetään asiakkaan `hourlyRateOverride`-kentässä.

Rahankäsittelyn tarkempi toteutustapa päätetään koodivaiheessa selkeästi.

Ensimmäisessä toteutuksessa pitää välttää epäselvää floating point -rahankäsittelyä. Vaihtoehdot arvioidaan ennen koodia:

- tallennetaanko eurot desimaalina
- tallennetaanko sentit integer-arvona
- käytetäänkö muuta selkeästi rajattua rahamallia

Tätä päätöstä ei tehdä tässä dokumentissa lopullisesti.

## Backend-Rakenne

Ensimmäinen backend-rakenne:

```text
apps/backend/src/modules/companySettings/
  domain/
    companySettings.ts
    companySettingsRules.ts

  application/
    getCompanySettings.ts
    updateCompanySettings.ts

  ports/
    companySettingsRepository.ts

  infrastructure/
    sqliteCompanySettingsRepository.ts

  http/
    companySettingsRoutes.ts
```

Rakenne seuraa customer-moduulin mallia.

Domain ei saa importata:

- Honoa
- SQLitea
- better-sqlite3:tä
- HTTP-tyyppejä
- Reactia

Application service käyttää vain repository porttia.

SQLite ja SQL saavat näkyä vain infrastructure-adapterissa.

## Application Servicet

Ensimmäiset application servicet:

- `getCompanySettings`
- `updateCompanySettings`

`getCompanySettings`:

- hakee nykyisen yrityksen asetukset `companyId`-arvolla
- voi palauttaa tyhjän oletusmuodon, jos asetuksia ei vielä ole
- ei saa luoda yllättävää tietokantariviä ilman erillistä päätöstä

`updateCompanySettings`:

- validoi ja normalisoi inputin domain-sääntöjen avulla
- tallentaa asetukset repository portin kautta
- toimii upsert-tyyppisesti, koska yhdellä `companyId`-arvolla on yksi asetuskokonaisuus

## Repository Port

Repository port:

```ts
interface CompanySettingsRepository {
  findByCompanyId(companyId: string): Promise<CompanySettings | null>;
  upsertCompanySettings(settings: CompanySettings): Promise<CompanySettings>;
}
```

Portti ei saa paljastaa:

- better-sqlite3-tyyppejä
- SQL statementteja
- tietokantarivejä sellaisenaan
- database connection -olioita

Portti käyttää vain domain- ja application-tason tyyppejä.

## HTTP-Reitit

Ensimmäiset reitit:

```text
GET /company-settings
PUT /company-settings
```

`GET /company-settings`:

- palauttaa nykyisen yrityksen asetukset
- käyttää local MVP:ssä väliaikaista `dev-company`-arvoa
- myöhemmin käyttää auth/tenant-kontekstia

`PUT /company-settings`:

- päivittää tai luo nykyisen yrityksen asetukset
- hyväksyy vain Company Settings MVP -kentät
- ei käsittele asiakaskohtaisia tuntihintoja
- ei käsittele laskutusasetuksia

HTTP-kerros:

- lukee pyynnön
- validoi inputin rajapinnassa kevyesti
- kutsuu application serviceä
- palauttaa turvallisen JSON-vastauksen

Liiketoimintalogiikka ei kuulu routeen.

## API-Client

Suunniteltu tiedosto:

```text
packages/api-client/src/companySettings.ts
```

Julkiset kutsut:

```ts
getCompanySettings(): Promise<CompanySettings>
updateCompanySettings(input: UpdateCompanySettingsRequest): Promise<CompanySettings>
```

API-client:

- käyttää ympäristön `fetch`-toteutusta tai injektoitua fake fetchiä testeissä
- ei riipu Reactista
- ei riipu Honoa tai backendin sisäisistä moduuleista
- ei tunne SQLitea

`packages/api-client/src/index.ts` päivitetään exporttaamaan Company Settings -API, kun koodi toteutetaan.

## Web UI

Suunniteltu rakenne:

```text
apps/web/src/companySettings/
  CompanySettingsPage.tsx
  CompanySettingsForm.tsx
  companySettingsFormModel.ts
```

UI-ajatus:

- `Oma yritys` aktivoidaan sivupalkin `Yritys`-osiosta
- näkymä käyttää samaa Eky Local -työpöytämäistä tyyliä kuin asiakaskortisto
- näkymä sisältää perustiedot ja oletustuntihinnan
- lomake pidetään rauhallisena ja selkeänä
- käyttäjälle näkyvät tekstit lisätään `apps/web/src/i18n/fi.ts`-tekstikarttaan

Ensimmäisessä UI:ssa ei tehdä:

- pankkitiliä
- verkkolaskuasetuksia
- ALV-asetuksia
- useita hinnastoja
- laskutusasetusten hallintaa

Web käyttää Company Settings -dataan vain `packages/api-client`-pakettia.

React-komponentit eivät tee raakaa `fetch`-kutsua.

React-komponentit eivät importtaa backendin sisäisiä moduuleja.

## Testit

### Backend

Tulevat backend-testit:

- domain/rules-testit
- `getCompanySettings` application service -testit
- `updateCompanySettings` application service -testit
- HTTP route -testit fake repositorylla tai testisovelluksen rajatulla setupilla
- SQLite adapter -testit vain erillisellä päätöksellä, jos tarvitaan integraatiotesti

Testattavia sääntöjä:

- yrityksen nimi normalisoidaan
- liian pitkät kentät hylätään
- `defaultHourlyRate` hyväksyy `null`-arvon, jos näin päätetään toteutusvaiheessa
- `0` on sallittu arvo, jos kenttä mallinnetaan nullable number -arvona
- repository port ei vuoda tietokantatyyppejä application serviceihin

### API-Client

Tulevat api-client-testit:

- `getCompanySettings` kutsuu `GET /company-settings`
- `updateCompanySettings` kutsuu `PUT /company-settings`
- response parser hyväksyy oikean Company Settings -muodon
- virheellinen response-muoto hylätään
- backend-virhe mapataan nykyisen `EkyApiError`-mallin mukaisesti

### Web

Tulevat web-testit:

- lomakemallin puhtaat testit, jos lomakemuunnoksia tulee
- `toCompanySettingsForm`
- `toUpdateCompanySettingsRequest`

Ei lisätä React Testing Libraryä tässä vaiheessa.

## Rajaukset

Ei tehdä tässä ensimmäisessä Company Settings MVP:ssä:

- `customer.hourlyRateOverride`
- laskutusta
- ALV-sääntöjä
- pankkitiliä
- verkkolaskuasetuksia
- useita hinnastoja
- työroolikohtaisia hintoja
- työntekijäkohtaisia hintoja
- tuoterekisteriä
- authia
- syncia
- cloud-profiilia

Ei lisätä:

- uusia riippuvuuksia
- Zodia
- React Hook Formia
- UI-kirjastoa
- `packages/ui`-pakettia
- query builderiä
- ORM:ää

## Toteutusjärjestys

Suositeltu toteutusjärjestys:

1. SQLite-migraatio `company_settings`-taululle.
2. Domain-tyyppi ja domain-säännöt.
3. Repository port.
4. SQLite adapter.
5. Application servicet.
6. HTTP routes.
7. Backend-testit.
8. API-client.
9. API-client-testit.
10. Web UI.
11. Web-lomakemallin testit, jos lomakemuunnoksia tulee.
12. Vasta seuraavassa vaiheessa `customer.hourlyRateOverride`.

Jokainen vaihe pidetään pienenä.

Jos kooditoteutus alkaa kasvaa, toteutus jaetaan erillisiin committeihin:

- backend + migraatio + testit
- api-client + testit
- web UI + testit

## Hyväksymiskriteerit Tulevalle Toteutukselle

Ensimmäinen Company Settings MVP on valmis vasta, kun:

- `company_settings`-taulu on migroitu paikalliseen SQLite-kantaan
- `GET /company-settings` palauttaa nykyisen yrityksen asetukset
- `PUT /company-settings` tallentaa asetukset
- `defaultHourlyRate` tallentuu suunnitellulla rahamallilla
- api-client käyttää uusia reittejä
- webin Oma yritys -näkymä toimii sivupalkista
- React-komponentit eivät tee raakaa `fetch`-kutsua
- SQL pysyy SQLite adapterissa
- domain ei tunne HTTP:tä, Honoa, SQLitea, better-sqlite3:tä tai Reactia
- `customer.hourlyRateOverride` ei ole mukana tässä vaiheessa
- `pnpm typecheck` menee läpi
- `pnpm test` menee läpi
- `pnpm --filter @eky/web build` menee läpi
- `pnpm --filter @eky/backend build` menee läpi

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/modules/company-settings.md`
- `docs/modules/customers.md`
- `docs/modules/invoicing.md`
- `docs/design/ui-principles.md`
