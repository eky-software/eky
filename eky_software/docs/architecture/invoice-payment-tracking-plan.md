# Invoice Payment Tracking Plan

Tämä dokumentti määrittää Eky local-MVP:n manuaalisen laskun
maksumerkinnän, maksutilan read modelin ja myöhemmän pankki-integraation
arkkitehtuurirajan.

Maksuseuranta kuuluu Invoicing-moduulille. Se ei muuta hyväksytyn laskun
snapshot-summia, toimitustapahtumia, laskunumeroa, viitenumeroa, PDF:ää tai
laskun toimitustilaa.

## Tilamalli

Laskun elinkaari ja toimitustila säilyvät erillään maksutilasta:

```text
lifecycleStatus: approved | sent | cancelled
paymentState: unpaid | paid
```

Hyvityslasku ei ole asiakkaalta perittävä saatava. Sen julkinen read model
näyttää maksutilana `notApplicable`, vaikka tietokannan nykytilaprojektio
käyttää vain arvoja `unpaid | paid`.

Maksutila ei:

- korvaa `sent`-tilaa
- muuta laskun toimitustilaa
- tee laskusta toimitettua
- muuta hyvitystilaa `none | partial | full`
- muuta hyväksytyn laskun snapshot-summia

## Ensimmäisen Version Rajaus

Ensimmäinen versio tukee:

- standardilaskun merkitsemistä manuaalisesti maksetuksi
- maksupäivän tallentamista
- backendin laskemaa maksettua bruttosummaa
- maksumerkinnän hallittua poistamista
- append-only-maksuhistoriaa
- maksutilan näyttämistä laskutuksessa, asiakaskortilla ja Activityssa

Ensimmäinen versio ei tue:

- osamaksuja
- useita suorituksia samalle laskulle
- pankkitapahtumien tuontia
- viitesuoritusten automaattista kohdistamista
- palautusten seurantaa
- maksetun summan syöttämistä clientistä
- laskun maksutilan päättelyä sähköpostista tai PDF:stä

## Maksukelpoisuus

Lasku voidaan merkitä maksetuksi vain, kun kaikki ehdot täyttyvät:

- lasku kuuluu backendin vahvistamaan yritykseen
- actorilla on `manageInvoicePayments`-permission
- `invoiceKind = standard`
- `status = sent`
- `paymentState = unpaid`
- jäljellä oleva maksettava bruttosumma on suurempi kuin nolla

Seuraavat estetään:

- `approved`
- `cancelled`
- hyvityslasku
- kokonaan hyvitetty alkuperäislasku
- tuntematon tai toisen yrityksen lasku
- puuttuva permission

Osittain hyvitetty standardilasku voidaan merkitä maksetuksi jäljellä
olevasta määrästä.

Nykyinen Invoicingin credit-capacity laskee jäljellä olevan summan näin:

```text
original approved gross snapshot
- approved or sent non-cancelled credit invoice gross snapshots
= remaining payable gross
```

Sama laskenta kattaa sekä lähderiveihin sidotut että vapaat hyvitysrivit.
Maksuseuranta käyttää tätä Invoicingin omistamaa laskentaa eikä muodosta
rinnakkaista hyvityslaskentaa.

## Maksupäivä Ja Luotettu Kello

Client lähettää vain maksupäivän muodossa `YYYY-MM-DD`.

Backend:

- validoi muodon ja oikean kalenteripäivän
- vertaa päivää backendin luotettuun `Europe/Helsinki`-päivään
- estää tulevaisuuden päivämäärän
- ei luota clientin kelloon tai clientin lähettämään euromäärään

Web käyttää oletuksena nykyistä Suomen päivää, mutta backend on
auktoritatiivinen.

## Nykytilaprojektio

`invoices`-tauluun lisätään:

```text
payment_state
paid_on
paid_amount_cents
payment_source
payment_recorded_at
payment_recorded_by
```

Invarianssit:

- `unpaid` tarkoittaa, että kaikki muut maksukentät ovat `NULL`
- `paid` tarkoittaa, että kaikki vaaditut maksukentät ovat asetettu
- `paid_amount_cents` on positiivinen kokonaisluku
- ensimmäinen `payment_source` on `manual`
- `payment_recorded_at` on UTC-aikaleima
- `payment_recorded_by` tulee luotetusta ActorContextista

Hyvityslaskun tietokantarivi säilyy `unpaid`-tilassa. Julkinen read model
muuntaa sen arvoksi `notApplicable`.

## Append-Only Maksuhistoria

Invoicing omistaa taulun `invoice_payment_events`.

Ensimmäiset actionit:

```text
paymentMarkedPaid
paymentMarkReverted
```

Tapahtuma sisältää vähintään:

- yritys- ja laskurajauksen
- actorin teknisen tunnisteen auditointia varten
- actionin
- maksulähteen
- maksupäivän
- tapahtumahetkellä käytetyn summan
- tapahtuma-ajan

Revert-eventti säilyttää poistetun maksumerkinnän maksupäivän ja summan.
Nykytilaprojektion tyhjentäminen ei poista tapahtumahistoriaa.

## Transaktiot, Idempotenssi Ja Kilpailutilanteet

Maksumerkintä tekee samassa SQLite-transaktiossa:

1. yritysrajatun lasku- ja maksutilan luvun
2. maksukelpoisuuden ja permissionin tarkistuksen
3. voimassa olevan hyvitystilanteen luvun
4. jäljellä olevan summan laskennan
5. nykytilaprojektion ehdollisen päivityksen
6. yhden append-only-tapahtuman lisäyksen

Jos eventin kirjoitus tai nykytilaprojektion päivitys epäonnistuu, koko
transaktio palautetaan.

Sama `paidOn` jo maksetulle laskulle on idempotentti:

- nykyinen tila palautetaan
- uutta tapahtumaa ei lisätä

Eri `paidOn` jo maksetulle laskulle on konflikti. Maksupäivää ei muuteta
hiljaisesti uudella mark-paid-pyynnöllä.

Rinnakkaisista samoista pyynnöistä vain yksi saa tehdä tilamuutoksen ja
tapahtuman. Toinen palauttaa idempotentin nykytilan tai turvallisen konfliktin
sen mukaan, vastaavatko vahvistetut tiedot.

Maksumerkinnän poisto:

- vaatii saman permissionin ja yritysrajan
- palauttaa nykytilaprojektion `unpaid`-tilaan
- lisää yhden revert-eventin samassa transaktiossa
- on idempotentti, jos lasku on jo `unpaid`

## Hyvitykset Maksumerkinnän Jälkeen

Maksettu standardilasku voidaan myöhemmin hyvittää nykyisten
hyvityssääntöjen mukaan.

Hyvitys:

- ei poista tai muuta alkuperäistä maksuhistoriaa
- ei muuta aiemmin tallennettua `paid_amount_cents`-arvoa
- siirtää laskun listan Hyvitetyt-kategoriaan
- voi näyttää maksutilan lisämerkintänä `Maksettu`

Mahdollinen asiakkaalle palautettu raha on myöhempi erillinen refund- tai
pankkitoiminto. Sitä ei päätellä hyvityslaskusta automaattisesti.

## HTTP Ja Julkinen Read Model

Suunniteltu HTTP-sopimus:

```text
PUT /invoices/:id/payment
Content-Type: application/json

{
  "paidOn": "2026-07-31"
}

DELETE /invoices/:id/payment
```

`PUT` hyväksyy vain `paidOn`-kentän. `DELETE` ei hyväksy request bodya.
`companyId`, actor, summa ja maksulähteen lopullinen hyväksyntä tulevat
backendistä.

Turvalliset virheet:

- `400`: virheellinen body tai päivämäärä
- `403`: puuttuva permission
- `404`: tuntematon tai väärän yrityksen resurssi
- `409`: laskun tai maksumerkinnän tila ei salli toimintoa

Julkinen maksuprojektio:

```text
paymentState: unpaid | paid | notApplicable
paidOn: YYYY-MM-DD | null
paidAmountCents: integer | null
paymentSource: manual | null
```

Actorin tunnistetta, tapahtumataulun sisäisiä tunnisteita tai
pankkitapahtumatietoja ei palauteta tavalliseen laskun read modeliin.

## Listat Ja Asiakaskortti

Pääryhmät ovat toisensa poissulkevia:

- Lähetetyt: hyvittämätön ja maksamaton standardilasku
- Maksetut: hyvittämätön ja maksettu standardilasku
- Hyvitetyt: osittain tai kokonaan hyvitetty standardilasku maksutilasta
  riippumatta
- Perutut: perutut laskut

Sama juurilasku ei saa esiintyä useassa pääkategoriassa.

Hyvitetty maksettu lasku näkyy vain Hyvitetyt-kategoriassa ja saa tarvittaessa
`Maksettu`-lisämerkinnän. Asiakaskortti käyttää samoja Invoicingin omistamia,
yritys- ja asiakasrajattuja read modeleja eikä muodosta omia maksusääntöjä.

Listakyselyyn voidaan lisätä:

```text
paymentState: all | unpaid | paid
```

Sivutus säilyy backendissä.

## Activity, Diagnostics Ja Tietosuoja

Invoicing omistaa maksutapahtumien audit trailin. Activity saa näyttää
yritysrajatusta projektiosta:

- laskunumeron
- tapahtuma-ajan
- turvallisen toiminnon: merkitty maksetuksi tai maksumerkintä poistettu

Activity, tekninen JSONL-loki, Diagnostics, incident-index ja support bundle
eivät saa näyttää:

- maksettua euromäärää
- actorin tunnistetta
- pankkitiliä tai maksajan tietoja
- mahdollista tulevaa bank transaction id:tä
- laskun tai asiakkaan muuta sisältöä

Tavallinen domain-konflikti ei muodosta incident-index-tapausta. Tekninen
transaktiovirhe voidaan kirjata turvallisena failure-eventinä ilman
business-dataa.

## Tuleva Pankki- Ja Pilvipolku

Myöhempi pankkiadapteri ei kirjoita `invoices`-taulua eikä päätä maksutilaa
itse. Se validoi providerin tiedon omassa infrastructure-rajassaan ja kutsuu
samaa Invoicingin application service -ydintä eri `paymentSource`-arvolla.

Mahdollisia myöhempiä maksulähteitä ovat erikseen hyväksyttyinä:

- `bankImport`
- `bankIntegration`

Useat osasuoritukset, pankkitapahtuman kohdistus, palautukset ja pilven
moniprosessikilpailut vaativat omat päätöksensä. Ensimmäisen version
`manual`-mallia ei laajenneta arvaamalla.

## Testausmatriisi

Vähintään seuraavat invarianssit todistetaan:

- sent standardilasku voidaan merkitä maksetuksi
- maksumerkintä voidaan poistaa ja historia säilyy
- väärä yritys ja puuttuva permission estetään
- approved, cancelled, credit ja kokonaan hyvitetty estetään
- osittain hyvitetyn summa lasketaan backendissä
- sama pyyntö on idempotentti
- rinnakkainen pyyntö ei luo kahta tapahtumaa
- event- tai projection-write failure palauttaa koko transaktion
- API-client parsii maksuprojektion tiukasti
- Lähetetyt, Maksetut ja Hyvitetyt ovat toisensa poissulkevia
- Activity näyttää vain turvallisen projektion

Tarkemmat E2E-tapaukset ovat dokumentissa
`docs/architecture/r0-e2e-test-matrix.md`.
