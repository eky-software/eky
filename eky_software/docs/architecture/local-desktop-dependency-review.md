# Local Desktop Dependency Review

Tämä dokumentti kirjaa `apps/desktop`-paketointispiken ensimmäisen rajatun
riippuvuuspäätöksen 14.7.2026, Electron 43 / better-sqlite3 13
-yhteensopivuuden varmennuksen 3.8.2026, Electron 43.3.0 -patch-päivityksen
17.8.2026 sekä transitiivisen XML-kirjaston tietoturvakorjauksen 2.9.2026.
Versiot tarkistetaan uudelleen ennen
tuotantojulkaisua, allekirjoitusta tai automaattipäivityksen toteutusta.

## Rajaus

Ensimmäisessä spikessä tarvitaan vain:

- Electron-runtimen Windows x64 -binääri
- sovellushakemiston paketointi Electron-artifactiksi
- `better-sqlite3`-native addonin paketoidun Windows x64 N-API-runtimen
  varmennus
- production-fusejen lukitseminen

Ensimmäisessä historiallisessa paketointispikessä ei lisätty installeria,
makeria, julkaisua, automaattipäivitystä, code signingia tai salaisuuksien
käsittelyä. Myöhemmin erikseen hyväksytty rajattu MSI-prototyyppi on kuvattu
alla ja Windows installer -suunnitelmassa.

ADR-0010 määrittelee myöhemmän Windows-asennuksen ja päivitysorkestroinnin
arkkitehtuurin. Se ei valitse installeria, makeria tai updater-riippuvuutta.
Teknologiavalinta vaatii edelleen tämän dokumentin periaatteiden mukaisen
uuden dependency- ja security-arvion.

## Valitut Riippuvuudet

Spikessä käytetään tarkasti lukittuja development-riippuvuuksia vain
`apps/desktop`-paketissa:

| Paketti | Versio | Vastuu |
| --- | --- | --- |
| `electron` | `43.3.0` | desktop-runtime ja Windows-binääri |
| `@electron/packager` | `20.0.4` | rajattu paketoitu sovellushakemisto |
| `@electron/fuses` | `2.1.3` | production-fusejen lukitseminen |

`@electron/packager`-työkalun `plist`-riippuvuus toi transitiivisesti
`@xmldom/xmldom`-version `0.9.10`. GitHub-advisory
`GHSA-6gmq-8vp8-gcm6` koskee versioita `0.9.0`-`0.9.11`, ja korjattu
yhteensopiva patch-versio on `0.9.12`. Projektin omistaja hyväksyi 2.9.2026
täsmäversioon lukitun workspace-overriden `0.9.12`:een. Override ei lisää
uutta suoraa riippuvuutta eikä muuta Eky-sovelluksen runtime-payloadia;
se rajaa nykyisen paketointityökaluketjun transitiivisen XML-kirjaston
korjattuun versioon. Override voidaan poistaa, kun hyväksytty upstream-ketju
ratkaisee saman tai uudemman tarkistetun version ilman sitä.

Rajattu installer-build käyttää lisäksi erikseen hyväksyttyjä build-työkaluja:

| Työkalu | Versio / pin | Vastuu |
| --- | --- | --- |
| `WixToolset.Sdk` | `7.0.0` | Per-user x64 MSI:n deterministinen muodostaminen |
| .NET SDK | `10.0.302` | WiX SDK -projektin lukittu build-runtime |
| `actions/setup-dotnet` | `v5.4.0` / `26b0ec14cb23fa6904739307f278c14f94c95bf1` | Hyväksytyn .NET SDK:n täyteen 40-merkkiseen SHA:han lukittu CI-bootstrap; floating tagia ei käytetä |

Projektin omistaja hyväksyi nämä työkalut 10.8.2026 vain rajattuun per-user
x64 MSI -prototyyppiin sekä hyväksyi WiX 7:n MS-RL- ja OSMF EULA -ehdot.
Omistaja vastaa mahdollisen ylläpitomaksun soveltuvuuden selvittämisestä.
Hyväksyntä ei kata WiX-extensioneita, custom actioneita, Burnia, uutta
runtime-riippuvuutta, code signingia tai allekirjoittamattoman prototyypin
jakelua oikeaan käyttöön.

Paketit eivät kuulu domainiin, application serviceihin, API-clientiin,
web-featureihin tai backendin liiketoimintamoduuleihin.

Electronin asennusskripti lataa version mukaisen binäärin. Siksi
`pnpm-workspace.yaml` sallii build/install-skriptin eksplisiittisesti vain
nimetylle `electron`-paketille. `better-sqlite3`-asennusskriptiä ei ajeta:
paketointi käyttää ja validoi version `13.0.2` mukana toimitetun Windows x64
N-API-binäärin.

### Electron 43 Ja `better-sqlite3`

Ensimmäinen spike käytti Electron `42.6.1`- ja `better-sqlite3 12.11.1`
-versioita. Tämä historiallinen yhdistelmä tarvitsi Electronin ABI:lle
rakennetun staged-binäärin.

Nykyinen varmennettu yhdistelmä on Electron `43.3.0` ja `better-sqlite3
13.0.2`. better-sqlite3 13 käyttää paketin mukana toimitettua N-API-binääriä,
joten paketointi ei enää:

- skannaa pnpm-virtuaalivarastoa native-paketin löytämiseksi
- aja `prebuild-install`-työkalua
- rakenna staged-kopiota Electronin ABI:lle.

Paketointiputki ratkaisee moduulin paketinhallinnan normaalilla
resoluutiolla, kopioi tuotantoriippuvuudet hallitusti ja validoi paketoidun
Windows x64 N-API-binäärin ennen artifactin hyväksymistä. Yhdistelmä on
varmennettu Electron-runtimessa, oikean paikallisen SQLite-tietokannan
turvallisella kopiolla, Windows-paketoinnilla, smoke- ja Electron-E2E-testeillä
sekä stressi- ja soak-ajoilla.

Ennen isälle jaettavaa tuotantoversiota pitää edelleen ajaa Windows package-
ja smoke-testit sekä riippuvuus- ja turvallisuusaudit aina valituille tarkasti
lukituille runtimeversioille.

Eky ei ylläpidä omaa `better-sqlite3`-C++-forkkia yhteensopivuusrajojen
kiertämiseksi.

## Miksi Ei Electron Forgea Tässä Spikessä

Electronin dokumentaatio suosittelee Forgea yleiseksi paketointi- ja
jakelutyökaluksi. Forge kokoaa paketoinnin lisäksi maker-, installer-, julkaisu-
ja muita jakeluvastuita. Tässä spikessä tarkoitus on ensin todentaa mahdollisimman
pienellä riippuvuuspinnalla:

- paketoitu React/Vite-renderer
- hallittu backend-prosessi
- SQLite ja migraatiot
- `better-sqlite3` Electronin N-API-runtimessa
- PDFKit
- turvallinen Electron-konfiguraatio ja fuses

Suora Packager/Fuses-yhdistelmä pitää tämän todentamisen rajattuna.
`better-sqlite3 13.0.2`:n mukana toimitettava Windows x64 N-API-binääri
kopioidaan production-riippuvuuksien mukana ja validoidaan ennen paketointia.
Erillistä native-rebuild- tai prebuild-install-riippuvuutta ei tarvita.
Forge tai muu installer-/update-työkalu arvioidaan uudelleen vasta, kun
paketoitu runtime on toimiva ja julkaisutapa, code signing sekä päivityskanava
on päätetty.

## Turvallisuus- Ja Toimitusketjurajat

- Versioissa ei käytetä `latest`- tai caret-alueita.
- Lockfile commitoidaan muutoksen mukana.
- Electron pidetään ajan tasalla ennen jokaista tuotantojulkaisua.
- Paketoitava backend rajataan `files`-allowlistalla build-tuotokseen.
- Kehityksen SQLite-tiedostot, `.env`-tiedostot, sample-PDF:t, testit ja
  storage-hakemistot eivät saa päätyä artifactiin.
- `better-sqlite3`-paketin mukana toimitettu N-API-binääri validoidaan sekä
  tavallisessa Node-kehitysajossa että paketoidussa Electron-runtimessa.
- Paketoidun artifactin sisältö tarkastetaan smoke-testissä ennen hyväksyntää.
- Production-fuset lukitaan vasta paketoituun binääriin.
- Artifact ei ole loppukäyttäjälle jaettava tuotantoversio ennen code signingia,
  release-putken jäljellä olevia tarkistuksia ja erillistä jakelupäätöstä.

### V2-Julkaisun Avoin Riippuvuustarkistus

Omistaja on hyväksynyt rajatun päivityksen Hono `4.13.5`:een sekä Vitest ja
sen nykyisen `@vitest/*`-pakettiperheen `4.1.11`:een. Molemmat suorat
riippuvuudet sidotaan manifestissa täsmäversioon; myös lockfile käyttää
näitä versioita. Lockfile-muutos sisältää vain Honon, Vitestin ja seitsemän
nykyisen `@vitest/*`-paketin päivitykset sekä niiden nykyiset peer-sidokset.
Uusia paketteja, overrideja tai muiden apupakettien versionostoja ei lisätä.
Nykyiset yksikkö-/integraatio- ja packaging-kohteet läpäisevät: 3754 testiä
sekä kahdeksan ennestään määriteltyä alustakohtaista ohitusta. System E2E
on 86/86, web critical 35/35 ja Electron critical 38/38. Workspace-typecheck
sekä backendin, webin ja desktopin buildit läpäisevät. Testien käyttäytymistä
tai aikarajoja ei muutettu päivityksen mukana.
Audit- ja signature-portit ovat vielä avoimia. Uusien artifactien normaali
CI-todennus on kuvattu alla; se ei korvaa riippuvuusturvan portteja.

[Normaali V2-kierros 34779534322](https://github.com/eky-software/eky/actions/runs/34779534322)
läpäisi ensimmäisellä yrityksellä ilman raskasta tallennusta. Testattu
lähde-HEAD, producerien ja consumerien checkout sekä uusien artifactien
build-revisio ovat `a186668cf6d5b6dc6e745b1e8448ed94e7ae8abc`.
Kierroksessa onnistui 38 jobia; seitsemän suunniteltua vanhan tai
diagnostisen polun ohitusta eivät korvanneet vaadittuja tuloksia.
Tiukka loppukoonti ja nykyinen kattavuuslukija hyväksyivät kaikki 36/36
vaadittua jobia pakollisine vaiheineen. Kaikki kuusi komentorajaryhmää
läpäisivät molemmat toistot.

| Paketoitu perhe | Tulos | Consumer-jobien CI-kestot |
| --- | --- | --- |
| Clean, repair/reinstall ja uninstall | 2/2 | 3 min 37 s / 3 min 39 s |
| Upgrade, downgrade-torjunta, rollbackit ja running application | 2/2 | 4 min 26 s / 3 min 52 s |
| Historical legacy | 2/2 | 3 min 11 s / 3 min 18 s |
| Workspace success | 2/2 | 4 min 31 s / 4 min 36 s |
| Workspace fault/rollback | 5 x 2 / 10 | 11 min 27 s / 13 min 24 s |

| Synteettinen CI-artifact | Artifact-ID | Descriptor SHA-256 |
| --- | --- | --- |
| Clean | `10325180215` | `4cc279af23c7bf6fc4150551636b396fb4ce51d872ab041cb65855fc3fc685e1` |
| Upgrade | `10324921362` | `638993ebead69656e3711536b2696ffc4d3b8b622a9d00a3e3a2df5bae1924b1` |
| Historical legacy | `10324682002` | `fbd34e41fbaa6202ded43c745babda948511a615ce43f1dadd1e45be311bc56c` |
| Workspace success/fault | `10324751603` | `7617e5113abfb34d166cbdb562d0bd224a548e63be3feb4065bcd60c492d7ae1` |

Kaikkien consumerien lopulliset artifact-varmennukset täsmäsivät omiin
producereihinsa. Komentojen pakolliset tulosverifierit läpäisivät todellisen
exitin jälkeen; semanttiset jälkiehdot, asennussiivous, normaali profiili ja
fixture-poistolupa pysyivät erillisinä vaatimuksina. Omistettujen puiden
poissaolo ja kaikkien 18 skenaariokomennon julkaisuvaiheen valmistuminen
vahvistettiin. Clean-producerin samojen MSI-tavujen bundle-varmennus
läpäisi; tarkistuskopiota ei julkaistu käyttäjän pilot-pakettina.

Tämä on riippuvuuspatchin uusi toiminnallinen CI-näyttö, ei aiempien
legacy-/runner-havaintojen juurisyykorjaus, koko V2:n käyttöönotto tai
0.2.8-julkaisulupa. Päähaaran ja required-checkien käyttöönotto sekä
julkaisun jäljellä olevat portit säilyvät erillisinä.

Advisory-katselmuksen historiallinen lähtörevisio on
`e5689b3d84b2b1586f5304edc32778c69ea03d50`. Sen lockfile ja päähaaran
`c1d010263ccf4dc490a709f58ea8a4a5b34fa03a` lockfile ovat samat.
Tuolloin GitHubin viisi avointa moderate-hälytystä koskivat seuraavia
lukittuja riippuvuuksia. Alla oleva advisory-/lähdekatselmus ei ole koko
päivitetyn riippuvuuspuun puhtaan auditin todiste.

| Riippuvuus | Aiempi lukittu versio | Hyväksytty korjausversio | Vastuu |
| --- | --- | --- | --- |
| `hono` | `4.13.1` | `4.13.5` | Backendin production HTTP-adapteri; kolme advisorya |
| `vitest` ja transitiivinen `@vitest/mocker` | `4.1.10` | `4.1.11` | Kehityksen testityökalu; sama advisory kahdella paketilla |

Viisi GitHub-hälytystä vastaa neljää eri GHSA-tunnusta:

| GHSA | Paketti ja lukittu -> korjausversio | Runtime/dev | Käytännön vaikutus nykyisessä lähdekoodissa |
| --- | --- | --- | --- |
| GHSA-crvj-82cr-hjcx | hono 4.13.1 -> 4.13.5 | runtime | Query-lukijoita käytetään; literal-fragmentin pääsy adapterin läpi on todistamatta. Tulkintaeroa ei merkitä vaikutuksettomaksi. |
| GHSA-gqvv-2mrq-wpjv | hono 4.13.1 -> 4.13.5 | runtime | SSG:n polkurajaus; toSSG-toimintoa ei käytetä tarkistetussa lähteessä. |
| GHSA-g6gw-c38x-mqfc | hono 4.13.1 -> 4.13.5 | runtime | Piste-erotellun parseBody-rakenteen muistinkäyttö; kyseistä parseria ei käytetä nykyisessä JSON-rajassa. |
| GHSA-82fw-gwwq-j7x9 | vitest ja @vitest/mocker 4.1.10 -> 4.1.11 | dev | Redirect-mockin tiedostoluku; tarkistetusta lähteestä ei löytynyt mockerPlugin-/interceptorPlugin-kytkentää. |

Honon korjaukset koskevat
[fragmentin jälkeistä query-tulkintaa](https://github.com/advisories/GHSA-crvj-82cr-hjcx),
[SSG-tulosteen polkurajausta](https://github.com/advisories/GHSA-gqvv-2mrq-wpjv)
ja [lomakkeen piste-erotellun rakenteen muistinkäyttöä](https://github.com/advisories/GHSA-g6gw-c38x-mqfc).
Backendin nykyinen lähdekoodi ei käytä `toSSG()`- tai `parseBody()`-toimintoja;
JSON-syöte luetaan `readJsonRequestBody`-vastuussa. Se käyttää kuitenkin
Honon query-lukijoita. Literal `#` -merkin kulkeutumista nykyisen HTTP-adapterin
läpi ei ole tässä katselmuksessa todistettu, joten query-löydöstä ei merkitä
vaikutuksettomaksi. Loopback- ja istuntorajat eivät korvaa korjattua riippuvuutta.

[Vitestin advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) koskee
redirect-mockin tiedostolukua dev-palvelimen kautta. Eky käyttää `vitest run`
-komentoja; tarkistetusta lähteestä ei löytynyt `mockerPlugin`- tai
`interceptorPlugin`-kytkentää. Tämä rajaa nykyistä käyttötapaa, mutta ei ole
peruste säilyttää korjattavissa olevaa versiota. Vitest ei kuulu paketoidun
backendin production-riippuvuuksiin.

Päähaaran [Dependency security -ajo 34745632370](https://github.com/eky-software/eky/actions/runs/34745632370)
epäonnistui `Audit production dependencies` -vaiheessa. Koko puun audit ja
rekisteriallekirjoitusten tarkistus jäivät ajamatta. Virheloki nimeää yllä
mainitut kolme Hono-advisorya. Tulos kuuluu yllä
nimetylle päähaaran revisiolle, ei V2:n uudelle kokonaishyväksynnälle.

Korjauksessa päivitetään vain nimetyt nykyiset paketit ja niiden välttämätön
lukittu ketju, ei Electronia, SQLitea, Nodea, pnpm:ää tai uusia testipalvelimia.
Honon muutos tulee paketoituun backendiin ja vaatii uudet artifact-tavut;
vanhan MSI-parin näyttö ei hyväksy sitä. Vitestin muutos varmennetaan
nykyisillä yksikkö-/integraatiotesteillä. Molemmat vaativat lockfile-diffin
katselmuksen, production- ja full auditin, rekisteriallekirjoitukset,
typecheckin/buildin sekä sovitut turvallisuus-, E2E- ja paketoidut portit.
Merkittävä uusi transitiivinen riippuvuus edellyttää erillistä päätöstä.
Löydöksiä ei dismissata eikä audit-porttia ohiteta. Nämä advisoryt eivät
osoita MSI- tai komentoprosessijumien syytä.

## Lisenssit Ja Ylläpito

- `electron`: MIT
- `@electron/fuses`: MIT
- `@electron/packager`: BSD-2-Clause

Electron sisältää Chromiumin ja Node.js:n turvallisuuspäivitysvastuun. Ekyllä
pitää myöhemmin olla dokumentoitu päivitysrytmi, tuettu versiopolitiikka ja
allekirjoitettu päivityskanava. Tätä velkaa ei ratkaista ensimmäisessä
paketointispikessä.

## Hyväksytty Päätös

Valitut kolme riippuvuutta hyväksytään vain local desktop -paketointispikeen.
Uusi desktop-riippuvuus, installer, maker, updater tai salaisuuksiin liittyvä
kirjasto vaatii uuden rajatun dependency- ja security-arvion.

Installer- ja update-vaihtoehtojen päätösmatriisi sekä testausportti on
kuvattu dokumentissa
`docs/architecture/windows-installer-and-update-plan.md`.

SMTP-salaisuuden local-MVP-tallennukseen ei lisätä uutta keyring- tai native-
riippuvuutta. Toteutus käyttää jo hyväksytyn Electron-runtimen sisäänrakennettua
`safeStorage`-rajapintaa vain main processissa, yksityistä `MessagePort`-brokeria
ja versionoitua salattua `userData`-blobia. Oma Win32-native-adapteri ja
kolmannen osapuolen keyring-kirjasto jätettiin pois, koska ne kasvattaisivat
native-binäärien, Electron ABI:n ja toimitusketjun ylläpitopintaa ilman
local-MVP:ssä tarvittavaa lisähyötyä.

## Liittyvät Dokumentit

- `AGENTS.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/local-desktop-implementation-plan.md`
- `docs/architecture/security-principles.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
