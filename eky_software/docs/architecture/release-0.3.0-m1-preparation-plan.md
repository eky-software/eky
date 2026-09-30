# 0.3.0 M1 -valmistelu

## Jatka tästä

**T1/T2/T3 ja niiden integraatiojatko ovat hyväksyttyjä. Seuraava
sovelluspala on A1/R01; sitä ei ole aloitettu.** Modulaarinen monoliitti ja
hyväksytty M1-rajaus säilyvät. Tämä sivu omistaa M1:n nykyisen jatkamiskohdan;
[julkaisusuunnitelma](release-0.3.0-plan.md) omistaa koko 0.3.0:n sisällön.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Hyväksytty lähtörevisio | PR #281:n merge-main `0389026edd4d1eff6a38f61bbf41451622713ec9`. Sen koko lähdepuu vastaa hyväksyttyä PR-lähdettä ja checkoutia. [Lopullinen hyväksyntä](https://github.com/eky-software/eky/pull/281#issuecomment-5880101997). |
| Mainin omat portit | [Normaali CI 36491715165](https://github.com/eky-software/eky/actions/runs/36491715165), yritys 1: kaikki 38 vaadittua ryhmää läpäisivät; vain nimenomaisesti valinnainen diagnostiikkakoe ohitettiin. Linux system 695/695, kriittinen web 37/37 ja Windowsin kriittinen Electron 38/38 vastasivat ajovalintojaan ilman retryä, flakyä tai puuttuvia tapauksia. Neljän artifact-tuottajan ja kymmenen packaged-kuluttajan identiteetit ja elinkaarinäyttö hyväksyttiin. [Saman revision riippuvuustarkistus 36491789402](https://github.com/eky-software/eky/actions/runs/36491789402) läpäisi. |
| Suljettu työ | T1/R27:n ajokytkentä, T2/R29:n puhtaan valmistelun suoja ja T3/R28:n todellisten kuluttajien koko prosessipuun omistajuus. Korvatut aktiiviset fallbackit on poistettu ja [pysyvä T3-matriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus) hyväksytty. PR #281 sulki tämän jälkeisen rollback-testiapurin integraatiojatkon. |
| Avoimet havainnot | Aiemmat satunnaiset Electron-käynnistys- ja packaged/legacy-timeoutit säilyvät epäonnistuneina havaintoina omille revisioilleen. Myöhempi vihreä ajo ei todista niiden kaikkia syitä korjatuiksi. [Hylkäysten historia](e2e-test-environment-history.md#dokumentti-mainin-hylkäys-ja-rajattu-diagnostiikkajatko) ja [rajattu apurikorjaus](e2e-test-environment-history.md#rollback-testiapurin-ennenaikaisen-poistumisen-korjaus) erotetaan toisistaan. |
| Seuraava työ | Ennen ohjeselkeytyksen mergeä hyväksytty [Electron 43.7.6 -turvallisuuspäivitys](local-desktop-dependency-review.md#electron-4376--turvallisuuspäivitys) ja sen omat runtime-, tietokanta-, packaged- ja CI-portit. Undici-korjauksen ja varmennetun pnpm-valmistelun CI-näyttö koskee alla nimettyä aiempaa revisiota, ei uutta Electron-versiota. Sen jälkeen A1/R01:n aloitusportti: ajantasaiset ohjeet, työpuu, lähtörevisio ja sen hyväksyntänäyttö sekä [avattavan luonnoksen kohteen suunnitelma](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde). Rajaa avoimet kysymykset ja regressio ennen toteutusta. |
| Ei vielä valmis | A1-A3, W7, M1:n muu sovellustyö ja koko 0.3.0. Testiperustan hyväksyntä ei hyväksy niiden tulevaa toteutusta tai muuttunutta liiketoimintasääntöä. |

Hyväksyntä on sidottu yllä olevaan revisioon, ei automaattisesti myöhempään
työpuuhun. Dokumenttimuutoksen toteutuneet tarkistukset ja mahdollisen
integraation lopputulos kirjataan sen omaan hyväksyntächeckpointiin;
pelkän tuloksen ilmoittamiseksi ei tehdä uutta tilakirjauscommittia.
Ennen A1:tä tehdään uusi preflight. Sivulla ei ylläpidetä Goal-työkalun
ajonaikaista tilaa.

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
| V2b: pakollisten porttien hylkäykset | Tavallinen workspace-sarja sekä revision `1e91b328` täysi Electron-sarja, stress ja täysi soak ovat läpäisseet alla kuvatusti. Aiemmat käynnistys-, rollback-testin timeout- ja näkymäsiirtymähylkäykset säilyvät omien revisioidensa havaintoina; kaikkien syitä ei ole ratkaistu. Lopullisen lähteen packaged-/palautus- ja PR/main-portit ovat vielä avoimia. | Rajaa nykyistä hyväksyntää estävä vika näytöstä, korjaa omistavassa vastuussa ja lisää regressio. Muuttumaton erillinen läpäisy ei sulje alkuperäisen vian syytä. Historiallisten hylkäysten täydellinen jälkiselitys ei ole uusi hyväksyntäehto. |

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

Seuraavana varmennetaan tuore eristetty tuotantopayload ja sen hardened
backup -> inspect -> restore -> restart -> compare sekä riippuvuusauditit.
V1b:n rajattu loppuprojektion korjaus ei muuta yllä ajettuja sovellus-,
runtime- tai endurance-polkuja. Lopullinen korjattu revisio tarvitsee silti
omat PR/main-porttinsa. V2 ja integraatio ovat vielä avoimia.

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
