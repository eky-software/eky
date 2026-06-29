# Laskun Print/PDF-Data Foundation

Tämä dokumentti määrittää, mitä laskudataa pitää saada kuntoon ennen
hyväksytyn laskun katselu-, print- ja PDF-vaihetta.

Tämä ei ole visuaalinen laskupohjasuunnitelma. Tämän dokumentin tarkoitus on
varmistaa, että hyväksytyllä laskulla on myöhemmin kaikki tarvittava
snapshot-data, jotta vanha lasku ei muutu, vaikka asiakas- tai yritystietoja
muutetaan myöhemmin.

## Perusperiaate

Master data ja laskun snapshot-data pidetään erillään.

```text
Company Settings
  -> oman yrityksen master-data

Customers
  -> asiakas-master-data

Invoicing
  -> laskuluonnokset
  -> hyväksytyt laskut
  -> hyväksytyn laskun snapshotit
```

Print-layout, PDF ja sähköpostilähetys eivät saa hakea muuttuvaa dataa suoraan
`Company Settings`- tai `Customers`-master-tauluista. Ne käyttävät hyväksytylle
laskulle tallennettua snapshotia.

## Miksi Tämä Tehdään Ennen Laskupohjaa

Nykyinen laskutuspolku pystyy käsittelemään laskuluonnoksia ja hyväksyntää
vaiheittain. Ennen varsinaista laskupohjaa pitää kuitenkin varmistaa, että
hyväksytty lasku sisältää laskulla näkyvät tiedot:

- myyjän tiedot
- asiakkaan tiedot
- laskun vastaanottajan tiedot
- maksutiedot
- viitenumeron
- viivästyskoron ja huomautusajan
- toimitus- tai kohdetiedon
- rivit, summat ja ALV-erittelyn

Jos nämä puuttuvat snapshotista, print/PDF-vaihe alkaisi arvata tai hakea
muuttuvaa master-dataa väärästä paikasta.

## Moduulien Omistajuus

Company Settings omistaa ohjelmaa käyttävän yrityksen master-datan:

- yrityksen nimi
- Y-tunnus
- ALV-tunnus
- osoite
- sähköposti
- puhelin
- IBAN
- BIC
- pankin nimi

Customers omistaa asiakas-master-datan:

- asiakasnumero
- nimi
- asiakastyyppi
- Y-tunnus
- osoite
- sähköposti
- puhelin
- taloyhtiö/isännöitsijä-suhde

Invoicing omistaa laskutuksen datan ja hyväksytyn laskun snapshotit:

- laskuluonnokset
- hyväksytyt laskut
- laskurivit
- laskunumeron
- viitenumeron
- maksuehdon ja eräpäivän
- viivästyskoron ja huomautusajan
- laskulla käytetyt myyjän, asiakkaan, vastaanottajan ja maksutietojen snapshotit

Invoicing saa lukea hyväksyntää varten tarvittavia tietoja muiden moduulien
rajattujen porttien kautta. Invoicing ei saa muuttaa Company Settings- tai
Customers-moduulien master-dataa.

## Vaihe 1: ALV-Tunnus Oma Yritys -Tietoihin

Company Settingsiin lisätään myöhemmin kenttä:

```ts
vatNumber: string;
```

Tietokantakenttä:

```text
vat_number
```

Käyttäjälle näkyvä teksti:

```text
ALV-tunnus
```

Esimerkkiplaceholder:

```text
FI12345678
```

Ensimmäisen vaiheen säännöt:

- kenttä saa olla tyhjä
- syöte trimmataan
- annettu arvo normalisoidaan isoiksi kirjaimiksi
- suomalainen perusmuoto `FI` + 8 numeroa hyväksytään
- monimutkaista EU VIES -tarkistusta ei tehdä MVP:ssä
- ALV-tunnusta ei muodosteta automaattisesti Y-tunnuksesta ilman erillistä päätöstä

Hyväksytyn laskun tuleva snapshot-kenttä:

```text
seller_vat_number
```

## Vaihe 2: Asiakas Ja Laskun Vastaanottaja

Laskulla erotetaan kaksi käsitettä:

```text
customerId
  = työn, kohteen tai laskun varsinainen asiakas

billingRecipientCustomerId
  = laskun vastaanottaja tai laskutusosoitteen asiakas
```

`customerId` pysyy pakollisena.

`billingRecipientCustomerId` on valinnainen. Jos sitä ei anneta, laskun
vastaanottaja on sama kuin `customerId`.

Esimerkki:

```text
customerId
  -> Luolavuorenrinne As.Oy

billingRecipientCustomerId
  -> Isännöinti Granberg Oy
```

Tämä mahdollistaa taloyhtiö/isännöitsijä-mallin ilman erillistä maksajarekisteriä.

Ensimmäisen vaiheen säännöt:

- `billingRecipientCustomerId` on valinnainen laskuluonnoksen kenttä
- jos arvo annetaan, backend tarkistaa yritysrajauksen samalla periaatteella kuin `customerId`-arvolle
- virheellinen tai toisen yrityksen vastaanottaja hylätään turvallisesti
- virhe ei saa paljastaa, löytyykö asiakas toisesta yrityksestä
- Customers-moduulin `managedByCustomerId` voi toimia UI-ehdotuksena taloyhtiölle
- ehdotus ei ole pakottava sääntö
- käyttäjä voi jättää vastaanottajan samaksi kuin asiakas

Ei tehdä vielä:

- erillistä maksajarekisteriä
- yleistä party-role-mallia
- verkkolaskun vastaanottajarakennetta
- automaattista sääntöä, että taloyhtiö laskutetaan aina isännöitsijän kautta

Hyväksytyn laskun tulevia snapshot-kenttiä:

```text
customer_id
billing_recipient_customer_id

customer_name
customer_number
customer_business_id

billing_recipient_name
billing_recipient_business_id
billing_recipient_email
billing_recipient_street_address
billing_recipient_postal_code
billing_recipient_city
```

Jos laskun vastaanottaja on sama kuin asiakas, hyväksyntä tallentaa silti
tulostuksessa tarvittavat vastaanottajatiedot yksiselitteisesti snapshotiin.
Print/PDF-kerros ei saa joutua arvaamaan, mistä kentistä vastaanottaja
muodostetaan.

## Vaihe 3: Toimitus Tai Kohde

Ennen Sites-moduulia laskuluonnokselle voidaan lisätä kevyt vapaa tekstikenttä:

```ts
deliveryAddressText: string;
```

Tietokantakenttä:

```text
delivery_address_text
```

Käyttäjälle näkyvä teksti:

```text
Toimitus / kohde
```

Ohjeteksti:

```text
Näkyy myöhemmin laskulla työn kohteena tai toimitusosoitteena.
```

Ensimmäisen vaiheen säännöt:

- kenttä on valinnainen
- syöte trimmataan
- tyhjä arvo sallitaan
- pituus rajataan esimerkiksi 500 merkkiin
- kenttä ei vielä viittaa Sites-moduuliin

Myöhemmin Sites-moduuli voi täydentää tai korvata tämän varsinaisella
`siteId`- ja kohdesnapshot-mallilla. Manuaalinen laskutus ei silti saa alkaa
edellyttää kohdetta.

## Vaihe 4: Huomautusaika Laskukohtaiseksi Arvoksi

Invoicing payment settings sisältää oletushuomautusajan:

```ts
defaultReminderPeriodDays: number;
```

Ennen print/PDF-vaihetta laskuluonnokselle ja hyväksytylle laskulle tarvitaan
laskukohtainen arvo:

```ts
reminderPeriodDays: number;
```

Säännöt:

- jos create-pyynnössä ei anneta arvoa, backend käyttää `defaultReminderPeriodDays`-arvoa
- jos arvo annetaan, se tallennetaan laskukohtaiseksi arvoksi
- update-pyynnössä puuttuva arvo säilyttää olemassa olevan luonnoksen arvon
- hyväksytty lasku snapshottaa käytetyn arvon

Käyttäjälle näkyvä teksti:

```text
Huomautusaika päivinä
```

## Vaihe 5: Hyväksytyn Laskun Snapshot

Hyväksyntätransaktiossa hyväksytylle laskulle tallennetaan vähintään seuraavat
print/PDF-polun tarvitsemat snapshotit.

Myyjän tiedot Company Settingsistä:

```text
seller_company_name
seller_business_id
seller_vat_number
seller_street_address
seller_postal_code
seller_city
seller_email
seller_phone
seller_iban
seller_bic
seller_bank_name
```

Maksutiedot laskuluonnokselta, asetuksista tai hyväksynnästä:

```text
payment_term_days
late_payment_interest_basis_points
reminder_period_days
due_date
reference_number
reference_number_type
```

Asiakkaan ja laskun vastaanottajan tiedot Customers-moduulista:

```text
customer_name
customer_number
customer_business_id

billing_recipient_name
billing_recipient_business_id
billing_recipient_email
billing_recipient_street_address
billing_recipient_postal_code
billing_recipient_city
```

Kohde tai toimitustieto laskuluonnokselta:

```text
delivery_address_text
```

ALV-erittely hyväksytyistä riveistä:

```text
vatBreakdown:
  - vatRateBasisPoints
  - netTotalCents
  - vatTotalCents
  - grossTotalCents
```

ALV-erittely muodostetaan hyväksytyistä riveistä backendin domain-sääntöjen
mukaisesti. Sitä ei lasketa frontendissä uudella logiikalla.

## Hyväksynnän Portit Ja Transaktio

Jos hyväksynnän repository tai service alkaa paisua, snapshot-tietoja varten
käytetään selkeitä portteja, esimerkiksi:

```ts
CompanySettingsSnapshotReader
CustomerBillingSnapshotReader
```

Portit lukevat vain hyväksyntään tarvittavat snapshot-arvot. Ne eivät saa
antaa Invoicing-moduulille oikeutta muuttaa Company Settings- tai Customers-dataa.

Hyväksyntä pysyy transaktiona:

```text
laskunumero
viitenumero
invoice snapshot
invoice lines snapshot
seller snapshot
customer/billing recipient snapshot
payment snapshot
audit
draft lock
```

Kaikki onnistuu samassa transaktiossa tai mikään ei tallennu.

## Turvallisuus Ja Validointi

Tulevissa koodivaiheissa:

- `companyId` tulee backendin vahvistamasta kontekstista, ei request bodysta
- `customerId` ja `billingRecipientCustomerId` tarkistetaan samaan yritykseen
- backend validoi tyypit, pituudet ja sallitut arvot
- SQL on aina parametrisoitua
- virheet ovat turvallisia eivätkä paljasta toisen yrityksen dataa
- hyväksyntä auditoidaan
- local-MVP pysyy vain loopback-kehityskäytössä synteettisellä datalla

## Toteutusjärjestys

Tämä kokonaisuus tehdään pienissä commiteissa.

Suositeltu marssijärjestys:

1. `CompanySettings` saa `vatNumber`-kentän.
2. `InvoiceDraft` saa `billingRecipientCustomerId`, `deliveryAddressText` ja `reminderPeriodDays` -kentät.
3. Web-laskulomake saa laskun vastaanottajan, toimitus/kohde-kentän ja huomautusajan.
4. Hyväksyntä laajennetaan snapshottaamaan myyjän, asiakkaan, vastaanottajan, maksutietojen ja toimitus/kohde-tiedon arvot.
5. Hyväksytylle laskulle tehdään read model katselu- ja print-polulle.
6. Vasta tämän jälkeen toteutetaan varsinainen print-layout.
7. PDF ja sähköpostilähetys tulevat print-layoutin jälkeen.

Jos hyväksyntäsnapshotin vaihe kasvaa liian suureksi, se pysäytetään erilliseksi
toteutussuunnitelmaksi. Puolittaista snapshotia ei jätetä ilman testejä.

## Testauslinja

Tulevat koodimuutokset tarvitsevat testit vähintään seuraavista:

- Company Settings hyväksyy tyhjän `vatNumber`-arvon
- Company Settings normalisoi validin suomalaisen `vatNumber`-arvon
- Company Settings hylkää virheellisen `vatNumber`-arvon
- laskuluonnos voi tallentaa `billingRecipientCustomerId`-arvon
- laskuluonnos voi jättää `billingRecipientCustomerId`-arvon tyhjäksi
- `billingRecipientCustomerId` validoidaan samaan yritykseen
- `deliveryAddressText` tallentuu ja trimmataan
- `reminderPeriodDays` tallentuu laskukohtaiseksi arvoksi
- hyväksyntä snapshottaa myyjän tiedot ja `sellerVatNumber`-arvon
- hyväksyntä snapshottaa pankkitiedot
- hyväksyntä snapshottaa asiakkaan tiedot
- hyväksyntä snapshottaa laskun vastaanottajan tiedot
- hyväksyntä snapshottaa `deliveryAddressText`-arvon
- hyväksyntä snapshottaa `latePaymentInterestBasisPoints`- ja `reminderPeriodDays`-arvot
- myöhempi Company Settings- tai Customer-muutos ei muuta hyväksytyn laskun snapshotia

## Rajaus

Tässä kokonaisuudessa ei vielä tehdä:

- visuaalista laskupohjaa
- print-layoutia
- PDF:ää
- sähköpostilähetystä
- verkkolaskua
- maksusuoritusten seurantaa
- hyvityslaskua
- erillistä maksajarekisteriä
- Sites-moduulin toteutusta
- laajaa party-role-mallia
- uusia riippuvuuksia
