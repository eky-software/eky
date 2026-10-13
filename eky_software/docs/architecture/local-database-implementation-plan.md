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

Edellä kuvattu metadata-checkpoint lisää vain teknisen migration metadata -taulun. Se ei muuta
liiketoimintatauluja eikä vanhoja SQL-migraatiotiedostoja.

### Varmuuskopion schema-tarkistin

K-paketin yhteisen tarkistimen omistaa `database/migration`.
`inspectAttestedMigrationHistory` ottaa ennen relaatiolukua käyttöön
`trusted_schema=OFF`- ja `query_only=ON`-suojat. Se tarkistaa ensin rajatusta
`main.sqlite_schema`-luettelosta teknisten historiataulujen määrittelyt,
sitten rajatut historiarivit ja lopuksi koko hyväksytyn prefixin rakenteen.
Tarkistuksen lukutransaktio sitoo nämä havainnot samaan tilaan. Kirjoittavan
kutsujan aiempi `query_only`-tila palautetaan; itse tarkistus ei kirjoita
kantaan. Tämä ei vielä yksin sido myöhempää kopiointia tai avausta samaan
tiedostosisältöön.

`inspectMigrationStartupState` käyttää samaa tarkistinta ja säilyttää
käynnistyksen nykyisen tulos- ja virhesopimuksen. Tyhjää kantaa ei päätellä
pelkästä taulujen puuttumisesta: myös ylimääräinen view hylätään. Metadatallinen
prefix voi edelleen sisältää pending-migraatioita; metadatatonta
restore-poikkeusta käytetään vain hyväksyttyyn 038-ankkuriin.

`runMigrations` tarkistaa saman kirjoittavan yhteyden scheman ennen teknisten
historiataulujen valmistelua tai migraation ensimmäistä kirjoitusta ja
uudelleen ennen onnistunutta paluuta. Sen sisäinen `runnerBaseline` säilyttää
aiemman täsmällisen metadataless-prefixin ankkuroinnin. Se ei kuulu
`MigrationStartupPolicy`-rajapintaan eikä anna backupille uutta palautuslupaa.
Vertailu ennen kirjoituksia käyttää vain jo ajettua prefixiä: rikkinäistä
pending-SQL:ää ei ajeta etukäteen referenssin muodostamiseksi.

Legacy-baseline ja kukin business-migraatio säilyttävät nykyiset erilliset
transaktionsa. Loppuattestoinnin virhe on `MIGRATION_EXECUTION_FAILED`, jonka
`completedMigrationCount` kertoo todella valmistuneet migraatiot ja
`sideEffectState` pysyy `unknown`-tilassa. Virhe ei kumoa jo commitoitua
historiaa eikä muutu nollan migraation virheeksi. Testien kirjoitusvirheet
injektoidaan rajatusti statementin suoritukseen muuttamatta hyväksyttyä
schemaa; niiden pitää todistaa myös migraation SQL:n ehtineen suoritukseen.

`openAttestedMigrationDatabase` on backendin käynnistyksen avausportti
K-työpuussa. Aiempi readonly-esitarkistuksen hot-journal-regressio käsitellään
alla kuvatulla erikseen hyväksytyllä oman paikallisen työtilan
kaatumispalautuksella. Tuotu backup ei saa tätä poikkeusta.
K:n koko integraatiohyväksyntä on edelleen avoin
[M1:n K-osiossa](release-0.3.0-m1-preparation-plan.md#kn-kokonaiskytkennän-tarkistus);
avausportin kohdenäyttö ei yksin anna julkaisuhyväksyntää.
Polku ratkaistaan kerran nykyisellä config-/ympäristö-/oletuspolitiikalla.
Olemassa oleva tavallinen kanoninen yhden linkin tiedosto tarkistetaan
readonly-yhteydellä ennen kirjoittavaa avausta. Readonly-yhteys suljetaan
ensin; kirjoittava avaus ei saa luoda uudelleen sillä välillä kadonnutta
tiedostoa. Uusi puuttuva kanta sekä tyhjä schema vaativat erilliset kutsujan
luvat. Tarkistin ei päättele lupia epäonnistuneesta avaamisesta.

Myös palautettava kirjoittava yhteys attestoidaan ennen palvelurekisteröintiä
ja käynnistyscallbackia. Virhe sulkee yhteyden; sulkemisen lisävirhe ei
korvaa alkuperäistä poikkeusta. Portti ei aja pending-migraatioita eikä luo
legacy-metadataa. Suora backend ilman `beforeMigrations`-porttia säilyttää
runnerin sisäisen baseline-politiikan. Portillinen käynnistys käyttää
entistä `MigrationStartupPolicy`-valintaa, eikä `runnerBaseline` kuulu siihen.
Callbackin jälkeinen runner-tarkistus ja nykyiset transaktiorajat säilyvät.
Palautusgaten aikana rekisteröity aktiiviprofiilin tai snapshot-katalogin
schema-reader käyttää samaa hyväksyttyä käynnistyspolicya. Sen
`restoreCompatible`-poikkeus palautetaan tiukaksi gaten `finally`-rajassa;
sitä ei säilytetä tavalliseen business-ajoon. Sama kelvollinen metadatatonta
038-ankkuria vastaava schema hyväksytään tämän valtuuden aikana ja hylätään
sen päätyttyä, ellei normaali runner ole jo ankkuroinut historiaa.
Tämä ei hyväksy eteenpäin vieviä migraatioita C:n binaaripalautuksen gaten
sisällä. [C:n kohdenäyttö ja avoimet rajat](release-0.3.0-m1-preparation-plan.md#v2bc-cn-alkuperäisketjun-terminal)
ovat erillisiä koko palautusketjun hyväksynnästä.
Manifesti-/historiahylkäys säilyy nykyisenä migraatiovirheenä, ei muutu
pelkäksi käyttöjärjestelmän avausvirheeksi. K3:n tarkempi syyketju on avoin.

Tämä backendin käynnistysportti ei yksin toteuta candidate-kopioinnin
esitarkistusta tai kopiointi-/käyttösidontaa. Candidate-kuluttajan erillinen,
hyväksytty työpuukytkentä on nyt kuvattu
[M1:n V2i-kohdassa](release-0.3.0-m1-preparation-plan.md#v2i-tarkistuskopion-tuotantokuluttaja):
SQLite tarkistaa vain operaation omistaman kertakopion, ja migraatiokopio
sidotaan tarkistettuihin alkuperäisiin tavuihin ennen kirjoittavaa avausta.
K3:n koko turvallisen syyn raportointiketju ja paketoitu hyväksyntä ovat
edelleen kesken. Kytkennät eivät lupaa suojaa samalla
käyttöjärjestelmätunnuksella toimivalta samanaikaiselta haittaohjelmalta.

**Oman paikallisen työtilan kaatumispalautus:** erikseen hyväksytty
`recoverOwnedLocalDatabase` antaa vain mainin valitseman, identiteetiltään
saman työtilan ja nykyisen elävän prosessivarauksen tietokannalle SQLiten
natiivin rollback-journal-palautuksen ennen readonly-esitarkistusta.
SQLite itse käsittelee journalin; omaa parseria, sivutiedostojen poistoa,
business-SQL:ää tai migraatioita ei tehdä tässä vaiheessa. Palautuksen
jälkeen sama schema/history-portti vaaditaan ennen sisältölukua.
Epävarma omistajuus pysäyttää, eikä tuotu varmuuskopio tai restore-staging
saa tätä poikkeusta. Palautus voi muuttaa journalia ja kantaa myös myöhemmin
hylättävässä käynnistyksessä, joten vaikutusta ei kuvata olemattomaksi.
[Omistava V2u-sopimus](release-0.3.0-m1-preparation-plan.md#v2u-omistetun-paikallisen-työtilan-kaatumispalautus)
erottaa kohdenäytön vielä avoimista packaged-/Linux-/integraatioporteista.
Jäljellä olevat portit omistaa
[M1:n K-osio](release-0.3.0-m1-preparation-plan.md#k-paketin-valmistelu-ja-hyväksyntärajat).

Odotusrakenne muodostetaan sovelluksen luotetuista migraatiotavuista ja
samasta teknisten taulujen DDL:stä muistissa. Tuodun kannan SQL ei muodosta
odotusta. Vertailu kattaa `type`, `name`, `tbl_name` ja SQLiten tallentaman
`sql`-arvon täsmälleen; myös autoindeksit kuuluvat joukkoon. Fyysistä
`rootpage`-arvoa ei verrata. Muuttunut tai ylimääräinen objekti hylätään
turvallisella `PROFILE_SCHEMA_UNSUPPORTED`-syyllä. Historiarivit rajataan
ennen JavaScriptiin materialisointia, eikä historiataulun nimen olemassaolo
yksin anna oikeutta kysellä sen sisältöä.

`inspectSqliteProfileDatabase` käyttää tarkistinta ennen eheys-, FK- ja
identity-lukua. Nykyisen täydellisen snapshotin sekä metadatallisen prefixin
ja erikseen hyväksytyn metadatattoman 038-palautuksen ehdot säilyvät.
Historiatestien tekninen DDL on jäädytetty aiempien julkaisujen lähteestä,
ei muodostettu uudella odotusrakenteen helperillä.

Tarkistuksen natiivi `SQLITE_NOMEM` säilytetään schema- ja historiakyselyjen
catch-rajojen yli ja luokitellaan tarkistusoperaatiossa nykyiseksi
`PROFILE_INSPECTION_LIMIT_EXCEEDED`-syyksi. Sama sääntö koskee tarkistimen
eheys-, FK- ja identiteettilukua sekä eristetyn ajurin rajattuja avausvirheitä.
Luokitus vaatii poikkeuksen täsmällisen koodin; virheviesti ei riitä.
Tämä kertoo allokaation hylkäyksestä, ei yksin muistikatosta tai sen
taustalla olevan resurssin loppumisen syystä. Alkuperäinen poikkeus säilyy
vain sisäisenä syynä; statuskanava julkaisee sallitun turvallisen koodin.
Myöhempi sulkemisvirhe ei korvaa tarkistuksen ensisyytä. Tarkistuksen ja
sulkemisen epäonnistuminen eivät tuota onnistunutta sisältökuittia.
[Luokittelun kohdenäyttö ja rajat](release-0.3.0-m1-preparation-plan.md#natiivin-muistivirheen-luokittelukorjaus)
ovat erillisiä oikean prosessin resurssi- ja palautustodistuksista.

**Integraatio kesken:** kaikkien kirjoittavien avausten, käynnistyksen ja
candidate-/palautuspolkujen kytkentä sekä eristetty resurssiraja tehdään
[K:n omistavan toteutussopimuksen](release-0.3.0-m1-preparation-plan.md#kn-toteutussopimus-rakenne-ennen-sisältöä)
mukaan. Yhden tarkistimen kohdenäyttö ei sulje K1/K2:ta eikä korvaa
paketoidun palautuksen hyväksyntää.

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
