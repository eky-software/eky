# Windows installer acceptance harness V2

Tämä dokumentti määrittelee Eky-projektin Windows installer -hyväksyntätestien
ylläpidettävän tavoiterakenteen ja siirtymisen nykyisestä W6B-, W6B.2A- ja
W6B.2B-harnessista siihen.

Dokumentti ei muuta tuotantosovelluksen update-, workspace-, backup-, restore-,
tietokanta-, laskutus- tai Electron-runtime-semanticsia. Se ei myöskään anna
lupaa uudelle riippuvuudelle, GitHub Actionille, native-helperille,
versiomuutokselle tai release-artifactille.

Ajantasainen etenemispäätös ja tilataulukko ovat kohdassa
[Nykyinen päätös](#nykyinen-päätös), jonka testikartta erottaa toteutetut
vastuut vielä siirtämättömistä. Historialliset checkpointit eivät korvaa
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

Tämä ja seuraavat vanhaa W6-ketjua kuvaavat luvut kuuluvat yllä nimettyyn
historialliseen lähtötilanteeseen. Ne eivät ole nykyisen V2-revision inventaario.

Lähtötilanteen lähdepuussa oli 659 varsinaista `*.test.*`- tai `*.spec.*`-tiedostoa
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

Kutsu saa fixtureksi vain eksplisiittisen clean-artifact-descriptorin. Ennen ajoa
manifestin ja MSI:n pitää olla tavallisia itsenäisiä tiedostoja, niiden
manifestisidoksen pitää täsmätä ja lähdetiedostot kopioidaan uusina tavuina
ajokohtaiseen TEMP-juureen. Symlinkki, hardlinkki, tuntematon manifesttikenttä,
väärä hash tai polun ulosjuoksu torjutaan ennen MSI-operaatiota. Lähdefixture
varmennetaan uudelleen ajon jälkeen eikä sitä poisteta tai muuteta.

Clean lifecycle etenee yhdessä strict worker -sopimuksessa:

Caller tarkistaa exact-tuotteen poissaolon nykyisellä read-only-adapterilla
jo ennen supervisorin käynnistämistä. Epäonnistunut tai varmentamaton
ennakkotarkistus ei valtuuta uninstallia. Myös workerin myöhempi
precondition-hylkäys estää semantic cleanupin: toinen asennus ei muutu
testin omaksi pelkän virhetuloksen vuoksi.

1. exact ProductCode, installer-rekisteröinti, install-root, executable,
   shortcut ja Eky-prosessit todistetaan puhtaiksi
2. immutable fixture varmennetaan
3. MSI asennetaan hiljaisesti ilman uudelleenkäynnistystä
4. asennettu versio, payload ja rekisteröinti varmennetaan
5. vain varmennetun payloadin backend-entry poistetaan ja exact ProductCode
   korjataan `/fa`-operaatiolla; koko asennettu payload verrataan uudelleen
6. täsmällinen tuote poistetaan ProductCodella ja poissaolo varmennetaan
7. samat MSI-tavut asennetaan uudelleen samalla muuttumattomalla profiililla;
   tuotetila ja koko payload varmennetaan
8. tuote poistetaan uudelleen ja kaikki ensimmäisen kohdan jäljet todistetaan
   poissa oleviksi; profiili ja lähdeartifact varmennetaan jokaisen siirtymän
   jälkeen. Repair-, reinstall-, payload- ja profiilitodisteet ovat pakollisia
   strict scenario-resultin onnistumisessa.

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
pnpm --filter @eky/desktop installer:v2-clean --artifact-descriptor <descriptor-path> --expected-descriptor-sha256 <producer-descriptor-sha256> --expected-build-revision <producer-git-revision> --result-path <temporary-root>/eky-clean-caller-<new-32-hex-id>/result.json
```

V2.2 ei vielä käytä GitHub artifact -actioneita eikä ole nykyisen release-
portin auktoritatiivinen korvaaja. Checkpoint ei muuta tuotantokoodia,
riippuvuuksia, lockfilea, versiota tai pilot-artifactia. V2.3:ssa eriytetään
build-once descriptor ja CI:n immutable artifact -siirto ennen upgrade-
skenaarioiden migraatiota.

## V2.3 build-once artifact -checkpoint

V2.3:n alkuperäinen clean descriptor oli suoraan `installer.manifest.json`.
V2.8:n repair/reinstall-siirrossa testikohtainen `clean-install-artifact.json`
sitoo tämän muuttumattoman tuotantomanifestin SHA-256:n, build-revisionin sekä
nykyisen package-inventory-vastuun koko payloadin tiivisteen, tiedostomäärän
ja tavumäärän. Näin consumer voi todistaa asennetut tavut ilman erillistä
payload-kopiota tai uusia tuotantomanifestin kenttiä. Tiukka testisopimus ei
muuta julkaisuformaattia tai pakettiin toimitettavia komponentteja.
Producerin descriptor-SHA välitetään consumerille artifactin ulkopuolisena
job-output-arvona.

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
- hyväksyy artifact-juureen vain `clean-install-artifact.json`-descriptorin,
  `installer.manifest.json`-tiedoston ja manifestin nimeämän MSI:n
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
pnpm --filter @eky/desktop installer:v2-clean --artifact-descriptor <absolute-artifact-root>/clean-install-artifact.json --expected-descriptor-sha256 <producer-descriptor-sha256> --expected-build-revision <producer-git-revision> --result-path <temporary-root>/eky-clean-caller-<new-32-hex-id>/result.json
```

Artifact-verifier ajetaan sekä ennen V2.2-lifecyclea että sen jälkeen.
Nykyinen clean-komento edellyttää lisäksi erillistä `verifyCleanCallerResult.mjs`
-varmennusta samoilla sidonta-argumenteilla ja komennon todellisella
`--command-exit`-arvolla. CI tekee tämän samassa lifecycle-stepissä;
pelkkä valmis result-tiedosto ei ole komennon onnistuminen. Artifact-juuren
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
ja pakkaamatonta siirtoa; artifactissa sallitaan vain testidescriptor,
muuttumaton tuotantomanifesti ja sen nimeämä allekirjoittamaton MSI.

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
Roolikohtainen `payload` sitoo nykyisen package-inventoryn tiivisteen,
tavumäärän ja tiedostomäärän. Sama pieni asennetun payloadin vertailuvastuu
palvelee clean- ja upgrade-ketjua; installerin tuotantomanifesti ei muutu.

Paketoinnin native SQLite -validointi lataa stagingin `.node`-tiedoston
producer-prosessiin. Siksi producer ei yritä poistaa kiinteää, Gitistä
ohitettua `.stage/windows-acceptance-v2-upgrade`-juurta samasta prosessista.
CI poistaa juuri tämän staging-juuren erillisessä vaiheessa vasta producerin
poistuttua; seuraava paikallinen producer korvaa saman juuren ennen buildia.
Staging ei kuulu siirrettävään acceptance-artifactiin.

Yksi strict worker suorittaa seuraavan järjestyksen:

1. source- ja target-ProductCodejen sekä yhteisen footprintin puhdas preflight
2. source N:n asennus ja exact postcondition
3. source-sovelluksen todistettu normaali käynnistyminen eristettyyn
   testiprofiiliin, N -> N+1 major upgrade elävän sovelluksen rinnalla ja
   source/target-tilan exact postcondition
4. N-paketin downgrade-yritys, jonka pitää epäonnistua targetia muuttamatta
5. paketoidun tuotannon `rollbackWindowsInstaller.ps1`-polun binary rollback
   takaisin source-versioon
6. target-identiteetin rollback-probe, jonka MSI-asennuksen pitää epäonnistua
   ja Windows Installerin pitää säilyttää source-versio
7. source-version täsmällinen poisto ja kaikkien jälkien poissaolo
8. artifact-tavujen uudelleentarkistus.

V2.8:n running-Setup-siirto käyttää olemassa olevaa desktop.started- ja
shutdownCompleted-lukijaa, nykyistä native close -pyyntöä sekä samaa workerin
Job Objectia. Omistaja on hyväksynyt rajatun testikohtaisen native-MSI-adapterin.
Normaali CI-kierros on läpäissyt adapteriketjun kahdella consumerilla;
koko V2:n käyttöönotto odottaa edelleen alla nimettyjä portteja.
Adapteri korvaa tämän osatestin lokivahdin;
puskuroidun lokin toimitus ei ole ohjausprotokolla eikä automaattinen fallback.

Täsmällinen sulkemisraja on `INSTALLMESSAGE_ACTIONSTART` (0x08000000), jonka
MSI-recordin ensimmäinen kenttä on `InstallValidate`. Ennen sitä saman clientin
on havaittava `CostFinalize`. Sulkeminen pyydetään vain ensimmäisestä tällaisesta
tapahtumasta ja vain yhä elävältä, valmiiksi todistetulta sovellukselta.
Myöhemmät sisäkkäisen poiston validointivaiheet eivät pyydä sulkemista uudelleen.
Väärä järjestys tai puuttuva tapahtuma ei hyväksy päivitystä.

MSI-client lukitsee sisäisen UI:n arvoon `INSTALLUILEVEL_NONE` (2), ulkoisen
callbackin suodattimeksi vain `INSTALLLOGMODE_ACTIONSTART` (0x100) ja
asennusominaisuuksiksi `REBOOT=ReallySuppress`. Validi action-callback palauttaa
`IDOK` (1), virheellinen record tai järjestys -1 ja suodattimen ulkopuolinen
viesti 0. `RMFILESINUSE`-viestiä ei tilata eikä siihen palauteta shutdownin
valtuuttavaa `IDOK`- tai lukkojen ohittavaa `IDIGNORE`-vastausta. Restart Managerin
ominaisuuksia tai tuotannon sulkemisvastuuta ei muuteta.

Callback lukee vain action-nimen ja julkaisee yhden muistissa olevan signaalin.
Omistajan hyväksymä kuittausraja korvaa aiemman odotuksettoman paluun:
ensimmäinen `InstallValidate` odottaa muistissa sovelluksen poistumiskuittausta.
Callback ei tee I/O:ta. Erillinen jatko välittää yksityiseen pipeen enintään
kaksi suljettua viestiä: validointirajan ja varsinaisen MSI-tuloksen. Kanava,
adapteri ja MSI kuuluvat nykyisen workerin Job-rajaan. Kanavan epäonnistuminen
hylkää protokollan; lokia tai konsolia ei käytetä varareittinä. Adapteri rakennetaan
hyväksytyllä .NET-työkaluketjulla installer-testituen yhteydessä, eikä sitä kopioida
tavalliseen desktop-pakettiin tai MSI-payloadiin.

[MsiSetExternalUIRecord](https://learn.microsoft.com/en-us/windows/win32/api/msi/nf-msi-msisetexternaluirecord)
kuuluu asennuksen käynnistävälle clientille, ei jo käynnissä olevaan
`msiexec`-prosessiin liitettäväksi. Tämä osatesti todistaa API-clientistä tehdyn
MSI-päivityksen elävän Ekyn rinnalla, ei identtistä suoran komentorivi-Setupin
ajoitusta. Source-asennus, downgrade, Windows Installer rollback, poisto ja
erillinen clean lifecycle säilyttävät suoran `msiexec`-kattavuuden. Vanhan
running-Setup-ketjun poisto odottaa siirtokartan lopullista hyväksyntää.

[InstallValidate](https://learn.microsoft.com/en-us/windows/win32/msi/installvalidate-action)
on Windows Installerin tilan ja käytössä olevien tiedostojen tarkistusvaihe.
Havainto todistaa tässä vain vaiheeseen saapumisen, ei tiedostolukon syytä tai
onnistunutta päivitystä. Hyväksyntä vaatii edelleen oikean exit-koodin,
asennetun payloadin täyden vertailun, exact tuotetilan, desktopin onnistuneen
shutdown-todisteen ja erilliset callerin jälkiehdot.

Aiempi asynkroninen `InstallValidate`-ilmoitus ei pysäyttänyt MSI:tä sovelluksen
sulkeutumisen ajaksi. Sulkemispyyntö ja sovelluksen havaittu poistuminen ovat
eri tapahtumat. Hyväksytty korvaus käyttää nykyistä kaksisuuntaiseksi muutettua
private pipeä: worker lähettää yhden schema-/nonce-sidotun `applicationExited`-
kuittauksen vasta `close`- ja `verifyShutdown`-porttien onnistuttua. Vastaanottaja
validoi suljetun, enintään 256 tavun viestin; vasta se vapauttaa callbackin.
MSI-tulos vahvistaa `applicationExitAcknowledged`-tilan erikseen. Lähetetty
kuittaus tai pelkkä prosessin syntyminen eivät ole onnistumistodisteita.

Synteettinen MSI-record-fixture kirjoittaa paikallisen paluumerkin vasta
ensimmäisen callbackin palattua. Viivästetyn kuittauksen testi vaatii merkin
puuttumista ennen lähetyksen vapauttamista ja läsnäoloa lopussa; puuttuvan
kuittauksen testi vaatii sen puuttumista vielä todetun Job-deadlinen ja
prosessipoistumisen jälkeen. Näin tulosviestin odotus ei voi yksin peittää
liian aikaisin palautunutta callbackia. Merkki ei ohjaa varsinaista MSI-ajoa.

Puuttuva kuittaus kuuluu nykyiseen workerin Job-määräaikaan ja sen cleanupiin;
adapterille ei lisätä omaa ajastinta, tappopolitiikkaa tai valvojaa. Epäonnistunut
sulkeminen katkaisee kanavan ja säilyttää alkuperäisen virheen. Virheellinen
kuittaus hylkää callbackin, eikä käynnistä fallbackia tai uusintaa. Callbackin
paluuarvot, UI-asetukset, MSI-koodien hyväksyntä ja tavallinen Eky säilyvät.
Tämä poistaa testiohjauksen ajoitusikkunan; aiemman 3010:n syy ei silti ole
osoitettu ennen erottavaa näyttöä.

Running-upgrade-worker luokittelee valmistuneen verbose-lokin ennen aineiston
poistoa nykyisen Job-rajan sisällä. Suljettu `runningUpgradeObservation`
säilyttää vain tiedosto käytössä / ajastettu poisto / korvattu käytössä oleva
tiedosto / reboot-pending -havainnot, sallitun MSI-vaiheen ja järjestyksen
suhteessa sulkemispyyntöön sekä havaittuun poistumiseen. Ajattoman lokirivin
ajankohta on viereisten aikaleimojen väli, ei tarkka hetki. Puuttuva, ristiriitainen
tai rajauksen ulkopuolinen aikajärjestys jää tuntemattomaksi. Puuttuva loki on
puuttuvaa diagnostiikkaa; se ei peitä MSI- tai cleanup-tulosta. Raakalokia,
tiedostonimiä, aikoja tai prosessitunnisteita ei sisällytetä tulokseen. Lukija
ei ohjaa sulkemista eikä muuta hyväksyntää. Tunnettujen merkintöjen puuttuminen
ei todista kaikkien mahdollisten uudelleenkäynnistyssyiden poissaoloa.

`replacementMarkerAction` ja sen kaksi järjestysluokkaa paikantavat vain
ensimmäisen `ReplacedInUseFiles`-property-change-merkinnän suhteessa
sulkemispyyntöön ja havaittuun poistumiseen. Pelkkä lopun property-listaus
ei anna ajoitustodistetta; ajaton tai ristiriitainen loki säilyttää nykyiset
epävarmuusluokat. Merkinnän aika ei todista yksittäisen tiedoston operaation
aikaa tai lukon omistajaa, eikä tätä havaintoa käytetä MSI:n ohjaamiseen.
Microsoftin [ReplacedInUseFiles-sopimus](https://learn.microsoft.com/en-us/windows/win32/msi/replacedinusefiles)
sitoo ominaisuuden käytössä olevan tiedoston korvaamiseen; se ei yksin nimeä
lukitsevaa prosessia. Tämän erottelun koe käyttää nykyistä rajattua
upgrade-consumeria ja olemassa olevia varmennettuja artifact-tavuja.

Aiempaan normaaliin integraatioajoon
[34715796076](https://github.com/eky-software/eky/actions/runs/34715796076)
jäi upgrade-hylkäys MSI-tuloksella 3010.
Se tuotti hallitun virhetuloksen ja varmennetun siivouksen, eikä osoita uutta
supervisorin aikakatkaisua. Alkuperäistä verbose-lokia ei säilytetty, joten
syy on avoin. Yksi ennalta rajattu `packaged-boundary-diagnostic`-ajo käyttää
nykyistä upgrade-komentoa ja saman producerin artifact-ID:tä sekä descriptor-
ja MSI-tiivisteitä. Paketteja ei rakenneta kokeeseen uudelleen. Artifact
varmennetaan ennen ja jälkeen; diagnostiikkarevisio ja artifactin build-revisio
raportoidaan erikseen. Koe ei korvaa normaaleja consumereita tai hyväksyntää,
eikä 3010:n hyväksyminen, sokkouusinta tai callback/UI-politiikan muutos kuulu
tähän diagnoosiin.

Rajattu koe [34721039114](https://github.com/eky-software/eky/actions/runs/34721039114)
valmistui ensimmäisellä yrityksellä: harness ja checkout olivat `0fe829b`,
artifactin build-revisio `63be868` ja alkuperäinen artifact-ID `10304808865`.
MSI palautti 0, suljettu lukija ei havainnut reboot-syymerkintöjä ja MSI:n
valmistuminen havaittiin sovelluksen poistumisen jälkeen. Koko upgrade-ketju,
prosessien poissaolo, asennuksen poisto ja artifactin ennen/jälkeen-varmennus
läpäisivät. Koe todistaa uuden havainnon kulun fixture-poiston yli, ei aiemman
3010:n juurisyytä. Callback- ja tuotantokäyttäytyminen pysyvät ennallaan;
aiempi epäonnistuminen säilyy avoimena normaalin integraatiohyväksynnän rinnalla.

Vanhan running-Setup-sopimuksen 1603-haara saa jatkaa kerran vasta sulkemisen
ja lähdeasennuksen muuttumattomuuden tarkistuksen jälkeen. Se ei ole yleinen
retry: muu virhe, reboot-vaatimus tai muuttunut source hylätään. Alkuperäinen
virhe ja `applicationCleanupResultCode` säilyvät erillisinä. Varmentamaton
sulkeminen estää workerin semanttisen poiston ja aineiston poiston; Job pysyy
ainoana pakotetun prosessisiivouksen omistajana. Kaikkien onnistuneiden
asennus-, upgrade-, downgrade- ja rollback-siirtymien payloadit varmennetaan.

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
pnpm --filter @eky/desktop installer:v2-upgrade-rollback --artifact-descriptor <absolute-artifact-root>/upgrade-rollback-artifact.json --expected-descriptor-sha256 <producer-descriptor-sha256> --expected-build-revision <producer-git-revision> --result-path <absolute-temporary-root>/eky-upgrade-caller-<32-lowercase-hex-invocation>/result.json
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
pnpm --filter @eky/desktop installer:v2-legacy --artifact-descriptor <absolute-artifact-root>/legacy-upgrade-artifact.json --expected-descriptor-sha256 <descriptor-sha256> --expected-build-revision <producer-revision> --result-path <canonical-temp>/eky-legacy-caller-<new-32-hex>/result.json
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

Omistajan erikseen hyväksymä GUI-fixturen käännösvalmistelun kokonaisraja
on myös 30000 ms: työlle 29000 ms ja nykyiselle siivoukselle 1000 ms.
Se koskee vain `requestWindowsApplicationClose.test.mjs`-tiedoston kerran
ajettavaa valmistelua, ei jaetun apurin oletusta tai MSI-operaatioita.
Käännös etenee valmistumisen perusteella; raja ei ole kiinteä odotus eikä
käännöksen suorituskykyvaatimus. Todellinen valmistelupyyntö ja komentoprosessin
poistuminen varmennetaan nykyisessä kytkentätestissä. Erilliset compiler-
failure/timeout-regressiot säilyttävät 10000 ms kokonaisrajan ja 1000 ms
siivousvarauksen sekä vaativat virhetuloksen, Job-puun poissaolon ja vieraan
sentinelin säilymisen. Valmistelurajan tarkennus ei osoita aiemman viiveen
syytä eikä muuta epäonnistunutta hyväksyntäkierrosta onnistuneeksi.

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

Tämän historiallisen checkpointin Windows-käyttäytymistestin COM-fixture aiheuttaa kyselypoikkeuksen
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

Aiemman kytkentächeckpointin avoin raja oli workspace-success-consumerin
`targetInstall`-asennushavainto. Electron-portin läpäissyt
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
Tämän korjauksen jälkeinen hyväksyntätila ja jäljellä oleva yhteinen
valmistumisraja ovat jäljempänä kohdassa **Nykyinen päätös**.

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

Tämä osuus erottaa nykyisen julkaisutyön historiallisesta tutkimusnäytöstä.

#### Ajantasaiset julkaisuesteet ja päätökset

V2-integraation lähderevisio
`b130e8601929019fb407865bee69b838d6df7897` läpäisi kaksi normaalia
kokonaiskierrosta
([35020309518](https://github.com/eky-software/eky/actions/runs/35020309518),
[35023325796](https://github.com/eky-software/eky/actions/runs/35023325796))
ja oman [riippuvuustarkistuksensa](https://github.com/eky-software/eky/actions/runs/35020305521).
Kummassakin kierroksessa varmennettiin neljän artifact-perheen tavusidos,
18 paketoitua komentoa ja Electron critical 38/38 ilman flaky-tulosta.
[PR #268](https://github.com/eky-software/eky/pull/268) läpäisi lisäksi oman
[CI-ajonsa](https://github.com/eky-software/eky/actions/runs/35026401530)
ja [riippuvuustarkistuksensa](https://github.com/eky-software/eky/actions/runs/35026400856).
PR-ajon todellinen checkout ja artifact-build oli
`f5ac83def41c737394c4cd86e49c6f9bb1e3e987`, ei lähde-HEAD.

Hyväksytty required-check-vaihto on tehty: `V2 acceptance` ja
`Audit dependencies`, odotettu tuottaja GitHub Actions. Strict-ajantasaisuus,
PR-vaatimus ja muut suojaukset säilyivät. PR yhdistettiin normaalisti
main-revisioon `379f9c6232ad73721e1dd387b2fa7be6804eb256`.
Sen [oma main-ajo](https://github.com/eky-software/eky/actions/runs/35029069964)
on hylännyt `legacy / V2.5 commands contracts run 2` -jobin: synteettisen
`Preparation`-tapauksen tuottajan jälkeinen tuloslukija palautti exit 1:n,
vaikka testi vaati exit 0:n. Tämä pysäyttää julkaisun; aiempi hyväksyntäpari
ja PR-ajo eivät korvaa merge-revision puuttuvaa hyväksyntää. Mainin oma
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/35029069670)
läpäisi kaikki kolme pakollista tarkistusta.

Nykyinen rajattu korjaus säilyttää epäonnistumisraportissa tuottajan ja
tuloslukijan validoidut process-, worker- ja cleanup-tulokset erikseen.
Puuttuva tai virheellinen tulos erotetaan hylätystä prosessituloksesta;
diagnostiikan virhe ei korvaa alkuperäistä assertionia. Sama olemassa oleva
tuloslukija sitoo havainnon pyynnön todelliseen artifact-identiteettiin.
Aikarajoja, sovelluskoodia tai hyväksymisehtoja ei muuteta. Nykyisen
feasibility-workflow'n `product-command-diagnostic` valitsee vain saman
komentoryhmän kahdelle eristetylle Windows-runnerille, ilman MSI-rakentamista
tai hyväksyntäporttien korvaamista. CI:n alkuperäinen hylkäys ei yksilöinyt
tuloslukijan sisäistä virhettä, joten sitä ei nimetä vielä aikakatkaisuksi,
MSI-viaksi tai juurisyyltään korjatuksi.

Jäljellä ovat komentoryhmän virheen rajaaminen, korjauksen normaali
PR-/main-todennus ja tämän jälkeen erillinen 0.2.8-versionosto sekä
exact-byte-varmennettu pilot-bundle. Historiallisia jäädytettyjä PR:iä ei
yhdistetty suoraan. Suojauksia tai julkaisurajoja ei ohiteta.

#### Aiemmat integraatiocheckpointit

Revision `b1270ab0ed66904a5412752c94a165cada637d94`
[ensimmäinen normaali kierros](https://github.com/eky-software/eky/actions/runs/35010087226)
on hylätty Electron criticalin `DESK-WORKSPACE-REPLACE-001`-flaken vuoksi.
Kaikki neljä produceria ja 18 paketoitua consumer-komentoa läpäisivät;
14 producer-/consumer-jobin checkout, artifactin build-revisio ja
ennen/jälkeen-tavusidos varmennettiin samalle revisiolle. Upgrade-artifactin
aiempi rakentamisvirhe ei toistunut, mutta sen alkuperäinen syy on avoin.
Revision [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/35009852210)
läpäisi kaikki kolme pakollista tarkistusta. Toista normaalia kierrosta ei
käynnistetty. Main, required checkit ja julkaisu pysyvät ennallaan.

Electron-jobin ensimmäinen epäonnistuminen oli `E2E_BACKEND_HEALTH_TIMEOUT`
varmuuskopion testivalmistelussa ennen Electronin käynnistystä ja testirunkoa.
Backendin prosessisiivous ja portin vapautuminen valmistuivat. Retry läpäisi,
mutta ei korvaa hylkäystä. Tämä ei ole sama havainto kuin aiempi `firstWindow`-
timeout. Valmistelun virhe tapahtuu ennen nykyisen `electron-lifecycle`-
liitteen keruurajaa. Lisäksi nykyinen `processSpawned`-havainto syntyy
käynnistyskutsun paluusta, ei lapsiprosessin `spawn`-tapahtumasta. Näyttö ei
siksi vielä paikanna odotusta backendin käynnistymisen, kuunteluvalmiuden ja
HTTP-healthin välille. Rajattu korjaus nykyiseen valmisteluvastuuseen erottaa
todellisen `spawn`-tapahtuman, säilyttää alkuperäisen käynnistysvirheen ja
erilliset siivoustulokset sekä tallentaa ensimmäisen valmisteluvirheen samaan
turvalliseen Electron-liitteeseen. Nykyisestä rajatusta tulostepuskurista
johdetaan vain kuunteluilmoituksen havaintoluokka, ei readiness-ehtoa.
Testijuuri säilytetään; uutta valvojaa tai aikarajaa ei lisätä. Kohderegressiot,
jaetut käynnistyssopimukset ja API-kytkentä läpäisivät 43/43. Kohdennetut
Electron-polut läpäisivät 6/6 ja critical 38/38 samalla valmistellulla buildillä,
ilman retryä. Typecheck ja tarvittavat buildit läpäisivät.

Korjauksen lähde- ja todellinen checkout-revisio on
`8ecb1d2553719b3e9278a040805f22a8d9ec0092`.
[Rajattu Electron-kierros](https://github.com/eky-software/eky/actions/runs/35016247726)
läpäisi ensimmäisellä yrityksellä: Windows-paketointi, packaged smoke,
critical 38/38 ja käynnistyshavainnon kytkentä 1/1, ilman flaky-tulosta tai
retryä. Muut core-jobit olivat tarkoituksella valitsematta; tämä ei ole
normaali V2-kokonaiskierros. Alkuperäisen viiveen syy pysyy avoimena;
onnistuneita toistoja ei esitetä sen juurisyykorjauksena.

Jaettujen system/web-fixtureiden siivouskatselmus osoitti erillisen virheen:
testijuuri poistui varmentamattoman backendin aloitussiivouksen jälkeen.
Molempien oikean fixture-kutsurajan synteettiset regressiot hylkäsivät vanhan
käyttäytymisen. Korjaus kokoaa nykyisten siivousvastuiden tulokset yhdessä
rajatussa loppufunktiossa, säilyttää alkuperäisen virheen ja sallii testijuuren
poiston vain varmistetun siivouksen jälkeen. Uutta prosessiomistajaa,
aikarajaa tai readiness-ehtoa ei lisätä. Restart ei voi käyttää vanhaa
suljettua kahvaa uuden epäonnistuneen käynnistyksen siivoustodisteena;
aiempi epävarmuus säilyy myös myöhemmän onnistuneen loppusiivouksen jälkeen.
Suljettu cleanup-liite ei julkaise testijuurta tai raakavirhettä. Tämä
korjaa todistetun aineiston säilymisrajan, ei aiemman käynnistysviiveen syytä.
Kohdesopimukset ja normaali system-sarja läpäisivät 131/131, mukaan lukien
28 uuden siivousrajan käyttäytymisregressiota. Kriittiset web-polut läpäisivät
35/35 ilman retryä. Typecheck ja tarvittavat buildit läpäisivät. Seuraava
portti on katselmoidun korjauksen puhtaan revision normaali integraatiokierros;
se ei peri aiempien revisioiden osatuloksia tai diagnostiikka-ajoja.

Revision `fb330fb1d1b615ce602af9367abb5679a3585e3d`
[ensimmäinen normaali kierros](https://github.com/eky-software/eky/actions/runs/35004076794)
hylättiin upgrade-artifactin valmistelussa ennen upgrade-consumereita.
SQLite-varmennuksen jälkeinen yleinen build-virhe ei yksilöi epäonnistunutta
paketointivaihetta. Tämä ei ole osoitettu Electron-startup-, MSI- tai
supervisor-vika. Toista normaalia kierrosta ei käynnistetä; revision
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/35003840476)
läpäisi omat kolme pakollista tarkistustaan.

Rajattu korjaus säilyttää upgrade-rakentajan virheyhteenvedossa suljetun
pakettiroolin, paketointivaiheen ja tunnetun alustavirheluokan. Vaihetieto
kulkee vain muistissa; sitä ei odoteta, eikä se ohjaa valmistumista.
Alkuperäinen virhe säilyy yksityisenä syynä. Tuntematonta metadataa ei
julkaista, ja havaintovirhe ei muuta paketoinnin tulosta. Onnistumisen
summary, pakettitarkistukset, määräajat ja payload eivät muutu. Regressiot
kattavat molempien roolien keskeytymisen ennen asentimen rakentamista sekä
todellisen valmistelun tiedostovirheen säilymisen havaintovirheessä.
Alkuperäisen paketointihäiriön syy ja normaali kokonaishyväksyntä ovat auki.

Korjauksen lähde-, checkout- ja artifactin build-revisio on
`77ee53091fe505da822b4cb7501d883ea79b65a8`.
[Rajattu upgrade-kierros](https://github.com/eky-software/eky/actions/runs/35007040291)
läpäisi ensimmäisellä yrityksellä: producer ja molemmat consumerit, ilman
ohituksia tai uusintaa. Artifact `10412009970` rakennettiin kerran;
descriptorin ja kolmen MSI:n tiivisteet täsmäsivät molempien consumerien
ennen/jälkeen-varmennuksissa. Komentojen pakolliset tulosvarmennukset ja
lopputulokset läpäisivät. Häiriö ei toistunut; tämä todentaa rajatun
virhetiedon korjauksen yhteensopivuuden, ei alkuperäisen häiriön juurisyytä
eikä normaalia kahden kokonaiskierroksen hyväksyntää.

Revision `cb0dff26985c3346c5eb0c88120e73468f5ee075`
[ensimmäinen normaali kierros](https://github.com/eky-software/eky/actions/runs/34996359240)
on hylätty Electron criticalin `DESK-WORKSPACE-STARTUP-001`-flaken vuoksi.
Ensimmäinen yritys päättyi fixturen `firstWindow`-aikakatkaisuun ennen
testirunkoa. Turvallinen muistihavainto saavutti `backendStartRequested`-
vaiheen mutta ei `backendReady`- tai ikkunahavaintoa. Runtime-siivoaminen,
portin vapautuminen ja testijuuren poisto valmistuivat. Retry läpäisi, mutta
ei korvaa hylkäystä. Muut testijobit sekä kaikki 18 paketoitua consumer-komentoa
valmistuivat; [revision riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/34996143398)
läpäisi. Toista normaalia kierrosta ei käynnistetty.

Rajattu havaintokorjaus erottaa olemassa olevassa E2E-backend-controllerissa
fork-pyynnön, kahvan palautumisen, spawnin, start-viestin ja validoidun
ready-viestin. Sama rajattu muistiprojektio ja yksityinen lukukanava säilyvät;
ei uutta valvojaa, lokitusta, tuotantomuutosta tai aikarajaa. Synteettiset
sopimukset ja nykyinen Electron-kytkentätesti todentavat tapahtumajärjestyksen,
alkuperäisen virheen säilymisen ja havaintovirheen riippumattomuuden.
Puuttuva välivaihehavainto korjataan, mutta satunnaisen käynnistysviiveen
syy ja normaali kokonaishyväksyntä jäävät avoimiksi.

Havaintokorjauksen lähde- ja todellinen CI-checkout ovat
`44981f54c81b6bf1cf050194bca647d725c1eb56`.
[Rajattu Electron-kierros](https://github.com/eky-software/eky/actions/runs/35001812427)
läpäisi ensimmäisellä yrityksellä: critical 38/38, havaintokytkentä 1/1,
Windows-paketointi ja packaged smoke. Koko job valmistui onnistuneesti.
Tämä ei ole normaali V2-kokonaiskierros eikä korvaa hylättyä `cb0dff2`-ajoa.

Revision `0416323d6e988ade94fe6ac3b58410d29c776633`
[normaali kokonaiskierros](https://github.com/eky-software/eky/actions/runs/34987838414)
on hylätty. Clean, upgrade/rollback, legacy ja workspace-success läpäisivät
kummassakin toistossa, mutta fault run 1 pysähtyi `sourceHandoff`-vaiheen
`W6B2_FAULT_PROOF_PACKAGE_STAGE_FAILED`-virheeseen. Native-tuotetarkistukset,
virheen jälkeiset poistot, loppuinventaario ja fixture-siivoaminen valmistuivat;
komento ja pakollinen tulosvarmennus palauttivat virheen. Fault run 2:n viisi
onnistumista eivät korvaa hylättyä sarjaa. Saman revision
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/34987708008)
läpäisi. Toista normaalia kokonaiskierrosta ei käynnistetty.

Omistaja hyväksyi tämän jälkeen rajatun sovelluskoodin virheluokituksen:
`LocalUpdatePackageCacheError` säilyttää valmistelun nimetyn alavaiheen.
Lähdevarmennus, cache-valmistelu, staging-tiedostojen kirjoitus/kopiointi,
staging-varmennus, slotin julkaisu ja slotin varmennus erotellaan.
Yksityinen fault-proof muuntaa vain tunnetun vaiheen ja oman `current`- tai
`candidate`-roolinsa suljetuksi virhekoodiksi nykyisessä tulosskeemassa.
Tuntematon virhe säilyy yleisenä hylkäyksenä; raakavirhettä, causea, polkua
tai muuta metadataa ei välitetä. Tarkistukset, operaatiojärjestys, siivous,
aikarajat ja tavallisen UI:n virheilmoitus eivät muutu. Vaihe on rajaus,
ei väite tarkan alustakutsun tai aiemman satunnaisen viiveen syystä.
Regressiot todentavat todelliset cache-virherajat, keskeytetyn stagingin
siivouksen, vieraan esteen säilymisen, proof-tiedoston kirjoitus/lukuketjun
ja käännetyn proofin sekä harness-lukijan virhekoodien vastaavuuden.
Muuttunut paketoitava koodi vaatii uuden puhtaan revision workspace-artifactin
ja rajatun perheen Windows-varmennuksen; vanha MSI-pari ei todista muutosta.

Revision `9b9deb745c1282163cd491712623ed8394473c97`
[rajattu workspace-varmennus](https://github.com/eky-software/eky/actions/runs/34992609487)
läpäisi ensimmäisellä yrityksellä: success 2/2, fault 10/10 ja kaikki neljä
sopimusryhmää. Lähde-, todelliset checkout- ja artifactin build-revisiot
vastasivat toisiaan. Artifact `10406767428` rakennettiin kerran; descriptorin
ja molempien MSI-pakettien tiivisteet täsmäsivät kaikkien neljän consumerin
ennen/jälkeen-varmennuksissa. Kaikki 12 komentoa ja niiden pakolliset
tulosvarmennukset valmistuivat onnistuneesti siivous- ja jälkiehtoineen.
Aiempi staging-virhe ei toistunut: virheluokituksen puute on korjattu, mutta
alkuperäisen valmisteluvirheen syy ei ole osoitettu. Tämä rajattu näyttö ei
korvaa normaalia kokonaishyväksyntäparia tai sulje erillistä aiempaa
`fixtureCleanup`-tuloksen puuttumishavaintoa. Main, required checkit ja
julkaisu pysyvät niiden omien porttien takana.

Revision `b20ec8150d9d6f859882c835671d02b77945b367`
[ensimmäinen normaali kokonaiskierros](https://github.com/eky-software/eky/actions/runs/34978683620)
läpäisi kaikki portit ja 18 consumer-komentoa samoihin producer-tavuihin
sidottuina. Saman revision
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/34978408074)
läpäisi. [Toisen normaalin kierroksen](https://github.com/eky-software/eky/actions/runs/34982523814)
clean/upgrade-komentoryhmän ensimmäinen toisto hylkäsi synteettisen
`upgrade/removalHold`-tapauksen (53/54). Komennon exit ja close havaittiin,
mutta `fixtureCleanup`-vaiheen pakollinen tulos puuttui. Hyväksyntäpari on
hylätty; ensimmäisen kierroksen vihreys ei korvaa puuttuvaa näyttöä.

Nykyinen komentoregressio säilyttää tämän virherajan viimeiset 20 suljettua
vaihehavaintoa vain epäonnistumisen lisätietona. Havaintotuki ei odota
kuittausta, muuta prosessin tulosta tai korvaa pakollista tulostiedostoa.
Raakakentät hylätään ja havaintotuen virhe säilyttää alkuperäisen assertionin.
Nykyisen diagnostiikkatyönkulun `clean-upgrade-command-diagnostic` ajaa saman
kanonisen komentoryhmän kahdella Windows-runnerilla ilman MSI-matriisia.
Tämä on vianrajaus, ei hyväksyntä tai selitys puuttuvalle tulokselle.

Revision `5701742d2f3051ad2b35cdf123f1b26cc7dc0f18`
[rajatussa Windows-kokeessa](https://github.com/eky-software/eky/actions/runs/34985968216)
molemmat komentoryhmät läpäisivät 54/54 ensimmäisellä yrityksellä.
Aiempi tuloksen puuttuminen ei toistunut. Avoin raja on edelleen
`fixtureCleanup`-pyynnön valmistelun, prosessituloksen ja tulostiedoston
julkaisun erottaminen epäonnistuneessa ajossa; komennon oma poistuminen on
jo havaittu. Diagnostiikan vihreys ei sulje tätä puutetta eikä käynnistä
uutta täyttä MSI-matriisia sen selvittämisen korvikkeena.

Omistaja on hyväksynyt nykyisen read-only-tuotetarkistimen korvaamisen
olemassa olevan `native-msi-adapter`-testiprojektin lukutoiminnolla. Viisi
harness-käyttäjää käyttävät samaa `MsiQueryProductStateW`-/
`MsiGetProductInfoW`-rajaan ilman PowerShell/COM-varapolkua. Muutos ei ole
osoitettu selitys aiemmalle viiveelle: myös native-kutsu voi estyä.
Nykyinen ympäröivä Job, työ- ja siivousrajat, pakollinen tulos sekä prosessin
todellinen poistuminen säilyvät. Adapteri ei kuulu jaettavaan sovellukseen.

Siirron sopimus säilyttää exact ProductCode -syötteen, versionoidun seitsemän
kentän tuloksen, kyselyvirheen eron tuotteen puuttumisesta sekä atomisen
no-overwrite-julkaisun. Tuote-, rekisteri-, tiedosto- ja prosessihavainnot
ovat lukutoimintoja, eivät poistovaltuutus. Artifact-varmennukset,
MSI-idle-rajaukset, semanttiset jälkiehdot ja aineiston säilytys pysyvät
nykyisillä omistajillaan. Korvattu skripti ja sen COM-fixture on poistettu
käyttäytymisregressioiden siirron jälkeen. Rajattu Windows-CI-todennus edeltää
uutta normaalin kokonaishyväksynnän paria; hyväksyntä on edelleen kesken.

| Korvattu vastuu | Nykyinen vastine ja säilyvä ehto |
| --- | --- |
| PowerShell/COM-tuotetarkistus | `NativeProductInspection` ja `NativeProductQueries` nykyisessä testiadapterissa; dokumentoidut tuotetilat, Unicode-ominaisuudet ja kyselyvirheet erotellaan. Muuttuva tai liian suuri vastaus hylätään ilman uusintaa. |
| Viisi kutsukytkentää | `installerProductOperationWorker`, clean-, upgrade-, legacy- ja workspace-runtime käyttävät vain `createNativeProductInspectionCommand`-argumenttirakentajaa. Se ei käynnistä prosessia tai omista aikarajaa. |
| Skriptin tulos-/havaintotestit | Nykyinen `inspectWindowsInstallerProductState.test.mjs` käyttää oikeaa native-lukijaa ja nykyisen contract-fixturen rajattuja virhesyötteitä; miehitettyä tulosta ei korvata eikä kyselyvirhe tuota absent-tulosta. |
| Koko kutsun valmistuminen | Nykyinen legacy-komentorajatesti kattaa oikean read-only-kutsun, estyvän kyselyn sekä tuloksen julkaisseen mutta elävän prosessin. Deadline, Jobin tyhjeneminen, komennon poistuminen ja pakollinen virhetulos varmennetaan erikseen; mutaatio ei ala ja epävarman ajon aineisto säilyy. |
| Ulkoisen keruun tulkinta | Sama payloaditon provider säilyy, mutta nykyinen lukija ei tuota COM-luonti-/vapautustapahtumia. Nykyinen synteettinen odotus vaatii `productStateStarted`-rajahavainnon; vanha COM-raja tai jo valmistunut tarkistus ei kelpaa. Vanhojen tallenteiden parserituki jää vain lukutueksi, ei suorituksen varapoluksi. |

Lähde- ja checkout-revision `dd5434c1d810af38d55911923f155b6dd22c5a45`
rajattu [upgrade-koe](https://github.com/eky-software/eky/actions/runs/34974491009)
läpäisi nykyisen komennon, pakollisen tulosvarmennuksen, asennuksen poiston ja
fixture-siivoamisen ilman keruuta. Artifact `10391754161` oli rakennettu
revisiosta `b82dae544f6a6ccdc13c634e1f1b315f9976697d`; sen descriptorin ja
kolmen MSI:n tiivisteet täsmäsivät ennen ja jälkeen ajon. Saman lähderevision
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/34974495174)
läpäisi. Tämä on native-korvauksen rajattu todiste, ei normaali
kokonaishyväksyntä tai selitys aiemman tarkistuksen viiveelle.

Revision `c635b9eaada92610e09e28e8378a0eacc5444f51`
[normaalin kierroksen](https://github.com/eky-software/eky/actions/runs/34975687345)
molemmat legacy/core-jobit hylkäsivät saman `eventStatistics`-regression
(333/334 kummassakin). Tätä kierrosta ei hyväksytä eikä sen puuttuvia
legacy-consumereita korvata muiden perheiden tuloksilla. Diagnostiikkafixture
lataa tarvitsemansa Utility-moduulin oman PowerShell-runtimensa juuresta;
vanhemman komentotulkin hakupolku ei ole testin riippuvuussopimus.
Odottamaton poikkeus säilyy alkuperäisenä yksityisessä virhelokissa, ja
testiraportti saa vain rajatun virheluokan. Tämä testivalmistelun korjaus
ei muuta native-kyselyä, asennusskenaariota tai niiden aikarajoja eikä väitä
selittävänsä historiallista MSI-viivettä.

Rajattu riskikatselmus perustuu revisioon `d2bf592`; se ei ole koko ERP:n
auditointi tai uusi hyväksyntäkierros. Uusin omistajapäätös korvaa vanhan
odotuksettoman MSI-testicallbackin edellä kuvatulla sulkeutumiskuittauksella.
Kuittaus on toteutettu nykyiseen adapteriin, kanavaan ja päivityksen
koordinaattoriin. Vanhaa 3010-havaintoa ei nimetä tällä korjauksella ratkaistuksi;
revision `b82dae544f6a6ccdc13c634e1f1b315f9976697d` rajattu paketoitu
[koe](https://github.com/eky-software/eky/actions/runs/34953866536) läpäisi.
Sen vanhemman artifactin build-revisio oli `e7e192455df8c82f5e46293ad8a654cc966edbdb`;
koe ei korvaa normaalia kokonaishyväksyntää.

Samalta jäädytetyltä `b82dae5`-revisiolta ilman raskasta keruuta ajettu
[ensimmäinen kokonaiskierros](https://github.com/eky-software/eky/actions/runs/34954686978)
läpäisi kaikki vaaditut portit ja 18 consumer-komentoa. Producerien ja
consumerien ennen/jälkeen-tiivisteet vastasivat toisiaan; koonti hyväksyi
kattavuuden. Saman revision
[riippuvuusturva](https://github.com/eky-software/eky/actions/runs/34954690752)
läpäisi. [Toinen kokonaiskierros](https://github.com/eky-software/eky/actions/runs/34957230914)
hylkäsi kuitenkin upgrade run 1:n ja workspace success run 1:n jo
`inspectSourceBefore`-vaiheen määräaikaan ennen MSI-skenaarion aloittamista.
Molempien vaiheiden prosessipuut poistuivat ja komentoprosessit palauttivat
virheen; tarkistimen sisäinen viivekohta ei selviä näistä havainnoista.
Hyväksyntäpari on hylätty, eikä ensimmäistä vihreää kierrosta yhdistetä
uusiin osatuloksiin. Main, required checkit ja julkaisu pysyvät lukittuina.

Rajattu koe käyttää nykyisen packaged-boundary-diagnostiikan
upgrade-komentoa ja saman kierroksen varmennettua artifactia. Nykyinen
`inspector_capture`-valinta sallii ulkoisen keruun myös tähän komentoon;
legacy käyttää edelleen omaa analyysiprojektiotaan. Keruu alkaa ennen
komentoa, pysähtyy sen jälkeen ja analyysi käyttää vain nykyistä inspectorin
lukijaa. Start/stop/analyze-rajat, komentobudjetit, pakolliset tulokset ja
ennen/jälkeen-artifact-varmennukset eivät muutu. Raakajälkiä ei julkaista.
Kytkentätesti suorittaa todellisen analyysivaiheen kummankin valinnan sekä
virhepaluiden kanssa. Ensimmäinen keruukytkennän
[CI-yritys](https://github.com/eky-software/eky/actions/runs/34959972273)
hylättiin ennen latausta, keruuta ja MSI:tä: esivalidointi salli edelleen
vain legacyn. Pieni korjaus kohdistuu samaan valintaan; käyttäytymisregressio
toistaa vanhan upgrade-hylkäyksen ja tarkistaa myös sallitut ja kielletyt
perheet sekä virheellisen artifact-identiteetin. Korjattu artifact-/workflow-
ryhmä läpäisee 25/25. Koe on diagnostiikkaa, ei uusi hyväksyntäkierros.

Korjatun lähde- ja checkout-revision
`0dfa5fdcc126b136d7ce6962c5af12d0aa3ada4c`
[upgrade-koe](https://github.com/eky-software/eky/actions/runs/34960665998)
käytti artifactia `10391754161`, jonka build-revisio säilyi `b82dae5`:
pakettien ennen/jälkeen-tiivisteet vastasivat toisiaan. Koko komento,
pakollinen caller-varmennus, sovelluksen sulku, asennussiivous, loppuinventaario
ja fixture-poisto läpäisivät; running-upgrade palautti MSI-tuloksen 0.
Tallennin käynnistyi ja pysähtyi, mutta analyysi hylättiin `eventExport`-
rajalla ennen tapahtumien lukemista. Tämä ei paikanna alkuperäistä viivettä.

Samalta revisiolta ajettu yksi
[read-only-vientivertailu](https://github.com/eky-software/eky/actions/runs/34961432819)
läpäisi varsinaisen komentotestin 1/1 ilman MSI-asennusta. Keruu pysähtyi
hallittuun lopputilaan, mutta sekä nykyinen että minimaalinen tapahtumanäkymä
hylättiin viennissä samoilla muuttumattomilla ETL-tavuilla. Vientivirhe on siis
toistettu myös ilman päivitysskenaariota; pelkkä vientinäkymän vaihtaminen ei
ratkaissut sitä. Suljetut viestihavainnot eivät osoita tapahtumahävikin määrää,
jäljen vioittumista tai virheen aiheuttajaa. Raakajälkiä ei julkaistu.
Puuttuva erottava havainto on viennin tarkka syyluokitus; alkuperäisen
esitarkistuksen ensimmäinen valmistumaton sisäinen raja jää erikseen avoimeksi.
Uutta samanlaista MSI-koetta tai hyväksyntäparia ei käynnistetä näiden
onnistuneiden osatulosten perusteella. Aikarajat ja hyväksymisehdot säilyvät.

Viennin seuraava erottava havainto käyttää nykyisen keruuadapterin
`xperf tracestats`-kutsua samasta pysäytetystä ETL:stä ennen WPA-vientiä.
Nykyinen lukija hyväksyy vain tunnetun tilastomuodon sekä tarkistimen
täsmällisen tapahtumalähteen nimen ja johdetun GUID:n. Luku rajataan 1 MiB:iin;
`eventStatistics` julkaisee vain lähteen havaitsemisen ja tapahtumamäärän tai
suljetun virheluokan. Muiden lähteiden tiedot ja raakateksti jäävät yksityisiksi.
Havainto ei todista tapahtumajärjestystä, hävikin määrää, viiveen syytä tai
testin hyväksyntää. Tilastoluvun virhe raportoidaan erillisenä eikä se korvaa
WPA-viennin omaa tulosta tai aiemmin varmennettua komentotodistetta.
Tilastoraportti välittää myös saman rajatun lokihavainnon kuin vientiraportti.
`fileCorruptionMessage` tarkoittaa vain tunnetun viestin löytymistä; numerokoodi
tai puuttuva havainto ei todista tallenteen eheyttä. Lukukelvoton tai puuttuva
loki säilyy erillisenä diagnostiikan puutteena eikä korvaa alkuperäistä virhettä.
Molemmat nykyiset analyysihaarat käyttävät samaa kutsua; uutta keruuta,
automaattista fallbackia, testiohjausta tai aikarajaa ei lisätä. Rajattu
käyttäytymistesti suorittaa kummankin todellisen analyysihaaran myös
tilastovirheen ja alkuperäisen vientivirheen yhdistelmällä.

Revision `a4cb159b8257e4a474c7ef986e5e545ac98c2b54` yksi
[read-only-koe](https://github.com/eky-software/eky/actions/runs/34964938698)
läpäisi ensimmäisellä yrityksellä ilman MSI-asennusta. Riippumaton tilastoluku
ja kumpikin WPA-näkymä löysivät 19 tapahtumaa samasta muuttumattomasta ETL:stä;
minimaalinen näkymä varmisti täsmällisen provider-sidoksen ja tarkistimen
odotetut read-only-rajat. Tarkistinkomento, keruun aloitus ja lopetus sekä
molemmat viennit valmistuivat. Analyysin kohdesarja läpäisi 13/13 ja
artifact-/workflow-sopimukset 25/25. Tämä sulkee havaintopolun kytkennän
varmennuksen, ei aiempaa vientivirhettä tai tuotetarkistuksen viivettä.
Puuttuva näyttö on edelleen alkuperäisen viiveellisen tarkistuksen viimeinen
valmistunut ja ensimmäinen valmistumaton sisäinen raja. Saman onnistuvan
vientikokeen uusiminen tai aiempien vihreiden osien yhdistely ei täytä sitä.

Lähde- ja checkout-revision `43969513aa0d4aea5defe134cdec01e27ebe7d58`
yksi [upgrade-koe](https://github.com/eky-software/eky/actions/runs/34966822340)
käytti artifactia `10391754161`, jonka build-revisio oli
`b82dae544f6a6ccdc13c634e1f1b315f9976697d`.
Komento, pakollinen tulosvarmennus, MSI-tulos 0, sovelluksen sulku,
rollbackit, asennussiivous, fixture-poisto ja pakettien ennen/jälkeen-varmennus
läpäisivät. Keruu käynnistyi ja pysähtyi, mutta sekä riippumaton tilastolukija
että WPA-vienti epäonnistuivat. Ajo on hylätty diagnostinen koe, ei normaali
hyväksyntä. Viive ei toistunut; sen tai tallenteen lukuhäiriön syytä ei osoitettu.
Puuttuva näyttö on viiveellisen tarkistuksen sisäinen valmistumisraja sekä
epäonnistuneen tallenteen lukuhäiriön tarkempi luokitus ennen runnerin poistumista.
Tämän raportointikorjauksen vuoksi ei ajeta uutta MSI-koetta. Normaali
hyväksyntäpari, main-käyttöönotto ja julkaisu pysyvät erillisinä portteina.

Kuittauksen koordinaattoritestit läpäisivät 14/14 ja todellisen Job-/kanava-
ketjun testit 16/16. Nykyinen core-ryhmä läpäisi 313/313, upgrade-ryhmä
138/138 ja sen komentorajaryhmä 33/33; CI-luettelon artifact-/workflow-
sopimukset läpäisivät 23/23. Typecheck ja build läpäisivät. Näitä kohdetuloksia
ei lasketa paketoiduksi kokeeksi tai normaaliksi kokonaiskierrokseksi.

| Havainto ja koodikohta | Sopimus, näyttö ja pienin jatko |
| --- | --- |
| Korjattu testiohjauksen ajoitusikkuna: `NativeMsiProgram.Run`, `coordinateRunningApplicationUpgrade` | Aiempi ilmoitus vapautti MSI:n ennen `close`/`verifyShutdown`-valmistumista. Sama kanava välittää nyt yhden ajosidotun kuittauksen vasta sulkeutumisvarmennuksen jälkeen. Viivästetty/puuttuva/väärä/eri ajon kuittaus, katkennut kanava ja ensivirheen säilyminen on todennettu nykyisellä Job-fixturellä. Callbackin paluu erotetaan apuprosessin elossaolosta; puuttuvalla kuittauksella paluumerkki puuttuu koko nykyisen määräajan yli. |
| Korjattu CI-kytkennän puute: `apps/desktop/package.json`, `legacyUpgradeArtifactWorkflow.test.mjs` | Running-upgrade-, MSI-kanava- ja lokihavaintotestit olivat erillisessä upgrade-komennossa, jota normaali matriisi ei kutsunut. Samat kolme tiedostoa kuuluvat nyt nykyiseen core-ryhmään; ryhmien täydellinen luettelo varmistaa niiden ajamisen ilman kaksoiskytkentää. Uutta jobia, ajokerrosta tai aikarajaa ei lisätty. |
| Kattavuusraja, ei osoitettu tuotantovika: `runRunningUpgrade`, `legacyUpgradeWindowsRuntime.runSourceStartup` ja `runMsiOperation` | Legacy sulkee lähdesovelluksen ennen suoraa msiexec-päivitystä; running-upgrade käyttää testicallbackia. Kumpikaan ei yksin todista tavallisen Setupin automaattista sovelluksen sulkemista. Tätä ominaisuutta ei luvata adapterin tuloksella. Mahdollinen uusi tuotelupaus tai tuotantokorjaus vaatii päätöksen. |
| Kattavuusraja: `executeCleanInstallUninstallLifecycle` | Clean todistaa exact-payloadin, repair/reinstallin, profiilin säilymisen ja poiston, ei GUI-käynnistystä. Packaged smoke, legacyssä asennetun sovelluksen käynnistys ja julkaisun exact-byte-smoke säilyvät erillisinä portteina; clean-vihreyttä ei nimetä yksin käynnistystodisteeksi. |

Valmistelukatselmuksessa installer-sarjan ainoa yhteinen `before`-käännös
on `requestWindowsApplicationClose.test.mjs`: sen hyväksytty 30 s valmistelu
on erillinen yleisestä 10 s apurista ja tarkoituksellisista timeout-testeistä.
Muiden budjettien nostolle ei löytynyt tästä rajauksesta näyttöä.
Electronin `finishIsolatedElectronTest` säilyttää testijuuren epävarman
runtime-/porttisiivouksen jälkeen sekä alkuperäisen virheen. Ensimmäisen
yrityksen kevyt `electron-lifecycle`-liite ei riipu retryn tracesta.
Nykyiset fixture-identiteetti-, erillisten tiedostotavujen, result-file-,
process-exit- ja cleanup-tarkistukset säilyvät; niitä ei korvata kuittauksella.

Laajennettavuuden polkutarkistus käyttää nykyistä `ciRiskPolicy`-luokittelua:
uusi domainin tuntikirjauksen validointisääntö kuuluu moduulin viereisiin
testeihin ja nopeaan core/security/web-porttiin. Työmääräysmoduulin SQL-
migraatio valitsee täyden matriisin; sen omat tallennus-, yrityseristys-,
backup- ja päivitysregressiot tarvitaan silti moduulin sopimuksen mukaan.
Riskiluokitus valitsee testit, ei luo uuden moduulin kattavuutta automaattisesti.
Kumpikaan esimerkki ei edellytä moduulilta uutta prosessivalvojaa.

Omistajan uusin jatkopäätös sallii normaalin hyväksynnän jatkamisen nykyisellä
V2-rakenteella. Vanhojen kadonneiden lokien palautuminen tai GitHub-tuen
vastaus ei ole uuden näytön ennakkoehto; tukipyyntöä ei tehdä. Aiemmat
epäonnistumiset, tuntemattomat viiveet ja varmentamattomat lopputilat jäävät
alla erillisiksi historiallisiksi havainnoiksi. Niitä ei nimetä korjatuiksi,
harmittomiksi tai alustavioiksi uuden vihreän ajon perusteella.

Pakollisen skenaarion, tulosvarmennuksen, prosessipoistumisen, datan
säilymisen tai siivouksen virhe hylkää kierroksen. Valinnaisen jälkianalyysin
vientivirhe kirjataan erikseen eikä yksin estä normaalia hyväksyntää.
Tallentimen varmentamaton lopetus tai tietovuoto ei ole pelkkä analyysipuute.
Pakollisiin portteihin ei lisätä `continue-on-error`-asetusta eikä
diagnostiikan annotationia peitetä. Nykyinen analyysityökalu säilyy;
vientikorjaus todennetaan säilytetyllä tai synteettisellä aineistolla ilman
tarpeetonta MSI-ajoa ja erillään normaalista hyväksynnästä.

Seuraava portti on paikallisten soveltuvien regressioiden ja virherajojen
varmennuksen jälkeen kaksi peräkkäistä täydellistä normaalia GitHub-kierrosta
samalta jäädytetyltä integraatiorevisiolta, keruu pois päältä. Producer
rakentaa kunkin pakettiperheen kerran kierrosta kohti; consumerit varmentavat
samat tavut ennen ja jälkeen. Lähde-, checkout- ja build-revisiot sekä
lopullisen revision oma riippuvuusturva kirjataan erikseen. Ensimmäisen
kierroksen hylkäys estää toisen käynnistämisen: seuraava työ on täsmärajan
korjaus tai päätös, ei samanlaisten uusintojen silmukka. Eri yritysten osia
ei yhdistetä hyväksynnäksi. Tunnettua turvallisuus- tai datariskiä ei
hyväksytä kahdella vihreällä kierroksella. Main, required checkit ja pilotti
pysyvät alla kuvattujen erillisten porttien takana.

Tämän jatkolinjauksen ensimmäinen normaali kokonaiskierros
[`34864080095`](https://github.com/eky-software/eky/actions/runs/34864080095)
revisiolta `9232b6ea4e2911ee3616b591c6290b77ceecc55f` on hylätty.
Tallennus oli pois päältä. Komentorajojen 12 jobia läpäisivät 824/824;
core-portit, clean ja upgrade/rollback 2/2, workspace-success 2/2 sekä
workspace-fault 10/10 valmistuivat. Valmistuneiden consumerien ennen/jälkeen-
tiivisteet vastaavat niiden producerien artifact-tavuja. Legacy run 2
valmistui, mutta run 1 peruutettiin 37 minuutin job-rajan vuoksi;
`V2 acceptance` hylkäsi kierroksen tuloksella `workflowNotSuccessful`.
Epäonnistuneen jobin loki ei ollut saatavilla job-rajapinnasta eikä koko
workflow'n arkistosta. Sen komento-, prosessi- ja siivouslopputila jäävät
varmentamatta; katkaisun sisäistä odotuskohtaa tai aiheuttajaa ei päätellä
puuttuvasta lokista. Saman revision
[riippuvuusturva](https://github.com/eky-software/eky/actions/runs/34864084066)
läpäisi runtime-/kokonaisauditoinnin ja pakettiallekirjoitusten tarkistuksen.
Hyväksyntä säilyy 0/2:ssa, eikä toista kokonaiskierrosta käynnistetty.
Main, required checkit ja julkaisu pysyvät ennallaan. Tästä kierroksesta
puuttuu epäonnistuneen consumerin komennon ja ylemmän ajoketjun
valmistumistila; aiempi onnistunut debug- tai tallennusajo ei korvaa sitä.

Rajattu CI-korjaus poistaa lifecycle-kutsusta `pnpm exec` -välikerroksen.
Projektin lukitun [pnpm-version virhepolku](https://github.com/pnpm/pnpm/blob/v11.1.3/pnpm/src/errorHandler.ts)
odottaa jälkeläisprosessien listausta ilman omaa aikarajaa ennen poistumista.
Jo päättyneen alikomennon virhe voi siten jäädä ylemmän kutsun odotukseksi.
Clean-, upgrade-, legacy- ja workspace-consumerit kutsuvat nykyistä
.NET-komentoa ja erillistä Node-tulosvarmenninta suoraan. Työkalut ovat
samat workflow'n jo valmistelemat työkalut; pnpm säilyy riippuvuuksien ja
buildien valmistelussa eikä sen versiota tai lockfilea muuteta.
Nykyiset komentorajaregressiot ajavat muuttuneen PowerShell-komentoketjun
oikeaan exit/close-tulokseen. Skenaarioiden Job-omistajuus, määräajat,
artifact-sidokset, pakollinen caller-result ja erilliset siivoustulokset
säilyvät. Ulomman testiturvan katkaisu ei kelpaa komennon valmistumiseksi.
Muuttuneiden komentorajojen, artifact-kytkentöjen ja CI-politiikan kohdesarjat
läpäisivät 294/294; desktopin typecheck ja build läpäisivät myös.
Tämä rajaa pois yhden ylimääräisen odotuksen, mutta ei osoita aiemman
legacy-katkaisun sisäistä syytä. Uuden revision normaali kokonaishyväksyntä
on edelleen avoin; vanhaa vihreää tai diagnostista näyttöä ei siirretä sille.

Suoran komentokytkennän normaali kierros
[`34874446863`](https://github.com/eky-software/eky/actions/runs/34874446863)
revisiolta `3147daf50eb1310c49ab6643f09a4e34ed5969fe` on hylätty.
Core-sopimusten molemmat toistot pysähtyivät samaan vanhentuneeseen
workflow-odotukseen; legacy-producer ja consumerit eivät käynnistyneet.
Odotus päivitetään vastaamaan suoraa komentoa ja erillistä tulosvarmenninta,
säilyttäen nykyiset aikabudjetit. Clean 2/2, workspace-success 2/2 ja
workspace-fault 10/10 valmistuivat. Upgrade run 1 palautti
`runningUpgradeMsiFailed`-virheen ja päättyi; run 2 läpäisi. Ensimmäisen
ajon tarkka MSI-koodi ei välittynyt konsolievidenceen, joten sitä ei
luokitella uudelleenkäynnistystarpeeksi tai aiemmaksi jumittumiseksi.
Koontiportti hylkäsi kierroksen; toinen kokonaiskierros jäi käynnistämättä.
Saman revision [riippuvuusturva](https://github.com/eky-software/eky/actions/runs/34874456414)
läpäisi. Hyväksyntä säilyy 0/2:ssa.

Päivityksen tuloskorjaus säilyttää myös epäonnistuneen operaation lopullisen
MSI-koodin ennen poikkeuksen luokitusta. Nykyinen vaihehavaintopolku välittää
rajatun `runningUpgradeResult`-havainnon: alkuperäinen ja lopullinen exit-koodi,
sovelluksen siivousluokka sekä nykyisen lokilukijan suljettu havainto.
Raakalokia ei julkaista. Virheellinen havainto tai tulostuksen epäonnistuminen
ei muuta alkuperäistä testitulosta; `3010` ja varmentamaton cleanup pysyvät
virheinä. Tämä korjaa tuloksen säilytyksen, ei vielä osoita MSI-virheen syytä.
Rajattu diagnoosi [34878306519](https://github.com/eky-software/eky/actions/runs/34878306519)
läpäisi nykyisellä consumerilla ilman uutta MSI-buildia. Harness ja checkout
olivat `55c7c4db7a4ce5b708863cbb562a753a3b3c38eb`, artifact-ID `10361132680`
ja build-revisio `3147daf50eb1310c49ab6643f09a4e34ed5969fe`. Ennen/jälkeen-
varmennukset vastasivat samaa descriptoria ja kolmea MSI-tiivistettä.
Alkuperäinen ja lopullinen MSI-koodi olivat 0; MSI:n valmistuminen havaittiin
sovelluksen poistumisen jälkeen. Suljettu lukija ei havainnut tunnettuja
reboot-syymerkintöjä. Pakollinen caller-result-varmennus, asennuksen poisto,
prosessien poissaolo ja fixture-siivoaminen läpäisivät. Tämä todentaa
korjatun tulostiedon kulun, ei aiemman MSI-virheen syytä. Normaali
kokonaishyväksyntä ja vanhat avoimet havainnot säilyvät erillisinä.

Muuttuneiden upgrade-lifecycle- ja tulossopimusten nykyiset testit kuuluvat
myös normaalin CI:n olemassa olevaan core-sopimusryhmään. Erillinen paikallinen
upgrade-testikomento ei yksin takaa näiden regressioiden CI-kattavuutta.

Jäädytetyn revision `6ec013bd6653ad3fa77f4d96f84262845da8993a` ensimmäinen
normaali kokonaiskierros
[`34879088504`](https://github.com/eky-software/eky/actions/runs/34879088504)
läpäisi ensimmäisellä yrityksellä ilman tallennusta. Sen 12 komentorajajobia
läpäisivät 846/846; clean, upgrade/rollback ja historical legacy läpäisivät
2/2, workspace-success 2/2 ja workspace-fault 10/10. Neljän producer-perheen
artifactit varmennettiin samoiksi tavuiksi ennen ja jälkeen consumerien;
lähde-, checkout- ja build-revisio olivat sama jäädytetty revisio. Myös sen
[riippuvuusturva](https://github.com/eky-software/eky/actions/runs/34879091289)
läpäisi kaikki kolme auditointi- ja allekirjoitusvaihetta.

Saman revision toinen normaali kierros
[`34882126613`](https://github.com/eky-software/eky/actions/runs/34882126613)
on hylätty, eikä kahden kokonaiskierroksen hyväksyntä täyty. Kaikki yllä
nimetyt paketoidut perheet ja niiden ennen/jälkeen-artifact-sidokset
läpäisivät myös toisella kierroksella. Electron critical -portin
`DESK-PDF-001` epäonnistui ennen testirungon alkua:
`playwrightConnect` valmistui, mutta `firstWindow` päättyi aikakatkaisuun.
Ensimmäisen yrityksen säilytetty turvallinen lifecycle-tulos vahvistaa
API- ja runtime-siivoamisen, portin vapautumisen ja testijuuren poistamisen.
Diagnostisen retryn läpäisy ei muuta flaky-tulosta hyväksytyksi;
`V2 acceptance` hylkäsi kierroksen. Kolmatta kokonaisajoa ei käynnistetä
samankaltaisena uusintana.

Seuraava avoin vastuu on Electron-E2E:n käynnistys ennen ensimmäistä ikkunaa.
Nykyinen näyttö ei erota mainin valmistelua, backendin valmiutta,
profiilin/palautuspisteen tarkistuksia ja ikkunan toimitusta Playwrightille.
30 sekunnin ikkunarajaa ei muuteta tämän puuttuvan havainnon perusteella.
Rajattu jatko käyttää nykyistä fixtureä ja käynnistyspolkua; se ei avaa
uudelleen läpäissyttä MSI-skenaariota tai lisää prosessivalvojaa.
E2E-entrypointin rajattu muistihavainto erottaa jo olemassa olevat
app-ready-, workspace-, backend- ja ikkunarajat. Fixture pyytää sen vain
käynnistysvirheessä nykyisellä Playwright-yhteydellä ilman lisäodotusta;
puuttuva havainto ja alkuperäinen testivirhe säilyvät erillisinä.
Tämä täsmentää seuraavan kokeen näyttöä, ei vielä korjaa tai selitä
ensimmäisen ikkunan CI-aikakatkaisua.
Diagnostiikan kytkentätesti säilyy erillään PDF-käyttäjäpolusta. Restart-
regressio todistaa oikealla Playwright-yhteydellä myös keskeneräisen
havaintoluvun päättymisen vanhan runtimen siivouksessa. Rajatun Windows-
CI-todennus käyttää nykyisen `ci.yml`-coren erillistä käsikäynnistystä
`electron_diagnostic=true`. Se valitsee vain olemassa olevan Electron-jobin:
Windows package, packaged smoke, critical-käyttäjäpolut sekä erillinen
käynnistyshavainnon kytkentätesti samalla valmistellulla E2E-buildillä.
Normaali reusable-kutsu vaatii edelleen riskisuunnitelman, myös V2:n
manuaalisessa kokonaisajossa. Rajattu ajo ei käynnistä MSI-matriisia eikä
tuota `V2 acceptance` -tulosta.

Rajattu ajo [34896344310](https://github.com/eky-software/eky/actions/runs/34896344310)
valmistui ensimmäisellä yrityksellä revisiosta
`93fc0f935c77f38e79cdbfc9248149609a1aecb1`; lähde ja lokista varmennettu
checkout olivat samat. Nykyisen Electron-jobin Windows package ja packaged
smoke läpäisivät, critical-polut läpäisivät 38/38 ja erillinen
käynnistyshavainnon kytkentätesti 1/1 ilman retryä tai flaky-tulosta.
Job valmistui kokonaan eikä sen check-run sisältänyt annotationeita.
Muut core-jobit ohitettiin tämän diagnostisen rajauksen mukaisesti;
MSI-matriisia ei käynnistetty. Tulos todistaa nykyisen havaintokytkennän
toimivuuden CI:ssä, mutta ei selitä aiempaa `firstWindow`-aikakatkaisua.
Ensimmäisen epäonnistumisen näyttö ja hylätty normaali hyväksyntäpari
säilyvät erillisinä. Kohdetestejä ei lasketa uudeksi normaaliksi
kokonaiskierrokseksi eikä hyväksyntää koota eri revisioiden osatuloksista.
Main, required checkit ja julkaisu pysyvät ennallaan. Aiemmat MSI- ja
legacy-havainnot säilyvät erillisinä, eikä niiden syitä nimetä korjatuiksi.

Seuraavan normaalin kierroksen
[34944223044](https://github.com/eky-software/eky/actions/runs/34944223044)
hyväksyntä on hylätty lähderevisiolla
`e7e192455df8c82f5e46293ad8a654cc966edbdb`. Legacy-core run 2:n yhteinen
GUI-fixturen käännösvalmistelu ylitti yleisen apurin 9000 ms työrajan:
272/278 läpäisi ja kuusi testiä hylättiin ennen testirunkojaan. Supervisor
palautti `deadlineExceeded`-tuloksen, varmisti `processTreeAbsent`-siivouksen
ja poistui. Saman revision run 1 läpäisi 278/278; se ei korvaa hylkäystä.
Omistaja hyväksyi vain tämän valmistelun erillisen 30000 ms kokonaisrajan
edellä kuvatulla muuttumattomalla siivousvarauksella. Kytkentä- ja virhepolut
läpäisivät 9/9 ja koko muuttunut core-sopimusryhmä 278/278; typecheck ja build
läpäisivät. Natiivin valmisteluviiveen syy jää avoimeksi.

Saman kierroksen upgrade run 1 hylättiin erikseen MSI-tuloksella 3010.
Nykyinen suljettu lokihavainto totesi `replacedInUseFilesObserved` ja
`rebootPendingObserved`, mutta ei paikantanut korvaamisen järjestystä
suhteessa sovelluksen sulkemiseen. Komento palautti virheen ja asennuksen
siivous valmistui; tätä ei luokitella käännösvalmistelun tai supervisorin
aikakatkaisuviaksi. Toista kokonaishyväksyntäkierrosta ei aloiteta tästä
hylätystä revisiosta. Sen erillinen
[riippuvuusturva](https://github.com/eky-software/eky/actions/runs/34944225422)
läpäisi, mutta ei korvaa epäonnistunutta toiminnallista porttia.

Rajattu [34946706274](https://github.com/eky-software/eky/actions/runs/34946706274)
valmistui ensimmäisellä yrityksellä ilman keruuta. Harness ja checkout olivat
`d2bf5921f036d6d01d3560cd7a47713138ac2599`; samojen ennen/jälkeen varmennettujen
MSI-tavujen build-revisio oli `e7e192455df8c82f5e46293ad8a654cc966edbdb`.
Koko upgrade-komento, pakollinen tulostarkistus, asennuksen siivous ja
fixture-poisto valmistuivat. 3010 ei toistunut, mutta tämä ei osoita sen
juurisyytä eikä korvaa uuden kuittausrevision koetta tai kahta normaalia
kokonaiskierrosta. Vanhoja paketteja ei lasketa uuden revision julkaisunäytöksi.

#### Aiemman näytön avoimet havainnot

Omistajan pyytämä normaalin legacy-workflow'n tallennettu/tallentamaton
vertailu [34855184997](https://github.com/eky-software/eky/actions/runs/34855184997)
valmistui lähde-, checkout- ja artifact-build-revisiosta
`ef3922a2f3a4714820cebf49938b09a46b00481f`. Nykyiset 12 sopimusjobia
läpäisivät 824/824 testiä ilman ohituksia. Sama normaali producer rakensi
yhden uuden artifactin (`10353271577`); molempien consumerien ennen/jälkeen-
varmennukset vastasivat sen descriptorin ja pakettien tavuja. Molemmat
legacy-komennot, pakolliset caller-result-varmentimet, semanttiset
jälkiehdot, asennus- ja fixture-siivoaminen sekä kokonaiset jobit läpäisivät.
Kummassakin lokissa oli 20 vaihekohtaista prosessipuun poissaolon havaintoa
ja valmistunut julkaisemisvaihe.

Consumer 1:n valinnainen tallennus käynnistyi ja pysähtyi, mutta analyysi
hylättiin `commandExport`-rajalla (`INSPECTOR_CAPTURE_TOOL_FAILED`).
Suljettu yhteenveto säilytti `analysisOutcome=failure`- ja
`captureResult=analysisUnverified`-tulokset erillään onnistuneesta testistä.
Valinnaisen vaiheen vihreä job-kuvake ei siis tarkoita onnistunutta analyysiä.
Consumer 2 ajettiin ilman tallennusta. Alkuperäinen viive ei toistunut;
tuotetarkistimen sisäistä odotuskohtaa tai aiempien legacy-katkaisujen syytä
ei paikannettu. Tämä oli saman normaalin consumer-toteutuksen rajattu
vertailu, ei koko V2:n hyväksyntäkierros eikä vanhojen havaintojen korjaus.
Vertailu ei oikeuttanut samanlaisen diagnostisen MSI-kokeen toistamiseen.
Yllä oleva uudempi omistajapäätös sallii normaalit kokonaisportit ilman
vanhan puuttuvan valmistumisnäytön palautumista; tämä havainto säilyy avoimena.

Tuotetarkistuksen synteettinen aikakatkaisu katetaan nyt myös legacy- ja
workspace-fault-perheiden todellisen PowerShell-käynnistysketjun kautta.
Nykyinen yhteinen komentofixture tarkistaa alkuperäisen deadline-virheen,
pakollisen caller-resultin, prosessipuun poissaolon, tulosvarmentimen
hylkäyksen ja ulomman komentoprosessin exit/close-rajan. Aineisto säilyy,
eikä skenaario tai uninstall käynnisty. Feasibility-workflow'n rajattu
`inspection-command-contracts`-valinta ajaa vain nämä kaksi nykyistä
sopimusta ilman MSI:tä tai tapahtumatallennusta; se ei ole kokonaisportti
eikä alkuperäisen natiiviviiveen tai legacy-katkaisun juurisyykorjaus.
Muuttuneet komentoryhmät läpäisivät 48/48, artifact-sopimukset 23/23,
CI-politiikka 54/54 sekä desktopin typecheck ja build.

Uusin normaali integraatiokierros
[`34844463051`](https://github.com/eky-software/eky/actions/runs/34844463051),
lähde- ja producer/consumer-checkout
`37b5c25b26a69673ada0b24a82ef550c51f8be65`, on hylätty. Kaikki 12
komentorajojen sopimusjobia, core-portit ja clean-, upgrade/rollback- sekä
workspace-success-consumerit 2/2 läpäisivät. Valmistuneiden consumerien
ennen/jälkeen-varmennukset vastaavat niiden producerien artifact-tavuja.
Fault-consumer 2 läpäisi kaikki viisi skenaariota. Fault-consumer 1 hylättiin
`preUpdateRecoveryPointFailure`-ajon `inspectSourceBefore`-deadlinella ennen
varsinaisen skenaarion alkua; kyseisen vaiheen prosessipuun poissaolo
varmennettiin. Virheen julkaisemisen exit 1 ei yksin todista caller-resultin
puuttumista, koska myös oikein julkaistu epäonnistuminen palauttaa exit 1:n.

Molempien legacy-consumerien GitHub-annotaatio ilmoittaa 37 minuutin
job-aikakatkaisun. Niiden lokit eivät olleet saatavilla job-API:sta eivätkä
valmistuneen workflow'n lokiarkistosta. Koko komennon lopputulos, prosessi- ja
asennussiivous sekä viimeinen todella valmistunut raja ovat siten
varmentamatta. Koontiportti hylkäsi kierroksen; 34 onnistunutta jobia ei
korvaa kahta peruutettua consumeria ja epäonnistunutta fault-consumeria.
Saman revision
[`Audit dependencies 34844466819`](https://github.com/eky-software/eky/actions/runs/34844466819)
läpäisi. Hyväksyttyjä lopullisia kokonaiskierroksia on edelleen 0/2.

Yksi erillinen, ennakolta rajattu
[`legacy-diagnoosi 34849625448`](https://github.com/eky-software/eky/actions/runs/34849625448)
käytti samaa harness-revisiota ja muuttumattomia legacy-artifactin tavuja
(artifact-ID `10347903077`). Komento, pakollinen caller-result-varmennus,
artifactin jälkivarmennus sekä olemassa olevan valinnaisen tallennuksen
aloitus, lopetus ja analyysi läpäisivät. Tämä on diagnostiikkaa, ei normaali
hyväksyntäkierros tai vanhojen keskeytymisten juurisyykorjaus.
Nykyisen synteettisen komentofixturen rajattu koe vahvistaa myös kyseisen
fault-perheen inspection-deadlinen, alkuperäisen virheen säilymisen,
pakollisen caller-resultin, todellisen exit/close-rajan ja aineiston
säilyttämisen ilman skenaarion tai uninstallin käynnistämistä.

Vanhan havainnon juurisyyn paikantamiseen tarvitaan näyttö epäonnistuvasta ajosta:
valmistuvatko Eky-komento ja sen pakolliset tulokset ennen ylemmän
komentoketjun/runnerin katkaisua, ja mihin tuotetarkistuksen alku- ja
loppuhavainnon väliin odotus jää. Onnistunut erilliskoe tai puuttuva
konsolirivi ei vastaa näihin kysymyksiin. Uutta samanlaista kokonaista
MSI-diagnoosia, aikarajamuutosta tai uutta valvontakerrosta ei käytetä tämän
havainnon korvikkeena. Uusin jatkopäätös erottaa tästä normaalin hyväksynnän
keräämisen. Required checkit, main ja julkaisuversio säilyvät ennallaan
niiden omien porttien täyttymiseen asti. Alla olevat aiemmat kierrokset ovat
historiallista näyttöä.

Ensimmäinen integraatiokierros lähde- ja checkout-revisiosta
`e6bf270da368f08b966372d8c9e8ada0903cb6d8`,
[34837722838](https://github.com/eky-software/eky/actions/runs/34837722838),
ei kelpaa hyväksynnäksi. Kaksi sopimusjobia epäonnistui: rollback-bootstrapin
viiden sekunnin poistumisodotus ja workspace-success-komentofixturen
`inventoryAfter`-vaiheen deadline. Jälkimmäisen synteettinen vaiheraja on
4 sekuntia, josta 1 sekunti on siivousta; tämä ei ole varsinaisen paketoidun
komennon vaiheraja. Deadline-hylkäyksessä prosessipuun poissaolo varmennettiin,
mutta alkuperäistä viivettä ei paikannettu. Legacy-producer ja sen consumerit
jäivät tämän sopimusvirheen takia ajamatta. Clean-, upgrade/rollback- ja
workspace-success-consumerit läpäisivät kukin 2/2 samoilla ennen/jälkeen
varmennetuilla artifact-tavuilla; osatulokset eivät korvaa kokonaisporttia.
Saman revision [Audit dependencies 34837793012](https://github.com/eky-software/eky/actions/runs/34837793012)
läpäisi. Required-check-asetuksia tai mainia ei ole muutettu.

Checkpoint `1616b36` erotti rollback-testin todellisen virhepoistumisen
puuttuvasta onnistumiskuittauksesta. Sen 6/6 sopimusta ja 94/94 installer-unitia
eivät yksin todistaneet helper-puun virhesiivousta tai alkuperäisen CI-viiveen
syytä; seuraava omistajan hyväksymä muutos sulkee testin omistajuusrajan.
Omistaja hyväksyi seuraavan rajatun korjauksen: tavalliset synteettiset
komentovaiheet käyttävät nykyistä V2:n 30 sekunnin työvarausta ja 5 sekunnin
siivousvarausta. Lyhyt 4/1 sekunnin raja jää vain tarkoituksella jumitettavaan
vaiheeseen; muut vaiheet ja virheen julkaiseminen eivät peri sitä.
Normaaleja MSI-, skenaario- tai CI-jobirajoja ei muuteta. Samalla jäljellä
oleva rollback-bootstrap-fixture on siirretty nykyisen Job Object -omistajan
alle korvaamaan sen suora Node-omistajuus. Bootstrapin kuittaus ja poistuminen,
helperin elossaolo ja valmistuminen sekä koko puun ja supervisorin poistuminen
todistetaan erikseen. Helperin oma deadline, tiedostosignaalien polling ja
testin suora Node-kill on poistettu; uutta prosessivalvojaa tai fallbackia ei
lisätä. Kanava välittää vain synteettisen helperin sopimusta, ei skenaarion
hyväksyntää tai tuotantosovelluksen tietoja. Tuotannon launcher ei muutu.
Kohdennettu näyttö: rollback 7/7 viidessä peräkkäisessä sarjassa,
supervisor/legacy-core 267/267, yhteinen komentotoimitus 23/23, legacy-entry
25/25, clean/upgrade-entry 54/54, workspace-success-entry 20/20,
workspace-fault-entry 21/21 ja installer-unitit 94/94. Budjettivalinnan testi
käyttää fixturen todellista valitsinta, ja komentotestit tarkistavat syntyneet
vaihepyynnöt. Koko uuden revision kaksi normaalia CI-kierrosta ovat edelleen
erillinen hyväksyntäportti; tätä korjausta ei nimetä vanhojen MSI- tai
runner-havaintojen juurisyykorjaukseksi.
CI-politiikka 54/54, legacy-artifact-sopimukset 22/22, koko workspacen testit,
typecheck, backend/web/desktop-buildit ja diff-tarkistus läpäisivät myös.
Tarkoituksellisia timeout-, cleanup- tai MSI-hylkäyksiä ei muuteta onnistumisiksi.

Exact-release-siirron testattu lähde-, checkout- ja artifact-revisio on
`46f1b0aca3ecdd7b29ad803a955d23b245b9a4c0` /
[34784991143](https://github.com/eky-software/eky/actions/runs/34784991143).
Edellinen normaali V2-kokonaiskierros on edelleen erillinen
`a186668cf6d5b6dc6e745b1e8448ed94e7ae8abc` /
[34779534322](https://github.com/eky-software/eky/actions/runs/34779534322).
Dokumentaatiocommit ei ole uusi testattu artifact-revisio. Alla oleva lista
on käyttöönoton nykyinen työjärjestys; alempien tutkimuskappaleiden luvut
kuvaavat niiden nimettyjä historiallisia revisioita.

| Portti | Jäljellä oleva työ tai päätös |
| --- | --- |
| Riippuvuusturva | Hyväksytyt Hono/Vitest-patchit ja niiden normaali V2-CI ovat vihreät. Omistajan erikseen hyväksymä read-only-audit valmistui: tuotantopuu 0 löydöstä, koko puu 0 löydöstä ja 160/160 rekisteriallekirjoitusta varmennettu. `dcaeaff`-revision erillinen [Dependency security 34833180991](https://github.com/eky-software/eky/actions/runs/34833180991) läpäisi ensimmäisellä yrityksellä kaikki kolme tarkistusta (18 s). Riippuvuuksia tai lockfilea ei muutettu auditissa. Lopullisen revision oma `Audit dependencies` -portti vaaditaan silti; uusi löydös tarvitsee oman vaikutusarvion. |
| Exact-release-byte-reitti | Vanha Node/PowerShell-lifecycle on korvattu nykyisellä V2-producerilla, `--clean-command`-komennolla ja pakollisella `verifyCleanCallerResult`-tarkistuksella. Kohdetestit sekä puhtaan checkpointin samaa clean-ketjua käyttävät Windows-consumerit 2/2 läpäisivät. Koko jäljellä olevan vanhan MSI-jobin ja lopullisen cutoverin näyttö ei siirry tästä automaattisesti. Producer rakentaa kerran; release-, consumer- ja bundle-MSI:n hashien pitää vastata toisiaan. |
| Korvatun orkestroinnin poisto | Checkpoint `5495fa758fb91efbc44a727009e924ac0b2f68a5` poistaa 71 korvattua W6/PowerShell-orkestroinnin tiedostoa, niiden omat komennot ja vanhat CI-jobit. Shared builderit, fixturet ja tarkistimet säilyvät. Alla nimetyt kohdetestit läpäisivät, mutta lopullisen revision kokonaisportit vaaditaan ennen käyttöönottoa. Vanhaa required-check-asetusta ei ole muutettu; lähdediffi ei saa ohittaa sen erillistä päätöstä. |
| Lopullinen ympäristö ja toistot | Omistajan hyväksymä käyttöönottorajaus korvaa kaksi paikallista täyttä MSI/release-kierrosta kahdella peräkkäisellä täydellä normaalilla GitHub-kierroksella samasta lopullisesta integraatiorevisiosta ilman tallennusta: kaksi GitHub-kierrosta yhteensä, ei neljää. Ensimmäisen hylkäys pysäyttää toisen. Paikalliset soveltuvat testit, sopimustestit, typecheck ja build säilyvät. Yhden kierroksen kaksi consumeria eivät korvaa kahta kierrosta; eri revisioiden tai epäonnistuneiden kierrosten osia ei yhdistetä hyväksynnäksi. |
| Main-integraatio | Main-baseline `c1d010263ccf4dc490a709f58ea8a4a5b34fa03a` on edelleen poisto-checkpointin esi-isä. Poiston jälkeinen main-vertailu ja desktop-kytkennän rajaus on tarkistettu alla. Lopullinen integraatiorevisio, sen kokonaisportit ja main-siirto ovat vielä kesken. Jäädytettyjä PR:iä #257/#258 ei mergeä. |
| Required checkit | Omistaja hyväksyi nykyisten kuuden checkin korvaamisen `V2 acceptance`- ja `Audit dependencies` -porteilla vasta integraatiokatselmuksen ja lopullisten hyväksyntäporttien läpäistyä. Tarkat nimet, GitHub Actions -tuottaja ja koontikattavuus varmennetaan ennen vaihtoa. Nykyiset asetukset tallennetaan paikallisesti ja jälkivertailu sallii vain sovitun check-muutoksen; strict-ajantasaisuus, PR-vaatimus ja muut suojaukset säilyvät ilman suojaamatonta välivaihetta. |
| Merge-commit | Omistaja hyväksyi katselmoidun V2-integraation normaalin PR-mergen vasta porttien läpäistyä, ei jäädytettyjen historiallisten PR:ien yhdistämistä. Merge-commitin oma täysi main-ajo vaaditaan; sen epäonnistuminen pysäyttää julkaisun. PR- tai diagnostisen haaran vihreys ei korvaa sitä. |
| 0.2.8-pilotti | Vasta edellisten porttien jälkeen erillinen versionosto, puhdas release-revisio, exact-byte-smoke/lifecycle ja samojen tavujen bundle. Ei uudelleenrakennettua korviketta, avointa latausta tai stable-kanavaa. |

Alkuperäisiä legacy-/runner-, MSI 3010- ja tiedostotilahavaintoja ei nimetä
pelkällä uudemmalla vihreydellä korjatuiksi. Niiden viimeinen näyttö ja
luokitus katselmoidaan integraatioportissa; uusi rajattu tutkimus tarvitsee
uuden erottavan havainnon. Sovelluksen yleinen rakennekatselmus ja W7 ovat
pilotin jälkeisiä töitä.

Hyväksytty ympäristö- ja käyttöönottopäätös ei muuta testiperheitä,
skenaarioita, niiden toistoja, MSI-paluuarvojen hyväksyntää, turvallisuusehtoja
tai siivousvaatimuksia eikä hyväksy avoimia turvallisuus- tai datan
säilymisriskejä. Producer/consumer-tavusidos säilyy. Kummastakin kokonaisajosta
kirjataan lähde-, todellinen checkout- ja artifact-build-identiteetti erikseen;
lopullisen revision oma riippuvuusturvan tarkistus kuuluu hyväksyntään.

Exact-release-siirto käyttää jo hyväksyttyjä V2-rajoja: producerin build ja
artifact-varmennus ovat erillään 965 sekunnin clean-komennosta. Supervisorin
build saa nykyisen 3 minuutin vaiheensa; lifecycle ja ulkoinen 35 sekunnin
tulosverifieri mahtuvat nykyiseen 17 minuutin vaiheeseen (`965 + 35 < 1020`).
Vanhan MSI-jobin 45 minuutin kokonaisrajaa ei kasvateta. Sen mahdollinen
riittämättömyys ei oikeuta aikarajan nostoa eikä onnistumisen hyväksymistä
ilman terminal-tulosta. Varsinainen V2-clean-consumer säilyy erillisessä
27 minuutin jobissa. Julkaisukutsulle ei luoda uutta prosessiomistajaa,
valmistelijaa, automaattista fallbackia tai rinnakkaista testikehystä.

#### Käyttöönoton järjestys

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

Omistaja on hyväksynyt yllä rajatun required-check-vaihdon ja normaalin
PR-mergen niiden ehtojen täytyttyä. Muu repository-asetusten muutos tarvitsee
erillisen päätöksen. Porttia ei ohiteta eikä vanhaa poisteta ennen vastaavaa
todistettua kattavuutta. Koodin, komentojen, CI:n ja dokumentaation vaihto
tehdään yhtenä katselmoitavana cutover-kokonaisuutena. Versionosto ja
käyttäjälle toimitettava pilot-artifact ovat vasta tämän jälkeinen erillinen
julkaisuvaihe.

#### Valmisteltu poistodiffi

Tämä on lähdekoodin cutover-diffi, ei päähaaran tai required-checkien
käyttöönotto. Aiempi normaali CI 34779534322 ja exact-release CI 34784991143
todistavat korvaavat perheet; lopullisen poistorevision hyväksyntää ei
koosteta näiden eri revisioiden tuloksista.

Poiston jälkeinen integraatiokatselmus vertaa `5495fa7`-checkpointia yllä
nimettyyn main-baselineen: 355 tiedostopolkua (260 lisättyä, 24 muutettua ja
71 poistettua). Desktopin kuusi lähde-/testitiedostoa ovat muuttumattomat
aiempaan `b69baa561fb21bda693f0876bfca33ed14053eae`-katselmukseen nähden.
Kokonaisuutta ei kuvata pelkkänä testimuutoksena: mukana ovat mainin synteettisen
proof-käynnistyksen kytkentä, sen startup-tapahtuman tuottaja, suljettu proof-
kontrolli ja hyväksytty yksityinen istuntotodisteen muistikanava testeineen.
Näiden rajaus ja tavallisen käynnistyksen regressiot säilyvät; poistocheckpoint
ei muuta niitä. Manifesti-/lockfile-diffissä säilyvät erikseen hyväksytyt
Hono/Vitest-patchit. Desktopin ja installerin canonical-versio on edelleen
`0.2.7`; versionosto ei kuulu poistoon. Uutta main-ristiriitaa ei havaittu.
Tämä katselmus ei siirrä aiempien revisioiden paketoitua hyväksyntää nykyiselle
revisiolle eikä hyväksy avoimia historiallisia riskejä.

| Poistuva vastuu | Säilyvä invariantti ja nykyinen vastine |
| --- | --- |
| `runW6bLegacy*`, `w6bLegacyAcceptanceProcess`, `testW6bLegacy*`, `scripts/w6bLegacy/` | Historical artifactin alkuperä, kaksi smoke-sukupolvea, normaali startup, accepted-build-precedenssi, business/adoption/idempotenssi: `legacyUpgradeArtifact`, `legacyUpgradeSourceSmoke`, `legacyUpgradeProfileEvidence`, `legacyUpgradeLifecycle` ja niiden testit sekä `legacyCommandEntrypoint.process.test.mjs`. |
| `runW6b2Packaged*`, vanhat command worker/lifecycle/scenario-process/stop-vastuut ja `testW6b2Packaged*` | A/B/C-success ja viisi fault-skenaariota: `workspaceSuccessLifecycle`, `workspaceFaultLifecycle`, session-/profile-/postcondition-testit ja molemmat workspace-komentorajat. Pakollinen tulos ja komentoprosessin poistuminen säilyvät erillisinä. |
| `scripts/w6b2Success/`, `scripts/w6b2Fault/` ja niiden prosessi-/progress-testit | Nykyiset workspace Windows-runtime-, failure-boundary-, result-file- ja phase-writer-sopimukset. Näiden dynaaminen eteneminen ei käytä vanhaa PowerShell-ohjausta. |
| `testWindowsInstallerUpgrade` ja vanhat `windowsInstallerTestSupport`/process-tree/upgrade-attempt/MSI-host-apurit testeineen | `upgradeRollbackLifecycle` todistaa upgrade/downgrade/MSI- ja binary-rollbackin; `upgradeRunningApplication` todistaa sovelluksen ollessa käynnissä alkavan MSI API -päivityksen. Job-supervisorin ja komentorajojen omistajuus-/timeout-/cleanup-regressiot korvaavat vanhat puukyselyt. `closedDirectoryInventory.test.mjs` säilyttää tyhjän inventaarion vertailun käyttäytymistodisteena. |
| Rollback-bootstrap-testin suora Node-kill, helperin oma deadline ja tiedostosignaalien polling | Sama tuotannon bootstrap käynnistetään nykyisen V2 Jobin sisällä. Rajattu synteettinen helper kuittaa elossaolonsa yksityisessä kanavassa vasta bootstrapin havaitun poistumisen jälkeen. Pakollinen worker-tulos, Job-empty ja supervisorin exit/close korvaavat vanhat valmistumisoletukset. Puuttuva helper, aikainen poistuminen ja tarkoituksella jäävä helper säilyvät erillisinä virheinä. |
| Vanhat MSI/W6-jobit, kuusi vanhaa package-komentoa ja suorat `ci.yml`-triggerit | Nykyiset V2-producerit ja consumerit sekä `V2 acceptance`; `ciRunAcceptance.test.mjs` kattaa riskivalinnan, täydet toistot ja puuttuvat/ohitetut tulokset. Cleanin viisi todellisen CI-ketjun regressiota käyttävät jäljelle jäävää `windows-acceptance-v2-clean.yml`-komentoa. |

Tiedostoviittaukset tarkistetaan poistodiffissä uudelleen. Production rollback
-launcher ja sen prosessitesti säilyvät. Historical/provenance-, MSI/release-
ja bundle-builderit, W6B.2:n package-/run-fixturet sekä niiden testit säilyvät.
Myös `prepareWindowsInstallerUpgradeFixture`- ja
`w6bSyntheticWindowsPackageFixture`-moduuleissa on edelleen W6B.2-builderin
käyttämiä puhtaita fixture-funktioita; vanhan CLI-komennon poistaminen ei
oikeuta poistamaan näitä tiedostoja. Tuotannon proof-, startup-, backup-,
session- tai update-semanttiikkaa ei muuteta.

Poistodiffin kohdennettu näyttö: CI-politiikka 54/54, säilyvät installer-unitit
94/94, production rollback -launcher 3/3, neljän artifact-perheen sopimukset
18/18 + 22/22 + 15/15 + 62/62, todellinen clean-komentoraja 26/26,
legacy-/supervisor-core 266/266 ja korvaavat lifecycle-sopimukset 159/159.
Ryhmät sisältävät myös jaettuja tarkistuksia, joten lukuja ei lasketa
yksilölliseksi testimääräksi. Supervisor/fixture-build, desktopin typecheck
ja build sekä diff-tarkistus läpäisivät. Tämä on kohdennettu poistodiffin
näyttö, ei lopullinen koko revision packaged-hyväksyntä.

### Historiallinen käyttöönottokatselmus V2.8-checkpointin jälkeen

Seuraava katselmus ja sen poistoa edeltävät tiedostomäärät kuvaavat alla
nimettyjä revisioita. Ajantasainen työjärjestys ja poistodiffi ovat yllä.

Päivitetyn vastuu- ja kattavuuskatselmuksen lähde on
`b69baa561fb21bda693f0876bfca33ed14053eae` ja
main-baseline `c1d010263ccf4dc490a709f58ea8a4a5b34fa03a`. Main on tämän
V2-haaran esi-isä; välissä on 153 committia ja 292 muuttunutta tiedostopolkua.
Luvut kuvaavat tätä tarkistusta, eivät myöhemmän integraation pysyvää pohjaa.
PR:t #259-#266 muodostavat draft-pinon. Sen pohjana on myös jäädytetyn
#258:n testiharness-muutoksia. #257/#258:aa ei mergeä eikä historiaa kirjoiteta
uudelleen tämän katselmuksen perusteella. Integraatiossa arvioidaan koko
main-vertailu, ei vain viimeisen PR:n diffi.

Koko pinossa on myös desktopin lähdekoodia: `desktopComposition.ts` käyttää
`desktopStartupCompletion.ts`:n yhteistä tapahtuman tuottajaa ja validoidun
synteettisen proof-polun session-varmennusta. `w6b2PackagedProof.ts` ja
`w6b2PackagedSessionProbe.ts` omistavat yksityisen proof-sopimuksen. Tavallisen
käynnistyksen tapahtuma säilyy nykyisessä kohdassaan, mutta yhteisen
composition-kytkennän vuoksi pinoa ei kuvata pelkäksi irrallisten testien
muutokseksi. V2.6/V2.7:n session- ja käynnistysregressiot kuuluvat myös
integraation hyväksyntään. Package-muutokset ovat testikomentoja;
desktop-versio pysyy tässä vertailussa 0.2.7:ssä.

Tiedostopintojen luokittelu kattaa koko main-vertailun: CI 20,
V2-harness 201, supervisor ja sen testit 32, muu installer-testituki 16,
E2E 4, desktop-lähdekoodi ja sen testit 6, dokumentaatio 11 ja
package-scriptit 2. Neljä varsinaista desktop-lähdetiedostoa ovat yllä
nimetyt composition-, startup completion-, proof- ja session probe -vastuut;
loput kaksi ovat niiden testejä. `FirstStartUpdateCoordinator`,
`LocalUpdateHandoffCoordinator`, main-entrypoint, backendin business-koodi,
lockfile ja canonical release-konfiguraatio eivät muutu tässä vertailussa.
Lähdekoodikatselmus tarkisti uuden session-portin marker-, rooli-, vaihe- ja
nonce-rajat sekä tapahtuman järjestyksen suhteessa session-varmennukseen ja
proof-controlleriin. Tavallinen startup käyttää samaa nykyistä tapahtuman
tuottajaa entisessä kohdassaan. Tämä rajattu katselmus ei korvaa lopullisen
poistodiffin, CI-kytkennän tai koko pinon integraation hyväksyntää.

Vanhan MSI-portin siirtovaatimusten ajantasainen näyttö:

| Säilytettävä vaatimus | Vanha todiste | Nykyisen V2:n puute ja seuraava vastuu |
| --- | --- | --- |
| Vaurioituneen asennuksen repair palauttaa täsmälleen oikean payloadin | `testWindowsInstallerLifecycle.ps1` poistaa asennetun backend-tiedoston ja ajaa `/fa`-korjauksen sekä payload-vertailun | Nykyinen clean-lifecycle vertaa koko payloadin. Normaalin CI 34721403661:n consumerit 2/2 läpäisivät; lopullisen cutover-revision näyttö tarvitaan erikseen. |
| Uninstallin jälkeinen reinstall säilyttää saman profiilin datan ja poistuu puhtaasti | Sama vanha lifecycle asentaa, korjaa, poistaa, asentaa uudelleen ja poistaa uudelleen | Nykyinen clean-ketju tarkistaa profiilin siirtymien yli. Sama CI 2/2 läpäisi pakollisen reinstall-tuloksen, poistot ja artifactin jälkivarmennuksen. |
| Setup-päivitys sovelluksen ollessa käynnissä | `testWindowsInstallerUpgrade.ps1` käynnistää MSI:n elävän Ekyn rinnalle ja tarkistaa odotuksen tai hallitun eston sekä lopullisen version ja datan | Hyväksytyn MSI API -adapterin normaali CI 34721403661 läpäisi 2/2, molemmissa alkuperäinen MSI-tulos 0. API-testi ei väitä todistavansa suoran CLI:n identtistä rinnakkaisajoitusta; suora CLI-kattavuus säilyy muissa installer-poluissa. Aiempi 3010 ja erillinen tiedostotilahavainto eivät saa tästä juurisyykorjausta. |

Näille ei luoda uutta supervisoria tai ajokehystä. Korvaavan ketjun pitää
käyttää samaa prosessiomistajaa, muuttumattomia artifact-tavuja ja erillisiä
alkuperäisen virheen, cleanupin ja jälkiehtojen tuloksia. Ensin tehdään
käyttäytymisregressiot nykyisiin vastuisiin, sitten sovitut clean/upgrade-
consumerit. Vanhoja lifecycle-/upgrade-tiedostoja ei poisteta ennen näyttöä.
Asennustilan lukijan tunnettu virhe säilytetään päivityskoordinaattorin läpi
omana virheluokkanaan; sitä ei korvata yleisellä päivitysvirheellä. Tämä
käyttäytymisregressiolla todistettu tarkennus ei yksin selitä avoimen
native-ajon syytä. Varmennettu jälkisiivous ei muuta epäonnistunutta
skenaariota hyväksytyksi eikä valtuuta hyväksyntäuusintaa.
Clean-siirto vertaa koko asennetun payloadin installin, repairin ja
reinstallin jälkeen producerin nykyisellä package-inventory-vastuulla
laskettuun tiivisteeseen. Puuttuva, muuttunut tai ylimääräinen tiedosto
torjutaan. Uusi testidescriptor sitoo inventoryn tuotantomanifestiin;
tuotantomanifesti, paketointi ja versio säilyvät ennallaan. Ehjä lähdeartifact
ei yksin todista asennettujen tiedostojen eheyttä. Vanhaa vihreää artifactia
ei käytetä tämän laajennetun ketjun hyväksyntänä.

Julkaisuvastuita ei myöskään kadoteta vanhan jobin mukana. V2-clean-producer
käyttää nykyistä pilot-paketointia, locked-restore-tarkistusta ja
`releaseWindowsInstaller.mjs`:n MSI-inspector-/sidecar-varmennusta;
consumerit varmentavat artifactin ennen ja jälkeen. Core ajaa erikseen
`smoke:windows`-portin. Vanhan `installer:local-pilot-bundle`-portin
korvaava kytkentä on hyväksytty rajattuna muutoksena: clean-producer käyttää
`buildWindowsAcceptanceArtifact`-vastuuta ja olemassa olevia
`createLocalPilotReleaseBundle`-/`verifyLocalPilotReleaseBundle`-funktioita.
Tarkistuskopio käyttää kerran rakennettua MSI:tä ja sidecaria; MSI-hash
verrataan consumerille toimitettavaan artifactiin. Kopio poistetaan ennen
suljetun artifact-inventoryn loppuvarmennusta eikä bundlea ladata artifactiksi
tai käyttäjäjakeluun. Epäonnistunut varmennus tai kopion poisto estää
producerin onnistumisen. Pakollinen `pilotBundleVerified`-tulos tarkistetaan
workflowssa; build-, varmennus- ja upload-vaiheet vaaditaan CI-koonnissa.
Puuttuva, epäonnistunut, peruutettu tai ohitettu vaihe hylätään myös silloin,
kun jobin ylätason tulos väittää onnistumista.

Kytkentä on toteutettu; kohderegressiot ja uuden revision normaali CI-näyttö
kuuluvat tämän checkpointin hyväksyntään. Vanhaa MSI-jobia ei poisteta tämän
muutoksen mukana. Pelkkä builderin yksikkötesti ei korvaa CI:n todellisten
MSI-tavujen varmennusta eikä käyttäjäjulkaisun erillistä exact-byte-hyväksyntää.

| Vastuu | Poiston tai säilyttämisen ehto |
| --- | --- |
| Vanhat W6/W6B.2-komento- ja scenario-orkestroijat | `installer:w6b-legacy`, `installer:w6b2-success` ja `installer:w6b2-fault-rollback` ovat yhä `ci.yml`:n kolmen vanhan W6-jobin käyttämiä. Poistoehdokkaita vasta invarianttikohtaisen V2-näytön sekä CLI-, workflow- ja import-viittausten siirron jälkeen. Niiden mukana poistetaan vain korvatun orkestroinnin omat testit. `installer:upgrade` ja sen fixture-kytkentä käsitellään samoin MSI-jobin siirrossa. |
| `windowsInstallerTestSupport.ps1` ja vanhat prosessi-/odotusapurit | Ei poisteta niin kauan kuin repair/reinstall/running-upgrade tai jokin muu säilyvä kuluttaja tarvitsee niitä. Viittaustarkistus tehdään uudelleen poiston commitilla. |
| `runWindowsInstallerReleaseLifecycle.mjs`, sen argumenttitesti ja `testWindowsInstallerLifecycle.ps1` | Julkaisureitti siirretty nykyiseen V2-produceriin ja clean-komentoon; kolme tiedostoa sekä `installer:lifecycle`/`installer:release-lifecycle` poistettu. MSI-jobin ja README:n käyttäjät siirretty samalla. Paketoitu näyttö ennen poistoa: `a186668` / CI 34779534322, clean 2/2. Poistorevision `46f1b0a` kohteet 44/44, todellinen komentoraja 26/26 ja CI 34784991143:n clean 2/2 läpäisivät. |
| `buildWindowsInstaller.mjs`, `releaseWindowsInstaller.mjs`, historical builder/provenance ja `buildW6b2PackagedSuccessInstallers.mjs` | V2-producerien käyttämiä paketointi-/fixture-vastuita, eivät automaattisia poistokohteita. |
| `w6b2PackagedSuccessRunFixture.mjs` ja `w6b2PackagedFaultRunFixture.mjs` | Nykyinen V2-workspace-runtime käyttää näitä suoraan; säilytetään ilman nimeen perustuvaa yleissiivousta. |
| Desktopin private proof, business-verifierit ja package smoke | Säilytetään. Vanhan harnessin poistaminen ei poista niiden invariantteja tai tuotannon käynnistyskytkentöjä. |

Revisiossa `ae63e29` julkaisukutsu käytti vielä erillistä Node-wrapperia ja
PowerShell-lifecycleä. Nyt julkaisureitin auktoritatiivinen komento on sama
`--clean-command` kuin V2-clean-consumerilla. Nykyinen producer muodostaa
payloadin, MSI:n, sidecarin ja sidotun artifactin kerran. Vanha MSI-jobi
käyttää samaa produceria ja tulosverifieriä; se ei rakenna release-MSI:tä
uudelleen ennen jälkivarmennusta tai bundlea. Erillinen upgrade-fixture saa
edelleen rakentaa vain omat synteettiset target-/rollback-pakettinsa.

Vanhan argumenttitestin vastine on nykyisen clean-komennon tiukka
descriptor/revisio/tulos-sidos ja julkisen komentorajan virhetesti.
`cleanInstallUninstallLifecycle` säilyttää install-, vaurioitetun payloadin
repair-, uninstall/reinstall-, rekisteri- ja profiilivaatimukset.
`cleanCommandPhase` ja caller-result vaativat lisäksi prosessien poissaolon,
semanttiset jälkiehdot ja nimenomaisen aineiston poistamisluvan. Nykyiset
viisi cleanin CI-ketjutestiä suorittavat siirretyn MSI-jobin komentoketjun
synteettisesti ja vaativat sen olevan identtinen V2-consumerin ketjun kanssa:
onnistuminen, estynyt diagnostiikka, puuttuva tulos, jumittuva uninstall ja
skenaario-/cleanup-virheen erillisyys. Testikehystä tai toista ajajaa ei lisätty.

Muut vanhat W6-/upgrade-orkestroijat ja workflow-jobit eivät poistu tämän
rajatun siirron mukana; niiden käyttäjät ja required-check-raja ovat edelleen
seuraavan poistokatselmuksen kohteita. Jaetut artifact-/bundle-työkalut,
fixturet ja turvallisuustarkistukset säilyvät nimettyinä vastuina.

Poiston jälkeiset installer-unitit 164/164 ja Windows-prosessisopimukset
77/77 läpäisevät, samoin CI-politiikan testit sekä desktopin typecheck/build.
Kohderyhmän 44/44 ja clean-komennon 26/26 ovat käyttäytymis- ja
kytkentänäyttöä. Poistorevision rajattu CI 34784991143 läpäisi ensimmäisellä
yrityksellä: producer 4 min 51 s, clean run 1 3 min 34 s ja run 2 3 min 27 s.
Molemmat consumerit käyttivät artifactia `10326063522`, jonka descriptor on
`f7aa78aba3aa2b3b4cb8f304227504a82451826ad15481421b6fdb22bf168431` ja MSI
`f10b4d1f715864323b74305bf22d64d33e5874070587be66849d2a4a0825f78b` (SHA-256).
Samat identiteetit varmennettiin producerissa sekä ennen ja jälkeen
kummankin consumerin. Bundle-tarkistuskopio hyväksyttiin ja poistettiin;
käyttäjäbundlea ei julkaistu. Install, repair, uninstall/reinstall, payload,
profiilin säilyminen, semanttiset jälkiehdot, fixture-poisto ja publish
valmistuivat. Pakollinen caller-tulos tarkistettiin komennon poistumisen
jälkeen; kaikki 14 vaihekohtaista Job-puun poissaolohavaintoa kummassakin
consumerissa valmistuivat. Tämä on yhden siirretyn perheen näyttö, ei kaksi
V2-kokonaiskierrosta eikä vanhan koko MSI-jobin ajobudjetin hyväksyntä.
Tuotantokoodia, riippuvuuksia, testibudjetteja tai required-check-asetuksia
ei muutettu tässä siirrossa.

Hyväksytty required-check-siirto, toteutus vasta kokonaisporttien jälkeen:

- Nykyisen aktiivisen main-rulesetin kuusi pakollista nimeä ovat
  `Test, typecheck and build`, `System security E2E`, `Web critical E2E`,
  `Windows Electron critical E2E`, `Audit dependencies` ja
  `Windows MSI release gate`. Hyväksytty korvaava yhdistelmä on `V2 acceptance` ja
  itsenäinen `Audit dependencies`; V2-koonti tarkistaa riskin valitsemat
  yksittäiset jobit, vaiheet ja kaikki vaaditut toistot.
- Strict-ajantasaisuus, vaadittu PR ja GitHub Actions -tuottajaan sidonta
  säilyvät. Vanhaa checkiä ei vapauteta ennen korvaavaa vihreää kattavuutta
  ja yllä olevan hyväksytyn päätöksen ehtojen täyttymistä. Suojauksia ei
  väliaikaisesti poisteta. Tallennetun rulesetin ennen/jälkeen-vertailu
  varmentaa, että vain sovittu pakollisten checkien lista muuttui.
- V2:n reusable-core-jobien nimet ovat prefiksoituja. Vanhojen suorien
  triggerien poiston yhteydessä ei jätetä pakolliseksi nimeä, jota uusi
  workflow ei tuota. Nimet ja triggerit tarkistetaan yhdessä samalla
  integraatiorevisiolla ennen asetusten vaihtoa.
- Kattavuusaukkojen sulkemisen jälkeen valmistellaan ajantasaiseen mainiin
  kohdistuva integraatiokatselmus, vanhan/uuden vertailu ja ehdotettu
  poistodiffi. Vasta hyväksytyssä siirrossa muutetaan required checkit ja
  poistetaan korvattu orkestrointi. Merge tehdään yllä hyväksytyn normaalin
  PR-menettelyn kautta, ja sen jälkeen vaaditaan merge-commitin täysi main-ajo;
  PR:n tulos ei korvaa sitä.

Koko V2:n käyttöönottorajaus on nyt hyväksytty erikseen yllä: kaksi täydellistä
normaalia GitHub-kierrosta samasta lopullisesta integraatiorevisiosta korvaa
aiemman paikallisen MSI/release-kierrosten vaatimuksen. V2.5-V2.7:n vanhoja
vaihepäätöksiä ei käytetä tämän perusteluna. Saman CI-ajon kaksi consumeria
eivät ole kaksi erillistä kokonaiskierrosta.

## Valmis-määritelmä

V2 voidaan korvata nykyisen harnessin tilalle vasta, kun sama commit täyttää:

- paikalliset unit- ja process-contract-kohdetestit sekä muut soveltuvat testit,
  typecheck ja build
- kaksi täydellistä normaalia GitHub-kierrosta yhteensä samasta lopullisesta
  integraatiorevisiosta ilman rerunia, flakyä, peruutusta tai ulkoista timeoutia
- lopullisen revision oma riippuvuusturvan tarkistus
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

### Ajantasainen testikartta ja avoimet rajat

Kartan lähdekatselmuksen perusta on `08eed10d36781a8a893776282ea18c02e93f9ec3`.
Se kuvaa toteutusta, ei tämän revision kokonaishyväksyntää. Alla olevat
ajat ovat versionoituja sopimusrajoja, eivät konekohtaisia mittauksia.
Kanoniset komennot löytyvät juuri-, desktop- ja E2E-`package.json`-tiedostoista;
CI-kytkentä sijaitsee repositoryn `.github/workflows`-kansiossa.

| Perhe | Tarkoitus ja nykyinen vastuu | Komento tai CI-raja |
| --- | --- | --- |
| Yksikkö- ja integraatiotestit | Domain, backend, web ja desktop: käyttäytyminen omistavan moduulin vieressä; ei paketoidun Windows-ketjun korvike | `pnpm test`, `pnpm typecheck`, sovellusten buildit; core-job 15 min |
| CI-politiikan sopimukset | Oikeat repositorypolut, riskiluokitus, vaaditut jobit ja vaiheet, puuttuvan tai osittaisen matriisin hylkäys | `pnpm test:ci`; `ciRiskPolicy.mjs` ja `ciJobCoverage.mjs` |
| System security / web critical | Rajapinta-, turvallisuus- ja selainpolut synteettisillä profiileilla | Omat 10/15 min CI-jobit; Playwrightin hallitsemat käyttäjäpolut |
| Electron critical | Development-runtime, ikkuna, latautuminen, restart ja käyttäjäpolut; fixture omistaa oman runtimen ja portin | `e2e:electron:critical`; yksi worker, ensimmäisen epäonnistumisen näyttö säilyy ja flaky hylätään |
| Supervisor- ja komentorajaregressiot | Root-exit, Job-empty, worker-result, cleanup sekä kiinteiden komentojen virhepolut | `installer:test:windows-supervisor` ja `installer:test:windows-supervisor-v2-legacy`; jälkimmäisen kuusi vastuuryhmää ajetaan CI:ssä kahdesti, 10 min / job |
| Tuotannon rollback-bootstrapin sopimus | Oikea bootstrap, synteettinen helper ja yksi nykyinen V2 Job; ei MSI-asennusta eikä uutta tuotantokomponenttia | `installer:test:windows-process` rakentaa nykyisen supervisorin ja ajaa sarjan. Normaali pyyntö 35 s / cleanup 5 s; tarkoituksellinen helper-jumitus 10 s / cleanup 2 s; ulompi testiturva 60 s ei kelpaa valmistumiseksi. |
| V2 clean | Asennus, repair/reinstall ja poisto; nykyisen .NET-komennon kiinteät vaiheet, nimetty skenaarioworker ja erillinen result-verifier | `installer:v2-clean`; komento 965 s, skenaario edelleen 300 s / cleanup 30 s; CI-step 17 min, erillinen build 3 min, job 27 min |
| V2 upgrade / rollback | N -> N+1, downgrade-torjunta, Windows Installer rollback, binary rollback ja käynnissä olevan sovelluksen päivitys | `installer:v2-upgrade-rollback`; nykyinen .NET-komento 1565 s, skenaario edelleen 600 s / cleanup 30 s; CI-step 27 min, erillinen build 3 min, job 37 min |
| V2 historical legacy | Historiallinen 0.2.6-artifact, oikea käynnistys, major upgrade, uusi käynnistys ja datan säilyminen | `.NET --legacy-command` ja erillinen pakollinen caller-result-verifier; komentoraja 1 565 s, CI-step 27 min, normaali job 37 min |
| V2 workspace success | Synteettisen paketin päivitys, työtilojen eristys, restart, virheellisen historian torjunta ja vanhan session HTTP-hylkäys | `.NET --workspace-success-command` ja result-verifier; komentoraja 1 440 s, CI-step 25 min, job 30 min |
| V2 workspace fault | Viisi nimettyä fault/rollback-skenaariota samoilla varmennetuilla artifact-tavuilla | `.NET --workspace-fault-command` ja result-verifier; 25 min / skenaariovaihe, 140 min / consumer; täysi matriisi 5 x 2 |
| Valinnainen diagnostiikka | Nykyinen ulkoinen tallennus, vienti ja suljettu analyysi; ei hyväksynnän tai prosessisiivouksen omistaja | Erilliset start/stop/analyze-rajat; normaalissa opt-in-legacyssä 1/2/3 min lisävaraus, ei skenaarion työajasta |

Build-once-producerit omistavat paketoinnin ja immutable descriptorin.
Consumer ei rakenna MSI-paria uudelleen. Clean-producer varmentaa myös
samojen MSI-tavujen pilot-bundlen nykyisellä työkalulla ja poistaa
tarkistuskopion; tämä ei julkaise pilot-bundlea. Workspace success ja fault
jakavat saman producer-artifactin. Revisiosta raportoidaan erikseen
lähde-HEAD, CI:n todellinen checkout ja artifactin build-identiteetti.

Nykyinen clean/upgrade/legacy/workspace-käynnistysketju on GitHubin `pwsh` ->
suora `dotnet`-kutsu -> kiinteä .NET-komento -> nimetyt vaihetyöntekijät.
Tämän jälkeen sama CI-step suorittaa suoraan
`node .../verify...CallerResult.mjs`-verifierin ja tarkistaa sekä komennon
että verifierin exit-koodin. `pnpm` säilyy riippuvuuksien ja buildien
valmistelussa, mutta ei enää lifecycle-komennon tai sen result-verifierin
välikerroksena. Runnerin step-/job-valmistuminen on tämän yläpuolella,
ei sama asia kuin .NET-komennon lopputulos.

`.NET AcceptanceCommandProgram` käyttää nykyistä vaihelistaa ja samaa
Job Object -supervisoria. Työ, vaiheen cleanup-varaus, pakollinen julkaisu
ja komennon poistumisvaraus erotetaan `supervisorCommandBudgets.json`- ja
`CalculatePhaseTimeout`-vastuissa. Budjettimatematiikan regressio käyttää
toteutuksen laskentaa; oikeat estymis- ja poistumistestit pysyvät erillään.
Legacy-stepin 27 minuuttiin jää komentorajan ulkopuolelle 55 s ja
workspace-stepiin 60 s käynnistysketjulle ja verifierille. Tämä laskennallinen
ero ei yksin todista niiden valmistumista eikä oikeuta aikarajan nostoa.

Eristys perustuu synteettiseen ajokohtaiseen profiiliin, erillisiin
tiedostotavuihin, tarkkoihin tuoteidentiteetteihin ja artifact-varmennukseen.
Normaalia profiilia ei käytetä fixtureksi. Prosessin poissaolo, semanttinen
siivous, asennuksen lopputila ja aineiston poistamislupa pysyvät erillisinä.
Tuntematon cleanup säilyy virheenä ja aineisto säilytetään. Vaihehavainto
ei korvaa pakollista tulostiedostoa eikä prosessin todellista poistumista.

Riskikytkentä on toteutettu, mutta ei vielä koko repositoryn cutover:

- Kevyt, tunnistettu moduuli-/web-muutos valitsee core-, security- ja
  web-portit ilman raskasta Windows-matriisia.
- Muu desktop-muutos valitsee Windowsin perustason: Electron, sopimukset,
  smoke, clean, upgrade ja workspace success.
- Yhteinen elinkaariraja, kuten `profileBackup`, `runtime`, `update`,
  `workspaces`, turvallisuus tai paketointi, lisää legacy- ja fault-perheet.
- CI-politiikka, lukitut työkalusyötteet ja tuntematon polku valitsevat
  täyden matriisin. Main-, ajastettu ja manuaalinen täysi ajo säilyvät.
  Täysi suunnitelma vaatii kaksi consumeria; kevyempi Windows-suunnitelma
  yhden. Puuttuva, peruutettu tai odottamatta ohitettu valittu tulos hylätään.
- V2-feature-push ei käynnistä raskasta PR-ajon kaksoiskappaletta.
  Valmistellussa poistodiffissä `ci.yml` on controllerin reusable core;
  sen erillinen käsikäynnistys on vain rajattu Electron-diagnoosi ilman
  V2-koontia. Vanhat suorat PR/main-triggerit ja W6-jobit on poistettu.
  Repositoryn main-käyttöönotto
  ja required-check-asetusten vaihto ovat edelleen erilliset avoimet portit.

Priorisoidut löydökset ja sulkemisehdot:

1. **Ylemmän käynnistysketjun kattavuus.** Katselmuksen lähtötilassa
   `acceptanceCommandEntrypointContract.mjs` käynnisti .NET-komennon suoraan
   ja workflow-käyttäytymistesti käytti stubattua pnpm-kutsua. Nykyistä
   synteettistä fixtureä on täydennetty seitsemällä oikean CI-ketjun tapauksella:
   legacyssä onnistuminen, estyvä diagnostiikkakirjoitus, puuttuva worker-tulos,
   jumittuva poistovaihe sekä skenaariovirhe yhdessä epäonnistuneen siivouksen
   kanssa; lisäksi molempien workspace-komentojen onnistuminen. Testi käyttää
   versionoidun workflow'n kutsu- ja exit-tulkintaa, oikeaa PowerShell-ketjua,
   nykyistä .NET-komentoa injektoidulla skenaariolla ja oikeaa result-verifieriä.
   Vaihetulokset, native-kutsujen paluu sekä ulomman PowerShell-prosessin exit/close
   tarkistetaan erikseen. Ulompi pakkokatkaisu ei läpäise testiä. Epävarman
   lopputilan aineisto säilyy. Alkuperäiset suoran komennon regressiot säilyvät.
   Konsolitallenne jää yksityiseksi; estymistodiste käyttää nykyistä .NET-fixturen
   estyvää kirjoitinta. Tämä ei vielä testaa GitHub-runnerin lokikuljetusta tai
   selitä alkuperäistä legacy-jobin katkeamista. Normaali CI-hyväksyntä on auki.
2. **Clean/upgrade-valmistelun ja viimeistelyn raja.** Lähtötilan Node-callerit
   odottivat supervisorin `completion`-lupausta ja virhepolun `finally`-
   valmistumista ilman koko callerin rajaa. Ennen siirtoa nykyisen fixturen
   neljä karakterisointitapausta todistivat eron: supervisor-result saattoi
   valmistua, vaikka isäntä jäi eloon, caller-result puuttui ja vain ulompi
   testiturva katkaisi puun. Näyttö kuvasi aukkoa, ei hyväksyttyä valmistumista
   eikä alkuperäisen legacy-/runner-havainnon juurisyytä.

   **Omistajan hyväksymä korvaava siirto on kytketty molempiin komentoihin.**
   Clean ja upgrade käyttävät nykyisen `AcceptanceCommandProgram`-vastuun
   kiinteitä vaihelistoja. Sama supervisor omistaa kulloisenkin vaiheen
   prosessipuun. Artifact-, skenaario-, tuotetila- ja business-tarkistukset
   pysyvät nimetyissä nykyisissä vastuissaan. Nykyinen worker suorittaa
   MSI-operaation; vaihe ei käynnistä uutta supervisoria. Valmistelu, tuloksen
   luku, sallittu cleanup ja julkaisu kuuluvat samaan komentorajaan.

   Korvautuvat `runCleanInstallUninstall`- ja `runUpgradeRollback`-Node-callerit
   on poistettu. Niiden viimeiset `installerProductOperationProcess`-,
   `supervisorProcessLaunch`- ja `InstallerProductOperationProgram`-käyttäjät,
   käynnistyssäie ja putkiprotokolla on poistettu, ei jätetty varapoluksi.
   Tuotetilan luokittelut, operation-worker, result-file-lukija ja fixture-
   rakentajat säilyvät niitä edelleen käyttävissä nimetyissä vastuissa.
   Tuotantokoodi, MSI:n hyväksytyt tulokset, skenaariorajat ja fixture-poiston
   lupa eivät muutu. Uutta supervisoria, vaihegraafia tai riippuvuutta ei lisätä.

   **Aikapolitiikan erillinen päätös on hyväksytty.** Aiemmat 7/12 minuutin
   lifecycle-stepit jättävät 300/600 sekunnin skenaarioiden lisäksi vain
   120 sekuntia. Jo cleanin virhepolun exact-tuotetarkistus, mahdollinen
   uninstall ja jälkitarkistus tarvitsevat nykyisillä apuoperaatiorajoilla
   35 + 125 + 35 sekunnin enimmäisvaraukset. Valmistelu, tuloksen julkaisu
   ja fixture-poisto tulevat lisäksi. Näitä ei puristeta skenaarion sisään.

   Hyväksytty kiinteä vaihe- ja budjettikartta käyttää olemassa olevia V2-rajoja:

   | Vastuu | Omistaja | Clean | Upgrade |
   | --- | --- | --- | --- |
   | Result-kohteen valmistelu, alkuprofiilin inventory, fixture-materialisointi, exact-esitarkistus ja skenaarion valmistelu | Nimetyt Node-vaiheet nykyisen .NET-komennon Jobissa | 35 + 35 + 125 + 35 + 35 s | 35 + 35 + 125 + 2 x 35 + 35 s |
   | Nykyinen skenaarioworker, mukaan lukien sen hallittu semantic cleanup | Sama nykyinen supervisor; ei sisäistä uutta valvojaa | 300 s, josta cleanup 30 s | 600 s, josta cleanup 30 s |
   | Supervisor/scenario-resultin luku, tuotetila ja semanttinen päätös | Nykyiset nimetyt lukijat ja failure boundaryt rajatussa vaiheessa | 35 + 35 s | 2 x 35 + 35 s |
   | Sallittu exact-tuotteen poisto ja lopputilan varmennus | Nykyinen product-worker, yksi omistaja per vaihe | 125 + 35 s | 2 x 35 + 2 x 125 + 2 x 35 s |
   | Artifact-varmennus, loppuprofiilin inventory, sallittu fixture-poisto ja pakollinen julkaisu | Nimetyt nykyiset tarkistimet ja result-file-vastuu | 4 x 35 s | 4 x 35 s |

   Kaikki 35/125 sekunnin vaihevaraukset sisältävät nykyisen 5 sekunnin
   cleanup-varan. Vaihekattojen summat ovat 935/1535 sekuntia;
   normaalisti vaihe palautuu heti ehdon täytyttyä, ei katon täytyttyä.
   Nykyisen legacy-komentomallin 30 sekunnin summan ylittävä liikkumavara
   antaa clean-komennolle 965 s ja upgrade-komennolle 1565 s.
   `CalculatePhaseTimeout` säilyttää nykyisen erillisen julkaisu- ja
   poistumisvarauksen. Komennon ulkopuolinen pakollinen result-verifier
   varaa 35 s. Hyväksytty lifecycle-step on cleanissa 17 min ja upgradessa
   27 min, jolloin kummassakin jää 20 s ylemmän käynnistysketjun liikkumavaraa.
   Supervisor-build erotetaan nykyisen mallin mukaiseksi 3 minuutin stepiksi;
   consumer-jobien rajat ovat 27/37 min (lifecycle + build + 7 min muulle
   valmistelulle ja artifact-jälkitarkistukselle). Producerien tai tavallisen
   MSI-release-gaten rajoja ei muuteta.

   Tämä on enimmäisvarausten laskelma, ei mittaus normaalin ajon kestosta
   eikä lupa pidentää jumittuvan MSI-operaation aikaa. Cleanin ja upgraden
   kanoniset komennot sekä CI-kytkennät käyttävät tätä karttaa. Jos yksittäisen
   vaiheen sallittu työ tai hyväksymisehto muuttuu, tarvitaan uusi päätös.

   `cleanCommandPhase` ja `upgradeCommandPhase` kokoavat omat nimetyt porttinsa.
   Kummankin failure boundary erottaa puhtaan siivouspäätöksen jo suoritetun
   siivouksen tuloksesta. Puuttuva skenaariotulos ei valtuuta vieraan tuotteen
   poistamista. Cleanin asennus, repair/reinstall ja payload-tarkistus sekä
   upgraden downgrade-, Windows Installer rollback-, binary rollback- ja
   running-application-ehdot pysyvät nykyisissä lifecycle-workereissa.
   Clean säilyttää ProductState-only-luokittelun; upgrade säilyttää tuoteparin
   luokittelun. Epäonnistunut worker-result ei muutu onnistumiseksi exit 0:lla.

   Pakolliset `cleanCallerResult` ja `upgradeCallerResult` sidotaan revisioon,
   descriptor-SHA-256:een ja ajokertaan. Upgrade-result säilyttää alkuperäisen
   skenaarioproofin ja validoi sen nykyisellä sopimuksella, ei rinnakkaisella
   rollback-sääntökopiolla. Result-verifier vaatii myös oikean komennon exit 0:n.
   Normaali profiili, artifactit, MSI-paluuarvot, sovelluksen poistuminen,
   prosessipuun poissaolo ja fixture-poistolupa pysyvät erillisinä.

   | Poistettu tai siirretty tarkistus | Nykyinen korvaava käyttäytymistodiste |
   | --- | --- |
   | Node-callerin Promise/finally ja aukon karakterisointi | Yhteisen komentorajasarjan clean/upgrade-tapaukset: suora .NET sekä oikea pwsh/komento/verifier-ketju; exit ja close havaitaan ulkopuolelta |
   | Käynnistyssäiesillan ja putkikanavan mockit | Sama komentorajafixture: estyvä valmistelu, myöhäinen tulos, tulos ennen exitia, puuttuva tulos ja publish ennen exitia; ulompi pakkokatkaisu ei läpäise testiä |
   | Vanhan product-operation-isännän loppuun kulutettu cleanup | Nykyinen phase-continuation-regressio: cleanupUnverified estää seuraavan vaiheen; omistetun product-resultin lukija ei korota tilaa onnistumiseksi |
   | Tuoteoperaation valmistelu, native wait ja result I/O | Nykyiset owned-product-komentotestit: Preparation, NativeWait, Read, Remove, MissingResult, ResultBeforeExit, DeliveryHold/Failure ja ConsumerReadHold |
   | Cleanin ja upgraden caller-mockien ensivirhe/siivous | Perheiden failure-boundary-testit sekä komentotason scenarioAndCleanupFailed, scenarioAndProfileFailed ja scenarioAndRemovalFailed |
   | Tilapäisjuuren alias, tuoteluokittelu ja alkuperäisen tuotteen suoja | temporaryRootAlias tekee oikean read-only-tarkistuksen; phase-input- ja puhtaat single/pair-luokitteluregressiot; preconditionFailed estää mutaation |
   | Upgraden siivouksen ja jälkiehdon ero | applicationCleanupUnverified säilyttää aineiston; postconditionFailed säilyy virheenä onnistuneen semantic cleanupin jälkeen |
   | Kanavan sulkeutuminen hyväksynnän edellytyksenä | Putkea ei enää ole tällä polulla. Bound result-file, todellinen exit, tiukat lukijat ja julkaisuvirheen komentotesti korvaavat sen |

   Sopimuslistojen kuusi CI-ryhmää ovat core, commands, legacy-entry,
   clean-upgrade-entry, workspace-success-entry ja workspace-fault-entry.
   Inventaario tarkistaa kaikkien tiedostojen ja 120 komentotapauksen
   rekisteröinnin ilman puuttuvia tai päällekkäisiä tapauksia. Kumpikin CI-toisto
   kuuluu loppukoonnin vaatimukseen. Ryhmittely ei muuta yksittäisen
   timeout-testin sopimusta eikä paketoidun hyväksynnän vaatimuksia.

   Cleanin aiempi rajattu näyttö on 214/214 ja viimeistely 18/18. Upgrade-
   kytkennän erillinen komentorajasykli on 28/28. Sillan poiston jälkeisessä
   360 tapauksen sarjassa yksi vanhentunut workflow-budjettiassertio hylkäsi
   hyväksytyn upgrade-kytkennän; 359 muuta tapausta läpäisi. Korjauksen jälkeen
   muuttuneet workflow-/result-kohteet ovat 25/25 ja vahvistettu aineiston
   säilymisregressio 1/1. CI-listan vanha job-lukumäärä korjattiin kuuden ryhmän
   karttaan; sen koko sopimussarja on 54/54. Desktop typecheck/build läpäisevät.
   Ensimmäiset hylkäykset eivät muutu hyväksytyiksi uusinta-ajolla. Tämä
   kohdetodennus ei sisältänyt MSI-asennusta. Sen jälkeinen normaali
   [CI-kierros 34774919910](https://github.com/eky-software/eky/actions/runs/34774919910)
   läpäisi ensimmäisellä yrityksellä ilman raskasta tallennusta. Lähde-HEAD,
   kaikkien producerien ja consumerien todellinen checkout sekä artifactien
   build-revisio olivat `e1701050d424c8a88d0945a989a73592c8c5a4d6`.
   Clean-siirto on commitissa `4908cad830c02bcef561d6c7867ff8be014d0906` ja
   upgrade-siirto sekä korvautuvan sillan poisto tämän kierroksen HEADissa.

   Tiukka loppukoonti ja sama job-/vaihekatteen lukija vahvistivat 36/36
   vaadittua jobia. Koko ajossa onnistui 38 jobia; seitsemän vanhan tai
   erillisen diagnostisen polun ohitusta eivät korvanneet vaadittua näyttöä.
   Kaikki kuusi komentorajaryhmää läpäisivät molemmat toistot, samoin core-,
   security-, Electron- ja packaged-smoke-portit.

   | Paketoitu perhe | Tulos | Consumer-jobien CI-kestot |
   | --- | --- | --- |
   | Clean, repair/reinstall ja uninstall | 2/2 | 3 min 23 s / 3 min 40 s |
   | Upgrade, downgrade-torjunta, rollbackit ja running application | 2/2 | 4 min 2 s / 3 min 28 s |
   | Historical legacy | 2/2 | 3 min 12 s / 2 min 45 s |
   | Workspace success | 2/2 | 4 min 7 s / 4 min 19 s |
   | Workspace fault/rollback | 5 x 2 / 10 | 13 min 19 s / 16 min 20 s |

   Pakolliset sidotut caller-resultit hyväksyttiin komennon todellisen exitin
   jälkeen, ja jokaisen consumerin artifact-jälkivarmennus läpäisi. Vaiheiden
   prosessipuut todettiin poissa oleviksi. Tulosverifierit vaativat erikseen
   semanttiset jälkiehdot, normaalin profiilin muuttumattomuuden ja sallitun
   fixture-poiston; vaiheviestin `completed` ei korvannut näitä ehtoja.

   | Synteettinen CI-artifact | Artifact-ID | Descriptor SHA-256 |
   | --- | --- | --- |
   | Clean | `10323305974` | `11e5058ee487100b33a5a6fc25e534adb213810b743e88a08219a1a1bdac5889` |
   | Upgrade | `10322904472` | `3e5b02850451ef0d241c99762982d1e167bd2ba4711145cf8534a9c051281b45` |
   | Historical legacy | `10322829841` | `122f55ebec2a6dfccc375da2089d7cccb26c2a9b62dc84b60f72b7b1ffbafbdd` |
   | Workspace success/fault | `10322799949` | `2b7556d54a16e4f2ccbc1c7d52ad3694d5faec7b69b177194f68b65989f3aa1f` |

   | Siirretyn perheen MSI | SHA-256 |
   | --- | --- |
   | Clean | `2ccec07eeb16348a4710021882292ed2595732d7cd0f40c7915397ac0d48a50e` |
   | Upgrade source | `1c96aa09f61ce7fda42bbb5762cf7022c055ff79459fe861c054797162fd23c2` |
   | Upgrade target | `d567dba0d27c3d69e4b65ad0963042b1d9f5918f51d6d7eef24a9f327b1677db` |
   | Upgrade Windows Installer rollback | `89eeb9926a30dd819d5a9d9f23a2a82221b9993255531c71b25180ac29312f93` |

   Clean-producerin samojen MSI-tavujen bundle-varmennus läpäisi
   (`pilotBundleVerified`); tarkistuskopiota ei julkaistu pilot-pakettina.
   Tämä sulkee clean/upgrade-komentosiirron CI-checkpointin. Se ei selitä
   aiempaa legacy-/runner-katkeamista, siirrä näyttöä muuttuneille MSI-tavuille
   eikä korvaa lopullisen integraation toista normaalia kierrosta,
   riippuvuusturvan porttia, päähaaran käyttöönottoa tai 0.2.8-julkaisua.
3. **Normaalin hyväksynnän avoimet virheet.** Alla nimetty legacy-terminalin
   puute ja fault-rollback-hylkäys säilyvät avoimina. Diagnostinen onnistuminen
   samoilla tavuilla ei ole niiden juurisyykorjaus. Myös aiempi MSI 3010- ja
   erillinen tiedostotilahavainto on suljettava tai luokiteltava omalla näytöllä.
4. **Cutover ja päällekkäisyys.** Korvatut W6-komennot, niiden omat testit ja
   vanhat CI-jobit on poistettu checkpointissa `5495fa7` yllä kuvatun siirtokartan
   mukaan. Jaetut fixture-builderit ja edelleen käytetyt tarkistimet säilyvät.
   Lopullisen revision kokonaisportit ja hyväksytyn required-check-/main-siirron
   toteutus ovat vielä kesken. Koko sovelluksen yleissiivous ei kuulu tähän muutokseen.
5. **Hyväksynnän ja dokumentoinnin päätösraja.** Koko V2:n nykyinen DoD sisältää
   yllä hyväksytyn ympäristöpäätöksen mukaiset kaksi GitHubin täyttä kierrosta
   sekä soveltuvat paikalliset testit, typecheckin ja buildin. Vanhojen
   vaihekohtaisten rajauksien ei oleteta muuttaneen tätä vaatimusta.
   Vanhojen toteutussuunnitelmien
   lähtötilatekstit erotetaan nykytilasta ennen cutoveria; uusi rinnakkainen
   suunnitelma ei korjaa dokumentaation ristiriitaa.
6. **Riippuvuusturvan julkaisuportti.** Omistaja on hyväksynyt Hono
   `4.13.1 -> 4.13.5`- ja Vitest/`@vitest/mocker` `4.1.10 -> 4.1.11`
   -päivityksen. Manifestit käyttävät hyväksyttyjä täsmäversioita; lukon
   muu pakettijoukko säilyy. Advisory-katselmus, hyväksytty rajaus ja
   todennuksen tila ovat
   [dependency review'ssa](local-desktop-dependency-review.md#v2-julkaisun-avoin-riippuvuustarkistus).
   V2:n vihreät prosessitestit eivät korvaa tätä porttia. Honon päivitys
   muuttaa paketoitavaa backendia ja edellyttää uuden build-identiteetin
   mukaista artifact-hyväksyntää. Patchin normaali
   [CI-kierros 34779534322](https://github.com/eky-software/eky/actions/runs/34779534322)
   läpäisi ensimmäisellä yrityksellä: lähde-, checkout- ja artifact-revisio
   `a186668cf6d5b6dc6e745b1e8448ed94e7ae8abc`, vaadittu job-/vaihekate 36/36,
   kaikki paketoidut perheet kahdesti ja fault-matriisi 10/10. Tarkat
   artifact-identiteetit ovat dependency review'ssa. Auditit ja
   rekisteriallekirjoitukset läpäisivät myöhemmin revision `dcaeaff` erillisessä
   CI-ajossa 34833180991; lopullisen revision oma portti vaaditaan edelleen.
   Tämä ei ole koko V2:n
   integraatio-/käyttöönottokuittaus. Päivitystä ei nimetä legacy-jumin
   selitykseksi eikä aiempaa vihreää MSI-näyttöä siirretä uusille tavuille.

Diagnostiikan laajuus jäädytetään nykyiseen keruu-/vientivastuuseen.
Analyysikorjaus testataan säilytetyllä tai synteettisellä aineistolla.
Vientivirhe ei peitä komento- ja artifact-näyttöä. Tavallinen säikeen odotus
ei yksin ole syy. Seuraava koe joko erottaa avoimet vaihtoehdot tai johtaa
nimettyyn päätökseen; uutta samanlaista MSI-kierrosta ei aloiteta vain siksi,
että edellinen diagnoosi ei toistanut vikaa.

Rajattu checkpoint-varmennus: nykyiset komentoryhmät legacy 25/25,
workspace success 20/20 ja workspace fault 21/21 läpäisevät. Analyysirajan
synteettiset testit 12/12, legacy-artifact-/workflow-sopimukset 22/22 ja
CI-politiikka 53/53 läpäisevät. Tämä ei ole paketoidun matriisin tulos eikä
normaalin hyväksynnän korvike. Desktopin typecheck ja build läpäisevät;
tuotantokoodia tai aikarajoja ei muuteta. Tarkempi tutkimusaineisto pysyy yksityisenä.

### Historiallinen epäonnistuminen ja sitä seurannut diagnoosi

Tämä osuus säilyttää nimetyn revision epäonnistumisen ja sen jälkeisen
diagnoosin erillään yllä olevasta käyttöönoton nykytilasta. Normaali CI
[34724571256](https://github.com/eky-software/eky/actions/runs/34724571256)
epäonnistui lähde-HEADilla `c3ff7f66572c69e1ddae268c4bd285b255609344`.
Todellinen checkout ja artifact-build olivat
`1abab82f46e95b59476bdb537d8677ab7cd0fd00`. Bundle-varmennus, clean 2/2,
upgrade 2/2 ja workspace success 2/2 läpäisivät. Fault-matriisissa läpäisi
kuusi skenaariota, yksi epäonnistui ja kolme jäi ajamatta. Yhden consumerin
`activeWorkspaceFirstStartFailure` hylättiin `businessRollback`-vaiheessa
koodilla `proofResultInvalid`; toisen consumerin onnistuminen samoilla
tavuilla ei korjaa epäonnistumista.

Molempien legacy-jobien GitHub-annotaatio ilmoittaa 37 minuutin job-rajan
ylityksen. Komennon lopputulosta ja siivousta ei saatu varmennettua;
`majorUpgrade started` ei todista MSI:n käynnistymistä. Aiempi vihreä
kierros säilyy historiallisena näyttönä, ei tämän revision hyväksyntänä.
Ei uutta täyttä matriisia ennen näitä vaihtoehtoja erottavaa kohdennettua
näyttöä tai osoitettua korjausta.

Nykyinen rajattu korjaus erottaa proof-lukijan hylkäyskohdat: tulosrakenne,
vaihe-/skenaariosidos, tuntematon virhekoodi, prosessin epäonnistunut
poistuminen ja odotetun tilan ristiriita. Ne kulkevat nykyisen suljetun
virheluettelon, vaihehavaintojen ja pakollisen tuloksen kautta. Parserin
ehdot, prosessin `close`-odotus, istuntotodiste ja alkuperäisen virheen
etusija eivät muutu. Turvallinen luokitus on diagnoosin korjaus, ei vielä
osoitus alkuperäisen rollback-vian korjaantumisesta.

Olemassa olevan manuaalisen artifact-diagnoosin `workspace-fault`-valinta
ajaa vain `preUpdateRecoveryPointFailure`- ja
`activeWorkspaceFirstStartFailure`-skenaariot tässä järjestyksessä, saman
varmennetun artifactin erillisissä ajotiloissa. Kummankin komennon ja
pakollisen verifierin pitää valmistua ennen seuraavaa skenaariota.
Tämä ei lisää normaaliin matriisiin uusintoja eikä muuta hyväksyntäporttia.
Muuttunut harness-revisio ja alkuperäinen artifact-build raportoidaan
erikseen. Raaka-aineisto ei kuulu julkaisuun.

Rajattu CI-diagnoosi
[34751078853](https://github.com/eky-software/eky/actions/runs/34751078853)
läpäisi ensimmäisellä yrityksellä molemmat yllä nimetyt skenaariot.
Harnessin lähde- ja checkout-revisio oli
`7de5d27c218086d32ba6a92a1ab0de46befae1f4`; artifactin alkuperäinen
build pysyi revisiona `1abab82f46e95b59476bdb537d8677ab7cd0fd00`.
Artifact-ID `10307761466`, descriptorin tiiviste ja molempien MSI-tiedostojen
tiivisteet säilyivät ennen/jälkeen-varmennuksessa. Komentojen pakolliset
tulosverifierit läpäisivät, myös rollback, asennussiivous ja fixture-poisto.
Tämä todistaa rajatun diagnoosin kytkennän ja tulostoimituksen, ei aiemman
`proofResultInvalid`-virheen juurisyytä tai koko V2:n hyväksyntää.
Kohdesarjat: workspace 291/291, fault 282/282, legacy-artifact 22/22,
upgrade-artifact 15/15 ja CI-politiikka 53/53. Desktopin typecheck ja build
läpäisevät. Sarjoissa on yhteisiä testejä; lukuja ei summata erillisiksi
invarianteiksi. Katselmuksen viimeinen runtime-testin täsmennys läpäisee
119/119.

Legacyssä seuraava tarvittava erotus on koko komennon elinkaari:
komentoprosessin ja skenaariotyöntekijän poistuminen sekä niiden säikeiden
odotukset. Nykyinen valinnainen analyysi täydentää inspector-näkymää saman
jäljen prosessi- ja säie-elinkaarilla. Se valitsee vain tunnetun
legacy-komentorajan ja sen suorat, nimetyt vaihetyöntekijät. Tuntematon tai
moniselitteinen prosessielinkaari hylätään; tunnisteen uudelleenkäyttö ei saa
sitoa vieraita tapahtumia tähän komentoon. Komennon ja skenaariotyöntekijän
ajoitusnäkymä käyttää nykyistä rajattua CPU-vientiä. Tallennuksen loppuun
avoimeksi jäänyt prosessi tai säie erotetaan jäljessä havaitusta poistumisesta.
Puuttuva inspector-vienti ei hävitä riippumatonta komentotason havaintoa,
mutta analyysin puute säilyy virheenä. Keruun määrää, prosessiomistajuutta
tai aikarajoja ei muuteta. Jälkihavainto ei koskaan korvaa pakollista
cleanup-tulosta eikä osoita odotuksen syytä ilman erillistä näyttöä.

Lukijan ja analyysikytkennän rajatut käyttäytymisregressiot läpäisevät 10/10.
CI-kytkennän kohdesarja läpäisee 27/27, CI-politiikka 53/53 ja
legacy-artifact-sarja 22/22; desktopin typecheck ja build läpäisevät.
Sarjojen yhteisiä testejä ei summata erilliseksi kattavuudeksi.
Rajattu tallentava CI-diagnoosi
[34753986972](https://github.com/eky-software/eky/actions/runs/34753986972)
valmistui ensimmäisellä yrityksellä epäonnistuneeksi vain analyysin osalta.
Lähde- ja checkout-revisio oli `8ce861d9bc50c172f9f0ad5115808f398067557b`;
artifact-ID `10307233138` ja build
`1abab82f46e95b59476bdb537d8677ab7cd0fd00` säilyivät alkuperäisinä.
Legacy-komento ja pakollinen tulosverifier läpäisivät 2 min 14 s vaiheessa:
myös major upgrade, molemmat target-käynnistykset, semantiikka,
asennussiivous, lopputarkistukset ja fixture-poisto valmistuivat.
Tallennus pysähtyi ja artifactin ennen/jälkeen-tiivisteet täsmäsivät.
Koko jobi kesti 5 min 9 s. Analyysi hylkäsi ajoitustaulukon
`schedulingRead`-rajalla: `INSPECTOR_TRACE_TABLE_LIMIT`. Tämä ei ollut uusi
MSI- tai supervisor-aikakatkaisu, mutta diagnoosia ei merkitä vihreäksi.

Tämän havainnon jälkeinen rajattu lukijakorjaus julkaisee varmennetut
prosessielinkaaret ennen riippumatonta ajoitusvientiä. Taulukon tavu- ja
rivirajojen virheluokat erotetaan paljastamatta aineistoa tai määriä.
Molemmat ylitykset säilyttävät elinkaarihavaintojen lisäksi analyysin
virhetuloksen; kohdesarja läpäisee 10/10. Rajat eivät muutu.
Samalla vientisuodatus sidotaan prosessin ja säikeen yhdistelmään pelkän
säietunnisteen sijaan. Uudelleen käytetty säietunniste ei saa tuoda toisen
prosessin tapahtumia tutkittavan komennon vientiin. Lukijan elinkaaritarkistus
säilyy tämän lisäksi. Muodostettu suodatin torjuu tuntemattomat arvot ja
pyydetyn säikeen hiljaisen poisjättämisen; se ei ota otosta tapahtumista.
Korjauksen rajattu CI-koe
[34755435437](https://github.com/eky-software/eky/actions/runs/34755435437)
ajettiin ensimmäisellä yrityksellä lähde- ja checkout-revisiolla
`b6746719c434c4e25d52ecf97021edf518efeca3`. Artifact-ID `10307233138`,
alkuperäinen build ja ennen/jälkeen-tiivisteet säilyivät samoina.
Legacy-komento ja pakollinen verifier läpäisivät 2 min 16 s vaiheessa;
major upgrade, asennussiivous, lopputarkistukset, fixture-poisto ja
tuloksen julkaisu valmistuivat. Tallennuksen lopetus läpäisi.
Koko jobi kesti 4 min 15 s, mutta analyysi epäonnistui nyt jo
`commandExport / INSPECTOR_CAPTURE_TOOL_FAILED`-rajalla ennen lukijaa.
Tämä ei ole aiemman kokorajan korjauksen CI-varmennus eikä uusi MSI-jumi.

Nykyinen pieni raportointikorjaus kytkee myös `commandExport`-virheen
olemassa olevaan rajattuun, sallittuja havaintoluokkia palauttavaan
työkalutulosteen lukijaan. Raakatuloste jää yksityiseksi. Työkalun alkuperäinen
virhekoodi ja analyysin epäonnistuminen säilyvät, vaikka loki puuttuu tai
sen lukeminen ei onnistu. Kaksi käyttäytymisregressiota suorittaa nykyisen
työkalukutsun ja ylimmän virhekäsittelyn sekä vaatii komentoprosessin
todellisen virhepoistumisen; koko kohdesarja läpäisee 12/12.

Uutta MSI-koetta ei ajeta vain virheraportoinnin vuoksi. Tarkempi vientivirheen
viesti puuttuu tämän päättyneen runnerin sallitusta yhteenvedosta;
raakajälkeä tai yksityisiä työkalulokeja ei julkaistu. Pelkästä numerokoodista
ei päätellä jäljen vioittumista, tapahtumahävikkiä tai aikajärjestysvirhettä.
Vientityökalun toleransseja, lukurajoja tai hyväksymisehtoja ei muuteta.
Koko analyysin valmistuminen normaalien resurssirajojen sisällä on edelleen
avoin portti. Alkuperäinen legacy-jumi ei toistunut kummassakaan kokeessa;
sen juurisyy ja normaali kokonaishyväksyntä ovat edelleen avoimia.

### Edellinen normaali kokonaiskierros

Normaali integraatio-CI
[34721403661](https://github.com/eky-software/eky/actions/runs/34721403661)
valmistui ensimmäisellä yrityksellä hyväksytysti: 36 onnistunutta jobia,
7 riskisuunnitelman tai valinnaisen diagnoosin mukaista ohitusta ja
`V2 acceptance`: `ciAccepted`, `failedGates: []`. Lähde-HEAD on
`b69baa561fb21bda693f0876bfca33ed14053eae`; todellinen CI-checkout ja
artifact-build ovat `cf9af63738c7b60c58226da2518d116802729e2f`.
Tämä on yhden normaalin kokonaiskierroksen näyttö, ei koko V2:n cutover
tai käyttäjälle toimitettavan 0.2.8:n hyväksyntä. Tallennusta tai rerunia
ei käytetty tämän kierroksen hyväksynnän korvikkeena.

| Perhe | Tämän CI-kierroksen tulos |
| --- | --- |
| Clean install, repair, uninstall ja reinstall | 2/2 |
| Running upgrade, downgrade, binary rollback ja MSI rollback | 2/2, alkuperäiset MSI-tulokset 0 |
| Historical legacy | 2/2 ilman valinnaista WPR-keruuta |
| Packaged workspace success | 2/2 |
| Workspace fault/rollback | Viisi skenaariota kahdesti, 10/10 |
| Core, sopimukset, Electron-, web- ja security-portit | Kaikki valitut pakolliset vaiheet läpäisivät |

Consumerien pakolliset tulokset, prosessien poistuminen, semanttiset
jälkiehdot, asennussiivous, fixture-poisto ja artifactin ennen/jälkeen-
varmennus pysyvät erillisinä ehtoina. Legacy-/workspace-verifierin
onnistunut exit todistaa sen vaatiman tulostiedoston validoinnin; pelkkää
vaihelokia ei käytetä tämän korvikkeena. Kaksi consumeria yhdessä workflowssa
eivät ole kaksi erillistä kokonaiskierrosta.

Tuon checkpointin jälkeen avoimeksi jäivät vikojen luokittelu, lopullinen
kattavuus- ja poistokatselmus sekä käyttöönoton päätökset. Poistocheckpoint,
nykyinen kahden GitHub-kokonaiskierroksen ympäristöpäätös ja hyväksytyn
required-check-/main-siirron ehdot on päivitetty yllä olevaan
käyttöönotto-osuuteen. Tämä historiallinen ajo ei täytä myöhemmän revision
kokonaishyväksyntää.

### Avoimen 3010-havainnon päätösesitys

Aiempi CI 34715796076 palautti running-upgrade-testistä 3010:n ja hallitun
virhetuloksen varmennetulla siivouksella. Alkuperäisen verbose-lokin
puuttuessa uudelleenkäynnistystarpeen syy ja sen järjestys sulkemiseen nähden
ovat tuntemattomia. Uusi lukija korjaa rajatun syyluokituksen säilymisen;
vihreä diagnoosi tai uudempi normaali kierros ei todista vanhaa syytä
korjatuksi. Tuotannon `LocalUpdateHandoffCoordinator` odottaa
`shutdownRuntime()`-valmistumista ennen `launchInstaller()`-kutsua, mutta
tämä eri aloitusjärjestys ei yksin sulje pois yhteistä MSI-riskiä.

Ehdotus on säilyttää nykyinen 3010:n hylkäys ja suorittaa seuraavaksi vain
suunnitellut lopullisen revision hyväksyntäportit, ei satunnaisia
diagnoosiuusintoja. Jos 3010 toistuu, kyseinen hyväksyntä jää epäonnistuneeksi;
suljettu havainto, alkuperäinen MSI-tulos, prosessisiivous ja tuotetila
säilytetään erillisinä. Raakalokia ei julkaista eikä epävarmasti siivottua
ympäristöä käytetä seuraavaan mutatoivaan ajoon. Tarkka uusi havainto rajaa
seuraavan korjauksen. Ennen pilotin jakelua tarvitaan lisäksi täsmällisten
julkaisutavujen asennus-, päivitys- ja restart-näyttö. Jos syy jää senkin
jälkeen avoimeksi, jäljellä olevan riskin hyväksyminen pyydetään omistajalta
erikseen; sitä ei päätellä jatkamisluvasta eikä sillä muuteta vanhan ajon
tulosta onnistuneeksi.

Korvatun orkestroinnin poisto, required-checkien vaihto, main-käyttöönotto ja
0.2.8-pilotti säilyvät siirtokartan erillisten hyväksyntärajojen takana.

### Historiallinen hyväksyntä ja rajattu diagnoosi

Hyväksyntä jäi kesken lähde-revisiolla
`05242e856c5f8826adcfc3bf877787290fce3728`, checkout/build-revisiolla
`1a78b3137c15dc4b358affcf915ee30449041935`.
[CI 34650330864](https://github.com/eky-software/eky/actions/runs/34650330864)
ei ole hyväksytty kokonaiskierros. Kolmannen yrityksen täydessä toistossa
legacy run 1 palautui `inspectSourceBefore`-aikakatkaisuun varmennetun
prosessisiivouksen jälkeen; legacy run 2 päätyi ulkoiseen katkaisuun ilman
saatavilla olevaa komennon lopputulosta. Nämä ovat erillisiä havaintoja.
Neljännen yrityksen rajattu legacy run 2 -diagnoosi läpäisi koko komennon,
pakollisen tulosvarmennuksen ja artifactien jälkivarmennuksen samalla
artifact-ID:llä `10286568864`. Muut jobit eivät olleet uusia hyväksyntäajoja;
kokonaisportti säilyi hylättynä. Onnistunut diagnoosi ei selitä aiempaa vikaa.

Pää- ja alatyönkulun concurrency-avaimet ovat erilliset. Tutkitulla
peruutusvälillä ei havaittu uutta saman haaran workflow-käynnistystä;
asetusta ei tämän perusteella nimetä syyksi eikä peruutuspolitiikkaa muuteta.
Avoin erottava näyttö on epäonnistuvan tuotetarkistuksen viimeinen sisäinen
vaihe sekä ulkoisesti katkaistun ajon komentoprosessin ja runnerin
peruutustila. Valmiin ajon debug-loki ei korvaa puuttuvan ajon näyttöä.
Normaalit budjetit, hyväksymisehdot ja prosessiomistajuus säilyvät.

Tuotetarkistuksen rajattu diagnoosivalmius erottaa nyt PowerShell-lukijan
sisäiset rajat payloadittomilla ETW-tapahtumilla. Tämä ei ole edellä kuvatun
CI-viiveen juurisyykorjaus tai uusi hyväksytty kokonaiskierros. Ulkoisen
tallennuksen, odotusanalyysin ja komentoketjun poistumisen synteettinen
koetodiste on varmennettu. Testin oma EventListener-kuittaus ei korvaa
ulkoista näyttöä, eikä synteettisen pysähdyksen syytä siirretä aidon
CI-epäonnistumisen selitykseksi. Seuraava avoin portti on rajattu vertailu
epäonnistuneessa ajopolussa. Tallennus-, siirto- ja oikeuspäätökset säilyvät
erillisinä. Uutta täyttä MSI-matriisia ei ajeta pelkän diagnoosilisäyksen vuoksi.

Nykyisen `packaged-boundary-diagnostic`-työnkulun valinnainen
`inspector_capture` koskee vain yhtä legacy-consumeria ja olemassa olevaa,
uudelleen varmennettua artifact-ID:tä. Se käyttää ajajan valmiita Windows-
tallennus- ja analyysityökaluja; puuttuvaa työkalua ei asenneta. Tallennus
alkaa ennen muuttumatonta komentoa, pysähtyy erillisessä rajatussa
`always()`-vaiheessa ja käsitellään vasta pakollisen tulosvarmennuksen jälkeen.
Raaka ETL, CSV, työkalutulosteet ja johdetut profiilit jäävät runnerin
väliaikaishakemistoon, eikä niitä siirretä workflow-artifactiin. Uutta
skenaarioajuria, prosessiomistajaa tai testin onnistumisehtoa ei lisätä.

Julkinen diagnoosi sisältää vain suljetut vaihe- ja tulosluokat. Prosessi-
tai säietunnisteet, pinot, polut ja raakavirheet eivät ylitä tätä rajaa.
Muistirengas ei takaa koko ajohistorian säilymistä: puuttuva vaihtotapahtuma
tai `scriptFinished` ei yksin todista odotusta tai prosessin poistumista.
Tallennuksen epäonnistuminen, callerin tulos ja asennuksen siivous säilyvät
erillisinä. Tämä kertaluonteinen vertailu ei muuta nykyistä epäonnistunutta
hyväksyntätilaa eikä käynnistä normaalia matriisia.

Rajatut diagnoosit käyttivät samaa artifact-ID:tä `10286568864`, eivät uutta
MSI-buildiä. Jokaisessa caller, pakollinen tulosvarmennus, artifactin
jälkivarmennus ja tallennuksen lopetus läpäisivät, mutta erillinen analyysi
epäonnistui. Nämä eivät ole hyväksyntäkierroksia tai alkuperäisen viiveen
juurisyykorjauksia. Tarkentuneen diagnoosin historia säilyy erillisenä:

| CI | Harness-revisio | Analyysin hylkäys |
| --- | --- | --- |
| [34694122623](https://github.com/eky-software/eky/actions/runs/34694122623) | `ada48aecdc8bd2afbd1a27c1593b211593455653` | `captureUnverified`, sisäinen raja puuttui |
| [34696778818](https://github.com/eky-software/eky/actions/runs/34696778818) | `046f65e27dd670245e84fb7b98eb4deb6c813982` | `eventRead / INSPECTOR_TRACE_EVENT_INVALID` |
| [34697391790](https://github.com/eky-software/eky/actions/runs/34697391790) | `32c1cf1ddcad47c863ef24c5e304dc71763480ab` | `eventRead / INSPECTOR_TRACE_EVENT_PROCESS_INVALID` |
| [34697909739](https://github.com/eky-software/eky/actions/runs/34697909739) | `4e6a0e00756b01f786c3fa3c85c260ff8c2bb5ce` | sama prosessikentän hylkäys |
| [34698564142](https://github.com/eky-software/eky/actions/runs/34698564142) | `ce06d07ee2b75cc40777326a58e1e926f01a96b9` | sama hylkäys; syntaksiluokka vain `text`, ei numeerista tunnistetta |

Lukija erottaa lähde-, nimi-, säie-, prosessi- ja aikakentän hylkäykset.
Tuntemattomasta prosessikentästä saa palauttaa vain rajatun luokkajonon,
ei alkuperäisiä merkkejä, nimeä tai tunnistetta. CPU-vienti sisältää vain
käytetyt sarakkeet. Kentän hylkäys säilyy: teksti ei yksin valtuuta
prosessin yhdistämistä säiehavaintoon. Lukijan ja workflow-kytkennän
kohdesopimukset läpäisevät; tallennuksen puutteellinen prosessisidonta
ja alkuperäinen legacy-viive ovat edelleen eri avoimia kysymyksiä.

Omistaja hyväksyi rajatun, peräkkäisen
tiedostotallennuksen saman tallentimen nykyisillä CPU- ja inspector-providereilla:
system- ja event-keräimelle enintään 1024 MB kummallekin ja inspectorille
16 MB, vähintään 6 GiB vapaata tilaa ennen aloitusta. Keräin pysähtyy
kokorajaan; sitä ei uusita eikä osittaista jälkeä merkitä täydelliseksi.
Nykyiset workflow-vaiheiden aikarajat, nimetty tallennus ja runner-only-
aineistoraja säilyvät. CPU-profiili johdetaan runnerin omasta WPR-exportista
XML-rakennetta käyttäen; tuntematon keräinrakenne tai periytyminen hylätään.
Providerit säilyvät ennallaan. Ennen lopetusta tarkistetaan nimetyn tallennuksen
kolme aktiivista keräintä ja nolla hävinnyttä tapahtumaa. Puuttuva keräin,
tapahtumahävikki tai tuntematon tila hylkää tallennuksen, mutta sen oma
lopetus yritetään silti. Tämä tilannekuva ei lupaa aukotonta tapahtumahistoriaa:
analyysin kattavuus on edelleen `boundedCaptureNotFullHistory`.
Lukijan, kokorajojen ja workflow-kytkennän kohdesopimukset läpäisevät
`13/13`. Rajattu FILE-diagnoosi
[34701559605](https://github.com/eky-software/eky/actions/runs/34701559605)
ajettiin ensimmäisellä yrityksellä harness-revisiolla
`f831a8e3ac480c887b2d683a4b7295a192893df2` ja samalla artifact-ID:llä
`10286568864`. Caller, pakollinen tulosvarmennus, artifactien ennen/jälkeen-
tarkistus sekä tallennuksen käynnistys ja lopetus läpäisivät. Keräinten
tilatarkistus läpäisi. Koko diagnoosi jäi epäonnistuneeksi: WPA-vienti
palautti `eventExport / INSPECTOR_CAPTURE_TOOL_FAILED` ennen tapahtumaluvun
alkua. Tämä ei osoita prosessitietojen säilymistä eikä selitä alkuperäistä
legacy-viivettä. Avoin erottava tieto on vientityökalun tarkempi virheluokka;
nykyinen suljettu loki ei sitä sisällä. Raaka-aineistoa ei siirretty runnerilta.
Muistirenkaan ylikirjoitus on mahdollinen selitys puuttuvalle historialle,
ei tällä näytöllä todistettu syy. Tallennusmallin vaihto ei ole testin
hyväksymisehdon väljennys. Ks.
[WPR logging mode](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/logging-mode)
ja [MaximumFileSize](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/maximumfilesize).

Analyysiketju varmennetaan erillään alkuperäisestä legacy-kokeesta. Nykyinen
työkalukutsuja odottaa käynnistämänsä työkalun prosessikahvasta poistumisen ja
lukee sen exit-koodin; aiempi shellin `LASTEXITCODE` ei ole työkalun tulos.
Työkalun stdout ja stderr ohjataan erillisiin yksityisiin tiedostoihin.
Epäonnistumisesta voidaan julkaista vain sallittu raja ja numeerinen
työkalun exit-koodi, ei tulosteen sisältöä. Nykyiset workflow-vaiheiden rajat
säilyvät, eikä uusi valvoja tai automaattinen fallback käynnisty.
CSV-lukija käsittelee sekuntiarvot ryhmittelemättöminä desimaaleina pisteellä
tai pilkulla, riippumatta lukijaprosessin kulttuurista. Sekoitettu tai
virheellinen luku hylätään; desimaalipilkkua ei poisteta tuhaterottimena.

Nykyisen työnkulun `inspector-analysis-diagnostic` käyttää kerran olemassa
olevaa `productInspectionNativeHold`-komentofixtureä ja samaa rajattua
tallennusta ilman MSI:tä, artifact-siirtoa tai täyttä hyväksyntämatriisia.
Testin caller-/cleanup-tulos, tallentimen lopetus ja analyysin tulos ovat
eri vaiheita. Analyysi vaatii tunnetun vaiheketjun, tarkan prosessi-/säiesidonnan
ja tarkoituksellisen odotuksen löytymisen. Tämä diagnoosi eikä onnistunut
vanhan ETL:n uudelleenanalyysi korvaa alkuperäisen legacy-odotuksen selitystä
tai avaa release-porttia. Vasta analyysiketjun todennuksen jälkeen jatketaan
ennalta rajattuun alkuperäisen polun kokeeseen.

Analyysidiagnoosi
[34703812875](https://github.com/eky-software/eky/actions/runs/34703812875)
revisiolla `d2cffc684f217c277c494543d49e327c9a280eb2` varmisti tallentimen
lopetuksen, viennin, lukijan ja tarkoituksellisen odotuksen. Koko koe jäi
silti epäonnistuneeksi: fixturen EventListener-kuittaus sisälsi vieraan
providerin tapahtuman. Kuittaus rajataan nyt myös vastaanotossa tarkkaan
inspector-provideriin. Vieras provider ei kelpaa edes samalla tapahtumanimellä.
Virheenjulkaisuvaiheen ei-nolla-exit on erillinen pakollisen caller-tuloksen
sisällöstä; epäonnistuneen komennon julkaisu saa itsessään palauttaa virheen.

Korjattu synteettinen diagnoosi
[34704430398](https://github.com/eky-software/eky/actions/runs/34704430398)
läpäisi ensimmäisellä yrityksellä revisiolla
`d35cfc04a4af55c2d76e1f77cde5445eaff5be70`: komentoregressio, pakollinen
caller-tulos, prosessisiivous, tallentimen lopetus ja tarkoituksellisen
odotuksen analyysi onnistuivat. Aiempi epäonnistuminen säilyy yllä erillisenä.

Sen jälkeen tehty yksi alkuperäisen polun diagnoosi
[34704669848](https://github.com/eky-software/eky/actions/runs/34704669848)
käytti samaa lähde-/checkout-revisiota ja artifact-ID:tä `10286568864`
(build-revisio `1a78b3137c15dc4b358affcf915ee30449041935`). Legacy-komento,
pakollinen caller-varmennus, prosessisiivous, asennuksen poisto, jälkiehdot,
fixture-poisto, artifactin ennen/jälkeen-varmennus ja tallentimen lopetus
läpäisivät. Koko diagnoosi silti epäonnistui erilliseen
`eventExport / INSPECTOR_CAPTURE_TOOL_FAILED` -tulokseen; vientiprosessin
exit-koodi oli `-2147008507`. Tapahtumien lukija ei käynnistynyt.
Tämä ei todista tapahtumien puuttumista, jäljen vioittumista tai
alkuperäisen legacy-viiveen syytä.

Ulkoinen tapahtumavienti ilman fixturen EventListeneria on nyt todennettu
rajatussa CI-ajossa
[34707057716](https://github.com/eky-software/eky/actions/runs/34707057716),
yritys 1, lähde- ja todellinen checkout-revisio
`92fc3fb92cc34ae6b6e1d6be13be933855ac8c39`.
Yksi oikea read-only-inspectorin komentotesti läpäisi: pakollinen caller-tulos,
komentoprosessin exit/close, prosessipuun poissaolo ja fixture-poisto
varmennettiin. Tallennuksen aloitus ja lopetus onnistuivat. Nykyinen ja
minimaalinen vientinäkymä tuottivat kumpikin 19 odotettua tapahtumaa;
minimaalinen näkymä varmisti provider-sidonnan ja koko read-only-vaiheketjun.
ETL:n SHA-256 säilyi samana. MSI-asennuksia tai uusia paketteja ei tehty.

Tätä seurannut yksi alkuperäisen legacy-polun diagnoosi
[34707834249](https://github.com/eky-software/eky/actions/runs/34707834249)
läpäisi ensimmäisellä yrityksellä. Lähde- ja checkout-revisio olivat
`9efdebb119433a046ad0ed8b4169698c0f66dacb`; sama artifact `10286568864`
säilytti yllä kirjatun build-identiteetin eikä MSI:tä rakennettu uudelleen.
`majorUpgrade`, pakollinen caller-varmennus, omistettujen prosessien
poistuminen, semanttiset jälkiehdot, asennussiivous ja fixture-poisto
läpäisivät. Artifactin ennen/jälkeen-varmennukset vastasivat toisiaan.
Tallennuksen lopetus sekä tapahtuma- ja ajoitusanalyysi onnistuivat;
kaikissa 14 kerätyssä tarkistinvirrassa havaittiin `scriptFinished`.
Analyysin rajattu kattavuus ei yksin todista prosessien poistumista:
siitä vastaavat edelleen komennon omistaja ja pakollinen tulosvarmennus.

Tämä sulkee ulkoisen keruun ja alkuperäisen polun analyysiketjun
toimivuuden todistusaukot, mutta ei selitä aiemman `eventExport`-virheen
tai satunnaisen legacy-odotuksen syytä. Aiemman epäonnistuneen viennin yksityinen
stdout/stderr ja ETL eivät ole enää saatavilla; uusi onnistuminen ei korvaa
niitä. Seuraava erottava havainto on epäonnistuvan viennin samassa ajossa
luettu suljettu virheluokitus tai alkuperäisen legacy-odotuksen paikantava
jälki. Pelkkä stderr-sisältö tai exit-numero ei riitä syyn nimeämiseen.
Diagnoosissa kumpikaan epäonnistuminen ei toistunut. Lopullisen revision
normaali kokonaishyväksyntä on edelleen erillinen portti.
Diagnostiikan vihreys ei avaa julkaisuporttia eikä oikeuta automaattiseen
uusintakierteeseen. Raakatulosteet pysyvät yksityisinä.

Tämän rajan hyväksytty `inspector-external-diagnostic` tekee yhden oikean
read-only-tuotekyselyn nykyisen .NET-komentorajan sisällä. Muut fixturevaiheet
ovat synteettisiä: MSI:tä ei rakenneta, asenneta eikä poisteta. Tarkistimeen
ei lisätä EventListeneria, eikä sisäinen havaintotiedosto kelpaa ulkoisen
keruun todisteeksi. Tallennuksen pysäytyksen jälkeen `compareEvents` vie saman
ETL:n nykyisellä ja yhdellä minimaalisella tapahtumanäkymällä. Molempien
tulokset raportoidaan erikseen; toinen ei ole ensimmäisen fallback tai
virheen kuittaus. ETL:n tavut varmennetaan ennen ja jälkeen vertailun.
Minimaalinen näkymä vaatii providerin nimen ja GUID-sidonnan sekä yhden
säikeen koko odotetun read-only-vaiheketjun `scriptFinished`-tapahtumaan asti.
Komennon poistuminen ja cleanup todistetaan edelleen nykyisellä omistajalla.

Vientityökalun yksityinen stdout/stderr luetaan rajatusti ennen runnerin
poistumista. Julkinen tulos sisältää vain suljetut viestihavaintojen luokat;
numerokoodi tai ei-fataali virheteksti ei yksin selitä viennin epäonnistumista.
Puuttuva, liian suuri tai lukukelvoton diagnostiikka ei peitä vientivirhettä.
Keräinmalli, aikarajat, prosessiomistajuus ja normaalit hyväksyntäehdot säilyvät.

### Valinnainen keruu normaalissa legacy-consumerissa

Nykyinen WPR-keruu on kytketty valinnaiseksi CI-havainnoinniksi
`inspector_capture`-valinnalla. Se ei korvaa normaaleja consumereita diagnostisilla
uusinnoilla. Valinta on oletuksena pois päältä; kahden consumerin ajossa vain
ensimmäinen saa tallennuksen ja toinen säilyy ilman raskasta keruuta.
Yhden consumerin riskiajossa keruuta ei aktivoida.

- Aloitus tapahtuu artifactin varmennuksen ja supervisor-buildin jälkeen,
  ennen muuttumatonta legacy-komentoa. Keruun virhe ei ohita testikomentoa.
- Pysäytys yrittää sulkea vain tämän ajon nimetyn tallennuksen myös testin tai
  aloituksen epäonnistuttua. Se ei sulje testiprosesseja tai poista asennuksia.
- Nykyiset rajat säilyvät: aloitus 1 min, pysäytys 2 min ja analyysi 3 min.
  Analyysin vaihe sisältää myös rajatun, sallituista kentistä muodostetun
  yhteenvedon. Testin 27 minuutin vaihe ja sisäiset määräajat eivät muutu.
- Keräinten nykyiset per-tiedosto-rajat ovat CPU-järjestelmäkeräimelle
  1024 MiB, CPU-tapahtumakeräimelle 1024 MiB ja inspectorille 16 MiB;
  esitarkistus vaatii vähintään 6 GiB vapaata tilaa. Rajan täyttyminen,
  puuttuva keräin tai tapahtumahävikki eivät tuota täyden keruun todistetta.
- Aloitus- ja pysäytysvaiheen alkuperäiset `outcome`-arvot sekä analyysin
  oma paluutulos säilytetään erillään testin ja artifactin jälkivarmennuksesta.
  Valinnaisen havainnoinnin virhe ei muuta onnistunutta testiä epäonnistuneeksi
  eikä epäonnistunutta onnistuneeksi. Tuntematon tallentimen lopputila
  merkitään varmentamattomaksi; siitä ei johdeta testin cleanup-tulosta.
- Raaka ETL, CSV ja yksityiset työkalutulosteet pysyvät runnerin tilapäisessä
  tallennusjuuressa. Niitä ei julkaista artifactina. Runnerin täydellinen
  katoaminen voi estää sekä lopetuksen että aineiston saamisen talteen.

Legacy-analyysin `-LegacyCommand`-valinta lukee nykyisen xperf-työkalun
prosessi-/säieviennin samasta ETL:stä. Komentorivit, prosessitunnisteet,
polut, tarkat ajat ja säieaineisto jäävät yksityiseen vientiin. Suljettu
yhteenveto kertoo vain tunnetun komentovaiheen, havaittujen poistumisten
tilan ja rajatun ajoitushavainnon. Lukurajat ovat 32 MiB / 100 000 riviä ja
CPU-projektion nykyinen enintään 64 säiettä. Ylitys ei johda hiljaiseen
otantaan tai laajempaan keruuseen. Read-only-inspectorin erillinen analyysi
ei vaadi legacy-komentoprosessia.
`commandLifetimeAnalysis` on riippumaton ajoitusviennistä: sen havaitut
poistumiset eivät todista luonnollista poistumissyytä tai Job-siivoamista.
`commandAnalysis` täydentää elinkaaret vain onnistuneella ajoitusluvulla;
taulukkorajan ylitys säilyy erillisenä analyysivirheenä.
Vientisuodatus käyttää WPA:n dokumentoitua tarkan arvon ja `AND`/`OR`-ehtojen
yhdistelmää: [WPA query syntax](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/wpa-query-syntax).
Raaka prosessitunniste kuuluu vain yksityiseen vientiprofiiliin, ei
CI-yhteenvetoon. Vienti ja lukija rajaavat tiedon erikseen; vientisuodatin
ei korvaa lukijan elinkaarisidontaa.

Omistajan hyväksymä erillinen kuuden minuutin havainnointivaraus nostaa vain
tallentavan jobin kokonaisrajan 43 minuuttiin. Tallentamaton jobi säilyy
37 minuutissa. Varausta ei oteta skenaarion
työstä, prosessisiivouksesta tai pakollisesta tulosvarmennuksesta.

Keruun kolme CI-vaihetta ovat valinnaisia (`continue-on-error`), mutta
legacy-komento ja artifactin jälkivarmennus eivät ole. V2-loppukoonti vaatii
edelleen molemmat valitut consumerit ja niiden pakolliset tulokset.
Analyysiyhteenveto julkaistaan ensin tilassa `unknown` ja vasta analyysin
palautumisen jälkeen sen todellisella tuloksella. Näin analyysin katkeaminen
ei jätä näkyviin väitettä onnistumisesta; vaihekatkaisu näkyy lisäksi CI:n
omana tuloksena. Analyysiä ja raportointia rajaa sama kolmen minuutin vaihe.
PR- ja ajastettu normaaliajo eivät kytke keruuta automaattisesti päälle.

CI-sopimukset läpäisevät 52/52; keruun workflow- ja budjettisopimusten
kohdesarja läpäisee 17/17. Normaali legacy-sopimussarja läpäisee 327/327
ja legacy-artifact-sarja 21/21. Projektin testikomento, tyyppitarkistukset
sekä backendin, webin ja desktopin buildit läpäisevät.
Käyttäytymistesti suorittaa workflow'n todellisen
analyysi- ja raportointikutsun synteettisillä riippuvuuksilla ja tarkistaa
komentoprosessin poistumisen. Analyysin paluuvirhe, poikkeus, epäonnistunut
pysäytys ja raportointivirhe eivät korvaa alkuperäisiä testin ja artifactin
tuloksia. Suljettu havaintoyhteenveto torjuu ylimääräiset kentät.
Kattavuuskoonti torjuu edelleen puuttuvan toisen consumerin sekä puuttuvat
tai epäonnistuneet pakolliset vaiheet. Kohdetestit eivät korvaa normaalia
kokonaishyväksyntää.

### Nykyinen komentoraja

Nykyinen työ siirtää legacy-, workspace-success- ja workspace-fault-komentojen
sisääntulon olemassa olevaan .NET Job -omistajaan. `AcceptanceCommandProgram`
ajaa suljetun vaihelistan; se ei tulkitse yritysdataa eikä vastaanota workerilta
uutta komentoa tai riippuvuusgraafia. Paketointi, julkaisun hyväksyntä ja
required-checkien vaihto eivät kuulu tähän siirtoon.

`legacyCommandPhase` ja `workspaceCommandPhase` käyttävät nykyisiä artifact-,
skenaario-, semantiikka- ja tuotekyselyvastuita. Yhteinen vaiheaineiston lukija
validoi sidonnat, toteutuneen järjestyksen ja edeltävät prosessitulokset.
Tallennettu tilannekuva ei ole cleanup-lupa: nykyinen skenaariokohtainen
päätösfunktio arvioidaan uudelleen ennen exact ProductCode -poistoa.
Tuoteidentiteetti varmennetaan muuttumattomasta artifactista jokaisella
operaatiorajalla. Epäonnistunutta poistoa ei seuraa uusi mutatoiva operaatio.

Komentojen tukemat pnpm- ja CI-sisääntulot valitsevat .NETin suoraan.
Siirretty kutsuketju ei käytä Node-käynnistyssäiettä, callerin named pipe
-palvelinta eikä sisäkkäistä product-supervisoria. Korvatut Node-sisääntulot
ja niiden rinnakkainen komentofixture on poistettu. Alempana oleva
invarianttikartta nimeää korvaavat testit. Muiden kuluttajien yhteinen tuki
ja sen testit säilyvät niiden omiin siirtovaiheisiin asti.

Jokainen vaihe vaatii erikseen worker-resultin, prosessin poistumisen,
Job-puun poissaolon sekä isännän luku- ja julkaisutoimintojen valmistumisen.
`cleanupUnverified` tai keskeneräinen isännän operaatio estää jatkon.
Pakollinen caller-result julkaistaan omassa valvotussa vaiheessa;
lokirivi ei korvaa sitä tai komentoprosessin todellista poistumista.
Alkuperäinen virhe, semanttinen siivous, lopputila ja fixture-poiston lupa
säilyvät erillisinä.

Vaiheketju käyttää yhtä nykyistä vapaaehtoisten havaintojen kirjoitinta.
Vaiheen lopussa ei odoteta diagnostisen jonon tyhjentymistä. Komennon
loppuminen ei odota estynyttä konsolia; pakollinen tulostiedosto ei kulje
tätä reittiä. Tulosteen estymisen regressio vaatii onnistuneen työn pysyvän
onnistuneena ja komentoprosessin poistuvan itse.

Siirron rajattu kokonaiskomentotodennus läpäisi 89/89, installer-unitit
165/165, Windowsin prosessisopimukset 77/77 ja CI-kytkennän sopimukset 47/47.
Lopullinen kanoninen legacy-sopimussarja läpäisi 302/302 ilman uusintoja,
ohituksia tai keskeytyneitä testejä. Jaetun valvojan clean- ja
upgrade-sopimukset läpäisivät 47/47 ja 142/142.
Jaetut workspace-success- ja fault-sopimukset sekä artifact-verifierit
läpäisivät; desktopin typecheck ja build onnistuivat. Nämä osin päällekkäiset
sarjat eivät muodosta yhtä yhteenlaskettua testimäärää. Synteettinen
komentotesti ei ole MSI-hyväksyntä tai näyttö tietyn CI-jumin natiivisyystä.
PR #266 pysyy draftina. Vanhan polun epäonnistunut hyväksyntä ja alempana
kirjattu CI-tulos eivät muutu vihreiksi uuden kytkennän perusteella.

### Komentofixturen varaus ja vastuukohtainen CI

Estyneen diagnostiikkatulostuksen fixture käytti aiemmin poikkeavaa
20 sekunnin kokonaisvarausta. Kaksi viiden sekunnin poistumisvarausta ja
neljän sekunnin julkaisuvaihe jättivät tavallisten vaiheiden käyttöön vain
kuusi sekuntia. Tulostuskohteen estyminen ei oikeuta muuttamaan komennon
työbudjettia. Poikkeava fixture-valinta on poistettu: jokainen komentotapaus
käyttää samaa nykyistä komentosuunnitelmaa, mutta tarkoitukselliset lyhyet
vaihekohtaiset timeout- ja cleanup-regressiot säilyvät ennallaan.

Budjettimatematiikan regressio kutsuu nykyisen `AcceptanceCommandProgram`-
luokan oikeasti käyttämää `CalculatePhaseTimeout`-funktiota hallituilla
kuluneen ajan arvoilla. Testissä ei ole laskentakaavan kopiota eikä oikeaa
odotusta: se tarkistaa normaalin vaiherajan, julkaisun ja kahden
poistumisvarauksen vaikutuksen sekä nolla- ja negatiivisen jäännösajan.
Vanhan 20 sekunnin varauksen kuuden sekunnin työvara erotetaan nykyisten
komentosuunnitelmien työvarasta. Kolmen oikean sisääntulon `blockedEvidence`
todistaa erikseen todella estyneen kirjoittimen, onnistuneen caller-tuloksen,
komentoprosessin exit/close-havainnot ja varmennetun fixture-siivoamisen.
Sen rinnalla aiemmin ollut neljän 1,5 sekunnin keinoviiveen tapaus on
korvattu laskentatestillä. Oikeat timeout-, myöhäisen valmistumisen ja
varmentamattoman siivouksen prosessitestit säilyvät. Testin ulompi
pakkokatkaisu ei kelpaa komennon omaksi loppuratkaisuksi.
Tämä erottaa fixture-budjetin virheen käyttöjärjestelmän ajoitusvaihtelusta,
mutta ei nimeä kaikkien aiempien CI-virheiden yhteistä natiivisyytä.
`productMissingResult` säilyttää pakollisen
caller-tuloksen vaatimuksen; aiemman CI-tuloksen puuttumisen syy on erillinen
avoin havainto. Työkalun latausvirhe ennen testejä ei ole assertion-tulos.

Komentoregressio välittää nykyisten vaiheiden suljetut process-, worker- ja
cleanup-luokitukset ennen yleisen assertion-virheen raportointia.
Puuttuva tai lukukelvoton tulos pysyy erillisenä; diagnostiikan epäonnistuminen
ei korvaa alkuperäistä testivirhettä. Raakavirheitä tai paikallisia tunnisteita
ei lisätä raporttiin.

Kanoninen `installer:test:windows-supervisor-v2-legacy` kääntää nykyisen
supervisorin kerran ja ajaa viisi ryhmää sarjallisesti: `core`, `commands`,
`legacy-entry`, `workspace-success-entry` ja `workspace-fault-entry`.
`commands` omistaa yhteiset prosessi- ja vaihejatkumisen sopimukset;
kolme sisääntuloryhmää käyttävät samaa testirekisteröintiä omalle oikealle
komennolleen. Uutta ajomoottoria tai fallbackia ei lisätä.

CI ajaa jokaisen ryhmän eristetyssä jobissa samoilla nykyisillä aikarajoilla.
Täysi portti vaatii kaikki kymmenen ryhmätulosta ennen legacy-produceria.
Kattavuustesti vaatii myös lukitun pakettityökalun valmistelun, buildin ja
testivaiheen. Tiedosto- ja tapausinventaario todistavat alkuperäisten testien
säilymisen ilman kaksoissuoritusta. Pakettityökalun lataus on erotettu
valmisteluvaiheeksi; versioita tai automaattista uusintaa ei muuteta.
Ryhmien jako on työmäärän jakoa, ei jumittuvan operaation lisäaika.
Uusi hyväksyntä edellyttää lisäksi legacy-producerin ja molempien
consumerien todellista valmistumista puhtaalta revisiolta.

Korjatun checkpointin kanoninen sopimussarja läpäisi 309/309:
`core` 227/227, yhteiset komennot 24/24 ja kolme sisääntuloryhmää
18/18, 20/20 ja 20/20. Kaikki valmistuivat ilman ohituksia tai uusintoja.
Jaetut workspace-success- ja fault-sopimukset läpäisivät 289/289 ja 279/279;
legacy- ja workspace-artifact-sopimukset 16/16 ja 58/58 sekä CI-sopimukset
48/48. Osin päällekkäisiä sarjoja ei summata. Tämä on regressioiden näyttö,
ei vielä uuden revision packaged- tai CI-hyväksyntä.

### Komentoryhmien CI ja erillinen inspector-havainto

Edellinen varmennettu kierros on lähde-HEAD
`226ad2d0c4e0b5870bed143f05860a0f5cf1346d`,
[CI 34640956869](https://github.com/eky-software/eky/actions/runs/34640956869),
checkout/build-revisio `d5b08e9ebc4b3422e1838ca82363681adcb18dd6`.
Kaikki kymmenen komentoryhmää läpäisivät ensimmäisellä yrityksellä:
core 228/228 ja yhteiset komennot 24/24 sekä sisääntuloryhmät 18/18,
20/20 ja 20/20 kummassakin toistossa. Legacy-producer ja molemmat
legacy-consumerit valmistuivat; myös clean- ja upgrade-consumerit läpäisivät
2/2. Tämä ei vielä täytä kokonaisporttia: workspace-producer epäonnistui
ennen artifactin julkaisemista ja sen consumerit jäivät ajamatta.
V2 acceptance hylkäsi kierroksen oikein. Uusintaa ei ajettu.

Workspace-producerin yleinen virhekoodi ei erottanut alkuperäistä
paketointivirhettä. Nykyisen rakentajan virheraja välittää tämän vuoksi vain
ennalta luetellut projektivirheet, inventory-hylkäykset ja alustavirhekoodit.
Tuntematon virhe jää luokittelemattomaksi; alkuperäinen build-virhe ja
mahdollinen jälkisiivouksen virhe säilyvät erillisinä. Tulostuksen
epäonnistuminen ei muuta epäonnistunutta exit-tulosta. Tämä tarkennus ei
muuta paketointia, inventory-rajoja, hyväksyntäehtoja eikä aikarajoja.
Rakennusvirheen syy on vielä avoin, eikä sitä luokitella lataus- tai
infrastruktuurihäiriöksi pelkän viimeisen lokirivin perusteella.

Edellisen kierroksen historiallinen näyttö:

Lähde-HEAD `0e0af6c0e39c675a1f614d39f6b3b974ad2c05ac` käynnisti
[CI-ajon 34635578251](https://github.com/eky-software/eky/actions/runs/34635578251).
Todellinen checkout ja workspace-artifactin build-revisio ovat
`6a31f8bf4b156e5c5bded0a68064a6460d98d88b`. Kaikki kolme varsinaista
komentoryhmää sekä yhteinen komentoryhmä läpäisivät molemmat toistot
ensimmäisellä yrityksellä. Myös aiemmat `blockedEvidence`- ja
`productMissingResult`-tapaukset läpäisivät. Kokonaisportti ei silti täyty:
core-ryhmän toinen toisto päätyi tulokseen 226 hyväksyttyä ja yksi
keskeytynyt testi. Legacy-producer ja molemmat consumerit jäivät ajamatta.

Kierros päättyi hylättynä ilman uusintaa. Electron critical läpäisi 38/38,
clean-, upgrade/rollback- ja workspace-success-consumerit kukin 2/2 sekä
workspace-fault-matriisi 10/10. Pakolliset caller-verifierit ja artifactien
ennen/jälkeen-varmennukset valmistuivat. Clean- ja upgrade-lopputulokset
vahvistivat datan säilymisen, prosessien poissaolon ja fixture-poiston.
Core-testin varmentamatonta siivousta ei muuteta onnistumiseksi muiden
jobien tuloksilla. PR #266 pysyy draftina; V2:n kokonaisportti ei täyty.

Keskeytynyt `inspectWindowsInstallerProductState.test.mjs` ajaa neljä
PowerShell-tarkistusta yhteisen 20 sekunnin testirajan sisällä. Nykyinen
CI-aineisto ei erota, mikä neljästä tarkistuksesta jäi kesken tai tapahtuiko
viive käynnistyksessä, COM-kyselyssä vai poistumisessa. Testin vanha
loppusiivous pyysi lopetusta odottamatta prosessin poistumista ja poisti
testijuuren myös epäonnistumisen jälkeen. Tätä ei lasketa varmennetuksi
siivoukseksi eikä viivettä nimetä infrastruktuuriviaksi.

Rajattu jatkokorjaus käyttää nykyistä `cleanupRunContext`-vastuuta samoille
omistetuille prosessikahvoille. Testijuuri säilyy epäonnistumisessa tai
varmentamattomassa siivouksessa, ja neljän tarkistuksen turvalliset
vaiheluokitukset raportoidaan erikseen siivoustuloksesta. Peruutus estää
seuraavan kyselyn käynnistämisen myös myöhäisen valmistumisen jälkeen.
Uutta valvojaa tai aikarajaa ei lisätä. Siivoustuen ja myöhäisen valmistumisen
regressiot eivät korvaa inspectorin koko aikarajan hyväksyntää. Vaihetulos
erottaa käynnistyskutsun keston, spawn-havainnon ja sulkeutumisen sekä
siivoustuloksen. Hyväksyntä on edelleen kesken: onnistunut yksittäinen
vertailu ei kumoa keskeytynyttä sarjaa eikä osoita natiiviviiveen syytä.
Ennen mahdollista budjettipäätöstä tarvitaan nämä vaihtoehdot erottava näyttö.
Erillistä uutta CI-diagnoosivalintaa tai uusintaa ei otettu käyttöön.

Seuraavan revision `41e5293a5d6bd54f918b2fab5b65b655f950c2d5`
[CI 34643084341](https://github.com/eky-software/eky/actions/runs/34643084341)
toisti inspectorin 20 sekunnin hylkäyksen. Turvallinen vaihehavainto osoitti
ensimmäisen kyselyn käynnistyskutsun valmistuneen 3 millisekunnissa;
spawn havaittiin, mutta kysely ei valmistunut ennen testin peruutusta.
Omistettu siivous varmennettiin. Havainto rajaa viiveen käynnistyskutsun
jälkeiseen työhön, mutta ei yksin erota PowerShell-valmistelua, COM-kyselyä
ja viimeistelyä. Tätä ei nimetä natiivikäynnistyksen tai infrastruktuurin
juurisyyksi.

Omistaja hyväksyi neljän olemassa olevan inspector-tapauksen erottamisen
itsenäisiksi testeiksi. Kunkin raja johdetaan nykyisestä
`INSPECTOR_TIMEOUT_MILLISECONDS`-sopimuksesta (30 sekuntia), jota varsinainen
product-operation käyttää. V2:n komentovaihe varaa samalle työlle 30 sekuntia
ja erikseen 5 sekuntia siivoukseen. Testituen nykyinen prosessikahvojen
siivous säilyy ennallaan. Neljä erillistä kyselyä eivät enää jaa lyhyempää
20 sekunnin yhteisrajaa; jokaisella on oma eristetty aineisto ja jälkiehto.
Kyselyn valmistuminen, ei odotusajan kuluminen, ratkaisee onnistumisen.
MSI-, job-, supervisor- ja tarkoituksellisten timeout-regressioiden rajoja
ei muuteta. Myös uuden kyselyrajan ylitys on edelleen virhe, ei peruste
automaattiselle lisäajalle tai uusinnalle. Tämä korjaa testin erillisen
aikavaatimuksen ristiriidan, ei vielä selitä alustan viivettä.

Rajattu viiden testin sarja ja koko 231 testin core-sopimusryhmä läpäisivät
muutoksen jälkeen; myös desktopin typecheck ja build läpäisivät.
Revision `41e5293` CI jäi silti hylätyksi: muut valitut ryhmät, clean 2/2,
upgrade 2/2, workspace success 2/2 ja fault/rollback 10/10 läpäisivät,
mutta core-ryhmän keskeytyminen esti legacy-producerin ja sen consumerit.
Hyväksytty testijako tarvitsee oman puhtaan revision CI-näytön, mukaan
lukien todella käynnistyvä legacy-producer ja molemmat consumerit.

### Budjettilaskennan ja prosessitodisteen erottaminen

Revision `68e1e77b365e135cab18234b2373bce2243afafa`
[CI 34645826140](https://github.com/eky-software/eky/actions/runs/34645826140)
valmistui hylättynä. Checkout ja artifact-build olivat
`e72df924e10d821243c3abcb50b45b562d866ae8`. Molemmat core-ryhmät läpäisivät
231/231, mutta toisen workspace-success-sisääntuloryhmän keinoviivetesti
hylättiin vaiheessa `inspectSourceBefore`: deadline ylittyi, prosessipuun
poissaolo varmennettiin ja komento poistui virheellä. Tulostuksen estyminen
todistettiin ennen exit-assertiota. Epäonnistuminen ei ollut jobin ulkoinen
katkaisu; legacy-producer ja consumerit jäivät sen vuoksi ajamatta.
Clean, upgrade ja workspace success läpäisivät 2/2 sekä fault/rollback 10/10.

Erillinen Electron `ARCHIVE-PDF-RECOVERY-001` epäonnistui ensimmäisessä
yrityksessä Playwright-yhteyden jälkeen `firstWindow`-aikakatkaisuun.
Säilytetty ensimmäisen yrityksen näyttö vahvisti runtimen siivouksen,
portin vapautumisen ja testijuuren poiston. Retry läpäisi, mutta portti jäi
37 passed / 1 flaky -tuloksella hylätyksi. Syy on avoin eikä tätä nimetä
budjettilaskennan virheen seuraukseksi.

Mittausrajat säilyvät:

- komentokello alkaa komentorajassa ja rajaa koko kiinteän vaiheketjun
- vaiheen kello alkaa ennen request-valmistelua; sen aika sisältyy
  työ-/cleanup-rajaan, ja valmistelulla on nykyinen oma rajattu odotus
- prosessinluonti, työn odotus ja worker-tuloksen luku käyttävät vaiheen
  työosuutta; cleanup-varaus kuuluu saman vaiheen kokonaisrajaan
- supervisor-resultin julkaisu käyttää enintään nykyisen viiden sekunnin
  poistumisvarauksen, ei uutta työn lisäaikaa
- caller-resultin julkaisu on oma nykyinen valvottu vaihe, jolle sekä
  komennon poistumiselle jätetään tilaa ennen tavallisen vaiheen aloitusta
- synteettisen komentofixturen 4 sekunnin vaiheesta 1 sekunti on siivousta;
  oikean komennon työbudjetteja ei korvata näillä testiluvuilla
- ulompi testiturva ja CI-jobi eivät ole valmistumissignaaleja: niiden
  katkaisu on hylkäys eikä korvaa prosessin omaa loppu- ja cleanup-tulosta.

Viiverytmiä tai aikarajoja ei muuteta tämän laskennan erotuksen mukana.
Edellisen CI:n supervisor-build kesti ryhmissä 14-17 sekuntia, sopimusvaiheet
67-135 sekuntia ja kokonaiset jobit 148-232 sekuntia. Ryhmän nykyinen
10 minuutin ulkoraja ei katkaissut sisäistä virheenkäsittelyä. Tarkoitukselliset
timeout-tapaukset säilyvät erillisinä 90 sekunnin testiturvan sisällä;
mitatut kestot eivät ole lupaus käyttöjärjestelmän enimmäisviiveestä tai
syy kasvattaa sisäisiä rajoja automaattisesti.

Korjauksen kohdetodennus läpäisi koko kanonisen sarjan 313/313, artifact- ja
workflow-testit 16/16, CI-politiikan testit 48/48 sekä desktopin typecheckin
ja buildin. Erillinen arkistotestien todennus läpäisi 3/3 ja samalla
valmistellulla buildillä Electron critical 38/38 ilman uusintoja. Aiempi
Electron-häiriö ei toistunut; sen syytä ei silti katsota osoitetuksi.
Uusi laskentatesti korvaa yhden sisääntulotapauksen; muita
invariantteja tai toistoja ei poisteta. Tämä ei vielä hyväksy uutta revisiota:
tarvitaan yksi tuore commit-pohjainen kokonaiskierros sekä siinä todella
käynnistyvä legacy-producer ja molemmat consumerit.

### Jaetun sopimussarjan edellinen CI

Lähde-HEAD `447dd169835a38b136b8abd2f0caf31d58b950c4` käynnisti
[CI-ajon 34627151146](https://github.com/eky-software/eky/actions/runs/34627151146).
Todellinen checkout ja consumerien varmentama artifact-build on
`d2ef02bcc110e0fab00ea8c1e9ad0d0b1b4fe45c`. Ensimmäinen yritys päättyi
hylättynä; uusintaa ei ajettu. Molemmat core-sopimusryhmät läpäisivät 227/227.
Electron critical läpäisi 38/38 ilman flaky-tulosta, installer-unitit 165/165
ja Windows-prosessisopimukset 77/77. Clean-, upgrade/rollback- ja workspace-
success-consumerit läpäisivät kukin 2/2 sekä workspace-fault-matriisi 10/10.
Artifactien ennen/jälkeen-varmennukset ja pakolliset consumer-verifierit
säilyivät suoritettuina hyväksyntäehtoina.

Ensimmäisen commands-ryhmän Corepack-lataus katkesi `ECONNRESET`-virheeseen
ennen supervisorin käännöstä ja testejä. Toisessa oli kolme testivirhettä:
workspace-success- ja workspace-fault-`blockedEvidence` palauttivat
odottamattoman exit 1:n; workspace-success-`productMissingResult` ei saanut
pakollista caller-tulosta. Näiden komentoprosessien exit ja close havaittiin,
mutta sisäisen vaiheen virhetulos ei välittynyt testin assertion raporttiin.
Syytä ei nimetä ilman tätä erottavaa näyttöä.

GitHub katkaisi jälkimmäisen jobin sen 10 minuutin rajaan testien yhä
valmistuessa: 64 hyväksyttyä, 3 epäonnistunutta ja 1 keskeytynyt testi.
Viimeinen valmistunut tapaus oli `phaseContinuationRequestInvalid`;
seuraavan `phaseContinuationBlockedEvidence`-tapauksen loppu ja omistettu
siivous jäivät varmentamatta. GitHubin oma orphan-cleanup ei korvaa tätä
näyttöä. Legacy-producer ja packaged-consumerit eivät käynnistyneet.

Tämän revision kahden ryhmän jako ei sopinut havaittuun kokonaiskuormaan
eikä selitä kolmea varsinaista hylkäystä. Yllä kuvattu fixture-korjaus ja
viiden vastuun ryhmittely tarvitsevat oman hyväksyntänsä; ne eivät muuta
tätä ajoa onnistuneeksi. PR #266 pysyy draftina; koko V2:n hyväksyntä,
käyttöönotto ja pilot-julkaisu ovat edelleen kesken.

### Komentosiirron aiempi CI ja rajattu fixture-korjaus

Lähde-HEAD `681c577c806e132e958f821f07632c59a14535af` käynnisti
[CI-ajon 34620003920](https://github.com/eky-software/eky/actions/runs/34620003920).
Consumerien varmentama artifact-build on
`e2ffb3af4f8c65a6909e929b44ea97faa204c8c4`, ei lähde-HEAD.
Workspace-success-consumerit läpäisivät 2/2 ja fault-matriisi 10/10
pakollisen caller-verifierin ja ennen/jälkeen-tavuvarmennuksen kanssa.
Molemmat clean-consumerit läpäisivät. Koko CI-kierros ja vakaa
`V2 acceptance` päättyivät hylättyinä. Legacy-sopimusten ensimmäinen sarja
epäonnistui (290/302); toisen GitHub katkaisi jobin 10 minuutin rajaan
(227 hyväksyttyä, 20 epäonnistunutta, 4 keskeytynyttä). Testejä valmistui
katkaisuun asti, joten tämä ei ole näyttö yhteen MSI-kutsuun juuttumisesta.
Historiallisia paketteja ja consumereita ei ajettu. Electron-portti hylättiin
ja upgrade-consumereista vain toinen läpäisi.

Legacy-sopimusten fixture välitti tilapäishakemiston aliaksen kanonista
juurta vaativalle product-workerille. Fixture luodaan nyt kanonisesta
tilapäisjuuresta, kuten nykyiset varsinaiset callerit. Worker ei hyväksy
aliasta, symlinkkiä tai väärää identiteettiä tämän korjauksen vuoksi.
Käyttäytymisregressio käyttää testin omaa hakemistoaliasta. Lisäksi nykyinen
kolmen komennon fixture todistaa esitarkistukseen pysähtyneen vaiheen
määräajan, todellisen exit/close-rajan, alkuperäisen virheen toimituksen,
prosessisiivouksen sekä seuraavan mutaation ja fixture-poiston estämisen.
Korjattu kanoninen legacy-sopimussarja läpäisi 306/306 ilman uusintoja,
ohituksia tai keskeytyksiä. Tämä on fixture-korjauksen regressiotulos,
ei vielä uusi paketoitu tai CI-hyväksyntä. Installer-unitit läpäisivät 165/165,
Windowsin prosessisopimukset kahdesti 77/77 sekä desktopin typecheck ja build.

Aliaskorjaus ei selitä toisen CI-sarjan kahta fixed-command-epäonnistumista
eikä GUI-fixturen käännöksen määräaikaa. Käännöksen virhe säilyi virheenä ja
sen Job-siivoaminen valmistui; sama valmisteluvirhe esti kuusi GUI-testiä.
Tämän aiemman checkpointin CI-jako erotti sarjan kahteen vastuuseen:
`core` omistaa supervisorin, artifactin, skenaarion ja virherajojen
sopimukset; `commands` omistaa product-operaation ja kolmen varsinaisen
komennon koko prosessielinkaaren. Kaikki alkuperäiset 29 testitiedostoa
säilyvät täsmälleen kerran. Uutta ajomoottoria ei lisätä eikä testien tai
jobien aikarajoja kasvateta.

Checkpointin kanoninen paikallinen komento oli
`pnpm --filter @eky/desktop installer:test:windows-supervisor-v2-legacy`:
se käänsi supervisorin kerran ja ajoi molemmat ryhmät sarjallisesti.
CI käänsi supervisorin kerran kussakin eristetyssä ryhmäjobissa. Molemmat
ryhmät ajettiin riskisuunnitelman jokaisella valitsemalla toistolla; täysi
portti vaati neljä ryhmätulosta ennen produceria. Nykyinen viiden ryhmän
jako on kuvattu yllä; `fail-fast: false` säilyttää edelleen muiden ryhmien
näytön epäonnistumisen jälkeen.

Kattavuusregressio hylkää puuttuvan, ohitetun, peruutetun tai epäonnistuneen
ryhmän sekä puuttuvan build- tai testivaiheen. Tiedostoinventaarion testi
estää jaossa syntyvän testikadon tai kaksoissuorituksen. Jaettu kanoninen
sarja läpäisi 227/227 ja 79/79, CI-kytkennän sopimukset 48/48 sekä legacy-
ja workspace-artifactien workflow-sopimukset 15/15. Näitä osin päällekkäisiä
sarjoja ei summata. Tämä on testikytkennän regressiotulos, ei uusi Windows-
consumer-hyväksyntä. Yksittäisten aiempien virheiden syy ja regressiot on
suljettava erikseen; jako ei itsessään selitä käynnistysviivettä.

Electronin rajattu kolmen käyttäjäpolun toisto läpäisi 9/9 samalla
valmistellulla buildillä, ja koko critical-sarja läpäisi 38/38 ilman retryä.
Aiempi `firstWindow`-virhe ei toistunut tässä todennuksessa; sille ei ole
osoitettu juurisyytä eikä Electronin aikarajoja tai lähdekoodia muutettu.

[Erillinen diagnostiikka 34620133500](https://github.com/eky-software/eky/actions/runs/34620133500)
käytti aiempia varmennettuja artifact-tavuja. Se hylättiin
`inspectSourceBefore`-vaiheen määräaikaan ennen asennusta; Job-siivoaminen
ja komentoprosessin päättyminen valmistuivat. Natiivin viiveen syytä ei ole
osoitettu. Se ei ole uusi hyväksyntä eikä normaali 2/2-tulos muuta tätä
diagnostiikkaa onnistuneeksi. Electronin ensimmäisen yrityksen turvallinen
aineisto erottaa onnistuneen yhteyden, `firstWindow`-timeoutin ja onnistuneen
runtime-/porttisiivouksen. Upgrade-virheen `cleanupUnverified` säilyy
hylkäyksenä ja aineisto säilytetään. Näitä erillisiä havaintoja ei nimetä
yhdeksi infrastruktuuriviaksi eikä aikarajoja muuteta.

### Viimeisin etähyväksyntä ennen komentosiirtoa

[Normaali CI 34520903697](https://github.com/eky-software/eky/actions/runs/34520903697)
epäonnistui ensimmäisellä yrityksellä. Lähde-HEAD on
`3c884033a4e6b13cdf588c58fffd4209809f00b7`; todellinen checkout ja artifact-build
ovat `cffb6e0458bc4397208755cc5131cdbf844d845e`. Clean- ja upgrade-consumerit
läpäisivät 2/2 sekä molemmat workspace-fault-consumerit. Workspace-success
run 2 läpäisi, mutta run 1 katkesi GitHubin vahvistamaan 30 minuutin job-rajaan.
Callerin terminal-tulos, product-prosessien poissaolo, asennussiivous ja
fixture-poisto jäivät tässä consumerissa varmentamatta.

Viimeinen saatavilla oleva havainto on `productSupervisorWait started`
targetin poistossa; molemmat tuotekyselyt ja poistokutsun `productChannelSetup`
valmistuivat. Kanavan avaaminen ei siis selitä tätä havaittua pysähtymisrajaa.
Havainto ei todista natiivin MSI-prosessin syntymistä tai viimeistä suoritettua
operaatiota. Nykyinen adapteri laskee määräajan ennen käynnistysfunktiota,
mutta aktivoi ajastimen vasta funktion palattua. Avoin erottava näyttö koskee
käynnistysfunktion paluuta, todellista spawnia ja määräajan käsittelyä; pelkkä
optional-lokin puuttuminen ei ratkaise niiden keskinäistä järjestystä.
Uutta täyttä matriisia ei käynnistetä saman puuttuvan terminal-sopimuksen yli.

Molemmat legacy-sopimussarjat hylättiin erillisestä vanhentuneesta
vaihelista-assertiosta (254/255), joten legacy-producer ja packaged-consumerit
eivät käynnistyneet. Korjaus `0e20e47decea119478fb6b92eeca199b9cfa3106`
tarkistaa nykyisen kahdeksan havainnon järjestyksen muuttamatta alkuperäisen
`deadlineExceeded`-virheen tai `cleanupUnverified`-tuloksen vaatimuksia.
Korjauksen kohdetesti ja 255/255-sarja läpäisivät; korjaus ei vielä sisälly
yllä olevaan CI-revisioon eikä selitä workspace-poiston pysähtymistä.
PR #266 pysyy draftina. Ei mergeä, käyttöönottoa tai pilot-julkaisua.

### Aiemmat rajatut korjaukset ja niiden näyttö

Running-upgrade-korjauksen rajaus on hyväksytty: native-MSI-client välittää
nykyiselle workerille rajatun InstallValidate-signaalin, eikä lokivahtia jätetä
varareitiksi. Ensimmäisen MSI-operaation paluukoodi säilyy omana tuloksenaan
mahdollisen sallitun 1603-jatkon rinnalla. Prosessiomistajuus, aikarajat,
tuotantosovellus ja jaettava payload eivät muutu. Tämä uusi koodirevisio vaatii
vielä oman paketoidun hyväksynnän; alla oleva vihreä CI on aiempi checkpoint.
Rajattu toteutus läpäisi upgrade-sopimussarjan 141/141, artifact-sopimukset
14/14 sekä desktopin typecheckin ja buildin. Native-record-, kanava- ja
koordinaatiotestit todistavat tapahtuman, virhepolut ja todellisen prosessin
poistumisen ilman MSI-asennusta; tämä ei korvaa paketoitua hyväksyntää.
Paketoitu hyväksyntäyritys jäi epäonnistuneeksi asennustilan
jälkitarkastuksessa. Alkuperäinen MSI-tulos ja varmennettu siivous eivät muuta
tätä hyväksytyksi. Erillinen tiedostotilapoikkeama on edelleen avoin;
diagnostiikkaa ei lasketa hyväksyntätoistoksi. Rajattu toteutus voidaan viedä
draft-katselmukseen ja commit-pohjaiseen CI-todennukseen, mutta koko V2:n
hyväksyntä-, käyttöönotto- ja julkaisuportit säilyvät ennallaan.

[CI-ajon 34499523220](https://github.com/eky-software/eky/actions/runs/34499523220)
running-upgrade-consumerit läpäisivät 2/2 ensimmäisellä yrityksellä. Lähde on
`3fc28875b20f2ac3fc63f46563151ee3b781f019` ja todellinen checkout sekä artifactin
build-revisio `c5017ac760c76d25d96daa2a32d75b6b3e63c810`. Molemmat varmensivat
alkuperäisen MSI-tuloksen 0, datan säilymisen, prosessi- ja asennussiivouksen
sekä samat artifact-tavut ennen ja jälkeen ajon. Tämä ei sulje erillistä avointa
tiedostotilapoikkeamaa eikä koko V2:n hyväksyntää.

Saman ajon clean-consumerit hylättiin esitarkistuksessa. Clean-caller johtaa nyt
työjuuren kanonisesta tilapäishakemistosta ennen fixtureä ja tuotekyselyä,
samoin kuin upgrade-caller. Tuotekyselyn kanonisuus- ja linkkirajoja ei muuteta.
Aliaksen kautta tehty oikea read-only-tuotekysely toisti vanhan hylkäyksen;
korjattu kytkentä saavuttaa worker-rajan käynnistämättä testissä MSI:tä.
Puuttuva tilapäisjuuri hylätään ennen fixturetyötä. Kohdesarja 43/43,
kanoninen clean-sarja 47/47, artifact-sarja 13/13 sekä typecheck/build ovat
vihreitä. Korjatun clean-callerin paikallinen packaged-todennus on 2/2;
sen CI-portti on vielä avoinna. Tämä ei muuta saman CI-ajon legacy run 1:n
ja workspace success run 2:n ulkoisia aikakatkaisuja hyväksytyiksi.

PR #266:n V2.8-checkpointin normaali commit-pohjainen
[CI-ajo 34462106934](https://github.com/eky-software/eky/actions/runs/34462106934)
valmistui ensimmäisellä yrityksellä vihreäksi. Lähde-HEAD on
`1d22a0d4d4a202ce76cecb1ec06192ed9a20d604`; CI:n todellinen checkout ja
artifactien build-revisio ovat `65cdccde9c1eae4944add7503646c8b7c907c4e2`.
Kaikki 28 valittua jobia läpäisivät ja vakaa koonti palautti `ciAccepted`.
Kuusi V2-kutsutilan ohittamaa vanhaa MSI/W6-jobia eivät ole hyväksyttyjä ajoja.

CI todisti installer-unitit 165/165, Windows process contracts 77/77,
legacy-sopimukset 239/239 kummallakin runnerilla ja Electron criticalin
38 onnistunutta testiä ilman flaky-tulosta. Clean-, upgrade-, legacy- ja
workspace-success-consumerit läpäisivät kukin 2/2; fault-matriisi läpäisi
10/10. Kymmenen consumerin ennen/jälkeen-varmennukset vastasivat omien
producerien artifact-identiteettejä. Pakolliset tulosverifierit hyväksyivät
prosessipoistumisen, erilliset siivous- ja semanttiset jälkiehdot sekä
session-proofit soveltuvissa skenaarioissa. Vaiheloki ei korvannut
pakollista tulostodistetta.

Apuoperaatioiden valmistumis- ja aineiston säilytyskorjaus on tällä
revisiolla todennettu nykyisissä kuluttajissa. Aiempi valmistelun viive ei
toistunut; sen natiivisyytä ei ole osoitettu eikä budjetteja muutettu.
V2.8:n vaihecheckpointin jälkeen avoinna ovat edellä nimetyt vanhan MSI-portin
kattavuusaukot ja release-kytkentä, lopullisen integraation hyväksyntä,
required-check-siirto ja korvatun orkestroinnin poisto. PR pysyy draftina.
Koko V2 ja käyttäjän 0.2.8-pilotti eivät ole vielä valmiita.

Tämä dokumentaation päivitys ei ole uusi koodirevision hyväksyntä eikä
syy toistaa muuttumatonta raskasta matriisia. Alla olevat aiemmat hylkäykset
ja diagnoosit säilyvät historiallisina havaintoina, eivät nykyisen CI-ajon
tilana. Niitä ei muuteta jälkikäteen hyväksytyiksi.

### Aiempi hylkäys ja erillinen diagnoosi

Aiemman CI-ajon lähde-HEAD `25cbe183ab08bc0846f1347b18e83f6a87d283e5` ja CI:n checkout
`2850f6b73a093e5cea944b15f8cb2373010bf706` ovat eri revisiot.
[Ajo 34416786931](https://github.com/eky-software/eky/actions/runs/34416786931)
päättyi epäonnistuneena ensimmäisellä yrityksellä. Clean- ja
upgrade-consumerit läpäisivät kumpikin 2/2, samoin supervisorin sopimusajot.
Electron critical ja Windows installer -sopimukset ovat vihreät.
Workspace-haara pysähtyi ennen produceria: kirjoittimen command-fixturen
synteettisestä caller-tuloksesta puuttui pakollinen `productProcessAbsent`.
Fixture on korjattu nykyiseen strict-sopimukseen; alkuperäiset poistumis-,
kanavavirhe- ja pakollisen tuloksen regressiot säilyvät. Korjaus on
kohdetesteillä hyväksytty ja myöhemmin yllä yksilöidyssä normaalissa CI-ajossa.

Legacy-sopimussarjoista vain toinen läpäisi. Toisessa ikkunafixturen
käännösvalmistelu ylitti tuolloin käytetyn 10 sekunnin kokonaisrajan jo yhteisessä
valmistelussa; varsinaisia ikkunatapauksia ei päästy ajamaan. Tämä ei ole
30 sekunnin GUI-havainnointirajan eikä MSI-upgraden hylkäys. Valmistelun
sisäinen pysähtymisraja jäi paikantamatta. Onnistunut toinen runner
ei korvaa epäonnistunutta sarjaa. Aikarajoja ei ole muutettu, eikä uutta
packaged-kierrosta käytetä tämän puuttuvan havainnon korvikkeena.

Ikkunafixturen valmistelu raportoi nyt nykyisen supervisorin validoidusta
tuloksesta erikseen process-, worker- ja cleanup-tuloksen, prosessipuun
poissaolon sekä suljetut vaihehavainnot ennen onnistumisassertioita.
Raportointi tapahtuu valmistumisen jälkeen eikä ohjaa suoritusta tai lisää
uutta odotusta. Tuolloisesta 10 sekunnin kokonaisrajasta 1 sekunti kuului
siivoukselle; työn määräaika oli 9 sekuntia. Valmistelun timeout-
regressio vaatii virheen säilymisen, omistetun puun poistumisen ja koko
komennon päättymisen. Epävarmaa siivousta ei hyväksytä onnistumiseksi.
Tämä tarkennus ei vielä ratkaise CI:ssä havaittua valmisteluviivettä eikä
muuta epäonnistuneen hyväksyntäajon tulosta. Omistajan hyväksymä rajattu
CI-diagnoosi käyttää nykyisen `windows-acceptance-supervisor-feasibility.yml`-
workflow'n `legacy-contracts-diagnostic`-tilaa. Se säilyttää kanonisen pnpm-
sopimussarjan, testijärjestyksen ja budjetit, mutta ei rakenna MSI-artifacteja
eikä käynnistä consumereita. Erillinen diagnostiikkahaara sitoo tarkan
revision ilman PR-matriisin käynnistystä tai required checkien ohitusta.
Diagnostiikan tulos ei ole packaged- tai release-hyväksyntä.

[Diagnostiikka 34460670404](https://github.com/eky-software/eky/actions/runs/34460670404)
läpäisi 239/239 sopimustestiä kummallakin runnerilla ensimmäisellä yrityksellä.
Sekä lähde-HEAD että kummankin jobin todellinen checkout olivat
`e2373e56dd9ccb6b70820ab1941c501d93a4bfd3`. Valmistelu ilmoitti molemmissa
`processCompleted`, `workerResultValidated` ja `processTreeAbsent: true`;
valmistelun prosessit poistuivat normaalisti ilman pakotettua cleanupia.
MSI-artifacteja ei rakennettu eikä consumereita ajettu. Aiempi viive ei toistunut, mutta
sen syy ei tällä näytöllä ratkea. Supervisoria ja budjetteja ei muuteta tämän
diagnoosin perusteella. PR:n puhtaan revision varsinainen hyväksyntämatriisi
valmistui erikseen yllä yksilöidyssä normaalissa CI-ajossa; diagnostiikka ei
korvannut sitä.

### Apuoperaatioiden yhteinen sopimus ja tulostoimituksen varaus

Skenaariopuun Job-tulos ei yksin todista sitä ennen tai sen jälkeen
käynnistettyjen apuprosessien poistumista. Korjattu
`installerProductOperationRuntime` säilyttää tämän tiedon erikseen
`productProcessAbsent`-kentässä. Epävarma poistuminen estää seuraavan
kyselyn ja uninstallin sekä tulostiedoston poistamisen. Havaittu
jatkopäätösvirhe on korjattu, mutta se ei osoita, mihin alustakutsuun
katkaistut CI-ajot jäivät. Korjauksen packaged- ja CI-näyttö on yllä kohdassa
**Nykyinen päätös**; koko V2:n käyttöönottoraja säilyy erillisenä.

| Nykyinen kuluttaja | Yhteisen sopimuksen käyttö |
| --- | --- |
| Clean | Käyttää samaa teknistä product-operaatiota mutta säilyttää oman ProductState-tulkintansa. Root-poisto vaatii varmennetun lopputilan; alkuperäinen virhe, safety-tulos ja fixture-poisto raportoidaan erikseen. |
| Upgrade/rollback | Sama tekninen product-operaatio ja erillinen source/target-tulkinta. Root-poisto vaatii apuprosessin poissaolon sekä käynnistetyn skenaarion Job- ja asennussiivouksen todisteet. |
| Legacy | Tiedostoryhmien ja product-apuprosessien epävarmuus säilyvät erillisinä. Myös ennen supervisoria tapahtuva epävarmuus säilyttää testijuuren. |
| Workspace success ja fault | Yksi yhteinen caller. `supervisorAttempted=false` ei yksin valtuuta root-poistoa. Strict caller-result vaatii apuprosessin poissaolon ennen onnistumista tai fixture-poiston hyväksymistä. |

Korjaus käyttää nykyisiä teknisiä omistajia: apuprosessin poistumistieto
säilyy erillisenä alkuperäisestä operaatiovirheestä ja cleanup-tuloksesta.
Varmasti poistuneen prosessin tavallinen virhe ei estä erikseen sallittua
riippumatonta siivousta. Epävarman prosessin tulostiedostoa tai testijuurta
ei poisteta eikä epävarmuutta nollata myöhemmällä yleisellä prosessikyselyllä.
Puhtaat päätöstestit eivät yksin todista koko komentoprosessin poistumista;
niiden rinnalla nykyinen legacy-command-fixture todentaa apuprosessin
deadlinen, todelliset `exit`/`close`-havainnot, pakollisen caller-resultin ja
koko komentoprosessin poistumisen. Erikseen injektoitu epävarma adapteritulos
todentaa aineiston säilytyksen; sitä ei tulkita aidoksi natiivin cleanupin
epäonnistumiseksi.

Omistaja on hyväksynyt product-operaation direct-child-omistajan korvaamisen
nykyisellä Job Object -supervisorilla. Rajattu checkpoint käyttää samaa
`WindowsJobProcessSupervisor`-luokkaa; siihen ei lisätä rinnakkaista
emergency-cleanup-omistajaa. Preflight-operaatio valmistuu ennen skenaariota.
Skenaarion jälkeinen product-operaatio sallitaan vasta sen Jobin varmennetun
poistumisen jälkeen. Viisi nykyistä calleria säilyttävät omat product-state-
ja siivouspäätöksensä.

`installerProductOperationWorker` ryhmittelee juuren tarkistuksen, oman
väliaikaishakemiston luonnin, nykyisen PowerShell-kyselyn tai exact-uninstallin,
tuloksen tiedostoluvun ja oman väliaikaistuloksen poiston samaan Jobiin.
Kutsuja ei tee näitä tiedosto-operaatioita. Puhdas strict-JSON- ja product-state-
validointi säilyvät nykyisissä validoijissa. Työn ja prosessisiivouksen tulokset
eivät korvaa toisiaan; myöhempi tulosvirhe ei peitä jo validoitua prosessivirhettä.

Product-operaation rajattu yksityinen muistikanava välittää worker-tuloksen
ja nykyisen supervisor-result-skeeman. Konsoli ei ole kontrollikanava.
Kutsuja kuittaa rajatun kokonaisen viestin vastaanoton, ei testin onnistumista.
Vasta supervisorin todellinen `exit`/`close`, strict tulos ja Job-poissaolo
valtuuttavat jatkamisen. EOF:n rajatonta odotusta, synkronista varatulostusta,
uutta tiedostolukijaprosessia tai uutta yleistä ajuria ei lisätä.
Puuttuva tulos tai epävarma poistuminen säilyttää testijuuren.

Korvauksen kohdesarja kattaa
myös todellisen komentoprosessin valmistumisen, pysähtyvän valmistelun,
kyselyn jälkeläisen, tulosluvun ja tulospoiston sekä alkuperäisen virheen
säilymisen siivousvirheen rinnalla. Erillinen regressio osoitti toimitusrajan:
koko cleanup-varauksen kuluminen jätti pakollisen supervisor-tuloksen ilman
toimitusaikaa. Korjattu testi vaatii alkuperäisen deadline-virheen ja
`cleanupUnverified`-tuloksen toimituksen sekä komentoprosessin poistumisen.
Epävarmuus säilyy epäonnistumisena. Tätä havaintoa ei nimetä aiempien
CI-katkaisujen syyksi.

Omistajan hyväksymä jako varaa nykyisestä viiden sekunnin loppuvarauksesta
neljä sekuntia Job-cleanupiin ja yhden sekunnin tulostoimitukseen. Normaalit
työrajat (kysely 30 s, uninstall 120 s) ja kokonaisvaraukset (35 s / 125 s)
säilyvät. Sama exhaustion-regressio on korjauksen jälkeen hyväksytty.
Keinotekoinen exhaustion-testi ei väitä todentavansa aitoa natiivin cleanupin
epäonnistumista. Tulostoimitus ei saa muuttaa epävarmaa siivousta onnistuneeksi.

Supervisorin oman bootstrapin alustariippuvainen viive pysyy erillisenä
V2-rajana: Jobin aikaraja alkaa supervisorissa eikä voi valvoa sen omaa
syntymistä. Promise-aikakatkaisu ei todista natiivin operaation peruuntumista.
Ulkoista katkaisua ei hyväksytä terminal-todisteeksi eikä sen peittämiseksi
lisätä uutta watchdogia.

### Korvatun MSI-kutsuketjun odotuskartta

Seuraava kartta kuvaa korvauspäätöksen lähtötilannetta. Nykyiset komennot
ja poistettujen vastuiden vastineet ovat kohdassa **Product-komentorajan
korvauspäätös**; vanhoja kutsunimiä ei käytetä nykyisenä ajo-ohjeena.

| Raja | Käynnistäjä ja nykyinen omistaja | Määräajan alku ja valmistumisen todiste |
| --- | --- | --- |
| Legacy `majorUpgrade` | `legacyUpgradeWindowsRuntime` käynnistää `msiexec`-prosessin; skenaarion nykyinen Job omistaa workerin ja sen jälkeläiset. | Supervisorin alussa käynnistetty kello: 570 s työlle ja 30 s siivoukselle. MSI:n `close` ja todellinen exit code edeltävät worker-resultia. `majorUpgrade started` ei ole spawn-kuittaus. |
| Legacy-komennon jatko | `startLegacyUpgradeSupervisor` odottaa supervisorin `exit`/`close`-tapahtumia ja käynnistyssäikeen poistumista; caller lukee strict supervisor-resultin ja erillisen scenario-resultin. | Caller rajaa supervisorin nykyisellä bounded-adapterilla. Tulos tai lokirivi ei yksin valtuuta jatkamista; pakotettu poistuminen ei todista worker-puun lopputilaa. |
| Workspace `installationCleanup`: esitarkistus | `cleanupExactProducts` kysyy source- ja target-ProductCoden ennen poistopäätöstä. Yhteinen product-operaatio käyttää nykyistä Job-supervisoria sarjallisesti. | Kummankin kyselyn Job-varaus on 30 s + 5 s. Caller lisää alla kuvatun host-varauksen. Rajattu vastaus, vastaanottokuittaus, prosessin poistuminen ja strict tulos ovat eri asioita. |
| Workspace `installationCleanup`: poisto | Sama vastuu poistaa vain esitarkistuksessa todetun targetin ja sitten sourcen. | Kumpikin uninstall varaa 120 s + 5 s. Epävarma apuprosessi estää seuraavan kyselyn, poiston ja fixture-poiston. Ryhmän aloitushavainto ei todista uninstallin aloitusta. |
| Valmistelu ja viimeistely | Nykyiset filesystem- ja caller-result-adapterit käsittelevät omat tiedostoryhmänsä. Callerissa on lisäksi suoria juuren tarkistuksia, hakemistoluonteja ja supervisor-pyynnön kirjoitus. | Adapterien varaukset eivät automaattisesti kata callerin suoria alustakutsuja tai niiden omaa käynnistystä. Tulosjulkaisu ja fixture-poisto vaativat erilliset onnistumistodisteet. |

Legacy-varaus on konfiguraation mukaan 1600 s ja lifecycle-step 1620 s:
20 s erotus ei ole todiste koko kutsun rajatusta kestosta. Workspace-varaus
on alla 1420 s ja lifecycle-step 1500 s. Molempien ulkopuolelle voi jäädä
suora alustakutsu tai supervisorin poistumisen odotus. Näitä summia ei saa
esittää todistettuna komentotason deadlinena.

Legacy-prosessikutsun `error` ei enää tarkoita poistumista: virhe säilyy,
mutta valmistuminen odottaa `close`-havaintoa. Sama erottelu koskee
legacy-supervisorin käynnistyskutsua. Diagnostiikan virhe ei muuta tulosta.
Contract-fixture kattaa puuttuvan worker-tuloksen, avoimen tuloskanavan ja
ennen workerin poistumista toimitetun tuloksen. Pakollinen caller-result ja
koko komentoprosessin poistuminen tarkistetaan erikseen. Muuttuneen vastuun
ja jaettujen virhepolkujen sekä budjettisopimusten kohdesarja on 161/161;
desktopin typecheck ja build läpäisivät. Tämä ei ole paketoitu
hyväksyntä eikä sulje seuraavaa komentotason puutetta.

Omistaja hyväksyi callerille rajatun vastuun sen käynnistämän supervisorin
eliniästä. Nykyinen Job-supervisor pysyy worker-puun ainoana omistajana.
Checkpointin korjaus käyttää nykyistä bounded-adapteria ja callerin
taustasäiettä natiivikäynnistykseen: säie säilyttää täsmällisen prosessikahvan.
Anonyymin stdin-putken kertaluonteinen lupa edeltää supervisorin dispatchia;
peruutettu tai myöhässä syntynyt prosessi ei saa aloittaa työtä. EOF, väärä
lupa tai viiden sekunnin lupapuute torjutaan ennen Jobin käynnistämistä.
Tämä sisäinen testikytkentä ei ole sovelluksen turvallisuus- tai HTTP-portti.

Caller varaa supervisorin nykyisen kokonaisrajan lisäksi viisi sekuntia
käynnistyksen ja poistumisen toimitusmarginaaliin sekä tarvittaessa viisi
sekuntia täsmällisen host-kahvan keskeytyksen varmentamiseen. Jobin työ- ja
cleanup-rajat eivät kasva. Ensimmäinen pakotettu host-poistuminen katkaisee
mutatoivan ketjun: aiempi tulos ei yksin todista worker-puun lopullista
poissaoloa. Varmentamaton poistuminen säilyttää aineiston ja virheen, eikä
myöhempi yleinen prosessikysely muuta sitä onnistumiseksi. Taustasäiettä ei
tapeta kesken natiivikäynnistyksen; sen myöhäinen kahva jää peruutetuksi ja
työlupa evätään. Caller voi päättyä vain epäonnistuneena, jos säikeen tai
supervisorin poistumista ei saada varmennetuksi.

Kanoninen legacy-kohdesarja on 255/255; erillinen jaettujen
success/fault-rajojen sarja 184/184. Regressio todistaa nyt koko callerin
virhepoistumisen myös tuloksen toimittaneen mutta eloon jäävän supervisorin
tapauksessa. Myöhäinen käynnistys ei saa työlupaa, ja varmentamaton lopputila
säilyttää aineiston. Käynnistyssäikeen poikkeus ei tuota tekaistua
close-kuittausta. CI-ajon todellista pysähtynyttä alustakutsua ei ole vielä
osoitettu; tämä ei ole sen ympäristötekijän tai MSI:n juurisyyväite.
Harness-revision `dc3c2b7ff9c7ecfa98612a5dff25dfc32a02f740`
legacy-diagnostiikka [34516392234](https://github.com/eky-software/eky/actions/runs/34516392234)
läpäisi callerin, pakollisen tulosverifierin ja artifactin jälkivarmennuksen.
Workspace-diagnostiikka [34516395551](https://github.com/eky-software/eky/actions/runs/34516395551)
peruutettiin; käytettävissä oleva viimeinen vaihe on `targetProductUninstall`
`started`, molempien esitarkistusten valmistuttua. Callerin terminal-tulos,
siivous ja artifactin jälkivarmennus jäivät varmentamatta. Peruutusta ei
luokitella infrastruktuuriviaksi eikä aiempaa vihreää näyttöä siirretä tälle
ajolle. Molemmat käyttivät artifact-buildia `c5017ac760c76d25d96daa2a32d75b6b3e63c810`;
diagnostiikka ei korvaa uuden revision normaalia hyväksyntää.

Poistokutsun tuloskanavan avaaminen ja sulkeminen ovat nykyisen host-odotuksen
ulkopuolella. Tämä kattavuusaukko ei yksin osoita peruutetun ajon jumittunutta
kutsua. Nykyinen vapaaehtoinen havaintokanava erottaa nyt `productChannelSetup`,
`productSupervisorWait`, `productSupervisorExit`, `productSupervisorClose` ja
`productChannelCleanup`-rajat. Uutta ajastinta, siivousomistajaa tai tulosehtoa
ei lisätä. Käyttäytymissarja 47/47 ja jaetut caller-regressiot 156/156 sekä
desktopin typecheck/build läpäisivät.

Host-odotuksen sisällä `productHostLaunch` erottaa käynnistysfunktion kutsun
ja palautumisen, `productHostSpawn` todellisen spawn-tapahtuman ja
`productHostDeadline` nykyisen ajastimen asettamisen sekä sen laukeamisen.
`productHostTermination` kertoo vain täsmälliselle host-kahvalle lähetetyn
pysäytyspyynnön käsittelyn, ei prosessin poissaoloa. Exit/close, strict tulos
ja Job-puun siivous pysyvät erillisinä vaatimuksina. Havaintojen toimitusvirhe
ei muuta tulosta; puuttuva kuittaus ei yksin osoita jumittunutta kutsua.
Nämä havainnot eivät muuta aikarajoja tai omistajuutta eivätkä yksin korjaa
vielä paikantamatonta CI-jumia.

### Product-komentorajan korvauspäätös

Korvatun Node-callerin `server.listen` ja `server.close` jäivät
host-adapterin määräajan ulkopuolelle. Käynnistyssäikeen `unref` ei ollut
säikeen poistumiskuittaus: palautumaton natiivikutsu saattoi estää koko
Node-komennon poistumisen. Vanhan `productLaunchNativeWait`-kokeen ulompi
pakkokatkaisu jäi epäonnistuneeksi hyväksynnäksi. Tämä havainto perusteli
omistajan hyväksymän korvauksen, ei uutta sisäkkäistä valvojaa.

`AcceptanceCommandProgram` on nyt kolmen varsinaisen komennon sisääntulo:
`--legacy-command`, `--workspace-success-command` ja
`--workspace-fault-command`. Kiinteät vaiheet tulevat isännän omasta
`supervisorCommandBudgets.json`-resurssista. Node-vaihe ei saa valita
seuraavaa komentoa, uutta executablea tai toista ajosuunnitelmaa.
Skenaario ja jokainen apuvaihe käyttävät nykyistä `SupervisorProgram.RunPhase`
-rajaa. Valmistelu, prosessinluonti, worker, tulosluku ja tuloksen julkaisu
kuuluvat sen rajattuun elinkaareen. Isännän keskeneräinen tulos-I/O estää
jatkon silloinkin, kun lapsen Job on jo tyhjä.

Skenaariokohtainen Node-vastuu käyttää edelleen nykyisiä business-,
artifact- ja jälkiehtoverifiereitä. Tuotetarkistus ja poisto suorittavat
nykyisen `executeProductOperation`-operaation saman omistetun vaiheen
sisällä, ilman named pipe -palvelinta tai sisäkkäistä supervisoria.
`acceptanceCommandPhaseInput` lukee vain sidottua vaiheaineistoa;
`acceptanceProductFacts` tulkitsee tuotehavaintoja. Kumpikaan ei käynnistä
prosesseja eikä myönnä poistolupaa. Skenaarion nykyinen päätösfunktio
arvioidaan uudelleen varmennetuista havainnoista ennen mutaatiota.

Siirretyltä polulta poistettiin `runLegacyUpgrade.mjs`,
`runWorkspaceSuccess.mjs`, `runWorkspaceFault.mjs`,
`legacyCommandCompletionFixture.mjs` ja käyttämätön
`startSupervisorInvocation`. Niitä ei jätetä fallbackiksi.
Jaettu `spawnSupervisorProcess`/product-kanava säilyy vielä muiden
siirtämättömien clean/upgrade-kuluttajien tukena; sitä ei väitetä koko
repositoriosta poistetuksi. Sen sopimustestejä ei poisteta tämän mukana.

Korvaavien invarianttien kartta:

| Korvattu tarkistus | Nykyinen vastine |
| --- | --- |
| Node-callerin Promise ja exit/close | `legacyCommandCompletion.process.test`: yhteinen vaihejatkumo; `legacyCommandEntrypoint`, `workspaceSuccessCommandEntrypoint` ja `workspaceFaultCommandEntrypoint`: kaikki kolme todellista komentosuunnitelmaa, ulkopuolelta havaittu komento-exit ja close |
| Käynnistyssäikeen permit/cancel/unref ja avoin product-kanava | Nykyisen .NET-fixturen Preparation/NativeWait/Read/Remove, myöhäisen luonnin ja result-I/O:n kokeet; siirretyllä polulla ei enää ole kyseistä säiettä tai kanavaa |
| Skenaario jumittuu tai tulosteen vastaanottaja ei lue | Kiinteän komennon scenarioHold/blockedEvidence; onnistuminen ei odota diagnostista flushia |
| Tulos ennen prosessin poistumista | resultBeforeExit/publicationBeforeExit; validi caller-tiedosto ei korvaa komennon onnistunutta poistumista |
| Puuttuva supervisor-/worker-tulos tai cleanupUnverified | Vaihejatkon PublicationFailed/CleanupUnverified/RequestInvalid, productMissingResult ja sidotun vaiheaineiston lukutestit; jatko ja fixture-poisto estyvät |
| Ennestään asennettu tuote tai väärä skenaario | legacy/workspace admission -testit ja preconditionFailed koko komentorajalla; skenaariota tai uninstallia ei käynnistetä |
| Alkuperäinen virhe ja epäonnistunut cleanup | scenarioAndCleanupFailed ja nykyiset failure-boundary-testit; ensimmäinen virhe säilyy, seuraava poisto ei ala |
| Puuttuva skenaariotulos, business- tai session-hylkäys | scenarioMissing/businessFailed/sessionFailed oikeassa vaiheketjussa sekä nykyiset semanttiset verifier-testit |
| Muuttunut profiili/artifact, jäljellä oleva footprint tai estynyt fixture-poisto | profileChanged/artifactChanged/footprintFailed/removalHold; epävarma aineisto säilytetään |

Normaalisti valmistunut vaihe on erillinen prosessitulos, ei koko komennon
hyväksyntä. Pakollinen caller-result syntyy omassa valvotussa
julkaisuvaiheessa, ja nykyinen erillinen verifier vaatii myös todellisen
komennon exit-koodin. Diagnostiikan toimituksen menetys ei muuta tulosta.
Jos julkaisun jälkeinen prosessi jää eloon, komento epäonnistuu myös silloin,
kun caller-tiedosto sisältää onnistumisen.

Runtime-fixturen poisto vaatii nykyiset semanttiset ja prosessijälkiehdot.
Komentorajalle syntyvät yksityiset vaihepyynnöt ja tulostiedostot säilyvät
erillisessä paikallisessa väliaikaisjuuressa; `fixtureRemoved` tarkoittaa
runtime-fixturen poistoa, ei kaikkien diagnostiikkatiedostojen hävittämistä.
Niitä ei lisätä Gitiin tai CI-artifactiin. Epävarma lopputila ei valtuuta
uuteen mutaatioon tai tutkimusaineiston poistamiseen.

### Aiempi product-kanavan diagnostiikka

Revision `a24533e90c1e300e32ee35ba9dea1d9a732de539`
[workspace-diagnostiikka 34520110820](https://github.com/eky-software/eky/actions/runs/34520110820)
läpäisi koko callerin ja pakollisen lopputulosverifierin. Poiston kanavan
avaaminen, supervisorin exit/close ja kanavan sulkeminen valmistuivat tässä
järjestyksessä; artifact `10161685548` varmistettiin muuttumattomaksi ennen
ja jälkeen ajon. Käytetyn buildin revisio oli edelleen `c5017ac760c76d25d96daa2a32d75b6b3e63c810`.
Aiempi jumi ei toistunut tässä diagnostiikassa; pelkkä vaihehavaintojen lisäys
ei ole sen juurisyykorjaus. Peruutetun ajon näyttö säilyy epäonnistuneena ja
varmentamattomana. Tämän jälkeisen normaalin PR-kierroksen epäonnistuminen on
kirjattu nykytilaan; diagnostiikka ei korvaa lopullista hyväksyntää.

Nykyisen feasibility-workflow'n `packaged-boundary-diagnostic` on erikseen
käynnistettävä diagnostiikka, ei required-check-hyväksyntä. Se ajaa vain
valitun legacy- tai workspace-callerin ja pakollisen tulosverifierin,
varmentaa aiemman artifactin ennen ja jälkeen ajon eikä rakenna MSI:tä.
Producer-run, artifact-ID, descriptor-SHA ja artifactin build-revisio sidotaan
syötteeseen; harnessin checkout-revisio raportoidaan erikseen. Rooli on
suljettu kahteen olemassa olevaan consumeriin. Job- ja lifecycle-rajat eivät
kasva. Saman repositoryn aiemman artifactin lataus käyttää vain
`actions: read` -oikeutta; sama read-katto annetaan workflow'n kutsujalle,
jotta tavallinen workflow-call ei yritä korottaa oikeuksia. Kirjoitusoikeutta,
uutta salaisuutta, ulkopuolista repositorya tai automaattista uusintaa ei lisätä.

### Infrastruktuuriuusinnan rajattu ehdotus

Automaattista uusintaa ei kytketä käyttöön tässä checkpointissa. Mahdollinen
myöhemmin hyväksyttävä politiikka sallisi enintään yhden kohdennetun ajon
uudella runnerilla vain GitHubin erikseen osoittamasta infrastruktuuriviasta.
Pelkät aikakatkaisu, puuttuva loki, connection loss -epäily tai paikallinen
onnistuminen eivät riitä luokitteluun. Assertion, puuttuva pakollinen tulos,
epävarma cleanup tai tuntematon MSI-lopputila eivät kuulu uusintaehtoon.

Uusinta sitoisi saman todellisen checkout-revision, artifact-ID:t,
descriptor-tiivisteet ja build-revision; uudet tavut ovat uusi hyväksyntä.
Ensimmäinen epäonnistuminen, annotation ja uusinnan syy säilyvät raportissa.
Diagnostinen uusinta ei korvaa ensimmäisen yrityksen hyväksynnän ehtoa.
Mahdollinen vaikutus required-check-koontiin päätetään erikseen näkyvästi;
vihreä uusintakuvake ei yksin valtuuta mergeä tai julkaisua.

Korvatun workspace-ketjun prosessivarauksien summa oli 1420 sekuntia,
mutta se ei rajannut kaikkea tiedostotyötä. Nykyinen kiinteä komentosuunnitelma
käyttää 1440 sekunnin kokonaisvarausta olemassa olevan 1500 sekunnin
lifecycle-stepin sisällä. Se kattaa myös vaihevalmistelun, tiedostotyön,
semanttisen siivouksen ja tuloksen julkaisun. Julkaisulle sekä isännän
poistumiselle jätetään varaus ennen edeltävän vaiheen käynnistystä;
yksittäisen vaiheen enimmäisaikaa lyhennetään jäljellä olevaan budjettiin.
Erillinen mandatory-result-verifier saa nykyiset 30 + 5 sekuntia:
`1440 + 35 < 1500`. Rajan loppuminen ei muutu cleanup-onnistumiseksi.

Legacy-lifecycle säilyttää 1600 sekunnin varauksensa: komento saa 1565
sekuntia ja erillinen mandatory-result-verifier nykyiset 30 + 5 sekuntia.
`1565 + 35 = 1600 < 1620`; verifieriä ei lasketa kahdesti tai jätetä
lifecycle-stepin ulkopuolelle. Skenaarioiden
600/30 ja 720/30 sekunnin kokonais-/cleanup-rajat säilyvät. Kaikkien vaiheiden
enimmäisaikoja ei voi kuluttaa peräkkäin kokonaisrajan yli. Supervisor ja
proof-readerit rakennetaan erillisessä valmisteluvaiheessa, eivät tässä
komentobudjetissa; consumer ei rakenna MSI:tä. CI:n step- tai job-aikarajoja
ei nosteta. Valmisteluvaiheen onnistuminen kuuluu edelleen loppukoontiin.

Normaali onnistuminen palautuu tapahtumasta tai valmiista tilasta, ei
kiinteän odotuksen täyttymisestä. V2:n Job-supervisor tarkistaa erikseen
prosessikahvan poistumissignaalin, Jobin aktiivisten prosessien määrän ja
strict worker-resultin. Lyhyt rajattu tilakysely täydentää alustatapahtumia;
se ei ole onnistumisen kelloehto tai yksittäisten säikeiden ajastusmoottori.
Koko komennon varauksille ja valmistelulle
lasketaan erillinen CI-marginaali; normaalia budjettia ei muuteta ennen tätä
perustetta ja omistajan päätöstä. Tarkoituksella lyhyet timeout-, myöhäisen
käynnistyksen ja epävarman cleanupin regressiot säilyvät erillisinä.
Korjaus ei tarvitse omaa ajoituspalvelua, uutta supervisoria tai yleistä
riippuvuusgraafia.

Poistettu päällekkäisyys on clean/upgrade-product-adapterien yhteinen tekninen
kyselyvastuu ja callerien ehdoton root-poisto. Skenaarioiden semanttiset verifierit säilyvät
erillisinä. Vanhan W6-ketjun poistoehto säilyy yllä olevassa invarianttien
siirtokartassa; `observerFailure`-testin odotusarvoa ei vaihdeta vain vihreyden
vuoksi. Hyväksytty rajattu korjaus jätetään nykyisen W6-omistajuuslukijan
vastuulle: todistetusti nykyistä vanhempaansa vanhempi vieras prosessi ei
ole tämän lapsi, eikä siitä tai sen jälkeläisistä muodosteta siivouksen
omistajuutta. Aiempi testikohtainen snapshot-suodatin ja reader-override
poistetaan. Uutta kirjanpitoa, odotusta tai prosessivalvojaa ei lisätä.
Syntymätunnisteet validoidaan ennen vertailua; tuntematon tunniste,
ristiriitainen ehdokas, muuttunut executable-identiteetti tai ristiriita jo
omistetun prosessin kanssa säilyy virheenä. Regressio vertaa oikean lukijan
omistamia ja siivoukseen valittavia identiteettejä sekä todentaa alkuperäisen
observer-virheen todellisessa prosessiketjussa. Korjauksen kohderegressiot,
installer-unitit, koko Windows process-contract -sarja, V2-legacy-sopimukset,
jaettujen callerien regressiot, CI-kytkentätestit sekä desktopin typecheck ja
build on hyväksytty. Aiemmat epäonnistuneet sarjat säilyvät epäonnistuneina.
Tämän checkpointin packaged- ja CI-hyväksyntä toteutuivat yllä yksilöidyllä
puhtaalla revisiolla ja siihen sidotuilla artifacteilla.

### Tuotetarkistuksen diagnoosiraja

`inspectSourceBefore` kuuluu nykyisen komentoisännän 35 sekunnin
vaiherajaan, josta 5 sekuntia on siivousvarausta. Rajan alku ei ole
PowerShellin tai COM-kutsun alku. Sama Job omistaa koko seuraavan ketjun:

| Vastuu | Valmistuminen ja havainto |
| --- | --- |
| `legacyCommandPhase.runProduct` | Artifactin uudelleenvarmennus ennen tuoteoperaatiota; vaihehavainto ei vielä todista PowerShellin käynnistystä. |
| `executeProductOperation` | Juuren tarkistus ja oman hakemiston luonti ennen lapsiprosessia. |
| `runInstallerProductCommand` | Nykyinen spawn ja `close`; lapsen stdio on `ignore`. `scriptStarted` erottaa skriptin aloituksen sitä edeltävästä ketjusta, jos tallennuksen eheys on varmistettu. |
| PowerShell-lukija | `comCreation`, `productState`, tuotetiedot, tiedosto-, rekisteri- ja prosessitarkistukset erotetaan alkamis- ja valmistumistapahtumilla. |
| Lukijan tulos ja lopetus | Serialisointi, kirjoitus, atominen julkaisu ja COM-vapautus erotetaan. `scriptFinished` ei todista prosessin poistumista. |
| Node-workerin viimeistely | Prosessin `close`, strict tulosluku, väliaikaisen tuloksen poisto ja worker-result säilyvät nykyisinä vastuina. |
| .NET-komentoisäntä | Worker-result, root-exit, Job-puun poissaolo ja caller-result ovat erillisiä pakollisia todisteita. |

Vain testiharnessin lukija tuottaa nimetyn
`Eky-InstallerProductInspection-V1`-EventSourcen tapahtumat. Versio on
providerin nimessä; tapahtumanimet ovat kiinteitä eikä niillä ole payloadia.
Niihin ei liitetä ProductCodea, polkua, tulossisältöä tai raakavirhettä.
Nykyinen Windowsin ETW-tallennus voi vastaanottaa tapahtumat ilman uutta
prosessia, konsoli-/tiedostokirjoitinta, vastaanottokuittausta tai fallbackia.
Tapahtumatuottajan poikkeus ei korvaa tarkistuksen virhettä tai muuta tulosta.
Tallennus ei ole päällä automaattisesti eikä tapahtuma valtuuta jatkamaan testiä.

Kytkentäregressiot todentavat normaalin tapahtumajärjestyksen, payloadin
puuttumisen, alkuperäisen kyselyvirheen ja epäonnistuvan testikuuntelijan
vaikutuksettomuuden. Olemassa oleva komentofixture pysäyttää lisäksi todellisen
tuoteworkerin COM-luontiriippuvuuden: viimeinen vaihehavainto säilyy, nykyinen
deadline poistaa omistetun puun, pakollinen caller-result jää epäonnistuneeksi
ja komentoprosessin `exit` sekä `close` havaitaan. Asennusta ei aloiteta eikä
säilytettävää fixture-juurta poisteta. Tämä tapaus käyttää yllä olevaa
normaalia vaiherajaa; lyhyet synteettiset deadline-regressiot säilyvät erillään.

Testikuuntelija on vain synteettinen vastaanotin, ei ajopolun tiedostologitus.
Se ei todista aidon COM-kutsun viivettä tai ulkoisen tallennuksen toimintaa.
ETW:n omat otsakkeet ja CPU-/odotusjälki voivat sisältää yksilöiviä tietoja
payloadittomuudesta huolimatta. Profiili, ETL, analyysi ja tarkat mittaukset
pysyvät Gitistä ohitettuina; niitä ei ladata automaattisesti CI-artifactiksi.
Keruussa tarkistetaan tapahtuma-/puskurihävikki ja prosessien tapahtumajärjestys
ennen puuttuvasta tapahtumasta päättelyä. Node-valmistelun tarkempi vaihe tai
natiivin odotuksen kohde rajataan jäljestä, ei arvata viimeisen lokirivin mukaan.

### Legacy-tulostoimituksen korjattu vastuu

Todellinen komentoprosessiregressio osoittaa legacy-CLI:n suoran
konsoliyhteenvedon voivan estää poistumisen lukemattomaan putkeen: supervisor
on jo kirjoittanut strict deadline-tuloksen, poistanut Job-puun ja poistunut.
Korjaus korvaa vain tämän pakollisen tuloksen toimituksen tiedostolla.
Workerin suoran vaihekirjoituksen estyminen jää nykyisen Job-deadlinen piiriin;
regressio erottaa sen supervisorin ja callerin poistumisesta. Tämä mekanismi
ei yksin osoita aiemman CI-katkaisun syytä. `majorUpgrade started` on
vaihehavainto ennen MSI-kutsua, ei todiste spawnista tai viimeisestä operaatiosta.

`callerResultCli`, `callerResultFile` ja `callerResultProcess` erottavat
workspace-toteutuksesta vain teknisen toimitusvastuun. Legacyllä on oma
strict tulossopimus, ajokohtainen `eky-legacy-caller-<32-hex>`-juuri ja
verifier. Identiteetti sitoo producer-revision, descriptor-SHA:n ja ajon;
materiaali varmennetaan myös ennen skenaarion käynnistystä. Pakollinen
enintään 8192 tavun tulos ja todellinen command exit tarkistetaan yhdessä.
Vaihekirjoitin välittää vain suljetun `legacyAcceptanceCaller`-nimiavaruuden
havaintoja: ei kuittausodotusta tai konsolivarapolkua. Epävarma kirjoittimen
poistuminen säilyttää fixturen ja erillisen safety-tuloksen.

### Legacy-komennon valmistumisrajat

| Odotus | Nykyinen omistaja ja raja |
| --- | --- |
| Worker-vaihehavainto, MSI spawn/close | `legacyUpgradeLifecycle` ja `legacyUpgradeWindowsRuntime`; worker ja jälkeläiset saman Job-supervisorin sisällä. MSI käyttää ignored stdiota; vaihekirjoitus ei ole kontrolliprotokolla. |
| Supervisorin tulos ja loppulokitus | Nykyinen supervisor; 600000 ms kokonaisraja, siitä 30000 ms cleanup-varaus, työn raja 570000 ms. Strict tiedosto on erillinen ei-estävästä diagnostiikasta. |
| Supervisorin exit/close | `startLegacyUpgradeSupervisor`; odottaa todellista closea, ei viimeistä lokiriviä. Erilliset turvalliset exit/close-havainnot. Ei uutta ulkopuolista valvojaa. |
| Tulosluku ja semanttinen vertailu | Caller ja `legacyUpgradeFailureBoundary`; strict supervisor-/scenario-tulokset ennen business-jälkiehtoja. Rekursiivinen semanttisen aineiston keruu nykyisen tiedostoadapterin sisällä; puhtaat validaattorit säilyvät erillisinä funktioina. |
| Exact-tuotetilan tarkistus | Nykyinen post-supervisor Windows-adapteri: kaksi sarjallista kyselyä, kummallakin 30000 ms ja 5000 ms lopetusvaraus. |
| Asennussiivous ja jälkiehto | Sama product-runtime: uusi kahden tuotteen tarkistus, enintään kaksi exact-uninstallia (120000 + 5000 ms kumpikin), lopuksi erillinen tarkistus. Ei uutta process-tree-omistajaa. |
| Artifact, normaali profiili, fixture-poisto | Caller päättää järjestyksen ja poistamisen luvan. `legacyUpgradeFilesystemRuntime` ajaa rekursiiviset ryhmät nykyisellä `runBoundedWindowsAdapterProcess`-vastuulla. Yksi kiinteä Node-lehti per ryhmä, ei uutta supervisoria tai prosessia jokaiselle tiedostolle. Epävarma adapterin poistuminen estää jatkotiedostotyön ja aineiston poiston. |
| Pakollinen command-result | Nykyinen rajattu tiedostoadapteri: prepare/publish/verify kukin 30000 + 5000 ms; vain tekninen toimitus, ei skenaariota tai sen cleanupia. Vaihekirjoittimen lopetusvaraus enintään 5000 ms. |

Omistajan hyväksymä budjettikorjaus erotetaan packaged-hyväksynnästä.
Supervisorin jälkeisen
virhepolun konfiguroidut odotusvaraukset ovat enintään
`70 + (70 + 2 * 125) + 70 = 460` sekuntia. Precondition 70 sekuntia ja
supervisor 600 sekuntia nostavat summan 1130 sekuntiin jo ennen tiedostotyötä.
Uuden tulostoimituksen kolme 35 sekunnin varausta ja kirjoittimen 5 sekuntia
nostavat vastaavan laskelman 1240 sekuntiin. Kuusi tiedostoryhmäajoa
varaavat lisäksi 300 sekuntia: inventaario ennen ja jälkeen 30+5 sekuntia
kumpikin, materialisointi 120+5 ja semanttinen tarkistus, lähde-artifactin
uusintavarmennus sekä poisto kukin 30+5. Summa on 1540 sekuntia.
`legacyUpgradeBudget` johtaa laskelman nykyisten omistajien vakioista;
regressio sitoo sen CI-asetuksiin. Supervisorin 600/30 sekunnin rajat sekä
product- ja tulostoimitusadapterien rajat säilyvät ennallaan.

Lifecycle-step on 27 minuuttia ja consumer-job 37 minuuttia. Supervisorin
käännös on erillinen enintään kolmen minuutin vaihe; lifecycle käyttää samaa
jo käännettyä supervisoria ja producerin varmennettuja artifact-tavuja.
Normaali paikallinen `installer:v2-legacy` säilyttää käännöskytkentänsä.
Nämä ovat konfiguroituja varauksia, eivät paikallisia mittauksia tai väite
kaikkien OS-jumien keskeyttämisestä: Node-kutsujan synkronista natiivispawnia
ei voi katkaista event-loop-ajastimella. Pienet request-/result-JSON-tiedostojen
luvut säilyvät nykyisillä omistajilla. Product-operaation tiedostotyö kuuluu
nyt edellä kuvatun Job-workerin sisään; sen loppuvaraus jakautuu cleanupin ja
pakollisen tulostoimituksen kesken. Ulkoinen katkaisu tai puuttuva
terminal-tulos ei ole hyväksyntä.

`legacyUpgradeFilesystem` vastaanottaa yhden suljetun yksityisen IPC-pyynnön
ja palauttaa yhden vastauksen. Se käyttää olemassa olevia inventaario-,
artifact- ja semanttisen tarkistuksen funktioita; ei käynnistä jälkeläisiä,
asentimia tai skenaarioita. Prosessinluonti, IPC-odotus ja tiedostotyö kuuluvat
saman adapteriajan sisään, ja erillinen lopetusvaraus varmentaa todellisen
closen. Onnistunut viesti yksin ei riitä. Polut ja inventaariot pysyvät
yksityisessä muistikanavassa; konsoliin ei kirjoiteta niitä. Pakollinen
caller-tulos erottaa `filesystemProcessAbsent`, ensimmäisen epäonnistuneen
`filesystemOperation`-ryhmän ja suljetun `filesystemErrorCode`-arvon.
Myöhempi onnistuminen ei nollaa aiempaa virhettä tai epävarmaa poistumista.

Kohderegressiot käyttävät nykyistä supervisoria ja callerin todellista
käynnistystä, mutta vain synteettistä workeria ilman MSI:tä. Ne todistavat
jumittuvan workerin, lukemattoman tulosteen, puuttuvan supervisor-tuloksen,
epävarman cleanupin, semantic-cleanup-virheen ja kirjoittimen epävarman
poistumisen. Injektoidut virheluokat erotetaan todellisesta Job-tuloksesta.
Alkuperäinen virhe säilyy, epävarma aineisto säilytetään eikä onnistunut
jälkisiivous muuta skenaariota onnistuneeksi. Lisäksi komentoprosessiregressio
jumittaa tiedostoryhmän skenaarion deadline-virheen jälkeen: alkuperäinen
virhe säilyy, adapterin exit/close varmennetaan, fixture jää talteen ja
komento päättyy virheeseen ilman ulkopuolista aikakatkaisua. Lopputulos varmennetaan
komentoprosessin ulkopuolelta; pelkkä Promisen palautuminen ei riitä.

Korjauspinnan legacy-sopimukset läpäisevät 208/208, jaetun kirjoittimen ja
tulosvälityksen regressiot 39/39, workspace success 321/321, fault 312/312 ja
legacy-artifact-sopimukset 13/13. Artifact-regressio todistaa myös uuden
yksityisen IPC-rajan läpi materialisoidun descriptorin ja provenienssin,
itsenäiset pakettitavut sekä muuttuneen lähteen hylkäyksen. Desktopin
typecheck/build läpäisevät. Tämä on sopimuscheckpoint, ei uusi packaged- tai
CI-hyväksyntä. Tuotantoa, riippuvuuksia tai Job-prosessipuun omistajuutta ei
muuteta. Tämän checkpointin myöhempi CI-tulos ja vielä avoimet
apuoperaatioiden sopimukset on eroteltu yllä; aiempia kohdetestituloksia ei
tulkita koko V2.8:n hyväksynnäksi.

### V2.7:n hyväksytty lähtökohta

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
