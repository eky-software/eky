# Work Orders -moduuli

Tämä dokumentti kuvaa työmääräysten moduulin.

## Tarkoitus

Work Orders -moduuli hallitsee töitä, joita yritys tekee asiakkaille ja kohteille.

Työmääräys kuvaa mitä tehdään, missä tehdään ja mahdollisesti kuka työn tekee.

Work Orders on valinnainen toiminnanohjaus- ja kenttätyöpolku. Laskutus voi toimia ilman työmääräystä.

Laskutuksen ja työnohjauspolun rajat on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

## Moduuli omistaa

- työmääräyksen perustiedot
- työn kuvauksen
- työn tilan
- kohdeviittauksen
- aikataulun
- vastuuhenkilön tai työntekijän
- työmääräykseen liittyvät viittaukset kirjauksiin

## Moduuli ei omista

- asiakkaan perustietoja
- kohteen perustietoja
- laskun lopullista muodostusta
- varastosaldoja
- käyttäjän perustietoja

## Tärkeitä käsitteitä

- WorkOrder
- WorkOrderStatus
- AssignedEmployee
- Schedule
- WorkDescription

## Mahdolliset tilat

Alustavia tiloja:

- draft
- planned
- inProgress
- completed
- approved
- cancelled

Tilat päätetään myöhemmin tarkemmin.

## Suhde muihin moduuleihin

Customers liittyy työmääräykseen asiakkaan kautta.

Sites liittyy työmääräykseen kohteen kautta.

Work Entries voi kirjata aikaa työmääräykselle.

Material Entries voi kirjata materiaaleja työmääräykselle.

Invoicing voi myöhemmin hyödyntää hyväksyttyjä tietoja.

Työmääräys, tuntikirjaukset ja materiaalikirjaukset voivat myöhemmin tuottaa laskuehdotuksen lähtöaineiston. Ne eivät muodosta lopullista laskua suoraan.

## Turvallisuus

Työmääräyksen näkyvyys voi riippua roolista.

Työntekijä voi nähdä vain omat työmääräyksensä.

Työnjohtaja voi nähdä ja hyväksyä laajemmin.

Backend tarkistaa oikeudet.

## Avoimet kysymykset

- tarvitaanko työmääräys ensimmäisessä kenttätyön MVP:ssä?
- voiko kohteella olla monta työmääräystä?
- kuka saa muuttaa työmääräyksen tilaa?
- miten työmääräys näkyy mobiilissa?
