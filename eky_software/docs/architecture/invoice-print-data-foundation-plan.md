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

Lisäksi ennen tuotantokäyttöä laskulla näkyvät kentät tarkistetaan
ajantasaisista virallisista lähteistä tai kirjanpitäjän kanssa. Verohallinnon
arvonlisäverotuksen laskutusvaatimuksissa tavallisella laskulla tarvittavia
tietoja ovat muun muassa laskun antamispäivä, juokseva tunniste, myyjän
arvonlisäverotunniste, myyjän ja ostajan nimi ja osoite, tavaroiden tai
palvelujen määrä ja laji, toimitus- tai suorituspäivä tarvittaessa, veron
peruste verokannoittain, yksikköhinta ilman veroa, alennukset, verokanta ja
veron määrä.

Virallinen tarkistuslähde:
`https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/48090/laskutusvaatimukset-arvonlisaverotuksessa3/`

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

Company Settingsiin lisätään kenttä:

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

Hyväksytyn laskun snapshot-kenttä:

```text
company_vat_number_snapshot
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

Hyväksytyn laskun snapshot-kenttiä:

```text
customer_id
billing_recipient_customer_id

customer_name_snapshot
customer_number_snapshot
customer_business_id_snapshot
customer_email_snapshot
customer_street_address_snapshot
customer_postal_code_snapshot
customer_city_snapshot

billing_recipient_name_snapshot
billing_recipient_business_id_snapshot
billing_recipient_email_snapshot
billing_recipient_street_address_snapshot
billing_recipient_postal_code_snapshot
billing_recipient_city_snapshot
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

### Toimitus- Tai Suorituspäivä

Ennen print/PDF-vaihetta pitää ratkaista myös, tarvitaanko laskulle erillinen
toimitus- tai suorituspäivä:

```ts
supplyDate?: string;
```

Tätä voidaan tarvita silloin, kun tavaran toimitus- tai palvelun suorituspäivä
on määritettävissä ja eroaa laskun antamispäivästä.

Ensimmäinen mahdollinen malli:

- kenttä on valinnainen
- jos se puuttuu, laskupohja ei näytä erillistä suorituspäivää
- jos se annetaan, se snapshotataan hyväksytylle laskulle
- myöhemmin Sites- tai Work Orders -moduuli voi ehdottaa arvoa

Tätä ei toteuteta ennen kuin on päätetty, tarvitaanko se ensimmäiseen
laskupohjaan vai riittääkö alkuvaiheen manuaalinen laskutus ilman erillistä
suorituspäiväkenttää.

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

Myyjän tiedot Company Settingsistä snapshotataan hyväksytylle laskulle:

```text
company_name_snapshot
company_business_id_snapshot
company_vat_number_snapshot
company_street_address_snapshot
company_postal_code_snapshot
company_city_snapshot
company_email_snapshot
company_phone_snapshot
company_iban_snapshot
company_bic_snapshot
company_bank_name_snapshot
```

Maksutiedot laskuluonnokselta, laskutusasetuksista tai hyväksynnästä:

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
customer_number_snapshot
customer_name_snapshot
customer_business_id_snapshot
customer_type_snapshot
customer_email_snapshot
customer_phone_snapshot
customer_street_address_snapshot
customer_postal_code_snapshot
customer_city_snapshot

billing_recipient_customer_id
billing_recipient_customer_number_snapshot
billing_recipient_name_snapshot
billing_recipient_business_id_snapshot
billing_recipient_customer_type_snapshot
billing_recipient_email_snapshot
billing_recipient_phone_snapshot
billing_recipient_street_address_snapshot
billing_recipient_postal_code_snapshot
billing_recipient_city_snapshot
```

Kohde tai toimitustieto laskuluonnokselta:

```text
delivery_address_text
supply_date
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

## Vaihe 6: ALV-Merkinnät Ja Poikkeustilanteet

Nykyinen laskentamalli tukee ALV-kantoja ja ALV-erittelyä. Se ei vielä yksin
ratkaise kaikkia laskulla tarvittavia ALV-merkintöjä.

Ennen print/PDF-vaihetta pitää päättää, tarvitaanko ensimmäisessä laskupohjassa
seuraavia kenttiä tai niitä vastaavaa mallia:

```ts
vatTreatment?: string;
vatExemptionReason?: string;
buyerVatNumber?: string;
```

Näitä tarvitaan esimerkiksi tilanteissa, joissa:

- myynti on veroton tai arvonlisäverotuksen ulkopuolinen
- sovelletaan käännettyä verovelvollisuutta
- ostajan arvonlisäverotunniste pitää näkyä laskulla
- laskulla tarvitaan lakiviittaus tai selite verottomuuden perusteesta

Tärkeä sääntö:

```text
vatRateBasisPoints = 0
```

ei yksin kerro, onko kyse nollaverokannasta, verottomasta myynnistä,
arvonlisäverotuksen ulkopuolisesta toiminnasta tai käännetystä
verovelvollisuudesta.

Tätä ei pidä ratkaista pelkällä vapaalla tekstillä laskupohjassa, vaan
Invoicing tarvitsee myöhemmin hallitun vero- tai laskumerkintämallin.

Rakennusalan käännetty arvonlisäverovelvollisuus arvioidaan erikseen ennen
tuotantokäyttöä, koska Ekyä rakennetaan rakennusalan yrityksen tarpeisiin.

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
3. Päätetään, lisätäänkö ensimmäiseen print-polkuun `supplyDate`.
4. Päätetään ensimmäisen vaiheen ALV-merkintämalli nollaverokannalle, verottomuudelle ja mahdolliselle käännetylle verovelvollisuudelle.
5. Web-laskulomake saa laskun vastaanottajan, toimitus/kohde-kentän ja huomautusajan.
6. Hyväksyntä laajennetaan snapshottaamaan myyjän, asiakkaan, vastaanottajan, maksutietojen ja toimitus/kohde-tiedon arvot. Tämä on toteutettu ensimmäisessä print data foundation -persistence-vaiheessa.
7. Hyväksytylle laskulle tehdään read model katselu- ja print-polulle.
8. Vasta tämän jälkeen toteutetaan varsinainen print-layout.
9. PDF ja sähköpostilähetys tulevat print-layoutin jälkeen.

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
- hyväksyntä snapshottaa `supplyDate`-arvon, jos kenttä toteutetaan
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
