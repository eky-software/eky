# SQLite Invoice Draft Persistence Plan

Tämä dokumentti kuvaa Invoicing-moduulin nykyisen laskuluonnosten SQLite-
persistenssin portin, yritysrajat, transaktiot ja rollback-invariantit.
Auditoinnin baseline on commit `f5dea7a`.

Dokumentti toimii käyttäytymisen säilyttävän rakenteellisen siivouksen
lähtökohtana. Se ei muuta repository-porttia, SQL-lauseita, migraatioita,
domain-sääntöjä tai application-palvelujen käyttäytymistä.

## Omistajuus Ja Rajaus

`SqliteInvoiceDraftRepository` toteuttaa `InvoiceDraftRepository`-portin.
Portti ei paljasta SQLite- tai `better-sqlite3`-tyyppejä. Adapteri käyttää
Invoicing-moduulin omistamia tauluja `invoice_drafts` ja
`invoice_draft_lines` samalla `DatabaseConnection`-yhteydellä.

Application-kerros validoi ennen repository-kutsuja tunnisteet, päivämäärät,
maksuehdot, asiakas- ja laskun vastaanottajarajaukset, tekstit, yksiköt,
määrät, hinnat, ALV-kannat ja alennukset. Se muodostaa tunnisteet ja
aikaleimat sekä laskee rivit ja summat domain-funktioilla. Repository ei
laske laskun summia eikä tarkista Customers-moduulin omistamaa dataa.

## Skeeman Nykyiset Rajat

`invoice_drafts` sisältää globaalin `id`-pääavaimen sekä yritysrajattujen
listausten indeksit `(company_id, updated_at)` ja
`(company_id, customer_id)`. Luonnoksen status on nykyisessä skeemassa
`draft`. Hyväksyntäpolku lisää luonnokselle `approved_invoice_id`- ja
`approved_at`-arvot.

`invoice_draft_lines` sisältää:

- globaalin `id`-pääavaimen
- vierasavaimen `invoice_draft_id -> invoice_drafts.id` arvolla
  `ON DELETE CASCADE`
- uniikkirajan `(invoice_draft_id, position)`
- indeksin `(invoice_draft_id, position)`
- positiolle ehdon `position >= 1`
- rahalle, määrälle, ALV:lle ja alennukselle ei-negatiivisuusrajat
- alennustyypin allowlistin
- yksikölle ei-tyhjän ja enintään kahdeksan merkin rajan

Listausten vakaa järjestys on `updated_at DESC, id DESC`. Rivit luetaan
`position`-järjestyksessä ja ALV-erittely `vat_rate_basis_points`-
järjestyksessä.

## Operaatiot

### `saveDraft`

- Public-portti: `InvoiceDraftRepository.saveDraft`
- Kirjoittaa: `invoice_drafts`, `invoice_draft_lines`
- Yritysraja: headerin `company_id` tulee application-kerroksen validoimasta
  ja backendin vahvistamaan kontekstiin sidotusta domain-oliosta
- Guardit: INSERT luottaa application/domain-validointiin ja skeeman
  rajoitteisiin; olemassa olevaa tunnistetta ei korvata
- Transaktio: repository omistaa yhden synkronisen SQLite-transaktion
- Järjestys: headerin `INSERT`, sitten rivien `INSERT` annetussa järjestyksessä
- Rollback: yhdenkin rivin virhe palauttaa headerin ja kaikki jo lisätyt rivit
- Idempotenssi: operaatio ei ole idempotentti; sama draft- tai line-id
  hylätään skeeman rajoitteella
- Row mapping: domain-luonnos muunnetaan header-riviksi ja domain-rivit
  persistence-riveiksi ennen transaktiota; alennus muunnetaan
  `discount_type + discount_value` -muotoon

### `updateDraft`

- Public-portti: `InvoiceDraftRepository.updateDraft`
- Lukee implisiittisesti: headerin guardatun UPDATE-operaation `changes`-arvon
- Kirjoittaa: `invoice_drafts`, `invoice_draft_lines`
- Yritys- ja tilaraja: `company_id + id + status = draft +
  approved_invoice_id IS NULL`
- Transaktio: repository omistaa yhden synkronisen SQLite-transaktion
- Järjestys:
  1. yritys- ja tilarajattu headerin `UPDATE`
  2. jos `changes !== 1`, palauta `false` ilman muita kirjoituksia
  3. vanhojen rivien `DELETE`
  4. uusien rivien `INSERT`
- Rollback: minkä tahansa uuden rivin insert-virhe palauttaa headerin ja kaikki
  poistetut vanhat rivit alkuperäiseen tilaan
- Idempotenssi: sama sisältö voidaan kirjoittaa uudelleen, mutta operaatio on
  päivitys eikä idempotenssiavaimella suojattu komento
- Row mapping: sama domain-to-row-muunnos kuin tallennuksessa; luettuja
  summia ei lasketa adapterissa

Rivien `DELETE` käyttää vain `invoice_draft_id`-arvoa. Tämä on nykyisessä
rakenteessa turvallinen, koska se suoritetaan vasta saman transaktion sisällä
onnistuneen, yritys- ja tilarajatun header-päivityksen jälkeen. Draftin `id`
on globaali pääavain. Guardin epäonnistuessa rivipoistoa ei suoriteta.

### `deleteDraft`

- Public-portti: `InvoiceDraftRepository.deleteDraft`
- Kirjoittaa: `invoice_drafts`; SQLite poistaa rivit FK-cascadella
- Yritys- ja tilaraja: `company_id + id + status = draft +
  approved_invoice_id IS NULL`
- Transaktio: yksi atominen `DELETE`, ei erillistä repository-transaktiota
- Palautus: `true` vain, kun täsmälleen yksi header poistui
- Idempotenssi: ensimmäinen onnistuu ja myöhempi kutsu palauttaa `false`
- Hyväksyttyä tai toisen yrityksen luonnosta ei poisteta eikä sen riveihin
  kosketa

### `getDraftById`

- Public-portti: `InvoiceDraftRepository.getDraftById`
- Lukee: `invoice_drafts`, `invoice_draft_lines`
- Yritys- ja tilaraja: header `company_id + id + status = draft +
  approved_invoice_id IS NULL`; rivi- ja ALV-kyselyt liittyvät samaan
  yritysrajattuun draft-headeriin
- Transaktio: ei avaa transaktiota eikä kirjoita
- Järjestys: header, rivit position-järjestyksessä, ALV-erittely kannoittain
- Row mapping: persistence-rivit muunnetaan domain-luonnokseksi; tallennettu
  alennustyyppi validoidaan ja tuntematon tyyppi hylätään
- Summat: headerin tallennetut kokonaissummat ja riveistä SQL:llä ryhmitelty
  ALV-erittely palautetaan; application-lukupolku muodostaa lopullisen
  näkymän domainin laskentasäännöillä

### `listDraftSummaries`

- Public-portti: `InvoiceDraftRepository.listDraftSummaries`
- Lukee: vain `invoice_drafts`
- Yritys- ja tilaraja: aina `company_id + status = draft +
  approved_invoice_id IS NULL`
- Valinnainen suodatus: lisäksi `customer_id`
- Transaktio: ei avaa transaktiota eikä kirjoita
- Järjestys: `updated_at DESC, id DESC`
- Palauttaa: rajatun `InvoiceDraftSummary`-rakenteen ilman rivejä,
  vastaanottajatietoja, muistiinpanoa tai Customers-moduulin dataa
- Row mapping: summary-row muunnetaan domainin summary-tyypiksi

## Rollback- Ja Turvallisuusbaseline

Nykyiset testit käyttävät oikeaa in-memory SQLite-kantaa ja vahvistavat:

- save-transaktion rollbackin rivivirheessä
- update-transaktion rollbackin rivien korvaamisen aikana
- yritysrajatut get-, list-, update- ja delete-operaatiot
- hyväksytyn luonnoksen guardit
- FK-cascaden luonnoksen poistossa
- rivien järjestyksen, alennusten ja ALV-erittelyn palautumisen
- summary-listauksen vakaan järjestyksen ja rajatun response-muodon
- parametrien käsittelyn myös SQL-injektiota muistuttavilla tunnisteilla

Auditoinnissa ei löytynyt aktiivista tenant-, transaktio- tai datan
eheysvirhettä. Rakenteellisessa jaossa repositoryn pitää edelleen omistaa
save- ja update-transaktiot, kirjoitusten järjestys sekä päätös siitä,
jatketaanko headerin update-guardin jälkeen.
