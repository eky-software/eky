# SQLite-hyväksyntäpersistenssin rajat

Tämä dokumentti kuvaa Invoicing-moduulin nykyisen SQLite-pohjaisen laskun
hyväksyntäpersistenssin vastuut ja turvallisen pilkkomisjärjestyksen.

Dokumentti on käyttäytymisen säilyttävän refaktoroinnin lähtötilakuvaus. Se ei
anna lupaa muuttaa tietokantaa, migraatioita, SQL-lauseita, transaktiorajoja,
liiketoimintasääntöjä tai `InvoiceApprovalRepository`-portin julkista
sopimusta.

## Julkinen repository-portti

`InvoiceApprovalRepository` omistaa tällä hetkellä kolme julkista operaatiota:

- `approveDraft`: hyväksyy uuden luonnoksen tai hyväksyy muokkaukseen avatun
  laskun uudelleen
- `reopenApprovedInvoiceForEditing`: palauttaa hyväksytyn laskun lähdeluonnoksen
  muokattavaksi
- `markApprovedInvoiceSent`: tekee hyväksytylle laskulle idempotentin
  `sent`-tilasiirtymän

Portti ei paljasta SQLite-tyyppejä. Kaikki operaatiot saavat `companyId`-arvon
application-kerroksen vahvistetusta kontekstista.

`markApprovedInvoiceSent` kuuluu edelleen julkiseen persistence-porttiin ja sen
nykyinen käyttäytyminen säilytetään tässä refaktoroinnissa. Nykyinen
application-tason manuaalisen toimituksen polku käyttää erillistä
`InvoiceManualDeliveryFinalizer`-porttia; näitä polkuja ei yhdistetä tämän työn
yhteydessä.

## Nykyiset transaktiopolut

### Uuden laskun hyväksyntä

**Omistaja:** `SqliteInvoiceApprovalRepository.approveDraft`.

**Luettavat tiedot:**

- yritykselle kuuluva luonnos ja sen hyväksyntätila
- yrityksen kautta rajatut luonnosrivit rivijärjestyksessä
- laskunumerointiasetukset
- nykyinen numerointisarjan sekvenssi
- yrityksen, asiakkaan ja mahdollisen laskun vastaanottajan snapshot-tiedot

**Kirjoitettavat tiedot samassa transaktiossa:**

- numerointisarjan seuraava käytetty sekvenssi
- hyväksytyn laskun snapshot
- hyväksytyn laskun rivit
- `invoice.approved`-audit-tapahtuma
- lähdeluonnoksen linkitys hyväksyttyyn laskuun ja hyväksyntäaika

Laskunumero ja viitenumero muodostetaan ennen kirjoituksia domain-säännöillä.
Luonnoksen tallennetut summat tarkistetaan laskemalla rivit uudelleen ennen
snapshotin kirjoittamista. Duplikaatti luonnoslinkitys estyy sekä sovelluspolun
tarkistuksella että tietokannan yksikäsitteisyysrajoitteella.

Jos mikä tahansa kirjoitus epäonnistuu, myös sekvenssivaraus palautuu. Osittaista
laskua, rivistöä, auditia tai luonnoslinkitystä ei saa jäädä kantaan.

### Uudelleenhyväksyntä

**Omistaja:** `SqliteInvoiceApprovalRepository.approveDraft`, kun luonnokseen
liittyvä lasku on tilassa `reopened_for_edit`.

**Luettavat tiedot:**

- sama yritysrajattu luonnos ja rivistö kuin uudessa hyväksynnässä
- yrityksen ja asiakkaiden ajantasaiset snapshot-lähteet
- samaan yritykseen ja lähdeluonnokseen kuuluva avattu lasku

**Kirjoitettavat tiedot samassa transaktiossa:**

- olemassa olevan laskun päivitetty snapshot samoilla numeroilla
- vanhojen laskurivien korvaaminen uusilla riveillä
- `invoice.reapproved`-audit-tapahtuma
- lähdeluonnoksen linkitys takaisin hyväksyttyyn laskuun

Uudelleenhyväksyntä säilyttää laskun tunnisteen, laskunumeron, viitenumeron,
numerointitavan, sekvenssin ja sekvenssialueen. Se ei lue eikä kuluta uutta
numerointisarjan arvoa. Jos kirjoitus tai audit epäonnistuu, aikaisempi snapshot
ja rivit, laskun `reopened_for_edit`-tila, luonnoksen avoin tila ja sekvenssi
säilyvät kokonaisuudessaan.

### Hyväksytyn laskun palautus muokattavaksi

**Omistaja:** `SqliteInvoiceApprovalRepository.reopenApprovedInvoiceForEditing`.

**Luettavat tiedot:**

- yritykselle kuuluva, täsmälleen `approved`-tilassa oleva lasku
- laskun nykyisen PDF-dokumentin metatiedot

**Kirjoitettavat tiedot samassa transaktiossa:**

- laskun tila `reopened_for_edit`-tilaan
- lähdeluonnoksen hyväksyntälinkin ja hyväksyntäajan vapautus
- nykyisen lasku-PDF:n metadata-rivien poisto
- `invoice.reopened_for_edit`-audit-tapahtuma

Repository palauttaa poistettujen dokumenttirivien storage-polut, mutta ei
poista varsinaisia tiedostoja. Application-kerros käsittelee storage-poiston
erikseen vasta onnistuneen tietokantatransaktion jälkeen.

Jos audit tai muu kirjoitus epäonnistuu, laskun tila, luonnoslinkki ja
PDF-metadata palautuvat kaikki alkuperäiseen tilaansa. `sent`-laskua ei voi
palauttaa tällä operaatiolla muokattavaksi.

### Hyväksytyn laskun merkitseminen lähetetyksi

**Omistaja:** `SqliteInvoiceApprovalRepository.markApprovedInvoiceSent`.

**Luettavat tiedot:**

- yritykselle kuuluva lasku, jonka tila on `approved` tai `sent`

**Kirjoitettavat tiedot samassa transaktiossa:**

- `approved`-laskun tila `sent`-tilaan ja `updated_at`-aikaleima
- `invoice.marked_sent_manually`-audit-tapahtuma

Operaatio on idempotentti: jo `sent`-tilassa oleva lasku palauttaa onnistuneen
tuloksen ilman uutta tilapäivitystä tai audit-tapahtumaa. Jos audit-kirjoitus
epäonnistuu ensimmäisessä siirtymässä, myös laskun tila ja aikaleima palautuvat.

## Säilytettävät invariantit

Kaikissa myöhemmissä rakenteellisissa muutoksissa säilytetään vähintään:

1. Jokainen pääresurssin luku rajataan `companyId`-arvolla.
2. Hyväksyä saa vain `draft`-tilaisen, vielä hyväksymättömän luonnoksen, jolla
   on vähintään yksi rivi.
3. Samasta luonnoksesta ei synny kahta hyväksyttyä laskua.
4. Numeron varaus, lasku, rivit, audit ja luonnoslinkki kirjoitetaan yhdessä
   transaktiossa.
5. Uudelleenhyväksyntä säilyttää lasku- ja viitenumeron eikä kuluta sekvenssiä.
6. Hyväksytty lasku sisältää hyväksyntähetken myyjä-, asiakas-, vastaanottaja-,
   maksutieto-, lasku- ja rivisnapshotit.
7. Reopen päivittää laskun, luonnoksen, PDF-metadatan ja auditin atomisesti.
8. Reopen palauttaa storage-polut mutta ei poista tiedostoja transaktiossa.
9. `sent`-laskua ei voi avata uudelleen muokattavaksi.
10. Mark sent päivittää tilan ja auditin atomisesti ja on jo lähetetylle
    laskulle idempotentti.
11. SQL säilyy parametrisoituna eikä repository luota HTTP-DTO:ihin.
12. Repository käyttää samaa tietokantayhteyttä kaikissa transaktion sisällä
    tehtävissä luvuissa ja kirjoituksissa.

## Kirjoituslauseiden auditointi

Kaikki alla kuvatut kirjoitukset suoritetaan repositoryn avaaman synkronisen
SQLite-transaktion sisällä ja samalla `DatabaseConnection`-oliolla kuin niitä
edeltävät SELECT-kyselyt. Kirjoitushelper ei saa myöhemmässäkään jaossa avata
omaa yhteyttä tai transaktiota.

| Metodi | Taulu ja statement | Syöte | Yritys- ja tilaraja | `changes`-vaatimus | Luotettu edeltävä luku | Epäonnistuminen ja rollback |
| --- | --- | --- | --- | --- | --- | --- |
| `upsertNumberSequence` | `invoice_number_sequences`, `INSERT ... ON CONFLICT DO UPDATE` | `NewInvoiceNumberSequenceRow` | Avain sisältää `company_id`, `series_key` ja `sequence_scope`; ei tilakenttää | Ei erillistä tarkistusta: onnistunut upsert kirjoittaa yhden rivin, constraint-virhe heitetään | Yritys- ja sarjarajattu numerointiasetus sekä yritys-, sarja- ja scope-rajattu nykysekvenssi | SQLite-virhe keskeyttää hyväksynnän; myös mahdollinen sekvenssipäivitys palautuu myöhemmän virheen yhteydessä |
| `insertInvoice` | `invoices`, `INSERT` | `NewInvoiceRow` | `company_id` on kirjoitettavassa snapshot-rivissä; uniikki yritys + laskunumero/lähdeluonnos ja lähdeluonnoksen FK vartioivat eheyttä | Ei erillistä tarkistusta: INSERT joko onnistuu yhdelle riville tai heittää | Yritysrajattu hyväksyttävä luonnos, rivit, numerointi ja snapshot-lähteet | SQLite constraint -virhe heitetään; sekvenssi ja kaikki muut saman transaktion kirjoitukset palautuvat |
| `updateInvoice` | `invoices`, `UPDATE` | `NewInvoiceRow` | `WHERE company_id = @company_id AND id = @id AND status = 'reopened_for_edit'` | Täsmälleen yksi; muuten `ApproveInvoiceDraftError('Reopened invoice could not be reapproved.')` | Yritys- ja lähdeluonnosrajattu lasku, jonka tila on `reopened_for_edit` | Virhe palauttaa vanhan snapshotin ja pitää vanhat rivit, avoimen luonnoksen sekä sekvenssin ennallaan |
| `insertInvoiceLines` | `invoice_lines`, yksi `INSERT` per rivi | `NewInvoiceLineRow[]` | Taulussa ei ole `company_id`-kenttää; `invoice_id` tulee saman transaktion yritysrajatusta laskusta ja FK sekä `(invoice_id, line_order)`-uniikkius vartioivat eheyttä | Ei erillistä tarkistusta: kukin INSERT onnistuu yhdelle riville tai heittää | Uudessa hyväksynnässä juuri lisätty lasku; uudelleenhyväksynnässä yritys- ja tilarajattu olemassa oleva lasku | Minkä tahansa rivin virhe palauttaa kaikki aiemmat rivit ja saman transaktion muut kirjoitukset |
| `deleteInvoiceLines` | `invoice_lines`, `DELETE` | `invoiceId` | Statementissa ei ole omaa `companyId`-ehtoa, koska taulussa ei ole yrityskenttää; tunniste tulee saman transaktion yritys- ja `reopened_for_edit`-rajatusta laskusta | Ei; nolla tai useampi vanha rivi on sallittu | `getReopenedInvoiceForDraft(companyId, draftId)` | Myöhempi update-, insert-, audit- tai draft-linkitysvirhe palauttaa poistetut vanhat rivit |
| `deleteApprovedInvoicePdfDocumentRows` | `invoice_documents`, ensin `SELECT storage_path`, sitten `DELETE` | `companyId`, `invoiceId` | Sekä luku että poisto käyttävät samaa `company_id`, `invoice_id` ja `document_type = 'approved_invoice_pdf'` -rajaa | Ei; nolla tai yksi rivi on sallittu nykyisen uniikkiusrajan vuoksi | Yritys- ja `approved`-rajattu lasku | Poistettavat polut luetaan ennen poistoa samassa transaktiossa; myöhempi audit-virhe palauttaa metadata-rivin, eikä repository poista tiedostoa |
| `insertAuditEvent` | `invoice_audit_events`, `INSERT` | `NewInvoiceAuditEventRow` | `company_id` tulee vahvistetusta persistence-inputista; laskun FK ja action CHECK vartioivat eheyttä, mutta `draft_id` ei ole FK | Ei erillistä tarkistusta: INSERT joko onnistuu yhdelle riville tai heittää | Kyseisen polun yritys- ja tilarajattu luonnos tai lasku | SQLite constraint -virhe heitetään ja palauttaa kaikki sitä edeltävät saman transaktion kirjoitukset |
| `markDraftApproved` | `invoice_drafts`, `UPDATE` | `ApproveInvoiceDraftPersistenceInput` | `WHERE company_id = ? AND id = ? AND status = 'draft' AND approved_invoice_id IS NULL` | Täsmälleen yksi; muuten `ApproveInvoiceDraftError('Invoice draft could not be marked as approved.')` | Yritysrajattu, `draft`-tilainen ja hyväksyntään linkittämätön luonnos | Virhe palauttaa sekvenssin, laskun, rivit ja auditin tai uudelleenhyväksynnän snapshotin, rivit ja auditin |
| `markInvoiceReopenedForEditing` | `invoices`, `UPDATE` | `ReopenApprovedInvoicePersistenceInput` | `WHERE company_id = ? AND id = ? AND status = 'approved'` | Täsmälleen yksi; muuten `ApproveInvoiceDraftError('Approved invoice could not be reopened for editing.')` | Yritys- ja `approved`-rajattu lasku | Virhe jättää laskun, luonnoksen, PDF-metadatan ja auditin ennalleen |
| `markInvoiceSent` | `invoices`, `UPDATE` | `MarkApprovedInvoiceSentPersistenceInput` | `WHERE company_id = ? AND id = ? AND status = 'approved'` | Täsmälleen yksi; muuten `ApproveInvoiceDraftError('Approved invoice could not be marked sent.')` | Yritysrajattu lasku tilassa `approved` tai `sent`; jo lähetetty lasku palautuu ennen kirjoitusta | Virhe tai myöhempi audit-virhe palauttaa tilan ja `updated_at`-arvon |
| `unlockSourceDraftForEditing` | `invoice_drafts`, `UPDATE` | Reopen-input ja luetun laskun `source_draft_id` | `WHERE company_id = ? AND id = ? AND approved_invoice_id = ?` | Täsmälleen yksi; muuten `ApproveInvoiceDraftError('Approved invoice source draft could not be reopened for editing.')` | Yritys- ja `approved`-rajatusta laskusta saatu lähdeluonnoksen tunniste | Virhe palauttaa sitä edeltävän laskun tilapäivityksen; myöhempi PDF- tai audit-virhe palauttaa myös luonnoslinkin |

`invoiceId`-rajattu laskurivien poisto on hyväksytty vain tämän sisäisen
transaktiopolun osana. Metodia ei saa nostaa julkiseksi tai kutsua ilman saman
transaktion yritys- ja tilarajattua laskuhakua. Laskurivien lisäys on vastaavasti
sidottu laskun pääavaimeen ja FK-rajaan, ei erilliseen laskurivien
`company_id`-kenttään.

PDF-metadatan storage-polkujen SELECT ja samoin rajattu DELETE muodostavat
yhden kirjoitusoperaation. Niitä ei eroteta eri yhteyksille tai
transaktiorajojen eri puolille. Varsinainen tiedostopoisto ei kuulu tähän
SQLite-operaatioon.

## Kirjoitusten täsmällinen järjestys

Nykyinen järjestys on käyttäytymissopimus, joka säilytetään statements- ja
orchestrator-erotuksissa:

1. **Uusi hyväksyntä:** `upsertNumberSequence` -> `insertInvoice` ->
   `insertInvoiceLines` -> `insertAuditEvent` -> `markDraftApproved`.
2. **Uudelleenhyväksyntä:** `updateInvoice` -> `deleteInvoiceLines` ->
   `insertInvoiceLines` -> `insertAuditEvent` -> `markDraftApproved`.
3. **Palautus muokattavaksi:** `markInvoiceReopenedForEditing` ->
   `unlockSourceDraftForEditing` ->
   `deleteApprovedInvoicePdfDocumentRows` -> `insertAuditEvent`.
4. **Merkitse lähetetyksi:** `markInvoiceSent` -> `insertAuditEvent`.

Jokainen järjestys alkaa sitä suojaavilla yritys- ja tilarajatuilla luvuilla.
Jo `sent`-tilainen lasku palautuu idempotentisti ennen mark sent -kirjoituksia.

## Vastuumatriisi

| Vastuu | Nykyinen omistaja | Hyväksytty tavoite tässä siivouksessa |
| --- | --- | --- |
| Puhtaat persistence-rivien muunnokset | SQLite approval repository | `invoiceApprovalPersistenceRows.ts` |
| Hyväksynnän SELECT-kyselyt | SQLite approval repository | `sqliteInvoiceApprovalQueries.ts` |
| Yritys- ja asiakassnapshotien luku | `SqliteInvoiceApprovalSnapshotReader` | Säilyy nykyisessä readerissä |
| INSERT-, UPDATE- ja DELETE-lauseet | SQLite approval repository | Kapea `sqliteInvoiceApprovalStatements.ts`, sama yhteys ja synkroninen kutsutapa |
| Transaktioiden orkestrointi | SQLite approval repository | Säilyy repositoryssä |
| Numerointipäätös ja domain-validointi | Domain + repositoryn orkestrointi | Säilyy nykyisessä kutsuketjussa |
| Sekvenssin persistence | SQLite approval repository | Säilyy samassa hyväksyntätransaktiossa |
| Audit-rivin muodostus | SQLite approval repository | Puhdas mapping siirtyy rows-tiedostoon |
| Audit-rivin kirjoitus | SQLite approval repository | Säilyy repositoryssä |
| PDF-metadatan poisto reopenissa | SQLite approval repository | Säilyy repositoryn transaktiossa |
| Varsinaisen PDF-tiedoston poisto | Application/storage-adapteri | Ei muutu |

`sqliteInvoiceApprovalStatements.ts` saa sisältää vain yllä auditoidut
synkroniset kirjoitusmetodit. Se ei ole erillinen repository tai adapteri eikä
se saa omistaa yhteyttä, transaktiota, järjestystä, tunnisteita, aikaa,
domain-päätöksiä tai application-orkestrointia.

## Indeksi- ja rajoiteauditointi

Nykyiset hyväksyntäpolut tukeutuvat seuraaviin tietokantarajoitteisiin:

- `invoice_drafts`-taulun ensisijaiseen avaimeen ja yrityskohtaisiin listaus-
  indekseihin
- luonnosrivien uniikkiin `(invoice_draft_id, position)`-rajoitteeseen,
  järjestysindeksiin ja `ON DELETE CASCADE` -viiteavaimeen
- numerointiasetusten ja sekvenssien yritys-, sarja- ja scope-kohtaisiin
  yhdistelmäavaimiin
- laskujen uniikkeihin `(company_id, invoice_number)`,
  `(company_id, source_draft_id)` ja osittaiseen
  `(company_id, reference_number)`-rajoitteeseen
- laskurivien uniikkiin `(invoice_id, line_order)`-rajoitteeseen ja laskuun
  osoittavaan `ON DELETE RESTRICT` -viiteavaimeen
- audit-tapahtumien yritys- ja aikajärjestysindeksiin sekä laskuun osoittavaan
  `ON DELETE RESTRICT` -viiteavaimeen
- laskudokumenttien uniikkiin `(company_id, invoice_id, document_type)`-
  rajoitteeseen ja laskuun osoittavaan `ON DELETE RESTRICT` -viiteavaimeen

Tietokantayhteys ottaa SQLite-vierasavaimet käyttöön komennolla
`PRAGMA foreign_keys = ON`.

Tarkat laskuhaut käyttävät laskun ensisijaista avainta; mukana olevat
`company_id`- ja `status`-ehdot ovat samalla käyttöoikeus- ja tilarajoja. Uutta
yhdistelmäindeksiä ei tarvita nykyiselle local-MVP:n tunnistehaulle ilman
mitattua kyselyongelmaa. Uudelleenavattu lasku löytyy yrityksen ja
lähdeluonnoksen uniikkirajoitteen avulla. Numerointiluvut käyttävät taulujen
yhdistelmäavaimia ja dokumenttihaku dokumentin uniikkirajoitetta.

`invoice_number_sequences`-taulun erillinen `(company_id, series_key)`-indeksi
on nykyisen yhdistelmäavaimen vasemman reunan kanssa osittain päällekkäinen.
Sitä ei poisteta ilman erillistä query plan- ja migraatioarviota.

`invoice_drafts.approved_invoice_id` ja auditin `draft_id` ovat nykytilassa
sovellus- ja transaktiorajalla ylläpidettyjä tunnisteita, eivät tietokannan
viiteavaimia. Auditissa ei löytynyt niiden nykyisestä käytöstä rikkoutuvaa
viiteavainta tai tarvetta muuttaa skeemaa tämän refaktoroinnin vuoksi. Niiden
mahdollinen schema-hardening arvioidaan myöhemmin erillisenä migraatiotyönä.

## Hyväksytty tiedostojako

Tässä siivouserässä saa muodostua vain seuraava jako:

- `sqliteInvoiceApprovalRepository.ts`: julkisen portin toteutus,
  transaktiorajat ja kirjoitusten järjestys
- `invoiceApprovalPersistenceRows.ts`: puhtaat persistence-rivien
  muunnokset ja niiden kapeat tyypit
- `sqliteInvoiceApprovalQueries.ts`: saman tietokantayhteyden synkroniset,
  vain hyväksyntää palvelevat SELECT-kyselyt
- `sqliteInvoiceApprovalStatements.ts`: saman tietokantayhteyden synkroniset,
  vain hyväksyntäpolun auditoidut INSERT-, UPDATE- ja DELETE-operaatiot
- `sqliteInvoiceApprovalSnapshotReader.ts`: nykyinen snapshot-lähteiden
  reader

Query- ja statement-helperit eivät omista tietokantayhteyden elinkaarta,
transaktiota, välimuistia, numeron varausta, snapshotin kokoamista,
audit-päätöstä tai kirjoitusjärjestystä. Repository kutsuu niitä omien
transaktiocallbackiensa sisällä.

## Toteutusseuranta

| Vaihe | Tila | Lähtöcommit | Valmis commit | Huomiot |
| --- | --- | --- | --- | --- |
| Persistence-rajojen read-only-auditointi | Valmis | `cef6216` | `75242f6` | Julkinen portti, neljä transaktiopolkua, invariantit sekä indeksi- ja rajoitetilanne kirjattu |
| Myöhäisten virheiden rollback-testit | Valmis | `75242f6` | `73a7c18` | Reopen, mark sent ja reapproval palautuvat kokonaan audit-kirjoituksen epäonnistuessa |
| Puhtaiden persistence-rivien erotus | Valmis | `73a7c18` | `5bfa4f4` | Mapping ei tunne tietokantaa, SQL:ää, transaktioita, aikaa tai tunnisteiden luontia |
| Hyväksynnän SELECT-kyselyiden erotus | Valmis | `5bfa4f4` | `6fb0c0a` | Seitsemän synkronista kyselyä käyttää repositoryn kanssa samaa tietokantayhteyttä |
| SQLite approval write boundary -auditointi | Valmis, commit avoin | `4485256` | - | Yksitoista kirjoitusta, statement-järjestykset, yritys- ja tilarajat sekä rollback-vaikutukset auditoitu; pysäytysehtoa ei löytynyt |
| Puuttuvien write guard -karakterisointien täydennys | Seuraava | audit-commit | - | Vain nykyisen idempotenssin, tenant-rajojen, status guardien ja rollbackin testit |
| SQLite approval write statements -erotus | Hyväksytty auditin jälkeen | testicommit | - | SQL siirtyy kapeaan synkroniseen helperiin; transaktiot ja järjestys säilyvät repositoryssä |
| SQLite approval transaction orchestration -selkeytys | Hyväksytty vain vihreän statements-erotuksen jälkeen | statements-commit | - | Nimetyt yksityiset sync-metodit samassa repositoryssä; public-portti ja callback-rajat eivät muutu |

Auditointi antaa luvan vain yllä kuvatun statements-helperin toteutukseen sen
jälkeen, kun puuttuvat write guard -karakterisoinnit ovat vihreät. Repositoryn
public-metodit avaavat transaktiot jatkossakin. Transaction orchestrationin
nimettyjen yksityisten metodien erotus tehdään vasta statements-erotuksen
jälkeen eikä se anna lupaa siirtää transaktiorajaa repositoryn ulkopuolelle.

## Pysäytysehdot

Refaktorointi pysäytetään ja raportoidaan projektin omistajalle, jos työ
paljastaa:

- puuttuvan yritysrajauksen
- rikkoutuvan olemassa olevan viiteavaimen
- kirjoituspolun, joka ei ole nykyisen transaktion sisällä
- epäselvän numeron varauksen atomisuuden tai idempotenssin
- välttämättömän schema- tai migraatiomuutoksen
- ristiriidan tämän dokumentin, hyväksytyn ADR:n, moduuliohjeen tai toteutuksen
  välillä

Rakenteellinen pilkkominen ei ole lupa korjata tällaista havaintoa samassa
commitissa.
