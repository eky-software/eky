# Windows installer acceptance harness V2

Tämä dokumentti määrittelee Eky-projektin Windows installer -hyväksyntätestien
ylläpidettävän tavoiterakenteen ja siirtymisen nykyisestä W6B-, W6B.2A- ja
W6B.2B-harnessista siihen.

Dokumentti ei muuta tuotantosovelluksen update-, workspace-, backup-, restore-,
tietokanta-, laskutus- tai Electron-runtime-semanticsia. Se ei myöskään anna
lupaa uudelle riippuvuudelle, GitHub Actionille, native-helperille,
versiomuutokselle tai release-artifactille.

Ajantasainen etenemispäätös ja tilataulukko ovat kohdassa
[Nykyinen päätös](#nykyinen-päätös). Historialliset checkpointit eivät korvaa
nykyisen revision hyväksyntää. Tämä on projektin suunnitelma, ei omistajan
koneen diagnostiikkapäiväkirja. Yksityinen aineisto kuuluu vain Gitistä
ohitettuihin paikallisiin paikkoihin; epäonnistuneita testituloksia ei kumota.

## Historiallinen lähtötilanne

Katselmus tehtiin 3.9.2026 seuraavasta puhtaasta checkpointista. Tämän luvun
SHA:t, testimäärät ja vanhojen prosessiketjujen kuvaus ovat historiallinen
lähtötilanne, eivät myöhempien V2-checkpointtien hyväksyntätodiste:

- `origin/main`: `c1d010263ccf4dc490a709f58ea8a4a5b34fa03a`
- PR #258:n head: `bc875f17b63c117d9966a087a0a72af8831ae93a`
- PR #258:n commitit:
  - `e85d39b test(installer): wait on native process signals`
  - `c5f793f test(installer): bound full legacy acceptance command`
  - `bc875f1 test(desktop): stabilize packaged MSI process ownership`

PR #258:ssa W6B.2A:n molemmat ajot, W6B.2B:n kaikki kymmenen ajoa,
Windows MSI -portti, Electron critical ja muut portit olivat vihreitä.
Windows W6B legacy acceptance ei saavuttanut terminal-tilaa. Kahden tunnetun
ajon viimeiset turvalliset vaiheet olivat:

- `cleanup/postconditionsStarted`
- `cleanup/targetUninstallStarted`

PR #258 jää muuttumattomaksi historialliseksi checkpointiksi. V2-työtä ei
lisätä siihen eikä PR #257:n 0.2.8-versionostoa mergeä ennen uuden harnessin
erillistä hyväksyntää.

## Koko testikannan katselmus

Nykyisessä lähdepuussa on 659 varsinaista `*.test.*`- tai `*.spec.*`-tiedostoa
ja noin 129 200 testiriviä. Generoituja `dist`, `e2e-dist`, `.stage`, `out`,
installer-artifacti-, Playwright result- tai `.eky-local`-tiedostoja ei ole
laskettu mukaan.

| Alue | Testitiedostoja | Testirivejä |
| --- | ---: | ---: |
| `apps/backend` | 189 | 41 976 |
| `apps/desktop` | 274 | 54 284 |
| `apps/e2e` | 39 | 12 306 |
| `apps/web` | 143 | 16 088 |
| `packages/api-client` | 11 | 4 362 |
| `packages/auth` | 1 | 109 |
| `packages/permissions` | 2 | 75 |

Katselmuksen perusteella testimäärä ei yksin ole ongelma. Backendin, webin,
desktopin ja API-clientin yksikkö- ja integraatiotestit sijaitsevat pääosin
testattavan vastuun vieressä, käyttävät Vitestiä johdonmukaisesti ja suojaavat
oikeita business-, tenant-, security-, rollback- ja validointi-invariantteja.
Niitä ei poisteta tai yhdistetä rivimäärän pienentämiseksi.

`apps/e2e` on erillinen cross-layer-testipaketti. Sen Playwright-konfiguraatio
ajaa testit yhdellä workerilla, estää `only`-merkinnät CI:ssä ja käsittelee
retryllä onnistuneen testin flakyna eikä vihreänä. Tavallisissa E2E-poluissa
ei löytynyt `page.waitForTimeout`-odotuksia. Backendin ja Electronin readiness
on pääosin sidottu healthiin, portin vapautumiseen, ikkunatapahtumaan tai
prosessin terminal-tilaan. Siksi nykyinen akuutti epävakaus ei oikeuta koko
E2E-runtimen uudelleenkirjoittamista.

Suurin rakenteellinen keskittymä on `apps/desktop/installer/scripts`:

- 121 lähde- ja testitiedostoa
- noin 27 642 riviä
- 57 installer-testitiedostoa ja noin 12 372 testiriviä
- useita peräkkäin lisättyjä prosessi-, timeout-, cleanup- ja
  observability-kerroksia
- samankaltainen success- ja fault-lifecycle kahdessa eri Node-moduulissa
- sama W6B.2 fixturepari rakennetaan nykyisessä CI-matriisissa 12 kertaa

Pitkä testitiedosto ei vielä todista väärää vastuuta. Se on pilkkomiskohde
vasta, kun tiedostosta voidaan nimetä vähintään kaksi itsenäistä sopimusta.
Ensimmäinen prioriteetti on prosessiomistajuus ja buildin toisto, ei business-
assertioiden poistaminen.

## Generoidut hakemistot

Seuraavat hakemistot ovat tarkoituksellisia build- tai testituloksia, eivät
TypeScript-lähdekoodin rinnakkaisia toteutuksia:

- `apps/backend/dist`
- `apps/backend/e2e-dist`
- `apps/desktop/dist`
- `apps/desktop/e2e-dist`
- `apps/desktop/e2e-backend-stage`
- `apps/desktop/.stage`
- `apps/desktop/out`
- `apps/desktop/installer/artifacts`
- `apps/e2e/test-results`
- `apps/e2e/playwright-report`
- `.eky-local`

Kaikki yllä luetellut polut ovat Gitistä ohitettuja eikä niistä löytynyt
versionoituja tiedostoja katselmushetkellä. `src` on kanoninen TypeScript-
lähde. `dist` ja `e2e-dist` ovat käännettyjä JavaScript-artifacteja, joita
Node, Electron tai Playwright tarvitsee ajamiseen. Ne saa poistaa vain
paikallisena cleanupina, ja oikean build-komennon pitää pystyä luomaan ne
uudelleen. `local-pilot-releases` on erillinen paikallinen release-arkisto,
eikä yleinen testicleanup saa poistaa sitä.

## Nykyinen prosessiketju

### W6B legacy

Nykyinen ketju on:

```text
GitHub Actions job (30 min)
  -> pnpm
    -> runW6bLegacyUpgradeCommand.mjs (25 min command deadline)
      -> Node worker
        -> target fixture build
        -> w6bLegacyAcceptanceProcess.mjs (18 min acceptance deadline)
          -> testW6bLegacyUpgradeAcceptance.ps1
            -> windowsInstallerMsiExecHost.ps1
              -> msiexec
            -> historical Eky / relaunched Eky
              -> backend utility
            -> target Eky
              -> backend utility
```

Prosessipuun tai sen osan cleanupia omistavat tällä hetkellä:

- GitHub runner jobin peruutuksessa
- command wrapper proof-tokenilla
- acceptance wrapper toisella proof-tokenilla
- PowerShell-skenaarion `finally`
- MSI host yksittäisen MSI-operaation timeoutissa
- historiallinen packaged-smoke oman relaunched-prosessiketjunsa osalta

Command- ja acceptance-wrapper käyttävät samaa prosessivalvontamoduulia eri
`processKind`-arvolla. Tämä on päällekkäinen vastuu, ei kaksi toisistaan
riippumatonta hyväksyntätestiä.

### W6B.2A ja W6B.2B

Nykyinen ketju on:

```text
GitHub Actions job (30 min)
  -> pnpm
    -> runW6b2PackagedCommand.mjs (command deadline)
      -> w6b2PackagedCommandWorker.mjs
        -> desktop E2E build
        -> installer pair build and verification
        -> success/fault command lifecycle budget
        -> w6b2PackagedScenarioProcess.mjs (12 min scenario deadline)
          -> testW6b2PackagedSuccess.ps1 tai
             testW6b2PackagedFaultRollback.ps1
            -> MSI host
              -> msiexec
            -> source/target Eky
              -> backend utility
```

Cleanupia tai aikaa omistavat command wrapper, success/fault command
lifecycle, scenario wrapper, PowerShell-skenaario, MSI host ja useat
application-process helperit. Success- ja fault-command-lifecyclejen rakenne
on lähes sama, mutta vaihelistat ja context eroavat.

## Tiedostotason vastuuinventaario

Alla oleva inventaario nimeää nykyisen ajopolun tuotannolliset
testiharness-tiedostot. Niiden vieressä olevat `*.test.mjs`- ja
`*.test.ps1`-tiedostot todistavat nykyisiä sopimuksia, eikä niitä poisteta
ennen vastaavan V2-vastuun regressiotestiä.

### Legacy-orkestrointi

| Tiedosto | Nykyinen vastuu | Päällekkäisyys tai riski |
| --- | --- | --- |
| `runW6bLegacyUpgradeCommand.mjs` | Käynnistää koko legacy-komennon workerina ja antaa sille 25 minuutin rajan sekä proof-tokenin | Ulompi supervisor omistaa saman ketjun, jonka sisällä on toinen supervisor |
| `runW6bLegacyUpgradeAcceptance.mjs` | Valitsee exact-local- tai historical-source-fixturen, rakentaa targetin ja käynnistää PowerShell-acceptancen | Build ja skenaario kuuluvat samaan rajattuun prosessiketjuun |
| `w6bLegacyAcceptanceProcess.mjs` | Palvelee sekä command- että acceptance-prosessin spawn-, timeout-, heartbeat-, proof-token-, cleanup- ja terminal-evidence-vastuuna | Sama toteutus muodostaa kaksi sisäkkäistä timeout- ja cleanup-omistajaa; peritty stdio sitoo terminalisointia konsolivirtoihin |
| `stopW6bLegacyAcceptanceProcess.ps1` | Vahvistaa proof-tokenilla merkityn juuren ja pysäyttää sille kuuluvan Windows-prosessipuun | Vanhemman jo poistuttua PID-juuri ei yksin todista kaikkien jälkeläisten poissaoloa |
| `testW6bLegacyUpgradeAcceptance.ps1` | Omistaa varsinaisen source-install/startup-, business-fixture-, target-install/startup- ja cleanup-skenaarion sekä normaalin profiilin read-only-inventaarion | Samassa pitkäikäisessä PowerShell-prosessissa ovat scenario, Windows Installer COM, postconditionit ja `finally`-cleanup |
| `w6bLegacy/installerLifecycle.ps1` | Asennus-, ProductState-, MSI- ja prosessielinkaaren legacy-aputoiminnot | COM-, CIM- ja prosessiodotukset voivat estää ylemmän progress-vaiheen valmistumisen |
| `w6bLegacy/historicalPackagedSmokeProcessChain.ps1` | Omistaa historiallisen initial- ja relaunch-prosessin ketjun, resultin odotuksen ja tarkan cleanupin | Oikea erityisvastuu, joka siirretään V2-workerin alle mutta ei yhdistetä yleiseen PID-arvaukseen |
| `w6bLegacy/gracefulApplicationShutdown.ps1` | Pyytää omistetun historiallisen sovelluksen hallittua sulkeutumista | Graceful shutdown säilyy workerin pyyntönä, ei uutena emergency-cleanup-omistajana |
| `w6bLegacy/evidence.ps1` ja `w6bLegacy/progress.ps1` | Validoivat business-, tiedosto- ja allowlistatun JSONL-evidencen | Evidence on nyt osin sidottu samaan prosessiin, joka tekee mahdollisesti estävät OS-kutsut |

### W6B.2-orkestrointi

| Tiedosto | Nykyinen vastuu | Päällekkäisyys tai riski |
| --- | --- | --- |
| `runW6b2PackagedCommand.mjs` | Käynnistää success- tai fault-workerin; omistaa command-deadlinen, heartbeatin, proof-tokenin ja cleanup-helperin | Omistaa koko puun ajan ja cleanupin scenario-supervisorin lisäksi |
| `w6b2PackagedCommandWorker.mjs` | Ajaa desktopin E2E-buildin ja valitun success/fault-komennon | Build on workerin sisällä ja toistuu jokaisessa CI-matriisijobissa |
| `runW6b2PackagedSuccess.mjs` | Rakentaa ja tarkistaa installeriparin, luo kaksi fixtureä, ajaa skenaariot, tarkistaa ja poistaa fixturet | Build, scenario, verifier ja fixture-cleanup kuuluvat samaan command-lifecycleen |
| `runW6b2PackagedFaultRollback.mjs` | Rakentaa saman installeriparin ja ajaa valitut fault/run-yhdistelmät | Toistaa success-polun orkestroinnin ja rakentaa saman parin jokaisessa matriisijobissa |
| `w6b2PackagedSuccessCommandLifecycle.mjs` | Laskee success-komennon deadlinea, reserveä, vaihe-evidenceä ja fixture-cleanup-vaihetta | Lähes sama vastuu kuin fault-lifecyclessä ja ulommassa command-supervisorissa |
| `w6b2PackagedFaultCommandLifecycle.mjs` | Laskee fault-komennon deadlinea ja vaihe-evidenceä run/scenario-contextilla | Rinnakkainen success-toteutus; budjetti tarkistetaan vaiheiden ympärillä mutta se ei keskeytä estävää operaatiota |
| `w6b2PackagedScenarioProcess.mjs` | Käynnistää yhden PowerShell-skenaarion; omistaa 12 minuutin timeoutin ja toisen proof-token-cleanupin | Sisäkkäinen process-tree-supervisor ulomman command-supervisorin alla |
| `stopW6b2PackagedCommandProcess.ps1` ja `stopW6b2PackagedScenarioProcess.ps1` | Pysäyttävät eri proof-tokenilla merkityt command- ja scenario-puut | Kaksi cleanup-politiikkaa voi kohdistua saman tosiasiallisen jälkeläisketjun eri juuriin |
| `testW6b2PackagedSuccess.ps1` | Todistaa A/B/C-workspacet, N -> N+1 -päivityksen, restartit, rejectionin ja cleanupin | Prosessiajo, business-verifiointi ja cleanup ovat samassa PowerShell-elinkaaressa |
| `testW6b2PackagedFaultRollback.ps1` | Ajaa acceptance-, pre-switch-, post-switch-, first-start- ja post-acceptance-faultit sekä rollbackin | Jakaa osan success-primitiveistä mutta lisää oman scenario- ja cleanup-kerroksen |
| `w6b2Success/applicationProcess.ps1` | Käynnistää Eky-prosessin, odottaa proof/result-vaiheita, seuraa jälkeläisiä ja sulkee omistetun sovelluksen | 837-rivinen keskeinen prosessivastuu; V2:ssa prosessin omistus ja resultin verifiointi erotetaan |
| `w6b2Success/installerLifecycle.ps1` | Suorittaa source/target install- ja uninstall-operaatiot sekä niiden progressin | Käyttää jaettua MSI hostia, jolla on vielä oma timeout ja cleanup |
| `w6b2Success/evidence.ps1` ja `w6b2Success/progress.ps1` | Tarkistavat success-business-evidencen ja turvallisen vaiheprotokollan | Säilytettävät invariantit, mutta lukeminen siirtyy erilliseen verifieriin |
| `w6b2Fault/applicationProcess.ps1`, `evidence.ps1`, `progress.ps1`, `rollbackProgress.ps1` ja `scenarioOperations.ps1` | Rakentavat fault-injektion, rollback-evidencen ja fault-kohtaiset operaatiot success-primitivejen päälle | Oikea scenario-kohtainen jako; ei saa muodostua toiseksi yleiseksi prosessimoottoriksi |
| `w6b2PackagedSuccessRunFixture.mjs` ja `w6b2PackagedFaultRunFixture.mjs` | Luovat, tarkistavat ja poistavat private proof -fixturet | Luonti, read-only-verifiointi ja poisto kutsutaan nyt saman command-lifecyclen sisältä |

### Jaetut Windows-vastuut

| Tiedosto | Nykyinen vastuu | V2-kohde |
| --- | --- | --- |
| `buildW6b2PackagedSuccessInstallers.mjs` | Rakentaa ja validoi synteettisen 0.2.7 -> 0.2.8 -installeriparin | Yksi build-once producer, joka tuottaa immutable descriptorin |
| `buildWindowsInstaller.mjs` | Käynnistää desktop-package- ja WiX-buildit sekä palauttaa installer-metadatan | Build-prosessien kahvat ja terminal-tulos kuuluvat build-vastuulle, eivät scenario-workerille |
| `windowsInstallerMsiExecHost.ps1` | Käynnistää yhden `msiexec`-prosessin, odottaa native-signaalia ja tekee 10 sekunnin timeout-cleanupin | Rajattu MSI-adapteri yhden supervisorin alla |
| `windowsInstallerNativeProcessWait.ps1` | Käyttää `WaitForSingleObject`-odotusta prosessikahvalle | Säilyy rajattuna native wait -primitivenä |
| `windowsInstallerMsiProcessObservation.ps1` | Tuottaa MSI-hostin allowlistatun wait/heartbeat/exit-evidencen | Diagnostiikka säilyy, mutta ei omista prosessipuuta |
| `windowsInstallerProcessTree.ps1` | Ottaa CIM-snapshotit, vahvistaa identiteettejä, ajaa `taskkill /T /F`:n ja odottaa puun poistumista | Korvataan supervisorin yhdellä omistusmallilla; read-only postcondition-snapshot jää erilliseksi adapteriksi |
| `windowsInstallerTestSupport.ps1` | Keskittää MSI-operaatiopolitiikat, hostin odotuksen, heartbeatin, cleanupin, hakemistopoiston ja Windows Installer -kyselyt | Pilkotaan nimettyihin MSI execution-, filesystem cleanup- ja registration query -adaptereihin |
| `windowsInstallerUpgradeAttempt.ps1` | Orkestroi rajatun upgrade-yrityksen ja prosessipuun tuloksen | Muuttuu yhdeksi scenario-workerin operaatioksi, ei omaksi yleiseksi supervisoriksi |
| `inspectWindowsInstaller.ps1` | Lukee MSI:n ja Windows Installerin turvallisia ominaisuuksia release-varmennukseen | Pidetään read-only-verifier-adapterina |

Inventaario osoittaa myös, mitä ei poisteta: MSI-identiteetin tarkistus,
historical relaunch -ketju, fault-skenaarioiden semantiikka, safe evidence,
business-fixturet ja read-only postconditionit ovat tarpeellisia. Poistuva osa
on niiden ympärille kertynyt rinnakkainen orkestrointi, kun korvaava V2-polku
todistaa samat invariantit.

## Nykyiset timeout- ja heartbeat-rajat

Alla oleva taulukko kuvaa olennaiset ulommat rajat. Sisäisiä readiness-,
shutdown-, tiedosto- ja MSI-rajoja on lisäksi useita.

| Omistaja | Nykyinen raja | Kohde |
| --- | ---: | --- |
| GitHub W6B legacy | 30 min | koko jobi setup-vaiheineen |
| Legacy command wrapper | 25 min | build + acceptance worker |
| Legacy acceptance wrapper | 18 min | PowerShell-skenaario |
| Legacy wrapper heartbeat | 60 s | odotuksen elossaolo |
| GitHub W6B.2 run | 30 min | koko jobi setup-vaiheineen |
| W6B.2 selected command | 25 min | E2E build + pair build + yksi skenaario |
| W6B.2 full success | 38 min | paikallinen kahden ajon komento |
| W6B.2 full fault | 135 min | paikallinen kymmenen ajon komento |
| W6B.2 scenario wrapper | 12 min | yksi PowerShell-skenaario |
| Command/scenario cleanup | 30 s | proof-tokenilla rajattu cleanup-helper |
| MSI-operaatio | tavallisesti 300 s | yksi install/uninstall/upgrade |
| MSI host cleanup | 10 s | yksittäisen MSI-prosessipuun pysäytys |
| Eky readiness/handoff | tavallisesti 30-180 s | nimetty result/readiness-ehto |

Ongelma ei ole yksittäisen luvun pienuus. Eri deadlinet laskevat eri
alkuhetkistä, osa vain tarkistaa jäljellä olevan budjetin ennen ja jälkeen
operaation, ja usea kerros yrittää siivota saman jälkeläispuun. Yhden luvun
kasvattaminen siirtää ulkoisen aikakatkaisun myöhemmäksi ratkaisematta
omistajuutta.

## Estävät alustarajat

Seuraavat rajat voivat viivästää tai estää ylemmän kerroksen terminal-
tuloksen:

- Windows Installer COM `ProductState` pitkään elävän COM-olion kautta
- `Get-CimInstance Win32_Process` ja prosessipuun snapshotit
- `Process.Refresh`, `HasExited` ja `WaitForExit`
- `taskkill /T /F`
- `msiexec` ja sitä odottava MSI host
- Electronin itse tekemä relaunch
- recursive inventory, hash, copy ja remove
- pnpm-, Electron-, backend- ja WiX-buildien lapsiprosessit
- parentilta perityt stdout/stderr-kahvat

Legacy-skenaariossa yksi PowerShell-prosessi pitää Windows Installer COM-
olion elossa preflightista cleanupiin. Cleanupin
`targetUninstallStarted`-vaihe tekee ensin COM `ProductState` -kyselyn ja
vasta sen jälkeen käynnistää rajatun uninstallin. `postconditionsStarted`
sisältää useita eri toimintoja: install-rootin ja shortcutin poiston,
prosessittomuuden, installer-rekisteröinnin sekä normaalin profiilin
rekursiivisen hash-inventaarion. Viimeinen lokirivi ei siten yksilöi estävää
alustakutsua.

Node-dokumentaation mukaan child-prosessin `exit` voi tulla ennen sen stdio-
virtojen sulkeutumista, kun taas `close` tulee vasta prosessin päättymisen ja
stdio-virtojen sulkeutumisen jälkeen. Nykyinen harness käyttää sekä perittyä
stdioa että eri kohdissa `exit`-pohjaista odotusta. V2:ssa kontrollisignaali
ei saa riippua konsolivirran sulkeutumisesta.

## Evidence ja result-artifactit

Nykyisiä turvallisia todisteita ovat muun muassa:

- konsoliin kirjoitettu allowlistattu JSONL progress
- `desktop-smoke-result.json`
- `w6b2-proof-result.json`
- `w6b2-profile-result.json`
- `w6b2-rollback-installer-progress.jsonl`
- installer manifestit, SHA-256-tiivisteet ja inventoryt

Nämä todistavat hyödyllisiä invariantteja, mutta prosessin terminal-tulos ja
business-postconditionit ovat nyt osittain samoissa PowerShell-prosesseissa.
Jos prosessi jää alustakutsuun, ylempi wrapper näkee viimeisen progress-rivin
mutta ei tiedä, mikä alikutsu jäi kesken.

V2:ssa stdout/stderr on diagnostiikkaa, ei prosessiohjauksen protokolla.
Worker kirjoittaa yhden versionoidun result-artifactin atomisesti. Supervisor
vahvistaa vain prosessin, deadlinen, result-artifactin perusmuodon ja
prosessipuun poistumisen. Erillinen verifier lukee business-todisteet vasta
sen jälkeen.

## Todetut vahvuudet

V2 säilyttää seuraavat nykyisen ratkaisun vahvuudet:

- synteettinen ja ajokohtainen testiprofiili
- normaalin `%APPDATA%\Eky`-profiilin read-only inventaario
- build- ja release-identiteetin fail-closed-validointi
- source- ja target-MSI:n SHA-256-todiste
- exact ProductCode- ja UpgradeCode-sopimus
- workspace A/B/C:n business-, SQLite-, PDF-, secret- ja lineage-eristys
- historical 0.2.6 -> target -yhteensopivuustodiste
- first start, second start, downgrade ja rollback
- restore/relaunch-prosessiketjun omistajuustodiste
- vieraan, duplikaatin tai tunnistamattoman prosessin torjunta
- cleanupin ja postconditionin epäonnistumisen säilyminen virheenä
- turvallinen, allowlistattu observability ilman polkuja, PID-arvoja,
  komentorivejä, salaisuuksia tai business-dataa

V2 ei muuta näitä ehtoja vihreäksi löysentämällä assertioita.

## Juurisyy

Katselmuksen johtopäätös on, että ongelma ei ole testien tiukkuus eikä se,
että paikallinen ja GitHub-testi todistavat saman asian turhaan. GitHubin
Windows-ympäristö on paljastanut oikeita polku-, prosessi- ja paketointieroja,
joita paikallinen kone ei yksin todista.

Rakenteellinen juurisyy on vastuun kerrostuminen:

1. Uusi ulompi timeout tai cleanup on lisätty, kun alempi kerros ei ole
   terminalisoitunut.
2. Vanha omistaja on jäänyt rinnalle varmistukseksi.
3. Sama prosessipuu näkyy usean proof-tokenin, parent PID -ketjun ja
   PowerShell-cleanupin kautta.
4. Build, prosessiajo, business-verifiointi ja fixture-cleanup ovat osittain
   saman elinkaaren sisällä.
5. CI rakentaa saman kalliin fixtureparin jokaisessa matriisijobissa.
6. GitHubin job-timeout katkaisee lopulta kerroksen, joka ei itse tuottanut
   terminal-tulosta.

Viimeisten installer-harness-commitien historia vahvistaa tämän: korjaukset
ovat lisänneet vuorotellen native wait-, observer-, command watchdog-,
scenario cleanup- ja process ownership -vastuita. Yksittäiset korjaukset ovat
olleet perusteltuja, mutta kokonaisuus tarvitsee nyt yhden omistajuusmallin.

## V2-tavoiterakenne

V2:n pysyvä ketju on:

```text
buildWindowsAcceptanceArtifacts
  -> verifyWindowsAcceptanceArtifact
  -> immutable fixture artifact
  -> windowsAcceptanceSupervisor
       -> runWindowsAcceptanceScenario worker
       -> exact owned process-tree cleanup
  -> verifyWindowsAcceptancePostconditions
  -> terminal result and evidence
  -> cleanupWindowsAcceptanceFixture
```

### Build-vastuu

`buildWindowsAcceptanceArtifacts`:

- rakentaa source/target-parin yhden kerran puhtaalta HEADilta
- ei asenna MSI:tä eikä käynnistä Ekyä
- tuottaa versionoidun manifestin, inventoryn, koot ja SHA-256-tiivisteet
- ei muuta canonical `package.json`- tai release-tiedostoja
- ei hardlinkkaa release- tai payload-artifactia fixtureen

`verifyWindowsAcceptanceArtifact`:

- tarkistaa sallitut tiedostot, manifestin, release-identiteetin ja hashit
- torjuu symlinkin, hardlinkin, tuntemattoman kentän ja polun ulosjuoksun
- on read-only eikä käynnistä prosesseja

### Scenario worker

`runWindowsAcceptanceScenario`:

- saa vain validoidun immutable fixture -descriptorin ja yhden scenario-id:n
- ei rakenna tai lataa paketteja
- ei omista koko prosessipuun cleanupia
- ei käytä stdoutia tai stderria kontrollisignaalina
- kirjoittaa atomisesti versionoidun terminal result -artifactin
- poistuu yhdellä yksiselitteisellä exit-koodilla
- käyttää vain synteettistä, ajokohtaista profiilia

### Supervisor

`windowsAcceptanceSupervisor`:

- käynnistää täsmälleen yhden scenario workerin
- omistaa workerin koko jälkeläispuun
- omistaa yhden absoluuttisen deadlinen ja yhden cleanup-polun
- terminalisoi puun deadline-, cancellation- ja worker failure -tilassa
- todistaa `processTreeAbsent` ennen verifieriä
- ei tarkista business-, SQLite-, PDF-, workspace- tai registry-
  postconditioneja
- ei tapa koneen muita Eky-, Node-, PowerShell- tai MSI-prosesseja

Jokaisella supervisorin omistamalla prosessipuulla saa olla vain yksi timeout-
ja cleanup-omistaja. Worker voi pyytää sovellukselta graceful shutdownia,
mutta se ei saa omistaa supervisorin emergency cleanupia.

### Postcondition verifier

`verifyWindowsAcceptancePostconditions`:

- käynnistyy vasta onnistuneen `processTreeAbsent`-todisteen jälkeen
- ei käynnistä, odota tai tapa prosesseja
- tarkistaa MSI- ja ARP-tilan, shortcutin, install-rootin, registry/workspace-
  tilan, accepted-buildin, journaleiden terminal-tilan sekä DB/PDF-hashit
- lukee normaalista profiilista vain hyväksytyn read-only-inventaarion
- antaa jokaiselle mahdollisesti estävälle OS-kyselylle oman rajatun adapterin
  ja turvallisen started/completed/failed/timedOut-evidencen

Verifierin COM-, CIM-, registry- ja recursive filesystem -adapterit ajetaan
erillisessä rajatussa prosessissa, jotta yksittäinen natiivikutsu ei voi estää
supervisorin terminal-tilaa.

### Fixture cleanup

`cleanupWindowsAcceptanceFixture`:

- poistaa vain descriptorin nimeämän ajokohtaisen testijuuren
- ei poista lähdeartifactia, paikallista pilot-arkistoa tai normaalia profiilia
- ajetaan vasta prosessipuun ja postcondition-verifierin jälkeen
- on idempotentti mutta persistentti cleanup-virhe säilyy virheenä

### Evidence writer

`writeWindowsAcceptanceEvidence` hyväksyy vain versionoidun allowlistin:

- `schemaVersion`
- `scenario`
- `phase`
- `status`
- `resultCode` tai `errorCode`
- `durationMs`
- `elapsedMs`

Polut, PID:t, command linet, MSI-nimet, tokenit, stdout/stderr, raw error,
stack, companyId, workspaceId, lineage, session, journal-sisältö ja business-
data eivät kuulu konsoli-evidenceen.

## OS-adapterit

V2:ssa rajataan vain aidosti mahdollisesti estävät alustarajat. Jokaisesta
pienestä tiedostoluvusta ei rakenneta omaa prosessia.

Erillisen rajatun adapterin tarvitsevat vähintään:

- MSI install, repair, upgrade ja uninstall
- Windows Installer ProductState / registration
- CIM-prosessisnapshot ja omistajuuden vahvistus
- recursive inventory ja hash suurille juurille
- recursive remove, kun Windows-handle voi estää sen
- historical Electron relaunch -ketju

Tavallinen yhden pienen JSON-resultin validointi tehdään samassa verifierissä.

## CI-kadenssi

Nykyinen `ci.yml` laajenee yhdellä pull requestilla kahteenkymmeneen jobiin,
joista kahdeksantoista tekee oman checkoutin ja dependency installin.
W6B.2A tekee kaksi Windows-ajoa ja W6B.2B kymmenen Windows-ajoa. Jokainen
niistä valmistelee Electron-runtimen, palauttaa WiX-toolchainin ja rakentaa
saman source/target-fixtureparin uudelleen.

Tavoitekadenssi on:

### Nopea PR-portti

- unit- ja integraatiotestit
- typecheck ja build
- system security
- web critical
- muuttuneen moduulin omat testit

### Installer-riskin PR-portti

- Windows process contracts
- package + packaged smoke
- yksi success-upgrade
- vain muutokseen liittyvät fault-skenaariot
- legacy vain, jos installer-, update-, restore-, migration- tai workspace-
  yhteensopivuus muuttuu

### Täysi release-portti

- legacy
- W6B.2A 2/2
- W6B.2B 10/10
- MSI lifecycle
- upgrade, downgrade ja rollback
- Electron critical

Täysi portti ajetaan `main`-haarassa, yöajona, `workflow_dispatch`-ajona ja
ennen releasea. Tavallinen customer-, invoice-, work order-, UI- tai CSS-
muutos ei käynnistä koko Windows installer -laboratoriota.

CI:hin tarvitaan aina ajettava, vakaan niminen aggregaattori. Se ilmoittaa
required checkin terminal-tuloksen myös silloin, kun riskiperusteinen raskas
jobi on tarkoituksella ohitettu. Change classifierin pitää olla repositoryn
oma, pieni ja testattu sopimus eikä kolmannen osapuolen uusi riippuvuus.

## Päätösportit

Seuraavat toteutukset vaativat projektin omistajan erillisen hyväksynnän ennen
V2-koodia.

### A. GitHub artifact -toiminnot

Yksi build-jobi voisi jakaa immutable fixtureparin scenario-jobeille
SHA-lukituilla `actions/upload-artifact`- ja `actions/download-artifact`-
toiminnoilla. Jokaisen consumerin pitää tarkistaa oma SHA-256-manifesti eikä
artifactia saa tulkita allekirjoitetuksi releaseksi.

Hyöty:

- source/target-paketointi tehdään kerran eikä 12 kertaa
- skenaariot käyttävät samoja tavuja
- Windows-minuutit ja queue-kuorma pienenevät olennaisesti

Riski:

- kaksi uutta GitHub Action -toimitusketjuriippuvuutta
- retention-, nimi-, digest- ja producer/consumer-oikeudet pitää lukita
- artifact ei saa sisältää profiilia, salaisuutta, logia tai business-dataa

### B. Windows Job Object -feasibility

Pieni repositoryn omistama testiapu voitaisiin rakentaa nykyisellä lukitulla
.NET SDK 10.0.302:lla ilman npm- tai runtime-riippuvuutta. Sen tehtävä olisi
luoda Job Object, liittää worker siihen, käyttää kill-on-close-sopimusta ja
raportoida vain turvallinen terminal-tulos.

Ennen toteutusta pitää todistaa:

- GitHub `windows-latest` sallii nested Job Object -käytön
- childit perivät jobin odotetusti
- Windows Installerin service-side-prosessit eivät kuulu automaattisesti
  samaan jobiin, joten niiden tila varmennetaan erillisillä MSI-
  postconditioneilla
- helper ei tarvitse admin-oikeutta, globaalia asennusta tai uutta pakettia
- kill-on-close ei voi kohdistua testin ulkopuoliseen prosessiin

Jos feasibility epäonnistuu, uutta PID/CIM/taskkill-wrapper-pinoa ei lisätä.
Silloin supervisor rakennetaan yhdeksi pitkäikäiseksi Node-prosessiksi, joka
käynnistää ja omistaa yhden suoran lapsen kerrallaan, ja kaikki estävät OS-
rajat eristetään rajattuihin child-adaptereihin.

## V2.1 hyväksytty feasibility-checkpoint

Projektin omistaja hyväksyi 3.9.2026 kaksi rajattua päätösporttia:

1. repositoryn omistaman Windows Job Object -supervisorin feasibilityn
   lukitulla .NET SDK 10.0.302:lla ilman uutta PackageReference-, NuGet-, npm-
   tai runtime-riippuvuutta
2. myöhempää immutable fixture -jakamista varten vain viralliset, täsmälliseen
   commit-SHA:han lukitut `actions/upload-artifact`- ja
   `actions/download-artifact`-toiminnot

Hyväksyntä ei kata muuta Actionia, riippuvuutta, tuotantosovelluksen muutosta,
versiota, pilot-pakettia eikä nykyisen harnessin korvaamista tässä
checkpointissa.

### Supervisorin prosessisopimus

V2.1-supervisorin pitää:

- käynnistää suora worker `CreateProcessW`-kutsulla `CREATE_SUSPENDED`-tilassa
- liittää worker nimeämättömään Job Objectiin atomisesti prosessinluonnissa
  `PROC_THREAD_ATTRIBUTE_JOB_LIST`-attribuutilla ennen `ResumeThread`-kutsua
- käyttää ei-periytyvää job-kahvaa ja `KILL_ON_JOB_CLOSE`-rajaa
- olla asettamatta `BREAKAWAY_OK`- tai `SILENT_BREAKAWAY_OK`-rajaa
- omistaa yksi prosessipuu, yksi supervisor ja yksi monotonisesta kellosta
  laskettu absoluuttinen deadline
- odottaa prosessikahvoja ja todistaa puun poissaolo
  `QueryInformationJobObject`-kutsulla
- päättää deadline-tilassa vain oman jobinsa `TerminateJobObject`-kutsulla
- olla käyttämättä CIM/WMI-kyselyä, parent-PID-ketjua, prosessinimeä,
  `taskkill`-komentoa tai stdout/stderr-dataa omistajuuden tai onnistumisen
  todisteena
- olla tappamatta Windows Installer -palvelua nimellä tai olettamatta sen
  service-side-prosessien kuuluvan jobiin

Request ja terminal result ovat strict, versionoituja sopimuksia. Molemmat
sidotaan 64-merkkiseen lowercase-hex-ajononceen, skenaarioon ja immutable
artifact descriptorin SHA-256-tiivisteeseen. Supervisor onnistuu vain, kun
workerin exit code on nolla, terminal result on nykyiseen ajoon sidottu,
juuriprosessin kahva on signaloitu ja jobin aktiivisten prosessien määrä on
nolla. Job-laskuri ja prosessikahva ovat erillisiä havaintoja; hetkellinen
ero ei ole onnistuminen eikä sellaisenaan `processStateInvalid`-virhe.

Workerin ensisijainen scenario-tulos, supervisorin prosessitulos, cleanup-
tulos ja verifierin postcondition-tulos säilyvät eri kenttinä. Cleanup-virhe
ei saa korvata alkuperäistä scenario- tai prosessivirhettä. Observability
sisältää vain nimetyn operaation, allowlistatun vaiheen, tilan, keston,
kokonaisajan sekä allowlistatun result- tai error-koodin.

Cooperative cancellation ja supervisorin hallitsema deadline ovat tavallisia
terminal-polkuja: niiden pitää kirjoittaa strict supervisor-result ennen exit-
tilaa ja todistaa cleanup-tulos. Ulkoinen hard kill, käyttöjärjestelmän kaatuminen
tai runnerin menetys voi katkaista prosessin ennen resultin kirjoittamista.
Silloin caller hylkää ajon puuttuvan terminal-resultin vuoksi, ja ei-periytyvän
job-kahvan sulkeutuminen aktivoi `KILL_ON_JOB_CLOSE`-suojan omistetulle
prosessipuulle. Puuttuva result ei koskaan merkitse onnistumista.

Prosessinluonti kuuluu samaan absoluuttiseen deadlineen. Nykyinen supervisor
odottaa native-luontia taustatehtävän completionista, mutta vain sen pääsäie
saa kutsua `ResumeThread`-metodia. Deadlineen myöhästyvää workeria ei
käynnistetä. Cleanup-reservin sisällä palautuva suspended-prosessi poistetaan
saman Jobin kautta. Jos native-kutsu ei palaa kokonaisbudjetissa, supervisor
pyytää saman Jobin lopetusta ja kirjoittaa `deadlineExceeded` /
`cleanupUnverified` / `processTreeAbsent: false` ennen virhe-exitiä. Jobin
hetkellinen nolla ei todista puun poissaoloa, kun luonti on vielä kesken.
Job-attribuutin kahvareferenssi säilyy native-kutsun ajan. Sama supervisor
rekisteröi keskeneräisen tehtävän completioniin vastaanottajan, joka sulkee
myöhäiset process/thread-kahvat tai vastaanottaa myöhäisen poikkeuksen.
Vastaanottaja ei kutsu resumea, aloita uutta cleanupia eikä muuta jo palautettua
virhetulosta. Attribuutin vapauttama viimeinen Job-kahva lopettaa myöhäisen
suspended-jäsenen `KILL_ON_JOB_CLOSE`-rajalla. Koko supervisor-prosessin exit
sulkee resurssit myös silloin, kun native-kutsu ei koskaan palaa. Tätä ei saa
kuvata native-kutsun onnistuneeksi cooperative cancellationiksi tai
vahvistetuksi cleanupiksi. Caller ei jatka business-verifieriin eikä hyväksy
ajoa tällaisella tuloksella.

Safe evidence käyttää `schemaVersion: 1` -sopimusta ja on best effort -
diagnostiikkaa. Evidenssivirta ei saa muuttaa workerin, supervisorin tai
cleanupin terminal-tulosta. Validin requestin jälkeinen odottamaton virhe
yrittää kirjoittaa strict `unexpectedFailure`-resultin ennen exit-koodia 1;
result-writerin oma epäonnistuminen jää erilliseksi `resultWriteFailed`-
tilaksi, jonka caller käsittelee puuttuvana tai epävalidina terminal-tuloksena.

Virheellisen pyynnön evidence käyttää samaa ei-estävää taustakirjoitusta.
Validoimaton pyyntö ei anna luotettua flush-aikabudjettia tai result-polkua:
komento poistuu virhekoodilla odottamatta tulostuskohdetta, eikä se käynnistä
workeria tai kirjoita pyynnön nimeämää terminal-resultia. Best-effort-
diagnostiikkarivi saa puuttua; caller ei tulkitse puuttuvaa tulosta
onnistumiseksi. Regressio sitoo estyvän writerin tapahtumaan ja vaatii
oikean komentoprosessin exitin, puuttuvat worker-sivuvaikutukset sekä
vieraan verrokkiprosessin säilymisen. Tämä ei muuta validin pyynnön
process-, worker-, cleanup- tai postcondition-sopimusta.

### Fixture- ja riskisopimus

Yhdellä fixtureperheellä on yksi producer. W6B legacy, W6B.2A ja W6B.2B
voivat käyttää omia immutable descriptor -kokonaisuuksiaan; niistä ei tehdä
yhtä jättimäistä artifactia. Consumer tarkistaa aina descriptorin sekä
source- ja target-tiedostojen omat SHA-256-tiivisteet ennen käyttöä.

Matala riski, kuten tavallinen business-moduulin tai UI:n muutos, ei aja koko
Windows acceptance -matriisia. Installer-, update-, backup-, restore-,
workspace-, classifier- tai CI-sopimuksen muutos sekä tuntematon luokitus
ovat täyden riskin muutoksia. `main`, yöajo, manuaalinen release-portti ja
release-ehdokas ajavat koko matriisin.

### Hyväksytyt artifact-actionit

GitHub API:sta 3.9.2026 varmennetut viralliset upstream-versiot ovat:

- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
  (`v7.0.1`, MIT)
- `actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`
  (`v8.0.1`, MIT)

V2.1-feasibility ei vielä käytä näitä actioneita. Kun artifact fan-out
myöhemmin toteutetaan, SHA-lukitus, rajattu retention, yksiselitteinen
producer/consumer-nimi, read-only descriptor-verifiointi ja salaisuuksien,
profiilien, lokien sekä business-datan poissulku ovat pakollisia.

### V2.1:n hyväksyntä

Feasibility todistetaan synteettisillä prosesseilla, ei Ekyllä tai MSI:llä.
Testien pitää kattaa vähintään:

- suoran lapsen job-jäsenyys ja normaali exit nolla
- grandchildin periytyminen
- non-zero exit
- workerin exit nolla samalla, kun grandchild on yhä elossa
- deadline-cleanup molemmille prosessisukupolville
- supervisorin ulkoinen pysäytys ja kill-on-close
- vieraan sentinel-prosessin säilyminen
- kaksi rinnakkaista, toisistaan eristettyä supervisoria
- malformed request
- puuttuva, vanhalla noncella tai väärällä artifact-hashilla sidottu result
- observabilityn riippumattomuus terminal-tuloksesta

Paikallisesti timeout/cleanup-polku ajetaan vähintään 20 kertaa ilman retryä.
GitHub `windows-latest` -feasibility ajetaan kahden repetition matriisina.
Jos nested Job Object ei toimi GitHub-runnerissa, tähän malliin ei lisätä
PID-wrapperia. V2.2 clean install / uninstall -siivuun edetään vasta, kun
tämä checkpoint on terminal ja vihreä.

## V2.2 clean install / uninstall -checkpoint

V2.2 todistaa yhden jo rakennetun paikallisen MSI-fixturen puhtaan asennuksen
ja poiston. Se ei rakenna pakettia, käynnistä Ekyä, käytä normaalia profiilia
testifixturena eikä muuta nykyisiä W6B-, W6B.2A- tai W6B.2B-komentoja.

Kutsu saa fixtureksi vain eksplisiittisen installer-manifestin. Ennen ajoa
manifestin ja MSI:n pitää olla tavallisia itsenäisiä tiedostoja, niiden
manifestisidoksen pitää täsmätä ja lähdetiedostot kopioidaan uusina tavuina
ajokohtaiseen TEMP-juureen. Symlinkki, hardlinkki, tuntematon manifesttikenttä,
väärä hash tai polun ulosjuoksu torjutaan ennen MSI-operaatiota. Lähdefixture
varmennetaan uudelleen ajon jälkeen eikä sitä poisteta tai muuteta.

Clean lifecycle etenee yhdessä strict worker -sopimuksessa:

1. exact ProductCode, installer-rekisteröinti, install-root, executable,
   shortcut ja Eky-prosessit todistetaan puhtaiksi
2. immutable fixture varmennetaan
3. MSI asennetaan hiljaisesti ilman uudelleenkäynnistystä
4. asennettu versio, payload ja rekisteröinti varmennetaan
5. sama fixture varmennetaan uudelleen
6. täsmällinen tuote poistetaan ProductCodella
7. kaikki ensimmäisen kohdan jäljet todistetaan poissa oleviksi
8. fixture varmennetaan vielä kerran.

Supervisor käynnistää vain yhden workerin ja omistaa sen jälkeläispuun sekä
absoluuttisen deadlinen. Workerilla ei ole rinnakkaista watchdogia, retryä,
PID-cleanupia tai emergency-timeoutia. Worker saa tehdä hallitun exact-product-
cleanupin scenario-virheen jälkeen, mutta supervisor yksin omistaa prosessipuun
pakotetun lopetuksen. Windows Installerin service-side-tila hyväksytään vain
exact MSI-postconditionien perusteella.

Supervisorin terminal-tulos luetaan ennen scenario-resultia. Deadline- tai
prosessivirheessä puuttuva scenario-result ei saa peittää supervisorin tarkkaa
`processResultCode`-, `workerResultCode`- tai `cleanupResultCode`-tulosta.
Supervisorin jälkeen erillinen rajattu read-only-adapteri tarkistaa exact
ProductCode -tilan. Jos exact tuote on yhä asennettu ja supervisorin omistettu
prosessipuu on varmasti poissa, erillinen suoran prosessikahvan omistava
semantic cleanup saa yrittää vain kyseisen ProductCoden poistoa ja tarkistaa
tilan uudelleen. Se ei ole toinen prosessipuun supervisor. Alkuperäinen
supervisor- tai scenario-virhe, ProductCode-verifierin tulos ja semantic
cleanupin tulos säilytetään eri turvallisissa kentissä; cleanup-virhe ei muuta
ensisijaista virhettä.

Worker request ja scenario result ovat versionoituja exact-key-sopimuksia.
Niiden virheellinen UTF-8, duplikaattiavain, tuntematon kenttä, väärä nonce tai
artifact-hash torjutaan fail closed. Supervisor result validoidaan V2.1:n
omalla strict schema- ja binding-sopimuksella. Safe JSONL-evidence käyttää
`schemaVersion: 1` -rajaa ja sisältää vain skenaarion, operaation, allowlistatun
vaiheen, tilan, keston, kokonaisajan ja result- tai error-koodin. Evidencen
tulostusvirhe ei saa muuttaa scenario-, worker-, cleanup- tai supervisor-
tulosta.

Normaali `%APPDATA%\Eky` inventoidaan vain prosessimuistissa ennen ja jälkeen
ajon suhteellisilla nimillä, tiedostokoolla ja SHA-256-tiivisteellä. Nimiä tai
tiivisteitä ei tulosteta. Inventaario torjuu symlinkit, hardlinkit,
erikoistiedostot ja luvun aikana muuttuvan tiedoston. Yksikin lisätty,
poistettu tai muuttunut merkintä kaataa ajon. Onnistunut raportti saa näyttää
vain tiedostomäärät ja `businessDataPreserved: true` -tuloksen.

Paikallinen komento on:

```text
pnpm --filter @eky/desktop installer:v2-clean --fixture-manifest <manifest-path>
```

V2.2 ei vielä käytä GitHub artifact -actioneita eikä ole nykyisen release-
portin auktoritatiivinen korvaaja. Checkpoint ei muuta tuotantokoodia,
riippuvuuksia, lockfilea, versiota tai pilot-artifactia. V2.3:ssa eriytetään
build-once descriptor ja CI:n immutable artifact -siirto ennen upgrade-
skenaarioiden migraatiota.

## V2.3 build-once artifact -checkpoint

V2.3:n clean lifecycle käyttää descriptorina nykyistä versionoitua
`installer.manifest.json`-sopimusta. Uutta rinnakkaista release- tai
descriptor-formaattia ei luoda. Manifesti sitoo app- ja MSI-version,
build-revisionin, paketin nimen, koon ja SHA-256-tiivisteen. Producer laskee
lisäksi descriptor-tiedoston oman SHA-256-tiivisteen, joka välitetään
consumerille artifactin ulkopuolisena job-output-arvona.

Producer:

- toimii puhtaasta Git-revisiosta ja kutsuu nykyistä installer release
  -builderia täsmälleen kerran
- rakentaa nykyisen pilot Electron -payloadin täsmälleen kerran ennen MSI:tä
  ja torjuu payloadin app-versio- tai build-revision-eron
- irrottaa WiX/MSBuildin mahdollisen trusted staging -hardlinkin itsenäiseksi
  hash-varmennetuksi build-outputiksi ennen immutable artifact -kopiota;
  ulkoinen fixture tai consumer-artifact ei saa koskaan olla hardlinkki
- kopioi descriptorin ja MSI:n itsenäisinä tavuina ajokohtaiseen artifact-
  juureen ilman hardlinkkiä
- hyväksyy artifact-juureen vain tiedostot `installer.manifest.json` ja
  descriptorin nimeämän MSI:n
- varmistaa lähdeartifactin muuttumattomuuden sekä kopion descriptor- ja
  package-hashit ennen luovutusta
- ei sisällytä profiilia, lokeja, salaisuuksia, backupia, business-dataa tai
  release-arkistoa.

Consumer:

- saa artifact-juuren ja producer-jobin julkaiseman exact descriptor
  SHA-256:n
- torjuu tuntemattoman inventoryn, muuttuneet tavut, väärän build-revisionin,
  symlinkin, hardlinkin ja erikoistiedoston ennen MSI-operaatiota
- ajaa saman V2.2 clean install / uninstall -lifecycle-toteutuksen ilman
  rebuildiä
- varmistaa ladatut descriptor- ja MSI-tavut uudelleen lifecycle-ajon jälkeen.

Paikallinen producer/consumer-järjestys on:

```text
pnpm --filter @eky/desktop installer:v2-artifact:build --artifact-root <absolute-new-artifact-root> --summary-path <absolute-summary-path-outside-artifact-root>
pnpm --filter @eky/desktop installer:v2-artifact:verify --artifact-root <absolute-artifact-root> --expected-descriptor-sha256 <producer-descriptor-sha256> --expected-build-revision <producer-git-revision>
pnpm --filter @eky/desktop installer:v2-clean --fixture-manifest <absolute-artifact-root>/installer.manifest.json
```

Verifier ajetaan sekä ennen V2.2-lifecyclea että sen jälkeen. Artifact-juuren
pitää olla producerille uusi ja tyhjäksi oletettu polku; producer ei poista tai
korvaa ennalta olemassa olevaa juurta. Summary-polku ei kuulu siirrettävään
artifact-inventoryyn. CLI:n polkuraja hyväksyy package manager -kuljetuksen
lisäämät peräkkäiset hakemistoerottimet vain kanonisoimalla ne välittömästi.
Suhteellinen polku, piste- tai parent-segmentti, NUL tai loppuerotin torjutaan
ennen tiedostojärjestelmän käyttöä. Sama sääntö koskee read-only Windows
Installer -state-inspectorin yksityistä tulospolkua.

CI:n build-once fan-out käyttää vain kohdassa "Hyväksytyt artifact-actionit"
nimettyjä exact-SHA-versioita, yksiselitteistä ajokohtaista artifact-nimeä ja
yhden vuorokauden retentionia. Kaksi toisistaan eristettyä Windows-consumeria
ajaa samat artifact-tavut kerran ilman automaattista retryä. Artifact on
testifixture, ei jaettava release, allekirjoitus tai stable-julkaisu.

Tämä raja toteutetaan workflow'ssa
`.github/workflows/windows-acceptance-v2-clean.yml`. Yksi
`artifact_producer` rakentaa ja varmistaa fixturetavut sekä julkaisee
descriptorin SHA-256:n ja täyden Git-revision job-outputteina. Kaksi
`clean_consumer`-matriisin erillistä Windows-jobia lataa täsmälleen nimetyn
artifactin, todistaa checkoutin saman Git-revision, varmistaa descriptorin ja
MSI:n ennen V2.2-lifecyclea ja sen jälkeen sekä ajaa lifecyclen kerran.
Consumer ei kutsu paketoijaa tai installer-builderia. Siirto käyttää vain
hyväksyttyjä SHA-lukittuja artifact-actioneita, yhden vuorokauden retentionia
ja pakkaamatonta siirtoa; artifactissa sallitaan edelleen vain descriptor ja
sen nimeämä synteettinen allekirjoittamaton MSI.

## V2.4 upgrade- ja rollback-checkpoint

V2.4 siirtää installerin N -> N+1 major upgrade-, downgrade rejection-,
Windows Installer rollback- ja tuotannon binary rollback -sopimukset saman
V2.1-supervisorin ja V2.3:n build-once-rajan päälle. Checkpoint ei muuta
nykyisiä W6-harnesseja tai tuotannon installer-, update-, backup-, restore- tai
workspace-semanticsia.

Producer rakentaa nykyisestä numeerisesta pilot-versiosta source-paketin ja
täsmälleen yhden patch-version uudemman target-paketin. Nykyisessä
checkpointissa pari on `0.2.7 -> 0.2.8`, mutta versioita ei kopioida
protokollavakioiksi. Kolmas MSI käyttää targetin versiota ja ProductCodea sekä
yhtä lisättyä, yksityiseen fixtureen rajattua payload-polkua Windows
Installerin rollbackin todistamiseksi. Canonical `package.json` ja
`installer-release.json` eivät muutu.

Siirrettävän artifactin juuressa on yksi strict
`upgrade-rollback-artifact.json`, joka sitoo täyteen Git-revisioon ja omiin
SHA-256-tiivisteisiinsä seuraavat kolme roolia:

- `source`
- `target`
- `windowsRollback`

Jokaisessa roolihakemistossa sallitaan vain versionoitu
`installer.manifest.json` ja sen nimeämä MSI. Descriptor, manifestit ja MSI:t
ovat tavallisia itsenäisiä tiedostoja. Tuntematon inventory, symlinkki,
hardlinkki, väärä hash, väärä build-revision, epäjatkuva versio tai targetin ja
rollback-proben virheellinen identiteetti torjutaan ennen MSI-operaatiota.

Paketoinnin native SQLite -validointi lataa stagingin `.node`-tiedoston
producer-prosessiin. Siksi producer ei yritä poistaa kiinteää, Gitistä
ohitettua `.stage/windows-acceptance-v2-upgrade`-juurta samasta prosessista.
CI poistaa juuri tämän staging-juuren erillisessä vaiheessa vasta producerin
poistuttua; seuraava paikallinen producer korvaa saman juuren ennen buildia.
Staging ei kuulu siirrettävään acceptance-artifactiin.

Yksi strict worker suorittaa seuraavan järjestyksen:

1. source- ja target-ProductCodejen sekä yhteisen footprintin puhdas preflight
2. source N:n asennus ja exact postcondition
3. N -> N+1 major upgrade ja source/target-tilan exact postcondition
4. N-paketin downgrade-yritys, jonka pitää epäonnistua targetia muuttamatta
5. paketoidun tuotannon `rollbackWindowsInstaller.ps1`-polun binary rollback
   takaisin source-versioon
6. target-identiteetin rollback-probe, jonka MSI-asennuksen pitää epäonnistua
   ja Windows Installerin pitää säilyttää source-versio
7. source-version täsmällinen poisto ja kaikkien jälkien poissaolo
8. artifact-tavujen uudelleentarkistus.

Worker ei rakenna paketteja, käynnistä toista supervisoria, käytä W6-koodia tai
omista prosessipuun emergency cleanupia. Se saa tehdä virheen jälkeen vain
exact source- ja target-ProductCodeihin rajatun hallitun semanttisen cleanupin.
V2.1:n Job Object -supervisor omistaa workerin ja kaikki sen suorat
jälkeläiset, monotonisesta kellosta lasketun absoluuttisen deadlinen sekä
pakotetun prosessipuun cleanupin.

Supervisorin jälkeen erillinen rajattu verifier tarkistaa molemmat exact
ProductCodet. Ensisijainen scenario- tai supervisor-virhe,
`processTreeAbsent`, workerin cleanup, verifierin alkutila, semanttinen cleanup
ja lopullinen postcondition säilyvät eri kenttinä. Semanttinen cleanup voidaan
käynnistää vain, kun supervisor on todistanut omistetun prosessipuun poissaolon;
se käyttää rajattua suoran prosessikahvan adapteria eikä muodosta uutta
prosessipuun supervisoria.

Sama verifier tekee ennen supervisorin käynnistämistä read-only-preflightin,
joka vaatii molempien exact ProductCodejen poissaolon. Precondition-virhe ei
koskaan käynnistä semanttista cleanupia, koska jo olemassa oleva asennus ei ole
testin omistama. Supervisorin jälkeinen exact-product-cleanup on sallittu vain
puhtaan ulomman preflightin jälkeen syntyneen muun terminal-virheen yhteydessä.
ProductCode-kohtainen rekisteröinti ja asennuksen yhteinen
`HKCU\Software\Eky\Installer`-footprint käsitellään eri tiloina: yhteinen avain
ei saa tehdä poissa olevasta source- tai target-ProductCodesta asennettua, mutta
sen pitää olla olemassa asennetussa tilassa ja poissa lopullisessa tilassa.

Binary rollback käyttää tuotannon todellista launcher-sopimusta. Worker
käynnistää yhden Job Objectin omistaman launcher-fixturen elävänä, antaa sen
PID:n paketoidulle rollback-helperille ja vapauttaa launcherin vasta tuotannon
olemassa olevan strict JSONL-kanavan `launcherExitWait:started`-havainnosta.
Näin testi ei korvaa tuotannon handoffia jo poistuneella PID:llä eikä altistu
PID:n uudelleenkäytölle. Progress-parseri hyväksyy vain tuotannon suljetut
vaiheet, tapahtumat ja kestokentät; polkuja, PID-arvoja, komentorivejä tai
raakavirheitä ei julkaista. Progress ohjaa vain synteettisen launcherin
vapautusta. Yksi ulompi V2.1-supervisor omistaa edelleen kaikki prosessit ja
ainoan absoluuttisen deadlinen.

Normaali `%APPDATA%\Eky` käsitellään samalla read-only-inventaariorajalla kuin
V2.2:ssa. Onnistuminen edellyttää muuttumatonta tiedostomäärä-, koko- ja
SHA-256-inventaarioa, mutta yksittäisiä nimiä tai tiivisteitä ei tulosteta.
Runner ratkaisee käyttöjärjestelmän TEMP-juuren realpathin ennen lapsipolkujen
luontia, jotta Node- ja Windows PowerShell -rajalle välitetään yksi kanoninen
Windows-polku. MSI-lokit ja ajokohtainen fixture pysyvät tässä juuresta
johdetussa hakemistossa ja poistetaan ajon jälkeen.

Paikallinen build-once-järjestys on:

```text
pnpm --filter @eky/desktop installer:v2-upgrade-artifact:build --artifact-root <absolute-new-artifact-root> --summary-path <absolute-summary-path-outside-artifact-root>
pnpm --filter @eky/desktop installer:v2-upgrade-artifact:verify --artifact-root <absolute-artifact-root> --expected-descriptor-sha256 <producer-descriptor-sha256> --expected-build-revision <producer-git-revision>
pnpm --filter @eky/desktop installer:v2-upgrade-rollback --artifact-descriptor <absolute-artifact-root>/upgrade-rollback-artifact.json
```

Workflow `.github/workflows/windows-acceptance-v2-upgrade.yml` käyttää yhtä
Windows-produceria ja kahta toisistaan eristettyä ensimmäisen yrityksen
consumeria. Producer rakentaa artifactin kerran, ja molemmat consumerit
tarkistavat saman ulkoisesti välitetyn descriptor-hashin sekä kaikki kolme
MSI-hashia ennen ja jälkeen lifecyclen. Artifact säilytetään yhden vuorokauden
ajan, eikä se ole release, pilot-bundle tai käyttäjälle jaettava paketti.

## V2.5 historical legacy -checkpoint

V2.5 siirtää historiallisen `0.2.6 -> 0.2.7` -yhteensopivuustodisteen saman
V2.1-supervisorin ja build-once-rajan päälle. Checkpoint toteutetaan kahdessa
itsenäisesti vihreässä osassa. V2.5A rakentaa ja varmistaa immutable artifactin;
V2.5B lisää yhden workerin elinkaaren, erillisen postcondition-verifierin ja
CI-consumerit. V2.5A ei vielä korvaa vanhaa W6B legacy acceptance -porttia.

V2.5A:n portable producer rakentaa historical-source-rebuild-luokan lähteen
täsmälleen commitista `6ed99f5319c328f4d3cfbc03b912f21dbc4d1032` ja
nykyisestä puhtaasta HEADista targetin versiona `0.2.7`. Lähteen provenance
säilyttää hyväksytyn source commit-, tree- ja source archive manifest
-identiteetin. Descriptor tarkistaa source-artifactin luokituksen suoraan
MSI-hashista; producerin ilmoittamaan luokitusbooleaniin ei luoteta.

Siirrettävän artifactin juuressa sallitaan vain:

```text
legacy-upgrade-artifact.json
source/
  installer.manifest.json
  Eky-0.2.6-x64.msi
  historical-fixture-provenance.json
target/
  installer.manifest.json
  Eky-0.2.7-x64.msi
```

Descriptor sitoo targetin täyteen Git-revisioon, yhteiseen UpgradeCodeen,
molempien roolien ProductCodeen, manifesti- ja MSI-hasheihin sekä lähteen
provenance-hashiin. Targetin packaged payloadista lasketaan lisäksi suljettu
`packagedApp`-inventory-identiteetti, tiedostomäärä ja tavumäärä. Inventory
lasketaan ennen MSI-buildia ja sen jälkeen, jotta build ei saa muuttaa
payloadia. Koko unpacked payloadia ei kopioida artifactiin; V2.5B:n verifier
laskee saman identiteetin asennetusta payloadista.

Kaikki artifactin tiedostot ovat tavallisia itsenäisiä tiedostoja. Descriptor,
manifesti, MSI tai provenance ei saa olla symlinkki tai hardlinkki.
Tuntematon tiedosto, tuntematon avain, väärä hash, virheellinen provenance,
epäjatkuva versio tai muuttunut canonical `package.json` /
`installer-release.json` torjutaan fail closed. Artifact ei sisällä profiilia,
business-dataa, backupia, lokia, salaisuutta tai paikallista release-arkistoa.

V2.5A:n paikallinen build-once-järjestys on:

```text
pnpm --filter @eky/desktop installer:v2-legacy-artifact:build --artifact-root <absolute-new-artifact-root> --summary-path <absolute-summary-path-outside-artifact-root>
pnpm --filter @eky/desktop installer:v2-legacy-artifact:verify --artifact-root <absolute-artifact-root> --expected-descriptor-sha256 <producer-descriptor-sha256> --expected-build-revision <producer-git-revision>
```

Artifact-juuri sijoitetaan ajokohtaiseen OS TEMP -hakemistoon. Producerin
ulkoinen summary ja paikalliset tutkimuslokit säilytetään Gitistä ohitetussa
`.eky-local`-kansiossa, ei paketoijan omistamissa cleanup-juurissa.
Normaali target-paketointi tyhjentää `apps/desktop/.stage`- ja `out`-juuret:
artifactia, sen jo muodostettua source-roolia tai säilytettävää todistusaineistoa
ei saa sijoittaa niiden alle. Producerin ja consumerin ajopaikat tarkistetaan
ennen käynnistystä; tämä ei muuta paketoijan cleanup-semanttiikkaa.
Producer torjuu artifact- ja summary-kohteen päällekkäisyyden näiden
cleanup-juurien kanssa ennen ensimmäistä buildia tai kirjoitusta.

Asennusjälkien read-only-tarkistin säilyttää ensimmäisen hylkäyksen
roolikohtaisella suljetulla virhekoodilla: asennusjuuri, executable tai
pikakuvake sekä metatietoluku, symlink, väärä tyyppi tai tiedoston
linkkimäärä. Puuttuminen säilyy tilahavaintona; lifecycle ratkaisee,
edellyttääkö nykyinen vaihe asennettua vai poissa olevaa tuotetta.
Koodi kulkee muuttumattomana workerin ja callerin virherajan läpi, vaikka
myöhempi semanttinen cleanup onnistuu. Tarkistin ei korjaa, kirjoita tai
poista tutkittavaa jälkeä eikä löysennä single-link-ehtoa. Polku ja raaka
käyttöjärjestelmävirhe eivät kuulu julkiseen tulokseen.

V2.5B saa käyttää tätä artifactia vain validoidun descriptorin kautta. Se ei
saa rakentaa tai ladata paketteja workerissa, kutsua vanhaa W6B-orkestrointia
eikä lisätä uutta timeout-, cleanup-, PID-, CIM-, retry- tai wrapper-omistajaa.
Historical Electronin kahden vaiheen packaged-smoke on rajattu OS-adapteri
saman Job Objectin sisällä; supervisor yksin omistaa absoluuttisen deadlinen ja
pakotetun prosessipuun cleanupin.

V2.5B:n worker käyttää vain validoitua artifact-descriptoria ja ajokohtaista
synteettistä profiilia. Sen lifecycle on suljettu seuraavaan järjestykseen:

1. source- ja target-ProductCodejen sekä yhteisen installer-footprintin puhdas
   preflight
2. historiallisen source-MSI:n asennus ja exact source-product-postcondition
3. historiallisen `--desktop-smoke`-polun initial- ja restored-sukupolvi saman
   Job Objectin sisällä
4. historiallisen source-version erillinen normaali käynnistys, accepted-build-
   readiness ja hallittu shutdown samalla profiililla
5. source-profiilin accepted-build-, SQLite-, business- ja PDF-evidence
6. target-MSI:n major upgrade ja exact target-product- sekä payload-evidence
7. targetin ensimmäinen normaali käynnistys, legacy-adoptio ja hallittu
   sovellusikkunan sulkeminen
8. targetin toinen normaali käynnistys samalla profiililla ja hallittu
   sovellusikkunan sulkeminen
9. artifact-tavujen uudelleentarkistus.

Historical smoke käynnistetään initial-sukupolvena täsmälleen kerran. Kun
historiallinen runtime päättyy `restoreRestart`-vaiheeseen, worker käynnistää
täsmälleen yhden restored-sukupolven historiallisen smoke-sopimuksen mukaisesti
ja vaatii siltä terminal `shutdown/ok` -evidencen. Tavoiteversion readiness ja
shutdown tunnistetaan versionoidusta operational JSONL -evidencestä;
kiinteää odotusaikaa, pollingia tai retryä ei käytetä. Yksi rajattu
PowerShell-adapteri saa pyytää workerin suoraan käynnistämää Electron-prosessia
sulkemaan pääikkunansa kerran. `desktop.started` ei yksin takaa näkyvää
ikkunaa. Sulkuadapterin ikkunavalmius erotetaan siksi runtime-readinessista:
rajattu Win32-tapahtumatilaus sidotaan jo käynnistettyyn prosessiin ennen
ensimmäistä ikkunatarkistusta. Prosessin kahva pidetään avoimena tarkistuksen
ja yhden sulkupyynnön ajan. Jo näkyvä ikkuna ja myöhemmin näkyvä ikkuna
noudattavat samaa sopimusta.

Adapteri saa odottaa vain kyseisen prosessin ikkunatapahtumaa tai exitia.
Sillä ei ole omaa deadlinea, pollingia, retryä, prosessihakua tai kill-oikeutta;
myös puuttuvan ikkunan tapauksessa nykyinen Job-supervisor omistaa ajan ja
pakotetun cleanupin. Jos startup epäonnistuu, worker kirjoittaa epäonnistuneen
tuloksen ja poistuu ei-nolla-koodilla. Se ei käynnistä toista best-effort-
sulkuadapteria, joka voisi peittää alkuperäisen virheen.

Smoke-palautuksen jälkeen source-version erillinen normaali käynnistys kuuluu
legacy-invarianttiin: se todistaa, että palautettu profiili avautuu tavallisessa
ajossa, accepted-build on valmis ja runtime sulkeutuu hallitusti ennen
target-MSI:n asentamista. Tätä vaihetta ei korvata pelkällä elossa olevalla
prosessilla tai smoke-resultilla.

Worker-result säilyttää vain strict turvallisen lopputuloksen. Yksityiseen
scenario-juureen kirjoitettu evidence sitoo source- ja target-identiteetit,
business-inventaarion, hyväksytyn lasku-PDF:n, workspace-adoption,
runtime-sessionit ja toisen käynnistyksen idempotenssin. Näitä yksilöiviä
arvoja ei tulosteta konsoliin tai CI-lokiin.

V2.5-worker kirjoittaa scenario-resultin ja worker-resultin loppuun ennen
prosessin exitia. Onnistuminen palauttaa `0`, epäonnistunut skenaario tai
result-writer `1` ja virheellinen request `64`. Epäonnistunutta skenaariota ei
saa palauttaa exit `0`:na: eloon jäänyt jälkeläinen siirtäisi silloin
supervisorin cleanupin tarpeettomasti deadlineen asti. Ei-nolla-exit käyttää
nykyisen Job Object -supervisorin olemassa olevaa failure-cleanupia.

Post-supervisor-raja saa lukea strict runNonce/artifact-sidotun epäonnistuneen
scenario-resultin workerin exit `1`:n jälkeen ja säilyttää sen alkuperäisen
virhekoodin. Supervisorin process-, worker- ja cleanup-tulokset pysyvät
erillisinä. Puuttuva tai onnistumista väittävä scenario-result ei peitä
prosessivirhettä; deadline pysyy ensisijaisena eikä sitä tulkita workerin
hallittuna virheenä. Preflightin torjunta ei anna lupaa poistaa ennestään
asennettua tuotetta.

Supervisorin todistettua `processTreeAbsent`-tilan erillinen postcondition-
verifier tarkistaa ennen semanttista cleanupia:

- source-profiilin legacy-data ja storage säilyivät muuttumattomina
- targetissa on yksi ready-workspace ja kertaluonteinen adoptio ilman
  journal- tai operation-jäämiä
- ensimmäinen ja toinen käynnistys käyttävät samaa workspacea ja samaa
  business-inventaarioa mutta eri runtime-sessionia
- asennetun target-payloadin inventory vastaa immutable descriptorin
  inventorya
- source- ja target-artifactien tavut ovat edelleen muuttumattomat.

Scenario-result, supervisor-result, semanttinen proof, exact ProductCode
-cleanup ja lopullinen postcondition pysyvät eri tuloksina. Ensisijainen virhe
ei peity cleanup-virheeseen. Semanttinen cleanup käyttää jo olemassa olevaa
V2.4:n ProductCode-kohtaista, rajattua post-supervisor-adapteria eikä lisää
toista deadline-, cleanup-, PID-, CIM-, retry-, wrapper- tai process-tree-
omistajaa. Normaali `%APPDATA%\Eky` inventoidaan vain read-only ennen ja jälkeen
ajon, eikä yksittäisiä polkuja tai tiivisteitä tulosteta.

V2.5B:n paikallinen consumer-komento on:

```text
pnpm --filter @eky/desktop installer:v2-legacy --artifact-descriptor <absolute-artifact-root>/legacy-upgrade-artifact.json
```

### V2.5:n hyväksytty suoritusympäristö

Omistajan hyväksymä rajaus koskee vain V2.5:n vaihehyväksyntää: kaksi
paketoitua consumer-ajoa suoritetaan kahdessa toisistaan eristetyssä
GitHub Windows -jobissa samalla puhtaan revision build-once-artifactilla.
Tämä korvaa aiemman vaatimuksen kahdesta paikallisesta packaged-consumerista;
se ei poista paikallisia kohde-, normaali- tai artifact-sopimustestejä eikä
desktopin typecheck/build-portteja. Paikallinen consumer-komento säilyy
käytettävissä samoilla turvallisuusehdoilla, mutta sen ajo ei ole tämän
vaiheen pakollinen hyväksyntäportti.

- Producer ja molemmat consumerit on sidottava täsmälliseen harness-revisioon.
  Descriptor ja kummankin MSI:n SHA-256 tarkistetaan ennen ja jälkeen
  kummankin consumerin; eri buildien byte-identtisyyttä ei oleteta.
- Molempien consumerien pitää valmistua ensimmäisellä yrityksellä nykyisten
  worker-, process-, semantic proof-, cleanup- ja postcondition-sopimusten
  mukaisesti. Tuntematon tila, puuttuva tulos tai rerun-only-vihreä ei riitä.
- Artifactien ja asennetun footprintin single-link-, symlink-, containment-,
  identiteetti- ja sisältötarkistukset säilyvät. GUI-fixturen poikkeusta ei
  siirretä asennettuun payloadiin, eikä vendor-allowlistiä lisätä.
- Epäonnistunut paikallinen tai CI-ajo säilyy epäonnistuneena. Ympäristön
  rajaus ei selitä aiempia virheitä eikä muuta niitä hyväksyntätodisteiksi.
- Päätös ei muuta koko V2:n valmis-määritelmää, päähaaran required checkejä,
  cutoveria, release-portteja tai pilotin paikallista testausta.

Pelkkä dokumentaatiomuutos ei vaadi uutta MSI-buildia tai saman muuttumattoman
koodirevision manuaalista CI-uusintaa. Raportissa erotetaan testattu
harness-/artifact-revisio dokumentaation HEADista ja varmennetaan, ettei
toteutus tai testikytkentä muuttunut niiden välillä. Automaattisia nykyisiä
PR-tarkistuksia ei ohiteta, peruta tai korvata vanhan revision tuloksilla.

V2.5 ei vielä poista, muuta tai kutsu vanhaa W6B legacy acceptance -harnessia.
Cutover tehdään vasta, kun kaikki vanhan portin invariantit on nimetty,
V2-vastineet ovat terminal ja koko V2:n erikseen määritellyt paikalliset ja
GitHub-portit ovat hyväksytysti vihreät. Vaiheen suoritusympäristöpäätös
ei yksin valtuuta vanhan polun poistamista.

### V2.5-invarianttien siirtokartta

Taulukko kuvaa kattavuuden omistajuutta, ei anna vielä lupaa vanhan polun
poistamiseen. V2.5:n vaihekohtaiset portit ovat yllä hyväksytyn ympäristörajan
mukaiset paikalliset sopimustestit ja kaksi ensimmäisen yrityksen
GitHub-consumeria samalle puhtaan revision artifactille.

| Vanhan legacy-portin invariantti | V2.5-vastine ja kohdetesti | Poiston ehto |
| --- | --- | --- |
| Historiallinen source-identiteetti ja muuttumattomat MSI-tavut | `legacyUpgradeArtifact` ja sen testit; build-once producer/consumer | Paikalliset artifact-sopimustestit ja molempien CI-consumerien ennen/jälkeen-varmennus samoille tavuille |
| Puhdas kone ja exact ProductCode/payload | `legacyUpgradeLifecycle`, `legacyUpgradeWindowsRuntime`, `legacyUpgradePostcondition` | Täysi install/upgrade ja erillinen jälkitarkistus |
| Initial -> restoreRestart -> restored -> shutdown | `legacyUpgradeSourceSmoke` ja ketjutestit | Historiallisen paketin täysi kaksiprosessinen smoke |
| Source avautuu normaalisti ennen päivitystä | `runSourceStartup`, `legacyUpgradeLifecycle.test`, `legacyUpgradeStartupObserver.test` | Normaali source-start ja graceful shutdown packaged-ajossa |
| Näkyvä ikkuna suljetaan kerran ilman kiinteää viivettä | `WindowsApplicationCloseRequest` ja native `requestWindowsApplicationClose.test` | Jo näkyvä / tapahtumasta näkyvä ikkuna, exit ja puuttuva ikkuna testattu nykyisen Jobin alla; lisäksi packaged consumer |
| Accepted-buildin ristiriidat torjutaan | `legacyUpgradeProfileEvidence.test` | Deterministiset slotit, korruptio- ja konfliktitestit sekä runtime-evidence |
| SQLite/storage/PDF säilyvät; yksi adoptio ja uusi runtime toisella käynnistyksellä | `legacyUpgradeProfileEvidence` ja `legacyUpgradePostcondition` testeineen | Historiallisen smoken business-fixture ja täysi target-start kahdesti; hash-inventaario ei yksin korvaa business-fixturen todistetta |
| Worker failure, deadline ja koko omistetun puun cleanup | Nykyinen V2.1-supervisor, `runLegacyUpgradeWorker.test` sekä contract-sarjan `context cleanup` -regressiot | Ei uutta valvojaa; live-child cleanup ja foreign sentinel säilyvät; testituen cleanup-virhe säilyttää aineiston ja muut omistetut kahvat käsitellään |
| Alkuperäinen virhe ei katoa cleanupiin | `legacyUpgradeFailureBoundary.test` | Missing result, worker non-zero, preflight-esto ja cleanup failure testattu erikseen |
| Normaali profiili ja source-artifact säilyvät | `runLegacyUpgrade`, `closedDirectoryInventory` ja artifact-verifier | In-memory ennen/jälkeen-vertailu sekä artifactin uudelleenvarmennus |

`legacyUpgradeWindowsRuntime.test` sisältää lisäksi lähdekoodiin kohdistuvia
arkkitehtuurirajoja. Ne eivät todista ikkunan näkyvyyttä tai sulkeutumista;
nämä todisteet kuuluvat packaged consumerille. `desktop.started` kertoo
runtimen käynnistymisestä, ei yksin renderöidyn ikkunan valmiudesta.

#### Historiallinen ikkunavalmiuden välitila

Seuraavat välitulokset säilyttävät aiemman checkpointin historian. Nykyinen
suoritusympäristö ja hyväksyntätila on määritelty erikseen tässä dokumentissa.

Workerin failure-boundary-checkpointin kohdesarja läpäisi 81/81 testiä,
ja live-child failure/cleanup -sopimus viisi peräkkäistä paikallista ajoa.
Ikkunaobserverin erillinen native-sarja läpäisi 6/6 testiä. Se käyttää
etukäteen TEMPiin käännettyä synteettistä GUI-executablea suoraan nykyisen
supervisorin workerina, ei runtime-käännöstä tai Node -> PowerShell -ketjua.
Fixture ei rakenna MSI:tä eikä lisää prosessiomistajaa.

Testifixturen valmistelun deadlinea ei saa tulkita todisteeksi puuttuvan
ikkunan oikeasta käsittelystä. Fixture todistaa sisältäpäin, että tapahtuma-
tilaus ja ensimmäinen tyhjä ikkunatarkistus on tehty. Viivästetty ikkuna
vapautetaan vasta tämän jälkeen. Myös prosessin poistuminen jo alkaneen
odotuksen aikana testataan erikseen.

Native-sarja ei todista PowerShell-adapterin käynnistymistä oikeassa worker-
ympäristössä. Tuolloin vaadittiin kaksi paikallista ja kaksi GitHub-consumeria.
Nykyinen suoritusympäristöpäätös korvaa paikallisen consumer-vaatimuksen;
alemman tason testejä ei edelleenkään merkitä packaged-todisteeksi.

Ikkunavalmiuden muutos on vielä paikallista keskeneräistä työtä. Laajennetun
kohdesarjan tulos oli 85/86: jo näkyvän ikkunan tapaus päättyi deadlineen.
Erillinen 6/6-ajo tai myöhempi yksittäinen diagnostinen onnistuminen ei kumoa
tätä tulosta. Tuossa epäonnistuneessa ajossa fixturen puuttuva vaihemerkintä
ei vielä erottanut käynnistymistä, `Shown`-odotusta ja sulkemista; juurisyytä
ei ole vahvistettu. Fixtureen lisätyt turvalliset vaiheet tarkentavat jatkorajausta.

### Ikkunavalmiuden ja virherajojen sopimukset

Tämä luku säilyttää toteutuksen vastuut ja hyväksytyt
rajaukset; konekohtaiset tutkimuspäiväkirjat ja mittaukset eivät kuulu
versionoituun suunnitelmaan. Niitä käsitellään vain Gitistä ohitetussa
paikallisessa aineistossa. Yksityisyyskorjaus ei muuta testituloksia,
aikabudjetteja, tuotantosemantiikkaa tai invarianttien siirtokarttaa.

#### Failure-boundary ja testijuuren säilytys

- `legacyUpgradeFailureBoundary` luokittelee myös onnistuneen supervisorin
  jälkeen puuttuvan tai lukukelvottoman scenario-resultin. Alkuperäinen virhe,
  semanttinen cleanup ja jälkiehto säilyvät erillisinä. Puuttuva tulos ei
  valtuuta uninstallia: caller tarvitsee ennen ajoa varmennetun
  exact-products-absent-esiehdon. Epäselvä prosessipuu estää uuden verifierin
  ja semanttisen cleanupin.
- `runLegacyUpgrade` ei poista käynnistetyn ajon testijuurta ehdottomasti
  `finally`ssa. Poisto vaatii varmennetun prosessipuun poissaolon sekä
  onnistuneen cleanupin ja exact-products-absent-jälkiehdon. Turvallinen
  ennen käynnistysyritystä tehtävä cleanup on tästä erillinen vastuu.
  Puuttuva supervisor-result tai turvallisuuspoikkeama säilyttää aineiston.
- `runLegacyUpgrade.test.mjs` vaatii completed-tapaukselta poikkeuksettoman
  paluun ja oikean result-koodin. Virhetapaukset vaativat oman odotetun
  poikkeuksensa; onnistunut cleanup ei yksin hyväksy skenaariota.
- `supervisorContractTestSupport.cleanupRunContext` säilyttää aineiston,
  jos prosessi-, result-, identiteetti- tai marker-tarkistus epäonnistuu.
  `terminateChildHandles` käsittelee muutkin omistetut kahvat ensimmäisestä
  virheestä huolimatta. Ensimmäinen cleanup-virhe säilyy erillään testin
  alkuperäisestä virheestä. Uutta cleanup-manageria ei ole.
- Julkinen päätetulos kertoo `fixtureCleanupResultCode`- ja
  `fixtureRemoved`-arvot, ei yksityistä polkua. Myöhempi yleinen
  nollaprosessikysely ei muuta `cleanupUnverified`-tulosta onnistumiseksi.

#### Prosessinluonti ja komentotason omistajuus

`fixtures/buildWindowsApplicationCloseFixture.mjs` käyttää valmistelussa
nykyistä Job-supervisoria ja Windowsin .NET Framework C# -kääntäjää. Kääntäjä
ja jälkeläiset kuuluvat samaan omistettuun Jobiin. Tämä ei ole scenario-
workerin sisäinen supervisor. Käännöksen alkuperäinen virhe, timeout,
jälkeläisten poissaolo ja foreign sentinel testataan erikseen.

Nykyinen Win32-adapteri käyttää `PROC_THREAD_ATTRIBUTE_JOB_LIST`-attribuuttia
atomiseen Job-jäsenyyteen prosessin luonnissa. Se korvaa erillisen create-
Assign-välin ja sen direct-process-termination-haaran, ei takaa natiivikutsun
nopeutta. Attribuuttimuisti ja Jobin SafeHandle-referenssi säilyvät
natiivikutsun valmistumiseen asti; prosessi- ja thread-kahvoilla on omistaja.
Injektoitu myöhäinen paluu ei saa resumeta epäonnistuneen ajon workeria.

`ProcessBoundaryContract` todistaa suspended-jäsenyyden, cancelin ennen
luontia, myöhäisen paluun, kesken jäävän luonnin, alkuperäiset virheet ja
root-exit/Job-empty-havaintojen molemmat järjestykset. Nämä havainnot eivät
ole yksi atominen snapshot. Nested Job -regressiot kattavat normaalin exitin
ja jälkeläisen timeout-cleanupin; mielivaltaisten ulkoisten Job-rajoitusten
yhteensopivuutta ei oleteta.

`LateProcessCreationContract` todistaa myöhäisen kahvan käsittelyn Run-rajan
jälkeen. Sen erillinen komentotason regressio tarkkailee oikeaa result-write/
exit-järjestystä ulkopuolelta: strict result on luettavissa komentoprosessin
ollessa elossa, fixturen vapautus johtaa exit 1:een ja alkuperäinen
`deadlineExceeded / cleanupUnverified / processTreeAbsent: false` säilyy.
Injektoidun viiveen todistus ei väitä keskeyttävänsä Windowsin kernel-kutsua.

Mittauspisteet erottavat valmistelun, natiivikutsun, kahvojen vastaanoton ja
fixturen readinessin. Niiden välissä ei kirjoiteta konsoliin tai tiedostoon.
Mittauksen kirjoitusvirhe ei muuta process-, worker- tai cleanup-tulosta.
Tarkat paikalliset havainnot eivät kuulu julkiseen raporttiin.

#### GUI-fixturen hyväksytty sopimus

Omistajan hyväksymä rajaus koskee vain kerran käännettyä
`WindowContract.exe`-testifixtureä:

- tunnetut lähteet, kääntäjä, argumentit ja onnistunut omistettu käännös
  sitovat alkuperän; executable on itsenäinen tiedosto
- `windowsApplicationCloseFixtureIdentity` tarkistaa kanonisen juuren ja
  polun, regular-file-tyypin, symlink-rajan, root/file-id:n, koon ja SHA-256:n
- tiedostokahvan stat sidotaan ennen/jälkeen-polkuhavaintoihin; myös juuren
  identiteetin vaihtuminen hylätään, vaikka leaf-file-id ja tavut säilyisivät
- ajonaikainen linkkimäärä on erillinen havainto, ei yksin GUI-testin hylkäys;
  tämä ei salli harnessin tekemää executable-hardlink-kloonausta
- ikkunan valmius ja sulkeminen, worker-result, root-exit, Job-empty,
  foreign sentinel ja cleanup ovat erillisiä pakollisia tuloksia
- normaali testi ei tutki koneen muita ohjelmia eikä käytä vendor-allowlistiä.

Tuotannon, releasen, backupin ja updaten linkki- ja containment-politiikat
eivät muutu. Tilapäinen `EKY_V25_SHARED_FIXTURE`-valinta on poistettu.
Hyväksyntä käyttää normaalia kerran käännettyä fixtureä, ei säilytettyä
tutkimusfixtureä tai lämmitysajoa.

Readiness perustuu tapahtumaan tai tilaehtoon, ei kiinteään odotukseen.
Omistajan hyväksymä `visible`-, `delayed`-, `exited`- ja `exitWhileWaiting`-
tapausten kokonaisbudjetti on 30000 ms. Nykyinen 1000 ms cleanup-varaus
säilyy, joten työn määräaika on 29000 ms. Tämä on nimetty GUI-integraation
testisopimus, ei suorituskyky-SLO tai kiinteä odotus. Jaettu `createRequest`-
oletus, `absent`-tapaus sekä keinotekoiset timeout-, late-creation- ja
cleanup-regressiot eivät muutu.

#### Watcher ja worker-fixture

`legacyUpgradeStartupObserver` sekä `legacyUpgradeSourceSmoke` antavat
Windowsin native-watcherille kanonisen realpath-polun vasta lstat- ja saman
hakemiston dev/ino-tarkistusten jälkeen. Oikean 8.3-aliasin regressio kattaa
libuv-assertion, linkit torjutaan ja varhainen child-rejection sidotaan heti.
Ei polling-fallbackia, retryä tai uutta omistajaa.

Live-child-fixture vaatii requestin lukemisen, lapsen käynnistyskuittauksen,
workerin paluun ja lapsen elossaolon ennen parentin exitia. Synteettisen
lapsen `detached: true` estää Noden oman kill-on-parent-exit-Jobin kilpailun
supervisorin kanssa; breakaway-lippua ei käytetä. Supervisorin peritty
Job-omistajuus, alkuperäinen worker-virhe, cleanup ja foreign sentinel
todistetaan edelleen.

## V2.6 packaged workspace success

V2.6 jatkaa vaihekohtaisesti katselmoidun V2.5-checkpointin `f309ccb` päältä
omassa pinotussa haarassa `codex/test-harness-v2-workspace-success`.
V2.5:n testattu harness/artifact-revisio pysyy `47847f9`:ssä. PR #263 ja
aiemmat checkpointit säilyvät draftina; tämä ei ole päähaaran käyttöönotto.

V2.6:n success-kattavuus on nyt todistettu jäljempänä nimetyssä packaged-
checkpointissa. Alla olevat aiempien toteutusvaiheiden epäonnistumiset ovat
historiallista näyttöä, eivät hyväksyttyjä uusintoja. Myöhemmän revision
hyväksyntä edellyttää edelleen sen omia ensimmäisen yrityksen CI-portteja;
PR #264 pysyy draftina loppukatselmusta varten.

### Suoritusympäristö ja hyväksyntäraja

Omistajan erillinen päätös hyväksyy V2.6:lle ja myöhemmin V2.7:lle kaksi
eristettyä GitHub Windows -consumeria samalle build-once-artifactille kahden
paikallisen packaged-ajon sijaan. Paikalliset sopimustestit ja muut sovitut
portit säilyvät. Jokaisen vaiheen omien consumerien pitää onnistua
ensimmäisellä yrityksellä ja varmistaa samat tavut ennen ajoa ja sen jälkeen,
normaalin profiilin muuttumattomuus sekä omistettujen prosessien ja
testiasennusten poistuminen. Päätös ei muuta turvallisuusrajoja, muuta vanhoja
epäonnistumisia onnistumisiksi tai hyväksy koko V2:ta, cutoveria tai julkaisua.

### Ensimmäinen artifact-sopimuscheckpoint

Ensimmäinen rajattu vastuu rakentaa lähde- ja kohdepaketin nykyisellä
nimetyllä `buildW6b2PackagedSuccessInstallers`-fixture-builderilla kerran.
Vanhaa W6B.2A-runneria tai sen prosessi-/timeout-/cleanup-orkestrointia ei
kutsuta eikä muuteta. Synteettiset versiot pysyvät `0.2.7 -> 0.2.8`;
canonical-version tai release-kanavan muutosta ei tehdä.

- `workspaceSuccessArtifactDescriptor.mjs` omistaa strictin versionoidun
  kahden roolin sopimuksen. Descriptor sitoo täydellisen harness-revision
  kummankin paketin nykyiseen 12-merkkiseen runtime-/manifest-revisioon,
  täsmällisiin ProductCodeihin ja UpgradeCodeen, MSI-/manifest-tiivisteisiin
  sekä kummankin unpacked payloadin inventaarioon.
- `buildWorkspaceSuccessArtifact.mjs` käyttää nykyistä private fixture-
  builderia ja itsenäisten tiedostokopioiden materialisointia. Se ei asenna,
  käynnistä business-runtimea tai luo profiilia. Olemassa olevaa artifactia
  ei korvata; build-revision ja canonical-syötteiden pitää säilyä.
- `workspaceSuccessArtifact.mjs` lukee vain suljetun descriptor/source/target-
  sisällön. MSI ja manifest luetaan samoilta validoiduilta tiedostokahvoilta;
  single-link, tiedostoidentiteetti, koko ja aikaleimat tarkistetaan ennen ja
  jälkeen. Tuntematon sisältö, linkki, muuttunut metadata tai väärä tiiviste
  hylkää artifactin. Validoitu descriptor ei vielä todista asennetun payloadin
  tai business-profiilin oikeellisuutta.
- `verifyWorkspaceSuccessArtifact.mjs` palauttaa vain sallitun artifact-
  yhteenvedon. Absoluuttiset polut ja raaka virhe eivät kuulu tulosteeseen.
- Kohdetestit rakentavat vain pieniä synteettisiä tiedostoja, eivät MSI:tä.
  CI:n nopea contract-jobi ei korvaa kahta myöhempää packaged-consumeria.

Kohdekomennot:

```text
pnpm --filter @eky/desktop installer:test:windows-acceptance-workspace-artifact
pnpm --filter @eky/desktop installer:v2-workspace-artifact:build --artifact-root <private-temp-artifact> --summary-path <private-temp-summary>
pnpm --filter @eky/desktop installer:v2-workspace-artifact:verify --artifact-root <private-temp-artifact> --expected-descriptor-sha256 <sha256> --expected-build-revision <full-revision>
```

Tämä ensimmäinen checkpoint kattoi artifact-rajan, ei V2.6:n hyväksyntää.
Workerin ajokytkentä ja read-only business-jälkiehdot kuvataan jäljempänä.
Oikean producerin artifact-todiste ja kaksi CI-consumeria olivat tässä
ensimmäisessä checkpointissa vielä avoin portti.
Worker ei rakenna paketteja, luo
uutta prosessivalvojaa tai omista emergency cleanupia. Nykyinen Job Object
-supervisor säilyttää prosessipuun ainoan omistajuuden.

### Lifecycle- ja virherajasopimuksen checkpoint

Seuraava rajattu checkpoint lisää ajoketjun portit ja käyttäytymistestit:

- `workspaceSuccessContracts.mjs` sitoo pyynnön ja tuloksen skenaarioon,
  nonceen sekä artifact-tiivisteeseen. Vain järjestyksessä valmistuneiden
  vaiheiden yhtenäinen alkuosa hyväksytään; ensimmäinen virhe pysäyttää ketjun.
  Tuloslukija vaatii rajatun, kanonisen, itsenäisen tiedoston ja muuttumattoman
  tiedostoidentiteetin saman lukukahvan ympärillä.
- `workspaceSuccessLifecycle.mjs` pitää source-asennuksen, A:n päivityksen,
  B:n aktivointimigraation, ensimmäisen normaalin B-käynnistyksen ja sen
  jälkeisen uudelleenkäynnistyksen erillisinä vaiheina. C:n hylkäys on oma
  jälkiehtonsa. Source-handoffin jälkeen ei käynnistetä toista MSI-operaatiota.
- `workspaceSuccessWindowsRuntime.mjs` kytkee nimetyt nykyiset private proof-
  ja profile-portit sekä payload-/ProductCode-tarkistukset. Aliprosessin
  adapteri vain odottaa exit-tapahtumaa; sillä ei ole omaa aikarajaa,
  pakotettua sulkemista tai prosessipuun rekisteriä. Prosessipuun valvonta
  kuuluu edelleen olemassa olevalle supervisorille.
- `inspectWorkspaceSuccessMsiActivity.ps1` palauttaa vain saman istunnon
  MSI-clientien määrän. Tämä read-only-havainto ei anna prosessiomistajuutta
  eikä valtuuta minkään prosessin sulkemista. Todellisia ehtoja havainnoiva
  odotus ei käynnistä installeria uudelleen eikä lisää kiinteää onnistumisviivettä.
- `workspaceSuccessFailureBoundary.mjs` säilyttää alkuperäisen virheen,
  supervisorin tulokset, business-jälkiehdon, exact-product-cleanupin ja
  asennusjälkien poiston erillään. Semanttinen cleanup edellyttää varmennettua
  tyhjää prosessipuuta ja ennen ajoa todistettua puhdasta ProductCode-alkutilaa.
  Puuttuva scenario-result ei itsessään valtuuta poistoa. Epäonnistunut cleanup
  pysyy virheenä, vaikka tuotteet olisivat myöhemmässä tarkistuksessa poissa.
  Käynnistetyn ajon juurta ei saa poistaa, jos näistä jää jokin varmistamatta.

Rajattu sarja ajetaan komennolla:

```text
pnpm --filter @eky/desktop installer:test:windows-acceptance-workspace
```

CI:n nopea Windows-jobi ajaa artifact- ja lifecycle-sopimukset.
Windows-adapterin testit suorittavat vain read-only-kyselyn; muut uudet testit
käyttävät synteettisiä tiedostoja ja injektoituja portteja. Ne eivät asenna
MSI:tä tai todista paketoidun yritysdatan jatkuvuutta. Alla oleva seuraava
checkpoint kytkee workerin ja callerin sekä read-only business-verifierin.
Tässä lifecycle-checkpointissa build-once-producerin ja kahden eristetyn
consumerin paketoitu hyväksyntä vielä puuttui. Vanhaa W6B.2A-porttia ei
poisteta eikä uuden sopimussarjan vihreyttä lasketa packaged-hyväksynnäksi.

### Worker, caller ja read-only-jälkiehto

`runWorkspaceSuccessWorker.mjs` kytkee lifecycle-portit nykyisiin yksityisiin
proof- ja profiilinvalmistelusopimuksiin. Se ei rakenna MSI:tä eikä käynnistä
supervisoria. Worker julkaisee ajoon sidotun scenario-resultin ja erillisen
worker-resultin loppuun ennen exitia; kummankin kirjoitusvirhe hylkää ajon.

`runWorkspaceSuccess.mjs` käynnistää yhden olemassa olevan Job Object
-supervisorin. W6B.2A:n 12 minuutin skenaarioraja säilyy, ja sen sisältä
varataan nykyisen V2-mallin mukaisesti 30 sekuntia cleanupiin. Paketointi ei
kuulu tähän aikaan. Kutsuja sitoo descriptorin täyteen revisioon ja SHA-256:een,
inventoi normaalin profiilin vain muistissa sekä tarkistaa exact ProductCode
-alkutilan ennen käynnistystä. ProductCode-verifier ja semanttinen uninstall
käyttävät nykyisiä rajattuja V2-adaptereita vasta varmennetun tyhjän Jobin
jälkeen. Puuttuva supervisor-result ei anna cleanup-valtuutta.

`workspaceSuccessRunFixture.mjs` kopioi varmennetut artifact-tavut itsenäisiin
tiedostoihin ja käyttää nykyistä W6B.2A-proof-rootin materialisointia.
Valmistelu ei käynnistä sovellusta eikä täytä userDataa; business-fixture
syntyy vasta source-asennuksen jälkeen nykyisen nimetyn profile-portin kautta.
Osittaisen valmistelun ja lopullisen fixture-juuren poistuminen kuuluvat
kutsujalle. Epäselvä prosessipuu, epäonnistunut semantic cleanup, jäljelle
jäänyt asennus tai muuttunut normaali profiili säilyttää yksityisen aineiston.

`workspaceSuccessProfileEvidence.mjs` lukee kuusi nimettyä checkpointia:
source, target first start, B ennen migraatiota, B:n ensimmäinen normaali
käynnistys, B:n toinen käynnistys ja paluu A:han / C:n hylkäys. Se käyttää
nykyisiä business-, SQLite-integrity-, PDF-/katalogi- ja namespace-lukijoita.
Tietokanta tarkistetaan ennen SQL-lukijan avausta ja sen muuttumattomuus
varmistetaan lukemisen jälkeen. Registry, accepted-build ja update-journal
validoidaan vain puhtailla parsereilla. Keskeneräisiä recovery-slotteja ei
korjata eikä poisteta tarkistuksen yhteydessä.

`workspaceSuccessPostcondition.mjs` lukee tallennetut checkpointit uudelleen
ja vertaa viimeistä myös nykyiseen profiiliin. A:n migraatio, B:n viivästetty
migraatio, B:n toisen käynnistyksen byte-idempotenssi, C:n muuttumattomuus,
lineage-/registry-raja ja asennustasoisen päivitysidentiteetin säilyminen
ovat erillisiä ehtoja. Rajatut lifecycle-eventit todistavat eri startup-
identiteetit ja graceful shutdownin; session-salaisuutta ei tallenneta.
Tämä ei yksin korvaa backendin session-rejection-portin packaged-todistusta;
sen erillinen muistikanavasopimus kuvataan jäljempänä.

Neljä vanhan profiiliverifierin Electron-käynnistystä poistuvat tästä uudesta
ajoketjusta: verifier käytti myös palautuvia `Store.read()`-polkuja. Nykyinen
lukuevidence ja jälkiehto korvaavat nämä tarkistukset ilman sivuvaikutuksia.
Vanhaa W6-harnessia tai tuotannon store-semanttiikkaa ei muuteta.

Kohdesarja ja consumer-komento käyttävät nykyistä
`e2e:prepare-electron-runtime`-porttia ja normaalia `e2e:build`-käännöstä ennen
testituen lataamista. Pelkkä pakettiriippuvuuksien palautus ei materialisoi
on-demand-Electron-runtimea.
Sopimustestit kattavat myös puuttuvat/ristiriitaiset tulokset, väärän ajo-
identiteetin, vaaralliset linkit ennen SQLite-avausta, epäonnistuneen cleanupin,
fixture-juuren säilyttämisen ja turvallisen tuloksen ilman raakavirheitä.
Muistikanavan ja CI-kytkennän kohdesarja läpäisi 192/192, artifact-sarja
54/54 ja proof-konfiguraation, proof-controllerin sekä session-validationin
regressiot 45/45. Edeltävän composition-checkpointin profiili-/adapterisarja
kattoi 49/49. Desktopin koko sarjassa 1493 testiä läpäisee ja kolme aiempaa
testiä on ohitettu; typecheck ja build läpäisevät. Lifecycle-jälkiehto
hylkää myös sulkemisen ilman vastaavaa
käynnistystä sekä käynnistyksestä poikkeavan sulkemisversion.
Artifactin materialisointitesti käyttää ajokomennon tavoin kanonista
väliaikaisjuurta ennen strict request -sidontaa. Windows-polun vaihtoehtoinen
kirjainkoko on oma regressionsa; polkujen turvallisuustarkistuksia ei löysennetä.
Paketoidun consumerin pysyvä komento on:

```text
pnpm --filter @eky/desktop installer:v2-workspace-success --artifact-descriptor <descriptor> --expected-descriptor-sha256 <sha256> --expected-build-revision <full-revision> --result-path <run-local-caller-result>
```

Tämä on ajokytkennän sopimuscheckpoint, ei vielä V2.6:n vaihehyväksyntä.
Seuraava portti rakentaa artifactin puhtaalta revisiolta kerran ja ajaa tämän
komennon kahdella eristetyllä Windows-consumerilla samoille tavuille.
Vanhan toteutuksen invariantteja ei poisteta ennen paketoitua näyttöä.

### Yksityinen session-rejection-todiste

Omistajan erillinen päätös sallii vain synteettisen testipaketin muistikanavan
vanhan runtime-sessionin säilyttämiseen käynnistysten välillä. Nykyinen
private proof -marker ja validoitu testijuuri pysyvät aktivoinnin ehtoina.
`w6b2PackagedProof` hyväksyy onnistumisskenaarion suljettuun control-sopimukseen
valinnaisen ajokohtaisen kanavan noncen. Tavallinen paketti ja vanha control
ilman noncea eivät avaa kanavaa; fault-controlin sopimus ei muutu.

`w6b2PackagedSessionProbe.ts` välittää mainin jo luoman sessionin, portin ja
runtime-identiteetin yhteen ajokohtaiseen Windows named pipe -kanavaan.
Yksi enintään 1024 tavun versionoitu kehys ja kuittaus validoidaan täsmällisin
avaimin. Polkuja, sessionia tai mielivaltaista HTTP-osoitetta ei oteta
rendereriltä. Kanavan nonce ei ole runtime-session. Kanava ei käytä
stdout/stderriä, levytiedostoa tai uutta HTTP-rajapintaa.

`workspaceSuccessSessionProof.mjs` omistaa vain tämän kanavan socketit ja
muistissa säilytetyt synteettiset sessionit. Se vaatii nykyiseltä sessionilta
onnistuneen vastauksen nykyiseen loopback-backendin `/customers`-lukureittiin
ja jokaiselta aiemmalta sessionilta 401-hylkäyksen. Vastauksen business-runkoa
ei lueta. Seitsemän normaalia käynnistystä tuottavat seitsemän eri sessionia
ja runtime-identiteettiä; B:n migraation relaunch-vaihe ei ole normaali startup.
Puuttuva, ylimääräinen tai väärään vaiheeseen sidottu yhteys, hyväksytty vanha
session ja uudelleenkäytetty identiteetti hylkäävät ajon.

Worker sulkee omat socketinsa ja keskeyttää keskeneräisen HTTP-lukunsa lapsen
poistuttua. Nykyinen Job-supervisor omistaa edelleen koko prosessipuun ja
määräajan. Uutta prosessien valvojaa, PID-rekisteriä, retryä tai cleanup-
aikarajaa ei lisätä. Kanavan siivousvirhe ei korvaa alkuperäistä
sovellusvirhettä. Session-viitteet vapautetaan workerin valmistuessa; sessionia tai
sen tiivistettä ei kirjoiteta tiedostoon, lokiin tai rendererille.

Riippumaton jälkiehto yhdistää turvallisen ajoon ja artifactiin sidotun
session-proofin lifecycle-eventteihin. Evidence sisältää vain vaiheen,
runtime-identiteetin ja hylättyjen aiempien sessioiden lukumäärän. Kohdetestit
kattavat oikean named pipe -kehystyksen, hylkäykset, viestirajat, puuttuvat ja
kahdentuneet yhteydet sekä keskeytyneen kyselyn siivouksen. Backendin todellinen
session-rejection todistetaan vasta kahdella paketoidulla consumerilla.

Muutos koskee testiharnessin lisäksi desktopin olemassa olevaa private proof
-koukkua ja composition-kutsua. Tuotannon sessionin luontia, HTTP-
autentikointia, business-logiikkaa tai supervisorin semantiikkaa ei muuteta.

### Build-once ja kaksi Windows-consumeria

`windows-acceptance-v2-workspace.yml` kytkee nopeiden sopimustestien jälkeen
yhden producerin ja kaksi erillistä ensimmäisen yrityksen consumeria.
Producer rakentaa source/target-parin kerran puhtaalta revisiolta ja julkaisee
vain strictin artifact-juuren. Hyväksytyt SHA-lukitut artifact-actionit
siirtävät saman immutable artifact-ID:n molemmille consumereille yhden päivän
säilytyksellä. Profiilit, yksityinen evidence ja lokit eivät kuulu artifactiin.

Consumer ei rakenna MSI:tä. Se varmistaa täyden harness-revision sekä
descriptorin ja payloadien tavut ennen yhtä skenaariota ja uudelleen sen
jälkeen, myös epäonnistuneen skenaarion jälkeen. Oma V2-kutsuja todistaa
normaalin profiilin muuttumattomuuden, tyhjän Job-puun, exact ProductCode
-siivouksen ja asennusjälkien poissaolon. Kahden consumerin sopimustulos
ei korvaa niiden varsinaista packaged-terminal-tulosta.

Uuden producer-jobin raja on 30 minuuttia ja build-stepin 22 minuuttia.
Consumer-jobin raja on 30 minuuttia ja skenaariokomennon stepin 25 minuuttia.
Nykyinen 720 sekunnin Job-raja sisältää edelleen 30 sekunnin cleanup-varauksen.
Erilliset nykyiset exact-product-kyselyt ja semanttiset poistot varaavat
enintään noin 530 sekuntia ennen ja jälkeen Jobin. Stepin loppuvara kattaa
supervisor-buildin, materialisoinnin ja jälkiehdot; jobiin jää lisäksi
asennus- ja artifactin uudelleenvarmennusvara. Sisäisiä määräaikoja tai vanhojen
jobien rajoja ei kasvateta. Ulkoinen timeout tai puuttuva terminal-result on
epäonnistuminen, ei lupa uuteen wrapperiin tai hyväksyttyyn reruniin.

Kytkennän alkuvaiheessa packaged-hyväksyntä oli avoin. Vaihe suljetaan vasta
producerin ja molempien consumerien terminal-tuloksista samalla revisiolla.

Ensimmäisen kytkentärevision `59030f5` [CI-ajo](https://github.com/eky-software/eky/actions/runs/34165035014)
rakensi ja varmisti artifactin, mutta molemmat consumerit päättyivät workerin
preflight-virheeseen ennen asennusta. Tyhjä prosessipuu, exact-products- ja
asennusjälkien poissaolo, normaali profiili sekä fixture-poisto varmistuivat.
Tämä ei ole packaged-hyväksyntä. Consumer-komennosta löytyi puuttuva nykyisen
Electron-runtimen valmistelu; se lisätään sekä pysyvään komentoon että oikean
worker-compositionin kohdesarjaan. Puuttuva runtime saa oman suljetun
`electronRuntimeUnavailable`-virheluokan. Alustuksen regressio käyttää samaa
pientä artifact-fixtureä kuin artifact-testit, lataa oikeat portit ja todistaa
tyhjän userDatan ilman MSI-asennusta tai sovelluksen käynnistystä. Fixture-
builder on erotettu yhteiseen nimettyyn testitukitiedostoon ilman behavior-
muutosta; uutta prosessi- tai cleanup-omistajaa ei lisätä.
Korjatun valmisteluketjun kohdesarja läpäisee 194/194 ja artifact-sarja 54/54;
workerin alustusrajan ja nykyisen Electron-resolverin regressiot läpäisevät
18/18. Desktopin typecheck ja build läpäisevät. Uusi packaged-kierros tarvitaan
korjatulle puhtaalle revisiolle; edellisen kierroksen epäonnistumista ei
lasketa hyväksynnäksi.

Revision `d1b37e7` [packaged-kierros](https://github.com/eky-software/eky/actions/runs/34166633384)
eteni molemmissa consumereissa source-asennuksen ja payload-jälkiehdon läpi,
mutta profiilin valmistelu epäonnistui. Molemmat ajot tuottivat terminal-
tuloksen: tyhjä prosessipuu, exact-product- ja asennusjälkien poisto,
normaalin profiilin muuttumattomuus sekä fixture-poisto varmistuivat.
Tämä kierros ei ole V2.6-hyväksyntä.

Profiilituloksen lukija säilyttää nykyisen strictin profile-protokollan
virhevaiheen suljettuna V2-virhekoodina. Lukukelvoton tai puuttuva tiedosto,
virheellinen DTO ja valmistelijan ilmoittama epäonnistuminen erotetaan.
Väärä operaatio, tuntematon vaihe tai lisäkenttä sekä ristiriita exit-koodin
ja tuloksen välillä hylätään. Raakavirhettä, polkua tai salaisuutta ei
palauteta. Prosessiomistajuus ja siivousrajat eivät muutu. Lukijakorjauksen
kohdesarja läpäisee 219/219 ja artifact-sarja 54/54; packaged-valmistelun
juurisyy ja kahden consumerin hyväksyntä ovat vielä avoinna.

Revision `6cb396b` [packaged-kierroksessa](https://github.com/eky-software/eky/actions/runs/34212971811)
molemmat consumerit säilyttivät täsmällisen `profileFixtureAFailed`-tuloksen.
Prosessipuun poissaolo, tuotteiden ja asennusjälkien siivous, normaalin
profiilin muuttumattomuus sekä fixture-poisto varmistuivat. Hyväksyntä jäi
kesken, vaikka muut V2-workflowt läpäisivät.

Consumerin ajokohtaisen testijuuren nimien pitää jättää tilaa workspace- ja
snapshot-alihakemistoille myös käyttäjäkohtaisessa Windows-Temp-juuressa.
V2.6 lyhentää vain omia väliaikaisia hakemistonimiään; production-polut,
nonce, containment, snapshotin nykyinen pituusraja ja cleanup-omistajuus
säilyvät. Käyttäytymisregressio todistaa ylipitkän polun hylkäyksen ennen
candidate-runtimen käynnistystä, ja consumerin todellisista polkuporteista
koottu regressio varmistaa korjatun rakenteen mahtumisen samaan rajaan.
Korjauksen kohdesarja läpäisee 220/220, artifact-sarja 54/54 ja profiilin
kohdetestit 12/12; desktopin typecheck ja build läpäisevät. Kahden eristetyn
packaged-consumerin on vielä vahvistettava korjaus.

Revision `aed9b7c` [packaged-kierroksessa](https://github.com/eky-software/eky/actions/runs/34215418660)
molemmat consumerit läpäisivät profiilin valmistelun. Seuraava vaihe,
`sourceHandoff`, päättyi `proofResultInvalid`-virheeseen. Molempien
terminal-tulos varmisti prosessipuun poissaolon, semanttisen siivouksen,
normaalin profiilin muuttumattomuuden ja fixture-poiston. Tämä vahvistaa
profiilivalmistelun polkukorjauksen, ei vielä koko matriisin hyväksyntää.

Myös sovelluksen proof-tuloksen lukija säilyttää nyt nykyisen strictin
success-protokollan suljetut virhekoodit. Puuttuva tai lukukelvoton tulos
erottuu virheellisestä DTO:sta. Fault-protokollaa, väärää vaihetta tai
lisäkenttiä ei hyväksytä success-tulokseksi. Kelvollinen alkuperäinen
virhekoodi säilyy myös session-kanavan sulkemisen epäonnistuessa;
onnistuminen vaatii edelleen onnistuneen prosessin, oikean proof-tuloksen
ja session-todisteen. Prosessi-, deadline- ja cleanup-vastuut eivät muutu.
Regressiot käyttävät oikeaa nykyistä proof-parseria: kohdesarja läpäisee
257/257 ja artifact-sarja 54/54; desktopin typecheck ja build läpäisevät.
Päivityksen luovutuksen täsmällinen epäonnistuminen ja koko
packaged-hyväksyntä ovat vielä avoinna.

Revision `d4251fb` [packaged-kierroksen](https://github.com/eky-software/eky/actions/runs/34217489091)
molemmat consumerit säilyttivät alkuperäisen
`W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED`-virheen.
SQLite-kopion kohdepolun pitää jättää tilaa myös journal-sivutiedostolle;
pelkän tietokantapolun mahtuminen Windows-rajaan ei riitä. Consumerin
väliaikaisia nimiä tiivistetään tämän varauksen vuoksi. Snapshot-adapteria,
tuotantopolkuja tai SQLiten asetuksia ei muuteta. Regressio käyttää samaa
nykyistä backendin SQLite-ajuria ja consumerin todellisia polkuportteja:
kopiointi ja integrity-tarkistus onnistuvat, mutta journal-varauksen
ylittävä synteettinen kohde hylätään. Paketoidun päivitysketjun hyväksyntä
edellyttää edelleen kahta ensimmäisen yrityksen consumeria.
Korjauksen kohdesarja läpäisee 258/258 ja artifact-sarja 54/54;
desktopin typecheck ja build läpäisevät.

### Mainin käynnistystapahtuman kytkentä

Revision `360c0c2` [packaged-kierroksessa](https://github.com/eky-software/eky/actions/runs/34219525063)
molemmat workerit suorittivat kaikki success-vaiheet, mutta riippumaton
jälkiehto hylkäsi puuttuvan käynnistystodisteen. V2.6:n private proof -haara
palasi ennen tavallisen main-polun `desktop.started`-kirjausta.

`desktopStartupCompletion` käyttää nykyistä tapahtumatehdasta, loggeria ja
runtime-identiteettiä. Main kutsuu sitä vasta olemassa olevien profiili-,
backend- ja update-tarkistusten jälkeen. Vain validoidun success-controlin
session-kanavalla varmennettu V2.6-käynnistys saa tapahtuman ennen controllerin
mahdollista shutdownia tai handoffia. Puuttuva controller tai epäonnistunut
session-varmennus ei tuota onnistumista. Tavallinen käynnistys säilyttää yhden
tapahtuman alkuperäisessä kohdassaan; smoke-, fault- ja migraatiopolkuja ei
laajenneta. Loggerin kirjoitus- tai failure-politiikka ei muutu.

Kytkentäregressio todistaa tapahtumajärjestyksen, virhepolun ja tavallisen
käynnistyksen yhden tapahtuman. Nykyinen seitsemän sessionin kanavatesti
käyttää samaa mainin tuottajaa oletettujen lifecycle-eventtien sijaan.
Jälkiehto hylkää edelleen puuttuvan, ylimääräisen ja väärän runtimen
tapahtuman. Kohdesarja on 258/258, artifact-sarja 54/54 ja desktopin
typecheck/build läpäisevät. Muuttunut paketoitu main vaatii uuden puhtaan
revision build-once-artifactin ja kaksi ensimmäisen yrityksen consumeria;
aiemman MSI-parin näyttö ei hyväksy tätä muutosta.

Revision `19cc970` [uudessa packaged-kierroksessa](https://github.com/eky-software/eky/actions/runs/34225413235)
molemmat workerit suorittivat success-ketjun, mutta riippumaton semanttinen
jälkiehto hylkäsi aineiston. Supervisor vahvisti prosessipuun poistumisen,
ja erilliset uninstall- ja footprint-tarkistukset läpäisivät. Vaihe ei ole
vielä hyväksytty. CI:n checkout- ja artifact-revisio oli
`f64cb46032346dcd7f77bfcfcb309aa0cd76d6e5`, ei PR:n lähde-HEAD.

Nykyinen jälkitarkastin säilyttää jatkossa suljetun hylkäyssyyn myös oman
ulkoreunansa ja callerin virherajan läpi. Rekisteri, hyväksytty build,
päivitysjournal, business-sisältö, migraatio, uudelleenkäynnistyksen
idempotenssi, lifecycle, session-todiste ja muuttunut lopputila erotetaan
ilman yksityisen aineiston tulostamista. Tuntematon virhe pysyy yleisenä
hylkäyksenä. Nykyiset negatiiviset käyttäytymistestit vaativat täsmällisen
syyn; alkuperäinen virhe säilyy myös siivouksen epäonnistuessa. Vertailuja,
hyväksymisehtoja tai prosessi- ja siivousvastuita ei muuteta.

Revision `a34d616` [sopimusportti](https://github.com/eky-software/eky/actions/runs/34228423878)
keskeytti packaged-vaiheen ennen produceria: MSI-aktiivisuuden read-only
kysely ei valmistunut rajassaan (261/262). Prosessin poistuminen varmistui.
Kyselytesti vaatii nyt samassa assertiossa myös nykyisen adapterin tarkan
`resultCode`-arvon; alkuperäinen timeout- tai käynnistysvirhe ei saa peittyä
yleisen `status`-vertailun alle. Kysely, aikarajat ja siivous eivät muutu.
Tämä on raportointikorjaus, ei osoitus ajoitusvirheen juurisyystä tai sen
ratkeamisesta. Kyseinen kierros ei ole V2.6:n packaged-hyväksyntä.

Tuottajan ja oikean tiedostologgerin yhdistävä regressio paljasti erillisen
lukupolkuvirheen: lifecycle-lukija odottaa `runtime/logs/desktop`-kansiota,
mutta V2.6:n profile-evidence antoi sille `runtime/logs`-juuren. Lukija ei
siis nähnyt mainin kirjoittamia tapahtumia. Korjaus kohdistaa nykyisen
lukijan oikeaan streamiin, kuten legacy-adapteri jo tekee. Se ei laajenna
hakua, kirjoita tapahtumia verifierissä tai löysennä puuttuvan tapahtuman
hylkäystä. Regressio käyttää mainin nykyistä tuottajaa, oikeaa loggeria ja
muuttamatonta lukijaa; se varmistaa myös read-only-inventaarion säilymisen.
Nykyinen kanonisen hakemiston tarkistin varmistaa streamin koko polun ennen
lukemista. Myös emohakemiston junction hylätään, eikä alikansioon siirtyminen
ohita aiempaa linkkien torjuntaa. Sama regressio kattaa tämän hylkäyksen.
Ennen korjausta kohde epäonnistuu, korjattuna tapahtuma-, jälkiehto- ja
session-kohdesarja läpäisee 71/71. Packaged-todennus vaaditaan edelleen.

### Varmennettu packaged-checkpoint

Lähde-HEAD `6479178bf2e697f161626f14ed42f0640e62b30a` läpäisi
[V2.6-portin](https://github.com/eky-software/eky/actions/runs/34231575496),
[supervisor-portin](https://github.com/eky-software/eky/actions/runs/34231575523),
[clean lifecycle -portin](https://github.com/eky-software/eky/actions/runs/34231575561)
ja [upgrade/rollback-portin](https://github.com/eky-software/eky/actions/runs/34231575699).
Kaikki 12 jobia valmistuivat ensimmäisellä yrityksellä, ilman rerunia.
CI:n todellinen checkout ja artifactin build-identiteetti olivat
`a7761033ef37e3b9536d651bae3d155cd98dbb6d`, eivät lähde-HEAD.

Yksi producer rakensi synteettisen `0.2.7 -> 0.2.8`-parin. Molemmat
eristetyt consumerit varmistivat samat tavut ennen ajoa ja sen jälkeen:

| CI-artifact | SHA-256 |
| --- | --- |
| Descriptor | `6c5da423dec8b60dcca5585c493341ca5cf60f5b548ac76c655db21891116b7d` |
| Source MSI | `877d96c351b7a15a1a0a6d6c43b28a6dfd6c6ef1219046bfdf487ab6364d2c9b` |
| Target MSI | `1fad6aaef6d5ae75b6a3647d7e31193ea5b0acca6815a7425ba33509c545148d` |

Molempien strict terminal oli `workspaceSuccessCompleted` ja riippumaton
jälkiehto `workspaceSemanticProofValidated`. Tämä kattaa myös seitsemän
eri runtime-sessionin todellisen HTTP-hylkäystodisteen ja sen sidonnan
mainin lifecycle-tapahtumiin. Prosessipuu oli poissa, semantic cleanup
valmistui, exact ProductCodet ja asennusjäljet poistuivat, normaali profiili
säilyi muuttumattomana ja fixture poistettiin. Omistettuja orpoprosesseja 0.
Näitä erillisiä tuloksia ei korvata pelkällä workerin onnistumisella.

Tämän jälkeen tehty streamin kanonisen emopolun tarkennus `d8ff11c` säilyttää
samat hyväksymisehdot. Sen kohdesarja on 71/71, V2.6-sopimussarja 263/263 ja
artifact-sarja 54/54; desktopin typecheck/build läpäisevät. Seuraava push
varmennetaan uudella producerilla ja kahdella consumerilla, ei yllä olevan
artifactin tavuilla. Yllä oleva näyttö säilyy oman täsmärevisionsa näyttönä.
Tämä vaihekohtainen checkpoint ei hyväksy koko V2:ta, vanhan harnessin
poistamista, päähaaraan käyttöönottoa tai käyttäjälle jaettavaa julkaisua.

### W6B.2A-invarianttien siirtokartta

| Vanhan portin invariantti | V2.6-vastine / rajattu jatkotyö | Varmennettu näyttö yllä olevassa checkpointissa |
| --- | --- | --- |
| Sama source/target-revisio, erilliset MSI-versiot ja muuttumattomat tavut | Strict artifact descriptor, materialisointi ja read-only verifier; producer ja molempien consumerien ennen/jälkeen-varmennus | Sopimukset ja packaged 2/2 |
| Source/target MSI ProductCode, install-root, rekisteröinti ja payload | Nykyinen V2 exact-product/postcondition-adapteri ja molempien descriptor-payload-inventaarioiden vertailu | Sopimukset ja packaged 2/2 |
| A/B/C:n yritys, asiakas, hyväksytty lasku ja authoritative PDF/katalogi | Nykyiset fixture- ja evidence-portit sekä read-only `workspaceSuccessPostcondition` | Sopimukset ja packaged 2/2 |
| Main-owned sourceHandoff ja hyväksytty target first-start | Nykyisen `w6b2PackagedProofController`-portin käyttö ilman rinnakkaista update-moottoria | Packaged 2/2 |
| Aktiivinen A migroidaan ensin ja target hyväksytään vasta readinessin jälkeen | A:n migration-, accepted-build-, journal- ja business-jälkiehdot | Sopimukset ja packaged 2/2 |
| Passiivinen B pysyy byte-identtisenä aktivointiin asti; migraatio vain aktivoinnissa; seuraava käynnistys idempotentti | Kuusi erillistä read-only-checkpointia ja niiden vertailu | Sopimukset ja packaged 2/2 |
| C:n ehjä SQLite mutta invalidHistory estää aktivoinnin; A ja C pysyvät muuttumattomina | C:n strict recoveryRequired-todiste, active pointer sekä database/PDF-katalogin ja business-sisällön jatkuvuus | Sopimukset ja packaged 2/2 |
| Secret-, archive- ja recovery-namespacejen eristys, installation-state ei vaihdu työtilan mukana | Yksityinen read-only-evidence ja exact installation-journal; ei raakasisältöä julkiseen resultiin | Sopimukset ja packaged 2/2 |
| Uusi runtime-session, vanhan sessionin hylkäys ja vanhan runtimen poistuminen | Yksityinen muistikanava, nykyisen backendin session-rejection sekä riippumaton lifecycle- ja supervisor-todiste | Sopimukset ja packaged 2/2 |
| Normaali profiili muuttumaton ja tarkka ProductCode-cleanup | Muistissa tehtävä read-only inventaario, erillinen semantic cleanup ja postcondition verifier vasta varmennetun prosessipuun poistumisen jälkeen | Virherajaregressiot ja packaged 2/2 |
| Alkuperäinen virhe ei katoa cleanupin alle; tuntematon tila hylätään | Erilliset process-, worker-, scenario-, semantic-cleanup-, postcondition- ja fixture-cleanup-tulokset nykyisellä V2-mallilla | Käyttäytymisregressiot; fault/rollback-matriisi kuuluu V2.7:ään |

Siirtokartta ei vielä valtuuta vanhan W6B.2A-koodin tai testien poistamista.
Poisto kuuluu myöhempään hallittuun cutoveriin vasta vastaavan käyttäytymisen
ja virhepolkujen todistamisen jälkeen. V2.7:n fault/rollback-skenaarioita ei
aloiteta tämän checkpointin mukana.

## V2.7: fault/rollback-vaiheketjujen checkpoint

V2.7 jatkuu omassa pinotussa haarassa
`codex/test-harness-v2-workspace-fault-rollback`. Lähtökohta on V2.6:n
`2f2118e9a2c5a45cd37d0655e4fa38620a5836b9`, jonka
[workspace-vaiheajo](https://github.com/eky-software/eky/actions/runs/34233531762)
läpäisi sopimukset, producerin ja molemmat consumerit ensimmäisellä
yrityksellä. Tämä korvaa yllä olevan aiemman V2.6-checkpointin avoimen
final-revision portin, mutta ei siirrä sen artifact-näyttöä V2.7:ään.

Ensimmäinen V2.7-checkpoint omistaa vain versionoidun request/result-rajan
ja viiden olemassa olevan fault-polun vaiheketjut. Se ei käynnistä uutta
prosessivalvojaa, rakenna artifactia tai toteuta sovelluksen päivitysmoottoria.
Request sitoo skenaarion, ajokohtaisen noncen, descriptor-tiivisteen ja
build-revision. Tulos hyväksyy vain oman skenaarionsa täsmällisen
vaiheprefixin; tuntematon tila, vieras tulos ja ylimääräiset kentät hylätään.

| Vastuu | Nykyinen omistaja |
| --- | --- |
| Viisi sallittua fault-skenaariota, vaiheprefixit ja turvallinen tulos | `workspaceFaultContracts.mjs` |
| Nykyisten main-owned proof-kutsujen järjestys | `workspaceFaultLifecycle.mjs` |
| Exact source/target -asennustilan lukuassertio | `workspaceInstalledState.mjs`, siirretty V2.6-ketjusta muuttumattomana molempien käyttöön |
| Windows-asennustilan havainnointi ja yksityiset proof-käynnistykset | `workspaceSuccessWindowsRuntime.mjs`: sama adapteri nimettyjen success/fault-factoryjen kautta |
| Worker-porttien kokoaminen | `workspaceWorkerRuntime.mjs`, success/fault-factoryt saman Windows-adapterin päälle |
| Työn rajaus ja prosessipuun cleanup | Nykyinen Job Object -supervisor, yhteinen caller `runWorkspaceSuccess.mjs`:n success/fault-entrypointeille |
| Riippumaton business-jälkitarkastus | `workspaceFaultProfileEvidence.mjs` ja `workspaceFaultPostcondition.mjs`, jaettu vain lukeva snapshot-raja |
| Asennuksen poisto ja sen jälkiehdot | Nykyiset exact ProductCode -portit ja yhteinen `workspaceSuccessFailureBoundary.mjs`:n terminal-raja |

### W6B.2B-invarianttien siirtokartta

| Olemassa oleva fault-sopimus | V2.7:n vaiheketjun loppuehto | Packaged-todiste |
| --- | --- | --- |
| preUpdate-palautuspiste epäonnistuu ennen handoffia | Ei target-asennusta; source säilyy; `verifyPreUpdateFailure` | 2/2, nykytilassa nimetty `b593614` / `9436d2f` -kierros |
| Aktiivisen A:n first start epäonnistuu | Business rollback ennen source-binaarien palautumisen tarkistusta ja `rollbackFirstStart`-käynnistystä; `verifyActiveRollback` | 2/2, sama kierros |
| Registry-siirtymän jälkeinen hyväksyntä katkeaa | Täsmällinen `interrupted`-todiste, recovery ja erillinen restart; `verifyAcceptanceRecovery` | 2/2, sama kierros |
| Passiivisen B:n migraatio epäonnistuu | Paluu A:han ilman binary rollbackia; target säilyy; `verifyPassiveRecovery` | 2/2, sama kierros |
| Binary rollback epäonnistuu | Ei uutta yritystä tai source-käynnistystä; target jää recovery-only-tilaan; `verifyBinaryFailedSafe` | 2/2, sama kierros |

Taulukko nimeää toteutuneen packaged-näytön revision, ei siirrä sen
hyväksyntää myöhempään koodimuutokseen. Alla oleva loppukatselmus erottaa
tästä yhteisen tilalukijan korjauksen ja sen oman hyväksyntärajan.

Vaiheketju kutsuu vain nykyisen sovelluksen yksityisiä fault-kytkentöjä.
Worker saa asentaa sourcen kerran. Päivityksen ja binary rollbackin
MSI-käynnistykset kuuluvat edelleen Electron mainin omistamalle handoffille;
worker odottaa havaittua asennustilaa, ei käynnistä samaa MSI:tä uudelleen.
Odottamaton prosessivirhe ei korvaa odotetun keskeytyksen proof-tulosta.
Edistymistulosteen virhe ei muuta vaiheketjun tulosta.

Rajattu sopimuskomento on
`pnpm --filter @eky/desktop installer:test:windows-acceptance-workspace-fault`.
Ensimmäisessä vaiheketju-checkpointissa sarja läpäisi 52/52. Yhteisen tarkistuksen regressioina V2.6-sarja läpäisee
263/263 ja artifact-sarja 54/54; desktopin typecheck/build läpäisevät.
Komento testaa vaiheketjut injektoiduilla porteilla, ei aja MSI:tä. Siksi sen
vihreys ei todista tietokantojen säilymistä, oikeaa rollbackia tai
prosessi-/semantic-cleanupin onnistumista. Nämä jäävät erillisiksi
paketoidun hyväksynnän jälkiehdoiksi.

Seuraava checkpoint kytkee ketjut jaetun Windows-adapterin kautta yhden
supervisorin workeriin sekä riippumattomaan, vain lukevaan jälkitarkastukseen.
Hyväksyntä käyttää yhtä puhtaasta revisiosta rakennettua source/target-paria
ja kahta ensimmäisen yrityksen Windows-consumeria, kumpikin kaikki viisi
skenaariota. Yhteiset V2.6-portit ajetaan muuttuneiden vastuiden regressioina.
Ei aikarajamuutosta, tuotantosemantiikan muutosta, versionostoa, pilotia tai
vanhan W6-harnessin poistoa tässä checkpointissa.

### V2.7:n rajattu istuntokanavapäätös

Omistaja hyväksyi nykyisen yksityisen muistikanavan käytön vain seuraavissa
format-2-proofin terveissä käynnistysvaiheissa. Taulukon järjestys on samalla
kanavan suljettu vaihejärjestys; sitä ei anneta CLI:stä tai ympäristöstä.

| Skenaario | Muistikanavan sallitut vaiheet |
| --- | --- |
| `preUpdateRecoveryPointFailure` | `sourceHandoff` |
| `activeWorkspaceFirstStartFailure` | `sourceHandoff`, `rollbackFirstStart` |
| `acceptanceInterruption` | `sourceHandoff`, `targetAcceptanceRestart` |
| `passiveWorkspaceMigrationFailure` | `sourceHandoff`, `targetFirstStart`, `switchToB`, `passiveWorkspaceRecovery` |
| `binaryRollbackFailure` | `sourceHandoff` |

Yksi sallittujen vaiheiden määrittely on nykyisessä
`w6b2PackagedProof.ts`-vastuussa. Paketin yksityinen marker, bootstrap,
source/target-rooli, exact control keys ja ajokohtainen nonce validoidaan
ennen kanavan avaamista. Mainin nykyinen käynnistyskytkentä vaatii
istuntotarkistuksen ennen proof-controlleria. Hylkäys säilyy virheenä eikä
käynnistä controllerin sivuvaikutuksia. Vanha format-2-kontrolli ilman
noncea säilyttää nykyisen käyttäytymisensä.

`workspaceSuccessSessionProof.mjs` käyttää yhtä muistikanavan toteutusta
kahden nimetyn success/fault-factoryn kautta. Salaisuus pysyy mainin ja
workerin muistissa. Uudelta terveeltä backendiltä vaaditaan nykyiselle
istunnolle HTTP 200 ja jokaiselle saman ajon aiemmalle istunnolle HTTP 401.
Puuttuva yhteys ei ole fault-kanavassa ohitettavissa. Kanava omistaa vain
omat socketit ja HTTP-pyynnöt, ei prosessipuuta tai uutta aikarajaa.

Fault injection-, keskeytys- ja recovery-only-vaiheet eivät saa noncea.
Myös `targetAcceptanceRecovery` jää ulkopuolelle: sen jälkeinen erillinen
`targetAcceptanceRestart` todistaa terveen istunnon. `desktop.started`
pysyy vain aiemmin hyväksytyn V2.6 format-1-success-kytkennän tapahtumana;
sitä ei yleistetä fault-poluille. Tavallisen sovelluksen istunnonluonti,
HTTP-valtuutus, lokituspolitiikka ja prosessiomistus eivät muutu.

Rajauksen kohdetestit läpäisevät 26/26 ja fault-sopimuskomento 60/60.
Kanavan käyttäytymistä testataan oikeilla muistikanava- ja loopback-HTTP-
yhteyksillä, mutta synteettisellä HTTP-sopimuspäätepisteellä. Tämä ei vielä
korvaa paketoidun sovelluksen backendin HTTP-hylkäystodistetta. V2.6:n
263/263, artifact-sarjan 54/54 sekä desktopin typecheck/build säilyvät
regressioportteina.

Yhden terveen käynnistyksen skenaariot eivät väitä todistavansa vanhan
istunnon HTTP-hylkäystä olemattomalta toiselta backendiltä. Niiden
prosessipuun poistuminen, source-/recovery-only-lopputila ja semanttinen
jälkitarkastus ovat erillisiä paketoidun hyväksynnän vaatimuksia.
Tämän istuntokanava-checkpointin jälkeinen worker-kytkentä ja riippumaton
jälkitarkastus kuvataan alla. Uuden artifactin producer/kaksi consumeria
ovat edelleen avoinna.

### V2.7:n Windows-adapterin checkpoint

`createWorkspaceFaultWindowsRuntime` käyttää nykyisen V2.6-adapterin
source-asennusta, payload-varmennusta, yksityistä profiilin valmistelua ja
MSI-tilalukijaa. `createWorkspaceSuccessWindowsRuntime` säilyttää oman
format-1-sopimuksensa; siihen ei voi antaa fault-requestia. Kummallakaan
ei ole omaa prosessipuun valvontaa tai emergency-cleanupia.

Fault-profiilin valmistelu käyttää nykyisen valmisteluentrypointin
vaatimaa source/format-1-kontrollia. Format-2-fault-kontrolli asetetaan vasta
nimettyyn sovelluksen proof-käynnistykseen nykyisellä yksityisellä
phase-writerilla. Vain hyväksytty terve vaihe saa muistikanavan noncen.
Vieras skenaario, vaihe, formaatti tai tuntematon tuloskenttä hylätään.
Odotettu `interrupted` vaatii sekä sovelluksen oman strict proof-tuloksen
että onnistuneen prosessipoistumisen; tavallinen kaatuminen ei riitä.
Istuntokanavan siivous ei peitä alkuperäistä sovellusvirhettä.

Target-asennus ja palautettu source havaitaan yhdellä nykyisellä
asennustilan odotusvastuulla. Adapteri ei aja päivitystä tai rollback-MSI:tä
uudelleen. Tuntematon rooli tai poistuneen installerin väärä lopputila
päättyy virheeseen. Varsinainen deadline ja puun cleanup kuuluvat edelleen
yhdelle supervisorille, asennuksen poisto erilliselle semantic cleanupille.

Kohdetestit läpäisevät 125/125. Kanoninen fault-sopimussarja läpäisee
161/161, jaetun runtime-vastuun sisältävä success-regressiosarja 277/277 ja
artifact-sarja 54/54; desktopin typecheck/build läpäisevät. Windows-kutsut
ovat tässä adapteritestissä injektoituja. Tämä ei ole MSI- tai V2.7-
packaged-hyväksyntä; worker, riippumaton jälkitarkastus ja kaksi täydellistä
viiden skenaarion consumeria ovat edelleen seuraavat portit.

### V2.7:n worker- ja jälkitarkastuscheckpoint

`runWorkspaceFaultWorker.mjs` sitoo yhden sallitun fault-skenaarion
requestiin ja julkaisee erikseen strict scenario-resultin sekä nykyisen
supervisorin worker-resultin. Molempien kirjoitusten on onnistuttava ennen
onnistunutta poistumista. Väärä vaiheprefixi, puuttuva tulos tai
julkaisun epäonnistuminen ei tuota onnistumista. Worker ei rakenna paketteja,
valvo prosessipuuta tai omista asennuksen emergency-cleanupia.

`workspaceWorkerRuntime.mjs` kokoaa success- ja fault-workerien yhteiset
Windows-portit. Se korvaa aiemmin success-workerissa olleen kokoamiskoodin;
rinnakkaista Windows-runtimea ei kopioida fault-workerille. Istuntosalaisuudet
vapautetaan muistista myös kytkennän tai skenaarion epäonnistuessa.

Yksi `captureWorkspaceProfileSnapshot` lukee molempien vaiheiden profiilit.
Se säilyttää kanoniset polut, regular-file-/single-link-rajat, ennen
SQLite-avausta tehtävän varmennuksen sekä keskeneräisten metadata-slotien
hylkäyksen ilman niiden korjaamista. Fault-checkpoint sitoo vain
`sourceBaseline`- ja `faultTerminal`-tilat, skenaarion, ajon ja artifactin.
Se ei keksi fault-poluille `desktop.started`-tapahtumia.

`workspaceFaultPostcondition.mjs` käyttää olemassa olevan fault-profiilin
puhtaita assertioita sekä descriptorin täsmällisiä package-identiteettejä.
Se tarkistaa business-/PDF-/katalogijatkuvuuden, odotetut SQLite-muutokset,
registry-/lineage-tilan, accepted-buildin ja journalin. Lopuksi nykytila
luetaan uudelleen: tallennettu checkpoint ei yksin riitä todisteeksi.
Istuntokanavan turvallinen aineisto validoidaan erikseen
`workspaceFaultSessionEvidence.mjs`-vastuussa. Vain terveiden käynnistysten
suljettu järjestys, erilliset runtime-tunnisteet ja aiempien istuntojen
hylkäysmäärät sallitaan; salaisuuksia, portteja tai tapahtumalokeja ei
kirjoiteta tähän aineistoon.

Kanoninen fault-sopimussarja läpäisee 240/240, yhteisten vastuiden
success-regressiosarja 282/282 ja artifact-sarja 54/54. Desktopin
typecheck/build läpäisevät. Mukana ovat workerin todellisen compositionin
sivuvaikutukseton kytkentä, virheellisen evidenssin hylkäykset ja yhteisen
lukijan linkki-/slot-/muutosregressiot. Nämä eivät ole MSI-hyväksyntäajoja.

Seuraava portti kytkee nykyiseen caller-/terminal-rajaan workerin,
riippumattomat business- ja session-tulokset, exact ProductCode -siivouksen
ja footprint-/fixture-jälkiehdot. Sen jälkeen yksi uusi build-once-pari
ja kaksi ensimmäisen yrityksen Windows-consumeria todistavat kaikki viisi
skenaariota samoilla tavuilla. V2.7:n hyväksyntä on edelleen kesken.

### V2.7:n caller- ja terminal-checkpoint

`runWorkspaceFault.mjs` on nimetty CLI-entrypoint nykyiseen yhteiseen
workspace-calleriin, ei uusi prosessivalvoja. Se hyväksyy vain nykyisen
immutable descriptorin polun, odotetun SHA-256:n, täydellisen build-revision
ja yhden viidestä sallitusta `--fault-scenario`-arvosta. Worker ja sen
työhakemisto johdetaan tästä validoidusta sopimuksesta. Yksi nykyinen Job
Object omistaa edelleen skenaarion 720 sekunnin rajan, josta 30 sekuntia
on varattu cleanupille. Vanhat timeoutit tai prosessiomistajat eivät muutu.

`workspaceSuccessFailureBoundary.mjs` käsittelee molempien nimettyjen
vaiheiden terminal-tulokset saman cleanup-rajan kautta. Fault-suunnitelma
määrää, pitääkö asennettuna olla source vai target. Scenario-result,
supervisorin process-/worker-/cleanup-tulos, business-jälkiehto ja
`sessionProofResultCode` pysyvät erillisinä. Business- ja istuntotarkastuksen
epäonnistuessa molemmat kirjataan, mutta jälkimmäinen ei korvaa ensimmäistä
virhettä. Semantic cleanup ei muuta alkuperäistä virhettä onnistumiseksi.

Puuttuva supervisor-tulos tai varmistamaton prosessipuu estää MSI-siivoamisen.
Puuttuva scenario-result ei valtuuta poistamaan ennestään asennettua tuotetta:
siivous vaatii ennen ajoa todistetun exact-products-absence-tilan ja nykyisen
rajatun ProductCode-tarkistuksen. Testijuuri poistetaan vasta, kun puun
poissaolo, semantic cleanup, tuotteiden poissaolo ja installer-footprint
on varmennettu. Muuten yksityinen aineisto säilyy vain paikallisessa
testijuuressa. Normaalin profiilin inventaario jää prosessimuistiin.

Yhden skenaarion dokumentoitu komento on:

```text
pnpm --filter @eky/desktop installer:v2-workspace-fault --artifact-descriptor <descriptor> --expected-descriptor-sha256 <sha256> --expected-build-revision <revision> --fault-scenario <scenario> --result-path <run-local-caller-result>
```

Komentotason kohdetestit läpäisevät 77/77. Kanoninen fault-sarja läpäisee
289/289, yhteinen success-regressiosarja 298/298 ja artifact-sarja 54/54;
desktopin typecheck/build läpäisevät. Asennus-/prosessikutsut ovat näissä
sopimustesteissä injektoituja. Uusi producer sekä molemmat kaikki viisi
skenaariota ajavat Windows-consumerit ovat vielä avoin hyväksyntäportti.

### V2.7:n CI-kytkentä

Nykyinen workspace-workflow ajaa ennen produceria sekä V2.6:n että V2.7:n
sopimukset. Sama producer rakentaa yhden source/target-parin. Kahden
success-consumerin lisäksi kaksi eristettyä fault-consumeria lataa saman
artifact-ID:n ja tarkistaa descriptorin SHA-256:n sekä todellisen
checkout-revision ennen ajoa. Workerit tai consumerit eivät rakenna MSI:tä.

Jokainen fault-consumer valmistelee nykyisen supervisorin ja proof-lukijat
kerran ja ajaa viisi nimettyä skenaariota järjestyksessä, kukin omalla
synteettisellä profiililla. Ensimmäinen virhe estää myöhemmät skenaariot.
Artifact tarkistetaan uudelleen myös epäonnistumisen jälkeen. Uusinta ei
korvaa ensimmäisen yrityksen hyväksyntää. Raakoja profiileja, lokeja tai
istuntoaineistoa ei julkaista artifacteina.

Yksittäisen skenaarion 720 sekunnin Job-raja ja siihen kuuluva 30 sekunnin
cleanup-varaus säilyvät. Myös consumer-stepin ulompi 25 minuutin varaus on
sama kuin success-ajossa. Uuden viisi skenaariota ajavan jobin varaus on
140 minuuttia: viisi 25 minuutin step-varaa sekä 15 minuuttia valmistelulle
ja uudelleenvarmennukselle. Tämä on vaiheiden yhteenlaskettu scheduler-raja,
ei skenaarion aikarajan nosto, uusi watchdog tai hyväksyntätodiste.
Aiemman success-jobin rajoja ei muuteta. Ulomman rajan katkaisema ajo
ilman omaa terminal-tulosta pysyy hylättynä.

Artifact-/workflow-sopimukset läpäisevät 56/56. Varsinainen V2.7-hyväksyntä
odottaa tämän kytkennän puhdasta lähderevisiota, uutta produceria ja
molempien consumerien viittä onnistunutta terminal-tulosta.

Ensimmäinen [V2.7:n CI-kierros](https://github.com/eky-software/eky/actions/runs/34245778412)
hylättiin fault-sopimuksissa ennen produceria (288/289); consumerit jäivät
ajamatta. Fault-requestin JSON-testifixture käytti kanonisoimatonta
TEMP-juurta. Fixture noudattaa nyt muiden vastaavien testien `realpath`-
valmistelua. Rajattu junction-regressio todistaa samalla, että lukija yhä
hylkää aliaksen ja hyväksyy saman tiedoston kanonisen polun. Kohdesarja
läpäisee 26/26. Lukijan turvallisuusrajaa, timeoutia tai supervisorin
omistajuutta ei muuteta. [Korjausrevision CI](https://github.com/eky-software/eky/actions/runs/34247574179)
läpäisi sopimusportin, producerin ja molemmat success-consumerit.

Saman kierroksen fault-consumerit läpäisivät pre-update-palautuspisteen
virhetilanteen, mutta hylkäsivät aktiivisen workspacen rollbackin vaiheessa
`sourceRollbackInstall`. Molemmat tuottivat oman virhetuloksen,
`processTreeAbsent: true`, `semanticCleanupCompleted`, `exactProductsAbsent`
ja `businessDataPreserved: true`. V2.7 ei ole tämän perusteella hyväksytty.

Rajattu havainnointikorjaus säilyttää nykyisen Windows-adapterin ja sen yhden
supervisorin rajan. MSI-inaktiviteetti ei yksin todista binääripalautuksen
valmistumista: palautusapuri voi vielä käynnistyä tai olla uninstall- ja
install-komentojen välissä. Source-rollback lukee apurin jo tuottaman
rajatun JSONL-sopimuksen nykyisellä V2.4-lukijalla. Vasta oikean terminal-
tuloksen jälkeen tarkistetaan MSI-inaktiviteetti ja exact ProductCodet.
Epäonnistuneen rollbackin mahdollinen repair saa päättyä ennen virhetulosta;
repair ei muuta epäonnistumista onnistumiseksi. Puuttuva tulos jää nykyisen
supervisorin deadlinen piiriin, ristiriitainen tai taaksepäin muuttuva
evidence hylätään. Uutta prosessi-, cleanup- tai timeout-omistajaa ei lisätä.

Kohderegressiot kattavat viivästyneen apurin, komentojen väliset tyhjät
MSI-havainnot, puuttuvan tuloksen, korruptoituvan evidence-prefixin,
hardlink-hylkäyksen sekä epäonnistuneen palautuksen jälkeisen repairin.
Niiden ja nykyisten lifecycle/failure-boundary-sopimusten kohdesarja
läpäisee 148/148. Korjaus tarvitsee uuden puhtaan revision packaged-
hyväksynnän; tuotannon rollback-apuria tai toimintasemantiikkaa ei muuteta.
Korjauksen fault-sopimukset läpäisevät 295/295, success-regressiot 303/303,
artifact-/workflow-sopimukset 56/56 sekä desktop typecheck ja build.

### Artifact-latauksen rajattu korjaus

Revision `1f5b807` [workspace-kierros](https://github.com/eky-software/eky/actions/runs/34250816513)
todisti fault-matriisin 10/10 ensimmäisellä yrityksellä. Toinen success-
consumer pysähtyi ennen skenaariota artifact-palvelun HTTP 403 -virheeseen.
Omistajan erikseen hyväksymä infrastruktuuriuusinta ajoi vain tämän
consumerin samoilla alkuperäisillä pakettitavuilla. Se läpäisi; success-
näyttö on 2/2 tällä nimenomaisella poikkeuksella. Produceria ei rakennettu
uudelleen. Molempien kierrosten alkuperäiset tulokset säilyvät erillisinä.

Saman revision [upgrade-kierroksen](https://github.com/eky-software/eky/actions/runs/34250816532)
molemmat consumerit pysähtyivät myös lataukseen ennen skenaariota. Niitä ei
uusittu, koska latausnimi johdettiin consumerin `github.run_attempt`-arvosta:
consumer-only-uusinta etsisi eri nimeä kuin säilytetty producer-artifact.
Tämä on erillinen viittausvirhe, ei osoitettu syy alkuperäiseen HTTP 403:een.

Hyväksytty rajattu korjaus välittää upload-stepin `artifact-id`-tuloksen
producerin job-outputiksi ja valitsee sen consumerin `artifact-ids`-syötteessä,
kuten workspace-workflow jo tekee. Consumer ei johda latausvalintaa nimestä,
yritysnumerosta tai pattern-hausta. Paketin sisältö puretaan samaan nykyiseen
juureen; descriptor-, build-revisio- ja MSI-tarkistukset ennen ajoa ja sen
jälkeen säilyvät. Nykyinen workflow-sopimustesti lukitsee tämän kytkennän.
Uusia action-versioita, käyttöoikeuksia, aikarajoja tai automaattisia
uusintoja ei lisätä. Korjaus ei itsessään anna lupaa epäonnistuneen testin
uusintaan eikä muuta ensimmäisen yrityksen hyväksyntäsääntöä.

Uusi kytkentäregressio hylkäsi vanhan toteutuksen ja läpäisi korjauksen.
Upgrade-artifactin kohdesarja läpäisee 14/14, workspace-artifactin 56/56
sekä desktop typecheck ja build. Nämä eivät korvaa paketoitua CI-todistetta.

Revision `0a7ea0115cfd7c804694b64134cba8478c76a740` uusi commit-pohjainen
kierros läpäisi kaikki 14 jobia ensimmäisellä yrityksellä:
[workspace success 2/2 ja fault 10/10](https://github.com/eky-software/eky/actions/runs/34257928868),
[upgrade/rollback 2/2](https://github.com/eky-software/eky/actions/runs/34257928869),
[clean lifecycle 2/2](https://github.com/eky-software/eky/actions/runs/34257928879)
ja [supervisorin kaksi toistoa](https://github.com/eky-software/eky/actions/runs/34257929170).
CI:n todellinen checkout-/koemerge- ja artifact-build-revisio oli
`47dd192160dc97c34e86c09e943ef03faf0e88f2`, ei PR-head.
Consumerit varmistivat omien produceriensa muuttumattomat artifact-tavut.
Prosessipuun poissaolo, semanttinen tarkistus ja cleanup, exact ProductCode
-tila, asennusjäljet, istuntotodiste sekä normaalin profiilin muuttumattomuus
säilyivät erillisinä onnistuneina tuloksina. Kierroksessa ei käytetty uusintaa.

### V2.7:n loppukatselmus ja tilalukijan virheraja

Loppukatselmus vertasi viisi fault-ketjua vanhan W6B.2B:n vastaaviin
vaatimuksiin, jaetun worker-/caller-rajan virhepolkuihin sekä business- ja
session-jälkitarkastuksiin. Yksi Job Object omistaa prosessipuun. Worker ei
rakenna paketteja tai omista emergency-cleanupia. Mainin nonceen sidottu
fault-session-tarkistus pysyy vain hyväksytyissä terveissä proof-vaiheissa;
tavallisen käynnistyksen tai `desktop.started`-tapahtuman merkitys ei muutu.

Katselmuksessa löytyi vanhastakin testituesta periytynyt virhe yhteisessä
`inspectWindowsInstallerProductState.ps1`-lukijassa: `ProductState`-kyselyn
poikkeus muutettiin arvoksi `-1`, jolloin tuntematon tarkistustulos saattoi
näyttää puuttuvalta tuotteelta. Korjaus poistaa tämän poikkeuksen nielevän
lohkon. Vain onnistunut kysely saa tuottaa tilan; poikkeus käyttää nykyistä
exit 1 -rajaa eikä julkaise tulostiedostoa. Caller säilyttää epäonnistuneen
tilatarkistuksen erillään alkuperäisestä skenaariovirheestä ja estää
varmistamattoman siivouksen hyväksymisen. Uutta tulosskeemaa, valvojaa tai
aikarajaa ei lisätä.

Nykyisen Windows-käyttäytymistestin COM-fixture aiheuttaa kyselypoikkeuksen
mutta säilyttää oikean vapautettavan COM-kahvan. Regressio hylkäsi vanhan
lukijan ja hyväksyy korjatun: virhe ei tuota absent-tulosta. Sama testi
säilyttää oikeasti puuttuvan tuotteen, kanonisen tulospolun ja virheellisen
polun tapaukset. Tämä ei ole uusi asennus- tai päivitysskenaario.

Korjatun lukijan ja sen käyttäjien rajattu virhe-/siivoussarja läpäisee
87/87, canonical clean-sopimussarja 29/29, fault-sarja 295/295,
success-sarja 303/303, workspace-artifact-sarja 56/56 ja upgrade-artifact-
sarja 14/14. Desktop typecheck/build ja `git diff --check` ovat erilliset
checkpoint-portit; nämä kohdetulokset eivät korvaa alla vaadittua CI-näyttöä.

Vanhan harnessin ARP:ksi nimeämä tarkistus käyttää samaa ProductCodeen
sidottua Windows Installerin `ProductState`/`ProductInfo`-rekisteröintiä kuin
V2. Erillistä Windowsin uninstall-rekisteriavainten inventaariota ei väitetä
vanhan eikä uuden testin todistamaksi. Jaettu Eky-installeravain, shortcut ja
asennusjuuri tarkistetaan tästä erillään.

Tilalukija on jaettu clean-, upgrade-, legacy- ja workspace-rajoille.
Siksi sen korjausta ei hyväksytä vain yllä olevan `0a7ea01`-kierroksen
perusteella: kohderegressioiden jälkeen tarvitaan puhtaan korjausrevision
nykyiset artifact-/consumer-portit ensimmäisellä yrityksellä.
[PR #265](https://github.com/eky-software/eky/pull/265) kirjaa tämän revision,
todellisen checkoutin, artifact-identiteetit ja erilliset terminal-tulokset.
PR pysyy draftina; vaihehyväksyntä ei poista vanhaa orkestrointia eikä
aloita V2.8:aa, päähaaran käyttöönottoa tai julkaisua.

## Migraatiojärjestys

### V2.8:n riskisopimuksen ensimmäinen checkpoint (historia)

V2.8 alkoi haarassa `codex/test-harness-v2-ci-cadence`. Ensimmäinen
checkpoint ei muuta vanhaa `ci.yml`:ää, V2-artifact-workfloweja, skenaarioita
tai GitHubin required check -asetuksia. Se toteuttaa CI:n oman pienen
politiikkarajan ilman riippuvuutta tai uutta prosessivalvojaa:

- `.github/scripts/ciRiskPolicy.mjs` valitsee nimetyt portit validoiduista
  repositorysuhteellisista muutospoluista. Tavallinen web-, domain- ja
  application-muutos säilyttää build-, system security- ja web critical
  -portit ilman Windows-matriisia. Desktop-muutos lisää Windows-portit;
  yhteinen installer-, startup-, update-, workspace-, persistence- tai
  E2E-raja lisää legacy-testin ja kaikki viisi fault-skenaariota.
  Skenaarionimet luetaan omistavan `workspaceFaultContracts.mjs`-moduulin
  suljetusta sopimuksesta; CI ei ylläpidä siitä rinnakkaista listaa.
- SQL, riippuvuudet, CI- ja build-konfiguraatio sekä tuntematon polku
  valitsevat koko matriisin. Tämä checkpoint on yhteisillä rajoilla
  tarkoituksella konservatiivinen: fault-kattavuutta ei arvata yksittäisen
  funktion nimestä. Tarkempi osajoukko vaatii nimetyn invarianttikartan.
- `.github/scripts/classifyCiChanges.mjs` lukee Gitin NUL-erotellun
  merge-base-diffin ilman rename-yhdistelyä, jotta myös poistetun tai
  siirretyn tiedoston vanha riskipolku huomioidaan. Molemmat SHA:t ovat
  tapahtuman täsmällisiä 40-hex-arvoja. Puuttuva historia, keskeytynyt tai
  liian suuri diff, virheellinen UTF-8 ja tyhjä vertailu eivät valitse
  kevyempää ajoa. Konsoliin tai job-outputiin ei tule tiedostolistaa.
- `.github/scripts/ciAcceptanceResult.mjs` yhdistää saman workflow-ajon
  nimetyt lopputilat. Jokaisen valitun portin pitää olla `success`;
  `failure`, `cancelled`, puuttuva tai tuntematon tulos estää hyväksynnän.
  `skipped` sallitaan vain luokittimen nimenomaisesti pois valitsemalle
  portille. Luokittimen epäonnistuminen ei voi muuttua vihreäksi.
- Main-push, ajastettu ajo ja manuaalinen kokonaisajo valitsevat täyden
  matriisin ja kaksi toistoa. PR:n riskiajo suunnittelee yhden toiston;
  tämä ei muuta V2-vaihehyväksyntöjen nykyisiä kahden consumerin portteja.

`pnpm test:ci` ajaa näiden vastuiden käyttäytymisregressiot. Erillinen
`V2 cadence policy contracts` -workflow todistaa saman sarjan Windowsissa ja
Linuxissa sekä tuottaa tämän PR:n luokittelun vain kytkennän valmisteluksi.
Se ei väitä packaged-hyväksyntää eikä käytä luokittelua vanhojen jobien
ohittamiseen. Artifact-, prosessi-, cleanup- ja postcondition-omistajuus
säilyvät ennallaan. Dependency security säilyy itsenäisenä porttina.

Ensimmäisen checkpointin kohdesarja läpäisee 34/34; desktop typecheck ja
build läpäisevät. Workflow-kytkennän Linux/Windows-todennus on oma
commit-pohjainen porttinsa. Nämä eivät vielä sulje koko V2.8:aa.

Kytkentächeckpoint liittää politiikan nykyisiin producer/consumer-
vastuisiin. Required checkien täsmällinen vaihto esitetään erikseen omistajalle. Nykyisessä
main-rulesetissä ovat `Test, typecheck and build`, `System security E2E`,
`Web critical E2E`, `Windows Electron critical E2E`, `Audit dependencies`
ja `Windows MSI release gate`. Näitä ei poisteta tämän checkpointin mukana.

### V2.8:n workflow-kytkentä

`ci-cadence-contracts.yml` on V2:n yksi automaattinen sisääntulo nimellä
`V2 risk-based CI`. PR käynnistää riskiajon; feature-haaran push ei käynnistä
toista V2-matriisia. Main-push, päivittäinen ajastus ja manuaalinen
release-valmistelun kokonaisajo valitsevat kaikki portit kahdella toistolla.
Ajastus tulee käyttöön vasta workflowin päähaaraan käyttöönoton jälkeen.
Kytkentächeckpoint on PR #266:ssa katselmoitavana. Sen hyväksyntä vaatii
saman revision koko valitun CI-ajon; aiempi checkpoint ei hyväksy uutta revisiota.

Kytkennän jälkeinen rajattu Electron-fixture-korjaus erottaa Playwright-
yhteyden, ensimmäisen ikkunan ja DOM-valmiuden virheet sekä säilyttää
testijuuren epävarmassa loppusiivouksessa. Käynnistysbudjetit, V2:n
prosessiomistajuus ja hyväksymisehdot säilyvät. Käyttäytymissopimus on
E2E-ympäristödokumentissa. Vaihe-erottelu ei yksin selitä aikaisempaa
`ARCHIVE-PDF-CONFLICT-001`-flakea; hyväksyntä vaatii edelleen nykyisen revision
Electron critical -portin ja valitun CI-kierroksen ilman flaky-tulosta.

Nykyinen avoin raja on workspace-success-consumerin `targetInstall`-
asennushavainto. Electron-portin läpäissyt
[CI-ajo](https://github.com/eky-software/eky/actions/runs/34349188420)
hylkäsi yhden success-consumerin koodilla `productInspectionFailed`.
Kutsu päättyi virheeseen, ei ulkoiseen aikakatkaisuun. Komennon ja
pakollisen tulosverifierin exit 1 eivät yksin osoita tulostiedoston puuttumista:
myös kelvollinen epäonnistumistulos hylätään. Aiemman revision vihreitä
consumer-tuloksia ei siirretä korjatulle revisiolle.

Jaettu Windows-adapteri tarkistaa nyt MSI:n aktiivisuuden ennen erillisiä
ProductCode-kyselyitä ja niiden jälkeen. Aktiivisen MSI:n kanssa päällekkäiset
kelvolliset havainnot jäävät nykyisen odotussilmukan käsiteltäviksi; niitä ei
verrata lopullisena tilana. Kyselyvirhe ja virheellinen tulos hylätään heti,
eivätkä ne muutu odottamiseksi. Ilman havaittua MSI-aktiivisuutta ristiriitaiset
havainnot hylätään edelleen. Tarkistukset eivät muodosta atomista
asennussnapshotia. Kysely-, tulos-, prosessi- ja registry-virheet säilyvät
erillisinä suljettuina koodeina workerin ja callerin pakollisessa tuloksessa;
väliaikaisen kyselytuloksen poistovirhe ei peitä alkuperäistä virhettä.
Käyttäytymisregressio todistaa aiemman vertailujärjestyksen virheen, mutta
ei yksin nimeä edellisen CI-hylkäyksen juurisyytä. Supervisor, määräajat,
lopulliset asennus- ja cleanup-ehdot sekä sovelluksen tuotantopolut säilyvät.
Checkpoint tarvitsee vielä uuden revision sovitut consumer- ja CI-portit.

| Muutos | V2:n ajama kattavuus |
| --- | --- |
| Tavallinen web/domain/application tai yleinen dokumentaatio | Testit, typecheck/build, system security, web critical ja riskisopimukset molemmilla käyttöjärjestelmillä |
| Desktop ilman yhteisen elinkaaren muutosta | Edelliset, Electron critical, packaged smoke, Windows installer/process contracts, supervisor sekä clean-, upgrade/rollback- ja workspace-success-consumer kerran |
| Yhteinen elinkaari tai yhteensopivuus | Edelliset sekä legacy ja kaikki viisi workspace-fault-skenaariota kerran |
| CI/build/dependency/SQL, tuntematon polku tai puutteellinen diff | Koko matriisi; consumerit kahdesti ja viisi fault-skenaariota kummassakin |
| Main, ajastettu tai manuaalinen release-valmistelun ajo | Koko matriisi riippumatta diffistä |

Yhteisiin desktop-rajoihin kuuluvat todelliset `profileBackup/` (myös restore
ja recoveryPoint), `runtime/`, `main/`, `update/`, `workspaces/`, `secrets/`,
`release/`, `invoicePdfArchive/`, `observability/` ja `security/`.
Poistettu tai siirretty kriittinen polku säilyy luokittelun syötteenä.

Nykyiset artifact-workflowit ovat uudelleenkäytettäviä `workflow_call`-vastuita.
Sama validoitu suunnitelma ohjaa valintaa ja toistomäärää. Kukin producer
rakentaa oman artifactinsa kerran; consumer valitsee producerin artifact-ID:n
ja varmentaa descriptorin, revision ja tavut ennen käyttöä ja sen jälkeen.
Workspace-success ja fault käyttävät samaa paria. Skenaarioiden pakollisia
tulostiedostoja, exit-, session-, cleanup- tai jälkiehtoja ei muuteta.
Erillinen installer-sopimusjobi säilyttää täyden Git-historian, koska sen
olemassa olevat testit lukevat lukitun historiallisen lähdecommitin.

Vakaa `V2 acceptance` suoritetaan `always()`-ehdolla. `ciRunAcceptance.mjs`
tarkistaa valittujen workflowien lopputilat ja `ciJobCoverage.mjs` saman
run-ID:n ja attemptin täsmälliset jobit sekä pakolliset testivaiheet.
Matriisin viimeisen onnistuneen jäsenen output ei ole matriisin hyväksyntä.
Puuttuva, peruutettu, epäonnistunut tai odottamatta ohitettu job/step,
ylimääräinen toisto, duplikaatti tai epäonnistunut luokittelu hylätään.
`verifyCiRun.mjs` lukee vain rajatun GitHub jobs -vastauksen read-only-tokenilla;
epäonnistunut tai puutteellinen API-luku ei anna vihreää tulosta. Koonti
julkaisee vain suljetun tulosluokan, ei API:n raakadataa.

Vanhan `ci.yml`:n suorat triggerit, required check -nimet ja W6-komennot
säilyvät. V2-kutsutila käyttää sen nykyisiä core-testejä ja installer-
sopimustestejä, mutta ei käynnistä niiden rinnalle vanhaa MSI/W6-matriisia.
Päähaaraan kohdistuvassa siirtokatselmuksessa vanha ja uusi ketju voivat vielä
ajaa rinnakkain tarkoituksellisena vertailuna. Tämän päällekkäisyyden poisto,
required checkien vaihto ja main-käyttöönotto vaativat oman hyväksynnän.
Dependency security säilyy erillisenä porttina. Tämä ei sulje koko V2:ta tai julkaisua.

### Vaiheiden järjestys

V2 toteutetaan pieninä, itsenäisesti vihreinä checkpointteina:

1. V2.1: synteettinen supervisor-, timeout-, cancellation- ja
   exact-cleanup-sopimus.
2. V2.2: clean install / uninstall yhden paikallisen immutable fixturen
   ympärillä.
3. V2.3: build-once descriptor, read-only artifact-verifier ja tarvittaessa
   hyväksytty immutable artifact fan-out.
4. V2.4: N -> N+1 upgrade, downgrade ja rollback.
5. V2.5: historical 0.2.6 -> 0.2.7 legacy.
6. V2.6: W6B.2A success.
7. V2.7: W6B.2B fault/rollback.
8. V2.8: riskiluokiteltu CI-kadenssi ja vakaa aggregaattori.

Vanhan harnessin tiedosto poistetaan vasta, kun sen jokainen invariantti on
nimetty migraatiotaulukossa ja vastaava V2-testi on samalla commitilla vihreä.
Vanhaa ja uutta harnessia ei jätetä pysyvästi rinnakkain.

## Testitiedostojen myöhempi siivous

Kun Windows-harness on terminal ja vihreä, muut suuret testit käsitellään
moduuli kerrallaan:

1. tunnista tiedoston itsenäiset vastuut
2. säilytä yksi yhteinen, vastuukohtainen fixture builder vain todelliselle
   duplikaatiolle
3. siirrä testit toteutusvastuun mukana
4. älä yhdistä eri business-sääntöjä yleiseen test-utils-kansioon
5. älä muuta assertion-semanticsia samassa refaktorissa
6. aja vanha ja uusi rajattu testijoukko ennen vanhan polun poistoa

Ensimmäisiä katselmuskohteita ovat yli 800-riviset, useita selvästi nimettäviä
vastuita sisältävät backend-, API-client-, desktop update- ja E2E-
testitiedostot. Pelkkä pituus ei ole poistoperuste.

## Hyväksynnän kolme tasoa

### Vaihekohtainen checkpoint

V2.1-V2.8-vaiheen hyväksyntä koskee vain sen nimettyjä invariantteja ja
täsmällistä harness-revisiota. Kohdetestit ja vaiheelle sovitut paikalliset
sekä CI-ajot on saatettava terminal-tilaan. Artifact-vaiheissa kirjataan
erikseen producer-revisio, descriptorin ja MSI-tavujen identiteetit sekä
consumerien harness-revisio. Likainen työpuu, puuttuva terminal-result tai
myöhemmän muutoksen epäonnistunut sarja ei peri aiemman checkpointin vihreyttä.
Rerun-only-vihreä ei sulje epäonnistunutta hyväksyntää.

Valmis vaihe jätetään katselmoitavaksi pinotuksi draft-PR:ksi ennen seuraavan
vaiheen aloittamista. Se ei vaihda päähaaran portteja, poista vanhaa harnessia,
hyväksy koko V2:ta tai tuota käyttäjälle pilot-pakettia.

### Koko V2:n hyväksyntä

Koko V2:n hyväksyntä edellyttää kaikkien vaiheiden yhteistä näyttöä,
invarianttien siirtokartan kattavuutta ja alla olevan valmis-määritelmän
täyttymistä samalla lopullisella integraatiorevisiolla. Vanha ja korvaava
portti verrataan ennen poistoa. Yksittäinen legacy-, success- tai rollback-
checkpoint ei yksin täytä tätä tasoa.

### Hallittu käyttöönotto päähaaraan

Käyttöönotto valmistellaan myöhemmin erikseen ajantasaista `main`-revisiota
vasten. Jäädytettyjä PR:iä #257/#258 ei muuteta tai mergeä oikopolkuna.
Integraatiosuunnitelma nimeää:

1. päivitetyn main-baselinen, V2-integraatiorevision ja mahdolliset ristiriidat
2. jokaisen poistettavan vanhan invariantin vihreän V2-vastineen
3. riskiperusteisen CI-kytkennän, vakaan aggregaattorin sekä required checkien
   nykyiset ja ehdotetut nimet
4. poistettavat päällekkäiset prosessi-, timeout- ja cleanup-omistajat sekä
   jäljelle jäävän auktoritatiivisen komennon
5. integraatiorevision paikalliset ja ensimmäisen yrityksen CI-portit sekä
   merge-commitin oman main-ajon tarkistuksen.

Required checkien korvaaminen tai repository-asetusten muutos vaatii näkyvän
omistajapäätöksen. Porttia ei ohiteta eikä vanhaa poisteta ennen vastaavaa
todistettua kattavuutta. Koodin, komentojen, CI:n ja dokumentaation vaihto
tehdään yhtenä katselmoitavana cutover-kokonaisuutena. Versionosto ja
käyttäjälle toimitettava pilot-artifact ovat vasta tämän jälkeinen erillinen
julkaisuvaihe.

## Valmis-määritelmä

V2 voidaan korvata nykyisen harnessin tilalle vasta, kun sama commit täyttää:

- paikalliset unit- ja process-contract-kohdetestit
- kaksi paikallista täyttä release-kierrosta ilman retryä
- kaksi GitHub-kierrosta ilman rerunia, flakyä, peruutusta tai ulkoista
  timeoutia
- jokainen worker tuottaa oman terminal result -artifactin
- supervisor tuottaa deadline- tai cancellation-tilassakin terminal-
  cleanup-tuloksen
- omistettuja orpoprosesseja jää 0
- normaali Eky-profiili säilyy muuttumattomana
- source- ja target-artifactien SHA-256 säilyy
- business-, backup-, restore-, migration-, workspace- ja rollback-invariantit
  säilyvät
- vanha päällekkäinen prosessi- ja timeout-orkestrointi poistetaan
- dokumentaatio ja CI-komennot viittaavat vain uuteen auktoritatiiviseen
  polkuun
- dependency- ja lockfile-muutoksia ei ole ilman erillistä hyväksyntää

## Nykyinen päätös

V2.7:n loppukatselmus on suljettu lähderevisiolle
`b593614d99ee1c17cb70ce4f0aa41c23ceaac70d`. CI:n todellinen checkout ja
artifactin build-revisio ovat `9436d2fdce7f2e18c96b71c5e7978ace700f8351`;
nämä ovat eri identiteettejä. [PR #265](https://github.com/eky-software/eky/pull/265)
säilyy katselmoitavana draft-checkpointina, ei main- tai julkaisuhyväksyntänä.

| Portti | Tarkistetun revision näyttö |
| --- | --- |
| [Workspace producer ja consumerit](https://github.com/eky-software/eky/actions/runs/34284727210) | Success 2/2 ja viisi fault-skenaariota kahdesti, 10/10; ensimmäinen yritys |
| [Clean lifecycle](https://github.com/eky-software/eky/actions/runs/34284727215) | Producer ja consumerit 2/2, ensimmäinen yritys |
| [Upgrade ja rollback](https://github.com/eky-software/eky/actions/runs/34284727228) | Producer ja consumerit 2/2, ensimmäinen yritys |
| [Supervisor](https://github.com/eky-software/eky/actions/runs/34284727192) | Molemmat toistot vihreitä, ensimmäinen yritys |
| Pakollinen caller-tulos | Ajokohtainen sidonta, komennon todellinen exit ja lopputulos varmennettu; konsoliviesti ei korvaa niitä |
| Eristys ja cleanup | Prosessipuu ja kirjoitin poissa, normaalin profiilin inventaario ennallaan, exact-tuotteet ja installer-footprint poistettu, fixture poistettu |
| Artifact | Sama producerin pari kaikissa neljässä workspace-consumerissa, identiteetti varmennettu ennen ja jälkeen |
| Loppukatselmuksen kohderegressiot | Kirjoitin/caller 39/39, success 309/309 ja fault 299/299; ei ohituksia tai peruutuksia |

Katselmus tarkisti viiden fault-ketjun siirtokartan, alkuperäisen virheen ja
cleanupin erottelun, tiedostotuloksen sidonnan sekä yksityisen session-proofin.
Uutta vaiheen sulkemisen estävää löydöstä ei todettu. Tuntematon lopputila
säilyy virheenä eikä oikeuta fixturen poistamiseen. Aiemman runner-yhteyskatkon
syytä ei väitetä tällä näytöllä ratkaistuksi.

Omistajan hyväksymä jatko aloittaa V2.8:n omassa pinotussa haarassa:
riskiluokitus, vakaa CI-aggregaattori ja niiden käyttäytymisregressiot.
Nykyiset required checkit, vanhat W6-komennot ja release-portit säilyvät,
kunnes erillinen käyttöönotto on katselmoitu. Ennen yhteistä käyttöönottoa
säilyy myös jäljempänä kirjattu V2.5:n precondition-virheluokituksen viimeistely.
Ei main-mergeä, versionostoa tai pilot-pakettia tässä vaiheessa.

### Historiallinen tila ennen caller-korjauksen hyväksyntää

V2.6:n tarkistettu vaihekohtainen lähtörevisio on `2f2118e`.
V2.7:n sopimus-/vaiheketjucheckpoint, hyväksytty muistikanavan käynnistysraja,
jaetun Windows-adapterin worker-kytkentä, riippumattomat business-/session-
jälkitarkastukset sekä yhteinen caller-/terminal-composition on toteutettu
yllä kuvatusti. Yhteisen producerin ja kahden fault-consumerin CI-kytkentä
on toteutettu. Artifact-viittauksen korjausrevisio `0a7ea01` läpäisi kaikki
14 CI-jobia ensimmäisellä yrityksellä, mukaan lukien fault 10/10 ja success
2/2. Tilalukijan korjausrevision `237e581` CI-checkout ja artifact-revisio
on `8388b8f`. Sen 13 muuta jobia läpäisivät ensimmäisen yrityksen, mutta
[fault-consumer 2](https://github.com/eky-software/eky/actions/runs/34264280577/job/102192632310)
päättyi epäonnistuneeksi GitHubin ilmoittaman runner-yhteyden menetyksen
jälkeen. Lopullinen loki ei ole saatavilla, eikä callerin terminal- tai
cleanup-tulosta ole varmennettu. Tulos säilyy epäonnistuneena ja
varmentamattomana; supervisorin viimeinen `completed`-rivi ei todista
prosessin exit/closea tai jälkitarkastusten valmistumista.

Erillinen rajattu korjaus muuttaa olemassa olevan Windows-adapterin
`error`-tulkintaa: vain todettu käynnistyksen epäonnistuminen ennen
prosessin syntyä voi tarkoittaa `startFailed` / `directProcessAbsent: true`.
Jo käynnistetyn lapsen virhe käyttää samaa täsmällisen prosessikahvan
lopetuspolkua. Epäonnistunut tai varmentamaton lopetus säilyy virheenä;
myöhempi close tai yleinen tuotetilan poissaolo ei muuta jo palautettua
varmentamatonta tulosta eikä oikeuta fixturen poistamiseen. Luonnin aikana
kulunut aika vähennetään saman adapterin odotusbudjetista. Tämä ei keskeytä
synkronista natiivikäynnistystä eikä kata adapteria edeltävää valmistelua;
olemassa oleva lopetusvaraus säilyy erillisenä ja muuttumattomana.

Adapterin regressiot läpäisevät 9/9, jaetun virherajan ja jälkitarkastuksen
kohdesarja 42/42, clean-sopimukset 34/34, workspace success 305/305 sekä
workspace fault 295/295. Desktop typecheck ja build läpäisevät. Nämä ovat
korjauksen sopimustuloksia, eivät uuden revision packaged-hyväksyntä.
Korjausta ei ole osoitettu runner-yhteyden menetyksen syyksi.

Nykyinen rajattu korjaus kytkee callerin exit/close-, tulosvalidointi-,
semanttisen tarkistuksen, uninstallin ja fixture-poiston aloittamisen
erottavat ei-estävät vaihekuittaukset. Omistaja hyväksyi pakollisen
CLI-lopputuloksen erilliseen strict tulostiedostoon: CI vaatii sen sidonnan,
sisällön ja komennon todellisen onnistuneen poistumisen. Diagnostiikka ei
päätä hyväksynnästä. V2.7:n sulkeminen vaatii korjatun puhtaan revision koko
consumer- ja artifact-hyväksynnän; aiempi vihreys ei riitä.
Vanhan harnessin poistamiseen ei vielä ole koko V2:n integraationäyttöä.
Migraatiojärjestys, yhden supervisorin omistajuus ja hyväksynnän kolme tasoa
säilyvät.

### V2.7:n rajattu vaihekirjoittimen sopimus

Omistaja on hyväksynyt yhden vain suljettuja vaihehavaintoja välittävän
Node-apuprosessin. Sopimus todistetaan käyttäytymistesteillä ennen success-
ja fault-calleriin kytkemistä. Kirjoitin ei ole supervisor, skenaariotyöntekijä
tai yleinen lokipalvelu, eikä sitä toimiteta sovelluspaketissa.

- Lähetys validoi suljetun versionoidun havaintomuodon molemmissa päissä.
  Vain nimetyt skenaariot, vaiheet, tilat ja ei-negatiiviset kestot sallitaan;
  vapaita tekstejä, virheolioita, polkuja, tunnisteita tai business-dataa ei
  välitetä. Yksi JSONL-viesti on enintään 512 tavua.
- Caller ei odota kirjoituskuittausta. Enintään yksi enintään 512 tavun viesti
  on lähetyksessä ja 16 jonossa. Täysi jono tai rikkoutunut kanava pudottaa
  havaintoja; ei uudelleenkäynnistystä, retryä tai synkronista varatulostusta.
  Lähetyksen valmistuminen ei todista vastaanottajan lukeneen viestiä.
- Lopetus hylkää jonon ja katkaisee lähetyspään odottamatta tyhjentymistä.
  Sama olemassa oleva rajattu Windows-prosessiadapteri omistaa tämän yhden
  lehtiprosessin lopetuksen ja close-todisteen. Adapterin olemassa oleva
  suoritusraja ja erillinen lopetusvaraus säilyvät; kirjoitin ei omista
  supervisorin Jobia, workeria tai MSI-prosesseja. Hallittu peruutus käyttää
  samaa lopetuspolkua. Kanavavirhe ei todista prosessin poistumista.
- Menetetty havainto on diagnostiikan puute. Varmentamaton kirjoittimen
  poistuminen on erillinen cleanup-virhe, jota myöhempi havainto ei nollaa.
  Alkuperäinen skenaariovirhe ja kaikki nykyiset semanttiset tulokset säilyvät.
- Pakollinen callerin lopputulos ei kuulu tähän vapaaehtoiseen kanavaan.
  Omistajan hyväksymä tulostiedosto korvaa CLI-entrypointin suoran
  konsoliyhteenvedon. Pelkkä vaiheviesti tai tulostiedosto ilman komennon
  poistumista ei ole hyväksyntä.

Kohdesarja todistaa koko komentoprosessin poistumisen ja tarkan omistettujen
resurssien lopputilan normaalilla tulosteella, lukemattomalla vastaanottajalla,
kanavakatkolla, kirjoittimen kaatumisella ja hallitulla peruutuksella. Erillinen
injektoitu epäonnistunut lopetus säilyy varmentamattomana. Tämä ei nimeä
runnerin yhteyskatkon syytä eikä muuta V2.7:n hyväksyntätilaa.

Rajattu käyttäytymissarja ajetaan komennolla
`pnpm --filter @eky/desktop installer:test:windows-acceptance-phase-writer`.
Se rakentaa nykyisen supervisorin ja käyttää sen olemassa olevaa Job Object
-sopimustukea vain testifixturen turvarajana. Ajossa ei rakenneta MSI:tä,
asenneta sovellusta tai käynnistetä packaged-matriisia. Sama kohdesarja kuuluu
CI:n nopeaan sopimusjobiin ennen artifact-produceria.

Kirjoittimen erillinen sopimussarja läpäisee 25/25, joista kahdeksan käyttää
todellista komentoprosessia nykyisen Job Object -testituen sisällä. Kaikissa
kahdeksassa omistettu prosessipuu poistuu; puuttuva pakollinen worker-tulos
hylätään myös onnistuneen vaiheviestin jälkeen. Jaettu caller-/virherajan
kohdesarja läpäisee 88/88, clean 38/38, success 305/305 ja fault 295/295 sekä
desktop typecheck/build. Tämä on kytkemättömän kirjoitin-checkpointin
sopimusnäyttö, ei CLI:n loppuyhteenvedon eikä V2.7:n packaged-hyväksyntä.

### Pakollinen workspace-callerin lopputulos

CLI vaatii viimeiseksi `--result-path`-argumentiksi uuden ajokohtaisen
`<TEMP>/eky-workspace-caller-<32-hex>/result.json`-kohteen. Windowsin TEMP
ja CI:n RUNNER_TEMP hyväksytään vain kanonisina juurina. Kiinteä rajattu
tiedostoadapteri varaa hakemiston yksinomaisesti ennen skenaariota ja sitoo
sen invocationId-, skenaario-, fault-skenaario-, buildRevision- ja
descriptor-SHA-arvoihin. Hakemiston uudelleenkäyttö, linkit, tuntemattomat
kentät ja epävalidi tai puuttuva tulos torjutaan.

Sama tiedostoadapteri julkaisee enintään 8192 tavun suljetun yhteenvedon
atomisesti ilman olemassa olevan tuloksen korvaamista. Se käyttää nykyistä
rajattua Windows-adapteria: 30 sekunnin operaatioraja ja erillinen 5 sekunnin
lopetusvaraus. Malli ei keskeytä synkronista natiivikäynnistystä eikä väitä
kattavansa koko scenario-komennon valmistelua. Adapteri ei lue yritysdataa,
omista skenaariota, käynnistä MSI:tä tai poista fixtureä.

Vaihekirjoitin lopetetaan ja sen poissaolo varmennetaan ennen fixture-poistoa.
Siksi poiston lopullinen tulos kuuluu pakolliseen tiedostoon, ei jonon
tyhjentymistä odottavaan viimeiseen konsoliviestiin. Varmentamaton kirjoittimen
poistuminen säilyttää fixturen ja erillisen safety-virheen alkuperäisen
skenaariovirheen rinnalla. Tulosjulkaisun virhe ei muuta näitä tuloksia;
puuttuva julkaisu estää hyväksynnän ja sen oma aineisto säilyy paikallisesti.

CI varaa jokaiselle success- ja fault-ajolle uuden kohteen. Komennon
exit-koodi talletetaan heti, minkä jälkeen `verifyWorkspaceCallerResult.mjs`
tarkistaa saman argumenttisidonnan, strict tuloksen ja exit-koodin. Molempien
komentojen pitää päättyä onnistuneesti. Verifier ei tulosta raakaa tiedostoa
eikä console-output ole kontrolliprotokolla. Producer, artifact-ID, MSI-tavut
ja alkuperäiset skenaarion jälkiehdot pysyvät ennallaan. Uuden kytkennän
packaged-hyväksyntä on edelleen avoin, eikä runner-yhteyskatkon syytä ole
osoitettu tällä korjauksella.

Kytkennän kohdesarja läpäisee 39/39, mukaan lukien kymmenen oikeaa
komentoprosessia, niiden pakollinen caller-result ja kaikkien omistettujen
Job-puiden poistuminen. Jaetut success-regressiot läpäisevät 309/309,
fault-regressiot 299/299, artifact-/workflow-sopimukset 57/57 ja clean 38/38.
Desktop typecheck/build läpäisevät. Nämä ovat korjauspinnan sopimustuloksia;
puhtaan revision commit-pohjainen CI ja sen kokonaiset consumerit ovat
seuraava hyväksyntäportti.

### V2.5:n hyväksytty historiallinen päätös

V2.5:n vaihekohtainen loppukatselmus on hyväksytty. Testattu harness- ja
artifact-revisio on `47847f9dcac5eb296ee93deac65b2440f80614cd` yllä olevan
hyväksytyn suoritusympäristörajauksen mukaisesti. Katselmuksen lähtö-HEAD
`362d08ed2e9b013805b7b2a2ca2ea376baaf8fd7` muuttaa sen jälkeen vain
dokumentaatiota; toteutus ja testikytkennät ovat muuttumattomat. Sen kaikki
kahdeksan automaattista PR-tarkistusta ovat vihreitä ensimmäisellä yrityksellä.
PR #263 säilyy draft-checkpointina. Tämä on vaiheen hyväksyntä, ei koko V2:n,
päähaaran käyttöönoton tai julkaisun hyväksyntä.

Loppukatselmus vertasi yllä olevan invarianttien siirtokartan vastuut
toteutukseen, käyttäytymisregressioihin ja täsmärevision näyttöön. Strict
artifact- ja footprint-rajat, kaksivaiheinen historical smoke, source- ja
target-startup, adoption idempotenssi sekä erilliset process-, worker-,
semantic proof-, cleanup- ja postcondition-tulokset säilyvät. Puuttuva tulos
tai varmentamaton siivous ei oikeuta onnistumiseen tai testijuuren poistoon.
Tarkistetuissa rajoissa ei todettu uutta vaihetta estävää löydöstä.

Ei-estävä katselmointikohta säilyy avoimena: `runLegacyUpgrade`-kutsun
`requireLegacyUpgradeProductPrecondition` muuntaa tarkistimen epäonnistumisen
yleiseksi `WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED`-koodiksi. Ennen
yhteistä käyttöönottoa suljettu alkuperäinen tarkistinvirhe on säilytettävä
nykyisessä vastuussa ja lukittava käyttäytymisregressiolla. Puuttuva tulos ei
saa valtuuttaa ennestään asennetun tuotteen siivousta. Tätä havaintoa ei
nimetä ratkaistuksi eikä yhdistetä aiempiin käynnistysviiveisiin.

Omistajan hyväksymä jatko aloittaa V2.6:n omassa pinotussa haarassa tämän
katselmoidun checkpointin päältä. PR:iä ei mergeä mekaanisesti toisiinsa tai
`main`iin. V2.6:n ja V2.7:n suoritusympäristö on hyväksytty erikseen yllä
V2.6-luvussa; V2.5:n rajaus ei siirtynyt niihin automaattisesti. Vanhan
orkestroinnin poisto, CI-porttien vaihto ja päähaaran integraatio säilyvät
erillisenä cutover-kokonaisuutena ennen julkaisuvaihetta.

| Portti | Revision `47847f9` näyttö |
| --- | --- |
| Paikallinen normaali V2.5-sarja | 166/166, ei epäonnistuneita, peruutettuja tai ohitettuja testejä |
| Artifact-/työnkulkusopimukset | 12/12; desktopin typecheck/build läpäisseet, niiden jälkeen ei desktop-toteutusmuutoksia |
| CI-sopimukset | [Vaiheajo 34127535051](https://github.com/eky-software/eky/actions/runs/34127535051): molemmat sarjat 166/166, attempt 1 |
| CI-producer | Samassa vaiheajossa yksi varmennettu historical source / synthetic target -artifact, attempt 1 |
| CI-consumerit | Kaksi eristettyä Windows-jobia: `historicalLegacyUpgradeCompleted`, attempt 1, samat tavut ennen/jälkeen |
| Semanttiset jälkiehdot | Molemmissa business-evidence, yksi adoptio ja idempotentti toinen käynnistys; `businessDataPreserved`, `processTreeAbsent` ja `fixtureRemoved` kaikki `true` |
| Jaetut V2-portit | [Supervisor](https://github.com/eky-software/eky/actions/runs/34127539610), [clean artifact](https://github.com/eky-software/eky/actions/runs/34127539680) ja [upgrade artifact](https://github.com/eky-software/eky/actions/runs/34127539566) valmistuivat vihreinä |

| CI-artifactin identiteetti, producer `47847f9` | SHA-256 |
| --- | --- |
| Descriptor | `994b1bb3cc3973c38cc0fdf32c45ca24c3973f367cc83fe959866c7cdcc0bce4` |
| Historical-source-rebuild 0.2.6 MSI | `98eeffe5a55965121ea78f455c9c1f61848a525aaa73c86d81b44b1b667c74eb` |
| Synteettinen 0.2.7 target MSI | `5722cd006b062d4cf6065fadd8dd827863a921bfda7c09446106cc4dc40ebe3a` |

Nämä ovat tämän repositoryn CI-artifactin tunnisteita, eivät paikallisen
buildin tai käyttäjälle annettavan julkaisun tunnisteita. Dokumentaation
myöhempi commit ei saa itselleen uutta artifact-hyväksyntää näillä hasheilla.
Konekohtaisia havaintoja tai mittauksia ei sisällytetä tähän päätökseen.

### Aiempi päätöstila ennen suoritusympäristön rajausta

Seuraava osuus säilyttää aiemmat hyväksyntätilat historiallisina. Sen avoimia
paikallisia consumer-vaatimuksia ei tulkita uuden ympäristöpäätöksen rinnalle
uusiksi porteiksi, eikä sen epäonnistuneita ajoja nimetä onnistuneiksi.

V2.5:n hyväksyntä on edelleen avoin haarassa
`codex/test-harness-v2-legacy-upgrade`. Nykyinen rajattu checkpoint tarkentaa
footprint-virheen roolin ja ehdon sekä estää artifactin sijoittamisen buildin
cleanup-juureen; käyttäytymisregressiot 59/59. Revisio `7bfab86` läpäisi
normaalin pnpm-sarjan 166/166, artifact-sopimukset 11/11 ja desktopin
typecheck/buildin. Paketoitu hyväksyntä on edelleen kesken. Yksityiskohtainen
diagnoosi säilyy vain paikallisena aineistona. Single-link-sopimus säilyy;
sen mahdollinen muutos tarvitsee omistajapäätöksen. GUI-fixturen poikkeusta
ei laajenneta asennettuun payloadiin tällä checkpointilla.
Checkpoint voidaan julkaista keskeneräisenä draft-katselmukseen. Uutta
lopullista artifactia tai kahta paikallista hyväksyntäconsumeria ei ajeta
tämän avoimen rajan yli. CI:n mahdollinen vihreys ei korvaa tätä puutetta.

Jaetun feasibility-työnkulun on sidottava varmennettu, absoluuttinen
`EKY_DOTNET_EXE` ennen kaikkia process-contract-ajotiloja, ei vain
diagnostiikkaa. Sama sidonta tehdään kerran. Rajattu regressio todistaa
puuttuvan sidonnan hylkäyksen ja korjatun kytkennän; supervisorin
absoluuttisen komentopolun ehto säilyy muuttumattomana. Kohdetestit 2/2,
supervisor-sopimukset 45/45 ja artifact-/työnkulkusopimukset 12/12.

Revision `5b727b9` ensimmäinen vaihehyväksyntäkierros
([34125812197](https://github.com/eky-software/eky/actions/runs/34125812197))
läpäisi molemmat 166/166-sopimussarjat ja producerin. Consumer 1 läpäisi,
consumer 2 hylättiin ennen skenaarion käynnistystä koodilla
`WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED`. Tämä ei ole hyväksytty
consumer-pari. Yleinen precondition-koodi ei yksin osoita hylkäyksen syytä;
sitä ei käsitellä asennetun footprintin havainnon selityksenä.

Edellisen checkpointin normaali pnpm-sarja revisiolta
`c859c5ab9c6723ca08529173e4a2e87b34c9bcd7` läpäisi 151/151 ilman
peruutettuja tai ohitettuja testejä. Artifact-sopimukset 10/10 sekä desktopin
typecheck/build ja locked restore läpäisivät. Ensimmäinen consumer hylättiin
`targetPostcondition`-vaiheessa. Toista consumeria ja uutta CI-kierrosta ei
ajettu epäonnistumisen yli. Aiempi diagnostinen CI kuuluu revisiolle
`fea84837ce218a09455c8c170b6ba6698fc9a9ce`; sitä ei siirretä uuden
checkpointin hyväksynnäksi. Erillinen checkpoint `4f5a4db` poistaa
virheellisen pyynnön estävän evidence-kirjoituksen. Omistaja on hyväksynyt
yllä kuvatun neljän GUI-tapauksen 30000 ms kokonaisbudjetin. Prosessiomistajuus,
tuotantokoodi, muut aikarajat ja tulosten hyväksymisehdot eivät muutu.

| Vastuu | Projektin hyväksyntätila |
| --- | --- |
| Startup- ja smoke-watcher | Kanonisointi, linkkirajat ja varhainen child-rejection on katettu regressioilla; viimeisin kohdesarja 49/49 |
| Worker-fixturen cleanup | Kilpaileva Job-cleanup on poistettu synteettisestä fixturestä; live-child ja foreign sentinel säilyvät pakollisina |
| Supervisorin evidence-output | Myös invalid-request käyttää ei-estävää writera; regressio epäonnistui ennen korjausta, kohdesarja 45/45 ja kaksi invalid-request-regressiota 20/20 kierrosta ilman retryä |
| GUI-testisopimus | Neljän onnistumispolun hyväksytty 30000 ms kokonaisbudjetti, 1000 ms cleanup-varaus; kohdetestit 6/6, myös muuttumaton `absent`-regressio |
| Normaali V2.5-sarja | `7bfab86`: 166/166; aiempi `fea8483`: 149/150 pysyy epäonnistuneena, eikä `cleanupUnverified` ole hyväksytty cleanup |
| Artifact | `c859c5a`: producer ja erillinen ennen/jälkeen-verifier läpäisivät; canonical- ja locked-inputit muuttumattomat |
| Consumer 1 | `c859c5a`: `WINDOWS_ACCEPTANCE_LEGACY_FOOTPRINT_INSPECTION_FAILED`; major upgrade valmistui, mutta target-postcondition hylättiin ennen targetin käynnistystä |
| Consumerin failure boundary | Alkuperäinen virhe säilyi; `processTreeAbsent=true`, `semanticCleanupCompleted`, `exactProductsAbsentAfterCleanup`, `fixtureRemoved=true` |
| Suora Node-kontrolli nykyisen buildin jälkeen | `fea8483`: 150/150, vain diagnostiikkaa; ei korvaa normaalia pnpm-komentoa tai todista juurisyytä |
| Diagnostinen CI | `fea8483`, ajo `34065428142`: kaksi 150/150-sarjaa, yksi producer ja kaksi consumeria ensimmäisellä yrityksellä |
| Puuttuva hyväksyntä | Asennetun payloadin testisopimuksen katselmus, lopullisen revision kaksi vihreää paikallista consumeria sekä tuore CI ovat edelleen avoinna |

Nykyinen `windows-acceptance-v2-legacy-diagnostic.yml` säilyy samana
työnkulkuna, mutta sen uusi ajotarkoitus on **V2.5-vaihehyväksyntä**:
kaksi sopimussarjaa, yksi producer ja kaksi saman artifactin consumeria.
Historiallisia diagnostisia ajoja ei nimetä jälkikäteen hyväksynnöiksi.
Jobit, komennot, aikarajat, SHA-lukitut actionit ja yhden päivän
artifact-retentio säilyvät; ei uutta rinnakkaista CI-putkea. Tämä ei ole
koko V2:n hyväksyntä, päähaaran cutover tai release-portti, eikä muuta
nykyisiä required check -ehtoja. Lopullinen vaihehyväksyntä vaatii myös
alla mainitut paikalliset portit.

Konekohtaisen tutkimuksen aineisto, ympäristöhavainnot ja yksityiskohtaiset
mittaukset säilytetään vain Gitistä ohitettuina. Niiden poistaminen tästä
suunnitelmasta ei poista epäonnistuneita testituloksia eikä osoita juurisyytä
julkisen CI-ajon virheelle. Tutkimuslupa ei ole julkaisulupa.

Nykyisen [diagnostisen ajon 34065428142](https://github.com/eky-software/eky/actions/runs/34065428142)
kaikki viisi jobia valmistuivat ilman rerunia tai ulkoista timeoutia.
Sopimussarjoissa ei ollut epäonnistuneita, peruutettuja tai ohitettuja testejä.

| Job | Tulos | GitHub-jobin kesto |
| --- | --- | --- |
| Sopimussarja 1 | 150/150 | 2 min 28 s |
| Sopimussarja 2 | 150/150 | 2 min 47 s |
| Producer | Yksi tarkistettu source/target-artifact | 8 min 15 s |
| Consumer 1 | `historicalLegacyUpgradeCompleted` | 2 min 58 s |
| Consumer 2 | `historicalLegacyUpgradeCompleted` | 3 min 11 s |

| Nykyisen CI-artifactin identiteetti | SHA-256 |
| --- | --- |
| Descriptor | `933b1c7035f51ce048260c05da9f363da1b4045b18b24d0c76dc39dfdefab500` |
| Source MSI | `4d2d327057d8da7e37cf4f0c5b21b527c3b8792e2035a92d1eba08b5cc8c5716` |
| Target MSI | `35d629d5c60fdf905803352477f3bde7a1d474f4aabb1f6338411dd5a38d5171` |

Molemmat consumerit varmensivat saman descriptorin ja pakettitavut ennen
ajoa ja sen jälkeen. Source on `historical-source-rebuild` 0.2.6, target
synteettinen 0.2.7, ei exact-local-release tai käyttäjälle jaettava pilotti.
Kummankin strict terminal vahvisti legacy business -todisteen, yhden adoptoidun
työtilan, idempotentin toisen käynnistyksen, `businessDataPreserved=true`,
`processTreeAbsent=true` ja `fixtureRemoved=true`. CI-profiilin tiedostomäärä
oli 0 -> 0. Completed-polku edellyttää onnistunutta semanttista cleanupia ja
erillistä `exactProductsAbsent`-jälkiehtoa; omistettuja orpoprosesseja jäi 0.
Omistajan profiilia tai yksityistä tutkimusaineistoa ei siirretty CI:hin.

Hyväksytty kertaluonteinen pnpm-ketjun mittaus on suoritettu ja sen
väliaikainen muutos palautettu. Se ei muuta normaalia hyväksyntää.
Invalid-request-evidence-korjaus on itsenäinen eikä selitä natiivikäynnistystä.
Erillinen omistajapäätös hyväksyy GUI-integraation rajatun aikabudjetin
muutoksen; mittauslupaa ei käytetä hyväksyntänä. Onnistuminen edellyttää edelleen
todellisia readiness-, worker-, process-tree- ja cleanup-tuloksia.
Tarkoitukselliset timeout-, puuttuvan ikkunan ja myöhäisen prosessinluonnin
regressiot säilyvät ennallaan. Normaali sarja on vihreä, mutta packaged-
hyväksyntä ei ole valmis. Aiempi footprint-lukijan yhteinen hylkäyskoodi on
nyt tarkennettu rooli-/ehtoluokaksi. Luokitus osoittaa hylätyn tarkistuksen,
ei tiedostomuutoksen tekijää. Linkki- tai containment-rajaa ei löysennetä
eikä uutta supervisor- tai cleanup-omistajaa lisätä. Uutta laajaa sarjaa tai
CI-uusintaa ei käytetä avoimen luottamusrajan päätöksen korvikkeena.

### Historialliset hyväksyntäyritykset

Aiemman vihreän diagnostisen artifactin alkuperäinen testirevisio on
`43128e6763cc59472e4a9a3f91c5957a8fd3bf88`. Sitä seuranneet `e8d2f5f` ja
`3c68cbd` olivat dokumentaatiocheckpointeja, eivät uusia testirevisioita.
Niiden tuloksia ei yhdistetä nykyiseen hyväksyntäyritykseen.

Aiemmat 85/86-, 96/97-, 102/103-, 136/137-, 138/139-, 140/141- ja
146/147-sarjat säilyvät epäonnistuneina; yksittäinen vihreä diagnostiikka ei
korvaa niitä. Alkuperäisten kokeiden konekohtaiset yksityiskohdat ovat
paikallista aineistoa, eivät projektin julkinen tapahtumapäiväkirja.

| CI-revisio ja ajo | Historiallinen päätetulos |
| --- | --- |
| `50225e5`, [33966600849](https://github.com/eky-software/eky/actions/runs/33966600849) | Yksi visible-diagnoosi läpäisi; ei V2.5-hyväksyntä |
| `eba5ac2`, [34000831989](https://github.com/eky-software/eky/actions/runs/34000831989) | Molemmat sarjat epäonnistuivat: 132/136; SDK-kytkentä, watcher ja worker-fixture rajattiin erikseen |
| `082f26f`, [34026267089](https://github.com/eky-software/eky/actions/runs/34026267089) | Worker-diagnoosi osoitti cleanup-kilpailun; ei hyväksytty kokonaisuus |
| `65829a9`, [34026639207](https://github.com/eky-software/eky/actions/runs/34026639207) | Worker-kohde 4/4 kahdesti ensimmäisellä yrityksellä |
| `ff514fd`, [34035122217](https://github.com/eky-software/eky/actions/runs/34035122217) | Kaksi 141/141-sarjaa, diagnostinen tulos |
| `7ce39f0`, [34039443687](https://github.com/eky-software/eky/actions/runs/34039443687) | Sopimukset läpäisivät; producerin latausvirhe esti artifactin ja consumerit |
| `7ce39f0`, [34040016182](https://github.com/eky-software/eky/actions/runs/34040016182) | Erillinen diagnoosi: consumer 2 source-smoke-virhe ja varmennettu cleanup; consumer 1 ulkoinen timeout ilman omaa terminal- tai cleanup-todistetta |
| `c71f625`, [34052822072](https://github.com/eky-software/eky/actions/runs/34052822072) | Molemmat sarjat kaatuivat watcher-assertioon; producer ja consumerit jäivät ajamatta |

Consumer 1:n viimeinen turvallinen vaihe oli
`historicalLegacyUpgradeLifecycle / majorUpgrade / started`.
Se ei todista MSI:n valmistumista, target first startia, semanttista cleanupia
tai nollaa orpoprosessia. Nykyinen vihreä diagnoosi ei korjaa vanhan ajon
puuttuvaa todistetta.

### Nykyisten korjausten vastuut

Historiallinen source kirjoittaa smoke-resultin muodossa JSON + LF.
`legacyUpgradeSourceSmoke` sallii nykyisen tapahtumapolun odottaa tyhjää
tai keskeneräistä truncate/write-välitilaa. Valmis virheellinen JSON,
liian suuri tai linkitetty tiedosto sekä prosessin exit ilman kokonaista
resultia torjutaan. Historiallista lähdekoodia ei ole muutettu.

`SafeEvidenceWriter` käytti synkronista kirjoitusta samalla säikeellä,
joka ohjaa deadlinea ja Job-cleanupia. Injektoitu pysyvästi odottava
TextWriter todisti sopimusvirheen. Nykyinen kirjoittaja käyttää rajattua
128 rivin ei-odottavaa jonoa ja yhtä prosessin sisäistä background-output-
säiettä. Täysi jono saa pudottaa diagnostiikkaa, ei muuttaa tulosta.
Strict supervisor-result kirjoitetaan erikseen; loppudrain käyttää vain
saman requestin jäljellä olevaa aikaa. Invalid-request-polku ennen Jobin
käynnistystä ei kuulu tämän kokeen kattavuuteen.

Prosessipuun ainoa omistaja säilyy `WindowsJobProcessSupervisor`issa.
`runLegacyUpgrade.mjs` omistaa erilliset postcondition-, profiili- ja
fixture-tarkistukset. Worker ei saa uutta deadline- tai cleanup-omistajaa.
Todistettu output-virhe ei yksin nimeä vanhan CI-timeoutin juurisyytä.

### Historiallinen diagnostinen artifact-raja

Työnkulun aiempi diagnostinen versio käytti samaa build-once-mallia.
Sen ajot eivät muodostaneet hyväksyntäporttia. Nykyinen vaihehyväksynnän
tarkoitus on kuvattu yllä; aiempia ajoja ei nimetä uudelleen.
Kaksi normaalia pnpm-sopimussarjaa läpäisee ennen produceria.
Kaikki jobit käyttävät samaa revisiota. Producer lähettää vain descriptorin
suljetun synteettisen tiedostojoukon SHA-lukituilla actioneilla yhden
vuorokauden retentionilla. Consumerit tarkistavat tavut ennen lifecycleä
ja sen jälkeen, myös virheessä. Profiilit ja yksityiset lokit eivät kuulu
artifactiin. Nykyiset job-/step-rajat ja workerin budjetti säilyvät.

### Historiallinen vihreä packaged-checkpoint

[Diagnostinen ajo 34054510669](https://github.com/eky-software/eky/actions/runs/34054510669)
käytti revisiota `43128e6763cc59472e4a9a3f91c5957a8fd3bf88`.
Kaikki viisi jobia läpäisivät ensimmäisellä yrityksellä ilman rerunia tai
ulkoista timeoutia.

| Job | Tulos | GitHub-jobin kesto |
| --- | --- | --- |
| Sopimussarja 1 | 150/150 | 2 min 21 s |
| Sopimussarja 2 | 150/150 | 2 min 28 s |
| Producer | Yksi tarkistettu source/target-artifact | 7 min 45 s |
| Consumer 1 | `historicalLegacyUpgradeCompleted` | 2 min 45 s |
| Consumer 2 | `historicalLegacyUpgradeCompleted` | 3 min 3 s |

Artifact on historical-source-rebuild: source 0.2.6 revisiosta `6ed99f5`
ja target 0.2.7 testirevisiosta. Se ei ole exact-local-release-todiste eikä
käyttäjälle jaettava pilot-paketti.

| CI-artifact | SHA-256 |
| --- | --- |
| Descriptor | `1183bc32627edd0f934fa6d0557abe526bfc42e1148e9c1add31982524362ac1` |
| Source MSI | `6f2511171fb5e56d1e4d7daa2a2c0e03ad10eb7cf47a6ec12171e8af9ac957c1` |
| Target MSI | `f269ca927db487bb5d51ae44ea2d2ac66d0e30ae320da7ba1bca905f63622c42` |

Molemmat consumerit tarkistivat samat tavut ennen ajoa ja sen jälkeen.
Source install, historiallinen smoke, normaali source-start, legacy
business evidence, major upgrade sekä targetin ensimmäinen ja toinen
käynnistys läpäisivät. Molemmat strict caller-terminalit vahvistivat
`legacyBusinessFixtureValidated=true`, yhden adoptoidun työtilan,
`idempotentSecondStartup=true`, `businessDataPreserved=true`,
`processTreeAbsent=true` ja `fixtureRemoved=true`. Puhtaiden CI-runnerien
normaalin profiilin tiedostomäärä oli 0 -> 0; omistajan profiilia ei käytetty.

Completed-tulos edellyttää onnistunutta semanttista cleanupia ja erillistä
exact ProductCode -jälkiehtoa `exactProductsAbsent`. Omistettuja
orpoprosesseja jäi näissä kahdessa CI-ajossa 0. Tämä ei korvaa aiempien ajojen
puuttuvaa cleanupia tai avoimia paikallisia hyväksyntäportteja.

### V2.5:n hyväksyntään käytetty etenemisjärjestys

Seuraava järjestys kuvaa yllä suljetun V2.5-työpaketin hyväksyntää samassa
`codex/test-harness-v2-legacy-upgrade`-haarassa. Se ei aloita jo varmennettuja
muuttumattoman koodin ajoja uudelleen dokumentaation vuoksi:

1. Tarkista työpuu, local/remote SHA, työkalut ja prosessit. Commitoi vain
   rajattu katselmoitu muutos ja aja puhtaalta revisiolta normaali
   `pnpm --filter @eky/desktop installer:test:windows-supervisor-v2-legacy`.
   Sarja valmistelee normaalit uudet fixturet; retained/shared-fixture-
   diagnostiikkaa ei injektoida normaaliin polkuun.
2. Vihreän normaalin sarjan jälkeen katselmoi diff ja aja artifact-
   kohdetestit sekä desktopin typecheck/build. V2.5:n paketoitu hyväksyntä
   tehdään yllä hyväksytyssä kahden eristetyn Windows-jobin ympäristössä;
   kahta paikallista consumeria tai uutta paikallista MSI-buildia ei vaadita.
3. Pushaa sama revisio normaalisti. Nykyinen V2.5-työnkulku ajaa kaksi
   kokonaista sopimussarjaa, niiden jälkeen yhden producerin ja kaksi
   consumeria ensimmäisellä yrityksellä. Älä käynnistä erillistä
   feasibility- tai diagnostista uusintaa saman hyväksynnän rinnalle.
   Kirjaa pass/fail/cancelled/skipped sekä terminal/cleanup-tulos;
   testitiedoston kaatumisen pienentämä kokonaismäärä ei ole ohitus.
   Älä pushaa tai dispatchaa uudelleen kesken kierroksen.
4. CI:n producer rakentaa oman artifactinsa kerran. Kaksi consumeria
   tarkistaa ja käyttää sen täsmälleen samoja tavuja ennen/jälkeen-ajossa.
   V2.5-vaihe hyväksytään vasta pakollisten paikallisten sopimus- ja
   build-porttien sekä molempien CI-consumerien valmistuttua;
   alkuperäinen virhe ja puuttuva cleanup säilyvät hylkäyksinä.
   Päivitä invarianttien siirtokartta. Muuttumattoman toteutuksen jo varmennettu
   näyttö säilyy omalla revisiollaan; pelkkä sopimuksen dokumentointi ei
   käynnistä manuaalista uusintaa. Nykyiset automaattiset PR-checkit säilyvät.

Tuntematon prosessilopputila tai `cleanupUnverified` pysyy virheenä eikä
myöhempi yleinen nollaprosessikysely muuta sitä onnistumiseksi. Epäonnistuneen
ajon tarpeellinen aineisto säilyy yksityisesti; epäselvässä ympäristössä ei
jatketa MSI-ajoihin. Omistajan erikseen hyväksymä GUI-onnistumispolkujen
30 sekunnin kokonaisbudjetti ja tarkoituksella lyhyet timeout-regressiot
ovat eri sopimuksia; jälkimmäisiä ei muuteta. Konekohtaisen diagnoosin
yksityiskohdat eivät muodosta uutta hyväksyntäporttia eikä niitä julkaista
tässä suunnitelmassa.

V2.1-V2.5:n pinotut checkpointit, mukaan lukien jäädytetty draft-PR #262 ja
vaihekohtaisesti katselmoitu PR #263, säilyvät. V2.6 etenee vain omassa
haarassaan yllä kuvatulla rajauksella. Ei mergeä, versionostoa, pilot-pakettia,
W6-poistoa, tuotantosemantiikan muutosta tai uutta prosessi-/cleanup-omistajaa.
PR #257/#258 ja nykyiset required check -ehdot eivät muutu.

## Ulkoiset tekniset lähteet

- Node.js child process: <https://nodejs.org/api/child_process.html>
- Microsoft nested jobs: <https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs>
- Microsoft `TerminateJobObject`: <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject>
- Microsoft `SetWinEventHook`: <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook>
- Microsoft `MsgWaitForMultipleObjects`: <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-msgwaitformultipleobjects>
- GitHub Actions workflow artifacts: <https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts>
- GitHub Actions concurrency: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
