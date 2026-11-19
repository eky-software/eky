# Paikallisen Ekyn käyttö- ja tukiohje

Tämä ohje kuvaa nykyistä paikallista työpöytäsovellusta kohti 0.3.0:aa.
Se ei ole julkaisulupa tai käyttäjätestin läpäisytulos. Ennen erillistä
toimitushyväksyntää käytä vain synteettisiä testitietoja ja kuivaharjoittelua,
älä oikeita asiakkaita, salasanoja tai sähköpostilähetyksiä.
[Julkaisun tila](../architecture/release-0.3.0-m1-preparation-plan.md#jatka-tästä)
on erillinen tästä ohjeesta. Selainkehitys ei sisällä kaikkia desktop-toimintoja.

## Yrityksen valinta ja asetukset

- Tarkista aktiivinen yritys ennen muutoksia. **Yritykset**-valikosta voit
  luoda yrityksen, tuoda sen varmuuskopiosta, avata tai nimetä yrityksen uudelleen.
  Yrityksen luonti ja sen avaaminen ovat erillisiä valintoja.
- Sama nimi ei kelpaa uudelle yritykselle, tuonnille tai nimenmuutokselle
  pelkällä kirjainkoon tai ylimääräisten välilyöntien muutoksella. Vanhat
  samannimiset yritykset säilyvät erillisinä; huomautus ei yhdistä niiden tietoja.
- **Oma yritys** sisältää laskuttavan yrityksen perustiedot ja erikseen
  tallennettavat laskutusasetukset. Yritysvalikon näyttönimi ei ole sama
  asia kuin laskulle tallennettava laskuttajan nimi.
- Odota perustietojen onnistunutta latausta ennen muokkausta. Jos luku
  epäonnistuu, **Lataa tiedot uudelleen** aloittaa uuden lukuyrityksen.
  Virhettä ei pidä ohittaa tallentamalla oletettuja tyhjiä tietoja.
- **SMTP-salasana** hallitaan erikseen desktopissa; tallennettua salasanaa
  ei näytetä lomakkeella. Tuntematon tila ei tarkoita, ettei salasanaa ole.
  Jos muutoksen lopputulos tai tapahtumamerkinnän valmistuminen jäi epävarmaksi,
  älä toista muutosta tässä ajossa. Sulje koko Eky tavallisesti ja avaa se
  uudelleen ennen salasanan tarkistamista tai uudelleensyöttöä. Jos sulku
  tai uusi avaus ei onnistu turvallisesti, lopeta käyttö ja ota yhteys tukeen;
  älä pakkopysäytä prosesseja tai poista tiedostoja. Tilaluku tai restart ei
  ratkaise vanhan muutoksen tapahtumamerkintää. Toisen yrityksen salaisuutta
  ei siirretä yrityksen vaihdossa.

## Asiakkaat ja laskut

1. Perusta asiakas **Asiakkaat**-näkymässä. Pakollisen kentän puuttuminen,
   käytössä oleva asiakasnumero tai asiakassuhteen vaatima tyyppi voi estää
   tallennuksen. Korjaa ilmoitettu tieto, älä muuta tietokantaa käsin.
2. Luo **Laskutus**-näkymässä luonnos ja tarkista asiakas, rivit, hinnat,
   verot, vastaanottaja ja päiväykset. Odota **Tallennettu**-tilaa ennen
   hyväksyntää; tallennusvirhe ei ole onnistunut tallennus.
3. **Hyväksy laskuksi** vaatii vahvistuksen. Puutteelliset tiedot tai
   numerointiasetukset voivat estää hyväksynnän. Luo ja avaa hyväksytyn
   laskun PDF ja tarkista sisältö ennen toimitusta.
4. **Kuivaharjoittele lähetys** ei lähetä sähköpostia. Todellinen
   **Lähetä lasku** ja hallittu SMTP-testi ovat eri toimintoja; älä käytä
   niitä ilman kyseisen käytön erillistä hyväksyntää.
5. Tarkista **Toimitushistoria** ennen uutta lähetystä tai korjausta.
   Laskun sisältö, PDF ja toimitustapahtuma voivat kuulua eri revisioihin.
   Myöhempi asiakas- tai laskumuutos ei kirjoita vanhaa toimitettua versiota uusiksi.
   Puuttuva vanhan dokumentin todiste ei kerro, mikä PDF aikanaan lähetettiin.

Jos lähetys on epävarma, älä lähetä uudelleen pelkän virheilmoituksen vuoksi.
Jos lähetys onnistui mutta tietojen uusintaluku epäonnistui, avaa lasku ja
tarkista historia. Tämä ei ole sama asia kuin epäonnistunut lähetys.

## Varmuuskopio ja palautus

**Oma yritys → Varmuuskopiointi ja palautus:**

- **Luo varmuuskopio** tallentaa salatun `.ekybackup`-tiedoston valitsemaasi
  paikkaan ja tarkistaa viennin. Nimiehdotuksessa käytetään yritysvalikossa näkyvää nimeä
  ja päivämäärää. Tiedostonimi ei todista kopion yritystä tai eheyttä.
- Säilytä kopio ja salasana erikseen turvallisesti. Unohtunutta salasanaa
  ei voida palauttaa. SMTP-salasana ei kuulu siirrettävään varmuuskopioon;
  sitä ei tuoda toiselle yritykselle tai koneelle.
- **Tarkista varmuuskopio** tarkistaa kopion korvaamatta yrityksen tietoja.
  Tarkistuksen läpäisy ei tarkoita, että palautus on tehty.

Palautus tehdään **Yritykset**-valikossa. **Tuo yritys varmuuskopiosta**
luo erillisen yrityksen. **Korvaa tiedot varmuuskopiosta** korvaa aktiivisen
yrityksen tiedot vain saman yrityksen kopiosta, vahvistusten ja nykyisistä
tiedoista muodostettavan palautuspisteen jälkeen. Onnistuminen varmistetaan
vasta koko palautus- ja uudelleenkäynnistysketjusta.

Palautuspiste on Ekyn paikallinen palautumissuoja, ei siirrettävä varmuuskopio.
**Toimitettujen laskujen PDF-kopiot** ovat ulkoiseen kansioon tehtäviä
lisäkopioita, eivät varmuuskopio. Ulkoinen PDF-kansio ei kuulu `.ekybackup`-kopioon.
Epävarmassa palautuksessa älä toista tuontia tai korvausta sokkona äläkä
poista tiedostoja. Katso [palautusvirheen toimintaohje](../architecture/local-restore-recovery-runbook.md#käyttäjän-toiminta).

## Yrityksen lopullinen poisto

Valitse oikean yrityksen **Poista yritys**. Tarkista kohteen nimi ja
poistuvan sekä säilyvän aineiston yhteenveto. Kirjoita vahvistusnimi
täsmälleen lomakkeen ohjeen mukaan. Valitse varmuuskopion luonti tai
erillinen tietojen menetyksen hyväksyntä. Ilman varmuuskopiota vahvistat
tietojen menetyksen vielä erillisessä natiivi-ikkunassa. Varmuuskopiohaarassa
kopio valmistellaan ja tarkistetaan sen sijaan. Molemmissa haaroissa
tarvitaan lopuksi natiivi-ikkunan **Poista yritys pysyvästi** -vahvistus.
Menetyshyväksyntää ei valita puolestasi.

Varmuuskopio voidaan valmistella vain avoimesta poistettavasta yrityksestä.
Suljetun tai vikatilaisen yrityksen poisto voi edellyttää erillistä
menetyshyväksyntää, jos toimivaa kopiota ei ole. Ilman kopiota lopullisesti
poistettua aineistoa ei luvata palautettavaksi.

Poistuvat kohdeyrityksen tietokanta, laskut ja Ekyn sisäiset PDF:t,
muutos- ja tapahtumahistoria, tallennettu SMTP-salasana sekä yrityksen omat
palautuspisteet ja todistetusti sille kuuluvat palautusjäännökset.
Muiden yritysten tiedot, itse tallennetut varmuuskopiot, ulkoiset PDF-kopiot
ja tekniset virhelokit säilyvät. Eky ei tee poistossa piilovarmuuskopiota.

- Peruminen on mahdollista ennen lopullista vahvistusta. Jos valmistelu
  on jo sulkenut yhteydet, paluu tehdään hallitulla käyttäjän valinnalla.
- Pysyvän poiston alettua sitä ei peruta lomakkeesta. Älä käynnistä
  rinnakkaista poistoa, vaikka valmistuminen kestää.
- Aktiivisen tai viimeisen yrityksen poiston jälkeen avautuu yritysvalinta.
  Toista tai oletusyritystä ei avata automaattisesti. Tyhjästä valitsimesta
  voi luoda yrityksen tai tuoda varmuuskopion.
- Rajatun **Yrityksen palautushallinta** -tilan onnistunut poisto näyttää
  tuloksen; sulje Eky itse. Se ei ole tavallinen avoin yritys eikä lupa
  käyttää muita yritystoimintoja.
- Epävarmaa lopputulosta ei päätellä valmiiksi tai peruuntuneeksi. Älä aloita
  uutta poistoa tässä ajossa. Sulje koko Eky tavallisesti ja avaa se uudelleen.
  Keskeytysjatko tarkistaa ensin kohteen ja omistajuuden; epäselvä tila voi
  jäädä tukea varten suljetuksi. Jos sulku tai avaus epäonnistuu, ota yhteys
  tukeen äläkä pakkopysäytä prosesseja tai poista palautumisen tiedostoja.

## Päivitykset ja diagnostiikka

**Oma yritys → Sovellus ja päivitykset** käyttää hyväksyttyä paikallista
pakettia ja manifestia. Ensin voidaan tarvita täsmälleen nykyinen
palautuspaketti. Sen rekisteröinti ei ole saman version uudelleenasennus.
Tavalliseksi päivitykseksi tarvitaan nykyistä uudempi hyväksytty versio;
sama versio ja downgrade torjutaan. **Päivityspaketti ei ole uudempi**
kertoo, ettei sovellusversio tai asennuspaketin versio kasva. Valitse
uudemman Eky-version paketti. Ilmoitus ei todista paketin eheyttä eikä
sitä, että käytössäsi olisi uusin julkaisu. Muu yleinen pakettivirhe ei
osoita, että syynä olisi juuri versionumero.

Käytä sovittua hallittua toimituskanavaa ja vahvista päivitys itse.
Asennuspaketti päivittää koko sovelluksen, ei vain avointa yritystä.
Yritysten tietokannat tarkistetaan ja tarvittaessa muunnetaan niiden
turvallisilla avauspoluilla. Yhden yrityksen avaus ei todista kaikkien
muiden yritysten käyttövalmiutta.

**Diagnostiikka** näyttää turvalliset tekniset tapahtumat ja erillisen
järjestelmäyhteenvedon. **Vanhemmat**, **Uudemmat** ja **Uusimmat** selaavat
rajattua aineistoa. Osittainen, kesken oleva tai rajoittunut haku ei ole
koko historian terveystodistus. Lokituksen häiriöpalkki tarkoittaa, että
tapahtumia voi puuttua; se ei itsessään todista laskutuksen epäonnistumista.

## Lyhyt Tukiohje

| Tilanne | Turvallinen seuraava toimi |
| --- | --- |
| Pakollinen tieto, nimiristiriita tai muu odotettu esto | Korjaa nimetty tieto. Älä kierrä estoa tietokantaa tai tiedostoja muokkaamalla. |
| Tietojen luku epäonnistui | Säilytä näkyvät tiedot. Käytä näkymän käsin tehtävää uudelleenlukua; älä tallenna virheestä pääteltyjä tyhjiä arvoja. |
| Peruit tiedostovalinnan tai vahvistuksen | Peruminen ei ole onnistuminen. Jo alkanutta pysyvää operaatiota ei oleteta perutuksi ikkunan sulkemisesta. |
| Lähetys jäi epävarmaksi | Älä lähetä uudelleen sokkona. Tarkista toimitushistoria ja varmista vastaanottajalta toimituksen tila. |
| Salasanan muutos tai sen tapahtumamerkintä jäi epävarmaksi | Älä toista muutosta tässä ajossa. Sulje koko Eky tavallisesti ja avaa uudelleen ennen tilan tarkistamista; epäonnistunut sulku/avaus vaatii tukea. Tilaluku ei ratkaise vanhaa lopputulosta. |
| Poisto, palautus tai päivitys vaatii palautumista | Lopeta kyseinen toiminto, säilytä aineisto ja noudata näytettyä ohjetta. Älä poista yrityskansiota, journalia tai palautuspistettä käsin. |
| Lokitus tai lokien luku on osittainen | Kirjaa ilmoitus. Puuttuva loki ei tarkoita, ettei virhettä tapahtunut. |

Kirjaa tukea varten näkyvä turvallinen virhekoodi tai ilmoitus, ajankohta,
sovellusversio, tekemäsi toiminto ja se, mitä varmasti valmistui. Älä liitä
salasanoja, asiakas- tai laskutietoja, tietokantaa tai raakaa kutsupinoa
julkiseen issueen tai viestiin.

Jos käytettävissä, valitse **Luo tukipaketti**, lue sisältö-/tietosuojayhteenveto
ja tallenna tiedosto natiivissa tallennusikkunassa. Avoimen yrityksen täysi
paketti ja yritysvalinnan tai varhaisen virheen rajattu desktop-paketti ovat
eri sisältöjä. Rajattu paketti ei sisällä tietokannan terveystulosta tai
koko lokihistoriaa. Jos vientiä ei tarjota tai se epäonnistuu, kerro siitä;
älä avaa toista yritystä vain paketin saamiseksi.

Tukipaketti on sanitoitu mutta **salaamaton** `.json.gz`-tiedosto, ei
varmuuskopio. Lähetä se vain sovitulla turvallisella kanavalla luotetulle
tukihenkilölle. Kehitystestien salattu virheaineisto on eri järjestelmä;
tämä vienti ei kerää alkuperäisiä raakoja poikkeuksia.

Tekniset omistajat: [yritystyötilat](../architecture/local-company-workspace-plan.md),
[Oma yritys](../modules/company-settings.md), [laskutus](../modules/invoicing.md),
[varmuuskopiointi](../architecture/local-backup-and-restore-plan.md),
[tukipaketin sisältö](../architecture/support-bundle-plan.md) ja
[päivityksen virhetilat](../architecture/windows-update-operational-runbook.md#error-code--runbook).
