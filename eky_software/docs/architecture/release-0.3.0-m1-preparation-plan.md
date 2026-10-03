# 0.3.0 M1 -valmistelu

## Jatka tästä

**PR #283 ja sen main-integraatio on hyväksytty 2.10.2026.**
[Lopullinen checkpoint](https://github.com/eky-software/eky/pull/283#issuecomment-5959719891)
sulkee ennen A1:tä hyväksytyn [pnpm-tietoturvahuollon](#pnpm-bootstrapin-tietoturvahuolto)
ja Windowsin sekä Linuxin rajatun salatun ensivirhetoimituksen. PR #282:n
V1/V2-vakautuksen hyväksyntä säilyy. Myöhempi onnistuminen ei sulje vanhojen
timeout- tai siivoushavaintojen jälkikäteistä juurisyytä.
Alla päivätyt tutkimusvaiheet ovat historiaa, eivät rinnakkaisia työjonoja.

**T1/T2/T3, A1/R01 ja MSI-virheaineiston rajattu integraatiojatko ovat
hyväksyttyjä. Nykyinen sovelluspala on A2/R05:n tallennusvastauksen suoja;
epäselvän ensitallennuksen käyttötapa on hyväksytty toteutukseen.**
Modulaarinen monoliitti ja
hyväksytty M1-rajaus säilyvät. Tämä sivu omistaa M1:n nykyisen jatkamiskohdan;
[julkaisusuunnitelma](release-0.3.0-plan.md) omistaa koko 0.3.0:n sisällön.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Hyväksytty lähtörevisio | PR #290:n main `e6286c466f7281498e1256521eb5f24042616d79`. [Lopullinen hyväksyntä](https://github.com/eky-software/eky/pull/290#issuecomment-5968984119). A1:n PR #288:n [hyväksyntä](https://github.com/eky-software/eky/pull/288#issuecomment-5963057259) säilyy. |
| Mainin omat portit | [CI 37120284589](https://github.com/eky-software/eky/actions/runs/37120284589) läpäisi kaikki 11 valittua porttia suoritusyrityksellä 1: system 807, web 43 ja Electron 39 ilman retryä tai flaky-tulosta. Täysi riskimatriisi ja kaksi vaadittua toistoa säilyivät. Erillinen riippuvuusauditointi ei valikoitunut tämän main-pushin muuttumattomalla polkusuodattimella; sitä ei merkitä mainissa ajetuksi. PR:n auditoinnin oma näyttö on checkpointissa. |
| Suljettu työ | T1/R27:n ajokytkentä, T2/R29:n puhtaan valmistelun suoja ja T3/R28:n todellisten kuluttajien koko prosessipuun omistajuus. Korvatut aktiiviset fallbackit on poistettu ja [pysyvä T3-matriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus) hyväksytty. PR #281 sulki tämän jälkeisen rollback-testiapurin integraatiojatkon. |
| Avoimet havainnot | Aiemmat satunnaiset Electron-käynnistys- ja packaged/legacy-timeoutit säilyvät epäonnistuneina havaintoina omille revisioilleen. Myöhempi vihreä ajo ei todista niiden kaikkia syitä korjatuiksi. [Hylkäysten historia](e2e-test-environment-history.md#dokumentti-mainin-hylkäys-ja-rajattu-diagnostiikkajatko) ja [rajattu apurikorjaus](e2e-test-environment-history.md#rollback-testiapurin-ennenaikaisen-poistumisen-korjaus) erotetaan toisistaan. |
| Nykyinen työ | [A2/R05](#a2r05-tallennuksen-omistajuus): ensimmäisen tallennuksen tunniste, uudemman syötteen säilyminen ja auto-/käsintallennuksen yhteinen omistajuus. Epäselvä ensitallennus estää uuden sokkona tehtävän createn samassa sessiossa; käyttötapa hyväksytty. Ei T3-remonttia, uusia riippuvuuksia, tietomallimuutosta tai testiehtojen lievennyksiä. |
| Ei vielä valmis | A2-A3, W7, M1:n muu sovellustyö ja koko 0.3.0. Lähtörevision hyväksyntä ei hyväksy A2:n tulevaa toteutusta tai muuttunutta liiketoimintasääntöä. |

Hyväksyntä on sidottu yllä olevaan revisioon, ei automaattisesti myöhempään
työpuuhun. Dokumenttimuutoksen toteutuneet tarkistukset ja mahdollisen
integraation lopputulos kirjataan sen omaan hyväksyntächeckpointiin;
pelkän tuloksen ilmoittamiseksi ei tehdä uutta tilakirjauscommittia.
Jokainen uusi toteutuspala alkaa omalla preflightilla. Sivulla ei ylläpidetä Goal-työkalun
ajonaikaista tilaa.

## A1/R01: toteutus ja hyväksyntä

**Integraatio hyväksytty PR #288:n mainissa.** Yllä oleva checkpoint omistaa
lopullisen revision ja portit. Alla säilyy kohdetodennuksen sekä sitä
edeltäneen rollback-havainnon historia; havaintoa ei väitetä korjatuksi.

[Omistava kohdesopimus](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde)
on toteutettu nykyisessä laskutuksen web-featuressa. Avaussukupolvi ja
muokkaussession avain pitävät näkyvät arvot ja tallennuskohteen yhdessä.
Vanha onnistuminen tai virhe ei muuta nykyistä kohdetta, virhettä tai
lataustilaa. Unmount mitätöi vanhan vastauksen; React StrictModen
effect-uusinta ei hukkaa nykyistä asiakaskortilta aloitettua avausta.
Tavallinen tallennus ja ensimmäinen create-vastaus eivät vaihda session
avainta. A2:n myöhäisen kirjoitusvastauksen sopimus jää erikseen avoimeksi.

Kohdennettu näyttö ennen PR-jäädytystä:

- Tilasiirtymien ja lomakeavaimen regressiot sekä nykyiset view-testit
  läpäisivät. Koko web-yksikkösarja, backend-sarja, workspace-tyypitys ja
  web-build läpäisivät; backendin viisi nykyistä ohitusta eivät ole läpäisyjä.
- [INV-OPEN-001...006](r0-e2e-test-matrix.md#invoicing)
  läpäisivät oikealla UI:lla, hallituilla GET-vastausjärjestyksillä ja
  todellisilla tallennuksilla. Pysyvä jälkiluku varmistaa oikean kohteen ja
  aiemman luonnoksen muuttumattomuuden. Testiprosessien siivous varmistettiin.
- Asiakaskortilta avaamisen, luonnoksen elinkaaren, uudelleenhyväksynnän ja
  kopioinnin nykyiset selainregressiot läpäisivät. Riippumaton katselmus
  johti StrictMode- ja testiapurin ensivirheen säilytyksen korjauksiin.
- Testien kehitysvaiheen hylkäykset säilyvät erillisinä; vain korjatun
  lopullisen kohdesarjan tulos on yllä kuvattu näyttö. Koko workspace-ajoa
  tai PR/main-integraatiota ei ole hyväksytty kohdesarjan perusteella.

| Avoin hyväksyntähavainto | Omistaja ja rajaus | Sulkemisehto |
| --- | --- | --- |
| Muuttumattoman `localUpdatePackageCache.test.ts`-tiedoston `resumes rollback normalization after either durable directory rename` -testi aikakatkaistiin laajassa sarjassa. Yksi rajattu diagnostinen uusinta läpäisi; syy jäi avoimeksi. | Desktopin update-testin omistaja. Ensivirhe ja siihen liittyvä aineisto säilytetään. A1 ei muuta cachea, asenninta, aikarajoja tai siivoussopimusta. | Näyttöön perustuva korjaus ja sen todennus tai omistajan nimenomainen päätös seuraavasta hyväksyntäkierroksesta. Uusinnan läpäisy ei yksin sulje havaintoa. Nykyiset pakolliset PR/main-portit säilyvät. |

Omistaja hyväksyi rajatun normaalin PR-kierroksen ja mergen; hyväksyntä
toteutui yllä linkitetyssä A1-checkpointissa. Rollback-testin vanha
timeout jää seurantahavainnoksi. Seuraava sovelluspala on A2/R05, ei T3:n
uusi toteutus.

## A2/R05: tallennuksen omistajuus

**Rajattu toteutus ja kohdetodennus valmiit; PR/main-integraatio avoinna.**
Omistaja hyväksyi tämän rajatun sovelluspalan aloittamisen 3.10.2026.
[Omistava tallennussopimus ja testiketjut](invoicing-ui-roadmap.md#a2-tallennusvastuun-valmistelu)
erottavat hyväksytyn tavoitteen, toteutussuunnitelman ja epäselvän
ensitallennuksen hyväksytyn käyttötavan. A1:n kohdesuoja säilytetään, A3:n laajempaa
hyväksyntävalmiuden vastaussidontaa ei toteuteta samalla.

Kooditarkistuksessa vahvistui, että automaattitallennus voi hylätä koko
onnistuneen create-vastauksen lomakkeen muuttuessa; käsin tallennus voi
puolestaan korvata uudemman syötteen vanhalla vastauksella. Molemmat
kirjoitusreitit tarvitsevat saman omistajan ja tallennetun revision
tarkistuksen. Poistuneen muokkaussession vastaus ei saa palauttaa editoria.

Rajattu toteutus käyttää yhtä featuren tallennussessiota ja API-kirjoittajaa.
Onnistunut create-ID säilyy, mutta uudempi syöte vahvistetaan vasta oman
PUTinsa jälkeen. Epäselvä create estää molemmat uudet luontireitit samassa
lomakkeessa. Paluu listalle tekee tuoreen, uusimpaan hakuun sidotun luvun.

Kohdennettu näyttö ennen PR-jäädytystä:

- Tallennusomistajan/editorin kohdetestit ja koko web-yksikkösarja läpäisivät;
  backendin nykyiset kirjoitus-, hyväksyntä- ja draft-repository-kohdetestit
  läpäisivät. Workspace-tyypitys ja web-build läpäisivät.
- Koko workspace-testiajo läpäisi: 5 352 onnistunutta ja kahdeksan
  ennestään ohitettua testiä. Ohituksia ei lasketa läpäisyiksi.
- [INV-SAVE-001...011](r0-e2e-test-matrix.md#invoicing) läpäisivät oikealla
  UI:lla ja backendin jälkiluvulla. Mukana ovat menetetty create-vastaus,
  molempien kirjoitusreittien esto, session vaihto sekä palautumisen
  tuoreen listan virhe- ja vastausjärjestykset. Siivous varmistettiin.
- A1:n kuusi avaustestiä sekä nykyiset asiakaskortti-, elinkaari-,
  uudelleenhyväksyntä-, kopiointi- ja kaksoispainalluspolut läpäisivät.
  Ensimmäinen viereinen ajo hylättiin vanhaa listan otsikkoa odottaneeseen
  testiin; odotus päivitettiin tuoreeseen summaryyn säilyttäen saman ID:n,
  viivästetyn detail-vastauksen ja pysyvän jälkiluvun vaatimukset.
- Riippumaton katselmus löysi palautumisen vanhentuneen listan riskin.
  Tuore listahaku ja success/error/finally-suoja korjattiin ja katselmoitiin.
  Uudet listaregressiot todentavat tämän korjauksen.

Nämä paikalliset tarkistukset eivät yksin hyväksy PR/main-integraatiota.
Lopullinen hyväksyntä kirjataan täsmärevision checkpointiin;
pelkän CI-tuloksen vuoksi ei avata uutta dokumentti-integraatiokierrosta.

Valmistumiseen tarvitaan hyväksytyn sopimuksen rajattu toteutus,
deterministiset UI-/backend-ketjut ja nykyiset viereiset regressiot,
riippumaton katselmus sekä täsmärevision PR- ja main-portit. Vanhojen
MSI-, timeout- ja ETL-havaintojen jälkiselitys ei ole A2:n tavoite eikä niitä
väitetä suljetuiksi. Uusi todellinen regressio tai pakollisen portin este
käsitellään nykyisen testauskäytännön mukaan.

## MSI-politiikkakokeen virheaineisto

**Rajattu toimituskorjaus ja integraatio hyväksytty PR #290:n mainissa.**
[Lopullinen checkpoint](https://github.com/eky-software/eky/pull/290#issuecomment-5968984119)
erottaa kohderegressiot, yhden hosted-kokeen salauksen ja purun sekä PR/main-
hyväksynnän. Nimetyt MSI-lokit ja tulos sisältyvät nyt nykyiseen salattuun
toimitukseen. Asennussääntöä, validatorin ehtoja tai sovellusta ei muutettu.
Ohje-mainin `b9245ba6b31b8001c225a7cd7bb8e93ca4fbf124`
[alkuperäinen hylkäys](https://github.com/eky-software/eky/actions/runs/37078912651)
säilyy avoimena havaintona: puuttuneesta MSI-lokista ei voida palauttaa
hylättyä tarkkaa ehtoa. Uudempi läpäisy ei todista sen syytä korjatuksi.
Alla säilyy valmisteluhistoria, ei uusi avoin toteutusjono.

Ohje-mainin synteettinen `uiOverride`-koe hylkäsi jo lähdepaketin
`sourceInstall`-vaiheen syyllä `msiPolicyLogInvalid`. Siivous raportoitiin
valmiiksi ja prosessipuu poissa olevaksi. Lähdekoodissa lokin validointi
tapahtuu onnistuneen MSI-komennon jälkeen; tämä syy ei yksin osoita
asenninprosessin kaatumista tai varsinaisen override-päivityksen virhettä.
Salattu keräys toimi, mutta sen sallituista tiedostoista puuttuivat kokeen
MSI-lokit ja `policy-result.json`. Vanhan ajon tarkkaa lokiehtoa ei voi
jälkikäteen palauttaa puuttuvasta aineistosta.

Omistajan hyväksymä rajattu jatko:

1. Lisää vain tämän synteettisen kokeen nimetyt lokit ja tulos nykyiseen
   [salattuun toimitukseen](ci-encrypted-evidence.md#testiperheiden-virheaineisto).
2. Todista epäonnistuneen ja keskeytyneen komennon aineiston säilyminen,
   nykyiset turvarajat sekä oikea salaus ja purku. Tee yksi nimetty hosted-koe;
   säilytä siinä myös läpäisseiden varianttien lokit vertailua varten.
3. Tutki tuotannon MSI-sääntö, synteettiseen pakettiin kopioitu sääntö ja
   validatorin ehdot yhdessä. Testi, prosessitulos, siivous, keräys ja
   analyysin tulos pysyvät erillisinä.
4. Korjaa vain todennettu syy regressioineen. Jos alkuperäinen vika ei
   toistu tai näyttö ei riitä, kirjaa täsmällinen puute ja jatkopäätös;
   uuden kokeen läpäisy ei ole juurisyyn korjaus.

Normaalin CI:n ja mahdollisen mergen hyväksyntä säilyy omana porttinaan.
Ei uusia riippuvuuksia, prosessiomistajaa, raw-julkaisua, pidennettyjä
aikarajoja tai kevennettyä MSI-sisällön tarkistusta. Tutkimusaineiston
säilytysvalinta ei säilytä asennettua testituotetta tai ohita siivousta.

## Pnpm-bootstrapin tietoturvahuolto

**Hyväksytty PR #283:n mainissa.** Yllä oleva checkpoint omistaa lopullisen
revision ja portit. Oletushaaran 17 pnpm-hälytystä sulkeutuivat korjattuina;
erillinen readback ei löytänyt avoimia Dependabot-hälytyksiä. Tämä ei ole
väite kaikkien mahdollisten haavoittuvuuksien puuttumisesta. Alla säilyy
huollon päätös- ja koehistoria, ei uusi avoin huoltotehtävä.

Omistaja hyväksyi 2.10.2026 pnpm-päivityksen ja erillisen bootstrap-auditoinnin
puutteen korjauksen ennen A1:tä. Oletushaaran silloiset 17 avointa Dependabot-hälytystä
koskevat samaa `pnpm@11.1.3`-pakettia, eivät 17:ää sovellusriippuvuutta.
Hälytysten korjaukset kattava pienin täsmäversio on `11.11.0`.
[Upstreamin julkaisu](https://github.com/pnpm/pnpm/releases/tag/v11.11.0)
sisältää myös nykyisiin patch-, allowBuilds- ja workspace-asennuspolkuihin
liittyviä suojauksia. Löydökset eivät osoita toteutunutta hyväksikäyttöä.

Rajattu toteutus käyttää nykyistä valmisteluomistajaa. Valitun Noden npm
auditoi kopioidun bootstrap-lockfilen ennen työkalun asentamista tai ajamista.
Exit-koodi, raportin muoto, nollalöydökset ja auditoidun joukon kattavuus
varmistetaan; allekirjoituksen ja offline-eheyssidonnan ketju säilyy erillisenä.
Bootstrap saa oman viikoittaisen Dependabot-seurannan. Täsmällinen
[valmistelusopimus](dependency-policy.md#ci-paketinhallinnan-valmistelu)
omistaa jatkokäytön, ei uusi testialusta.

Yhteensopivuusraja: pnpm pysyy saman pääversion sisällä, MIT-lisenssi,
Node-vaatimus `>=22.13` ja nykyinen bin-rajapinta säilyvät; uutta erillistä
riippuvuutta ei lisätä. Sovelluksen pnpm-lockfile, runtime-pinnit,
tietokanta, aikarajat ja hyväksyntäehdot eivät muutu. Välimuistin,
workspace-injektion, patchin ja paketoinnin toiminta todennetaan olemassa
olevilla porteilla, ei pelkän versionumeron perusteella.

Valmistuminen edellyttää kohdennettuja regressioita, vanhan lockfilen
auditointihylkäystä, uuden työkalun tyhjän välimuistin varmennusta,
jäädytetyn revision nykyisiä Windows-/Linux- ja PR-portteja, riippumatonta
katselmusta ja valtuutetun mergen jälkeen mainin omia portteja. Auditoinnin
vihreys, toimintatestit ja oletushaaran hälytysten sulkeutuminen kirjataan
erikseen. Repoasetukset tarkistetaan tämän jälkeen vain lukien; maksullisia
palveluja tai suojausasetusten muutoksia ei hyväksytä tällä päätöksellä.
Nämä portit suljettiin yllä linkitetyllä lopullisella checkpointilla.
Repoasetusten vain luku -kartoitus raportoidaan erikseen; se ei hyväksy
asetusten muuttamista eikä avaa vanhaa timeout-/ETL-tutkimusta.

Kohdennettu näyttö ennen uuden revision jäädytystä:

- Bootstrapin 57/57 regressiota läpäisi. Vanhan lukituksen oikea auditointi
  hylättiin ennen asennusta tai pnpm:n käynnistystä. Uuden työkalun auditointi,
  allekirjoitus, offline-eheyssidonta ja versio läpäisivät tyhjästä välimuistista.
- Nykyinen CI-sopimussarja läpäisi 379/379. Lukittu työtilaasennus, workspace-
  testit ja tyypitys läpäisivät; kahdeksan nykyistä alustakohtaista ohitusta
  eivät ole läpäisyjä tai korvaa Linux-todennusta. Sovelluksen lockfile säilyi.
- Tuotanto- ja full audit olivat puhtaita, ja 160 rekisteriallekirjoitusta
  varmistettiin. Muutettujen ohjeiden 157 suhteellista linkkiä ja ankkuria
  tarkistettiin. Alla oleva PR-historia kuvaa tämän lähtöcheckpointin
  jälkeisiä vaiheita; lopullinen main-hyväksyntä on sivun alussa.

### Pnpm-huollon PR-porttien rajatut esteet

Tämä osio säilyttää aikaisempien revisioiden ensivirheet ja silloiset
avoimet portit. PR #283:n myöhempi hyväksyntä ei muuta niitä onnistumisiksi
eikä todista kaikkia juurisyitä korjatuiksi. Nykyinen työ on A1/R01.

PR #283:n lähde `315098db14130bc9399e07671e0d1a81039fe350` ja sen
PR-checkout `f61d37f7c83dbae10d3701a3fd5c2213182d08f0` sisältävät saman
lähdepuun. [Riippuvuustarkistus 36996596000](https://github.com/eky-software/eky/actions/runs/36996596000)
läpäisi, mutta [normaali CI 36996596291](https://github.com/eky-software/eky/actions/runs/36996596291)
hylättiin suoritusyrityksellä 1. Kaikki 30 toteutunutta pnpm-valmistelua
läpäisivät auditoinnin ja työkalun varmennuksen. Se ei korvaa toimintatestejä
eikä osoita nykyisten testivirheiden syytä. Omistaja hyväksyi näiden kahden
esteen rajatun selvityksen ja näyttöön perustuvat korjaukset.

| Este ja omistaja | Säilynyt näyttö | Sulkemisehto |
| --- | --- | --- |
| Kiinteän komennon testiharness: upgrade `preparationHold`, clean-upgrade-entry-toisto 1 | Tarkoituksellinen työvaiheen timeout toteutui. Validoitu vaihetulos oli `deadlineExceeded / cleanupFailed / processTreeAbsent=false`. Nykyinen yhteenveto ei säilyttänyt native-siivousvirheen esiintymistä; siivouksen tarkka syy jäi avoimeksi. | Säilytä epäonnistunut havainto. Mahdollinen korjaus edellyttää yksilöityä syytä ja regressiota; nykyinen prosessipuun poissaolovaatimus ja normaalit hyväksyntäportit säilyvät. Toiston 2 läpäisy ei korvaa toistoa 1. |
| Electron E2E -valmistelu: `DESK-WORKSPACE-REPLACE-CANCEL-002` | Ensimmäinen suoritusyritys päättyi `workspaceBackup`-valmistelussa `E2E_BACKEND_HEALTH_TIMEOUT`-virheeseen ennen Electronin käynnistystä. Prosessi havaittiin, kuunteluilmoitusta ei saatu ja viimeinen health-kysely torjuttiin. Valmisteluprosessien siivous ja portin vapautuminen varmistettiin. Nykyinen retry läpäisi, joten 39 tapauksen sarjan tulos oli yksi flaky, ei hyväksytty sarja. | Säilytä ensiyritys erillään retrystä. Täsmennä valmistelun pysähtymiskohta ennen käyttäytymiskorjausta; samat valmius-, siivous- ja flaky-ehdot säilyvät. Käytetty retry ei oikeuta uuteen automaattiseen uusintaan. |

Molemmat ajon salatut liitteet purettiin ja niiden run/attempt/revision-
sidonta sekä mukana olevien tiedostojen eheys varmennettiin. Ne kuuluvat
**onnistuneille workspace-success-kuluttajille**, eivät yllä oleville
hylätyille testitöille. Kummankin ETL jäi `unverified`-tilaan pois paketista.
Nykyinen [salatun aineiston sopimus](ci-encrypted-evidence.md) ei siis anna
näiden kahden virheen raakadataa. Salaus toimii toimitusrajalla, mutta
keräyksen kattavuutta ei saa tulkita kaikkien testien raakalogitukseksi.

Rajattu raportointikorjaus säilyttää jo validoidun siivoustuloksen
native-virheen esiintymisen suljettuna `reported`/`notReported`-havaintona
[nykyisessä vaiheprojektiossa](windows-installer-acceptance-harness-v2.md#komentotestin-siivousvirheen-havainto).
Se ei palauta vanhan ajon puuttuvaa tietoa eikä korjaa vielä kumpaakaan
juurisyytä. Supervisor, aikarajat, varsinainen tulosparseri ja pakollinen
poissaoloassertio säilyvät. Kohdetodennus kattaa projektion ja alkuperäisen
virheen säilymisen sekä tiukan parserin, ei uutta hosted-hyväksyntää.

Omistaja hyväksyi nykyisen salatun toimituksen laajentamisen tavallisten
testiperheiden ensimmäisen epäonnistumisen rajattuihin tulosteisiin ja
olemassa oleviin vaihe-/siivoustuloksiin. Keräystä ei rajata vain yllä
nimettyihin kahteen testitapaukseen. Toteutuksen omistaa
[CI-tutkimusaineiston sopimus](ci-encrypted-evidence.md#testiperheiden-virheaineisto).
Ennen yhtä normaalia CI-kierrosta vaaditaan kohderegressiot, katselmus ja
kontrolloidun virheen keräys -> salaus -> purku -todistus.
Ei tietokantoja, ympäristön kopiointia, uusia keräystyökaluja tai
salaamatonta fallbackia. Omistaja hyväksyi tämän jälkeen myös Linuxin
salauskytkennän runnerin valmiilla GnuPG- ja PowerShell-työkaluilla.
Sitä ei oteta käyttöön Windows-näytön perusteella: rajatut regressiot,
riippumaton katselmus ja oma synteettinen hosted-koe sekä oikean avaimen
paikallinen purku vaaditaan ennen normaalien Linux-jobien toimitusta.
Puuttuva tai yhteensopimaton työkalu estää toimituksen; asennuksia,
uusia riippuvuuksia, testiehtojen muutoksia tai salaamatonta varareittiä
ei lisätä. Tämän rajatun jatkon hosted- ja PR-hyväksyntä on jäädytyshetkellä
avoin; toteutunut tulos sidotaan lähderevisioon PR #283:n omassa checkpointissa.
Riippuvuustyökalun mahdollisesti tunnuksia sisältävää raakaa tulostetta
ei lisätä keräykseen. Nykyisiä hylkäyksiä ei ohiteta, T3:a ei avata
uudelleen eikä mergeä tehdä. Tämä toteutus ei vielä sulje kahta estettä.

Linux-laajennuksen kohderegressiot ennen hosted-koetta: yhteinen keräys-,
workspace- ja OpenPGP-sarja 51/51 sekä CI-sopimukset 389/389 läpäisivät.
Riippumaton katselmus ei löytänyt korjattavaa. Nämä eivät korvaa Linuxin
todellista salaus-/purkutodistusta tai uuden revision normaalia PR-kierrosta.

Keräyskorjauksen rajattu näyttö ennen hosted-kertakoetta:

- Yhteinen keräys-, smoke- ja OpenPGP-sarja läpäisi 63/63. Mukana on oikean
  epäonnistuneen lapsiprosessin tulosteen keräys, salaus ja tavuntarkka purku.
- Native-sopimus- ja command-sarja läpäisi 106/106 sekä parserit 5/5.
  Saman testin myöhempi siivousvirhe säilyttää kaikkien sen kontekstien näytön.
- CI-sopimukset läpäisivät 387/387 ja Windowsin workflow-/komentokytkennät
  161/161. Aiemmat 258 workflow-askelta säilyivät muuttumattomina.
- E2E-kohdesarja läpäisi 186/186. Katselmuksessa korjatun web-startupin
  jatkotodennus läpäisi 123/123 sekä oikean Viten kaksi koostekoetta.
  E2E-tyypitys ja ohjeiden 144 suhteellista linkkiä/ankkuria tarkistettiin.
- Riippumaton katselmus löysi ja rajatut regressiot kattoivat smoke-putken
  viimeisten tavujen, usean cleanup-kontekstin ja web-startupin säilytysaukot.
  Nämä eivät ole aiempien kahden CI-hylkäyksen juurisyykorjauksia.

Hosted-toimitus ja normaali CI hyväksytään vasta omista ajoistaan; yllä oleva
kohdennettu näyttö ei korvaa niitä. Lopputulos sidotaan jäädytettyyn revisioon
PR:n checkpointissa ilman erillistä tilakirjauscommittien kierrosta.

## Riskiperusteinen jatko 1.10.2026

### Normaalin kierroksen tulos ja rajatut korjaukset

PR-lähteen `0729641db5f5a941df44d7054983b6d6a0834ed8`
[normaali CI 36932543705](https://github.com/eky-software/eky/actions/runs/36932543705)
ja [Dependency security 36932543522](https://github.com/eky-software/eky/actions/runs/36932543522)
päättyivät hylättyinä suoritusyrityksellä 1. Todellinen PR-checkout oli
`b929300b02b920829ec5aad700a7b0e5377323e2`, jonka vanhemmat vastaavat
main-lähtörevisiota ja yllä nimettyä PR-lähdettä. Kyse ei ole main-mergestä.
Kierrosta seurattiin valmistumiseen ja ensimmäiset virhelokit säilytettiin.

- Tuotantoaudit hylkäsi `hono@4.13.5`:n löydökseen
  [GHSA-hxh3-vqpv-xpqv](https://github.com/honojs/hono/security/advisories/GHSA-hxh3-vqpv-xpqv).
  Korjattu täsmäversio on `4.13.7`. Löydös koskee JSX SSR -escapingia;
  Eky käyttää Honoa HTTP-adapterina, eikä tarkastetuista lähteistä löytynyt
  tämän SSR-polun käyttöä. Tämä ei poista riippuvuuden päivitystarvetta tai
  muuta auditoinnin hylkäystä hyväksynnäksi.
- Legacy-tuottajan testiluettelosopimus hylkäsi 45 tiedoston joukon, koska
  sen odotettu luettelo sisälsi 44. Aiemmin core-ryhmään lisätty
  `captureExporterMetadata.test.mjs` puuttui odotetusta joukosta.
  Paketin rakennus ja legacy-kuluttajat eivät käynnistyneet. Tämä on
  todennettu sopimustestin ylläpitopuute, ei vanhan asennustimeoutin syy.
- Molemmat workspace-success-ajot ja molempien toistojen kaikki viisi
  fault-skenaariota läpäisivät. Kriittinen Electron-sarja läpäisi 39/39
  ilman retryä, flakyä tai puuttuvia tapauksia. V2-koonti hylkäsi kierroksen
  oikein legacy-portin vuoksi; muiden jobien vihreys ei ohita sitä.
- Molempien workspace-success-ajojen salatut paketit ladattiin ja purettiin;
  sidonta, säilyneet tavut ja tiivisteet hyväksyttiin. Testi, paketti ja
  siivous läpäisivät, tallennus sulkeutui ja analyysi oli `skipped`.
  **ETL-tiedosto jäi kummastakin paketista pois tilassa `unverified`.**
  Toimitus ei siis todista koko tapahtumajäljen säilymistä. Tarkka poisjäännin
  syy on avoin, eikä puuttuvaa sisältöä palauteta näistä paketeista.

**Omistajan jatkopäätös 2.10.2026:** päivitetään vain Hono `4.13.5 -> 4.13.7`
ja täydennetään legacy-testin odotettu tiedostojoukko. Rajatut regressiot,
HTTP-adapterin testit, tyypitys, auditoinnit ja katselmus edeltävät yhtä uutta
normaalia CI-kierrosta uudesta jäädytetystä revisiosta. Electron `43.7.6`,
`better-sqlite3 13.0.2`, Undici `7.29.1`, tietomalli, T3:n omistajuus,
aikarajat ja hyväksyntäehdot säilyvät. Ei uutta riippuvuutta tai mergeä.
ETL-puutteen nykyisen aineiston tarkistus ei yksilöinyt hylkäyssyytä:
kerääjä yhdistää koko-, identiteetti- ja lukuvirheet `unverified`-tilaan.
Tallennusprofiilin enimmäiskoko on keräysrajaa suurempi, mutta pois jääneen
tiedoston kokoa ei tallennettu. Mahdollinen suljetun hylkäyskoodin ja koon
lisäys salattuun manifestiin on erikseen päätettävä jatkotyö, ei tämän
korjauskierroksen toteutus tai keräysrajan nosto.
Rajattu Hono-päivitys ja testiluettelon täydennys on toteutettu.
Lockfile-diffi muuttaa vain Honoa, sen eheystiivistettä ja nykyisen
`@hono/node-server`-adapterin peer-sidontaa. Alkuperäinen timeout ja vanha
vientivirhe pysyvät avoimina. Uuden revision CI-hyväksyntä on vielä tekemättä.

Paikallinen kohdennettu näyttö ennen uuden revision jäädytystä:

- Legacy-workflow'n nykyiset 45/45 sopimustestiä läpäisivät ilman ohituksia.
  Täsmällisen testijoukon ja duplikaattien hylkäys säilyvät.
- Backendin 191 testitiedostoa läpäisi: 1365 testiä onnistui ja nykyiset viisi
  alustakohtaista testiä ohitettiin. Ohituksia ei lasketa läpäisyiksi eikä
  tämä korvaa Linux-CI:tä. Backendin tyypitys ja tuotantobuild läpäisivät.
- Inertti merkkijono sekä array-root toistivat upstreamin JSX SSR -escaping-
  puutteen vanhassa riippuvuudessa. Samat syötteet escapetaan uudessa;
  tavallinen tekstikontrolli säilyi. Koe ei osoita hyökkäyspolkua EKY:ssä.
- Production- ja full audit eivät löytäneet haavoittuvuuksia; kaikki 160
  rekisteriallekirjoitusta varmistettiin. Oletushaaran Dependabot-tila ja
  uuden revision toimintatestit ovat edelleen erillisiä tarkistuksia.
- Riippumaton rajatun muutoksen katselmus ei löytänyt estäviä havaintoja.
  Se tarkisti riippuvuusrajan, muuttumattomat runtime-pinnit, 45 tiedoston
  yksikäsitteisen testijoukon ja dokumenttien vastaavuuden toteutukseen.
  Katselmus ei korvaa uuden revision CI-kierrosta tai julkaisuhyväksyntää.

### Nykyisen työn rajaus

Alla kuvattu timeout-tutkimus ja sen päätösraportti säilyvät historiana.
Omistajan uusin hyväksyntä lisää seuraavan rajatun toimitusvälitavoitteen;
se ei käynnistä yksityisiä kertakokeita uudelleen.

### Salatun tutkimusaineiston välitavoite

**Nykytila 2.10.2026:** rajattu salattu toimitus/purku on hyväksytty
revisiolla `f69f3d76`, [ajo 36930438493](https://github.com/eky-software/eky/actions/runs/36930438493),
suoritusyritys 1. Paikallisesti toistettu Git-hakuvirhe korjattiin ja
hosted-toimitus sekä yksityinen purku läpäisivät. Tämä ei ole normaalin
workspace-testin, ETL-tallennuksen tai alkuperäisen timeoutin hyväksyntä.
Keräyksen julkisen avaimen vahvistus on voimassa; myöhempi normaali kierros
on erotettu [omaan checkpointiinsa](#normaalin-kierroksen-tulos-ja-rajatut-korjaukset).
Alla säilyvät aiempien vaiheiden tulokset, eivät rinnakkaiset
työjonot. Tarkka lopputulos on [hyväksyntächeckpointissa](#salatun-toimituksen-hyväksyntä).

Omistaja hyväksyi Gitin GnuPG:n rajatuksi testityökaluksi ja nimettyjen
CI-tiedostojen salatun julkaisun. Toteutus kytketään nykyiseen Windowsin
workspace-kuluttajaan, ei uuteen testialustaan. Nykyinen julkinen turvallinen
raportti säilyy; raakasisältö toimitetaan vain paikallisesti hallitun
purkuavaimen julkiselle vastinavaimelle salattuna. Tarkka käyttö- ja
ylläpitosopimus on [CI:n salatussa tutkimusaineistossa](ci-encrypted-evidence.md).

Tämä välitavoite valmistuu, kun tiedostorajauksen ja salauksen regressiot,
todellinen synteettinen salaus/purku sekä normaaliin kuluttajaan kytkentä on
katselmoitu ja kohdennettu hosted-toimitus on varmennettu. Käyttöönottoa ei
avata ennen ylläpitäjän oman avaimen purkutestiä. Puuttuva avain tai
toimitustodiste merkitään puuttuvaksi, ei onnistuneeksi.

Ensimmäisen toteutuksen rajat:

- Vain ennalta nimetyt ETL-, tallennus-/vientilokit ja caller-tulos;
  ei koko runnerin tiedostoja, ympäristöä tai oikeaa käyttäjädataa.
- GnuPG eristetään testiapuriin. Ei npm- tai sovellusriippuvuutta,
  omaa salausalgoritmia, uutta loggeria tai supervisor-remonttia.
- Salattu liite säilyy yhden vuorokauden. Purkuavain ei mene GitHubiin.
  Paikallinen säilytys ja ratkaisemattoman näytön säilytysvelvoite jatkuvat.
- Alkuperäinen testitulos, siivous, paketin eheys, tallennus, toimitus ja
  analyysi pysyvät erillisinä. ETL toimitetaan ennen valinnaista analyysiä.
- Nykyiset aikarajat, riippuvuuksien täsmäversiot, retry-ehdot ja pakolliset
  testit säilyvät. Jobin pakkokatkaisun jälkeistä toimitusta ei luvata.
- Playwrightin ensiyrityksen trace on tämän jälkeen erillinen pieni työ
  nykyisiin fixtureihin. T3/V2-prosessiomistajuutta ei avata uudelleen.

Työpuun rajattu toteutus läpäisi 55/55 paikallista Windows-tarkistusta
ilman ohituksia. Mukana ovat todellinen keräys -> salaus -> purku,
muutetun salatekstin ja väärän avaimen hylkäys, avainprofiilin rajat,
viivytetyn GPG-lapsen pysäytys, siivouksen erillinen todistus sekä nykyiset
CI-hyväksyntä- ja työkalukytkennät. Riippumaton lukukatselmus ei löytänyt
korjausten jälkeen estettä rajatusta kytkennästä. Yhteinen GPG-budjetti on
88 sekuntia ja erillinen kahden sekunnin pysäytysvara ulomman 120 sekunnin
rajan sisällä. Tämä ei muuta varsinaisen testin aikarajoja.
Synteettisen toimituskokeen todellinen CLI -> salaus -> purku -ketju
läpäisi, ja yhteinen `test:ci` läpäisi 357/357 sopimustestiä ilman ohituksia.
Toimituskokeen erillinen lukukatselmus ei löytänyt estävää puutetta.
Sen nimeämät puuttuneet CLI-hylkäysregressiot lisättiin: väärä lähderevisio,
rikkinäinen tapahtuma-JSON ja liian suuri tapahtuma-JSON hylätään ennen
aineiston valmistelua tai julkaisuoutputin muutosta. Täydennetty
OpenPGP-kohdesarja läpäisi 16/16 ilman ohituksia. Tämä testitäydennys ei
muuttanut toteutusta tai workflow'ta; aiempaa 357/357-tulosta ei esitetä
uutena koko CI:n ajona.
Julkaisua edeltävä yhdistetty kohdesarja läpäisi 58/58 tarkistusta ilman
ohituksia. Julkaisukatselmuksessa yksityiskohtaiset käyttöönottohavainnot
rajattiin yksityiseen näyttöön; yhteinen ohje säilyttää vain portin tilan.

Kyse on työpuun paikallisesta näytöstä, ei hyväksytystä hosted- tai
release-revisiosta. Käyttöönoton paikallinen hyväksyntäportti on täytetty;
sen yksityiskohtainen näyttö säilyy yksityisenä. Yksi revision `9daf3209`
synteettinen hosted-toimituskoe päättyi salausaskeleen yleiseen
`WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED`-hylkäykseen. Checkout sekä
Node-/GnuPG-ennakkotarkistus läpäisivät. Salattua liitettä ei syntynyt,
eikä purkua tai toimitusta merkitä hyväksytyksi. Muut workflow'n jobit
ohitettiin suunnitellusti; MSI:tä tai normaalia hyväksyntää ei ajettu.
Yleinen hylkäys ei vielä erota CLI:n käynnistysehtoja, keräystä ja
salausprosessia. Sama paikallinen kutsu läpäisi, mutta ei todista hosted-
syytä. Ensimmäisen ajon näyttö säilytettiin. Kohdennettu toimitus on avoin.
Omistaja hyväksyi rajatun vaihe-erottelun ja yhden uuden enintään viiden
minuutin synteettisen kokeen. Erottelu koskee vain toimituskokeen
käynnistys-, keräys-, salaus- ja julkaisuportteja: julkiseen virheeseen
tulee koodin määräämä vaihe, ei raakavirhettä tai pääteltyä juurisyytä.
Rajatut regressiot ja workflow-sopimukset läpäisivät 60/60 tarkistusta;
erillinen staattinen katselmus ei löytänyt estettä. Hyväksytty yksi jatkokoe
ajettiin revisiosta `9f8f7c34`: [ajo 36924369649](https://github.com/eky-software/eky/actions/runs/36924369649),
suoritusyritys 1, hylättiin vaiheeseen `encryption`. Aiemmat kutsu-,
revisio- ja keräysportit läpäistiin. Tämä vaihe kattaa salausapurin
käynnistyksen ja sen suorittamisen, eikä vielä todista sisäistä juurisyytä.
Salattua liitettä ei syntynyt; purku ja toimitus ovat edelleen avoimia.
Muut jobit ohitettiin, eikä MSI:tä tai normaalia hyväksyntää ajettu.
Aikarajat ja normaalin testin ehdot säilyvät. Molempien yritysten näyttö
säilytetään erikseen; keräyksen vahvistusportti suljettiin epäonnistumisen
jälkeen. Tässä vaiheessa kolmatta hosted-koetta ei ollut käynnistetty.

Tämän jälkeen käsitelty rajattu päätös: `Invoke-EvidenceEncryption` muodostaa jo
suljetun virhekoodin, mutta `sealWorkspaceEvidence.ps1` ja sen Node-kutsuja
peittävät sen yleisellä hylkäyksellä. Säilyneen aineiston perusteella
puuttuvat tämän koodin välitys sekä käynnistysvirheen erottaminen apurin
sisäisestä hylkäyksestä. Mahdollinen täsmennys rajataan olemassa olevan
sopimuksen sallittuihin koodeihin ja regressioihin, ei raakatulosteiden
julkaisuun tai uuteen raportointikerrokseen. Uusi hosted-todennus tarvitsee
erillisen ajopäätöksen; aiempi yhden kokeen lupa on käytetty.
Omistaja hyväksyi tämän jälkeen rajatun jatkon: olemassa olevan turvallisen
virhekoodin välitys, regressiot ja yksi uusi enintään viiden minuutin
synteettinen todennus. Normaalin kuluttajan yleinen virheilmoitus säilyy;
yksityiskohtaisempi suljettu koodi kuuluu vain toimituskokeeseen.
Jos tämä ei ratkaise etenemistä, tulos ja vaihtoehdot käsitellään ennen
lisäkokeita. Vuorokauden säilytys ei anna lupaa salaamattomaan julkaisuun.
Toteutettu koodien välitys ja tarkka parseri läpäisivät 62/62 rajattua
tarkistusta ilman ohituksia. Mukana olivat todellinen puuttuvan apurin
käynnistysvirhe, apurin avainhylkäyksen välitys lopulliseen CLI-tulosteeseen,
normaalin virheilmoituksen säilyminen ja onnistunut salaus/purku.
Tämä paikallinen näyttö edelsi uutta hosted-koetta.
Hyväksytty yksi koe ajettiin revisiosta `b5c26c05`:
[ajo 36925953259](https://github.com/eky-software/eky/actions/runs/36925953259),
suoritusyritys 1, hylättiin vaiheessa `encryption` koodilla
`EVIDENCE_GPG_UNAVAILABLE`. Työkalujen ennakkotarkistus läpäisi; salattuja
liitteitä oli nolla. Purkua ei yritetty. Muita hyväksyntäajoja, MSI-asennusta
tai WPR-tallennusta ei käynnistetty. Kolmen yrityksen näyttö säilyy
erillisenä, ja keräyksen vahvistus poistettiin tämänkin hylkäyksen jälkeen.

Rajattu synteettinen regressio toisti saman koodin, kun `Get-Command git.exe`
palauttaa useita PATH-osumia. Ennakkotarkistus valitsi ensimmäisen osuman,
mutta salausapuri välitti koko tuloksen polunkäsittelyyn. Apuri korjattiin
valitsemaan ensimmäinen osuma ennakkotarkistuksen tavoin. Ei uutta
työkaluhakua, latausta, riippuvuutta tai salaamatonta fallbackia.
Regressio hylättiin ennen korjausta ja läpäisi korjauksen jälkeen myös
todellisen salaus/purku-ketjun; yhdistetty kohdesarja läpäisi 63/63 ilman
ohituksia. Tämä todistaa rajatun apurivirheen ja korjauksen, ei vielä sen
vastaavuutta hosted-hylkäykseen. Tässä vaiheessa neljättä hosted-koetta ei
ollut ajettu. Omistajalle esitettiin yksi enintään viiden minuutin synteettinen toimituskoe
korjatusta jäädytetystä revisiosta sekä onnistuneen liitteen yksityinen
purku ja sidonnan tarkistus. Ei automaattista uusintaa tai yleistä
diagnostiikkalaajennusta, jos tämäkin jää avoimeksi.

Toimituksen todentamistapa on [rajattu synteettinen toimituskoe](ci-encrypted-evidence.md#rajattu-toimituskoe)
olemassa olevan feasibility-workflow'n omana valintana. Se ei käynnistä
MSI:tä, WPR:ää tai uutta paketointia eikä korvaa normaalia hyväksyntää.
Alkuperäinen workspace-timeout ja aiempi vientivirhe pysyvät avoimina.
Tämän välitavoitteen sulkeminen ei itsessään sulje niitä, hyväksy normaalia
PR/main-kierrosta tai anna mergevaltuutta.

### Salatun toimituksen hyväksyntä

Omistaja hyväksyi yhden korjauksen todennuksen ja yksityisen purkutarkistuksen.
Jäädytetyn revision `f69f3d76aa463ea1e48f0b48d8d307d4588f81ad`
[ajo 36930438493](https://github.com/eky-software/eky/actions/runs/36930438493),
suoritusyritys 1, läpäisi. Ajon seuranta alkoi jonotuksessa ja jatkui
valmistumiseen; loki oli luettavissa jobin päätyttyä. Synteettinen jobi
kesti 41 sekuntia. Muut neljä jobia ohitettiin valinnan mukaisesti.

| Portti | Todennettu tila ja rajaus |
| --- | --- |
| Korjaus ja regressiot | Usean Git-osuman regressio hylättiin ennen korjausta samalla turvallisella virhekoodilla. Korjattu kohdesarja läpäisi 63/63 ilman ohituksia. Riippumaton rajatun muutoksen katselmus ei löytänyt estettä. |
| Hosted-salaus ja julkaisu | Tarkka checkout, työkalujen ennakkotarkistus, salaus, yhden nimetyn `.gpg`-liitteen upload ja julkaisuportti läpäisivät. Artifact `11195722296` syntyi yhden vuorokauden säilytyksellä. |
| Toimitus ja purku | Yksityinen lataus, artifactin tiiviste, purku tyhjennetyn salasanavälimuistin jälkeen sekä manifestin run/attempt/revision-sidonta, tiedostojoukko, tavut ja tiivisteet hyväksyttiin. Purkuagentin sulku varmennettiin erikseen. |
| Normaali kytkentä | Nykyisen workspace-kuluttajan prepare/start/stop/seal/upload-ketjun sopimustestit ja katselmus ovat mukana kohdesarjassa. Normaalia sovellus- tai MSI-ajoa ei tehty toimituskokeessa. |
| Tallennus, analyysi ja siivous | Synteettinen näyte ei käynnistä WPR:ää tai sovellusta. Sen tallennus- ja analyysitulokset ovat `skipped`, `captureClosed: false` ja callerin siivous `unverified`, eivät onnistuneeksi keksittyjä tuloksia. |

Rajattu salatun toimituksen välitavoite on suljettu yllä olevaan revisioon.
Kolme aikaisempaa hylkäystä säilyvät hylkäyksinä. Git-hakuvirheen paikallinen
syy ja korjauksen hosted-toimivuus on todennettu; vanhojen hylkäysten
puuttuvaa raakasisältöä ei ole palautettu. Tuotantokoodi, riippuvuudet,
aikarajat ja normaalin testin hyväksyntäehdot eivät muuttuneet.
Tämä ei sulje alkuperäistä workspace-timeoutia tai vanhaa vientivirhettä.

### Seuraava etenemispäätös

**Omistajan päätös 2.10.2026:** yksi jäädytetyn revision normaali
CI-hyväksyntäkierros salattu talteenotto käytössä on hyväksytty.
Samalla omistaja muutti tämän rajatun Goalin valmistumisehtoa: alkuperäinen
timeout jää avoimeksi seurantahavainnoksi, eikä valmistuminen enää edellytä
sen jälkikäteisen juurisyyn todistamista. Tämä uudempi päätös korvaa vain
historian ristiriitaisen jatko-/valmistumisehdon, ei kriittisiä testiehtoja.
Vikaa ei nimetä korjatuksi, infrastruktuurihäiriöksi tai ei-kriittiseksi
kehityspoikkeukseksi. Goalin valmistuminen vaatii uuden jäädytetyn revision
kaikki nykyiset pakolliset tarkistukset ja niiden todellisen kattavuuden.

Mahdollisen kierroksen kaikki nykyiset data-, turvallisuus-, sisältö-,
prosessi- ja siivousportit sekä aikarajat säilyvät. Ensivirhe säilytetään;
uusi hylkäys luokitellaan olemassa olevasta aineistosta, eikä kierroksia
toisteta vihreään asti. Toimituksen onnistuminen ei lupaa aineistoa runnerin
pakkokatkaisun jälkeen. Normaali kierros tarkoittaa nykyisen PR-haaran
päivityksen käynnistämiä `V2 risk-based CI`- ja `Dependency security`-ajoja,
ei erillistä lisädispatchia tai uutta MSI-diagnostiikkakokeiden sarjaa.
PR/main-integraatio, merge ja A1 eivät sisälly tähän päätökseen. Ennen
kierrosta kirjataan jäädytetty HEAD ja odotettu riskimatriisi; todellinen
PR-checkout varmennetaan ajosta. Seurannan omistaa pääagentti tai nimetty vain lukeva agentti;
salatut liitteet ladataan ja varmennetaan ennen vanhenemista.

### Aiemman timeout-tutkimuksen rajaus

Omistajan uusin tehtävänanto korvaa aikaisemman laajan Goal-luonnoksen
kokonaan. Nykyinen työ on revision `8913dc48` `packagedWorkspaceSuccess`
run 2:n aikakatkaisun selvitys, näytön perusteella tarvittava rajattu
testiharness-korjaus ja sen todennus. Aiemman V1/V2-kokonaisuuden hyväksytyt
tulokset ja jäljellä olevat integraatioportit säilyvät tämän sivun
historia- ja jatkotietona, eivät tämän tehtävän lisävaatimuksina.

V1 ja T3 pysyvät suljettuina, ellei niiden omaan sopimukseen löydy
konkreettista regressiota. Ensin erotetaan valmistelu, skenaarion suoritus,
tuloksen julkaisu, siivous ja CI:n pakkokatkaisu. Rajattu testiharness-
korjaus regressioineen kuuluu hyväksyntään; uusia riippuvuuksia,
tuotantomuutoksia tai tietosuoja-, arkkitehtuuri- ja hyväksyntäpoikkeuksia
ei ole tällä hyväksytty.

Valmistuminen vaatii esteen korjauksen, sen kohdetestit, tarvittavan oikean
paketin todennuksen ja katselmuksen. Lisälokitus tai onnistunut uusinta ei
yksin täytä ehtoa. Riittämätön näyttö raportoidaan täsmällisenä puutteena
ja seuraavana päätöksenä ilman automaattista laajennusta. PR/main-integraatio,
merge, A1 ja koko 0.3.0-julkaisu kuuluvat seuraaviin erillisiin vaiheisiin.

Ensimmäinen no-MSI-vientikoe päättyi
[käynnistimen ennakkotarkistukseen](#yksityisen-kertakokeen-valmisteluhylkäys).
Omistajan erikseen hyväksymä yksi korjattu koe samalla lähderevisiolla
[läpäisi tallennuksen ja vientianalyysin](#korjatun-yksityisen-kertakokeen-päätösraportti).
Aineisto säilytettiin ja varmennettiin paikallisesti
[hyväksytyn säilytysrajauksen](#yksityisen-vientiaineiston-säilytysehdotus)
mukaan. Rajattu vientitutkimus päättyy päätösraporttiin; kolmatta
diagnostista ajoa tai normaalia hyväksyntäkierrosta ei käynnistetä
automaattisesti. Alkuperäisen timeoutin valmistumisehto ei ole täyttynyt.
Playwrightin ensiyrityksen trace pysyy erillisenä työnä. Hyväksytyt V1- ja
T3-sopimukset eivät avaudu uudelleen.

### Lähtönäyttö ja uusinnan raja

Omistaja hyväksyi [yhteisen testauskäytännön](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus):
nykyinen virhetietoketju säilyy, enintään yksi hallittu uusinta sallitaan,
ja nimetty ei-kriittinen puute voi saada määräaikaisen kehityspoikkeuksen.
Uusinta ei yksin hyväksy testiä, eikä tässä myönnetä yksittäistä poikkeusta.
Kriittiset data-, turvallisuus-, sisältö- ja siivousportit säilyvät.

Tämän checkpointin lähde on `8913dc48e3103aed6c27e221e0b8483fbb70c40d`.
[Normaali PR-ajo 36785505567](https://github.com/eky-software/eky/actions/runs/36785505567),
yritys 1: 36 jobia läpäisi, kaksi valinnaista koetta ohitettiin,
`packagedWorkspaceSuccess` run 2 peruttiin jobin 30 minuutin enimmäisajan
täyttyessä ja koonti hylättiin. System 769/769, web 37/37 ja Electron 39/39
läpäisivät ilman retryä tai flakyä. Installer-/legacy-porttien läpäisy ja
[riippuvuustarkistuksen 36785505035](https://github.com/eky-software/eky/actions/runs/36785505035)
onnistuminen eivät korvaa puuttuvaa workspace-porttia tai mainin hyväksyntää.
Job-aikaraja kertoo katkaisun syyn, ei prosessin sisäistä juurisyytä.

Alkuperäisen yrityksen kokonaislokivienti saatiin talteen, mutta siitä
puuttuu juuri katkenneen työn loki; myös kyseisen jobin oma lokihaku
epäonnistui. Julkaistuissa artefakteissa on alkuperäinen workspace-paketti,
ei tämän kuluttajan lopputulosraporttia. Puuttuva aineisto ei todista,
ettei tulosta syntynyt runnerille. Valmistelun vaiheajat eivät osoita
komennon normaalin aikavarauksen kuluneen ennen sen käynnistymistä.
Viimeinen `descendantObserved` todistaa vain jälkeläisen havaitsemisen,
ei sen valmistumista, aktiivisen vaiheen nimeä tai jumittumisen syytä.

Seuraavan rajatun tutkimuksen kohde on vain tämän packaged-jobin
valmistuminen ja nykyisen tulos-/siivousaineiston säilyminen. Ensin
tarkistetaan olemassa oleva aineisto ja sen saatavuus; puuttuva loki tai
tulos merkitään puuttuvaksi. Jos tarvitaan uusinta, käytetään samaa
lähdettä ja samaa hyväksyntäpakettia tuoreessa eristetyssä ympäristössä,
nimetään seuranta sekä ensivirheen säilytys ja sovelletaan yhden uusinnan
rajaa. Muut lähteet tai uudet paketit eivät ole saman kokeen uusinta.
Tulos luokitellaan ennen seuraavaa korjausta; kriittisen polun tuntematonta
timeoutia ei nimetä infrastruktuurihäiriöksi tai poikkeukseksi.

Tätä varten nimetty ainoa diagnostinen uusinta kohdistuu alkuperäisen ajon
workspace-success run 2 -kuluttajaan ja sen automaattiseen koontiin, ei
produceriin tai koko matriisiin. Kysymys on, syntyvätkö muuttumattomasta
lähteestä ja alkuperäisestä paketista sidotut prosessi-, worker-, siivous-
ja caller-lopputulokset tuoreessa ympäristössä; muuten etsitään säilynyt
nimetty virheraja. Pääagentti vastaa aineistosta ja vain lukeva aliagentti
seurannasta. Alkuperäinen epäonnistuminen ja uusinta säilytetään erillisinä.
Nykyinen työnkulku ei takaa tulostiedostojen säilymistä pakkokatkaisussa;
tämä rajaa kokeen johtopäätöksiä.

### Rajatun uusinnan tulos

[Ajossa 36785505567, yritys 2](https://github.com/eky-software/eky/actions/runs/36785505567/attempts/2)
uusittiin vain workspace-success run 2 ja riippuvainen koonti. Molemmat
läpäisivät. Muiden jobien yritykseen kopioidut tulokset ovat alkuperäisen
kierroksen näyttöä, eivät uusia testisuorituksia; produceria ei rakennettu
uudelleen. Lähde pysyi `8913dc48`:ssa ja todellinen checkout
`fd1be0a33fb5887ba01e56a5df9244570c6ae95e`:ssä. Kuluttajan alku- ja
lopputarkistus vastasivat alkuperäistä artifactia `11129842041` sekä sen
descriptor- ja MSI-tiivisteitä. Kaikki 21 komentovaihetta, fixture-siivoaminen,
lopputuloksen julkaisu ja pakollisen caller-result-tarkistimen sisältävä
komentovaihe valmistuivat. Itse caller-result-tiedostoa ei ladattu; sen
tarkistus todennettiin muuttumattoman pakollisen verifierin ja jobin
vaihetuloksen kautta.

Tämä on diagnostisen uusinnan läpäisy, ei alkuperäisen syyn, korjauksen tai
infrastruktuurihäiriön todistus. Yhden uusinnan raja on käytetty. Rajattu
koodikatselmus ei osoittanut tulostuskohdetta odottavaa pääsäikeen
kirjoitusta tai deadline-kellon nollausta. Siitä ei seuraa, että kaikki
mahdolliset jumittumissyyt olisi suljettu pois. Sovellusta, harnessia,
riippuvuuksia tai aikarajoja ei muutettu tätä koetta varten.

Puuttuva tieto on alkuperäisen run 2:n viimeinen nimetty komentovaihe sekä
sen terminal-/siivoustila ja runnerin tila katkaisuhetkellä. Nykyiset neljä
vaiheriviä tai onnistunut sisarajo eivät palauta näitä tietoja. Seuraava
päätös tarvitaan, jos alkuperäistä lisänäyttöä ei ole saatavilla: rajataanko
erillinen havaintokoe olemassa oleviin välineisiin ja puuttuvaan
katkaisutilaan. Toista muuttumatonta uusintaa, uutta diagnostiikkakehystä,
hyväksyntäpoikkeusta tai mergeä ei käynnistetä tämän tuloksen perusteella.
Nykyisen korjaustehtävän valmistumisehto ei ole täyttynyt.

Rajattu lähdetarkistus täsmensi seuraavan kokeen päätösrajaa. Nykyinen
`windows-acceptance-supervisor-feasibility.yml` hylkää `inspector_capture`-
valinnan workspace-success-kuluttajalle. Myös nykyinen
`Read-LegacyCommandTrace`-lukija sitoo komentohavainnon vain legacyyn tai
nimettyyn workspace-fault-skenaarioon; pelkkä workflow-valitsimen avaaminen
ei riitä. Tallennuksen pysäytys ja analyysi ovat komennon jälkeisiä askelia,
joten koko jobin pakkokatkaisun jälkeistä aineiston saantia ei ole tällä
todistettu. Uuden kokeen pitää ensin osoittaa nykyisillä välineillä, että
nimetty komentovaihe, prosessihavainto ja tiedon saatavuus säilyvät myös
hallitussa katkaisussa. Tämän jälkeen voidaan päättää yhdestä erillisestä
oikean paketin havaintokokeesta. Tämä ei hyväksy uutta keräys- tai
julkaisurajaa, lisäuusintaa tai aikarajojen muuttamista. Kokeen normaali
läpäisy ei yksin sulkisi alkuperäistä timeoutia.

Nykyisestä `8913dc48`-lähteestä tarkistettiin tämän jälkeen kahdeksan
olemassa olevaa kohdetestiä: workspace-success-komennon `scenarioHold` ja
`blockedEvidence`, supervisorin estetty tulostus jälkeläisen jäädessä
odottamaan sekä viisi vaihe-/virhetiedon projektiotestiä. Kaikki läpäisivät
ilman uusintaa tai ohitusta. Hallittu jumitus tuotti odotetun virhetuloksen
ja varmennetun prosessisiivouksen; lokitulostuksen esto ei estänyt
komennon valmistumista. Sovellusta tai MSI-pakettia ei asennettu, eikä
lähdekoodia, aikarajoja tai riippuvuuksia muutettu.

Tämä näyttö rajaa seuraavan kokeen kysymystä, ei sulje alkuperäistä vikaa:

| Tilanne | Nykyinen näyttö ja sen raja |
| --- | --- |
| Worker jää odottamaan, supervisor toimii | Hallittu fixture tuottaa `deadlineExceeded`-tuloksen, säilyttää alkuperäisen virheen ja todistaa oman puun siivouksen. Fixturen lyhyt koeaika ei ole varsinaisen packaged-ajon aikaraja. |
| Lokitulostus estyy, supervisor toimii | Kohdetestit todistavat komennon poistumisen ja tiedostomuotoisen lopputuloksen. Ne eivät todista konsolirivien saapumista GitHubiin. |
| Komento tai koko CI-job katkaistaan ulkopuolelta | Edelliset kohdetestit eivät kata tätä. Erillinen nykyinen supervisorin tappotesti odottaa puuttuvaa terminal-tulosta; sen eloon jäävä testiprosessi ei vastaa koko jobin katoamista. |
| Supervisorin oma suoritus ei etene | Alkuperäisestä ajosta puuttuu tämän erottava havainto. Worker-hold tai onnistunut uusinta ei yksilöi estävää kutsua eikä osoita runnerin kuormitusta syyksi. |

Mahdollinen seuraava havaintokoe tarvitsee ensin todennetun ketjun
komentoaskelen hallitusta katkaisusta nykyisen tallentimen pysäytykseen ja
suljettuun raporttiin. Pelkkä parserin workspace-success-tuki tai
onnistuvan komennon tallennus ei riitä. Koko runnerin katoaminen jää tämänkin
ketjun rajaukseksi; puuttuvaa tallennetta ei tulkita siivoustodisteeksi.
Oikean paketin uusi ajo edellyttää erillistä nimettyä päätöstä, koska
alkuperäisen hylkäyksen ainoa diagnostinen uusinta on jo käytetty.

### Hyväksytty katkaisukoe

Omistaja hyväksyi 1.10.2026 pienimmän jatkon: yhden ilman MSI-asennusta
tehtävän tallennuksen katkaisukokeen nykyisellä, jo tuetulla
legacy-contract-fixture-polulla.
Komentoaskel keskeytetään hallitusti runnerin jäädessä toimintaan; tuloksesta
vaaditaan sallittu vaihe-/prosessihavainto, puuttuvan terminal-tuloksen
luokitus, aineiston saatavuus ja tallentimen siivoustila. Tämä ei vielä
laajenna tallennusta workspace-success-polkuun tai hyväksy uutta oikean
paketin ajoa. Jos jälkikeräys ei toteudu, koe jää siltä osin puutteelliseksi
eikä sitä uusita automaattisesti. Raaka-aineiston nykyinen yksityisyysraja
säilyy.

Koe käyttää olemassa olevan feasibility-workflow'n erillistä
`inspector-cutoff-diagnostic`-valintaa ilman matriisia. Nykyinen
`scenarioHold`-fixture ja komennon normaalit aikavaraukset säilyvät;
vain kokeen CI-komentoaskelen yhden minuutin katkaisu injektoi vian.
Katkaisuaskel saa jatkaa jälkikeräykseen virheestä huolimatta, mutta
normaalien hyväksyntätestien ehtoja ei muuteta. Katkaisun pitää näkyä
CI:n omassa vaihehavainnossa: pelkkä epäonnistunut komento ei todista
odotettua injektiota.

Kohdetarkistus vaatii edeltävien vaiheiden nykyisen sidotun ketjun,
`scenario`-vaiheen valmistelun, puuttuvan scenario- ja caller-lopputuloksen
sekä myöhempien vaiheiden puuttumisen. Tallentimen nykyisen jälkianalyysin
pitää havaita erikseen komento ja scenario-worker; valmisteltu pyyntö
ei yksin todista workerin käynnistymistä. Tallentimen pysäytys ja sen
mahdollinen hylkäys säilytetään erillään testikomennon siivouksesta.
Molempien prosessihavaintojen `cleanup: notInferred` ja
`cause: notEstablished` säilyvät myös nähtyjen poistumisten jälkeen.
Synteettinen hold ei tuota oikean MSI-inspektorin tapahtumia. Niiden
puuttumisen vuoksi hylätty jatkoanalyysi ei saa hävittää jo saatua
prosessihavaintoa eikä muuttua kokonaisanalyysin läpäisyksi.

Valmisteluun kuuluvat suljetun raportin, sidonnan, paikallisen omistetun
komennon katkaisun, workflow-rajauksen ja katkenneen trace-havainnon
regressiot sekä riippumaton katselmointi. Paikallinen prosessikatkaisu
ei korvaa yhtä nimettyä CI-komentoaskelen koetta. Aineisto säilytetään
eikä puuttuvan siivoustodisteen perusteella poisteta tutkimusjuuria.
Koe ei todista koko jobin tai runnerin katoamisen jälkeistä keräystä,
workspace-success-polun tallennustukea tai alkuperäistä juurisyytä.
Uutta oikean paketin ajoa ei ole tällä hyväksytty.

### Katkaisukokeen tulos

Revision `709c27fb` [yksi koe 36854893331](https://github.com/eky-software/eky/actions/runs/36854893331),
suoritusyritys 1, todensi komentoaskelen yhden minuutin aikakatkaisun
GitHubin omasta merkinnästä. Tallennus käynnistyi ennen komentoa ja sen
pysäytys valmistui katkaisun jälkeen. Sidottu vaiheketju jäi `scenario`-
vaiheeseen: caller- ja scenario-lopputulos puuttuivat eikä myöhempiä
vaiheita ollut. Nykyinen jälkianalyysi säilytti komennon ja seitsemän
worker-vaiheen havainnot, myös kesken jääneen scenarion. Havaitut
poistumiset eivät muuttaneet `cleanup: notInferred`- tai
`cause: notEstablished`-luokitusta.

Jobin kokonaislopputulos on **hylätty**, ei hyväksyntätestin läpäisy.
Synteettinen koe ei tuottanut MSI-inspektorin tapahtumia: providerin
puuttuminen ja nollamäärä todettiin, ja viimeinen analyysi hylättiin
`eventRead / INSPECTOR_TRACE_EVENTS_MISSING`-rajalla. Jo julkaistut
prosessi- ja vaihehavainnot säilyivät tästä huolimatta. Tämä on
katkaisun jälkeisen havaintoketjun rajattu todiste, ei kokonaisanalyysin,
testikomennon siivouksen tai alkuperäisen workspace-vian korjauksen
todistus. Raakajälkeä ei julkaistu artifactina; säilyminen tässä
tarkoittaa runnerilla jälkianalyysiin asti säilymistä, ei pysyvää arkistoa.

Valmistelun viisi fixture-/workflow-testiä, kolme trace-kohdetestiä ja
49 viereistä workflow-regressiota läpäisivät. Riippumaton katselmointi
havaitsi uuden analyysiaskeleen tulostuspuskuroinnin riskin. Se korjattiin
ennen CI-koetta välittömäksi suljettujen rivien tulostukseksi, neljä
muuttuneen rajauksen kohdetestiä läpäisi ja uusintakatselmointi hyväksyi
korjauksen. Dokumenttilinkit tarkistettiin. Kokeen sovelluskoodi,
riippuvuudet ja normaalien hyväksyntätestien ehdot eivät muuttuneet.

Katkaisukokeen jälkeinen erillinen päätös koski nykyisen tallennuslukijan täsmällistä
workspace-success-rajausta ja yhtä nimettyä havaintoajoa alkuperäisen
paketin tavuilla. Tämä ei ole uusi muuttumaton uusinta, vaan eri
tutkimuskysymys; kerättävä tieto ja normaaleista aikarajoista erillinen
keräyksen raja pitää määrittää ennen ajoa. Tästä kokeesta ei seuraa lupaa
ajaa uutta pakettikoetta, muuttaa aikarajoja tai avata T3:a uudelleen.
Alkuperäinen aikakatkaisu ja nykyisen Goalin korjaus-/todennusehto
pysyvät avoimina. Omistaja hyväksyi tämän rajatun jatkon seuraavasti.

### Hyväksytty workspace-success-havaintokoe

Omistaja hyväksyi 1.10.2026 nykyisen tallennuslukijan täsmällisen
workspace-success-kytkennän, kohderegressiot ja yhden nimetyn havaintoajon.
Kysymys on, mihin komentovaiheeseen alkuperäisen paketin suoritus etenee
ja mitä vaiheprosessien elinkaarista havaitaan mahdollisen katkaisun yli.
Tämä ei ole toinen muuttumaton uusinta tai alkuperäisen vian korjausväite.

- Käytetään alkuperäisen ajon `36785505567` artifactia `11129842041`,
  sen build-revisiota `fd1be0a33fb5887ba01e56a5df9244570c6ae95e` ja
  alkuperäistä descriptor-sidontaa. MSI-tavut varmennetaan ennen ja jälkeen;
  produceria tai sovelluspakettia ei rakenneta uudelleen.
- Nykyinen feasibility-workflow saa workspace-successille nimenomaisen
  lukijavalinnan. Komentotunnus, nykyinen vaihebudjetti ja worker sidotaan
  täsmällisesti. Ristiriitaiset valinnat ja epäselvä prosessi-identiteetti
  hylätään. Kesken jäänyt vaihehistoria ei saa muuttua cleanup-todisteeksi.
- Vain tallentavan workspace-diagnostiikkajobin kokonaisraja on 38 minuuttia,
  aiempi 30 minuuttia ja kahdeksan minuutin havaintovaraus. Tallentimen
  aloitus saa yhden minuutin, pysäytys kaksi, artifactin jälkivarmennus
  kaksi ja analyysi kolme. Nykyinen 25 minuutin komentoaskel, sisäiset
  työ-/siivousrajat sekä normaalit hyväksyntäworkflowit säilyvät.
  Jäljelle jäävä viiden minuutin valmisteluvara on yhteinen, ei erikseen
  pakotettu määräaika. Sen ylittäminen voi pienentää jälkikeräyksen
  käytettävissä olevaa aikaa; 38 minuuttia ei ole valmistumistakuu.
- Pysäytys ja analyysi yritetään myös komentoaskelen epäonnistuessa;
  havainnot välitetään ilman koko analyysin valmistumista odottavaa
  tulostuspuskurointia. Koko jobin tai runnerin katoaminen voi edelleen
  estää jälkikeräyksen. Tämä ei lupaa raakajäljen pysyvää arkistointia.
- Raw ETL, CSV, komentorivit, polut ja tunnisteet jäävät runnerin nykyiseen
  yksityiseen tallennusjuureen. Julkaistaan vain nykyiset suljetut luokat.
  Ei uusia artifact-upload-polkuja tai epävarman tutkimusjuuren poistamista.
- Pääagentti vastaa revision, pakettisidonnan ja lopputuloksen varmennuksesta;
  vain lukeva aliagentti seuraa yhtä nimettyä ajoa. Ensivirhe, aiempi uusinta
  ja tämä havaintokoe pysyvät erillisinä. Jos vika ei toistu tai näyttö jää
  puutteelliseksi, tulos raportoidaan ilman automaattista uutta pakettiajoa.

Valmistelun portti on rajattujen lukija-/kytkentätestien ja katselmuksen
läpäisy ennen yhtä CI-ajoa. Sovellusta, tietokantaa, riippuvuuksia,
prosessien omistajuutta tai hyväksyntäehtoja ei muuteta. Havaintokoe ei
itsessään sulje Goalin korjaus-/todennusehtoa.

### Workspace-success-havaintokokeen tulos

[Ajo 36859203193](https://github.com/eky-software/eky/actions/runs/36859203193),
yritys 1, käytti lähde- ja checkout-revisiota
`bb81e650f56f69dd364c88ec29fb813a6413d33f`. Alkuperäinen artifact
`11129842041`, build `fd1be0a33fb5887ba01e56a5df9244570c6ae95e`,
descriptor ja molempien MSI-tiedostojen tavut täsmäsivät ennen ja jälkeen.
Pakettia ei rakennettu uudelleen. Ennen ajoa kytkennän regressiot läpäisivät
50/50, lukijan regressiot 25/25 ja dokumenttilinkit 140/140. Riippumaton
katselmus ei löytänyt korjattavaa. Testien luonnosvaiheen virheelliset
odotukset korjattiin; niiden epäonnistuneet ajot säilytettiin.

Varsinainen workspace-success-komento ja pakollinen tulosverifier läpäisivät.
Kaikki 21 komentovaihetta, vastaavat prosessipuun poissaolon tarkistukset,
fixture-siivoaminen ja tuloksen julkaisu valmistuivat. Komennon kesto oli
noin 3 min 36 s. Tämä osoittaa tämän kokeen onnistuneen sovelluspolun,
ei alkuperäisen timeoutin syytä tai korjausta.

Tallennuksen aloitus ja pysäytys läpäisivät, mutta jälkianalyysi epäonnistui
`commandExport / INSPECTOR_CAPTURE_TOOL_FAILED`-rajalla, työkalukoodi
`-2147023504`. Myös erillinen tapahtumatilaston luku palautti työkalun
virheen. Uusi lukija ei saanut prosessitaulukkoa eikä yhtään ulkopuolista
`commandLifetimeAnalysis`-havaintoa syntynyt. Virhekoodi ei yksin osoita,
miksi vientityökalu ei pystynyt lukemaan tallennetta. Analyysin virhettä
ei tulkita uudeksi sovellus-, MSI- tai supervisor-timeoutiksi. Koko
diagnostiikkajobin tulos säilyy epäonnistuneena.

Raaka-ETL:ää tai työkalujen yksityisiä virhetulosteita ei julkaistu, joten
niitä ei ole saatavilla päättyneen runnerin jälkeen. Talteen saatiin
julkaistu rajattu virhetieto ja ajoloki. Alkuperäinen jumitus ei toistunut;
sen katkaisuvaihe, juurisyy ja korjaus ovat yhä todentamatta. Hyväksytty
yksi havaintoajo on käytetty eikä uutta käynnistetä automaattisesti.
Seuraava päätös koskee juuri puuttuvan vientihavainnon hankintatapaa ja
mahdollista säilytysrajaa, ei uutta testialustaa tai hyväksyntäpoikkeusta.

### Tutkimuspaketin päätösraportti

Omistajan tarkennuksen mukainen jälkitarkistus tehtiin 1.10.2026 ilman
uutta testi-, tallennus- tai MSI-ajoa. Tutkimuspaketti päättyy tähän
päätösraporttiin, ei alkuperäisen timeoutin korjausväitteeseen tai Goalin
valmistumiseen. PR #282 on edelleen avoin; sen lähde `8913dc48`,
hyväksytty main `0389026e` ja erillisen kokeen lähde `bb81e650` eivät ole
sama integraationäyttö.

| Tarkistettava asia | Havaintokokeen näyttö ja sen raja |
| --- | --- |
| Sovelluspolku | Komento, pakollinen verifier ja 21 komentovaihetta läpäisivät. Ei alkuperäisen aikakatkaisun korjaustodiste. |
| Prosessisiivous | 21 `processTreeAbsent`-havaintoa ja verifierin siivousehdot läpäisivät. Koskee testin omistamia prosesseja, ei kaikkia runnerin prosesseja tai alkuperäistä katkennutta ajoa. |
| Asennuksen ja tietojen lopputila | Verifier vaatii muun muassa `exactProductsAbsent`, `installerFootprintAbsent`, `businessDataPreserved` ja workspace-semanttiikan hyväksynnän. Todiste on muuttumattoman verifierin läpäisy; raakaa caller-result-tiedostoa ei saatu erilliseen jälkilukuun. |
| Testattavan paketin tavut | Alku- ja lopputarkistuksen artifact-sidonta täsmäsi. Tämä ei ole ETL-tallenteen eheystarkistus. |
| Tallennus | Aloitus ja pysäytys läpäisivät. Jäljen luettavuus ja kattavuus jäivät varmentamatta. |
| Analyysi | Tapahtumatilaston vienti ja `commandExport` epäonnistuivat työkalussa ennen komentolukijaa. Diagnostiikkajobi pysyy hylättynä; tästä ei seuraa sovellustoiminnon hylkäystä tai alkuperäistä timeoutia. |

Ajantasainen artifact-luettelo palautti nolla artefaktia. Säilytetyn tämän
ajon tutkimusaineiston luettelossa on ajolokit, metatiedot ja aiempi
tulosvarmennus, ei ETL:ää eikä työkalun yksityisiä stdout/stderr-tiedostoja.
Ajolokin eheys ja suljetut vaihetulokset tarkistettiin uudelleen. Saman
ETL:n jatkoanalyysi ei ole käytettävissä näistä lähteistä. Puuttuvia
tiedostoja ei korvata uudella MSI-ajolla.

Stderr oli yhteenvedon mukaan olemassa, mutta nykyiset sallitut viestiluokat
eivät tunnistaneet sen sisältöä. Tämä ei tarkoita tyhjää virhetulostetta.
Numerokoodi tai staattinen tarkistus eivät osoittaneet vientivirheen syytä.
[Aiempi saman vientirajan tutkimus](windows-installer-acceptance-harness-v2.md#historiallinen-epäonnistuminen-ja-sitä-seurannut-diagnoosi)
sisältää jo `commandExport`-virheen raportointikytkennän korjauksen;
sitä ei tehdä uudelleen.

**Yksi jatkoehdotus, ei vielä ajolupa:** nykyinen
`inspector-analysis-diagnostic` ja `productInspectionNativeHold`-fixture
ilman MSI-asennusta käyttävät samaa tallennus-, pysäytys-, tapahtumatilasto-
ja komentovientiketjua. Ennen yhtä koetta on sovittava yksityinen kohde,
valtuutettu lukija ja säilytysaika pysäytetylle ETL:lle identiteetteineen
sekä molempien vientikutsujen paluukoodeille ja stdout/stderr-tulosteille.
Näin samaa uutta tallennetta voisi tutkia ilman asennuksen uusimista.
Tallentimen pysäytys ja fixturen siivous säilyvät erillisinä tuloksina.
Nykyinen päättyvän runnerin temp-kansio ei täytä tätä säilytystarvetta;
julkista raakajälki-uploadia ei lisätä.

No-MSI-kokeen nykyinen analyysiaskel puskuroi tulostuksen komennon paluuseen
asti. Sen mahdollinen katkaisu ja aineiston saatavuus on huomioitava ennen
ajopäätöstä; tämä ei selitä nyt tutkittua workspace-kokeen vientivirhettä.
Ilman ratkaistua yksityistä luku- ja säilytysreittiä koetta ei käynnistetä
muuttumattomana. Uusi läpäisy osoittaisi vain uuden tallenteen luettavuuden;
hylkäys antaisi tutkittavan vientivirheen. Kumpikaan ei yksin ratkaise
alkuperäistä workspace-timeoutia eikä anna lupaa automaattiseen uusintaan.

**Normaalin hyväksynnän avaaminen:** tämä näyttö ei vielä anna nykyisten
sääntöjen mukaista perustetta uudelle hyväksyntäkierrokselle esteen
sulkemiseksi. Ensin tarvitaan näytöllä rajattu korjaus ja sen todennus tai
näyttö testin ulkopuolisesta infrastruktuurihäiriöstä. Sen jälkeen nimetään
normaali kierros jäädytetystä revisiosta sen omille paketeille kaikkine
kriittisine portteineen. Diagnostiikan läpäisy ei ole tämän korvike.
Dokumenttimuutos ei nollaa käytettyä uusintarajaa eikä luokittelematonta
kriittistä timeoutia siirretä ei-kriittiseksi kehityspoikkeukseksi. Ilman
tätä näyttöä hyväksyntäeste pysyy avoimena; uutta yleistä
diagnostiikkakerrosta tai T3/V2-omistajuustyötä ei aloiteta.

### Yksityisen vientiaineiston säilytysehdotus

**Nykytila: ensimmäinen ajo päättyi valmistelun ennakkotarkistukseen.
Erikseen hyväksytty korjattu kertakoe läpäisi no-MSI-vientiketjun;
[päätösraportti](#korjatun-yksityisen-kertakokeen-päätösraportti) erottaa
sen alkuperäisestä timeoutista. Käynnistin on jälleen poistettu käytöstä.
Alla olevat ehdot kuvaavat toteutettua kertakoetta, eivät jatkuvaa ajolupaa.**
Omistajan uusin ajopäätös sallii kertakokeen nykyisillä tilin oikeuksilla
maksuttoman käytön rajoissa. Kiintiön täyttyminen saa estää ajon; se ei
oikeuta maksulliseen ylitykseen, laskutusmuutokseen tai uuteen yritykseen.
Puuttuvaa kiintiö- tai oikeustietoa ei merkitä varmennetuksi. Nykyisen
kirjautumisen oikeuksia ei laajenneta automaattisesti. Tämä ei ole pysyvä
yksityinen CI-kanava eikä muuta normaalien julkisten testien ajopaikkaa.
Tarkoitus on saada yhden uuden no-MSI-kokeen alkuperäinen vientivirhe ja
sama pysäytetty ETL myöhemmin luettaviksi. Vanhan ajon puuttuvaa aineistoa
ei tällä palauteta eikä alkuperäistä timeoutia suljeta.

| Vaihtoehto | Arvio tähän kokeeseen |
| --- | --- |
| Nykyinen julkinen CI ja runnerin temp | Ei säilytä luettavaa raakavirhettä runnerin poistumisen yli. Muuttumaton koe toistaisi tämän puutteen. |
| Paikallinen koe | Aineisto pysyisi yksityisenä, mutta eri ympäristön onnistuminen ei selittäisi hosted-vientivirhettä. Ei ensisijainen uusi tallennus. |
| Salattu artifact julkisessa CI:ssä | Vaatisi erillisen avain-, salaus-, purku- ja julkaisupäätöksen. Julkinen salateksti ei ole käyttöoikeuksilla rajattu säilytyspaikka; sitä ei hyväksytä tässä ehdotuksessa. |
| Erillinen yksityinen diagnoosirepo | Suositus: GitHubin nykyinen artifact-palvelu ja käyttöoikeusraja, yksi käsin käynnistettävä koe. Ei uutta salauskehystä tai julkiseen workflow'hun lisättävää yksityisen kohteen kirjoitustunnusta. |

**Kohde ja oikeudet.** Hyväksytty kohde on projektin omistajan
henkilökohtaisen GitHub-tilin uusi yksityinen diagnoosirepo, ei julkisen EKY:n
fork tai koko historian kopio. Siihen tulee vain tämän kokeen käynnistin;
varsinainen testikoodi luetaan julkisesta EKY-reposta jäädytettyyn revisioon
sidottuna. Lähtökohta on `bb81e650f56f69dd364c88ec29fb813a6413d33f`.
Mahdollinen alla rajattu vientituloksen talteenotto katselmoidaan ja
testataan ennen uuden lähderevision jäädyttämistä; alkuperäistä revisiota
ei tällöin väitetä muuttumattomaksi. Ei lennossa sovellettavaa piilopatchia.
Käynnistimen revisio ja testikoodin checkout kirjataan erikseen.
Nykyisen EKY-repon näkyvyys, PR ja normaalit työnkulut eivät muutu.

Ennen raakakeruuta varmennetaan kohteen `private`-tila, omistaja ja suorat
collaborator-oikeudet. Sovellus- ja token-oikeuksien tarkistuksen kattavuus
kirjataan yksityiseen ennakkotarkistukseen; uusimman ajopäätöksen mukainen
käyttö nykyisillä oikeuksilla ei todista täydellistä oikeusinventaariota.
Tavoite on vain omistajan
pääsy ja hänen tässä tehtävässä valtuuttamansa paikallinen lukija;
GitHub säilyy palveluntarjoajana. Yksityinen repo ei ole päästä päähän
salattu arkisto. Organisaation periytyviä lukuoikeuksia ei oleteta
owner-only-oikeuksiksi eikä organisaation yhteisiä asetuksia muuteta.
Jos kohteen yksityisyyttä, omistajaa tai suoria käyttäjäoikeuksia ei pystytä
varmentamaan, raakakeruuta ei aloiteta.

**Ajo ja aineisto.** Käynnistin käyttää vain nykyisen
`inspector-analysis-diagnostic`-polun `productInspectionNativeHold`-fixtureä,
samoja täsmäkiinnitettyjä checkout-, setup- ja artifact-actioneita sekä
nykyisiä Node- ja .NET-valmisteluja. Ei MSI-buildiä, asennusta, varsinaisen
sovelluksen käynnistystä, uusia kirjastoja tai testin sisäisten aikarajojen
muutosta. Ei PR-/push-/ajastettua laukaisua, automaattista uusintaa tai
vapaasti valittavaa lähderevisiota. Workflow-tokenin oikeudet minimoidaan;
henkilökohtaista pitkäikäistä tokenia ei siirretä testiin.

- Pysäytetty `capture.etl` ja sen kokoon ja SHA-256:een sidottu manifesti
  säilytetään ennen vientianalyysiä erillisenä yksityisenä artifactina.
  Manifesti erottaa capture-stop-tuloksen, fixturen tuloksen ja siivouksen.
  Puuttuva tai varmentamaton jälki merkitään puutteeksi, ei ehjäksi jäljeksi.
  Onnistunut ensimmäinen siirto on vientikokeen edellytys. Pelkkä ETL:n
  olemassaolo ei korvaa nykyistä varmennettua `stopped`-tilaa.
- Analyysin jälkeen säilytetään vain nimetyt `event-statistics`- ja
  `command-export`-stdout/stderr-tiedostot ja yksityinen metatietotiedosto,
  joka sitoo tiedostot kokeeseen, kokoon, tiivisteeseen ja tulokseen.
  Raakoja PowerShell-poikkeusten failure-tiedostoja ei sisällytetä.
  Kummankin kutsun paluukoodi tai sen puuttuminen erotetaan analyysiskriptin
  lopputuloksesta. Nykyiset rajatut
  vaihehavainnot välitetään heti, ei vasta koko analyysin palautuessa.
  Vientihylkäys ei estä säilytysaskelen yrittämistä.
- Ei koko temp-juuren, käyttäjäprofiilin, ympäristömuuttujien, credential-
  tiedostojen tai muiden testien aineiston kopiointia. Tulosteen sisältöä
  ei tulosteta ajolokiin. Koko- ja polkurajat sekä tiedostokohtainen
  saatavuus tarkistetaan; puuttuva tai osittainen aineisto jää näkyviin.
  Tämän kertakokeen siirtovalmistelun rajat ovat ETL:lle 256 MiB,
  ensimmäiselle aineistoerälle yhteensä 270 MiB ja vientitulosteiden erälle
  129 MiB. Manifestien kanssa valmisteltujen tiedostojen yhteismäärä on
  alle 400 MiB ennen artifact-palvelun pakkausta ja sen lisätietoja.
  Nykyisen tallentimen omaa kokorajaa ei muuteta. Ylisuuri tai muuten
  varmentamaton tiedosto jää siirron ulkopuolelle ja näkyy puutteena;
  rajaa ei nosteta tai koetta uusita automaattisesti. Nämä ylärajat eivät
  todista maksuttoman kiintiön riittävyyttä.
- Paikallinen lukija lataa aineiston nykyiseen Gitistä ohitettuun
  tutkimusalueeseen erilliseen repo/run/attempt-kansioon. ETL:n identiteetti
  varmennetaan ennen lukuja ja niiden jälkeen. Uusi yritys ei korvaa vanhaa.
  Omistajaa tai konetta yksilöiviä polkuja ei kirjata tähän dokumenttiin.

Hyväksytty täydennys säilyttää nykyisen poikkeuksen lisäksi näiden kahden
vientikutsun aloitusyrityksen ja prosessikahvasta havaitun poistumisen
tiedostossa. Toteutus pysyy nykyisessä kutsujassa, varsinaisen testin ja
tallennuksen jälkeen. Metatiedon kirjoitusvirhe ei korvaa vientitulosta.
Tuntematon poistuminen jää tuntemattomaksi; tiedoston olemassaolo tai
analyysin onnistuminen ei korvaa havaittua native-paluukoodia.
Fixturen olemassa olevat caller-/vaihetulokset säilytetään erillisinä
nykyisen tulosskeeman mukaisina tiedostoina vain kyseisen kokeen
validoiduista juurista. Tämän tarkka tiedostovalikoima varmennetaan
toteutuskatselmuksessa; trace ei yksin todista tai säilytä prosessisiivousta.

**Säilytysaika.** Hyväksytty aika on GitHub-artifacteille seitsemän vuorokautta.
Pääagentti lataa ja varmentaa aineiston heti sen valmistuttua; ensimmäisen
vaiheen ETL ladataan jo ennen koko jobin päättymistä, jos palvelu ja
seuranta sen mahdollistavat. Paikallinen aineisto tarkistetaan viimeistään
14 vuorokauden kuluttua: ratkaistun ja varmennetusti siivotun kokeen
raakakopiot poistetaan hyväksytyn säilytyspäätöksen mukaan, mutta avoimen
virheen tai varmentamattoman siivouksen ainoaa aineistoa ei poisteta
automaattisesti. Tällöin pyydetään säilytyksen jatkopäätös.
Rajattu turvallinen tulosraportti säilyy. Tämä ei lisää yleistä ajastinta
tai piilotettua varmuuskopiointia. Kokeen käynnistin poistetaan käytöstä
yhden ajon jälkeen; repositoryn poistaminen on erillinen päätös.

**Rajat ja ennakkotodennus.** Kertakoe saa kuluttaa vain maksutonta kiintiötä;
kiintiön määrän tarkistuksen kattavuus ja ajon kustannusrajan peruste
kirjataan yksityiseen ennakkotarkistukseen. Maksullista käyttöä tai
laskutusasetusten muutosta ei hyväksytä. Yksityisen standardi-Windows-runnerin resurssit
poikkeavat julkisesta runnerista. Siksi koe koskee vientiketjun luettavuutta,
ei alkuperäisen timeoutin suorituskykyvertailua. Uusi onnistuminen ei
todista vanhaa ETL:ää ehjäksi tai vikaa korjatuksi.

Katselmuksessa ja pienissä kytkentätesteissä todennetaan täsmällinen
lähdesidonta, yksityisen kohteen pakko, tiedostovalikoima, ensiaineiston
erillisyys ja säilytys myös analyysin epäonnistuessa. Testi-, capture-stop-,
cleanup-, analyysi- ja siirtotulos säilyvät erillisinä. Mahdollinen
vientiprosessin pakkokatkaisu ei saa näyttää normaalilta poistumiselta tai
valmiilta tulosteelta. Runnerin katoaminen tai koko jobin katkaisu voi silti
estää jälkiaskelet; täydellistä säilymistä ei luvata. Siirroille varataan
enintään kolme minuuttia kummallekin ja vain tämän kertakokeen jobille
enintään 20 minuuttia; nykyiset 1/2/2/3 minuutin tallennus-, fixture-,
pysäytys- ja analyysirajat sekä sisäiset testibudjetit säilyvät. Tämä on
säilytys-/jälkikäsittelyvara, ei normaalin hyväksynnän timeout-muutos.
Jos aineiston saatavuus jää puutteelliseksi, pysähdytään päätösraporttiin.

**Valmistelun checkpoint 1.10.2026.** Rajatun vientimetadatan regressiot
läpäisivät 21/21 ja nykyisen vientiketjun regressiot 25/25. Metadatatesti
on kytketty nykyiseen legacy-core-testikomentoon. Kertakokeen yksityisen
talteenottimen testit läpäisivät 16/16 ja käynnistimen sopimus- sekä
PowerShell-rakennetarkistukset 15/15, ilman ohituksia. Käynnistimen
ensitarkistus paljasti kaksi puuttuvaa native-paluukoodin tarkistusta;
ne korjattiin ennen tulosteen vertailua ja ensimmäinen hylkäys säilytettiin.
Talteenottimen katselmuksessa löydetyt rajatapaukset korjattiin ja
todennettiin regressioilla: vain säilytetty kopio kelpaa tulostodisteeksi,
puutteellinen fixture tai metadata näkyy erikseen ja polku-alias hylätään
ennen kirjoituksia. Vientivirhe ja aineiston täydellinen säilyminen voivat
olla samanaikaisia tuloksia; säilymisen vihreys ei hyväksy analyysiä.

Tämä checkpoint on työpuun rajattu ennakkotodennus, ei hosted-kokeen, alkuperäisen
timeoutin tai normaalin hyväksyntäkierroksen tulos. Kertakokeen käynnistin
ja raaka-aineiston talteenotin pidetään julkisen EKY-lähteen ulkopuolella.
Checkpointin jälkeen lähde ja käynnistin jäädytettiin yhtä hyväksyttyä
ajoa varten; sen tulos on alla. Kiintiöstä estynyttä ajoa ei kierretä. Riippuvuudet,
sovelluskoodi, nykyiset prosessiomistajat ja tavalliset hyväksyntäportit
eivät muuttuneet.

Lähteet: [artifactien lukuoikeus](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts),
[artifactin säilytysaika](https://github.com/actions/upload-artifact#retention-period),
[yksityisen CI:n kiintiöt](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
ja [runnerien resurssierot](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

### Yksityisen kertakokeen valmisteluhylkäys

Yksi hyväksytty ajo käytti julkista lähderevisiota
`068aba187a84cd1d29e26a4432252785c97ae9f8` ja erikseen jäädytettyä
yksityistä käynnistintä. Ajo päättyi ennakkotarkistuksen
`PRIVATE_EXPORT_PROBE_SOURCE_OR_SDK_INVALID`-hylkäykseen ennen
supervisor-buildiä, fixtureä, tallennusta, vientiä tai MSI-toimintoja.
Checkoutit sekä työkalujen valmisteluaskeleet läpäisivät. Molempien
identiteettikyselyjen native-paluukoodit tarkistettiin ennen epäonnistunutta
arvovertailua; lähdecheckout täsmäsi jäädytettyyn revisioon. Valitun
SDK:n tarkka versio ei säilynyt tulosteeseen.

Käynnistimen staattinen tarkistus vahvisti puutteen: SDK-kysely suoritettiin
checkoutien yläkansiossa, ei EKY:n `global.json`-lukituksen vaikutusalueella.
SDK:n asentaminen ei yksin valitse sitä projektin ulkopuoliselle kyselylle.
Tämä on valmisteluhylkäykseen sopiva käynnistinvirhe, ei alkuperäisen
workspace-timeoutin tai jäljen vientivirheen juurisyy.

Korjaus rajattiin vain yksityiseen käynnistimeen: tarkistus suoritetaan
projektikansiossa, Git-kysely sidotaan absoluuttiseen checkout-juureen ja
työkalun hausta valitaan yksi suoritettava polku ennen täsmäversion
varmennusta. `10.0.302`-lukitus ja kaikki kokeen rajat säilyvät. Päivitetyt
17/17 paikallista tarkistusta läpäisivät ilman ohituksia; mukana ovat
työhakemistoregressio ja todellisen SDK-/Git-tarkistuslohkon lukukoe.
Epäonnistuneet valmistelutarkistukset säilytettiin erillisinä, eikä
paikallinen läpäisy ole uuden hosted-ajon todiste.

Ajoloki ja tilatiedot säilytettiin yksityisesti. Artifacteja oli nolla:
ETL:ää tai vientitulosteita ei ehtinyt syntyä. Fixturen, tallennuksen,
siivouksen ja analyysin tulokset ovat **ei suoritettu**, eivät hyväksytty.
Käynnistin poistettiin käytöstä ja erillinen käynnistysportti suljettiin;
kumpikin varmennettiin. Normaali julkinen CI ja PR/main eivät muuttuneet.

Omistaja hyväksyi tämän jälkeen yhden korjatun no-MSI-kertakokeen samalla
lähderevisiolla ja samoilla säilytys-, kustannus- ja aikarajoilla. Sen
[tulos](#korjatun-yksityisen-kertakokeen-päätösraportti) on erillinen
diagnostinen yritys, ei alkuperäisen testin muuttumaton uusinta. Tämä
valmisteluhylkäys säilyy ensimmäisen ajon tuloksena; sitä ei korvata
myöhemmällä läpäisyllä.

Menetelmän lähde: [.NET SDK:n valinta ja global.json-hakujärjestys](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json).

### Korjatun yksityisen kertakokeen päätösraportti

Yksi erikseen hyväksytty korjattu ajo läpäisi samalla julkisella lähteellä
`068aba187a84cd1d29e26a4432252785c97ae9f8`. Muutos oli vain yksityisen
käynnistimen SDK-/lähdetarkistuksessa; nykyinen fixture, vientiketju,
riippuvuudet ja testien rajat säilyivät. Ennen ajoa käynnistimen tarkistukset
läpäisivät uudelleen 17/17 ilman ohituksia. Käynnistimen lähdesidonta ja
SDK-ennakkotarkistus läpäisivät nyt myös hosted-ajossa.

| Osatulos | Varmennettu tulos ja rajaus |
| --- | --- |
| Synteettinen fixture | Yksi valittu `productInspectionNativeHold`-sopimustesti läpäisi. Se vaatii tarkoituksella aiheutetun odotuksen hylkäämistä, ei onnistunutta asennusta. MSI:tä tai käyttäjätietokantaa ei käsitelty. |
| Tallennus ja ensiaineisto | Tallennuksen aloitus ja pysäytys läpäisivät. Pysäytetty ETL ja rajatut fixture-tulokset siirrettiin yksityiseen säilytykseen ennen analyysiä. |
| Vientikutsut | Sekä `event-statistics` että `command-export` poistuivat havaitusti koodilla 0. Metatiedon kirjoitukset valmistuivat; stderr-tiedostot olivat tyhjiä. Tämä todistaa vain uuden tallenteen viennin. |
| Analyysi | Odotettu `scriptStarted` -> `productStateStarted`-raja ja `switchIntervalAfterLastEvent` havaittiin ilman `scriptFinished`-merkintää. Kattavuus on rajattu tallennus, ei koko historia tai vanhan timeoutin juurisyy. |
| Säilytys ja eheys | Molemmat aineistoerät ladattiin paikalliseen yksityiseen tutkimusalueeseen ajon valmistuttua. Kaikkien 20 manifestiin kuuluvan tiedoston koot, SHA-256-tiivisteet ja ajosidonta täsmäsivät; ylimääräisiä tiedostoja ei löytynyt. Sama ETL säilyi muuttumattomana analyysin yli. |
| Prosessit ja siivous | Viiden säilytetyn vaiheen tulokset todistavat oman prosessipuunsa poissaolon. Caller säilyttää kuitenkin `processTreeAbsent: false`- ja `retainedUnverified`-tuloksen; kokonaissiivous pysyy varmentamattomana. Tästä ei yksin päätellä prosessivuotoa, eikä aineiston täydellinen säilyminen korvaa siivoustodistetta. |

Käynnistin poistettiin käytöstä ja kertakokeen käynnistysmuuttuja poistettiin;
kumpikin varmennettiin. Raaka-aineisto jää vain hyväksyttyyn yksityiseen
säilytykseen. Seitsemän vuorokauden palvelusäilytys, paikallinen 14 vuorokauden
tarkistus ja varmentamattoman siivouksen aineiston säilytysvelvoite pysyvät.
Yksityisestä kohteesta ei tehdä normaalia CI-ajopaikkaa. Tässä vaiheessa
ei muutettu julkisen PR:n lähdettä, hyväksyntäehtoja tai sovelluskoodia.

**Suljettu:** käynnistinkorjauksen hosted-todennus ja tämän uuden no-MSI-
tallenteen säilytys-/vientikoe. Riippumaton lukukatselmus vahvisti osatulosten
erottelun ja siivousnäytön rajan. **Ei suljettu:** aiemman `commandExport`-
virheen syy, alkuperäinen workspace run 2 -timeout tai normaali hyväksyntä.
Vanhan virheen ETL ja raakavirhe puuttuvat edelleen. Uusi läpäisy ei
palauta niitä eikä osoita vikaa infrastruktuurihäiriöksi.

**Jatkosuositus:** päätetään tämä erillinen vientitutkimus tähän raporttiin.
Nykyinen näyttö ei perustele uutta vientikorjausta, MSI-koetta tai yleistä
diagnostiikkakerrosta. Normaaliin hyväksyntään paluu tarvitsee aiemmin
määritellyn korjaus-/infrastruktuurinäytön tai omistajan uuden päätöksen
tehtävän valmistumisehdosta. Mahdollinen päätös jatkaa alkuperäinen havainto
avoimena ei saa kirjata sitä korjatuksi tai siivousta varmennetuksi.
Kaikki normaalin kierroksen pakolliset data-, turvallisuus-, sisältö- ja
siivoustarkistukset säilyvät. Tätä päätöstä tai uutta ajoa ei ole tehty.

### Playwright-ensivirheen jatkoehdotus

Ensimmäisen epäonnistumisen Playwright-trace on erillinen jatkoehdotus,
ei tämän installer-kokeen korvike. Nykyinen `on-first-retry` ei kerää
ensiyrityksen tracea, ja Electronin oma context tarvitsee erillisen
kytkennän. Mahdollinen `retain-on-failure`-muutos vaatii ensin sessionin
ja muun kielletyn aineiston poissulun sekä failure-/restart-todennuksen.
Kuvakaappauksen, trace-tiedoston ja verkkopyyntöjen tallentaminen ei
tarkoita kaiken verkkoliikenteen kaappausta tai julkaisulupaa.
Nykyiset CI-artifactien sisältörajat säilyvät; tätä ehdotusta ei ole
lisätty nykyisen Goalin valmistumisehdoksi.

[Vianetsintäreitti](../ai/e2e-test-authoring-guide.md#valitse-aineisto-epäonnistuneen-vaiheen-mukaan)
erottaa selaintracen, Electronin käynnistystiedon ja asennuspaketin
prosessiaineiston. Yleistä trace-asetusta, julkisia artifacteja, aikarajoja,
retry-asetuksia tai prosessiomistajuutta ei muuteta tällä ohjepäätöksellä.
Uutta loggeria tai T3/V2-omistajuusremonttia ei aloiteta. V1 pysyy suljettuna;
V2:n integraatio on avoin. Tämän dokumenttityön tarkistukset eivät ole uusi
sovellustestien tai CI:n hyväksyntä.

## Virhetiedon ja Electron-päivityksen rajattu jatko

Omistaja hyväksyi 30.9.2026 yhden kokonaisuuden, jossa on kaksi erikseen
suljettavaa välitavoitetta. Tämä on nykyisen M1:n jatko ennen A1:tä, ei uusi
roadmap tai T3/R28:n avaaminen uudelleen. Lähtörevisio on PR #282:n
`35ba04c033ca260f4065652e25bc46eea60bd59f`; sen vihreät tarkistukset eivät
kata myöhempiä työpuun muutoksia. Electron `43.7.6` ja kuuden vaihevirhekoodin
lukuketjukorjaus ovat jo toteutettuja mutta eivät vielä integroituja.

Uusi hyväksytty tehtävänanto korvaa aikaisemman Goal-luonnoksen kokonaan.
Vanha luonnos on historiaa, ei rinnakkainen lisävaatimusten lähde.
Juuri- ja aluekohtaiset AGENTS-ohjeet sekä omistavat suunnitelmat säilyvät
voimassa. Tässä osassa ylläpidetään hyväksyttyä julkaisukelpoista rajausta;
paikallisia liitepolkuja tai tutkimustietoja ei siirretä dokumentaatioon.

### Rajattu ongelmalista

| Kohta | Havaittu puute ja omistaja | Tarvittava näyttö ja sulkemisehto |
| --- | --- | --- |
| V1a: syntypaikka ja viesti | Electronin E2E-backendin runner hukkaa poikkeuksen ja lähettää vain vaiheen. Brokerin sulkemisvirhe voi estää viestin. Omistaja: `apps/desktop/e2e` ja sen tiukka status-sopimus. | Suljettu syyluokitus tai `unknown`, täsmällinen lähettäjä/parseri/vastaanottaja, ensivirheen säilyminen ja brokerien erilliset sulkutulokset. Nopeat sopimus- ja vuotosuojatestit; ei tuotantokoodin muutosta. |
| V1b: säilyminen ja raportti | Prosessin muistihavainto voi puuttua poistumisen jälkeen; CI:n testikooste yleistää virheen `testError`-tasolle. Omistaja: nykyinen native-havaintotiedosto, Electron-fixture ja turvallinen CI-raportoija. | Todellinen ennen ensimmäistä ikkunaa epäonnistuva prosessiketju säilyttää tunnetun syyn lopullisessa suoritusyrityskohtaisessa raportissa. Testitapaus, suoritusyritys (`attempt`) ja käynnistyssukupolvi eivät sekoitu. Puuttuva/myöhäinen havainto, raportointivirhe ja epävarma cleanup pysyvät näkyvinä erillään. Nykyinen onnistumispolku säilyy. |
| V2a: riippuvuuden hyväksyntä | Hyväksytyn Electron-päivityksen runtime-/native- ja integraatioportit ovat kesken. Omistaja: [riippuvuusarvio](local-desktop-dependency-review.md#electron-4376--turvallisuuspäivitys). | Nykyisen täsmäversion, `better-sqlite3 13.0.2`:n ja synteettisen packaged-/palautuspolun portit sekä ennalta nimetyt vakausajot; lopullisen revision PR/main-todennus. |
| V2b: pakollisten porttien hylkäykset | Raportoinnin keräysriippuvuus ja MSI:n samaversion korvaussääntö on korjattu. Valmiuskyselyhavainto ja revision `8913dc48` E2E-perheet sekä installer-/legacy-ryhmät läpäisivät. Avoin hylkäys on saman PR-ajon packaged-workspace run 2:n job-aikaraja. Omistaja: nykyinen Windows acceptance -polku; [rajattu jatko](#riskiperusteinen-jatko-1102026). | Erota prosessin alkuperäinen vika, tuloksen saatavuus ja siivous; sovella yhteistä uusintakäytäntöä ilman hyväksyntäehtojen lievennystä. PR/main vaatii oman hyväksynnän; läpäisy ei todista vanhojen timeoutien syitä. Historiallisten hylkäysten täydellinen jälkiselitys ei ole uusi hyväksyntäehto. |

V1 toteutetaan ensin. V1a käyttää alkuperäisen poikkeuksen rajattua
koodiluokitusta ennen siivousta; vaihe ei ole juurisyy. V1b käyttää nykyistä
runtime-kohtaista native-havaintotiedostoa ja lifecycle-liitettä. Varsinainen
käynnistystulos ja omistettu cleanup ovat pakollisia; lisähavainto ei ole
uusi readiness-ehto. Raportoinnin virhe ei saa peittää toimintavirhettä.
Tuntemattomasta tai toimittamatta jääneestä syystä ei tehdä päätelmää.
Sidonnan suoritusyritys tarkoittaa testin `attempt`-arvoa, ei asiakasyritystä.
Tämä vaatimus ei lisää raportointiin `companyId`- tai muuta
liiketoimintatunnistetta.

Raportointi ei lisää käynnistyksen, siivouksen tai komentopoistumisen
kriittiselle polulle estävää kirjoitusta tai rajaamatonta kuittausodotusta.
Käytetään nykyisiä rajattuja toimitusmekanismeja, ei uutta kirjoitinta tai
valvojaa. Varmentamaton siivous estää siihen liittyvän tutkimusaineiston
poistamisen. Ensivirheen aineisto säilytetään erillään uusista
suoritusyrityksistä ja buildin tyhjentämistä hakemistoista.

V1:n sulkemiseen kirjataan testattu revisio, oikean prosessirajan todistus,
vuotosuoja, onnistumispolku ja rajaukset. Se avataan uudelleen vain oman
sopimuksensa puutteen tai regression vuoksi. V2 käyttää valmista havaintoa
vikojen korjaamiseen. Hyväksyntäajon lähde- ja build-syötteet jäädytetään
jälkivarmennukseen asti, yritykset säilytetään ja ajoja seurataan
[nykyisen ohjeen](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet) mukaan.

Ei uutta testialustaa, supervisoria, yleistä loggeria, rinnakkaista cleanupia,
riippuvuutta, aikarajojen lievennystä tai raakajälkien julkaisua. Laajempi
aikajana ja virheen lähderivi eivät kuulu automaattisesti V1:een. Uusi
löydös kuuluu mukaan vain muutoksen regressiona tai pakollisen hyväksynnän
esteenä; muita parannuksia käsitellään myöhemmin. Kahden viikon tavoite ei
muuta hyväksyntää. V1 on suljettu alla nimetyllä revisionäytöllä; V2:n
hyväksyntä ja integraatio ovat vielä avoimia. Koko 0.3.0:n julkaisu ei kuulu
tähän rajaukseen.

### V1:n ensimmäinen toteutuscheckpoint

Syyluokitus, brokerien erilliset sulut, tiukka failure-status, controllerin
ensivirheen säilytys ja native/lifecycle-liitteen lukuketju on toteutettu
työpuuhun. Ensimmäinen käynnistyskerta säilyy erillään rajatusta
vaiheluettelosta. Luokitus ei lue raakaa stackia tai kutsu poikkeuksen
gettereitä; tuntematon arvo jää tuntemattomaksi. Status hylkää myös harvan
cleanup-taulukon eikä pudota sen tarkistamatonta kohtaa hiljaisesti.

Rajattu 120/120-sopimussarja ja E2E-/desktop-E2E-tyyppitarkistukset läpäisivät
ensimmäisillä ajoilla. Lähtö-HEAD oli yllä nimetty `35ba04c0` ja muutokset
vielä commitoimattomia; testatun työpuun muuttumattomuus tarkistettiin
takaisinluvussa. Lopullisesta lifecycle-liitteestä varmennettiin tunnettu
syy, broker-sulkuvirhe ja erilliset testin suoritusyritys-, käynnistyskerta-
ja backend-yritysarvot. Rajattu riippumaton staattinen katselmus ei löytänyt
uusia regressioita. Tämä on sopimus-/integraatiotason näyttöä, ei oikean
Electron-prosessirajan, satunnaisen käynnistysvian tai koko V1:n hyväksyntä.

### V1b:n toteutus ja todennus

Työpuuhun on lisätty nykyisen CI-raportoijan suljettu syyprojektio,
lähteen kanssa yhteinen koodiluettelo, suorituskohtaiset tuloshakemistot
sekä epäonnistuneen suoritusyrityksen aineiston säilyttäminen. Raportin
tiedostotallennus ja liitteen välitys yrittävät valmistua toisistaan
riippumatta. Raportoinnin lisävirhe ei korvaa alkuperäistä toimintavirhettä.
Nykyinen onnistumispolku poistaa testijuuren varmennetun siivouksen jälkeen;
vasta sen jälkeinen raportointivirhe ei palauta poistettua juurta.
Tekninen sopimus ja rajaus ovat [E2E-testiympäristöohjeessa](e2e-test-environment.md).

E2E- ja desktop-E2E-tyyppitarkistukset läpäisivät tämän toteutusvaiheen.
Rajattu Node-sarja päättyi tulokseen 110/112: kaksi hylkäystä koski
testikomennon täsmällistä odotusta, josta puuttuivat kaksi lisättyä
regressiotiedostoa. Odotus korjattiin ja kummankin tiedoston poisjättöä
vastaan lisättiin testi. Korjatun sarjan seuraavasta ajosta ei saatu
lopputulosta; osatuloksia ei hyväksytä koko sarjan läpäisyksi. Ensimmäisen
ajon hylkäys ja seuraavan ajon keskeneräinen näyttö säilytetään erillisinä.

Jatketussa todennuksessa korjattu Node-sarja läpäisi 114/114 ja rajatut
lähde-, status-, fixture-, native- ja julkaisusopimukset 138/138.
Niiden lähdesidonta varmennettiin takaisinluvussa. Riippumaton staattinen
katselmus ei löytänyt vahvistettuja korjaustarpeita.

Oikean Electron-prosessirajan koe käytti tavallista fixtureä ja backendin
todellista konfiguraatiolukua: vain testin oma incident-hakemisto osoitettiin
puuttuvaan alihakemistoon. Utility-prosessin `backendStart`-vaiheen `ENOENT`
säilyi native-tiedoston ja muistiliitteen kautta lopulliseen turvalliseen
raporttiin. Testirunko ja ensimmäinen ikkuna eivät käynnistyneet; muistista
luettava lisähavainto jäi oikein `unavailable`-tilaan. Suoritusyritys,
käynnistyskerta, backend-yritys, alkuperäinen exit ja varmennettu siivous
erottuivat. Koe jäi tarkoituksellisesti hylätyksi eikä sitä merkitty
onnistuneeksi sovellustestiksi. Säilyneen ensivirheen tiedosto- ja liitetavut
varmennettiin myös seuraavien testien jälkeen.

Tavallinen eristetty käynnistys ja tarkka runtime-tunnistus läpäisivät 2/2.
`DESK-STARTUP-CONFIG-001` läpäisi oletuksen, eksplisiittisen normaalitilan
ja rajatun vikavalinnan regression ilman prosessikäynnistystä. Tämä ei
korvaa yllä olevaa oikean prosessirajan koetta.

V1:n toteutus on lukittu revisioon
`8bcf1c7484cc3e9693306f7abd0d0cdad5d3fda3`. Loppukatselmus sekä E2E- ja
desktop-E2E-tyypitys läpäisivät. Oikeaprosessikokeen toteutustiedostot
säilyivät samoina; sitä seurasi vain pysyvä konfiguraatioregressio ja
dokumentoinnin checkpoint. Näin V1:n rajattu virhetietoketju on suljettu.
Tämä ei vielä hyväksy koko Electron-päivitystä, CI:tä tai integraatiota.

#### V1b:n järjestysregressio

Riippumaton jatkokatselmus avasi V1b:n uudelleen sen oman sopimuspuutteen
vuoksi: native-lukija palauttaa lajitellun virhekoodijoukon, mutta
loppuraportti tulkitsi joukon ensimmäisen alkion ensimmäiseksi tapahtumaksi.
Myöhempi aakkosjärjestyksessä aikaisempi koodi saattoi siksi hylätä koko
muuten kelvollisen syyprojektion. Native-lähde ja lifecycle-liite säilyivät.

Rajattu korjaus tarkistaa vaihevirhekoodin kuulumisen joukkoon. Ensimmäisen
tapahtuman syyn valinta säilyy native-lukijan vastuulla; jos se ei tuntenut
ensimmäistä syytä, myöhempää syytä ei lainata. Skeema, lajittelu, muut
validaatiot, raportin julkaisuraja ja testin tulos säilyvät ennallaan.

Regressiot toistivat puutteen sekä suorassa projektiossa että oikean
Playwright-ajurin loppuraportissa. Korjauksen jälkeen 41/41
raportointisopimusta, 27/27 native-kirjoittimen/lukuketjun sopimusta ja
E2E-tyypitys läpäisivät samalla muuttumattomalla työpuulla lähtörevision
`1e91b328` päällä. Todellinen native-kirjoitin, lajittelu, lifecycle-liite
ja loppuprojektio säilyttivät alkuperäisen syyn, poistumisen ja cleanupin;
erillinen oikea ajuri todensi lopullisen raportin suoritusyrityksittäin.
Nämä ovat rajatun sopimuskorjauksen näyttöä, eivät uusi Electron-prosessikoe
tai integraatiohyväksyntä. Aiempi prosessirajan näyttö säilyy yllä omalla
revisiollaan; lähteen syyluokitusta, capturea tai runtimea ei muutettu.

### V2:n nykyinen hyväksyntächeckpoint

V1-revision tavallinen workspace-testisarja pysähtyi olemassa olevan
`workspaceRegistryBoundaries.test.ts`-rajatestin viiden sekunnin
aikakatkaisuun. Virhe kuuluu alemman tason lähdekoodinlukutestiin, ei
Electronin käynnistyshavaintoon. Alkuperäinen hylkäys säilytetään.

Rekisterin rajatestin korjaus lukittiin revisioon `d55f5a80`. Sen normaalissa
workspace-ajossa rekisteritesti läpäisi, mutta muuttamaton
`workspaceBackupImportBoundaries.test.ts` pysähtyi vastaavan sarjallisen
lukuketjun aikakatkaisuun. Molemmat hylkäykset säilyvät erillisinä.

Tuonnin korjauksen revisio `2390c0b1` läpäisi rekisterin ja tuonnin
rajatestit normaalisarjassa, mutta vastaavat muuttamattomat creation- ja
first-start migration -rajatestit ylittivät aikarajan. Hylkäykset rajautuvat
näiden neljän lähdekoodiskannauksen samaan sarjalliseen lukutapaan; tarkkaa
kuormituksen tai käyttöjärjestelmän vaikutusta ei väitetä todistetuksi.

Neljä rajatestiä käyttää nyt yhtä pientä, tuotantobuildista pois jätettävää
[`boundarySourceTestSupport`-lukijaa](../../apps/desktop/src/workspaces/boundarySourceTestSupport.ts).
Enintään kahdeksan lukemisen erä valmistuu kokonaan ennen virheen välitystä;
seuraavaa erää ei aloiteta virheen jälkeen. Jokaisen testin tiedostojoukko,
import-tulkinta, tarkistusjärjestys, SQLite-ajurirajaukset ja aikaraja
säilyvät. Aiemmat kahden testin päällekkäiset lukutaparegressiot on siirretty
yhteisen apurin viereen; moduulikohtaiset kielteiset import-kokeet säilyvät
omissa tiedostoissaan. Ei yleistä testialustaa tai tuotantomuutosta.

Rajattu 42/42-sarja, desktopin tyypitys ja tuotantobuild läpäisivät.
Apurin puuttuminen tuotantobuildista tarkistettiin. Riippumaton katselmointi
ei löytänyt vahvistettuja korjaustarpeita. Tämä todentaa lukutavan,
kattavuuden ja virheiden säilymisen, mutta ei yksin selitä
alkuperäisen kokonaissarjan kuormituksen tarkkaa vaikutusta tai hyväksy
normaalia workspace-sarjaa.

Lukutavan korjaus lukittiin revisioon `31e7dcca`. Sen tavallisessa
workspace-ajossa kaikki neljä lähdekoodirajojen testiä läpäisivät. Koko
sarja pysähtyi erillisen `localUpdatePackageCache.test.ts`-palautustestin
aikakatkaisuun ja sitä seuranneeseen siivousvirheeseen. Alkuperäisen
aikakatkaisun tarkka syy ja siivousvirheen suhde siihen ovat vielä avoimia;
tätä ei nimetä Electron-päivityksen tai tuotannon rollbackin virheeksi.

Seuraava rajattu tutkimus lisää vain kyseiseen testiin nimetyt vaihehavainnot
ja oman fixture-juurten kokoelman. Aikakatkaisu ei takaa asynkronisen rungon
valmistumista: epäonnistuneen tai keskeneräisen rungon juuria ei anneta
muiden testien siivottaviksi. Säilytetty hakemisto ei ole muuttumaton
aikakatkaisuhetken snapshot, jos aloitettu operaatio vielä jatkuu.
Raporttiin ei lisätä polkuja tai raakavirheitä. Rajattu 28/28-sarja ja
desktopin tyypitys läpäisivät. Riippumaton katselmointi ei löytänyt
vahvistettua korjaustarvetta. Seuraava ennalta nimetty tavallinen
workspace-sarja läpäisi samoilla vaatimuksilla: desktop 1577/1577 ja
253/253 script-sopimusta, backend 1365/1365 sekä web 665/665. Desktopin
kolme ja backendin viisi ennestään ohitettua tapausta pysyivät ennallaan.
E2E-paketin alemmat sopimussarjat läpäisivät 786/786 ja 515/515; ne eivät
korvaa oikeita käyttäjäpolkuja. Testatun lähteen muuttumattomuus tarkistettiin.

Erillinen tarkoituksella aikakatkaistu koe todensi keskeneräisen rungon
turvallisen vaihehavainnon ja omistetun fixture-juuren säilymisen ilman
siivousvirhettä. Sen hylkäys säilytettiin odotettuna vikakokeena, ei
onnistuneena sovellustestinä. Tutkimuskokeen ensimmäinen nimivalinta ei
valinnut testiä; sitä ei hyväksytty todisteeksi. Tavallisen testin aikarajaa
ei muutettu. Tämä tarkentaa virhetodisteen säilymistä, mutta ei todista
alkuperäisen kuormitetun timeoutin juurisyytä korjatuksi. Aiemmat hylkäykset
säilyvät.

Tämä rajattu testiapurimuutos lukittiin revisioon
`1e91b32892c73e35f77b67ff05ddba5eae1fb01b`. Sen puhtaalla, ajon yli
jäädytetyllä lähteellä tavallinen täysi Electron-sarja läpäisi 46/46 ilman
retryä tai ohituksia. Tavallinen desktop-stress läpäisi koko ennakkoon
määritellyn työkuormansa ja täysi 30 minuutin soak läpäisi ilman
kesto-overridea. Tulokset ja lähdesidonta varmennettiin takaisinluvussa;
ne eivät todista vanhojen ajoitushylkäysten juurisyitä korjatuiksi.

V1b:n rajattu loppuprojektion korjaus lukittiin revisioon
`27a0b6c3becc7a75501b48215d16182a10c6d1c2`. Riippumaton katselmus ei
löytänyt korjattavaa; ohjeiden linkit tarkistettiin. Muutos ei koske yllä
ajettuja sovellus-, runtime- tai endurance-polkuja.

Saman puhtaan revision tuore eristetty tuotantopayload läpäisi native
SQLite-, Electron-versio-, fuse- ja sisältötarkistukset. Hardened
backup -> inspect -> restore -> restart -> compare läpäisi samalla
muuttumattomalla paketilla. Molempien vaiheiden prosessipuiden poistuminen
todennettiin ennen synteettisen juuren poistoa. Tämä ei ole julkaisu tai
asennetun ohjelman muutos.

Production audit ja 160 rekisteriallekirjoitusta läpäisivät, mutta full audit
hylkäsi nykyisen `brace-expansion 5.0.9` -version. Paketointityökalun
transitiivisen riippuvuuden kolme advisorya ovat
`GHSA-qhr7-859c-m2p7`, `GHSA-6j4f-fj2g-mc7p` ja `GHSA-q2hr-2g5m-vwhr`.
Ne eivät ole Electronin, SQLite-ajurin tai sovellustestien hylkäyksiä.
Rajattu päivitysehdotus ja sen päätösportti ovat
[riippuvuusarviossa](local-desktop-dependency-review.md#brace-expansion-paketointiketjun-uusi-auditointihylkäys).
Mergeä ei tehdä eikä auditointia ohiteta. Hyväksytyn korjauksen jälkeen
vaaditaan tuore auditointi, paketointinäyttö ja lopullisen revision omat
PR/main-portit. V2 ja integraatio ovat vielä avoimia.

Omistaja hyväksyi rajatun `brace-expansion 5.0.12` -päivityksen ja testauksen.
Lukituspäivityksen jälkeen kirjaston molempien lataustapojen rajatut
virhe- ja yhteensopivuuskokeet sekä nykyiset 253 paketointisopimusta
läpäisivät. Production/full audit ja 160 rekisteriallekirjoitusta
läpäisivät. Riippumaton patch-katselmus ei löytänyt korjattavaa.
Puhtaan revision `b5833b22` tuore tuotantopayload ja samoilla tavuilla
tehty hardened-palautus läpäisivät. Molempien vaiheiden prosessipuut
poistuivat ennen synteettisen juuren siivousta. Seuraavaksi vaaditaan
lopullisen revision oma PR/main-todennus; V2 ei ole vielä suljettu.
Paketointiketjun päivitys ei muuta aiemmin hyväksyttyjä sovelluksen
endurance-polkuja; niitä ei avata uudelleen ilman omaa muutosperustetta.

### Normaalin PR-kierroksen valmisteluhylkäys

Revision `fa343f19970aa14f088d0f664374f7f76a4debd7`
[normaali PR-ajo 36776623662](https://github.com/eky-software/eky/actions/runs/36776623662),
suoritusyritys 1, päättyi hylätyksi. Todellinen PR-checkout oli
`7b98ec3648ea2b3f363d95b2b85787cfd1f018a0`. Ryhmistä 36 onnistui,
Electron-ryhmä ja sen vuoksi koonti hylättiin; kaksi ennalta valinnaista
diagnostiikkaryhmää ohitettiin. Riippuvuustarkistus
[36776622975](https://github.com/eky-software/eky/actions/runs/36776622975)
läpäisi omana porttinaan. Tämä ei sulje mainin riippuvuushälytyksiä.

`DESK-WORKSPACE-IMPORT-001`:n ensimmäinen testisuoritusyritys pysähtyi
synteettisen varmuuskopion valmistelubackendin 45 sekunnin valmiusrajaan
(`E2E_BACKEND_HEALTH_TIMEOUT`). Electronia tai testin käyttäjäpolkua ei
vielä käynnistetty. Nykyinen lifecycle-liite säilytti valmisteluvaiheen,
prosessin käynnistyshavainnon, ennen siivousta havaitun poistumisen
puuttumisen sekä varmennetun prosessipuun ja portin siivouksen.
Kuunteluilmoitusta ei havaittu; nykyisen sopimuksen mukaan se ei yksin
todista kuuntelun puuttumista. Testijuuri säilytettiin.

Automaattinen toinen testisuoritusyritys läpäisi, mutta `failOnFlakyTests`
hylkäsi ryhmän oikein. Ensimmäinen loki ja lifecycle-liite säilyvät
erillisinä; toinen yritys ei todista vian korjaantumista. Muut
asennus-/palautusryhmät, myös molemmat legacy-toistot, onnistuivat. Niiden
läpäisy ei korvaa Electron-ryhmän tai koko integraation hyväksyntää.

Omistaja on `apps/e2e`-valmistelu yhdessä erillisen `apps/backend/e2e`-
entrypointin kanssa. Nykyinen näyttö ei yksilöi sisäisen käynnistyksen
pysähtymiskohtaa tai syytä. Omistaja hyväksyi rajatun lisähavainnon:
viimeisen valmistelubackendin valmiuskyselyn tulos säilytetään suljettuna
luokkana nykyisessä lifecycle-liitteessä. Yhteyden torjunta, kyselyn oma
aikakatkaisu, virhevastaus ja muu yhteysvirhe erotetaan; onnistunut kysely
ja havainnon puuttuminen eivät sekoitu. Havainto jäädytetään ennen siivousta.
Ei raakavirhettä, osoitetta, polkua, vastaussisältöä tai uutta kirjoitinta.

Rajatut regressiot ja katselmus tehdään ennen yhtä kohdennettua Windowsin
kriittistä Electron-ajoa. Tuotantobackendiä, aikarajoja, retry-ehtoja,
sisältövertailuja tai T3:n prosessiomistajuutta ei muuteta. Lisähavainto tai
uuden kokeen läpäisy ei yksin todista alkuperäisen aikakatkaisun syytä.
V1:n suljettua Electron-virhetietoketjua ei avata uudelleen ilman siihen
kohdistuvaa löydöstä. V2, PR/main ja A1 ovat auki.

### Valmiuskyselyhavainnon todennus

Hyväksytty lisähavainto on toteutettu nykyiseen E2E-valmiuskyselyyn ja
valmisteluvirheen lifecycle-liitteeseen. Suljetut luokat ja ennen siivousta
jäädytetty havainto eivät muuta onnistumista, aikarajoja, retryjä tai
prosessiomistajuutta. Tuotantokoodi, riippuvuudet ja CI-vaatimukset säilyvät.

Rajattu lopullinen sopimussarja läpäisi 146/146, nykyinen CI-raportointi
41/41 ja viereinen web-/HTTP-sopimus 12/12. Tyyppitarkistus ja riippumaton
lähdekatselmus läpäisivät. Ensimmäisen regressioajon yksi uusi synteettinen
testiodotus ei reagoinut peruutukseen; se korjattiin vain testifixtureen
ja ensitulos säilytettiin. Tämä ei ollut todettu runtime-vika.

Yksi hyväksytty Windowsin kriittinen Electron-ajo läpäisi 39/39 ilman
retryä, flaky-tulosta tai ohituksia. Myös aiemmin hylätty backup-importin
valmistelu ja käyttäjäpolku läpäisivät. Ajon lähdesidonta tarkistettiin
ennen dokumentoinnin tulospäivitystä. Tämä on lisähavainnon ja nykyisen
onnistumispolun todennus, ei alkuperäisen CI-timeoutin syytodiste.

Seuraavaksi vaaditaan lopullisen muutospaketin normaali PR-todennus ja
mahdollisen hyväksytyn mergen jälkeen mainin omat portit. Ensimmäinen
CI-hylkäys säilyy erillisenä. V1 pysyy suljettuna; V2 ja A1 ovat avoimia.

### V2:n ensimmäisen PR-ajon rajatut esteet

Revision `416d06f3` [normaalin PR-ajon 36718389502](https://github.com/eky-software/eky/actions/runs/36718389502)
ensimmäinen suoritusyritys hylkäsi alemman tason raportointiregression:
kahden odotetun `testEnd`-rivin sijaan kerättiin nolla. Alkuperäisen
sisäisen Playwright-ajon raakapoikkeus ei sisälly julkaistuun aineistoon,
joten juuri sen poikkeuksen sisältöä ei väitetä varmistetuksi.

Import-ketju osoitti kuitenkin konkreettisen valmisteluriippuvuuden:
raportointitesti latasi koko Electron-fixturen kautta backendin ja
rakennettua `@eky/auth`-pakettia vaativan moduulin. Raportin muodostus ei
tarvitse tätä ketjua. Rajattu regressio estää raportointiajossa `@eky/`-
runtime-importit ja toisti keräyshylkäyksen ennen korjausta. Sama raportti-
funktio tyyppeineen siirrettiin omaan fixture-apuriinsa muuttamatta sen
sisältöä; oikea Electron-fixture käyttää ja jälleenvie samaa funktiota.
Korjattu koe läpäisi import-eston kanssa. Se ei väitä kaikkien mahdollisten
polkupohjaisten riippuvuuksien olevan estettyjä.

Säilytetyn yksityisen toistokokeen sisäinen raportti vahvistaa
keräysvaiheen: nolla suitea ja valittua testiä sekä import-eston ja
tyhjän testivalinnan runner-virheet. Tämä ei ole käynnistyneen testin
syytiedon katoaminen. Korjauksen regressio vaatii edelleen molemmat
`testEnd`-rivit ja alkuperäisen syyn kummastakin suoritusyrityksestä;
odotusta tai aikarajaa ei muuteta. Jatkotarkistuksessa raportointisopimuksen
34 testiä ja legacy-syyluokittelun sekä havaintorajan 152 testiä läpäisivät.

Korjatun työpuun 787 + 515 alemman tason E2E-sopimusta, E2E-tyyppitarkistus
ja 113 kohdennettua lifecycle-/julkaisu-/native-sopimusta läpäisivät.
Kaksi riippumatonta staattista katselmusta ei löytänyt korjattavaa.
Kyseessä ei ole uusi Electron-prosessirajan tai täyden CI:n hyväksyntä.

Samalla ensimmäisellä PR-ajolla molempien legacy-toistojen asennustila
läpäisi mutta `targetPayload` hylättiin koodilla `majorUpgradeStateInvalid`.
Kyseisen revision koodi yhdisti inventaarion tarkistushylkäyksen ja inventaarioiden
sisältöeron samaan virheeseen; niiden välillä ei päätellä ilman näyttöä.
Hylkäys ei ollut timeout, ja prosessipuun poistuminen vahvistettiin.
Kohdeohjelman käynnistys on tämän portin jälkeen, joten havainto ei vielä
osoita Electronin ja SQLite-ajurin yhteensopivuusvirhettä. Tämä jää
erilliseksi pakollisen integraatioportin esteeksi. Ei sokeaa uusintaa,
hyväksyntäehtojen muutosta tai mergeä punaisella ajolla.

Rajattu testiharnessin täsmennys erottaa nyt viisi
[kohdepayloadin hylkäyssyytä](windows-installer-acceptance-harness-v2.md#legacy-kohdepayloadin-hylkäyssyy)
olemassa olevissa virhekoodikentissä. Alkuperäinen tarkka vertailu,
kertatarkistus, käynnistysportti ja siivous säilyvät. Raaka-arvoja tai
uutta raportointikanavaa ei lisätä. 83 kohdetestiä läpäisi ja kaksi
riippumatonta staattista katselmusta ei löytänyt korjattavaa. Koko
legacy-core-sarjaa ei ole tällä muutoksella hyväksytty; sen puhdas
CI-todennus on edelleen pakollinen.

[Rajattu koe 36725649333](https://github.com/eky-software/eky/actions/runs/36725649333)
käytti olemassa olevaa `packaged-boundary-diagnostic`-polkua, harnessia
`8fa8e72a` ja ensimmäisen hylätyn PR-ajon muuttumatonta legacy-artifactia.
Artifactin build-revisio oli erikseen sidottu `69960d7d`; paketteja ei
rakennettu uudelleen. Ensimmäinen yritys hylättiin tarkemmalla koodilla
`targetPayloadSizeMismatch`: inventaarion tarkistus onnistui ja
tiedostomäärä täsmäsi, mutta kokonaiskoko ei. Tämä ei vielä nimeä
eroavia tiedostoja; sama määrä ei myöskään todista samoja tiedostopolkuja.
Ennen/jälkeen-artifactvarmennukset täsmäsivät. Poisto-, jälkitarkistus-,
fixture-siivous- ja prosessipuun poistumisvaiheet valmistuivat. Alkuperäinen
hylkäys säilyi, eikä tämä diagnostiikkakoe ole hyväksyntänäyttö.

Muuttumattomien MSI-taulukoiden vertailu rajasi kolme Electron-kirjastoa,
joiden tiedostokoot eroavat samalla versio- ja kielimetadatalla. Tämä on
tutkittava ehdokasjoukko, ei näyttö asennukseen jääneistä vanhoista tavuista.
Omistaja hyväksyi yhden rajatun havaintokokeen näille tiedostoille ja
MSI:n korvauspäätökselle samoilla paketeilla. Ennen ajoa toteutetaan ja
katselmoidaan [suljetut tulosluokat ja lukurajat](windows-installer-acceptance-harness-v2.md#rajattu-legacy-tiedostohavainto).
Raakaa lokia, polkuja tai tiivisteitä ei julkaista. Asennuskäytäntöä,
sovellusta ja hyväksyntäehtoja ei muuteta tämän vianrajauksen perusteella.
Mahdollinen varsinainen korjaus päätetään näytön perusteella.

Hyväksytty [jatkokoe 36731090799](https://github.com/eky-software/eky/actions/runs/36731090799),
suoritusyritys 1, valmistui harness-revisiolla `f84abf37` ja samoilla
muuttumattomilla paketeilla. Ennen ajoa jäädytetyn revision 152 kohdetestiä,
kaksi workflow-sopimusta ja riippumaton katselmointi läpäisivät.
Ensivirhe säilyi `targetPayloadSizeMismatch`-koodina ennen lisähavaintoja.
Kaikille kolmelle nimetylle tiedostolle saatiin `BytesUnchanged` ja
`MsiEqualVersionRetained`: vanhan asennuksen tavut säilyivät ja MSI:n
päätös oli jättää saman version tiedosto korvaamatta. Uuden paketin
tiedostokoot erosivat näistä aiemman muuttumattomien MSI-taulukoiden
vertailun perusteella. Tämä vahvistaa todellisen tiedostojen
korvauspuutteen, ei vain mahdollista ajoitusselitystä.

Koe ei luettele kaikkia asennetun payloadin eroja eikä todista
kohde-Electronin ja SQLite-ajurin käynnistysyhteensopivuutta, koska
käynnistysportti jäi oikein kiinni. Artifactin ennen/jälkeen-varmennus
täsmäsi. Poistot, jälkitarkistukset, fixture-siivous ja omistettujen
prosessipuiden poistuminen valmistuivat; niitä ei tulkita alkuperäisen
hylkäyksen läpäisyksi. Kokeessa ei muutettu asennuskäytäntöä.
Seuraava toteutus koskee alla hyväksyttyä asennuksen korvaussääntöä ja sen
regressio-/rollback-todennusta. PR/main-portti pysyy avoimena.

#### Asennuskorjauksen päätös

**Omistaja hyväksyi 30.9.2026 `emus`-korjauksen ja testauksen** vaihtoehtojen
käsittelyn jälkeen. Asentimen omistama sääntö ja sen rajat kuvataan
[Windows-asennussuunnitelmassa](windows-installer-and-update-plan.md#saman-tiedostoversion-korvaaminen).
Nykyiset komponenttitunnisteet, `RemoveExistingProducts`-sekvenssi ja
täydellinen payload-vastaavuus säilyvät. DLL-muokkausta tai CI:n omaa
kiertävää asennusargumenttia ei lisätä. Uusi ero ei oikeuta laajempaa
korvauspolitiikkaa ilman päätöstä.

Todennetaan rajattu authoring-sopimus, valmiin MSI:n ominaisuus ja yksi
uusi build-once-kohdepaketti historiallista lähdepakettia vasten.
Omistaja hyväksyi nykyisen erillisen CI-kokeen: lähdepaketti rakennetaan
kerran lukitusta historiallisesta lähteestä ja kohde korjatusta
jäädytetystä revisiosta. Tämä on `historical-source-rebuild`, ei lupaus
aiemman hylätyn ajon identtisistä MSI-tavuista. Alkuperäiset paketit ja
ensivirheen näyttö säilyvät muuttamattomina. Kokeen kaksi kuluttajaa
käyttävät samoja uusia varmennettuja lähde- ja kohdepaketteja; valinnainen
inspektorihavainto on pois käytöstä. CI-toteutusta ei muuteta tätä varten.
Kohdeinventaarion täydellinen vastaavuus, käynnistys,
repair/downgrade/rollback ja business-datan muuttumattomuus sekä nykyiset
PR/main-portit säilyvät. Diagnostiikkakoe ei hyväksy korjattua pakettia.
Laajempi `amus`-pakotus, companion-versionoinnin uusi omistajuussopimus
tai asennussekvenssin siirto eivät kuulu ehdotukseen.

Ensimmäinen toteutus lisäsi `emus`-arvon asentimeen ja tarkasti sen valmiin
MSI:n Property-taulusta ennen sidecarin julkaisua. Väärä tai puuttuva
arvo sekä erikseen asetettu `REINSTALL` hylätään kiinteillä virhekoodeilla.
Asentimen yksikkötestit 116/116 ja nykyinen Windows-prosessitestisarja
41/41 läpäisivät; jälkimmäinen sisältää myös uuden guardien suoritus- ja
vuotosuojatestin. Muuttumattoman aiemman MSI:n read-only-tarkistus hylkäsi
puuttuvan säännön odotetulla koodilla. Riippumaton katselmointi ei löytänyt
korjattavaa. Nämä eivät vielä todista korjatun paketin asennusta tai
hyväksy V2:ta; oikean paketin ja PR/main-porttien näyttö on kesken.

Ensimmäinen [korjatun paketin koe 36741073269](https://github.com/eky-software/eky/actions/runs/36741073269)
revisiosta `9b863587` läpäisi kaikki 12 sopimusajoa mutta pysähtyi
tuottajan omaan workflow-sopimukseen ennen paketin rakentamista.
Legacy-ryhmien tarkasta odotuslistasta puuttui aiemmin ajokomentoon lisätty
`legacyPayloadObservation.test.mjs`: toteutunut tiedostojoukko sisälsi
44 nimeä, odotettu 43. Kyse ei ollut asennuksen tai prosessien hylkäyksestä.
Sama virhe toistettiin rajatusti ennen puuttuvan nimen lisäämistä;
tarkka joukkovertailu ja duplikaattien esto säilyvät. Pakettikuluttajat
eivät käynnistyneet eikä tästä ajosta syntynyt hyväksyttävää pakettia.
Ensivirhe säilyy. Korjauksen jälkeen koko tuottajan sopimussarja läpäisi
63/63 testiä; riippumaton katselmointi varmisti täsmällisen inventaarion
säilymisen. Seuraavaksi vaaditaan uusi rajattu pakettikoe uudesta
jäädytetystä revisiosta, ei alkuperäisen epäonnistuneen ajon uusintaa.

Korjauksen jälkeinen [pakettikoe 36743397265](https://github.com/eky-software/eky/actions/runs/36743397265)
revisiosta `ac910d17` läpäisi 12 sopimusajoa ja tuottajan 63/63 testiä.
Historiallinen lähdepaketti valmistui, mutta kohdepaketin WiX-validointi
hylkäsi Property-tauluun määritellyn `REINSTALLMODE`-arvon (`WIX1076 / ICE40`).
Artifactia ei julkaistu eikä kumpikaan asennuskuluttaja käynnistynyt.
Tämä on varmennettu paketoinnin määritysongelma, ei ajoitus- tai
käynnistysvirhe eikä korjatun paketin hyväksyntä.

`ICE40`:tä ei vaimenneta. Microsoftin
[ICE40-ohje](https://learn.microsoft.com/en-us/windows/win32/msi/ice40)
varoittaa tästä Property-taulun määrittelystä. Omistaja hyväksyi korvaavan
Type 51 -toteutuksen ja testauksen 30.9.2026. `emus`-tavoite, uudemman
tiedostoversion suoja, täydellinen payload-vertailu, palautusjärjestys ja
muut hyväksyntäehdot säilyvät. Alkuperäiset epäonnistumiset säilytetään;
PR/main-integraatio on edelleen avoin.

**Hyväksytty toteutusraja, todennus kesken:** korvaa staattinen Property-rivi
yhdellä täsmällisesti sallitulla, nimetyllä Type 51 -toiminnolla
(`EkySetReinstallMode`, `REINSTALLMODE`, literaali `emus`). WiX:n
[SetProperty](https://docs.firegiant.com/wix/schema/wxs/setproperty/)
ei tarvitse ulkoista ohjelmaa, DLL:ää tai skriptiä, mutta on silti nykyisen
asennus- ja riippuvuussopimuksen tarkoittama custom action. Päätös rajaa
oletuksen uuteen asennukseen ja major upgradeen ehdolla
`NOT Installed AND NOT REINSTALLMODE`: nykyisen tuotteen huolto ja
kutsujan eksplisiittinen korvausvalinta säilyvät. Oletusarvo ei ole
muuttumaton turvallisuusraja.

Arvon asetus sijoitetaan ennen `CostInitialize`-vaihetta sekä UI- että
execute-sekvenssiin. Read-only-tarkastin vaatii täsmällisen toimintorivin,
tyypin, lähteen, literaalin, molemmat sekvenssirivit ja ehdot sekä
Property-taulun `REINSTALLMODE`- ja `REINSTALL`-rivien puuttumisen. Kaikki
muut custom actionit, ylimääräiset tyypin liput ja toiminnon sijoittaminen
muihin sekvensseihin hylätään; vain aiempi `ICE91`-poikkeus säilyy.
Tämä on nimetty poikkeus, ei yleinen custom action -hyväksyntä.

Todennus kattaa todellisen MSI:n hiljaisen ja UI-asennuksen
oletuksen, eksplisiittisen ohituksen säilymisen, saman tiedostoversion
korvaamisen, uudemman suojan sekä nykyiset käynnistys-, repair-, poisto-,
downgrade- ja rollback-portit. Ennen uutta raskasta CI-kierrosta tehdään
rajattu paketin rakennus- ja metadata-todistus ilman käyttäjäasennusta.
Pelkät lähdetekstin tai AST:n sopimustestit eivät todista MSI-validoinnin
tai ajonaikaisen ehdon toimintaa.

Type 51 -authoring ja tarkastimen täsmällinen sallintaraja on toteutettu.
Asenninyksikkötestit 120/120 ja sarjallinen Windows-prosessisarja 111/111
läpäisivät. Jälkimmäinen tarkistaa myös oikean COM-lukijan synteettisillä
MSI-tietokannoilla, ei vain guardille annettuja valmiita tietorakenteita.
Rajattu rakennus nykyisellä WiX-projektilla ja synteettisellä payloadilla
läpäisi ilman ICE40-poikkeusta. Saman muuttumattoman MSI:n koko
read-only-tarkastus läpäisi sarakemetadatan COM-lukukorjauksen jälkeen.
Ensimmäinen lukuhylkäys ja erilliset regressiofixturen valmisteluhylkäykset
säilyvät; myöhempi läpäisy ei muuta niitä onnistumisiksi.

Rakennus- ja metadatanäyttö ei yksin hyväksynyt asennusta. Sen jälkeinen
[pakettikoe 36755818882](https://github.com/eky-software/eky/actions/runs/36755818882)
jäädytetystä revisiosta `5a8dd5d6` läpäisi 15/15 jobia: 12 sopimusajoa,
yhden tuottajan ja kaksi suoritettua legacy-kuluttajaa. Molemmat käyttivät
samaa kerran rakennettua historiallista lähde- ja korjattua kohdepakettia;
valinnainen inspektorihavainto oli pois käytöstä. Täydellinen kohdepayload,
kaksi käynnistystä, lopputuloksen tarkastin, siivous ja prosessipuiden
poistuminen läpäisivät. Tuottajan sekä molempien kuluttajien ennen/jälkeen-
pakettisidonnat täsmäsivät. Ensimmäisen suoritusyrityksen lokit ja
checkout-sidonnat säilytettiin; havaintokatkoja ei todettu.

Tämä todentaa hiljaisen legacy-päivityksen korjauksen, ei koko V2:ta.
Erillinen kahdeksan tapauksen turvallinen MSI-istuntokoe todensi molempien
sekvenssien ehdot ja nimetyn Type 51 -toiminnon arvon sekä huolto- ja
ohitustilanteiden säilymisen. Se ei suorita koko asennussekvenssiä tai
kopioi tiedostoja, joten sitä ei nimetä UI-asennuksen todisteeksi.

Hiljaisen pakettikokeen jälkeen Type 51 -rajauksesta jäivät avoimiksi todellinen
UI-asennuksen oletus, kutsujan eksplisiittisen ohituksen säilyminen
asennuksessa ja uudemman **tiedostoversion** käyttäytymissuoja. Viimeinen
ei ole sama asia kuin nykyisen tuoteversion downgrade-testi. Nämä rajattiin
olemassa oleviin testimekanismeihin; uutta testialustaa, riippuvuutta tai
käyttäjäasennuksen muutosta ei lisätty. Alla oleva täydentävä koe sulkee
nämä kolme käyttäytymisehtoa. Normaali integraatiokierros todentaa edelleen
erikseen clean/repair/uninstall-, downgrade- ja rollback-portit.
PR/main-portit ja riippuvuushälytysten oletushaaran tila ovat edelleen
avoimia. Aiemmat hylkäykset säilyvät alkuperäisinä.

Näitä kolmea käyttäytymisehtoa täydentävä rajattu synteettinen MSI-pari
käyttää tuotannon täsmällistä Type 51 -authoringia, per-user-asennusta,
rekisteriavainta komponentin key pathina ja samaa major-upgrade-järjestystä.
Kolme vaaratonta DLL:ää todentavat vanhemman, saman ja uudemman
**tiedostoversion** erikseen. Oletusajo sekä eksplisiittinen `omus`-ajo
käyttävät `/qr`-asennusta, joka suorittaa UI-sekvenssin. Tulos vaatii
asennetut tavut ja tiedostoversiot, oikeaan tuotteeseen sidotut
UI-/execute-ominaisuudet sekä täsmällisten testituotteiden poiston.
Uudemman tiedostoversion pitää säilyä molemmissa ajoissa. Tämä täydentää,
ei korvaa jo läpäissyttä oikean EKY-paketin hiljaista legacy-porttia.

Koe käyttää nykyistä native supervisoria ja sen nykyisiä budjetteja.
Asennuspolku sallitaan vain GitHubin hallitussa Windows-runnerissa;
paikallinen `--prepare-only` vain rakentaa ja tarkistaa metadatan.
Testi ei käynnistä EKYä, käsittele käyttäjätietokantaa tai käytä EKYn
tuotetunnuksia. Ensivirheen turvallinen syy, vaihe, siivous ja prosessitulos
ovat erillisiä. Raaka MSI-loki ja descriptor jäävät yksityiseen
ajohakemistoon, eivät julkiseen lokiin tai ladattavaan artifactiin.
Epäonnistumisen tai varmentamattoman siivouksen aineistoa ei poisteta.

Ensimmäinen kohdesarja `pnpm --filter @eky/desktop installer:test:msi-file-policy`
läpäisi 47/47 testiä. Todellinen paketin rakennus ja read-only-metadata
läpäisivät erillisiä tiedostokopioita vaativan build-korjauksen jälkeen;
alkuperäinen valmisteluhylkäys säilyy erillisenä. Tämä valmistelunäyttö ei
vielä todistanut asennusta. Manuaalinen CI-valinta on `msi-file-version-policy` nykyisessä
supervisor-koetyönkulussa. Normaali Windows-contract-ajo sisältää samat
regressiot ja varsinaisen synteettisen asennuskokeen; sen oman normaalin
integraatioajon läpäisy on vielä avoin.

Ensimmäinen [synteettisen kokeen CI-ajo 36768360138](https://github.com/eky-software/eky/actions/runs/36768360138)
revisiosta `945039f4` pysähtyi valmistelun yksikkötesteihin: 27/47 läpäisi,
ja ensimmäinen syy oli `msiPolicyRequestInvalid`. Supervisoria ei rakennettu
eikä MSI-asennusta ajettu. Testifixturen väliaikaisjuurelta puuttui
kanonisointi, vaikka valmistelija vaatii kanonisen juuren. Aliaksen kautta
luotu juuritesti toisti hylkäyksen ennen korjausta; kanonisoinnin jälkeen
48/48 kohdetestiä läpäisi. Sama regressio vaatii edelleen aliaksen
hylkäämisen ennen yhtäkään työkalukutsua. Valmistelijan turvallisuusrajaa,
asennussääntöä tai aikarajoja ei muutettu. Ensimmäisen CI-ajon tarkka
polkualias ei ilmene säilyneestä lokista. Korjauksen paikallinen läpäisy ei
yksin todistanut hosted-asennusta, joten seuraava rajattu koe ajettiin
korjatusta jäädytetystä revisiosta, ei epäonnistuneen yrityksen uusintana.

[Täydentävä CI-koe 36770080450](https://github.com/eky-software/eky/actions/runs/36770080450),
suoritusyritys 1, läpäisi revisiolla
`0fa4c2f3c3fb60b1880cfc4f1e3cc453e8c97c4c`. Todellinen checkout,
kaikki 48 sopimustestiä ja valitun jobin pakolliset vaiheet varmennettiin.
Saman synteettisen MSI-parin UI-oletusajo ja eksplisiittinen `omus`-ajo
läpäisivät asennettujen tavujen ja tiedostoversioiden vertailun, tuotteeseen
sidotun UI-/execute-ominaisuustarkistuksen sekä lähdetuotteen poistumisen.
Oletus korvasi saman tiedostoversion, eksplisiittinen valinta säilyi ja
uudempi tiedostoversio säilyi kummassakin ajossa. Pakettitavut säilyivät
muuttumattomina. Molempien ajojen testituotteiden poisto, tiedosto- ja
rekisterijälkien poissaolo sekä prosessipuiden poistuminen varmennettiin.
Tulosten ensivirhe-, syy- ja siivousvirhekentät olivat tyhjiä; ajoseurannassa
ei todettu havaintokatkosta. Kaksi tämän valinnan ulkopuolista diagnostista
jobia ohitettiin suunnitellusti, ei pakollista koevaihetta.

Tämä sulkee nimetyt kolme täydentävää käyttäytymisehtoa, ei normaalia
PR/main-integraatiota. Seuraava portti on paikallisen integraatiocheckpointin
varmennus ja yksi jäädytetty normaali PR-kierros omine riippuvuustarkistuksineen.
Sen jälkeen tarvitaan normaalin mergen täsmällisen main-revision omat portit
sekä erillinen Dependabot-tilan tarkistus. Aiemmin hyväksyttyä runtime-,
native-, hardened-palautus- tai endurance-näyttöä ei ajeta uudelleen pelkän
testifixture- tai dokumenttimuutoksen vuoksi ilman vaikutusta niiden sopimukseen.

#### Pakettivälimuistin testivalmistelun rajaus

Revision `0fa4c2f3` integraatiotarkistus hylkäsi pakettivälimuistin
keskeytyneen palautuksen testin aikakatkaisuun. Turvallinen vaihehavainto
säilyi: ensimmäinen keskeytyshaara valmistui ja toinen oli vielä
lähtöpakettien valmistelussa. Ensivirheen aineisto säilytettiin erillään;
sitä ei nimetä tuotannon palautusvirheeksi. Muuttamattoman lähteen
diagnostiikka-ajon läpäisy ei selitä alkuperäistä aikakatkaisua.

Rajattu testimuutos valmistelee saman current/candidate-parin vain kerran
yhden testin sisällä. Molemmat todelliset promotion-, rename- ja
normalisointihaarat säilyvät. Kummankin haaran jälkeen varmennetaan
kummankin slotin täsmällinen paketti-identiteetti, sisältö ja metadatan rooli
ennen parin uudelleenkäyttöä. Testin yksi aikaraja, abort-tarkistus ja
epäonnistuneen tai keskeneräisen rungon omien juurten säilyttäminen pysyvät.
Tuotantokoodia, tiedostojen synkronointia tai turvallisuustarkistuksia ei
muuteta. Näin poistetaan toistuva valmistelutyö, ei väitetä todistetuksi
alkuperäisen viiveen tarkkaa syytä. Rajattu 28/28-sarja ja koko workspacen
tyypitys läpäisivät. Riippumaton katselmointi ei löytänyt korjaustarvetta;
toisen haaran lähtötilan vaihto uudesta aineistosta varmennettuun palautuneeseen
tilaan on tämän testin nimenomainen rajaus. Tavallinen jäädytetyn revision
integraatioajo ja PR/main-portit ovat vielä avoimia.

## Ohje ja historia

- Uusi tai muuttuva testi: [testinkirjoittajan pikaohje](../ai/e2e-test-authoring-guide.md).
- Voimassa oleva tekninen sopimus: [E2E-testiympäristö](e2e-test-environment.md).
- Kattavuus ja hyväksyntäehdot: [R0-testimatriisi](r0-e2e-test-matrix.md).
- Päätökset, välitulokset ja vanhat jatkamiskohdat:
  [M1-valmisteluhistoria](release-0.3.0-m1-history.md) ja
  [T-paketin koehistoria](e2e-test-environment-history.md).

Historiatiedoston silloiset pending-, seuraava työ- ja Goal-ilmaukset
eivät avaa suljettua toteutusvaihetta uudelleen. Epäonnistumisia tai niiden
syyepävarmuutta ei kuitenkaan poisteta historiasta.

Rajattu ohjeiden viimeistely 2026-09-29: nykyohje ja historia erotettu,
pikaohje ja lukureitit lisätty sekä sisältö katselmoitu. Suhteelliset linkit,
otsikkoankkurit, siirretyn historian säilyminen ja kolmen esimerkin tyypitys
tarkistettu. Tämä on dokumentointinäyttöä, ei uusi sovellus-/E2E-läpäisy
tai dokumenttipalan PR/main-hyväksyntä.

PR #282:n ensimmäisen dokumenttirevision `afa422bb` integraatio ei läpäissyt:
[riippuvuusauditointi](https://github.com/eky-software/eky/actions/runs/36580426753)
löysi `undici@7.29.0`-haavoittuvuuden. Omistaja hyväksyi erillisen rajatun
`7.29.1`-korjauspäivityksen ennen mergeä ja A1:tä. Lisäksi
[normaalin CI:n](https://github.com/eky-software/eky/actions/runs/36580427104)
upgrade/rollback-ajossa 2 havaittiin `publicationDeadlineExceeded`
tuloksen kirjoituksen `flush`-vaiheessa (`resultWriteFailed`). Se on
erillinen epäonnistunut havainto, ei riippuvuuspäivityksen vaikutus eikä
todistettu sovelluksen rollback-virhe. Ensimmäinen virhenäyttö on säilytetty;
sen syy ja integraation hyväksyntä ovat avoimia. Aikarajoja tai CI-ehtoja
ei muuteta riippuvuuskorjauksen perusteella.

Sama normaali CI päättyi hylättynä: 35 ryhmää läpäisi, kolme hylättiin
(kaksi suoritusryhmää ja hyväksyntäkoonti), yksi valinnainen koe ohitettiin.
Toinen suoritusvirhe oli `passiveWorkspaceMigrationFailure`-skenaarion
`targetInstall`-odotuksen aikakatkaisu. Sen prosessipuun poistuminen,
tuloksen kirjoitus ja fixturen siivous todettiin, mutta seuraava vaadittu
recovery-only-koe ei enää käynnistynyt. Idle-portti pysyi kiinni saman
Windows-istunnon `msiexec`-havainnon vuoksi. Nykyinen havaitsin ei sido sitä
target-handoffiin tai omistettuun Jobiin, joten viiveen aiheuttaja ja
mahdollinen koodivika jäävät avoimiksi. Tämä ei ole sama virhe kuin
upgrade-ajon tuloskirjoituksen viive; migraation vikainjektioon ei päästy.

Rajattu jatkoselvitys erottaa testiharnessin tuloskirjoittimen
muistipuskurin tyhjennyksen ja levylle varmistamisen omiksi suljetuiksi
havaintovaiheikseen. Tallennussuojat, viiden sekunnin julkaisuvara ja
myöhäisen tuloksen hylkäys säilyvät; kumpikin viiveraja katetaan nykyisellä
komentofixturellä, normaalin supervisorin havaintoketjun läpi.
Rajattu Windows-sopimussarja läpäisi 175/175 ilman ohituksia tai uusintoja;
käännös, riippumaton katselmus ja ohjelinkit on tarkistettu. Tämä on
diagnostiikan tarkennus, ei vanhan timeoutin todistettu korjaus. Uuden
revision integraation hyväksyntä sekä erillisen asennusodotuksen selvitys
ovat vielä avoimia. Omistava sopimus on
[Windows-harnessin ohjeessa](windows-installer-acceptance-harness-v2.md).

Revision `9756e90e` [riippuvuustarkistus 36588427564](https://github.com/eky-software/eky/actions/runs/36588427564)
läpäisi, mutta [normaali CI 36588428320](https://github.com/eky-software/eky/actions/runs/36588428320)
hylättiin ennen legacy/core-testien alkua: Corepackin pnpm-lataus päättyi
Noden sisäisen HTTP-asiakkaan assertion-virheeseen. Kokonaistulos oli 33
läpäisyä, kaksi hylkäystä (valmistelujob ja hyväksyntäkoonti) sekä kolme
ohitusta (valinnainen koe ja kaksi estynyttä legacy-jobia). Tätä ei tulkita
sovellustestin epäonnistumiseksi tai kaikkien vanhojen timeoutien korjaukseksi.

Omistaja hyväksyi 2026-09-29 rajatun valmistelukorjauksen: sama pnpm
asennetaan Noden mukana tulevalla npm:llä erilliseen ajokansioon ja sen
eheys, rekisteriallekirjoitus ja versio varmennetaan ennen käyttöä.
Yhteinen apuri korvaa nykyisten CI-kuluttajien Corepack-latauksen. Node-,
pnpm-, Electron- ja tietokantaversiot, sovelluskoodi, testikomennot,
aikarajat ja hyväksyntäehdot säilyvät. Tämä ei aloita A1:tä eikä hyväksy
mergeä ennen uuden revision omia portteja.

Revision `35ba04c033ca260f4065652e25bc46eea60bd59f`
[normaali CI 36614511596](https://github.com/eky-software/eky/actions/runs/36614511596)
läpäisi ensimmäisellä yrityksellä kaikki 38 vaadittua ryhmää; vain
valinnainen diagnostiikkakoe ohitettiin. System 695/695, kriittinen web
37/37 ja kriittinen Electron 38/38 vastasivat ajovalintoja ilman uusintoja.
Lähdepuu, neljä artifact-tuottajaa ja kymmenen packaged-kuluttajaa on
takaisinluettu. Myös [riippuvuustarkistus 36614510787](https://github.com/eky-software/eky/actions/runs/36614510787)
läpäisi. Tämä todentaa Undici- ja pnpm-valmistelukorjauksen integraation
PR:ssä, ei merge-mainia, historiallisten timeoutien syitä tai myöhemmin
hyväksyttyä Electron `43.7.6` -päivitystä. Electronin oma hyväksyntä on
kesken; `better-sqlite3 13.0.2`, tietokantamalli ja testiehdot säilyvät.

## Lukureitit

Jokainen toteutuspala aloittaa juuri-`AGENTS.md`:stä ja
[workflow'n aloitusjärjestyksestä](../ai/workflow.md#työn-aloitusjärjestys).
Paikallinen työkalurunbook ja inventaario luetaan, kun työ käyttää
Windows/WSL/Git/Node- tai release-työkaluja; ne eivät kuulu julkaistaviin tietoihin.

| Alue | Omistavat ohjeet ja tähän valmisteluun liittyvä tarkennus |
| --- | --- |
| T | [E2E-pikaohje](../ai/e2e-test-authoring-guide.md), [Desktop-ohje](../../apps/desktop/AGENTS.md), [E2E-ohje](../../apps/e2e/AGENTS.md), [testaus](../ai/testing-rules.md), [E2E-strategia](e2e-testing-strategy.md), [testimatriisi](r0-e2e-test-matrix.md), [nykyinen runtime-sopimus](e2e-test-environment.md), [Windows-harness](windows-installer-acceptance-harness-v2.md). |
| A | [Invoicing](../modules/invoicing.md), [UI-roadmapin A-suunnitelma](invoicing-ui-roadmap.md#a-paketin-valmistelu), [frontend-rakenne](web-frontend-structure.md), [UI-periaatteet](../design/ui-principles.md), [luonnoksen sopimus](invoicing-mvp-implementation-plan.md), [hyväksyntä](invoice-approval-numbering-plan.md), [virheketju](error-handling-principles.md). |
| W7 | [ADR-0011](../decisions/ADR-0011-local-multi-workspace-company-model.md), [ADR-0008](../decisions/ADR-0008-local-desktop-company-workspaces.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [W7-päätösportti](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti), [backup/restore](local-backup-and-restore-plan.md), [recovery-runbook](local-restore-recovery-runbook.md). |
| Yhteiset portit | [Turvallisuus](security-principles.md), [katselmointi](../ai/review-checklist.md), [observability/audit](observability-and-audit-plan.md), [moduulien integraatiomatriisi](module-integration-matrix.md), [valmistumisportti](../ai/workflow.md#toiminnon-valmistumisportti). |

Toteutus lukee lisäksi jokaisen todellisuudessa muuttuvan kansion ohjeet.
Tämä taulukko ei anna lupaa ohittaa tarkempaa backup-, salaisuus-, päivitys-
tai riippuvuusporttia, jos rajaus myöhemmin koskettaa niitä.

## Rajattu toteutusjärjestys

| Pala | Muutos ja valmistumisen näyttö | Edellytys ja päätösraja |
| --- | --- | --- |
| T1a / R27 | Startup-failure-testit tavalliseen desktop-testivalintaan ja valinnan regressiosopimus. | Hyväksytty; paikallisen näytön lisäksi PR/main-portit läpäisty. Ei tuotantokoodia. |
| T1b / R27 | Kuusi puuttuvaa installer-harness-testitiedostoa nykyisten vaadittujen komentojen kautta ajettaviksi, myös ajokytkentää suojaava testi. | Hyväksytty T1a:n kanssa; R27 suljettu. Ei raskaan CI:n kevennystä. |
| T2 / R29 | `security`/`fault`-projektivalinnan ja koko build-ketjun vastaavuus puhtaasta, vanhentuneesta ja epäonnistuneesta valmistelusta. | Hyväksytty; paikallinen näyttö, Linux-CI sekä PR/main-portit läpäisty. [Integraatio](release-0.3.0-m1-history.md#t2n-integraatiohyväksyntä). |
| T3 / R28 | Omistajuus käynnistyksestä todettuun koko puun poistumiseen; epävarma cleanup ei hyväksy restartia tai poista fixtureä. | Oikeat Windows-/Linux-kuluttajat, kohdistettu katkeamis-/endurance-matriisi, korvattujen varapolkujen poisto ja Windows-regressio hyväksytty. [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) sulkee lopullisen PR/main-portin. [Sulkulista](release-0.3.0-m1-history.md#t3n-nykyinen-työjärjestys) säilyttää hyväksynnän rajauksen; historiallisia hylkäyksiä ei muuteta. |
| A1 / R01 | Luonnoksen avaamisen kohde, näkyvät arvot ja tallennuksen kohde pysyvät samana myös vastausten valmistuessa väärässä järjestyksessä. | T1 ensin; hyväksyntään käytettävän E2E-fixturen T3-puute korjattu ja sen build-valinta todennettu. |
| A2 / R05, A3 / R06 | Ensimmäisen createn tunnisteen säilyminen ja muokatun lomakkeen vanhentunut readiness. | Omat rajatut jatkopalat; A1:n hyväksyntä ei sulje niitä. Backendin hyväksyntäauktoriteetti säilyy. |
| W7-valmistelu | Omistajan hyväksyttävä poisto-, karanteeni-, palautus- ja nollan työtilan sopimus. | Suunnittelu kulkee rinnalla; toteutus tarvitsee C/K/G/H:n nimetyt kyvykkyydet. |

T1/T2/T3:n toteutus ja integraatio ovat valmiit. A1 käyttää niiden nykyistä
testiruntimea eikä avaa alustamekanismien tutkimusta uudelleen.
Kaikkia I-paketin ohjetarkistuksia ei tehdä ennen A:ta. Myöhemmät B/C/K-rajat
säilyvät roadmapin mukaisina, eivät muutu tämän taulukon sivuvaikutuksena.

## Skannaushavaintojen vaikutus jatkoon

S030-01-S030-05:n omistus ja tarkat päätösrajat ovat
[roadmapin skannaustäydennyksessä](release-0.3.0-plan.md#skannauksen-tuoma-täydennys).
M1 vahvistaa työjärjestyksen kannalta seuraavat rajat:

- K:n schema-attestointi ja eristetty tarkistus ovat eri velvoitteita.
  Pelkkä salaus, migraatioledger, readonly tai Promise-timeout ei korvaa niitä.
  Myös pelkkä Inspect kuuluu tarkistuksen rajaukseen, ei vain import/restore.
- B ratkaisee toimitusrevision, PDF:n ehdollisen julkaisun ja peruutuksen
  atomisen varauksen yhteensopivasti, pieninä erikseen testattuina paloina.
  SMTP-verkkokutsua ei pidetä SQLite-transaktion sisällä.
- Skannerin schema-uudelleenrakennusehdotus ei hyväksy koko kannan
  uudelleenkirjoitusta. Attestoinnin omistaja, kanonisointi, historian
  yhteensopivuus ja mahdollinen metadata hyväksytään ennen toteutusta.
- Vanhentunut sähköpostiesikatselu, saman scheman rollback, body-/lokimäärärajat
  ja testipolkujen containment säilyvät rajattuina tarkistustehtävinä,
  eivät uusina vahvistettuina löydöksinä.

Tulevat testit käyttävät synteettisiä nyky- ja historiallisia backuppeja,
muutettuja schema-objekteja, rajattua raskasta kyselyä ja fake-providerin
hallittuja välivaiheita. Näitä ei ajettu tämän valmistelun yhteydessä.

## Valmistumisportti pala kerrallaan

| Näkökulma | T1-T3 | A1-A3 | W7 |
| --- | --- | --- | --- |
| Testit | Valinta, prerequisite, failure ja todellinen cleanup. | Hallitut vastausjärjestykset, todellinen UI sekä backendin jälkiluku; ei PASS tarkoittaa bugia -probea hyväksynnäksi. | Jokainen durable-raja, muut yritykset ja saman artifactin hardened Windows -polku. |
| Ilmoitukset | Testin alkuperäinen virhe erillään cleanup-/näyttövirheestä. | Nykyisen kohteen turvallinen suomenkielinen tila; vanha vastaus ei poista virhettä tai busy-tilaa. | Vahvistus, peruutus, recovery, lopullisuus ja ulkopuolelle jäävät kopiot ymmärrettäviksi. |
| Diagnostiikka | Testiharnessin rajattu näyttö, ei tuotannon business-auditia. | Vanhentuneen lukutuloksen hylkäys ei ole business-muutos. Nykyinen virheketju tarkistetaan; ei laskun sisältöä teknisiin lokeihin. | G/H:n todellinen observer- ja lukuketju; journalin virhe erotetaan best-effort-lokin virheestä. |
| Palautettavuus | Epävarma siivous säilyttää testijuuren; koodirevert ei siivoa orpoa prosessia. | Ei DB/schema-migraatiota A1:ssä; koodin peruminen ei korjaa aiemmin väärään kohteeseen tallennettua tietoa automaattisesti. | Oma hyväksytty quarantine/recovery/purge-sopimus; ei arvaavaa palautusta. |
| Dokumentaatio | Komennot, E2E-ympäristö ja matriisin todellinen taso. | Omistava UI-suunnitelma, testimatriisi ja muuttuneen toiminnon käyttöohje. | ADR-täsmennykset, workspace/backup/secret/retention/diagnostiikka ja käyttö-/recovery-ohje. |

Muuttunut tuotantolifecycle, backup/restore, SQLite, business-artifact,
`safeStorage` tai aktiivisen profiilin polku vaatii juuri-AGENTS:n packaged
backup -> inspect -> restore -> restart -> compare -portin. Installer ja
automaattipäivitys ovat erillisiä portteja. Testiharness-only-muutoksen
soveltuvuus perustellaan erikseen; T:n testiajot eivät todista W7:n tuotantoa.

## Päätösjono ja valmistelun lopetus

Ensimmäinen hyväksytty toteutusraja T1a/T1b on valmis.
Myös T2:n paikallinen näyttö, Linux-CI ja PR/main-integraatio on hyväksytty.
Myös [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) on kirjattu: mekanismi,
oikeat kuluttajat, korvatun aktiivisen toteutuksen poisto ja pysyvä matriisi
eivät enää ole avoimia toteutuskohtia. T3a/T3b:n alkuperäiset päätökset,
kokeiden rajoitukset ja hylkäykset säilyvät historiassa. Nykyinen
[Jatka tästä](#jatka-tästä) erottaa suljetun integraatiojatkon
seuraavasta A1/R01-tuotantopalasta. A1 käyttää nykyistä
feature-/API-sopimusta; jos rajaus vaatii
backendin tai navigoinnin uuden liiketoimintasäännön, se palautuu suunnitteluun.
W7:n päätöksiä ei kysytä yhtenä epämääräisenä lupana, vaan sen omistavan
suunnitelman päätöstaulukon mukaan ennen kunkin vaikutusalueen toteutusta.

Alkuperäisen M1-valmistelun hyväksyntä ja sen rajaus säilyvät
[valmistelun checkpointissa](release-0.3.0-m1-history.md#valmistelun-checkpoint).
Sen jälkeen hyväksytyt T1/T2/T3:n toteutukset eivät sulje A/W7:n tai koko
0.3.0:n valmistumisportteja. Jokaisen seuraavan palan suunnitelma, rajaus,
testit ja ohjeet tarkistetaan ennen toteutusta ja sen valmistuessa.
