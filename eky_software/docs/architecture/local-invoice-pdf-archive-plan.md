# Paikallisen toimitetun lasku-PDF:n arkistokopion suunnitelma

## Tila

Ensimmäinen rajattu local desktop -toteutus on valmis.

Invoicing application -kerros välittää onnistuneen, durableen terminal-tilaan
viimeistellyn toimituksen täsmällisen arkistointitehtävän
`DeliveredInvoiceArchiveTaskSink`-portille. Electron main omistaa konekohtaisen
asetuksen, retry-journalin, loopback-latauksen, validoinnin ja levykirjoituksen.
Renderer saa vain viisi nimettyä capability-toimintoa eikä raakaa polkua.

Julkiset HTTP-endpointit, API-responset, tietokantaskeema ja
Company Settings -master data eivät muuttuneet.

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

## Ratkaistu sisäinen sopimusraja

Julkisia toimitusvastauksia ei laajennettu dokumentin tunnisteella, hashilla
tai koolla. Renderer ei muodosta arkistotehtävää eikä päättele toimitettua
dokumenttia listajärjestyksestä.

## Toteutettu sisäinen sopimus

Kapea, Electronista riippumaton `DeliveredInvoiceArchiveTaskSink` on
Invoicing-application-portti.

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
toimitusta. Queue-vaiheen epäonnistuminen käsitellään best effort -rajalla:
se ei muuta toimituksen vastausta, delivery eventin terminal-tilaa tai
laskun `sent`-tilaa eikä estä seuraavan toimituksen arkistotehtävää.

Arkistointivirhe eristetään `queueDeliveredInvoiceArchiveTaskSafely`-rajalla:
jo onnistunut toimitus ja `sent`-tila eivät peruunnu, vaikka brokeri,
konfiguraatio, kohdekansio tai kopiointi epäonnistuisi.

Jos tehtävää ei saada annettua brokerille, backend yrittää kirjata
`invoicePdfArchive.queueFailed`-operational-eventin. Myös tämän
event-kirjoituksen virhe eristetään alkuperäisestä toimituksesta. Eventissä
saavat olla vain:

- turvallinen kiinteä `errorCode`
- `stage = queue`
- failure-outcome
- `retryable = true`
- `sideEffectState = none`
- normaali runtime- ja build-identiteetti

Eventissä ei saa olla yritys-, lasku-, toimitus-, dokumentti- tai
asiakastunnisteita, laskunumeroa, tiivistettä, polkua, sähköpostia tai raakaa
virheviestiä.

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
Ennen configin tallennusta Electron main todistaa kohteen kyvykkyyden samalla
finalisointiprimitiivillä kuin oikeassa laskukopiossa:

1. samaan kohdehakemistoon luodaan yksinoikeudella väliaikaistiedosto
2. synteettinen sisältö kirjoitetaan ja `fsync` suoritetaan
3. väliaikaistiedosto hard-linkitetään lopulliseen probe-nimeen
4. molemmat probe-tiedostot poistetaan

Open-, write-, `fsync`-, hard-link- tai cleanup-vaiheen epäonnistuminen
torjuu asetuksen tallennuksen turvallisella
`ARCHIVE_DIRECTORY_UNSUPPORTED`-virheellä. Virhe ei paljasta polkua, eikä
epäonnistuneesta valinnasta jää configia voimaan. Probe ei takaa kohteen
tulevaa saatavuutta, joten kohde revalidoidaan edelleen jokaisella
arkistointiyrityksellä.

Config kirjoitetaan oman config-store-sopimuksensa mukaisesti
väliaikaistiedoston ja atomisen rename-operaation kautta. Rikkoutunut config
ei käynnistä arkistointia.

### Tuleva multi-workspace-eristys

Nykyinen yhden työtilan config-muoto säilyy ennallaan, kunnes ADR-0011:n W4
aktivoi multi-workspace-compositionin. Sen jälkeen käyttäjän valitsema
`directoryPath` tulkitaan arkistojuureksi, ja Electron main muodostaa
varsinaisen kirjoituskohteen aina muodossa
`<archiveRoot>/<workspaceId>/`.

- renderer tai backend eivät saa muodostaa workspace-alikansiota
- `workspaceId` tulee vain mainin aktiivisesta, validoidusta rekisteristä
- config ja retry-journal ovat workspace-kohtaista device-local-tilaa
- workspace switch vaihtaa käytettävän configin ja journalin
- sama tiedostonimi eri työtiloissa ei törmää
- ulkoinen arkistojuuri, config, journal ja kopiot eivät kuulu portable
  backupiin eivätkä ole auktoritatiivisia laskuartifacteja.

Eristys todistetaan `WORKSPACE-ARCHIVE-001`-skenaariolla ennen
multi-workspace-releasea. W1:n inertti registry-toteutus ei muuta nykyistä
archive-configia tai käyttäjän valitsemaa hakemistoa.

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
`fsync`-operaatiolla ja hard-link-finalisoinnilla:

1. temp avataan `wx`-tilassa
2. PDF kirjoitetaan ja synkronoidaan levylle
3. temp hard-linkitetään lopulliseen nimeen, jolloin olemassa olevaa
   lopullista tiedostoa ei voi korvata
4. temp poistetaan

PDF-kopion finalisointia ei kuvata atomisena rename-operaationa. Hard-link-
raja säilyttää no-overwrite-invariantin myös kilpailutilanteessa.
Virheen jälkeen temp-tiedosto poistetaan best effort -periaatteella.

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
- kohdekansion exact-finalization-probe onnistumis-, read-only/open-,
  hard-link- ja katoamistilanteissa ilman tiedostojäämiä
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

Ensimmäinen toteutus kattaa configin ja journalin palautumisen, tiukan
broker-protokollan, luotetun renderer-frame-rajan, PDF:n identiteetin ja
eheyden tarkistuksen, idempotentin kopioinnin, conflict-tilan,
uudelleenyritykset, selainfallbackin sekä data-minimoidut operational eventit.
Windows-paketoinnin ja packaged smoken pitää säilyä vihreänä ennen julkaisua.

Electron development -E2E:n pysyvät arkistointiskenaariot ovat:

- `ARCHIVE-PDF-FAILURE-001`: toimitus onnistuu, mutta poistettu kohde jättää
  taskin retry-journaliin muuttamatta laskun `sent`-tilaa
- `ARCHIVE-PDF-RECOVERY-001`: restartin jälkeen palautettu kohde käsitellään
  manuaalisella retryllä ja tarkka PDF syntyy
- `ARCHIVE-PDF-CONFLICT-001`: eri sisältöinen lopullinen tiedosto säilyy
  muuttumattomana eikä conflict-taskia yritetä restartissa automaattisesti
