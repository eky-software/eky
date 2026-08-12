# Windows-asennin ja paikallinen päivitys

## 1. Tila

Arkkitehtuuripäätös on hyväksytty ADR-0010:ssä. ADR-0009:n salattu
backup/restore, recovery pointit, aktivointijournal ja Windows packaged
restore -todistus ovat toteutettu 4.8.2026. Rajattu per-user x64 MSI-
prototyyppi on toteutettu ja sen install-, repair-, uninstall-, major upgrade-,
downgrade-esto- ja binary rollback -rajat on todennettu synteettisellä datalla.
Local Update Foundation tarkistaa paikallisen manifestin ja MSI-identiteetin,
soveltaa vaihdettavaa trust-policya ja rekisteröi hyväksytyn paketin Electron
mainin yksityiseen tekniseen cacheen. Yksityinen C2-orkestrointi,
pre-update/pre-migration-suoja, crash-safe journal, guarded installer handoff
sekä UI:ta edeltävä first-start-hyväksyntä on toteutettu. C3B:n business- ja
binary-rollback sekä business-UI:sta eristetty recovery-only-ikkuna ovat
toteutettu. C3C:n rajattu paikallisen päivityksen UI ja nimetyt renderer-
capabilityt ovat toteutettu. C3B:n koordinoitu kahden MSI-version binary-
rollback on todennettu Windows Installerilla: epäonnistunut N-palautus korjaa
N+1:n takaisin eikä jätä mixed-version-asennusjuurta. C3C:n koko business-
profiilin, PDF-artifactien ja runtime-sessionin final packaged -matriisi,
fyysisen median manuaalinen tarkistus ja code signing ovat edelleen auki.

### Local Update Program -checkpointit

| Checkpoint | Tila | Huomio |
| --- | --- | --- |
| C0 Electron cold-start baseline | valmis 11.8.2026 | `DESK-PDF-001` ajettiin 10 kertaa retries=0 ja Electron critical kahdesti puhtaasti; aiemman flaken juurisyytä ei väitetä korjatuksi |
| C1 Local Update Foundation | valmis 11.8.2026 | Manifestin runtime-codec, vaihdettava trust-policy, native selection, private staging/cache ja nykyisen rollback-paketin rekisteröinti; ei MSI:n käynnistystä eikä business-dataa |
| C2 Update Orchestration and First Start | valmis 11.8.2026 | Yksityinen migration gate, pre-update/pre-migration recovery, crash-safe journal, graceful-only handoff, accepted-build-metadata ja UI:ta edeltävä first-start-hyväksyntä; ei käyttäjälle avattua päivitys-UI:ta tai rollbackia |
| C3 Recovery, Compatibility and Pilot Release | käynnissä | C3B:n business/binary-rollback, täsmällisen rollback-paketin valinta, recovery-only-tila ja koordinoitu MSI-palautus sekä C3C:n rajattu paikallinen update-UI ovat toteutettu; koko final packaged -matriisi, fyysinen media ja code signing ovat kesken |

Migration runnerin SHA-256-checksum-, chain identity- ja release/build-
metadata on toteutettu 10.8.2026. Historiallinen mismatch torjutaan ennen
pending-migraation SQL-kirjoitusta, ja legacy-kanta ankkuroidaan erikseen
`legacy_baseline`-tilaan. Tämä ei vielä avaa N -> N+1 -päivityspolkua ilman
pre-migration-palautuspistettä ja first-start-orkestrointia.

Projektin omistaja hyväksyi 10.8.2026 ensimmäiseen per-user x64 MSI-
prototyyppiin `WixToolset.Sdk` 7.0.0:n, .NET SDK 10.0.302:n ja SHA-lukitun
virallisen `actions/setup-dotnet`-actionin build-työkaluiksi. Omistaja hyväksyi
WiX 7:n MS-RL- ja OSMF EULA -ehdot ja vastaa mahdollisen ylläpitomaksun
soveltuvuuden selvittämisestä. Hyväksyntä ei kata WiX-extensioneita, custom
actioneita, Burnia, runtime-riippuvuutta tai allekirjoittamattoman prototyypin
jakelua oikeaan käyttöön.

### Installer entry -checkpointit

| Checkpoint | Tila | Huomio |
| --- | --- | --- |
| A1 Dependency gate alignment | valmis (`ae445c8`) | Read-only audit jokaiselle `main`-PR:lle, dependency-polkuun rajatulle `main`-pushille, päivittäin ja käsin; ei automaattimergeä |
| A2 Migration manifest continuity | valmis (`a824114`) | Migraatiot alkavat `001`:stä ja jatkuvat katkeamatta; nykyinen 38 migraation ketju on regressiotestattu |
| A3 Migration failure semantics | valmis (`cab05c0`) | Startup raportoi vaiheen ja tämän ajon valmistuneiden migraatioiden määrän; koko ajon sivuvaikutustila on aina `unknown` |
| A4 Package inventory final audit | valmis (`1436442`) | Installer-payload torjuu Eky-runtimejäämät, yksityisavaimet ja service-account-tunnisteet sekä vaatii vendor-jäämille täsmällisen katselmoinnin |
| A5 MSI version contract | valmis (`7aa1213`) | Täysi SemVer `appVersion` ja monotoninen numeerinen `msiProductVersion` ovat eri release-sopimuksia |
| A6 Package trust and private staging | valmis (`ae070e5`) | Vain uudelleen varmennettu yksityinen staging-artifacti voidaan suorittaa |
| A7 WiX dependency decision | hyväksytty 10.8.2026 | `WixToolset.Sdk` 7.0.0, .NET SDK 10.0.302, SHA-lukittu `actions/setup-dotnet`, MS-RL ja OSMF EULA hyväksyttiin rajattuun per-user x64 -prototyyppiin |

### Per-user MSI -prototyypin checkpointit

| Checkpoint | Tila | Huomio |
| --- | --- | --- |
| B1 Installer composition | valmis (`436949f`) | Installerin build-työkalut, suljettu release-konfiguraatio sekä version, identiteetin ja sidecar-manifestin sopimukset |
| B2 Identity and install root | valmis (`986d0b6`) | Vakaa UpgradeCode, versiokohtainen ProductCode, vakaat component-GUIDit, per-user `%LOCALAPPDATA%\\Programs\\Eky` ja read-only MSI-inspektori |
| B3 Install, repair and uninstall | valmis (`94b4479`) | Puhdas asennus, pakotettu repair, uninstall/reinstall sekä business-datan ja poistettavuuden todennus |
| B4 Two-version upgrade | valmis (`496d409`) | Kahden synteettisen version major upgrade, downgrade-esto, rollback ja Windows-virhepolut |
| B5 Build once and sidecar | valmis (`f0f2e2f`) | MSI rakennetaan kerran, validoidaan ja sidotaan täsmälleen samoihin tavuihin SHA-256-sidecarilla; CI ei vielä julkaise artifactia |
| B6 Release gate hardening | valmis (`0db338b`) | Lukittu restore toistetaan ilman lock-driftiä, vain ICE91 suppressataan, uninstall todentaa HKCU/ARP-siivouksen ja N -> N+1 testataan käynnissä olevalla Eky- ja utility-prosessilla samoista sidotuista N-tavuista |

B2-prototyypin MSI sisältää vain nykyisen kovennetun Windows-payloadin,
rekisteripohjaiset per-user key pathit, MSI:n omistamien asennushakemistojen
tyhjien kansioiden poistomerkinnät ja yhden Start Menu -pikakuvakkeen.
Read-only-inspektori varmistaa ProductCode-, UpgradeCode-, ProductVersion-,
scope-, install root-, komponentti-, tiedosto-, rekisteri-, RemoveFile- ja
shortcut-sopimukset sekä sen, ettei paketissa ole custom actioneita tai
business-datan tunnettuja standardihakemistoja.

WiX:n ICE-validointi ajetaan eikä sitä poisteta käytöstä. Vain täsmällinen
`ICE91` on suppressattu WiX-projektissa; yleistä warning suppressionia ei
käytetä ja kaikki muut WiX- sekä ICE-varoitukset käsitellään buildin
pysäyttävinä virheinä. Puhtaasti per-user-
scopeen rajattu prototyyppi tuottaa yhden ICE91-varoituksen jokaisesta
payload-tiedostosta, koska tiedostojen hakemistopolku ei vaihdu mahdollisen
`ALLUSERS`-arvon mukaan. Paketti ei tue per-machine-asennusta eikä aseta
`ALLUSERS`- tai dual-purpose `MSIINSTALLPERUSER` -ominaisuutta, joten varoitus
on tässä rajatussa prototyypissä tunnettu scope-huomio. Muut ICE-virheet ja
-varoitustyypit käsitellään ennen checkpointin hyväksymistä.

B3-elinkaaritesti kieltäytyy ajosta, jos samalla ProductCodella rekisteröity
Eky, olemassa oleva install root tai käynnissä oleva Eky-prosessi havaitaan.
Testi asentaa MSI:n hiljaisesti ilman restartia, vertaa kaikki asennetut
payload-tiedostot alkuperäiseen paketoituun artifactiin SHA-256-arvoilla,
poistaa yhden rajatun tiedoston ja todentaa pakotetun Windows Installer
repairin. Tämän jälkeen testi todentaa uninstallin, reinstallin, uuden
uninstallin, pikakuvakkeen, installerin oman `HKCU\\Software\\Eky\\Installer`-
avaimen ja Windowsin ARP-merkinnän poistumisen sekä olemassa olevan `%APPDATA%\\Eky`-
profiilin muuttumattomuuden. Onnistuneen ajon yksityiset temp-lokit poistetaan;
epäonnistuneen ajon lokit jätetään paikallista vianmääritystä varten.

MSI:n asennushakemiston tunniste on tarkoituksella yksityinen
`EkyInstallFolder`, ei julkinen uppercase MSI-property. Komentorivi ei voi
ohittaa kiinteää per-user-asennusjuurta `%LOCALAPPDATA%\\Programs\\Eky` eikä
valita installerille toista payloadia. Unicode- ja välilyöntiyhteensopivuus
todennetaan siirtämällä MSI testissä tällaiseen lähdepolkuun, ei muuttamalla
asennusjuurta.

B4/B6 käyttää nykyisenä N-versiona B5:n jo kerran rakentamaa ja sidecarilla
sidottua release-MSI:tä. Upgrade-fixture ei rakenna N-versiota uudelleen.
Vain synteettinen N+1 ja erillinen rollback-probe-MSI rakennetaan omiin
fixture- ja WiX-intermediate-hakemistoihinsa. Fixture ei kuulu jaeltavaan
artifactiin, ja N-MSI:n SHA-256 tarkistetaan ennen upgrade-testiä sekä sen
jälkeen.

Major upgrade käyttää `RemoveExistingProducts`-toimintoa `InstallExecute`-
toiminnon jälkeen ja ennen `InstallFinalize`-toimintoa. Read-only MSI-
inspektori valvoo tämän sekvenssin. B4-todistus kattaa N -> N+1 -päivityksen,
vanhemman version downgrade-eston, hallitun N+1-asennusvirheen ja Windows
Installerin binary rollbackin takaisin N-versioon, käynnissä olevan Electron-
mainin ja Electron utility/backend-prosessin aikaisen suoran päivitysyrityksen,
Unicode- ja välilyöntejä
sisältävän MSI-lähdepolun sekä lopullisen uninstallin. `%APPDATA%\\Eky`-
business-data inventoidaan ennen testiä ja todetaan muuttumattomaksi jokaisen
vaiheen jälkeen.

B5:n release-komento vaatii puhtaan työpuun ja täyden Git HEAD -revision.
Komento rakentaa jaeltavan MSI:n kerran, tarkastaa MSI:n read-only-
inspektorilla ja sitoo tiedostonimen, koon, SHA-256-tiivisteen, release-
identiteetin sekä Git-revision erilliseen suljettuun sidecar-manifestiin.
Manifesti kirjoitetaan vasta, kun samat MSI-tavut ovat läpäisseet tarkastuksen.
Myöhemmät lifecycle- ja fixture-testit eivät saa rakentaa jaeltavaa MSI:tä
uudelleen, ja release-MSI:n tavut varmennetaan vielä testien jälkeen.

Windows CI ajaa installer-testit, kovennetun pilot-paketoinnin, kaksi
peräkkäistä lukittua WiX-restorea muuttamatta `packages.lock.json`-tiedostoa,
build-once-releaseportin, install/repair/uninstall-elinkaaren sekä
synteettisen N -> N+1-, downgrade- ja rollback-todistuksen. CI ei tässä
checkpointissa lataa artifactia julkaisuun, allekirjoita sitä tai tee siitä
oikealle käyttäjälle jaettavaa releasea.

CI käyttää .NET SDK:ta `global.json`-sopimuksella `10.0.302`,
`rollForward: disable` ja `allowPrerelease: false`. Virallinen
`actions/setup-dotnet` on täsmällisesti releaseen `v5.4.0` kuuluvaan
40-merkkiseen commit-SHA:han
`26b0ec14cb23fa6904739307f278c14f94c95bf1` lukittu. Floating tagia tai
automaattista major-vaihtoa ei sallita tässä installer-portissa.

Restore käyttää vain `NuGet.Config`-tiedostossa sallittua nuget.org-lähdettä,
pakettilähdekartoitusta, vaadittua allekirjoitusvalidointia ja FireGiantin
nimettyä signer-varmennetta. WiX- ja .NET-build-työkaluja ei pakata Eky MSI:n
runtime-payloadiin.

## 2. Tavoite

Eky Localille tehdään hallittu Windows-asennus- ja päivityspolku, joka:

- käyttää samaa release-artifactia puhtaaseen asennukseen ja päivitykseen
- pitää ohjelmabinaarit erillään yritysprofiilista
- ei käynnistä schemaa muuttavaa versiota ilman palautumispistettä
- tukee ensin paikallista tiedostoa tai USB-mediaa
- voidaan myöhemmin laajentaa allekirjoitettuun etäpäivitykseen

## 3. Omistajuus

Vastuut ovat:

- **release pipeline:** muodostaa versionoidun Windows-artifactin ja
  manifestin
- **external installer/updater:** asentaa ja tarvittaessa palauttaa binaarit
- **Eky Update Coordinator:** valmistelee sovelluksen sisäisen päivityksen
- **Backup/Restore:** muodostaa ja palauttaa pre-update-palautuspisteen
- **first-start maintenance:** validoi uuden buildin, migraatiot ja healthin
- **renderer:** näyttää tilan ja pyytää nimettyjä toimintoja

Update ei ole Company Settings -master dataa. Update Coordinator kuuluu
Electron mainin infrastructure-kerrokseen.

## 4. Luottamusrajat

Luottamusrajan ulkopuolelta tulevat:

- käyttäjän valitsema päivityspaketti
- paketin manifesti ja allekirjoitus
- tiedostojärjestelmän tila
- asentajan exit code ja sivuvaikutukset
- tulevaisuudessa verkosta ladattu metadata ja artifacti

Renderer ei saa välittää:

- tiedostopolkua
- URL:ia
- komentoriviä tai yksittäisiä prosessiargumentteja
- suoritettavan tiedoston nimeä
- release-manifestia luotettuna tietona
- runtime-sessionia

Electron main valitsee tiedoston native-dialogilla ja muodostaa ulkoisen
prosessin argumenttilistan ilman shell-merkkijonoa.

## 5. Puhdas asennus

Puhdas asennus:

1. validoi Windows-version ja arkkitehtuurin
2. asentaa vain release-binaarit ja staattiset resurssit
3. ei luo synteettistä yritysdataa production-profiiliin
4. jättää `userData`-juuren asennushakemiston ulkopuolelle
5. käynnistää Eky first-start-polun
6. muodostaa uuden tyhjän profiilin vain applicationin hallitulla
   bootstrapilla

Installer ei kirjoita suoraan SQLite-tauluihin.

### Production profile and packaging cleanliness -checkpoint

Ennen ensimmäistä installer-pilottia erotetaan ja todennetaan neljä runtimea:

- backend/browser-kehityksen `eky-dev.sqlite` tai development `.env` -polku
- testikohtainen private E2E `eky-e2e.sqlite`
- vain validoidulla switch+token-parilla aktivoituva packaged smoke tempissä
- normaali desktop `userData/runtime/data/eky.sqlite` ilman env-fallbackia

Nykyinen Windows-paketointi inventoi `applicationStage`-, `backendStage`-,
`desktopRuntimeStage`- ja lopullisen unpacked package -hakemiston. Pakettiin ei
saa päästä tietokantaa, lasku-PDF:ää, backupia, tukipakettia, lokia,
ympäristötiedostoa, salaisuutta, E2E-runtimea, fixtureä, testiä, lähdehakemistoa
eikä oikeaa käyttäjäprofiilia. Backend deployataan linkittömänä hoisted-
rakenteena, ja symboliset linkit torjutaan jokaisessa inventoidussa vaiheessa.
Packaged-smoke-helperit sallitaan vain täsmällisestä nimilistasta.

Lopullinen inventaario torjuu Eky-omisteiset `.json.gz`-, `.log`-, `.bak`-,
`.backup`-, `.dmp`- ja `.pem`-jäämät. Yksityisavaimet (`.key`, `.p12`,
`.pfx` ja private key -sisältöinen PEM) sekä rakenteeltaan tai nimeltään
service account -tunnisteita vastaavat JSON-tiedostot torjutaan omistajasta
riippumatta. Vastaavan vendor-runtime-artifactin löytyminen pysäyttää buildin
katselmointia varten; sitä ei sallita yleisellä päätesäännöllä, vaan vasta
tarvittaessa täsmällisellä polkukohtaisella allowlist-päätöksellä.

Inventory-hashin tiedostojärjestys perustuu normalisoitujen loogisten polkujen
locale-riippumattomaan koodipistejärjestykseen. Hashin toistettavuus ei siten
riipu build-koneen kieli- tai locale-asetuksesta.

Inventaario torjuu lisäksi Eky-projektin omat source mapit ja valvoo jokaiselle
stagelle erikseen tiedostomäärää, kokonaiskokoa, loogisen UTF-8-polun pituutta,
hakemistosyvyyttä ja yksittäisen projektin omistaman tiedoston kokoa. Kolmannen
osapuolen `node_modules`-sourcemappeja ei poisteta tai hyväksytä sokkona: ne
kuuluvat inventory-hashiin sekä määrä- ja kokorajoihin.

10.8.2026 puhtaan nyky-artifactin mittaus ja sen päälle asetettu hallittu
marginaali ovat:

| Stage | Mitattu tiedostomäärä / raja | Mitattu koko / raja | UTF-8-polku / raja | Hakemistosyvyys / raja | Suurin projektitiedosto / raja |
| --- | ---: | ---: | ---: | ---: | ---: |
| `applicationStage` | 138 / 192 | 1 238 626 B / 2 MiB | 69 / 96 B | 3 / 5 | 602 826 B / 1 MiB |
| `backendStage` | 2 298 / 2 700 | 50 736 073 B / 64 MiB | 90 / 128 B | 7 / 9 | 50 261 B / 256 KiB |
| `desktopRuntimeStage` | 36 / 64 | 119 315 B / 1 MiB | 61 / 96 B | 1 / 3 | 11 961 B / 256 KiB |
| `packagedApp` | 2 409 / 2 800 | 416 286 887 B / 512 MiB | 108 / 160 B | 9 / 11 | 1 276 118 B / 2 MiB |

Rajoja ei nosteta vain siksi, että uusi artifacti ei mahdu niihin. Ylitys
vaatii paketin sisällön tarkastuksen, perustellun dokumenttipäivityksen ja
uuden puhtaan baseline-mittauksen. Pilot-manifestin nykyistä formaattia ei
muuteta tällä kovennuksella.

Normaali `package:windows` jää kehityskäyttöön. Erillinen
`package:windows:pilot` vaatii puhtaan ja HEADiin sidotun buildin, `pilot`-
kanavan, suljetun inventaarion ja validoidun pilot-sidecar-manifestin.
Kyse ei vielä ole installerista.

Paikallinen pilot-profiili auditoidaan Eky suljettuna copy-only-työkalulla.
Audit ei korjaa, nollaa tai tulosta business-dataa. Profiilin käsittelystä
päätetään vasta turvallisen luokituksen jälkeen.

Production-profiilia ei muodosteta kopioimalla kehitys-, E2E-, smoke- tai
pilot-testiprofiilia eikä poistamalla siitä jälkikäteen tunnettua testidataa.
Lopullinen profiili syntyy tyhjänä hallitulla bootstrapilla, ja testaus tehdään
siitä erillisessä profiilissa tai käyttöjärjestelmärajassa.

Lopullisen production-profiilin ensimmäinen hyväksytty lasku on oikea.
Sama artifacti on sitä ennen testattu erillisellä synteettisellä profiililla,
erillisellä Windows-käyttäjällä tai virtuaalikoneessa.

Nykyinen paikallinen pilot-paketointi ei vielä täytä "build once, test once,
distribute the same bytes" -release-sääntöä. Ensimmäinen installer-pipeline
muodostaa yhden artifactin, sitoo sen manifestiin ja SHA-256-arvoon, ajaa
hyväksytyt testit juuri sille artifactille ja jakelee saman artifactin ilman
paikallista uudelleenrakennusta.

### Production-datan ja backupin sisältöraja

Siirrettävä business-backup ei kopioi tai arkistoi koko Electron
`userData`-juurta. Backupin mukaan tulevat vain:

- aktiivisen yritysprofiilin SQLite-tietokanta
- moduuliomistajien backup-sopimuksissa auktoritatiivisiksi ilmoittamat
  hyväksyttyjen laskujen PDF:t ja muut business-artifactit

Backupin ulkopuolelle jäävät:

- SMTP-salaisuus ja muut `safeStorage`-blobit
- operational- ja security-lokit
- tukipaketit
- konekohtaiset recovery pointit
- backup-, restore-, arkistointi- ja päivitysjournalit
- konekohtaiset asetukset
- installerit ja release-binaarit
- synteettinen testi-, E2E-, smoke- ja fixture-data

Yhteinen backup-infrastruktuuri ei etsi tiedostoja heuristisesti eikä oleta
kaikkea `userData`-sisältöä auktoritatiiviseksi. Uusi moduuli tai pysyvä
business-artifact ilmoittaa oman inclusion/exclusion-, snapshot-, restore-
validator- ja recovery-sopimuksensa ennen kuin se voidaan ottaa backupiin.

## 6. Olemassa olevan asennuksen päivitys

Päivitys säilyttää saman sovellusidentiteetin ja `userData`-juuren. Asennin
korvaa vain binaarit, kun Eky-prosessit ja backend ovat suljettuina.

Asennin ei:

- siirrä business dataa asennushakemistoon
- poista profiilia tai palautuspisteitä
- aja SQL-migraatioita
- tulkitse lasku- tai asiakasdataa
- merkitse päivitystä hyväksytyksi

## 7. Sovelluksesta käynnistetty paikallinen päivitys

Käyttäjäpolku:

1. käyttäjä avaa `Tuki ja historia` -> `Sovellus ja päivitykset`
2. valitsee paikallisen Eky-sidecar-manifestin native-dialogilla
3. Update Coordinator tarkistaa paketin ja näyttää turvallisen yhteenvedon
4. käyttäjä vahvistaa päivityksen
5. Eky muodostaa pre-update-palautuspisteen
6. runtime suljetaan hallitusti
7. ulkoinen asentaja käynnistetään
8. Eky poistuu
9. asennin käynnistää uuden version tai pyytää käyttäjää käynnistämään sen
10. first-start maintenance hyväksyy tai hylkää päivityksen

R0:ssa päivitystä ei käynnistetä automaattisesti ilman käyttäjän vahvistusta.

Renderer käyttää vain nimettyjä nollaparametrisia capabilityja
`getLocalUpdateStatus()`, `selectLocalUpdate()`,
`discardSelectedLocalUpdate()`, `confirmLocalUpdate()` ja
`cancelLocalUpdate()`. Electron main avaa native-dialogin manifestille, lukee
suljetun manifestin ja johtaa sen samassa hakemistossa olevan paketin nimen
vain validoidusta `packageFilename`-kentästä. Renderer ei saa manifestin tai
paketin raakaa polkua, täydellistä tiivistettä, executablea, URL:ia,
komentoriviä, sessionia tai prosessioikeutta. R0:ssa ei valita executablea
suoraan eikä käytetä yleistä `openFile`-capabilityä.

`confirmLocalUpdate()` ei hyväksy rendereriltä candidate-tunnistetta tai
muuta päivitysdataa. Electron main lukee ja validoi nykyisen candidate-slotin
uudelleen, näyttää native-vahvistuksen ja käynnistää vain siihen sidotun
palautuspiste-, shutdown- ja installer-handoff-polun. Vahvistuksen peruuttaminen
ennen handoffia ei luo palautuspistettä tai journalia, sulje runtimea eikä
kosketa business-dataan.

UI sijaitsee polussa `Oma yritys` -> `Tuki ja historia` ->
`Sovellus ja päivitykset`. Se näyttää rajatun nykyversion, buildin, kanavan,
rollback-paketin tilan, candidate-version, recovery point -tilan ja
päivitysvaiheen. Selainkehityksessä capability on tarkoituksella pois
käytöstä; webiin ei lisätä fake-filesystem-adapteria.

Allekirjoittamattoman pilotin native-vahvistus näyttää nykyisen ja kohde-
app-version, nykyisen ja kohde-MSI-version, kanavan, arkkitehtuurin, lyhyen
SHA-256-sormenjäljen, rollback-paketin ja pre-update-pisteen tilan sekä
seuraavan varoituksen:

> Tämän pilot-päivityksen julkaisijaa ei ole varmennettu Windowsin
> digitaalisella allekirjoituksella. Jatka vain, jos päivityspaketti on saatu
> suoraan Eky-kehittäjältä hallitulla medialla.

Jatkotoiminto on eksplisiittinen `Jatka päivitykseen`, ja turvallinen
oletusvalinta on `Peruuta`.

### Package trust ja yksityinen staging

Paikallista MSI-pakettia ei suoriteta suoraan USB-muistilta, latauskansiosta
tai muusta käyttäjän valitsemasta lähdehakemistosta. Electron main omistaa
koko luottamusrajan:

1. käyttäjä valitsee vain sidecar-manifestin native-dialogilla
2. main validoi suljetun manifestin ja johtaa MSI:n nimen itse
3. main tarkistaa lähde-MSI:n identiteetin, koon, SHA-256-tiivisteen ja
   käytettävissä olevan allekirjoitusnäytön
4. main kopioi manifestin ja MSI:n Eky-private update staging -alueelle
5. staging-kirjoitus viimeistellään ja synkronoidaan ennen käyttöä
6. main lukee staged manifestin ja MSI:n uudelleen sekä toistaa kaikki
   tarkistukset staged tavuista
7. päivitysjournal sidotaan täsmälleen tähän staged artifactiin
8. vain uudelleen varmennettu staged MSI voidaan antaa installer handoffiin.

Kopiointi ei siirrä luottamusta automaattisesti. Jos lähde muuttuu tarkistuksen
aikana, staged tavut eivät vastaa manifestia tai stagingia ei voida viimeistellä
turvallisesti, päivitys keskeytetään ennen palautuspistettä, runtime-sulkua ja
asentajan käynnistystä. Vanhat ja keskeneräiset staging-slotit siivotaan
versionoidun journalin perusteella; mielivaltaista käyttäjäpolkua ei säilytetä
journalissa tai lokissa.

Renderer saa vain turvallisen tarkistus- ja etenemistilan. Se ei saa lähde- tai
staging-polkua, tiedostonimeen perustuvaa executable-oikeutta, paketin tavuja,
manifestin allekirjoitusta eikä prosessiargumentteja.

Päivitysjournal sitoo vähintään:

- `appVersion`-kohdeversion
- `msiProductVersion`-kohdeversion
- package identityn ja tarkasti validoidun tiedostonimen
- tavukoon
- SHA-256-tiivisteen
- release-kanavan ja arkkitehtuurin
- myöhemmin hyväksyttävän publisher- ja allekirjoitusidentiteetin.

SHA-256 todistaa vain, että MSI:n tavut vastaavat manifestissa ilmoitettuja
tavuja. Se ei todista manifestin tai paketin julkaisijaa. Normaali in-app update
ei saa käynnistää allekirjoittamatonta pakettia ilman projektin omistajan
erikseen hyväksymää trust anchor -mallia. Projektin omistaja on hyväksynyt
ensimmäiselle yhdelle hallitulle laitteelle ADR-0010:n rajatun
`localUnsignedPilot`-mallin: vain `pilot`-kanava, paikallinen tiedosto tai
tarkistettu USB-media, käyttäjän nimenomainen vahvistus, private staging ja
staged tavujen uusintavarmennus. Malli ei salli verkosta lataamista,
taustapäivitystä, hiljaista päivitystä, `stable`-kanavaa tai suojauksien
ohittamista.

Ennen jaeltavaa päivitystä arvioidaan ja lukitaan:

- MSI:n ja Eky-binaarien Authenticode-allekirjoitus sekä RFC 3161 -aikaleima
- allekirjoitetun sidecar-manifestin tai muun signed envelope -mallin trust
  anchor ja avainkierto
- tarkka publisher-identiteetin validointi ennen stagingia ja uudelleen juuri
  ennen handoffia
- release-allekirjoitusavaimen säilytys kokonaan repositorion, sovelluksen,
  backupin, stagingin ja käyttäjän business-profiilin ulkopuolella.

### Paikallinen rollback-pakettivälimuisti

Update Coordinator käyttää Electron mainin omistamaa, asennuskohtaista
teknistä pakettivälimuistia. Se ei kuulu yritysprofiiliin eikä ole business
dataa. Välimuistissa on kolme loogista slottia:

- `current`: käynnissä olevan N-version tarkistettu MSI, manifesti ja checksum
- `candidate`: valittu ja private stagingiin kopioitu N+1-kokonaisuus
- `previous`: hyväksyntää edeltävä N-kokonaisuus binary rollbackia varten.

Ennen N -> N+1 -päivitystä `current` varmennetaan manifestista ja sen pitää
vastata käynnissä olevan sovelluksen identityä, versiota, build revisionia,
platformia ja arkkitehtuuria. Ensimmäisellä käyttökerralla `current` voidaan
bootstrapata vain Electron mainin native-dialogilla valitusta manifestista;
renderer ei saa polkua tai tavuja. Candidate varmennetaan lähteessä ja staged
kopiosta. Vasta first-start-hyväksynnän jälkeen vanha current siirtyy
previous-slotiksi ja candidate current-slotiksi.

Windows Installerin omaa cachea ei käytetä ainoana rollback-lähteenä.
Current- ja previous-kokonaisuudet varmennetaan aina uudelleen juuri ennen
käyttöä. Välimuistilla on toteutuksessa lukittava koko- ja levybudjetti,
keskeytyksenkestävä slotinvaihto sekä sääntö, joka säilyttää enintään
rollbackiin tarvittavan nykyisen ja edellisen hyväksytyn kokonaisuuden.

Tämä cache ei kuulu `.ekybackup`-varmuuskopioon, konekohtaiseen recovery
pointiin, tukipakettiin, lasku-PDF-arkistoon, Activityyn tai business auditiin.
Se kuuluu vain Update Coordinatorin tekniseen lifecycleen. Sallittu sanitoitu
tila voidaan myöhemmin projisoida Diagnosticsiin erikseen hyväksytyn event
catalogin kautta.

### C1:n vastuuraja

C1 saa valita, tarkastaa ja private stagingiin kopioida `candidate`-paketin
sekä rekisteröidä käynnissä olevaa buildia vastaavan `current`-paketin.
Candidate säilytetään vain rajatun cache-budjetin ja crash-safe
slot-metadatan mukaan. Käyttäjän vahvistus kuuluu myöhempään C2-orkestrointiin;
C1 ei käynnistä MSI:tä, sulje runtimea, muodosta pre-update-pistettä, kirjoita
päivitysjournalia, aja first-start-polkuja eikä muuta business-dataa.

Päivitystoiminto pidetään tavalliselta käyttäjältä piilossa tai poistettuna
käytöstä C3:n pilot release -porttiin asti. C1:n capabilityt eivät anna
rendererille polkuja, manifestia, MSI-tavuja, executablea tai argumentteja.

C1 toteutettiin checkpoint-commiteilla `f76bb9e`, `be2026c`, `329b07b`,
`137753d`, `404e960`, `caeee86`, `995764c` ja `b4525b0`. Testit kattavat
tiukan manifesti- ja MSI-identiteettisopimuksen, saman version ja downgrade-
paketin, väärän release-identiteetin, arkkitehtuurin ja asennusscopen,
hash- ja kokomismatchin, lähdetiedoston mutaation, keskeytyneen ja levytilaan
epäonnistuvan kopion, reparse-rajat, vioittuneet slotit sekä rendererin
nollaparametrisen capability-rajan. Development-E2E antaa release identityn
eksplisiittisesti puuttuvana, joten se ei aktivoi paketoidun releasen update-
foundationia vahingossa.

## 8. Suora Setup-päivitys

Käyttäjä voi käynnistää uuden Setup-ohjelman myös Eky-sovelluksen
ulkopuolelta. Tällöin Update Coordinator ei ole ehtinyt tehdä journalia tai
pre-update-pistettä.

Ensimmäinen uuden version käynnistys:

- tunnistaa build- ja schema-version muutoksen
- siirtyy maintenance-tilaan ennen business-runtimen avaamista
- muodostaa pre-migration-palautuspisteen
- keskeyttää, jos palautuspistettä ei voida tehdä
- ajaa vasta sen jälkeen forward-migraatiot

Tämä fallback ei korvaa suositeltua sovelluksesta käynnistettyä päivitystä.

## 9. Päivitysmanifesti

Versionoitu manifesti sisältää vähintään:

- manifest format version
- app identity
- app version
- numeerinen MSI product version muodossa `major.minor.build`
- build revision ja build identity
- platform
- architecture
- release channel
- package filename tai sisäinen package identifier
- package byte size
- SHA-256
- mahdollinen minimi lähtöversio
- mahdollinen sallittu downgrade-tieto
- signing metadata myöhemmässä vaiheessa

Manifesti käyttää suljettua skeemaa, kokorajoja ja tarkkaa version
parsimista. Unknown fields, duplicate keys, poikkeavat app identity -arvot,
väärä platform/architecture ja liian suuri artifacti torjutaan.

Package SHA-256 ei ole itseään sisältävä tiiviste. R0:n myöhempi installer
käyttää package-artifactista erillistä sidecar-manifestia tai muuta
ei-itseviittaavaa signed envelope -mallia. Manifesti tai envelope voi olla
allekirjoitettu ja viitata paketin nimeen, kokoon ja SHA-256-arvoon, mutta sitä
ei sisällytetä samaan tavujonoon, jonka tiiviste tarkistetaan. Installeria,
allekirjoitusta tai update-koodia ei toteuteta backup/restore-vaiheessa.

Build identity ei ole digitaalinen allekirjoitus.

Teknologiakatselmuksen ehdottama R0-artifact-layout on:

```text
release/
  Eky-<appVersion>-x64.msi
  Eky-<appVersion>-x64.manifest.json
```

Sama täysi MSI palvelee clean installia, repairia ja major upgradea. R0 ei
käytä deltaa tai patch-pakettia. Sidecar-manifestin ja MSI:n basename,
app identity, versio, kanava, arkkitehtuuri, koko ja SHA-256 sidotaan
toisiinsa ennen käyttäjän vahvistusta ja tarkistetaan uudelleen välittömästi
ennen installer handoffia.

Sama `appVersion` ja `msiProductVersion`-pari saa viitata vain samaan
jaeltuun MSI-tavujonoon. Sen uudelleenajo on eksplisiittinen repair, ei uusi
release. Muuttunut payload vaatii uuden SemVer-version ja monotonisesti
suuremman MSI-tuoteversion. MSI-tuoteversiota ei johdeta commit-määrästä,
build-ajasta tai kellosta. Downgrade torjutaan sekä SemVer- että MSI-version
perusteella.

## 10. Pre-update-palautuspiste

Pre-update-piste:

- on pakollinen ennen Update Coordinatorin käynnistämää asennusta
- käyttää ADR-0009:n machine-local recovery point -mallia
- tehdään vain terveestä profiilista
- validoidaan ennen runtime-sulkua
- suojataan rotaatiolta, kunnes päivitys on hyväksytty tai rollback valmis

Jos palautuspistettä ei voida muodostaa, päivitystä ei aloiteta.

## 11. Päivitysjournal

### C3A:n installation-scoped state

Päivitysjournal ja hyväksytyn buildin metadata ovat asennuskohtaisia, eivät
aktiivisen yritysprofiilin business-dataa. Niiden auktoritatiivinen sijainti on
Electronin `userData`-juuren `update-state`-hakemisto. Profiilin runtime-juuren
vanha `update-state` on vain C2-yhteensopivuuslähde, eikä sitä sisällytetä
portable backupiin tai palauteta yritysprofiilin mukana.

Legacy-siirto tehdään ennen muun päivitystilan tulkintaa seuraavasti:

1. uusi installation-scoped tila luetaan ensin
2. legacy-arvo luetaan vain, jos vastaava uusi arvo puuttuu
3. legacy-arvo validoidaan samalla suljetulla codecilla kuin uusi tila
4. arvo kirjoitetaan uuteen sijaintiin crash-safe-mallilla ja luetaan takaisin
5. legacy-arvo poistetaan vasta täsmällisen verifioinnin jälkeen
6. ristiriita, vioittunut arvo tai osittainen siirto pysäyttää käynnistyksen

Siirto on idempotentti. Lokit eivät sisällä polkuja, yritys- tai
profiilitunnisteita, journalin sisältöä tai package-hashia.

Yksityinen C2-journal on versionoitu tilakone:

- `prepared`
- `recoveryPointValidated`
- `runtimeStopping`
- `awaitingFirstStart`
- `firstStartValidating`
- `accepted`
- `rollbackRequired`
- `rolledBack`
- `failed`

`installerLaunched` ei ole erillinen journalitila. Journal kirjoitetaan ja
synkronoidaan `awaitingFirstStart`-tilaan ennen ulkoisen MSI-prosessin
käynnistämistä. Näin myös spawnin tai prosessin kaatumisen jälkeinen tila on
yksiselitteinen. Siirtymät ovat monotonic ja idempotentteja. Yksi journal saa
sisältää enintään yhden installer-handoff-yrityksen; automaattista
uudelleenyritystä ei tehdä.

`rollbackRequired` ja `rolledBack` kuuluvat journalin suljettuun formaattiin,
mutta varsinainen business- tai binary-rollback toteutetaan vasta C3:ssa. C2
ei avaa business-UI:ta ratkaisemattomassa first-start-tilassa eikä yritä
korjata profiilia hiljaisesti.
Journal ei sisällä yritysdataa, raakaa polkua, salaisuutta tai vapaamuotoista
asentajan outputia.

Journalin package identity -kentät ovat suljettuja ja niiden pitää vastata
staged artifactista juuri ennen handoffia uudelleen laskettuja arvoja. Pelkkä
aiemmin lähdetiedostosta laskettu tiiviste ei riitä.

C2:n hyväksyntä kirjoittaa ensin accepted-build-metadatan ja koordinoidussa
päivityksessä `accepted`-journalin. Vasta tämän jälkeen pre-update- ja
pre-migration-pisteiden rotaatiosuoja vapautetaan best-effort-siivouksena.
Siivousvirhe saa jättää ylimääräisen suojatun pisteen myöhempää
idempotenttia siivousta varten, mutta se ei saa muuttaa jo committoitua
hyväksyntää `rollbackRequired`-tilaan.

Journalissa saa olla vain korrelaatiotunniste, nykyisen ja kohdebuildin
turvallinen versio- ja paketti-identiteetti, julkaisukanava, palautuspisteen
opaque-viite, tila, turvalliset aikaleimat ja rajattu attempt count. Journal ei
saa sisältää polkua, `companyId`- tai `profileId`-arvoa, business-dataa,
palautuspisteen sisältöä, salaisuutta, sessionia, komentoriviä tai asentajan
outputia.

## 12. Hallittu shutdown

Ennen asentajan käynnistystä:

1. uudet business-komennot estetään maintenance-lukolla
2. taustatehtävät viimeistellään tai jäädytetään dokumentoidusti
3. backend suljetaan timeoutin sisällä
4. SQLite-yhteys suljetaan
5. utility processit ja brokerit suljetaan
6. runtime-session mitätöidään
7. pääikkuna suljetaan

Pakotettu kill on viimeinen fallback ja jättää journalin
`rollbackRequired`- tai `failed`-tilaan.

C2:n installer-handoff ei saa jatkua, jos graceful shutdown ei valmistu
määräajassa. Pakotettu kill voi olla tavallisen sovellussulun viimeinen
suojakeino, mutta se ei ole onnistunut päivityksen shutdown-kuittaus.

## 13. Handoff ulkoiselle asentajalle

Main käynnistää installer handoffin vain ennalta validoidulle artifactille:

- handoff saa MSI-poluksi vain Eky-private stagingista uudelleen varmennetun
  artifactin
- `shell: false`
- executable ja argumentit erillisinä arvoina
- ei rendererin antamaa argumenttia
- ei URL-protokollan kautta tulevaa komentoa
- ei ympäristömuuttujaan sijoitettua salaisuutta tai sessionia
- child process -kahva ja virheet käsitellään turvallisesti

Asentajalle välitetään vain sen tarvitsema minimoitu, dokumentoitu tieto.
Business-datan polkua ei välitetä.

C2:ssa handoff-moottori ja sen testit ovat sisäisiä. Niitä ei vielä kytketä
renderer-capabilityyn tai tavallisen käyttäjän ajettavaan komentoon, koska C3:n
business- ja binary-rollback sekä pilot release -portti puuttuvat. Tämä estää
osittaisen päivityspolun avaamisen vahingossa.

## 14. First-start maintenance

Uusi versio avaa ennen normaalia UI:ta maintenance-polun:

1. validoi packaged build-infon
2. vertaa app versionia ja journalin kohdeversiota
3. tarkistaa aktiivisen profiilin ja palautuspisteen
4. tarkistaa migration chainin jatkuvuuden
5. ajaa sallitut forward-migraatiot
6. tarkistaa SQLite integrityn ja foreign keys -tilan
7. tarkistaa auktoritatiivisten business-artifactien viittaukset
8. käynnistää backendin uudella runtime-sessionilla
9. odottaa readiness- ja health-tuloksen
10. merkitsee päivityksen hyväksytyksi

Renderer ei avaudu normaaliin business-tilaan ennen hyväksyntää.

First-start-preflight on Electron mainin ja yksityisen backend utilityn
välinen suljettu käynnistyspolku. Se ei ole julkinen HTTP-endpoint,
renderer-capability tai yleinen `skipMigrations`-kytkin.

Update Coordinatorin journalin sisältävä in-app-päivitys vaatii ennen normaalia
backendia, että käynnissä oleva build vastaa journalin kohdebuildia,
`current`- ja `candidate`-slotit ovat uudelleen varmennetut ja journalin
pre-update-piste löytyy sekä läpäisee tarkistuksen. Journal siirtyy tämän
jälkeen `firstStartValidating`-tilaan.

Suora Setup ilman journalia käyttää read-only-preflightia. Tyhjä clean install
ei tarvitse pre-migration-pistettä. Olemassa olevasta profiilista tarkistetaan
migraatioketjun prefix ja pending-migraatiot ennen ensimmäistä SQL-kirjoitusta.
Jos pending-migraatioita on, validoitu pre-migration-palautuspiste on pakollinen
ennen tavallisen backendin ja `runMigrations`-polun käynnistystä.

C3A:ssa suoran Setupin olemassa olevaa profiilia koskeva migraatiopäätös
kirjoitetaan pysyväksi ennen ensimmäistä pending-migraation SQL-kirjoitusta.
Suljettu recovery-record sisältää vain formaattiversion, teknisen korrelaation,
edellisen hyväksytyn buildin, kohdebuildin, opaque pre-migration-viitteen,
migraatioprefixin identiteetin, lähtötilan applied-määrän, turvallisen tilan,
rajatun attempt countin ja UTC-aikaleimat. Se ei sisällä polkuja,
`companyId`-/`profileId`-arvoja, SQL:aa, manifestia, business-dataa,
salaisuuksia, sessionia tai raakaa virhettä.

Jos prosessi pysähtyy esimerkiksi yhden migraation jälkeen, seuraava käynnistys
ei jatka arvaamalla uusinta tilaa. Se vertaa read-only-startup-inspectionia
alkuperäiseen prefixiin ja pysyvään recordiin sekä palauttaa aina recordissa
sidotun alkuperäisen pre-migration-pisteen tai siirtyy `failedSafe`-tilaan.
Uutta palautuspistettä ei luoda osittain migroidusta profiilista.

### Installer not applied / cancelled

`awaitingFirstStart` ei yksin todista, että MSI vaihtoi binaarit. Jos käynnissä
oleva build, hyväksytty build ja current-cache vastaavat yhä vanhaa versiota,
migraatioprefix ei ole muuttunut ja aktiivinen profiili validoituu terveeksi,
journal suljetaan turvalliseen `installerNotApplied`-tilaan. Pre-update-suoja
vapautetaan vasta tämän päätöksen jälkeen ja candidate säilytetään uutta
käyttäjän käynnistämää yritystä varten. Eriävä, mixed tai muuten epäselvä tila
siirtyy `failedSafe`-tilaan; automaattista installer-uusintaa ei tehdä.

### Rajatut cache-operaatiot

Päivityscachella ei ole yleistä clear- tai repair-komentoa. Candidate voidaan
hylätä vain, kun yksikään ratkaisematon journal ei viittaa siihen, ja poisto
kohdistuu täsmälleen yksityisen cache-juuren validoituun candidate-slotiin.
Current voidaan korjata vain käyttäjän native-dialogilla valitsemasta suljetun
manifestin paketista, joka läpäisee täyden trust- ja identity-validoinnin ja
vastaa täsmälleen käynnissä olevaa hyväksyttyä releasea. Ratkaisematon journal
estää molemmat operaatiot. Current- ja previous-slotit eivät muutu candidatea
hylättäessä.

Asennuskohtainen hyväksytyn buildin metadata sisältää vain turvallisen build-
identiteetin ja hyväksyntäajan. Se ei ole business-dataa eikä kuulu portable
backupiin.

## 15. Migraatiot

Migraatiot ovat immutable ja vain eteenpäin ajettavia:

- jo jaettua migraatiota ei muokata
- uutta versiota ei hyväksytä katkenneella migration chainilla
- migration alkaa vasta validoidun palautuspisteen jälkeen
- `schema_migrations`-historia sidotaan teknisessä metadatataulussa SQL-
  checksumiin, ketjuidentiteettiin ja tallentaneeseen release/buildiin
- mismatch torjutaan ennen pending-migraation schema-kirjoitusta
- ensimmäinen oikea N -> N+1 pysyy estettynä, kunnes validoitu pre-migration-
  palautuspiste ja first-start maintenance ympäröivät migration runnerin
- virhe jättää uuden profiloitilan hyväksymättä
- rollback palauttaa profiilin pre-update-pisteestä
- reverse SQL -migraatiota ei ajeta

## 16. Health ja hyväksyntä

Päivitys on hyväksytty vasta, kun:

- build identity vastaa odotettua artifactia
- migraatiot ovat valmiit
- SQLite integrity ja foreign keys ovat kunnossa
- backend on valmis
- `/health` palauttaa odotetun turvallisen vastauksen
- runtime-session toimii
- vähintään rajattu packaged startup smoke onnistuu

Lisäksi C2 tarkistaa migration chainin ja sallitut forward-migraatiot,
`integrity_check`- ja foreign key -tulokset, auktoritatiivisen
PDF/dokumentticlosuren, SMTP-salaisuuden säilymisen, cache-slotit sekä sen,
että uusi runtime-session toimii eikä edellisen prosessin session kelpaa.

Vasta hyväksynnän jälkeen `candidate` ylennetään `current`-slotiksi, vanha
`current` siirtyy `previous`-slotiksi, vanha `previous` poistetaan crash-safe-
rotaation kautta, pre-update-piste vapautetaan normaaliin rotaatioon, journal
siirtyy `accepted`-tilaan ja business-UI voidaan avata.

Asentajan exit code yksin ei riitä.

C2:n toteutetut tekniset operational-eventit ovat
`update.operationStarted`, `update.operationCompleted` ja
`update.operationFailed`. Niiden stage on suljetusti jokin arvoista
`preUpdateRecovery`, `runtimeShutdown`, `installerHandoff` tai
`firstStartValidation`. Eventit sisältävät vain teknisen korrelaation,
keston ja turvallisen lopputilan; observerin virhe ei muuta päivitystransaktion
tulosta.

## 17. Business-datan rollback

Jos first-start epäonnistuu schema- tai datavaiheessa:

- uusi backend ja SQLite suljetaan
- aktiivinen epäonnistunut profiili eristetään tutkimista varten rajatusti
- pre-update-piste palautetaan ADR-0009:n activation/rollback-mallilla
- palautettu profiili validoidaan ja käynnistetään
- journal päivitetään ilman raw erroria tai polkua

Epäonnistuneen profiilin säilytys, koko ja retention päätetään
toteutusvaiheessa. Se ei kuulu tukipakettiin kokonaisena.

C3B:n journalijärjestys on `businessRollbackStarting` ->
`businessRollbackCompleted` -> `binaryRollbackPrepared` ->
`awaitingRollbackFirstStart` -> `rolledBack`. Järjestystä ei saa ohittaa, ja
binary rollbackin yrityslaskuri tallennetaan ennen MSI:n käynnistämistä.
Keskeytys jatkuu vain nykyisestä turvallisesti vahvistetusta vaiheesta;
epäselvä business-profiili estää binaaripalautuksen kokonaan.

Binaaripalautus käyttää vain journalin `currentVersion`-, build-, MSI-, SHA-256-
ja kokotietoihin täsmälleen sidottua pakettia. Jos täsmällinen paketti ei ole
yksityisen cachen `current`- tai `previous`-slotissa, journal siirtyy
`rollbackPackageRequired`-tilaan ennen MSI-yrityksen kuluttamista. Käyttäjä voi
valita paketin vain Electron mainin omistamalla native-dialogilla. Valittu
manifesti ja MSI tarkistetaan samoihin journalin identiteetteihin; eri versio,
build, MSI-identiteetti, hash tai koko torjutaan eikä rollback-yrityslaskuri
muutu.

## 18. Binary rollback

MSI:n normaali downgrade pysyy estettynä. Eky ei lisää WiX-authorointiin
yleistä downgrade-poikkeusta eikä suppressaa ICE61-varoitusta. C3:n
binaaripalautus on Electron main -prosessin koordinoima, tarkasti rajattu
kaksivaiheinen installer-handoff:

1. epäonnistunut N+1 poistetaan sen journalista ja tarkistetusta MSI:stä
   johdetulla ProductCodella
2. täsmälleen journalin N-identiteettiin, SHA-256:een, kokoon ja MSI-
   identiteettiin sidottu rollback-paketti asennetaan
3. jos N:n asennus epäonnistuu poistamisen jälkeen, sama tarkistettu N+1-
   paketti yritetään asentaa takaisin, jotta recovery-only-käyttöliittymä
   säilyy käytettävissä

Renderer ei anna komentoja, polkuja tai ProductCodea. Main muodostaa kiinteän
PowerShell- ja `msiexec`-kutsun validoiduista yksityisen cachen handleista sekä
paketoidusta projektin omasta rollback-skriptistä. Skripti ei ole yleinen
shell-rajapinta eikä se salli ylimääräisiä argumentteja tai verkkolähteitä.

Teknologiavalinnassa pitää todistaa:

- pystyykö moottori säilyttämään tai palauttamaan edellisen version
- miten rollback käynnistyy, jos uusi Eky ei avaudu
- säilyykö code signature ja publisher-validointi
- voiko rollback tapahtua ilman admin-oikeutta
- miten osittainen asennus siivotaan

Binary rollback ei avaa vanhaa ohjelmaversiota uudemmalla, migroidulla
profiililla. Business-datan palautus valmistuu ennen binaaripalautusta, ja
vaiheet koordinoidaan crash-safe journalin avulla. Suora N+1 -> N MSI-
päälleasennus pysyy torjuttuna myös palautuspolun valmistuttua.

`failedSafe`-, `recoveryRequired`-, `rollbackPackageRequired`- ja ristiriitaisen
startup recovery authorityn tilanteissa tavallista backendia tai business-
käyttöliittymää ei käynnistetä. Electron avaa erillisen sandboxatun recovery-
ikkunan, joka ei saa runtime-sessionia, yritysdataa, profiilipolkuja tai raw
journalia. Ikkuna tarjoaa vain turvallisen virhekoodin ja build-identiteetin,
teknisen minimoidun recovery-tukipaketin, lokikansion avaamisen sekä
`rollbackPackageRequired`-tilassa täsmällisen rollback-paketin native-valinnan.

## 19. Code signing

Isän yhdellä hallitulla pilottilaitteella allekirjoittamaton paikallinen
artifacti hyväksytään vain ADR-0010:n `localUnsignedPilot`-mallissa. Se käyttää
`pilot`-kanavaa, suljettua manifestia, tarkistettua SHA-256:ta, yksityistä
stagingia ja käyttäjän vahvistusta. `unsigned-prototype` ei todista
julkaisijaa. `stable`-kanava ja laajempi jakelu eivät hyväksy tätä mallia.
Laajempi jakelu vaatii:

- Windows code signing -sertifikaatin
- suojatun avaimen lifecycle- ja käyttöoikeusmallin
- allekirjoituksen timestampin
- binäärien ja asentajan allekirjoituksen tarkistuksen
- tunnetun publisherin
- release-prosessin, joka ei allekirjoita dirty-buildia

Code signing -salaisuus ei kuulu repoon, sovellukseen tai backupiin.

Nykyinen sidecarin `unsigned-prototype` ja SHA-256 todistavat vain suljetun
prototyyppipaketin eheyden, eivät publisher trustia. Tulevassa signing-
releaseportissa järjestys on: build -> inspect -> sign -> allekirjoituksen ja
timestampin validointi -> lopullinen hash ja manifesti -> samojen
allekirjoitettujen tavujen lifecycle- ja upgrade-testit. Allekirjoituksen
jälkeen aiempaa tavuihin sidottua hashia tai manifestia ei saa käyttää.

## 20. Tuleva etäpäivitys

Etäpäivitys käyttää samaa update source -porttia kuin paikallinen tiedosto,
mutta vaatii lisäksi:

- HTTPS-only origin allowlistin
- allekirjoitetun update-manifestin
- download size- ja timeout-rajat
- redirect-politiikan
- download temp/finalize -mallin
- package signature -tarkistuksen
- kanava- ja rollout-politiikan
- rollback- ja incident-harjoituksen

Pelkkä HTTPS tai SHA-256 ei yksin todista julkaisijan identiteettiä.

## 21. Käyttöliittymä

Päivitykset sijoitetaan:

`Tuki ja historia` -> `Sovellus ja päivitykset`

Näkymä näyttää:

- nykyisen sovellusversion
- build revisionin ja dirty-tilan
- release-kanavan
- paikallisen päivityspaketin valinnan
- tarkistuksen tuloksen
- palautuspisteen valmistelutilan
- vahvistetun päivityskomennon
- turvallisen onnistumis-, keskeytys- tai rollback-tilan

Backup/Restore sijoitetaan erillään:

`Oma yritys` -> `Varmuuskopiointi ja palautus`

UI ei näytä raakaa polkua, asentajan komentoa, journalia, sessionia tai
teknistä virhettä. Päivityksen vahvistus kertoo, että sovellus sulkeutuu.

## 22. Tuleva update-composition

Toteutus jaetaan ilman business-moduulien riippuvuuksia:

```text
apps/desktop/src/update/
  updatePackageManifest.ts
  updatePackageInspector.ts
  localUpdateSource.ts
  updateJournalStore.ts
  updateCoordinator.ts
  installerLauncher.ts
  firstStartUpdateRecovery.ts
  updateOperationalObserver.ts
```

Update Coordinator saa compositionista vain seuraavat kapeat portit:

- `PreUpdateRecoveryPort`
- `RuntimeMaintenancePort`
- `RuntimeShutdownPort`
- `InstallerLauncher`
- `UpdateJournalStore`
- `BuildIdentityReader`
- `ActiveProfileProtectionPort`.

Se ei saa backupin crypto storea, recovery pointin sisäistä polkua,
tietokantakahvaa, rendererin polkua, installer command stringiä eikä
business-moduulin repositorya. `LocalUpdateSource` palauttaa main-prosessin
sisäisen, validoidun package-handlen eikä raakapolkua rendererille.

Nykyinen `desktopComposition.ts` kokoaa myös Profile Protectionin ja on jo
selvästi suuri composition root. Ennen update-tuotantokoodia arvioidaan
käyttäytymistä muuttamaton `profileProtectionComposition.ts`-erotus. Sen
tarkoitus on antaa edellä mainitut kapeat portit eikä avata recovery-servicen
sisäisiä riippuvuuksia Update Coordinatorille. Refaktorointi tehdään omassa
commitissa nykyisten packaged backup/restore-testien suojassa.

## 23. Observability ja audit

Tuleva tekninen tapahtumaperhe on `update.*`. Tarkat event-nimet lukitaan
vasta transaction ownership- ja failure behavior -päätöksessä.

Sallitut tiedot ovat vain:

- korrelaatiotunniste
- nykyinen ja kohdeversio
- release-kanava
- allowlistattu vaihe
- kesto millisekunteina
- rajattu tekninen virhekoodi ja retryable-luokitus
- `sideEffectState`
- nykyisen politiikan sallima build revision/runtime identity

Kiellettyjä ovat:

- paikallinen polku
- installer command
- update URL queryineen
- yritys- tai asiakasdata
- backup- tai palautuspistepayload
- salaisuus tai session
- raw process output, stack tai filesystem error
- vapaa metadata

Päivitysjournalia tai pakettia ei lisätä tukipakettiin. Tukipaketti voi
sisältää vain sanitoidun tilayhteenvedon ja turvalliset tapahtumat.

Virhekoodien käyttäjä- ja tukitoimet omistaa
`windows-update-operational-runbook.md`. Tuotantokoodiin ei lisätä
`update.*`-eventName-arvoja ennen transaction ownership-, stage allowlist-
ja failure behavior -päätöstä.

## 24. Testaus

### Manifesti ja paketti

- validi ja väärä app identity
- platform/architecture mismatch
- version upgrade, sama versio ja downgrade
- kanavaristiriita
- size/hash mismatch
- unknown/duplicate/malformed manifest fields
- truncation ja paketin vaihtaminen tarkistuksen jälkeen
- allekirjoitus puuttuu, väärä tai vanhentunut laajemman jakelun portissa

### Runtime ja process

- renderer ei voi antaa polkua, URL:ia, executablea tai argumenttia
- väärä IPC-sender ja tuntematon capability
- maintenance-lock conflict backupin ja restoren kanssa
- backend graceful shutdown ja timeout
- SQLite-handle sulkeutuu ennen handoffia
- installer spawn failure
- app exit ennen ja jälkeen spawnin eri keskeytyspisteissä
- restart jokaisen journalisiirtymän jälkeen

### First start ja rollback

- validi päivitys ilman migraatiota
- validi päivitys yhdellä ja usealla migraatiolla
- migration failure
- integrity-, foreign key-, readiness- ja health-failure
- puuttuva tai vioittunut pre-update-piste
- business rollback onnistuu ja epäonnistuu
- binary rollback onnistuu ja epäonnistuu
- suora Setup ilman journalia tekee pre-migration-pisteen
- vanha session ei toimi päivityksen jälkeen
- idempotentti uusi käynnistys accepted/failed-tilassa

### Windows release gate

- puhdas asennus tavallisella Windows-käyttäjällä
- toinen saman version asennus ja repair
- päivitys edellisestä tuetusta versiosta
- sama versio ja eksplisiittisesti torjuttu downgrade
- väärä app identity ja väärä arkkitehtuuri
- hash mismatch ja paketin vaihto tarkistuksen jälkeen
- pre-update recovery point -virhe ennen runtime-sulkua
- runtime shutdown timeout
- installer spawn failure ja non-zero exit
- keskeytys jokaisen journalivaiheen jälkeen
- first-start migration-, integrity-, foreign key- ja health-failure
- business rollback ja binary rollback erikseen sekä yhdessä
- vanhan runtime-sessionin torjunta
- polut, joissa on välilyöntejä ja Unicodea
- asennus hakemistoon ilman kirjoitusoikeutta
- levy täynnä ja virustorjunnan aiheuttama tiedostolukko
- uninstall säilyttää business datan
- reinstall löytää saman profiilin ilman installerin dataetsintää
- asennuksesta ei jää orphan-prosesseja
- dirty-buildia ei jaeta
- hardened fuses, ASAR integrity, native addon ja PDF toimivat
- packaged smoke ja kriittinen Electron-E2E päivityksen jälkeen
- palautuspiste -> päivitys -> migraatio -> restart -> business-datan vertailu
- synteettisen SQLite-kannan ja kaikkien auktoritatiivisten PDF:ien hashit
  täsmäävät ennen ja jälkeen onnistuneen päivityksen

Testit käyttävät vain synteettistä dataa eivätkä ulkoista verkkoa ennen
etäpäivitysvaiheen erillistä hyväksyntää.

Ensimmäinen installer-toteutus käyttää yhtä aktiivista profiilia. Portit ja
testifixturet eivät silti saa kovakoodata yhtä ikuista `userData`- tai
runtime-polkua: tuleva profile registry antaa aktiivisen profiilin suojatun
handlen compositionille.

## 25. Riippuvuus- ja turvallisuusportti

Ennen installeriteknologian valintaa vertaillaan vähintään:

- Windowsin natiivi installerimalli
- Electron-ekosysteemin installer/maker-vaihtoehdot
- nykyisen oman package-scriptin laajentaminen

Arvioidaan:

- suorat ja transitiiviset riippuvuudet
- ylläpito ja julkaisutahdin turvallisuus
- code signing
- delta/full update
- binary rollback
- admin-oikeuksien tarve
- silent install -ominaisuudet ja niiden riskit
- native addon- ja ASAR-yhteensopivuus
- GitHub Actions / Windows build -tuki
- lisenssi
- toimitusketju ja artifactien alkuperä

Mitään riippuvuutta ei asenneta tai lockfilea muuteta ilman projektin
omistajan erillistä hyväksyntää.

## 26. Ei ensimmäisessä toteutuksessa

- etäpäivitystä
- automaattista hiljaista päivitystä
- stable-kanavaa
- staged rolloutia
- delta-päivitystä
- background downloadia
- admin-hallintajärjestelmää
- business-datan poistoa uninstallissa
- reverse SQL -migraatiota
- usean profiilin samanaikaista päivitystä
- uutta installeririippuvuutta ennen hyväksyntäporttia

## Release gate -luokitus

### R0-pilottilaitteen suojaus

Oikeaa asiakas- tai laskutusdataa käyttävä paikallinen pilottilaite vaatii
ennen käyttöönottoa vähintään:

- tuetun ja tietoturvapäivityksillä ajan tasalla olevan Windows-version
- nimetyn, salasanalla suojatun Windows-käyttäjätilin ja automaattisen
  näytönlukituksen
- BitLockerin tai Windows Device Encryptionin aktiiviselle järjestelmälevylle
  ja muulle levylle, jolla Eky-profiili tai paikalliset lasku-PDF:t sijaitsevat
- rajatut Windows-tiedosto-oikeudet Eky `userData`- ja profiilijuurille
- ajantasaisen haittaohjelmasuojauksen ja palomuurin
- vahvistuksen, ettei local backend ole saavutettavissa loopbackin ulkopuolelta
- onnistuneen salatun siirrettävän backupin ja palautusharjoituksen erillisellä
  medialla

Aktiivinen SQLite-tietokanta ja current PDF:t ovat käytön aikana paikallista
business-dataa, eivät `.ekybackup`-containerin sisällä. Niiden at-rest-suoja
perustuu Windows-käyttäjärajaan, tiedosto-oikeuksiin ja koko levyn salaukseen.
Samaan Windows-käyttäjäkontekstiin päässyt haittaohjelma on jäännösriski, jota
backup-salaus tai Electron `safeStorage` ei poista.

Jos laite ei teknisesti tue levyjen salausta, oikean datan käyttöönotto
pysäytetään erilliseen omistajan dokumentoituun riski- ja laitepäätökseen.
Poikkeusta ei tulkita automaattiseksi hyväksynnäksi.

Yhden hallitun oikeaa dataa käyttävän koneen R0-portteja ovat:

- toimiva backup/restore ja palautuksen automaattinen todentaminen
- migraatioiden muuttumattomuus ja jatkuva migration chain
- pre-migration/pre-update-palautuspiste
- staging, health-check ja business-datan rollback
- paikallisen profiilin, salaisuuksien ja tiedostojen suojaus

Peruste on ensisijaisesti datan eheys ja turvallinen palautuminen.

Laajemman jakelun R1-portteja ovat viimeistään:

- varsinainen Windows-installer
- code signing ja publisher-identiteetti
- hallittu päivityskanava
- automaattinen päivityspolku
- binary rollback
- release- ja incident-prosessi

Peruste on ensisijaisesti distribution- ja supply chain -turvallisuus.
Code signing voidaan nostaa R0-portiksi, jos projektin omistaja päättää, ettei
allekirjoittamatonta artifactia käytetä edes yhdellä hallitulla
pilottilaitteella.

Tietosuoja-, kirjanpito- ja muu legal-vaatimus arvioidaan erikseen ennen
oikean datan käyttöönottoa. Tekninen backup tai allekirjoitus ei yksin todista
legal-vaatimusten täyttymistä.

## Toteutusjärjestys

1. hyväksy installeriteknologian dependency/security review
2. määritä versionoitu package manifest
3. toteuta read-only package inspector
4. todenna clean install ja upgrade synteettisellä profiililla
5. toteuta maintenance-lock ja pre-update recovery point
6. toteuta update journal ja first-start maintenance
7. toteuta Eky Update Coordinator paikalliselle tiedostolle
8. toteuta business- ja binary-rollback-yhteistyö
9. lisää rajattu UI
10. sulje Windows release gate packaged testeillä
11. arvioi code signing ja vasta myöhemmin etäpäivitys

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `apps/desktop/README.md`
- `docs/ai/review-checklist.md`
- `docs/ai/testing-rules.md`
- `docs/architecture/e2e-testing-strategy.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-desktop-dependency-review.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/release-versioning-policy.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/windows-installer-technology-review.md`
- `docs/architecture/windows-update-operational-runbook.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
