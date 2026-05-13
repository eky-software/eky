# Customers-moduuli

Tämä dokumentti kuvaa asiakashallinnan moduulin.

## Tarkoitus

Customers-moduuli hallitsee yrityksen asiakkaita.

Asiakas voi olla esimerkiksi yksityishenkilö, yritys, taloyhtiö tai muu organisaatio.

## Moduuli omistaa

- asiakkaan perustiedot
- asiakkaan yhteystiedot
- asiakkaan osoitteet
- asiakkaan laskutustiedot
- asiakkaan tilan
- yhteyshenkilöt, jos ne toteutetaan osana asiakasmoduulia

## Moduuli ei omista

- laskuja
- laskurivejä
- työmääräyksiä
- tuntikirjauksia
- materiaalikirjauksia
- varastosaldoja
- raportteja

## Tärkeitä käsitteitä

- Customer
- ContactPerson
- Address
- BillingAddress
- CustomerStatus

## Suhde muihin moduuleihin

Sites voi viitata asiakkaaseen.

Invoicing voi käyttää asiakkaan tietoja laskun muodostuksessa.

Reporting voi lukea asiakasdataa raportteihin.

Mikään muu moduuli ei saa muuttaa asiakkaan perustietoja suoraan.

## Turvallisuus

Asiakasdata kuuluu aina yritykselle.

Backend tarkistaa, että käyttäjällä on oikeus nähdä tai muokata kyseisen yrityksen asiakkaita.

Asiakastietojen muutoksista voidaan kirjata audit log.

## Ensimmäisen MVP:n mahdolliset toiminnot

- asiakkaan luonti
- asiakkaan muokkaus
- asiakkaan haku
- asiakkaan listaus
- asiakkaan arkistointi tai passivointi
- asiakkaan tarkastelunäkymä

## Avoimet kysymykset

- mitä tietoja asiakkaasta tarvitaan MVP:ssä?
- tarvitaanko Y-tunnus?
- tarvitaanko henkilötietoja?
- tarvitaanko useita yhteyshenkilöitä?
- tarvitaanko useita laskutusosoitteita?
- poistetaanko asiakas oikeasti vai passivoidaanko se?