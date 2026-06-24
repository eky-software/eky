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

Customer UI:n käyttökokemuksen korjaus nykyisestä teknisestä kenttäläpiviennistä oikeaksi asiakaskortistonäkymäksi on kuvattu dokumentissa `docs/architecture/customer-ui-ux-plan.md`.

Asiakkaan myöhempi koontinäkymä ja suhde muiden moduulien tietoihin on kuvattu dokumentissa `docs/architecture/customer-overview-plan.md`.

Nykyinen customer-toteutus laajentaa teknisen mallipolun Customer MVP -asiakaskortistoksi.

Se ei vielä ole koko lopullinen asiakashallintamoduuli.

Nykyinen Customer MVP tukee asiakkaiden listaamista, uuden asiakkaan luontia ja olemassa olevan asiakkaan perustietojen muokkaamista.

## Moduuli Omistaa

Customers-moduuli omistaa:

- asiakkaan teknisen tunnisteen
- asiakkaan näkyvän asiakasnumeron
- asiakkaan nimen
- asiakkaan tyypin
- taloyhtiön ja isännöitsijätoimiston välisen asiakasrekisterisuhteen
- asiakkaan Y-tunnuksen, jos asiakas on yritys, taloyhtiö, isännöitsijätoimisto tai muu organisaatio
- asiakkaan yhteystiedot
- asiakkaan pääosoitteen
- asiakkaan asiakaskohtaisen tuntihintaohituksen
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
- `managedByCustomerId`
- `businessId`
- `streetAddress`
- `postalCode`
- `city`
- `email`
- `phone`
- `hourlyRateOverrideCents`
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
- `managedByCustomerId` kertoo taloyhtiön isännöitsijätoimiston, jos asiakas on taloyhtiö.
- `businessId` on Y-tunnus, kun asiakkaalla sellainen on.
- `streetAddress`, `postalCode` ja `city` kuvaavat asiakkaan pääosoitetta.
- `email` ja `phone` ovat asiakkaan ensisijaiset yhteystiedot.
- `hourlyRateOverrideCents` on asiakkaan oma tuntihintapoikkeus sentteinä, jos sellainen on asetettu.
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

## Isännöitsijätoimisto ja Taloyhtiöt

Isännöitsijätoimisto ja taloyhtiö ovat molemmat asiakkaita customer-moduulin näkökulmasta.

Ensimmäinen toteutusmalli:

- isännöitsijätoimiston `customerType` on `propertyManager`
- taloyhtiön `customerType` on `housingCompany`
- taloyhtiö voi viitata isännöitsijätoimistoon kentällä `managedByCustomerId`
- yksi isännöitsijätoimisto voi hallinnoida useita taloyhtiöitä
- sama suhde rajataan aina `companyId`-yritysrajauksen sisään

Backend tarkistaa, että `managedByCustomerId` viittaa saman yrityksen asiakkaaseen, jonka tyyppi on `propertyManager`.

Jos asiakas ei ole taloyhtiö, `managedByCustomerId` pidetään tyhjänä.

Tämä suhde kuuluu asiakasrekisterin master-dataan. Se ei vielä päätä:

- kuka on laskun maksaja
- mille kohteelle työ tehdään
- kenelle lasku lähetetään
- miten verkkolaskutus muodostetaan

Nämä päätetään myöhemmin laskutus-, kohde- ja työmääräysmoduulien yhteydessä.

Jos suhdemalli myöhemmin monimutkaistuu, esimerkiksi jos taloyhtiöllä voi olla historiassa useita isännöitsijöitä tai useita rooleja, voidaan tehdä erillinen relation-taulu omalla päätöksellä. Ensimmäisessä Customer MVP -vaiheessa yksinkertainen `managedByCustomerId` riittää.

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
- `customerNumber` voidaan antaa automaattisesti tai käsin.
- Oletusmalli on automaattinen numerointi.
- Käyttäjä voi valita manuaalisen numeron, jos numero on vapaa `companyId`-rajauksen sisällä.
- Frontend ei päätä lopullista automaattista numeroa.
- Backend muodostaa automaattisen asiakasnumeron ja tarkistaa manuaalisen numeron uniikkiuden.
- Isännöitsijätoimistoille voidaan sallia käsin määritetty numero.
- Asiakasnumerointia ei saa sekoittaa laskunumerointiin.

Mahdollinen tuleva create-request-malli:

```ts
customerNumberMode: 'auto' | 'manual'
customerNumber?: string
```

Jos tila on `auto`, backend muodostaa seuraavan vapaan asiakasnumeron.

Jos tila on `manual`, `customerNumber` on pakollinen ja backend tarkistaa sen.

Ensimmäinen automaattisen numeroinnin sääntö:

- backend hakee yrityksen nykyiset numeeriset asiakasnumerot
- seuraava automaattinen numero on suurin numeerinen asiakasnumero + 1
- jos numeerisia asiakasnumeroita ei vielä ole, ensimmäinen automaattinen numero on `1001`
- manuaaliset ei-numeeriset asiakasnumerot eivät vaikuta automaattiseen juoksevaan numerointiin

## Status

Asiakasta ei ensisijaisesti poisteta fyysisesti.

Ensimmäinen tilamalli voi olla:

- `active`
- `inactive`

Passivoitu asiakas säilyy historiassa ja viittauksissa, mutta sitä voidaan piilottaa oletuslistauksista myöhemmin.

## Asiakaskohtainen Tuntihinta

Nykyinen Customer MVP sisältää kentän:

```ts
hourlyRateOverrideCents: number | null
```

Tämä on asiakkaan oma tuntihintapoikkeus.

Säännöt:

- jos `hourlyRateOverrideCents` on `null`, käytetään oman yrityksen oletustuntihintaa
- oman yrityksen oletustuntihinta kuuluu Company Settings / Oma yritys -moduulille
- jos `hourlyRateOverrideCents` on annettu, se ohittaa oletustuntihinnan kyseiselle asiakkaalle
- `0` ei tarkoita "ei asetettu"
- `0` tarkoittaa nolla senttiä eli nolla euroa
- puuttuva arvo kuvataan siksi `null`-arvolla

Asiakaskohtainen tuntihinta on asiakkaan master-dataa, joten sen omistaa customers-moduuli.

Tämä kenttä ei vielä muodosta laskua eikä laskuriviä.

Myöhemmin työmääräys-, työkirjaus- tai laskutuslogiikka voi käyttää tätä arvoa hinnan valinnan lähtötietona.

Laskulle tai laskuriville tallennetaan lopulta käytetty tuntihinta snapshotiksi, jotta vanhat laskut eivät muutu, vaikka asiakaskohtainen tuntihinta tai oman yrityksen oletustuntihinta muuttuu myöhemmin.

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

Laskutus voi toimia suoraan asiakkaan perusteella ilman kohdetta tai työmääräystä. Laskutuksen ja valinnaisen työnohjauspolun rajat on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

Company Settings vastaa myöhemmin kysymykseen:

```text
mitkä ovat ohjelmaa käyttävän oman yrityksen tiedot ja oletusasetukset
```

Lasku voi ottaa asiakkaan tiedoista snapshotin, jotta vanhan laskun tiedot eivät muutu takautuvasti, jos asiakaskorttia päivitetään myöhemmin.

Lasku tai laskurivi ottaa myöhemmin snapshotin myös käytetystä tuntihinnasta.

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

Customer UI:n seuraava UX-korjaus tehdään dokumenttien
`docs/architecture/customer-ui-ux-plan.md` ja
`docs/architecture/customer-overview-plan.md` mukaisesti: asiakaslista on
pääsisältö ja uuden asiakkaan lomake avataan tarvittaessa erilliseen paneeliin
tai lomakealueeseen.

Nykyinen olemassa olevan asiakkaan paneelimuokkaus on välivaihe. Lopullisessa
mallissa asiakas avataan koko työalueen asiakaskorttiin, joka on oletuksena
lukutilassa. `Muokkaa` avaa samat perustiedot muokattaviksi, ja `Tallenna` sekä
`Peruuta` palauttavat näkymän lukutilaan.

Asiakaskortti voi myöhemmin näyttää muiden moduulien koosteita, mutta tämä ei
siirrä laskujen, kohteiden, työmääräysten, tuntien, materiaalien tai historian
omistajuutta customers-moduulille.

Ei lisätä uusia riippuvuuksia ilman erillistä päätöstä.

Ei lisätä Zodia, React Hook Formia, UI-kirjastoa, `packages/ui`-pakettia, sites-moduulia tai laskutusta tämän muutoksen yhteydessä.

## Avoimet Kysymykset

- Vaaditaanko Y-tunnus heti kaikilta organisaatiotyyppisiltä asiakkailta?
- Kuinka tarkka Y-tunnuksen validointi tehdään ensimmäisessä toteutuksessa?
- Näytetäänkö passivoidut asiakkaat oletuksena asiakaslistassa?
- Tarvitaanko asiakkaan poikkeava laskutusosoite jo ennen laskutusmoduulia?
