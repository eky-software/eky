# Invoice Tax Treatment Completion Plan

Tämä suunnitelma määrittää laskutason ALV-käsittelyn, rakennusalan
käännetyn verovelvollisuuden, palvelun suoritusajankohdan sekä uuden
`0 %` -valinnan turvallisen rajauksen.

Suunnitelma täydentää:

- `docs/modules/invoicing.md`
- `docs/architecture/invoicing-mvp-implementation-plan.md`
- `docs/architecture/invoice-approval-numbering-plan.md`
- `docs/architecture/invoice-cancellation-and-credit-note-plan.md`
- `docs/architecture/invoice-print-data-foundation-plan.md`

## Virallinen Ohjepohja

Toteutushetkellä 26.7.2026 tarkistettiin Verohallinnon ohjeet:

- [Rakennusalan käännetty arvonlisäverovelvollisuus](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48625/rakennusalan-k%C3%A4%C3%A4nnetty-arvonlis%C3%A4verovelvollisuus/)
- [Laskutusvaatimukset arvonlisäverotuksessa](https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48090/laskutusvaatimukset-arvonlisaverotuksessa3/)

Eky ei ratkaise käyttäjän puolesta, täyttyvätkö käännetyn verovelvollisuuden
aineelliset ehdot. Käyttäjän pitää vahvistaa soveltuvuus hyväksynnässä.
Tuotantokäyttöä edeltävä lopullinen käyttötapa tarkistetaan kirjanpitäjältä.

## Laskutason Käsittely

Invoicing omistaa tyypin:

```text
InvoiceTaxTreatment
- normalVat
- reverseChargeConstruction
```

`normalVat` on aina oletus. Käsittely on laskutasoinen, eikä sama lasku saa
sisältää eri ALV-käsittelyjä.

`reverseChargeConstruction`:

- ei ole `0 %` verokanta
- ei käytä `vatRateBasisPoints: 0`- tai `2550`-placeholderia
- käyttää vain verottomia syöttöhintoja
- tuottaa myyjän ALV:ksi nolla senttiä
- tuottaa saman netto- ja bruttosumman
- ei tuota normaalia verokantakohtaista ALV-erittelyä
- ei muuta normaalia ALV-laskentaa tai sen pyöristyssääntöjä

Rivien persistence-malli:

```text
normalVat:
  vat_rate_basis_points INTEGER NOT NULL

reverseChargeConstruction:
  vat_rate_basis_points NULL
```

Nykyinen skeema voidaan muuttaa turvallisesti uudella numeroidulla
taulunrakennusmigraatiolla. Vanhoja migraatioita ei muuteta. Sovellus- ja
tietokantarajat varmistavat, että nullable-arvoa käytetään vain käännetyn
verovelvollisuuden riveillä.

## Juridinen Ostaja Ja Vastaanottaja

Juridinen ostaja on aina laskun `customer`.

- ostajan snapshot tulee Customers-moduulin asiakastiedoista
- laskun vastaanottaja tai billing recipient säilyy erillisenä
  toimitusosoitteena
- vastaanottaja ei voi korvata juridista ostajaa
- yksityisasiakas estää rakennusalan käännetyn verovelvollisuuden
- juridisen ostajan Y-tunnus vaaditaan
- Y-tunnus ei yksin osoita käännetyn verovelvollisuuden soveltuvuutta

Invoicing tarkistaa luonnoksen tallennuksessa yritysrajauksen ja
verokäsittelyn tarvitsemat rajatut asiakastiedot application-portin kautta.
Hyväksyntä lukee ja tarkistaa samat ostajatiedot uudelleen hyväksynnän
transaktion sisällä ennen numeron kuluttamista.

## Suorituspäivä Tai Laskutusjakso

Invoicing omistaa tyypin:

```text
InvoicePerformancePeriod
- invoiceDate
- singleDate(date)
- dateRange(startDate, endDate)
```

`invoiceDate` on oletus. `singleDate` tallentaa yhden suoritus- tai
toimituspäivän. `dateRange` tallentaa laskutusjakson.

Säännöt:

- päivät ovat ISO `YYYY-MM-DD` -muodossa ja oikeita kalenteripäiviä
- yksittäinen päivä ja jakso ovat keskenään poissulkevia
- jakson alku ja loppu annetaan aina yhdessä
- loppu ei saa olla ennen alkua
- hyväksytty lasku snapshottaa valinnan
- hyvityslasku perii alkuperäisen laskun suoritusajankohdan
- PDF näyttää erillisen tiedon vain `singleDate`- tai `dateRange`-tilassa

## Hyväksyntä Ja Snapshot

Käännetyn verovelvollisuuden hyväksyntä vaatii erillisen arvon:

```text
reverseChargeEligibilityConfirmed: true
```

Vahvistus tarkistetaan backendissä. Puuttuva, väärä tai manipuloitu arvo
estää hyväksynnän ennen numerointia, snapshotia, rivejä ja audit-tapahtumaa.

Hyväksytty lasku snapshottaa:

- `taxTreatment`
- käyttäjälle näytettävän käsittelyselitteen
- oikeusperusteen `AVL 8 c §`
- juridisen ostajan asiakastiedot
- laskun vastaanottajan erilliset tiedot
- suorituspäivän tai laskutusjakson
- auktoritatiivisesti uudelleen lasketut rivit ja summat

Reopen säilyttää käsittelyn luonnoksella. Reapproval vaatii uuden
soveltuvuusvahvistuksen eikä vaihda laskunumeroa tai viitenumeroa.

## Hyvityslaskut

Hyvitysluonnos perii muuttumattomana:

- `taxTreatment`
- juridisen ostajan
- vastaanottajan
- suorituspäivän tai laskutusjakson
- käsittelyselitteen ja oikeusperusteen
- lähdelaskusuhteen

Normaalin ALV:n hyvityslaskenta säilyy nykyisenä verokantakohtaisena
kapasiteettilaskentana.

Käännetty hyvityslasku käyttää erillistä, tarkasti nimettyä laskentapolkua:

- veroa ei lasketa
- brutto on aina sama kuin netto
- täysi, osittainen ja vapaa hyvitysrivi ovat sallittuja
- hyvitys ei saa ylittää lähderivin määrää tai laskun jäljellä olevaa
  netto-/bruttokapasiteettia
- aiemmat aktiiviset hyvitykset huomioidaan
- peruttu hyvityslasku ei kuluta kapasiteettia
- rinnakkaisen hyväksynnän rajat tarkistetaan transaktion sisällä

## Migraatio Ja Backfill

Uusi numeroitu migraatio:

- lisää `invoice_drafts.tax_treatment`
- lisää `invoices.tax_treatment`
- lisää hyväksytyn laskun käsittelyselitteen ja oikeusperusteen snapshotit
- lisää luonnokselle ja laskulle suorituspäivä- ja laskutusjaksokentät
- rakentaa rivitaulut uudelleen nullable-ALV-kantaa varten
- säilyttää kaikki nykyiset foreign key-, yritys-, status-, credit- ja
  snapshot-rajat

Backfill:

- kaikki vanhat luonnokset ja laskut ovat `normalVat`
- vanha `0 %` pysyy tavallisena historiallisena arvona
- mitään vanhaa tietoa ei tulkita käännetyksi verovelvollisuudeksi
- hyväksyttyjen laskujen summia tai snapshotteja ei lasketa uudelleen
- tallennettuja PDF-dokumentteja ei renderöidä uudelleen

Migraatio ajetaan yhtenä transaktiona. Ennen oikean datan käyttöönottoa
backup- ja restore-polku on release gate. Migraation epäonnistuminen jättää
vanhan skeeman voimaan.

## PDF, Preview Ja Toimitus

Normaalin ALV:n nykyinen preview ja PDF säilyvät muuttumattomina.

Käännetyn verovelvollisuuden lasku:

- näyttää juridisen ostajan tiedot customer-snapshotista
- voi näyttää erillisen laskun vastaanottajan
- näyttää verottomat hinnat
- näyttää `Käännetty verovelvollisuus`
- näyttää `AVL 8 c §`
- ei näytä ALV-kantaa
- ei näytä veron määrää tavallisena verorivinä
- ei näytä normaalia ALV-erittelyä tai `ALV 0 %` -selitettä
- näyttää maksettavan summan verottomana kokonaisuutena

Preview, tallennettu PDF, sähköpostiliite ja uudelleenlähetys käyttävät samaa
hyväksytyn laskun snapshotia. SMTP-, exact-PDF-binding-, kertakäyttövaltuus-
ja delivery event -rajoja ei muuteta.

## Uuden 0 % -Valinnan Raja

R0-sääntö:

- uusi `normalVat`-lasku ei saa käyttää `0 %` verokantaa
- `reverseChargeConstruction` käyttää omaa käsittelyään ja nullable-rivejä
- `vatExempt` ja `outsideVatScope` eivät ole vielä käytettävissä
- vanha `0 %` hyväksytyn laskun snapshot säilyy luettavana
- vanhan `0 %` luonnoksen hyväksyntä estetään turvallisella virheellä
- vanhaa dataa ei poisteta tai muuteta automaattisesti
- `0 %` voidaan näyttää asetuksissa passiivisena legacy-arvona

## UI-Rajaus

Valinta sijoitetaan oletuksena suljettuun `Laskun lisäasetukset` -osioon.
Tavallisen laskun kirjoitusnäkymä ei saa kasvaa jatkuvasti näkyvillä
erikoiskentillä.

Käännetyssä tilassa UI:

- näyttää varoituksen ja juridisen ostajan nimen sekä Y-tunnuksen
- näyttää laskun vastaanottajan erillisenä
- lukitsee verottoman syöttötilan
- piilottaa tai lukitsee ALV-kantavalinnat
- näyttää ALV:n nollana laskennan tuloksena, ei `0 %` verokantana
- vaatii hyväksyntädialogissa soveltuvuusvahvistuksen

Backend on edelleen kaikkien sääntöjen auktoriteetti.

## Testimatriisi

Ennen tuotantologiikan muutosta lukitaan nykyinen normal-VAT-polku:

- net- ja gross-syöttö
- yksi ja useita verokantoja
- alennukset ja pyöristysrajat
- create, update ja autosave
- approve ja reapprove
- täysi, osittainen ja vapaa hyvitys
- nykyinen PDF ja ALV-erittely
- toimituksen prepare/send
- sent- ja credited-ryhmittely

Käännetty polku testaa vähintään:

- yritysasiakas ja Y-tunnus
- yksityisasiakkaan ja puuttuvan Y-tunnuksen esto
- vastaanottajan erillisyys
- gross-tilan ja rate-placeholderien esto
- netto, vero, brutto ja tyhjä ALV-erittely
- puuttuvan hyväksyntävahvistuksen esto
- hyväksynnän ja numeroinnin rollback
- reopen ja reapprove
- peruutus
- täysi, osittainen ja vapaa hyvitys sekä ylihyvityksen esto
- PDF:n pakolliset ja kielletyt merkinnät
- saman PDF:n turvallinen uudelleenlähetys

Suoritusajankohta testaa oletuksen, yksittäisen päivän, jakson, virheelliset
päivät, snapshotin, hyvityksen perinnän ja PDF-esityksen.

## Myöhemmät Käsittelyt

Erillisen päätöksen taakse jäävät:

- `vatExempt`
- `outsideVatScope`
- muut käännetyn verovelvollisuuden lajit
- rivikohtaiset sekalaskut
- maksusuoritukset ja `paid`
- verkkolasku

