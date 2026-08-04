# ADR-0007: Local desktop shell ja session bootstrap

## Tila

Hyväksytty alustavasti.

## Päätös

Eky local-MVP:n ensisijainen asennettava käyttömuoto rakennetaan Electron-
pohjaisena desktop-sovelluksena.

Electron toimii local-runtimen luottamusankkurina ja prosessien omistajana. Se:

- näyttää nykyisen React/Vite-käyttöliittymän sandboxatussa rendererissä
- käynnistää ja sammuttaa nykyisen Node/TypeScript-backendin hallittuna
  paikallisena prosessina
- muodostaa jokaiselle runtime-käynnistykselle vahvan sessionin
- välittää rendererin API-pyynnöt backendille kapean IPC-/transport-adapterin
  kautta
- pitää session-salaisuuden poissa rendereristä

Pilviversio ei riipu Electronista. React-käyttöliittymä, API-client,
application servicet ja domain pysyvät desktop shellistä riippumattomina.

Tässä ADR:ssä ei vielä lisätä Electron-riippuvuutta eikä toteuteta desktop-
shelliä tai session-koodia. Electronin tarkka versio, paketointityökalu ja
asennus hyväksytään myöhemmässä rajatussa dependency- ja security review
-vaiheessa.

## Tausta

Nykyinen Eky koostuu React/Vite-webistä, Node/TypeScript-backendistä ja
paikallisesta SQLite-tietokannasta. Ensisijainen käyttötapa on yhden käyttäjän
Windows-koneelle asennettava local-first-sovellus, mutta saman application- ja
domain-ytimen pitää toimia myöhemmin myös pilvessä.

Loopbackiin sidottu backend ei yksin todista, että pyynnön lähettäjä on Eky-
käyttöliittymä. Ennen oikean asiakas- tai laskudatan, sähköpostisalaisuuden tai
SMTP-lähetyksen käyttöönottoa tarvitaan hallittu local-session ja backendin
vahvistama `ActorContext`.

Desktop shell -valinta vaikuttaa erityisesti:

- backend-prosessin elinkaareen
- session-salaisuuden turvalliseen bootstrapiin
- rendererin ja backendin luottamusrajaan
- Windows Credential Manager -adapterin sijaintiin
- asennukseen, päivityksiin ja allekirjoitukseen

## Tavoiteltu Runtime-rakenne

```text
Electron main process
  -> luo runtime-sessionin
  -> käynnistää hallitun backend-prosessin
  -> omistaa kapean IPC/API-transportin
    -> sandboxattu preload
      -> React renderer

Electron main process
  -> sessionilla varmennettu loopback-pyyntö
    -> local Node backend
      -> ActorContext
        -> application services
          -> domain
          -> SQLite adapters
          -> local secret store adapter
```

Electron ei saa muuttua liiketoimintalogiikan sijainniksi. Main process,
preload ja desktop-adapterit ovat runtime- ja infrastructure-kerrosta.

## Session Bootstrap

Paketoidun local-runtimen session muodostetaan seuraavalla periaatteella:

1. Electron main process ottaa single-instance-lukon ja käynnistää local-
   runtimen.
2. Main process muodostaa kryptografisesti turvallisella satunnaislähteellä
   vähintään 256-bittisen runtime-session-salaisuuden.
3. Main process käynnistää backendin hallittuna prosessina vain loopback-
   osoitteeseen. Tuotantoruntime käyttää ensisijaisesti käyttöjärjestelmän
   varaamaa vapaata porttia kiinteän julkisen portin sijaan.
4. Session-salaisuus välitetään backendille yksityisen prosessi-IPC:n,
   anonyymin putken tai vastaavan hallitun kanavan kautta. Sitä ei välitetä
   komentorivillä, URL:ssa, build-time-asetuksessa tai lokitettavassa
   ympäristömuuttujassa.
5. Renderer ei saa session-salaisuutta. Se käyttää preloadin kautta kapeaa
   API-transporttia, joka välittää pyynnön Electron main processille.
6. Main process validoi IPC-lähettäjän, suhteellisen API-polun, metodin,
   otsakkeet ja kokorajat ennen kuin se lisää session-todisteen ja kutsuu
   loopback-backendia.
7. Backend vahvistaa sessionin ja muodostaa `ActorContext`-olion vain
   backendin luotetuista local-profiilin tiedoista. `actorId`, `companyId` ja
   permissionit eivät tule rendererin request bodysta, querysta tai omasta
   tilasta.
8. Session pidetään vain muistissa. Se mitätöidään viimeistään backend-
   prosessin tai desktop-runtimen sulkeutuessa eikä sitä käytetä uudelleen
   seuraavassa käynnistyksessä.

Backend saa säilyttää session-salaisuudesta muistissa vain turvalliseen
vertailuun tarvittavan esityksen. Sessionia tai sitä kuljettavaa otsaketta ei
lokiteta. Tarkka session-todisteen formaatti ja vertailutapa testataan
toteutusvaiheessa.

`packages/api-client` tukee jo injektoitavaa `fetch`-toteutusta. Tuleva
desktop-transport voi hyödyntää tätä rajaa ilman Electron-riippuvuuden
levittämistä feature-komponentteihin. API-clientin muodostus keskitetään app-
kerroksen compositioniin ennen desktop-transportin kytkentää; yksittäiset
featuret eivät saa tuntea preloadia tai IPC:tä.

## Renderer- ja IPC-turvallisuus

Paketoidussa Electron-rendererissä noudatetaan vähintään seuraavia sääntöjä:

- `nodeIntegration` on pois käytöstä
- `nodeIntegrationInWorker` on pois käytöstä
- `contextIsolation` on käytössä
- rendererin sandbox on käytössä
- `webSecurity`-asetusta ei poisteta käytöstä
- `allowRunningInsecureContent`, experimental features ja erikseen avattavat
  Blink featuret eivät ole käytössä
- preload paljastaa vain tarkasti nimetyt, validoidut metodit
- raakaa `ipcRenderer`-, Node-, tiedostojärjestelmä-, shell- tai process-API:a
  ei paljasteta rendererille
- kaikkien IPC-pyyntöjen sender ja sallittu ikkuna/frame validoidaan
- paketoitu UI ladataan vain sovelluksen omista allekirjoitetuista resursseista
  tai erikseen hyväksytystä custom protocol -mallista
- Content Security Policy on rajoittava
- `<webview>`-elementtejä ei käytetä local-MVP:ssä
- navigointi, uudet ikkunat ja ulkoisten URL-osoitteiden avaaminen estetään
  oletuksena ja sallitaan vain erikseen validoiduilla komennoilla
- `shell.openExternal` hyväksyy myöhemmin vain tarkalla URL-parserilla
  allowlistatut `https:`-osoitteet; käyttäjän syötettä ei välitetä sille
  sellaisenaan
- remote codea ei ladata tai suoriteta
- Electron pidetään tuetussa ja tietoturvapäivitetyssä versiossa

Electron-mainin API-transport ei korvaa backendin autentikointi-, permission-,
yritysrajaus-, validointi- tai auditointisääntöjä. Renderer oletetaan edelleen
epäluotetuksi.

Salaisuuden asettaminen ja poistaminen ovat auditoitavia toimintoja. Niiden
HTTP- tai UI-kytkentää ei tehdä ennen kuin backend voi kirjata actorin,
yrityksen, toiminnon, ajan ja lopputuloksen ilman salaisuuden arvoa, pituutta,
hashia tai osittaista sisältöä.

## Electron Security Gate

Electron-riippuvuutta ei hyväksytä tuotantoon pelkän toimivan desktop-ikkunan
perusteella. Ennen oikean datan käyttöä seuraavat riskit ja suojaukset pitää
todentaa testeillä sekä paketoidusta Windows-artifactista.

### Renderer XSS ja oikeuksien laajeneminen

Electronissa rendererin XSS voi muuttua vakavaksi paikallisen koneen
kompromissiksi, jos rendererillä on Node-oikeus tai liian laaja preload-API.
Siksi:

- rendererillä ei ole Node-oikeuksia
- CSP sallii oletuksena vain sovelluksen omat resurssit
- inline- ja eval-pohjainen skriptien suoritus estetään tuotantoprofiilissa
- preload ei palauta salaisuuksia, tiedostokahvoja, prosessiolioita tai raakaa
  IPC-rajapintaa
- jokainen privileged IPC -metodi validoi senderin, input-rakenteen,
  pituusrajat ja sallitun toiminnon

### Confused Deputy ja IPC

Main process ei luota pyyntöön vain siksi, että se tuli IPC-kanavasta.
Iframen, väärän ikkunan tai navigoidun rendererin pitää epäonnistua sender-
tarkistukseen. API-transport:

- ei hyväksy absoluuttista tai ulkoista URL-osoitetta
- sallii vain Eky-backendin suhteellisen API-polun
- rajaa HTTP-metodit ja käyttäjän asettamat otsakkeet
- ei salli session- tai authorization-otsakkeen korvaamista rendereristä
- rajaa request- ja response-koot

Backend tarkistaa tämän jälkeen sessionin, permissionin, yritysrajauksen ja
syötteen uudelleen.

### Navigointi, protokollat ja käyttöjärjestelmäkomennot

Paketoitu UI tarjoillaan rajatusta custom protocol -mallista eikä laajasti
oikeutetusta `file://`-originista. Local-MVP:

- estää odottamattoman navigoinnin ja ikkunoiden luonnin
- ei rekisteröi deep link -protokollaa ilman erillistä turvallisuuspäätöstä
- ei avaa paikallisia tiedostoja tai ohjelmia käyttäjän syöttämän URL:n kautta
- ei käytä `webview`-elementtejä tai remote content -ikkunoita

### Electron Fuses ja paketin eheys

Paketoidussa tuotantoversiossa arvioidaan ja lähtökohtaisesti lukitaan vähintään
seuraavat Electron fuse -asetukset:

- `RunAsNode`: pois käytöstä
- `EnableNodeOptionsEnvironmentVariable`: pois käytöstä
- `EnableNodeCliInspectArguments`: pois käytöstä
- `EnableEmbeddedAsarIntegrityValidation`: käytössä
- `OnlyLoadAppFromAsar`: käytössä
- `GrantFileProtocolExtraPrivileges`: pois käytöstä
- `EnableCookieEncryption`: käytössä, vaikka sessionia ei suunnitella
  tallennettavaksi Chromiumin pysyvään cookie-storeen

`RunAsNode`-fusen poistaminen tukee `utilityProcess`-suuntaa. Jos backend-
prosessin toteutus tarvitsee ominaisuutta, poikkeamaa ei tehdä hiljaisesti,
vaan prosessimalli arvioidaan uudelleen.

ASAR-integriteetti ja `OnlyLoadAppFromAsar` otetaan käyttöön yhdessä, jotta
Electron ei voi ohittaa validoitua `app.asar`-pakettia lataamalla toista app-
hakemistoa. Paketoidun artifactin fuse-arvot ja ASAR-integriteetti tarkistetaan
automaattisesti release-putkessa.

### Versiot, allekirjoitus ja supply chain

- Electron-version pitää kuulua Electronin virallisesti tukemiin vakaisiin
  julkaisuihin; vanhentunutta Chromium/Node-yhdistelmää ei julkaista
- Electron- ja paketointiriippuvuudet lukitaan lockfileen ja auditoidaan
- tiedossa oleva korjattavissa oleva high/critical-haavoittuvuus estää
  julkaisun
- Windows-binaarit ja asentaja allekirjoitetaan ennen oikeaa jakelua
- päivityspaketit ja päivitysmetadata varmennetaan eikä allekirjoittamatonta
  päivitystä asenneta
- `better-sqlite3` ja muut native addonit rakennetaan kohde-Electronille ja
  niiden alkuperä sekä paketointisisältö tarkistetaan

Electronin virallinen tukipolitiikka kattaa rajatun määrän uusimpia vakaita
release-linjoja. Eky seuraa aktiivisesti Electronin ja Chromiumin security-
julkaisuja eikä jää tarkoituksella tuen ulkopuoliseen versioon.

### Debug, lokit ja crash data

- Node inspector, remote debugging ja kehitystyökalut eivät ole
  tuotantoprofiilissa oletuksena käytössä
- Electronin security warning -ilmoituksia ei poisteta kehityksessä
- sessionia, authorization-otsaketta, Credential Manager -salaisuutta,
  lasku-PDF:n sisältöä tai henkilötietoja ei kirjoiteta logiin tai crash-
  raporttiin
- crash reportingia tai etätelemetriaa ei oteta käyttöön ilman erillistä data-
  ja tietosuojapäätöstä

### Paikallinen Uhkamalli

Electron-shell, session ja Credential Manager suojaavat verkkosivulta,
satunnaiselta paikalliselta originilta ja tavalliselta toiselta prosessilta
tulevia pyyntöjä. Ne eivät voi suojata tilannetta, jossa hyökkääjä hallitsee
samaa Windows-käyttäjätiliä, pystyy lukemaan Eky-prosessien muistia tai toimii
järjestelmänvalvojana. Levy- ja käyttäjätilitason suojaus, Windows-päivitykset,
haittaohjelmasuojaus ja myöhemmin BitLocker kuuluvat siksi release security
gateen.

## Backend-prosessin Hallinta

Electron main process vastaa backend-prosessin:

- käynnistyksestä ja readiness-tarkistuksesta
- loopback-bindauksen ja valitun portin vahvistamisesta
- hallitusta sammutuksesta
- odottamattoman kaatumisen turvallisesta käsittelystä
- siitä, ettei vanha session jää voimaan uudelleenkäynnistyksessä

Ensisijaisesti arvioidaan Electronin `utilityProcess`-mallia, koska se tarjoaa
Node-prosessin ja hallitun viestikanavan. Ennen valintaa tehdään kuitenkin
paketointispike, jolla varmistetaan `better-sqlite3`-native addonin, PDFKitin,
migraatioiden ja paikallisten tiedostopolkujen toiminta paketoidussa
Windows-versiossa. Jos `utilityProcess` ei sovellu native addon -rajoihin,
Electronin hallitsema erillinen paketoitu Node-prosessi on sallittu adapteri-
tason vaihtoehto. Tämä ei muuta Electron-shellin tai session-bootstrapin
päätöstä.

Backendia ei avata lähiverkkoon tai internetiin. Pilviyhteys toteutetaan
myöhemmin local-sovelluksen ulospäin tekemänä autentikoituna HTTPS-
synkronointina erillisen sync-adapterin kautta.

## Origin ja CORS

Paketoidussa desktop-profiilissa renderer ei kutsu loopback-backendia suoraan,
vaan pyynnöt kulkevat main processin hallitun transportin kautta. Backend
hylkää puuttuvan tai virheellisen sessionin riippumatta pyynnön originista.

CORS on deny by default. Paketoitu runtime ei avaa wildcard-originia.
Kehitysympäristössä voidaan sallia vain täsmällisesti määritelty Vite-origin,
mutta development-poikkeus ei saa päätyä packaged production -profiiliin.

## Local Secret Store -Tarkennus 15.7.2026

Ensimmäinen local-MVP ei käytä erillistä Windows Credential Manager -kirjastoa
tai omaa native-adapteria. Se käyttää jo hyväksytyn Electron-runtimen
sisäänrakennettua `safeStorage`-rajapintaa vain main processissa. Koko
versionoitu payload salataan käyttöjärjestelmän suojausmallilla ennen kuin blob
kirjoitetaan Electronin `userData`-alueelle.

Backend utility process käyttää salaisuutta Electron main processin yksityisen
`MessagePort`-brokerin kautta. Renderer ja preload eivät saa brokeria,
`safeStorage`-API:a, salattua tiedostoa tai salaista arvoa.

SMTP-providerille voidaan myöhemmin antaa erillinen, kapea backend-only reader-
sopimus. Desktop shellin valinta ei muuta Company Settingsin, Invoicingin tai
email infrastructuren moduulivastuita.

Mahdollinen macOS Keychain- tai Linux Secret Service -adapteri voidaan lisätä
myöhemmin saman portin taakse ilman application service -muutoksia.

## Kehitysympäristö

Nykyinen erikseen ajettava Vite + local backend + tavallinen selain säilyy
väliaikaisena development-mallina vain synteettiselle datalle.

Desktop-toteutuksen aikana kehitysmalli voi käyttää Electron main processia,
joka lataa vain täsmällisesti allowlistatun paikallisen Vite-originin ja käyttää
samaa IPC-transporttia kuin paketoitu sovellus. Development-profiilin pitää
olla eksplisiittinen eikä sen session-, CORS- tai debug-poikkeuksia saa ottaa
käyttöön paketoidussa versiossa.

Tavallinen selain ei ole local-tuotantoversion luottamusankkuri. Jos Ekyyn
tehdään myöhemmin suora web-käyttö, se käyttää pilvibackendia HTTPS:n ja
Firebase identity -adapterin kautta eikä käyttäjän paikallista loopback-
backendia.

## Vaihtoehtojen Arviointi

### Electron

Hyödyt:

- nykyinen React/Vite-UI voidaan käyttää lähes sellaisenaan
- nykyinen Node/TypeScript-backend voidaan ajaa hallittuna Node-prosessina
- main/preload/renderer-prosessimalli tarjoaa luotetun bootstrap-kanavan
- sama TypeScript-osaaminen kattaa suurimman osan desktop-runtimesta
- Windows-, macOS- ja Linux-paketointi on mahdollinen
- prosessinhallinta, allekirjoitus ja päivitysmalli ovat tunnettuja

Haitat ja riskit:

- Chromium ja Node kasvattavat asennuskokoa ja päivitysvastuuta
- Electronin, Chromiumin ja npm-riippuvuuksien tietoturvapäivitykset pitää
  käsitellä nopeasti
- väärin avattu Node-/IPC-raja nostaa XSS-haavoittuvuuden vaikutusta
- native Node addonien yhteensopivuus kohde-Electronin kanssa pitää validoida;
  ensisijainen malli on tuettu N-API-runtime ja tarvittaessa tarkasti
  kohdistettu ABI-rakennus

### Tauri ja Node-backend Sidecarina

Hyödyt:

- pienempi shell ja järjestelmän WebView
- capability-malli rajaa frontendille sallittuja toimintoja
- hyvä mahdollisuus alustakohtaisiin Rust-adaptereihin

Haitat ja riskit nykyisessä Ekyssä:

- lisää Rust-työkaluketjun nykyisen TypeScript-pinon rinnalle
- nykyinen Node-backend pitää paketoida erilliseksi sidecar-binääriksi
- sidecar-binäärit ja oikeudet pitää hallita alustakohtaisesti ja
  arkkitehtuurikohtaisin target-tiedostoin
- Node-prosessin, native SQLite-ajurin ja session-kanavan paketointi tarvitsee
  uuden toteutuskerroksen
- kehitys-, build- ja päivityspolku monimutkaistuu ennen kuin Eky hyötyy
  Tauri/Rust-kerroksesta

Tauri säilyy mahdollisena myöhempänä vaihtoehtona, jos shellin koko tai
alustakohtaiset Rust-integraatiot muodostuvat Electronin ylläpitoa
tärkeämmiksi. Vaihto ei saa vaatia domain- tai application-ytimen muutosta.

### Paikallinen Backend ja Tavallinen Selain

Hyödyt:

- nykyinen development-malli toimii jo näin
- ei desktop-framework-riippuvuutta
- lähimpänä tulevaa pilvi-web-käyttöä

Haitat ja riskit local-tuotteessa:

- selain ei omista backend-prosessin elinkaarta
- salaisen session turvallinen bootstrap ilman URL-tokenia tai käyttäjän
  erillistä kirjautumista on vaikeampi rajata
- selaimella ei ole luotettua käyttöjärjestelmä-IPC:tä Credential Manageriin
- portti-, käynnistys-, single-instance- ja shutdown-kokemus jää hajanaiseksi
- selainlaajennukset ja muut paikalliset origin- sekä loopback-uhat kasvattavat
  arvioitavaa pintaa

Tämä malli säilyy kehityskäytössä ja tulevassa cloud-web-versiossa, mutta sitä
ei valita asennetun local-MVP:n ensisijaiseksi tuotantomalliksi.

## Jakelu ja Päivitykset

Ensimmäinen desktop-spike ei vielä toteuta automaattipäivitystä.
Tuotantojulkaisua ennen vaaditaan kuitenkin:

- Windows-asentimen ja sovellusbinaarien allekirjoitus
- riippuvuuksien ja paketoitujen native addonien auditointi
- ASAR-integriteetin ja Electron fuse -asetusten arviointi
- allekirjoitettu ja hallittu päivitysmalli
- version rollback- ja tietokantamigraatioiden palautussuunnitelma

Desktop-päivitys ei saa vaihtaa tietokantaskeemaa ilman migraatioita eikä
ohittaa release security gate -tarkistusta.

Myöhemmin hyväksytty ADR-0010 määrittelee Windows-asentajan ja
päivitysorkestroinnin tarkemman vastuun. ADR-0009 määrittelee ennen
migraatiota vaadittavan palautuspisteen. Installer- tai updater-
tuotantokoodia ei ole vielä toteutettu.

## Seuraukset

Päätös:

- poistaa local-paketoinnin avoimista pääpäätöksistä
- säilyttää nykyisen React-, API-client-, Node-backend- ja domain-investoinnin
- antaa turvallisen paikan sessionin ja OS-integraatioiden bootstrapille
- pitää pilvi-, web- ja mobiiliversiot desktop shellistä riippumattomina
- lisää Electron/Chromium-päivitys- ja paketointivastuun

Ennen Electron-riippuvuuden lisäämistä tehdään erillinen rajattu toteutus-
suunnitelma, dependency audit ja Windows-paketointispike. Ensimmäisen spiken
toteutus- ja hyväksymisrajat on kuvattu dokumentissa
`docs/architecture/local-desktop-implementation-plan.md`.

## Ei Toteuteta Tässä Päätöksessä

- Electron-riippuvuutta
- Electron Forgea tai muuta paketointityökalua
- main-, preload- tai renderer-koodia
- local-session-koodia
- backend-prosessin käynnistystä
- HTTP-auth-middlewarea
- Firebase-tokenin tarkistusta
- Windows Credential Manager -adapteria
- SMTP-provideria
- automaattipäivitystä

## Viralliset Lähteet

- Electron Security:
  `https://www.electronjs.org/docs/latest/tutorial/security`
- Electron Fuses:
  `https://www.electronjs.org/docs/latest/tutorial/fuses`
- Electron ASAR Integrity:
  `https://www.electronjs.org/docs/latest/tutorial/asar-integrity`
- Electron Release Timelines:
  `https://www.electronjs.org/docs/latest/tutorial/electron-timelines`
- Electron Context Isolation:
  `https://www.electronjs.org/docs/latest/tutorial/context-isolation`
- Electron Process Model:
  `https://www.electronjs.org/docs/latest/tutorial/process-model`
- Electron Packaging And Distribution:
  `https://www.electronjs.org/docs/latest/tutorial/application-distribution`
- Electron Code Signing:
  `https://www.electronjs.org/docs/latest/tutorial/code-signing`
- Tauri Sidecars:
  `https://v2.tauri.app/develop/sidecar/`
- Tauri Capabilities:
  `https://v2.tauri.app/security/capabilities/`

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
- `docs/decisions/ADR-0005-backend-framework-selection.md`
