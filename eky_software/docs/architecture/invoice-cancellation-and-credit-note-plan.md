# Invoice Cancellation And Credit Note Plan

Tämä dokumentti määrittää Invoicing-moduulin laskun peruutuksen ja
hyvityslaskun ensimmäisen toteutusmallin.

Dokumentti korvaa aiemman alustavan rajauksen, jossa ensimmäinen hyvityslasku
oli vain koko laskun hyvitys ja osahyvitys jätettiin myöhemmäksi. Ensimmäinen
toteutus tukee sekä koko laskun että laskuriveittäin rajatun osahyvityksen.

## Tavoite

Toteutuksen jälkeen käyttäjä voi:

- perua hyväksytyn mutta toimittamattoman laskun
- luoda lähetetystä tavallisesta laskusta hyvitysluonnoksen
- pienentää hyvitykseen otettavia määriä tai poistaa rivejä
- hyväksyä hyvitysluonnoksen omaksi numeroiduksi hyvityslaskukseen
- muodostaa ja toimittaa hyvityslaskun nykyisen turvallisen PDF- ja
  sähköpostiputken kautta
- nähdä alkuperäisen laskun ja sen hyvitykset yhtenä kokonaisuutena

Tavallinen lasku ja hyvityslasku ovat eri laskulajeja. Tavalliseen
laskumalliin ei lisätä negatiivisia syöttöarvoja.

## Rajaus

Tässä kokonaisuudessa toteutetaan:

- hyväksytyn mutta toimittamattoman laskun peruutus
- koko laskun hyvitys
- rivikohtainen osahyvitys
- hyvitysluonnoksen luonti lähetetyn laskun snapshotista
- hyvityksen hyväksyntä, numerointi, auditointi, PDF ja toimitus
- peruutettujen laskujen sekä hyvitysten listaus ja katselu
- lähetettyjen laskujen alkuperäislaskukohtainen ryhmittely

Tässä kokonaisuudessa ei toteuteta:

- `paid`-tilaa
- automaattista maksujen kohdistusta
- tavallisen laskun negatiivisia rivejä
- hyvitystä vapaasti ilman alkuperäistä lähetettyä laskua
- hyvityslaskun hyvitystä tai ketjutettua vastahyvitystä
- rakennusalan käännettyä ALV:tä
- uusia riippuvuuksia
- yleistä korjaus-, taulukko-, tila- tai workflow-frameworkia

## Omistajuus Ja Kerrosrajat

Invoicing omistaa:

- laskun lajin ja tilan
- peruutuksen liiketoimintasäännöt
- hyvitysluonnoksen ja sen lähdeviittaukset
- hyvityksen laskennan
- kumulatiivisen hyvitysrajan
- hyvityksen hyväksynnän ja numeroinnin
- peruutus- ja hyvitysauditoinnin
- hyvityksen PDF- ja toimitussäännöt

HTTP-adapteri ei päätä, saako laskun perua tai hyvittää. SQLite-adapteri ei
laske hyvityssummia omilla rinnakkaisilla kaavoillaan. Web ei ole
hyvityssummien auktoriteetti.

## Käsitteet

Laskun laji:

```text
invoiceKind: standard | credit
```

Hyvityslasku viittaa alkuperäiseen laskuun:

```text
creditedInvoiceId
```

Hyvityslaskun rivi viittaa alkuperäisen laskun snapshot-riviin:

```text
sourceInvoiceLineId
```

Hyvityssummat tallennetaan tietokantaan positiivisina suuruuksina. Web ja PDF
esittävät hyvityslaskun rivit, ALV:n ja loppusumman negatiivisina. Näin
olemassa olevat raha-arvojen ei-negatiivisuusrajat säilyvät ja laskun laji
kertoo arvon suunnan.

## Tietomallin Ensimmäinen Laajennus

`invoice_drafts`:

```text
invoice_kind             standard | credit, oletus standard
credited_invoice_id      nullable viite invoices.id
```

`invoice_draft_lines`:

```text
source_invoice_line_id   nullable viite invoice_lines.id
```

`invoices`:

```text
invoice_kind             standard | credit, oletus standard
credited_invoice_id      nullable viite invoices.id
cancelled_at             nullable aikaleima
cancelled_by             nullable actor id
cancellation_reason      nullable rajattu teksti
```

`invoice_lines`:

```text
source_invoice_line_id   nullable viite invoice_lines.id
```

Vanha data migroidaan laskulajiksi `standard`. Tavallisella laskulla
`credited_invoice_id` ja rivien `source_invoice_line_id` ovat tyhjiä.
Hyvityksellä molemmat lähdeviittaukset ovat pakollisia arvollisille
hyvitysriveille.

Tietokanta estää vähintään:

- tuntemattoman laskulajin
- itseensä viittaavan hyvityksen
- aktiivisen hyvitysluonnoksen monistumisen samalle yritykselle ja
  alkuperäislaskulle
- eri yritysten välisen lähdeviittauksen application- ja
  repository-validoinnin avulla

Aktiivinen hyvitysluonnos tarkoittaa hyvitysluonnosta, jota ei ole vielä
linkitetty hyväksyttyyn laskuun. Samalle alkuperäislaskulle saa olla kerrallaan
vain yksi tällainen luonnos. Hyväksymisen jälkeen voidaan tarvittaessa luoda
uusi osahyvitysluonnos jäljellä olevasta määrästä.

## Laskun Peruutus

Peruutus koskee laskua, joka:

- kuuluu backendin vahvistamaan yritykseen
- on tilassa `approved`
- ei ole tilassa `sent`
- ei ole onnistuneesti toimitettu
- ei sisällä ratkaisematonta `attempted`- tai `outcomeUnknown`-
  toimitustapahtumaa

Sekä tavallinen hyväksytty lasku että hyväksytty mutta toimittamaton
hyvityslasku voidaan perua. Lähetettyä tavallista laskua ei peruta, vaan se
hyvitetään. Lähetettyä hyvityslaskua ei hyvitetä tällä ensimmäisellä
korjauspolulla.

Peruutus:

- säilyttää laskunumeron
- säilyttää viitenumeron, snapshotin, rivit, PDF:n ja lähdeluonnoksen
- ei vapauta laskunumeroa uudelleen käytettäväksi
- estää reopen-, lähetys- ja uudelleenhyväksyntäpolut
- muuttaa tilan `cancelled`-tilaan
- tallentaa ajan, actorin ja käyttäjän antaman perustelun
- kirjaa `invoice.cancelled`-audit-tapahtuman

Peruutus tehdään yhtenä transaktiona.

Peruutuspyyntö sisältää vain:

```text
confirmationInvoiceNumber
cancellationReason
```

Käyttäjän pitää kirjoittaa näkyvä laskunumero täsmälleen vahvistukseksi.
Backend ei luota UI-vahvistukseen, vaan tarkistaa numeron, tilan, yrityksen,
permissionin ja toimitustilanteen uudelleen.

Peruutus vaatii permissionin:

```text
manageInvoiceCorrections
```

Tuntematon lasku, toisen yrityksen lasku ja luvaton resurssi saavat saman
turvallisen yleisvirheen. Virhe ei paljasta toisen yrityksen laskua tai
toimitustietoja.

## Hyvitysluonnoksen Luonti

Hyvitysluonnos voidaan luoda vain laskusta, joka:

- kuuluu backendin vahvistamaan yritykseen
- on lajia `standard`
- on tilassa `sent`
- ei ole kokonaan hyvitetty

Luonti ei saa hyväksyä `companyId`-arvoa request bodysta. Lähdelasku ja kaikki
kopioitavat tiedot luetaan hyväksytyn laskun snapshotista, ei Customers-,
Company Settings- tai alkuperäisestä draft-masterdatasta.

Hyvitysluonnos kopioi:

- alkuperäisen laskun osapuolet ja osoitetiedot
- laskukohtaisen price input mode -arvon
- alkuperäiset rivikoodit ja kuvaukset
- yksiköt
- yksikköhinnat
- ALV-kannat
- alennustyypit ja alennusarvot
- rivien lähdeviittaukset
- aiheeseen ja lisätietoon selkeän viittauksen alkuperäiseen laskuun

Uuden hyvitysluonnoksen laskupäivä on luontipäivä. Hyvitysluonnos ei muodosta
uutta maksupyyntöä. Sen eräpäivä voidaan tallentaa teknisesti laskupäivänä,
maksuehto, huomautusaika ja viivästyskorko ovat nolla, eikä hyväksytty
hyvityslasku saa maksupalkkia tai uutta viitenumeroa.

Nollahintaisia tai määrältään nollia kuvausrivejä ei oteta mukaan
hyvityskapasiteettiin. Hyvitysluonnokseen kopioidaan vain lähderivit, joilla on
positiivinen määrä ja positiivinen hyvityskelpoinen arvo. Alkuperäisen laskun
muut kuvaustiedot säilyvät alkuperäisessä snapshotissa.

Jos samalla alkuperäislaskulla on jo aktiivinen hyvitysluonnos, backend
palauttaa sen idempotentisti. Se ei luo toista rinnakkaista luonnosta.

## Hyvitysluonnoksen Muokkaus

Hyvitysluonnoksessa käyttäjä saa:

- poistaa hyvitysrivin
- pienentää rivin määrää
- palauttaa määrän enintään backendin ilmoittamaan jäljellä olevaan määrään
- muokata rivin kuvausta
- muokata laskun aihetta ja lisätietoa

Käyttäjä ei saa muuttaa:

- asiakasta tai laskun vastaanottajaa
- alkuperäislaskun viittausta
- lähderivin viittausta
- yksikköä
- yksikköhintaa
- ALV-kantaa
- alennustyyppiä tai alennusarvoa
- price input mode -arvoa
- laskun lajia

Backend tarkistaa muuttumattomat snapshot-arvot hyväksynnässä. UI:n readonly-
kentät eivät ole turvallisuusraja.

## Osahyvityksen Auktoritatiivinen Laskenta

Hyvityksen laskenta perustuu alkuperäisten `invoice_lines`-rivien tallennettuun
snapshot-dataan. Tavallisen laskurivin laskentaa ei ajeta uudelleen nykyisillä
asetuksilla.

Pelkkä alkuperäisen kiinteän alennuksen käyttäminen jokaisessa osahyvityksessä
olisi väärin. Siksi jokaisen lähderivin hyvityssummat jaetaan kumulatiivisesti
hyvitetyn määrän suhteessa alkuperäiseen määrään.

Jokaiselle lähderiville:

```text
newCumulativeQuantity =
  previousNonCancelledCreditedQuantity + requestedQuantity

newCumulativeQuantity <= sourceQuantity
```

Kumulatiivinen tavoite lasketaan yhteisellä domainin
`roundHalfUp`-pyöristyksellä:

```text
targetBase =
  roundHalfUp(sourceBase * newCumulativeQuantity / sourceQuantity)

targetDiscount =
  roundHalfUp(sourceDiscount * newCumulativeQuantity / sourceQuantity)

targetVat =
  roundHalfUp(sourceVat * newCumulativeQuantity / sourceQuantity)
```

Nykyisen hyvitysrivin summat ovat tavoitteen ja aiempien ei-peruttujen
hyvitysten erotus:

```text
base = targetBase - previousCreditedBase
discount = targetDiscount - previousCreditedDiscount
net = base - discount
vat = targetVat - previousCreditedVat
gross = net + vat
```

Kaikki laskenta tehdään turvallisilla kokonaisluvuilla. JavaScriptin
liukulukuja ei käytetä auktoritatiiviseen rahalaskentaan.

Tämä malli:

- jakaa kiinteän alennuksen vain kerran koko hyvityskapasiteettiin
- sitoo jokaisen hyvityksen alkuperäisen rivin snapshot-summiin
- estää kumulatiivisen ylityksen
- antaa viimeiselle täydentävälle hyvitykselle täsmälleen jäljellä olevat
  sentit
- takaa, että täysin hyvitetyn rivin ei-peruttujen hyvitysten summa vastaa
  alkuperäistä snapshot-riviä

Laskutason hyvityssummat ja ALV-erittely muodostetaan valmiiksi lasketuista
hyvitysriveistä. Niitä ei lasketa uudelleen toisella tavalla.

## Hyvityksen Hyväksyntä

Hyvityksen hyväksyntä on oma application-käyttötapauksensa ja yksi
SQLite-transaktio.

Transaktio:

1. lukee hyvitysluonnoksen yritysrajattuna
2. lukee alkuperäisen lähetetyn tavallisen laskun ja sen rivit
3. lukee samojen lähderivien kaikki aiemmat ei-perutut hyvitykset
4. varmistaa lähdeviittaukset ja muuttumattomat snapshot-kentät
5. laskee tämän hyvityksen rivit kumulatiivisella kokonaislukumallilla
6. estää määrä- ja summaylitykset
7. varaa uuden laskunumeron nykyisestä yrityskohtaisesta numerointisarjasta
8. tallentaa hyvityslaskun ja rivit
9. linkittää hyvitysluonnoksen hyväksyttyyn hyvityslaskuun
10. kirjaa `invoice.credit_approved`-audit-tapahtuman

Kaikki onnistuu tai peruuntuu yhdessä. Transaktion pitää estää kahden
samanaikaisen hyväksynnän ylittämästä alkuperäisen laskun jäljellä olevaa
hyvityskapasiteettia.

Hyvityslasku saa oman virallisen laskunumeron. Se ei saa tavallisen laskun
viitenumeroa eikä muodosta asiakkaalle maksuvaatimusta.

Jos hyväksytty mutta toimittamaton hyvityslasku palautetaan muokattavaksi,
uudelleenhyväksyntä säilyttää saman hyvityslaskun numeron ja kirjaa
`invoice.credit_reapproved`-audit-tapahtuman. Lähetettyä hyvityslaskua ei
reopen-muokata.

## Hyvitysrajan Johdettu Tila

Alkuperäisen laskun hyvitystila johdetaan ei-perutuista hyvityslaskuista:

```text
none
partial
full
```

`remainingGrossCents` ja rivikohtaiset jäljellä olevat määrät johdetaan
alkuperäisen snapshotin ja hyväksyttyjen ei-peruttujen hyvitysten erotuksesta.

Alkuperäisen laskun `status` säilyy `sent`-tilassa. Johdettua hyvitystilaa ei
sekoiteta toimitustilaan eikä toteuteta erillisenä `credited`-statuksena tässä
ensimmäisessä vaiheessa.

Peruttu hyvityslasku ei kuluta hyvityskapasiteettia. Lähetettyä hyvityslaskua
ei voi perua, joten toimitettu hyvitys pysyy aina mukana kumulatiivisessa
laskennassa.

## HTTP- Ja API-Sopimukset

Ensimmäiset uudet käyttötapaukset ovat:

```text
POST /invoices/:id/cancel
POST /invoices/:id/credit-draft
POST /invoice-drafts/:id/approve-credit
GET  /invoices?status=cancelled
GET  /invoices/sent-groups
```

Nykyisiä tavallisen laskun reittejä ei rikota. Sent-ryhmittelylle käytetään
rajattua omaa lukumallia, jotta nykyinen yhteenvetolistaus säilyy
yhteensopivana.

Kaikki request bodyt:

- käyttävät eksplisiittistä allowlistia
- hylkäävät tuntemattomat kentät
- validoivat tyypin, muodon, pituuden ja arvovälit
- eivät hyväksy `companyId`, actor-, status-, summa-, numero- tai
  audit-kenttiä

Desktopin custom protocol -allowlist ja permission-testit päivitetään aina
samassa vaiheessa uuden endpointin kanssa.

## Web-Käyttöliittymä

Peruutus käyttää kaksivaiheista vahvistusdialogia:

- käyttäjälle näytetään laskunumero ja peruutuksen vaikutus
- käyttäjä kirjoittaa laskunumeron
- käyttäjä antaa peruutuksen syyn
- vahvistuspainike aktivoituu vasta kelvollisilla tiedoilla

Hyvitysluonnos käyttää Invoicing-featuren omaa rajattua editoria. Tavallisen
laskun editoriin ei lisätä ehtojen verkkoa, joka sallisi hyvitykselle
kiellettyjen kenttien muokkauksen.

Web voi näyttää hyvityksen summien esikatselun, mutta backend laskee ja
vahvistaa lopulliset summat.

Listaus näyttää erilliset osiot:

- luonnokset
- hyväksytyt
- peruutetut
- lähetetyt

Lähetetyt tavalliset laskut ovat ryhmän juuria ja niiden hyvityslaskut
alirivejä. Palvelin sivuttaa juurilaskut, ei litteää rivilistaa. Ryhmä näyttää
hyvitystilan ja jäljellä olevan summan.

## PDF Ja Toimitus

Hyvityslaskun PDF:

- käyttää vain hyväksytyn hyvityslaskun snapshot-dataa
- sisältää näkyvän otsikon `HYVITYSLASKU`
- näyttää alkuperäisen laskun numeron ja päiväyksen
- näyttää hyvitysrivit, ALV-erittelyn ja summat negatiivisina
- ei näytä maksupalkkia
- ei näytä uutta viitenumeroa tai muuta maksuvaatimusta

Hyvityslasku käyttää nykyistä turvallista PDF-dokumentti- ja
sähköpostitoimitusputkea. Vain varmasti onnistunut toimitus muuttaa
hyvityslaskun `sent`-tilaan. Epäonnistunut tai epäselvä toimitus jättää tilan
ennalleen ja kirjautuu delivery event -malliin nykyisten sääntöjen mukaan.

Peruutetun laskun olemassa oleva PDF säilyy luettavana audit- ja
tarkastustarkoituksiin, mutta peruutettua laskua ei voi toimittaa.

## Auditointi

Ensimmäiset uudet audit-toiminnot:

```text
invoice.cancelled
invoice.credit_draft_created
invoice.credit_approved
invoice.credit_reapproved
```

Audit ei sisällä tarpeetonta henkilötietoa, sähköpostin sisältöä, salaisuuksia
tai raakaa teknistä virhettä. Peruutuksen perustelu tallennetaan laskun
rajattuun metadataan, ei auditin vapaamuotoiseksi debug-kentäksi.

## Testaus

Vähimmäistestit:

- approved mutta toimittamaton lasku voidaan perua
- sent-laskua ei voi perua
- väärän yrityksen laskua ei löydy peruutuksessa
- ratkaisematon delivery event estää peruutuksen
- väärä vahvistusnumero ja puuttuva perustelu estävät peruutuksen
- peruutus säilyttää numeron, snapshotin, PDF:n ja audit trailin
- credit draft syntyy vain saman yrityksen sent standard -laskusta
- toinen aktiivinen credit draft palauttaa olemassa olevan luonnoksen
- credit draft ei lue muuttunutta master-dataa
- credit editor ei voi muuttaa hintaa, ALV:tä, alennusta tai lähdeviitettä
- koko hyvitys täsmää alkuperäisen laskun kaikkiin senttisummiin
- osahyvitys toimii prosentti- ja kiinteällä alennuksella
- useat osahyvitykset eivät ylitä määrää tai senttisummia
- viimeinen osahyvitys saa pyöristyksen jäljellä olevat sentit
- samanaikaiset hyväksynnät eivät ylitä hyvityskapasiteettia
- peruttu credit ei kuluta hyvityskapasiteettia
- credit saa uuden laskunumeron mutta ei maksuviitettä
- credit PDF näyttää negatiiviset summat ja jättää maksupalkin pois
- credit email käyttää samaa current PDF -toimitusputkea
- cancelled-, standard- ja credit-laskut rajautuvat aina companyId:llä
- sent-ryhmittely sivuttaa juurilaskut vakaasti ilman N+1-kyselyitä
- HTTP, API-client ja desktop allowlist hylkäävät ylimääräiset tai luvattomat
  kentät

## Toteutusjärjestys

1. Tämä suunnitelma ja dokumenttien ristiriitojen sulkeminen.
2. Migraatio, domain-tyypit, permission ja puhtaat hyvityslaskennan testit.
3. Peruutuksen repository/application-transaktio ja backend-testit.
4. Peruutuksen HTTP-, API-client-, desktop allowlist- ja web-polku.
5. Hyvitysluonnoksen luonti, persistence ja rajattu editori.
6. Hyvityksen atominen hyväksyntä ja concurrency-testit.
7. Hyvityksen katselu, PDF ja toimitus.
8. Palvelinpuolen sent-ryhmittely ja listauksen UI.
9. Koko regressiomatriisi, dokumentaation nykytilapäivitys ja Windows-smoke.

Jokainen vaihe tehdään omana katselmoitavana muutoksena. Seuraavaa vaihetta ei
aloiteta, jos edellinen rikkoo moduulirajoja, turvallisuusporttia tai
aukotonta senttilaskentaa.
