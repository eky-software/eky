# Paikallisen toimitetun lasku-PDF:n arkistokopion suunnitelma

## Tila

Suunnitelma on hyväksyntää odottavassa toteutusportissa.

Nykyinen delivery-rajapinta ei vielä välitä Electron main -prosessille
kaikkia täsmällisen arkistointitehtävän muodostamiseen tarvittavia tietoja.
Toteutusta ei saa jatkaa renderer-oletuksella, uusimman tapahtuman
arvaamisella tai raakaa paikallista polkua kuljettavalla API-sopimuksella.

## Tavoite

Eky Desktop voi käyttäjän valinnasta tallentaa onnistuneesti toimitetun
laskun täsmällisestä PDF-dokumentista ylimääräisen kopion käyttäjän
valitsemaan paikalliseen kansioon.

Ominaisuus on:

- valinnainen
- desktop-only
- konekohtainen
- paikallinen käyttömukavuustoiminto
- erillinen Eky-varmuuskopioinnista

Selainversio toimii ilman tätä capabilitya. Ominaisuus ei muuta laskun
liiketoimintatilaa, PDF-snapshotia, delivery eventiä tai sisäistä
dokumenttivarastoa.

## Omistajuus ja rajat

Invoicing omistaa toimituksen onnistumisen, delivery eventin,
laskuidentiteetin ja toimitetun PDF-dokumentin identiteetin.

Electron main omistaa:

- native-kansionvalintadialogin
- konekohtaisen arkistoasetuksen
- valitun raakapolun
- paikallisen retry-journalin
- PDF-tiedoston validoinnin ja atomisen kopioinnin
- arkistokansion avaamisen

Arkistopolku:

- ei ole Company Settings -master dataa
- ei mene SQLiteen
- ei mene API-vastaukseen
- ei mene rendereriin
- ei mene pilvisynkronointiin
- ei mene lokiin tai tukipakettiin

Sisäinen invoice document storage on edelleen lasku-PDF:n auktoritatiivinen
säilytyspaikka. Käyttäjän valitsema kansio ei korvaa Backup/Restorea.

## Toimituskelpoiset tapahtumat

Arkistotehtävä voidaan muodostaa vain backendin durableen terminal-tilaan
viimeistelemästä toimituksesta.

Ensimmäisessä versiossa arkistoidaan:

- oikean SMTP-asiakaslähetyksen `succeeded`-tapahtuma
- manuaalisen toimituksen `succeeded`-tapahtuma
- tulostustoimituksen `succeeded`-tapahtuma, kun nykyistä
  `deliveryMethod = print` -backendpolkua käytetään

Nykyinen web-UI käyttää manuaalisessa toiminnossa arvoa `manual`.
`print` on backendin nykyisessä sopimuksessa tuettu erillinen toimitustapa,
mutta sitä ei päätellä PDF:n avaamisesta tai selaimen tulostuspainikkeesta.

Arkistointia ei käynnistetä:

- PDF:n esikatselusta tai avaamisesta
- dry-runista
- SMTP-testistä
- `prepared`- tai `attempted`-tilasta
- epäonnistuneesta toimituksesta
- `outcomeUnknown`-tilasta
- peruutetusta käyttäjävahvistuksesta
- pelkästä HTTP 200 -vastauksesta

Uudelleenlähetys samasta dokumentista on idempotentti. Historiallisia
laskuja ei kopioida automaattisesti ensimmäisessä versiossa.

## Havaittu sopimusaukko

Nykyinen oikean SMTP-lähetyksen typed response sisältää
`deliveryEventId`:n ja laskun read modelin, mutta ei toimitetun dokumentin
`documentId`-, SHA-256- tai size-identiteettiä.

Nykyinen manuaalisen ja tulostustoimituksen response sisältää vain
päivitetyn laskun. Delivery eventin tunniste luodaan application-palvelussa
eikä sitä palauteta kutsujalle.

Delivery event -listauksen julkinen summary ei sisällä dokumentin
identiteettiä. Uusimman tapahtuman valitseminen ajan tai listajärjestyksen
perusteella olisi kilpailutilanteille altis eikä todistaisi, että arkistoitava
PDF on juuri toimitettu dokumentti.

Tämän vuoksi renderer ei voi turvallisesti muodostaa arkistotehtävää
nykyisistä julkisista vastauksista.

## Suositeltu sisäinen sopimus

Suositeltu jatkoratkaisu on kapea, Electronista riippumaton
`DeliveredInvoiceArchiveTaskSink`-tyyppinen Invoicing-application-portti.

Käyttötapaus kutsuu porttia vasta, kun:

1. delivery event on tallennettu terminal `succeeded` -tilaan
2. laskun `sent`-tilasiirtymä on durable
3. toimitetun dokumentin identiteetti on tiedossa

Portin turvallinen payload sisältää vain:

- delivery event id
- invoice id
- document id
- odotettu PDF SHA-256
- odotettu PDF-koko
- laskunumero
- laskulaji
- tapahtuma-aika

Paikallisessa Electron-ajossa portin infrastructure-adapteri käyttää
yksityistä, validoitua utility process -> Electron main -brokeria. Main
kirjoittaa journal-taskin ennen kuittausta. Selain- ja tavallisessa
backend-kehitysajossa käytetään no-op-adapteria.

Portti ei tunne:

- paikallista tiedostopolkua
- Electronia
- rendereriä
- Company Settings -master dataa
- PDF-tiedoston lopullista arkistonimeä

Arkistointivirhe tai brokerin poissaolo ei saa perua jo onnistunutta
toimitusta. Virhe palautetaan vain turvallisena teknisenä tuloksena, jonka
desktop-UI voi näyttää varoituksena.

Tämä ratkaisu säilyttää nykyiset HTTP-endpointit ja API-responset. Se vaatii
projektin omistajan hyväksynnän uutena backendin ja desktop-runtimen
sisäisenä porttina ennen toteutusta.

## Paikallinen config

Config tallennetaan Electronin `userData`-alueelle:

`runtime/settings/invoice-pdf-archive-v1.json`

Muoto:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "directoryPath": "C:\\Users\\...\\Laskuarkisto"
}
```

Config luetaan strict-parserilla. Tuntemattomat kentät, väärä
schema-versio, suhteellinen polku, puuttuva kansio ja tiedostoksi muuttunut
kohde torjutaan turvallisesti.

Polku hyväksytään vain Electron mainin native `showOpenDialog` -valinnasta.
Config kirjoitetaan temp-tiedoston ja atomisen rename-operaation kautta.
Rikkoutunut config ei käynnistä arkistointia.

Tavalliset käyttäjän valitsemat paikalliset kansiot, OneDrive-kansiot,
removable drive -kohteet sekä Windowsin junction/reparse-kohteet sallitaan
ensimmäisessä versiossa. Kohde revalidoidaan ennen jokaista kirjoitusta.
Eky ei lupaa verkko- tai pilvikansion saatavuutta eikä seuraa kohdetta
automaattisesti. Renderer ei saa päätellä tai muuttaa kohdepolkua.

## Durable retry-journal

Journal tallennetaan:

`runtime/archive/invoice-pdf-archive-journal-v1.json`

Task sisältää vain:

- schema version
- task id
- delivery event id
- invoice id
- document id
- odotettu PDF SHA-256
- odotettu PDF-koko
- laskunumero
- laskulaji
- luontiaika
- yrityskertojen määrä
- seuraava sallittu yritysaika
- viimeisin turvallinen virhekoodi

Journal ei sisällä asiakas- tai yhteystietoja, IBANia, sähköpostisisältöä,
PDF-bytes-dataa, SMTP-dataa tai valittua kansiopolkua. Journal kirjoitetaan
atomisesti.

Startup retry on rajattu, käyttää backoffia eikä muodosta busy-loopia.
Conflict jää käyttäjälle näkyväksi eikä sitä yritetä automaattisesti
loputtomasti.

## Täsmällisen PDF:n validointi

Main hakee nykyisestä loopback-backendistä runtime-sessionilla:

1. dokumentin metadatan
2. PDF-bytes-datan

Se validoi ennen kirjoitusta:

- invoice id / document id -sidoksen
- MIME-tyypin `application/pdf`
- PDF-signatuurin
- koon
- SHA-256-tiivisteen
- nykyiset PDF-kokorajat

PDF:ää ei regeneroida arkistointia varten.

Tiedostonimi muodostetaan vain validoidusta laskunumerosta ja laskulajista:

- `Lasku-<invoiceNumber>.pdf`
- `Hyvityslasku-<invoiceNumber>.pdf`

Asiakkaan nimeä, aihetta tai vapaata tekstiä ei käytetä tiedostonimessä.

Kirjoitus tehdään samaan kohdekansioon exclusive temp-tiedostolla,
`fsync`-operaatiolla ja atomisella rename-operaatiolla. Virheen jälkeen
temp-tiedosto poistetaan.

Jos lopullinen tiedosto on jo olemassa:

- sama koko ja SHA-256 on idempotentti onnistuminen
- eri sisältö on conflict
- tiedostoa ei ylikirjoiteta eikä nimetä automaattisesti uudelleen

## Renderer- ja preload-raja

Preload saa tarjota vain nimetyt capabilityt:

- `getInvoicePdfArchiveStatus()`
- `chooseInvoicePdfArchiveDirectory()`
- `openInvoicePdfArchiveDirectory()`
- `disableInvoicePdfArchive()`
- `retryPendingInvoicePdfArchiveTasks()`

Renderer ei saa:

- raakaa polkua
- tiedostojärjestelmäobjektia
- yleistä IPC- tai Node-rajapintaa
- omaa `shell.openPath`-parametria
- yksittäisen mielivaltaisen taskin retry-toimintoa

Julkinen status sisältää vain:

- enabled
- turvallinen kansion näyttönimi
- odottavien taskien määrä
- viimeisin onnistunut kopiointiaika
- viimeisin turvallinen virhekoodi

Kun capability puuttuu selainajossa, Oma yritys -näkymä kertoo korkeintaan,
että ominaisuus on käytettävissä Eky-työpöytäsovelluksessa.

## Virhe- ja lokisäännöt

Arkistointivirhe ei muuta toimituksen tulosta tai laskun `sent`-tilaa.

Käyttäjälle näytetään turvallinen viesti:

> Lasku toimitettiin onnistuneesti, mutta paikallista PDF-kopiota ei voitu
> tallentaa. Voit yrittää arkistointia uudelleen Oma yritys -näkymässä.

Operational eventit voivat sisältää vain turvallisen virhekoodin, vaiheen,
keston, yrityskerran, runtime instance id:n ja outcome-arvon.

Lokissa tai tukipaketissa ei saa olla:

- raakaa polkua
- laskunumeroa tai invoice/document id:tä
- PDF-tiivistettä
- asiakasta tai sähköpostia
- PDF-bytes-dataa
- request/response-dumppia

Tavallista kopiointionnistumista ei lisätä Activityyn, koska se on
paikallinen tekninen toiminto eikä laskun liiketoimintatila.

## Testausportti

Toteutuksen pitää kattaa vähintään:

- configin ja journalin strict parsing sekä atomiset kirjoitukset
- kansion native-valinta, peruutus ja katoaminen valinnan jälkeen
- preload/IPC deny-by-default -raja
- web ilman capabilitya
- SMTP-, manual- ja print-success
- dry-run-, SMTP-test-, failed-, attempted- ja outcomeUnknown-estot
- tarkka PDF-binding, koko, SHA-256, signature ja MIME
- standardi- ja hyvityslaskun turvallinen tiedostonimi
- idempotentti uudelleenlähetys
- eri sisältöä sisältävän tiedoston conflict ilman ylikirjoitusta
- restartista selviävä pending task ja rajattu retry
- loki- ja tukipakettiredaction
- Electron E2E, packaged smoke ja rajattu endurance

Testit käyttävät vain synteettisiä PDF:iä, temp-kansioita ja loopbackia.
Oikeaa SMTP-verkkotestiä tai asiakasdataa ei käytetä.

