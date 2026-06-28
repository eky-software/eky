# Laskutuksen UI-roadmap

Tämä dokumentti vaiheistaa Eky-laskutuksen ensimmäisen web-käyttöliittymän.

Tavoitteena on rakentaa manuaalisen laskutuksen käyttöliittymä pieninä,
testattavina vaiheina olemassa olevan Invoicing-domainin, backend-reittien ja
`packages/api-client`-rajapinnan päälle.

## Classic-periaate

Ensimmäinen laskutusnäkymä on Classic-työpinta.

Classic tarkoittaa:

- yksinkertaista ja ennakoitavaa työjärjestystä
- tiivistä mutta luettavaa tietoesitystä
- taulukko- ja lomakepainotteista käyttöä
- tärkeiden toimintojen löytymistä ilman ylimääräisiä näkymiä
- laskun perustietojen, rivien ja summien selkeää erottelua

Vanhoista suomalaisista taloushallinto-ohjelmista, kuten Passelista, voidaan
ottaa inspiraatiota työnkulun selkeyteen ja käytännöllisyyteen. Eky ei kopioi
toisen ohjelman brändiä, värejä, kuvakkeita, tarkkaa sommittelua tai
visuaalista toteutusta.

Eky säilyttää oman modernin, rauhallisen ja sinivalkoisen työohjelmalinjansa.

## Vaihe 1: runko ja laskuluonnoslista

Tila: laskuluonnoslista näyttää luonnoksen aiheen tai fallbackin sekä asiakkaan
asiakasnumeron ja nimen, kun asiakas löytyy ladatusta asiakaslistasta. Teknisiä
draft- tai customer-id-arvoja ei käytetä pääasiallisena käyttöliittymätekstinä.
Luonnoksen voi poistaa rivikohtaisella toiminnolla vasta erillisen
vahvistuksen jälkeen. Aktiivisen Laskutus-valikon uusi painallus palauttaa
laskutustyötilan luonnoslistaan; lomakkeen Takaisin luonnoksiin -toiminto
säilyy rinnalla.

- aktivoi Laskutus sivupalkissa
- lisää laskutusnäkymän työpintarunko
- lataa luonnosyhteenvedot `listInvoiceDrafts`-kutsulla
- näytä loading-, empty- ja turvallinen error-tila
- näytä luonnokset tiiviissä taulukossa
- poista vain `draft`-tilainen luonnos turvallisen vahvistuksen kautta
- näytä “Uusi lasku” seuraavan vaiheen toimintona, mutta älä avaa lomaketta

Lista näyttää vain API-clientin yhteenvetotiedot. Se ei laske summia eikä hae
Customers-moduulin tietoja oikopolkuna.

## Vaihe 2: uuden laskun lomakkeen perusrakenne

Tila: toteutettu lomakerunkona.

- avaa uuden laskun Classic-työpinta
- lisää laskun perustietojen osio
- lisää asiakasvalinnan paikka
- lisää laskurivitaulukon runko
- lisää summien yhteenvetoalue

Tässä vaiheessa lomakkeen rakenne erotetaan pieniin Invoicing-featuren
komponentteihin. Yleistä lomakeframeworkia ei rakenneta.

## Vaihe 3: laskurivien hallinta

Tila: paikallinen rivieditorin runko toteutettu. Käyttäjä voi lisätä, poistaa
ja muokata rivejä. Tallennusmuunnokset ja kevyt summien esikatselu on
toteutettu. Esikatselu käyttää senttejä ja kokonaislukuja käyttäjän avuksi,
mutta backend säilyy auktoritatiivisena laskijana. Rivien järjestäminen tehdään
myöhemmin rajattuna vaiheena.

- lisää, poista ja järjestä laskurivejä
- käsittele määrä, yksikkö, yksikköhinta, ALV ja alennus
- näytä backendin laskentaa vastaava esikatselu käyttökokemuksen apuna
- pidä backend auktoritatiivisena laskennan lähteenä

## Vaihe 4: asiakkaan valinta ja oletusarvot

Tila: asiakasvalinta ja tuntihinnan pikavalinta on toteutettu. Valitun
asiakkaan asiakaskortin tiedot näytetään laskulomakkeella tiiviinä koosteena.
Käyttäjän Company Settingsiin määrittämä nimike voi ehdottaa riville kerran
asiakaskohtaisen tuntihinnan tai sen puuttuessa oman yrityksen
oletustuntihinnan. Käsin muokattua tai tallennetusta luonnoksesta ladattua
hintaa ei ylikirjoiteta.

- valitse asiakas hallitun API-sopimuksen kautta
- ehdota asiakkaan tyypin mukaista `priceInputMode`-arvoa
- ehdota oman yrityksen ja asiakkaan hinnoitteluasetuksia
- pidä automaattinen hinta vain muokattavana UI-oletuksena; laskuriville
  tallennetaan eksplisiittinen yksikköhinta
- älä kopioi Customers- tai Company Settings -moduulien omistamaa logiikkaa
  Invoicing-UI:hin

## Vaihe 5: luonnoksen tallennus

Tila: uuden laskun lomake käyttää paikallista validointia ja mappingia,
kutsuu `createInvoiceDraft`-metodia ja näyttää turvallisen onnistumis- tai
virhetilan. Backend säilyy laskennan ja lopullisen validoinnin auktoriteettina.
Luonnoksen avaaminen ja muokkaus tehdään vaiheessa 6.

- kutsu `createInvoiceDraft`
- näytä backendin validoimat ja laskemat tulokset
- käsittele tallennusvirheet turvallisesti featuren sisällä
- estä palvelimen omistamien kenttien lähettäminen

## Vaihe 6: luonnoksen avaaminen ja muokkaus

Tila: laskuluonnoksen avaaminen ja muokkaaminen on toteutettu web-UI:ssa.
Lista avaa luonnoksen `getInvoiceDraft`-kutsulla, lomake täytetään tallennetusta
datasta ja muokkaus tallennetaan `updateInvoiceDraft`-kutsulla. Uuden
luonnoksen luonti käyttää edelleen `createInvoiceDraft`-kutsua.
Autosave toteutetaan rauhallisena taustatoimintona. Uuden laskun kohdalla
autosave saa muodostaa ensimmäisen laskuluonnoksen vasta, kun pakolliset kentät
ja vähintään yksi rivi ovat kelvollisia saman validointimallin mukaan kuin
käsin tallennuksessa.
Onnistuneen ensimmäisen automaattitallennuksen jälkeen UI siirtyy edit-tilaan
ja jatkotallennukset käyttävät `updateInvoiceDraft`-polkua.

- avaa luonnos `getInvoiceDraft`-kutsulla
- täytä muokkausnäkymä tallennetulla datalla
- tallenna muutokset `updateInvoiceDraft`-kutsulla
- tee ensimmäinen taustatallennus uudelle laskulle vasta, kun lomake on
  tallennuskelpoinen
- tee jatkossa taustatallennus olemassa olevalle luonnokselle
- näytä autosave-tila rauhallisena tilaviestinä
- säilytä draft-tilan ja yritysrajauksen backend-säännöt auktoritatiivisina

### Autosave-Periaate

Autosave on vain käyttökokemusta parantava web-UI-toiminto. Se ei ole uusi
laskutuksen domain-sääntö eikä se saa ohittaa backendin validointia,
yritysrajausta tai draft-tilan sääntöjä.

Autosave toimii kahdessa rajatussa vaiheessa:

- uudessa laskussa autosave odottaa, että pakolliset kentät ja rivit ovat
  kelvollisia
- vasta kelvollinen uusi lasku saa laukaista `createInvoiceDraft`-kutsun
- onnistuneen ensimmäisen create-tallennuksen jälkeen UI siirtyy edit-tilaan
  ja saa draft-id:n
- tämän jälkeen autosave käyttää vain `updateInvoiceDraft`-kutsua
- autosave validoi lomaketilan ennen tallennusyritystä
- virheellinen lomaketila ei laukaise create- eikä update-kutsua
- käyttäjälle näytetään vain rauhallinen tilaviesti, ei aggressiivisia
  kenttävirheitä autosaven takia
- vanha autosave-vastaus ei saa ylikirjoittaa uudempaa lomaketilaa tai
  tallennustilaa

Manuaalinen “Tallenna muutokset” säilyy käytössä autosavesta huolimatta.

## Vaihe 7: laskuluonnoksen hyväksyntä

Tila: hyväksyntätoiminnon ensimmäinen web-UI-vaihe näyttää käyttäjälle
tietoisen vahvistuksen ennen hyväksyntää. Hyväksyntä käyttää backendin
`approveInvoiceDraft`-polkua ja näyttää onnistumisen jälkeen backendin
palauttaman laskunumeron ja viitenumeron.

- näytä hyväksyntätoiminto vain tallennetulle ja avatulle laskuluonnokselle
- edellytä, että muutokset on tallennettu ennen hyväksyntää
- varmista hyväksyntä erillisellä vahvistusalueella
- kutsu hyväksyntää vain API-clientin kautta
- näytä laskunumero ja viitenumero backendin palauttamasta tuloksesta
- siirrä hyväksynnän jälkeen käyttäjä pois luonnoksen muokkaamisesta
- jätä hyväksytyn laskun varsinainen katselu-, lähetys- ja printtinäkymä
  myöhemmäksi

UI ei muodosta laskunumeroa, viitenumeroa, snapshotteja eikä
hyväksyntäpäivää. Ne ovat backendin vastuulla.

## Vaihe 8: viimeistely

- viimeistele Classic-työnkulun näppäimistökäyttö ja saavutettavuus
- yhtenäistä turvalliset virheilmoitukset
- täydennä suomenkieliset i18n-tekstit
- arvioi React Error Boundary odottamattomille renderöintivirheille
- tarkista responsiivisuus ilman desktop-työpinnan heikentämistä

## Rajat

Roadmap ei vielä sisällä:

- hyväksytyn laskun varsinaista katselunäkymää
- PDF:ää
- sähköpostia
- verkkolaskua
- työmääräykseltä tai materiaalikirjauksista tuontia
- uutta UI-, lomake-, datahaku- tai virheenkäsittelykirjastoa

Erillinen laskun maksaja toteutetaan myöhemmin omana kokonaisuutenaan.
Mahdollinen sopimus on `payerCustomerId`, mutta ominaisuus vaatii erilliset
tietomalli-, backend-, API-client- ja UI-päätökset. Sitä ei liitetä
laskurivieditorin paikalliseen lomaketilaan.

Jokainen vaihe toteutetaan omana rajattuna muutoksenaan. UI ei tee raakaa
`fetch`-kutsua, auktoritatiivista laskentaa tai backendin käyttöoikeuspäätöksiä.
