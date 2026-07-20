# Invoice Delivery Plan

Tämä dokumentti määrittää hyväksytyn laskun toimitusputken suunnittelulinjan:
tulostus, sähköposti, `sent`-tila, laskun kopiointi, peruutus ja
hyvityslaskut.

Dokumentti toimii suunnitelmana ja toteutuneen local-MVP-toimituspolun
rajauksena.

Sähköpostilähetyksen provider-malli, dry-run-vaihe, SMTP/Gmail-linja ja
salaisuuksien hallinta on tarkennettu dokumentissa
`docs/architecture/email-delivery-and-secrets-plan.md`.

Laskun toimitustapahtumien, lähetyslokin ja tulevan send-polun tarkempi
delivery event -suunnitelma on dokumentissa
`docs/architecture/invoice-delivery-events-plan.md`.

Toteutustilanne:

- hyväksytyn laskun PDF voidaan muodostaa ja avata selaimessa
- `approved`-lasku voidaan merkitä rajatulla tavalla tulostetuksi tai muuten
  käsin toimitetuksi vasta, kun backendin application service on varmistanut
  tai muodostanut laskun PDF:n onnistuneesti; delivery event, audit-tapahtuma
  ja `sent`-siirtymä tallennetaan samassa SQLite-transaktiossa
- `sent`-lasku näkyy laskutuksen omassa Lähetetyt-osiossa
- hyväksytty tai lähetetty lasku voidaan kopioida uudeksi laskuluonnokseksi
- hyväksytylle laskulle voidaan valmistella kuivaharjoittelusähköposti ja tehdä
  hallittu DNA SMTP -testilähetys vain Oma yritys -asetusten pakotettuun
  testivastaanottajaan
- SMTP-testilähetys kirjaa delivery eventin mutta ei muuta laskua
  `sent`-tilaan
- asiakaslähetys käyttää erillistä Electronissa vahvistettavaa prepare/send-
  polkua, varmistaa current PDF:n backendissä ja kirjaa delivery eventin ennen
  SMTP-kutsua
- varmasti onnistunut asiakaslähetys viimeistelee delivery eventin ja laskun
  `sent`-tilan samassa SQLite-transaktiossa
- epäonnistunut tai lopputulokseltaan epäselvä lähetys ei muuta laskun tilaa
- yritys- ja laskurajattu ratkaisematon `attempted`- tai `outcomeUnknown`-
  tapahtuma estää uuden tavallisen asiakaslähetyksen valmistelun, kunnes tilanne
  on ratkaistu erillisellä myöhemmällä hallintapolulla
- `sent`-laskun uudelleenlähetys kirjaa uuden tapahtuman muuttamatta laskun
  numeroa, viitenumeroa, sisältöä tai tilaa

## Peruspolku

Nykyinen ja tuleva laskun toimitusketju:

```text
InvoiceDraft
  -> ApprovedInvoice snapshot
    -> PDF document
      -> delivery action
        -> sent status vain varmasta onnistumisesta
```

PDF:n luonti ei tarkoita laskun lähettämistä.

PDF on toimitettava dokumentti, jota voidaan käyttää:

- selaimessa avaamiseen
- tulostamiseen
- sähköpostin liitteenä
- myöhemmin muissa toimitustavoissa

Hyväksytyn laskun PDF muodostetaan hyväksytyn laskun snapshot-datasta.
Toimituspolku ei saa hakea muuttuvaa Customer- tai Company Settings -master
dataa laskun sisältöä varten.

## Tulostus

Ensimmäinen MVP-tulostus pidetään yksinkertaisena:

- avataan hyväksytyn laskun PDF selaimeen
- käyttäjä tulostaa selaimen tai käyttöjärjestelmän tulostustoiminnolla

Suoraa tulostinohjausta ei toteuteta ensimmäiseen MVP-toimituspolkuun.

Suora tulostinohjaus voi myöhemmin vaatia:

- erillisen local helper -sovelluksen
- käyttöjärjestelmäkohtaisen adapterin
- oikeuksien ja laitevalinnan erillisen suunnittelun
- virhetilojen ja tulostusjonon hallinnan

Tulostus ei saa automaattisesti merkitä laskua lähetetyksi ilman erillistä
käyttäjän toimintoa tai myöhemmin määriteltyä audit-polkuun kuuluvaa sääntöä.

## Sähköposti Yleisesti

Sähköpostilähetys tehdään backendin hallitun business-toiminnon kautta.

Tämä dokumentti kuvaa toimitusputken laskutuksen näkökulmasta. Teknisen
sähköpostiproviderin, salaisuuksien ja dry-run-toteutuksen tarkemmat säännöt
ovat dokumentissa `docs/architecture/email-delivery-and-secrets-plan.md`.

Provider-portti pitää teknisen kuljetuksen erossa Invoicingin
liiketoimintapäätöksistä. Nykyinen ensimmäinen adapteri on DNA SMTP.

```ts
interface EmailDeliveryProvider {
  sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<EmailDeliveryResult>;
}
```

Mahdollisia adaptereita:

- `SmtpEmailDeliveryProvider`
- `GmailEmailDeliveryProvider`
- `MicrosoftGraphEmailDeliveryProvider`
- `FakeEmailDeliveryProvider`
- `DryRunEmailDeliveryProvider`

`webmail.dna.fi` on käyttöliittymä, ei integraatiorajapinta.

Tavoite ei ole luopua automaattisesta sähköpostilähetyksestä. Tavoite on tehdä
automaattinen lähetys turvallisesti backendin SMTP/Gmail/Microsoft-providerin
kautta, ei webmail-käyttöliittymää klikkailemalla.

Eky ei saa toteuttaa:

- webmailin selainautomaatiota
- scrapingia
- epävirallista webmail-ohjausta
- käyttäjän sähköpostisalasanan tallentamista frontendissä
- sähköpostin lähettämistä suoraan selaimesta ilman backendin hallittua
  toimituspolkua

Sähköpostin lähetys kuuluu backendin business-toiminnoksi, joka tarkistaa
laskun tilan, PDF:n olemassaolon, vastaanottajan osoitteen ja turvallisuusrajat.

## DNA-sähköpostin Suunnittelutiedot

Alla olevat DNA / dnamail -asetukset ovat alustavia käyttäjän toimittamia
suunnittelutietoja. Ne pitää tarkistaa ennen tuotantototeutusta DNA:n
ajantasaisista ohjeista ja yrityksen sähköpostitilin asetuksista.

Saapuva posti, POP3:

- suositeltu palvelin: `mail.dnamail.fi`
- vaihtoehdot:
  - `pop3.welho.com`
  - `mail.dnainternet.net`
- SSL-portti: `995`

Saapuva posti, IMAP:

- suositeltu palvelin: `mail.dnamail.fi`
- vaihtoehdot:
  - `imap.welho.com`
  - `mail.dnainternet.net`
- SSL-portti: `993`

Lähtevä posti, SMTP:

- suositeltu palvelin: `smtp.dnamail.fi`
- muut historiassa tai erillisissä DNA-ohjeissa esiintyvät hostit eivät kuulu
  local-MVP:n automaattiseen fallbackiin; niiden mahdollinen tuki arvioidaan
  erikseen ajantasaisen tilikohtaisen ohjeen perusteella

SMTP-portit:

- portti `465`, implicit TLS heti yhteyden muodostamisesta
  - Eky local MVP:n ensisijainen malli
  - autentikointi vaaditaan
  - vähintään TLS `1.2`; TLS `1.3` sallitaan
- portti `587`, pakollinen STARTTLS
  - myöhempi erikseen toteutettava yhteensopivuusvaihtoehto
  - ei kuulu ensimmäiseen SMTP-adapteriin
- porttia `25` ei tueta Eky local MVP:ssä

Ekyssä laskujen SMTP-lähetys edellyttää salattua yhteyttä. SMTP-adapteri ei saa
lähettää laskua, jos TLS- tai STARTTLS-neuvottelu epäonnistuu, eikä se saa
hyväksyä virheellistä TLS-sertifikaattia hiljaisesti. SMTP TLS/STARTTLS on
siirtotason suojaus Eky-backendin ja sähköpostipalvelimen välillä, ei
päästä päähän -salaus.

Koska Eky voi myöhemmin ajaa pilvessä tai muualla kuin DNA:n omassa verkossa,
ei saa luottaa siihen, että SMTP toimii ilman autentikointia DNA:n verkosta.
Tuotantomallissa pitää varautua autentikoituun SMTP-lähetykseen.

Hyväksytty DNA SMTP local-MVP -linja:

- provider: `dnaSmtp`
- host: `smtp.dnamail.fi`
- port: `465`
- security: implicit TLS
- authentication: required
- username: käyttäjän koko DNA-sähköpostiosoite
- credentials: vain backend-only secret store -adapterissa; local Electron
  käyttää `safeStorage`-brokeria ja cloud-ympäristö myöhemmin Secret Manageria
- credentials eivät koskaan kuulu Git-repositorioon
- credentials eivät koskaan mene frontendille
- yhteysprofiili ei ole käyttäjän muokattavissa
- lähetys testataan ensin dry-run- tai pakotetussa test recipient override
  -tilassa

Käyttäjä hallitsee Oma yritys / Asetukset -näkymässä lähettäjän nimeä,
lähettäjän osoitetta, username-arvoa ja testivastaanottajaa. Host, portti ja
implicit TLS ovat backendin omistama kiinteä DNA-profiili. SMTP-salaisuus
asetetaan tai vaihdetaan hallitulla toiminnolla, mutta sitä ei näytetä takaisin
käyttäjälle eikä palauteta API:ssa.

IMAP/POP3 eivät ole laskun lähettämisen kannalta ensisijaisia. Niitä voidaan
tarvita myöhemmin esimerkiksi lähetettyjen viestien tarkistukseen tai
inbox-integraatioihin, mutta ensimmäinen laskun lähetys tarvitsee vain
SMTP-tyyppisen lähtevän postin ratkaisun.

## Gmail Ja Muut Sähköpostit

Gmail-liitos suunnitellaan erikseen.

Gmailia ei kovakoodata ensimmäiseksi oletukseksi. Gmailin tuleva toteutus voi
vaatia OAuth-pohjaisen integraation tai muun virallisen lähetysrajapinnan.

Gmail-tunnuksia tai salasanoja ei saa tallentaa suoraan ohjelman asetuksiin.

Sama periaate koskee myöhemmin Microsoft 365 / Outlook -liitoksia.

## Sähköpostin Turvallisuus

Oikeiden asiakaslaskujen vahinkolähetys pitää estää kehityksessä.

Tulevia suojia:

- dry-run mode
- test recipient override
- ympäristökohtainen lähetysesto
- selkeä vahvistus ennen lähetystä
- lähetysloki
- vain current PDF voidaan lähettää
- invalidated tai puuttuvaa PDF:ää ei saa lähettää
- lähetystä ei saa tehdä frontendistä suoraan ilman backendin hallittua
  business-toimintoa
- sähköpostin vastaanottaja pitää näyttää käyttäjälle ennen lähetystä
- tyhjä vastaanottajan sähköpostiosoite estää lähetyksen
- liitteen pitää olla hyväksytyn laskun current PDF

Sähköpostin salaisuudet:

- eivät kuulu Git-repositorioon
- eivät kuulu frontendille
- eivät kuulu selaimen local storageen
- eivät saa näkyä lokissa
- eivät saa palautua API-vastauksissa

Ensimmäinen toteutus tehdään mieluiten fake/dry-run-adapterilla ja vasta sen
jälkeen oikealla SMTP-adapterilla.

## Sent-tila

Ensimmäinen toteutusaskel:

- `approved`-lasku voidaan merkitä manuaalisesti lähetetyksi
- backendin `mark sent` -application service varmistaa tai muodostaa hyväksytyn
  laskun PDF:n ennen manuaalista lähetetyksi merkintää
- web voi tehdä saman PDF-varmistuksen käyttökokemuksen vuoksi, mutta se ei ole
  varsinainen liiketoimintasäännön auktoriteetti
- jos PDF:n muodostus epäonnistuu, laskua ei merkitä lähetetyksi
- toiminto ei vielä lähetä sähköpostia eikä ohjaa tulostinta
- toiminto ei vielä kirjoita erillistä `invoice_delivery_events`-lokitaulua
- `sent`-tila lukitsee laskun reopen-muokkaukselta

Perussääntö:

- `approved` = hyväksytty, mutta ei vielä lähetetty
- `sent` = toimitettu asiakkaalle

`sent`-tilaan voidaan myöhemmin siirtyä:

- onnistuneen sähköpostilähetyksen jälkeen
- käyttäjän manuaalisella "Merkitse lähetetyksi" -toiminnolla

`sent`-laskua ei saa enää reopen-muokata.

`sent`-laskun PDF:ää ei poisteta.

`sent`-laskun virhe korjataan hyvityslaskulla tai muulla erillisellä
korjauspolulla.

## Sent-laskun Uudelleenlähetys

`sent`-laskun saa lähettää uudelleen, jos vastaanottaja ei saanut laskua,
lasku meni roskapostiin tai käyttäjä haluaa toimittaa saman laskun uudestaan.

Uudelleenlähetys ei ole sama asia kuin laskun kopiointi uudeksi luonnokseksi.

Uudelleenlähetys:

- ei luo uutta laskua
- ei muuta laskunumeroa
- ei muuta viitenumeroa
- ei muuta laskun sisältöä
- käyttää samaa current PDF:ää
- ei muuta laskun `sent`-statusta, koska lasku on jo lähetetty
- kirjataan uutena delivery eventinä myöhemmin

Vastaanottajaa, otsikkoa ja viestiä voidaan ehdottaa snapshot- ja
asetustietojen perusteella. Käyttäjä saa muuttaa vastaanottajan
sähköpostiosoitetta käsin jokaisessa lähetyksessä, koska vastaanottajan
sähköposti voi olla muuttunut tai lasku voidaan haluta lähettää toiseen
osoitteeseen.

Käyttäjän vahvistus vaaditaan myös uudelleenlähetyksessä.

Tulevia audit-tapahtumia:

- `invoice.sent`
- `invoice.marked_sent_manually`
- `invoice.email_send_failed`
- `invoice.email_sent`
- `invoice.printed`
- `invoice.opened_for_print`

Tulostuksen auditointi päätetään myöhemmin erikseen. Kaikki PDF:n avaaminen ei
välttämättä tarkoita, että lasku on oikeasti tulostettu tai toimitettu.

## Laskun Kopiointi

Lähetettyä laskua ei saa muokata, mutta sen saa kopioida uudeksi
laskuluonnokseksi.

`Kopioi lasku` tarkoittaa:

- luodaan uusi `InvoiceDraft` vanhan hyväksytyn tai lähetetyn laskun pohjalta
- uusi luonnos ei peri vanhan laskun `invoiceNumber`-arvoa
- uusi luonnos ei peri vanhan laskun `referenceNumber`-arvoa
- uusi luonnos ei peri vanhan laskun PDF-dokumenttia
- uusi luonnos ei peri vanhan laskun `sent`, `paid` tai `credited` -tilaa
- hyväksynnässä syntyy uusi virallinen laskunumero ja uusi viitenumero
- uusi lasku on juridisesti eri lasku

Mitä voidaan kopioida:

- asiakas, jos `customerId` on edelleen käytettävissä samassa yrityksessä
- laskun vastaanottaja, jos `billingRecipientCustomerId` on edelleen käytettävissä
- rivit
- kuvaukset
- määrät
- yksiköt
- hinnat
- ALV-kannat
- alennukset
- aihe
- tilausnumero
- toimitus/kohde
- lisätieto

Toteutettu MVP-linja:

- `invoiceDate` = kopiointihetken päivä
- `dueDate` = lasketaan uudelleen kopiointihetken päivästä ja kopioidusta
  maksuehdosta
- maksuehto, huomautusaika ja viivästyskorko kopioidaan vanhalta laskulta
- rivit ja sisältö kopioidaan
- virallinen numero ja viite eivät kopioidu koskaan
- PDF ei kopioidu koskaan
- jos asiakas tai laskun vastaanottaja ei ole enää käytettävissä samassa
  yrityksessä, uutta luonnosta ei luoda

## Laskun Peruutus / Cancel

`draft`-laskuluonnos voidaan poistaa.

`approved` mutta ei `sent` -lasku voidaan myöhemmin merkitä `cancelled`-tilaan.

`sent`-laskua ei cancelled-muokata tai poisteta, vaan se hyvitetään.

`cancelled`-lasku:

- säilyttää laskunumeron
- numeroa ei käytetä uudelleen
- säilyttää audit trailin
- ei ole enää lähetettävissä
- ei ole enää reopen-muokattavissa ilman erillistä päätöstä
- PDF voidaan pitää tai merkitä ei-lähetettäväksi; tarkka toteutus päätetään myöhemmin

Tuleva audit-tapahtuma:

- `invoice.cancelled`

`cancelled` ei ole sama asia kuin hyvityslasku.

`cancelled` koskee vain laskua, jota ei ole toimitettu asiakkaalle.

## Hyvityslasku

`sent`-laskun virhe korjataan hyvityslaskulla tai myöhemmin tarkemmin
määritellyllä korjauspolulla.

Hyvityslasku:

- on oma laskunsa
- saa oman laskunumeron
- saa oman viitenumeron tai muun maksutiedon tarpeen mukaan
- viittaa alkuperäiseen laskuun
- voi olla koko laskun hyvitys MVP-vaiheessa
- osahyvitys voidaan suunnitella myöhemmin

Suositeltu vaiheistus:

1. full credit invoice eli hyvitetään koko alkuperäinen lasku
2. partial credit myöhemmin
3. mahdollinen uusi korjattu lasku luodaan erillisenä uutena laskuna tai kopiona

Koska nykyinen laskentalogiikka ei tue negatiivisia tavallisia laskurivejä,
hyvityslaskua ei pidä toteuttaa vain sallimalla negatiiviset rivit tavalliseen
laskuun.

Parempi tuleva malli:

```text
invoiceKind: standard | credit
```

tai vastaava hallittu erottelu.

Hyvityslaskun laskenta, laskumerkinnät ja PDF-merkinnät suunnitellaan erikseen.

## Lähetysloki

Lähetyslokin ja delivery event -mallin tarkempi suunnitelma on dokumentissa
`docs/architecture/invoice-delivery-events-plan.md`.

Lähetysloki ei saa tallentaa sähköpostin salasanoja, SMTP-salaisuuksia tai
tarpeettoman pitkiä teknisiä provider-virheitä käyttäjälle näkyvään muotoon.

## Manuaalinen Regressiolista

Kevyt käsin testattava lista ennen toimituspolun laajentamista:

- hyväksy lasku -> PDF syntyy
- avaa PDF
- reopen approved invoice -> PDF poistuu
- reapprove -> uusi PDF syntyy
- avaa uusi PDF
- 1-sivuinen lasku
- 2-sivuinen lasku
- taloyhtiö + isännöitsijä vastaanottajana
- yritysasiakas
- yksityisasiakas
- useampi ALV-kanta
- puuttuva PDF tiedostosta -> `POST /pdf` regeneroi
- lähetettyä laskua ei saa muokata
- kopioitu lasku saa uuden numeron vasta hyväksynnässä
- DNA SMTP -lähetystä ei saa testata oikeille asiakkaille ilman dry-run- tai
  test recipient -suojaa

## Seuraavien Vaiheiden Järjestys

Nykyinen laskun toimituskokonaisuus viimeistellään ennen uutta isoa moduulia:

1. Viimeistellään sähköposti.
   Salaisuuden turvallinen hallinta ja SMTP-provider toteutetaan
   `docs/architecture/email-delivery-and-secrets-plan.md`-dokumentin mukaan.
   implicit TLS on ensimmäisessä adapterissa pakollinen, ensimmäiset lähetykset käyttävät test recipient
   overridea. Hallittu testipolku on toteutettu ilman laskun tilasiirtymää;
   oikean tilin verkkotesti vaatii vielä projektin omistajan erillisen luvan.
   Vain myöhempi onnistunut asiakaslähetys voi muuttaa laskun `sent`-tilaan.
2. Viimeistellään tulostus.
   Current PDF avataan luotettavasti ja käyttäjä tulostaa selaimen tai
   käyttöjärjestelmän normaalilla toiminnolla. Tulostus ei automaattisesti
   merkitse laskua lähetetyksi, eikä MVP:hen lisätä suoraa tulostinohjausta.
3. Tehdään rajattu UI-siivoussprintti.
   `packages/ui` otetaan käyttöön pienillä yleisillä komponenteilla
   `docs/architecture/ui-design-system-roadmap.md`-dokumentin mukaan.
   Laskutus-, asiakas-, sähköposti- tai API-logiikkaa ei siirretä UI-pakettiin.
4. Vasta tämän jälkeen aloitetaan seuraava iso moduuli, kuten Kohteet,
   Työmääräykset tai Tuntikirjaukset.

UI-siivousta ei aloiteta kesken sähköposti- tai tulostusputken.

## Rajaus

Tässä dokumentissa ei toteuteta:

- sähköpostilähetystä
- SMTP-adapteria
- Gmail-integraatiota
- DNA-integraatiota
- tulostinintegraatiota
- hyvityslaskua
- cancelointia
- uusia riippuvuuksia
