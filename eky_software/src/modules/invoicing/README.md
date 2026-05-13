# Invoicing-moduuli

Tämä README kuvaa invoicing-moduulin teknistä rakennetta.

Tarkempi liiketoimintakuvaus on tiedostossa `docs/modules/invoicing.md`.

## Tarkoitus

Invoicing-moduuli hallitsee laskuluonnoksia, laskuja, laskurivejä ja laskutuksen sääntöjä.

## Keskeiset käsitteet

- InvoiceDraft
- Invoice
- InvoiceLine
- InvoiceStatus
- Vat
- PaymentTerm
- CreditInvoice

## Moduulin vastuut

Moduuli vastaa:

- laskuluonnoksen luonnista
- laskurivien hallinnasta
- laskun summien laskennasta
- ALV-käsittelystä
- laskun tiloista
- laskun hyväksymisestä
- laskun lähettämisestä myöhemmin
- laskun audit-tapahtumista

## Moduuli ei vastaa

- asiakkaan perustietojen hallinnasta
- kohteen perustietojen hallinnasta
- tuntikirjausten alkuperäisestä hallinnasta
- materiaalikirjausten alkuperäisestä hallinnasta
- varastosaldoista

## Laskun elinkaari

Alustava elinkaari:

1. draft
2. approved
3. sent
4. paid

Poikkeustila:

- cancelled

Tilasiirtymät määritellään domain-säännöillä.

## Perinteinen laskunkirjoitus

Ensimmäinen MVP voi sisältää käsin tehtävän laskuluonnoksen.

Käyttäjä valitsee asiakkaan, lisää laskurivit ja hyväksyy laskun.

## Laajempi laskutus myöhemmin

Myöhemmin lasku voi muodostua:

- hyväksytyistä tuntikirjauksista
- hyväksytyistä materiaalikirjauksista
- työmääräyksistä
- tarjouksista

## Turvallisuus

Kaikki laskutustoiminnot tarkistetaan backendissä.

Laskutusdata kuuluu yritykselle.

Käyttöoikeudet ja audit log ovat pakollisia kriittisissä toiminnoissa.

## Testaus

Testaa erityisesti:

- summalaskenta
- ALV
- laskun tilasiirtymät
- käyttöoikeudet
- virheelliset syötteet
- laskurivien käsittely
- laskuluonnoksen ja lopullisen laskun ero

## Avoimet kysymykset

- miten laskunumerointi toteutetaan?
- tehdäänkö PDF MVP:ssä?
- miten lasku lähetetään?
- miten hyvityslasku toteutetaan?
- kuka saa hyväksyä laskun?
- voiko hyväksyttyä laskua muuttaa?