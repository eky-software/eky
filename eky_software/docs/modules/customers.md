# Customers-moduuli

Tämä dokumentti kuvaa asiakashallinnan moduulin.

## Tarkoitus

Customers-moduuli hallitsee yrityksen asiakas-master-dataa.

Asiakas voi olla esimerkiksi:

- yksityishenkilö
- yritys
- taloyhtiö
- isännöitsijätoimisto
- muu organisaatio

Ensimmäinen toteutettu Customer create/list local -slice oli tekninen mallipolku, joka on kuvattu dokumentissa `docs/architecture/customer-vertical-slice-plan.md`.

Ensimmäinen rajattu web customer UI -pala on kuvattu dokumentissa `docs/architecture/web-customer-ui-plan.md`.

Nykyinen customer-toteutus laajentaa teknisen mallipolun Customer MVP -asiakaskortistoksi.

Se ei vielä ole koko lopullinen asiakashallintamoduuli.

## Moduuli Omistaa

Customers-moduuli omistaa:

- asiakkaan teknisen tunnisteen
- asiakkaan näkyvän asiakasnumeron
- asiakkaan nimen
- asiakkaan tyypin
- asiakkaan Y-tunnuksen, jos asiakas on yritys, taloyhtiö, isännöitsijätoimisto tai muu organisaatio
- asiakkaan yhteystiedot
- asiakkaan pääosoitteen
- asiakkaan sisäisen kommentin
- asiakkaan tilan
- asiakasdatan yritysrajauksen

Customers-moduuli saa myöhemmin omistaa yhteyshenkilöt ja useat osoitteet, jos ne päätetään toteuttaa osana asiakasmoduulia.

## Moduuli Ei Omista

Customers-moduuli ei omista:

- kohteita
- työmaita
- työmääräyksiä
- tuntikirjauksia
- materiaalikirjauksia
- laskuja
- laskurivejä
- maksusuorituksia
- varastosaldoja
- raportteja

Muut moduulit voivat viitata asiakkaaseen, mutta ne eivät saa muuttaa asiakkaan master-dataa suoraan.

Esimerkiksi laskutus voi käyttää asiakkaan tietoja laskun muodostuksessa, mutta laskutusmoduuli ei omista asiakkaan perustietoja.

## Customer MVP -Asiakaskortti

Ensimmäinen oikea asiakaskortisto laajentaa teknisen demon hyödylliseksi customer-moduuliksi.

MVP-kentät:

- `id`
- `companyId`
- `customerNumber`
- `name`
- `customerType`
- `businessId`
- `streetAddress`
- `postalCode`
- `city`
- `email`
- `phone`
- `comment`
- `status`
- `createdAt`
- `updatedAt`

Kenttien merkitys:

- `id` on tekninen sisäinen tunniste.
- `companyId` rajaa asiakkaan yritykseen.
- `customerNumber` on käyttäjälle näkyvä asiakasnumero.
- `name` on asiakkaan nimi.
- `customerType` kertoo asiakkaan tyypin.
- `businessId` on Y-tunnus, kun asiakkaalla sellainen on.
- `streetAddress`, `postalCode` ja `city` kuvaavat asiakkaan pääosoitetta.
- `email` ja `phone` ovat asiakkaan ensisijaiset yhteystiedot.
- `comment` on sisäinen vapaa kommentti.
- `status` kertoo, onko asiakas aktiivinen vai passivoitu.

## Asiakastyyppi

Ensimmäiset asiakastyypit voivat olla:

- `privatePerson`
- `company`
- `housingCompany`
- `propertyManager`
- `other`

Tarkat nimet lukitaan toteutusvaiheessa englanniksi.

Käyttöliittymä näyttää tyypit käyttäjälle suomeksi.

## Y-tunnus

Y-tunnus kuuluu asiakaskortin perustietoihin silloin, kun asiakkaalla on Y-tunnus.

Y-tunnus ei ole pakollinen yksityishenkilölle.

Y-tunnus voi olla pakollinen tai vahvasti suositeltu esimerkiksi:

- yritykselle
- taloyhtiölle
- isännöitsijätoimistolle
- muulle organisaatiolle

Ensimmäisessä toteutusvaiheessa Y-tunnuksen tarkka muotovalidointi voidaan pitää kevyenä.

Myöhemmin voidaan lisätä tarkempi suomalaisen Y-tunnuksen validointi, jos tarve toistuu tai laskutus sitä vaatii.

## Asiakasnumero

`id` ja `customerNumber` ovat eri asioita.

`id` on tekninen tunniste, jota järjestelmä käyttää sisäisiin viittauksiin.

`customerNumber` on käyttäjälle näkyvä asiakasnumero.

Säännöt:

- `customerNumber` ei ole tietokannan primary key.
- `customerNumber` on uniikki `companyId`-rajauksen sisällä.
- `customerNumber` voidaan myöhemmin antaa automaattisesti tai käsin.
- Isännöitsijätoimistoille voidaan myöhemmin sallia käsin määritetty numero.
- Asiakasnumerointia ei saa sekoittaa laskunumerointiin.

## Status

Asiakasta ei ensisijaisesti poisteta fyysisesti.

Ensimmäinen tilamalli voi olla:

- `active`
- `inactive`

Passivoitu asiakas säilyy historiassa ja viittauksissa, mutta sitä voidaan piilottaa oletuslistauksista myöhemmin.

## Suhde Muihin Moduuleihin

Customers vastaa kysymykseen:

```text
kuka asiakas on
```

Sites vastaa myöhemmin kysymykseen:

```text
missä työ tehdään
```

Work Orders vastaa myöhemmin kysymykseen:

```text
mitä työtä tehdään
```

Work Entries ja Material Entries vastaavat myöhemmin kysymykseen:

```text
mitä tehtiin ja mitä käytettiin
```

Invoicing vastaa myöhemmin kysymykseen:

```text
mitä veloitetaan
```

Lasku voi ottaa asiakkaan tiedoista snapshotin, jotta vanhan laskun tiedot eivät muutu takautuvasti, jos asiakaskorttia päivitetään myöhemmin.

## Rajataan Myöhemmäksi

Seuraavia ei lisätä ensimmäiseen Customer MVP -laajennukseen ilman erillistä päätöstä:

- laskutussähköposti erillisenä kenttänä
- verkkolaskuosoite
- OVT-tunnus
- verkkolaskuoperaattori
- maksuehto
- useat yhteyshenkilöt
- useat osoitteet
- erillinen laskutusosoite
- laskutushistoria
- työhistoria
- liitteet
- asiakaskohtaiset hinnastot
- luottoraja
- luottotietojen käsittely

Nämä ovat todennäköisiä myöhempiä tarpeita, mutta niitä ei lisätä ensimmäiseen laajennukseen varmuuden vuoksi.

## Turvallisuus

Asiakasdata kuuluu aina yritykselle.

Backend tarkistaa, että käyttäjällä on oikeus nähdä tai muokata kyseisen yrityksen asiakkaita.

Käyttöliittymä voi piilottaa toimintoja, mutta backend tekee lopulliset käyttöoikeuspäätökset.

Asiakastietojen muutoksista voidaan myöhemmin kirjata audit log.

Y-tunnus ja yhteystiedot ovat liiketoimintadataa, jota ei saa vuotaa väärälle yritykselle.

## Toteutuspolku

Customer MVP -asiakaskortiston toteutus tehdään pienissä vaiheissa.

Toteutusjärjestys:

1. SQLite-migraatio `customers`-taulun laajentamiseksi.
2. Domainin `Customer`-tyypin laajennus.
3. `customerRules`-sääntöjen päivitys tarvittaessa.
4. Repository-portin tarkistus ja tarvittava laajennus.
5. SQLite repository -adapterin päivitys.
6. Application servicejen päivitys.
7. HTTP-routejen input- ja response-rakenteiden päivitys.
8. `packages/api-client`-paketin päivitys.
9. Web UI -lomakkeen ja listan päivitys suomenkielisillä teksteillä.
10. Domain-, application-, HTTP- ja api-client-testien päivitys.

Ei lisätä uusia riippuvuuksia ilman erillistä päätöstä.

Ei lisätä Zodia, React Hook Formia, UI-kirjastoa, `packages/ui`-pakettia, sites-moduulia tai laskutusta tämän muutoksen yhteydessä.

## Avoimet Kysymykset

- Muodostetaanko `customerNumber` ensimmäisessä toteutuksessa automaattisesti vai annetaanko se käsin?
- Vaaditaanko Y-tunnus heti kaikilta organisaatiotyyppisiltä asiakkailta?
- Kuinka tarkka Y-tunnuksen validointi tehdään ensimmäisessä toteutuksessa?
- Näytetäänkö passivoidut asiakkaat oletuksena asiakaslistassa?
- Tarvitaanko asiakkaan poikkeava laskutusosoite jo ennen laskutusmoduulia?
