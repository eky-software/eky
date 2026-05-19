# Riippuvuuksien hallinta

Tämä dokumentti määrittelee Eky-projektin riippuvuussäännöt.

Tavoitteena on pitää järjestelmä turvallisena, ylläpidettävänä ja vaihdettavana.

## Periaate

Uutta kolmannen osapuolen kirjastoa ei lisätä ilman perustelua.

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
- ESLint
- Prettier

Tarkat versiot päätetään projektin teknisessä aloituksessa.

Hono on hyväksytty alustavasti vain backendin HTTP-adapteriksi dokumentin `docs/decisions/ADR-0005-backend-framework-selection.md` mukaisesti.

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

Domain-kerros ei saa riippua Reactista, Firebasesta, TanStack Querystä, React Hook Formista, tietokannasta tai selain-API:sta.

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
