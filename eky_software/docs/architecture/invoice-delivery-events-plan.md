# Invoice Delivery Events Plan

Tämä dokumentti määrittää laskun toimitustapahtumien suunnittelulinjan ennen
varsinaista sähköpostilähetyksen toteutusta.

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
- `status` voi olla esimerkiksi `prepared`, `attempted`, `succeeded` tai `failed`
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

Ensimmäisessä delivery event -vaiheessa päätetään erikseen, kirjataanko
dry-run-esikatselu delivery eventiksi. Molemmat mallit ovat mahdollisia:

- ei kirjata dry-run-esikatselua, koska mitään toimitusta ei yritetty
- kirjataan `prepared`-tapahtuma, jos halutaan auditoida lähetysikkunan valmistelu

Jos dry-run kirjataan myöhemmin, sen pitää erottua selvästi oikeasta
lähetysyrityksestä. Dry-run ei saa merkitä laskua `sent`-tilaan.

## Tuleva Send Input

Kun oikea tai fake-send-polku lisätään, webistä backendille voidaan lähettää
käyttäjän vahvistamat lähetyskentät:

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

## Backendin Tulevat Säännöt

Tuleva send- tai dry-run-send-käyttötapa:

1. ottaa `companyId`-arvon luotetusta backend-kontekstista
2. hakee laskun yritysrajatusti
3. tarkistaa, että laskun saa toimittaa
4. varmistaa tai muodostaa current PDF:n backendissä
5. validoi vastaanottajan, cc:n, otsikon ja viestirungon
6. kutsuu valittua provideria
7. kirjaa delivery eventin
8. muuttaa laskun `sent`-tilaan vain onnistuneen oikean toimituksen jälkeen

Jos provider epäonnistuu, laskua ei merkitä `sent`-tilaan.

Virhevastauksen pitää olla käyttäjälle turvallinen. Se ei saa paljastaa
salaisuuksia, providerin raakaa vastausta, stack tracea tai muiden yritysten
dataa.

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

Manuaalinen "Merkitse lähetetyksi" voi myöhemmin kirjata delivery eventin.

Tulostuksen auditointi päätetään erikseen. PDF:n avaaminen ei välttämättä
tarkoita, että lasku on tulostettu tai toimitettu asiakkaalle.

Mahdollisia tulevia tapahtumia:

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
6. oikea SMTP/Gmail-provider myöhemmin
7. delivery history -näkymä myöhemmin

## Rajaus

Ei vielä toteuteta:

- tietokantataulua
- migraatiota
- repositoryä
- HTTP-reittiä
- API-clientiä
- webin lähetysnappia
- SMTP-provideria
- Gmail-provideria
- Secret Manageria
- Windows Credential Manageria
- oikeaa sähköpostilähetystä
- delivery history -näkymää
