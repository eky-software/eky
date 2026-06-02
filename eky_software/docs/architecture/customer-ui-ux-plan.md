# Customer UI UX plan

Tämä dokumentti kuvaa customer-moduulin käyttökokemuksen korjauslinjan nykyisen teknisen MVP-läpiviennin jälkeen.

Tavoite ei ole rakentaa koko lopullista asiakashallintaa. Tavoite on muuttaa nykyinen toimiva mutta kömpelö customer UI oikeaksi Eky Local -asiakaskortiston työpöytänäkymäksi.

## Tausta

Nykyinen customer UI todisti tärkeän teknisen ketjun:

```text
React UI
  -> packages/api-client
    -> local backend
      -> customer application/domain
        -> SQLite
```

Tämä oli oikea ensimmäinen vaihe.

Käyttökokemuksen kannalta nykyinen näkymä näyttää kuitenkin liian paljon tekniseltä läpivienniltä. Kaikki asiakaskortin kentät ovat näkyvissä yhtä aikaa pitkässä lomakkeessa, jolloin näkymästä tulee kenttäseinä eikä ERP-työpöydän asiakaskortisto.

## Nykyisen UI:n Ongelmat

Nykyisessä näkymässä:

- lomake hallitsee näkymää liikaa
- asiakaslista jää ahtaaksi
- kaikki kentät ovat samalla painoarvolla
- päälista näyttää liian tekniseltä
- asiakasnumero on pakollinen, mutta käyttäjä ei saa siihen hyvää ohjausta
- näkymä näyttää tekniseltä demolta, ei asiakaskortistolta

Tämä ei tarkoita, että HTML, CSS tai React olisi väärä valinta. Ongelma on käyttöliittymärakenne: data vietiin koko pinon läpi ennen kuin asiakaskortiston työskentelymalli muotoiltiin.

## Uusi Näkymämalli

Asiakaskortisto ei ole ensisijaisesti pitkä lomake.

Asiakaskortisto on ensisijaisesti lista asiakkaista.

Uusi asiakas -lomake on toiminto, joka avataan tarvittaessa.

Suunniteltu perusrakenne:

```text
Asiakaskortisto
  -> otsikko ja lyhyt kuvaus
  -> Uusi asiakas -painike
  -> iso asiakaslista
  -> sivupaneeli tai erillinen lomakealue uuden asiakkaan lisäämiseen
  -> asiakasrivi avaa saman paneelin asiakkaan muokkaamiseen
  -> myöhemmin tarkka asiakaskortti / details-näkymä
```

Nykyinen pitkä lomake ei saa olla aina näkymän pääsisältö.

## Asiakkaat-Päänäkymä

Asiakkaat-päänäkymän ensimmäinen rakenne:

- otsikko: Asiakaskortisto
- lyhyt kuvaus näkymän tarkoituksesta
- ensisijainen toiminto: Uusi asiakas
- pääsisältö: asiakaslista isona työalueena
- lomake näkyy vain, kun käyttäjä aloittaa uuden asiakkaan lisäämisen
- olemassa oleva asiakas avataan muokattavaksi asiakaslistasta

Tämä vastaa Eky UI -periaatetta: ohjelma on työpöytä, ei lomakesivu tai landing page.

## Asiakaslista

Päälistassa näytetään vain tärkeimmät kentät.

Ensimmäiset listasarake-ehdotukset:

- asiakasnumero
- nimi
- asiakastyyppi
- paikkakunta
- yhteystieto, ensisijaisesti sähköposti tai puhelin
- tila

Päälistassa ei näytetä kaikkia asiakaskortin kenttiä.

Y-tunnus, koko osoite, kommentti ja muut laajemmat tiedot kuuluvat myöhemmin:

- tarkempaan asiakaskorttiin
- lomakepaneeliin
- mahdolliseen details-näkymään

## Uusi Asiakas -Lomake

Uusi asiakas -lomake avataan vasta, kun käyttäjä painaa Uusi asiakas -toimintoa.

Samaa paneelirakennetta voidaan käyttää olemassa olevan asiakkaan muokkaamiseen.

Ensimmäinen toteutus voi olla:

- oikean reunan sivupaneeli
- tai selkeä erillinen lomakealue päälistan rinnalla

Lomaketta ei pidä näyttää aina isona pääsisältönä.

Lomake jaetaan osioihin:

- Perustiedot
- Yhteystiedot
- Osoite
- Lisätiedot

Pakolliset kentät:

- nimi
- asiakastyyppi
- tila
- asiakasnumero vain silloin, jos käyttäjä valitsee manuaalisen numeroinnin

Jos asiakastyyppi on taloyhtiö, lomakkeessa voidaan näyttää isännöitsijätoimiston valinta.

Ensimmäinen malli:

- isännöitsijätoimisto on customer, jonka tyyppi on `propertyManager`
- taloyhtiö voi valita yhden isännöitsijätoimiston
- backend tarkistaa, että valittu asiakas on oikeasti isännöitsijätoimisto
- muut asiakastyypit eivät käytä isännöitsijätoimiston viitettä

Ensimmäisessä UX-korjauksessa lomakkeen pitää tuntua ohjatulta työtoiminnolta, ei tietokantataulun suoralta kenttälistalta.

## Asiakasnumero

Asiakasnumero on käyttäjälle näkyvä tunniste.

`id` pysyy teknisenä UUID-tunnisteena.

`customerNumber` ei ole tietokannan primary key.

Asiakasnumeron käyttöliittymämalli:

```text
Asiakasnumero
  oletus: Luo automaattisesti
  vaihtoehto: Syötä itse
```

Säännöt:

- frontend ei päätä lopullista automaattista numeroa
- backend muodostaa automaattisen asiakasnumeron
- jos käyttäjä valitsee manuaalisen numeroinnin, backend tarkistaa numeron uniikkiuden `companyId`-rajauksen sisällä
- `customerNumber` on uniikki `companyId`-rajauksen sisällä
- `customerNumber` ei ole laskunumero
- `customerNumber` ei saa korvata teknistä `id`-tunnistetta

Mahdollinen tuleva API-request-malli:

```ts
type CustomerNumberMode = 'auto' | 'manual';

interface CreateCustomerInput {
  customerNumberMode: CustomerNumberMode;
  customerNumber?: string;
  name: string;
  // muut asiakaskortin kentät
}
```

Jos `customerNumberMode` on `auto`, backend antaa seuraavan vapaan asiakasnumeron.

Jos `customerNumberMode` on `manual`, käyttäjän antama numero on pakollinen ja backend tarkistaa sen.

## Toteutusjärjestys

Myöhempi koodityö tehdään pienissä vaiheissa:

1. `customer-ui-ux-plan.md` hyväksytään.
2. `docs/modules/customers.md` päivitetään asiakasnumeron auto/manual-linjalla.
3. UI refaktoroidaan lista + sivupaneeli -malliin ilman backend-muutosta, jos mahdollista.
4. Backendiin lisätään automaattinen asiakasnumeron luonti.
5. `packages/api-client` päivitetään.
6. UI päivitetään käyttämään auto/manual-mallia.
7. Testit päivitetään.

Jos UI-rakennetta voidaan parantaa ennen backendin auto-numerointia, se tehdään rajatusti. Tällöin nykyistä backendin vaatimusta voidaan tukea väliaikaisesti UI:ssa, mutta lopullinen malli on backendin muodostama automaattinen numero.

Ensimmäisessä toimivassa toteutuksessa automaattinen asiakasnumero muodostetaan backendissä yrityksen suurimman nykyisen numeerisen asiakasnumeron perusteella. Jos numeerisia asiakasnumeroita ei ole, ensimmäinen automaattinen numero on `1001`.

## Rajaukset

Tässä UX-korjauslinjassa ei tehdä vielä:

- asiakkaan poistoa
- hakua
- suodatusta
- paginointia
- varsinaista asiakaskortin details-näkymää
- sites-moduulia
- laskutusta
- authia
- syncia

Ei lisätä:

- UI-kirjastoa
- Tailwindia
- React Hook Formia
- Zodia
- TanStack Queryä
- `packages/ui`-pakettia
- uusia riippuvuuksia

## Kerrossäännöt

Customer UI käyttää backend API:a vain `packages/api-client`-paketin kautta.

React-komponentit eivät tee raakaa `fetch`-kutsua.

React-komponentit eivät kirjoita SQLiteen.

React-komponentit eivät importtaa backendin sisäisiä moduuleja.

UI saa ohjata käyttäjän syötettä, mutta backend tekee lopullisen validoinnin, asiakasnumeron uniikkiustarkistuksen ja myöhemmin käyttöoikeustarkistuksen.

## Suhde UI-Periaatteisiin

Tämä suunnitelma tarkentaa dokumenttia `docs/design/ui-principles.md` customer-moduulin osalta.

Eky on työohjelma, ei landing page.

Asiakaskortiston pitää tukea päivittäistä työskentelyä:

- lista ensin
- toiminto tarvittaessa
- asiakasrivi avaa olemassa olevan asiakkaan tiedot muokattavaksi
- yksityiskohdat erikseen
- ei kenttäseinää pääsisältönä

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/design/ui-principles.md`
- `docs/architecture/web-customer-ui-plan.md`
- `docs/architecture/customer-vertical-slice-plan.md`
- `docs/architecture/dependency-policy.md`
- `docs/modules/customers.md`
- `packages/api-client/README.md`
