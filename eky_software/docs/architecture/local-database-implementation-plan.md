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

Ensimmäisen toteutuksen valinta:

- Node-yhteensopiva SQLite-ajuri: `better-sqlite3`
- suorat parametrisoidut SQL-lauseet backendin database/infrastructure-adapterikerroksessa

Query builderia ei oteta käyttöön ensimmäisessä toteutuksessa.

Kysely tai muu query builder voidaan lisätä myöhemmin erillisellä päätöksellä, jos suora SQL alkaa kasvattaa ylläpito- tai virheriskiä.

Ennen riippuvuuksien lisäämistä tarkistetaan:

- yhteensopivuus nykyisen Node-version kanssa
- yhteensopivuus nykyisen TypeScript-version kanssa
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

SQLite-ajuri ja SQL-kyselyt saavat näkyä vain backendin database/infrastructure adapter -kerroksessa.

Ne eivät saa näkyä:

- domainissa
- application service -rajapinnoissa
- repository port -tyypeissä
- `packages/*`-paketeissa
- React/UI-kerroksessa
- Hono HTTP route -kerroksen ulkopuolisena liiketoimintatotuutena

Application service käyttää repository porttia.

Repository port ei saa paljastaa SQLitea, SQL:ää tai tietokantakirjaston omia tyyppejä.

SQLite adapter toteuttaa repository portin ja saa käyttää tietokantakirjastoa.

## SQL-adapterisäännöt

SQL on adapterin sisäinen toteutusyksityiskohta.

SQL ei saa näkyä domainissa, application serviceissä, HTTP-routeissa, repository port -rajapinnoissa, `packages/*`-paketeissa tai `apps/web`-sovelluksessa.

Kaikki muuttuvat arvot annetaan parametrisoituina arvoina.

Käyttäjän syötettä ei saa koskaan yhdistää SQL-merkkijonoon.

Hyvä:

```ts
database.prepare('SELECT * FROM customers WHERE company_id = ?').all(companyId);
```

Huono:

```ts
database.prepare(`SELECT * FROM customers WHERE company_id = '${companyId}'`);
```

Repository port ei saa palauttaa tai vastaanottaa better-sqlite3-tyyppejä, SQL statementteja, tietokantarivejä sellaisenaan tai database connection -olioita.

Repository port käyttää vain domain- ja application-tason tyyppejä.

SQLite/PostgreSQL-adapteri vastaa `snake_case` <-> `camelCase` -muunnoksesta.

Pitkät tai monimutkaiset SQL-kyselyt kapseloidaan selkeästi nimettyihin repository-metodeihin.

Laajemmat cross-module JOIN-kyselyt kuuluvat myöhemmin reporting/read-model-kerrokseen.

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

Kevyt migration runner on toteutettu. Se ajaa migraatiot järjestyksessä ja
kirjaa `schema_migrations`-tauluun migraation nimen sekä ajoajan.

Migration runner ylläpitää lisäksi teknistä
`schema_migration_metadata`-taulua. Taulu ei kuulu liiketoimintamoduulille,
eikä sitä lisätä numeroituna business-migraationa: runner luo ja validoi sen
ennen pending-migraatioita, jotta myös sitä edeltävä historia voidaan sitoa
muuttumattomaan ketjuun.

Jokaisesta migraatiosta tallennetaan:

- migration name ja SQL-sisällön SHA-256
- järjestetyn migration chainin identity
- metadataversionumero
- metadata origin `applied` tai `legacy_baseline`
- tallennuksen tehneen release/buildin identity ja aikaleima

Uusi migraatio, sen `schema_migrations`-rivi ja metadata-rivi kirjoitetaan
samassa transaktiossa. Runner torjuu ennen pending-migraation SQL-kirjoitusta
muuttuneen historiallisen SQL:n, katkenneen ketjun, puuttuvan tai ylimääräisen
metadata-rivin, epäkelvon järjestyksen, saman migraationumeron uudelleenkäytön
sekä epäkelvon release-identiteetin.

Vanha tarkasti nykyisen migration manifestin prefixiä vastaava tietokanta
ankkuroidaan ensimmäisellä uudella käynnistyksellä `legacy_baseline`-tilaan.
Tallennettu release/build kertoo tällöin baseline-tarkistuksen tehneen buildin,
ei migraation alkuperäistä ajoversiota, jota vanhasta tietokannasta ei voida
luotettavasti päätellä. Prefixistä poikkeavaa vanhaa historiaa ei ankkuroida.

Historiallisia SQL-migraatioita ei muokata. Ketjun SHA-256-algoritmi on sama
versionoitu `Eky migration chain v1` -algoritmi, jota backup-manifesti käyttää.
Ensimmäinen oikean business-profiilin N -> N+1 -päivitys vaatii tämän lisäksi
validoidun pre-migration recovery pointin ja hyväksytyn first-start-polun.

Tämä checkpoint lisää vain teknisen migration metadata -taulun. Se ei muuta
liiketoimintatauluja eikä vanhoja SQL-migraatiotiedostoja.

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

SQL-kyselyt tehdään parametrisoidusti.

Käyttäjän syötettä ei yhdistetä SQL-merkkijonoihin.

Local backend kuuntelee edelleen oletuksena `127.0.0.1`-osoitteessa.

`dev-company` ei ole turvallisuusmalli.

Myöhemmin auth määrittää `companyId`-arvon luotettavasti backendissä.

Local/offline-käyttö ei oikeuta ohittamaan domain-sääntöjä.

## Mitä ei tehdä vielä

Tässä suunnitelmavaiheessa ei tehdä:

- DB-riippuvuuksien asennusta
- query builderin asennusta
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
- SQLite tai SQL eivät vuoda domainiin
- SQLite tai SQL eivät vuoda `packages/*`-paketteihin
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
