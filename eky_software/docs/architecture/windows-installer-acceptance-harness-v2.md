# Windows installer acceptance harness V2

Tämä dokumentti määrittelee Eky-projektin Windows installer -hyväksyntätestien
ylläpidettävän tavoiterakenteen ja siirtymisen nykyisestä W6B-, W6B.2A- ja
W6B.2B-harnessista siihen.

Dokumentti ei muuta tuotantosovelluksen update-, workspace-, backup-, restore-,
tietokanta-, laskutus- tai Electron-runtime-semanticsia. Se ei myöskään anna
lupaa uudelle riippuvuudelle, GitHub Actionille, native-helperille,
versiomuutokselle tai release-artifactille.

## Lähtötilanne

Katselmus tehtiin 3.9.2026 seuraavasta puhtaasta checkpointista:

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
- liittää worker nimeämättömään Job Objectiin ennen `ResumeThread`-kutsua
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
workerin exit code on nolla, terminal result on nykyiseen ajoon sidottu ja
jobin aktiivisten prosessien määrä on nolla.

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

Katselmus ja V2-suunnitelma ovat valmiit. V2.1-feasibility on hyväksytty
yllä rajatulla sopimuksella. PR #257 ja PR #258 sekä nykyiset W6B-, W6B.2A-
ja W6B.2B-toteutukset säilytetään muuttumattomina. V2.1 ei vielä vaihda
nykyisen acceptance-harnessin auktoritatiivista ajopolkua.

## Ulkoiset tekniset lähteet

- Node.js child process: <https://nodejs.org/api/child_process.html>
- Microsoft nested jobs: <https://learn.microsoft.com/en-us/windows/win32/procthread/nested-jobs>
- Microsoft `TerminateJobObject`: <https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject>
- GitHub Actions workflow artifacts: <https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts>
- GitHub Actions concurrency: <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>
