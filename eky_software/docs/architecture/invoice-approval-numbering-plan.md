# Laskun Hyväksyntä Ja Numerointi

Tämä dokumentti määrittää laskun hyväksyntä-, laskunumerointi-, snapshot-,
audit- ja local/cloud-periaatteet ennen varsinaista toteutusta.

Tämä dokumentti koskee vaihetta, jossa tallennetusta laskuluonnoksesta tulee
hyväksytty lasku. Luonnoksen luonti, muokkaus ja automaattitallennus on kuvattu
dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

## Periaate

Laskuluonnoksesta tulee hyväksytty lasku vain käyttäjän tietoisella toiminnolla.

Hyväksyntä ei tapahdu:

- automaattitallennuksessa
- tavallisessa tallennuksessa
- luonnoksen avaamisessa
- luonnoksen esikatselussa
- laskurivien tai summien muokkauksessa

Ensimmäinen toteutus voi sisältää yksittäisen luonnoksen hyväksyntätoiminnon:

```text
Laskuluonnoslomake
  -> Hyväksy laskuksi
```

Myöhemmän vaiheen toteutus voi sisältää myös koottuja hyväksyntätoimintoja:

```text
Laskutusluonnoslista
  -> valitse useita luonnoksia
    -> Hyväksy valitut laskuiksi
```

Koottu hyväksyntä käyttää samoja backendin application/domain-polkuja kuin
yksittäinen hyväksyntä. Se ei saa ohittaa validointia, numerointia,
snapshotteja, transaktiota, käyttöoikeuksia tai auditointia.

Koottu hyväksyntä esivalidoi myöhemmin kaikki valitut luonnokset. Jos yksikin
luonnos on virheellinen, hyväksyntää ei tehdä osittain. Käyttäjälle näytetään
korjattavat luonnokset.

## Laskunumero

Virallinen laskunumero annetaan vasta hyväksyntätilasiirtymässä.

Luonnoksella on vain tekninen `draftId`. Luonnoksella ei ole virallista
laskunumeroa.

```text
Draft:
- tekninen id / draftId
- ei virallista laskunumeroa

Approved invoice:
- tekninen id / invoiceId
- virallinen laskunumero
```

Frontend ei koskaan muodosta lopullista laskunumeroa.

Laskunumero muodostetaan backendissä hyväksyntä-application servicen kautta.
Backend tarkistaa yritysrajauksen, numerointisarjan, uniikkiuden ja
hyväksyttävän muodon.

## Tilat Ja Muokkaaminen

Alustava tilamalli:

```text
draft
  -> approved
    -> sent
      -> paid / credited myöhemmin
```

`draft`:

- saa muokata
- saa poistaa
- ei sisällä virallista laskunumeroa
- automaattitallennus on sallittu

`approved`:

- laskunumero on annettu
- lasku on sisäisesti hyväksytty
- laskua ei saa poistaa
- laskunumero ei muutu
- laskua voi korjata hallitusti ennen lähetystä erikoistapauksessa
- korjaus auditoidaan

`sent`:

- laskun sisältöä ei saa enää muuttaa
- laskunumero ei muutu
- laskua ei poisteta
- virhe korjataan myöhemmin hyvityslaskulla

Hyväksytyn mutta lähettämättömän laskun muokkaus ei ole vapaa luonnosmuokkaus.
Se on erillinen hallittu korjaustoiminto.

Mahdollinen UI-varoitus myöhemmin:

```text
Tämä lasku on jo hyväksytty ja sillä on laskunumero.
Muokkaus kirjataan tapahtumahistoriaan.
Jatketaanko?
```

## Virheen Korjaus

Jos lasku on `draft`-tilassa:

- korjataan muokkaamalla luonnosta
- tai poistetaan luonnos

Jos lasku on `approved` mutta ei vielä `sent`:

- voidaan sallia hallittu korjaus ennen lähetystä
- laskunumero ei muutu
- korjaus auditoidaan

Jos lasku on `sent`:

- sisältöä ei muuteta
- virhe korjataan myöhemmin hyvityslaskulla
- hyvityslaskua ei toteuteta tässä vaiheessa

## Laskunumeroinnin Omistajuus Ja UI-Sijainti

Käyttäjän näkökulmasta laskunumeroinnin asetukset voivat näkyä Oma yritys /
Asetukset -kokonaisuuden alla:

```text
Oma yritys
  -> Laskutusasetukset
    -> Laskunumerointi
```

Domain-omistajuuden näkökulmasta laskunumerointi kuuluu Invoicing-moduulille.

```text
UI-sijainti:
Company Settings / Oma yritys / Asetukset

Domain-omistaja:
Invoicing
```

Company Settings tai laajempi Asetukset-UI voi näyttää ja hallita
laskutusasetuksia käyttäjälle. Se ei tarkoita, että Company Settings omistaisi
laskunumeroinnin liiketoimintasäännöt.

Invoicing omistaa:

- laskunumeroinnin liiketoimintasäännöt
- numerointisarjat
- tilikauden laskutuskäytön
- numeron varauksen
- numerointisarjan etenemisen
- numeroinnin validoinnin

## Numerointimallit

Ensimmäinen toteutus suunnitellaan niin, että vähintään seuraavat mallit ovat
mahdollisia. Tarkka ensimmäisen koodivaiheen kenttämalli päätetään erillisessä
toteutustehtävässä.

### Malli A: Tilikausivuosi Ja Juokseva Numero

Esimerkkejä:

```text
20270001
2027000001
2027-0001
```

Mahdollisia asetuksia:

- `fiscalYearStartMonth`
- `yearSource = fiscalYear`
- `sequencePadding`
- `firstSequenceNumber`
- mahdollinen `prefix` tai `separator` myöhemmin

Esimerkki:

```text
fiscalYearStartMonth = 1
sequencePadding = 4
firstSequenceNumber = 1

2027-01-01 -> 20270001
2027-01-02 -> 20270002
```

Jos tilikausi alkaa helmikuussa:

```text
fiscalYearStartMonth = 2

2027-01-31 -> kuuluu vielä tilikauteen 2026
2027-02-01 -> kuuluu tilikauteen 2027
```

Tällä mallilla:

```text
2027-01-31 -> 202600xx
2027-02-01 -> 20270001
```

### Malli B: Pelkkä Juokseva Numerointi

Esimerkkejä:

```text
1
2
3
```

tai:

```text
1000
1001
1002
```

Mahdollisia asetuksia:

- `firstSequenceNumber`
- `sequencePadding` tarvittaessa
- ei pakollista vuosiosaa

### Malli C: Kalenterivuosi Ja Juokseva Numero

Kalenterivuosimallissa vuosiosa tulee suoraan laskupäivän kalenterivuodesta.
Se ei seuraa tilikauden aloituskuukautta.

Esimerkkejä:

```text
invoiceDate = 2027-01-31
sequencePadding = 4
sequenceNumber = 1
-> 20270001
```

```text
invoiceDate = 2027-12-31
sequencePadding = 4
sequenceNumber = 42
-> 20270042
```

```text
invoiceDate = 2028-01-01
sequencePadding = 4
sequenceNumber = 1
-> 20280001
```

Kalenterivuosimallin ja tilikausimallin ero:

```text
fiscalYearStartMonth = 2
invoiceDate = 2027-01-31
sequencePadding = 4
sequenceNumber = 1

fiscalYearSequence -> 20260001
calendarYearSequence -> 20270001
```

## Numeroinnin Pysyvyysmallin Pohja

Ensimmäinen persistence-pohja erottaa numeroinnin asetukset ja sarjan
etenemän omiin tauluihinsa.

Numerointiasetuksia voidaan hallita erillään hyväksytyistä laskuista.
Virallinen numeron varaus tapahtuu vasta hyväksyntätransaktiossa, samassa
kokonaisuudessa hyväksytyn laskun snapshotin, laskurivien, audit-tapahtuman ja
luonnoksen lukituksen kanssa.

### `invoice_numbering_settings`

`invoice_numbering_settings` tallentaa yrityskohtaiset numerointiasetukset
sarjalle.

Alustavat kentät:

- `company_id`
- `series_key`
- `mode`
- `fiscal_year_start_month`
- `sequence_padding`
- `first_sequence_number`
- `created_at`
- `updated_at`

`series_key` erottaa mahdolliset tulevat numerointisarjat toisistaan.
Ensimmäisessä MVP-vaiheessa käytetään oletussarjaa, esimerkiksi `default`.

`company_id` ja `series_key` muodostavat yhdessä uniikin asetusrivin.

### `invoice_number_sequences`

`invoice_number_sequences` tallentaa sen, mihin asti tietty numerointisarja on
edennyt tietyssä scope-rajauksessa.

Alustavat kentät:

- `company_id`
- `series_key`
- `sequence_scope`
- `last_sequence_number`
- `created_at`
- `updated_at`

`sequence_scope` määräytyy numerointimallin ja laskun päiväyksen perusteella:

```text
plainSequence
  -> plain

calendarYearSequence + invoiceDate 2027-01-31
  -> calendar-year:2027

fiscalYearSequence + fiscalYearStartMonth 2 + invoiceDate 2027-01-31
  -> fiscal-year:2026

fiscalYearSequence + fiscalYearStartMonth 2 + invoiceDate 2027-02-01
  -> fiscal-year:2027
```

`company_id`, `series_key` ja `sequence_scope` muodostavat yhdessä uniikin
sarjatilan.

`last_sequence_number` on viimeksi varattu numero kyseisessä sarjassa ja
scope-rajauksessa. Jos sarjatilaa ei ole vielä olemassa, hyväksyntälogiikka voi
myöhemmin aloittaa asetusten `first_sequence_number`-arvosta.

`reserveInvoiceNumber`-tyyppinen application-palvelu voi testata ja kapseloida
seuraavan numeron ratkaisemisen, mutta hyväksyntävaiheessa numeron varaus pitää
ajaa samassa backendin hallitussa transaktiossa kuin invoice snapshot ja audit.
Sitä ei saa myöhemmin käyttää erillisenä "varaa ensin numero, hyväksy lasku
myöhemmin" -polkuna, koska epäonnistunut hyväksyntä voisi muuten kuluttaa
laskunumeron.

Hyväksyntätransaktio ei saa muodostaa numeroa UI:ssa, HTTP-reitissä tai
SQLite-adapterin omana liiketoimintalogiikkana. Numerointimalli, scope ja
seuraava numero päätetään Invoicing-domain/application-polussa.

## Hyväksytyn Laskun Persistence-Pohja

Ensimmäinen hyväksyntäpohja erottaa muokattavat laskuluonnokset ja hyväksytyt
laskut toisistaan.

Laskuluonnokset pysyvät `invoice_drafts`-taulussa. Hyväksytty lasku tallennetaan
erilliseen `invoices`-tauluun ja sen rivit `invoice_lines`-tauluun.

Ensimmäisessä toteutusvaiheessa `invoice_drafts.status` pysyy local-MVP:n
tallennusmallissa `draft`-arvona. Luonnos lukitaan hyväksynnän jälkeen
`approved_invoice_id`- ja `approved_at`-kentillä. Tämä pitää vanhan
luonnostaulun yksinkertaisena ja estää luonnoksen jatkomuokkauksen ilman, että
muokattava luonnos ja hyväksytty lasku sekoittuvat samaan tietomalliin.

Periaate:

```text
invoice_drafts
  -> approved_invoice_id
  -> approved_at

invoices
  -> status = approved
  -> invoice_number
  -> customer snapshot
  -> company snapshot
  -> totals snapshot

invoice_lines
  -> approved invoice line snapshots

invoice_audit_events
  -> invoice.approved
```

Luonnoksen päivitys- ja poistopolut eivät saa käsitellä luonnosta, jolla on
`approved_invoice_id`. Hyväksyttyä laskua ei poisteta luonnoksen poistopolulla.

Ensimmäinen audit-taulu on Invoicing-moduulin rajattu audit-pohja. Se ei vielä
korvaa myöhemmin mahdollisesti tarvittavaa laajempaa audit-ratkaisua.

## Numerointiasetusten Muokkaaminen

Ennen ensimmäistä hyväksyttyä laskua numerointiasetuksia voidaan muuttaa
vapaammin.

Kun vähintään yksi lasku on jo hyväksytty, numerointiasetusten muuttaminen
vaatii vahvan varoituksen ja käyttäjän erillisen varmistuksen.

Periaatteet:

- vanhoja laskunumeroita ei muuteta
- samaa laskunumeroa ei saa syntyä kahdesti samalle yritykselle ja sarjalle
- seuraavaa numeroa ei saa asettaa pienemmäksi kuin seuraava vapaa numero
- suurempi hyppy voidaan sallia vahvalla varoituksella
- suurempi rakennemuutos voidaan myöhemmin toteuttaa uutena numerointisarjana
- muutos ei tapahdu vain vaihtamalla kenttiä, vaan vaatii vahvistetun toiminnon

Repository voi teknisesti tallentaa asetukset, mutta application/service-kerros
vastaa siitä, milloin muutokset ovat sallittuja. Kun numerointia on jo käytetty,
asetusten muuttaminen vaatii vahvistetun toiminnon, vahvat varoitukset ja
säännöt, jotka estävät numerohistorian rikkoutumisen.

Mahdollinen UI-varoitus myöhemmin:

```text
Laskunumerointia on jo käytetty.
Muutokset vaikuttavat tuleviin laskunumeroihin.
Aiemmin luotuja laskunumeroita ei muuteta.
Vahvista muutos erillisellä varmistuksella.
```

## Snapshotit Hyväksytyssä Laskussa

Hyväksyntä tallentaa laskulle snapshotin niistä tiedoista, joilla lasku
muodostui.

Periaate:

```text
Vanha hyväksytty lasku ei muutu, vaikka asiakas- tai yritystietoja muutetaan myöhemmin.
```

Asiakassnapshot voi sisältää:

- `customerId`
- `customerNumber`
- `customerName`
- `customerType`
- `businessId`
- `streetAddress`
- `postalCode`
- `city`
- `email`
- `phone`

Yrityssnapshot voi sisältää:

- `companyName`
- `businessId`
- `streetAddress`
- `postalCode`
- `city`
- `email`
- `phone`

Laskusnapshot sisältää vähintään:

- `invoiceNumber`
- `invoiceDate`
- `dueDate`
- `paymentTermDays`
- laskurivit
- määrät
- yksiköt
- yksikköhinnat
- alennukset
- ALV-kannat
- rivisummat
- ALV-erittelyn
- loppusumman

Myöhemmän vaiheen snapshot-tietoja voivat olla:

- pankkitili
- viitenumero
- verkkolaskuosoite
- laskutusosoite erikseen
- yrityksen logo
- lähetyskanava

Invoicing omistaa laskulle tallennetut snapshot-arvot. Snapshot ei siirrä
Customers- tai Company Settings -master-datan omistajuutta Invoicingille.

## Auditointi

Laskun hyväksyntä auditoidaan heti ensimmäisessä hyväksyntätoteutuksessa.

Auditointi ei jää myöhemmäksi, koska hyväksyntä, laskunumero ja snapshotit ovat
kriittisiä laskutustapahtumia.

Minimitason audit actionit:

```text
invoice.approved
invoice.edited_before_sending
invoice.sent myöhemmin
invoice.credited myöhemmin
```

Hyväksyntäauditin sisältö:

- `companyId`
- `actorUserId` tai local-MVP:ssa väliaikainen `local-user`
- `action = invoice.approved`
- `draftId`
- `invoiceId`
- `invoiceNumber`
- `fiscalYear` tarvittaessa
- `sequenceNumber` tarvittaessa
- `totalGrossCents`
- `createdAt`

Jos hyväksyttyä mutta lähettämätöntä laskua korjataan, siitä syntyy audit event:

```text
invoice.edited_before_sending
```

Tuotantovaiheessa `actorUserId` tulee oikeasta käyttäjähallinnasta.
Local-MVP:ssa voidaan käyttää väliaikaista `local-user`-arvoa, kunhan
rajauksen väliaikaisuus näkyy toteutuksessa ja testeissä.

Audit-rakenne voi ensimmäisessä vaiheessa olla Invoicing-moduulin rajattu
audit-toteutus tai myöhemmin päätettävä yleisempi audit-rakenne. Siitä ei saa
tehdä yleistä `utils`-, `events`- tai `common`-kaatopaikkaa.

## Transaktio

Laskun hyväksyntä tehdään yhdessä backendin hallitussa transaktiossa.

Samaan transaktioon kuuluvat:

- luonnoksen validointi
- laskunumeron varaus
- invoice snapshotin luonti
- invoice line snapshotien luonti
- audit eventin luonti
- draftin linkittäminen hyväksyttyyn invoiceen

Periaate:

```text
BEGIN
  validate draft
  reserve invoice number
  create invoice snapshot
  create invoice lines snapshot
  create audit event
  link draft to invoice
COMMIT
```

Jos jokin vaihe epäonnistuu, osittaista hyväksyntää ei saa jäädä.

Local-MVP:n tavoite on, että epäonnistunut hyväksyntä ei kuluta laskunumeroa.
Cloud- ja monen laitteen mallissa numeron varauksen aukottomuus arvioidaan
erikseen, koska hajautettu numerointi voi vaatia eri kompromisseja.

Ensimmäisessä SQLite-toteutuksessa transaktio varmistaa, että numerointisarjan
etenemä, hyväksytty lasku, laskurivit, audit-tapahtuma ja luonnoksen
`approved_invoice_id`-linkki onnistuvat tai peruuntuvat yhdessä.

## Local Ensin, Cloud Myöhemmin

Local-MVP:

- yksi kone
- yksi local backend
- yksi SQLite-tietokanta
- laskunumero varataan backendissä SQLite-transaktiossa

Cloud myöhemmin:

- frontend ei muodosta numeroa
- cloud backend varaa numeron
- numeron varaus tehdään transaktiossa
- tenant/company-rajaus tarkistetaan backendissä

Monen laitteen offline-hyväksyntää ei ratkaista vielä tässä vaiheessa.

Tulevaisuuden mahdollisia suuntia:

- virallinen hyväksyntä vaatii yhteyden cloudiin
- laitteille varataan omia numerosarjoja tai numeroblokkeja

Tämä vaatii erillisen suunnitelman ennen toteutusta.

## Lakisidonnaiset Ja Kirjanpidolliset Tarkistukset

Ennen tuotantokäyttöä laskunumerointiin, ALV-käsittelyyn, laskun sisältöön,
laskujen säilytettävyyteen ja hyvityslaskuihin liittyvät vaatimukset
tarkistetaan ajantasaisista virallisista lähteistä tai kirjanpitäjän kanssa.

Tämä ei estä MVP:n teknistä toteutusta, mutta laskutusta ei pidetä
tuotantovalmiina ennen tätä tarkistusta.

## Toteutusjärjestys

Alustava toteutusjärjestys:

1. Päivitetään dokumentaatio ja hyväksytään säännöt.
2. Tehdään domain-testit numeroinnille ja tilikausilogiikalle.
3. Toteutetaan numerointiasetusten domain-malli.
4. Toteutetaan numerointiasetusten ja sarjatilan persistence-pohja:
   - `invoice_numbering_settings`
   - `invoice_number_sequences`
   - repository-portit
   - SQLite-adapterit
5. Toteutetaan laskun hyväksyntä domain/application-suunnittelun kautta.
6. Lisätään hyväksytyn laskun tietokantamigraatiot:
   - `invoices`
   - `invoice_lines`
   - `audit_events` tarvittaessa
7. Toteutetaan hyväksynnän repository-portit ja SQLite-adapterit.
8. Toteutetaan backend API hyväksynnälle.
9. Päivitetään api-client.
10. Toteutetaan UI yksittäisen luonnoksen hyväksyntään.
11. Myöhemmin toteutetaan usean luonnoksen koottu hyväksyntä.
12. Myöhemmin toteutetaan `sent`-tila ja hyvityslasku.

## Testauslinja

Tuleva toteutus tarvitsee testit vähintään seuraaviin:

- tilikauden aloitus tammikuussa
- tilikauden aloitus helmikuussa
- tilikauden aloitus joulukuussa
- tilikauden vaihtumisen rajapäivä
- `sequencePadding = 4` tuottaa esimerkiksi `0001`
- `sequencePadding = 6` tuottaa esimerkiksi `000001`
- ensimmäinen numero `1`
- ensimmäinen numero `1000`
- sama laskunumero ei saa syntyä kahdesti samalle yritykselle ja sarjalle
- luonnos ei saa laskunumeroa
- hyväksyntä antaa laskunumeron
- hyväksyntä luo snapshotit
- hyväksyntä luo audit eventin
- epäonnistunut hyväksyntä ei saa kuluttaa laskunumeroa Local-MVP:ssa
- lähetettyä laskua ei saa muokata
- hyväksytyn mutta lähettämättömän laskun korjaus auditoidaan

## Rajataan Myöhemmäksi

Ei toteuteta tässä vaiheessa:

- hyvityslaskua
- laskun lähetystä
- PDF-tulostusta
- sähköpostilähetystä
- verkkolaskua
- maksusuoritusten kohdistusta
- monen laitteen offline-hyväksyntää
- koko asetuskeskuksen toteutusta
- usean luonnoksen koottua hyväksyntää
