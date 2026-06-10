# Invoicing-moduuli

Tämä dokumentti kuvaa laskutusmoduulin.

Laskutus on kriittinen moduuli. Muutokset laskutukseen vaativat erityistä huolellisuutta.

## Tarkoitus

Invoicing-moduuli hallitsee laskuluonnoksia, laskuja, laskurivejä, laskun tiloja ja laskutuksen sääntöjä.

Laskutus toimii itsenäisesti. Manuaalinen lasku voidaan luoda suoraan asiakkaalle ilman kohdetta, työmääräystä, tuntikirjausta tai mobiilityönkulkua.

Laskutuksen ja valinnaisen työnohjauspolun rajat on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

Ensimmäisen manuaalisen laskuluonnos-MVP:n rajaus, classic-käyttöliittymä ja toteutusvaiheet on kuvattu dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

## Moduuli omistaa

- laskuluonnokset
- laskut
- laskurivit
- laskun tilat
- laskunumeroinnin
- ALV-käsittelyn
- maksuehdot
- laskulla käytetyt hinta- ja osapuolitietojen snapshotit
- laskutuksen audit-tapahtumat
- hyvityslaskut myöhemmin

## Moduuli ei omista

- asiakkaan perustietoja
- asiakaskohtaisia tuntihintaohituksia
- oman yrityksen oletustuntihintaa
- kohteen perustietoja
- tuntikirjausten alkuperäistä dataa
- materiaalikirjausten alkuperäistä dataa
- varastosaldoja

## Tärkeitä käsitteitä

- InvoiceDraft
- Invoice
- InvoiceLine
- InvoiceStatus
- Vat
- PaymentTerm
- CreditInvoice

## Laskun tilat

Alustavat tilat:

- draft
- approved
- sent
- paid
- cancelled

Tilasiirtymät määritellään domain-säännöillä.

## Perinteinen laskutus

Ensimmäinen MVP voi sisältää perinteisen laskunkirjoituksen:

1. valitaan asiakas
2. valitaan kohde tarvittaessa
3. lisätään laskurivit
4. lasketaan summat ja ALV
5. tallennetaan laskuluonnos
6. hyväksytään lasku

Kohde on valinnainen. Work Orders -moduulia ei tarvita tämän polun käyttämiseen.

## ERP-laskutus myöhemmin

Myöhemmin lasku voi muodostua hyväksytyistä:

- tuntikirjauksista
- materiaalikirjauksista
- työmääräyksistä
- tarjouksista

Nämä eivät saa siirtyä lopulliseen laskuun ilman hallittua prosessia.

Työmääräyksestä tai kirjauksista muodostuva aineisto on laskuehdotus tai laskuluonnoksen lähtötieto. Toimisto tarkistaa aineiston ennen lopullista laskutusta.

## Laskun Lähde Suunnittelutasolla

Laskulla voi myöhemmin olla:

- pakollinen `customerId`
- valinnainen `siteId`
- `sourceType`, kuten `manual` tai `workOrder`
- valinnainen `sourceId`

Manuaalisessa laskussa `sourceType` voi olla `manual` ja `sourceId` tyhjä.

Työmääräyksestä muodostetussa laskuehdotuksessa `sourceType` voi olla `workOrder` ja `sourceId` työmääräyksen tunniste.

Tarkka tietomalli päätetään erillisessä toteutussuunnitelmassa.

## Snapshot-Periaate

Laskulle tai laskuriville tallennetaan myöhemmin käytetyt hinnat snapshotiksi.

Tämä koskee esimerkiksi:

- käytettyä tuntihintaa
- asiakkaan laskuhetken tietoja
- oman yrityksen laskuhetken tietoja

Vanha lasku ei saa muuttua, vaikka myöhemmin muuttuvat:

- asiakkaan perustiedot
- asiakkaan asiakaskohtainen tuntihinta
- oman yrityksen oletustuntihinta
- oman yrityksen perustiedot

Customers-moduuli omistaa asiakkaan perustiedot ja mahdollisen asiakaskohtaisen tuntihintaohituksen.

Company Settings -moduuli omistaa oman yrityksen tiedot ja oletustuntihinnan.

Invoicing omistaa laskulla käytetyt snapshot-arvot.

## Turvallisuus

Laskutus vaatii vahvat käyttöoikeudet.

Backend tarkistaa aina:

- saako käyttäjä nähdä laskun
- saako käyttäjä luoda laskuluonnoksen
- saako käyttäjä hyväksyä laskun
- saako käyttäjä lähettää laskun
- saako käyttäjä perua laskun

Laskutuksen tärkeistä muutoksista kirjataan audit log.

## Rahasummat

Rahasummien käsittely päätetään ennen toteutusta.

Floating point -epätarkkuuksia vältetään.

## Avoimet kysymykset

- miten laskunumerointi tehdään?
- tarvitaanko PDF ensimmäisessä versiossa?
- tarvitaanko sähköpostilähetys?
- tarvitaanko verkkolasku myöhemmin?
- kuka saa hyväksyä laskun?
- miten hyvityslasku tehdään?
- voiko hyväksyttyä laskua muuttaa?
