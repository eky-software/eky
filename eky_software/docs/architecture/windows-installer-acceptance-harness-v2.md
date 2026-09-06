# Windows installer acceptance harness V2

Tämä dokumentti määrittelee Eky-projektin Windows installer -hyväksyntätestien
ylläpidettävän tavoiterakenteen ja siirtymisen nykyisestä W6B-, W6B.2A- ja
W6B.2B-harnessista siihen.

Dokumentti ei muuta tuotantosovelluksen update-, workspace-, backup-, restore-,
tietokanta-, laskutus- tai Electron-runtime-semanticsia. Se ei myöskään anna
lupaa uudelle riippuvuudelle, GitHub Actionille, native-helperille,
versiomuutokselle tai release-artifactille.

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

V2.5 ei vielä poista, muuta tai kutsu vanhaa W6B legacy acceptance -harnessia.
Cutover tehdään vasta, kun kaikki vanhan portin invariantit on nimetty,
V2-vastineet ovat terminal ja paikalliset sekä GitHubin build-once-consumerit
ovat hyväksytysti vihreät.

### V2.5-invarianttien siirtokartta

Taulukko kuvaa kattavuuden omistajuutta, ei anna vielä lupaa vanhan polun
poistamiseen. Lopullisen puhtaan HEADin kaksi paikallista consumer-ajoa ja
kaksi ensimmäisen yrityksen GitHub-consumeria ovat edelleen hyväksyntäportti.

| Vanhan legacy-portin invariantti | V2.5-vastine ja kohdetesti | Poiston ehto |
| --- | --- | --- |
| Historiallinen source-identiteetti ja muuttumattomat MSI-tavut | `legacyUpgradeArtifact` ja sen testit; build-once producer/consumer | Paikallinen ja CI-artifact-varmennus samoille tavuille |
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
ympäristössä. Koko V2.5:n kaksi paikallista ja kaksi GitHub-consumeria
vaaditaan edelleen lopulliselle puhtaalle commitille; alemman tason testejä
ei saa merkitä täydeksi acceptance-todisteeksi.

Ikkunavalmiuden muutos on vielä paikallista keskeneräistä työtä. Laajennetun
kohdesarjan tulos oli 85/86: jo näkyvän ikkunan tapaus päättyi deadlineen.
Erillinen 6/6-ajo tai myöhempi yksittäinen diagnostinen onnistuminen ei kumoa
tätä tulosta. Tuossa epäonnistuneessa ajossa fixturen puuttuva vaihemerkintä
ei vielä erottanut käynnistymistä, `Shown`-odotusta ja sulkemista; juurisyytä
ei ole vahvistettu. Fixtureen lisätyt turvalliset vaiheet tarkentavat jatkorajausta.

### Avoin ikkunavalmiuden checkpoint

V2.5 ei ole hyväksytty. Aiempi etähaaran katselmusrevisio on `abc26ee`;
katselmoitu paikallinen ketju `11103d1`, `0040456`, `32715c6`, `7734d7b`
ja `c3e0fb6` sisältää testituen sekä tutkimusnäytön päivitykset sen päällä.
Omistaja hyväksyi normaalin V2.5-todentamisen jatkamisen yhtenä työpakettina:
vihreät sopimukset, puhdas artifact-revisio, kaksi paikallista consumeria ja
niiden jälkeen draft-PR:n producer sekä kaksi GitHub-consumeria. Supervisor,
aikabudjetit ja hyväksymisehdot pysyvät jäädytettyinä. Historiallinen 102/103
säilyy epäonnistuneena; sitä ei käytetä uuden toteutuksen hyväksyntänä.

Revision `0040456bdf28643970612f81a27c0aa56b2cfc37` normaali V2.5-sarja
päättyi tulokseen **136/137**, ilman retryä tai skippejä. Ainoa virhe oli
`native close observation: visible`: `deadlineExceeded / notChecked /
cleanupUnverified`, `processTreeAbsent=false`. Hyväksyntä jäi epäonnistuneeksi.

Tulos pysäytti siitä riippuvat artifact-, consumer- ja CI-vaiheet.
Hyväksyntäartifactia ei rakennettu eikä koko sarjaa uusittu vihreän toivossa.
Vanhan artifactin tai 81/81-tuloksen identiteettiä ei saa esittää nykyisen
muutoksen hyväksyntänä. Paikalliset diagnostiikat ja jäljet eivät kuulu
katselmointicommittiin.

GUI-testin teardownissa löytyi erillinen testituen puute: result voi ilmoittaa
`cleanupUnverified`, vaikka jo poistuneiden suorien testikahvojen siivous
onnistuu. Aiempi teardown poisti tällöin ajon testijuuren. Nykyinen pieni
korjaus säilyttää epäonnistuneen GUI-ajon resultin, mittaukset ja kerran
käännetyn fixturen yksityisessä TEMP-juuressa. Myös ennen/jälkeen-identiteetin
virhe säilyttää aineiston. Olemassa oleva cleanup sulkee yhä kaikki sen omat
kahvat; säilytysvalinta estää vain tiedostojen poiston. Se ei muuta
supervisorin tulosta tai peitä cleanupin virhettä eikä lisää retention-
järjestelmää tai prosessiomistajaa.

Muuttuneen cleanup-vastuun kohdetestit läpäisivät **6/6**: säilytys
ei ohita oman sentinelin sulkemista, resultin epäonnistuminen säilyy eikä
marker-virhe katoa kummallakaan säilytysvalinnalla. GUI-sarja läpäisi
**6/6**, mukaan lukien odotettu `absent`-deadline ja varmennettu
Job-cleanup. Tämä testaa teardown-muutosta, ei kumoa 136/137-tulosta.
Tämän jälkeen koko muuttunutta tukea käyttävä supervisorin contract- ja
result-sarja läpäisi **41/41**, mukaan lukien myöhäisen luonnin
komentotason result/exit-raja, nested Job ja rinnakkaisten puiden eristys.
Supervisorin toteutus ei muuttunut. `git diff --check` läpäisi.

Revision `32715c6d520bb70db77a12c6a086398df72afa1f` normaali sarja päättyi
tulokseen **138/139**. Release-buildit: 0 warnings / 0 errors. Virhe oli
`visible`, `deadlineExceeded / notChecked / cleanupUnverified`,
`processTreeAbsent=false`. Artifact- ja CI-vaiheita ei käynnistetty.

#### Koko sopimussarjan diagnostinen Windows-vertailu 6.9.2026

Omistaja hyväksyi rajatun poikkeuksen paikalliseen vihreään preflightiin:
katselmoitu V2.5-ketju saa edetä normaalilla pushilla yhteen diagnostiseen
GitHub-kierrokseen paikallisen **138/139**-tuloksen ollessa yhä epäonnistunut.
Nykyisen supervisor-feasibility-työnkulun manual-valinta
`mode=legacy-contracts-diagnostic` ajaa kahdella erillisellä Windows-runnerilla
täsmälleen komennon `pnpm installer:test:windows-supervisor-v2-legacy`.
Sarja rakentaa nykyisen supervisorin ja käyttää normaalin testipolun kerran
käännettyä GUI-fixtureä. Testilistaa, testikoodia, 10000/1000 ms oletuksia,
jobin 10 minuutin rajaa tai required-check-ehtoja ei muuteta. Työnkulun
tavallinen sopimusajo ja aiempi yhden ikkunan diagnoosi säilyvät ennallaan.

Molemmat ensimmäisen yrityksen tulokset säilyvät; `fail-fast: false`, ei
rerunia, skip-muunnosta tai `continue-on-error`-poikkeusta. Turvallinen
metadata sitoo revision, repetitionin, runner-imagen sekä Node- ja SDK-version.
Diagnostiikka ei rakenna MSI:tä, producer-/consumer-artifactia eikä käynnistä
W6-matriisia. Vihreäkään vertailu ei hyväksy V2.5:tä tai kumoa paikallista
epäonnistumista. Se erottaa konekohtaisen havainnon toistumisesta kahdessa
puhtaassa runner-ympäristössä, ei yksin todista natiiviodotuksen aiheuttajaa.

#### Vertailun päätetulos ja jatkopäätös 6.9.2026

[Diagnostiikka 34000831989](https://github.com/eky-software/eky/actions/runs/34000831989)
ajettiin revision `eba5ac261ba91618f03465eb14a731fb32ae4d3b` ensimmäisenä
yrityksenä kahdella erillisellä runnerilla. Image oli `win25-vs2026`, versio
`20260824.214.3`, Node `24.19.0`, SDK `10.0.302`. Molemmat buildit olivat
varoituksettomia ja virheettömiä. Molempien jobien terminal oli **failure**:

| Ajo | Jobin kesto | Sarjan kesto | Raportoitu testitulos | visible native / terminal |
| --- | --- | --- | --- | --- |
| 1 | 2 min 22 s | 61,33 s | 132/136, 4 failed, 0 skipped | 9,83 / 275,62 ms |
| 2 | 2 min 18 s | 54,22 s | 132/136, 4 failed, 0 skipped | 17,00 / 311,92 ms |

GUI:n kaikki viisi tilaa läpäisivät molemmilla; `absent` todisti odotetun
deadlinen sekä Jobin tyhjenemisen. Muut tilat valmistuivat, sentinelit
säilyivät ja identiteetti/linkkimäärä pysyi samana (1 -> 1). Fixture
käännettiin kerran kummallakin runnerilla, ei samaksi yhteiseksi artifactiksi.
Koko sarja ei ole vihreä: observer-tiedoston natiivikaatuminen esti sen
neljän testin rekisteröinnin, mistä raportin 136 eikä odotettu 139 johtuu.

- **Todistettu diagnostiikkakytkennän virhe:** `EKY_DOTNET_EXE` puuttui.
  Kaksi nested-Job-testiä muodosti suhteellisen `command: dotnet` -pyynnön,
  jonka strict lukija hylkää `requestCommandInvalid`-tilaan ennen käynnistystä.
  Sama hylkäys toistettiin paikallisesti muuttumattomalla supervisorilla.
  Absoluuttisella SDK-polulla nykyiset kaksi testiä läpäisivät 2/2.
  Pienin korjaus sitoo jo asennetun ja versionvarmennetun SDK:n nykyiseen
  ympäristömuuttujaan vain uudessa diagnostisessa workflow-valinnassa.
  Korjausta ei lasketa CI-hyväksytyksi eikä epäonnistunutta kierrosta uusittu.
- **Uusi erillinen havainto:** `legacyUpgradeStartupObserver.test.mjs`
  keskeytyi libuvin `fs-event.c:72`-assertioon molemmilla runnereilla.
  [libuv #5010](https://github.com/libuv/libuv/issues/5010) ja
  [Node #63638](https://github.com/nodejs/node/issues/63638) kuvaavat saman
  Windows-tiedostoseurannan virheluokan. Lyhyen/pitkän polun ero on rajattu
  seuraava hypoteesi, ei vielä tässä repossa toistettu juurisyy. Testiä tai
  observeria ei muutettu; seuraava todiste käyttää vain sen nykyistä rajaa.
- **Avoin worker-fixture:** live-child-testissä `processExitFailed / exit 1`
  säilyi ja `processTreeAbsent=true`, mutta cleanup oli `notRequired`, ei
  testin edellyttämä `processTreeAbsent`. Lokista ei selviä, jäikö lapsi
  käynnistymättä vai poistuiko se aiemmin. Odotusta ei löysennetä: tarvitaan
  juuri fixturen vaihe- ja lapsen elinkaaritodiste, ei uusi valvoja.

Normaalin 138/139-ajon hylkäys säilyy. GUI-integraation budjetin mahdollinen
eriyttäminen keinotekoisista timeout-regressioista vaatii vielä mitatun
perusteen ja päätöksen; kumpaakaan budjettia ei muutettu. V2.5-hyväksyntään
palataan vasta rajattujen vikojen regressioiden, eheän kohdesarjan ja
puhtaan revision sovittujen artifact-/consumer-porttien jälkeen. CI:n
runner-cleanup poisti kääntäjäpalvelimen ja konsoliprosessin; koko runnerin
orpoprosessien nollatulosta ei siksi väitetä omaksi todisteeksi. Ei MSI:tä,
V2.6:ta, mergeä tai tuotantosemantiikan muutosta tämän vertailun perusteella.

#### Observerin polkukorjaus

Windowsin 8.3-TEMP-alias toisti observerin `fs-event.c:72`-assertion.
Worker-testit läpäisivät myös lyhyellä polulla. Tämä erottaa observerin
polkurajan workerin erillisestä cleanup-sopimuksesta.

Nykyinen `legacyUpgradeStartupObserver` antaa native-watcherille `realpath`-
polun vasta hakemiston `lstat`- ja file identity -tarkistusten jälkeen.
Tapahtumien lukeminen, identiteettisidonta ja virheluokitus säilyvät ennallaan.
Ei uutta valvojaa, polling-fallbackia tai aikarajamuutosta. Oikea Windowsin
8.3-alias ja hakemistolinkin torjunta on lukittu käyttäytymisregressioilla.
Korjattu kohdepari läpäisi 10/10 sekä tavallisella että täsmälleen aiemman
epäonnistumisen lyhyellä TEMP-polulla. Suorat legacy-regressiot läpäisivät
47/47, ei skippejä. Nämä eivät korvaa epäonnistuneita paikallisia tai CI-sarjoja.

#### Katselmointipisteen jälkeinen rajattu korjaus

Workerin avoin CI-havainto rajataan nykyisen fixturen sisällä: testi vaatii
requestin lukemisen, lapsen käynnistyskuittauksen, oikean workerin paluun
sekä lapsen elossaolon ennen parentin exitia. Nämä tarkistetaan ennen
supervisorin cleanup-odotusta; aiempi `notRequired` ei enää peitä puuttuvaa
esiehtoa. Julkinen diagnostiikka sisältää vain version ja suljetut vaihenimet,
ei PID:tä, polkua tai raakavirhettä. Paikallinen worker-kohde läpäisi 4/4.
Nykyisen feasibility-workflown `legacy-worker-diagnostic` ajaa vain saman
testitiedoston kahdella runnerilla ilman MSI:tä tai koko V2.5-sarjaa.
Tulos on diagnostiikka, ei acceptance. Supervisor, cleanup-omistus ja
10000/1000 ms rajat säilyvät muuttumattomina.

- `legacyUpgradeFailureBoundary` luokittelee myös onnistuneen supervisorin
  jälkeen puuttuvan tai lukukelvottoman scenario-resultin. Alkuperäinen virhe,
  semanttinen cleanup ja jälkiehto säilyvät erillisinä. Puuttuva tulos ei
  valtuuta uninstallia: callerin täytyy toimittaa ennen ajoa vahvistettu
  exact-products-absent-esiehto. Epäselvä prosessipuu estää sekä uuden
  tuoteverifierin että semanttisen cleanupin.
- `runLegacyUpgrade` ei enää poista testijuurta ehdottomasti `finally`ssa.
  Ennen käynnistysyritystä syntynyt turvallinen fixture voidaan poistaa;
  käynnistetyn ajon juuren poisto vaatii varmennetun prosessipuun poissaolon
  sekä onnistuneen cleanupin ja exact-products-absent-jälkiehdon. Puuttuva
  supervisor-result, epäonnistunut cleanup tai turvallisuuspoikkeama säilyttää
  yksityisen aineiston paikallisesti. Turvallinen päätetulos kertoo erikseen
  `fixtureCleanupResultCode`- ja `fixtureRemoved`-arvot, ei paikallista polkua.
- Nykyisen `LateProcessCreationContract`-fixturen komentotason testi pitää
  luontirajan injektoidusti auki attribuutin ja Job-referenssin elossa ollessa.
  Ulkopuolinen Node-testi lukee oikean strict resultin komentoprosessin ollessa
  vielä elossa, vapauttaa vain fixturen exit-kuittauksen ja todistaa exit 1:n.
  Result säilyy muuttumattomana: `deadlineExceeded / cleanupUnverified /
  processTreeAbsent: false`. Tämä täydentää aiempaa Run-rajan testiä; se ei
  väitä pysäyttävänsä oikeaa Windowsin kernel-kutsua eikä muuta supervisorin
  toteutusta, deadlinea tai tuotannon poistumisjärjestystä.
- Virhepolkujen ja suorien legacy-sopimusten paikallinen kohdesarja: 56/56.
  Myöhäisen valmistumisen ja komentotason kohdesarja: 5/5 viimeistellyllä
  fixturellä. .NET Release-buildit: 0 warnings / 0 errors; desktop typecheck,
  desktop build ja `git diff --check` läpäisivät. Nämä eivät korvaa koko V2.5-
  sarjaa, puhtaan revision artifactia tai sovittuja paikallisia/CI-consumereita.

Ikkunatestin 10000 ms tulee `createRequest`-apurin alkuperäisestä V2.1-
oletuksesta (`9c5dcf8`), ei erikseen hyväksytystä ikkunan suorituskyky-SLO:sta.
Readiness on jo tapahtuma-/tilaehtopohjainen; enimmäisaika säilyy
fail-closed-turvarajana. Aikarajaa ei muutettu. Sen mahdollinen muutos vaatii
mittausperusteen ja omistajan dokumentoidun päätöksen; keinotekoisten timeout-
ja cleanup-regressioiden tiukat rajat säilyvät.

Nykyisen supervisor-feasibility-työnkulun manual-valinta
`mode=window-startup-diagnostic` ajaa vain yhden `visible`-tapauksen
nykyisellä ikkunatestillä ja kerran käännetyllä fixturellä. Tavallinen
kahden ajon sopimusportti ei muutu. Tulos on diagnostiikkaa, ei acceptance,
eikä ajo käynnistä MSI/W6-matriisia tai automaattista uusintaa.

Identiteettijälkitarkistuksen virhe ei saa keskeyttää myöhempiä
cleanup-hookeja. Tarkistus ja nykyisten kontekstien cleanup suoritetaan
samassa testikohtaisessa teardownissa erilliset virheet säilyttäen.
Legacy-virhepolkujen kohdesarja läpäisi 56/56.

Rajattu GitHub-vertailu valmistui ensimmäisellä yrityksellä commitista
`50225e57c309c06984d20ecf3f846bb6e220178c`:
[ajo 33966600849](https://github.com/eky-software/eky/actions/runs/33966600849),
yksi Windows-jobi, 1/1 `visible`-testi, ei acceptance-matriisia tai rerunia.
Native-kutsu kesti 13,59 ms (92,27 -> 105,86 ms), supervisorin terminal
328,68 ms. Strict tulos oli `processCompleted / workerResultValidated /
notRequired / processTreeAbsent: true`. Sentinel-cleanup läpäisi.
Fixture-SHA-256 oli
`7b7071834f1bad3f8e830836535189a0e7676da1370a64e5afee5de67431874d`;
linkkimäärä pysyi 1 -> 1, file-id ja tavut säilyivät. Testin aikabudjetti oli
muuttumaton 10000 ms ja cleanup-reserve 1000 ms. .NET-buildit olivat
virheettömät. Uusia riippuvuuksia ei lisätty eikä MSI-artifactia rakennettu.

Yksi vihreä diagnostinen CI-ajo ei hyväksy V2.5:tä. 56/56-virhepolkusarja
ja 5/5-omistajuussarja läpäisivät; koko V2.5:n 102/103 säilyy epäonnistuneena.

#### Tarkennettu paluusopimus

`runLegacyUpgrade.test.mjs` vaatii nyt `completed`-tapaukselta nimenomaisen
poikkeuksettoman paluun sekä oikean `completed`-tilan ja result-koodin.
Jokainen seitsemästä virhetapauksesta vaatii hylätyn paluun ja oman odotetun
virhekoodinsa. Yhteinen catch ei enää voi hyväksyä epäonnistunutta
onnistumistapausta pelkän onnistuneen siivouksen perusteella. Muuttuneen
testitiedoston Windows-kohdesarja: 12/12. Runnerin ja supervisorin
toteutukset eivät muuttuneet.

Lukurajat: [NtQueryInformationFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntqueryinformationfile),
[FileHardLinkInformation-rakenne](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_link_entry_information)
ja [OpenFileById](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-openfilebyid).

#### Testituen siivousraja

`WindowContract.exe` syntyy Windowsin .NET Framework64:n `csc.exe`-builderilla;
supervisor ja mittausfixturen assembly rakennetaan lukitulla .NET SDK:lla.
Näitä ei käsitellä samana käännöspolkuna eikä kääntäjää vaihdettu.
Ennen/jälkeen-identiteetti vertaa `lstat`-metadatan `dev`- ja `ino`-arvoja,
kokoa, linkkimäärää ja SHA-256:ta. GUI-fixturen `File.Copy` kopioi vain
synteettisen JSON-tulosmallin worker-resultiksi, ei executablea. Tämä
lähdekatselmus ei tunnista mahdollista ulkopuolista tiedostomuuttajaa.

`supervisorContractTestSupport.cleanupRunContext` poisti testijuuren myös
epäonnistuneen prosessi- tai marker-tarkistuksen jälkeen, ja
`terminateChildHandles` keskeytti saman ryhmän myöhempien kahvojen käsittelyn
ensimmäiseen timeoutiin. Kolme käyttäytymisregressiota toistivat virheet:
1/3 läpäisi ennen korjausta, 3/3 sen jälkeen. Nykyinen toteutus käsittelee
muut omistetut kahvat, säilyttää ensimmäisen cleanup-virheen ja poistaa
testijuuren vain onnistuneiden cleanup-tarkistusten jälkeen. Uutta
cleanup-omistajaa ei lisätty eikä supervisorin C#-toteutusta muutettu.

Suoraan muuttunutta testitukea käyttävä rajattu Windows-sarja läpäisi
14/14: uudet kolme regressiota, käännösfixturen failure/timeout,
normaali ja ei-nolla-exit, mittaustuloksen kirjoitusvirhe, myöhäisen luonnin
kolme tapausta, komentotason pending-creation ja foreign sentinel. Testituen
10 sekunnin handle-timeout simuloidaan uudessa regressiossa Node-testin
mock-kellolla; todellisia aikarajoja, sleepiä tai retryä ei muutettu.

Checkpoint-katselmuksessa lisätty neljäs regressio todistaa myös synkronisen
kahvavirheen: täsmälleen sama virheolio säilyy, seuraava prosessiryhmä
käsitellään ja yksityinen evidenssi jää talteen. Nykyinen rajattu Windows-sarja
läpäisi 15/15, ei skippejä tai retryjä. Helper palauttaa vain
cleanupin ensimmäisen virheen; se ei omista tai korvaa varsinaisen testin
virhettä, jonka Node-testirunner raportoi erillään teardownin tuloksesta.

#### Hyväksytty GUI-fixturen sopimus

Omistaja hyväksyi 5.9.2026 GUI-fixturen linkkihavainnon erottamisen
eheys- ja toimintatarkistuksista. Sulkemistestin invariantti on oman
ikkunaprosessin toiminta ja poistuminen. Rajaus koskee vain kerran
käännettyä `WindowContract.exe`-fixtureä:

- Provenance säilyy: tunnetut repositoryn lähteet, nykyinen kääntäjä ja
  argumentit, onnistunut supervisorin omistama käännös sekä alkuperäinen
  itsenäinen tiedosto. Harness ei luo executable-hardlinkkejä tai rakenna
  uutta fixtureä saadakseen vihreän tuloksen.
- Ennen/jälkeen-tarkistukset sitovat alkuperäisen kanonisen testijuuripolun,
  regular-file-tyypin, symlink-/polkurajan, device/file-id:n, koon ja SHA-256:n.
  Polun, tiedostoidentiteetin tai tavujen vaihtuminen hylätään edelleen.
- Ajonaikainen linkkimäärä on turvallinen erillinen havainto, ei yksin
  GUI-onnistumisen hylkäys. Tämä ei todista tiedoston olevan kaikkina hetkinä
  muuttumaton eikä korvaa tuotannon tiedostoturvallisuuden testejä.
- Ikkunan valmius ja sulkeminen, worker-result, root-exit, Job-empty,
  foreign sentinel ja cleanup säilyvät erillisinä pakollisina tuloksina.
  Ei vendor-allowlistiä tai suojausprosessin tutkintaa normaaleihin testeihin.

Root-AGENTS:n hardlink-kloonauskielto sekä tuotannon, releasen,
backupin ja updaten linkki- ja containment-politiikat eivät muutu.

Toteutus keskittää vain tämän fixturen eheyden lukemisen ja vertailun
`windowsApplicationCloseFixtureIdentity`-testitukeen. Tiedostokahvan `stat`
sidotaan ennen/jälkeen-polkuhavaintoihin; regular-file-, juuri-, file-id- ja
SHA-tarkistukset eivät riipu linkkimäärästä.
Identiteettiregressiot sekä normaali GUI-sarja läpäisivät 14/14.
Alkuperäinen 10000/1000 ms raja säilyi, ei retryä. Odotettu `absent`-deadline
ja varmennettu Job-cleanup ovat erillisiä pakollisia tuloksia.

Katselmuksessa lisättiin vielä rajattu regression tapaus, jossa testijuuri
vaihtuu mutta leaf-file-id, kanoninen tiedostopolku ja tavut pysyvät samoina.
Se hylätään juuren identiteetillä. Lopullinen identiteettikohdesarja läpäisi
9/9, ilman GUI-kokeen tai käännöksen uusintaa. Kuuden normaalin
GUI-tapauksen toteutus ei muuttunut tämän jälkeen. Uusi testitiedosto kuuluu
pysyvästi olemassa olevaan `installer:test:windows-supervisor-v2-legacy`-
komentoon; package.jsonin versio ja riippuvuudet eivät muutu. Koko V2.5-
sarjaa tai artifact/consumer-portteja ei ajettu tässä rajatussa checkpointissa.

Tilapäinen `EKY_V25_SHARED_FIXTURE`-valinta ja sen paikallisen tiedoston
lukupolku poistettiin normaalista testistä. Diagnostiikka ei korvaa
paikallista tai GitHub-hyväksyntää.

#### Aiemmat korjaukset ja mittaukset

Omistaja hyväksyi tämän jälkeen kaksi rajattua korjausta olemassa olevaan
supervisoriin: native-prosessinluonnin deadline-rajan ja Job-laskurin /
prosessin exit-signaalin havaintojärjestyksen. Paikallinen toteutus käyttää
yllä kuvattua atomista Job-attribuuttia ja samaa alkuperäistä aikabudjettia.
Vanha jälkikäteen tehty Job-assignment sekä sen erillinen direct-process-
termination-haara poistuvat; uutta prosessipuun omistajaa ei lisätä.

Uusi `ProcessBoundaryContract` kuuluu vain nykyiseen contract-fixture-
assemblyyn. Se todistaa suspended-jäsenyyden ennen resumea, luontia edeltävän
cancelin, myöhäisen paluun, palaamatta jäävän luontikutsun, alkuperäisen
Win32-virheen, odottamattoman luontivirheen cleanupin ja molemmat exit-
havaintojärjestykset. Testiohjausta ei lisätä varsinaisen supervisorin CLI-
protokollaan. Supervisorin sopimussarja meni läpi 28/28; timeout ja kahden
omistetun prosessisukupolven cleanup toistettiin 20 kertaa ilman retryä.
Foreign sentinel ja rinnakkaisten Jobien eristys säilyivät. Molempien .NET-
projektien Release-build oli 0 warnings / 0 errors.

V2.5:n koko kohdesarja jäi tulokseen 96/97. Tulos oli
`deadlineExceeded / cleanupUnverified`, `processTreeAbsent: false`.
Tämä ei ole hyväksytty cleanup tai V2.5-hyväksyntä. Käännösfixturen kolme
sopimustestiä läpäisivät, myös timeout-jälkeläisten poissaolo ja vieraan
prosessin säilyminen.

DLL/PowerShell-host-kokeilu poistettiin kokonaan; DLL-hostia tai uutta
bootstrap-tiedostoa ei jätetä toteutukseen. Kokeen 93/97 ei ole hyväksyntä.
Aikarajaa, assertioita tai tuotannon käynnistystä ei muutettu.

Seuraava hyväksyntä tarvitsee tämän saman native-fixturen luontiviiveen
syyn ja sovitun koko sarjan vihreän tuloksen. Ennen sitä ei tehdä valmista
V2.5-checkpoint-committia, artifact-buildia, CI-kierrosta tai V2.6-aloitusta.
Alla säilytetty 85/86-havainto kuvaa korjausta edeltävää tilannetta, ei
nykyisen supervisorin deadline-käyttäytymistä.

#### Luontirajan mittaus ja myöhäinen valmistuminen

Nykyisen paikallisen diffin rajaus erottaa valmistelun, `CreateProcessW`-
P/Invoke-rajan, kahvojen vastaanoton ja myöhemmän fixturen readinessin.
Mittauspisteiden välissä ei kirjoiteta tiedostoa tai konsolia: ajat kerätään
nykyisen contract-fixturen muistiin ja suljettu numerodata tallennetaan vasta
supervisorin palattua. Mittaustiedoston kirjoitusvirhe ei muuta alkuperäistä
prosessin, workerin tai cleanupin tulosta. Varsinaisen supervisorin CLI ei
saa uutta diagnoosimoodia. Native-ikkunatesti käyttää samaa supervisorin
`Run`-toteutusta mittaavan contract-entrypointin kautta.

Koko V2.5-kohdesarja jäi tulokseen **102/103**. Epäonnistunut tapaus oli
`native close observation: visible`. `deadlineExceeded / cleanupUnverified /
processTreeAbsent: false` säilyy epäonnistumisena.

Myöhäisen valmistumisen omistajuus korjattiin erikseen nykyisen supervisorin
sisällä. Kolme determinististä regressiota vapauttaa luontitehtävän vasta
`Run`-virhetuloksen jälkeen: native-kutsu alkaa myöhässä, valmis kahva palautuu
myöhässä tai luontitehtävä epäonnistuu myöhässä. Ensimmäinen tapaus pitää
Job-attribuutin ja kahvareferenssin elossa deadlinen yli ja todistaa Jobin
olleen tyhjä ennen myöhäistä luontia. Kaikki tapaukset todistavat kahvojen
sulkemisen ja täsmällisen prosessin poistumisen erillisellä pinnatulla
prosessikahvalla. Workeria ei resumeta. Jälkikäteen havaittu poissaolo ei
muuta alkuperäistä `cleanupUnverified`-resultia onnistumiseksi.

`PROC_THREAD_ATTRIBUTE_JOB_LIST` on nykyisen Win32-adapterin rajattu korvaus
erilliselle create–Assign-välille, ei viivekorjaus. Attribuuttilista ja sen
Job-arvomuisti vapautetaan vasta native-kutsun päätyttyä, Job-kahva säilytetään
SafeHandle-referenssillä ja prosessi/thread-kahvat saavat aina omistajan.
Kaksi regressiota todistaa atomisen liittämisen jo perityn Jobin sisällä:
normaali exit sekä jälkeläisen timeout-cleanup. Ne eivät lupaa yhteensopivuutta
mielivaltaisten ulkoisten Job-rajoitusten kanssa; ristiriita jää fail closed.
Taustalla ovat Microsoftin
[Job-lista-attribuutin sopimus](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
ja [nested Job -ehdot](https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs).

Tämän tarkistuksen omistajuuskohdetestit olivat 5/5, supervisorin ja
käännösfixturen kohdesarja 36/36 sekä mittaustiedoston virheregressio 1/1.
Koko 103 testin sarjassa näistä jokainen pysyi vihreänä, mutta visible-
käynnistys esti hyväksynnän. Aiempia 96/97- tai 85/86-sarjoja ei poisteta
historiasta eikä yksittäisistä vihreistä diagnooseista tehdä korvaavaa
hyväksyntää. Lopullisia acceptance-toistoja, MSI-artifact-buildia,
CI-consumereita tai V2.6:ta ei aloiteta tämän avoimen virheen yli.

#### Kontrolloitu vertailu ja komentotason katselmus

Tilapäinen yhteisen fixturen valinta poistetaan ennen valmista checkpointia.
Contract-entrypoint, native-luontilippujen omistaja, 10000 ms:n budjetti,
1000 ms:n cleanup-reservi ja foreign sentinel säilyvät. Noncet ja tulospolut
ovat ajokohtaiset.

Checkpointissa `7ecd017` myöhäisen valmistumisen regressioiden kattavuus täsmennettiin lukemalla
todellinen `SupervisorProgram.Run -> execute -> TryWriteResult -> exit`
-järjestys. `LateProcessCreationContract` odottaa myöhäisen valmistumisen
`WindowsJobProcessSupervisor.Run`-palautuksen jälkeen mutta ennen kuin
`execute` palautuu ja komentotulos kirjoitetaan. Se todistaa Run-rajan ja
kahvojen luovutuksen, ei myöhäistä completionia jo päättyneen komentoprosessin
jälkeen. Vanha `creationPending` taas todistaa strict-virhetuloksen ja
komentoprosessin exitin, kun suspended-lapsi on jo luotu ja luontitehtävän
palautus pidetään auki. Puuttuvaksi jää yhdistetyn komentotason tapauksen
deterministinen näyttö, jossa attribuuttireferenssin omistama varsinainen
native-luonti on yhä kesken result-write/exit-rajalla. Tuntematon cleanup
pysyy virheenä. Jo todistettuja regressioita ei rakenneta uudelleen eikä
supervisoria muuteta tämän katselmuksen perusteella. Yllä kuvattu myöhempi
komentotason fixture täydentää tätä aukkoa injektoidun viiveen osalta;
varsinainen Windows-viive pysyy erillisenä tutkimuksena.

#### Korjausta edeltävän mittausrajan täsmennys

Korjausta edeltävä kohdesarja jäi 85/86:een. `deadlineExceeded` ja
`cleanupFailed` eivät todista onnistunutta cleanupia. Valmistelu, native-luonti
ja Job-assignment on erotettava, eikä aikarajoja muuteta oletuksen perusteella.

Käännösfixturen valmistelusta on poistettu suoran PowerShell-prosessin
bounded-adapteri. `fixtures/buildWindowsApplicationCloseFixture.mjs` käyttää
samassa valmisteluvaiheessa yhtä nykyisen Job-supervisorin instanssia ja
Windowsin jo mukana olevaa .NET Framework C# -kääntäjää. Kääntäjä ja sen
jälkeläiset kuuluvat siihen Jobiin; valmistelu ei ole sisäkkäinen scenario-
supervisor. Käännös ei kuulu packaged scenario workerille eikä asenna pakettia.
`buildWindowsApplicationCloseFixture.test` todistaa kääntäjän ei-nolla-exitin
alkuperäisen virheen sekä simuloidun kääntäjän ja sen lapsen timeout-cleanupin
foreign sentinelin säilyessä. Kohdetulos oli 3/3, mutta sitä ei tulkita koko
valmistelurajan hyväksynnäksi.

Oikean käännösajon valmistelu paljasti lisäksi `processStateInvalid`-tuloksen
nykyisessä supervisorissa: Jobin aktiivisten prosessien laskuri oli nolla,
mutta juuriprosessin kahva ei ollut vielä signaloitu. Nämä ovat kaksi eri
havaintoa, eivät atominen snapshot. Tämän rajan korjaus ja deterministinen
regressio sekä prosessinluonnin deadline-/cleanup-sopimus on katselmoitava
nykyisen supervisorin vastuuna. Uutta valvojaa, sokkoretryä, pidempää timeoutia
tai fixturen lämmitysajoa ei lisätä hyväksynnän saamiseksi.

Yksittäiset erillisen native-sarjan 6/6-ajot eivät kumoa koko sarjan virhettä.
Koko V2.5-hyväksyntä pysyy avoimena, kunnes muuttumattoman toteutuksen sovitut
kohdesarjat sekä puhtaan revision artifact- ja consumer-portit ovat vihreät.
Keskeneräistä muutosta ei commitoida tai pushata valmiina, eikä vanhaa W6-
porttia poisteta tämän näytön perusteella.

## Migraatiojärjestys

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

Katselmus ja V2-suunnitelma ovat valmiit. V2.1-feasibility ja V2.2 clean
install / uninstall on toteutettu pinottuina draft-checkpointteina. V2.3
erottaa build-once artifact producer/consumer -rajan ennen upgrade-polun
migraatiota. V2.4 upgrade/rollback on jäädytetty draft-PR:ään #262. V2.5A:n
historical legacy build-once artifact -raja on toteutettu, ja V2.5B:n yhden
supervisorin lifecycle sekä erillinen postcondition-raja ovat paikallisessa
checkpoint-toteutuksessa. `eba5ac2` on jaettu diagnostinen katselmusrevisio, ei hyväksytty
V2.5. Virhepolkujen, komentotason kattavuuden ja sen jälkeisen testituen
siivouskorjauksen näyttö on kuvattu avoimen checkpointin kohdalla.
GUI-fixturen sopimusmuutos ja epäonnistuneen ajon aineiston säilytys ovat
toteutettuja. Revision `32715c6` koko sarja jäi 138/139:ään. CI-vertailun
`34000831989` molemmat sarjat jäivät 132/136:een. Nämä eivät ole V2.5-hyväksyntä.
V2.6 ei ole alkanut. PR #257 ja PR #258 sekä nykyiset W6B-, W6B.2A- ja
W6B.2B-toteutukset säilytetään muuttumattomina. V2-checkpointit eivät vielä
vaihda nykyisen acceptance-harnessin auktoritatiivista ajopolkua.

## Ulkoiset tekniset lähteet

- Node.js child process: <https://nodejs.org/api/child_process.html>
- Microsoft nested jobs: <https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs>
- Microsoft `TerminateJobObject`: <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject>
- Microsoft `SetWinEventHook`: <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwineventhook>
- Microsoft `MsgWaitForMultipleObjects`: <https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-msgwaitformultipleobjects>
- GitHub Actions workflow artifacts: <https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts>
- GitHub Actions concurrency: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
