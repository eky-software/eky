# Sales-moduuli

Tämä dokumentti kuvaa myyntimoduulin alustavan ajatuksen.

Sales ei ole ensimmäisen MVP:n päämoduuli.

## Tarkoitus

Sales-moduuli voi myöhemmin hallita myyntiprosessia ennen varsinaista työtä ja laskutusta.

## Mahdollisia vastuita

- liidit
- tarjoukset
- tarjouspohjat
- tilaukset
- hinnoittelun periaatteet
- hyväksynnät
- tarjouksen muuttaminen työksi tai laskutukseksi

## Moduuli ei omista

- asiakkaan perustietoja
- laskuja
- työmääräyksen toteutusta
- varastosaldoja

## Tärkeitä käsitteitä

- Lead
- Offer tai Quote
- Order
- SalesStatus
- PriceEstimate

Termit `Offer` ja `Quote` päätetään myöhemmin sanastossa.

## Suhde muihin moduuleihin

Customers liittyy myyntiin asiakkaan kautta.

Work Orders voi syntyä hyväksytystä tarjouksesta myöhemmin.

Invoicing voi myöhemmin hyödyntää myynnin tietoja.

## Turvallisuus

Myyntitiedot voivat sisältää liiketoimintakriittistä dataa.

Käyttöoikeudet määritellään ennen toteutusta.

## Avoimet kysymykset

- tarvitaanko tarjousmoduuli ensimmäisessä vaiheessa?
- miten tarjous muuttuu työksi?
- miten tarjous muuttuu laskuksi?
- tarvitaanko hyväksyntäketju?
- kuka saa nähdä myynnin tiedot?