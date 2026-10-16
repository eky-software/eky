<a id="m1-unit-m1-history-1-715"></a>

> Historical source: [eky_software/docs/architecture/release-0.3.0-m1-history.md:1-715](https://github.com/eky-software/eky/blob/c717406484df0471df23165a7c13db9b3f74c1b6/eky_software/docs/architecture/release-0.3.0-m1-history.md#L1-L715).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-m1-history-l1"></a>

# 0.3.0 M1 -valmistelun historia

Tämä tiedosto säilyttää alkuperäiset valmistelupäätökset ja T1/T2/T3:n
välitulokset. Se ei ole nykyinen työjono tai uusi toteutusvaltuus.
**Aloita [M1:n nykyisestä jatkamiskohdasta](release-0.3.0-integration-history.md#m1-source-preparation-l3).**
Julkaisun sisältö on [roadmapissa](release-0.3.0-plan.md) ja voimassa oleva
testiruntime [E2E-testiympäristössä](e2e-test-environment.md).

Alla olevat nykyinen/seuraava-, avoin- ja Goal-ilmaukset koskevat omaa
checkpointiaan, eivät tämänhetkistä työkalun tai hyväksynnän tilaa.
Testimäärät, hylkäykset ja syyepävarmuudet säilyvät alkuperäisinä;
PR #281:n myöhempi main-hyväksyntä ei muuta vanhaa hylkäystä läpäisyksi.

<a id="m1-source-m1-history-l14"></a>

## Jatka tästä

**T1/T2 ja T3/R28:n toteutus hyväksytty; uudemman mainin portti on hylätty.**
Modulaarinen monoliitti ja hyväksytty M1-rajaus säilyvät.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Hyväksytty toteutus | PR #278:n lähde `52cdaa1755ca2ed68318bd33fd52805a7753235e`; täsmällinen hyväksytty merge-main ja sen omat ajot ovat kohdassa [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä). |
| T3/R28 | Oikeat kuluttajat, korvatun toteutuksen poisto, pysyvä matriisi ja toteutuksen omat PR/main-portit hyväksytty. T1/T2:n sopimukset säilyvät. |
| Näytön rajaus | Tavallinen Windows 781/781 ja kaksi lopullista oikeaprosessitodistetta säilyvät omana näyttönään. Vanhojen revisioiden katalogeja, stressiä tai soakia ei nimetä uuden CI-ajon tuloksiksi. Historiallisten hylkäysten avoimia syitä ei merkitä korjatuiksi. |
| Nykyinen lähtö ja avoin portti | Diagnostiikka-PR #280 hyväksyttiin ja yhdistettiin normaalisti. Main `68b7d5a19258ebc4bfb64d885568f1dadbfe6499`: Windows-prosessisopimusten `earlyHelperExit` hylättiin; oma audit hyväksytty. [Uusi havainto ja rajaus](e2e-test-environment-history.md#rollback-testiapurin-ennenaikaisen-poistumisen-korjaus) erottaa sen aiemmista Electron/legacy-hylkäyksistä. Aiempi toteutushyväksyntä ei korvaa tätä porttia. |
| Seuraava työ | Rajattu rollback-testiapurin kyselyjärjestys on korjattu: todellinen EOF vaaditaan edelleen puuttuvan loppukuittauksen hylkäykseen. Kohderegressio ensin hylätty, korjattuna neljä kohdetestiä, Windows-prosessisopimukset 27/27 ja installer-unitit 113/113 läpäisty; riippumaton katselmus hyväksytty. Seuraavaksi puhtaan lähteen normaali PR ja mergen omat main-portit. Ei sokeaa uusintaa, aikarajamuutosta tai tuotantomuutosta. |
| Tämän jälkeen | Täsmällisen uuden revision normaalien PR/main-porttien jälkeen A1/R01:n rajattu aloitus nykyisen [A1-suunnitelman](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde) ja toiminnon aloitusportin mukaan. Ei A2/A3:n, W7:n tai koko 0.3.0:n toteutusvaltuutta tämän sulun perusteella. |
| Valmistumisen kirjaus | Dokumenttimuutoksen toteutuneet tarkistukset ja integraation lopputulos kirjataan sen PR:n hyväksyntächeckpointiin ja loppuraporttiin; niiden ilmoittamiseksi ei tarvita uutta tilakirjauscommittia. Ennen A1:tä nykyinen main ja sen portit tarkistetaan uudelleen. |

<a id="m1-source-m1-history-l29"></a>

### Integraatiota edeltävä checkpoint 2026-09-28

Alla oleva aiempi jatkamiskohta sekä päätös- ja Goal-tilakirjaukset kuvaavat
omia checkpointtejaan. Niiden nykyinen/seuraava-ilmaukset eivät ole uusia
etenemisesteitä tai nykyisen Goal-työkalun tilaväitteitä. Alkuperäiset
tulokset, määrät ja syyepävarmuudet säilyvät.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Nykyinen lähtörevisio | `7f8df53a16770b5e3206c179ff8f497b76c6cf24`: Linuxin oikeiden kuluttajien rajattu CI hyväksytty. Viimeisin täysi normaali baseline on erillinen `5bbfd483`. Electronin stress, täysi 30 minuutin soak ja virheprioriteettikokeet säilyvät aiempien checkpointtien näyttöinä. Tarkista HEAD ja työpuu ennen jatkamista; aiempi vihreä ajo ei hyväksy myöhempää koodimuutosta. |
| Viimeisin koko CI:n hyväksytty lähtötila | Sama `5bbfd483`: 38 onnistunutta ryhmää ja yksi tarkoituksellinen valinnaisen kokeen ohitus. Kaikki neljä kokeellista valitsinta pois. System 690 valittua, 689 läpäisyä ja yksi Windows-only-suojan tarkoituksellinen ohitus; web 37/37 ja Electron 38/38 ilman retryä tai flaky-tulosta. Koko tapausjoukko, kaikki 38 checkoutia sekä neljän tuottajan ja kymmenen kuluttajan artifact-sidonnat takaisinluettu. Native-sopimukset 515/226/285/1791/60; registry-allekirjoitukset 160/160. Ei PR/main- tai koko T3-hyväksyntä; endurance on erillistä näyttöä. |
| Avoin puute | Hyväksytyt Windows-/Linux-omistajat on kytketty oikeisiin kuluttajiin; pelkkää pääprosessin poistumista ei hyväksytä puun siivoukseksi. Kuluttajamatriisin kohdistettu näyttö, korvattujen aktiivisten Electron-varapolkujen poisto ja tavallinen Windows-regressio ovat hyväksyttyjä. Täsmällisen uuden revision PR/main-portit ovat avoinna. Aiemmat packaged-workspace-timeoutit säilyvät erillisinä ratkaisemattomina havaintoina. |
| Viimeisin rajattu näyttö | [Endurance ja virheprioriteetti](e2e-test-environment-history.md#windows-electronin-endurance-ja-virheen-säilymisen-loppunäyttö): tyypitys, kolme mittauspolun regressiota, kanoninen stress ja täysi 30 minuutin soak läpäisivät. Kaksi todellisen fixturen koetta säilytti tarkoituksellisen alkuperäisen virheen ainoana testivirheenä close-/liitevirheen yli; siivous ja näyttö tarkistettiin erikseen. Ensimmäiset yritykset, sama testikoodi ja raportit on riippumattomasti takaisinluettu. Mittauskorjauksen oma CI on nyt hyväksytty. Aiemmat kuluttaja-, handoff-, workspace- ja CI-portit säilyvät [omassa checkpointissaan](e2e-test-environment-history.md#electron-bridgen-lopetuspolun-jatkoehdotus). Ei koko T3:n hyväksyntä. |
| Nykyinen toteutuspala | Korvatut aktiiviset Electron-varapolut ja kaksi siivousapuria poistettu. Molemmat oikeat käynnistyskohdat torjuvat muut alustat ennen varausten luontia; nykyisen Windows-omistajan 13 sulkutestiä ja alkuperäisen lapsikahvan regressio säilyvät. Kohdesarja 151/151, puhtaat sopimukset 10/10, tyypitys, workspace-testit ja CI-sopimukset läpäisivät. Lopullinen tavallinen Windows-sarja 781/781 (693/43/45) läpäisi ilman retryä, flakyä tai ohituksia. Matriisin late-fork- ja saman ownerin resume-virhekokeet sekä niiden katselmus hyväksytty. Valmistelun rajattu pipe-korjaus: 31/31 ja oikea 25 tarkistuksen koe tavallisen valmistelun kautta. |
| Viimeisin normaali CI | Revision `5bbfd483` [V2 36443256758](https://github.com/eky-software/eky/actions/runs/36443256758), yritys 1, hyväksytty yllä kuvatulla täydellä kattavuudella; ei checkout- tai näyttöaukkoja. [Riippuvuustarkistus 36443266084](https://github.com/eky-software/eky/actions/runs/36443266084) läpäisi ilman tunnettuja audit-löydöksiä, 160 allekirjoitusta varmennettu. |
| Nykyinen diagnoosiraja | Linux-backendin ja Viten alkuperäinen OS-temp-ankkuri on korjattu ja tavallisen CI:n kuluttajanäyttö saatu. Edeltävä `c2bae3a2` [CI](https://github.com/eky-software/eky/actions/runs/36435533813) jäi hylätyksi: Windows-faultin `targetInstall` ylitti aikarajan, supervisor varmisti `cleanupCompleted/processTreeAbsent` ja seuraava binary-rollback-koe jäi ajamatta. Uusi havaintokytkentä ja molemmat fault-kuluttajat läpäisivät `5bbfd483`:lla. Tämä ei ratkaise c2-timeoutin juurisyytä; aiemmat timeoutit säilyvät erillisinä havaintoina. |
| Aiempi Electron-diagnoosi | `23b43c49`: [36350757744](https://github.com/eky-software/eky/actions/runs/36350757744), yritys 1, hylätty; kaikkien 48 lifecycle-liitteen syy `ownerEnvironmentValueInvalid`, todellinen checkout varmennettu. Tarkkaa alkuperäistä ympäristöarvoa ei kerätty. PATH-korjauksen ensimmäinen tavallinen ajo jäi 44/45-tulokseen erillisen ennen testirunkoa tapahtuneen poistumisen vuoksi. Turvallista ensiyrityksen kaappausta täydennettiin; myöhempi kanoninen 45/45 ei todista alkuperäisen poistumisen syytä. |
| Korjauksen paikalliset portit | Vite-jatkokorjauksen käynnistyssopimus ensin 21/22, korjattuna 22/22; Vite-reader 13/13, työkalusarja 740/740, E2E-tyypitys ja Windows-system 690/690 läpäisivät. Riippumaton lähde-/julkaisurajakatselmus hyväksyi rajauksen. Edeltävän backend-korjauksen web 43/43, pakettitestit ja tyypitys säilyvät oman revisionsa näyttönä. Muuttumattomien lähdekoodirajatestien rinnakkaisajon aikakatkaisuja ei merkitä korjatuiksi; CI:n ajotapa ja aikarajat säilyvät. [Omistava checkpoint](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci). |
| Seuraava työ | Viimeistele julkaisurajan tarkistus ja puhtaan lähteen katalogisidonta; etene normaaliin PR-ajoon sekä mergen oman main-revision tarkistuksiin. [Pysyvän T3-matriisin](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus) kohdistetut todisteet säilyvät; muuttumattomia erikoiskokeita ei uusita pelkän tilakirjauksen vuoksi. Ei sokeaa uusintaa, tuotantomuutosta, uusia rajoja tai rinnakkaista remonttia. |
| Valmistuminen | Oikeat kuluttajat siirretty, korvattu aktiivinen toteutus poistettu vasta vastaavan kattavuuden jälkeen, T1/T2 säilyneet sekä koko T3-matriisi ja täsmällisen PR/main-revision portit läpäisty. |
| T3:n jälkeen | Nykyisen M1:n A1:n vanhentuneet vastaukset ja muut hyväksytyt sovelluskorjaukset, sitten roadmapin 0.3.0-käyttöliittymä- ja diagnostiikkatyö. |

**Nykyinen rajattu näyttö:** revision `7f8df53a` manuaalinen
[Linux-ajo 36456205257](https://github.com/eky-software/eky/actions/runs/36456205257),
yritys 1, läpäisi molemmat valitut ryhmät: tavallinen system/web, seitsemän
todellista katkeamista ja erillinen endurance. Lähde- ja katalogisidonnat,
passiivinen puun poistumistodiste, epävarman juuren säilyminen, ulkopuolinen
kontrolliprosessi sekä tavallisen ja endurance-ajon omat worker-siivoamiset
on takaisinluettu. Ei retryä tai flakyä. Tämä rajattu ajo ei korvaa täyttä
normaalia CI:tä tai PR/main-porttia.
[Omistava sopimus ja seitsemän tapausta](e2e-test-environment-history.md#linuxin-todellisten-kuluttajien-katkeamiskokeet)
erottavat näytön seuraavasta korvattujen polkujen poistosta ja sen regressioista.

**28.9. seuraavan työn tarkennus:** ensimmäinen tavallinen Electron-sarja
hylättiin 44/45: yksi `firstWindow/processExited` ennen testirunkoa;
siivous varmistui. Sukupolvikohtainen turvallinen virhekaappaus on nyt
toteutettu ja katselmoitu, ja sen jälkeinen kanoninen sarja läpäisi 45/45
samalla täydellisellä tapausjoukolla. Tyypitys, 136/136-kohdesarja ja
työkalusarja 678/678 läpäisivät samalla koodilla. Hylätty tulos ja sen
syyepävarmuus säilyvät; uusi läpäisy ei ole juurisyytodiste.
Paketin oma normaali CI ja riippuvuustarkistus hyväksyttiin revision
`5f61f186` ensimmäisistä yrityksistä. Sen jälkeen erillinen endurance,
virheprioriteettikokeet ja mittauskorjauksen `ab5de90b` oma CI hyväksyttiin
yllä kuvatusti. Tämä ei hyväksy muita kuluttajasiirtoja tai koko T3:a.

**Windows-välipaketin yhteiset portit 2026-09-27:** varapolun poiston
jälkeinen yhtenäinen lähdetila läpäisi koko workspacen testit ja
tyyppitarkistuksen sekä CI-sopimukset 315/315. Kahdeksan ennestään
alustakohtaista ohitusta säilyi workspacen testeissä; uusia ohituksia ei
lisätty. Tämä täydentää yllä olevaa 607/607-näyttöä. Seuraava riippumaton
askel oli katselmoidun välipaketin normaali CI ennen uusia kuluttajasiirtoja.
Sen Electron-hylkäys säilyy yllä historiassa; baselinen korjaaminen oli
seuraavien siirtojen ehto, ei nykyisen vihreän lähtörevision uusi este.

**Uusin päätös 2026-09-28:** omistaja hyväksyi yhteisen Chromium-selaimen
testikohtaisella eristyksellä sekä paikalliset Windows-testit ja Linux-CI:n.
[Omistava sopimus](e2e-test-environment-history.md#chromiumin-kuluttajasiirron-avoin-omistajuusraja)
erottaa worker-selaimen ja testin datajuuren siivouksen. Goal on jatkettu
aktiiviseksi. Päätös avaa toteutuksen, ei hyväksy tulevaa testinäyttöä tai
uutta riippuvuutta, oikeusmuutosta, timeoutia tai tuotantomuutosta.

**Edeltävä päätös 2026-09-27:** omistaja valtuutti jatkamaan koko nykyisen
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

<a id="m1-source-m1-history-l126"></a>

## Tila ja valtuus

Alla olevat päivätyt valtuudet ja välitulokset säilyvät päätöshistoriana.
Nykyinen hyväksyntä ja seuraava työ ovat kohdassa [Jatka tästä](release-0.3.0-integration-history.md#m1-source-preparation-l3).

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
[Toteutusportti](release-0.3.0-m1-history.md#m1-source-m1-history-l453) erottaa tämän
T1:n hyväksynnästä sekä T3:n ja tuotantokorjausten jatkotyöstä.

**T3 2026-09-25: T3a-koe suoritettu; neljä tapausta läpäisi, yksi hylättiin.**
[Koetulos ja jatkopäätös](e2e-test-environment-history.md#t3an-tulos-ja-jatkopäätös)
koskevat vain rajattua toteutettavuuskoetta. Varsinainen
Windows-/POSIX-/Electron-omistajuusratkaisu ja tavallisten testien siirto
päätetään edelleen erikseen kokeen näytön perusteella.
Omistajan hyväksymä [T3b-valmistelu](e2e-test-environment-history.md#t3b-virhehaaran-ja-alustarajan-valmistelu)
rajaa Electronin virheketjun, Linuxin read-only-CI-proben ja alustojen
jatkopäätökset. Valmistelun jälkeen hyväksytty T3b-L:n probe ja CI-kytkentä
on toteutettu ja CI-sopimuskorjauksen uusi kokonaisajo on läpäissyt.
Riippuvuuskorjaus hyväksyttiin myöhemmin erikseen; paikalliset regressiot ja
rajattu Windows-CI ovat läpäisseet. Myös uusi
[normaali baseline](e2e-test-environment-history.md#t3b-en-vihreä-normaali-baseline)
on hyväksytty; koko T3/R28 ja PR/main-integraatio ovat vielä avoinna.

**T3c 2026-09-26:** Windowsin erillinen neljän tapauksen adapterikoe
[läpäisi rajatut hyväksyntäehdot](e2e-test-environment-history.md#t3c-wn-rajatun-kokeen-checkpoint).
Linuxin ensimmäisen CI-ajon molemmat kokeet
[hylättiin ennen GO:ta](e2e-test-environment-history.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys);
käynnistysvirheen tarkka syy on avoin. Lopullinen mekanismivalinta ja tavallisten
fixturejen siirto edellyttävät edelleen erillistä hyväksyntää.

**T3:n jatko-Goal 2026-09-25:** omistaja hyväksyi T3b-L:n toteutuksen ja
yhden seuratun CI-ajon sekä itsenäisen etenemisen T3:n loppuun erilliset
päätösportit säilyttäen. [Toteutusvaltuus](e2e-test-environment-history.md#t3b-ln-toteutusvaltuus)
ei itsessään hyväksynyt riippuvuuskorjausta tai alustamekanismeja.
Riippuvuuspatchin myöhempi erillinen päätös on kirjattu omistavaan checkpointiin.
Toteutus ja näyttö kirjataan omiin checkpointteihinsa, ei valmistelun läpäisyiksi.

<a id="m1-source-m1-history-l181"></a>

## T3:n nykyinen työjärjestys

**T3/R28:n toteutuksen sulkulista on hyväksytty PR/main-porteissa.**
[T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) yksilöi sulun. Valtuus ei laajene
kaikkiin 0.3.0:n ominaisuuksiin. Tarkat sopimukset pysyvät omistavassa
[E2E-suunnitelmassa](e2e-test-environment-history.md#t3n-oikeiden-kuluttajien-siirtoraja).
Alla olevien osanäyttöjen määrät ja hyväksyntärajat kuvaavat omia
revisioitaan; niiden silloiset PR/main-rajaukset eivät kumoa lopullista sulkua.

- [x] **Electronin oikeat kuluttajat:** patchin ja neljän käynnistys-/ikkunakokeen
  lisäksi erilliset caller-/owner-loss-, relaunch- ja toinen instanssi -kokeet
  on hyväksytty. Pääfixturen normaali kytkentä, kohdesopimukset 186/186,
  E2E-tyyppitarkistus ja tavallinen Electron 45/45 on todennettu samalle
  lähdetilalle. Varsinaisen fixturen julkisen close-virheen ja portin
  vapautumisen epävarmuuden pysyvät restart-/poistoestot on todennettu
  rajatuilla oikeaprosessikokeilla. Uusi normaali CI `5f61f186` on hyväksytty.
  Alkuperäisen testirungon virheen säilymisen kaksi todellisen fixturen
  koetta sekä erillinen stress ja täysi 30 minuutin soak on nyt todennettu.
  Stressin vanhentunut mittauspolku korjattiin yhteisellä workspace-lukijalla
  ja kolmella regressiolla; alkuperäinen hylkäys säilyy. Mittauskorjauksen
  `ab5de90b` oma normaali CI ja riippuvuustarkistus on hyväksytty
  ensimmäisistä yrityksistä. Tämä sulkee rajatun Electron-kuluttajakohdan,
  ei koko T3:a tai PR/main-porttia.
  Säilytä suorien bootstrap-/toinen instanssi-
  kuluttajien kattavuus; erillinen endurance ei sisälly tavalliseen sarjaan.
- [x] **Handoff-testin virhesiivous:** olemassa oleva rajattu lapsikahvan
  omistus, alkuperäinen viiden sekunnin testiraja ja todellinen close.
  Kuusi oikeaprosessitapausta ja 24/24-kohdesarja läpäisivät; katselmus
  ja lähdesidonnan takaisinluku hyväksytty. Ei tuotannon handoff-muutosta
  eikä koko installer- tai T3-portin hyväksyntä.
- [x] **Chromiumin siirto:** hyväksytty
  [worker-selain ja testikohtainen eristys](e2e-test-environment-history.md#chromiumin-kuluttajasiirron-avoin-omistajuusraja).
  Oikean selaimen Windows-owner-/caller-loss, context/page-eristys,
  trace/screenshot sekä juurten turvallinen siivous on todennettu.
  Revision `7f8df53a` Linux-CI todensi myös selaimen kuluttajakohtaiset
  katkeamiset ja tavallisen sekä endurance-workerin erilliset siivoukset.
- [x] **Linuxin oikeat kuluttajat:** system/web-kuluttajat on siirretty
  hyväksyttyyn CI-mekanismiin oikealla runtime-identiteetillä ja alkuperäisillä
  määräajoilla. Revision `7f8df53a` ensimmäinen rajattu CI-ajo hyväksyttiin:
  kaikki seitsemän todellista katkeamista, tavalliset system/web-polut ja
  erillinen endurance ilman retryä tai flakyä. Paikallisen
  Windows-testauksen + Linux-CI:n riittävyys hyväksyttiin 28.9.;
  paikallista Linux-tukea tai hostin oikeusmuutosta ei toteuteta.
  Korvatun polun poisto ja lopullinen yhdistetty lähdetila ovat erillisiä
  portteja. Näyttö käyttää todellisia kuluttajia, ei pelkkää LM-koetyökuormaa.
- [x] **Korvatun toteutuksen poisto:** tarkista ajantasaiset kutsureunat ja
  poista korvattu aktiivinen omistajuus-/cleanup-polku vasta saman revision
  vastaavan kattavuuden jälkeen. Ei PID-/root-only-fallbackia tai kahta
  cleanup-omistajaa. Windowsin taskkill-poiston aiempi näyttö säilyy.
  Nyt myös jäljellä olleet aktiiviset Electron-varapolut ja kaksi korvattua
  siivousapuria on poistettu; vastaava stop-/timeout-/error-kattavuus on
  nykyisissä omistajasopimuksissa. Kohdesarja 151/151, puhtaat Electron-
  sopimukset 10/10 ja E2E-tyypitys läpäisivät. Koko poiston jälkeinen
  tavallinen Windows-regressio 781/781 ja riippumaton katselmus hyväksytty.
  Workspace-testit, tyypitys ja CI-sopimukset läpäisivät. PR/main on erillinen.
  Historialliset hylkäystodisteet säilyvät erillisinä.
- [x] **Pysyvän matriisin kaksi täsmennystä:** olemassa oleva `rootFirst`-
  koe laajennettiin yhdellä jälkeläisen luomalla myöhemmällä lapsella:
  rootin todellinen exit ennen kertaluonteista lupaa, lapsen oma tuore
  kuitti ja omistajan havainto ennen nykyistä stopia. Native-resume-virhe
  todennettiin testiadapterin sisäisellä paluuarvon injektiolla ja samalla
  owner-cleanupilla; normaali `ResumeThread`, puhtaat sopimustestit ja
  alkuperäiset määräajat säilyvät. Ei tuotannon fault-asetusta, uutta
  prosessirajapintaa tai uutta alustojen ristikkäismatriisia. Nämä ovat
  olemassa olevien hyväksyntäehtojen rajattuja testitäydennyksiä, eivät
  havaittuja tuotantovirheitä. Molempien oikeaprosessinäyttö ja riippumaton
  katselmus hyväksytty; late-forkin kohdesopimukset 48/48 ja native-resumen
  oikea siivousketju 25/25. Resume-koe sisältyy kanoniseen valmisteluun,
  pipe-kytkentä 31/31. Koko T3:n PR/main-portit säilyvät alla avoimina.
- [x] **Koko T3 ja PR/main:** [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä)
  täyttää [lopullisen T3-portin](e2e-test-environment-history.md#t3n-lopullinen-hyväksyntänäyttö)
  ja [pysyvän matriisin](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus),
  myös handoff-/epävarmuuspolut, T1/T2, kohdetestit, workspace/typecheck,
  build-esiehdot, Linux system/web, Windows Electron ja muuttuneen
  Windows-primitiivin installer-regressiot. Riskikadenssi, riippuvuustarkistus,
  katselmukset, julkaisuraja, ajoseuranta ja ensimmäisen virheen näyttö
  säilyvät. Sulku perustuu täsmällisen PR:n ja merge-mainin omiin portteihin,
  ei pending-, cancelled-, flaky- tai epäonnistuneeseen tulokseen.
  Dokumenttimuutoksen oma integraatio on erillinen ennen A1:tä.

<a id="m1-source-m1-history-l261"></a>

### T3:n etenemishistoria

Seuraavat revisionkohtaiset checkpointit säilytetään päätösten ja
virhetodisteiden jäljitettävyyttä varten. Niiden suhteelliset ilmaukset
kuten "nyt" tarkoittavat kyseisen checkpointin hetkeä.

1. **Hyväksytty lähtötila:** revision
   `1953b6b05dd7bdd4aaea24b509416fafa353d1ce` normaali V2-ajo ja
   riippuvuustarkistus läpäisivät ensimmäisellä yrityksellä.
   [Baselinen näyttö](e2e-test-environment-history.md#t3b-en-vihreä-normaali-baseline)
   kattaa saman ajon kaikki valitut jobit, Electronin 38/38 ilman flaky-tuloksia
   sekä producerien ja consumerien artifact-sidonnat. Tämä avaa T3b-P:n,
   ei hyväksy koko T3:a eikä ratkaise aiempia virheitä.
2. **Säilyvä virhetutkimus:** säilytä
   [toistunut firstWindow-hylkäys](e2e-test-environment-history.md#t3b-en-toistunut-firstwindow-hylkäys-ja-backendstart-rajaus)
   omana havaintonaan. Sen näyttö todistaa testibackendin päässeen
   `backendStart`-vaiheeseen, ei sisäisen käynnistystyön valmistumista.
   [Rollback-sopimushylkäys](e2e-test-environment-history.md#t3b-en-normaalin-baselinen-rollback-sopimushylkäys),
   [aiempi legacy-smoken hylkäys](e2e-test-environment-history.md#t3b-en-kokonaisajon-legacy-hylkäys)
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
   [Rajattu backend-lokihavainto](e2e-test-environment-history.md#t3b-en-rajattu-backend-lokihavainto)
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
   [omistavan sopimuksen mukaan](e2e-test-environment-history.md#t3b-p-hyväksytty-metatietorajaus).
   Uuden revision normaali CI havaitsi erillisen
   [komentoharnessin sopimushylkäyksen](e2e-test-environment-history.md#t3b-pn-ci-sopimushylkäys-ja-havaintokytkentä).
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
   [T3c-LD:n rajattu ehdotus](e2e-test-environment-history.md#t3c-ld-rajatun-käynnistysdiagnostiikan-päätösehdotus)
   hyväksyttiin 2026-09-26. Toteutus, regressiot ja riippumaton katselmus
   läpäisivät. [Uusi CI-havainto](e2e-test-environment-history.md#t3c-ldn-rajatun-ci-kokeen-havainto)
   rajaa molemmat hylkäykset wrapperin exit 1:een ennen READYä, ilman
   init-merkkiä tai READY-budjetin ylitystä. Tarkka syy on avoin;
   koko ajo päättyi hylätyksi, mutta muut testiryhmät läpäisivät.
   [T3c-LS:n suljetun stderr-luokan tarkennus](e2e-test-environment-history.md#t3c-ls-suljetun-stderr-luokan-tarkennuksen-päätösehdotus)
   on hyväksytty 2026-09-26. Toteutus, testit, lukuketju ja riippumaton
   katselmus läpäisivät. [Yhden uuden CI-kierroksen Linux-havainto](e2e-test-environment-history.md#t3c-lsn-rajatun-ci-kokeen-havainto)
   tunnisti molemmissa kuluttajissa `uid_map`-kirjoituseston ennen READYä ja
   GO:ta. Taustapolitiikan syy on avoin; alkuperäinen hylkäys säilyy.
   Kokonaisajo päättyi hylätyksi vain näiden kokeiden ja aggregaatin vuoksi;
   muut testiryhmät ja riippuvuustarkistus läpäisivät. Omistaja hyväksyi
   [T3c-LM:n rajatun CI-session hallinnan](e2e-test-environment-history.md#t3c-lm-rajattu-ci-testisession-hallinta)
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

<a id="m1-source-m1-history-l352"></a>

## Lähtötilan näyttö

- M0:n hyväksytty main on `38082dffe1772f099c4b9bb7495bed6c6b9b067b`.
  Paikallinen ja etäinen main sekä juuri tämän revision V2- ja
  riippuvuustarkistusten onnistuminen varmistettiin ennen valmistelua.
  Viitteet ovat [roadmapin nykytilassa](release-0.3.0-m1-history.md#m1-source-roadmap-l3).
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

<a id="m1-source-m1-history-l371"></a>

## Ensimmäinen hyväksytty toteutuspala

**T1a + T1b, vain olemassa olevien testien ajokytkentä ja sen suojaus.**
Omistaja hyväksyi tämän rajauksen ennen koodimuutoksia. Muutospinta on
desktopin scripts-valinta ja sen nykyinen testisopimus, sekä tarpeelliset
dokumentti-/testimatriisitäsmennykset. Nykyiseen vaadittuun komentoon
liittäminen on ensisijainen; uutta workflowta tai yleistä testirunneria ei
lisätä vain tätä varten.

Seitsemän tiedoston lähtöluettelo ja ehdotettu komentojako on kirjattu
[T1:n omistavaan suunnitelmaan](e2e-test-environment-history.md#t1-testien-ajokytkentä).
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

<a id="m1-source-m1-history-l413"></a>

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

<a id="m1-source-m1-history-l453"></a>

## T2:n toteutukseen siirtymisen portti

Omistaja hyväksyi 2026-09-25 seuraavaksi rajatuksi toteutus-Goaliksi
[T2:n projektivalinta ja valmistelu](e2e-test-environment-history.md#t2-projektivalinta-ja-valmistelu):

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

<a id="m1-source-m1-history-l481"></a>

### T2-valmistelun checkpoint

2026-09-25: komentoketju ja tuotteiden kuluttajat tarkistettu lähteistä;
erillinen read-only-agentti tarkisti projektien ja tagien valinnan sekä
valmiin neljän dokumentin suunnitelmadiffin. Katselmuksessa ei jäänyt
korjattavia huomautuksia. Muutettujen dokumenttien 67 suhteellista linkkiä,
otsikkoankkurit ja kuusi ohjeiden lukureittiä tarkistettiin; diffin muotoilu
ja julkaistavan sisällön yksityisyys tarkistettiin. Ei buildia, discoverya,
testiajoa tai T2-integraatiota. Tämä päättää suunnittelun, ei toteutusporttia.

<a id="m1-source-m1-history-l491"></a>

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

<a id="m1-source-m1-history-l522"></a>

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

<a id="m1-source-m1-history-l536"></a>

## T3:n toteutukseen siirtymisen portti

2026-09-25: omistaja salli suunnittelun ja toteutuksen ilman uutta kysymystä,
jos uusia hyväksyttäviä päätöksiä ei tarvita. T3:n aiemmin nimetty
omistajuusmekanismin päätös on kuitenkin avoin. Tätä ehtoa ei tulkita
Windowsin installer-supervisorin yleiskäyttöluvan tai Linuxin uuden
alustavaatimuksen hyväksynnäksi.

[Omistava T3-suunnitelma](e2e-test-environment-history.md#t3-koko-prosessipuun-poistumistodiste)
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
[T3a-tuloskirjauksessa](e2e-test-environment-history.md#t3an-tulos-ja-jatkopäätös).
Se ei ole sovelluksen julkaisu- tai integraatiohyväksyntä.

<a id="m1-source-m1-history-l583"></a>

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

<a id="m1-source-m1-history-l595"></a>

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

<a id="m1-source-m1-history-l607"></a>

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

<a id="m1-source-m1-history-l621"></a>

### T3b-L:n paikallinen checkpoint

2026-09-25: read-only-probe ja oletuksena suljettu CI-kytkentä toteutettu.
`pnpm test:ci` läpäisi 95/95 ilman ohituksia. Kytkennän ja lukijan
katselmukset sekä havaitun stdout-aikarajajärjestyksen korjaus kuuluvat
[omistavaan checkpointiin](e2e-test-environment-history.md#t3b-ln-toteutuscheckpoint).
Todellinen Linux-CI-havainto ja yksi hyväksytty seurattu kokonaisajo olivat
tässä vaiheessa vielä avoinna. Tämä ei hyväksy alustamekanismia, riippuvuuspatchia,
fixture-siirtoa, R28:n sulkua tai PR/main-integraatiota.

<a id="m1-source-m1-history-l631"></a>

### T3b-L:n ensimmäinen CI-checkpoint

Molemmat Linux-probet tuottivat täydellisen mutta pääsyvihjeiltään kielteisen
havainnon. Ensimmäinen kokonaisajo hylkäsi desktopin T1-kytkentätestin
vanhentuneen odotuksen. Rajattu korjaus ja sen 61/61-kohdesarja, koko
workspacen 3862 läpäissyttä testiä / kahdeksan aiempaa ohitusta, typecheck
sekä backendin, webin ja desktopin buildit
ovat paikallista näyttöä, eivät tämän CI-revision hyväksyntä.
[Omistava CI-checkpoint](e2e-test-environment-history.md#t3b-ln-ensimmäinen-ci-havainto-ja-sopimuskorjaus)
erottaa ensimmäisen hylkäyksen ja korjatun revision oman CI-todennuksen:
`0235d7270bde2edf43dc4c998ff9bf86f23ec401`, ajo `36140255216`, yritys 1,
38 onnistunutta jobia ja yksi ennalta valinnainen ohitus, ei hylkäyksiä.
T3b-E:n nimetty patch ja kokeet on nyt hyväksytty; alustamekanismit eivät.

T3b-E:n [paikallinen korjausnäyttö](e2e-test-environment-history.md#t3b-en-paikallinen-korjausnäyttö)
sisältää todellisen RED -> GREEN -regression sekä nykyiset kaksi hyväksyttyä
Electron-koetta. Koko paikallinen sarja läpäisi 3907 testiä ja säilytti
kahdeksan aikaisempaa ohitusta. Typecheck läpäisi. Payloadin metatietorajan
[erillinen paketointikorjaus](e2e-test-environment-history.md#t3b-p-hyväksytty-metatietorajaus)
on nyt hyväksytty toteutettavaksi; porttia ei ohiteta pelkän Playwright-koodin
puuttumisen perusteella. Korjauksen toteutus odottaa kuitenkin
[oman CI-revision käynnistysvian selvitystä](e2e-test-environment-history.md#t3b-en-ensimmäinen-ci-havainto).
Ensimmäisen yrityksen lifecycle-näyttö säilyi: Playwright-yhteys valmistui,
mutta backendin valmiutta ei havaittu ennen ensimmäisen ikkunan timeoutia.
Retry onnistui, mutta flaky-tulos ja kokoava CI-portti hylättiin oikein.
Juurisyytä tai tämän revision baselinea ei ole hyväksytty; T3/R28 ei ole valmis.
Omistaja hyväksyi tämän jälkeen rajatun Electron-vian selvityksen ja
korjauksen. Ensimmäinen checkpoint lisää vain testibackendin suljetun
käynnistysvaiheen havaintoketjun ja sen sopimustestit. Aikarajat,
onnistumisehdot ja tuotantokoodi säilyvät.
[Diagnostiikan paikallinen todennus](e2e-test-environment-history.md#t3b-en-käynnistysdiagnostiikan-paikallinen-todennus)
läpäisi 33 testin Windows-ajon ilman retryä sekä workspace-testit ja
typecheckin. Alkuperäinen timeout ei toistunut eikä sen juurisyy ratkennut.
Omistaja hyväksyi uuden revision julkaisun kehityshaaraan ja yhden seuratun
Windows-CI-diagnostiikka-ajon. Rajauksen tavalliset commit-, push- ja
CI-työvaiheet eivät vaadi erillistä uusintahyväksyntää.
[Rajattu Windows-CI-todennus](e2e-test-environment-history.md#t3b-en-rajattu-windows-ci-todennus)
läpäisi revision `cba3fa3db304024c55c76838cd99637d0e1bc0ef` ajossa
`36164733794`: 38 kriittistä testiä ja yksi diagnostiikkatesti ilman
uusintayrityksiä sekä paketointi ja packaged smoke. Timeoutin syy pysyy
avoimena. Rajattu ajo ei korvaa koko V2-baselinea tai aloita T3b-P:tä.

Revision `f007bda2219ad473fc20c3a948b08e4974641451` seuraava
[kokonaisajo](e2e-test-environment-history.md#t3b-en-kokonaisajon-legacy-hylkäys)
hylättiin historiallisen lähtöversion smoke-vaiheessa. Nykyinen Electron
läpäisi 38/38 ja saman revision riippuvuustarkistus läpäisi. T3b-P ja
alustamekanismien toteutus eivät ala punaisen baselinen päälle.

Linuxin seuraavaksi päätösehdotukseksi on katselmoitu
[rajattu T3c-L:n namespace-koe](e2e-test-environment-history.md#t3c-ln-rajattu-namespace-koe-päätösehdotus).
Se nimeää valmiin `unshare`-työkalun, namespace-kohtaiset luontioikeudet,
ehdollisen synteettisen kuorman ja rajatun wait-todisteen. Omistaja hyväksyi
toteutuksen ja ajon 2026-09-26. Toteutus ja puhtaat sopimus-/kytkentätestit
läpäisivät, mutta ensimmäisen CI-ajon molemmat varsinaiset kokeet
hylättiin ennen GO:ta. [Hylkäyskirjaus](e2e-test-environment-history.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys)
erottaa avoimen käynnistysvirheen puuttuvan edellytyksen toteamisesta.
Tämä ei ratkaise koko R28:aa.

Windowsin seuraava päätösehdotus on
[T3c-W:n neljän tapauksen adapterikoe](e2e-test-environment-history.md#t3c-wn-neljän-tapauksen-adapterikoe-päätösehdotus).
Se rajaa erillisen omistajan, Playwright-bridgen, koekohtaisen native-
builderin ja uuden kokeen apphost-buildin vain jo saatavilla olevin
edellytyksin; puuttuva edellytys pysäyttää ilman asennusta. Omistaja hyväksyi
toteutuksen ja kokeet 2026-09-26. T3b-E ja korjattu CI-lähtötila on todennettu
ympäristösuunnitelman myöhemmissä checkpointeissa. Windowsin neljä tapausta
ovat nyt läpäisseet [rajatun kokeen](e2e-test-environment-history.md#t3c-wn-rajatun-kokeen-checkpoint).
Native- ja Node-kohdesarjat, komentokytkentä sekä lopullisen lukurajamuutoksen
sisältävät workspace-testit läpäisivät. Typecheck läpäisi ennen viimeistä
JavaScript-muutosta, jonka jälkeen TypeScript-lähteet eivät muuttuneet.
Paikallinen CI-sopimussarja läpäisi 156/156. Windows-koe ei sulje Linuxin puuttuvaa
oikeaprosessinäyttöä, vanhoja satunnaisia timeouteja eikä T3c-W:n ensimmäisen
ennen launchia tapahtuneen hylkäyksen avointa syytä. Lopullinen mekanismi,
fixture-siirto ja koko T3/R28 tarvitsevat erilliset päätökset ja portit.

<a id="m1-source-m1-history-l705"></a>

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

<a id="m1-unit-preparation-12091-12191"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:12091-12191` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l12091"></a>

## Lukureitit

Jokainen toteutuspala aloittaa juuri-`AGENTS.md`:stä ja
[workflow'n aloitusjärjestyksestä](../ai/workflow.md#työn-aloitusjärjestys).
Paikallinen työkalurunbook ja inventaario luetaan, kun työ käyttää
Windows/WSL/Git/Node- tai release-työkaluja; ne eivät kuulu julkaistaviin tietoihin.

| Alue | Omistavat ohjeet ja tähän valmisteluun liittyvä tarkennus |
| --- | --- |
| T | [E2E-pikaohje](../ai/e2e-test-authoring-guide.md), [Desktop-ohje](../../apps/desktop/AGENTS.md), [E2E-ohje](../../apps/e2e/AGENTS.md), [testaus](../ai/testing-rules.md), [E2E-strategia](e2e-testing-strategy.md), [testimatriisi](r0-e2e-test-matrix.md), [nykyinen runtime-sopimus](e2e-test-environment.md), [Windows-harness](windows-installer-acceptance-harness-v2.md). |
| A | [Invoicing](../modules/invoicing.md), [UI-roadmapin A-suunnitelma](invoicing-ui-roadmap.md#a-paketin-valmistelu), [frontend-rakenne](web-frontend-structure.md), [UI-periaatteet](../design/ui-principles.md), [luonnoksen sopimus](invoicing-mvp-implementation-plan.md), [hyväksyntä](invoice-approval-numbering-plan.md), [virheketju](error-handling-principles.md). |
| B | [B0:n päätösportti](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7671), [Invoicingin ohje](../../apps/backend/src/modules/invoicing/AGENTS.md), [moduulivastuu](../modules/invoicing.md), [hyväksyntä ja reopen](invoice-approval-numbering-plan.md), [PDF-snapshot](invoice-print-data-foundation-plan.md), [toimitus](invoice-delivery-plan.md), [toimitustapahtumat](invoice-delivery-events-plan.md), [SQLite-toimituspysyvyys](sqlite-invoice-delivery-event-persistence-plan.md), [SMTP](email-delivery-and-secrets-plan.md), [hyvitykset](invoice-cancellation-and-credit-note-plan.md), [ADR-0006](../decisions/ADR-0006-local-database-and-query-layer.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [artifact-katalogi](local-backup-artifact-inventory.md), [backup/restore](local-backup-and-restore-plan.md), [E2E-pikaohje](../ai/e2e-test-authoring-guide.md). |
| C | [C:n hyväksyntähistoria](release-0.3.0-integration-history.md#m1-source-preparation-l5845), [desktopin ADR](../decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md), [workspace-suunnitelma](local-company-workspace-plan.md), [update-suunnitelma](windows-installer-and-update-plan.md), [recovery-runbook](local-restore-recovery-runbook.md). |
| K | [K:n valmistelu ja päätösrajat](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395), [ADR-0006](../decisions/ADR-0006-local-database-and-query-layer.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [tietokannan toteutussopimus](local-database-implementation-plan.md), [backup/restore](local-backup-and-restore-plan.md), [artifact-katalogi](local-backup-artifact-inventory.md), [Desktop-ohje](../../apps/desktop/AGENTS.md), [E2E-pikaohje](../ai/e2e-test-authoring-guide.md). |
| W7 | [ADR-0011](../decisions/ADR-0011-local-multi-workspace-company-model.md), [ADR-0008](../decisions/ADR-0008-local-desktop-company-workspaces.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [W7-päätösportti](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti), [backup/restore](local-backup-and-restore-plan.md), [recovery-runbook](local-restore-recovery-runbook.md). |
| Yhteiset portit | [Turvallisuus](security-principles.md), [katselmointi](../ai/review-checklist.md), [observability/audit](observability-and-audit-plan.md), [moduulien integraatiomatriisi](module-integration-matrix.md), [valmistumisportti](../ai/workflow.md#toiminnon-valmistumisportti). |

Toteutus lukee lisäksi jokaisen todellisuudessa muuttuvan kansion ohjeet.
Tämä taulukko ei anna lupaa ohittaa tarkempaa backup-, salaisuus-, päivitys-
tai riippuvuusporttia, jos rajaus myöhemmin koskettaa niitä.

<a id="m1-source-preparation-l12112"></a>

## Rajattu toteutusjärjestys

| Pala | Muutos ja valmistumisen näyttö | Edellytys ja päätösraja |
| --- | --- | --- |
| T1a / R27 | Startup-failure-testit tavalliseen desktop-testivalintaan ja valinnan regressiosopimus. | Hyväksytty; paikallisen näytön lisäksi PR/main-portit läpäisty. Ei tuotantokoodia. |
| T1b / R27 | Kuusi puuttuvaa installer-harness-testitiedostoa nykyisten vaadittujen komentojen kautta ajettaviksi, myös ajokytkentää suojaava testi. | Hyväksytty T1a:n kanssa; R27 suljettu. Ei raskaan CI:n kevennystä. |
| T2 / R29 | `security`/`fault`-projektivalinnan ja koko build-ketjun vastaavuus puhtaasta, vanhentuneesta ja epäonnistuneesta valmistelusta. | Hyväksytty; paikallinen näyttö, Linux-CI sekä PR/main-portit läpäisty. [Integraatio](release-0.3.0-m1-history.md#m1-source-m1-history-l522). |
| T3 / R28 | Omistajuus käynnistyksestä todettuun koko puun poistumiseen; epävarma cleanup ei hyväksy restartia tai poista fixtureä. | Oikeat Windows-/Linux-kuluttajat, kohdistettu katkeamis-/endurance-matriisi, korvattujen varapolkujen poisto ja Windows-regressio hyväksytty. [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) sulkee lopullisen PR/main-portin. [Sulkulista](release-0.3.0-m1-history.md#m1-source-m1-history-l181) säilyttää hyväksynnän rajauksen; historiallisia hylkäyksiä ei muuteta. |
| A1 / R01 | Luonnoksen avaamisen kohde, näkyvät arvot ja tallennuksen kohde pysyvät samana myös vastausten valmistuessa väärässä järjestyksessä. | Hyväksytty PR #288:n mainissa; integraation myöhemmät jatkot ja nykyinen lähtörevisio ovat sivun alussa. |
| A2 / R05 | Ensimmäisen createn tunnisteen ja uudempien muokkausten säilyminen. | Hyväksytty jatkokehitykseen yllä kuvatulla A2:n integraationäytöllä ja rajatulla etenemispäätöksellä. |
| A3 / R06 | Muokatun lomakkeen vanhentuneen readinessin torjunta. | Hyväksytty PR #294:n mainissa sivun alun checkpointilla. Backendin hyväksyntäauktoriteetti säilyy. |
| B0 -> B1-B5 | Laskennan, SMTP:n sekä lasku-/PDF-/toimitusrevision rajatut korjaukset. | Hyväksytty PR #297:n ja PR #298:n mainissa sivun alun checkpointin mukaisesti. [Valmistelu ja sen päätökset](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7671) säilyvät hyväksyntähistoriana. |
| C / R03/R04/R17/R18/R19 | Desktopin sammutus-, päivityssuoja-, startup-, cold-recovery- ja build-identiteettirajat. | Hyväksytty PR #299:n mainissa sivun alun checkpointilla. Vanhoja hylkäyksiä ei merkitä jälkikäteen onnistuneiksi. |
| K / S030-01/S030-02 | Varmuuskopion todelliset schema-objektit ja eristetyn tarkistuksen rajat. | V1:n sopimus ja alkuperäiset päätökset on hyväksytty. [Nykyinen jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3) erottaa kohdetodennetut V2-palat avoimista tuotantotavan ja palautuskäyttäytymisen päätöksistä; K:n koko korjaustodennus on kesken. |
| W7-valmistelu | Omistajan hyväksyttävä poisto-, karanteeni-, palautus- ja nollan työtilan sopimus. | Suunnittelu kulkee rinnalla; toteutus tarvitsee C/K/G/H:n nimetyt kyvykkyydet. |

T1/T2/T3:n, A1/A2/A3:n sekä B/C:n toteutus ja integraatio ovat valmiit. K käyttää
niiden nykyistä testiruntimea eikä avaa alustamekanismien tutkimusta uudelleen.
Kaikkia I-paketin ohjetarkistuksia ei tehdä ennen A:ta. Myöhemmät B/C/K-rajat
säilyvät roadmapin mukaisina, eivät muutu tämän taulukon sivuvaikutuksena.

<a id="m1-source-preparation-l12133"></a>

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

<a id="m1-source-preparation-l12156"></a>

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

<a id="m1-source-preparation-l12172"></a>

## Päätösjono ja valmistelun lopetus

Ensimmäinen hyväksytty toteutusraja T1a/T1b on valmis.
Myös T2:n paikallinen näyttö, Linux-CI ja PR/main-integraatio on hyväksytty.
Myös [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) on kirjattu: mekanismi,
oikeat kuluttajat, korvatun aktiivisen toteutuksen poisto ja pysyvä matriisi
eivät enää ole avoimia toteutuskohtia. T3a/T3b:n alkuperäiset päätökset,
kokeiden rajoitukset ja hylkäykset säilyvät historiassa. Nykyinen
[Jatka tästä](release-0.3.0-integration-history.md#m1-source-preparation-l3) erottaa hyväksytyt T1/T2/T3-, A1/A2/A3- ja
Oma yritys -palat sekä B/C:n nykyisestä K-valmistelusta ja K:n päätösjonosta.
Sovelluspalat käyttävät nykyistä feature-/API-sopimusta; jos rajaus vaatii
backendin tai navigoinnin uuden liiketoimintasäännön, se palautuu suunnitteluun.
W7:n päätöksiä ei kysytä yhtenä epämääräisenä lupana, vaan sen omistavan
suunnitelman päätöstaulukon mukaan ennen kunkin vaikutusalueen toteutusta.

Alkuperäisen M1-valmistelun hyväksyntä ja sen rajaus säilyvät
[valmistelun checkpointissa](release-0.3.0-m1-history.md#m1-source-m1-history-l705).
Sen jälkeen hyväksytyt T1/T2/T3:n toteutukset eivät sulje A/W7:n tai koko
0.3.0:n valmistumisportteja. Jokaisen seuraavan palan suunnitelma, rajaus,
testit ja ohjeet tarkistetaan ennen toteutusta ja sen valmistuessa.

<a id="m1-unit-roadmap-1-279"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-plan.md:1-279` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-roadmap-l1"></a>

# Eky 0.3.0 -julkaisusuunnitelma ja tehtävälista

<a id="m1-source-roadmap-l3"></a>

## Päätös ja nykyinen tila

**Ajantasainen jatko 14.10.2026:** T/A/B/C säilyvät hyväksyttyinä.
K:n toteutus ja rajatut integraatiokorjaukset on yhdistetty PR #303:ssa ja
PR #304:ssä, mutta K:n main-hyväksyntä on edelleen avoin: viimeisin mainin
kierros hylättiin Electron-testien tarkistusajurin käännösvalmistelussa.
[M1:n nykyinen jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
omistaa täsmärevisiot, näytön ja seuraavat hyväksyntäportit. Katselmoitu
rajattu virheaineiston talteenotto läpäisi paikalliset kontrollit ja yhden
nimetyn Windows-todennuksen. Seuraavaksi vaaditaan uuden revision normaalit
PR- ja main-portit, ei K:n toteuttamista uudelleen tai uuden ominaisuuden
aloittamista. Vanhan käännösvirheen syytä ei ole jälkikäteen todistettu.

**Aiempi checkpoint 12.10.2026:** alla on silloisen valmistelun historia,
ei nykyinen toteutus- tai päätösjono. Sen lähtö oli PR #299:n main.
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
omistaa täsmärevision, nykyisen K-työn ja sen hyväksyntärajat.
Uusin [kokonaiskytkennän tarkistus](release-0.3.0-integration-history.md#m1-source-preparation-l958)
erottaa toteutetut osat vielä avoimista porteista. Aktiivivalidoinnin
kutsujakohtainen omistajuus, myös ensimmäinen käynnistys ja C, sekä natiivin
muistirajavirheen säilyminen on kytketty ja saanut rajatun kohdenäytön.
[Candidate-avausportti](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2020)
on korjattu yhteisellä readonly-esitarkistuksella ennen kirjoitusavausta;
kohderegressiot ja oikean utility-ketjun todennus läpäisivät.
[FirstStartin ja restore-journalillisen C:n native-kohdenäyttö](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2206)
läpäisi kehitysruntimessa. Se ei korvaa oikeaa binaarihandoffia, hardened-
palautusta tai muita paketointi- ja K:n loppuportteja. Journalin guard-/sisältöerottelun
[suunnittelu ja synteettinen koe](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2272)
sekä sen jälkeinen rajattu cold-forward-/rollback-kytkentä on hyväksytty ja
kohdetodennettu; koko K:n portit ja aiempien aikakatkaisujen seuranta säilyvät.
K ei ole vielä hyväksytty PR-/main-revisiona.
[Paketoinnin budjettipäätös](release-0.3.0-integration-history.md#m1-source-preparation-l1490)
on hyväksytty ja rajatestit läpäisivät; puhtaan paketin mittaus ja
sisältökatselmus ovat avoimia. Kohdenäyttö ei hyväksy koko pakettia.
[Linuxin tarkistusajopolun rajaus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1976)
on hyväksytty ja kytkennän sopimustestit läpäisivät; oikean Linux-Electron-
utilityn ja CI:n todennus on edelleen avoin.
[Suuremman katalogin koe](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1510)
ja hyväksytyt PDF-/journal-muutokset saivat rajatun onnistuvan ketjun näytön;
se ei korvaa puhtaan paketin palautusportteja. Normaali paikallinen
työtilakierros on läpäissyt [M1:n checkpointin](release-0.3.0-integration-history.md#m1-source-preparation-l1034)
mukaisesti. Seuraava suunnittelusuunta on
[laskuhistorian tarkistus pienissä osissa](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1095),
ei uusi koko historian määräraja. Tuotantokytkentä on vielä päätettävä.
Katalogin erillinen muistivirheen syyhäviö ja K:n loppuportit ovat avoimia.

**Alla oleva 11.10.2026 vaihehistoria ei korvaa yllä linkitettyä nykytilaa.**
[V2av:n P1 ja P2:n startup-rollback](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4547)
on toteutettu ja rajatusti todennettu ennen business-backendin käynnistystä:
molempien palautuskuluttajien tuore sisältövaltuus, paikallaan pysyvä
tarkistusankkuri ja staging-siirron juuri-identiteetti säilyvät. Oikean
utility-/native-ketjun kohdenäyttö ei ole koko K:n tai hardened-paketin
hyväksyntä. [V2aw:n loppusiivouskorjaus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4694)
säilyttää tuntemattoman rollback-aineiston ja journalin; sen erilliset
hylkäys- ja onnistumiskontrollit läpäisivät.
[V2ay:n C-palautuskutsujan korjaus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5340)
säilyttää sisäisen ensisyyn erillään journalin lisävirheestä nykyisellä
julkisella tapahtumasopimuksella. Kohdenäyttö ja rajattu katselmus eivät
hyväksy offline-palautusta; seuraavat valtuus-/palautusportit ovat avoinna.
[Live-terminalin V2bb-kytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4846)
todensi tuoreen snapshot-sisältövaltuuden, täsmälliset cleanup-varaukset,
normaalin hyväksynnän ja accepted-cold-jatkon oikealla business-backendillä
nyky-/038-aineistolla.
[C-terminalin V2bc-kytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5275)
todensi erikseen alkuperäisketjun tarkistuksen ennen migraatioita ja jo
hyväksytyn C-palautuksen jatkon oikealla backendillä ja native-varauksilla.
[Tarkistusvirheen jälkeinen V2bd-valtuus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5223)
käyttää samaa alkuperäisinspektoria ja native-varauksia myös pysäytetyn
backendin jälkeisessä rollbackissa. Hylkäys ei käynnistä vaihtoehtoista
työtilapalautusta. Rajattu kohdenäyttö ei hyväksy koko K:n palautusketjua.
[V2be:n valmistumiskirjoitus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4893)
sitoo nykyisen C-palautuksen alkuperäiseen update-valintaan myös valmistumis-
ja virhehaaroissa. Vanhentunut valinta ei ylikirjoita uudempaa journalia;
epävarma julkaisun jälkeinen siivous säilyttää edellisen journalin.
[V2bf:n journaliton C-valinta](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5180)
ja [V2bg:n aktivointikuitti](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5115)
säilyttävät alkuperäisen valinnan journalin valmistelusta tiedostosiirtoihin
ja oman keskeytyksen rollbackiin. Julkaisusuoja koskee myös alkuperäisiä
kutsumuotoja ilman erillistä valtuusfunktiota. Rajattu kohdekierros ja neljän
tapauksen oikea prosessiketju läpäisivät; nämä eivät hyväksy koko K:ta.
[V2bh:n historiallinen journaliton käynnistysadmissio](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4950)
kytkee nykyisen schema-poikkeuksen ennen backendin avausta saman valitun
C-operaation prepare-/grant-sidonnalla. Kuuden tapauksen oikea prosessikoe
ja kohderegressiot läpäisivät; katselmuksessa löytynyt aikaisempi W6-
inventaarioraja estää kuitenkin rekisteröidyn metadataa vailla olevan
038-työtilan koko startup-polun. Rajattu C-palautuksen valmistelujärjestys
hyväksyttiin 11.10.2026. [V2bi:n rajattu kytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5019)
on sittemmin toteutettu ja saanut käynnistysketjun kohdenäytön; palautussarjan
aikakatkaisut ja koko K:n hyväksyntä ovat yhä avoinna.
Inventaarion schema-suojaa ei löysennetä.
Tämän jälkeen seuraavat jäljellä olevien raskaiden aktiivisten tarkistusten
korvaaminen, koko mainin palautusketju ja M1:n muut loppuportit.
K:n työpuuta ei ole vielä hyväksytty PR- tai main-revisiona.

**Aiempi K-eteneminen 10.10.2026:** alla olevat toteutusvaiheiden checkpointit
ovat historiaa; niiden silloiset avoimet kohdat eivät korvaa yllä olevaa
nykyistä jatkamiskohtaa. T1/T2/T3, A1/A2/A3, Oma yritys -korjaukset
sekä koko B1-B5 ja C hyväksyttyine integraatiojatkoineen ovat hyväksyttyjä.
Lähtö on [PR #299:n main ja loppuhyväksyntä](https://github.com/eky-software/eky/pull/299#issuecomment-6081351779).
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
omistaa täsmärevision sekä sen PR- ja main-portit. Nykyinen työ on
[K-paketin hyväksytty suunnitelma](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395):
varmuuskopion todellisen SQLite-rakenteen luottamustodistus sekä epäluotetun
tarkistuksen eristäminen aktiivisesta business-runtimesta. Alkuperäiset
S030-01/S030-02-havainnot on luettu uudelleen ja nykyinen kutsuketju on
tarkistettu rajatusti. Konkreettinen schema-, prosessi-, resurssi- ja
hyväksyntäsopimus on kirjattu M1:n K-osioon ja rajattu riippumaton
suunnitelmakatselmus ei löytänyt estettä. Omistaja hyväksyi K-P1/K-P2/K-P3-
päätökset 9.10.2026, joten V1-valmistelu on valmis. V2a:n yhteinen
schema-portti ja snapshot-tarkistimen ensimmäinen kytkentä on toteutettu
työpuuhun kohdetesteineen, ja rajattu katselmus on tehty. V2b:n tarkistuspalvelu
on erotettu aktiivisen yrityksen kontekstista, mutta utility-kytkentä on
avoin. Muistirajakoe osoitti nykyisen native-ajurin valvontapuutteen;
[M1:n K-osio](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395)
omistaa tarvittavan runtime-päätöksen ja todennuksen ennen kytkentää.
V2c:n yhteinen käynnistys- ja migraatiotarkistus käyttää nyt schema-porttia
ennen kirjoituksia ja migraation jälkeen. Kohdetodennus säilyttää nykyisen
baseline-/restore-erottelun ja rollbackin. Backendin readonly-avausportin
ehdokas vaatii hyväksytyn kaatumispalautuspoikkeuksen kytkennän:
katselmuksen hot-journal-regressio toistettiin, joten vihreät muut testit
eivät hyväksy ehdokasta. Omistaja hyväksyi 10.10.2026 vain todistetusti
oman paikallisen työtilan natiivipalautuksen ennen schema-tarkistusta;
tuodulle varmuuskopiolle ei anneta poikkeusta.
Candidate-kopioinnin avausportin ja tavusidonnan ehdokkaassa toistui myös
ehjän WAL-varmuuskopion hylkäys. Omistajan hyväksymä
[erillisen tarkistuskopion koe](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2496)
läpäisi. Sen [kutsujatason säilytysjatko](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2558)
korjasi korvauksen siivousjärjestyksen ja todensi kolme kutsupolkua;
[nykyisen C-omistajan utility-koe](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2597)
todensi rajatun koekopion sulkemisen, todellisen poistumisen, varauksen
palautuksen ja epävarman aineiston säilytyksen viidessä tapauksessa.
[Varsinaisen kuluttajan WAL-regressiot](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2648)
toistivat ehjän nykyisen ja historiallisen backupin hylkäyksen sekä
tarkistuksen lähdekansioon luomat sivutiedostot. Omistaja hyväksyi tämän
jälkeen rajatun tuotantokytkennän. [V2i:n nykyinen kuluttaja](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2692)
on toteutettu työpuussa; nykyinen ja hyväksytty vanha 038-WAL-backup sekä
schema-hylkäys on kohdetodennettu oikeassa utility-ketjussa alkuperäistä
muuttamatta. Rajattu katselmus ja sen korjausten regressiot läpäisivät;
K:n koko loppukatselmus ja paketoidun palautuksen hyväksyntä ovat kesken.
[V2j:n sisäinen syyn säilytys](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2751)
on toteutettu kohderegressioineen: ensisyy säilyy palautuksen ja vapautuksen
virheiden yli, eikä raaka ketju siirry IPC-rajan läpi. Nykyinen käyttäjäkoodi
ja palautuksen järjestys säilyvät. Työtilojen regressiot, tyypintarkistus,
build ja rajattu staattinen katselmus läpäisivät.
[V2k:n workspace-lukuketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2786)
on kohdetodennettu: tuonnin ja korvauksen ensisyy ja lisävirhe säilyvät
oikeasta operational-tiedostosta strict-Diagnostics- ja tukipakettilukijoihin.
Mainin observer-kytkentä on mukana lähteessä; todellinen Electron-mainin,
K3:n muiden kuluttajien ja hardened-paketin hyväksyntä on vielä avoin.
[V2l:n backup-/palautuskuluttajien sisäinen ensisyy](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2835)
on kohdetodennettu ulompaa virhesopimusta muuttamatta. Se ei vielä hyväksy
näiden kaikkien kuluttajien turvallista diagnostiikan lukuketjua tai K2:ta.
[V2m:n portable-backupin lukuketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2864)
välittää luonnin ja tarkistuksen hyväksytyt ensisyyt nykyisestä capabilitysta
lokitiedostoon, Diagnostics-malliin ja sanitoituun tukipakettiin. Käyttäjän
yleinen palaute säilyy. [V2n:n palautuskuluttajien kohdenäyttö](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2910)
täydentää palautuksen ja palautuspisteiden ensisyyraportoinnin samoilla
kirjoittajilla ja tiedostolukijoilla; rollbackin lisävirhe ei peitä ensisyytä.
[Hyväksynnän loppuvaiheen rajattu korjaus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2952)
säilyttää myös validoinnin jälkeisen valmistelu-, hyväksyntä- tai
siivousvirheen turvallisen syyn. Composition-regressiot ja koko lukuketju
gzip-tukipakettiin läpäisivät; palautuskäyttäytyminen ja K:n loppuportit säilyvät.
[V2o:n lukijapariteetti](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3005)
on kohdetodennettu: API-client ja tukipaketti tarkistavat tapahtumakohtaiset
vaiheet ja kentät, ja nykyisten kuluttajien tiedostoketjut säilyvät.
[V2p:n todellinen tuontiketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3044)
todentaa yhden schema-hylkäyksen ketjun candidate-utilitysta oikean main/IPC:n
kautta hallittuun uudelleenkäynnistykseen ja Diagnostics/API-/tukipakettilukijoihin.
Tavallinen tuonti ja nykyinen workspace-koostetodistus läpäisivät erillisinä
kontrolleina. [V2q:n korvausketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3095)
todentaa saman yrityksen varmuuskopion schema-hylkäyksen, native-vahvistuksen,
varmuuskopion jälkeisten tietojen säilymisen ja saman syyn todellisen
diagnostiikka-/tukipakettiketjun. Tavallinen korvaus ja väärän yrityksen
esto läpäisivät muuttumattomina kontrolleina. Näitä erilliskokeita täydentävät
nyt [V2r:n kaksi pysyvää Electron-regressiota](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3147).
Tuonti ja korvaus läpäisivät kohdeajon nykyisellä testipohjalla;
PR/CI- ja packaged-todistus sekä K3:n muut todelliset runtime-polut
säilyvät avoimina.
Kohdetulos ei hyväksy K2:n prosessiomistajuutta tai paketoitua palautusta.
[Rajattu native-muistikoe](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5377)
läpäisi. Kokeen lupa ei yksin hyväksynyt tuotantoajurin toimitusta.
Omistaja hyväksyi 10.10.2026 erillisen tarkistusajurin tuotantotoimituksen,
inventaarion schema-fail-closed-polun ja rajatun paikallisen hot-journal-
palautuksen. [V2s:n toimituskytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3189)
ja Windowsin rajatut ajuri-/kopio-/runtime-kontrollit ovat työpuussa
kohdetodennettuja. Koko paketti on vielä hylätty pakkaustiedoston kokorajaan,
eikä rajoja ole muutettu. [V2t:n inventaarion kytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3233)
todistaa scheman ja historian ennen identityä, pysähtyy suljetusti eikä
muuta registry-slotien aineistoa lukemisen sivuvaikutuksena. Kohdetestit
ja kolme nimettyä Electron-development-koetta läpäisivät. Koko käynnistyskoosteen
hylkäys, hardened-paketti ja kokonaisuuden hyväksyntä ovat erillisiä.
[V2u:n omistetun local-työtilan palautus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3281),
[V2v:n tarkistusperusta](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3329),
[V2w:n kontekstikooste](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3386)
ja [V2x:n kevyt broker-v10-konteksti](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3427)
ovat kohdetodennettuja työpuussa. V2x:n rajattu lähdekatselmus ei löytänyt
uutta ohitusta tai regressiota; se ei hyväksy koko kuluttajakytkentää.
[V2y:n omistettu Inspect-kuluttaja](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3463)
liittää salatun varmuuskopion purun ja tarkistuksen todettuun utility-exitiin
sekä varattuun siivoukseen. [V2z:n portable-main-kytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3507)
siirtää luonti-/Inspect-kuluttajan pakolliseen omistajuusporttiin, säilyttää
lähdevarauksen kirjoituksen ja itsevalidoinnin yli ja liittää nykyisen
installation-leasen sekä hallitun sulun. Kohderegressiot ja todellinen
Electron-kuluttajakoe läpäisivät. [V2aa:n palautuspisteen lähdevaraus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3564)
kattaa myös tallennuksen ja rotationin sekä erottaa ensisyyn epävarmasta
siivouksesta. Kohdetestit ja rajattu todellinen prosessikoe läpäisivät.
[V2ab:n valmistellun palautuksen slot](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3602)
estää kilpailevan aktivoinnin/discardin sekä säilyttää journalin epävarman
valmistelun. Kohderegressiot ja aidon journalin/diagnostiikan rajatut kokeet
läpäisivät. Native-varauksen pitkäikäinen handoff ja maintenance-kanavan
ajastettu vapautus eivät vielä ole tämän esitason näyttöä.
[V2ac:n käytäntö- ja tarkistuskopiosidonta](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3636)
säilyttää nykyisen, historiallisen ja tuodun aineiston hyväksyntärajat sekä
siirtää eristetyn tarkistimen readonly-luvut vain mainin omistamaan kopioon.
Kohderegressiot ja seitsemän todellisen prosessirajan synteettistä tapausta
läpäisivät. Hallittu loogisten tiedostojen siirto kokeessa ei vielä todista
vanhan muodostajan eristystä tai kaikkien sen kutsujien vaihtoa.
[V2ad:n Store-kytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3703)
käyttää samaa pakollista native-omistajuutta salatun palautuspisteen
itsevalidointiin ja purkuun. Kohderegressiot ja neljä todellisen prosessirajan
synteettistä tapausta läpäisivät. Purku jättää stagingin varauksen seuraavalle
omistajalle; sitä kuluttava durable-/offline-aktivointi ei vielä ole valmis.
[V2ae:n odottava staging](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3739)
käyttää native-porttia molempien palautusvalmistelujen koko odotusajalle ja
portable-peruutukselle. Kohderegressiot ja oikean prosessirajan koe
läpäisivät; epävarma siivous säilyttää aineiston ja estää aktivoinnin.
[V2af:n alustakohtainen ajuritodennus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3777)
täydentää Linuxin Node-/resurssitoimituksen ja Windowsin Node-/Electron-
kontrollit. Käännöksen välituotteesta tehdään varmennettu itsenäinen kopio;
toimituksen yksilinkkisyys-, koko- ja sisältörajat säilyvät.
[V2ag:n muodostajakytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3812)
poistaa business-backendin eristämättömän kopiotarkistuksen. Oikean
muodostajan snapshot-tavut läpäisivät eristetyn utilityn hyväksytyillä
käytännöillä; schema- ja sivutiedostohylkäykset säilyttivät aineiston.
Kohderegressiot, tyyppitarkistukset ja kahdeksan prosessirajakontrollia
läpäisivät. V2ac:n hallittu tiedostosiirto on aiempaa koehistoriaa,
ei tämän muodostajakytkennän todiste.
[V2ah:n Electron-testiruntimen toimitus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3849)
varmentaa ajurin ja mainin todellisen runnerin tuoreen toimituksen.
PDF-kuitti sitoo todelliset polku-/koko-/sisältötavut nykyisistä tallennusnimistä
riippumatta. Kirjoitusquiesce säilyttää tarkistusportin preRestoreen asti;
lopullisen pysäytyksen sulkuportit säilyvät. Kohderegressiot sekä tuonnin,
korvauksen schema-hylkäyksen ja native-peruutuksen yksi nimetty Electron-ajo
läpäisivät. Tämä ei korvaa durable-palautuksen tai paketoidun palautuksen
hyväksyntää eikä kevennä muita K:n portteja.
[V2ai:n palautuksen kirjoitussuoja](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3907)
on hyväksytty ja sen tilakone-/broker-pohja kohdetodennettu. Epävarmuuden
mitätöinti ei odota muun työn valmistumista; myöhäinen kuittaus ei avaa
kirjoituksia. Tilakone-, sopimus- ja oikean viestikanavan kontrollit sekä
rajattu uusintakatselmus läpäisivät.
[V2aj:n nimetty palautussulku](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3959)
on kohdetodennettu oikean backend-utilityn, brokerin ja varauksen ketjussa.
[V2ak:n native-journal-handoff](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4010)
on kytketty molempiin live-aktivointikuluttajiin ja kohdetodennettu oikeilla
utility-/native-prosesseilla sekä durable-journalilla. Epävarma journal
estää tarkistajan tiedostopoiston; varauksen luovutus edeltää globaalia
sulkua. Tämä ei hyväksy cold-polun valtuutta, koko käynnistysketjua tai
paketoitua palautusta. Offline/cold-journal-sidonta ja lopulliset K-portit
ovat edelleen avoinna.
Vanha raskas tarkistus ei ole uuden kuluttajan fallback.
Linuxin koko runtime-/CI-toimitus, K2:n muiden kuluttajien varauselinkaari,
muiden kuluttajien todellinen
syyraportointi sekä hardened- ja PR/main-portit ovat edelleen avoimia
omistavassa M1-suunnitelmassa. Päätösportti ja toteutuksen hyväksyntänäyttö
eivät ole sama asia.
K:n kokonaisuuden
korjaustodennus on vielä avoinna; uutta Deep
Scania ei aloiteta tässä.
C:n hyväksyntä kattaa desktopin graceful-only updaten, katkeamattoman
kirjoitussuojan, startup-exitin, create/import-recoveryn sekä oletus-buildin
täyden revision. C:n aiemmat valmistelu- ja hylkäyscheckpointit ovat
[toteutushistoriaa](release-0.3.0-integration-history.md#m1-source-preparation-l5845),
eivät nykyinen työjono. Aiemmat timeout- ja sulkuhavainnot säilyvät omille
revisioilleen, eivät uuden työn juurisyyväitteinä.
K, D:n muut ehdot, E/F/G/H/I, W7, sovittu käyttäjäkokemus ja M5 ovat
edelleen avoinna; koko 0.3.0 ei ole valmis.


<a id="m1-unit-roadmap-280-466"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-plan.md:280-466` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-roadmap-l280"></a>

### PR #298:n hyväksyntää edeltävä toteutushistoria

<details>
<summary>Aiemmat B-valmistelun ja A-integraatioiden checkpointit</summary>

**Checkpointin tilanne 6.10.2026:** A1/A2/A3, Oma yritys -korjaukset sekä
B1/B2 ja niiden sulku-/keräysjatkot on hyväksytty. Lähtö on PR #297:n main;
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
omistaa täsmärevision ja sen hyväksyntänäytön. Nykyinen työ on
[B3-B5:n toteutusvalmistelu](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8239):
ALV-lukupolun rajattu korjaus on kohdetodennettu työpuussa, ja revisioiden,
PDF:ien, toimitusten sekä palautuksen tekninen sopimus on katselmoitu.
Tietoja säilyttävä migraatio 039 ja tietokantatyypit ovat työpuussa.
Migraation ja käynnistystilan 117 kohdetestiä sekä runnerin/manifestin
17 testiä läpäisivät; rajattu SQL-katselmus ei löytänyt korjattavaa.
Tavallisen laskun hyväksynnän ja PDF:ttömän uudelleenhyväksynnän
revisiokirjoituksen 13 kohdetestiä läpäisivät. Hyvityksen lähderevisiosidonta
ja revisiokirjoitus läpäisivät 24 uutta sekä 23 aiempaa hyvitystestiä;
application-/HTTP-sopimusten 19 testiä läpäisivät erikseen. Täsmärevision
lukijan 97 kohdetestiä läpäisivät: vanha sisältö ja sen alkuperä säilyvät,
rikkinäistä sidosta ei korvata uusimmalla versiolla. Rajatut riippumattomat
tuotantokatselmukset eivät löytäneet korjattavaa. Hyväksynnän sisäinen
revisioavain ja HTTP-vastauksen kenttärajaus läpäisivät 132 kohdetestiä;
julkinen hyväksyntävastaus ei muutu. Revision PDF-sisältömuunnos ja nykyinen
renderer läpäisivät 39 kohdetestiä, yhdessä hyväksyntäavaimen kanssa
171/171. Ulkoasu ja laskentasäännöt säilyvät. Ehdollisen dokumenttimetadatan
julkaisun, dokumenttikohtaisen polkusäännön ja julkisen metadatavastauksen
84 kohdetestiä läpäisivät; rajatut katselmukset eivät löytäneet korjattavaa.
Omistetun tiedostokirjoituksen, rajatun PDF-tavujen tarkistuksen ja vain oman
julkaisemattoman ehdokkaan siivouksen 73 testiä läpäisivät; rajattu
tuotantokatselmus ei löytänyt korjattavaa. Generaattorin ja hyväksynnän
PDF-koukkujen täsmärevisiokytkentä sekä kirjoittamaton välimuistin
kelpoisuusluku on nyt kohdetodennettu: 206 yhdistettyä generointi-,
tietokanta-, tiedosto-, HTTP-, composition- ja diagnostiikkatestiä läpäisivät.
Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa.
Nykyisen PDF:n GET-/metadataluku valitsee täsmädokumentin, varmentaa tavut
ja hylkää välissä vaihtuneen valinnan. Legacy-alkuperäinen säilyy luettavana
ilman revisioväitettä, mutta uuden revision puuttuva PDF ei käytä vanhaa
sisältöä varavaihtoehtona. Generoinnin ja lukemisen yhdistetty tarkistus
läpäisi 269 testiä; myös eheysvirheen todellinen diagnostiikan lukuketju
on kohdetodennettu. Myös tapahtumaan sidotun historian backend-luku on nyt
kytketty: tarkat PDF-tavut, `sendInvoices`-oikeus, yritysraja ja turvallinen
diagnostiikka säilyvät, eikä reopened-historia muuta lähetyskelpoisuutta.
Yhdistetty historian lukuketjun tarkistus läpäisi 359 testiä. B4:n atomisen
SMTP-varauksen ja täsmällisen loppukuittauksen SQLite-adapterit sekä
historian säilyttävä reopen/uudelleenhyväksynnän unresolved-esto ovat nyt
kohdetodennettuja. Laajennettu PDF-/revisio-/hyvitys-/varaus-/reopen-ajo
läpäisi 650 testiä. Sen jälkeen asiakas- ja itselle-SMTP:n prepare/send on
kytketty tarkistettuun täsmädokumenttiin, revision sisältävään valtuutukseen
ja pysyvään varaukseen ennen provideria. Onnistuneen lähetyksen jälkeinen
lukuhäiriö erotetaan lähetysvirheestä myös diagnostiikan lukuketjussa.
Myös manual-/dry-run-kirjoittajat ovat nyt revisiosidottuja. Kilpaileva
manual-pyyntö ei luo olematonta arkistotapahtumaa. Cancel-/SMTP-varausjärjestykset
ja päätöksen säilyminen tietokannan uudelleenavauksessa on kohdetodennettu.
Lopullinen laskutusmoduulin ja kolmen toimitus-/reopen-compositionin sarja
läpäisi 1 472 testiä 122 tiedostossa ja backendin tyypitys läpäisi.
Rajattu riippumaton katselmus ja sen testitäydennysten tarkistus valmistuivat
ilman korjattavia löydöksiä. Activity-lukuketjun rajattu todennus säilyttää
manuaalisen toimituksen turvallisen historian ja dry-runin poissulun.
Legacy-lähteen valinta ja tarkistettujen tavujen itsenäinen säilyttäminen on
lisätty työpuuhun. Julkaisu ja varaus tarkistavat saman historian kelpoisuuden;
epäselvä commit-tulos säilyttää tiedoston. Tämän jälkeinen laskutusmoduulin
ja viiden compositionin regressio läpäisi 1 525 testiä 126 tiedostossa ja
backendin tyypitys läpäisi. Rajattu riippumaton katselmus valmistui ilman
korjattavia löydöksiä.
Legacy-uudelleenlähetyksen vahvistus- ja lähetyskytkentä,
historian ja uuden virhepalautteen client/UI/native-ketju sekä
palautustodennus ovat kesken. [M1:n checkpoint](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8239)
omistaa rajatun näytön ja puuttuvat portit.
Omistaja hyväksyi 6.10.2026 rajatun selvityseston vanhalle approved-laskulle,
jonka SMTP-historian tarkoitusta ei voida todentaa. Backendin esto ja
selkeä UI-virhepalaute on toteutettu; laskun ja historian luku säilyy.
Tunnetun R02-jälkitilan null-viitteiden säilyminen ja estot on todennettu
aidon 038 -> 039 -migraation läpi. Tämän jälkeinen backendin laskutus- ja
composition-sarja läpäisi 1 587 testiä 130 tiedostossa. Rajattu riippumaton
katselmus valmistui; siinä löytynyt kahden UI-toiminnon ennenaikainen
PDF-pyyntö korjattiin ja todennettiin. Laskutuksen web-sarja läpäisi
586 testiä 78 tiedostossa, ja backendin sekä webin tyypitys läpäisivät.
Legacy-lähetyksen, käyttöliittymän ja palautuksen
yhtenäinen sovitus on yhä kesken. Osittaista toteutusta ei julkaista käyttäjälle.
Säilytetyn legacy-PDF:n kirjoittamaton täsmäluku on tämän jälkeen lisätty:
valmistelun, esikatselun ja kertaluvan järjestys on täsmennetty
[omistavassa suunnitelmassa](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9373).
Sen jälkeen lomakkeen esivalmistelu sekä täsmäesikatselun HTTP-, client- ja
desktop-rajat on kohdetodennettu. Uusin laskutus-/composition-/HTTP-
lokitusregressio läpäisi 1 676 testiä 136 tiedostossa, API-client 191 testiä ja desktopin
kohdesarja 87 testiä. Lomakkeen täsmäesikatselu on nyt kytketty ja
vanhentuneen valmisteluvastauksen puute korjattu. Webin 885 testiä ja build
läpäisivät; rajattu selainnäyttö käyttää eksplisiittisiä preflight-/native-
testisovittimia. SMTP-prepare/sendin täsmäkohde ja pakollinen native-vahvistus
ovat tämän jälkeen työpuussa kohdetodennettuja: laskutus/composition
1 747, API-client 266, web-kohdesarja 50 ja desktop-kohdesarja 72 testiä
sekä koko työtilan tyypitys läpäisivät. Rajattu lähdekatselmus ei löytänyt
uusia korjattavia puutteita. Koko web-sarja läpäisi 900 testiä ja kaksi
normaalirevision Electron-vahvistuskoetta läpäisivät oikean main-/backend-
ketjun nykyisillä dialogi-/SMTP-testisovittimilla. Oikean legacy-/native-kokonaisketjun, historian
käyttöliittymän ja palautuksen hyväksyntä ovat edelleen avoinna.
Onnistuneen lähetyksen jälkilukuvirheen UI-palaute on tämän jälkeen
korjattu: kehotus uuteen valmisteluun korvautuu onnistumisen ja tarkistustarpeen
kertovalla viestillä ilman automaattista uudelleenlähetystä. Rajattu
selainkoe, backendin 17 composition-testiä, desktop-protokollan 21 testiä
ja koko webin 911 testiä läpäisivät; riippumaton kohdekatselmus valmistui.
Myös hyväksytyn laskun tapahtuma-PDF:n client/UI/native-polku on tämän jälkeen
[kohdetodennettu](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8839):
vanha toimitus säilyttää alkuperäiset tavut muokkauksen ja uudelleenhyväksynnän
jälkeen. Selain- ja development-Electron-kokeet sekä laskutuksen 1 795,
webin 939 ja desktopin 160 regressiota läpäisivät. Editorin jatkokytkentä
on tämän jälkeen todennettu backendin auktoritatiivisella lukusopimuksella,
39 rajatestillä sekä selain- ja development-Electron-polulla. Myös koko
webin 947 ja API-clientin 314 testiä läpäisivät. Myös
[legacy-native-uudelleenlähetys ja peruutus](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8878)
on tämän jälkeen todennettu startup-migraation ja restartin yli.
[B5:n katalogi- ja palautuskytkentä](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8913)
on toteutettu ja alemmilla testitasoilla todennettu. Hardened Windows
-kehityspaketin moniversioinen ja alkuperäisen 038-backupin palautus
läpäisivät. Legacy-testin CI-ajokytkentä ja salatun virheaineiston keräys
on kohdetodennettu. Katselmuksen current-PDF-esikatselun ja historian
turvallisen virhepalautteen puutteet on korjattu. Hyväksytyn legacy-laskun
ensimmäisen toimituksen revisiosiirtymä on kohdetodennettu, mukaan lukien
oikeusrajat ja suora itselle-testilähetys fake-providerilla. Loppukatselmuksen
legacy-arkistokopion täsmäsidonta on korjattu ja todennettu regressioilla
sekä viidellä development-Electron-kokeella. Riippumaton jatkokatselmus on
suljettu. Seuraavana ovat puhtaan revision paketointinäyttö ja PR/main. Koko testisarjan
erillinen workspace-adoption aikakatkaisu on edelleen avoin, ei korjatuksi
merkitty yhden kohdennetun uusinnan perusteella.
Nykyinen jatkamiskohta säilyy M1-suunnitelmassa.
Koko B:n hyväksyntä ja 0.3.0-julkaisu ovat edelleen avoinna.

Alla säilyy tähän johtanut integraatiohistoria; sen silloiset avoimet
main-portit eivät avaa hyväksyttyjä vaiheita uudelleen.

PR #283 on yhdistetty ja mainin omat
normaali CI sekä riippuvuustarkistus ovat hyväksyttyjä.
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
sitoo hyväksynnän revisioon ja säilyttää vanhat timeout-/ETL-havainnot
avoimina. Ennen A1:tä hyväksytty rajattu
[pnpm-bootstrapin tietoturvahuolto](release-0.3.0-integration-history.md#m1-source-preparation-l10353):
pnpm `11.11.0`, bootstrapin oma haavoittuvuusportti ja Dependabot-seuranta
on todennettu. Samassa PR:ssä hyväksyttiin Windowsin ja Linuxin rajattu
salatun ensivirheaineiston toimitus. Keräys ei palauta vanhoista ajoista
puuttuvaa aineistoa eikä takaa kaikkien mahdollisten vikojen juurisyytä.
[Lopullinen checkpoint](https://github.com/eky-software/eky/pull/283#issuecomment-5959719891)
erottaa riippuvuusturvan, toimintatestien ja hälytysten readbackin näytön.
[A1/R01:n luonnoksen avaamisen kohdesuoja](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde)
on hyväksytty PR #288:n mainissa. Sen jälkeinen
[MSI-virheaineiston toimituskorjaus](release-0.3.0-integration-history.md#m1-source-preparation-l10312)
ja PR #290:n main-portit on hyväksytty. Alkuperäisen MSI-hylkäyksen
juurisyy sekä vanha rollback-testihavainto säilyvät avoimina omille
revisioilleen; niitä ei merkitä A1:n sovellusvioiksi tai myöhemmin korjatuiksi.
A2/R05 ja sen rajattu MSI-integraatiojatko ovat hyväksyttyjä jatkokehitykseen
PR #292:n mainissa tapauskohtaisella Electron-uusintapäätöksellä. Mainin
CI jäi punaiseksi flaky-tuloksen vuoksi; syytä ei ole todistettu korjatuksi.
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
erottaa hyväksynnän ja avoimen havainnon. Omistajan hyväksymä
[Oma yritys -tallennuksen kahden vian korjaus](release-0.3.0-integration-history.md#m1-source-preparation-l10215)
vietiin tämän jälkeen omaan integraatioonsa.
Hyväksytty etenemisjärjestys on rajattu palautustestin siivouskorjaus,
Oma yritys -korjausten PR/main-hyväksyntä ja vasta sen jälkeen A3/R06.
Palautustestin siivous, erikseen hyväksytty rollback-testin jako ja
Oma yritys -korjaukset on katselmoitu ja hyväksytty PR #293:n mainissa
`b7194db56208c3526ed48b94083849a404f28ab8`. Sen omat 11 porttia ja
kaksi asennuskoetoistoa läpäisivät ilman uusintoja. Tämä ei sulje vanhojen
aikakatkaisujen juurisyitä. Myös
[A3/R06](invoicing-ui-roadmap.md#a3-hyväksyntävalmiuden-vastaussidonta) on
hyväksytty PR #294:n mainissa `082e187bb680b1c7a8dc5d0a5e967adf33403a7a`.
[Loppuhyväksyntä](https://github.com/eky-software/eky/pull/294#issuecomment-5980132408)
sulkee A-paketin kolme korjausta. Sitä seurasi
[B1/B2:n rajattu toteutus](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8175)
B0:n hyväksyttyjen rajausten pohjalta.
B1/B2 on yhdistetty PR #295:ssä, mutta sen main-hyväksyntä jäi avoimeksi
Electronin loppusulun hylkäyksen vuoksi. Silloinen integraatiojatko oli
[hyväksytty rajattu sulkukorjaus](release-0.3.0-integration-history.md#m1-source-preparation-l7520)
ja sen PR #296:n jälkeinen lifecycle-todisteen salatun keräyksen täydennys.
PR-portit läpäisivät, mutta uusi main-kierros hylättiin toisen testin
loppusulun aikakatkaisuun. Muuttumattomat PR/main-portit säilyvät;
keräysjatko ei avaa T3:a eikä nimeä CI-häiriötä korjatuksi.
B1/B2:n lopullinen hyväksyntä on PR #297:ssä. B3-B5:n toteutus,
D-paketin muut ehdot ja koko 0.3.0 ovat edelleen avoinna.

**M0, T1, T2, T3/R28 ja A1/A2/A3 on hyväksytty; M1:n muu työ on avoinna.**
Myös T-paketin jälkeinen integraatiojatko on hyväksytty PR #281:n mainissa.
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
omistaa täsmällisen lähtörevision, sen omat portit ja avoimet
historialliset havainnot. Tämä sulkee T-paketin, ei M1:tä tai 0.3.0-julkaisua.

</details>


<a id="m1-unit-roadmap-467-617"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-plan.md:467-617` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-roadmap-l467"></a>

### PR #282:n valmisteluhistoria

Alla säilyvät vaiheittaiset päätökset ja silloiset avoimet portit.
PR #282:n lopullinen integraatiotila on yllä linkitetyssä M1-checkpointissa;
historia ei avaa vanhoja tutkimuksia tai hyväksyntäkierroksia uudelleen.

T3:n nykyohje, testinkirjoittajan pikaohje ja historian lukureitit on
selkeytetty rajattuna dokumentointityönä. Linkit, historian säilyminen ja
kolmen esimerkin tyypit on tarkistettu; sovellus- tai E2E-testejä ei ajettu
tämän työn perusteella. Testikoodia, aikarajoja, riippuvuuksia tai
CI-vaatimuksia ei muutettu dokumentointiosuudessa. Sen PR #282:n auditointi
löysi kuitenkin nykyisen `undici@7.29.0`-haavoittuvuuden: omistaja hyväksyi
rajatun `7.29.1`-korjauspäivityksen ennen mergeä. Erilliset upgrade/rollback-
tuloskirjoituksen ja workspace-asennusodotuksen CI-hylkäykset säilyvät
selvityskohteina. [M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
erottaa nämä esteet A1:stä; riippuvuuden korjaus ei yksin hyväksy integraatiota.
Oma integraationäyttö kirjataan erikseen, eikä PR #281:n tulosta nimetä
tämän palan testitulokseksi.
Revision `9756e90e` erillinen CI-valmisteluhylkäys tapahtui Corepackin
pnpm-latauksessa ennen legacy/core-testejä. Omistaja hyväksyi saman pnpm:n
[varmennetun npm-valmistelun](dependency-policy.md#ci-paketinhallinnan-valmistelu)
ilman työkaluversioiden tai testiehtojen muutoksia. Valmistelukorjauksen ja
Undici-päivityksen revision `35ba04c0` PR-portit läpäisivät;
[M1:n jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
sitoo näytön täsmälliseen revisioon. Ennen mergeä tehdään lisäksi omistajan
hyväksymä [Electron 43.7.6 -turvallisuuspäivitys](local-desktop-dependency-review.md#electron-4376--turvallisuuspäivitys)
nykyisine runtime-, tietokanta-, packaged- ja CI-portteineen. Sen todennus
on kesken, eikä aikaisempi vihreä ajo hyväksy uutta runtimea. Vanhojen
timeout-havaintojen syyepävarmuus säilyy.
Tavallinen workspace-sarja läpäisi rajattujen testiapurikorjausten jälkeen.
Puhtaalla revisiolla `1e91b328` täysi Electron-sarja 46/46, normaali
desktop-stress ja täysi 30 minuutin soak läpäisivät ilman vaatimusten
lievennystä. Aiemmat käynnistys-, luku- ja stress-hylkäykset säilyvät
erillisinä havaintoina; niiden kaikkia juurisyitä ei väitetä korjatuiksi.
Rajattu käynnistyskoodien diagnostiikkakorjaus on toteutettu ja katselmoitu:
89 sopimustestiä, tyypitys ja yksi normaalisti valmisteltu aktivointikoe
läpäisivät. Tämä ei osoita aiemman käynnistysvirheen syytä korjatuksi eikä
korvaa kokonaisen testisarjan hyväksyntää.
Omistajan hyväksymä rajattu jatko erottaa
[V1:n virhetietoketjun ja V2:n runtime-/integraatioportit](release-0.3.0-integration-history.md#m1-source-preparation-l11395).
V1:n oikeaprosessikoe säilytti tunnetun backend-syyn lopulliseen raporttiin
ja seuraavien ajojen yli; tavallinen käynnistyspolku läpäisi. V1:n
revisioon `8bcf1c74` suljettua ketjua täydensi revision `27a0b6c3`
katselmoitu loppuprojektion korjaus ja sen regressiot.
V2:n pakollisessa full auditissa löytyneen `brace-expansion`-riippuvuuden
rajattu `5.0.12`-päivitys hyväksyttiin erikseen. Puhtaan revision
`b5833b22` uusi tuotantopayload ja synteettinen hardened-palautus samalla
paketilla läpäisivät. Production/full audit, 160 rekisteriallekirjoitusta
ja 253 nykyistä paketointisopimusta läpäisivät. Lopullisen revision
omat PR/main-portit ovat seuraava työ, eivät vielä hyväksytty tulos.
Revision `416d06f3` ensimmäinen PR-ajo hylkäsi raportointiregression keräyksen
sekä legacy-päivityksen payload-tarkistuksen. Raportointitestin tarpeeton
build-riippuvuus on rajatusti korjattu ja alemmilla testeillä todennettu;
legacy-haaran samaversion tiedostojen korvauspuute on todennettu.
Omistaja hyväksyi rajatun `emus`-korjauksen ja sen Type 51 -toteutuksen;
regressiot sekä synteettisen MSI:n rakennus- ja metadatatodistus läpäisivät.
Revision `5a8dd5d6` oikean pakettiparin molemmat hiljaiset legacy-päivitykset
läpäisivät täydellisen sisältövertailun ja käynnistykset; rajattu CI oli
15/15 vihreä. Revision `0fa4c2f3` täydentävä synteettinen MSI-koe läpäisi
48/48 sopimustestiä ja todensi UI-oletuksen, eksplisiittisen ohituksen sekä
uudemman tiedostoversion suojan siivouksineen. Normaali PR/main-integraatio
ja riippuvuushälytysten oletushaaran tila ovat edelleen avoimia;
kohdennetut kokeet eivät korvaa näitä portteja.
Integraatiotarkistuksen pakettivälimuistin testiaikakatkaisu käsitellään
[rajatulla valmistelumuutoksella](release-0.3.0-integration-history.md#m1-source-preparation-l11986)
säilyttäen molemmat keskeytyshaarat, täsmälliset sisältöehdot ja aikarajan.
[M1:n nykyinen checkpoint](release-0.3.0-integration-history.md#m1-source-preparation-l11526)
omistaa tarkemman näytön ja V2:n sulkemisehdot.
Revision `fa343f19` normaali PR-kierros hylkäsi backup-fixturen
valmistelubackendin valmiusodotuksen ennen Electronin käynnistystä.
Ensivirheen ja siivouksen tiedot säilyivät; automaattisen toisen yrityksen
läpäisy ei hyväksy kierrosta. Hyväksytty [rajattu valmiuskyselyhavainto ja sen todennus](release-0.3.0-integration-history.md#m1-source-preparation-l11675)
on toteutettu. Revision `8913dc48` normaali PR-kierros läpäisi kaikki kolme
E2E-perhettä sekä installer-/legacy-ryhmät, mutta yksi packaged-workspace-
ajo saavutti jobin aikarajan ja koonti hylättiin. [M1:n riskiperusteinen jatko](release-0.3.0-integration-history.md#m1-source-preparation-l10489)
omistaa nykyisen näytön ja seuraavan rajatun tutkimuksen. Hyväksytty
[ensivirheen, yhden uusinnan ja määräaikaisen kehityspoikkeuksen käytäntö](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus)
ei muuta kriittisiä hyväksyntäportteja tai hyväksy tätä hylkäystä.
Nykyinen erikseen rajattu tehtävä kattaa vain tämän Windows-aikakatkaisun
näyttöön perustuvan korjauksen, kohdetestit, oikean paketin todennuksen ja
katselmuksen. [M1:n työn rajaus](release-0.3.0-integration-history.md#m1-source-preparation-l10558)
erottaa sen myöhemmästä PR/main-integraatiosta, mergestä ja A1:stä.
[Ainoa diagnostinen uusinta](release-0.3.0-integration-history.md#m1-source-preparation-l10829)
läpäisi samalla lähteellä ja alkuperäisellä paketilla. Sen 21 komentovaihetta
ja pakollinen lopputulostarkistus valmistuivat, mutta alkuperäinen syy ja
korjaus eivät ole todennettuja. Uusintaraja on käytetty. [Hyväksytty rajattu katkaisukoe](release-0.3.0-integration-history.md#m1-source-preparation-l10943)
säilytti komennon ja kesken jääneen vaiheen havainnot CI-komentoaskelen
katkaisun yli; koko analyysi jäi hylätyksi synteettisestä kokeesta puuttuvien
MSI-tapahtumien vuoksi. Omistaja hyväksyi tämän jälkeen yhden
[workspace-success-havaintokokeen](release-0.3.0-integration-history.md#m1-source-preparation-l10982)
alkuperäisellä paketilla ja nykyisen tallennuksen rajatulla kytkennällä.
[Kokeen tulos](release-0.3.0-integration-history.md#m1-source-preparation-l11023):
caller, pakollinen verifier ja kaikki 21 komentovaihetta läpäisivät, mutta
erillinen jäljen vientityökalu epäonnistui ennen lukijaa. Koko diagnoosi
on hylätty, alkuperäinen vika ei toistunut eikä syytä ole varmistettu.
Uutta ajoa ei käynnistetä automaattisesti. Tutkimustulos ei ole
PR/main-hyväksyntä eikä Goal ole tällä valmis.
[Tutkimuspaketin päätösraportti](release-0.3.0-integration-history.md#m1-source-preparation-l11058)
vahvistaa, ettei saman ajon ETL:ää tai raakaa vientivirhettä ole saatavilla
tarkistetuista aineistolähteistä. Pienin jatkoehdotus on nykyinen no-MSI-
vientikoe vasta yksityisen luku- ja säilytysreitin ratkettua, ei uusi
asennuspäivitys tai automaattinen hyväksyntäkierros. Playwrightin
ensiyrityksen trace säilyy erillisenä rajattuna jatkoehdotuksena.
[Yksityisen vientiaineiston säilytysehdotus](release-0.3.0-integration-history.md#m1-source-preparation-l11120)
rajaa työn yhteen no-MSI-kokeeseen, erilliseen yksityiseen säilytyspaikkaan
ja nimettyihin käyttöoikeus-/säilytysrajoihin. Omistaja hyväksyi repositoryn
perustamisen, rajatun raakasiirron ja kertakokeen. Yksi jäädytetyn lähteen
ajo [päättyi käynnistimen ennakkotarkistukseen](release-0.3.0-integration-history.md#m1-source-preparation-l11277)
ennen fixtureä ja tallennusta. Omistajan erikseen hyväksymä yksi korjattu
no-MSI-koe samalla lähteellä [läpäisi tallennuksen ja vientianalyysin](release-0.3.0-integration-history.md#m1-source-preparation-l11319).
Käynnistimen tarkistukset läpäisivät 17/17; korjaus todennettiin myös
hosted-ajossa. Molemmat aineistoerät säilytettiin yksityisesti ja niiden
eheys varmennettiin. Kokonaissiivous säilyy varmentamattomana, eikä uusi
läpäisy ratkaise vanhaa vientivirhettä tai alkuperäistä timeoutia.
Käynnistin ja ajon salliva portti on suljettu. Vientitutkimus päättyy
päätösraporttiin ilman automaattista lisäajoa; normaalin hyväksynnän
avaamiseen tarvittava näyttö tai uusi valmistumisehdon päätös puuttui
tuolloin. Uudempi päätös on kirjattu alla.
Maksullista käyttöä ei sallita. Yksityisestä kokeesta ei tule tavallista
ajopaikkaa: EKY:n julkisuus ja normaalit CI-portit säilyvät.
Omistaja hyväksyi seuraavaksi [salatun tutkimusaineiston rajatun välitavoitteen](release-0.3.0-integration-history.md#m1-source-preparation-l10564):
nykyisen workspace-kuluttajan nimetty aineisto salataan GnuPG:llä ennen
julkista artifact-siirtoa. Purkuavain jää paikalliseksi, salattu liite
säilyy yhden vuorokauden ja käyttöönotto edellyttää avaimen purkutestiä.
Toteutus ei muuta normaaleja hyväksyntäehtoja tai sulje vanhoja havaintoja.
Paikallinen salausportti läpäisi, mutta ensimmäinen synteettinen hosted-
toimituskoe hylättiin ennen liitteen syntymistä. Toimituksen hyväksyntä
oli vielä avoin. Vaihe-erottelun ja turvallisen sisäisen virhekoodin välityksen
jälkeen kolmas koe hylättiin koodilla `EVIDENCE_GPG_UNAVAILABLE`.
Usean Git-osuman työkaluhakuvirhe toistettiin ja korjattiin; rajatut
regressiot läpäisivät 63/63. Omistajan hyväksymä korjatun revision
`f69f3d76` [kertakoe 36930438493](https://github.com/eky-software/eky/actions/runs/36930438493)
sekä yksityinen purku- ja sisältötarkistus läpäisivät. Rajattu salatun
toimituksen välitavoite on hyväksytty; keräyksen vahvistus on käytössä.
[M1:n hyväksyntä ja seuraava etenemispäätös](release-0.3.0-integration-history.md#m1-source-preparation-l10700)
erottavat toimituksen valmistumisen vanhasta timeoutista. Omistaja hyväksyi
2.10.2026 yhden jäädytetyn revision normaalin CI-kierroksen sekä rajatun
Goalin valmistumisehdon muutoksen: vanha timeout jää avoimeksi havainnoksi,
mutta sen jälkikäteinen juurisyy ei estä uuden revision hyväksyntää.
Kaikki nykyiset pakolliset tarkistukset säilyvät. Merge ja A1 eivät kuulu
tähän päätökseen; tulos hyväksytään vasta kierroksen todennuksen jälkeen.
Alkuperäisten timeoutien syitä ei väitetä ratkaistuiksi. Ei asennuskorjauksen
tai T3:n uutta toteutusta.
Seuraava tuotantopala on [A1/R01](invoicing-ui-roadmap.md#a1-avattavan-luonnoksen-kohde)
uuden preflightin ja omistavan aloitusportin kautta. Laaja ohjeverkon
tarkistus pysyy [M3:n I-paketissa](release-0.3.0-plan.md#m3-muut-invariantit-diagnostiikka-ja-ylläpidettävyys);
ei uutta rinnakkaista roadmapia tai arkkitehtuuriremonttia.

<details>
<summary>Aiemmat checkpointit ja M0:n tapahtumahistoria (ei nykyinen työjono)</summary>


<a id="m1-unit-roadmap-618-900"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-plan.md:618-900` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-roadmap-l618"></a>

### Integraatiota edeltävä checkpoint 2026-09-28

Seuraava tilannekuva ja aiemmat checkpointit säilyvät historiatietona.
Niiden nykytila-, seuraava työ- ja pending-ilmaukset koskevat omaa
checkpointiaan, eivät yllä hyväksyttyä integraatiota. Testimäärät ja
hylkäysten syyepävarmuudet pysyvät sidottuina alkuperäisiin näyttöihin.

**Nykytila 2026-09-28: M0, T1 ja T2 hyväksytty; T3/R28 kesken.**
**Viimeisin täysi normaali baseline on `5bbfd4834707b77e1211851a6fb21b09b8572a66`.**
Sen [normaali CI](https://github.com/eky-software/eky/actions/runs/36443256758)
ja [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36443266084)
läpäisivät ensimmäisellä yrityksellä. Normaali CI: 38 onnistunutta ryhmää ja
yksi tarkoituksellinen valinnainen ohitus, kaikki neljä kokeellista valitsinta
pois. System 689/690 ja yksi tunnettu alustasuoja, web 37/37 ja Electron 38/38;
ei retryä tai flakyä. Koko tapausjoukko, kaikki 38 checkoutia sekä neljän
tuottajan ja kymmenen kuluttajan artifact-sidonnat on takaisinluettu.
Tämä avaa seuraavan rajatun Linux-kuluttajatyön, ei sulje T3:a tai PR/main-portteja.
Uudemman revision `7f8df53a16770b5e3206c179ff8f497b76c6cf24`
[rajattu Linux-CI](https://github.com/eky-software/eky/actions/runs/36456205257)
läpäisi ensimmäisellä yrityksellä: system 698/699 ja yksi tunnettu
alustasuoja, web 37/37, kaikki seitsemän
[todellisen kuluttajan katkeamiskoetta](e2e-test-environment-history.md#linuxin-todellisten-kuluttajien-katkeamiskokeet)
sekä erillinen endurance 1/1. Lähde, tapausjoukot ja siivoustodisteet on
takaisinluettu; retryä tai flakyä ei ollut. Tämä ei ole uuden revision
täysi normaali CI. Vastaavan näytön kattamat vanhat aktiiviset Electron-
testien varapolut ja kaksi korvattua siivousapuria on nyt poistettu.
Poiston kohdesarja 151/151, puhtaat Electron-sopimukset 10/10, koko
workspacen tyypitys ja CI-sopimukset 318/318 läpäisivät; poistolla on
riippumaton hyväksyvä katselmus. Poiston jälkeinen tavallinen Windows-sarja
läpäisi 781/781 ensimmäisellä yrityksellä (system 693, web 43, Electron 45),
ilman ohituksia, retryä tai flakyä. Koko workspacen testit läpäisivät
peräkkäin; aiempi rinnakkaisajon timeout säilyy ratkaisemattomana havaintona.
Pysyvän matriisin kaksi täsmennystä on todennettu: juuren poistumisen jälkeen
haarautuva jälkeläinen sekä native-resumen virheestä saman omistajan
siivoukseen kulkeva ketju. Jälkimmäinen sisältyy nyt tavalliseen valmisteluun;
sen pipe-kytkentä ja suljettu raportti läpäisivät 31/31 sopimustestiä ja
riippumattoman katselmuksen. Tuotanto ja aikarajat säilyvät.
Seuraavana ovat täsmällisen PR/main-revision omat tarkistukset.
[Ajantasainen jatkamiskohta](release-0.3.0-integration-history.md#m1-source-preparation-l3)
omistaa seuraavan työvaiheen; aiempi vihreä ajo ei hyväksy uutta lähdetilaa.

<a id="m1-source-roadmap-l659"></a>

### Aiemmat checkpointit

Alla säilyvät aiempien korjausten ja hylkäysten omat checkpointit.
Windows-Electronin nykyisen kadenssin stress ja täysi 30 minuutin soak
sekä alkuperäisen virheen säilymisen kaksi rajattua todellisen fixturen
koetta on nyt paikallisesti todennettu. Omistaja hyväksyi 28.9. yhteisen
Chromium-selaimen testikohtaisella eristyksellä sekä paikalliset Windows-testit
ja Linux-CI:n. Näiden kuluttajasiirrot ovat käynnissä: worker-Chromiumin
tavallinen Windows-web-sarja läpäisi uusimmalla yhteisellä toteutuksella
43/43, system-sarja 689/689 ja kanoninen stress-portti. Yhteyden/siivouksen
kohdesarja 50/50, oikeat Windowsin owner-/caller-loss-kokeet sekä uusittu
artifact-/retry-koe on myös todennettu. Yhteinen Linux-kytkentä on toteutettu
ja työkalusarja 734/734 läpäisty. Revision `6e670190` ensimmäinen
[normaali CI](https://github.com/eky-software/eky/actions/runs/36419875442)
hylkäsi kuitenkin Linuxin oikeat system/web-kuluttajat sekä tukipaketin
kokorajatestin aikakatkaisun. Riippuvuustarkistus läpäisi; tämä ei hyväksy
muuta ajoa. Ensimmäiset virhetiedot säilyvät; baselinen korjaus oli ehto
seuraavalle toiminnalliselle vaiheelle. [Rajaus ja avoin näyttö](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci)
erottavat nämä toisistaan. Tämä rajattu näyttö ei sulje T3:a.
Seuraavan diagnostiikkarevision `5c8bb24a`
[CI:ssä](https://github.com/eky-software/eky/actions/runs/36423687950)
workspace-portti läpäisi, mutta Linuxin samat system/web-hylkäykset säilyivät.
Palvelun käynnistysvaiheen virherivi ei syntynyt; tämä ei todista onnistunutta
backendin health-vaihetta. Tätä seurannut korjaus kohdistui Linux-testibackendin
puuttuvaan alkuperäisen OS-temp-juuren ankkuriin. Oikean config-readerin
regressio sekä suljettu backend-/Chromium-vaiheiden raportointiketju
todentavat rajauksen; korjatun revision tavallinen Linux-CI oli tuolloin avoin.
Korjauksen Windows-system 690/690, web 43/43, työkalusarja 740/740 ja
tyypitys läpäisivät. Kaikki pakettitestit läpäisivät paikallisesti peräkkäin;
[säilyvä rinnakkaisajon aikakatkaisuhavainto](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci)
ei muuta CI:n ajotapaa tai aikarajoja eikä ole merkitty korjatuksi.
Revision `201600aa` [CI](https://github.com/eky-software/eky/actions/runs/36431463750)
todensi backendin health-vaiheen: Linux-systemissä läpäisi 688/690,
yksi Vite-composition-testi hylättiin ja yksi tunnettu alustasuoja ohitettiin.
Webin 36 hylkäystä ja yksi sarjan keskeytysohitus säilyivät. Koko ajo päättyi
hylättynä: 35 ryhmää läpäisi, kolme hylättiin ja yksi valinnainen koe ohitettiin;
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36431475154)
läpäisi. Viten kiinteästä testiympäristöstä löytyi sama puuttuva temp-ankkuri.
Rajattu jatkokorjaus käyttää backendin ja Viten yhteistä validoitua asetusta:
RED/GREEN-sopimus, oikean Vite-readerin 13 turvarajatestiä, työkalusarja
740/740, tyypitys ja Windows-system 690/690 läpäisivät; katselmus hyväksytty.
Vite-korjauksen `c2bae3a2` [oma CI](https://github.com/eky-software/eky/actions/runs/36435533813)
läpäisi Linux-systemin 689/690 (yksi tunnettu alustasuoja) ja webin 37/37
ilman retryä tai flakyä. Koko tapausjoukko vastaa puhtaan revision katalogia;
Chromium-workerin siivous ja juuren poisto varmistuivat.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36434517009)
läpäisi 160 varmennetulla allekirjoituksella. **Koko CI päättyi hylättynä:
36 ryhmää läpäisi, kaksi hylättiin ja yksi valinnainen koe ohitettiin.**
Workspace-faultin toinen ajo ylitti nykyisen aikarajansa `targetInstall`-
vaiheessa; palautumiskoe ei ehtinyt alkaa. Supervisor varmisti prosessipuun
siivouksen. Tämä ei osoita odotuksen juurisyytä. Rajatut
[asennusodotuksen alavaihehavainnot](windows-installer-acceptance-harness-v2.md#workspace-asennusodotuksen-havaintoraja)
ja niiden sopimustestit on toteutettu; niiden oma seurattu CI hyväksyttiin
yllä mainitulla `5bbfd483`-revisiolla. c2-timeoutin juurisyy jää avoimeksi.
[Tarkka tila](e2e-test-environment-history.md#chromiumin-ja-linuxin-ensimmäinen-yhteinen-ci)
erottaa hyväksytyn baselinen historiallisista hylkäyksistä; T3 pysyy avoinna.
Tuotanto, Chromiumin asetukset, sovelluksen E2E-tapausjoukot ja aikarajat säilyvät.
[Aiemmat hylkäykset ja korjauksen rajaus](e2e-test-environment-history.md#windows-electron--valmistelun-ci-hylkäys)
säilyvät historiatietona; läpäisy ei ratkaise aiemman satunnaisen
poistumisen syytä eikä hyväksy koko T3:a tai PR/main-integraatiota.
Stress-portin ensimmäinen yritys hylättiin testin vanhentuneen
työtilamittauksen vuoksi. [Rajattu korjaus ja loppunäyttö](e2e-test-environment-history.md#windows-electronin-endurance-ja-virheen-säilymisen-loppunäyttö)
erottavat säilyvän hylkäyksen korjatun polun läpäisseistä ajoista.
Mittauskorjauksen oma CI-portti on nyt hyväksytty: 38 onnistunutta ryhmää
ja yksi tarkoituksellinen valinnaisen kokeen ohitus. System 637 valittua
(636 läpäisyä ja yksi tunnettu alustakohtainen ohitus), web 35/35 ja
Electron 38/38 ilman retryä tai flaky-tulosta. **Electronin rajattu
kuluttajaosuus on valmis; koko T3 ja PR/main-integraatio eivät ole.**
Lähtörevision vihreä CI ei hyväksy myöhempää koodimuutosta.
Jatkamisen lähtörevisio, avoin puute, seuraava työ ja valmistumiskriteeri
ovat [M1:n ajantasaisessa aloituskohdassa](release-0.3.0-integration-history.md#m1-source-preparation-l3).
Nykyinen eteneminen on **T3:n oikeat kuluttajat ja korvatun toteutuksen
poisto -> M1:n rajatut sovelluskorjaukset -> integraatio ja 0.3.0**.
Uutta testialustan tai sovellusarkkitehtuurin rinnakkaista uudistusta ei aloiteta.
T3 ei valmistu pelkillä kokeilla tai diagnostiikalla. Uusi moduulitesti käyttää
yhteistä fixtureä, ei rakenna omaa prosessienhallintaa.

**Uusin päätös 2026-09-28:** [Chromiumin worker-omistajuus ja testikohtainen
eristys sekä Windows-paikallinen/Linux-CI-rajaus](e2e-test-environment-history.md#chromiumin-kuluttajasiirron-avoin-omistajuusraja)
on hyväksytty. Toteutus käyttää nykyisiä omistajuusmekanismeja ja aikarajoja.
Paikallista Linux/WSL-E2E-tukea tai hostin oikeuksien muutoksia ei tarvita.
Koko T3:n valmistumiskriteerit ja täsmällisen revision portit säilyvät.

**Edeltävä valtuus 2026-09-27:** koko nykyisen T3/R28:n toteutus, testit ja
normaali PR/main-integraatio saavat jatkua hyväksytyssä rajauksessa ilman
toistuvia välilupia. Nimenomainen päätös kattaa myös `playwright-core@1.62.1`-
patchin lapsittoman Windows-bridgen rajatun lopetuslisäyksen ja testit;
lisäpatch ja E2E-only-ikkunapidätys on nyt toteutettu, katselmoitu ja
paikallisesti todennettu. Goal-työkalun aktiivinen tila on varmennettu
takaisinluvulla; aiempi `blocked`-kirjaus on historiallinen, ei nykyinen
etenemiseste. Aktiivinen Goal ei tarkoita valmista T3:a.

**Aiempi paikallinen fixture-hyväksyntä:** Windows-Electronin tavallinen
pääfixture on kytketty bridge-/native-omistajaan. Samaan lähdetilaan sidotut
E2E-tyyppitarkistus, kohdesopimukset 186/186 ja kanonisen valmistelun jälkeinen
tavallinen `electron-development` 45/45 läpäisivät ensimmäisellä yrityksellä.
Riippumaton takaisinluku vahvisti lähdesidonnan ja koko tavallisen tapausjoukon.
Myös erilliset restart/relaunch-, toinen instanssi-, owner-loss- ja caller-loss-
kokeet on hyväksytty; aiemmat hylätyt yritykset säilyvät hylättyinä.
Aiemmat patchin, neljän käynnistys-/ikkunakokeen, workspacen ja riippuvuus-
sekä pakettisisältöporttien tulokset pysyvät omina lähdesidottuina näyttöinään.
Tarkka rajaus ja säilyvät hylkäykset ovat
[omistavassa checkpointissa](e2e-test-environment-history.md#electron-bridgen-lopetuspolun-jatkoehdotus).
Tämä hyväksyy pääfixturen normaalin paikallisen kuluttajakytkennän, ei sen
koko virhematriisia, endurancea, koko T3:a tai uuden revision etä-CI-/PR/main-portteja.

Lisäksi todellisen fixturen julkisen sulkemisen ja portin vapautumisen
epävarmuuskokeet läpäisivät: molemmat restart-yritykset estyvät pysyvästi
ja testijuuri säilyy. Handoff-testin rajattu virhesiivous ja sen 24/24-
kohdesarja on katselmoitu ja todennettu. Tarkat hyväksyntärajat ja
koeapurin säilyvät hylkäykset ovat yllä linkitetyssä omistavassa checkpointissa.
Korvattu Windowsin taskkill-varapolku on poistettu. Poiston jälkeinen
tyyppitarkistus ja kanoninen järjestelmätestisarja 607/607 valmisteluineen
läpäisivät ensimmäisellä yrityksellä. Linuxin nykyistä haaraa ei muutettu.
Saman välipaketin koko workspace-testit ja tyyppitarkistus sekä CI-sopimukset
315/315 läpäisivät. Näiden jälkeinen normaali etä-CI hylkäsi yllä kuvatun
Electron-valmistelun; paikallinen näyttö ei korvannut sitä. Yllä mainittu
`5f61f186` on korjauspaketin myöhempi, erikseen varmennettu vihreä baseline.
Chromiumin ja Linuxin myöhemmät hyväksytyt kuluttajasiirrot eivät sisälly
tähän aiempaan näyttöön.

Tässä checkpointissa jäljellä oleva työ oli [M1:n lyhyessä sulkulistassa](release-0.3.0-m1-history.md#m1-source-m1-history-l181):
korvattujen aktiivisten polkujen poisto ja poiston regressiot, koko nykyisen
T3-matriisin näytön yhteenveto sekä täsmälliset PR/main-portit. Chromiumin
worker-/testikohtainen eristys ja Linuxin oikeat kuluttajat on nyt todennettu
yllä rajatuilla ajoilla. Paikallisen Linux-testauksen ympäristöpäätös on ratkaistu.
Hyväksyntä ei tarkoita uutta riippuvuutta, laajempia oikeuksia tai
heikennettyjä vaatimuksia. Seuraava vaihe on hyväksytty toteutus, ei uusi
rinnakkainen arkkitehtuurisuunnitelma.

<a id="m1-source-roadmap-l789"></a>

### Aiemmat checkpointit ja päätösnäyttö

Alla on etenemishistoria; nykyinen seuraava työ luetaan yllä olevasta
M1-aloituskohdasta. Vanhat hyväksynnät eivät hyväksy myöhempää revisiota.

T3b-L:n probe on todennettu ja T3b-E:n Playwright-korjauksen paikalliset
regressiot sekä rajattu Windows-CI ovat läpäisseet. Aiempi kokonaisajo
hylättiin historiallisen 0.2.6-lähtöversion packaged smoke -vaiheessa;
seuraavassa normaalissa ajossa havaittiin erillinen
[rollback-prosessisopimuksen hylkäys](e2e-test-environment-history.md#t3b-en-normaalin-baselinen-rollback-sopimushylkäys).
Edellinen diagnostiikkarevision ajo todensi rollback-sopimukset, mutta
[kaksi Electronin firstWindow-ensiyritystä hylättiin](e2e-test-environment-history.md#t3b-en-toistunut-firstwindow-hylkäys-ja-backendstart-rajaus).
Niiden uusi näyttö rajaa odotuksen testibackendin `backendStart`-vaiheeseen;
juurisyy ei vielä ole todistettu.
Uusi [täsmällisen revision normaali baseline](e2e-test-environment-history.md#t3b-en-vihreä-normaali-baseline)
läpäisi kokonaisuudessaan. T3b-P:n hyväksytyn paketointikorjauksen rajattu
toteutus, regressiot ja katselmus sekä tuore eristetty build ja samoihin
tavuihin sidottu packaged smoke ovat valmistuneet. Uuden revision normaalissa
CI:ssä tuli erillinen [komentoharnessin sopimushylkäys](e2e-test-environment-history.md#t3b-pn-ci-sopimushylkäys-ja-havaintokytkentä);
havaintokytkentä on korjattu, katselmoitu ja paikallisesti todennettu.
Korjatun revision `a1df082c` normaali CI ja riippuvuustarkistus läpäisivät
ensimmäisellä yrityksellä; tarkat checkoutit ja artifact-sidonnat on
varmistettu. Keskeytymisen juurisyy säilyy avoimena. Omistaja hyväksyi
2026-09-26 T3c-W:n ja T3c-L:n rajatut kokeet. Windowsin
[neljä tapausta läpäisivät](e2e-test-environment-history.md#t3c-wn-rajatun-kokeen-checkpoint);
Linuxin ensimmäisen CI-ajon molemmat kokeet
[hylättiin ennen GO:ta](e2e-test-environment-history.md#t3c-ln-ensimmäisen-ci-kokeen-hylkäys).
Käynnistysvirheen tarkka syy ja uuden revision hyväksyntä ovat avoinna.
Omistajan hyväksymä [T3c-LD](e2e-test-environment-history.md#t3c-ldn-rajatun-ci-kokeen-havainto)
rajasi molemmat uudet hylkäykset ennen READYä tapahtuvaan wrapper exit 1:een;
init-merkki puuttui ja stderr jäi tuntemattomaan luokkaan. Koko ajo päättyi
hylätyksi, vaikka muut testiryhmät ja riippuvuustarkistus läpäisivät.
Juurisyy on avoin; [T3c-LS](e2e-test-environment-history.md#t3c-ls-suljetun-stderr-luokan-tarkennuksen-päätösehdotus)
on hyväksytty rajattu lisähavainto, jonka toteutus, testit ja riippumaton
katselmus läpäisivät. [Uuden CI-kierroksen molemmat Linux-tulokset](e2e-test-environment-history.md#t3c-lsn-rajatun-ci-kokeen-havainto)
paikantavat virheen `uid_map`-kirjoitusestoon ennen READYä/GO:ta. Estävä
taustapolitiikka on avoin. Kokonaisajo päättyi hylätyksi vain kahden
Linux-kokeen ja aggregaatin vuoksi; muut testiryhmät ja riippuvuustarkistus
läpäisivät. Omistaja hyväksyi seuraavaksi [rajatun CI-session hallinnan](e2e-test-environment-history.md#t3c-lm-rajattu-ci-testisession-hallinta)
suunnittelun ja toteutuksen Goalin sisällä. Puhtaat oikeus-/unit-sopimukset
ja injektoitu kontrolli-/init-kytkentä on katselmoitu ja testattu;
managerin suoritin, kokonaisajuri ja oikeaprosessinäyttö puuttuvat vielä;
ei vanhan kokeen automaattista uusintaa. Fixture-siirto odottaa mekanismin
ja koko vaaditun matriisin näyttöä; tämä ei ole koko T3:n tai
PR/main-integraation hyväksyntä. Ajurin root-first-odotusjärjestysvirhe on
korjattu ja todennettu, mutta perityn tulostekahvan kirjoittajaidentiteettiä
tai T3c-W:n ensimmäisen ennen launchia tapahtuneen hylkäyksen syytä ei
väitetä ratkaistuksi.
Vihreys ei todista aiempien satunnaisten virheiden juurisyitä.
[Ajantasainen työjärjestys](release-0.3.0-m1-history.md#m1-source-m1-history-l181)
erottaa virheen rajauksen, paketoinnin ja varsinaisen omistajuusratkaisun.
Omistaja hyväksyi T3b-L:n toteutuksen ja yhden seuratun CI-ajon; T3:n loppu
etenee Goalina [nimetyt päätösportit säilyttäen](e2e-test-environment-history.md#t3b-ln-toteutusvaltuus).
Viimeisin varmennettu paikallinen ja etäinen
`main` on T2:n normaali PR #277 -merge
`5cc58b7139a6616bc9403a5724f93d929e90cf25`. Tämän revision
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36094675603) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36094675166)
läpäisivät. Tarkka näyttö on
[PR #277:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/277#issuecomment-5826768078).

M0:n aiempi hyväksytty lähtörevisio on
`38082dffe1772f099c4b9bb7495bed6c6b9b067b`. Tämän täsmällisen revision
[V2-ajo](https://github.com/eky-software/eky/actions/runs/36039663203) ja
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/36039734305)
ovat valmistuneet onnistuneesti. Integraation näyttö on
[PR #275:n integraatiocheckpointissa](https://github.com/eky-software/eky/pull/275#issuecomment-5819025563).
M0 ei sulje T-pakettia eikä todista historiallisen timeoutin tarkkaa syytä.

Omistajan hyväksymä valmistelu-Goal rajattiin **M1-suunnitteluun**, ei koko
0.3.0-toteutukseen. Sen työjärjestys, ensimmäisen toteutuspalan rajaus ja
avoimet päätökset ovat [M1-valmistelusuunnitelmassa](release-0.3.0-m1-preparation-plan.md).
Tuotantokoodia, riippuvuuksia, versiota tai CI-ehtoja ei muutettu.
Omistaja hyväksyi seuraavaksi T1a/T1b:n rajatun toteutus-Goalin: olemassa
olevat testit nykyisiin komentoihin ja ajokytkennän regressiosuoja.
T1 on toteutettu, katselmoitu ja hyväksytty myös PR/main-porttien jälkeen.
Testinäyttö ja integraation viite ovat
[T1-checkpointissa](release-0.3.0-m1-history.md#m1-source-m1-history-l413).
Seuraavan suunnittelu-Goalin tarkka
[T2-rajaus](release-0.3.0-m1-history.md#m1-source-m1-history-l453)
on toteutettu ja paikallisesti todennettu
[T2-checkpointin](release-0.3.0-m1-history.md#m1-source-m1-history-l491)
mukaan. Myös [Linux-CI ja integraatio](release-0.3.0-m1-history.md#m1-source-m1-history-l522)
on hyväksytty. Omistajan hyväksymä T3a-koe on suoritettu;
[tulos ja jatkopäätös](e2e-test-environment-history.md#t3an-tulos-ja-jatkopäätös)
erottavat osittaisen kokeen omistajuusmekanismin hyväksynnästä ja kuluttajien siirrosta.
[T3b-valmistelu](e2e-test-environment-history.md#t3b-virhehaaran-ja-alustarajan-valmistelu)
nimeää lukitun Playwrightin virheenkäsittelyaukon sekä erikseen hyväksyttävän
Linux-CI:n read-only-proben. Hyväksytty probe ja CI-kytkentä on nyt toteutettu,
ja [paikallinen sopimussarja läpäisi 95/95](e2e-test-environment-history.md#t3b-ln-toteutuscheckpoint).
Todellinen Linux-CI-havainto saatiin molemmista kuluttajista kielteisin
pääsyvihjein. [Ensimmäinen CI-checkpoint](e2e-test-environment-history.md#t3b-ln-ensimmäinen-ci-havainto-ja-sopimuskorjaus)
kirjaa T1-kytkentähylkäyksen sekä korjatun revision oman läpäisseen
CI-ajon. Playwright-korjauksen
[paikalliset regressiot ja nykyiset kaksi Electron-koetta läpäisivät](e2e-test-environment-history.md#t3b-en-paikallinen-korjausnäyttö);
sen normaali CI-baseline on sittemmin läpäissyt yllä linkitetyllä revisiolla,
mutta T3:n toimitus- ja PR/main-portit ovat vielä avoinna.
[Ensimmäinen CI-hylkäys](e2e-test-environment-history.md#t3b-en-ensimmäinen-ci-havainto)
rajautui Electron-fixturen käynnistykseen. Hyväksytty testidiagnostiikan
täydennys ja [yksi rajattu Windows-CI-ajo](e2e-test-environment-history.md#t3b-en-rajattu-windows-ci-todennus)
läpäisivät; alkuperäinen timeout ei toistunut eikä sen syytä merkitty
korjatuksi. Tämä ei korvaa koko V2-hyväksyntää.
[Seuraava kokonaisajo](e2e-test-environment-history.md#t3b-en-kokonaisajon-legacy-hylkäys)
valmistui hylättynä: ensimmäinen legacy-consumer epäonnistui, toinen läpäisi.
Tämä on eri havainto kuin aikaisempi development-fixturen firstWindow-timeout.
Payloadin [metatietorajauksen erillinen paketointipäätös](e2e-test-environment-history.md#t3b-p-hyväksytty-metatietorajaus)
on hyväksytty ja sen paikallinen toteutus-, katselmus- ja packaged-näyttö
on todennettu läpäisseen lähtötilan jälkeen. Korjattu T3b-P:n CI-lähtötila
läpäisi yllä kuvatusti; uuden T3c-revision CI on vielä avoinna.
Alustojen omistajuusmekanismi ja tavallisten fixturejen siirto ovat avoimia.
T2 ei sulje M1:n muita testikorjauksia.


<a id="m1-unit-roadmap-901-964"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-plan.md:901-964` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-roadmap-l901"></a>

### M0:n historiallinen tapahtumaketju

Seuraavat välitilat säilyvät historiatietona. Niiden merge-/M1-estot eivät
kumoa yllä varmennettua nykyistä hyväksyntää.

PR #274 yhdistettiin normaalisti mainiin revisiona
`4c18821e1d22e48608b082fc1fa6c54b8ac04a32`, kun täsmällisen PR-pään
`7d6d0f682c3ba374bd70eca387a9ad7f609a54ee` molemmat required checkit
läpäisivät. Mainin oma kokonaisajo hylättiin Electronin ensimmäisen
käynnistyksen testin flaken vuoksi. M0:aa ei merkitä valmiiksi eikä M1:n
tuotantototeutusta aloiteta. Tarkat hyväksyntäviitteet ja uusi päätösraja
ovat [harnessin jälkitodennuscheckpointissa](windows-installer-acceptance-harness-v2.md#m0-mainin-jälkitodennus).
Seuraava rajattu [M0.3-diagnostiikkaehdotus](windows-installer-acceptance-harness-v2.md#m03-ehdotus-electron-testin-vaihekohtainen-näyttö)
on omistajan hyväksymä, toteutettu ja kohdetodennettu. Myös revision
`a293a9b0411ce10e6b04b381a8aadb78ddc03d78` normaali PR #275 -todennus
läpäisi. Timeoutin juurisyytä ei ole vielä todistettu. Omistaja päätti
tämän jälkeen nimenomaisesti selvittää syyn ennen mergeä: PR #275 jätettiin
luonnokseksi eikä sen vihreä ajo hyväksynyt M0:aa. Tarkka näyttö ja rajatun
jatkotutkimuksen checkpoint ovat samassa harness-suunnitelmassa.
Tutkimus jatkui [M0.4:n rajatulla lataus-/virhedialogikokeella](windows-installer-acceptance-harness-v2.md#m04-ehdotus-lataus--ja-virhedialogiketjun-rajattu-koe).
Omistajan 2026-09-24 hyväksymä M0.4-harness on toteutettu ja katselmoitu.
Kohdesopimukset läpäisivät 33/33 ja yksi tavallinen Windows-koe läpäisi.
Yksi erillinen pakotettu koe hylättiin; sitä ei uusittu tai muutettu
jälkikäteen läpäistyksi. Sen havaintosopimuksessa tunnistettiin liian tiukka
Electron-tapahtuman vaatimus. Omistaja hyväksyi
[M0.5:n rajatun havaintosopimuksen korjauksen](windows-installer-acceptance-harness-v2.md#m05-pakotetun-kokeen-havaintosopimuksen-täsmennys),
sopimustestit, riippumattoman katselmuksen ja yhden uuden pakotetun
Windows-kokeen. M0.5 on toteutettu: sopimukset 35/35, käännös ja
tyypintarkistus sekä katselmuksen jälkeinen yksi pakotettu koe läpäisivät.
Tavallisen testin ehtoja ei muutettu eikä M0.4:n hylättyä tulosta korvattu.
Seuraava [M0.6-ehdotus](windows-installer-acceptance-harness-v2.md#m06-ehdotus-testin-latauksen-ja-purun-omistajuus)
rajaa testin oman lataus-/purkujärjestyksen korjauksen, ei tuotantokorjausta.
Omistajan uusi 2026-09-24 jatkovaltuus sallii toteutuksen, katselmukset ja
normaalin PR/main-integraation ilman välivaiheiden lupakysymyksiä, mutta ei
hyväksyntäporttien lieventämistä. M0.6:n katselmus, 48 kohdesopimusta,
koko työtilan testit ja typecheck, desktopin E2E-käännös, 55 CI-sopimusta
sekä yksi tavallinen Windows-first-start-koe läpäisivät. Jokaisen neljän
compositionin lataus valmistui ennen shutdownia ja protokollapurkua;
cleanup todennettiin. Historiallisen timeoutin syyepävarmuus säilyy.
Integraation lopputulos tarkistetaan yllä linkitetystä checkpointista.

Projektin omistaja päätti 2026-09-22, että aiemmin työnimellä `0.2.9`
koottu kokonaisuus valmistellaan seuraavaksi versioksi `0.3.0`.
Yrityksen poistaminen ja odotustilojen latausilmaisin kuuluvat julkaisuun.
Nykyinen käyttäjätestaus viimeistellään ennen tämän kokonaisuuden toteutusta.

Omistajan seuraava päätös täydentää etenemisjärjestystä: nykyinen
`codex/release-0.2.81-hotfix` yhdistetään ensin `main`-haaraan normaalien
hyväksyntäporttien kautta. Vasta puhtaalta, tarkistetulta integraatiopohjalta
aloitetaan tämän suunnitelman tuotantokorjaukset. Tämä dokumenttipäivitys
ei suorita mergeä eikä muuta sovelluksen versiota.

Tämä on yhteinen tehtävälista, ei toteutus- tai julkaisutodiste. Alla olevat
sovellusmuutokset ovat tekemättä. Version tavoite ei muuta vielä
`package.json`- tai installer-versiota, rakenna pakettia tai hyväksy uusia
riippuvuuksia, tietomalleja tai turvallisuussopimuksia. Tarkat toteutukset
rajataan ja hyväksytään omistavissa suunnitelmissa ennen koodausta.

Julkaisuun sovittua kohtaa ei siirretä pois hiljaisesti. Jos se ei valmistu
turvallisesti, omistaja päättää julkaisun lykkäämisestä tai rajauksen
muuttamisesta. Sitä ei merkitä valmiiksi pelkän suunnitelman perusteella.

</details>


<a id="m1-unit-roadmap-1144-1227"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-plan.md:1144-1227` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<details>
<summary>M0:n integraatiota edeltävät valmistelu- ja testitulokset</summary>

<a id="m1-source-roadmap-l1144"></a>

#### M0-seuranta 2026-09-24: integraatiota edeltävä historia

Tämä alaluku säilyttää valmistelun päätökset ja testitulokset. Nykyinen
PR/main-tila on [integraatiocheckpointissa](https://github.com/eky-software/eky/pull/275#issuecomment-5819025563).
PR #274:n aiemman main-hylkäyksen näyttö säilyy
[jälkitodennuscheckpointissa](windows-installer-acceptance-harness-v2.md#m0-mainin-jälkitodennus).

Tila: **aloitettu / integraation hyväksyntä avoin**. Paikallinen ja PR:n
head on `9699f4e0efd0a82984d155b4d46b0b401ebb17e3`;
[PR #274](https://github.com/eky-software/eky/pull/274) on luonnos ja sen
kohde on `main`. Dokumenttimuutokset ovat vielä työpuussa. Niiden rajattu
katselmus ei löytänyt julkaisuestettä, mutta staged diff tarkistetaan
erikseen ennen commitia.

Required checkit ovat edelleen `V2 acceptance` ja `Audit dependencies`.
[PR-ajon](https://github.com/eky-software/eky/actions/runs/35474235856)
auditointi hyväksyttiin, mutta V2-ajo peruutettiin ja koonti hylättiin.
Samalle head-revisiolle tehdyssä
[erillisessä kokonaisajossa](https://github.com/eky-software/eky/actions/runs/35474264108)
myös supervisorin lapsiprosessin valmiusmerkintää odottava sopimustesti
epäonnistui ennen kokonaisajon peruutusta. Peruutus ja testivirhe ovat eri
havaintoja; uutta hyväksyttyä baselinea ei ole todennettu.

Omistaja hyväksyi rajatun **M0-valmisteluselvityksen** ennen mergeä:
selvitetään valmiusmerkinnän aikakatkaisun juurisyy ja suunnitellaan
tarvittava korjaus. Lupa ei muuta sovelluksen ominaisuuksia, aikarajoja tai
CI-vaatimuksia eikä vielä hyväksy toteutusta. Historiallinen yksittäinen
läpäisy ei kumoa epäonnistumista. Toteutusraja ja sen hyväksyntänäyttö
päätetään selvityksen jälkeen ennen koodimuutoksia.

Rajattu lähde- ja lokikatselmus on nyt tehty; historiallinen juurisyy ei
vielä ole varmistunut. Suositeltu seuraava pala ja sen hyväksyntä ovat
[harnessin M0-suunnitelmassa](windows-installer-acceptance-harness-v2.md#m0-valmiusmerkinnän-selvitys).
Omistaja hyväksyi tämän jälkeen M0.1:n testiharnessin diagnostiikkakorjauksen.
Tila: **M0.1 toteutettu / rajatut kohdetestit läpäisty**. Windowsin
diagnostiikka- ja cleanup-kohdetestit läpäisivät 25/25, terminal-validator
5/5 ja alkuperäinen deadline-sopimus 1/1 yhdellä yrityksellä. Testivirheen
näyttö säilyy nyt siivouksesta erillään, eikä puuttuvaa valmiusmerkintää
hyväksytä onnistumiseksi. Tämä ei vielä ratkaise tai hyväksy M0.2:n
ajoitusratkaisua eikä muuta aikarajoja, tuotantokoodia tai CI-portteja.
Kokonaisperheiden ja uuden revision required checkien todennus on avoin.

**M0.2-suunnittelun checkpoint:** tarkka toteutusehdotus on kirjattu
[harnessin päätösrajaan](windows-installer-acceptance-harness-v2.md#varsinaisen-korjauksen-päätösraja-m02).
Se erottaa oikean ajan käynnistysrajan hallitusta, todellisia Windows-
prosesseja käyttävästä deadline-testistä. Ehdotus sisältää ytimen sisäisen
kello-/odotusrajapinnan, cleanup-ajan etenemisen myös setup-virheessä,
täsmälliset prosessikahva- ja Job-todisteet sekä muuttumattomat PR/main-portit.
Tila on **toteutettu / katselmoitu / kokonaisportit kesken**. Omistajan
nimenomainen M0.2-hyväksyntä saatiin ennen koodimuutoksia. Kohdeajo 65/65,
kaksi ennalta sovittua toistosarjaa 10/10 ja 10/10 sekä koko supervisor-
perhe 97/97 läpäisivät. Riippumaton katselmus jätti neljä testitodisteen ja
turvallisen virheraportoinnin korjausta; ne on kirjattu
[taukocheckpointtiin](windows-installer-acceptance-harness-v2.md#taukocheckpoint).
Työ pysäytettiin omistajan pyynnöstä päättyneen testiperheen jälkeen.
Omistaja antoi tämän jälkeen jatkoluvan. Neljän havainnon rajatut korjaukset
ovat työpuussa. Uusintakatselmuksessa löytynyt vastaava proof-kirjoituksen
virhetestin puute korjattiin myös; avoimia katselmushavaintoja ei jäänyt.
Lopullisen toteutuksen kohdeajo läpäisi 103/103, prosessitoistot 10/10
kummassakin skenaariossa ja koko supervisor-perhe 135/135. Legacy-core
läpäisi 444/446; kaksi native product inspector -testiä epäonnistui, joten
perheen hyväksyntä on avoin. Omistaja hyväksyi 2026-09-24 koko muuttumattoman
legacy-core-perheen todentamisen puhtaassa normaalissa Windows-CI:ssä ennen
mergeä. Paikallinen epäonnistuminen säilyy kirjattuna; testejä tai CI:tä
ei kevennetä. Muut paikalliset portit pysyvät ennallaan.
Työtilan testit, typecheck, web/backend/desktop-buildit ja CI-sopimukset
55/55 läpäisivät. Kahdeksan olemassa olevaa alustarajattua ohitusta ei lasketa
läpäisyiksi. Kriittinen system/web-E2E läpäisi 106/106, koko system-perhe
131/131 ja Electron developmentin kriittiset polut 38/38, ilman uusinta-ajoa.
Kaikki tässä checkpointissa kuvatut paikalliset ajot ovat päättyneet.
Hyväksytty seuraava vaihe on julkaisurajan tarkistus, commit/push ja uuden
PR-revision normaali kokonaisajo. Legacy-core-perheen ja muiden vaadittujen
tarkistusten on läpäistävä ennen mergeä; mainin oma hyväksyntä tulee tämän
jälkeen. PR/main-integraatio on vielä avoin.
Viereisissä testeissä tunnistetut readiness-riskit on nimetty, ei piilotettu
uuden testin läpäisyyn. Goal pitää M0-kokonaisuuden aktiivisena mutta ei
ohita tätä toteutuslupaa tai muiden korjausten erillisiä päätöksiä.

Tämä on integraatiota edeltävä checkpoint, ei PR/main-hyväksyntä.
T/A/B/C/K/D/E/F/G/H/I-pakettien järjestys säilyy; rajattu
M0-selvitys ei avaa muuta 0.3.0-toteutusta ennen integraatioporttia.

</details>
