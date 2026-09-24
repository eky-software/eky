# 0.3.0 M1 -valmistelu

## Tila ja valtuus

Omistajan hyväksymä suunnittelu-Goal, valmisteltu ja katselmoitu 2026-09-24. Tämä dokumentti
omistaa M1:n rajauksen ja toteutukseen siirtymisen portin. Julkaisun sisältö
ja työpakettien kokonaistila pysyvät [roadmapissa](release-0.3.0-plan.md).
Omistavat dokumentit alla määrittävät tarkat ehdot, eivät rinnakkaista backlogia.

Valmistelu ei toteuta sovellus- tai testikoodia, schemaa, riippuvuuksia,
versiota, CI-politiikkaa tai uusia turvallisuus-/liiketoimintasopimuksia.
Toteutus aloitetaan rajatun suunnitelman hyväksynnän jälkeen. Yksittäisen
päätösportin keskeneräisyys ei estä muun riippumattoman palan valmistelua.

**T1a/T1b 2026-09-25: toteutettu ja paikallisesti todennettu.** Omistaja hyväksyi
vain alla rajatun testien ajokytkennän ja sen regressiosuojan sekä normaalin
PR/main-integraation vaadittujen porttien jälkeen. T2/T3/A/W7 eivät kuulu
tähän toteutus-Goaliin. Suunnittelu säilyy erillisenä checkpointina;
toteutuksen näyttö ja integraation erillinen portti ovat alla.

## Lähtötilan näyttö

- M0:n hyväksytty main on `38082dffe1772f099c4b9bb7495bed6c6b9b067b`.
  Paikallinen ja etäinen main sekä juuri tämän revision V2- ja
  riippuvuustarkistusten onnistuminen varmistettiin ennen valmistelua.
  Viitteet ovat [roadmapin nykytilassa](release-0.3.0-plan.md#päätös-ja-nykyinen-tila).
- M0:n integraatiota varten tehdyt harness-korjaukset koskevat erillistä
  supervisor- ja Electron-testiharnessia. Ne eivät sulje R27-R29:ää tai
  tuotantokoodin korjauspaketteja. M0 sisälsi myös aiemman hotfix-haaran integraation.
- Aiempi R01-R31-katselmus ja keskeytetyn Deep Scanin 13 tallennettua
  havaintoa luettiin. S030-01-S030-05 ovat suunnitteluryhmiä, eivät uusi
  skanneriluokitus. Keskeytettyä ajoa ei jatkettu tai käynnistetty uudelleen.
- Skannauksen tuotantolähdealueet ja A:n web-lähteet eivät ole muuttuneet
  katselmusrevisiosta. Staattinen vastaavuus ei korvaa korjauksen regressiota.
- Testikytkennät, A-suunnitelma ja W7-pohja katselmoitiin kolmella erillisellä
  read-only-agentilla. Täsmennykset tarkistettiin vielä korjausten jälkeen.
  Tässä valmistelussa ei ajettu sovellusta, testimatriisia, asenninta tai
  oikeita profiileja. Aiemmat läpäisyt pysyvät historiallisina tuloksina.

## Lukureitit

Jokainen toteutuspala aloittaa juuri-`AGENTS.md`:stä ja
[workflow'n aloitusjärjestyksestä](../ai/workflow.md#työn-aloitusjärjestys).
Paikallinen työkalurunbook ja inventaario luetaan, kun työ käyttää
Windows/WSL/Git/Node- tai release-työkaluja; ne eivät kuulu julkaistaviin tietoihin.

| Alue | Omistavat ohjeet ja tähän valmisteluun liittyvä tarkennus |
| --- | --- |
| T | [Desktop-ohje](../../apps/desktop/AGENTS.md), [E2E-ohje](../../apps/e2e/AGENTS.md), [testaus](../ai/testing-rules.md), [E2E-strategia](e2e-testing-strategy.md), [testimatriisi](r0-e2e-test-matrix.md), [T-suunnitelma](e2e-test-environment.md#t-paketin-valmistelu), [Windows-harness](windows-installer-acceptance-harness-v2.md). |
| A | [Invoicing](../modules/invoicing.md), [UI-roadmapin A-suunnitelma](invoicing-ui-roadmap.md#a-paketin-valmistelu), [frontend-rakenne](web-frontend-structure.md), [UI-periaatteet](../design/ui-principles.md), [luonnoksen sopimus](invoicing-mvp-implementation-plan.md), [hyväksyntä](invoice-approval-numbering-plan.md), [virheketju](error-handling-principles.md). |
| W7 | [ADR-0011](../decisions/ADR-0011-local-multi-workspace-company-model.md), [ADR-0008](../decisions/ADR-0008-local-desktop-company-workspaces.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [W7-päätösportti](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti), [backup/restore](local-backup-and-restore-plan.md), [recovery-runbook](local-restore-recovery-runbook.md). |
| Yhteiset portit | [Turvallisuus](security-principles.md), [katselmointi](../ai/review-checklist.md), [observability/audit](observability-and-audit-plan.md), [moduulien integraatiomatriisi](module-integration-matrix.md), [valmistumisportti](../ai/workflow.md#toiminnon-valmistumisportti). |

Toteutus lukee lisäksi jokaisen todellisuudessa muuttuvan kansion ohjeet.
Tämä taulukko ei anna lupaa ohittaa tarkempaa backup-, salaisuus-, päivitys-
tai riippuvuusporttia, jos rajaus myöhemmin koskettaa niitä.

## Rajattu toteutusjärjestys

| Pala | Muutos ja valmistumisen näyttö | Edellytys ja päätösraja |
| --- | --- | --- |
| T1a / R27 | Startup-failure-testit tavalliseen desktop-testivalintaan ja valinnan regressiosopimus. | Toteutettu ja paikallisesti todennettu; integraation hyväksyntä erikseen. Ei tuotantokoodia. |
| T1b / R27 | Kuusi puuttuvaa installer-harness-testitiedostoa nykyisten vaadittujen komentojen kautta ajettaviksi, myös ajokytkentää suojaava testi. | T1a:n kanssa sama rajattu toteutus voi olla järkevä; R27 suljetaan vasta molempien näyttöjen jälkeen. Ei raskaan CI:n kevennystä. |
| T2 / R29 | `security`/`fault`-projektivalinnan ja niiden koko build-ketjun vastaavuus puhtaasta ja vanhoja tuotteita sisältävästä lähtötilasta. | Suositus säilyttää kaikki kolme standardiprojektia ja erottaa endurance eksplisiittisesti. Tarkka komentorajaus hyväksytään ennen muutosta. |
| T3 / R28 | Omistajuus käynnistyksestä todettuun koko puun poistumiseen; epävarma cleanup ei hyväksy restartia tai poista fixtureä. | Windowsin ja POSIXin omistajuusmekanismi sekä Electron-käyttö päätetään erikseen lähdekatselmuksen jälkeen. Pelkkä early returnin poisto ei riitä. |
| A1 / R01 | Luonnoksen avaamisen kohde, näkyvät arvot ja tallennuksen kohde pysyvät samana myös vastausten valmistuessa väärässä järjestyksessä. | T1 ensin; hyväksyntään käytettävän E2E-fixturen T3-puute korjattu ja sen build-valinta todennettu. |
| A2 / R05, A3 / R06 | Ensimmäisen createn tunnisteen säilyminen ja muokatun lomakkeen vanhentunut readiness. | Omat rajatut jatkopalat; A1:n hyväksyntä ei sulje niitä. Backendin hyväksyntäauktoriteetti säilyy. |
| W7-valmistelu | Omistajan hyväksyttävä poisto-, karanteeni-, palautus- ja nollan työtilan sopimus. | Suunnittelu kulkee rinnalla; toteutus tarvitsee C/K/G/H:n nimetyt kyvykkyydet. |

T3:n mekanismin selvitys voidaan tehdä T1/T2:n rinnalla. A1:n alemman tason
regressioita voidaan valmistella ennen T3:a, mutta tunnetusti puutteellinen
cleanup ei kelpaa lopullisen oikeaprosessiajon onnistumistodisteeksi.
Kaikkia I-paketin CI-uudistuksia ei tehdä ennen A:ta. Myöhemmät B/C/K-rajat
säilyvät roadmapin mukaisina, eivät muutu tämän taulukon sivuvaikutuksena.

## Ensimmäinen hyväksytty toteutuspala

**T1a + T1b, vain olemassa olevien testien ajokytkentä ja sen suojaus.**
Omistaja hyväksyi tämän rajauksen ennen koodimuutoksia. Muutospinta on
desktopin scripts-valinta ja sen nykyinen testisopimus, sekä tarpeelliset
dokumentti-/testimatriisitäsmennykset. Nykyiseen vaadittuun komentoon
liittäminen on ensisijainen; uutta workflowta tai yleistä testirunneria ei
lisätä vain tätä varten.

Seitsemän tiedoston lähtöluettelo ja ehdotettu komentojako on kirjattu
[T1:n omistavaan suunnitelmaan](e2e-test-environment.md#t1-testien-ajokytkentä).
Startup-testi ja uuden wiring-testin oma kytkentä tulevat tavalliseen
desktop-`test`-komentoon. Viisi installer-tiedostoa tulee
`installer:test:unit`-komentoon ja binary-handoff-tiedosto nykyiseen
sarjalliseen `installer:test:windows-process`-komentoon. Molemmat installer-
vaiheet kuuluvat nykyiseen `windowsContracts`-hyväksyntäketjuun.
Toteutuksessa todennetaan koko reitti testitiedostosta package-komennon ja
workflow/job-vaiheen kautta required-aggregaattiin. Nykyiset testit,
native-esiehdot ja prosesseja omistavan testin sarjallisuus säilyvät.

Hyväksyntä ei perustu pelkkään `package.json`:in tekstihakuun:

1. Valinnan sopimustesti tunnistaa puuttuvan, väärän tai katkenneen
   komentoreunan. Negatiivinen fixture poistaa yhden vaaditun tiedoston tai
   kutsun ja todistaa, että tarkistus hylkää sen. Myös wiring-testin oma
   ajokytkentä, väärä komentoryhmä ja sarjallisuuslipun puuttuminen testataan.
2. Tavallinen desktop-komento todella suorittaa startup-failure-tiedoston.
   Sen nykyiset seitsemän tapausta eivät saa muuttua ohitetuiksi.
3. `installer:test:unit` suorittaa viisi ja `installer:test:windows-process`
   yhden aiemmin irrallisen tiedoston; tarkka valinta ja päättynyt tulos kirjataan.
4. Tarpeelliset typecheck-, workspace- ja CI-sopimukset läpäisevät.
   Käytä nykyistä riskiluokitusta. Jos manifestimuutos valitsee raskaan
   matriisin, sitä ei kierretä docs-only-luokituksella tai suodattamalla.
5. Riippumaton diff-katselmus, yksityisyyden tarkistus, täsmällisen PR-pään
   vaaditut portit, normaali merge ja täsmällisen mainin omat portit.
   Ajonaikainen [CI-seuranta](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet)
   alkaa ajon alussa; ensimmäinen virhe säilytetään ennen uusintaa.

Hylätty testi pysäyttää tämän palan hyväksynnän. Korjausta ei naamioida
testin poisjättämiseksi, pidemmäksi aikarajaksi tai retry-läpäisyksi.
Jos testi paljastaa tuotantovirheen, se rajataan ja päätetään erikseen.

### T1:n toteutus ja hyväksyntänäyttö

2026-09-25: seitsemän olemassa olevaa tiedostoa on kytketty yllä nimettyihin
komentoihin. `scripts/test-command-wiring.test.mjs` suojaa tiedostojen,
runnerien, build-esiehdon, sarjallisuuden ja required-CI-ketjun vastaavuuden.
Sen 58 tapausta sisältävät oman ajokytkennän sekä puuttuvien, väärien,
ohitettujen ja epäonnistuneiden vaiheiden kielteiset kokeet. Kaikki
aiemmat manifestin testivalinnat säilyvät. Riippumaton diff-katselmus ei
löytänyt korjattavaa tästä rajauksesta.

Valmistuneet paikalliset tarkistukset:

- Tavallinen desktop-komento suoritti startup-failure-tiedoston kaikki
  seitsemän tapausta. Desktop: 1529 Vitest-läpäisyä, kolme ennestään
  alustarajattua ohitusta ja 139 Node-läpäisyä; ohitukset eivät ole läpäisyjä.
- Installer-unit 113/113, mukaan liitettyjen viiden tiedoston 19 tapausta
  mukaan lukien. Sarjallinen Windows-prosessikomento 13/13, joista kuusi
  binary-handoff-tapauksia; supervisorin build-esiehto säilyi.
- Koko workspace 3839 läpäisyä ja kahdeksan ennestään alustarajattua
  ohitusta. Typecheck, backend/web/desktop-buildit ja 55 CI-sopimusta
  läpäisivät. Ajot valmistuivat ensimmäisillä yrityksillä.

Tämä on testiajokytkennän näyttö, ei tuotannon backup-, lifecycle- tai
asennushyväksyntä. Muutos ei lisää tuotannon tapahtumia, käyttöliittymää,
schemaa, salaisuuskäsittelyä tai pysyviä business-artifacteja, joten niiden
Diagnostics-/Activity-/tukipakettiketjut ja packaged backup -portti eivät
muutu T1:n vuoksi. Testitulokset ja virheet kulkevat nykyisten runnerien
ja CI:n kautta. Riippuvuudet, sovellusversio, aikarajat ja CI-ehdot säilyvät.

R27:n integraation hyväksyntä kirjataan tämän muutoksen PR:n
integraatiocheckpointiin: tarkka head, todellinen checkout, run ID ja
yritys, valitut required-portit sekä normaalin mergen jälkeisen mainin
omat tarkistukset. Paikallinen läpäisy ei korvaa tätä porttia. T2/R29,
T3/R28, A ja W7 pysyvät erillisinä avoimina jatkopaloina.

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

Ensimmäinen hyväksytty toteutusraja on T1a/T1b yllä.
T2:n projektisopimus ja T3:n omistajuusmekanismi ratkaistaan ennen niiden
muutoksia. A1 käyttää nykyistä feature-/API-sopimusta; jos rajaus vaatii
backendin tai navigoinnin uuden liiketoimintasäännön, se palautuu suunnitteluun.
W7:n päätöksiä ei kysytä yhtenä epämääräisenä lupana, vaan sen omistavan
suunnitelman päätöstaulukon mukaan ennen kunkin vaikutusalueen toteutusta.

M1-valmistelu voidaan päättää, kun lähtötila, lähdehavainnot, ensimmäinen
pala, päätösjono ja hyväksyntäportit on kirjattu ja riippumattomasti
katselmoitu sekä muutettujen ohjeiden lukureitit tarkistettu. Tämä sulkee
vain suunnittelu-Goalin. T/A/W7 tai 0.3.0 eivät silloin ole toteutettuja.

### Valmistelun checkpoint

2026-09-24: rajaus, lähdehavainnot ja päätösjono katselmoitu. T1:n täsmällinen
komentojako, A2:n tallennetun revision ehto ja W7:n kielteiset backup-testit
sekä artifact-kohtaiset lopputilat täsmennettiin katselmusten perusteella.
Muuttuneiden viiden dokumentin suhteelliset linkit ja otsikkoankkurit
tarkistettiin; diff- ja julkaisusisällön tarkistus tehtiin.
Tämä on dokumentointinäyttöä, ei sovelluksen testiläpäisy.
T1a/T1b valmistui rajattuun toteutuspäätökseen; myöhempi hyväksyntä ja
toteutustila ovat dokumentin alussa. T2/T3/W7:n nimetyt
päätösportit säilyvät auki ennen kyseisten sopimusten toteutusta.
