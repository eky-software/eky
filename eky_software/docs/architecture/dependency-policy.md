# Riippuvuuksien hallinta

Tämä dokumentti määrittelee Eky-projektin riippuvuussäännöt.

Tavoitteena on pitää järjestelmä turvallisena, ylläpidettävänä ja vaihdettavana.

## Periaate

Uutta kolmannen osapuolen kirjastoa ei lisätä ilman perustelua.

Eky-projektissa riippuvuuksia minimoidaan tietoisesti.

Uusi kirjasto lisätään vain, jos se ratkaisee todellisen ongelman, jota ei ole järkevää ratkaista projektin omalla selkeällä koodilla.

Jos ulkoinen kirjasto ei ole välttämätön, suositaan omaa pientä toteutusta.

Jokainen uusi riippuvuus lisää ylläpito-, tietoturva-, yhteensopivuus- ja pitkäikäisyysriskiä.

Riippuvuudet pyritään eristämään omien Eky-kerrosten taakse.

Jos kirjasto joudutaan myöhemmin vaihtamaan, muutoksen pitää osua rajattuun osaan järjestelmää.

## Sallitut alkuvaiheen riippuvuudet

Alustavasti hyväksyttyjä riippuvuuksia voivat olla:

- React
- Vite
- React Router
- TanStack Query
- React Hook Form
- Zod
- Firebase
- Vitest
- TypeScript
- Hono
- better-sqlite3
- ESLint
- Prettier

Tarkat versiot päätetään projektin teknisessä aloituksessa.

Hono on hyväksytty alustavasti vain backendin HTTP-adapteriksi dokumentin `docs/decisions/ADR-0005-backend-framework-selection.md` mukaisesti.

better-sqlite3 on hyväksytty vain `apps/backend`-sovelluksen database/infrastructure-adapterikerrokseen dokumenttien `docs/decisions/ADR-0006-local-database-and-query-layer.md` ja `docs/architecture/local-database-implementation-plan.md` mukaisesti.

Query builder tai ORM voidaan lisätä myöhemmin vain erillisellä päätöksellä, jos suora parametrisoitu SQL alkaa kasvattaa ylläpitoriskiä.

## Riippuvuuden lisäämisen tarkistus

Ennen uuden riippuvuuden lisäämistä vastaa:

1. Mitä ongelmaa kirjasto ratkaisee?
2. Onko ongelma infrastruktuuria vai Eky-projektin omaa liiketoimintalogiikkaa?
3. Voidaanko riippuvuus eristää oman Eky-kerroksen taakse?
4. Onko kirjasto aktiivisesti ylläpidetty?
5. Mikä lisenssi kirjastolla on?
6. Kuinka paljon transitiivisia riippuvuuksia se tuo?
7. Mitä tapahtuu, jos kirjasto pitää myöhemmin vaihtaa?
8. Onko olemassa turvallisempi tai yksinkertaisempi vaihtoehto?

Jos vastausta ei ole, riippuvuutta ei lisätä.

## Kerroskohtaiset säännöt

React kuuluu vain web-käyttöliittymään.

TanStack Query kuuluu vain frontendin datahakuihin ja hookeihin.

React Hook Form kuuluu lomakelogiikkaan.

Firebase kuuluu auth- tai infrastructure-kerroksen taakse.

Zod kuuluu validointikerrokseen.

SQLite-ajuri ja SQL-kyselyt kuuluvat vain backendin database/infrastructure-adapterikerrokseen.

Domain-kerros ei saa riippua Reactista, Firebasesta, TanStack Querystä, React Hook Formista, tietokannasta tai selain-API:sta.

## SQL-adapterisäännöt

Koska ensimmäinen paikallinen tietokantatoteutus käyttää suoraa parametrisoitua SQL:ää ilman query builderiä, SQL-kurin pitää olla eksplisiittinen.

SQL on adapterin sisäinen toteutusyksityiskohta.

SQL saa näkyä vain backendin infrastructure/database/repository-adapterikerroksessa.

SQL ei saa näkyä:

- domainissa
- application serviceissä
- HTTP-routeissa
- repository port -rajapinnoissa
- `packages/*`-paketeissa
- `apps/web`-sovelluksessa

Kaikki muuttuvat arvot annetaan parametrisoituina arvoina.

Hyvä:

```ts
database.prepare('SELECT * FROM customers WHERE company_id = ?').all(companyId);
```

Huono:

```ts
database.prepare(`SELECT * FROM customers WHERE company_id = '${companyId}'`);
```

Käyttäjän syötettä ei saa koskaan yhdistää SQL-merkkijonoon.

Repository port ei saa palauttaa tai vastaanottaa:

- better-sqlite3-tyyppejä
- SQL statementteja
- tietokantarivejä sellaisenaan
- database connection -olioita

Repository port saa käyttää vain domain- ja application-tason tyyppejä.

Tietokanta-adapteri vastaa `snake_case` <-> `camelCase` -muunnoksesta.

Pitkät tai monimutkaiset SQL-kyselyt kapseloidaan selkeästi nimettyihin repository-metodeihin.

Hyvä:

```text
customerRepository.listCustomersWithOpenInvoiceSummary(companyId)
```

Huono:

```text
application service kokoaa itse JOIN-kyselyn useasta taulusta
```

Laajemmat cross-module JOIN-kyselyt kuuluvat myöhemmin reporting/read-model-kerrokseen, eivät satunnaisesti customers-, invoicing- tai work-orders-moduulin sisään.

## API-client

Frontend ei kutsu backend API:a suoraan komponenteista, jos api-client-kerros on olemassa.

API-client piilottaa backend-reitit ja yhteiset virheenkäsittelyt.

## Auth-wrapper

Firebase Auth eristetään oman auth-kerroksen taakse.

Muu sovellus ei saa olla täynnä suoria Firebase-kutsuja.

## Lockfile

Lockfile commitoidaan versionhallintaan.

Esimerkiksi:

- `pnpm-lock.yaml`
- `package-lock.json`
- `yarn.lock`

Tuotantoon ei asenneta riippuvuuksia ilman lukittua versiota.

## Päivitykset

Patch- ja minor-päivitykset tehdään hallitusti.

Major-päivitykset vaativat erillisen tarkistuksen.

Tietoturvapäivitykset käsitellään nopeasti, mutta testaten.

## Supply chain -riskit

NPM-ekosysteemissä riippuvuudet voivat tuoda supply chain -riskejä.

Vältä pieniä turhia kirjastoja yksinkertaisiin tehtäviin.

Älä lisää kirjastoa vain yhden pienen apufunktion takia.

Tarkista audit-raportit säännöllisesti.

## Sisäiset paketit

Ekyssä voidaan luoda sisäisiä paketteja, kuten:

- `packages/domain`
- `packages/validation`
- `packages/api-client`
- `packages/auth`
- `packages/permissions`
- `packages/ui`

Sisäinen paketti ei tarkoita automaattisesti julkista npm-pakettia.

Aluksi paketit pidetään monorepon sisäisinä.

## Kiellettyä

Älä tee:

- domain-kerroksesta riippuvaista UI-kirjastosta
- Firebase-kutsuja satunnaisiin komponentteihin
- Axios-tyyppistä riippuvuutta ilman perustelua, jos fetch riittää
- yleistä riippuvuuksien lisäämistä varmuuden vuoksi
- uutta isoa UI-frameworkia ilman päätöstä

## Dokumentointi

Jos uusi riippuvuus lisätään, kirjaa perustelu `docs/architecture/tech-decisions.md`-tiedostoon tai erilliseen ADR:ään, jos päätös on merkittävä.
