# Invoice Delivery Events Plan

Tämä dokumentti määrittää laskun toimitustapahtumien suunnittelulinjan ja
kuvaa ensimmäisen dry-run-, DNA SMTP -testi- ja asiakaslähetyspolun
toteutustilan.

Dokumentti on suunnitelma ja toteutuksen rajaus. Ensimmäinen persistence-vaihe
lisää delivery event -taulun, repository-portin, SQLite-adapterin ja
application servicen tapahtuman kirjaamiseen.

Dokumentti ei yksinään lisää backend-reittiä, API-clientiä, web-toimintoa,
SMTP-provideria, sähköpostin lähetystä, tulostinintegraatiota, riippuvuutta tai
lockfile-muutosta.

## Tavoite

Hyväksytyn laskun toimitus pitää pystyä jäljittämään myöhemmin turvallisesti.

Delivery event -malli vastaa kysymyksiin:

- mitä laskua yritettiin toimittaa
- millä tavalla laskua toimitettiin
- kenelle toimitus oli menossa
- mitä PDF-dokumenttia käytettiin
- onnistuiko toimitus
- milloin toimitus tapahtui
- kuka tai mikä toiminto toimituksen käynnisti

Delivery event ei korvaa laskun tilaa. Laskun tila kertoo laskun elinkaaren
tilan, kuten `approved` tai `sent`. Delivery event kertoo yksittäisestä
toimitusyrityksestä tai toimitustoiminnosta.

## Moduulirajat

Invoicing omistaa:

- toimitustapahtuman liiketoimintasäännöt
- mitä laskua saa toimittaa
- current PDF -vaatimuksen
- `sent`-tilaan siirtymisen säännöt
- delivery event -kirjauksen laskutuksen näkökulmasta

Backend email infrastructure omistaa:

- teknisen sähköpostin lähettämisen
- dry-run/fake-providerin
- SMTP/Gmail/Microsoft-providerit myöhemmin
- providerin teknisen tuloksen palauttamisen Invoicingille

Email infrastructure ei saa muuttaa laskun tilaa eikä kirjoittaa
Invoicingin delivery event -tauluihin omin päin.

## Delivery Event -Tietomalli

Ensimmäinen persistence-vaihe käyttää taulua:

```text
invoice_delivery_events
- id
- company_id
- invoice_id
- document_id
- delivery_method
- provider
- status
- recipient_email
- cc_email
- subject
- body_preview
- provider_message_id
- safe_error_message
- technical_error_code
- created_at
- created_by
```

Kenttien alustava merkitys:

- `company_id` rajaa tapahtuman aina yritykseen
- `invoice_id` viittaa hyväksyttyyn tai lähetettyyn laskuun
- `document_id` viittaa current PDF -dokumenttiin
- `delivery_method` voi olla esimerkiksi `email`, `manual`, `print` tai `other`
- `provider` voi olla esimerkiksi `dryRun`, `smtp`, `gmail`, `microsoft` tai `manual`
- `status` voi olla `prepared`, `attempted`, `succeeded`, `failed` tai
  `outcomeUnknown`
- `recipient_email` tallentaa käytetyn vastaanottajan
- `cc_email` tallentaa käyttäjän antaman kopio-osoitteen, jos annettu
- `subject` tallentaa käytetyn otsikon
- `body_preview` tallentaa enintään rajatun version viestistä myöhempää tarkistusta varten
- `provider_message_id` tallentaa providerin palauttaman viitetunnisteen, jos sellainen on
- `safe_error_message` tallentaa turvallisen virheviestin
- `technical_error_code` voi tallentaa rajatun teknisen koodin ilman salaisuuksia

MVP:ssä `cc_email` on yksi vapaaehtoinen tekstikenttä. Jos myöhemmin tarvitaan
useita kopio-osoitteita, se päätetään erikseen esimerkiksi erillisellä
rakenteella tai JSON-kentällä.

`provider_message_id` ei ole Eky-järjestelmän sisäinen tunniste. Se voi
myöhemmin sisältää esimerkiksi SMTP/Gmail/Microsoft-providerin viitetunnisteen,
joten sitä ei validoida liian tiukalla identifier-säännöllä. Ensimmäinen sääntö:
trim, enimmäispituus ja ei salaisuuksia tai raakaa provider-debugia.

`document_id` voi MVP:ssä viitata current PDF -dokumenttiin. Kun oikea
onnistunut sähköpostilähetys toteutetaan, pitää varmistaa, että lähetetyn
laskun audit-polusta ei katoa tieto käytetystä dokumentista. Tämä voidaan
ratkaista pitämällä sent-laskun PDF pysyvänä tai tallentamalla delivery eventiin
riittävä dokumenttisnapshot, kuten tiedostonimi ja hash.

## Ei Salaisuuksia Delivery Eventeihin

Delivery event ei saa tallentaa:

- SMTP-salasanaa
- OAuth-tokenia
- secretRef-arvon salaista sisältöä
- providerin raakaa debug-vastausta
- PDF:n binäärisisältöä
- koko sähköpostin MIME-runkoa
- stack tracea
- tarpeettoman pitkiä teknisiä virheitä

Jos sähköpostin viestirunko tallennetaan myöhemmin, se tehdään tietoisena
päätöksenä ja rajataan. Ensimmäinen turvallisempi malli voi tallentaa vain
lyhyen `body_preview`-katkelman tai jättää rungon tallentamatta kokonaan.

## Dry-run Ja Prepare

Nykyinen dry-run-esikatselu muodostaa sähköpostiluonnoksen, mutta ei lähetä
viestiä eikä muuta laskun tilaa.

Dry-run-esikatselua ei kirjata delivery eventiksi, koska mitään toimitusta ei
vielä yritetä.

Käyttäjän vahvistama dry-run send kirjataan delivery eventiksi providerilla
`dryRun`. Se ei lähetä oikeaa sähköpostia eikä saa merkitä laskua `sent`-tilaan.

Hallittu DNA SMTP -testilähetys kirjataan providerilla `smtp`. Ennen
provider-kutsua luodaan yksi `attempted`-tapahtuma, joka viimeistellään saman
tunnisteen alla tilaan `succeeded`, `failed` tai `outcomeUnknown`.
`outcomeUnknown` tarkoittaa, että viestin lopullista hyväksyntää ei voida
varmistaa; käyttöliittymä ei saa tällöin kehottaa sokkona uudelleenlähetykseen.
SMTP-testi käyttää aina Company Settingsin testivastaanottajaa, tallentaa
delivery eventiin todellisen testivastaanottajan, jättää Cc:n tyhjäksi eikä
muuta laskua `sent`-tilaan.

SMTP-testin send-vaihettä edeltää erillinen prepare-vaihe. Backend luo
lyhytikäisen kertakäyttövaltuutuksen ja sitoo sen actoriin, yritykseen,
laskuun, provideriin, todelliseen testivastaanottajaan ja validoitujen
viestikenttien fingerprintiin. Electron main process näyttää prepare-
vastauksesta rajatun vahvistusikkunan. Vain uusin vahvistettu, käyttämätön ja
voimassa oleva valtuutus saa edetä provider-kutsuun. Yhtä laskua ja provideria
kohti sallitaan vain yksi käynnissä oleva yritys. Käyttämätön prepare-valtuutus
voidaan korvata uudella, jotta Electronin vahvistusikkunassa peruutettu lähetys
ei lukitse seuraavaa hallittua yritystä. Provider-kutsuun jo siirtynyttä
yritystä ei saa ohittaa uudella valtuutuksella. Onnistunut tai
lopputulokseltaan epäselvä yritys käynnistää lyhyen varoajan. Automaattista
retrytä ei tehdä.
Local-MVP:n attempt store on prosessimuistissa, joten se ei ole pilvi- tai
moniprosessilukko. Sen rinnalla Invoicingin pysyvä delivery event -lukija
estää uuden tavallisen asiakaslähetyksen valmistelun, jos samalla yrityksellä
ja laskulla on `attempted`- tai `outcomeUnknown`-tapahtuma. Automaattista retryä
ei tehdä. Pilvi- ja moniprosessimallin lukitus arvioidaan edelleen erikseen
ennen pilvikäyttöä.

## Send Input

Nykyisessä dry-run-, test- ja asiakaslähetyspolussa webistä backendille
lähetetään käyttäjän vahvistamat lähetyskentät:

```text
invoiceId
to
cc
subject
body
```

Liitettä ei valita frontendissä vapaasti. Backend varmistaa current PDF:n ja
liittää vain hyväksytyn laskun voimassa olevan PDF-dokumentin.

Frontend ei saa lähettää luotettuna:

- companyId
- invoice status
- PDF storage path
- provider secret
- providerin teknisiä asetuksia
- sent-tilaa

## Backendin Send-Säännöt

Send- ja dry-run-send-käyttötapa:

1. ottaa `companyId`-arvon luotetusta backend-kontekstista
2. hakee laskun yritysrajatusti
3. tarkistaa, että laskun saa toimittaa
4. varmistaa tai muodostaa current PDF:n backendissä
5. validoi vastaanottajan, cc:n, otsikon ja viestirungon
6. kirjaa oikeassa SMTP-polussa delivery eventin `attempted`-tilaan ennen
   provider-kutsua
7. kutsuu valittua provideria
8. viimeistelee saman delivery eventin tilaan `succeeded`, `failed` tai
   `outcomeUnknown`
9. muuttaa laskun `sent`-tilaan vain varmasti onnistuneen oikean toimituksen
   jälkeen ja samassa transaktiossa onnistuneen event-tilan kanssa

Jos provider epäonnistuu, laskua ei merkitä `sent`-tilaan.

Virhevastauksen pitää olla käyttäjälle turvallinen. Se ei saa paljastaa
salaisuuksia, providerin raakaa vastausta, stack tracea tai muiden yritysten
dataa.

Dry-run- ja SMTP-testipolut eivät muuta laskun tilaa. Asiakaslähetyksen
onnistuminen muuttaa `approved`-laskun `sent`-tilaan. `sent`-laskun
uudelleenlähetys jättää tilan ennalleen.

## Uudelleenlähetys

`sent`-laskun uudelleenlähetys:

- ei luo uutta laskua
- ei muuta laskunumeroa
- ei muuta viitenumeroa
- ei muuta laskun sisältöä
- käyttää samaa current PDF:ää tai backendin varmistamaa current PDF:ää
- voi käyttää käyttäjän muokkaamaa vastaanottajaa, cc:tä, otsikkoa ja viestiä
- vaatii käyttäjän vahvistuksen
- kirjataan uutena delivery eventinä
- ei muuta laskun statusta, koska lasku on jo `sent`

Uudelleenlähetys ei ole sama asia kuin laskun kopiointi uudeksi luonnokseksi.

## Manuaalinen Toimitus Ja Tulostus

Manuaalinen toimitus on rajattu arvoihin `print` ja `manual`. Backend varmistaa
ensin current PDF:n. Sen jälkeen manual-providerin `succeeded`-delivery event,
laskun `sent`-siirtymä ja laskun audit-tapahtuma tallennetaan samassa
SQLite-transaktiossa. Pelkkä PDF:n avaaminen tai tulostusikkunan näyttäminen ei
tee tätä tilasiirtymää.

Tulostuksen auditointi päätetään erikseen. PDF:n avaaminen ei välttämättä
tarkoita, että lasku on tulostettu tai toimitettu asiakkaalle.

Nykyisiä ja tulevia tapahtumia:

- `manual_mark_sent`
- `email_send_succeeded`
- `email_send_failed`
- `email_resend_succeeded`
- `email_resend_failed`
- `print_marked_sent`

Tarkat nimet päätetään toteutusvaiheessa.

## Vaiheistus

Suositeltu eteneminen:

1. tämä delivery event -suunnitelma
2. `invoice_delivery_events`-persistence ja repository-portti
3. application service delivery eventin kirjaamiseen
4. fake/dry-run send -käyttötapa ilman oikeaa SMTP:tä
5. webin `Lähetä kuivaharjoitteluna` tai vastaava toiminto
6. hallittu DNA SMTP -testipolku pakotetulla testivastaanottajalla
7. oikea asiakaslähetys ja sen tilasiirtymät
8. yritysrajattu delivery history -näkymä turvallisilla yhteenvetotiedoilla

## Rajaus

Toteutettu ensimmäisessä backend-vaiheessa:

- tietokantataulu ja migraatio
- repository-portti ja SQLite-adapteri
- delivery eventin application service
- backendin dry-run send -käyttötapa
- HTTP-reitti backendin sisäiseen dry-run send -polkuun
- API-clientin dry-run send -kutsu
- webin kuivaharjoittelulähetyksen toiminto sähköpostiesikatselussa
- hallittu DNA SMTP -testikäyttötapa, delivery eventin tilasiirtymät,
  HTTP-reitti, API-client, desktop-allowlist ja web-toiminto
- DNA SMTP -asiakaslähetyksen prepare/send-käyttötapa, lyhytikäinen
  kertakäyttövaltuutus, Electron-vahvistus, API-client ja web-toiminto
- delivery eventin `attempted`-kirjaus ennen provider-kutsua
- `succeeded`-, `failed`- ja `outcomeUnknown`-lopputulokset
- onnistuneen eventin ja laskun `sent`-tilan atominen SQLite-viimeistely
- `sent`-laskun uudelleenlähetys uutena tapahtumana ilman laskun identiteetin
  tai tilan muuttamista
- yritysrajattu delivery history -reitti, API-client ja web-näkymä, jotka
  palauttavat vain rajatut tapahtumayhteenvedot
- manuaalisen tai tulostetun toimituksen event-, audit- ja `sent`-tilasiirtymä
  samassa SQLite-transaktiossa

Webin kuivaharjoittelutoiminto lähettää käyttäjän muokkaamat `to`, `cc`,
`subject` ja `body` -kentät backendin dry-run-send-polulle. Backend varmistaa
PDF:n, validoi kentät ja kirjaa delivery eventin. Tämä ei muuta laskua
`sent`-tilaan eikä lähetä oikeaa sähköpostia.

Hallittu SMTP-testi ei ole tuotantolähetys: todellinen vastaanottaja pakotetaan
testiasetuksesta, Cc poistetaan eikä laskun tila muutu. Automaattiset testit
eivät muodosta verkkoyhteyttä DNA:n palvelimeen.

Selainkehityksessä käytetään vain dry-run-polkuja. SMTP-testi ja
asiakaslähetys edellyttävät Electron desktop -runtimea, jossa backendin
runtime-session, main processin vahvistus ja backend-only secret reader ovat
käytettävissä.

Ei vielä toteuteta:

- Gmail-provideria
- Secret Manageria
- oikean asiakasdatan tuotantovapautusta ennen release security gatea
