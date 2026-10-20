# Email Delivery And Secrets Plan

Tämä dokumentti määrittää Eky-projektin sähköpostilähetyksen,
SMTP/Gmail-integraatioiden ja salaisuuksien hallinnan suunnittelulinjan.

Dokumentti on sähköpostin ja salaisuuksien etenemissuunnitelma. Local-MVP:n
Electron `safeStorage` -broker, lifecycle-audit sekä rajattu HTTP-, API-client-
ja UI-polku on toteutettu. Hallittu DNA SMTP -testipolku on kytketty ja oikean
DNA-tilin verkkoyhteys on varmennettu projektin omistajan testivastaanottajalla.
Asiakaslähetyksen ensimmäinen prepare/send-polku on toteutettu, mutta tämä ei
vielä tarkoita Gmail OAuthia, Secret Manager -adapteria tai tuotantovalmista
desktop-julkaisua oikealle asiakasdatalle.

## Nykyinen Toteutustila

Sähköpostipolusta on toteutettu local-MVP:hen:

- hyväksytyn laskun sähköpostiesikatselu current PDF:n perusteella
- käyttäjän muokattavat vastaanottaja-, kopio-, otsikko- ja viestikentät
- backendin dry-run-provider, joka ei lähetä oikeaa sähköpostia
- dry-run-send HTTP- ja API-client-polku
- `invoice_delivery_events`-persistence ja dry-run-tapahtuman auditointi
- Company Settings -moduulin ei-salaiset lähettäjä- ja testivastaanottaja-
  asetukset sekä niiden web-UI; DNA-yhteysprofiili ei ole käyttäjän
  muokattavissa
- tieto `emailSecretConfigured`, joka ei sisällä salaista arvoa
- Electron-runtimen muistissa pidettävä local-session ja backendin siitä
  muodostama luotettu `ActorContext`
- sähköpostisalaisuuden asettamisen ja poistamisen yhden rivin lifecycle-audit,
  joka käyttää `pending`, `succeeded` ja `failed` -tiloja ilman salaista arvoa
  tai sen johdannaisia
- Electron main processin `safeStorage`-adapteri, versionoitu salattu
  `userData`-blob ja utility processin yksityinen secret broker synteettiselle
  local-MVP-testiarvolle
- salatun tiedoston keskeytyksenkestävä `current`/`next`/`backup`-vaihto,
  turvallinen palautuminen sekä kaikkien slottien poistaminen
- desktop-sessionilla suojatut salaisuuden tila-, asetus- ja poistoreitit,
  jotka käyttävät vain backendin vahvistamaa `ActorContext`-kontekstia
- API-client ja Oma yritys -näkymän erillinen salasanapaneeli, joka näytetään
  vain app-kerroksen vahvistamassa Electron-runtimessa, näyttää vain
  `configured`-tilan eikä koskaan esitäytä tai palauta salaista arvoa;
  selainkehitys ei mounttaa paneelia eikä kutsu salaisuuden endpointteja
- paketoitu Windows-smoke, joka varmistaa synteettisellä arvolla koko
  HTTP -> application -> audit -> secret broker -> `safeStorage` -elinkaaren
- backendin sisäinen, riippuvuudeton SMTP/MIME-kuljetuskerros, joka käyttää
  vain Node-standardikirjaston TLS- ja crypto-rajapintoja ja palvelee
  rajattuja DNA SMTP -testi- ja asiakaslähetyspolkuja
- rajattu DNA SMTP -testiprovider, joka hyväksyy vain hostin
  `smtp.dnamail.fi`, portin `465`, implicit TLS -mallin ja pakollisen
  testivastaanottajan
- Invoicingin hallittu SMTP-testikäyttötapa, HTTP-reitti, API-client,
  Electronin backend-allowlist ja web-toiminto
- SMTP-testin lyhytikäinen prepare-vaihe, kertakäyttöinen kryptografinen
  valtuutus, actor/company/invoice/provider/request-sidonta, samanaikaisen
  lähetyksen esto ja onnistuneen tai epäselvän lopputuloksen lyhyt varoaika
- Electron main processin oma vahvistusikkuna, joka näyttää todellisen
  testivastaanottajan, otsikon, laskun ja PDF-liitteen ennen kuin
  kertakäyttövaltuutus palautetaan rendererin käyttöön
- SMTP-testin delivery event -tilat `attempted`, `succeeded`, `failed` ja
  `outcomeUnknown`; tapahtuma kirjataan `attempted`-tilaan ennen providerin
  kutsua ja sama tapahtuma viimeistellään providerin tuloksen perusteella
- webissä näkyvä todellinen testivastaanottaja ja turvalliset onnistumis-,
  virhe- sekä epäselvän lopputuloksen viestit
- asiakkaalle tarkoitetun DNA SMTP -lähetyksen erillinen prepare/send-polku,
  jossa käyttäjän muokkaamat `to`, `cc`, `subject` ja `body` validoidaan ja
  sidotaan lyhytikäiseen kertakäyttövaltuutukseen
- Electron main processin lähetys- ja uudelleenlähetysvahvistus, joka näyttää
  laskunumeron, lähettäjän, vastaanottajan, kopion, otsikon, koko viestirungon,
  current PDF -liitteen nimen ja koon sekä tiedon uudelleenlähetyksestä;
  oletusvalinta on aina peruutus
- delivery eventin kirjaaminen `attempted`-tilaan ennen asiakaslähetystä sekä
  lopputuloksen erottelu tiloihin `succeeded`, `failed` ja `outcomeUnknown`
- onnistuneen delivery eventin ja laskun `sent`-tilasiirtymän atominen
  SQLite-transaktio; epäonnistunut tai epäselvä lähetys ei muuta laskun tilaa
- `sent`-laskun uudelleenlähetys uutena delivery eventinä muuttamatta laskun
  tunnistetta, numeroa, viitenumeroa tai tilaa

Nykyinen dry-run ei muuta laskua `sent`-tilaan. DNA SMTP -testiproviderin
hallittu testipolku ei myöskään muuta laskua `sent`-tilaan. Testipolku pakottaa
Oma yritys -asetusten `emailTestRecipientOverride`-osoitteen, jättää Cc:n pois
SMTP-kuoresta ja MIME-viestistä sekä käyttää asiakkaan osoitetta vain
käyttäjän muokkaaman esikatselulomakkeen tietona. Oikean DNA-tilin rajattu
verkkoyhteystesti on tehty testivastaanottajalla. Asiakaslähetyksen koodi on
toteutettu, mutta sen käyttö oikealla asiakasdatalla kuuluu erilliseen
tuotantojulkaisun turvallisuusporttiin.

## Sisäinen SMTP- Ja MIME-Kuljetuskerros

Ensimmäinen tekninen SMTP/MIME-kerros sijaitsee rajatusti kansiossa:

```text
apps/backend/src/infrastructure/email/
```

Kerros sisältää:

- tiukasti rajatun ASCII-sähköpostiosoitteen validoinnin ilman SMTPUTF8-tukea
- bounded SMTP reply -parserin
- eksplisiittisen SMTP-tilakoneen
- vain palvelimen mainostaman `AUTH PLAIN`- tai `AUTH LOGIN`-mekanismin
- canonical CRLF- ja dot-stuffing-käsittelyn
- UTF-8-tekstirungon ja yhden muistissa annetun PDF-liitteen MIME-rakentamisen
- implicit TLS -yhteyden, jossa sertifikaatti, hostname ja vähintään TLS 1.2
  vaaditaan ennen SMTP-komentoja tai tunnistautumista
- vaihekohtaiset, idle- ja kokonaisaikarajat sekä `outcomeUnknown`-tilan, jos
  DATA-vaiheen kirjoituksen tai palvelimen lopullisen hyväksynnän tulos jää
  epäselväksi

Vastausparserin koko- ja protokollarajat kohdistuvat SMTP-riviin ja koko
vastaukseen, eivät TLS-chunkin kokoon. Sama tavujono tulkitaan samoin myös
CRLF:n, rivien ja vastausten rajojen osuessa eri verkkolohkoihin.
Lopullinen DATA-250 on kuljetuksen hyväksyntä: sen jälkeinen QUIT- tai
sulkuvirhe ei muuta toimitusta epäonnistuneeksi. Sulku ei myöskään korvaa
ennen hyväksyntää syntynyttä virhettä tai `outcomeUnknown`-tulosta.
Nykyinen provider ja sen diagnostiikka käyttävät tätä samaa lopputulosta.
R12/R13 kuuluu hyväksyttyyn B-kokonaisuuteen; tämä osuus omistaa sen
nykyiset kuljetussäännöt. Myös QUIT-budjetin laskennan synkroninen virhe,
async-virhe ja sulkuvirhe DATA-250:n jälkeen säilyttävät hyväksynnän.
EOF-, rivi-, vastaus-, tila-, muisti- ja aikarajat säilyvät; korjaus ei
lisää retryä tai kasvata timeoutia.

Kerros ei sisällä:

- DNA- tai muuta provider-päätöstä
- STARTTLS-, portti 25-, retry-, pooling-, proxy- tai automaattista fallback-
  toimintaa
- HTML-viestiä, Bcc:tä, lisäliitteitä tai tiedostopolkujen lukemista
- laskutusdomainia, delivery event -kirjauksia tai laskun tilasiirtymiä
- salaisuuden tallennusta tai lukua

Kuljetuskerros ei käytä Nodemaileria tai muuta uutta kolmannen osapuolen
riippuvuutta. Sen rajat ja protokollakäytös testataan synteettisillä arvoilla;
automaattiset testit eivät muodosta yhteyttä DNA:n palvelimeen.

SMTP:n turvallisuusportti ja diagnostiikka ovat erillisiä vastuita.
Implicit TLS portissa `465`, `rejectUnauthorized`, sertifikaatin ja hostnamen
validointi sekä vähintään TLS `1.2` ovat ehdottomia. TLS `1.3` sallitaan.
Cipherin nimi, sertifikaatin SHA-256-sormenjälki, etä-IP ja IP-perhe ovat
vain best-effort-diagnostiikkametadataa. Jos TLS-yhteys täyttää turvallisuus-
portin mutta metadataa ei voida muodostaa turvalliseksi allowlistatuksi
yhteenvedoksi, SMTP-istunto saa jatkua ilman
`smtp.connectionSecured`-eventtiä.

Kuljetusvirheet kirjoitetaan tyypitettyinä `smtp.connectionFailed`,
`smtp.tlsFailed`, `smtp.authenticationFailed`, `smtp.deliveryFailed` tai
`smtp.deliveryOutcomeUnknown` -eventteinä. Eventin kirjoittaminen on best
effort eikä saa peittää tai muuttaa providerin varsinaista lopputulosta.
Detailed-loki ei saa sisältää SMTP-käyttäjänimeä, lähettäjän tai
vastaanottajan osoitetta, Cc:tä, otsikkoa, viestirunkoa, MIMEä, PDF-dataa tai
salaisuutta. Etä-IP ja portti eivät siirry Diagnostics-projektioon,
tukipakettiin tai incident-indeksiin.

Kuljetuksen rajat, kuten viestin, PDF:n, SMTP-vastauksen ja aikakatkaisujen
enimmäisarvot, pidetään sähköposti-infrastruktuurin omissa tarkasti nimetyissä
konfiguraatiotiedostoissa. DNA:n kiinteä provider-profiili kuuluu
DNA-providerin omaan kansioon. Projektin juureen ei luoda yleistä
`constants`, `config`, `utils` tai vastaavaa muuttujakaatopaikkaa. Jos sama
konfiguraatio tarvitsee myöhemmin aidosti usean sovelluksen tai moduulin
omistajuuden, erillinen `packages/config`-ratkaisu arvioidaan omana
arkkitehtuuripäätöksenään.

## Julkisen Repositoryn Rajaus

Tämä dokumentti saa olla julkisessa Git-repositoriossa, koska se kuvaa
turvallisuusarkkitehtuuria, moduulirajoja ja kiellettyjä toteutustapoja.

Julkiseen dokumentaatioon saa kirjata esimerkiksi:

- että sähköpostisalaisuudet eivät kuulu frontendiin
- että SMTP-salasanaa ei hashata vaan käsitellään secret store -mallilla
- että DNA webmailia ei automatisoida selainkäyttöliittymän kautta
- että automaattinen lähetys tehdään SMTP/Gmail-providerin kautta backendissä
- että tuotannon oikeat salaisuudet pidetään Gitin ulkopuolella

Julkiseen Git-repositorioon ei saa kirjata:

- oikeita SMTP-salasanoja
- OAuth refresh tokeneita
- API-avaimia
- oikeita asiakkaiden sähköpostiosoitteita testidatana
- oikeita laskuja tai PDF-tiedostoja
- yrityskohtaisia salaisia sähköpostiasetuksia
- `.env`-tiedostoja

SMTP-hostien ja porttien kaltaiset julkiset palvelinasetukset eivät ole
sellaisenaan salaisuuksia, mutta ne kirjataan alustavina ja tarkistetaan vielä
palveluntarjoajan ajantasaisista ohjeista ennen tuotantototeutusta.

## Perusperiaate

Sähköposti toteutetaan toimitusputkenä, ei irrallisena nappina.

Eky saa myöhemmin lähettää laskuja automaattisesti käyttäjän vahvistuksen
jälkeen. Automaattinen lähetys tarkoittaa backendin hallittua
SMTP/Gmail/Microsoft-provideria, ei webmail-käyttöliittymän automatisointia.

Tuleva laskun sähköpostipolku:

```text
ApprovedInvoice
  -> backend varmistaa current PDF:n
    -> backend muodostaa sähköpostin vastaanottajan, otsikon, rungon ja liitteen
      -> EmailDeliveryProvider lähettää tai dry-run simuloi
        -> onnistunut oikea lähetys merkitsee laskun sent-tilaan
```

Jos lähetys epäonnistuu, laskun tila ei muutu `sent`-tilaan.

Frontend ei saa lähettää laskusähköpostia suoraan. Frontend voi näyttää
käyttäjälle lähetysikkunan ja pyytää käyttäjän vahvistuksen, mutta varsinainen
toimituspolku ja tilasiirtymä tehdään backendissä.

## Dry-run Ensimmäisenä Providerina

Dry-run ei ole manuaalinen sivupolku. Se on ensimmäinen provider samaan
lopulliseen lähetysputkeen.

Dry-run:

- ei lähetä oikeaa sähköpostia
- ei tarvitse sähköpostisalaisuuksia
- ei muuta laskun tilaa `sent`-tilaan
- palauttaa käyttäjälle esikatselun

Dry-run-esikatselussa näytetään ainakin:

- vastaanottaja
- otsikko
- viestirunko
- liitteen tiedot
- provider: `dryRun`

Tämä mahdollistaa sähköpostipolun turvallisen testaamisen ennen DNA SMTP-,
Gmail- tai muun oikean lähetysproviderin käyttöönottoa.

## Moduulirajat

Invoicing omistaa:

- laskun lähetyssäännöt
- mitä laskua saa lähettää
- current PDF -vaatimuksen
- laskukohtaisen vastaanottajan, otsikon ja viestin muodostuksen
- `sent`-tilaan siirtymisen
- laskutuksen audit- ja delivery-päätökset

Backend email infrastructure omistaa:

- teknisen sähköpostin lähetyksen
- provider-rajapinnan
- dry-run providerin
- nykyisen DNA SMTP -providerin sovituilla testi- ja asiakaslähetysrajoilla
- Gmail-providerin myöhemmin
- Microsoft Graph -providerin myöhemmin, jos sellainen päätetään toteuttaa

Email infrastructure ei saa:

- päättää laskun tilaa
- tuntea laskutusdomainin sisäisiä sääntöjä
- muuttaa laskuja
- hakea invoice-dataa omin päin
- kirjoittaa Invoicingin tietokantatauluihin

Mahdollinen tuleva backend-sijainti:

```text
apps/backend/src/infrastructure/email/
```

Mahdollisia tiedostoja myöhemmin:

```text
emailDeliveryProvider.ts
emailDeliveryTypes.ts
dryRunEmailDeliveryProvider.ts
smtpEmailDeliveryProvider.ts
gmailEmailDeliveryProvider.ts
```

`packages/email` on hyväksyttävä tuleva rakennevaihtoehto, jos sähköpostin
provider-sopimuksia, tyyppejä tai testattavia apuja tarvitsee käyttää useampi
moduuli tai sovelluskerros.

Ensimmäistä toteutusta ei kuitenkaan nosteta automaattisesti
`packages/email`-tasolle vain siksi, että sähköposti kuulostaa yleiseltä.
Paketilla pitää olla tarkka vastuu, kuten:

- sähköpostin tekniset provider-tyypit
- turvallinen send/dry-run input-output -sopimus
- provider-agnostiset email-osoitteen ja viestirakenteen tyypit
- testattavat, ei-liiketoiminnalliset email-apufunktiot

`packages/email` ei saa omistaa laskun tilaa, laskutuksen business-sääntöjä,
invoice-dataa, delivery-auditia tai asiakasdataa. Ne pysyvät Invoicing- ja
muiden omistavien moduulien vastuulla.

Jos ensimmäinen sähköpostitarve on vain backendin sisäinen laskutuspolku,
toteutus saa alkaa `apps/backend/src/infrastructure/email/`-kerroksessa ja
nousta myöhemmin `packages/email`-tasolle, kun jaettu vastuu on todellinen.

## Oma Yritys Ja Sähköpostiasetukset

Sähköpostin lähetysasetusten käyttäjälle näkyvä hallinta kuuluu Oma yritys /
Company Settings -alueelle tai myöhemmin laajempaan Asetukset-kokonaisuuteen.

Oma yritys saa näyttää ja muokata ei-salaisia asetuksia:

- provider: nykyisessä local-MVP:ssä `dryRun | dnaSmtp`
- lähettäjän nimi
- lähettäjän sähköpostiosoite
- reply-to myöhemmin
- username
- test recipient override
- tieto siitä, onko salaisuus asetettu: `true | false`

Kun provider on `dnaSmtp`, backend omistaa kiinteän yhteysprofiilin
`smtp.dnamail.fi:465` + implicit TLS. Hostia, porttia tai security-mallia ei
hyväksytä Company Settingsin päivityspyynnöstä eikä näytetä muokattavina
kenttinä. SQLiteen aiemmin tallennetut yhteysarvot eivät ohita tätä profiilia.
Mahdollinen Gmail- tai muu provider suunnitellaan myöhemmin omana adapterinaan;
sitä ei lisätä DNA-profiilin muokattavaksi variaatioksi.

Oma yritys ei saa koskaan näyttää:

- SMTP-salasanaa
- OAuth refresh tokenia
- Secret Managerin salaista arvoa
- Electron `safeStorage` -brokerista luettua salaista arvoa

UI tarjoaa local desktop -versiossa:

- Aseta/vaihda salasana
- Poista sähköpostiyhteys

Myöhemmin UI voi tarjota:

- Lähetä testiviesti
- Tarkista asetukset

Sähköpostiasetusten UI-sijainti ei muuta moduulivastuita. Company Settings voi
olla käyttäjälle asetusten näkyvä koti, mutta oikea sähköpostilähetys tapahtuu
backendin hallitun provider-rajapinnan kautta ja laskun tilasäännöt kuuluvat
Invoicing-moduulille.

## Salaisuuden Lifecycle

Sähköpostisalaisuuksilla pitää olla hallittu elinkaari.

Tuettavat tulevat toiminnot:

- salaisuuden asettaminen
- salaisuuden vaihtaminen
- salaisuuden poistaminen
- yhteyden tai asetusten testaus
- tieto siitä, onko providerin vaatima salaisuus asetettu

Jos valittu provider vaatii salaisuuden ja `secretRef` tai vastaava viite
puuttuu, oikea lähetys estetään.

Salaisuuden poistaminen ei saa poistaa ei-salaisia asetuksia, kuten lähettäjän
nimeä, lähettäjän osoitetta, username-arvoa tai testivastaanottajaa.

Yhteyden testaus ei saa lähettää oikealle asiakkaalle. Testaus käyttää
dry-runia tai erillistä test recipient override -osoitetta.

Salaisuuden vaihtaminen ei saa palauttaa vanhaa salaista arvoa frontendille.
UI voi näyttää vain esimerkiksi `configured: true`.

## Salaisuuksien Käsittely

SMTP-salasanaa tai OAuth refresh tokenia ei hashata, koska niitä pitää käyttää
myöhemmin lähetyshetkellä.

Hash sopii käyttäjän kirjautumissalasanan tarkistamiseen, kun salasanaa ei
tarvitse saada takaisin alkuperäisessä muodossa. Sähköposti-integraation
salaisuudet kuuluvat secrets management -malliin, koska providerille pitää
lähetyshetkellä antaa käyttökelpoinen salaisuus.

Sähköpostisalaisuudet eivät saa:

- mennä Git-repositorioon
- mennä frontendille
- näkyä API-vastauksissa
- näkyä lokissa
- tallentua selaimen localStorageen
- tallentua tavalliseen näkyvään tietokantakenttään
- näkyä testifixtureissä oikeina arvoina

Salasana kulkee asetushetkellä välttämättä hetkellisesti käyttäjän suojatussa
salasanakentässä, API-clientin request-mallissa ja backendin validoidussa
pyynnössä. Web ei pidä arvoa React-tilassa, ei esitäytä sitä eikä kirjoita sitä
localStorageen, sessionStorageen tai muuhun pysyvään selainvarastoon.
Onnistuneen asetuksen jälkeen kenttä tyhjennetään. API palauttaa vain
`configured: true | false` -tilan.

Tietokantaan voidaan myöhemmin tallentaa vain esimerkiksi `secretRef`,
`configured: true` tai vastaava ei-salainen viite.

Virhetilanteissa providerin tekninen virhe muunnetaan käyttäjälle turvalliseksi
viestiksi. Salaisuuksia, SMTP-käyttäjätunnuksia, tokenin osia tai providerin
raakoja debug-vastauksia ei näytetä käyttäjälle eikä kirjoiteta lokiin.

## SMTP-Liikenteen Salaus

SMTP-lähetys saa käyttää vain salattua yhteyttä.

Eky local-MVP:n ensimmäinen ja ensisijainen SMTP-malli on:

- portti `465`
- implicit TLS heti yhteyden muodostamisesta
- vähintään TLS `1.2`; TLS `1.3` sallitaan
- autentikointi vaaditaan

TLS-yhteyden pitää muodostua ennen SMTP-komentoja ja tunnistautumista.
SMTP-adapterin pitää validoida palvelimen sertifikaatti ja hostname. TLS-virhe
estää lähetyksen, eikä salaamattomaan yhteyteen saa pudota.

Portti `587` ja pakollinen STARTTLS säilytetään dokumentoituna myöhempänä
yhteensopivuusvaihtoehtona. Sitä ei toteuteta ensimmäisessä local-MVP
SMTP-adapterissa, eikä portista `465` tehdä automaattista fallbackia porttiin
`587`.

Porttia `25` ei tueta Eky local-MVP:ssä.

RFC 8314:n mukaan portin `465` implicit TLS ja portin `587` pakollinen
STARTTLS ovat oikein toteutettuina ilman merkittävää turvallisuuseroa.
Standardi suosittelee implicit TLS -mallia. Eky valitsee sen ensimmäiseen
local-MVP-adapteriin turvallisuus- ja konfiguraatioyksinkertaisuuden vuoksi.

SMTP:n implicit TLS ja myöhempi mahdollinen STARTTLS-yhteensopivuusvaihtoehto
suojaavat liikenteen Eky-backendin ja SMTP-palvelimen välillä. Tämä ei ole
päästä päähän -salaus. Sähköpostipalveluntarjoaja ja vastaanottajan
sähköpostipalvelin voivat normaalin sähköpostitoimituksen osana käsitellä
viestin ja PDF-liitteen.

Jos myöhemmin vaaditaan suojaus, jossa edes sähköpostipalveluntarjoaja ei voi
lukea viestiä tai liitettä, se pitää suunnitella erikseen esimerkiksi PGP- tai
S/MIME-tyyppisenä päästä päähän -salauksena. Tämä ei kuulu MVP-laskutuksen
sähköpostipolkuun.

SMTP-adapterin tulevissa testeissä tarkistetaan vähintään:

- lähetys ei onnistu ilman implicit TLS -suojausta
- TLS muodostuu ennen SMTP-komentoja ja tunnistautumista
- TLS-virhe estää lähetyksen
- virheellinen sertifikaatti tai hostname estää lähetyksen
- salaamatonta tai porttiin `587` siirtyvää automaattista fallbackia ei tehdä
- SMTP-salasana ei päädy lokiin
- SMTP-salasanaa ei palauteta frontendille
- viestin runko tai PDF-sisältö ei päädy lokiin
- dry-run ei tarvitse salaisuuksia

Nykyinen testikokonaisuus toteuttaa nämä tarkistukset paikallisella
synteettisellä TLS-palvelimella ja testivarmenteella. Se kattaa luotetun CA:n
ja oikean hostnamen lisäksi väärän hostnamen, tuntemattoman CA:n, liian vanhan
TLS-version, keskeytetyn handshake-vaiheen sekä aikakatkaisun. Testit eivät
avaa verkkoyhteyttä DNA:n palvelimeen. SMTP DATA -syöte validoidaan raakoina
tavuina ennen ASCII-muunnosta, ja odottamattomat tai ylimääräiset
palvelinvastaukset katkaisevat session turvallisesti ilman rajatonta jonoa.

## Local Electron -Malli

Paikallisen Windows-version toteutettu secret store -pohja:

- Eky ajetaan paikallisesti käyttäjän koneella
- backend kuuntelee vain `localhost` / `127.0.0.1`
- Electron main process käyttää yksin `safeStorage.isEncryptionAvailable()`-,
  `safeStorage.encryptStringAsync()`- ja `safeStorage.decryptStringAsync()`-
  metodeja
- koko payload salataan ennen kirjoittamista versionoituun tiedostoon
  `userData/runtime/secrets/company-email-smtp-v1.dat`
- tiedostonimi ei sisällä yritystä, sähköpostiosoitetta, käyttäjätunnusta,
  salaisuutta tai sen hashia
- backend utility process käyttää main processin brokeria vain yksityisen
  siirrettävän `MessagePort`-kanavan kautta
- Company Settingsin application- ja response-malli saa paljastaa vain tiedon
  `configured: true | false`; salattu arvo säilyy erillisessä `userData`-
  blobissa eikä SQLite-taulussa
- myöhempi SMTP-provider hakee salaisuuden backend-only reader -portin kautta
- frontend ei koskaan saa salaista arvoa takaisin
- jos `safeStorage` ei ole käytettävissä, salaus tai purku epäonnistuu tai blob
  on vioittunut, toiminto epäonnistuu ilman plaintext-fallbackia

Selainkehitys käyttää edelleen vain dry-runia eikä saa oikeaa SMTP-salaisuutta.
Salaisuutta ei siirretä URL:ssa, komentorivillä, ympäristömuuttujassa, renderer-
tallennuksessa, lokissa tai crash-raportissa. `safeStorage.setUsePlainTextEncryption()`
ja synkroniset encrypt/decrypt-metodit eivät kuulu Eky Localin malliin.

Main processin broker ei omista Company Settingsin tai sähköpostitoimituksen
liiketoimintasääntöjä. `CompanyEmailSecretStore` ja backend-only
`CompanyEmailSecretReader` säilyvät Electronista riippumattomina portteina.

Company Settingsin `emailSecretConfigured`-tila muodostetaan desktop-
runtimessa secret storen todellisesta tilasta. Selainkehityksen backendissä
tila pysyy epätotena, joten web-UI estää oikean DNA SMTP -testin mutta jättää
paikallisen dry-run-polun käytettäväksi.

### Secret Store -Toteutuksen Turvallisuusportti

Local-MVP-backend on sidottu loopback-osoitteeseen. Electron-runtimessa backend
vaatii main processin muistissa luodun local-sessionin ja muodostaa vasta sen
varmennuksen jälkeen luotetun `ActorContext`-olion. Application-palvelut
tarkistavat sähköpostisalaisuuden permissionin. Loopback ja tämä ensimmäinen
luottamusraja eivät kuitenkaan yksin tee vielä keskeneräisestä paketista
tuotantovalmista salaisuuksien käsittelijää.

Ennen kuin Eky saa vastaanottaa tai tallentaa oikean SMTP-salasanan, pitää
hyväksyä local-käytön luottamus- ja valtuutusmalli. Siinä ratkaistaan vähintään:

- miten backend tunnistaa luotetun paikallisen Eky-käyttöliittymän
- miten salaisuuden asettamis-, vaihtamis- ja poistamispyynnöt suojataan
- miten origin-, CSRF- ja paikallisen prosessin väärinkäyttöriski rajataan
- miten käyttäjä ja `companyId` saadaan backendin vahvistamasta kontekstista
- miten salaisuuden lifecycle auditoidaan ilman salaisen arvon lokitusta
- miten release security review tehdään ennen oikean sähköpostitilin käyttöä

Turvallisuusportin alla on toteutettu rajattuja teknisiä valmiuksia ja niiden
automaattiset testit vain synteettisillä arvoilla:

- provider-agnostinen secret store -portti ja backend-only reader-portti
- testien fake- ja in-memory-adapterit
- salaisuuden lifecycle -application servicet
- turvalliset tyypit, joissa salainen arvo ei päädy response-malliin
- Electron main processin `safeStorage`-broker ja salattu tiedostoadapteri
- desktop-sessionilla suojatut HTTP-reitit, API-client ja erillinen UI-paneeli

Ensimmäinen rajattu valmius on toteutettu Company Settings -moduuliin:

- providerista riippumaton `CompanyEmailSecretStore`-portti tukee salaisuuden
  asettamista, olemassaolon tarkistamista ja poistamista
- Company Settings -portti ei palauta salaisuutta; tuleva SMTP-provider saa
  tarvittaessa oman kapean backend-only reader-sopimuksen
- salaisen syötteen validointi säilyttää arvon muuttamattomana eikä sisällytä
  sitä virheviesteihin
- response-malli ei sisällä salaista arvoa

Lifecycle-application servicet on toteutettu yhteisen `ActorContext`- ja
permission-sopimuksen päälle. Salaisuuden asettaminen, poistaminen ja tilan
tarkistaminen vaativat `manageCompanyEmailSecret`-permissionin ja käyttävät
vain actor-kontekstin `companyId`-arvoa. Ne palauttavat vain salaisuuden
konfigurointitilan eivätkä salaista arvoa.

Salaisuuden asettaminen ja poistaminen käyttävät yhden rivin lifecycle-auditia.
Ennen secret store -operaatiota luodaan `pending`. Sama rivi päivitetään
`succeeded`-tilaan vasta valmistuneen store-operaation jälkeen. `failed`
vaatii tyypitetyn, varmasti vaikutuksettoman `noEffect`-tuloksen. Tuntematon
poikkeus, osittainen muutos tai kadonnut kuittaus jättää rivin `pending`-
tilaan. Myös auditin loppukirjoituksen virhe säilyttää `pending`-rivin;
sitä ei teeskennellä epäonnistuneeksi tallennukseksi eikä myöhempi tilaluku
ratkaise sitä automaattisesti.

### D2:n Sulku ja Epävarma Tulos

Hyväksytty [D2-sulkusopimus](release-0.3.0-company-settings-plan.md#sulkusopimusehdotus-kokeen-jälkeen)
säilyttää nykyisen salauksen, tiedostomuodon ja `EncryptedSecretFile`-
kirjoittajan. Sen toteutus ja integraatiohyväksyntä seurataan D-suunnitelmassa.
Brokerin viesti sidotaan nykyiseen sukupolveen, pyyntöön, operaatioon ja
backendin vahvistamaan yrityskontekstiin. Mainin pääsyn sulku hylkää uudet
ja aloittamattomat työt; aktiivisen työn yhteinen monotoninen odotus on
enintään viisi sekuntia. Clientin kymmenen sekunnin raja ei peruuta jo
alkanutta tiedostotyötä. Myöhäinen valmistuminen ei poista epävarmuutta.

Mainin työn loppu, backendin vastauksen käsittely, auditin loppukirjaus ja
prosessin todellinen poistuminen ovat erillisiä jatkoehtoja. Audit-incomplete
tai epävarma vaikutus sulkee saman ajon uudet salaisuusoperaatiot. HTTP-
yhteyden päättyminen ei yksin riitä. Virheessäkin yritetään omistetut sulut;
siivouksen onnistuminen ei muuta ensimmäistä virhettä onnistumiseksi.

Compositionin pääsyn sulku välitetään samassa synkronisessa jatkossa
nykyiselle broker-clientille (`sealCompanyEmailSecretAdmission` ->
`sealAdmission`). Jonottavan adapterin runtime-kytkentä antaa tämän portin;
se ei tee I/O:ta tai odota. Client hylkää lähettämättömät pyynnöt
vaikutuksettomina ja estää uuden lähetyksen, mutta säilyttää aktiivisen
pyynnön, sen alkuperäisen määräajan ja kuittauksen auditin loppua varten.
Pääsyn sulku ei ole transportin close eikä todistus aktiivisen työn lopusta.
Backendin jo todettu epävarmuus ei poistu myöhemmällä kuittauksella.

Backendin Company Settings -composition omistaa saman ajon pääsyeston myös
providerille annettavalle `CompanyEmailSecretReader`-portille. `createApp`
ei anna raakaa reader-adapteria suoraan Invoicingin compositionille.
Luku kuuluu aktiivisen salaisuustyön laskentaan. Omistajan viimeinen
odotuksen jälkeinen tarkistus, aktiivisuuslaskurin vähennys ja suoraan
palautettavan lukulupauksen valmistuminen tapahtuvat ilman uutta odotusta.
Ennen tätä valmistumista syntynyt epävarmuus estää arvon palauttamisen.
Valmistuneen lukulupauksen arvoa ei peruta jälkikäteen: tämä ei ole
SMTP-transportin alkamiseen asti jatkuva atominen valtuutus.
Vaikutukseltaan tuntematon
lukupoikkeus sulkee saman ajon uudet operaatiot, mutta todistettu noEffect
ei yksin tee sitä. Jo SMTP-transportiin edennyttä toimitusta ei peruta tai
kirjata uudelleen tämän eston perusteella. Reader säilyy backend-only-
porttina eikä kuulu asetusten HTTP-reiteille. Tavallisen selainkehityksen
puuttuva adapteri palauttaa edelleen `null` terveessä ajossa.

Epäonnistuva mainin drain välittää ensimmäisen turvallisen syykoodin
nykyiseen `desktop.shutdownFailed`-tapahtumaan, vaiheena
`secretBrokerDrain`, `retryable: false` ja `sideEffectState: unknown`.
Saman sulun havainto syntyy vain kerran, eikä varhainen transport-häiriö
yksin väitä sulun jo alkaneen. Yleinen sulkulopputulos on erillinen tapahtuma.
Havaitsijan virhe tai kesken jäävä ilmoitus ei muuta tulosta tai lisää
kuittausodotusta sulun kriittiseen polkuun. Raakapoikkeus tai salaisuus ei
kuulu näihin operational-tapahtumiin.

HTTP:n turvalliset tulokset ovat `COMPANY_EMAIL_SECRET_OPERATION_FAILED`,
`COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN` ja `COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE`.
Käyttöliittymä erottaa tuntemattoman tilan puuttuvasta salasanasta, estää
automaattisen uusinnan eikä hyväksy vanhan session vastausta uuteen sessioon.
Vaikutuksettoman muutosvirheen ilmoitus kuitataan ennen yrityksen vaihtoa
tai muuta sulkuun liittyvää uudelleenkäynnistystä. Epävarmuus estää vaarallisen
jatkon; nykyinen hallitun uudelleenkäynnistyksen sopimus säilyy.

Auditissa ovat vain operaatiotunniste, toiminto, tila, yritys, toimija,
aloitus- ja valmistumisaika sekä turvallinen failure code. Audit-tauluun ei
tallenneta salasanaa, hashia, pituutta, ciphertextiä, tiedostopolkua,
`secretRef`-arvoa tai muuta salaisuudesta johdettua tietoa.

Local secret store käyttää yhtä versionoitua teknistä slotia
`company-email-smtp-v1`. Salattu payload sisältää formaattiversion, `companyId`-
arvon ja salaisuuden. Broker varmistaa luettaessa yrityksen täsmäämisen. Väärä
yritys ei saa tietoa salaisuuden arvosta.

Tiedostoadapteri käyttää deterministisiä `current`, `.next` ja `.backup`-
slotteja. Kelvollinen current-arvo voittaa ja vanhat palautumisjäämät
poistetaan. Jos current puuttuu, kelvollinen backup palautetaan ennen next-
arvoa. Ensimmäisen kirjoituksen keskeytyessä kelvollinen next voidaan nostaa
current-arvoksi. Vioittunutta current- tai palautumistiedostoa ei korvata
hiljaa toisella arvolla. Salaisuuden poistaminen poistaa kaikki kolme slottia.

Palvelut on kytketty vain Electron desktop -runtimessa rekisteröitäviin
HTTP-reitteihin. Local desktop -session, backendin vahvistama actor-konteksti,
permission, lifecycle-audit ja `safeStorage`-broker suojaavat polkua. Tavallinen
selainkehityksen backend ei rekisteröi reittejä eikä voi tallentaa salaisuutta.

Automaattiset testit ja Windows-integraatiosmoke käyttävät vain selvästi
synteettisiä salaisuuksia. Oikea käyttäjän SMTP-salaisuus otetaan
käyttötestiin vasta erikseen hyväksytyn SMTP-providerin, pakotetun
testivastaanottajan ja release security review -tarkistuksen yhteydessä.

Local- ja cloud-ympäristöille yhteinen actor context, local-sessionin
turvallisuusrajat sekä luotetun `companyId`-kontekstin eteneminen on kuvattu
dokumentissa
`docs/architecture/local-runtime-trust-and-authorization-plan.md`.

## Pilvimalli Myöhemmin

Pilviversion suositeltu malli:

- HTTPS aina
- käyttäjän tunnistus ja käyttöoikeudet backendissä
- Secret Manager / KMS / vastaava palvelu salaisuuksille
- service account -oikeudet least privilege -periaatteella
- salaisuuksia ei tallenneta näkyvänä PostgreSQL/SQLite-tauluihin
- sähköpostilähetys auditoidaan
- test/staging-ympäristössä dry-run tai test recipient override oletuksena
- tuotannossa oikea lähetys vaatii erillisen konfiguraation

Pilviversiossa sähköposti-infrastruktuuri ei saa riippua Electronista tai
paikallisen koneen `safeStorage`-toteutuksesta. Local- ja cloud-secret-adapterit pidetään
vaihdettavina infrastructure-tason toteutuksina.

## DNA SMTP

DNA-sähköpostitilin automaattinen lähetys toteutetaan myöhemmin SMTP:n kautta,
ei DNA webmail -käyttöliittymää automatisoimalla.

DNA webmail:

- käyttäjä voi avata sen itse manuaalisesti
- Eky ei kirjaudu webmailiin käyttäjän puolesta
- Eky ei automatisoi webmail UI:ta
- Eky ei lue webmailin sisältöä selainautomaatiolla

Kiellettyä:

- webmailin klikkailu ohjelmallisesti
- webmailin scraping
- webmailin iframe- tai selainohjaus laskun lähettämiseksi
- käyttäjän webmail-istunnon kaappaaminen tai hyödyntäminen

DNA SMTP voidaan toteuttaa myöhemmin käyttäjän toimittamien ja ennen
tuotantototeutusta tarkistettujen asetusten perusteella.

DNA SMTP local-MVP:n kiinteä yhteysprofiili:

- ensisijainen host: `smtp.dnamail.fi`
- portti: `465`
- security: implicit TLS heti yhteyden muodostamisesta
- vähimmäisversio: TLS `1.2`; TLS `1.3` sallitaan
- authentication: required
- username: käyttäjän koko DNA-sähköpostiosoite, esimerkiksi
  `osoite@dnainternet.net`
- password: postilaatikon salasana, joka tallennetaan myöhemmin vain secret
  storeen
- porttia `25` ei tueta local-MVP:ssä

Eky esitäyttää SMTP username -kentän lähettäjän sähköpostiosoitteella niin
kauan kuin käyttäjä ei ole muokannut username-arvoa erikseen. DNA SMTP
-profiilissa lähettäjän osoitteen ja username-arvon pitää olla sama
sähköpostiosoite; backend tarkistaa tämän ennen asetusten tallentamista ja
provider tarkistaa saman vielä ennen salaisuuden lukua tai verkkoyhteyttä.

Portti `587` ja pakollinen STARTTLS voidaan toteuttaa myöhemmin erillisenä
yhteensopivuusvaihtoehtona. Ensimmäinen local-MVP SMTP-adapteri ei tue sitä,
eikä se tee automaattista fallbackia portista `465` porttiin `587`. Myöskään
automaattista host-fallbackia ei tehdä local-MVP:ssä.

DNA:n julkisista ohjeista voidaan vahvistaa SMTP-palvelun olemassaolo,
sähköpostiosoitteen käyttö kirjautumistunnuksena sekä portin `25` rajoitukset.
Julkisesta ajantasaisesta DNA-ohjeesta ei ole tämän päätöksen yhteydessä voitu
vahvistaa kiinteän `smtp.dnamail.fi:465`-profiilin tilikohtaista sopivuutta.
Profiili on siksi Eky local-MVP:n hyväksytty ja rajattu testiprofiili, joka
vahvistetaan vielä käytettävän postilaatikon omasta ohjeesta tai DNA:n
asiakaspalvelusta ennen ensimmäistä oikeaa lähetystä. Epävarmuutta ei ratkaista
automaattisella host-, portti- tai salaamattomalla fallbackilla.

Käyttäjä voi myöhemmin syöttää Oma yritys / Sähköpostiasetukset -näkymässä
tarvittavat SMTP-asetukset ja salaisuuden asettamisen. Salaisuutta ei näytetä
käyttäjälle takaisin. Backend tallentaa tai viittaa siihen turvallisen secret
store -mallin kautta ja käyttää sitä lähetyshetkellä.

Lopulliset DNA-asetukset tarkistetaan vielä ennen tuotantototeutusta DNA:n
ajantasaisista ohjeista ja käytettävän sähköpostitilin asetuksista.

## Gmail

Gmail toteutetaan myöhemmin mieluummin OAuth + Gmail API -mallilla kuin
tallentamalla tavallinen Gmail-salasana.

Gmail-linja:

- käyttäjä kirjautuu Googlen omaan näkymään
- Eky saa rajatun lähetysoikeuden
- refresh token käsitellään salaisuutena
- Gmail ei ole ensimmäinen pakollinen provider
- Gmail-provider toteutetaan myöhemmin erikseen

Gmailin tavallista salasanaa ei tallenneta Ekyyn.

## Tuleva Laskunäkymän Käyttökokemus

Hyväksytyn laskun näkymässä "Lähetä lasku" on manuaalisen
"Merkitse käsin toimitetuksi" -toiminnon rinnalla. Manuaalinen toiminto pyytää
rajatun toimitustavan ja kirjoittaa auditoidun delivery eventin;
sähköpostitoiminto käyttää erillistä vahvistettua SMTP-polkuansa.

"Lähetä lasku" avaa lähetysikkunan:

- toimitustapa: sähköposti / tulostus / manuaalinen
- vastaanottaja esitäytetään billing recipient/customer email snapshotista
- vastaanottajan sähköpostiosoitetta voi muuttaa käsin joka lähetyksessä
- otsikko generoidaan laskunumerosta ja yrityksen nimestä
- viestirunko generoidaan mallipohjasta
- liitteenä on current PDF
- käyttäjä vahvistaa ennen lähetystä

Dry-run-vaiheessa sama näkymä näyttää esikatselun, mutta ei lähetä mitään eikä
muuta laskua `sent`-tilaan.

## Oikean Lähetyksen Turvallisuusvaatimukset

**Hyväksytty nykyinen sopimus:**
[säilytetyn PDF:n täsmävaltuutus](#säilytetyn-pdfn-täsmävaltuutus)
lisää alla olevaan current-PDF-sääntöön erillisen, eksplisiittisesti
vahvistettavan säilyneen dokumentin lähetyspolun. Se ei regeneroi PDF:ää eikä
väitä vanhan toimituksen sisältöä takautuvasti varmennetuksi. Muut lähetykset
pysyvät nykyiseen hyväksyttyyn revisioon sidottuina. Puuttuva tai ristiriitainen
aineisto ja ratkaisematon toimitus estävät legacy-polun.

Sähköpostilomakkeen esivalmistelu (`email/dry-run`) palauttaa nyt
backendin valitseman `documentTarget`-kohteen: `revision` tai
`preservedLegacy` sekä liitteen kanssa täsmäävä dokumentti-ID. Legacy-haara
valmistelee tarkistetun säilytetyn kopion ja neutraalin viestipohjan ilman
snapshotista pääteltyjä maksutietoja. Tämä ei ole toimitus tai SMTP-
valtuutus. Nimetyn kopion kirjoittamaton HTTP-luku ja desktopin nykyisen
esikatselun tarkka dokumenttikohde on kytketty ja kohdetestattu. Lomakkeen
säilytetyn liitteen avaus välittää tämän täsmäkohteen eikä generoi PDF:ää
tai lue nykyrevision metadataa. Uusi valmistelu mitätöi vanhan esikatselun;
myöhäinen vastaus tai vanhan avauksen virhe ei vaihda nykyistä kohdetta.
Selaimen popup-avaus ei vielä vahvista itse PDF-vastauksen onnistumista.
Customer-prepare ja send vaativat saman täsmäkohteen; backend päättää
alkuperän pysyvästä tilasta ja tarkistaa tavut kummassakin vaiheessa.
Desktopin erillinen vahvistus näyttää säilytetyn sisällön historiallisen
rajan. Puuttuva vahvistaja estää valmistelun ennen backend-kutsua;
peruutus tai kohdepoikkeama ei palauta kertalupaa rendererille.
Nykyinen 60 sekunnin valtuutus ja atominen varaus säilyvät. Itselle-SMTP
ja dry-run-send pysyvät revision polkuina. B:n hyväksyntä ei poista uuden muutoksen native-, palautus- tai PR/main-portteja.
Täsmällinen nykyinen protokolla on [alla](#säilytetyn-pdfn-täsmävaltuutus).

Durablen onnistumisen jälkeinen laskun lukuhäiriö palauttaa erillisen
`INVOICE_DELIVERY_COMMITTED_READ_FAILED`-koodin (409). API-client säilyttää
sen ja UI kertoo toimituksen onnistuneen sekä pyytää tarkistamaan historian
lähettämättä uudelleen. Yleinen konflikti, tuntematon virhe tai epävarma
SMTP-tulos ei muutu tällä onnistumiseksi. UI ei arvaa päivitettyä laskua
eikä lisää automaattista uusintaa. Backendin pysyvä tulos ja nykyinen
diagnostiikkaketju säilyvät auktoritatiivisina.

Oikea SMTP/Gmail-lähetys vaatii nykyisen sopimuksen mukaan vähintään:

- PDF varmistetaan backendissä
- revision polku lähettää vain tarkasti valtuutetun nykyrevision PDF:n;
  preservedLegacy on alla rajattu erikseen vahvistettava poikkeus
- vastaanottaja näytetään käyttäjälle ennen lähetystä
- tyhjä vastaanottaja estää lähetyksen
- käyttäjän vahvistus vaaditaan
- dev/test-tilassa oikea lähetys estetään oletuksena
- test recipient override voidaan pakottaa
- onnistunut lähetys merkitsee laskun `sent`-tilaan backendin hallitussa
  transaktiossa
- epäonnistunut lähetys ei merkitse laskua `sent`-tilaan
- salaisuudet redaktoidaan lokeista
- providerin teknisiä virheitä ei näytetä käyttäjälle sellaisenaan

Lähetystapahtuma auditoidaan `invoice_delivery_events`-mallilla. Audit- tai
delivery-loki ei saa tallentaa
sähköpostisalaisuuksia, OAuth-tokenia, SMTP-salasanaa tai tarpeettoman pitkiä
provider-debug-vastauksia.

Delivery event -mallin, send-polun auditoinnin ja uudelleenlähetyksen tarkempi
suunnitelma on dokumentissa
`docs/architecture/invoice-delivery-events-plan.md`.

## Deliverability-tuotantotarkistus

Ennen oikeaa tuotantolähetystä tarkistetaan sähköpostin perillemenoon liittyvät
asiat.

Tarkistettavia asioita:

- lähettäjän domain ja lähettäjän osoitteen oikeellisuus
- SPF
- DKIM
- DMARC
- roskapostiriski
- palveluntarjoajan lähetysrajat
- test recipient override test/staging-ympäristöissä

Näitä ei tarvita dry-run-vaiheessa, mutta oikeaa SMTP/Gmail-tuotantolähetystä
ei pidetä valmiina ennen deliverability-tarkistusta.

## Ei Vielä Toteuteta

Seuraavaan vaiheeseen jäävät:

- Gmail-provideria
- Secret Manager -adapteria
- tuotantoon vapautettua asiakaslähetystä ennen release security gatea
- `packages/email`-pakettia

SMTP-kirjastoa tai muuta uutta riippuvuutta ei lisätä ilman erillistä
riippuvuusarviota ja projektin omistajan nimenomaista hyväksyntää.

## Seuraava Toteutusjärjestys

1. Provider-agnostinen secret store -portti, salaisuuden lifecycle ja lifecycle-
   auditointi synteettisillä testiarvoilla on toteutettu.
2. Local-session, pysyvä local-runtime-identiteetti, nykyisten reittien actor
   context -yritysrajaus ja yhden rivin secret-audit on toteutettu ennen
   oikeita salaisuuksia vastaanottavia HTTP- tai UI-polkuja.
3. Electron main processin `safeStorage`-broker, salattu tiedosto ja yksityinen
   utility process -client on toteutettu ilman uutta riippuvuutta.
4. Desktop-sessionilla suojattu HTTP-, API-client- ja UI-lifecycle on
   toteutettu. Paketoitu Windows-smoke varmistaa koko elinkaaren synteettisellä
   salaisuudella ja kaikkien salattujen tiedostoslottien poistumisen.
5. Riippuvuudeton sisäinen SMTP/MIME-kuljetuskerros ja sen turvallisuus- sekä
   protokollatestit on toteutettu.
6. DNA SMTP -providerin rajattu testitila on toteutettu käyttäen vain porttia
   `465`, implicit TLS -mallia ja lukittua ensisijaista hostia. Provider
   pakottaa test recipient override -osoitteen ja jättää Cc:n pois, jotta
   viesti ei voi lähteä vahingossa asiakkaalle.
7. DNA SMTP -testiprovider on kytketty hallittuun backend-, HTTP-, API-client-,
   desktop- ja web-polkuun. Prepare-vaihe luo lyhytikäisen kertakäyttöisen
   valtuutuksen, joka sidotaan actoriin, yritykseen, laskuun, provideriin,
   testivastaanottajaan ja lähetettävien kenttien fingerprintiin. Fingerprint
   sitoo lisäksi lähettäjän nimen ja osoitteen sekä PDF:n tunnisteen,
   SHA-256-tiivisteen, tiedostonimen ja koon. Desktop näyttää ennen send-vaihetta
   main processin vahvistuksen. Send-vaihe hyväksyy
   valtuutuksen vain kerran, estää rinnakkaisen yrityksen ja käyttää lyhyttä
   varoaikaa onnistuneen tai epäselvän lopputuloksen jälkeen. Testi kirjaa
   `attempted`-tapahtuman ennen
   provider-kutsua, viimeistelee saman tapahtuman tilaan `succeeded`, `failed`
   tai `outcomeUnknown`, pakottaa testivastaanottajan eikä muuta laskun tilaa.
8. Oikean DNA-tilin ensimmäinen verkkoyhteystesti on tehty projektin omistajan
   erikseen vahvistamaan testipostilaatikkoon. Oikeaa salasanaa ei annettu
   chattiin, komentoriville, ympäristömuuttujaan, testifixtureen tai lokiin.
9. Asiakaslähetyksen prepare/send-käyttötapa, Electron-vahvistus, delivery
   eventin tilat ja onnistuneen lähetyksen atominen `sent`-tilasiirtymä on
   toteutettu. Asiakaslähetyksen kertavaltuutus käyttää samaa lähettäjään,
   viestikenttiin ja PDF:n identiteettiin sidottua fingerprintiä kuin hallittu
   testipolku. Epäonnistunut tai lopputulokseltaan epäselvä lähetys ei muuta
   laskun tilaa. Oikean asiakasdatan tuotantokäyttö odottaa erillistä release
   security gatea.

R0:n SMTP-failure-instrumentointi, turvallisuusportin ja diagnostiikkametadatan
erotus sekä Diagnostics- ja tukipakettiprojektiot on toteutettu. Tämä
tekninen toteutus ja dokumentaatio eivät yksin muodosta oikeudellista
compliance-sertifiointia.

Hyväksytyssä B-kokonaisuudessa
[revision toimitussopimus](invoice-delivery-events-plan.md)
tarkentaa tätä ketjua: `invoice-email-send-v3` sitoo fingerprintiin myös
revision tai säilytetyn alkuperän avaimen. Prepare ja send käyttävät samaa
tarkistettua täsmädokumentin lukupolkua, eivät uusimman esikatselun valintaa;
prepare tyhjentää väliaikaisen PDF-puskurin. Send varaa pysyvän tapahtuman
atomisesti ennen provideria, ja loppukuittaus käyttää palautettua varausta.
Unresolved-esto säilyy uuden sovellusinstanssin yli eikä riipu pelkästä
muistissa olevasta kertavaltuutuksesta. Uutta jonoa tai automaattista
uudelleenlähetystä ei lisätä. B:n hyväksyntä sisältää tämän ketjun;
uuden muutoksen UI/native-, palautus- ja PR/main-portit säilyvät.

Ensimmäinen oikea SMTP-lähetys saa olla synkroninen. UI näyttää lähetyksen
olevan käynnissä ja estää saman toiminnon uudelleen pyynnön aikana. Backend
käyttää rajattua timeoutia.

Queue-, background worker- tai outbox-rakennetta ei tehdä ensimmäiseen
SMTP-vaiheeseen. Providerin jälkeisen tallennusvirheen pysyvän epävarmuuden
ja durablen onnistumisen jälkilukuvirheen omistaa nykyinen
[varaus- ja loppukuittaussopimus](sqlite-invoice-delivery-event-persistence-plan.md#completion-ja-tuloksen-auktoriteetti).
Mahdollinen tuleva outbox/background worker tai uusi pending/queued-malli
vaatii erillisen päätöksen; se ei ole nykyisen B-kokonaisuuden puuttuva toteutuspala.

## Säilytetyn PDF:n täsmävaltuutus

Tämä osuus omistaa legacy-uudelleenlähetyksen ja sen HTTP/client/native-
valtuutuksen. Se ei hyväksy uutta sähköpostiprovideria tai D:n secret-timeout-
politiikkaa. [PDF-julkaisu](invoice-print-data-foundation-plan.md#revision-pdf-julkaisu-ja-täsmäluku)
omistaa tiedostokopion; [varaus ja completion](sqlite-invoice-delivery-event-persistence-plan.md#nykyinen-varaus-ja-loppukuittaus)
pysyvän sivuvaikutusrajan.

### Legacy-kelpoisuus ja selvitysesto

Sent/legacySnapshot-laskun `InvoiceLegacyResendReader` vaatii yksiselitteisen
alkuperäisen tapahtuma/dokumenttiketjun. Valinta, kopion IMMEDIATE-julkaisu
ja lähetysvaraus tarkistavat saman ehdon; olemassa oleva kopio ei ohita sitä.
Useat samaan lähteeseen viittaavat ehjät tapahtumat eivät yksin ole ristiriita.
Puuttuva vanha document-viite, ristiriitainen historia, attempted/outcomeUnknown
tai tunnettu R12-yhteensopiva epäselvä failed-jälkitila eivät korjaannu
myöhemmällä ehjällä dokumentilla/tapahtumalla. Vastaanottaja, aika tai
audit-heuristiikka ei todista vanhaa moodia tai PDF-sisältöä.

Vanha yhä approved-lasku, jolla on tuntemattoman tarkoituksen SMTP-historia,
torjutaan 409/`INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED`-selvitysestolla ennen
PDF-, sähköpostiasetus-, valtuutus- tai provider-sivuvaikutuksia ja uudelleen
kirjoitustransaktiossa. Reopen, uusi lähetys ja lähetetyksi merkintä estetään;
lasku, historia ja alkuperäinen PDF säilyvät luettavina.
Ei automaattista vapautusta, admin-korjaus-UI:ta tai arvattua testimoodia.
Tämä ei muuta ehjän sent-legacy-laskun rajattua resend-politiikkaa.
Ei-SMTP-approved-legacy-siirtymän omistaa
[hyväksyntäsopimus](invoice-approval-numbering-plan.md#reopen-ja-vanhan-sisällön-siirtymä).

`invoiceDelivery.prepareBlocked` käyttää stage=prepare, retryable=false,
sideEffectState=none ja turvallista selvityseston koodia. Varoitus kuuluu
Diagnosticsiin ja tukipaketin tapahtumiin, ei pitkän ajan error/security-
incident-indeksiin. Business audit/Activity ei muutu; logger ei peitä tulosta.
UI käyttää vain täsmällistä status/koodiparia eikä tee edeltävää ylimääräistä
PDF-kutsua, joka peittäisi eston geneerisellä PDF-virheellä.

### Esivalmistelu, täsmäluku ja kertalupa

1. Lomakkeen `email/dry-run`-esivalmistelu valitsee backendissä variantin ja
   palauttaa pakollisen `documentTarget={kind:'revision'|'preservedLegacy',documentId}`.
   Se vastaa liitteen dokumenttia. Ei revisioavainta, source-ID:tä, polkua tai
   hashia julkiseen kohteeseen. Caller vertaa tunnistetta, ei päätä alkuperää.
2. PreservedLegacy-haara varmentaa alkuperäisen PDF:n ja julkaisee
   `preparePreservedLegacyInvoiceDocument`-käyttötavassa itsenäisen
   muuttumattoman kopion ennen provideria, ilman renderer-kutsua.
   Vanhaa PDF:ää ei poisteta tai regeneroida. Kopion hash/koko vastaa lähdettä,
   mutta tämä ei todista historiallista toimitussisältöä.
   Neutraali viestipohja ei väitä elävän laskun summaa, eräpäivää, viitettä
   tai maksutietoja säilytetyn liitteen kanssa yhtäpitäviksi.
3. Käyttäjä avaa **ensin juuri säilytetyn kopion**.
   `GET /invoices/:id/preserved-documents/:documentId/pdf` vaatii
   sendInvoices-oikeuden ja backendin yrityskontekstin.
   `readPreservedLegacyInvoiceDocument` on kirjoittamaton täsmäluku:
   ei current-metadatan hakua, julkaisu-, generointi- tai poistamisvaltuutta
   eikä lähetysvaltuutusta. Se tarkistaa lähteen ja kopion todelliset tavut
   sekä niiden lähdesidoksen ja historian kelpoisuuden uudelleen tiedostoluvun
   jälkeen. Valmistelu ja luku käyttävät samoja kapeita metadatan
   eheystarkistuksia. Puuttuva kopio, eri dokumentti tai muuttunut tai
   kelpaamaton aineisto hylätään ilman uuden PDF:n varavaihtoehtoa.
   Query-override hylätään, headerit ovat turvalliset kiinteät PDF-headerit,
   vastaus no-store ja väliaikaiset tavupuskurit tyhjennetään.
4. Vasta tämän jälkeen customer-SMTP-prepare tarkistaa saman kohteen/tavut
   ja luo nykyisen **60 sekunnin kertakäyttöisen** valtuutuksen.
   `invoice-email-send-v3` sitoo actor/company/invoice/provider/moodin,
   revision tai preserved-alkuperän, tarkan document-ID/hash/koon sekä
   vahvistetun lähettäjän, vastaanottajat ja koko viestin. Esivalmistelu tai
   PDF:n avaaminen ei luo tokenia. Tokenin ikää ei kasvateta eikä sitä uusita
   automaattisesti esikatselun ajaksi.
5. Electron main näyttää erillisen vahvistuksen: liitteen tarkka kohde,
   todellinen vastaanottaja/cc, lähettäjä, otsikko ja koko body sekä
   preservedLegacy-sisällön historiallinen epävarmuus. Puuttuva native-
   vahvistaja hylkää jo ennen backend-preparea; main vertaa vastauksen
   kohdetta pyyntöön. Peruutus, virhe tai väärä kohde ei luovuta tokenia.
   Epäonnistuminen ei siirry native-polusta selaimen varapolulle.
6. Send lukee ja varmentaa saman kopion ja lähdesidoksen uudelleen,
   vertaa fingerprintin ja varaa pysyvän attemptedin atomisesti ennen
   provideria. Väliin tullut unresolved-esto voittaa. Provider saa täsmälleen
   saman varmennetun puskurin. Kertatokenin katoaminen restartissa ei vapauta
   pysyvää varausta. smtpTest ja dry-run-send eivät hyväksy preservedLegacyä.

Kohteen ID on nykyisen resource-ID-kieliopin raaka ASCII-tunniste,
1..100 merkkiä, ei whitespace-normalisointia; vain kind/documentId hyväksytään.
Tuntematon variantti ei palaudu nykyiseen PDF:ään. Sisäistä source/revision-
tietoa ei hyväksytä rendererin auktoriteettina. Valtuutus ei ole tallennettu
delivery-eventin viestikenttiin.

### Clientin ja native-esikatselun vasteomistajuus

`openInvoicePdf(invoiceId,target?)` käyttää täsmällistä sallittua PDF-URL:ia
historiallisen ikkunan avaimena, ei pelkkää invoice-ID:tä. Eri dokumenttikohteet
eivät vaihda toistensa ikkunaa; vanha kohteeton nyky-PDF-toiminto säilyy eikä
uusi yleinen IPC-portti synny. Nyky-PDF-ikkunan vanhaa lasku-URL:ia ei käytetä
uudelleen uudelleenhyväksynnän jälkeen; täsmähistoriallisen ikkunan uudelleenkäyttö säilyy.

Uusi valmistelu, clear ja unmount mitätöivät vanhan esikatselun sukupolven.
Vanha resolve/catch/finally ei muuta nykyistä kohdetta, virhettä tai pendingiä
eikä palauta onnistumista uudelle kohteelle. Pending estää kaksoisavauksen.
Popupin navigoinnin käynnistyminen ei todista PDF-HTTP-vastauksen eheyttä.
Native-virhe käyttää turvallista yhteisen clientin `error`-kenttää;
peruutus ei palauta tokenia tai raakaa poikkeusta. Backendin vastaukset
kulkevat protokollan läpi muuttamattomina.
