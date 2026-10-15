# Backend app

Tämä sovellus sisältää Eky-järjestelmän paikallisen backendin.

Hono on ohut HTTP-adapteri Customers-, Company Settings-, Invoicing-,
Activity- ja Diagnostics-kokonaisuuksille sekä `/health`-terveystarkistukselle.
Local-session, yrityskonteksti ja profiilinsuojaus noudattavat
[runtime-luottamussopimusta](../../docs/architecture/local-runtime-trust-and-authorization-plan.md).

Vastuut:

- vastaanottaa API-kutsut
- vahvistaa paikallisen session luottamus ja actor-konteksti
- tarkistaa käyttöoikeudet ja yritysrajaus
- validoida syöte
- kutsua application service -kerrosta
- käyttää domain-logiikkaa
- käyttää repository-adaptereita
- kirjata omistavan moduulin audit-tapahtumat ja turvalliset tekniset lokit

Backend on luotettu kerros. Frontend ei saa ohittaa backend- tai service-kerrosta.

## Vaatimukset

Backend tarvitsee Node.js-version, joka tukee `--env-file-if-exists`-lippua.

Projektin [package.json](../../package.json) omistaa tuetun Node-version
(`>=24 <25`). Yksittäisen adapterin vähimmäisversio ei korvaa projektin
runtime- ja native-yhteensopivuusvaatimuksia.

## Paikallinen ympäristö

Kopioi projektin juuressa oleva `.env.example` paikalliseksi `.env`-tiedostoksi:

```bash
cp .env.example .env
```

Windows PowerShellissä:

```powershell
Copy-Item .env.example .env
```

`.env` on paikallinen tiedosto eikä sitä commitoida Gitiin.

Nykyiset paikalliset asetukset:

```env
HOST=127.0.0.1
PORT=3000
DATABASE_FILE_PATH=data/eky-dev.sqlite
```

`HOST` määrittää, mihin osoitteeseen paikallinen backend sitoutuu. Oletus on turvallisesti `127.0.0.1`.

`PORT` määrittää paikallisen backendin HTTP-portin. Oletus on `3000`.

`DATABASE_FILE_PATH` määrittää paikallisen SQLite-tietokantatiedoston polun backend-paketin ajokansiosta katsottuna. Oletus on `data/eky-dev.sqlite`, eikä tätä tiedostoa commitoida Gitiin.

Tämä ympäristömuuttuja kuuluu vain backend/browser-kehitykseen. Paketoitu
desktop ei peri sitä: Electron main antaa backendille absoluuttisen,
`userData`-juuresta johdetun tietokantapolun käynnistysviestissä.

## Runtime-profiilit

Eri ajotilat eivät saa käyttää samaa SQLite-tiedostoa:

- backend/browser-kehitys käyttää oletuksena
  `apps/backend/data/eky-dev.sqlite`-tiedostoa tai kehittäjän `.env`-polkua
- Playwright/system E2E luo jokaiselle ajolle oman private-runtimen ja
  `eky-e2e.sqlite`-tiedoston
- packaged smoke käyttää vain validoidulla `--desktop-smoke`-kytkimellä ja
  tokenilla muodostettua canonicalisoitua käyttöjärjestelmän temp-juurta
- normaali paketoitu desktop käyttää Electron mainin validoidusta aktiivisen
  workspacen juuresta johtamaa tietokantapolkua;
  [workspace-sopimus](../../docs/architecture/local-company-workspace-plan.md)
  omistaa myös vanhan yhden profiilin polun adoption

Installer-payloadiin tai package-stagingiin ei saa sisällyttää mitään näistä
tietokannoista. Normaalia desktop-profiilia ei saa johtaa `.env`- tai
`DATABASE_FILE_PATH`-fallbackista.

## Komennot

Aja komennot projektin juuresta `eky_software/`.

Tyyppitarkistus:

```bash
pnpm typecheck
```

Backendin build:

```bash
pnpm --filter @eky/backend build
```

Backendin käynnistys:

```bash
pnpm --filter @eky/backend start
```

Build ja käynnistys samalla komennolla:

```bash
pnpm --filter @eky/backend dev
```

## Health endpoint

Kun backend on käynnissä, tarkista health endpoint:

```bash
curl http://127.0.0.1:3000/health
```

Vastaus:

```json
{ "status": "ok" }
```

Jos vaihdat portin `.env`-tiedostossa, käytä curl-komennossa samaa porttia.

Tällä hetkellä `/health` kertoo, että backend käynnistyi onnistuneesti. Koska sovellus alustaa tietokannan käynnistyksessä, `/health` riippuu käytännössä myös paikallisen DB-alustuksen ja migraatioiden onnistumisesta.

Myöhemmin voidaan erottaa:

- `/health` = prosessi elossa
- `/ready` = tietokanta ja migraatiot kunnossa

## Migraatiot

Nykyinen migration runner lukee versionoidut SQL-migraatiot polusta:

```text
src/database/migrations
```

Backendin tuotantodeploy ja desktop-paketointi sisältävät nämä migraatiot.
`schema_migrations` säilyttää nimen ja ajoajan. Sen rinnalla
`schema_migration_metadata` sitoo SQL-checksummin, ketjuidentiteetin,
applied/legacy-baseline-alkuperän ja release/build-tiedon. Historiallisia
SQL-tiedostoja ei muokata. Schema/history-portti edeltää sisältöä ja
kirjoitettavaa avausta; callerin tarkat politiikat omistaa
[tietokantasopimus](../../docs/architecture/local-database-implementation-plan.md#varmuuskopion-schema-tarkistin).
Päivityksen pre-migration-palautuspiste ja first-start-hyväksyntä ovat tästä
erillisiä pakollisia portteja, eivät pelkän migraatiometadatan seuraus.

## Rajaukset

Hono kuuluu vain backendin HTTP-adapterikerrokseen.

Hono ei saa vuotaa:

- domain-kerrokseen
- application service -logiikkaan
- repository-rajapintoihin
- `packages/*`-paketteihin

Backend sisältää nykyisin Customers-, Company Settings-, Invoicing-, Activity-
ja Diagnostics-kokonaisuudet sekä desktopin luotetun local-session- ja
profiilinsuojauksen rajapinnat. Backend ei silti omista React-käyttöliittymää,
Electron-salaisuustallennusta tai tulevaa pilvisynkronointia.
