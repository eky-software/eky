# Local database implementation plan

Tämä dokumentti omistaa paikallisen tietokannan kerros-, SQL-, migraatio- ja
[schema-tarkistussopimuksen](#varmuuskopion-schema-tarkistin).
Ensimmäisen customer-slicen tavoite, esimerkkirakenne ja alkuperäiset
toteutusrajaukset säilyvät historiallisena taustana, eivät nykyisen
backendin toimintorajoina. Nykyiset moduulit ovat
[integraatiomatriisissa](module-integration-matrix.md).
Dokumentointi ei hyväksy uusia riippuvuuksia tai muuta arkkitehtuuria.

## Ensimmäisen vaiheen tavoite

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

## Valittu paikallinen DB-pino

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

Tietokantariippuvuuksien omistava sovelluspaketti on:

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

K:n schema-, käynnistys- ja tarkistuskytkentä on hyväksytty. Tämä osio omistaa
sen tietokantasopimuksen; [M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa integraation tilan ja päivätyn näytön. Yksittäisen vanhan checkpointin
avoin portti ei kumoa hyväksyntää, eikä hyväksyntä muuta aiempaa ensivirhettä
läpäisyksi. Myöhemmät muutokset tarvitsevat edelleen omat nykyisen revision
testi-, palautus-, katselmus- ja PR/main-porttinsa.

#### Rakenne ennen sisältöä

Backendin `database/migration` omistaa yhden yhteisen tarkistimen.
Odotusrakenne muodostetaan tyhjään muistissa olevaan tietokantaan sovelluksen
muuttumattomasta SQL-manifestista ja `migrationMetadata.ts`:n omistamasta
teknisestä DDL:stä. Tuodun kannan SQL:ää ei suoriteta referenssiksi eikä
migraatioita kopioida käsin toiseen DDL-luetteloon. Referenssi on hetkellinen
tekninen apu, ei uusi varmuuskopioitava business-artifacti. Uutta SQL-parseria,
riippuvuutta, business-migraatiota tai backup-formaattia ei tarvita.

Tarkistus etenee samassa lukutransaktiossa:

1. Validoi omistettu polku, juuren identiteetti sekä nykyiset type/link-rajat.
   Avaa SQLite vain lukuun ja aseta `trusted_schema=OFF` sekä `query_only=ON`
   ennen relaatiokyselyitä. Tuotuja SQL-funktioita tai laajennuksia ei
   rekisteröidä. Ainoa tätä edeltävä natiivi palautuspoikkeus on jäljempänä
   nimetty oman paikallisen työtilan kaatumispalautus.
2. Lue rajattu `main.sqlite_schema`-inventaario ja todenna ledgerin sekä
   mahdollisen metadata-taulun todellinen rakenne ennen niiden rivejä.
   Rivi- ja merkkijonobudjetit johdetaan luotettujen odotusrakenteiden
   enimmäiskoosta. Ylimääräinen rivi tai liian suuri määrittely hylätään
   ennen materialisointia; rajaamatonta `.all()`-lukua ei käytetä.
3. Lue rajatut historiarivit ja todenna manifesti, prefix ja kutsujan
   valitsema politiikka. Backup ei valitse omaa hyväksyntäpolitiikkaansa.
4. Vertaa koko objektijoukosta täsmälleen `type`, `name`, `tbl_name` ja
   SQLiten tallentama `sql`. Fyysinen `rootpage` jätetään pois.
   Autoindeksin `sql=null` kelpaa vain vastaavan luotetun objektin kohdalla.
   `sqlite_*` ei ole ohituslista. Ylimääräinen tai puuttuva table, index,
   trigger tai view sekä muuttunut SQL hylätään. Nykyinen schema ei tarvitse
   view-/virtual-table-poikkeusta. Litteraaleja, ehtoja, lainausmerkkejä tai
   välilyöntejä ei normalisoida arvaamalla; historiallinen vastine vaatii
   luotettuun julkaisuun sidotun erillisen todennuksen.
5. Vasta tämän jälkeen suorita integrity-, foreign-key-, identity-,
   moduulisisältö- ja artifact-tarkistukset. FK-virheestä riittää ensimmäinen
   rajattu havainto. Katalogin rivit ja tekstit rajataan ennen materialisointia;
   nykyiset PDF-tavu-, koko- ja hash-tarkistukset säilyvät.

`inspectAttestedMigrationHistory` ei kirjoita kantaan ja palauttaa kirjoittavan
kutsujan aiemman `query_only`-tilan. `trusted_schema=OFF`, readonly, salaus,
checksum, ledger ja integrity eivät korvaa objektivertailua tai
sisältövalidointia. Kaikkien triggerien poistaminen hävittäisi myös hyväksytyt
ALV-, maksu-, numerointi- ja revisioguardit. Tyhjää kantaa ei päätellä vain
taulujen puuttumisesta: esimerkiksi ylimääräinen view hylätään.

#### Kutsujan historiapolitiikka ja avausvaltuus

Nykyinen manifesti on 001-039. Historiallisten SQL-tiedostojen muuttaminen on
kielletty. Historiatestien tekninen DDL jäädytetään aiemman julkaisun
lähteestä, ei tuoteta uudella referenssihelperillä.

| Kutsuja | Vaadittu politiikka ja erillinen ehto |
| --- | --- |
| `runMigrations` ja suora backend ilman `beforeMigrations`-porttia | Sisäinen `runnerBaseline` voi ankkuroida täsmällisen metadataless-prefixin. Se ei kuulu `MigrationStartupPolicy`-rajapintaan eikä anna backupille palautuslupaa. |
| `inspectMigrationStartupState` | Vahvistettu metadallinen prefix voi sisältää pending-migraatioita myös `exactCurrentManifest`-nimellä. Nimi ei yksin tarkoita nolla-pending-ehtoa. |
| Normaali business-runtime | Migraatioiden jälkeinen nykytilatarkistus ja nolla pending-migraatiota ennen business-readinessia. |
| Muodostettu tavallinen snapshot | Main sitoo `exactCurrentManifest`-valinnan operaatiotietueeseen; muodostajan snapshot vaatii täyden nykyketjun. |
| Nimenomaisesti historiallinen muodostettu snapshot | Mainin eksplisiittinen `compatibleHistoricalPrefix`; ei oletusarvoa prosessirajalla. |
| Tuotu snapshot ja historiallinen palautus | `restoreCompatible`; metadataa vailla hyväksytään vain nimetty 038-anchor. Olemassa olevan metadatan virhe ei koskaan vaihda tähän poikkeukseen. |
| Aktiiviprofiilin pre-migration-eheystarkistus / business rollback | Sama tarkistettu historia ja callerin odottama chain; pending ei yksin hylkää eikä tarkistus avaa business-runtimea. Historiallinen readiness säilyttää oman hyväksytyn pending-ehtonsa. |
| Uusi tai tyhjä kanta | Vain nykyinen erikseen valtuutettu luonti-/alustuspolku. Ei valmis tuotu backup eikä epäonnistuneesta avaamisesta päätelty lupa. |

`runMigrations` attestoi saman kirjoittavan yhteyden ennen historiataulujen
valmistelua tai ensimmäistä migraatiokirjoitusta sekä ennen onnistunutta
paluuta. Referenssi ennen kirjoituksia käyttää vain jo ajettua prefixiä;
rikkinäistä pending-SQL:ää ei ajeta referenssiksi.

`openAttestedMigrationDatabase` ratkaisee polun kerran nykyisellä
config-/ympäristö-/oletuspolitiikalla. Olemassa olevan kanonisen yhden linkin
tiedoston readonly-esitarkistus ja sen sulku edeltävät kirjoittavaa avausta.
`fileMustExist` estää sillä välillä kadonneen tiedoston luomisen uudelleen.
Myös palautettava kirjoittava yhteys attestoidaan ennen palvelurekisteröintiä
ja käynnistyscallbackia. Portti ei itse aja pending-migraatioita tai luo
legacy-metadataa. Callbackin jälkeinen runner-tarkistus säilyy.

Portillinen restore-/rollback-käynnistys käyttää nykyistä
`MigrationStartupPolicy`-valintaa. Gaten aikana koottu aktiiviprofiilin tai
snapshot-katalogin schema-reader käyttää samaa politiikkaa.
`restoreCompatible` palautetaan tiukaksi gaten `finally`-rajassa; sitä ei
jätetä business-ajoon. Metadatatonta 038-schemaa ei hyväksytä gaten jälkeen,
ellei runner ole jo ankkuroinut historiaa. C:n binaaripalautuksen gate ei
salli eteenpäin vieviä migraatioita. C:n activation-, journal- ja
binary-rollback-valtuudet omistaa
[installer-/päivityssopimus](windows-installer-and-update-plan.md).

#### Candidate ja tarkistuksen käyttösidonta

`validatePublished`, `validateHistoricalPublished` ja
`validateAndMaterialize` käyttävät samaa avausporttia ilman uuden tai tyhjän
kannan lupaa. Vain historiallinen tarkistus käyttää `restoreCompatible`-
politiikkaa; mikään näistä ei saa hot-journal-palautusvaltuutta. Nykyiset
pending-, identity-, integrity-, FK- ja PDF-katalogitarkistukset säilyvät.
Pysyvä readonly-yhteys ei korvaa omistettua natiivia sulkemista: ehjän WAL-
kannan sivutiedostoja ei poisteta omalla uudella poistologiikalla.

Candidate tarkistaa vain operaation omistaman erillisen kertakopion.
Migraatiokopio sidotaan tarkistettuihin alkuperäisiin tavuihin ennen
kirjoittavaa avausta. Main luo tarkistuskansion sidotun prosessisukupolven
varauksen valmistelucallbackissa; callbackin toteutuminen on onnistumisehto.
Readonly-yhteys lukee kopion scheman/historyn, identiteetin, eheyden ja
katalogin samassa lukukuvassa. Sulun jälkeen kopion ja alkuperäisen
identiteetti, koko ja tiiviste varmennetaan uudelleen. Alkuperäisen juuren
tiukka sisältöjoukko ei väljenny.

Sisäinen suljettu kuitti sitoo operationin, generationin, valitun policyn,
migration-chainin, DB:n todellisen koon/hash-tiedon ja artifact-katalogin
sisältösidonnan. Prepare-pyynnön policy on pakollinen ja tunnettu; runner ja
main vaativat kuitilta saman valinnan. Profiili-/hash-tiedot eivät kuulu
Diagnosticsiin tai julkiseen lokiin. Omistettu staging pysyy varattuna
kopiointiin tai activation-luovutukseen asti. Vanhentunut generation,
polkuidentiteetti, kuitti tai muuttuneet tavut hylätään. Jokainen kirjoittava
avaus attestoi oman yhteytensä ennen business-lukua tai migraation DDL/DML:ää;
migraation jälkeen tarkistetaan nykyinen schema ja sisältö uudelleen.
Aktiivisen WAL-kannan snapshot muodostetaan SQLite backup -API:lla, ei
pelkän päätiedoston hashilla.

Koko schema/history todistetaan ennen julkaistun työtilan identity-, integrity-
tai FK-lukua. Epäluotettu schema, muuttunut/vajaa historia tai korruptio
keskeyttää koko inventaarion ennen registry-muutosta. Identityä tai prefixiä
ei arvata. Todennetun scheman sisältövirhe säilyttää `invalidHistory`-
luokituksen. Registry-slotin valinnan ja recovery-valtuuden omistaa
[workspace-suunnitelma](local-company-workspace-plan.md), ei tämä tarkistin.

#### Omistetun paikallisen työtilan kaatumispalautus

`recoverOwnedLocalDatabase` sallii SQLiten natiivin rollbackin ennen
readonly-schema-porttia vain yksityisen elävän omistajuusportin kautta.
Main valitsee normaalin rekisteröidyn työtilan tai strictin inventaarion
`ready`-entryn juuren ja sitoo sen tiedostojärjestelmäidentiteetin. Child
johtaa tarkan DB-polun samasta profiililayoutista ja tarkistaa nykyisen
prosessivarauksen, käynnistyssukupolven ja peruutuksen. Pelkkä path,
operaationimi tai DTO ei anna valtaa; renderer tai backup ei toimita sitä.

Poikkeus koskee vain normaalia local-käynnistystä ja julkaistun paikallisen
työtilan inventaariota. Adoption, migration-activation, restore-/rollback-
validation, import/replacement ja snapshot eivät saa poikkeusta.
DB ja journal ovat kanonisia yhden linkin tiedostoja. Ristiriitainen WAL/SHM,
muuttunut identiteetti, katkennut varaus tai peruutus estää etenemisen.
Vain `trusted_schema=OFF`, `query_only=ON` ja lukevan
`main.schema_version`-pragman alkuperäinen pager-käsittely sallitaan.
SQLite itse palauttaa journalin; sovellus ei jäsennä, poista tai muokkaa sitä.

Yhteys suljetaan ja koko schema/history-portti tehdään ennen identity-,
business- tai migraatiokyselyitä. Palautus voi muuttaa DB:tä ja journalia,
vaikka myöhempi portti hylkää; vaikutusta ei merkitä olemattomaksi.
Epävarma omistajuus ei käynnistä omaa tiedostokorjausta tai poistoa.
Terveen tiedoston, tyhjän TRUNCATE-journalin ja nykyisen WAL-käynnistyksen
normaalit polut säilyvät.

#### Katalogiversio ja startup-projektio

Katalogiskeema valitaan tarkistetusta applied-prefixistä, ei sovellusversiosta,
migraatiomäärästä, puuttuvasta sarakkeesta tai SQL-virheestä.
`MigrationHistoryInspection` välittää sisäisesti `readonly appliedMigrationNames`
ja `migrationChainIdentity`. Profiilin tarkistus palauttaa myös nykyisen
`profileId`:n; startupin sisäinen tulos on `InspectedMigrationStartupState`.
Tyhjä nimiluettelo ei valitse käyttökelpoista katalogia.

Backup-/restore-profiili tarvitsee tarkistetun prefixin sisältämän
`025_create_local_runtime_identity.sql`:n ja validoidun identity-rivin ennen
katalogivalintaa. Jatkuva prefix sisältää samalla dokumenttien vaatiman
`018_create_invoice_documents.sql`:n. Tämä ei lupaa kaikkien 025-038-
julkaisujen backup-tukea eikä aseta metadalliselle historialle uutta
038-minimiä metadatatonta poikkeusta jäljitellen.

Invoicing omistaa `selectInvoiceBackupArtifactCatalogSchema(history)`-
valinnan `legacyDocuments | revisionHistory` ja kummankin haaran SQL:n.
Revision-haara valitaan nimetyn B3-migraation esiintymisestä tarkistetussa
applied-prefixissä. Konstruktori, `validateProfileArtifactCatalog` ja
`InvoicingCompositionOptions` saavat eksplisiittisen `schema`-arvon;
optional/default-legacy-fallbackia ei ole.

| Lukukohta | Nykyinen välitys ja järjestys |
| --- | --- |
| `inspectSqliteProfileDatabase` -> `validateProfileSnapshot` -> `validateProfileArtifactCatalog` | Juuri tarkistettu historia valitsee staging-kannan katalogiskeeman. Ennen forward-migraatiota käytetään lähdeskeemaa. |
| `migrateBackup` | Lähteen katalogi ja PDF:t tarkistetaan ennen `runMigrations`-kutsua; salauksen autentikointi/purku ei korvaa tätä. |
| `validateAndMaterialize` | Tuore nykytila ilman pending-migraatioita, sama alkuperäinen katalogi ja vasta sitten materialisointi. Historiallinen published/readiness säilyttää oman historiapolitiikkansa. |
| `validateActiveProfile` | `readMigrationHistory`-callback suoritetaan kerran ennen katalogin SQL:ää; valinta ja palautettu chain ovat samasta tarkastuksesta. Eheän historiallisen prefixin pending ei yksin hylkää pre-migration-eheystarkistusta. |
| `app.ts`-snapshot ja `invoicingComposition` | Snapshot-portti kootaan laiskasti myös tyhjälle kannalle ennen migraatioita; `listAuthoritativeArtifacts()` valitsee tilan luotetusta silloisesta historiasta maintenance-rajan sisällä. Normaali Invoicing-composition saa tilan migraation jälkeisestä nykytilasta. Sama ratkaistu migrationsDirectory on käytössä myös ilman optiona annettua hakemistoa. |
| `createConsistentProfileSnapshot` -> `stageProfileBusinessArtifacts` | Sama laiska katalogiportti; snapshot-/broker-metadatan tai catalog-v1:n formaattia ei laajenneta. |
| `beforeMigrations` -> desktopin `backendMessages` | Eksplisiittinen ulkoinen `MigrationStartupInspection` sisältää vain `appliedMigrationCount`, `migrationChainIdentity`, `pendingMigrationCount` ja `profileState`. Sisäisiä applied-nimiä tai profileId:tä ei lisätä strict-viestiin. |

Katalogin sisältösopimus kattaa myös PDF:ää vailla olevat revisiot,
history/current/source/doc/event-sidokset ja säilytettävät PDF:t.
Laskun kenttä-, mapper-, rajatun skalaari-/tekstiluennan ja relation-ID-
säännöt omistaa Invoicing; niitä ei korvata tässä tietokantaportin
yleistarkistuksella. Katso [laskurevisioiden omistava sopimus](invoice-approval-numbering-plan.md)
ja [backup-artifact-inventaario](local-backup-artifact-inventory.md).

#### Eristetyn tarkistuksen tietokantaraja

Prosessieristyksen, rinnakkaisuuden, ajan, muistin, protokollan ja sisällön
budjettien sekä terminal/exit/reclaim-valtuuden ainoa numeerinen sopimus on
[backup/restore-suunnitelman tarkistusraja](local-backup-and-restore-plan.md#eristetyn-tarkistuksen-rajat-ja-valtuus).
Sama omistaja määrittää nykyisen broker-version, kontekstin ja C:n
update-kirjoitussuojan. Tietokantatarkistin ei luo toista budjettia tai
päättele onnistumista pelkästä terminalista tai exit-koodista.

Tietokantayhteyden alustus käyttää
[inspection-only-ajurisopimusta](local-desktop-dependency-review.md#rajattu-varmuuskopion-tarkistusajuri):
mainin valitsema pakollinen native binding koskee sekä budjetin luotettua
muistiyhteyttä, tuodun kannan readonly-yhteyttä että luotettua
migration-referenssiyhteyttä. Ajurin identiteetti, toimiva muistiseuranta
ja runtime-omistajan määräämä SQLite-raja varmennetaan ennen tuodun kannan
avausta. Pelkkä rajan readback ei riitä. `mmap_size=0`, rajattu cache ja
muistissa pysyvä temp asetetaan tässä alustuksessa; business-yhteyteen ei
aseteta tarkistusprosessin globaalia heap-rajaa. Oletusprebuild-fallbackia
tai uutta riippuvuuden hyväksyntää ei synny dokumentoinnista.

Normaalia käynnistystä ei muuteta kaikkien PDF-tavujen uudeksi skannaukseksi.
Tietokannan schema/history-portti ja palautuksen täydellinen
artifact-tarkistus ovat eri ehdot; jälkimmäinen säilyy sitä edellyttävissä
palautusporteissa.

#### Virheluokitus ja migraation sivuvaikutukset

Legacy-baseline ja kukin business-migraatio säilyttävät erilliset
transaktionsa. Baseline voi jäädä voimaan myöhemmän migraation epäonnistuessa;
se ei ole osittain julkaistu business-migraatio. Loppuattestoinnin virhe on
`MIGRATION_EXECUTION_FAILED`: `completedMigrationCount` kertoo todella
valmistuneet migraatiot ja `sideEffectState` säilyy `unknown`-tilassa.
Virhe ei kumoa jo commitoitua historiaa.

Tarkistuksen täsmällinen `SQLITE_NOMEM` säilyy schema-, historia-, integrity-,
FK- ja identity-lukujen sekä rajattujen readonly-/referenssiavausten yli ja
muuntuu tarkistusoperaatiossa `PROFILE_INSPECTION_LIMIT_EXCEEDED`-syyksi.
Viesti, exit-koodi tai allokaation hylkäys ei yksin todista muistikattoa tai
sen syytä. Muu schema-/historiahylkäys säilyttää oman turvallisen syynsä.
Alkuperäinen poikkeus pysyy sisäisenä; julkinen statuskanava välittää vain
sallitun koodin. Myöhempi sulku-/cleanup-virhe ei korvaa ensivirhettä eikä
tarkistuksen tai sulun epäonnistuminen tuota onnistunutta kuittia.
Migraation statement-vikainjektio todistaa SQL:n ehtineen suoritukseen;
hyväksyttyä schemaa ei rikota vain tämän testin valmisteluksi.

Ensimmäinen mahdollinen migraatiotiedosto:

```text
apps/backend/src/database/migrations/001_create_customers.sql
```

## Ensimmäisen customer-taulun historiallinen rajaus

Alla oleva ensimmäisen slicen kenttäluettelo ei kiellä Customersin
myöhemmin hyväksyttyjä kenttiä. Nykyisen customer-skeeman ja käyttötapausten
omistaja on [Customers-moduuli](../modules/customers.md).

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

Nykyinen backend/browser-kehityksen oletus on:

```text
apps/backend/data/eky-dev.sqlite
```

Kehityskonfiguraation ja komentojen omistaja on
[backendin README](../../apps/backend/README.md#paikallinen-ympäristö).
Paketoitu desktop ei peri tätä fallbackia: Electron main johtaa polun
validoidusta aktiivisen workspacen juuresta
[workspace-sopimuksen](local-company-workspace-plan.md) mukaisesti.

SQLite-tiedoston sijainti ei saa olla web-julkisessa hakemistossa.

`DATABASE_FILE_PATH` on kehityksen `.env.example`-esimerkissä; se ei anna
rendererille valtaa valita paketoidun runtimen tietokantaa.

## Turvallisuus

SQLite-tiedosto ei saa mennä Gitiin.

SQLite-tiedostoa ei saa tarjoilla webistä.

SQL-kyselyt tehdään parametrisoidusti.

Käyttäjän syötettä ei yhdistetä SQL-merkkijonoihin.

Local backend kuuntelee edelleen oletuksena `127.0.0.1`-osoitteessa.

`dev-company` ei ole turvallisuusmalli.

Nykyinen backend vahvistaa actorin ja `companyId`-kontekstin
[runtime-luottamussopimuksen](local-runtime-trust-and-authorization-plan.md)
mukaisesti. Tuleva käyttäjähallinta ei ole lupa ohittaa nykyistä rajaa.

Local/offline-käyttö ei oikeuta ohittamaan domain-sääntöjä.

## Alkuperäisen suunnitteluvaiheen poissulut

Ensimmäinen suunnitteludokumentti ei itsessään valtuuttanut seuraavia
toteutuksia. Luettelo ei kuvaa nykyisen backendin puuttuvia ominaisuuksia:

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

## Ensimmäisen DB-toteutuksen hyväksymiskriteerit

Ensimmäisen toteutuksen alkuperäinen tarkistuslista oli:

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

Kerros-, riippuvuus- ja tietosuojarajat säilyvät. Nykyisen muutoksen
testi-, PR/main- ja palautusportit määräytyvät yhteisistä ohjeista;
tämä historiallinen minimilista ei korvaa niitä.

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/customer-vertical-slice-plan.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
