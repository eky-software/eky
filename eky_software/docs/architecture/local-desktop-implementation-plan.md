# Local Desktop Implementation Plan

Tämä dokumentti kuvaa ADR-0007:ssä päätetyn Electron-pohjaisen paikallisen
desktop-runtimen ensimmäisen rajatun toteutus- ja Windows-paketointispiken sekä
sen toteutustilan.

Rajattu tekninen package-spike ja sen ensimmäinen local-session-luottamusraja
on toteutettu 14.7.2026. Electron `safeStorage` -secret broker on toteutettu
15.7.2026 synteettisellä paketointismokella. Desktop-sessionilla suojattu
salaisuuden HTTP-, API-client- ja UI-lifecycle sekä koko polun Windows-smoke on
toteutettu 15.7.2026. Toteutus ei vielä sisällä SMTP-provideria, installeria,
code signingia tai automaattipäivitystä.

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
- staged-kopiossa Electronin ABI:lle rakennetun `better-sqlite3`-moduulin
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

Package-spike ei ole loppukäyttäjän release. Spike käyttää virallisesta
npm-rekisteristä saatavia Electron 42.6.1- ja `better-sqlite3 12.11.1`
-versioita. `better-sqlite3 12.11.1` korjaa Electron 42:n Windows-käännön.
Electron 43:een siirrytään heti, kun sitä tukeva `better-sqlite3 12.11.2` tai
uudempi versio on julkaistu myös npm-rekisteriin ja Windows package- sekä
smoke-testit läpäisevät päivityksen. Installer, code signing, tavallisen
Windows-käyttäjän manuaalinen hyväksymistesti, visuaalinen PDF-tarkistus ja
päivityskanava ovat edelleen avoimia toimitusvaiheita.

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
    runtime/
    secrets/
  package.json
  tsconfig.json
```

Vastuut:

- `main/` omistaa Electron-ikkunan, prosessien elinkaaren ja privileged IPC:n
- `preload/` paljastaa rendererille vain nimetyn desktop-transportin
- `runtime/` kokoaa session-bootstrapin, backend-prosessin ja polkuadapterit
- `secrets/` eristää safeStorage-suojauksen, salatun tiedoston ja yksityisen
  main/utility-process-brokerin
- React-featuret pysyvät `apps/web`-sovelluksessa
- backendin moduulit pysyvät `apps/backend`-sovelluksessa
- API-clientin julkinen sopimus säilyy Electronista riippumattomana

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
- `better-sqlite3`-native addonin Electron ABI -yhteensopivuus
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
- preload paljastaa vain rajatun request-metodin
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
- `better-sqlite3` toimii kohde-Electronin ABI:lla
- nykyinen synteettinen asiakas- tai laskutuspolku toimii end-to-end
- PDFKit tuottaa avattavan synteettisen PDF:n hallittuun datahakemistoon
- ääkköset ja laskun fontit renderöityvät oikein
- backendin kaatuminen ja puuttuva readiness käsitellään turvallisesti
- renderer ei saa Node-API:a, session-salaisuutta tai suoraa tiedostopolkua
- navigointi, uudet ikkunat ja ei-sallitut IPC-pyynnöt estetään
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
- tarkistus, ettei pakettiin sisälly `.env`-tiedostoja, testitietokantoja,
  varmuuskopioita tai salaisuuksia

Testit eivät käytä oikeaa asiakasdataa, SMTP-salasanaa tai muuta salaisuutta.

## Ei Toteuteta Ensimmäisessä Spikessä

- oikeaa asiakas- tai laskutusdataa
- SMTP-providerin backend-only secret reader -kytkentää
- SMTP-provideria tai oikeaa sähköpostilähetystä
- Firebase Authia tai pilvisynkronointia
- automaattipäivitystä tai julkaisukanavaa
- production code signing -avaimen kytkentää
- laajaa installer- tai päivitys-UI:ta
- liiketoimintalogiikan siirtämistä Electroniin

Automaattipäivitys, allekirjoitettu julkaisu, tietokannan varmuuskopiointi ja
rollback suunnitellaan erikseen onnistuneen paketointispiken jälkeen. Oikea
data tai SMTP-salaisuus ei saa odottaa jälkikäteen tehtävää turvallisuuden
korjausta.

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
    SMTP-provider arvioidaan erillisenä turvallisuus- ja riippuvuusmuutoksena.

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/ai/workflow.md`
- `docs/ai/testing-rules.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-database-implementation-plan.md`
- `docs/architecture/local-desktop-dependency-review.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0003-technical-foundation.md`
- `docs/decisions/ADR-0004-local-backend-runtime.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
