# SQLite Invoice Delivery Event Persistence Plan

Tämä dokumentti kuvaa Invoicing-moduulin nykyisen SQLite-persistenssin portit,
yritysrajat, tilasiirtymät, transaktiot ja tunnetut
puolustusrajat. Auditoinnin baseline on commit `786d4a4`.

Dokumentti on nykytilan auditointi ja myöhemmän käyttäytymisen säilyttävän
siivouksen lähtökohta. Se ei muuta portteja, SQL-lauseita, migraatioita,
tilasiirtymiä tai liiketoimintasääntöjä.

## Omistajuus Ja Rajaus

`SqliteInvoiceDeliveryEventRepository` toteuttaa neljä kapeaa porttia:

- `InvoiceDeliveryEventRepository` tallentaa ja täydentää yksittäisiä
  toimitustapahtumia
- `InvoiceDeliveryEventReader` lukee ratkaisemattoman tapahtuman olemassaolon
  ja turvallisen toimitushistorian
- `InvoiceEmailDeliveryFinalizer` viimeistelee varmasti onnistuneen
  sähköpostitoimituksen ja laskun `sent`-tilan atomisesti
- `InvoiceManualDeliveryFinalizer` viimeistelee manuaalisen toimituksen,
  laskun `sent`-tilan ja audit-tapahtuman atomisesti

Porttien toteuttaminen yhdessä adapterissa ei itsessään riko moduulirajaa.
Kaikki operaatiot käsittelevät Invoicingin omistamia tauluja samalla
`DatabaseConnection`-yhteydellä. Repository-portit eivät paljasta SQLite- tai
`better-sqlite3`-tyyppejä.

## Skeeman Nykyiset Rajat

`invoice_delivery_events` sisältää:

- ensisijaisen avaimen `id`
- vierasavaimen `invoice_id -> invoices.id` arvolla `ON DELETE RESTRICT`
- valinnaisen vierasavaimen `document_id -> invoice_documents.id` arvolla
  `ON DELETE SET NULL`
- sallitut delivery method-, provider- ja statusarvot rajaavat `CHECK`-
  ehdot
- pituusrajat vastaanottajalle, kopiolle, otsikolle, `body_preview`-arvolle,
  provider-tunnisteelle sekä turvallisille ja teknisille virhekentille
- yritys- ja laskurajatun listauksen indeksin
  `(company_id, invoice_id, created_at)`

Nykyiset vierasavaimet varmistavat tunnisteiden olemassaolon. Ne eivät
varmista, että eventin `company_id`, laskun `company_id` ja dokumentin
`company_id` ovat samat tai että dokumentti kuuluu eventin laskulle.

## Operaatioiden Matriisi

### `saveDeliveryEvent`

- Portti: `InvoiceDeliveryEventRepository`
- Kirjoittaa: `invoice_delivery_events`
- Lukee implisiittisesti: SQLite tarkistaa `invoices`- ja
  `invoice_documents`-vierasavaimet
- Rajaus: insert käyttää eventin `id`, `companyId`, `invoiceId` ja
  `documentId` sellaisinaan
- Lähtötila: application-kerroksen validoima `prepared`, `attempted`,
  `succeeded`, `failed` tai `outcomeUnknown`
- Lopputila: sama kuin eventissä annettu tila
- Idempotenssi: ei ole idempotentti; sama `id` rikkoo ensisijaisen avaimen
- Transaktio: ei erillistä transaktiota, koska operaatio on yksi `INSERT`
- Rollback: epäonnistunut `INSERT` ei jätä osittaista riviä
- Application-ennakkoehto: nykyiset kutsujat hakevat laskun yritysrajatusti ja
  muodostavat tai hakevat current PDF:n samalla `companyId + invoiceId`
  -rajalla ennen eventin kirjaamista

### `completeDeliveryEvent`

- Portti: `InvoiceDeliveryEventRepository`
- Kirjoittaa: `invoice_delivery_events`
- Rajaus: `eventId + companyId + status = attempted`
- Invoice-raja: portti ei vastaanota `invoiceId`-arvoa
- Sallittu siirtymä: `attempted -> succeeded | failed | outcomeUnknown`
- Idempotenssi: terminal eventin toinen täydentäminen hylätään, koska
  `changes !== 1`
- Transaktio: ei erillistä transaktiota, koska operaatio on yksi `UPDATE`
- Rollback: guardin epäonnistuessa mitään kenttää ei muuteta
- Application-ennakkoehto: eventin tunniste syntyy saman lähetysyrityksen
  `recordInvoiceDeliveryEvent`-vaiheessa ja kertakäyttöinen send attempt sitoo
  sen käyttäjään, yritykseen ja laskuun ennen provider-kutsua

### `completeSuccessfulEmailDelivery`

- Portti: `InvoiceEmailDeliveryFinalizer`
- Lukee: `invoices`
- Kirjoittaa: `invoice_delivery_events`, tarvittaessa `invoices`
- Invoice-raja: `companyId + invoiceId + status IN (approved, sent)`
- Event-raja: `eventId + companyId + invoiceId + status = attempted`
- Sallittu siirtymä:
  - ensimmäinen toimitus: event `attempted -> succeeded`, lasku
    `approved -> sent`
  - uudelleenlähetys: event `attempted -> succeeded`, lasku pysyy `sent`
- Idempotenssi: saman eventin toinen viimeistely hylätään; `sent`-laskun uusi
  event viimeistellään uudelleenlähetyksenä muuttamatta laskun aikaleimaa
- Transaktio: repository omistaa yhden synkronisen SQLite-transaktion
- Kirjoitusjärjestys: laskun luku -> eventin päivitys -> ehdollinen laskun
  päivitys
- Rollback: eventin päivitys palautuu, jos laskun myöhempi statuspäivitys
  epäonnistuu; yksikään osatila ei saa jäädä voimaan

### `completeManualDelivery`

- Portti: `InvoiceManualDeliveryFinalizer`
- Lukee: `invoices`
- Kirjoittaa: `invoice_delivery_events`, `invoices`,
  `invoice_audit_events`
- Invoice-raja: `companyId + invoiceId + status IN (approved, sent)`
- Event-raja: uusi event käyttää finalizerille annettuja yritys-, lasku- ja
  dokumenttitunnisteita
- Sallittu siirtymä:
  - `approved -> sent`, samalla suoraan `succeeded`-tilainen manual/print-event
    ja `invoice.marked_sent_manually`-audit
  - `sent -> sent` on idempotentti no-op
- Idempotenssi: jo lähetetty lasku ei saa uutta eventtiä, auditia tai
  aikaleimaa
- Transaktio: repository omistaa yhden synkronisen SQLite-transaktion
- Kirjoitusjärjestys: laskun luku -> eventin insert -> laskun statuspäivitys
  -> audit insert
- Rollback: event ja laskun status palautuvat, jos status- tai audit-kirjoitus
  epäonnistuu
- Application-ennakkoehto: `markApprovedInvoiceSent` tarkistaa ennen
  finalizeria, ettei laskulla ole ratkaisemattomia eventtejä, ja varmistaa
  current PDF:n

### `hasUnresolvedDeliveryEvent`

- Portti: `InvoiceDeliveryEventReader`
- Lukee: `invoice_delivery_events`
- Rajaus: `companyId + invoiceId`
- Ratkaisemattomat tilat: `attempted`, `outcomeUnknown`
- Palautus: boolean, ei eventin sisältöä
- Transaktio: ei avaa transaktiota
- Sivuvaikutukset: ei kirjoituksia eikä cachea

### `listDeliveryEvents`

- Portti: `InvoiceDeliveryEventReader`
- Lukee: `invoice_delivery_events`
- Rajaus: `companyId + invoiceId`
- Järjestys: `created_at DESC, id DESC`
- Palauttaa: id, aika, delivery method, provider, vastaanottaja, Cc,
  turvallinen virheviesti ja status
- Ei palauta: subject, body preview, provider message id tai technical error
  code
- Transaktio: ei avaa transaktiota
- Sivuvaikutukset: ei kirjoituksia eikä cachea
- Application-ennakkoehto: listauspolku varmistaa ensin yritysrajatulla
  approved invoice -lukijalla, että lasku on näkyvissä actorin yritykselle

## Tilasiirtymämatriisi

| Lähtötila | Sallittu nykyinen persistence-polku | Lopputila | Huomio |
| --- | --- | --- | --- |
| ei eventtiä | `saveDeliveryEvent` | `prepared` | Dry-run/valmistelutieto voidaan tallentaa; nykyinen preview ei tee tätä |
| ei eventtiä | `saveDeliveryEvent` | `attempted` | Oikea SMTP-yritys kirjataan ennen provider-kutsua |
| ei eventtiä | `saveDeliveryEvent` | `succeeded` | Dry-run-onnistuminen ja manuaalinen toimitus tallentuvat suoraan terminal-tilaan |
| ei eventtiä | `saveDeliveryEvent` | `failed` | Dry-run-virhe voidaan tallentaa suoraan terminal-tilaan |
| ei eventtiä | `saveDeliveryEvent` | `outcomeUnknown` | Porttityyppi sallii arvon, vaikka nykyinen SMTP-polku aloittaa `attempted`-tilasta |
| `attempted` | `completeDeliveryEvent` | `succeeded` | SMTP-testin varmasti onnistunut tulos |
| `attempted` | `completeDeliveryEvent` | `failed` | Providerin varmasti epäonnistunut tulos |
| `attempted` | `completeDeliveryEvent` | `outcomeUnknown` | Providerin lopputulosta ei voida varmistaa |
| `attempted` | `completeSuccessfulEmailDelivery` | `succeeded` | Samassa transaktiossa lasku `approved -> sent` tai sent-uudelleenlähetys |
| `prepared` | ei täydentävää repository-polkuja | - | Terminal-päivityksen attempted-guard estää siirtymän |
| `succeeded` | ei uutta siirtymää | - | Terminal-eventtiä ei voi täydentää uudelleen |
| `failed` | ei uutta siirtymää | - | Terminal-eventtiä ei voi täydentää uudelleen |
| `outcomeUnknown` | ei nykyistä ratkaisupolkua | - | Estää uuden tavallisen lähetyksen ja manuaalisen toimituksen ennakkotarkistuksessa |

## Kirjoitusrajan Auditointi

Jäljellä olevat kirjoitusstatementit kuuluvat samaan Invoicingin SQLite-
adapteriin. Kaikki muuttuvat arvot välitetään nimettyinä parametreina.
Statementit eivät omista transaktioita, tunnisteiden tai aikojen generointia
eivätkä statementtien välistä suoritusjärjestystä.

| Operaatio | Taulu ja statement | Input ja guardit | `changes` ja virhe | Luotettu luku ja rollback-raja |
| --- | --- | --- | --- | --- |
| Varmasti onnistuneen email-eventin viimeistely | `invoice_delivery_events`, `UPDATE` | `companyId`, `invoiceId`, `eventId`, `providerMessageId`; `id + company_id + invoice_id + status = attempted` | vaatii `changes === 1`; `Invoice delivery event could not be completed.` | luottaa saman transaktion aiempaan `companyId + invoiceId + approved/sent` -laskuhakuun; myöhempi laskun statusvirhe peruu event-päivityksen |
| Yleinen terminal-päivitys | `invoice_delivery_events`, `UPDATE` | `companyId`, `eventId`, terminal-status sekä provider- ja virhekentät; `id + company_id + status = attempted` | vaatii `changes === 1`; `Invoice delivery event could not be completed.` | ei repositoryn aiempaa SELECTiä; application-polku sitoo eventin vahvistettuun lähetysyritykseen; yksittäinen statement joko onnistuu tai epäonnistuu kokonaan |
| Laskun merkitseminen lähetetyksi | `invoices`, `UPDATE` | `companyId`, `invoiceId`, `sentAt`; `company_id + id + status = approved` | vaatii `changes === 1`; `Approved invoice could not be marked sent.` | luottaa saman transaktion aiempaan yritysrajattuun laskuhakuun; email-polussa sen virhe peruu event-päivityksen, manual-polussa sen virhe peruu delivery-eventin INSERTin |
| Delivery-eventin tallennus | `invoice_delivery_events`, `INSERT` | koko `InvoiceDeliveryEvent` persistence-riviksi muunnettuna; PK-, FK-, enum- ja pituusrajat ovat skeemassa | ei erillistä `changes`-tarkistusta; SQLite constraint -virhe välitetään kutsujalle | nykyiset application-polut luottavat aiempaan `companyId + invoiceId` -lasku- ja dokumenttihakuun; yksittäinen INSERT ei jätä osittaista riviä, manual-transaktiossa myöhempi status- tai audit-virhe peruu INSERTin |
| Manuaalisen toimituksen audit-event | `invoice_audit_events`, `INSERT` | `auditEventId`, `companyId`, `actorUserId`, vakioaction, laskuhaun `sourceDraftId` ja `invoiceNumber`, `invoiceId`, `deliveredAt` | ei erillistä `changes`-tarkistusta; SQLite constraint -virhe välitetään kutsujalle | luottaa saman transaktion yritysrajattuun manual-laskuhakuun; sen virhe peruu delivery-eventin ja laskun statuspäivityksen |

### Kirjoitusjärjestykset

Varmasti onnistunut sähköpostitoimitus tehdään yhdessä synkronisessa
SQLite-transaktiossa:

1. lasku haetaan `companyId + invoiceId` -rajalla tilassa `approved` tai `sent`
2. `attempted`-event päivitetään `succeeded`-tilaan yritys- ja laskurajattuna
3. `approved`-lasku päivitetään tarvittaessa `sent`-tilaan

Manuaalinen toimitus tehdään yhdessä synkronisessa SQLite-transaktiossa:

1. lasku haetaan `companyId + invoiceId` -rajalla tilassa `approved` tai `sent`
2. `sent`-lasku palautetaan idempotenttina no-opina
3. ratkaisematon event tarkistetaan saman transaktion sisällä
4. suoraan `succeeded`-tilainen manual/print-event tallennetaan
5. lasku päivitetään `approved -> sent`
6. `invoice.marked_sent_manually`-audit-event tallennetaan

Yksittäiset polut eivät avaa erillistä transaktiowrapperia:

- `saveDeliveryEvent` tekee yhden delivery-eventin `INSERT`-statementin
- `completeDeliveryEvent` tekee yhden `attempted -> terminal` -`UPDATE`-
  statementin

Molempien finalizerien laskun `approved -> sent` -statementit ovat SQL:n,
nimettyjen parametrien, `changes === 1` -ehdon ja virheviestin osalta
identtiset. Ne voidaan toteuttaa yhdellä tarkasti nimetyllä synkronisella
statement-metodilla muuttamatta nykyistä käyttäytymistä. Auditointi ei
paljastanut uutta turvallisuus- tai datan eheysvirhettä. Tunnettu
company/invoice/document-ristiinlinkityksen defense-in-depth-puute pidetään
erillään tästä käyttäytymisen säilyttävästä työerästä.

## Tenant- Ja Dokumenttirajojen Audit

### Eventin Yritys Ja Lasku

`saveDeliveryEvent` voi suoraan kutsuttuna tallentaa eventin, jonka
`company_id` ei vastaa `invoice_id`-arvon laskun yritystä. Vierasavain
varmistaa vain laskun olemassaolon.

Nykyiset HTTP/application-polut eivät anna `companyId`-arvoa request bodysta.
Ne muodostavat sen vahvistetusta `ActorContext`-kontekstista, hakevat laskun
`companyId + invoiceId` -rajalla ja vasta tämän jälkeen kirjaavat eventin.
Siksi havainto ei ole nykyisestä ulkoisesta reitistä saavutettava tenant-vuoto,
vaan luotetun application-portin ennakkoehto ja persistence-tason
defense-in-depth-puute.

### Eventin Dokumentti

`document_id`-vierasavain ei varmista dokumentin yritystä tai laskua. Suoraan
porttia kutsuva koodi voisi liittää eventtiin toisen yrityksen dokumentin tai
saman yrityksen toisen laskun dokumentin.

Nykyiset dry-run-, SMTP-testi-, asiakaslähetys- ja manuaalisen toimituksen
application-polut eivät hyväksy dokumenttitunnistetta frontendiltä. Backend
varmistaa tai hakee current PDF:n `companyId + invoiceId` -rajalla ja välittää
sen tunnisteen repositorylle. Havainto on siten nykyisessä compositionissa
luotetun portin ennakkoehto ja defense-in-depth-puute, ei todettu ulkoisesti
saavutettava dokumentti- tai tenant-vuoto.

Mahdollinen persistence-tason vahvistaminen vaatisi erillisen suunnitelman,
testit ja mahdollisesti skeema- tai SQL-muutoksen. Sitä ei yhdistetä
käyttäytymisen säilyttävään refaktorointiin.

## Turvallisuushavainto: Manuaalisen Toimituksen Rinnakkaisuusikkuna

Nykyinen `markApprovedInvoiceSent` tekee ratkaisemattoman eventin tarkistuksen
application-kerroksessa ennen current PDF:n varmistamista ja ennen
`completeManualDelivery`-transaktiota:

```text
hasUnresolvedDeliveryEvent
  -> ensureApprovedInvoicePdfDocument
    -> completeManualDelivery transaction
```

Tarkistus ja finalisointi eivät kuulu samaan SQLite-transaktioon. Rinnakkainen
SMTP-send voi lisätä `attempted`-eventin tarkistuksen jälkeen mutta ennen
manuaalisen toimituksen transaktiota. Tällöin manuaalinen toimitus voi:

- kirjata oman onnistuneen delivery eventin
- muuttaa laskun `sent`-tilaan
- kirjata audit-tapahtuman

vaikka samalla laskulla on jo ratkaisematon sähköpostitoimitus. SMTP-tulos voi
myöhemmin onnistua, epäonnistua tai jäädä `outcomeUnknown`-tilaan. Seurauksena
voi olla tahaton kaksoistoimitus tai `sent`-lasku, jolla on edelleen
ratkaisematon sähköpostitapahtuma.

Rinnakkaisuusikkuna on nykyisistä business-reiteistä periaatteessa
saavutettava kahdella limittäisellä pyynnöllä. Se ei ole tenant-tietovuoto,
mutta se rikkoo dokumentoitua toimituksen eheysinvarianttia. Havainto
luokitellaan rajatuksi toimituksen tilasiirtymä- ja rinnakkaisuusriskiksi,
joka korjattiin omassa toiminnallisessa turvallisuuscommitissaan `d6d6935`
ennen repositoryn refaktoroinnin jatkamista.

Korjauksessa ratkaisemattoman eventin tarkistus ja manuaalinen finalisointi
tehtiin yhdeksi atomiseksi SQLite-päätökseksi. Application-tason ennakkotarkistus
säilyi nopeana käyttäjäpolun guardina, mutta repository varmistaa invariantin
uudelleen omassa transaktiossaan. Korjausta ei yhdistetty row mapping- tai read
query -erotukseen.

## Säilytettävät Invariantit

- kaikki muuttuvat SQL-arvot ovat parametrisoituja
- `companyId` tulee application-poluille vahvistetusta `ActorContext`-
  kontekstista
- eventin terminal-päivitys vaatii aina `status = attempted`
- onnistunut SMTP-finalisointi sitoo eventin sekä yritykseen että laskuun
- lasku siirtyy `sent`-tilaan vain varmasti onnistuneen asiakaslähetyksen tai
  manuaalisen toimituksen seurauksena
- SMTP-eventin onnistuminen ja laskun `sent`-siirtymä ovat atomisia
- manual event, laskun `sent`-siirtymä ja audit ovat atomisia
- sent-laskun manuaalinen finalisointi on no-op
- sent-laskun SMTP-uudelleenlähetys käyttää uutta eventtiä eikä muuta laskun
  alkuperäistä `updated_at`-arvoa
- toimitushistoria ei palauta teknisiä tai tarpeettomia viestikenttiä

## Toteutusseuranta

| Vaihe | Commit | Tulos |
| --- | --- | --- |
| Persistence boundary -auditointi | `3847ef1` | Portit, yritysrajat, tilasiirtymät ja transaktiot dokumentoitu |
| Manuaalisen toimituksen atominen guard | `d6d6935` | Rinnakkaisuusikkuna suljettu repositoryn transaktion sisällä |
| Characterization-testit | `3529a05` | Tenant-, invoice-, guard-, rollback- ja idempotenssipolut suojattu |
| Row mapping -erotus | `7d45eca` | Puhtaat persistence-muunnokset erotettu ilman SQL-vastuuta |
| Read query -erotus | `039bbd1` | Neljä synkronista SELECT-vastuuta erotettu samaa yhteyttä käyttävään helperiin |

Seuraavaksi voidaan erikseen arvioida SQLite invoice delivery event write
statements and transaction orchestration. Tämä kirjaus ei anna lupaa toteuttaa
sitä eikä muuttaa kirjoitusjärjestystä, transaktioita tai julkisia portteja.
