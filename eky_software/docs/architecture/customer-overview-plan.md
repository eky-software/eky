# Customer overview plan

Tämä dokumentti kuvaa asiakkaan koontinäkymän hyväksytyn ensimmäisen
toteutuslinjan. Tavoite on erottaa asiakaskortiston lista ja yhden asiakkaan
työtila toisistaan muuttamatta moduulien omistajuutta.

## Tausta

Nykyinen asiakaskortisto sisältää jo Customer MVP -tason perustoiminnot:

- asiakaslista
- haku
- lajittelu
- asiakastyypin suodatus
- asiakkaan luonti
- asiakkaan muokkaus
- isännöitsijätoimiston ja taloyhtiön välinen asiakasrekisterisuhde

Tämä on hyvä customer-pohja, mutta seuraavaksi pitää erottaa kaksi näkymää:

```text
Asiakaskortiston lista
  -> selaa asiakkaita
  -> hae asiakkaita
  -> lajittele asiakkaita
  -> avaa asiakas

Asiakkaan koontinäkymä
  -> näyttää yhden asiakkaan kokonaisuuden
  -> näyttää myöhemmin asiakkaan kohteet, työmääräykset, historian ja laskutustilanteen
```

Asiakaskortiston lista ei ole sama asia kuin asiakkaan koontinäkymä.

## Periaate

Asiakkaan koontinäkymä näyttää asiakkaaseen liittyvän kokonaisuuden.

Se ei tarkoita, että customers-moduuli omistaa kaiken asiakkaaseen liittyvän datan.

Customers-moduuli omistaa:

- asiakkaan perustiedot
- asiakasnumeron
- asiakastyypin
- yhteystiedot
- osoitetiedot
- isännöitsijätoimiston ja taloyhtiön välisen asiakasrekisterisuhteen
- asiakaskohtaisen tuntihintaohituksen
- asiakkaan tilan

Customers-moduuli ei omista:

- ohjelmaa käyttävän oman yrityksen oletustuntihintaa
- kohteita
- työmääräyksiä
- tuntikirjauksia
- materiaalikirjauksia
- laskuja
- laskurivejä
- maksutapahtumia
- varastosaldoja

Koontinäkymä saa myöhemmin näyttää näiden moduulien tietoja, mutta niiden kirjoittavat toiminnot kuuluvat edelleen omiin moduuleihinsa.

## Hyväksytty Työtilamalli

Asiakaslistasta avataan asiakaskortti koko työalueelle. Myös uuden asiakkaan
luonti käyttää koko työalueen lomaketta. Nykyinen sivupaneeli on välivaihe ja
poistetaan koko työalueen mallin toteutuksessa.

Customers-featuren keskitetyt sisäiset näkymätilat ovat:

```text
list
create
overview
edit
```

Ensimmäisessä toteutuksessa ei lisätä routeria eikä pysyvää resurssi-URL:ia.

Ensimmäinen varsinainen koonti sisältää:

- asiakkaan perustiedot, yhteystiedot ja osoitteen
- tilan, asiakastyypin ja asiakasnumeron
- taloyhtiön ja isännöitsijätoimiston suhteen tarvittaessa
- asiakaskohtaisen tuntihinnan tai käytetyn nykyisen Company Settings
  -oletushinnan
- Customers-moduulin turvallisen asiakaskohtaisen historian
- Invoicing-moduulin omistamat asiakaskohtaiset laskulistat

Sites ja Work Orders lisätään myöhemmin niiden omistavien moduulien
read modelien kautta. Customers ei ennakoi niiden tietomallia eikä omista
niiden dataa koontinäkymän vuoksi.

## Asiakaskortin Työskentelytila

Asiakaslistasta avataan varsinainen asiakaskortti koko työalueelle. Asiakaskortti
on oletuksena lukutilassa, jotta tietojen tarkastelu ja tietojen muuttaminen
erottuvat selvästi toisistaan.

Työskentelymalli:

- asiakasrivi avaa asiakaskortin lukutilaan
- `Muokkaa` vaihtaa asiakkaan perustiedot muokattaviksi samalla työalueella
- `Tallenna` käyttää customers-moduulin kirjoittavaa application serviceä ja
  palauttaa onnistuneen tallennuksen jälkeen lukutilaan
- `Peruuta` hylkää tallentamattomat muutokset ja palauttaa lukutilaan
- lopullisessa mallissa olemassa olevan asiakkaan ylläpitoon ei jää erillistä
  pientä sivupaneelin pikamuokkausikkunaa

Uuden asiakkaan luonti on erillinen `create`-tila samalla koko työalueella.
Onnistunut luonti avaa uuden asiakkaan `overview`-tilaan. Nykyistä
sivupaneelirakennetta ei säilytetä luontiin eikä muokkaukseen.

## Moduulirajat

Customer overview on read/overview-näkymä.

Se saa näyttää usean moduulin tietoja, mutta se ei saa muuttaa moduulien omistajuutta.

Säännöt:

- customer overview ei tarkoita, että kaikki asiakkaaseen liittyvä data tallennetaan `customers`-tauluun
- customers-moduuli omistaa edelleen vain asiakas-master-datan
- sites-moduuli omistaa kohteet
- work orders -moduuli omistaa työmääräykset
- work entries -moduuli omistaa tunti- ja työaikakirjaukset
- material entries -moduuli omistaa materiaalikirjaukset
- company settings -moduuli omistaa oman yrityksen tiedot ja oletustuntihinnan
- invoicing-moduuli omistaa laskut, laskurivit ja laskutustilat
- reporting tai erillinen read model voi myöhemmin koostaa usean moduulin tietoa

Kirjoittavat toiminnot kulkevat aina oikean moduulin application servicejen kautta.

Esimerkiksi:

- asiakastietojen muokkaus kulkee customers-moduulin kautta
- oman yrityksen oletustuntihinnan muokkaus kulkee company settings -moduulin kautta
- kohteen lisäys kulkee sites-moduulin kautta
- työmääräyksen luonti kulkee work orders -moduulin kautta
- laskun muodostus kulkee invoicing-moduulin kautta

Koontinäkymä ei saa olla oikopolku, jolla UI tai AI-agentti kirjoittaa suoraan toisen moduulin dataan.

## Ensimmäinen Toteutus

Nykyinen Customer MVP säilyttää:

- asiakaslista
- haku
- lajittelu
- asiakastyypin suodatus
- uuden asiakkaan luonti
- olemassa olevan asiakkaan perustietojen muokkaus

Koko työalueen asiakaskortti lisää:

- asiakkaan perustiedot
- asiakasnumeron
- asiakastyypin
- yhteystiedot
- osoitteen
- tilan
- isännöitsijä/taloyhtiö-suhteen, jos se liittyy asiakkaaseen
- isännöitsijätoimiston hallinnoimat taloyhtiöt Customersin nykyisestä
  yritysrajatusta read modelista
- asiakaskohtaisen tuntihinnan tai tiedon nykyisen oman yrityksen
  oletustuntihinnan käytöstä
- laskut, jotka Invoicing rajaa laskun `customerId`-arvolla
- isännöitsijätoimiston erilliset taloyhtiölaskut, joissa se on laskulle
  tallennettu vastaanottaja
- turvallisen Customers-historian asiakkaan luonnista, päivityksistä,
  aktivoinnista ja passivoinnista

Asiakkaan master data pysyy käytettävissä, vaikka lasku- tai historiaosion
lataus epäonnistuisi. Jokaisella osiolla on oma loading-, empty- ja turvallinen
error-tila.

### Myöhemmin: Sites / Kohteet

Kun kohteet-moduuli suunnitellaan ja toteutetaan, customer overview voi näyttää asiakkaan kohteet.

Kohteet pysyvät sites-moduulin omistuksessa.

Customer overview saa lukea kohteet hallitusta rajapinnasta.

### Myöhemmin: Work Orders / Työmääräykset

Kun työmääräykset-moduuli suunnitellaan ja toteutetaan, customer overview voi näyttää:

- avoimet työmääräykset
- viimeisimmät työmääräykset
- työmääräysten tilat

Työmääräykset pysyvät work orders -moduulin omistuksessa.

### Myöhemmin: Laajempi Historia

Ensimmäinen historia on tarkoituksella Customers-moduulin omistama ja sisältää
vain turvalliset asiakasauditin projektiot. Work Orders, Work Entries ja
Material Entries voivat myöhemmin tarjota omat rajatut projektiot.
Koontinäkymä ei kopioi globaalia Activity-näkymää eikä muodosta rajaamatonta
moduulien välistä tapahtumavirtaa.

### Nyt: Laskutuskooste

Invoicing on jo olemassa, joten asiakaskohtaiset laskut kuuluvat ensimmäiseen
varsinaiseen koontiin. Invoicing omistaa luonnosten, hyväksyttyjen,
lähetettyjen, maksettujen, osahyvitettyjen, kokonaan hyvitettyjen ja peruttujen
laskujen listasemantiikan. Asiakkaan omien laskujen suodatus perustuu aina
laskun `customerId`-arvoon. Hyvityslaskut ja maksutila säilyvät Invoicingin
omistamassa ryhmittelyssä.

Laskun juridinen asiakasomistajuus ja laskun vastaanottaminen ovat eri
vastuita:

- `customerId` määrittää juridisen asiakkaan ja asiakaskortin, jonka omiin
  laskuihin lasku kuuluu
- `billingRecipientCustomerId` määrittää laskulle tallennetun erillisen
  vastaanottajan
- vastaanottajana oleva isännöitsijätoimisto ei omista taloyhtiön laskua eikä
  lasku näy sen omassa `customerId`-rajatussa laskulistassa
- isännöitsijätoimiston kortilla vastaanotetut taloyhtiölaskut näytetään
  erillisessä `Taloyhtiöiden laskut vastaanottajana` -read modelissa
- recipient-read model näyttää laskun varsinaisena asiakkaana laskulle
  tallennetun customer-snapshotin
- vastaanottajalasku päätellään laskulle tallennetusta
  `billingRecipientCustomerId`-arvosta, ei Customersin nykyisestä
  `managedByCustomerId`-suhteesta
- historiallinen vastaanottajalasku säilyy isännöitsijän recipient-listassa,
  vaikka taloyhtiön nykyinen isännöitsijäsuhde myöhemmin muuttuisi
- luonnokset jätetään ensimmäisen recipient-overview-version ulkopuolelle

Recipient-listaus on Invoicingin yritysrajattu julkinen read model. Customers
ei JOINaa laskutuksen tauluja eikä kopioi lasku- tai snapshot-dataa omaan
persistenssiinsä. Isännöitsijätoimiston asiakaskortin oma paneeli käyttää tätä
read modelia erillisellä loading-, empty- ja turvallisella error-tilalla.
Paneelin virhe ei piilota customer-master-dataa, hallinnoituja taloyhtiöitä,
asiakkaan omia laskuja tai tapahtumahistoriaa.

Nykyisessä toteutuksessa asiakaskortin pääkategoriat ovat:

- Lähetetyt: hyvittämätön ja maksamaton standardilasku
- Maksetut: hyvittämätön ja maksettu standardilasku
- Hyvitetyt: hyvitetty standardilasku maksutilasta riippumatta

Maksettu ja myöhemmin hyvitetty lasku näkyy vain Hyvitetyt-kategoriassa ja voi
saada `Maksettu`-lisämerkinnän. Asiakaskortti ei laske maksutilaa tai
jäljellä olevaa saatavaa itse. Maksutilan listausvirhe ei saa piilottaa
asiakkaan master dataa tai muuta jo onnistuneesti ladattua koontitietoa.

Customers-web käyttää julkisia API-client-sopimuksia ja tyypitettyä
app-navigation callbackia laskun avaamiseen Invoicingissa. Se ei importtaa
Invoicing-featuren sisäisiä komponentteja tai tilaa.

Manuaalisen maksuseurannan tarkempi sopimus on dokumentissa
`docs/architecture/invoice-payment-tracking-plan.md`.

Kategoriarajojen ja laskutukseen avaamisen järjestelmätodiste on
`CUS-OVERVIEW-007` testissä
`apps/e2e/tests/web/customerOverviewJourneys.spec.ts`.

Asiakaskortin laskukokonaisuudella on yksi yhteinen lajittelu- ja
sivukokovalinta. Oletussivukoko on 5, ja vaihtoehdot ovat 5, 20 ja 50.
Valinnan muuttaminen palauttaa kaikki kategoriat sivulle 1, mutta luonnosten,
hyväksyttyjen, lähetettyjen, maksettujen, hyvitettyjen ja peruttujen
kategoriakohtainen sivutus säilyy sen jälkeen itsenäisenä. Maksetut näyttävät
snapshot/read model -tiedon mukaisen maksupäivän. Customers ei omista eikä
kopioi laskutuksen tietoa, vaan käyttää Invoicingin julkisia rajattuja
listausrajapintoja `companyId + customerId` -rajassa.

## Työmääräysten Merkitys

Työmääräykset kannattaa pitää erillisenä moduulina.

Ne antavat rakenteen sille:

- mitä asiakkaalle tehdään
- missä tehdään
- kuka tekee
- milloin tehdään
- mitä voidaan myöhemmin laskuttaa

Asiakkaan alle ei pidä kerätä epämääräistä tapahtumakasaa ilman työmääräysrakennetta.

Työmääräys toimii myöhemmin tärkeänä linkkinä asiakkaan, kohteen, työn, tuntikirjausten, materiaalikirjausten ja laskutuksen välillä.

## UI-Periaate

Customer overview on osa Eky-työpöytäkokemusta.

Sen pitää tukea nopeaa ymmärrystä:

- kuka asiakas on
- mikä asiakkaan tila on
- mihin asiakas liittyy
- käytetäänkö asiakkaalla omaa tuntihintaa vai oman yrityksen oletustuntihintaa
- mitä asiakkaalle on viimeksi tehty
- mitä asiakkaan kanssa pitää seuraavaksi huomioida

Ensimmäinen näkymä pidetään työohjelmamaisena ja helposti luettavana. Se ei ole
dashboard eikä siirrä tulevien moduulien vastuuta Customersiin.

## Rajaukset

Ensimmäisessä toteutuksessa ei lisätä:

- uutta customer overview -taulua tai jättimäistä koontiaggregaattia
- uusia riippuvuuksia tai UI-kirjastoa
- React Routeria
- `packages/ui`-paketin aktivointia
- Sites- tai Work Orders -moduulin toteutusta
- Customersin omistamaa laskudataa tai JOINia Invoicing-infrastructureen
- globaalia Activity-kopiota

Asiakaskortilta voidaan aloittaa uusi lasku aktiiviselle asiakkaalle. Customers
välittää app-navigationille vain asiakkaan tunnisteen eikä tunne
laskulomaketta, Invoicingin statea tai hookkeja. App-kerros vaihtaa
Laskutus-moduuliin, jossa Invoicing varmistaa tunnisteen omasta
yritysrajatusta asiakaslistastaan ennen normaalin uuden laskun lomakkeen
avaamista. Passiivinen, vanhentunut tai nykyisen yritysrajauksen ulkopuolelle
jäävä tunniste ei avaa lomaketta.

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/customer-ui-ux-plan.md`
- `docs/architecture/invoicing-workflow-boundaries.md`
- `docs/modules/customers.md`
- `docs/modules/company-settings.md`
- `docs/design/ui-principles.md`
