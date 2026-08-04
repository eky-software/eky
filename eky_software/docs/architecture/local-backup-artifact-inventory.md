# Eky Local backup artifact inventory

## Tila

Tämä dokumentti on R0 backup/restore -toteutuksen auktoritatiivinen
inclusion/exclusion-inventaario. Inventaario perustuu nykyiseen yhden suljetun
yritysprofiilin malliin ja baselineen, jossa Electron main käynnistää yhden
paikallisen backendin sekä yhden SQLite-yhteyden.

Backup-infrastruktuuri ei päättele sisältöä globaamalla `userData`-hakemistoa.
Jokainen mukaan otettava business-artifacti tulee tietokannasta tai sen
omistavan moduulin kapeasta catalog-portista.

## Profiilin nykyinen fyysinen raja

Paketoidussa desktop-runtimessa aktiivisen profiilin juurena toimii:

`<Electron userData>/runtime`

Nykyiset auktoritatiiviset business-lähteet ovat:

| Lähde | Nykyinen suhteellinen sijainti | Omistaja |
| --- | --- | --- |
| SQLite database | `data/eky.sqlite` | Backend database infrastructure ja tietoja omistavat moduulit |
| Invoice document storage | `storage/invoices/` | Invoicing |

Polut ovat composition rootin yksityistä konfiguraatiota. Renderer ei saa
niitä, eikä backup-contract tallenna absoluuttisia paikallisia polkuja.

## SQLite database

SQLite-snapshot sisältää koko yhden profiilin tietokannan. Se on
auktoritatiivinen lähde esimerkiksi:

- local runtime identitylle
- Company Settings -datalle ja sen auditeille
- Customers-datalle ja sen auditeille
- Invoicingin asetuksille, luonnoksille, laskuille, riveille, maksuille,
  hyvityssuhteille, toimitustapahtumille ja auditeille
- Activity-read modelin lähteenä käytettäville business-auditeille
- laskudokumenttien metadatalle

Backup ei valitse tauluja erikseen eikä tee taulu- tai moduulikohtaista
osapalautusta. Snapshot tehdään `better-sqlite3`-backup-API:lla maintenance-
rajan sisällä; elävää päätiedostoa, WAL-tiedostoa tai SHM-tiedostoa ei kopioida
ad hoc.

Snapshotin pitää läpäistä vähintään:

- SQLite `integrity_check`
- foreign key -tarkistus
- migration chain -tarkistus
- yhden profiilin / yhden yrityksen identiteettiraja
- module ownerien myöhemmin nimeämät restore-invariantit

## Invoice document storage

### Auktoritatiivinen catalog

Invoicing nimeää auktoritatiivisiksi kaikki ja vain snapshotin
`invoice_documents`-taulun rivit. Nykyinen tuettu dokumenttityyppi on
`approved_invoice_pdf`.

Backup-catalog-portin pitää luetteloida jokaisesta rivistä vähintään:

- dokumentin id
- company id vain backendin luotetussa sisäisessä rajassa
- invoice id
- dokumenttityyppi
- turvallinen backup-entryn suhteellinen polku
- storagen suhteellinen lähdepolku
- tiedostonimi
- MIME-tyyppi
- odotettu byte-koko
- odotettu SHA-256

Backup-infrastruktuuri saa portilta vain tämän rajatun catalogin. Se ei saa
suoraa SQL-pääsyä Invoicingin tauluihin eikä yleistä filesystem-listausta.

### Current PDF -malli

Nykyinen tietomalli säilyttää enintään yhden `approved_invoice_pdf`-rivin
yrityksen ja laskun yhdistelmälle. Sama malli kattaa:

- tavalliset hyväksytyt laskut
- lähetetyt laskut
- maksetut laskut
- perutut laskut, joiden nykyinen PDF säilyy read-only-katselua varten
- hyvityslaskut
- osittain tai kokonaan hyvitettyihin laskuihin liittyvät omat PDF:t

Credit invoice PDF ei ole eri storage-tyyppi. Se on hyvityslaskun oma
`invoice_documents`-rivi, jonka dokumenttityyppi on edelleen
`approved_invoice_pdf`.

### Uudelleenavaus ja uudelleenhyväksyntä

Nykyinen standard invoice reopen -polku poistaa current PDF:n metadatarivin
samassa tietokantatransaktiossa, jossa lasku avataan takaisin muokkaukseen.
`invoice_delivery_events.document_id` käyttää `ON DELETE SET NULL` -sääntöä,
joten vanha delivery event säilyy mutta ei enää nimeä poistettua dokumenttia.
Fyysinen tiedosto poistetaan transaktion jälkeen best effort -mallilla.

Uudelleenhyväksynnän ja uuden PDF:n luonnin jälkeen syntyy uusi
`invoice_documents`-rivi nykyiselle PDF:lle. Nykyinen malli ei säilytä
superseded PDF -versiohistoriaa eikä aikaisempaa `documentId`:tä
auktoritatiivisena artifactina.

Tästä seuraa:

- backup sisältää kaikki snapshotissa olevat `invoice_documents`-rivit
- backup ei etsi delivery eventin `null`-viitteen perusteella vanhaa PDF:ää
- backup ei ota mukaan metadataltaan poistettua superseded-tiedostoa
- tuleva PDF-versiohistoria vaatii oman tietomalli- ja catalog-päätöksen

### Puuttuvat, ristiriitaiset ja orvot tiedostot

Jokainen catalogissa oleva dokumentti on pakollinen. Backup estyy ennen
lopullisen artifactin muodostamista, jos:

- DB-viitattu tiedosto puuttuu
- lähde ei ole tavallinen tiedosto tai se on symlink/reparse point
- storage-polku on absolute, traversal tai ratkaisee storage-juuren ulkopuolelle
- byte-koko ei vastaa metadataa
- SHA-256 ei vastaa metadataa
- MIME- tai dokumenttityyppi ei ole tunnettu
- kaksi riviä aiheuttaisi duplicate- tai case-collision-entryn

Storage-juuressa oleva tiedosto ilman `invoice_documents`-riviä on orpo. Sitä
ei lisätä backupiin hiljaisesti eikä backup-operaatio poista sitä. Orpo
raportoidaan myöhemmin turvallisella diagnostiikkakoodilla ilman raakaa polkua.

Restore estyy, jos manifestin dokumentti, palautettu tiedosto ja palautettu
`invoice_documents`-rivi eivät vastaa toisiaan id:n, tyypin, koon, SHA-256:n
ja suhteellisen storage-polun osalta.

## Muut nykyiset business-artifactit

Nykyisen koodin auditissa ei löytynyt muuta SQLiten ulkopuolista,
ei-uudelleenmuodostettavaa business-dataa. Customers-, Company Settings-,
Activity-, payment-, numbering- ja audit-data ovat SQLitessä.

Uusi moduuli tai uusi tiedostopohjainen business-ominaisuus ei kuulu backupiin
automaattisesti. Sen module ownerin pitää ennen oikeaa dataa:

1. nimetä auktoritatiivinen sisältö
2. tarjota kapea snapshot/catalog-portti
3. määrittää restore-validointi
4. lisätä cross-version- ja fault-testit
5. päivittää tämä inventaario

## Nimenomaisesti pois jätettävä runtime-data

Seuraavat eivät ole business-profiilin auktoritatiivista backup-sisältöä:

- `runtime/logs/` operational-, security- ja incident-data
- `runtime/secrets/company-email-smtp-v1.dat` sekä sen recovery-slotit
- runtime-session, ActorContextin muistidata ja IPC-capabilityt
- `runtime/support-bundles/` temporary-data ja käyttäjän tukipaketit
- `runtime/settings/invoice-pdf-archive-v1.json`
- `runtime/archive/invoice-pdf-archive-journal-v1.json`
- käyttäjän valitseman ulkoisen PDF-arkistokansion laskukopiot
- backup-, recovery-, restore-, activation- ja update-journalit
- backup- ja restore-staging
- konekohtaiset recovery pointit
- smoke-, E2E-, compatibility- ja testitiedostot
- cache, temp, application build, Electron-binaarit ja installer-artifactit

SMTP-salaisuus asetetaan palautuksen jälkeen uudelleen secret lifecycle
-polulla. Ulkoisen PDF-arkistokansion asetusta tai polkua ei siirretä toiselle
koneelle.

## Snapshotin eheysraja

Yksi backup-generation käyttää yhtä maintenance-operaatiota:

1. uudet business-kirjoitukset estetään
2. SQLite-snapshot muodostetaan
3. artifact-catalog luetaan samasta maintenance-rajasta
4. catalogin tiedostot kopioidaan yksityiseen stagingiin ja varmennetaan
5. staged SQLite ja artifactit validoidaan yhdessä
6. vasta tämän jälkeen container voidaan muodostaa

Jos maintenance-raja ei pysty estämään uutta dokumenttiriviä tai tiedoston
korvaamista SQLite-snapshotin ja artifact-kopioinnin välissä, backupia ei saa
pitää eheänä. Toteutuksen pitää siksi käyttää yhtä yksityistä snapshot-
brokeria, joka omistaa koko vaiheen alusta loppuun.

## Päätelmä

Nykyinen tietomalli pystyy yksiselitteisesti luetteloimaan kaikki tällä hetkellä
auktoritatiiviset PDF:t `invoice_documents`-taulusta. Writerin toteuttaminen ei
edellytä koko `userData`-hakemiston kopiointia eikä schema-muutosta.

Ennen writeria toteutetaan Invoicing-local backup catalog -portti, puuttuvan
DB-viitatun artifactin fail-closed-validointi ja orpojen tiedostojen turvallinen
diagnostiikka. Jos tuleva audit löytää muun ei-uudelleenmuodostettavan
business-artifactin, writerin käyttöönotto pysäytetään kunnes inventaario ja
owner-portti on päivitetty.

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `apps/backend/src/modules/invoicing/AGENTS.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/support-bundle-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
