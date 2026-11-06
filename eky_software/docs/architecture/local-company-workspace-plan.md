# Eky Local Company Workspace -toteutussuunnitelma

## Tila

Nykyinen hyväksyntä- ja jatkotila on
[M1:n Jatka tästä -kohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Alla oleva tilannekuva ja checkpointien päivätyt tulokset ovat vaihehistoriaa.
Niiden sopimusrajat säilyvät; vanha odotusmerkintä ei kumoa myöhempää
hyväksyttyä toimitusta. W7:n erillinen päätösportti pysyy voimassa.

### Alkuperäinen vaihetilanne

Suunniteltu kokonaisuus. W0:n arkkitehtuuri- ja hyväksymissopimus sekä W0.1:n
lifecycle-tarkennukset on dokumentoitu. W1:n inertti foundation on yhdistetty
vihreänä `main`-haaraan commitissa `687a424`. W2:n tyhjän työtilan luonnin
inertti foundation on yhdistetty vihreänä `main`-haaraan commitissa
`3529840`. W2.1 koventaa yhteiset workspace-sopimukset, runtimen palautuksen
ja startup-recoveryn runtime-poissaolorajan ennen W3:a. W3:n uuden lineagen
backup-import on toteutettu inerttinä foundationina omalla feature-haarallaan.
W1-W3:n foundation on toteutettu ja W4 on aktivoinut registryyn sidotun
startupin, legacy-profiilin kertaluonteisen adoption sekä workspace-kohtaiset
runtime-resurssit production-compositionissa. W5 on jaettu Electron mainin
sisäiseen W5A management-foundationiin ja erikseen hyväksyttävään W5B
renderer/UI-toimitukseen. W5A on toteutettu ja hyväksytty paikallisella
testimatriisilla. W5B.1:n turvallinen workspace-valitsin sekä status-, create-,
import-as-new-, switch- ja rename-capabilityt on toteutettu ja hyväksytty
paikallisesti. Aktiivisen exact-lineage-workspacen replace-UI kuuluu W5B.2:een
ja W6:n täysi paketoitu usean työtilan release-matriisi on edelleen
toteuttamatta. Käyttäjälle ei julkaista tätä kokonaisuutta ennen W5B-W6-
porttien valmistumista.

Tämä suunnitelma toteuttaa
`docs/decisions/ADR-0011-local-multi-workspace-company-model.md`-päätöksen
pieninä, erikseen katselmoitavina checkpointteina.

## Tavoite

Eky Local tukee samalla Windows-käyttäjällä useita erillisiä paikallisia
yritystyötiloja siten, että:

- vain yksi työtila on aktiivinen kerrallaan
- jokainen työtila omistaa oman SQLite- ja business-artifact-juurensa
- renderer ei saa polkuja, sessionia tai salaisuuksia
- backendin `companyId` tulee aina aktiivisen työtilan validoidusta
  runtime-identiteetistä
- backup/restore käsittelee yhtä lineagea eikä yhdistä työtiloja
- installer ja update säilyvät asennustasoisina
- vanha 0.2.6-profiili adoptoidaan fail-closed-mallilla.

## Yritysvalitsimen nimien yksilöllisyys

**Omistajan päätös 23.10.2026, hyväksytty suunnitteluun:** saman
EKY-asennuksen yritysvalitsimessa ei luoda uutta samannimistä työtilaa
luonnissa, backupin tuonnissa uutena yrityksenä tai nimenmuutoksessa.
Kirjainkoko, alku-/loppuvälilyönnit tai ylimääräiset sanojen väliset
välilyönnit eivät saa kiertää estoa. Kaikki kolme polkua käyttävät samaa
vertailusääntöä ja tarkistavat myös passiivisten sekä vikatilaisten
rekisteröityjen työtilojen nimet. Nimenmuutoksessa oma kohde ei ole
itsensä kaksoiskappale. Tarkka Unicode-/vertailusopimus ja kilpailutilanteen
torjuva kytkentä nykyiseen mainin omistajuuteen määritetään ennen toteutusta.

Varatusta nimestä annetaan turvallinen palaute: "Tällä nimellä on jo yritys
EKYssä. Valitse toinen nimi." Tuonnissa käyttäjä voi valita toisen
`workspaceLabel`-nimen muuttamatta kopion varsinaisia yritys- tai laskutietoja.
Nimi ei korvaa `workspaceId`-, `companyId`- tai lineage-tunnistetta eikä anna
lupaa yhdistää, korvata tai poistaa työtiloja nimen perusteella.

Tämä muuttaa W1-W5:n aiempaa samat labelit sallinutta sääntöä; alla olevat
vaiheiden tulokset ovat sen toteutushistoriaa. Tuotantokoodi ja testit
noudattavat vielä aiempaa sääntöä.

**Vanhojen nimikaksoiskappaleiden omistajapäätös 23.10.2026:** jo olemassa
olevat samannimiset työtilat säilytetään muuttamattomina ja käyttäjälle
näytetään huomautus. Nimiä ei muuteta automaattisesti eikä tietoja yhdistetä
tai poisteta. Käyttäjä voi itse valita erottuvan näyttönimen. Uusi nimisääntö
ei ole vanhan rekisterin lukuesto eikä estä aiemmin käyttökelpoisen yrityksen
avaamista pelkän samannimisyyden vuoksi. Muut eheys-, käyttöoikeus- ja
recovery-portit säilyvät. Turvallinen valinta ja poisto sidotaan edelleen
täsmälliseen `workspaceId`:hen; huomautuksen ja erottelun esitystapa
täsmennetään tekniseen toteutussopimukseen.

Regressiot kattavat kolme
kirjoituspolkua, kirjainkoko-/välilyöntivariantit, oman nimen säilyttämisen,
kilpailevat operaatiot, tuonnin sisällön säilymisen sekä vanhan rekisterin
luvun ja huomautuksen ilman nimien tai yritystietojen automaattista muutosta.

### W7.0:n nimivertailun koesopimus

Yksilöllisyys käyttää yhtä mainin registry-omistajan vertailuavainta:
nykyinen `validateWorkspaceLabel` ensin, sitten NFC-normalisointi,
ECMAScriptin `\s+`-välilyöntijaksojen korvaaminen yhdellä välilyönnillä,
locale-riippumaton `toLowerCase().toUpperCase()` ja lopuksi NFC. Tämä on
täsmällinen vertailusääntö, ei lupaus kaikkien samannäköisten merkkien tai
kielikohtaisten nimivastineiden tunnistamisesta. NFKC:tä, aksenttien poistoa,
välimerkkien poistoa tai sumeaa hakua ei käytetä. Kelvollisia merkkejä ei
poisteta näkymättömyyden perusteella.

Alkuperäinen 1-80 koodipisteen raja, kontrollimerkkien ja rikkinäisen
Unicoden hylkäys sekä valmiiksi trimmatun arvon vaatimus säilyvät. Nykyinen
UI trimmaa syötteen ennen pyyntöä; main ei hyväksy trimmauksetonta ohitusta.
Validointi edeltää normalisointia, joten kielletty rivinvaihto tai tab ei
muutu sallituksi välilyönniksi. Vertailuavaimen mahdollinen piteneminen
kirjainkokomuunnoksessa ei muodosta uutta näyttönimen pituusrajaa.
Näyttönimeä ei tallennettaessa korvata avaimella, eikä avainta tallenneta
uutena tietokenttänä. Tulevat runtime-päivitykset toistavat vertailuvektorit;
Unicode-toteutuksen muutosta ei tulkita luvaksi muuttaa vanhoja nimiä.

| Esimerkit | Yksilöllisyysvertailu |
| --- | --- |
| `Malliyritys Oy`, `MALLIYRITYS  OY`, sanojen välissä NBSP tai kapea NBSP | Sama nimi. |
| `Café` ja sama nimi hajotetulla e + yhdistävä aksentti -esityksellä | Sama nimi; `Cafe` ilman aksenttia on eri nimi. |
| `Straße`, `STRAẞE`, `STRASSE` | Sama nimi kirjainkokomuunnoksen laajenemisen vuoksi. |
| `AB`, `A B`, `A-B` | Eri nimiä; sanoja tai välimerkkejä ei poisteta. |
| Latinalainen A, kyrillinen А ja täysleveä Ａ | Eri merkkejä. Nimi ei ole turvallisuusidentiteetti. |

Luonti ja tuonti käyttävät samaa append-tarkistusta kaikkia rekisterin
entryjä vastaan, myös passiivisia ja `recoveryRequired`-kohteita.
Nimenmuutos ohittaa vain oman, workspaceId:llä löydetyn kohteensa.
Täsmälleen vanhan labelin säilyttävä no-op on sallittu myös historialliselle
nimikaksoiskappaleelle. Muutettu label, myös pelkkä kirjainkoko-/välimuutos,
ei saa törmätä toiseen entryyn. Historialliset samannimiset eivät estä
registry v1/v2:n lukemista; huomautus ryhmittelee niiden nykyiset
workspaceId:t muuttamatta entryjä, lineagea tai aktiivivalintaa.

Nykyiset `EmptyWorkspaceCreationCoordinator`, `WorkspaceBackupImportCoordinator`
ja `WorkspaceLabelRename` säilyvät kutsujina. Nimitarkistus tehdään
ensimmäisestä leasen alla luetusta registrystä ennen uuden yrityksen
valmistelua sekä uudelleen lopullista julkaisua suojaavasta registry-
valinnasta. Pelkkä ennen odotusta saatu "vapaa nimi" ei riitä. W7.1:n
kytkentä todistaa nykyisillä omistajilla kilpailun, luonti-/tuontijournalin
keskeytyksen ja turvallisen virhemuunnoksen; uusi nimipalvelu ei ole tarpeen.
Vanhan journalin kohde ja jo julkaistu entry eivät muutu toiseksi yritykseksi
nimiristiriidan vuoksi.

**Poistovahvistus on eri vertailu:** molemmat labelit validoidaan nykyisellä
säännöllä ja verrataan NFC-muodossa täsmälleen. Kirjainkokoa tai sisäisiä
välilyöntejä ei yhdistetä. UI näyttää ja säilyttää vahvistettavan labelin
täsmälliset välilyönnit. Vahvistus sitoutuu silti mainin valitsemaan
workspaceId:hen, ajantasaiseen entryyn ja samaan sallittuun ikkunasukupolveen;
nimitäsmäys ei myönnä poistolupaa tai erota vanhoja nimikaksoiskappaleita.
Niille näytetään myös mainin antama turvallinen workspace-erotin.

**Rajattu koesopimus katselmoitu, ei tuotantokytkentää:** puhdas vertailu-/mutation-ehdokas
läpäisi 56 uutta tapausta, 58 nykyistä rekistericodecin regressiota ja
tyyppitarkistuksen. Rajattu katselmus ja kolmen täydentävän virheellisen
rekisterin tapauksen jälkitarkistus eivät jättäneet avoimia löydöksiä. Näyttö koskee
syöterajoja, vertailuvektoreita, historiallisten tavujen säilymistä ja
tuoreen registry-arvon vaatimusta. Se ei todista oikeaa IPC-/UI-kytkentää,
kahden kirjoittajan poissulkua, journal-recoverya, Electron-runtimea tai
fyysistä poistoa. Ne säilyvät W7.1-W7.5:n tuotantoporteissa.

### W7.1:n toteutusraja

**25.10.2026, hyväksytty PR #320:n ja mainin omilla porteilla:** registry omistaa yhden
vertailuavaimen sekä append-/rename-eston. Create ja import tarkistavat nimen
ensimmäisestä leasen alla luetusta rekisteristä ja uudelleen juuri ennen
root-julkaisua; creation käyttää myös tuoretta publication-registryä eikä
kirjoita vanhaa jäsenjoukkoa myöhemmin havaitun tilan päälle. Jo julkaistun
vanhan journalin kohdetta ei nimetä tai poisteta uudelleen nimiristiriidan
vuoksi. Sen nykyinen omistaja säilyttää fail-closed-recoveryrajan.

Nimiristiriidan sisäiset koodit ovat `WORKSPACE_CREATION_LABEL_EXISTS`,
`WORKSPACE_IMPORT_LABEL_EXISTS` ja niiden yhteinen management-projektio
`WORKSPACE_MANAGEMENT_LABEL_EXISTS`; labelia ei sisällytetä virheeseen.
Nykyinen capability säilyttää turvallisen koodin. App-adapteri tunnistaa
vain tarkan koodin tai kyseisen create/import/rename-kanavan Electron-
kuljetuksen tarkan kääreen, ei vapaata virhetekstin osahakua. Web näyttää
yllä sovitun suomenkielisen palautteen; muut virheet säilyttävät fallbackin.

Vanhojen nimikaksoiskappaleiden huomautus johdetaan mainin samasta
vertailuavaimesta. Nykyisen status v1:n rajattu lisäprojektiokenttä on
valinnainen `duplicateWorkspaceLabelIds`: vain statuksessa jo olevia
workspaceId-arvoja, kukin kerran, 2-64 tunnistetta. Main lisää sen vain
ristiriidan löytyessä. Molemmat strict-lukijat tunnistavat tämän nimetyn
kentän; muut lisäkentät, vieras tai toistettu ID, harva taulukko ja väärä
tyyppi hylätään. Projektio kopioidaan ja jäädytetään vastaanottorajalla.
32 KiB:n statusraja ja kaikki nykyiset entry-rajat säilyvät. Vanha kentätön
status on edelleen luettavissa, mutta se ei ole todistus nimien
yksilöllisyydestä. Tämä on saman asennusbuildin sisäinen luku-DTO, ei uusi
registry-kenttä tai pysyvä formaatti. Vanhat labelit ja tavut eivät muutu.
UI ei toteuta rinnakkaista vertailusääntöä, käytä nimeä identiteettinä tai
estä avaamista pelkän nimihuomautuksen vuoksi. Ristiriitaisessa ryhmässä
näytetään jo sallittu opaque workspaceId erottimena, ei business-companyId:tä.

Ensimmäiset 228 kirjoittaja-/recovery-/codec-tapausta ja desktopin tyypit
läpäisivät ennen UI-kytkentää. Katselmuksessa löytynyt vanhan julkaistun
juuren palautumispuute toistettiin neljällä create/import-vastatapauksella.
Rajattu korjaus erottaa uuden operaation nimirajan pysyvästi sidotun
operaation täydentämisestä:

- Uudet operaatiot käyttävät edelleen `appendReadyWorkspaceEntry`-polkua
  ja nykyisiä nimirajatarkistuksia; yleistä ohitusvalintaa ei lisätä.
- Vain create/import-recoveryn jo julkaistun juuren haara käyttää
  `appendRecoveredWorkspaceEntry`-polkua. Se säilyttää ID-, lineage- ja
  kapasiteettitarkistukset sekä alkuperäisen nimen ja aktiivisen valinnan.
  `candidateValidated + finalExists` ja `rootPublished` vaativat edelleen
  oman journalin, tarkan kohteen, sisältötarkistuksen, leasen, prosessien
  poissaolon ja muuttumattoman rekisterin ennen julkaisua.
- Julkaisematon candidate ei muutu nimiristiriidan perusteella valmiiksi
  työtilaksi. Kylmäkäynnistyksen journal v1 -esto säilyy; tämä korjaus ei
  laajenna vanhojen journal-formaattien hyväksyntää.
- Kapasiteetin turvallinen alkuperäinen virhekoodi ja vaihe säilyvät.
  Epävarma sisältö, omistajuus, rekisteri tai loppusiivous säilyttää
  palautumisaineiston nykyisen sopimuksen mukaan.

Pysyvät regressiot kattavat vastatapaukset, kielteiset turvarajat ja
idempotentin jatkamisen. Nykyisen käynnistyscompositionin tiedostotestit
tarkistavat nimikonfliktin jo ennen käynnistystä, tarkistusprosessin
exit-rajan, journalin/rekisterin sekä DB-/PDF-tavujen säilymisen.
Niiden native-/SQLite-tarkistusraja on ohjattu testiraja, ei oikean
Electron-prosessin tai paketoidun palautuksen todiste. Ajantasainen
kohdenäyttö on [M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
UI:n lisäprojektion, virhepalautteen ja historiallisen nimihuomautuksen
kohdetestit on toteutettu. Oikea Electron-polku todentaa create/import/rename-
eston, onnistuvan jatkon, yrityseristyksen ja turvallisen virheen nykyisestä
lokituksesta Diagnosticsin HTTP-reittiin ja strict-clientiin. Nykyinen
Electron-kylmäkäynnistyskoe todentaa myös jo julkaistun historiallisen
samannimisen create/import-kohteen palautumisen oikealla tarkistusprosessilla.
Se pysähtyy edelleen ennen business-backendia eikä ole packaged-todistus.
Selainkoe käyttää injektoitua desktop-statussopimusta ja todentaa huomautuksen,
tunnisteella tehtävän valinnan sekä leveän ja kapean näkymän; se ei todista
IPC:tä tai oikeaa yritysvaihtoa. Diagnostiikan ja tukipaketin suljetut lukijat
säilyttävät vain [tapahtumakatalogin](r0-observability-event-catalog.md)
sallimat kentät. W7.1:n puhtaan paketin palautustodennus sekä PR:n ja uuden
mainin omat portit läpäisivät ilman CI-uusintaa.
[Loppuhyväksyntä](https://github.com/eky-software/eky/pull/320#issuecomment-6397583475)
ja [M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistavat täsmällisen revision ja hyväksyntänäytön; tämä ei sulje W7.2-W7.5:tä.

### W7.2:n toteutusraja

**25.10.2026, aloituskartoitus:** W7.1 on hyväksytty. W7.2 toteuttaa
yllä hyväksytyn työjaon yritysvalinnan; poistopyyntö, purge ja backenditon
tukiformaatti eivät kuulu tähän palaan. Alla oleva järjestys ei muuta
[pysyvän valinnan sopimusta](#pysyvä-yritysvalinta-ja-versioraja) tai
[valitsimesta avauksen jatkoa](#valitsimesta-avauksen-pysyvä-jatko).

| Toteutuspala | Nykyinen omistaja ja säilyvä raja |
| --- | --- |
| Rekisterin esitys | `registry/workspaceRegistryTypes.ts`, `workspaceRegistryValidation.ts`, `workspaceRegistryBytes.ts`, `workspaceRegistrySerializer.ts`, `workspaceRegistryStore.ts` ja `workspaceRegistryPort.ts`: yhteinen entry-validointi ja versionmukainen arvo samoissa `workspace-registry-v1.json`-sloteissa. V1-tavut säilyvät. Store-kutsun `read()`/`write()` korjaava luku ja `inspect()`-valinta eivät korvaa kaikkien slottien admissionia. Codec-, store-, recovery- ja tiedostoturvatestit kattavat version säilymisen; parserin tuki ei anna muunnosvaltuutta. |
| Lisäys ja nimeäminen | `registry/workspaceRegistryMutations.ts`, `creation/workspaceCreationRegistry.ts`, `import/workspaceBackupImportRegistry.ts` ja `management/workspaceLabelRename.ts`: yksi version säilyttävä mutaatiototeutus, v2:n null-valinta säilyy ja rename-no-op palauttaa saman olion. Nykyiset nimiraja- ja virhekooditestit säilyvät. Puuttuvaa rekisteriä ei normalisoida valitsimen tyhjäksi rekisteriksi; adoption nykyinen ensialustus erotetaan hallinnan jo olemassa olevasta rekisteristä. |
| Luonnin ja tuonnin palautuminen | Nykyiset `emptyWorkspaceCreationCoordinator`/`Recovery`, `workspaceBackupImportCoordinator`/`Recovery` ja `runtime/assertColdWorkspaceRecoveryContinuation.ts`: v2:n julkaisun jälkeinen jatko on edelleen null, ei nykyisen `previousActiveWorkspaceId ?? workspaceId` -oletuksen valitsema uusi yritys. Ennen julkaisua keskeytynyt työ ja jo julkaistu juuri testataan erikseen kummallakin rekisteriversiolla. Valitsinjatko todistaa rekisterin, omistajuuden ja töiden poissaolon ilman tekaistua aktiivista juurta tai health-tulosta; W7.1:n historiallinen nimiristiriitapalautus säilyy. |
| Hyväksynnän laajuus ja muunnos | `update/acceptedBuildMetadata.ts`, nykyinen store, `preWorkspaceBuildAdmission.ts`, `firstStartUpdateCoordinator.ts` sekä nykyinen installation-state/legacy-kytkentä: kaikki lukijat luokitellaan selector-, business- tai baseline-kuluttajiksi ennen kirjoittajan muutosta. Slot-admission, terminal-clear ja keskeytysjärjestys todennetaan nykyisissä omistajissa. |
| Valitsimesta avaus | Nykyiset switch-journal/coordinator/startup sekä W6:n registry-transitionit: source-null ja ei-null käyttävät samaa versionmukaista sopimusta. Koko rekisterin tiivisteet, julkaisu-/paluu-järjestys ja omistettujen töiden loppuminen säilyvät. |
| Käynnistys ja hallinta | `runtime/resolveActiveWorkspaceStartup.ts`, `management/workspaceManagementComposition.ts` ja nykyinen main-composition: valitsin erotetaan yritysruntimesta ennen backend/session/broker-luontia. Nykyisen aktiivisen yrityksen sulkuporttia ei korvata no-opilla eikä puuttuvaa yritystä tekaista. |
| Muut lukijat | `adoption/workspaceLegacyAdoptionStartup.ts`/`Recovery`, `replacement/workspaceBackupReplacementRegistry.ts`, `update/workspaceActivationMigrationGuard.ts` sekä W6-inventaario/plan: historiallinen adoptio ja todellisen aktiivisen kohteen vaatimukset säilyvät, vertailu kattaa versionmukaiset kanoniset tavut. `management/workspaceManagementStatus.ts`:n nykyinen DTO v1 sallii jo null-valinnan; rekisteriversio ei vaihda status- tai lineage-formaattia. |
| Todellinen ketju | Nykyiset startup-, first-start-, registry- ja management-testit, Electron/IPC/UI sekä packaged/update/rollback-portit: erityisesti v1 -> v2, null ready-entryillä, tyhjä/recovery-only, keskeytykset ja toistuva selector-päivitys business-baselinen säilyttäen. |

Kutsujakartoitus kattaa myös testien erilliset lukijat:
`apps/e2e/src/environment/readElectronE2eActiveWorkspace.ts` vaatii oikean
aktiivisen yrityksen eikä sitä muuteta valitsimen näennäiseksi profiiliksi.
Asenninharnessin `legacyUpgradeProfileEvidence.mjs`:n historiallinen v1-luku
sekä `workspaceSuccessProfileEvidence.mjs`:n kohdepaketista ladattu lukija
pidetään erillään. Pelkkä nykyisten v1-testien läpäisy ei todista näitä
v2-kutsujia; tuotantokytkentä kattaa myös niiden omat versionmukaiset kontrollit.

Ensimmäinen lähdevertailu vahvisti, että registry-codec ja kirjoittajat
olivat aloituksessa v1-only, switch-startup vaatii aktiivisen yrityksen ja nykyinen
management-composition tarvitsee aktiivisen profiilin palautuspalvelut.
Accepted-buildin nykyinen v1 tarkoittaa business-hyväksyntää. W6 ei tee
uutta inventaariota `exactAcceptedBuild`-haarassa. Tämä ei ole nykyisen
normaalipolun uusi vikaväite, vaan syy estää selector-readinessin merkitseminen
samaksi hyväksynnäksi.

**Rajattu lähde- ja kutsujakatselmus 25.10.2026:** hyväksynnän lukijat on
eroteltu alla. Katselmus tarkensi uuden kytkennän todistettavat rajat,
ei nykyisen v1-normaalipolun uutta vikaväitettä. Tämä kartoitus ei muuttanut
tuotantokoodia, formaatteja, aikarajoja tai CI-kytkentää. Jo katselmoituja W7.0-kokeita
ei ajeta uudelleen ilman omaa havaintoa. Täsmällinen hyväksyntätila säilyy
[M1:ssä](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

**Rekisteriperustan toteutus 25.10.2026:** sama parseri, validaattori ja
tallennin tukevat nyt v1/v2-arvoja. Entry-, lineage-, koko- ja tiedostorajat
säilyvät; version muutos ei muuta v1:n kanonisia tavuja. Mutaatiot ja W6:n
rekisterisiirtymät säilyttävät version. Luonti/tuonti jakavat yhteisen
versionmukaisen julkaisun jälkeisen valinnan: v1 säilyttää vanhan ensimmäisen
yrityksen valinnan, v2 säilyttää aiemman valinnan myös sen ollessa null.
Kylmäpalautuksen null-jatko vaatii todellisen v2-rekisterin, sen koko sisällön
muuttumattomuuden ja kutsujan nykyisen runtime-poissaolotodisteen ennen
journalin poistoa. Puuttuva rekisteri ei ole tämä jatko.
Luonnin ja tuonnin kylmäpalautuksen admission sekä kumpikin palautusomistaja
vaativat olemassa olevan, nykyisen slot-sopimuksen mukaan valitun rekisterin
ennen kohteen tai tuonnin väliaineiston siivousta. Journal ei sisällä koko
rekisteriä tai sen versiota eikä siksi oikeuta rekonstruoimaan puuttuvaa
rekisteriä. Puuttuminen säilyttää journalin ja aineiston sekä estää avauksen.
Kelvollinen tyhjä v1/v2-rekisteri ja current/backup/next-valinta säilyvät
tuettuina; historiallinen adoptio käyttää edelleen omaa ensialustusvaltuuttaan.
Rajattu riippumaton katselmus ei jättänyt löydöksiä osarajaan; kohdesarja
läpäisi 810 testiä, kaksi alustakohtaista tapausta jäi ajamatta ja
tyyppitarkistus läpäisi. Koko slot-admission, v1 -> v2 -muunnosvaltuus,
source-null-switch ja tuotannon valitsin/FirstStart-kytkentä ovat edelleen
erilliset toteutettavat osat. Näyttö ei sulje niitä tai koko W7.2:ta.

**Hyväksyntäesityksen ensimmäinen osaraja 25.10.2026:** nykyinen
`acceptedBuildMetadata.ts` sisältää v1:n säilyttävän versionmukaisen parserin
sekä erilliset sovellus-, business- ja baseline-lukuarvot. Selector ei anna
business-hyväksyntää. Uuden selector-arvon puhdas muodostus säilyttää B:n
toistuvissa päivityksissä ja torjuu saman tai vanhemman sovellusversion;
se ei anna tiedoston kirjoitusvaltuutta. Tässä codec-osassa strict-v1-parseri
ja tuotantotallennus säilyivät muuttumattomina.
Rajatut metadata- ja vanhojen hyväksyntäpolkujen regressiot läpäisivät
146 testiä kahdeksassa tiedostossa. Tyyppitarkistus ja rajattu riippumaton
lähdekatselmus läpäisivät. Tämä ei ole uuden metadataformaatin
tuotantojulkaisun tai ensimmäisen yritysavauksen todiste.

**Lukijoiden ja FirstStartin osaraja:** tallennin tukee nyt versionmukaista
arvoa samoissa sloteissa ja estää v2 -> v1 -kirjoituksen ennen siivousta.
Strict-v1-parseri säilyy historiallisille kuluttajille. Alla nimetyt nykyiset
lukijat käyttävät omia sovellus-/business-/baseline-tulkintojaan; vanhan
sijainnin siirto säilyttää koko arvon hyväksymisaikoineen. FirstStartin uusi
`deferredBusiness`-tila ei lainaa C:n tai Direct Setupin palautusvaltuutta,
ei migroi itse eikä tulkitse selector-hyväksyntää yrityskäytön hyväksynnäksi.
Se tarkistaa täsmällisen lähtömetadatan, profiilin, salaisuuden identiteetin
ja kutsujan tuoreen valtuuden sekä julkaistun arvon takaisinluennan.
Kadonnut kuittaus säilyttää todellisen kirjoitustilan, ei palauta metadataa
arvaamalla. Virhepolun vieraan journalin kirjoitusyritys toistettiin ja
estettiin regressioineen. Vanhojen business-v2:n asennuspäivitys- ja
rollback-polkujen kontrollit säilyttävät v2-esityksen.
Rajattu 515 testin sarja, desktop/E2E-tyypit ja lähdekatselmus läpäisivät.
Oikea metadatatallennus on mukana, mutta profiili-, salaisuus- ja valtuusportit
ovat injektoituja. Yhteinen slot-admission, suojattu julkaisu ja terminal-clear,
W6:n nimetty deferred-jatko sekä todellinen startup/composition ja paketoitu
todistus jäävät seuraaviin osiin. Korjaava store-luku ei edelleenkään ole
admission; uusi FirstStart-tila ei vielä ole startupin käyttämä haara.

Tallentimien `inspectSlots()` käyttää nykyistä rajattua tiedostolukijaa ja
palauttaa current/next/backup-tavut ja validoidut arvot siivoamatta niitä.
Se ei valitse hyväksyttyä palautushaaraa eikä lupaa atomista snapshotia.
`UpdateJournalStore.clearSelected()` toimii nykyisessä serialisoidussa
operaatiossa: täsmälliset valitut tavut, sivuslottien poissaolo, tiedoston
identiteetti ja tuore synkroninen valtuus tarkistetaan ennen vain currentin
poistoa. Synkronointi ja takaisinluku kuuluvat kuittaukseen. Epäonnistunut
kuittaus ei todista vanhan journalin säilymistä eikä onnistunutta siivousta;
uutta aineistoa ei poisteta samalla valtuudella. Näiden 219 testin vaikutusalueen
sarja, tyypit ja rajattu riippumaton katselmus läpäisivät. Startup- ja legacy-kytkentä
sekä yhteinen admission ovat vielä tekemättä.
Nykyisiä ehdottomia store-kutsuja ei nimetä uuden haaran poistovaltuudeksi.

Metadatan `write(value, selection)` ja `clearSelected(selection)` sitovat
muutoksen täsmällisiin valittuihin tavuihin ja tuoreeseen synkroniseen
valtuuteen saman tallentimen sarjallistuksen sisällä. Kirjoituksen nimenomainen
puuttuva lähtöarvo vaatii kaikkien slottien poissaolon; se ei todista tyhjää
asennusta. Tiedostoidentiteetti, odotetut current/next/backup-tavut ja valtuus
tarkistetaan ennen julkaisusiirtoja ja poistoja. Vanhojen kutsujen
tiedostokäyttäytyminen säilyy, mutta saman tallentimen päällekkäiset operaatiot
hylätään. Installation-varaus ja muiden kirjoittajien poissaolo kuuluvat
edelleen kutsujalle, eivät tämän paikallisen sarjallistuksen lupaukseen.

Valintaan sidottu kirjoitus säilyttää keskeytyneet slotit palautusadmissionille:
virhekuittaus ei palauta vanhaa hyväksyntää tai poista epäselvää aineistoa.
Tiedosto- ja hakemistosynkronoinnin alkuperäinen virhe säilyy myös sulun
epäonnistuessa, ja omistetun kahvan sulun päättyminen odotetaan ennen
tallenninoperaation vapautumista. Raakaa syyketjua ei julkaista.
Kohderegressiot käyttävät oikeita synteettisiä metadatatavuja;
hakemistosynkronoinnin kaksoisvirhe on mallinnettu, ei erillinen
Linux-käyttöjärjestelmän tai sähkökatkon todiste. Vaikutusalueen 587 testiä
28 tiedostossa, desktop/E2E-tyypit ja rajattu katselmus jälkitarkistuksineen
läpäisivät. Tämä rajapinta ei vielä
kytke suojattua julkaisua FirstStartiin, legacy-siirtoon tai valitsimeen;
yhteinen admission ja sen jälkeinen tuore kutsujavaltuus olivat seuraava työ.

**Valitsimen tilavalmistelun osaraja:** nykyinen sijaintimuunnoksen omistaja
sisältää nimetyn `prepareSelectorLocalUpdateState`-haaran. Se tarkastaa
nykyisen ja legacy-sijainnin metadata-/C-journal-slotit sekä registryn ennen
muutoksia. Vain todellinen null-valinta, yhtäläiset kokonaiset arvot ja alla
hyväksytyt terminalit sallivat jatkon. Päällekkäisiä JSON-avaimia ei hyväksytä
pelkän parsitun arvon perusteella. Tarkistus ei ole atominen tiedostokuva:
kutsujan jatkuva installation-omistajuus, kirjoittajien poissaolo ja muiden
palautusomistajien konfliktittomuus ovat edelleen välttämättömiä.

Legacy-kopio julkaistaan nykyisillä tallentimilla, luetaan takaisin ja sen
synkronointiraja varmennetaan ennen lähteen poistoa. Tämä tehdään myös silloin,
kun molemmissa sijainneissa on jo yhtäläinen arvo aiemman kadonneen kuittauksen
jäljiltä. C-journalin ensimmäinen valintaan sidottu kopio vaatii kaikkien
kohdeslottien poissaolon ja säilyttää keskeytyneet tavut. Terminalien poistossa
valtuus tarkistetaan välittömästi ennen tiedostomuutosta. Lopullinen poissaolon
varmennus synkronoi olemassa olevat hakemistot mutta ei luo puuttuvaa legacy-
hakemistoa. Palautuspisteitä, pakettivälimuistia tai registryä ei poisteta.

Vanha `migrateLegacyLocalUpdateState`-polku säilyy: kelvollinen current tai
backup voi edelleen palautua, vaikka käyttämätön next olisi osittainen.
Uuden haaran hylkäys ei anna lupaa siirtyä vanhaan korjaavaan lukuun.
Valmistelu ei tarkoita selector-readinessia tai business-hyväksyntää.

**Käynnistyskytkentä 25.10.2026:** `desktopComposition` valitsee nimetyn
valmistelun todelliselle null-rekisterille ennen korjaavia tilalukuja.
Nykyinen installation-varaus ja käynnistyksen synkroninen valtuus säilyvät
koko operaation ajan. Palautusristiriitojen tarkistus kattaa myös passiivisten
ja recovery-yritysten juuret, legacy-palautuksen sekä W6:n ja muut
hallintajournalit. Se on havainto, ei itsenäinen palautus- tai poistovaltuus.

Build-admission saa valmistelun juuri tarkistaman metadatan vasta terminalin
A=T/A=S-sidonnan jälkeen. Valmis terminal ei enää ole keskeneräisen
päivityksen kohde. DSR:n nykyinen build-sääntö säilyy ja sen täsmälliset tavut
tai puuttuminen sidotaan peräkkäisten tarkistusten yli. Sallittua hyväksyttyä
DSR:ää ei poisteta tässä haarassa. Muuttunut aineisto tai menetetty
omistajuus estää jatkon ennen seuraavaa muutosta.

Keskeytynyt create/import ja vanha adoptio pysyvät nykyisillä palautuksen
omistajillaan; pelkkä journalin olemassaolo ei anna palautuslupaa.
Create/import-palautuksen jälkeen rekisteri, tilavalmistelu ja build-admission
luetaan uudelleen. V1:n ensimmäinen yritysvalinta ja v2:n pysyvä null eivät
sekoitu. Ei-null-yrityksen vanha korjaava tilaluku säilyy.

Composition-regressiot käyttävät oikeaa käynnistysfunktiota ja tiedostotavuja,
mutta Electron- ja native-rajat ovat ohjattuja. Valitsimen julkaisu,
source-null-avaus sekä SQLite/Electron/paketoitu näyttö ovat edelleen
tekemättä. Tämän osarajan testien ja katselmuksen lopputila on M1:n
jatkamiskohdassa; yksittäinen osaraja ei sulje W7.2:ta.

#### W7.2:n ensimmäinen yritysavaus valitsinhyväksynnän jälkeen

`A` tarkoittaa hyväksyttyä sovellusbuildia ja `B` viimeistä business-
hyväksyttyä buildia. Selector-päivityksen jälkeen `A = T`, `B = S`.
Baseline ei todista yksittäisen yrityksen nykyistä tietokantaversiota;
se tarkistetaan aina yrityksen omista tavuista nykyisillä tarkistimilla.

| Kutsuja | Hyväksynnän käyttötarkoitus |
| --- | --- |
| Metadata-codec/store ja legacy-sijaintimuunnos | Koko versionmukainen arvo aikoineen. Korjaava `read()` ei ole slot-admission. Muunnos ei luo uutta hyväksyntää. |
| `preWorkspaceBuildAdmission` ja C:n lähdebuildin tarkistus | A määrää sallitun sovellusversion ja C-journalin vastaavuuden. B ei anna downgrade-valtuutta. |
| `FirstStartUpdateCoordinator` | A erottaa sovelluksen hyväksynnän; B tarvitaan lykätyn business-siirtymän lähtöön. Business-valmistuminen julkaisee A = B = T vasta oikeiden porttien jälkeen. |
| `PreBackendFirstStartFailureAuthority` | C:n sovellusidentiteetti ja Direct Setupin business-lähde ovat eri käyttötarkoituksia. Koko lukijaa ei saa vaihtaa B-projektioksi. |
| W6-orchestraattori ja transition/recovery | Inventaarion lähde on B; valmistuminen vaatii business-T:n, ei pelkkää selector-A:n vastaavuutta. Registry-transitionit säilyttävät todellisen formaattiversion ja koko rekisterin tiivisteet. |
| Packaged smoke, workspace-success/fault ja niiden jälkitarkistimet | Skenaarion oikea business-hyväksyntä ja journalin lopputila. Historiallisten pakettien strict-v1-lukuraja säilyy erillisenä. |

W7.2:n aloituksessa FirstStartin täsmäävä A valitsi `normal`-haaran, joka ei
hyväksynyt uutta business-versiota. Uusi selector-arvo torjutaan nyt vanhasta
haarasta; nimetty deferred-jatko on kytketty mainin jo valittuun yritysavaukseen,
mutta source-null-liitos on vielä kesken. `targetValidation`-startup valitsee
W6A.3:n aktivointimigraation, jolloin sen `beforeMigrations` ohittaa
FirstStartin vastaavan kutsun. Molempien migraatio-omistajien käynnistäminen
ei ratkaise tätä. Sovellusadmissionia ei myöskään saa esittää virheellisesti
uutena binääripäivityksenä käyttämällä kaikkialla vanhempaa B:tä.

**Omistaja hyväksyi 25.10.2026 suunnittelun ja keskeytyskokeen jälkeen
rajatun tuotantokytkennän pysyvine regressioineen ja integraatiotesteineen:** ensimmäisen
source-null-avauksen pending-migraatio käyttää nykyistä W6A.3:n erillisen
candidaten ja atomisen aktivoinnin polkua. FirstStart säilyy lopullisen
business-hyväksynnän omistajana; sen tarvitsema tuore, täsmällinen
todistesiirto toteutetaan alla olevan katselmoidun sopimuksen mukaan. Samalle uudelle
operaatiolle ei luoda rinnakkaista Direct Setup -migraatiota. Nykyiset
ei-null-aktivoinnit sekä aiemmin alkaneet C-/Direct Setup -palautukset
säilyttävät omat omistajansa. Uutta journalia tai koordinaattoria ei ehdoteta.

Vaihtoehto olisi käyttää ensimmäiseen avaukseen nykyistä FirstStartin
Direct Setup -migraatiopolkua palautuspisteineen. Se muuttaisi tämän
valitsimesta avattavan kohteen kopioon perustuvaa aktivointirajaa ja vaatisi
erikseen A/B-tietoisen pending-restartin sekä palautussidonnan. Sitä ei
valita pelkän pienemmän kutsumuutoksen perusteella.

Suosituksen pieni koe rajataan nykyisten omistajien seuraaviin liitoksiin:

- Yksi migraatioauktoriteetti ennen SQL-kirjoitusvaltuutta; current-kohde
  ei muodosta turhaa candidatea. Inventaario, lineage ja yrityseristys säilyvät.
- Candidate-aktivoinnin keskeytys ja uusi käynnistys säilyttävät nykyisen
  palautusjournalin auktoriteetin. Vanhaa muistikuittia ei käytetä terveystuloksena.
- Nykyinen startup hyväksyy switchin ennen W6:n passiivisia muutoksia,
  FirstStart-hyväksyntää ja W6:n loppusiivousta. Tämä vastuun siirto sekä
  epäonnistuminen sen kummallakin puolella todennetaan erikseen. Switchin
  koko-registry-tiivisteitä ei löysennetä W6:n myöhempien muutosten vuoksi.
- Valitsimeen paluu vaatii todetut prosessi-/I/O-poistumiset ja sisäkkäisen
  palautuksen päättymisen. Avoin W6 tai activation-journal ei saa jäädä
  viittaamaan toiseen aktiivivalintaan. Epävarma tila säilyy recovery-tilana.
- Epäonnistuminen ei alenna A:ta eikä nosta B:tä. Onnistunut business-
  hyväksyntä ja W6:n päättäminen erotetaan myös metadata-kirjoituksen
  epävarmasta kuittauksesta. Muut yritykset ja ensimmäinen syy säilyvät.

Koe ei uusi W7.0:n codec-/slot-kokeita eikä yksin sulje W7.2:ta. Tarkka
tuotantosopimus, rajattu katselmus ja nykyiset oikean prosessi-/pakettiketjun
portit vaaditaan edelleen. Suunnittelun ja kokeen tulos on katselmoitu;
tuotantototeutus katselmoidaan erikseen. W7-P1-P4:n käyttäytymisvalintoja
ei avata uudelleen.

##### Rajatun kokeen mukainen toteutussopimus

**Suunnittelunäyttö 25.10.2026:** 28 rajattua sopimuskoetta ja niiden
tyyppitarkistus läpäisivät. Rajattu riippumaton katselmus tarkisti
valinnan/sukupolven sidonnan, W6:n jatkamisen ja terminal-rajat; sen
koemallia koskevat havainnot korjattiin vastatesteineen. Tämä ei ole
tuotantokytkennän tai koko W7.2:n hyväksyntä.

Seuraava on hyväksytty W7.2:n tuotantokytkennän sopimus, ei vielä toimitettu toiminto.
Se käyttää nykyisiä omistajia ja alla olevaa järjestystä; uuden yleisen
koordinaattorin tai journalin perustamista ei tarvita.

| Vaihe | Omistaja ja vaadittu todiste |
| --- | --- |
| Aloitus | Mainin nykyinen installation-/startup-valtuus sitoo A:n, B:n, käynnistyssukupolven, switch-operaation, kohteen, lineagen ja koko valitun rekisterin. Jo ensimmäisen luetun valinnan pitää olla oikea; pelkkä myöhempi muuttumattomuus ei riitä. Kaikkien slottien admission säilyy. Vanha C-/Direct Setup -palautus ohjataan omaan nykyiseen omistajaansa. |
| Yksi migraatio | Pending-kohde käyttää W6A.3:n snapshot/candidate/activation-ketjua, ei uuden Direct Setup -migraation rinnakkaista käynnistystä. Alkuperäistä kantaa ei migroida paikallaan. Current-kohde ei luo candidatea. Avoin aktivointijournal ratkaistaan ennen uuden työn sallimista. |
| Uusi käynnistys | Nykyinen restore-startup lukee pysyvän journalin ja valitun sisällön uudelleen. SQL-, schema-, lineage-, artifact-, salaisuus- ja health-todisteet tulevat tämän sukupolven oikeista omistajista. Vanhaa muistikuittia ei siirretä käynnistysten välillä. |
| FirstStart | Nykyiseen FirstStartiin nimetään erillinen `deferredBusiness`-haara. Se ei esitä A = T:tä uutena binääripäivityksenä. Kopion jälkeinen portti vaatii nykyisen manifestin ja nolla pending-migraatiota ennen SQL-kirjoitusvaltuutta. FirstStart säilyttää tuoreen sisältö-/salaisuusvalidoinnin ja versionmukaisen metadatajulkaisun. Kokeen rajattu B-projektio ei ole tuotantoon kopioitava yleinen store-adapteri. |
| W6 | Nykyiselle orchestraattorille nimetään lykätty business-admission. Lähde on B, kohde T; `exactAcceptedBuild` tai teeskennelty uusi asennuspäivitys ei korvaa sitä. Valmisteltu sama journal voi jatkua pending -> current -muutoksen jälkeen vain buildien, kohteen, passiivisten ID-joukon ja molempien koko-registry-tiivisteiden täsmätessä. |
| Hyväksyntä | Nykyinen järjestys säilyy: palautussisällön hyväksyntä, switchin hyväksyntä, W6:n passiivinen rekisterisiirtymä, FirstStartin business-julkaisu A = B = T ja W6:n loppusiivous. Jokainen raja tarkistaa oman tuoreen valtuutensa. FirstStartin guard huomioi täsmällisen sallitun W6-siirtymän, ei vain alkuperäisiä rekisteritavuja. |

Ennen palautuksen hyväksynnän aloittamista virhe voi palauttaa alkuperäiset
tavut nykyisellä rollbackilla. Null-valinta julkaistaan vasta todettujen
exit/reclaim- ja I/O-sulkujen, sisäkkäisen palautuksen terminal-tarkistuksen
sekä W6:n `prepared`-journalin täsmällisen peruutuksen jälkeen. W6 perutaan
vielä valitun kohteen rekisteristä, ennen null-valintaa tai kohteen
lifecycle-muutosta. Vanhan prefixin palautus ei saa vahingossa käynnistää
eteenpäinmigraatiota; sen tarkistus on nimetty palautustarkistus, ei
business-readiness. Jos turvallista loppua ei voida todistaa, journalit ja
aineisto säilyvät recovery-tilassa eikä valitsimeen paluuta luvata.

Source-null-kopion epäonnistumisen tiedostopalautus säilyttää nykyisen
switch-varauksen. Vasta valmistuneen palautuksen ja kuitatun vapautuksen
jälkeen uusitaan valinta- ja prosessipoissaolotodiste ja kutsutaan valitsimeen
paluun omistajaa. Sen alkuperäissisällön loppuvalidointi käyttää omaa
restore-varausta; switch-varausta ei nimetä restore-valtuudeksi. Vanha
ei-null-vaihto säilyttää aiemman järjestyksensä. Vapautus- tai paluuvirhe
ei peitä alkuperäistä aktivointivirhettä eikä anna relaunch-lupaa.

Aktivointikoordinaattorin nykyinen source-recovery-portti välittää
source-null-kutsussa joko nimenomaisen `noActivation`-tuloksen tai
`rollback(selectedJournal)`-kirjoittajan palauttaman muuttumattoman
`rolledBack`-kuitin. Operaation, alkuperäisen sisällön läsnäolon ja tarkan
revisiosiirtymän pitää täsmätä; kadonnut kuittaus ei muutu aktivoinnin
puuttumiseksi. Composition vaatii ennen työn aloitusta mainin nimetyn
loppukäsittelijän ja odottaa sen valmistumista ennen switch-palautusta.
Virhe tai päällekkäinen kutsu sulkee jatkon. Tämä kytkentä ei korvaa
terminal-valtuutta, tuoretta sisältötarkistusta eikä W6:n peruutusta.
Myös `noActivation` vaatii mainilta tuoreen journal-poissaolon tarkistuksen.

Mainin nimetty loppukäsittelijä sitoo kuitin ennen odotuksia kaapattuun
switch-operaatioon, yritykseen, profiiliin ja työtilajuureen. Se päättää
salaisuus- ja tarkistustyöt, todentaa prosessiomistajuuden ja torjuu vieraan
palautusjournalin. Vain täsmällinen palautuskuitti saa valmistella vielä
käyttämättömän replacement-palautusomistajan cold-loppusiivouksen.
Virhe sulkee myös yleisen source-recovery-jatkon. Elävä synkroninen
valinta- ja kertakutsutarkistus kulkee viimeiseen juuren poistotarkistukseen;
pelkkä aikaisempi asynkroninen tarkistus ei riitä. Onnistuminen edellyttää
myös cold-varauksien loppuvapautusta ja tuoretta journal-poissaoloa.
Tämä kuittikäsittely ei yksin anna switchin terminal- tai W6-peruutusvaltuutta.

Palautuksen nykyisen startup-omistajan nimetty cold-loppusiivous vaatii jo
valitun täsmällisen `rolledBack`-journalin ja tuoreen alkuperäissisällön
valtuuden. Se ei avaa tai migroi business-runtimea. Keskeneräinen aiempi
startup-operaatio, alkanut hyväksyntä tai epävarma päätös estää kutsun;
aloitettu loppusiivous sulkee saman instanssin muut jatkot. Palautusjuuren
varaus vapautetaan vasta sen nimetyllä poistokohdalla, ja alkuperäinen
juuri-identiteetti sekä elävä synkroninen valtuus tarkistetaan viimeisen
luvun jälkeen ennen poistoa. Ankkurin ja muiden varausten päättymisen pitää
onnistua ennen paluuvaltuutta. Journalin puuttuminen yksin ei todista sitä.
Mainin nykyinen kytkentä kattaa alla rajatun deferred-source-null-avauksen;
se ei vielä kata kaikkia valitsimen terminal-kutsujia.

Nykyisen W6-orchestraattorin `cancelBeforeSelectorReturn` toteuttaa tämän
peruutusrajan nimetylle deferred-avaukselle. Kutsuja toimittaa elävän
käynnistysvaltuuden ja todellisen töiden päättymistarkistuksen; metodi ei
päättele prosessin poissaoloa. Vain kuitattu oma `prepared`-journal tai
täsmällisesti jatkettava valmistelu voidaan poistaa. Tarkistuksessa
kaapatut tavut ja tiedostoidentiteetti kulkevat nykyisen slot-tallentimen
poistovartijaan asti. Lukutarkistus ei korjaa sivuslotteja. Keskeneräinen
valmistelu, alkanut rekisterisiirtymä, muuttunut valinta tai kadonnut
kuittaus estää saman instanssin jatkon. A/B-metadataa ja rekisteriä ei
muuteta peruutuksessa. Main käyttää tätä peruutusta alla nimetyssä
terminal-kytkennässä. Ohjatun prosessirajan regressiot eivät todista oikean
native-prosessin päättymistä.

FirstStartin nimetyn deferred-haaran metadataluvut eivät korjaa tai poista
keskeytysslotteja. Alkuperäisen havainnon tavut ja tiedostoidentiteetti
säilyvät sisältö- ja salaisuusvalidoinnin yli nykyisen tallentimen
`publishSelected`-kutsuun. Se käyttää yhteistä valitun slotin kirjoitusta,
ei uutta tallennusjärjestelmää. Takaisinluku vaatii kirjoittajan seuraaman
julkaisuidentiteetin: samantavuinen vieras tiedosto ei ole hyväksyntä.
Keskeytynyt julkaisu säilyttää todelliset slotit eikä alenna A:ta tai B:tä.
Mainin ulkoinen guard tarkistaa elävän sukupolven ja sallitun rekisteri-/W6-
valinnan myös kirjoituksen sisällä; se ei lue uudelleen metadatatallentimen
omia keskeneräisiä slotteja. Metadatan tarkistus ja julkaisu kuuluvat
tallentimelle. Peruutus- ja julkaisuvaltuuden alkuperäiset funktiot
kaapataan ennen ensimmäistä asynkronista rajaa; niiden vaihtaminen kesken
operaation ei anna uutta valtuutta. Vanhat C-/Direct Setup -kirjoittajat säilyttävät sopimuksensa.
Mainin jo valitun yrityksen avaus ja alla rajattu source-null-kytkentä
käyttävät tätä ulkoista valtuutta.

Palautuksen `unverified`/`committed`-hyväksyntä tai jo päätetty switch ei
anna enää uutta rollback- tai null-paluuvaltuutta. Kadonnut hyväksyntäkuittaus
ratkaistaan pysyvästä valinnasta: B on voinut jo muuttua T:ksi. A:ta ei
alenneta eikä B:tä arvata. Hyväksytyn sisällön epäonnistunut loppusiivous
jatkuu nykyisellä tuoretta validointia vaativalla polulla, ei uudella
migraatiolla. W6:n siirtymä palautuu tai päättyy oman journalinsa ja todellisen
business-hyväksynnän mukaan. Switchin tiivisteitä ei löysennetä tämän vuoksi.

**Kokeen rajat:** aktivoinnin tiedostosiirrot, restore-journal/store,
restore-startup, FirstStart sekä W6:n journal/store/transition ja
orchestraattori ovat nykyisiä toteutuksia. Migraatio-/sisältötyö,
prosessipoissaolo, health ja v2-metadatajulkaisu on injektoitu. W6:n nykyistä
lukijaa kokeillaan v1-rekisterillä; tämä ei todista tulevaa v2-kytkentää,
atomista metadatajulkaisua tai koko source-null-compositionia. Ne sekä
palautetun historiallisen prefixin terminal-kytkentä tarvitsevat pysyvät
regressiot ja oikean prosessi-/pakettiketjun näytön ennen W7.2:n hyväksyntää.
Jo hyväksyttyjä W7.0:n codec-/slot-kokeita ei lasketa tämän näytöksi uudelleen.

**Aktivoinnin valintaraja:** nykyinen `WorkspaceActivationMigrationGuard`
ottaa source-null-avaukselle erikseen sidotun startup-valtuuden. Se vaatii
valmiiksi julkaistun v2/targetSelected-parin, koko rekisterin sidonnan,
lineagen ja nykyiset tiedostoidentiteetit. Kesken jääneiden slottien
palautus kuuluu startup-omistajalle ennen tätä rajaa; guard ei korjaa niitä.
Tarkistuskuittia ei hyväksytä toisessa guard-instanssissa tai käynnistyksessä.
Valinta tarkistetaan ennen tarkastusprosessia, tarkastuksen ja historiallisen
sisältövalidoinnin jälkeen sekä backendin migraatiorajalla. Current-kohde
jatkaa FirstStartiin ilman candidatea, pending-kohde käyttää yhtä nykyistä
kopioaktivointia. Nykyinen aktivointikoordinaattori uusii source-null-
valtuuden myös ennen seuraavaa tiedostotoimintoa ja palautuksen korjaavia
lukuja, poistoja tai valinnan muutosta. Menetetty valtuus sallii omistetun
runtimen sulkemisen, mutta ei anna uutta palautus- tai siivousvaltaa;
aineisto säilyy selvitykseen. Vanha ei-null-polku säilyy.

Nykyinen workspace-startup muodostaa valintatodisteen erikseen annetulla
mainin valtuudella. Switch-omistajan v2-haara tarkistaa rekisterin ja
journalin yhdessä ennen slot-palautusta, julkaisee keskeytyneen valinnan
ja erottaa valitsimeen paluun business-hyväksynnästä. Paluu ja hyväksyntä
vaativat omistajiensa tuoreen terminal-todisteen myös tallentimen sisällä.
Kadonnut kirjoituskuittaus pysäyttää nykyisen jatkon; uusi startup lukee
pysyvän tilan uudelleen. Valitsintulos ei luo business-sessionia.
Kirjoituksen tai slot-palautuksen jälkiluku vaatii tallentimen itse
seuraaman julkaistun tiedoston identiteetin, ei vain samoja tavuja.
V1:n kelvollinen valittu journal säilyttää keskeneräisen, myös tyhjän
välitiedoston aiemman palautuksen. Tämä havaintoluku ei hyväksy tyhjää
valittua journalia tai v2:n osittaista aineistoa. Kelvollinen v2-sivuslotti
estää delegoinnin vanhalle korjaavalle lukijalle. Null-valinta ei myöskään
ohita olemassa olevaa legacy-adoption palautusomistajaa; sen ja v2-switchin
ristiriita säilyttää aineiston ja estää jatkon.

Source-null-omistajien välinen luovutus käyttää switch-omistajan seuraamia
alkuperäisiä ja kirjoituksen jälkeen varmennettuja slotteja. Mainin alkuperäisen
valinnan admission edeltää switch-palautusta. Valmistuneen valinnan kuittaus
edeltää myös työtilajuuren tarkistusta, sillä jo se voi vaatia turvallista
valitsimeen paluuta. W6 saa ennen omaa valmisteluaan yhden saman rekisterisisällön
tiedostoidentiteetin siirron; se ei saa vaihtaa valittua yritystä tai historiatietoa.
Siirron keskeneräisyys estää W6-valmistelun ja peruutuksen. Switchin hyväksytty
poisto välittää oman kuittinsa ennen W6-siirtymää. Kadonnut kuittaus, muuttunut
tiedosto tai vanhentunut omistaja sulkee kyseisen kytkennän jatkon, ei anna lupaa
ottaa myöhempää tiedostolukua uudeksi lähtökohdaksi. Tämä nykyisten omistajien
luovutusrajapinta ei itsessään todista prosessien päättymistä tai paluuvaltuutta.
Kuitin tarkistus sidotaan juuri sen omaan valintaan: se ei seuraa myöhempää
journalin poistoa tai muuta seuraajatilaa. Hylätty kuitin tarkistus sulkee
omistajan, vaikka kutsuja käsittelisi poikkeuksen itse.

**Mainin terminal-kytkennän rajaus:** deferred-metadatan kanssa jatkettava
`validateTarget`/`completeSelection` käyttää nyt resolverille välitettyä
mainin valtuutta. Alkuperäinen valinta, switchin kirjoittajakuitti, W6 ja
runtime sidotaan samaan käynnistykseen. Main todistaa terminalin kerran;
sen synkroninen valtuus tarkistetaan uudelleen myös viimeisen odotuksen
jälkeen ennen W6-journalin poistoa. Valitsimeen paluu ei vaadi kohteen
business-readinessia, mutta vaatii salaisuus- ja tarkistustöiden sulun,
todetun prosessiomistajuuden, sisäkkäisen palautuksen loppumisen ja W6:n
peruutuksen ennen null-valintaa. Aiemmin valittu rollback säilyttää oman
palautusomistajansa; valmiiksi käsiteltyä candidate-kuittia ei käsitellä
uudelleen journalin poissaolon perusteella.

Viallisen työtilajuuren hylkäys voi tapahtua ennen runtimen rakentamista.
Tällöin main tarkistaa oman varauksensa ja palautusjournalien poissaolon.
Kun runtimen rakentaminen on alkanut, tätä haaraa ei enää saa käyttää
puuttuvan runtime-todisteen korvikkeena. Hyväksyntä puolestaan vaatii
validoidun elävän backendin ja päättyneen palautushyväksynnän. Kuitatun
switch-hyväksynnän jälkeen FirstStart tarkistaa tuoreen sisällön jo
hyväksyttyä lineagea vasten, ei loppuun käytetyn switch-valtuuden kautta.
Palautettu terminal-valtuus säilyy luvallisten switch-kirjoitusten yli;
se ei vaadi niitä edeltävän slot-kuvan säilymistä.

Pelkkä null-valinta ilman switchiä käyttää nyt mainin fyysistä varausta
ja journalien poissaolotarkistusta ennen valitsinkuluttajaa. Sen tuore
valtuus ei hyväksy journalia tai jo aloitettua business-runtimea.
Tämä tarkistetaan jo resolverin valinnan admissionissa, ennen sen
korjaavia slot-lukuja tai session luontia; pelkkä myöhempi terminal-esto
ei riitä. Nyky-, next- ja backup-journalien regressiot säilyttävät tavut.
Keskeytyneen null-paluun main-liitos on nyt toteutettu alla kuvatulla
rajauksella. Business-metadatan source-null-avaus käyttää nyt alla kuvattua
normaalin FirstStartin lukukytkentää. Sen ristiriitaestoa ei saa ohittaa
luomalla business-sessionia. Ohjatun prosessi- ja
sisältörajan regressiot eivät korvaa SQLite/Electron- tai paketoitua näyttöä.
Koko kytkennän hyväksyntä ja avoimet testihavainnot ovat
[M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

**Jäljellä olevien avaushaarojen lähdevertailu:** tämä on nykyisen sopimuksen
kytkentäjako, ei uusi palautusmalli tai lupa ohittaa estoa. Main valitsee
haaran ennen business-valmistelua. `planDeferredBusinessLocalUpdateState`
säilyy lykätyn business-avauksen omistajana; sen hylkäystä ei käsitellä
yleisenä lupana yrittää toista palautuspolkua.

| Liitos ja sen tila | Säilyvä omistaja ja vaadittu regressio |
| --- | --- |
| Null ilman switchiä, main-kytkentä toteutettu | Nykyinen valitsimen tilavalmistelu ja `resolveWorkspaceSelectorSwitchStartup` saavat mainin installation-/prosessipoissaolovaltuuden. Ohjattujen kontrollien lisäksi oikeat Electron-testit todentavat ready-, tyhjä- ja recovery-only-rekisterin, IPC-nimenmuutoksen, business-HTTP-eston ja restartin ilman backendin tai mainin yrityssession luontia. Testiprofiilissa ei ole yritystietokantaa; yritysavaus ja pakettinäyttö vaaditaan erikseen. |
| Keskeytynyt paluu, main-liitos toteutettu | Switchin nykyiset `selectorUncommitted`, `unpublishedPreparation`, `completeReturn` ja `selectorReturned` käsitellään ennen uuden avauksen valmistelua. Tuore main-varaus, täsmällinen null-valinta, build-admission ja muiden palautusten poissaolo suojaavat valitun journalin päättämistä. Main-, slot-, kadonneen kuittauksen ja ristiriidassa säilyvien tavujen regressiot läpäisivät; native-/pakettinäyttö puuttuu. |
| Business-hyväksytty metadata ja source-null, main-liitos toteutettu | Täsmällinen business-hyväksytty build v1/v2 käyttää normaalia FirstStartia ja W6:n nykyistä aktivointitarkistusta. Lukukytkentä estää ristiriitaisten metadata-/C-/W6-slottien korjaamisen sivuvaikutuksena. Muuttumattoman hyväksytyn C-journalin läsnäolo sallitaan; Direct Setup ja keskeneräinen C/W6 säilyvät erillisinä omistajina. Main-regressioiden lisäksi `DESK-SELECTOR-OPEN-001` todentaa oikean IPC-valinnan, historiallisten SQLite-tavujen kopioaktivoinnin ja composition-restartin samalla Electron-prosessilla. Fyysinen restart, source-null-virhepaluu ja pakettinäyttö vaaditaan erikseen. |
| Lykätty business-hyväksyntä ja source-null, native-osatodennus | `DESK-SELECTOR-DEFERRED-001` aloittaa synteettisestä selector-hyväksynnästä ja vanhasta business-baselinesta. Oikea kopioaktivointi ei julkaise business-hyväksyntää; vasta seuraavan composition-käynnistyksen nykyiset portit julkaisevat business-scopen ja A = B = T. Metadata säilyy seuraavassa composition-restartissa, W6/Direct Setup -slotit ovat lopussa tyhjät. Tämä ei todista edeltävää asennuspäivitystä, kaikkia välikirjoitusten järjestyksiä tai lykätyn avauksen virhepaluita. |
| Valitsintuloksen kuluttaja, kytkentä toteutettu | `resolveDesktopWorkspaceStartup` palauttaa erillisen selector-tuloksen ilman session luontia. Main liittää sen backendittomaan käyttöliittymään ja hallintaan nykyisen lifecycle-kahvan kautta. Todellinen Electron/preload/UI-ketju ja vanhan business-sillan kontrolli läpäisivät; valitsimen näkyminen ei todista yritystietokannan terveyttä tai release-hyväksyntää. |

`DESK-SELECTOR-RETURN-001` täydentää taulukon source-null-virhepaluita:
oikea UI-vahvistus valitsee yrityksen, jonka työtilajuuri puuttuu. Seuraava
Electron-prosessi käyttää nykyistä palautusomistajaa ja päättyy hallitusti;
uusi valitsin näyttää kohteen `recoveryRequired`-tilassa. Null-valinta ja
muuttumaton hyväksyntämetadata säilyvät vielä fyysisessä restartissa.
Testiadapteri säilyttää tuotannon tyypitetyn relaunch-tuloksen, ja nykyinen
prosessiomistaja todistaa puun ja portin sulun ennen seuraavaa käynnistystä.
Synteettinen lähtö käy todellisen build-admissionin läpi. Tämä näyttö ei
kata tietokannan avaamisen jälkeistä rollbackia, lykättyä migraatiota tai
paketoidun sovelluksen hyväksyntää; taulukon muut näyttörajat säilyvät.

`DESK-SELECTOR-CREATE-001` todentaa onnistuvan fyysisen prosessiketjun:
tyhjä v2/null-valitsin, UI-luonti, uusi valitsin ilman automaattista
avausta, nimenomainen yritysavaus ja vielä business-restart. Tuotannon
backend-käynnistin suorittaa FirstStartin; synteettinen asiakas, rekisteri
ja hyväksyntämetadata säilyvät. Vanhat istunnot hylätään ja todellinen
backend-portti sekä koko prosessipuu vapautetaan ennen jatkoa. Tämä käyttää
luonnin nykyistä tietokantaversiota, ei korvaa historiallisen kopioaktivoinnin,
lykätyn päivityksen tai saman puhtaan paketin palautusportteja.

`DESK-SELECTOR-IMPORT-001` täydentää backendittoman tuonnin onnistumispolun:
nykyinen salattu synteettinen backup tuodaan native-salasanaikkunan kautta
tyhjään null-valitsimeen. Tuonti ei avaa yritystä automaattisesti. Vasta
UI-vahvistettu avaus käynnistää tuotannon backendin ja FirstStartin;
tuotu asiakas, lasku ja samat PDF-tavut säilyvät fyysisessä restartissa.
Lähdebackup ja -tietokanta säilyvät muuttumattomina. Testifixturen
valitsin-/backup-yhdistelmä sallitaan vain tälle täsmälliselle tapaukselle
erillisellä lähdejuurella; korvausbackup ja legacy-profiilin yhdistäminen
estetään. Tämä ei korvaa historiallisen backupin tai asennuspäivityksen portteja.

Business-metadatan [lukukytkentä](../../apps/desktop/src/main/desktopAcceptedSelectorStartup.ts)
ei julkaise metadataa tai muuta hyväksyntäformaattia. Se sitoo nykyiset
FirstStart-, binary-rollback- ja W6-lukijat tuoreesti varmennettuihin
tavuihin ja tiedostoidentiteetteihin. Yhtäaikaiset FirstStart-lukijat
jakavat vain keskeneräisen havainnon, eivät valmistunutta välimuistia.
Switchin omaa keskeneräistä kirjoitusta ei lueta ulkoisena ristiriitana;
sen omat valitut vartijat tarkistavat sen. Runtime tarkistaa sisäkkäisten
palautusten ja elävän backendin tilan myös terminalin jälkeisissä
valituissa kirjoituksissa. Hyväksytyn settlement-kuitin jälkeen tämä
kertakäyttöinen runtime-valtuus ei korvaa tavallista FirstStartia.
Paluu valitsimeen tarvitsee edelleen todistetun sulun, ei vain puuttuvaa
backend-kahvaa tai epäonnistunutta terveyskyselyä.

Valitsimen hallinnan [rajattu elinkaaritoteutus](../../apps/desktop/src/workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.ts) toteuttaa nykyiset
`ActiveWorkspaceLifecyclePort`- ja `WorkspaceRuntimeAbsencePort`-portit
mainin nykyisen prosessivarauksen avulla. Se sitoo yhden `create`-,
`import`- tai `switch`-huoltovarauksen täsmällisen kahvan valitsimen
elinikään jo kutsuhetkellä ennen ensimmäistä odotusta ja tarkistaa
molemmat myös fyysisen varaustarkistuksen jälkeen.
Candidate-käynnin jälkeen poissaolo vaatii uuden varaustarkistuksen;
aiempaa sulkutulosta ei käytetä sen korvikkeena. Epävarma tulos estää
jatkon ja uudelleenkäynnistyspyynnön. Mainin valitsinkuluttaja käyttää
tätä porttia yhdessä alla kuvattujen hallinnan sulkuomistajien kanssa.
Kohderegressiot sekä mainin nykyisen varausomistajan kanssa tehty
ohjattu kytkentätesti läpäisivät. Katselmuksen löytämä liian myöhäinen
huoltovarauksen sidonta toistettiin ja korjattiin; jälkikatselmus ei
löytänyt uutta vahvistettua puutetta. Native-porttien ohjaus ei korvaa
todellisen Electron-prosessin tai paketoidun palautuksen näyttöä.

**Keskeytyneen null-paluun kytkentä:** mainin rajattu
`recoverDesktopSelectorReturn` käyttää nykyistä switchin valinta- ja
kirjoitusomistajaa ennen business-valmistelua. Se ei käynnistä runtimea.
Buildin täytyy olla täsmälleen hyväksytty, metadatan vakaa nykyinen tiedosto
ja rekisterin vastata ensimmäistä valintaa. Muu update-, Direct Setup-,
W6-, create/import/adoption- tai profiilipalautusjournal estää tämän haaran
ennen sen ensimmäistä korjaavaa kirjoitusta. Niiden palautusta ei kuitata
pelkän null-osoittimen perusteella.

Paluu poikkeaa tavallisesta kaikkien journalien estosta vain täsmälleen
valitun oman switch-journalin osalta. Sen tavut, tiedostoidentiteetit ja
paluutila kuuluvat nykyisen valitun kirjoittajan tarkistuksiin. Muiden
palautusomistajien poissaolo ja metadatan valinta tarkistetaan saman
kirjoittajan ulkoisessa vartijassa myös julkaisu- ja poistoodotusten yli.
Tämä koskee sekä journalin että rekisterin kirjoituksia: kumpikin
vartijalukija uudistaa muiden omistajien tarkistuksen. Oma keskeneräinen
slot-kirjoitus ei kuulu tähän ulkoiseen tarkistukseen. Pelkkä terminal-
kutsua edeltävä tarkistus ei riitä.
Main varmentaa fyysisen varauksensa uudelleen ja switch säilyttää oman
slot-järjestyksensä. Kadonnut julkaisu- tai poistokuittaus keskeyttää
käynnistyksen; seuraava käynnistys ratkaisee säilyneet tavut uudella
valtuudella. Selector- tai business-metadatan hyväksyntää ei muuteta.
Valmis paluu jatkaa tavalliseen backendittomaan valitsimeen ilman yrityksen
terveystuloksen tai aiemman prosessin terminal-kuitin perimistä.

**Hallinnan työn päättyminen:** nykyinen `WorkspaceManagementService`
estää uudet komennot ja tilaluvut heti `closeAdmission`-kutsussa.
`shutdown` odottaa sen jo aloittamat työt; se ei todista muutoksen
onnistumista, native-prosessin poistumista tai siivousvaltuutta.
Myös epäonnistuvan tilaluvun rinnakkaiset registry- ja journaliluvut
odotetaan loppuun. Ensimmäinen sisäinen syy säilyy, ja suljettu vartija
ei hyväksy myöhäistä tulosta. Nykyinen compositionin `dispose` sulkee
pääsyn synkronisesti: oman luonti-/tuontikomennon sisäinen sulku ei saa
odottaa itseään.

Sama nykyinen hallintakyvykkyys tarjoaa erillisen `shutdown`-odotuksen
IPC-töille ja native-valinnoille. Valinnan, salasanan tai vahvistuksen
myöhäinen vastaus ei aloita seuraavaa vaihetta suljetussa kyvykkyydessä
tai vanhassa main framessa. Jo alkanut komento säilyttää oman tuloksensa.
Mainin ulkoinen sulku odottaa molemmat omistajat ennen oman fyysisen
varauksensa vapautusta; pelkkä `dispose` tai valmis odotus ei korvaa
varaus- ja prosessipoissaolotarkistusta. Tämä järjestys on todennettu
olemassa olevien IPC-, palvelu-, luonti- ja elinkaariomistajien yhteisessä
testissä ohjatuilla native-rajoilla. Mainin valitsinikkunan sulkukytkentä
on nyt toteutettu; todellisen Electronin ja paketin näyttö on tekemättä.

**Backendittoman hallinnan composition:** nykyinen
`createWorkspaceManagementComposition` erottaa selector- ja active-vaihtoehdot.
Selector ei tarvitse aktiivisen yrityksen tunnistetta, profiilin palautuspolkua
tai recovery point -palvelua. Se käyttää samoja luonti- ja tuontikomentoja sekä
candidate-runtimea; aktiivisen yrityksen korvaus puuttuu ja hylätään turvallisesti.
Tilaluku ja komentojen admission käyttävät omia sivuvaikutuksettomia lukijoitaan,
jotta samanaikainen tilaluku ei aiheuta kirjoittajan sisäisen lukon vuoksi
virheellistä recovery-tilaa. Rekisterin kaikkien slottien, null-valinnan,
palautusjournalien ja mainin eliniän tarkistukset säilyvät.

Nimenmuutoksen selector-haara kaappaa täsmällisen huoltovarauksen ennen
admission-odotusta. Nykyinen valittu rekisterikirjoitus tarkistaa elävän
valtuuden, tavut ja tiedostoidentiteetin myös odotusten yli. Muuttumaton nimi
vaatii sekin tuoreen takaisinluvun. Kadonnut kirjoituskuittaus ei oikeuta
uusintaan tai rekisterin palauttamiseen arvaamalla. Active-haaran sopimus säilyy.

Source-null-vaihto käyttää nykyisen switch-koordinaattorin nimettyä
[komentoa](../../apps/desktop/src/workspaces/switch/workspaceSelectorSwitchCommand.ts):
valittu journalin `prepared`-tila, kohdeosoittimen julkaisu ja `targetSelected`
sidotaan samoihin rekisteritavuihin, identiteetteihin ja elävään valtuuteen.
Fyysinen prosessipoissaolo tarkistetaan, ja huoltovaraus vapautetaan ennen
nykyisen relaunch-omistajan pyyntöä. Epävarma kirjoitus tai vapautus säilyttää
aineiston ja estää jatkon. Valinta ei ole yrityksen FirstStart-hyväksyntä.
Mainin valitsinkuluttaja käyttää tätä compositionia ilman aktiivisen
yrityksen polkujen tai salaisuusbrokerin muodostamista. Alempien rajojen
regressiot eivät yksin sulje W7.2:n hyväksyntää.

**Valitsinikkuna ja sovelluksen sulku:** mainin erillinen
`desktopSelectorComposition` kokoaa vain nykyiset hallinta-, native-valinta-,
permission-, ikkuna- ja H5-häiriöilmoitusrajat. Web-sisältö luetaan samasta
sovelluspaketin web-juuresta kuin business-tilassa. URL:n valitsinfragmentti
valitsee vain esityksen, ei valtuutta: main ei luo business-sessionia ja
protokolla torjuu business-reitit. Renderer ei voi vaihtaa tätä tilaa tai
käynnistää business-palvelinta URL:lla. Aktiivisen yrityksen korvausta ei
tarjota. W7.5:n backenditon tukipaketti on erillinen jatko.

Mainin sama jaettu sulkutehtävä sulkee admissionin heti, odottaa palvelun
ja IPC:n jo aloittamat työt sekä tarkistaa fyysisen varauksen ennen sen
vapautusta. Yhden omistajan sulkuvirhe ei estä toisen odottamista eikä
muutu puhtaaksi suluksi. Myöhäinen native-tiedostovalinta ei avaa
salasanaikkunaa tai aloita tuontia. Startupin valintakuittia ei käytetä
pitkäikäisen valitsinruntimen valtuutena. Rendererin latauksen epäonnistuminen
käyttää samaa sulkuomistajaa ennen quit-pyyntöä; lifecycle palautetaan jo
ennen latauksen valmistumista, kuten business-polussa. Tekninen
`desktop.started` ei kirjoita business-hyväksyntää.

Switchin nykyiset alempien rajojen testit käyttävät injektoitua terminal-
valtuutta. Ne eivät todista näiden main-liitosten valmistumista. Nykyinen
kaikki journalit torjuva valitsimen konfliktitarkistus säilyy tavallisessa
null-haarassa; se ei sellaisenaan kelpaa oman valitun paluujournalin
poistovaltuudeksi. Ristiriidat muiden palautusomistajien kanssa säilyvät
estävinä myös nimetyn paluuhaaran toteutuksessa.

Lykätyn business-avauksen nimetty tilavalmistelu tarkistaa metadatan,
rekisterin ja W6-/switch-journalin yhteisen keskeytysjärjestyksen ennen
korjaavaa metadatalukua. Nykyinen tallennin palauttaa vain valitut tavut
ja tiedostoidentiteetit tuoreen ulkoisen valtuuden suojassa. Julkaisematon
business-next ei ole hyväksyntä; jo julkaistua business-currentia ei
alenneta selector-varakappaleen vuoksi. Myös palautuksen oma keskeytys
voi jättää jatkettavan varakappaleen. Vieras palautusoperaatio, puuttuva
tiedostoidentiteetti tai ristiriitainen kirjoitusjärjestys säilyttää aineiston.
Valmistelun tulos ei ole prosessipoissaolon, business-readinessin tai
seuraavan muutoksen valtuus. Main kutsuu nyt nimettyä valmistelua v2:n
valitussa avauksessa tai keskeneräisen source-null-switchin yhteydessä,
kun sloteissa on selector-hyväksyntä. Ensimmäiset metadatatavut ja identiteetit
säilyvät valmisteluun; ensimmäinen rekisterivalinta ja installation-varaus
tarkistetaan uudelleen. Toimitetun buildin portti edeltää palautuskirjoitusta.
Vierasta create/import/adoption-omistajaa tai epäselvää palautustilaa ei
ohiteta vanhaan korjaavaan lukijaan. Main säilyttää tämän valmistelun
valitut havainnot W6:n ja FirstStartin myöhempien muutosten valtuudessa.
Metadatan sivuvaikutukseton aloitusluokitus säilyttää v1:n aiemman osittaisen
sivukirjoituksen käsittelyn myös v2-rekisterissä. Täydellinen v2-slotin arvo
ei kuitenkaan saa kadota vanhaan korjaavaan lukuun ristiriitaisessa
v1/v2-yhdistelmässä. Puuttuva tai vääränmuotoinen rekisteri ei anna
selector-metadatalle muunnosvaltuutta. Nämä tapaukset säilyttävät aineiston.
Business-current ilman selector-varakappaletta kuuluu
nykyiseen hyväksytyn kohteen palautukseen, ei kadonneen selector-tiedon
uudelleen muodostamiseen.

**Nimetty W6-jatko:** nykyinen W6-composition voi ottaa mainin erikseen
sitoman `deferredBusiness`-valtuuden. Sovellusadmission säilyy
`exactAcceptedBuild`-arvona; vain W6:n suunnittelija käyttää nimettyä
lykättyä business-haaraa. Valtuus sitoo täsmällisen selector-metadatan ja
käynnissä olevan kohdebuildin. Startup vastaa valtuuden sitomisesta elävään
käynnistyssukupolveen, valittuun yritykseen, operaatioon ja sallittuun
rekisterisiirtymään. Main toimittaa valtuuden jo valitun yrityksen
deferred-haarassa sekä yllä rajatussa source-null-switchin jatkossa.

Ennen inventaarion tuloksen käyttöä lähdemetadata, rekisteri ja mahdollinen
journal tarkistetaan uudelleen. Sama `prepared`-journal saa jatkua myös
pending -> current -muutoksen jälkeen vain nykyisten täsmällisten build-,
kohde-, passiivijoukko- ja rekisteritiiviste-ehtojen täyttyessä.
Siirtymäomistaja tarkistaa nimetyn valtuuden ennen korjaavia journal-,
rekisteri- ja metadatalukuja sekä ennen muutoksia. Myös lukeminen voi
julkaista tai poistaa sivuslotin, joten pelkkä loppukirjoituksen portti ei
riitä. Vanhentunut valtuus säilyttää tällaiset slotit muuttumattomina. Selector-tila
voi todistaa vain journalin business-lähteen, ei business-kohteen hyväksyntää:
lopetus vaatii todellisen v2/business-julkaisun. Keskeytynyt passiivisiirtymä
palautetaan tai päätetään nykyisellä journalilla. Virhe ei luo uutta
C-/Direct Setup -palautusta eikä alenna sovellushyväksyntää. Vanhat kutsujat
ilman nimettyä valtuutta säilyttävät nykyisen käsittelyn.

W6:n deferred-composition käyttää nykyisten registry- ja journal-tallentimien
valittuja operaatioita. Mainin toimittamat alkuperäiset slot-tavut ja
tiedostoidentiteetit säilyvät lukemisen, palautuksen, kirjoituksen ja poiston
yli. Journalin muutos tarkistaa rekisterin ja rekisterin muutos journalin;
mainin ulkoinen guard ei lue näiden tallentimien keskeneräisiä omia slotteja.
Julkaisun takaisinluku hyväksyy vain kirjoittajan seuraaman identiteetin.
Ensimmäisen valmistelujournalin sidonta tapahtuu ennen kirjoitusta, ja main
voi varata operaatiotunnisteen nykyisen orchestraattorin factory-portilla.
Next-only-valmistelun palautus on journal-omistajan erikseen validoima haara,
ei yleinen lupa julkaista muiden tallentimien next-tiedostoja.

Valtuus on synkroninen myös kääreiden läpi: Promise-paluu ei ole hyväksyntä.
Hylätty valtuus- tai valintaluku sekä epävarma kirjoitus sulkevat tämän
tallennuskytkennän jatkon; häiriön katoaminen ei valtuuta samaa instanssia
uudelleen. Alkuperäinen virhe ja toteutuneet tiedostot säilyvät. Metadataluku
tässä haarassa on sivuvaikutukseton ja hylkää uudet sivuslotit. Nämä portit
ovat nykyisen W6-compositionin käytössä vain erikseen toimitetulla
deferred-valtuudella. Mainin vaihekohtainen sidonta tarkistaa myös saman
valmistelun ja W6-vaiheen asynkronisten lukujen jälkeen. FirstStartin
business-julkaisun takaisinluku kuljettaa kirjoittajan identiteetin mainille;
myöhempi sattumanvarainen tiedoston lukeminen ei korvaa sitä. Valittu
callback, käynnistyksen voimassaolo ja kertakäyttöisyys säilyvät koko kutsun
yli. Mainin ulkoiset lukijat päättyvät kaikki ennen virheen palautumista.

Pysyvät testit käyttävät nykyisiä tiedostotallentimia ja v1/v2-rekistereitä.
Inventaario ja startup-valtuus ovat niissä ohjattuja; ne eivät todista oikeaa
SQLite-/Electron- tai paketoitua ketjua. Jo valitun yrityksen main-/FirstStart-
kytkentä on todennettu ohjatuilla native-rajoilla; rajatun source-null-jatkon
kytkentä on toteutettu, mutta sen kokonaisverifiointi on vielä kesken.
Ajantasainen testinäyttö
ja jäljellä oleva kytkentä kirjataan M1:n jatkamiskohtaan.

## Muuttumattomat rajat W1-W6:ssa

- Domain- ja application-logiikka eivät tunne Electron-polkuja.
- `companyId` ei tule rendereriltä tai työtilalabelista.
- Työtila ei ole käyttäjä, membership tai permission.
- Työtilat eivät jaa SQLitea, business-PDF:iä, recovery pointteja,
  restore-journalia, SMTP-secret-namespacea tai PDF-arkiston retry-journalia.
- Portable backup ei ole merge- eikä sync-formaatti.
- Uusi dependency, schema tai backup-formaatti vaatii erillisen omistajan
  päätöksen ennen toteutusta.
- Checkpointin sisällä saa tehdä pieniä paikallisia committeja ja ajaa
  kohdetestejä, mutta GitHubiin pushataan vain yksi koherentti, paikallisesti
  vihreä checkpoint. Lähtökohtaisesti checkpointilla on enintään yksi PR- ja
  CI-kierros kerrallaan; GitHubia ei käytetä ensisijaisena debuggerina.
- Seuraavaa checkpointia ei aloiteta ennen vihreää edellistä checkpointia ja
  dokumentoitua hyväksyntää. W1:n serializer-, store-, containment- ja
  recovery-osat kuuluvat samaan W1-PR:ään, eivät erillisiin kokeilu-PR:iin.

## W0: Architecture and acceptance contract

**Tila:** valmis dokumentaatiotasolla.

**Omistaja:** arkkitehtuuridokumentaatio; Electron mainin tuleva workspace-
composition.

**Muutettu:** ADR-0011, tämä suunnitelma, reititys, integraatiomatriisi ja
suunniteltu E2E-matriisi.

**Ei muutettu:** tuotantokoodi, SQLite, backup-formaatti, API, UI,
riippuvuudet, versio tai installer.

**Luottamusraja:** `workspaceId`, lineage identity, `companyId`, storage scope,
backup import/replace ja switch-lifecycle erotellaan.

**Hyväksymisportti:** dokumenttilinkit, ristiriidattomuus ADR-0008/0009/0010:n
kanssa sekä omistajan katselmus.

## W1: Installation-owned workspace registry

**Tila:** inertti foundation yhdistetty vihreänä `main`-haaraan commitissa
`687a424`; production-aktivointi ja käyttäjälle näkyvä toiminto eivät kuulu
W1:een.

**Omistaja:** Electron mainin rajattu workspace registry -adapteri ja
composition. Ei backend- tai business-moduuli.

**Muutettavat kerrokset:** desktop main, sisäinen registry schema/serializer,
composition ja testit. UI:ta ei vielä avata.

**Muuttumattomat kerrokset:** backend HTTP/API, domain, SQLite business-
schema, backup container, installer payload ja web-komponentit.

**Sopimus:**

- ADR-0011:n täsmällinen `LocalWorkspaceRegistryV1`, jossa ovat vain
  `formatVersion`, `activeWorkspaceId` ja `workspaces`
- entry sisältää vain `workspaceId`, `workspaceLabel`, versionoidun
  `lineageIdentity`-arvon, `layoutVersion = 1`, tilan `ready` tai
  `recoveryRequired` sekä strict UTC `createdAt`-arvon
- Electron mainin `crypto.randomUUID()`-funktiolla luoma canonical lowercase
  UUID v4 `workspaceId`; väärä case, versio, variantti tai muoto torjutaan
- trimmattu yhden rivin `workspaceLabel`, 1-80 Unicode-koodipistettä;
  C0/C1-control-, line separator- ja bidi override/isolate -merkit torjutaan,
  mutta W1:n toteutuksessa samat labelit sallitaan; uudempi
  [yksilöllisyyslinjaus](#yritysvalitsimen-nimien-yksilöllisyys) on hyväksytty
  suunnitteluun, ei vielä tuotantokytkentään
- `lineageIdentity.formatVersion = 1` ja täsmälleen 64 lowercase SHA-256-hex-
  merkkiä sisältävä `profileId`
- canonical UTC `createdAt` muodossa `YYYY-MM-DDTHH:mm:ss.sssZ`, jonka parseri
  todistaa parse- ja round-trip-tarkistuksella
- enintään 64 KiB UTF-8-tavuja ja 64 entryä; duplicate key, invalid UTF-8,
  unknown/prototype key, `null` ja type confusion torjutaan
- `activeWorkspaceId = null` vain ilman `ready`-entryä; muulloin osoitin viittaa
  täsmälleen yhteen `ready`-entryyn eikä koskaan `recoveryRequired`-entryyn
- mainin suljetulla säännöllä johtama
  `<userData>/workspaces/<workspaceId>/`-juuri; locatoria ei tallenneta
- crash-safe `workspace-registry-v1.json`, `.next` ja `.backup` -slotit sekä
  deterministinen recovery
- keskeneräiset create/import/switch/restore-tilat vain erillisissä
  operation journaleissa
- enintään yksi active pointer ja yksi workspace per lineage.

Registry v1 ei sisällä `revision`-, `locator`-, `companyId`-, `actorId`-,
`installationId`-, `secret`-, `journal`- tai business-kenttiä. Uusi kenttä tai
suurempi resurssiraja vaatii versionoidun päätöksen.

**Luottamusraja:** renderer ei lue tai kirjoita rekisteritiedostoa eikä saa
storage locatoria. Rekisteri, renderer tai backup eivät saa antaa työtilan
absoluuttista tai suhteellista polkua. Kaikki input validoidaan suljetulla
schema- ja pituusrajalla.

**Fail-closed-tilat:** unknown version/field/state, duplicate ID/lineage,
invalid ID tai timestamp, missing derived root, corrupt current ja
ristiriitaiset recovery-slotit.

**Maintenance lease:** sama installation-scoped lease serialisoi backup-,
restore-, update- ja workspace-maintenance-operaatiot. Tavallinen snapshot tai
portable backup käyttää nykyistä aktiivista SQLite-owneria eikä avaa candidate-
kantaa. Aktiivinen backend suljetaan todistetusti ennen candidate-SQLiten
avaamista create/import/replace/adopt/switch/migration-polussa.

**Testit:** serializer/parser, atomic replacement ja restart-recovery
kirjoituksen vikapisteissä, disk-full- ja short-write-tilat, rinnakkaisten
operaatioiden fail-closed-raja, unknown-field/null/prototype/path-korpus,
duplicate identity sekä tiedostokoon, käyttöoikeuksien, symlinkin, hardlinkin
ja containmentin rajat. POSIX-oikeusraja ajetaan POSIX-ympäristössä ja
Windowsin tiedostorajaukset Windowsissa.

**W1:n aktivointiraja:** registry codec, store ja testit käyttävät vain testin
yksityisiä temp-juuria. W1:tä ei kytketä tavalliseen production-startupiin,
nykyiseen 0.2.6-profiiliin tai käyttäjän `userData`-juureen. Se ei luo
rekisteriä, siirrä profiilia, vaihda runtime-juurta, muuta backup-/secret-
polkuja eikä adoptoi legacy-profiilia. Tuotantokytkentä alkaa vasta W4:ssä.

W1-W3:n inertti workspace-lähdekoodi kuuluu tavalliseen sourceen,
typecheckiin ja testeihin, mutta se suljetaan väliaikaisesti desktopin
production-buildistä ja package-payloadista. TypeScript-buildin exclusion ei
yksin ole turvallisuusraja: application-stage artifact inventory torjuu
fail-closed-tilassa kaiken `dist/workspaces/**`-sisällön myös silloin, jos
vahingossa lisätty importti saisi TypeScriptin kääntämään exclusionin takana
olevan tiedoston. Staattinen import-raja todistaa lisäksi, ettei registryä ole
kytketty desktopin production-entrypointteihin, preloadiin, Electron E2E:n
entryyn, webiin tai backendiin. Build exclusion ja inventory-raja poistetaan
tai korvataan vasta W4:n erikseen hyväksytyssä production-compositionissa.
W1-W3 eivät muuta käyttäjän AppDataa tai normaalia startupia.

**Dokumentit:** ADR-0011:n toteutustila ja integraatiomatriisi.

**Commit/PR/release:** yksi W1-PR; ei käyttäjälle näkyvää releasea.

## W2: Empty workspace creation

**Tila:** inertti foundation toteutettu ja paikallisesti todennettu. W2 ei ole
production-compositionissa eikä käyttäjälle näkyvä ominaisuus. Aktivointi
odottaa W4:n erillistä hyväksyntää ja checkpointia.

**Omistaja:** Electron mainin workspace coordinator; backendin nykyinen
fresh-profile bootstrap rajatun portin takana.

**Muutettavat kerrokset:** `apps/desktop/src/workspaces/`-alueen yksityinen
workspace root, luontijournal, lifecycle-portit, koordinaattori ja testit.
Mahdollinen production-composition tulee vasta W4:ssä ja UI vasta W5B:ssä.

**Muuttumattomat kerrokset:** business-domain, API-sopimukset,
backup-formaatti ja installer/update.

**Sopimus:** uusi työtila syntyy candidate-rootiin, saa uuden `workspaceId`:n
ja uuden SQLite `companyId`:n, migroituu nykyiseen manifestiin ja julkaistaan
rekisteriin vasta readiness-portin jälkeen.

Tyhjän työtilan luonti etenee aina seuraavassa järjestyksessä:

1. validoi käyttäjälle näkyvä label W1:n suljetulla säännöllä
2. varaa installation-scoped `WorkspaceMaintenanceLease`
3. estää uudet aktiivisen työtilan kirjoitukset
4. sulkee aktiivisen backendin ja todistaa sen tiedostokahvat suljetuiksi
5. luo uuden `operationId`:n ja `workspaceId`:n
6. johtaa samalla levyllä olevan yksityisen candidate-rootin vain näistä
   tunnisteista
7. julkaisee `prepared`-journalin ennen candidateen kirjoittamista
8. bootstraptaa tyhjän SQLite-profiilin backendin yksityisen portin kautta
9. ajaa kaikki nykyisen manifestin migraatiot
10. todistaa täsmällisen migration chainin, integrityn ja foreign keyt
11. todistaa tuoreen `companyId`:n, `local-owner`-actorin ja profile-lineagen
12. luo työtilan auktoritatiivisen business-artifact-juuren
13. nimeää candidate-rootin atomisesti lopulliseksi työtilajuureksi
14. julkaisee uuden `ready`-entryn atomisesti W1-rekisteriin
15. varmistaa idempotentisti, että aiemmalla aktiivisella työtilalla on
    täsmälleen yksi terve runtime
16. poistaa luontijournalin vasta terminal-tilassa ja vapauttaa leasen.

Jos rekisterissä on jo aktiivinen `ready`-työtila, osoitin ei muutu. Jos
rekisterissä ei ole yhtään `ready`-työtilaa, ensimmäinen uusi työtila saa
aktiivisen osoittimen, mutta W2 ei vielä käynnistä sitä. Samat labelit ovat
sallittuja; workspace-, company- ja lineage-identiteetit ovat aina erilliset.

Workspace coordinator varaa installation-scoped `WorkspaceMaintenanceLease`-
leasen ennen candidate-SQLiten avaamista. Aktiivinen backend ja kaikki sen
SQLite-kahvat suljetaan ensin, joten asennuksessa on myös maintenance-vaiheen
aikana enintään yksi business-SQLite-omistaja.

W2:n nimetyt ja kapeat portit ovat:

- `WorkspaceMaintenanceLease`
- `ActiveWorkspaceLifecyclePort`
- `WorkspaceRuntimeAbsencePort`
- `WorkspaceRegistryPort`
- `EmptyWorkspaceBootstrapPort`
- `WorkspaceCreationJournalStore`
- `EmptyWorkspaceCreationCoordinator`.

Lease-, runtime-lifecycle- ja registry-portit ovat neutraaleja workspace-
sopimuksia eivätkä creation-moduulin omistamia. Creation mapittaa niiden
virheet omiin suljettuihin virhekoodeihinsa. Jos quiesce epäonnistuu ennen
kirjoitusten pysäyttämistä, runtimea ei käynnistetä uudelleen. Kun quiesce on
onnistunut, jokainen myöhempi failure-polku käyttää idempotenttia
`ensurePreviousWorkspaceRunning`-operaatiota. Se hyväksyy jo terveen runtimen
mutta ei saa käynnistää rinnakkaista backendia; epäonnistuminen johtaa
`WORKSPACE_CREATION_RECOVERY_REQUIRED`-tilaan.

Electron main ei avaa SQLitea eikä tuo `better-sqlite3`:a. Bootstrap-portti
saa mainin johtaman candidate-profiilijuuren ja rajatun teknisen kontekstin.
Se palauttaa vain suljetun readiness-tuloksen: nykyinen migration chain,
integrity/FK-status, bootstrap-actor, tuore company-identiteetti, profile-
lineage ja todistus suljetuista kahvoista. SQLite-kahvaa, runtime-sessionia,
raakaa virhettä tai business-dataa ei palauteta.

### W2:n storage layout

Lopullinen juuri on aina:

`<userData>/workspaces/<workspaceId>/`

Candidate on samalla volumeella installation-owned operaatiojuuressa:

`<userData>/workspace-operations/<operationId>/<workspaceId>/`

Candidate säilyttää nykyisen profiilin sisäisen rakenteen:

- `runtime/data/eky.sqlite`
- `runtime/storage/invoices/`
- vain erikseen hyväksytyt workspace recovery/restore -juuret.

Candidate ei sisällä update-journalia, package cachea, accepted-build-
metadataa, diagnostiikkaa, operational-lokeja, support bundlea tai release-
artifacteja. Main johtaa kaikki polut. Canonical containment, private root,
symlink/reparse- ja hardlink-raja, olematon final-root sekä same-volume atomic
rename todistetaan ennen julkaisua.

### WorkspaceCreationJournalV1

W2 käyttää omaa tarkasti nimettyä luontijournalia, ei geneeristä operation-
frameworkia. Journalissa ovat täsmälleen:

- `formatVersion`
- `operationId`
- `workspaceId`
- validoitu `workspaceLabel`
- `previousActiveWorkspaceId`
- monotoninen `state`
- `createdAt`
- bootstrapin jälkeen validoitu `lineageIdentity`.

Tilat etenevät vain järjestyksessä `prepared`, `candidateRootCreated`,
`bootstrapCompleted`, `candidateValidated`, `rootPublished` ja
`registryPublished`. Journalissa ei ole polkuja, companyId:tä, actorId:tä,
SQL:ää, sessionia, salaisuuksia, raakaa virhettä, stackia tai business-dataa.
Codec on exact-key, kokorajoitettu ja torjuu duplicate/prototype/unknown-
avaimet. Store käyttää W1:n tavoin current/next/backup-slotteja, yksityisiä
oikeuksia ja atomista vaihtoa.

Restart-recovery sovittaa journalin, filesystemin ja rekisterin toisiinsa:

- ennen rootin julkaisua keskeneräinen candidate poistetaan turvallisesti
- jos final-root on julkaistu mutta journal ei edennyt, root validoidaan ja
  registry-publish jatketaan idempotentisti
- jos registry-entry on julkaistu mutta journal ei edennyt, entry, root ja
  lineage validoidaan ennen terminal-tilaa
- ristiriitainen final-root, entry, lineage tai journal johtaa
  `recoveryRequired`-/fail-closed-tilaan eikä arvaavaan cleanupiin
- julkaistu työtilajuuri validoidaan vain, kun
  `WorkspaceRuntimeAbsencePort` todistaa, ettei aktiivista workspace-runtimea
  ole käynnissä; aktiivinen tai tuntematon tila pysäyttää recoveryn ennen
  backendin tai SQLite-kahvan avaamista
- aiemmalle aktiiviselle työtilalle varmistetaan täsmälleen yksi terve runtime
  vasta candidate-kahvojen sulkeutumisen jälkeen.

Kylmäkäynnistyksessä viimeinen ehto korvataan erikseen hyväksytyllä
[C-P2-terminalilla](../decisions/ADR-0011-local-multi-workspace-company-model.md#createimport-recoveryn-kylmäkäynnistyksen-terminal):
tarkka ready-jatkotyötila ja sen juuri varmennetaan ennen journalin poistoa,
mutta business-runtime käynnistyy ja validoituu vasta normaalissa startupissa.
`beforeRuntimeStart`-tila ei saa lifecycle-käynnistysporttia. Ristiriita tai
puuttuva jatkotyötila säilyttää journalin. C-paketin tuotantokytkentä ja
paketoitu keskeytys/restart-todennus ovat erillisiä hyväksyntäehtoja.

**Kylmäpalautuksen journal-admission:** `workspaceColdRecoveryAdmission.ts`
valitsee vain mahdollisen create/import-recoveryn omistajan. Se ei anna
kirjoitus-, siivous- tai runtime-käynnistysvaltuutta. Puuttuvat create/import-
slotit palauttavat `none`, jolloin muiden startup-recoveryjen oma menettely
säilyy; tämä tulos ei myöskään oikeuta plaintext-karanteenin siivoamiseen.
Molempien operaatioiden löytyminen pysäyttää käsittelyn. Yhden operaation
löytyessä tarkistus torjuu adoption, switchin, first-start-registry-siirtymän,
replacementin ja mainin toimittamien profiilipalautusten keskeneräiset slotit.
Current-, next- ja backup-slotit tarkistetaan ilman korjaavaa store-lukua.

Update-journalilta sallitaan vain nykyisen omistavan politiikan terminal-tila
(`accepted`, `installerNotApplied` tai `rolledBack`), direct-Setup-tilalta
vain `accepted`. Tämä koskee myös legacy-update-juuren current-slottia;
kelvollinen terminal ei yksin todista build-identiteettien yhteensopivuutta.
Next/backup estää tämän poikkeuksen. Sisältö luetaan nykyisellä rajatulla
`readSlot`-metodilla, ei slottien korjaavalla `recoverAndRead`-metodilla.
Väärä tiedostotyyppi, linkki, katkennut linkki, lukupoikkeama tai virheellinen
terminal-tietue hylätään. Sama lukija palvelee nykyistä management-guardia.

Mainin polkukooste `workspaceColdRecoveryAdmissionComposition.ts` johtaa
polut vain mainin juuresta ja nykyisistä omistavista polkurakentajista.
Se kattaa legacy-profiilin, valitun operaation kohteen ja aiemman työtilan
sekä kaikki auktoritatiivisen rekisterin työtilat, myös passiiviset ja
`recoveryRequired`-tilaiset. Replacement-journal on installation-kohtainen.
Puuttuva create/import-operaatio ei käynnistä rekisterin lukua tai korjausta.

`CrashSafeByteSlotStore.inspect` valitsee ensimmäisen olemassa olevan slotin
järjestyksessä current, backup, next ja validoi sen ilman tiedostomuutoksia.
Sama valinta palvelee nykyistä korjaavaa `recoverAndRead`-metodia; sen
siirto- ja poistoehdot eivät muutu. Virheellinen valittu slotti estää
käsittelyn, eikä alemman prioriteetin kelvolliseen tietueeseen pudota.
Syrjäytettyjä slotteja ei lueta lisätunnisteiden lähteenä: kesken jäänyt
tyhjä next ei hylkää kelvollista currentia tai backupia. Nykyiset create/import
lisäävät vain journalissa nimetyn kohteen; muut sallitut rekisterimuutokset
säilyttävät jäsenjoukon. Siksi tämä joukko kattaa nykyiset profiilit.
Työtilojen poiston tai muun jäsenjoukkoa muuttavan toiminnon yhteydessä
kattavuus tarkistetaan uudelleen.

Polkukooste ei ota leasea tai valtuuta siivousta. Cold-recoveryn pakollinen
`assertRecoveryAdmission`-portti kutsutaan recoveryn itsensä hankkiman
installation-leasen alla, runtime-poissaolon tarkistuksen jälkeen ja ennen
mutatoivia journal-lukuja tai importin plaintext-karanteenia. Mainin
`assertColdWorkspaceRecoveryAdmissionFromRoot` lukee nykyisen tilanteen
uudelleen ja vaatii valitun create/import-omistajan; aikaisempi valinta ei
riitä. Omistajan katoaminen tai vaihtuminen ja uusi kilpaileva journal
estävät käsittelyn. Hylkäys vapauttaa leasen muuttamatta recovery-aineistoa.
Admissionin turvallinen management-koodi ja recoveryn nykyiset nimetyt
virhekoodit säilyvät ulommalle startup-virherajalle; raakaa viestiä tai
virhekoodin lisätekstiä ei hyväksytä. Ordinary-recoveryn sopimus säilyy.
Tämä ei korvaa erillistä runtime-poissaolon todistetta. C:n startup-kytkentä
on toteutettu rajatuin composition-testein; paketoitu keskeytys/restart-näyttö
ja koko kytkennän hyväksyntä ovat edelleen avoimia. Pelkkä polkukoosteen,
admissionin tai synteettisen compositionin testi ei sulje niitä.

**C/R18:n journal-versio ja tuotannon järjestys:** uudet create/import-
operaatiot kirjoittavat `formatVersion: 2` vasta todetun sulun ja takaisin
saadun main-varauksen jälkeen. V1 säilyy luettavana legacy-tyyppinä, mutta
automaattinen cold-recovery hylkää sen ennen korjaavaa lukua. Saman operaation
versiota ei vaihdeta. Nykyiset `-v1`-slottinimet, muut kentät, kokorajat ja
slottien etusija säilyvät; versionvaihto ei muuta siirrettävää backup-formaattia.
Erillistä sidecaria tai valinnaista `guarded`-kenttää ei lisätä. Vanhan
lukijan V2-hylkäys ilman slottien muutosta pitää todentaa testillä.

Main tekee ensin readonly-admissionin, sitten nykyisen build-tarkistuksen ja
`recoverWorkspaceManagementBeforeRuntime`-kutsun samalla varauksella ja
huoltoleasella. Vasta tämän jälkeen tulevat first-start-palautus, työtilan
valinta ja normaali backend. V2-tuonnin hyväksytty omistaja saa siivota oman
plaintext-karanteeninsa. Ilman tuontijournalia löytyvä plaintext säilytetään
ja avaus estetään; vapaa varaus ei todista vanhaa suojaamatonta kirjoittajaa
poistuneeksi. Julkaistun kohteen validaattorin poistuminen ja mainin varauksen
takaisinotto vaaditaan ennen siivousta. Tarkka jatkotyötila varmennetaan ennen
journalin poistoa, mutta business-terveystarkistus on edelleen erillinen ehto.
Vanhan keskeytyksen esto ei koske tavallisesti valmistunutta työtilaa tai
vanhaa laskua pelkän iän perusteella.

**Luottamusraja:** label on käyttäjän syöte; polku ja identiteetit ovat mainin
luomia. Renderer ei saa päättää initial companyId:tä.

**Fail-closed-tilat:** lease, rootin luonti, bootstrap, migration,
integrity/FK, identity, lineage, shutdown, restart, atomic rename, journal,
registry publish, disk/short-write tai turvallinen cleanup epäonnistuu.
Candidate poistetaan vain, kun omistajuus ja tila voidaan todistaa; muuten se
karanteenoidaan tai operaatio jää `recoveryRequired`-tilaan. Aiempi registry,
aktiivinen työtila ja sen profiilitavut eivät muutu failure-polussa.

**Testit:** toteutetut kohdetestit kattavat ensimmäisen ja toisen tyhjän
työtilan, samat labelit, eri workspace/company/lineage-identiteetit,
aktiivisen osoittimen säännöt, nimetyt failure- ja crash-pisteet,
ID-törmäykset, symlink/reparse/containment-rajat, byte-identtisen aiemman
registryn ja profiilin failure-polussa sekä restart-recoveryn. Staattiset
rajatestit todistavat, ettei W2 vuoda production-entrypointteihin tai tuo
SQLite-ajuria Electron mainiin. System-E2E bootstraptaa aidosti tuoreen
yksityisen profiilin oikealla backend-prosessilla, ajaa nykyiset migraatiot,
todistaa kahvojen ja loopback-portin sulkeutumisen ja tarkastaa julkaistun
profiilin backendin nykyisellä trusted inspectorilla ilman testi-HTTP-reittiä
tai Electron mainin SQLite-avausta.

**Aktivointiraja:** W2-lähdekoodi pysyy W1:n production-build exclusionin,
package inventory -kiellon ja staattisen import-rajan takana. Se ei muuta
startupia, mainia, preloadia, IPC:tä, rendereriä, UI:ta, AppDataa, normaalia
profiilia tai release-käyttäytymistä.

**Dokumentit:** workspace storage layout, journal/recovery ja bootstrap-
lifecycle tässä suunnitelmassa sekä ADR-0011:n maintenance-raja.

**Commit/PR/release:** yksi W2-PR; ei vielä käyttäjälle näkyvää releasea.

### W2.1: Shared contracts and lifecycle hardening

**Tila:** toteutettu inerttinä kovennuksena ennen W3:a; production-
aktivointia, preloadia, IPC:tä, UI:ta tai HTTP-sopimusta ei lisätty.

W2.1 siirtää maintenance lease-, active runtime lifecycle- ja registry-portit
niiden neutraaleihin workspace-omistajiin. Creation saa käyttää portteja,
mutta neutraalit sopimukset eivät saa importata creation-moduulia.

Partial-stop-sopimus erottaa quiesceä edeltävän failure-polun kaikista
quiescen jälkeisistä poluista. Quiescen jälkeen aiemman runtimen terveys
varmistetaan myös osittaisen stopin, identiteetin luonnin, journalin,
bootstrapin ja cleanupin virheissä. Testeissä backend- ja SQLite-ownerien
enimmäismäärä pysyy yhdessä.

Startup-recovery käyttää erillistä `WorkspaceRuntimeAbsencePort`-sopimusta
ennen julkaistun työtilan yksityistä validointia. Sopimus ei ole yleinen
prosessilistauscapability eikä palauta PID:iä, komentoriviä tai prosessitietoa
rendererille.

### W1/W2 persistence reuse -audit

W1-rekisterin ja W2-luontijournalin toteutuksissa on tarkoituksellista,
täsmällistä toistoa seuraavissa turvallisuusmekanismeissa:

- private directory- ja regular-file-tarkistukset, symlink/reparse- ja
  hardlink-rajat sekä avatun tiedoston identiteetin uudelleentarkistus
- `current`, `next` ja `backup` -slotit, exclusive next-writer, fsync,
  atomiset rename-vaiheet ja deterministinen restart-recovery
- bounded UTF-8 JSON -luku, duplicate-key-torjunta ja canonical round-trip.

Semantiikaltaan eri vastuuta ovat tiedostonimet ja polkujen containment,
64 KiB registry- ja 16 KiB journalirajat, skeemat, canonical serializerit,
registry-validointi, journalin monotoninen state machine, operation-kohtaiset
remove/discard-ehdot sekä moduulikohtaiset virheet. Näitä ei yhdistetä.

W3 ei kopioi koko current/next/backup- ja filesystem-toteutusta kolmatta
kertaa. Jos W3:n toteutuksessa osoitetaan todellinen tarve, yhteiseksi voidaan
erottaa vain kapea, turvallinen atomic-slot-primitive omalla hyväksytyllä
vastuullaan. Import-journalin schema, state machine, serializer, validointi,
resurssirajat ja virheet pysyvät W3:n omistuksessa. Geneeristä JSON manageria,
operation frameworkia, base storea tai persistence manageria ei luoda.
Nykyistä W1/W2 persistenceä ei refaktoroida ennen W3:a ilman suoraa
turvallisuusvikaa ja erillistä rajattua päätöstä.

## W3: Import backup as new workspace

**Tila:** toteutettu inerttinä foundationina. Koordinaattori, kahden vaiheen
backup-tarkastus, private candidate, forward-migraatio, täysi validointi,
atominen root- ja registry-julkaisu sekä restart-recovery on toteutettu ja
todistettu unit-, fault-, recovery-, security- ja system-E2E-testeillä.
Production-compositionia, preloadia, IPC:tä, UI:ta tai julkista HTTP-reittiä
ei ole lisätty. W3b on toteutettu erillisenä inerttinä foundationina; W4:n
production-kytkentä on edelleen toteuttamatta.

**Omistaja:** Profile Protection / Backup / Restore yhdessä workspace
coordinatorin kanssa. Backup inspector säilyy backup-formaatin omistajana.

**Muutettavat kerrokset:** desktop backup/import-application service,
workspace candidate composition ja testit.

W3 saa käyttää neutraaleja `WorkspaceMaintenanceLease`-,
`ActiveWorkspaceLifecyclePort`-, `WorkspaceRuntimeAbsencePort`- ja
`WorkspaceRegistryPort`-sopimuksia. Se ei saa käyttää creation-journalin
schemaa, state machinea tai virheitä import-operaation mallina.

**Muuttumattomat kerrokset:** `.ekybackup` v1, kryptografia, business-schema,
HTTP/API ja nykyinen same-lineage restore.

**Sopimus:** autentikoitu backup, jonka lineagea ei ole rekisterissä, tuodaan
uutena työtilana private staging -> forward migration -> full validation ->
atomic root publish -> atomic registry publish -ketjulla. W3 on inertti
foundation: sitä ei kytketä production-compositioniin, preloadiin, IPC:hen,
rendereriin, webiin tai julkiseen backend-HTTP:hen.

Import hankkii installation-scoped `WorkspaceMaintenanceLease('import')`-
leasen ennen backupin autentikointia. Se torjuu ratkaisemattoman import-
journalin sekä todistamattoman plaintext-aineiston ennen uuden backupin
lukemista; pelkkä allowlistattu nimi ei anna siivousvaltuutta.
Candidate avataan vain saman
`WorkspaceMaintenanceLease`-
leasen aikana ja aktiivisen business-SQLite-omistajan sulkeutumisen jälkeen.
Failure sulkee candidate-kahvat ennen aiemman aktiivisen runtimen
uudelleenkäynnistystä.

### W3:n omistajuus ja elinkaari

- Backup inspector omistaa `.ekybackup` v1 -containerin autentikoinnin,
  kryptografian, suljetun manifestin ja payload-rajojen tarkastuksen.
- Workspace import coordinator omistaa operaation järjestyksen ja vain sen.
- Registry omistaa rekisterin validoinnin ja atomisen julkaisun.
- Workspace runtime/lifecycle omistaa aktiivisen backendin ja SQLite-
  kahvojen sulkemisen sekä aiemman runtimen palauttamisen.
- Backendin yksityinen import-bootstrap-/inspection-portti omistaa SQLite-
  migraatiot, integrityn, foreign keyt, identiteetin ja business-artifactien
  tarkastuksen. Electron main ei importoi SQLite-ajuria eikä avaa kantaa.

Koordinaattori etenee ADR-0011:n suljetussa järjestyksessä.
Ensimmäinen tarkastus autentikoi containerin ja lukee manifestin ilman
SQLitea. Leasen ja aktiivisen runtimen sulkemisen jälkeen tehtävä toinen
tarkastus purkaa candidateen ja todistaa container-SHA:n, `profileId`:n sekä
migration chain -identiteetin samoiksi. Vasta sitten backend saa avata
candidate-SQLiten ja ajaa puuttuvat forward-migraatiot.

Tuonnissa ei käytetä nykyisen aktiivisen profiilin preRestore-pistettä,
restore activation journalia tai active-profile replace -palvelua. W3 ei
yhdistä rivejä, korvaa olemassa olevaa työtilaa eikä käynnistä uutta
workspace-runtimea.

### W3 plaintext quarantine

W3 omistaa yhden kapean installation-scoped plaintext-karanteenin polulla
`<userData>/workspace-operations/workspace-import-plaintext-quarantine/`.
Renderer, backup, registry, workspace-label tai business-identiteetti eivät
anna sen polkua tai tiedostonimeä. Karanteeni hyväksyy vain canonical lowercase
UUID v4 -nimet muodossa `workspace-import-<uuid>.payload`, tavallisen rajatun
yhden linkin tiedoston, yksityiset oikeudet ja täsmällisen canonical
containmentin.

Normaali decrypt-polku luo payloadin exclusive-create-säännöllä ja poistaa sen
odotetussa `finally`-polussa. Cold-recovery saa siivota vain oman hyväksytyn
v2-operaationsa karanteenin yllä kuvatun C/R18-admissionin, build-portin,
leasen, runtime-poissaolon ja palautuneen main-varauksen jälkeen.
V1 tai journaliton plaintext säilytetään ja avaus estetään; vapaa varaus ei
todista vanhan suojaamattoman kirjoittajan poissaoloa. Cleanup ei avaa
SQLitea. Tuntematon entry, hakemistoksi naamioitu payload,
symlink, reparse point, hardlink, ylikokoinen tiedosto tai epäselvä juuri
johtaa `recoveryRequired`-tilaan eikä arvaavaan poistoon. Karanteeni ei kuulu
registryyn, portable backupiin, candidateen tai lopulliseen workspace-rootiin.

W3:n alkuperäinen inertti vaihe on toteutushistoriaa. Nykyinen
production-järjestys on yllä kohdassa C/R18:n journal-versio ja tuotannon
järjestys; hyväksyntätila on [M1:ssä](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

### WorkspaceBackupImportJournalV1

Otsikko säilyttää alkuperäisen v1-sopimuksen viiteankkurin. Nykyinen kirjoittaja
käyttää `formatVersion: 2`; v1 säilyy erillisenä legacy-lukumuotona eikä sitä
päivitetä saman operaation sisällä. Muut kentät ja `-v1`-slottinimet säilyvät.
Täsmällinen kenttäjoukko on:

- `formatVersion: 2` (legacy-lukumuodossa `1`)
- `operationId`
- `workspaceId`
- validoidun `workspaceLabel`-arvon
- `previousActiveWorkspaceId: string | null`
- monotonisen `state`-arvon
- canonical UTC `createdAt`-arvon
- `lineageIdentity`, joka on `null` ennen täyttä validointia.

Sallitut tilat järjestyksessä ovat:

1. `prepared`
2. `candidateRootCreated`
3. `backupStaged`
4. `candidateMigrated`
5. `candidateValidated`
6. `rootPublished`
7. `registryPublished`.

Codec torjuu unknown- ja duplicate-keyt, prototype-avaimet, väärän version,
ylikokoisen tai invalidin UTF-8:n ja ei-kanonisen rakenteen. Store käyttää
crash-safe current/next/backup-slotteja ja yhtä kirjoittajaa. Journalin
schema, serializer, tilasiirtymät, kokoraja ja virheet kuuluvat importille,
vaikka raakatavujen atominen slot-kirjoitus jaetaan W1/W2/W3:n kesken.

Journalissa ei ole backup-polkua, salasanaa, avainta, `companyId`:tä,
`actorId`:tä, SQL:ää, business-dataa, PDF-nimiä, runtime-sessionia,
salaisuutta tai raakaa `Error`-arvoa.

### W3 restart-recovery

- Recovery valitsee journalin ensin muuttamatta sitä. C/R18:n readonly-
  admission, build-portti, `import`-lease, runtime-poissaolo ja main-varauksen
  palautuminen edeltävät korjaavaa lukua ja oman v2-karanteenin siivousta.
  V1, journaliton plaintext tai todistamaton vanha omistaja estää jatkon;
  aineisto säilyy eikä tulos ole `nothingToRecover`.
- Ennen `rootPublished`-tilaa keskeytynyt import sulkee mahdolliset private-
  kahvat, poistaa tai fail-closed-karanteenoi candidaten ja poistaa journalin.
  Operaatiota ei jatketa ilman käyttäjän uudelleen valitsemaa backupia ja
  salasanaa.
- `rootPublished` ennen `registryPublished`-tilaa vaatii runtimen poissaolon,
  lopullisen rootin täyden identity-, migration-, SQLite- ja artifact-
  validoinnin sekä uuden duplicate-lineage-tarkastuksen ennen registry-
  julkaisua.
- `registryPublished`-tila vaatii entryn, rootin ja lineagen täsmällisen
  vastaavuuden. Aktiivinen osoitin säilytetään tai asetetaan ensimmäiseen
  ready-entryyn sovitun säännön mukaan, minkä jälkeen journal voidaan poistaa.
- Puuttuva tai ristiriitainen journal, root, registry-entry tai lineage jää
  `recoveryRequired`-tilaan. Recovery ei arvaa eikä tarvitse lähdebackupia tai
  salasanaa.

**Luottamusraja:** backup ja salasana ovat ulkoisia syötteitä. Main omistaa
Open-dialogin; renderer ei saa tiedostopolkua tai salasanaa.

**Fail-closed-tilat:** väärä salasana, unknown format, future/changed/missing-
middle migration, duplicate lineage, invalid SQLite/artifact/identity,
levytila tai publish failure.

**Testit:** nykyinen synteettinen backup-korpus, historical prefix, PDF:t,
tyhjä artifact-katalogi, duplicate lineage molemmissa tarkistuspisteissä,
jokaisen journal-vaiheen restart, normaalin ja kaatumisesta jääneen plaintext-
payloadin cleanup, unknown-entryn fail-closed-torjunta, salaisuuksien poissulku,
cross-workspace isolation, lähdecontainerin muuttuminen tarkastusten välissä,
future/changed/reordered/missing-middle-historia, filesystem-boundaryt sekä
enintään yksi backend/SQLite-owner ja nolla orphan-prosessia. Oikeaa backupia,
salasanaa, AppData-profiilia tai business-dataa ei käytetä.

**Dokumentit:** backup-planin multi-workspace-osuus ja restore-runbook.

**Commit/PR/release:** yksi W3-PR; ei vielä user releasea.

## W3b: Replace existing workspace from same-lineage backup

**Tila:** toteutettu inerttinä foundationina. Koordinaattori, exact-lineage-
raja, workspace-kohtaiset polut, nykyisen restore activation transactionin
käyttö, byte-identtinen rollback ja todelliseen salattuun backupiin perustuva
system-E2E-todiste ovat valmiit. Polkua ei ole kytketty production-
compositioniin, preloadiin, IPC:hen, UI:hin, paketoituun sovellukseen tai
käyttäjän AppData-profiiliin. Tämä kytkentä kuuluu W4:n erilliseen vaiheeseen.

**Omistaja:** Profile Protection / Backup / Restore; coordinator lukitsee
kohdetyötilan ja aktivoinnin.

**Muutettavat kerrokset:** restore target resolution, workspace-scoped
recovery point, activation journal ja testit.

**Muuttumattomat kerrokset:** backup container, business-domain ja muiden
työtilojen data.

**Sopimus:** ensimmäisessä versiossa vain aktiivinen työtila ja exact lineage
saavat osallistua korvaukseen. Passiiviseen kohdetyötilaan vaihdetaan ensin
hallitulla switchillä. Korvaus on installation-scoped maintenance-leasen
takana tehtävä snapshot + staging + forward migration + validation + atomic
replace, ei taulu- tai tietuemerge.

Nykyisen restore-moottorin auditin perusteella
`ProfileRestoreActivationTransaction` on jo sidottavissa constructorissa
annettuihin aktiivisen tietokannan, artifact-juuren, stagingin, rollbackin,
failed-rootin ja activation journalin polkuihin. W3b käyttää tätä samaa
transactionia ja `ProfileRestoreStartupRecovery`-recoveryn tilakonetta
workspace-kohtaisilla poluilla. W3b ei luo rinnakkaista rollback-journalia,
activation transactionia tai tiedostonsiirtomoottoria.

Legacy-`ProfileRestoreStagingService` ja `ProfileRestoreActivationService`
säilyvät yhden aktiivisen legacy-profiilin composition-palveluina. Niiden
active-profile-, relaunch- tai tyhjän profiilin oletuksia ei kopioida W3b-
koordinaattoriin. Backup-containerin autentikointi sekä candidate-SQLiten
migraatio-, identity-, integrity-, foreign key- ja artifact-validointi
käyttävät W3:n nykyisiä kapeita portteja.

**Luottamusraja:** käyttäjä valitsee rekisteristä workspaceId:n; main todistaa
lineagen. Label, nimi tai Y-tunnus eivät oikeuta korvausta.

Ensimmäisen version exact-lineage-raja vaatii samanaikaisesti:

- registry on täysin validoitu ja kohdetyötila on `ready`
- `targetWorkspaceId === activeWorkspaceId`
- autentikoidun backupin `profileId` täsmää target-entryn lineage-
  `profileId`:hen
- registryssä on täsmälleen yksi entry kyseiselle lineagelle
- yksikään update-, import-, create-, switch-, restore- tai muu workspace-
  maintenance-operaatio ei ole ratkaisematta.

Nämä ehdot todistetaan ennen kirjoituksia ja uudelleen maintenance-leasen
saamisen jälkeen ennen runtimen pysäyttämistä. Registry-entry, workspaceId,
label, `createdAt`, lineage ja active pointer säilyvät byte-identtisinä.

**Fail-closed-tilat:** wrong lineage, duplicate lineage registryssä,
pre-restore failure, invalid staging, activation/rollback failure ja
`recoveryRequired`.

Suljettu suoritusjärjestys on: targetin ja operation-tilan validointi,
backupin autentikointi, exact-lineage-todistus, `replace`-lease, registry-
revalidointi, kirjoitusten quiesce, workspace-scoped preRestore-piste nykyisen
snapshot-brokerin ja SQLite-ownerin ollessa vielä hallitusti käytössä,
runtimen ja SQLite-kahvojen sulkeminen, runtime-absence, yksityinen staging,
forward-migraatiot, täydellinen validointi, nykyisen activation journalin
kirjoitus, atominen aktivointi, saman workspacen uusi runtime-session,
health/identity/artifact-validointi, transactionin hyväksyntä ja cleanup.
Virheessä sama activation transaction palauttaa vanhan tietokannan ja PDF-
artifact-juuren ennen vanhan runtimen terveeksi todistamista.

Kirjoitusquiescen ajastinpysäytys ei sulje varmuuskopion tarkistusporttia:
preRestore tarvitsee sitä vielä ennen runtimen sulkua. Mainin lopullinen
capability-disposal sulkee portin synkronisesti ja odottaa omistetun työn
siivouksen ennen backendin sulkua. Tavallisen shutdownin välitön uuden työn
esto säilyy. [K:n sulkujärjestysregressio](release-0.3.0-m1-preparation-plan.md#v2ah-electron-testiruntimen-tarkistusajuritoimitus)
todentaa tämän eron kirjoitussuojaa tai maintenance-leasea keventämättä.

Korvaus käsittelee vain portable business snapshotia. SMTP-salaisuus,
safeStorage/DPAPI-envelope, ulkoisen PDF-arkiston root ja retry-journal,
update/cache-tila, operational-lokit, diagnostiikka sekä muiden workspacejen
palautuspisteet eivät kuulu stagingiin, aktivointiin tai rollbackiin.

**Testit:** same-lineage success, historical-prefixin forward-migraatio,
wrong-lineage deny ilman writeä, nimen tai Y-tunnuksen kelpaamattomuus
oikeutukseksi, inactive/recovery/duplicate-lineage-torjunnat, väärä salasana,
muuttunut container, vanhan datan poistuminen ilman mergeä, backupin datan ja
PDF:n palautuminen, device-local-tiedostojen jatkuvuus, keskeytys jokaisessa
activation journal -vaiheessa, byte-identtinen rollback sekä muiden
työtilojen ja lähdebackupin hashien muuttumattomuus. System-E2E käyttää oikeaa
salattua backup-containeria, SQLitea, migraatioita ja PDF-artifactia, mutta
inertin foundationin runtime-lifecycle-portti on synteettinen; oikea Electron-
prosessikytkentä todistetaan vasta W4:ssä.

**Dokumentit:** backup- ja recovery-runbook.

**Commit/PR/release:** yksi W3b-PR; ei user releasea.

## W4: Controlled workspace switch and legacy adoption

**Omistaja:** Electron mainin workspace coordinator.

**Muutettavat kerrokset:** desktop runtime composition, backend process
lifecycle, runtime-session, workspace-bound adapter composition, active
pointer journal ja 0.2.6 adoption.

**Muuttumattomat kerrokset:** domain, business API:n semantics, backup-format,
installer/update state ja cloud/mobile.

**Sopimus:** ADR-0011:n 12-vaiheinen switch sekä copy -> validate -> atomic
switch -adoptio nykyiselle 0.2.6-profiilille.

Main-owned build admission suoritetaan ennen workspace-ratkaisua ja ennen
adoption ensimmäistä filesystem-sivuvaikutusta. Initial install, exact
accepted build, valtuutettu newer build ja update-journalin täsmällinen target
ovat suljettuja hyväksymisluokkia. Same-version/different-revision, downgrade
ja mixed/unknown update identity pysähtyvät ennen adoption journalia,
candidatea, final-rootia tai registryä.

**Luottamusraja:** vain trusted main frame voi pyytää switchiä. Main hyväksyy
vain registryssä olevan workspaceId:n. Vanha session, backend, DB-kahvat ja
adapterit eivät saa selvitä vaihdosta.

**Fail-closed-tilat:** in-flight operation, unresolved update/restore,
shutdown failure, handle leak, candidate health/identity failure, pointer
failure, rollback failure ja `recoveryRequired`.

**Testit:** A -> B -> A, vanha session deny, concurrent switch deny,
write-in-flight, PDF window, secret namespace, archive config/journal,
backup/recovery scope, restart jokaisessa journal-vaiheessa, 0.2.6 adoption
kahdesti, same-version/different-revision ilman adoption sivuvaikutuksia,
julkaisemattoman keskeytyneen candidate/final-adoption täsmällinen cleanup ja
relaunch, enintään yksi business-SQLite-owner ja 0 orphan-processia.

W4 kytkee myös workspace-kohtaisen PDF-arkiston: käyttäjän valitsema juuri
säilyy device-local-asetuksena ja main kirjoittaa vain johdettuun
`<archiveRoot>/<workspaceId>/`-alikansioon. Samannimiset laskut eivät törmää
työtilojen välillä eikä asetusta tai ulkoisia kopioita siirretä backupissa.

**Dokumentit:** desktop implementation plan, update-planin per-workspace first
start ja operational runbook.

**Commit/PR/release:** W4 voidaan jakaa registry switch- ja legacy adoption
-PR:iin, jos kumpikin pysyy itsenäisesti suljettuna. Ei user releasea ennen
W5B-W6:ta.

**Toteutustila:** W4:n production-runtime on toteutettu. Electron main
ratkaisee aktiivisen workspacen ennen runtime-sessionia ja backendia, adoptoi
vanhan yhden profiilin datan copy -> validate -> atomic publish -ketjulla
enintään kerran ja sitoo business-SQLiten, lasku-PDF:t, snapshotit,
salaisuudet, PDF-arkiston asetuksen ja journalin sekä backup/recovery-tilan
aktiiviseen workspace-rootiin. Operational-lokit, tukipaketit, update state ja
packaged smoke säilyvät installation-scoped-tilana. PDF-arkistokopio johdetaan
aina `<archiveRoot>/<workspaceId>/`-alikansioon.

W4:n switch-koordinaattori ja recovery-sopimukset on todennettu
kohdetesteillä, mukaan lukien A -> B -> A, vanhojen runtime-omistajien
sulkeminen ja adoption idempotenssi. Käynnistys hyväksyy build-identiteetin
ennen workspace-sivuvaikutuksia. Keskeytyneen legacy-adoption recovery poistaa
vain journalista täsmällisesti johdetun, julkaisemattoman ja legacy-lähteen
kanssa byte-identtiseksi kahdesti todistetun candidate- tai final-kopion.
Turvaton, julkaistu, muuttunut tai tuntematon tila jää fail-closed-tilaan.
Rendererille ei ole lisätty workspace-
capabilitya eikä UI:ta; ne kuuluvat W5B:hen. W5A rakentaa niitä ennen vain
main-prosessin sisäisen hallinta- ja lifecycle-foundationin. Aktiivisen ja
passiivisen workspacen N -> N+1 -migraatio sekä koko packaged multi-workspace
-matriisi kuuluvat edelleen W6:een.

Jo aktiivisen työtilan valinta on idempotentti no-op, joka ei sulje runtimea
eikä käynnistä sovellusta uudelleen.

## W5A: Main-owned workspace management foundation

**Omistaja:** Electron main. Tämä vaihe ei avaa capabilitya rendererille.

**Muutettavat kerrokset:** mainin sisäinen management service, production-
lifecycle-adapteri, private candidate backend -adapterit, registry-labelin
rename sekä yhteinen installation-scoped maintenance lease.

**Muuttumattomat kerrokset:** preload, IPC, renderer, web, backendin julkinen
HTTP-API, schema, migraatiot, backup-formaatti, domain ja permission-malli.

**Sisäiset käyttötapaukset:** rajattu status, tyhjän workspacen luonti,
backup-import uutena, aktiivisen exact-lineage-workspacen korvaus, switch ja
labelin rename. Poisto ei kuulu W5A:han.

**Luottamusraja:** hallintapalvelu saa palauttaa vain validoidun status-
projektion sekä workspacen opaque tunnisteen, labelin, aktiivisuuden ja
saatavuuden. Polut, `companyId`, lineage, runtime-session, secret ref,
journalit, operationId, backup-sisältö ja raakavirheet eivät kuulu sopimukseen.

**Lifecycle:** create/import/replace/switch-koordinaattorit varaavat yhteisen
maintenance leasen itse. Backup, restore ja update käyttävät samaa main-owned
auktoriteettia omien moduulikohtaisten vartijoidensa lisäksi. Main ei avaa
SQLitea; private utility backend omistaa bootstrapin, migraatiot ja
validoinnin. Runtimeen sidotut resurssit suljetaan ja niiden poissaolo
todistetaan ennen omistajuuden vaihtoa.

**Testit:** status-parseri ja vuotokielto, create/import/replace/switch/rename,
ristiriidat kaikkien maintenance-tarkoitusten kanssa, exact-lineage,
registry/pointer-byte-identtisyys, runtime-sessionin kierto, yksi backend ja
SQLite-owner sekä nolla orphan-prosessia. Production-adapterien integraatio
käyttää vain synteettistä private userData -juurta.

**Commit/PR/release:** W5A on oma sisäinen feature-checkpoint. Sitä ei kuvata
käyttäjälle valmiina multi-workspace-toimintona eikä siitä nosteta versiota.

**Toteutustila:** valmis ja paikallisesti hyväksytty. Production-composition
käyttää yhtä main-owned maintenance lease- ja active workspace lifecycle
-instanssia. Status/create/import/replace/switch/rename on todennettu
kohdetesteillä sekä Electron composition proofilla, joka käyttää vain
synteettistä private userData -juurta ja private utility -candidateja. Proof
todentaa nykyisen desktop-version, lopullisen registry-tilan, täsmällisen yhden
relaunchin switchissä, enintään yhden mallinnetun backend- ja SQLite-ownerin
sekä sen, ettei proofin käynnistämiä utility-prosesseja jää eloon. Preloadia,
IPC:tä, renderer-capabilitya, web-UI:ta tai julkista backend-reittiä ei lisätty.
Täysi usean workspacen packaged isolation/update/recovery -todistus jää W6:een.

## W5B: Trusted workspace capability and UI

**Omistaja:** web feature paikallisen desktop-capabilityn päällä. Electron main
omistaa kaikki privileged toiminnot.

**Muutettavat kerrokset:** webin workspace-näkymä, i18n, preload-allowlist ja
rajattu trusted main frame -IPC. Backend business API ei saa
workspace-hallintareittejä.

### W5B.1: Selector, create, import, switch and rename

**Tila:** toteutettu ja paikallisesti hyväksytty 20.8.2026.

**Käyttäjäpolut:** listaa turvalliset labelit, luo tyhjä workspace, tuo
salattu backup uutena workspacena, vaihda työtila ja nimeä label uudelleen.
Valitsin sijaitsee sivupalkin vasemmassa yläkulmassa ja toimii myös sivupalkin
ollessa supistettu. Poisto- tai replace-toimintoa ei näytetä.

**Luottamusraja:** UI saa workspaceId:n vain capability-vastauksesta. Viisi
versionoitua capability-kutsua hyväksytään vain tunnetun pääikkunan main
framesta täsmällisellä argumentti- ja avainsopimuksella. UI ei
saa polkua, companyId:tä, lineagea, secret refiä tai journalia. Backupin
valinta ja salasana pysyvät Electron mainin omistamissa native-ikkunoissa.
Import-pyyntö saa tuoda rendereriltä vain validoidun workspace-labelin,
ei tiedostoa, polkua tai salasanaa.
Selainkehitys säilyttää turvallisen yhden workspacen fallbackin ilman
desktop-capabilitya.

**Fail-closed-tilat:** capability puuttuu webissä, invalid selection,
operation conflict, native confirmation cancel, switch/import failure ja
recoveryRequired. Viestit ovat turvallisia suomenkielisiä i18n-tekstejä.

**Testit:** preload/IPC-allowlist, trusted main frame, subframe/foreign frame
-torjunta, exact argumentit ja input-avaimet, web ilman capabilitya,
keyboard/focus, loading/error, double click, cancellation, duplicate label,
failed switch, UI reload ja vanhan workspace-datan katoaminen näkymästä.
Electron-E2E todistaa A -> B -> A -eristyksen asiakkailla, laskuilla ja
PDF-hasheilla sekä oikean salatun backupin tuonnin ja file/password-cancel-
polut ilman polun, salasanan, companyId:n, lineagen, sessionin tai journalin
vuotoa.

**Lifecycle:** switch ja onnistunut import johtavat main-owned relaunchiin.
Vanha renderer, runtime-session, backend ja SQLite-owner eivät jatka uuden
aktiivisen workspacen kanssa.

### W5B.2: Replace active workspace

**Tila:** toteutettu ja hyväksytty erillisenä W5B.2 UI/capability/Electron-E2E-
checkpointina. W5A:n sisäinen exact-lineage replace-palvelu, Electron mainin
capability-raja ja webin varoituspolku muodostavat yhden käyttötapauksen. W6:n
packaged pilot- ja release-portti on edelleen avoin.

W5B.2 sallii vain aktiivisen `ready`-työtilan korvaamisen saman lineagen
aiemmasta Eky-varmuuskopiosta. Yrityksen nimi, Y-tunnus, workspace-label tai
muu business-arvo eivät ole identiteettitodisteita. Renderer ei valitse
kohdetyötilaa eikä saa backup-polkuja, salasanaa, `companyId`:tä, lineagea,
runtime-sessionia, journalia tai raakavirhettä.

Multi-workspace-tuotteessa rendererille ei altisteta rinnakkaista yleistä
profile restore -capabilityä. Eri lineage kulkee aina import-as-new-polkuun ja
aktiivisen yrityksen korvaus vain tämän exact-lineage-sopimuksen kautta. Jos
vanhan version käynnistyksestä löytyy keskeneräinen yleinen profile restore
-journal, activation-transaction hyväksytään vasta aktiivisen registry-entryn
lineage-tarkistuksen jälkeen; ristiriita rollbackataan journalin ollessa vielä
auktoritatiivinen ja edellinen profiili käynnistetään uudelleen.

Käyttäjäpolku on kaksivaiheinen:

1. web-näkymä kertoo aktiivisen workspacen labelin, exact-lineage-vaatimuksen,
   preRestore-palautuspisteen ja hallitun uudelleenkäynnistyksen sekä pyytää
   käyttäjää jatkamaan tiedoston valintaan
2. Electron main valitsee `.ekybackup`-tiedoston, käyttää nykyistä
   salasanakontrolleria ja näyttää viimeisen native-varoituksen, jossa
   turvallinen oletus on aina peruuttaminen.

IPC-sopimus on versionoitu, nolla-argumenttinen ja hyväksytään vain tunnetun
pääikkunan main framesta. Electron main johtaa aktiivisen `workspaceId`:n
omasta turvallisesta statuksestaan ja kutsuu nykyistä
`replaceActiveFromBackup`-käyttötapausta. Tiedoston valinnan, salasanan tai
native-vahvistuksen peruminen ei saa muuttaa registryä, journalia tai runtimea.
Onnistunut korvaus ja onnistunut rollback päättyvät main-owned hallittuun
uudelleenkäynnistykseen; renderer ei yritä päivittää vanhaa runtimea.

UI näyttää toiminnon erillisenä ylläpito- ja varoitusalueena vain, kun desktop-
capability on käytettävissä, privileged-operaatio ei ole käynnissä ja
aktiivinen workspace on `ready`. Toiminto ei ole workspace-rivin action eikä
avaa passiivisen workspacen korvausta. Workspace-poisto ei kuulu W5B.2:een.

Testit kattavat trusted-main-frame-rajan, exact argumentit, suljetut DTO:t,
file/password/native-confirm-cancelit, väärän lineagen, activation- ja
rollback-faultit, hallitun relaunchin sekä polun, salasanan, lineagen,
companyId:n, sessionin ja journalin vuotamattomuuden.

W5B.2:n Electron-E2E-todiste käyttää yhtä auktoritatiivista synteettistä
lineagea legacy-adoptionissa, aktiivisessa registry-entryssä ja salatussa
backupissa. Se kattaa exact-lineage-korvauksen, väärän lineagen torjunnan sekä
native file-, password- ja final confirmation -peruutukset. Väärän lineagen
torjunta todistaa lisäksi, että korvausyrityksen jälkeen luotu aktiivisen
workspacen marker-data säilyy muuttumattomana.

**Commit/PR/release:** W5B on erillinen UI/capability-checkpoint. Ensimmäinen
release candidate voidaan nimetä vasta W6:n hyväksymisportin jälkeen.

## W6: E2E, packaged pilot and 0.2.6 -> 0.2.7 gate

**Omistaja:** E2E/test infrastructure sekä release process. Tuotantokoodia ei
korjata suoraan release-portin sisällä ilman paluuta omistavaan checkpointiin.

**Muuttuvat kerrokset:** testit, fixturet, CI-portit, release-dokumentaatio ja
erillinen lopullinen versionostocommit.

### W6A.1: Read-only migration inventory

W6A.1 on first-start-orchestraatiota edeltävä tarkastuscheckpoint.
Electron main lukee strictin registry v1:n, valitsee vain `ready`-entryt ja
johtaa niiden workspace-polut nykyisen main-owned path policyn kautta.
Yksityinen backend utility tarkastaa työtilat yksi kerrallaan aidosti read-only-
yhteydellä. Main ei avaa SQLitea, eikä samanaikaisia utility- tai SQLite-
ownereita sallita.

K:n erikseen hyväksytty paikallinen hot-journal-palautus tarkentaa
sivuvaikutuksettomuutta: strictistä `ready`-entrystä valitun, samana
säilyneen juuren ja elävän prosessivarauksen omistama SQLite saa palauttaa
oman keskeneräisen transaktionsa ennen schema-lukua. Vanha hallittu
kirjoittaja on poissa ja palautusvalta sidotaan nykyiseen childiin sekä
täsmälliseen profiilitiedostoon. Business-kyselyitä, identity-lukua tai
migraatioita ei tehdä ennen koko scheman/historyn todistusta. Terveen
tiedoston tarkastus on edelleen vain lukuun; registry ja artifactit eivät
muutu. Tuonti, snapshot tai palautuskohde ei saa tätä poikkeusta.
Yksityiskohtaisen sopimuksen omistaa
[database/migration](local-database-implementation-plan.md#omistetun-paikallisen-työtilan-kaatumispalautus);
[M1:n V2u](release-0.3.0-m1-preparation-plan.md#v2u-omistetun-paikallisen-työtilan-kaatumispalautus)
säilyttää päivätyn näytön.

Jokainen tarkastettu työtila luokitellaan vain tilaan `current`,
`compatiblePending` tai `invalidHistory` ADR-0011:n määritelmien mukaan.
Sisäinen inventaario saa sisältää vain `workspaceId`:n, aktiivisuustiedon,
luokituksen sekä applied/pending-lukumäärät. Polkuja, migration-nimiä tai
-tiivisteitä, `companyId`:tä, `profileId`:tä, lineagea, sessionia tai raakaa
SQLite-virhettä ei palauteta eikä lokiteta.

`invalidHistory` on luotetun rakenteen tietosisällön luokitus: kanoninen,
tavallinen ja yhden linkin tietokantatiedosto on voitu avata read-only-tilassa,
koko schema ja immutable-migraatiohistoria on todennettu, mutta integrity-
tai foreign key -tarkastus osoittaa sisällön vioittuneeksi. K:n hyväksytty
tarkennus 10.10.2026 vaatii rakenteen ja historian todistuksen ennen identity-
tai business-lukua. Schema- tai historiavirhe ei tuota `invalidHistory`-entryä,
vaan keskeyttää koko inventaarion ennen registry-siirtymiä. Historiallista
prefixiä tai yritysidentiteettiä ei arvata, eikä metadataless-backupin
tuontitukea käytetä julkaistun työtilan poikkeuksena. Puuttuva tai turvaton
workspace-juuri, puuttuva tai ei-kanoninen tietokanta, avaamaton storage,
väärä `profileId` taikka utility-, protokolla- tai shutdown-virhe keskeyttää
inventaarion samoin fail-closed.

Inventaario ja sitä edeltävät tavalliset registry-luvut tarkastavat
current/backup/next-slotit nykyisessä auktoriteettijärjestyksessä ilman
palautusslotin julkaisemista tai muiden slottien poistamista. Epäkelpo
ensisijainen slot ei salli fallbackia. Journalin omistama aiemmin hyväksytty
palautus pysyy erillisenä; se ei anna tavalliselle tarkastusluvulle
korjausoikeutta. Ensimmäinen turvallinen schema-/historiasyy säilytetään
nykyisessä suljetussa utility-tulossopimuksessa ja sisäisessä syyketjussa.
Raakavirheitä, SQL:ää, polkuja tai yritystunnisteita ei julkaista.

Checkpoint ei kirjoita registryä tai business-sisältöä, käynnistä workspace-
runtimea, aja migraatioita, luo recovery pointia, muuta aktiivista osoitinta
tai accepted build -metadataa eikä vielä kytkeydy production-startupiin.
`invalidHistory`-entryn mahdollinen `recoveryRequired`-siirtymä ja aktiivisen
`compatiblePending`-työtilan migraatio kuuluvat W6A.2:een.

### W6A.2A: First-start migration plan ja registry-siirtymäperusta

W6A.2A pysyy production-startupista irrallisena checkpointina. Se ottaa vain
strictisti validoidun registry v1:n, W6A.1:n valmiin migration inventoryn,
pre-workspace build admissionin sekä source- ja target-build-identiteetit.
Tuloksena on jäädytetty sisäinen suunnitelma, joka sisältää vain:

- `notRequired`- tai `required`-luokituksen
- aktiivisen `workspaceId`:n, migration-statuksen ja applied/pending-määrät
- kanonisesti järjestetyt passiivisten `invalidHistory`-työtilojen ID:t.

Suunnitelma ei sisällä polkua, labelia, lineagea, `profileId`:tä,
`companyId`:tä, migration-nimiä tai -tiivisteitä. Registryssä olevan jokaisen
`ready`-työtilan pitää esiintyä inventaariossa täsmälleen kerran eikä muita
entryjä sallita. Aktiivisen osoittimen pitää viitata `ready`-entryyn ja samaan
inventaarioentryyn. `recoveryRequired`-entryjä ei inventoida eikä suunnitella
uudelleen.

Suunnitelmaa tarvitaan vain `authorizedNewerBuild`- ja
`coordinatedUpdateTarget`-admissioneissa. Aktiivinen `current` on sallittu
ilman migration-oikeutta. Aktiivinen `compatiblePending` on sallittu vain
näissä update-admissioneissa, mutta W6A.2A ei vielä aja migraatiota.
Aktiivinen `invalidHistory` estää koko suunnitelman. Passiivinen
`compatiblePending` säilyy `ready`-tilassa ja byte-identtisenä; vain
passiivinen `invalidHistory` suunnitellaan `recoveryRequired`-tilaan.

Registry-siirtymä käyttää installation-scoped journalia tiloissa `prepared`
ja `registryTransitioned`. Journal kirjoitetaan crash-safe byte-slot -rajalla
ennen registryä. Registry-mutaatio saa muuttaa vain täsmälleen suunniteltujen
passiivisten entryjen `lifecycleState`-kentän. Aktiivinen osoitin, ID:t,
labelit, lineaget, layoutit ja `createdAt` säilyvät. Lähde- ja
kohderekisterit sidotaan canonical-serialisoinnin SHA-256-tiivisteisiin.

Recovery toimii vain todistetuissa tilanteissa:

1. `prepared` + lähderekisteri voidaan jättää jatkettavaksi tai perua
   nimetyllä toiminnolla ilman registry-kirjoitusta
2. `registryTransitioned` + hyväksytty source build palauttaa täsmällisen
   lähderekisterin ja poistaa journalin
3. `registryTransitioned` + hyväksytty target build hyväksyy vain täsmällisen
   transitioned-rekisterin ja poistaa journalin
4. muu hash-, build-, entry- tai lifecycle-ristiriita päättyy
   `recoveryRequired`-tulokseen ilman arvausta tai journalin poistoa.

W6A.2A ei kutsu migration runneria, recovery pointia, backend-starttia,
accepted build -kirjoitusta, update-journalia, renderer-capabilitya tai
relaunchia. Production first-start -kytkentä, aktiivisen workspacen
preMigration/migration/readiness sekä buildin hyväksyntä kuuluvat erilliseen
W6A.2B-checkpointiin.

### W6A.2B: Production first-start -kytkentä

W6A.2B kytkee W6A.2A:n suunnitelman production first-startiin. Electron mainin
omistama orchestraattori koordinoi vain workspace-inventaarion, suunnitelman ja
registry-journalin. Nykyinen `FirstStartUpdateCoordinator` säilyy aktiivisen
työtilan migraation, update/direct Setup -tilan ja accepted build -metadatan
ainoana auktoriteettina. Workspace-moduuli ei kirjoita update-journalia,
direct Setup recoverya tai accepted build -metadataa eikä aja SQL-migraatioita.

**Toteutustila 22.8.2026:** production first-start -kytkentä on toteutettu
unit-, integration- ja Electron-E2E-tasolla. `DESK-WORKSPACE-FIRST-START-001`
todistaa sekä mixed-skenaarion että all-current-skenaarion synteettisillä
yksityisillä testiprofiileilla. Mixed-skenaariossa aktiivinen
`compatiblePending` migroidaan ja hyväksytään, passiivinen
`compatiblePending` säilyy byte-identtisenä `ready`-tilassa ja passiivinen
`invalidHistory` siirtyy vain registryssä `recoveryRequired`-tilaan.
All-current-skenaario ei luo W6-journalia, ja täsmälleen hyväksytyn buildin
toinen käynnistys ohittaa inventaarion.

PreMigration-palautuspiste saa validoida katkeamattoman ja muuttumattoman
historiallisen migration-prefixin tarkoituskohtaisella
`compatibleHistoricalPrefix`-politiikalla. Kaikki normaalit, manuaaliset,
preUpdate-, preRestore-, automatic- ja portable backup -snapshotit vaativat
edelleen täsmälleen nykyisen migration manifestin. Erillinen C:n
rollback-only-tarkistussnapshot ja sen beforeMigrations-policy ovat
[installer/update-omistajan kapea poikkeus](windows-installer-and-update-plan.md#historiallisen-038-palautuksen-kapea-c-poikkeus),
eivät uuden backup-tarkoituksen lupa. Tämä ei löysennä future-,
missing-middle- tai changed-history-torjuntaa.

Production-järjestys on:

1. pre-workspace build admission
2. keskeneräisen W6 first-start -journalin recovery
3. adoption- ja switch-recovery sekä aktiivisen työtilan ratkaisu
4. vain update-admissionissa kaikkien `ready`-työtilojen sarjallinen read-only-
   inventaario
5. deterministinen migration plan
6. tarvittaessa `prepared` W6 -journal ennen business-backendia
7. aktiivisen business-backendin käynnistys
8. nykyisen `FirstStartUpdateCoordinator`-migration-auktoriteetin tarkistus
9. vain aktiivisen `compatiblePending`-työtilan migraatio
10. aktiivisen backendin health-, identity- ja artifact-validointi
11. aktiivisen workspace-startupin hyväksyntä
12. suunniteltujen passiivisten `invalidHistory`-entryjen registry-siirtymä
13. transitioned registry -hashin todistus
14. target buildin hyväksyntä update-auktoriteetilla
15. accepted build -metadatan target-todistus ja W6-journalin täsmällinen
    target-hyväksyntä sekä poisto
16. vasta tämän jälkeen UI-ikkunan avaaminen.

`development`, `initialInstall` ja `exactAcceptedBuild` eivät aja W6-
inventaarioa. `authorizedNewerBuild` ja `coordinatedUpdateTarget` ajavat sen
normaalissa forward-startupissa. Vain nimenomaisesti valittu C:n
rollback-only-haara lykkää uutta inventaariota säilyttäen olemassa olevan
W6-recoveryn, source/target-buildit, active-valinnan ja registry-hashit.
Se ei anna forward-, registry-, target-hyväksyntä- tai UI-valtuutta.
All-current-update ei luo W6-journalia. Aktiivinen
`compatiblePending` vaatii journalin myös silloin, kun passiivisia
`invalidHistory`-entryjä ei ole ja source- sekä transitioned-registry-hash ovat
samat. Passiivinen `compatiblePending` pysyy `ready`-tilassa ja byte-
identtisenä; sen migraatio kuuluu ensimmäiseen myöhempään hallittuun
aktivointiin. Aktiivinen `invalidHistory` sekä structural-, identity-,
utility- tai protocol-virhe pysäyttävät first-startin ennen backendia.

Recovery ajetaan ennen uutta inventaariota. `noJournal` jatkaa normaalisti ja
`recoveredSource` jatkaa todistetulla source-registryllä. `acceptedTarget`
hyväksytään vain target-buildissa. `resumable` sallitaan vain target-buildin,
accepted source buildin, update-admissionin ja source-registry-hashin täsmätessä.
Exact accepted source build saa perua `prepared`-journalin vain täsmällisen
source-registry-todisteen jälkeen. Muut yhdistelmät ovat
`recoveryRequired`, jolloin inventaarioa, backendia tai registry-kirjoitusta
ei tehdä.

Jos inventaario tai suunnitelma epäonnistuu ennen
`FirstStartUpdateCoordinator.beforeMigrations()`-kutsua, vain update-moduulin
kapea pre-backend failure -raja saa siirtää koordinoidun update-journalin
`rollbackRequired`-tilaan. Direct Setupissa accepted source säilyy, targetia
ei hyväksytä eikä olemassa olevaa recovery-tilaa saa heikentää. Epäselvä
durable tila pysäyttää käynnistyksen fail closed.

### W6A.3: Passiivisen työtilan migraatio aktivoinnissa

Passiivinen `compatiblePending`-työtila migroidaan vasta käyttäjän hallitusti
käynnistämässä aktivoinnissa. Kohteen business-backendia tai käyttöliittymää
ei avata ennen kuin migraatio ja readiness-todisteet on hyväksytty. Lähteenä
oleva aktiivinen työtila pysyy koko operaation ajan muuttumattomana.

Migraatio on copy-on-write-operaatio. Electron main johtaa vain validoidut
workspace-polut eikä avaa SQLitea. Mainin käynnistämä rajattu backend-utility
tarkastaa kohteen migration historyn read-only, minkä jälkeen nykyinen
workspace-scoped preMigration-palautuspiste suojaa kohteen julkaistun
business-sisällön. Migraatiot ajetaan palautuspisteestä muodostettuun
yksityiseen candidate-juureen. Candidate todistetaan migration chainin,
workspace-identiteetin ja authoritative artifact/PDF -sulkeuman osalta ennen
atomista aktivointia. Julkaistua kohdetietokantaa ei migroida paikallaan.

Palautuspisteen materialisoidun lähdestagingin omistajuus säilyy
`ProfileSnapshotInspectionClient`illä tarkistuksen jälkeen. Aktivointimigraation
staging-adapteri pyytää poiston saman omistajan `removeProfileSnapshot`-portilta;
se ei poista kansiota suoraan. Omistaja varmentaa tarkistusprosessin päättymisen
ja varauksen palautumisen sekä vapauttaa oman seurantansa ennen seuraavaa
sammutusta. Puuttuva kansio ei yksin todista seurannassa olevan operaation
onnistunutta siivousta. Menetetty omistajuus estää poiston ja säilyttää
palautusaineiston; erillistä korjaavaa poistopolkua ei käytetä.

W6A.3 ei lisää erillistä activation-migration-journalia. Jo hyväksytyt,
toisiaan täydentävät durable vastuut ovat:

- workspace switch -journal todistaa source/target-valinnan ja palauttaa
  aktiivisen osoittimen lähteeseen ennen hyväksyntää tapahtuvassa virheessä
- workspace-scoped preMigration-palautuspiste suojaa kohteen business-datan
- profile restore activation -journal omistaa candidate-swapin sekä vanhan
  kohteen byte-identtisen rollback-slotin
- update-journal, Direct Setup recovery, W6 first-start -journal ja accepted
  build -metadata eivät kuulu aktivointimigraation kirjoitusvastuuseen.

Target validation -esitarkastus ratkaisee polun ennen target-backendia:

- `current` jatkaa normaaliin startupiin ilman snapshotia, candidatea tai
  activation-journalia
- `compatiblePending` käynnistää tässä kuvattavan aktivointimigraation
- `invalidHistory` ei käynnistä target-backendia eikä tee targetiin business-
  kirjoituksia; switch recovery palauttaa lähteen aktiiviseksi ja registryn
  target-entry siirtyy täsmälliseen `recoveryRequired`-tilaan
- storage-, identity-, path-, protocol- tai utility-virhe pysäyttää operaation
  fail closed eikä sitä saa luokitella migration history -virheeksi.

Onnistuvan `compatiblePending`-polun järjestys on:

1. kohteen read-only migration inventory
2. switch-journalin ja maintenance leasen uudelleentodistus
3. kohteen workspace-scoped preMigration-palautuspiste
4. yksityisen candidate-profiilin muodostus palautuspisteestä
5. SQL-migraatiot vain candidateen
6. candidate-identiteetin ja artifact/PDF-sulkeuman validointi
7. candidate-profiilin atominen aktivointi rollback-slotin taakse
8. targetin normaali backend-start, health-, identity- ja artifact-readiness
9. switch-operaation hyväksyntä ja aktiivisen osoittimen terminal-todistus
10. activation-transactionin hyväksyntä ja journalien hallittu siivous
11. targetin business-UI:n avaaminen.

Virhe ennen candidate-swapia jättää kohteen julkaistut tavut ennalleen ja
palauttaa lähteen aktiiviseksi. Virhe swapin jälkeen palauttaa ensin kohteen
profile restore activation -transactionilla byte-identtisesti ja vasta sen
jälkeen lähteen switch recoverylla. Jos jommankumman palautuksen terminal-tila
ei ole yksiselitteisesti todistettavissa, käynnistys päättyy
`recoveryRequired`-tilaan ilman automaattista arvausta. Onnistuneen
aktivoinnin jälkeen kohteen seuraava startup on täsmällinen `current`-polku
ilman uutta migraatiota, snapshotia, candidatea tai journalia.

**Pakollinen näyttö:**

- `DESK-WORKSPACE-MIGRATION-INVENTORY-001` käyttää oikeaa paketoitua backend-
  runneria ja kolmea synteettistä työtilaa tiloissa `current`,
  `compatiblePending` ja `invalidHistory`
- registry, aktiivinen osoitin, tietokannan SHA-256/koko/mtime ja PDF-
  artifact-juuret säilyvät muuttumattomina eikä SQLite-sidecareja synny
- utility-tarkastukset ovat sarjallisia, normaali backend on suljettu ennen
  inventaariota ja testin jälkeen uusia utility-prosesseja on nolla
- `DESK-WORKSPACE-FIRST-START-001` käyttää oikeaa Electron main -compositionia,
  W6A.2A-journalia, `FirstStartUpdateCoordinator`-auktoriteettia ja oikeaa
  backend migration runneria
- todistuksessa aktiivinen historiallinen prefix migroidaan, passiivinen
  yhteensopiva prefix ja sen artifact-juuri säilyvät muuttumattomina,
  passiivinen invalidi historia rajataan registry-muutokseen ja target-build
  hyväksytään vasta koko ketjun jälkeen
- todistus sulkee backendin ja Electronin hallitusti, poistaa yksityisen
  testirootin ja jättää uusia backend- tai utility-prosesseja nolla
- `DESK-WORKSPACE-ACTIVATION-001` käyttää oikeaa Electron main -compositionia
  ja neljää synteettistä työtilaa: nykyistä sourcea, historiallista targetia,
  invalidia targetia ja fault-targetia
- aktivointitodiste migroi yhteensopivan targetin vasta ensimmäisessä
  hallitussa aktivoinnissa, todistaa seuraavan käynnistyksen idempotentiksi ja
  säilyttää business-rivit sekä authoritative PDF:n hashin
- invalidi target torjutaan ennen backendia ja siirtyy recovery-tilaan;
  pakotettu candidate-virhe palauttaa registryn ja kohteen byte-identtisesti,
  minkä jälkeen journalit, backend-kahvat ja utility-prosessit on vapautettu

- puhdas 0.2.6-asennus ja first/second startup
- synteettinen 0.2.6-profiili sekä erikseen turvallisesti johdettu paikallinen
  testiprofiili
- 0.2.6 -> 0.2.7 MSI major upgrade
- legacy-profiilin copy/validate/adopt
- vähintään kahden työtilan create/import/switch/isolation
- backup import as new ja same-lineage replace
- secret-, archive-, recovery- ja portable backup -scope
- first/second startup, graceful shutdown ja 0 orphan-processia
- failure/restart jokaisessa registry-, adoption-, switch- ja restore-
  journalin vaiheessa
- rollback palauttaa version ja kaikkien työtilojen täsmällisen tilan.
- N+1 first start tarkastaa kaikki migration historyt read-only, migroi vain
  aktiivisen työtilan ja jättää passiivisen migraation ensimmäiseen
  aktivointiin workspace-scoped preMigration-pisteen taakse
- virheellinen passiivinen historia siirtyy turvallisesti
  `recoveryRequired`-tilaan ilman muiden työtilojen kirjoituksia
- PDF-arkisto käyttää workspace-kohtaista alikansiota, samat tiedostonimet
  eivät törmää eikä archive-root siirry backupissa.

**Toteutustila 22.8.2026:** W6A.3:n aktivointimigraatio sekä sen success-,
invalid-history-, restart- ja fault-palautumistodiste on toteutettu unit-,
integration- ja Electron-E2E-tasolla testillä
`DESK-WORKSPACE-ACTIVATION-001`. Koko paketoitu multi-workspace W6
-releaseportti on edelleen avoin; yksittäinen W6A.3-todiste ei yksin täytä
sen MSI-, backup/restore-, isolation- ja kokonaisrollback-vaatimuksia.

### W6B: Full packaged multi-workspace acceptance

W6B sulkee W6:n paketoidun release-portin kahdella toisistaan erotetulla
lähtömallilla. W6B ei nosta sovellusversiota eikä tuota käyttäjälle jaettavaa
MSI:tä. Kaikki profiilit, salaisuudet, PDF:t, asennukset ja faultit ovat
ajokohtaisia synteettisiä fixtureitä.

Ensimmäinen lähtömalli todistaa käyttäjän todellisen siirtymän hyväksytystä
legacy-versiosta multi-workspace-versioon:

1. lähteenä käytetään täsmällistä hyväksyttyä 0.2.6 MSI-artifactia tai CI:ssä
   samasta hyväksytystä source-commitista deterministisesti rakennettua
   source-fixtureä
2. source-identiteetistä todistetaan app-versio, build-revisio, clean build,
   ProductCode, UpgradeCode ja SHA-256
3. tavallinen Windows Installer major upgrade asentaa numeerisesti eri
   synteettisen N+1-targetin
4. first start adoptoi yhden legacy-profiilin täsmälleen yhdeksi `ready`-
   työtilaksi ja asettaa aktiivisen osoittimen siihen
5. toinen startup todistaa hyväksytyn target-buildin ja adoption
   idempotenssin.

Satunnaista nykyisestä HEADista 0.2.6-versionumerolla rakennettua pakettia ei
hyväksytä legacy-lähteeksi. Jos hyväksyttyä artifactia tai sen tarkkaa
source-commitia ei voida todistaa, W6B pysähtyy ennen MSI-ajoa.

Seuraava sisäkkäisten watchdogien kuvaus on legacy-harnessin historiaa.
Nykyinen prosessiomistajuus, aikarajat, cleanup ja ajokomennot luetaan
[hyväksyntäharnessin v2-sopimuksesta](windows-installer-acceptance-harness-v2.md);
vanhaa rakennetta ei palauteta tämän kuvauksen perusteella.

Legacy-hyväksynnän koko Node-komentoa ympäröi ensin 25 minuuttiin rajattu
omistettu worker-prosessi. Raja kattaa target- ja historical-source-buildit,
fixture-tarkistukset sekä varsinaisen acceptance-ajon. Workerin sisällä
PowerShell-hostia ympäröi erillinen 18 minuutin rajattu prosessielinkaari.
Molemmat antavat vain suljetut host-, wait-, heartbeat-, timeout- ja cleanup-
tapahtumat ja varaavat tämän jälkeen 30 sekuntia täsmälliseen prosessipuun
siivoukseen. Siivous hyväksyy vain oikean workerin tai legacy-skriptin, saman
64-hex-todistetunnisteen ja saman process creation -identiteetin. Se ei tapa
prosesseja nimellä eikä muuta PowerShell-skenaarion sisäistä viiden minuutin
MSI-aikarajaa. Näin ulompi GitHub-jobi ei jää yksin terminalisoimaan buildiin
tai legacy-hyväksyntään jumiutunutta komentoa.

Legacy-target on yksityinen, täsmälleen versioon `0.2.7` sidottu synteettinen
fixture. Canonical release-konfiguraatio validoidaan sille vain read-only-
malliksi, joten sama 0.2.6 -> 0.2.7 -portti toimii sekä ennen versionostoa että
versionostocommitissa ilman tracked version -tiedostojen väliaikaista
muokkaamista. Fixtureä ei jaeta release-artifactina eikä sen identiteettiä
siirretä canonical-version seuraavaan patchiin.

Toinen lähtömalli todistaa tulevan multi-workspace-version sisäisen
päivityksen. Synteettinen N ja N+1 käyttävät eri numeerisia fixture-versioita
sekä yksityiseen, Gitistä ohitettuun stagingiin kirjoitettuja manifesteja.
Canonical `package.json`- ja `installer-release.json`-tiedostoja ei muuteta.
Nykyinen update-, handoff-, first-start-, migration-, recovery- ja rollback-
polku säilyy testin production-polkuina; rinnakkaista testimoottoria ei luoda.

Onnistumismatriisi sisältää kolme työtilaa:

| Työtila | Lähtötila N+1:een nähden | Paketoidun todistuksen odotus |
| --- | --- | --- |
| A | aktiivinen `compatiblePending` | Migroidaan first startissa ennen target-buildin hyväksyntää |
| B | passiivinen `compatiblePending` | Säilyy first startissa byte-identtisenä ja migroidaan vasta ensimmäisessä aktivoinnissa |
| C | passiivinen `invalidHistory` | DB- ja PDF-juuret eivät muutu; registry-entry siirtyy `recoveryRequired`-tilaan |

Todistus vaihtaa B:hen, käynnistää B:n uudelleen idempotenssin osoittamiseksi,
vaihtaa takaisin A:han ja torjuu C:n aktivoinnin. Jokaisella työtilalla on
erilliset business-rivit, authoritative PDF, secret-namespace, archive-
konfiguraatio ja -journal sekä recovery point -juuri. Installation-scoped
update-tila säilyy yhtenä eikä saa sekoittua workspace-scoped-tilaan.

**Nykyinen hyväksyntäreitti:** seuraavien historiallisten W6B.2A/W6B.2B-
checkpointien ajajat on korvattu `installer:v2-workspace-success`- ja
`installer:v2-workspace-fault`-komennoilla. A/B/C- ja fault-invariantit
säilyvät, mutta paketit rakennetaan nykyisessä V2-producerissa kerran ja
consumerit käyttävät samoja varmennettuja tavuja. Vanhoja komentoja tai
niiden budjetteja ei käytetä uutena hyväksyntäohjeena. Ajantasainen komento-,
tulos- ja siirtosopimus on `windows-installer-acceptance-harness-v2.md`:ssä;
lopullinen main-käyttöönotto ja julkaisuhyväksyntä ovat vielä erilliset portit.

**Historiallinen W6B.2A success-checkpoint 25.8.2026:** paketoitu N -> N+1-
onnistumismatriisi on toteutettu pysyvällä
`pnpm --filter @eky/desktop installer:w6b2-success` -komennolla. Komento
rakentaa yhden yksityisen 0.2.7 -> 0.2.8 -fixtureparin ja ajaa saman parin
kahdesti. Todistus kattaa aktiivisen A:n first-start-migraation, passiivisen
B:n muuttumattomuuden ennen ensimmäistä aktivointia, B:n hallitun
aktivointimigraation ja idempotentin uudelleenkäynnistyksen, paluun A:han sekä
C:n `invalidHistory`-torjunnan `recoveryRequired`-tilaan. Jokainen ajo käyttää
ajokohtaista synteettistä profiilia, rajattuja vaihekohtaisia timeoutteja,
turvallista JSONL-observabilitya, omistettujen prosessien cleanupia ja nollan
orpoprosessin loppuehtoa. Canonical-versiot ja release-kanava eivät muutu.
CI ajaa kaksi toistoa erillisinä Windows-matriisiajoina. Yksi ajo rakentaa ja
tarkistaa oman muuttumattoman fixtureparinsa, käyttää vain valittua suljettua
`--run=1|2`-toistoa ja noudattaa 25 minuutin elinkaaribudjettia. Paikallinen ja
manuaalinen release-portti rakentaa yhden fixtureparin ja ajaa samat tavut
edelleen kahdesti; sen mitattu kokonaisbudjetti on 38 minuuttia. Uusi ajo
käynnistyy vain, jos sille on jäljellä nykyinen täysi 12 minuutin
skenaarioraja sekä vähintään 90 sekuntia fixture-cleanupiin. Budjetit perustuvat
GitHubin mitattuun noin yhdeksän minuutin hitaaseen fixtureparin buildiin.
Budjetin loppuminen tuottaa suljetun, allowlistatun terminal-tuloksen ennen
GitHub-jobin ulkoista aikarajaa; yksittäisen skenaarion aikarajaa ei tämän
vuoksi kasvateta.

Yksityinen 0.2.7 -> 0.2.8 -fixturepari on muuttumaton testisopimus eikä sitä
johdeta kanonisen desktop-version seuraavasta patchista. Kanoninen release-
konfiguraatio validoidaan edelleen read-only-syötteenä, mutta myöhempi
versionosto ei siirrä tämän jo hyväksytyn todistuksen source- tai target-
identiteettiä.

Tämä checkpoint ei sulje koko W6-porttia. W6B.2B:n fault- ja rollback-
matriisi, installer repair/uninstall -jatkuvuus sekä lopullinen release-portti
ovat edelleen avoimia. W6B.2A ajetaan CI:ssä omana rajattuna Windows-jobina,
ei tavallisen MSI-release-gaten tai installer-unit-testien sisällä.

Paketoitu fault-matriisi on rajattu viiteen korkean riskin tapaukseen:

1. preUpdate-palautuspisteen virhe pysäyttää ennen runtime-sulkua ja handoffia
2. aktiivisen A:n migration- tai health-virhe palauttaa A:n business-datan,
   registryn, aktiivisen osoittimen ja source-binaariversion; B ja C säilyvät
   byte-identtisinä
3. kaatuminen registry-siirtymän ja target-buildin hyväksynnän välissä
   ratkaistaan W6 first-start -journalista ilman mixed registry/build -tilaa
4. B:n aktivointimigraation virhe palauttaa B:n byte-identtisesti sekä A:n
   aktiiviseksi ilman binary rollbackia
5. binary rollbackin virhe päättyy `recoveryRequired`-tilaan ilman
   automaattista retry-loopia tai väärän version käynnistystä.

**W6B.2B fault/rollback -checkpoint 27.8.2026:** matriisi on toteutettu
pysyvällä `pnpm --filter @eky/desktop installer:w6b2-fault-rollback`
-komennolla. Yksi rakennettu 0.2.7 -> 0.2.8 -fixturepari käytetään viiden
skenaarion kahdessa peräkkäisessä ajossa, yhteensä kymmenessä ajossa.
Todistus varmistaa skenaariokohtaisen source- tai rollback-lopputilan,
työtilojen ja installation-scopen eristyksen, suljetun recoveryRequired-
tilan siellä missä automaattinen palautuminen ei ole turvallista sekä nollan
omistetun orpoprosessin loppuehdon. Paikallinen koko matriisi,
W6B.2A-success-regressio ja legacy 0.2.6 -> 0.2.7 -hyväksyntä ovat vihreitä.
Matriisi ajetaan lisäksi omana Windows CI -jobinaan ennen mergeä.
CI jakaa viisi allowlistattua fault-skenaariota ja kaksi toistoa kymmeneksi
Windows-matriisiajoiksi. Jokainen matriisiajo rakentaa ja tarkistaa oman
muuttumattoman fixtureparinsa sekä ajaa yhden sallitun skenaario/toisto-
yhdistelmän. Enintään viisi paketointia ajetaan rinnakkain. Vakaa
aggregaattori hyväksyy portin vasta kaikkien kymmenen jobin onnistuttua.
Argumentiton paikallinen ja manuaalinen release-komento säilyttää yhden
fixtureparin koko 5 x 2 -matriisille. CI:n yhden ajon 25 minuutin sisäinen
komentobudjetti jättää 30 minuutin jobirajan sisään rajatun cleanup- ja
terminal-evidence-varan.

Lisäksi install, reinstall/repair, uninstall ja reinstall todistetaan samalla
synteettisellä multi-workspace-profiililla. Uninstall saa poistaa vain
installation-owned binaarit, shortcutit, install-rootin ja Windows Installer
-rekisteröinnit. Workspace-registry, tietokannat, PDF:t, backupit, recovery
pointit ja secret-namespace säilyvät.

Kaikissa skenaarioissa inventoidaan ennen ja jälkeen SQLite, authoritative
PDF:t, workspace-registry ja sallitut workspace-scoped-juuret. Vanhat runtime-
sessionit torjutaan, uusia Electron-, backend-, utility- tai installer-
orpoprosesseja jää nolla eikä polkuja, salaisuuksia, raakaa MSI-tulostetta tai
business-dataa julkaista testiraporttiin.

W6B pysähtyy, jos fixture vaatisi tracked version -tiedostojen väliaikaista
muokkaamista, saman version käyttöä eri revisioille, uutta rinnakkaista
installer/update-moottoria, inventory-rajan nostoa, oikeaa käyttäjädataa tai
dependency-, schema-, migration SQL- tai backup-formaattimuutosta.

In-app update testataan erikseen vain, jos `localUnsignedPilot`-polku on
kyseisessä checkpointissa hyväksytty. MSI-gate ei piilota in-app update -puutetta.

**Release-raja:** nykyinen omistajan tavoite on korjattu `0.2.8`-pilotti.
W1-W5B:n käytettävä kokonaisuus, W6-invarianttien korvaava V2-kattavuus ja
katselmoitu harnessin käyttöönotto pitää hyväksyä ennen erillistä
julkaisuvaihetta. Pelkästä registry- tai sisäisestä checkpointista ei nosteta
versiota. Historiallisten ja synteettisten fixturejen versiot säilyvät;
tämä tiekarttatavoite ei muuta niitä tai canonical-version tiedostoja.

**Commit/PR/release:** testihardening omana PR:nään; versionosto viimeisenä
erillisenä commitina vihreästä lähdepuusta.

## W7: Workspace deletion

**Nykytila 6.11.2026:** W7.1-W7.4 on hyväksytty omine PR/main-portteineen.
W7.4:n sisäisen lopullisen poiston ja keskeytysjatkon loppuhyväksyntä on
[PR #327:ssä](https://github.com/eky-software/eky/pull/327#issuecomment-6678341652);
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa täsmällisen hyväksytyn lähteen ja seuraavan W7.5-suunnittelun.
Poiston IPC, preload, painike ja backenditon tukivienti pysyvät suljettuina.
W7.5:n aktiivinen [toteutussuunnitelma](#w75-toteutussuunnitelma) on alla.
Alla olevat aiemmat päivätyt tilat ovat historiaa, eivät nykyinen työjono;
hyväksytyt turvasopimukset ja avoimet ensihavainnot säilyvät.

### W7.5 toteutussuunnitelma

**6.11.2026: suunnitelma ja toteutus A-E-paloina hyväksytty;
A:n tulosparserit, main-only-pyyntöelinikä, paluu- ja virhesovitus ovat työpuussa.
Julkiset kanavat pysyvät suljettuina.**
[M1](release-0.3.0-m1-preparation-plan.md#jatka-tästä) omistaa hyväksytyn
lähtörevision ja etenemistilan. Tämä osio omistaa W7.5:n puuttuvan
käyttäjäpolun; W7.0/W7.3/W7.4:n hyväksytyt turvallisuus- ja
käyttäytymissopimukset säilyvät. Vanhoja tutkimuskierroksia ei nosteta
aktiiviseksi työjonoksi. Jokaisen palan tulos päivitetään tähän ja M1:een,
eikä suunnittelun tarkistusta merkitä toteutuksen testinäytöksi.

#### Tavoite ja säilyvät rajat

Avataan nykyinen lopullinen poisto hallitusti nykyiseen yrityshallintaan,
näytetään sen todellinen lopputulos ja mahdollistetaan rajattu tekninen
tukivienti ilman avointa yritystä. Uutta poistomoottoria, palautusketjua,
lokilukijaa, yleistä tilapalvelua, testialustaa tai riippuvuutta ei lisätä.
Tietokanta, backup-formaatit, nimet, vahvistukset, poiston inventaario,
journalit, hyväksytyt tarkistusvastuut ja nykyiset aikarajat säilyvät.

Jo hyväksytyt käyttäytymisvalinnat eivät ole uusia kysymyksiä:

- Aktiivinen, passiivinen, viimeinen ja todistetusti omistettu vikatilainen
  yritys voidaan poistaa. Vikatila ei yksin anna poistolupaa eikä sitä
  varten avata yrityksen tietokantaa.
- Kirjoitettu kohdenimi ja mainin viimeinen native-vahvistus vaaditaan.
  Ilman tarkistettua kopiota vaaditaan lisäksi nimenomainen menetyshyväksyntä.
  Käyttöliittymän valinta ei korvaa mitään mainin tarkistusta.
- Yrityksen omat tiedot, salaisuus-slotit ja todistetut palautusjäännökset
  poistuvat nykyisen ketjun mukaan. Muiden yritysten aineisto, käyttäjän
  ulkoiset PDF-kopiot/backupit ja asennustason tekniset lokit säilyvät.
- Aktiivisen tai viimeisen yrityksen poiston jälkeen päädytään valitsimeen
  ilman automaattista yrityksen luontia tai toisen yrityksen avausta.
  Passiivisen poiston paluu koskee vain aiempaa yritystä nykyisin tarkistuksin.
- Ennen pysyvää aloitusta peruminen säilyttää tiedot ja valmiin backupin.
  Suljetun runtimen paluu vaatii W7.3:n erillisen käyttäjävalinnan. Pysyvän
  aloituksen jälkeen käyttöliittymä ei peru poistoa; ulkoinen sovellussulku
  käyttää edelleen nykyistä turvallista keskeytys- ja kylmäjatkosopimusta.

#### Lähteestä varmistettu lähtötila

Desktop-polut ovat `apps/desktop/src/`-juuresta, web-polut
`apps/web/src/`-juuresta, ellei taulukossa sanota muuta.

| Vastuu | Nykyinen omistaja | W7.5:n puuttuva liitos |
| --- | --- | --- |
| Mainin poisto | `workspaces/management/workspaceManagementService.ts`, `main/workspaceDeletionContinuation.ts` | `deleteWorkspace` ja pysyvä jatko ovat olemassa. Julkinen capability ei vielä kutsu niitä; sisäistä `completed/navigation`-kuittia ei kuljeteta käyttöliittymään. |
| Pyyntö ja sulku | `workspaces/management/workspaceManagementCapability.ts`, `workspaceManagementCapabilityProtocol.ts` | Tiukka parseri, main-only-pyyntöelinikä sekä runtimeen sidotut peruutus-, valmistumis- ja virheprojektiot ovat työpuussa. Julkinen poistokanava puuttuu. Sisäistä `prepared`-arvoa ei saa julkaista onnistuneena poistona. |
| Renderer-raja | `preload/index.cts`; webin `app/desktopBridge.ts`, `app/desktopWorkspaceManagement.ts` | Nimetty metodi ja molempien päiden suljettu validointi. Ei raakaa IPC:tä, polkua, journalia, salasanaa tai rendererin valitsemaa palautus-/poistokohdetta. |
| Yrityshallinnan UI | `features/workspaces/WorkspaceManagementDialog.tsx`, `WorkspaceList.tsx`, `WorkspaceOperationForm.tsx`, `useWorkspaceManagement.ts`, `workspaceSelectorState.ts`, `workspaceManagementOperation.ts` | Nykyinen lista, lomake ja reducer laajennetaan poistolle. Myöhäiset operaatiovastaukset sidotaan nykyiseen capabilityyn ja yritysvalintaan; pelkkä statuslukijan sukupolvisuoja ei riitä. |
| Runtime-siirtymä | `main/desktopComposition.ts`, `main/desktopSelectorComposition.ts`, `workspaces/runtime/deferredWorkspaceRuntimeRelaunch.ts` | Main-only-paluusovitus yhdistää palvelutyön, varauksen vapautuksen ja nykyisen käynnistyspyynnön. Julkinen käyttäjäpolku ja todellisen paketin todennus puuttuvat. Oma sulku sulkee myös tavalliset capabilityt; niitä ei elvytetä vastauksen vuoksi. |
| Tukivienti | `supportBundle/supportBundleCapability.ts`, `supportBundleArchive.ts`, `supportBundleFileStore.ts`; `apps/desktop/scripts/inspect-support-bundle.mjs` | Nykyinen täysi v2 tarvitsee backendin. Sen ikkuna-/dokumentti- ja dispose-vartijat on lisätty. Backenditön v3, hallintaoperaation sukupolvikytkentä, varhainen main-entry ja virallinen tarkastin puuttuvat. |
| Varhainen virhe | `main/desktopComposition.ts`, `main/index.ts`, `main/earlyStartup.ts` | Cold-poiston hylkäys voi tapahtua ennen valitsimen luomista. Sitä ei voi ratkaista pelkällä valitsimen tukipainikkeella eikä kiertämällä startup-porttia. |

#### Pyyntö, tulos ja elinikä

Säilytetään nykyinen `WorkspaceDeletionRequest` v1: vain `workspaceId`,
`typedLabel`, `backupChoice` ja formaattiversio. Main valitsee polut,
lineagen, nykyisen rekisterin ja kaikki pysyvät valtuudet itse. Sama
nimivertailu ja nykyiset W7.3:n native-/backup-dialogit käytetään kerran.
Poiston typed confirmation ei lainaa W7.1:n väljempää nimien
ristiriitavertailua. Luonti-, tuonti-, vaihto-, korvaus- ja rename-protokollat
eivät muutu uuden tulostyypin vuoksi.

Uudelle poistometodille määritellään oma suljettu v1-tulos nykyisessä
protokollaomistajassa. A-pala lukitsee kenttäjoukot molempien päiden testeihin:

| Tulos | Pakollinen merkitys |
| --- | --- |
| `cancelled` | Main todistaa peruutuksen ennen pysyvää aloitusta. Erikseen erotetaan vielä käytettävä runtime, jo pyydetty hallittu paluu ja suljettuna pysyvä runtime; UI ei päättele tilaa Promise-vastauksesta. |
| `completed` | Palvelun koko nykyinen poisto sekä sen loppukäsittely onnistuivat. Mainin validoima `selector`/`reopenPrevious` ei ole rendererin uusi kohdevalinta. Rekisteristä puuttuminen tai pelkkä `recordRemoved` ei riitä. |
| `failed` | Turvallinen suljetun katalogin syy; vaikutuksettomuus näytetään vain todistetussa ennen aloitusta hylätyssä tilanteessa. Myös jatkotoiminnon käytettävyys tulee mainin todellisesta tilasta. |
| `recoveryRequired` | Aloitus, lopputulos tai sulku on epävarma tai jatko on kesken. Ei vihreää onnistumista, automaattista uutta poistopyyntöä tai väitettä tietojen palautumisesta. |

Kuljetuksen katkeaminen ei ole mikään näistä todistetuista tuloksista:
UI näyttää epävarmuuden, ei arvaa peruutusta tai lähetä uudelleen.
Raaka `Error`, `cause`, journal, tiedostopolku tai yrityssisältö ei kulje
tuloksessa. Nykyinen sisäinen ensivirhe säilyy ennen turvallista projektiota.

Protokollaomistajan suljettu v1-tulos nimeää kentät näin:
`cancelled` sisältää vain `formatVersion`, `status` ja
`nextAction: continue | relaunching | restartRequired`; `completed` vain
`formatVersion`, `status` ja `navigation: selector | reopenPrevious`.
`failed` sisältää lisäksi turvallisen katalogin `errorCode`-arvon,
`sideEffectState: none` ja `nextAction: continue | restartRequired`;
`recoveryRequired` vastaavasti `sideEffectState: unknown` ja
`nextAction: restartRequired`. Jälkimmäisten kenttäjoukko on siis
`formatVersion`, `status`, `errorCode`, `sideEffectState`, `nextAction`.
Parseri hylkää lisäkentät ja accessor-/prototyyppisyötteet ennen niiden
arvojen lukua ja palauttaa uuden muuttumattoman projektion. Parserin
hyväksyntä ei itsessään todista poistamista tai anna jatkotoimintolupaa.

Ennen aloitusta nykyinen pyyntö on sidottu lähettäjään, main frameen,
dokumenttisukupolveen, valittuun yritykseen ja huoltovaraukseen. Kaikki
odotukset revalidoidaan. Oma hyväksytty poistosulku saa säilyttää vain tämän
pyynnön, ei avata muita capabilityjä uudelleen. Pysyvän aloituksen jälkeen
nykyinen W7.4-omistaja jatkaa riippumatta rendererin vastauskanavasta;
ulkoisen sulun vartijat ja keskeytysjatko säilyvät. Navigoinnin tai ikkunan
vaihdon vuoksi vanhentunut vastaus ei muuta uuden näkymän tilaa.

Main tekee paluun vain validoidun lopputuloksen ja nykyisen
lifecycle-omistajan kautta. Se ei pyydä uutta runtimea ennen vanhan työn,
kirjoittajien ja prosessin todettua päättymistä. Vapautusvirhe ei muutu
onnistuneeksi poistoksi. Jo suljettua capabilityä tai kulutettua valtuutta
ei elvytetä vastausta tai paluuta varten. Uutta pysyvää onnistumisjournalia
ei tehdä: uudessa käynnistyksessä luetaan todellinen nykytila, eikä
kadonneesta vastauksesta rakenneta tekaistua historiallista onnistumista.

#### Käyttöliittymän rajaus

Poisto tulee nykyisen yrityslistan kohdekohtaiseen toimintaan, ei uuteen
hallintasovellukseen. Nykyinen dialogi/pääsivun yhteinen lomake säilyttää
fokuksen, näppäimistökäytön, suomenkieliset tekstit ja busy-estot.
Uusi `WorkspaceDeletionForm.tsx` saman featuren sisällä on sallittu
yhden vastuun erottelu; yleistä lomake- tai navigointikehystä ei tehdä.
Tekstit kuuluvat `i18n/fi.ts`:ään ja tyylit omistavan komponentin viereen.

Vahvistus näyttää täsmällisen kohdenimen, tarvittaessa jo käytetyn
samannimisten yritysten turvallisen erottimen sekä poistuvan/säilyvän
aineiston. Menetyshyväksyntää ei esivalita. Nykyinen backup-valmistelija
tukee vain avoimen kohdeyrityksen kopiota; passiiviseen tai vikatilaiseen
kohteeseen ei luvata toimimatonta backup-vaihtoehtoa. Terveen passiivisen
yrityksen voi avata nykyisellä erillisellä vaihtopolulla ennen poistoyritystä.
Vikatilainen kohde käyttää hyväksyttyä erillistä menetyshyväksyntää.

Valitsimen nykyinen `recoveryRequired` ei ole yleinen poistolupa.
Kohteen avaamiskelvottomuus ja koko asennuksen epävarma omistajuus erotetaan:
edellinen ei yksin estä poistopyynnön valmistelua, jälkimmäinen estää
vaarallisen jatkon. Nykyisiä mainin vartijoita ei ohiteta poistopainikkeen
vuoksi. Jos tarvittava turvallinen kohdeprojektiotieto puuttuu, se täsmennetään
A-palassa nykyisen statusomistajan kautta ennen UI-kytkentää.

Käyttöliittymä näyttää odotuksen ilman keksittyä prosenttia tai
vaihevaltuutta. Varsinaisen pyynnön aikana se ei lähetä rinnakkaisia
muutoksia. Peruutus tapahtuu ennen aloitusta nykyisissä vahvistusdialogeissa;
kesken poiston ei tarjota peru-toimintoa. Tavallinen selain ei tarjoa
toimimatonta desktop-poistoa tai tukivientiä.

#### Backenditon tuki ja virhepolku

Formaatti-, sisältö-, kokoraja-, permission- ja elinikäsopimuksen omistaa
[nykyinen tukipakettisuunnitelma](support-bundle-plan.md#w70n-rajattu-tukisopimusehdotus).
Toteutetaan sen erillinen `desktopOnly` v3, ei osittaista täyttä v2-pakettia.
Täysi v2, legacy-tarkastin ja niiden backend-permission säilyvät. Täyden
viennin virhe ei saa vaihtaa vaivihkaa backendittömään vientiin.

Valitsimessa käytetään nykyistä argumentitonta tukivienticapabilityä ja
mainin native-vahvistusta/tallennusvalintaa. Formaattia, backendin tilaa tai
pakettiin tulevaa tapahtumaa ei valitse renderer. Nykyinen observer saa
toimittaa rajatun, validoidun tämän operaation ensivirheen ja erillisen
siivousvirheen nykyiselle main-omistajalle ennen lokikirjoitusyritystä.
Tämä ei ole uusi lokipuskuri tai historiapalvelu. Puuttuva havainto säilyy
puuttuvana myös lokitusvian jälkeen; journalista ei rekonstruoida syytä.

**A-palassa ratkaistava liitos:** ennen valitsinta hylätty startup pysyy
hylättynä. Ehdotus on tarjota nykyisen turvallisen virhe-dialogin kautta
vain sama rajattu mainin tukivientitoiminto ennen normaalia poistumista.
Ei normaalia valitsinta, business-API:a, korjaavaa rekisterilukua tai uutta
runtimea. Tämä entry ei lainaa kuvitteellista renderer-sessionia: sen
kertakäyttöinen lupa kuuluu nykyiselle virhettä käsittelevälle mainille ja
päättyy sulussa. Sama arkistointi/tallennusomistaja palvelee molempia entryjä;
IPC-entry vaatii lisäksi oikean ikkunan ja framen. Tämä on uusi
sisääntulon valtuusraja, jonka **omistaja hyväksyi 6.11.2026 toteutukseen
ja kytkentään kokeiden ja katselmuksen läpäistyä**. Hyväksyntä koskee vain
tässä kuvattua rajattua vientiä. Nykyisen IPC-entryn ikkuna-/frame-/
hallintasessiosopimus säilyy; varhainen main-entry ei lainaa sen lupaa.

A-kokeessa turvallinen `currentOperation`-havainto otetaan nykyiseltä
operaatio-omistajalta ennen käynnistysvirheen yleistä koodimuunnosta.
Nykyinen `onFailure(errorCode)` ei yksin säilytä W7:n alkuperäistä syytä;
siitä ei rekonstruoida havaintoa. Puuttuva havainto on `unavailable`.
Vienti edellyttää v3:n vaatimaa validoitua runtime-/build-identiteettiä.
Jos buildin luottamusta ei ole todettu, nykyinen turvallinen
virheilmoitus ja poistuminen säilyvät ilman vientiä. Varhaista sisääntuloa
ei käytetä yleisenä startup- tai v2-virheiden fallbackina. Tarkka liitos,
identiteetin hylkäys ja ennen ensimmäistä ikkunaakin epäonnistuva tapaus
katselmoidaan A:ssa; epävarmaa startup- tai sulkurajaa ei ohiteta.

#### Toteutuspalat ja näyttöportit

| Pala | Rajattu työ ja tiedostot | Portti ennen seuraavaa palaa |
| --- | --- | --- |
| W7.5 A: kuljetus ja elinikä | Nykyiset capability/protocol/service-, continuation-, relaunch- ja main-omistajat yllä. Lukitse tuloksen kentät, vikatilan luettavuus, oma sulku, loppuvastaus/paluu sekä varhaisen tukiviennin omistajuus. Pienet synteettiset ketjukokeet nykyisiin lähitesteihin; julkinen kanava pysyy kiinni. | Navigointi ennen/jälkeen aloituksen, kuittauskatko, lease-release-virhe, pysyvä jatko ilman vastaajaa, vanha vastaus uuteen näkymään ja tukidialogin sukupolvimuutos. Myös main-I/O:n päättyminen todistetaan. Rajattu riippumaton sopimuskatselmus; epäselvää omistajuutta ei siirretä seuraavan palan arvattavaksi. |
| W7.5 B: rajattu tukipaketti | Nykyinen `supportBundleCapability`, archive/file-store, virallinen tarkastin sekä main/selector- ja varhainen virhe-entry. Tarvittaessa vain nimetty `supportBundleDesktopData.ts` ja sen lähitesti suljetulle v3-projektiolle nykyisessä kansiossa. | Oikeat gzip-/checksum-tavut, v2/legacy ennallaan, tiukka v3, ei havaintoa != terve, nolla backend-/SQLite-/historialukua, dialogin peruutus ja vanhentuminen ennen tallennusta. Ensisyy ei peity keräys-/sulkuvirheeseen. |
| W7.5 C: näkyvä käyttäjäpolku | Nykyiset workspace-web-omistajat, bridge/preload ja capability. Lisää tiukka delete-metodi, lomake, turvalliset tulokset ja rajattu tukitoiminto samaan valitsimeen. Ei erillistä poisto-HTTP-reittiä tai business-permissionia. | DOM-, reducer-, kuljetus- ja capabilitytestit sekä oikea renderer -> preload -> main -> nykyinen palvelu. Tarkista väärennetty sender/frame, lisäkentät, toisto, sama nimi eri kohteella, status-/capabilityvaihto sekä peruutus. Test-only sisäinen poistokutsu ei todista julkista entryä. |
| W7.5 D: todellinen kokonaisketju | `apps/e2e/tests/electron/workspaceDeletionExecution.spec.ts`, `backendlessWorkspaceSelector.spec.ts`, nykyiset valmistelu-/selector-tapaukset ja paketoitu `workspaceDeletionRecovery.spec.ts`; nykyiset eristetyt fixturet ja desktopin smoke-omistajat. Täydennä vain uusien rajojen testit. | Aktiivinen, passiivinen, viimeinen ja vikatilainen kohde; backup/peruutus; oikea restart ja uusi session; julkisen pyynnön keskeytys ja cold-jatko; muiden yritysten ja ulkoisten tiedostojen säilyminen. Myös v2- ja backenditön v3-vienti oikeasta compositionista viralliseen tarkastimeen. |
| W7.5 E: integraatio | Omistavat ohjeet, matriisi ja nykyinen ajokytkentä, eheä diffi ja puhdas paketti. | Kokonaisuuden riippumaton loppukatselmus, vaikutusalueen regressiot ja buildit, tarvittava nykyinen stress/soak, hardened Windows backup -> inspect -> restore -> restart -> compare sekä poisto/restart. Saman täsmä-PR-headin nykyiset portit/auditointi, normaali suojattu merge ja uuden mainin omat portit. |

A-C voidaan valmistella pieninä katselmoitavina muutoksina, mutta
keskeneräistä julkista poistoa ei julkaista erillisenä valmiina ominaisuutena.
Mainin pitkä tiedosto vain kokoaa nykyiset portit; sinne ei siirretä
DTO-parseria, UI-tilakonetta tai paketin sisältösääntöjä.

##### W7.5 A:n ensimmäinen elinkaarinäyttö

[Edeltävä palvelukoe ja sen näyttöraja](release-0.3.0-integration-history.md#w75-an-ensimmäinen-elinkaarinäyttö)
säilyvät historiassa. Ne eivät yksin hyväksy nykyistä käyttäjäpolkua.

##### W7.5 A:n tulos- ja vastauseliniän osanäyttö

[Edeltävä parseri-/vastauselinikäkoe](release-0.3.0-integration-history.md#w75-an-tulos--ja-vastauseliniän-osanäyttö)
säilyy historiassa. Nykyinen main-only-metodi käyttää samaa pyyntöelinikää,
mutta peruutuksen jatkotoiminto luetaan nyt erilliseltä main-omistajalta.

##### W7.5 A:n runtime- ja paluusopimus

`createWorkspaceDeletionResultRuntime` kuuluu nykyiseen mainin
`workspaceDeletionContinuation.ts`-omistajaan. Se ei anna tiedostomuutoksen
valtuutta eikä suorita poistoa. Capability odottaa ensin nykyisen palvelun
koko komennon ja varauksen vapautuksen; vasta sen onnistumisen jälkeen
mainin paluusovitus tarkistaa nykyisen asennusomistajan, pysäytetyn runtimen,
vapaan huoltovarauksen ja fyysisen main-varauksen ennen kertakäyttöistä
paluupyyntöä. Vanhaa vapautettua delete-leasea ei lainata. Paluu ei odota
sovelluksen sulkua omasta hallintapyynnöstään. Dokumentin katoaminen voi
estää vastaamisen, muttei poista tämän main-jatkon elinikää; ulkoinen
main-sulku tai omistajuuden menetys estää jatkon.

Ennen omaa sulkua peruttu aktiivinen yritys käyttää edelleen elävän
backendin omistusta: asennussukupolven ja `assertRunning`-tarkistuksen pitää
onnistua. Silloin ei vaadita jo mainille palautettua varausta. Suljetun
runtimen tila on vain havainto; paluu vaatii erikseen main-omistajuuden.
`DeferredWorkspaceRuntimeRelaunch.hasDispatched` erottaa hyväksytyn
synkronisen callbackin pelkästä pyynnöstä tai hylätystä valtuudesta.
Peruutus näyttää `relaunching` vain tämän havainnon perusteella;
muutoin suljettu/epävarma tila pysyy `restartRequired`-tilassa.

[Edeltävä main-kytkennän osanäyttö](release-0.3.0-integration-history.md#w75-an-runtime--ja-paluusovituksen-osanäyttö)
säilyy historiassa. Seuraava virhesopimus täydentää samaa omistajuutta,
ei korvaa W7.4:n fyysistä poistoketjua.

##### W7.5 A:n virhetulos ja vastaanottoraja

Nykyinen palvelu voi toimittaa main-only-kutsujalle yhden muuttumattoman
virhetodisteen vasta oman loppukäsittelynsä ja varauksen vapautuksen jälkeen.
Todiste sitoo täsmälleen saman alkuperäisen poikkeuksen vaikutustilaan:
`none` vain ennen operaation aloitusta, kun erillistä loppuvirhettä ei ole;
muuten `unknown`. Vanhojen kutsujien kahden argumentin sopimus säilyy.
Lokikirjoituksen onnistuminen tai sama syykoodi ei ole vaikutuksettomuuden
todiste. Havaitsijan virhe ei korvaa alkuperäistä poikkeusta.

Capability hyväksyy vain yhden tähän kutsuun kuuluvan täsmällisen
datatodisteen. Puuttuva, myöhäinen, toisen poikkeuksen tai toistettu
todiste pysyy epävarmana. Palvelun onnistumisen jälkeen sattuva mainin
jatkovirhe ei voi lainata vanhaa todistetta. Main saa alkuperäisen syyn
ennen suljettua projektiota. `continue` vaatii todistetun vaikutuksettomuuden,
`BUSY`- tai `INVALID`-syyn ja nykyisen elävän runtimen. Epävarma omistajuus
ei muutu jatkoluvaksi vaikutuksettomankaan pyynnön vuoksi. Projektorin
erillinen virhe säilytetään alkuperäisen jälkeen, ei sen tilalla.

Webin nykyinen `desktopWorkspaceManagement`-omistaja validoi saman suljetun
tuloksen itsenäisesti vastaanottorajalla ja luo uuden muuttumattoman
projektion. Se ei importoi desktopin tiedosto-/runtime-omistajia eikä anna
poistovaltuutta. Julkista delete-metodia ei vielä julkaista.

Neljäntoista kokonaisen desktop-lähitiedoston 472 testiä, koko main-tiedoston
396 testiä ilman ohituksia sekä desktopin tyypitys läpäisivät nykyisillä
rajoilla. Main-kokeet todentavat myös alkuperäisen vapautusvirheen ennen
turvallista vastausta. Uusien tulosketjujen kuluttaja ja poistokuitti ovat
kontrolloituja; tämä ei ole uusi native-/pakettihyväksyntä. Päällekkäisiä
sarjoja ei summata. Webin kahden kokonaisen vastaanottorajatiedoston 157
testiä ja tyypitys läpäisivät. Rajattu katselmus havaitsi accessor-testien
puuttuvan varianttipeiton; jokaisen neljän tulosvariantin kaikki kentät
tarkistetaan nyt getterin kutsumattomuuteen asti. Jälkikatselmukseen ei
jäänyt löydöstä. Varhaisen tukiviennin
omistajuus- ja kytkentänäyttö on edelleen avoin.

##### W7.5 A:n tukivientipyynnön elinikä

Nykyinen `supportBundleCapability` tarkistaa saman ikkunan, pääframen,
dokumenttisukupolven ja sulkemattoman kyvykkyyden jokaisen nykyisen
odotuksen jälkeen sekä ennen synkronista kirjoittajaa. Mahdollinen mainin
tilavartija vaaditaan synkroniseksi. Vanhentunut pyyntö ei tallenna tai
näytä vanhan näkymän virhedialogia; uuden dokumentin erillinen pyyntö ei
elvytä vanhaa. Lokitus tai virheilmoitus ei korvaa alkuperäistä syytä.
IPC-virhe ei sisällä alkuperäistä poikkeusta; testin yksityinen havaitsija
saa sen ennen turvallista muunnosta. V2:n sisältö, backend-permission,
kirjoittaja ja kokorajat säilyvät.

Neljän kokonaisen tukivientitiedoston 83 testiä ja tyypitys läpäisivät.
Oikeat gzip-/kohde-/naapuritavut tarkistettiin myös vanhentuneessa pyynnössä.
Kaksi nykyisen main-koostamisen sulkukontrollia läpäisi: vahvistuksessa
tai tallennusvalinnassa odottava pyyntö ei sulun jälkeen avaa palautetta,
hae backendin tukitietoja tai kirjoita tiedostoa. Tietokanta-, PDF- ja
rekisteritavut säilyivät. Main-kokeen Electron-/backend-rajat ovat
kontrolloituja, eivät native-todiste.

Nykyisen OpenPGP-sarjan neljä koetta läpäisivät. Sen uusi pakotettu
tukivientihylkäys säilyi hylkäyksenä; alkuperäinen viesti, pino ja syyketju
löytyivät puretuista samoista tavuista testin ja ajon sidontoineen,
eivät julkisesta testitulosteesta. Ensimmäisen kokeen vanha tiedostomäärä-
väittämä täsmennettiin uuden tapauksen kolmelle tiedostolle; aiempi
epäonnistuminen säilytetään. Tämä ei ole backendittömän v3:n, varhaisen
native-entryn tai koko W7.5:n hyväksyntä. Koko main-regressio läpäisi 398
testiä ilman ohituksia samoilla rajoilla. Rajatussa katselmuksessa havaittu
IPC:n raakasyyn vuotoriski korjattiin; jälkikatselmukseen ei jäänyt löydöstä.
Kohdeajot ja koko main-sarja ovat päällekkäisiä, eivät summattavaa kattavuutta.

##### W7.5 B:n sisältö- ja tiedostoraja

Nykyinen arkisto-omistaja tuottaa erillisen suljetun `desktopOnly` v3:n,
ja virallisessa tarkastimessa on sen erillinen lukija. Sisällön omistaa
`supportBundleDesktopData.ts`; [tukipakettisuunnitelma](support-bundle-plan.md#w70n-rajattu-tukisopimusehdotus)
omistaa kentät, tapahtumaroolit ja rajat. Vain nykyinen turvallinen
ensivirhe ja erillinen siivoushavainto ovat sallittuja; puuttuva tieto ei
muutu terveystulokseksi tai nollaksi.

Viiden kokonaisen tukivientilähitiedoston 179 testiä, tarkastimen 21 testiä
ja tyypitys läpäisivät nykyisillä rajoilla. Todellinen gzip, nykyinen
tiedostokirjoittaja, virallinen tarkastin ja JSONin uusintaluku säilyttivät
tavut, naapuritiedoston ja checksumien avainjärjestyksen. Suljetut
syöterajat, muuttuneet checksumit ja virhekoodin tyyppivirhe hylätään;
vanhan v2:n ja legacy-päätteen regressiot säilyivät. Tarkastimen katselmuksen
ei-merkkijonoisen virhekoodin aukko toistettiin ja korjattiin.

Tämä ei vielä avaa tukivientiä valitsimeen tai ennen pääikkunaa eikä
todista hallintasession sukupolvea, observerin nykyistä havaintoa tai
paketoitua ketjua. Nämä ovat seuraava A/B-liitos; poistokanava pysyy
suljettuna. Päällekkäisiä kohdesarjoja ei summata.

#### Testikattavuus ilman rinnakkaista testijärjestelmää

W7.4:n journal-, 23 kohteen rooli-, fyysinen poisto-, metadata- ja
prosessikatkotestit säilyvät. Niiden koko yhdistelmää ei kopioida kaikkiin
UI-/tukivientitesteihin. Uudet luottamus- ja kilpailurajat testataan ensin
omistajan vieressä pienellä fixturellä, sitten edustavalla oikealla ketjulla.
Käyttöliittymän julkiseen kutsuun siirrettävä vanha E2E-tapaus saa korvata
sisäisen kutsun vain, jos sen kaikki nykyiset tiedosto-, eristys-, sulku-
ja restart-väittämät säilyvät; muuten vanha tapaus jää erikseen.

Ennen pitkiä ajoja todistetaan pakotetun synteettisen alkuperäisvirheen
kulku nykyiseen salattuun CI-pakettiin ja sen purku, erillisine
siivousvirheineen. Tämä ei tarkoita raakavirhettä käyttäjän sanitoituun
tukipakettiin. Uudet testit liitetään nykyiseen matriisiin, kanoniseen
komentoon ja sen valintaregressioon; testimäärä tai `--list` ei ole näyttö.
Nykyinen core-työnjako, Electron development-/packaged-jako, aikarajat,
siivousvaatimukset ja ensihylkäysten säilytys pysyvät. Uutta CI-työtä,
automaattista uusintasilmukkaa tai aikarajan nostoa ei suunnitella tähän.

#### Dokumentit ja avoimet kohdat

Toteutuksen mukana päivitetään vain muuttuvien sopimusten omistajat:
tämä W7.5-osio, lyhyt M1, tukipakettisuunnitelma, ADR-0011:n toimitusraja,
desktopin toteutussuunnitelman lifecycle-kytkentä, webin rakenneohje,
Diagnosticsin/moduulimatriisin tukivastuu sekä E2E-matriisi ja -ympäristö.
Tapahtumakatalogia muutetaan vain todellisen projektioeron vuoksi.
Historiallinen hyväksyntänäyttö ja tuntemattomat virhesyyt säilyvät erillään.

**Avoinna ennen kytkentää:** A:n tarkka lopputulos-/paluusopimus,
varhaisen virhe-entryn toteutusnäyttö,
tukiviennin nykyisen operaation havaintolähde
sekä D:n paketoidun julkisen entryn ohjaus nykyisillä turva-asetuksilla.
Nämä ovat nimetyt toteutusportit, eivät peruste aloittaa yleistä
arkkitehtuuri- tai suorituskykyremonttia. Jos hardened-paketin painiketta
ei voi ohjata nykyisillä hyväksytyillä välineillä, erotetaan development-
käyttäjäpolku ja paketin nykyinen todiste sekä sovitaan puuttuva näyttö;
suojausta tai testiruntimea ei väljennetä salaa.

Omistajan jatkolupa aloittaa A:n rajatut kokeet ja toteutuksen. Julkisia
tuotantokanavia ei avata ennen niiden omia näyttöportteja. W7.5 on valmis vasta palojen A-E
todellisilla näytöillä; sen hyväksyntä ei vielä sulje koko 0.3.0:n M5:tä.

**Alkuperäinen rajaus:** omistajan 2026-09-22 päätöksellä `0.3.0`-julkaisuun kuuluva
vaadittu ominaisuus. M1:n valmistelussa keskustelun nimetyt
käyttäytymisvalinnat on hyväksytty 23.10.2026. Omistaja hyväksyi 24.10.2026
myös W7-P1-P3:n suunnat ja W7-P4:n ehdollisen toteutuksen. Tarkat tekniset
sopimukset ja kokeet on vielä todennettava ennen tuotantokytkentää.
Aiempi alustava tavoite `0.2.9` on korvattu
[0.3.0-julkaisusuunnitelmalla](release-0.3.0-plan.md), tehtävä `R030-02`.

Poisto suunnitellaan erikseen vasta ensimmäisen multi-workspace-releasen
jälkeen. Se vaatii ADR-0011:n quarantine-, backup-, typed confirmation-,
native confirmation-, secret-, recovery- ja external artifact -rajat.

W7 ei saa tulla mukaan W1-W6-PR:iin tai korjattuun 0.2.8-pilottiin sivutoimintona.
Julkaisuun kuuluminen ei vielä hyväksy toteutuksen yksityiskohtia, schema- tai
backup-formaattimuutosta eikä poiston turvallisuussopimusta ilman omaa
suunnittelu- ja hyväksyntäporttia. Poistoa ei siirretä pois `0.3.0`:sta ilman
omistajan uutta päätöstä, eikä keskeneräistä turvallisuusrajaa ohiteta
julkaisun valmistumiseksi.

### W7-valmistelu ja paatosportti

**2026-09-24: read-only-valmistelu, ei toteutuslupaa.**
[M1-suunnitelma](release-0.3.0-m1-preparation-plan.md) omistaa etenemisjärjestyksen.
Tämä osio omistaa W7:n päätöslistan; ehdotukset eivät muuta ADR:iä.
**24.10.2026:** hyväksytyt suunnat ja ehdollinen toteutusvaltuus ovat alla
W7-P1-P4:ssä. M4.3 on hyväksytty; W7.0 jatkuu tarkkaan sopimukseen ja
pieniin kokeisiin. Ehdotuskatselmus on tehty, mutta se ei korvaa tarkan
toteutussopimuksen ja koetulosten katselmusta ennen tuotantokytkentää.

Nykyinen pohja sisältää registry-/path-validoinnin, maintenance-leasen,
quiescence-/shutdown-portit ja rajatut workspace-capabilityt. Poisto ei ole
valmis kyvykkyys, jonka voisi vain näyttää UI:ssa: rekisterin tilat ovat
`ready` ja `recoveryRequired`, lease ei tunne poistoa eikä management-
compositionissa ole poistokoordinaattoria. Tyhjä rekisteri on esitettävissä,
mutta `resolveWorkspaceSwitchStartup` torjuu puuttuvan aktiivisen työtilan
ja management-composition tarvitsee aktiivisen workspacen.

Create/import-recovery-luokkien olemassaolo ei todista tuotantokytkentää.
W3:n import-plaintext-quarantine ei ole palautettava yrityspoisto. Uutta
W7-journalia tai tilaa ei lisätä hiljaisesti registry v1 -formaattiin.

#### W7.0:n lähtökartta 24.10.2026

Kartoitus on tehty hyväksytystä mainista
`f38c1f77e9d5db864a3624bc0a4e8277a446a02d`. Se on lähdeluku, ei
poistotoiminnon, uuden keskeytysrecoveryn tai testien läpäisyn todistus.
Alla olevat tekniset erot täsmennetään nykyisen W7.0-W7.5-jaon sisällä.

| Raja | Nykykoodin näyttö | W7.0:ssa täsmennettävä |
| --- | --- | --- |
| Capability ja varaus | `workspaceManagementTypes.ts`, `workspaceManagementCapabilityProtocol.ts` ja `workspaceMaintenanceLease.ts` eivät sisällä poistoa. `WorkspaceManagementService` serialisoi nykyiset operaatiot ja tarkistaa avoimet journalit. | Poiston suljettu pyyntö-/tulosmalli ja nykyisen maintenance-omistajan laajennus. Sender/frame, kohde ja vahvistukset tarkistetaan mainissa; ei rendererin myöntämää poistolupaa tai polkua. |
| Rekisteri ja yritysvalinta | `workspaceRegistryValidation.ts` sallii `activeWorkspaceId: null` vain, kun `ready`-entryjä ei ole. `workspaceSwitchStartup.ts` torjuu puuttuvan aktiivisen. | Aktiivisen poiston jälkeinen pysyvä yritysvalinta myös muiden `ready`-yritysten säilyessä. Valinta ja business-runtimen avaus erotetaan; mahdollista registry-/valintatilamuutosta ei hyväksytä tässä kartoituksessa. |
| Hallinta ilman backendia | `workspaceManagementComposition.ts` tarvitsee aktiivisen ID:n, lifecycle-adapterin ja recovery-palvelun. `desktopComposition.ts` kytkee hallinnan vasta aktiivisen runtimen yhteyteen. | Sama rajattu hallintakyvykkyys ilman business-backendia, tyhjä rekisteri ja vain recovery-kohteita sisältävä rekisteri erikseen. Ei oletusyritystä tai tekaistua actor-/yrityskontekstia. |
| Sulku ja cold admission | `mainOwnedActiveWorkspaceLifecycle.ts` omistaa kirjoitusten, secret-drainin, backendin ja brokerien sulun. `workspaceColdRecoveryAdmission.ts` valitsee nyt vain create/import-recoveryn. | Poistoon sidottu tuore varaus ja todellinen I/O-/prosessipoissaolo sekä poiston tarkka paikka nykyisessä startup-/recovery-ketjussa. Avoimen muun journalin estoa ei ohiteta yleisesti. |
| Nimien yksilöllisyys | `workspaceLabelValidation.ts` vaatii valmiiksi trimmatun turvallisen nimen; web trimmaa syötteen. `workspaceRegistryMutations.ts` ei vertaa nimiä, ja `workspaceLabelRename.test.ts` hyväksyy nykyisin kaksoiskappaleet. | Yksi hyväksyttävä Unicode-/kirjainkoko-/välilyöntivertailu create/import/rename-poluissa saman varauksen sisällä. Vanhat kaksoiskappaleet pysyvät luettavina; vain uuden konfliktin synty estetään. |
| Poistoinventaario | `desktopProfilePaths.ts` ja `profileSnapshotRuntimePaths.ts` johtavat DB/PDF-/palautusjuuret. `encryptedSecretFile.ts` tuntee nykyisen SMTP:n current/next/backup-slotit. `workspaceLegacyAdoptionPaths.ts` erottaa vanhan runtime-lähteen workspace-juuresta. | Todistettu yrityskohtainen inventaario ennen/jälkeen myös staging-/legacy-jäämistä. Pelkkä workspace-juuren rekursiivinen poisto ei täytä sopimusta; koko vanhaa runtime-juurta ei poisteta, koska siinä voi olla installation-tilaa. |
| Palaute ja tuki | `supportBundleCapability.ts` vaatii `loadBackendData`-tuloksen; nykyinen composition hakee sen käynnissä olevasta backendistä. `WorkspaceList.tsx` ei sisällä poistotoimintoa. | Nimetty turvallinen palaute ja tukireitti myös ilman backendia. Puuttuvaa business-terveystietoa ei merkitä terveeksi eikä viimeisen yrityksen poisto jätä näkymää riippuvaiseksi poistetusta backendistä. |

Taulukon tiedostonimet ovat `apps/desktop/src/`-juuren omistavissa
`workspaces`, `runtime`, `profileBackup`, `secrets`, `supportBundle` ja
`main`-hakemistoissa; `WorkspaceList.tsx` on webin nykyisessä workspace-featuressa.

**Ennen toteutussopimuksen lukitsemista:**

- Vertaa erikseen pysyvän yritysvalinnan ja registry-version vaihtoehdot.
  Toisen yrityksen automaattinen avaus tai keinotekoinen `recoveryRequired`
  ei ole hyväksytty tapa kiertää nykyistä null-aktiivisen ehtoa.
- Nimeä mahdollisen operaatiokohtaisen poistojournalin formaatti, rajat,
  slotit, backup-poissulku ja täsmällinen lopullisen poiston aloitustodiste.
  Quarantine on omistettu siirto saman operaation sisällä, ei piilokopio;
  sovellustason poisto ei lupaa fyysisten levysektorien ylikirjoitusta.
- Sido backupin tuoreus samaan kirjoitus-/snapshot-rajaan tai vaadi
  hyväksytty erillinen menetyssuostumus. Kirjoitettu nimi ja native-vahvistus
  koskevat samaa uudelleenvalidoitua kohdetta; vanhan samannimisen erottelu
  ei saa palauttaa yksityisiä polkuja tai business-tunnisteita.
- Määritä tiedostosiirron, registry-julkaisun, salaisuus-/palautuspistepurgen
  ja journalin poiston kaikki keskeytysvälitilat. Osittainen poisto ei avaa
  business-runtimea tai vapauta lineagea uudelle tuonnille ennen todennettua
  lopputilaa. Vanha journal ei yksin todista tuoretta muutosvaltuutta.

Nykyinen `WORKSPACE-DELETE-001` on edelleen `deferred`, ei valmis
poistotesti. W7 käyttää nykyisiä kohde-, capability-, selain-/Electron- ja
packaged-fixturejä; yleistä testi- tai lokitusjärjestelmää ei rakenneta.
Ennen pitkää ajoa uusi muunnosraja todistaa alkuperäisen synteettisen
virheen säilymisen nykyisessä salatussa paketissa ja oikeassa purussa.
Muiden yritysten DB-/PDF-/secret-/palautuspisteiden sekä ulkoisten kopioiden
säilyminen todennetaan sisällöstä, ei vain onnistumiskoodista.
Tarkka keskeytysmatriisi ja packaged-portit ovat alla nykyisessä
[recovery- ja hyväksyntänäytössä](#recovery-ja-hyväksyntänäyttö).
Tämä valmistelu ei muuta tuotantokoodia, riippuvuuksia, versioita tai
aikarajoja eikä hyväksy uutta journalia tai rekisteriformaattia.

#### W7.0:n turvallisuussopimusehdotus

**24.10.2026, suunnat ja ehdollinen toteutus hyväksytty:** omistaja hyväksyi
W7-P1:n rekisterisuunnan sekä jäljempänä W7-P2/P3:n poistojournalin,
backendittoman hallinnan, passiivisen poiston käyttökatkon, kohteen oman
keskeytyneen palautuksen korvaamisen ja rajatun desktop-tukipaketin.
W7-P4 hyväksyy tuotantokytkennän vasta täsmennettyjen sopimusten, pienten
keskeytys-/yhteensopivuuskokeiden ja katselmuksen jälkeen. Näihin kuuluvat
rajatut kokeet saa tehdä; samoja käyttäytymispäätöksiä tai ehdollista
toteutuslupaa ei kysytä uudelleen. Tämä ei ole vielä testinäyttöä tai W7:n
loppuhyväksyntä.
Tämä osio omistaa jatkon; lähtökartta yllä on havaintojen tausta, ei toinen
työjono. Päätösten tila ja jäljellä olevat todennusportit ovat osion lopussa.
Rajattu riippumaton suunnitelmakatselmus on tehty. Sen first-start-
lähtötilaa koskeva täsmennys on lisätty alle. Inventaarion historiallinen
sidonta, backenditon first-start ja tuen tarkka sisältö-/käyttöoikeussopimus
ovat edelleen teknisiä todennusportteja ennen vaikutusalueen kytkentää.

##### W7.0:n jäljellä olevat sopimustäsmennykset

**Valmiuskatselmus 25.10.2026:** registry-, jäännössidonta-, tuki- ja
first-start-kokeet ovat rajattua valmistelunäyttöä. Viidestä nimetystä
sopimuksesta myös viimeiset journal-/kohdeluettelo- ja capability-rajat
on nyt täsmennetty, kokeiltu ja katselmoitu. W7.0 on valmis rajattuna
sopimus- ja koevaiheena; alla säilyvät tuotantokytkennän erilliset portit.
Valmistunutta koetta ei uusita ilman sen sopimusta muuttavaa havaintoa.

| Sopimus | Todennettu valmistelu ja seuraava toteutusraja |
| --- | --- |
| Poistojournal ja inventaario | [Täsmäformaatti ja julkaisu-/loppusiivoussopimus](#w70n-kohdeluettelon-täsmäsopimus): 44 tapausta ja tyypit läpäisivät; katselmuksen registry-race korjattu ja jälkitarkistettu. Täydellinen roolikohtainen inventaario, oikeat omistajat ja payload-purge todistetaan tuotantokytkennässä. |
| Poiston management-capability | [Poistopyyntö ja vahvistus](#w70n-poistopyyntö--ja-vahvistussopimus): 42 uutta tapausta, 18 nykyistä regressiota ja tyypit läpäisivät. Kaksi koepuutetta toistettu, korjattu ja katselmoitu. Oikeat IPC-, native-, observer- ja lukijakytkennät todistetaan W7.3-W7.5:ssä. |
| Nimivertailu | [Nimivertailun koesopimus](#w70n-nimivertailun-koesopimus): 56 uutta tapausta, 58 nykyistä codec-regressiota ja tyypit läpäisivät; rajattu katselmus valmis. Poistovahvistus on erillinen täsmällinen NFC-vertailu, vanhat nimet säilyvät. Oikeat kirjoittajat, recovery ja UI todistetaan W7.1-W7.5:ssä. |
| Backup-todiste | [Sisältövastaavuuden ja kertakäytön ehdokas](#poiston-backup-todisteen-vastaavuus): 60 uutta tapausta, 10 nykyistä regressiota ja tyypit läpäisivät; rajattu katselmus valmis. Tuotantoketju kuuluu W7.3:een. Todistamaton vastaavuus ei korvaa menetyshyväksyntää. |
| Valitsimesta avaus | [Tallennus- ja jatkosopimuksen](#valitsimesta-avauksen-pysyvä-jatko) yksityinen ehdokas, 47 uutta tapausta, 33 nykyistä v1-regressiota ja tyypit läpäisivät; rajattu katselmus valmis. Tuotantokytkentä kuuluu W7.1-W7.5:een. |

Näiden sopimusten täsmennys ja rajattu katselmus kuuluvat W7.0:aan.
Tuotantocodecit, todelliset capability-/observer-kytkennät, native-sulku,
SQLite, fyysinen restart sekä MSI-/packaged-/PR-/main-portit kuuluvat
myöhempään W7.1-W7.5-toteutukseen. Niiden puuttumista ei ratkaista
kutsumalla synteettistä koetta tuotantotodisteeksi. Seuraava rajattu pala on
W7.1:n yhteinen nimivertailu ja sen nykyiset kirjoittajat. Rekisterin v2,
backenditon valinta ja first-start kytketään W7.2:n kanssa yllä olevan
sopimuksen mukaan. Koko W7 ei ole vielä valmis.

##### W7.0:n ensimmäinen sopimusnäyttö

**24.10.2026, valmistelu käynnissä:** yksi W7.0-kokonaisuus sisältää
täsmälliset sopimukset, pienet kokeet ja niiden rajatun katselmuksen.
Se ei vielä kytke W7.1-W7.5:tä tuotantoon tai käynnistä integraatioajoa.

Nykyisen `CrashSafeByteSlotStore`-tallentimen ja rekisterilukijan 18
synteettistä tiedostokoetta läpäisivät. Näyttö koskee v1-tavujen säilymistä,
vanhan lukijan v2-hylkäystä, next-/backup-valintaa, julkaisun eri kohdissa
palautuvaa virhettä ja slottien loppusiivousta. Todellisia tiedostotavuja
verrattiin ennen ja jälkeen; epäonnistunut kirjoituskutsu voi jättää uuden
currentin julkaistuksi. Tällöin virhe ei tarkoita vaikutuksetonta toimintoa.

Geneerinen lukija validoi ensimmäisen löytyvän slotin sisällön, ei kaikkia
sisältöjä ennen muiden slottien siivousta. Tiedostotyyppi- ja polkutarkistukset
säilyvät. W7 tarvitsee siksi oman kaikkien slottien **sisältö- ja
operaatiosidonnan** tarkistuksen ennen nykyisen korjaavan lukijan käyttöä.
Initial-next ei yksin ole aiemmin julkaistu poistolupa. Saman operaation
backup/next-välitila ei anna lupaa ohittaa julkaisematonta vaihetta.
Ristiriitaiset operaatiot, kohteet tai vaiheet säilytetään selvitykseen.

Kokeet ovat nykykäyttäytymisen karakterisointi, eivät v2-kirjoittajan,
poistojournalin, koko yrityksen purgen tai paketoidun restartin todiste.
Uusi store-olio ja injektoitu poikkeus eivät ole käyttöjärjestelmän
uudelleenkäynnistys tai sähkökatko. Nykyisen tiedostotallentimen
`syncDirectory()` ei tee Windowsissa hakemistosynkronointia; kokeesta ei
johdeta fyysisen sähkökatkokestävyyden lupausta. W7:n todennetut pysyvät
tilat ja epävarmassa tilassa pysähtyminen on testattava erikseen ennen
kytkentää. Kohteen ulkopuolinen vertailutiedosto ei korvaa muiden yritysten
DB-/PDF-/secret-eristyksen myöhempää näyttöä.

Rekisterimuutoksen tiedosto-/kutsujasopimus täsmentyy seuraavasti.
Polut ovat `apps/desktop/src/workspaces/`-juuren alla; jaettu lukija tai
kirjoittaja muuttuu vain kerran, ei omaksi kopioksi jokaiselle kutsujalle.

| Omistaja | Vaadittu muutos ja säilyvä raja |
| --- | --- |
| `registry/workspaceRegistryTypes.ts`, `workspaceRegistryValidation.ts` ja `workspaceRegistryBytes.ts` | Versiot erotetaan täsmällisesti. V1:n hyväksyntä säilyy, v2 sallii null-valinnan myös ready-entryillä; muut entry-, identiteetti-, määrä- ja tavurajat säilyvät. |
| `registry/workspaceRegistrySerializer.ts` ja `workspaceRegistryStore.ts` | Kanoninen serialisointi säilyttää valitun version ja v1:n nykyiset tavut/tiivisteet. Samat tiedostopolut ja slotit, ei rinnakkaista rekisteriä. |
| `registry/workspaceRegistryMutations.ts` sekä create/import/rename/switch-kutsujat | Ei kovakoodattua paluuta v1:een tai v2:n null-valinnan korvaamista uuden entryn ID:llä sivuvaikutuksena. Puuttuva rekisteri käsitellään ennen sen nykyistä empty-oletusta. |
| `update/workspaceFirstStartMigrationRegistryTransitions.ts` ja nykyiset recovery-/replacement-lukijat | Ennen/jälkeen-rekisterin versio ja tiiviste kuuluvat samaan hyväksyttyyn siirtymään. V1:n rollback-näyttö ja muiden entryjen säilyminen eivät katoa v2:n mukana. |
| `runtime/workspaceColdRecoveryAdmissionComposition.ts` ja nykyinen käynnistyksen omistaja | Poiston slot-admission ennen business-avausta ja geneeristä registry-korjausta. Vanhat create/import- ja C/K-palautussopimukset säilyvät. |

Inventaarion lähdekatselmus vahvisti erillisen kohdesidonnan tarpeen:
onnistunut legacy-adoptio poistaa journalinsa mutta säilyttää alkuperäisen
lähteen, ja palautuksen rollback voi säilyttää failed/staging-aineiston
journalin poistuttua. Yhteinen sijainti tai operationId ei tämän jälkeen
todista yritystä. **Omistaja hyväksyi 25.10.2026 nykyisen aineisto-omistajan
pienen pysyvän kohdesidonnan suunnittelun ja synteettisen kokeen.**
Sidonnan pitää säilyä aineiston eliniän ajan myös operaation journalin
poistuttua. Tämä ei vielä hyväksy tuotantokytkentää tai vanhan
tunnistamattoman aineiston jälkikäteistä kohdentamista. Kohteettoman tuonnin
ennakkotarkistuksen väliaineistoa ei
sidota aktiiviseen yritykseen arvaamalla. Vanhan tunnistamattoman jäännöksen
poisto ei sisälly aiemmin sallittuun backup-yhteensopivuuden rajaukseen.

##### Pysyvä yritysvalinta ja versioraja

**W7-P1, suunta hyväksytty 24.10.2026:** rekisteri v2 nykyisen
rekisteritallennuksen samoissa current/next/backup-sloteissa.
`activeWorkspaceId: null` tarkoittaisi
tarkoituksellista yritysvalintaa myös silloin, kun muita `ready`-yrityksiä
on olemassa. Entryjen nykyiset identiteetit ja tilat, 64 entryn raja sekä
64 KiB:n lukuraja säilyisivät. Erillistä valinta-asetusta ei lisätä:
kahden tiedoston erilliset päätökset voisivat palautua keskenään ristiriitaan.
Yrityksen `recoveryRequired` ei tarkoita käyttäjän valintatilaa.

**V2:n rajattu tallennusesitys:** juuren ainoat kentät ovat edelleen
`formatVersion`, `activeWorkspaceId` ja `workspaces`. Vain rekisterin
formaattiversio muuttuu; entryjen `workspaceId`, `workspaceLabel`,
`lineageIdentity`, `layoutVersion`, `lifecycleState` ja `createdAt` sekä
lineagen formaatti 1 säilyvät nykyisten validoijien omistamina. V2:n
ei-null-valinnan pitää edelleen osoittaa olemassa olevaan `ready`-entryyn.
Duplikaatti-ID, duplikaattilineage, ylimääräinen kenttä, epäkelpo UTF-8 ja
toistuva JSON-avain hylätään kuten nyt. Vanhat duplikaattinimet säilyvät
luettavina; uusien nimikaksoiskappaleiden esto kuuluu luonti-/tuonti-/
nimenmuutosomistajalle, ei historiallisen rekisterin hylkäykseksi.

Kanoninen v1-serialisointi säilyy tavuilleen, myös kenttäjärjestys ja
loppurivinvaihto. V2 käyttää samaa kenttäjärjestystä omalla versionumerollaan.
Puhdas v1 -> v2 -esitysmuunnos ei vaihda aktiivista yritystä tai entryjen
sisältöä. V2:n append ja rename säilyttävät null-valinnan; avaus on erillinen
nimenomainen valinta. Muuttumaton nimi palauttaa nykyisen saman registry-
olion, koska `WorkspaceLabelRename` käyttää tätä kirjoituksen ja `changed`-
tuloksen ehtona. Lisäys säilyttää nykyisen `WorkspaceRegistryMutationError`-
sopimuksen ja tarkistusjärjestyksen: `capacityExceeded`, `workspaceIdExists`,
sitten `lineageExists`. Kelvollisen rekisterin odotettua lisäysestoa ei
muuteta rekisterin rakennevirheeksi. Tuotannossa nämä vartijat sovitetaan
nykyisessä omistajassa molemmille versioille, ei erillisiksi kopioiksi.
Pelkkä `formatVersion: 1` -tekstihaku ei nimeä korvattavia
rekisterikirjoittajia: esimerkiksi lineage- ja switch-journal-versiot ovat
eri sopimuksia eikä niitä vaihdeta mekaanisesti.

**Hyväksynnän yhteensopivuusraja:** yritysrekisterin versio, business-
tietokannan schema ja siirrettävän `.ekybackup`-kopion formaatti ovat eri
asioita. Rekisteri v2 tai tiedostonimen muutos ei itsessään edellytä
backup-formaatin vaihtoa tai vanhojen kopioiden hylkäämistä.
Nykyinen tuettujen kopioiden palautus säilyy suunnittelun lähtökohtana.
Omistaja sallii tätä päätöstä edeltävän testivaiheen kopioiden tuen
rajaamisen, jos sen säilyttäminen osoittautuu kohtuuttoman raskaaksi.
Tämä ei ole yleinen lupa poistaa nykyistä tukea: konkreettinen poikkeus
nimeää formaatti-/schema-/build-alueen, osoitetun ylläpitorasitteen,
turvallisen käyttäjäpalautteen ja testit ennen vaikutusalueen toteutusta.
Mitään tällaista poikkeusta tai pois jätettävää versiota ei ole nyt valittu.

Tästä päätöksestä eteenpäin tuotettujen kelvollisten varmuuskopioiden
palautettavuus myöhempiin sovellusversioihin on pysyvä vaatimus myös
tietomallin muuttuessa. Raja ei ala vasta 0.3.0-julkaisusta. Yhteensopivuus
toteutetaan versionmukaisella validoinnilla ja hallituilla migraatioilla,
ei tuntemattoman tai vioittuneen sisällön hyväksymisellä. Päivityksen
epäonnistumisen rollback-todennus säilyy erillisenä pakollisena porttina;
historiallisten testikopioiden mahdollinen rajaus ei vapauta siitä.
Pelkkä W7-P1 ei hyväksy tuotantokytkentää; sen ehdot ovat W7-P4:ssä.
Historiallisten migraatioiden muuttamista tai testien poistamista ei hyväksytä.

- V1 luetaan edelleen omilla ehdoillaan. V2:ta ei palauteta v1:ksi eikä
  kirjoiteta erilliseen rinnakkaiseen rekisteriin, josta vanha ohjelma voisi
  huomaamatta avata poistetun kohteen. Vanha v1-lukija hylkää v2:n.
- Muunnos tehdään vain nykyisellä hyväksytyllä buildilla, tuoreen
  installation-varauksen alla ja ilman ratkaisemattomia muita operaatioita.
  Sitä ei tehdä uuden buildin hyväksymättömässä first-start-/rollback-vaiheessa.
  Rekisterin kaikki palautusslotit sovitetaan ennen ensimmäistä W7-siirtoa;
  vanha v1-backup ei saa palauttaa poistettua entryä.
- Jokainen registry-kirjoittaja säilyttää valitun formaatin. Create/import,
  rename, switch, recovery ja W6 käyvät läpi versionmukaisen portin; nykyistä
  kovakoodattua `formatVersion: 1` -kirjoitusta ei jätetä rinnalle.
- Puuttuva rekisteri ei tarkoita tyhjää rekisteriä. Löytyvät workspace-,
  quarantine- tai operaatiotiedot estävät ensiasennuksen/adoption arvaamisen.
  V2:n tarkoituksellinen tyhjä tila säilyy restartissa ilman oletusyritystä.
  Aidon ensiasennuksen R030-06-päätöstä ei tehdä tämän kautta.

**V2-esityksen pieni koe (25.10.2026):** 41 erillistä kohdetapausta ja
tiukka tyyppitarkistus läpäisivät yksityisellä codec-/mutaationäytteellä.
V1:n kanoniset tavut ja tiivisteet säilyivät; v2:n null-valinta, empty-tila,
entryt ja aiemmat hylkäysrajat todennettiin. Nykyinen byte-slot-tallennus
julkaisi eristettyyn samaan tiedostopolkuun versionmukaiset tavut, jotka
uusi lukija tunnisti; vanha lukija hylkäsi ne muuttamatta sisältöä.
Naapuritiedoston tavut säilyivät. Kutsujakartoituksessa havaittu ehdokkaan
rename-no-op-puute toistettiin molemmille versioille ja korjattiin.
Katselmuksessa havaittu lisäyksen syykoodipuute toistettiin ja korjattiin;
v1/v2-vertailut säilyttävät myös törmäysvartijoiden järjestyksen.
Tavurajan näyttö erottaa kelvollisen JSON:n täsmälleen 64 KiB:n kohdalla
samasta kelvollisesta arvosta yhden tavun rajan yläpuolella.
Rajattu riippumaton katselmus ja korjausten jälkitarkistus valmistuivat;
tämän codec-/mutaationäytteen rajauksessa ei jäänyt avoimia löydöksiä.
Tuotantokoodi ei muuttunut. Tuotannon yhteinen entry-validointi toteutetaan
nykyisessä omistajassa kerran, ei erillisinä v1/v2-kopioina.

Tämä koe ei anna muunnos- tai poistovaltuutta eikä todenna kaikkien
slottien yhteistä admissionia, accepted-build/registry-siirtymää, oikeaa
restartia tai create/import/switch/W6-koordinaattorien kytkentää.
Rekisterin empty-arvon säilyminen ei yksin todista, ettei startup luo
oletusyritystä. Samoin nimikaksoiskappaleen eston ja vanhojen backupien
oikeat käyttäjäpolut sekä rollback tarvitsevat erilliset kytkentätestinsä.

Nykyinen `resolveActiveWorkspaceStartup` palauttaa aktiivisen työtilan,
ja `workspaceSwitchStartup` vaatii ei-null-lähteen. Ehdotettu tulos erottaa
`business`, `selector` ja `recoveryRequired` -haarat. Selector ei luo
backend-sessionia, actor-kontekstia, brokeria tai tietokantaa. Sama mainin
hallintakyvykkyys näyttää luotettavan listan ja sallii erikseen validoidut
luonnin, tuonnin, valinnan ja poiston. Puuttuvaa lifecycle-omistajaa ei
korvata aina onnistuvalla mockilla tai no-op-sululla.

Valitsimesta avaus tarvitsee nykyiseen switch-omistajaan versionmukaisen
`source = null` -sopimuksen: epäonnistunut kohteen hyväksyntä palaa valitsimeen,
ei toiseen yritykseen. Vanhojen switch-journalien lähdepalautus säilyy.
Create/import ei valitsimessa valitse vanhaa yritystä sivuvaikutuksena;
uuden kohteen avaus vaatii saman käyttäjätoimen nimenomaisen avausvalinnan.
V1:n nykyinen käyttäytyminen ei muutu hiljaisesti.

##### Valitsimesta avauksen pysyvä jatko

**25.10.2026, rajattu sopimusehdokas:** nykyinen
`workspaceSwitchJournal.ts` omistaa molemmat versiot samoissa
`workspace-switch-v1.json`-sloteissa. V1:n ei-null-lähde, kanoniset tavut ja
palautuminen säilyvät. V2 on vain valitsimesta aloitettu avaus; sen
`sourceWorkspaceId` on aina null. Uutta aktivointijournalia ei lisätä.

V2:n täsmälliset kentät ovat `formatVersion: 2`, `operationId`,
`sourceWorkspaceId: null`, `targetWorkspaceId`, `state`, `createdAt`,
`registryBeforeSha256`, `registrySelectedSha256` ja `registryRejectedSha256`.
Nykyiset UUID-, aika-, UTF-8-, duplikaattiavain-, kanonisten tavujen ja
4 KiB:n rajat säilyvät. Tiloina ovat nykyiset `prepared`, `targetSelected`,
`rollbackSelected` ja `recoveryRequired`. Identiteetti ja tiivisteet ovat
operaation aikana muuttumattomia; vain nykyinen monotoninen tilasiirtymä
sallitaan. Versiota ei vaihdeta keskeneräisen operaation aikana.

Kolme tiivistettä sitovat koko kanonisen v2-rekisterin: alkuperäinen
null-valinta ja ready-kohde, saman kohteen valinta sekä null-valinta, jossa
vain kohde on merkitty `recoveryRequired`-tilaan. Kaikkien muiden entryjen,
nimien ja lineagejen on säilyttävä täsmälleen. Viimeinen muoto sallitaan
vain todistetun kohdevirheen palautuksessa; tavallinen käynnistysvirhe ei
yksin muuta yrityksen sisältötilaa. Tiiviste ei todista business-tavuja,
runtime-sulkua tai käyttöoikeutta eikä korvaa C/K/W6-portteja.

| Journal ja rekisterin valittu tila | Nykyisen switch-omistajan jatko |
| --- | --- |
| `prepared`, alkuperäinen null-valinta | Avausta ei ole julkaistu. Palaa valitsimeen; journal voidaan poistaa vasta tuoreen omistajuus- ja poissaolotodisteen jälkeen. |
| `prepared`, kohde valittu | Viimeistele saman operaation `targetSelected`-kirjaus ja sen readback ennen kohteen tarkistusketjua. |
| `targetSelected`, kohde valittu | Nykyiset build-, recovery-, schema-, migraatio-, lineage-, sisältö- ja health-portit; ei business-UI:ta ennen niiden hyväksyntää. |
| `targetSelected`, null-valinta alkuperäisenä tai todistetulla kohdevirheellä | Keskeytynyt paluu: viimeistele `rollbackSelected`, älä aloita uutta kohdeavausta. |
| `rollbackSelected`, vastaava null-valinta | Palaa valitsimeen ja päätä vain tämä operaatio nykyisten sulku-/slot-porttien jälkeen. Muita yrityksiä ei avata. |
| `recoveryRequired` | Epäselvää sulkua, valintaa tai sisäkkäistä palautusta ei ratkaista avaamalla yritys. Aineisto säilyy nykyiselle recovery-omistajalle. |
| Muu yhdistelmä tai muuttunut rekisterisisältö | Suljettu virhe; ei registry-kirjoitusta, journalin siivousta tai automaattivalintaa. |

Kaikki journalin ja rekisterin slotit luetaan sivuvaikutuksitta ennen
geneeristä korjaavaa lukijaa. Current on ensisijainen, muuten backup.
Current+next vaatii sallitun etenevän siirtymän; current+backup vaatii
backupista currentiin sallitun siirtymän. Backup+next palautuu backupiin
vain saman operaation sallittuna välitilana. Kaikkien kolmen yhtäaikainen
esiintyminen, ristiriitainen identiteetti, väärä järjestys tai tuntematon
sisältö estää korjauksen. Rekisterislotit saavat vastata vain sidottuja
alku-, valinta- ja hylkäysmuotoja; sallitut kirjoitussuunnat ovat alku ->
valinta ja valinta -> alku/hylkäys sekä saman muodon toisto.

Myös omistajien **yhteinen julkaisujärjestys** tarkistetaan: `targetSelected`
ei saa olla edes nextissä ennen puhtaaksi todettua kohdevalintaa, eikä
`rollbackSelected` ennen puhtaaksi todettua null-palautusta. Alku -> valinta
-rekisterikirjoitus vaatii journalin `prepared`-tilan; valinta -> alku
vaatii `prepared`- tai `targetSelected`-tilan ja valinta -> hylkäys vain
`targetSelected`-tilan. Molempien omistajien keskeneräisiä slot-julkaisuja
ei soviteta toisistaan riippumatta. Ristiriita säilytetään ennen yhtäkään
geneerisen lukijan tekemää next-/backup-poistoa.

Pelkkä journalin initial-next `prepared` ja muuttumaton current-rekisteri
on **julkaisematon valmistelu**, ei avausvaltuus. Sitä ei syötetä lukijaan,
joka nostaisi nextin currentiksi. Sen täsmällinen siivous vaatii saman
operaation, tuoreen omistajuuden ja poissaolon. Registry-next yksin ei
riitä tähän polkuun. Hyväksytyn slot-palautuksen jälkeen kummankin
omistajan valitut tavut tarkistetaan uudelleen ennen seuraavaa vaikutusta.
Näiden vartijoiden on tuotannossa oltava nykyisen tallennusomistajan
kirjoitus-/poistorajoissa, ei kerran tehty ulkopuolinen ennakkotarkistus.

`MainOwnedActiveWorkspaceLifecycle` hylkää nykyisin null-lähteen.
Sen olemassa olevaa aktiivisen yrityksen instanssia ei kutsuta nullilla
eikä korvata aina onnistuvalla adapterilla. Mainin nykyinen lifecycle-
composition erottaa valitsimessa todistetusti puuttuvan runtimen
epävarmasti suljetusta runtimesta. Valitsinavaus käyttää samaa installation-
varausta sekä olemassa olevia prosessi-, secret-, arkisto- ja
capability-omistajia poissaolon todentamiseen.

Kohteen epäonnistuessa sen kaikki kirjoittajat ja tarkistusprosessit sekä
sisäkkäinen C/K/W6-palautus päätetään ennen null-valinnan julkaisua.
Julkaise null ensin, sitten `rollbackSelected`; kadonnut kuittaus ratkaistaan
täsmällisistä säilyneistä tavuista. Epävarma exit ei anna valitsimen uusia
kirjoituskyvykkyyksiä. Onnistuneessa avauksessa journal poistuu vasta saman
generationin ja kohde-lineagen nykyisen business-valmiustodisteen jälkeen.
Uudelleenkäynnistys ei peri muistissa ollutta health-tulosta.

**Rajattu koe ja katselmus:** 47 yksityisen codec-/tilamallin tapausta sekä
33 nykyistä v1-journalin ja startupin regressiota läpäisivät; tiukka
tyyppitarkistus läpäisi. Oikea nykyinen byte-slot-tallennin ja eristetyt
tiedostot todensivat valinta-/paluu-keskeytyksiä, kadonneen kuittauksen,
tuoreen lukijan ja sallittujen journal-slottien palautuksen. Rekisterin
slot-yhdistelmät ja business-/exit-portit olivat mallinnettuja, eivät
todellisen käynnistysketjun todiste. Muuttuneet identiteetit ja ristiriitaiset
slotit säilyivät hylkäyksessä. Katselmuksen yhteisen julkaisujärjestyksen
aukko toistettiin kahdella epäonnistuvalla tapauksella ja korjattiin vain
ehdokkaaseen; jälkikatselmus ei jättänyt tämän rajauksen löydöksiä.
Tämä ei todenna native-exitiä, fyysistä restartia, sähkökatkokestävyyttä,
todellista business-hyväksyntää tai kaikkien tuotantokutsujien kytkentää.
Tuotannon kirjoitus-/clear-vartijat ja v2-registryä käyttävät vanhat
ei-null-vaihdot tarvitsevat vielä W7.1-W7.5:n omat integraatiotestit.

**Tuotannon lukurajan osatodennus:** switch-journalin yhteinen codec säilyttää
v1:n kanoniset tavut ja lisää versionmukaisen v2-lukijan. Nykyisen tallentimen
`inspectSlots` sekä journalin ja rekisterin yhteinen puhdas tilaluokitus
eivät korjaa tai poista tiedostoja. Pysyvät testit kattavat todelliset
keskeytysslotit, väärän yhteisen julkaisujärjestyksen ja aineiston säilymisen;
vaikutusalueen 931 testiä 30 tiedostossa sekä desktopin tyyppitarkistus
läpäisivät. Rajattu riippumaton katselmus ei jättänyt korjattavaa löydöstä.
Tämä lukurajan näyttö ei vielä todentanut valittujen tavujen,
tiedostoidentiteetin ja tuoreen valtuuden sidontaa tallennusmuutoksiin
tai startupiin. Se ei ole native-/paketoidun ketjun eikä koko W7.2:n hyväksyntä.

**Valitun tallennusoperaation rajaus:** nykyisen byte-slot-tallentimen
nimetyt `replaceSelected`, `recoverSelected` ja `clearSelected` käyttävät
kopioituja odotettuja tavuja ja samasta lukukahvasta havaittuja
tiedostoidentiteettejä. Saman sisältöinen eri tiedosto ei ole sama valinta.
Uuden nextin identiteetti sidotaan omaan kirjoituskahvaan; omassa renamessa
säilyvät inode ja sisältö tarkistetaan ennen valinnan päivittämistä.
Omistajan valtuus ja muiden omistajien tarkka valinta tarkistetaan
uudelleen operaation sisällä. Näiden metodien valinta ei yksin anna
business-, sulku- tai registry-muunnosvaltuutta.

Switch-omistajan v2-kirjoitus tarkistaa version, etenemisen ja yhteisen
julkaisujärjestyksen. Loppusiivous vaatii lisäksi current-only-rekisterin,
uuden readbackin sekä saman operaation ajantasaisen paluu- tai
business-hyväksyntätodisteen. `recoveryRequired` ei anna automaattista
korjaus- tai siivousvaltuutta. Virheessä suljetaan oma kirjoituskahva,
mutta säilytetään keskeytysslotit; kadonnut kuittaus ei käynnistä
automaattista vanhan arvon palauttamista. V1:n vanhat metodit säilyvät.
Näiden vartijoiden todelliset startup-/lifecycle-kutsujat ovat edelleen
erillinen keskeneräinen tuotantokytkentä, eivät tämän tallennusrajauksen näyttö.

`FirstStartUpdateCoordinator` hyväksyy nykyisin buildin backendin ja
aktiivisen profiilin tarkistuksen jälkeen. Valitsimen avaamista ei saa
ilmoittaa onnistuneeksi business-health-tarkistukseksi. V2:n jälkeisen
päivityksen ja nollan työtilan first-start tarvitsee saman omistajan
nimenomaisen selector-haaran, tarkat build-/registry-/journal-tarkistukset
ja oman installer-todennuksen. Mukaan kuuluu myös **ensimmäinen W7-päivitys
v1-rekisteristä, jossa yrityksiä on mutta yhtään ei voida avata**.
Buildin hyväksynnän ja rekisterimuunnoksen järjestys on ratkaistava myös
siinä ilman business-DB:n avaamista: ne eivät saa jäädä odottamaan toisiaan
tai vaatia DB:n korjaamista poiston edellytyksenä. Tämä on W7-P3:n avoin
yhteensopivuusraja, ei lupa keventää C:n päivityksen hyväksyntää tai avata
yritystä automaattisesti.

**First-startin rajattu lähdekatselmus:** `preWorkspaceBuildAdmission`
erottaa käynnistettäväksi sallitun uuden buildin jo hyväksytystä buildista.
`FirstStartUpdateCoordinator.acceptAfterBackendReady` vaatii nykyisin
migration-gaten ja aktiiviprofiilin tarkistuksen ennen accepted-buildin
kirjoitusta. `WorkspaceFirstStartMigrationOrchestrator` ei tee uutta
W6-inventaariota `exactAcceptedBuild`-haarassa. Nykyinen
`AcceptedBuildMetadata` ei erottele selector- ja business-hyväksyntää.
Pelkkä saman metadatan kirjoitus backendittomasta haarasta olisi siten
liian laaja hyväksyntä, ei valmis W7-ratkaisu.

Jatkosopimus erottaa käynnistysadmissionin, valitsimen valmiuden ja
business-valmiuden samoissa nykyisissä omistajissa. Strictisti luettu v1
voi palvella aluksi vain lukevaa, vielä hyväksymätöntä valitsinta ilman
rekisterimuunnosta tai yritysavausta. Selector-hyväksynnän pysyvä esitys,
sen kaikki lukijat ja myöhemmän yritysavauksen portit on täsmennettävä ja
todennettava ennen accepted-build-kirjoituksen muutosta. Vasta hyväksytty
haara voi siirtyä v2-muunnokseen; ehdotus ei vielä anna kirjoitusvaltuutta.

**Vanhan avoimen päivitysoperaation raja säilyy:** nykyinen
`UpdateBusinessRollbackCoordinator` vaatii tarkistetun business-tilan
ennen `businessRollbackCompleted`-tilaa, ja binary-rollback vaatii tämän
tilan. Vanhassa update-journalissa ei ole yleistä business-tavujen
muuttumattomuustodistetta. Epäonnistuva C-/direct-Setup-/W6-palautus ei
muutu selector-hyväksynnäksi tai automaattisesti valmiiksi rollbackiksi.
Sen aineisto ja recovery-tila säilyvät. Jos tätä vanhaa operaatiota pitäisi
päättää ilman nykyistä business-todistetta, tarvitaan nimetty vaihtoehtoinen
sopimus ja omistajan päätös; sitä ei ole tällä suunnalla hyväksytty.

**Nykyisten omistajien rajakoe:** 18 synteettistä tapausta ja niiden
tyyppitarkistus läpäisivät. Kokeessa käytettiin nykyisiä admission-,
first-start-, W6- ja switch-omistajia sekä oikeita eristettyjä accepted-build-,
registry- ja update-journal-tiedostoja. Direct Setup ja koordinoitu
`awaitingFirstStart` erotettiin toisistaan. Pelkät recovery-entryt eivät
nykyisin avaudu switch-startupin kautta. Virheellinen aktiivisen työtilan
inventaario tai profiilin hylkäys säilyttivät v1-rekisterin ja lähdebuildin
hyväksynnän; koordinoitu virhe kirjasi nykyisen `rollbackRequired`-tilan.
Vain hyväksynnän onnistunut kontrolli kirjoitti kohdebuildin metadatan.
Uusi lukija havaitsi sen myös ennen mitään v2-rekisterimuunnosta.
Onnistuvan W6-inventaarion vastakontrollit kulkivat samat kaksi reittiä;
hylkäys vaati plannerin alkuperäisen syyn eikä mitä tahansa poikkeusta.
Rajattu riippumaton katselmus ja huomautusten jälkitarkistus tehtiin.

Erillinen kielteisen suunnitteluvaihtoehdon kontrolli kirjoitti nykyisen
accepted-build-metadatan ilman business-tarkistusta ja osoitti, ettei W6
sen jälkeen edes kutsunut virheellistä inventaariota palauttavaa testiporttia.
Tämä ei ole korjaus tai nykyisen normaalipolun haavoittuvuuslöydös, vaan
todiste siitä, ettei uutta selector-haaraa saa toteuttaa samalla merkinnällä.
Vanha metadata-parseri torjui sekä uuden lisäkentän että pelkän
formaattinumeron vaihdon. Nykyinen accepted-build-tallentimen `read()` voi
myös siivota palautusslotteja: sitä ei nimetä sivuvaikutuksettomaksi
tarkastusportiksi.

Koe ei käynnistänyt Electronia, SQLitea tai asentajaa. Profiilin ja
paketticachen tarkistukset olivat nimenomaisia testiportteja; tulos ei
todista DB-terveyttä, cache-sisältöä tai runtime-sessionin puuttumista.
Uusi omistaja samassa prosessissa ei ole oikea restart-/sähkökatkokoe.
Kokeessa ei toteutettu uutta metadataa, selector-hyväksyntää tai v2-muunnosta.

First-start-jatkon nykyisiin omistajiin rajattu lukija-/kirjoittajakartta:

| Nykyinen omistaja | W7:n täsmennys ja säilyvä ehto |
| --- | --- |
| `update/preWorkspaceBuildAdmission.ts` | Käynnistyslupa erotetaan hyväksynnän laajuudesta. Samaversioisen eri revision, downgradin ja ristiriitaisen päivitysidentiteetin torjunta säilyy. |
| `update/acceptedBuildMetadata.ts`, `acceptedBuildMetadataStore.ts` ja `migrateLegacyLocalUpdateState.ts` | Yksi versionmukainen auktoritatiivinen tallennus, ei rinnakkaista aina onnistuvaa selector-lippua. V1:n merkitys säilyy; uuden esityksen slot-admission, luku/kirjoitus, keskeytys ja legacy-siirto todennetaan erikseen. |
| `update/firstStartUpdateCoordinator.ts` | Valitsimen hyväksyntä ei kutsu business-hyväksyntää tekaistulla profiililla. Myöhempi oikea yritysavaus säilyttää migration-, profiili-, secret-identity- ja palautuspisteportit. |
| `workspaces/update/workspaceFirstStartMigrationOrchestrator.ts` ja `workspaceFirstStartMigrationTransitionCoordinator.ts` | Selector-merkintä ei saa ohittaa tarvittavaa inventaariota, päätellä W6:n kohdetta hyväksytyksi tai poistaa avointa W6-journalia. Viimeinen business-validoitu lähde on erotettava pelkästä käynnissä olevan binäärin identiteetistä. |
| `update/preBackendFirstStartFailureAuthority.ts` ja nykyiset business-/binary-rollback-omistajat | Vanhat avoimet C- ja direct-Setup-operaatiot säilyttävät nykyisen palautusauktoriteetin. Tuntematonta business-vaikutusta ei nimetä muuttumattomaksi. |
| `main/desktopComposition.ts` ja nykyinen workspace-startup/switch | Valitsin palautetaan ennen backend-sessionin ja business-runtimen luontia. Yritysavaus tarvitsee edelleen omat health-, identiteetti-, sisältö- ja session-tarkistuksensa. |
| `main/packagedSmoke.ts` sekä nykyiset workspace-success/fault- ja legacy-hyväksyntälukijat | Valitsimen näyttö ei täytä niiden nykyistä business-hyväksyntää. Versio ja hyväksynnän laajuus tarkistetaan ennen success-luokitusta; historiallisten pakettien erilliset lukurajat säilyvät. |

**Hyväksynnän laajuuden koeehdotus:** saman accepted-build-tallennuksen
versionmukainen lukija erottaa `selector`- ja `business`-hyväksynnän.
Ehdotettu v2 sisältää vain `formatVersion`, `acceptanceScope`,
`acceptedBuild` ja `businessBaseline`. Kaksi viimeistä käyttävät nykyisen
v1:n validoitua build-identiteetin, kanavan ja hyväksymisajan syntaksia;
selectorin kohdalla tämä syntaksi ei itsessään todista business-terveyttä.
V1 säilyy merkitykseltään business-hyväksyntänä. Business-v2:ssa molemmat
arvot ovat samat; selector-v2:ssa baseline on aidosti vanhempi
business-hyväksytty build. Useat selector-päivitykset säilyttävät tämän
lähtöversion, eivät korvaa sitä viimeksi käynnistetyllä binäärillä.
Samaversioinen eri revisio, taaksepäin siirtyminen, puuttuva baseline ja
ristiriitainen laajuus hylätään. Hyväksymisaika säilyy historiatietona,
ei kellonkorjauksille herkkänä version järjestysehtona. Ehdokas ei ratkaise
R030-06:n ensiasennusta.

Tämä on **koeehdotus, ei uusi tuotantoformaatti tai kirjoitusvaltuus**.
Valitsimen hyväksyntää lukevat admission ja registry-muunnos erotetaan
business-lukijoista. W6:n inventaario saa viimeisen business-lähteen;
W6-journalin lopetus/recovery ja business-hyväksyntätestit vaativat nykyisen
kohdebuildin nimenomaisen business-hyväksynnän. Pelkkä revision täsmääminen
ei riitä. Myöhempi yritysavaus ei saa keksiä vanhan runtime-hyväksynnän
perusteella migration-, profiili- tai secret-identity-todistetta.

**Koenäyttö:** erilliset 22 tapausta ja tyyppitarkistus läpäisivät.
Pieni lukuehdokas säilytti v1:n merkityksen ja baselinen kahden
selector-päivityksen yli sekä torjui ristiriitaiset arvot ja liian laajan
business-lukupyynnön. Nykyinen byte-slot-tallennus kirjoitti oikeaan
eristettyyn tiedostoon ehdokkaan, jonka uusi lukija tunnisti ennen mitään
registry-muutosta; alkuperäiset registry- ja sivukohteen tavut säilyivät.
Julkaisematon `.next` ei laajentanut nykyisen slotin hyväksyntää.
Nykyinen W6-omistaja kutsui inventaariota erillisen business-projektion
kautta sekä hyväksyvässä että hylkäävässä kontrollissa. Väärä runtime-revisio
ei saa tätä jatkohakuvaltuutta eikä putoa tarkistuksen ohittavaan haaraan.
Rajattu riippumaton katselmus ei jättänyt ehdokkaaseen avoimia löydöksiä.

Koe ei kytkenyt uutta admissionia, W6-recoverya tai metadata-kirjoittajaa
tuotantoon. Se ei osoita kaikkien slottien yhteistä admissionia,
rekisteri-v2:n muunnosta, rollbackia, oikeaa prosessin keskeytystä tai
käynnistystä. W6:n kontrollit eivät vielä todista pending-migraation
lähtöidentiteetin käyttöä tai business-hyväksynnän kirjoittamista.
Ehdokkaan muodostus ei luokittele avoimia journaleja eikä
anna ohittaa vanhaa palautusta. Varsinkin nykyinen updater luo
palautuspisteen aktiivisesta yritysprofiilista; sitä ei voi käyttää
backendittomaan päivitykseen tekaistulla profiililla.

**Julkaisu- ja keskeytyssopimuksen täsmennys 25.10.2026:**
metadata ja registry ovat erilliset tallennukset, eivät yhteinen atominen
commit. Seuraava järjestys on W7.0:n koesopimus, ei tuotantovaltuus:

1. Nykyinen installation-omistaja todistaa varauksen ja kirjoittajien
   poissaolon. Versionmukainen tarkastus lukee molempien tallennusten kaikki
   slotit sekä vanhat sijainnit ennen korjaavaa lukua tai legacy-siirtoa.
   Myös nykyiset C-, Direct Setup-, W6- ja workspace-journalit luokitellaan
   niiden omistajissa. Puuttuva tai ristiriitainen tila ei ole tyhjä asennus.
2. Uusi build saa ensin nykyisen käynnistysadmissionin. Valitsimen readiness
   todennetaan ilman yritys-DB:n avausta; v1-rekisteri voi tässä vaiheessa
   palvella vain lukevaa, vielä hyväksymätöntä valitsinta. Muunnoksen
   sisältö validoidaan etukäteen muuttamatta rekisteriä.
3. First-start-omistaja julkaisee täsmällisen selector-hyväksynnän ja lukee
   sen takaisin. Vanha business-baseline säilyy. Julkaisun jälkeinen
   siivousvirhe ei tarkoita, ettei hyväksyntää olisi kirjoitettu.
4. Vasta julkaistu hyväksyntä sallii v1 -> v2 -rekisterimuunnoksen. Entryt
   ja nykyinen aktiivivalinta säilyvät; muunnos ei samalla poista yritystä,
   valitse toista yritystä tai korjaa vikatilaista tietokantaa. Jo v2:ta
   käyttävä selector-päivitys ei tarvitse uutta rekisterikirjoitusta.
5. W7:n varsinaiset hallintamutaatiot avautuvat vasta yhteisen tilan
   readbackin jälkeen. Yrityksen avaaminen kulkee edelleen omat W6-,
   migration-, health-, sisältö- ja session-porttinsa.

| Keskeytystila | Vaadittu käsittely |
| --- | --- |
| Lähdemetadata currentissa ja kohde vain nextissä | Kohdetta ei merkitä hyväksytyksi. Lähteen täsmälliset metadata- ja registry-tavut säilyvät palautusvertailuun. |
| Current puuttuu, lähde backupissa; next on poissa tai täsmällinen kohde | Kaikki slotit validoidaan ennen lähteen palauttamista. Kiinni otetun kirjoitusvirheen `finally` voi poistaa nextin. Vierasta backupia ei hyväksytä lähteeksi eikä next yksin laajenna hyväksyntää. |
| Kohdemetadata currentissa, registry vielä lähdeversiossa | Jo hyväksytyn kohteen jatkaminen rekisterimuunnokseen on erillinen palautumispiste. Vanhan binaarin lukukelpoisuutta ei luvata, koska jo metadata-v2 on vanhalle parserille tuntematon. |
| Kohdemetadata ja registry-v2 julkaistu | Täsmällinen readback ja sallittu palautusslottien loppusiivous ennen hallintamutaatiota. Ei v2 -> v1 -muunnosta tai rinnakkaista vanhaa rekisteriä. |
| Virheellinen, vieras tai selittämättömästi muuttunut slotti | Ei automaattista korjausta tai poistoa; aineisto ja turvallinen estotila säilyvät. |

**Rollback-raja:** ennen selector-hyväksynnän julkaisua lähdetallennukset
säilytetään; binaaripalautus kuuluu nykyiseen asenninporttiin. Julkaistun
selector-hyväksynnän jälkeen tapahtuva registry-virhe on kohdebuildin
kesken jäänyt jatko, ei todiste valmiista rollbackista. Paluu jo hyväksytyn
buildin taakse olisi erillinen downgrade-sopimus, jota W7-P1 tai
manual-installer-päätös eivät hyväksyneet. Uusi haara ei kirjoita
olematonta business-palautuspistettä tai `businessRollbackCompleted`-tilaa.
Tämä ei poista ennen hyväksyntää epäonnistuneen päivityksen nykyistä
rollback-todennusvaatimusta.

**Rajattu tiedostonäyttö:** 20 tapausta ja tyyppitarkistus läpäisivät.
Oikeilla eristetyillä sloteilla muodostettiin nimetyt kirjoitusjärjestyksen
keskeytyskohdat. Uusi lukija erotti julkaisemattoman lähteen, hyväksytyn
selectorin keskeneräisen rekisterimuunnoksen ja valmiin tiedostoparin.
Vieraan registryn, väärän julkaisujärjestyksen, virheellisen sivuslotin ja
viimeisessä luvussa menetetyn valtuuden torjunta säilytti kaikki tavut.
Toistuva selector-päivitys säilytti business-baselinen ja tyhjän v2-rekisterin;
avaamattoman yrityksen sentineli ei muuttunut. Koe ei käynnistänyt uutta
prosessia, toteuttanut palautustoimia tai todistanut sähkökatkokestävyyttä,
asentajaa, journal-admissionia tai business-terveyttä.
Riippumattoman katselmuksen löytämä liian aikaisen registry-valmistelun
aukko toistettiin kahdella kielteisellä tapauksella ja korjattiin ehdokkaaseen.
Myös next-kirjoitus ja currentin siirto ennen metadatahyväksyntää torjutaan;
katselmuksen jälkitarkistukseen ei jäänyt avoimia löydöksiä tällä rajauksella.

**Kirjoittajan jatkokoe:** 10 uutta tapausta ja yllä olevat 20 regressiota
läpäisivät samassa ajossa; tyyppitarkistus läpäisi. Kokeessa ajettiin
`AcceptedBuildMetadataStore`-omistajan oikeat kirjoitus-, virhe- ja
palautushaarat. Vain sen v2-codec korvattiin yksityisellä ehdokkaalla;
kirjoittajaa ei korvattu stubilla. Virhe aiheutettiin lähdesiirron ja
julkaisusiirron ympärille, backupin poistoon ja lähteen palautusyritykseen.
Uusi tallennin luki ja palautti todelliset tavut, ja toinen luku säilyi
muuttumattomana. Vain currentissa hyväksytty selector salli registry-
muunnoksen jatkamisen; business-baseline ja avaamattoman yrityksen tavut
säilyivät. Erillinen byte-store-koe toisti backup-only-tilan ja sen
palautuksen. Luokitteluehdokasta täydennettiin tälle täsmälliselle lähteelle;
vieraan backupin torjunta säilyi. Ensimmäisten kokeiden tavuvertailun ja
lähdemetadatan kenttäjärjestyksen virheet korjattiin fixtureihin.

Kiinni otettu virhe suoritti nykyiset `catch/finally`-haarat. Tämä ei ole
prosessin tappamisen, sähkökatkon, installerin tai Linux-hakemistosynkronoinnin
todistus. Byte-store ja metadatatallennin eivät palauta backupia kaikissa
samoissa virhekohdissa, joten heitetty poikkeus ei ole julkaisun tilatodiste.
Yhteinen journal-admission ja valintaan sidottu clear eivät sisälly tähän
kirjoittajakokeeseen, eivätkä v2-tuotantocodecit muutu tällä kokeella.
Rajattu riippumaton katselmus ei jättänyt löydöksiä tähän deltaan;
katselmus ei itse ajanut testejä tai laajentanut niiden näyttörajaa.

**Terminal- ja legacy-admissionin lähteeseen perustuva sopimus:** nykyinen
`migrateLegacyLocalUpdateState` kutsuu korjaavia lukuja ennen admissionia.
`accepted`-C-journal puolestaan edellyttää metadatan vastaavan omaa
kohdebuildiaan. Siksi vanha journal käsitellään **ennen** uuden selector-
hyväksynnän kirjoitusta, ei vasta seuraavan sisäisen päivityksen alussa.
Alla kuvattu rajattu admission-/clear-koe täydentää suunniteltua kytkentää;
tuotannon kirjoittajia tai käynnistysjärjestystä se ei vielä muuta.

Seuraavan taulukon A tarkoittaa ennen uutta julkaisua hyväksyttyä
**sovellusbuildia**, ei selector-metadatan vanhempaa business-baselinea.
S ja T ovat vanhan journalin lähde- ja kohdebuildit. Vastaavuus sisältää
version, revision ja validoidun kanavan; pelkkä versionumero ei riitä.

| Vanhan C-journalin tila | Ehto ennen terminal-journalin siistintää |
| --- | --- |
| `accepted` | A = T. Nykyinen FirstStart julkaisee tämän vasta cache-rotaation varmennuksen ja accepted-metadatan jälkeen. |
| `installerNotApplied` | A = S. Nykyisen omistajan lähdebuildin, migration-prefixin ja profiilin hyväksyntää ei korvata selector-readinessilla. |
| `rolledBack` | A = S. Pelkkä rollbackin aloitus tai aikaisempi T-metadatan hyväksyntä ei riitä; lähdemetadata kirjoitetaan ennen tätä terminalia. |
| `failed`, muut avoimet tilat tai ristiriitaiset slotit | Nykyisen recovery-omistajan ratkaistavaksi. Handoffin korvattavien tilojen lista ei ole startupin terminal-lista. `handoffAttemptCount: 0` ei yksin todista valtuuden vapautumista. |

Kaikissa kolmessa ratkaistussa tilassa vaaditaan tuore installation-
valtuus, kirjoittajien poissaolo, täsmällinen journal-valinta ja muiden
palautusomistajien konfliktittomuus. Avoimia C-/Direct Setup-/W6-operaatioita
ei päätetä valitsimessa eikä niiden palautuspisteitä poisteta.

1. `createInstallationUpdateState`-kytkentä tarkastaa nykyisen ja legacy-
   sijainnin kaikki metadata-/journal-slotit sekä registryn ennen nykyisiä
   korjaavia lukuja. `readOnlyJournalSlots` tarjoaa lukumallin, ei itsessään
   yhteistä hyväksyntää tai identiteettitodistetta.
2. `migrateLegacyLocalUpdateState` säilyy sijaintimuunnoksen omistajana.
   Pelkkä legacy-arvo kopioidaan nykyiseen sijaintiin ja luetaan takaisin
   ennen legacy-poistoa. Kahdessa sijainnissa olevien validoitujen arvojen
   pitää vastata kokonaan, myös `acceptedAt`-kentän. Selector-baseline ei
   tee eri metadata-arvoista yhtäläisiä. Epäselvä keskeytysyhdistelmä säilyy.
   Myös legacy-metadatan clear tarvitsee valitun arvon ja tuoreen valtuuden
   tarkistuksen; journalin suojattu clear ei yksin suojaa metadata-poistoa.
3. `UpdateJournalStore` tarvitsee nykyisen valintaan sidotun kirjoituksen
   tapaan täsmälliseen valintaan ja tuoreeseen valtuuteen sidotun clearin.
   Nykyistä ehdotonta `clear()`-kutsua ei käytetä uuden haaran poistovaltuutena.
   Molempien journal-sijaintien poissaolo ja lähdemetadatan säilyminen
   todennetaan ennen selector-julkaisua. Osittainen clear ei anna lupaa
   ohittaa uutta tai muuttunutta journalia. Legacy-arvon poisto vaatii
   täsmällisen kopion nykyisessä sijainnissa; ainoaa lähdearvoa ei poisteta.
   Epäonnistuneen siivouskuittauksen jälkeinen poissaolo ei yksin todista
   valmistumista: nykyisen tiedosto-omistajan synkronointiraja ja yhteinen
   readback tehdään ennen julkaisua. Varmasti puuttuvaa vanhaa hakemistoa
   ei luoda synkronointia varten; olemassa olevan hakemiston virhettä ei
   ohiteta. Näistä ei johdeta uutta fyysisen sähkökatkokestävyyden lupausta.
4. Journalin siistintä ei poista palautuspisteitä tai cache-paketteja eikä
   merkitse manuaalista pakettia cacheen hyväksytyksi. Kolmen ratkaistun
   terminalin journal-perusteinen palautuspistesuoja on jo nykyisin päättynyt;
   muiden omistajien suojat ja artifactien oma elinkaari säilyvät.

Nykyiset FirstStart-, admission-, store- ja legacy-muunnosomistajat riittävät
suunnitelluksi vastuujaoksi; uutta koordinaattoria tai journalia ei lisätä.
Valintaan sidottu clear kuuluu nykyisen store-omistajan serialisoituun
operaatioon ja installation-varaukseen, ei ulkoiseen ennakkotarkistukseen
ja sen jälkeen kutsuttavaan ehdottomaan `clear()`-metodiin.

**Rajattu terminal-/legacy-näyttö:** 53 tapausta ja tyyppitarkistus
läpäisivät. Oikea
`migrateLegacyLocalUpdateState` sekä nykyiset v1-metadata-/journal-tallentimet
toimivat yksityisten admission- ja clear-ehdokkaiden takana. Nykyinen,
legacy- ja kahden yhtäläisen sijainnin lähtö todennettiin kolmelle yllä
nimetylle terminalille. Kaikki slotit tarkistettiin ennen korjaavia lukuja;
sivuslotit, avoin tila, ristiriita, väärä hyväksytty build tai muuttunut
`acceptedAt` estivät jatkon säilyttäen tavut. V2-metadatan lukukontrolli
käytti sovellusbuildia, ei vanhempaa business-baselinea.

Koe kattoi valinnan muutoksen, aikaisen ja viimeisen luvun yli menetetyn
valtuuden, kopion kadonneen kuittauksen ja osittaisen legacy-siivouksen.
Uusi admission saattoi jatkaa täsmällistä osittaista muunnosta; uusi journal
tai jatkuva synkronointivirhe esti julkaisun esiportin. Registry ja rajatut
säilytettävät koetavut eivät muuttuneet. Katselmuksen löytämä puuttuvan
legacy-hakemiston yhteensopivuuspuute toistettiin ja korjattiin ehdokkaaseen.

Varaus, kirjoittajien poissaolo ja muiden recovery-omistajien konfliktit
olivat injektoituja ehtoja. Koe ei todista atomista tiedostojärjestelmän
snapshotia, native-poistumista, v2:n varsinaista legacy-muunnosta, kaikkien
recovery-slottien korjausta tai esiportin tuotantokytkentää selector-
julkaisuun. Sivuslotit palautuvat nykyiselle recovery-omistajalle, eivät
muutu hylättäviksi backup-formaateiksi. Synkronointivirhe oli injektoitu;
hakemiston puuttumiskontrolli ei ole erillisen käyttöjärjestelmän ajotodiste.
Asentajan ja tuotannon rollback-ketjun hyväksyntä säilyy erillisenä.
Rajattu riippumaton katselmus ja korjauksen jälkitarkistus valmistuivat
ilman tämän koedeltan avoimia löydöksiä; katselmointi ei itse ajanut testejä.

**Omistajan hyväksymä rajaus 25.10.2026:** ensimmäisessä W7-toteutuksessa
yrityksettömän tilan päivitys käyttää tavallista asennuspakettia. Nykyinen
sovelluksen sisäinen päivitys säilyy avatun yrityksen kautta; valitsimesta
ei käynnistetä uutta sisäistä päivitys-/rollback-haaraa ilman yrityksen
palautuspistettä. Manuaalisen päivityksen hyväksynnän, vanhojen kopioiden
ja rollback-yhteensopivuuden todennus säilyy pakollisena. Rajaus ei muuta
muita W7-P3:n toimintoja eikä ole vielä toteutus- tai installer-näyttö.

**Päivitys koskee koko EKY-asennusta:** yksi päivitys vaihtaa yhteisen
sovellusversion ja ominaisuudet kaikille asennukseen rekisteröidyille
yrityksille riippumatta siitä, mikä yritys oli avoinna. Yrityksiä ei
päivitetä erillisiksi ohjelmaversioiksi, eikä tämä luo uutta käyttäjätiliin
sidottua asennusmallia. Yrityskohtainen tietokantamuunnos on eri vaihe:
nykyinen W6/W6A.3 inventoi historiat, muuntaa tarvittaessa aktiivisen
työtilan ja käsittelee passiivisen `compatiblePending`-työtilan sen
ensimmäisellä hallitulla avauksella ennen business-käyttöä. W7:n
valitsinhyväksyntä ei saa ohittaa tätä myöhempää tarkistusta tai väittää
avaamattomien yritysten tietokantoja jo muunnetuiksi. Sama raja on
todennettava myös usean yrityksen ja toistuvien valitsintilassa tehtyjen
päivitysten kokeissa.

##### Vahvistus, sulku ja poistettava kokonaisuus

Main omistaa kohteen: validoitu `workspaceId`, täsmällinen registry-entry,
lineage, odotettu label, installation-juuri ja saman operaation varaus.
Rendererin kirjoittama nimi tai polku ei ole poistolupa. Pyyntö hyväksytään
vain nykyisen sallitun ikkunan/frame-generationin kautta. Native-vahvistus
näyttää juuri tämän kohteen; vanhentunut nimi/entry/session hylkää pyynnön.
Vanhojen nimikaksoiskappaleiden erotin on mainin antama turvallinen
workspace-tunniste, ei polku, business-ID tai sähköpostiosoite.

Backup-todiste kuuluu samaan pysäytettyyn kirjoitus-/snapshot-rajaan.
Pelkkä tuoreen näköinen päivämäärä tai sama lineage ei riitä. Käyttäjän
valitsema kopio tarkistetaan K:n kautta; jos vastaavuutta poistettavaan
aineistoon ei voida todistaa, se ei korvaa erillistä menetyshyväksyntää.
Vikatila ei pakota avaamaan SQLitea backupin tekemiseksi. Backupin
peruutus/virhe ei muuta vahvistusvalintaa automaattisesti.

Nykyiset maintenance-lease ja installation-reservation pysyvät omistajina.
Uusi työ estetään ennen sulkua; backendin todellinen exit, brokerien,
secret-I/O:n ja PDF-arkistoinnin päättyminen todistetaan erikseen. D2:n
nykyinen sulkubudjetti ja epävarmuussääntö säilyvät. Vanhalla prosessilla
oleva tai kadonnut varaus estää tiedostomuutokset, vaikka ikkuna olisi kiinni.
Mainissa tapahtuva työ ei pääty backendin exitin perusteella.

**W7-P3, passiivisen poiston käyttökatko hyväksytty 24.10.2026:** käytetään
samaa nykyistä installation-varausta ja pysäytetään senhetkinen business-runtime
tiedostovaiheen ajaksi. Vain sama aiempi yritys voidaan käynnistää uudelleen
onnistuneen poiston ja normaalien startup-porttien jälkeen. Aktiivisen
kohteen poisto päätyy aina valitsimeen. Virhe tai epävarma sulku ei anna
lupaa palata business-käyttöön. Käyttäytyminen on hyväksytty, ei vielä toteutettu.

| Omistettu aineisto | Poiston raja ja nykyinen omistaja |
| --- | --- |
| SQLiten tiedostot, auktoritatiiviset PDF:t ja business-audit | `desktopProfilePaths` ja workspace-polkuportti. Poisto ei suorita business-kyselyitä, korjaa skeemaa tai migroi vikatilaista tietokantaa. Omistetun juuren ja sen sisältötyyppien tarkistus säilyy. |
| SMTP ja sisäinen PDF-arkistoinnin tila | `encryptedSecretFile` current/next/backup sekä nykyisen arkisto-omistajan asetus/journal. I/O päättyy ensin; mitään ei viedä talteen. Ulkoista PDF-kansiota tai sen yritysalikansiota ei poisteta. |
| Palautuspisteet ja palautuksen väliaineisto | `profileSnapshotRuntimePaths`, `RecoveryPointStore` ja restore-omistaja. Myös ennen indeksijulkaisua syntyneet containerit/nextit, avainkuoret palautusslotteineen, rotation-journal ja clean-shutdown-tila kuuluvat inventaarioon. Nykyinen `list/remove` ei yksin riitä: indeksistä puuttuvan artifactin poisto voi palautua tekemättä mitään. |
| Staging, quarantine ja rollback | Työtilan `private-backup-staging`, `private-backup-quarantine`, `profile-restore-rollback`, `failed-profile-restores` ja `profile-backup-state` ovat eri rooleja. Koko omistettu sisäinen PDF-juuri sisältää myös katalogittomat orvot; backup-katalogi ei ole täydellinen poistoluettelo. |
| Työtilan ulkopuoliset operaatiokopiot | `workspaceBackupReplacementPaths` johtaa yhteiset import-/activation-staging-/rollback-/failed-juuret; import-quarantine on myös yhteinen. `resolveProfileInspectionCopyRoot` johtaa tarkistuskopion varausjuuren sisareksi. Nykyinen nimi/sijainti ei yksin todista kohdetta; koko yhteistä juurta tai `profile-inspection-*`-globin osumia ei poisteta. |
| Adoption alkuperäinen lähde | `workspaceLegacyAdoptionRootStore` säilyttää vanhan runtime-lähteen ja startup poistaa onnistuneen adoption journalin. Vanhan ja nykyisen sisällön vertailu ei tavallisten muutosten jälkeen todista omistajaa. Koko vanhaa runtime-juurta ei poisteta, koska siinä voi olla installation-update-tilaa. |
| Säilyvät kohteet | Muiden yritysten kaikki sisältö, käyttäjän vientibackupit ja ulkoiset PDF:t. Installation-lokit, tukipaketit ja update-paketit säilyvät omien retention-sopimustensa mukaan. |

Pelkkä vikatila ei estä poistoa, mutta epäluotettava rekisteri tai
moniselitteinen tiedosto-omistajuus estää arvaamisen. Käynnissä oleva muu
operaatio estää kilpailevan poiston. Omistaja hyväksyi 24.10.2026 kohteen
oman keskeytyneen palautuksen korvaamisen lopullisella poistolla vain
todistetulle kohteelle ja kaikkien kirjoittajien päätyttyä. Tämä tarvitsee
nykyiseen omistajaan erillisen, täsmällisen
admission-haaran: kaikkien sen kirjoittajien poissaolo ja kaikkien
omistettujen jäännösten kohdesidonta todennetaan ilman DB:n avaamista.
Jaettua W6-/update-/adoption-journalia ei poisteta kohdekohtaisena sivutiedostona.

**Inventaarion avoin toteutusportti:** vanhan adoption lähteelle sekä
workspace-juuren ulkopuolisille keskeytyskopioille ei ole lähdeluvussa
todistettu kaikissa historiallisissa tiloissa riittävää pysyvää sidontaa.
Myöskään nykyinen `ProfileRestoreActivationJournal` ei sisällä workspaceId:tä
tai lineagea; pelkkä operationId ei täytä rajaa. Näitä ei merkitä valmiiksi
kirjoittamalla suunnitelmaan yleinen "siivoa jäämät". Pieni inventaariokoe
selvittää nykyisten todisteiden riittävyyden ja 25.10.2026 hyväksytty
suunnittelu-/koevaihe täsmentää uuden pysyvän sidonnan. Tuotantokytkentä
odottaa katselmoitua sopimusta ja näyttöä; historiallista poikkeusta ei
ole hyväksytty.
Tuntemattoman omistajan tiedosto säilytetään näkyvänä keskeneräisen poiston
esteenä, ei piilotettuna varmuuskopiona tai onnistuneen poiston jäännöksenä.

##### Palautusjäännösten kohdesidonnan rajattu koesopimus

**Suunnittelu ja koe hyväksytty 25.10.2026, ei tuotantokytkentää.**
Ensimmäinen koe rajataan nykyisen same-lineage-korvauksen omistajaan.
Muuttumaton tekninen kirjaus sisältää version, nimetyn omistajan,
operaation tunnisteen, workspaceId:n ja nykyisen lineagen. Ei polkua,
nimeä, salasanaa tai business-sisältöä. Tämä ei ole aktivoinnin toinen
tilakone: nykyinen activation-journal ratkaisee edelleen palautuksen
vaiheen ja W7:n oma journal lopullisen poiston valtuuden.

| Raja | Suunniteltu vastuu |
| --- | --- |
| Julkaisu | `WorkspaceBackupReplacementCoordinator` johtaa kohteen uudelleen validoidusta registrystä ja autentikoidun backupin lineagesta saman leasen alla. Kohdesidonnan julkaisu ja täsmällinen readback edeltävät `prepareCandidate`- ja `stageBackup`-kirjoituksia. Puuttuva tai epävarma kuittaus estää jatkon. |
| Tallennus | Nykyisen replacement-omistajan oma operaatiokohtainen pieni metadata, erillään poistettavista payload-juurista. Nykyinen `CrashSafeByteSlotStore`; ei globaalia jäännösrekisteriä. Uusi operaatio ei ylikirjoita vanhaa sidontaa. Kokeen formaatti ja tavuraja eivät vielä lukitse tuotantoesitystä. |
| Lukeminen | Kaikki current/next/backup-slotit luetaan muuttamatta niitä ja verrataan täsmälliseen kohteeseen. Initial-next ei ole julkaistu sidonta. Ristiriita tai tuntematon muoto ei oikeuta siivoukseen. |
| Elinikä | Sidonta ei katoa activation-journalin terminal-siistinnässä, jos staging/failed/rollback-aineistoa on vielä olemassa. Sitä saa poistaa vasta nykyisen omistajan todettua kaikki kyseisen operaation aineistot poissa oleviksi tuoreella valtuudella. Pelkkä indeksistä tai journalista puuttuminen ei riitä. |
| Poistokuluttaja | Polut johdetaan `workspaceBackupReplacementPaths`-omistajalla. Sidonta rajaa kohteen, mutta ei korvaa tuoretta juuri-/tiedostoidentiteettiä, linkki-/containment-tarkistuksia, kaikkien kirjoittajien poistumistodistetta tai W7:n purge-valtuutta. Sidonnan lukutulos ei ole välimuistiin säilytettävä poistolupa. |
| Backup ja yhteensopivuus | Konekohtainen metadata ei kuulu portable backupiin eikä sitä palauteta toisesta asennuksesta. Backup-formaatit ja sisältövalidoinnit säilyvät. Vanhaa tunnistamatonta aineistoa ei hyväksytä jälkikäteen uuden metadatan näköiseksi. |

Pieni koe todentaa oikeilla slottitavuilla julkaisun ennen synteettistä
payloadia, journalin poiston jälkeisen lukemisen, vieraan kohteen ja
ristiriitaisten slottien hylkäyksen sekä katkenneen kirjoituksen ja
menetetyn valtuuden käsittelyn. Kaikki koeaineisto säilytetään; mitään
asennettua yritystä ei käsitellä. Koe ei vielä todista tuotannon
recovery-kytkentää, todellista prosessivarausta, jäännösten poistamista tai
fyysistä sähkökatkokestävyyttä.

**Rajattu näyttö 25.10.2026:** 33 synteettistä tapausta ja tyyppitarkistus
läpäisivät. Oikea activation-journalin tallennin tyhjennettiin ja sidonta
luettiin uudella lukijaoliolla; failed-koetavut säilyivät. Väärä työtila,
lineage ja operaatio, ristiriitaiset tai katkenneet slotit, julkaisematon
next, menetetty kuittaus ja myöhäinen valtuuden menetys katettiin.
Rajattu riippumaton katselmus ei jättänyt avoimia löydöksiä tässä kokeessa.
Ensiajon kaksi tavusäiliöiden vertailuvirhettä korjattiin testiin; kyse ei
ollut todetusta sovellusviasta. Näyttö ei laajenna yllä nimettyjä rajoja.

Ennen W7.0:n sulkemista sama raja täsmennetään adoption alkuperäiselle
lähteelle, aktivointimigraatiolle sekä import-/inspection-omistajille.
Kohteeton tuonnin ennakkotarkistus pysyy kohteettomana. Vanhan runtime-
juuren installation-update-tilaa ei muuteta yrityksen aineistoksi.
Näitä muita omistajia tai kaikkien jäännösten inventaariota ei merkitä
todennetuiksi ensimmäisen replacement-kokeen perusteella.

Nykykoodin mukaiset seuraavat kytkentäkohdat pidetään erillään:

| Omistaja | Sidonnan syntyhetki ja vielä todentamaton raja |
| --- | --- |
| Same-lineage-korvaus | Kohde ja autentikoitu lineage ovat tiedossa ennen `prepareCandidate`-kutsua. Ensimmäinen koe koskee tämän metadatan julkaisua ja säilymistä, ei tuotannon kutsukytkentää. |
| `WorkspaceActivationMigrationCoordinator` | Guardin target-proof sisältää kohteen, profileId:n sekä registry-/switch-journal-tavut. Kohdesidonta julkaistaan tuoreen `reprove`-tarkistuksen ja leasen alla ennen `createAndStage`-vaihetta, ei vasta candidate-kirjoituksessa. Snapshot syntyy nykyisin ennen kohteen startup-runtimen pysäyttämistä; tätä järjestystä ei muuteta replacementin mukaiseksi. Candidate ja swap edellyttävät edelleen todettua pysähtymistä. PreMigration-piste ja sen staging pysyvät recovery-point-omistajalla. Epäselvä stop tai sidontakirjoitus estää cleanupin ja relaunchin. Rajattu kutsujakoe on tehty; oikeat recovery-point-/root-/prosessiportit eivät sisälly siihen. |
| `resolveWorkspaceLegacyAdoptionStartup` | Alkujournal nimeää operaation ja workspaceId:n; hyväksytty lineage saadaan `accept(profileId)`-vaiheessa. Legacy-lähteen sidonta julkaistaan ja luetaan takaisin ennen candidate-loppusiivousta ja journalin poistoa. Keskeytyksen jälkeinen täsmälleen sama sidonta voidaan todentaa, ei korvata uudella. `fresh`-adoptio ei keksi vanhaa yrityslähdettä. Poiston laajuus on root-omistajan nykyinen yrityssisällön sallintalista, ei koko runtime-juuri. |
| `WorkspaceBackupImportCoordinator` | Autentikoitu source-lineage tiedetään ennen uuden workspaceId:n varaamista. Vasta uuden kohteen varauksen jälkeen sen sidonta voidaan julkaista ennen `createCandidate`/`stageBackup`-vaiheita. Journalin `lineageIdentity: null` ei tarkoita aktiivisen yrityksen lineagea eikä vielä todista validoitua candidatea. Epävarman sidontatuloksen pitää estää myös `ensurePreviousWorkspaceRunning`, ei vain candidate-siistintä. Ennen kohteen varaamista syntyvä plaintext kuuluu `WorkspaceBackupPlaintextQuarantine`-omistajalle. Saman quarantine-omistajan myöhempi staging-käyttö ei oikeuta koko jaetun juuren siirtoa W7:lle. |
| `runOwnedProfileInspection` | Kopio kuuluu generationiin sidottuun prosessivaraukseen. Kohteen tunteva kutsuja vahvistaa operaation, generationin ja täsmällisen työtilan ennen tyhjän kopiojuuren luontia. Muuttumaton pysyvä sidonta liittää tähän alkuperäisen juuri-identiteetin ennen lapsen tiedostokirjoituksia; session-salaisuutta ei tallenneta. Kohteeton tarkistus pysyy kohteettomana. Alla oleva rajattu koe käsittelee tämän sidonnan lukua, ei tuotannon kylmäpoistoa tai native-poistumistodistetta. |

**Muiden omistajien osanäyttö:** yhdeksän uutta tapausta läpäisi samassa
ajossa muuttuneen sidontaehdokkaan 33 regression kanssa; nämä eivät ole
42 uutta tuotantotestiä. Adoptiokoe käytti oikeaa startup-, root-, registry-
ja journal-toteutusta sekä erillistä tulevan kytkentäkohdan testiporttia.
Sidonta säilyi journalin tyhjentämisen yli. Menetetty valtuus, väärä lineage,
julkaisematon next ja vieras sidonta estivät loppusiivouksen; keskeytys
julkaistun sidonnan jälkeen voitiin jatkaa samalla sidonnalla.
Vanhan lähteen, installation-tilan ja ulkoisen kopion koetavut säilyivät.
Tuonnin nykyinen koordinaattori erotti kohteettoman preflightin uudesta
työtilasta ja hylkäsi virheellisen preflightin ilman uuden journalin kirjoitusta.
Tyyppitarkistus läpäisi. Ensimmäisten koetarkistusten kenttänimivirheet
korjattiin koetiedostoon, ei sovellukseen.
Rajattu riippumaton katselmus ja kommentin täsmennyksen jälkitarkistus
valmistuivat ilman avoimia löydöksiä kokeen rajauksessa. Tarkistus ennen
terminal-clearia ei kata adoption `accept()`-kutsun aiempia korjaavia lukuja.

Koe ei todista adoption koko lähdeinventaarion myöhempää omistajuutta,
kaikkien registry-slottien admissionia, oikeaa SQLite-sisältöä, mainin
I/O:n tai prosessien päättymistä, fyysistä restartia tai purgea.
Tämän ensimmäisen import-kokeen testiadapterit eivät todistaneet uuden
pysyvän sidonnan julkaisua; seuraava kutsujakoe täydentää tätä rajaa.
Jaetun tarkistus-/quarantine-juuren tyhjentämistä ei korvata W7:n
rekursiivisella poistolla: nykyinen omistaja sulkee työn ja käsittelee oman
aineistonsa, tai epävarma aineisto estää valmistumisen. Historiallista
sidontaa ei rakenneta jälkikäteen aktiivisen yrityksen tai samankaltaisten
DB-/PDF-tavujen perusteella.

**Migraation ja tuonnin kutsujakoe:** 14 uutta tapausta ja muuttuneen
sidontaehdokkaan 42 aiempaa tapausta läpäisivät samassa ajossa. Tyyppitarkistus
läpäisi. Oikeat koordinaattorit ja migraation guard sekä oikeat sidontatavut
yhdistettiin rajattuihin testiportteihin. Kokeessa sidonta julkaistiin ennen
migraation snapshotia ja tuonnin candidatea, ja uusi lukija löysi sen
journalin poiston jälkeen. Menetetty kuittaus, menetetty valtuus, epäselvä
stop sekä snapshotin jälkeen muuttunut kohde estivät vaarallisen jatkon.
Tunnettu snapshot-/staging-virhe säilytti nykyisen palautumisreitin.
Katselmuksessa havaittu binding-I/O:n yli jäänyt tuoreuskatkos toistettiin
kahdella kielteisellä tapauksella ja korjattiin koeehdokkaaseen: varaus
ja kohde tarkistetaan uudelleen myös sidontaluvun/-kirjoituksen jälkeen
ennen seuraavaa vaikutusta. Tuonnin journal-epävarmuus johdetaan kokeessa
kirjoituskutsun aloittamisesta ja kuittauksesta, ei testivariantin nimestä.
Rajattu riippumaton katselmus ja näiden korjausten jälkitarkistus valmistuivat
ilman kokeen rajaukseen jääneitä löydöksiä.

Tuonnin kontrolli osoitti, että pelkkä `discardCandidate`-virhe ei nykyisin
estä aiemman yrityksen uudelleenavausta. Tämä ei yksin ole nykyisen tuonnin
vika: uusi epävarma sidontatulos tarvitsee oman haaransa **nykyiseen
koordinaattoriin ja lifecycle-kutsuun**. Kokeen ehdokas esti avauksen tämän
rajapinnan kohdalla. Binding-/journal-kirjoituksen epäselvyyttä ei päätellä
vaikutuksettomaksi vain siksi, ettei candidate-kutsua ehditty aloittaa.
Vaikutuksettomuus todennetaan sloteista, operaatiokohteesta ja aineiston
poissaolosta; muuten journal ja sidonta säilyvät recoverya varten.

Kokeen prosessi-, payload- ja recovery-portit olivat testikaksoisia;
se ei todista niiden fyysistä siivousta, SQLitea, native-poistumista tai
kylmäkäynnistystä. Sidonta- ja snapshot-sentinelien tavut todennettiin,
eikä koetiedostoja poistettu virheissä. Tuotantoon ei lisätty uutta
tilanomistajaa, manageria tai tallennusformaattia.

**Tarkistuskopion sidontasopimus:** nykyinen
`WorkspaceCandidateInspectionCopy` säilyttää luodun juuren ja sen vanhemman
identiteetit vain muistissa. Uusi olio samassa polussa ei siksi saa poistaa
kansiota. Tätä suojaa ei poisteta tai korvata pelkällä operationId:llä.

1. Nimetty kutsuja vahvistaa kohteen nykyisellä varauksella.
   `runOwnedProfileInspection` säilyttää nykyisen prepare/grant/exit-järjestyksen.
   Sen valmistelukutsussa nykyinen kopio-omistaja luo tyhjän juuren ja antaa
   **omista alkuperäisistä luontitiedoistaan** rajatun, muuttumattoman
   juuri-/vanhempi-identiteetin. Myöhempi polun stat ei korvaa tätä todistetta.
2. Operaation ja generationin oma metadata julkaistaan nykyisellä
   byte-slot-mekanismilla kopiojuuren ulkopuolelle. Kentät ovat versio,
   nimetty inspection-omistaja, operaatio, generation, workspaceId, lineage
   sekä juuri- ja vanhempi-identiteetti. Polkua, runtimeSession-salaisuutta,
   sisältöä tai purge-valtuutta ei tallenneta. Tallennus käyttää samaa
   sidonnan rajattua metadataa, ei toista palautuksen tilakonetta.
3. Julkaisu vaatii alkuperäisten identiteettien tuoreen vastaavuuden ja
   tyhjän kopion. Onnistunut readback sekä tuore kohde-/varausvarmennus
   edeltävät grantia ja lapsen ensimmäistä kopiotavua. Epävarma kuittaus
   estää jatkon, vaikka current olisi ehtinyt syntyä. Tyhjän juuren luonnin
   ja sidonnan julkaisun välinen katkos ei oikeuta myöhempää arvaavaa
   omaksumista; tunnistamaton juuri säilyy näkyvänä selvitystarpeena.
4. Kylmäluenta tarkistaa kaikki slotit muuttamatta niitä, täsmällisen
   kohteen ja generationin sekä luotetusta omistajasta johdetun polun
   nykyiset juuri-identiteetit. Pelkkä initial-next, vieras slotti,
   vaihtunut juuri/vanhempi tai epävarma kirjoittajien poissaolo estää jatkon.
   Tämä on inventaarion todiste, ei säilytettävä poistolupa. W7:n oma
   purge-valtuus, tuore inventaario ja kaikkien kirjoittajien todettu
   päättyminen vaaditaan edelleen ennen jokaista muuttavaa vaihetta.
5. Nykyinen onnistuneen ajon siivous säilyy. Sidontaa ei poisteta ennen
   kuin nykyinen omistaja on todentanut kopion ja sen töiden loppumisen.
   Kohteetonta ennakkotarkistusta ei sidota aktiiviseen yritykseen.
   Konekohtainen sidonta ei kuulu portable backupiin eikä tukipakettiin.

**Rajattu inspection-näyttö:** 26 uutta tapausta ja yhteisen sidonta-apurin
33 regressiota läpäisivät samassa ajossa; tyyppitarkistus läpäisi.
Oikea kopio-omistaja ja tiedostoslotit yhdistettiin synteettiseen
luontitodisteeseen sekä injektoituihin varaus-/poistumishavaintoihin.
Uusi lukija varmisti sidonnan, mutta nykyisen kopio-luokan uusi olio ei
saanut sen perusteella poistaa tiedostoja. Saman ajon nykyinen siivous
toimi, ja muiden yritysten koetavut säilyivät. Koeehdokkaan luonti-/julkaisuvälin
identiteettiaukko toistettiin ja korjattiin vaatimalla alkuperäinen
luontitodiste. Ensimmäisen koefixture-valmistelun ja tyypityksen virheet
korjattiin kokeeseen, ei sovelluksen turvarajoihin.
Koe ei vielä toteuta luontitodisteen tuotantoporttia, native-sulkua,
fyysistä uudelleenkäynnistystä tai W7:n kylmäpurgea. Niitä ei lasketa
valmiiksi tämän osanäytön perusteella.
Rajattu riippumaton katselmus ja luontikuitin täsmennyksen jälkitarkistus
valmistuivat ilman tämän koerajauksen avoimia löydöksiä.

**Luontikuitin tuotantoportti 30.10.2026:** nykyinen kopio-omistaja tarjoaa
nyt onnistuneesta omasta luonnistaan muuttumattoman juuri-/vanhempi-
identiteetin. Muunnos käyttää prosessivarauksen nykyistä keskitettyä
identiteettiesitystä; myöhempi polun stat ei korvaa tallennettua kuittia.
Readonly-tyhjyystarkistus varmentaa saman omistajan, alkuperäiset identiteetit
ja tyhjän kansion myös viimeisen luetteloluvun ja polkutarkistuksen jälkeen.
Vanhentunut valtuus, keskeytys tai samanniminen korvaava juuri estää jatkon
säilyttäen aineiston. Kuitti poistuu muistista oman onnistuneen siivouksen
jälkeen eikä anna uudelle oliolle poistolupaa.

Sama päättyminen koskee alkuperäistä oliota: onnistuneesti poistettu kopio
ei anna sen myöhemmälle `discard`- tai `discardAfterExit`-kutsulle oikeutta
käsitellä samaan polkuun myöhemmin syntynyttä sisältöä. Pelkkä juuri- ja
vanhempi-identiteetin vastaavuus ei korvaa päättyneen omistajan valtuutta.
Valmisteltu terminal-suoja kattaa myös jo odottavan kutsun; poissaolokuitti
säilyy vain nykyistä metadata-only-jatkoa varten, ei uutena poistovaltuutena.

Kahdessa erillisessä tiedostokokeessa toistetut luetteloluvun ja viimeisen
polkutarkistuksen vaihtumisvälit suljettiin uuteen readonly-porttiin.
Vanhan valmistelun ja siivouksen luku-/muutosjärjestys säilyy. Yhtenäinen
12 tiedoston sarja läpäisi 394 testiä, desktopin tyypitys ja rajattu
riippumaton katselmus läpäisivät. Tämä on tuotantoon tulevan kopioportin
tukiosa, ei vielä pysyvän inspection-sidonnan julkaisu tai native-/pakettinäyttö.

##### Tarkistuskopion kutsuja- ja vaihevaltuus

**30.10.2026, lähteestä tarkennettu toteutussopimus; kytkentä ja sen näyttö
ovat vielä kesken.** Tämä täsmentää yllä olevaa inspection-sopimusta, ei
muuta backup-formaattia, alkuperäisen aineiston puuttumisen käsittelyä tai
W7.4:n hyväksyntäportteja. Sidonta kuvaa tarkistustyön todistettua kohdetta,
ei todista vielä tarkistettavan sisällön eheyttä tai anna poistolupaa.

**Kohde ennen valmistelua.** `runOwnedProfileInspection` ja sen kolme
runneria saavat pakollisen mainin sisäisen valinnan: joko nimenomaisesti
kohteeton tai muuttumaton `workspaceId`/lineage sekä sen nykyinen
readonly-valtuustarkistus. Puuttuva argumentti ei tarkoita kohteetonta.
Sidotun valinnan tarkistusvirhe ei saa vaihtaa haaraa kohteettomaksi.
Kohdetta ei päätellä polusta, nimestä, migration-policysta, aktiivisen
profiilin tunnisteesta tai lapsen myöhemmästä tuloksesta. Valinta ei kulje
rendererille tai inspection-protokollaan; nykyinen sidontaformaatti säilyy.
Main antaa nykyisen sidontastoren käyttäjäasennuksen validoidusta juuresta;
inspection-operaation erillinen aineistojuuri ei korvaa tätä metadatajuurta.

| Nykyinen kutsuja | Kohteen lähde ja säilyvä raja |
| --- | --- |
| `ProfileSnapshotInspectionClient.createSnapshot` | Mainin jo valitun yrityksen varmennettu registry-entry ja nykyinen broker-/runtime-sukupolvi. Lähdesnapshotin alkuperä ja valinta talletetaan sen omaan muistikirjaukseen ennen snapshot-pyyntöä; pelkkä kirjauksen olemassaolo ei todista alkuperää. |
| Oman viennin tai palautuspisteen uudelleentarkistus | Lähteen nykyinen omistaja antaa samaan työhön rajatun validatorin, joka säilyttää lähteen todistetun valinnan ja eliniän. Uusi inspection-operation/generation säilyy erillisenä. Yleistä clientin kohdetta ei vaihdeta hetkeksi eikä ulkoista syötettä sidota vientipolun oletuksella. |
| Käyttäjän backupin inspect/staging ja `inspectOwnedEncryptedProfileBackup` | Nimenomaisesti kohteeton ennen todistettua kohdevalintaa. `profileMatchesActive` on sisältövertailu, ei yrityskohteen omistajuus. Myöhempi kohdistettu aktivointitarkistus voi käyttää omaa tuoretta valintaansa, ei muuttaa aiemman tarkistuksen sidontaa takautuvasti. |
| Mainin cold-forward, cold-original ja suljetun backendin rollback-original | `activeWorkspace.workspaceId` ja `registeredLineageIdentity` valitusta registry-entrystä, nykyisen palautusvaiheen valtuudella. `sourceWorkspaceId: null` ei tee valitsimessa valittua kohdetta tuntemattomaksi. Rollback käyttää todella valittua yritystä, ei sokeasti switch-journalin targetia. |
| Vanhan työtilan adoption ennen todistettua lineagea | Nimenomaisesti kohteeton. `assertCanAccept` tai palautusjournal ei tuota puuttuvaa registry-lineagea. Hyväksytyn adoption jälkeinen uusi työ saa kohteen vasta nykyisestä hyväksytystä Main-/registry-kontekstista; vanhaa tarkistusta ei sidota jälkikäteen. |

Main muodostaa cold-/original-valinnan molempiin nykyisiin
`createProfileRestore*ContentAdmission`-tehtaisiin; ne välittävät sen
runnerille. Tunnettu yrityskohde säilyy, vaikka original-DB puuttuu.
Tuntemattoman originalin lineagea ei lainata palautettavasta candidatesta;
nykyinen absent-tulos ja sisältövalidoinnin puuttuvan DB:n haara säilyvät.

Replacement käyttää jo kaapattua `workspaceRestoreSelection`-valintaa.
Tavallinen profile-restore käyttää valitun registry-entryn korjaamatonta
slot-lukua, alkuperäistä kohdetta sekä nykyisen journalin ja vaiheen
vartijoita. Se ei saa ottaa uutta maintenance-leasea valtuustarkistuksen
sisällä eikä kutsua sisältöadmissionia uudelleen sidontastoren vartijasta.
Valinnan lukija tarkistaa vain täsmälliset registry-/journal-havainnot;
fyysisen vaiheen tarkistus kuuluu sen ulommalle omistajalle.
Live-snapshotissa business-varauksen omistaa backend: sen
nykyinen generation/granted-valtuus ja kohdevalinta ovat eri asia kuin
inspection-operaation oma fyysinen varaus. Startup-vartijaa ei jatketa
huomaamatta tavallisen runtimen eliniäksi. Kohteen vaihtuminen kesken
työn hylkää työn; uusi luku ei vaihda kaapattua kohdetta.
Kohteen readonly-tarkistus ei kapseloi valmistelun fyysistä porttia,
työajan peruutusta, clientin uusien töiden admissionia tai päättynyttä
työdeadlinea. Julkaisu ja exitin jälkeinen siivous yhdistävät saman kohteen
omiin vaihevaltuuksiinsa. Siivous käyttää nykyistä siivousbudjettia ja
palautuneen varauksen fyysistä valtuutta. Lähteen valinnan kaappaus ei aloita uutta
rajaamatonta tiedostotyötä: inspectionin tuoreet luvut kuuluvat sen nykyiseen
työbudjettiin ja alkuperäisten tehtävien sulkuseurantaan.

**Nykyisen varausomistajan valmisteluportti.**
`acquireDesktopWorkspaceReservation.bind` saa nykyiseen callbackiin
kolmannen, async `assertPreparationOwned`-portin. Se tarkistaa saman
transferin, `preparing`-vaiheen, keskeneräisen valmistelun, saman pidetyn
varauksen, peruutuksen ja valtuuden ennen ja jälkeen alkuperäisen
varauksen `assertOwned`-luvun. Vanhentunut callback hylätään ennen
mahdollista nykyiseen omistajaan vaikuttavaa invalidointia. Portti ei
kuluta grantia eikä jää käyttökelpoiseksi valmistelun jälkeen.
Tavallinen `assertMainOwned` säilyy tiukkana: aktiivisen transferin aikana
se ei kelpaa tämän portin korvikkeeksi. Muiden bind-kutsujien toiminta
säilyy; ne eivät tarvitse uutta porttia, elleivät käytä sitä.

**Julkaisu ja todellinen työn päättyminen.** `runOwnedProfileInspection`
tekee nykyisen prepare-callbackin sisällä järjestyksessä kopion luonnin,
alkuperäisen luontikuitin tyhjyys-/identiteettitarkistuksen, sidonnan
julkaisun ja readbackin sekä tuoreen kohde-/valmisteluvaltuuden tarkistuksen.
Sidontastore käyttää juuri tämän vaiheen fyysistä valmisteluporttia.
Lapsen prepare/grant ja ensimmäinen kopiotavu seuraavat vasta tätä.
Kohteeton haara käyttää nykyistä kopio-/prosessipolkua ilman sidontaa.

Alkuperäinen publish-promise odotetaan callbackissa, ei vain siitä tehtyä
timeout-wrapperia. Nykyinen `profileInspectionProcess` seuraa valmistelun
ja grant-valtuutuksen alkuperäisiä tehtäviä sulussa. Julkaisun aloitus,
onnistunut täsmällinen kuitti, tehtävän päättyminen ja epävarma vaikutus
pidetään erillään. Kadonnut kuittaus säilyy epävarmana, vaikka current
näkyisi levyllä. Myöhäinen onnistuminen ei avaa peruttua työtä uudelleen.
Varausta ei mitätöidä pelkän sidontaepävarmuuden vuoksi ennen nykyisen
lapsen stop/exit/reclaim-yritystä; epävarmuus sulkee silti grantin ja
aineiston siivouksen. Aito varauksen menetys säilyttää nykyisen käsittelyn.

**Siivous ja lopputulos.** Ensin todetaan lapsen poistuminen, alkuperäisten
main-tehtävien päättyminen ja fyysisen varauksen palautuminen. Vain tunnettu
julkaisutulos ja nykyinen kopio-omistaja voivat sallia oman kopion poiston.
Sen jälkeen täsmällinen julkaistun sidonnan kuitti, kaikki slotit, saman
vanhemman identiteetti ja payloadin tuore poissaolo sallivat nykyisen
`clearAfterPayloadsAbsent`-metadataoperaation. Tämä vaihe ei enää vaadi
poistetun kopiojuuren olemassaoloa. Epävarma julkaisu, keskeneräinen
kirjoitus tai epävarma siivous säilyttää aineiston eikä anna ulommalle
snapshot-/staging-siivoukselle poistovaltaa. Ensivirhe säilyy erillään
sulkutuloksesta. Tulos hyväksytään vasta oman sulun jälkeen.

**Toteutusjärjestys ja pienet näyttöportit:**

1. Valmistelun fyysinen portti nykyiseen reservation-omistajaan ja tyyppeihin:
   oikea preparing-vaihe, menetetty varaus, keskeytys, readin yli muuttunut
   valtuus ja vanhan callbackin käyttö grantin/uuden omistajan aikana.
2. Pakollinen bound/unbound-valinta ja sidonnan elinkaari nykyiseen runneriin:
   oikeat slot-tavut ennen lapsen kirjoitusta, nykyinen onnistuva/kohteeton
   haara, kaikki julkaisukatkot sekä kopion ja metadatan erilliset siivouskatkot.
   Viivästetty alkuperäinen publish todistaa, ettei timeout/exit yksin salli
   reclaimia, ulompaa poistoa tai uuden generationin aloittamista.
   Tavallinen virhe-/close-kontrolli todistaa myös onnistuvan siivouksen,
   kun työ on todella päättynyt ja kohde, julkaisutulos sekä varaus ovat varmat.
3. Yllä nimetyt client-/Main-kutsujat nykyisillä elinkaarivartijoilla:
   lähteen ja vieraan backupin erottelu, vaihdettu kohde, source-null,
   original-absence, hyväksytty adoption sekä historialliset palautukset.
   Menetetty sidontakuittaus säilytetään myös ulomman virhepolun jälkeen.
4. Nykyisen Main-/inspection-/backend-fixturen oikea SQLite/prosessitodistus,
   pakotetun ensivirheen nykyinen salattu lukuketju ja rajattu riippumaton
   katselmus. Tämän jälkeen W7.4:n yhteiset paketti-/integraatioportit.

Valmistelu ja työn tarkistukset käyttävät nykyistä samaa 35 sekunnin
määräaikaa; siivous käyttää nykyisiä erillisiä sulkurajoja. Ei lisäaikaa,
uutta manageria, kirjoitinta, protokollaa, yleistä lokitusta tai uutta
palautuksen tilakonetta. Rajattu riippumaton lähdekatselmus ja sen sulkuvaltuuden
täsmennyksen jälkitarkistus valmistuivat ilman tämän sopimuksen avoimia löydöksiä.
Suunnitelma tai aiemmat kopioportin testit eivät korvaa näitä kytkentätodisteita.

**Valmisteluportin tukiosa toteutettu 30.10.2026:** nykyinen varausomistaja
tarjoaa fyysisen `assertPreparationOwned`-tarkistuksen samassa callbackissa.
Molemmat lainatut vartijat sulkeutuvat heti callbackin päätyttyä;
myöhäinen onnistuva tai epäonnistuva luku ei mitätöi seuraajaa.
Yhtenäinen 13 tiedoston sarja läpäisi 551 testiä nykyisillä aikarajoilla;
desktopin ja sen E2E-kutsujien tyyppitarkistukset läpäisivät.
Mukana oleva paikallisen IPC-varauksen koe käytti uutta fyysistä porttia
ja säilytti kilpailevan hankinnan eston sekä entisen siirto-/takaisinottopolun.
Rajattu riippumaton katselmus ja myöhäisen luvun testitäsmennyksen
jälkitarkistus valmistuivat ilman avoimia löydöksiä. Tämä ei vielä julkaise
inspection-sidontaa tai todista erillisen Electron-lapsen/paketin kytkentää.

**Poistetun kopion readonly-todiste:** saman kopio-omistajan
`assertRemovedCreationCurrent` toteaa oman onnistuneesti kuitatun poistonsa
jälkeen alkuperäisen vanhemman ja kopiojuuren tuoreen poissaolon.
Uusi olio, ulkopuolinen poisto tai kadonnut
poistokuittaus ei saa tätä valtuutta. Lukuvirhe ei ole poissaolo; tarkistus
ei poista tiedostoja. Viimeisen vanhempiluvun jälkeen tarkistetaan poissaolo
uudelleen. Oikeiden slot-tavujen ja julkaisukuitin yhteiskoe kattaa sekä
metadatan siivouksen että korvaavan kopion ja metadatan säilymisen.
Kymmenen tiedoston sarja läpäisi 355 testiä; yksi entinen POSIX-linkkitapaus
ei kuulu Windows-ajoon. Desktopin tyypitys ja rajattu riippumaton katselmus
sekä viimeisen lukuvälin täsmennyksen jälkitarkistus läpäisivät.
Tämä on sidonnan loppusiivouksen tukiosa,
ei vielä `runOwnedProfileInspection`-julkaisun tai prosessikytkennän näyttö.

**Kutsujakytkennän toteutustila 30.10.2026:** kesken oleva toteutus vaatii
runnerilta nimenomaisen bound/unbound-valinnan ja julkaisee nykyisen
sidonnan valmistelun alkuperäisessä tehtävässä ennen grantia. Tunnettu
julkaisutulos, oman kopion poistokuittaus ja tuore poissaolo suojaavat
metadatan loppusiivousta. Epävarma kuittaus estää ulomman siivouksen.
Lähdesnapshotin alkuperä säilyy clientissä; oman viennin ja palautuspisteen
uudelleentarkistus lainaa vain kyseisen lähteen voimassa olevaa valintaa.
Ulkoisen backupin alkutarkistus pysyy kohteettomana.

Main erottaa käynnistyksen aikana kaapatun palautusvalinnan ja hyväksynnän
jälkeen luodun uuden runtime-valinnan. Suljettua startup-valintaa ei
lainata uudelle snapshotille. Rajattu katselmus löysi tämän liitosvirheen;
korjaukselle on saman compositionin palautus-hyväksyntä-snapshot-regressio.
Kutsujien 11 tiedoston sarja läpäisi 350 testiä; kolme POSIX-kohtaista
tapausta jäi Windows-ajon ulkopuolelle. Lopullinen kohde-/Main-kontrolli
läpäisi 12 valittua tapausta, joista 11 kuuluu samaan sidontasarjaan.
Tuloksia ei lasketa yhteen erilliseksi kattavuusmääräksi. Desktopin ja
sen E2E-kutsujien tyypitys läpäisi.

Tämän välivaiheen Mainin erillinen palautusvirhehaara aikakatkaisi myös
kohdeajossa. Myöhempi rajattu vaihekoe
valmistui muuttumattomalla rajalla; se ei selitä aiempia aikakatkaisuja.
Sulun kuuden tiedoston kohdesarja läpäisi 184 testiä; kolme entistä
alustakohtaista tapausta jäi ajamatta. Uudet forward-/rollback-regressiot
todistavat, että sisältövirheen rinnalle jäävä alkuperäinen valintaluku
estää varauksen ja leasen vapautuksen. Myöhäinen onnistuminen tai hylkäys
ei korvaa ensivirhettä eikä elvytä jatkovaltuutta. Aiemmat tiedostokahvan
sulkukontrollit ja nykyinen testiaineiston säilytys sisältyvät sarjaan.
Tämä on kohdenäyttö, ei native-keskeytyksen tai koko Main-sarjan hyväksyntä.
Tarkistimen main-puolen ensivirheen valinnainen havaitsija on kytketty
ennen turvallista virhemuunnosta. Olemassa olevan salatun toimituksen
purkukoe säilyttää alkuperäisen viestin, pinon ja syyketjun erillään
tarkoituksellisen testihylkäyksen virheestä. Mainin kaksi kohdekontrollia
todistavat käynnistyskytkennän ja sen päättymisen runtimen hyväksyntään.
Tarkistimen kahdeksan tiedoston sarja läpäisi 311 testiä; kolme entistä
alustakohtaista tapausta jäi ajamatta. Tyypitys ja rajattu havaitsijadiffin
riippumaton katselmus läpäisivät. Jo lapsessa pelkistynyttä syytä ei väitetä
talteen otetuksi.

Nykyiset `DESK-DELETE-BACKUP-001` ja `DESK-WORKSPACE-ADOPTION-001`
läpäisivät samalla development-valmistelulla ilman uusintaa. Ne käyttävät
oikeita Main-/backend-/SQLite-omistajia, tarkistusutilitya ja nykyistä
prosessipuun siivousta; backup-kontrolli vertaa salatun viennin aineistoa
ja uudelleenkäynnistyksen jälkeistä yritystä. Tämä ei todista kaikkien
cold-/original-haarojen sidontaa, native-lapsen alkuperäistä poikkeusta tai
paketoidun sovelluksen palautusta. Alkuperäinen aikakatkaisusyy säilyy
avoimena; koko Main-sarjan myöhempi näyttö on alla erikseen.

Nykyiset `DESK-WORKSPACE-ACTIVATION-001` ja `DESK-WORKSPACE-REPLACE-001`
läpäisivät lisäksi samalla development-valmistelulla ilman uusintaa.
Aktivointimigraatio ja backup-korvaus käyvät tuotannon Mainin cold-forward-
haaran, oikean SQLite-sisällön sekä uudelleenkäynnistyksen kautta; nykyinen
fixture vaatii prosessisiivouksen. Tämä ei vielä todista
cold-original-/rollback-original-kutsujan sidontaa tai keskeneräisen
inspection-lapsen keskeytystä. Nykyisen alemman korvausproofin suora
transaktion rollback ei ole tämän puuttuvan Main-/inspection-haaran todiste.

**Cold-original-kutsujan prosessikontrolli:** nykyisen Electron-fixturen
`DESK-WORKSPACE-ORIGINAL-001` jättää suljetun synteettisen palautuksen
`rollbackStarting`-vaiheeseen. Ehdokkaan tietokanta ja PDF eroavat
alkuperäisistä. Tuotannon Main ja original-inspection-utility palauttavat
alkuperäiset tavut ennen backendin avausta; toinen composition-käynnistys
säilyttää rekisterin ja business-/PDF-snapshotin. Tarkistusmetadatan
aluksi puuttunut hakemisto on tämän jälkeen olemassa tyhjänä, journalin
kaikki slotit ovat poissa, backendin exit ja fyysisen varauksen
uudelleenhankinta vaaditaan. Ehdokastavujen erottelun ja virheen
runtime-sidonnan katselmuslöydökset korjattiin. Korjatun tapauksen ajo
läpäisi ilman uusintaa. Nykyinen salaus-/purkukoe todistaa myös tämän
testin main-lukurajan alkuperäisen virheketjun tavut. Tämä ei ole erillisen
Electron-prosessin restart-, live-virhehaaran tai puhtaan paketin todiste.
Main-sarjan aiempi hylkäys säilyy avoimena havaintona.

**Main-sarjan rajattu jälkitodennus 30.10.2026:** omistajan hyväksymä
kymmenen sekunnin testibudjetti koskee vain valitsinpalautuksen
`publishReturn`- ja `clearReturn`-kuittauskatkoja. Molemmat sisältävät kaksi
kokonaista käynnistystä, ja kaikki alkuperäiset tarkistukset säilyvät.
Kohdepari ja yksi uusi koko Main-sarjan ajo läpäisivät; koko sarjassa oli
351 testiä. Aiempi aikakatkaisu ja sitä seurannut keskeneräisen testityön
esto eivät muutu korjatuksi juurisyyksi. Sovelluksen ja CI:n rajat säilyvät.
B:n yhteiskatselmus, C-F:n jatkotyö sekä puhtaan paketin ja PR/main-porttien
hyväksyntä erotetaan tästä testibudjetin todennuksesta.

**Inspection-yhteiskatselmuksen korjaukset 30.10.2026:** sidotun kopion
siivous tarkistaa kohdevalinnan myös jokaisen tiedostomuutoksen yhteydessä.
Valtuusodotuksen jälkeen tarkistetaan kopion ja tiedoston alkuperäinen
identiteetti. Grantin kohdevalinta varmennetaan lapsen valmiusodotuksen
jälkeen; kertakäyttöinen varauksen luovutus kulutetaan vain prosessiviestin
lähetysrajalla. Lainattu snapshot-valtuus sidotaan saman lähteen yksittäiseen
kulutuskertaan, eikä seuraava käyttökerta elvytä vanhaa callbackia tai
vientitarkistusta. Reclaim-poikkeuksen alkuperäinen syy havaitaan ennen
turvallista virhemuunnosta; aiempi ensivirhe säilyy ensisijaisena.

Ensimmäiset neljä puutetta toistettiin kohdetesteillä ennen korjausta.
Korjausten 403 testiä läpäisi; kolme entistä POSIX-tapausta jäi Windows-ajon
ulkopuolelle. Seuraava Electron-koe hylättiin ennen ensimmäistä ikkunaa:
uusi valintakääre kulutti kertakäyttöisen grantin toistuvasti. Korjattu
testikaksoinen sekä oikean Main-omistajan ja IPC-varauksen yhteiskoe
toistivat puutteen. Lähetysrajalle palautettu kertakulutus läpäisi 145
kohdetestiä sekä nimetyn `DESK-WORKSPACE-ORIGINAL-001`-prosessikokeen.
Sarjat ovat päällekkäisiä. Korjausten jälkeinen Main-palautuksen ja varausomistajan
417 testin sarja sekä desktopin ja molempien E2E-kutsujien tyypitys läpäisivät.
Aiempi 351 testin läpäisy edeltää näitä korjauksia. Rajattu riippumaton
delta-katselmus läpäisi; ensimmäisen virheen nykyinen salaus-/purkukoe
läpäisi myös korjatulla lähteellä. Aiemmat aikakatkaisusyyt eivät tämän
perusteella muutu ratkaistuiksi. C:n sopimus alla ei ole tuotantokytkentä.

##### Poiston backup-todisteen vastaavuus

**25.10.2026, lähteeseen perustuva suunnitelma, pieni sopimuskoe ja rajattu katselmus valmis.**
Nykyisen `PortableProfileBackupService.create()`-kutsun onnistuminen kertoo
tarkistetusta snapshotista. Sen maintenance päättyy ennen paluuta, joten
tulos tai `latestSuccessfulPortableBackupAt` ei todista myöhemmin
poistettavan työtilan muuttumattomuutta. Vanha kelvollinen backup ei muutu
virheelliseksi; siltä vain puuttuu tämä erillinen poistokohtainen todistus.

Ehdotus käyttää kertakäyttöistä mainin muistikuittia nykyisten backup-,
inspection- ja maintenance-omistajien välillä, ei uutta levyformaattia.
Sama kohdetodiste kuin poistossa sitoo operationId:n, workspaceId:n,
registry-entryn, lineagen ja omistetun juuren. Kuitti sitoo myös
installation-leasen omistajan, runtime-generationin sekä snapshotin ja
vientitarkistuksen nykyisen protokollan operation-/generation-/session-sidonnat.
Tämä on mainin sisäinen sidonta; session-arvoja ei julkaista.

Sisältö on nykyinen `ProfileInspectionReceipt`: profiili ja migration-chain,
DB:n ja katalogin todelliset koot/tiivisteet, artifactIdentity sekä PDF:ien
määrä/kokosumma ja terveystulos. Lähteen `exactCurrentManifest` ja puretun
viennin `restoreCompatible` tarkistetaan erikseen; niiden eri policy-arvoja
ei vaadita samoiksi. Kaikki varsinaiset sisältökentät täsmäävät. Vienti
sidotaan lisäksi autentikoidun lopullisen containerin tiivisteeseen ja
mainin yksityiseen native-tiedostovalintaan. Polkua tai kuittia ei anneta
rendererille poistovaltuudeksi.

`createProfileBackupSourceEntries` ja `assertProfileBackupSourceReceipt`
säilyvät lähdetavujen tarkistajina. Nykyinen inspector säilyttäisi täydet
vientisisällön kuitit vertailua varten ennen oman staginginsa siivousta;
pelkkä sama profiili, documentCount tai yhteenveto ei riitä. Nykyisen
portable-palvelun rajattu caller-owned-haara pitäisi saman kirjoitussuojan
snapshotista loppusulkuun, kuten nykyiset suojatut recovery-point-kutsut
käyttävät kutsujan varausta. Päivityksen valtuutta ei silti muuteta
poistovaltuudeksi. Tavallinen vientipolku säilyy ennallaan.

Secret-/business-työn ja sen DB-auditin on päätyttävä ennen snapshotia.
Lopullisen vientitiedoston sama identiteetti ja tiiviste tarkistetaan vielä
ennen kuitin kulutusta. Lease-/generation-/kohdemuutos, kirjoitussuojan
katkeaminen tai epävarma jatkuvuus vanhentaa kuitin heti. Tavallisen
snapshot-suojan timeout-vapautusta ei saa tulkita jatkuvuudeksi. Sulun
onnistumisen jälkeen kuitti voidaan käyttää kerran juuri ennen poiston
`authorized`-julkaisua. Restart ennen julkaisua menettää muistikuitin;
sen jälkeen jo julkaistu poistojournal omistaa hyväksytyn jatkamisen.
Kuitin myöntäminen varataan ennen ensimmäistä omistajakutsua ja
kertakulutus ennen ensimmäistä asynkronista odotusta. Myös
epäonnistunut tai kuittaamatta jäänyt kulutus mitätöi kuitin; journalin
mahdollinen julkaisu selvitetään nykyisistä sloteista, ei toisteta kirjoitusta.
Julkaisijan nykyiset valtuustarkistukset saavat saman tuoreen assertionin.
Synkronisen tarkistuskutsun sisällä tapahtuva mitätöinti havaitaan ennen
sen paluuta. Saman tunnisteen tai busy-tilan palautuminen ei korjaa kerran
katkennutta kirjoitussuojan jatkuvuutta.

Kuitin laajuus on **portable business snapshot**, ei koko poistoinventaario.
DB:n business-audit ja auktoritatiiviset PDF:t sisältyvät nykyiseen backupiin.
SMTP-salaisuus, konekohtaiset asetukset, palautuspisteet ja recovery-jäännökset
eivät muutu palautettaviksi tämän kuitin kautta. Käyttäjän palaute kertoo
nykyisen [backupin sisältörajauksen](local-backup-and-restore-plan.md#backupista-pois-jätettävä-sisältö).

Historiallinen backup, peruutettu vienti, väärä salasana tai puuttuva
kohteen snapshot-owner eivät anna kuittia. Passiivista/vikatilaista yritystä
ei avata pakolla eikä korvata aktiivisen yrityksen snapshotilla. Jo
hyväksytty erillinen menetyssuostumus ja kaksi poistovahvistusta säilyvät
vaihtoehtona; ne eivät ohita epävarmaa sulkua tai omistajuutta.
Yksityisen sopimusehdokkaan 60 tapausta, nykyisen lähdetarkistimen 10
regressiota ja tyyppitarkistus läpäisivät. Koe käyttää nykyistä täsmällistä
inspection-viestilukijaa ja backupin lähdetarkistinta. Todellisia synteettisiä
tiedostotavuja verrattiin myös saman kokoisten PDF:ien vaihtuessa ja
vientitiedoston vaihtuessa samansisältöiseen eri tiedostoon. Kohde-, lease-,
generation-/session- ja sisältöpoikkeamat, myöntämisen ja kulutuksen kilpailu
sekä synkroninen mitätöinti estivät luvattoman jatkon. Kadonnut julkaisukuittaus
säilyi epävarmana lopputuloksena eikä sallinut uutta kulutusta.

Kokeen export on salaamaton synteettinen tiedosto, ei oikea backup;
SQLite-, container-autentikointi-, jatkuva kirjoitussuoja-, sulku- ja inspection-
siivoustodisteet on injektoitu. Julkaisija on tallentava testiportti,
ei tuotannon poistojournal. Koe ei todista fyysistä restartia tai
ulkopuolisen kirjoittajan estämistä tiedostotarkistuksen jälkeen.
Todellinen keskeytymätön snapshot -> vienti -> sulku -kytkentä sekä kaikki
kirjoittajat todistetaan W7.3:ssa ennen tuotantohyväksyntää.

##### Poistojournal ja peruuttamattomuuden raja

**W7-P2 hyväksytty 24.10.2026:** rajattu `WorkspaceDeletionJournalV1`
nykyisen workspace-state-omistajan alle, **poistettavan työtilan ulkopuolelle**.
Nykyistä rajattua
byte-slot-kirjoitusta, hakemistosynkronointia ja polkuvalidointia käytetään;
uutta persistence-frameworkia ei luoda. Poistokohtainen lukija tarkistaa
slotit ennen niiden korjaamista: geneerinen `recoverAndRead()` saa siivota
next/backup-slotin vasta, kun W7 on osoittanut sen turvalliseksi.

Journalin täsmällinen v1-kenttäjoukko on `formatVersion`, `target`, `phase`,
`registryBeforeSha256`, `registryAfterSha256`, `previousActiveWorkspaceId`,
`backupDisposition`, `inventory`, `inventoryFileIdentity`,
`operationRootIdentity` ja `operationParentIdentity`. `target` on alla
määritelty kohdeluettelon otsake, `inventory` sen sitoumus. Edellinen valinta
on validoitu workspaceId tai null; backup-luokka on `verifiedBackup` tai
`explicitDataLoss`. Tiivisteet ovat 64 pienaakkosista heksamerkkiä, ennen- ja
jälkeen-rekisterit eroavat. Kaikki kentät ovat pakollisia jokaisessa vaiheessa;
vain `phase` muuttuu saman operaation journal-versioissa. Luku-/kirjoitusraja
on 16 KiB, ei yrityksen tiedosto- tai laskuhistorian määräraja. Ylimääräiset
kentät, avaintoistot ja virheellinen UTF-8 hylätään. Journal ei luettele
PDF:ien sisältöä, sisällä salaisuuksia tai anna mielivaltaista poistopolkua.

**Kohdeluettelon suunnittelu ja koe hyväksytty 25.10.2026; ei tuotantokytkentää.** Lähdekartoitus
vahvisti, ettei yhden yrityksen ulkopuolisten jäännösjuurten määrä ole
kiinteä. `ProfileRestoreActivationTransaction.clearRolledBack()` siivoaa
tyhjän rollback-rakenteen ja journalin mutta säilyttää `failed`-aineiston;
uusi operaatio tarkistaa oman operationId:nsä polut, ei aiempien määrää.
Activation-migraatio käyttää samoja polkuja. Yksi avoin journal ei siis
tarkoita yhtä historiallista jäännöstä. Inspection-kopioiden muistissa olevat
juurikuitit eivät myöskään todista pysyvää historiarajaa.

Hyväksytyn pienen journalin ja saman poisto-operaation muuttumattoman
teknisen kohdeluettelon formaatti sekä julkaisu-/loppusiivousrajat on
kokeiltu alla. Tämä on W7.0:n sopimusnäyttö, ei tuotantokytkentä.
Puuttuvaa kohdeomistajuutta tiedostomuoto ei korjaa.

##### W7.0:n kohdeluettelon täsmäsopimus

Alla on W7.0-kokeen v1-esitys. W7.4:n omistajan hyväksymä
[v2-täsmennys](#w74n-täydellisen-inventaarion-omistajuusraja) korvaa sen
inventory-version ja lisää sisäisen inspectionin siivoustodisteen.
Muut kenttä-, rivi-, omistajuus-, julkaisu- ja loppusiivousrajat säilyvät.
V1 ei kelpaa W7.4:n automaattisen poiston tai retirementin valtuudeksi.

| Osa | Täsmällinen sopimus |
| --- | --- |
| Otsake | `formatVersion: 1`, validoitu poiston `operationId`, `workspaceId`, nykyisen validatorin `lineageIdentity` ja `registryEntrySha256`. |
| Jokainen tietue | Vain `role`, `ownerOperationId`, `generationId`, `member`, `rootIdentity`, `parentIdentity`, `bindingSha256`. Identiteetit kuvaavat alkuperäistä omistettua juurta ja parentia, eivät polun tiivistettä. |
| Suljetut roolit | `workspace`, `legacyEntry`, `replacementImport`, `activationStaging`, `activationRollback`, `activationFailed`, `importCandidate`, `adoptionCandidate`, `inspection`. |
| Roolikohtaiset kentät | `workspace`/`legacyEntry`: operaation ja generationin arvot null. `legacyEntry.member` kuuluu nykyisen adoption-omistajan 13 merkinnän sallintalistaan; muilla member on null. Inspection käyttää nykyisiä operation-/generation-validatorien tunnisteita. Muilla operaatiokohtaisilla rooleilla operationId on UUID ja generation null. |
| Kohdesidonta | `workspace.bindingSha256` on null, koska registry sitoo juuren. Muilla rooleilla vaaditaan nykyisen omistajan pysyvän kohdesidonnan 64-merkkinen tiiviste. Tämä ei korvaa sidonnan validointia. |
| Tavumuoto | UTF-8 JSONL: otsake ensin, sitten tietueet, jokaisen lopussa LF. Kiinteä yllä mainittu avainjärjestys, `JSON.stringify`-esitys, ei BOMia, avaintoistoja, tyhjiä rivejä tai ylimääräisiä kenttiä. Tietueavain `role/ownerOperationId/generationId/member` kasvaa aidosti; null on tyhjä avainosa. Toisto tai epäjärjestys hylätään. |
| Rajat ja sitoumus | Yksi rivi LF mukaan lukien enintään 2 048 tavua, lukupala enintään 4 096 tavua. Journal sitoo `{formatVersion: 1, byteLength, recordCount, sha256}`; byteLength on positiivinen ja recordCount ei-negatiivinen turvallinen kokonaisluku. Tarkka pituus, tietuemäärä, EOF ja koko tiedoston SHA-256 varmennetaan. Ei uutta jäännösmäärän kokonaisrajaa. |

Luettelo kuuluu vain saman operaation todistetusti omistamaan tekniseen
kansioon, kiinteään `inventory.jsonl`-tiedostoon. Nykyinen omistaja johtaa
kansion validoidusta poisto-operaatiosta; renderer tai tiedosto ei anna
absoluuttista juurta. Luettelo, sen välitiedosto, journal ja quarantine
suljetaan backupista pois. Ne eivät ole palautuskopio tai tukipaketin sisältö.

Kirjoittaja kerää täydellisen, fyysisesti erillisten juurten inventaarion
nykyisiltä omistajilta saman jatkuvan varauksen ja kirjoittajien sulun alla.
Työtilan sisäistä alijuurta ei lisätä ulkoisena roolina uudelleen. Alun
todistettu poissaolo erotetaan puuttuvasta historiasta; tyhjän luettelon
kelvollinen formaatti ei todista, ettei yrityksellä ole poistettavaa aineistoa.
Omistajien sidonta-/journal-jäännösten täsmällinen cleanup tehdään niiden
omistajien kautta ennen terminal-tilaa, kun luettelo on vielä saatavilla.

Julkaisu käyttää nykyisiä tiedosto-/slot-mekanismeja: uuden next-tiedoston
yksinomainen luonti, rajattu peräkkäinen kirjoitus, tiedoston sync ja close,
tuore identiteetti-/varauskontrolli, next -> current, hakemiston sync ja
todellisten tavujen takaisinluku. Vasta tämän jälkeen journal saa julkaista
`authorized`-tilan. Nykyistä yhden puskurin next-writeria ei kutsuta
toistuvasti nollaoffsetiin; tuotantokytkentä käyttää nykyistä tiedostokahvaa
ja etenevää kirjoitusta. Luetteloa ei enää päivitetä. Partial-next,
puuttuva tai vaihtunut tiedosto ei oikeuta siirtoa tai purgea.

Lukija käyttää rajattua rivipuskuria ja yhtä edellisen tietueen avainta,
ei koko luettelon muistitaulukkoa. Ennen tuhoavia kutsuja vaaditaan koko
luettelon tarkistus; seuraava läpikäynti säilyttää saman varauksen ja
tiedostoidentiteetin sekä tarkistaa jokaisen kohteen tuoreesti. Hash yksin
ei todista juurten omistajuutta, täydellisyyttä tai muuttumattomuutta.
Nykyiset operaation aika-/peruutusrajat säilyvät; rajaton aineistomäärä ei
tarkoita rajatonta suoritusaikaa. Tuotannon luettelointi ja kaikkien
roolien disjointness todennetaan W7.4:ssä, ei pelkällä codec-kokeella.

**Rajattu näyttö:** 44 formaatti-, slot-, julkaisu- ja loppusiivouskoetta
sekä tyyppitarkistus läpäisivät. Mukana on oikea journal-rajaa suurempi
300 tietueen tiedosto, keskeytykset, muuttuneet tavut/identiteetit, vieras
sitoumus, rikkinäiset sivuslotit ja muiden aineistojen säilyminen. Katselmuksen
myöhäinen registry-muutos toistettiin kahdella hylkäävällä kokeella ja
korjattiin myös yksittäisten tiedostomuutosten yhteiseen guardiin.
Jälkikatselmus sulki havainnon. Täydellinen purge, oikea registry-julkaisu,
native-exit ja valtuus ovat tässä kokeessa injektoituja. Nykyinen Windowsin
hakemistosync ei anna fyysisen sähkökatkon kestävyystodistusta; sitä ei
väitetä saaduksi synteettisestä I/O-katkosta.

Lähteestä tarkistettu inventaarion vastuunjako ohjaa schemaa, ei anna vielä
poistovaltuutta:

| Aineistoryhmä | Nykyinen polku-/sisältöomistaja ja poiston raja |
| --- | --- |
| Rekisteröity työtila | `deriveWorkspaceRoot` johtaa vain validoidun workspaceId:n juuren. Sen sisällä DB/PDF-, secret-, asetus- ja palautusomistajien nykyiset rajat säilyvät; runtime- ja snapshot-polut tulevat `desktopProfilePaths`- ja `profileSnapshotRuntimePaths`-omistajilta. Sama juuri ei saa esiintyä inventaariossa uudelleen aliroolina. |
| Adoption säilynyt legacy-lähde | `workspaceLegacyAdoptionRootStore` omistaa 13 nimetyn yrityssisältömerkinnän sallintalistan. Listaa käytetään samasta omistajasta; koko legacy-runtimea tai installation-update-tilaa ei siirretä. Alun poissaolo ja myöhemmin kadonnut merkintä erotetaan. |
| Replacement ja activation-migraatio | `workspaceBackupReplacementPaths` johtaa yhteiset emohakemistot sekä operaatiokohtaiset import-/activation-staging-juuret. `ProfileRestoreActivationTransaction.operationPaths()` johtaa activationin operaatiokohtaiset staging-/rollback-/failed-juuret. Kertymä on operaatiokohtainen; yhteisiä emohakemistoja ei poisteta kohteen aineistona. |
| Importin ja adoption candidate | `workspaceBackupImportPaths` / `workspaceLegacyAdoptionPaths` johtaa operationId:n ja workspaceId:n täsmällisen candidaten. Jaettu `workspace-operations` tai toisen operaation aineisto ei kuulu kohteeseen. |
| Inspection-kopio | `resolveProfileInspectionCopyRoot` ja kopion oma omistaja johtavat generationiin sidotun juuren. Pysyvä luontisidonta ja tuore juuri-/parent-tarkistus vaaditaan; nimihaku tai nykyinen `stat` ei yksin korvaa niitä. |
| Omistajien sidonnat ja journalit | Muuttumaton kohdesidonta säilyy payloadin poiston yli. Sen oma loppusiivous erotetaan payloadista. Jaetun recovery-/update-journalin ratkaisee sen nykyinen omistaja, ei yleinen poistoluettelo. |

Tuntematon tai toiselle yritykselle sidottu juuri ei muutu poistettavaksi
luettelon tiivisteen avulla. Jokainen mukana oleva rooli tarvitsee saman
varauksen alla todennetun alkuperän, sallitun sijainnin, linkki-/tyyppirajat
ja kaikkien kirjoittajien päättymisen. Näiden tarkistusten toteutus ja
inventaarion täydellisyyden koe ovat vielä avoimia, eivät tämän lähdekartan
perusteella läpäistyjä.

Journal ja saman operaation quarantine suljetaan backupin ulkopuolelle.
Niitä ei palauteta käyttäjän backupista eikä käytetä yleisenä palautuspisteenä.
Quarantine on omistetun aineiston siirto, ei kopio, hardlink tai retention-
arkisto. Eri levyille putoavaa siirtoa ei muuteta copy/delete-operaatioksi.

**Peruuttamattomuuden raja on vahvistetun `authorized`-tilan onnistunut
julkaisu current-slottiin, synkronointi ja takaisinluku ennen ensimmäistä
siirtoa.** Tätä ennen peruuttaminen ei poista yritystä. Tätä myöhemmässä
virheessä käyttöliittymä kertoo keskeneräisestä poistosta; se ei lupaa
peruutusta eikä avaa osittain poistettua yritystä. Pelkkä initial-next,
native-dialogin hyväksyminen, lokirivi tai suljettu ikkuna ei anna
kylmäkäynnistykselle itsenäistä purkuvaltuutta. Epävarma julkaisutulos
ratkaistaan pysyvistä sloteista, ei muistissa olevasta onnistumislipusta.

Tilat ovat `authorized -> quarantined -> purgeAuthorized -> purged ->
registryPublished`. Jokainen tiedostomuutos vaatii saman operaation tuoreen
varauksen ja kohdetarkistuksen; journalin luku ei myönnä niitä. Rekisterin
entry ja lineage-varaus pidetään siihen asti, että purgen lopputila on
todennettu. Poiston admission estää entryn business-avauksen koko ajan.
`purgeAuthorized` julkaistaan ennen ensimmäistä lopullista tiedostopoistoa.

**Slot-admissionin kokeiltu periaate:** nykyisen tiedostolukijan avulla
luetaan rajatusti current, backup ja next ennen yhtäkään korjausta tai
slotin poistoa. Myös valitsematta jäänyt slotti validoidaan. Saman
operaation ja muuttumattoman kohdesidonnan sekä sallitun vaihesuhteen pitää
täsmätä; pelkkä validi current ei peitä ristiriitaista tai rikkinäistä nextiä.
Nykyinen yleinen `inspect()` ei yksin täytä tätä, koska se palauttaa
ensimmäisen löytyvän slotin.

Eristetty kahden kentän ehdokas läpäisi kymmenen tiedostokoetta:
ristiriitainen operaatio, eteen hypännyt next tai väärin järjestetty backup
hylättiin säilyttäen kaikki tavut; pelkkä initial-next ei myöntänyt valtaa;
current/backup pysyi vanhempana julkaistuna vaiheena nextin edellä;
rikkinäinen next ja luvun yli menetetty valtuus estivät jatkon. Tyhjä tila
ei antanut valtuutta; kolme samanaikaista slottia hylättiin säilyttäen tavut.
Aiemmat 18 nykyisen tallentimen karakterisointikoetta läpäisivät samassa
28 tapauksen ajossa. Luvut ovat osajoukkoja, eivät 18 + 28 erillistä testiä.

Ehdokas ei korjaa slotteja, myönnä varsinaista poistolupaa tai toteuta
lopullista W7-skeemaa. Ennen kytkentää tarvitaan vielä täydellisen
inventaarion muuttumaton kohdesidonta, hyväksytyn slot-korjauksen sekä seuraavan
tiedostomuutoksen tuore valtuus ja identiteettitarkistus. I/O-poikkeuksen
injektointi ei todista prosessin äkkikatkaisua tai fyysistä sähkökatkoa.

##### Keskeytyksen jatkaminen

Startup tarkistaa poiston journal-slotit nykyisen reservation-/admission-
ketjun sisällä ennen kohteen business-avausta tai rekisterin normaalia
korjauslukua. Eri operaatioiden ristiriitaa ei ratkaista valitsemalla
uusinta aikaleimaa tai sivuuttamalla toista journalia. Jatko ei tarvitse
uutta käyttäjävahvistusta vain, jos aiempi vahvistettu aloitus voidaan
todistaa samaksi operaatioksi ja nykyinen omistajuus on palautettu.

| Pysyvä havainto | Sallittu jatko ja estävä ehto |
| --- | --- |
| Ei julkaistua aloitusta; vain alkuvaiheen next | Ei tiedostosiirtoa/purgea. Säilytä epävarma kirjaus ja selvitä tila; yleinen slot-recovery ei saa muuttaa nextiä vahvistetuksi poistoluvaksi. |
| `authorized`, lähde paikallaan | Tarkista alkuperäinen root-identiteetti, registry-entry ja varaus; siirrä vain nimetyt omistetut roolit. |
| Siirto ehti, checkpoint ei | Lähde puuttuu ja täsmällinen siirretty identiteetti löytyy saman operaation quarantinesta: hyväksy vain tämä ennalta sallittu välitila. Kaksi kopiota, väärä juuri tai tuntematon puuttuminen estää jatkon. Usean roolin osittainen siirto käsitellään roolikohtaisesti. |
| `quarantined` | Varmenna kaikki roolit ennen `purgeAuthorized`-julkaisua. Vahvistettua lopullista poistoa ei vaihdeta automaattiseksi palautukseksi. |
| `purgeAuthorized`, osa aineistosta jo poistunut | Jatka vain journalin ennakolta valtuuttaman omistetun quarantine-juuren jäljellä oleviin kohteisiin. Poissaolo sallitaan vain tälle ennalta nimetylle poistolle; vaihdettua/linkitettyä juurta ei seurata. Kaikki aloitetut I/O:t päätetään ennen jatkoa. |
| `purged`, registry vielä ennen-tilassa | Todista poistettavien roolien poissaolo, julkaise vain täsmällinen jälkeen-rekisteri: kohde pois, aktiivisen poiston jälkeen null, muut entryt muuttumattomina. Jos muu entry muuttui, älä kirjoita vanhaa snapshotia sen päälle. |
| Jälkeen-rekisteri julkaistu, journal jäljellä | Varmenna inventaarion kaikkien payload-/quarantine-juurten poissaolo, niiden omistajien metadata-cleanup ja kaikkien registry-slotien turvallinen jälkeen-tila ennen `registryPublished`-julkaisua. Vanhasta backup-slotista ei saa palautua poistettua entryä. |
| Journalin loppusiivous keskeytyi | Vain yksin oleva `current = registryPublished` saa viimeistellä alla kuvatun teknisen metadatan siivouksen ilman jo poistettua kohdeluetteloa. Se ei myönnä uutta payload-poistoa. Tyhjä v2-rekisteri ei käynnistä adoptionia; epävarma slot-/registry-yhdistelmä säilytetään. |
| Väärä kohde, ristiriitaiset slotit, elävä/epävarma omistaja tai muu avoin operaatio | Ei destructive-jatkoa, business-avausta tai automaattista lineage-vapautusta. Säilytä aineisto ja näytä keskeneräinen/selvitettävä tila. |

Lopullinen onnistuminen vaatii kaikkien inventaarion kohteiden ja
quarantine-jäännösten poissaolon, julkaistun oikean rekisterin, vanhojen
palautusslottien sovituksen ja poistojournalin turvallisen loppusiivouksen.
Yksittäisen `unlink`-kutsun onnistuminen tai prosessin exit ei riitä.
Sovellustason poisto ei lupaa SSD-sektorien tai käyttöjärjestelmän muiden
kopioiden fyysistä ylikirjoitusta.

**Kohdeluettelon ja journalin loppujärjestys:** `registryPublished` on
pysyvä todistus yllä vaaditusta payload-/registry-lopputilasta, ei oikotie
sen tarkistuksiin. Ennen luettelon poistamista kaikki journal-slotit
revalidoidaan: sallittu on vain terminal-current ilman backupia tai nextiä.
`purged + next=registryPublished` ei vielä myönnä loppusiivousta, eikä
`registryPublished + backup=purged` oikeuta luettelon hävittämistä ennen
turvallista slottisovitusta. Jokainen slotti säilyttää saman muuttumattoman
sidonnan; kahden slotin vaiheet ovat peräkkäiset ja kolme slottia hylätään.

Luettelo poistetaan vasta täydellisen takaisinluvun ja uuden
identiteettitarkistuksen jälkeen. Sen oma sync ja tyhjän, identiteetiltään
saman operaatiokansion poisto sekä parent-sync tehdään journalin vielä
ollessa olemassa. Yhteisiä emohakemistoja tai tuntematonta lisätiedostoa ei
poisteta. Journal poistuu viimeisenä tuoreen terminal-/registry-/varausluvun
jälkeen. Registry-ehto tarkistetaan myös jokaisen tiedostokutsun yhteydessä,
ei vain ennen journalin asynkronista lukua.

Keskeytyksen jälkeen puuttuva luettelo tai operaatiokansio on sallittu
**vain tämän terminal-currentin teknisessä loppusiivouksessa**; jäljellä
olevat identiteetit, tarkka jälkeen-rekisteri ja varaus tarkistetaan edelleen.
Ennen terminalia puuttuva luettelo estää jatkon. Luettelo ilman journalia
ei anna automaattista cleanup-valtaa. Epävarma viimeinen poisto/sync ei ole
onnistumiskuittaus. Näin journal ei jää vaatimaan jo turvallisesti poistettua
luetteloa, eikä luettelon poissaolosta päätellä yrityksen payloadia poistetuksi.

**Rajattu tiedostokoe:** eristetty kiinteän testihakemiston ehdokas käyttää
nykyistä byte-slot-tallenninta sekä todellisia siirto- ja poistokutsuja.
Lopulliset 26 tapausta ja tiukka tyyppitarkistus läpäisivät: katkot julkaistun aloituksen, siirron,
purge-valtuuden, osittaisen poiston, rekisterijulkaisun ja loppusiivouksen
ympärillä; muuttunut juuri, tuntematon lisätiedosto, menetetty valtuus ja
muuttunut muu rekisterientry estivät seuraavan vaarallisen muutoksen.
Koko toisen synteettisen yrityshakemiston ja ulkoisten kopioiden tavut
verrattiin, ei vain yhtä sentinel-tiedostoa. Katselmuksen kolme puutetta
toistettiin viidellä hylkäävällä regressiolla ja korjattiin ehdokkaaseen:
kaikki rekisterislotit tarkistetaan myös terminal-jatkossa ja viimeisen
odotuksen jälkeen; kohteen hylkäys edeltää korjaavaa journal-lukua; varaus
tarkistetaan myös tallentimen yksittäisten tiedostokutsujen ympärillä.
Rekisterin julkaisun jälkeinen varaslotin siivousvirhe säilyttää epäselvän
tilan, eikä sitä tulkita valmistumiseksi. Journalin poiston ennen-/jälkeen-
virheet erotetaan jäljelle jäävistä tavuista. Rajattu riippumaton katselmus
ei jättänyt tämän ehdokkaan sovitussa piirissä avoimia löydöksiä.
Koe käyttää omaa pientä rekisterimallia ja kontrolloitua varausrajapintaa;
se ei todista tuotannon v2-validointia, prosessien päättymistä, kaikkien
sisäisten jäännösten inventaariota tai samanaikaisten slottikirjoittajien
poissulkua. Uusi koordinaattoriolio ei ole oikea prosessikatkos. Tämä
erillinen 26 tapauksen koe ei sisällä edellä kuvattua 28 tapauksen
slot-karakterisointia; kumpikaan ei ole W7:n loppuhyväksyntä.

##### W7.0:n poistopyyntö- ja vahvistussopimus

Uusi rajattu kanava on `eky:workspace-management:v1:delete` nykyisessä
`workspaceManagementCapabilityProtocol`-omistajassa. Nykyisten kuuden
kanavan tulosunionia ei levennetä; poistolla on oma tarkka request/result.
Preload lisää vain tämän nimetyn metodin nykyiseen jäädytettyyn siltaan.
Web ilman desktop-capabilityä ei tarjoa poistoa eikä käytä HTTP-fallbackia.

| Viesti | Sallitut kentät ja arvot |
| --- | --- |
| Pyyntö | Vain `formatVersion: 1`, validoitu `workspaceId`, nykyisen label-validatorin `typedLabel` ja `backupChoice: createBackup | explicitDataLoss`. Ei polkua, salasanaa, lineagea, journalia tai rendererin lähettämää `backupVerified`-väitettä. |
| Peruutus | `{formatVersion: 1, status: cancelled}` vain ennen pysyvän aloituksen julkaisuyritystä. |
| Valmis | `{formatVersion: 1, status: completed, navigation: selector | reopenPrevious}` vasta koko poiston ja metadatan siivouksen jälkeen. Reopen tarkoittaa vain samaa mainin tallettamaa aiempaa yritystä normaalien avausporttien kautta, ei jo todennettua business-terveyttä. |
| Ei aloitettua poistoa | `{formatVersion: 1, status: failed, reason}`. Tämä ei lupaa jo pysäytettyä runtimea käynnissä olevaksi. Valmistelun purku/paluu tehdään nykyisen lifecycle-omistajan porteilla. |
| Epävarma/keskeneräinen poisto | `{formatVersion: 1, status: recoveryRequired, reason}` heti, kun journalin julkaisuyrityksen vaikutus voi olla pysyvä. Epäselvää kirjoituskuittausta ei tulkita peruutukseksi tai vaikutuksettomaksi virheeksi. |

`reason` on suljettu joukko: `busy`, `invalidRequest`, `staleConfirmation`,
`backupUnavailable`, `ownershipUncertain`, `inventoryInvalid`,
`journalConflict`, `ioFailed`, `cleanupFailed`, `unknown`. Tuntematonta
syytä ei arvata. Molemmat päät hylkäävät ylimääräiset kentät, accessorit ja
väärän version/tyypin. Käyttöliittymä ei johda onnistumista pelkästä
poikkeuksen puuttumisesta. Request käyttää nykyisiä tunniste-/label-rajoja;
kokonaisia käyttäjän objekteja tai prototyyppejä ei säilytetä.

Nykyinen capability tarkistaa mainWindow/webContents/mainFrame-lähettäjän
ja argumenttimäärän. Poiston jatko kaappaa lisäksi kyseisen dokumentin ja
management-sukupolven; navigointi, disposal tai hallintaomistajan vaihto
mitätöi valtuuden pysyvästi. Pelkkä paluu samaan ID-arvoon ei palauta sitä.
Varataan nykyinen mutaatiogate ennen ensimmäistä awaitia. Tämän jälkeen
main lukee ja kaappaa muuttumattomana kohde-ID:n, näkyvän nimen, registry-
entryn ja koko registry-tilan tiivisteet sekä aiemman aktiivisen valinnan.
Kirjoitettu nimi vertautuu erillisellä täsmällisellä NFC-vertailulla;
nimien yksilöllisyysvertailu ei korvaa poistovahvistusta.

Valmistelu käyttää nykyistä backup-/maintenance-/sulku-/inventory-ketjua,
ei uutta manageria. Sen tulosluokka kaapataan kerran: `createBackup`
vaatii `verifiedBackup`-kuitin, `explicitDataLoss` erillisen käyttäjän
menetyssuostumuksen. Epäonnistunutta backupia ei vaihdeta huomaamatta
menetysvalintaan. Sama kaapattu luokka näytetään native-vahvistuksessa ja
sidotaan julkaisuun. Native-dialogi kuuluu samaan main-ikkunaan ja käyttää
nykyistä cancel-oletusta. Vaihtunut nimi, valinta, entry, registry,
dokumentti tai sukupolvi hylkää vanhan vahvistuksen myös awaitin jälkeen.

Prepared-kuitin kertakulutus sekä requester-/target-/lease-guard ovat voimassa
myös journalin yksittäisissä I/O-rajoissa. Julkaisucallbackin lupa suljetaan
kulutusvaiheen päättyessä sekä onnistumisessa että virheessä; talteen jäänyt
callback tai I/O-guard ei anna myöhempää valtuutta. Julkaisukuittaus vaaditaan
ennen varsinaisen poiston jatkoa. Jo julkaistu journal siirtää jatkon
pysyvän operaation nykyiselle omistajalle: rendererin katoaminen ei enää
peru poistoa. Uusi pyyntö ei ohita keskeneräisen journalin admissionia.

Nykyisen statusmallin `recoveryRequired` ei muutu yleiseksi ohitusluvaksi.
Tuotantokytkentä erottaa täsmällisesti saman kohteen poiston sallivan
recoveryn muun operaation estävästä epävarmuudesta. Vikatilaista DB:tä ei
tarvitse avata; muun yrityksen, koko asennuksen updaterin tai elävän
kirjoittajan recovery ei väisty tämän pyynnön nojalla.

**Nykyiset omistajat ja lukuketju:**

| Vastuu | Toteutuspaikka ja pysyvä raja |
| --- | --- |
| IPC ja native-vahvistus | `workspaceManagementCapabilityProtocol.ts`, `workspaceManagementCapability.ts`, nykyisen `workspaceReplacementConfirmation.ts`:n dialogimalli sekä preload. Poistolle oma teksti, kohde ja tulos, ei restore-vahvistuksen semantiikan uudelleenkäyttöä. |
| Käyttötapaus ja cold-resume | `WorkspaceManagementService`, `workspaceManagementTypes.ts` ja nykyinen startup-/reservation-ketju. Delete ja resume ovat saman pysyvän operaation kaksi sisääntuloa, eivät kaksi poistoalgoritmia. |
| Renderer | `desktopWorkspaceManagement.ts`, `workspaceManagementOperation.ts`, `useWorkspaceManagement.ts`. Oma tiukka poistotuloksen lukija, sessionin vanhentuneen vastauksen hylkäys ja turvalliset suomenkieliset syytekstit. |
| Tekninen ensivirhe | Nykyinen `workspaceBackupOperationalObserver.ts` ja `workspaceManagementFailureContext.ts` laajenevat vain alla olevilla suljetuilla arvoilla. Ensivirhettä ei korvata siivousvirheellä. |
| Sallitut lukijat | `diagnosticWorkspaceManagementProjection.ts`, backendin `diagnosticOperationalEventProjector.ts`, nykyinen desktop-event-validator sekä Diagnosticsin, täyden/rajatun tukipaketin ja incident-indeksin lukijat käyttävät samaa tarkkaa tapahtumasopimusta. Katalogi ja fixturematriisi päivitetään samassa kytkennässä. |

Delete/resume käyttää nykyistä `workspaceManagement.operationFailed`-
tapahtumaa, loogisia `operationId`-arvoja `workspace.delete` ja
`workspace.deleteResume` sekä nykyisiä correlation/duration/sideEffect-
kenttiä. Varsinainen poiston UUID, workspaceId, nimi, polku, inventory,
lineage, raakavirhe tai salasana ei tule tapahtumaan. `stage` saa näille
operaatioille vain `admission`, `deletePreparation`, `deleteAuthorization`,
`deletePurge`, `deleteRegistry` tai `deleteCleanup`; muiden operaatioiden
nykyinen joukko ei laajene. Turvallinen `errorCode` vastaa yllä olevaa syytä:
`WORKSPACE_MANAGEMENT_BUSY`, `WORKSPACE_MANAGEMENT_INVALID` tai
`WORKSPACE_DELETE_`-alkuinen `STALE_CONFIRMATION`, `BACKUP_UNAVAILABLE`,
`OWNERSHIP_UNCERTAIN`, `INVENTORY_INVALID`, `JOURNAL_CONFLICT`, `IO_FAILED`,
`CLEANUP_FAILED` tai `FAILED` (unknown). Nämä nimetään kerran omistavassa
desktop-sopimuksessa ja lukijoiden yhteensopivuus testataan.

Vain busy voi olla `retryable: true`; sekään ei käynnistä automaattista
uusintaa. `sideEffectState: none` edellyttää todistettua vaikutuksettomuutta;
muuten `unknown`. Julkaisuyritys tai journalista jatkaminen ei saa none-arvoa.
Erillinen loppusiivousvirhe julkaisee saman correlationin toisen tapahtuman
`stage: deleteCleanup` säilyttäen alkuperäisen tapahtuman ja syyn. Kummankin
kirjoitus on erikseen best effort. Tavanomainen peruutus, statuspollaus ja
onnistuminen eivät lisää virhetapahtumaa. Business-Activity/audit on pois
tästä ketjusta; poistetun yrityksen historiaa ei kopioida tekniseen lokiin.
Salattu testiaineisto säilyttää alkuperäisen synteettisen poikkeuksen nykyisellä
keräyksellä, ei näitä julkisia syykoodeja korvaavalla raakaviestillä.

**Rajattu näyttö:** yksityisen sopimusehdokkaan 42 tapausta, nykyisen
capabilityn/protokollan 18 regressiota ja tyyppitarkistus läpäisivät.
Mukana ovat muuttunut kohde/nimi/rekisteri/sukupolvi, vanha requester,
peruutus, julkaisu ilman kuittausta, kertakulutus ja väärä viestimuoto.
Katselmuksen myöhäinen callback ja muuttunut backup-luokka toistettiin
kahdella hylkäävällä kokeella, korjattiin ja jälkikatselmoitiin.
Lease, native-ikkuna, persistent-julkaisu ja purge ovat tässä kokeessa
injektoituja portteja. Observer ja sen lukuketju eivät kuulu tähän kokeeseen.
Nykyiset 18 testiä eivät todista uutta
delete-handleria. Tuotannon tapahtuman alkuperä -> loki -> oikeat lukijat
sekä salattu paketti -> purku todistetaan W7.3-W7.5:ssä ennen pitkää ajoa.

##### Palaute, vastuut ja todennus

Nykyinen `WorkspaceManagementService` ja sen observer pysyvät käyttötapauksen
omistajina. Capability lisää rajatun delete-pyynnön ja turvalliset
`cancelled`, `completed`, `failed` sekä `recoveryRequired`-tulokset; polut, lineage,
salaisuudet ja journal eivät tule rendererille. Tarkat protokollaversiot ja
sallitut kentät toteutetaan vain kerran omistavaan sopimukseen ja molemmat
päät testataan. Mainin startup-haara yhdistää nykyiset omistajat, ei sisällä
poistoinventaariota tai uutta yleistä tilakonetta.

Ensivirhe, vaihe, muutoksen tila ja siivoustulos pidetään erillisinä
nykyisessä suljetussa operational-katalogissa. Journal ratkaisee recovery-
valtuuden, ei best-effort-loki. Delete ja cold-resume kytketään samaan
nykyiseen observeriin sekä Diagnosticsin ja tukipaketin sallittuun
projektioon; business-Activity/audit ei säilytä poistetun yrityksen historiaa.
Backendittomassa tilassa main näyttää turvallisen tuloksen eikä sano
puuttuvaa business-terveystietoa terveeksi. Omistaja hyväksyi 24.10.2026
**rajatun desktop-tukipaketin nykyisen keräyksen pohjalta**. Nykyinen täysi
tukipaketti tarvitsee edelleen backendin ja sen käyttöoikeustarkistuksen.
Rajattu polku ei arvaa yritystietoja tai tietokannan terveyttä eikä avaa
yritystä vain tukipakettia varten. Ennen kytkentää nimetään sallittu sisältö,
puuttuvan tiedon esitys, mainin capability-/vahvistusraja, formaatin lukijat
ja testit [tukipakettisopimukseen](support-bundle-plan.md).
Hyväksyntä ei avaa yleistä tiedostolukua tai uutta lokitusjärjestelmää.
[W7.0:n rajattu tukisopimusehdotus](support-bundle-plan.md#w70n-rajattu-tukisopimusehdotus)
nimeää nykyiset capability-/archive-/file-store-omistajat, erillisen
desktop-only-formaatin, keräämättömän historian ja puuttuvan DB-tiedon sekä
virallisen tarkastimen muutoksen. Nykykomponenttien 12 rajakoetta läpäisivät;
erillinen yksityinen v3- ja jatkorajaehdokas on kokeiltu nykyisellä
tiedostokirjoittajalla. Se ei vielä todenna tuotannon W7-hallintaketjua,
sukupolvien vaihtoa, käyttöoikeutta tai virallista v3-tarkastinta.
Täsmällinen näyttö ja jäljellä olevat portit ovat tukipakettisopimuksessa.

| Kohdenäyttö nykyisillä fixtureillä | Pakollinen sisältö |
| --- | --- |
| Registry ja valinta | V1-yhteensopivuus, v2-kirjoittajat, kaikki slot-välitilat, usea/viimeinen/pelkkä recovery-kohde, puuttuva registry vs tyhjä, restart sekä vanhan lukijan turvallinen hylkäys. |
| Buildin hyväksyntä | Ensimmäinen W7-päivitys v1:stä ilman yhtään avattavaa yritystä; v2-valitsin/tyhjä tila ja myöhempi päivitys sekä epäonnistumisen rollback. Buildin hyväksyntä ja registry-muunnos eivät kierrä toisiaan tai business-/omistajuusportteja. |
| Poistokirjaus ja tiedostot | Jokainen yllä oleva raja ja sen molemmat puolet; keskeytys usean roolin siirrossa/purgessa, levy-/julkaisuvirhe, toistettu restart, vaihtunut identiteetti/linkki, vanhentunut varaus ja ristiriitainen muu journal. Vertaa myös säilyneitä tavuja, ei vain virhekoodia. |
| Sulku ja vahvistukset | Aktiivinen/passiivinen/vikatilainen kohde, viivästynyt secret-/arkisto-I/O, epävarma backend-exit, vanha frame/nimi/valinta, backupin peruutus ja puuttuva riskisuostumus. Ei aitoa SMTP:tä tai käyttäjädataa. |
| Eristys ja historia | Kaikki kolme SMTP-slottia, palautuspisteet/avainkuoret, staging-/legacy-jäämät poistuvat vain todistetusta kohteesta; toisten yritysten ja ulkoisten tiedostojen tavut säilyvät. Vanhoja nimikaksoiskappaleita ei muuteta. |
| Oikea käyttäjä- ja tukiketju | Nykyinen web/Electron-fixture, viimeinen poisto -> restart -> selector -> create/import/open; failure/cold-resume -> main-palaute/observer -> sallitut lukijat. Pakotettu alkuperäinen virhe löytyy puretusta nykyisestä salatusta testipaketista. |
| Backenditon tuki | Rajattu vienti ilman business-runtimea, käyttäjän vahvistus ja mainin sender-/capability-tarkistus; sallittu sisältö ja todellinen lukija. Puuttuva backend-/DB-tieto ei muutu onnistuneeksi terveystulokseksi. Nykyisen täyden paketin permission- ja sisältöregressiot säilyvät. |
| Paketoitu hyväksyntä | Sama puhdas Windows-paketti: backup -> inspect -> restore -> restart -> compare sekä poisto/restart ja muiden yritysten säilyminen. First-start-/update-muutos saa lisäksi omat installer-porttinsa. Nykyiset PR/main-portit, riippumaton katselmus ja yksityisyys pysyvät pakollisina. |

Yksikkö-/tiedostokokeet tulevat ennen pitkää ajoa. Ensimmäinen pieni proof
rajataan registry-valintaan ja journalin aloitus-/purge-/loppusiivouskatkoihin.
Se ei käynnistä oikeaa MSI:tä eikä yksin täytä W7-P4:n kytkentäehtoja. Uutta
testialustaa, aikarajaa, riippuvuutta tai raakavirheiden julkaisua ei lisätä.

**Omistajan hyväksynnät ja jäljellä olevat todennusportit (25.10.2026):**

1. **W7-P1, suunta hyväksytty 24.10.2026:** v2-rekisteri ja pysyvä null-valinta;
   saman polun slottimuunnos, vanhan ohjelmaversion turvallinen hylkäys ja
   versionmukaiset kirjoittajat. Yllä oleva yhteensopivuusraja ja
   rollback-todennus säilyvät; konkreettista historiapoikkeusta ei ole valittu.
2. **W7-P2, hyväksytty (keskustelun kohta 2):** rajattu poistojournal,
   julkaistu aloitus ennen siirtoa,
   erillinen purge-valtuus ja yllä kuvattu automaattisen jatkon sopimus.
3. **W7-P3, suunnat hyväksytty (keskustelun kohdat 3-6):** nykyisen mainin
   backenditon yrityshallinta ja source-null-avaus; passiivisen poiston
   sulku/paluu; vain kohteen oman keskeytyneen palautuksen korvaaminen
   todistetun sulun jälkeen; nykyiseen keräykseen perustuva rajattu
   desktop-tukipaketti. Inventaarion pysyvä kohdesidonta, first-start myös
   ensimmäisestä vikatilaisesta v1-lähdöstä sekä tuen tarkka sisältö ja
   käyttöoikeus on täsmennetty W7.0:n sopimuksissa ja pienissä kokeissa;
   niiden oikeat kytkennät ovat tulevaa toteutusnäyttöä, eivät uusia kysymyksiä
   näiden hyväksyttyjen suuntien valinnasta.
   Omistaja hyväksyi 25.10.2026 kohdesidonnan rajatun suunnittelun ja kokeen
   sekä yrityksettömän tilan asennuspakettipäivityksen yllä kuvatuin rajoin.
   Tämä ei vielä sulje inventaarion tai first-startin todennusportteja.
4. **W7-P4, ehdollinen toteutus hyväksytty (keskustelun kohta 7):**
   täsmällisen inventaarion ja sopimusten, version-/keskeytyskokeiden sekä
   katselmoinnin jälkeen edetään rajattuun tuotantokytkentään W7.1-W7.5:n
   nykyisessä jaossa ilman saman toteutusluvan toistamista. Ehtojen
   täyttyminen kirjataan näyttöön ennen kytkentää. PR/main-portit ja koko
   W7:n loppuhyväksyntä vaativat edelleen omat todisteensa.

Samat jo hyväksytyt viimeisen/vikatilaisen yrityksen, backup-riskin,
vahvistusten ja poistuvan/säilyvän sisällön päätökset eivät palaa kysymyksiksi.
Uusi ristiriita tai hyväksytystä suunnasta poikkeava turvallisuus-,
yhteensopivuus-, tietosuoja- tai riippuvuusmuutos käsitellään erikseen;
yleinen jatkolupa ei ratkaise nimeämätöntä poikkeusta.

#### Omistajan päätettävät sopimukset

Alla oleva 23.10.2026 lähtötaulukko säilyttää alkuperäiset päätökset ja
niiden tekniset täsmennystarpeet. Uudemmat W7-P1-P4-hyväksynnät yllä ovat
ensisijaisia; taulukon vanha avoin hyväksyntä ei avaa samaa päätöstä uudelleen.

| Päätös | Voimassa oleva raja | Ehdotus ja avoin hyväksyntä |
| --- | --- | --- |
| W7-D1: poiston kohdetilat | Enintään yksi business-SQLite-owner; epävarmaa työtilaa ei avata business-käyttöön. | Omistaja hyväksyi 23.10.2026 myös vikatilaisen yrityksen poiston alla olevin ehdoin. Pelkkä `recoveryRequired` ei estä poistoa eikä tietokantaa tarvitse ensin korjata. Kohteen luotettava tunnistus ja sitä käyttävien töiden todettu päättyminen ovat edelleen pakollisia. |
| W7-D2: aktiivinen ja viimeinen yritys | Vanhan sessionin, tietokannan, prosessien ja adapterien omistajuus päättyy ennen seuraavaa runtimea. | Omistaja hyväksyi 23.10.2026 aktiivisen yrityksen poiston jälkeisen yritysvalinnan ilman toisen yrityksen automaattista avausta sekä viimeisen yrityksen jälkeisen luonti-/tuontitilan ilman oletusyritystä. Poiston virhe- ja keskeytysrajat sekä backendittoman hallinnan tekninen sopimus ovat avoimia. Erota nolla työtilaa ja tila, jossa jäljellä on vain recovery-kohteita; jälkimmäistä ei tulkita tyhjäksi. |
| W7-D3: vahvistuksen kohde | Näkyvän nimen kirjoitus ja Electron mainin native-vahvistus. Yllä hyväksytty nimien yksilöllisyys koskee uusia luonteja, tuonteja ja nimenmuutoksia; vanhat nimikaksoiskappaleet säilyvät huomautuksella. | Molemmat vahvistukset sidotaan samaan uudelleenvalidoituun workspaceId:hen ja nykyiseen labeliin. Omistaja hyväksyi 23.10.2026 perumisen viimeiseen vahvistukseen asti; varsinaisen poiston alettua käyttöliittymä ei enää peru sitä. Vanhojen samannimisten turvallisen valinnan näyttötapa sekä rename-/selection-race täsmennetään toteutussopimukseen. Renderer ei lähetä poistettavaa polkua. |
| W7-D4: backup tai riskihyväksyntä | Tuore validoitu backup tai nimenomainen riskihyväksyntä; ei uusia piilokopioita. | Omistaja hyväksyi 23.10.2026 poiston ilman toimivaa backupia, kun tietojen menetys hyväksytään erikseen ja molemmat poistovahvistukset tehdään. Tarkka tuoreus snapshot-/kirjoitusrajana, tarkistuslaajuus ja lineage-sidonta jäävät suunniteltaviksi. Valittu kopio todennetaan K:n portilla; aikaleima ei yksin todista tiedostoa. Riskihyväksyntä ei ohita identiteetti-, containment-, prosessisulku- tai recovery-rajaa. |
| W7-D5: quarantine ja lopullinen poisto | Quarantine edeltää lopullista poistoa. | Hyväksytty suunta on saman poistotoiminnon tekninen välivaihe, ei uusi kopio tai ajastettu säilytys. Omistaja hyväksyi 23.10.2026 keskeytyneen poiston automaattisen jatkamisen seuraavassa käynnistyksessä vain varmasti todettuun kohteeseen, omistajuuteen ja keskeytystilaan sidottuna. Tarkka siirtotapa, irreversible-raja, journalin recovery ja keskeneräisen poiston lineage-varaus ovat vielä suunniteltavia. Keskeytynyttä poistoa ei merkitä onnistuneeksi. |
| W7-D6: business-data ja audit | Työtila omistaa SQLiten, business-auditin ja auktoritatiiviset PDF:t. Auditilla on oma säilytyssopimus. | Omistaja hyväksyi 23.10.2026 yrityksen oman muutos- ja tapahtumahistorian poiston yrityksen lopullisessa poistossa ilman erillistä historiakopiota. Tekniset virhelokit säilyvät normaalein säännöin; niihin ei kopioida poistettavaa business-historiaa. Tarkka inventaario kattaa myös sidecarit, staging-jäämät ja erikseen säilytetyn legacy-adoption lähteen; yhden juuren poisto ei yksin todista koko cleanupia. |
| W7-D7: salaisuudet | Workspace-kohtainen salattu store; poisto kattaa current/next/backup-slotit ja lifecycle-auditin. | Omistaja hyväksyi SMTP-salaisuuden kaikkien tallennusversioiden poistamisen saman onnistuvan poistotoiminnon aikana myös vikatilaiselta yritykseltä, ei palautettavaa piilosäilytystä. Tarkka järjestys ja osittaisen poiston recovery ovat avoimia. Keskeneräisen secret-I/O:n päättyminen todistetaan ennen storeen kohdistuvia tiedostotoimia; paikallinen poisto ei peruuta palveluntarjoajan tunnusta. |
| W7-D8: palautuspisteet | ADR-0009 suojaa normaalissa käytössä uusimman hyvän sekä avoimen pre-update/pre-restore-pisteen; lopullisen yrityspoiston poikkeus on hyväksytty 23.10.2026. | Lopullinen poisto kattaa kyseisen yrityksen omat palautuspisteet, myös viimeisen hyvän pisteen. Muiden yritysten pisteet ja käyttäjän vientibackupit säilyvät. Käynnissä olevaa restorea/updatea ei ohiteta kilpailevalla poistolla. Keskeytyneen operaation sulun, pisteiden inventaarion, indeksin ja avainkuorten täsmällinen cleanup-sopimus on vielä suunniteltava. |
| W7-D9: ulkoiset ja installation-kopiot | Ulkoiset PDF:t eivät ole auktoritatiivinen store; tekniset lokit ja update ovat installation-scopea. | Omistaja hyväksyi 23.10.2026 käyttäjän valitsemaan ulkoiseen arkistokansioon tallennettujen PDF-kopioiden säilymisen yrityspoistossa. Myös käyttäjän vientibackupit säilyvät. Tukipakettien ja installation-tilan nykyiset säilytyssäännöt eivät muutu. Pysäytä arkistointityö ennen sen workspace-konfiguraation/journalin poistoa. Ulkoista arkistojuurta tai sen yrityskohtaista alikansiota ei poisteta. |
| W7-D10: virhe- ja tukipolku | Journal on auktoritatiivinen, tekninen loki best effort. Renderer ei saa polkuja, salaisuuksia tai journalia. | Päätä suljetut tilat/syykoodit, observer-ketju, Diagnostics/support-projektio ja Activity/audit mukaanotto tai perusteltu poissulku. Backendittoman tilan tuki on ratkaistava erikseen: nykyinen tukipaketti tarvitsee backend-sessionin. |

**W7-D2:n rajattu omistajapäätös 23.10.2026:** myös viimeisen yrityksen saa
poistaa. Aktiivisen yrityksen onnistuneen poiston jälkeen palataan
yritysvalintaan, eikä toista yritystä avata automaattisesti. Käyttäjä valitsee
itse seuraavan yrityksen. Jos yrityksiä ei enää ole, tarjotaan uuden
yrityksen luonti tai varmuuskopion tuonti; oletusyritystä ei luoda
automaattisesti. Tämä hyväksyy käyttäytymisen
suunnitteluun, ei vielä poiston tuotantototeutusta, backendittoman hallinnan
teknistä sopimusta tai muiden W7-päätösten ohittamista. Vanhan runtimen
todettu päättyminen, nykyinen yrityseristys ja fail-closed-recovery säilyvät.
Todennukseen kuuluvat aktiivisen yrityksen poisto muiden säilyessä,
yritysvalinta myös uudelleenkäynnistyksen jälkeen ilman automaattista avausta
sekä käyttäjän valitseman yrityksen normaali avaus. Lisäksi todennetaan
viimeisen yrityksen poisto, hallittu uudelleenkäynnistys tyhjään tilaan
sekä luonnin ja tuonnin onnistuminen, peruutus ja virhe ilman
automaattisesti syntyvää yritystä. Tämä ei hyväksy R030-06:n erillistä
ensiasennuksen muutosta. Vikatilaisen yrityksen myöhempi päätös on alla.

#### W7:n hyväksytty poistoperiaate

**Omistajan päätös 23.10.2026, suunnittelusuunta:** myös vikatilaisen
yrityksen hallitut tiedot ja SMTP-salasana poistetaan turvallisesti ilman
piilokopioita. Tämä korvaa aiemman ehdotuksen rajata poisto vain
`ready`-työtiloihin. Rikkinäistä tietokantaa ei tarvitse avata tai korjata
poistokelpoiseksi, mutta poistettava kokonaisuus tunnistetaan luotettavasti,
uudet työt estetään ja yritystä käyttävien prosessien sekä tiedosto- ja
salaisuusoperaatioiden päättyminen todistetaan. Epävarma omistajuus tai
vanha yhä toimiva omistaja estää arvaavan poiston.

Quarantine on saman poistotoiminnon tekninen välivaihe, ei kopio eikä
päiviksi tai viikoiksi säilytettävä palautusarkisto. Onnistuminen edellyttää
sovitun tietoinventaarion ja SMTP-salaisuuden kaikkien slottien poistoa.
Jos keskeytys tai poistoeste jättää aineistoa, käyttäjälle kerrotaan poiston
jääneen kesken; jäännöksille ei luvata automaattista poistoa määräajassa.
Käyttäjän ulkoiset varmuuskopiot ja PDF-viennit eivät kuulu poistoon.

**W7-D4:n omistajapäätös 23.10.2026:** myös ilman toimivaa varmuuskopiota
saa poistaa yrityksen, mukaan lukien testi- tai vikatilainen yritys.
Ensin tarjotaan varmuuskopiointia tai olemassa olevan kopion tarkistusta.
Ilman kelvollista kopiota käyttäjä hyväksyy tietojen pysyvän menettämisen
erikseen, kirjoittaa poistettavan yrityksen näkyvän nimen ja tekee lopuksi
Electron mainin native-vahvistuksen. Nämä ovat kolme erillistä tietoista
varmistusta, eivät kolme samanlaista lisäikkunaa. Varmuuskopioinnin peruutus
tai virhe ei ole riskihyväksyntä. Varmistukset vähentävät vahinkopoiston
riskiä, mutta eivät korvaa kohteen tunnistusta tai muita turvallisuusportteja.

**W7-D3:n peruutusta koskeva omistajapäätös 23.10.2026:** poiston voi perua
viimeiseen vahvistukseen asti; tällöin yritystä tai sen salaisuutta ei poisteta.
Varsinaisen poiston alettua sitä ei enää peruta käyttöliittymästä. Näytetään
eteneminen ja lopuksi onnistuminen tai keskeneräinen poisto. Kaatuminen,
pakkosulku tai muu keskeytys käsitellään erikseen keskeytysrecoveryn mukaan,
ei käyttäjän peruutuksena tai onnistumisena. Osittain poistettua yritystä
ei avata uudelleen pelkän peruutuspyynnön perusteella. Tarkka durable-raja
ja sen kytkentä sulkuun sekä journalin recoveryyn määritetään ennen toteutusta.

**W7-D8:n omistajapäätös 23.10.2026:** lopullisessa yrityspoistossa poistetaan
myös yrityksen omat sovelluksen sisäiset palautuspisteet, mukaan lukien
viimeinen hyvä piste. Niitä ei säilytetä EKYssä poistetun yrityksen
palautusmahdollisuutena eikä muuteta tai viedä automaattisesti käyttäjän
varmuuskopioksi. Käyttäjän itse tallentama `.ekybackup` säilyy erillisenä;
ehjän tuetun kopion voi myöhemmin tuoda normaalien tarkistusten kautta uutena
työtilana. Muiden yritysten palautuspisteisiin ei kosketa. Hyväksyntä on
rajattu poikkeus ADR-0009:n normaaliin palautuspisteiden suojaan, ei lupa
ohittaa käynnissä olevan työn sulkua tai epävarmaa tiedosto-omistajuutta.

**W7-D6:n omistajapäätös 23.10.2026:** yrityksen oma muutos- ja
tapahtumahistoria, mukaan lukien business-audit, poistetaan yrityksen
lopullisen poiston mukana. Siitä ei tehdä erillistä säilytettävää kopiota
eikä rivejä kopioida tekniseen lokiin. Tekniset virhelokit ja niiden nykyinen
turvallinen kenttärajaus säilyvät normaalien säilytyssääntöjen mukaan.
Poikkeus koskee vain nimenomaisesti vahvistettua koko yrityksen poistoa;
normaali business-auditin automaattinen retention ei muutu. Keskeneräisen
salaisuusoperaation päättyminen todistetaan ennen poistoa, eikä sen
audit-historian poistamista tulkita operaation lopputuloksen selvittämiseksi.

**W7-D9:n omistajapäätös 23.10.2026:** käyttäjän valitsemaan ulkoiseen
arkistokansioon tallennetut PDF-kopiot säilyvät yrityksen poistossa, myös
EKYn tekemät työtilakohtaisen alikansion kopiot. Arkistojuurta, alikansiota
tai niiden tiedostoja ei poisteta. Käyttäjän tallentamat varmuuskopiot
säilyvät aiemman päätöksen mukaisesti. Tämä ei koske työtilan sisäisiä
auktoritatiivisia lasku-PDF:iä: ne poistetaan yrityksen mukana.
Ennen työtilan sisäisen arkistoasetuksen ja retry-journalin poistoa
arkistointityön todettu päättyminen on pakollinen; poiston jälkeen vanha työ
ei saa tehdä uusia kopioita. Käyttäjälle kerrotaan ulkoisten tallenteiden
jäävän hänen hallintaansa. PDF-arkisto ei ole tietokannan varmuuskopio.

**W7-D5/D10:n omistajapäätös 23.10.2026:** keskeytynyttä, jo vahvistettua
ja aloitettua lopullista poistoa saa jatkaa automaattisesti seuraavassa
käynnistyksessä ilman uusia poistovahvistuksia, kun sama kohde, omistajuus
ja keskeytystila on varmasti todettu. Tämä ei käynnistä uutta poistoa eikä
anna poistolupaa pelkän hakemistonimen, puuttuvan rekisteririvin tai vanhan
teknisen lokimerkinnän perusteella. Epävarmassa tilanteessa poisto ei jatku;
aineisto ja keskeytyskirjaus säilyvät, eikä osittain poistettua yritystä avata
business-käyttöön. Käyttäjälle näytetään jatkaminen ja lopputulos tai
selvitystä vaativa keskeneräinen tila. Vanhan omistajan todettu päättyminen
ja muiden yritysten sekä ulkoisten tallenteiden suoja säilyvät.

Poistettavan aineiston tarkka inventaario ja keskeytyneen operaation
sulkurajat, vahvistusten kohdesidonta sekä poistojärjestys ja
keskeytysrecovery ratkaistaan ennen toteutusta.
Tämä 23.10.2026 käyttäytymispäätös ei yksin antanut tuotantokytkennän tai
journal-/registry-muutoksen lupaa; myöhempi ehdollinen valtuus on W7-P1-P4:ssä.

W7-D8:n palautuspistepoikkeus on kirjattu
[ADR-0009:ään](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md#rotaatio).
W7-D6:n erikseen hyväksytty business-auditin poikkeus on kirjattu
[retention-suunnitelmaan](operational-log-retention-plan.md#business-auditin-automaattinen-retention).
Molempien poikkeusten toteutus tarvitsee inventaarion ja recovery-testit. Tarkat
salaisuusrajat ovat [email-suunnitelmassa](email-delivery-and-secrets-plan.md),
säilytys [retention-suunnitelmassa](operational-log-retention-plan.md) ja
ulkoinen arkisto [PDF-arkistosuunnitelmassa](local-invoice-pdf-archive-plan.md).

#### Jäljellä olevat käyttäytymispäätökset

Tilanne 24.10.2026: nimetyt käyttäytymisvalinnat sekä W7-P1-P3:n suunnat
on ratkaistu. W7-P4:n ehdollinen toteutuslupa on annettu. Seuraava vaihe on
alla olevan työjaon tekninen täsmennys, pienet kokeet ja katselmus,
ei uusi rinnakkainen työjono tai samojen kysymysten toistaminen.
Backupin tuoreus, tarkka nimivertailu, vahvistusten kohdesidonta,
inventaario ja diagnostinen lukuketju täsmennetään nykyisten omistajien
kautta. Käyttäytymispäätökset eivät hyväksy nimeämättömiä formaatti- tai
arkkitehtuurimuutoksia eivätkä sulje todennetun uuden löydön päätösporttia.

#### Koottu toteutusehdotus

**Työjako 23.10.2026, ehdollinen toteutus hyväksytty 24.10.2026.**
Yllä olevat W7-P1-P4-päätökset täsmentävät tämän työjaon toteutusvaltuutta.
M1 omistaa M4:n työjärjestyksen; tämä osio omistaa W7:n teknisen valmistelun.
Toteutus säilyttää yllä hyväksytyn käytöksen ja nykyiset C/D/K:n turvarajat.

| Pala | Nykyinen omistaja ja suunniteltu muutos | Valmistumisehto ennen seuraavaa kytkentää |
| --- | --- | --- |
| W7.0 / sopimus | `workspaces/management`, `registry`, `maintenance` ja `runtime`: capabilityn suljetut pyynnöt/tulokset, keskeytyskirjauksen formaatti, täsmälliset siirto-/poistorajat ja luettavien sekä muuttuvien juurten omistajat. | Valmis rajattuna sopimus-/koevaiheena 25.10.2026 yllä olevan valmiustaulukon mukaan. Ei tuotantokytkentää tai koko W7:n hyväksyntää; uusi poikkeus käsitellään erikseen. |
| W7.1 / nimet | `registry/workspaceLabelValidation.ts`, `workspaceRegistryMutations.ts` ja nykyiset create/import/rename-kutsujat: yksi nimivertailu, tarkistus saman maintenance-omistajan sisällä ennen julkaisua. | Kirjainkoko- ja välilyöntivariantit estyvät; oma nimenmuutos ei törmää itseensä. Vanhat samannimiset säilyvät ja erottuvat turvallisesti ilman automaattista muutosta. Virallinen yritysnimi ja lineage eivät muutu. |
| W7.2 / yritysvalinta | `workspaceManagementComposition.ts`, `workspaceSwitchStartup.ts` ja nykyinen käynnistyscomposition: erota business-runtimen avaus backendittomasta hallinnasta. | Aktiivisen poiston jälkeinen valinta, viimeisen poiston jälkeinen luonti/tuonti ja restart toimivat ilman automaattista yrityksen avausta/luontia. Pelkkien recovery-kohteiden luettelo ei ole tyhjä asennus. R030-06:n ensiasennusmuutos jää erilliseksi. |
| W7.3 / vahvistus ja sulku | Nykyinen management-capability, maintenance-lease ja `ActiveWorkspaceLifecyclePort`: sido backup/riskivalinta, kirjoitettu nimi ja native-vahvistus samaan mainin uudelleenvalidoimaan kohteeseen. | Vanhentunut valinta/nimi, kilpaileva operaatio tai puuttuva suostumus eivät anna siirtolupaa. Business-kirjoitukset, backendin exit sekä arkisto- ja secret-I/O:n päättyminen todistetaan erikseen ennen tiedostomuutoksia. |
| W7.4 / poisto ja jatko | `workspaces`-alueen rajattu poisto-operaatio ja nykyinen cold-admission: toteuta quarantine, inventaarion mukainen lopullinen poisto ja idempotentti jatko omistavilla tiedosto-/rekisteriporteilla. | Keskeytys jokaisella pysyvällä rajalla säilyttää todettavan tilan. Sama kohde voidaan jatkaa varmasti tai sulkea selvitystilaan; osittainen poisto ei avaa yritystä eikä vapauta lineagea kilpailevalle tuonnille. |
| W7.5 / palaute ja näyttö | Nykyinen workspace-feature, operational-observer, Diagnostics ja tukipaketti sekä yhteiset testifixturet. | Käyttäjälle näkyvät onnistuminen, kesken jääminen ja turvallinen syy. Backendittoman tilan luku-/tukipolku on nimetty; julkinen tieto ja salattu testiaineisto pysyvät erillään. Oikea paketoitu poisto/restart ja muiden yritysten säilyminen todennetaan. |

Taulukon desktop-lähteet ovat `apps/desktop/src/`-juuren alla.
Tämä on vastuu- ja työjako, ei lupa lisätä yleistä manageria, uutta
testialustaa, riippuvuutta tai salaisuuksien tallennusmallia.

**Normaalin poistoketjun suunnittelusopimus:**

1. Näytä mainin validoima kohde ja poistuvan/säilyvän aineiston rajaus.
   Tarjoa backup tai sen tarkistus; ilman kelvollista kopiota tarvitaan
   erillinen menetyshyväksyntä. Backupin tuoreus sidotaan poistettavan
   aineiston snapshot-/kirjoitusrajaan, ei vain kopion aikaleimaan.
2. Kerää hyväksytyt vahvistukset. Main revalidoi kohteen, nimen, lineagen
   ja vahvistuksen ajantasaisuuden ennen operaation varaamista/jatkamista.
   Käyttäjän syöte ei määritä tiedostopolkua tai siivouksen laajuutta.
3. Käytä installation-tason maintenance-varausta ja nykyisiä kirjoitus- ja
   sulkuportteja. Vanhan backendin puuttuminen ei yksin todista mainin
   tiedosto-/salaisuusoperaatioiden loppua. Sulun epävarmuus estää poiston.
4. Todenna poistettavien juurien omistajuus, muut yritykset ja säilytettävät
   kohteet. Linkki, polkujen päällekkäisyys tai vaihtunut tiedostoidentiteetti
   ei laajenna poistolupaa. Vikatilainen DB ei tarvitse business-avausta.
5. Kirjaa saman vahvistetun operaation jatkamiseen tarvittava pysyvä tieto
   ennen ensimmäistä siirtoa tai tuhoavaa muutosta. Sijainti ei saa kadota
   poistettavan työtilan mukana. Tarkka formaatti, backup-poissulku,
   luku-/kokorajat ja commit-raja hyväksytään W7.0:ssa; kirjaukseen ei
   kopioida yrityksen business-dataa, salaisuuksia tai palautusarkistoa.
6. Siirrä quarantineen ja poista vain hyväksytyn inventaarion omistetut
   kohteet. Rekisterin, aktiivisen valinnan, palautuspisteiden ja avainkuorten
   täsmällinen järjestys ratkaistaan samassa keskeytystilataulukossa.
   Puuttuva tiedosto ei yksin todista, että juuri tämä operaatio poisti sen.
7. Merkitse valmis ja vapauta jäljellä oleva keskeytys-/lineage-varaus vasta,
   kun koko hyväksytty cleanup ja rekisteritila on todennettu. Virhe säilyttää
   ensimmäisen syyn erillään siivouksesta; keskeneräinen ei ole onnistuminen.
8. Aktiivisen poiston jälkeen näytä yritysvalinta ilman seuraavan yrityksen
   automaattista avausta. Passiivisen poiston vaikutus aiempaan aktiiviseen
   runtimeen käsitellään nykyisen lifecycle-omistajan kautta, ei rinnakkaisena
   toisena runtimena. Viimeisen jälkeen näytä luonti ja tuonti.

**Inventaario:** poistoon kuuluvat yrityksen omat SQLite-/sidecar-tiedostot,
auktoritatiiviset PDF:t, business-audit, SMTP:n current/next/backup-slotit,
sisäinen arkistoasetus ja retry-journal, palautuspisteet ja niiden omistetut
indeksi-/avainjäämät sekä todistetut staging-/legacy-jäämät. Jaetuista
asennustason rakenteista ei poisteta muiden yritysten osia. Käyttäjän
vientibackupit, ulkoinen PDF-arkisto ja muiden yritysten sisältö säilyvät;
tekniset lokit, tukipaketit ja update-tila säilyvät omien sopimustensa mukaan.

**Ennen tuotantototeutusta:** W7.0:n rajattu suunnitelmakatselmus ja
synteettinen keskeytys-/jatkamiskoe todistavat erityisesti vanhentuneen
valtuuden, muuttuneen kohteen, osittaisen poiston ja toistetun restartin.
Jos nykyinen omistaja ei riitä, puute ja pienin vaihtoehto tuodaan päätökseen
ennen kytkentää. Valmistelu ei käynnistä pitkää CI- tai asennusajoa.

#### W7.3:n toteutussopimus

**28.10.2026: W7.3 hyväksytty PR #323:ssa ja mainin omilla porteilla.**
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
nimeää täsmällisen revision ja näytön. Alla päivätyt valmistelukokeet
ovat historiaa, eivät avoin W7.3-työjono. W7.4:n lopullinen poisto ja
W7.5:n näkyvä käyttöönotto eivät kuulu tähän hyväksyntään. W7.0:n hyväksytyt
[vahvistusrajat](#w70n-poistopyyntö--ja-vahvistussopimus),
[backup-todiste](#poiston-backup-todisteen-vastaavuus) ja
[poistettava kokonaisuus](#vahvistus-sulku-ja-poistettava-kokonaisuus)
säilyvät. Tämä osio täsmentää niiden nykyiset tuotantokutsujat; se ei
uusi vanhoja kokeita tai lisää W7.4:n purgea W7.3:een.

Alla olevat päivätyt osakokeet kuvaavat valmistelun etenemistä. Niiden
silloiset puutteet eivät ole rinnakkainen työjono. Kohde-/omistajamatriisi
ja toteutusjärjestys säilyvät hyväksytyn toteutuksen vastuurajoina.

**Toimitusraja:** W7.3 valmistelee vahvistuksen ja kertakäyttöisen valtuuden
nykyisiin omistajiin sekä todentaa todellisen backup-/sulkuketjun.
Käyttäjälle ei vielä rekisteröidä delete-IPC:tä, paljasteta preload-metodia
tai tarjota poistopainiketta. Ne kytketään vasta W7.4:n todellisen
journal-/poistokuluttajan kanssa. Testissä nimetty julkaisukuluttaja ei ole
tuotannon poistaja eikä sen kuittaus oikeuta `completed`-tulokseen.
W7.3:n PR hyväksyy vain tämän valmistelurajan ja sen regressiot.
W7.4-W7.5 tarvitsevat edelleen koko poiston ja palautumisen näyttönsä.

**Nykykoodista varmennetut liitoskohdat:**

| Raja ja nykyinen omistaja | Rajattu toteutustarve |
| --- | --- |
| `workspaces/management/workspaceManagementCapability.ts`, `workspaceManagementService.ts`, `workspaceManagementComposition.ts` | Oma runtime-sulku kutsuu nyt myös hallinnan `dispose`a. Erota uusien pyyntöjen admission ja juuri hyväksytyn operaation elinikä; todellinen ulkoinen sulku tai dokumentin vaihto mitätöi valtuuden. Oman pyynnön `shutdown` ei saa odottaa itseään. |
| `main/desktopComposition.ts`, `main/desktopSelectorComposition.ts`, `workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.ts` ja `mainOwnedSelectorWorkspaceLifecycle.ts` | Kytke sama täsmällinen operaatio nykyiseen quiescence-, exit-, inspection- ja varausketjuun. Valitsin ei saa keksiä business-runtimea tai terveystulosta; aktiivisen runtimen sulku ei saa antaa no-op-todistetta. |
| `workspaces/maintenance/workspaceMaintenanceLease.ts`, backendin `runtime/profileMaintenance/profileMaintenanceState.ts` ja nykyinen snapshot-broker | Nimeä poiston oma lease ja suojattu backend-omistaja; update/restore-valtuutta ei lainata. Katkennut suoja mitätöi kuitin pysyvästi. Tavallisen backupin vapautus säilyy. |
| `profileBackup/portableProfileBackup.ts` | Tavallinen `create()` vapauttaa maintenance-suojan ennen paluuta. Tee hyväksytty caller-owned-haara samoilla lähdetarkistimilla, container-kirjoittajalla ja siivousomistajilla; älä monista vientialgoritmia. |
| `profileBackup/runProfileSnapshotInspection.ts`, `profileSnapshotInspectionClient.ts`, `profileSnapshotInspectionPort.ts`, `inspectEncryptedProfileBackup.ts` ja `container/decryptBackupPayload.ts` | Säilytä täydet lähde-/vientikuitit ja nykyisen tarkistusprosessin varmentamat operation/generation/session-sidonnat ennen projektioita ja staging-siivousta. Säilytä autentikoidun lopullisen tiedoston alkuperäinen identiteetti ja tiiviste. Uutta container-formaattia tai tarkistusprotokollaa ei tarvita. |
| `invoicePdfArchive/invoicePdfArchiveService.ts`, `invoicePdfArchiveBrokerMain.ts` ja `invoicePdfArchiveCapability.ts` | Nykyinen brokerin `close()` ei odota palvelun sarjajonoa, eikä capabilityn dispose estä kaikkia jo avatun dialogin jatkoja. Lisää pääsyn sulku, myöhäisten jatkojen mitätöinti ja todellisen I/O:n päättymistodiste nykyisiin omistajiin. |
| Webin `app/desktopWorkspaceManagement.ts`, `features/workspaces/workspaceManagementOperation.ts`, `useWorkspaceManagement.ts` ja nykyinen hallintadialogi | Säilytä suljettu delete-pyyntö/tulos erillään vanhasta yleisestä operaatiotuloksesta. Sido myös virhe/finally nykyiseen UI-sukupolveen. Valmistele ja testaa käyttöliittymä erillään tuotannon kytkennästä. |

Desktop-polut ovat `apps/desktop/src/`, backend-polut `apps/backend/src/`
ja web-polut `apps/web/src/`-juuresta. Uudet nimetyt apurit sijoitetaan
näiden omistajien yhteyteen, ei yleiseen manageriin tai utilities-kerrokseen.

**Valtuuden kulku:**

1. Capability ottaa mutaatiovuoron ennen ensimmäistä odotusta ja kaappaa
   mainin dokumentti-/hallintasukupolven. Palvelu ottaa täsmällisen
   installation-leasen ja lukee kohteen samoista validoiduista
   rekisteritavuista: workspaceId, label, lineage, juuren identiteetti sekä
   aiempi aktiivinen valinta. Nimi tarkistetaan W7.0:n täsmällisellä
   NFC-säännöllä, ei nimien yksilöllisyyden vertailulla.
2. Jokainen native-, varaus-, tiedosto- ja backup-odotus tarkistaa saman
   muuttumattoman kohteen ja elävän valtuuden uudelleen. Dokumentin
   navigointi/lataus, oikea capability-disposal, ulkoinen shutdown,
   kohdemuutos tai varauksen menetys mitätöi sen peruuttamattomasti.
   Pelkkä saman mainFrame-olion tai workspaceId:n säilyminen ei riitä.
3. Backup-haara käyttää poiston caller-owned suojaa ja vaatii päättyneen
   secret-/business-työn sekä DB-auditin ennen snapshotia. Lähteen ja
   viennin täydet nykyiset sisältökuitit vastaavat toisiaan; policyt
   `exactCurrentManifest` ja `restoreCompatible` tarkistetaan rooleittain.
   Tavallinen viimeisin backup tai yhteenveto ei anna kuittia. Passiivisen
   tai vikatilaisen kohteen puuttuvaa snapshot-omistajaa ei korvata
   aktiivisen yrityksen tiedoilla tai pakotetulla business-avauksella.
4. Ilman tällaista kopiota tarvitaan hyväksytty eksplisiittinen
   menetyssuostumus, kirjoitettu nimi ja saman pääikkunan native-vahvistus.
   Vienti-/salasanavirhe tai peruutus ei vaihda haaraa käyttäjän puolesta.
   Suostumus ei anna omistajuutta, exit-todistetta tai oikeutta ohittaa
   toisen yrityksen tai asennuspäivityksen recoverya.
5. Nykyinen lifecycle todistaa erikseen mainin I/O:n, tarkistuslapsen ja
   backendin päättymisen sekä mainin fyysisen varauksen palautumisen.
   Uusien hallintapyyntöjen sulkeminen oman operaation vuoksi ei yksin
   tuhoa juuri sen kaapattua valtuutta. Se ei kuitenkaan oikeuta
   jatkamaan oikean ikkunasulun tai ulkoisen shutdownin jälkeen.
6. Backup-kuitin myöntäminen ja kulutus varataan kerran ennen ensimmäistä
   ulkoista callbackia tai odotusta, myös synkroninen uudelleentulo torjuen.
   Callbackin paluun jälkeen tarkistetaan sen aikana voinut mitätöinti.
   Kulutus revalidoi lopullisen containerin identiteetin ja
   tiivisteen sekä kaikki kohde-/lease-/exit-rajat ennen W7.4:n
   `authorized`-julkaisua. Kuluttajan asynkroninen julkaisutarkistus uusii
   myös vientitodisteen odotuksen jälkeen, ei vain kohdevalintaa.
   Täsmälliset tarkistuskohdat ja rajat omistaa
   [vientisopimus](local-backup-and-restore-plan.md#w73n-poiston-valmistelun-vientisopimus).
   Julkaisuvartija mitätöidään lopuksi myös
   virheessä; talteen jäänyttä callbackia ei saa käyttää myöhemmin.
   Kuittauskatko ei palauta kulutusoikeutta.
7. Ennen julkaisuyritystä peruutus säilyttää yrityksen aineiston. Se ei
   itsessään todista suljetun runtimen käyttökelpoisuutta tai avaa
   suljettua secret-brokeria uudelleen. Julkaisuyrityksen jälkeen
   epävarmuus on `recoveryRequired`; vahvistettu journal omistaa jatkon.
   `completed` edellyttää W7.4:n kaikkien poistojen ja loppusiivouksen
   todistusta. Valmistelun palautus normaaliin käyttöön ratkaistaan
   nykyisen lifecycle-omistajan kautta, ei rinnakkaisella runtimella.

**Sulun täsmennys:** arkistoinnin pääsyn sulku estää
uudet kopioinnit ja myöhäisen native-valinnan jatkon. Aloittamattomat
jonotyöt päätetään ilman uusien tiedostovaikutusten aloittamista;
jo pysyvässä retry-journalissa olevat työt säilyvät. Aloitetun kirjoituksen,
journal-päivityksen ja kahvojen sulun todellinen päättyminen pitää odottaa.
Sulku tarkistetaan myös käynnissä olevan `retryPending`-silmukan ja
`chooseDirectory`-jatkon sisällä ennen seuraavaa kopiointiyritystä:
komennon aiempi aloitus ei anna lupaa aloittaa kaikkia sen jonotöitä.
Arkistokopion epäonnistuminen ei muuta jo hyväksyttyä SMTP-toimitusta
epäonnistuneeksi. Työn päättyminen, sen onnistuminen ja sulkuvaltuus ovat
eri asioita.

Hallinta- ja arkistocapability säilyttävät tilaamansa dokumentin
tapahtumaviitteen kuuntelijoiden poistamista varten. Ikkuna voi tuhoutua
ennen sovelluksen `before-quit`-käsittelyä; disposal ei silloin saa lukea
sen natiivia `webContents`-ominaisuutta uudelleen. Säilytetty viite ei ole
pyyntövaltuus: elävän ikkunan, lähettäjän, framen, dokumenttisukupolven ja
admissionin tarkistukset säilyvät. Hallinnan shutdown odottaa edelleen
jo alkanutta työtä myös ikkunan sulkeuduttua.
`DESK-WINDOW-CLOSE-001` erottaa tämän ikkunasta alkavan sulun tavallisesta
`DESK-RESTART-001`-polusta. Vain todettu onnistunut sovellussulku hyväksytään;
fixturen myöhempi prosessisiivous ei korvaa sitä.

**Omistajan hyväksyntä 27.10.2026:** rajatun kokeen arkistosulun odotus on
enintään viisi sekuntia. Se alkaa uuden työn sulkemisesta rinnakkain
nykyisen secret-drainin kanssa. D2:n viittä sekuntia, HTTP-quiescencen
30 sekuntia tai backendin omia rajoja ei nosteta. Odotuksen loppuminen
ei peru käyttöjärjestelmän I/O:ta eikä anna poisto-/relaunch-valtuutta;
epävarmuus säilyttää sisäiset tiedostot ja estää vaarallisen jatkon.
Myöhäinen valmistuminen ei muuta epäonnistunutta yritystä onnistuneeksi.
Hyväksyntä koskee budjettia ja rajattuja kokeita; tuotantokytkentää ei vielä
väitetä todennetuksi. Kokeessa erotetaan tavallinen päättynyt kopiointivirhe
epävarmasta tiedostokahvan sulusta. Jonon settlement ei yksin todista
kaikkien kahvojen sulkeutumista. Hyväksytyn peruutuskäytöksen lähdekytkentä
varmistetaan ennen vaikutusalueen tuotantototeutusta.

**27.10.2026, arkistosulun rajattu koenäyttö:** nykyisestä arkistokoodista
johdettu, tuotantoon kytkemätön ehdokas läpäisi 15 synteettistä tapausta
ja tyyppitarkistuksen. Oikeilla tiedostotavuilla todennettiin alkanut kopio,
journalin viimeistely, aloittamattomien pyyntöjen välitön hylkäys,
retry-silmukan seuraavan kopion esto sekä PDF-/journal-/kansiokokeen
epävarmassa kahvasulussa säilyvä aineisto. Tavallinen päättynyt kopiointivirhe
ei ole sama tulos kuin epävarma sulku. Viiden sekunnin raja ja myöhäisen
valmistumisen pysyvä hylkäys todennettiin hallitulla kellolla.
Nykyistä capabilitya ja brokeria käyttävät kokeet erottivat myöhäisen
native-valinnan ja brokerin `close()`-palautumisen varsinaisesta I/O-drainista.
Ikkuna ja kuljetus olivat injektoituja: tämä ei ole oikean Electronin,
runtime-sulun tai koko V1:n hyväksyntä. Capabilityn myöhäisten UI-callbackien
mitätöinti ja lähdekoodin production-kytkentä ovat edelleen tekemättä.
Ensikokeen kansiorajausvirhe ja katselmuksen löytämä jonopyyntöjen viive
korjattiin koeehdokkaaseen; aiemmat tulokset säilyvät erillisinä.
Rajattu riippumaton jälkikatselmus ei löytänyt korjatusta ehdokkaasta uutta
huomautettavaa. Se ei korvaa jäljellä olevaa composition- tai tuotantonäyttöä.

**Omistajan hyväksymä peruutuksen käyttötila 27.10.2026:** jos yhteydet on jo suljettu,
näytetään poiston peruuntuminen ja tarjotaan käyttäjän valitsema hallittu
paluu aiempaan yritykseen, tai valitsimeen jos aiempi valinta oli null.
Paluu käyttää nykyistä lifecycle-/relaunch-ketjua: omistettujen töiden ja
vanhan backendin päättyminen sekä fyysinen varaus todistetaan ensin.
Suljettua secret-brokeria ei avata saman sukupolven sisällä. Epävarma sulku
estää paluun; myöhäinen onnistuminen ei käynnistä sitä automaattisesti.
Yrityksen tiedot ja valmis käyttäjän vientibackup säilyvät.
Ennen yhteyksien sulkemista tehty vaikutukseton peruutus voi palata
nykyiseen näkymään. Hyväksyntä koskee käyttäjän valitsemaa hallittua
paluuta, ei automaattista restartia, epävarman sulun ohittamista tai
jo julkaistun poistojournalin peruuttamista. Tuotantokytkentä ja koko
peruutuspolun todentaminen ovat vielä tekemättä.

**Paluun nykyinen kutsuketju:** `WorkspaceManagementService.runAdmitted`
kutsuu `runtimeRelaunchCompletion.complete()`-metodia myös virheen ja
peruutuksen jälkeen ennen saman leasen odotettua vapautusta.
Ensivirhe säilyy mahdollisten paluu- ja vapautusvirheiden edellä.
`DeferredWorkspaceRuntimeRelaunch`
toteuttaa jo aiemmin pyydetyn paluun silloin kerran. Siksi poistosta paluun
`request()` tehdään vasta erillisen käyttäjävalinnan, todellisen sulun ja
tuoreen varaus-/rekisteritarkistuksen jälkeen, ei valmistelun varmuustoimena.
Paluun valinta käsitellään saman mainin omistaman operaation sisällä ennen
sen päättymistä; suljettua yleistä hallinta-admissionia ei avata sen vuoksi.
Paluun suorittava main-kutsu tarkistaa vielä ulkoisen shutdownin ja
valtuuden mitätöinnin, myös jos ne tapahtuvat requestin ja completen välissä.
Tämä ei anna perutulle poistovaltuudelle uutta käyttökertaa. Rajattuun
composition-näyttöön kuuluvat peruutus ilman paluuvalintaa, hyväksytty paluu,
epävarma sulku, kadonnut varaus, null-valinta ja samanaikainen ulkoinen sulku.
Nykyisen deferred-apurin yksikkötesti ei yksin todista tätä uutta kytkentää.

**27.10.2026, hallintapyynnön rajattu koenäyttö:** nykyisistä capability- ja
service-omistajista johdettu yksityinen ehdokas sekä nykyiset lifecycle-,
quiescence-, deferred-relaunch- ja journal-vartijat läpäisivät 22 tapausta
ja tyyppitarkistuksen. Oma sulku sulki uuden admissionin säilyttäen vain
hyväksytyn pyynnön. Ulkoinen sulku, saman mainFrame-olion navigointi ja
renderer-/ikkunasulku mitätöivät sen. Capabilityn native-odotus ja palvelun
oma työ estivät kumpikin erikseen varauksen vapauttamisen. Odottava,
kielteinen tai vanhentunut paluuvalinta ei pyytänyt relaunchia; viimeinen
callback tarkisti valtuuden ja varauksen vielä erikseen.
Katselmuksen kolme testinäytön aukkoa täydennettiin näillä erottelevilla
kontrolleilla; rajattu jälkikatselmus ei löytänyt niistä uutta huomautettavaa.
Luonnin, tuonnin ja korvauksen nykyinen välitys säilyi
rajatussa kokeessa, mutta niiden koko koordinaattoriketjua ei ajettu.
Backend, ikkuna ja fyysinen varaus olivat injektoituja; säilyvät tiedostot
synteettisiä. Testin `prepared` ja `returnRequested` eivät ole tuotannon
IPC-tuloksia, poistovalmius tai toteutunut paluu. Täydellinen kohde-/lease-
ja backup-ketju, null-valitsimen paluu sekä oikea IPC/native/prosessinäyttö
ovat edelleen avoimia. Poistokanavaa ei rekisteröity eikä tuotantokoodia muutettu.

**27.10.2026, viennin rajattu koenäyttö:** nykyisestä portable-viennistä
johdettu yksityinen ehdokas läpäisi 19 uutta tapausta ja tavallisen viennin
22 kontrollia. Sama vientialgoritmi käytti oikeaa salattua containeria ja
synteettisiä tiedostotavuja; PDF:n tavut ja aggregaatti säilyivät viennissä.
Kutsujan suojan säilyminen, lähde-/vientikuittien ristiriidat, lähdepoiston
epävarmuus, varmennetun vientikopion säilyttäminen ja alkuperäisen
autentikoidun kahvan identiteetti erotettiin. Samansisältöinen uusi tiedosto
ei korvannut alkuperäistä identiteettiä edes readerin viimeistelyn aikana;
viivästetty kahvasulku esti tuloksen palauttamisen. Ensimmäisen kokeen
kirjoitussuojatun fixtuurin muutosyritys korjattiin erilliseen turmeltuun kopioon.
Tyyppitarkistus läpäisi vanhan kontrollifixtuurin porttityypin sovituksen jälkeen.
Tämä ei ole SQLite-/native-/exit- tai koko backup-kuitin hyväksyntä:
kirjoitussuojan ja tarkistimen omistajat olivat injektoituja. Vientisisältö ei
ole tuotannon poistovaltuus. Katselmuksessa löytynyt viimeisen siivousodotuksen
jälkeinen valtuusaukko korjattiin; erilliset kontrollit mitätöivät valtuuden
sekä tiedostosiivouksen että tarkistusomistajan paluun aikana. Testien
aloitettu työ odotetaan myös assertion-virheessä ennen mokkien palauttamista.
Rajattu riippumaton jälkikatselmus ei löytänyt korjatusta ehdokkaasta uutta
huomautettavaa. Tämä ei korvaa jäljellä olevaa koko V1:n kytkentänäyttöä.
Omistava [vientisopimus](local-backup-and-restore-plan.md#w73n-poiston-valmistelun-vientisopimus)
pitää normaalin backupin ja poiston caller-owned-haaran erillään.

**Sisäisen sidonnan koesopimus:** nykyinen `runOwnedProfileInspection`
luo pyynnön identiteetin, ja prosessilukija vaatii sen täsmäävän terminaliin.
Snapshot-kutsuja säilyttää tämän identiteetin hyväksytyn receiptin rinnalla
vasta nykyisen exit-/reclaim-/siivousketjun jälkeen. Clientin operaatiotietue
omistaa molemmat ja luovuttaa ne vain saman varatun kuluttajan aikana;
receiptin vaihto tai valtuuden menetys mitätöi myös sidonnan. Uutta sukupolvea
ei arvata myöhemmän tiedostoluvun perusteella. Nykyinen turvallinen
validation-yhteenveto ja muiden kuluttajien sopimus säilyvät.

**27.10.2026, sidonnan rajattu koenäyttö:** tarkistusomistajan ehdokkaan
106 tapausta ja tyyppitarkistus läpäisivät. Vientiin yhdistetty ehdokas
läpäisi kahdeksan uutta tapausta, 22 tavallisen viennin kontrollia ja
tyyppitarkistuksen. Nykyisen main-omistajan luomat erilliset lähde- ja
vientitunnisteet säilyivät oikeiden salattujen tiedostotavujen yli;
vanhentunut kuluttaja, väärä operaatio sekä sama generation/session hylättiin.
Katselmuksen virhemuunnos ja kaksi puuttuvaa törmäyskontrollia korjattiin;
rajattu jälkikatselmus ei jättänyt avoimia löydöksiä. SQLite, prosessiraja,
fyysinen varaus ja poiston kirjoitussuoja olivat edelleen injektoituja.
Tämä ei ole tuotantokytkentä tai koko V1:n hyväksyntä. Koenäyttö ei vielä
kattanut nimettyä delete-suojaa, täsmällistä kohde-/lease-valtuutta tai
backup/sulkuketjua.

**Poiston nimetyn huoltosuojan koesopimus:** nykyinen maintenance-tila ja
snapshot-broker saavat omat begin/assert/invalidate-operaatiot poistolle.
Suoja käyttää nykyisiä drain- ja enimmäiskestorajoja; sille ei ole saman
runtimen vapautuskutsua. Tavallinen backup, update tai restore ei saa
vapauttaa sitä edes samalla operaatiotunnisteella. Katkos, umpeutuminen tai
epävarma drain säilyttää kirjoituseston. Tarkistuskontekstin lähde- ja
vientipyynnöt nimeävät saman poistosuojan erikseen; update-valtuutta ei
lainata eikä poistosuoja oikeuta palautusaktivointiin. Koeehdokkaan nykyinen
yksityinen snapshot-broker siirtyy versioon 13, mutta tarkistuslapsen
protokolla ja backup-formaatti säilyvät.
Peruutus estää myös täsmällisen jonossa olevan, vielä aloittamattoman
poistopyynnön myöhemmän käynnistymisen. Ennen suojan hankintaa saatu
invalidation-virhe ei ole suojan päättymiskuittaus; jonopyynnön oma lopputulos
ja todellinen sulku tarkistetaan edelleen erikseen.

**27.10.2026, huoltosuojan rajattu koenäyttö:** 28 uutta tapausta,
88 nykyistä kontrollia ja tyyppitarkistus läpäisivät. Oikea maintenance-tila,
client/broker ja installation-leasen muistissa oleva omistaja olivat mukana;
kuljetus ja snapshot-palvelu olivat injektoituja. Katselmuksessa havaittu
aloittamattoman pyynnön peruutusaukko toistettiin ja korjattiin ehdokkaassa.
Rajattu jälkikatselmus ei jättänyt tähän muutokseen avoimia löydöksiä.
Tämä ei vielä todista fyysistä varausta, oikeaa prosessirajaa tai suojan
yhdistämistä vientiin ja runtime-sulkuun. Tuotantokytkentä ja V1:n
kokonaiskatselmus ovat edelleen avoimia.

**27.10.2026, suojan ja viennin liitoskoe:** 16 liitostapausta,
22 tavallisen viennin kontrollia ja tyyppitarkistus läpäisivät. Nykyinen
maintenance-tila, client/broker, installation-leasen muistissa oleva omistaja
ja mainin tarkistusketju on yhdistetty samoihin salattuihin tiedostotavuihin.
Eri lähde-/vientitunnisteet nimeävät saman poistosuojan molemmissa
kontekstiluvuissa. Väärä omistaja ja peruutus jokaisessa neljässä lukukohdassa
estävät todistuksen; uusi lease ei elvytä vanhaa valtuutta. Varmennettu vienti
säilyy myöhäisen valtuusmenetyksen jälkeen, ja epävarman prosessisiivouksen
aineisto säilytetään. Rajattu riippumaton katselmus ei jättänyt tähän
liitokseen löydöksiä. Snapshotin lähde, SQLite, prosessiraja, kuljetus ja
fyysinen varaus ovat injektoituja. Yrityskohteen, sulun, kertakulutuksen ja
null-paluun yhteiskytkentä sekä V1:n loppukatselmus säilyvät avoimina.
Koeehdokasta ei ole kytketty tuotantoon eikä käyttäjän poistopolkua avattu.

**Kohteen ja kuitin sidonnan täsmennys:** main kaappaa ennen snapshotia
rekisterin samat validoidut tavut ja slotti-identiteetit, kohteen labelin ja
lineagen, aiemman valinnan, nykyisen lease-valtuuden sekä yritysjuuren
nykyisellä varauslukijalla varmennetun identiteetin. Vahvistuksen luku ei
kutsu rekisterin korjaavaa recovery-lukua. Epäselvä slottivalinta estää
vahvistuksen; sitä ei korjata sivuvaikutuksena. Odotuksen aikana havaittu
muutos mitätöi kaapatun valinnan pysyvästi.
Lähteen ja viennin tarkistusprosessien tunnisteita ei anneta etukäteen:
ne sidotaan kuittia myönnettäessä vain mainin tarkistusomistajan todella
palauttamasta tuloksesta. Jatkuvuuden valvonta alkaa silti ennen snapshotia,
ei jälkikäteen. Hyväksytyt lähde-/vientisidonnat säilyvät muuttumattomina
myös myöhemmille sulku- ja siivoustarkistuksille. Elävän backendin nimetyn
poistosuojan voimassaolo varmennetaan myös myönnössä ja kulutuksessa;
pelkkä kanavan säilyminen avoimena ei riitä. Myöntö varataan ennen
ensimmäistä odotusta, eikä epäonnistuminen palauta samaa myöntöoikeutta.
Julkaisukuluttaja tarvitsee sekä synkronisen valtuusvartijan
että tuoreen rekisteri-/juurivalinnan tarkistuksen omissa I/O-rajoissaan.
Asynkronisen tarkistuksen paluun ja tilasiirtymän välissä tehdään vielä
synkroninen valtuustarkistus: tarkistuksen lopussa jonoutunut mitätöinti
ei saa elvyttää myöntöä tai hyväksyä kulutusta.

**27.10.2026, kohteen ja kertakulutuksen liitoskoe:** 30 tapausta ja
tyyppitarkistus läpäisivät. Nykyinen rekisterilukija, todelliset rekisteri-
ja hakemistoidentiteetit sekä aiempi suojattu salattu vienti ovat mukana.
Muuttunut nimi, lineage, valinta, slotti, samansisältöinen uusi tiedosto,
vaihtunut yritysjuuri ja uusi samanlainen lease eivät elvytä vanhaa valtuutta.
Kuitti torjuu väärät tarkistussidonnat, muuttuneen viennin, rinnakkaisen
kulutuksen, kuittauskatkon ja myöhäisen julkaisuvartijan käytön.
Null-valinta säilyy kohdetiedossa, mutta varsinainen null-paluu ei kuulu
tähän kokeeseen. Omistajien päättyminen ja viennin lopullisen uudelleenluvun
rajapinta ovat vielä injektoituja, samoin aiemman kokeen prosessi-/SQLite-
ja fyysisen varauksen rajat. Katselmuksen kolme sidonta-/mitätöintipuutetta
korjattiin koeehdokkaaseen. Nimetyn suojan mitätöinti toistui ennen korjausta
kahdessa hylkäävässä kontrollissa; korjattu sarja sisältää ne sekä myönnön
odotuksen aikaisen uudelleentulon ja peruutuksen. Myös tarkistuksen
paluuhetken mitätöintikilpailu toistettiin kahdella hylkäävällä kontrollilla
ennen korjausta. Rajattu jälkikatselmus ei jättänyt tähän muutokseen löydöksiä.
Tämä ei ole V1:n kokonais- tai tuotantohyväksyntä.

**Seuraava sulkuliitos:** toimivan broker-kanavan valtuus päättyy myös
hallittuun backend-sulkuun. Sitä ei saa käyttää sulun jälkeen eikä korvata
pelkällä kanavan puuttumisella. Nykyisen suojatun shutdown-ketjun pitää
todistaa saman nimetyn poistosuojan kelpoisuus ennen sulkua ja sulun
lopussa, varsinainen onnistunut exit sekä mainin I/O:n päättyminen ja
varauksen palautuminen. Update-/restore-valtuutta ei lainata. Yhteyskatko,
väärä operaatio, pakotettu exit tai epävarma sulku eivät anna jatkovaltuutta.
Tämä liitos sekä capabilityn elinikä ja käyttäjän valitsema paluu ovat
vielä todennettavia, eivät yllä olevan kohdekokeen tuloksia.

**27.10.2026, nimetyn sulun osakoe:** nykyisistä `backendMessages`-,
`backendRunner`- ja `backendProcess`-omistajista johdettu ehdokas lisää vain
poiston oman `shutdownForDelete` / `stopForDelete` -haaran nykyiseen strict-
sulkuun. Oikea maintenance-tila ja snapshot-broker tarkistavat saman
poistosuojan ennen palvelinsulkua ja sen jälkeen. Väärä omistaja, eri
huoltotarkoitus, umpeutuminen, katkos, varauksen menetys ja ristiriitainen
seuraajapyyntö eivät anna onnistumista. Lähettäjä säilyttää todellisen
exitin ja varauksen takaisinoton odotuksen eikä käytä forced-fallbackia.
179 nykyistä ja uutta tarkistusta sekä tyyppitarkistus läpäisivät.
Testikellon virhe korjattiin kokeeseen; katselmuksen löytämä testin
odotusportin siivouspuute korjattiin ja katettiin virhekontrolleilla.
Jälkikatselmus ei jättänyt tähän rajattuun muutokseen löydöksiä.
HTTP-palvelin, kuljetus, prosessin exit ja fyysinen varaus ovat injektoituja;
runnerin ja lähettäjän testit eivät vielä ole oikean utility-prosessin näyttö.

**27.10.2026, valitsimen paluun osakoe:** nykyinen selector-lifecycle saa
nimetyn delete-leasen nykyiseen sallittujen hallintatarkoitusten joukkoon.
47 tarkistusta, tyyppitarkistus ja rajattu katselmus läpäisivät. Samanniminen
uusi lease ei palauta vanhaa valtuutta; valitsimen tai varauksen menetys
odotuksessa estää jatkon. Sulku ei pyydä paluuta automaattisesti eikä
korvaa null-valintaa yrityksellä. Nimenomainen paluupyyntö käyttää nykyistä
palvelun valmistumisen jälkeistä relaunch-omistajaa. Fyysinen varaus ja
relaunch ovat tässä injektoituja: todellinen native-/UI-paluupolku säilyy
V3:n vaatimuksena. Tuotantoon ei ole kytketty poistokanavaa.

**Yhteiskytkennän valtuusraja:** nykyinen active-lifecycle välittää
poiston oman sulkutarkoituksen samoille resursseille. Ennen sulkua
poistokuitti vaatii elävän backendin named-fence-tarkistuksen. Oman sulun
aikana kuittia ei voi kuluttaa. Sulun jälkeen valtuus perustuu vain saman
pyynnön onnistuneeseen strict-exitiin, mainin I/O:n päättymiseen, varauksen
palautumiseen ja edelleen voimassa olevaan kohde-/lease-valintaan.
Ulkoinen mitätöinti säilyy pysyvänä myös oman sulun aikana; pelkkä onnistuva
osakoe tai suljettu kanava ei muuta sitä jatkoluvaksi.

**27.10.2026, aktiivisen yrityksen yhteiskytkentäkoe:** 52 tarkistusta
(27 uutta ja 25 nykyistä lifecycle-kontrollia), tyyppitarkistus ja rajattu
katselmus läpäisivät. Hallintapyynnön elinikä, todellinen rekisterivalinta,
nimetty poistosuoja, salattu vienti, secret-/arkisto-drain ja active-lifecycle
osallistuvat samaan kokeeseen. Oma sulku säilyttää vain alkuperäisen
pyynnön; ulkoinen mitätöinti ei poistu exitin tai varauksen palautuessa.
Peruutus pyytää paluuta vain käyttäjän erillisestä valinnasta.
Valmistelun virhe liittyy samaan nimettyyn sulkutehtävään, ja ensimmäinen
syy säilyy erillään mahdollisesta siivousvirheestä. Kuitin valmistumisen
jälkeen tehdään tuore kohde- ja valtuustarkistus ennen native-vahvistusta.
Katselmuksen vanhentuneen vahvistuksen aukko toistettiin ja korjattiin;
tavallisen ja päivityssulun ensin valittu käytäntö säilyi myös niiden
epäonnistuessa. Testien oma siivous raportoi epäonnistumisen.
Prosessin exit, HTTP, fyysinen varaus, SQLite, native-dialogit ja viennin
lopullinen uudelleenlukija ovat edelleen injektoituja. Tämä ei todista
niiden tuotantokytkentää, W7.4:n julkaisua tai kaikkia kohdetiloja.

**27.10.2026, V2:n ensimmäinen lähdepala:** arkistopalvelun pääsyn sulku,
rajattu I/O-drain ja epävarman kahvasulun aineistonsäilytys sekä archive-
capabilityn vanhentuneiden native-jatkojen esto on siirretty nykyisiin
omistajiin pysyvin regressioin. Yrityshallinnan `closeAdmission()` estää
uudet pyynnöt erillään lopullisesta disposesta; jo hyväksytyn työn
settlement seurataan edelleen palvelun ja capabilityn omissa joukoissa.
Navigointi/lataus sekä rendererin tai ikkunan päättyminen mitätöivät
vanhan dokumentin jatkot myös sender-/frame-olion säilyessä samana.
Mainin sisäinen `prepareDeletion` ottaa nykyisen mutaatiogaten ennen
ensimmäistä odotusta ja validoi koko muuttumattoman version/id/typedLabel/
backupChoice-pyynnön. Sen rajattu elinikä voi sulkea uusien pyyntöjen pääsyn
vain omaa sulkutehtäväänsä varten. Ulkoinen `closeAdmission`, dispose,
shutdown tai dokumentin vaihto mitätöi myös tämän säilytetyn valtuuden;
valmistumisen jälkeen talteen jäänyt callback ei anna jatkolupaa.
Palvelu seuraa valmistelutyön todellista päättymistä, mutta ei kirjaa
`prepared`, `cancelled` tai `returnRequested` -tulosta valmiiksi poistoksi.
Mainin sisäinen virhe säilyttää alkuperäisen syyketjun, julkiset kanavat
vain turvallisen koodin. Komennon puuttuminen pysäyttää valmistelun;
composition-juurten todellinen valmistelukuluttaja ei vielä ole kytketty.
Nykyinen yhteinen kohdesarja läpäisi 499 tarkistusta. Erilliset 315
main-kontrollia, backendin 69 ja API-clientin 39 lukijasopimusta läpäisivät;
määriä ei lasketa yhteen aikaisempien osajoukkojen kanssa. Rajattu
lähdekatselmus ja korjatun virheluokituksen jälkikatselmus valmistuivat.
Konkreettisen registry/create/import-virheen alkuperäinen syy säilyy myös
poistovalmistelussa ja saa sen suljetun koodin, ei toisen operaation koodia.
Nykyinen observer, JSONL-/incident-kirjoittaja ja todelliset Diagnostics-,
tukipaketti- sekä API-lukijat läpäisivät yhden liitoskokeen ilman
raakavirheen tai kohdetietojen julkaisua. Koetta ei nimitetä oikeaksi
Electron-/native-/SQLite- tai salatun toimituksen todistukseksi.
Koko W7.3:n prosessi-, paketti- ja PR/main-portteja ei ole tällä suljettu.

**V2:n kohde- ja omistajamatriisi:** seuraavat haarat toteutetaan samoihin
nimettyihin omistajiin; uutta päätös- tai elinkaarikerrosta ei lisätä.

| Tilanne | Valmistelun sopimus ja jäljellä oleva todennus |
| --- | --- |
| Kohde on avoin yritys ja käyttäjä valitsee backupin | Yllä kokeiltu caller-owned vienti ja named-stop. Tuotannon prosessi-, varaus- ja lukijarajat korvaavat injektoidut rajat V2/V3:ssa. |
| Käyttäjä valitsee erillisen menetyssuostumuksen | W7.0:n tiukka pyyntö, kirjoitettu nimi, erillinen riskivahvistus ja native-vahvistus sitoutuvat samaan valintaan. Sama kertakäyttöinen julkaisuraja ja kaikki omistajuus-/sulkutarkistukset säilyvät; backup-kuittia ei keksitä. Koko liitos testataan V2:ssa. |
| Kohde ei ole aiemmin avoin yritys | Kohde ja `previousActiveWorkspaceId` pidetään eri arvoina. Nykyinen active-lifecycle sulkee aiemmin avoimen runtimen; target-reader ei vaihda kohdetta siihen. Ilman kohteen snapshot-omistajaa backup-haara palauttaa `backupUnavailable`, ei avaa kohdetta tai vaihda menetyssuostumukseen automaattisesti. |
| Lähtö on backenditon valitsin | Nykyinen selector-lifecycle todistaa saman delete-leasen ja mainin fyysisen varauksen. Se ei luo business-runtimea tai backend-exit-tulosta. Peruutuksen nimenomainen paluu säilyttää null-valinnan. Koko request-/vahvistusliitos ja oikea varaus todistetaan V2/V3:ssa. |
| Kohteella on keskeytynyt palautus | W7.3 ei ohita yleistä journal-estoa. W7.4:n jo hyväksytty saman kohteen jäännös- ja omistajuustodistus tarvitaan ennen poikkeuksen kytkentää; tuntematonta tai asennustason tilaa ei hyväksytä. Pelkkä luotettavasti tunnistetun kohteen `recoveryRequired` ei itsessään muuta kohdetta toiseksi tai vaadi business-avausta. |

**Nykyinen lähdepala:** poiston oma maintenance-tilakone ja v13-broker,
installation-lease, tarkistusomistajan elinikään sidotut täydet kuitit sekä
caller-owned portable-vienti on yhdistetty nykyisillä tiedostotavuilla.
Tavallinen vienti vapauttaa edelleen oman suojansa; poiston vienti ei.
Alkuperäisen autentikoidun container-kahvan identiteetti säilyy, eikä
samansisältöinen uusi tiedosto korvaa sitä. Nimetty backend-sulku tarkistaa
saman suojan ennen palvelinsulkua ja sen jälkeen. Active-lifecycle liittyy
kaikkien aloittamiensa drainien loppuun myös virheessä; valitsin käyttää
nykyistä main-varaustaan ilman backendia.

Kohteen `workspaceDeletionTarget`-lukija kaappaa nyt samoista validoiduista
rekisteritavuista myös slotti- ja juuri-identiteetit. Se ei korjaa rekisteriä
vahvistuksen sivuvaikutuksena. Backupin `deletionBackupReceipt` sitoo
tarkistusomistajien todelliset tunnisteet ja yhteisen sisältövertailun
kertakäyttöiseen kuittiin. `readDeletionBackupExportIdentity` lukee lopulliset
tavut nykyisellä stream-erä- ja container-rajalla sekä odottaa lukukahvan
sulun; polun vaihtuminen myös sulun aikana hylkää tuloksen.

Mainin sisäinen `workspaceDeletionPreparation` käyttää näitä nykyisen
capabilityn pyynnön ja saman delete-leasen aikana. Se erottaa avoimen ja
muun kohteen sekä null-valitsimen; puuttuva snapshot-omistaja ei johda
aktiivisen yrityksen backupin käyttämiseen tai hiljaiseen menetyssuostumukseen.
Nykyiset mainin I/O-drainit alkavat backendin huoltokuittausta odottamatta,
ja kaikkien aloitettujen töiden päättyminen liitetään myös virheessä.
Julkaisukuluttaja saa muuttumattoman kohteen ja sekä kuitin että
valmistelun vartijat. Peruutuksen paluu vaatii edelleen käyttäjän valinnan.

Active-lifecyclen main-resurssit nimeävät nyt poistosulun erikseen:
arkiston todellinen drain, strict backend-stop ja main-varauksen palautuminen.
Oma capability-disposal säilyttää vain jo hyväksytyn hallintapyynnön;
ulkoinen shutdown mitätöi sen myös liittyessään aiempaan sulkutehtävään.
Tämä ei vielä kytke management-palvelun valmistelukomentoa molempien
composition-juurten tuotantokuluttajaksi. SQLite, kuljetus, exit, native-
dialogit ja fyysinen varaus ovat valmistelun liitosnäytössä kontrolloituja
rajoja, eivät oikean prosessiketjun tai koko W7.3:n hyväksyntä.

**V2:n päättämisjärjestys:** nykyinen `WorkspaceManagementService` hankkii
poistovalmistelun täsmällisen delete-leasen ja lainaa komennolle vain sen
vartijan. Komento ei vapauta varausta. Saman pyynnön elinikä ja sama lease
tarkistetaan synkronisesti deferred-paluussa; vain onnistunut
`returnRequested` sallii pyydetyn paluun. Deferred-omistaja kuluttaa pyynnön
ennen vartijaa ja callbackia, joten hylätty tai heittävä paluu ei toistu.
Asynkroninen vartija ei ole lupa. Oma admission-sulku ei yksin mitätöi
hyväksyttyä pyyntöä; ulkoinen sulku ja navigointi mitätöivät sen edelleen.

Paluucallbackin jälkeen palvelu odottaa saman leasen vapautuksen myös
virheessä. Mutaatiogate ja `pendingWork` kattavat koko päättämisen;
paluucallbackista alkanutta palvelun shutdownia ei odoteta sen oman työn
sisällä. Komennon ensivirhe säilyy alkuperäisenä syynä ja turvallisena
koodina, ja mahdolliset paluu- ja vapautusvirheet liittyvät järjestettyyn
syyketjuun. Loppuselvityksen virhe sulkee admissionin eikä tuota
onnistumis- tai uudelleenyrityslupausta. Turvallinen observer ei saa
raakavirheitä. Tavalliset create/import/replace/switch-komennot omistavat
edelleen omat leasensa ja nykyisen palautuspaluunsa.

Tämä in-memory-leasen vapautus ei avaa business-kirjoituksia eikä korvaa
backendin exitin tai mainin fyysisen varauksen todistusta. Tuotannon
composition-kytkentä, native-, exit- ja SQLite-portit ovat edelleen
erillisiä V2/V3-velvoitteita; uutta manageria tai poistokanavaa ei lisätä.

**V2:n ehdollinen composition-kytkentä:** nykyinen
`workspaceManagementComposition` muodostaa valmistelun samalla rekisterillä,
mutaatiogatella ja installation-leasella. Kukin pyyntö saa mainin uuden
operaatiotunnisteen ja oman runtime-sovituksen; valmistelun paluuvartija
liittyy palvelun vartijaan ennen nykyistä deferred-callbackia ja tyhjennetään
myös virheessä. Aktiivisen yrityksen ja null-valitsimen main-juuret tarjoavat
omat nykyiset lifecycle-/varausomistajansa. Vain aktiivisen kohteen backup
käyttää nykyistä portable-vientiä sekä mainin tiedosto- ja salasanaikkunoita.
Native-odotukset tarkistavat saman eliniän ennen seuraavaa sivuvaikutusta;
viennin uudelleenluku säilyttää vain valitun polun ja vartijan, ei salasanaa.

Kytkentä otetaan käyttöön vain mainin sisäisellä
`workspaceDeletionPublisher`-kuluttajalla. Nykyinen tuotannon entrypoint ei
anna sitä; ilman kuluttajaa valmistelukomentoa ei asenneta eikä kohdetta
suljeta. Nimetty testikuluttaja todistaa valmistelun rajaa, ei journalia,
poistoa tai `completed`-tulosta. Delete-IPC:tä, preloadia tai painiketta ei
lisätä. Oikean prosessin, SQLiten, fyysisen varauksen ja paketoidun ketjun
yhteisnäyttö sekä V3-hyväksyntä ovat edelleen tekemättä.

**V3:n todellisen kytkennän rajaus:** mainin nykyinen riippuvuuskokoelma
sisältää nyt saman `createWorkspaceManagementCapability`-factoryn.
Tuotanto käyttää alkuperäistä oletusta molemmissa composition-juurissa.
Testisovitus kutsuu sitä kerran muuttamattomilla optioilla, ottaa viitteen
syntyneeseen capabilityyn ja palauttaa mainille saman olion. Se ei luo
toista capabilityä, muuta pyyntöelinikää tai lisää lifecycle-kahvaan uutta
toimintoa. Kontrolloidut main-testit käyttävät nyt tätä capabilityä
palvelun suoran kutsun sijaan; kontrolloitu Electron-eventti ei kuitenkaan
ole oikean IPC-rajan todiste.

Electron-todennuksen lähdekytkentä on nykyisen `isolatedElectronTest`-
fixturen sisällä. Vain nimettyyn testiskenaarioon valmistellun yksityisen
sovelluskopion preload saa yhden nimetyn valmistelukutsun; tuotannon
preload, julkinen tyyppisopimus ja build pysyvät muuttumattomina. E2E-main
rekisteröi sen testikanavan vasta compositionin valmistuttua ja välittää
tuoreen oikean `IpcMainInvokeEvent`-olion sekä alkuperäiset argumentit
samalle capabilitylle. Vapaata IPC-/metodivalintaa, tallennettua eventtiä,
korvattua sender/frame-arvoa tai valtuuden ohitusta ei sallita.
Pyyntö käy nykyisen validoinnin ja dokumenttisukupolven läpi; renderer
ei saa capabilityä, vartijoita, polkuja tai alkuperäisiä virhesyitä.

Testi käyttää nykyistä oikean backendin käynnistäjää ja havaintosovitinta,
ei fake-backendin sulkua tai mallinnettuja SQLite-omistajalaskureita.
Tarvittava synteettinen yritys muodostetaan nykyisellä luonti-/avauspolulla;
portin ja sessionin havainto sekä restart jäävät nykyiselle fixturelle.
Nimetty julkaisukuluttaja tarkistaa tuoreen valtuuden ja valinnan mutta ei
poista mitään eikä palauta `completed`-tulosta. Ulkoisen sulun koe pitää
pyynnön kesken myös backendin päättymisen jälkeen; vain tuotannon oma
shutdown saa odottaa sen loppuun ja vapauttaa varauksen. Testiapuri ei
korjaa tätä odottamalla capabilityä erikseen. Testikanava ja viitteet
suljetaan myös startup-virheessä ja uudelleenkäynnistyksessä.
Alkuperäinen syy tarjotaan nykyiseen yksityiseen keräykseen ennen IPC:n
virhemuunnosta. Main pitää ensimmäisen syyn muistissa; fixturen epäonnistunut
testi lukee nykyisen rajatun projektion ennen sulkua ja tarjoaa sen nykyiselle
runner-sinkille. Luku käyttää samaa rajattua toimitusbudjettia; katkos,
osittainen projektio ja puuttuva havainto eivät muutu täydelliseksi
keräysväitteeksi. Odotettu virhe onnistuneessa testissä ei tuota virheraporttia.
Requestin ja ulkoisen shutdownin ensimmäiset syyt säilyvät erillisinä;
odotettu pyynnön mitätöinti ei peitä myöhempää sulkuvirhettä. Nykyinen sinkki
validoi jo rajatun projektion samalla suljetulla tietueella, soveltaa nykyisen
redaktoinnin ja säilyttää alkuperäiset truncation-/incomplete-merkinnät.
Kirjoitin, toimitusbudjetti ja julkaisuraja eivät muutu. Odotettu
`failed`/`failed`-testitulos ei tuota uutta alkuperäisvirheraporttia, mutta
odottamaton timeout tai keskeytys ei kuulu tähän poissulkuun.

Neljä oikeaa Electron-tapausta läpäisi muuttumattomilla lähde-/build-
tavuilla nykyisen yritysluonnin ja -avauksen kautta. Ne kattavat peruutuksen,
native- ja julkaisuvastauksen pidon backend-exitin yli, todellisen
prosessivarauksen, clean-merkin ja yritysdatan säilymisen fyysisessä
restartissa. Native-vastaukset ovat ohjattuja sovituksia. Menetyssuostumuksen
hyväksyminen ei tässä poista tietoja: testikuluttaja palauttaa vain
valmistelun tuloksen. Erillinen OpenPGP-koe todisti alkuperäiset viesti-,
pino- ja syytavut sekä osittaisuuden säilymisen puretussa paketissa;
sen main-lukuraja oli kontrolloitu eikä se ole uusi hosted-CI-todiste.
Lopullisen raportointiehdon ja ajokytkennän täsmennykset seurasivat
tätä Electron-ajoa. Backup-haaran myöhempi näyttö on alla erikseen;
hardened-paketti ja viimeisimmän lähteen normaalit PR/main-portit
eivät sisälly tähän neljän tapauksen tulokseen.

Backup-haaran myöhempi rajattu Electron-todennus käytti oikeaa
salasanaikkunaa, caller-owned-vientiä, inspection-prosessia ja nimettyä
backend-sulkua. Onnistuvan viennin container sekä DB-/katalogimerkintöjen
tiivisteet autentikoitiin nykyisellä lukijalla; sama profiili, vientitavut
ja alkuperäisen yrityksen asiakas säilyivät fyysisessä restartissa.
Tämä ei ole viennistä palautetun asiakassisällön itsenäinen todiste.
Tiedostodialogin vastaus oli edelleen rajattu testisovitus.

Muuttumiskokeen ensimmäinen hylkäys johtui testin yrityksestä kirjoittaa
valmiin viennin tarkoituksella kirjoitussuojattuihin tavuihin. Vain
autentikoidun testikohteen turmeltamisvalmistelu korjattiin. Sen jälkeen
koe osoitti tarkistusaukon: vientitiedoston muuttaminen
testikuluttajan julkaisunodotuksen aikana ei estänyt valmistelun
päättymistä. Aiempi `deletionBackupReceipt` luki identiteetin ja tiivisteen
vain ennen julkaisucallbackia; myöhempi `assertSelection` tarkisti valtuuden,
kohteen ja päättyneet omistajat, ei vientitavuja. Tämä korjattiin nykyisen
kuitin asynkroniseen julkaisuvartijaan. Sen
[tuoreustarkistus ja ensivirheen säilytys](local-backup-and-restore-plan.md#w73n-poiston-valmistelun-vientisopimus)
eivät lisää uutta lukijaa tai muuta aika-/sisältörajoja.

Rajatut regressiot toistivat sekä muuttuneen, korvatun tai puuttuvan
viennin hyväksymisen että siepatun tarkistusvirheen syyn peittymisen.
Lopullinen 179 kontrollin sarja läpäisi; riippumattoman katselmuksen
ensivirhelöydös korjattiin ja jälkikatselmus valmistui. Ensimmäinen
korjattu kuuden Electron-tapauksen ajo läpäisi ennen viimeistä
ensivirheen säilytysmuutosta. Myös lopullisen lähteen kuusi tapausta
läpäisivät ennen ajoa ja sen jälkeen varmennetuilla lähde-/build-tavuilla.
Muuttunut vienti hylättiin ennen julkaisua, turvallinen alkuperäinen syy
löytyi nykyisestä main-projektiosta ja yritysdata säilyi restartissa.
Onnistuva vienti sekä aiemmat peruutus- ja sulkukontrollit säilyivät.
Tämä ei vielä ole itsenäinen restore-/hardened-pakettitodiste;
koko W7.3:n, W7.4:n ja PR/mainin portit säilyvät avoimina.

**Toteutusjärjestys:** arkisto-/management-admissionin ja nimettyjen
maintenance-/inspection-/backup-/lifecycle-porttien jälkeen target-reader,
kertakäyttöinen valmistelu ja molemmat lifecycle-kutsujat liitetään nykyisiin
composition-juuriin. Pyyntö-/tuloscodec ja UI-valmistelu testataan ilman
tuotannon delete-kanavaa. Kukin pala säilyttää aiemmat kontrollit ja
todentaa virheen todellisen lukuketjun; V3:n yhteinen paketti ja PR/main-portit
eivät korvaudu osakokeiden lukumäärällä. Koekopiot eivät jää tuotantoon
rinnakkaisiksi omistajiksi.

**V1:n loppukatselmus 27.10.2026:** riippumaton rajattu katselmus ei
jättänyt toteutuksen aloittamista estävää päätöstä tai sopimusristiriitaa.
Se hyväksyy suunnitteluvaiheen sulkemisen ja yllä vaiheistetun V2:n aloituksen,
ei koko W7.3:a tai tuotannon poistovaltuutta. Aktiivisen kohteen backup-
liitoksen näyttöä ei laajenneta menetyssuostumuksen, passiivisen/vikatilaisen
kohteen tai backendittoman valitsimen valmiiksi yhteiskytkennäksi.

**Toteutuspalat ja todennus:**

| Pala | Muutos ja tarvittava näyttö |
| --- | --- |
| V1 / sopimus | Yksi rajattu riippumaton lähdekatselmus ja pieni nykyisiin omistajiin perustuva composition-koe omasta sulusta, ulkoisesta mitätöinnistä sekä caller-owned backupista. W7.0:n injektoituja kokeita ei nimetä uudelleen tuotantonäytöksi. Arkistosulun koe käyttää yllä hyväksyttyä budjettia. |
| V2a / valtuus | Tiukat codec-/capability-/UI-sukupolvitestit, oikea rekisteri ja varaus; rinnakkainen pyyntö, reload, peruutus, nimeäminen ja myöhäinen callback. W7.3:n toimituksesta puuttuva delete-kanava ja painike todennetaan erikseen. |
| V2b / backup | Nykyiset `portableProfileBackup.test.ts`, `profileSnapshotInspectionClient.test.ts` ja `profileMaintenanceState.test.ts`: todellinen synteettinen SQLite/container, lähde/vienti/siivous, muuttuneet tavut, samansisältöinen eri tiedosto ja suojan menetys. Tavallinen backup vapauttaa suojan edelleen; poistokuitti ei. |
| V2c / sulku | Nykyiset arkiston service/broker/capability-testit, `workspaceManagementShutdown.test.ts` ja molemmat lifecycle-testit: oikean aloitettavan työn, jonon, native-jatkon, exitin ja varauksen erot. Oma sulku ei odota itseään; ulkoinen sulku ei vapauta omistajuutta liian aikaisin. Virheessä muutkin omistetut sulut yritetään. |
| V3 / kokonaisuus | Oikea IPC/native/UI-ketju rajatulla testikuluttajalla sekä todellinen backup/inspection/exit-ketju; turvallinen syy ja alkuperäinen synteettinen virhe nykyiseen salattuun pakettiin, purkutodennus. Sama puhdas hardened Windows backup -> inspect -> restore -> restart -> compare, vaikutusalueen nykyiset stress/soak- ja PR/main-portit. Testikuluttaja ei korvaa W7.4:n todellista journal-/purge-todistetta. |

**27.10.2026, rajatun suunnitelmakatselmuksen tulos:** valmistelun
toimitusraja säilyttää W7.0:n sopimuksen. Kuitin callback-uudelleentulo ja
arkistokomennon sisäiset uudet kopioinnit täsmennettiin yllä. Pakolliseen
composition-kokeeseen kuuluu myös ulkoinen shutdown, joka liittyy jo
käynnissä olevaan omaan sulkutehtävään: se mitätöi poistovaltuuden ennen
julkaisua eikä ohita mitätöintiä shared-task-varhaispaluulla. Molempien
hallintaomistajien sulku ei saa muodostaa itseensä palaavaa odotusketjua
tai vapauttaa fyysistä varausta keskeneräisen työn alta. Yllä oleva
hallintapyynnön koe todentaa rajatun omistajakytkennän; fyysisen varauksen,
backup-kuitin ja koko peruutuspolun tuotantonäyttö säilyy avoinna.
Arkistoinnin koebudjetti ja peruutuksen käyttövalinta on hyväksytty yllä.
Katselmus ei ole koostumuskokeen tai tuotantotestien läpäisy.

Nykyiset `workspaceManagement.operationFailed`-tapahtumat ja hyväksytyt
W7.0:n suljetut operaatiot, vaiheet ja syyt palvelevat myös tätä muutosta.
Diagnosticsin ja nykyisen tukipaketin lukijat sekä testin ensivirheen
salattu keräys todennetaan kytkennästä, ei pelkästä logger-testistä.
Backendittoman tukipaketin laajennus säilyy W7.5:ssä. Uutta
business-audit-tapahtumaa, raakavirheiden julkaisua tai lokikehystä ei lisätä.

Toteutuksen mukana päivitetään muuttuvien rajojen omistavat backup-,
arkisto-, workspace-/ADR-, integraatiomatriisi- ja testiohjeet.
Tuotantototeutus ei saa arvata uutta sulkubudjettia, ohittaa yleistä
recovery-estoa tai nimetä valmistelua lopulliseksi poistoksi.

#### W7.4:n toteutussopimus

**Hyväksytty 6.11.2026:** A-F:n toteutus ja vaaditut PR/main-portit on
todennettu mainissa `3da3f6a29fda299221b01b067848fa634f1d882d`.
[PR #327:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/327#issuecomment-6678341652)
ja [M1:n nykytila](release-0.3.0-m1-preparation-plan.md#jatka-tästä) erottavat
hyväksytyn integraation vanhoista kokeista ja avoimista ensihylkäyksistä.
Tämän sopimuksen alla olevat päivätyt toteutus-/tutkimustilat ovat oman
revisionsa historiaa. Niiden keskeneräisyysmerkinnät eivät avaa hyväksyttyjä
osia uudelleen. Varsinaiset turvaehdot säilyvät; W7.5 ei sisälly hyväksyntään.

**28.10.2026: A:n journal-, kohdeluettelo- ja sidontatallennus; ei vielä poiston tuotantokytkentää.**
Lähtö on W7.3:n hyväksytty main `11e0eadfee002806db01a1b7152532e04dec5ca4`.
[M1](release-0.3.0-m1-preparation-plan.md#jatka-tästä) omistaa ajantasaisen
jatkamiskohdan. W7.0:n yllä olevat formaatit, keskeytystaulukko ja
W7-P1-P4 sekä W7.3:n vahvistus-/backup-/sulkusopimus säilyvät.
Tämä osio nimeää puuttuvat tuotantoliitokset; vanhoja kokeita ei
lasketa niiden hyväksynnäksi.

**A:n nykyinen kohdenäyttö:** `workspaces/deletion/` sisältää tiukat
inventory-/journal-codecit, rajatun JSONL-tarkistimen, kaikkien journal-
slottien sivuvaikutuksettoman tarkistuksen ja nykyistä selected-byte-storea
käyttävän journal-tallentimen. Tallennuspolku on mainin johtaman
`workspace-state/workspace-deletion-journal-v1.json` current/next/backup.
Initial-next ei anna jatkolupaa, muuttunut sidonta tai vaihehyppy hylätään,
ja terminal-clear vaatii erillisen aineiston poissaolon tarkistusportin.
Adoption nykyinen 13 merkinnän lista on yhteinen, ei poistajan kopio.

Kohdeluettelon tiedosto sijaitsee mainin johtamassa
`workspace-state/workspace-deletion-inventories/<operationId>/inventory.jsonl`-
polussa. Julkaisu luo operaatiokansion yksinomaisesti, kirjoittaa nextin
etenevällä offsetilla sekä tekee syncin, sulun, siirron ja rajatun
takaisinluvun ennen kuitin palauttamista. Aiemmin olemassa olevaa kansiota
tai partial-nextiä ei omaksuta uudeksi julkaisuksi. Luku tarkistaa alkuperäisen
tiedosto-/kansioidentiteetin, sitoumuksen ja sulun jälkeen säilyneet tavut.
Tekninen loppusiivous vaatii saman terminal-currentin ilman sivuslotteja;
luettelo ja tyhjä operaatiokansio poistuvat ennen journalia. Puuttuvan
luettelon tai kansion jatko kelpaa vain tässä loppuvaiheessa, ei payload-lupana.
Yhteiset emot, tuntematon lisätiedosto ja journal säilyvät epävarmassa tuloksessa.

`WorkspaceRemnantBindingStore` toteuttaa alla nimetyt viisi metadataosoitetta,
tiukan 4 KiB:n muodon ja kanonisen sidontatiivisteen nykyisellä byte-slot-storella.
Tavallinen luku vaatii currentin ja kaikkien slottien saman arvon, eikä korjaa
initial-nextiä. `clearAfterPayloadsAbsent` poistaa vain sidontametadataa;
normaalin omistajan ja poiston `purged`-loppusiivouksen portit erotetaan.
Jälkimmäisen sivuslottijatko vaatii erikseen tuoreen journal-/inventaario-/
registry-/poissaolotodisteen. Puuttuva metadatahakemisto voidaan todeta ilman
luontia tai synkronointia vain saman validoidun ancestorin ja uusitun
poissaolotodisteen kautta; olemassa olevan hakemiston sync-virhe hylkää edelleen.

Näiden ja nykyisten viereisten persistence-/adoption-regressioiden yksi
rajattu loppuajo läpäisi 352 testiä; kaksi POSIX-testiä odottaa Linux-näyttöä.
Desktopin jälkityyppitarkistus läpäisi. Julkaisun katselmuksessa todetut
lukukahvan sulun ja ulkoisen valinnan odotusikkunat toistettiin ennen korjausta
neljällä hylkäävällä regressiolla ja korjattiin tarkistusjärjestykseen.
Myös viimeisen journal-odotuksen aikana vaihtuva tyhjä juuri toistettiin
ja korjattiin rmdir-rajan tuoreeseen lähdetarkistukseen. Riippumaton
rajattu delta-katselmus sulki kaikki kolme havaintoa ilman muita löydöksiä.
Sidontasiivouksen katselmuksen puuttuvan hakemiston alustakohtainen ero
toistettiin hylkäävällä kokeella, korjattiin ja delta-katselmuksessa suljettiin.
B-F ovat vielä avoimia. Injektoitu ulkoinen guard,
terminal-journal ja uusi tallenninolio eivät todista payloadien todellista
poistumista, omistajuusketjua tai prosessikatkosta. Poistokanava pysyy suljettuna.

**Toimitusraja:** toteutetaan yksi mainin omistama lopullinen poisto,
johon vahvistettu live-pyyntö ja kylmäkäynnistys liittyvät eri sisääntuloista.
W7.4 ei lisää HTTP-poistoa, toista recovery-järjestelmää, tietokantamigraatiota,
riippuvuutta tai yleistä manageria. W7.5 omistaa näkyvän poistotoiminnon ja
backendittoman tukipaketin käyttöönoton. Delete-IPC, preload ja poistopainike
pysyvät suljettuina, kunnes myös niiden valmis palaute-/tukiketju on todennettu.
W7.4 todentaa oikean sisäisen kuluttajan nykyisellä rajatulla testikytkennällä;
testiportti ei saa päätyä tavalliseksi käyttäjän poistooikotieksi.

##### W7.4:n omistajat ja muutosjärjestys

Lähdepolut ovat `apps/desktop/src/`-juuresta. Uudet poistokohtaiset
codec-, store-, inventaario- ja siirtoapurit sijoitetaan
`workspaces/deletion/`-alueelle. Ne käyttävät nykyistä
`workspaces/persistence/`-tiedosto-/slot-toteutusta. Käyttötapauksen
admission, seuranta ja elinikä pysyvät `WorkspaceManagementService`ssä,
eivät siirry uuteen yleiseen orkestrointikerrokseen.

| Pala | Nykyinen omistaja ja rajattu muutos | Todiste ennen seuraavaa liitosta |
| --- | --- | --- |
| A: pysyvät tavut | Poistokohtainen journal, muuttumaton kohdeluettelo ja omistajien sidontatallennin nykyisillä slot-/tiedostoporteilla. Uudet nimet ovat toteutusehdotuksia, eivät olemassa olevan toteutuksen väitteitä. | Tiukat formaatit, kaikki slotit, readback, initial-next, katkennut kuittaus, stream-rajat ja terminal-siistintä oikeilla tiedostotavuilla. |
| B: aineiston alkuperä | Replacement-, activation-migration-, import-, adoption- ja inspection-omistajien alla luetellut liitokset; oman aineiston luettelo ja loppusiivous tulevat samoilta omistajilta. | Sidonta ennen payloadia, alkuperäinen juuri-identiteetti, journalin poistumisen jälkeen säilyvä sidonta, epävarman siivouksen/paluun esto. Tavalliset onnistuvat palautuspolut säilyvät. |
| C: vahvistuksen luovutus | `workspaceDeletionPreparation.ts`, `workspaceDeletionTarget.ts`, `workspaceManagementService.ts` ja `workspaceManagementComposition.ts`. | Oikea W7.3-kuitti + journal: ei siirtoa valmistelun päättämistarkistusten sisällä; sama lease säilyy luovutuksen yli. Epävarma julkaisu ei ole peruutus. |
| D: poisto ja registry | Poistokohtainen yhteinen eteneminen sekä `workspaceRegistryMutations.ts`, `WorkspaceRegistryStore.inspectSlots/writeSelected/recoverSelected`. | Jokainen keskeytystaulukon raja, osittaiset siirrot/poistot ja vanhan rekisterislotin torjunta; muiden yritysten kaikki tavut säilyvät. |
| E: cold-admission | `workspaceColdRecoveryAdmission.ts`, `workspaceColdRecoveryAdmissionComposition.ts`, `recoverWorkspaceManagementBeforeRuntime`, nykyiset management-/selector-guardit ja `desktopComposition.ts`. | Deletion valitaan ennen korjaavaa registry-lukua/adoptionia/business-avausta. Todellinen restart jatkaa samaa poistajaa tai pysähtyy säilyttäen epävarman aineiston. |
| F: lopputulos ja integraatio | Nykyinen operational-observer, virhesopimus ja sallitut lukijat; aktiivisen ja backendittoman mainin composition. | Ensivirhe ja cleanup erillään, alkuperäinen synteettinen syy puretussa salatussa paketissa, oikea prosessi-/pakettiketju sekä uuden revision PR/main-portit. |

**B:n täsmälliset kutsujat:** replacement julkaisee kohdesidonnan ennen
`prepareCandidate/stageBackup`-kutsuja. Activation-migration julkaisee sen
tuoreen `reprove()`-tarkistuksen jälkeen ennen `createAndStage()`a;
nykyinen snapshot-before-stop ja candidate-after-exit eivät vaihda järjestystä.
Import julkaisee vasta uuden workspaceId:n varauksen ja autentikoidun
source-lineagen jälkeen, ennen `createCandidate/stageBackup`a. Epävarma
kirjoitustulos estää myös nykyisen `ensurePreviousWorkspaceRunning()`-haaran.
Legacy-adoption julkaisee hyväksytyn `accept(profileId)`-sidonnan ennen
candidate-/journal-loppusiivousta; `fresh` ei luo legacy-lähdettä.
`runOwnedProfileInspection` käyttää `WorkspaceCandidateInspectionCopy`n
alkuperäistä luontikuittia, julkaisee kohteen tuntevan kutsujan sidonnan ennen
grantia ja säilyttää nykyisen prepare/grant/exit-järjestyksen.
Kohteetonta preflightia ei sidota aktiiviseen yritykseen.

Sidonnan tyyppisopimus ja polkuadapteri keskitetään workspace-omistajaan;
jokainen kutsuja omistaa edelleen oman julkaisunsa ja poistonsa.
Shared activation-root ei oikeuta yhteisen emon tai vieraan operaation
poistoon. Metadata pysyy payloadin ulkopuolella ja elossa niin kauan
kuin yksikin sidottu jäännös on olemassa. Historiallista sidonnatonta
jäännöstä ei jälkisidota nimen, nykyisen yrityksen tai samanlaisten tavujen
perusteella. Sen epävarmuus estää poiston valmistumisväitteen, ei muuta
portable backupin formaattia tai vanhan ehjän kopion hyväksyntää.

##### W7.4:n sidontametadatan tuotantosopimus

Tämä täsmentää W7.0:n kokeessa avoimeksi jätetyn tuotantoesityksen.
Muuttumattoman sidonnan nykyistä koemuotoa käytetään ilman uutta tilakonetta:

- Perusmuodon ainoat kentät ovat `formatVersion: 1`, `owner`, `operationId`,
  `workspaceId` ja `lineageIdentity`. Omistaja on `workspaceReplacement`,
  `workspaceActivationMigration`, `workspaceImport` tai
  `workspaceLegacyAdoption`. Nykyiset omistajien tunniste- ja lineage-
  validaattorit säilyvät; nullable-kohdetta ei lisätä.
- Inspectionin `owner` on `profileInspection` ja lisäkentät ovat
  `generationId`, `rootIdentity` sekä `parentIdentity`. Käytetään nykyistä
  inspection-operaatio-/generation-validaattoria ja alkuperäistä
  kopion luontikuittia, ei myöhemmästä polusta pääteltyä identiteettiä.
- Enintään 4 096 tavua per slotti; UTF-8 JSON ja lopettava LF. Kirjoitus
  käyttää yllä lueteltua avainjärjestystä ja `JSON.stringify`-esitystä.
  Virheellinen UTF-8, avaintoistot ja ylimääräiset kentät hylätään.
  Inventaarion `bindingSha256` lasketaan validoidun arvon tästä kanonisesta
  tavuesityksestä. Luku ei sekoita samaa normalisoitua arvoa raakatekstin
  muotoiluun eikä muuta lähdetiedostoa.
- Ei vaihetta, aikaleimaa, absoluuttista polkua, nimeä, salasanaa,
  runtimeSession-arvoa tai talletettua tiedostomuutoksen valtuutta.
  Neljän kilotavun raja koskee vain tätä kiinteää teknistä tietuetta,
  ei yrityksen, backupin, PDF:n tai virhepaketin kokoa.

`S` tarkoittaa mainin validoidusta installation-userData-juuresta johdettua
nykyistä `workspace-state`-kansiota. Seuraavat ovat W7.4:n uusia omistavia
polkusopimuksia, eivät väite jo olemassa olevista tuotantotiedostoista:

| Omistaja | Current-tiedosto suhteessa S:ään |
| --- | --- |
| Replacement | `workspace-replacement-bindings/<operationId>.json` |
| Activation-migration | `workspace-activation-migration-bindings/<operationId>.json` |
| Import | `workspace-import-bindings/<operationId>.json` |
| Legacy-adoption | `workspace-legacy-adoption-bindings/<workspaceId>.json` |
| Inspection | `profile-inspection-bindings/<operationId>-<generationId>.json` |

Next ja backup ovat saman tiedoston `.next`- ja `.backup`-päätteet.
Sidonnalle ei synny erillistä operaatiokansiota tai toista hakemistoindeksiä.
Adoption workspace-avain johtuu siitä, että `legacyEntry`-tietueessa ei ole
operationId:tä. Arvon operationId pysyy silti pakollisena ja candidate-roolin
operaation pitää vastata sitä. Activation-roolit tarkistavat replacementin
ja migrationin nimetyt sidontapaikat; täsmälleen yhden omistajan pitää
vastata tietuetta. Kahden omistajan ristiriitaa ei ratkaista valitsemalla
ensimmäinen. Kaikki polkuosat tulevat validoiduista tunnisteista, eivät
rendereriltä tai sidonnassa olevasta polusta.

Julkaisu vaatii kaikkien kolmen slotin poissaolon ja täsmällisen readbackin.
Tavallinen lukija vaatii currentin sekä kaikkien olemassa olevien slottien
saman validoidun arvon. Next-only, backup-only tai ristiriita hylätään;
luku ei korjaa tai poista slotteja. Metadata suljetaan portable backupista
ja tukipaketeista pois. Nykyinen polku-/tiedosto-omistaja tarkistaa
parentin, linkit, tyypit ja tuoreen valtuuden myös yksittäisten I/O:iden yli.

**Metadata-cleanupin oma keskeytyssääntö:** tavallista lukijaa ei käytetä
jo poistetun inspection-juuren tai osittain siivotun metadatan omaksumiseen.
Nykyiselle omistajalle nimetään rajattu `clearAfterPayloadsAbsent`-portti;
se ei siirrä tai poista payloadia. W7:n jatko saa käyttää sitä vain, kun
poistojournalin valittu julkaistu vaihe on `purged`, täydellinen sitoumukseen
täsmäävä luettelo on tallella, kaikki kohteen payload-/quarantine-juuret on
todettu poissa oleviksi ja kaikki registry-slotit ovat täsmällisessä
jälkeen-tilassa. Kirjoittajien poissaolo ja tuore lease todistetaan erikseen.

Jokainen jäljellä oleva sidontaslotti validoidaan omistajaan, kohteeseen ja
luettelon kanoniseen sidontatiivisteeseen ennen poistoa. Sivuslotit poistuvat
ennen currentia; poissa oleva slotti voidaan hyväksyä vain tämän rajatun
loppusiivouksen jo sallittuna välitilana. Kaikkien slottien puuttuminen ei
anna tavalliselle lukijalle onnistunutta sidontaa eikä lupaa uuteen
payload-poistoon. Virheellistä tai vierasta jäljellä olevaa tiedostoa ei
ohiteta. Mahdollisen saman kohteen recovery-journalin sovituksen tekee
sen nykyinen omistaja kaikkien slottien tarkistuksella, ei yleinen unlink.
Kaikki aloitetut I/O:t päätetään ja valtuus tarkistetaan odotusten jälkeen.
Terminal julkaistaan vasta metadatan todetun poissaolon jälkeen.
Inventaarioon sitomatonta uutta metadataa ei omaksuta tähän cleanupiin.
Tämä tarkistetaan myös cold-resumessa; vanhan leasen jatkuvuutta ei oleteta
uudelleenkäynnistyksen yli.

Normaalin omistajan onnistunut cleanup säilyy omana polkunaan: ennen
sidonnan poistamista se todistaa kaikki operaation aineistojuuret poissa
oleviksi ja työn päättyneeksi. Pelkkä journalin loppuminen ei riitä.
Payloaditon sidonta siivotaan tällä metadata-only-polulla **ennen lopullista
inventaarion täydellisyystarkistusta ja authorized-julkaisua**. Current ja
kaikki sivuslotit validoidaan täsmällisesti; inspectionilta ei tässä vaadita
jo poistetun kopion olemassaoloa. Sivuslotit poistuvat ennen currentia,
ja epävarma cleanup estää poiston valmistelun jatkon. Katkon jälkeen
next-/backup-only ei kelpaa. Kaikkien slottien puuttuminen todistaa vain
metadatan puuttumisen; payloadien poissaolo tarkistetaan erikseen.

Legacy-lähteen kaikkien 13 merkinnän puuttuminen ei riitä, jos adoption
candidate tai muu saman operaation payload on jäljellä. Sidonta säilyy
silloin ja mukana oleva candidate-tietue sitoo operaation ja hashin.
Candidate ei kuitenkaan ole pakollinen legacy-lähteen omistajuuden ehto.
Vasta kaikkien saman omistajan aineistojuurten poissaolo sallii
workspace-avaimisen sidonnan ennakkosiivouksen; uutta metadata-inventaarion
roolia ei lisätä.
Sidonnan puuttuminen ei missään polussa oikeuta tuntemattoman payloadin
poistamiseen. Uuden clear-portin todelliset ennen-/jälkeen-keskeytykset,
inspection-juuren poissaolo, samanniminen vieras slotti ja menetetty valtuus
todistetaan A-B:ssä ennen tuotantokytkentää; W7.0:n kokeet eivät kattaneet niitä.

##### W7.4 B: adoption hyväksynnän omistajuus

**30.10.2026: toteutussopimus ja rajattu main-kytkentä; native- ja
pakettihyväksyntä ovat vielä auki.** Tämä
täsmentää B:n legacy-adoption-sidontaa. ADR-0011:n copy/validate/switch,
`fresh`-ensikäyttö ja julkaisemattoman legacy-kopion palautuminen säilyvät.
`accept(profileId)` kutsutaan nykyisin backendin käynnistyksen, healthin ja
aktiivisen profiilin validoinnin jälkeen. Cold-importin fyysistä main-
varausta vaativaa vartijaa ei käytetä tässä vaiheessa. Backendia ei pysäytetä
tai käynnistetä uudelleen vain metadatan julkaisemista varten.

**Kolme valtuutta, samat nykyiset omistajat:**

| Vaihe | Todiste ja sallittu työ |
| --- | --- |
| Ennen backendia | Nykyinen startup-sukupolvi, installation-valtuus ja fyysinen main-varaus. Adoption alkuvalinta, candidate-copy/publish ja nykyinen unpublished-recovery tapahtuvat tässä. |
| Hyväksyntä backendin käydessä | Sama startup, täsmälleen business-backendille annettu siirtokahva, voimassa oleva granted-vaihe, saman backend-kahvan elävä tila ja validoitu profileId. Vain adoption valitun rekisterin/journalin ja legacy-sidonnan julkaisu sekä oman erillisen operation-rootin loppusiivous. Ei aktiivisen final-juuren, legacy-lähteen tai toisen yrityksen payload-muutosta. |
| Virhepalautuminen | Hyväksyntälupa on ensin suljettu ja sen alkuperäiset tehtävät päättyneet. Nykyiset broker-/inspection-sulut, backendin todettu exit ja varauksen takaisinotto edeltävät main-owned-recoverya. Aiempi epävarma kirjoitus tai omistajuus ei muutu valtuudeksi takaisinoton perusteella. |

`desktopComposition.ts` omistaa vaiheiden yhdistämisen. Nykyisen
`acquireDesktopWorkspaceReservation().bind()`-tulokseen lisätään mainin
sisäinen, **vain lukeva** `assertGrantedCurrent()`-vartija. Se tarkistaa
saman active-transfer-olion, granted-vaiheen, siirron signaalin ja alkuperäisen
valtuuden. Se ei suorita uudelleen kertakäyttöistä `assertCurrent()`-grantia,
hanki native-varausta, anna payload-oikeutta tai muuta backendin protokollaa.
Vanhan siirtokahvan tarkistus hylätään koskematta seuraavan siirron tilaan.
Nykyinen yleinen `WorkspaceProcessReservationTransfer` pysyy backendin
työlupaporttina; adoption lisähavaintoa ei vaadita muilta kutsujilta.

`backendProcess.ts` omistaa toistettavan synkronisen `assertRunning()`-
havainnon omasta olemassa olevasta tilastaan: ready, granted, ei stopping,
ei havaittua exitiä, ei mitätöityä siirtoa eikä peruttua startup-signaalia.
Tämä ei ole uusi health-kysely, poistumistodiste tai lupapalvelu. Pelkkä
`onUnexpectedExit`-callback ei riitä: exit voi tulla ennen callbackin
rekisteröintiä, ja tarkoituksellinen stop ei kutsu sitä. Nykyinen pysyvä
exit-havainto kattaa myös tämän välin. Handle-testikaksoiset päivitetään
eksplisiittisesti; puuttuvaa havaintoa ei tulkita onnistumiseksi.

Main kaappaa adoption operationId/workspaceId/root-valinnan ennen backendia
nykyiseen startup-ketjuun. `resolveDesktopWorkspaceStartup` ja
`resolveActiveWorkspaceStartup` välittävät vain adoption nimetyn omistajaportin.
Tuotannon adoption-kutsuja ei saa pudota vartioimattomaan oletukseen, jos
portti puuttuu; myös nykyiset suorat proof-kutsujat saavat oman aidon
varauskytkentän. Alemman tason testikaksoinen ei ole tuotannon fallback.
Main avaa hyväksyntäluvan vasta nykyisten health-/profiilitarkistusten jälkeen
juuri `activeWorkspace.accept()`-kutsun ajaksi ja sulkee sen `finally`ssa.
Lupa sitoo myös saman backend-kahvan, transferin ja profileId:n; yleinen
boolean tai sama polkumerkkijono ei riitä. `assertCurrent()` tarkistaa nämä
synkronisesti jokaisen odotuksen jälkeen ja ennen vaikutusta. Tarkistus
ei kierrä nykyisiä build-, FirstStart-, restore- tai update-portteja.
Hyväksynnän aikana ei avata rendererin business- tai management-käyttöä.

**Valittu metadata ennen ensimmäistä korjaavaa lukua:**

1. Adoption journal saa nykyisen byte-slot-omistajan `inspectRecoverySelection`
   / `recoverObservedSelection`- sekä valitut write/clear-portit. Alkuhavainnon
   kaikki slotit, niiden identiteetit, nykyinen current/backup/initial-next-
   etusija ja syrjäytettyjen katkenneiden sivujen käsittely säilyvät. Registry
   käyttää jo olemassa olevia vastaavia porttejaan. Pelkkä `peek` tai arvon
   operationId ei ole mutation-valtuus.
2. Guarded-reitti alkaa jo `resolveActiveWorkspaceStartup`in ensimmäisestä
   adoption-journalin korjaavasta luvusta. Tavallinen `journal.read()` ei saa
   korjata slotteja ennen valintaa. Ennen backendia otettu ja omilla kuiteilla
   päivitetty valinta kulkee saman adoption yli hyväksyntään; siellä ei
   omaksuta uutta ulkoista rekisteriä tai journalia alkutilaksi.
3. Adoption rajattu in-memory-valinta erottaa havaitun alkutilan ja jokaisen
   oman kirjoituksen kuittauksen/readbackin. Registry saa muuttua vain oman
   täsmällisen julkaisun kautta. Tallennin vartioi omia slot-siirtymiään;
   ulkoinen vartija tarkistaa muut omistajat eikä lue saman kirjoittajan
   journalia rekursiivisesti. Aloitetut rinnakkaiset luvut odotetaan loppuun
   myös hylkäyksessä. Valinnan epävarmuus jää pysyväksi tälle suoritusyritykselle.
4. Nykyinen cold-admission, build-admission ja W6/FirstStart-järjestys
   säilyvät. Create/import-admissionin `none` ei ole adoption kaikkien
   ristiriitojen tarkistustodiste. Importin conflict-censusta ei kopioida:
   se hylkäisi adoption oman journalin ja voisi hylätä hyväksytyn käynnissä
   olevan päivityksen. Adoption omat journal-/registry-/binding-valinnat
   tarkistetaan tässä; installation-/päivitysvalinnan nykyinen omistaja
   tarkistaa oman sallitun tilansa. W6:n legacy-adoption-haaran nykyinen
   `notRequired` ja passiivisen registry-tilan esto säilyvät. Näiden
   järjestysten regressionäyttö kuuluu main-kytkentään. Lopullisen W7-poiston
   admission tulee edelleen E-palassa ennen adoptionia, ei uutena recoveryna.

**Hyväksynnän tarkka järjestys:** validoitu profileId ja sama elävä backend
-> tuore journal-/registry-valinta -> legacy-sidonnan publish ja exact readback
-> nykyinen registry-julkaisu tai täsmällisen jo julkaistun arvon varmistus
-> `registryPublished`-journal ja kuitti -> oman candidate/operation-rootin
vartioitu loppusiivous ja poissaolotodiste -> journalin valittu clear.
Sidonta säilyy alkuperäisen legacy-lähteen vuoksi; journalin loppuminen ei
poista sitä. Käynnistyksen lopullinen hyväksyntä seuraa nykyisiä portteja.

- `fresh` ei julkaise legacy-sidontaa. Legacy-sidonta syntyy vain käynnissä
  olevan, journalin nimeämän adoption validoidulle kohteelle. Jo päättynyttä
  historiallista adoptiota ei jälkisidota aktiivisen yrityksen perusteella.
- Ensijulkaisu edellyttää kaikkien binding-slottien poissaoloa. Jo julkaistu
  täsmälleen sama sidonta hyväksytään vain nykyisellä strict-lukijalla;
  next-only, väärä lineage/operaatio, vieras tai ristiriitainen slotti estää
  jatkon. Epävarmaa kirjoitusta ei ratkaista saman käynnistysyrityksen
  myöhemmällä luvulla uudeksi onnistumiseksi. Uusi käynnistys saa todentaa tilan
  itsenäisesti.
- Mainin root-omistaja tarkistaa operation/candidate-juuren alkuperäisen
  valinnan, tyypit/linkit ja nykyiset sallitut merkinnät uudelleen viimeisten
  ulkoisten odotusten jälkeen ennen omaa poistoaan. Final-root ja vanhan
  runtime-lähteen 13 sallittua yritysmerkintää säilyvät. Installation-update-
  aineistoa tai ulkoista arkistoa ei siivota. Oikea I/O odotetaan loppuun;
  timeout ei anna lupaa aloittaa recoverya sen rinnalla.
- Tavallinen todettu sisältövirhe saa nykyisen `recoveryRequired`-merkinnän
  vain edelleen täsmällisen valinnan ja kyseisen vaiheen valtuuden alla.
  Kadonnut kuittaus, muuttunut valinta tai sulkeutunut hyväksyntälupa eivät
  saa pudota nykyiseen korjaavaan `markRecoveryRequired/read/clear`-polkuun.
  Ensivirhe säilyy ja erillinen sulkuvirhe kirjataan nykyisen sopimuksen mukaan.
- Sidonnaton cold-recovery säilyttää ADR-0011:n kolme unpublished-matching-
  legacy-haaraa, journalin loppupoiston ja relaunchin. Julkaistua rekisteri-
  kohdetta tai muuttunutta finalia ei poisteta. Sidonta ei anna aiempaa
  laajempaa payloadin recovery-oikeutta.

**Sidotun keskeytyksen jatkuvuus:** katko sidonnan julkaisun jälkeen ennen
rekisterijulkaisua ei saa jättää vanhaa sidontaa ja aloittaa käyttöönottoa
uusilla operationId/workspaceId-tunnisteilla. Uudessa sidotussa
`recoveryRequired`-haarassa current-sidonnan kaikki slotit, täsmällinen
journal-kohde ja sourceKind tarkistetaan ennen muutoksia. Rekisterin kaikkien
slottien pitää puuttua ennen siivousta ja uudelleen ennen vaikutuksia;
julkaistu kohde tai muu myöhemmin ilmestynyt rekisteri ei anna tämän
haaran jatkovaltuutta. Sidonnaton vanha haara säilyttää nykyisen sallintansa
myös vain muita yrityksiä sisältävälle rekisterille.

Kun vanhat lähdevertailu-, layout-, linkki-, omistajuus- ja sulkutarkistukset
sekä omien candidate/final-juurten poissaolo on todennettu, sidottu haara
kirjoittaa **saman** journalin valitusti takaisin nykyiseen `prepared`-tilaan
ja pyytää nykyisen hallitun relaunchin. OperationId, workspaceId, sourceKind,
createdAt ja alkuperäinen sidonta säilyvät. Uusi käynnistys käyttää nykyistä
copy/validate/switch-ketjua samalla operaatiolla; uusi validoitu profileId
verrataan säilyneeseen lineageen ennen registry-julkaisua. Uutta tilaa,
formaattia, palautusjärjestelmää tai ylimääräistä restart-silmukkaa ei lisätä.
Nykyinen tavallinen journal-write ei salli recoveryRequired -> prepared
-siirtymää eikä sen sääntöä avata yleisesti. Sama journal-omistaja tarjoaa
vain tähän todennettuun palautukseen nimetyn `prepareRecoveredSelection`-
portin: täsmälleen valittu recoveryRequired, muuttumattomat tunnisteet,
tuore main-/binding-/registry-valtuus ja palautusjuurten poissaolotodiste
vaaditaan. Tallennin vartioi omia slot-siirtymiään kuten muutkin valitut
kirjoitukset. Tavallisen write-portin hylkäys testataan säilyväksi.

Keskeytys ennen prepared-kuittausta jättää nykyisen recoveryRequired- tai
byte-slot-säännöillä erikseen havaittavan oman prepared-tilan seuraavalle
käynnistykselle. Kadonnut kuittaus tai epävarma siivous estää saman ajon
relaunchin; omistajuuden takaisinotto ei ratkaise sitä. Puuttuva, vieras,
next-only tai ristiriitainen sidonta estää jo sidotuksi valitun haaran eikä
pudota sitä sidonnattomaksi. Alkutilassa kaikkien slottien todettu poissaolo
säilyttää vanhan sidonnattoman haaran; puuttuvaa historiallista tapahtumaa
ei arvata. Osittainen tai virheellinen alkutila ei ole poissaolo.
Legacy-lähde ja sidonta säilyvät. Sama-operaatio-jatko ja
katkot jokaisessa poiston sekä prepared-julkaisun välissä todistetaan
oikeilla tavuilla ja uudella omistajalla ennen tämän haaran main-kytkentää.
Osittainen poisto ei anna oikeutta jatkaa enää lähdettä vastaamattoman puun
siivousta. Sama operationId ei uusi vanhaa vartijaa tai juuri-identiteetin
kuittia; uusi käynnistys hankkii oman nykyisen valtuutensa ja havaintonsa.

**Toteutuspalat ja regressiot:**

1. Nykyisen main-varausomistajan granted-havainto ja backend-kahvan pysyvä
   tilahavainto. Testaa toistettava hyväksytty luku, bound/authorized/stop/exit/
   reclaim/mitätöity/sukupolven vaihto, myöhäinen callback sekä vanhan guardin
   hylkäys seuraavaa omistajaa rikkomatta. Ei uutta siirtoviestiä tai ajastinta.
2. Adoption journalin valitut portit, registry-kuitit ja root-vartijat.
   Oikeilla tavuilla current/backup/next, katkennut sivu, lost ack, alkuperäisen
   identiteetin vaihto ja drift viimeisen ulkoisen awaitin aikana. Binding-
   store ja registry-persistence käytetään yhteisinä, ei kopioituina.
3. `workspaceLegacyAdoptionStartup/Recovery` ja main-kutsujat. Säilytä fresh,
   legacy, jo julkaistu registry, vanha keskeytysjournal ja epäonnistuneen
   backendin nykyinen palautuminen. Katko hyväksyntä jokaisessa yllä nimetyssä
   julkaisuvälissä; tarkista säilyneet tavut, ei vain virhekoodia. Vaihekohtaiset
   testit osoittavat ettei elävän backendin hyväksyntä kutsu stop/reclaimia.
4. Oikea main/backend/Electron-kytkentä ja saman puhtaan hardened-paketin
   backup/inspect/restore/restart/compare. Syntynyt binding säilyy journalin
   poiston ja uuden prosessin yli; alkuperäinen legacy sekä muiden yritysten
   aineisto säilyvät. Ensivirhe kulkee nykyiseen salattuun testiaineistoon.

Toteutuksen nimet täsmennetään nykyisiin portteihin; sopimus ei hyväksy uutta
manageria, pysyvää formaattia, yleistä callback-kehystä tai timeout-muutosta.
Sopimuskatselmus ja nykyisten kontrollien läpäisy eivät yksin todista uusia
vartijoita, native-omistajuutta tai koko W7.4:n hyväksyntää.

**Rajattu sopimuskatselmus 30.10.2026:** sidotun keskeytyksen tunnisteiden
jatkuvuuspuute täsmennettiin yllä, ja jälkikatselmus valmistui ilman avoimia
estäviä löydöksiä sopimuksen rajauksessa. Nykyiset adoption-, varaus- ja
backend-kontrollit läpäisivät 151 testiä; startup-/W6-kontrollit 41 testiä.
Tuotantokoodia ei tämän sopimuksen valmistelussa muutettu. Uuden
palautussiirtymän ja vartijoiden näyttö jää nimetyille toteutuspaloille.

**Vartija- ja journal-porttien checkpoint 30.10.2026:** mainin toistettava
granted-havainto ja backendin pysyvään tilaan perustuva käyntihavainto on
toteutettu. Adoption journal käyttää nyt yhteisiä observed-/selected-portteja
sekä rajattua `prepareRecoveredSelection`-siirtymää; tavallinen write pysyy
ennallaan. Epävarmuushavainto saa alkuperäisen syyn ennen turvallista
virhemuunnosta. Uuden portin kutsuja vastaa edelleen tuoreesta main-, sidonta-,
registry- ja payload-poissaolovaltuudesta sekä saman ajon pysyvästä sulusta.
Yhtenäisen 12 tiedoston sarjan 334 testiä, desktopin tyypitys sekä molempien
palojen rajattu riippumaton katselmus läpäisivät. Sarja sisältää vanhoja
kontrolleja, ei 334 uutta testiä. Tämä ei vielä kytke vartijoita adoption
startup-/recovery-omistajaan tai todista native-/pakettirajaa. Seuraavana
ovat valintakuittien, root-vartijoiden ja nykyisten kutsujien kytkennät.
Electron-testiruntimen eksplisiittiset kahvat välittävät uuden käyntihavainnon;
19 regressiota, testiruntimen tyypitys ja rajattu katselmus läpäisivät.
Laajassa main-sarjassa yksi nykyinen cold-forward-replacement-tapaus
aikakatkaisi ja keskeneräisen työn suoja esti myöhempiä tapauksia. Yksi
sallittu kahden variantin kohdeuusinta läpäisi samoilla aikarajoilla.
Ensiajo ja sen keskeneräinen siivoushavainto säilyvät avoimina; koko
main-sarjaa tai alkuperäisen viiveen syytä ei merkitä tämän perusteella
hyväksytyksi. Paketti- ja PR/main-portit ovat edelleen erillisiä ja avoimia.

**Root-porttien checkpoint 30.10.2026:** nykyinen tiedosto-omistaja vastaanottaa
valinnaisen vaihekohtaisen valtuuden valmisteluun, julkaisuun ja kolmeen
vanhaan palautussiivoukseen sekä hyväksynnän operation-siivoamiseen. Se
kaappaa kutsun polut ja hakemistoidentiteetit ennen ulkoista odotusta;
ainoastaan oma kuitattu hakemistonluonti päivittää puuttuneen juuren valinnan.
Vanhaa olemassa ollutta kohdejuurta ei valita uudelleen valmistelun jälkeen.
Ennen julkaisua tai poistoa tarkistetaan nykyiset sallitut merkinnät,
tiedostotyypit/linkit ja valittu juuri. Kopiointi ei aloita seuraavaa
merkintää valtuuden menetyksen jälkeen. Virheen alkuperäinen syy toimitetaan
epävarmuushavainnolle ennen turvallista virhemuunnosta; callbackin virhe ei
peitä sitä. Rinnakkainen inventaarioluku odottaa molempien lukujen ja
jokaisen aloitetun hash-virran sulkeutumista myös ensimmäisen virheen jälkeen.
Yhtenäisen yhdeksän tiedoston 138 kohdetestiä, desktopin tyypitys ja rajattu
riippumaton jälkikatselmus läpäisivät. Katselmuksen kolme puutetta
(julkaisun rakenne/linkit, siivottavan candidaten ylimääräinen merkintä ja
vaihtuneen kohdejuuren uudelleenvalinta) toistettiin oikeilla tiedostoilla
ennen korjauksia; niiden säilyttämisregressiot ovat mukana samassa ajossa.

Tämä portti ei ole koko käynnistyksen yli säilyvä root-kuitti tai uusi
elinkaaren omistaja. Vanhojen alempien kutsujien rajapinta säilyy;
tuotannon startup-/recovery-/main-kytkennän pitää seuraavassa palassa antaa
todellinen valtuus ilman vartioimatonta fallbackia sekä säilyttää alkuperäinen
metadata- ja root-valinta omien kuittien yli. Sidotun palautumisen samat
tunnisteet, sticky-epävarmuus, prosessiraja ja pakettinäyttö ovat edelleen
tämän liitoksen omia avoimia portteja, eivät root-porttitestien todisteita.

**Metadata-valinnan checkpoint 30.10.2026:** adoption rajattu
`WorkspaceLegacyAdoptionMetadataSelection` kaappaa journalin ja rekisterin
valinnan ennen korjaavaa lukua. Se käyttää samoja tallentimia ja tarjoaa
nykyiset read/write/clear-portit alkuperäisen valinnan ja omien kuittien
varassa. Kirjoittajan ulkoinen vartija tarkistaa toisen tallentimen, ei lue
saman kirjoituksen keskeneräisiä slotteja. Valinta tarkistetaan uudelleen
viimeisen ulkoisen odotuksen jälkeen. Kuittauskatko, valintamuutos tai menetetty
valtuus sulkee saman suoritusyrityksen jatkon pysyvästi; uuden itsenäisen valinnan
onnistuminen ei avaa vanhaa. Aloitetut rinnakkaiset havainnot ja kirjoittajan
sulku odotetaan loppuun myös virheessä. Rekisterin valittu kirjoitus tarjoaa
valinnaisen epävarmuushavainnon ennen nykyistä turvallista virhemuunnosta;
tavallinen write ja muut valitut kutsujat säilyvät ennallaan.

34 uutta testiä todentaa oikeat slot-tavut, kuittauskatkot, valtuuden menetyksen,
päällekkäisyyden, sulun ja nykyisen fresh-/legacy-startupin näillä adaptereilla.
Yhteinen 26 tiedoston vaikutusalueajo läpäisi 591 testiä; kolme nykyistä
POSIX-kohtaista tapausta jäi alustaehtonsa vuoksi ajamatta. Tyypitys ja
rajattu riippumaton katselmus läpäisivät. Näyttö ei ole mainin omistajuuden,
binding-valinnan, koko käynnistyksen root-kuittien tai prosessi-/pakettirajan
todiste. Niiden todellinen startup-/recovery-/main-kytkentä on edelleen
seuraava työ; tuotannossa ei sallita vartioimatonta fallbackia.

**Sidontavalinnan checkpoint 30.10.2026:**
`WorkspaceLegacyAdoptionBindingSelection` säilyttää yhden adoption
alkuperäisen sidontahavainnon ja oman julkaisun kuitin nykyisellä
binding-tallentimella. Kaikkien slottien tavut ja tiedostoidentiteetit
säilyvät valinnassa. Olemassa oleva täsmällinen sidonta hyväksytään strict-
lukijalla; pelkkä next/backup, väärä kohde tai ristiriita estää jatkon
aineistoa muuttamatta. Oman julkaisun arvo, tiiviste, kuitti ja nykyisen
tiedoston täsmällinen readback vaaditaan ennen valinnan muuttamista.
Ulkopuolelta ilmestynyttä samannäköistä sidontaa ei oteta omaksi kuitiksi.
Fresh-polku ei julkaise legacy-sidontaa. Adapteri ei poista sidontaa tai
payloadia eikä itsessään todista prosessin omistajuutta.

Rajatussa katselmuksessa toistettiin ja korjattiin molempien valinta-
adapterien viimeisen paluun valtuustarkistus sekä ensivirheen säilyminen,
kun jo ilmoitettua valtuusvirhettä seuraa kirjoittajan sulkuvirhe. Molemmat
syyt säilyvät, eikä jälkimmäinen ilmoitus korvaa ensimmäistä.
Sidonnan 36 testiä ja metadatan 36 testiä läpäisivät. Yhteinen 30 tiedoston
vaikutusalueajo läpäisi 701 testiä; kolme nykyistä POSIX-tapausta jäi
alustaehtonsa vuoksi ajamatta. Tyypitys ja rajattu riippumaton jälkikatselmus
läpäisivät. Päällekkäisten ajojen tuloksia ei lasketa yhteen.

Seuraavan yhteiskytkennän tarkennus on alla. Adapterien toteutus ei vielä
todista niiden main-kytkentää tai oikeaa prosessi-/pakettirajaa.

###### Adoption vartijoiden yhteiskytkentä

**30.10.2026: toteutussopimuksen tarkennus, ei tuotantokytkennän todiste.**
Yllä olevat kolme valtuusroolia ja hyväksymisjärjestys säilyvät. Ratkaisu
erottaa saman suoritusyrityksen pysyvän valinnan yksittäisen vaiheen
käyttöluvasta. Se ei lisää yleistä manageria, prosessia tai pysyvää formaattia.

**Yksi valinta, vaihekohtaiset näkymät:** metadata-, binding- ja root-
omistajat säilyttävät alkuhavainnon, omat kuitit ja sticky-epävarmuuden.
Niiden rajattu `forPhase(authority)`-näkymä käyttää samoja valintoja,
ei kaappaa tiedostoja uudelleen. Näkymän authority on muuttumaton, juuri
kyseiselle kutsuvaiheelle annettu olio. Tallentimen callback kaappaa sen
ennen ensimmäistä odotusta; se ei lue myöhemmin vaihdettavaa current-phase-
callbackia. Alkuperäiset tehtävät odotetaan loppuun ennen seuraavaa vaihetta.
Vanhan näkymän myöhäinen käyttö hylätään ennen I/O:ta eikä se mitätöi uuden
vaiheen valtuutta. Keskeneräisen työn valtuuskatko sen sijaan sulkee saman
suoritusyrityksen jatkon. Epävarmuutta tai journalin clearin jälkeistä retired-tilaa
ei nollata näkymän vaihdolla. Nämä ovat nykyisten adapterien sisäisiä portteja,
eivät rendererin capabilityja tai uutta elinkaaripalvelua.

**Tarkistusten kutsugraafi ei ole syklinen:** adaptereihin lisättävä
`assertObservedCurrent()` lukee vain oman alkuperäisen valintansa ja omat
kuitatut muutoksensa nykyisillä readonly-slot-/hakemistoporteilla. Se tarkistaa
saman vaihevaltuuden odotusten jälkeen, mutta ei korjaa slotteja, julkaise,
päivitä kuittia tai kutsu ulkoista vartijaa. Oman adapterin keskeneräistä
operaatiota ei saa lukea tämän portin kautta. Ylimmän tason adoption-ketju
on sarjallinen; päällekkäistä työtä ei jonoteta uudeksi oikeudeksi.

| Vaikutuksen omistaja | Sen ulkoinen vartija | Omistajan oma viimeinen tarkistus |
| --- | --- | --- |
| Journalin kirjoitus, korjaava luku tai clear | Bindingin ja rootin readonly-valinta sekä toinen metadata-tallennin | Journalin valitut slotit, nykyinen byte-slot-kirjoittaja ja synkroninen vaihevaltuus |
| Registryn kirjoitus tai korjaava luku | Bindingin ja rootin readonly-valinta sekä toinen metadata-tallennin | Registryn valitut slotit, nykyinen byte-slot-kirjoittaja ja synkroninen vaihevaltuus |
| Bindingin julkaisu | Molempien metadata-tallentimien ja rootin readonly-valinta | Bindingin valitut slotit, nykyinen kirjoittaja ja synkroninen vaihevaltuus |
| Rootin luonti, siirto tai poisto | Metadatan ja bindingin readonly-valinta | Alkuperäiset root-identiteetit, kyseisen vaikutuksen nykyinen rakenne-/sisältötarkistus ja synkroninen vaihevaltuus |

Metadata-omistaja tarkistaa edelleen itse kirjoittajan vastakkaisen tallentimen.
Toisen adapterin täyttä `assertCurrent()`-ketjua ei kutsuta ulkoisena vartijana.
Kirjoittajan omat slotit/juuret tarkistetaan viimeisten ulkoisten odotusten
jälkeen nykyisen omistajan sisällä; writer-tunniste ei salli muiden valintojen
ohitusta. Kaikki aloitetut luvut ja sulut päättyvät myös virheessä.

**Alkuvalinta ennen korjaavaa lukua:** `resolveActiveWorkspaceStartup`
valitsee journalin ja registryn readonly-portilla. Valituista tavuista
luetaan journalin arvo ilman korjaavaa `read()`-kutsua. Olemassa oleva journal
nimeää kohteen; journalittoman aidon ensikäytön tunnisteet luodaan kerran
nykyisillä säännöillä. Root-valinta ja nykyinen lähteen tunnistus tehdään
ennen prepared-julkaisua, ja binding valitaan samalle kohteelle. Kaappauksen
aikana vain readonly-työ on sallittu; kaikki valitut omistajat tarkistetaan
yhdessä ennen ensimmäistä korjausta tai kirjoitusta. Keskeneräistä kytkentää
ei toteuteta puuttuvan vartijan hyväksyvänä oletuksena. Aiempi
`registry.inspect()` tai `hasAnyJournalSlot()` on haaran havainto, ei tämä
valtuus. Ristiriita alkuhavainnon ja lopullisen valinnan välillä hylätään.
Normaali registry-/switch-/selector-haara ei saa adoption mutaatioportteja.

Nykyiset metadata- ja binding-`capture()` kutsuvat ulkoista vartijaa jo ennen
oman valintansa alustamista. Yhteiskytkentä erottaa niissä readonly-
alkuhavainnon ja valmiin valinnan käyttöönoton: alkuhavainnot kerätään saman
valmisteluvaltuuden alla ilman keskeneräisiä vertaisvartijoita. Vasta kaikkien
alkuperäisten havaintojen yhteisvarmennus avaa vaihekohtaiset mutaationäkymät
ja niiden keskinäiset vartijat. Epäonnistunut alustus ei palauta kirjoitus-
porttia. Puuttuvan vertaisen ohittavaa callbackia ei jätetä valmiiseen
adapteriin; valinnat eivät päivity yhteisvarmennuksen sivuvaikutuksena.

**Root-kuitti ulottuu koko suoritusyrityksen yli:** nykyinen
`workspaceLegacyAdoptionMutationAuthority` ja `NodeWorkspaceLegacyAdoptionRootStore`
säilyttävät saman valinnan prepare -> publish -> accept/recovery -ketjussa.
Valinta kattaa johdetut userData-, operations-, workspaces-, operation-,
candidate/runtime-, final/runtime- ja legacy-runtime-juuret, myös alkuperäisen
poissaolon. Olemassa olevan juuren identiteettiä ei korvata myöhemmällä
havainnolla. Oman onnistuneen mkdirin readback päivittää vain odotetun
puuttuvan merkinnän. Rename-kuitti vaatii alkuperäisen candidate/runtime-
identiteetin final/runtime-polussa, lähteen poissaolon ja muuttumattomat
vanhemmat. Oma rm-kuitti päivittää vain omistetun poistetun alipuun
poissaolon. Epäonnistunut tai kuittaamaton vaikutus ei muutu onnistuneeksi
myöhemmän havainnon perusteella. Nykyiset layout-, linkki-, hardlink-,
lähdevertailu- ja sisältöehdot säilyvät vaikutuskohtaisina tarkistuksina.
Live-backend saa edelleen muuttaa oman final-runtime-tietokantansa sisältöä;
sen sisältöhashia tai mtimea ei jäädytetä käynnistyksen yli. Hyväksynnän
siivous ei koskaan kohdistu tähän elävään juureen tai legacy-lähteeseen.

**Mainin täsmälliset liitoskohdat ja kutsusopimus:**

Seuraavat nimet kuvaavat toteutettavaa sisäistä rajapintaa, eivät jo kytkettyä
tuotantokoodia. Käyttötapauksen tiedostotyö säilyy adoption-omistajalla;
main antaa vain oman vaiheensa valtuuden.

| Nykyinen kutsukohta | Toteutettava rajattu muutos |
| --- | --- |
| `ActiveWorkspaceStartupOptions` | `adoptionAuthority` välittää valmistelun synkronisen `assertMutationCurrent`-tarkistuksen, asynkronisen `assertCurrent`-varaustodisteen ja `onUncertain`-ilmoituksen. Adoption-haara vaatii sen ennen korjaavaa lukua; normaali ja selector-haara eivät saa adoption-portteja. |
| `ActiveWorkspaceStartupSelection` | Adoption palauttaa muuttumattoman `adoptionContext`-olion: alkuperäinen valmisteluomistaja, operationId, workspaceId, sourceKind ja johdetut polut. Main tarkistaa omistajaolion samuuden omaan startupiin. Konteksti ei itsessään anna kirjoitusoikeutta. |
| `accept(profileId, adoptionAuthority?)` | Normaali/switch säilyttävät nykyisen kutsun. Adoption vaatii erillisen live-hyväksyntävaltuuden, täsmälleen palautetun kontekstiviitteen ja saman validoidun profileId:n. Puuttuva valtuus ei palauta vanhaa suojaamatonta polkua. |
| `recoverFromFailure(adoptionAuthority?)` | Adoption vaatii saman kontekstin exitin jälkeisen main-valtuuden. Normaali/switch ja niiden aktivointipalautus eivät käytä sitä. |
| Alempi `resolveWorkspaceLegacyAdoptionStartup` | `accept` saa pakolliset nimetyt hyväksyntäportit: journal, registry, bindingin julkaisu/tarkistus ja rajattu cleanup. `recoverFromFailure` saa vain kyseisen vaiheen journal-portin. Kumpikaan ei enää käytä valmistelusta talteen jääneitä portteja. |

Valmiin vaihenäkymän vertaisvartijat kutsuvat **saman vaiheen** muiden
näkymien readonly-lehtiä. Alkuperäisen `observe()`-olion valmisteluvaltuutta
ei käytetä live- tai recovery-vaiheessa. Kaikki kolme näkymää rakennetaan
ennen niiden ensimmäistä yhteistarkistusta; osittain alustettua porttia ei
palauteta. Metodit sidotaan alkuperäiseen vastaanottajaansa. Vaihetyyppi,
kontekstiviite ja voimassaolo tarkistetaan ennen I/O:ta ja odotusten jälkeen.
Vaiheolio ei korvaa alkuperäisen startup-omistajan `onUncertain`-kohdetta;
sama ensivirhe ja epävarmuus kulkevat kaikkien vaiheiden läpi.

1. `desktopComposition` antaa ennen `resolveDesktopWorkspaceStartup`-kutsua
   nimetyn adoption-portin. Se sitoo kerran valitun operaation, työtilan,
   lähdelajin ja johdetut juuret samaan startupiin, installation-valtuuteen
   ja main-varaukseen. Portti välitetään `resolveActiveWorkspaceStartup`iin
   ennen ensimmäistä korjaavaa journal-lukua. Valinnan kohde ei voi vaihtua
   myöhemmässä terminal-pyynnössä. Journalittoman alun tunnisteet ja aika
   välitetään nykyisillä generator-/now-porteilla, ei tuoteta toista valintaa.
   Myös suorat tuotanto-/proof-kutsujat saavat oikean varausportin; alemman
   tason testikaksoinen ei ole fallback. `resolveDesktopWorkspaceStartup` ja
   `resolveElectronE2eWorkspaceStartup` välittävät adoption-valtuuden myös
   ilman selector-valtuutta.
2. Nykyisen runtimen liitos palauttaa adoption-portille nimetyt hyväksyntä-
   ja virhepalautusvaltuudet, ei selectorin tai importin oikeuksia.
   Main muodostaa hyväksyntänäkymän vain `activeWorkspace.accept(profileId)`-
   kutsun ajaksi nykyisten health-/profiilitarkistusten jälkeen. Näkymä sitoo
   täsmälleen tämän `backendHandle`-olion, `backendReservation`-siirron,
   profileId:n ja alkuvalinnan. Vaiheolio annetaan suoraan hyväksyntäkutsulle,
   ei vaihdettavan current-phase-callbackin kautta. Se käyttää jo toteutettuja
   `assertRunning()`- ja `assertGrantedCurrent()`-havaintoja. `finally` sulkee
   näkymän; uusi kutsu ei elvytä vanhaa. Ei ylimääräistä stop/startia tai
   fyysisen main-varauksen vaatimusta backendin ollessa käynnissä.
   Elävän hyväksynnän payload-portti on todellinen nimetty loppusiivousolio,
   joka tarjoaa vain `discardCandidate`-toiminnon. Koko bound-root-storea
   tai pelkkää sen TypeScript-tyypin kavennusta ei välitetä hyväksyntään;
   final-juuren recovery-poisto ei saa olla tämän valtuuden kautta kutsuttavissa.
   Olemassa olevan registryn lineage tarkistetaan ennen bindingin julkaisua.
   Sen jälkeen järjestys on binding, registry, registryPublished-journal,
   operaation siivous ja journal viimeisenä. Fresh-haara ei julkaise bindingiä.
3. Virhepolku sulkee hyväksynnän, odottaa alkuperäiset adoption-tehtävät sekä
   nykyiset broker-/inspection-sulut ja todellisen backend-exitin/takaisinoton.
   Vasta sitten main antaa samalle valinnalle recovery-näkymän. Ilman
   palautunutta backend-kahvaa vaaditaan nykyinen startup-errorin poissaolo-
   ja valmistelun päättymistodiste. Recovery-valtuus käyttää takaisin saatua
   `assertMainOwned()`-varausta, ei vanhaa live-kahvaa. Vanha päättynyt lupa
   ei yksin pilaa turvallista uutta vaihetta; valinnan/kuittauksen epävarmuus
   estää sen.
4. Adoption alkuperäiset tehtävät kytketään nykyiseen startupin
   settlement-/varauksen mitätöintiin myös ennen `runtimeEntered`-kohtaa.
   Nykyinen startup seuraa alkuperäistä prepare-/accept-/recovery-lupausta;
   vain sen päättyminen lopettaa pending-tilan. Virheilmoitus tai peruutus
   ei ole valmistumistodiste. `onUncertain` tallettaa ensimmäisen syyn heti,
   mutta ei mitätöi backendin käyttämää varausta ennen stop/takaisinottoa:
   nykyisen varausomistajan mitätöinti estäisi myös takaisinoton. Runtime-catch
   mitätöi epävarman omistajuuden takaisinoton yrityksen jälkeen; ennen
   runtimea tapahtuva virhe tekee sen ennen ulompaa closea. Kummassakaan
   tapauksessa epävarmuus ei anna recovery- tai siivouslupaa.
   Ulompi composition-catch ei saa sulkea varausta eikä aloittaa recoverya
   keskeneräisen tiedostotyön rinnalla. Uutta timeoutia tai Promise.race-
   pohjaista valmistumistodistetta ei lisätä. Ensivirhe ja myöhempi sulkuvirhe
   säilyvät nykyisessä syyketjussa ennen turvallista virhemuunnosta.
   Myöhempi recovery-virhe liitetään ensivirheeseen eikä korvaa sitä.

**Palautumisen yhteensopivuus:** nykyisen `recoverWorkspaceLegacyAdoption`in
viimeinen `Promise.all([journal.read(), registry.read()])` ei sovi saman
metadata-valinnan sarjalliseen käyttöön. Valitussa polussa nämä luetaan
peräkkäin ja molemmat alkuperäiset valinnat varmennetaan vielä ennen clearia
tai sidotun haaran prepared-siirtymää. Päällekkäisyyssuojaa ei poisteta.
Tavallinen valmistunut sisältövalidoinnin virhe ja epävarma tiedostovaikutus
pidetään erillään: ensimmäinen saa nykyisen `recoveryRequired`-merkinnän
vain edelleen kelvollisella valinnalla; jälkimmäinen ei saa korjaavaa lukua,
merkintää tai siivousta uuden vaihevaltuuden avulla. Root-mutaation nykyistä
epävarmuushavaintoa ei muuteta no-effect-todisteeksi pelkän virhekoodin
perusteella. Sidotun haaran same-ID-jatko ja sidonnattoman kolme vanhaa
palautushaaraa toteutetaan yllä olevan sopimuksen mukaan, ei yhteisellä
uusia tunnisteita luovalla fallbackilla.

Sidotun prepared-siirtymän adapteri käyttää vain nykyistä
`prepareRecoveredSelection`-kirjoittajaa ja sen omaa kuittia. Lopullinen
vartija vaatii kaikkien registry-slottien poissaolon, saman bindingin sekä
candidate-, final- ja operation-juurten todetun poissaolon. Juuriin kohdistuva
lehtitarkistus ei saa kutsua writerin sisältä takaisin metadata-vartijaan.
Tämä kapea portti ei kuulu live-hyväksynnän journal- tai cleanup-olioon.

**Toiminnallinen toteutusjärjestys ja näyttö:**

1. Nykyisten valinta-adapterien vaihekohtaiset näkymät ja readonly-vartijat
   sekä koko suoritusyrityksen root-kuitit. Testaa todellisilla tavuilla jokainen
   taulukon kirjoittaja, alkukaappauksen katko, viimeisen awaitin valinnanvaihto,
   oma mkdir/rename/rm, kadonnut kuitti, vaihdettu juuri, vanhan näkymän kutsu,
   päällekkäisyys ja aloitetun luvun/sulun päättyminen. Ei vielä main-kytkentää.
2. Yksi startup/recovery/main-kytkentä näihin portteihin, ei uusi irrallinen
   vartijaketju. Säilytä fresh, legacy, jo julkaistu registry, kaikki vanhat
   journal-slotit, sidonnaton recovery ja W6/FirstStart-järjestys. Todista myös
   binding-katkon same-ID-jatko, backendin sallittu kirjoitus valmistelun
   jälkeen, stop/exit ennen tai kesken hyväksynnän, vanha callback seuraavan
   vaiheen aikana ja epävarmuuden vaikutus ulompaan varauksen sulkuun.
3. Rajattu riippumaton katselmus, nykyisten todellisten käynnistys- ja
   palautuskontrollien sekä uuden prosessi-/pakettikytkennän näyttö. Vertaa
   säilyneitä tiedostoja ja alkuperäistä syytä, ei vain virhekoodia. Aiempi
   main-sarjan aikakatkaisu säilyy erillisenä avoimena havaintona; tämä
   sopimustarkennus ei anna lisäuusintaa tai muuta nykyisiä aikarajoja.

**Historiallinen tavukoe ja oikea backend-näyttö:**

`workspaceStartupRecoveryProof`in tekstitavut säilyvät tarkoituksellisena
historiallisena aineistona. Sen adoption-osuus käyttää alempia nykyisiä
startup-/recovery-omistajia oikeilla tiedostotallentimilla ja nimetyillä
testivaltuuksilla. `resolveDesktopWorkspaceStartup`in nykyinen resolverin
injektio säilyttää relaunch- ja session-luontitarkistukset; niitä ei poisteta
alemman tason kokeeseen siirryttäessä. Molemmat build-admission-tarkistukset,
luonnin ja sidotun/sidonnattoman tuonnin cold-tapaukset sekä
`DESK-WORKSPACE-STARTUP-001`:n prosessi- ja ikkunamääräehdot säilyvät.
Tämän kokeen onnistuminen ei todista live-backend-hyväksyntää.

Oikea adoption-hyväksyntä on erillinen tapaus nykyisessä Electron-fixturessa:

1. `createWorkspaceFirstStartProofFactories` ja sen `withWorkspaceReservation`
   / `createCurrentFixture` tuottavat nykyisen todellisen SQLite/PDF-aineiston.
   Suljetun aineiston DB ja artifactit kopioidaan itsenäisinä tavuina erillisen
   testiasennuksen legacy-runtimeen. Siemenfixturen registryä tai workspace-
   juuria ei kopioida adoption-kohteeseen, eikä siemen ole sen alihakemisto.
2. Käytetään nykyistä `shutdownBeforeWorkspaceProof`-sulkua ja
   `startDesktopComposition`-polkua oikealla `startDesktopBackend`illa sekä
   saman paketin build-/release-identiteetillä. Health, profiilivalidointi,
   varauksen siirto ja adoption-hyväksyntä eivät ole testikaksoisia.
   Havaintokääre delegoi alkuperäiset callbackit ja säilyttää virheen syyketjun.
3. Tarkistetaan registryn puuttuminen ennen backend-käynnistystä, täsmälleen
   yksi oikeaan profileId:hen sidottu julkaisu, legacy-lähteen muuttumattomat
   tavut, journalin poistuminen ja legacy-bindingin täsmällinen sisältö.
   Normaalin sulun ja uuden käynnistyksen jälkeen verrataan liiketoimintarivejä
   ja PDF-tavuja nykyisellä snapshot-apurilla, ei aktiivisen SQLite-tiedoston
   pysyvää byte-hashia. Backend saa tehdä omat normaalit kirjoituksensa.
4. Sulun todistus vaatii oikean exit-tuloksen ja prosessivarauksen vapautumisen.
   Havaitsijan kahvalaskurin nollautuminen ei yksin riitä. Virheessä aineisto
   säilyy nykyisessä yksityisessä/salatussa ketjussa, myös alkuperäinen syy.

Tapausta ei yhdistetä vanhan tavukokeen muuttumattomiin prosessilaskureihin.
Nykyiset packaged cold-recovery -tapaukset ja 038-legacy-paketin
backup/inspect/restore/restart/compare säilyvät erillisinä hyväksyntöinä.
Olemassa olevien apurien löytyminen on lähdenäyttöä, ei uuden kokeen läpäisy.

Kytkennän kohderegressiot vaativat puuttuvan/väärän vaiheen, samanarvoisen
mutta vieraan kontekstin, vanhan callbackin ja väärän backend-siirron hylkäyksen
ennen vaikutusta. Kesken I/O:n kadonnut valtuus säilyttää ensivirheen ja estää
recoveryyn tai ulompaan closeen etenemisen. Samalla testataan, että epävarman
adoption-työn ilmoitus ei estä oikean backendin stop/takaisinoton yritystä.
Tavallinen valmistunut sisältövirhe, fresh, legacy ja jo julkaistu registry
säilyttävät omat onnistumis- ja palautusehtonsa.

**Kutsusopimuksen katselmus 30.10.2026:** rajattu riippumaton lähdekatselmus
ei löytänyt estävää puutetta yllä olevista mainin vaiheporteista, alkuperäisten
tehtävien päättymisestä tai sidotusta prepared-siirtymästä. Kutsusopimus ja
testien kattavuuskartta ovat toteutusvalmiit. Uutta main-/SQLite-/pakettiajoa
ei tässä dokumentointivaiheessa tehty; niitä ei merkitä läpäistyiksi.

**Sopimuksen tarkistus 30.10.2026:** rajattu riippumaton lähdekatselmus ei
löytänyt estävää sopimuspuutetta. Sen alustusjärjestystä koskeva täsmennys
sisältyy yllä olevaan readonly-alkuhavaintoon ja erilliseen käyttöönottoon.
Nykyisen käyttöönoton, palautumisen ja valinta-adapterien viiden tiedoston
104 kontrollitestiä läpäisivät. Ne todentavat nykyisen lähtötilan, eivät
vaihenäkymien, yhteisvartijoiden tai main-kytkennän tulevaa toteutusta.
Tuotantokoodia tai aikarajoja ei tässä sopimustarkennuksessa muutettu.

**Vaihenäkymien checkpoint 30.10.2026:** metadata- ja binding-adapterit
tarjoavat nyt erillisen readonly-alkuhavainnon, syklittömän vertaisvartijan
ja saman valinnan `forPhase`-näkymät. Vanhentunut näkymä hylätään ennen
I/O:ta seuraavaa vaihetta mitätöimättä. Aloitetun työn valtuuskatko,
muuttuneet tavut, kadonnut kuitti ja päällekkäinen työ sulkevat edelleen
saman suoritusyrityksen; clearin retired-tila säilyy. Omien julkaisujen
kuitit kulkevat vaiheiden yli ilman uutta tiedostovalintaa.

Katselmuksessa todettu alkuvaltuuden callback-vastaanottajan kopiointivirhe
toistettiin neljällä regressiolla ennen korjausta. Sidonta säilyttää nyt
alkuperäisen omistajan myös elävän getterin ja prototyyppimetodin tapauksessa.
Uuden tiedoston 19 testiä sekä yhtenäisen yhdeksän tiedoston 168 testiä ja
desktopin tyypitys läpäisivät. Ajot ovat päällekkäisiä, eivät yhteenlaskettava
hyväksyntämäärä. Root-kuittien ja mainin vaihevaltuuden kytkentä sekä niiden
prosessi-/pakettinäyttö ovat edelleen erillisiä avoimia portteja. Nykyiset
tuotannon startup-/recovery-kutsujat eivät vielä käytä näitä uusia näkymiä.

**Säilyvien root-kuittien checkpoint 30.10.2026:** tiedosto-omistajan
readonly-alkuvalinta ja vaihekohtaiset näkymät säilyttävät samat yhdeksän
juuren identiteetit tai poissaolon valmistelusta hyväksyntään ja palautukseen.
Vain kuitattu oma mkdir, saman candidate/runtime-identiteetin rename ja
omistetun alipuun rm päivittävät valintaa. Vaihtunut tai samannimisenä
uudelleen ilmestynyt juuri ei muutu omaksi valtuudeksi. Final-runtimen
sallittu tiedostosisällön muutos ei vaihda juuri-identiteettiä.
RootStore tarjoaa rajatun sidotun tilan, joka ei hyväksy sen päälle uutta
kutsukohtaista valtuutta. Vanha tavallinen rajapinta ja kolme tiukkaa
unpublished-recovery-haaraa säilyvät.

Katselmuksessa todetut talteen jääneen callbackin ennenaikainen I/O ja
loppuvartijan peittämä readonly-ensivirhe toistettiin yhdeksällä regressiolla
ennen korjausta. Callbackit päättyvät nyt alkuperäisen kutsun mukana,
eivätkä vanhat ilmoitukset mitätöi seuraavaa vaihetta. Sisältövirhe ja
myöhempi valtuus-/sulkuvirhe säilyvät; yksinään valmistunut sisältövirhe ei
muutu epävarmaksi tiedostovaikutukseksi. Rajattu riippumaton jälkikatselmus
valmistui ilman uusia löydöksiä.

Root-valinnan 58 testiä ja yksi kaikkien kolmen omistajan yhteinen
prepare/publish/accept-tiedostoketju sisältyvät yhtenäisen 32 tiedoston
779 läpäisseeseen testiin. Kolme nykyistä POSIX-tapausta jäi alustaehtonsa
vuoksi ajamatta; desktopin tyypitys läpäisi. Yhteiskokeen backend-kirjoitus
on mallinnettu, ei todellinen backend- tai prosessitodiste. Seuraavana on
näiden porttien tuotannon startup-/recovery-/main-kytkentä yllä olevan
kolmen roolin ja todellisen acceptance-cleanup-fasadin mukaan. Saman
operaation sidottu jatko, todellinen exit/takaisinotto, native-/pakettinäyttö
sekä koko W7.4:n PR/main-portit ovat edelleen auki.

**Sidotun palautusportin checkpoint 30.10.2026:** metadata-omistaja tarjoaa
nyt valitun `prepareRecoveredSelection`-siirtymän omalla kuitillaan sekä
kaikkien registry-slottien readonly-poissaolotarkistuksen. Root-valinnan
poissaololehti ei kutsu metadataa takaisin. Puuttuva kuittaus, muuttunut
sidonta tai juuri ja vanhentunut kutsu estävät jatkon; ensimmäinen syy ja
erillinen kirjoittajan sulkuvirhe säilyvät. Tavallisen journal-writen
recoveryRequired-siirtymää ei avattu.

Nykyinen recovery-käyttötapaus lukee lopputarkistuksen metadatan sarjallisesti.
Erikseen annettu sidottu palautusportti jatkaa samoin tunnistein prepared-
tilasta; vanha sidonnaton haara tyhjentää journalin edelleen entisin ehdoin.
Oikeiden tiedostojen testit kattavat kaikki kolme lähtötilaa, uuden omistajan
copy/publish-jatkon ja katkot final- sekä operation-juuren poiston välissä
ja prepared-julkaisun ympärillä. Testin uudelleenkäynnistys on tässä
omistajanvaihdos, ei vielä todellinen prosessikatko tai business-backend.

Yhtenäinen 32 tiedoston sarja läpäisi 817 testiä; kolme nykyistä
POSIX-tapausta jäi alustaehtonsa vuoksi ajamatta. Desktopin tyypitys ja
rajattu riippumaton katselmus läpäisivät. Mainin pakollinen alkuvaltuus,
live-hyväksynnän vaiheportit ja oikea SQLite/backend-/pakettinäyttö ovat
edelleen seuraava kytkentä, eivät tämän tukipalan läpäisseitä portteja.

**Mainin vaiheiden toteutuscheckpoint 30.10.2026:** tuotannon resolver vaatii
alkuperäisen main-omistajan ennen adoption korjaavia lukuja. Sama metadata-,
sidonta- ja root-valinta sekä omien muutosten kuitit jatkuvat valmistelusta
elävään hyväksyntään ja exitin jälkeiseen palautumiseen. Alempi startup saa
hyväksyntään ja palautumiseen nimetyt pakolliset vaiheportit; valmistelun
vanhat sulkeumat eivät anna niihin valtuutta. Live-siivous saa todellisen
vain `discardCandidate`-metodin sisältävän rajapinnan.

Mainin hyväksyntä tarkistaa saman backend-kahvan elävän tilan ja granted-
siirtokahvan. Ensimmäinen epävarmuus säilyy, mutta varaus mitätöidään vasta
backendin stopin ja takaisinoton yrityksen jälkeen. Epävarma main-työ estää
palautumisen ja ulomman varauksen vapautuksen. Kohdekokeet kattavat normaalin
hyväksynnän, pysähtyneen backendin ja sidonnan kadonneen kuittauksen.
Niiden prosessiomistaja on testikaksoinen, ei native-exit-todiste.

Katselmuksessa löytynyt lähdeluokan vaihtuminen kahden havainnon välissä
hylätään nyt ennen ensimmäisen journalin julkaisua. Alkuperäinen `fresh`-
tai `legacy`-valinta kulkee alempaan valmisteluun; sitä ei korvata uudella
päätöksellä. Oikean tiedoston ilmestymisen regressio säilyttää lähteen eikä
julkaise journalia tai registryä. Testikääre säilyttää alkuperäisen virheen
syyketjun turvallisen julkisen koodin taustalla ja välittää mainin valtuuden
muuttumattomana. Historiallinen tavukoe käyttää alempaa omistajaa; se ei
väitä tekstifixtureä SQLite- tai backend-hyväksynnäksi.

Yhtenäinen 35 tiedoston regressiosarja läpäisi 881 testiä; kolme nykyistä
POSIX-tapausta jäi alustaehtonsa vuoksi ajamatta. Desktopin ja E2E-runtimen
tyyppitarkistukset sekä rajattu riippumaton katselmus läpäisivät.

Erillinen todellisen SQLite/PDF-aineiston `DESK-WORKSPACE-ADOPTION-001`-
koe on toteutettu: metadata tarkistetaan backendin käydessä ja uudelleen
todellisen exitin sekä fyysisen varauksen takaisin hankinnan jälkeen.
Alkuperäinen sidonta verrataan myös toisen composition-startupin jälkeen.
Ensivirhe kulkee nykyiseen yksityiseen runner-sinkkiin ennen virhekuljetusta;
pakotetun virheen viesti, pino ja syy löytyivät puretusta OpenPGP-paketista.
Raportointi-/ajokytkennän 89 testiä, kuusi valitsimen järjestelmäkontrollia
ja rajattu koetoteutuksen katselmus läpäisivät. Puhtaan `8dcd52cc`-revision
uusi `DESK-WORKSPACE-ADOPTION-001` ja entinen `DESK-WORKSPACE-STARTUP-001`
läpäisivät samalla valmistellulla Electron/SQLite-runtimella ilman uusintaa.
Todiste on todellinen development-backend ja kaksi composition-startupia,
ei kahden Electron-pääprosessin restart tai hardened-pakettihyväksyntä.
Muut B:n omistajaliitokset, koko W7.4:n integraatio ja PR/main-portit ovat auki.

##### W7.4 B: tuonnin vaihekohtainen valtuus

**29.10.2026: sopimus ja vaiheittainen kytkentä.** Live-kytkennän nykytila on
alla olevassa koordinaattoricheckpointissa; korjaava kylmäpalautus on kesken.
Tuonti lisää rekisteriin uuden yrityksen. Replacementin muuttumatonta
alkuvalintaa ei siksi kopioida sellaisenaan eikä nykyistä rekisteriä hyväksytä
uudeksi valtuudeksi pelkän onnistuneen luvun perusteella.

**Omistajat ja järjestys:** `WorkspaceBackupImportCoordinator` kaappaa oman
import-leasen, nykyisen main-omistajan ja alkuperäisen rekisterivalinnan.
Nykyinen autentikoitu preflight, tunnistevaraus sekä runtime-/kahvasulku
säilyvät. Tuonnin sidonta julkaistaan autentikoidulle source-lineagelle ja
uudelle workspaceId:lle ennen `createCandidate/stageBackup`a. Nykyinen v2-
journal säilyy; sen aikainen `lineageIdentity: null` ei todista sisällön
validointia. Kohteeton preflight ja yhteisen plaintext-quarantinen siivous
säilyvät nykyisten omistajiensa vastuulla, eivät saa aktiivisen yrityksen
sidontaa tai yhteisen juuren poistovaltuutta.

| Vaihe | Rekisterin hyväksytty valinta | Muutosvaltuus |
| --- | --- | --- |
| Ennen omaa julkaisua | Kaapatut nykyiset tavut, tiedostoidentiteetti ja sivuslottien poissaolo. | Tuore täsmällinen lease/main, sidonta ja kutsun vaatima runtime-poissaolo; journalin/root-storen oma valintatarkistus säilyy. |
| Oma rekisterikirjoitus | Alkuvalinta luovutetaan nykyiselle `writeSelected`-kirjoittajalle. | Kirjoittaja seuraa itse omia muuttuvia slottejaan. Ulkoinen vartija tarkistaa mainin, leasen, sidonnan ja täsmällisen julkaistun import-journalin, ei lue samaa rekisteritallenninta uudelleen. |
| Varmennettu oma julkaisu | Vain alkuvalinnasta nykyisellä `publishImportedWorkspaceEntry`-säännöllä muodostettu lisäys. | Kirjoittajan palauttama tiedostoidentiteetti, täsmällinen readonly-readback ja sivuslottien poissaolo vaaditaan ennen valinnan vaihtamista. Muut yritykset ja aiempi aktiivivalinta säilyvät. |
| Epävarma tulos | Ei uutta hyväksyttyä valintaa. | Ei korjaavaa lukua, aineiston siivousta tai jonotetun paluun toteutusta samassa ajossa. Ensimmäinen syy säilyy. |

Kadonnut kuittaus ei muutu onnistumiseksi sillä, että myöhempi luku näyttää
odotetut tavut. Myös samat tavut uudessa tiedostoidentiteetissä, vieras
sivuslotti, toinen samanlajinen lease tai vanhentunut main hylätään.
Rekisterin oma kirjoitus ja import-journalin oma kirjoitus eivät ristiin
korjaa toistensa välitiloja. Journalin nykyinen slot-omistaja saa rajatun
valinta-/muutosvartijan: se todentaa omat slot-muutoksensa itse, kun ulkoinen
vartija todentaa rekisterin, sidonnan ja mainin. Sama periaate estää
rekursiivisen tarkistuksen kummankin tallentimen sisällä.

**Pienet tuotantopalat:** importin oma sidonta-/vaiheapu; nykyisen journal-
ja root-storen vartioidut portit; koordinaattorin julkaisu ja virhepolut;
aktiivisen ja backendittoman mainin composition sekä kylmäpalautus. Apu
ei omista palautusta, yleistä siivousta tai prosessienhallintaa. Nykyinen
root-store tarkistaa valtuuden odotusten jälkeen ja juuri ennen omia
luonteja, siirtoja ja poistoja. Tavalliset tunnetut tuontivirheet säilyttävät
nykyisen turvallisen candidate-siivoamisen ja paluun. Vain osoitettu
valtuuden menetys, epävarma julkaisu tai päättymätön työ sulkee ne;
kaikkia validointivirheitä ei muuteta pysyväksi sulkuvirheeksi.
Rekisterin valinta todetaan uudelleen sidonnan I/O:n jälkeen ennen siivousta
tai paluupyyntöä; ennen sidontalukua tehty tarkistus ei yksin riitä.

**Paluu ja elinikä:** `ensurePreviousWorkspaceRunning()` vain pyytää nykyistä
lykättyä paluuta. Pyynnön tekeminen, journalin loppusiivous, työn päättyminen,
leasen vapautus ja todellinen käynnistys ovat eri rajat. Myöhäinen
epävarmuus sulkee myös jo jonotetun pyynnön nykyisen composition-omistajan
kautta. Ennen toteutusta vaaditaan kaikkien omistettujen töiden päättyminen
ja terminal-toimien tulos. Lopullinen käynnistysvartija tarkistaa nykyisen
main-sukupolven ja säilytetyn epävarmuuden, ei jo asianmukaisesti vapautettua
leasea. Ensivirhe säilyy erillään journal-, sulku- ja vapautusvirheistä.

**Kylmäpalautus ennen korjaavaa lukua:** nykyinen readonly-admission valitsee
import-journalin nykyisessä `current -> backup -> next`-järjestyksessä ja
validoi v2:n korjaamatta slotteja. Näin saadaan operationId, workspaceId ja
käytettävissä oleva lineage sidonnan kaikkien slottien lukuun. Palautusomistaja
kaappaa oman täsmällisen leasen; nykyinen main-/runtime-omistaja todistaa
kirjoittajien poissaolon. Journalin ja sidonnan sama valinta varmennetaan
uudelleen tässä valtuudessa ennen korjaavaa journal-lukua tai payload-muutosta.
Vaihtunut operaatio ei saa vaihtaa valittua sidonta-avainta hiljaisesti.

| Sidontahavainto | Nykyisen tuontipalautuksen oikeus |
| --- | --- |
| Kaikki slotit puuttuvat | Sidonnaton, ei todistetusti vanha. Tuetun v2-journalin nykyinen palautus voi jatkua vain omilla riippumattomilla C/R18-, journal-, juuri- ja sisältötodisteillaan. Puuttuminen ei anna W7-poistovaltuutta eikä luo jälkikäteen sidontaa. |
| Current on julkaistu ja olemassa olevat sivuslotit vastaavat sitä | Owner, operationId, workspaceId ja tunnettu lineage täsmäävät valittuun journaliin; tuore palautusvaltuus vaaditaan edelleen. Aikainen null-lineage ei ohita myöhempää sisältötarkistusta. |
| Osittainen, virheellinen tai ristiriitainen sidonta | Pysähdys ennen korjausta tai siivousta; ei siirtymistä sidonnattomaan polkuun. Aineisto säilyy. |

Historiallisen v1-journalin ja selittämättömän journalittoman plaintextin
nykyisiä estoja ei avata. Tämä ei muuta journal- tai backup-formaattia.
Normaali sidontametadatan poisto vaatii kaikkien saman operaation jäännösten
poissaolon ja työn päättymisen. Hyväksytty lopullinen yritysjuuri ei enää ole
importCandidate-jäännös; pelkkä journalin poistuminen ei kuitenkaan todista
operaatiokansion, stagingin tai tarkistuskopioiden siivousta.

**Näyttö ja seuraava portti:** 16 synteettistä tiedostotapausta läpäisi
oikeilla rekisteri-/sidontatallentimilla, leasella ja lykätyn paluun apurilla.
Ne kattavat oman lisäyksen aktiivisessa ja valitsintilassa, vieraat tavut/
identiteetit/sivuslotit, vanhentuneen omistajan, katkenneet kuittaukset,
sidontaluvun yli muuttuneen rekisterin sekä myöhäisen paluun eston.
Nykyiset tuonnin virhe- ja palautuskontrollit läpäisivät erikseen 139 testiä
muuttamattomina; ne eivät todista uuden kytkennän toimivuutta.
Rajattu riippumaton sopimuskatselmus hyväksyi täsmennetyn omistajuusrajan.
Main, candidate ja koordinaattorin vaiheistus ovat
kokeessa mallinnettuja. Kokeessa ei ole journal-kytkentää eikä se todista
kokonaista tuontia, kylmäpalautusta, SQLiteä, native-prosessia tai pakettia.
Ennen kytkentää pysyvät regressiot todistavat myös sidonta-ennen-payloadia,
kaikki journal-/root-muutosrajat, normaalin virhesiivouksen, työn päättymisen,
aktiivisen/valitsimen todellisen composition-ketjun sekä yllä olevan
kylmäpalautusmatriisin. W7.4:n paketti-, katselmus- ja PR/main-portit säilyvät.

**Toteutuscheckpoint 29.10.2026:** `WorkspaceBackupImportBinding` kaappaa
alkuvalinnan tavut ja tiedostoidentiteetin sekä täsmällisen import-varauksen.
Oma lisäys käyttää nykyistä valittuun tilaan sidottua rekisterikirjoitusta;
journal-vartijan ensisyy säilytetään ennen tallentimen virhemuunnosta.
Tuontijournalin readonly-/selected-portit ja root-storen valinnaiset
muutosvartijat on toteutettu. Viimeinen synkroninen vartija on suoraan
tiedostomuutoksen edessä; myös mikrotyöjonossa väliin tuleva valtuuden
menetys on testattu. Vanhat portteja käyttämättömät kutsut säilyvät.
Jäädytetty kymmenen tiedoston kohdesarja läpäisi 259 testiä, desktopin
tyypitys ja rajattu riippumaton delta-katselmus läpäisivät. Sarja sisältää
edellä mainittuja vanhoja kontrollitestejä, ei erillistä uutta 139 testin
kattavuutta. Tämän checkpointin aikaan koordinaattori, mainin loppukäynnistys
ja kylmäpalautus eivät vielä käyttäneet uutta sidontaa; seuraava pala oli niiden kytkentä ja pysyvät
ketjuregressiot. Tämä checkpoint ei ole native-, paketti- tai PR-hyväksyntä.

**Kylmävalinnan lukukytkentä 29.10.2026:** nykyinen
`readColdWorkspaceRecoveryAdmissionFromRoot` kutsuu tuonnin
`inspectWorkspaceBackupImportBindingAdmission`-tarkistusta valitun v2-journalin
jälkeen. Se tarkistaa kaikki sidontaslotit ja tunnetut kohde-/lineage-viitteet
sekä todentaa journalin saman semanttisen valinnan uudelleen sidontaluvun yli.
Tämä on vain korjaamaton aloitustarkistus: se ei kaappaa tiedostomuutoksen
valtuutta eikä korvaa palautusomistajan täsmällistä slot-/identiteettivalintaa,
leasea tai runtime-poissaolon todistusta. Sidonnaton tuettu v2-palautus säilyy;
osittainen tai ristiriitainen metadata ei siirry sidonnattomaan polkuun.
Jäädytetty 12 tiedoston 419 testin sarja, desktopin tyypitys ja rajattu
riippumaton lähde-/testisuunnittelukatselmus läpäisivät.
Sarja sisältää aiemman 259 testin kontrollijoukon, ei yhteen laskettavaa
lisäkattavuutta. Tämän checkpointin seuraava pala oli live-tuonnin ja
korjaavan palautuksen uudet vartijat sekä terminal-/paluukytkentä.

###### Tuonnin ensimmäinen julkaisu ja loppusiivous

Tämä täsmentää yllä olevaa vaihevaltuutta nykyisten omistajien sisällä.
Rajattu 28 tapauksen koe ja riippumaton suunnittelukatselmus läpäisivät.
Sidontaosan portit ja koordinaattori-/main-kytkennän nykytila on kuvattu
tämän kohdan lopussa. `prepared` säilyy
ennen candidatea; sidonta julkaistaan journalin jälkeen mutta ennen payloadia.
Ensimmäinen journal-kirjoitus ei voi vaatia vielä olematonta sidontaa.

1. Koordinaattori kutsuu pakollista `captureImportOwner(lease)`-porttia heti
   `acquire('import')`-palautuksen jälkeen ennen seuraavaa odotusta, saman
   `try/finally`-vapautuksen sisällä. Nykyinen management-composition kaappaa
   täsmällisen kahvan ja mainin callbackit synkronisesti. Kaappaus tarkistaa
   installation-/main-sukupolven, ei vielä mainin fyysistä tiedostovarausta:
   backend voi tässä vaiheessa edelleen omistaa sen. Aktiivinen main käyttää
   nykyistä `assertInstallationCurrent`-tarkistusta ja sulkutilaa; valitsin
   käyttää omaa nykyistä elinikätarkistustaan. Vasta todetun sulun jälkeen
   vaaditaan runtime-poissaolo, `assertMainCurrent` ja `assertMainOwned`.
2. Uuden työn journal-ennakkoluku on korjaamaton `inspectSlots`: yksikin
   current/next/backup estää uuden tuonnin. Se ei korjaa aiempaa operaatiota.
   Autentikoidun preflightin jälkeen rekisterin alkuvalinta kaapataan
   korjaamattomasti tavuineen ja identiteetteineen; nykyinen current ja
   sivuslottien poissaolo vaaditaan. Nykyiset nimien ja lineagen säännöt
   sekä plaintext-karanteenin oma vastuu säilyvät.
3. Sulun jälkeen ensimmäinen `writeSelected(prepared, selection)` käyttää
   kaikkien journal-slottien täsmällistä poissaolovalintaa. Ulkoinen vartija
   tarkistaa kaapatun leasen, mainin, runtime-poissaolon ja alkuperäisen
   rekisterin. Se ei lue oman kirjoittajansa muuttuvia journal-slotteja eikä
   vaadi sidontaa. Tämä valtuus on vain ensimmäiselle metadata-kirjoitukselle;
   sitä ei anneta candidate-, staging- tai muulle payload-portille.
4. Koordinaattori hyväksyy journal-valinnaksi vain kirjoittajan palauttaman
   tiedostoidentiteetin, täsmälliset odotetut tavut ja korjaamattoman readbackin
   ilman sivuslotteja. Ulkoinen valtuus toistetaan readbackin jälkeen.
   Kirjoitusyrityksen epävarma tulos sulkee tämän ajon, vaikka odotetut tavut
   myöhemmin löytyisivät. Vartijan ensisyy säilytetään ennen store-muunnosta.
5. Nykyisen `WorkspaceBackupImportBinding.publish`-portin vartijaan lisätään
   pakollinen kaapatun journal-valinnan tarkistus. Sidontakirjoituksen
   ulkoinen ketju tarkistaa rekisterin, journalin ja rekisterin uudelleen;
   sidontatallennin seuraa omia slottejaan. Sidonnan kuitti ja readback sekä
   sama journal-valinta varmennetaan ennen candidate-luontia. Myöhemmät
   journal-kirjoitukset käyttävät sidontaa ja rekisteriä ulkoisina ehtoina;
   jokainen oma journal-kuitti vaihtaa valinnan vasta täsmällisen readbackin
   jälkeen. Payload-portit saavat vain julkaistun sidonnan valtuuden.

`captureImportOwner` on nykyisen compositionin pieni portti, ei uusi manageri.
Se erottaa sukupolven eliniän, suljetun runtimen fyysisen varauksen ja
epävarmuuden ilmoittamisen. Tuonnin sidontaosa ei ala omistaa journalin
tilasiirtymiä, palautusta tai candidate-siivousta. Koordinaattori omistaa
järjestyksen ja journal-kuitin; store omistaa oman slot-muutoksensa.

Normaali loppujärjestys on: payload-työn päättyminen ja omien jäännösjuurten
todettu poissaolo; sidontametadatan poisto; journalin terminal-poisto;
leasen vapautus; vasta sitten lykätyn paluun toteutus. Lopullinen hyväksytty
yritysjuuri ei ole jäännös eikä sitä poisteta. `readPresence`-tuloksen kaksi
booleania eivät todista koko operation-rootin poissaoloa: sama root-store
tarvitsee täsmällisen, linkit ja parentit tarkistavan poissaolotodistuksen,
ja candidate-/inspection-omistajat todistavat työnsä päättyneeksi.

Sidonnan `clearAfterPayloadsAbsent` säilyttää valitun journalin ja ennen/jälkeen-
rekisterin ulkoisina ehtoina, mutta ei lue omaa aktiivista tallennintaan.
Nykyisessä portissa on vain `owner`-tilassa sallittu odotettu current-
tiedostoidentiteetti; live-tuonnin sidontaosa antaa sen pakollisesti alkuperäisestä
sidonnan julkaisukuitista. Tallennin kaappaa arvon ennen ensimmäistä odotusta
ja vertaa sitä omaan slot-havaintoonsa ennen yhtäkään poistoa. Puuttuva current
tai sama sisältö eri tiedostoidentiteetissä hylätään. Tämän jälkeen nykyinen
`clearSelected` vartioi valittuja slotteja jokaisessa poistossa. Muiden
nykyisten owner-kutsujien ja `deletionPurged`-tilan sopimusta ei muuteta;
odotettua current-identiteettiä ei hyväksytä jälkimmäisen tilan lisäehdoksi.
Ennen poistokutsua tehty sidontaluku ei korvaa tätä tallentimen sisäistä ehtoa.
Vasta onnistunut poistokuittaus ja kaikkien sidontaslottien korjaamaton
poissaolohavainto siirtävät koordinaattorin rajattuun metadata-poistettu-tilaan.
Sen ainoa jäljellä oleva tiedostomuutos on täsmälleen valitun journalin poisto
(`removeSelected` tai ennen root-julkaisua `discardBeforePublicationSelected`).
Tämä vartija vaatii yhä saman mainin, leasen, rekisterin, payloadien poissaolon
ja sidontaslottien poissaolon; se ei anna uutta payload-muutoslupaa.
Epävarmaa poistokuittausta ei korvata uudella poissaololuvulla.

Jos prosessi päättyy metadatan poiston ja journalin poiston välissä, jäljellä
oleva v2-journal käsitellään nykyisen sidonnattoman palautuksen riippumattomilla
C/R18-ehdoilla. Kadonneesta sidonnasta ei päätellä aiempaa julkaisua tai
poistolupaa. Katko, jossa sidontaslotit ovat osittaisia tai ristiriitaisia,
estää edelleen automaattisen korjauksen. Uutta tallennettua vaihetta tai
jälkikäteen rakennettua sidontaa ei lisätä.

`ensurePreviousWorkspaceRunning` saa edelleen pyytää paluuta nykyisessä
kohdassaan, mutta se ei avaa runtimea. Compositionin import-kohtainen
terminal-eligibility on aluksi suljettu ja avataan vasta varmennetun
loppuketjun ja onnistuneen leasen vapautuksen jälkeen. Ensimmäinen epävarma
journal-/sidontakirjoitus, valtuuden menetys, keskeneräinen työ tai
siivous-/vapautusvirhe sulkee sen sekä uuden service-admissionin pysyvästi
tämän compositionin ajaksi. Lopullinen synkroninen käynnistysvartija tarkistaa
main-sukupolven, nykyisen fyysisen main-varauksen ja terminal-eligibilityn,
ei vapautettua import-leasea tai valitsimen leaseen sidottua stopped-vartijaa.
Tavallinen ennen kirjoitusyritystä päättyvä syöte-/preflight-virhe ja
varmennetusti siivottu candidate-validointivirhe eivät itsessään myrkytä
omistajaa. Kaikki aloitetut työt liittyvät nykyiseen sulkuun; myöhäinen tulos
ei avaa suljettua eligibilityä eikä peitä ensimmäistä syytä.

Suunnittelukoe käytti oikeita journal-, sidonta-, rekisteri- ja root-tallentimia sekä
nykyistä leasea ja lykätyn paluun apuria. Koordinaattorin järjestys, mainin
omistajuus ja lapsityön elinikä on mallinnettu. Sidonnan julkaisukuitin uusi
poistoehto oli siinä vain koeehdokas nykyisen tallentimen havaintorajan kohdalla.
Kokeen näyttö kattaa ensimmäisen journalin, kuittauskatkot,
vaihtuneen tiedostoidentiteetin, keskeneräisen työn sekä ennen root-julkaisua
siivotun virhepolun paluun. Se ei todista onnistunutta koko tuontia, täyttä
kylmäpalautusta, native-prosessivarausta tai paketoitua hyväksyntää.
[ADR-0011:n live-tuonnin järjestys](../decisions/ADR-0011-local-multi-workspace-company-model.md#a-tuo-uutena-työtilana)
on täsmennetty nykyisen lykätyn paluun mukaiseksi; cold- ja ordinary-recoveryn
erillisiä loppuehtoja ei muuteta.

**Sidontaosan toteutuscheckpoint 29.10.2026:** tallennin kaappaa ja tarkistaa
omistajan odottaman current-identiteetin ennen poistoja. Import-sidonta
kaappaa pakollisen journal-callbackin rakentajassa ja käyttää sitä julkaisun
rekisteri/journal/rekisteri-vartijassa. Loppusiivous käyttää alkuperäistä
sidontakuittia, payload-poissaoloa ja samaa journal-valintaa. Vain kuitattu
poisto ja korjaamaton readback avaavat metadata-poistettu-tilan. Sen
vartija ei lue journalia, jotta valittu journal-kirjoittaja omistaa omat
slottinsa; payload-muutosvaltuus pysyy suljettuna. Pysyvät regressiot
todentavat myös oikean journalin ja sidontatallentimen yhteistoiminnan.
Jäädytetty 13 tiedoston sarja läpäisi 237 testiä; yksi olemassa oleva
POSIX-tapaus odottaa Linux-ajoa. Desktopin tyypitys ja rajattu riippumaton
katselmus läpäisivät. Sarja sisältää vanhoja kontrollitestejä, ei aiempien
checkpointien päälle yhteen laskettavaa kattavuutta.
Tämä ei vielä ole koordinaattorin ensimmäinen owner-kaappaus, root-storesta
tuleva täydellinen poissaolotodistus, mainin elinikäkytkentä tai korjaavan
kylmäpalautuksen hyväksyntä. Näiden portit ja koko W7.4:n pakettinäyttö
ovat edelleen avoinna.

**Root-portin checkpoint 29.10.2026:** nykyinen import-root-store tarjoaa
nyt `assertOperationAbsent`-tarkistuksen. Se kaappaa operaation polut ja
synkronisen valtuuscallbackin ennen ensimmäistä odotusta, todentaa juuren
ja emokansion nykyisellä tiedostoidentiteetin lukijalla sekä tarkistaa koko
operaatiokansion poissaolon uudelleen. Linkki, vaihtunut juuri/parent tai
pelkkä inspection-jäännös estää hyväksynnän; mitään ei luoda tai poisteta.
Oikean root-, sidonta- ja journal-ketjun kaksi testiä todentavat sekä
varmennetun siivouksen että säilyvät tiedostot hylkäyksessä. Tarkistus ei
todista prosessien tai kirjoittajien päättymistä eikä anna muutosvaltuutta.
Jäädytetty 16 tiedoston sarja läpäisi 401 testiä; yksi olemassa oleva
POSIX-tapaus odottaa Linux-ajoa. Tyypitys ja rajattu riippumaton katselmus
läpäisivät. Tämä sarja sisältää edellisen checkpointin kontrolleja.
Tämän root-portin checkpointin aikaan koordinaattori-/main- ja korjaavan
palautuksen kytkentä sekä native-/pakettiportit olivat vielä kesken.

**Live-koordinaattorin checkpoint 29.10.2026:** nykyinen koordinaattori
kaappaa pakollisen import-omistajan ennen ensimmäistä journal-lukua.
Ensimmäinen valittu journal-kirjoitus käyttää alkuperäisen rekisterin ja
suljetun runtimen valtuutta; sidonta julkaistaan kuitin ja readbackin jälkeen
ennen payloadia. Jokainen journalin oma kirjoitus saa uuden täsmällisen
valinnan vasta kuitista ja korjaamattomasta readbackista. Rekisterin oma
lisäys, root-muutokset ja metadata/journal-loppusiivous käyttävät yllä olevia
erillisiä vartijoita. Alkuperäinen vartijavirhe säilyy myös tallentimen
virhemuunnoksen yli. Epävarma plaintext-siivous ei oikeuta candidate-
siivoukseen tai paluuseen.

Aktiivinen ja backenditon main kaappaavat sukupolven erillään fyysisestä
main-varauksesta. Oman sulun capability-disposal sulkee uuden admissionin,
mutta ei mitätöi jo kaapattua työtä; ulkoinen shutdown sulkee myös sen.
Keskeneräinen työ liittyy nykyiseen sulkuun ennen leasen vapautusta.
Myöhäinen virhe sulkee jonotetun paluun, vaikka journal olisi jo poistettu.
Viimeinen paluuvartija käyttää main-sukupolvea, fyysistä main-varausta ja
terminal-eligibilityä, ei vapautettua leasea.

Jäädytetty 28 tiedoston sarja läpäisi 612 testiä ja rajattu riippumaton
lähde-/testikatselmus läpäisi; sarja sisältää aiempia kontrolleja.
Desktopin ja molempien E2E-koostamisten tyypitys läpäisi. Neljä oikeiden
tallentimien/juurten koetta käyttää oikeaa OS-varausta mutta mallinnettua
candidatea/runtimea. Nykyisen ja historiallisen oikean salatun backupin
kaksi system-tuontia läpäisivät SQLite-/PDF-tarkistuksineen.
`DESK-WORKSPACE-MANAGEMENT-001` käyttää nyt todellisia varausportteja ja
nykyistä lykätyn paluun apuria; Electronin candidate-ketju läpäisi, mutta
sen elinkaarilaskurit ovat edelleen mallinnettuja. Varsinaiset
`DESK-WORKSPACE-IMPORT-001`- ja `DESK-WORKSPACE-IMPORT-SCHEMA-001`-käyttäjäpolut
läpäisivät erikseen: jälkimmäinen kattaa säilyvät tiedot, oikean main-sulun,
uuden runtimen sekä alkuperäisen turvallisen syyn diagnostiikka-/tukiketjun.
Tämä ei sulje korjaavan kylmäpalautuksen vartijoita, POSIX-porttia tai
W7.4:n puhtaan paketin ja PR/main-hyväksynnän vaatimuksia.

###### Tuonnin kylmäpalautuksen omistajuussopimus

Tämä täydentää live-tuonnin sopimusta; se ei käynnistä uutta tuontia eikä
muuta C/R18:n palautusvalintaa. `WorkspaceBackupImportRecovery` omistaa
edelleen haarat ja järjestyksen. Nykyinen main-/management-composition
antaa käynnistyksen valtuuden, tallentimet oman tiedostomuutoksensa ja
candidate-adapteri nykyisen prepare-grant-exit-ketjunsa. Uutta manageria,
journal-formaattia, aikarajaa tai automaattista uusintaa ei lisätä.

**Alkuvalinta ja oma kuitti ovat eri todisteita.** Uusi kylmäkäynnistys saa
valita levyltä todennetun tilan vasta aiemman kirjoittajan päättymisen ja
nykyisen main-varauksen jälkeen. Se ei rakenna vanhaa kirjoituskuittia tai
tuontia edeltänyttä rekisteriä jälkikäteen. Tämän uuden ajon jokainen oma
muutos vaatii kuitenkin oman kuittauksen ja täsmällisen readbackin;
epävarmaa tulosta ei hyväksytä uudella luvulla saman ajon sisällä.

1. Cold-import kaappaa täsmällisen `import`-leasekahvan heti hankinnan
   jälkeen. Pakollinen composition-portti kaappaa startup-/installation-
   sukupolven ja epävarmuuden ilmoituksen. Nykyinen C/R18-admission,
   runtime-poissaolo ja fyysinen main-varaus todennetaan ennen ensimmäistä
   korjaavaa journal-/rekisterilukua, karanteenin valmistelua tai siivousta.
   `beforeRuntimeStart` ei saa käyttää puuttuvan omistajaportin fallbackia;
   vanhan `running`-tilan kutsujat ja luontipalautus säilyvät erillisinä.
2. Journal ja rekisteri valitaan korjaamattomasti nykyisellä prioriteetilla
   `current -> backup -> next`. Valitun lähteen todelliset tavut, nykyinen
   parseri ja tiedostoidentiteetti sekä kaikkien slottien läsnäolo sidotaan
   samaan havaintoon. Valitun lähteen virhe ei oikeuta fallbackiin.
   Bindingin kaikki slotit tarkistetaan edelleen sisältöineen: julkaistu
   current ja samansisältöiset sivut sallitaan; osittainen tai ristiriitainen
   sidonta estää jatkon. Kaikkien puuttuminen tarkoittaa vain `unbound`.
3. Korjaus käyttää nykyisen byte-/file-slot-omistajan rajattua cold-porttia,
   ei live-kirjoittajan tiukkaa `inspectSlots`/`recoverSelected`-yhdistelmää.
   Kelvollinen alku-next ja backup-only sekä kelvollisen authoritative-
   lähteen tyhjä tai katkennut sivuslotti säilyvät tuettuina. Nykyisen
   current-valinnan syrjäyttämät molemmat sivuslotit voidaan edelleen
   poistaa. Tämä on slot-tallennuksen sääntö, ei kaikkien journal-, root-
   ja rekisteriyhdistelmien hyväksyntä; palautusmatriisi tarkistetaan aina.
4. Syrjäytetty sivuslotti ei ole semanttinen tietolähde. Sen koko sisältöä
   ei tarvitse lukea tai hyväksyä parserilla, eikä sille synny uutta
   sisältökokorajaa. Nykyinen file-slot-omistaja todentaa turvallisen
   tavallisen tiedoston, canonical-polun, linkkimäärän ja identiteetin
   (myös koon ja muutosajat); poissaolo kuuluu valintaan. Vaihtunut havainto
   estää poiston. Valitun lähteen tavut ja identiteetti tarkistetaan tuoreesti
   jokaisen korjauksen yhteydessä. Tämä rajaus ei koske bindingia, payloadia
   tai uusia live-kirjoituksia eikä anna niille poistovaltuutta.
5. Tallennin seuraa omat korjatut slotit vain kuittauksen kautta ja tarkistaa
   siirretyn tiedoston jatkuvan identiteetin sekä sisällön. Se palauttaa
   normalisoidun current-valinnan vasta vartioidun lopputarkistuksen jälkeen.
   Sitä seuraavat journal- ja rekisterikirjoitukset käyttävät nykyisiä
   valittuja kirjoitusportteja. Ulkoinen vartija ei lue aktiivisen oman
   tallentimensa muuttuvia slotteja; muut valinnat, sukupolvi ja lease
   tarkistetaan myös odotusten jälkeen sekä juuri ennen muutosta.

Palautuksen rekisterivalinta on tämän käynnistyksen havaittu tila, ei
live-tuonnin alkuperäisen rekisterin kuitti. Nykyiset haarat säilyvät:

| Levyllä todettu tila | Palautuksen sallittu toiminta |
| --- | --- |
| Ennen final-rootin julkaisua, target puuttuu rekisteristä | Todennettu candidate-/operaatiosiivous ja nykyisen jatkovalinnan tarkistus. Tuontia ei jatketa tai julkaista uudelleen. |
| Final löytyy, candidate puuttuu, journal `candidateValidated` tai `rootPublished`, target puuttuu | Nykyinen täysi published-validointi ja yksi rekisterilisäys `appendRecoveredWorkspaceEntry`-säännöllä; historiallinen nimikonflikti ei muutu uuden live-tuonnin nimeämisportiksi. |
| Final löytyy, candidate puuttuu, täsmällinen ready-target rekisterissä, journal `rootPublished` tai `registryPublished` | Sama sisältötarkistus; ei toista rekisterilisäystä. Vain tarvittava journal-siirtymä ja loppuketju. |
| Molemmat juuret, julkaistu vaihe ilman finalia, väärä target/lineage/valinta tai väärä vaiheyhdistelmä | Säilytä aineisto ja estä jatko nykyisellä recovery-virheellä. |

Rekisterin v1/v2- ja selector-erot sekä aiemman työtilan jatkettavuus
säilyvät. `assertColdWorkspaceRecoveryContinuation` saa korjaamattoman,
täsmälleen valitun rekisterin lukuadapterin: piilotettua korjaavaa `read()`-
kutsua ei jätetä loppuvartijan sisään. Lopullinen yritysjuuri ei ole
poistettava tuonnin jäännös.

**Vartijoiden vastuut:** mainin nykyinen admission-lukija ja cold-omistaja
jakavat saman vieraita recoveryjä koskevan ristiriitatarkistuksen. Sen
kohdejoukko johdetaan kaapatusta rekisteristä, targetista ja edellisestä
valinnasta. Oman journalin, registryn tai bindingin täyttä repairing-
admissionia ei kutsuta niiden aktiivisen kirjoittajan sisältä; tätä varten
ei kopioida toista recovery-sääntölistaa. Mainin sukupolvi ja täsmällinen
lease säilyvät candidate-lapsen ajan. Fyysistä main-varausta ei vaadita
lapsen oman grant-vaiheen sisällä; se sekä lapsen todellinen päättyminen ja
runtime-poissaolo todennetaan uudelleen ennen seuraavaa mainin muutosta.
Vanha tai keskeneräinen lapsitulos ei uusi valtuutta.

Nykyisen plaintext-karanteenin siivous tarvitsee saman cold-valtuuden
myös sisäisiin tiedostomuutoksiinsa ja viimeisen synkronisen vartijan.
Karanteeni säilyy installation-tason nykyisen omistajansa vastuulla, ei
yritykseen arvattuna W7-poistokohteena. Ilman import-journalia löytyvän
plaintextin estoa ei muuteta. Root-store saa nykyisen mutation-authority-
porttinsa; tiedostopoissaolo ei korvaa työn päättymistodistusta.

**Loppuketju:** työn ja koko operaatiokansion varmennettu päättyminen;
nykyinen tarkka jatkovalinta; sidonnan poisto, jos se oli julkaistu;
journalin valittu loppupoisto; leasen vapautus. Cold-palautus ei käynnistä
runtimea, vaan normaali startup tekee sen omien tarkistustensa jälkeen.
Sidonnan poistovaltuus tulee uudesta cold-omistajasta, ei tekaistusta live-
kuitista. Nykyinen `clearAfterPayloadsAbsent` tarvitsee cold-owner-kutsuun
kaapatun kaikkien sidontaslottien valinnan tarkistuksen ennen omaa poistoa;
muut owner-kutsujat ja `deletionPurged` eivät saa uutta fallbackia.
Sidonnaton tuettu v2 käyttää itsenäisiä C/R18-todisteitaan eikä kirjoita
uutta bindingia. Poistokuittauksen menetys sulkee tämän ajon; myöhempi uusi
käynnistys arvioi jäljelle jääneen tilan taas omilla todisteillaan.

Ensimmäinen virhe säilytetään ennen store-muunnosta ja erillään myöhemmästä
siivous-/vapautusvirheestä. Keskeneräistä työtä ei vapauteta uuden omistajan
käyttöön; nykyinen sulku odottaa alkuperäisen työn päättymisen omien
rajojensa mukaan. Epävarmuus säilyttää aineiston ja estää startupin, eikä
pelkkä lopulta tyhjä hakemisto muuta epävarmaa suoritusta onnistuneeksi.

Toteutusjärjestys: nykyisten slot-omistajien cold-valinta/korjaus ja pysyvät
keskeytysregressiot; recovery-/binding-/karanteenivartijat ja nykyinen
haaramatriisi; main-/candidate-kytkentä ja todellinen restart-ketju.
Pysyvä näyttö kattaa kaikki seitsemän ei-tyhjää slottiyhdistelmää, registry
v1/v2:n, hylkäyksessä säilyvät tavut, muuttuneet identiteetit ja kadonneet
kuittaukset. Uuden omistajan onnistuminen ei saa avata vanhaa omistajaa.
Bindingin kaikki-slotit-ehto testataan sen oman clearin sisältä; lisäksi
vaaditaan jo julkaistun targetin, vieraan recovery-konfliktin, lapsen sulun,
karanteenin muutosten ja ensivirheen rinnakkaisen release-virheen testit.

Suunnittelukokeessa 33 tapausta läpäisi oikeilla journal-/rekisteri-
tallentimilla ja tiedostomuutoksilla. Vartija lisättiin vain kokeen
tiedostorajalle; main, runtime-poissaolo ja ulkoinen valinta mallinnettiin.
Nykyisen yhdeksän tiedoston 404 kontrollitestiä läpäisi muuttamattomina:
slotit, ordinary/cold-palautus, sidonta-admission ja rekisterin palautuminen.
Rajattu riippumaton sopimus-/testikatselmus ja sen viimeinen delta läpäisivät;
katselmoija ei ajanut testejä itsenäisesti.
Tämä ei vielä todista tuotantokytkentää, bindingin loppupoistoa tai
native-/SQLite-/pakettipalautusta. Ne sekä nykyiset live-, historical-,
selector-, käynnistys-, salatun ensivirheen ja PR/main-portit vaaditaan
ennen tämän liitoksen ja koko W7.4:n hyväksyntää. W7.5 pysyy suljettuna.

**Slot-porttien toteutuscheckpoint 30.10.2026:** nykyiset journal- ja
rekisteritallentimet tarjoavat `inspectRecoverySelection`-havainnon ja
`recoverObservedSelection`-korjauksen. Nykyinen file-slot-omistaja lukee
syrjäytettyjen slottien turvallisen identiteetin ilman sisältöallokaatiota.
Erillinen rajattu persistence-apuri vartioi havaintoa ja seuraa omat
kuittaukset; tavalliset lukijat ja live-kirjoittajan tiukat portit säilyvät.
Puuttuva tiedostojärjestelmän havaintokyky hylätään ilman repairing-fallbackia.
Kutsuva cold-omistaja vastaa edelleen C/R18-admissionista, täsmällisestä
leasesta, pysyvästä epävarmuusmerkinnästä ja mainin eliniästä. Portti ei
itsessään anna binding- tai payload-valtuutta.

Jäädytetty kymmenen tiedoston sarja läpäisi 457 testiä, joista 53 on uusia
oikeiden tallentimien regressioita; loput ovat aiempia kontrolleja.
Desktopin tyypitys ja rajattu riippumaton lähde-/testikatselmus läpäisivät.
Katselmoija ei ajanut testejä itsenäisesti. Tämä ei vielä kytke uusia
portteja recoveryn
haaroihin, bindingin loppupoistoon, karanteeniin tai mainiin. Niiden ja
native-/paketti-/PR/main-porttien vaatimukset säilyvät yllä.

**Sisäisten siivousvartijoiden checkpoint 30.10.2026:** sidontatallentimen
`clearAfterPayloadsAbsent` kaappaa nyt valinnaisen `expectedOwnerSlots`-
valinnan ennen ensimmäistä odotusta. Se vertaa jokaisen slotin todellisia
tavuja, identiteettiä ja poissaoloa tallentimen sisällä ennen poistoja.
Ehto on vain `owner`-tilalle; `deletionPurged` ei saa sillä lisävaltuutta.
Muiden nykyisten kutsujien sopimus säilyy. Valittu current on pakollinen,
eikä pelkkää samaa sisältöä eri tiedostossa hyväksytä.

Nykyinen plaintext-karanteeni ottaa palautuksessa valinnaisen nykyisen
`WorkspaceImportMutationAuthority`-portin. Se kaappaa callbackit, vartioi
myös hakemistojen valmistelun ja tarkistaa juurten sekä valittujen
tiedostojen identiteetit. Viimeinen tiedostotarkistus on asynkronisten
juuri-/valtuustarkistusten jälkeen, ja synkroninen valtuus edeltää poistoa.
Karanteenia ei sidota arvaamalla yritykseen eikä sen sisältörajoja muuteta.
Tavallinen porttia käyttämätön polku säilyttää aiemman käsittelynsä.

Kymmenen tiedoston 343 testiä ja desktopin tyypitys läpäisivät; yksi uusi
POSIX-oikeuksien muutosvartijan testi odottaa Linux-ajoa. Sarja sisältää
25 uutta läpäissyttä siivousregressiota sekä päällekkäisiä aiempia kontrolleja.
Näyttö kattaa muuttuneessa valinnassa säilyvät tiedostot ja viivästyneen
luvun päättymisen ennen hylkäystä. Rajattu riippumaton lähde-/testikatselmus
ja viimeinen rajatestidelta läpäisivät; katselmoija ei ajanut testejä.
Näiden vartijaporttien oma näyttö ei yksin todista recovery-/main-kytkentää
tai koko W7.4:n hyväksyntää. Varsinainen kytkentä ja sen näyttö kuvataan alla.

**Recovery-/main-kytkennän checkpoint 30.10.2026:** nykyinen
`WorkspaceBackupImportRecovery` kaappaa pakollisen cold-omistajan heti
leasen hankinnan jälkeen. Main antaa täsmällisen kahvan ja startup-sukupolven;
fyysinen main-varaus tarkistetaan erikseen candidate-työn ulkopuolella.
Rajattu `WorkspaceBackupImportColdContext` säilyttää tämän operaation
havaitut journal-/rekisteri-/binding-valinnat ja omien muutosten kuittaukset.
Se ei valitse uusia palautushaaroja tai korvaa nykyistä recovery-omistajaa.

Cold käyttää nyt havaintoon sidottua korjausta sekä nykyisiä selected-write-
portteja, readonly-jatkolukijaa ja root-/karanteeniomistajien muutosvartijoita.
Muiden palautusoperaatioiden ristiriitatarkistus on yhteinen main-admissionin
kanssa; oman aktiivisen tallentimen slotteja ei lueta sen ulkovartijassa.
Kaikki käynnistetyt alkuluvut ja vieraan recoveryn havainnot päättyvät ennen
hylkäyksen palautumista. Sidonnan kaikkien slottien ehto välitetään sen omaan
loppupoistoon. Sidonnaton v2 ei saa keksittyä julkaisukuittia tai bindingia.

Store-rajan callback kaappaa ensimmäisen vartijavirheen ennen tallentimen
turvallista virhemuunnosta. Menetetty kuittaus sulkee vanhan kontekstin;
uusi riippumattomasti hyväksytty käynnistys voi arvioida levyllä säilyneen
tilan uudelleen. Varauksen vapautus vaatii alkuperäisen työn päättymisen ja
erillisen fyysisen omistajuustodisteen myös epävarmassa virhepolussa.
Vapautusvirhe ei korvaa ensivirhettä. Tavallisen `running`-palautuksen
haaravalinnat ja kutsusopimukset säilyvät.

Yhtenäinen 28 tiedoston sarja läpäisi 741 testiä; yksi POSIX-testi odottaa
Linux-todennusta. Desktopin tyypitys läpäisi. Sarjan 13 uutta tiedostokoetta
käyttävät oikeita journal-/rekisteri-/binding-, root- ja karanteenitavuja;
ne kattavat myös selected-writen sisäisen vartijavirheen, kadonneen
kuittauksen, keskeneräisen työn ja erillisen vapautusvirheen. Pääprosessin
43 valittua käynnistys-/palautustestiä, E2E:n tyypitys ja rajattu riippumaton
katselmus läpäisivät. Katselmuksessa löytynyt ensivirheen muunnos korjattiin
ja tarkistettiin oikean selected-writen sisällä laukeavalla ristiriidalla;
katselmoija ei ajanut testejä itsenäisesti. Prosessiomistaja on näissä
mallinnettu. Valitsemattomia testejä ei lasketa läpäisyiksi, ja aiemmat sarjat
ovat päällekkäisiä, eivät lisäkattavuutta.
Nykyinen `DESK-WORKSPACE-STARTUP-001` läpäisi toteutusrevision `e9d575b1`
puhtaasta lähteestä käännetyllä testiruntimella: oikea Electron-candidate,
SQLite ja prosessivaraus sekä historiallisen sidonnattoman tuonnin ja
luonnin täsmällinen rekisteri ja tiedostotavut toisessakin käynnistyksessä.
Koe pysähtyy ennen business-backendia. Uuden sidonnan prosessinäyttö ja
paketoitu business-restart eivät seuraa tästä läpäisystä.
**Sidotun tuonnin Electron-todennus:** nykyinen proof käyttää nyt kolmea
erillistä aineistoa: luonti, sidonnaton tuonti ja sidottu tuonti. Testin
valmistelu julkaisee ja lukee bindingin todellisen prosessivarauksen sekä
täsmällisen valmisteluleasen alla. Jokaisen varsinaisen startupin jälkeen
bindingin kaikki slotit vaaditaan puuttuviksi; registry ja sisältötavut
verrataan myös toisessa käynnistyksessä. Factoryn nykyisestä scopesta
annetut vartijat torjuvat vanhentuneen callbackin myös fyysisen luvun jälkeen.
Yhteinen wire-tulos ja vanhat tapaukset säilyvät; uutta tuotantokanavaa ei avata.

Testiapurin 21 kontrollia, tyypitys, E2E-käännös ja rajattu katselmus
läpäisivät. Oikea Electron-koe läpäisi yhden sallitun kohdeuusinnan jälkeen.
Ensimmäinen ajo pysähtyi ennen testirunkoa backendin `EADDRINUSE`-virheeseen;
sen syy säilyy avoimena, mutta prosessipuun ja portin siivous todennettiin.
Tämä ei muuta vanhaa häiriötä onnistumiseksi tai korjatuksi viaksi.
Pysäytysraja on edelleen ennen business-backendia. Paketoitu näyttö on
erillinen alla; W7.4:n PR/main-portit ovat auki ja W7.5 pysyy suljettuna.

Nykyisen paketoidun kylmäpalautuksen fixtureen on lisätty erillinen sidottu
tuonti vanhojen kahden tapauksen rinnalle. Se todentaa bindingin lähtötilan
ja kaikkien slottien puuttumisen sovelluksen palautuksen jälkeen. Viisi
system-valmistelutapausta, 72 ajokytkennän kontrollia, tyypitykset ja rajattu
katselmus läpäisivät. Valmistelun simuloidut jälkiehdot eivät todista runtimea.
Passiivinen kohde ja tuonnin itsenäinen lähde verrataan tavuina; aktiivisen
työtilan tarkoitukselliset smoke-muutokset ja palautus todennetaan nykyisessä
smokessa erikseen.

**Paikallinen pakettinäyttö:** puhtaasta revisiosta `5da26f0b` kerran
rakennettu hardened Windows -paketti läpäisi luonnin, sidonnattoman tuonnin
ja sidotun tuonnin kylmäpalautuksen nykyisessä packaged-legacy-kytkennässä.
Kaikki kolme tapausta läpäisivät ensimmäisellä yrityksellä, kukin nykyisen
kahden prosessin backup/inspect/restore/restart-smoken kautta. Sidonta ja
journal poistuivat, rekisteri sekä passiivinen kohde ja itsenäinen tuontilähde
säilyivät jälkitarkistuksessa. Aktiivisen työtilan palautuksen sisältövertailu
on nykyisen smoken oma todiste. Paketin ja sovellusosan tavuidentiteetit,
tiedostomäärät ja tavumäärät täsmäsivät ennen ja jälkeen. Nykyisiä sisältö-,
koko-, fuse-, aika- tai hyväksyntärajoja ei muutettu. Tämä ei hyväksy koko
W7.4:ää, uusia vielä kytkemättömiä omistajia tai sen PR/main-portteja.

##### W7.4 B: replacement-sidonnan valtuus ja epävarma tulos

**Ensimmäinen toteutusosa (checkpoint-historia):** `WorkspaceBackupReplacementBinding` kaappaa
täsmällisen replace-kahvan, alkuperäiset valintatavut ja omistajaportit,
käyttää nykyistä sidontatallenninta sekä tarkistaa julkaistun kuitin.
Epävarma tulos säilyy kyseisen sidontaolion eliniän ja välittyy kutsujan
antamaan sulkuporttiin. Osan ja viereisten regressioiden rajattu ajo läpäisi 95 testiä;
yksi POSIX-testi odottaa Linux-näyttöä. Tyyppitarkistus ja rajattu riippumaton
koodikatselmus läpäisivät. Tämä osa ei vielä ole koordinaattorin tai mainin
tuotantokytkentä: epävarmuuden composition-laajuinen esto, korjaavan
journal-luvun vartiointi ja koko palautusketjun näyttö ovat seuraava pala.

**Kytkennän checkpoint 29.10.2026:** koordinaattori kaappaa nyt pakollisen
sidontaomistajan heti leasen jälkeen ja julkaisee sidonnan varmennetun sulun
jälkeen ennen payloadia. Management/main säilyttää epävarmuuden myös omien
capabilityjen sulun ja jonotetun paluukäynnistyksen yli. Epävarma julkaisu
ei oikeuta tavalliseen rollbackiin tai siivoukseen. Varmennetun julkaisun
jälkeinen tavallinen virhe käyttää edelleen nykyistä palautuspolkua tuoreilla
sidonta- ja valintatarkistuksilla. Korjaavan journal-luvun sivuslottien poisto
ja backupin julkaisu on todennettu oikeilla tiedostoilla menetetyn valtuuden
kohdalla; aloitetun työn sulku odotetaan ennen leasen vapautusta.
Jäädytetty 11 tiedoston sarja läpäisi 613 testiä ja oikean salatun backupin
kolme system-tapausta läpäisivät. Rajattu kytkentäkatselmus läpäisi.
Mallinnettu prosessivaraus ei ole native-todiste. Muut B:n omistajat ja
F:n puhdas paketti sekä PR/main-portit jäävät erillisiksi hyväksyntärajoiksi.

Migraatiosidonnan katselmuksen yhteydessä myös replacement-sidonnasta
poistettiin kolme samaa tulkinta-aukkoa: puuttuva kahva ei valitse nykyistä
varausta, päällekkäinen kutsu lukitsee jatkon ja lukemisen sisäinen
vartijavirhe talletetaan ennen kahvan sulkemista. Molempien sidontaosien
ja nykyisten kuluttajien seitsemän tiedoston sarja läpäisi 242 testiä;
desktop-tyypitys ja rajattu katselmus läpäisivät. Tämä lisänäyttö on
päällekkäistä aiempien sarjojen kanssa, ei uusi kokonaiskattavuuden summa.

**B:n muutosportit:** sidontakirjoittajan viimeinen synkroninen vartija
vaatii julkaistun kuitin, saman leasen ja nykyisen main-omistajuuden.
Epävarmuus on pysyvä; käynnissä olevaa kuitin lukua ei hyväksytä luvaksi.
Nykyisen activation-transaktion `prepare`, `advanceToValidation` ja
`rollback` sekä replacementin root-store ottavat rajatun valinnaisen
muutosvaltuuden. Uusi kutsuja antaa sekä tuoreen asynkronisen tarkistuksen
että välittömästi ennen tiedostomuutosta tehtävän synkronisen vartijan.
Tämä ei muuta vanhojen, porttia käyttämättömien kutsujien sopimusta eikä
korvaa cold-sisältötarkistusta tai sen journal-kontekstia.

Vartija kulkee alkujournalin luontiin, korjaavaan lukemiseen, hakemiston
luontiin/oikeuksiin, siirron jokaiseen nykyiseen uusintayritykseen,
rollbackin failed-safe-kirjoitukseen ja valmistelukansioiden poistoihin.
Root-store tarkistaa muuttuvan kohteen myös valtuuden asynkronisen luvun
jälkeen. Molempien siivouskohteiden epäselvyys torjutaan ennen ensimmäistä
poistoa; jäljelle jäävä kohde tarkistetaan uudelleen ennen omaa poistoaan.
Jo aloitettu tiedostotyö ja kahvan sulku liittyvät loppuun ennen virheen
palautusta; menetetty valtuus ei oikeuta seuraavaa muutosta.
Nämä portit ovat koordinaattori-/composition-kytkennän edellytys, eivät sen
valmistumisnäyttö. Tuotantokutsuja ei saa jättää uuden sidonnan vartijaa pois.
Jäädytetty porttien ja vanhojen kutsujen seitsemän tiedoston regressiosarja
läpäisi 600 testiä nykyisillä aikarajoilla. Rajattu katselmus läpäisi.
POSIX-oikeusmuutoksen ajonaikainen todennus kuuluu vielä Linux-porttiin;
paikallista Windows-näyttöä ei nimetä sen todisteeksi.

**Toteutusta edeltävä tarkennus:** tämä koskee ensimmäistä B-liitosta,
ei uutta palautusmoottoria tai vielä todennettua tuotantokytkentää.
`WorkspaceBackupReplacementCoordinator` säilyttää nykyisen preflight ->
replace-lease -> preRestore -> strict-stop -> poissaolo -> candidate -järjestyksen.
Sidonnan julkaisu tulee poissaolon jälkeen ennen `prepareCandidate/stageBackup`a.

Lähdekartoituksessa on kaksi toteutuksessa huomioitavaa eroa:
`disposeWorkspaceRuntimeCapabilities` sulkee normaalin korvauksen omassa
sulussa myös management-palvelun ja sen operation-guardin. Niiden avoimuus
ei siten voi olla sulun jälkeisen sidontakirjoituksen ehto. Lisäksi
`WorkspaceManagementService` yrittää deferred-relaunchin päättämistä myös
komennon virheessä. Pelkkä hylätty Promise ei ole paluun esto.
Nämä ovat nykyisen ketjun ominaisuuksia, eivät väite uudesta tuotantoviasta.

**Nykyiset omistajat ja portit:**

- Replacement saa pakollisen rajatun sidontaportin. Se kaappaa juuri saadun
  replace-leasen omistajuuden heti hankinnan jälkeen ennen seuraavaa
  asynkronista työtä. Nykyinen `captureCurrentOwner` tarkennetaan tässä
  kutsussa vertaamaan myös hankittua kahvaa; sama tarkoitus tai myöhempi
  samanlainen lease ei kelpaa. Muiden kutsujien nykyinen käyttö säilyy.
- Management-composition yhdistää tämän nykyisen main-varauksen
  `assertMainOwned`-/`assertMainCurrent`-tarkistuksiin. Sidontaportissa ne
  ovat pakollisia, eivät candidate-portin valinnaisia no-op-kutsuja.
  Mainin fyysistä omistajuutta vaaditaan vasta todetun backend-sulun jälkeen.
  Sidonnan talletettu arvo tai mainin elinikätarkistus yksin ei riitä.
- Koko sovelluksen alkava shutdown sulkee sidonnan jatkovaltuuden heti
  mainin nykyisellä `shutdownStarted`-tilalla, ei vasta varauksen lopullisessa
  vapautuksessa. Tämä tarkistetaan myös odotusten jälkeen. Palautuksen oma
  capability-sulku ei aseta tätä koko sovelluksen sammutuksen ehtoa.
- Kohde ja autentikoitu lineage tulevat koordinaattorin jo validoidusta
  alkuperäisestä valinnasta. Sidontakirjoittaja lukee registry-slotit
  korjaamatta niitä: yksi kelvollinen current, ei sivuslotteja, täsmällinen
  sama registry-arvo. Se kaappaa tavut ja tiedostoidentiteetin ja vertaa
  niitä odotusten jälkeen. Älä käytä korjaavaa `registry.read()`a uuden
  metadatan I/O-vartijana tai korvaa valintaa uudella havaitulla kohteella.
- Synkroninen vartija tarkistaa saman leasen, main-omistajuuden ja pysyvän
  mitätöitymisen. Asynkroninen vartija todistaa runtime-poissaolon, mainin
  varauksen ja muuttumattoman registry-valinnan nykyisillä omistajilla;
  synkroninen tarkistus tehdään jokaisen odotuksen jälkeen. Tallennin
  käyttää näitä nykyisissä slot-/tiedostomuutoksissaan ja lopputarkistuksessa.
  Suljettua operation-guardia ei avata uudelleen eikä käytetä tähän.

**Julkaisutulos ja virheen päättäminen:**

1. Ennen sidontaportin ensimmäistä I/O:ta koordinaattori merkitsee
   julkaisuyrityksen alkaneeksi. Vain odotettu valmis julkaisu, readback
   ja tuore valtuustarkistus hyväksyvät kuitin. Currentin löytyminen
   hylätyn kutsun jälkeen ei jälkikäteen muuta yritystä onnistuneeksi.
2. Epävarma julkaisu tai kuitin myöhempi valtuusristiriita ohittaa tavallisen
   `recoverFailure`-haaran: ei `discardBeforeActivation`ia, rollbackia,
   `ensurePreviousWorkspaceRunning`ia, uutta relaunch-pyyntöä tai
   metadata-siistintää. Sidonta, preRestore-piste ja mahdollinen muu
   aineisto säilyvät. Tämä ei estä ennen sidontayritystä syntyneiden,
   nykyisen sopimuksen mukaan turvallisten virheiden tavallista käsittelyä.
3. Nykyinen composition sulkee admissionin ja mitätöi nykyisen main-varauksen
   jatkovaltuuden vapauttamatta fyysistä varausta kesken työn. Epävarmuus
   jää kyseisen compositionin eliniäksi myös deferred-completionin
   synkroniseen vartijaan. Sekä jo jonotettu että myöhäinen paluupyyntö
   estetään; uusi lease tai uusi `complete()` ei nollaa estoa.
   Tätä varten ei lisätä yleistä tilapalvelua tai toista relaunch-omistajaa.
4. Kaikki aloitetut tallennus-/sulkutyöt odotetaan ja sama lease vapautetaan
   nykyisessä finally-polussa. Palvelun pending-work sisältää tämän
   päättämisen; ulkoinen shutdown ei odota itseään. Ensivirhe säilyy
   mahdollisen eston, releasen tai myöhemmän sulkuvirheen rinnalla.
5. Tavallinen onnistuminen ja todettu rollback säilyttävät nykyisen
   relaunch-järjestyksen. Replacementin loppucompletioniin ei siirretä
   jo vapautetun leasen vartijaa: W7.3:n delete-valmistelun erillinen
   saman leasen luovutussopimus ei muutu kaikkien komentojen sopimukseksi.
   Epävarmuusvartija ei yksin anna paluulupaa tai kumoa nykyisiä tarkistuksia.

Kuittauksen jälkeen syntyvän tavallisen candidate-/activation-virheen
käsittely säilyy nykyisen palautusomistajan vastuulla. Saman julkaistun
sidonnan tavut, identiteetti ja tuore valtuus tarkistetaan jo ennen
`recoverFailure`-haaran ensimmäistä korjaavaa activation-journalin lukua:
`read()` voi siirtää tai poistaa slotteja, joten vain ennen
`discardBeforeActivation`ia tai rollbackia tehty tarkistus olisi myöhässä.
Valtuus viedään nykyisten journal-/transaktioporttien kautta myös tämän
korjaavan luvun ja myöhemmän siivouksen muutosrajoille. Ristiriita siirtyy
yllä olevaan säilyttävään polkuun. Payloadin ja metadatan poisto ovat eri
asioita. Metadata poistuu
vain aiemmin määritellyllä `clearAfterPayloadsAbsent`-sopimuksella kaikkien
oman operaation jäännösjuurten poissaolon jälkeen. Cold-recovery ei saa
johtaa tätä lupaa kadonneesta activation-journalista.

**Ensimmäisen B-palan todistus ennen muita omistajia:**

- Oikea coordinator + sidontatallennin: onnistunut readback ennen payloadia;
  väärä lineage/preflight torjutaan yhä ennen leasea ja sulkua.
- Oikeat slotit: katko ennen/jälkeen nextin julkaisun, kadonnut kuittaus,
  muuttunut registry-tavu tai tiedostoidentiteetti ja menetetty main-/lease-
  valtuus. Tarkista säilyneet tavut ja ettei cleanup/paluu käynnisty.
- Recovery: muuttunut sidonta torjutaan ennen ensimmäistä korjaavaa
  journal-lukua; luvun aikana menetetty valtuus estää slotin siirron tai
  poiston. Tarkista kaikki säilyneet journal-slotit, ei vain loppuvirhettä.
- Ulkoinen shutdown kesken sidonnan I/O:n estää seuraavan muutoksen;
  aloitettu kahvan sulku liittyy silti loppuun ennen leasen vapautusta.
- Todellinen lease-omistaja: vapautus ja uusi saman tarkoituksen lease eivät
  elvytä vanhaa vartijaa. Async-vartijaa ei hyväksytä synkroniseksi luvaksi.
- Nykyinen service + deferred-relaunch: epävarma julkaisu, valmiiksi jonotettu
  ja myöhäinen paluu, viivästetty tiedostokahvan sulku, releasen lisävirhe
  sekä ulkoisen shutdownin liittyminen. Ensivirhe ja päättämisen virheet
  erottuvat eikä valmis sulku tarkoita onnistunutta mutaatiota.
- Oikea main-composition: oma admission-sulku ei hylkää kelvollista sidontaa;
  epävarmuus estää uudet työt ja paluun. Normaali onnistuminen, preRestore-
  virhe ja rollback säilyvät. Pelkät guard-mokit eivät täytä tätä näyttöä.

Rajattu riippumaton katselmus edeltää muiden B-omistajien kytkentää.
Alkuperäisen virheen nykyinen yksityinen syyketju, turvallinen palaute ja
operational-lukijat tarkistetaan toteutuksen mukana; uusia julkisia
raakakenttiä ei lisätä. B:n koko jäännösluettelo-/cleanup- ja cold-liitos
sekä F:n prosessi-, paketti-, salaus/purku- ja PR/main-portit jäävät erillisiksi
vaatimuksiksi. Tämä suunnitelma ei yksin todista yhtäkään niistä.

##### W7.4 B: activation-migrationin vaihekohtainen sidonta

Migraation palautuspiste muodostetaan edelleen ennen kohteen startup-backendin
sulkua. Sidonnan julkaisu ei siksi voi käyttää replacementin suljetun runtimen
ehtoa sellaisenaan. Nykyinen switch-lease, käynnistyksen elinikäomistaja,
prosessivarauksen omistaja ja snapshot-omistaja säilyvät erillisinä vastuina.

- `WorkspaceActivationMigrationBinding` kaappaa täsmällisen switch-kahvan,
  validoidun proofin tavut sekä omistajaportit ennen ensimmäistä odotusta.
  Puuttuva tai vieras kahva ei tarkoita nykyisen varauksen automaattista valintaa.
- Ennen snapshotia julkaistava metadata vaatii saman käynnistysvaltuuden sekä
  registry- ja switch-journalin muuttumattomat current-slotit. Niiden tavut ja
  tiedostoidentiteetit kaapataan korjaamattomalla luvulla; sivuslotti tai myöhempi
  muutos estää jatkon. Pelkkä sama normalisoitu arvo ei korvaa raakavalintaa.
- Vasta onnistuneen tiukan sulun jälkeen `enterStopped()` todistaa runtimen
  poissaolon ja mainin fyysisen omistajuuden. Candidate-prosessille siirretty
  varaus ei ole mainin muutoslupa, vaikka vanha startup-backend olisi päättynyt.
  Nykyinen candidate-omistaja vastaa siirrosta ja palautuksesta.
- Päällekkäinen kutsu, menetetty valtuus tai epävarma julkaisu lukitsee sidonnan
  jatkon. Ensimmäinen vartijavirhe säilyy jo ennen alkuperäisen tiedostoluvun
  päättämistä; ilmoitus- ja sulkuvirheet säilyvät sen rinnalla. Aloitettu työ
  odotetaan, eikä myöhäinen onnistuminen tai uusi lease elvytä vartijaa.
- Migraation epävarmuusilmoitus estää loogisen jatkon. Se ei vapauta tai
  mitätöi lapsiprosessin fyysistä varausta ennen nykyistä exit/reclaim-ketjua.
  Sulku ja päättäminen ovat yhä niiden nykyisten omistajien tehtäviä.
- Palautuspisteen lähdesnapshot ja migraatiolle materialisoitu staging saavat
  saman operaation kaapatun lisäsiivousvaltuuden. Se ei korvaa tarkistimen
  fyysistä omistajaa eikä vaadi kohteen sulkua ennen snapshotin muodostamista.
  Tiedostopoisto vaatii molemmat; valtuus säilyy snapshotin omistajatietueessa
  myös tavallista runtime-shutdownia varten. Tunnettu epävarmuus estää
  alkuperäisen virheen jälkeisen siivouksen myös ylemmän kutsujan catch-haarassa.
- Nykyisen purun sisäinen virhesiivous tarkistaa kaapatun synkronisen
  jatkoluvan. Epävarma osittainen staging tai selväkielinen välitiedosto
  säilytetään, eikä onnistunut sulku yksin anna poistolupaa. Aloitettu I/O
  päättyy nykyisillä omistajilla; tässä ei rakenneta yleistä streaming-
  peruutusjärjestelmää. Alkuperäinen salattu palautuspiste sekä sen nykyinen
  erillinen luonti-, tarkistus- ja rotaatio-omistajuus säilyvät.
- Sidottu virhepolku odottaa myös purun luku- ja kirjoituskahvojen sulut.
  Sulkuvirhe säilyy ensivirheen rinnalla ja estää sisäisen sekä ylemmän
  kutsujan virhesiivouksen. Kelvollinen sidonta ei yksin todista kahvan sulkua.
  Sama epävarmuus välittyy nykyisellä siivousvirheen sopimuksella; tavallisten
  sitomattomien kutsujien toimintaa ei muuteta tässä liitoksessa.
- Lisävaltuutta käyttämättömät backup- ja palautuskutsujat säilyttävät nykyisen
  polkunsa. Uusi valtuus ei ole renderer-capability, pysyvä backup-kenttä tai
  uusi prosessiomistaja. Sen katoaminen säilyttää ensivirheen ja aineiston;
  myöhäinen kuittaus ei elvytä hylättyä siivousta.

**Osan checkpoint 29.10.2026:** sidonnan ja siivousvaltuuden edellytykset on
toteutettu nykyisissä snapshot-, palautuspiste- ja staging-omistajissa.
Jäädytetty 14 tiedoston regressiosarja läpäisi 404 testiä ja desktopin
tyyppitarkistus läpäisi. Rajattu katselmus ja sen sulkuvirhekorjaukset kattavat
myös alkuperäisen työn päättymisen sekä ylemmän virhesiivouksen eston.
Koordinaattori-/main-liitos välittää nyt saman lisävaltuuden snapshotin
valmisteluun ja siivoukseen sekä vartijat korjaavaan journal-lukuun ja
payload-muutoksiin. Source-recoveryn tarkoituksellinen valinnanmuutos päättää
vanhan sidonnan käytön ennen luovutusta; selector-paluu säilyttää nykyisen
erillisen restore-omistajan switch-leasen vapautumisen jälkeen.
Vanhaa sidontaa ei päivitetä uusiin havaittuihin tavuihin. Mainin looginen
jatkoesto ei mitätöi fyysistä prosessivarausta ennen lapsen exit/reclaim-ketjua.
Alkuperäinen valmisteluvirhe säilyy myös siivousvartijan hylätessä jatkon;
paluukäynnistyksen ja jatkoestoilmoituksen lisävirheet eivät peitä sitä.
Nykyisen scoped-combined-korjauksen jälkeen molemmat oikeita sidonta- ja
aktivointitiedostoja käyttävät onnistumispolut ja neljä virhepolkua läpäisivät
nykyisillä aikarajoilla. Vaikutusalueen kahdeksan tiedoston 740 testiä,
desktopin tyypitys ja rajattu riippumaton katselmus läpäisivät.
Testin oma varaus vapautetaan
vasta alkuperäisen työn päätyttyä; epäonnistunut tai keskeneräinen aineisto
säilyy. Aiempi main-näyttö ja hylkäykset on erotettu
[integraatiohistoriaan](release-0.3.0-integration-history.md#activation-migrationin-kertautuvat-tarkistukset).
Main-/startup-ketjun ja migraation kuuden tiedoston jälkitodennus läpäisi
383 testiä. Yhteisen korvausportin kolme system-tapausta läpäisivät oikealla
salatulla backupilla, SQLitellä ja PDF-aineistolla; E2E:n tyypitys läpäisi.
Ne eivät korvaa activation-migrationin native- ja pakettinäyttöä.
Koko liitoksen hyväksyntäportit ovat vielä kesken; uuden toiminnallisen
vaiheen edellä käsitellään [M1:n uusi auditointieste](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Erillisiä päällekkäisiä testisarjoja ei lasketa yhteen.
Prosessirajan mallinnus ei korvaa native- tai paketoitua hyväksyntää.
Valitsimesta alkavan avauksen nykyinen proof- ja alkuperäisvalinnan tarkistus
säilyy myös uuden sidonnan rinnalla. Nykyiseen valintaan otettu uusi sidonta
ei saa korvata aiemmin myönnetyn valtuuden tarkistusta. Muusta yrityksestä
alkavan koordinaattoripolun korjaavat registry-/switch-uusintaluvut korvataan
sidonnan täsmällisillä readonly-luvuilla, ei poistamalla tuoreuden tarkistusta.

**Yhdistetyn eteenpäin-kirjoituksen lukukonteksti.** Alla kuvattu rajattu
kytkentä ja sen kaksi kertautumiskorjausta on toteutettu. Nykyinen näyttö
on yllä; seuraava työ on liitoksen jälkitodennus, ei uusi yleinen
tarkistusten vähennys. Aikarajat, sisältövaatimukset ja muutosvartijat säilyvät.

- `ProfileRestoreActivationJournalStore` saa käyttää nykyistä
  `writeContext`-mekanismia myös nimenomaiselle `kind: 'combined'` -kutsulle.
  Tämä on nimetty lisäys alempana kuvattuun cold-`separateContent`-rajaan,
  ei sen korvaaminen. Puuttuva laji, alkujulkaisu ilman edeltäjää,
  vajaa konteksti, combined-kutsun sisältöcallback tai puuttuva viimeinen
  synkroninen live-vartija hylätään ennen tiedostomuutoksia.
- Sisäiset luvut tarkistavat saman omistajan sekä tarkan journalirevision
  ja nykyiset slotit. Täysi yhdistetty valtuus tarkistetaan ennen jokaista
  kahdeksaa nykyistä journal-mutaatiota. Sen jälkeen tarkistetaan kyseisen
  vaiheen slotit ja avattu kahva sekä viimeisenä synkroniset vartijat.
  Julkaisun jälkeinen täysi kuittaus säilyy. Tavujen atomista suojaa
  ulkopuoliselta tiedostomuutokselta ei luvata.
- `WorkspaceActivationMigrationBinding` antaa rajatun lukuomistajuuden
  vain julkaistulle, pysäytetylle vaiheelle. Sama switch-lease, startup,
  runtimen poissaolo ja mainin fyysinen omistajuus tarkistetaan nykyisillä
  porteilla odotusten ympärillä. Registry-/switch-/sidontatavuja ei lueta
  uudelleen tämän sisäisen lukuvartijan sisällä. Täysi `assertPublished`
  ja valitsimen alkuperäisen proofin `reprove` säilyvät muutosrajalla.
- Koordinaattorin oma jatkolupa tarkistetaan myös lukuvartijan alussa ja
  lopussa. Hylkäys kulkee nykyiseen pysyvään epävarmuustilaan; luovutus,
  sulku tai myöhäinen callback ei elvytä valtuutta. Ensivirhe ja aineisto
  säilyvät ja aloitettu työ odotetaan loppuun.
- Transaktio käyttää kontekstia vain valitun eteenpäin-aktivoinnin
  journal-kirjoituksiin. Edeltäjä, laji, callbackit vastaanottajineen ja
  kontekstin läsnäolo kaapataan ennen odotusta. Payload-siirrot, rollback,
  alkujulkaisu ja vanhat kontekstittomat kutsut säilyttävät nykyiset porttinsa.
  Tyhjää sisältöcallbackia ei käytetä uuden polun avaamiseen.
- Vain tämän eksplisiittisen combined-kontekstin täysi kirjoitusvaltuus
  kutsuu kaapattua ulkoista valtuutta kerran. Transaktio ei lue samaa
  journalia sen sisällä uudelleen: kirjoittaja tarkistaa edelleen jokaisella
  kahdeksalla muutosrajalla vaiheen current-/backup-/next-slotit sekä avatun
  next-kahvan ja viimeiset synkroniset vartijat. Julkaisun readback ja
  edeltäjän poiston suojat säilyvät. Sisäinen lukuvaltuus on yhä
  journal-sidottu. Tämä ei poista journalin tarkistusta payload-siirroista
  eikä muuta separateContent-, rollback-, alkujulkaisu- tai kontekstittomia
  kutsuja. Rajattu lähdekatselmus edeltää uuden haaran todennusta.
- Saman validoidun combined-kontekstin payload-siirto ja kohdekansion
  valmistelu säilyttävät yhden kokonaisen omistajuus -> tarkka journal ->
  omistajuus -tarkistuksen ennen viimeisiä synkronisia vartijoita.
  Sisältöcallbackin puuttuessa sen ympärille ei tehdä kahta peräkkäistä
  identtistä tarkistusta. Jokainen muutos ja mahdollinen rename-uusinta
  hankkii tarkistuksen uudelleen. Kontekstittoman ja separateContent-polun
  järjestys säilyy; tämä ei ole ulkoisten tiedostomuutosten atominen lukko.
- Laajenna nykyisiä regressioita: väärä/vajaa konteksti, kaikki kahdeksan
  viimeistä muutosvartijaa, vaihtunut slotti/kahva, lukujen aikana muuttunut
  yritysvalinta, menetetty fyysinen omistajuus sekä callbackin korvaus ja
  viivästetty kahvasulku. Vertaa säilyneitä tavuja. Molemmat oikean sidonnan
  onnistumispolut ja neljä virhepolkua vaaditaan nykyisillä aikarajoilla;
  uusi hylkäys tutkitaan, ei uusita vihreään asti.

##### Replacementin käynnistyspolkujen yhteinen omistajuusraja

**Rajattu toteutusratkaisu:** säilytetään nykyinen tuotannon deferred-handoff
ja startup-hyväksyntä. Koordinaattorin vaihtoehtoinen välitön
`ensurePreviousWorkspaceRunning -> accept/clearRolledBack` poistetaan vasta
alla nimetyn vastaavan kattavuuden jälkeen. Sille ei rakenneta toista
live-valtuutta eikä pysähtyneen runtimen tarkistusta muuteta valinnaiseksi.
Tämä on W7.4 B:n liitoksen täsmennys, ei uusi palautusarkkitehtuuri.

**Ensimmäinen toteutusosa:** koordinaattorin yksikkötestit ja oikean salatun
backupin kolme system-tapausta käyttävät nyt luovutusta ja erillistä nykyistä
startup-recoveryä. Kolme system-testiä sekä desktopin ja E2E:n tyypitys
läpäisivät tämän liitoksen checkpointissa. Uusi `rolledBack`-cleanup-portti on
startup-omistajassa ja replacement-factoryssä; se on todennettu myös oikeilla
tiedostotavuilla sekä valtuuden menetyksellä. Sen main-valtuus ja pysyvän
sidonnan tarkistusten kytkentä ovat vielä tekemättä. Katselmuksen
uudelleenkutsuhavainto korjattiin ja regressio sekä delta-katselmus läpäisivät.
Tämä ei ole main-/native-/pakettihyväksyntä: välitön lähdehaara säilyy vielä
poistamisen näyttöporttiin asti. Aiemmat testimäärät ovat päällekkäistä näyttöä,
eivät tähän lisättäviä uusia läpäisyjä.

Käynnistyksen `captureWorkspaceBackupReplacementStartupBinding` käyttää
nykyistä sidontatallenninta vain muuttumattomaan lukuun. Lukija tarkistaa nyt
molemmat nimetyt aktivointiomistajat ja lukitsee myös puuttuvat slotit,
raakatavut ja tiedostoidentiteetit. Jokainen myöhempi tarkistus saa nykyisen
vaiheomistajan valtuuden erikseen. Migration vaatii saman operaation
switch-kontekstin; `legacyUnbound` ei saa tuottaja- tai payload-poistolupaa.
`mode` on muuttumaton havainto, ei valtuus. Nykyinen startup-valitsin
välittää lisäksi rekisteröidyn kohteen validoidun lineagen muuttumattoman
kopion; adoptioniin ei arvata lineagea.

Lukijan 44 regressiota sekä säilyvät registry-/switch-, adoption- ja
kopioaktivointitestit läpäisivät nykyisessä seitsemän tiedoston 204 testin
kohdesarjassa. Desktopin tyyppitarkistus ja rajattu riippumaton
koodikatselmus läpäisivät. Nämä korvaavat tämän palan
aiemman kohdeajon nykytilana, eivät ole siihen yhteen laskettavia läpäisyjä.
Lukija ei julkaise tai korjaa metadataa; mainin cold-/live-/työlupakytkentä
ja native-/pakettitodennus ovat edelleen tekemättä.

**Main-kytkennän omistajuussopimus (28.10.2026):** sama
`createWorkspaceBackupReplacementStartupRecovery` ja asennustasoinen
aktivointijournal palvelevat palautusta ja päivityksen kopioaktivointia.
`startupRecoveryAuthority === 'workspaceReplacement'` nimeää tässä
tiedostoasettelun, ei journalin tuottajaa. Myöskään `targetValidation`-tila
ei yksin todista omistajaa. Alla oleva liitos tarkentaa nykyisiä omistajia;
se ei muuta palautuksen tilakonetta, journal-formaattia tai hyväksyntärajoja.

1. Valittu operation-ID luetaan nykyisestä korjaamattomasta `peek`-tuloksesta.
   Nykyinen startup-sidontalukija laajennetaan lukemaan sarjassa sekä
   `workspaceReplacement`- että `workspaceActivationMigration`-sidontapaikka.
   Täsmälleen yksi julkaistu, kelvollinen ja kohteeseen sopiva omistaja
   hyväksytään. Molemmat puuttuvat tarkoittaa vain `legacyUnbound`-havaintoa:
   vanha palautussopimus säilyy, mutta tuottajaa tai poistolupaa ei keksitä.
   Kahden omistajan julkaisu, vieras kohde, osittainen julkaisu tai virheellinen
   slotti pysäyttää työn; virhettä ei muuteta puuttuvaksi sidonnaksi.
2. Molempien paikkojen kaikki slotit, raakatavut, identiteetit ja puuttuminen
   lukitaan samaan valintaan. Myöhemmin ilmestyvä toinen omistaja, katoaminen
   tai samojen tavujen vaihtuminen uuteen tiedostoidentiteettiin hylätään.
   Lukija käyttää vain nykyistä `WorkspaceRemnantBindingStore.inspect`-porttia.
   Se ei korjaa, julkaise tai poista sidontaa. Aiempi yhden omistajan lukijan
   näyttö ei vielä todista tätä kahden paikan kytkentää.
3. Odotettu workspace ja lineage tulevat nykyisen
   `resolveActiveWorkspaceStartup`-omistajan validoimasta rekisterimerkinnästä,
   eivät sidontatiedostosta tai sen nimestä. Rekisteröidyn valinnan muuttumaton
   lineage välitetään nykyisessä startup-valinnassa mainille. Rajattu
   readonly-valintatarkistus käyttää nykyisiä registry-/switch-slottilukuja
   ja todentaa tämän valinnan uudelleen vaiheomistajan alla. Adoptioniin ei
   lisätä arvattua lineagea: ilman rekisteröityä kohdetta julkaistu sidonta
   ei saa lupaa, mutta sidonnaton vanha polku säilyy nykyisine tarkistuksineen.
4. Julkaistu migration-sidonta vaatii saman operaation validoidun
   switch-kontekstin. Puuttuva tai vieraan operaation konteksti estää työn;
   sitä ei tulkita tarkistuksen poissuluksi. Operation-ID, source/target,
   lineage ja käsiteltävä aktiivinen juuri eivät saa
   olla ristiriidassa. Lähdeyritykseen paluun `rollbackValidation` ei muuta
   toisen kohteen globaalia journalia lähdeyrityksen journaliksi. Ristiriita
   säilyttää aineiston; main ei vaihda palautuskohdetta sidonnan perusteella.
   Migrationin oman sidonnan kirjoittaja kytketään myöhemmässä B-palassa
   vasta sen oman source-null-/source-nonnull-kattavuuden jälkeen.
5. Sidontatilannekuva kuuluu valittuun palautusoperaatioon, ei koko mainin
   elinkaareen. Se kaapataan ennen tämän journalin ensimmäistä korjaavaa
   lukua tai muutosta ja tarkistetaan uudelleen ennen backendin työlupaa.
   Mainin rajattu readonly-valmistelu hankkii oman restore-leasen, tarkistaa
   startup- ja valmisteluvaiheen omistajuuden sekä valitun journalin uudelleen
   ja vapauttaa valmisteluleasen ennen cold- tai live-vaiheen omaa leasea.
   `accepted`-valmistelu kuuluu alla kuvatun työlupasiirron valmisteluvaiheeseen,
   ei siirron aikana kiellettyyn yleiseen `assertMainOwned`-kutsuun. Tilannekuva ei
   säilytä valmisteluleasen closurea; vaiheiden välinen muutos hylätään
   uuden omistajan tarkistuksessa. Vaaditun tilannekuvan puuttuminen ei ole
   callbackin valinnaisuutta eikä lupa palata vanhaan ohittavaan polkuun.
   `accepted`-tilan valmistelun nykyinen korjaamaton luku säilyy; korjaus ja
   siivous odottavat live-terminalin valtuutta. `failedSafe` ei saa korjaavaa
   fallbackia. Journaliton normaali käynnistys ei kaappaa kaikkia tulevia
   operaatioita puuttuviksi. Saman käynnistyksen myöhempi source-null-
   candidate-rollback saa oman täsmälliseen kuittiin sidotun valintansa.
6. Registry-/switch-valinta lukitaan palautuksen vaiheeseen, ei sen jälkeisten
   hyväksyttyjen siirtymien yli. Nykyinen järjestys säilyy: palautuksen
   terminal valmistuu, sitten `activeWorkspace.accept`, W6-rekisterisiirtymä
   ja FirstStart. Valintaa ei päivitetä huomaamatta tarkistuksessa. Odotettu
   terminal sulkee oman valintansa; myöhempi nimetty operaatio hankkii uuden
   valtuuden. Ulkopuolinen muutos ennen tätä rajaa on virhe.

Source-nonnull-paluun odotukset erotetaan: jos kohteelle ei jää
aktivointijournalia, nykyinen turvallinen lähdevalinta ja relaunch säilyvät.
Jos julkaistu sidonta osoittaa kohteeseen mutta sen journal on vielä
jäljellä, lähteeksi vaihtunut valinta ei saa suorittaa kohteen cleanupia.
Tulos on recovery-esto, aineiston säilyminen ja ei uutta business-avausta;
journalia ei tulkita lähteen aineistoksi. Tämä on uuden sidotun havainnon
ristiriitaraja, ei lupa muuttaa nykyistä `legacyUnbound`-paluupolkua tässä
palassa. Sidonnattoman nonnull-paluun nykyiset sisältö-, lineage- ja
siivoustarkistukset sekä tulos säilytetään regressioina. Ennen migrationin
sidontakirjoittajan myöhempää kytkentää sen oma B-portti vaatii myös nimetyn
kohdeomistajan terminalin ennen lähdevalinnan vaihtoa tai erillisen
ratkaisupäätöksen; tämän lukijakytkennän hyväksyntä ei yksin hyväksy sitä.

**Asynkroninen tarkistus nykyisissä vaiheomistajissa:**

Palautusapu saa rajatun valinnaisen `assertOperationSelection`-portin, joka
vastaanottaa kyseisen vaiheen synkronisen valtuustarkistuksen. Mainin
replacement-kytkentä antaa portin aina, myös sidonnattomalle havainnolle.
Ordinary restore ja C:n päivityspalautus säilyvät nykyisillä porteillaan.
Mainin callback lukee vain sidonta-/valintametadatan; se ei kutsu sisältö-
validointia, leasen hankintaa, ulompaa `assertCurrent`ia tai itseään.
Backendin työlupaa edeltävä readonly-tarkistus kytketään nykyiseen
`reservationTransfer.assertGrant`-ketjuun sen startup-/siirtovaltuudella.
Se säilyttää perusadapterin `assertGrant`in ja viimeisen synkronisen
vartijan. Valmistellulle lapselle jo luovutettua varausta ei tässä vaadita
mainin fyysiseksi omistukseksi eikä hankita sisäkkäistä restore-leasea.

| Nykyinen omistaja | Tarkistuksen järjestys |
| --- | --- |
| `prepareProfileRestoreColdForwardRecovery` | Täsmällinen restore-lease ja main-/staging-omistus, valintaportti, sama perusomistus uudelleen. Tämä on nykyisen `assertCurrent`in sisällä; sisältöportin ja journalin muutossuojat säilyvät. |
| `withProfileRestoreColdRollbackAuthority` | Oma tai nimenomaisesti lainattu restore-omistaja, alkuperäisten lähteiden/ankkurin nykyiset varaukset ja sama valintaportti ennen sisältö-/muutostarkistuksia. Lainattua leasea ei hankita uudelleen eikä vapauteta apurin omana. |
| `withProfileRestoreTerminalAuthority` | Uusi restore-lease, elävän backendin fence ja snapshot. Valintaportti tarkistetaan ennen journalin käsittelyä sekä jokaisessa terminalin `assertCurrent`issa ennen nykyistä tuoretta fence-/snapshot-/jäännösvarausten tarkistusta. Ei `workspaceReservation.assertMainOwned`-ehtoa elävälle backendille. |
| Replacementin `withRolledBackCleanupAuthority` | Tuore validointivaiheen restore-lease jatkuu saman validoinnin loppusiivoukseen. Startup-/kohde-/sidontatarkistus ja nykyinen `clearRolledBack(expected, guard)` säilyvät; ei toista leasen hankintaa tai accepted-terminalia. Alla oleva jatkoportti rajaa työn nykyiseen validointiaikaan. |

Porttia ei piiloteta yleiseen `read`-wrappaukseen: sisäkkäiset snapshot-
lukijat eivät saa kutsua samaa tarkistusta uudelleen tai kertoa raskasta
sisältövalidointia. Cold-sisältövalidointi jatkaa nykyisen `assertCurrent`in
kautta, mutta sidontalukijan ulkoinen tarkistus sisältää vain kevyen
registry-/switch-valinnan. Nykyinen lopullinen tavujen/identiteetin
uudelleentarkistus jää tämän jälkeen, eikä sen perään lisätä uutta
odottavaa valintalukua ennen tiedostomuutosta. Synkroniset viimeiset
vartijat pysyvät synkronisina; Promise ei ole onnistunut tarkistus.

Portin työ kuuluu nykyisen vaiheen määräaikaan ja päättämistodisteeseen.
Myöhäinen tulos ei saa jatkaa muutosta tai elvyttää omistajaa. Keskeneräinen
I/O ei anna lupaa vapauttaa fyysistä varausta, vaihtaa yritystä tai jatkaa
siivousta: nykyisen omistajan epävarma sulku ja invalidointi säilyvät, ilman
uutta odotusaikaa tai rajatonta kuittausodotusta. Valinta-/sidontavirhe lukitsee
mainin nykyisen recovery-eston ennen yleistä virhepalautusta; se ei saa
pudota `activeWorkspace.recoverFromFailure`-paluukäynnistykseen. Alkuperäinen
virhe ja päättämisen virhe säilyvät erillisinä nykyisessä virheketjussa.

**Valintatyön budjetti ja sulku, rajattu selvitys 28.10.2026:** cold-forwardin
ja cold-rollbackin nykyinen sisältötyön määräaika alkaa native-valmistelun
jälkeen. Nykyinen lease ei ole ajastin, eikä myöhemmin käynnistyvän backendin
readiness-aika kata tätä alkuvalmistelua. Lähdekatselmus ja kaksi hallitun
kellon koetta vahvistivat, ettei uusi alkuvalintaluku saa niistä määräaikaa.
Tämä ei ole todistettu regressio vanhassa palautuspolussa.

**Omistajan hyväksymä rajaus 28.10.2026:** vain uuden W7.4-kytkennän cold-
vaiheessa nykyinen 35 000 ms työaika alkaa ensimmäisestä valintatarkistuksesta.
Sama absoluuttinen määräaika kulkee alkuvalmistelusta sisältötyön loppuun;
valinnan kaappaus, leasen vaihto tai native-valmistelu ei nollaa sitä.
Tämä säilyttää sekuntirajan mutta vähentää sisältötyön jäljellä olevaa
aikaa valmistelun verran. Tavallisten kutsujien ajoitus ei muutu.
Erillinen uusi valmisteluaika kasvattaisi kokonaisbudjettia eikä ole
hyväksytty vaihtoehto. Cold-apurien sisäinen portti on toteutettu alla;
mainin kutsujakytkentää ei vielä ole tehty.

Sulun toteutusraja säilyy aikapäätöksestä riippumatta: vaiheomistaja seuraa
alkuperäistä lukutehtävää tiedostokahvan sulkuun asti, ei vain aikakatkaistua
odotus-Promisea. Peruutus sulkee uudet luvut ja jatkovaltuuden synkronisesti;
jo avatun kahvan `finally`-sulku saa päättyä. Myöhäinen tulos ei anna
julkaisua, uutta palautusta tai jälkikäteen käynnistyvää leasen vapautusta.
Live-terminal käyttää vain oman nykyisen sulkuajan jäljellä olevan osan,
ei erillistä lisäodotusta. Sulun epävarmuudessa nykyinen backendin
huoltovaltuus invalidioidaan ennen odotusta ja kirjoitusesto säilytetään;
pelkkä mainin lease tai fyysisen varauksen invalidointi ei estä elävän
backendin kirjoituksia.
Cold-valmistelulle ei päätellä omaa sulkuaikaa
sisäisen inspectorin vakioista: ilman olemassa olevaa sulkuomistajaa
keskeneräinen luku jättää varauksen ja huoltovaltaan kuuluvan eston voimaan
sekä palauttaa epävarman sulkutuloksen. Aineisto säilyy; loppuun kuittaamaton
työ ei oikeuta protected-cleanupiin tai seuraavan omistajan käynnistykseen.
Epävarmuus invalidioi myös ulomman startup-/asennusomistajan ennen
virhepalautusta, ei vain lähde- tai ankkurivarausta. Muuten ulompi
virheenkäsittely voisi vapauttaa fyysisen varauksen keskeneräisen luvun alta.
Oman leasen `finally`-vapautus estetään tällöin; lainatun leasen omistaja
saa saman epävarman tuloksen eikä vapauta sitä onnistuneena sulkuna.
Mainin pysyvä recovery-esto tarkistetaan ennen myöhempää omistajuusväitettä,
jotta invalidoinnin seuraus ei peitä ensivirhettä. Myöhäinen valmistuminen
ei poista estoa eikä käynnistä vapautusta tai paluukäynnistystä.

Kaksi muuta rajattua koetta käyttivät nykyistä sidontalukijaa, todellista
synteettisen tiedoston kahvaa ja hallittua sulkuviivettä. Odotuksen
katkeaminen ei päättänyt alkuperäistä lukua, ja suljettu valtuus esti
seuraavan slotin luvun myös myöhäisen sulun jälkeen. Kaikki neljä koetta
läpäisivät. Ne eivät vielä todista mainin kytkentää, leasen tuotannollista
säilytystä, käyttöjärjestelmään juuttuneen luvun keskeytystä tai koko
palautusketjua. Nykyisen `validateOwnedActiveProfile`n
pending-I/O-malli on vertailukohta, ei cold-vaiheen uusi aikabudjetti.

Ensimmäinen toteutuspala on cold-apurien rajattu portti: kutsuja välittää
ennen alkuvalintaa asetetun absoluuttisen määräajan ja epävarman sulun
synkronisen ilmoituksen nykyiselle ulommalle omistajalle. Apuri seuraa
alkuperäisiä tehtäviä sulkuineen ja estää oman leasen vapautuksen, kun
päättymistodiste puuttuu. Myös vielä valmistuva native-varauksen hankinta
kuuluu tähän päättämistodisteeseen; myöhäinen varaus ei saa jäädä ilman
omistajaa. Vanhat kutsujat säilyttävät nykyisen rajapinnan käyttäytymisen.
Pysyvät regressiot todistavat kuluneen alkuvalmisteluajan, kesken luvun
katkeamisen, myöhäisen päättymisen sekä oman ja lainatun leasen säilymisen.
Mainin accepted-, grant- ja rolledBack-cleanup-liitokset todennetaan tämän
jälkeen omissa nykyisissä vaiheomistajissaan. Callbackin jälkeinen
`cleanupWork`-odotus ei saa kiertää vaiheomistajan määräaikaa eikä antaa
siivouslupaa päättymättömälle työlle. Näitä liitoksia ei merkitä valmiiksi
cold-apurien kokeiden perusteella.

**Cold-portin toteutuscheckpoint 28.10.2026:** nykyiset cold-forward- ja
cold-rollback-apurit saavat valinnaisen `operationSelection`-sopimuksen:
absoluuttinen `deadline`, `assertOperationSelection(assertAuthority)` ja
synkroninen `onUnsettledWork(cause)` ulommalle omistajalle. Määräaika ja
callbackit kaapataan ennen ensimmäistä odotusta. Puuttuva portti säilyttää
vanhan kutsujan aikakäyttäytymisen. Uusi portti ei hyväksy vanhentunutta,
ei-äärellistä tai yli nykyisen työbudjetin ulottuvaa määräaikaa.
Valintatarkistus on perusomistajuuden tarkistusten välissä; yleinen
I/O-seuranta ei itse kutsu valintatarkistusta tai sisältövalidointia.
Keskeneräinen työ tai epäonnistunut native-sulku säilyttää huoltovarauksen,
invalidioi omat varaukset ja ilmoittaa ulommalle omistajalle ensisyyn.
Myöhäinen varaus invalidioidaan, mutta sitä tai huoltovarausta ei vapauteta
automaattisesti. Lainatun varauksen vapautusta ei tehdä apurissa.

Yhdeksän tiedoston kohdesarja läpäisi 258 testiä, joista 40 on uusia tämän
portin regressioita; desktopin tyyppitarkistus ja rajattu riippumaton
koodikatselmus läpäisivät. Kohdenäyttö sisältää
todellisen synteettisen tiedoston luvun ja viivästetyn kahvasulun, ei
käyttöjärjestelmään juuttuneen I/O:n peruuttamislupausta. Aiemmat ajot ovat
päällekkäistä välipistenäyttöä. Main ei vielä välitä uutta porttia, joten
ulomman omistajan invalidointi, live-/grant-/cleanup-kytkentä ja koko
palautusketju vaativat edelleen omat alla nimetyt todisteensa.

### Main-valinnan ja vaiheomistajien yhteinen toteutussopimus

Rajaus 29.10.2026 ratkaisee uuden valintakytkennän omistajat ilman uutta
manageria tai aikabudjettia. Nykyinen alkuperäinen journalien `peek`-luokittelu
säilyy. Alla oleva cold-aika alkaa ensimmäisestä **uudesta valintatarkistuksesta**,
ei takautuvasti koko sovelluksen käynnistyksestä. Tavallinen palautus, C ja
sidonnaton yhteensopivuus säilyvät aiemmin nimetyin regressioin.

| Vaihe ja nykyinen omistaja | Työaika ja päättymistodiste |
| --- | --- |
| Mainin cold-alkuvalinta | Aseta hyväksytty absoluuttinen 35 000 ms deadline ennen valmisteluleasen hankintaa ja ensimmäistä valintalukua. Nykyinen main-varaus sekä täsmällinen restore-lease suojaavat readonly-kaappausta. Vapauta valmistelulease vain päättyneen työn jälkeen; välitä sama deadline cold-apurille. Keskeneräiselle luvulle ei lisätä omaa sulkuaikaa. |
| `accepted`-alkuvalinta | Säilytä ensin `prepareBeforeBackend`in korjaamaton journalivalinta. Kaappaa uusi sidonta-/registry-/switch-tilannekuva `bind`in `prepareMainOwned`-callbackissa ennen fyysisen varauksen vapautusta ja lapsen `prepare`-viestiä. `startDesktopBackend`in jo käynnissä oleva 30 000 ms readiness-aika omistaa tämän työn. |
| Backendin grant | Saman käynnistyksen jäljellä oleva readiness-aika; valintatarkistus ennen perusadapterin `assertGrant`ia ja sen jälkeen. Säilytä kertakäyttöinen synkroninen `assertCurrent` juuri ennen työluvan lähetystä. Molemmat alkuperäiset prepare/grant-tehtävät kuuluvat backendin nykyiseen yhteiseen 3 000 ms virhesulkuun. Exit ei yksin salli reclaimia. |
| Live-terminal | Nykyisen `withProfileRestoreTerminalAuthority`n 35 000 ms ja sen oma yhteinen 3 000 ms sulku. Seuraa alkuperäisiä metadata- ja sulkutehtäviä, ei vain aikakatkaistua odotusta. Keskeneräisessä työssä säilytä lease ja varaukset sekä invalidioi backend-fence ennen sulkuodotusta. |
| `rolledBack`-loppusiivous | `validateOwnedActiveProfile`n saman 35 000 ms työn sisäinen jatko; sama tuore validointilease lainataan loppusiivoukselle. Nykyinen yhteinen 6 000 ms sulku palvelee jo aloitettujen tehtävien päättymistä ja fencen sulkua, ei uusia journalipoistoja. Uutta 35 sekunnin terminalia ei aloiteta. |

**Readonly-portti ja työlupa.** Laajenna vain nykyisiä registry-/switch-
`inspectSlots`-lukuja valinnaisella synkronisella vaiheguardilla. Tarkista
vartija ennen ja jälkeen jokaisen slotin odottavan luvun sekä ennen tuloksen
palautusta. Alkuperäinen tehtävä sisältää avoimien kahvojen `finally`-sulut;
guard ei jätä niitä tekemättä. Vanha kutsuja ilman guardia säilyttää
käyttäytymisensä. Mainin valintalukija käyttää näitä samoja readonly-portteja,
ei korjaavaa `read`ia, startup-resolveria tai rinnakkaista slottitoteutusta.
Pelkkä `() => void` -tyyppi ei todista synkronisuutta: guardin paluun pitää
olla ajonaikaisesti `undefined`. Promise tai muu paluu hylätään ennen
seuraavaa lukua tai muutosta; mahdollisen Promisen hylkäys käsitellään ilman
irrallista poikkeusta. Sama sääntö koskee viimeisiä mutaatiovartijoita.

`bind.prepare` pitää fyysisen varauksen callbackin yli ja tarkistaa sen
uudelleen. Sen sisäiseen callbackiin välitetään saman siirtovaiheen
toistettava synkroninen guard: sukupolvi, startup, signal, `preparing` ja
sama hallussa oleva varaus. Yleiset `assertMainOwned`/`assertMainCurrent`
eivät kelpaa aktiivisen siirron aikana. Grantin valintaluku käyttää
startup-/asennus- ja siirtovaltuutta, ei mainin fyysistä omistajuutta tai
sisäkkäistä restore-leasea. Lopullista kertakäyttöistä grant-guardia ei
käytetä toistettavana lukuvartijana.

Prepare- ja grant-callbackit palauttavat **koko alkuperäisen tehtävän**,
myös kahvasulun ja valmisteluleasen päättämisen. Ne eivät palauta vain
keskeytettyä odotus-Promisea. Backendin nykyinen päättymisseuranta kattaa
siten myös wrapperin ennen/jälkeen-luvut. Keskeytys sulkee uudet luvut;
keskeytyneen accepted-kaappauksen leasea ei vapauteta myöhäisen tuloksen
perusteella. Epävarma sulku säilyttää ulomman installation-omistajan.

**RolledBack-jatkon täsmällinen paikka.** Vain uusi W7.4-kutsu antaa
`validateAfterBackend`ille rajatun `withValidatedRolledBackProfile(use)`-
jatkoportin. `use(reportFirstFailure)` vastaanottaa validointiomistajan
synkronisen, ei-heittävän ensivirheen kirjaajan. Portti ei korvaa muiden
kutsujien `validateActiveProfile`-polkua.
Main käyttää nykyistä `validateOwnedActiveProfile`a ja tuoretta
`activeValidationOwner`ia. Sen nykyisen `withProfileSnapshot`-käytön sisälle
lisätään valinnainen jatko: sisältö ja lineage validoidaan, health tarkistetaan,
sitten nykyinen recovery suorittaa oman `finishRolledBackCleanup`insa kerran.
Sama valittu journal, tuore metadata, fence ja snapshot suojaavat siivouksen.
Sisältövalidointia ei ajeta uudelleen, eikä cleanup kutsu ulompaa
`withInspectionOperation`ia tai `withProfileSnapshot`ia sisäkkäin.

Main lainaa jatkon elävän valtuuden nykyiselle
`withRolledBackCleanupAuthority`-portille vain callbackin ajaksi. Ulompi
`use` saa kutsukohtaisen sukupolven, ja sen kertakäyttö kulutetaan ennen
ensimmäistä odotusta. Käyttämättä jäänyt, toistettu tai myöhäinen kutsu
ei tuota `ready`ä. Onnistuminen, virhe ja peruutus sulkevat sukupolven
pysyvästi. Lainattu guard kaappaa juuri tämän valtuuden; se ei lue myöhemmin
vaihtuvaa main-kenttää. Vanhan kutsun `finally` ei tyhjennä uudempaa lainaa.
Koko jatko ja sen `cleanupWork`-join ovat validointiomistajan seuraamaa
alkuperäistä työtä. Aikarajan jälkeen omistaja saa palauttaa epävarman
tuloksen nykyisen sulun puitteissa; ulkopuolelle ei jää uutta rajatonta
joinia. Guard suljetaan synkronisesti ennen odotuksen keskeyttämistä.
Recovery välittää ensimmäisen havaitun virheen `reportFirstFailure`-porttiin
ennen mahdollista joinia. Ensimmäinen ilmoitus sulkee jatkovaltuuden ja
keskeyttää työn odotuksen synkronisesti; alkuperäinen työ säilyy seurannassa.
Myöhempi timeout ei korvaa ensivirhettä. Suljetun kutsun
myöhäinen ilmoitus ei muuta palautettua tulosta tai seuraavan operaation
ensisyytä. Sisältö-/health-hylkäys, cleanup-hylkäys ja sulkuvirhe
säilyvät eri vaiheina; cleanup-virhe ei käynnistä uutta rollbackia.
`ready` vaatii jatkon, snapshot-/fence-sulun ja leasen vapautuksen onnistumisen.

Jatkon validointiapuri on toteutettu valinnaisena porttina: se lainaa samaa
elävää snapshotia ja jäljellä olevaa työaikaa. Keskeneräinen tarkistuspyyntö
estää viimeisen synkronisen muutosluvan; ensimmäinen virhe sulkee jatkon
ennen keskeytystä ja alkuperäinen työ säilyy sulun seurannassa. Myöhäinen
kutsu ei muuta seuraavan operaation tulosta. Viiden tiedoston yhteissarja
läpäisi 200 testiä, desktopin tyypitys ja rajattu katselmus korjausdeltoineen
läpäisivät. Mainin ja recoveryn jatkokytkentä sekä koko palautusketjun näyttö
ovat edelleen kesken; apurin hyväksyntä ei sulje niitä.

Recoveryn valinnainen jatkoportti käyttää nyt samaa validointiomistajaa.
Uudessa polussa puuttuva omistaja tai viimeinen synkroninen muutosvartija
estää korjaavan journal-luvun; vanha kutsutapa säilyy erillisenä. Kertakäyttöisen
jatkon rikkomus pysyy hylkäyksenä myös kutsujan nieltyä virheen. Ensimmäinen
vartijavirhe kirjataan ennen keskeneräisen työn sulkua, eikä myöhäinen työ
voi tyhjentää uuden käynnistyksen journalivalintaa. Kuuden tiedoston
vaikutusalueen sarja läpäisi 544 testiä; sen jälkeen katselmuksen ensisyy-
täsmennykset läpäisivät 129 päällekkäistä kohdetestiä ja tyypityksen.
Riippumaton katselmus ja korjausdelta läpäisivät. Oikeiden validointi- ja
recovery-omistajien yhteinen keskeytyskoe säilytti alkuperäisen syyn ja
varauksen nykyisissä rajoissa. Mainin kytkentä on vasta todennettava ehdokas.

Rollback-ankkurin valmistelu käyttää uudessa valintapolussa täyttä
valintatarkistusta readonly-journal- ja tiedostoluettelotarkistusten
molemmin puolin. Sisäiset luvut ja niiden tarkistukset säilyvät; niiden
sisällä käytetään saman valmistelun elävää omistajuutta. Ankkurin hakemiston
luonti ja oikeusmuutos vaativat lisäksi synkronisen viimeisen vartijan.
Valtuus on ankkuria edeltävä valmisteluvaltuus, ei vielä luomattoman
ankkurin omistajuus. Vanha kutsutapa säilyy muuttumattomana.
Neljästä tiedostosta koostuva vaikutusalueen sarja läpäisi 479 testiä,
desktopin tyypitys ja rajattu katselmus läpäisivät. Mainin oikean
source-null-rollbackin kolme nimettyä tapausta läpäisivät nykyisillä
testirajoilla. Tämä ei sulje aiempia aikakatkaisuhavaintoja eikä hyväksy
koko main-kytkentää tai paketoitua palautusta.

Nykyinen `clearRolledBack` saa erillisen synkronisen viimeisen mutaatioguardin
ennen jokaista uutta `rmdir`-kutsua ja journal-slotin poistoa viimeisen
odotuksen jälkeen. Se ei korvaa nykyisiä async-sisältö-/journal-tarkistuksia
tai kolmannen parametrin rollback-juuren poistotodistetta. Myös
`requireTerminalJournal`in korjaava `journal.read` välittää saman guardin
viimeisille rename- ja sivuslottipoistokohdille; pelkkä `clear`in suojaus
ei riitä. Journalin `clear` välittää guardin varsinaiselle poistokohdalle.
Nykyiset slot- ja sisältötarkistukset säilyvät näiden guardien edellä. Jo aloitettua
I/O:ta ei väitetä peruutetuksi; uutta poistoa ei aloiteta peruutuksen jälkeen.
Vanhojen kutsujien kattavuus ja journalin viimeiseksi jättävä järjestys säilyvät.

**Epävarma lopputulos.** Kaikki vaiheet säilyttävät ensimmäisen syyn ja
erillisen sulkutuloksen. Main lukitsee `restoreRuntimeRecoveryBlocked`in
ennen yleistä recoveryä ja tarkistaa sen ennen mahdollista invalidoinnin
seurauksena epäonnistuvaa `assertMainOwned`-kutsua. Epävarma työ ei vapauta
leasen tai fyysisen varauksen omistajuutta, käynnistä toista yritystä tai
sulje valintatilannekuvaa onnistuneena. Myöhäinen valmistuminen ei poista
estoa. Onnistunut terminal sulkee valintatilannekuvan ennen
`activeWorkspace.accept`-, W6- ja FirstStart-siirtymiä.

Toteutusjärjestys on readonly-guardit ja mainin cold/prepare/grant-liitos,
sitten saman sopimuksen live-/rolledBack-jatkot ja yhteinen main-regressio.
258 testin cold-porttinäyttöä ei toteuteta uudelleen. Nykyisten viiden
omistajatiedoston 223 kontrollitestiä läpäisivät 29.10.2026 ilman
tuotantokoodin muutoksia. Ne todentavat ratkaisun nykyisiä lähtömekanismeja,
eivät vielä uusia jatkoportteja, main-kytkentää tai paketoitua palautusta.
Uusi kohdenäyttö vaatii lisäksi keskeytyksen jokaisen slottiluvun ja
viimeisen mutaatiota edeltävän odotuksen aikana, async-guardin hylkäyksen,
myöhäisen kahvasulun, käyttämättömän/toistetun/vanhan jatkon sekä alkuperäisen
virheen säilymisen myöhemmän timeoutin yli. Vertaa säilyneitä tiedostoja ja
varauksia, ei vain lopullista virhekoodia.
Rajattu riippumaton sopimuskatselmus ja sen delta läpäisivät yllä kuvattujen
korjaavan luvun guardin, ajonaikaisen synkronisuuden, ensivirheportin ja
kertakäyttöisen jatkovaltuuden täsmennysten jälkeen. Toteutuksen katselmus
ja uusi kytkentänäyttö ovat edelleen erilliset portit.

**Readonly-/prepare-porttien toteutuscheckpoint 29.10.2026:** nykyisten
registry- ja switch-tallentimien `inspectSlots(assertAuthority?)` tarkistaa
aidosti synkronisen vartijan jokaisen slottiluvun ympärillä ja ennen tulosta.
Vain `undefined` tarkoittaa pois jätettyä vartijaa; Promise tai muu paluu
ei kelpaa luvaksi. Alkuperäinen luku odottaa myös kahvan sulun, ja menetetty
valtuus estää seuraavan slotin lukemisen. Mainin `bind` välittää nyt
valmistelucallbackille saman `preparing`-vaiheen toistettavan vartijan.
Päättynyt callback tai vanha sukupolvi ei saa sillä jatkolupaa eikä voi
mitätöidä uudempaa omistajaa. Vanhat kutsujat ja aikarajat säilyvät.

Yhdentoista tiedoston kohdesarja läpäisi 422 testiä, joista 41 on tämän
palan uusia regressioita. Desktopin tyypitys ja rajattu riippumaton
koodikatselmus läpäisivät. Kohdenäyttö sisältää oikean synteettisen tiedoston
viivästetyn kahvasulun; se ei lupaa käyttöjärjestelmään juuttuneen I/O:n
peruuttamista. Aiemmat kohdeajot ovat päällekkäistä näyttöä.
Main ei vielä käytä näitä portteja palautuksen valintatilannekuvan
kaappaukseen. Seuraavaksi saman sopimuksen cold-/accepted-/grant-kutsujat
ja niiden main-regressiot, sitten live-/rolledBack-jatkot. Puhtaan paketin
ja koko palautusketjun näyttö jäävät omiksi porteikseen.

**Main-valmistelun seuraava checkpoint 29.10.2026:** nykyinen startup-
sidontalukija yhdistää nyt registry-/switch-valinnan molempiin sidontapaikkoihin.
Odotetut tunnisteet ja valintakonteksti kaapataan ennen ensimmäistä odotusta.
Lukija tarkistaa rekisteröidyn kohteen nykyisen lineagen sekä lukitsee
kaikkien slottien tavut, identiteetit ja puuttumisen.
Yksi readonly-havainto lukee rekisterin ja vaihtojournalin enintään kahtena
rinnakkaisena työnä. Yhteinen vartija tallentaa ensimmäisen hylkäyksen heti,
estää seuraavat luvut ja odottaa molemmat alkuperäiset työt sulkuineen.
Molemmat metadatahavainnot sidontalukujen ympärillä säilyvät; tämä ei ole
välimuisti eikä atomisen tilannekuvan lupaus. Tämän täsmennyksen 88
kohdetestiä ja riippumaton katselmus läpäisivät. Uusi main-koe läpäisi
onnistuneen paluun, mutta sisältövirheen aikakatkaisu säilyi avoimena.
Mainin rajattu valmisteluadapteri käyttää omaa täsmällistä restore-leasea:
cold-kutsuja välittää saman absoluuttisen deadlinen, backend-valmistelu oman
signaalinsa ja saa koko alkuperäisen tehtävän sulkuineen. Keskeneräinen työ
säilyttää leasen ja ilmoittaa ulommalle omistajalle; myöhäinen valmistuminen
ei vapauta sitä. Ensivirhe ja leasen sulkuvirhe erotetaan.

Lukijan ja valmisteluadapterin 65 kohdetestiä sekä desktopin tyyppitarkistus
läpäisivät. Näistä 21 on uusia; aiemmat ajot eivät ole lisäkattavuutta.
Rajattu riippumaton katselmus ja async-vartijan ajonaikaisen tarkistuksen
korjausdelta läpäisivät. Tämä todistaa adapterit, ei mainin koko ketjua.
Mainin cold-/accepted-/grant-ehdokas ei vielä läpäise source-null-paluun
nykyistä yhdistelmätestiä: valintametadatan tarkistus kertautuu sisäisten
omistajuustarkistusten mukana. Jatkoratkaisun rajattu arviointi on tehty:
readonly-lukujen omistajuus erotetaan alla kuvatusti koko valinnan tarkistuksesta.
Aikarajoja ei kasvateta eikä aiempaa hylkäystä merkitä korjatuksi. Live-/rolledBack-
liitosten, main-ketjun ja puhtaan paketin hyväksyntä säilyvät avoimina.

**Readonly-tarkistusten sijoittelu 29.10.2026:** uuden startup-sidontalukijan
registry-/switch-tarkistus ympäröi molempien sidontapaikkojen yhteistä lukua.
Jokainen sisäinen odotus säilyttää synkronisen vaiheguardin. Cold-sisältöportin
sisäiset journal-/luettelo-/lineage-luvut käyttävät saman omistajan rajattua
readonly-vartijaa; koko valinta tarkistetaan sisääntulossa, inspectorin
lähdeluvun ympärillä myös exitin jälkeen ja ennen viimeistä tavujen sekä
tiedostoidentiteettien uudelleensidontaa. Sisältövaatimukset eivät muutu.

Valitsimeen paluun loppusiivouksen sisäiset readonly-kutsut eivät saa
käynnistää toistuvasti koko alkuperäissisällön tarkistusta. Tuore sisältö
vaaditaan silti jokaisen hakemistopoiston ja journal-slotin poiston edellä,
myös rollback-varauksen vapautuksen jälkeen. Viimeinen synkroninen vartija
suojaa varsinaisia poistoja ja journalin korjaavan luvun muutoksia.
Rajattu cleanup-valtuus sulkeutuu saman operaation päättyessä; vanha tai
vajaa valtuus ei anna jatkolupaa. Vanha kutsuja ilman uutta porttia säilyy.

Rollbackin readonly-ennakkotarkistuksessa kokonainen valinta ympäröi
muuttumatonta journal-/tiedostoluettelo-/sisältötarkistusta. Sisäiset
journal-luvut käyttävät fyysisen omistajuuden vartijaa. Ensimmäisessä
checkpointissa journalin jokainen kirjoituscallback säilytti oman täyden
alku-/lopputarkistuksensa. Main-koe osoitti tämän ketjun olevan vielä kesken.
Tämä ei ole muuttuvan metadatan välimuisti tai atomisen tilannekuvan lupaus.
Portti syntyy vain nykyisestä valintaa seuraavasta cold-omistajasta.

**Kirjoitusrajan rajattu jatkosopimus:** vain uuden cold-kutsun
`separateContent`-valtuus saa paritetun readonly-/mutaatiokontekstin.
Journal, valtuuden laji, callbackit ja kontekstin puuttuminen kaapataan ennen
ensimmäistä odotusta. Vajaa konteksti tai käyttö muussa kirjoituslajissa
hylätään ennen tiedostotyötä. Sisäiset luvut säilyttävät fyysisen omistajuuden,
täsmällisen journalivalinnan ja saman palautusluettelon tarkistuksen.
Koko yritysvalinta tarkistetaan ennen jokaista hakemiston luontia, oikeuksien
muutosta, uuden slotin avausta/kirjoitusta, julkaisusiirtoa ja varaslotin poistoa.
Sisältötarkistus säilyy ennen julkaisua ja varaslotin poistoa.

Täyden tarkistuksen jälkeen sidotaan vielä kyseisen vaiheen todelliset slotit:
puuttuva next; avattu tyhjä next samalla kahva-/polkuidentiteetillä; kirjoitettu
next; backupiin siirretty edeltäjä; julkaistu current ja säilynyt edeltäjä.
Lopuksi aidosti synkroninen vartija estää seuraavan muutoksen menetetyllä
valtuudella. Tämä säilyttää nykyisen yhteistyöomistajuuden, ei lupaa atomista
tiedostojärjestelmätilannekuvaa. Julkaisun jälkeinen kuittaus tarkistetaan.
Jo aloitettu kirjoitus, flush ja kahvan sulku seurataan loppuun; peruutus
ei oikeuta jättämään niitä kesken. Muut kutsujat säilyttävät nykyisen polkunsa.
Rajattu toteutus ja sen negatiiviset regressiot on nyt todennettu.
Kuuden tiedoston sarja läpäisi 535 testiä; aiemmat 450 ja 36 testin ajot
ovat päällekkäistä näyttöä. Mukana ovat kaikki kahdeksan mutaatiokohtaa,
slotin vaihto täyden tarkistuksen aikana, avatun kahvan identiteetti,
vajaa/vanhentunut valtuus, sisältöhylkäys, viivästetty sulku ja alkuperäisen
työn säilyminen cold-määräajan yli. Tyypitys sekä rajattu riippumaton
katselmus korjausdeltoineen läpäisivät. Vanhat kirjoittajat eivät saa
ylimääräistä odotuskohtaa ennen mutaatiota; testi todentaa myös tämän.
Main-ketjun onnistunut source-null-paluu läpäisi uuden kohdeajon,
mutta `contentFailure` aikakatkaistiin edelleen ja seuraava tapaus estyi
keskeneräisen työn vuoksi. Vaihekohtainen koe todensi kirjoituskertautumisen
vähenemisen, ei koko viiveen ratkaisua. Mittauskytkentä poistettiin testistä.
Main-ketjun loppuhyväksyntä, live-/rolledBack-jatkot ja paketoitu todennus
ovat yhä avoinna. Aikarajoja ei muutettu eikä muuttumatonta epäonnistunutta
ajoa toisteta vihreyden hakemiseksi.

Yhdeksän tiedoston kohdesarja läpäisi 623 testiä; kolme POSIX-koetta jäi
alustarajauksen vuoksi suorittamatta. Sen jälkeen katselmuksen kaksi
täsmennystä, puuttuvan readonly-portin kaappaaminen ja viimeiseen
journal-lukuun osuva virheinjektio, läpäisivät 15 kohdetestiä. Näitä
päällekkäisiä sarjoja ei lasketa yhteen. Desktopin tyyppitarkistus ja
rajattu riippumaton katselmus korjausdeltoineen läpäisivät.
Viivästetyn lopputarkistuksen alkuperäinen työ säilyttää omistajuuden
aikakatkaisun yli; myöhäinen tulos ei salli muutosta tai peitä ensivirhettä.

Instrumentoimaton main-ketjun onnistunut source-null-paluu läpäisi nykyisen
testirajansa. Saman ryhmän `contentFailure`-tapaus aikakatkaistiin, minkä
jälkeen `releaseFailure` jäi suorittamatta keskeneräisen työn vartijan vuoksi.
Tämä on yksi aikakatkaisu ja yksi jatkoesto, ei kaksi osoitettua sovellusvikaa.
Koko main-kytkentä ei ole hyväksytty. Seuraava työ on jäljellä olevan
tarkistuskertautumisen rajaus ilman aikarajan nostoa tai samoja uusintoja;
sen jälkeen live-/rolledBack-kytkentä ja puhtaan paketin portit.

**Cold-forwardin saman kirjoitusrajan liitos 29.10.2026.** Uuden valitun
palautuksen eteenpäin aktivointi saa saman paritetun journal-kontekstin kuin
kylmä rollback. Sisäiset lukutarkistukset tarkistavat kunkin siirtymän oman
journalirevision ja elävän omistajuuden. Koko valinta, sisältö ja kahdeksan
varsinaista journal-mutaatiota säilyttävät nykyiset tuoreet tarkistuksensa.
Payloadin siirtoja tai sisältösääntöjä ei muuteta. Valinnan puuttuminen,
callbackit ja vastaanottajat lukitaan ennen odotusta; vajaa konteksti ja sen
käyttö rollback-admissionissa hylätään. Viimeinen synkroninen vartija
tarkistaa myös staging-varauksen main-omistajuuden. Sama vartija suojaa
recoveryn ja transaktion korjaavia journal-lukuja. Vanha kutsutapa ei saa
uutta kontekstia. Yhdistetty main-/palautusomistajien 11 tiedoston sarja
läpäisi 1 058 testiä. Katselmuksen viimeinen keskeytysregressio läpäisi
345 testin transaktiosarjan; näyttö on päällekkäistä. Alkuperäisen journal-
kahvan sulun viivästys säilyttää varaukset ja ensivirheen, eikä myöhäinen
valmistuminen tee seuraavaa tiedostomuutosta. Mainin accepted-valmistelun
ja grantin jälkeisen valintaluvun keskeneräinen työ estää uuden omistajan.
Cold-valmistelu välittää saman alkuperäisen määräajan eteenpäin.
RolledBack-kytkentä raportoi ensimmäisen vartijavirheen jo kesken
metadata-I/O:n ja tekee tuoreen sisältötarkistuksen valintalukujen jälkeen.
Tämä korvaa yllä olevat aiemmat main-kytkennän keskeneräisyysväitteet
kohdetodennuksen osalta, ei native-/paketti-/PR-portteja. Aiempi
cold-forward-aikakatkaisu jää omaksi havainnokseen.

**Live-terminalin nykyinen kohdenäyttö 29.10.2026.** Uusi valinnainen
valintaportti käyttää nykyistä 35 sekunnin työtä ja yhteistä 3 sekunnin
sulkua. Se kaappaa callbackit ennen odotuksia, seuraa alkuperäistä työtä ja
sulkee muutosvaltuuden ennen keskeytystä. Valinta tarkistetaan ennen tuoretta
fence-/snapshot-/claim-todistusta. Journalin korjaus, julkaisu, jokainen
payload-poisto ja terminal-clear saavat viimeisen synkronisen vartijan.
Tavalliset ja C:n kutsujat ilman tätä porttia säilyttävät nykyisen polkunsa.

Kesken jäänyt tai toistettu snapshot-callback sekä aloittamatta tai
odottamatta jätetty tarkistus eivät tuota hyväksyntää. Ensivirhe säilyy
ennen sulkuvirheitä. Epävarma työ tai sulku säilyttää leasen ja varaukset;
myöhäinen tulos ei vapauta niitä. Sulkuajan sisällä valmistuva alkuperäinen
varaus voidaan vielä sulkea omalla natiivivaltuudellaan. Pelkkä työodotuksen
peruuntuminen ei mitätöi tätä sulkua. Varmasti päättynyt tavallinen virhepolku
vapauttaa leasen vasta todetun sulun jälkeen, jotta nykyinen pysäytetyn
backendin rollback säilyy mahdollisena.

Jäädytetty neljän tiedoston sarja läpäisi 478 testiä, tyypitys ja rajattu
riippumaton katselmus korjausdeltoineen läpäisivät. Mukana ovat aikarajan
yli jatkuva alkuperäinen työ, myöhäinen varaus, sulun aikana valmistuva
varaus, odottamaton ja päällekkäinen grant, callbackin elinikä, muuttunut
valinta, ensivirhe sekä sulku- ja vapautusvirheet. Mainin 14 kohdekontrollia
läpäisivät ennen viimeistä varauksen sulkutarkennusta. Koko main-ketjun
myöhempi kohdenäyttö on kirjattu yllä cold-forwardin liitokseen; tämä ei
hyväksy pakettia tai muita W7.4 A-F:n liitoksia. Aikarajoja ei muutettu.

**Toteutuksen regressioportti:** olemassa olevat startup-sidonnan,
`resolveActiveWorkspaceStartup`in, cold-forward/rollbackin, terminalin ja
`ProfileRestoreStartupRecovery`n testit laajennetaan, ei korvata. Todista
molemmat yksittäiset omistajat, molempien puuttuminen, ristiriita, väärä
kohde/lineage/operation-ID, migrationin puuttuva/vieras switch-konteksti,
kaikki slotit ja identiteetin muutos; uuden
vaiheomistajan hyväksyntä ja vanhan/menetetyn omistajan hylkäys; tarkistuksen
keskeytys ja myöhäinen valmistuminen ilman muutosta tai jatkokäynnistystä.
Main-ketjun näyttö kattaa sekä palautuksen että kopioaktivoinnin,
`validationStarting`/`accepted`/`rolledBack`-vaiheet, epäonnistuneen
validoinnin kylmän rollbackin, source-null-valitsinpalautuksen ja erikseen
journalittoman, legacy-sidonnattoman sekä ristiriitaisen sidotun
source-nonnull-paluun yllä nimettyine tuloksineen. Varmista myös ordinary
restore, adoption, C-palautus,
registry/W6/FirstStart-järjestys ja ensivirheen säilyminen.

Rajaus on sopimustarkennus, ei valmis tuotantokytkentä. Main-, oikean
prosessin ja puhtaan paketin näyttö sekä korvatun välittömän haaran poisto
ovat edelleen alla olevan portin takana. Uutta riippuvuutta, pysyvää
formaattia, manageria tai rinnakkaista palautuspolkua ei lisätä.

Lähtökartoituksessa `workspaceManagementComposition.ts` antaa aina
`runtimeHandoff`in. Myös koordinaattorin yksikköfixture ja
`apps/e2e/tests/system/workspaceBackupReplacement.spec.ts` muodostavat
koordinaattorin, mutta käyttivät välitöntä polkua. Jälkimmäisen oikean
salatun backupin, SQLiten, historiallisen migraation ja PDF-tavujen näyttö
säilytetään. Sen lifecycle-laskurit eivät yksin todista oikeaa prosessisulkua.

| Vaihe ja omistaja | Valtuus ja päättämisehto |
| --- | --- |
| Korvauskoordinaattori ennen luovutusta | Täsmällinen `replace`-lease, pysähtynyt runtime, mainin fyysinen varaus, sama registry ja julkaistu sidonta. Sisältö- ja journal-suojat säilyvät. Ei live-acceptia tai käynnistystä tässä omistajassa. |
| Nykyinen service ja deferred-relaunch | Pyyntö tehdään vasta viimeisen onnistuneen sidonta-/valtuustarkistuksen jälkeen. Komennon I/O ja finally-release päättyvät ennen completionia. Pysyvä epävarmuus tai ulkoinen shutdown estää myös jonotetun/myöhäisen paluun. Vapautettua replace-leasea ei käytetä completionin lupana. |
| Uuden käynnistyksen nykyinen recovery-omistaja | Hankkii oman tuoreen installation-/restore-valtuutensa ja valitsee täsmällisen journalin, kohteen ja lineagen uudelleen. Vanhaa closurea, leasen kahvaa tai pelkkää paluupyyntöä ei hyväksytä jatkoluvaksi. |
| Backendin jälkeinen hyväksyntä | Nykyinen `withProfileRestoreTerminalAuthority` suojaa elävän backendin kirjoitukset ja todentaa snapshotin, sisällön sekä poistettavien jäännösjuurten varaukset. Se ei väitä aktiivisen backendin olevan poissa eikä käytä vanhan sidontakirjoittajan `assertPublished`-kutsua. |
| Palautetun alkuperäisen yrityksen loppusiivous | `validateRolledBackProfile` säilyttää ensin oikean sisältövalidoinnin. Uuden startup-omistajan rajattu cleanup-valtuus viedään `clearRolledBack(expected, assertRecoveryAuthority)`-porttiin ennen korjaavaa journal-lukua sekä tyhjien hakemistojen ja journalin poistoon. Tämä ei ole accepted-terminal eikä payload-poistolupa. |

Uusi käynnistys lukee mahdollisen sidonnan nykyisen
`WorkspaceRemnantBindingStore.inspect`-portin kautta, ei korjaavana lukuna
eikä uuden sidonnan julkaisuna. Läsnä oleva sidonta sovitetaan täsmälliseen
workspaceen, lineageen, omistajaan ja operation-ID:hen; kaikki slotit sekä
valitun tiedoston tavut ja identiteetti tarkistetaan. Uuden omistajan
vaihekohtainen valtuus tarkistetaan odotusten jälkeen ja nykyisillä
journal-/tiedostomuutosten rajoilla. Cold-vaiheessa vaaditaan poissaolo ja
main-omistus; live-terminalissa sen oma kirjoitussuoja ja tuore sisältö-/
jäännösvaltuus. Näitä ei yhdistetä löyhäksi joko-tai-vartijaksi.
Myös alussa todettu sidonnan puuttuminen lukitaan tämän käynnistyksen
valinnaksi: kesken työn ilmestyvää sidontaa ei omaksuta. Läsnä olevan
sidonnan katoaminen tai vaihtuminen torjutaan ennen seuraavaa muutosta.
Vanha sidonnaton recovery ei saa takautuvasti keksittyä poistovaltuutta;
sen nykyinen palautussopimus säilyy. Pelkkä puuttuva sidonta ei todista,
ettei sellaista olisi ollut aikaisemmassa prosessissa; tätä historiatietoa
ei päätellä muistissa olleesta kuitista tai journalin puuttumisesta.
W7:n jäännöspayloadin poistolupa ja palautuksen hyväksyntä ovat eri asioita.

**`rolledBack`-haaran erillinen liitos:** nykyinen
`ProfileRestoreStartupRecovery.validateStartup` kutsuu tässä haarassa suoraan
`clearRolledBack`ia; `withProfileRestoreTerminalAuthority` ei hyväksy tätä
vaihetta. Sitä ei laajenneta huomaamatta rolledBack-siivoajaksi. Nykyiseen
startup-omistajaan välitetään replacementin rajattu
`withRolledBackCleanupAuthority(journal, use)`-callback, joka hankkii uuden
täsmällisen restore-leasen ja pitää sen koko cleanupin ja aloitettujen
I/O:iden päättymisen ajan. Main kytkee siihen nykyisen startup-/shutdown-
valtuuden, valitun workspace-/lineage-kohteen ja edellä lukitun sidontatilannekuvan
tuoreen tarkistuksen. Vartija ei käytä vanhaa replace-leasea tai väitä
käynnissä olevaa alkuperäistä backendia pysähtyneeksi. Se annetaan nykyisen
transaktion `assertRecoveryAuthority`-parametrille: vain ulompi ennen-/
jälkeen-tarkistus ei riitä. `use` ei saa vaihtaa valittua journalia.
Muut startup-kutsujat säilyttävät nykyisen sopimuksensa; replacementin
main-kytkennässä tämä callback ei ole valinnainen no-op.

Tämä haara poistaa edelleen vain todistetusti tyhjät rollback-hakemistot
ei-rekursiivisesti ja täsmällisen journalin. Epäonnistuneen uuden sisällön
aineisto ja sen sidonta säilyvät, kun payloadia on jäljellä. Menetetty valtuus,
muuttunut sidonta tai myöhäinen hakemistomerkintä estää seuraavan muutoksen
ja `ready`-tuloksen; nykyinen epäonnistumisen backend-sulku ja ensivirheen
säilytys pysyvät. Myös leasen vapautusvirhe säilyy erillisenä epävarmuutena.
Tämä liitos ei korvaa cold-rollbackin pysähtyneen kirjoittajan todistusta.

**Toteutus ja poistamisen näyttöportti:**

1. Ensin testit käyttävät jo nykyistä `runtimeHandoff`-vaihtoehtoa. Onnistunut
   koordinaattori jättää `validationStarting`-journalin ja pysähtyneen
   runtimen; tunnettu activation-virhe jättää todistetun `rolledBack`-tilan.
   Molemmissa korvauslease vapautuu ennen uutta omistajaa. Ennen aktivointia
   syntynyt turvallisesti siivottu virhe palautuu nykyiseen normaaliin
   startupiin. Epävarma sulku tai julkaisu ei saa tätä paluuta.
2. `WORKSPACE-REPLACE-001/002` jatkavat saman testitapauksen sisällä erikseen
   nykyisellä `createWorkspaceBackupReplacementStartupRecovery`-ketjulla
   uuden omistajan alla. Testi ei pääty handoffiin. Nykyinen todellinen
   sisältövalidointi, uusi session, yksi omistaja, journalin/loppusiivouksen
   tulos, preRestore ja muiden tavujen muuttumattomuus säilyvät.
   `WORKSPACE-REPLACE-003` säilyttää väärän salasanan ja muutettujen tavujen
   torjunnan ennen quiescea; paluuta ei pyydetä eikä yritystä avata uudelleen.
3. Koordinaattorin vanha post-start-validointivirheen rollback-näyttö ja
   accepted-siivousvirheen säilytysnäyttö siirtyvät nimettyyn
   coordinator -> uusi startup -ketjutestiin. Ensimmäinen sulkee uuden
   kirjoittajan ennen rollbackia ja todistaa alkuperäiset DB-/PDF-tavut
   sekä seuraavan käynnistyksen terveyden. Jälkimmäinen säilyttää uuden
   sisällön ja accepted-journalin eikä aloita rollbackia. Guardin menetys,
   sivuslotin vaihtuminen, väärä uusi kohde, puuttuva kuittaus ja vanha
   lease torjutaan; alkuperäinen syy ja siivousvirhe säilyvät erillään.
   `rolledBack`-cleanupissa katkot tehdään erikseen tyhjän hakemiston ja
   journal-slottien poiston kohdalla: valtuuden menetys tai sidonnan muutos
   estää seuraavan poiston, säilyttää jäljellä olevat tavut ja estää `ready`n.
4. Oikean main-compositionin nykyiset testit ja nimetyt Electron-/packaged-
   portit todistavat oikean sulun, varauksen siirron ja uuden käynnistyksen.
   System-fixturen laskuria tai ilman todellista terminal-/rollback-valtuutta
   ajettua composition-proofia ei nimetä native-todisteeksi. R0-testimatriisin
   kuvaus päivitetään muuttuneelle ketjulle; tapauksia tai tarkistuksia ei
   pudoteta siksi, että niiden entinen kutsukohta poistuu.
5. Vasta vastaavan kohde-/system-/main-näytön jälkeen `runtimeHandoff`
   tehdään pakolliseksi ja koordinaattorin välitön haara, vain sen tarvitsemat
   readiness-portit sekä compositionin `relaunchOnlyRuntimeReadiness`-stub
   poistetaan samana käyttökelpoisena palana. Muut readiness-, lifecycle-,
   activation-migration- ja startup-kuluttajat säilyvät. Lopuksi molempien
   pakettien tyypitys, vaikutusalueen testit ja riippumaton kytkentäkatselmus;
   koko W7.4 tarvitsee yhä F:n puhtaan paketin ja PR/main-portit.

**Poistamisen checkpoint 29.10.2026:** `runtimeHandoff` on pakollinen;
koordinaattorin välitön käynnistys-/hyväksyntähaara, sen readiness-portit ja
compositionin stub on poistettu. Nykyiset koordinaattori-, sidonta-,
tallennin- ja palautuskokeet läpäisivät 172 testiä. Todellisilla tiedostoilla
ajettu coordinator -> startup -ketju säilyttää alkuperäisen sisällön
rollbackissa, uuden sisällön hyväksynnän jälkeisessä siivousvirheessä ja
ensivirheen erillään epäonnistuneesta sulusta. Journalin kaksi loppupoiston
katkoa tapahtuvat vasta rollback-juuren poiston jälkeen, eivät aikaisemman
korjaavan luvun aikana. Jäljellä olevat slotit säilyvät eikä seuraava poisto
ala menetetyllä valtuudella.

Kolme nykyistä salatun backupin system-tapausta läpäisivät uudella buildilla;
ne jatkavat oikean startup-tehtaan kautta ja käyttävät oikeita SQLite-/PDF-
tavuja. Mainin neljä live-valintakontrollia kattavat onnistumisen, nimen
muutoksen, vääräksi vaihtuneen kohteen ja kesken työn ilmestyvän sivuslotin.
Rajattu poistodeltan katselmus läpäisi. Tämä näyttö ja aiempi main-kytkennän
checkpoint eivät korvaa F:n Electron-/paketti- tai PR/main-portteja.
B:n sidontakirjoittajan koordinaattori-/composition-kytkentä on vielä kesken.
Korvattu polku poistettiin vasta vastaavan näytön jälkeen eikä sitä jätetty
pysyväksi valinnaiseksi turvarajaksi. Epäselvä uusi valtuus pysäyttää
vain vaikutusalueen toteutuksen, ei avaa koko palautusjärjestelmää uudelleen.

##### W7.4:n valtuuden luovutus ja elinikä

Nykyinen W7.3 tarkistaa alkuperäisen registry-valinnan ja työtilajuuren
vielä julkaisucallbackin paluun jälkeen. Myös backup-kuitti tekee oman
päättämistarkistuksensa. Siksi `publish` **ei saa siirtää tai purkaa
yrityskansiota eikä vaihtaa registryä**. Se julkaisee vain pysyvän
aloituksen ja siihen sidotun valmiin inventaarion.

1. Mainin nykyinen käyttötapaus varaa saman installation-delete-leasen
   ennen työtä. W7.3:n vahvistus, todellinen strict-exit, mainin I/O:n
   päättyminen ja prosessivarauksen palautuminen säilyvät.
   Luettelointi ei avaa vikatilaisen yrityksen SQLitea tai pura SMTP-arvoa.
2. Alkuperäisen kohde-/requester-valtuuden alla muodostetaan ja varmennetaan
   täydellinen kohdeluettelo. Luettelo yksin ei anna jatkolupaa.
   Julkaisurajalla verrataan täydellinen luettelo, kutsutaan W7.3:n
   asynkronista `assertPublicationCurrent`-tarkistusta backup-haarassa
   oikeilla container-tavuilla ja tehdään yksi täydellinen luettelon
   loppuvertailu. Tämä loppuvertailu ei käynnistä backup-lukua uudelleen.
   Kevyet omistajuus- ja journal-vartijat tarkistetaan vielä tämän jälkeen
   sekä journalin I/O-rajoilla.
3. `authorized` julkaistaan nykyisen journal-sopimuksen mukaan.
   Valmistelucallback palautuu muuttamatta payloadia tai registryä.
   W7.3:n loppuvalidointi ja kuitin kulutuksen päättäminen odotetaan.
   Niiden hylkäys säilyttää jo mahdollisesti julkaistun journalin ja
   palauttaa epävarman tuloksen; tässä suoritusyrityksessä ei aloiteta purgea.
4. Vasta onnistuneen luovutuksen jälkeen nykyinen management-käyttötapaus
   liittyy journalin omistamaan etenemiseen **ennen oman leasen vapautusta**.
   Se lukee slotit ja inventaarion uudelleen, todistaa pysyvän saman operaation,
   main-varauksen ja kirjoittajien poissaolon. Valmistelun talteen jätetty
   callback tai muistikuitti ei ole poistovaltuus.
5. Pysyvä aloitus erottaa requesterin ja operaation eliniät. Rendererin
   katoaminen ei peru jo kirjattua poistoa. Nykyinen ulkoinen main-sulku
   liittyy aloitettuihin I/O-töihin; menetetty varaus/omistajuus pysäyttää
   seuraavan muutoksen ja jättää journalin jatkettavaksi.
   Oman sulkukutsun itseodotusta ei lisätä.
6. Katkennut julkaisu-/päättämiskuittaus käsitellään cold-polussa samoista
   pysyvistä sloteista kuin oikea prosessikatkos. Silloin ei enää vaadita
   vanhaa rendereriä, salasanaa tai käyttäjän vientitiedostoa eikä julkaisua
   toisteta. Pelkkä alkuvaiheen next ei ole vahvistettu aloitus.
7. Lease vapautuu vasta aloitettujen töiden päätyttyä. Paluukäynnistys käyttää
   nykyistä deferred-relaunch-omistajaa ja W7.3:n release-/ensivirhejärjestystä.
   Epävarma poisto ei pyydä paluuta. Vahvistuksen peruutus ennen julkaisua
   säilyttää W7.3:n käyttäjän erikseen valitseman hallitun paluun.

Luovutus todistetaan ensin pienellä nykyisen valmistelun, todellisen
slot-tallentimen ja management-palvelun yhteiskokeella. Sen hylkäys
pysäyttää kyseisen kytkennän; tarkistuksia ei poisteta valmistelun läpäisyksi.
Tämä on ensimmäinen vastuurajat ylittävä W7.4-katselmuskohta.

**C:n lähteeseen sidottu toteutusraja 30.10.2026:** ennen C:n palvelupalaa
`prepareDeletion` päättyi valmisteluun ja vapautti delete-leasen.
Composition muodosti operationId:n valmistelun sisällä, eikä julkaisijan
callback saanut sitä tai vahvistetun backup-valinnan tulosta.
Niitä ei saa myöhemmin arvata journalista tai korvata uusilla tunnisteilla.
Seuraava toteutuspala erottaa nämä vastuut nykyisten omistajien sisällä:

| Omistaja | Täsmällinen jatkosopimus |
| --- | --- |
| `WorkspaceManagementService` | Luo yhden operationId:n hyväksytyn komennon sisällä. Hanki yksi delete-lease ja kaappaa vartija `captureCurrentOwner(['delete'], lease)`-kutsulla täsmälleen sen kahvaan. Sama `run`/`pendingWork` kattaa valmistelun, journalilta jatkamisen, lopputuloksen ja leasen vapautuksen. Jatkaminen ei hanki uutta leasea. |
| `prepareWorkspaceDeletion` | Säilytä vahvistukset, backup-kuitti ja strict-sulku. Anna julkaisijalle muuttumaton mainin muodostama konteksti: sama operationId, kaapattu kohde ja toteutunut `verifiedBackup` tai `explicitDataLoss`. Pelkkä requestin `createBackup`-arvo ei ole vientitodiste. `prepared` palautuu vasta kaikkien nykyisten päättämistarkistusten jälkeen; se ei ole lopullinen poistotulos. |
| Nykyisen deletion-hakemiston julkaisu | Käytä nykyisiä inventory- ja journal-storeja. Johda ennen-/jälkeen-rekisteri samoista validoiduista sloteista; luetteloi omistajien rajatut juuret ja tarkista niiden täydellisyys ennen `authorized`-julkaisua. Noudata alla hyväksyttyä luettelovertailu -> `assertPublicationCurrent` -> luettelon loppuvertailu -> kevyet vartijat -järjestystä. Ei payloadin siirtoa, poistoa tai rekisterimuutosta callbackissa. |
| Nykyisen palvelun pysyvä jatko | Kutsu etenemisomistajaa vain onnistuneen `prepared`-palautumisen ja viimeisen requester-/lease-tarkistuksen jälkeen. Välitä sama operationId ja uusi operaatioon rajattu main-/lease-valtuus, ei valmistelun callbackia tai backup-kuittia. Jatko lukee journalin kaikki slotit ja siihen sidotun inventaarion itse; se ei hyväksy muistissa olevaa julkaisukuittia poistovaltuudeksi. |
| Active-/selector-main | Pysyvä valtuus vaatii saman main-sukupolven, täsmällisen delete-leasen, todellisen backendin ja mainin kirjoittajien päättymisen sekä fyysisen varauksen. Sitä ei sidota poistettavan yrityksen muuttumattomana pysymiseen oman sallitun siirron jälkeen. Journalin vaihekohtainen tiedosto-/rekisterivalinta kuuluu etenemisomistajalle. |
| Capability ja ulkoinen sulku | Requester vartioi valmistelua ja vastaustoimitusta, ei jo luovutetun operaation pysyvää valtuutta. Dokumentin/ikkunan katoaminen luovutuksen jälkeen ei peru poistoa. Koko mainin sulku estää seuraavan muutoksen, odottaa jo aloitetun työn ja säilyttää keskeneräisen journalin. Oma delete-sulku ei odota omaa palvelukutsuaan. |

Luovutuksella ei ole uutta levytilaa: pysyvä `authorized` ja nykyinen
slottisopimus ovat edelleen cold-jatkon totuus. Live-luovutuksen onnistuminen
on erillinen, vain tämän suorituksen tieto. Jos kuittaus tai W7.3:n loppuluku
epäonnistuu, palvelu ei jatka saman ajon purgeen eikä raportoi peruutusta.
Vahvistettu journal säilyy seuraavan omistajan tarkistettavaksi; initial-next
ei muutu vahvistetuksi. Valmisteluvirhe säilyy ennen mahdollista sulku- tai
vapautusvirhettä. Jo päättyneen operaation vartija ei kelpaa uudelleen,
vaikka uusi lease saisi saman tarkoituksen tai main olisi edelleen elossa.

`closeAdmission` estää uudet pyynnöt. Se ei yksin todista ulkoista sulkua:
nykyinen valmistelu kutsuu sitä myös omassa hallitussa sulussaan. Ulkoinen
shutdown ja fyysisen varauksen menetys välitetään operaation main-vartijaan
erikseen. Aloitettu tiedostotyö odotetaan loppuun myös valtuuden menetettyä;
vapautusta tai paluukäynnistystä ei tehdä keskeneräisen työn rinnalla.

**Aktiivisen yrityksen viimeinen kirjoittaja:** nykyinen main lykkää puhtaan
sammutuksen markerin management-työn jälkeiseen ulkoiseen sulkuun. Marker
voi luoda puuttuvan runtime-hakemiston, joten pelkkä backendin pysähtyminen
ei vielä sulje tätä kirjoittajaa. C:n kytkentä täsmentää nykyistä
`persistCleanShutdown`-omistajaa, ei rakenna uutta kirjoitinta:

- Kun poistokohde on aktiivinen yritys, saman operaation julkaisuvalmistelu
  sulkee sen lykätyn marker-kirjoituksen ennen pysyvän aloituksen yritystä.
  Jo alkanut marker-työ odotetaan päättyneeksi ennen inventaarion viimeistä
  tarkistusta tai tiedostomuutoksia. Epävarma päättyminen estää luovutuksen.
- Varmennettu lopullinen poisto ei kirjoita yritykselle clean-markeria.
  Muiden sulkuehtojen täyttyessä itse sovelluksen sulku voi silti onnistua;
  poistettua yritystä tai sen hakemistoa ei luoda tämän takia uudelleen.
- Katkennut tai epävarma julkaisu/poisto säilyttää marker-eston eikä anna
  puhtaan sammutuksen tulosta. Hakemiston hetkellinen olemassaolo tai
  palvelupyynnön päättyminen ei todista kohteen säilyneen muuttumattomana.
  Myöhäinen callback ei saa poistaa estoa tai kirjoittaa vanhaan juureen.
- Ennen julkaisua varmasti vaikutukseton peruutus säilyttää W7.3:n nykyisen
  marker- ja käyttäjän valitseman paluun säännön. Toisen yrityksen poisto ei
  käytä kohteen poistotulosta avoimen yrityksen markerin ohittamiseen.
  Backendittomalle valitsimelle ei keksitä yritysmarkeria.

Tulos tulee nykyisen pysyvän etenemisomistajan saman operationId:n ja
kaapatun kohteen todennetusta lopputilasta, ei rendererin kuittauksesta tai
yleisestä `completed`-arvosta. Tämä mainin muistissa oleva kirjoitusraja ei
ole uusi journal tai cold-jatkon totuus. Toteutus päivittää samalla desktop-
ja backup-ohjeiden marker-kohdat: tavallisten, update- ja muiden yritysten
sulkujen nykyiset ehdot säilyvät. Tämä on vielä C:n toteutettava sopimus,
ei väite nykyisestä fyysisestä poistosta.

**Lopputiedon ja vastauskuittauksen erottaminen:** C:n main-kytkentä käyttää
alla olevaa sisäistä sopimusta. Uutta levyformaattia, havaintoväylää tai
sammutuksen jälkeistä muutosvaltuutta ei lisätä.

1. Mainin julkaisijasovitus sitoo saman operaation kaapattuun kohteeseen ja
   validoituun journal-sidontaan: nykyinen `target`, rekisterin ennen-/jälkeen-
   tiivisteet ja inventaariositoumus. Työtilajuuren identiteetti vastaa
   vahvistettua kohdetta ja inventaariota. Nimi, rendererin vastaus tai
   myöhempi hakemiston olemassaolo ei korvaa sidontaa. Kytkennän callbackit
   kiinnitetään ennen odotuksia; ulkopuolelta vaihdettavaa jatkajaa ei lueta
   uudelleen valmistelun jälkeen.
2. Vain aktiivisen kohteen julkaisuvalmistelu sulkee mainin nykyisen
   `persistCleanShutdown`-kirjoittajan. Esto asetetaan synkronisesti ennen
   odotusta. Myös jo jonotetun marker-kutsun on tarkistettava esto ennen
   varsinaisen kirjoituksen käynnistämistä. Jo alkanut kirjoitus liittyy
   samaan odotettavaan työhön; sitä ei jätetä taustalle. Odotuksen jälkeen
   vaaditaan tuoreet valmistelu-, valinta- ja varausvartijat ennen julkaisua.
   Epäonnistunut odotus ei avaa kirjoittajaa uudelleen.
3. Pysyvä jatkaja saa saman jatkokutsun muutosvaltuuden rinnalle yhden synkronisen,
   main-only-`recordRemoved`-toimituksen. Se ei ole best effort -observer
   eikä anna oikeutta tiedostotyöhön. Sen suljettu syöte on `removed` ja
   nykyisellä codecilla validoitu saman operaation journal-sidonta
   `registryPublished`-vaiheessa. Vaihe yksin ei ole valmistumistodiste:
   etenemisomistaja kutsuu toimitusta vasta payloadin, sidontojen, inventaarion,
   operaatiokansion ja journal-slotien loppusiivouksen sekä rekisterin
   täsmällisen jälkeen-tilan todentamisen jälkeen. Kaikki aloitettu I/O on
   päättynyt. Tätä toimitusta ei kutsuta valmistelun `publish`-callbackista.
4. Main hyväksyy tiedon kerran, saman elävän jatkokutsun, sukupolven,
   täsmällisen leasen ja kaapatun sidonnan alla. Viimeinen synkroninen
   muutosvaltuuden tarkistus ja tiedon talletus tapahtuvat ilman niiden
   välistä odotusta tai ulkoista callbackia. Väärä kohde, vaihtunut sidonta,
   toisto ja myöhäinen kutsu hylätään. Jos ulkoinen sulku tai varauksen
   menetys ehti ensin, toimitus hylätään: aloitettu työ odotetaan loppuun,
   mutta onnistumista ei päätellä jälkikäteen. Uutta sulun ohittavaa
   luku-/muutosvaltuutta ei luoda tämän vuoksi.
5. Hyväksytty lopputieto säilyy mainin muistissa vastauksen toimituksesta
   riippumatta. Etenemisomistaja ei aloita sen jälkeen uusia tiedostotöitä.
   Myöhempi shutdown, vastauskatko tai palvelun viimeisen vartijan hylkäys
   ei peru todettua poistoa eikä avaa marker-kirjoittajaa. Palvelu ei saa
   palauttaa `completed`-arvoa ilman hyväksyttyä lopputietoa; yleinen
   `resume`-paluu ei korvaa toimitusta. Navigaatio johdetaan varmennetusta
   rekisterisiirtymästä. Release-, paluu- ja vastausvirheet säilyvät erillisinä.
6. Ulkoinen shutdown odottaa edelleen managementin, capabilityn ja kaikki
   omistetut työt sekä leasen päättymisen. Aktiivisen kohteen `removed`
   ohittaa vain poistuneen yrityksen marker-kirjoituksen, ei yhtään muuta
   sulkutarkistusta. Nykyinen management-palvelu säilyttää poiston
   päättämistyön ja leasen vapautuksen virheet erillään pyynnön tai
   vastauksen hylkäyksestä. Sen `shutdown()` odottaa kaikki aloitetut työt
   loppuun ja hylkää sulun säilyneellä virheellä myös silloin, kun virhe
   syntyi ennen shutdown-kutsua. Toistuva shutdown säilyttää saman
   hylkäyksen; pelkkä `trackWork`-työn päättyminen ei ole onnistumistodiste.
   Hyväksytty `removed` ja marker-esto säilyvät virheestä huolimatta;
   vapautusta ei uusita eikä uutta valtuutta hankita. Tavallinen peruutus,
   valtuuden päättyminen tai vastauskatko ei yksin muuta sulkua virheeksi,
   jos päättämistyöt ja vapautus varmasti onnistuivat. Suljettu kirjoittaja
   ilman hyväksyttyä lopputietoa
   säilyttää epävarman sulkutuloksen. Ennen julkaisua peruttu valmistelu,
   toisen yrityksen poisto, ordinary/update-sulku ja backenditon valitsin
   säilyttävät yllä kuvatut omat sääntönsä.

Muistitieto ei selvitä prosessikatkosta: cold-jatko käyttää aina nykyisiä
pysyviä slotteja ja rekisteriä. Erityisesti levyllä valmistunut mutta ennen
toimitusta katkennut viimeinen työ jää tämän ajon kannalta epävarmaksi.
Puuttuvaa journalia ei luoda uudelleen eikä sen puuttuminen yksin todista
onnistumista. Ensivirhe säilyy erillään myöhemmästä sulkutuloksesta.

Toteutus kuuluu nykyiseen management-palveluun, sen compositioniin ja
active-/selector-mainiin. Marker-tiedoston yleistä kirjoitusalgoritmia tai
schedulerin muiden käyttäjien sopimusta ei muuteta. Ensimmäinen rajattu
kytkentä todistaa kirjoittajan eston, tarkan toimituksen ja sulkujärjestyksen
nykyisellä fixturellä. Mallinnetun jatkajan `removed` ei hyväksy D:n
fyysistä poistoa: sama Main-testi vaaditaan oikean etenemisomistajan kanssa
D:n valmistuttua. W7.5-kanavaa ei avata välivaiheessa.

Sisäinen lopullinen komento palauttaa nykyisen poistopyyntösopimuksen tuloksen,
ei `prepared`-arvoa. W7.3:n valmistelu säilyy sen aliohjelmana. Nykyinen
mainin testikäyttöinen pelkkä publisher-kytkentä korvataan vasta yhteistestin
ja saman vahvistus-/peruutus-/backup-kattavuuden jälkeen; puuttuva pysyvä
kuluttaja hylätään ennen vahvistuksia tai sulkua, ei no-op-onnistumisena.
Yhtä pysyvää etenemisomistajaa käytetään live- ja myöhemmin cold-jatkossa.
Uutta manageria, yleistä elinkaarikerrosta tai julkista delete-IPC:tä ei lisätä.

**Ensimmäisen yhteistestin hyväksyntä:** laajenna nykyistä
`workspaceDeletionManagementComposition.test.ts`-fixtuurea käyttäen todellisia
inventory-/journal-tavuja. Fyysinen prosessiomistaja saa tässä pienessä
kokeessa olla nimetty testikaksoinen; se ei korvaa myöhempää native-porttia.
Vaatimukset todistetaan molemmista active-/selector-lähtötiloista:

- Julkaisun jälkeen mutta ennen valmistelun loppuvalidointia jatkokuluttajaa
  ei kutsuta. Registry ja kaikki payload-tavut säilyvät. Vanhaksi jäänyt
  julkaisuvartija hylkää käytön valmistelun palattua.
- Viivästetty loppuvalidointi tai backup-kuitin päättäminen pitää saman leasen
  hallussa. Epäonnistuminen estää live-jatkon ja säilyttää julkaistut tavut;
  erikseen varmennettu cold-valinta erottaa ne initial-nextistä.
- Luovutuksen jälkeen kadonnut requester ei pysäytä operaatiota. Sama main-
  varaus tai lease menetettynä estää seuraavan muutoksen. Vapautettu ja uudelleen
  hankittu saman tarkoituksen lease ei kelpaa vanhalle vartijalle.
- Ulkoinen shutdown odottaa pysyvän jatkon aloitettua I/O:ta ja releaseä;
  oma sulku ei odota itseään. Ensivirhe, shutdownin tulos ja vapautusvirhe
  pysyvät erillisinä, eikä epävarma jatko pyydä paluukäynnistystä.
- Todellisen main-compositionin ja marker-tiedostojen koe poistaa juuri
  aktiivisen yrityksen ja kutsuu ulkoista shutdownia sekä ennen loppukuittausta
  että sen jälkeen. Poistettu juuri ja markerin kaikki slotit pysyvät poissa;
  epävarma lopputila ei kirjoita merkkiä eikä ilmoita puhdasta sulkua.
  Viivästetty jo alkanut marker-työ estää luovutuksen. Peruutuksen, toisen
  yrityksen poiston ja tavallisen sulun kontrollit säilyttävät oman markerinsa.
  Pelkkä no-op-marker tai eri yrityksen kohdefixture ei ole tämä näyttö.
- Lopputoimituksen rajat: sulku ennen toimitusta hylkää sen myös silloin,
  kun viimeinen I/O myöhemmin valmistuu; sulku hyväksytyn toimituksen jälkeen
  mutta ennen palveluvastausta säilyttää poiston tiedon ilman markeria.
  Väärä operaatiotunniste/kohde, vaihtunut lease, reentry, kaksoistoimitus ja
  vasta jatkokutsun päätyttyä saapuva toimitus torjutaan. Pelkkä `completed`
  ilman toimitusta ei läpäise. Hyväksytyn toimituksen jälkeinen release-virhe
  ei peity poistotuloksen alle eikä luo vanhaa yritysjuurta uudelleen.
  Todellinen release-virhe välittyy palvelusta mainin sulkutulokseen sekä
  jo odottavassa että vasta myöhemmin aloitetussa shutdownissa; toistuva
  shutdown ei muuta sitä onnistumiseksi. Suoraan injektoitu shutdown-virhe
  ei korvaa tätä ketjua. Peruutuksen ja valtuuden päättymisen kontrollit
  säilyttävät onnistuneen sulun, kun päättämistyö ja vapautus onnistuvat
  eikä markerin lopputila jää epävarmaksi.
- Peruutus ennen julkaisua ja käyttäjän erikseen valitsema paluu säilyvät.
  Valmistelun tai pysyvän kuluttajan puuttuminen ei avaa poistokanavaa.

**C:n sopimuskatselmus 30.10.2026:** rajattu riippumaton lähdekatselmus
löysi lykätyn marker-kirjoittajan puuttuvan lopputilasäännön. Yllä oleva
täsmentävä sääntö ja oikean Main-/marker-ketjun näyttövaatimus sulkivat
löydöksen sopimustasolla; jälkikatselmus läpäisi. Markerin tuotantototeutus
ja Main-yhteistesti ovat vielä avoimia. Lopputiedon ja vastauskuittauksen
jatkokatselmus täsmensi lisäksi päättämis-/vapautusvirheen säilyttämisen
nykyisessä palvelussa ja välittymisen mainin sulkuun. Sen jälkikatselmus
läpäisi sopimustasolla; uusi toteutus ja runtime-näyttö ovat tekemättä.
Palveluluovutuksen erillinen
toteutusnäyttö on alla; se ei korvaa marker-rajaa.
Tämä ei yksin hyväksy D:n fyysistä poistoa, E:n kylmäkäynnistystä tai F:n
paketti-/integraatioportteja. Sovelluksen ja CI:n aikarajat säilyvät.

**C:n ensimmäinen palvelukytkentä 30.10.2026:** palvelu muodostaa yhden
operationId:n ja kaappaa täsmällisen hankkimansa delete-leasen. Julkaisijan
muuttumaton konteksti välittää saman tunnisteen, kohteen ja toteutuneen
backup-valinnan. Main-only-komento odottaa valmistelun päättämistarkistukset
ennen saman varauksen luovutusta tuoreelle jatkovaltuudelle. Callbackit
kiinnitetään ennen odotuksia, eikä synkroninen reentry saa ohittaa
sulku-/varausvartijaa. Requesterin ja mainin eliniät erotetaan.

Nykyisen management-compositionin yhteistesti julkaisee ja lukee todelliset
journal-/inventaario-tavut molemmista lähtötiloista. Se säilyttää payloadin
ja rekisterin ja päättää jatkon tarkoituksella ennen fyysistä poistoa.
Valmistelun lopun requester-katko säilyttää slotit ilman live-jatkoa.
Callback-/reentry-puutteiden regressiot ja rajattu jälkikatselmus läpäisivät.
Puuttuva kuluttaja estää lopullisen komennon ennen vahvistuksia tai sulkua.
W7.3:n pelkkä valmistelu säilyy, kunnes korvaavalla main-kytkennällä on sama
kattavuus. Tämä ensimmäinen palvelunäyttö ei yksin hyväksy mainin marker-rajaa,
fyysistä poistoa tai W7.5-kanavaa.

**C:n main-/lopputietokytkentä 30.10.2026:** active- ja selector-composition
tarjoavat main-only-`workspaceDeletionCommand`-portin. Sen julkaisija palauttaa
omistamansa valmiin inventaarion ja journalin todistaman työtilajuuren
identiteetin sekä validoidun journal-sidonnan. Main vertaa ne saman
operaation kaapattuun kohteeseen; muistipaluu ei korvaa julkaisijan oikeiden
tavujen, luettelon täydellisyyden tai D:n myöhempää etenemisnäyttöä.
Pysyvä kuluttaja toimittaa `recordRemoved`-tiedon kerran saman elävän
palvelukutsun alla. Sisäkkäinen toimitus torjutaan myös viimeisen
varausvartijan sisältä. Vastauksen hylkäys ei tyhjennä mainin hyväksymää
lopputietoa; sen jälkeen ei aloiteta uusia mutaatioita.

Nykyinen mainin lykätty marker-tehtävä on rajattu pieneen
`workspaceDeletionMarkerBoundary`-funktioon. Se käyttää edelleen samaa
scheduleria ja tiedostokirjoittajaa: jonotettu kirjoitus tarkistaa eston,
aloitettu työ odotetaan loppuun, ja epäonnistunut odotus estää lopputiedon
sekä uuden kirjoituksen. Palvelu säilyttää päättämis-/vapautusvirheen ja
välittää sen myös myöhemmän tai toistuvan sulun tulokseen ilman uutta
vapautusyritystä. Tavallinen pyyntövirhe ilman päättämisvirhettä ei tee
sulusta epäonnistunutta.

Oikean Main-compositionin marker-tiedostokokeissa pysyvä etenijä on
mallinnettu. Ne todistavat toimituksen ja sulun järjestyksen, eivät D:n
fyysistä poistokattavuutta. Erilliset scheduler-/tiedostokokeet todistavat
jonotetun ja alkanutta työtä odottavan marker-rajan. Jälkikatselmuksen ja
lopullisen kohdesarjan ajantasainen tila on M1:n jatkamiskohdassa. Täydellinen
tuotantoinventaarion julkaisija, D:n etenemistoteutus, E:n cold-jatko ja F:n
paketti-/integraatioportit säilyvät avoimina; W7.5-kanavaa ei ole avattu.

**Rekisterisiirtymän toteutusraja 30.10.2026:** nykyisen registry-omistajan
`removeWorkspaceEntry` laskee v2-rekisterin jälkeen-tilan muuttamatta lähdettä.
Poiston valmistelun `captureWorkspaceDeletionRegistryTransition` lukee
todelliset current-tavut ilman slot-korjausta ja sitoo ne vahvistettuun
kohteeseen. Ennen-tiiviste kuvaa alkuperäisiä tavuja, jälkeen-tiiviste
nykyisen serializerin kanonista tulosta. Yhteinen entry-tiiviste säilyttää
aiemman merkityksensä. Oikean journal-/inventaario-yhteistestin laskenta
käyttää tätä samaa siirtymää. Tämä on vasta havainto ja puhdas laskenta:
se ei julkaise rekisteriä, todista payloadin poissaoloa tai anna poistovaltuutta.
Muiden yritysten arvojen ja järjestyksen, aktiivisen/viimeisen kohteen,
vanhojen samannimisten entryjen sekä väärien tavujen/valintojen regressiot
läpäisivät. Täydellinen omistajaluettelointi ja D:n tarkasti valittu
rekisterijulkaisu ovat edelleen avoimia.

##### W7.4:n täydellisen inventaarion omistajuusraja

**31.10.2026: omistaja hyväksyi rajatun formaattitäsmennyksen ja testit;
toteutus ja kohdetodennus ovat käynnissä, koko W7.4 ei ole hyväksytty.** Nykyinen C:n palvelu-/main-
luovutus ja puhdas rekisterisiirtymä säilyvät. Luettelon täydellinen
julkaisija tarvitsee seuraavan rajauksen ennen kytkentää. Muutokset eivät
koske yritystietokannan, portable backupin tai palautuspisteen formaatteja.

**Vahvistettu aukko:** `resolveProfileInspectionCopyRoot` käyttää
`dirname(reservation.userDataRoot)`-parentia. Main antaa varaukseen kutsujan
operaatiojuuren, ei yleisesti installation-juurta. Siksi kopio voi sijaita
rekisteröidyn workspacen sisällä. `workspace`-tietue kattaa sen payloadin,
mutta sen `bindingSha256` on null. Erillinen `inspection`-payload-tietue
rikkoisi fyysisten juurten erillisyyttä; tietueen pois jättäminen ei puolestaan
sido inspection-metadatan hashia nykyisen loppusiivoussopimuksen vaatimalla
tavalla. Kumpaakaan ehtoa ei ohiteta toteutustulkinnalla.

**Todellisten lähteiden suljettu kartta:** polut johdetaan nykyisistä
omistajista, eivät luettelon merkkijonoista. `W` on täsmällinen kohdeworkspace,
`A` nykyinen replacementin activation-juuri.

| Aineisto | Nykyinen omistaja ja tarkka kattavuus |
| --- | --- |
| Rekisteröity yritys | `deriveWorkspaceRoot` ja nykyinen rekisterivalinta. Koko `W` kerran; sisäiset DB/PDF/secret/restore-juuret eivät ole erillisiä payload-kohteita. |
| Legacy-lähde | Adoption sama 13 merkinnän sallintalista ja sen workspace-avaiminen sidonta. Ei koko runtimea tai installation-päivitystilaa. |
| Replacement ja activation-migraatio | Nykyiset import- sekä activation staging/rollback/failed -operaatiojuuret. Jaetun activation-operaation pitää vastata täsmälleen yhtä näistä kahdesta sidontaomistajasta. Nykyinen private `operationPaths` jaetaan oman polkuomistajansa kautta, ei kopioida poistajan algoritmiksi. |
| Import/adoption-candidate | Nykyinen `workspace-operations/<operationId>/<workspaceId>`. Täsmälleen yksi vastaava omistaja; yhteinen operation-parent tai toisen yrityksen candidate ei ole poistokohde. |
| Sidottu snapshot-/cold-inspection | `W/runtime/private-backup-staging`, `W/runtime/failed-profile-restores`, `A/staging` tai `A/failed`; lehti on nykyisen resolverin generationiin sidottu nimi. Ensimmäiset kaksi kuuluvat `workspace`-payloadiin. Jaetuissa activation-parenteissa inspection on operaatiokansion sisarus, ei sen lapsi. |
| Candidate-factoryn tarkistuskopio | Nykyinen `inspection-<requestId>` import-/activation-candidaten sisällä. Eri mekanismi kuin `runOwnedProfileInspection`; se ei julkaise erillistä inspection-sidontaa eikä saa tekaistua generation-roolia. Candidate kattaa sen kerran. |

Adoption kopioimat vanhat staging-/failed-alipuut kuuluvat omistavaan
payloadiin, mutta kopioitu hakemisto ei peri alkuperäisen inspectionin
tiedostoidentiteettiä. Kohteeton käyttäjän backup-inspect ei saa kohdetta
aktiivisen yrityksen perusteella. Installation-scoped plaintext-quarantine,
creation-jäännökset ja yhteiset recovery-/update-journalit käsitellään
nykyisissä admission-omistajissaan; tuntematonta hakemistoa ei luokitella
uuden poistoroolin avulla. Ulkoiset käyttäjän PDF:t ja backupit säilyvät.

**Hyväksytty pieni tarkennus samaan luetteloon:**

- Lisää vain sisäisen, pysyvästi sidotun inspectionin `inspectionEvidence`-
  todisterivi. Se käyttää inspectionin nykyisiä seitsemää kenttää, samaa
  operation/generation-paria, alkuperäisiä juuri-/parent-identiteettejä ja
  kanonista sidontatiivistettä. Se ei ole siirrettävä tai purgettava juuri.
- Todisterivi vaatii saman otsakkeen kohteen täsmälleen yhden `workspace`-
  payload-tietueen. Julkaisussa kopion sekä parentin identiteetit vastaavat
  luontisidontaa ja parent on kohdeworkspacen jompikumpi yllä nimetty sisäinen
  inspection-parent. Pelkkä polkuprefix tai samat tavut eivät riitä.
- Ulkoinen `inspection`-payload ja sisäinen `inspectionEvidence` eivät saa
  esiintyä samalla operation/generation-parilla. Todisteen lisääminen ei
  salli päällekkäisiä fyysisiä payload-juuria. Puuttuva kattava workspace,
  väärä kohde, vaihtunut parent tai useampi identiteettiosuma hylätään.
- Inventory-otsake ja sen sitoumus saavat täsmällisen version 2, jotta uuden
  rivin merkitystä ei piiloteta vanhaan v1-sopimukseen. Journalin nykyiset
  kentät, vaiheet ja slot-säännöt säilyvät. Inventory-tiedoston otsakkeen,
  journalin targetin ja inventory-sitoumuksen on oltava kaikki täsmälleen v2;
  pelkkä keskinäinen yhtäsuuruus ei riitä. V1:n automaattinen jatko tai
  retirement ei kuulu tähän rajaukseen: se vaatisi erillisen omistajapäätöksen.
  Tuntematon tai sekoitettu versio estää jatkon ja säilyttää aineiston.
- Fyysinen poisto käsittelee vain payload-tietueita. Sidontametadatan
  loppusiivous käyttää myös todisterivin hashia vasta nykyisen `purged`-
  säännön, kaikkien payloadien poissaolon ja täsmällisen jälkeen-rekisterin
  alla. Inventaario säilyy loppusiivoukseen asti. Työtilan puuttuminen yksin
  ei anna lupaa omaksua myöhemmin ilmestynyttä metadataa.

**Todisterivin cold-vaiheet:** alkuvalinnassa vaaditaan alkuperäinen kopio
ja parent. Journalin valtuuttaman workspace-siirron jälkeen todisterivi
seuraa vain tämän kattavan juuren todistettua quarantine-siirtoa: sitä ei
siirretä erikseen eikä alkuperäisen polun puuttumista tulkita ristiriidaksi
ilman vaihetarkistusta. Ennen purge-valtuutta säilyneen kopion ja parentin
identiteetit tarkistetaan kattavan juuren todistetussa sijainnissa.
`purgeAuthorized`-vaiheen sallimassa osittaisessa poistossa ei vaadita jo
poistettua alipuuta uudelleen eikä keksitä uutta luontikuittia. Lopullinen
metadata-cleanup käyttää muuttumattoman inventaarion todistetta, täsmällistä
sidontahashia ja kaikkien valtuutettujen payloadien poissaoloa. Nykyisen
keskeytystaulukon fyysiset siirto-/purge-/poissaolosäännöt koskevat tässä
v2-sopimuksessa payload-rooleja, eivät itsenäistä todisterivin tiedostopoistoa.

Tämä on yksi inventaarion tarkennus, ei toinen tiedostoindeksi, uusi
recovery-järjestelmä tai metadata-cleanupin poikkeus. Nykyiset 2 048 tavun
rivi-, 4 096 tavun lukupala- ja 16 KiB:n journal-rajat sekä aikarajat säilyvät.
Tuotantokytkentä odottaa seuraavien regressioiden ja vaikutusalueen porttien näyttöä.

**Täydellisyyden toteutustapa nykyisillä omistajilla:**

1. Saman elävän delete-leasen ja todetun kirjoittajien sulun alla tarkistetaan
   sekä kaikki viisi sidontahakemistoa kaikkine slotteineen että niiden
   omistajien nimeämät todelliset payload-parentit. Sidontaluettelo yksin
   ei löydä indeksoimatonta jäännöstä. Payload-luettelo yksin ei todista kohdetta.
2. Jokainen havainto on todistetusti kohteen, todistetusti vieras, todistetusti
   poissa tai epäselvä. Vieraan yrityksen tavut ja metadata säilyvät.
   Ristiriita, puuttuva sidonta tai tuntematon omistaja estää julkaisun;
   niitä ei lasketa tyhjäksi tulokseksi. Tunnettu tyhjä yhteisparent ei
   muutu poistettavaksi yritysjuureksi.
3. Inspectionin olemassa oleva juuri valitaan vain yllä olevista neljästä
   parentista luontisidonnan ja tuoreiden identiteettien täsmällisellä
   vertailulla. Kadonnut tai korvattu parent ei muutu varmaksi alkuperäksi
   nimeä päättelemällä. Inspectionin cold metadata-only-ennakkosiivous tarvitsee
   nykyiseen omistajaan rajatun uuden poissaolotodistuksen: täsmällisen
   generation-lehden on oltava poissa kaikista neljästä sallitusta sijainnista,
   nykyiset säilyneet ancestorit ja puuttuvat välit varmennetaan sekä kaikki
   binding-slotit tarkistetaan samaan kohteeseen. Lukukelvoton, ristiriitainen
   tai vaihtuva tila estää siivouksen. Rajattu cold-portti on toteutettu alla
   kuvatulla kohderajalla; nykyinen tavallinen omistaja käyttää edelleen
   muistissa olevaa poistokuittausta. Cold-portti ei anna payload-poistolupaa
   tai ohita kirjoittajien sulkua. C:n todellinen kutsujakytkentä on vielä auki.
4. Payloaditon metadata siivotaan nykyisen omistajan kautta ennen lopullista
   luettelointia. Payloadia ei poisteta tässä valmistelussa. Jokainen tämän
   siivouksen oma kuitti erotetaan ulkoisesta muutoksesta; epävarma kuittaus
   estää jatkon. Poistettavaan luetteloon ei lisätä tekaistua puuttuvaa juurta.
5. Luettelon järjestys tuotetaan rajatulla avainsivulla ja hakemistokahvan
   peräkkäisellä luvulla, ei koko historian `readdir`-/Set-taulukolla. Sivu
   valitsee pienimmät cursorin jälkeiset avaimet; seuraava sivu lukee saman
   sallitun lähteen uudelleen. Sivukoko on muistibudjetti, ei aineistomäärän
   hyväksymisraja. Ei uutta pysyvää lajitteluindeksiä tai väliaikaistietokantaa.
   Toistuvan luvun kustannus ja hallittu keskeytys todennetaan ennen kytkentää;
   nopeutta tai rajattoman aineiston valmistumista ei luvata ilman mittausta.
6. Lopuksi tuore kanoninen metadata-/payload-luettelo verrataan rivi riviltä
   koko takaisinluettuun inventory-tiedostoon EOF:ään asti. Puuttuva tai
   ylimääräinen payload/todiste, muuttunut identiteetti tai binding-hash
   estää julkaisun. Lähdevalinnan tarkistus kattaa myös cursorin taakse
   ilmestyneet nimet, sivuslotit, parent-identiteetit, vieraat merkinnät ja
   todistetut poissaolot. Pelkkä tietuemäärä, hakemiston mtime tai valmiin
   tiedoston hash ei todista tätä. Muuttunut valinta estää `authorized`-
   julkaisun ilman automaattista uudelleenvalintaa. W7.3:n päättämistarkistukset
   ja D:n tuore kohdevaltuus säilyvät; publication ei tee siirtoa tai purgea.

Streamin edellisen avaimen tarkistus ei yksin löydä inspectionin kahden
roolin ristiriitaa. V2:n semanttinen tarkistus vertaa `inspection`- ja
`inspectionEvidence`-alivirrat operation/generation-järjestyksessä rajatuilla
kahdella läpikäynnillä ja kahdella nykyisellä rivillä, ei kasvavalla joukolla.
Samalla vaaditaan todisterivien kattava workspace-tietue. Nykyinen rajattu
lukija saa tähän nimettyjen tietueiden luentaportin; mitään vaikutusta ei
sallita ennen koko sitoumuksen, EOF:n ja ristikkäisehtojen tarkistusta.
Näiden läpikäyntien tiedostoidentiteetti ja valtuus pysyvät samoina.

Alkuperäistä I/O:ta seurataan ja kaikki avatut kahvat suljetaan myös
peruutuksessa. Odotusrajan täyttyminen ei tarkoita luvun päättyneen eikä
vapauta varausta. Ensivirhe ja sulkuvirhe pysyvät erillään. Lähteen luku,
valinta ja payload-toimenpiteet käyttävät samoja nykyisiä omistajia; main
ei avaa yritystietokantaa tätä varten.

**Ennen kytkentää todennettavat tapaukset:** sisäinen inspection-todiste ja
ulkoinen inspection-juuri; candidate-factoryn erillinen mekanismi; kaksi
yritystä samoissa jaetuissa parenteissa; replacement/migration- sekä
import/adoption-kaksoissidonta; next-/backup-only ja payload ilman sidontaa;
kopioitu legacy-alipuu; muuttunut parent/juuri; puuttuva kattava tietue ja
inspectionin kaksoisrooli; uusi nimi aiemman cursorin takana; useampi kuin
yksi avainsivu; keskeytynyt luku/sulku sekä kadonnut valtuus. Oikeilla
tiedostotavuilla verrataan myös kaikkia säilyviä yritys- ja installation-
aineistoja. Journalin eri katkokohdat, vain todisterivin sallima metadata-
cleanup ja sen cold-jatko todennetaan ennen D/E-liitosta. Suunnitelmakatselmus
ei ole näiden testien läpäisy eikä koko W7.4:n hyväksyntä.

**Rajattu sopimuskatselmus 31.10.2026:** neljä täsmennystä kirjattiin ennen
päätöstä: cold-vaiheiden ero, inspectionin uusi metadata-only-poissaolotodiste,
todellisen inventaarion rivivertailu/ristikkäistarkistus ja v1-jatkon sulku.
Jälkikatselmuksessa ei jäänyt estävää sopimusristiriitaa. Tämä katselmus ei
muuttanut sovelluskoodia. Omistaja hyväksyi sen jälkeen rajatun täsmennyksen
ja testit; toteutuksen näyttö kirjataan erikseen M1:n jatkamiskohtaan.

**V2-tavurajan kohdetoteutus 31.10.2026:** nykyinen inventory-codec,
stream-lukija ja tiedostotallennin käyttävät v2-otsaketta/sitoumusta.
Journalin ulkoinen v1, vaiheet ja sidontatiedostojen v1 säilyvät.
`inspectionEvidence` vaatii kattavan workspace-tietueen ja kahden roolin
operation/generation-ristiriita tarkistetaan rajatulla luennalla samasta
avatusta tiedostosta. Molemmat alivirrat luetaan EOF:ään ja tarkistetaan
samaan sitoumukseen, myös viimeisen todisterivin jälkeinen häntä.
`captureDeletionInventoryPayloadRecord` hylkää todisterivin fyysisenä
kohteena. `readDeletionInventoryRecords` välittää vain havaintoja;
lopullinen sitoumus saadaan vasta EOF:n jälkeen. Tavujen tarkistus ei
todista alkuperäistä juuriomistajuutta tai anna poistovaltuutta.

Tämä tavupala ei yksin todista cold-poissaolokytkentää,
todisterivin fyysistä kohdesidontaa, täydellistä omistajacensusta tai D/E:n
tiedostopoistoa/keskeytysjatkoa. Nykyiset turvalliset virheluokat säilyvät;
ei uutta tapahtumaa, renderer-pintaa tai kerättävän aineiston lajia.
Oikean poistokuluttajan diagnostiikka-/salatun virhepaketin ja paketoidun
ketjun näyttö säilyy F:n porttina. Ajantasaiset kohdetulokset ja katselmuksen
tila löytyvät [M1:n jatkamiskohdasta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

**Inspectionin metadata-only-omistajaportti 31.10.2026:**
`workspaceInspectionRemnantPaths` johtaa samat neljä sijaintia nykyisistä
workspace-/snapshot-/replacement-omistajista ja runnerin yhteisestä
generation-nimestä. `captureWorkspaceInspectionRemnantAbsence` sitoo
säilyneet ancestor-identiteetit sekä puuttuvat välit ja tarkistaa ne myös
jokaisen leaf-poissaolo-odotuksen jälkeen. Virhe mitätöi tämän havaitun
valinnan pysyvästi; vanhan polun palauttaminen ei uudista sitä.
`clearAbsentWorkspaceInspectionBinding` vaatii erikseen kirjoittajien
todetun päättymisen, täsmällisen kohteen/lineagen ja kaikkien havaittujen
binding-slottien tavut/identiteetit. Se käyttää nykyistä `owner`-siivousta,
ei poiston `purged`-poikkeusta, ja säilyttää oman vartijansa ensisyyn ennen
alemman tiedostokerroksen yleistä virhekoodia. Payloadia tai jaettuja
parentteja ei poisteta, kopioida tai siirretä. Tavallinen elävän inspectionin
luontikuittiin perustuva cleanup ei muutu. Tämä portti on vielä C:n
koostumuskytkennän ulkopuolella; mallinnettu sulkuvartija tai uusi lukijaolio
ei todista pääprosessin todellista sulkua tai prosessin uudelleenkäynnistystä.

**Olemassa olevan inspectionin valintaportti 31.10.2026:**
`captureWorkspaceInspectionRemnantSelection` sitoo julkaistun sidonnan
kaikkien slottien alkuperäiset tavut ja identiteetit sekä yhden täsmällisen
luontisidotun kopion neljästä sallitusta sijainnista. Sisäinen kopio vaatii
nykyisen workspace-payload-tietueen todelliset juuri- ja parent-identiteetit;
se tuottaa vain `inspectionEvidence`-rivin. Ulkoinen kopio tuottaa
`inspection`-rivin. Useampi saman generationin juuri, vaihtunut identiteetti,
vieras kohde tai epävarma kirjoittajien sulku estää valinnan. Poissaolo ja
olemassa olevan juuren valinta käyttävät samaa rajattua ancestor-havaintoa;
normaalin inspectionin luonti tai cleanup ei muutu. Uusi kuitti on havainto,
ei siirto-, purge- tai metadatapoistolupa.

`observeWorkspaceDeletionDirectoryEntries` tuottaa järjestetyt raakanimet
64 nimen muistibudjetilla ja peräkkäisellä hakemistoluennalla. Jokainen sivu
lukee lähteen uudelleen, eikä sivukoko ole jäännösten kokonaismääräraja.
Avattu kahva suljetaan ja aloitettu luku odotetaan myös valtuuden
menetyksessä; luku- ja sulkuvirhe erotetaan. Tämä nimilukija ei luokittele
omistajaa eikä todista luettelon täydellisyyttä. Cursorin taakse lisätty
nimi havaitaan vasta uudessa kokonaisluetteloinnissa. Edellä vaadittu tuoreen
metadata-/payload-luettelon ja inventoryn EOF-vertailu sekä C:n todellinen
kutsujakytkentä ovat edelleen avoimia portteja ennen julkaisua.

**Sidontapuolen alustava luettelointi 31.10.2026:**
`observeWorkspaceRemnantBindings` käyttää nykyistä strict-tallenninta
kaikille viidelle omistajalle. Se tuottaa currentin ja samansisältöisten
sivuslottien havainnon kerran, säilyttää alkuperäiset tavut/identiteetit
kuluttajan muuttuvista tavukopioista erillään ja hylkää tuntemattoman nimen,
next-/backup-onlyn tai muuttuneen valinnan. Omistavien polkujen parseri
käyttää nykyisiä tunnistevalidaattoreita; levyformaatti ei muutu.
Yksittäisen sidonnan lukija säilyttää vanhan hakemistoportin rajapinnan;
uusi luetteloija sitoo myös kaikki säilyneet ja puuttuvat ancestorit.
Lukija ei suodata vieraita yrityksiä, korjaa metadataa, avaa tietokantaa
tai anna payload-poistolupaa. Pelkkä metadata-EOF ei todista täydellisyyttä.

**Peräkkäisten tarkistusten yhdistäminen:** onnistunut täysi post-open- tai
post-read-tarkistus toimii myös seuraavan luvun ennakkotarkistuksena vain,
kun välissä tehdään rajattua synkronista nimen käsittelyä. Välissä ei saa
olla odotusta, muuta tiedosto-operaatiota tai kuluttajalle luovutusta.
Elävä valtuus tarkistetaan lisäksi synkronisesti välittömästi ennen lukua.
Täysi tarkistus säilyy ennen avausta, jokaisen avauksen ja luvun jälkeen
(myös null/EOF), sulkemisen jälkeen ja ennen jokaisen nimen luovutusta.
Ancestor-sidonta, strict-tallentimen kaikki slotit sekä sidonnan vertailu
ennen ja jälkeen kuluttajan säilyvät. Tämä ei lupaa atomista hakemistotilaa
tai kaikkien ohimenevien muutosten jatkuvaa havainnointia. Tarkistusta ei
siirretä sivun loppuun eikä valtuutta muisteta tiedostotyön yli.

Suurempi luettelointikoe aikakatkaisi viiden sekunnin testirajaan myös
rajatun korjauksen jälkeen. Omistajan hyväksymä
[nimetyn yhdistelmätestin kymmenen sekunnin budjetti](../ai/testing-rules.md)
ei muuta sovelluksen tai muiden testien aikarajoja. Ensihylkäykset säilyvät;
budjettimuutos ei yksin todista viiveen juurisyytä korjatuksi. Testin oma
keskeytys välittyy nykyiseen valtuusvartijaan, alkuperäinen lukutyö odotetaan
loppuun ja varmentamaton aineisto säilyy. Havaintorajan regressiot ja
todellinen monisivuinen sidontaluenta on erotettu rakenteellisesta
kutsumääräkokeesta. Ajantasainen kohdenäyttö on
[M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Täydellinen metadata-/payload-census ja C:n tuotantokytkentä ovat vielä auki.

**Replacementin ja activation-migraation juurivalinta:** nykyinen
palautustransaktio ja luetteloinnin lukija johtavat operaation staging-,
rollback- ja failed-polut samasta palautuksen polkuomistajasta. Layout,
operaatiotunnisteen tarkistus ja tavallinen palautus säilyvät.
`captureWorkspaceReplacementRemnantSelection` lukee molemmat mahdolliset
sidontaomistajat kaikkine slotteineen. Täsmälleen yksi julkaistu omistaja
vaaditaan; puuttuva tai kaksinkertainen sidonta ei anna juurivalintaa.
Migration-sidonta ei omista backup-import-kansiota samalla tunnisteella.
Lukija sitoo neljän nimetyn juuren olemassaolon tai poissaolon ja säilyneet
ancestorit, säilyttää vieraan yrityksen kohdetiedon sekä tarkistaa aiemmat
juuret uudelleen metadatan vertailun jälkeen ja sidonnan vielä tämän
juuriluennan jälkeen. Valtuus ja kirjoittajien
päättyminen tarkistetaan ennen tulosta. Virhe mitätöi havaitun valinnan.
Peräkkäiset havainnot eivät ole atominen tiedostojärjestelmän snapshot.
Tämä on yhden operaation readonly-havainto: kaikkien parenttien luettelointi,
indeksoimattomien juurten hylkäys, tuore EOF-vertailu ja C:n julkaisija ovat
erillisiä vielä avoimia portteja. Kuitti ei valtuuta payloadin eikä metadatan
poistoa. Kohdetodennuksen ja katselmuksen ajantasainen tila on M1:ssä.

**Import-/adoption-candidaten valinta ja operaatiokansion luenta:**
`captureWorkspaceCandidateRemnantSelection` johtaa täsmällisen yrityskansion
nykyisistä omistajista ja vaatii yhden vastaavan julkaistun sidonnan.
Workspace-avaiminen adoption-sidonta toiselle operaatiolle ei omista tätä
candidatea; saman operaation ristiriitainen import-kohde estää valinnan.
Kaikki sidontaslotit, ancestorit ja juuren olemassaolo tai poissaolo sidotaan
havaintoon. `observeWorkspaceCandidateRemnants` lukee yhden nimetyn
operaation todelliset yrityskansiot nykyisellä rajatulla nimilukijalla.
Tuntematon nimi, puuttuva sidonta tai luennan aikana kadonnut juuri estää
jatkon; vieras todistettu candidate säilyy luettelossa. Jaettua
operation-parentia ei valita payloadiksi. Tuonnin normaali polunmuodostus
käyttää samaa operaatiopolkuapuria entisillä kohteilla ja validoinnilla.
`observeWorkspaceCandidateOperations` lukee myös yhteisen operations-parentin
ja jokaisen sen operaation, ei vain metadatasta löytyviä kansioita. Se säilyttää
tyhjien parenttien, vieraan yrityksen ja puuttuvan yhteisparentin havainnot.
Installation-scoped plaintext-quarantine tunnistetaan nykyisen omistajan
nimestä ja hyväksytään vain tyhjänä; sen aineisto kuuluu edelleen nykyiselle
admission-omistajalle. Jaettua kansiota ei poisteta. Yhden operaation ja sen
candidaten luenta käyttävät samaa ancestor-valintaa: yhteisparentin
identiteettiä ei valita uudelleen eikä ulompaa koko tarkistusta pinota
rekursiivisesti sisemmän vartijan sisään. Valtuus, kirjoittajien päättyminen,
todelliset identiteetit ja aloitettujen lukujen loppuun odottaminen säilyvät.
Nämä readonly-havainnot eivät vielä korvaa kaikkien palautusparenttien ja
metadatan yhteisluettelointia, tuoretta EOF-vertailua tai C:n julkaisijaa.

**Jaettujen palautusparenttien luenta:**
`observeWorkspaceReplacementRemnants` lukee nykyisen polkuomistajan neljä
yhteistä import-/activation-parentia ilman tekaistua yritystunnistetta.
Alkuperäiset ancestor-identiteetit ja poissaolot sidotaan ennen luentaa ja
tarkistetaan myös koko kierroksen lopussa. Operaatiokansio yhdistetään
nykyiseen replacement-/migration-valintaan. Staging-/failed-parentin
inspection-sisarus tunnistetaan nykyisen runnerin generation-nimestä ja
sen sidonta haetaan kaikkien inspection-slottien rajatulla luennalla;
ensimmäistä osumaa ei hyväksytä, jos toisella operaatiolla on sama generation.
Raaka inspection-havainto käyttää samaa juuri-/slot-valintaa kuin kohteen
tietueen muodostaja, mutta ei anna inventory-tietuetta tai poistovaltuutta.
Kohdetietueen muodostaja vaatii edelleen oikean yrityksen, lineagen ja
sisäiselle kopiolle kattavan workspace-tietueen. Vieraat juuret säilyvät
luettelossa; puuttuva sidonta, tuntematon nimi, väärä parent tai muuttunut
identiteetti estää valmistelun. Alkuperäiset luvut ja sulut odotetaan loppuun.
Normaalin palautuksen polut, runnerin nimet ja aikarajat säilyvät.
Tämä kattaa jaetut payload-parentit, ei vielä koko metadata-/payload-luettelon
tuoretta EOF-vertailua tai C:n julkaisua.

**Vanhan runtime-lähteen luenta:** `captureWorkspaceLegacyRemnantSelection`
käyttää adoption samaa polkuomistajaa ja 13 merkinnän sallintalistaa. Se ei
avaa tietokantaa eikä edellytä ehjää business-sisältöä. Installation-parentia
tai listan ulkopuolisia tiedostoja ei valita payloadiksi. Sallittu yksittäinen
tiedosto säilyttää adoption nykyisen käyttöoikeusmallin; linkit, hardlinkit ja
erikoistiedostot hylätään, ja yrityssisällön kansioilta vaaditaan edelleen
yksityinen hakemisto. Inventaarion oman metadata-tiedoston tiukkaa
käyttöoikeustarkistusta ei lievennetä.

Lähteellä voi olla vain yksi julkaistu adoption-omistaja, kun jokin sallittu
merkintä on olemassa. Luenta käy kaikki workspace-avaimiset sidonnat läpi;
kahta yritystä ei ratkaista valitsemalla ensimmäinen. Vieras todistettu omistaja
säilyy havainnossa, kunnes kohteen muodostaja vertaa sitä tarkkaan poiston
kohteeseen. Kaikkien sallittujen merkintöjen poissaolo ei valitse metadataa
siivottavaksi: adoption candidate ja täydellinen metadata-luenta tarkistetaan
erikseen. Havainnon juuri-, parent- ja slottivalinta tarkistetaan uudelleen,
muutos mitätöi alkuperäisen valinnan ja aloitettu luku odotetaan loppuun
valtuuden menetyksessäkin. Tämä readonly-luenta ei julkaise inventaariota,
muuta normaalia adoptiota tai anna siirto-, purge- tai metadatapoistolupaa.
Kohdetodennus ei korvaa C:n täydellistä luettelovertailua tai F:n pakettinäyttöä.

**Omistajien yhteinen readonly-luenta:** `observeWorkspaceDeletionRemnants`
yhdistää viisi metadataomistajaa niiden nykyisiin juuri-/candidate-/inspection-
valintoihin sekä todellisten jaettujen payload-parenttien luentaan. Myös
tyhjä tai puuttuva metadataparent ja payloaditon sidonta jäävät havaintoon.
Vieraita yrityksiä ei suodateta pois. Sisäisenkin inspectionin generation
vaatii yksiselitteisen operaatiomerkinnän; jaetun parentin puuttuminen ei
korvaa tätä tarkistusta. Alkuperäiset viisi metadataparenttia tarkistetaan
vielä koko luennan lopussa. Payloadittoman sidonnan havainto ei itsessään
anna metadata-cleanup-valtuutta.

`captureWorkspaceDeletionRemnantCensus` vertaa nimetyn valmistelu-/julkaisurajan
kohdalla tuoretta täydellistä jäännösluentaa alkuperäiseen kanoniseen
lähdehavaintoon. Vertailu sisältää raw-slottien tavut ja identiteetit,
vieraat kohteet, parentit ja poissaolot, ei vain luettelon määrää tai mtimea.
Tämä yksityinen muistissa pidettävä vertailu ei ole uusi pysyvä indeksi,
atominen tiedostojärjestelmän snapshot tai tiedostopoistolupa. Kokonaista
luentaa ei sijoiteta yksittäisen I/O:n vartijaan. Kohteen/rekisterin valinta,
todellisten inventory-rivien tuore EOF-vertailu ja C:n julkaisijakytkentä
ovat edelleen erillisiä pakollisia portteja. Virhe mitätöi vertailukuitin;
myöhemmin palautettu vanha sisältö ei uudista sitä.

**Inventaarion todellisten rivien vertailu:** nykyisen
`WorkspaceDeletionInventoryStore.assertRecords`-portin yksi avoin tiedosto
säilyttää samat juuri-, parent-, tiedostoidentiteetti- ja valtuusvartijat
kuin tavallinen takaisinluku. Ensin tarkistetaan koko sitoumus ja
inspection-roolien ristikkäisehdot. Sen jälkeen samasta avatusta tiedostosta
luetut kanoniset rivit verrataan odotettuun lähteeseen yksi kerrallaan.
Molempien on päädyttävä EOF:ään; myös vertailuluennan sitoumus sekä
tiedoston tila ennen ja jälkeen sulun tarkistetaan. Puuttuva, ylimääräinen
tai muuttunut rivi hylätään ilman korjaavaa kirjoitusta. Alkanut luku ja
molempien lukijoiden sulku odotetaan loppuun; parseri-, lähde- ja
sulkuvirheet säilyvät erillisinä alkuperäisessä järjestyksessä.
Tämä portti ei itse valitse yritystä, siivoa metadataa tai anna
poistovaltuutta. C:n kutsujan on edelleen tuotettava tuore omistajakohtainen
lähde ja varmennettava koko lähdevalinta erikseen. Täydellistä census-luentaa
ei kutsuta jokaisen rivin tai tiedostoluvun vartijasta.

**Kohteen rivien muodostaminen ja kertautuvan työn rajaus:**
`captureWorkspaceDeletionInventorySources` sitoo oikean workspace-juuren
ja sen parentin, muodostaa kohteen rivit nykyisten omistajien havainnoista
ja säilyttää vieraat, puuttuvat sekä payloadittomat lähteet täydellisessä
vertailussa. Kohteen payloaditon metadata hylätään ennen kuin sen oma
ennakkosiivous on todennettu. Sisäinen inspection muodostaa vain nykyisen
workspace-rivin kattaman todisterivin, ei toista fyysistä poistolupaa.

Ensimmäinen 64 avaimen sivu muodostetaan samassa täydellisessä
alkuluennassa kuin lähdesitoumus. Callback on synkroninen projektio;
kaikki havainnot hashataan ensin, eikä callback suodata vertailua.
Sivu käytetään kerran. Myöhemmät sivut ja uusi `records()`-kierros lukevat
lähteet uudelleen. Vajaa sivu on jo lukenut koko lähteen, joten sen jälkeen
ei tehdä ylimääräistä tyhjää sivukierrosta. Kulutuksen lopun tuore
kokonaisvertailu säilyy aina, myös cursorin taakse ilmestyneille muutoksille.
Luettelotallentimen omat kansiot valmistellaan ennen lähtötilan kaappausta
sen nykyisen laiskan rivikulutuksen kautta. Ulkopuolisia muutoksia ei
hyväksytä omaksi valmisteluksi eikä lähtötilaa valita uudelleen virheessä.

Jaettujen replacement-parenttien neljä olemassa olevaa järjestettyä
nimilukijaa yhdistetään yksi nimi kustakin kerrallaan. Samannimisen
operaation kaikki neljä mahdollista juurta tarkistetaan yhdessä sen
nykyisellä omistajalla, ei uudelleen jokaisen fyysisen juuren kohdalla.
Lueteltujen sijaintien ja juurivalinnan läsnäolojen on täsmättävä
täydellisesti, myös poissaolojen osalta. Alkuperäiset parent-kuitit sekä
kuluttajan jälkeinen tuore koko operaation tarkistus säilyvät. Inspection
vaatii edelleen yhden sallitun sijainnin ja yksiselitteisen sidonnan.
Muistiin ei rakenneta kasvavaa operaatiojoukkoa. Kunkin neljän lukijan
oma nykyinen nimisivu on rajattu; alkuperäiset luvut sekä kaikkien
lukijoiden sulut odotetaan loppuun, myös yhden sulun epäonnistuessa.

Tämä on readonly-luentakytkentä. C:n julkaisijan on yhä käytettävä samaa
leasea, todellista writer-sulkua, täsmällistä registry-/kohdevalintaa ja
valmiin inventaarion EOF-vertailua ennen journalin `authorized`-julkaisua.
Payloadittoman metadatan ennakkosiivous ja D/E:n eteneminen eivät synny
tästä kuitista. Uusien yhdistelmätestien nimetyt budjetit on erotettu
sovelluksen rajoista [testausohjeessa](../ai/testing-rules.md).

**Yhden payloadittoman sidonnan ennakkosiivous:**
`clearAbsentWorkspaceDeletionBinding` validoi kohteen ja lineagen ennen
luentoja ja käyttää nykyistä sidontatallenninta `owner`-tilassa. Inspection
käyttää omaa aiempaa poissaoloporttiaan. Replacement/migration vaativat
kaikkien neljän juuren poissaolon, import oman candidatensa poissaolon ja
adoption lisäksi alkuperäisen legacy-parentin sekä kaikkien 13 nimetyn
merkinnän poissaolon. Poissaolo ei ole uuden payloadin omistajuustodiste.

Omistajan alkuperäiset slotit, tavut ja identiteetit sidotaan clear-kutsuun.
Oman poiston aikana ne tarkistaa nykyinen slot-tallennin; erillinen
poissaoloportti säilyttää oman metadatahakemiston ancestorit sekä kilpailevan
omistajan kaikki alkuperäiset slotit ja parentit. Viimeinen juuriluku
ei jätä kilpailijaa tarkistamatta. Adoptionin legacy-luennan jälkeen
candidate ja sen kilpailija tarkistetaan vielä uudelleen ennen paluuta.
Ensivirhe säilyy, alkuperäinen I/O odotetaan ja epäonnistunut poisto-, sync-
tai loppukuittaus ei muutu onnistumiseksi myöhemmän poissaolon perusteella.

Tämä portti käsittelee yhden valitun metadataomistajan, ei koko poiston
valmistelua. C:n täydellinen luettelointi ja sen tuntemattomien lähteiden
hylkäys säilyvät pakollisina. Luentageneraattorin vartioimia slotteja ei
muuteta sen yield-välissä; lukija päätetään ensin. Lopullinen inventaarion
lähtötila kaapataan vasta omien siivousten onnistuneiden kuittausten jälkeen.
Vieraan kohteen merkintöjä ei siivota, eikä tämä avaa D/E:n tiedostopoistoa.

**Täydellisen luennan ja siivouskuittausten yhdistäminen:**
`prepareWorkspaceDeletionRemnantBindings` valitsee täydellisen paired-luennan
aikana enintään nykyisen 64 merkinnän muistierän payloadittomia kohdesidontoja.
Alkuperäiset slotit välitetään nykyiselle omistajasiivoukselle; samoina
takaisin ilmestyneet tavut eivät korvaa alkuperäistä tiedostoidentiteettiä.
Luentageneraattori suljetaan ja koko lähtövalinta tarkistetaan ennen siivousta.

Samasta alkuluennasta muodostetaan odotettu jälkitila, josta puuttuvat vain
valitun erän täsmälliset metadatarivit. Kaikki muut havainnot, vieraat
yritykset, parentit ja poissaolot säilyvät vertailussa. Jokaisen siivouksen
pitää palauttaa onnistunut kuittaus. Seuraava kokonainen, suodattamaton
luenta verrataan odotettuun jälkitilaan ennen uuden erän käsittelyä.
Muutos tai puuttuva kuittaus hylkää valmistelun; sitä ei korjata valitsemalla
muuttunutta tilaa uudeksi lähtökohdaksi. Erä ei ole aineistomäärän raja.
Kohteen kaksi sisäistä inspection-parentia ja niiden generation-lehdet
luetaan myös metadatasta riippumattomina lähteinä. Niiden alkuperäinen
identiteetti tai poissaolo ei katoa siivotun metadatarivin mukana.
Myöhemmin ilmestyvä generation-lehti tarvitsee oman täsmällisen sidonnan;
puuttuva tai vieras sidonta hylkää myös myöhemmän erän ja loppuvertailun.
Tavallinen workspacen sisäinen sisältö säilyy yhden workspace-payloadin
alla eikä saa uutta erillistä poistoroolia.
Tämä valmistelu ei vielä julkaise inventaariota tai poistojournalia eikä
siirrä yrityksen tiedostoja. Julkaisijan on edelleen sidottava lopullinen
lähdevalinta samaan rekisteriin, leaseen ja W7.3:n päättämistarkistuksiin.
Kytkennän kohdetodennus, tyypitys ja rajattu riippumaton katselmus
läpäisivät. Katselmuksen sisäisen tarkistuskopion poissaolotodisteen aukko
toistettiin ja korjattiin. Windowsissa myös ei-kanoninen kirjainkokovariantti
hylätään omistajuutta arvaamatta. Lopullisen sarjan näyttö on M1:n
jatkamiskohdassa; varsinainen journalin julkaisijakytkentä on vielä auki.

**Julkaisurajan valmistelu ja hyväksytty järjestys:** nykyinen journal-store
tukee vain alkujulkaisun `next -> current` -rajalla tehtävää erillistä
sisältövertailua. Sen molemmin puolin tarkistetaan alkuperäinen valinta ja
kaikki kolme slottia. W7.3 välittää lisäksi alkuperäisen kevyen
valintatarkistuksensa erikseen; uusi rekisterikaappaus ei korvaa alkuperäisiä
tiedostoidentiteettejä eikä kevyt portti lue backupin sisältöä uudelleen.
Mainin kirjoittajien poissaolotodiste säilyy erillisenä vaatimuksena.

Omistajan 31.10.2026 hyväksymä järjestys ja rajattu tuotantokytkentä ovat
täysi lähde-/inventory-vertailu, W7.3:n nykyinen backup-uusintaluku, nimetty
lähde-/inventory-loppuvertailu ja kevyet omistajuus-/slottitarkistukset ennen
julkaisua. Loppuvertailu ei käynnistä backup-lukua uudelleen. Muuten
"viimeisen valmisteluodotuksen jälkeen" -sanamuoto voi muodostaa kehän.
Synteettinen tiedostokoe todensi muuttuneen lähteen hylkäyksen ennen
current-journalia sekä muuttumattoman lähteen onnistumisen. Koe jäljittelee
backup-odotusta; se ei ole oikean containerin tai tuotantojulkaisijan näyttö.
Varsinainen C-julkaisija ja tämän järjestyksen tuotantokytkentä vaativat
vielä vastaavat todellisen ketjun regressiot ja katselmuksen; päätös ei
itsessään todista niitä eikä koko W7.4:n valmistumista.

**Readonly-valinnan rajattu koe, hyväksytty 31.10.2026:** kytkentäkoe toi
esiin alkuperäisen rekisterivalinnan kertautumisen sisäkkäisissä
luenta-/parent-vartijoissa. Ylimääräinen factoryn `valinta -> kirjoittajat ->
valinta` -kääre erotettiin source- ja mutation-vartijoiksi, koska
source-omistajat muodostavat saman kääreen jo itse. Tämä ei muuttanut
yhtäkään omistavan lukijan tarkistuskohtaa eikä vielä ratkaissut viivettä.

Omistaja hyväksyi tarkistusvastuun täsmennyksen ja rajatun kokeen, ei vielä
sen tuotantokytkentää. Kokeessa readonly-kierroksen
alkuperäinen yritys-/rekisterivalinta tarkistettaisiin koko kierroksen
alussa ja onnistuneen EOF:n sekä sulun jälkeen. Synkroninen requester-/
lease-/main-valtuus, todellinen kirjoittajien poissaolo sekä omistajien
juuri-, parent- ja slotti-identiteetit säilyisivät jokaisessa nykyisessä
kohdassaan. Metadata-cleanup, inventory-/journal-kirjoitus ja aloituksen
julkaisu käyttäisivät edelleen nykyisiä täydellisiä muutosvartijoita.
Readonly-valtuutta ei saa välittää tiedostopoistoon tai julkaisuun.
Luku- ja cleanup-valtuudet erotetaan: kevennetty valtuus saa kulkea vain
kokonaisen readonly-kierroksen sisällä. Valmistelun nykyiset cleanup-kutsut
saavat edelleen alkuperäisen täyden valtuuden. Muille kutsujille ei muuteta
oletuksia tuotannossa tämän kokeen perusteella.
Koe todentaa kesken luvun muuttuneen rekisterin, kadonneen valtuuden,
kirjoittajan ilmaantumisen, metadatan poiston viimeisen tarkistuksen ja
aloitettujen lukujen sulun. Epäonnistunut kierros ei saa luoda uutta
baselinea. Kokeen läpäisy ei hyväksy tuotantokytkentää tai aikarajamuutosta.

Rajattu koe toteutettiin erillään toimitettavasta lähteestä nykyisen
luentaomistajan ympärille. Kierroksen valtuus mitätöityy keskeytyksessä jo
ennen sulun odottamista ja onnistumisessa viimeistään loppuvalinnan jälkeen.
Vanha havaintokohtainen tarkistus ei saa käynnistää uutta lukua sulun aikana
tai elpyä seuraavassa kierroksessa. Alkuperäinen lukuvirhe ja sulkuvirhe
säilyvät erillisinä; testin omat pidätykset vapautetaan ennen loppuodotuksia.
Katselmuksen sulkuvaltuuspuute toistettiin ja korjattiin koeversioon.
Lopulliset 17 kontrollia, tyypitys ja rajattu jälkikatselmus läpäisivät.
Kirjoittajan poissaolo on näissä kontrolleissa injektoitu, ei uuden
prosessiketjun todiste. Metadatan siivouksen sisältävä julkaisuketju ylitti
edelleen nykyisen testirajan; koko kytkentää ei ole hyväksytty.
Tämän kokeen perusteella ei poisteta täydellisiä muutosvartijoita eikä
muuteta aikarajoja. Tarkempi eritelty näyttö on
[integraatiohistoriassa](release-0.3.0-integration-history.md#w74n-inventaarion-omistajapalat-31102026).

Jatkokokeessa siivouskutsujan lähdevaltuus erotettiin sen täydestä
muutosvaltuudesta: alempi selektori muodostaa jo saman valinta-/kirjoittaja-
kääreen. Selektorin tarkistuskohdat, yhteinen ensivirheen lukitus ja
slot-tallentimen muutosvartijat säilyivät. Rajatut kontrollit läpäisivät,
mutta koko julkaisuketju aikakatkaisi edelleen viiden sekunnin testirajalla.
Omistajan erikseen hyväksymä yksi 10 sekunnin mittauskoe läpäisi saman
yhdistelmätestin molemmilla koeehdokkailla. Mittaus oli erillinen koe,
ei itsessään tuotantokytkennän tai pysyvän testirajamuutoksen hyväksyntä.
Sitä seurannut omistajan päätös on alla; muiden testien, sovelluksen ja
CI:n aikarajat säilyvät.

**Tuotantokytkentä hyväksytty 31.10.2026:** omistaja hyväksyi molemmat
kokeillut tarkistusvastuut ja niiden pysyvät regressiot. Nykyinen
`observeWorkspaceDeletionRemnants` rajaa yhden kokonaisen readonly-kierroksen:
alkuperäinen valinta tarkistetaan kirjoittajien poissaolon molemmin puolin
kierroksen alussa ja vasta alkuperäisen iteraattorin sekä kahvojen sulun
jälkeen. Jokaisen sisäisen luvun nykyiset synkroniset valtuus-, kirjoittaja-
ja paikalliset tiedostoidentiteettisuojat säilyvät. Keskeytys mitätöi tämän
kierroksen valtuuden ennen sulun odottamista; siitä palautettu tarkistus
ei saa elpyä uuden kierroksen mukana. Tämä valtuus ei kelpaa siivoukseen.

Metadatan siivouksessa alkuperäinen valinta välitetään ilman päällekkäistä
kirjoittajakäärettä vain selektoreille, jotka tekevät saman täydellisen
valinta-/kirjoittaja-/valintatarkistuksen itse. Ensivirheen lukitus on
yhteinen. Slot-tallentimen muutosvartijat, poissaolotodisteet, kilpailijoiden
tarkistukset ja siivouksen jälkivertailut eivät muutu. Vain nimetyn
metadatan siivous-/julkaisuyhdistelmätestin budjetti muuttuu 10 sekuntiin
[testausohjeen](../ai/testing-rules.md#palautustestin-erillinen-valmistelu)
mukaisesti; muut rajat säilyvät. Kytkennän kohdetodennus ja katselmus
vaaditaan ennen seuraavaa integraatiota, eikä päätös avaa fyysistä poistoa
tai W7.5:n julkista kanavaa.

Toimitettavan lähteen rajattu vaikutusalueen sarja läpäisi 1 015 testiä;
neljä alustakohtaista tapausta jäi suorittamatta. Alkuperäinen vanha
kahvamääräodotus päivitettiin vain yritysvalinnan kierrosrajalle:
työluvan tai kirjoittajasulun menetys pysäyttää edelleen heti. Jokaisen
avatun kahvan täsmälleen yksi sulku, keskeneräisen luvun odotus, oikea
hylkäyssyy ja alkuperäiset tavut tarkistetaan. Katselmuksessa tarkennettu
odotus läpäisi erilliset kohderegressiot. Tämä ei vielä todista fyysistä
poistoa, kylmäkäynnistyksen jatkoa tai paketoitua prosessiketjua.

##### W7.4 C: aloitusjulkaisun rajattu luentakatselmus

**1.11.2026, katselmus ja pienet mittauskontrollit, ei tuotantopäätös:**
nykyinen lähde tekee toistuvia rekisteri- ja sidontalukuja myös pienellä
synteettisellä aineistolla. Tarkistuskopion generationin yksiselitteisyys
vaatii nykyisin täydellisen sidontahakemiston luennan useasti. Tämä on
osoitettu työmäärähavainto, ei koko koostetestin aikakatkaisun todistettu
ainoa syy tai näyttö D:n regressiosta. Paikalliset mittaukset säilyvät
yksityisinä. Mittauskontrollit eivät korvaa nykyisiä hyväksyntätestejä.

Kolme täydellistä inventory-/lähdevertailua, niiden välissä tehtävä
backup-uusintaluku ja journalin tuoreet slotti-/muutosvartijat säilyvät.
Kolmas vertailu tapahtuu journalin julkaisun jälkeen: sen hylkäys säilyttää
jo julkaistun journalin, eikä sitä väitetä ennen kaikkia muutoksia tehdyksi
tarkistukseksi. Aiempi täydellisen census-kierroksen readonly-rajaus on
jo nykyisessä lähteessä; sitä ei toteuteta uudelleen uutena korjauksena.

**Rajattu pois:** inspection-haun kaikkien ulompien parent-tarkistusten
siirtäminen vain kierroksen alkuun ja loppuun. Nykyiset omistajat
havaitsevat myös luvun aikana muuttuneen parentin ennen kuin seuraava
luku voisi palauttaa sen ennalleen. Pelkkä EOF-vertailu ei korvaa tätä
ominaisuutta. Hakua ei lyhennetä ensimmäiseen osumaan eikä tuntemattomia,
vieraita tai ristiriitaisia sidontoja jätetä lukematta.

**Seuraavan pienen kokeen rajaus:** vain C-julkaisijan kolmen
`WorkspaceDeletionInventoryStore.assertRecords`-kutsun puhdas vertailuluku.
Alkuperäinen kohde-/rekisteri-/kirjoittajavalinta tarkistetaan ennen koko
lukua ja kaikkien alkuperäisten lukujen sekä sulkujen jälkeen. Sisäisen
inventory-luennan jokainen nykyinen valtuus- ja kirjoittajatarkistus,
parent-, nimi-, kahva-, tiedostoidentiteetti-, tavu- ja EOF-tarkistus säilyy.
`selectedSource.records()` säilyttää oman alkuperäisen valtuutensa ja
kaikki nykyiset parent-/census-vartijansa; kevyttä valtuutta ei välitetä
siihen, inventoryn kirjoittamiseen, journalille tai muille kutsujille.

Kokeen on osoitettava alkuperäisen virheen säilyminen, valtuuden päättyminen
ennen virheen jälkeistä sulkuodotusta ja vanhan callbackin hylkäys seuraavan
vertailun aikana. Rajattu riippumaton katselmus vahvisti, ettei nykyinen
ulkopuolinen `finally`-kääre tähän riitä: parseri, kahden rivivirran vertailu
ja tiedostokahvan omistaja odottavat sulkua ennen virheen palauttamista.

Koetta varten nimetty rajattu liitos on nykyisen inventory-omistajan
synkroninen, heittämätön ensivirheen lukitus ja luentavaltuuden mitätöinti
ennen ensimmäistä virheen jälkeistä cleanup-odotusta. Koekytkentä kattaa
`workspaceDeletionInventoryStream`-tiedoston parserin, ristiin tarkistuksen
ja rivivertailun sekä `workspaceDeletionInventoryFile`-tiedoston kahvan
omistajan. Ilmoitus kulkee vain `assertRecords`-luennan kautta; muiden
kutsujien, inventory-kirjoituksen ja muutosten oletukset säilyvät.
Myös ensimmäinen sulkuvirhe mitätöi valtuuden ennen seuraavaa sulkuodotusta.
Ilmoitus ei tee I/O:ta, lisää odotusta tai korvaa alkuperäistä virhettä.
Synkroninen valtuusvartija pysyy synkronisena; kirjoittajien päättymistä
odotetaan vain nykyisissä asynkronisissa valintacallbackeissa.

Ensin todennetaan tämä virheraja pienellä kokeella ilman kevennystä.
Vasta sen jälkeen kokeillaan saman luennan rajattua valintavastuuta.
Mukaan kuuluvat
myöhäinen rekisteri-/tavu-/identiteetti-/sivuslottimuutos, kirjoittajan
ilmaantuminen, kaksoisvirhe, keskeneräisen luvun sulku ja muuttumaton
julkaisujärjestys. Hakujen, muiden kutsujien ja muutosvartijoiden nykyiset
regressiot säilyvät. Koe ei hyväksy tuotantokytkentää, aikarajamuutosta,
uutta pitkää koostetestiä tai aiempien hylkäysten sulkemista.

**Ensivirherajan ensimmäinen koe, 1.11.2026:** vain muistiin ladattu liitos
todensi inventaarion omien parseri-, vertailu-, rooli- ja kahvavirheiden
ilmoituksen ennen niiden sulkuodotuksia. Lopullinen 15 kontrollin ja
nykyisten inventaariotestien sarja läpäisi 200 testiä; yksi ennestään
alustakohtainen tapaus jäi pois. Koetoteutuksen ja testien tyypitys läpäisi.
Ilmoituksen puuttumista jäljittelevä vastakoe hylkäsi nimenomaan puuttuvan
aikaisen ilmoituksen. Rajattu riippumaton katselmus vahvisti tämän
inventaarion omistaman osuuden; tuotantolähteitä tai vartijoita ei muutettu.

**Erillinen avoin ajoitusraja:** lähdegeneraattori voi odottaa omaa
siivoustaan ennen `next()`-pyynnön hylkäystä. Tämä toistettiin myös oikealla
`selectedSource.records()`-ketjulla: inventaarion virheilmoitus ei vielä
synny tuon lähteen sisäisen odotuksen aikana. Alkuperäinen virhe, sulku,
säilyvät tavut ja epäonnistuneen lähdekuitin uudelleenkäytön esto todennettiin.
Inventaarion kevyttä valtuutta ei anneta lähteelle; vertailija ei tee uutta
inventory-lukua tai hyväksy tulosta `source.next()`-odotuksen aikana.
Tämä rajaa väitettä havaittavasta virhehetkestä, eikä itsessään osoita
heikomman I/O:n sallivaa polkua. Ennen kevennettyä koetta on silti erotettava
omistajan ensimmäisen havaitseman virheen raja vahvemmasta väitteestä,
jossa ulompi omistaja tietäisi lähteen sisäisen virheen jo ennen vastauksen
saapumista. Jälkimmäistä ei nykyinen koekytkentä todista. Sopimusta ei
kevennetä tämän havainnon perusteella hiljaisesti eikä lähteen vartijoita
muuteta. Seuraava rajattu tarkistus koskee valtuuden todellista eristystä
ja tämän ajoitussopimuksen täsmällistä soveltamisrajaa, ei uutta yleistä
virhehavainnointikerrosta tai pitkää koostetestiä.

**Valtuuden eristyksen rajattu koe, 1.11.2026:** muistiin ladattu
C-ehdokas säilytti lähteen alkuperäisen valtuuden ja kaikki kolme vertailua.
Nykyiset 16 julkaisukontrollia sekä neljä uutta elinikä-/eristyskontrollia
läpäisivät. Katselmuksen kolme testinäytön puutetta korjattiin ja uudet
kontrollit läpäisivät erikseen: koko odotuksen aikainen inventaario-I/O,
julkaistun journalin täsmälliset tavut ja slotti-identiteetti sekä viimeisen
vertailuvaltuuden päättyminen. Tahallisesti poistettu onnistumisen jälkeinen
mitätöinti hylättiin vanhan callbackin käytössä seuraavan vertailun aikana.
Koetoteutuksen ja testien tyypitys sekä rajattu jälkikatselmus läpäisivät.
Pieni vertailu osoitti vähemmän rekisterilukuja muuttamatta tarkistusten
järjestystä; tämä ei ennusta koko koostetestin kestoa tai sulje vanhaa viivettä.

**Rajattu tuotantokytkentä hyväksytty 1.11.2026:** omistajan päätös koskee
vain nykyisiä julkaisijan, inventory-storen, inventory-streamin ja
tiedostokahvan omistajia sekä pysyviä regressioita ja nykyisiä
integraatiotestejä. Jokainen
vertailu sulkee oman valtuutensa ensimmäisessä itse havaitsemassaan virheessä
ennen omia cleanup-odotuksiaan. Lähde säilyttää omat alkuperäiset vartijansa;
inventaario ei tee I/O:ta tai hyväksy tulosta lähteen vastauksen odottamisen
aikana. Tämä omistajakohtainen sopimus erotetaan nimenomaisesti väitteestä,
että inventaario tietäisi lähteen sisäisen virheen ennen tämän vastauksen
saapumista. Jälkimmäistä ei luvata tai käytetä poikkeusvaltuutena.
Koetodettu toteutus kytketään näihin neljään omistajaan ilman yksityisiä
koemuuntimia tai mittauskirjoituksia. Pysyvät regressiot, vaikutusalueen
testit ja nykyiset integraatioportit vaaditaan ennen loppuhyväksyntää.
Pienet kokeet ja mittausten läpäisy eivät korvaa tuotannon lähteen näyttöä.
Muut kutsujat, kirjoitusvartijat, kolmen vertailun sopimus,
backup-uusintaluku ja aika-/eheysrajat säilyvät.

**Tuotannon lähteen paikallinen todennus:** neljän omistajan toteutus vastaa
katselmoitua ehdokasta. Pysyvät kontrollit ja nykyiset inventaariotestit
läpäisivät 220 testiä; yksi ennestään alustakohtainen tapaus jäi pois.
Normaali desktopin tyypitys ja tuotannon lähteen rajattu katselmus läpäisivät.
Laajempi poisto-, hallintakytkentä- ja palautuskäynnistyssarja läpäisi
1 941 testiä 62 tiedostossa; neljä ennestään alustakohtaista tapausta jäi pois.
Sarjaan sisältyivät aktiivisen, valitsimen ja passiivisen yrityksen
main-ketjut sekä oikeat prosessikatko-/jatkotestit. Pitkä 23 rivin komento
oli valinnasta erikseen pois, eikä sen hyväksyntää päätellä näistä tuloksista.
Lähteet säilyivät samoina. Testisarjat ovat päällekkäisiä, eivät yhteen
laskettavaa hyväksyntämäärää.

**2.11.2026, koostetodennus:** nykyinen testiapuri erottaa inventaarion
kirjoituksen ja kolme vertailua suljetuilla vaiheilla; kahdeksan kontrollia
ja desktopin tyypitys läpäisivät. Yksi tavallinen 23 rivin komento eteni
aloitusjulkaisun läpi fyysiseen vaiheeseen mutta aikakatkaisi alkuperäiseen
rajaansa. Säilyneen journalin vaihe on `purgeAuthorized`, rekisteri on
ennen-tilassa. Tämä ei osoita tarkkaa odottavaa kutsua tai vanhan viiveen
juurisyytä korjatuksi. Ensivirhe ja keskeneräinen aineisto säilyvät.
Salatun aineiston kokeeseen lisättiin myös odotettujen tarkoituksellisten
hylkäysten ja lapsen sulkukuitin vaatimus: pelkkä punainen testikuluttaja
ei saa korvata niitä. Pieni sulkukoe erotti hyväksytyn pysäytyspyynnön ja
havaitun prosessipoistuman puuttuvasta lopullisesta `close`-kuittauksesta;
jälkimmäisen odotus on vielä selvitettävä. Kokonainen koostetesti,
paketoitu todennus ja PR/main-portit
sekä aiempien hylkäysten avoin käsittely säilyvät erillisinä.

**Rajattu testiapurin sulkukatselmus, 2.11.2026:** pakkopysäytystä edeltävä
vanhemman IPC-katkaisu voi jättää Noden lopullisen `close`-tapahtuman
puuttumaan. Lähdekatselmus ja erottava synteettinen koe vahvistivat tämän
mekanismin. Nykyisen prosessifixturen muistikoe läpäisi poistamalla vain
ennenaikaiset katkaisukutsut; putkien päättyminen ja oikea `close`
havaittiin. Tämä ei vielä ole pysyvien lähteiden tai salausketjun hyväksyntä.

Korjaus rajataan `workspaceDeletionProcessTestSupport`-apurin peruutukseen
ja loppusulkuun: oma lapsi pysäytetään nykyisesti, IPC säilyy päättymiseen
asti ja kaikki kutsujat odottavat edelleen todellista `close`-tapahtumaa.
`exit`, onnistunut kill-pyyntö tai yhteyden katkeaminen eivät korvaa sitä.
Tulosteita ei hylätä, tapahtumaa ei luoda itse eikä Noden sisäistä laskuria
muuteta. Säilytä testin ensivirhe erillään sulkuvirheestä: testin peruutus
ei yksin tarkoita epäonnistunutta siivousta, mutta todellinen lapsiprosessin
tai viestikanavan virhe ei saa kadota loppusulun onnistumiskuitin alle.
Pelkkä kill-kutsun `false` ei myöskään todista sulun epäonnistumista, jos
lapsi ehti poistua ja sen oikea `close` saadaan.

Ennen jatkoa vaaditaan pysyvät regressiot molemmille pysäytyskutsujille,
viivästyvälle sululle, prosessivirheen säilymiselle ja toistuvalle joinille,
nykyiset oikean prosessin katko-/jatkotestit sekä tiukennettu OpenPGP-koe.
Jälkimmäinen vaatii kaikki kolme tarkoituksellista assertion-hylkäystä
puretun aineiston rakenteisista virheistä, alkuperäiset syyketjut ja aidon
lapsen sulkukuitin ilman testi- tai hook-aikakatkaisua. Tuotannon poisto-
tai palautusketjua, lapsifixturen omistajuutta tai aikarajoja ei muuteta.
Fyysisen poistovaiheen koosteaikakatkaisu jää erilliseksi avoimeksi asiaksi.

**Pysyvä testiapurin korjaus ja todennus, 2.11.2026:** ennenaikainen
IPC-katkaisu poistettiin peruutuksesta ja loppusulusta. Sama sulku odotetaan
myös toistuvassa joinissa; todelliset prosessi-, putki-, viesti- ja
tulosrajavirheet säilyvät erillään testin peruutuksesta. Epäonnistunut
loppusulku säilyttää alkuperäisen syyn ja testiaineiston. 13 pysyvää
sulkukontrollia ja desktopin tyypitys läpäisivät. Normaali oikean
prosessirajan sarja läpäisi kaikki viisi tapausta; samassa ajossa myös
13 sulkukontrollia läpäisivät. Määriä ei lasketa päällekkäin.
Rajattu riippumaton lähdekatselmus ei jättänyt löydöksiä.

Tiukennettu OpenPGP-koe läpäisi nykyisillä pysyvillä lähteillä. Puretuista
tavuista varmennettiin alkuperäiset viestit, pinot, syyketjut, testisidonnat
ja kolme tarkoituksellista assertion-hylkäystä. Lapsen todellinen sulkukuitti
vaadittiin, eikä testi- tai hook-aikakatkaisua hyväksytty. Julkisen tulosteen
rajat ja alkuperäisten tiedostotavujen koko-/tiivistevertailut säilyivät.
Lähteiden muuttumattomuus tarkistettiin prosessi- ja salausajojen jälkeen.
Tämä sulkee tämän testiapurin IPC-sulkuvian, ei aiempien hylkäysten kaikkia
syitä tai erillistä pitkän poistoketjun aikakatkaisua. Paketoitu todennus,
E:n päätös ja koko W7.4:n PR/main-portit säilyvät avoimina.

##### W7.4:n inventaario, tiedostot ja rekisteri

Yllä olevat [kohdeluettelon](#w70n-kohdeluettelon-täsmäsopimus),
[journalin](#poistojournal-ja-peruuttamattomuuden-raja) ja
[keskeytyksen](#keskeytyksen-jatkaminen) sopimukset ovat normatiivisia;
niille ei tehdä rinnakkaista algoritmia. Inventaario on omistajien
suljettu, osissa luettava luettelo, ei koko userData-juuren glob-haku.
Kukin omistaja tarkistaa myös nimeämänsä juuren indeksittömät jäännökset:
indeksin tai journalin puuttuminen ei todista tyhjyyttä.

- Rekisteröity workspace sisältää yrityksen DB/sidecarit, auktoritatiiviset
  PDF:t, business-auditin, SMTP:n kaikki slotit, sisäiset arkistoasetukset/
  retryt sekä omat palautuspisteet avaimineen. Alijuuret eivät toistu
  ulkoisina rooleina. Poisto ei tarvitse salaisuuden dekryptausta.
- Legacy-lähteestä käytetään nykyisen adoption-omistajan samaa 13 merkinnän
  sallintalistaa. Installation-runtime, lokit, tukipaketit ja päivitystila
  eivät muutu yrityksen payloadiksi. Käyttäjän ulkoiset PDF:t ja backupit
  sekä toisten yritysten tiedostot säilyvät.
- Juurten fyysinen erillisyys, alkuperäiset ja tuoreet identiteetit,
  linkki-/tyyppirajat, nykyiset sisältörajat sekä kaikkien kirjoittajien
  poistuminen tarkistetaan ennen siirtoa. Quarantine on saman levyn siirto,
  ei kopio/hardlink, piilobackup tai uusi säilytysaika.
- Jokainen siirto ja poisto vaatii tuoreen saman operaation valtuuden.
  Osittaisen purgen poissaolo on sallittu vain ennalta valtuutetussa
  quarantinessa. Muut puuttumiset ja vaihtuneet kohteet estävät jatkon.
  Epäonnistumisessa odotetaan kaikki aloitetut I/O:t; ei taustalle jääviä poistoja.
- Rekisterin jälkeen-tila johdetaan validoidusta ennen-tilasta puhtaalla
  mutaatiolla: vain kohde poistuu, aktiivisen kohteen jälkeen valinta on null,
  muuten sama aiempi valinta säilyy. Muiden entryjen arvot ja järjestys eivät
  muutu. Vain täsmällinen `writeSelected`-valinta, ei vanhan snapshotin
  sokkokirjoitusta tai yleistä `recoverAndRead()`-siivousta.
- Registry-entry/lineage-varaus säilyy payloadin todettuun poissaoloon asti.
  Kaikki registry-slotit sovitetaan ennen terminalia; backup-slotti ei saa
  palauttaa poistettua yritystä. Omistajien sidonta-/journal-cleanup tapahtuu
  luettelon ollessa vielä käytössä. Luettelo ja oma tyhjä operaatiokansio
  poistetaan vasta terminal-currentissa; poistojournal viimeisenä.

**D:n luettelo- ja siirtoraja:** nykyisen inventaariotallentimen
`consumeSelectedRecords` tarkistaa koko valitun tiedoston EOF:n, tiivisteen,
rivimäärän ja roolien keskinäiset ehdot ennen ensimmäistä kuluttajakutsua.
Sarjallinen luenta käyttää samaa avointa kahvaa ja alkuperäistä
muuttumatonta metadataa; myös puskuroidun rivin jälkeen tarkistetaan valinta.
Kuluttaja ja kaikki sulut odotetaan loppuun, ja ensivirhe säilyy.
Rivin toimitus ei itsessään anna tiedostomuutoksen valtuutta.

Fyysinen siirtopala johtaa vain roolin nykyisten omistajien sallimat polut.
Poistopaikka on alkuperäisen juuren sisar, jonka nimi sidotaan poisto-operaatioon
ja kanonisen luetteloavaimen tiivisteeseen. `inspectionEvidence` ei ole
itsenäinen siirtokohde. Julkaistun `authorized`-vaiheen tuore valtuus sitoo
journalin, luettelon, rekisterin ja kirjoittajien poissaolon. Alkuperäinen
juuri tai jo siirretty juuri hyväksytään vain täsmällisellä juuri- ja
vanhempi-identiteetillä; molemmat tai tuntematon poissaolo estävät jatkon.
Myös keskeytyksen jälkeinen jo siirretty kohde tarvitsee nykyisen
hakemistosynkronoinnin. Varmistus ei väitä Windowsin sähkökatkokestävyyttä.
Tämä pala ei julkaise seuraavaa journal-vaihetta, poista sisältöä tai muuta
rekisteriä. Koko etenijän liitos ja keskeytyksen prosessitodistus ovat erilliset
pakolliset portit; W7.5:n kanavat pysyvät suljettuina.

**D:n yhden juuren lopullinen poisto:** `purgeWorkspaceDeletionPayload`
hyväksyy vain julkaistun `purgeAuthorized`-vaiheen erikseen todistetun
valtuuden. Se käyttää siirron kanssa samaa suljettua polku- ja
identiteettivalintaa. Koko jäljellä olevan juuren rakenteellinen esiluku
edeltää sen suorituskerran ensimmäistä tiedostopoistoa; tietokantaa ei avata.
Hakemistojen nimet luetaan rajattuina sivuina, eivät koko puun muistitaulukkona.
Yksittäinen poisto tarkistaa kohteen ja vanhemmat alhaalta ylöspäin,
alkuperäisen juurivalinnan sekä tuoreen ulkoisen valtuuden ennen muutosta.
Tiedoston metadata säilyy muuttumattomana; hakemiston identiteetti säilyy,
mutta omien lapsipoistojen muuttamia aikaleimoja ei vaadita samoiksi.

Poisto käyttää vain `unlink`- ja tyhjän hakemiston `rmdir`-kutsuja.
Tuntematonta lisätiedostoa ei poisteta rekursiivisella varamenettelyllä.
Ennakolta valtuutetun juuren poissaolo voidaan hyväksyä uudessa jatkossa,
mutta valitun merkinnän katoaminen saman kierroksen aikana hylätään.
Myös jo poistuneen juuren jatko tarvitsee parent-syncin ja tuoreen
poissaolo-/valtuustarkistuksen. Aloitetut luvut, poistot ja sulut odotetaan;
alkuperäinen virhe säilyy ennen myöhempää sulkuvirhettä.
Rajatut ketjutestit käyttävät todellisia journal-/luettelotavuja ja
tiedostopoistoja. Niiden vaihesiirrot ja main-/kirjoittajavaltuus ovat
testivalmistelua, eivät vielä yhteisen etenijän tai prosessikatkon näyttöä.

**D:n yhteinen fyysinen vaihe:** `createWorkspaceDeletionPayloadExecutor`
käyttää samaa julkaistua journalia ja muuttumatonta luetteloa vaiheissa
`authorized -> quarantined -> purgeAuthorized -> purged`. Se ei vielä
julkaise rekisteriä, siivoa omistajien metadataa tai kuittaa koko poistoa.
Vaihevalinta kiinnittää journalin ja rekisterin kaikki alkuperäiset tavut
sekä tiedostoidentiteetit mainin valtuuden ja kirjoittajien poissaolon alle.
Rekisterin ennen-/jälkeen-havaintojen luokittelu ei itsessään korjaa slotteja.

Jokainen kulutettu rivi saa vain oman callbackinsa ajan kelpaavan valtuuden.
Sidonnan nykyinen omistaja tarkistaa myös kilpailevat metadata-slotit;
workspace-rivin omistaa rekisteri eikä sille keksitä erillistä sidontaa.
Sisäinen inspection-todiste käyttää samaa neljän sijainnin tarkistinta
kuin alkuperäinen omistaja. Vain todistetun workspace-siirron sisäiset
lukupolut seuraavat quarantinea; todiste ei muutu poistettavaksi juureksi.

Journalin omaa vaihesiirtoa tai slottisovitusta suojaa täydellisen luettelon
ja vaaditun payload-tilan tuore tarkistus sekä alkuperäinen ulkoinen
rekisteri-/kirjoittajavaltuus. Tallennin tarkistaa itse muuttuvat journal-
slotit; ulkoinen vartija ei lue samaa tallenninta kesken sen muutoksen.
Valmistunut siirto varmennetaan palautuneella tiedostoidentiteetillä ja
täsmällisellä julkaistulla vaiheella ennen seuraavaa työtä. Kadonnut kuittaus
pysäyttää suorituksen; uusi jatko lukee pysyvät slotit uudelleen.
Rajatut tiedostokokeet eivät vielä todista palvelun/mainin todellista
kytkentää, prosessikatkosta tai rekisterin ja metadatan loppusiivousta.

##### W7.4 D: journalin luentavartijan koesopimus

**1.11.2026: rajattu koesuunnitelma katselmoitu; omistaja hyväksyi yhteisen
portin synteettisen kokeen, ei tuotantokytkentää.** Tämä jatkaa D:n tarkistusvastuun
suunnittelua. Kokonaisen rooliketjun aikakatkaisut säilyvät avoimina.
Tavoite on poistaa saman vartijan sisäinen päällekkäinen sisältöluenta,
ei vähentää varsinaisten muutosten, julkaisujen tai poistojen tarkistuksia.

`CrashSafeByteSlotStore.selectedGuard` kutsuu nyt kokonaista ulkoista
tarkistusta sekä ennen omien kolmen slotin lukua että sen jälkeen.
D:n kutsujalla kumpikin käynnistää koko inventaarion
`consume(state, 'validate', false)`-tarkistuksen. Ehdokas erottaa vain
ensimmäisen, puhdasta slot-lukua edeltävän vartijan. Jokaisen nykyisen
`beforeMutation`-kutsun viimeinen täydellinen tarkistus säilyy samassa
kohdassa, myös hakemistovalmistelussa, nextin luonnissa, molemmissa
siirroissa, sivuslotin poistossa, synkronoinnissa ja loppukuittauksessa.

| Omistaja | Rajattu koemuutos |
| --- | --- |
| `workspaceDeletionPayloadExecutor.ts` | Nykyinen vaiheomistaja antaa lukuvartijaksi `phase.assertExternalSelection`in: alkuperäinen rekisterivalinta, työlupa, fyysinen omistajuus ja kirjoittajien poissaolo. Täysi sisältövartija pysyy nykyisenä `consume(..., 'validate', false)`-kutsuna. `move`/`purge` eivät saa kevyttä valtuutta. |
| `workspaceDeletionJournalStore.ts` | Vain executorin `advance`/`recover` välittävät erillisen, nimenomaisen lukukontekstin. Se kaapataan ennen ensimmäistä odotusta. `publish`, `clearTerminal` ja muut kutsujat säilyttävät nykyisen sopimuksen. |
| `crashSafeByteSlotStore.ts` | Kokeessa vain `replaceSelected` ja `recoverSelected` saavat valinnaisen, erillisen lukukontekstiargumentin. Se ei kuulu levitettävään selection-olioon. Ensimmäinen vartija käyttää sitä; viimeinen vartija käyttää aina nykyistä täyttä ulkoista tarkistusta. Ilman argumenttia kutsujan nykyinen järjestys säilyy. |

Nykyiset byte-store- ja Node-tiedosto-operaatiot, valittujen tavujen kopiointi,
kaikkien slottien identiteetit, kirjoituskahvan sulku ja kuittauksen
identiteettitodistus säilyvät. Vajaa tai virheellinen lukukonteksti
hylätään ennen tiedostotyötä; myös kontekstin puuttuminen ja callbackit
kaapataan ennen ensimmäistä odotusta. Myöhempi olion muutos ei vaihda
vartijaa. Työluvan menetys tai epävarma sulku ei muutu jatkoluvaksi.
Kevyt vartija ei lue oman muuttuvan journalin slotteja ulkoisena valintana.
Sisältötarkistusta ei välimuistiteta eikä vartijaa valita kutsunumerosta.
Nykyinen slottien ja sisällön peräkkäinen tarkistus ei ole atominen
tiedostojärjestelmätilannekuva. Tämä koe ei muuta muiden persistence-
omistajien sopimusta tai lupaa samanaikaista havaintoa kaikista tiedostoista.
Jos sekä sisältö että slotti ovat virheellisiä, ensimmäinen havaittu syy
voi vaihtua tarkistusjärjestyksen mukana. Säilytä todellinen ensihavainto;
tekemättömän tarkistuksen virhettä ei arvata ensisyyksi.

Kokeessa ei käytetä tiedostoadapteria, joka tekisi viimeisen täyden
sisältötarkistuksen jälkeen uuden kevyen slottikierroksen. Sellainen
järjestys vaatisi oman myöhäisen sisältömuutoksen tarkastelunsa.
Tässä ehdokkaassa viimeinen täydellinen sisältötarkistus säilyy
nykyisten slottihavaintojen jälkeen.

**Pienin erottava näyttö ennen kokonaiskoetta:**

1. Käytä nykyisiä oikeiden slottitavujen fixturejä. Mittaa vartijoiden ja
   tiedosto-operaatioiden järjestys: alkuvartija -> samat kolme slot-lukua
   -> alkuperäinen täysi sisältövartija -> nykyinen muutosraja. Rajaa
   koemuutos muistissa ladattuun lähteeseen; tuotantotiedostot säilyvät.
2. Muuta payload- tai kilpailevaa sidontatietoa viimeisen slot-luvun aikana,
   ennen julkaisua ja ennen varakappaleen poistoa. Molempien `advance`- ja
   `recover`-polkujen on hylättävä jatko ja säilytettävä hyökkäyksen jälkeen
   jäljellä olevat tavut. Aiemmat myöhäisen journal-muutoksen kontrollit säilyvät.
3. Todista ennen omaa vertailua vaihtunut slotti, loppuvalinnan aikana
   vaihtunut rekisteri tai varsinaisen muutoksen lähde, palannut kirjoittaja,
   vanhentunut valtuus, talteen otettu vanha callback sekä todellisen luku-
   ja sulkukutsun päättyminen keskeytyksessä. Ensivirhe ja myöhempi
   sulkuvirhe säilyvät erillisinä; kaikki avatut kahvat suljetaan.
4. Varmenna puuttuvan/vajaan kontekstin sekä odotuksen aikana vaihdetun
   callbackin käsittely. Vertaa ilman lisäargumenttia kaikkien nykyisten
   selected-operaatioiden järjestys ja säilyneet tavut alkuperäiseen.
   `publish` ja `clearTerminal` eivät saa uutta käyttäytymistä vahingossa.
   Kahden riippumattoman virheen tapaus todentaa hylkäyksen ja säilyvät
   tavut; kummankin järjestyksen ensimmäinen havainto raportoidaan erikseen.

Muutoskandidaatti koskee jaettua persistence-porttia, joten rajattujen
kontrollien lisäksi nykyiset slot-, registry-, switch-, import-, adoption-,
first-start-, build-metadata-, palautusjournal- ja sidontatestit kuuluvat
vaikutusarvioon. Niiden muut kutsujat eivät ota uutta porttia käyttöön.
Kokonainen rooliketju ajetaan vasta erottavan näytön ja katselmuksen jälkeen
yhdellä jäädytetyllä ehdokkaalla nykyisessä aikarajassa. Kutsujen väheneminen
ei lupaa kokonaiskokeen läpäisyä tai todista vanhaa timeoutia korjatuksi.
Tuotantokytkentä tarvitsee erillisen päätöksen. E:n metadata-todiste,
W7.5, muut formaatit ja koko W7.4:n integraatioportit pysyvät erillään.
Rajattu riippumaton lähdekatselmus ei jättänyt tähän koesopimukseen estävää
löydöstä edellä kirjatuin rajauksin.

**Rajattu koetulos 1.11.2026:** vain muistiin ladattu ehdokas läpäisi
lopulliset 34 kontrollia. Mukana ovat kaikki kolme sallittua palautuksen
slottiparia, hyökkäys täsmälleen native-muutosvartijan sisällä ennen
julkaisua ja sivuslotin poistoa, todellinen luku-/sulkukutsu,
alkuperäisten virheolioiden säilyminen sekä executorin oikea
`advance`-/`recover`-argumentin välitys ja sen valtuuden vanheneminen.
Katselmus löysi kahdesta ensimmäisestä kontrollista todistusaukot;
natiivivartijan täsmällinen rajaus ja puuttuneet palautusparit lisättiin,
ja rajattu jälkikatselmus sulki löydökset. Vertailukontrollit läpäisivät;
vain neljä uutta porttia tarvitsevaa tapausta jäi vertailusta pois.

Yhdessä aidossa journal-siirtymässä täydet tarkistuskutsut vähenivät
20:stä 10:een. Kaikki 33 slottitiedoston lukua, tiedostotoimet ja
viimeisen täyden vartijan sijainti säilyivät. Jaetun portin muiden
kutsujien vaikutussarja läpäisi sekä vertailulla että ehdokkaalla samat
986 testiä 39 tiedostossa; kuusi ennestään alustakohtaista tapausta jäi
suorittamatta. Testitiedostot, tapausmäärät, yhteiset rakenteiset tulokset
ja muuttumattomat tuotantolähteet verrattiin. Päällekkäisiä sarjoja ei summata.
Ehdokkaan vartijamuutos ei muuttunut lopullisten kontrollitäydennysten aikana.

Omistajan erikseen hyväksymä yksi 23 rivin kokonaiskoe aikakatkaisi
nykyisessä rajassa. Jäädytetyt lähteet säilyivät samoina ennen ja jälkeen
ajon. Säilyneen journalin current on `purged`, next ja backup puuttuvat.
Rekisterin tavut vastaavat vielä ennen-tilaa, kohde on rekisterissä ja sen
kuusi sidontatietuetta ovat yhä jäljellä. Koe eteni aiempaa pidemmälle,
mutta rekisterijulkaisu, metadatan loppusiivous ja koko poisto eivät
valmistuneet. Journalin vaihe tai tiedostolista eivät korvaa lopullista
poissaolo-, tavunsäilymis- tai siivoustodistusta.

Säilynyt tila ei erota executorin viimeistä `purged`-luennan odotusta
rekisterivaiheen ensimmäisistä poissaololuennoista. Seuraava rajaus on
nykyisen yksityisen koeraportin vaihe- ja tarkistusmäärien erottelu ennen
uusia tarkistusmuutoksia. Omistaja hyväksyi yksityisen raportin tämän
täydennyksen, pienen kontrollin ja yhden nimetyn mittausajon samalla
aikarajalla. Sama epäonnistunut ehdokas ei saa
vihreyteen tähtäävää uusintaa. Tuotantokoodia, jaettua tallenninporttia,
aikarajoja tai hyväksyntäehtoja ei muutettu. Tuotantokytkentä, E:n
metadata-päätös sekä koko W7.4:n integraatioportit jäävät avoimiksi.

**Vaihemittauksen tulos 1.11.2026:** nykyiseen yksityiseen koeraporttiin
lisätty mittaus läpäisi 48 pientä ja nykyisen vaihevalinnan kontrollia.
Mokatun komentofixturen suhteellinen valmistelujuuri korjattiin nykyisen
polkusopimuksen mukaiseksi; alkuperäinen hylkäys säilytettiin.
Rajattu riippumaton katselmus ei jättänyt mittaukseen löydöksiä.
Mittaus säilyttää alkuperäiset virheoliot ja komentojärjestyksen eikä tee
tiedostokirjoituksia mitattavan työn sisällä. Testin alkuperäiset väitteet
ja aikaraja tarkistettiin parserilla muuttumattomiksi.

Yksi hyväksytty mittausajo aikakatkaisi yhteiseen testirajaan. Valmistelu,
aloitusjulkaisu ja fyysinen payload-vaihe valmistuivat; aikakatkaisun
kohde oli rekisterivaihe. Metadatan siivous ja viimeistely eivät alkaneet.
Säilyneissä rekisterisloteissa current puuttuu, backupin tavut vastaavat
ennen-tilaa ja nextin tavut jälkeen-tilaa. Journal on edelleen `purged`.
Tämä on kesken jäänyt julkaisu, ei valmis poisto tai lupa sovittaa slotteja
automaattisesti. Alkuperäiset ja mitatun ehdokkaan lähteet säilyivät samoina.
Yksityiskohtaiset kestot ja mittausarvot pysyvät paikallisessa aineistossa.

Mittaus erottaa yhteisbudjetin loppumisen aiemmin epäselvästä vaiheesta;
se ei sulje pois tarkistustyön jatko-optimointia tai todista muita hitauksia
korjatuiksi. Omistaja hyväksyi 1.11.2026 yhden vain tämän yhdistelmätestin
360 sekunnin diagnostisen mittauksen. Tulos on alla; pysyvää testirajaa
ei ole hyväksytty. Sovelluksen rajat,
turvatarkistukset, tuotantokytkentä ja E:n
erillinen metadata-päätös säilyvät ennallaan.

**Kertamittauksen lopputulos 1.11.2026:** myös 360 sekunnin diagnostinen
ajo aikakatkaisi. Valmistelu, aloitusjulkaisu, fyysinen poisto ja
rekisterivaihe valmistuivat. Säilynyt current-rekisteri vastaa täsmällistä
jälkeen-tilaa, kohde puuttuu ja rekisterin sivuslotit puuttuvat. Aikaraja
tuli vastaan metadatan siivouksessa; viimeistely ei alkanut. Poistojournal
on yhä `purged`, eikä tätä kirjata valmistuneeksi poistoksi tai
loppusiivoustodisteeksi. Kaikki jäädytetyt syötteet tarkistettiin samoiksi
ennen ja jälkeen ajon. Aiemmat epäonnistumiset ja uusi aineisto säilyvät.

Lähderajaus on nyt `workspaceDeletionMetadataCleanup.ts`: sen
`bindingsFor` käyttää sidonnan `inspectCommittedAfterPayloadsAbsent`-
lukua, jonka `withCommittedCleanup` kutsuu koko `assertPurged`-luentaa.
Tämän luennan sisäinen inventaariovartija kutsuu toistuvasti täyttä
`phase.assertSelected`-valintaa. Lukutarkistus ja varsinainen metadatan
poistolupa on erotettava jatkosuunnittelussa; yhden lukukierroksen tulosta
ei saa käyttää myöhemmän poiston tuoreuden korvikkeena. Nykyiset
journalit-ennen-sidontoja-järjestys, muuttuvat slotit, jokaisen muutoksen
täysi vartija ja ensivirheen säilyminen pysyvät voimassa. Tämä havainto ei
hyväksy uutta tarkistusmuutosta tuotantoon eikä uutta pitkää kokonaisajoa
ilman erottavaa pientä näyttöä. Uutta rajannostoa tai saman ehdokkaan
uusintaa ei tehdä automaattisesti. E:n erillinen päätös pysyy avoimena.

**Seuraava pieni D-koe:** sovelletaan nykyistä luentavaiheen rajausta vain
metadatan `assertPurged`-funktion puhtaaseen inventaarion tarkistukseen.
Täydet valinnat säilyvät kierroksen alussa ja lopussa; sisäiset lukijat
tarkistavat työluvan, kirjoittajien poissaolon ja nykyiset tiedostoidentiteetit.
Kierroksen callbackit vanhenevat sen päättyessä ja ensimmäinen virhe säilyy.
Ulommat muuttavat inventaariokierrokset, sidonnan poisto sekä alkuperäisten
journalien poistot ja järjestys eivät vaihdu kevyelle valtuudelle.
Vertaa alkuperäisiä metadatatestejä ja samoja tavuja kummallakin ehdokkaalla.
Lisäkontrollit kattavat myöhäisen valinta-/payload-/sidontamuutoksen,
kirjoittajan paluun, vanhat callbackit sekä oikean pidetyn luvun ja sulun
päättymisen. Tämä jatkaa rajattuja synteettisiä D-kokeita; tuotantokytkentä,
uusi pitkä kokonaisajo ja pysyvä aikabudjetti eivät ole tällä hyväksyttyjä.

**Pienen metadatakokeen tulos 1.11.2026:** alkuperäinen vertailu läpäisi
29 testiä; kaksi uuden luentavaiheen elinikää koskevaa kontrollia jäi
vertailussa tarkoituksella suorittamatta. Ehdokas läpäisi kaikki 31
tapausta samoilla alkuperäisillä metadatatesteillä ja aikarajoilla.
Yhteiset rakenteiset tulokset ja säilyneet tavut vastasivat toisiaan.
Katselmus löysi vanhan callbackin testistä todistusaukon: kutsu tehtiin
ennen seuraavaa varsinaista validointia. Kontrolli siirrettiin uuden
validoinnin sisään, sen tuore valtuus varmennettiin molemmin puolin ja
oikea tiedostoluku tehtiin edelleen. Tahallisesti jaettu elinikälippu
hylkäsi vahvistetun kontrollin odotetusti. Jälkikatselmus sulki löydöksen.
Itse luentaehdokas ei muuttunut kontrollikorjauksen aikana.

Alkuperäisen tiedoston kaikki tarkistuslauseet, muuttavien kierrosten
vartijat ja tuotantolähteet säilyivät. Vaikutusalueen nykyiset
viimeistely-, rekisterijulkaisu-, vaihevalinta-, sidontasiivous- ja
inventaariotestit läpäisivät: 144 testiä viidessä tiedostossa; yksi ennestään
alustakohtainen tapaus jäi suorittamatta. Jäädytetyt lähteet ja ajokytkentä
säilyivät samoina. Pieni näyttö ei sulje
aiempia kokonaiskokeita tai todista koko poiston valmistumista.

##### W7.4 D: rajattu tuotantokytkentäehdotus

**1.11.2026: omistaja hyväksyi rajatun tuotantokytkennän ja regressiot.**
Viiden omistajan lähdekytkentä ja pysyvät regressiot on toteutettu;
tyypitys ja alla rajatut tavalliset kohdeajot läpäisivät. Tämä ei vielä
sulje koko W7.4:ää tai aiempia kokonaiskokeita.
Tämä kokoaa aiemmat luentaehdokkaat yhdeksi rajatuksi kytkennäksi, ei
uusia ominaisuuksia tai uutta testijärjestelmää. Toteutuskoodi ei tuo
yksityisten kokeiden transformereita, mittareita tai lähdekopioita runtimeen.

| Nykyinen omistaja | Tuotantoon ehdotettu muutos |
| --- | --- |
| `workspaceDeletionPayloadBinding.ts` | Yhden sidontaluennan sisäinen työlupa päättyy luennan päättyessä; alkuperäinen valinta ja kirjoittajien poissaolo ympäröivät koko kierroksen. Nykyiset tavu-, juuri- ja kilpailevien sidontojen tarkistukset säilyvät. |
| `workspaceDeletionPayloadExecutor.ts` | Vain workspace-rivin haku ja `validate` käyttävät kierrokseen sidottua sisäistä lukuvartijaa. Täysi vaihevalinta säilyy rajoilla; `move`/`purge` eivät saa kevyttä valtuutta. |
| `crashSafeByteSlotStore.ts` | Vain `replaceSelected`/`recoverSelected` saavat erillisen valinnaisen `readSelection`-argumentin ensimmäiselle slottien lukuvartijalle. Omistava moduuli nimeää sen yhteisen tyypin. Lopullinen täysi sisältövartija säilyy jokaisessa nykyisessä muutoskohdassa samojen slottitarkistusten jälkeen. |
| `workspaceDeletionJournalStore.ts` | Välittää uuden erillisen argumentin vain executorin `advance`-/`recover`-kutsuista. Konteksti ja callback kaapataan ennen odotusta; muut kutsujat ja puuttuvan argumentin oletus säilyvät. |
| `workspaceDeletionMetadataCleanup.ts` | Vain `assertPurged`-luennan sisäosa käyttää rajattua työluvan ja kirjoittajien vartijaa. Täysi valinta pysyy kierroksen molemmin puolin; ulommat muuttavat kierrokset, alkuperäisten journalien poisto ja sidontasiivous eivät muutu. |

Luennan virhe lukittuu ensimmäiseen todelliseen syyhyn. Vanhat callbackit
eivät herää uudessa kierroksessa. Omistettu luku ja sulku odotetaan loppuun
ennen luennan valtuuden päättymistä. Mitään luentatulosta ei välimuistiteta
myöhemmän tiedostomuutoksen, julkaisun tai poiston luvaksi. `clearSelected`,
alkujulkaisu, terminalin julkaisu ja muiden persistence-kutsujien oletus
eivät ota uutta argumenttia käyttöön.

Hyväksynnän jälkeen pysyvät regressiot sijoitetaan nykyisiin omistaviin
testeihin ilman riippuvuutta yksityisestä koehakemistosta. Tyypitys ja
vaikutusalueen nykyiset testit sekä myöhemmin normaalit paketti-, palautus-,
katselmus- ja PR/main-portit vaaditaan edelleen. Tämä päätös ei muuta
aikarajoja, hyväksy vanhoja epäonnistumisia tai ratkaise E:n erillistä
metadata-omistajuutta. Kokonaisen 23 rivin ketjun valmistuminen on yhä
todentamatta. W7.5:n tuotantokanavat pysyvät suljettuina.

**Lähdekytkennän checkpoint 1.11.2026:** samat viisi omistajaa käyttävät
nyt koetodettua luentarajausta ilman koemuuntimia tai mittaria.
Regressiot ovat tavallisissa sidontaluennan, executorin, journalin ja
metadatan testeissä. Tyypitys läpäisi. Ensimmäinen neljän tiedoston
kohdekierros läpäisi 103 testiä. Testifixtureiden tyyppien viimeistely
paljasti yhden descriptor-virheen, joka esti journalin myöhäismuutosten
injektion; normaalin metodisijoituksen ominaisuudet palautettiin ja
kyseinen 33 testin journal-sarja läpäisi. Muiden kolmen tiedoston
tarkistukset säilyivät läpäisseinä. Alkuperäiset hylkäykset säilytettiin;
kyse ei ollut sovelluksen aikakatkaisusta tai guardin ohittamisesta.

Jaetun tallenninportin nykyinen 39 tiedoston vaikutusajo läpäisi 986
testiä suoraan tuotantolähteitä vasten; kuusi ennestään alustakohtaista
tapausta jäi pois. Päällekkäisiä sarjoja ei lasketa yhteen.
Nykyinen OpenPGP-toimituskoe todensi alkuperäisen synteettisen
poistovirheen, pinon ja syyketjun säilymisen puretuissa tavuissa.
Rajattu tuotantokytkennän lähdekatselmus ei jättänyt löydöksiä. Tämä ei
korvaa oikeaa main-/cold-/native-/pakettiketjua, kokonaista 23 rivin
poistoa tai PR/main-portteja. E:n erillinen omistajuuspäätös ja vanhat
aikakatkaisut pysyvät avoimina.

**Integraation avoin portti 1.11.2026:** normaali 23 rivin koostetesti ja
sen yksi hallittu kohdeuusinta aikakatkaisivat aloitusjulkaisussa.
Samat lähteet ja alkuperäinen aikaraja säilyivät. Nykyinen virhesinkki
säilytti ensivirheen ja aktiivisen alavaiheen; vaihe ei todista juurisyytä.
Julkaisun kolme täydellistä luettelovertailua sekä kaikki muutoksen
vartijat säilyvät. Niiden luentaketjun seuraava rajattu katselmus ei
itsessään hyväksy uutta tuotantokytkentää tai aikarajamuutosta.
Oikean lapsiprosessin keskeytys-/jatkosarjan neljä tapausta läpäisi;
yhden tapauksen ensimmäinen testi- ja siivousaikakatkaisu säilyvät
avoimina, vaikka sen yksi kohdeuusinta läpäisi sulku- ja siivousehdot.
Tämä on paikallista rajattua näyttöä, ei koko W7.4:n hyväksyntä.

##### W7.4 D: metadatan ennakkoluennan rajattu koesopimus

**2.11.2026, omistaja hyväksyi lähdekatselmoidun rajatun koesopimuksen.**
Hyväksyntä koskee myös alla yksilöityä transientin payloadin havaintoeroa;
se ei hyväksy tuotantokytkentää, aikarajamuutosta tai pitkää kokonaisajoa.
Tämä koskee vain loppusiivouksen ensimmäistä, alkuperäisjournalien
kohdesidonnat kokoavaa lukukierrosta. Jo toteutettua `assertPurged`-
sisäluennan rajausta ei uusita. Vaihehavainto ei todista, että tämän
erottelun säästö yksin riittää koko komennon nykyiseen aikarajaan.

1. `WorkspaceRemnantBindingStore` saa kokeessa nimetyn vain lukevan
   `inspectCommittedDeletionSlots`-portin. Nykyinen strict-luku,
   `inspectCommittedAfterPayloadsAbsent`, sekä kaikki clear-portit ja
   niiden oletukset säilyvät. Ei valinnaista poissaolotarkistusta tai
   yleistä nopeaa tilaa vanhaan rajapintaan.
2. Jaa vain staattinen kohteen, kanonisen sidontatiivisteen sekä odotettujen
   slottitavujen ja identiteettien tarkistus. Syötteet kopioidaan ennen
   ensimmäistä odotusta. Omistaja/avain, lineage, sivuslotit, puuttuvat
   slotit ja saman sisältöisten tiedostojen identiteetit validoidaan kuten
   ennen. Vanhan strict-portin mode- ja kiellettyjen kenttien tarkistus
   säilyy sen omana ehtona. Uusi luku palauttaa vain kopioidut havainnot,
   ei poissaolotodistetta tai tiedostomuutoksen vartijaa.
3. `workspaceDeletionMetadataCleanup.ts` käyttää uutta porttia vain
   ensimmäisen iteratorin nimetyssä `bindingsForPreflight`-luennassa.
   Tuore vaihe-/rekisteri-/journal-valinta, työlupa, kirjoittajien poissaolo
   ja native-luennan identiteettitarkistukset säilyvät. Koko ennakkoluennan
   jälkeen, sen I/O:n ja sulkujen päätyttyä, tehdään täysi `assertPurged`
   ennen `context.assertAdmitted`-tarkistuksia ja ensimmäistä retirementia.
   Nykyinen alun täysi tarkistus ja rivien journal-vartijat säilyvät.
4. Alkuperäisjournalin poiston `selectedBinding`-callback pysyy strictinä.
   Samoin toisen iteratorin `bindingsFor`, binding-clearin täydet vartijat
   ja sen jälkeinen strict-luku. Niitä ei vaihdeta yhteisen apurin kautta.
   Katselmus hylkäsi laajemman ehdotuksen: retirementin viimeinen external-
   tarkistus tapahtuu purged-tarkistuksen jälkeen, joten siellä kevennetty
   sidontaluku voisi päästää palaavan payloadin seuraavaan journal-poistoon.
5. Ensivirhe päättää lukukerran valtuuden ennen omaa siivousta. Kaikki
   aloitetut luvut ja sulut päätetään ennen jatkoa; myöhäinen tulos ei anna
   uutta valtuutta. Ei välimuistia, rinnakkaista poistokierrosta, uutta
   keräysjärjestelmää tai aikarajamuutosta.

**Kokeeseen hyväksytty havaintoero:** payload, joka ilmestyy ja häviää kokonaan
ennakkoluennan aikana ennen täyttä loppuvertailua, voi jäädä uudessa
luennassa havaitsematta. Ehdotusta ei kuvata vanhan havaintosopimuksen
veroiseksi. Loppuvertailussa edelleen olemassa oleva payload estää kaiken
retirementin; myöhempien muutosten nykyiset täydet vartijat säilyvät.

Pieni nykyisen fixturen vertailukoe todentaa onnistumisen, tyhjät ja
side-only-slotit, väärän kohteen/avaimen/digestin, muuttuneet caller-tavut,
saman sisältöisen tiedoston identiteettivaihdon ja valtuuden menetyksen
pidätetyn luvun/sulun aikana. Injektoi pysyvä payload viimeisen
ennakkorivin jälkeen sekä erikseen transientti ennakkoluennan sisälle.
Todista myös retirementin viimeisen sidontaluvun aikainen payloadin paluu,
toisen iteratorin ja post-clear-luennan muuttumattomuus sekä ensivirheen ja
säilyneiden tiedostojen erilliset tulokset. Vertaa muutosvartijoiden kutsuja,
ei vain virhekoodia tai nopeutta. Koe ei hyväksy tuotantokytkentää tai uutta
pitkää koostetta. Rajattu jälkikatselmus ratkaisee jatkoehdotuksen.

**Rajattu koenäyttö 2.11.2026:** nykyinen toteutus ja muistiin ladattu
ehdokas läpäisivät saman 75 testin joukon. Yhden vanhan callback-kokeen
järjestysnumeroon sidottu pysäytys korjattiin vain koefixturessa päättymään
hyökkäyksen kohteena olleen luennan sulkuun; vanhentuneet callbackit,
nollamuutokset ja säilyneet tavut vaaditaan edelleen. Katselmuksessa
täydennetyt 20 kontrollia läpäisivät kummallakin toteutuksella erikseen;
päällekkäistä kattavuutta ei lasketa yhteen. Ne erottavat retirementin
viimeisen sidontaluvun, toisen iteratorin, binding-clearin ja post-clearin
sekä ensimmäisen syyn säilymisen myöhemmän omistajuusvirheen rinnalla.
Todelliset keskeneräiset inventory- ja binding-kahvat suljettiin ennen
palautumista. Tarkoituksella vain viimeistä retirement-lukua heikentänyt
vastakoe hylättiin tiedoston säilymisvaatimuksessa. Ehdokkaan tyypitys ja
rajattu lähdekatselmus läpäisivät. Omistaja hyväksyi tämän jälkeen nimetyn
ennakkoluennan tuotantokytkennän ja pysyvät regressiot. Kytkentä läpäisi
normaalin kolmen tiedoston kohdeajon (78 testiä), tyypityksen ja rajatun
katselmuksen. Testimokkien tyyppimerkinnät korjattiin erikseen; vanhan
callback-kontrollin pysäytys sidottiin katselmoidusti hyökkäyksen kohteena
olleen luennan päättymiseen. Uudet kontrollit käyttävät oletusbudjettia.
Koko komennon aikarajaa tai vanhoja hylkäyksiä ei suljeta tällä näytöllä.

##### W7.4:n cold-admission ja havaittava tulos

**2.11.2026, integraation jatkoraja:** hyväksytty inspection-haun kytkentä
ja natiivi aloitusjulkaisu on todennettu rajatusti. Koko komentotesti
aikakatkaisi edelleen metadatassa myös testin ylimääräisen valmisteluluennan
poistamisen jälkeen. Nykyinen `assertPurged`-sisäluennan rajaus on jo
toteutettu; sitä ei uusita jatkokorjauksena. `bindingsFor` kutsuu
`inspectCommittedAfterPayloadsAbsent`-porttia, jonka yhteinen
`withCommittedCleanup` käynnistää koko poissaolotodistuksen ennen ja jälkeen
slottien luennan. Myös oikeat metadatamuutokset käyttävät tätä todistetta.
Puhtaan ennakkoluennan [rajattu koesopimus](#w74-d-metadatan-ennakkoluennan-rajattu-koesopimus)
on katselmoitu, kokeiltu ja omistajan hyväksymänä kytketty rajatusti.
Muutokseen välittömästi liittyvät luennat pysyvät strictinä; aikarajaa ei muuteta.
Vaihehavainto ja lähdeketju eivät yksin todista koko aikakatkaisun syytä.
Alla kuvattu E:n pysyvä metadata-todiste ja tuotannon cold-kytkentä ovat
edelleen erillisiä avoimia portteja.

Nykyinen startup tunnistaa vain creation/import-admissionin. Lisää siihen
deletion-omistaja **ennen** normaalia korjaavaa registry-lukua, adoptionia,
W6:n yritysinventaariota ja business-avausta. Säilytä sitä edeltävät
single-instance-, build- ja asennuspäivityksen omistajuusportit.
Deletion-census lisätään myös managementin sekä selectorin avaus-/paluun
guardien kaikkiin sisääntuloihin. Pelkkä ensimmäisen slotin `inspect()`
tai journalin löytyminen ei anna palautusvaltuutta.

Saman kohteen keskeytynyt palautus voidaan korvata vain jo hyväksytyn
W7-P3:n tarkalla pysyvällä kohdesidonnalla ja nykyisten omistajien
sulkutodisteella. Tämä nimetty delete-admission ei lievennä tavallisen
create/import/switch/replace-toiminnon `assertNoUnresolvedOperations()`-
sääntöä. Muun yrityksen tai installation-update/W6:n journal ei väisty.
Poistojournalin täsmällinen valinta tarkistetaan uudelleen delete-leasen
ja mainin fyysisen varauksen alla; cold-resume kutsuu samaa etenemistä
kuin live-poisto. Tuntematon tila säilyy näkyvänä selvitystarpeena.

**E:n normaalien sisääntulojen esivaihe:** tavallinen management-guard,
creation/import-admission, valitsimen avaus-/paluucensus ja suora
startup-resolveri tunnistavat poistojournalin kaikki kolme slottia ennen
tavallista avaus-/korjaustyötä. Presence-luennat päätetään myös yhden
epäonnistuessa. Lukematon tai ristiriitainen aineisto ei muutu poissaoloksi;
vartija ei tulkitse, sovita tai poista poistojournalia. Poikkeuksena
palautettavan cold-/selector-lukuvirheen sisäinen alkuperäinen syy säilyy,
mutta sitä ei julkaista IPC:ssä tai operational-tapahtuman kentissä.
Managementin suljettu tilakysely säilyy erillisenä status-sopimuksena.
Tämä esivaihe ei vielä toteuta
deletion-omistajan valintaa tai anna sen käynnistysjatkolle valtuutta.

**E:n alkuperäisjournalien lukusäännöt:** tuonnin
`captureWorkspaceBackupImportDeletionSlots`, adoption
`captureWorkspaceLegacyAdoptionDeletionSlots` ja aktivoinnin
`captureProfileRestoreActivationDeletionSlots` käyttävät samoja sallittujen
slottisuhteiden sääntöjä kuin omistajiensa `clearAfterDeletionPurged`.
Ne kopioivat toimitetut tavut ja identiteettikentät synkronisesti, eivät
lue tai muuta tiedostoja eivätkä kutsu työ- tai purged-valtuuksia.
Nykyiset siivousportit käyttävät samaa tarkistinta alkuperäisessä kohdassa;
niiden tuoreet valinnat, muutosvartijat ja virherajat säilyvät.
Tämä ei todista toimitetun tiedostoidentiteetin nykyisyyttä, poissaoloa,
sisällön luottamusta tai avaus-/siivouslupaa. Tyhjä tai sivuslottiin jäänyt
aineisto tarvitsee edelleen nimetyn omistajan valtuuden. Aktivointijournal
ei sisällä yritystä tai lineagea, joten sen oikea kohdesidonta on edelleen
todistettava erikseen. E:n varsinainen admission-kytkentä on vielä kesken.

**Lähteestä vahvistettu avoin metadata-reuna:** import voi keskeytyä
rekisterijulkaisun jälkeen ennen oman `registryPublished`-kuittauksensa
tallennusta. Candidate on silloin jo siirretty yrityskansioksi. Jäljellä
oleva kohdesidonta on erillisen juuren kannalta payloaditon, vaikka sen
alkuperäinen journal on vielä kesken. Nykyinen ennakkosiivous ei voi
poistaa tätä todistetta ja myöhempi loppusiivous ei voi keksiä puuttuvaa
inventaario-sidontaa. Myös activationin loppusiivouksen vastaava raja on
arvioitava. Nykyinen tavallinen admission estää näiden tilojen yli
aloittamisen; kyse ei ole nykyisen mainin toistetusta poistoviasta.
Tälle nimetylle poikkeuspolulle on ratkaistava pysyvä metadata-todiste
ennen tuotantokytkentää. Uutta luetteloroolia, journal-kenttää tai
alkuperäisen journalin ennakkopoistoa ei hyväksytä tämän kirjauksen perusteella.

Sisäiset tulokset ja turvalliset tapahtumat noudattavat
[poistopyyntösopimusta](#w70n-poistopyyntö--ja-vahvistussopimus).
`prepared` ei ole `completed`, eikä työtilan poistuminen yksin todista
metadata-cleanupia. Runtime-sulun puhdas merkki ei todista poiston onnistumista.
Aktiivisen/viimeisen poiston jälkeen päädytään nykyiseen null-valitsimeen;
passiivisen jälkeen voidaan palata vain samaan aiempaan yritykseen normaalien
porttien kautta. Relaunch-virhe erotetaan pysyvästi valmistuneesta poistosta.

Uudet delete/deleteResume-vaiheet kytketään nykyiseen operational-observeriin,
validatoriin, Diagnostics-projektioon ja nykyisiin sallittuihin
tukipakettilukijoihin samassa toteutuksessa. W7.5:n desktop-only-vientiä
ei väitetä valmiiksi tällä perusteella. Alkuperäisen synteettisen virheen
ketju todistetaan nykyisen salatun testipaketin keräyksellä ja purulla
ennen pitkää CI-ajoa; puuttuva tieto jää puuttuvaksi. Ei uusia aineistolajeja
tai raakavirheitä julkiseen lokiin.

##### W7.4 E: alkuperäisjournalin pysyvän kohdetodisteen ehdotus

**2.11.2026, omistaja hyväksyi kokeiden jälkeen täsmällisen v2-muodon
toteutuksen ja testit nykyisten porttien kautta.** Ratkaisu on nykyisen poistojournalin
versionoitu tekninen kohdetodiste enintään kolmelle nykyiselle journal-
omistajalle: import, adoption ja activation. Tämä on niiden kiinteä
lukumäärä, ei uusi raja palautusjäännösten määrälle. Activationin yksi
journal sidotaan yksiselitteisesti joko replacement- tai migration-
omistajaan. Epäselvä tai vieras journal estää poikkeuspolun.

- Valitse alkuperäisjournalin kaikki slotit ja niiden oikea kohdesidonta
  nykyisillä omistajilla ennen payloadittoman metadatan ennakkosiivousta.
  Poikkeus säilyttää vain täsmällisesti valittujen journalien tarvitsemat
  sidonnat; muiden payloadittomien sidontojen nykyinen siivous säilyy.
  Census vertaa edelleen myös säilytettyä metadataa ja vieraita lähteitä.
- Koemallin uusi journal-versio sitoo kohteen lisäksi omistajan, operaation,
  kanonisen binding-tiivisteen ja alkuperäisten slottien tavusitoumukset sekä
  nykyisen formaatin tiedostoidentiteetit. Ei raakaa journal-sisältöä,
  yritysnimiä, polkuja, salasanoja tai business-dataa poistojournaliin.
  Tarkka kenttäskeema ja kaikkien kolmen omistajan sallittujen slottiparien
  vertailu katselmoidaan koetta varten; nykyinen 16 KiB:n raja säilyy.
- Sama todisteluettelo on muuttumaton kaikissa poiston vaiheissa ja
  tarkistetaan uudelleen aloitusjulkaisussa sekä live-/cold-jatkossa.
  Inventaarion nykyistä formaattia, fyysisiä rivejä tai `inspectionEvidence`-
  roolia ei muuteta metadata-todisteeksi eikä puuttuvaa root-identiteettiä
  keksitä. Todiste antaa vain nimetyn metadatan loppusiivouksen rajauksen,
  ei uutta payload-poistolupaa tai valtuutta ohittaa tuoreita vartijoita.
- Alkuperäisjournalien poisto tapahtuu vasta nykyisessä purged-/registry-
  jälkeen-tilassa ennen niiden kohdesidontojen poistoa. Keskeytyksen yli
  sallitaan vain todistettuun lähtövalintaan nähden nykyisen side-before-
  current-siivoamisen mukainen puuttuminen. Uusia, korvattuja tai siirrettyjä
  slotteja ei omaksuta. Tuore valinta ja täysi poissaolotodistus tarvitaan
  edelleen jokaiseen varsinaiseen muutokseen.
- Nykyinen journal-tallennin ja slot-valinta säilyvät; ei rinnakkaista
  journal-tiedostoa tai manageria. Version 1 aineisto luetaan alkuperäisellä
  sopimuksellaan, ei muunneta kesken operaation eikä täydennetä arvatuilla
  todisteilla. Puuttuva todistus ei avaa uutta admission-poikkeusta. Uuden
  version ja vanhan version sekoittuneet slotit hylätään. Business-backupin
  formaatti, tietokanta ja käyttäjän varmuuskopiot eivät muutu.

Ensimmäinen koe rajataan importin todelliseen katkoväliin:
yrityskansio ja rekisteri julkaistu, journal-kuittaus kesken. Todista
sidonnan säilyminen ennen julkaisua, uuden omistajan tarkka cold-valinta,
journalin osittainen retirement ja metadatan viimeinen poisto. Pienet
activation/adoption-kontrollit varmentavat saman esityksen soveltumisen;
activationin operation-ID yksin ei todista yritystä. Vieras/samanniminen
journal, muuttuneet tavut/identiteetit, puuttuva binding, palautuva payload,
vanhentunut lease, formaattien sekoitus ja epävarma keskeytystila hylätään
aineistoa hävittämättä. Sallitut keskeytysvälitilat todennetaan erikseen.
Normaalit recovery-kutsujat eivät käytä poikkeusta.
Koe ja formaattikatselmus edeltävät erillistä tuotantokytkentäpäätöstä;
main/cold-kytkentää, W7.5:tä tai pitkää kokonaisajoa ei avata tällä ehdotuksella.

**Katselmoitu koemuoto ja näyttö 2.11.2026:** version 2 lisäkenttä on
`originalJournalProofs`. Sen järjestettyjen teknisten merkintöjen kentät
ovat `owner`, `operationId`, `bindingSha256` ja `slots`. Current/next/backup
on joko `null` tai todellisten tavujen SHA-256 ja nykyisen tallentimen
viisikenttäinen tiedostoidentiteetti. Omistaja, operaatio ja journalin
kohde muodostavat nykyisen kanonisen bindingin; sen tiivisteen on täsmättävä.
Activationin kaksi binding-omistajaa eivät saa tuottaa kahta todistetta
samalle fyysiselle journalille. Poistovaiheiden yli muuttuva todisteluettelo
ja tuntemattomat kentät hylätään. Vanhat journalit eivät saa uutta todistetta.

Muistiin ladatun koemuodon nykyiset journal-/metadata-testit läpäisivät
lukuun ottamatta yhden uuden identiteettikontrollin virheellistä
keinotekoista tunnistevaihtoa. Se korvattiin aidolla saman sisältöisen
tiedoston vaihdolla alkuperäinen säilyttäen. Korjatut 18 kontrollia
läpäisivät; alkuperäinen hylkäys säilyy erillisenä. Näyttö kattaa kaikki
kolme fyysistä omistajaa, molemmat activation-bindingit, importin mallinnetun
kuittauskatkon, osittaisen native-retirementin, uuden tallenninomistajan,
kolmen todistuksen kokorajan, sekoittuneet versiot sekä v2:n initial-next-,
current/next-, backup/next- ja current/backup-keskeytykset. Ehdokkaan
tyypitys läpäisi. Tämä ei vielä ole tuotannon cold-admissionin tai oikean
import-recovery-ketjun todiste: mallinnettu katko ja tiedostojen
tallennuskoe erotetaan varsinaisesta käynnistysketjusta.

**Jäljellä ennen E:n tuotantoesitystä:** ennakkosiivouksen näytön jälkeen
tarvitaan julkaisukokeen jälkeen saman valinnan metadata-retirementin ja
uuden cold-omistajan kytkentänäyttö nykyisissä omistajissa. Todisteesta ei tehdä fyysistä
inventaarioriviä. Pelkkä koemuodon tallennus ei avaa admission-poikkeusta.

**Ennakkosiivouksen rajattu näyttö 2.11.2026:** korjattu yksityinen
koekytkentä läpäisi nykyisen 40 testin valmistelujoukon ja tyypityksen.
Natiivi fixture siirsi import-candidaten yrityskansioksi ja julkaisi
rekisterin importin omilla konstruktoreilla, mutta jätti viimeisen
`registryPublished`-kuittauksen tekemättä. Luontiaika ja aiempi aktiivinen
valinta vastasivat journalia. Valittu sidonta ja alkuperäisjournal säilyivät,
muu payloaditon metadata siivottiin nykyisellä omistajalla ja vieraat tavut
säilyivät. Toimitetun todistuksen slot-tiivisteet ja identiteetit verrattiin
oikeisiin valittuihin tiedostoihin, ei vain riippumattomaan muistikuvaan.
Väärä todistus hylättiin ennen mitään orphan-cleanupia. Lähdevertailu
hylkäsi myös myöhäisen kohdesidonnan, alkuperäisjournalin tai vieraan
metadatan muutoksen. Ensimmäinen syy säilyi myöhemmän omistajavirheen yli.

Ensimmäinen koefixturen yhdistelmätesti aikakatkaisi. Katselmus löysi
rekisterifixturen kaksi sopimusvirhettä sekä puuttuvan yhteyden toimitettuun
slot-todistukseen; ne korjattiin ennen seuraavaa ajoa. Alkuperäistä hylkäystä
ei nimetä onnistumiseksi tai sen aikakatkaisun syytä todistetuksi. Kaikki
testirajat ja tavallinen valmistelupolku säilyivät. Tämä koe ei ajanut
varsinaista import-recoveryä, julkaisijan kolmea vertailua eikä mainin
cold-admissionia; returned-census-kuitti ei korvaa niiden näyttöä.

**Sivutuksen ja julkaisukokeen rajaus 2.11.2026:** kaksi nykyisen
oletusbudjetin sivutuskontrollia läpäisi samalla neljän lähteen koeehdokkaalla.
Kontrolloidussa lähteessä kaikki 66 riviä säilyivät täsmällisessä järjestyksessä
ilman duplikaatteja tai metadata-todisteen fyysistä riviä. Säilytetty metadata
sisältyi jokaiseen uudelleenluentaan; sivurajan jälkeen muuttuneet raakatavut
hylättiin loppuvertailussa. Alkuperäiset aliasvirheestä johtuneet hylkäykset
säilyvät. Tämä ei todista 65:n oikean payloadin omistajuutta tai natiivia
julkaisuketjua. Ehdokkaan neljän lähteen tyypitys ja rajattu katselmus
läpäisivät. Neljä uutta natiivia julkaisukoetta valmistui, mutta niihin
sovellettiin virheellisesti toisen nimetyn testin budjettipoikkeusta.
Niitä ei lasketa hyväksyntänäytöksi. Omistaja hyväksyi tämän jälkeen vain
näille neljälle kokeelle oman 10 sekunnin rajan ja yhden kohdetodennuksen.
Uusi ajo samalla neljän lähteen koeehdokkaalla läpäisi kaikki neljä tapausta:
alkuperäinen todiste säilyi kolmen vertailun yli ilman fyysistä metadata-riviä;
backup-luennan aikainen alkuperäisjournalin tai vieraan sidonnan muutos
hylättiin ja initial-next säilyi; julkaisun jälkeinen muutos hylättiin
committed-current säilyttäen. Aiempi ajo ei muutu hyväksytyksi. Muiden testien,
sovelluksen ja CI:n rajat sekä tuotantolähteet säilyvät ennallaan.

**Uuden vaihevalinnan rajattu näyttö 2.11.2026:** yhdeksän kontrollia
läpäisi nykyisellä oletusbudjetilla. Muuttumaton vaihevalitsin luki oikeasta
poistojournalista v2-todisteen sekä rekisterin jälkeen-tilan. Import-journalin
omistaja poisti oikean backup-slotin ennen tarkoituksellista kuittauskatkoa;
uusi tallennin ja vaihevalinta hyväksyivät vain todistetta vastaavan
jäljelle jääneen sisällön. Muuttunut todistus, vaihdettu alkuperäisjournal,
puuttuva sidonta ja väärä poistovaihe estivät kokeen jatkon. Vanha vaihevalinta
hylkäsi myös omien journal-/rekisteritiedostojensa vaihdon; uusi semanttisesti
sama valinta erotetaan vanhan havainnon käytöstä. Hylkäysten jälkeiset tavut
säilyivät eikä siivouskutsuja tehty. Pidätetty oikea luku odotettiin loppuun
valtuuden päättymisen jälkeen ja kahvat suljettiin. Myös ennen odotettua
vaihemerkkiä epäonnistuva luku päätti odotuksen ja säilytti tiedostot.
Koefixturen koko työ liitettiin nykyisen siivouksen edeltävään loppuodotukseen;
myöhään valmistuvan vaihevalinnan valtuus päätetään vielä odotuksen jälkeen.
Sulkukontrollien virheodotukset korjattiin nykyisten virheluokkien mukaisiksi
ja vaiheen alkuperäinen syy varmennettiin erikseen. Alkuperäiset hylkäykset
säilyvät. Rajattu lähdekatselmus läpäisi; varsinaista aikakatkaisua ei
aiheutettu tässä koesarjassa. Tämä ei aja main-/cold-kytkentää, metadata-cleaneria
tai prosessin uudelleenkäynnistystä eikä avaa tuotantokytkentää.

**Hyväksytty E:n toteutusraja:** yllä katselmoitu täsmällinen v2-muoto ja
nimetty alkuperäisjournalien valinta on hyväksytty toteutukseen ja testeihin.
Sen toteutuspalat ovat: nykyinen codec/slot-tallennin; tuore
kiinteiden omistajien valinta ja rajattu ennakkosiivous; vain täsmällisesti
sidotun payloadittoman metadatan riviprojektion poikkeus koko census-hash
säilyttäen; muuttumaton todiste julkaisijan kolmen vertailun yli; sekä
purged-vaiheen alkuperäisjournalin ja vasta sen jälkeen sidonnan retirement.
Poikkeus ei anna fyysistä poistolupaa. V1-aineistoa ei muunnettaisi tai sen
puuttuvia todisteita arvata. Main-/cold-kytkentää ei hyväksytä ennen näiden
porttien ja nykyisen omistajuus-/keskeytysketjun todennusta. Suunnitelman tai
alemman tason kokeen hyväksyminen ei sulje koko W7.4:ää.

**Ensimmäinen tuotantopala:** codec lukee v1:n alkuperäisellä sopimuksella
ja v2:n erillisellä muuttumattomalla todisteluettelolla. Yhteinen
`WorkspaceDeletionJournal`-tyyppi kattaa molemmat versiot; v1- ja v2-tyypit
ovat edelleen erotettavissa. Muiden omistajien tyyppiviitteet päivitettiin
ilman niiden vaihe- tai muutoskäyttäytymisen muuttamista. Normaali seitsemän
tiedoston codec-/slot-/tallennus-/vaihe-/rekisterijoukko läpäisi 327 testiä,
tyypityksen ja rajatun katselmuksen. Katselmuksessa löytynyt harvan taulukon
ja ylikirjoitetun `.map`-metodin validointiaukko korjattiin: jokainen sallittu
oma data-alkio kopioidaan rajatulla indeksiluennalla eikä toimitettua koodia
kutsuta. Kielteiset regressiot todentavat myös getterit ja poikkeavan
taulukkoprototyypin. Natiivislotit todentavat v2:n vaihesiirrot, uuden
tallentimen, muuttuneen todisteen ja versionsekoituksen hylkäyksen sekä
initial-next-, current/next-, backup/next- ja current/backup-keskeytykset.
Kontrolloidut todisterivit eivät itsessään todista nykyisten alkuperäisjournalien
valintaa.

**Valinnan ja aloitusjulkaisun tuotantopala:** nykyiset kolme fyysistä
journal-omistajaa valitaan niiden omilla lukijoilla ja slot-validaattoreilla.
Tuore valinta sitoo kohteen ja ajonaikaisen aineistojuuren; alkuperäiset
tavut, tiedostoidentiteetit ja mahdollisen activation-aliasin poissaolo
verrataan uudelleen. Muuttumaton todiste säilytetään ennakkosiivouksessa ja
v2-aloitusjournalissa. Vain täsmällisesti sidottu payloaditon metadata
ohitetaan fyysisessä riviprojektiossa, ei census-tiivisteessä tai myöhempien
sivujen loppuvertailussa. Uutta fyysistä riviä tai juurta ei keksitä.

Kiinteän alkuperäisjournaliluennan täysi kohde- ja kirjoittajatarkistus
tehdään kokonaisen kierroksen alussa ja lopussa. Sisäiset lukijat säilyttävät
työluvan, kirjoittajien päättymisen ja tiedostotarkistukset. Ennakkosiivous
tarkistaa alkuperäisvalinnan myös jokaisen luentakierroksen välissä sekä
jokaisen sidontasiivouksen molemmin puolin. Olemassa olevat kaksi
siivousapuria ottavat valinnaisen `assertOriginalJournalsSelected`-vartijan,
joka sidotaan ennen ensimmäistä odotusta ja tarkistetaan nykyisen
payload-poissaolotodistuksen jälkeen. Näin se säilyy todellisella
slot-poistorajalla kertautumatta poissaololuennan sisäisiin lukuihin.
Muiden kutsujien oletuspolku ei lisää uutta odotusta.

Inventaarion kirjoitus säilyttää nykyisen kohde–kirjoittajat–kohde-vartijan;
pelkkä inventaario ei anna poistolupaa. Alkuperäisvalinta tarkistetaan
lähdeluentojen rajoilla ja EOF:ssa, aloitusjournalin muutosvartijassa,
kaikissa kolmessa julkaisuvertailussa ja viimeisessä havainnossa.
Normaali viiden tiedoston kohdesarja läpäisi 152 testiä, tyypityksen ja
rajatun katselmuksen. Neljä nimettyä julkaisukoetta käyttää hyväksyttyä
10 sekunnin rajaa; muut uudet kontrollit oletusrajaa. Todellinen myöhäinen
muutos estää sekä journalin ensimmäisen kirjoituksen että myöhemmän
onnistumispalautteen aineistoa tuhoamatta. Kaikkien viiden sidontaomistajan
regressio estää todellisen slot-poiston myös toimitetun vartijafunktion
vaihtuessa kesken operaation. Alkuperäiset tyypitys-, käynnistys- ja
aikakatkaisuhylkäykset säilyvät erillisinä. Yksityinen mittaus ei ole
tavallisen testiajon hyväksyntänäyttöä. Metadata-retirementin ja
main-/cold-kytkennän näyttö tarvitaan edelleen ennen E:n loppuhyväksyntää.

**Metadatan jatkokytkennän tila:** jäännösvertailija käyttää alkuperäisten
omistajien samoja tavusuhdevalidaattoreita. `selected` vaatii kaikki
sitoutuneet slotit; vain purged-/rekisterin jälkeen -omistaja voi käyttää
nykyisen next–backup–current-järjestyksen mukaista puuttuvaa alkua.
Puuttuva binding hyväksytään vertailussa vain, jos kaikki alkuperäisslotit
ovat jo poissa. Tämä vertailutulos ei itsessään anna poistolupaa.
Inventaarioon kuulumattoman proof-avaimen candidate tai neljä nykyistä
replacement-juurta tarkistetaan nykyisillä polkuomistajilla, natiivilla
poissaololla ja sidotuilla esi-isäidentiteeteillä. Adoption vaatii lisäksi
kaikkien nimettyjen legacy-entryjen poissaolon. Tätä varten ei keksitä
fyysistä inventaarioriviä tai julkaistua bindingiä.

Nykyinen metadata-omistaja liittää nämä kiinteät poissaolot täydelliseen
purged-tarkistukseen myös lopussa ja molempien metadata-artifactien jo
poistuttua. Alkuperäisjournalit käsitellään ennen niiden proof-avaimia.
Viimeisen aliasluennan jälkeen palannut payload tarkistetaan ennen
retirement-vartijan palautusta; natiivi regressio vaatii alkuperäisen
currentin säilymisen, ei pelkkää hylkäystä. Vertailu- ja poissaolokontrollit,
tyypitys sekä tämä virheregressio läpäisivät. Seitsemän uuden yhdistelmän
hyväksytty 30 sekunnin kohdeajo jäi kolmessa onnistumispolussa aikarajaan.
Idempotentti ehdokas ohittaa vain tuoreesti poissa olevien v2-artifactien
muutosportit; valinta-, alias-, koko poissaolo- ja loppuvertailut säilyvät.
Kesken saman kutsun epäonnistunutta siivousta ei muuteta onnistumiseksi
myöhemmällä poissaolohavainnolla. V1:n alkuperäinen tuotantopolku säilyy.
Idempotentin ehdokkaan seitsemän tapauksen kohdeajo läpäisi kuusi; yksi
korvauspolku aikakatkaisi. Saman lähteen yksi sallittu kohdeuusinta läpäisi
samalla rajalla. Alkuperäinen hylkäys ja sen syy säilyvät avoimina.
Terminal-vaiheen vastaava poissaoloraja on työpuussa: kiinteät proof-juuret
tarkistetaan myös inventaarion retirementin ja viimeisen journalin
siivouksen vartijoissa, vaikka alkuperäismetadata on jo poissa. Muuttuvien
journalslottien ulkoinen vartija käyttää nykyistä rekisteri-/omistajavalintaa,
ei poistettavan journalin vanhaa slottikuvaa. V1:n polku ei saa uusia
asynkronisia tarkistuksia. Normaali viimeistelijätiedoston ajo läpäisi
32 testiä; tyypitys ja rajattu katselmus läpäisivät. V2:n loppuvaihefixturen todiste
muodostetaan oikeista import-journalin slottitavuista ja identiteeteistä;
se ei väitä ajaneensa aiempaa metadata-retirementia tai fyysistä poistoa.
Proof-only-payloadin paluu estää sekä inventaarion että viimeisen journalin
todellisen native-poiston. Journalin kielteinen kontrolli alkaa erikseen
synteettisestä terminal-/inventory-retired-tilasta; koko onnistumisketju
testataan erikseen. Neljä uutta kielteistä kontrollia säilyttävät viiden
sekunnin rajansa. Alkuperäinen virheluokkaodotuksen hylkäys ja yhden liian
laajan kontrollin aikakatkaisu säilyvät erillisinä; niitä ei nimetä
sovellusvirheen korjaukseksi. Main-/cold-ketju ja koko W7.4 ovat edelleen
auki; aiemmat hylkäykset säilyvät.

**Uuden omistajan alkuperäisvalinta:** `captureWorkspaceDeletionOriginalJournalContinuation`
käyttää nykyisen julkaisulukijan samoja kolmea fyysistä omistajaa ja
slottivalidaattoreita. Nimetty vain luku -portti kopioi validoidun journalin
todisteen ennen ensimmäistä odotusta. Todisteeton journal-ryhmä hylätään;
v1 ei saa uutta alkuperäisjournalin poikkeusta. Vain purged-/terminal-vaiheen
rekisterin jälkeen -valinta sallii todistetun next–backup–current-jäännöksen.
Proof-avaimen binding ja activationin vasta-alias luetaan myös silloin,
kun alkuperäisslotit ovat jo poissa. Puuttuva binding vaatii kaikkien
alkuperäisslottien sekä kiinteiden payload-juurten poissaolon.

Pysyvä todiste sitoo alkuperäisjournalin tavut ja tiedostoidentiteetin;
bindingistä se sitoo kanonisen sisällön tiivisteen. Uusi omistaja sitoo
lisäksi juuri havaitsemansa binding-slottien identiteetit omaan luentaan.
Kokonaisen kierroksen alku ja loppu säilyttävät kutsujan täyden
kohde-/kirjoittajavartijan; sisäiset lukijat eivät anna muutosvaltuutta.
Poissaolot tarkistetaan myös uuden kuitin myöhemmissä luennoissa.
Tämä on readonly-jatkoportti, ei startupin admission tai pääprosessin
delete-lease. Normaali kolmen tiedoston kohdeajo läpäisi 59 testiä,
tyypityksen ja rajatun katselmuksen ilman uusia budjettipoikkeuksia.
Validoitu phase-fixture ja natiivit alkuperäisslotit eivät vielä todista
oikeaa startup-/lease-ketjua tai prosessikatkoa. Jälkimmäinen kytkentä on
edelleen kesken; tavallisten käynnistys- ja hallintakutsujien poistojournalin
esto säilyy.

##### W7.4 E: pääprosessin kylmäjatkon toteutusjärjestys

**2.11.2026, rajattu lähdekatselmus ja toteutussopimus; main-kytkentä on
työpuussa mutta integraatio on vielä hyväksymättä.** Tämä täsmentää yllä olevaa cold-admissionia, ei muuta W7-P3:a,
v2-todistetta tai tavallisen palautuksen sopimusta. Alkuperäisjournalien
59 kohdetestiä eivät todista tätä liitosta. Lähdekatselmus vahvisti kolme
huomioitavaa rajaa: tavallinen startup hylkää poistojournalin, sen seuraava
installation-valmistelu voi korjata metadataa, ja nykyisen cold-helperin
creation-haaran vastahaara on import. Pelkkä unionin laajennus ei riitä.

**Readonly-build-valinnan osanäyttö:** update-omistajan uusi valintalukija
käyttää nykyisiä viittä sijaintia ja parsereita ilman repairing-lukuja.
Nykyinen selector-valmistelu jakaa sen kanssa saman puhtaan C-terminalin
suhdetarkistuksen; sen kirjoituskäyttäytymistä ei muutettu. Normaali kolmen
tiedoston kohdeajo läpäisi 111 testiä, desktopin tyypityksen ja rajatun
katselmuksen. Katselmuksessa uuden lukijan puuttuvan packaged-todisteen
kehitystila-aukko korjattiin ja muodostuksen välisen muutoksen sekä pidetyn
luvun revoken kontrollit lisättiin. Ensiajon testiaineiston muodostusvirheet
ja tyyppivirheet säilyvät erillisinä aiempina hylkäyksinä. Uusi lukija ei vielä
ole mainissa käytössä. Tämä ei hyväksy koko E1:tä, cold-kytkentää tai W7.4:ää.

**Readonly-yhteisvalinnan osanäyttö:** nimetty root-sisääntulo koostaa
poiston vaihelukijan, alkuperäisjournalien jatkolukijan ja build-valinnan.
Ensimmäisen poistojournalihavainnon kaikki slotit, tavut ja identiteetit
verrataan vaihevalintaan ennen muun valinnan tekemistä; saman operaation
myöhempää vaihetta ei omaksuta huomaamatta. Vain v2:n täsmällinen todiste
sallii nimetyn alkuperäisjournalin; v1, vieras palautus tai linkitetty
kohdeprofiilin esi-isä ei saa uutta poikkeusta. Normaali neljän tiedoston
vaikutusajo läpäisi 232 testiä, tyypityksen ja rajatun katselmuksen.
Mukana olivat aktiivisen, passiivisen, viimeisen ja vikatilaisen kohteen
natiivit vaihefixturet, kolmas passiivinen yritys, registry-katko, alkuperäisen
journalin/sidonnan myöhäismuutos sekä pidetty luku ja revoke. Fixture ei
todista vielä payloadin fyysisiä vaiheita, main-varausta tai delete-leasea.
Readonly-kuitti ei anna muutoslupaa. Palvelu-, main- ja prosessirajaportit
sekä koko W7.4:n hyväksyntä ovat edelleen avoinna; aikarajat eivät muuttuneet.

**E2:n yhteiset nykyomistajat:** `WorkspaceManagementService` jakaa nyt
durable-valtuuden ja terminal-kuitin tarkistuksen sekä completion-/release-
virheiden järjestyksen omiin yksityisiin toimintoihinsa. Nykyiset live-
palvelu-/completion-/shutdown-testit läpäisivät 66 tapausta, tyypityksen ja
rajatun katselmuksen. Nimetty staattinen `recoverDeletionBeforeRuntime` on
nyt työpuussa kapeilla valinta-, lease-, jatko- ja sulkuporteilla; alla oleva
main-checkpoint kuvaa sen myöhemmän kytkennän. Se säilyttää alkuperäisen kuitin valinnan uuden delete-
leasen, tuoreen valinnan ja omistajan muodostuksen yli. Virhe päättää
valtuuden ennen siivousta eikä näennäisesti palautuva omistajuus elvytä sitä.
Omistajan `close` odotetaan ennen leasen vapautusta; epävarma close säilyttää
leasen ja ilmoittaa epävarmuuden kutsujalle ennen palvelutehtävän loppua.
Close päättää alkuperäiset luvut ja valtuudet, ei avaa uutta muutoslupaa.
`workspaceDeletionCommand` jakaa vanhan resume-ketjun ja uuden
`resumeSelected`-sisääntulon saman fyysisen vaiheketjun kautta; jälkimmäinen
kopioi journal-sidonnan ennen ensimmäistä odotusta. Sen ohjatut viisi
komentokontrollia ja nykyiset kahdeksan ensivirhekontrollia, tyypitys ja
rajattu katselmus läpäisivät. Stage-portit eivät ole native-/lease-/main-
todiste. Mainin alkuvalinnan täsmällinen luovutus ja omien vaihtuvien
vaiheiden valtuus on vielä kytkettävä alla olevan sopimuksen mukaan;
pelkkää journal-parametria ei tulkita koko cold-admissioniksi. W7.0:n
hyväksytty deleteResume-/cleanup-tapahtumasopimus on nyt desktopin,
backendin, API-clientin ja täyden tukipaketin tiukoissa lukijoissa.
Desktopin normaali vaikutusajo läpäisi 391, backendin kohdeajo 299 ja
API-clientin kohdeajo 151 testiä; kolmen paketin tyypitykset läpäisivät.
Nämä ovat erillisiä osanäyttöjä, eivät koko cold-ketjun hyväksyntä.
Oikea JSONL-kirjoittaja säilytti ensivirheen ja cleanupin erillään,
incident-projektio minimoituna ja writer-virheen yritykset riippumattomina.
Rajattu katselmus ei jättänyt avoimia lähdelöydöksiä; uuden testin
kuukaudenvaihteen kelloriski korjattiin ja jälkitarkistettiin.
Poistokomento havainnoi nykyisten fyysisten vaiheiden aloitukset rajatulle
palvelukuluttajalle. Havaitsijan synkroninen virhe tai odottamaton
Promise-hylkäys ei muuta poistoa tai sen ensivirhettä. Normaali 15 tiedoston
vaikutusajo läpäisi 473 testiä: palvelun ohjatut portit, nykyiset live-/sulku-
ja capability-polut sekä natiivit readonly-valinnat. Natiivissa luovutus-
kontrollissa uusi kuitti varmennettiin itsenäisesti kelvolliseksi, mutta
alkuperäinen kuitti hylkäsi samojen tavujen vaihtuneen tiedostoidentiteetin
ennen komennon aloittamista. Tämä ei ole onnistuneen fyysisen poiston näyttö.
Nykyinen OpenPGP-koe säilytti todellisen palvelun muunnetun virheen sisällä
alkuperäisen synteettisen syyketjun purettuine tavuineen ilman raakavuotoa
julkiseen tulosteeseen. Sen valinta- ja sulkuportit olivat ohjattuja,
eivät oikean mainin, Electronin tai hosted-toimituksen hyväksyntä.
Todellisen main-kytkennän hyväksyntä ja prosessi-/pakettinäyttö
ovat vielä avoinna. Vanhaa deletePreparation-vaihetta ei
käytetä kylmäjatkon korvikkeena. Muut tapahtumaperheet eivät laajene.

**Main-liitoksen valmiit osarajat:** samaan readonly-omistajaan erotettu
`captureWorkspaceDeletionExternalSelectionFromRoot` tarkistaa buildin ja
vieraan recovery-aineiston lukitsematta poiston omia muuttuvia vaiheita.
Census muodostetaan validoidusta, journalin after-tiivisteeseen sidotusta
rekisteristä ennen odotuksia. Täysi admission säilyttää lisäksi alkuperäiset
journal-/rekisteri-/alkuperäistarkistukset ja niiden build/foreign-järjestyksen.
Uusi lukija ei yksin anna admission-, muutos- tai käynnistyslupaa.
Komennon nimetty `beforeMetadata` on erikseen vartioitu ja odotettava raja
ennen metadatasiivoojaa sekä suoraa terminal-viimeistelyä; se ei ole
best-effort-vaihehavainto. Ilman tätä porttia vanha polku ei saa uutta odotusta.
Yhdeksän tiedoston normaali vaikutusajo läpäisi 305 testiä, tyypityksen ja
rajatun katselmuksen. Siirtymän portit ovat ohjattuja; alkuperäiskuitin
todellinen main-sidonta, kaikkien lukujen sulku ja oletuskytkentä puuttuivat
tästä aikaisemmasta osanäytöstä.

**Main-/cold-kytkennän nykytila:** `recoverDesktopWorkspaceDeletion` on nyt
työpuun oletuskäynnistyksessä ennen korjaavaa installation-valmistelua.
Se käyttää samaa palvelua, delete-leasea ja fyysistä poistokomentoa;
none-haara ei rakenna jatko-omistajaa tai aloita poistoa. Läsnä olevan
hylätyn journalin jälkeen ei avata tavallista käynnistystä.
`createWorkspaceDeletionColdContinuation` muodostaa omistajan ilman I/O:ta,
jotta palvelu omistaa sen sulun ennen natiivivalinnan aloittamista.
Alkuperäinen admission-kuitti tarkistetaan myös alustuksen jälkeen.
Metadatan ja suoran viimeistelyn raja tekee viimeisen alkuperäisvertailun
ja revoken; päättyneen työn callback ei anna uutta valtuutta. Sulku odottaa
aloitetut luvut sekä myöhässä palautuneiden kuittien revoken. Epävarma
close/release invalidioi fyysisen main-varauksen ennen pendingin päättymistä.
Vaihehavainto on edelleen best effort, ei metadatasiirtymän valtuus.

Katselmuksen reentrant-lukutyön aukko suljettiin varaamalla handoff ennen
ulkoista vartijakutsua. Sen kielteinen regressio läpäisi. Nykyinen
Main-käynnistys-/palautustiedosto läpäisi 368 testiä. Myöhempi tarkistus-
järjestyksen korjaus käyttää samaa build/foreign/original/foreign/build-
järjestystä kuin täysi cold-admission, ei kahta sisäkkäistä kokonaista
external-kierrosta; 85 kohdetestiä, tyypitys ja rajattu katselmus läpäisivät.
OpenPGP-koe säilytti nykyisen palvelu-/prosessiketjun alkuperäiset synteettiset
syyt puretusta paketista. Ajot ovat osittain päällekkäisiä, eivät summattava
kokonaismäärä tai frozen-revision PR-hyväksyntä.

Oikean prosessikatkon nykyiset neljä 60 sekunnin tapausta säilyvät: authorized-
ja viimeisen vikatilaisen yrityksen uusi omistaja käyttävät nyt mainin
cold-adapteria, kaksi myöhempää katkoa edelleen nykyistä suoraa komentojatkoa.
Cold-tapaukset aikakatkaisivat, suorat jatkot läpäisivät ja kaikkien lasten
loppusulku varmistui. Korjatun tarkistusjärjestyksen yksi nimetty authorized-
todennus aikakatkaisi myös; säilynyt vaihe oli `purged` aiemman
`purgeAuthorized`in sijaan. Tämä osoittaa etenemän, ei viiveen juurisyyn
korjausta. Aineisto säilytetään eikä samaa kokonaiskoetta uusita vihreyden
vuoksi. Seuraava rajattu näyttö erottaa tämän jälkeisen rekisterijulkaisun,
metadatan ja viimeistelyn työmäärän. Aikarajat, muutosvartijat, nykyiset
prosessin spawn-/SQLite-/Electron-kiellot ja W7.5:n suljetut kanavat säilyvät.
Onnistunut cold-prosessiketju, oikea main-/Electron-/pakettiketju ja koko
W7.4:n hyväksyntä ovat edelleen avoinna.

**Tarkistusvastuun jatkorajaus:** rekisterijulkaisun ja loppuviimeistelijän
yksityiset pienet kokeet erottivat lukuvaiheen sisäiset vartijat täydestä
muutosvalinnasta. Rekisterin 20 ja viimeistelijän 34 kontrollia läpäisivät
nykyisillä rajoilla; tuotantolähteet eivät muuttuneet. Täysi alku- ja
loppuvalinta sekä nykyiset native-muutoscallbackit säilyvät ehdokkaissa,
mutta kokonaan lukuvaiheen sisällä ilmestyvä ja täsmälleen palautuva
tila voi jäädä havaitsematta. Tämä ei ole aiemman viiden omistajan
hyväksynnän automaattinen laajennus kahteen uuteen omistajaan.
Seuraava yhteiskatselmus erottaa nykyisen main-varauksen todisteen,
muuttumattoman sisältövalinnan ja kunkin varsinaisen muutosrajan tarkistuksen
ennen uutta kytkentäpäätöstä. Yksityiset mittarit eivät kuulu toimitukseen,
eikä kesto- tai hyväksyntärajoja kasvateta. Kokeiden rajattu lähdekatselmus
ei vielä korvaa alkuperäisen ancestor-identiteetin myöhäismuutoksen,
inventaarion lukuskoopin tai pidetyn I/O:n sulkuvirheen lisäkontrolleja
eikä oikeaa prosessi-/pakettitodennusta. Alla oleva yhteissopimusehdotus
korvaa näiden kahden yksityisen ehdokkaan erillisen edistämisen; kokeet
säilyvät näyttönä, eivät tuotantokytkentälupana.

###### Kylmäjatkon tarkistusvastuiden yhteissopimusehdotus

**2.11.2026: omistaja hyväksyi ensin koesopimuksen ja nyt seitsemän nykyisen
omistajan tuotantokytkennän, pysyvät regressiot ja nykyiset portit.**
Kytkentä on työpuussa, mutta koko cold-ketjua tai W7.4:ää ei ole hyväksytty.
Nykyinen kylmäomistajan `assertOwned` tarkistaa fyysisen varauksen lisäksi
build-/vieras-/alkuperäisvalinnan. Vaihelukija käyttää sitä myös sisäisenä
varausvartijana, joten täydet sisältöluennat kertautuvat. Live-omistajan
samanniminen portti tarkistaa vain omistajuuden. Aiempi pieni mittaus
todistaa kertautumisen, ei vielä koko aikakatkaisun korjausta.

**Valittu ehdotus:** pidä nykyinen täysi portti ja palvelun admission-ketju
ennallaan. Erota saman cold-omistajan nimetty `assertReservationOwned`
fyysiselle varaukselle ja työn eliniälle. Se ei anna sisältö-, poisto- tai
käynnistyslupaa. `assertOwned` säilyttää nykyisen täyden järjestyksen
build -> foreign -> original -> foreign -> build ja omistajuustarkistukset.
Alkuperäiskuitti poistuu edelleen vain nykyisessä `beforeMetadata`-rajassa.
Uuden kevyen portin käyttö ennen alustuksen valmistumista, handoffin aikana,
ensivirheen jälkeen tai suljetussa omistajassa hylätään.

Main-adapteri muodostaa komennolle yhden nimetyn `coldSelection`-porttiparin:
`assertReservationOwned` käyttää saman omistajan kevyttä porttia ja
`assertStableSelection` palvelun välittämää alkuperäistä täyttä `assertOwned`ia.
Molemmat tarkistavat saman palveluvaltuuden ennen odotusta ja sen jälkeen.
Komento kaappaa parin metodit ennen ensimmäistä odotusta; puutteellinen pari
ei saa pudota tavalliseen polkuun. Vain tämän parin kanssa sisäisille
vaiheomistajille annetaan kevyt `assertOwned`, ja täysi tarkistus välitetään
erikseen alla nimettyihin rajoihin. Vanha live-/suora kutsutapa ilman paria
säilyttää nykyisen toimintansa. Ei palvelurajapinnan yleistä keventämistä,
globaalia skip-lippua, sisältötuloksen välimuistia tai tarkistusmanageria.

| Nykyinen tiedosto ja raja | Täysi cold-sisältötarkistus ja säilyvä paikallinen vastuu |
| --- | --- |
| `workspaceDeletionContinuation.ts` | Nykyinen täysi `assertOwned`, uusi rajattu varausportti ja nykyinen pending-/ensivirhe-/sulkuomistaja. Alustus käyttää alkuperäistä fyysistä vartijaa, ei uutta itseään kutsuvaa valintaa. |
| `recoverDesktopWorkspaceDeletion.ts` | Sitoo porttiparin täsmälleen saman palvelukutsun valtuuteen. Alkuperäinen ja tuore admission tarkistetaan edelleen alustuksen jälkeen ennen niiden revokea. |
| `workspaceDeletionCommand.ts` | Täysi tarkistus kokonaisen alkuvalinnan ja vaiheiden rajoilla sekä odotettuna vielä `finalize`n palattua ennen viimeistä synkronista `recordRemoved`-kuittia. Myös suora terminal-haara käy nykyisen odotettavan metadata-handoffin kautta. Kuitin jälkeen ei I/O:ta. |
| `workspaceDeletionPayloadExecutor.ts` | Täysi tarkistus `readRecords`-kierroksen molemmin puolin sekä jokaisen siirron/purgen `assertRowSelected`-muutosvartijassa. Journalin recover/advance saa edelleen täydellisen `consume`-todisteen jokaisessa muutoksessa; tekninen ennen-slottilukua-vartija ei korvaa sitä. |
| `workspaceDeletionRegistryPublication.ts` | `assertAbsent` tekee täyden tarkistuksen koko luennan molemmin puolin. Nykyiset sisäiset poistojournalivertailut säilyvät. Recover/write, slot-poisto ja kansiosync säilyttävät nykyiset täydelliset `beforeMutation`-portit, payload-poissaolon ja slottitodisteen. Jo hyväksytyn next-kirjoittimen write/sync säilyttävät nykyisen synkronisen vartijan; kuittaus ja jälkeen-tila varmennetaan. |
| `workspaceDeletionMetadataCleanup.ts` | Valmistelun kokonaiset lukuryhmät ja `assertPurged` rajataan täydellä tarkistuksella. Jokaisen alkuperäisjournalin ja sidonnan retirement säilyttää tuoreen täyden tarkistuksen, payload-poissaolon, alias-/kohdesidonnan ja muiden journalien valinnan. Pelkkä ennakkoluku ei anna siivouslupaa. |
| `workspaceDeletionFinalization.ts` | `assertPurged` ja `technical.assertExternalSelection` sisältävät täyden tarkistuksen. Alkuperäisten payload-esi-isien havainnot kaapataan kerran vaiheessa täyden tarkistuksen sisällä, ei uudelleen jokaisella tarkistuksella. Recover/advance, inventaarion retirement, kansiosync ja journalin viimeinen clear säilyttävät nykyiset täydet muutoscallbackit. |

Taulukon täysi tarkistus ympäröi kyseisen omistajan koko paikallisen
valinnan. Sisäiset vaiheen/journalin/rekisterin tavut, natiivi-identiteetit,
polkujen containment, tiedostotyypit ja kirjoittajien poissaolo tarkistetaan
edelleen nykyisissä kohdissa. Täysi main-valinta ei lue takaisin poiston
omia muuttuvia vaihe- tai rekisterislotteja. Paikallinen omistaja todistaa
ne. Tämä säilyttää nykyiset loogisen muutoksen portit, ei lupaa uutta täyttä
main-valintaa jokaisen native-kutsun eteen. Jo avatun next-kirjoittimen
`write` ja tiedostokahvan `sync` käyttävät nykyistä synkronista valtuusvartijaa.
Slotin poistossa nykyinen täysi `beforeMutation`, tuore identiteettitarkistus
ja viimeinen synkroninen vartija säilyvät. Kansiosync säilyttää nykyisen
alustakohtaisen toteutuksen ja sitä edeltävän vartijan.
Vain lukevalle alikutsulle ei anneta talteen otettavaa myöhempää muutoslupaa.
Vaiheen ajan säilyvä alkuperäisten esi-isien kuitti pitää saman
natiivi-identiteettivertailun myöhemmissä tarkistuksissa. Sitä ei sidota
ensimmäisen lukuryhmän lopussa vanhenevaan valtuuteen eikä muodosteta
uudelleen muuttuneesta lähtötilasta.
Komennon alkuvalinnan kuitti suljetaan `finally`-rajalla myös silloin, kun
valinnan jälkeinen täysi sisältötarkistus hylkää jatkon.

**Kokeeseen hyväksytty havaintoero:** build-/vieras-/alkuperäisvalinta luetaan koko
lukuryhmän rajoilla ja jokaisessa varsinaisessa muutosvartijassa, ei enää
jokaisen sisäisen fyysisen varauskyselyn sivuvaikutuksena. Täysin ryhmän
sisällä ilmestyvä ja alkuperäisiin tavuihin sekä identiteetteihin palautuva
ulkoinen metadata voi jäädä havaitsematta. Pysyvä muutos tai vaihtunut
identiteetti estää seuraavan muutoksen. Varausta ja kirjoittajien poissaoloa
ei korvata oletuksella, eikä tätä kuvata kaikkien välitilojen jatkuvaksi
valvonnaksi. Päätös koskee tätä havaintorytmiä, ei muiden yritysten
poistovaltuutta. Rekisteri-/viimeistelijäkokeiden omia paikallisia
sisävalintoja keventäviä ehdokkaita ei kytketä samalla.

**Ensivirhe ja sulku:** molemmat portit kuuluvat saman main-omistajan
seuraamiin alkuperäisiin tehtäviin. Ensimmäinen havaittu virhe sulkee
valtuuden ennen siivousta; nielty virhe ei palauta sitä. Close sulkee uudet
pyynnöt synkronisesti, odottaa jo aloitetun fyysisen/sisältötyön ja myöhäiset
kuittien revoket. Handoffin aikana ei saa käynnistää kumpaakaan porttia.
Epävarma sulku ei vapauta delete-leasea tai fyysistä varausta, tyhjennä
epävarmuutta tai käynnistä tavallista runtimea. Aikarajat säilyvät.

**Koe- ja toteutusjärjestys:**

1. Omistajan havaintorytmipäätös ja rajattu synteettinen porttiparikoe
   nykyisissä main-/komentofixtureissä. Todista puuttuva/toistettu/myöhäinen
   portti, alkuperäisen admissionin säilyminen, reentrant handoff ja
   fyysisen sekä sisältöluvun sulku erikseen. Ei uusia runtime-lokittajia.
2. Samassa pienessä natiivissa registry-/terminal-fixturessa erittele
   fyysiset vartijat ja varsinaiset sisältöluennat. Todista, ettei yhden
   luennan sisäinen vartijamäärä kerro mainin täydellisiä lukukierroksia.
   Vertaa koko lopputilaa ja säilyviä tiedostoja, älä vain laskuria tai aikaa.
3. Katkaise tai muuta build, vieras journal, alkuperäissidonta ja valtuus
   nimetyissä täydellisen muutosvartijan rajoissa. Kaikkien kolmen
   metadataomistajan slot-poistot ja kansiosyncit sekä terminalin molemmat
   reitit kuuluvat matriisiin. Jo avatun next-kirjoittimen write/sync
   testataan nykyisen synkronisen valtuussopimuksen mukaan, ei uutena
   täydellisen sisältöluvun rajana. Todista myös esi-isän vaihto payloadin yhä
   puuttuessa sekä täysin palautuva välitila vertailukontrollina. Säilytä
   todettu ensivirhe myös pidetyn I/O:n ja erillisen sulkuvirheen yli.
4. Yksi yhteinen katselmoitu delta ja vasta koenäytön jälkeen nimetty
   tuotantokytkentäpäätös. Nykyiset live-, suora jatko-, normal-startup-,
   recovery- ja tyypitysregressiot säilyvät. Erillistä yksityistä muunninta
   tai mittaria ei toimiteta. Jos pieni koe ei erottele hyötyä tai vartijan
   kattavuutta, pysähdy tulokseen; älä jatka omistaja kerrallaan pitkään ajoon.
5. Vasta tämän jälkeen yksi korjausrevision nimetty oikea cold-prosessikoe
   nykyisessä 60 sekunnin rajassa. Epäonnistuminen säilytetään. Tämä eikä
   pieni luentakoe korvaa SQLite-/Electron-/hardened-paketti-, loppukatselmus-
   ja PR/main-portteja. Vanhat aikakatkaisut jäävät avoimiksi havainnoiksi.

Tämä ehdotus ei muuta levyformaattia, backup-yhteensopivuutta, riippuvuuksia,
hyväksyttyjen pakettien toimintoja tai W7.5:n suljettuja kanavia.

**Rajattu koenäyttö:** omistajuuskokeen 33, mockattujen komentovaiheiden 24,
natiivin rekisterifixturen 19 ja viimeistelijätiedoston 35 testiä läpäisivät
nykyisillä rajoilla. Erillinen myöhäisen terminal-julkaisun kontrolli läpäisi;
sen muut tapaukset olivat valitsemattomia, eivät läpäisyjä. Neljän vain
muistiin ladatun runtime-ehdokkaan tyypitys läpäisi nykyistä työtilaa vasten
yhdellä vastaavasti täsmennetyllä fixturellä. Alkuperäiset lähteet eivät
muuttuneet. Rajatun katselmuksen erottavat lisäkontrollit on tehty.
Tämä ei vielä todista palvelun porttiparisidontaa, payload-/metadatavaiheiden
yhteistä muutosmatriisia tai todellista mainin sisältötodistusta.
Koemuuntimen ja tyypitysvalmistelun ensihylkäykset säilyvät erillisinä
valmistelutuloksina, eivät sovellusvirheinä tai jälkikäteen läpäisyinä.
Tuotantokytkentä ja pitkän cold-ketjun hyväksyntä ovat edelleen avoinna.

Yhdistetty seitsemän tiedoston ehdokas läpäisi 33 valittua kontrollia, mutta
kuusi tapausta hylättiin; 50 jäi tarkoituksella valitsematta. Täyden
julkaisufixturen valmistelu vei pääosan kolmen uuden payload-kontrollin budjetista.
Pienempi nykyinen natiivi tilafixture erotti niiden varsinaiset virherajat
ilman aikarajan nostoa. Journalin native-virhemuunnoksen yli säilyvä ensisyy
ja kääreen synkroninen valtuussopimus korjattiin koeehdokkaassa; sen seitsemän
erottavaa kontrollia läpäisivät. Koefixturen virheellinen odotuskenttä ja
ensihylkäykset säilyvät erillisinä, eivät jälkikäteen läpäisyinä.
Kolme vanhaa V2-metadataketjua aikakatkaisi. Yksi muuttumattoman lähteen
vertailu ja yksi sallittu vaiheittain havaittu kohdeuusinta läpäisivät,
mutta ne eivät todista ensimmäisiä viiveitä korjatuiksi. Puuttuvat
sidontapoistojen molemmat reitit, uusien lukuryhmien havaintoerot ja aidon
mainin sisältövalinnan yhteiskoe jäävät seuraaviksi kokeiksi. Tuotantolähteet,
aikarajat ja koko integraation hyväksyntäehdot eivät muuttuneet.

Myöhempi kahdeksan sidontapoistokontrollin ajo läpäisi molemmat metadatareitit
sekä current-, backup-, next- ja kansiosync-rajat. Kymmenen lukuryhmäkontrollia
erotti pysyvän ja täysin palautuvan ulkoisen tilan mallin payload- ja
metadatavalmistelussa. Palautuvan tilan koe päättyy lukuryhmän todistukseen,
ei väitä koko metadatavaihetta onnistuneeksi. Kolme aidon main-, palvelu-,
omistaja-, komento- ja natiivivarausketjun koetta sekä erillinen alkuperäisen
V2-sidonnan muutoskoe läpäisivät. Ne todistavat aidon sisältömuutoksen
hylkäyksen ennen muutoksia sekä ensisyyn ja pidetyn työn sulun erottamisen.
Kokeet eivät korvaa onnistuvaa koko cold-ketjua, eivät sulje aiempia
aikakatkaisuja eivätkä itsessään hyväksy tuotantokytkentää. Rajattu riippumaton
katselmus ei löytänyt uutta puutetta. Pidetyn työn natiivi sulkuvirhe syntyy
samasta ensisyystä; erillisen toisen sulkuvirheen aiempi ohjattu koe on eri
näyttö, eikä näitä kuvata yhdeksi natiiviksi kaksoisvirhekokeeksi.

Omistajan hyväksymä seitsemän tiedoston kytkentä on nyt työpuussa pysyvine
regressioineen. Rajattu tuotantodeltan katselmus varmisti myös valintakuitin
sulun; puuttuneet neljä adapterikontrollia lisättiin. Testivalmistelun
seuraamatta jäänyt promise korjattiin nykyiseen sulkumalliin. Sen järjestys
todennettiin suoralla kontrollilla ja vanhan puutteen palauttavalla
kielteisellä kokeella. Viimeinen koko vaikutusalueen ajo ei läpäissyt:
214 testiä läpäisi, kahdeksan aikakatkaisi. Kohde- ja salaus-/purkutodennukset
eivät sulje näitä aikakatkaisuja tai hyväksy koko cold-/paketti-/PR-ketjua.

**Hyväksytty kertamittaus, ei pysyvää rajamuutosta:** viiden oletusrajaisen
yhdistelmätestin mittausraja oli 5 -> 10 sekuntia: `PayloadExecutor`in pidetyn siirron sulku,
`Finalization`in proof-only-payload ennen inventaarion poistoa,
`RegistryPublication`in `beforePublication`-jatko sekä `MetadataCleanup`in
preflight-vartijoiden erottelu ja palautuvan välitilan kontrolli.
Kolmen V2-metadataketjun (`workspaceLegacyAdoption`, `workspaceReplacement`,
`workspaceActivationMigration`) mittausraja oli 30 -> 45 sekuntia.
Omistaja hyväksyi vain yhden nimetyn kokeen, ei pysyvää rajaa tai uusintaoikeutta.
Lähteet osoittavat preflight-kontrollien sisältävän koko siivousketjun;
alkuperäisen budjetin vertailutesti läpäisi rajatun vaihemittauksen.
Mittarin oma ensimmäinen hylkäys on valmisteluvika, ei sovellusvika.
Tuotannon määräajat, sisältö-/omistajuussuojat ja CI:n kokonaisrajat säilyvät.
Kaikki kahdeksan mittaustapausta läpäisivät ja valmistuivat tällä kertaa
myös aiempien rajojensa sisällä. Mittaus ei todista aiempien aikakatkaisujen
syytä tai pysyvän rajamuutoksen tarvetta. Erilliset 80 palvelu-, virhetieto-,
journal-valinta- ja jäännösregressiota läpäisivät nykyisillä rajoilla.
Sitä seurannut yksi uuden kytkennän `authorized`-cold-prosessikoe hylättiin
60 sekunnin rajaan. Säilynyt terminal-journal ja julkaistu kohteeton rekisteri
erottavat sen alkuvalinnan hylkäyksestä; inventaario on vielä paikallaan.
Lasten sulkutapahtumat eivät yksin todista koko poistoa tai natiivivarauksen
vapautumista. Aineisto säilytetään; seuraava rajaus on nykyinen viimeistely,
ei automaattinen uusinta, aikarajan nosto tai koko cold-ketjun hyväksyntä.

###### Terminal-inventaarion luentavastuun ehdotus

**Omistaja hyväksyi 2.11.2026 suunnittelun, pienet kokeet ja myöhemmin kahden
nykyisen omistajan tuotantokytkennän, pysyvät regressiot ja nykyiset portit.**
Kytkentä on työpuussa; tämä ei hyväksy koko cold-ketjua tai W7.4:ää.
Lähdeanalyysi ja yksi pieni nykyisen
terminal-fixturen kontrolli erottivat teknisen inventaarioluennan sisäisen
vartijatyön. Kontrolli aikakatkaisi nykyiseen oletusrajaansa; osittainen
havainto ei todista koko viimeistelyn tai cold-aikakatkaisun syytä.
Ehdotus koskee vain `retireWorkspaceDeletionInventory`n sisältä tehtävää
muuttumattoman inventaarion takaisinlukua, ei koko viimeistelijän vartijoita.

- Täysi main-valinta ja metadatan poissaolotodiste suojaavat kokonaisen
  takaisinluvun molempia rajoja. Sisäiset luvut säilyttävät työluvan,
  kirjoittajien poissaolon ja saman journal-/rekisterivalinnan tarkistukset.
  Nykyinen hash-, koko-, nimi-, tiedostotyyppi- ja identiteettitarkistus säilyy.
- Jokainen varsinainen poisto, kansiosync ja journalin viimeinen clear käyttää
  nykyisiä täydellisiä muutosvartijoita. Lukutulos ei anna poistovaltuutta.
  Muut kutsujat säilyttävät nykyisen oletuksensa; ei yleistä skip-lippua.
- Vain koko luennan sisällä ilmestyvä ja täsmälleen ennalleen palautuva
  ulkoinen metadata voisi jäädä havaitsematta. Pysyvä muutos estää jatkon
  ennen muutosta. Tämä on erillinen havaintorytmipäätös, ei seitsemän
  omistajan aiemman hyväksynnän automaattinen laajennus.
- Ensimmäinen lupa kattoi vain suunnittelun ja pienet muutos-, keskeytys- ja
  tiedostosäilytyskokeet. Myöhempi kytkentälupa kattaa pysyvät regressiot,
  katselmuksen ja yhden nimetyn cold-prosessikokeen nykyisessä 60 sekunnin
  rajassa. Aikarajoja ei muuteta. Aiempia muita ehdokkaita ei kytketä
  tämän päätöksen tai pelkkien kutsumäärien perusteella.

**Koesopimus nykyisissä omistajissa:** `retireWorkspaceDeletionInventory`
saa yhden erillisen, täsmällisen vain luku -kontekstin. Sen metodi kaapataan
ennen ensimmäistä odotusta. Puutteellinen tai ylimääräisiä kenttiä sisältävä
konteksti hylätään, ei ohiteta oletuspoluksi. Alussa valittu terminal-currentin
tavu- ja identiteettitodiste pysyy voimassa myös sisäisessä luennassa.
Kevyt callback kelpaa vain odotettavan `WorkspaceDeletionInventoryStore.inspect`in
ajan; sen jälkeen kutsu hylätään. Koko luennan täydet alku-/loppuvartijat
ja varsinaiset muutoscallbackit säilyvät erillisinä. Muu inventaariotallennin
ja journalin viimeinen clear eivät saa uutta kevyttä muutosporttia.
`workspaceDeletionFinalization` välittää kontekstin vain nykyisen cold-parin
kanssa. Se käyttää saman vaiheen `assertSelected`ia: varaus, kirjoittajat,
journal ja rekisteri pysyvät alkuperäisessä valinnassa. Oletuskutsuja ei
muuteta. Kokeen mallinnettu main-valinta ei korvaa oikeaa main-/cold-porttia.

**Rajattu koenäyttö:** kahden nykyisen omistajan vain muistiin ladattu
ehdokas läpäisi 25 kontrollin sarjan. Erilliset kaksi oikean avoimen
inventaarion luku-/sulkukeskeytystä sekä koko desktop-projektia vasten tehty
ehdokkaan tyypitys läpäisivät. Muuttumattoman toteutuksen tavallisen kutsun
vertailu läpäisi ja sen vartijajärjestys vastasi ehdokkaan oletuspolkua.
Native-poistojen ja syncien vartijat sekä inventaarion poissaolotarkistuksen
toteutus säilyivät muuttumattomina. Rajattu riippumaton lähdekatselmus ei
löytänyt uutta puutetta. Ensimmäisen koefixturen väärä tapahtumasilmukkakutsu
aiheutti yhden aikakatkaisun; se erotettiin sovelluksesta ja korjattu
keskeytyskontrolli läpäisi samalla oletusrajalla. Ensihylkäys säilyy.
Koe vähensi toistuvaa raskasta valintatyötä vain nimetyssä luennassa.
Se ei todista koko cold-aikakatkaisua korjatuksi. Hyväksytty tuotantokytkentä
on nyt työpuussa. Nykyinen terminal-fixture jaetaan vanhojen ja uusien testien
kesken ilman sen rungon muutosta; vanhat testit säilyvät. Tyypitys läpäisi
testien siirron importti- ja validointipuutteiden korjaamisen jälkeen.
Pysyvien regressioiden normaali kahden tiedoston ajo tuotti 60 läpäisyä ja
yhden tavallisen viimeistelypolun 30 sekunnin aikakatkaisun. Kaikki uuden
luentakontekstin 22 kontrollia läpäisivät. Aikakatkaisseen tapauksen yksi
sallittu erillisdiagnoosi läpäisi samalla lähteellä ja rajalla; omistaja
hyväksyi rajatun etenemisen, ei ensihylkäyksen sulkemista. Sen aineistossa
inventaario oli poistunut mutta terminal-journal säilyi. Rajattu pysyvien
testien katselmus ei löytänyt uutta puutetta. Nykyinen OpenPGP-keräys-,
salaus- ja purkukoe säilytti alkuperäiset synteettiset virheet.

Tämän jälkeen yksi nimetty `authorized`-cold-prosessikoe aikakatkaisi
nykyisessä 60 sekunnin rajassa. Sen aineistossa kohde puuttuu julkaistusta
rekisteristä, mutta terminal-journal ja inventaariotiedosto ovat jäljellä.
Molempien lasten sulkutapahtumat eivät todista koko poiston valmistumista
tai keskeytyksen jälkeistä natiivivarauksen vapautumista. Kyse on uudesta
hyväksyntäesteestä, ei aiemman tapauksen etenemispäätöksen kattamasta uusinnasta.
Main-valinnan, vaihe-/rekisterivartijoiden, inventaarion poiston ja journalin
loppusiivouksen yhteinen rajattu lähdekatselmus on tehty. Säilynyt tila ei
yksilöi odottavaa kutsua tai todista yhtä juurisyytä. Aineisto säilytetään;
muuttumatonta cold-koetta ei uusita eikä aikarajoja nosteta.
Koko cold-/paketti-/PR-ketjun hyväksyntä on avoinna.

###### Viimeistelyketjun yhteiskatselmus ja mittaussopimus

**2.11.2026: lähdekatselmus valmis, ajonaikainen syy avoin.** Rajattu
riippumaton tallenninkatselmus ei löytänyt suoraa lukkiutumista tai osoitettua
oikeellisuusvirhettä. Nykyinen inventaarioluennan kevennys ei muuta sitä
ympäröiviä nimen-, identiteetin- ja muutosvartijoita. Journalin viimeisessä
poistossa täydet metadata- ja inventaarion poissaolotarkistukset kertautuvat
erikseen. Journalin muuttuvat slotit kuuluvat edelleen tallentimelle;
niitä ei saa korvata ulkoisen vartijan vanhalla slot-valinnalla.

Inventaariotiedoston puuttuminen ei todista sen kansion loppusiivousta tai
journalin clear-kutsun alkamista. Windowsin `syncDirectory` tarkistaa
vartijan ennen alustakohtaista paluutaan: metodin keskeneräisyys ei yksin
osoita käyttöjärjestelmän flush-odotusta. Prosessitestin nykyinen 60 sekunnin
raja kattaa valmistelun, ensimmäisen julkaisun, vanhan lapsen katkaisun ja
sulun sekä uuden omistajan koko jatkon ja jälkitarkistukset.

Seuraava rajattu työ koskee vain nykyistä testiapuria ja yksityistä koetta:

1. Nykyinen viimeistelyfixture erottaa inventaarion ollessa vielä paikallaan
   ja sen jo poistuttua tehtävät jatkot sekä oletus- ja cold-valintakutsujan.
   Oikean cold-prosessin valintakustannusta ei päätellä mallinnetusta callbackista.
2. Rajattu muistihavainto erottaa kutsun alun, vartijan valmistumisen,
   tiedosto-operaation alun ja työn päättymisen. Se kattaa inventaarion
   takaisinluvun, poiston, kansiosiivot ja journalin clear-/jälkitarkistukset.
   Sisäkkäisiä kestoja ei lasketa yhteen kokonaisajaksi. Jo sidotut metodit
   otetaan huomioon; puuttuva havainto ei tarkoita puuttuvaa työtä.
3. Pienet kontrollit todistavat saman kutsujärjestyksen, vastaanottajan,
   argumentit, alkuperäisen tuloksen/virheen sekä odottavan työn sulun.
   Havaitsija ei lisää odotettavaa kirjoitusta, ylimääräistä tiedostolukua
   tai muuttunutta valtuutta. Sen oma virhe ei korvaa ensivirhettä.
   Aikakatkaisun osahavainto ja kaikkien töiden jälkeinen sulkutulos erotetaan.
4. Käytetään nykyisten nimettyjen testien rajoja; yhden testin poikkeusta ei
   kopioida uuteen tapaukseen. Ei uutta loggeria, testialustaa tai pitkää
   muuttumatonta cold-uusintaa. Myöhempi prosessitodennus edellyttää uutta
   yksilöivää näyttöä ja koko testiajan vaiheistusta ennen käynnistystä.

Tuloksena pitää olla yksi näytöllä rajattu korjauskohde tai täsmällinen
päätösraportti, ei uusi sarja yksittäisiä vartijakevennyksiä. Katselmus ei
hyväksy tarkistusten yhdistämistä, aiemman tuloksen välimuistia, kevyen
luentaportin laajentamista muutosvartijaan tai journalin clear-polkuun eikä
Windowsin sync-vartijan ohitusta. Havaintorytmiä muuttava ehdotus tarvitsee
oman rajauksen ja päätöksen. Aikarajat ja kaikki nykyiset turvatarkistukset
säilyvät; tässä katselmuksessa ei ajettu uusia sovellustestejä.

**Rajattu vaihemittaus 2.11.2026:** nykyinen fixture erottaa nyt inventaarion
ja journalin loppuvaiheet sekä niiden vartija- ja tiedostokutsut vain
testiajon muistissa. Mittarin katselmuksen kaksi puutetta korjattiin:
nuolifunktioina määritellyt muutosvartijat ovat mukana ja Promise-havainnon
liittämisen virhe ei korvaa alkuperäistä paluuarvoa. Yhdeksän muistipohjaista
kontrollia läpäisi; kaksi fixturen sulkukontrollia läpäisivät myös lopullisella
mittarilla. Kuuden muunnetun moduulin rakenteellinen vertailu varmisti, että
havaintokääreiden poistamisen ja metodisyntaksin normalisoinnin jälkeen
ohjelmarakenne vastaa alkuperäistä. Tämä ei todista mittaamattoman ajon kestoa.
Ensimmäinen kuuden tapauksen mittaus tuotti yhden läpäisyn ja viisi
oletusrajan aikakatkaisua. Korjattu havaintokytkentä tuotti kaksi läpäisyä
ja neljä aikakatkaisua samassa oletusrajassa. Ensimmäistä tulosta ei korvata.

Katkaisuhavainto erottaa valintatarkistuksen sisällä odottavan slot-luennan
inventaarion siivouksesta, sen jälkitarkistuksesta ja journalin clearista.
Havaituissa katkaisuissa native-poistokutsu ei ollut kesken; tämä ei nimeä
yleistä tiedostojärjestelmävikaa eikä aiemman cold-prosessitestin syytä.
Kaikki havaittu työ päättyi fixturen sulussa ja epäonnistunut aineisto säilyi.
Rajattu tapahtumaotos ei ole täydellinen jälki; mallinnettu cold-valinta ei
ole oikea main-valinta, eikä mittarilla ajettu kesto ole mittaamattoman
sovelluksen suorituskykylupaus. Tuotantolähteet ja testirajat säilyivät.
Katselmuksen korjaustarkistus ei löytänyt uutta mittarin puutetta.

**Omistaja hyväksyi rajatun suunnittelun ja pienet kokeet 2.11.2026:** rajataan terminalin
metadata-poissaololuennan sisäinen rekisterivalinnan uusintaluku erikseen
kokonaisen luennan täydestä alku- ja loppuvalinnasta. Varaus, kirjoittajien
poissaolo, tiedostoidentiteetit ja kaikki varsinaisten muutosten nykyiset
täydet vartijat säilyisivät. Luennan sisällä ilmestyvä ja täsmälleen
ennalleen palautuva ulkoinen rekisterivalinnan muutos voisi jäädä havaitsematta;
pysyvä muutos estäisi jatkon. Tämä on nimetty havaintorytmipäätös, ei tavallinen
testiajolupa tai tämän mittauksen automaattisesti hyväksymä optimointi.
Lupa koskee vain suunnittelua ja pieniä kokeita, ei tuotantokytkentää, uusia
aikarajoja tai pitkää cold-ajoa.

**Kokeen toteutussopimus:** ehdokas muuttaa vain nykyisen viimeistelijän
paikallisia callbackeja testiajon muistissa. Cold-parin terminal-tekninen
vartija säilyttää nykyiset täydet main-valinnat ja luennan molempien reunojen
rekisterivalinnat. Sisäinen callback tarkistaa nykyisen vaiheen valtuuden,
omistajuuden, kirjoittajien poissaolon ja omistajuuden uudelleen. Se kelpaa
vain odotetun metadata-poissaololuennan ajan ja hylätään sen päätyttyä.
Metadatan tiedosto-, nimi-, sisältö- ja identiteettitarkistukset sekä
alkuperäispayloadin erilliset poissaolotodisteet säilyvät. Journalin muuttuvia
slotteja ei kiinnitetä ulkoisessa callbackissa uudelleen.

Tavallinen kutsuja, ei-terminal-vaiheen `assertPurged`, muut metadatalukijat
ja varsinaisten tiedostomuutosten vartijat eivät muutu. Pienet kokeet
erottavat natiivin pysyvän rekisterimuutoksen mallinnetusta, täysin palautuvasta
näkyvyysmuutoksesta; jälkimmäistä ei väitetä todelliseksi tiedostoidentiteetin
palauttamiseksi. Lisäksi kokeillaan molemmat terminal-inventaarion tilat,
alkuperäistodisteellinen aineisto, myöhäinen callback, omistajuuden menetys,
keskeneräinen luku ja muiden yritysten säilyvät sidonnat. Nykyisiä nimettyjä
aikarajoja ei siirretä uusiin tapauksiin. Ennen jatkopäätöstä tarvitaan
ehdokkaan tyypitys, rajattu riippumaton katselmus ja todistus lähteiden
muuttumattomuudesta; tämä ei vielä ole tuotanto- tai cold-prosessinäyttö.

**Kokeen tulos:** yhden tiedoston ehdokas on vain testiajon muistissa.
Koko desktop-projektia vasten tehty ehdokkaan tyypitys läpäisi. Ensimmäisen
rajatun sarjan 14 tapausta läpäisi ja yksi vieraan yrityksen sidonnan sisältävä
koko viimeistelyketju aikakatkaisi oletusrajaan. Sen yksi sallittu
erillisdiagnoosi aikakatkaisi samalla ehdokkaalla ja samalla rajalla.
Kumpaakaan hylkäystä ei korvata läpäisyllä tai uudella yrityksellä.

Erilliset seitsemän tarkennettua kontrollia läpäisivät. Ne erottavat sisäisen
omistaja-/kirjoittajavartijan, loppureunan rekisterivalinnan, callbackin
vanhenemisen operaation vielä jatkuessa ja keskeneräisen työn sulun.
Neljä tarkoituksella puutteellista koeehdokasta hylättiin odotettuihin
väittämiin. Muuttumattoman oletuspolun vertailu läpäisi. Muiden yritysten
sidonnan tarkat tavut säilyivät yhden kokonaisen metadataluennan kontrollissa;
tämä ei korvaa aikakatkaissutta koko ketjua. Sarjojen kattavuus on osittain
päällekkäinen, eikä läpäisymääriä lasketa yhteen kokonaisnäytöksi.

Riippumaton lähdekatselmus ei löytänyt ehdokkaasta puutetta; sen osoittamat
neljä testiväitteen aukkoa korjattiin ja todennettiin. Tuotantolähteet,
ei-terminal-vaihe, alkuperäistodisteet ja varsinaisten muutosten koodi
säilyivät. Kaikki havaittu työ päättyi ja aikakatkaisujen aineisto säilyi.
Säilynyt terminal-journal ja poistunut inventaario eivät yksilöi odottavaa
kutsua tai todista koko poistoa onnistuneeksi.

**Omistajan hyväksymä yksi budjettimittaus läpäisi:** vain uuden vieraan
sidonnan koko ketjun kokeen raja oli 10 sekuntia. Sama ehdokas suoritti
inventaarion viimeistelyn, journalin loppusiivouksen ja vieraan sidonnan
tavu-/identiteettivertailun. Alkuperäiset sisältöväittämät säilyivät.
Työ päättyi ennen siivousta ja tuotantolähteet säilyivät muuttumattomina.
Mittaus ei sulje aiempia aikakatkaisuja, muuta pysyvää testirajaa tai todista
oikeaa main-/cold-/SQLite-/Electron-/pakettiketjua hyväksytyksi.

**Omistajan hyväksymä jatko:** tämän yhden viimeistelijän rajattu
tuotantokytkentä sekä pysyvät regressiot ja nykyiset vaikutusalueen portit.
Vain `workspaceDeletionTerminalMetadataReadSelection.test.ts`:n uuden
`preserves foreign binding bytes and identity across the whole terminal chain`
-regression nimetty testibudjetti on 10 sekuntia. Muiden testien,
sovelluksen ja CI:n rajat säilyvät. Kohderegressioiden, tyypityksen ja
rajatun katselmuksen läpäistyä jäädytetään lähde ja tehdään yksi nimetty
paikallinen `authorized`-cold-prosessitodennus nykyisessä 60 sekunnin rajassa.
Hyväksytty luennan havaintoero säilyy, samoin kaikkien varsinaisten muutosten
täydet vartijat. Vanhat hylkäykset säilyvät avoimina; tämä ei hyväksy koko
W7.4:ää tai mergepoikkeusta.

**Tuotantokytkennän kohdetodennus 3.11.2026:** yhden viimeistelijän muutos ja
pysyvät regressiot ovat työpuussa. Tuotantototeutus vastaa katselmoitua
ehdokasta rakenteellisesti; tyypitys ja rajattu riippumaton lähdekatselmus
läpäisivät. Kolmen kokonaisen kohdetiedoston sarjassa 74 testiä läpäisi ja
yksi uusi `completes cold terminal metadata reading with inventory present.v2`
-tapaus aikakatkaisi viiden sekunnin oletusrajassa. Sen yksi sallittu
erillisdiagnoosi aikakatkaisi samalla jäädytetyllä lähteellä ja rajalla.
Vieraan sidonnan erikseen hyväksytty 10 sekunnin koko ketju läpäisi.

Molempien epäonnistumisten aineisto säilyy ja fixturen omistama työ on
odotettu sulussa. Journal ja inventaario puuttuvat jälkihavainnossa; tämä
ei todista kaikkien lopputarkistusten valmistumista tai ajonaikaista syytä.
Pitkän prosessitodennuksen lupaa ei ole käytetty, eikä kohdesarjaa ole
hyväksytty. Tätä seurannut ehdotus koski vain uuden `present.v2`-tapauksen
yhtä 10 sekunnin vaihemittausta samoilla väittämillä. Pysyvää rajamuutosta,
uutta muuttumatonta uusintaa tai cold-kokeen käynnistämistä ei päätellä
tästä hylkäyksestä. Aiemmat hylkäykset säilyvät avoimina.

Vaihemittauksen valmistelun ja nykyisen yksityisen mittarin 12 pientä
kontrollia läpäisivät. Havaintolisäysten poistaminen palauttaa alkuperäisen
testin täsmälliset tavut ja vain aiemmin nimetty vieraan sidonnan budjetti
säilyy poikkeuksena. Nämä kontrollit eivät yksin ole varsinaisen
testikytkennän ajonaikainen todennus.

**Rajattu kertatodennus:** omistajan hyväksymä `present.v2`-koe läpäisi.
Tämä ei sulje ensihylkäyksiä tai muuta pysyviä testirajoja. Seuraavaksi
ehdotetaan vain uuden `completes cold terminal metadata reading with inventory present.v2`
-testin pysyvää 10 sekunnin budjettia ja nykyisten kohdeporttien todennusta.
Kertakokeen lupa ei hyväksy tätä pysyvää rajamuutosta.

**Omistajan hyväksymä jatkoselvitys:** ennen pysyvää budjettipäätöstä
tutkitaan inventaarion luetteloluennan ja journalin viimeistelyn kaksi
nimettyä tarkistustoistoa pienillä kokeilla nykyisessä testipohjassa.
Varsinaisten muutosten täydet vartijat, omistajuus, tiedostoidentiteetit,
ensivirheen säilyttäminen ja keskeneräisen työn sulku säilyvät vaatimuksina.
Myös mahdollinen havaintorytmin ero tehdään näkyväksi; kokeen läpäisy ei
hyväksy sitä tuotantoon. Ei uutta kehystä, pysyvää aikarajamuutosta tai
pitkää kokonaisajoa tällä luvalla.

**Kokeiden hyväksyntätila:** ehdokkaiden tyypitys, rajatut vertailu- ja
virhekontrollit sekä yhdistetty kohdetodennus läpäisivät nykyisillä rajoilla.
Koetestien katselmuksessa osoitetut väitepuutteet korjattiin; tarkennetut
kontrollit erottavat myös tarkoituksella puutteelliset vartijat.
Ensimmäinen koetestin hylkäys säilyy omana tuloksenaan. Tämä ei ole
tuotantokytkentä, pysyvä rajamuutos, koko cold-ketjun tai W7.4:n hyväksyntä.

**Omistajan hyväksymä rajattu tuotantosopimus:**

1. `workspaceDeletionInventoryRetirement.ts`: yhteisen `readNames`-luennan
   täydet alku- ja loppuvalinnat sekä kansioidentiteetit säilyvät. Luennan
   sisäinen päällekkäinen välivalinta poistuu molemmista nykyisistä
   kutsutavoista. Varsinaisten poisto-, kansio- ja synkronointikutsujen
   nykyiset täydet vartijat säilyvät muuttumattomina.
2. `workspaceDeletionFinalization.ts`: vain journalin loppupoistoon annettava
   fyysisen poissaolon lukija käyttää luennan ajan omistajuus-, kirjoittaja-
   ja valtuustarkistusta. Nykyinen journalin tallennin omistaa edelleen
   täydet ulkoiset tarkistukset lukijan molemmin puolin ja jokaisen muutoksen
   vartijat. Muut poissaolokutsut, yhteinen tallennin ja sen rajapinta eivät
   muutu. Lukijan valtuus vanhenee sen päätyttyä; muuttuvia journalslotteja
   ei kiinnitetä ulkoisessa vartijassa uudelleen.

Ehdotuksen havaintoero on nimenomainen: ulkoinen metadata, joka muuttuu ja
palautuu täysin saman pelkän lukuvaiheen sisällä, voi jäädä havaitsematta.
Pysyvä muutos estää jatkon. Varsinaiset tiedostomuutokset säilyttävät tuoreen
täyden valinnan, eikä lukutulos itsessään anna poistolupaa. Omistajuuden
menetys, palannut aineisto, identiteettimuutos, ensivirheen säilyttäminen ja
keskeneräisen työn sulku kuuluvat pysyviin regressioihin ennen kytkentää.
Ei välimuistia koko operaatiolle, uutta yleistä kehystä tai aikarajamuutosta.
Omistajan hyväksyntä kattaa kytkennän ja pysyvät regressiot; nykyiset
vaikutusalueen portit vaaditaan edelleen ennen lähdejäädytystä ja jo
hyväksyttyä yhtä prosessitodennusta. Työpuussa oleva kytkentä ei yksin
ole tämän tai koko W7.4:n hyväksyntänäyttö.

Nykyinen hyväksytty rajattu havaintorytmiero säilyy: täysin luennan sisällä palautuva
ulkoinen rekisterimuutos voi jäädä havaitsematta, pysyvä muutos estää jatkon.
Todelliset tiedostomuutokset säilyttävät täydet vartijansa. Koko cold-ketjun,
paketoinnin ja PR/main-porttien näyttö vaaditaan edelleen ennen W7.4:n
hyväksyntää; kokeen läpäisy ei anna mergepoikkeusta tai lupaa pitkään uusintaan.
**Nykyisen kytkennän portit:** pysyvät kohderegressiot, vaikutusalueen
testit, tyypitys ja rajattu riippumaton katselmus läpäisivät. Tämän jälkeen
lähteet jäädytettiin ja hyväksytty yksi nimetty `authorized`-cold-prosessikoe
tehtiin nykyisessä 60 sekunnin rajassa. Koe aikakatkaisi; kertalupa on
käytetty eikä uutta muuttumatonta ajoa tai rajojen nostoa tehdä.
Lähteiden muuttumattomuus varmennettiin jälkikäteen. Jälkihavainnossa
kohde, inventaario ja journal puuttuvat ja molempien lasten sulku kirjautui,
mutta tämä ei todista kaikkien lopputarkistusten, loppukuittauksen tai
keskeytyksen jälkeisen natiivivarauksen vapautumisen onnistumista.
Kesken jäänyt kutsu ei yksilöidy nykyisestä aineistosta. Seuraava rajaus
koskee loppuvaiheen erottelua nykyisillä havainnoilla, ei uutta yleistä
diagnostiikkakerrosta. Koko cold-ketjun ja W7.4:n portit säilyvät avoimina.

Prosessifixturen nykyinen sulkuraportti on tämän jälkeen täydennetty:
keskeytyshetken vanhemman odotukset, vastaanotettujen tapahtumien nimet
sekä todellinen sulkukoodi ja signaali säilyvät samassa yksityisessä
raportissa. Valmistumisviesti ei korvaa sulkua eikä kumpikaan todista
natiivivarauksen vapautumista. Raakoja IPC-sisältöjä ei kopioida havaintoon.
Rajatut kontrollit, raporttitavujen tarkistus, tyypitys ja katselmus
läpäisivät; sovelluskoodia tai aikarajoja ei muutettu. Vanhaan ajoon
puuttunutta havaintoa ei voi palauttaa jälkikäteen. Mahdollinen uusi
nimetty diagnoosi tarvitsee oman ajopäätöksen; raportointikorjaus ei
nollaa käytettyä kertalupaa tai hyväksy aiempaa hylkäystä.
Omistaja on nyt hyväksynyt yhden uuden nimetyn diagnostisen kokeen nykyisessä
rajassa; sen tulos pidetään erillään aiemmasta hylkäyksestä.
Tämä diagnoosi aikakatkaisi odotettaessa valmistumisviestiä lapsen ollessa
yhä käynnissä. Pelkkä normaalin prosessisulun odotus ei siis ollut sen
keskeytyskohta. Vain lukeva natiivivalintakoe läpäisi muuttamatta säilynyttä
aineistoa; se ei todista koko ketjun tai aiemman sulun onnistumista.
Seuraava rajaus on nykyisen yhdistelmätestin vaihekohtainen mittaus,
ei automaattinen pysyvä budjetin nosto tai tarkistusten poistaminen.
Tämä yksi nimetty vaiheajo on tehty: alkuperäiset väittämät ja todellinen
fixturen sulku läpäisivät. Sovelluskoodi säilyi ja ajo valmistui tällä kertaa
myös aiemman testirajan sisällä, joten pysyvää rajamuutosta ei päätellä.
Mitatusta ajasta valtaosa kului uuden lapsen käynnistys-/cold-jatkoikkunassa;
se ei vielä erottele tämän ikkunan sisäisiä kutsuja tai todista vanhojen
hylkäysten juurisyytä. Myös nimetty tiedostotyön diagnostinen koe läpäisi
alkuperäiset väittämät ja sulun. Osittaiseksi jäänyt analyysi pidetään
erillään testin läpäisystä; se ei ole täsmällinen syytodiste. Seuraava työ
on enintään yhden nykyisen omistajan luentakorjausehdokkaan rajattu
lähdekatselmus. Varsinaisten muutosten vartijoita tai aikarajoja ei
muuteta. Vanhoja hylkäyksiä ei suljeta diagnostisen läpäisyn perusteella.

**Kylmäjatkon viimeisen poissaololuvun koerajaus, ei tuotantopäätös:**

Kylmävalinnan, palvelun huoltovarauksen ja vaihevalinnan omistajat säilyvät.
Ensimmäinen valinta, varauksen alla tehty uusintavalinta ja vaiheenvaihdon
tarkistus eivät ole sama valtuus, vaikka ne lukevat samoja tiedostoja.
Niitä tai natiivin varauksen identiteettitarkistuksia ei yhdistetä.
Yksi koeehdokas rajataan `workspaceDeletionFinalization.ts`:n viimeiseen
`assertRetired`-kutsuun **`clearTerminal`in jälkeen**, vain cold-kutsujalle:

1. Nykyinen täysi `technical.assertExternalSelection` säilyy.
2. Nykyinen journalin takaisinluku vaatii edelleen kaikkien slottien poissaolon.
3. Fyysinen poissaololukija säilyttää inventaarion vanhemman identiteetin
   ja operaatiokansion poissaolon tarkistukset. Sen oma, kutsukohtaisesti
   vanheneva vartija tarkistaa valtuuden, omistajuuden ja kirjoittajien
   poissaolon odotusten molemmin puolin nykyisen luentamallin mukaan.
4. Nykyinen täysi `technical.assertExternalSelection` ja lopputarkistus
   säilyvät. Komento ja palvelu omistavat edelleen loppukuittauksen,
   keskeneräisen työn sulun ja vasta sitä seuraavan varauksen vapautuksen.

Ennen journalin poistoa tehtävä `assertRetired`, `clearTerminal`in nykyinen
lukija, alkuperäisten payloadien poissaolot, kaikki muutosvartijat sekä
ei-cold-kutsujan toiminta pysyvät ennallaan. Uutta rajapintaa, välimuistia,
jaettua ohituslippua tai rinnakkaisia lukuja ei lisätä. Jo poistetun journalin
vanhaa slot-valintaa ei vaadita uudelleen `phase.assertSelected`-kutsulla;
vaihevaltuuden voimassaolon tarkistus ei ole slottien takaisinluku.

Ehdokkaan havaintoero koskee vain tätä viimeistä lukuväliä: sen sisällä
kokonaan muuttuva ja ennalleen palautuva ulkoinen metadata voi jäädä
havaitsematta. Ulomman valinnan kattama pysyvä muutos estää loppukuittauksen.
Tämä ei lupaa atomista tiedostojärjestelmän snapshotia. Virheessä journal
voi jo olla poistettu: jäljellä oleva tai palannut aineisto säilytetään,
onnistumista ei kuitata eikä journalia luoda uudelleen. Testissä ei saa
väittää jo poistettua journalia säilytetyksi.

Pieni koe vertaa nykyistä ja ehdokasta, todistaa säilyvät alku-/loppu- ja
muutosvartijat, oletuspolun, pysyvän ja palautuvan muutoksen, omistajuuden
menetyksen, vanhentuneen callbackin sekä pidetyn identiteettiluvun päättymisen ja
ensivirheen. Tarkistuskutsujen vähentyminen erotetaan kokonaisviiveen
korjaamisesta. Laajan ketjun hyötyä ei ole vielä osoitettu. Koe ei hyväksy
uutta havaintoeroa tuotantoon, pitkää uusintaa tai aikarajan nostoa; aiempi
tuotantosopimus muiden poissaolokutsujen säilyttämisestä on yhä voimassa.
Jos ehdokas ei auta tai osoittautuu puutteelliseksi, tulos päätetään
rajattuna päätösraporttina, ei automaattisena uutena optimointikierroksena.
Koesopimuksen rajattu riippumaton lähdekatselmus ei löytänyt korjattavaa.
Muistiin ladattu ehdokas ja nykyinen toteutus läpäisivät samat rajatut
vertailukontrollit. Odotettu sisäisten tarkistuskutsujen vähennys ja
säilyvät täydet alku-/loppuvalinnat todettiin; tämä ei ole koko cold-ketjun
nopeustodiste. Pysyvä rekisterimuutos, palannut sidonta tai alkuperäinen
payload, omistajuuden menetys ja kansioidentiteetin muutos estivät jatkon.
Callbackin vanheneminen ja pidetyn natiivi-identiteettiluvun tuloksen
odottaminen todennettiin. Tämä ei todista tiedostokahvan sulkua tai
käyttöjärjestelmän sisäisen I/O:n keskeyttämistä. Nykyiset loppupoiston ja
palvelun sulkuregressiot sekä oikean palvelu-komento-viimeistelijä-ketjun
post-clear-virhekontrollit läpäisivät: onnistumista ei kuitata, ja palvelu
odottaa sulun ennen varauksen vapauttamista; sulkuvirhe säilyy erillisenä.
Tyypitys ja lähteiden muuttumattomuus varmennettiin. Koetoteutuksen rajattu
riippumaton lähde- ja testiväitteiden katselmus ei löytänyt korjattavaa.
Tuotantokytkentä tarvitsee oman päätöksensä; ei uutta pitkää ajoa tai
aikarajamuutosta tällä näytöllä.

**Omistajan hyväksymä tuotantojatko:** omistajan tätä ehdotusta seurannut
nimenomainen yöjatkolupa kattaa yllä olevan rajatun kytkennän ja pysyvät
regressiot. Vain viimeinen `clearTerminal`in jälkeinen cold-poissaololuku
muuttuu; aiempi tuotantosopimus muiden poissaolokutsujen säilyttämisestä
päivittyy vain tältä osin. Kuvattu havaintoero hyväksytään tälle lukuvälille.
Toteutus käyttää samoja omistajia ja kertaluonteista vanhenevaa luentavaltuutta;
mikään lukutulos ei anna tiedostomuutoslupaa. Nykyiset kohde-, vaikutusalueen,
tyypitys- ja katselmusportit vaaditaan. Lupa ei muuta aikarajoja, nollaa
käytettyä pitkän cold-kokeen lupaa tai hyväksy vanhaa hylkäystä. Sovittu
koko Goalin loppukatselmus tehdään erikseen ennen loppuhyväksyntää.

Kytkentä on nyt työpuussa pysyvine regressioineen. Nykyiset kohde- ja
vaikutusalueen testit, tyypitys, tarkka lähdevertailu ja rajattu kytkentä-
katselmus läpäisivät. Myös nykyisen alkuperäisen virheen OpenPGP-purkukoe
läpäisi. Tämä ei ole natiivin onnistuvan cold-ketjun tai paketin hyväksyntä.
Yöjatkoluvan seuraava todennus rajataan yhteen tämän uuden jäädytetyn
kytkentälähteen nimettyyn `authorized`-prosessikokeeseen nykyisessä 60
sekunnin rajassa. Se ei uusi vanhaa muuttumatonta lähdettä, nosta aikarajaa
tai sulje aiempaa hylkäystä. Uusi tulos ja mahdollinen aineisto pidetään
erillään; siitä ei seuraa automaattista uusintaa tai uutta optimointiketjua.

Tämä uuden kytkentälähteen nimetty prosessikoe läpäisi alkuperäiset
väittämät, prosessisulut, sisällön poistumisen ja säilyvien tavujen vertailun
nykyisessä rajassa. Jälkitarkistus vahvisti muuttumattomat lähteet ja
aiempien epäonnistumisaineistojen säilymisen. Tämä on Node-prosessiketjun
näyttö, ei SQLite-, Electron-, paketti- tai koko W7.4-hyväksyntä eikä vanhan
timeout-syyn korjaustodiste. Normaali koko desktopin regressiosarja
hylkäsi rooliketjun ja valmistelu-/metadatakontrolleja; yksi erillisdiagnoosi
toisti osan aikakatkaisuista. Nykyisen metadatatestin rajattu vaihemittaus
erotti kevyen valmistelun varsinaisesta sovelluksen metadatasiivouksesta
ja vahvisti sisäisten rekisteri-/journal-lukujen kertautumisen.
Instrumentoidun tapauksen läpäisy ei hyväksy normaalia sarjaa eikä todista
aiempien aikakatkaisujen syytä. Tarkistusvastuuta tai aikarajoja ei tämän
havainnon perusteella muutettu. Seuraava katselmus erottaa säilytettävät
muutosvartijat pelkkien luentojen kertautuvasta työstä ennen uutta korjausta;
ei automaattista uutta optimointiketjua. Suunnitelman jäljellä olevat
SQLite-/Electron-, paketti-, integraatio- ja loppukatselmusportit ovat avoinna.

Alkuperäisten jäännösten poissaololuennan rajattu muistiehdokas säilytti
varsinaiset natiivit tiedostoidentiteetti- ja poissaololuvut sekä oletuspolun.
Täysi ulkoinen valinta rajaa kokonaisen poissaololuennan; sisäinen vartija
valvoo voimassaoloa, omistajuutta ja kirjoittajien poissaoloa. Muutos on
vain kokeessa nykyisen metadatakutsujan kanssa. Sen sisällä täysin ennalleen
palautuva ulkoinen metadata voisi jäädä havaitsematta; pysyvä muutos estää
jatkon. Palautuvan metadataikkunan kontrolli käyttää mallinnettua valintamuutosta,
ei todellista rekisterimuutosta tai atomista snapshotia. Pienet vertailukontrollit,
V2:n nykyiset muutos-/säilytysregressiot
ja instrumentoitu metadatatapaus läpäisivät samoissa rajoissa. Tämä ei
hyväksy tuotantokytkentää tai todista koko rooli-/cold-ketjun valmistumista.
Pidettyä testikutsua koskeva kontrolli odottaa vain käärittyä työtä ennen
natiivilukijan käynnistämistä; se ei todista natiivikahvan tai käyttöjärjestelmän
I/O:n sulkua. Tätä rajaa ei saa laajentaa hyväksyntäväitteessä.

Katselmuksessa löytynyt erillinen ensivirheen puute toistui nykyisessä
`workspaceRemnantParentSelection.ts`:ssä: jo hylätyn identiteettiluvun virhe
korvautui myöhemmällä omistajuuden menetyksellä ennen catchin jatkumista.
Rajattu järjestyskorjaus säilyttää tämän virheen; odotettu jälkeläisen
puuttuminen ja onnistunut luku vaativat edelleen tuoreen valtuuden.
Se ei anna muutoslupaa tai jatka epävarmaa valintaa. Pysyvät alku-/uusintaluvun
ajoitusregressiot, desktopin tyypitys, vaikutusalueen sarja, nykyinen
salaus-/purkukoe ja rajattu lähde-/testiväitekatselmus läpäisivät.
Nopeutusehdokas jää erikseen
muistiin, eikä tätä korjausta nimetä vanhan timeoutin syyn korjaukseksi.

F:n oikean SQLite-/Electron-ketjun erillinen testikytkentä käyttää nykyisen
E2E-mainin kertakäyttöistä kutsua todellisen palvelun `deleteWorkspace`-polkuun.
Composition omistaa jatkokomennon, suojatun sulun ja varauksen. Se ei muuta
W7.3:n `prepared`-tulosta lopulliseksi poistoksi eikä avaa W7.5:n IPC:tä tai
preloadia. Aktiivisen ja viimeisen yrityksen testit tuottavat oikean
tietokannan, laskun/PDF:n ja synteettisen sähköpostisalaisuuden, vertaavat
poiston jälkitilan ja restartin sekä säilyvät vieraat/ulkoiset tavut.
Kytkentäkontrollit, tyypitys ja alkuperäisen main-virheen salaus/purku
läpäisivät. Molemmat nimetyt Windows-Electron-kohteet läpäisivät ilman
uusintaa, myös fixturen prosessipuun/portin siivouksen osalta. Ensimmäisen
ajoversion valmistelun API-porttipuute korjattiin fixtureen; se ei ollut
poistokutsun tai yritysaineiston virhe. Puhtaan paketin näyttö ja loput
F:n keskeytys-/palautumisvariantit ovat avoinna.
Uusi todennus ei korvaa epäonnistunutta kaikkien roolien komentotestiä.

Passiivisen käytetyn yrityksen ja vioittuneen SQLite-tiedoston kaksi
lisävarianttia läpäisivät samassa neljän tapauksen Windows-ajossa.
Passiivisen poisto säilytti aiemman yrityksen laskun sisällön, PDF-tavut ja
salatut SMTP-tavut testin erikseen pyytämän restartin yli. Vikatapauksessa
normaalisti luodun suljetun kannan otsikko rikottiin vain synteettisessä
profiilissa: backend-käynnistysten laskuri pysyi nollassa ja tyhjä valitsin
sekä siivous varmistuivat restartissa. Tämä ei ole W7.5:n käyttöliittymän
tai paketoidun sovelluksen hyväksyntä.

Erillinen poissaololukijan ensisyypuute toistettiin tämän neljän tapauksen
ajon jälkeen: myöhempi valtuusvirhe peitti jo hylätyn `lstat`-virheen.
Rajattu käsittelyjärjestyksen korjaus säilyttää fatal-virheen. Tavallinen
puuttuminen ja onnistunut luku vaativat edelleen nykyisen valtuuden;
tarkistuksia tai aikarajoja ei kevennetä. Kohderegressiot, tyypitys,
laajempi vaikutussarja ja nykyinen salaus/purku läpäisivät. Koko Goalin
loppukatselmus on edelleen tekemättä.

Nykyisen lähdetilan nimetty Windows-Electron-todennus läpäisi kaikki neljä
poistotapausta uudestaan näiden ensisyykorjausten ja myöhemmän main-kytkennän
jälkeen, ilman uusintaa tai rajamuutosta. Lähteiden muuttumattomuus tarkistettiin
ennen valmistelua ja ajon jälkeen. Todelliset SQLite-/PDF-/salaisuusrajat,
säilyvät vieraat/ulkoiset tavut, restart sekä nykyisen fixturen prosessipuu-
ja porttisiivous läpäisivät. Kyse on edelleen E2E-mainin sisäisestä
poistopolusta, ei puhtaan hardened-paketin tai koko W7.4:n hyväksynnästä.

Muistipohjainen alkuperäisten jäännösten poissaololuennan ehdokas muuttaisi
täyden ulkoisen valinnan havaintorytmiä vain nykyisessä metadatakutsujassa.
Se liittyy silti yllä nimenomaisesti hylättyyn ulompien parent-vartijoiden
kevennysrajaan: eri kutsupolkua ei tulkita automaattiseksi poikkeukseksi.
Tuotantokytkentä ja tarkka luennan sisällä ennalleen palautuvan metadatan
havaintoero jäävät erikseen ratkaistaviksi. Vanhat muistikoelähteet eivät
ole tämän myöhemmän ensisyypaikkauksen hyväksyntänäyttöä.

**Omistajat ja järjestys:**

1. `desktopComposition.ts` ottaa nykyisen single-instance- ja fyysisen
   main-varauksen. Nimetty vain lukeva deletion-valinta tehdään ennen
   `createInstallationUpdateState`a. Kaikkien poistoslottien poissaolo
   palauttaa nykyiseen none/create/import-ketjuun muuttamatta sen guardia.
   Läsnä oleva mutta hylätty poisto ei putoa tavalliseen käynnistykseen.
   Initial-next on julkaisematon eikä anna jatkolupaa.
2. `workspaceColdRecoveryAdmissionComposition.ts` koostaa nykyisen
   journal-slot-suunnittelijan, `captureWorkspaceDeletionPhaseSelection`in,
   alkuperäisjournalien jatkolukijan sekä muiden omistajien censuksen.
   Kohde, muuttumaton sidonta, vaihe, kaikki rekisterislotit, todelliset
   tavut ja natiivi-identiteetit valitaan; pelkkä operationId ei riitä.
   Luku ei korjaa, migroi tai poista mitään eikä avaa yrityksen tietokantaa.
3. Update-omistajan nimetty readonly-valinta todentaa alla olevan
   build-/päivitysportin. Tavallista `migrateLegacyLocalUpdateState`a tai
   selectorin korjaavaa valmistelua ei käytetä tämän havainnon tekemiseen.
   Havainnot eivät vielä anna delete-leasea tai muutosvaltuutta.
4. `WorkspaceManagementService` saa nimetyn staattisen
   `recoverDeletionBeforeRuntime`-sisääntulon kapeilla cold-porteilla.
   Se ei edellytä tekaistuja create/import/switch-käskyjä eikä ohita
   `runAdmitted`in tavallista unresolved-guardia boolean-valinnalla.
   Palvelun nykyisestä delete-jatkosta jaetaan saman omistajan yksityinen
   jatko-, ensivirhe- ja completion-käsittely; ei toista elinkaaripalvelua.
   Vanha `recoverWorkspaceManagementBeforeRuntime` säilyy create/importille.
5. Cold-entry ottaa nykyisen `delete`-leasen ja valitsee saman aineiston
   uudelleen main-varauksen, runtime-poissaolon ja leasen alla. Valinta
   ei saa vaihtua tuoreempaan journal- tai rekisterihavaintoon huomaamatta.
   `workspaceDeletionCommand.ts`:n nimetty `resumeSelected` kopioi täsmällisen
   journal-sidonnan ennen ensimmäistä odotusta ja käyttää samaa yksityistä
   vaiheketjua kuin live-`resume`. Sidonta välitetään jokaiselle omistajalle;
   muistissa olevan vanhan komento-olion julkaisu ei ole cold-valtuus.
6. Metadata ja viimeistely pysyvät nykyisillä omistajillaan; journal poistuu
   viimeisenä. Vain täsmällinen terminal-kuitti antaa poiston lopputuloksen.
   Main odottaa alkuperäisen työn, lukujen ja sulkujen päättymisen sekä
   leasen vapautumisen. Sen jälkeen tavallinen cold-admission sekä
   installation-/build-valmistelu luetaan uudelleen, ei vanhasta kuitista.
   W6, selector ja business-startup säilyttävät omat porttinsa. Aktiivinen
   tai viimeinen poisto johtaa null-valitsimeen, passiivinen korkeintaan
   samaan aiempaan yritykseen. Valitsinta ei tulkita business-terveydeksi.

**Build- ja installation-valinta:** käytetään `createLocalUpdateRuntimePaths`in
nykyisiä viittä osoitetta: nykyinen/legacy accepted-metadata, nykyinen/legacy
C-journal ja Direct Setup recovery. Metadata luetaan `inspectSlots`illa,
muut nykyisillä readonly-slot-lukijoilla, parsereilla ja kokorajoilla.
Kaikki sijainnit, poissaolot, tavut ja identiteetit sidotaan havaintoon.
Ensimmäinen deletion-kytkentä sallii vain poissaolon tai sole-currentin;
korjattavat sivuslotit säilytetään selvitystä varten. Current- ja
legacy-sijainnin samanaikaiset arvot kelpaavat vain täysin samoina, myös
acceptedAt-, scope- ja baseline-kenttien osalta. Vanhaa metadataa ei siirretä.

Nykyisestä selector-valmistelusta jaetaan puhdas terminal-suhdetarkistus,
ei sen kirjoittavaa toimintoa tai null-rekisterin oletusta. C:n `accepted`
vaatii accepted-applicationin vastaavan journalin targetia;
`rolledBack`/`installerNotApplied` sen sourcea, revision ja kanavan mukaan.
Vasta tämän jälkeen terminal voidaan kuvata luokittelijalle ilman avointa
päivityskohdetta. Todelliset slotit pysyvät silti valittuna ja koskemattomina.
`classifyPreWorkspaceBuildAdmission` omistaa edelleen build-säännön;
myös sallittu `authorizedNewerBuild` säilyy, eikä kaikkea pakoteta exactiksi.
Deletionin omistajuus-/recovery-portti vaaditaan luokittelun lisäksi.

Direct Setupin `accepted` säilyy luokittelijan syötteenä. Se voidaan kirjoittaa
ennen accepted-buildin julkaisua, joten source-metadata tai pelkkä selectorin
sovellushyväksyntä ei todista business-hyväksyntää. Keskeneräistä FirstStartia
ei ajeta poiston rinnalla. Samoin pelkkä `initialInstall` ei anna jo
julkaistun poiston jatkolupaa. Puuttuva packaged-build-todiste tai ristiriita
säilyttää aineiston ja estää tämän uuden haaran; tavallisen startupin
kehitys-/ensiasennuspolkua ei muuteta. Näiden epäselvien leikkausten
mahdollinen lisätuki tarvitsee erillisen sopimuksen, ei fallbackia.

**Muiden omistajien census:** creation, switch, W6, avoin installation-update
ja vieraan työtilan palautus eivät väisty. Census kattaa rekisterin kaikki
työtilat, poiston kohteen myös sen rekisteristä poistumisen jälkeen,
aiemman aktiivisen työtilan ja legacy-runtimejuuren. Jaettu activation-polku
luetaan yhtenä omistajana, ei jokaisen yrityksen omana journalina.
Vain v2-todisteeseen täsmälleen vastaava import/adoption/shared-activation
saa nimetyn poikkeuksen. Kohdeyrityksen oman kansion sisäinen restore kuuluu
todistetun workspace-payloadin piiriin; tätä ei laajenneta muuhun juureen,
epäselvään linkkiin tai installation-palautukseen. V1 ei saa uusia poikkeuksia.

**Valtuuden elinikä ilman tarkistuskehää:** mainin perusvartija omistaa
single-instancen, fyysisen varauksen, delete-leasen, työn eliniän sekä
muuttumattoman build-/vierasomistajavalinnan. Se ei lue takaisin poiston
omia muuttuvia vaihe- tai rekisterislotteja. Alkuperäisjournalin kuitti
valitaan kokonaisen vaihevalinnan molemminpuolisen tarkistuksen sisällä,
mutta sen sisäinen external-vartija ei kutsu itseään tai vaihevalintaa.

Payload- ja rekisterivaiheet pitävät alkuperäisjournalien sekä sidontojen
tavut/identiteetit muuttumattomina. Niiden vaihevaltuus yhdistää nykyisen
main-varauksen ja tämän rajatun alkuperäisvalinnan; kunkin omistajan nykyiset
täydet muutosvartijat säilyvät. Ennen metadataan siirtymistä kuitti
tarkistetaan ja päätetään. Sama viimeinen tarkistus ja revoke tehdään myös
suorassa `registryPublished` -> finalizer -haarassa, joka ei kutsu
metadatasiivoojaa; yhteinen raja ja finally varmistavat molemmat reitit.
Metadatasiivooja ottaa omilla nykyisillä
v2-/remainder-/alias-/poissaolovartijoillaan muuttuvien slottien vastuun;
vanhaa kuittia ei pidetä oman laillisen retirementin yli. Viimeistelijä
todistaa metadatan ja kiinteiden payload-juurten poissaolon. Pelkkä kuitin
revoke ei siirrä valtuutta: vastaanottajan täysi tarkistus edeltää muutosta.
Tavallista writers- tai sisäisen tiedostoluvun vartijaa ei muuteta
rekursiiviseksi census-/phase-lukijaksi. Työmäärä ja myöhäisen muutoksen
hylkäys todennetaan pienellä fixtuurellä ennen pitkää ajoa.

**Virhe ja sulku:** cold-entry ei käynnistä uutta backupia, vahvistuskyselyä,
automaattista retryä tai business-runtimea. Alkuperäinen työ kuuluu nykyiseen
startup-omistajaan; pelkkä Promise-kilpailun loppuminen ei vapauta varausta.
Main seuraa pending-/uncertainty-tilaa nykyisen startupin omistajuusmallilla.
Sulun tai leasen vapautuksen virhe merkitsee epävarmuuden ennen pendingin
päättämistä, myös poistokomennon jo onnistuttua. Main-varaus invalidioidaan
ennen outer catchin closea, jos työ tai sulku on epävarma. Ensivirhe säilyy
ensisijaisena ja completion-virheet erillisinä. Tiedostot säilyvät siinä
todennetussa keskeytystilassa, johon työ pääsi. Uutta ajastinta tai aikaa ei
lainata toisesta palautuspolusta. Nykyiset caller-, sulku- ja testirajat säilyvät.

**Pienet portit tässä järjestyksessä:**

| Pala | Pakollinen erottava näyttö |
| --- | --- |
| E1: readonly-valinta | Absent/published/initial-next, kaikki sallitut poiston vaihe- ja registry-katkot, v1/v2 ja alkuperäisjournalin osittainen retirement. Buildin sole-current/legacy/equal duplicates, kaikki kolme C-terminalia oikealla ja väärällä suhteella, Direct Setupin kolme hyväksyntäleikkausta sekä exact/newer/downgrade/mixed. Luvun aikana muuttuvat tavut/identiteetit, myöhäinen sivuslot ja menetetty valtuus hylätään; repairing read/write/clear ei käynnisty. |
| E2: palvelu ja main | Published-poisto ei putoa importiin tai tavalliseen käynnistykseen. Tuore delete-lease ja täsmällinen sidonta, muiden omistajien census, alkuperäistodisteen vaihto ennen fyysistä muutosta, metadatan laillinen retirement ja suoran terminal-haaran viimeinen kuittitarkistus/revoke. Pidetty I/O, command-virhe + release-virhe, onnistunut command + release-virhe sekä vanhan callbackin käyttö eivät vapauta epävarmaa main-varausta tai avaa runtimea. None/create/import ja W7.3:n live-peruutuspaluu säilyvät. |
| E3/F: todellinen ketju | Oikea prosessikatko, vanhan omistajan todellinen exit ja uusi main-varaus; aktiivinen/passiivinen/viimeinen/vikatilainen kohde sekä metadata-/terminal-katkot. Nykyisen salatun paketin purusta löytyy pakotettu ensivirhe. Vasta näiden jälkeen nykyinen natiivi-/SQLite-/Electron-/paketti- ja PR/main-todennus. Pieni source- tai mock-näyttö ei korvaa niitä. |

Tyypitys, rajattu riippumaton katselmus ja muuttuneiden omistajien nykyiset
regressiot kuuluvat kuhunkin palaan. Uusi `deleteResume`-havainto liitetään
nykyiseen observeriin, turvalliseen virhesopimukseen ja sen oikeisiin
lukijoihin ennen pitkää CI:tä. Tämä suunnitelma ei avaa W7.5:n kanavia,
laajenna kerättävää aineistoa, hyväksy koko W7.4:ää tai sulje vanhoja
aikakatkaisuja. Poiston näkyvä käyttöönotto odottaa omia porttejaan.

##### W7.4 C: inspection-haun rajattu jatkoehdotus

**2.11.2026, rajattu koe tehty ja nimetty tuotantokytkentä hyväksytty.**
Aiempi `findUniqueWorkspaceInspectionBinding` luki jokaiselle haetulle
generationille myös muiden generationien kaikki sidontaslotit. Kolme
kutsujaa ovat metadata-census, jaettujen replacement-parenttien lukija ja
kohdeyrityksen sisäisten inspection-kopioiden lukija. Tämä kertautuu, vaikka
census- ja inventory-luentojen aiemmat valtuusrajaukset ovat jo käytössä.
Havainto ei yksin osoita koko komennon aikakatkaisun syytä.

**Hyväksytty vastuunjako:** yhden generationin yksiselitteisyyshaku erotetaan
koko sidontasisällön eheysluennasta. Haku validoi edelleen kaikki
raakanimet ja käy hakemiston loppuun, mutta lukee vain haettua generationia
vastaavien sidontojen tavut. Täydellinen census lukee ja vertaa edelleen
kaikkien omistajien kaikki slotit, myös vieraat ja payloadittomat sidonnat.
Tämä ei ole täsmälleen vanha havaintosopimus: toisen generationin sisältö
voi muuttua sen oman tarkistuksen jälkeen eikä toisen tunnisteen haku enää
havaitse sitä. Myöhempi täydellinen luenta hylkää silloin yhä olemassa olevan
virheen; saman kierroksen EOF tarkistaa parentit, ei uudelleen kaikkia jo
luettuja slotteja. Myöskään viimeiselle vertailulle ei luvata atomista
snapshotia. Tätä havaintoikkunan muutosta ei hyväksytä mittauksella,
tavallisella testiajoluvalla tai aiemmalla C:n inventory-lukukytkennällä.

Omistaja hyväksyi ensin seuraavan rajatun koesopimuksen ja sen näytön jälkeen
nimenomaisesti saman vastuunjaon tuotantokytkennän nykyisten porttien kautta:

1. `workspaceRemnantBindingEnumeration.ts` säilyttää nykyisen täydellisen
   oletuslukijan. Nimetty inspection-generationin lukija käyttää samaa
   hakemiston valintaa, parseria ja slot-tallenninta; ei yleistä
   suodatuscallbackia, kasvavaa indeksiä tai generationin välimuistia.
2. Jokainen raakanimi validoidaan ennen rajausta. Side-only, tuntematon nimi
   ja haetun generationin toinen operation estävät tuloksen myös vieraan
   yrityksen tai myöhemmän sivun kohdalla. Matching-sidonnan kaikki slotit,
   tavut, identiteetit ja nykyiset ennen-/jälkivertailut säilyvät.
   Tiedoston sisältö ei saa vaihtaa nimen sisältämää avainta.
3. `findUniqueWorkspaceInspectionBinding` käyttää nimettyä lukijaa, mutta
   palauttaa tuloksen vasta täydellisen nimiluennan, sulun ja loppuvalinnan
   jälkeen. Kolmen kutsujan omat kohde-, juuri-, ancestor- ja kuluttajan
   jälkeiset tarkistukset säilyvät. Ulompaa parent-vartijaa ei siirretä
   pelkästään haun alkuun ja loppuun.
4. `WorkspaceRemnantBindingStore`, yleinen hakemistolukija, census-hash,
   inventoryn kolme vertailua, backup-uusintaluku ja kaikki julkaisun sekä
   tiedostomuutosten vartijat säilyvät. Haku ei anna muutos- tai siivouslupaa.
   Normaali palautus, levyformaatit, riippuvuudet ja aikarajat eivät muutu.

Koetodennus erottaa vanhan ja ehdotetun havaintosopimuksen, ei väitä niitä
samoiksi. Pienissä oikeiden tiedostojen kokeissa vaaditaan:

- kaikki nykyiset parentin vaihto-/palautuskontrollit muuttamattomina;
  avauksen, luvun ja sulun aikana menetetty valtuus sekä kirjoittajan paluu
- matching-sidonnan väärä avain, muuttuneet tavut, sama sisältö uudella
  identiteetillä, ristiriitaiset sivuslotit ja duplikaatti myös sivurajan yli
- osuman jälkeinen virhe ja keskeytys: ei ennenaikaista tulosta, aloitettu työ
  ja sulut odotetaan, ensimmäinen syy ja sulkuvirhe säilyvät erikseen
- muun generationin vioittuminen ennen sen omaa luentaa sekä sen jälkeen;
  jälkimmäisessä nykyisen ja ehdotetun haun ero ja seuraavan täydellisen
  luennan hylkäys todistetaan erikseen, myös viimeisen vertailun kohdalla
- todellinen census-/publication-ketju: vieraat raakatavut ja identiteetit
  kuuluvat edelleen vertailuun; poikkeus ei käynnistä fyysistä jatkoa ja
  jo julkaistu journal säilyy epävarmassa loppuvertailussa
- pieni saman aineiston vertailu lukumäärillä ja muuttumattomilla
  hyväksyntäehdoilla; pelkkää mockin onnistumista ei lasketa näytöksi.

Koe ensin nykyisen yksityisen koepohjan päällä, ei suoraan tuotantoon.
Tuotantokytkentä edellyttää tämän nimenomaisen sopimuksen päätöstä, erottavaa
näyttöä ja rajattua katselmusta. Jos säästö jää vähäiseksi tai nykyisen
valintasuojan aukko jää auki, ei käynnistetä uutta pitkää koostetta eikä
lisätä peräkkäisiä nopeutuskokeita ilman täsmällistä jatkopäätöstä.
E:n alkuperäisen omistajan todistemuoto ja koko W7.4:n loppuportit ovat
erillisiä avoimia asioita. Tämä ei ole niiden hyväksyntä.

**Koenäyttö:** nykyinen ja muistiin ladattu ehdokas läpäisivät kumpikin saman
83 testin kohdejoukon. Sulkukontrollien katselmuspuutteet täydennettiin
erillisillä viidellä tapauksella sekä sivurajan täsmällisellä
current/backup/next-tapauksella; kumpikin toteutus läpäisi ne. Pieni
vertailu vahvisti vähenevät sidontaluvut, ei koko poistokomennon aikarajan
riittävyyttä. Koko julkaisun kaksi uutta rajatestiä aikakatkaisivat
kummallakin toteutuksella; niitä ei lasketa onnistuneiksi.

Pienempi oikean inventaarion, journalin ja census-kuittauksen porttikoe
todensi havaintoikkunan eron sekä alkuperäisten payload-tavujen ja journalin
tarkkojen tavujen ja identiteetin säilymisen. Myöhempi täydellinen luenta
hylkäsi säilyneen virheen. Erillinen kontrolloitua hakemistoidentiteettien
lukuporttia käyttävä julkaisukoe paikansi saman eron kolmannen vertailun
viimeiseen census-kuittaukseen. Sen aiempi, ensimmäiseen luentaan osunut
virheinjektio hylättiin vielä myöhemmässä luennassa; tätä väärää koeodotusta
ei esitetä sovellusvikana tai havaintoikkunan todisteena. Porttikoe ei
korvaa koko julkaisijan kolmea natiivia vertailua, pääprosessia tai
pakettihyväksyntää. Hyväksytty ehdokas on nyt kytketty kahteen nykyiseen
lähdeomistajaan. Pysyvät kohde- ja census-portin regressiot sekä nykyisten
oletuslukijoiden kohdetestit läpäisivät normaalisti. Natiivi aloitusjulkaisu
läpäisi kaikilla 23 rivillä ja kolmella täydellä vertailulla. Tämä ei vielä
todista fyysistä jatkoa, pääprosessin kytkentää tai koko poistoa. Aikarajoja
ei muutettu; rajattu katselmus ei ole Goalin loppukatselmus.

##### W7.4:n todistus- ja valmistumisportit

**2.11.2026, muuttavan kierroksen inventaarioluvun rajaus:** pieni
muuttumattoman toteutuksen koe erotti inventaariolukijan täydet
valintakutsut rivin omista siirto-/poistovartijoista. Omistaja hyväksyi
ensin rajatun suunnittelun ja synteettisen kokeen sekä sen jälkeen tämän
nimetyn kokonaisuuden toteutuksen nykyisten näyttö- ja katselmusporttien
kautta. Tämä täsmentää yllä olevan D-sopimuksen `move`/`purge`-rajaa vain
seuraavasti; se ei anna niiden tiedostomuutoksille kevyttä valtuutta.

- Nykyinen executor ympäröi myös muuttavan kierroksen inventaarioluvun
  alkuperäisellä täydellä vaihe-, rekisteri- ja journal-valinnalla.
- Vain inventaariotallentimen sisäiset lukukutsut käyttävät yhteen kierrokseen
  sidottua työluvan ja kirjoittajien poissaolon vartijaa. Nykyiset tiedosto-,
  hakemisto-, tavu-, EOF- ja sulkutarkistukset säilyvät.
- Rivin kuluttajalle ei välitetä tätä kevyttä valtuutta. `processRow` käyttää
  alkuperäistä täyttä vaihevalintaa, sidontaluennan omistajaa ja jokaisen
  varsinaisen siirron tai poiston tuoretta alkuperäistä vartijaa.
- Koko luenta ja sulku päätetään ennen loppuvalinnan hyväksyntää. Vanha
  lukucallback ei elvy myöhemmässä kierroksessa; ensivirhe ja myöhempi
  sulkuvirhe säilyvät. Muutoksen tai epävarman sulun jälkeen ei edetä.

Ennen pysyvää kytkentää vaaditaan alkuperäisten executor-/luentakontrollien
vertailu, myöhäinen rekisteri-/journal-muutos, kirjoittajan paluu, vanhan
callbackin käyttö seuraavassa kierroksessa sekä pidetty tiedostoluku ja sulku.
Nykyiset fyysisen muutoksen ja kilpailevan sidonnan kielteiset testit
säilyvät. Mittaus ei muuta aikarajoja eikä hyväksy vanhaa aikakatkaisua.
Uusi pitkä kooste tarvitsee ensin erottavan pienen näytön; tuotantolähde,
säilyneet tavut, todellinen palautusketju ja PR/main-portit hyväksytään
edelleen erikseen nykyisillä ehdoilla. E:n avoimen teknisen todistemuodon
ratkaisua tai W7.5:n kanavia ei päätellä tästä luentarajauksesta.

Rajattu vertailu läpäisi 32 yhteistä tapausta; kaksi vain uuden luentavaltuuden
elinikää koskevaa tapausta jäi vertailussa pois. Koeehdokas läpäisi kaikki
34 tapausta nykyisillä aikarajoilla. Katselmuksen näyttöpuutteet täydennettiin
molempien fyysisten vaiheiden loppurajoille, pidetylle I/O:lle ja alkuperäisen
luku-/sulkuvirheen sekä vanhan kuluttajacallbackin täsmälliselle toistolle.
Tahallisesti väärä valtuuden välitys riville hylättiin: nykyinen kielteinen
testi havaitsi kielletyn siirron. Vastakoe ei ole sovellukseen tehty muutos.
Pieni tarkistuskutsujen vertailu säilytti fyysisten muutosten ja sidontaluennan
vartijat, mutta ei vielä todista koko koosteen kestoa tai vanhaa viivettä.

Pysyvä executor vastaa katselmoitua koeehdokasta. Regressiot käyttävät vain
nykyisiä testifixturejä; mukaan ei toimiteta yksityisiä mittareita tai
koemuuntimia. Nykyisen vaihevalinnan perusteella valittu testikohta
todennetaan erikseen suorittamalla oikea tiedostosiirto tai poisto sen sisällä.
Normaali tyypitys, 36 tavallista kohdekontrollia ja rajattu lähdekatselmus
läpäisivät. Muu rajattu viiden tiedoston vaikutussarja läpäisi 144 testiä,
ja nykyinen tiukka salaus/purku-koe läpäisi samoilla lähteillä. Uusi normaali
23 rivin kooste aikakatkaisi fyysisessä vaiheessa. Valmistelu ja
aloitusjulkaisu valmistuivat; journal oli `purgeAuthorized` ja rekisteri
ennen-tilassa. Osa kohdejuurista säilyi eristetyssä paikassa. Tästä ei
päätellä tarkkaa odottavaa kutsua, juurisyytä tai koko ketjun hyväksyntää.

Erillinen aloitusjulkaisun koe käytti samoja lähteitä ja alkuperäistä rajaa:
kaikki roolit, kolme täydellistä vertailua, journalin julkaisu ja
säilytettävät tavut todennettiin. Koe ei kutsunut fyysistä jatkoa eikä
korvaa hylättyä koostetta. Nykyinen census- ja C-vertailun luentarajaus on jo
käytössä. Niiden toistaminen uutena muutoksena tai aiemmin hylätty ulompien
parent-vartijoiden keventäminen ei ole jatkosuunnitelma. Seuraava rajattu
katselmus arvioi lähdehakujen kertautumista säilyttäen nykyiset täydellisyys-,
identiteetti-, virhe-/sulku- ja muutosvartijat. Uutta tarkistussopimusta ei
päätellä mittauksesta. Jäljellä olevat integraatio- ja pakettiportit ovat
kesken; vanhoja aikakatkaisuja ei merkitä korjatuiksi tästä näytöstä.

| Näyttö | Hyväksymisehto |
| --- | --- |
| Pienet rajakokeet | A-C:n todelliset slotit, kopion alkuperäinen luontitodiste, muuttunut backup, varaus/valinta/nimi/sukupolvi, publication settlement ja leasen luovutus. W7.0:n kokeet ovat vertailukohta, eivät uuden kytkennän näyttö. |
| Keskeytysmatriisi | Journalin jokaisen vaihesiirron molemmat puolet, partial rename/purge, kaikkien slotien ristiriidat, readback/sync/close-virheet, vaihdettu/linkitetty juuri ja toistettu restart. Vertaa poistuneita ja kaikkia säilytettäviä tavuja. |
| Oikea prosessiraja | Nimetty hallittu lapsen keskeytys + uusi omistajaprosessi; ei vain uusi JavaScript-olio. Backend/main-I/O/inspection/varaus todistetaan erikseen. Prosessikoe ei lupaa fyysistä sähkökatkokestävyyttä. |
| Ei regressioita | Tavallinen backup, same-lineage replace, activation-migration, create/import, adoption, secret-/arkistosulku, update ja W7.3:n peruutuspaluu. Sidonnan epävarmuus ei avaa relaunchia; muu onnistuminen säilyy. |
| Kokonainen sisäinen poisto | Aktiivinen, passiivinen, viimeinen ja vikatilainen kohde, jokainen jäännösrooli, SMTP:n kaikki slotit sekä omat palautuspisteet. Ei DB:n avausta vikakohteen poistoluvaksi. Toisen yrityksen ja ulkoisten kopioiden tavut säilyvät; lineage vapautuu vasta terminalissa. |
| Paketti ja integraatio | Sama puhdas hardened Windows-paketti: backup -> inspect -> restore -> restart -> compare sekä sisäinen poisto -> restart -> selector/aiempi yritys ja tietojen vertailu. Nykyiset vaikutusalueen stress-/soak-/installer-portit, riippuvuusauditointi, riippumaton katselmus, PR:n täsmähead ja uuden mainin omat portit. |

F:n nimetty prosessiregressio käyttää yhteistä publish/resume-komentoa,
oikeaa käyttöjärjestelmävarausta ja delete-leasea erillisessä Node-lapsessa.
Katko tehdään julkaistun aloituksen, payloadin poissaolon tai terminalin
julkaisun kohdalla. Vanhan lapsen `close` edeltää uuden prosessin
käynnistystä ja saman varauksen uudelleenottoa. Viimeisen vikatilaisen
yrityksen tapaus tarkistaa lisäksi tyhjän valitsimen lopputuloksen.
Cold-variantti käyttää oikeaa `recoverDesktopWorkspaceDeletion`-apuria,
sen yhteistä palvelua, build-/valintavartijoita ja huoltovarausta.
Edeltävä viiden prosessitestin sarja läpäisi omalla lähdejäädytyksellään.
Nykyiseen fixtureen on lisäksi toteutettu kahdeksan katkoa journalin neljän
vaihesiirron molemmin puolin. Niiden hyväksyntä on avoin: `after:quarantined`
sekä `before:registryPublished` ja `after:registryPublished` aikakatkaisivat
nykyisessä 60 sekunnin rajassa. Erilliset vaihemittaukset erottivat nopean
valmistelun ja ensimmäisen omistajan sulun uuden cold-prosessin puuttuvasta
valmistumiskuittauksesta. Nykyisen mittarin rajattu lapsihavainto osoitti
työn etenevän inventaarion viimeistelyn sisäisiin metadata- ja
omistajuusluentoihin, joissa samat tarkistukset kertautuivat. Tämä ei vielä
osoita turvallista vähennystapaa tai yksittäistä pysyvästi odottavaa I/O:ta.
Molempien lasten sulku varmistui lopuksi; se ei tarkoita cold-jatkon onnistumista.
Säilynyt tai jo poistunut journal ei yksin todista viimeistelyn valmistumista.
Muita viittä uutta katkoa ei ole vielä ajettu. Testikytkennän tyypitys ja
rajattu lähdekatselmus läpäisivät, eivätkä tuotantokoodi tai rajat muuttuneet.
**Jatkon rajaus:** nykyisten omistajien yhteiskatselmus ei osoittanut puuttuvaa
poistovartijaa tai väärään callbackiin kytkettyä cold-valintaa. Pelkkä
sisäisen terminal-takaisinluvun journal-tarkistuksen poisto ei ole valittu
korjaus. Seuraava rajattu ehdotus on alla; katselmus ei itsessään hyväksy
havaintorytmin muutosta, tuotantokytkentää tai uusia aikarajoja.
Lisäksi aiempi cold-valinnan
ja main-jatkon kohdesarja läpäisi 102 testiä ja todellisen compositionin
W7.4-valinta 24 testiä. Composition-kokeessa Electron-/backend-rajat ovat
kontrolloituja. Prosessifixture ei avaa SQLitea, Electronia tai backendia;
se ei siten todista koko Electron-startupia tai paketoidun sovelluksen
palautumista. Valitsemattomia testejä ei lasketa näiden sarjojen läpäisyiksi.
Ulomman compositionin erillinen cold-variantti kuluttaa oikean etukäteen
julkaistun journalin ilman injektoitua live-komentoa. Se ja saman perheen
kolme live-varianttia sekä tyypitys läpäisivät nykyisessä tapausrajassa.
Tyhjä valitsin avautuu ilman backendia, runtime-sessionia, live-sulkua tai
uutta vahvistusta; kohde ja poistometadata puuttuvat, ulkoiset tavut säilyvät
ja main-varaus vapautuu vasta odotetussa valitsimen sulussa. Rajattu
katselmus ei löytänyt puutetta. Tämä sulkee kyseisen kontrolloidun
main-liitoksen näyttöaukon, ei natiivin prosessirajan tai puhtaan paketin porttia.
Saman komennon pakotetun virheen viesti, pino ja syyketju tarkistetaan
nykyisestä puretusta OpenPGP-paketista. Vain nykyiset runner-virhetietueet
kerätään; säilytetty testiprofiili ei kuulu salattuunkaan pakettiin.

###### Cold-katselmuksen rajattu jatkosopimus

**Tila 3.11.2026: rajattu tuotantokytkentä hyväksytty ja työpuussa; integraatio kesken.**
Omistaja hyväksyi kahden omistajan kytkennän, pysyvät regressiot sekä yhden
nimetyn uuden lähteen cold-prosessitodennuksen nykyisessä rajassa vasta
kohdetestien, tyypityksen ja katselmuksen jälkeen. Koko W7.4:n tai mergen
hyväksyntää tämä ei anna. Alla kuvattu havaintoero säilyy hyväksytyn mukaisena.
Tarkistusvastuun kokonaisuus ulottuu mainin cold-valinnasta komennon
vaiheisiin, viimeistelijään, inventaarion retirementiin ja journalin
muuttuvien slottien tallentimeen. Työ kertautuu tuotannon kutsuketjussa;
pelkät kevyillä valtuusporteilla ajetut kohdetestit eivät todista sen kestoa.

Suositeltu yksi ehdokas koskee `workspaceDeletionCommand.ts`:n ja
`workspaceDeletionFinalization.ts`:n nykyistä cold-kytkentää. Mainin
`assertReservationOwned` tekee jo omistajuus -> kirjoittajien poissaolo ->
omistajuus -tarkistuksen ja omistaa keskeneräisen työn sulun. Vain tämän
nimetyn portin saaneet viimeistelijän kolme nykyistä sisäistä luentavartijaa
käyttäisivät sitä kerran: terminal-metadatan poissaololuku,
`clearTerminal`in fyysinen inventaario-/juuripoissaololuku ja poiston
jälkeinen fyysinen poissaololuku. Portti sidotaan eksplisiittisesti nykyisestä
cold-parista; callbackien yhtäsuuruudesta tai `stable`-lipusta ei päätellä
omistajuutta. Komento välittää portin vain viimeistelijälle, ei yhteisessä
vaiheiden asetuksessa. Portti validoidaan ja sidotaan ennen odotuksia;
virheellinen portti hylätään. Ilman porttia nykyinen oletuskäyttäytyminen
säilyy myös kutsujalla, joka antaa vain `assertStableSelection`in.

Täydet main-/build-/vierasomistaja- ja vaihe-/rekisterivalinnat,
alku-/loppuvertailut, paikalliset tiedostoidentiteetit, alkuperäispayloadien
poissaolotodisteet ja kaikki muutos-/sync-vartijat säilyvät. Journalin
muuttuvat slotit kuuluvat edelleen tallentimelle; vanhaa vaihekuittia ei
pidetä niiden poistamisen yli. Ei muutosta yhteiseen tiedostotallentimeen,
fyysisen varauksen toteutukseen, alkuperäisvalinnan luentarytmiin tai muihin
kutsujiin, eikä tuloksen välimuistia tai uutta manageria.

**Päätettävä ero:** sisäisen luennan ylimääräisiä fyysisen varauksen
uusintahavaintoja jäisi pois. Varaus, kirjoittajien poissaolo ja luennan
omat identiteettitarkistukset vaaditaan edelleen, mutta täsmälleen entistä
havaintorytmiä ei luvata. Tämä koskee kolmea nimettyä luentaa myös silloin,
kun metadata-luenta tapahtuu täyden muutosvartijan sisällä: vartijan
kutsupaikka, ehdot ja alku-/loppuvertailut säilyvät, sen sisäinen fyysisten
varaushavaintojen määrä muuttuu. Vain poistettujen havaintojen kohdalla näkyvä ja
ennalleen palautuva ulkoinen juurimuutos voisi jäädä havaitsematta.
Havaittu valtuusvirhe pysyy päättävänä; pysyvä muutos estää jatkon.
Tämä ero vaatii nimetyn koepäätöksen ennen ehdokasta ja näyttöön perustuvan
päätöksen ennen tuotantokytkentää. Aikarajat eivät muutu.

Ensin toistetaan erillinen ensisyyaukko inventaarion natiivin `removeSlot`in
sisäisessä identiteettivartijassa: yhteinen virhemuunnos voi hävittää
alkuperäisen syyn ennen viimeistelijää. Korjaus rajataan virheen omistajaan,
ei yhteisen tallentimen yleiseen virhesopimukseen. Täydennetään myös täyden
valinnan hylkäys juuri ennen operation-kansion poistoa ja journalin
hakemistosynkronointia. Nämä ovat lähdehavaintoja, eivät vielä ajettuja
regressioita tai aikakatkaisun selitys.

Koerajauksen hyväksynnän jälkeen nykyinen pieni fixture vertaa alkuperäistä
ja ehdokasta oikealla cold-porttien koostella: samat muutosvartijat ja niiden
järjestys, todellisten varauskutsujen määrä, pysyvä ja hetkellinen muutos,
vieraat tavut, identiteetin vaihto, vanhentunut callback, pidetty työ,
ensivirhe ja sulku. Tarkistetaan nollan ja usean alkuperäistodisteen tapaukset
sekä muuttumaton oletuspolku. Pelkkä nopeampi kesto ei riitä. Vasta tämän,
tyypityksen ja katselmuksen jälkeen päätetään yksi uuden jäädytetyn lähteen
nimetty prosessitodennus nykyisessä rajassa. Ellei yksi rajattu ehdokas
riitä, raportoidaan jäljelle jäävä este; rajaus ei avaa uutta automaattista
vartijamuutosten sarjaa. Koko Goalin hyväksyntäportit säilyvät erillisinä.

**Rajattu koetulos:** ehdokas toimi vain testiajon muistissa kahden nimetyn
omistajan kohdalla; sovelluslähteet ja kaikki aikarajat säilyivät.
Tarkennetut 18 ehdokaskontrollia ja tyypitys läpäisivät. Alkuperäisen
toteutuksen vertailukontrollit läpäisivät omana rajattuna sarjanaan.
Kolmen lukukohdan yhdistetty vartija tuotti odotetun havaintomäärän,
ja valmiin nollan alkuperäistodisteen ketjun täydet valinnat sekä kirjattu
vartija-/muutosjärjestys vastasivat alkuperäistä. Fyysisen varauksen
havaintoraja ja admission-kuitit olivat kontrolloituja; cold-omistajan
toteutus ja tiedosto-operaatiot olivat nykyiset todelliset toteutukset.
Tämä ei ole käyttöjärjestelmävarauksen tai oikean cold-prosessin näyttö.

Sulun erillinen odotus, kertaluonteisen ensivirheen säilyminen, callbackien
vanheneminen operaation vielä jatkuessa sekä saman tavusisällön uusi
tiedostoidentiteetti todennettiin. Kahden alkuperäistodisteen rajattu kontrolli
varmisti molempien omistaja-/operaatioparien todellisen poissaololukijan
kutsumisen; se pysäytettiin ennen koko palautumista. Katselmuksessa löytyneet
testiväitteiden puutteet korjattiin, eikä korjaustarkistuksessa jäänyt löydöstä.

Ensimmäinen vertailu pysähtyi koefixturen puuttuvaan metodiin ennen varsinaista
työtä. Sen korjauksen jälkeisessä alkuperäisvertailussa yhden todisteen koko
ketju aikakatkaisi nykyiseen oletusrajaan; tämä hylkäys säilyy avoimena eikä
sitä ajettu uudelleen vihreäksi. Ehdokkaan ensimmäinen ajo läpäisi myös tämän
tapauksen, mutta yksittäinen tulos ei todista vanhan viiveen syytä korjatuksi.
Tarkennetut kontrollit eivät korvaa tätä puuttuvaa vertailuhyväksyntää.
Koetulos ei itsessään hyväksynyt tuotantokytkentää tai pitkää prosessikoetta;
niihin on sittemmin saatu yllä kirjattu rajattu päätös. Aiempia
epäonnistumisia, muita rooliketjuja tai koko Goalin
portteja ei suljeta tällä kokeella.

**Kytkennän valmistelu:** natiivin `removeSlot`-vartijan identiteettiluvun
ensisyyn peittyminen toistettiin kolmella regressiolla ennen korjausta.
Paikallinen vartijavirheen säilytys inventaarion retirement-omistajassa
korjaa muunnosrajan muuttamatta yhteistä tiedostotallenninta, tarkistusten
järjestystä tai oikeuksia. Korjauksen kontrollit sekä rmdir- ja journal-sync-
rajojen täsmennetyt väittämät läpäisivät. Alkuperäinen syyketju löytyi myös
nykyisestä oikeasti puretusta salatusta paketista tämän natiivin virhehaaran
kautta. Hallitusti viivästetty identiteettivastaus ei ole natiivin I/O:n katko.

Kahden omistajan kytkentä ja pysyvä cold-lukuvartijan regressiotiedosto ovat
työpuussa. Tyypitys, rajattu riippumaton lähde-/testikatselmus sekä neljän
kokonaisen vaikutusalueen tiedoston 100 testiä läpäisivät. Tämän jälkeen
sync-väitettä täsmennettiin vielä erikseen: vartijan puuttuminen nimenomaan
natiivin sync-metodin sisältä hylkää tarkoituksella puutteellisen koe-ehdokkaan.
Nykyinen toteutus läpäisi saman väittämän. Nimetty `after:quarantined`-
cold-prosessitodennus läpäisi jäädytetyllä lähteellä nykyisessä 60 sekunnin
rajassa. Vanhan lapsen päättyminen, jatko uudessa omistajassa, lopputila,
vieraat tavut ja fyysisen varauksen uudelleenotto varmistuivat; lähteet
säilyivät samoina. Erillinen neljän komento-/main-tiedoston 77 regression
sarja läpäisi. Testimääriä ei yhdistetä yhdeksi koko Goalin kattavuusluvuksi.
Muut katkot ovat erillisiä portteja, eivät tämän yhden ajon läpäisyjä.
Prosessifixture lataa nykyiset TypeScript-lähteet suoraan, ei aiempaa käännöstulosta.
Tämä ei muuta puhtaan paketin erillistä rakennus- ja hyväksyntävaatimusta.

###### Poistoketjun tarkistusvastuukartta

Tämä kartta kokoaa nykyisen W7.4-ketjun tarkistusvastuut omistajan pyytämää
selkeytystä varten. Se ei lisää uutta valvojaa, tarkistuskerrosta tai
rinnakkaista etenemissuunnitelmaa. Kartan kirjaaminen ei muuta jäljempänä
olevaa erillisen tuotantokytkentäpäätöksen tilaa.

Kolme eri vastuuta pidetään erillään: **valinta** sitoo alkuperäisen
yrityksen, rekisterin ja journalin; **luenta** tarkistaa voimassaolon,
omistajuuden, kirjoittajien poissaolon ja todelliset tiedostoidentiteetit;
**muutos** tarvitsee oman tuoreen sisältö- ja valintatodisteensa. Luentakuitti
ei anna muutoslupaa eikä aiempi onnistuminen korvaa seuraavan muutoksen vartijaa.

| Raja ja nykyinen omistaja | Mitä se todistaa | Missä täysi tarkistus säilyy |
| --- | --- | --- |
| Valmistelu, `workspaceDeletionPreparation.ts` ja `workspaceDeletionTarget.ts` | Alkuperäinen yritys-/rekisterivalinta, käyttäjän vahvistus, backup-kuitin valtuus, pyyntö/lease sekä pysäytetyn runtimen todellinen main-varaus. | Valinnan nykyiset tarkistukset ja valmistelun päättämisrajat. Synkroninen kelpoisuus ei korvaa asynkronista fyysistä varausnäyttöä. [Uusi koeehdotus](#valmistelun-ja-aloitusjulkaisun-tarkistusvastuu) ei vielä muuta sopimusta. |
| Mainin live-/cold-omistaja, `workspaceDeletionContinuation.ts` | Varauksen omistajuus, kirjoittajien päättyminen, build-/vierasomistaja- ja jatkovalinta sekä keskeneräisten töiden päättyminen. | Komennon vaiheiden ja huolto-/sulkusiirtymien nykyisillä rajoilla. Kevyt varausvartija ei korvaa koko cold-valintaa. |
| `workspaceDeletionCommand.ts` ja `workspaceDeletionPhaseSelection.ts` | Täsmällinen operaatio, alkuperäinen sidonta, journal-vaihe ja rekisterin ennen-/jälkitila. | Vaiheeseen tultaessa ja sen nykyisissä ulkoisissa vartijoissa; kuitti vanhenee vaiheomistajan sulkeutuessa. Komento järjestää vaiheet, ei poista tiedostoja. |
| Aloitusjulkaisu, `workspaceDeletionPublication.ts` | Täydellinen kohdeluettelo, alkuperäisjournalit ja käyttäjän backup-vahvistuksen tuoreus. | Luettelovertailut ennen backup-uusintalukua, sen jälkeen ja julkaisun varmennuksessa. Luettelo ei omista fyysistä poistoa. |
| Inventaariotallennin, `workspaceDeletionInventoryStore.ts` | Valitun luettelon tavut, EOF, roolien yhteisehdot, kansio-/tiedostoidentiteetit ja sarjallinen kulutus. | Rivit tarkistetaan myös puskurista sekä callbackin molemmin puolin. Rivi ei anna muutoslupaa. [Sisäisen rivitarkistuksen ehdotus](#inventaarion-rivitarkistus-ja-erillinen-muutosvaltuus) on hyväksytty vain rajattuun vertailukokeeseen. |
| Fyysinen vaihe, `workspaceDeletionPayloadExecutor.ts` | Alkuperäiset luettelorivit ja kohdesidonnat; siirron, purgen ja poissaolon oikea vaihe. | Kokonaisluennan reunoilla sekä jokaisen varsinaisen siirron, purgen ja journal-julkaisun nykyisissä vartijoissa. Sisäinen lukuvartija ei anna siirto- tai poistolupaa. |
| Rekisterijulkaisu, `workspaceDeletionRegistryPublication.ts` | Payloadien poissaolo ja täsmällinen rekisterisiirtymä. | Ennen rekisterimuutoksia ja tuloksen takaisinluennassa. Muuttuvan rekisterin slotit omistaa rekisteritallennin; ulkoinen vartija tarkistaa journalin eikä vaadi vanhaa rekisteritilaa oman kirjoituksen yli. |
| Metadatasiivous, `workspaceDeletionMetadataCleanup.ts` | Kolmen alkuperäisjournalin, sidontojen, aliaksien ja payload-poissaolon oikea yhteys. | Kokonaisluennan reunoilla ja alkuperäisjournalien sekä sidontojen jokaisessa nykyisessä poistovartijassa. Nimetyn alkuperäisjuurten sisäisen luennan muutosehdotus ja sen päätösraja ovat jäljempänä. [Jälkiluvun erillinen ehdotus](#metadatan-jälkiluku-ja-poistovaltuus) ei vielä muuta suojattua jälkilukua tai poistolupaa. [Alkuperäisen tuontijournalin uusi koeraja](#alkuperäisen-tuontijournalin-luku--ja-poistovastuu) odottaa erillistä päätöstä eikä muuta siivoojan tiukkaa sidontalukua. |
| Alkuperäisjuurten lukija ja yhteinen parent-lukija | Alun perin valitut kansioidentiteetit ja todellinen juurten poissaolo. | Alkuperäinen parent-vektori valitaan täysillä vartijoilla; sitä ei päivitetä uudeksi lähtötilaksi. Jokainen myöhempi luenta vertaa siihen. Yhteisen parent-lukijan ja muiden kutsujien oletus säilyy ehdotuksessakin. |
| Viimeistelijä, `workspaceDeletionFinalization.ts` | Terminal-julkaisu, metadatan poissaolo, inventaarion retirement ja journalin viimeinen poisto. | Nykyiset täydet alku-/loppu- ja muutosvartijat sekä [hyväksytty alkuperäisjuurten ja metadataluvun kytkentä](#viimeistelijän-rajattu-luentavastuuehdotus). Sen havaintoero tai coldin kolmen luentakohdan varausportti eivät laajene valmisteluun tai muihin vaiheisiin. |
| Natiivit slot-/tiedosto-omistajat ja `workspaceDeletionInventoryRetirement.ts` | Valitun tiedoston identiteetti ja tavut, omat muuttuvat slotit, välitön muutosvartija, sync ja sulku. | Varsinaisissa poisto-, rename-, rmdir- ja sync-rajoissa niiden nykyisen sopimuksen mukaan. Ulompi onnistunut tarkistus ei korvaa natiivin kutsun omaa vartijaa. |

Kertautuminen luokitellaan kutsuketjun perusteella, ei pelkän samannimisen
funktion perusteella. Valtuuden tarkistus odotuksen jälkeen, uusi todellinen
identiteettiluku ja ennen muutosta tehtävä uusi sisältötarkistus voivat olla
eri tarpeita. Sen sijaan täydellisen vaihe-/rekisterivalinnan käynnistäminen
uudelleen jokaisen sisäisen parent-luvun sisältä on tämän kartan ja pienten
kokeiden osoittama nimetty toistokohta.

**Tämän kartan alkuperäinen hyväksytty toteutusraja:** vain `workspaceDeletionMetadataCleanup.ts` ja
`workspaceDeletionOriginalPayloadAbsence.ts`, niiden pysyvät regressiot ja
nykyiset vaikutusalueen portit. Metadatasiivooja antaa lukijalle rajatun
omistajuus-/kirjoittajavartijan; lukija pitää täyden vaihe-/rekisterivalinnan
kunkin kokonaisen lukukierroksen reunoilla ja vertaisi todelliset kansiot
alkuperäiseen valintaan. Uuden luentakutsun ensisyy säilytetään paikallisesti.
Koko ketjun muita tarkistuksia ei poisteta, yhteistä tallenninta ei muuteta
eikä luentatodisteita välimuistiteta muutosten yli. Tämän nimetyn ehdotuksen
havaintoero ja tuotantoportti ovat seuraavassa kohdassa. Kartta ei väitä pitkän
poistoketjun ongelmaa ratkaistuksi ennen sen revisionmukaista integraationäyttöä.

**Julkaisun rajattu jatkokysymys, ei tuotantopäätös:** nykyisen
23 rivin julkaisudiagnoosi läpäisi alkuperäiset julkaisuväittämät,
riippumattoman rivivertailun, journalin tavut ja säilyvät vieraat tavut.
Fyysistä jatkoa ei ajettu. Sovelluslähde säilyi muuttumattomana.
Nykyinen `workspaceDeletionInventorySources.records` käyttää kaapattua
enintään 64 rivin sivua kerran. Myöhempi kulutus lukee tuoreen sivun ja
sen jälkeen vielä täydellisen alkuperäiseen census-hashiin verratun
lähdekierroksen. Katselmuksessa selvitetään, voisiko sama muuttumaton
alkuperäinen sivu toimia myöhemminkin vain odotettuna vertailuaineistona,
ei tuoreena luentatodisteena. Jokaisen kierroksen tuore koko census,
parentit, alkuperäisjournalit, kaikki kolme julkaisun lähdevertailua ja
varsinaisten muutosten vartijat säilyisivät.

Tämä ei automaattisesti kuulu aiempaan luentakytkentään. Katselmuksen on
osoitettava census-arvon kattavan kaikki projektiossa käytetyt tiedot,
erotettava odotettu lähtötieto muutosvaltuudesta sekä nimettävä myöhempien
kulutusten muuttuva havaintoikkuna. Myös sivuraja, osittaisen kulutuksen
mitätöinti, alkuperäinen virhe ja todellinen sulku sekä viimeinen vertailu
on katettava. Kasvavaa välimuistia, parent-vartijan aiemmin hylättyä
yleiskevennystä tai koko luettelon muistiin lataamista ei ehdoteta.
Nykyistä kertakäyttösopimusta tai sen regressiota ei muuteta ennen
katselmoitua täsmällistä sopimusta ja tarvittavaa päätöstä.

###### Julkaisun odotettu sivu ja tuore lähdetodiste

**4.11.2026: rajattu vertailukoe ja katselmus tehty; hyväksytty
tuotantokytkentä on työpuussa ja sen portit sekä kokonaisketjun näyttö
puuttuvat.** Pienempi ehdokas koskee vain `workspaceDeletionInventorySources.ts`:n
alkuperäistä sivua, kun sen projektiorivien määrä workspace-rivi mukaan
lukien on **alle** nykyisen `workspaceDeletionDirectoryEntryPageSize`-rajan.
Silloin koko projektio mahtuu jo kaapattuun sivuun. Täsmälleen sivurajan
kokoinen ja suurempi aineisto säilyttää nykyisen kertakäyttöisen sivun ja
tuoreen kursoroidun luennan. Tämä ei rajoita sallittua poistokohteiden määrää.

Ehdokkaassa yksityinen jäädytetty sivu on vain **odotettu lähtöaineisto**
saman lähdevalinnan myöhempiin kulutuksiin. Se ei ole tuore havainto,
valtuus, muutoskuitti tai restartissa käytettävä välimuisti. Uutta
rajapintaa, pysyvää tiedostoa, formaattia tai kasvavaa luetteloa ei tarvita.
Jokainen kokonainen kulutus suorittaa edelleen nykyisen
`assertUnchanged()`-tarkistuksen: alkuperäisjournalit, parent-identiteetit
ja tuore kaikkien lähteiden census verrataan alkuperäiseen valintaan.
Tallennin odottaa lähteen EOF:n ja kahvojen sulun ennen onnistumista;
osittainen kulutus mitätöi saman lähdevalinnan edelleen.

Julkaisijan kolme riippumatonta luettelovertailua, niiden välissä tehtävä
backup-uusintaluku, todellisen inventaariotiedoston tavut/hash/identiteetti
sekä kaikki kirjoitus-, siirto-, poisto- ja sync-vartijat pysyvät ennallaan.
Fyysinen jatko hankkii oman tuoreen vaihe- ja rivivaltuutensa; pelkkä
muistissa olevan rivin saaminen ei anna sitä.

**Havaintoero:** myöhemmän kulutuksen pois jäävä `readPage` voi nykyisin
havaita muutoksen, joka on täysin palautunut ennen säilyvää EOF-censusta.
Ehdokas voisi hyväksyä tällaisen kulutuksen; samanaikaisten virheiden
ensimmäinen havainto voi vaihtua. Pysyvä muutos ja havaittu valtuusvirhe
estävät jatkon. Tätä ei kuvata samaksi havaintorytmiksi tai atomiseksi
tilannekuvaksi. Kokeen tulos ei itsessään hyväksy havaintoeroa tuotantoon.

Lähdekatselmus ja rajattu riippumaton tarkistus eivät löytäneet projektion
kenttää tai hylkäysehtoa, joka jäisi census-arvon ja kiinteän kontekstin
ulkopuolelle. Inspectionin valittu root on hashatun observed-taulukon ainoa
läsnä oleva alkio; koko location sekä observed-ancestorit ovat mukana.
Kiinteä workspace/parent- ja original-proof-valinta on osa todistusta:
pelkkä hash ei korvaa niiden tuoreita tarkistuksia. Tämä on lähdepäätelmä,
ei uuden haaran ajonaikainen turvallisuus- tai suorituskykynäyttö.

Rajattu koe käyttää nykyisiä lähde-, julkaisu- ja tiedostotestipohjia:

- 1, 63, 64 ja 65 rivin rajat, usea kulutus, järjestys, yksikäsitteisyys,
  muuttumattomat rivit sekä sivurajalta alkaen muuttumaton oletuspolku
- toisessa ja kolmannessa kulutuksessa pysyvästi muuttuneet sidontatavut,
  sivuslotit, juuret, vieras aineisto ja myöhäinen lisäys ennen EOF:ää;
  erillinen vertailukoe täsmälleen palautuvalle muutokselle
- osittainen kulutus, vanhentunut valtuus ja pidetyn oikean tiedostoluvun
  loppuun odottaminen; ensivirhe ja erillinen sulkuvirhe, myös `undefined`
- oikean julkaisijan kolme vertailua, backup- ja julkaisurajan virheet,
  journalin säilyminen sekä nolla fyysistä poistoa epäonnistumisessa
- vastakoe, jossa tuore EOF-tarkistus poistetaan tarkoituksella: pysyvän
  muutoksen kontrollin on havaittava virhe; pelkkä kutsumäärä ei riitä.

Vertailukoe käytti nykyisiä fixturejä ja aikarajoja. Sivurajakontrollit,
nykyinen aito monisivuinen luenta, pysyvät lähdemuutokset, virhe-/sulkuketjut
ja julkaisijan nykyiset portit toimivat ehdokkaassa. Myöhempien kulutusten
kesken lisätty vieras sidonta esti EOF:n hyväksynnän. Oikeiden
kansiolukujen vertailu osoitti yhden `readPage`-lähdekierroksen jäävän pois
kustakin myöhemmästä pienestä kulutuksesta; tuore EOF-census säilyi.
Tahallisesti puuttuva tai liian aikainen EOF-tarkistus jäi kolmessa
vastakontrollissa kiinni. Tyypitys läpäisi ja riippumaton jatkokatselmus
ei löytänyt jäljelle jäävää puutetta rajatusta kokeesta.

Havaintoero todistettiin erikseen: samaan lähdepuuhun lisätty ja ennen
EOF:ää poistettu vieras kansio hylkäsi nykyisen myöhemmän sivuluennan,
mutta ehdokas hyväksyi alkuperäiseen tilaan palautuneen loppucensuksen.
Sidontatiedoston kirjoittaminen ja pelkkien tavujen palauttaminen ei sen
sijaan palauttanut slotin koko identiteettiä; molemmat versiot hylkäsivät
tämän tilanteen. Kokeen alkuperäinen väärä oletus ja ajurivalinnan
valmistelupuute säilyvät [koehistoriassa](release-0.3.0-integration-history.md#w74n-odotetun-sivun-vertailukoe-4112026),
eivät sovelluksen korjatuiksi nimettyinä vikoina.

**4.11.2026: omistaja hyväksyi tämän yhden omistajan tuotantokytkennän**
edellä kuvatulla havaintoerolla, pysyvillä regressioilla ja nykyisillä
porteilla. Kytkentä ja regressiot ovat työpuussa. Normaali desktop-tyypitys
sekä lähdeluennan vanhat ja uudet kontrollit läpäisivät; katselmuksen
aikaleimariippuvuus korjattiin deterministiseksi. Julkaisun kohdeportti
jäi kahteen aikakatkaisuun. Yksi rajattu samalähteinen diagnoosi läpäisi
sivuslotin tapauksen, mutta metadatan ennakkosiivouksen tapaus aikakatkaisi
edelleen. Näitä ei nimetä korjatuiksi tai ohiteta.

Nykyinen rajattu vaiheseuranta osoitti ketjun etenevän kolmanteen
julkaisuvertailuun ennen katkaisua. Ennakkosiivouksen ja sitä seuraavan
lähdekaappauksen tarkistusvastuu arvioidaan seuraavaksi ennen uusia
muutoksia; turvatarkistuksia ei poisteta eikä aikarajaa nosteta. Tämä
diagnoosi ei ole lähdejäädytetty integraatiohyväksyntä. Aiempi koe ei
muuttanut sovelluslähteitä tai ajanut pitkää 23 kohteen ketjua.
Kytkennän kohdeporttien, katselmuksen ja lähdejäädytyksen jälkeen
koko ketjun nopeutuminen sekä siivous todistetaan samalla 23 kohteen
ketjulla nykyisessä 180 sekunnin rajassa. Aikaisemmat hylkäykset ja muut
W7.4:n hyväksyntäportit säilyvät avoimina.

###### Ennakkosiivouksen ja lähdekaappauksen yhteinen vertailu

**4.11.2026: omistaja hyväksyi kolmen nykyisen omistajan tuotantokytkennän,
pysyvät regressiot ja nykyiset portit. Kytkentä on työpuussa; sen oma
todennus on kesken.** Kytketyn lähteen normaali tyypitys, rajattu deltakatselmus
ja seitsemän tiedoston 174 testiä läpäisivät ilman ohituksia. Erillinen
143 testin vaikutusajo läpäisi myös oikean prosessin 13 tapausta ja kahdeksan
keskeytysvaihetta. Nykyinen salaus-/purkutodennus sekä mittausliitoksen
kontrollit ja tyypitys läpäisivät. Saman 23 kohteen kokonaisketjun yksi
todennus aikakatkaisi viimeistelyssä nykyisellä rajalla. Julkaisu, fyysinen
vaihe, rekisterijulkaisu ja metadatasiivous valmistuivat. Ensivirheet ja
keskeneräinen aineisto säilyvät; lopullista siivousta tai koko W7.4:ää ei
hyväksytä osavaiheiden perusteella. Seuraava rajattu kysymys koskee yhteisen
inventaarion rivivartiointia suhteessa kutsujien varsinaisiin muutoksiin,
ei uutta hyväksyttyä kevennystä tai aikarajan nostoa.
Hyväksytty vertailukoe, tyypitys ja rajattu riippumaton
katselmus säilyvät erillisenä koenäyttönä.
Omistajan hyväksymä havaintoero säilyy jäljempänä kuvattuna. Tämä ehdotus koskee vain
`workspaceDeletionPublication.ts`-, `workspaceDeletionInventorySources.ts`-
ja `workspaceDeletionRemnantCensusSelection.ts`-omistajien alkuvaihetta.
Edellä hyväksytty pienen odotetun sivun käyttö säilyy erillisenä muutoksena.
Nykyinen julkaisuportti on yhä avoin; tätä suunnitelmaa ei käytetä sen
hyväksyntänä tai perusteena muuttumattoman pitkän ajon uusimiselle.

Nykyinen järjestys valitsee valmistelun lopuksi census-lähtötilan A,
kaappaa lähteelle uuden lähtötilan B ja lukee valmistelun vertailun C.
Ennen ensimmäistä lähderiviä vaaditaan C = A; lähteen myöhemmät EOF-luvut
vertaavat B:hen. Ehdotuksessa sama tuore B-luenta **verrataan suoraan A:han**
ennen lähteen palauttamista. Erillinen C-luenta jää pois. Valmistelun
alkuperäinen viimeinen vertailu, kuitatut siivouskierrokset ja odotetun
jäännöksen tarkistus eivät muutu. Säästöehdokas on yksi kokonainen
alkuvaiheen census, ei kaikkien ennakkosiivouksen tarkistusten poistaminen.

**Toteutussopimus pienelle kokeelle:**

- Census-omistajan nykyinen luku-/hash-toteutus jaetaan vain sen sisäisellä
  apufunktiolla. Valmistelun viimeinen tiiviste pysyy yksityisessä sulkeumassa;
  uutta parseria, valvojaa, WeakMap-rekisteriä, pysyvää kuittia tai yleistä
  välimuistia ei tehdä. Tavallisen census-lukijan oletus ja palautusmuoto säilyvät.
- Valmistelutulos säilyttää nykyisen `assertUnchanged()`-metodinsa ja saa
  rajatun `captureInventoryCensus(context, selectedAuthority, observe)`-
  metodin. Se **tekee** tuoreen koko luennan, ei hyväksy valmiiksi luettua
  kuittia, kutsujan tiivistettä tai onnistumisväitettä. Nykyinen source-omistaja
  antaa oman elävän `selectedAuthority`-vartijansa ja synkronisen rajatun
  projektionsa. Kaikki havainnot hashataan ennen projektiota; projektio ei
  suodata census-sisältöä, muuta tiedostoja tai käynnistä asynkronista työtä.
- `context` sitoo kanonisen juuren, koko validoidun inventory-headerin sekä
  samat alkuperäisjournalin valinta-, perusvaltuus- ja lukuadapterioliot.
  Poikkeava konteksti tai vanhentunut valinta hylätään ennen uuden census-luvun alkua.
  Alustuksen luovutus sallitaan kerran; virhe ei mahdollista uudelleenvalintaa.
- Lähdetehdas saa yhden valinnaisen `prepared`-argumentin. Vain sen puuttuminen
  valitsee nykyisen oletuspolun; virheellinen tai epäonnistunut valmistelutulos
  ei koskaan putoa uuteen itsenäiseen lähtötilaan. Workspace-/parent-valinta
  pysyy valmistelun jälkeen nykyisessä lähdetehtaassa.
- Järjestys on: lähteen alkuperäisvalinta, parent-kaappaus, valmistelun
  alkuperäisvalinta, tuore koko census ja sulku sekä vertailu A:han,
  valmistelun alkuperäisvalinta, parent-uusintaluku ja lähteen alkuperäisvalinta.
  Lähdettä tai projektiorivejä ei palauteta ennen kaikkien päättymistä.
  Valmistelun omaa terminal-vertailua ei yhdistetä tähän luentaan.
- Uusi lähde saa tavallisen census-kuitin omalla `selectedAuthority`llaan,
  ei valmistelun alkuperäisjournalit uudelleen tarkistavaa käärettä.
  Näin tulevien EOF-lukujen nykyiset alkuperäis-/parent-reunat ja virhetilan
  elinikä säilyvät eikä niihin lisätä uutta sisäkkäistä tarkistuskerrosta.
- Julkaisija välittää valmistelutuloksen lähdetehtaalle ja poistaa vain
  tähän yhdistetyn erillisen `prepared.assertUnchanged()`-kutsun.
  Kaikki kolme julkaisuvertailua, backup-uusintaluku, jokaisen kulutuksen
  tuore EOF, varsinaisten tiedostomuutosten/syncin vartijat sekä alkuperäis-
  ja parent-tarkistukset säilyvät. Luentakuitti ei anna poistolupaa.
- Ensivirhe, myös `undefined`, erotetaan puuttuvasta virheestä. Havaittu
  epäonnistuminen mitätöi luentavaltuuden ennen sen omaa siivousta; aloitettu
  luku/sulku odotetaan ja erillinen sulkuvirhe säilytetään. Ulomman omistajan
  ei väitetä havaitsevan sisemmän virhettä ennen sen välittymistä.

**Nimenomainen havaintoero:** B:ssä havaittu mutta ennen C:tä palautuva
muutos hylätään ehdokkaassa jo lähteen kaappauksessa. Toisaalta vain pois
jäävässä C-luennassa näkyvä ja ennen säilyviä tarkistuksia täysin palautuva
muutos voi jäädä havaitsematta. Myös alkuperäis-/parent-havaintojen ajoitus
ja samanaikaisten virheiden ensimmäinen syy voivat muuttua. Peräkkäiset
tiedostoluvut eivät kummassakaan mallissa muodosta atomista tilannekuvaa;
tiiviste vertaa koodattuja havaintoja, ei jatkuvaa tiedostojärjestelmän
muuttumattomuutta. Pysyvä havaittava muutos estää jatkon. Tämä uusi raja
ei peri edeltävän sivuluentamuutoksen tuotantohyväksyntää; omistaja hyväksyi
sen erikseen myös tämän kolmen omistajan kytkentään.

Koe käyttää nykyisiä census-, valmistelu-, lähde- ja julkaisufixturejä:

1. Kontekstien ristiinkäyttö, vanhentunut alkuperäisvalinta ja valtuus,
   peruttu/kahdesti käytetty luovutus sekä muuttumaton oletuspolku.
2. Kuittaamaton siivous, odotetusta jäännöksestä poikkeava sisältö,
   payloadin paluu, säilyvä alkuperäisjournalin sidonta ja vieraat tavut.
   Valmistelun jo kuitattuja sallittuja metadatapoistoja ei väitetä perutuiksi.
3. Koko census-projektion ulkopuolinen muutos: vieraat sidontatavut,
   current/next/backup, juuret, identiteetit ja kursorin taakse tullut lisäys.
   Alustuksen hylkäys ei saa tuottaa lähderiviä tai authorized-onnistumista.
4. Hallitut B-/C-havaintoerot sekä sekoittuneen peräkkäisluennan kontrolli;
   pidetty aito luku/sulku, projektiovirhe, ensivirhe ja erillinen sulkuvirhe.
   Vanha callback ei saa elpyä uudessa luvussa.
5. Nykyiset 1/63/64/65-rivirajat, osittainen kulutus, kaikki tuoreet EOF-luvut,
   kolme todellista julkaisuvertailua ja backup-järjestys. Tahallisesti
   poistettu A/B-vertailu tai liian aikainen lähteen palautus hylätään.

Työmääränä verrataan yhden alkuvaiheen census-kierroksen poistumista, ei
pelkkää testin läpäisyä. Vaiheajat ja tarkat kutsumäärät pysyvät paikallisina.
Pienet vertailut, tyypitys, ensivirheen nykyinen salattu lukuketju ja
riippumaton deltakatselmus edeltävät tuotantopäätöstä. Testien, sovelluksen
ja CI:n aikarajoja ei muuteta. Vasta kytkennän omien porttien jälkeen
todennetaan sama 23 kohteen ketju nykyisessä 180 sekunnin rajassa.
Suunnitelma ei lupaa tämän yhden säästön riittävyyttä eikä sulje aikaisempia
hylkäyksiä, puuttuvia siivoustodisteita tai W7.4:n integraatioportteja.

**Koenäyttö:** lähtöpolun yhteiset kontrollit ja ehdokkaan 23 rajakontrollia
läpäisivät. Kuuden nykyisen vaikutustiedoston ehdokasajo läpäisi 166 testiä
ilman ohituksia; mukana oli ennakkosiivouksen julkaisutapaus nykyisellä
rajallaan. Katselmuksen kolme näyttöpuutetta täydennettiin yhdeksällä
läpäisseellä kontrollilla: sama fyysinen ohimenevä muutos molemmissa poluissa,
aidon alkuperäisjournalin järjestys ja myöhempien EOF-lukujen tarkistusmäärä
sekä projektiovirhe ja keskeneräisen sulun elinikä. Puuttuva A/B-vertailu ja
liian aikainen palautus hylättiin tarkoituksella rikotuissa vastakokeissa.
Tyypitys ja nykyinen alkuperäisvirheen salaus-/purkukoe läpäisivät;
rajattu deltakatselmus sulki näyttöpuutteet. Päällekkäisiä sarjoja ei summata.
Yksi alkuvaiheen census jäi pois, myöhempien EOF-lukujen tarkistukset säilyivät.
Sovellus- ja nykyiset testilähteet eivät muuttuneet. Pitkää 23 kohteen
ketjua ei ajettu eikä sen nopeutumista tai vanhojen timeoutien syytä todistettu.
Tarkempi koehistoria on [integraatiohistoriassa](release-0.3.0-integration-history.md#w74n-valmistelun-ja-lähdekaappauksen-vertailukoe-4112026).

###### Inventaarion rivitarkistus ja erillinen muutosvaltuus

**4.11.2026: hyväksytty rajattu vertailukoe tehty; ehdokasta ei hyväksytä
tuotantokytkentään.** Peruslukijan lähtö- ja ehdokasvertailut läpäisivät,
mutta vaikutusportti jäi 53 aikakatkaisuun. Alla olevan ehdotuksen
rajaukset säilyvät koesopimuksena, eivät tuotannon uutena tarkistussääntönä.
Ei aikarajamuutosta tai uutta pitkää ajoa. Nykyinen
`consumeSelectedRecords` palvelee sekä tarkistavia että tiedostoja muuttavia
callbackeja. Niitä ei luokitella kevyiksi pelkän kutsujan tiedostonimen
perusteella: sama fyysinen etenijä tarkistaa, siirtää ja poistaa; sama
metadatasiivooja sekä tarkistaa poissaoloa että poistaa metadataa.
Kytkennän vaikutus ulottuisi kaikkiin kuuteen runtime-kutsukohtaan:
fyysisen etenijän yhteiseen lukukääreeseen, rekisterin poissaololukuun,
metadatasiivoojan poissaolo-, ennakko- ja poistokierrokseen sekä
viimeistelijän poissaololukuun. Myös paketoidun testin valmisteluskriptin
tarkistava kulutus kuuluu vaikutustarkistukseen.

Tallennin omistaa luettelon tavut, tiivisteen, EOF:n, roolien yhteisehdot,
alkuperäiset kansio-/tiedostoidentiteetit, kahvan ja sarjallisen kulutuksen.
Vaiheomistaja omistaa journalin, rekisterin, kirjoittajien poissaolon ja
voimassa olevan valtuuden. Varsinainen siirto-/poisto-/slot-omistaja vaatii
oman tuoreen muutosvartijansa. Tallentimen toimittama rivi ei korvaa sitä.
Tarkistava callback voi myös toimia kirjoitusvartijan sisällä; sen lukutulos
ei silloinkaan ole itsenäinen kirjoituslupa.

**Pienin koeehdokas:** vain `workspaceDeletionInventoryStore.ts`:n
kulutuksen sisäinen `assertCurrent`. Se kutsuu ulkoista valintavartijaa
nyt neljästi: ennen kansioidentiteettejä, niiden jälkeen, nimiluennan
jälkeen ja kahva-/polkuvertailun jälkeen. Ehdokas säilyttää ensimmäisen ja
viimeisen. Se ei poista yhtään rivirajaa, tiedostohavaintoa tai callbackin
omaa muutosvartijaa. Uutta lukutilaa, julkista argumenttia, välimuistia,
valtuuskuittia tai rinnakkaista lukijaa ei lisätä.

- Sama `assertCurrent` tehdään ennen kulutusta, jokaisen `next()`-palautuksen
  jälkeen myös EOF:ssä sekä jokaisen callbackin jälkeen. Puskuroidut rivit
  eivät ohita tarkistusta. Kokonainen ennakkovalidointi ja ristirooliluenta
  päättyvät edelleen ennen ensimmäistä callbackia.
- Alkuperäisten parent-/operaatiokansioiden identiteettiluvut, täsmällinen
  nimiluettelo, kahvan metadata sekä polun todelliset metadata-/realpath-luvut
  säilyvät samassa järjestyksessä. Vertailukohta on alkuperäinen `before`,
  ei muuttuneen tiedoston uusi lähtötila. Synkroniset valtuustarkistukset
  säilyvät jokaisen nykyisen I/O-rajan ympärillä.
- Toteutus saa erottaa vain tallentimen yksityisen kansio-/nimiluennan
  nykyisistä kääreistä. `beforeMutation` ja `assertNames` säilyttävät muiden
  kutsujien nykyiset ulkoiset vartijat ja järjestyksen. `publish`, `inspect`,
  `assertRecords`, kulutuksen avaus-/sulkureunat ja natiivit mutaatiot eivät
  saa tätä kevennystä. Yhteinen tiedosto- tai stream-omistaja ei muutu.
- Callbackit odotetaan sarjallisesti. Ensivirhe, myös `undefined`, ilmoitetaan
  nykyiseen havaitsijaan ennen omaa sulkua; iteratorin ja kahvan sulku
  odotetaan ja erilliset sulkuvirheet säilyvät. Havaittua valtuusvirhettä
  ei nollata eikä epäonnistunutta luentaa käytetä uudelleen.

**Uusi havaintoero:** vain pois jäävässä kahdessa ulkoisessa tarkistuksessa
näkyvä ja ennen säilyvää tarkistusta täysin ennalleen palautuva ulkoinen
tila voi jäädä havaitsematta. Tämä koskee kutsujan valinta-, varaus- ja
kirjoittajien poissaolotarkistuksia, ei vain rekisteritietoa. Ero koskee
myös kirjoitusvartijan sisällä tehtävää luentaa. Seuraavaan säilyvään
tarkistukseen jäävä muutos estää callbackin, seuraavan rivin tai onnistumisen
kyseisen rajan mukaan. Callbackin jälkeinen hylkäys ei peru jo valmistunutta
tiedostomuutosta. Välittömät muutosvartijat todistavat oman nykytilansa,
eivät pois jäävän tarkistushetken historiaa.
Jo päättynyt valtuus ei elvy. Samanaikaisten virheiden ensimmäinen syy ja
havaintohetki voivat muuttua; peräkkäiset luvut eivät muodosta atomista
tilannekuvaa. Tämä ei ole aiempien kutsujakohtaisten kevennysten hyväksymä
yleinen poikkeus. Omistaja hyväksyi tämän erikseen vain rajattuun kokeeseen.

**Pienet vertailut ennen kytkentäpäätöstä:** nykyinen inventaariokulutuksen
fixture ja rajatut kutsujatestit, ei uutta testialustaa.

1. Lähtö ja ehdokas: kaikki nykyiset 0-/usean rivin, EOF-, hash-, rivimäärä-,
   ristirooli-, saman inode-tiedoston muutos-, parent-, sivuslotti- ja
   puskuroidun rivin kontrollit. Tiedostohavaintojen määrä ja järjestys
   säilyvät; vain nimetyt kaksi ulkoista kutsua poistuvat kustakin
   `assertCurrent`-kierroksesta. Avaus-/loppureunat mitataan erikseen.
2. Pysyvä ja palautuva ulkoinen muutos juuri kummassakin pois jäävässä
   kohdassa, sekä säilyvissä alku-/loppukohdissa. Ero osoitetaan samalla
   hallitulla muutoksella molemmissa poluissa, ei vaihtamalla vastakoetta.
3. Todellinen siirto/purge ja metadatan slot-poisto: luettu rivi ei oikeuta
   muutokseen väärällä vaiheella, sidonnalla tai päättyneellä valtuudella.
   Säilyvät kohde-/vieraat tavut ja välittömät poisto-/sync-vartijat
   todennetaan, myös tarkistavan luennan ollessa muutosvartijan sisällä.
4. Pidetty callback, tiedostoluku, iteratorin sulku ja kahvan sulku;
   ensivirhe erillään myöhemmästä sulkuvirheestä ja päättynyt luentavaltuus.
   Liian aikainen palautus sekä tahallisesti pois jätetty loppuvartija
   hylätään vastakokeissa. Nykyinen salattu alkuperäisvirheen lukuketju säilyy.
5. Fyysisen etenijän, rekisterijulkaisun, metadatasiivouksen ja viimeistelijän
   nykyiset vaikutustestit, tyypitys ja riippumaton rajattu katselmus.
   Kutsujan omia vartijoita ei muuteta vastaamaan ehdokasta.

Koe ei muuta sovelluslähdettä tai aikarajoja. Kutsumäärän väheneminen on
työmääränäyttöä, ei lupaus koko ketjun nopeudesta. Mahdollinen tuotantokytkentä
ja sen jälkeen sama 23 kohteen ketju nykyisessä 180 sekunnin rajassa
edellyttävät erillistä hyväksyttyä jatkoa ja nykyisiä portteja. Vanhat
hylkäykset, viimeisen ajon puuttuva loppusiivous ja koko W7.4 pysyvät avoimina.

**Koetulos ja jatkoraja:** molempien versioiden viiden tiedoston vertailussa
131 testiä läpäisi ja yksi ennestään alustarajattu tapaus jäi ajamatta.
Pienet havaintoero-, tiedostojärjestys- ja oletuspolkukontrollit läpäisivät.
Puuttuva loppuvartija ja liian aikainen iteratorisulusta palautuminen
hylättiin tahallisesti rikotuissa vastakokeissa. Täydennettyjen koetilojen
tyypitys läpäisi. Koeväitteiden puskurioletus, apukontrollin tekstirajan
paikannus ja kielteisen tilan käynnistysvalinta korjattiin vain yksityiseen
koeajuriin; ensihylkäykset säilytettiin.

Ehdokkaan viiden vaikutustiedoston 240 tapauksesta 187 läpäisi ja 53
aikakatkaisi: metadatasiivouksessa 47, rekisterijulkaisussa viisi ja
siirto-/purge-integraatiossa yksi. Fyysisen etenijän 36 ja viimeistelijän
11 tapausta läpäisivät. Tämä ei hyväksy koko natiiviketjua. Kaikki 53
alkuperäistä virhetietuetta säilytettiin nykyisestä keräyksestä ja niiden
tavut varmennettiin; puuttuvaa lopullista siivoustodistetta ei päätellä.

Kolmen epäonnistuneen metadatatapauksen erillinen lähtövertailu ilman
koemuunnosta aikakatkaisi yhden ja läpäisi kaksi. Se ei ole koko lähtösarjan
vertailu eikä selitä ehdokkaan hylkäysten syytä. Rajattu katselmus ei
osoittanut varmaa toteutusvirhettä, mutta polkutarkistuksen valmistumisrajan
todistus ja laajempi välittömien muutosrajojen kattavuus jäivät avoimiksi.
Numeeriseen tarkistuskutsumäärään perustuvaa portinvalintaa ei löytynyt
`secondBindingFixture`-/`tapSecondBindingRead`-valmistelusta; tämä ei vielä
kerro aikakatkaisun odottavaa kutsua.

Kutsujen vähenemistä ei tulkita nopeuskorjaukseksi: fyysisen etenijän ja
metadatasiivoojan vilkkaat sisäiset lukuvartijat käyttävät kirjoittajien
poissaolotarkistusta. Niiden todelliset identiteetti- ja polkuluvut eivät
vähene tässä ehdokkaassa. Seuraava rajattu työ on jo epäonnistuneen
lähtötapauksen vaihemittaus nykyisellä testiapurilla: valmistelu, todelliset
levyluvut ja siivous erotellaan nykyisen testirajan sisällä. Uutta vartija-
tai havaintoikkunamuutosta ei hyväksytä tämän tuloksen perusteella.
Sovellus- ja nykyiset testilähteet säilyivät muuttumattomina. Uutta
salaus-/purkutodennusta, pakettia, pitkää 23 kohteen ajoa tai CI-kierrosta
ei tehty; koko W7.4:n portit ovat avoimina. [Tulos on historiassa](release-0.3.0-integration-history.md#w74n-inventaarion-rivitarkistuksen-vertailukoe-4112026).

**Lähtöversion vaihediagnoosi tehty 4.11.2026:** yhden alkuperäisjournalin
synkronointivartijan testin valmistelu päättyi. Aikaraja täyttyi varsinaisessa
siivouksessa ennen tavoiteltua synkronointivirheen injektiota; loppuvertailu
ei alkanut. Katkaisuhetken kolme keskeneräistä mittarikutsua olivat
`removeSlot`, sen ryhmän `inspectSlots` ja `lstat`. Saman ryhmän kaikki
`withCommittedCleanup`-kutsut olivat jo päättyneet: mittaus ei todista
niiden olleen keskeneräisenä pinona katkaisuhetkellä. Mittarin seuratut työt
päättyivät ja alkuperäinen aikakatkaisu säilytettiin, mutta siitä ei
päätellä koko testiprofiilin tai prosessien siivousta.

Seuraava lähdekatselmus rajataan alkuperäisjournalin natiiviin poistovartijaan,
sen rekisterivalintaan ja sidontaluentaan. Yhteinen slottitallennin omistaa
muuttuvat slotit ja viimeisen täydellisen tarkistuksen. On selvitettävä,
voisiko sen nykyinen erillinen luentaportti soveltua myös tähän kutsuun
vai rikkooko se alkuperäisjournalin valinta-/sisältösopimusta. Tämä on
avoin turvarajakysymys, ei hyväksytty muutos. Viimeinen sidontaluku purged-
todisteen jälkeen, välittömät poisto-/sync-vartijat sekä muut kutsujat
säilyvät. Tarvittava havaintoero ja oma koepäätös ratkaistaan ennen koetta.
Testin valmistelua ei pienennetä eikä aikarajaa nosteta vain läpäisyn vuoksi.

###### Alkuperäisen tuontijournalin luku- ja poistovastuu

**4.11.2026: omistaja hyväksyi vertailukokeen jälkeen yhden tallentimen
tuotantokytkennän, saman havainto-/virhejärjestyseron ja pysyvät regressiot.
Laaja jatkovaltuus kattaa normaalin todennuksen ja ennakkoporttien jälkeen
saman 23 kohteen ketjun nykyisellä rajalla; ei aikarajamuutosta tai
hyväksyntäehtojen poikkeusta. Kytkennän todennus on kesken.**
Kohde on vain `WorkspaceBackupImportJournalStore.clearAfterDeletionPurged`.
Metadatasiivooja, sidontatallennin, yhteinen slottitallennin, natiivi
tiedostokerros sekä adoption-/activation-journalit säilyvät muuttumattomina.
Uutta kutsujaparametria tai yleistä kevyttä tarkistustilaa ei ehdoteta.

**Nykyinen vastuunjako ja ehdokas:** `E` on kaapattu ulkoinen valintavartija,
`P` on `assertDeletionPurged` ja `S` on nykyisten `current`-, `next`- ja
`backup`-slottien tavujen sekä identiteettien vertailu. Metadatasiivoojan
`journalContext` sisällyttää `E`:hen edelleen viimeisen tiukan
`selectedBinding`-tarkistuksen. Täysi muutosta edeltävä todiste on
`F = E -> P -> E`. Nykyinen slottivartija tekee `F -> S -> F`.
Kokeen ehdokas tekee `E -> S -> F`: se antaa yhteisen tallentimen nykyiseen
`readSelection.assertBeforeSlotRead`-porttiin vain kaapatun `E`:n, nykyisen
valtuuden ja ensisyysuojan ympäröimänä. Tavallinen tuonti/palautuminen,
`removeSelected`, `discardBeforePublicationSelected` ja yhteisen tallentimen
oletuspolku eivät muutu. Muutos koskisi kaikkia tämän yhden
`clearAfterDeletionPurged`-metodin kutsuja, myös suoria testikutsujia,
joiden `E` ei itsessään todista payloadien poissaoloa.

Lukutulos ei ole poistovaltuus. Jokaisen nykyisen varsinaisen poiston ja
hakemistosynkronoinnin edellä sekä viimeisessä tarkistuksessa tehdään
edelleen sama `S -> F` nykyisten natiivien muutosvartijoiden osana.
`F`:n viimeinen `E` tarkistaa myös sidonnan `P`:n jälkeen; sitä ei siirretä
tai kevennetä. Muuttuvat omat slotit kuuluvat edelleen yhteiselle
tallentimelle. Natiivin polku-, identiteetti-, linkki-, koko-, tavu- ja
poissaolotarkistukset sekä kirjoittajien ja omistajuuden ehdot säilyvät.
Omistettu kesken oleva työ odotetaan loppuun ennen palautusta.

**Nimenomaisesti päätettävä havaintoero:** ennen `S`:ää jää pois yksi `P`
ja sitä seuraava `E`. Vain näissä pois jäävissä havainnoissa näkyvä ja ennen
säilyvää tarkistusta täysin palautuva ulkoinen muutos voi jäädä havaitsematta,
myös poisto-/sync-vartijan sisäisessä luvussa. Pysyvä muutos estää seuraavan
varsinaisen muutoksen. Lisäksi slottien luku-, identiteetti- tai sulkuvirhe
voi tulla ensimmäiseksi syyksi, kun aiempi järjestys olisi ensin havainnut
`P`:n virheen. Tämä ei ole havaintojen vastaavuuslupaus tai atominen kuva.
`E` sisältää kutsujan omia raskaita tarkistuksia: yhden eksplisiittisen `P`:n
poisjäänti ei todista todellisten poissaololukujen puolittumista tai nopeutta.

**Ensisyy ja elinikä:** uusi lukucallback sidotaan ennen ensimmäistä odotusta
samoihin kaapattuihin funktioihin ja saman kutsun boolean-pohjaiseen
ensivirhelukkoon kuin `F`, myös heitetylle `undefined`-arvolle.
Valtuus ja callbackin elinikä tarkistetaan ennen ja jälkeen odotuksen.
Elinikä päättyy `finally`-haarassa ennen operaation palautumista; vanha
callback ei saa tehdä I/O:ta tai vaikuttaa seuraavaan operaatioon.
`onUncertain` saa kerran säilytetyn alkuperäisen syyn ennen nykyistä
turvallista virhemuunnosta. Ilmoituksen virhe tai odotus ei korvaa syytä.
Tämä ei muuta natiivin lukijan nykyistä samanaikaisen luku-/sulkuvirheen
muunnosta eikä väitä ratkaisevansa sen mahdollisia syyn peittymisiä.

**Pieni vertailukoe nykyisillä apureilla ja aikarajoilla:**

1. Lähtö/ehdokas: järjestys alkuvartijassa, jokaisessa natiivissa remove-/
   sync-vartijassa ja loppuvartijassa; kaikki sallitut tyhjät, sivuslotti- ja
   paritilat. Varmista todelliset tavut, identiteetit ja säilyvät vieraat
   tiedostot, älä vain callbackien määrää.
2. Pysyvä ja täysin palautuva muutos pois jäävissä sekä säilyvissä kohdissa;
   kilpaileva `P`-/lukuvirhe. Todista havaintoero, ensimmäinen syy ja se,
   ettei epäonnistunut viimeinen `F` päästä varsinaiseen muutokseen.
3. Uuden callbackin `Error` ja `undefined`, myöhempi valtuus-/sulkuvirhe ja
   ilmoitusvirhe alku-/remove-/sync-reunoissa. Todista erikseen alkuperäinen
   ilmoitussyy, turvallinen ulkoinen virhe ja puuttuva luvaton tiedostomuutos.
4. Pidetty callback, todellinen luku ja sulku; rinnakkainen kutsu pysyy
   estettynä. Vanhentuneen callbackin uusintakutsu onnistumisen, virheen ja
   uuden operaation aikana ei lue tai muuta mitään. Keskeytetyt slotit
   palautuvat vain nykyisellä tuoreella valinnalla.
5. Nykyinen `workspaceBackupImportDeletionCleanup.test.ts`, metadatasiivouksen
   `preflight keeps the last retirement read strict after its outer purged proof`
   sekä V2:n alkuperäisjournalin current-/sync-rajat säilyvät. Injektion
   saavuttamatta jäävä timeout ei todista rajaa. Poistetun loppuvartijan,
   ensisyysuojan ja eliniän kielteiset vastakokeet, tyypitys ja rajattu
   katselmus edeltävät mahdollista tuotantopäätöstä.

Sovelluslähdettä ei muuteta tämän suunnitelman perusteella. Aiempi
inventaariorivien koeehdokas ei kuulu tähän kokeeseen. Pienkoe ei todista
23 kohteen ketjun valmistumista; vanhat hylkäykset ja W7.4:n portit säilyvät.

**Rajattu koetulos:** lähtö- ja muistiehdokas läpäisivät kumpikin 33
kohdekontrollia sekä kuuden nykyisen tiedoston 207 regressiota. Sarjoja ei
summata. Kaksi vain uuden lukucallbackin elinikää koskevaa kontrollia
tekevät varsinaiset väitteensä ehdokkaassa; lähtöversiossa tätä callbackia
ei ole. Muut kontrollit vertaavat järjestystä, todellisia slottitavuja ja
identiteettejä, natiivien poisto-/sync-rajojen pysyviä ja palautuvia muutoksia
sekä ensisyytä ja omistetun työn päättymistä. Ehdokas läpäisi myös kaikki
kolme nykyistä metadatasiivouksen tiukkaa rajatestiä: V2 current, V2 sync
ja viimeinen sidontaluku ulomman purged-todisteen jälkeen.

Kolme tarkoituksella rikottua versiota hylättiin nimetyissä vastakokeissa:
puuttuva viimeinen sisältövartija, puuttuva lukucallbackin ensisyysuoja ja
puuttuva elinikäraja. Ensimmäisen koetestin puuttuva vastaanottajatyyppi
korjattiin vain yksityiseen kokeeseen; alkuperäinen tyyppihylkäys säilytettiin.
Korjatun lähtö-/ehdokasversion semanttinen tyypitys läpäisi. Riippumattoman
katselmuksen osoittama testivalinnan puute korjattiin ennen varsinaisia
ajoja, ja natiivirajojen sekä yhdistelmävirheiden kontrollit täydennettiin.
Loppukatselmus ei löytänyt estävää puutetta tälle rajatulle kokeelle.

Yhdistelmävirhekoe sulkee oikean, fixturen omistaman lisäkahvan ja injektoi
siihen myöhemmän sulkuvirheen. Se todistaa omistajan ensivirhelukon
säilymisen, ei natiivilukijan oman luku-/finally-sulun muunnoksen korjausta.
Slottien nykyiset luennat säilyvät; ulkoisten valintakutsujen ja eksplisiittisten
`P`-kutsujen väheneminen ei yksin todista koko ketjun tai fyysisen I/O:n nopeutta.
Tuotanto- ja nykyiset testilähteet säilyivät muuttumattomina. Pitkää 23 kohteen
ketjua, cold-prosessikoetta, paketointia tai CI:tä ei ajettu.

**Ehdotettava seuraava portti:** vain tämän yhden tuontijournalin omistajan
saman kytkennän toteutus, pysyvät regressiot, nykyiset vaikutusalueen portit
ja katselmus. Tuotantopäätös koskee myös yllä kuvattua havainto- ja
virhejärjestyseroa. Vasta kytketyn lähteen ennakkoporttien ja uuden
lähdejäädytyksen jälkeen voidaan päättää saman 23 kohteen ketjun
todennuksesta nykyisessä 180 sekunnin rajassa. Tämä koetulos ei hyväksy
aiempaa inventaariorivien ehdokasta tai sulje vanhoja hylkäyksiä.

**Kytkennän tila 5.11.2026:** hyväksytty kytkentä ja 33 pysyvää regressiota
ovat työpuussa. Kytketty tallennin vastaa katselmoitua ehdokasta; normaalin
tyypityksen, kuuden tiedoston 240 kohdetestin, kolmen tiukan metadatarajan
ja rajatun kytkentäkatselmuksen portit läpäisivät. Laaja metadatasarja
läpäisi 130 tapausta ja hylkäsi kahdeksan saman virheinjektioperheen
väittämään. Testin yhteinen slottivakoilija oletti jokaisen erillisen
lukurajan kuuluvan sidontatallentimelle. Uusi tuontijournalin lukuraja
laukaisi siksi injektion ennen tarkoitettua sidontakierrosta.

Osoitettu testikorjaus rajaa injektion todellisen
`clearCommittedAfterPayloadsAbsent`-kutsun eliniän sisälle ja välittää
muut lukurajat muuttumattomina. Alkuperäiset kierros-, alkuperäisvirhe-,
`undefined`-, todellinen sulku-, aggregate- ja säilymisväittämät sekä
aikarajat säilyvät. Testi todistaa erikseen myös muun omistajan lukurajan
ohittamisen. Kahdeksan kohdetapausta, koko korjatun tiedoston 138 tapausta
ja rajattu riippumaton katselmus läpäisivät. Ensimmäiset
kahdeksan virhetietuetta säilytettiin tavuntarkasti. Tämä testikorjaus ei
laajenna sovelluksen havaintoeroa, muuta muiden journalien toteutusta tai
hyväksy pitkää ketjua ilman sen nykyisiä ennakkoportteja.

**Saman lähteen kokonaisajo 5.11.2026:** normaali tyypitys, 240 kohdetestiä,
138 metadatatestiä, nykyinen alkuperäisvirheen salaus/purku sekä olemassa
olevan vaihemittarin kontrollit ja tyypitys läpäisivät. Lähde ja mittarin
syötteet jäädytettiin ennen yhtä samaa 23 kohteen ajoa nykyisessä
180 sekunnin rajassa. Ajo aikakatkaisi viimeistelyssä. Julkaisu, fyysinen
vaihe, rekisteri ja metadatasiivous valmistuivat; lopullinen siivous ja
säilymisväittämät jäivät hyväksymättä. Alkuperäiset virhetietueet ja
keskeneräinen aineisto säilyvät. Seurattujen töiden päättyminen ei todista
prosessien tai profiilin lopullista siivousta.

Rajattu lähdeluenta ja säilyneen journalin tilat osoittivat, että tämä
kooste luo roolien sidonnat mutta ei alkuperäisiä palautusjournaleja.
V2:n nykyinen `context.present()`-raja ohittaa siksi tässä niiden
`clearAfterDeletionPurged`-polun. Tämän kytkennän kohdetodennus ei yksilöi
koosteen hitautta eikä sen nopeusvaikutusta. Seuraava rajattu katselmus
kohdistuu koosteen todella käyttämiin inventaario- ja viimeistelylukuihin
jo säilyneen näytön perusteella. Ei uutta vartijakevennystä, pitkää
muuttumatonta uusintaa tai aikarajamuutosta tämän tuloksen perusteella.

###### Valmistelun ja aloitusjulkaisun tarkistusvastuu

**4.11.2026: omistaja hyväksyi kokeen jälkeen tämän viiden tiedoston
tuotantokytkennän ja nykyiset portit. Kytkentä sekä pysyvät regressiot ovat
työpuussa; desktopin tyypitys ja rajattu kytkentäkatselmus läpäisivät.
Normaali vaikutusajo jäi hylätyksi erillisen metadatatestin aikakatkaisuun.**
Valmistelun yhdistelmätestin ensihylkäys säilyy avoimena. Erillinen yhden
rivin nykyisen julkaisijan koe läpäisi alkuperäiset väittämät, järjestyksen,
säilyvät tavut ja siivouksen nykyisellä aikarajalla. Se paikansi toistoa
alkuperäisjournalien valintavartijoihin mutta ei todenna ehdotuksen nopeutta,
alkuperäisen backup-tapauksen koko viivettä tai todellista main-varausta.
Mittarin ensimmäisen version ryhmittelyvirhe säilyy erillisenä, eikä sitä
luokitella sovellusviaksi. Tarkat mittaukset pysyvät yksityisessä aineistossa.

**Nykyinen vastuu:** Preparationin täysi tarkistus sisältää rekisterin
alkuperäiset tavut ja slotti-identiteetit, yritysjuuren natiivit tarkistukset,
runtimen poissaolon ja asynkronisen main-varauksen. Alkuperäisjournalin
lukija kutsuu tätä ennen kirjoittajatarkistusta ja sen jälkeen sekä koko
journalluennan alussa että lopussa. Samoja kuitteja verrataan myös
metadatavalmistelun ja julkaisun muutosvartijoiden sisältä. Siksi
kokonaisen callbackin poistaminen ei ole pelkän rekisteriluennan vähennys.
Sellainen kahden omistajan vaihtoehto rajataan tästä ehdotuksesta pois.
Nykyinen census-luenta on jo rajattu; sitä ei toteuteta uudelleen.

**Ehdotuksen viisi nykyistä tiedostoa:**

| Omistaja | Vain kokeeseen ehdotettava muutos |
| --- | --- |
| `workspaceDeletionTarget.ts` | Jaa nykyinen juuren tarkistus nimettyyn `assertRootCurrent`-kutsuun. Täysi `assertCurrent` säilyttää molemmat rekisteriluvut samassa järjestyksessä juuritarkistuksen ympärillä. Alkuperäinen juuritunniste, epäonnistumisen mitätöinti ja oletuskäytös säilyvät. |
| `workspaceDeletionPreparation.ts` | Luo vain pysäytetyn julkaisun sisälle valinnainen `assertPreparationReadOwned`: nykyinen `assertPublication`, juuritarkistus, runtimen poissaolo ja todellinen asynkroninen main-varaus, valtuusvartijat kaikkien odotusten ympärillä. `assertPublication` säilyttää myös backup-kuitin valtuuden; pelkkä ulompi lease-vartija ei riitä. Välitä callback kuudentena valinnaisena publish-argumenttina. |
| `workspaceManagementComposition.ts` | Välitä kuudes argumentti nykyisen viiden argumentin liitoksen läpi. Commandin nykyinen `Parameters`-levitys ei tarvitse uutta lähdepolkua. Pelkkä tyypitys ei todista tämän valinnaisen portin kytkentää. |
| `workspaceDeletionPublication.ts` | Välitä uusi callback vain alkuperäisjournalin publication-lukijalle. Älä muuta `sourceAuthority`a, lähde-/parent-/census-lukuja, metadatavalmistelua, inventaariokirjoitusta tai journalin muutosvartijoita. Puuttuva callback säilyttää täsmälleen nykyisen polun. |
| `workspaceDeletionOriginalJournalSelection.ts` | Vain publication-kutsun valinnainen portti korvaa jokaisen nykyisen lukureunan ensimmäisen täyden valinnan omistajuusluvulla: omistajuus -> kirjoittajat -> täysi alkuperäinen valinta. Jälkimmäinen täysi valinta valmistuu ennen alkuperäisten slottien lukemista. Samat reunat koskevat kuitin myöhempiä vertailuja. Continuation ja oletuspolku eivät saa porttia tai käyttäytymismuutosta. |

Luentakuitti ei saa muutosvaltuutta. Kaikki kolme alkuperäisjournaliryhmää,
neljän omistajan sidonnat, tavut, hashit, identiteetit, aliakset, poissaolot ja
kaikki slotit luetaan ja verrataan edelleen alkuperäiseen valintaan.
Yritysjuuren, runtimen ja main-varauksen fyysisten tarkistusten järjestys ja
määrä säilytetään tällä polulla; samaa seinäkellon havaintohetkeä ei luvata.
Jokainen inventaarion ja journalin kirjoitus, sync, siirto ja metadatan
poisto säilyttää nykyiset täydet vartijansa. Kolme lähdevertailua ja niiden
välissä tehtävä autentikoidun backupin uusintaluku säilyvät.

Uusi Preparation-callback säilyttää oman ensimmäisen virheensä, myös
`undefined`-arvon, ja mitätöi julkaisuvaltuuden ennen omia virheen jälkeisiä
siivousodotuksia. Se vanhenee viimeistään `input.publish`-kutsun päättyessä,
ennen valmistelun nykyisiä lopputarkistuksia. Vanha callback hylätään ennen
uutta I/O:ta. Jo aloitettu luku odotetaan nykyisen kutsuketjun kautta;
ei irrotettua työtä tai Promise-timeoutia sulkutodisteena. Alkuperäisjournalin
olemassa oleva ensisyysuoja ja kuitin revoke säilyvät. Ulomman callbackin
ei väitetä tietävän toisen lukijan sisäistä virhettä ennen tämän vastausta.

**Erikseen hyväksyttävä havaintoero:** vain pois jäävien rekisterinäytteiden
kohdalla näkyvä tavu-, identiteetti- tai sivuslottimuutos, joka palautuu
täsmälleen ennen jäljelle jäävää täyttä valintaa, voi jäädä havaitsematta.
Tämä koskee myös alkuperäiskuitin luentaa muutosvartijan sisältä; kaikkien
sisäisten havaintojen ei väitetä säilyvän ennallaan. Pysyvä rekisterimuutos
estää jatkon säilyvässä täydessä tarkistuksessa. Juuri-/varaus-/kirjoittaja-
havaintoja ei poisteta rekisterilukujen mukana. Kun rekisteri ja omistajuus
ovat samalla virheellisiä, ensiksi havaittu virhe voi vaihtua: ensisyysuoja
säilyttää uuden hyväksytyn järjestyksen ensimmäisen havainnon, ei arvaa
vanhan järjestyksen virhettä. Tämä päätös on erillinen aiemmista luentaluvista.

**Pienen kokeen hyväksyntäehdot:**

1. Vertaa alkuperäistä ja ehdokasta samoilla pienillä fixtureillä. Täysi
   Target-polku ja molemmat rekisteriluvut säilyvät; uusi juuripolku ei lue
   rekisteriä. Vaihtunut tai jo hylätty juuri ei muutu uudeksi lähtötilaksi.
2. Todista pysäytetty tila, requester, lease, backup-kuitin valtuus, oikea
   asynkroninen main-portti, valtuuden menetys odotuksen aikana, ensisyy
   myös `undefined`, erillinen sulkuvirhe ja vanhentunut callback.
3. Todista todellinen composition -> preparation -> command -> publisher
   -> alkuperäislukija -liitos. Puuttuvan portin oletus ja continuation
   pysyvät samoina. Kontrolloitu main-varaus erotetaan natiivista näytöstä.
4. Vertaa neljän omistajan oikeita journal-/sidontatavuja ja identiteettejä,
   pysyviä muutoksia, nimettyä palautuvaa rekisterihavaintoa sekä kahden
   yhtäaikaisen virheen järjestystä. Pysyvä muutos ei saa päästä vartijan läpi.
5. Todista muiden lähdelukijoiden ja varsinaisten muutosvartijoiden eristys,
   muuttumaton backup-/julkaisujärjestys ja säilyvät vieraan yrityksen tavut.
6. Laske rekisterityö sekä juuren, runtimen, varauksen ja kirjoittajien
   kutsut erikseen. Mahdollinen uusi pieni julkaisumittaus käyttää oikeasti
   kuutta argumenttia; vanha viiden argumentin fixture mittaisi vain
   muuttumatonta oletusta. Ei tulosten tai sisäkkäisten kestojen summaamista.

Rajattu riippumaton sopimuskatselmus täsmensi backup-valtuuden, callbackin
päättymisen ja composition-liitoksen. Se ei ole toteutusnäyttö. Omistajan
koelupa kattaa yllä olevan havaintoeron; pienet regressiot, tyypitys ja
katselmus vaaditaan ennen erillistä tuotantopäätöstä.
Koe käyttää nykyisiä Target-, Preparation-, ManagementComposition-,
Publication- ja OriginalJournalSelection-fixturejä; normaalien polkujen
testejä ei korvata uusilla poikkeuspoluilla tai uudella testialustalla.
Ei aikarajamuutosta, pitkää 23 kohteen ajoa, uutta riippuvuutta tai yleistä
manageria tämän suunnitelman perusteella. Koko W7.4:n portit säilyvät.

**Koenäyttö:** jäädytetyn ehdokkaan kaikki 36 rajattua kontrollia läpäisivät
nykyisillä aikarajoilla. Viimeinen sulkuväite täsmennettiin katselmuksesta
ja läpäisi erikseen; puuttuvaa caller-valtuustarkistusta ja päättyneen
luennan tarkistusta jäljittelevät vastakokeet hylkäsivät juuri ylimääräiset
rekisteri-/runtime-kutsut. Kahden vastuutiedoston samat 55 nykyistä
normaaliregressiota läpäisivät sekä lähtötoteutuksella että ehdokkaalla.
Niitä tai erillisiä kontrolliajoja ei summata yhdeksi hyväksyntämääräksi.
Ehdokkaan ja koetestien semanttinen tyypitys sekä rajattu riippumaton
lähde-/koeväitekatselmus läpäisivät. Katselmuksen kaksi uuden odotuskohdan
valtuuspuutetta korjattiin ja katettiin edellä mainituilla vastakokeilla.
Oikean paikallisen varausadapterin onnistuminen ja vapautetun varauksen
hylkäys todennettiin; muu shutdown-/Electron-/SQLite-raja oli kontrolloitu.

Yhden rivin varsinainen julkaisukoe säilytti alkuperäiset väittämät,
backup-/vertailujärjestyksen ja siivouksen. Vain nimetty täysien valintojen
ryhmä väheni; fyysisen omistajuuden korvaavat tarkistukset ja muut mitatut
ryhmät säilyivät. Myös nykyinen oikeaa autentikoitua vientiä ja journalia
käyttävä valmistelutapaus läpäisi ehdokkaalla viiden sekunnin rajassa.
Sen marginaali oli pieni: tämä ei osoita koko ketjun nopeutta tai vakautta.
Tarkat paikalliset mittaukset säilyvät yksityisinä.

Ensimmäinen koe hylkäsi kaksi liian myöhään asennettua testitarkkailijaa ja
aikakatkaisi aktiivisen yrityksen composition-liitoksen. Tarkkailijat
korjattiin; yksi sallittu liitosdiagnoosi läpäisi, mutta sen koetiedostojen
jäädytys ei kattanut koko ajoa eikä sitä käytetä revision hyväksyntänä.
Yllä mainittu myöhempi lähdejäädytetty kontrollisarja läpäisi myös liitoksen.
Ensihylkäys ja aiempi backup-valmistelun aikakatkaisu säilyvät avoimina,
eivät jälkikäteen onnistuneina tai korjattuina. Sovellus- ja pysyvät
testilähteet säilyivät kokeessa muuttumattomina.

**Hyväksytty tuotantoraja:** vain näiden viiden nykyisen tiedoston kytkentä,
pysyvät regressiot ja nykyiset vaikutus-/tyyppi-/ensisyy-/katselmusportit.
Kokeeseen hyväksytty rekisterihavaintoero ja virheiden havaintojärjestys
säilyisivät täsmälleen tässä rajauksessa. Muut kutsujat ja aikarajat eivät
muutu. Kytkentälupa ei yksin hyväksy pitkää ketjua, koko W7.4:ää tai mergeä;
normaalit nykyisen revision integraatioportit vaaditaan edelleen.

**Tuotannon lähteen todennus:** saman lähdekehyksen normaali 23 tiedoston
vaikutusajo päättyi 661 läpäisyyn, yhteen aikakatkaisuun ja yhteen ennestään
alustarajattuun tapaukseen. Valmistelun kaikki 58, compositionin 28,
Targetin 26, alkuperäisjournalin 52 ja julkaisijan 20 testiä läpäisivät.
Nämä määrät sisältyvät vaikutusajoon, eivät lisättävää erillistä kattavuutta.
Uuden todellisen Preparation-lukucallbackin ensivirhe säilyi eri
stop-virheen yli ja löytyi nykyisen OpenPGP-paketin purusta. Nykyiset
24 raporttia, manifesti-, tavu-/tiiviste- ja syyketjuväittämät säilyivät.
Lifecycle ja varausportti olivat tässä toimituskokeessa kontrolloituja;
oikean varausadapterin erilliset onnistumis-/vapautusregressiot sisältyivät
normaaliin vaikutusajoon. Tämä ei ole hosted- tai pakettihyväksyntä.

**Erillinen avoin este:** muuttumaton metadatasiivouksen testi
`preflight keeps retirement, second-read, clear and post-clear guards distinct`
aikakatkaisi viidessä sekunnissa sekä vaikutusajossa että yhdessä sallitussa
erillisdiagnoosissa. Alkuperäinen runner-virhe löytyi nykyisestä yksityisestä
keräyksestä ja molempien ajojen aineisto säilyi. Keskeytyshetken havainto oli
`postClear`; se ei yksilöi koko jäljellä olevaa odotusta tai todista onnistunutta
loppukuittausta. Diagnoosin mittarin ensimmäinen väittämävertailu valitsi
virheellisesti ulomman testilauseen, ja se korjattiin ennen runtimea.
Todellisen koeväitteen muuttamisen vastakoe hylättiin. Tuotantolähteet ja
aikarajat säilyivät samoina. Ei uutta saman lähteen uusintaa tai pitkää
23 kohteen koetta tämän hylkäyksen perusteella. Vaikutusportti on yhä hylätty;
valmistelun kytkentälupa ei oikeuta muuttamaan metadatasiivouksen vartijoita
tai testibudjettia.

Omistaja hyväksyi tämän jälkeen yhden nimetyn kymmenen sekunnin
vaihemittauksen ja Goalin tarvitseman rajatun jatkotyön. Mittaus valmistui
kaikkine alkuperäisine väittämineen; työ painottui varsinaiseen sovelluksen
metadatasiivoukseen, ei vain fixturen valmisteluun tai testin lopputarkistuksiin.
Vain tälle nimetylle yhdistelmätestille annetaan kymmenen sekunnin pysyvä
testibudjetti. Kaikki vartijat ja väittämät säilyvät; sovelluksen, muiden
testien, CI:n ja 23 kohteen ketjun rajat eivät muutu. Aiemmat hylkäykset
eivät muutu korjatuiksi tai hyväksytyiksi. Uuden testilähteen normaali
vaikutusajo vaaditaan ennen pitkää ketjua; pelkkä mittaus ei täytä sitä.

Normaali vaikutusportti, tyypitys sekä ketjumittarin ennakkotarkistukset
läpäisivät tämän jälkeen. Nimetty kokonaisketjun portti kuitenkin hylättiin;
sen ensivirhe ja aineisto säilyvät, eikä koko W7.4:ää tai loppusiivousta
ole hyväksytty. Paikalliset mittaus- ja tilahavainnot jäävät yksityiseen
tutkimusaineistoon. Uutta muuttumatonta pitkää ajoa ei aloiteta tällä näytöllä.
Seuraava rajattu katselmus käsittelee julkaisun ja rekisterivaiheen
luenta-/muutosvastuuta: `workspaceDeletionRegistryPublication.ts`:n
`assertAbsent` toimii sekä inventaarion luentatodistuksena että rekisterin
recover-/writeSelected-rajalla. Alkuperäisen rekisterin täyttä ennen-valintaa
ei saa vaatia muuttumattomana itse rekisterikirjoituksen sisällä. Mahdollinen
luentarajaus ei saa antaa itsenäistä muutosvaltuutta tai heikentää nykyisiä
poisto-/sync-vartijoita. Nykyinen suoran komennon testipolku säilyy.


###### Rekisterijulkaisun sisäisen inventaarioluennan katselmussopimus

**Tila: hyväksytty kytkentä on työpuussa. Kohde- ja vaikutusregressiot,
tyypitys, nykyinen alkuperäisvirheen salaus/purku-todennus ja rajattu
katselmus läpäisivät. Lähdejäädytyksen jälkeinen yksi hyväksytty kokonaisketjun
ajo hylättiin nykyisessä aikarajassa. Ensivirhe ja aineisto säilyvät;
loppusiivousta tai koko W7.4:ää ei ole hyväksytty. Sama pitkä ajo ei uusiudu
tällä näytöllä. Seuraava pieni julkaisumittaus ja rajattu lähdeselvitys eivät
muuta tarkistuksia tai hyväksymisrajoja.**
Tämä täsmentää yllä olevan integraatioesteen jatkoa. Aiempi cold-sopimus
säilyttää nimenomaisesti rekisterijulkaisun sisäiset poistojournalivertailut;
niiden havaintorytmin muuttaminen tarvitsee oman päätöksen. Nykyisiä
sopimuksia ei tulkita tämän uuden rajauksen hyväksynnäksi. Erillinen
koepäätös koskee vain alla nimettyjä sisäisiä luentoja ja pieniä kontrolleja.
Rajattu riippumaton suunnitelmakatselmus ja sen ensisyysuojan täsmennys
ovat valmiit. Tämä on sopimuskatselmus, ei toteutus- tai ajonaikainen näyttö.

Rekisterivaiheen `assertAbsent` on sekä inventaarion luenta että jokaisen
nykyisen recover-/writeSelected-vartijan käyttämä poissaolotodistus.
Inventaariotallentimen sisäiset tiedosto- ja rivitarkistukset kutsuvat
toistuvasti `phase.assertJournalSelected`-metodia. Pelkkä kutsumäärä ei
osoita kaikkia näitä tarkistuksia tarpeettomiksi.

**Pienimmän ehdokkaan vastuut:**

| Nykyinen omistaja | Kokeiltava muutos ja säilyvä vastuu |
| --- | --- |
| `workspaceDeletionPhaseSelection.ts` | Nimetty `assertJournalReadOwned` tekee saman tarkistetun omistaja-kirjoittaja-omistaja-järjestyksen kahdesti, kuten nykyisen täyden journal-vertailun ympärillä. Vain slottitavujen luku puuttuu tästä uudesta portista. Nykyiset täyden valinnan ja journalin metodit eivät muutu; muut kutsujat eivät käytä uutta porttia. |
| `workspaceDeletionRegistryPublication.ts` | Vain yhden `consumeSelectedRecords`-kutsun sisäinen luentavartija käyttää uutta porttia. Nykyiset täydet journal-tarkistukset luennan molemmin puolin ja jokaisen payload-rivin jälkeen säilyvät. `inspectionEvidence` ei saa uutta poistolupaa. Koko `assertAbsent` sekä sen kaikki nykyiset kirjoitus-, palautus- ja kuittauskutsut säilyvät. |
| `workspaceDeletionInventoryStore.ts` | Tarvittaessa vain nykyisen virhehavaitsijan valinnainen välitys `consumeSelectedRecords`-polulle. Nykyinen `readAt`-havaitsija välitetään myös parserille ja kuluttajaluennan virherajaan ennen iteratorin sulkua; notifier ei muuta hylkäystä onnistumiseksi. Kahvat, EOF, hash, tiedoston ja kansioiden identiteetit sekä nykyiset sulkuvirheen ketjut säilyvät. Ilman havaitsijaa nykyinen oletuspolku ei muutu. |

Uusi luentavaltuus kuuluu yhdelle kutsulle. Se tarkistaa alkuperäisen
valtuuden ennen jokaista odotusta ja sen jälkeen, mitätöityy omistajan
ensimmäisessä havaitussa virheessä ennen sulkuodotusta ja vanhenee viimeistään
luennan valmistuessa. Myös heitetty `undefined` säilyy ensisyynä. Jo alkanut
tiedostoluku ja sulku odotetaan loppuun; vanha callback hylätään ennen uutta
I/O:ta. Ensisyy talletetaan ensin vain tämän luennan omaan tilaan, ei
ulkotason ensivirhetilaan. Tämä koskee myös synkronista valtuusvartijaa ja
rivin täyttä journal-tarkistusta. Luenta tarkistaa edelleen phase-omistajan
valtuuden ja mahdollisen aiemman ulkotason virheen. Lopullinen sulkuvirheet
sisältävä hylkäys talletetaan `assertAbsent`-rajalla ennen ulkotason
`assertCurrent`-tarkistusta: phase-omistajan raakasyy ei saa korvata sitä.
Tämä on katselmuksen vaatima täsmennys, jotta nykyinen catch-rakenne ei
hävitä jälkimmäistä sulkuvirhettä. Ensisyy ja myöhempi sulkuvirhe todennetaan
erikseen nykyisellä virheketjulla. Havaitsijan ei väitetä näkevän toisen
lukijan sisäistä virhettä ennen tämän ilmoitusta.
Ulkotason aiempi virhe tarkistetaan kutsumatta sen virhettä tallettavaa
vartijaa. Luentavaltuuden päättäminen ei heitä; catch tai finally ei saa
korvata valmistunutta virheketjua luennan paikallisella raakasyyllä.
Onnistunut luenta päättää valtuutensa ennen viimeisiä täysiä journal- ja
stable-tarkistuksia. Vanhan callbackin hylkäys ei saa myrkyttää myöhemmän
luennan valtuutta tai ensivirhetilaa.

**Rekisterin muutosraja:** `phase.assertSelected` ei korvaa journal-vartijaa
rekisterikirjoituksen sisällä. Ennen-rekisteri muuttuu tarkoituksella;
nykyinen slot-tallennin omistaa kulloinkin odotetut tavut ja identiteetit,
recover-/rename-/poisto-/sync-järjestyksen sekä julkaisukuitin. Nämä pysyvät
muuttumattomina. Jokainen nykyinen muutosraja lukee edelleen koko
payload-poissaolon, eikä aiemman luennan tulosta käytetä muutosvaltuutena.
Cold-polun täydet build-/alkuperäis-/vierasvalinnan vartijat säilyvät.

**Erikseen hyväksyttävä havaintoero:** vain pois jäävän sisäisen journal-
näytteen kohdalla näkyvä ja täysin ennen säilyvää rivi-/loppuvertailua
palautuva ulkoinen journalin tavu-, identiteetti- tai sivuslottimuutos voi
jäädä havaitsematta. Tämä koskee myös luentaa muutosvartijan sisältä.
Pysyvä muutos estää seuraavan muutoksen. Fyysisten omistajuus- ja
kirjoittajahavaintojen järjestys ja määrä säilyvät onnistuvassa sisäisessä
kutsussa, eivät niiden täsmälleen samat seinäkellohetket. Vanha journal-
hylkäys voi katkaista kutsun ennen jälkimmäisiä fyysisiä havaintoja, joten
virhepolun kutsumäärien ei väitetä olevan samoja. Samanaikaisissa virheissä
havaittu ensisyy voi vaihtua.

**Pienet kokeet ennen tuotantopäätöstä:**

1. Vertaa lähtöä ja ehdokasta samoilla pienillä PhaseSelection-,
   RegistryPublication- ja InventoryStore-fixtureillä. Laske journalin
   luvut, fyysiset vartijat ja jokaisen todellisen muutosvartijan kutsut
   erikseen. Rivikohtaista täyttä journal-tarkistusta ei poisteta.
2. Todista pysyvät tavu-, identiteetti- ja sivuslottimuutokset sekä nimetty
   palautuva havaintoero myös oikean kirjoitusvartijan sisällä. Palannut
   payload ja muuttunut inventaario estävät jatkon; vieraat tavut säilyvät.
   Palautuva native-koe käyttää sivuslotin luontia ja poistoa; alkuperäisen
   tiedoston aikaleimojen palauttamista ei oleteta mahdolliseksi.
3. Todista valtuuden menetys kesken odotuksen, stale-callback, parserin ja
   kuluttajan ensimmäinen virhe, heitetty `undefined`, pidetty luku/sulku
   ja erillinen sulkuvirhe. Sisäinen luku ei saa muuttua kirjoitusluvaksi.
   Tarkista julkaisijan palauttama koko virheketju myös phase-omistajan
   oikeassa virheessä: alkuperäiset virheoliot, erillinen sulkuvirhe ja
   sulkujen valmistuminen säilyvät. Vanha callback ei muuta uutta luentaa.
4. Säilytä oikean slot-tallentimen before/after/recovery-, kuittauskatko-,
   muuttunut rekisteri- ja loppuidentiteettitestit. Vertaa myös nykyisiä
   kutsujia ilman uutta porttia/havaitsijaa. Tyypitys ja rajattu riippumaton
   katselmus vaaditaan ennen tuotantopäätöstä.

**Aloitusjulkaisu on eri vastuu:** nykyinen viiden argumentin suora komento,
kolme lähdevertailua, alkuperäisjournalit, täydet census-luennat ja backupin
uusintaluku säilyvät. Seuraava pieni, käyttäytymistä muuttamaton mittaus
erottaa nykyisen testiapurin inventaariokirjoituksen ja kolme vertailua sekä
alkuperäisjournalien ja census-luennan työn. Käytetään nykyistä mittaria,
ei uutta loggeria tai pitkän ketjun muuttumatonta uusintaa. Mittarin pitää
säilyttää alkuperäiset väittämät ja sulku. Sisäkkäisiä kestoja ei summata.
Tämän selvityksen perusteella ei vielä ehdoteta julkaisun tarkistusten
poistamista tai muistin kasvattamista koko inventaarion kokoiseksi.

Tämä pieni käyttäytymistä muuttamaton mittaus, sen kontrollit ja tyypitys
läpäisivät. Varsinainen kokonaisketjun portti jäi hylätyksi; paikalliset
vaiheajat ja tarkistusmäärät säilyvät yksityisessä tutkimusaineistossa.
Rajattu lähdeselvitys erottaa seuraavaksi metadatan havaintoluennan,
strict-jälkiluvun ja yhteisen sidontatallentimen varsinaiset poisto- ja
sync-vartijat. Jälkiluku, tyhjän sidonnan strict-clear ja toistuvat avaimet
on nykyisessä sopimuksessa suojattu erikseen. Niitä ei saa muuttaa
jo hyväksytyn sisäisen journal-luentarajauksen perusteella. Tämä jatko
ei hyväksy uutta tarkistusmuutosta, pitkää ajoa tai aikarajan nostoa.

Koe ei muuta aikarajoja, backup-formaatteja, riippuvuuksia tai W7.5-rajaa.
Pitkän 23 kohteen ketjun ja koko W7.4:n portit säilyvät; tämän pienen
rajauksen ei luvata yksin korjaavan niiden aikakatkaisua.

**Hyväksyntätila:** rajatut kontrollit, lähtöön verratut nykyiset regressiot
ja tyypitys läpäisivät. Katselmuksen testitäsmennykset on korjattu ja
deltakatselmoitu. Sovelluksen ja pysyvien testien lähteitä ei muutettu.
Myöhempi tuotantopäätös säilyttää saman havaintoeron ja rajaa kytkennän yllä
nimettyihin nykyisiin omistajiin. Täydet rivi- ja muutosvartijat sekä aikarajat
säilyvät. Kytkennän uudet portit vaaditaan erikseen; koenäyttö ei hyväksy niitä
automaattisesti. Tämä ei ole koko W7.4:n hyväksyntä.

###### Metadatan jälkiluku ja poistovaltuus

**Omistaja hyväksyi vertailun jälkeen yhden omistajan tuotantokytkennän,
pysyvät regressiot ja nimetyn kahden kohdeavaimen testin kymmenen sekunnin
budjetin. Toteutus on työpuussa. Kohdeportit, normaali tyypitys, todellisen
virheketjun salaus/purku, rajattu katselmus ja laajempi vaikutussarja
läpäisivät. Kokonaisketjun portti ei vielä läpäissyt.**
Vertailun lähtötoteutuksessa `workspaceDeletionMetadataCleanup.ts`:n toisen iteratorin
sidontapoiston jälkiluku käyttää `inspectCommittedAfterPayloadsAbsent`-
polkua, joka tarkistaa koko payload-poissaolon ennen kolmen slotin lukua
ja sen jälkeen. Varsinaisen poiston samanniminen todistus on erillinen:
`clearCommittedAfterPayloadsAbsent`, valittujen tavujen ja identiteettien
vertailu sekä jokaisen natiivin remove-/sync-rajan vartijat säilyvät.
Luentatulos ei anna seuraavan poiston valtuutta.

Ehdotus koskee vain tämän iteratorin yhtä jälkilukukutsukohtaa, ei yhteistä
sidonta- tai tavutallenninta. Nykyiset omistajat hoitaisivat järjestyksen:

1. Nykyinen strict-clear valmistuu kaikkine nykyisine vartijoineen.
2. Nykyinen `inspectCommittedDeletionSlots` lukee ja validoi kaikki slotit
   omassa päättyvässä luentavaltuudessa. Täysi `phase.assertSelected`
   säilyy luennan reunoilla: alkuperäinen vaihe-/rekisteri-/journal-valinta,
   omistajuus ja kirjoittajien poissaolo. Kohde, avain, lineage, digest,
   todelliset tavut ja identiteetit tarkistetaan; kaikkien slottien on
   oltava poissa. Havainto ei palauta muutosvartijaa.
3. Sidontaluvun ja sen kahvojen päätyttyä luentavaltuus vanhenee. Sen jälkeen
   tehdään **aina tuore täysi `assertPurged`** ennen seuraavaa avainta tai
   onnistunutta paluuta. Clearin aiempaa onnistumista ei käytetä tämän
   tarkistuksen korvikkeena. Nykyinen `assertJournalsAbsent` ja ulommat
   loppuvertailut säilyvät. Virhe pysäyttää jatkon, ei käynnistä uutta poistoa.

Poistettu alkupuolen payload-tarkistus muuttaa havaintorytmiä. Vain pois
jäävän havainnon aikana näkyvä ja ennen säilyvää tarkistusta täysin
palautuva ulkoinen payload-, inventaario-, alkuperäisjuuri- tai vakaan
valinnan muutos voi jäädä havaitsematta; ensimmäinen syy ja havaintohetki
voivat muuttua. Näiden tietojen pysyvä ristiriita estää jatkon säilyvissä
tarkistuksissa myös viimeisen avaimen jälkeen. Slotit luetaan kerran;
jo luettuun slottiin myöhemmin ilmestyvän tiedoston havaitsemista ennen
seuraavaa avainta ei luvata nykyisessäkään jälkiluvussa. Havaittua ristiriitaista
slottia ei poisteta. Tämä ei ole atominen tiedostojärjestelmäsnapshot eikä
väite vanhaa vastaavasta havaintoikkunasta. Clear on voinut jo poistaa valitut sidontatavut ennen
myöhäistä virhettä: niitä ei luvata palauttaa, eikä kesken jäänyttä poistoa
ilmoiteta valmistuneeksi. Journal, inventaario ja uusi ristiriitainen aineisto
säilytetään nykyisten virhesääntöjen mukaan.

**Rajauksen ulkopuolella:** alkuperäisjournalin viimeinen `selectedBinding`,
V2:n `originalBindings` ja aliakset, tyhjän/puuttuvan hakemiston strict-clear,
toistuvat avaimet, muut jälkiluvun kutsujat, terminal-viimeistelijä sekä
jaettujen tallentimien rajapinnat. Ei välimuistia, avainten ohittamista,
uutta kerrosta, riippuvuutta, lokitusmallia tai aikarajan muutosta.

Pieni lähtöön verrattu koe on edellytys mahdolliselle kytkentäpäätökselle:

- pysyvä ja täysin palautuva payload-/valintamuutos erotetaan; myöhäinen
  virhe estää seuraavan aidon poiston ja viimeisen avaimen onnistumisen;
- kaikki slotit, väärä kohde/lineage/digest sekä muuttuneet tavut ja
  identiteetit torjutaan ja ristiriitaiset tavut säilyvät;
- remove-/sync-vartijat todennetaan niiden omilla rajoilla, myös tyhjälle
  ja puuttuvalle hakemistolle; jälkiluku ei anna itsenäistä poistolupaa;
- V1/V2, alkuperäisjournalit, aliasrajat, toistuvat avaimet sekä muiden
  yritysten ja ulkoisten tiedostojen tavut säilyvät nykyisen sopimuksen mukaan;
- pidetty todellinen luku/sulku päättyy ennen paluuta; ensimmäinen syy,
  myös `undefined`, ja erillinen sulkuvirhe säilyvät **siivoojan palauttamassa
  koko virhepuussa**, eivät vain sisäisessä callbackissa. Vanhentunut callback
  ei tee I/O:ta tai myrkytä myöhempää valtuutta. Ulompi inventaarioluku
  suljetaan nykyisesti ennen koko siivoojan paluuta;
- vartijakutsut erotetaan vaiheittain: vain tämän jälkiluvun täysi
  poissaololuku vähenee kahdesta yhteen. Pelkkä lopullinen virhekoodi tai
  yksittäinen läpäisy ei todista muutoksen turvallisuutta tai ketjun nopeutta.

**Rajattu lähde- ja sopimuskatselmus:** ehdotuksesta ei löytynyt uutta
poistovaltuusaukkoa. Katselmus täsmensi yllä olevaa kertaluennan lupausta ja
ensisyyn säilytystä; tämä ei ole ajettua koenäyttöä. Aiemman sisäisen
luennan `retain(retainRead(error))`-mallia ei kopioida sokeasti. Luentavaltuus
päättyy heti havaittuun virheeseen, mutta ulomman inventaarioluvun myöhemmin
valmistuva virhe-/sulkuketju pitää säilyttää kokonaisena. Siivoojan lopun
`assertCurrent` ei saa korvata sitä aiemmalla pelkällä syyllä. Kokeen
ensimmäinen portti erottaa nämä tilat nykyisessä omistajassa; yhteisen
tallentimen muutostarve pysäyttää tämän yhden omistajan ehdokkaan.

Kokeen, tyypityksen ja rajatun katselmuksen jälkeen tarvitaan erillinen
tuotantokytkentäpäätös. Nykyiset aikarajat ja koko W7.4:n portit säilyvät;
tämä kokeilulupa ei hyväksy uutta pitkää kokonaisajoa tai sulje vanhoja hylkäyksiä.

**Vertailukokeen tulos:** rajatun ehdokkaan ja muuttumattoman lähdön samat
20 kontrollia sekä erilliset 26 nykyistä natiivi-/V2-/aliasregressiota
läpäisivät. Ajoja ei summata uusiksi hyväksyntätapauksiksi. Nimetyn jälkiluvun
kaksi täyttä poissaolokutsua vähenivät yhteen; varsinaiset poisto- ja
sync-vartijat säilyivät omilla rajoillaan. Myöhäinen ristiriita säilytti
aineiston, eikä havaittua ristiriitaista slottia otettu uudeksi poistokohteeksi.

Katselmuksen täsmennykset korjattiin kokeeseen: valmistuneen virhe-/sulkuketjun
etusija koskee vain nimettyä jälkilukua tai sen uutta loppuvarmennusta, ei
ennen jälkilukua epäonnistunutta poistoa. Slottipaluun koeväittämät eivät enää
voi tuottaa itse hyväksyttyä virhettä. Tyypitys sekä rajattu riippumaton
lähde- ja deltakatselmus läpäisivät.

Kahden todellisen kohdeavaimen uusi kontrolli aikakatkaisi nykyiseen
oletusrajaan myös sallitussa erillisdiagnoosissa. Omistajan hyväksymä yksi
kymmenen sekunnin vaihemittaus läpäisi kaikki alkuperäiset esto-, sulku- ja
säilymisväittämät. Mittarin kontrollit ja tyypitys läpäisivät. Tämä ei muuta
testin pysyvää rajaa tai sulje aiempia aikakatkaisuja. Myös muut ensihylkäykset
säilyvät historiana. Sovellus- ja pysyviä testilähteitä ei muutettu kokeessa.

**Tuotantokytkennän kohdenäyttö:** yhden nykyisen siivoojan toteutus vastaa
katselmoitua ehdokasta. Pysyvät kohdekontrollit, normaali tyypitys ja rajattu
riippumaton katselmus läpäisivät. Nykyinen yhteinen testifixture todentaa
todellisen poiston jälkeisen alkuperäisen virheen ja ulomman tiedostoluvun
erillisen sulkuvirheen; samat virheoliot löytyivät nykyisen salatun paketin
puretuista raporttitavuista. Tietueita tai kerättäviä tietolajeja ei lisätty.
Valmistuneen virheketjun etusija rajoittuu tähän jälkilukuun ja sen tuoreeseen
loppuvarmennukseen; aiemmin epäonnistuvan varsinaisen poiston käsittely
säilyy. Tämä näyttö ei vielä todista koko rooliketjun kestoa, F:n koko
nykyisen lähteen katkomatriisia tai pakettia. Niiden ja PR/mainin portit
sekä vanhojen hylkäysten avoin tila säilyvät.

Yhden uuden virhe-/sulkuketjutestin myöhemmän aikakatkaisun jälkeen sen
valmistelu yhtenäistettiin nykyiseen salaus/purku-fixtureen. Testi ei enää
kirjoita alkuperäisjournalin vaiheita vain poistaakseen ne ennen
varsinaista jälkiluvun virherajaa. Todellinen sidontapoisto, omistajuuden
menetys, alkuperäinen virhe myös `undefined`-arvona, erillinen todellinen
sulkuvirhe sekä kohteen ja vieraan aineiston tavut tarkistetaan edelleen.
Jaetun fixturen oletuspolku ei ota metadataa käyttöön. Molemmat variantit
ja salaus/purku läpäisivät; tarkoituksella rikottu valmistuneen virheketjun
säilytys hylättiin odotetulla väittämällä, ei aikakatkaisulla.
Virheketjutestien aikarajoja tai sovellustoteutusta ei muutettu tästä syystä.
Ensihylkäys jää avoimeksi, ja normaali vaikutusportti vaaditaan edelleen.

Korjatun testilähteen normaali 31 tiedoston vaikutusajo läpäisi 931 testiä;
kaksi ennestään alustarajattua tapausta jäi suorittamatta. Mittausliitoksen
kontrollit ja semanttinen tyypitys läpäisivät, ja uuden lähteen sekä syötteiden
tiivisteet jäädytettiin ennen yhtä normaalia 23 kohteen ketjutodennusta.
Ketju aikakatkaisi nykyisessä 180 sekunnin rajassa. Aloitusjulkaisu,
fyysinen vaihe ja rekisterijulkaisu valmistuivat; metadatasiivous ei
valmistunut eikä loppuviimeistelyä aloitettu. Ensivirhe, journal ja inventaario
säilyivät. Jälkiluku ei enää käyttänyt vanhaa täyttä cleanup-lukupolkua,
mutta varsinaisten sidontapoistojen suojatut tarkistukset säilyvät.
Tämä ei osoita uuden kytkennän hidastumista tai tarkkaa jäljellä olevaa
kokonaiskestoa. Seuraava rajattu lähdekatselmus erottaa sidontatallentimen
sisäiset slottiluvut sen täydellisistä muutosvartijoista. Tällä ei hyväksytä
jaetun tallentimen sopimusmuutosta, aikarajan nostoa tai uutta pitkää ajoa.

**Hyväksytty jatko:** omistajan tämän Goalin kattava jatkovaltuus hyväksyy
yllä ehdotetun yhden omistajan kytkennän, pysyvät regressiot ja vain nimetyn
kahden kohdeavaimen testin kymmenen sekunnin rajan. Tavallisia Goalia
edistäviä korjauksia ja testejä ei kysytä uudelleen. Turvallisuus-, sisältö-,
omistajuus- ja PR/main-portteja ei ohiteta; koetulos ei korvaa myöhemmän
tuotantolähteen näyttöä. Ennakkoportit, katselmus ja uusi lähdejäädytys
edeltävät saman 23 kohteen ketjun yhtä nimettyä todennusta nykyisessä
180 sekunnin rajassa. Koko W7.4:n integraatio on edelleen avoin.

###### Sidontapoiston slottilukureunan koesuunta

**Rajattu kytkentä ja pysyvät regressiot ovat työpuussa; normaali tyypitys
ja vaikutussarja läpäisivät, kokonaisnäyttö on avoin.** Omistajan nykyinen koko Goalia koskeva
toteutusvaltuus kattaa koetodetun kolmen nykyisen omistajan kytkennän:
`CrashSafeByteSlotStore`, `WorkspaceRemnantBindingStore` ja
metadatasiivoojan toisen iteratorin committed-clear. Tämä uudempi täsmennys
avaa aiemman D-kytkennän `clearSelected`-poissulun vain tälle nimetylle
kutsupolulle. Muiden kutsujien oletukset eivät muutu. Alla säilyvä
koesopimus ei korvaa tuotantolähteen omia portteja tai hyväksy koko Goalia.

Koe sovittaisi olemassa olevan erillisen `CrashSafeByteSlotReadSelection`-
argumentin vain `clearSelected`-luennan alkureunaan ja välittäisi sen
nimenomaisesti committed-clear-kutsusta. Olkoon `E` kutsujan nykyinen vaihe-
ja journal-valinta ja `F` tallentimen nykyinen täysi
`E -> payload-poissaolo -> E`-todistus. Koereuna olisi
`E -> current/next/backup-tavut ja identiteetit -> F`.
Jokainen nykyinen remove-, sync- ja loppuraja vaatisi edelleen uuden täyden
`F`:n sekä nykyisen natiivin kohdeidentiteetin uusintatarkistuksen.

Alkuperäinen `observe`, puuttuvan hakemiston molemmat havainnot ja
loppuvertailu, toistuvat avaimet, alkuperäisjournalit ja muiden kutsujien
oletukset eivät muutu. Luentatulos ei anna poistolupaa. Uusi callback
kaapataan ennen odotusta ja päättyy yhden committed-clear-kutsun mukana;
vanha callback ei tee I/O:ta tai myrkytä uutta kutsua. Ensivirhe myös
`undefined`-arvona ja erillinen oikea ulompi sulkuvirhe säilyvät palautetussa
virhepuussa vain uuden alkureunan virhehaaran osalta; vanhojen clear-
virheiden syyetusijaa ei yleistetä tämän varjolla.

Havaintoero koskee vain poistuvan alkutarkistuksen aikana näkyvää ja ennen
säilyvää `F`:ää täysin ennalleen palautuvaa payload-, inventaario-,
alkuperäisjuuri- tai soveltuvaa valintamuutosta. Se voi jäädä havaitsematta;
pysyvä ristiriita estää muutoksen. Samanaikaisen slotti- ja payload-virheen
ensimmäinen syy voi vaihtua. Kyse ei ole atomisesta snapshotista.

**Koenäyttö ja katselmus:** pienet lähtö-/ehdokasvertailut, oikeat slotit,
natiivin muutoksen rajat, pidetyn I/O:n ja itse alkureunan päättyminen sekä
vanhat callbackit läpäisivät. Muiden oletuspolkujen yhdeksän tiedoston
sarja läpäisi samat 244 testiä molemmissa vaihtoehdoissa; yksi ennestään
alustarajattu tapaus jäi suorittamatta. Koko nykyisen metadatasiivoojan
130 testin tiedosto läpäisi ehdokkaalla samalla valinnalla kuin jäädytetty
lähtö. Päällekkäisiä sarjoja ei lasketa yhteen.

Uuden alkureunan virhe säilytetään erikseen vain tämän option haarassa,
jos natiivi poisto palauttaa eri virheen. Palautetun puun alkuperäinen syy,
myös `undefined`, välissä oleva natiivi virhe sekä oikea ulompi sulkuvirhe
tarkistettiin kahdeksalla kontrollilla. Katselmuksessa korjattiin yhden
testin onnistumisen ja `undefined`-virheen erottelu sekä täydennettiin
järjestetyn virhepuun ja pidetyn alkureunan väittämät. Deltakatselmus ei
jättänyt löydöksiä. Tahallisesti puuttuva täysi loppuvartija, kadotettu
alkuperäinen syy ja onnistumiseksi nielty virhe hylättiin vastakokeissa.

Pysyvät regressiot käyttävät nykyisiä fixturejä, eivät yksityisiä
koemuuntimia. Kytkennän normaali tyypitys ja sen oma 12 tiedoston vaikutusajo
läpäisivät 446 testiä; yksi ennestään alustarajattu tapaus jäi suorittamatta.
Mukana ovat kaikki 13 oikean prosessin keskeytys-/jatkotestiä.
Lähdevastaavuus katselmoituun ehdokkaaseen on varmennettu. Nykyisen lähteen
alkuperäisen virheen salaus/purku sekä mittausliitoksen kontrollit ja tyypitys
vaaditaan ennen syötteiden jäädytystä ja saman 23 kohteen yhtä nimettyä
ketjutodennusta nykyisessä 180 sekunnin rajassa. Koenäyttö ei ratkaise
kokonaisketjun viivettä, sulje vanhoja hylkäyksiä tai korvaa native-,
paketti- ja PR/main-portteja. Aikarajat ja riippuvuudet säilyvät.

**Uuden lähteen kokonaisnäyttö 4.11.2026:** normaali tyypitys, kaikki
12 vaikutustiedostoa ja 446 testiä sekä nykyinen salaus/purku läpäisivät.
Yksi ennestään alustarajattu tapaus jäi suorittamatta. Mittausliitoksen
kontrollit ja tyypitys läpäisivät; lähde ja syötteet jäädytettiin ennen
yhtä 23 kohteen todennusta nykyisessä 180 sekunnin rajassa.
Aloitusjulkaisu, fyysinen vaihe, rekisterijulkaisu ja metadatasiivous
valmistuivat, mutta viimeistely aikakatkaisi. Terminal-current, vanhan
vaiheen backup ja inventaario säilyvät. Muiden yritysten ja ulkoisten
verrokkien tavut varmennettiin muuttumattomiksi. Hylkäys ja ensivirhe
säilyvät; tämä ei ole loppusiivouksen hyväksyntä tai lupa muuttumattomaan
uusintaan. Seuraava luentakoe on erillinen, ei tämän kytkennän laajennus.

###### Viimeistelijän puhtaan inventaarioluennan koesuunta

**Rajattu yhden omistajan kytkentä ja pysyvät regressiot ovat työpuussa
nykyisen Goalin toteutusvaltuudella; rajatut vaikutusportit läpäisivät,
mutta kokonaisketjun portti on avoin.** Viimeistelyn
`assertPurged`-todistus lukee edelleen saman yritysrekisterin myös
inventaarioluennan sisäisissä reunoissa ja jokaisen payload-rivin jälkeen.
Säilynyt vaiheaineisto ja rajattu lähdetarkistus erottavat tämän muista
jo valmistuneista luentarajauksista. Muutos rajataan yhteen nykyiseen
viimeistelijään; ei uutta tallenninporttia, kehystä tai aikarajan nostoa.

Kokeessa täysi nykyinen rekisteri-/omistajuusvalinta ympäröi kokonaisen
inventaarioluennan. Sisällä käytetään vaiheen nykyistä
`assertJournalReadOwned`-vartijaa, joka tekee samat kaksi fyysistä
owner/writer/owner-kierrosta ilman rekisterin uusintalukua. Kaikki rivit,
todelliset tiedostotavut, tiivisteet, identiteetit, payload-poissaolo ja
yhden workspace-rivin vaatimus säilyvät. Vaiheen `assertSelected` ei
korvaa tätä vartijaa: muuttuvan journalin slotit kuuluvat edelleen
journal-tallentimen omiin muutosvartijoihin.

Lukukierroksen loppuvertailuksi käytetään nykyisen metadatalukijan
ensimmäistä täyttä valintatarkistusta ennen sen I/O:ta. Luentavaltuus
päättyy ennen sitä. Samalle rajalle ei lisätä toista päällekkäistä
rekisterilukua; tätä tarkkaa järjestystä suojataan vastakokeella.

Luenta ei anna itsenäistä muutosvaltuutta. Jokainen nykyinen journalin
julkaisu, poisto ja synkronointi vaatii yhä tuoreen kokonaisen sisältö-
todistuksen; alkuperäisten juurten sekä metadatan poissaolo ja terminalin
loppusiivous eivät muutu. Luentavaltuus on yhden lukukierroksen mittainen.
Ensivirhe päättää sen ennen sulun odotusta, vanha callback ei tee I/O:ta
eikä riko myöhempää kierrosta, ja palautettu virhepuu säilyttää myös
erillisen todellisen sulkuvirheen. Vanhojen muiden virheiden etusijaa ei
yleistetä tämän uuden lukuvaiheen perusteella.

Havaintoero koskee rekisterimuutosta, joka näkyisi vain poistuvassa
sisäisessä rekisteriluvussa ja palautuisi täysin ennen säilyvää täyttä
loppuvertailua. Se voi jäädä havaitsematta myös muutosvartijan sisäisessä
luennassa; pysyvä muutos estää julkaisun. Poistuvan rekisteriluvun omat
slotti-, tiedosto- ja polkuhavainnot kuuluvat tähän samaan havaintoeroon.
Kahden samanaikaisen ristiriidan havaintojärjestys voi muuttua. Erillisiä
owner-/writer-kutsuja ei vähennetä; tämä ei takaa havaintoja samoilla
kellonhetkillä eikä atomista snapshotia.

Ensin pienet lähtö-/ehdokasvertailut nykyisillä fixtureillä: rekisteri-
ja fyysisten tarkistusten määrät, pysyvä/palautuva muutos, kaikki todelliset
muutosrajat, vanhat callbackit, virhe myös `undefined`-arvona sekä
pidetty oikea luku ja sulku säilyvine tavuineen. Tahallisesti puuttuvan
loppuvertailun ja hukatun virheen vastakokeiden pitää hylätä ehdokas.
Lähtö-/ehdokasvertailut, todellisen pidetyn luvun ja sulun kontrollit,
natiivin muutosvartijan virhemuunnoksen regressiot ja rajattu riippumaton
katselmus läpäisivät. Samat 75 nykyistä oletuspolun testiä läpäisivät
molemmissa vaihtoehdoissa; niitä ei summata uudeksi kattavuudeksi.
Vastakokeet hylkäsivät loppuvertailun, alkuperäisen virhepuun tai yhden
fyysisen omistajuuskierroksen tarkoituksellisen poistamisen. Semanttinen
koetyypitys läpäisi. Seuraavaksi vaaditaan varsinaisen lähteen pysyvät
regressiot, tyypitys, alkuperäisen virheen salaus/purku ja vaikutuskatselmus
ennen yhtä uuden jäädytetyn lähteen samaa 23 kohteen ketjua. Nykyistä
180 sekunnin porttia tai muita aikarajoja ei muuteta. Vanha hylkäys säilyy.

Tuotantolähteen 86 kohdetestiä, tyypitys, todellisen luku-/sulkuvirheen
nykyinen salaus/purku ja rajattu jatkokatselmus läpäisivät. Nykyiset kaksi
prosessitiedostoa läpäisivät 34 testiä, mukaan lukien kaikki kahdeksan
cold-vaihekatkoa. Uuden jäädytetyn lähteen yksi sama 23 kohteen portti ei
silti valmistunut määräajassa: inventaario poistui mutta viimeinen
terminal-journal jäi. Ensivirhe ja aineisto säilyvät. Seuraava pieni
vaihemittaus erottaa inventaarion retirementin, fyysisen poissaololuvun,
metadatan poissaololuvun ja journalin viimeisen poiston nykyisessä
terminal-fixturessä. Se ei anna uutta tuotantokytkentää tai pitkän ajon
uusintaa eikä muuta aikarajoja.

###### Viimeisen journalin slottiluvun rajattu kokeilu

**Rajattu kahden omistajan kytkentä ja 29 pysyvää regressiota ovat
työpuussa nykyisen Goalin toteutusvaltuudella. Rajatut vaikutusportit
läpäisivät; kokonaisketjun hyväksyntä on vielä avoinna.** Alla kuvattu koe edelsi kytkentää.
Säilynyt terminal-current ja pieni nykyisen fixturen vaihe-erottelu
kohdistavat seuraavan kokeen `clearTerminal`-kutsuun. Käytetään jo olemassa
olevaa `CrashSafeByteSlotReadSelection`-sopimusta: journal-omistaja välittää
valinnaisen luentavartijan nykyiselle `clearSelected`-tallentimelle kuten
sen `advance` ja `recover` jo tekevät. Muiden kutsujien oletus säilyy.

Vain viimeistelijä kokeilee erillistä etuvartijaa, joka tarkistaa nykyisen
valtuuden, vaiheen rekisterivalinnan sekä mahdollisen main-valinnan.
Sen elinikä rajautuu yhteen journalin tyhjennykseen; virhe päättää sen
ennen jatkoa. Jokaisen slottilukukierroksen todelliset tavut ja identiteetit
tarkistetaan edelleen. Niiden jälkeen säilyy nykyinen täysi vartija:
tekninen sisältövalinta, inventaarion ja operaatiokansion poissaolo sekä
uusi tekninen sisältövalinta. Jokainen natiivi poisto, synkronointi ja
lopullinen vartija käyttää edelleen tätä täydellistä ehtoa.

Tämä vähentää kokonaisen slottiluvun **edeltäviä** täysiä tarkistuksia,
ei vain rekisterilukuja. Havaintoero koskee myös niiden fyysisiä
poissaolohavaintoja: metadatan, alkuperäisjuurten, inventaarion,
operaatiokansion tai ulkoisen valinnan muutos, joka näkyisi vain pois
jäävässä etutarkistuksessa ja palautuisi täysin ennen säilyvää täyttä
tarkistusta, voi jäädä havaitsematta myös natiivin muutosvartijan sisällä.
Pysyvä muutos estää seuraavan
muutoksen. Havaintomääriä, ajoitusta tai virheiden järjestystä ei kuvata
muuttumattomiksi. Luenta ei anna itsenäistä poistolupaa.

Pieni vertailu, semanttinen koetyypitys ja rajatut muutos-, peruutus-,
vanhentuneen callbackin sekä natiivin virhemuunnoksen kontrollit
läpäisivät. Myös todelliset pidetyn tiedostoluvun ja sulun kontrollit
valmistuivat nykyisissä aikarajoissa. Samat 120 nykyistä oletustapausta
läpäisivät lähtö- ja ehdokasvaihtoehdossa. Alkuperäiset testirungot
säilyvät; niiden apuri välittää uuden valinnaisen argumentin ja todistaa
sen käytön. Vartijan tai välityksen tahallinen puuttuminen hylättiin
vastakokeissa. Rajattu jatkokatselmus läpäisi; sen pysyvän valintavirheen
malliväitettä korjattiin ja todennettiin ennen kytkentää. Kyse ei ole
todellisen build-tilan mutaation kokeesta. Tuotantolähteen normaali tyypitys
ja uuden etuvartijan todellisen natiivivirheen salaus/purku läpäisivät.
Kahdeksan tiedoston normaali vaikutusportti läpäisi 180 testiä. Tämän
jälkeinen pelkän testiapurin onnistumisen ja `undefined`-hylkäyksen erottelu
todennettiin kolmella kohdetestillä, normaalilla tyypityksellä, nykyisellä
salaus/purku-ketjulla ja rajatulla jatkokatselmuksella. Sovelluskoodi ja
jaettu fixture eivät muuttuneet tässä täsmennyksessä. Näyttöjä ei yhdistetä
kuvitteelliseksi yhdeksi ajoksi. Seuraava lähde- ja mittausjäädytys on tehty
yhtä samaa 23 kohteen porttia varten, ei vanhan hylkäyksen uusintana.
Aikarajat, backup-formaatit,
W7.5:n toimitusraja ja pitkän ketjun erillinen portti säilyvät.

###### Viimeistelijän terminal-julkaisun journalilukureuna

**5.11.2026: omistaja hyväksyi vertailukokeen jälkeen tämän yhden
viimeistelijän rajatun tuotantokytkennän, pysyvät regressiot ja nykyiset
portit. Kytkentä on työpuussa; koko W7.4 on avoinna.** Säilynyt
23 kohteen aineisto ja nykyinen lähde kohdistavat kysymyksen
`workspaceDeletionFinalization.ts`:n `purged -> registryPublished`-
etenemiseen ja keskeytyneen journalin `recover`-kutsuun. Tämä koosteen
polku ei suorita puuttuvien alkuperäisjournalien siivousta. Tuontijournalin
tai yllä kuvatun `clearTerminal`in hyväksyntä ei kata näitä kahta kutsua.

Nykyinen `P` on viimeistelijän täysi `assertPurged`: inventaarion tavut ja
identiteetit, payloadien, metadatan ja alkuperäisjuurten poissaolo sekä
ulkoinen valinta. `S` on tallentimen nykyinen muuttuvien omien slottien
tavu-/identiteettivertailu. Ehdokas käyttää jo olemassa olevaa valinnaista
lukureunaa: `P -> S -> P` muuttuu muotoon `E -> S -> P`. `E` tarkistaa
saman kutsun ja vaiheen eliniän, nykyisen rekisterivalinnan, omistajuuden,
kirjoittajien poissaolon sekä mahdollisen täyden main-valinnan. Uutta
tallenninta, luentatilaa tai sisältövälimuistia ei lisätä.

Jokainen nykyinen natiivi prepare-/create-/move-/remove-/sync-vartija ja
viimeinen vartija säilyttää saman `S -> P`-ehdon. Alkuperäinen täysi `P`
ennen molempia tallenninkutsuja säilyy. Lukutulos ei anna muutoslupaa;
omat laillisesti muuttuvat journal-slotit kuuluvat edelleen tallentimelle.
Kutsukohtainen callback päättyy pysyvästi `finally`ssa, ja ensimmäinen
virhe säilyy myös heitetylle `undefined`-arvolle natiivimuunnoksen yli.

**Omistajan hyväksymä uusi havaintoero:** vain pois jäävän johtavan `P`:n aikana
näkyvä ja ennen säilyvää tarkistusta täysin palautuva inventaario-,
payload-, metadata-, alkuperäisjuuri- tai ulkoinen valintamuutos voi jäädä
havaitsematta, myös natiivin muutosvartijan sisällä. Pysyvä muutos estää
seuraavan muutoksen. Slottien luku-, identiteetti- tai sulkuvirhe voi tulla
ensimmäiseksi aiemman johtavan `P`:n virheen sijaan. Tämä ei ole kaikkien
havaintojen vastaavuus tai atominen tilakuva.

Rajattu koe käyttää nykyistä fixtureä ja oikeita tiedostoja. Normaali/cold
V2, tyhjä alkuperäisjournalitodisteiden lista sekä terminal-current ja
purged-backup on erotettu. Pysyvä payload, vaihtunut slotti-identiteetti,
natiivien muutosrajojen vartijat, todellisen pidetyn tiedostoluvun ja sulun
päättyminen sekä alkuperäinen `Error`/`undefined` läpäisivät kohdekontrollit.
Palautuva payload todistaa havaintoeron lähtöön; sitä ei väitetä samaksi
käyttäytymiseksi. Kokeen tyypitys ja rajattu lähdekatselmus läpäisivät.
Ehdokkaalla läpäisi myös kahdeksan nykyisen tiedoston 191 regressiota.
Kolme elinikä-/toisen julkaisusiirron kontrollia läpäisivät erillisessä
valinnassa; sarjoja ei summata. Tarkoituksella poistettu viimeinen
sisältövartija sai nimetyn pysyvän payloadin kontrollin hylkäämään
väittämään, ei aikakatkaisuun.

Hyväksytty kytkentä vastaa tavuntarkasti koeehdokasta. Ehdokaspuolen
väittämät siirrettiin 36 pysyvään regressioon ilman koetilan valintaa;
kaksi niistä todentaa uuden virhereunan nykyisen keräysapurin. Nykyinen
OpenPGP-työntekijä saa saman alkuperäisen virheobjektin myös aidosta
advance-/prepare-reunasta. Keräyksen 24 tietuetta ja tietosisältö säilyvät.
Normaali tyypitys, yhdeksän kokonaisen tiedoston 227 testiä ilman ohituksia
sekä rajattu kytkentä-/koeväitekatselmus läpäisivät. Salaus/purku palautti
kaikki 24 alkuperäistä tietuetta tavuntarkasti uuden virhereunan kanssa.
Sen ensimmäinen ajo pysähtyi ennen salausta: monen virhereunan kooste
ylitti viiden sekunnin testirajan. Uusi kontrolli siirrettiin olemassa
olevaan lyhyeen julkaisuvirheen testiin. Alkuperäinen koostehylkäys,
aineisto ja sulkutodiste säilyvät; korjattu portti ja rajattu siirtokatselmus
läpäisivät. Sovelluskoodi, keräyksen tietosisältö ja testirajat eivät
muuttuneet tässä korjauksessa. Nykyisen mittarin kolme kontrollia ja
kahden testitiedoston semanttinen tyypitys läpäisivät; lähde ja syötteet
jäädytettiin ennen hyväksyttyä yhtä 23 kohteen ajoa nykyisessä 180 sekunnin
rajassa. Ajo aikakatkaisi jo metadatasiivouksessa ennen viimeistelijän
aloitusta. Julkaisu, fyysinen vaihe ja rekisteri valmistuivat. Säilynyt
V2-journal oli `purged`, alkuperäisjournalitodisteita ei ollut, ja kaksi
alkuperäistä virhetietuetta sekä keskeneräiset tiedostot säilyivät.
Seuratut työt päättyivät; lopullista siivousta ei hyväksytty eikä
käyttöjärjestelmätason siivousta päätellä siitä. Tulos ei mittaa tämän
viimeistelijämuutoksen nopeutta. Sama lähde ei uusiudu tämän tuloksen
perusteella. Aikarajat, vanhat hylkäykset ja W7.4:n muut portit säilyvät.

**Rajatussa yhteiskatselmuksessa käsitelty kysymys:** fyysisen etenijän kolme loogista
vaihekirjausta käyttävät nykyistä täyttä inventaarioluentaa journalin
natiivien slottimuutosten vartijana. Lähdekatselmus erottaa tästä omat
fyysisen payload-muutoksen ja vaihejulkistuksen todistusvastuut yhdessä
nykyisen journalitallentimen, yhteisen slottitallentimen ja natiivikerroksen
kanssa. Uutta sopimusta ei päätellä tämän viimeistelijän hyväksynnästä.
Ennen mahdollista koetta tarvitaan täsmällinen vastuunjako, havaintoero,
ensivirhe-/sulkuvaikutus sekä nykyisten täysien muutosvartijoiden kohtalo.
Tämä jatkokysymys ei anna uutta vartijakevennystä, välimuistia, aikarajan
nostoa tai pitkää ajoa. Jo hyväksytyt kytkennät säilyvät; yleistä
elinkaariremonttia tai uutta testijärjestelmää ei aloiteta.

###### Fyysisen vaiheen journalin väliluvut ja muutosvartijat

**5.11.2026: rajattu vertailukoe ja ensisyyn säilytyksen tarkennus on
todennettu. Kytkentä on kolmessa nykyisessä omistajassa ja pysyvissä
regressioissa; kokonaisketjun ja integraation portit ovat avoinna.**
Tämä täsmentää edellisen yhteiskysymyksen. Nykyinen
`PayloadExecutor` antaa jo erillisen vartijan journalin slottilukujen alkuun;
saman alkureunan uudelleenkevennys ei ratkaise jäljellä olevaa toistoa.
Kaikkia kokonaisia luentoja ei myöskään luokitella tarpeettomiksi.

`P` on nykyinen `consume(state, 'validate', false)`: koko inventaario,
payload-tila ja sidonnat sekä niiden täydet ulkoiset valinnat. `B` on nykyinen
`phase.assertExternalSelection` sellaisenaan, ilman lisättyä main-valintaa.
Uusi `E` tarkistaa kutsun ja vaiheen voimassaolon, alkuperäisen
rekisterivalinnan, fyysisen omistajuuden, kirjoittajien poissaolon sekä
mahdollisen täyden main-valinnan. Se kuuluu vain kahden väliluvun loppuun;
vanhan kolmannen argumentin alkutarkistus `B` ei muutu.
`S` vertaa tallentimen omia muuttuvia current/next/backup-tavuja ja
identiteettejä. Vanhaa journal-valintaa ei vaadita oman siirtymän yli.

| Nykyinen raja | Ehdotus vain fyysisen etenijän `advance`-kutsulle |
| --- | --- |
| Executorin koko vaihevalinta, workspace-rivin haku, admitted-luenta ja siirron/purgen jälkeinen luenta | Säilyvät. Rivi tai aiempi onnistuminen ei anna muutosvaltuutta. |
| `replaceSelected`in ensimmäinen oma vartijakutsu, ennen `prepareDirectory`a | Samat slottiluennat ja identiteetit, mutta `B -> S -> P` olisi tässä `B -> S -> E`. |
| `replaceSelected`in oma vartijakutsu next-kirjoittajan sulun ja `readOwnedIdentity`n jälkeen, ennen ensimmäistä slot-siirtoa | Sama rajattu `B -> S -> E`. Kirjoitus, sync, sulku ja julkaistavan tiedoston omistajuusnäyttö säilyvät. |
| Natiivin `prepareDirectory`, `createNextWriter`, molemmat `moveSlot`it, varaslotin `removeSlot` sekä molemmat `syncDirectory`-kohdat | Sama nykyinen täysi `B -> S -> P`; kevyttä vartijaa ei välitetä näille. Myös Windowsin sync-vartija säilyy, vaikka itse kansiosync olisi alustalla tyhjä operaatio. |
| Viimeinen `replaceSelected`-vartija ennen julkaistun identiteetin kuittausta | Sama täysi `B -> S -> P`. Executor vertaa lisäksi seuraavassa vaiheessa tarkat tavut ja palautuneen identiteetin. |
| Payloadin varsinaiset siirrot, purget ja niiden synkronoinnit | Kaikki nykyiset täydet vaihe-, sidonta-, kohde- ja muutosvartijat säilyvät. |
| `recover`, initial `publish`, `clearTerminal`, viimeistelijän `advance` ja muut tallentimen käyttäjät | Ei uutta kytkentää; nykyinen oletusjärjestys säilyy. |

**Pienimmän kokeen kolme omistajaa:**

- `workspaceDeletionPayloadExecutor.ts` antaa vain omille fyysisille
  vaihesiirroilleen kutsukohtaisen `E`:n. Mahdollinen mainin vakaa valinta
  ympäröi vaiheomistajan ulkoista tarkistusta vain uudessa loppu-`E`:ssä;
  sitä ei korvata pelkällä synkronisella työluvalla eikä lisätä vanhaan
  alku-`B`:hen. Nykyinen täysi `P` pysyy muutosten vartijana.
- `workspaceDeletionJournalStore.ts` välittää uuden erillisen valinnaisen
  välilukukontekstin vain `advance`sta. Journalin muoto, sidonta,
  vaihejärjestys ja exclusive-omistajuus eivät muutu.
- `crashSafeByteSlotStore.ts` erottaa vain taulukon kaksi nimettyä
  välilukua. Ehdotettu pieni `CrashSafeByteSlotIntermediateReadSelection`
  sisältää `assertAfterSlotRead`-callbackin erillisenä neljäntenä argumenttina
  `replaceSelected`ille. Nykyinen `CrashSafeByteSlotReadSelection` säilyttää
  vanhan merkityksensä. Molemmat guardit käyttävät samoja tallentimen
  omistamia slot-/identiteettiolioita; natiiville annettu täysi guard ja
  viimeinen kuittausguard eivät vaihdu. Ilman uutta argumenttia suoritus on
  nykyinen. `crashSafeFileSlot.ts`:ää ei muuteta.

Konteksti ja sen callback kaapataan ja validoidaan ennen ensimmäistä
odotusta. Vajaa konteksti hylätään ennen I/O:ta. Väliluvun vartijaa ei valita
kutsunumerosta eikä hetkellisestä globaalista tilasta. Ei uutta
tiedostoadapterikäärettä, välimuistia, manageria tai ajastinta. Kutsukohtainen
valtuus päättyy vasta koko `advance`-työn ja sen omistettujen sulkujen
valmistuttua, onnistumisessa ja virheessä. Vanhan callbackin päättyminen
tarkistetaan ennen main-/vaihevalintaa tai niiden virhelukkoa: se ei kelpaa
uuden kutsun sisällä eikä sen hylkäys myrkytä uutta kutsua. Havaittu ensivirhe
säilytetään myös heitetylle `undefined`-arvolle. Kirjoituksen ja sulun
nykyistä kahden virheen `AggregateError`-rakennetta ei litistetä yhdeksi
syyksi. Fyysisen `advance`-kutsun täysi `P` säilyttää siinä havaitun
ensimmäisen hylkäyksen ennen natiivin koodimuunnosta. Kutsukohtainen
objektin olemassaoloon perustuva talletus erottaa myös heitetyn `undefined`n.
Kutsun odotettu I/O ja sulut päättyvät ennen säilytetyn syyn palautusta.
Ilman havaittua `P`-virhettä kirjoitus-/sulkuvirhe palautetaan muuttumattomana.
Nykyisen natiivilukijan jo muuntamaa virhettä tai sen oman
read/finally-close-rajan syysäilytystä ei väitetä korjatuksi.

**Erikseen hyväksyttävä havaintoero:** vain jommankumman pois jäävän
väliluvun `P`:n aikana näkyvä ja ennen seuraavaa täyttä tarkistusta täysin
palautuva inventaario-, payload- tai sidontamuutos voisi jäädä havaitsematta.
Pysyvä muutos on havaittava ennen seuraavaa natiivia muutosta. Kahden
samanaikaisen vian ensihavainto voi siirtyä myöhemmän natiiviesitarkistuksen
virheeseen; todellista ensisyytä ei vaihdeta oletetuksi. Tämä ei ole atominen
tilakuva tai kaikkien havaintojen vastaavuus. Natiivin muutosvartijan sisäistä
tarkistusjärjestystä ei muuteta tässä ehdotuksessa.

**Pieni vertailunäyttö ennen tuotantopäätöstä:**

1. Nykyinen pieni journal-/executor-fixture oikeilla tiedostoilla; sama
   lähtö ja vain muistissa ladattu ehdokas. Todista nimetyt väliluvut,
   seitsemän nykyisen native-vartijan ja täyden loppukuittauksen järjestys,
   samat slottiluvut, palautunut identiteetti ja säilyneet vieraat tavut.
   Nykyinen alkutarkistus ei saa aikaistaa main-valintaa. Kutsumäärä ei yksin
   ole nopeusnäyttö.
2. Pysyvä payload-, sidonta-, inventaario-, rekisteri-, varaus- ja
   kirjoittajamuutos kummassakin välissä estää seuraavan varsinaisen
   muutoksen. Hetkellisesti palautuva sisältömuutos erottaa ehdokkaan
   lähtötoteutuksesta. Muuta slot-identiteettiä viimeisessä lukureunassa
   ja sisältöä natiivin guardin sisällä; säilyvät täydet vartijat hylkäävät.
3. Pidä oikea luku tai sulku kesken, mitätöi valtuus ja todista kaikkien
   aloitettujen töiden päättyminen. Tarkista Error/undefined-ensisyyt,
   erillinen sulkuvirhe ja nykyinen kirjoitus-/sulkuvirheen kooste sekä
   main-valinnan virhe. Onnistuneen ja epäonnistuneen kutsun vanha callback
   ei aloita I/O:ta eikä myrkytä uutta kutsua; callbackin vaihto odotuksen
   aikana ei muuta kaapattua sopimusta.
   Vertaa jäljellä olevat tavut, älä vain turvallista virhekoodia.
4. Katkaise next-kirjoituksen jälkeen, kummankin siirron jälkeen sekä
   sivuslotin poiston kohdalla. Nykyinen muuttumaton `recover` jatkaa vain
   sallitut slotit tuoreella täydellä valinnalla. Ennen ensimmäistä siirtoa
   hylätty valmistelu säilyttää nykyisen journalin ja omistetun next-slotin;
   uusi palautus säilyttää aiemmin julkaistun vaiheen eikä ota nextiä käyttöön.
   Myös puuttuva/vajaa lisäkonteksti sekä kaikki ilman sitä kutsuvat polut
   todennetaan.
5. Kielteinen vastakoe korvaa tarkoituksella natiivin täyden vartijan
   kevyellä; muutosta estävän kontrollin on hylättävä väittämään.
   Vaikutusalue kattaa nykyiset selected-slot-, deletion journal-/executor-,
   finalizer-, registry-, import-, adoption-, switch-, first-start- ja
   accepted-build-kutsujat sekä tyypityksen ja rajatun katselmuksen.

Kokeen tulos, havaintoero, ensivirheet ja sulkutulos kirjataan erikseen.
Koe ei avaa tuotantokytkentää tai uutta 23 kohteen ajoa. Mahdollinen myöhempi
tuotantopäätös vaatii tämän näytön; kokonaisketjun portti pysyy nykyisessä
180 sekunnin rajassa. Sisältö-, palautus-, salaus/purku-, paketti-,
riippumaton loppukatselmus- ja PR/main-portit sekä W7.5:n sulku säilyvät.
Edeltävän pitkän kokeen hylkäystä tai puuttuvaa loppusiivousta ei suljeta.

**Kokeen välinäyttö:** korjatun vertailun lähtöversio läpäisi 19 ja ehdokas
25 kontrollia; täydennyksen kahdeksan kontrollia ja nykyisen journalitiedoston
33 regressiota läpäisivät kummassakin versiossa. Sarjoja ei summata.
Kaksi välilukua, seitsemän täyttä natiivivartijaa, loppukuittaus, samat
slottitavut ja identiteetit sekä keskeytyneen julkaisun palautus todennettiin
pienellä oikeiden tiedostojen aineistolla. Täydet sisältöluennat vähenivät
kymmenestä kahdeksaan; todellisten slottilukujen määrä ei muuttunut.
Tämä ei ole koko 23 kohteen ketjun nopeusnäyttö.

Todellisen executorin kontrolli todensi uuden loppuvartijan järjestyksen,
alkuvartijan ennallaan säilymisen sekä onnistuneen ja epäonnistuneen vanhan
callbackin eristyksen tuoreen kutsun aikana. Tuoreet kutsut rajattiin
valtuuskokeiksi, ei uusiksi julkaisuiksi. Error/undefined-ensisyyt ja
kirjoitus-/sulkuvirheen kooste säilyivät. Täsmälliset ulkoisen virheen ja
omistajan säilyttämän syyn vertailut sekä semanttinen tyypitys läpäisivät.
Riippumaton rajattu katselmus ei löytänyt runtime-ehdokkaan kytkentävirhettä.

Ensimmäisen ehdokasajon 11 väittämävirhettä säilytettiin. Kokeen laskuri
kohdisti osan injektioista väärään rajaan, palautuva sidonta poistettiin
kahdesti ja natiivin jo muuntamaa virhettä odotettiin alkuperäisenä.
Koekorjaus erottaa alku- ja loppuhavainnot, varmentaa todelliset slotit ja
sulkeutuneet kahvat sekä säilyttää alkuperäisen syyn erillään ulkoisesta
virheestä. Sovellus- ja nykyiset testilähteet eivät muuttuneet.
Tarkoituksellisesti väärä natiivivartija hylkäsi kolme väittämää;
vastakoe ei ole tavallisen portin hylkäys tai kaikkien natiivirajojen näyttö.

**Täydennetty näyttö:** oikean inventaarion neljä lähtö- ja 12
ehdokaskontrollia läpäisivät. Ne erottavat molemmat väliluvut todellisista
natiivivartijoista ja sisältävät jälkimmäisen main-/vaihetarkistuksen virheen,
valtuuden päättymisen odotuksessa sekä oikean kirjoittajan keskeneräisen
sulun. Katselmuksessa täsmennetty jälkiluku todensi myös prepared-nextin ja
muiden valittujen tavujen säilymisen ilman uutta muutosvaltuutta virheessä.
21 nykyisen oletuskutsujatiedoston lähtö ja alkuperäinen muistiehdokas
läpäisivät kumpikin 663 testiä yhden ennestään alustarajatun tapauksen
lisäksi. Sarjoja ei summata.

Ennen kytkentää tarkennettiin vielä `P`-ensisyy: alkuperäisen
muistiehdokkaan pysyvä inventaariovirhe saattoi muuttua myöhemmässä
natiivirajassa yleiseksi koodiksi. Vain executorin nykyinen `advance`
säilyttää nyt omassa tarkennetussa ehdokkaassaan todellisen havaitun
hylkäyksen ennen tätä muunnosta. Ajoitusta, luentavastuuta tai natiivikerrosta
ei muuteta. Tarkennettu ehdokas läpäisi 15 todellisen ketjun kontrollia ja
kaksi aidon kirjoitus-/sulkuvirheen koostevertailua sekä tyypityksen.
Error/undefined- ja kokonaisen koosteolion identiteetti säilyi. Ilman
`P`-hylkäystä uuden catch-rajan läpi kulki sama kirjoitus-/sulkukooste
samassa syyjärjestyksessä ja vasta omistetun sulun päätyttyä.

Yhteisen slottitallentimen ja journalitallentimen ehdokkaat säilyivät
tavuntarkasti samoina tämän ensisyytarkennuksen yli. Oletuskutsujien
663 testin vertailu on aiemman ehdokkaan näyttöä, ei tarkennetun varsinaisen
lähteen valmis portti. Varsinainen kytkentä vastaa tarkennettua kolmen
omistajan ehdokasta. Kuuden tiedoston 221 normaalia kohdetestiä ja tyypitys
läpäisivät. Kahden uuden testitiedoston vastuut ovat tallentimen väliluvut
sekä todellinen fyysisen etenijän journalikytkentä; alkuperäinen yhteinen
slot-fixture on pienessä testiapurissa. Vertailumuuntimia ei toimiteta
sovelluksessa. Nykyinen salaus/purku todensi alkuperäisen fyysisen
journalivirheen, pinon ja syyketjun sekä kaikkien 27 raportti- ja
kuittitiedoston tavut ja tiivisteet. Kaksi testiapurin ensihylkäystä
säilytettiin. Varsinaisen lähteen 26 tiedoston vaikutusportti läpäisi
782 testiä yhden ennestään alustarajatun tapauksen lisäksi; rajattu katselmus
ei löytänyt kytkentäestettä. Sarjoja ei summata. Nykyisen mittarin kolme
kontrollia ja kahden testiapurin tyypitys läpäisivät. Jäädytetyn lähteen yksi
sama 23 kohteen ketju läpäisi nykyisen 180 sekunnin rajan, mukaan lukien
metadata, viimeistelijä, lopulliset säilymisväittämät ja molempien testijuurten
poissaolo. Fyysisen vaiheen täydet inventaarioluennat olivat 37 aiemman 43:n
sijaan. Kaikki käynnistetyt mittarityöt päättyivät. Tämä ei ole yleinen
käyttöjärjestelmätason prosessisiivous- tai kestovakaustodiste. Koko W7.4:n
hyväksyntä tai vanhojen hylkäysten sulkeminen eivät seuraa näistä tuloksista;
kaikki 13 oikean prosessin tapausta ja 21 sulkuapurin kontrollia läpäisivät
nykyisellä lähteellä ilman uusintaa. Niihin kuuluvat kahdeksan cold-vaihekatkoa
ja uuden omistajan palautuminen sekä viimeisen vikatilaisen yrityksen poisto.
Tuoreen kanonisen valmistelun jälkeen neljä olemassa olevaa development-
Electronin poistotapausta läpäisivät myös nykyisellä lähteellä: aktiivinen,
passiivinen, viimeinen ja vikatilainen yritys. Oikea SQLite-/PDF- ja
synteettisen salaisuuden ketju sekä fixturen siivous todennettiin ilman
uusintaa. Sovelluslähde säilyi samana; tämä ei ole puhtaan hardened-paketin
tai W7.5:n poistokäyttöliittymän näyttö. Normaali desktop-kokonaissarja
hylkäsi saman 23 kohteen tapauksen metadatasiivouksessa; sen ensivirheet ja
aineisto säilyvät. Erilliset onnistuneet ketju- ja Node-jälkiajot eivät ole
kokonaissarjan hyväksyntä. Rajattu ajokytkentä erottaa koko ketjutiedoston
omaan pakolliseen sarjalliseen vaiheeseen nykyisten reporterien ja
180 sekunnin rajan sisällä. Kytkennän kielteiset kontrollit ja todellinen
testivalinnan kattavuusvertailu läpäisivät. Uuden jäädytetyn lähteen yksi
normaali kokonaisajo läpäisi kaikki kolme vaihetta: 10 902 tavallista
Vitest-testiä, koko erillinen 23 kohteen ketju ja 519 Node-testiä.
13 Vitestin ja 12 Noden vanhaa alustaohitusta eivät ole läpäisyjä.
Sovelluslähde ja nykyiset aikarajat säilyivät; ajokytkennän hyväksyntä ei
todista aiemman viiveen juurisyytä. Paketti-, loppukatselmus- ja PR/main-portit
sekä W7.5:n sulku pysyvät ennallaan.

###### Inventaarion retirementin kansioluennan jatkosuunnittelu

**Rajattu kytkentä on työpuussa nykyisen Goalin laajennetulla
toteutusvaltuudella; normaali vaikutus- ja kokonaisnäyttö ovat vielä avoinna.**
Nykyisen lähteen rooliketju jäi
inventaarion retirementiin ennen journalin tyhjennystä. Säilynyt aineisto
ja nykyisen mittarin tarkempi vaihe-erottelu rajaavat luetteloiden
sisäisen vartijatyön erilleen varsinaisista poistoista ja synkronoinneista.

Kokeen omistajat ovat nykyinen `workspaceDeletionInventoryRetirement` ja
sen nykyinen viimeistelijäkutsuja. Kansioiden nimien lukeminen käyttäisi
olemassa olevan erillisen lukukontekstin tuoretta vaihe-, journal-,
rekisteri-, varaus- ja kirjoittajatodistetta. Jokainen nimiluenta tarvitsee
oman päättyvän luentavaltuutensa: aiemman inventaarioluvun callback ei saa
aktivoitua uudelleen myöhemmän nimiluennan aikana.

**Kokeen jälkeen valittu pienempi kytkentä:** vain nimiluennan alkureuna
käyttää erillistä lukukontekstia; välittömästi nimien lukemisen jälkeen
säilyy nykyinen täysi terminal-/sisältövalinta. Myös kaikki kolmen
luentakohdan täydet edeltävät rajat, tiedostoidentiteetit sekä varsinaisten
poistojen ja synkronointien vartijat säilyvät. Nimiluennan lopun täyttä
vartijaa ei poisteta. Pysyvät muutoskontrollit ja välittömän loppuvartijan
paikan erottavat kontrollit läpäisivät; tarkoituksellisesti poistettu
loppuvartija hylkäsi kaikki kolme paikkakontrollia.

Tämä olisi täsmennys aiempaan vain cold-parille ja inventaarion
takaisinlukuun hyväksyttyyn kytkentään. Kokeessa selvitetään erikseen
normaalin jatkon vartija, ei lisätä näennäistä main-/cold-todistetta eikä
ohiteta puuttuvaa kylmäkäynnistyksen valtuutta. Muiden suorien kutsujien
ilman erillistä lukukontekstia tekemä oletus säilyy.

Normaali viimeistelijä välittää nyt saman vaiheen `assertSelected`-luennan
sekä inventaarion takaisinlukuun että nimiluennan alkureunaan. Tämä on uusi
normaalin jatkon sopimus, ei vanhan cold-hyväksynnän automaattinen laajennus.
Inventaarion kokonaisen takaisinluvun täydet alku-/loppurajat säilyvät;
kylmän kutsujan omat vakaat main-/build-/palautusvalinnat pysyvät niissä
mukana. Tavalliselle jatkolle ei keksitä kylmätodistetta. Molemmissa
luennoissa kokonaan ryhmän sisällä ilmestyvä ja täysin palautuva ulkoinen
metadata tai ylimääräinen valinta voi jäädä havaitsematta, myös
muutosvartijan sisällä. Pysyvä muutos estää jatkon ennen muutosta.

**Erillinen virhetietokorjaus:** oikean tiedostokahvan koe osoitti, että
ylempi viimeistelijä hukkaa inventaarion luvun jälkeen syntyvän erillisen
sulkuvirheen jo säilytetyn ensisyyn taakse. Valmistunut virhepuu välitetään
nyt vain kyseisen odotetun inventaarioluvun catchistä sen todellisen sulun
jälkeen. Kutsukohtainen ilmoitus vanhenee delegaatin päätyttyä. Ensisyyn
lukkoa ei korvata muualta tulevan samanmuotoisen aggregaatin perusteella.
Yhdeksän erillistä normaali-/cold-, `undefined`-, todellisen sulun,
ulkopuolisen aggregaatin ja vanhentuneen ilmoituksen kontrollia sekä
ehdokkaan tyypitys läpäisivät. Ensimmäinen yleisempi virhemuodon tunnistus
hylättiin katselmuksessa; sitä ei kytketty. Tämä korjaus on erillään
luentakevennyksestä, eikä muuta poistolupaa tai aikarajaa.

Ennen koetta nimetään kaikki luentaryhmän säilyvät täydet alku- ja
loppurajat. Nykyiset inventaariotiedoston poiston, oman operaatiokansion
poiston ja molempien kansiosynkronointien vartijat säilyvät. Nimiluenta ei
anna poistolupaa; todelliset nimet, tiedostot, tiivisteet ja identiteetit
tarkistetaan edelleen. Havaintoero koskisi vain näiden puhtaiden
luentaryhmien sisällä muuttuvaa ja täysin palautuvaa ulkoista sisältöä
tai valintaa, myös silloin kun luenta on muutosvartijan sisällä. Pysyvä
muutos estää jatkon. Tarkka havaintoikkuna sekä virheiden järjestys
verrataan lähtöön, eikä tarkistuksia väitetä muuttumattomiksi.

Pienet kontrollit erottavat nykyisen oletuksen ja rajatun lukukontekstin,
normaalin ja kylmän kutsujan, jokaisen oikean muutosrajan, palautuvan ja
pysyvän muutoksen, vanhan callbackin sekä keskeneräisen luennan sulun.
Lisäksi koko kutsuketjun alkuperäinen virhe ja erillinen todellinen
sulkuvirhe varmistetaan ennen mahdollisen kytkennän käsittelyä. Uutta
manageria, tallenninta, testialustaa tai kokonaista optimointihanketta
ei aloiteta; nykyiset aikarajat ja lopulliset hyväksyntäportit säilyvät.
Pienten vertailujen ja rajatun riippumattoman katselmuksen jälkeen
kytketyn lähteen normaali tyypitys ja viiden tiedoston 126 regressiota
läpäisivät ilman ohituksia. Alkuperäinen lukuvirhe ja erillinen todellinen
sulkuvirhe todennettiin nykyisen salatun paketin purusta samalla 24 tietueen
sopimuksella. Rajattu jatkokatselmus ei löytänyt uutta puutetta. Laajempi
seitsemän tiedoston 143 testin sarja läpäisi ilman ohituksia, mukana kaikki
13 oikean prosessin tapausta ja kahdeksan cold-vaihekatkoa. Päällekkäistä
näyttöä ei summata. Mittausliitoksen nykyiset kontrollit ja lähdejäädytys
varmennettiin ennen yhtä uuden lähteen saman 23 kohteen porttia. Se
aikakatkaisi metadatasiivouksessa ennen viimeistelijän aloitusta. Aineisto
ja ensivirheet säilyivät; kytkennän koko ketjun riittävyyttä ei ole
todennettu. Säilyneiden raporttien vertailussa aloitusjulkaisun, fyysisen
vaiheen ja rekisterijulkaisun havaitut kutsumäärät sekä virhetilat vastasivat
aiempaa ajoa, mutta kestot erosivat. Tästä ei päätellä ajonaikaista syytä
tai uuden lähteen regressiota. Seuraava rajaus on nykyisen
tarkistusvastuukartan ja jo kerättyjen kustannusten katselmus ennen uutta
muutosta tai pitkää koetta. Aikaisemmat hylkäykset säilyvät avoimina.

###### Metadatan toisen sidontavalinnan koesopimus

**Rajattu tuotantokytkentä on hyväksytty ja työpuussa; vaikutusregressiot ja
kokonaisnäyttö ovat avoinna.** Alla oleva koehistoria ei kumoa tämän kohdan
lopussa kirjattua uudempaa tuotantopäätöstä. Tämä on erillinen täsmennys
[aiemman ennakkoluennan sopimuksen](#w74-d-metadatan-ennakkoluennan-rajattu-koesopimus)
toisen iteratorin suojattuun valintalukuun, ei alkuperäisjournalin viimeiseen
sidontatarkistukseen tai yleiseen tallentimeen kohdistuva muutos.

Vain `workspaceDeletionMetadataCleanup.ts`:n toisen iteratorin `bindingsFor`
käyttää muistissa ladattavassa ehdokkaassa nykyistä
`inspectCommittedDeletionSlots`-havaintoporttia. Kutsukohtainen luentavaltuus
säilyttää vaihe-/rekisteri-/journal-valinnan, omistajuuden ja kirjoittajien
poissaolon sekä päättyy ensimmäiseen virheeseen tai onnistuneen luennan
sulkeutumiseen. Sidontakohde, avain, lineage, digest, kaikkien slottien
todelliset tavut ja tiedostoidentiteetit tarkistetaan nykyiseen valintaan.
Alkuperäistä valintaa ei korvata uudella lähtötilalla.

Sidonnan luvut ja kahvat päättyvät ja sen luentavaltuus vanhenee **ennen**
`consume`-kutsua. Ulompi inventaariolukija voi olla tuolloin vielä avoinna,
mutta senkin sulku päättyy ennen metadatasiivoojan palautumista. Kopioidut
slottihavainnot välitetään nykyisen strict-clearin `expectedDeletionSlots`-
vertailuksi. Clear käyttää omaa nykyistä valtuuttaan, ei päättynyttä
luentavaltuutta; luentatulos ei anna payloadin poissaolo- tai poistolupaa.

**Muuttumattomat rajat:** alkuperäisjournalin viimeinen `selectedBinding`,
V2:n `originalBindings` ja aliaspolut, `clearCommittedAfterPayloadsAbsent`,
kaikki natiivit remove-/sync-vartijat sekä strict-jälkiluku ja loppuvertailut
säilyvät. Tyhjä tai puuttuva sidonta ei oikeuta ohittamaan strict-clearia.
Toistuvia avaimia ei poisteta kierroksesta, eikä tuloksia välimuistiteta.
Yhteinen tallennin, rajapinnat, muut kutsujat ja aikarajat eivät muutu.

**Kokeeseen hyväksytty havaintoero:** pois jäävät täydet poissaololuennat
tarkistavat myös inventaarion eheyttä, alkuperäisjuuria ja soveltuvaa
vakaata valintaa. Kokonaan tämän lukuvaiheen sisällä muuttuva ja täsmälleen
ennalleen palautuva ulkoinen payload-, inventaario-, alkuperäisjuuri- tai
valintatieto voi jäädä havaitsematta; myös ensimmäinen havaittu virhe ja
sen ajankohta voivat muuttua. Seuraavassa säilyvässä täydessä vartijassa
edelleen oleva muutos estää poiston. Koe ei väitä vanhaa havaintorytmiä
vastaavaksi eikä tee tiedostojärjestelmän ulkoisista muutoksista atomisia.

Nykyiseen pieneen fixtureen perustuva vertailu todentaa:

- pysyvän ja kokonaan palautuvan muutoksen erikseen sekä säilyvät tiedostot;
- alkuperäisjournalin viimeisen strict-luvun payload-paluu-vastakokeen;
- kaikkien sivuslottien, tavujen, identiteettien ja caller-syötteiden muutokset;
- todellisten `next`-, `backup`- ja `current`-poistojen sekä syncin vartijat,
  myös tyhjän ja puuttuvan hakemiston polut ja strict-jälkiluvun;
- keskeneräisen luvun/sulun, valtuuden menetyksen, ensisyyn säilymisen myös
  `undefined`-arvolla ja vanhentuneen callbackin hylkäyksen ilman uutta I/O:ta;
- V1/V2- ja oletuskutsujat, toistuvat avaimet ja muiden yritysten säilyvät tavut.

Mittaus erottaa tämän valintaluvun tarkistusmäärät varsinaisten muutosten
vartijoista. Sisäkkäisiä kestoja ei summata, eikä pientä säästöä tulkita
normaalin rooliketjun tai erillisen backup-valmistelun korjaukseksi.
Koetulokset ja rajattu katselmus edeltävät mahdollista erillistä
tuotantokytkentäpäätöstä. Aiemmat hylkäykset pysyvät avoimina.

**Koetulosten historia 4.11.2026; nykyinen koeportti on jäljempänä.**
Tarkennettu nykyisen toteutuksen vertailu läpäisi 103 valittua kontrollia;
ehdokas läpäisi 100 ja aikakatkaisi kolme uutta yhdistelmäkontrollia.
Niiden yksi rajattu erillisdiagnoosi läpäisi yhden ja aikakatkaisi kaksi.
Alkuperäisjournalin viimeinen strict-luku, varsinaisten poistojen sekä
syncin vartijat ja strict-jälkiluku säilyivät nimetyissä kontrolleissa.
Natiivin sync-vartijan tarkoituksella ohittava vastakoe hylättiin juuri
sen oman vartijakutsun puuttumisesta, ei pelkästä lopullisesta virhekoodista.
Keskeneräisen natiiviluvun/sulun päättyminen, tarkka slottivalinta ja
callback-virheen säilyminen myös `undefined`-arvolla todennettiin.

Toisen valintaluvun kaksi täyttä poissaolokutsua poistuivat kokeessa;
muutosrajojen tarkistukset eivät poistuneet. Rajattu V2-tapaus ilman
alkuperäisjournal-todisteita vahvisti saman säästön omassa polussaan.
Tämä ei osoita koko 23 rivin ketjun valmistumista tai keston korjausta.
Alkuperäisjuuren havaintoero mallinnettiin erikseen laillisesta keskeytystilasta;
malli ei todista raakaa ulkoisen tiedostojärjestelmän transienttia muutosta.
Palautetun inventaariosisällön koe ei palauta kaikkia jo avoimen ulomman
tiedostolukijan identiteettitietoja, joten sen myöhempi virhe on eri havainto.

Rajattu riippumaton lähde- ja koeväittämien katselmus sekä ehdokkaan ja
koetestien tyypitys läpäisivät; katselmuksen koeväittämien puutteet korjattiin.
Myös pienemmällä journal-retirementin jälkeisellä fixturellä yksi
luentavaltuuden päättymisen ja loppusiivouksen yhdistävä kontrolli aikakatkaisi.
Tämä ei vielä erota sovellustyötä koetestin lisäkuormasta. Pienet läpäisyt
eivät korvaa avoimia yhdistelmäkokeita. Ehdokas jää muistissa ladattavaksi
kokeeksi; aikarajoja, tuotantokoodia tai aiempien hylkäysten tilaa ei muutettu.

**Loppuvaiheen mittausvalmistelu:** nykyinen yksityinen mittausapuri erottaa
koeversiossa clear-kutsun, sen journal-vartijan, strict-jälkiluvun, toisen
inventaariokierroksen päättymisen, metadatan poissaololuennan ja viimeiset
purged-/journal-tarkistukset. Testin valmistelu, sovelluskutsu, säilyvien
tavujen vertailu ja vanhentuneiden callbackien väittämät erotetaan samoin.
Kolme muuntimen kontrollia varmensi kohteet, väittämien säilymisen sekä
muuttumattomat raja-/uusinta-asetukset; semanttinen tyypitys läpäisi.
Mittaus ei korvaa alkuperäistä virhettä, muuta tarkistusvastuita tai anna
tuotantokytkentälupaa.

**Hyväksytyn yhden lisädiagnoosin tulos:** nykyinen viiden sekunnin raja
täyttyi metadatan poissaololuennassa. Sitä ennen vanhentuneiden callbackien
väittämät, sidonnan clear-kutsu, strict-jälkiluku ja toinen inventaariokierros
valmistuivat. Viimeisiä purged-/journal-tarkistuksia ja säilyvien tavujen
loppuvertailua ei saavutettu. Kaikki mitatut kutsut päättyivät; tulos ei
ole koko siivouksen hyväksyntä eikä todista pitkän rooliketjun syytä.
Yhden lisädiagnoosin lupa on käytetty, eikä mittaus nollaa uusintarajaa.

**Hyväksytty rajattu koetestibudjetti:** vain kolme uutta yhdistelmäkontrollia
(onnistuneen luentavaltuuden päättyminen ennen strict-clearia, kokonaan
palautuva vakaa valinta ja tyhjän hakemiston strict-clear) saavat
kymmenen sekuntia sekä yhden rajatun todennuksen. Tavoite on todentaa
näiden koko ketju lopputarkistuksineen, ei korvata pitkän rooliketjun
suorituskykyselvitystä.
Sovelluksen, muiden testien ja CI:n aikarajat sekä kaikki tarkistukset
säilyvät; tuotantokytkentä ja koko W7.4:n hyväksyntä ovat edelleen erillisiä.

**Nimetyn budjetin todennus:** yksi kohdeajo läpäisi kaikki kolme nimettyä
kontrollia alkuperäisine väittämineen ja säilyvien tavujen vertailuineen.
Ajokonfiguraation kolme pientä kontrollia varmensi, että vain nämä kolme
tapausta valitaan, budjetti on kymmenen sekuntia, uusinnat pysyvät nollassa
ja aiemmin tarkistettu koetoteutus sekä väittämät pysyvät täsmälleen samoina.
Lähdekehys säilyi muuttumattomana. Tämä ei ole koko tiedoston uusi läpäisy,
koko rooliketjun todennus tai historiallisten aikakatkaisujen sulkeminen.
Aiempia päällekkäisiä kohdeajoja ei lasketa yhteen hyväksyntämääräksi.

**Keskustelun jälkeen hyväksytty rajattu tuotantokytkentä:** vain tämän yhden metadatasiivoojan
toisen `bindingsFor`-luennan vaihto nykyiseen havaintoporttiin, rajattu
kutsukohtainen luentavaltuus ja pysyvät regressiot. Kolmen nimetyn uuden
yhdistelmäregression kymmenen sekunnin budjetti rajattaisiin niihin;
koemuuntimia, mittareita tai testin `consume`-koukkua ei toimiteta sovelluksessa.
Yllä kuvattu hyväksytty kokeen havaintoero säilyisi myös kytkennässä.
Alkuperäisjournalin viimeinen strict-luku, alias- ja V2-polut, strict-clear,
natiivit poisto-/sync-vartijat ja strict-jälkiluvut eivät muuttuisi.
Kohde- ja vaikutusregressioiden, tyypityksen ja rajatun katselmuksen jälkeen
tehtäisiin yksi normaali 23 rivin ketjutodennus nykyisessä aikarajassa.
Omistaja hyväksyi selitetyn rajauksen keskustelun jälkeen. Kytkentä ja
pysyvät regressiot ovat työpuussa; kohde-, vaikutus-, tyypitys- ja
katselmusportit olivat seuraava askel. Nykyisen lähteen tyypitys ja rajattu
riippumaton lähde-/koeväitekatselmus läpäisivät; kohdeajo läpäisi 22 uutta
regressiota ja aikakatkaisi kaksi onnistuvaa yhdistelmäpolkua niiden viiden
sekunnin rajassa. Valitsematta jäi 131 tapausta. Sulkutestin ensimmäinen
väittämä ehti väärään vaiheeseen; täsmällinen drain-odotus korjattiin ja
molemmat testiapurin regressiot läpäisivät. Aikakatkaisseiden uusien
toisen vaiheen fixturet rajattiin katselmoidusti jo valmistuneen oman
journalin poiston jälkeiseen tilaan; alkuperäiset loppuväittämät, todellinen
iterator ja muiden yritysten tavut sekä täydet retirement-testit säilyvät.
Näitä läpäisyjä ei kuvata koko alkuketjun tai vanhan timeoutin korjaukseksi.
Omistaja hyväksyi kahdelle jäljellä olevalle yhdistelmätestille erillisen
nimetyn kymmenen sekunnin budjetin ja yhden kohdetodennuksen.
Tämä yksi kohdeajo läpäisi molemmat testit alkuperäisine väittämineen;
muut 106 tapausta eivät kuuluneet valintaan. Lähdekehys säilyi samana.
Aiempia hylkäyksiä ei suljettu eikä kohdetulosta tulkita koko ketjun
suorituskykynäytöksi. Seuraava portti on normaali vaikutusalueen sarja.
Tämä 16 kokonaisen tiedoston vaikutusajo päättyi 457 läpäisyyn,
14 aikakatkaisuun ja yhteen ennestään alustarajattuun tapaukseen.
Kaikki 22 uutta sidontaluvun regressiota ja molemmat testiapurin
sulkuregressiot läpäisivät. Muut hylkäykset estävät kokonaisen portin
hyväksymisen. Nykyinen yksityinen keräys säilytti kaikkien hylkäysten
alkuperäiset runner-virheet; ne eivät vielä todista viiveen sisäistä syytä.
Yhden viimeistelytapauksen erillinen vaihediagnoosi läpäisi samalla
sovelluslähteellä ja nykyisessä rajassa. Valmistelu ja varsinaiset
sovelluskutsut erotettiin; toistuva rekisteriluenta todettiin sovelluskutsuissa.
Alkuperäiset loppuväittämät ja synteettisen fixturen siivous läpäisivät.
Tämä ei sulje ensimmäistä sarjahylkäystä. Viimeistelijän alkuperäisjuurten ja
metadata-poissaolon tarkistusvastuut ovat seuraava rajattu sopimuskysymys,
eivät tämän sidontaluvun tuotantoluvan laajennus. Tuotannon vartijoita tai
aikarajoja ei muutettu diagnoosissa.
Sama 23 kohteen kokonaisketju tehdään nykyisessä rajassa vasta
ennakkoporttien jälkeen. Olemassa olevasta testiapurista raportoidaan
valmistuminen, vaiheajat, tarkistusmäärät ja siivoustulos; sisäkkäisiä
kestoja ei summata eikä uutta yleistä mittaus- tai diagnostiikkakerrosta lisätä.
Uutta kokonaisajoa ei ole vielä tehty.
Paketti-, palautus-, PR/main-portit ja koko W7.4:n hyväksyntä pysyvät avoimina.

###### Viimeistelijän rajattu luentavastuuehdotus

**4.11.2026: omistaja hyväksyi kokeen jälkeen tämän yhden omistajan
tuotantokytkennän, pysyvät regressiot ja nykyiset portit. Niiden läpäistyä
tehdään yksi sama 23 kohteen ketju nykyisessä 180 sekunnin rajassa.**
Koe on nyt todennettu vain muistiin ladatulla yhden omistajan ehdokkaalla.
Viiden kokonaisen regressiotiedoston kaikki 120 testiä ja erillisen
tarkennusvalinnan kaikki 28 kontrollia läpäisivät nykyisillä aikarajoilla.
Valinnat erotetaan toisistaan ja vertailuajoista; päällekkäisiä ajoja ei
lasketa yhdeksi hyväksyntämääräksi. Ehdokkaan desktop-tyypitys ja rajattu
riippumaton toteutus-/koeväitekatselmus läpäisivät. Samalla alkuperäisellä
viimeistelytapauksella nykyinen mittausapu osoitti vähenevät rekisteriluvut,
säilyvät journal- ja inventaariolukujen määrät sekä päättyneet kutsut ja
testiaineiston siivouksen. Tämä ei ole koko poistoketjun suorituskykynäyttö
tai vanhojen aikakatkaisujen sulkeminen. Varsinaiset sovellus- ja
testilähteet säilyivät kokeessa muuttumattomina. Hyväksytty tuotantokytkentä
ja pysyvät regressiot ovat työpuussa. Desktopin tyypitys sekä rajattu
riippumaton kytkentä-/koeväitekatselmus läpäisivät. Kahden kohdetiedoston
kaikki 54 testiä läpäisivät 20 kokonaisen tiedoston vaikutusajossa.
Koko ajo jäi hylätyksi: 557 läpäisyä, yksi varmuuskopion valmistelutestin
aikakatkaisu ja yksi ennestään alustarajattu tapaus. Sama valmistelutesti
läpäisi yhden sallitun erillisdiagnoosin muuttumattomassa rajassa, mutta
ensihylkäystä ei suljeta eikä vaikutusporttia lasketa hyväksytyksi.
Varsinaisen uuden alkuperäisjuurten kytkennän ensivirhe löytyi myös nykyisen
salatun paketin purusta; eri siivousvirhe ei peittänyt sitä. Nykyinen
24 raportin sisältö-/tavusopimus ja keräysrajat säilyivät. Tämä ei ole
paketoidun sovelluksen todiste. Integraatioportit ovat avoinna; uusi
23 kohteen ajo odottaa ennakkoesteen käsittelyä.

Nykyinen toisensidontaluvun hyväksyntä koskee metadatasiivoojaa, ei tätä
viimeistelijän erillistä rajaa. Aiemmat vaikutusajon hylkäykset säilyvät.
Kysymys on kahden sisäisen luennan tarkistusvastuusta, ei journalin tai
natiivien muutosvartijoiden vähentämisestä. Mittaus erottaa pienen fixturen
valmistelun sovelluskutsuissa kertautuvasta rekisteriluennasta; se ei todista
kaikkien aikakatkaisujen syytä tai ehdotuksen suorituskykyä.

**Rajatut nykyiset kutsut:** viimeistelijän `assertMetadataAbsent` kutsuu
yhteistä kolmen alkuperäisjournalin ja viiden sidontaomistajan lukijaa sekä
V2:n `originalAbsences`-lukijoita. Ilman erillistä luentavartijaa näiden
sisäinen valinta kutsuu `phase.assertExternalSelection`ia, joka lukee koko
alkuperäisen rekisterislottivalinnan uudelleen. Viimeistelyn ylemmät
recover-/advance-/retirement-/clear-vartijat käynnistävät nämä luennat
useita kertoja. Pelkkä samanniminen callback ei siksi ole yksi fyysinen luku.

**Kokeeseen ehdotettava muutosalue:** vain
`workspaces/deletion/workspaceDeletionFinalization.ts`:n kaksi kytkentää.
Yhteinen metadatalukija, alkuperäisjuurten lukija, parent-lukija,
vaihevalinta, tallentimet ja muut kutsujat jäävät muuttumattomiksi.

1. Alkuperäisjuurten lukijalle annetaan sen olemassa oleva
   `assertReadSelection`-portti. Alkuperäinen parent-identiteettivektori
   kaapataan edelleen täydellä valinnalla. Lukijan nykyiset täydet
   alku-/loppuvertailut, todelliset parent-/poissaololuennat ja oma
   kutsukohtainen sulku säilyvät. Legacy-adoptionin erillistä 13 jäsenen
   lukijaa ei kevennetä eikä alkuperäistä vektoria valita uudestaan.
2. Vain viimeistelijän yhteisen metadatalukijan sisäiset callbackit käyttävät
   odotetun lukukutsun ajan rajattua vartijaa. Täysi
   `phase.assertExternalSelection` tehdään tämän kokonaisen luennan edellä
   ja jäljessä. Rajaus kattaa tavallisen terminal-polun ja `assertPurged`in
   metadataluvun; sen inventaarioluku ja payload-poissaolotarkistus säilyvät.
   Jo hyväksytty cold-terminalin metadataluvun rajaus säilyy omanaan, eikä
   siihen lisätä rinnakkaista koko luennan tarkistuskerrosta.

Uusien sisäisten vartijoiden järjestys on nykyinen
`assertCurrent`/`phase.assertCurrent`, `owner.assertOwned`, kirjoittajien
poissaolo ja `owner.assertOwned` uudelleen, voimassaolotarkistuksineen
jokaisen odotuksen ympärillä. Ne eivät saa ottaa käyttöön coldin yhdistettyä
varausporttia sen kolmen jo hyväksytyn käyttöpaikan ulkopuolella.
Ensimmäinen havaittu virhe, myös `undefined`, säilytetään heti jokaisen uuden
owner-/writers-callbackin omassa virherajassa ja sulkee luentavaltuuden ennen
lukijan siivousta. Pelkkä ulomman kokonaisluennan catch ei riitä. Säilytetty
ensivirhe tarkistetaan ennen myöhempää valtuustarkistusta; erillistä sulkuvirhettä
ei sekoiteta siihen. Takaisin kutsuttu vanhentunut callback hylätään ennen
uutta I/O:ta, myös seuraavan luvun ollessa käynnissä. Jokaiselle metadataluvulle
luodaan oma pysyvästi päättyvä sulku; yhteinen uudelleen avattava `reading`-
lippu ei saa elvyttää aiempaa callbackia. Jo aloitettu luku ja kahvojen sulku odotetaan;
ulkopuolisen toisen lukijan vielä ilmoittamatonta virhettä ei väitetä havaituksi.
Alkuperäisjuurten portti kuuluu vaiheeseen ja lukija rajaa yksittäiset kutsut;
metadatan callback kuuluu vain yhteen odotettuun kutsuun. Kumpikaan ei anna
myöhempää poistolupaa eikä säilytä sisältötulosta muutoksen yli.

**Säilyvät muutosvastuut:** `assertPurged`in nykyiset kutsurajat,
inventaarioluku ja payload-todistus säilyvät; sen metadataluvun sisäinen
havaintorytmi muuttuu yllä kuvatusti. Samoin säilyvät
`technical.assertExternalSelection`, recover/advance ja niiden valitut
slotit, inventaarion poisto ja kansiosync, tyhjän operaatiokansion poisto,
journalin viimeinen clear sekä kaikki nykyiset jälkivarmennukset.
Niiden kutsupaikkoja, sisältöluentoja, tiedostoidentiteettejä tai native-
vartijoita ei poisteta. Jokainen täysi muutosvartija tekee uuden kokonaisen
luennan. Journalin omia muuttuvia slotteja ei tarkisteta ulkoisen vartijan
vanhaa havaintoa vasten: ne kuuluvat edelleen tallentimelle. Tämä koskee
myös journalin clearin jälkeistä tarkistusta, jolloin journalin tulee puuttua.

**Erillinen hyväksyttävä havaintoero:** ulkoinen rekisteri-/vaihevalinnan
muutos, joka näkyy vain uuden sisäisen luennan aikana ja palautuu täsmälleen
alkuperäiseen tilaan ennen loppuvertailua, voi jäädä havaitsematta. Muutos
koskee myös luentaa täyden muutosvartijan sisällä; vartijan kutsupaikan
säilyminen ei tarkoita täysin samaa havaintorytmiä. Pysyvä valintamuutos
estää jatkon, ja kaikki todelliset payload-/metadata-/identiteettiluvut
säilyvät. Tämä ei lisää lupausta atomisesta ulkoisen tiedostojärjestelmän
valvonnasta. Mallinnettua palautuvaa havaintoa ei esitetä natiivien tavujen
ja identiteettien palauttamisen todisteena. Omistaja hyväksyi tämän eron
kokeeseen ja koenäytön jälkeen myös tähän rajattuun tuotantokytkentään.

**Rajatut kokeet ja portit:** nykyiset finalization-, terminal-metadata-,
original-payload-, cold-read-ownership-, inventory-retirement- ja
journal-testit säilyvät. Tavallisen ja ei-terminal-kutsujan sisäisiä
rekisterilukuja vaativat kaksi nykyistä väitettä muuttuvat vain nimenomaisen
koesopimuksen osalta; ne korvataan alku-/loppuvalinnan ja varsinaisen
muutosrajan hylkäyksen näytöllä, ei poistamalla tapausta. Todennetaan
erikseen V1/V2, molemmat vaiheet, läsnä/poissa oleva inventaario,
alkuperäistodisteiden omistajat, vieraan yrityksen säilyvät tavut, pysyvä ja
mallinnettu palautuva valintamuutos, luvun/sulun ensivirhe ja pidetty I/O.
Poisto-/sync-rajoihin ajoitettu palannut payload, vaihtunut identiteetti
tai menetetty valtuus estää juuri kyseisen muutoksen; pelkkä loppuvirhe ei
riitä väittämäksi. Tavallisen retirement-kutsun puuttuva erillinen luentaportti,
tavallisen postclearin nykyiset kaksi metadatakutsua ja alkuperäisjuurten
lukijan muiden kutsujien oletuspolku säilyvät. Erilliset testit näyttävät
ensivirheen säilymisen sisäisen callbackin virheestä siivouksen läpi ilman
testin omaa uudelleenheittoa, vanhentuneen callbackin hylkäyksen seuraavan
luvun aikana sekä päällekkäisen luvun hylkäyksen häiritsemättä aktiivista
operaatiota. Ehdokkaan tyypitys ja rajattu riippumaton katselmus
edeltävät kytkentäpäätöstä. Nykyisiä testibudjetteja ei nosteta.

Rajattu riippumaton lähde- ja sopimuskatselmus ei löytänyt estävää
ristiriitaa. Yllä olevat ensivirhe-, kutsuelinikä- ja testiväiterajaukset
täsmennettiin sen perusteella. Sopimuskatselmuksessa ei muutettu lähteitä
eikä ajettu testejä. Sen jälkeen hyväksytyssä kokeessa todennettiin myös
alkuperäisjuurten neljän omistajan kytkentä, alkuperäisen parent-valinnan
säilyminen, ensivirhe myös `undefined`-hylkäyksenä siivouksen yli sekä
vanhentunut callback tavallisessa, ei-terminal- ja todellisen vaiheenvaihdon
ylittävässä kutsussa. Mallinnettu muiden omistajien journal-sitoumus todistaa
tässä vain poissaololukijan kytkentää, ei niiden alkuperäisjournalin admissionia.
Koeväitteen väärä parent-virhekoodi korjattiin katselmuksesta ennen ajoa;
sovelluksen virhesopimusta ei muutettu.

Vertailun valmistuminen, sovellustyö, rekisteri-/journal-lukujen määrät,
muutosvartijoiden kutsut ja siivoustulos raportoidaan nykyisellä yksityisellä
testiapurilla; sisäkkäisiä kestoja ei summata. Yksittäinen läpäisy tai
lukumäärän lasku ei sulje vanhaa hylkäystä. Vasta rajatun kytkennän ja
vaikutusporttien jälkeen edetään samaan 23 kohteen ketjuun sen nykyisessä
180 sekunnin rajassa sekä W7.4:n muihin nykyisiin integraatioportteihin.
Ei pitkää koetta, tuotantokytkentää, aikarajamuutosta tai mergepoikkeusta
pelkän tämän suunnitelman perusteella.

###### Metadatan alkuperäisjuurten poissaololuvun jatkopäätös

**Kahden omistajan tuotantokytkentä ja rajatut portit todennettu työpuussa; koko integraatio on avoin.** Nykyinen 23 rivin rooliketju
kutsuu `createWorkspaceDeletionCommand`ia ilman `coldSelection`ia. Valmistunut
kolmen terminal-lukukohdan varauskytkentä ei muuta sen oletuspolkua.
Myöhempi saman rooliketjun ajo nykyisellä lähteellä aikakatkaisi edelleen
metadatasiivoukseen. Sen V2-journalin `originalJournalProofs` oli tyhjä;
alla oleva alkuperäisjuurten korjaus ei siksi itsessään muuta tämän tapauksen
kertautuvaa sidontasiivousta. Mittaus- ja lähdehavainto erotetaan
valmistuneen kytkennän kattavuudesta; aikarajaa ei nosteta eikä tätä
hylkäystä hyväksytä onnistumiseksi.
Ennen tätä korjausta metadatasiivooja antoi alkuperäisten palautusjäännösten
poissaololukijalle täyden vaihe-/rekisterivalinnan. Lukija käytti sitä uudelleen samojen
alkuperäisten parent-identiteettien tarkistuksissa; lisäksi sen kuittia
käytetään toistuvissa `assertPurged`-tarkistuksissa. Tämä on nykyisen
sovelluskoodin vastuu, ei pelkkä testiaineiston valmisteluhavainto.

Hyväksytty kytkentä koskee vain `workspaceDeletionMetadataCleanup.ts`:n
nimettyä kutsua ja `workspaceDeletionOriginalPayloadAbsence.ts`:n sille
antamaa valinnaista luentaporttia. Yhteinen parent-lukija ja muut kutsujat
säilyvät. Alkuperäinen parent-vektori valitaan edelleen täysillä vartijoilla;
sen arvoja ei korvata uudella lähtötilalla. Kunkin kokonaisen myöhemmän
poissaololuennan täysi vaihe-/rekisterivalinta tehdään molemmissa reunoissa.
Sisäiset luvut käyttävät voimassaolon, omistajuuden ja kirjoittajien
poissaolon vartijaa, mutta kaikki todelliset parent-identiteetti- ja
juuren poissaololuennat sekä vertailut alkuperäiseen säilyvät.
Legacy-alkuvalinta ja kaikkien varsinaisten poistojen nykyiset vartijat
säilyvät. Luentakuitti ei anna muutos- tai poistolupaa.

**Kytkentään hyväksytty havaintoero:** vain tämän kokonaisen luennan sisällä muuttuva
ja täsmälleen palautuva ulkoinen vaihe-/rekisterivalinta voisi jäädä
havaitsematta. Pysyvä muutos hylätään ennen jatkoa. Tämä on samaa riskilajia
kuin aiemmat luentarajaukset, mutta eri nimetty kutsupolku ja aiemmin
suojattu parent-raja. Omistajan myöhempi nimenomainen kytkentäpäätös kattaa
tämän saman havaintoeron, ensisyysuojan ja pysyvät regressiot nykyisten porttien kautta.

Alkuperäinen hyväksyntä koski vain suunnittelua ja pieniä kokeita
nykyisellä lähteellä. Aiempi muistiehdokas ei vastaa myöhempien
ensisyykorjausten lähdekehystä eikä sen tuloksia käytetä uuden kytkennän
hyväksyntänä. Kokeessa erotetaan todellisen tiedostokutsun aloitus,
vastauksen päättyminen ja ulomman työn päättyminen; `lstat`-/`realpath`-
kutsuista ei keksitä pysyvää kahvaa tai kernel-peruutustodistetta.
Hylätään muuttunut identiteetti, palannut juuri, vanhentunut callback,
valtuuden menetys ja myöhempään virheeseen peittyvä ensisyy. Oletuspolku,
muut kutsujat ja muiden yritysten tavut verrataan erikseen. Kestojen sijasta
todennetaan myös toistuvan työn väheneminen ja muuttumattomat muutosvartijat.
Pelkkä suunnittelulupa ei hyväksynyt tuotantokytkentää tai pitkää ajoa.
Myöhempi rajattu tuotantolupa ei muuta aikarajoja eikä lupaa poistaa
erillistä backup-valmistelun viivettä tai kaikkia rooliketjun esteitä.

**Nykyisen lähteen koenäyttö:** muistissa muunnettu kahden omistajan ehdokas
läpäisi 40 pientä kontrollia; nykyisen käytöksen erillinen 32 kontrollin
vertailu läpäisi. Sarjoja ei lasketa yhteen hyväksyntämääräksi.
Kaikkien neljän omistajan kansioidentiteetti- ja poissaolulukujen järjestys
verrattiin samaksi; täysien valintaluentojen määrä väheni nimetyssä
valinnaisessa polussa. Kaikkien neljän oletuspolku säilyi vertailussa samana.
Pysyvä valintamuutos, muuttunut kansioidentiteetti, palannut aineisto,
kirjoittaja ja vanhentunut valtuus estivät jatkon. Mallinnettu kokonaan
palautuva ulkoinen valintamuutos osoitti edellä hyväksytyn havaintoeron.

Todellisen metadatasiivoojan seitsemän rajattua kutsukoetta läpäisivät;
muut sarjan tapaukset eivät kuuluneet tähän valintaan. Kokeet pysähtyivät
ennen poistoa ja vertasivat alkuperäisjournalin sekä sidonnan kaikki slotit,
deletion-journalin, inventaarion, rekisterin ja säilytettävät tiedostot.
Omistajuus-, kirjoittaja- ja toinen omistajuusvartija todennettiin erikseen
myös pidetyn vastauksen ja myöhemmän valtuusmenetyksen kanssa. Alkuperäinen
ehdokas peitti kahdessa tapauksessa ensisyyn; uusi valinnainen luentakutsu
säilyttää sen nyt ehdokkaan omassa virhetilassa ennen ulompaa käsittelyä.
Tuotannon oletuskäsittelyä ei muutettu. Ehdokkaan ja koetestien tyypitys
läpäisi ilman emitointia. Täydennettyjen testiväitteiden ja rajatun
ehdokkaan riippumaton lähdekatselmus ei löytänyt jäljelle jäävää estettä
tämän kokeen tai kytkentäehdotuksen esittämiselle; se ei ole tuotantohyväksyntä.
Aloitetun todellisen `lstat`-kutsun vastaus ja
ulomman työn päättyminen erotettiin; tämä ei ole kernel-peruutustodiste.

**Tuotantokytkennän kohdenäyttö:** pysyvät regressiot, todellisen V2-
alkuperäisjournalin natiivin poiston ja syncin sisäiset täydet vartijat,
desktopin tyypitys ja rajattu riippumaton katselmus läpäisivät. Yksitoista
kokonaista vaikutusalueen testitiedostoa läpäisi: 322 testiä onnistui ja
yksi ennestään alustarajattu tapaus jäi ajamatta. Pienempien päällekkäisten
sarjojen tuloksia ei lisätä tähän määrään. Myös nykyisen aktivointimigraation
metadatatapaus läpäisi tällä uudella lähteellä; vanhaa aikakatkaisusyytä ei
silti nimetä korjatuksi eikä normaalia desktop-kokonaissarjaa hyväksytyksi.

Nykyinen salaus-/purkukoe todensi tämän lukijan todellisen uuden
luentavirhehaaran alkuperäisen viestin, pinon ja syyketjun puretuista
raporttitavuista. Kerättävät tietueet, kentät ja julkisen tulosteen rajat
säilyivät. Tämä on lukijasta toimitukseen ulottuva näyttö, ei koko
metadatasiivouksen tai natiivin I/O:n peruutuksen todiste. Lähde säilyi samana
tarkistusten ajan. Aikarajoja, riippuvuuksia tai muiden kutsujien vartijoita
ei muutettu. Seuraavat F:n, pitkän rooliketjun, paketin ja PR/mainin portit
pysyvät erillisinä; tämä rajattu näyttö ei hyväksy uutta pitkää cold-ajoa.

**F:n jäljellä oleva hyväksyntäpolku:** kaikki kahdeksan uutta cold-vaihekatkoa
läpäisivät nyt samalla nykyisellä lähteellä kahdessa erillisessä valinnassa,
ilman uusintaa tai aikarajamuutosta. Oikean prosessin katko, uuden omistajan
jatko, säilyvät tavut, varauksen uudelleenotto ja siivous todennettiin.
Valitsematta jääneitä tapauksia ei laskettu läpäisyiksi, eivätkä vanhat
hylkäykset muutu korjatuiksi. Tavallisen komennon rooli-/metadatakattavuus,
valmistelun vanha hylkäys, nykyiseen lähteeseen sidottu SQLite-/Electron-
ketju sekä puhdas hardened-paketti pysyvät erillisinä.
Vasta yhtenäisten kohdeporttien ja koko Goalin katselmuksen jälkeen edetään
puhtaan revision ja paketin jäädytykseen sekä normaaleihin PR/main-portteihin.

**Pakettinäytön avoin kytkentä:** nykyinen `run-packaged-smoke.mjs` ajaa
backup-/restore-vaiheen ja uuden prosessin vertailun. E2E-mainin erillinen
poistokutsu ei kuulu tähän tuotantopakettiin. Pakettinäyttöön tarvitaan
vielä nimetty sisäinen poisto-/restart-tapaus nykyisen testikytkennän sisällä;
pelkkä tavallisen smoken läpäisy ei todista sitä. Nykyisen valmistelukoukun
ja tuotannon cold-palautuksen soveltuvuus selvitetään ennen muutosta.
Keskeneräistä restore-journalia ei ohiteta poiston käynnistämiseksi,
eikä tähän avata W7.5:n renderer-/preload-kanavaa tai uutta yleistä harnessia.

Rajattu pakettikytkennän jatko perustuu seuraaviin lähdehavaintoihin ja
rajoihin; se ei ole valmis pakettitodistus tai uuden testitilan hyväksyntä:

1. Nykyisen smoken molemmat backup-/restore-prosessit sekä tietokannan,
   PDF:ien ja session vertailu säilyvät. Poistoa ei valmistella vielä
   `afterRestoreExit`-kohdassa: restore on silloin kesken.
2. Vasta palautusvertailun ja toisen prosessin todetun sulun jälkeen
   synteettinen testivalmistelu saa ottaa oman nykyisen OS-varauksen ja
   delete-leasen sekä julkaista saman komennon täsmällisen aloitusjournalin.
   Kohde on vain saman ajon smoke-profiilin viimeinen yritys. Yleistä polkua
   tai käyttäjän asennettua profiilia ei hyväksytä valmistelun syötteeksi.
3. Saman puhtaan paketin seuraava prosessi kuluttaa journalin nykyisellä
   `recoverDesktopWorkspaceDeletion`-ketjulla ennen tavallista startupia.
   Mahdollinen nimetty smoke-täydennys saa vain todentaa tyhjän valitsimen ja
   sulkea sen hallitusti; se ei julkaise poistoa tai anna uutta poistovaltuutta.
   Tämän jälkeen vielä uusi prosessi todentaa pysyvän tyhjän valitsimen.
4. Testiajuri vertaa kohteen, karanteenin, inventaarion ja journalin
   poissaolon sekä ulkoisten backup-/PDF-tavujen säilymisen. Nykyinen restore-
   vertailu poistaa synteettisen SMTP-salaisuuden itse: puuttuva salaisuus ei
   siten todista sen poistumista tässä lisävaiheessa. Kaikkien SMTP-slottien
   poiston erillinen F-näyttö säilyy eikä tätä eroa peitetä raportissa.
5. Ennen kytkentää täsmennetään nykyisiin smoke-omistajiin rajattu vaihe-
   ja tulossopimus, kielteiset admission-kontrollit sekä alkuperäisen virheen,
   prosessisulun ja siivouksen säilytys. Nykyiset määräajat ja W7.5:n
   toimitusraja säilyvät. Vanhan W6B.2:n versiosidottuja proof-tiloja ei
   käytetä uuden skenaarion oikotienä.

Vaihe-/sulkusopimuksen rajattu aihio on nykyisessä smoke-omistajassa;
[testiympäristön sopimus](e2e-test-environment.md#testitasot) nimeää sen
rajat. Konfiguraatio-, vaihe- ja sulkukontrollit, tyypitys sekä nykyisen
kahden prosessin ajurin kontrollit läpäisivät. Katselmuksen havaitsema
quit-rajan testiväite täydennettiin ja kielteinen kontrolli hylkää liian
aikaisen quitin. Rajattu jatkokatselmus sulki havainnon.

Kytkemätön pakettivalmistelija hyväksyy vain puhtaan synteettisen
palautusprofiilin yhden aktiivisen yrityksen. Se käyttää nykyisiä suoria
recovery-conflict-lukijoita ennen rekisterimuunnosta eikä hyväksy julkaisun
alkuperäisjournal-todisteita: muiden keskeneräisten operaatioiden käsittely
ei kuulu tähän pakettitapaukseen. Pysyvien esi-isien pitää säilyä samoina;
vain luetteloon sidotun poistokohteen sisäiset esi-isät saavat poistua.
Työn virhe pitää OS-varauksen työntekijän todettuun päättymiseen asti.
Kontrolloitu sulkuportti, saman prosessin komentajan jatko ja todellisten
tiedostojen vertailu eivät korvaa natiivin vaihetyöntekijän, prosessipuun,
porttien tai puhtaan paketin näyttöä. Kytkentä odottaa tätä todistetta.

Nykyisen Windows Job -omistajan natiivikontrollit todentavat nyt oikean
työtilavarauksen estävän uutta omistajaa ennen työntekijän jatkolupaa.
Hallittu vapautus, virhepoistuminen ja Job-määräaika sallivat uuden varauksen
todetun lopputilan jälkeen; vieras verrokkiprosessi säilyy. Koe ei väitä
normaalin vapautuksen ja exitin välisen ajan pysyvän varattuna. Fixture käyttää kahta nykyistä
varausmoduulin lähdettä itsenäisinä testikopioina, ei valmista desktop-buildia.
Tämä ei vielä todenna valmistelijan omaa virhehaaraa erillisessä työntekijässä
eikä paketoidun sovelluksen sulkua. Pakettikytkentä vaatii lisäksi oikean
pakettivaiheen tuloksen sidonnan supervisorin nonce-/scenario-/artifact-terminaliin.
Nykyinen smoke-tulos ei yksin kelpaa sen tilalle eikä caller saa keksiä
onnistunutta worker-terminalia puuttuvan vaihekuittauksen korvikkeeksi.
Nykyisen Node-worker-mallin mukainen nimetty vaihetyöntekijä saa tuottaa
oman terminalinsa vasta suoritettuaan nykyisen smoken tulos-, exit- ja
stdio-sulkutarkistukset. Supervisor vaatii senkin jälkeen koko Jobin
tyhjenemisen; workerin exit ei yksin sulje sovelluksen jälkeläisiä.
Ensivaiheen `restoreRestart/started` on etenemä ennen `activate`-kutsua,
ei valmis palautus tai yksin riittävä worker-kuittaus. Nykyinen toinen
restore-prosessi ja sen sisältövertailu säilyvät erillisinä ehtoina.

Jaettu smoke-vaihe ja kytkemätön Node-vaihetuloksen tuottaja ovat nyt
työpuussa. Ne eivät kopioi vaiheen tulos-/exit-/stdio-logiikkaa tai anna
uutta cleanup-valtuutta. Tuottajan käyttämät tekniset tulospaikat ovat
kertakäyttöisiä, ja pysyvien juurten identiteetit tarkistetaan myös saman
vaihehakemiston siirron jälkeen. Rajatussa vastakokeessa havaittu
emokansion vaihdon puute toistettiin ennen korjausta.
[Testiympäristön sopimus](e2e-test-environment.md#testitasot) erottaa tämän
kontrolloidun komponentin onnistuvan pakettivaiheen ja parent-ajurin
vielä avoimesta kytkennästä. Kiinteä CLI tarkistaa nyt todellisen työjuuren,
requestin kaikki sidotut kentät ja startup-alkutilan ennen yhteistä vaihetta;
requestin olemassaolo ei riitä. Nykyisen rajatun CLI-/Job-hylkäyskokeen
lukijavirhe, todellinen prosessin päättyminen ja Jobin tyhjeneminen sekä
virheraportin salaus/purku on todennettu. Tämä ei käynnistä sovellusta
eikä todista vielä onnistuvan pakettivaiheen tai valmistelijan kytkentää.
Parentin vastuulle jää serialisoidun vaiheen alkutilan tuore julkaisu,
pyynnön kirjoitus, terminalin ja puun lopputodiste sekä vasta niiden jälkeen
sallittu valmistelukutsu. Aikarajat ja puhtaan paketin hyväksyntä säilyvät.
Per-vaiheinen adapteri on nyt erikseen toteutettu nykyisen rajatun
prosessikutsun ja C#-Jobin päälle. Se vertaa paketin nykyisen inventaarion
kanonista tiivistettä, vaatii tuoreen vaihejuuren ja tarkistaa sekä
supervisorin että oman workerin terminalin ennen Job-todisteen palautusta.
Suoran prosessin epävarmuus ja supervisorin tulos säilyvät erillisinä;
niiden turvalliset syyt säilyvät nykyisissä salatuissa runner-tietueissa.
Oikea negatiivinen prosessikoe ei korvaa onnistuvaa pakettivaihetta.
Adapterin yksittäinen Job-todiste ei yksin anna profiilin tai valmistelijan
elinikävaltuutta; koko ajurin omistaja sitoo vaihejärjestyksen erikseen.

Porttihavainnon rajattu liitos käyttää nykyisen smoken oman
backend-käynnistyksen teknistä stdout-havaintoa, ei prosessiskannausta.
Vain smoke-valinnan main saa ilmoittaa oman validoidun porttinsa.
Vaihetyöntekijä vaatii oman lapsensa kokonaan suljetusta, rajatusta
tulosteesta täsmälleen yhden nykyvaiheen havainnon ennen nykyistä erillistä
loopback-vapautustarkistusta. Valitsinvaihe ei saa ilmoittaa backendia.
Havainto ei ole sovelluksen lopputulos tai Jobin tyhjenemistodiste;
vanha tulosformaatti ja molemmat restore-prosessit säilyvät. Työ mahtuu
nykyiseen kokonaisvaihebudjettiin eikä porttinumeroa julkaista tai lisätä
koordinaatiotiedostoon. Puuttuva, osittainen tai ristiriitainen havainto
estää onnistuneen worker-terminalin. Pienen oikean Job-/socket-fixturen
koe vahvisti eron myös vieraan kuuntelijan varatessa saman portin Jobin
tyhjenemisen jälkeen; se ei vielä todista sovelluksen omaa havaintokytkentää.

Parentin tuore porttitarkistus seuraa sidottua onnistunutta Job-tulosta ja
oman workerin kuittausta. Se validoi saman vaiheen suljetun stdout-havainnon
nykyisestä sisäisestä tulostesiirrosta ja käyttää nykyistä erillistä
loopback-tarkistinta. Tarkistimen viiden sekunnin oletus säilyy; tässä
kutsussa sitä lyhentää saman 120 sekunnin vaihebudjetin jäljellä oleva aika.
Porttitulos on erillinen, vain kyseisen hetken kuitti, ei pysyvä poisto-
tai siivousvaltuus. Puuttuva/osittainen havainto jättää porttitilan
varmentamatta, vaikka sovellus ja Job olisivat onnistuneet. Todellinen
porttivirhe säilyttää nämä onnistumiset erillään ensivirheen kanssa.
Peruutusta seurataan myös tämän odotuksen loppuun; sama kuitti ei avaa
koko ajuria tai valmistelijan elinikää ilman niiden erillistä kytkentää.
Rajatut parent-kontrollit, testipaketin tyypitys ja oikean porttivirheen
salaus/purku läpäisivät. Katselmuksen viimeisen asynkronisen juuritarkistuksen
määräaikapuute toistettiin ennen korjausta; viimeinen määräaikapäätös tehdään
nyt vasta tämän odotuksen jälkeen, alkuperäiset vartijat säilyttäen.

Nykyisen valmistelijan nimetyt natiiviregressiot todensivat epäonnistuneen
varauksen säilymisen työntekijän päättymiseen asti. Hallittu virhepoistuminen
ja Job-määräaika sallivat uuden omistajan varauksen vasta tyhjän Jobin jälkeen;
rekisteri ja riippumattomat säilytettävät tavut pysyivät ennallaan. Ensimmäinen
valmistelijan virhe säilyi nykyisessä runner-tietueessa. Pysyvät kontrollit
kuuluvat nykyiseen `smoke:proof:job-admission`-komentoon; vanhat sisäkkäisen
Jobin ja prosessivarauksen kontrollit läpäisivät myös. Kokeen aiemman
sovellusvaiheen poissaolo on kontrolloitu; se ei käynnistä EKYä tai tietokantaa
eikä korvaa koko ajurin elinikäliitosta tai puhtaan paketin hyväksyntää.
Fixturen varaus-, ensivirhe- ja loppusiivouspuutteet toistettiin ennen
korjausta. Nykyiset kontrollit säilyttävät odottamattoman alkuperäisen
poikkeuksen ennen koodimuunnosta sekä osittaisen siivousvirheen yli;
todellisen Job-virheen alkuperäinen ja välitetty projektio löytyivät myös
nykyisestä puretusta salatusta paketista. Tämä on rajatun testirajan näyttö.

Työpuun nimetty pakettikytkentä käyttää nykyistä C#-Jobia myös koko
ajuriprosessin omistajana. Neljä sovellusvaihetta käyttävät nykyistä
per-vaiheista Job-adapteria; vain niiden sidotut loppukuitit, suljettu
tuloste ja tuore porttitarkistus sallivat seuraavan valmistelu-/vertailukutsun.
Ajuriprosessi ei poista testijuurta. Ulompi omistaja lukee oman workerin
terminalin ja varmentaa koko puun sekä portit ennen onnistumissiivousta.
Virheessä valmistelijan varaus päättyy vain omistetun prosessin mukana.
Nykyinen 300 sekunnin pakettitestin kokonaisraja ja vaiheiden 120 sekuntia
säilyvät; yhteinen testibudjetti kattaa myös valmistelun eikä nollaudu.
Pienet kytkentä- ja keskeytyskontrollit edeltävät puhtaan paketin ajoa;
niiden läpäisy ei ole tämän uuden koko ketjun pakettihyväksyntä.
Ensimmäinen CI-kytkentä valitsi `package:windows`-kehityspaketin. Todellinen
pakettikoe osoitti tämän vääräksi lähtötilaksi poiston cold-jatkolle:
kehityspaketilla ei ole vaadittua release-identiteettiä. Seuraava rajattu
korjaussopimus korvaa vain tämän pakettivalinnan, ei cold-build-porttia.

###### Pakettitestin pilot-identiteetin korjaussopimus

**5.11.2026, rajattu kytkentä ja puhdas pilot-pakettisarja todennettu;
koko W7.4:n integraatio on vielä avoin.**
Nykyinen `package:windows:pilot` muodostaa puhtaasta revisiosta oikeat
package-mode-, build- ja release-tiedot sekä sisältöön sidotun manifestin.
W7.4:n pakettisarja käyttää tätä yhtä artifactia. Tavallisen
`package:windows`-komennon kehitystila ja profiilirajaus eivät muutu.
Testi ei ole release-candidate-, päivitys- tai jakeluhyväksyntä: versiota ei
nosteta, first-parent-porttia ei ohiteta eikä vanhaa accepted-metadataa
kirjoiteta testin valmistelussa. Julkaisun omat portit säilyvät erillisinä.

Poistotapauksen tyhjän synteettisen profiilin ensimmäinen normaali pilot-käynnistys saa
`initialInstall`-luvan. Nykyinen FirstStart tallentaa business-hyväksynnän
vasta oikean backendin, sisällön, session ja salaisuuden identiteetin
tarkistusten jälkeen. Nykyinen smoke vaatii tämän todellisen hyväksynnän.
Vasta backup/restore-vertailun, toisen prosessin ja kirjoittajien todetun
sulun jälkeen valmistelija saa tarkistaa saman buildin hyväksynnän ja
julkaista poistojournalin. Seuraava cold-käynnistys saa näin nykyisen
`exactAcceptedBuild`-luvan. `initialInstall` yksin ei edelleenkään riitä
poistojournalin jatkamiseen; tuotannon vartijoita ei muuteta.
Vanhojen neljän tapauksen legacy-tietokannat ja keskeytysjournalit säilyvät
nykyisinä syötteinä; niitä ei tyhjennetä pilot-lähtötilan saavuttamiseksi.
Niiden normaali hyväksyntäketju todennetaan erikseen samalla pilot-paketilla.

| Omistaja | Rajattu muutos ja säilyvä vastuu |
| --- | --- |
| `.github/workflows/ci.yml`, `apps/e2e/package.json`, nykyinen `e2e-command-wiring.test.mjs` | Pilot-sarjan yksi build käyttää `package:windows:pilot`-komentoa. Tavallinen smoke sekä kaikki viisi palautustapausta käyttävät samoja tavuja. Ei toista buildia tai ohitusta. Alkuperäinen yhden jobin rajaus on korvattu vain alla hyväksytyllä [CI-työnjaolla](#w74n-pr-integraation-rajattu-jatkosopimus); paikallinen pakettisarja ja sen aikarajat säilyvät. |
| `scripts/run-packaged-smoke.mjs`, `packagedSmokeJob.mjs` / `packagedSmokeJobWorker.mjs` | Yhteinen ennakkotarkistus sitoo todellisen ASARin package-mode/build/release-tiedot ja nykyisen pilot-manifestin koko sarjalle jäädytettyyn paketti-identiteettiin. Se tehdään ennen tavallista smokea ja ennen kunkin tapauksen valmistelijan `prepare`-kutsua, ei vain ennen poistotyötä. Parent/worker säilyttävät lisäksi nykyisen pyynnön sidonnan. Käytä hyväksyttyä ASAR-lukijaa ja nykyisiä parsereita; ei omaa parseria tai uuden protokollan release-tietoa. |
| `scripts/packagedWorkspaceDeletionPreparation.mjs` | Nykyisen varauksen ja leasen alla tarkistetaan nykyisillä readonly-slot- ja build-lukijoilla täsmällinen hyväksytty business-build. Pelkkä selector-hyväksyntä, puuttuva metadata tai sivuslotit eivät kelpaa. Sidottu hyväksyntä tarkistetaan tuoreesti ennen rekisterimuunnosta ja julkaisua; valmistelija ei kirjoita sitä. |
| Nykyiset ajuri-, valmistelija-, main- ja admission-testit | Todellinen metadata syntyy vain normaalissa sovellusketjussa. Pienet fixturet saavat valmistaa synteettisen metadatan omiin kontrollitesteihinsä, mutta eivät korvata pakettikokeen todellista FirstStart-näyttöä. |
| Testiympäristö, testimatriisi ja M1 | Kirjaa nimenomainen vaihto kehityspaketista pilot-pakettiin. Vanhojen neljän skenaarion sisältö- ja sulkuväittämät säilyvät; niiden uusi pilot-lähtötila on todennettava, ei pääteltävä vanhasta kehityspaketin läpäisystä. |

**Sarjan pakettisidonnan omistajat:** nykyinen smoke-ajuri saa nimenomaisen
sarjanaloitusvalinnan. CI:n nykyisessä smoke-vaiheessa se validoi pilot-manifestin,
ASARin ja koko inventaarion ennen käynnistystä ja jäädyttää manifestin todellisten
tavujen SHA-256:n. Manifesti sitoo jo version, revision ja inventaarion.
Vain onnistuneen smoken jälkeen sama tiiviste viedään `GITHUB_ENV`-kanavaan
nimellä `EKY_PACKAGED_SERIES_MANIFEST_SHA256`. Oletuskomento ei ala muodostaa
sarjatilaa. Uutta kuittitiedostoa tai formaattia ei tarvita.

Vain `playwright.packaged-legacy.config.ts` saa rajatut setup-/teardown-koukut.
CI-setup vaatii edellisen vaiheen tiivisteen; puuttuva tai virheellinen arvo
ei vaihda sitä paikalliseen kaappaukseen. Paikallisessa sarjassa setup hylkää
perityn sarjatiivisteen, kaappaa oman kerran ja ajaa tavallisen smoken tällä
sidonnalla ennen viittä tapausta. Setup välittää alkuperäisen tiivisteen
workereille ja säilyttää sen loppuvarmennusta varten. Jokainen kuluttaja
lukee nykyiset tavut uudelleen vertailuksi, ei uudeksi odotusarvoksi.
Poistospecin requestin inventaario-identiteetti johdetaan sidotusta
validoidusta manifestista, ei juuri havaitun inventaarion hyväksymisestä.
Nämä sidonnat ovat vain testisarjan evidenssiä, eivät yrityksen avaamis- tai
poistovaltuutta. Kiinteät pakettipolut ja synteettiset profiilirajat säilyvät.

Sarjan loppuvarmennuksen omistaa saman configin teardown: se vertaa
manifestia, ASARia ja koko inventaariota setupin alkuperäiseen sidontaan
kaikkien tapausten jälkeen. Virhe hylkää komennon ja säilyy erillään
mahdollisesta aiemmasta testivirheestä. Puuttuva loppuvarmennus tai keskeytys
ei ole sarjan hyväksyntä. Nykyiset komento-/config-kytkentätestit vaativat
molemmat koukut sekä paikallisen smoken; valmistelua tai loppuvarmennusta
ei saa ohittaa. Käynnistykset ja uudet tarkistukset kuluttavat nykyisiä
aikabudjetteja; setup ei anna uutta aikaa yksittäiselle palautustapaukselle.

Paketti-identiteetin luku käyttää kiinteää nykyistä output-juurta, ei
rendereriltä, journalista tai vapaasta ympäristöpolusta saatua sijaintia.
Parent/worker käyttävät samaa nykyiseen testiajuriin rajattua tarkistusta;
ei uutta manageria. Uudet tarkistukset kuluttavat nykyistä kokonaisbudjettia.
Saman artifactin inventaario varmennetaan myös onnistuneen kokonaisajon
jälkeen ennen hyväksyntää. Puuttuva/virheellinen smoke-valinta ei saa
käynnistää pilot-pakettia tavalliseen käyttäjäprofiiliin.

**Pienet ennakkoportit:** kehityspaketti; puuttuva tai ristiriitainen
release/build/manifest; väärä artifact-identiteetti; dirty build;
paketin tai manifestin vaihto tavallisen smoken ja myöhempien tapausten
välillä; ennakkotarkistuksen hylkäys ennen jokaisen valmistelijan kutsua;
puuttuva CI-sidonta, paikalliseen ajoon peritty sidonta, kuluttajan yritys
korvata odotusarvo nykyhavainnolla sekä puuttuva/epäonnistunut loppuvarmennus;
puuttuva, väärän revision tai vain sovelluksen hyväksyvä metadata;
sivuslotit; hyväksynnän muutos rekisterimuunnoksen tai julkaisun aikana;
peruutus, sulku ja alkuperäinen virhe nykyisestä salatusta paketista.
Hylkäys ennen journalin julkaisua ja säilyvät tiedostot todistetaan erikseen.
Positiivinen kontrolli käyttää nykyistä FirstStart- ja smoke-hyväksyntää;
tyypitys ja riippumaton rajattu katselmus edeltävät puhtaan paketin ajoa.

**Kokonaisportti:** säilytä ensimmäinen epäonnistunut paketti ja aineisto.
Jäädytä korjattu lähde, rakenna yksi uusi puhdas pilot-paketti ja varmista
sen identiteetti. Aja tavallinen smoke ja kaikki viisi nykyistä pakettitapausta
samalla artifactilla. Poiston neljä vaihetta, ulkoisten backup-/PDF-tavujen
säilyminen, puun ja porttien poissaolo sekä loppusiivous vaaditaan.
120 sekunnin vaihe-, 300 sekunnin workflow- ja 35 minuutin CI-raja säilyvät.
Uusi vika säilytetään ja käsitellään; uusi pakettityyppi ei ole uusintasilmukka.
Stress/soak, installer sekä PR/main-portit ja W7.5:n sulku säilyvät.

Rajattu kytkentä ja pysyvät kontrollit ovat työpuussa. Yhtenäinen 212 testin
kohdesarja, 25 oikean Windows-prosessiketjun kontrollia ja 80 ajokytkentäkontrollia
läpäisivät; päällekkäisiä sarjoja ei summata. Mukana ovat hyväksynnän muutos
viimeisen julkaisukuittauksen jälkeen, lähdeparsereilla luettu oikea ASAR,
desktopin käännöshakemiston käytön kieltävä setup-koe ja alkuperäisen virheen
todellinen OpenPGP-purku. E2E-tyypitys ja rajatut riippumattomat katselmukset
läpäisivät. Katselmuksen kaksi puutetta korjattiin: kontrollit eivät vaadi
esikäännettyä desktopia, ja build-valinta kuuluu myös julkaisun jatkuvaan
alkuperäisvalinnan vartijaan. Kontrolloidut natiivifixturet eivät väitä
pilot-hyväksyntää. Puhtaan `a45244ed`-revision yksi pilot-paketti läpäisi
myös tavallisen hardened-smoken ja kaikki viisi pakettitapausta, mukaan lukien
sisäisen poiston ja kaksi tyhjään valitsimeen päättyvää käynnistystä.
Sarjan loppuvarmennus ja erillinen jälkivertailu todistivat samojen paketti-
ja lähdetavujen säilymisen. Rebuildiä tai uusintaa ei tehty. Soak ja
nykyiset integraation PR/main-portit eivät sulkeudu tällä pakettinäytöllä.

###### W7.4:n PR-integraation rajattu jatkosopimus

**Loppuhyväksyntä 6.11.2026:** täsmällinen PR-head `ee8765fb9ca751924c6775c30cb425420c77a2a7`
ja uuden mainin `3da3f6a29fda299221b01b067848fa634f1d882d` omat V2- ja
riippuvuusportit läpäisivät ilman uusintaa. Kummankin V2:n kaikki 40
pakollista työtä ja vaaditut vaiheet varmennettiin. Myös todellinen
Linux-tarkistus suojauksineen ja siivouksineen sekä Windowsin development-,
paketti-, legacy- ja fault-polut läpäisivät. Kaksi peräkkäistä Linuxin
core-työtä säilyttää omat 15 minuutin rajansa ja kaikki tarkistukset.
[M1](release-0.3.0-m1-preparation-plan.md#jatka-tästä) omistaa nykytilan ja
[integraatiohistoria](release-0.3.0-integration-history.md#w74n-prmain-loppuhyväksyntä-6112026)
tarkan näytön sekä vanhat ensihylkäykset. Aiemmat epävarmat siivoustilat
eivät muutu läpäisyiksi. W7.5:n kanavat pysyvät suljettuina.

**Edeltävä Linuxin kohdetodennus, ennen hyväksyttyä revisiota.** Kopio-omistajan kolmen kohdetiedoston
ajo pysähtyi runnerin valmistelussa puuttuvaan alustakohtaiseen riippuvuuteen
ennen testien keräystä. Tämä ei ole testihylkäys tai korjauksen hyväksyntä.
Lähde säilyi muuttumattomana. Myöhempi CI läpäisi pakettitestit, mutta
kokonaiskatkaisu esti varsinaisen Linux-tarkistusprosessin kokeen.
Nykyinen puhtaan revision Linux-CI-portti vaaditaan edelleen.
Seuraava tasapainotettu jako läpäisi testit ja buildit, mutta Linux-hostin
pakollisen kohdeargumentin puuttuminen esti varsinaisen kokeen.
Fixture käyttää nyt omaan staging-snapshotiinsa eksplisiittistä `unbound`-
kohdetta. Tämä ei muuta tuotannon kohde- tai poistovartijoita eikä vielä
todista varmentamattoman prosessipuun sulkeutumista.
Hyväksytyn kahden peräkkäisen 15 minuutin työn sisäinen kuorma jaetaan
desktopin testeihin ensimmäisessä sekä muiden pakettien testeihin ja
nykyisiin jatkotarkistuksiin toisessa. Yhteisvara pysyy 30 minuutissa.
Ensimmäinen kaikkien testien yhteinen työ katkaistiin backendin sarjassa;
sen ensiaineisto säilyy eikä keskeneräistä sarjaa hyväksytä.
Se ei muuta poistokoodia, testivalikoimaa tai tarkistusprosessin turvarajoja.
Tarkka CI-sopimus on [testausohjeessa](../ai/testing-rules.md#core-cin-pakettisarjojen-ajo).
Valmisteluestettä ei ratkaista rinnakkaisella testirunnerilla.

**Mainin kahden ensimmäisen aikakatkaisun mittaus.**
`desktopRestoreStartup.test.ts`:n `registryReturnBackup`-paluu ja onnistuneen
rollbackin `replacement: true` -tapaus sisältävät valmistelun, oikeat
tiedostotallentimet, main-ketjun, loppuväittämät ja sulun saman viiden
sekunnin sisällä. Säilynyt aineisto osoittaa työn päättyneen myöhemmin,
ei alkuperäisten testien hyväksyttyä valmistumista. Seuraavien tapausten
`PREVIOUS_WORK_UNSETTLED` on nykyinen ja säilyvä suoja, ei erillisten vikojen
määrä. Yhtä muuttumatonta koko sarjan uusintaa ei tehdä.

Käytä nykyistä `desktopRestoreStartupTestSupport.ts`-elinkaarta ja nimettyjä
testikoukkuja erottamaan valmistelu, journalin valinta/paluu, terminal-
valmistelu, rollback/relaunch, loppuväittämät ja sulku. Mittaa vain nämä
kaksi tapausta nykyisessä rajassa; tallenna myös kesken oleva vaihe ja
aloitetun työn lopullinen päättyminen. Mittaus ei aloita lisäluentoja,
ohita vartijoita, muuta luvan elinikää tai resetoi mokkeja vanhan työn alta.
Todista mittarin onnistuminen, virhe ja keskeytys pienillä kontrolleilla.
Yksityiset kestot ja kutsumäärät pysyvät paikallisina.
Valitsimen konfliktikartoituksen ja rollbackin sisältötarkistuksen
kertautuminen on lähteestä nähtävä mahdollisuus, ei mitattu juurisyy.
Vasta yksilöity havainto perustelee fixture- tai sovelluskorjauksen;
tämä suunnitelma ei hyväksy tarkistusten poistoa tai aikarajan nostoa.

Rajattu mittaus on tehty nykyisellä testiapurilla. Lopulliset seitsemän
mittarikontrollia läpäisivät. Valitsinpaluu valmistui loppuväittämineen ja
sulkuineen; sen mittauksen mahdollista muuta testikuormaa ei suljeta pois.
Rollback oli nykyisen määräajan täyttyessä yhä käynnissä. Havainto erotti
toistuvat rekisteri-/journal-luennat alkuperäissisällön tarkistuksesta;
se ei nimeä turvallisesti poistettavaa vartijaa tai osoita umpikujaa.
Rollbackin loppuväittämiä tai myöhäistä työn ja resurssisiivouksen
päättymistä ei havaittu ennen testityöntekijän poistumista. Aineisto
säilyy eikä uusi luenta tai poisto saa käyttää tätä siivousvaltuutena.
Tyhjä testivalinta ja mittarin valmistelukorjaukset on erotettu varsinaisista
nimetyistä kokeista; niitä ei lasketa läpäisseiksi sovellustesteiksi.
Tuotantokoodia, testien elinkaariapuria tai aikarajoja ei muutettu.

**Mainin rajattu jatkokatselmus ja toteutusjärjestys.**
Lähdekatselmus vahvisti erillisen testiapurin havaintoaukon:
`desktopRestoreStartupTestSupport.ts`:n `onTestFinished` raportoi
keskeneräisen työn mutta palautuu odottamatta sen alkuperäistä lupausta.
Nykyinen `releaseWhenSettled` ja `PREVIOUS_WORK_UNSETTLED` estävät resurssien
vapautuksen ja seuraavan testin resetin kesken työn; niitä ei poisteta.
Tämä ei todista rollbackin umpikujaa tai kaikkien uusintalukujen turhuutta.

Seuraava korjauspala rajataan nykyiseen testiapuriin ja sen regressioihin:

1. Seuraa aktiivisen `prepare`- tai `run`-kutsun todellista päättymistä,
   myös sen odotettua loppusiivousta. Valmistelun valmistuminen ei kuittaa
   myöhemmin alkanutta testirunkoa. Käynnistymätöntä työtä ei jäädä odottamaan.
2. Lukitse epäonnistuneen yrityksen aineiston säilytys ja raportoi kesken
   oleva vaihe ennen yhtä `onTestFinished`-vaiheen loppuodotusta. Käytä
   runnerin nykyistä koukkurajaa, älä lisää uutta ajastinta tai odotusta
   `afterEach`-vaiheeseen. Testin onnistumisikkuna ei pitene: myöhäinen
   onnistuminen ei muuta alkuperäistä aikakatkaisua läpäisyksi.
3. Päättymiskuittaus ei heitä alkuperäisen työn virhettä uudelleen tai
   korvaa sitä sulkuvirheellä. Vanhat resurssit vapautetaan vain nykyisen
   päättymisvartijan kautta, enintään kerran. Hookin aikakatkaisu ei
   peruuta todellista työtä, vapauta omistajuutta tai anna poistovaltuutta.
4. Todista onnistuminen, alkuperäinen hylkäys, pidetty valmistelu/run,
   myöhäinen palautus/hylkäys, pidetty sulku, erillinen siivousvirhe ja
   koukun määräajan täyttyminen. Yksi pieni oikean Vitest-aikakatkaisun
   kontrolli erottaa runnerin hylkäyksen, todellisen työn päättymisen ja
   prosessin sulun. Pelkkä käsin kutsuttu loppukoukku ei korvaa sitä.

Runnerin aikakatkaisu säilyy ensimmäisenä hylkäyksenä. Sen jälkeen syntyvän
alkuperäisen työvirheen talteenotto on erillinen näyttö: pelkkä saman
rejectionin palauttaminen jo aikakatkaisseelle kutsujalle ei todista sitä.
Nykyinen havaitsija-/sinkkiketju varmennetaan ennen mahdollista talteenoton
väitettä; uutta raakalokia tai keräyssisältöä ei lisätä tällä sopimuksella.

Testiapurin rajattu korjaus on työpuussa. Kaksi uutta regressiota osoitti
puuttuvan loppuodotuksen vanhalla apurilla; korjattu 17 testin kohdesarja
ja desktopin tyypitys läpäisivät. Riippumaton kahden tiedoston katselmus
ei löytänyt uutta puutetta. Pieni oikean Vitest-runnerin kontrolli erotti
normaalin onnistumisen, kolme myöhäisen työn aikakatkaisua sekä loppukoukun
aikakatkaisun ja sitä seuraavan estetyn resetin. Neljä tarkoituksellista
hylkäystä säilyivät hylkäyksinä; aloitettu työ ja sulku päättyivät ennen
resurssien vapautusta. Tulokset varmennettiin säilyneistä tavuista ilman
uutta ajoa sen jälkeen, kun tarkistimen väärä oletus JSON-raportin
virheviestikentästä oli rajattu. Yksi nimetty oikean main-ketjun rollback
läpäisi nykyisessä testirajassa. Sen jälkeen koko kahden tiedoston
Main-vaikutussarja läpäisi kaikki 403 testiä ilman ohituksia, mukaan lukien
aiemmin aikakatkaisseet valitsinpaluu ja rollback. Näitä päällekkäisiä
sarjoja ei summata. Tulokset eivät sulje vanhojen aikakatkaisujen syitä tai todista
myöhäisen alkuperäisvirheen salattua toimitusta. Palautuskoodia ei muutettu.

Myöhempi normaali työtilasarja ja yksi erillinen sarjallinen vertailu
osoittivat lisäksi seuraamattomien Main-testiryhmien siivousaukon:
aikakatkaisseen rungon työ saattoi jatkua yhteisen tiedostopoiston ja
mokkien palautuksen aikana. Neljä nykyistä ryhmää, yhteensä 18 cold-/
rollback-varianttia, on kytketty samaan nykyiseen elinkaariapuriin.
Koko runko valmisteluineen ja nykyisine `finally`-odotuksineen kuuluu
seurantaan; jokaisen fixturen juuret kuuluvat samalle testille.
Kaikki alkuperäiset väittämät, tapausnimet ja aikarajat säilyvät.
Kohdesarjan 35 testiä, tyypitys, rajattu riippumaton katselmus ja sen
jälkeinen koko 403 testin Main-sarja läpäisivät ilman ohituksia.
Tämä ei sulje ensiaikakatkaisujen syitä tai todenna kaikkien muiden
seuraamattomien testien sulkua. Seuraava normaali desktop-komento läpäisi
kaikki kolme vaihettaan, myös erillisen 23 kohteen ketjun nykyisessä rajassa.
Muiden työtilapakettien normaali sarja läpäisi backendin kahden vanhan
testifixturen rajattujen korjausten jälkeen. Kyse on erillisistä näytöistä,
ei aiemman koko komennon hylkäyksen muuttamisesta onnistumiseksi.
Uuden puhtaan revision paketti-/integraatioportit vaaditaan edelleen;
tarkka ensihylkäys ja erilliset sarjat säilyvät integraatiohistoriassa.

**Palautuksen tarkistusvastuu jää erilliseksi koepäätökseksi.**
`ProfileRestoreActivationTransaction.coldRollbackJournalAuthority` käyttää
jo erillisiä luku-, sisältö- ja muutosvartijoita. Rajattu vertailuehdotus
koskee vain sen `assertCurrent`-callbackia, kun nykyinen luentavartijan ja
synkronisen muutosvartijan pari on mukana: journalin ja lähdesijaintien
luenta nykyisellä omistajuusvartijalla, sen jälkeen yksi täysi ulkoinen
valintatarkistus. Yhteistä tallenninta, korjaavaa `read`-polkua, varsinaisia
sisältösiirtoja, sisältövaltuutta tai muiden kutsumuotojen tarkistuksia ei
muuteta. Viimeinen täysi tarkistus, slottien uudelleensidonta ja synkroninen
valtuus säilyvät ennen varsinaisia muutoksia.

Tämä ei ole muuttumaton turvasopimus: vain pois jäävän johtavan tarkistuksen
aikana näkyvä ja ennen loppuvertailua täysin palautuva ulkoinen valintatieto
voisi jäädä havaitsematta, myös muutosvartijan sisäisessä callbackissa.
Kilpailevien virheiden havaintojärjestys voi muuttua. Pysyvän muutoksen on
estettävä seuraava mutaatio; luentatulos ei anna itsenäistä kirjoituslupaa.
Ehdotusta ei ole hyväksytty kokeeseen tai tuotantoon. Ensin vaaditaan
rajauksen katselmus ja omistajan päätös, sitten pienet lähtö-/ehdokasvertailut
sekä todellisten poisto-, rename-, write- ja sync-rajojen kontrollit.
Kutsumäärän väheneminen ei yksin todista koko palautuksen valmistumista.
Nykyiset aika-, sisältö-, omistajuus- ja integraatiorajat säilyvät.

**OpenPGP-kontrollin tunniste.**
`workspaceDeletionFailureEvidenceOpenPgp.test.mjs`:n julkaisuvaiheen
alkuperäinen virhe, syy ja kutsupino sekä salattujen/purettujen tavujen
vertailu läpäisivät ennen `test.id`-päätteen hylkäystä. Nykyinen
`runnerFailureEvidence.mjs` suodattaa myös tunnisteen tunnetut salaisuudet;
suodattimen mahdollinen vaikutus on hypoteesi, ei ensimmäisen ajon todettu
syy. Säilynyt ulompi virhe ei sisällä hylättyä sisäistä tunnistetta.

Säilytä pääteväittämä ja nykyinen suodatus. Täydennä ensin saman vaiheen
yksikäsitteisen tietueen kontrolli sekä rajattu virheviesti: osumien määrä,
tunnisteen pituus, kokorajan täyttyminen ja suodatusmerkin esiintyminen.
Ei raakaa tunnistetta, ympäristöarvoja tai uutta keräysformaattia.
Todista nykyisellä sinkillä ja vain synteettisellä salaisuudella, voiko
suodatus tuottaa vastaavan eron, sekä että muuttunut tai monistunut tietue
hylätään. Virheen on löydyttävä nykyisestä puretusta salatusta paketista.
Paikallinen onnistuminen tai uusi havaintoviesti ei sulje alkuperäistä
syytä eikä nollaa käytettyä uusintaa. Hyväksymisväittämää ei löysennetä
arvatun suodatussyyn perusteella.

Rajattu testikytkentä on työpuussa. Pienet kontrollit todistavat muuttuneen,
puuttuvan ja monistetun tunnisteen hylkäyksen sekä neljän havaintokentän
täsmälliset arvot. Synteettinen tunnettu salaisuus osoitti suodattimen
voivan muuttaa tunnistepäätettä; tämä ei nimeä aiemman CI-hylkäyksen syytä.
Oikea epäonnistuva Node-testi, nykyinen raportointi, salaus ja purku
säilyttivät ulomman testivirheen sekä alkuperäisen assertion-syyketjun.
Kaikkien raporttitavujen, tiivisteiden ja ajo-/yrityssidonnan vertailu
läpäisi. Täysi nykyinen OpenPGP-kohdesarja ja deltakatselmus ovat erillisiä
portteja; alkuperäistä hylkäystä ei ole suljettu.

Muuttuneen koko kohdetiedoston seuraava normaali ajo hylättiin eri esteeseen:
vanhan `rejected absence read keeps its original chain through actual projection and delivery`
-tapauksen sisäinen yhdistelmä ylitti nykyisen viiden sekunnin rajan.
Molemmat uudet tunnistekontrollit läpäisivät. Kokonaiskokeen alkuperäisten
tavujen OpenPGP-vertailua ei saavutettu; pienen uuden kontrollin purku ei
korvaa sitä. Sisäinen tapaus yhdistää useiden nykyisten omistajien aidot
valmistelu- ja virherajapolut. Tarkka viivekohta ja keskeneräisen työn sulku
ovat avoimia; muuttumatonta uusintaa tai aikarajan nostoa ei tehdä.
Tämä ei muuta aiempaa CI:n tunniste-eroa korjatuksi.

Jatka tämän erillisen fixturen rajauksesta: säilytä jokaisen nykyisen
virherajan alkuperäisen poikkeuksen identiteetti, säilyvien tavujen väittämät
ja todellinen projektori-/toimitusketju. Mahdollinen vaihehavainto käyttää
nykyistä testiapuria, ei uutta loggeria. Ennen uutta koko koetta pienen
kontrollin pitää todistaa, että aloitetut kutsut ja niiden sulut päättyvät
ennen jaettujen mokkien palauttamista. Useaksi testiksi jakaminen ei ole
automaattisesti hyväksytty korjaus: se muuttaisi yhteistä aikavaraa ja
raportin tietuemäärää. Valmistelua, väittämiä tai salaus-/purkuvertailua ei
siirretä näkymättömästi nykyisten rajojen ulkopuolelle. Palautuksen
suorituskykyehdotus ei korjaa tätä erillistä yhdistelmätestiä.

**Sisäisen salauskontrollin vaihemittaus.**
Nykyisen mittausapurin neljä pientä kontrollia läpäisi: alkuperäisen virheen
identiteetti, onnistuminen, pidetty työ ja havaitsijan oma virhe erotettiin.
Mittarin valmisteluvaiheen päättämisen ja kontrollin järjestysväittämän
ensiehdokkaat hylättiin ja säilytettiin erillään lopullisesta näytöstä.
Yksi nimetty muistissa instrumentoidun nykyisen yhdistelmätestin mittaus
valmistui viiden sekunnin rajassa. Kaikki 18 nimettyä vaihetta, alkuperäiset
väittämät ja kutsurekisteröinnit säilyivät; testirungon loppu havaittiin.
Suurin vaihe oli metadatan jälkiluvun virhefixture, ei lopullinen projektio
ja toimitus. Lähteet ja ensihylkäyksen aineisto säilyivät muuttumattomina.
Mittauksen testivalinnan tarkistimen väärä `pending`/`skipped`-oletus
korjattiin saman säilyneen raportin erillisessä varmennuksessa, ei uusinnalla.
Muita viittä sisäistä tapausta tai koko salaus-/purkuvertailua ei ajettu;
mittaus ei hyväksy niitä tai sulje ensimmäistä aikakatkaisua.

**Omistaja hyväksyi jaon 5.11.2026:** vain nykyinen sisäinen yhdistelmä jaetaan
kolmeen itsenäiseen vastuutestiin: virheiden välitys ja valmistelu,
metadatan jälkiluku sekä terminal-/inventaarion loppusiivous. Jokainen
nykyinen virheraja, alkuperäisen poikkeuksen identiteetti, säilyvien tavujen
ja sulun väittämät sekä todellinen projektori ja salattu toimitus säilyvät.
Jokainen ryhmä saa oman virheolionsa ja yksikäsitteisen testisidontansa;
eri testien välillä ei pidetä jaettua muuttuvaa fixtureä tai salaisuustilaa.
Yksittäiset rajat pysyvät viidessä sekunnissa, mutta tämän osan sallittu
yhteisvara kasvaa viidestä 15 sekuntiin. Sisäisen prosessin 90 sekunnin,
loppukoukun kahden sekunnin ja koko salauskokeen 240 sekunnin rajat säilyvät.
Jako on toteutettu työpuuhun. Kolme lähdekontrollia osoitti kaikkien vanhojen
väittämien ja virherajakutsujen sekä viiden muun tapauksen säilyneen.
Oikean runnerin kontrolli todensi fixturen oman pidetyn työn ja todellisen
tiedostosulun päättymisen ennen mokkien palauttamista onnistumisessa,
alkuperäisessä hylkäyksessä ja testin aikakatkaisussa. Kaksi tarkoituksellista
hylkäystä säilyi hylkäyksinä; tämä ei todista muiden fixturejen tuntematonta
keskeneräistä työtä päättyneeksi. Rajattu riippumaton deltakatselmus ei
löytänyt puutetta. Koko nykyisen kolmen testin OpenPGP-kohdesarja läpäisi:
kaikkien 35 tiedoston alkuperäiset tavut, tiivisteet ja ajosidonnat sekä
jokaisen kolmen ryhmän oma alkuperäinen virhe ja kaksi liittyvää syytä
varmennettiin puretusta paketista. Pelkkää ensimmäisen tietueen `find`-osumaa
ei käytetä ryhmien hyväksyntään. Vanhat hylkäykset säilyvät avoimina.
Sovellus- tai turvakoodia ei muuteta tämän testijaon vuoksi.

**Hyväksytty Electron-CI:n työnjako.**
Omistaja hyväksyi kaksi pakollista työtä yhden yhdistelmätyön sijaan.
Kummankin raja on 35 minuuttia. Yhteenlaskettu enimmäisajovara kasvaa
35:stä 70 koneminuuttiin ja valmistelu tehdään kahdessa erillisessä työssä;
tätä ei kuvata muuttumattomaksi kokonaisbudjetiksi. Yksittäisten testien,
Playwright-sarjojen, sovelluksen ja siivouksen rajat eivät muutu.

| Nykyinen omistaja | Toteutettava työnjako ja hyväksyntä |
| --- | --- |
| `.github/workflows/ci.yml` | `e2e-electron-windows-critical` ja sen nimi säilyvät. Se ajaa nykyisen valmistelun ja kaikki 72 development-tapausta. Uusi `e2e-packaged-windows-smoke`, nimeltään `Windows packaged smoke and recovery`, ajaa nykyisen yhden pilot-buildin, tavallisen smoken, pakettisarjan valmistelun, supervisor-buildin ja kaikki viisi pakettitapausta tässä järjestyksessä. Molemmat käyttävät samaa checkout-revisiota ja omia nykyisiä valmisteluvälineitä. |
| `.github/scripts/ciJobCoverage.mjs` ja `ciRunAcceptance.test.mjs` | `electronCritical` vaatii development-työn, `packageSmoke` uuden työn ja kaikki viisi pakollista vaihetta. Molemmat ovat koonnin ehtoja samalla run/attemptilla. Puuttuva, epäonnistunut, peruttu tai ohitettu työ/vaihe hylätään. Riskiluokitus, toistot, `V2 acceptance` ja `Audit dependencies` säilyvät. |
| Nykyinen `e2e-command-wiring.test.mjs` | Todista tarkat työrajat, valmistelu ja järjestys; seuraavan työn teksti ei saa kelvata edellisen kattavuudeksi. Todista samat 72 + 5 testitunnisteet ennen/jälkeen, ei vain lukumääriä. Ei uusia grep-, skip-, worker- tai retry-muutoksia. Erillinen `electron_diagnostic` valitsee molemmat työt mutta ei korvaa V2-koontia. |
| Nykyinen salattu keräys ja `ciFailureEvidenceWiring.test.mjs` | Development säilyttää `core-electron-0`-sidonnan ja nykyisen lifecycle-toimituksen. Pakettityö saa erillisen `core-packaged-0`-avaimen ja saman ehdollisen salatun keruun; todista lähde-/ajo-/yrityssidonta, keruuehdot ja kielteiset rajat. Natiivikäännöksen raakalokipoikkeus ei laajene uuteen työhön. Upload ei todista prosessien sulkua. |
| Testausohje, E2E-strategia, ympäristö ja hyväksyntäkartta | Päivitä toteutunut työnjako samalla muutoksella. Skenaariot, testitasot, saman paketin pin/teardown, ensivirheet ja epävarman siivouksen säilytys pysyvät. Ei uutta testaussovellusta, prosessiomistajaa tai riippuvuutta. |

Tavallinen smoke ja viisi pakettitapausta pysyvät samassa uudessa työssä:
sen alkuperäinen `EKY_PACKAGED_SERIES_MANIFEST_SHA256` ja loppuvarmennus
eivät ylitä job-rajaa. Sarjan käynnistys ei käytä uudelleen paketoivaa
komentoa. Koontitesteissä myös supervisor-build on pakollinen vaihe.
Paikallinen discovery vertasi alkuperäisen CI-paketin raportteihin samat
72 development- ja viisi packaged-tunnistetta, tiedostot, sijainnit,
otsikot ja projektit. Tunnistejoukot vastasivat täsmälleen toisiaan.
Tämä ei käynnistänyt sovellusta eikä ole CI- tai siivoushyväksyntä.
Työnjako poistaa havaitun pakettityön kehitystestien edeltä, mutta ei takaa
kaikkien 72 tapauksen, valmistelun ja virhekeruun mahtumista nykyiseen
rajaan. Se todistetaan uuden revision kokonaisajolla, ei laskennallisella
arviolla. Jako ei korjaa katkaistun ensimmäisen testin puuttuvaa sulkutodistetta.

Ennen normaalia uutta PR-kierrosta vaaditaan nykyisten korjausten
kohde-/vaikutustestit, tyypitys, keruuketjun todennus, rajattu riippumaton
deltakatselmus ja lähdejäädytys. Kopio-omistajan muuttunut runtime vaatii
nykyisen Linux-portin sekä uuden puhtaan paketin näytön. Aiemman pilot-
paketin tai soak-revision näyttöä ei nimetä uudelle lähteelle. Vanhat
hylkäykset säilyvät ja uuden revision kaikki PR/main-portit vaaditaan.

###### Aiemmat F-vaiheen kytkentä- ja roolikokeet

Alla olevat kytkentä- ja koehavainnot koskevat niiden alkuperäistä lähdettä.
Nykytila on M1:ssä; historiallinen avoin vaihe ei ole uusi toteutusjono.

Indexin ja mainin rajattu kytkentä on nyt työpuussa: sama smoke-/token-portti
ja täsmällinen testiprofiili, vakaa tyhjä rekisteri ennen yritysratkaisua,
business-sessionin kielto sekä ladatun valitsimen tuore valinta ja omistajuus
ennen hallittua sulkua. Tavallisen valitsimen asynkroninen lataus säilyy.
Katselmuksen osoittama lataus- ja siivousvirheen yhteisen syyketjun puute
toistettiin ja korjattiin nykyisessä selector-compositionissa; alkuperäinen
virhe on `cause` ja myöhemmät virheet erillisessä virheluettelossa.
Uudet ja tavallisen valitsimen main-kontrollit, nykyisen projektorin ensisyy,
omistajien regressiot ja tyypitys läpäisivät. Rajattu jatkokatselmus sulki
löydön.

Nykyisen pakettiajurin ohjelmallinen liitos ajaa nyt onnistuneiden kahden
restore-prosessin jälkeen nimetyn poistovalmistelun ja kaksi valitsimen
varmennusprosessia. Tulos nollataan ennen kumpaakin, ja molempien jälkeinen
nimetty vertailu odotetaan ennen onnistumista tai juuren siivousta. Puuttuvat
koukut, ristiriitaiset valmistelut, vanha `ok`, virhe ja nykyisen määräajan
täyttyminen estävät etenemisen. Vanhat kaksi prosessia, niiden 120 sekunnin
lapsikohtainen raja sekä tavallinen komentorivi säilyvät. Ajurikontrollit
läpäisivät; rajattu lähde-/testiväitekatselmus ei löytänyt puutetta.
Varsinainen OS-varauksen ja kohdejournalin valmistelusovitin, prosessipuun ja
porttien päättymistodiste sekä säilyvien tavujen vertailu eivät vielä kuulu
tähän ajurin ohjattuun näyttöön. Puhdas paketti ja normaali desktop-sarja
ovat edelleen erillisiä avoimia portteja.

**F:n avoin rooliketju:** sama inventaariovalmistelu syöttää nyt sekä
nykyistä luettelotestiä että yhteisen komennon yhdistelmätestiä. Mukana ovat
kaikki kymmenen roolia ja vanhan layoutin kaikki 13 sallittua jäsentä,
yhteensä 23 riviä. Ensimmäinen kokonaiskoe aikakatkaisi; sen tiedostot ja
alkuperäinen hylkäys säilyvät. Testiä ei ole hyväksytty valmistuneeksi.
Rajattu mittaus ja lähdekatselmus vahvistivat valintalukujen kertautumisen,
mutta eivät yksin osoita koko aikakatkaisun juurisyytä tai korjausta.

`captureWorkspaceDeletionPayloadBinding` ja sidontatallennin vartioivat
molemmat sisäisiä lukuvaiheitaan nykyisellä täydellä valinnalla.
Omistaja hyväksyi 1.11.2026 D:n rajatun suunnittelun ja synteettiset kokeet
lukuvaiheen kevyen työluvan ja alkuperäisen valinnan erottamiseksi. Lupa
ei ole tuotantokytkentä tai nykyisen tallenninportin sopimuksen muutos.
Edellä hyväksytty `observeWorkspaceDeletionRemnants`-kierros ei hyväksy
tätä eri kutsupolkua.
Mahdollisen ehdokkaan on säilytettävä täydet valinnat lukuvaiheen rajoilla,
kaikki paikalliset tavu-/identiteetti-/kilpailijatarkistukset sekä nykyiset
täydet muutos- ja julkaisuvartijat. Tuotantokytkentää tai aikarajan muutosta
ei tehdä tämän havainnon perusteella.

**D:n rajatun kokeen tulos 1.11.2026:** vain muistissa ladattu
`captureWorkspaceDeletionPayloadBinding`-ehdokas erotti sisäisen
sidontaluennan vartijan ulomman lukukierroksen täydestä valinnasta.
Lopulliset 160 kontrollia läpäisivät, yksi ennestään alustakohtainen tapaus
jäi suorittamatta. Muuttunut valinta, ensisyy, pidetyn luku-/sulkupyynnön
päättyminen oikea tiedostokahva sulkien sekä vanhan lukuvaiheen hylkäys
uuden sisällä todennettiin. Nykyisen toteutuksen vertailukontrollit läpäisivät.
Valintaluvut vähenivät, mutta 23 rivin koe aikakatkaisi samassa rajassa
`quarantined`-tilaan edettyään. Ehdokasta ei hyväksytä yksin tuotantoon
eikä vanhaa hylkäystä suljeta.

Jatkon sopimuskatselmus kohdistuu nykyisen
`createWorkspaceDeletionPayloadExecutor`-omistajan `consume`-kutsuihin:
`validate` on luenta, `move`/`purge` muuttavat tiedostoja ja
`includeJournal=false` säilyttää muuttuvan journalin omistajuusrajan.
Myös `consumeSelectedRecords` käyttää nykyistä vaihekohtaista valtuutta.
Kevyttä luentavaltuutta ei saa sellaisenaan siirtää näihin muutosportteihin
tai nykyisen `WorkspaceRemnantBindingAuthority`-sopimuksen tilalle.

**Seuraavan rajatun kokeen katselmoitu sopimus:** `validate` saa oman,
yhteen kokonaiseen luentaan sidotun eliniän. Alkuperäinen täydellinen
vaihe-/rekisterivalinta ympäröi sekä workspace-tietueen hakua että jokaista
`validate`-kierrosta. Sisällä säilyvät työlupa, kirjoittajien poissaolo sekä
nykyisen tallentimen kaikki tavu-, tiedosto-, juuri-, EOF- ja sulkutarkistukset.
Kevyt vartija päättyy `finally`-rajassa vasta koko luvun ja sulun päätyttyä.
`move`/`purge` ja niiden alkuperäiset täydet muutosvartijat eivät käytä sitä.

Jokainen journalin `recover`/`advance`-vartijakutsu tekee uuden kokonaisen
luennan; aiempaa onnistumista ei välimuistiteta. `includeJournal=false`
poissulkee vain tallentimen muuttuvan journalin, ei rekisteriä,
omistajuutta tai kirjoittajien poissaoloa. Journalin omat slottisuojat säilyvät.
Kokeen on hylättävä myöhäinen vaihe-/rekisteri-/sidontamuutos ennen jatkoa,
vanha luentavaltuus uuden kierroksen sisällä, payloadin palaaminen
slottimuutoksen edellä ja epävarma sulku. Ensivirheen sekä myöhemmän
sulkuvirheen järjestys säilyy. Onnistuminen ei saa muuttaa säilytettäviä tavuja.
Rajattu riippumaton suunnitelmakatselmus ei osoittanut itsenäistä
julkaisun ohitusta näillä ehdoilla. Tämä on vasta koesuunnitelma:
tuotantokytkentä, kokonainen rooliketju, aikarajat ja E:n avoin
metadata-todiste säilyvät erillisinä portteina.

**Toisen koeehdokkaan tulos 1.11.2026:** rajattu katselmus löysi vanhan
lukukutsun alkuperäisen syyn katoamisen koeehdokkaassa. Kontrolli toisti
puutteen; korjattu ehdokas säilyttää alkuperäiset virheoliot. Sen kaikki
21 kohdekontrollia ja nykyisen vaikutusalueen 296 regressiota läpäisivät;
yksi ennestään alustakohtainen tapaus jäi suorittamatta. Vertailun
yhteiset tulokset ja muuttumattomat tuotantolähteet tarkistettiin.
Määriä ei summata aiempiin sarjoihin. Sama 23-rivinen kokonaiskoe
aikakatkaisi edelleen nykyisessä rajassa, nyt `purgeAuthorized`-vaiheessa.
Tämä ei ole valmis poisto, siivoustodiste tai tuotantokytkennän hyväksyntä.
Ensihylkäykset ja kunkin kokeen aineisto säilyvät erillisinä. Seuraava
lähderajaus on sidontaluennan kokonaisten valintojen kertautuminen sen
sisäkkäisissä alku- ja loppuvartijoissa; fyysisten muutosten nykyiset
täydet vartijat säilyvät.

**Kolmannen koeehdokkaan tulos 1.11.2026:** lukuvaiheen alku- ja
loppuvartijoiden rajatut muutokset läpäisivät 325 kontrollia ja nykyistä
regressiota; yksi ennestään alustakohtainen tapaus jäi suorittamatta.
Kahdeksan uutta kontrollia muuttaa valintaa oikeiden kirjoittajakyselyiden
sisällä ja varmentaa ensisyyn, säilyvät tavut sekä kahvojen sulun.
Vertailun yhteiset tulokset täsmäsivät. Katselmuksen havaitsema koetilan
tunnistuksen puute korjattiin; 21 kohdekontrollia varmensi myös todellisen
tarkistuskutsujen määrän. Päällekkäisiä ajoja ei lasketa yhteen.

Kokonainen 23 rivin koe aikakatkaisi edelleen nykyisessä rajassa.
Säilyneessä journalissa nykyinen vaihe on `purgeAuthorized` ja varakappaleen
vaihe `quarantined`; tämä ei todista vaihesiirron, poiston tai loppusiivouksen
valmistumista. Tuotantolähteet ja aikarajat säilyvät muuttumattomina,
eikä samaa koetta uusita vihreyden vuoksi. Seuraava rajattu suunnittelukysymys
on executorin kokonaisen sisältöluennan ja journalin teknisten
slottitoimien tarkistusvastuu: nykyinen `advance`/`recover`-vartija kutsuu
kokonaista `consume(..., 'validate', false)`-luentaa toistuvasti.
Säilynyt tila ei yksin nimeä viimeistä keskeneräistä kutsua. Nykyiset
muutosvartijat, omistajuus, tuoreet sisältötarkistukset, slottien
tavu-/identiteettivertailut ja keskeytyvän työn sulku on säilytettävä.
Koeehdokasta ei hyväksytä tuotantoon; E:n erillinen päätös ja koko
W7.4:n integraatioportit jäävät avoimiksi.

Ennen jokaista uutta vastuurajaa luetaan kohde-AGENTS ja sen nykyiset
omistavat ohjeet kokonaan. Yksi katselmoitava pala kerrallaan; dokumentit,
audit/diagnostiikka ja regressiot päivittyvät sen mukana. Korvattu
väliaikainen sovitus poistetaan vasta kattavuuden todennuksella eikä jätetä
rinnakkaista poistajaa. Uutta pitkää ajoa ei käytetä pienen puuttuvan
sopimuksen arvaamiseen. Aika-, sisältö-, eheys- ja CI-rajat säilyvät.

**Suunnitelman rajattu katselmus 28.10.2026:** lähdekartta ja riippumaton
omistajuus-/keskeytyssopimuksen katselmus tehtiin. Sidonnan tuotantomuoto
sekä metadatan keskeytyvä loppusiivous täsmennettiin katselmuksen perusteella;
delta-arviossa ei jäänyt muuta estävää havaintoa tähän rajaukseen.
Tämä ei ole koko sovelluksen katselmus tai tuotantotodiste. Erityisesti
management-palvelun todellinen valtuuden luovutus, kaikkien avausguardien
kattavuus ja uusien cleanup-porttien keskeytysnäyttö vaaditaan ennen niiden
kytkentää yllä olevissa A-E-paloissa.

**Valmis:** kaikki A-F:n puuttuvat tuotantoliitokset ja yllä olevat portit
on todennettu revision mukaan, normaali suojattu merge tehty ja uuden mainin
omat portit hyväksytty. M1 kirjaa seuraavaksi W7.5:n; W7.4 ei yksin sulje
koko W7:ää tai 0.3.0-julkaisua. Avoimet aiemmat viive-/siivoushavainnot
eivät muutu korjatuiksi uuden läpäisyn perusteella.

#### Toteutusriippuvuudet ja vaiheistus

- C todistaa katkeamattoman kirjoitussuojan, todellisen exitin, graceful-
  pysäytyksen ja startup-recoveryn oikean tuotantokytkennän. Pelkkä portti ei riitä.
- K antaa hyväksytyn versionmukaisen ja eristetyn backup-tarkistuksen.
  Containerin autentikointi ei yksin täytä W7-D4:ää.
- G antaa todellisen observer-kytkennän ja suljetun tapahtumakatalogin.
  H erottaa lokin tyhjyyden, osittaisuuden ja häiriön sekä turvallisen fallbackin.
- D:n hyväksyttyä secret-operaation epävarmuus- ja sulkusopimusta noudatetaan,
  jos pending-operaatio voi vielä muuttaa poistettavaa storea. Poisto ei saa
  ohittaa sitä eikä audit-rivin poistaminen todista työn päättymistä.

Suositeltu vaiheistus on täsmennettyjen sopimusten todennus, passiivisen,
aktiivisen, viimeisen ja vikatilaisen yrityksen poisto sekä backendittoman
tilan recovery ja lopullinen quarantine/purge-todennus. Kukin vaihe
toteutetaan täydellä sille soveltuvalla turvarajalla; karanteenia tai
vahvistuksia ei lykätä välivaiheen sivutyöksi.
Osittain valmis poisto ei täytä 0.3.0:n koko W7-vaatimusta. Laajempi
ensiasennuksen R030-06-muutos tarvitsee edelleen oman rajauspäätöksensä.

#### Recovery ja hyväksyntänäyttö

Hyväksytty käyttäytyminen: jo aloitettu lopullinen poisto jatkuu
automaattisesti vain yllä mainituin varmasti todetuin ehdoin. Ennen
lopullisen poiston alkua alkuperäinen aineisto säilyy; tarkka pysyvä
aloitusraja ja siirron sekä rekisterijulkaisun välitilat määritetään W7.0:ssa.
Osittain tuhottua yritystä ei palauteta toimivaksi. Puuttuva/rikkinäinen
journal, linkki tai ristiriitaiset juuret johtavat turvalliseen recovery-
tilaan, eivät arvaavaan poistoon. Jatkaminen revalidoi myös vanhan omistajan
päättymisen. Vain W7-P3:n mukaan todistettu kohteen oma keskeytynyt palautus
voi väistyä lopullisen poiston tieltä; muita avoimia operaatioita tai
asennustason update-journaleja ei ohiteta.
Pelkkä keskeytyskirjaus ei ole tuore tiedostomuutoksen valtuus.

Nykyinen `WORKSPACE-DELETE-001` on lykätty paikkamerkki, ei testitodiste.
Hyväksytyn poistosopimuksen jälkeen se täsmennetään
[testimatriisiin](r0-e2e-test-matrix.md) seuraavilla tapauksilla:

- aktiivinen, passiivinen, viimeinen ja viimeinen `ready`; samannimiset,
  vanha vahvistus, peruutus sekä kilpaileva maintenance
- uusien nimikaksoiskappaleiden esto luonnissa, tuonnissa ja nimenmuutoksessa
  yhteisellä kirjainkoko-/välilyöntisäännöllä; historialliset samannimiset
  säilyvät huomautuksella ilman automaattista nimeämistä, yhdistämistä tai poistoa
- aktiivisen yrityksen onnistuneen poiston jälkeinen yritysvalinta myös
  restartissa; toisen yrityksen runtimea ei käynnistetä ennen käyttäjän valintaa
- vikatilaisen yrityksen poisto ilman business-tietokannan avaamista;
  epävarma kohde tai yhä toimiva omistaja estää poiston, eivät johda arvaukseen
- puuttuva, vioittunut, väärän lineagen tai hyväksytyn tuoreusrajan rikkova
  backup sekä puuttuva/peruttu erillinen riskihyväksyntä: ilman kumpaakaan
  kelvollista perustetta ei siirtoa tai poistoa; riskihyväksyntä ei ohita
  identiteetti-, containment-, maintenance- tai recovery-rajaa
- ilman backupia poistamisen kolme varmistusta erikseen: riskihyväksyntä,
  oikean yritysnimen kirjoitus ja native-vahvistus; minkä tahansa puuttuminen
  tai peruutus estää poiston. Backupin virhe ei hyväksy riskiä käyttäjän puolesta
- viimeistä vahvistusta edeltävä peruutus säilyttää yrityksen ja salaisuuden;
  poiston alettua käyttöliittymä ei tarjoa peruutusta tai avaa osittain poistettua
  yritystä. Pakotettu keskeytys ei saa onnistuneen poiston tai peruutuksen tulosta
- keskeneräiset kirjoitukset, arkistointi ja salaisuusoperaatiot; vanha
  session torjutaan eikä kahta business-runtimea synny
- keskeytys jokaisella durable-rajalla, toistettu restart, levy täynnä,
  käyttöoikeus-/kahvalukko, journalin korruptio, linkki ja containment
- aloitettu lopullinen poisto jatkuu restartissa ilman uutta vahvistusta
  vain samalle todennetulle kohteelle. Muuttunut kohde, epävarma omistajuus,
  puuttuva aloitustodiste tai epäselvä keskeytystila estää automaattijatkon;
  jäännökset säilyvät eikä osittain poistettua yritystä avata business-käyttöön
- quarantine/import-lineage-törmäys, palautus ja osittainen lopullinen poisto
- onnistunut poisto ei jätä piilokopiota tai SMTP-slottia; keskeytynyt poisto
  näkyy keskeneräisenä eikä saa virheellistä onnistumisilmoitusta
- lopullinen poisto kattaa myös yrityksen viimeisen hyvän palautuspisteen;
  sen indeksi- ja avainjäämät tarkistetaan, eikä poisto luo vientibackupia.
  Muiden yritysten pisteet ja käyttäjän tallentama kopio säilyvät muuttumattomina;
  tuettu vientibackup voidaan tuoda uudelleen normaalilla import-as-new-polulla
- yrityksen oma audit-/tapahtumahistoria poistuu ilman erillistä kopiota;
  muiden yritysten historia ja tekniset virhelokit säilyvät omien sääntöjensä
  mukaan, eikä poistettavia audit-rivejä viedä tekniseen lokiin
- käyttäjän ulkoisen PDF-arkiston juuri, työtilakohtainen alikansio ja
  tiedostot säilyvät muuttumattomina; sisäiset auktoritatiiviset PDF:t
  poistuvat yrityksen mukana. Arkistointityön päättyminen todistetaan ennen
  asetuksen/journalin poistoa, eikä vanha työ tee uusia ulkoisia kopioita
- W7-D6-D9:n hyväksyttyihin päätöksiin sidottu ennen/jälkeen-inventaario
  quarantinen, palautuksen ja lopullisen poiston jälkeen: secretien
  current/next/backup-slotit, recovery-pisteet/indeksi/avainkuoret sekä
  staging- ja legacy-jäämät; ulkoisten kopioiden ja installation-tilan
  säilyminen tarkistetaan, ei oleteta. Inventaarion testi ei päätä retentionia.
- sama hardened Windows -artifact: oikea capability, muut yritykset ja
  niiden DB/PDF/salaisuudet muuttumattomina, todettu prosessisiivous,
  diagnostiikka ja backendittoman tilan palautuminen
- packaged backup -> inspect -> restore -> restart -> compare, mukaan
  lukien kannan vertailu ennen ensimmäistä avausta, salaisuuksien poissulku
  ja soveltuvat lifecycle-/soak-portit.

Testit käyttävät vain synteettisiä profiileja. Käyttöohje kertoo, mikä
poistuu, mikä jää käyttäjän ulkoisiin kopioihin, mistä palautus onnistuu ja
missä kohdassa poisto muuttuu lopulliseksi. Suunnitelman katselmointi ei
ole näiden testien suoritus tai turvallisuussopimuksen hyväksyntä.

### Jatkosuunnittelu: ensikäyttö ilman oletusyritystä

Omistajan jatkotoiveena on, ettei aidosti uudessa asennuksessa luoda
automaattisesti tyhjää oletusyritystä. Ensimmäinen näkymä tarjoaisi uuden
yrityksen luonnin tai varmuuskopion tuonnin uutena yrityksenä. Tämä
suunnitellaan W7:n yhteydessä, mutta ei toteuteta 0.2.8-pilotin aikana.

Toive säilyy `0.3.0`-tehtävälistalla kohtana `R030-06`, jonka toteutusraja
päätetään W7-suunnittelussa. Yrityspoiston pakollisuus ei yksin hyväksy
kaikkia ensiasennuksen muutoksia.

Olemassa olevan asennuksen päivitys ja aiemman profiilin adoptio säilyttävät
yritykset ja tiedot; niitä ei tulkita tyhjäksi ensikäytöksi. Oletusyritystä
ei poisteta automaattisesti myöskään silloin, kun se näyttää tyhjältä.
Suunnittelu ratkaisee erikseen nollan työtilan käynnistystilan, luonnin ja
tuonnin peruutus-/virhepolut sekä viimeisen yrityksen poistamisen jälkeisen
tilan nykyisten lifecycle- ja turvallisuussopimusten puitteissa. Tämä kirjaus
on jatkotyön tavoite, ei valmiin toteutuksen tai uuden poistorajan hyväksyntä.

### W7.4 D: valittu rekisterijulkaisu

`workspaceDeletionRegistryPublication.ts` jatkaa vain valitusta, julkaistusta
`purged`-journalista. Nykyinen rekisteritallennin omistaa kirjoituksen ja
sen sallittujen keskeytystilojen palautumisen. Poisto todistaa sen
ulkopuolelta saman journalin, muuttumattoman inventaarion, kaikkien
payload-/quarantine-juurten poissaolon ja tuoreen main-/kirjoittajavaltuuden.
Muuttuvan rekisterin omia slotteja ei tarkisteta vanhaan tilaan sen oman
kirjoituksen sisältä; niiden täsmälliset tavut ja identiteetit kuuluvat
valitun kirjoituksen portille. Kirjoituskuittauksen jälkeen tarkistetaan
todelliset jälkeen-tavut ja palautetun current-identiteetin täsmääminen.

Jo julkaistu jälkeen-tila ei aiheuta uutta kirjoitusta. Julkaisematon next
ei yksin kelpaa hyväksytyksi rekisteriksi. Aktiivisen tai viimeisen yrityksen
poistuminen tyhjentää valinnan eikä luo oletusyritystä. Ensimmäinen syy
säilyy myös alemman tiedostokerroksen yleistäessä virheen; aloitettu työ
odotetaan loppuun ja samanaikainen julkaisu estetään. Journal ja inventaario
jäävät tässä vaiheessa paikalleen omistajien loppusiivousta varten.
Tämä rajattu tiedosto-/keskeytysnäyttö ei vielä ole main-kytkennän,
prosessikatkon, koko D:n tai W7.4:n hyväksyntä.

**Sidonnan keskeytyvä loppusiivous:** nykyisen
`WorkspaceRemnantBindingStore`n `clearCommittedAfterPayloadsAbsent` käyttää
vain `deletionPurged`-sopimusta. Kutsuja todistaa edelleen valitun
`purged`-journalin, täyden inventaarion, täsmällisen jälkeen-rekisterin ja
kaikkien payloadien poissaolon. Jokaisen jäljellä olevan slotin kohde,
lineage ja kanoninen tiiviste tarkistetaan sitoutuneeseen tietueeseen;
tavut ja identiteetit valitaan ennen muutoksia. Kaikkien slottien jo
puuttuessa ei keksitä menetettyä operationId:tä eikä luoda hakemistoa.
Nykyinen sivuslotit-ennen-currentia-poisto ja hakemiston sync säilyvät.
Tavallinen lukija vaatii yhä currentin. Palautusjournalien omistajakohtainen
siivous tehdään ennen sidonnan poistoa, eikä tämän portin kohdetesti todista
sitä tai yhteisen etenijän kytkentää.

**Alkuperäisten journalien omistajaportit:** importin
`WorkspaceBackupImportJournalStore`, adoption
`WorkspaceLegacyAdoptionJournalStore` ja yhteinen
`ProfileRestoreActivationJournalStore` omistavat rajatun
`clearAfterDeletionPurged`-portin. Se ei ole tavallisen palautuksen
remove/discard/clear-oikeus. Kutsuja todistaa inventaarioon sitoutuneen
sidonnan, valitun poistojournalin, jälkeen-rekisterin, kaikkien kohdejuurten
poissaolon ja main-/kirjoittajavaltuuden jokaisessa muutoksessa.

Jokainen jäljellä oleva slotti sidotaan täsmälliseen operaatioon ja
omistajan kenttiin sekä alkuperäisiin tavuihin ja tiedostoidentiteetteihin.
Vain nykyisten kirjoittajien sallitut kahden slotin välitilat tai
loppusiivouksen jo sallima osittainen/täysi poissaolo kelpaavat; nextiä ei
nosteta currentiksi. Importin varhaisvaiheen pakollinen null-lineage
säilyy nullina, ja sidonta todistaa kohteen; jokaisen ei-null-lineagen on
täsmättävä. Adoption legacy-recovery-reset on nykyisen nimetyn portin
poikkeus, ei tavallisen siirtymäsäännön muutos. Activation tarkistaa
revisioiden lisäksi todellisen vaiheparin: terminalista ei palata
valmisteluun. Sivut poistetaan ennen currentia, hakemiston sync ja
aloitetun työn päättyminen vaaditaan. Alkuperäinen virhe välitetään
nykyiseen `onUncertain`-havaintoon ennen omistajan mahdollista yleistä
virhekoodia; ilmoituksen odottaminen ei estä komentoa.

Portit eivät poista sidontaa tai payloadia. Yhteinen etenijä siivoaa
journalin ensin ja sen sidonnan vasta todistetun journalipoissaolon
jälkeen. Porttiregressioiden vartijat eivät vielä todista mainin tätä
kytkentää, koko D:tä tai kylmäjatkoa. Luonnin journal säilyy nykyisenä
admission-estona eikä saa uutta poistoroolia workspaceId:n perusteella.

**Yhteinen metadatan loppusiivous:**
`workspaceDeletionMetadataCleanup.ts` käyttää näitä omistajaportteja
valitun `purged`-journalin ja täsmällisen jälkeen-rekisterin alla. Koko
sitoutunut luettelo ja kaikkien payload-/quarantine-juurten poissaolo
todistetaan muutoksissa. Kolmen kiinteän journalinomistajan sidonnat
ja kaikkien valittujen journalien sallitut slottisuhteet varmennetaan
alkuperäisten omistajien yhteisillä lukusäännöillä ennen ensimmäistä
journalimuutosta. Myöhemmän omistajan ristiriita säilyttää myös aiemmat
journalit ja sidonnat; vieras tai luetteloon sitomaton journal estää jatkon.
Journalit siivotaan ja niiden poissaolo
varmennetaan ennen ensimmäistä sidontapoistoa. Sidonnan valitut tavut ja
identiteetit säilyvät omistajan muutoksen yli. Lukutodiste käyttää samaa
sitoutuneen siivouksen validointia kuin kirjoitusportti, ei tavallisen
lukijan ehtojen lievennystä.

Jo puuttuva journal synkronoidaan sen nykyisen omistajan kautta, kun
siihen sidottu metadata on vielä tallella; näin viimeisen poistokutsun
tai syncin kadonnut kuittaus ei ohita omistajaa. Osittain siivottu sidonta
ei tarvitse keksittyä operationId:tä. Lopussa nykyinen rajattu
sidontahakemistojen lukija hylkää jäljelle jääneen kohdemetadatan; uutta
aineistoa ei oteta siivoukseen luettelon ulkopuolelta. Muiden yritysten
tavut ja jaetut emohakemistot säilyvät. Luettelo kulutetaan sarjallisesti,
eikä jäännösmäärä kasvata muistissa olevaa journalivalintaa.

Vaihe jättää poistojournalin ja inventaarion `purged`-tilaan. Se ei vielä
julkaise terminalia, poista inventaariota tai anna `recordRemoved`-kuittia.
Neljän omistajan ja katkosten tiedostoketjut ovat rajattua näyttöä;
mainin todellinen valtuus, cold-admission ja prosessikatko jäävät E/F:n
ja varsinaisen kytkennän porteiksi.

**Terminalin julkaisu ja journal viimeisenä:**
`workspaceDeletionFinalization.ts` käyttää nykyistä journalin valitun
kirjoituksen porttia, inventaarion retirement-porttia ja journalin
`clearTerminal`-porttia. Se ei poista payloadia tai siivoa puuttuvaa
omistajasidontaa arvaamalla. `registryPublished` julkaistaan vain
sitoutuneen inventaarion täydellisen takaisinluvun, kaikkien payload- ja
quarantine-juurten poissaolon, omistajajournalien ja kohdesidontojen
poissaolon sekä täsmällisen jälkeen-rekisterin todistamisen jälkeen.
Nykyinen metadatasiivous ja terminal käyttävät samaa rajattua
read-only-poissaolotarkistusta.

Keskeytyneet journal-slotit sovitetaan ennen inventaarion poistamista.
Niiden sovitus tarvitsee yhä alkuperäisen inventaarion ja täyden
poissaolotodisteen. Vain yksin oleva terminal-current sallii jo aloitetun
inventaarion teknisen siivouksen. Valittu terminal-identiteetti pidetään
sidottuna inventaarion poistoon asti; sen jälkeen journal-tallennin
omistaa omien muuttuvien slottiensa tarkistukset. Rekisteri-, varaus-,
kirjoittaja- ja metadataehdot tarkistetaan myös jokaisessa muutoksessa.
Inventaario ja sen oma tyhjä operaatiokansio synkronoidaan pois ennen
journalin viimeistä poistoa. Vieras lisätiedosto estää siivouksen.

Kadonnut kuittaus tai sync-virhe ei muutu onnistumiseksi. Tyhjä journaltila
ei anna uutta siivousvaltaa tai mahdollista valmistumiskuitin keksimistä.
Ensimmäinen syy säilytetään ennen alemman tiedostokerroksen turvallista
muunnosta, ja aloitettu työ odotetaan loppuun ennen valtuuden vapautusta.
Terminalin identiteettiluvun odottamatonta hylkäystä ei korvata myöhemmin
havaitulla valtuusvirheellä. Vain kyseisessä kohdassa hyväksyttävä `ENOENT`
voi edetä poissaolona, ja se edellyttää edelleen voimassa olevaa valtuutta.
Vaiheen palauttama terminal-arvo on sisäinen vaihekuitti, ei vielä mainin
`recordRemoved`-hyväksyntä. Tiedostoketjujen todennus ja sen rajat kuuluvat
M1:n nykytilaan; main-/service-kytkentä, cold-admission sekä F:n prosessi-,
paketti- ja PR/main-portit vaaditaan edelleen erikseen.

**Sama pysyvä publish/resume-komento:** `workspaceDeletionCommand.ts`
liittää yllä olevat nykyiset vaiheet yhdeksi sisäiseksi kuluttajaksi.
Live-polku kaappaa julkaisun muuttumattoman journal-sidonnan ennen sen
palauttamista mainille. Jokainen vaihe valitsee todelliset slotit ja vertaa
niitä samaan sidontaan ennen rekisterilukua tai omaa tiedostotyötään;
vaiheen muuttuminen ei muuta kohdetta, inventaariota tai ennen-/jälkeen-
rekisteriä. Odotusten yli säilyvä sidonta kopioidaan ennen ensimmäistä
odotusta, ei lueta myöhemmin kutsujan muokattavasta oliosta.

Kylmäjatkon sisääntulo käyttää samaa komentoa mutta aloittaa nykyisestä
julkaistusta journal-valinnasta ja tarvitsee E:n tuoreen admissionin ja
omistajuuden. Puuttuva journal ei anna valmistumiskuittia. Komento estää
oman rinnakkaisen julkaisun ja jatkon, odottaa alkaneen työn loppuun ja
toimittaa `recordRemoved`-tiedon vasta terminalin ja kaikkien teknisten
poistojen jälkeen. Vastaanottajan on valmistuttava synkronisesti: hylkäys
tai asynkroninen tulos ei ole onnistunut kuittaus. Tämän jälkeen ei tehdä
uusia tiedostotöitä. Pysyvien tavujen ja uuden omistajaolion ketjutestit
eivät vielä todista main-/service-kytkentää, oikeaa prosessikatkoa,
cold-admissionia tai paketoitua toimintaa; ne säilyvät erillisinä portteina.

## Checkpointien yhteinen Definition of Done

Jokaisessa vaiheessa:

1. lähimmät `AGENTS.md`- ja tehtävädokumentit on luettu
2. uusi riippuvuus, schema tai formaattimuutos on pysäytetty omaan
   hyväksyntäporttiinsa
3. tiedostot ja adapterit omistavat yhden koherentin vastuun
4. renderer-, Electron main-, backend- ja filesystem-luottamusrajat on
   testattu
5. vanha työtila, muut työtilat ja installation-scope ovat failure-polussa
   muuttumattomia
6. salaisuuksia, polkuja, sessionia tai business-dataa ei vuoda UI:hin,
   lokeihin tai testiraportteihin
7. unit/integration/E2E/packaged-testit skaalautuvat riskin mukaan
8. dokumentaatio ja integraatiomatriisi on päivitetty
9. versionostoa ei tehdä ennen W6:n release-porttia
10. asennuksessa on myös maintenance-operaatiossa enintään yksi business-
    SQLite-owner
11. työpuu ja artifact-identiteetti ovat puhtaat ennen seuraavaa vaihetta.

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `apps/e2e/AGENTS.md`
- `docs/architecture/e2e-test-environment.md`
- `docs/architecture/e2e-testing-strategy.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/module-integration-matrix.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/architecture/windows-update-operational-runbook.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
- `docs/decisions/ADR-0011-local-multi-workspace-company-model.md`
