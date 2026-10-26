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
haarasta; nimetty deferred-jatko odottaa startup-kytkentää. `targetValidation`-startup valitsee
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

Nykyisen W6-orchestraattorin `cancelBeforeSelectorReturn` toteuttaa tämän
peruutusrajan nimetylle deferred-avaukselle. Kutsuja toimittaa elävän
käynnistysvaltuuden ja todellisen töiden päättymistarkistuksen; metodi ei
päättele prosessin poissaoloa. Vain kuitattu oma `prepared`-journal tai
täsmällisesti jatkettava valmistelu voidaan poistaa. Tarkistuksessa
kaapatut tavut ja tiedostoidentiteetti kulkevat nykyisen slot-tallentimen
poistovartijaan asti. Lukutarkistus ei korjaa sivuslotteja. Keskeneräinen
valmistelu, alkanut rekisterisiirtymä, muuttunut valinta tai kadonnut
kuittaus estää saman instanssin jatkon. A/B-metadataa ja rekisteriä ei
muuteta peruutuksessa. Tämä osaraja ei vielä todista mainin terminal-
kytkentää tai oikean prosessin päättymistä.

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
Tämäkään osaraja ei vielä todista mainin ulkoisen valtuuden kytkentää.

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

Mainin lopullinen valitsinkytkentä ei vielä toimita tätä valtuutta tai
terminal-todistetta. Tiedostotallentimien, resolverin, guardin ja
startup-/inspector-luokkien yhteiset regressiot käyttävät ohjattuja prosessi-
ja sisältöportteja; ne eivät korvaa SQLite-/Electron- tai paketoitua
todistusta. Todellisen startup-sukupolven, A/B-tilan, W6:n ja palautuksen
terminal-valtuuden liitos on edelleen W7.2:n portti. Business-composition
ei saa käyttää puuttuvaa valitsinkytkentää syynä session luomiseen.

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
ohiteta vanhaan korjaavaan lukijaan. Tämä kytkentä ei vielä toimita
W6:n tai FirstStartin myöhempien muutosten valtuutta.
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
rekisterisiirtymään. Rajapinnan olemassaolo ei todista tätä startup-kytkentää.

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
deferred-valtuudella; mainin lopullinen vaihekohtainen sidonta on yhä avoin.

Pysyvät testit käyttävät nykyisiä tiedostotallentimia ja v1/v2-rekistereitä.
Inventaario ja startup-valtuus ovat niissä ohjattuja; ne eivät todista oikeaa
SQLite-/Electron- tai paketoitua ketjua. Valitsimen ja source-null-avauksen
tuotantokutsuja ei vielä käytä tätä W6-valtuutta. Ajantasainen testinäyttö
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

**Tila:** omistajan 2026-09-22 päätöksellä `0.3.0`-julkaisuun kuuluva
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
roolien disjointness todennetaan W7.3:ssa, ei pelkällä codec-kokeella.

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
