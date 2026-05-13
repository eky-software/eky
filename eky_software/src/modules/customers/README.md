# Customers-moduuli

Tämä README kuvaa customers-moduulin teknistä rakennetta.

Tarkempi liiketoimintakuvaus on tiedostossa `docs/modules/customers.md`.

## Tarkoitus

Customers-moduuli hallitsee asiakkaita ja niihin liittyviä perustietoja.

## Keskeiset käsitteet

- Customer
- ContactPerson
- Address
- BillingAddress
- CustomerStatus

## Moduulin vastuut

Moduuli vastaa:

- asiakkaan luonnista
- asiakkaan muokkauksesta
- asiakkaan hakemisesta
- asiakkaan listauksesta
- asiakkaan passivoinnista tai arkistoinnista
- asiakasdatan validoinnista omalta osaltaan

## Moduuli ei vastaa

- laskujen muodostuksesta
- työmääräyksistä
- tuntikirjauksista
- materiaalikirjauksista
- varastosaldoista

## Kerrokset

Toteutuksessa käytetään projektin yleisiä kerrossääntöjä.

Mahdolliset kerrokset:

- types
- validation
- service
- repository
- api
- ui feature

Tarkka kansiorakenne päätetään teknisen toteutuksen yhteydessä.

## Turvallisuus

Asiakasdata on yrityskohtaista.

Kaikissa backend-toiminnoissa tarkistetaan käyttäjän oikeus kyseisen yrityksen asiakkaisiin.

Asiakastietojen muutoksista voidaan kirjata audit log.

## Testaus

Testaa erityisesti:

- asiakasvalidointi
- yritysrajaus
- käyttöoikeudet
- asiakasstatuksen muutokset
- datan muunnokset API:n ja domainin välillä

## Avoimet kysymykset

- mitkä kentät ovat pakollisia?
- tarvitaanko Y-tunnus?
- tarvitaanko henkilötietoja?
- miten asiakas poistetaan tai passivoidaan?
- tarvitaanko useita yhteyshenkilöitä?