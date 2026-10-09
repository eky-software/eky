# Local Desktop Implementation Plan

Tämä dokumentti kuvaa ADR-0007:ssä päätetyn Electron-pohjaisen paikallisen
desktop-runtimen ensimmäisen rajatun toteutus- ja Windows-paketointispiken sekä
sen toteutustilan.

Rajattu tekninen package-spike ja sen ensimmäinen local-session-luottamusraja
on toteutettu 14.7.2026. Electron `safeStorage` -secret broker on toteutettu
15.7.2026 synteettisellä paketointismokella. Desktop-sessionilla suojattu
salaisuuden HTTP-, API-client- ja UI-lifecycle sekä koko polun Windows-smoke on
toteutettu 15.7.2026. Rajattu DNA SMTP -testiprovider ja sen prepare/send-
turvallisuuspolku on toteutettu 16.7.2026, ja oikean tilin yhteys on varmennettu
projektin omistajan testivastaanottajalla. Asiakaslähetyksen ensimmäinen
prepare/send-polku ja `sent`-tilasiirtymä on toteutettu 17.7.2026. Toteutus ei
vielä sisällä tuotantojulkaisun release security gatea, installeria, code
signingia tai automaattipäivitystä.

Windows-asennuksen ja päivitysorkestroinnin arkkitehtuuriperusta on hyväksytty
ADR-0010:ssä. Salatun backupin ja konekohtaisten palautuspisteiden perusta on
hyväksytty ADR-0009:ssä. Salattu portable backup sekä konekohtaisen
palautuspisteen luonti, health-tarkistus, ajastus ja rotaatio on toteutettu
4.8.2026. Restore-aktivointia, installeria, update coordinatoria tai code
signingia ei ole vielä toteutettu eikä installeriteknologiaa ole valittu.

Electron `43.3.0`- ja better-sqlite3 `13.0.2` -yhdistelmä on varmennettu
17.8.2026. Tämä on päivitystä edeltävä varmennettu baseline. Omistaja hyväksyi
29.9.2026 Electron `43.7.6` -patch-päivityksen, jonka todennus on kesken.
Rajaus, nykyinen testitila ja avoimet hyväksyntäportit ovat
[riippuvuusarviossa](local-desktop-dependency-review.md#electron-4376--turvallisuuspäivitys).
`better-sqlite3 13.0.2`, tietokantaskeema ja testien hyväksyntäehdot säilyvät.
Paketointi käyttää better-sqlite3:n mukana toimitettua Windows x64
N-API-binääriä eikä enää rakenna staged-kopiota Electron ABI:lle. Aiempi
testinäyttö ei todista uuden Electron-version yhteensopivuutta.

Paikallisten yritystyötilojen W5B.1-valitsin on toteutettu 20.8.2026. Renderer
saa vain versionoidut status-, create-, import-as-new-, switch- ja rename-
capabilityt. Electron main omistaa backup-tiedoston valinnan, salasanaikkunan,
workspace-lifecyclen ja relaunchin. Active replace jää W5B.2:een, workspace-
poisto W7:ään ja täysi paketoitu multi-workspace-releaseportti W6:een.

Salatun secret-tiedoston kirjoitus ja palautuminen on kovennettu 15.7.2026
deterministisillä next- ja backup-sloteilla. Paketoitu Windows-smoke varmistaa
synteettisen salaisuuden broker- ja HTTP set/status/remove-elinkaaren, ettei
plaintext päädy salattuun tiedostoon ja ettei current-, next- tai backup-
slottia jää poiston jälkeen.

## Toteutustulos 14.7.2026

Toteutettu spike todentaa Windows x64 -artifactissa:

- paketoidun React/Vite-rendererin latauksen ilman Vite-palvelinta
- Electron `utilityProcess` -prosessissa ajettavan nykyisen backendin
- käyttöjärjestelmän varaaman `127.0.0.1`-loopback-portin
- uuden SQLite-tiedoston ja kaikkien migraatioiden luonnin erilliseen
  väliaikaiseen sovellusdatahakemistoon
- paketoidun `better-sqlite3 13.0.2` Windows x64 N-API-moduulin
- synteettisen lasku-PDF:n tuottamisen paketoidulla PDFKit-pinolla
- turvallisuusasetusten ja production-fusejen automaattisen tarkistuksen
- sen, ettei pakettiin kopioida kehityksen tietokantoja, PDF-artifakteja,
  `.env`-tiedostoja, lähdekoodeja tai testejä Eky-omisteisista build-osista
- main processin luoman 256-bittisen kertakäyttöisen runtime-sessionin
- sessionin välityksen backendille vain Electronin yksityisellä
  prosessikanavalla
- session-otsakkeen lisäämisen main processin rajatussa backend-proxyssa niin,
  ettei renderer voi nähdä tai korvata session-salaisuutta
- backendin session-varmennuksen ja varmennetusta local-profiilista muodostetun
  muuttumattoman `ActorContext`-olion

Renderer käyttää paketoitua `eky://app`-protokollaa. Protokolla palvelee vain
paketoidut UI-resurssit ja välittää vain eksplisiittisesti allowlistatut
backend-reitit ja HTTP-metodit. Preload ei tässä vaiheessa paljasta rendererille
yhtään Node-, tiedosto-, prosessi- tai yleistä IPC-API:a.

Package-spike ei ole loppukäyttäjän release. Päivitystä edeltävä varmennettu
runtime käytti virallisesta npm-rekisteristä saatavia Electron `43.3.0`- ja
`better-sqlite3 13.0.2` -versioita. Windows package-, smoke-, Electron-E2E-,
stressi- ja soak-testien aiempi läpäisy koskee tätä yhdistelmää, ei vielä
kokonaisuutena vielä hyväksymätöntä Electron `43.7.6` -päivitystä. Installer, code signing,
tavallisen Windows-käyttäjän manuaalinen hyväksymistesti ja päivityskanava
ovat edelleen avoimia toimitusvaiheita.

## Tavoite

Ensimmäinen spike todistaa synteettisellä datalla, että nykyiset Eky-osat
voidaan ajaa turvallisen desktop-kuoren sisällä kirjoittamatta sovelluksen
ydintä uudelleen:

```text
Electron main process
  -> rajattu preload- ja IPC-transport
    -> nykyinen React/Vite-renderer
  -> hallittu paikallinen Node-backend
    -> nykyiset application servicet ja domain
      -> SQLite
      -> PDFKit
```

Electron on runtime- ja infrastructure-kerros. Se ei omista liiketoiminta-
logiikkaa, käyttöoikeussääntöjä, laskutusta, asiakasdataa tai sähköpostin
toimituspäätöksiä.

## Käyttöprofiilit

### Selainkehitys

Nykyinen kehitysmalli säilyy:

```text
React/Vite selaimessa
  -> tavallinen fetch / Vite proxy
    -> erikseen ajettava local backend
      -> kehityksen SQLite
```

Selainkehitys:

- käyttää nykyisiä `pnpm`-kehityskomentoja
- sitoo Viten ja backendin vain `127.0.0.1`-osoitteeseen
- käyttää vain synteettistä kehitysdataa
- ei ole isälle toimitettavan local-tuotteen turvallisuusmalli
- ei saa vastaanottaa oikeaa SMTP-salasanaa tai muuta tuotantosalaisuutta
- käyttää eksplisiittistä synteettisen datan development trust -profiilia;
  tuotantoprofiili ei käynnisty ilman erikseen annettua runtime trust -mallia

Electronin lisääminen ei poista tai korvaa tätä nopeaa kehitystapaa.

### Electron-kehitys

Desktop-runtimen kehitystä varten Electron main process saa ladata vain
eksplisiittisesti allowlistatun paikallisen Vite-originin. Kehitysprofiili:

- käyttää samaa rajattua preload-/IPC-transporttia kuin paketoitu sovellus
- ei anna rendererille Node-oikeuksia tai session-salaisuutta
- ei salli mielivaltaista remote contentia
- pitää kehitystyökalut ja mahdolliset debug-poikkeukset erillään production-
  konfiguraatiosta
- epäonnistuu turvallisesti, jos odotettu Vite-origin, backend tai session-
  bootstrap ei vastaa sallittua profiilia

Electron-kehitys todentaa desktopin luottamusrajaa. Se ei korvaa tavallista
selainkehitystä kaikissa päivittäisissä UI-tehtävissä.

### Paketoitu Offline-Tuote

Isälle toimitettava paikallinen versio:

- ei tarvitse Vite development -palvelinta
- lataa vain sovelluksen omat paketoidut ja varmennetut UI-resurssit
- käynnistää ja sammuttaa backendin Electron main processin hallinnassa
- käyttää paikallista SQLite-tiedostoa hallitussa sovellusdatahakemistossa
- toimii ilman internetyhteyttä kaikissa paikallisissa ydintoiminnoissa
- käyttää verkkoa vain erikseen toteutetuissa ja hyväksytyissä toiminnoissa,
  kuten SMTP-lähetyksessä, pilvisynkronoinnissa tai päivityksen tarkistuksessa

Offline-käyttö ja tuleva pilvikäyttö käyttävät samaa domain- ja application-
ydintä eri runtime-, identity-, storage- ja transport-adaptereilla.

## Ehdotettu Desktop-Sovelluksen Rakenne

Rajatussa spikessä arvioidaan seuraavaa rakennetta:

```text
apps/desktop/
  src/
    main/
    preload/
    invoicePdfArchive/
    pdf/
    runtime/
    secrets/
  package.json
  tsconfig.json
```

Vastuut:

- `main/` omistaa Electron-ikkunan, prosessien elinkaaren ja privileged IPC:n
- `preload/` paljastaa rendererille vain nimetyn desktop-transportin
- `invoicePdfArchive/` omistaa konekohtaisen configin, retry-journalin,
  täsmällisen PDF-validoinnin ja yksityisen main/utility-process-brokerin
- `pdf/` omistaa laskun PDF-esikatselun kapean IPC-sopimuksen, URL-politiikan
  ja suojatun esikatseluikkunan elinkaaren
- `runtime/` kokoaa session-bootstrapin, backend-prosessin ja polkuadapterit
- `secrets/` eristää safeStorage-suojauksen, salatun tiedoston ja yksityisen
  main/utility-process-brokerin
- React-featuret pysyvät `apps/web`-sovelluksessa
- backendin moduulit pysyvät `apps/backend`-sovelluksessa
- API-clientin julkinen sopimus säilyy Electronista riippumattomana

W4:n multi-workspace-runtime jakaa pysyvän desktop-tilan kahteen omistukseen:

- Electron-installationin yhteinen tekninen tila säilyy
  `<userData>/runtime/`-juuressa; siihen kuuluvat operational-lokit,
  tukipakettien lähteet, update state ja packaged-smoke
- aktiivisen yritystyötilan business- ja device-local-tila sijaitsee mainin
  johtamassa `<userData>/workspaces/<opaque-workspace-id>/runtime/`-juuressa;
  siihen kuuluvat SQLite, lasku-PDF:t, snapshotit, salaisuusblob,
  PDF-arkiston config/journal sekä backup/recovery-tila.

Renderer, web-featuret ja backendin business-API eivät muodosta näitä polkuja.
Electron main todistaa ensin build-identiteetin installation-scoped strict
storeista. Vasta hyväksytyn build admissionin jälkeen se ratkaisee tai adoptoi
aktiivisen workspacen ennen sessionia ja backendia. Torjuttu build ei saa luoda
adoption journalia, candidatea, final-rootia tai registry-muutosta.
Keskeytyneen legacy-adoption automaattinen cleanup sallitaan vain
julkaisemattomalle, täsmällisesti johdetulle ja muuttumattoman legacy-lähteen
kanssa byte-identtiselle kopiolle; onnistunut cleanup johtaa relaunchiin ennen
uutta adoptiota. Vain yksi workspace saa omistaa business-SQLite-kahvan
kerrallaan.
W5A on lisännyt tämän päälle main-prosessin sisäisen management-palvelun,
production-lifecycle- ja private candidate -adapterit sekä yhden yhteisen
installation-scoped maintenance-auktoriteetin. W5B.1 avaa tästä vain viisi
strictiä trusted-main-frame capabilitya preloadin kautta ja käyttää webissä
sivupalkin workspace-valitsinta. Production-composition ja käyttäjäpolut on
todennettu Electron-E2E:ssä synteettisellä private userData -juurella sekä
oikealla synteettisellä salatulla backup-containerilla. Active replace ei ole
vielä rendererille avoin.

Tarkka kansiorakenne hyväksytään spiken yhteydessä sen perusteella, mitkä
vastuut todella tarvitaan. Yleisiä `utils`-, `helpers`- tai `common`-tiedostoja
ei luoda.

## Riippuvuus- Ja Paketointipäätös

Ennen `package.json`- tai lockfile-muutosta tehdään erillinen dependency review.
Siinä tarkistetaan vähintään:

- tuettu Electron-versio ja sen Chromium/Node-versiot
- tarkka version lukitus ja Electronin tukiaikataulu
- paketointityökalun tarve ja vaihtoehdot
- Windows maker-/installer-vaihtoehdot
- lisenssit ja transitiivisten riippuvuuksien määrä
- tunnetut haavoittuvuudet ja tuotantoriippuvuuksien audit
- `better-sqlite3`-native addonin Electron N-API- tai ABI-yhteensopivuus
- PDFKitin, migraatioiden ja backend-buildin paketointi
- koodiallekirjoituksen, ASAR-integriteetin, fuses-asetusten ja myöhemmän
  automaattipäivityksen tuki

Electron, paketointityökalu ja mahdollinen rebuild-työkalu eristetään
`apps/desktop`-runtimeen. Niitä ei tuoda domainiin, application serviceihin,
API-clientiin tai web-featureihin.

Zodia tai muuta validointiriippuvuutta ei lisätä vain Electron-IPC:tä varten.
Ensimmäinen rajattu IPC voidaan validoida pienillä eksplisiittisillä
allowlist- ja input-validaattoreilla. Jos validointi alkaa toistua tai kasvaa
riskiksi, `packages/validation` tai Zod arvioidaan erillisellä dependency-
päätöksellä.

Ensimmäisen spiken tarkat riippuvuudet, rajaukset ja toimitusketjun
turvallisuuspäätös on kirjattu dokumenttiin
`docs/architecture/local-desktop-dependency-review.md`.

## Backend-Prosessin Spike

Ensisijaisesti arvioidaan Electronin `utilityProcess`-mallia. Spiken pitää
todentaa:

1. Electron saa käynnistettyä backendin ilman shell-komentojen rakentamista
   käyttäjän syötteestä.
2. Backend kuuntelee vain käyttöjärjestelmän varaamaa loopback-porttia.
3. Main process odottaa rajatulla timeoutilla backendin readiness-signaalia.
4. Backendin käynnistysvirhe näytetään turvallisesti ilman sessionia,
   tiedostopolkuja tai arkaluonteista debug-dataa.
5. Sovelluksen sulkeminen pysäyttää backendin hallitusti.
6. Odottamaton backend-kaatuminen ei jätä vanhaa sessionia voimaan.
7. Single-instance-lukko estää kaksi ristiriitaista local-runtimea.

Jos `utilityProcess` ei toimi `better-sqlite3`-native addonin kanssa,
Electronin hallitsema erillinen paketoitu Node-prosessi arvioidaan adapteri-
tason vaihtoehtona. Prosessimallin poikkeama dokumentoidaan eikä sitä tehdä
hiljaisesti.

## Session- Ja Transport-Raja

Electron-runtimessa session- ja transport-raja on toteutettu seuraavasti:

- main process luo vähintään 256-bittisen kertakäyttöisen runtime-sessionin
- session välitetään backendille yksityisellä prosessikanavalla
- sessionia ei välitetä komentorivillä, URL:ssa, localStoragessa, build-
  asetuksessa tai lokitettavassa ympäristömuuttujassa
- renderer ja React-koodi eivät saa raakaa session-salaisuutta
- preload paljastaa vain nimetyt ja rajatut desktop-toiminnot; ensimmäinen
  toiminto on `openInvoicePdf(invoiceId, target?)`, eikä se hyväksy URL:ia tai polkua
- main process hyväksyy vain suhteelliset allowlistatut API-polut ja sallitut
  HTTP-metodit
- renderer ei saa asettaa tai korvata session- tai authorization-otsaketta
- request- ja response-koot rajataan
- backend vahvistaa sessionin ja muodostaa `ActorContext`-olion luotetusta
  local-profiilista

Session-middleware suojaa Electron-runtimessa kaikki muut reitit paitsi
prosessin readinessiin käytetyn `GET /health` -reitin. Arkaluonteiset
sähköpostireitit ja Company Settings -reitit käyttävät jo actor-kontekstin
yritys- ja käyttäjätietoja. Muiden vielä kehitysoikopolkuja sisältävien
moduulireittien siirto samaan actor-kontekstiin tehdään rajattuina muutoksina
ennen oikean datan tuotantokäyttöä.

`packages/api-client` käyttää jatkossakin injektoitavaa fetch-/transport-
toteutusta. Runtime valitsee transportin app-tason compositionissa; React-
featureissä ei tehdä `window.electron`-ehtoja.

## Laskun PDF-Esikatselu

Paketoitu Electron-sovellus avaa hyväksytyn laskun PDF:n main-prosessin
omistamaan erilliseen esikatseluikkunaan. Renderer saa välittää vain tiukalla
resource-id-säännöllä validoitavan `invoiceId`-arvon ja valinnaisen, alla
rajatun säilytetyn dokumentin kohteen. Renderer ei saa välittää
URL:ia, tiedostopolkua, backend-originia, headereita tai runtime-sessionia.

Main process muodostaa itse täsmällisen osoitteen:

```text
eky://app/invoices/{invoiceId}/pdf
```

B-P3:n työpuutoteutus laajentaa samaa capabilityä valinnaisella kohteella
`{ kind: 'preservedLegacy', documentId }`. Main validoi molemmat tunnisteet,
tarkan variantin ja kenttäjoukon. Väärä, puuttuvakenttäinen tai tuntematon
kohde ei palaudu tavalliseen PDF-polkuun; vain koko valinnaisen argumentin
puuttuminen tarkoittaa aiempaa toimintoa. Main muodostaa osoitteen
`eky://app/invoices/{invoiceId}/preserved-documents/{documentId}/pdf`.
Allowlist sallii tästä polusta vain GET-pyynnön. Backend tarkistaa
`sendInvoices`-oikeuden, yritys-/laskurajan sekä nimetyn säilytetyn PDF:n ja
sen lähteen eheyden. Luku ei generoi tai valmistele puuttuvaa kopiota eikä
anna lähetyslupaa. Lomakkeen avaus välittää tämän kohteen app-kerroksen
callbackin kautta; se ei vaihda selaimeen native-virheessä. Rajattu
selainkytkentätesti korvaa native-callbackin, eikä todista oikeaa Electron-
esikatselua. SMTP-vahvistuksen kohdesidonta ja kokonaisketjun
hyväksyntä ovat [omistavassa B-P3-suunnitelmassa](release-0.3.0-m1-preparation-plan.md#säilytetyn-dokumentin-täsmäluku-ja-vahvistuksen-järjestys).

Asiakas-SMTP:n valmistelu estyy ennen backend-kutsua, jos mainin
vahvistuscallback puuttuu. Main vertaa valmisteluvastauksen lasku- ja
dokumenttikohdetta alkuperäiseen pyyntöön ja palauttaa kertaluvan vasta
hyväksytyn native-vahvistuksen jälkeen. Säilytetyn PDF:n dialogi kertoo,
ettei vanhan toimituksen sisältöä väitetä takautuvasti varmennetuksi.
Peruutus, callbackin virhe tai kohdepoikkeama ei palauta lupaa rendererille.
Tämä ei pidennä backendin valtuutusaikaa eikä luo automaattista uusintaa.

Custom protocol lisää backendin runtime-sessionin vasta main-prosessissa.
Backendin `ActorContext`-, permission- ja `companyId`-rajaukset pysyvät siten
voimassa myös esikatselussa.

PDF-ikkunassa ei ole preloadia, Node-integraatiota, webviewta tai DevToolsia.
Ikkuna estää popupit, permission-pyynnöt ja navigoinnin pois täsmälleen mainin
muodostamasta PDF-osoitteesta. Ikkunoita ei luoda rajattomasti: vain sama
täsmällinen historian tai säilytetyn dokumentin PDF-osoite fokusoidaan uudelleen.
Nykyisen PDF:n osoite ei vaihdu revision mukana. Sen uusi avaus sulkee vanhan
samannimisen esikatselun ennen saatavuustarkistusta ja lataa sisällön uudelleen;
tarkistuksen epäonnistuessa vanha sisältö ei jää nykyisen PDF:n korvikkeeksi.
Samanaikaiset avaukset voivat käyttää juuri uudelleen luotua ikkunaa.
Eri laskun, eri dokumentin
tai tavallisen ja säilytetyn PDF:n välillä vaihdettaessa aiempi esikatselu
suljetaan. Pelkkä lasku-ID ei ole säilytetyn dokumentin cache-avain.
Main varmistaa custom protocol -polun kautta ennen ikkunan luontia, että vastaus
on onnistunut `application/pdf`-vastaus. Puuttuva PDF tai latausvirhe sulkee
ikkunan ja näyttää vain turvallisen yleisvirheen.

Nykyinen local-MVP tekee saatavuustarkistuksen ja BrowserWindowin varsinaisen
PDF-latauksen erillisinä pyyntöinä. Pienten paikallisten laskujen kohdalla tämä
on hyväksytty ratkaisu. Myöhemmin voidaan arvioida storage-adapterin
`stat`/`exists`-tarkistus tai suora lataus turvallisella `did-fail-load`-
käsittelyllä. Samalla lisätään avausjärjestysnumero tai request token, jotta
hyvin nopeat eri laskujen avauspyynnöt eivät voi valmistua väärässä
järjestyksessä. Näitä ei muuteta kesken sähköpostin toimitusputken.

Chromiumin PDF-esikatselun oma tulostustoiminto riittää local-MVP:n
tulostuspoluksi. Erillistä suoraa tulostinohjausta ei lisätä tässä vaiheessa.

Selainkehitys säilyttää nykyisen selain-PDF-polun. App-kerros injektoi
desktop-esikatselun callbackina Invoicing-featurelle, joten feature ei tunne
Electronin IPC:tä tai globaalia preload-objektia.

Pääikkunan rajattu preload rakennetaan yhdeksi CommonJS `.cjs` -tiedostoksi.
Sandboxattu Electron-renderer ei tue preloadin ESM-importteja eikä preloadia
saa tämän vuoksi jakaa runtime-tilassa suhteellisia moduuleja lataavaksi
ketjuksi. Preload saa käyttää vain Electronin sandboxissa sallittua
`require('electron')`-rajapintaa ja paljastaa nimetyt, yksittäiset toiminnot
`contextBridge`-rajalla. Paketoitu Windows-smoke varmistaa, että preload-silta
on oikeasti latautunut ennen PDF-esikatselun testaamista.

## Pakollinen Electron-Turvallisuuskonfiguraatio

Spiken ja myöhemmän tuotantobuildin lähtöasetukset ovat:

- `nodeIntegration: false`
- `nodeIntegrationInWorker: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `allowRunningInsecureContent: false`
- ei `<webview>`-elementtejä
- ei remote HTML-, JavaScript- tai plugin-koodia
- preload ei paljasta raakaa `ipcRenderer`- tai Node-API:a
- kaikki IPC-kanavat, senderit, metodit ja syötteet validoidaan
- navigointi ja uusien ikkunoiden avaaminen estetään oletuksena
- `shell.openExternal` hyväksyy vain URL-parserilla allowlistatut `https:`-
  osoitteet eikä koskaan käyttäjän raakaa merkkijonoa
- production-CSP estää inline- ja eval-pohjaisen skriptien suorittamisen
- tuotantoprofiilissa ei ole oletuksena DevToolsia, remote debuggingia tai
  Node inspectoria

Electron-mainin tarkistukset eivät korvaa backendin session-, permission-,
yritysrajaus-, validointi- tai auditointisääntöjä.

## Production Fuses Ja Paketin Eheys

Windows-spiken pitää todentaa, että tuotantobuildissä voidaan lukita ADR-0007:n
mukaiset fuse-asetukset:

- `RunAsNode`: pois
- `EnableNodeOptionsEnvironmentVariable`: pois
- `EnableNodeCliInspectArguments`: pois
- `EnableEmbeddedAsarIntegrityValidation`: käytössä
- `OnlyLoadAppFromAsar`: käytössä
- `GrantFileProtocolExtraPrivileges`: pois
- `EnableCookieEncryption`: käytössä

Paketoitu UI käyttää rajattua custom protocol -mallia laajasti oikeutetun
`file://`-originin sijaan. Fuse-arvot ja ASAR-integriteetti tarkistetaan
automaattisesti myöhemmässä release-putkessa.

## Windows-Paketointispiken Hyväksymiskriteerit

Tekninen package-smoke on hyväksytty, mutta isälle jaettava release hyväksytään
vasta, kun Windows-artifactista on todennettu synteettisellä datalla vähintään:

- sovellus asentuu ja käynnistyy tavallisella Windows-käyttäjällä
- paketoitu renderer latautuu ilman Vite-palvelinta
- backend käynnistyy, ilmoittaa readinessin ja sammuu hallitusti
- backend sitoutuu vain loopbackiin eikä kiinteään julkiseen porttiin
- SQLite-tiedosto syntyy hallittuun, Gitin ja web-resurssien ulkopuoliseen
  sovellusdatahakemistoon
- migraatiot toimivat uudessa tyhjässä tietokannassa
- `better-sqlite3` toimii kohde-Electronin N-API-runtimessa
- nykyinen synteettinen asiakas- tai laskutuspolku toimii end-to-end
- PDFKit tuottaa avattavan synteettisen PDF:n hallittuun datahakemistoon
- ääkköset ja laskun fontit renderöityvät oikein
- backendin kaatuminen ja puuttuva readiness käsitellään turvallisesti
- renderer ei saa Node-API:a, session-salaisuutta tai suoraa tiedostopolkua
- navigointi, uudet ikkunat ja ei-sallitut IPC-pyynnöt estetään
- synteettisen hyväksytyn laskun PDF latautuu suojattuun BrowserWindow-
  esikatseluun nykyisen custom protocol- ja runtime-session-polun kautta
- paketoitu smoke varmistaa lisäksi esikatseluikkunan privilege-asetukset ja
  sen, etteivät popup- tai ulkopuolinen navigointiyritys pääse läpi
- CSP, sandbox, context isolation, fuses ja ASAR-integriteetti voidaan
  todentaa paketoidusta artifactista
- sovellus käynnistyy ja paikalliset ydintoiminnot toimivat ilman internetiä

Spikessä käytetään vain synteettistä dataa ja erillistä testitietokantaa.

## Testit

### Prosessivarauksen adapteri (R18)

`apps/desktop/src/runtime/workspaceProcessReservation.ts` omistaa vain
juurihakemiston tiedostoidentiteetin ja prosessin paikallisen IPC-varauksen.
Se on osa vielä keskeneräistä tuotannon käynnistysketjua ja
[hyväksyttyä R18-sopimusta](release-0.3.0-m1-preparation-plan.md#r18-prosessivarauksen-ja-journal-v2n-sopimusehdotus),
ei yleinen lukituspalvelu tai todiste vanhan suojaamattoman kirjoittajan
poistumisesta.

- `readWorkspaceProcessReservationIdentity(root)` lukee jo olemassa olevan
  validoitavan juuren identiteetin; se ei luo hakemistoa. Identiteetti ei ole
  salaisuus, käyttöoikeustunniste eikä julkiseen diagnostiikkaan kuuluva arvo.
- `acquireWorkspaceProcessReservation({ userDataRoot, expectedIdentity, signal })`
  hankkii paikallisen varauksen ja tarkistaa juuren myös bindin jälkeen.
  Kutsuja omistaa nykyisen käynnistyksen määräajan; adapteri ei lisää ajastinta,
  uusintaa tai uutta määräaikaa. `signal` peruuttaa hankinnan, ei jo palautetun
  omistajan varausta.
- Kahvan `assertOwned()` tarkistaa yhä voimassa olevan varauksen sekä juuren.
  `invalidated` keskeytyy pysyvästi virheessä ja myös tarkoituksellisessa
  vapautuksessa. Kumpikaan ei anna business-kirjoituslupaa: mainin ja lapsen
  erillinen työlupaketju on kytkettävä kokonaan ennen käyttöönottoa.
- `release()` on idempotentti ja odottaa nykyisen palvelinkahvan sulkukuittausta.
  Omistajuus mitätöityy heti; uusi kutsu saa saman Promisen myös sulkuvirheessä.
  Virhehavainto ei vapauta varausta automaattisesti kesken suojatun työn.
  Kutsujan pitää ensin todeta omistetun työn ja kahvojen sulku.
- `WorkspaceProcessReservationError` säilyttää suljetun `reason`-luokan ja
  hankinnan epäonnistumiseen liittyvän erillisen `cleanupFailed`-havainnon.
  Se ei säilytä käyttöjärjestelmän raakavirhettä tai polkua. Tuotannon
  operational-/käyttäjäpalautekytkentä kuuluu seuraavaan toteutuspalaan;
  luokan olemassaolo ei todista tapahtuman diagnostiikkaketjua.

`workspaceProcessReservationDescriptor.ts` omistaa yksityisen kanavan
varausarvon: `generationId`, `identity` ja `userDataRoot`. Lukija hyväksyy
vain nämä kolme omaa datakenttää, kanonisen sukupolvitunnisteen, täsmällisen
juuritiivisteen ja rajatun absoluuttisen juuripolun. Se palauttaa uuden
muuttumattoman arvon, ei viittausta lähettäjän muokattavaan olioon.
Vertailu vaatii kaikkien kolmen kentän yhtäsuuruuden. Arvon jäsentäminen tai
vertailu ei tarkista tiedostojärjestelmää, hanki varausta tai myönnä työlupaa;
nykyiset prosessiomistajat vastaavat näistä erillisistä tilasiirtymistä.
Arvoa ei julkaista operational-lokiin tai rendererille. Adapteri käyttää
saman omistajan identiteettivalidointia.

Backendin yksityisen viestin lukija tarkistaa `prepare`-, `reservationReady`-,
`start`-, `ready`- ja `failed`-viestien täsmälliset kenttäjoukot sekä
käynnistyksen `config`-arvon. Tuntemattomia kenttiä ei siirretä eteenpäin.
Backendin parent ja lapsi toteuttavat nyt valmistelun, sidotun varausvalmiuden
ja erillisen työluvan; kirjoittavaa backend-moduulia ei ladata ennen lupaa.
Parent odottaa valmistelun sekä asynkronisen lupatarkistuksen ja tekee
synkronisen valtuutustarkistuksen juuri ennen `start`-viestin ja porttien
lähettämistä. Nykyinen käynnistysbudjetti ei nollaudu. Prosessin poistuminen,
valmistelu-/lupacallbackien valmistuminen ja varauksen takaisinotto vaaditaan
ennen seuraavan omistajan työtä. Tuotantokutsujat käyttävät samaa main-omistajaa;
kohdetesti ei silti todista koko sovelluksen varausketjua.

Candidate-lapsen nykyinen `workspaceCandidateRunner` vaatii jo järjestyksen
`prepare` -> varauksen hankinta -> `reservationReady` -> `start` (työlupa).
Valmistelu ja varausvalmius sisältävät yksityisen varausarvon, jonka
`generationId` on tämän yhden prosessin `requestId`. Työlupa ja sulku sidotaan
valmistelun samoihin `operationId`-, `requestId`- ja `runtimeSession`-arvoihin.
Generic-ready ei anna työoikeutta. Lapsi tarkistaa omistajuuden ennen
kirjoittavan moduulin latausta ja uudelleen ennen ladatun operaation kutsua;
keskeytys tai omistajuuden menetys estää viivästyneen jatkon.
Moduulin lataajan polkutarkistukset eivät vielä ole kirjoittavaa työtä.
Lataaja ylittää synkronisen `beginLoad`-portin vasta juuri ennen importia;
keskeytetty tai aikarajan ylittänyt polkutarkistus ei saa arvioida moduulia
myöhemminkään. Jumittunut alkuperäinen omistajuustarkistus tai polkutarkistus
ei estä työluvattoman/pre-import-lapsen määräaikaista poistumista.

Yksi nykyinen kymmenen sekunnin käynnistysbudjetti kattaa valmistelun,
varauksen ja työluvan tarkistuksen; valmisteluviesti ei aloita uutta määräaikaa.
Työluvaton orpo poistuu sen puitteissa. Jo käynnissä olevan työn keskeytys
odottaa nykyisen operaation kahvojen sulkua, eikä terminal-viesti vapauta
varausta: varaava utility pitää sen prosessin poistumiseen asti.

Candidate-parentin nykyinen factory vaatii mainin operaatiokohtaisen
varausportin. Sen `prepare` sulkee ristiriitaisen mutation-admissionin ja
luovuttaa varauksen; lapsen vastaus sidotaan koko yksityiseen pyyntöön ja
varausarvoon. `assertGrant` tekee asynkroniset tarkistukset, minkä jälkeen
`assertCurrent` varmentaa saman valtuutuksen synkronisesti ennen työluvan
lähettämistä. Valmistelun tai tarkistuksen myöhäinen jatko ei lähetä työtä
keskeytyksen jälkeen. Käynnistysbudjetti ei nollaudu näiden vaiheiden välissä.

`reclaimAfterExit` saa käynnistyä vasta todetun lapsen exitin ja keskeneräisten
valmistelu-/lupacallbackien valmistumisen jälkeen nykyisen sulkubudjetin
puitteissa. Myöhäinen takaisinotto ei saa avata admissionia peruutuksen jälkeen.
Tuloksen luku vaatii sekä onnistuneen tavallisen sulun että takaisinoton.
`invalidate` on pysyvä epävarmuusmerkintä uudelleenkäynnistykseen asti,
ei lupa poistaa candidatea tai palautusjournalia. Määräajat perustuvat
monotoniseen kelloon, eivät Windowsin säädettävään seinäkelloon.

**Main-kytkentä on toteutettu rajatuin kohdetestein:** kolme candidate-
compositionia ja business-backend käyttävät samaa main-varausomistajaa.
Omistaja hankitaan ennen ensimmäisiä ristiriitaisia työtilan käsittelyjä.
Startup-valtuus päättyy käynnistyksen valmistuessa; management-operaatio
kaappaa nykyisen huoltovarauksen täsmällisen kahvan ja tarkoituksen, ei
pelkkää busy-tilaa. Tuore single-instance-omistajuus tarkistetaan odotusten
jälkeen ja ennen työluvan lähetystä. Epävarma takaisinotto estää myös
create/import-virhesiivouksen korjaavan luvun ja poiston.

Desktopin tyyppitarkistus ja rajatut composition-/siivoustestit läpäisivät.
Journal V2:n cold-admission ja recovery on kytketty ennen workspace-valintaa:
readonly admission, nykyinen build-portti, tuore varaus sekä sama huoltolease
edeltävät korjaavaa lukua ja siivousta. V1 tai epäselvä journaliton plaintext
estää avaamisen aineistoa muuttamatta. Cold-terminal ei ohita normaalia
business-käynnistystä tai terveystarkistusta. Keskeneräinen startup-callback
mitätöi ulomman sulun, vaikka lapsi olisi jo poistunut ja varaus saatu takaisin;
varaus säilyy mainin poistumiseen asti. E2E-todennuskutsujat ja koko kytkennän
katselmus ovat vielä kesken. Tämän välitilan perusteella ei tehdä mergeä
tai väitetä packaged-ketjua hyväksytyksi. Suojaamatonta oletusta ei lisätä.

`workspaceProcessReservation.test.ts` testaa identiteetin, virheiden pysyvyyden,
keskeytykset, sulun ja kilpailut hallitulla rajapinnalla.
`workspaceProcessReservation.integration.test.ts` käyttää oikeaa paikallista
IPC:tä vain synteettisissä hakemistoissa: saman juuren poissulku, vapautus,
eri juuret ja puuttuvan juuren esto. Linuxin erillinen prosessikoe täydentää
adapterinäyttöä, mutta ei ole Electronin käynnistysketjun hyväksyntä.
`workspaceProcessReservationDescriptor.test.ts` kattaa arvon kenttä- ja
kokorajat, muuttumattoman kopion sekä väärän sukupolven ja juuren erottamisen.
`workspaceCandidateRunnerLoader.test.ts` todentaa tuotannon lataajalla
keskeytyksen ennen importia ja tavallisen moduulin arvioinnin erillisellä
synteettisellä sivuvaikutusmerkillä; se ei ole kokonaisen prosessiketjun testi.
Nykyisten backend-viestien ja prosessiomistajan regressiot tarkistetaan
yhdessä; parserin testi ei yksin todista runtime-omistajuutta.
Adapteri ei tuota pysyvää artifactia eikä muuta backup-formaattia. Tuotantoon
kytkeminen vaatii edelleen R18:n koko matriisin ja hardened Windows packaged
backup -> inspect -> restore -> restart -> compare -todistuksen.

### Käynnistyksen omistajuus ennen backend-kahvaa

`backendProcess.ts` omistaa prosessin myös silloin, kun käynnistys ei ole
vielä palauttanut `DesktopBackendHandle`-kahvaa. Ensimmäinen turvallinen
virhekoodi lukitaan ennen lopetuspyyntöä. Nykyinen rajattu exit-odotus ja
pysyvä exit-havainto asennetaan ennen pyyntöä; pelkkä `kill()`-paluuarvo,
puuttuva kahva tai hylätty Promise eivät todista prosessin poistumista.
Fork-kutsua edeltävä todettu virhe erotetaan itse fork-kutsun epävarmasta
poikkeuksesta. Myöhäinen spawn, ready tai callbackin valmistuminen ei
avaa epäonnistunutta käynnistystä uudelleen.

Sisäinen `DesktopBackendStartupError` säilyttää turvallisen ensikoodin
ja muuttumattoman omistajuushavainnon: `processState`,
`migrationGateSettled` sekä `reservationReclaimed`. Näitä ei muodosteta raakavirhetekstistä. Composition
saa aloittaa profiilin tai yritysvalinnan recoveryn vain, kun backendin
käynnistystä ei vielä yritetty tai poistuminen, mahdollisen
migraatiovalmistelun valmistuminen ja varauksen takaisinotto on todettu.
Virhehaara tarkistaa lisäksi saman main-omistajan takaisin saadun varauksen.
Tuntematon tulos säilyttää
aineiston eikä avaa business-ikkunaa. Poistuminen virhekoodilla todistaa
poissaolon, mutta ei hallittua sammutusta.

Migraatioportin `stopStartupRuntime()` odottaa nykyistä strict-
sammutusta ja varauksen takaisinottoa, ei sitä kutsuvaa callbackia. `DesktopBackendStartupStoppedError`
tarkoittaa sekä onnistunutta graceful-sulkua että callbackin valmistumista.
Callbackin alkuperäinen viiden minuutin takaraja säilyy prosessin
poistumisen jälkeenkin, eikä sitä käynnistetä uudelleen. Tavallinen
käynnistysvirhe ei odota keskeneräistä callbackia rajattoman pitkään:
exit-odotuksen jälkeen palautetaan senhetkinen muuttumaton havainto ja
keskeneräinen callback estää rinnakkaisen recoveryn. Aikarajan päättyminen
ei peruuta callbackin jo aloittamaa työtä.

Käyttäjäpalaute ja operational-loki käyttävät nykyisiä turvallisia
startup-/backend-koodeja. Sisäinen omistajuushavainto ei tuo uutta loki-
tai renderer-rajapintaa; alkuperäinen poikkeus kuuluu vain jo hyväksyttyyn
valinnaiseen yksityiseen testihavaintoon. `backendProcess.test.ts` todentaa
kilpailut kontrolloidulla prosessilla ja ajalla; `desktopRestoreStartup.test.ts`
todentaa recovery-rajauksen oikean compositionin, synteettisten tiedostojen
ja journalien kautta. Nämä eivät korvaa hardened Windows packaged
backup -> inspect -> restore -> restart -> compare -porttia.

### Sovelluksen sulkemisen nykyinen sopimus

Electron mainin `before-quit`-käsittelijä estää jokaisen uuden
sulkemispyynnön niin kauan kuin ensimmäisen pyynnön käynnistämä sammutus
on kesken. Desktop-composition palauttaa rinnakkaisille `shutdown()`-
kutsuille saman odotettavan lopputuloksen myös virhetilanteessa.
Viimeinen `app.quit()` sallitaan vasta sulkuketjun valmistuttua tai
virheen tultua käsitellyksi; elinkaari omistaa nykyisen virheraportoinnin.
W6-pakettitodennuksen oma quit-ohitus sallitaan vain sen jo odottaman
onnistuneen sammutuksen jälkeen. Tämä ei muuta käyttöjärjestelmän
pakottaman lopetuksen käsittelyä eikä takaa havaintoa jokaisesta
prosessin keskeytyksestä.

Prosessin todettu poistuminen ja hallittu sammutus pidetään erillään.
Pakkopysäytys ei tuota
[palautuspisteiden puhtaan sammutuksen merkkiä](local-backup-and-restore-plan.md#machine-local-recovery-point).
Tavallisen sulun nykyinen rajattu pakkopysäytys ja `stopForUpdate()`-
polun tiukempi vaatimus säilyvät; aikarajoja ei muuteta.

### Päivityksen hallittu sulku

Mainin update-handoff käyttää `MainOwnedActiveWorkspaceLifecycle.stopForUpdate()`-
polkua, joka kutsuu backendin olemassa olevaa strict-sammutusta. Tavallinen
workspace-/sovellussulku säilyttää nykyisen forced-fallbackin. Molemmat
jakavat saman ensimmäisen sulkupyynnön tehtävän ja todellisen tuloksen:
update voi liittyä vain saman operationin update-sulkuun. Ordinary-sulun
`exited` ei todista update-suojaa eikä kelpaa handoffiin. Eri operation
hylätään, eikä jo aloitettua tai epäonnistunutta pysäytystä käynnistetä uudelleen.
Strict-polkuun liittyvä tavallinen sulku odottaa samaa onnistumista tai
virhettä; se ei avaa pakkopysäytyksen kiertotietä.

R04:n backend-vastaanottaja tukee erillistä täsmällistä
`shutdownForUpdate`-viestiä ja snapshot-brokerin validoimaa operationia.
Backend vaatii valmistuneen käynnistyksen sekä tarkistaa saman update-suojan
ennen palvelimen sulkua ja sen viimeisen odotuksen jälkeen. Snapshot-broker
suljetaan vasta viimeisen tarkistuksen jälkeen. Jokainen broker-sulku
yritetään myös virheessä; epäonnistuminen antaa ei-nollan exitin ilman
raakavirheen julkaisemista. Vastaanottaja säilyttää ensimmäisen sulkupyynnön:
sama update voidaan toistaa ja ordinary-pyyntö voi liittyä siihen, mutta
ordinary-pyynnön jälkeinen update tai eri operation mitätöi onnistumisen.
Tavallinen `shutdown` hyväksyy vain oman täsmällisen viestimuotonsa.

Mainin prepare/handoff-owner, lifecycle ja backend-lähettäjä välittävät
saman operationin tähän vastaanottajaan. Paketoitujen kokeiden välittäjät
säilyttävät tunnisteen; kehitystestien fake-backend hylkää update-sulun,
jota sen ordinary-protokolla ei kykene todistamaan. Kytkentä on katettu
composition- ja broker/HTTP-regressioilla. Runnerin synteettinen testi tai
ohjattu sulkuadapteri ei korvaa oikean utility-prosessin ja
packaged-päivityksen todistusta.

Päivityksen quiescence- tai scheduler-virhe sulkee request-admissionin
hallittuun uudelleenkäynnistykseen asti. Tavallisen workspace-quiescen
palautumissääntö säilyy. Kyse on mainin request-rajasta; backendin koko
pre-update-jakson kirjoitussuoja kuuluu erilliseen R04-sopimukseen.

Jokainen capability- ja broker-sulku yritetään yhden ryhmän virheestä
huolimatta. Sulkuryhmän tulos säilytetään, joten virheenkäsittely ei toista
jo tehtyjä sulkuja eikä peitä ensimmäistä hylkäystä uudella onnistumisella.
Workspace-managementin guard suljetaan muiden capabilityjen yhteydessä;
käynnissä olevan operaation journal-, rollback- ja relaunch-viimeistelyä
ei peruta. Puhtaan sammutuksen merkki kirjoitetaan vasta kaikkien vaadittujen
sulkujen onnistuttua ja backendin graceful-tuloksen jälkeen. `forced`
voi todistaa ordinary-polun prosessipoissaolon, mutta ei puhdasta sulkua
eikä update-handoffin lupaa.

Virhepalaute käyttää nykyisiä `desktop.shutdownFailed` /
`DESKTOP_SHUTDOWN_FAILED`- ja updaterin `runtimeShutdown` /
`UPDATE_SHUTDOWN_TIMEOUT`-luokituksia. Viimeinen koodi on nykyinen
handoff-sulkuvirheen yleiskoodi, ei todiste aikakatkaisun juurisyystä.
Raakapoikkeuksia ei lisätä operational-lokiin. Olemassa olevat Diagnostics-
ja tukipaketin lukuketjut säilyvät; tekninen sulku ei ole business Activity.
Omistajan sisäinen `WorkspaceRuntimeStopError` säilyttää ensimmäisen
turvallisen vaihe-/syyluokan erillään myöhemmistä sulkuvirheistä. Composition
säilyttää tämän syyn ja omat siivousvirheidensä suljetut vaihenimet erikseen;
raakaviestiä tai kutsupinoa ei kopioida mukaan. Sisäinen syyrakenne ei ole
uusi julkinen virhe- tai lokisopimus.

`mainOwnedActiveWorkspaceLifecycle.test.ts` todentaa molemmat kutsujärjestykset,
reentrant-kutsun, forced/unknown-tulokset sekä fail-closed-quiescencen.
`desktopRestoreStartup.test.ts` käyttää oikeaa main-compositionia ja
handoff-koordinaattoria: vain backend-, Electron- ja installer-rajat sekä
synteettisen paketin/palautuspisteen valmistelu ovat kontrolloituja.
Journalin ja clean-merkin readback sekä turvallisen operational-lokin
readback täydentävät installer-kutsun tarkistusta. Kilpailutesti odottaa
handoffin todellista `runtimeShutdown`-vaihetta ennen tavallisen sulun
vapauttamista. Yhdistelmävirhe todentaa backendin ensisyyn säilymisen
broker-siivouksen virheen yli. Tämä ei ole oikean
MSI:n, backupin tai paketoidun runtimen hyväksyntänäyttö.

Kohderegressiot omistavat `desktopBeforeQuit.test.ts`,
`desktopRestoreStartup.test.ts`, `backendProcess.test.ts` ja
`backendShutdown.test.ts`. Tuotannon elinkaarimuutos vaatii lisäksi
synteettisen hardened Windows packaged backup -> inspect -> restore ->
restart -> compare -todennuksen ja muuttuneen revision muut nykyiset portit.

Toteutusvaiheessa lisätään riskin mukaan vähintään:

- main/preload IPC allowlist -yksikkötestit
- väärän senderin, polun, metodin ja otsakkeen negatiiviset testit
- request- ja response-kokorajojen testit
- puuttuvan, virheellisen ja vanhentuneen sessionin backend-testit
- varmistus, ettei renderer voi korvata session- tai authorization-otsaketta
- backend-prosessin readiness-, timeout-, crash- ja shutdown-testit
- runtime-profiilien testit, jotka estävät development-poikkeusten päätymisen
  productioniin
- paketoidun Windows-artifactin smoke-testit
- PDF-esikatselun resource-id-, sender-, navigointi-, popup-, webview-,
  ikkunarekisteri- ja latausvirhetestit
- tarkistus, ettei pakettiin sisälly `.env`-tiedostoja, testitietokantoja,
  varmuuskopioita tai salaisuuksia

Testit eivät käytä oikeaa asiakasdataa, SMTP-salasanaa tai muuta salaisuutta.

## Ei Toteuteta Ensimmäisessä Spikessä

- oikeaa asiakas- tai laskutusdataa
- asiakkaille tarkoitettua oikeaa sähköpostilähetystä tai sen `sent`-
  tilasiirtymää
- Firebase Authia tai pilvisynkronointia
- automaattipäivitystä tai julkaisukanavaa
- production code signing -avaimen kytkentää
- laajaa installer- tai päivitys-UI:ta
- liiketoimintalogiikan siirtämistä Electroniin

Automaattipäivityksen, allekirjoitetun julkaisun, salatun varmuuskopioinnin ja
rollbackin arkkitehtuurit on suunniteltu ADR-0009:n, ADR-0010:n,
`local-backup-and-restore-plan.md`- ja
`windows-installer-and-update-plan.md`-dokumenttien mukaan. Tuotantokoodi,
installeriteknologia ja release gate ovat edelleen toteuttamatta. Oikea data
ei saa odottaa jälkikäteen tehtävää backup- tai recovery-korjausta.

## Toteutusjärjestys

1. Hyväksytään tämä rajattu toteutussuunnitelma.
2. Tehdään Electron- ja paketointiriippuvuuksien dependency/security review.
3. Valitaan tarkat versiot ja paketointityökalu.
4. Luodaan minimaalinen `apps/desktop` ilman liiketoimintalogiikkaa.
5. Toteutetaan Electron-kehitysprofiili ja paketoitu production-profiili.
6. Todennetaan backend, SQLite, migraatiot ja PDFKit Windows-artifactissa.
7. Local-session ja backendin auth-middleware negatiivisine
   turvallisuustesteineen on toteutettu.
8. Pysyvä local-runtime-identiteetti ja nykyisten business-reittien luotettu
   `ActorContext`-yritysrajaus on toteutettu.
9. Sähköpostisalaisuuden lifecycle-audit luo yhden `pending`-operaation ja
   päivittää sen `succeeded`- tai `failed`-tilaan ilman salaisen arvon
   tallentamista. Keskeneräinen päivitys jää näkyvästi `pending`-tilaan.
10. Electron main processin `safeStorage`-broker, versionoitu salattu tiedosto
    ja utility processin kapea client on toteutettu ilman uutta npm-riippuvuutta.
11. Desktop-sessionilla suojattu HTTP-, API-client- ja UI-lifecycle sekä koko
    polun paketoitu Windows-smoke on toteutettu synteettisellä arvolla.
12. Riippuvuudeton SMTP/MIME-kuljetus, kiinteä DNA-testiprofiili,
    backend-only secret reader, prepare/send-kertakäyttövaltuutus ja Electron
    main processin vahvistus on toteutettu ja oikea DNA-yhteys on varmennettu
    pakotetulla testivastaanottajalla.
13. Hyväksytyn laskun PDF-esikatselu käyttää main-prosessin muodostamaa
    `eky://app`-osoitetta, rajattua preload/IPC-toimintoa ja yhtä suojattua
    BrowserWindow-instanssia ilman uutta PDF-riippuvuutta.
14. Asiakaslähetyksen prepare/send-polku käyttää main processin vahvistusta,
    current PDF:ää, delivery event -auditointia ja atomista
    `approved` -> `sent` -tilasiirtymää. Oikean asiakasdatan käyttö odottaa
    erillistä release security gatea.
15. Valinnainen toimitetun lasku-PDF:n paikallinen arkistokopio käyttää
    Invoicingin kapeaa sink-porttia, yksityistä utility process -> main
    -brokeria ja main-prosessin omistamaa native-kansionvalintaa. Renderer ei
    saa raakaa polkua, eikä arkistointivirhe peru onnistunutta toimitusta.
16. Arkistokansion valinta käyttää ennen configin tallennusta samaa
    exclusive-temp-, `fsync`- ja hard-link-finalisointia kuin oikea PDF-kopio.
    Electron-E2E todistaa erikseen deliveryä muuttamattoman failure-polun,
    restart-recoveryn ja no-overwrite-conflictin.

R0:n alkuperäinen yhden profiilin data adoptoidaan W4:ssä ADR-0011:n mukaiseen
workspace-rakenteeseen copy -> validate -> atomic publish -ketjulla.
Production-startup käyttää tämän jälkeen registryyn sidottua aktiivista
workspacea. Main-prosessin sisäinen W5A-hallintafoundation on toteutettu, mutta
käyttäjälle näkyvä usean workspacen hallinta julkaistaan vasta W5B-W6-
porttien jälkeen. Vain yksi profiili saa olla auki kerrallaan ja
edellisen backend, SQLite-yhteys sekä runtime-session suljetaan ennen
seuraavan avaamista.
Backup/Restore-tuotantokoodi toteutetaan erikseen
`local-backup-and-restore-plan.md`-suunnitelman mukaan ennen oikean datan
R0-käyttöönottoa.

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/ai/workflow.md`
- `docs/ai/testing-rules.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-database-implementation-plan.md`
- `docs/architecture/local-desktop-dependency-review.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
