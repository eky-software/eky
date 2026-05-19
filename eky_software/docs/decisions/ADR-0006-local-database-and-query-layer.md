# ADR-0006: Paikallinen tietokanta ja query layer

## Tila

Hyväksytty alustavasti.

## Päätös

Eky käyttää paikallisessa offline-versiossa SQLite-tietokantaprofiilia ja myöhemmässä pilviversiossa PostgreSQL-tietokantaprofiilia.

Ensimmäisessä paikallisessa versiossa käytetään lähtökohtaisesti yhtä SQLite-tiedostoa.

Myöhemmässä pilviversiossa käytetään lähtökohtaisesti yhtä PostgreSQL-tietokantaa.

Yksi tietokanta alussa ei tarkoita yhtä vapaata datalätäkköä. Moduulit erotetaan koodissa, tauluomistuksessa, repository-porteissa ja käyttöoikeuksien tarkistuksessa.

## Tavoite

Tämän päätöksen tavoitteena on varmistaa, että Eky voi kasvaa paikallisesta asiakaskortisto- ja laskutusratkaisusta suuremmaksi ERP-järjestelmäksi ilman, että tietokantakerroksesta tulee hallitsematon.

Tietokantarakenne suunnitellaan tukemaan:

- local-first-käyttöä
- cloud-ready-laajennusta
- modulaarista monoliittia
- myöhempää mobiilisovellusta
- myöhempää local-cloud-synkronointia
- tenant-valmiutta
- raportointia
- auditointia

## Tietokantaprofiilit

### Local edition

Paikallinen offline-versio käyttää SQLitea.

Perustelut:

- toimii ilman erillistä tietokantapalvelinta
- voidaan toimittaa sovelluksen mukana
- toimii ilman internetyhteyttä
- tukee SQL:ää, tauluja, indeksejä, transaktioita, join-kyselyitä ja foreign key -viitteitä
- sopii yhden koneen paikalliseen ERP-käyttöön
- paikallinen tietokantatiedosto on varmuuskopioitavissa hallitusti

### Cloud edition

Pilviversio käyttää myöhemmin PostgreSQL:ää.

Perustelut:

- sopii palvelinkäyttöön
- sopii moniyritys- ja monikäyttäjäkäyttöön
- tukee raskaampaa raportointia
- tukee hallittua tuotantokäyttöä
- sopii Cloud Run / Cloud SQL / Firebase SQL -suuntaan

### Mobile later

Mobiiliversion offline-first-tallennus suunnitellaan myöhemmin Room/SQLite-linjan pohjalta.

Tätä ei toteuteta tässä vaiheessa.

## Moduulien datan omistajuus

Moduuli omistaa oman datansa.

Esimerkkejä:

- customers-moduuli omistaa asiakkaat
- invoicing-moduuli omistaa laskut ja laskurivit
- work-orders-moduuli omistaa työmääräykset
- inventory-moduuli omistaa varasto- ja materiaalitiedot
- reporting-moduuli omistaa raportoinnin hallitut lukunäkymät ja koosteet

Toinen moduuli ei saa kirjoittaa suoraan toisen moduulin omistamaan dataan.

Yhteinen tietokanta ei oikeuta vapaisiin moduulien välisiin kirjoituksiin.

## Cross-module access

Operatiivinen kirjoituspuoli pidetään tiukkana.

Esimerkiksi seuraavat toiminnot kulkevat oman moduulinsa application service -kerroksen kautta:

- asiakkaan luonti
- asiakkaan päivitys
- laskun luonti
- laskurivin lisäys
- työmääräyksen luonti
- tuntikirjauksen lisäys
- materiaalivarauksen teko

Toinen moduuli voi lukea toisen moduulin tietoa vain hallitusti.

Sallittuja malleja voivat olla:

- toisen moduulin application service
- erikseen määritelty readonly-portti
- snapshot-tieto omassa moduulissa
- eventin pohjalta rakennettu projektio
- reporting/read model -kerros

Satunnaisia cross-module write -oikopolkuja ei tehdä.

## Reporting ja read model

ERP-järjestelmä tarvitsee myöhemmin koostenäkymiä ja raportointia, joissa dataa yhdistellään useista moduuleista.

Tämä erotetaan operatiivisesta kirjoituslogiikasta.

Periaate:

```text
write side: strict module ownership
read/reporting side: controlled projections and reporting queries
```

Reporting/read model -kerros voi myöhemmin tehdä laajempia kyselyitä hallitusti, mutta se ei saa muuttua paikaksi, josta tehdään liiketoimintaa muuttavia kirjoituksia muiden moduulien dataan.

## Snapshot-periaate

Jotkin liiketoimintadokumentit tarvitsevat tapahtumahetken tiedot snapshotina.

Esimerkiksi lasku voi viitata asiakkaaseen, mutta laskun ei pidä muuttua takautuvasti, jos asiakkaan nykyinen osoite muuttuu asiakaskortissa.

Laskutuksessa harkitaan siksi snapshot-kenttiä, kuten:

```text
invoice.customerId
invoice.customerNameSnapshot
invoice.billingAddressSnapshot
invoice.businessIdSnapshot
```

Tarkkoja kenttiä ei päätetä tässä ADR:ssä. Periaate on, että pysyvissä liiketoimintadokumenteissa säilytetään tarvittavat tapahtumahetken tiedot.

## Repository ports ja database adapters

Application service -kerros käyttää repository portteja.

Tietokantakohtainen toteutus on adapteri.

Perusmalli:

```text
application service
  -> repository port
    -> database adapter
```

Paikallisessa versiossa:

```text
application service
  -> repository port
    -> SQLite adapter
```

Pilviversiossa myöhemmin:

```text
application service
  -> repository port
    -> PostgreSQL adapter
```

Domain ei tunne repository-adapteria eikä tietokantakirjastoa.

## Query layer

Ensisijainen query layer -ehdokas on Kysely.

Perustelut:

- TypeScript-ystävällinen SQL query builder
- ei ole raskas ORM
- SQL-ajattelu säilyy näkyvissä
- sopii monimutkaisempiin join-kyselyihin
- tukee sekä SQLite- että PostgreSQL-ajattelua
- sopii repository-adapterikerrokseen

Kyselyä ei vielä asenneta tässä ADR:ssä.

## Vaihtoehdot

### Kysely

Kysely on ensisijainen ehdokas ensimmäiseen query layer -ratkaisuun.

Riskit:

- tuo uuden riippuvuuden
- skeeman TypeScript-malli pitää suunnitella
- migraatiomalli pitää ratkaista erikseen

### Drizzle

Drizzle jää vaihtoehdoksi.

Plussat:

- vahva TypeScript-skeema-ajattelu
- tukee SQLite- ja PostgreSQL-maailmaa
- tarjoaa migraatiotyökaluja

Riskit:

- voi alkaa ohjata liikaa arkkitehtuuria
- ORM-skeema voi vahingossa muuttua domain-malliksi
- lisää enemmän omaa teknologista maailmaa kuin kevyt query builder

### Suora SQLite-kirjasto

Suora SQLite-kirjasto jää vaihtoehdoksi.

Plussat:

- yksinkertainen
- vähän abstraktiota
- sopii pieneen paikalliseen SQLite-toteutukseen

Riskit:

- SQLite-spesifi toteutus
- PostgreSQL-adapteri pitää tehdä myöhemmin erikseen
- SQL-mappaukset ja tyyppiturva jäävät enemmän käsityöksi

## Turvallisuus

SQLite-tietokantatiedostoa ei saa commitoida Gitiin.

SQLite-tietokantatiedostoa ei saa tarjoilla webistä.

Paikallinen tietokanta pitää sijoittaa myöhemmin hallittuun sovellusdatahakemistoon, ei julkiseen web-hakemistoon.

SQL-injektiot estetään käyttämällä parametrisoituja kyselyitä tai query builderia.

Käyttäjän syöte ei saa päätyä SQL-lauseisiin merkkijonojen yhdistelyllä.

Backend tarkistaa edelleen:

- autentikoinnin, kun auth on käytössä
- käyttöoikeudet
- yritysrajauksen
- syötteen oikeellisuuden
- domain-säännöt

Local/offline-käyttö ei oikeuta ohittamaan domain-sääntöjä.

## Synkronointi

Synkronointi ei saa kopioida raakaa SQLite-tiedostoa pilveen.

Myöhempi sync-malli kulkee hallitun rajapinnan kautta:

```text
local change log
  -> sync engine
    -> cloud API
      -> backend validation
        -> cloud database
```

Pilveen menevä data tarkistetaan cloud backendissä uudelleen.

## Ensimmäinen toteutussuunta myöhemmin

Ensimmäinen tietokantaa käyttävä pystysuora pala tehdään myöhemmin pienesti.

Alustava ehdokas:

```text
Customer create/list locally
```

Tämän tarkoitus on todistaa:

- repository port -malli
- SQLite adapter -malli
- query layer -malli
- backend route -> application service -> repository -virta
- domainin riippumattomuus tietokannasta

Ensimmäisessä DB-toteutuksessa ei rakenneta koko asiakashallintaa, koko laskutusta eikä koko ERP-skeemaa.

## Ei päätetä tässä ADR:ssä

Tässä ADR:ssä ei vielä päätetä:

- tarkkaa SQLite-kirjastoa
- Kyselyn versiota
- Drizzlen hylkäämistä lopullisesti
- migraatiotyökalua
- ensimmäistä tietokantaskeemaa
- customer-taulun tarkkoja kenttiä
- laskutuksen taulurakennetta
- audit log -taulun rakennetta
- local database -tiedoston lopullista sijaintia
- varmuuskopioinnin toteutusta
- local-cloud-synkronoinnin toteutusta

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-cloud-sync.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
- `docs/decisions/ADR-0005-backend-framework-selection.md`
