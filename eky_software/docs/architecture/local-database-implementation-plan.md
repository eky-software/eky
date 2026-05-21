# Local database implementation plan

Tämä dokumentti kuvaa ensimmäisen paikallisen tietokantatoteutuksen suunnitelman.

Tämä ei lisää riippuvuuksia eikä toteuta tietokantaa. Dokumentti valmistaa seuraavaa toteutusvaihetta, jossa ensimmäinen pysyvää dataa käyttävä Customer create/list local -slice voidaan toteuttaa hallitusti.

## Tavoite

Ensimmäisen local DB -toteutuksen tavoite on valmistella Ekyyn ensimmäinen pysyvää dataa käyttävä local-first-polku.

Ensimmäinen käyttötapaus on:

```text
Customer create/list local
```

Toteutuksen pitää todistaa:

- paikallinen SQLite-tallennus
- repository port + database adapter -malli
- backend route -> application service -> repository -virta
- domainin riippumattomuus tietokannasta
- tietokantariippuvuuksien rajaus backendin infrastructure/database-kerrokseen

## Alustava DB-pinoehdotus

Ensisijainen ehdotus:

- Kysely query builderiksi
- Node-yhteensopiva SQLite-ajuri
- ensisijainen SQLite-ajuriehdokas: `better-sqlite3`

Näitä ei asenneta tässä dokumenttityössä.

Ennen riippuvuuksien lisäämistä tarkistetaan:

- yhteensopivuus nykyisen Node-version kanssa
- yhteensopivuus nykyisen TypeScript-version kanssa
- yhteensopivuus valitun Kysely-version kanssa
- SQLite-ajurin ylläpitotilanne
- lisenssi
- transitiiviset riippuvuudet
- toimiiko yhdistelmä paikallisessa Windows/WSL-kehitysympäristössä

## Riippuvuuksien sijainti

Tietokantariippuvuudet lisätään myöhemmin vain:

```text
apps/backend/package.json
```

Niitä ei lisätä:

- root `package.json`-tiedostoon
- `packages/domain`-pakettiin
- muihin `packages/*`-paketteihin
- `apps/web`-sovellukseen

Tietokantariippuvuudet ovat backendin infrastructure/database-kerroksen yksityiskohta.

## Kerrosrajat

Kysely ja SQLite-ajuri saavat näkyä vain backendin database/infrastructure adapter -kerroksessa.

Ne eivät saa näkyä:

- domainissa
- application service -rajapinnoissa
- repository port -tyypeissä
- `packages/*`-paketeissa
- React/UI-kerroksessa
- Hono HTTP route -kerroksen ulkopuolisena liiketoimintatotuutena

Application service käyttää repository porttia.

Repository port ei saa paljastaa Kyselyä, SQLitea tai tietokantakirjaston omia tyyppejä.

SQLite adapter toteuttaa repository portin ja saa käyttää tietokantakirjastoa.

## Alustava database-kansiorakenne

Ensimmäinen tietokantarakenne voidaan sijoittaa backendin sisään:

```text
apps/backend/src/database/
  connection/
    createDatabaseConnection.ts

  migrations/
    001_create_customers.sql

  migration/
    runMigrations.ts
```

Tarkka rakenne voidaan säätää toteutuksessa, mutta periaate on:

- connection-koodi kuuluu database/infrastructure-alueelle
- SQL-migraatiot ovat jäljitettäviä tiedostoja
- migration runner pidetään kevyenä
- domain ja application services eivät tiedä migraatioiden toteutuksesta

Jos migration runner kasvattaa ensimmäistä toteutusta liikaa, sen voi rajata erilliseksi hyväksytyksi toteutusaskeleeksi.

## Migraatiomalli

Ensimmäisessä vaiheessa käytetään yksinkertaisia, jäljitettäviä SQL-migraatiotiedostoja.

Ei oteta vielä raskasta migraatioframeworkia.

Migraatiot ovat versionhallinnassa.

Paikallinen SQLite-tietokantatiedosto ei ole versionhallinnassa.

Myöhemmin voidaan toteuttaa kevyt migration runner, joka:

- ajaa migraatiot järjestyksessä
- pitää kirjaa ajetuista migraatioista
- käyttää esimerkiksi `schema_migrations`-taulua

Ensimmäinen mahdollinen migraatiotiedosto:

```text
apps/backend/src/database/migrations/001_create_customers.sql
```

## Ensimmäinen customer-taulu

Ensimmäinen customer-taulu pidetään tarkoituksella pienenä.

Alustava taulu:

```text
customers
  id
  company_id
  name
  created_at
  updated_at
```

Tämä ei ole lopullinen customer schema.

Ei vielä lisätä:

- `business_id`
- `email`
- `phone`
- `billing_address`
- `status`
- yhteyshenkilöitä
- asiakashistoriaa
- laskutukseen liittyviä snapshot-kenttiä

Kenttiä lisätään myöhemmin käyttötarpeen mukaan.

## Nimeämiskäytäntö

TypeScript käyttää `camelCase`-nimeämistä.

Tietokanta käyttää `snake_case`-nimeämistä.

Adapterikerros vastaa muunnoksesta.

Esimerkkejä:

```text
companyId <-> company_id
createdAt <-> created_at
updatedAt <-> updated_at
```

Domain- ja application service -kerroksissa käytetään TypeScriptin `camelCase`-nimiä.

SQL- ja tietokantakerroksessa käytetään `snake_case`-nimiä.

## SQLite-tiedoston sijainti

Ensimmäisessä dev-vaiheessa SQLite-tiedoston polku voidaan määritellä ympäristömuuttujalla:

```text
DATABASE_FILE_PATH
```

Jos `DATABASE_FILE_PATH` puuttuu, käytetään turvallista paikallista dev-oletusta backendin omassa ei-julkisessa data-hakemistossa.

Alustava dev-oletus voi olla esimerkiksi:

```text
apps/backend/data/eky-dev.sqlite
```

Tarkka polku päätetään toteutusvaiheessa.

SQLite-tiedoston sijainti ei saa olla web-julkisessa hakemistossa.

`DATABASE_FILE_PATH` voidaan lisätä myöhemmin `.env.example`-tiedostoon siinä toteutusaskeleessa, jossa tietokanta otetaan oikeasti käyttöön.

## Turvallisuus

SQLite-tiedosto ei saa mennä Gitiin.

SQLite-tiedostoa ei saa tarjoilla webistä.

SQL-kyselyt tehdään parametrisoidusti tai query builderilla.

Käyttäjän syötettä ei yhdistetä SQL-merkkijonoihin.

Local backend kuuntelee edelleen oletuksena `127.0.0.1`-osoitteessa.

`dev-company` ei ole turvallisuusmalli.

Myöhemmin auth määrittää `companyId`-arvon luotettavasti backendissä.

Local/offline-käyttö ei oikeuta ohittamaan domain-sääntöjä.

## Mitä ei tehdä vielä

Tässä suunnitelmavaiheessa ei tehdä:

- DB-riippuvuuksien asennusta
- Kyselyn asennusta
- SQLite-ajurin asennusta
- customer-slicen koodia
- migraatio-runneria
- React UI:ta
- authia
- syncia
- audit logia
- laskutusta
- `packages/utils`-kansiota
- `package.json`-muutoksia
- `pnpm-lock.yaml`-muutoksia

## Hyväksymiskriteerit tulevalle DB-toteutukselle

Tuleva DB-toteutus on hyväksyttävä vasta, kun:

- riippuvuudet ovat vain `apps/backend`-paketissa
- `pnpm typecheck` menee läpi
- backend build menee läpi
- Kysely/SQLite eivät vuoda domainiin
- Kysely/SQLite eivät vuoda `packages/*`-paketteihin
- repository port ei paljasta tietokantakirjaston tyyppejä
- SQLite-tiedosto ei päädy Gitiin
- ensimmäinen customers-migraatio on jäljitettävä
- customer-slice käyttää repository port + SQLite adapter -mallia
- `packages/utils`-kansiota ei synny

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/customer-vertical-slice-plan.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
