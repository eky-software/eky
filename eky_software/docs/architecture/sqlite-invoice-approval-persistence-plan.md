# SQLite-hyväksyntäpersistenssin rajat

## Nykyinen revisiojulkaisu

Tämä osuus omistaa hyväksytyn B:n SQLite-julkaisu- ja migraatiosopimuksen.
[Laskuidentiteetti ja täydet 64/18/11-kenttäluettelot](invoice-approval-numbering-plan.md#muuttumaton-sisältörevisio)
kuuluvat hyväksyntäsopimukseen. Alla avattava vanha rakenteellisen jaon
auditointi ei määritä nykyistä reopen-poistoa, porttia tai DDL:ää.

Hyväksyntä ja uudelleenhyväksyntä julkaisevat saman validoidun olion nyky-
projektioon ja historiaan nykyisessä synkronisessa `IMMEDIATE`-transaktiossa:
numerointi/projektio, revision rivit ja ALV-erittely, **otsikko viimeisenä**,
current-osoitin, audit ja luonnoslinkki. Reopen vaihtaa laskun tilan, vapauttaa
luonnoksen, irrottaa currentin ja kirjoittaa auditin atomisesti. Se ei poista
dokumenttimetatietoja eikä palauta poistettavien PDF:ien polkuja.
Kaikki käyttötavan luvut ja kirjoitukset käyttävät samaa yhteyttä,
parametrisoitua SQL:ää ja luotettua company-kontekstia. Ei tiedosto-/verkko-
`await`-operaatioita transaktioon.

### Täydet DDL-ehdot ja julkaisuportti

Täsmällinen suoritettava DDL, triggerit, indeksit ja legacy-kopio ovat
[muuttumattomassa migraatiossa 039](../../apps/backend/src/database/migrations/039_add_invoice_content_revisions.sql).
Se on tämän sopimuksen tarkka SQL-liite, ei lupa korjata historiallista
migraatiota. Seuraavat ehdot luetaan yhdessä koko SQL-liitteen kanssa
DDL-/adapterimuutoksessa; pelkkä taulun nimi tai tyyppimääritys ei riitä.

| Taulu | Avaimet ja täydet sidosehdot |
| --- | --- |
| `invoice_content_revisions` | Ei-tyhjät id/company/invoice; opaque id PK; origin vain approval/legacySnapshot/validatedLegacySnapshot. UNIQUE(company_id,invoice_id,id) ja sama tuple + invoice_number,invoice_date. FK(company_id,invoice_id) -> invoices(company_id,id), RESTRICT. Hyvityslähteen company/credited_invoice/revision/number/date-tuplen FK saman revision vastaavaan UNIQUE-avaimeen, RESTRICT. |
| `invoice_revision_lines` | PK(revision_id,line_id), UNIQUE(revision_id,line_order), UNIQUE(company_id,revision_id,line_id). FK(company_id,invoice_id,revision_id) -> revision(company_id,invoice_id,id); lähderivin FK(company_id,source_revision_id,source_invoice_line_id) -> saman yrityksen revision rivi. Molemmat RESTRICT, DEFERRABLE INITIALLY DEFERRED. Ei pelkkää line-ID-pääavainta. |
| `invoice_revision_vat_breakdown` | PK(revision_id,vat_rate_basis_points), scoped revision-FK RESTRICT, DEFERRABLE INITIALLY DEFERRED; kunkin ryhmän gross = net + vat. |
| `invoice_current_revisions` | PK(company_id,invoice_id), scoped revision-FK RESTRICT. Vain osoitin on vaihdettava; reopen poistaa sen, ei historiaa. |
| `invoice_documents` | Säilyvät ID ja vanhat kentät; document_type = approved_invoice_pdf, MIME application/pdf, ei-tyhjä file_name/storage_path, 64-merkkinen hash ja positiivinen koko. UNIQUE-tuplet (company,invoice,id), sama + binding_kind, sama + revision_id, sama + sha256,size_bytes. Scoped invoice-/revision-FK RESTRICT; source-tuplen company/invoice/source_document/hash/size FK alkuperäiseen dokumenttiin RESTRICT. |
| `invoice_delivery_events` | Säilyvät ID ja viestikentät, ei uutta completion-aikaa. Scoped invoice-FK RESTRICT; kolme erillistä document-FK:ta company/invoice/document + binding_kind, + revision_id sekä + hash/size, kaikki RESTRICT. Nullable revision ei saa poistaa ei-null-documentin yritys-/lasku-/varianttirajaa. |

Snapshot-, revision-line-, VAT-, document- ja event-taulut ovat
`WITHOUT ROWID`. Current-osoitintaulu ei ole muuttumaton snapshot.
Kaikki FK-vanhempien UNIQUE-avaimet luodaan ennen riippuvia inserttejä;
invoices(company_id,id) on eksplisiittinen UNIQUE. Vanha M1:n ehdottama
pidempi line-UNIQUE ei ole erillinen lisävaatimus: hyväksytty 039 käyttää
yllä täsmällisesti nimettyä company/revision/line-avainta ja revision
company/invoice-FK:ta.

Snapshotin CHECK-ehdot:

- `legacySnapshot` <=> `vat_breakdown_state=unavailable`; muut alkuperät
  vaativat authoritative. Standardilla kaikki neljä credited-lähdekenttää
  ovat null. Creditillä ne ovat ei-null ja lähdelasku eri kuin oma lasku.
- Viitenumero ja tyyppi ovat molemmat null tai molemmat ei-null ja tyyppi
  `finnishDomestic`. Suorituspäivä tai molemmat jakson päät, ei molempia;
  SQL:n date-tarkistus ja start <= end. Nullable-parit eivät saa läpäistä
  CHECKiä SQL:n UNKNOWN-tuloksella.
- sequence_number ja line_order ovat integer 1..9007199254740991.
  payment_term_days, summat, rivin quantity/unit_price/discount/base/net/vat/gross
  sekä VAT-ryhmän kanta ja summat ovat integer 0..9007199254740991.
  reminder_period_days 0..365; late_payment_interest_basis_points 0..100000.
  Nämä ovat nykyisen DDL:n rajat, eivät uusi korkopäätös.
- numbering_mode on fiscalYearSequence/calendarYearSequence/plainSequence,
  price_input_mode net/gross, invoice_kind standard/credit,
  discount_type none/percentage/fixed ja tax_treatment
  normalVat/reverseChargeConstruction. line_id ei ole tyhjä,
  trim(description) ei tyhjä ja trim(unit) pituus 1..8.
  Rivin nullable verokanta on null tai turvallinen ei-negatiivinen integer.
- normalVat käyttää tyhjiä tax-label/legal-basis-snapshotteja.
  reverseChargeConstruction vaatii net-syötön, nollaveron, net=gross ja
  täsmätekstit `Käännetty verovelvollisuus` sekä `AVL 8 c §`.
  Muu kuin legacySnapshot vaatii myös otsikolla net+vat=gross.
- Rivin source_invoice_line_id ja source_revision_id ovat yhtä aikaa null
  tai ei-null. Otsikon insert varmistaa creditin standard-lähteen ja kaikkien
  lähderivien saman credited_revision_id:n. Rivien tax-käsittely vastaa otsikkoa.
- Unavailable ei sisällä VAT-rivejä; uusi authoritative-revisio sisältää
  laskurivejä. Käännetyllä ALV:lla VAT-erittely on tyhjä ja nollavero/net=gross.
  NormalVat vaatii erittelyn, kaikkien kolmen ryhmäsumman vastaavuuden otsikkoon
  sekä rivien/ryhmien verokantojen kattavuuden molempiin suuntiin.
  Standardin riviverojen summaa ei lisätä uutena ryhmäpyöristyksen ehtona.

Document/event-varianttien CHECK-ehdot:

- revision-dokumentti vaatii revision_id:n ja null source_document_id:n;
  legacyOriginal kieltää molemmat; preservedLegacy vaatii eri source_document_id:n
  ja null revision_id:n. Kopion lähde on saman invoice/company-rajan
  legacyOriginal samalla hashilla/koolla, ei kopion kopio.
- Uuden dokumentin SHA-256 on 64 pientä hex-merkkiä ja koko integer
  1..10485760; vanhan legacyOriginal-rivin alkuperäiset sallitut arvot säilyvät.
  Samaa storage_pathia ei julkaista uudelleen, myöskään vanhan polun päälle.
- Legacy-eventillä binding_kind=legacyOriginal, revision null,
  send_mode=legacyUnknown ja hash/size null; vain tämä variantti sallii
  alkuperäisen null document_id:n. Revision-eventillä revision, document ja
  hash/size ovat ei-null eikä mode ole legacyUnknown. PreservedLegacy-eventillä
  revision on null, mode customer ja document/hash/size ei-null.
- Uusien eventien hash/koko täyttävät dokumentin samat rajat.
  customer/smtpTest vaatii email+smtp, dryRun email+dryRun,
  manual manual/print+manual. LegacyUnknown säilyttää vanhat method/provider-
  arvot niitä arvaamatta.
- Nykyiset method-arvot ovat email/manual/print/other; provider-arvot
  dryRun/smtp/gmail/microsoft/manual/other; status prepared/attempted/succeeded/
  failed/outcomeUnknown. Sallittu enum ei yksin hyväksy uutta provideria.
- recipient_email ja cc_email enintään 320, subject 200, body_preview 500,
  nullable provider_message_id ja safe_error_message 500,
  technical_error_code 120 ja created_by 120 merkkiä. Täyttä bodya, MIMEä,
  salaisuutta tai tokenia ei lisätä tapahtumaan.

Muuttumattomuus vaatii kaikki insert/update/delete- ja collision-suojat,
ei vain UPDATE-kieltoa. Otsikon olemassaolo estää uuden lapsirivin/VAT-ryhmän;
otsikon, rivin ja ryhmän PK-/UNIQUE-törmäykset hylätään ennen REPLACE-reittiä.
Dokumentti on update/delete-estetty ja suojaa ID:n, revision/source-uniikkiuden
ja storage-polun törmäyksen. Revision dokumentti vaatii approval- tai
validatedLegacySnapshot-alkuperän. Eventin ID-, company/invoice/document/binding/
revision/mode/hash/size-, method/provider-, recipient/cc/subject/body_preview-
sekä created_at/created_by-kentät ovat muuttumattomat. Legacy-eventin kaikki
päivitykset ja kaikkien eventien poistot estetään. Vanhaa status/error-tietoa
ei korjata uutena tulkintana. Runtime ei voi luoda legacyOriginal-dokumenttia,
legacy-eventtiä tai legacySnapshotia migraation jälkeen.
Ei historian REPLACE-käskyjä, yleistä seal-palvelua tai recursive_triggers-/
globaalin deferred-pragman muutosta.

Osittaiset UNIQUE-indeksit sallivat yhden revision PDF:n per
company/invoice/revision/document_type, yhden alkuperäisen legacy-PDF:n per
company/invoice/document_type ja yhden kopion per company/invoice/source/document_type.
Uuden SMTP:n attempted/outcomeUnknown on uniikki company/invoice-rajan sisällä;
insert- ja update-triggerit suojaavat myös REPLACE-reitin. Vanhoja moninkertaisia
ratkaisemattomia rivejä ei poisteta indeksin vuoksi: runtime tarkistaa nekin
[toimitusvarauksessa](sqlite-invoice-delivery-event-persistence-plan.md#nykyinen-varaus-ja-loppukuittaus).
Pelkkä DDL ei korvaa mapperin liiketoimintavalidointia tai tavujen tarkistusta.

### Migraation ja palautuksen rajat

039 lisää revision, legacy-kopion, current-osoittimen ja document/event-sidokset
nykyisen runnerin yhdessä transaktiossa. 001-038 ovat muuttumattomia.
Legacy-kopio nimeää täydet 64/18-kentät ja säilyttää nullit sekä aikaleimat;
vanhaa ALV-erittelyä, SMTP-moodia tai toimitusrevisiota ei päätellä.
Väliaikainen invoice -> opaque revision-ID -kartta poistetaan samassa
transaktiossa. Standardiotsikot julkaistaan ennen riippuvia hyvityksiä.
Puuttuva vanhempi hylkää migraation, ei katoa sisäliitoksessa.
Reopened-laskulla ei ole currentia. SQL ei lue tiedostoja, renderöi, soita
verkkoon tai lisää dokumenttimetatietoja olemattomille uusille tavuille.

Vanhat dokumentit ja tapahtumat kopioidaan ennen uusien legacy-insert-suojien
asennusta. Vanha tapahtumataulu pudotetaan ennen dokumenttitaulua: parent-first
voisi aktivoida vanhan ON DELETE SET NULL -säännön. Uudet taulut nimetään ja
indeksit palautetaan samassa transaktiossa. Kaikki vanhat ID:t, statukset,
aikaleimat ja alkuperäiset null-viitteet säilyvät; uuden skeeman poisto on
RESTRICT. Rivi-/schema-/migraatiometadatavirhe peruu koko migraation.
Runnerin aiempi hyväksytty legacy-metadatan ankkurointi on erillinen transaktio,
ei osittainen business-julkaisu; kiinteä 038-ankkuri säilyy.

[Invoicingin backup-omistaja](../modules/invoicing.md#backup-artifactien-omistajuus)
tarkistaa alkuperäisen katalogin ja todelliset PDF-tavut ennen migraatiota
sekä saman katalogin sen jälkeen ennen materiaalistamista. Katalogin,
catalog-v1:n, portable-containerin ja no-merge-palautuksen sopimuksia ei
muuteta. Muutos tarvitsee constraint-/rollback-/samanaikaisuus-/restart-
näytön ja hardened packaged backup -> inspect -> restore -> restart -> compare
-portin; pelkkä SQL- tai tyyppikoe ei korvaa niitä.

## Historiallinen rakenneauditointi

Seuraava suljettu osuus säilyttää alkuperäisen refaktorointibaselinen
täsmälliset SQL- ja vaiheistushavainnot. Sen sanat "nykyinen",
"säilytettävä" ja "seuraava" viittaavat vain tuohon vanhaan vaiheeseen.
Erityisesti PDF-poisto, yhden PDF:n rajoite ja vanhat portit eivät ole
nykyisen työn ohjeita. Niiden nykyiset korvaajat ovat yllä.

<details>
<summary>Alkuperäinen hyväksyntäpersistenssin auditointi ja toteutushistoria</summary>

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

| Vastuu | Omistaja ennen write boundary -erää | Nykyinen omistaja |
| --- | --- | --- |
| Puhtaat persistence-rivien muunnokset | SQLite approval repository | `invoiceApprovalPersistenceRows.ts` |
| Hyväksynnän SELECT-kyselyt | SQLite approval repository | `sqliteInvoiceApprovalQueries.ts` |
| Yritys- ja asiakassnapshotien luku | `SqliteInvoiceApprovalSnapshotReader` | Säilyy nykyisessä readerissä |
| INSERT-, UPDATE- ja DELETE-lauseet | SQLite approval repository | `sqliteInvoiceApprovalStatements.ts`, sama yhteys ja synkroninen kutsutapa |
| Transaktioiden orkestrointi | SQLite approval repository | Säilyy repositoryssä |
| Numerointipäätös ja domain-validointi | Domain + repositoryn orkestrointi | Säilyy nykyisessä kutsuketjussa |
| Sekvenssin persistence | SQLite approval repository | Statement-helperissä saman hyväksyntätransaktion sisällä |
| Audit-rivin muodostus | SQLite approval repository | Puhdas mapping `invoiceApprovalPersistenceRows.ts`-tiedostossa |
| Audit-rivin kirjoitus | SQLite approval repository | Statement-helperissä repositoryn transaktion sisällä |
| PDF-metadatan poisto reopenissa | SQLite approval repository | Statement-helperissä repositoryn transaktion sisällä |
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
| SQLite approval write boundary -auditointi | Valmis | `4485256` | `4fe7657` | Yksitoista kirjoitusta, statement-järjestykset, yritys- ja tilarajat sekä rollback-vaikutukset auditoitu; pysäytysehtoa ei löytynyt |
| Puuttuvien write guard -karakterisointien täydennys | Valmis | `4fe7657` | `aa7e845` | Idempotentti mark sent, tenant-rajat, reapproval-status ja kaksi `changes !== 1` -rollbackia lukittu kuudella testillä |
| SQLite approval write statements -erotus | Valmis | `aa7e845` | `b40e265` | Yksitoista synkronista kirjoitusoperaatiota erotettu helperiin samalla yhteydellä, SQL:llä ja virhekäyttäytymisellä |
| SQLite approval transaction orchestration -selkeytys | Valmis | `b40e265` | `a83071e` | Viisi nimettyä private sync -metodia; kolme public-metodia omistavat edelleen transaction callbackit |

Toteutetussa jaossa `SqliteInvoiceApprovalRepository` on 356 riviä ja
`SqliteInvoiceApprovalStatements` 526 riviä. Statements-tiedoston koko johtuu
pääosin yhdestä laajasta snapshot-INSERTistä ja UPDATEsta; sitä ei pilkota
mekaanisesti ilman uutta vastuu- ja transaktioarviota.

Seuraava mahdollinen työ on ainoastaan **SQLite invoice delivery event
persistence boundaries** -arviointi. Tämä kirjaus ei anna lupaa muuttaa
delivery event -repositoryä, SQL:ää, transaktioita, migraatioita tai julkisia
portteja.

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

</details>
