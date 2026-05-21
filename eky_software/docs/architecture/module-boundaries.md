# Moduulien rajat ja vastuut

Tämä dokumentti määrittelee Eky-järjestelmän moduulien vastuut ja rajat.

Tavoitteena on estää se, että kaikki alkaa riippua kaikesta.

## Periaate

Jokainen moduuli omistaa oman datansa, sääntönsä ja käyttötapauksensa.

Toinen moduuli ei saa muuttaa suoraan toisen moduulin sisäistä dataa.

Moduulien välinen kommunikaatio tapahtuu selkeiden rajapintojen, palveluiden, DTO-rakenteiden tai myöhemmin tapahtumien kautta.

## Customers

Customers-moduuli omistaa asiakkaat.

Vastuut:

- asiakkaan perustiedot
- yhteystiedot
- laskutusosoitteet
- asiakashistoriaan liittyvät viittaukset
- asiakkaan tila

Customers-moduuli ei omista:

- laskuja
- työmääräyksiä
- varastosaldoja
- tuntikirjauksia
- materiaalikirjauksia

Invoicing, Work Orders, Inventory, Reporting tai muut moduulit eivät saa kirjoittaa customers-moduulin omistamaan asiakasdataan suoraan.

Ensimmäinen rajattu Customer create/list local -toteutuspala on kuvattu dokumentissa `docs/architecture/customer-vertical-slice-plan.md`.

## Sites

Sites tarkoittaa kohteita tai työmaita.

Vastuut:

- kohteen perustiedot
- kohteen osoite
- kohteen asiakasviittaus
- kohteen tila
- kohteeseen liittyvät työviittaukset

Sites ei omista:

- asiakkaan perustietoja
- laskun muodostusta
- työntekijöiden käyttäjätietoja
- varastosaldoja

## Sales

Sales voi myöhemmin omistaa myyntiprosessin.

Vastuut mahdollisesti myöhemmin:

- liidit
- tarjoukset
- tilaukset
- tarjouspohjat
- myyntivaiheet

Sales ei ole ensimmäisen MVP:n päämoduuli.

## Work Orders

Work Orders omistaa työmääräykset.

Vastuut:

- mitä työtä tehdään
- missä kohteessa työ tehdään
- kuka työn tekee tai vastaa siitä
- työn tila
- aikataulu
- työmääräykseen liittyvät kirjaukset

Work Orders ei omista:

- laskun lopullista muodostusta
- asiakkaan perustietoja
- varaston saldoja

## Work Entries

Work Entries omistaa tunti- ja työaikakirjaukset.

Vastuut:

- työntekijän kirjaama aika
- päivämäärä
- kohde
- työmääräys
- kuvaus
- hyväksyntätila
- synkronointitila mobiilissa myöhemmin

Work Entries ei muodosta lopullista laskua yksin.

## Material Entries

Material Entries omistaa työmaalle kirjatut materiaalitapahtumat.

Vastuut:

- mitä materiaalia käytettiin
- määrä
- yksikkö
- kohde
- työmääräys
- mahdollinen laskutettava hinta
- hyväksyntätila

Material Entries ei ole sama asia kuin Inventory.

## Inventory

Inventory omistaa varastonhallinnan.

Vastuut mahdollisesti myöhemmin:

- tuotteet
- saldot
- varastopaikat
- ostot
- varaukset
- inventointi

Inventory ei ole ensimmäisen MVP:n päämoduuli.

## Invoicing

Invoicing omistaa laskutuksen.

Vastuut:

- laskuluonnokset
- laskut
- laskurivit
- ALV-käsittely
- maksuehdot
- laskun tilat
- hyvityslaskut myöhemmin
- laskunumerointi
- laskutuksen audit trail

Invoicing voi lukea asiakas-, kohde-, työ- ja materiaalidataa rajapintojen kautta, mutta ei saa muuttaa toisen moduulin omistamaa dataa suoraan.

## Reporting

Reporting omistaa raporttinäkymät ja koosteet.

Vastuut:

- dashboardit
- raportit
- vienti Exceliin tai PDF:ään
- käyttöoikeudet raportteihin

Reporting ei omista lähdedataa, vaan lukee muiden moduulien tarjoamaa dataa.

## Auth ja Permissions

Auth vastaa käyttäjän tunnistamisesta.

Permissions vastaa siitä, mitä käyttäjä saa tehdä.

Frontend voi piilottaa toimintoja, mutta backend tekee lopulliset käyttöoikeuspäätökset.

## AI-agentit

AI-agentit eivät omista liiketoimintadataa.

AI-agentit voivat tulevaisuudessa kutsua palveluita, mutta ne eivät saa ohittaa moduulirajoja.

## Rajojen rikkominen

Moduulirajan rikkomista ovat esimerkiksi:

- laskutus muuttaa asiakkaan perustietoja suoraan
- frontend kirjoittaa tietokantaan
- repository päättää laskun hyväksymisestä
- raportointi muuttaa lähdedataa
- AI-agentti kirjoittaa suoraan tietokantaan

Jos moduuliraja tuntuu estävän järkevän työn, rajaa muutetaan dokumentoidulla päätöksellä, ei oikopolulla.
