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

## Vastuumatriisi

| Vastuu | Nykyinen omistaja | Hyväksytty tavoite tässä siivouksessa |
| --- | --- | --- |
| Puhtaat persistence-rivien muunnokset | SQLite approval repository | `invoiceApprovalPersistenceRows.ts` |
| Hyväksynnän SELECT-kyselyt | SQLite approval repository | `sqliteInvoiceApprovalQueries.ts` |
| Yritys- ja asiakassnapshotien luku | `SqliteInvoiceApprovalSnapshotReader` | Säilyy nykyisessä readerissä |
| INSERT-, UPDATE- ja DELETE-lauseet | SQLite approval repository | Säilyvät repositoryssä |
| Transaktioiden orkestrointi | SQLite approval repository | Säilyy repositoryssä |
| Numerointipäätös ja domain-validointi | Domain + repositoryn orkestrointi | Säilyy nykyisessä kutsuketjussa |
| Sekvenssin persistence | SQLite approval repository | Säilyy samassa hyväksyntätransaktiossa |
| Audit-rivin muodostus | SQLite approval repository | Puhdas mapping siirtyy rows-tiedostoon |
| Audit-rivin kirjoitus | SQLite approval repository | Säilyy repositoryssä |
| PDF-metadatan poisto reopenissa | SQLite approval repository | Säilyy repositoryn transaktiossa |
| Varsinaisen PDF-tiedoston poisto | Application/storage-adapteri | Ei muutu |

Mahdollinen tuleva `sqliteInvoiceApprovalStatements.ts` arvioidaan vasta, kun
read query -erotus ja rollback-testit ovat vakaat. Tätä tiedostoa tai erillistä
write-adapteria ei ole hyväksytty toteutettavaksi tässä vaiheessa.

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
  transaktiot ja kaikki kirjoituslauseet
- `invoiceApprovalPersistenceRows.ts`: puhtaat persistence-rivien
  muunnokset ja niiden kapeat tyypit
- `sqliteInvoiceApprovalQueries.ts`: saman tietokantayhteyden synkroniset,
  vain hyväksyntää palvelevat SELECT-kyselyt
- `sqliteInvoiceApprovalSnapshotReader.ts`: nykyinen snapshot-lähteiden
  reader

Query-helper ei omista tietokantayhteyden elinkaarta, transaktiota,
välimuistia, kirjoituksia, numeron varausta, snapshotin kokoamista tai
auditointia. Repository kutsuu helperiä olemassa olevien transaktiocallbackien
sisällä.

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
