# Manuaalisen Laskutuksen MVP-Toteutussuunnitelma

Tämä dokumentti kuvaa Eky-laskutuksen ensimmäisen itsenäisen toteutuspolun.

Tavoitteena on toteuttaa manuaalinen laskuluonnos suoraan asiakkaalle ilman kohdetta, työmääräystä, tuntikirjausta, materiaalikirjausta, mobiilisovellusta tai synkronointia.

Tämä dokumentti ei vielä lukitse laskutuksen liiketoimintakriittisiä sääntöjä. ALV, pyöristykset, maksuehto, laskun tilasiirtymät ja laskunumerointi ratkaistaan projektin omistajan päätöksillä ennen niitä koskevan tuotantokoodin kirjoittamista.

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

Ensimmäinen rajattu koodivaihe päättyy muokattavaan laskuluonnokseen.

Laskun hyväksyminen, varsinainen laskunumero, lopullinen snapshot-lukitus ja myöhemmät tilasiirtymät toteutetaan erillisenä vaiheena hyväksyttyjen liiketoimintasääntöjen jälkeen.

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
- `paymentTermDays` tai myöhemmin päätettävä maksuehtomalli
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
- `paymentTermDays` voi toimia eräpäivän ehdotuksen lähtötietona, jos tämä malli hyväksytään.
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

Käyttöliittymä voi myöhemmin ehdottaa eräpäivää:

```text
invoiceDate + paymentTermDays -> ehdotettu dueDate
```

Käyttäjän pitää voida muuttaa eräpäivää.

Ennen toteutusta päätettävät asiat:

- tallennetaanko maksuehto päivien määränä, tunnisteena vai omana rakenteenaan
- mikä maksuehto ehdotetaan uudelle laskulle
- tuleeko oletus Company Settings -moduulista
- päivittyykö `dueDate` automaattisesti, kun `invoiceDate` muuttuu
- päivittyykö `paymentTermDays`, jos käyttäjä muuttaa `dueDate`-arvoa käsin
- missä vaiheessa automaattinen päivitys lakkaa, jotta käyttäjän syöttämää eräpäivää ei ylikirjoiteta

Näitä sääntöjä ei toteuteta oletuksina ilman projektin omistajan päätöstä.

## Laskurivit

Ensimmäisen laskurivin suunnittelutason kentät:

- `id`
- `invoiceId`
- `position`
- `code`
- `description`
- `quantity`
- `unit`
- `unitPriceCents`
- `vatRate`
- `lineTotalCents`

Kenttien alustava merkitys:

- `position` määrittää rivin näkyvän järjestyksen.
- `code` on valinnainen vapaa rivikoodi.
- `description` on laskulla näkyvä nimike tai kuvaus.
- `quantity` on laskutettava määrä.
- `unit` on esimerkiksi tunti, kappale tai muu myöhemmin hyväksytty yksikkö.
- `unitPriceCents` on yksikköhinta sentteinä.
- `vatRate` kuvaa rivin ALV-kannan myöhemmin päätettävällä tarkalla esitystavalla.
- `lineTotalCents` on hyväksyttyjen laskentasääntöjen mukainen rivin summa sentteinä.

`code` ei ensimmäisessä MVP:ssä viittaa:

- tuoterekisteriin
- materiaalirekisteriin
- työmääräykseen
- tuntikirjaukseen
- kirjanpitotiliin

Rivikoodi on vapaaehtoinen käyttäjän syöttämä tieto, kunnes sille päätetään erillinen omistava moduuli tai rekisteri.

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

Rahasummat tallennetaan lähtökohtaisesti kokonaislukuna sentteinä nykyisen Eky-linjan mukaisesti:

- `unitPriceCents`
- `lineTotalCents`
- laskun yhteissummat sentteinä

JavaScriptin liukulukulaskentaa ei käytetä rahasummien auktoritatiiviseen laskentaan.

Ennen laskentakoodia päätetään:

- miten desimaalinen `quantity` esitetään domainissa ja tietokannassa
- kuinka monta desimaalia määrä sallii
- miten `vatRate` esitetään tarkasti
- missä järjestyksessä kertolasku, verolaskenta ja pyöristys tehdään

Jos tarkkaan laskentaan tarvitaan myöhemmin ulkoinen decimal-kirjasto, se arvioidaan erikseen `docs/architecture/dependency-policy.md`-dokumentin mukaisesti. Kirjastoa ei lisätä tässä suunnitteluvaiheessa.

## ALV, Summat Ja Pyöristykset

ALV-laskenta on liiketoimintakriittinen osa eikä sen sääntöjä saa arvata.

Ennen domain-laskennan toteuttamista projektin omistajan kanssa päätetään:

- mitkä ALV-kannat ensimmäinen MVP sallii
- syöttääkö käyttäjä verottoman vai verollisen yksikköhinnan
- näytetäänkö käyttöliittymässä molemmat hinnat
- lasketaanko ALV jokaiselle riville vai verokannoittain laskun yhteissummasta
- missä vaiheessa pyöristys tehdään
- mikä pyöristyssääntö on käytössä
- miten mahdollinen pyöristysero käsitellään
- sallitaanko negatiiviset laskurivit
- sallitaanko nollahintaiset laskurivit
- miten alennukset mallinnetaan, jos niitä tarvitaan

Ensimmäistä laskutusdomainia ei toteuteta ennen näiden päätösten kirjaamista.

## Tilat

Mahdollinen pitkän aikavälin tilajoukko:

- `draft`
- `approved` tai `issued`
- `sent`
- `paid`
- `cancelled`

Ensimmäinen koodivaihe tarvitsee vain `draft`-tilan, ellei erillisessä toteutustehtävässä päätetä muuta.

Ennen muiden tilojen toteutusta päätetään:

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

Laskuluonnos voi ensimmäisessä vaiheessa käyttää vain teknistä tunnistetta.

Varsinainen laskunumero muodostetaan backendissä vasta myöhemmin päätettävässä hyväksymis- tai lukitusvaiheessa.

Ennen numeroinnin toteutusta päätetään:

- missä tilasiirtymässä numero annetaan
- onko numerointi yrityskohtainen
- mikä on ensimmäinen numero
- käytetäänkö vuosittaista vai jatkuvaa numerosarjaa
- saako numeroissa olla aukkoja
- miten offline- ja cloud-käytön numerointi sovitetaan yhteen
- miten epäonnistunut hyväksyminen vaikuttaa varattuun numeroon

Frontend ei koskaan päätä lopullista laskunumeroa.

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

Päätetään ja dokumentoidaan:

- ALV-kannat
- veroton tai verollinen syöttötapa
- määrä- ja hintatarkkuus
- pyöristykset
- maksuehto ja eräpäivän käyttäytyminen
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

### Vaihe 6: Hyväksyntä, Numerointi Ja Snapshotit

Tehdään vasta erikseen hyväksyttyjen sääntöjen jälkeen:

- hyväksyntä tai laskun lukitus
- lopullinen laskunumero
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

1. Mitkä ALV-kannat MVP tukee?
2. Syötetäänkö yksikköhinnat verottomina vai verollisina?
3. Miten määrä, ALV ja pyöristys esitetään tarkasti?
4. Lasketaanko ALV riveittäin vai verokannan yhteissummasta?
5. Mikä on uuden laskun oletusmaksuehto?
6. Miten eräpäivä reagoi päiväyksen tai maksuehdon muutokseen?
7. Sallitaanko negatiiviset tai nollahintaiset rivit?
8. Mitkä kentät ovat luonnoksella pakollisia?
9. Mitkä ovat ensimmäiset sallitut laskuyksiköt?
10. Milloin laskunumero annetaan ja millainen numerosarja on?
11. Ovatko `approved` ja `issued` eri tiloja?
12. Kuka saa hyväksyä tai lukita laskun?
13. Saako hyväksyttyä laskua muuttaa?
14. Milloin lopullinen snapshot muodostetaan?

Jos toteutustehtävä osuu johonkin näistä eikä päätöstä ole dokumentoitu, työ pysäytetään kyseisen säännön osalta ja projektin omistajalta pyydetään päätös.

## Hyväksymiskriteerit Tulevalle Luonnos-MVP:lle

Ensimmäinen laskuluonnos-MVP voidaan hyväksyä, kun:

- laskuluonnos voidaan luoda suoraan asiakkaalle
- kohdetta tai työmääräystä ei vaadita
- laskurivejä voidaan lisätä käsin
- backend validoi ja laskee summat
- luonnos voidaan tallentaa ja avata uudelleen
- luonnosta voidaan muokata
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
