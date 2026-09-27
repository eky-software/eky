# 0.3.0 M1 -valmistelu

## Jatka tästä

**2026-09-27: T1/T2 hyväksytty, T3/R28 kesken; ei uutta rinnakkaista remonttia.**
Modulaarinen monoliitti ja hyväksytty M1-rajaus säilyvät.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Nykyinen lähtörevisio | `23b43c4949df1fd98939b589eb8f024a61b8e903`: rajattu diagnostiikkarevisio Windows-Electronin `4aececfd`-välipaketin päälle. Sen kohdennettu CI paikansi valmisteluhylkäyksen ympäristöarvon tarkistukseen. Tämän päälle tehty rajattu PATH-korjaus ja käynnistysvirheen kaappaus ovat paikallisesti todennettuja; niiden oma puhdas revisio ja normaali CI ovat seuraava portti. Viimeisin kokonaan hyväksytty CI-lähtötila on erikseen `587ba540`. Tarkista jatkettava HEAD ennen muutoksia; aiempi vihreys ei hyväksy uutta revisiota. |
| Viimeisin koko CI:n hyväksytty lähtötila | Sama `587ba540`: 38 onnistunutta ryhmää ja yksi tarkoituksellinen valinnaisen kokeen ohitus. Kaikki neljä kokeellista valitsinta pois. System 518/518, web 35/35 ja Electron 38/38 ilman retryä tai flaky-tulosta; koko tapausjoukko tarkistettu puhtaan revision luetteloa vasten. Lokien checkoutit sekä neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat tarkistettu. Linuxin työkalusarja 638/638; native 510/226/285/408. Ei PR/main- tai koko T3-hyväksyntä. |
| Avoin puute | Pääprosessin poistuminen ei todista koko puun poistumista. Windows-backendin ja Windows-Viten oikeat kuluttajat on siirretty ja niiden normaali CI-portti läpäisty. Windows-Electronin tavallinen pääfixture ja sen paikallinen 45/45-portti sekä todellisen fixturen close-/port-epävarmuus ja handoffin virhesiivous on todennettu. Korvattu Windows-varapolku on poistettu; poiston jälkeinen tyyppitarkistus ja kanoninen system 607/607 läpäisivät. Endurance ja koko omistajuusmatriisi ovat vielä avoinna. Chromiumin ja Linuxin siirrot ovat erillistä jatkotyötä. Aiemman revision `a2c826fc` packaged-workspace-timeout säilyy erillisenä ratkaisemattomana havaintona. |
| Viimeisin rajattu näyttö | [Omistava checkpoint](e2e-test-environment.md#electron-bridgen-lopetuspolun-jatkoehdotus): restart/relaunchin ja toisen instanssin erilliset toiset yritykset, owner-lossin ensimmäinen ja caller-lossin toinen yritys hyväksytty; ensimmäiset hylkäykset säilyvät. Nykyisen fixturekytkennän samalle lähdetilalle E2E-tyyppitarkistus ja kohdesopimukset 186/186 sekä kanoninen valmistelu ja tavallinen Electron 45/45 ilman retryä, flaky-tulosta tai ohitusta hyväksytty. Lähdesidonta ja tavallinen tapausjoukko takaisinluettu. Myöhemmät todellisen fixturen close-/port-epävarmuuskokeet ja handoff 24/24 on hyväksytty; Windows-varapolun poiston jälkeinen tyyppitarkistus ja kanoninen system 607/607 läpäisivät omalla lähdesidonnallaan. Ei endurance-, uuden etä-CI:n tai koko T3:n hyväksyntä. Aiemmat 82/82 havaitsija-/bridge-sopimukset, työkalusarja 678/678 sisältäen bundle-regressiot ja 38 uutta lopetustestiä, workspace/typecheck, `test:ci` 315/315 sekä neljä käynnistys-/ikkunakoetta pysyvät erillisen aiemman lähdetilan näyttönä. |
| Nykyinen toteutuspala | Windowsin `isolatedElectronTest` säilyttää bridge-/native-omistajan ennen launchin odotusta, saman alkuperäisen elinajan sukupolvien ja toisen instanssin yli sekä epävarmuudessa pysyvän restart-/poistoeston. Windowsin sulku ei palaa vanhaan cleanupiin. Synkroninen välimuistihavainto luokittelee oikeaa työkuormaa, ei bridgen PID:tä; timeoutin alkuperä ja sulkuvirhe säilyvät erillisinä. Yhteinen fixture-rajapinta ja muiden alustojen haara säilyvät. Normaali paikallinen kuluttajakytkentä on hyväksytty; muu virhematriisi ja uusi CI avoinna. Koko CI:n hyväksytty lähtörevisio on edelleen `587ba540`; koko T3 avoin. |
| Viimeisin CI-yritys | Revision `4aececfd` [V2 36349083394](https://github.com/eky-software/eky/actions/runs/36349083394), yritys 1: Electron-ryhmä hylätty, 14/38 läpäisi ja 24/38 epäonnistui ennen yhteyttä. Ensimmäiset yritykset ja nykyisen CI-politiikan retryt sekä 48 lifecycle-liitettä säilytetty. [Riippuvuustarkistus 36349088196](https://github.com/eky-software/eky/actions/runs/36349088196) päättyi onnistuneesti. Tämä ei ole normaali hyväksytty baseline; aiemman `587ba540` vihreät ajot säilyvät omana näyttönään. |
| Viimeisin diagnoosi | `23b43c49`: [36350757744](https://github.com/eky-software/eky/actions/runs/36350757744), yritys 1, hylätty; kaikkien 48 lifecycle-liitteen syy `ownerEnvironmentValueInvalid`, todellinen checkout varmennettu. Tarkkaa alkuperäistä ympäristöarvoa ei kerätty. PATH-korjauksen ensimmäinen tavallinen ajo jäi 44/45-tulokseen erillisen ennen testirunkoa tapahtuneen poistumisen vuoksi. Turvallista ensiyrityksen kaappausta täydennettiin; myöhempi kanoninen 45/45 ei todista alkuperäisen poistumisen syytä. |
| Seuraava työ | Todista [rajatun Electron-korjauspaketin](e2e-test-environment.md#windows-electron--valmistelun-ci-hylkäys) puhtaan revision normaali CI ja riippuvuustarkistus. Tyypitys, 136/136-kohdesarja, työkalusarja 678/678 ja tavallinen kanoninen Electron 45/45 ilman retryä on todennettu samalle koodisisällölle. Alkuperäisen poistumisen syy säilyy avoimena. Vasta vihreän baselinen jälkeen Chromiumin/Linuxin kuluttajasiirrot avoimet päätösrajat säilyttäen sekä nykyisen kadenssin endurance ja muut [T3-portit](#t3n-nykyinen-työjärjestys). Ei uusia välilupia hyväksytyn rajauksen sisällä eikä avoimien ympäristö-/omistajuusvalintojen olettamista. |
| Valmistuminen | Oikeat kuluttajat siirretty, korvattu aktiivinen toteutus poistettu vasta vastaavan kattavuuden jälkeen, T1/T2 säilyneet sekä koko T3-matriisi ja täsmällisen PR/main-revision portit läpäisty. |
| T3:n jälkeen | Nykyisen M1:n A1:n vanhentuneet vastaukset ja muut hyväksytyt sovelluskorjaukset, sitten roadmapin 0.3.0-käyttöliittymä- ja diagnostiikkatyö. |

**28.9. seuraavan työn tarkennus:** ensimmäinen tavallinen Electron-sarja
hylättiin 44/45: yksi `firstWindow/processExited` ennen testirunkoa;
siivous varmistui. Sukupolvikohtainen turvallinen virhekaappaus on nyt
toteutettu ja katselmoitu, ja sen jälkeinen kanoninen sarja läpäisi 45/45
samalla täydellisellä tapausjoukolla. Tyypitys, 136/136-kohdesarja ja
työkalusarja 678/678 läpäisivät samalla koodilla. Hylätty tulos ja sen
syyepävarmuus säilyvät; uusi läpäisy ei ole juurisyytodiste.
Seuraava hyväksyntä on tämän paketin oma normaali CI, ei kuluttajasiirto.

**Windows-välipaketin yhteiset portit 2026-09-27:** varapolun poiston
jälkeinen yhtenäinen lähdetila läpäisi koko workspacen testit ja
tyyppitarkistuksen sekä CI-sopimukset 315/315. Kahdeksan ennestään
alustakohtaista ohitusta säilyi workspacen testeissä; uusia ohituksia ei
lisätty. Tämä täydentää yllä olevaa 607/607-näyttöä. Seuraava riippumaton
askel oli katselmoidun välipaketin normaali CI ennen uusia kuluttajasiirtoja.
Sen Electron-hylkäys on nyt kirjattu yllä; uusia siirtoja ei aloiteta ennen
vian rajaamista ja baselinen korjaamista.

**Uusin päätös 2026-09-27:** omistaja valtuutti jatkamaan koko nykyisen
T3/R28:n toteutuksen, testit ja normaalin PR/main-integraation loppuun
nykyisin hyväksyntäehdoin ilman toistuvia välilupia hyväksytyn rajauksen
sisällä. Päätös kattaa nimenomaisesti nykyiseen `playwright-core@1.62.1`-
patchiin valmistellun lapsittoman Windows-bridgen rajatun lopetuslisäyksen,
kutsujan kytkennän ja testit. Omistavan ehdotuksen aiempi lisäpatchin
hyväksyntää odottava kirjaus on tämän päätöksen osalta historiallinen;
tekninen sopimus ja kaikki todennusportit säilyvät. Tämä ei hyväksy uusia
riippuvuuksia, ympäristömuutoksia, Chromiumin omistajuuspoikkeusta tai
tuotantoarkkitehtuurin muutosta. Rajattu korjaus ja ikkunapidätys on nyt
toteutettu ja niiden paikallinen hyväksyntänäyttö kirjattu yllä; koko T3:n
ja täsmällisen PR/main-revision portit ovat edelleen avoinna.

**Goal-työkalun tila:** aktiivinen, varmennettu takaisinluvulla. Aiempi
`blocked`-tila ja sen aikainen API:n jatkamisrajoitus säilyvät historiatietona,
eivät nykyisenä etenemisesteenä. Työkalun tila ja T3/R28:n
toteutus-/hyväksyntätila ovat eri asioita; Goalia ei merkitä valmiiksi.

**Aiempi päätös 2026-09-27:** omistaja hyväksyi varhaisen Electron-
prosessihavainnon, rajatun read-only-pipe-peer-sidonnan ja rekisteröinti/GO-
portin toteutuksen sekä testit. Toteutus etenee E2E-kerroksessa ilman
tuotantomuutosta, uutta riippuvuutta tai aikarajojen lievennystä.
Fixturen siirto vaatii edelleen sopimus- ja oikeaprosessinäytön;
Chromiumin ja paikallisen Linuxin valinnat säilyvät avoimina.

**Edellinen päätös 2026-09-27:** omistaja hyväksyi suoran Windows-EXE-käynnistyksen
rajatun käyttöönoton nykyiseen Playwright-patchiin sekä regressiot ja
oikeat Windows-kokeet. Käyttöönoton päätös on siten tehty;
korjauksen todennus ja pääfixturen myöhempi siirto ovat erillisiä portteja.
Uutta riippuvuutta, versiopäivitystä, sovellusmuutosta tai aikarajojen
lievennystä ei tehdä. Chromiumin ja paikallisen Linuxin avoimet valinnat säilyvät.

Alla oleva koehistoria selittää päätökset, mutta ei muuta tätä nykyistä
työjärjestystä. Tarkista Git- ja CI-tila uudelleen ennen jatkamista;
vanha vihreä ajo tai alemman tason testimäärä ei hyväksy uutta revisiota.

## Tila ja valtuus

Omistajan hyväksymä suunnittelu-Goal, valmisteltu ja katselmoitu 2026-09-24. Tämä dokumentti
omistaa M1:n rajauksen ja toteutukseen siirtymisen portin. Julkaisun sisältö
ja työpakettien kokonaistila pysyvät [roadmapissa](release-0.3.0-plan.md).
Omistavat dokumentit alla määrittävät tarkat ehdot, eivät rinnakkaista backlogia.

Valmistelu ei toteuta sovellus- tai testikoodia, schemaa, riippuvuuksia,
versiota, CI-politiikkaa tai uusia turvallisuus-/liiketoimintasopimuksia.
Toteutus aloitetaan rajatun suunnitelman hyväksynnän jälkeen. Yksittäisen
päätösportin keskeneräisyys ei estä muun riippumattoman palan valmistelua.

**T1a/T1b 2026-09-25: toteutettu ja hyväksytty PR/main-porttien jälkeen.** Omistaja hyväksyi
vain alla rajatun testien ajokytkennän ja sen regressiosuojan sekä normaalin
PR/main-integraation vaadittujen porttien jälkeen. T2/T3/A/W7 eivät kuulu
tähän toteutus-Goaliin. Suunnittelu säilyy erillisenä checkpointina;
toteutuksen näyttö ja valmistuneen integraation viite ovat alla.

**T2 2026-09-25: toteutettu ja hyväksytty PR/main-porttien jälkeen.** Komentovalinta,
build-esiehdot ja regressiosuoja on toteutettu hyväksytyn
suunnitelman mukaan. Linux-CI ja täsmällisen merge-revision portit läpäisivät.
[Toteutusportti](#t2n-toteutukseen-siirtymisen-portti) erottaa tämän
T1:n hyväksynnästä sekä T3:n ja tuotantokorjausten jatkotyöstä.

**T3 2026-09-25: T3a-koe suoritettu; neljä tapausta läpäisi, yksi hylättiin.**
[Koetulos ja jatkopäätös](e2e-test-environment.md#t3an-tulos-ja-jatkopäätös)
koskevat vain rajattua toteutettavuuskoetta. Varsinainen
Windows-/POSIX-/Electron-omistajuusratkaisu ja tavallisten testien siirto
päätetään edelleen erikseen kokeen näytön perusteella.
Omistajan hyväksymä [T3b-valmistelu](e2e-test-environment.md#t3b-virhehaaran-ja-alustarajan-valmistelu)
rajaa Electronin virheketjun, Linuxin read-only-CI-proben ja alustojen
jatkopäätökset. Valmistelun jälkeen hyväksytty T3b-L:n probe ja CI-kytkentä
on toteutettu ja CI-sopimuskorjauksen uusi kokonaisajo on läpäissyt.
Riippuvuuskorjaus hyväksyttiin myöhemmin erikseen; paikalliset regressiot ja
rajattu Windows-CI ovat läpäisseet. Myös uusi
[normaali baseline](e2e-test-environment.md#t3b-en-vihreä-normaali-baseline)
on hyväksytty; koko T3/R28 ja PR/main-integraatio ovat vielä avoinna.

**T3c 2026-09-26:** Windowsin erillinen neljän tapauksen adapterikoe
[läpäisi rajatut hyväksyntäehdot](e2e-test-environment.md#t3c-wn-rajatun-kokeen-checkpoint).
Linuxin ensimmäisen CI-ajon molemmat kokeet
[hylättiin ennen GO:ta](e2e-test-environment.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys);
käynnistysvirheen tarkka syy on avoin. Lopullinen mekanismivalinta ja tavallisten
fixturejen siirto edellyttävät edelleen erillistä hyväksyntää.

**T3:n jatko-Goal 2026-09-25:** omistaja hyväksyi T3b-L:n toteutuksen ja
yhden seuratun CI-ajon sekä itsenäisen etenemisen T3:n loppuun erilliset
päätösportit säilyttäen. [Toteutusvaltuus](e2e-test-environment.md#t3b-ln-toteutusvaltuus)
ei itsessään hyväksynyt riippuvuuskorjausta tai alustamekanismeja.
Riippuvuuspatchin myöhempi erillinen päätös on kirjattu omistavaan checkpointiin.
Toteutus ja näyttö kirjataan omiin checkpointteihinsa, ei valmistelun läpäisyiksi.

## T3:n nykyinen työjärjestys

**Nykyinen jäljellä oleva sulkulista 2026-09-27.** Valtuus koskee koko
T3/R28:aa ja sen PR/main-integraatiota, ei kaikkia 0.3.0:n ominaisuuksia.
Tämä ei luo uusia alavaiheita; tarkat sopimukset pysyvät omistavassa
[E2E-suunnitelmassa](e2e-test-environment.md#t3n-oikeiden-kuluttajien-siirtoraja).

- [ ] **Electronin oikeat kuluttajat:** patchin ja neljän käynnistys-/ikkunakokeen
  lisäksi erilliset caller-/owner-loss-, relaunch- ja toinen instanssi -kokeet
  on hyväksytty. Pääfixturen normaali kytkentä, kohdesopimukset 186/186,
  E2E-tyyppitarkistus ja tavallinen Electron 45/45 on todennettu samalle
  lähdetilalle. Varsinaisen fixturen julkisen close-virheen ja portin
  vapautumisen epävarmuuden pysyvät restart-/poistoestot on todennettu
  rajatuilla oikeaprosessikokeilla. Koko launch-/katkeamismatriisi ja erillinen
  endurance ovat vielä avoinna. Säilytä suorien bootstrap-/toinen instanssi-
  kuluttajien kattavuus; erillinen endurance ei sisälly tavalliseen sarjaan.
- [x] **Handoff-testin virhesiivous:** olemassa oleva rajattu lapsikahvan
  omistus, alkuperäinen viiden sekunnin testiraja ja todellinen close.
  Kuusi oikeaprosessitapausta ja 24/24-kohdesarja läpäisivät; katselmus
  ja lähdesidonnan takaisinluku hyväksytty. Ei tuotannon handoff-muutosta
  eikä koko installer- tai T3-portin hyväksyntä.
- [ ] **Chromiumin rajaus ja siirto:** ratkaise omistajan kanssa avoin
  [worker- vai testikohtaisen puun valinta](e2e-test-environment.md#chromiumin-kuluttajasiirron-avoin-omistajuusraja)
  ennen sen vaikutusalueen toteutusta. Todista oikea selain, elävän selaimen
  owner-loss, context/page, trace/screenshot ja juurten turvallinen siivous;
  backendin/Viten siirto tai aiempi yhteensopivuuskoe ei omista selainta.
- [ ] **Linuxin oikeat kuluttajat:** siirrä system/web-kuluttajat hyväksytyn
  CI-mekanismin piiriin oikealla runtime-identiteetillä ja alkuperäisillä
  määräajoilla; todista restart-, failure- ja endurance-polut. Paikallisen
  Linux-tuen ja paikallisen Windows-testauksen + Linux-CI:n riittävyyden
  ympäristöpäätös on avoin; ei hostin oikeusmuutosta tai paikallispolun
  hiljaista poistamista. LM-koetyökuorma ei ole kuluttajasiirron näyttö.
- [ ] **Korvatun toteutuksen poisto:** tarkista ajantasaiset kutsureunat ja
  poista korvattu aktiivinen omistajuus-/cleanup-polku vasta saman revision
  vastaavan kattavuuden jälkeen. Ei PID-/root-only-fallbackia tai kahta
  cleanup-omistajaa. Windowsin taskkill-varapolku ja sen kolme korvattua
  testiä on poistettu, ja legacy-apuri torjuu Windowsin ennen tilan lukua.
  Poiston jälkeinen tyyppitarkistus ja kanoninen system 607/607 läpäisivät.
  Linuxin haara ja sen myöhempi poisto pysyvät erillisen siirron vastuulla.
  Historialliset hylkäystodisteet säilyvät erillisinä.
- [ ] **Koko T3 ja PR/main:** täytä lyhentämättä
  [lopullinen T3-portti](e2e-test-environment.md#t3n-lopullinen-hyväksyntänäyttö)
  ja [pysyvä matriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus),
  myös handoff-/epävarmuuspolut, T1/T2, kohdetestit, workspace/typecheck,
  build-esiehdot, Linux system/web, Windows Electron ja muuttuneen
  Windows-primitiivin installer-regressiot. Säilytä nykyinen riskikadenssi,
  riippuvuustarkistus, katselmukset, julkaisuraja, ajoseuranta ja ensimmäisen
  virheen näyttö. Täsmällisen PR-revision ja merge-commitin omat vaaditut
  portit ratkaisevat sulun; pending, cancelled, flaky tai epäonnistunut ajo
  ei kelpaa. Vasta tämän jälkeen jatketaan M1:n sovelluskorjauksiin.

### T3:n etenemishistoria

Seuraavat revisionkohtaiset checkpointit säilytetään päätösten ja
virhetodisteiden jäljitettävyyttä varten. Niiden suhteelliset ilmaukset
kuten "nyt" tarkoittavat kyseisen checkpointin hetkeä.

1. **Hyväksytty lähtötila:** revision
   `1953b6b05dd7bdd4aaea24b509416fafa353d1ce` normaali V2-ajo ja
   riippuvuustarkistus läpäisivät ensimmäisellä yrityksellä.
   [Baselinen näyttö](e2e-test-environment.md#t3b-en-vihreä-normaali-baseline)
   kattaa saman ajon kaikki valitut jobit, Electronin 38/38 ilman flaky-tuloksia
   sekä producerien ja consumerien artifact-sidonnat. Tämä avaa T3b-P:n,
   ei hyväksy koko T3:a eikä ratkaise aiempia virheitä.
2. **Säilyvä virhetutkimus:** säilytä
   [toistunut firstWindow-hylkäys](e2e-test-environment.md#t3b-en-toistunut-firstwindow-hylkäys-ja-backendstart-rajaus)
   omana havaintonaan. Sen näyttö todistaa testibackendin päässeen
   `backendStart`-vaiheeseen, ei sisäisen käynnistystyön valmistumista.
   [Rollback-sopimushylkäys](e2e-test-environment.md#t3b-en-normaalin-baselinen-rollback-sopimushylkäys),
   [aiempi legacy-smoken hylkäys](e2e-test-environment.md#t3b-en-kokonaisajon-legacy-hylkäys)
   ja aiempi, suppeammin havaittu firstWindow-yritys pysyvät erillisinä
   havaintoina. Samassa katselmuksessa löydetty pending-close-siivouspuute
   kuuluu T3:n cleanup-regressioon, ei näiden timeoutien todistetuksi syyksi.
   Selvitä ennen jokaista uutta ajoa jo kerätyn näytön riittävyys. Jos tarvittava
   tieto puuttuu, rajaa sen turvallinen tallennus ja regressio ensin.
   Älä muuta jäädytettyä lähtöversiota, pidennä aikarajoja tai hae vihreää uusimalla.
   Suljettu `smokeFailureClass`-tarkennus ja sen 73/73 kohdetestin näyttö on
   toteutettu. Katselmus ja yksi saman artifactin kohdekoe läpäisivät,
   mutta alkuperäinen virhe ei toistunut. Diagnostiikkakorjaus ei ratkaise
   vanhaa juurisyytä.
   Rollback-havainnon suljettu tulos- ja vaiheraportointi on toteutettu,
   katselmoitu ja todennettu 18/18 Windows-prosessisopimuksella sekä 66/66
   testikytkentä-/validaattoritestillä. Edellinen kokonaisajo päättyi hylättynä;
   diagnostiikkarevision normaali CI todensi nämä 18/18 sopimusta ja niiden
   tulosrivit, mutta hylkäsi kaksi Electronin firstWindow-ensiyritystä.
   [Rajattu backend-lokihavainto](e2e-test-environment.md#t3b-en-rajattu-backend-lokihavainto)
   säilyttää ensimmäisen launch-virheen jo kirjoitetut vaiheet ennen
   fixture-siivousta. Toteutus ja writerista liitteeseen ulottuva regressio
   pysyvät testikerroksessa. Kohdesarja läpäisi 52/52, koko työtilan normaalit
   testit ja tyypitys läpäisivät, ja riippumaton katselmus ei löytänyt
   korjattavaa. Kohdassa 1 hyväksytyssä normaalissa ajossa launch-virhe ei
   toistunut: uuden lokihavainnon virheketjun näyttö pysyy sopimustesteissä,
   eikä eri ajojen osatuloksia yhdistetä hyväksynnäksi.
3. **Valmis lähtötila:** hyväksytyn T3b-P:n metatietorajaus on toteutettu ja katselmoitu;
   kohdesarja, normaalit testit ja tyypitys läpäisivät. Uusi eristetty build,
   sisältöportit ja samoihin tavuihin sidottu kaksivaiheinen packaged smoke
   läpäisivät molempien prosessipuiden päättymistodistein
   [omistavan sopimuksen mukaan](e2e-test-environment.md#t3b-p-hyväksytty-metatietorajaus).
   Uuden revision normaali CI havaitsi erillisen
   [komentoharnessin sopimushylkäyksen](e2e-test-environment.md#t3b-pn-ci-sopimushylkäys-ja-havaintokytkentä).
   Sen rajattu havaintokytkennän korjaus on katselmoitu ja paikallisesti
   todennettu. Revision `a1df082c` normaali CI ja riippuvuustarkistus
   läpäisivät ensimmäisellä yrityksellä; kaikki valitut jobit sekä
   producerien ja consumerien artifact-sidonnat varmistettiin.
   Tämä on uusi hyväksytty CI-lähtötila, ei keskeytymisen juurisyyn ratkaisu
   tai PR/main-hyväksyntä. Tuotantotoimintoja ei lisätä tähän.
4. **Nyt:** T3c-W:n neljä rajattua koetta läpäisivät. Ajurin root-first-
   odotusjärjestyskorjaus on todennettu; perityn tulostekahvan aiempaa
   kirjoittajaidentiteettiä tai ensimmäisen ennen launchia tapahtuneen
   hylkäyksen syytä ei ole todistettu. T3c-L:n ensimmäiset molemmat CI-kokeet
   hylättiin ennen GO:ta. Säilytä alkuperäinen näyttö, rajaa puuttuva turvallinen
   käynnistyshavainto ja ratkaise jatkokokeen portti ennen uutta ajoa.
   [T3c-LD:n rajattu ehdotus](e2e-test-environment.md#t3c-ld-rajatun-käynnistysdiagnostiikan-päätösehdotus)
   hyväksyttiin 2026-09-26. Toteutus, regressiot ja riippumaton katselmus
   läpäisivät. [Uusi CI-havainto](e2e-test-environment.md#t3c-ldn-rajatun-ci-kokeen-havainto)
   rajaa molemmat hylkäykset wrapperin exit 1:een ennen READYä, ilman
   init-merkkiä tai READY-budjetin ylitystä. Tarkka syy on avoin;
   koko ajo päättyi hylätyksi, mutta muut testiryhmät läpäisivät.
   [T3c-LS:n suljetun stderr-luokan tarkennus](e2e-test-environment.md#t3c-ls-suljetun-stderr-luokan-tarkennuksen-päätösehdotus)
   on hyväksytty 2026-09-26. Toteutus, testit, lukuketju ja riippumaton
   katselmus läpäisivät. [Yhden uuden CI-kierroksen Linux-havainto](e2e-test-environment.md#t3c-lsn-rajatun-ci-kokeen-havainto)
   tunnisti molemmissa kuluttajissa `uid_map`-kirjoituseston ennen READYä ja
   GO:ta. Taustapolitiikan syy on avoin; alkuperäinen hylkäys säilyy.
   Kokonaisajo päättyi hylätyksi vain näiden kokeiden ja aggregaatin vuoksi;
   muut testiryhmät ja riippuvuustarkistus läpäisivät. Omistaja hyväksyi
   [T3c-LM:n rajatun CI-session hallinnan](e2e-test-environment.md#t3c-lm-rajattu-ci-testisession-hallinta)
   suunnittelun ja toteutuksen ilman toistuvia välikyselyjä hyväksytyn
   Goalin sisällä. Puhtaat sopimukset ja injektoitu kontrolli-/init-kytkentä
   ovat katselmoituja: E2E 273/273, workspace 4 220 läpäisyä ja 8 ennestään
   ohitettua sekä tyypitys läpäisty. Managerin suoritin, kokonaisajuri ja
   uusi rajattu CI-koe puuttuvat; vanha LS-näyttö säilyy hylättynä. Mekanismin todellinen
   saatavuus, omistajan katoaminen, Chromium ja tavallisten fixturejen
   siirto ovat vielä todentamatta. Ei hostin suojausmuutosta,
   riippuvuuslisäystä tai hyväksyntäehtojen lievennystä.
5. **T3:n valmistuminen:** koko omistajuusmatriisi, katselmukset ja normaali
   PR/main-integraatio; vasta täsmällisen main-revision portit sulkevat R28:n.

Tavalliset hyväksytyn rajauksen korjaus-, testi- ja dokumentointiaskeleet
jatkuvat itsenäisesti. Erilliset riippuvuus-, oikeus- ja arkkitehtuuripäätökset
säilyvät projektin yleisten ohjeiden mukaisina. A:n toiminnalliset korjaukset
ja muut 0.3.0-paketit eivät korvaa kesken olevaa T3:a.

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
| T1a / R27 | Startup-failure-testit tavalliseen desktop-testivalintaan ja valinnan regressiosopimus. | Hyväksytty; paikallisen näytön lisäksi PR/main-portit läpäisty. Ei tuotantokoodia. |
| T1b / R27 | Kuusi puuttuvaa installer-harness-testitiedostoa nykyisten vaadittujen komentojen kautta ajettaviksi, myös ajokytkentää suojaava testi. | Hyväksytty T1a:n kanssa; R27 suljettu. Ei raskaan CI:n kevennystä. |
| T2 / R29 | `security`/`fault`-projektivalinnan ja koko build-ketjun vastaavuus puhtaasta, vanhentuneesta ja epäonnistuneesta valmistelusta. | Hyväksytty; paikallinen näyttö, Linux-CI sekä PR/main-portit läpäisty. [Integraatio](#t2n-integraatiohyväksyntä). |
| T3 / R28 | Omistajuus käynnistyksestä todettuun koko puun poistumiseen; epävarma cleanup ei hyväksy restartia tai poista fixtureä. | T3c-W:n rajattu koe 4/4 läpäisty; T3c-L:n ensimmäiset molemmat CI-kokeet hylätty ennen GO:ta, tarkka syy avoin. [Checkpoint](e2e-test-environment.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys) erottaa kokeen lopullisesta mekanismivalinnasta ja fixture-siirrosta. R28 sekä PR/main-portit avoinna; historiallisia hylkäyksiä ei muuteta. |
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

R27:n integraatio on hyväksytty
[PR #276:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/276#issuecomment-5822861572).
Se yksilöi PR-headin, todellisen checkoutin, ajot ja yritykset sekä
valitut required-portit. Normaali merge tuotti main-revision
`da896643d5cc1895174e508bee4f6141f4489d56`, jonka oma
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36064323922) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36064323269)
läpäisivät ensimmäisellä yrityksellä. Paikallinen/etäinen main, ajot ja
checkpoint luettiin uudelleen T2-valmistelun alussa 2026-09-25.
T2/R29, T3/R28, A ja W7 pysyvät erillisinä avoimina jatkopaloina.

## T2:n toteutukseen siirtymisen portti

Omistaja hyväksyi 2026-09-25 seuraavaksi rajatuksi toteutus-Goaliksi
[T2:n projektivalinta ja valmistelu](e2e-test-environment.md#t2-projektivalinta-ja-valmistelu):

- Molemmat tagiaggregaatit käyttävät nykyistä täydellistä Electron-
  valmistelua ja nimeävät kolme standardiprojektia. Ei uutta runneria.
- Korjataan `endurance-baseline`-valinnan hakemistoraja, jotta se ei ota
  myös `electron-stress`-tapauksia. Desktop-stress ja soak säilyvät omissa
  komennoissaan; niiden kestoa tai testejä ei vähennetä.
- Lisätään E2E-paketin Node-ajokytkentäsopimus ja oikeaa Playwright-
  konfiguraatiota käyttävä system-sopimus. Varsinainen discovery sekä
  puhdas/vanhentunut/epäonnistunut valmistelu todennetaan erikseen.
- Molempien juurialiasten todellinen ajotodistus, katselmointi, normaali
  PR-integraatio ja uuden main-revision omat required-portit.

Hyväksyntä kattaa myös löydetyn endurance-päällekkäisyyden korjauksen.
Ei tuotantokoodia, riippuvuuslisäyksiä,
versionnostoa, aikarajamuutoksia tai CI-vaatimusten kevennystä.
Build-/staging-toteutuksen mahdollinen lisäkorjaus tai T3:n prosessiomistus
ei tule hyväksytyksi sivuvaikutuksena. Tuntematon siivoustulos keskeyttää
kyseisen ajon hyväksynnän; vihreä T2 ei sulje T3:a.

Suunnittelun näyttö oli lähdekatselmus, ei testitulos. Toteutuksen
[T2-rivien](r0-e2e-test-matrix.md#t2-testivalinnan-ja-valmistelun-sopimukset)
paikallinen näyttö ja valmistunut integraatioportti ovat alla. Lähtörevisio on yllä varmennettu
T1-main; se ja työpuun muutokset tarkistettiin uudelleen toteutuksen alussa.

### T2-valmistelun checkpoint

2026-09-25: komentoketju ja tuotteiden kuluttajat tarkistettu lähteistä;
erillinen read-only-agentti tarkisti projektien ja tagien valinnan sekä
valmiin neljän dokumentin suunnitelmadiffin. Katselmuksessa ei jäänyt
korjattavia huomautuksia. Muutettujen dokumenttien 67 suhteellista linkkiä,
otsikkoankkurit ja kuusi ohjeiden lukureittiä tarkistettiin; diffin muotoilu
ja julkaistavan sisällön yksityisyys tarkistettiin. Ei buildia, discoverya,
testiajoa tai T2-integraatiota. Tämä päättää suunnittelun, ei toteutusporttia.

### T2:n toteutus ja paikallinen näyttö

Toteutusrevisio on `aada2b67c6353a54b96c629cb90652fb7f3f5834`.
Security/fault käyttää nyt yhteistä täydellistä valmistelua ja kolmea
standardiprojektia. Baseline-stressin hakemistoraja ei enää valitse
desktop-endurancea. Valintoja, aikarajoja, toistoja tai CI-ehtoja ei kevennetty.

| Tarkistus | Tulos ja rajaus |
| --- | --- |
| Node-ajokytkentäsopimus | 20/20 läpäisi sekä oman pnpm-komennon että workspace-testiketjun kautta. Kielteiset manifestimuutokset ja jokaisen nimetyn valmisteluvaiheen pysähtyminen testattiin inertillä komentofixturellä. Tämä ei korvaa oikeaa build-koetta. |
| Konfiguraatiosopimus | 9/9 oikeaa konfiguraatiota käyttävää tapausta läpäisi normaalissa ja CI-moodissa. Paikallinen CI-moodi ei ole Linux-CI:n todistus. |
| Todellinen discovery | Kymmenen ennen/jälkeen-valinnan tarkka jäsenyys tarkistettiin. Ainoat erot: uudet sopimustapaukset ja kaksi desktop-endurance-tapausta pois väärästä baseline-projektista. Desktop-stress/soak säilyivät omissa valinnoissaan. |
| Puhdas valmistelu ja aggregaatit | Molemmat juurialiakset suoritettiin erikseen ilman aiempia build-/stage-tuotteita synteettisessä Windows-koeympäristössä. Security 141/141, fault 17/17; ei ohituksia, retryjä tai flaky-tuloksia. Vain raportointia täydennettiin erillisiä todisteita varten. |
| Vanhentuneet tuotteet | Kahdeksan tuoteryhmän tunnistettava vanha sisältö korvautui ja ylimääräiset sentinelit poistuivat. Oikean runtime-materialisoijan kopioiden sisältö vastasi uudelleen rakennettuja tuotteita; pelkkää mtimea ei käytetty. |
| Oikea valmisteluvirhe | Hallittu käännösvirhe pysäytti security-ketjun ennen myöhempiä vaiheita. Erillinen hallittu staging-tiedostolukko pysäytti fault-ketjun. Vanha stage oli olemassa, mutta Playwright ei käynnistynyt. Alkuperäiset virheet säilytettiin eikä näitä ajoja nimetty testiläpäisyiksi. |
| Workspace | Nykyinen `pnpm test` ja koko workspacen typecheck läpäisivät. Buildit ja staging todennettiin yllä olevilla oikeilla valmisteluajoilla. Olemassa olevia alustakohtaisia unit-ohituksia ei muutettu. |
| Katselmointi | Riippumaton koodikatselmointi: POSIX-fixturepolun lainaus korjattiin ja erikoismerkkipolku lisättiin regressioksi. Ensimmäisen kohdeajon Windows-lainausvirhe ja uuden specin tyypitysvirhe korjattiin ennen hyväksyttyjä ajoja; alkuperäinen näyttö säilytettiin. |

Ajoja seurattiin alusta loppuun; aggregateilla oli myös riippumaton
lukuseuranta. Todellisen Electron first-start -tapauksen siivousliite
vahvisti nykyisen fixturen cleanupin, portin vapautuksen ja juuren poiston.
Tämä ei todista koko prosessipuun omistajuuden T3-puutetta korjatuksi.
Raakatulosteet, synteettiset koealueet ja yksityiskohtaiset paikalliset
todisteet pysyvät Gitistä ohitettuina.

Tuotantokoodi, UI-ilmoitukset, Diagnostics/Activity, tukipaketti, backup-
formaatti ja tietokantamigraatiot eivät muutu. Siksi tuotannon packaged
backup/restore-porttia tai uutta asennuspakettia ei tuoteta T2:ssa.
Koodin peruminen ei ole testiprosessin siivouskeino. Uusia riippuvuuksia,
versionnostoa tai lukitustiedoston muutosta ei ole.

### T2:n integraatiohyväksyntä

R29 on hyväksytty [PR #277:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/277#issuecomment-5826768078).
Hyväksytty lähde on `6b323284bf671ad684e8b5774d22bc566cf709c2`,
todellinen PR-checkout `0714504914cd1b43c4fae73bfb3da0cbd39c0e14`
ja normaali merge `5cc58b7139a6616bc9403a5724f93d929e90cf25`.
Checkpoint erottaa paikalliset aggregaatit, Linuxin Node-/system-sopimukset
sekä PR:n ja mainin omat portit. Mainin
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36094675603) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36094675166)
läpäisivät ensimmäisellä yrityksellä. Paikallinen/etäinen main, merge,
ajojen revisio ja valmistunut tila sekä checkpoint tarkistettiin uudelleen
T3-valmistelun alussa. T3/R28, A ja W7 jäävät avoimiksi.

## T3:n toteutukseen siirtymisen portti

2026-09-25: omistaja salli suunnittelun ja toteutuksen ilman uutta kysymystä,
jos uusia hyväksyttäviä päätöksiä ei tarvita. T3:n aiemmin nimetty
omistajuusmekanismin päätös on kuitenkin avoin. Tätä ehtoa ei tulkita
Windowsin installer-supervisorin yleiskäyttöluvan tai Linuxin uuden
alustavaatimuksen hyväksynnäksi.

[Omistava T3-suunnitelma](e2e-test-environment.md#t3-koko-prosessipuun-poistumistodiste)
sisältää lähdehavainnot, kuluttajaluettelon, vaihtoehdot ja hyväksyntätestit.
Windowsin Job-primitiivejä voidaan selvittää uudelleenkäytettäviksi, mutta
nykyinen installerin batch-protokolla ei ole elävän E2E-session rajapinta.
Electronin launchia ei voi nimetä launch-hetkestä omistetuksi pelkän
myöhemmin saadun prosessikahvan perusteella. Linuxin nykyiset CI-kuluttajat
tarvitsevat oman todistettavan ratkaisunsa.

**Omistajan hyväksyntä 2026-09-25: vain T3a-toteutettavuuskoe.** Se kattaa
erillisen test-only Windows Job -session ja Electron-liitännän kokeen
nykyisellä työkalupohjalla sekä Linux-edellytysten read-only-tarkistuksen.
Ei uusia riippuvuuksia, tuotantokoodia, installerin nykyisen protokollan
muutosta, tavallisten fixturejen siirtoa, pidempiä aikarajoja, kevyempiä
CI-ehtoja tai koneen suojaus-/palveluasetusten muutosta.
Linuxin cgroup-kirjoitukset, systemd-palvelu, delegointi, oikeusmuutos tai
uusi native-toolchain eivät kuulu tähän hyväksyntään. Tarvittava täsmällinen
jatkopäätös valmistellaan näytön perusteella ennen niitä.

Kokeen lähteet rajataan `apps/e2e/experiments/processOwnership`-alueelle.
Nykyisiä Job-primitiivejä käytetään muuttamatta installerin lähteitä tai
protokollaa. Erillinen session omistaja käynnistää synteettisen Node-puun
tai Playwright/Electron-ajurin ennen työkuorman suoritusta omistettuun
Jobiin. Ajurin omistaminen ei vielä ole tavallisen Electron-fixturen
läpinäkyvä adapteri. Koe raportoi tämän rajan ja `process()`-kahvan
todellisen merkityksen; käyttöönottoa ei päätellä pelkästä launch-läpäisystä.
Pääagentti vastaa ajoseurannasta ja ensimmäisen virheen säilyttämisestä.
Koedata ja tulokset pidetään eristetyssä temp-juuressa, paikallinen näyttö
Gitistä ohitettuna. Kokeelle ei lisätä tavallisen testikomennon tai CI:n
automaattista ajokytkentää.

T3a:n valmistuminen tarkoittaa päätöskelpoista näyttöä valituista
mekanismeista ja niiden rajoista, ei R28:n korjausta. Varsinaisen siirron
portti vaatii omistajan hyväksymät alustamekanismit, session/stop-
sopimuksen, tiedostorajat, build-esiehdot ja omistavan suunnitelman testit.
Alkuperäisessä suunnittelussa ei tehty koodimuutoksia tai oikeaprosessikokeita.
Myöhemmän hyväksytyn kokeen todellinen näyttö on
[T3a-tuloskirjauksessa](e2e-test-environment.md#t3an-tulos-ja-jatkopäätös).
Se ei ole sovelluksen julkaisu- tai integraatiohyväksyntä.

### T3-valmistelun checkpoint

2026-09-25: Windowsin ja Linuxin vaihtoehdot sekä lopullinen neljän
dokumentin suunnitelmadiffi katselmoitiin kahdella erillisellä read-only-
agentilla. Katselmuksiin ei jäänyt korjattavia huomautuksia. Muuttuneiden
dokumenttien 79 suhteellista linkkiä ja niiden otsikkoankkurit sekä diffin
muotoilu ja julkaistavan sisällön yksityisyys tarkistettiin.
T2:n integraatiotila varmistettiin uudelleen; aiempia testituloksia ei ajettu
uudelleen tässä dokumentointivaiheessa. T3a odotti silloin omistajan päätöstä;
yllä kirjattu myöhempi hyväksyntä koskee vain erillistä koetta.
Tämä päättää vain valmistelun, ei T3:n toteutusta tai R28:n hyväksyntää.

### T3a-kokeen checkpoint

2026-09-25: erillinen test-only-koe ja tuloskirjaus katselmoitu kahdella
aliagentilla. Katselmuksessa korjattiin testityökuorman temp-rajaus,
havaintojen odotus, hätäkatkaisun epävarman tilan raportointi ja myöhäisen
tuloksen hyväksymisriski. Koetuloksen sanamuoto ja vanhentunut tilateksti
korjattiin. Viiden muuttuneen ohjetiedoston 84 suhteellista linkkiä ja
otsikkoankkuria sekä diffin muotoilu ja julkaistavan sisällön rajaus
tarkistettiin. Tämä checkpoint säilyttää myös hylätyn koetapauksen ja
jatkopäätökset; se ei ole kaikkien kokeiden, tavallisten fixturejen tai
PR/main-integraation hyväksyntä.

### T3b-valmistelun checkpoint

2026-09-25: lukitun Playwrightin virheketju, Windowsin vaihtoehdot ja
Linux-CI:n read-only-probe valmisteltu ja katselmoitu kahdella read-only-
aliagentilla. Katselmuksiin ei jäänyt korjattavia huomautuksia.
Dokumenttien 89 suhteellista linkkiä ja otsikkoankkuria, diffin muotoilu
sekä julkaistavan sisällön yksityisyys tarkistettiin. Tuotanto-, testi-,
riippuvuus- ja workflow-koodia ei muutettu eikä uusia prosessikokeita tai
CI-ajoja tehty. Sovelluksen testi-, diagnostiikka- ja palautusportit eivät
sovellu tähän dokumentointimuutokseen, eikä niitä merkitä läpäistyiksi.
Tämä päätti vain rajatun valmistelun; T3b-E/T3b-L:n toteutuspäätökset,
alustamekanismi ja R28:n hyväksyntä jäivät silloin avoimiksi. Myöhemmät
päätökset ja toteutustila kirjataan alla oleviin checkpointteihin.

### T3b-L:n paikallinen checkpoint

2026-09-25: read-only-probe ja oletuksena suljettu CI-kytkentä toteutettu.
`pnpm test:ci` läpäisi 95/95 ilman ohituksia. Kytkennän ja lukijan
katselmukset sekä havaitun stdout-aikarajajärjestyksen korjaus kuuluvat
[omistavaan checkpointiin](e2e-test-environment.md#t3b-ln-toteutuscheckpoint).
Todellinen Linux-CI-havainto ja yksi hyväksytty seurattu kokonaisajo olivat
tässä vaiheessa vielä avoinna. Tämä ei hyväksy alustamekanismia, riippuvuuspatchia,
fixture-siirtoa, R28:n sulkua tai PR/main-integraatiota.

### T3b-L:n ensimmäinen CI-checkpoint

Molemmat Linux-probet tuottivat täydellisen mutta pääsyvihjeiltään kielteisen
havainnon. Ensimmäinen kokonaisajo hylkäsi desktopin T1-kytkentätestin
vanhentuneen odotuksen. Rajattu korjaus ja sen 61/61-kohdesarja, koko
workspacen 3862 läpäissyttä testiä / kahdeksan aiempaa ohitusta, typecheck
sekä backendin, webin ja desktopin buildit
ovat paikallista näyttöä, eivät tämän CI-revision hyväksyntä.
[Omistava CI-checkpoint](e2e-test-environment.md#t3b-ln-ensimmäinen-ci-havainto-ja-sopimuskorjaus)
erottaa ensimmäisen hylkäyksen ja korjatun revision oman CI-todennuksen:
`0235d7270bde2edf43dc4c998ff9bf86f23ec401`, ajo `36140255216`, yritys 1,
38 onnistunutta jobia ja yksi ennalta valinnainen ohitus, ei hylkäyksiä.
T3b-E:n nimetty patch ja kokeet on nyt hyväksytty; alustamekanismit eivät.

T3b-E:n [paikallinen korjausnäyttö](e2e-test-environment.md#t3b-en-paikallinen-korjausnäyttö)
sisältää todellisen RED -> GREEN -regression sekä nykyiset kaksi hyväksyttyä
Electron-koetta. Koko paikallinen sarja läpäisi 3907 testiä ja säilytti
kahdeksan aikaisempaa ohitusta. Typecheck läpäisi. Payloadin metatietorajan
[erillinen paketointikorjaus](e2e-test-environment.md#t3b-p-hyväksytty-metatietorajaus)
on nyt hyväksytty toteutettavaksi; porttia ei ohiteta pelkän Playwright-koodin
puuttumisen perusteella. Korjauksen toteutus odottaa kuitenkin
[oman CI-revision käynnistysvian selvitystä](e2e-test-environment.md#t3b-en-ensimmäinen-ci-havainto).
Ensimmäisen yrityksen lifecycle-näyttö säilyi: Playwright-yhteys valmistui,
mutta backendin valmiutta ei havaittu ennen ensimmäisen ikkunan timeoutia.
Retry onnistui, mutta flaky-tulos ja kokoava CI-portti hylättiin oikein.
Juurisyytä tai tämän revision baselinea ei ole hyväksytty; T3/R28 ei ole valmis.
Omistaja hyväksyi tämän jälkeen rajatun Electron-vian selvityksen ja
korjauksen. Ensimmäinen checkpoint lisää vain testibackendin suljetun
käynnistysvaiheen havaintoketjun ja sen sopimustestit. Aikarajat,
onnistumisehdot ja tuotantokoodi säilyvät.
[Diagnostiikan paikallinen todennus](e2e-test-environment.md#t3b-en-käynnistysdiagnostiikan-paikallinen-todennus)
läpäisi 33 testin Windows-ajon ilman retryä sekä workspace-testit ja
typecheckin. Alkuperäinen timeout ei toistunut eikä sen juurisyy ratkennut.
Omistaja hyväksyi uuden revision julkaisun kehityshaaraan ja yhden seuratun
Windows-CI-diagnostiikka-ajon. Rajauksen tavalliset commit-, push- ja
CI-työvaiheet eivät vaadi erillistä uusintahyväksyntää.
[Rajattu Windows-CI-todennus](e2e-test-environment.md#t3b-en-rajattu-windows-ci-todennus)
läpäisi revision `cba3fa3db304024c55c76838cd99637d0e1bc0ef` ajossa
`36164733794`: 38 kriittistä testiä ja yksi diagnostiikkatesti ilman
uusintayrityksiä sekä paketointi ja packaged smoke. Timeoutin syy pysyy
avoimena. Rajattu ajo ei korvaa koko V2-baselinea tai aloita T3b-P:tä.

Revision `f007bda2219ad473fc20c3a948b08e4974641451` seuraava
[kokonaisajo](e2e-test-environment.md#t3b-en-kokonaisajon-legacy-hylkäys)
hylättiin historiallisen lähtöversion smoke-vaiheessa. Nykyinen Electron
läpäisi 38/38 ja saman revision riippuvuustarkistus läpäisi. T3b-P ja
alustamekanismien toteutus eivät ala punaisen baselinen päälle.

Linuxin seuraavaksi päätösehdotukseksi on katselmoitu
[rajattu T3c-L:n namespace-koe](e2e-test-environment.md#t3c-ln-rajattu-namespace-koe-päätösehdotus).
Se nimeää valmiin `unshare`-työkalun, namespace-kohtaiset luontioikeudet,
ehdollisen synteettisen kuorman ja rajatun wait-todisteen. Omistaja hyväksyi
toteutuksen ja ajon 2026-09-26. Toteutus ja puhtaat sopimus-/kytkentätestit
läpäisivät, mutta ensimmäisen CI-ajon molemmat varsinaiset kokeet
hylättiin ennen GO:ta. [Hylkäyskirjaus](e2e-test-environment.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys)
erottaa avoimen käynnistysvirheen puuttuvan edellytyksen toteamisesta.
Tämä ei ratkaise koko R28:aa.

Windowsin seuraava päätösehdotus on
[T3c-W:n neljän tapauksen adapterikoe](e2e-test-environment.md#t3c-wn-neljän-tapauksen-adapterikoe-päätösehdotus).
Se rajaa erillisen omistajan, Playwright-bridgen, koekohtaisen native-
builderin ja uuden kokeen apphost-buildin vain jo saatavilla olevin
edellytyksin; puuttuva edellytys pysäyttää ilman asennusta. Omistaja hyväksyi
toteutuksen ja kokeet 2026-09-26. T3b-E ja korjattu CI-lähtötila on todennettu
ympäristösuunnitelman myöhemmissä checkpointeissa. Windowsin neljä tapausta
ovat nyt läpäisseet [rajatun kokeen](e2e-test-environment.md#t3c-wn-rajatun-kokeen-checkpoint).
Native- ja Node-kohdesarjat, komentokytkentä sekä lopullisen lukurajamuutoksen
sisältävät workspace-testit läpäisivät. Typecheck läpäisi ennen viimeistä
JavaScript-muutosta, jonka jälkeen TypeScript-lähteet eivät muuttuneet.
Paikallinen CI-sopimussarja läpäisi 156/156. Windows-koe ei sulje Linuxin puuttuvaa
oikeaprosessinäyttöä, vanhoja satunnaisia timeouteja eikä T3c-W:n ensimmäisen
ennen launchia tapahtuneen hylkäyksen avointa syytä. Lopullinen mekanismi,
fixture-siirto ja koko T3/R28 tarvitsevat erilliset päätökset ja portit.

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
T3a on tutkittu ja sen varhaisen Electron-virheen yhteensopivuusraja kirjattu.
Rajattu T3b-valmistelu nimesi [erilliset päätökset](e2e-test-environment.md#seuraavat-päätökset-ja-työn-järjestys).
Read-only-CI-probe ja täsmällinen riippuvuuspatch on sittemmin hyväksytty;
niille ei pyydetä samoja lupia uudelleen. Probe ei todista cgroupin
kirjoitusoikeutta tai turvallista cleanupia. Nykyinen järjestys on
[T3:n tilakoosteessa](#t3n-nykyinen-työjärjestys).
T3:n omistajuusmekanismi ratkaistaan edelleen ennen tavallisten fixturejen
muutoksia. A1 käyttää nykyistä
feature-/API-sopimusta; jos rajaus vaatii
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
