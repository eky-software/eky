# Invoice Delivery Events Plan

Tämä dokumentti määrittää laskun toimitustapahtumien suunnittelulinjan ja
kuvaa ensimmäisen dry-run-, DNA SMTP -testi- ja asiakaslähetyspolun
toteutustilan.

Dokumentti omistaa nykyisen toimitustapahtuman ja historian lukusopimuksen.
Ensimmäisen persistence-vaiheen vaiheistus lopussa on historiaa. B:n revisio-,
legacy-, native- ja palautuskokonaisuus on hyväksytty; tämä ei sulje uuden
muutoksen katselmus-, palautus- tai PR/main-portteja.

Dokumentti ei yksinään lisää backend-reittiä, API-clientiä, web-toimintoa,
SMTP-provideria, sähköpostin lähetystä, tulostinintegraatiota, riippuvuutta tai
lockfile-muutosta.

## Tavoite

[Hyväksynnän revisiosopimus](invoice-approval-numbering-plan.md#muuttumaton-sisältörevisio)
omistaa sisällön, [atominen varaus](sqlite-invoice-delivery-event-persistence-plan.md#nykyinen-varaus-ja-loppukuittaus)
completionin ja [PDF-sopimus](invoice-print-data-foundation-plan.md#revision-pdf-julkaisu-ja-täsmäluku)
tavut. Nykyinen
yritysrajattu `InvoiceDeliveryEventReader.findEventDocument`: tapahtuman
tarkka muuttumaton dokumentti, alkuperäinen legacy-null tai ei tapahtumaa.
Ei-null-viitteen puuttuva tai ristiriitainen kohde on eheysvirhe, ei lupa
nykyisen PDF:n käyttöön tai regenerointiin. Revision ja dokumentin sidoksen,
tiivisteen ja koon tarkistus tehdään samassa lukutransaktiossa; tiedoston
todelliset tavut varmennetaan tallennusportissa.

Historian lista ja GET `/invoices/:id/delivery-events/:eventId/pdf` vaativat
`sendInvoices`-oikeuden. Reopened-laskun historia säilyy luettavana ilman
yleisen approved-lukijan lähetyskelpoisuuden muuttamista. PDF-reitti palauttaa
onnistumisessa vain tarkistetun PDF:n no-store-vastauksena, puuttuvasta tapahtumasta 404:n,
alkuperäisestä legacy-nullista 409:n ja eheysvirheestä turvallisen 500:n.
Odottamaton historian PDF:n repository-lukuvirhe palauttaa yleisen 500:n
ilman Hono-oletuskäsittelijän raakaa stderr-tulostetta. Nykyinen HTTP-
operational-ketju säilyttää `HTTP_REQUEST_FAILED`-tapahtuman Diagnosticsiin,
tukipaketin tapahtumiin ja incident-yhteenvetoon. Pelkkä luku ei lisää
business-auditia tai Activity-tapahtumaa.
Historian listan `sendMode` erottaa asiakaslähetyksen, itselle-testin,
dry-runin, manuaalisen toimituksen ja tuntemattoman legacy-moodin.
`documentSource` erottaa revision, säilytetyn legacy-kopion, alkuperäisen
legacy-viitteen ja alkuperäisen puuttuvan viitteen. Ristiriitainen tallennettu
yhdistelmä hylätään eheysvirheenä, eikä sen tilalle päätellä nykyistä PDF:ää.
Projektio ei sisällä sisäisiä revisio-/dokumenttiavaimia, tiivisteitä tai
polkuja; luokan näyttäminen ei korvaa tavujen tarkistusta avaamisessa.
Legacy-luku ei todista jälkikäteen vanhan SMTP-lähetyksen sisältöä.

Vanhan approved-laskun SMTP-historiaton siirtymä validatedLegacySnapshotiin
kuuluu [hyväksyntäsopimukseen](invoice-approval-numbering-plan.md#reopen-ja-vanhan-sisällön-siirtymä).
Sent-legacy-laskun rajattu uudelleenlähetys kuuluu
[sähköpostisopimukseen](email-delivery-and-secrets-plan.md#säilytetyn-pdfn-täsmävaltuutus).
Historian lukeminen ei tee kumpaakaan siirtymää.

Clientin ja hyväksytyn laskun web-näkymän historia käyttää näitä luokkia
ja avaa vain valitun tapahtuman PDF:n. Alkuperäiselle puuttuvalle viitteelle
ei näytetä avauspainiketta. Popupin/native-kutsun epäonnistuminen näyttää
kiinteän virheen, eikä avaus generoi tai lähetä mitään. Electron käyttää
tiukkaa `deliveryEvent`-kohdetta ja vain vastaavan GET-reitin sallintaa;
nykyisen ja säilytetyn PDF:n kohteet säilyvät erillisinä. Laskun ja historian
vanhat success/error/finally-vastaukset eivät saa vaihtaa uuden valinnan
sisältöä tai odotustilaa. Onnistunut kirjoitus päivittää yhteisen listan,
vaikka valinta vaihtui; vain vanha valintakohtainen vastaus ohitetaan. SMTP-testin ja
dry-runin jälkeen historia päivitetään myös ilman laskun tilan muuttumista.
Reopened-editori lukee identiteetin erillisestä yritysrajatusta GET
`/invoice-drafts/:id/delivery-history` -projektiosta. Sovelluspalvelu vaatii
`sendInvoices`-oikeuden; lukijaportti tarkistaa muokattavan tavallisen
luonnoksen ja olemassa olevan laskun sidoksen samassa lukutransaktiossa.
Puuttuva tai ei-muokattava kohde palauttaa 404:n. Tavallinen luonnos ilman
laskuidentiteettiä palauttaa tyhjän historian, mutta ristiriita on turvallinen
500, ei tyhjä onnistuminen. Clientin validoima luku ei muuta tallennus-DTO:ta
tai anna lähetysvaltuutta. Vanha vastaus hylätään näkymän vaihtuessa.

Lukuvirhe kirjautuu nykyisen operational-ketjun `http.requestFailed`-
tapahtumana: `invoiceDraft.deliveryHistory`, vaihe `read`, sivuvaikutus
`none` ja koodi `INVOICE_DRAFT_DELIVERY_HISTORY_INTEGRITY_FAILED` tai
`INVOICE_DRAFT_DELIVERY_HISTORY_READ_FAILED`. Sama turvallinen projektio
kuuluu Diagnosticsiin, tukipaketin tapahtumiin ja incident-yhteenvetoon.
Business-auditia tai Activity-tapahtumaa ei synny pelkästä luvusta.
Nykyinen HTTP-middleware kirjaa lisäksi yleisen 500-tapahtuman samalla
korrelaatiolla; se ei ole toinen business-epäonnistuminen. Raakavirheitä,
liiketoimintatunnisteita tai PDF-sisältöä ei liitetä diagnostiikkaan.

Nykyinen adapteri varaa SMTP-toimituksen atomisesti täsmärevisiolle ja
dokumentille tai erikseen säilytetylle legacy-kopiolle. `attempted` kirjataan
saman transaktion sisällä tehdyn kelpoisuus-/unresolved-tarkistuksen jälkeen;
yleinen save-portti ei salli SMTP-varauksen ohitusta. Loppukuittaus sitoutuu
tarkasti tähän varaukseen. Vain onnistunut customer-moodi merkitsee laskun
lähetetyksi; onnistunut `smtpTest` jättää muokkauksen sallituksi säilyttäen
vanhan historian. Reopen irrottaa current-osoittimen poistamatta PDF:ää,
ja unresolved-esto tarkistetaan myös uudelleenhyväksynnässä. Asiakas- ja
itselle-SMTP:n prepare/send on nyt kytketty tarkistettuihin täsmätavuihin,
revision sisältävään valtuutukseen ja varauksen palauttamaan loppukuittaukseen.
Tyypittämätön provider-virhe tai epäonnistunut tuloksen tallennus ei muutu
varmaksi failed-tulokseksi. Jos tulosta ei saada tallennettua, alkuperäinen
`attempted` säilyy ja estää uuden toimituksen myös uuden sovellusinstanssin
kautta. Durablen asiakastoimituksen jälkeinen vastausluku ei puolestaan
muuta onnistunutta toimitusta epäonnistuneeksi: HTTP palauttaa erillisen
`INVOICE_DELIVERY_COMMITTED_READ_FAILED`-koodin ja diagnostiikka erottaa
committed-lukuvaiheen SMTP-virheestä. Client/UI kertoo onnistuneesta lähetyksestä
ja ohjaa tarkistamaan historian lähettämättä uudelleen. Manual-/dry-run-kirjoittajat
ovat revisiosidottuja ja cancel-kilvan backend-todistus on lisätty.
Legacy-valmistelu, täsmäesikatselu ja native-vahvistus kuuluvat hyväksyttyyn
B-kokonaisuuteen. Täsmällinen varaus- ja completion-protokolla luetaan
[omistavasta persistence-sopimuksesta](sqlite-invoice-delivery-event-persistence-plan.md#nykyinen-varaus-ja-loppukuittaus).

PDF:n tarkistuksen aikainen revision vaihtuminen palauttaa kummankin
SMTP-moodin prepare/send-reitillä turvallisen 409:n ennen varausta ja
provideria. Sitä ei luokitella asiakkaan SMTP-toimitusvirheeksi.

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
- valitun revision tai erikseen hyväksytyn säilytetyn PDF:n vaatimuksen
- `sent`-tilaan siirtymisen säännöt
- delivery event -kirjauksen laskutuksen näkökulmasta

Backend email infrastructure omistaa:

- teknisen sähköpostin lähettämisen
- dry-run/fake-providerin
- nykyisen DNA SMTP -providerin ja erikseen hyväksyttävät tulevat providerit
- providerin teknisen tuloksen palauttamisen Invoicingille

Email infrastructure ei saa muuttaa laskun tilaa eikä kirjoittaa
Invoicingin delivery event -tauluihin omin päin.

## Delivery Event -Tietomalli

Nykyinen taulu sisältää alkuperäisten kenttien lisäksi alla nimetyn
revision/alkuperän ja moodin. Täydet SQL-ehdot omistaa
[DDL-sopimus](sqlite-invoice-approval-persistence-plan.md#täydet-ddl-ehdot-ja-julkaisuportti):

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
- binding_kind
- revision_id
- send_mode
- document_sha256
- document_size_bytes
```

Kenttien merkitys:

- `company_id` rajaa tapahtuman aina yritykseen
- `invoice_id` viittaa hyväksyttyyn tai lähetettyyn laskuun
- `document_id` viittaa toimituksen täsmädokumenttiin; vain migroidun
  legacyOriginal-tapahtuman alkuperäinen null-viite saa puuttua
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

Dokumenttisidos ei seuraa current-osoitinta. Tapahtuman yritys-/lasku-/document-
variantti, revisio ja todellisten tavujen hash/koko pysyvät samana myös
uudelleenhyväksynnän jälkeen. LegacyUnknown ei ole uuden tapahtuman moodi.

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

Nykyinen yleinen `saveDeliveryEvent` ja sitä käyttävä application-palvelu
hyväksyvät vain revision PDF:ään sidotun dry-run-tuloksen `succeeded` tai
`failed`. SMTP ja manual eivät voi kiertää omia atomisia porttejaan tämän
kirjoittajan kautta. Current-revisio ja tarkka dokumentti/tiiviste/koko
tarkistetaan dry-run-tapahtuman kirjoitustransaktiossa. Esikatselu ei edelleenkään
kirjoita tapahtumaa. Dry-run-tulos ei lukitse laskun muokkausta eikä arkistoi
PDF:ää toimitettuna.

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
viestikenttien fingerprintiin. Sama fingerprint sitoo lähettäjän nimen ja
osoitteen sekä current PDF:n tunnisteen, SHA-256-tiivisteen, tiedostonimen ja
koon. Electron main process näyttää prepare-
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

Liitettä ei valita frontendissä vapaasti. Backend valitsee revision tai
hyväksytyn preservedLegacy-kohteen. Customer-prepare/send välittää lisäksi
backendin esivalmistelun palauttaman tarkan documentTargetin
[sähköpostisopimuksen](email-delivery-and-secrets-plan.md#säilytetyn-pdfn-täsmävaltuutus)
mukaisesti; tunniste ei itsessään anna valtuutta.

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
4. varmistaa saman täsmärevision PDF:n tai valtuutetun säilytetyn kopion;
   olemassa olevan tiedoston puuttuminen ei salli regenerointia
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

[Säilytetyn PDF:n sopimus](email-delivery-and-secrets-plan.md#säilytetyn-pdfn-täsmävaltuutus)
omistaa sent-legacy-laskun erillisen vahvistuksen, tuntemattoman SMTP:n
selvityseston ja 60 sekunnin kertaluvan. Tavallinen revision resend ja
historian luku pysyvät eri toimintoina.

`sent`-laskun uudelleenlähetys:

- ei luo uutta laskua
- ei muuta laskunumeroa
- ei muuta viitenumeroa
- ei muuta laskun sisältöä
- käyttää täsmälleen valtuutettua revision PDF:ää tai säilytettyä legacy-kopiota
- voi käyttää käyttäjän muokkaamaa vastaanottajaa, cc:tä, otsikkoa ja viestiä
- vaatii käyttäjän vahvistuksen
- kirjataan uutena delivery eventinä
- ei muuta laskun statusta, koska lasku on jo `sent`

Uudelleenlähetys ei ole sama asia kuin laskun kopiointi uudeksi luonnokseksi.

## Manuaalinen Toimitus Ja Tulostus

Manuaalinen toimitus on rajattu arvoihin `print` ja `manual`. Backend varmistaa
ennen PDF:n muodostamista, ettei laskulla ole ratkaisemattomia `attempted`- tai
`outcomeUnknown`-tapahtumia. Jos sellainen löytyy, manuaalista toimitusta ei
viimeistellä. Muussa tapauksessa backend varmistaa current PDF:n, minkä jälkeen
manual-providerin `succeeded`-delivery event, laskun `sent`-siirtymä ja laskun
audit-tapahtuma tallennetaan samassa SQLite-transaktiossa. Pelkkä PDF:n avaaminen
tai tulostusikkunan näyttäminen ei tee tätä tilasiirtymää.

Nykyinen manual-finalizer saa täsmällisen revision/dokumentin kohteen.
Se varmistaa kelpoisuuden, sidoksen ja ratkaisemattoman historian saman
`IMMEDIATE`-transaktion sisällä. Tulos erottaa uuden `completed`-toimituksen
idempotentista `alreadySent`-tuloksesta. Vain uusi tapahtuma jonotetaan
valinnaiseen arkistoon: kilpaileva toinen pyyntö ei keksi uutta tapahtumaa
tai arkistointia eikä muuta alkuperäistä aikaleimaa.

Manual sekä dry-run prepare/send ottavat revisioavaimen ennen laskun
vastausmallin lukua ja vaativat PDF:ltä saman revision. Muokkauksen ja
uudelleenhyväksynnän välissä palautunut vanha laskunäkymä ei näin yhdisty
uuden revision PDF:ään. Havaittu revision vaihtuminen palauttaa turvallisen
409-vastauksen ennen toimituksen viimeistelyä.

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

Historiallinen ensitoteutuksen eteneminen, ei nykyisen työn suorituslista:

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

## Muutoksen säilytettävät hyväksyntäketjut

Hyväksytty B ei ole lupa julkaista puolikasta revisio-/toimituskytkentää.
Muutoksen vaikutusalueen näyttö säilyttää seuraavat ketjut:

- SMTP-parseri: samat tavut yhdessä chunkissa, riveittäin, tavuittain ja
  kaikissa kahden osan katkaisukohdissa; CR/LF-, koko-, EOF- ja deadline-
  vastakontrollit. DATA-250:n jälkeen QUITin sync/async/sulkuvirhe ei muuta
  tulosta. Kielteinen/kadonnut DATA-kuittaus ei muutu onnistumiseksi.
- Hyvitys: standardin snapshot -> credit draft -> atominen hyväksyntä;
  pienet rivit, molempiin suuntiin pyöristysero, net/gross, useat ALV-ryhmät,
  alennus, viimeiset osahyvityssentit, safe-integer-/kapasiteetti-/tenant-rajat.
- Revisio A -> smtpTest -> reopen -> muutos -> revisio B -> customer-send B:
  sama lasku-ID/numero, A:n snapshot ja PDF-tavut säilyvät, vanha token
  hylätään ja vain B:n lasku muuttuu sentiksi. Maksut/saatavat/listat/
  hyvityskatot eivät monistu; historia on luettavissa reopened-tilassakin.
- PDF-julkaisun ja reopen/reapprove/cancelin molemmat järjestykset, kaksi
  kirjoittajaa, myöhäinen vanha cache-virhe uuden PDF:n julkaisun yli,
  julkaisuvirhe ja vain oman varmasti julkaisemattoman ehdokkaan siivous.
  Tarkista todelliset tavut/hash/koko, ei vain metadatan lupaus.
- Legacy-resendin täsmätavut, katkennut/null-viite, hash-virhe, puuttuva
  tiedosto ja tunnettu R02/R12-jälkitila; ei regenerointia, arvattua
  provenanssia tai provider-kutsua estetyssä tapauksessa.
- Prepare/send-vaihdos, native-peruutus, vanha/käytetty token, rinnakkaiset
  customer/test/dry-run, finalizer-virhe lopullisen 250:n jälkeen,
  completionin toisto ja restart ennen/jälkeen providerin.
- Oikea HTTP/UI/native-composition ja hardened Windows
  backup -> inspect -> restore -> restart -> compare useilla revisioilla,
  legacy-artifactilla ja alkuperäisillä PDF-tavuilla. Katkaistu migraatio
  ei jätä puolikasta historiaa; vanha sallittu null ei löysennä uutta sidosta.

Ajokytkentä, todellinen tulos ja siivous todistetaan erikseen, synteettisellä
datalla ja fake-providerilla ilman uusia prosessinhallinta- tai testialustoja.
Ei pelkän UI-viestin perusteella pääteltyä pysyvää tulosta. Nykyinen
[testauskäytäntö](../ai/testing-rules.md) omistaa ensivirheen, yhden hallitun
uusinnan ja määräaikaiset poikkeukset; tunnettu sisältö-/tenant-/toimitusvirhe
ei muutu hyväksytyksi uusinnan läpäisyllä.

Uusi skeema tarvitsee pre-migration-palautuspisteen ja nykyisen profile-
recoveryn, ei reverse-SQL:ää tai vanhaa binaaria uuden skeeman päälle.
Palautuspiste ei peru jo lähtenyttä sähköpostia eikä vanha backup tiedä
myöhempien lähetysten tilaa. Installer/rollback säilyttävät omat porttinsa.
Muuttuva snapshot/catalog/restore-sopimus päivitetään myös moduuliohjeeseen,
backup-inventaarioon ja integraatiomatriisiin. Julkaisematon temp-PDF ei ole
auktoritatiivinen backup; toimitustodiste ei saa jäädä katalogin ulkopuolelle.
