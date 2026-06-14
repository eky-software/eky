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

- aktivoi Laskutus sivupalkissa
- lisää laskutusnäkymän työpintarunko
- lataa luonnosyhteenvedot `listInvoiceDrafts`-kutsulla
- näytä loading-, empty- ja turvallinen error-tila
- näytä luonnokset tiiviissä taulukossa
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

- lisää, poista ja järjestä laskurivejä
- käsittele määrä, yksikkö, yksikköhinta, ALV ja alennus
- näytä backendin laskentaa vastaava esikatselu käyttökokemuksen apuna
- pidä backend auktoritatiivisena laskennan lähteenä

## Vaihe 4: asiakkaan valinta ja oletusarvot

Tila: asiakasvalinnan perusrakenne toteutettu. Asiakastyypin ja hinnoittelun
oletusarvot toteutetaan myöhemmin tämän vaiheen jatkona. Valitun asiakkaan
asiakaskortin tiedot näytetään laskulomakkeella tiiviinä koosteena ilman
uutta API-kutsua.

- valitse asiakas hallitun API-sopimuksen kautta
- ehdota asiakkaan tyypin mukaista `priceInputMode`-arvoa
- ehdota oman yrityksen ja asiakkaan hinnoitteluasetuksia
- älä kopioi Customers- tai Company Settings -moduulien omistamaa logiikkaa
  Invoicing-UI:hin

## Vaihe 5: luonnoksen tallennus

- kutsu `createInvoiceDraft`
- näytä backendin validoimat ja laskemat tulokset
- käsittele tallennusvirheet turvallisesti featuren sisällä
- estä palvelimen omistamien kenttien lähettäminen

## Vaihe 6: luonnoksen avaaminen ja muokkaus

- avaa luonnos `getInvoiceDraft`-kutsulla
- täytä muokkausnäkymä tallennetulla datalla
- tallenna muutokset `updateInvoiceDraft`-kutsulla
- säilytä draft-tilan ja yritysrajauksen backend-säännöt auktoritatiivisina

## Vaihe 7: viimeistely

- viimeistele Classic-työnkulun näppäimistökäyttö ja saavutettavuus
- yhtenäistä turvalliset virheilmoitukset
- täydennä suomenkieliset i18n-tekstit
- arvioi React Error Boundary odottamattomille renderöintivirheille
- tarkista responsiivisuus ilman desktop-työpinnan heikentämistä

## Rajat

Roadmap ei vielä sisällä:

- laskun hyväksyntää
- laskunumerointia
- snapshot-lukitusta
- PDF:ää
- sähköpostia
- verkkolaskua
- työmääräykseltä tai materiaalikirjauksista tuontia
- uutta UI-, lomake-, datahaku- tai virheenkäsittelykirjastoa

Jokainen vaihe toteutetaan omana rajattuna muutoksenaan. UI ei tee raakaa
`fetch`-kutsua, auktoritatiivista laskentaa tai backendin käyttöoikeuspäätöksiä.
