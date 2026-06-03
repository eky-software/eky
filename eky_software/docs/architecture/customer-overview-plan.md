# Customer overview plan

Tämä dokumentti kuvaa asiakkaan koontinäkymän ensimmäisen suunnittelulinjan.

Tämä ei ole vielä toteutussuunnitelma uudelle koodille. Tavoite on erottaa asiakaskortiston lista ja yhden asiakkaan koontinäkymä toisistaan ennen kuin customer-moduulia, kohteita, työmääräyksiä tai laskutusta laajennetaan.

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
- asiakaskohtaisen tuntihintaohituksen, jos sellainen myöhemmin lisätään
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

## Customer Overview -Ajatus

Kun asiakas avataan, tulevaisuudessa voidaan näyttää asiakkaan koontinäkymä.

Ensimmäinen lopullista koontia kohti vievä näkymä voi sisältää:

- perustiedot
- kohteet
- avoimet työmääräykset
- viimeisimmät tapahtumat
- hinnoittelun lähtötiedot, kuten asiakaskohtainen tuntihinta tai tieto oletustuntihinnan käytöstä
- laskutustilanne
- muistiinpanot
- mahdollinen historia tai aikajana

Ensimmäisessä kevyessä rungossa voidaan näyttää vain asiakkaan perustiedot.

Myöhemmissä vaiheissa näkymä voi lukea dataa useasta moduulista hallitusti esimerkiksi read servicejen, readonly-porttien tai reporting/read model -tyyppisen kerroksen kautta.

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

## Vaiheistus

Mahdollinen eteneminen:

### Vaihe 1: Asiakaslista, Luonti Ja Muokkaus

Nykyinen customer MVP:

- asiakaslista
- haku
- lajittelu
- asiakastyypin suodatus
- uuden asiakkaan luonti
- olemassa olevan asiakkaan perustietojen muokkaus

Tämä vaihe on asiakaskortiston käytännön pohja.

### Vaihe 2: Kevyt Customer Overview -Runko

Lisätään asiakkaan koontinäkymän kevyt runko.

Ensimmäinen runko voi näyttää vain:

- asiakkaan perustiedot
- asiakasnumeron
- asiakastyypin
- yhteystiedot
- osoitteen
- tilan
- isännöitsijä/taloyhtiö-suhteen, jos se liittyy asiakkaaseen
- asiakaskohtaisen tuntihinnan tai tiedon siitä, että käytetään oman yrityksen oletustuntihintaa, jos hinnoittelukenttä on toteutettu

Tässä vaiheessa näkymä ei vielä näytä kohteita, työmääräyksiä tai laskutusta.

### Vaihe 3: Sites / Kohteet

Kun kohteet-moduuli suunnitellaan ja toteutetaan, customer overview voi näyttää asiakkaan kohteet.

Kohteet pysyvät sites-moduulin omistuksessa.

Customer overview saa lukea kohteet hallitusta rajapinnasta.

### Vaihe 4: Work Orders / Työmääräykset

Kun työmääräykset-moduuli suunnitellaan ja toteutetaan, customer overview voi näyttää:

- avoimet työmääräykset
- viimeisimmät työmääräykset
- työmääräysten tilat

Työmääräykset pysyvät work orders -moduulin omistuksessa.

### Vaihe 5: Tapahtumahistoria

Kun työ- ja materiaalikirjaukset ovat olemassa, customer overview voi näyttää hallitun historian tai aikajanan.

Historia voi myöhemmin yhdistää esimerkiksi:

- työmääräykset
- tuntikirjaukset
- materiaalikirjaukset
- tärkeät asiakastapahtumat

Historia ei saa muuttua epämääräiseksi tapahtumakasaksi ilman moduulirajoja.

### Vaihe 6: Laskutuskooste

Kun laskutusmoduuli on olemassa, customer overview voi näyttää laskutuksen koosteita, esimerkiksi:

- avoimet laskut
- viimeisimmät laskut
- maksutilanne
- laskuttamattomat työt myöhemmin, jos tähän tehdään oma hallittu näkymä

Laskut ja laskurivit pysyvät invoicing-moduulin omistuksessa.

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

Ensimmäinen näkymä pidetään kuitenkin kevyenä.

Koontinäkymää ei rakenneta isoksi dashboardiksi ennen kuin kohteet, työmääräykset ja laskutus ovat olemassa.

## Seuraava Käytännön Valinta

Tämän suunnitelman jälkeen seuraava päätös on:

```text
Rakennetaanko ensin pieni Customer Overview -runko
vai
siirrytäänkö ensin Sites / Kohteet -moduulin suunnitteluun?
```

Molemmat ovat sallittuja polkuja.

Kevyt Customer Overview -runko voi auttaa hahmottamaan yhden asiakkaan kokonaisuutta ennen uusia moduuleita.

Sites / Kohteet -moduuli voi olla luonteva seuraava moduuli, koska se vastaa kysymykseen:

```text
missä työ tehdään
```

Tämä dokumentti ei vielä päätä kumpaa polkua seurataan.

## Rajaukset

Tässä dokumentissa ei tehdä:

- uutta koodia
- tietokantamuutoksia
- uusia API-reittejä
- uusia riippuvuuksia
- uutta UI-kirjastoa
- `packages/ui`-pakettia
- Zodia
- React Hook Formia
- sites-moduulin toteutusta
- työmääräysmoduulin toteutusta
- laskutusmoduulin toteutusta
- company settings -moduulin toteutusta
- hinnoittelulogiikan toteutusta

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/data-model-principles.md`
- `docs/architecture/customer-ui-ux-plan.md`
- `docs/modules/customers.md`
- `docs/modules/company-settings.md`
- `docs/design/ui-principles.md`
