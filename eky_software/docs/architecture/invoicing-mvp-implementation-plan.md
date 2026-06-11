# Manuaalisen Laskutuksen MVP-Toteutussuunnitelma

Tämä dokumentti kuvaa Eky-laskutuksen ensimmäisen itsenäisen toteutuspolun.

Tavoitteena on toteuttaa manuaalinen laskuluonnos suoraan asiakkaalle ilman kohdetta, työmääräystä, tuntikirjausta, materiaalikirjausta, mobiilisovellusta tai synkronointia.

Tämä dokumentti sisältää ensimmäiset hyväksytyt laskutuksen liiketoimintapäätökset.

Kaikkia yksityiskohtia ei ole vielä lukittu. Erityisesti hyväksymisen käyttöoikeudet, hyväksytyn laskun korjaaminen ja offline/cloud-numeroinnin yhteensovitus ratkaistaan ennen niitä koskevan tuotantokoodin kirjoittamista.

## Lähtökohta

Invoicing on itsenäinen core-moduuli.

Ensimmäinen toimiva polku:

```text
asiakas
  -> käsin lisätyt laskurivit
    -> backendin laskenta ja validointi
      -> tallennettu laskuluonnos
        -> luonnoksen myöhempi muokkaus
```

Ensimmäinen laskutuspolku ei edellytä:

- Sites-moduulia
- Work Orders -moduulia
- Work Entries -moduulia
- Material Entries -moduulia
- tuoterekisteriä
- mobiilisovellusta
- pilviyhteyttä
- synkronointia

Myöhemmät moduulit voivat tarjota Invoicing-moduulille laskuehdotuksia tai valmiita riviaineistoja hallitun application- tai API-sopimuksen kautta. Ne eivät saa kirjoittaa suoraan laskutuksen tauluihin tai ohittaa laskutuksen domain-sääntöjä.

## MVP-Tavoite

Ensimmäisen toteutuksen käyttäjä voi:

1. aloittaa uuden laskuluonnoksen
2. valita asiakkaan
3. syöttää laskun perustiedot
4. lisätä laskurivejä käsin
5. nähdä backendin sääntöjen mukaiset summat
6. tallentaa laskun luonnoksena
7. avata tallennetun luonnoksen
8. muokata ja tallentaa luonnoksen uudelleen
9. hyväksyä laskun joko luonnoksen myöhemmässä käsittelyssä tai heti laskun syöttämisen jälkeen

Toteutus voidaan rakentaa teknisesti pienissä vaiheissa niin, että ensimmäinen koodipala päättyy muokattavaan laskuluonnokseen.

Laskutuksen MVP-kokonaisuuteen kuuluvat kuitenkin sekä luonnos että hallittu hyväksyntä. Varsinainen laskunumero, lopullinen snapshot-lukitus ja hyväksytyn laskun muokkausrajat toteutetaan hyväksyntävaiheessa.

## Classic-Laskutusnäkymä

Ensimmäinen web-käyttöliittymä on perinteinen, tiivis laskunkirjausnäkymä.

Tavoiteltu työjärjestys:

```text
yläosa
  -> laskun perustiedot ja asiakas

keskiosa
  -> muokattava laskurivitaulukko

alaosa
  -> veroton summa, ALV-erittely ja loppusumma
```

Vanhoista suomalaisista taloushallinto-ohjelmista voidaan ottaa inspiraatiota:

- tietotiheydestä
- työskentelyjärjestyksestä
- taulukkomaisesta laskurivien syötöstä
- perustietojen, rivien ja summien selkeästä erottelusta
- näppäimistöllä tehokkaasti käytettävästä työnkulusta

Eky ei kopioi toisen ohjelman:

- brändiä
- logoa
- värejä sellaisenaan
- kuvakkeita
- grafiikkaa
- tarkkaa sommittelua
- lähdekoodia

Eky-näkymä noudattaa `docs/design/ui-principles.md`-dokumentin sinivalkoista, modernia ja rauhallista työohjelmalinjaa.

Classic tarkoittaa tässä toimintalogiikkaa ja tiivistä työpintaa, ei vanhanaikaista visuaalista toteutusta.

Moderni tai vaihtoehtoinen laskutusnäkymä voidaan lisätä myöhemmin saman Invoicing-domainin ja application servicejen päälle.

## Laskun Perustiedot

Ensimmäisen laskuluonnoksen suunnittelutason kentät:

- `id`
- `companyId`
- `customerId`
- `invoiceDate`
- `dueDate`
- `paymentTermDays`
- `priceInputMode`
- `orderNumber`
- `subject`
- `note`
- `status`
- `createdAt`
- `updatedAt`

Kenttien alustava merkitys:

- `id` on tekninen tunniste.
- `companyId` rajaa laskun yritykseen.
- `customerId` viittaa Customers-moduulin asiakkaaseen.
- `invoiceDate` on laskulla näkyvä käyttäjän muokattava päiväys.
- `dueDate` on käyttäjän muokattava eräpäivä.
- `paymentTermDays` on laskun maksuehto päivinä. Uuden laskun oletus on 14 päivää netto.
- `priceInputMode` kertoo yksiselitteisesti, syötetäänkö hinnat verottomina vai verollisina.
- `orderNumber` on valinnainen asiakkaan tai työn tilausnumero.
- `subject` on valinnainen laskun aihe.
- `note` on valinnainen laskun saate tai lisätieto.
- `status` kertoo laskun käsittelyvaiheen.
- `createdAt` on tekninen luontiaika.
- `updatedAt` on tekninen viimeisin muokkausaika.

Myöhemmät aikakentät voivat sisältää:

- `approvedAt`
- `issuedAt`
- `sentAt`
- `paidAt`
- `cancelledAt`

Niitä ei lisätä ensimmäiseen luonnosvaiheeseen ilman niitä vastaavaa hyväksyttyä tilasiirtymää.

## Päiväysten Erottelu

Seuraavia käsitteitä ei saa sekoittaa:

```text
invoiceDate
  = laskulla näkyvä ja käyttäjän muokattava päiväys

createdAt
  = tietueen tekninen luontiaika

updatedAt
  = tietueen tekninen viimeisin muokkausaika

approvedAt / issuedAt
  = myöhemmän hyväksymisen tai lukituksen tapahtuma-aika
```

Backend validoi päiväykset ja niiden väliset hyväksytyt suhteet, kun tarkat säännöt on päätetty.

## Eräpäivä Ja Maksuehto

Uuden laskun oletusmaksuehto on 14 päivää netto.

Käyttöliittymä ehdottaa eräpäivää:

```text
invoiceDate + paymentTermDays -> ehdotettu dueDate
```

Käyttäjä voi muuttaa sekä maksuehtoa että eräpäivää käsin.

Maksuehtoja voidaan myöhemmin hallita laskutusasetuksissa.

Ennen toteutusta tarkennetaan vielä käyttöliittymän käyttäytyminen:

- päivittyykö `dueDate` automaattisesti, kun `invoiceDate` muuttuu
- päivittyykö `paymentTermDays`, jos käyttäjä muuttaa `dueDate`-arvoa käsin
- missä vaiheessa automaattinen päivitys lakkaa, jotta käyttäjän syöttämää eräpäivää ei ylikirjoiteta

Backend säilyttää laskulle valitun maksuehdon ja eräpäivän eikä päättele lopputulosta pelkästään käyttöliittymän oletuksesta.

## Hintojen Syöttötapa

Asiakastyyppi vaikuttaa uuden laskun oletussyöttötapaan:

- yritysasiakkaalle oletus on veroton yksikköhinta
- yksityisasiakkaalle oletus on verollinen yksikköhinta

Organisaatiotyypit, kuten yritys, taloyhtiö ja isännöitsijätoimisto, käsitellään oletuksena yritysasiakkaina.

Jos asiakastyyppi ei yksiselitteisesti kerro, kumpaa oletusta käytetään, käyttäjältä pyydetään valinta tai käytetään erikseen dokumentoitua asetusta.

UI-oletus on vain käyttökokemuksen apu. Backend-laskenta ei saa päätellä hintojen merkitystä pelkästään asiakkaan tyypistä.

Laskulla tai laskurivillä pitää olla yksiselitteisesti tiedossa syöttötapa, esimerkiksi:

```ts
priceInputMode: 'net' | 'gross'
```

Ensimmäisessä classic-laskutusnäkymässä käyttäjä muokkaa vain aktiivisen `priceInputMode`-arvon mukaista yksikköhintaa:

- yritysasiakkaalle oletus on `net`, jolloin muokataan verotonta hintaa
- yksityisasiakkaalle oletus on `gross`, jolloin muokataan verollista hintaa

Toinen hinta voidaan näyttää laskettuna esikatseluna, mutta verotonta ja verollista hintaa ei tehdä yhtä aikaa vapaasti muokattaviksi MVP:ssä.

Domain-laskenta käyttää aina eksplisiittistä `priceInputMode`-arvoa. Asiakastyyppi määrää vain käyttöliittymän oletuksen, ei laskennan tulkintaa.

Tarkka päätös siitä, onko syöttötapa laskukohtainen vai voiko se vaihdella riveittäin, tehdään ennen tietomallin toteutusta. Arkkitehtuuri ei saa pakottaa laskemaan verollista hintaa verottomana tai päinvastoin.

## Laskurivit

Ensimmäisen laskurivin suunnittelutason kentät:

- `id`
- `invoiceId`
- `position`
- `code`
- `description`
- `quantityHundredths`
- `unit`
- `unitPriceCents`
- `vatRateBasisPoints`
- `discountType`
- `discountValue`
- `lineTotalCents`

Kenttien alustava merkitys:

- `position` määrittää rivin näkyvän järjestyksen.
- `code` on valinnainen vapaa rivikoodi.
- `description` on laskulla näkyvä nimike tai kuvaus.
- `quantityHundredths` on laskutettava määrä sadasosina ja sallii enintään kaksi desimaalia.
- `unit` on esimerkiksi tunti, kappale tai muu myöhemmin hyväksytty yksikkö.
- `unitPriceCents` on yksikköhinta sentteinä.
- `vatRateBasisPoints` kuvaa rivin ALV-kannan basis points -mallilla.
- `discountType` kertoo, onko alennus prosentti- vai euromääräinen.
- `discountValue` sisältää euromääräisen alennuksen sentteinä tai prosenttialennuksen basis points -arvona.
- `lineTotalCents` on hyväksyttyjen laskentasääntöjen mukainen rivin summa sentteinä.

`code` ei ensimmäisessä MVP:ssä viittaa:

- tuoterekisteriin
- materiaalirekisteriin
- työmääräykseen
- tuntikirjaukseen
- kirjanpitotiliin

Rivikoodi on vapaaehtoinen käyttäjän syöttämä tieto, kunnes sille päätetään erillinen omistava moduuli tai rekisteri.

## Alennukset

Laskutuksen pitää tukea:

- prosenttialennusta, esimerkiksi 5 %
- euromääräistä alennusta, esimerkiksi 100 €

Alustava suositus on aloittaa rivikohtaisesta alennuksesta.

Rivikohtainen alennus:

- tekee alennuksen kohteen näkyväksi
- mahdollistaa ALV:n laskemisen oikean rivin ja verokannan yhteydessä
- säilyttää auditoinnin ja snapshotin ymmärrettävänä

Ensimmäisen mallin pitää kuitenkin jättää tilaa myöhemmälle laskukohtaiselle alennukselle.

Laskukohtaista alennusta ei mallinneta piilotettuna summan vähennyksenä. Se toteutetaan myöhemmin omana selkeästi nimettynä laskutason adjustment- tai discount-rakenteena, jotta sen ALV-vaikutus ja kohdistuminen voidaan laskea yksiselitteisesti.

Alennuskoodia ei toteuteta tässä dokumentaatiomuutoksessa.

Prosenttialennus esitetään basis points -mallilla:

```text
5,00 % -> 500
```

Euromääräinen alennus esitetään kokonaislukusentteinä.

Alennus saa pienentää rivin loppusumman tasan nollaan.

Alennus ei saa ylittää rivin lähtösummaa eikä tehdä rivin loppusummasta negatiivista.

## Laskennan Omistajuus

Frontend saa näyttää käyttäjälle nopean laskentaesikatselun.

Frontend ei ole laskennan lopullinen totuus.

Backendin domain/application-logiikka:

- validoi laskurivit
- laskee hyväksytyt rivisummat
- laskee ALV:n
- laskee laskun summat
- palauttaa tallennetun ja auktoritatiivisen tuloksen

Repository ei päätä laskentasäännöistä.

SQLite-adapteri tallentaa valmiiksi lasketut ja validoidut arvot, mutta ei määritä niiden liiketoimintamerkitystä.

## Raha, Määrät Ja Tarkkuus

Rahasummat tallennetaan kokonaislukuna sentteinä nykyisen Eky-linjan mukaisesti:

- `unitPriceCents`
- `lineTotalCents`
- laskun yhteissummat sentteinä

JavaScriptin liukulukulaskentaa ei käytetä rahasummien auktoritatiiviseen laskentaan.

Määrä esitetään skaalattuna kokonaislukuna ja sallii enintään kaksi desimaalia.

Domainin kenttä on `quantityHundredths`, esimerkiksi:

```text
1,00 -> 100
1,25 -> 125
```

ALV-kanta esitetään basis points -mallilla kentässä `vatRateBasisPoints`:

```text
25,50 % -> 2550
14,00 % -> 1400
0,00 % -> 0
```

Prosenttialennus esitetään samalla basis points -mallilla:

```text
5,00 % -> 500
```

Auktoritatiivinen laskenta ei saa käyttää epätarkkaa liukulukua määrän, prosenttien ja rahan yhdistämiseen.

Jos tarkkaan laskentaan tarvitaan myöhemmin ulkoinen decimal-kirjasto, se arvioidaan erikseen `docs/architecture/dependency-policy.md`-dokumentin mukaisesti. Kirjastoa ei lisätä tässä suunnitteluvaiheessa.

## ALV, Summat Ja Pyöristykset

ALV-laskenta on liiketoimintakriittinen osa eikä sen sääntöjä saa arvata.

Hyväksytyt periaatteet:

- käyttäjän pitää voida valita kaikki yrityksen tarvitsemat ALV-kannat
- ALV-kantoja ei kovakoodata arkkitehtuurissa pysyvästi yhdeksi arvoksi
- ALV-kantoja pitää voida myöhemmin hallita laskutusasetuksista
- ensimmäisen domain-koodivaiheen testattavat ALV-kannat ovat 0,00 %, 14,00 % ja 25,50 %
- tietomalli ja domain eivät saa rajoittua vain ensimmäisen koodivaiheen ALV-kantoihin
- syöttötapa on laskennassa yksiselitteisesti veroton tai verollinen
- senttitason laskenta tehdään tarkasti
- MVP:ssä ei tehdä erillistä laskun loppusumman pyöristysriviä tai käteismaksun pyöristyserää
- maksujen lähtökohtana ovat pankkiyhteydet

Ensimmäisen domain-koodivaiheen testattavat ALV-kannat basis points -arvoina:

```text
0,00 %  -> 0
14,00 % -> 1400
25,50 % -> 2550
```

Nämä ovat ensimmäisen vaiheen testiarvot, eivät domainiin kovakoodattu sallittujen arvojen lista. ALV-kantoja pitää voida myöhemmin hallita laskutusasetuksista ilman laskentadomainin rakennemuutosta.

Kaikki laskennan jakolaskut käyttävät yhtä Invoicing-domainin sisäistä pyöristysfunktiota.

Pyöristyssääntö:

- pyöristetään lähimpään kokonaislukusenttiin
- täsmälleen puolikas sentti pyöristetään ylöspäin
- pyöristysfunktio toimii kokonaislukujen osoittajalla ja nimittäjällä
- auktoritatiivinen laskenta ei muuta arvoja JavaScriptin liukuluvuiksi

Ei-negatiivisilla kokonaisluvuilla pyöristyksen periaate voidaan kuvata näin:

```text
roundHalfUp(numerator / denominator)
  = floor((numerator + floor(denominator / 2)) / denominator)
```

Domain-toteutus nimeää tämän pyöristyksen selkeästi eikä hajauta omia pyöristyskaavoja eri laskentafunktioihin.

### Rivin Lähtösumma

Rivin lähtösumma lasketaan:

```text
roundHalfUp(unitPriceCents * quantityHundredths / 100)
```

Tulos on pyöristetty kokonaislukusenttimäärä.

### Rivikohtainen Alennus

Prosenttialennus lasketaan pyöristetystä rivin lähtösummasta:

```text
roundHalfUp(lineBaseCents * discountBasisPoints / 10000)
```

Euromääräinen alennus annetaan suoraan kokonaislukusentteinä.

Alennus pyöristetään tai vahvistetaan sentteihin ennen sen vähentämistä rivin lähtösummasta.

### Net-Laskenta

Kun `priceInputMode` on `net`:

1. `unitPriceCents` tarkoittaa verotonta yksikköhintaa.
2. Rivin lähtösumma lasketaan ja pyöristetään verottomana summana.
3. Rivikohtainen alennus lasketaan lähtösummasta ja käsitellään verottomana alennuksena.
4. Alennus vähennetään verottomasta lähtösummasta.
5. ALV lasketaan alennetusta verottomasta summasta:

```text
vatCents
  = roundHalfUp(netCents * vatRateBasisPoints / 10000)
```

6. Rivin verollinen loppusumma muodostetaan:

```text
grossCents = netCents + vatCents
```

### Gross-Laskenta

Kun `priceInputMode` on `gross`:

1. `unitPriceCents` tarkoittaa verollista yksikköhintaa.
2. Rivin lähtösumma lasketaan ja pyöristetään verollisena summana.
3. Rivikohtainen alennus lasketaan lähtösummasta ja käsitellään verollisena alennuksena.
4. Alennus vähennetään verollisesta lähtösummasta.
5. Alennetusta verollisesta summasta erotetaan veroton osuus:

```text
netCents
  = roundHalfUp(
      grossCents * 10000
      / (10000 + vatRateBasisPoints)
    )
```

6. ALV-osuus muodostetaan samasta pyöristetystä rivistä:

```text
vatCents = grossCents - netCents
```

Gross-laskennassa ALV-osuutta ei lasketa uudelleen erillisellä kaavalla, koska `grossCents` on käyttäjän syöttämään verolliseen hintaan perustuva auktoritatiivinen rivisumma.

### Laskun Summat

Laskun summat muodostetaan laskemalla valmiiksi pyöristettyjen laskurivien arvot yhteen:

- veroton yhteensä = rivien `netCents`-arvojen summa
- ALV yhteensä = rivien `vatCents`-arvojen summa
- verollinen yhteensä = rivien `grossCents`-arvojen summa

ALV-erittely muodostetaan samoista riveistä ryhmittelemällä niiden pyöristetyt verottomat summat ja ALV-summat `vatRateBasisPoints`-arvon mukaan.

Laskutasolla ei lasketa samoja summia uudelleen eri kaavalla. Näin rivien, ALV-erittelyn ja laskun loppusummien pitää aina täsmätä.

### Negatiiviset Ja Nollahintaiset Rivit

MVP:ssä ei sallita tavallisia laskurivejä, joilla on:

- negatiivinen määrä
- negatiivinen yksikköhinta
- negatiivinen loppusumma

Alennukset toteutetaan rivin omilla prosentti- tai euromääräisillä alennuskentillä. Alennus saa pienentää rivin loppusumman nollaan, mutta ei negatiiviseksi.

Hyvityslaskut, laskukohtaiset alennukset ja muut adjustment-rakenteet toteutetaan myöhemmin erillisinä, hallittuina toimintoina. Niitä ei mallinneta negatiivisina tavallisina laskuriveinä.

Nollahintaiset laskurivit sallitaan MVP:ssä. Niitä voidaan käyttää esimerkiksi:

- seliteriveinä
- huomautuksina
- lisätietoina
- työn kuvauksena ilman veloitusta

Nollarivi käsitellään normaalin domain-validoinnin ja laskennan kautta. Se ei saa ohittaa validointia eikä rikkoa ALV-erittelyä tai laskun summien täsmäytystä.

Laskentadomain voidaan toteuttaa näiden determinististen laskenta- ja pyöristyssääntöjen perusteella. Toteutuksen rajaus ei saa vaatia vielä avoimiksi jätettyjen laskun tilojen, numeroinnin tai toimituksen sääntöjä.

## Tilat

Mahdollinen pitkän aikavälin tilajoukko:

- `draft`
- `approved` tai `issued`
- `sent`
- `paid`
- `cancelled`

Laskutuksen MVP tarvitsee vähintään:

- `draft`
- `approved` tai myöhemmin nimettävä vastaava hyväksytty/lukittu tila

Käyttäjä voi:

- tallentaa laskun luonnoksena ja jatkaa myöhemmin
- hyväksyä valmiin laskun heti syöttämisen jälkeen

Hyväksyntä on backendin hallittu tilasiirtymä. Käyttöliittymän "hyväksy heti" -toiminto ei saa ohittaa validointia, laskentaa, numerointia, snapshotin muodostusta, käyttöoikeuksia tai auditointia.

Hyväksyntä voi myöhemmin avata laskun toimitustavan valinnan. PDF-, sähköposti- ja verkkolaskutoimituksia ei toteuteta tässä vaiheessa.

Ennen hyväksynnän toteutusta päätetään:

- käytetäänkö erikseen tiloja `approved` ja `issued`
- kuka saa tehdä tilasiirtymän
- saako hyväksyttyä laskua muuttaa
- miten virheellinen hyväksytty lasku korjataan
- mitä `cancelled` tarkoittaa
- miten hyvityslasku liittyy tilamalliin
- milloin lasku katsotaan lähetetyksi
- miten maksetuksi merkitseminen tapahtuu

Tilasiirtymät toteutetaan domain-sääntöinä, ei vapaana status-merkkijonon muokkauksena.

## Laskunumerointi

Tekninen `id` ja käyttäjälle näkyvä laskunumero ovat eri asioita.

Laskunumerointi on yrityskohtainen, asetuksista säädettävä liiketoimintakriittinen toiminto.

Esimerkkimuoto voi olla:

```text
2026001
```

Yrityksen pitää voida määrittää:

- numerointisarjan muoto tai periaate
- seuraava käytettävä laskunumero
- miten sarjaa jatketaan tai vaihdetaan tilikauden vaihtuessa

Laskutusnäkymässä pitää olla mahdollisuus ehdotetun laskunumeron hallittuun muokkaamiseen.

Numeroa ei hyväksytä suoraan luotettuna frontend-arvona. Backend:

- tarkistaa yritysrajauksen
- tarkistaa numeron muodon
- tarkistaa uniikkiuden
- noudattaa numerointisarjan sääntöjä
- kirjaa hallitun muutoksen myöhemmin audit trailiin

Laskunumeron muokkaus sallitaan ennen hyväksyntää tai hyväksymisen yhteydessä. Hyväksytyn laskun numeron muuttaminen vaatii myöhemmin erillisen korjaussäännön eikä kuulu tavalliseen muokkaukseen.

Ennen numeroinnin kooditoteutusta tarkennetaan:

- missä tilasiirtymässä numero annetaan
- saako numeroissa olla aukkoja
- miten offline- ja cloud-käytön numerointi sovitetaan yhteen
- miten epäonnistunut hyväksyminen vaikuttaa varattuun numeroon

Frontend ei koskaan päätä lopullista laskunumeroa.

## Tilikausi

Tilikausi on yrityskohtainen ja manuaalisesti säädettävä laskutusasetus.

Tilikausi ei aina ala tammikuussa.

Yrityksen pitää voida määrittää ainakin:

- tilikauden alkupäivä tai alkukuukausi
- tilikauden loppu laskettavalla tai erikseen tallennettavalla tavalla
- miten laskunumerosarja liittyy tilikauteen
- jatkuuko nykyinen numerosarja vai vaihtuuko sarja tilikauden vaihtuessa

Tilikauden ja numerointisarjan vaihtaminen tehdään hallitusti. Asetuksen muuttaminen ei saa muuttaa vanhojen laskujen numeroita, päiväyksiä tai snapshot-tietoja.

Tilikauden tarkka tietomalli ja validointi suunnitellaan laskutusasetusten toteutusvaiheessa.

## Asetukset-Kokonaisuus

Nykyinen Oma yritys / Company Settings on asetusten ensimmäinen toteutettu osa.

Laskutuksen kasvaessa käyttöliittymään tarvitaan laajempi Asetukset-kokonaisuus, joka voi sisältää:

- Oma yritys
- Laskutusasetukset
- ALV-kannat
- Maksuehdot
- Numerointisarjat
- Tilikausi
- laskun toimitustavat myöhemmin

Asetukset on käyttöliittymän kokoava näkymä, ei lupa sekoittaa moduulien omistajuutta.

Omistajuus säilyy:

- Company Settings omistaa oman yrityksen master-tiedot ja oletustuntihinnan
- Invoicing omistaa ALV-kannat, maksuehdot, numerointisarjat, tilikauden ja muut laskutuksen liiketoiminta-asetukset
- toimitusadapterit omistavat myöhemmin tekniset sähköposti-, PDF- tai verkkolaskuyhteydet sovittujen rajojen mukaisesti

Koko Settings-moduulia tai asetustietokantaa ei suunnitella tässä vaiheessa.

## Snapshot-Periaate

Snapshot-periaatteen lähdedokumentti on `docs/architecture/invoicing-workflow-boundaries.md`.

Kun lasku myöhemmin hyväksytään tai lukitaan, Invoicing tallentaa laskutushetken tiedot omaksi muuttumattomaksi snapshotikseen.

Snapshot voi sisältää:

- oman yrityksen nimen ja Y-tunnuksen
- oman yrityksen osoite- ja yhteystiedot
- asiakkaan nimen ja asiakasnumeron
- asiakkaan Y-tunnuksen
- asiakkaan laskutusosoitteen
- laskurivien kuvaukset
- määrät ja yksiköt
- yksikköhinnat
- käytetyt tuntihinnat
- hinnan syöttötavan
- käytetyt alennukset
- ALV-kannat ja ALV-summat
- verottomat summat ja loppusumman

Snapshotin jälkeen vanha lasku ei muutu, vaikka Customers- tai Company Settings -data muuttuu.

Ennen toteutusta päätetään:

- mitä tietoja luonnos säilyttää snapshot-muodossa
- missä täsmällisessä tilasiirtymässä lopullinen snapshot lukitaan
- saako käyttäjä muokata snapshot-ehdotusta ennen hyväksymistä

Invoicing omistaa snapshot-arvot. Se ei siirrä Customers- tai Company Settings -master-datan omistajuutta itselleen.

## Moduulien Välinen Tiedonhaku

Manuaalinen laskuluonnos tarvitsee vähintään asiakkaan tunnisteen.

Invoicing ei saa:

- importata Customers-moduulin repository-adapteria
- kirjoittaa Customers-moduulin tauluun
- importata Company Settings -moduulin infrastructure-toteutusta
- lukea muiden moduulien tauluja satunnaisilla cross-module SQL-kyselyillä

Tarvittava asiakas- ja yritystieto haetaan myöhemmin määritettävien application-tason read-porttien tai hallittujen palvelusopimusten kautta.

Ensimmäisen toteutusvaiheen rajapinnat suunnitellaan niin, että Sites-, Work Orders-, Work Entries- ja Material Entries -lähteet voidaan lisätä myöhemmin erillisinä laskuehdotuksen tuottajina ilman manuaalisen laskutuksen purkamista.

## Alustava Backend-Rakenne

Mahdollinen rakenne:

```text
apps/backend/src/modules/invoicing/
  domain/
  application/
  ports/
  infrastructure/
  http/
```

Ensimmäisen luonnosvaiheen mahdollisia käyttötapauksia:

- `createInvoiceDraft`
- `getInvoiceDraft`
- `listInvoiceDrafts`
- `updateInvoiceDraft`

Tarkat nimet ja request/response-sopimukset vahvistetaan toteutustehtävässä.

Ensimmäisessä vaiheessa ei tehdä yleistä laskutusframeworkia eikä jaettua `utils`-pakettia.

## Alustava API-Client-Rakenne

Laskutuksen HTTP-kutsut kuuluvat `packages/api-client`-pakettiin.

Mahdollinen tiedosto:

```text
packages/api-client/src/invoices.ts
```

Web-komponentit eivät tee raakaa `fetch`-kutsua eivätkä tunne backendin sisäisiä moduuleja.

Tarkat endpointit ja DTO:t päätetään backendin toteutussuunnittelussa.

## Alustava Web-Rakenne

Laskutus on oma web-feature:

```text
apps/web/src/features/invoicing/
  InvoiceDraftPage.tsx
  InvoiceHeaderForm.tsx
  InvoiceLineTable.tsx
  InvoiceTotals.tsx
```

Tiedostonimet ovat alustavia.

Feature noudattaa `docs/architecture/web-frontend-structure.md`-dokumenttia:

- feature-kohtainen tila ja komponentit pysyvät `features/invoicing`-kansiossa
- yleistä `utils`-, `helpers`- tai `common`-kaatopaikkaa ei luoda
- aidosti usean featuren käyttämä pieni apu voidaan arvioida myöhemmin erikseen
- käyttäjälle näkyvät tekstit lisätään nykyiseen i18n-rakenteeseen suomeksi

Laskennan liiketoimintasäännöt eivät kuulu React-komponentteihin.

## Classic-UI:n Ensimmäinen Työpinta

Ensimmäisen näkymän suunnittelutason osat:

### Työkalurivi

- uusi laskuluonnos
- tallenna
- myöhemmin avaa tai selaa luonnoksia
- myöhemmässä vaiheessa hyväksy

Painikkeet esitetään selkeinä komentoina tai tuttuina kuvakkeina tooltip-teksteineen `docs/design/ui-principles.md`-dokumentin mukaisesti.

### Perustiedot

- laskun päiväys
- asiakas
- tilausnumero
- aihe
- hintojen syöttötapa
- maksuehto
- eräpäivä
- saate tai lisätieto

Asiakkaan valinta näyttää käyttäjälle riittävät tunnistetiedot, mutta käyttöliittymä ei omista asiakasdataa.

### Laskurivitaulukko

Alustavat sarakkeet:

- järjestys
- koodi
- nimike
- määrä
- yksikkö
- yksikköhinta
- alennus
- ALV
- rivin summa

Taulukon pitää olla:

- selkeä
- näppäimistöllä käytettävä
- vakaamittainen
- ilman sarakkeiden päällekkäisyyttä
- desktop-työskentelyyn riittävän tietotiheä

### Summat

Näkymän alaosassa näytetään myöhemmin hyväksyttyjen laskentasääntöjen mukaisesti:

- veroton summa
- ALV-erittely verokannoittain
- ALV yhteensä
- loppusumma

Summat ovat vain esitys backendin laskemista auktoritatiivisista arvoista.

## Testausperiaate

Laskutus, rahasummat, ALV ja tilasiirtymät testataan aina `docs/ai/testing-rules.md`-dokumentin mukaisesti.

Tuleva toteutus tarvitsee vähintään:

### Domain-testit

- laskurivin validointi
- määrä- ja hintarajaukset
- rivisumman laskenta
- ALV-laskenta
- verottoman ja verollisen syöttötavan laskenta
- kahden desimaalin määrät
- prosentti- ja euromääräiset alennukset
- ALV-kannat 0, 1400 ja 2550 basis points -arvoilla
- negatiivisten määrien, hintojen ja loppusummien hylkäys
- nollahintaisten rivien hyväksytty käsittely
- laskun kokonaissummat
- pyöristystapaukset
- tilasiirtymät, kun ne toteutetaan

### Application-testit

- luonnoksen luonti repository-portin kautta
- luonnoksen päivitys
- yritysrajaus
- puuttuvan tai väärän asiakkaan käsittely
- backendin laskeman tuloksen tallentuminen

### Repository- ja migraatiotestit

- luonnos ja rivit tallentuvat atomisesti
- rivien järjestys säilyy
- yritysrajaus toimii
- päivitys ei sekoita toisen laskun rivejä

### HTTP-testit

- kelvollinen luonnos hyväksytään
- virheellinen syöte hylätään
- toisen yrityksen dataa ei voi käyttää
- response ei paljasta infrastructure-tyyppejä

### API-client-testit

- request-rakenne
- response-parseri
- virhevastausten käsittely

### Web-testit

- puhtaat lomake- ja rivimuunnokset
- summien esitys
- käyttäjän kriittinen tallennuspolku, kun käytössä on tarkoitukseen sopiva testitapa

Testit eivät käytä oikeita asiakas- tai laskutietoja.

## Toteutusvaiheet

### Vaihe 1: Liiketoimintapäätökset

Tarkennetaan ja dokumentoidaan:

- eräpäivän automaattisen ehdotuksen käyttäytyminen
- ensimmäisen luonnosvaiheen validointisäännöt

### Vaihe 2: Domain Ja Laskentasäännöt

Toteutetaan puhtaat domain-tyypit, validointi ja laskenta kattavine yksikkötesteineen.

Tässä vaiheessa ei vielä tarvita HTTP:tä, Reactia tai SQLitea.

### Vaihe 3: SQLite, Repository Port Ja Adapteri

Suunnitellaan ja toteutetaan rajatut laskuluonnos- ja laskurivitaulut, migraatio, repository-portti ja parametrisoitua SQL:ää käyttävä SQLite-adapteri.

Tallennus tehdään transaktiona.

### Vaihe 4: Application Services, HTTP Ja API-Client

Toteutetaan luonnoksen luonti, haku, listaus ja muokkaus backendin kautta sekä niitä vastaava API-client.

### Vaihe 5: Web Classic Invoice Draft UI

Toteutetaan tiivis classic-laskunkirjausnäkymä `apps/web/src/features/invoicing`-featureen.

UI käyttää vain API-clientiä backend-yhteyteen.

### Vaihe 6: Hyväksyntä, Numerointi, Tilikausi Ja Snapshotit

Tehdään vasta erikseen hyväksyttyjen sääntöjen jälkeen:

- hyväksyntä tai laskun lukitus
- lopullinen laskunumero
- numerointisarjan ja tilikauden asetukset
- snapshotit
- hyväksymisen käyttöoikeudet
- audit trail
- hyväksytyn laskun muokkausrajoitukset

## Rajataan Myöhemmäksi

Ensimmäiseen manuaaliseen laskuluonnos-MVP:hen eivät kuulu:

- PDF
- tulostuspohjan viimeistely
- sähköpostilähetys
- verkkolasku
- pankkiyhteys
- maksusuoritusten automaattinen kohdistus
- tuoterekisteri
- materiaalirekisteri
- kirjanpitotilit
- kirjanpitointegraatio
- hyvityslaskut
- Sites-moduulin toteutus
- työmääräykseltä tuonti
- tunti- tai materiaalikirjaukselta tuonti
- mobiilityönkulku
- pilvisynkronointi
- automaattiset laskut

Näitä varten tehdään myöhemmin omat rajatut päätökset ja toteutussuunnitelmat.

## Ennen Koodausta Ratkaistavat Päätökset

Seuraavia asioita ei saa päätellä tästä dokumentista valmiiksi hyväksytyiksi:

1. Onko `priceInputMode` laskukohtainen vai voiko se vaihdella riveittäin?
2. Miten eräpäivän automaattinen ehdotus reagoi käyttäjän käsin tekemiin muutoksiin?
3. Mitkä kentät ovat luonnoksella pakollisia?
4. Mitkä ovat ensimmäiset sallitut laskuyksiköt?
5. Ovatko `approved` ja `issued` eri tiloja?
6. Kuka saa hyväksyä tai lukita laskun?
7. Saako hyväksyttyä laskua muuttaa ja millä korjausprosessilla?
8. Milloin lopullinen snapshot muodostetaan?
9. Saako laskunumeroissa olla aukkoja?
10. Miten numerointi ratkaistaan offline- ja cloud-tilojen välillä?
11. Mikä on tilikauden tarkka tietomalli?

Jos toteutustehtävä osuu johonkin näistä eikä päätöstä ole dokumentoitu, työ pysäytetään kyseisen säännön osalta ja projektin omistajalta pyydetään päätös.

## Hyväksymiskriteerit Tulevalle Luonnos-MVP:lle

Ensimmäinen laskuluonnos-MVP voidaan hyväksyä, kun:

- laskuluonnos voidaan luoda suoraan asiakkaalle
- kohdetta tai työmääräystä ei vaadita
- laskurivejä voidaan lisätä käsin
- määrät tukevat kahta desimaalia
- hintojen veroton/verollinen syöttötapa on laskennassa yksiselitteinen
- rivikohtainen alennusmalli tukee suunnitelman mukaisesti prosentti- ja euromääräistä alennusta
- backend validoi ja laskee summat
- luonnos voidaan tallentaa ja avata uudelleen
- luonnosta voidaan muokata
- lasku voidaan hyväksyä hallitulla backendin tilasiirtymällä
- oletusmaksuehto on 14 päivää netto ja käyttäjä voi muuttaa maksuehtoa sekä eräpäivää
- yritysrajaus toimii
- moduulirajat säilyvät
- laskenta-, application-, repository-, HTTP- ja API-client-testit kattavat kriittisen polun
- web käyttää API-clientiä
- uusia riippuvuuksia ei lisätä ilman erillistä päätöstä
- PDF, lähetys, numerointi ja hyväksyntä eivät ole vahingossa sekoittuneet ensimmäiseen luonnosvaiheeseen

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/ai/testing-rules.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/invoicing-workflow-boundaries.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/web-frontend-structure.md`
- `docs/design/ui-principles.md`
- `docs/modules/company-settings.md`
- `docs/modules/customers.md`
- `docs/modules/invoicing.md`
- `docs/product/glossary.md`
- `docs/product/workflows.md`
