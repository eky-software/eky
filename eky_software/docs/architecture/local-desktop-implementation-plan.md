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
17.8.2026. Paketointi käyttää better-sqlite3:n mukana toimitettua Windows x64
N-API-binääriä eikä enää rakenna staged-kopiota Electron ABI:lle.

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

Package-spike ei ole loppukäyttäjän release. Nykyinen varmennettu runtime
käyttää virallisesta npm-rekisteristä saatavia Electron `43.3.0`- ja
`better-sqlite3 13.0.2` -versioita. Windows package-, smoke-, Electron-E2E-,
stressi- ja soak-testit läpäisevät yhdistelmän. Installer, code signing,
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
W5A on lisännyt tämän päälle vain main-prosessin sisäisen management-palvelun,
production-lifecycle- ja private candidate -adapterit sekä yhden yhteisen
installation-scoped maintenance-auktoriteetin. Preload, IPC, renderer ja web-
hallinta kuuluvat erilliseen W5B-vaiheeseen. Production-compositionin rajat on
todennettu Electron-E2E:ssä synteettisellä private userData -juurella ilman
rendererille avattua workspace-capabilitya.

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
  toiminto on `openInvoicePdf(invoiceId)`, eikä se hyväksy URL:ia tai polkua
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
resource-id-säännöllä validoitavan `invoiceId`-arvon. Renderer ei saa välittää
URL:ia, tiedostopolkua, backend-originia, headereita tai runtime-sessionia.

Main process muodostaa itse täsmällisen osoitteen:

```text
eky://app/invoices/{invoiceId}/pdf
```

Custom protocol lisää backendin runtime-sessionin vasta main-prosessissa.
Backendin `ActorContext`-, permission- ja `companyId`-rajaukset pysyvät siten
voimassa myös esikatselussa.

PDF-ikkunassa ei ole preloadia, Node-integraatiota, webviewta tai DevToolsia.
Ikkuna estää popupit, permission-pyynnöt ja navigoinnin pois täsmälleen mainin
muodostamasta PDF-osoitteesta. Ikkunoita ei luoda rajattomasti: sama lasku
fokusoidaan uudelleen ja eri laskua avattaessa aiempi esikatselu suljetaan.
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
