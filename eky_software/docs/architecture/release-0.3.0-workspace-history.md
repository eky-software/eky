# W7.5:n työtilahistoria

Tämä tiedosto säilyttää W7.5:n päivätyt koe- ja osanäyttötulokset,
ei aktiivista työjonoa. Voimassa olevat sopimukset, päätökset ja A-E-portit
ovat [työtilasuunnitelmassa](local-company-workspace-plan.md#w75-toteutussuunnitelma);
nykyisen etenemistilan omistaa [M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Kukin ote kuvaa kirjaushetkensä näyttöä, perusteluja, rajoja ja avoimia
virhesyitä. Otteiden teksti on säilytetty lukuun ottamatta linkkien siirtokohdetta.

<a id="w75-history-ui-test-module"></a>

## 9.11.2026, selaintestiapuri

**9.11.2026, lomakkeen selaintestiapuri:** lomakkeen koe käyttää nyt samaa
nimettyä, vain E2E-tilassa sallittua testimoduulia kuin ohjain ja tukivienti.
Resurssihistoriasta riippunut lataus korvattiin ilman tuotantolomakkeen,
väittämien tai aikarajojen muutosta. [Nykyiset 15 selainkontrollia ja erillinen
web-varmennus](release-0.3.0-integration-history.md#w75-form-test-module-20261109)
läpäisivät; tämä ei ratkaise native-poiston tulosodotusta.

<a id="w75-history-ui-controller"></a>

## W7.5 C:n ohjaimen selainnäyttö

Ohjaimen rajattu katselmus löysi vanhat muokkauskäsittelijät ja vanhentuneen
backup-esityskontekstin; molemmat korjattiin ja todistettiin oikealla
ohjaimella/dialogilla nykyisessä eristetyssä selaimessa. Viisi uutta
`WORKSPACE-DELETE-UI`-tapausta ja samannimisten yritysten vanha selainpolku
läpäisivät ilman uusintaa sekä nykyisen puu-/palvelusiivouksen. Lopullinen
13 tiedoston 276 regressiota, web/E2E-tyypitys ja web-käännös läpäisivät;
myös koko webin 165 tiedoston 1 192 testiä läpäisi. Päällekkäisiä
osasarjoja ei summata. Jälkikatselmukseen ei jäänyt löydöstä.

<a id="w75-history-discovery"></a>

## 7.11.2026, löytö- ja luovutuskokeen osanäyttö

**C:n löytö- ja luovutuskokeen osanäyttö 7.11.2026:**
`desktopWorkspaceRecoveryDiscoveryTestSupport.ts` kokoaa vain testissä
nykyiset korjaamattomat lukijat ilman annettua kohdetta, inventaario-
otsaketta tai tekaistua poisto-operaatiota. Nykyinen kolmen yrityksen
fixtuuri ja todellinen main-varaus säilyvät. Neljä sidottua omistajaa,
niiden yhteinen saman kohteen tapaus ja erillinen paikallinen restore
löytyivät tiedostoista. Aktiiviosoite sai olla sama, toinen tai null
muuttamatta rekisteritavuja. Puuttuva sidonta tai journal ei antanut
positiivista kohdetodistetta; orpo sidonta säilyi. Molemmat activation-
aliasit, väärä lineage ja journalin vieras kohde hylättiin.

Katselmuksen juurivertailu-, toisen omistajan luokittelu- ja sulkuaukot
korjattiin kokeeseen: myös yhteisen journalin kohdejuuren poissaolo tai
identiteetti kiinnitetään, muiden journalien kaikki slotit validoidaan
nykyisillä omistajilla ja jo aloitettu luku odotetaan loppuun sekä
onnistuvassa että epäonnistuvassa luovutuksessa. Puuttuva sidonta ei tässä
ensimmäisessä kokeessa ohittanut alkuperäisslottien lukumäärän, operaation
tai siirtymän tarkistusta. Alla oleva yhteensopivuuskatselmus osoittaa tämän
koeehdon liian tiukaksi tavalliselle sidonnattomalle tuonnin ja adoptionin
palautukselle; sitä ei viedä tuotantokäynnistyksen ennakkoehdoksi.
Rekisterin, journalin, sidonnan ja juuren vaihtuminen estivät luovutuksen;
molempien muiden yritysten kolme paikallista slottia estivät yhden kohteen
tarjoamisen. Epävarma luku ei muuttunut tavalliseksi fallbackiksi.

Nykyinen `desktopRecoveryStartup` sulki vanhan havaintokahvan, mutta
uudella omistajalla verrattava lukutodiste pysyi elossa oman lifecyclensa
sulkuun asti. Viivästetty vastaus luettiin ensin nykyisellä journal-
lukijalla ja odotettiin ennen hylkäystä; tämä ei ole uuden natiivin
tiedostokahvan keskeytystodistus. Ensimmäinen syy säilyi myös silloin,
kun valtuus oli menetetty jo ennen luovutusyritystä.

Lopullinen kolmen kokonaisen vaikutustiedoston 169 testiä sekä desktop-
tyypitys läpäisivät. Aiempi 166 testin läpäisy edelsi kahta viimeistä
korjausta eikä korvaa tätä näyttöä; osasarjoja ei summata. Tyypityksen
ensimmäiset tunnistebrändivirheet, viivästetyn lukutestin väärä pitokohta
sekä koeversion synkroninen hylkäys korjattiin; ensihylkäykset säilyvät.
Rajattuun jälkikatselmukseen ei jäänyt löydöstä. Tuotantokoodia,
aikarajoja, riippuvuuksia tai julkisia kanavia ei muutettu.
Kääntäjän todellinen sovellustiedostojen valinta ei sisällä uutta
testiapuria tai kokeen testitiedostoa; tämä ei ole paketoidun artifactin näyttö.

Näyttö ei ole varsinainen `startDesktopComposition`-sisäänpääsy,
hallintapalvelun julkaisu, Electron-dialogin kohdevalinta tai
delete-IPC:n kytkentä. `notOffered`-kontrolli ohjaa koefixtuurin nimettyyn
vanhaan haaraan; se ei aja koko tavallista cold-recoveryä. Paikallisen ja
yhteisen journalin sekayhdistelmä sekä epätavalliset sidonnattoman
adoptionin siirtymäparit jäävät yhteensopivuusportiksi ennen tuotantoentryä.
Vanha Main-sarjan hylkäys ja koko W7.5:n paketti-/PR/main-portit säilyvät.

<a id="w75-history-reservation-count"></a>

## 8.11.2026, varauskutsujen kontrolli

100 sekunnin kertamittauksen ja erillisen vaihetietokorjauksen jälkeen
tehty pieni main-fixturen kontrolli käytti oikeaa startup-tuottajaa,
kaapattua omistusjaksoa ja nykyistä palautushallinnan capabilityä.
Se päättyi menetyshyväksynnän peruutukseen: varsinainen poisto ei alkanut,
alkuperäiset tiedostot säilyivät ja sulku valmistui nykyisellä testirajalla.
Nykyiseen kontrolloituun native-porttiin liitetty väliaikainen laskenta
vahvisti toistuvat varauskutsut jo ennen ensimmäistä poistovahvistusta.
Mittaus poistettiin ja testilähteen täsmällinen palautuminen varmennettiin.
Tämä ei mittaa aidon Windows-varauksen kustannusta tai selitä pitkän
lomakeketjun aikakatkaisua. [Rajattu näyttö](release-0.3.0-integration-history.md#w75-recovery-preparation-count-20261108)
ei hyväksy kummankaan havainnon poistamista.

<a id="w75-history-reservation-comparison"></a>

## 8.11.2026, varaustodisteen vertailunäyttö

**Rajattu vertailunäyttö ennen tuotantokytkentää 8.11.2026:** suoran fixturen korjaus läpäisi ensin
muuttumattoman sovelluksen 41 palautushallinnan regressiota. Sama ryhmä
läpäisi myös vain muistiin ladatulla ehdokkaalla. Lopulliset 12 erillistä
vertailukontrollia läpäisivät molemmille versioille; osasarjoja ei summata.
Kutsujen ero todentui sekä suorassa fixturessä että nykyisen startup-
tuottajan kautta. Pysyvä menetys, virheellinen paluuarvo, havaittu ensisyy,
erikseen havaittu ikkunan siivousvirhe ja pidetyn luennan sulku tarkistettiin.
Tuottajan pending-/uncertainty-kontrollit käyttävät nykyisestä lähteestä
poimittuja alustuksia: ne ovat yksikkönäyttöä, eivät todellisen kirjoittajan
exitin tai koko startupin työtilan kytkennän uusi native-todiste.

Seitsemän nykyisen vaikutustiedoston 73 valittua kohdekontrollia läpäisi
erikseen. Mukana olivat todellinen paikallinen IPC-varaus, omistusjakson
vanheneminen ja myöhäiset vastaukset, tuotannon sidottu delete-lease,
muuttunut kohdevalinta sekä todellisen rekisterikirjoituksen ja journalin
julkaisuvartijat. Vertailun testin oma lease-väittämä ei yksin todista
näitä tuotannon rajoja. Riippumattoman katselmuksen kaksi testinäytön
täsmennystä korjattiin ennen lopullisia pienkontrolleja; avoimia
lähdekatselmuslöydöksiä ei jäänyt. [Näyttö ja rajaus](release-0.3.0-integration-history.md#w75-recovery-reservation-comparison-20261108)
eivät itsessään hyväksyneet tuotantokytkentää, uutta pitkää ajoa tai vanhojen
hylkäysten sulkemista. Kokeessa sovelluslähde ja aikarajat säilyivät;
testifixturen korjaus jäi työpuuhun.
Molempien lopullisten muistiversioiden tyypitys läpäisi ilman diagnostiikkaa.

<a id="w75-history-reservation-production"></a>

## 8.11.2026, varaustodisteen kytkentänäyttö

**Tuotantokytkennän näyttö 8.11.2026:** yhden koostefunktion hyväksytty
muutos on työpuussa ilman kokeen testikoukkuja. Kymmenen pysyvää kontrollia
käyttää nykyistä tilakanavaa ja sulkukahvaa; myös startup-tuottajan oma
tuore fyysinen tarkistus ja pysyvän menetyksen esto todennetaan erikseen.
Lopullinen normaali Main-sarja läpäisi 1 539 testiä 43 kokonaisessa
tiedostossa. Desktopin tyypitys ja saman tuotantokoodin normaali käännös
läpäisivät. Katselmukseen ei jäänyt löydöstä. Ensimmäisen Main-ajon kolme
vanhentunutta lähdehakua korjattiin säilyttäen käynnistysjärjestyksen
väitteet; [ensihylkäys ja korjatun lähteen näyttö](release-0.3.0-integration-history.md#w75-recovery-reservation-production-20261108)
eivät muutu aiempien native-hylkäysten korjaukseksi.

<a id="w75-history-publication-count"></a>

## 12.11.2026, julkaisijan kutsumittaus

[12.11.2026:n mittaus](release-0.3.0-integration-history.md#w75-publication-delegation-measurement-20261112)
vahvisti kaikissa neljässä vertailussa jaon 14 = 8 + 2 + 4.
Yksi uusi kontrolli läpäisi nykyisessä oletusrajassa alkuperäisillä
tiedosto-, valtuuden päättymis- ja sulkuväittämillä. Fixture käyttää
oikeita tiedostoja mutta hallittua alatasoluovutusta, ei Mainin todellista
palautushallinnan luovutusta. Seuraava rajattu selvitys erottaa mitatut
valmistelukutsut niiden Main-kytkennän build-/vierasjournaliluennasta;
mittaus ei vielä osoita native-viivettä tai tarpeetonta poistovartijaa.

<a id="w75-history-publication-prefix"></a>

## 12.11.2026, julkaisijan vertailukoe

[Vertailukokeen näyttö](release-0.3.0-integration-history.md#w75-publication-prefix-experiment-20261112):
molempien versioiden kymmenen turvakontrollia, kolme rajausmittausta ja
semanttinen tyypitys läpäisivät. Ehdokkaan valmistelukutsut olivat
14/10/10/10; ilman luovutusta tai seitsemättä porttia rakenne ei muuttunut.
Todellinen palautuva sivuslotti erotti versiot odotetusti. Pysyvät muutokset,
pidetyn luvun sulku, ensivirheet ja viimeisten muutosvartijoiden todelliset
sivuvaikutukset tarkistettiin. Tämä ei todista Main-/native-nopeutta eikä
hyväksy tuotantokytkentää; alkuperäinen koetestin odotusvirhe säilyy historiassa.

<a id="w75-history-source-comparison"></a>

## 8.11.2026, lähdevertailun koe- ja osanäyttö

**Rajattu koetulos 8.11.2026:** vain testissä ladattu ehdokas ja lähtö
läpäisivät nimetyn vertailuryhmän. Mukana olivat monisivuinen oikeiden
tiedostojen luettelo, muuttumaton alkuvalmistelu ja metadatasiivous,
aktiivinen/valitsin-luovutus sekä nykyisen Main-palautuskoosteen kontrolli.
Katselmuksessa löydetyt ensisyy-/sulkuvirheen, päällekkäisen julkisen luvun
ja portittoman virhepolun aukot korjattiin ehdokkaaseen ja todennettiin.
Lähtö ja ehdokas läpäisivät tyypityksen; sovelluslähteet säilyivät ennallaan.
Tarkistuskutsujen vertailu ei todista natiivin lomakeketjun valmistumista tai
vanhan aikakatkaisun syytä. [Näyttöraja ja seuraava päätös](release-0.3.0-integration-history.md#w75-source-comparison-experiment-20261108)
erottavat kokeen tuotantokytkennästä ja integraatiohyväksynnästä.

Hyväksytty kolmen omistajan kytkentä ja pysyvät regressiot ovat työhaarassa.
Vaikutustarkistukset ja valmistelu läpäisivät, mutta yksi nykyrajoin tehty
palautuslomakeajo hylkäsi edelleen tulosodotukseen. Poiston valmistumista
ei hyväksytä tämän perusteella. [Tuotantokytkennän näyttö ja avoin raja](release-0.3.0-integration-history.md#w75-source-comparison-production-20261108)
omistavat jatkon; aikarajoja tai turvavartijoita ei muuteta timeoutin nojalla.

<a id="w75-history-read-attribution"></a>

## 9.11.2026, lähdelukujen kutsumittaus

**Rajattu kutsumittaus 9.11.2026:** nykyisen Main-fixturen `startup`-reitti
läpäisi nimetyn julkaisukokeen muuttumattomassa testibudjetissa. Yksi
luonnollinen kuudes luentakutsu luovutuksen kummaltakin puolelta vahvisti
kolme erillistä fyysisen portin havaintoa sekä erilliset juuri- ja
lifecycle-kutsut. Kaikki neljä lähdevertailua, journalin todellinen julkaisu,
hallittu jatkon hylkäys, säilyvät tavut, valtuuksien päättyminen ja sulku
todentuivat. Inventaariotiedoston omat vartijat ja sen sisältä kulutettu
lähdegeneraattori erotettiin: kutsumäärän kertautuminen painottui
lähde- ja ulompiin valintalukuihin, ei pelkkään inventaariotiedoston lukuun.
Sisäkkäisiä kestoja ei summattu eikä suurempaa kutsumäärää tulkita yksin
suurimmaksi aikakustannukseksi. Mittauskääreen konstruktorivirhe korjattiin
vain paikalliseen kokeeseen; ensihylkäykset säilyvät. Sovellus- ja
testilähteet levyllä eivät muuttuneet. [Kutsumittauksen näyttöraja](release-0.3.0-integration-history.md#w75-read-attribution-20261109)
ei hyväksy uutta havaintoeroa, tuotantokytkentää tai uutta native-ajoa.

<a id="w75-history-source-leading"></a>

## 10.11.2026, johtavan tarkistuksen pienkoe

**Pienen kokeen näyttö 10.11.2026:** lähtöversio ja yhden rivin
muistiehdokas läpäisivät kumpikin samat 38 valittua kontrollia, korjattu
tyypitys ja rajattu riippumaton katselmus. Lukijan oma suora täysi tarkistus
väheni kahdesta yhteen, mutta native-nopeutumista tai vakautta ei
todistettu. [Tarkka kattavuus, tarkoituksella valitsemattomat tapaukset ja näyttöraja](release-0.3.0-integration-history.md#w75-source-leading-experiment-20261110)
säilyttävät nimetyn havaintoeron sekä EOF- ja muutosvaltuuden eron.
Myös nykyisen main-julkaisufixturen yksi kontrolli ja sen 20 sekunnin raja
säilyivät vertailussa. Kertautuvan työn kokonaisvähennys jäi pieneksi eikä
koko koe nopeutunut; kyse ei ole natiivin portin suorituskykymittauksesta.
Tällä näytöllä ei ehdoteta tuotantokytkentää. Sovelluslähde ja aikarajat
säilyvät. Seuraavaksi rajataan koostetason valinta-/lähde-/varausvastuun
yhteiskatselmus ennen uutta muutosehdotusta; nykyiset täydet muutosvartijat
ja kaikki neljä vertailua säilyvät.

<a id="w75-history-preparation-proof"></a>

## 10.11.2026, valmistelutodisteen osanäyttö

**Kokeen osanäyttö:** [rajattu vertailu ja sen avoimet portit](release-0.3.0-integration-history.md#w75-recovery-preparation-proof-20261110)
todensivat molempien versioiden saman 190 kontrollin joukon, muuttumattomat
yleiset lifecycle-/täydet vartijat ja alkuperäiseen kuittiin sidotun uuden
luennan. Nykyisen main-julkaisukontrollin neljä vertailua, alkuperäisjournalin
julkaisu, hallittu jatkon pysähdys, säilyvät tavut ja sulku läpäisivät
molemmilla versioilla. Luovutuksen kummaltakin puolelta todennettiin
kolmen havainnon vaihtuminen yhteen. Myös pieni oikean varausadapterin
kontrolli säilytti poissulun ja payload-tavut, mutta ei todista Electronia.
Koko main-kontrollin nopeutumista ei osoitettu; tällä näytöllä ei ehdoteta
tuotantokytkentää suorituskykykorjauksena. Ehdokas pysyy vain muistissa.

Uusi kuittikuluttajan kilpailukontrolli paljasti lähtöversion yleisen
vartijan myöhäisen virheen vaikutuksen seuraavaan omistajaan. Tarkasteltu
nykyinen recovery-kooste estää kokeen pakottaman luovutuksen yhteisellä
leasella ja työn päättymisen odotuksella; havainto ei ole osoitettu nykyisen
käyttöpolun regressio. Alkuperäinen hylkäys säilyy, eikä myöhempi
käyttäytymiserojen vertailu merkitse sitä korjatuksi. Kuudennen portin pidetyn
fyysisen luvun main-sulkukontrolli ja startup-tuottajan adoption-/poistotyön
neljän pending-/uncertainty-ehdon kohdistettu näyttö valmistuivat myöhemmin
samassa kokeessa: molemmat versiot läpäisivät samat viisi kontrollia
nykyisissä viiden sekunnin rajoissa. Todellisen tuottajan neljä kenttää
injektoitiin vain testimuistiin; tämä ei ole luonnollisen kirjoittajaprosessin
exit-todiste. Sulku odotti fyysisen työn ja callbackin, minkä jälkeen
varauksen vapautushetken havainnot vahvistivat molemmat päättyneiksi.
Vanhentunut capability-pyyntö hylättiin, eikä sille väitetä toimitetun
tavallista tulosvastausta. Ensisyyn lukitus tarkistettiin sovellusvirheiden
muunnoksen ulkopuolelta. Rajattuun jälkikatselmukseen ei jäänyt löydöksiä.
Pienkoe ei hyväksy tuotantokytkentää, pitkää native-ajoa, budjettimuutosta
tai uutta automaattista vartijoiden keventämissarjaa.

<a id="w75-history-result60"></a>

## 10.11.2026, käytetyn kertamittauksen hylkäys

**Kertamittaus valmistui hylkäykseen:** tulosilmoitus ei tullut myöskään
hyväksytyssä 60 sekunnin odotuksessa. Normaali 10 sekunnin odotus palautettiin;
alkuperäiset lähde-/käännössidonnat ja Electron-tavut täsmäsivät jälkivertailussa.
Nykyinen osittainen vaihehavainto vahvisti valmistelun, neljän lähdevertailun,
valintaluovutuksen ja aloitusjournalin julkaisun valmistuneiksi. Se ei yksilöi
julkaisun jälkeistä odottavaa omistajaa tai kaikkia fyysisiä kutsuja.
Prosessipuun poistuminen, portin vapautus ja virheaineiston säilytys todentuivat;
lopullisen poiston ja sitä seuraavan uudelleenkäynnistyksen väittämiin ei päästy.
[Tulos ja näyttöraja](release-0.3.0-integration-history.md#w75-recovery-result60-20261110)
eivät hyväksy pidempää pysyvää odotusta tai kokeiden tuotantokytkentää.
Julkaisun jälkeisen jatkon [rajattu vastuuarvio](local-company-workspace-plan.md#w75-postpublication-responsibility-review)
on tehty. Se ei oikeuta valmistelun pienkokeiden uusimiseen tai vartijoiden
muuttamiseen; nykyiset turvarajat säilyvät.

<a id="w75-history-postpublication"></a>

## 10.11.2026, julkaisun jälkeinen mittaus ja testisulku

Nykyinen nimetty Main-kontrolli ja kaikki 39 vaihevalintakontrollia läpäisivät
muuttumattomissa rajoissaan. Main saavutti vain sovitun hallitun pysähdyksen;
palvelun jatkovaltuuden kutsut ja sulku päättyivät. Vaihevalinnan sisäkkäinen
kutsurakenne todennettiin, mutta native-viiveen syy jäi avoimeksi. Mittaus ei
anna perustetta vartijan poistoon tai automaattiseen uuteen pitkään ajoon.
Riippumaton katselmus havaitsi ennestään olevan nimetyn Main-testin
`finally`-riskin: samanaikainen rungon ja sulun virhe voi peittää ensisyyn.
Tätä haaraa ei saavutettu onnistuneessa ajossa; testin virhesemantiikkaa ei
muutettu kesken rajatun mittauksen. [Erillinen testisulkukorjaus](release-0.3.0-integration-history.md#w75-main-test-primary-preservation-20261110)
säilyttää nyt rungon ensivirheen ja erillisen sulkuvirheen sekä odottaa
sulun loppuun. Korjauksen 25 testiapurikontrollia, nimetty Main-kontrolli
ja desktop-tyypitys läpäisivät nykyisissä rajoissaan. Tämä ei selitä tai
sulje Electron-ketjun viivettä eikä korvaa uutta kytkentäpäätöstä.

<a id="w75-history-post-ready-small"></a>

## 10.11.2026, käynnistyshavainnon ensimmäinen pienkoe

**Pienkokeen tulos ja seuraava rajaus.**
[Muistiehdokas ja rajatut kontrollit](release-0.3.0-integration-history.md#w75-post-ready-observation-small-20261110)
läpäisivät. Ehdokas erottaa viisi havaittua vaihetta, mutta ei vielä kata
health-, session-, palautus- ja FirstStart-välejä tai adoption-hyväksyntää.
`entered` ilman `returned`-merkintää voi tarkoittaa myös jo hylättyä työtä,
jonka siivous odottaa. Asynkroninen kaappaus näyttää toteutuneen lukuhetken,
ei varmasti aikakatkaisun täsmällistä hetkeä. Näistä ei lasketa automaattista
`pending`-tilaa tai juurisyytä.

<a id="w75-history-candidate-physical"></a>

## 11.11.2026, kopion fyysisen siirron kontrollit

Nykyisen lukijan neljä pysyvää kontrollia yhdistävät import-/adoption-
receiptin oikeaan inventaarioriviin ja fyysiseen siirtäjään. Saman sisältöinen
mutta eri identiteettinen kansio hylätään ennen ensimmäistä siirtoa ja
synkronointia; alkuperäiset, korvaavat ja vieraan yrityksen tavut sekä
sidontatiedostot säilyvät. Muuttumattoman kansion onnistumiskontrolli
varmentaa oikean rename-operaation. Ulkoinen vaihevaltuus on tässä
tarkoituksella salliva testisovitin, jotta hylkäys todentaa fyysisen
identiteettivartijan eikä samaa aiempaa receipt-lukua. Tämä ei todista
journalin julkaisua, koko palveluketjua tai oikeaa native-ajoa.
Kohdesarja ja tyypitys läpäisivät; lukijan tuotantojärjestystä ei muutettu.

<a id="w75-history-candidate-enumeration"></a>

## 11.11.2026, rajatun luettelointiehdokkaan koe

Rajattu [luettelointiehdokkaan koe](release-0.3.0-integration-history.md#w75-census-candidate-scope-20261111)
läpäisi kummankin version 142 testiä ja ehdokkaan tyypityksen. Oletuspolun
alkuperäinen järjestysregressio ja siivoojan 57 nykyistä testiä säilyivät.
Yksittäisen havainnon sidontaluvut vähenivät, mutta tämä ei todista koko
native-ketjun nopeutumista. Oikeiden luettelointikutsujien myöhäisen
kansiovaihdon neljä erillistä EOF-kontrollia läpäisivät kummallekin versiolle:
normaali luenta valmistui, mutta muutoksen jälkeen luovutettu vanha rivi
ei riittänyt koko kierroksen onnistumiseen. Alkuperäinen iterator hylkäsi,
oikeat lukukahvat sulkeutuivat ja muuttuneet sekä säilytettävät tavut säilyivät.
Erillisiä ajoja ei lasketa yhdeksi kokonaiseksi regressiosarjaksi. Rajattu
riippumaton lähdekatselmus ei löytänyt korjattavaa puutetta; se ei korvaa
koko Goalin katselmusta tai integraatioportteja. Tuotantolähdettä ei muutettu.

<a id="w75-history-candidate-production"></a>

## 11.11.2026, luettelointikytkennän osanäyttö

Kytkentä on työpuussa. Sen 146 kohderegressiota, 159 valmistelun ja julkaisun
vaikutustestiä, tyypitys sekä nykyinen alkuperäisen virheen salaus/purku-koe
läpäisivät. Neljän loppurajatestin vertailua vahvistettiin tämän jälkeen
alkuperäiseen tiedostopuuhun nähden; niiden rajattu todennus ja tyypitys
läpäisivät erikseen. Myös nykyinen 23 kohteen normaali poistoketju läpäisi
muuttumattomassa rajassaan. Rajattu riippumaton lähde- ja testikatselmus ei
löytänyt korjattavaa puutetta. Tämä ei vielä osoita Electron-lomakeketjun
valmistumista tai hyväksy koko W7.5:tä.
Korjatun lähteen yksi `DESK-DELETE-RECOVERY-001`-ajo hylkäsi nykyisessä
10 sekunnin tulosodotuksessa; 150 sekunnin kokonaisrajaa, työntekijämäärää
tai retry-asetusta ei muutettu. Valmistelu läpäisi ja jäädytetyt lähde- sekä
runtime-tavut säilyivät. Prosessipuun ja portin siivous varmistui, mutta
poiston loppuväittämät ja restart jäivät saavuttamatta. Säilynyt vaiheote
rajasi jatkoselvityksen journalin julkaisuun ja sen täyteen valintavartijaan;
se ei ole atominen tiedostotila tai I/O-jumin todiste. Erillinen sulun
jälkeinen metadataluku löysi vain seuraavan slotin journalin ja säilyneen
kohdekansion; sitä ei väitetä tulosodotuksen päättymishetken tilaksi.
Luettelointikorjaus ei siten vielä ratkaissut koko lomakeketjua.
Korjatun lähteen normaali Main-sarja läpäisi 1 627 testiä 44 tiedostossa;
sen jälkeenkin jäädytetyt syötetavut säilyivät. Aiempi Main-hylkäys ja
native-epäonnistumiset säilyvät erillisinä avoimina havaintoina.
Seuraava rajattu suunnittelukatselmus erottaa nykyisten lifecycle- ja
valmisteluomistajien varaus-/runtime-poissaolotodistukset varsinaisen
muutoksen tuoreesta valintavartijasta. Uutta kevennystä, pidempää aikarajaa
tai muuttumattoman lähteen uusintaa ei päätellä tästä hylkäyksestä.

<a id="w75-history-combined-preparation"></a>

## 11.11.2026, yhdistetyn valmistelutodisteen näyttö

**Koenäyttö 11.11.2026:** [lähtö-/ehdokasvertailu](release-0.3.0-integration-history.md#w75-recovery-combined-preparation-experiment-20261111)
läpäisi nykyiset lifecycle-, valmistelu-, Main- ja fyysisten muutosrajojen
kontrollit sekä tyypityksen. Tämä koenäyttö koski vain muistiehdokasta.
Main-vertailu erottaa nimetyn kolmen todistuksen ryhmän valintaluvun muista
havaintokerroista; koko vartijaa ei kuvata yhdeksi tarkistukseksi.
Omistajan hyväksymä kolmen omistajan lähdekytkentä vastaa testattua ehdokasta.
[Pysyvät regressiot, normaali Main, tyypitys, salaus/purku, valmistelu ja
katselmus](release-0.3.0-integration-history.md#w75-recovery-combined-preparation-production-20261111)
läpäisivät. Niiden jälkeinen yksi nimetty native-ajo hylkäsi edelleen
nykyiseen tulosodotukseen; lähdetavut ja prosessi-/porttisiivous varmistuivat.
Osittaisessa otteessa kolmas lähdevertailu oli kesken. Tämä rajaa seuraavan
katselmuksen lähdevertailun sisäisiin vartijoihin, ei oikeuta uutta
muuttumattoman ajon uusintaa tai osoita koko W7.5:n hyväksyntää.

<a id="w75-history-census-count"></a>

## 11.11.2026, census-luennan kutsumittaus

Muuttamattomilla vartijoilla tehty yhden nykyisen lähdevertailutestin
kutsumittaus läpäisi alkuperäiset väittämät ja aikarajan. Suurin osa
kirjoittajapoissaolokutsuista syntyi census-luennan sisällä, ei sen reunoilla.
Mittaus käyttää oikeita synteettisiä tiedostoja mutta ohjattua
kirjoittajaporttia; se ei mittaa natiivin varaustodistuksen kestoa tai
osoita Electron-viivettä korjatuksi. Raakamittaus jää paikalliseksi.

<a id="w75-history-census-experiment"></a>

## 11.11.2026, census-todisteen muistivertailu

[Muistiin ladattu lähtö-/ehdokaskoe](release-0.3.0-integration-history.md#w75-recovery-census-proof-experiment-20261111)
käytti oikeaa synteettistä tiedostovarausta ja yhdeksään nykyiseen lähteeseen
sidottua koemuunninta. Muuttumattomassa lähdeluennassa fyysiset
varaustodistukset vähenivät 141:stä 10:een; ehdokas teki lisäksi 131
synkronista nykytilatodistusta. Tämä on kutsumäärä, ei Electronin
nopeusmittaus. Pysyvä fyysisen juuren vaihto hylättiin molemmissa,
palautunut vaihto vain lähtöversiossa. Ehdokkaan pidetty luku, ei-synkroninen
tulos sekä `undefined` ensivirhe ja erillinen sulkuvirhe katettiin pienillä
kontrolleilla. Nykyiset lähdelukijan 19 testiä läpäisivät ehdokkaan alla.
Main-välityksen koetesti läpäisi kerran, mutta toinen ajo aikakatkaisi
20 sekunnissa; syy on avoin. Kokeen tuloksia ei lasketa tuotantotesteiksi.

<a id="w75-history-handoff-measurement"></a>

## 11.11.2026, luovutuksen jälkeinen mittaus

Nimetty Main-kontrolli läpäisi alkuperäiset väittämät 20 sekunnin rajassa;
neljä vertailua ja kaikkien mitattujen kutsuryhmien päättyminen varmistuivat.
Virtuaalinen tyypitys läpäisi, yhdeksän lähdetiedoston tavut säilyivät ja
rajattu riippumaton mittausmuuntimen katselmus ei löytänyt puutetta.
Mittari laskee tämän testin ohjatun varaus-observerin kutsuja, ei levy-I/O:ta
tai natiivin Electronin nopeutta. Sisäkkäisiä kestoja ei summata.

<a id="w75-history-handoff-experiment"></a>

## 11.11.2026, yhden callbackin kielteinen koetulos

**Eristetyn kokeen tulos 11.11.2026; ei tuotantokytkentäehdotusta.**
Yhden callbackin muistiehdokas ja sen tyypitys valmistuivat. Seitsemän
pienkontrollia läpäisi, mutta yksi nykyisen 20 sekunnin Main-testin
ehdokasajo aikakatkaisi julkaisun aikana. Kolme lähdevertailua ehti alkaa;
koko vertailun alkuperäiset loppuväittämät eivät valmistuneet. Elinikäapuri
kirjasi työn päättyneeksi ja resurssisiivouksen valmiiksi, aineisto säilyi.
Keskeneräisen ajon laskureita ei verrata lähtöversion koko ketjuun
nopeutumisnäyttönä. Yhdeksän lähdetiedoston jälkisidonta säilyi.

Kielteisessä callback-kontrollissa myös ensimmäisen fyysisen näytteen
jälkeen alkava pysyvä juurimenetys voi jäädä kyseisessä kutsussa
havaitsematta, jos muistissa näkyvä valtuus pysyy voimassa. Ehdokkaan
callbackin jälkeen tehty synteettinen tiedostokirjoitus onnistui, kun
lähtöversion toinen näyte esti sen. Seuraava tuore näyte havaitsee pysyvän
muutoksen, mutta callback ei yksin takaa havaintoa ennen kirjoitusta.
Tämä on ekstraktoidun callbackin rajakontrolli, ei koko tuotantoketjun
vuoto- tai turvallisuustodiste. Myös pidetyn työn peruutus- ja
ensivirhekontrollit mallintavat vain tätä pientä kutsua.

<a id="w75-history-mutation-context"></a>

## 11.11.2026, alemman muutosrajan kontekstikoe

**Alemman muutosrajan kontekstinäyttö 11.11.2026:** kaksi pientä kontrollia
läpäisi nykyisessä viiden sekunnin oletusrajassa. Niissä käytettiin oikeaa
prosessivarausta, nykyistä ulkoista build-/palautusvalintaa, journalin ja
byte-slotin tallenninta sekä Node-tiedostoadapterin viimeistä siirtovartijaa.
Koekohtainen juurihakemisto vaihdettiin ensimmäisen fyysisen näytteen jälkeen
saman levyn siirroilla; valittujen lapsihakemistojen ja tiedostojen
identiteetit säilytettiin. Lähtöversion toinen näyte esti `next -> current`
-siirron. Ehdokas teki oikean siirron ja hylkäsi operaation vasta
hakemistosynkronointia edeltävässä vartijassa, ennen itse synkronointia.
Molempien hylkäys ei siis tarkoita samoja levytavuja tai
muuttumatonta side-effect-rajaa.

Koe todistaa tämän alemman journalivartijan kontekstin, ei koko Mainin
alkuperäisjournalivalintaa, UI-ketjua tai yritysdatan poistoa. Se ei osoita
nykyisessä sovelluskoodissa olevaa tuotantovuotoa. Myöhempi vartija ei
kuitenkaan tässä kontekstissa takaa havaitsemista ennen jo tehtyä siirtoa,
joten pelkkää callbackin toisen todistuksen poistoa ei tällä näytöllä
suositella sovelluskytkentään. Prosessivaraus vapautettiin ja onnistuneiden
kontrollien omat juuret siivottiin; virheessä aineisto olisi säilynyt.
Lähdesidonnat säilyivät ja riippumaton rajattu katselmus vahvisti kokeen
rajauksen sekä yllä täsmennetyn hylkäyskohdan. [Kontekstikokeen näyttö](release-0.3.0-integration-history.md#w75-owned-mutation-context-20261111)
ei ole nopeus- tai integraatiohyväksyntä.

<a id="w75-history-build-read-experiment"></a>

## 11.11.2026, ulkoisen build-luennan pienkoe

**Pienkokeen nykyinen näyttö 11.11.2026, ei tuotantokytkentää.**
Muistiehdokas läpäisi 31 rajattua kontrollia. Todellisen prosessivarauksen
ja Node-journalisiirron kokeessa sekä lähtö että ehdokas estivät siirron
ja säilyttivät alkuperäiset `next`-tavut. Pysyvä sisäluennan juurimuutos
esti jatkon; täsmälleen palautettu muutos erotti yllä kuvatun havaintoeron.
Pidetty luku, rinnakkaisten luentojen eristys ja managementin callbackista
alkava sulku tarkistettiin erikseen. Mittaus osoitti nimetyn sisäisen
varaustyön vähenemisen, ei koko Electron-ketjun nopeutumista.

Riippumaton katselmus löysi muistiehdokkaasta ensisyyn säilytysracen:
samassa tapahtumakierrossa alkava sulku saattoi peittää synkronisen
lukuvartijan virheen. Kielteiset kontrollit toistivat eron; korjaus säilyttää
virheen heti ennen lupauksen hylkäyksen odottamista, myös arvolla `undefined`.
Uudelleenkatselmus ei löytänyt korjauksesta estettä. Sen pyytämät
täsmällisen virheolion identiteetin lisäväittämät läpäisivät erikseen.
Ehdokas läpäisi neljän nykyisen vaikutustiedoston 169 testiä. Lähtöversion
yksi cold-palvelun valintasidontakontrolli aikakatkaisi viidessä sekunnissa;
168 testiä läpäisi. Tätä lähtöhylkäystä ei selitetä korjatuksi.

<a id="w75-history-build-read-native"></a>

## 11.11.2026, eristetyn build-luentakokeen hylkäys

**Eristetyn kokeen tulos 11.11.2026:** saman kolmen omistajan ehdokkaan
kohderegressiot ja tyypitys läpäisivät; korjatun valmistelun jälkeen ajettu
yksi nimetty Electron-koe hylkäsi nykyiseen tulosodotukseen. Lähde- ja
runtime-tavujen pysyvyys sekä prosessipuun, bridgen ja portin siivous
varmistuivat. Poiston valmistumista ja restartia ei todistettu, eikä koe
osoita nopeutumista tai viiveen juurisyytä. Ehdokasta ei kytketä tällä
näytöllä kanoniseen sovelluslähteeseen. [Kokeen tila ja rajaus](release-0.3.0-integration-history.md#w75-build-read-isolated-native-20261111)
säilyttävät ensihylkäyksen erillään tulevista päätöksistä; nykyiset
turvavartijat, aikarajat ja integraatioportit eivät muutu.

<a id="w75-history-terminal-count"></a>

## 10.11.2026, viimeisen journalin kutsumittaus

Nykyinen alkuperäisjournalin todistetta käyttävä journal-last-testi läpäisi
rajatun kutsumittauksen omassa muuttumattomassa 30 sekunnin rajassaan.
Kaikki alkuperäiset väittämät, säilyvien tiedostojen vertailu ja valmis
sulku säilyivät; muut saman tiedoston tapaukset jäivät valitsematta.
Mittaus käyttää oikeita fixturetavuja mutta ohjattuja omistajuusportteja,
ei recovery-mainin fyysisiä cold-vartijoita. Se osoittaa kutsurakenteen,
ei Electron-ketjun kustannusta tai korjattua viivettä.
[Näyttö ja mittauskytkennän erillinen korjaus](release-0.3.0-integration-history.md#w75-terminal-clear-measurement-20261110)
eivät ole uusi sovellusmuutos tai integraatiohyväksyntä.

<a id="w75-history-terminal-observation"></a>

## 10.11.2026, viimeistelyhavainnon pienkokeet

**Pienkokeen osanäyttö 10.11.2026:** muistiin ladattavan snapshot-ehdokkaan
10 kontrollia sekä komennon/viimeistelijän 16 kohdekontrollia läpäisivät.
Jälkimmäisen ajon 53 muuta tapausta jäivät tarkoituksella valitsematta.
Alkuperäinen virhe, erillinen sulkuvirhe, pidetty työ, vartijoiden järjestys
ja säilyvät tavut tarkistettiin; viiden lähdemuunnoksen sekä snapshot-
omistajan todellinen mukanaolo tyypityksessä varmennettiin.
Tämä on kaksi erillistä pienkoetta, ei vielä niiden yhteisen main-/proof-/
parent-/keräinliitoksen tai uuden otteen salaus/purku-näyttö.
[Kokeen korjaukset ja näyttörajat](release-0.3.0-integration-history.md#w75-terminal-observation-small-20261110)
säilyvät avoimen native-viiveen rinnalla. Tuotantokytkentää ei tehty.

**Yhdistetyn pienkokeen jatkonäyttö 10.11.2026:** oikean komennon
`resumeSelected` tuotti neljä havaintoparia nykyiseen proof-kerääjään myös
täyttyneen historian jälkeen. Erillinen nykyinen Main-kontrolli varmisti
valinnaisen havaitsijan välityksen konstruktoriin hallittuun pysähdykseen
asti; se ei ajanut varsinaista jatkopoistoa. Molempien tyypitys ja valitut
kontrollit läpäisivät omissa muuttumattomissa rajoissaan.
Samasta komento-/proof-fixturestä säilytetty v2-ote kulki nykyisen parentin
ja muuttumattoman keräimen läpi nykyiseen salaus/purku-ketjuun. Puretun
gzip-arkiston sekä raporttien tavut ja tiivisteet täsmäsivät; kielteiset
sidonta-/muoto-/kokotapaukset suljettiin pois. [Jatkonäyttö ja ensivirheet](release-0.3.0-integration-history.md#w75-terminal-observation-joined-20261110)
eivät hyväksy native-kytkentää, nopeutumista tai koko W7.5:tä.

<a id="w75-history-terminal-parser"></a>

## 10.11.2026, havaintoparserin ja toimituksen osanäyttö

Kytkentäpäätöstä odottaessa yhden validaattorin erillinen muistiehdokas
läpäisi 52 muotokontrollia ja semanttisen tyypityksen, mukaan lukien
legacy-avainten rajauksen todistava tyyppikoe. Ehdokas ei sisällä toista
legacy-parserirunkoa. Juuri tämän ehdokkaan yhteinen parent-/keräinliitos,
kahden lähdeomistajan tyypitys ja nykyinen salaus/purku läpäisivät erikseen:
purettu arkisto ja raporttitavut vastasivat alkuperäisiä, ja siivous todentui.
Aiemman kopioehdokkaan näyttöä ei siirretty uudelle lähteelle.
Rajattu riippumaton toteutuskatselmus ei jättänyt löydöksiä.
[Varsinainen kytkentä ja nykyiset kohdeportit](release-0.3.0-integration-history.md#w75-terminal-observation-production-20261110)
läpäisivät, mutta yksi nimetty native-ajo hylkäsi ennen poistopyyntöä
yrityksen avauksessa. Käynnistyksen tarkka syy ja portin vapautuminen
jäivät avoimiksi. Tämä ei ole native-poiston tai viiveen korjauksen näyttöä.

<a id="w75-history-initial-publication"></a>

## 9.11.2026, alkujulkaisun luentaportin koetulos

**Rajattu koetulos:** vain testissä ladattu lähtö ja ehdokas läpäisivät
33 kontrollia sekä erillisen yhden virhekoostekontrollin. Ehdokkaan kaksi
nykyistä vaikutustiedostoa ja nimetty Main-julkaisuketju läpäisivät nykyisillä
rajoilla. Katselmuksessa löydetyt ensisyy- ja testisulkuaukot korjattiin
kokeeseen; jälkikatselmukseen ei jäänyt toiminnallista löydöstä.
[Näyttö ja sen rajat](release-0.3.0-integration-history.md#w75-initial-publication-read-experiment-20261109)
erottavat tämän tuotantokytkennästä ja natiivin tulosodotuksen ratkaisusta.

<a id="w75-history-phase-observation"></a>

## 9.11.2026, vaihehavainnon ensimmäinen koetulos

**Rajattu koetulos 9.11.2026:** vain testissä ladattu ehdokas läpäisi
30 kontrollia. Lopullinen kahden kokonaisen vaikutustiedoston sarja
läpäisi kaikki 117 testiä, myös 87 alkuperäistä testiä, samoilla rajoilla.
Lopullisen ehdokkaan tyypitys läpäisi. Lähdetiedostojen tavut säilyivät;
native-entryä, tuotannon tallentimia tai keräyksen julkaisua ei muutettu.
Rajattu riippumaton katselmus ei löytänyt estävää puutetta.

Koe käytti seitsemää suljettua vaihetta, enintään 64 tapahtumaa ja 16
samanaikaisen kutsun havaintoa sekä enintään 32 KiB:n kokeellista
JSON-projektiota. Nämä ovat vain koeesityksen rajat, eivät nykyisten
virhelokien, sovelluksen tai CI:n rajamuutoksia. Kellovirhe ja pois jäänyt
havainto merkitsevät osittaista kattavuutta; puuttuvaa aikaa ei muuteta
nollaksi. Sukupolvi-/havaintosidonta estää vieraan snapshotin käytön,
eikä vanha callback muuta seuraavan havaitsijan tilaa. Havainnot eivät
sisällä työn paluuarvoa, poikkeusta, tiedostopolkua tai business-sisältöä.

Ehdokas palautti alkuperäisen Promisen sekä saman tuloksen tai ensivirheen,
myös `undefined`-hylkäyksen. Viiden kytkemättömän/kytketyn vertailuparin
kaikki havaitut vartija- ja muutoskutsut sekä lopputulokset vastasivat
toisiaan. Kumpikin polku varmisti oman tallennetun journalinsa tavut
palautetun journalin sarjallistusta vasten ja säilytti alkuperäiset
rekisteri-/sentinel-tavut. Eri fixtuurien juuri-identiteettejä sisältäviä
journaleja ei väitetä keskenään samoiksi tavuiksi.

Nykyisen E2E-apurin kontrolli piti oikean tiedoston auki testin portin
takana: sulku ei kuitannut työtä päättyneeksi ennen kahvan sulkua.
Tämä ei ole jumittuneen käyttöjärjestelmäkutsun tai Electronin exitin
todiste. Ensivirhe ja erillinen sulkuvirhe säilyivät kontrolloiduissa
virhepoluissa. Mittauksen Promise-reaktiot voivat muuttaa ajoitusta;
samaa kutsujärjestystä ei väitetä samaksi natiivikestoksi.
[Koenäyttö ja rajat](release-0.3.0-integration-history.md#w75-phase-observation-small-20261109)
erottavat tämän oikean odotuskohdan löytämisestä.

<a id="w75-history-phase-handoff"></a>

## 9.11.2026, vaihehavainnon toimituksen viisi pienkoetta

[Rajattu sidontakoe](release-0.3.0-integration-history.md#w75-phase-binding-small-20261109)
todensi nyt tämän jaon synteettisestä fixturen kontekstista uuteen
keräinprosessiin ilman odotuskarttaa. Lopullinen 130 testin kohdetiedosto,
tyypitys, katselmus ja oikea salaus/purku läpäisivät. Hyväksytty
jälkimuokkauksen havaintoraja säilyy. Tämä ei vielä ole todellisten
tuottajien, Playwright-fixturen tai Electron-runtimen liitosnäyttö eikä
avaa tuotantokytkentää tai pitkää native-ajoa.

[Nykyisen parent-fixturen koeliitos](release-0.3.0-integration-history.md#w75-phase-fixture-small-20261109)
läpäisi 11 kontrollia, E2E-tyypityksen ja korjatun osan katselmuksen vain
muistiin ladatulla ehdokkaalla. Se suoritti nykyisen fixture-callbackin
ohjatuilla prosessi-/main-porteilla ja todellisella raporttikirjoituksella;
ei oikeaa Electronia tai Playwright-yhteyttä. Luku ennen valitun runtimen
sulkua, jäädytys `finally`-rajalla, restart, myöhäisen vastauksen esto ennen
raporttia ja erilliset alkuperäis-/lifecycle-raportit todentuivat.
Varsinaisten havaintotuottajien liitos ja native-näyttö jäävät avoimiksi.

[Kahden main-vaiheen raw-koeliitos](release-0.3.0-integration-history.md#w75-phase-main-small-20261109)
todensi valmistelu-/julkaisutuottajan ja raw-lukijan rajattuja liitoskohtia.
Tässä edeltävässä kokeessa julkaisijan sisäisiä vaiheita ja slot-I/O:ta
ei vielä kytketty. Runtime-tunniste otetaan kerran talteen;
mainin raakamuoto ei sisällä parentille kuuluvaa testiyritystä tai CI-SHA:ta.
Entrypoint-liitos jäi lähde-/tyypitysnäytöksi eikä korvaa native-porttia.

[Julkaisijan ja yhden journalin koeliitos](release-0.3.0-integration-history.md#w75-phase-detail-small-20261109)
täydensi nyt seitsemän vaiheryhmän portit vain muistiin ladatussa ehdokkaassa.
Metadatan sisäiset I/O-lehdet puuttuvat edelleen, eikä porttiluettelo yksin
todista yhtä main -> parent -> keräin -ketjua. Ennen ensimmäistä todellista
prepare-entryä aloitettu varausluku jää havainnon ulkopuolelle myös päättyessään
entryn jälkeen; itse työn Promise ja omistajuusvartijat säilyvät. Korjattu
kohdenäyttö ja tyypitys eivät avaa tuotantokytkentää tai pitkää native-ajoa.

[Yhtenäinen toimituskoe](release-0.3.0-integration-history.md#w75-phase-chain-small-20261109)
kuljetti nyt saman todellisen julkaisijan raw-otteen nykyisen parent-fixturen
kautta uuteen keräinprosessiin ja salaus/purkuun. Parentin prosessi-/Electron-
portit olivat ohjattuja, eivät oikea native-yhteys. Raportin tavut ja väärän
CI-yrityksen hylkäys todentuivat. Koedriverin kuittaus-/lähdejälkitarkistuksen
korjaukset, virhepolut ja rajattu katselmus läpäisivät. Tuotantopäätös jää
avoimeksi; tämä ei korvaa varsinaista oletus-startupin ja lomakkeen porttia.

<a id="w75-history-phase-production"></a>

## 9.11.2026, vaihehavainnon kytkentä- ja native-osanäyttö

[Kytkennän nykyinen näyttö](release-0.3.0-integration-history.md#w75-phase-production-20261109)
on erillään yllä olevista vain muistiin ladatuista kokeista. Valinnaiset
portit ja yhteinen formaattiomistaja ovat nyt lähteessä; native-ketjun
valmistumista ei päätellä kohdetesteistä, tyypityksestä tai salauskokeesta.
[Oikean natiivin vaihenäyttö](release-0.3.0-integration-history.md#w75-phase-native-observation-20261109)
on nyt erikseen säilynyt: raportti syntyi mutta poistoketjun tulosodotus
hylkäsi. Seuraava rajattu katselmus koskee lähdevertailun ja varaustodisteen
vastuuta nykyisissä omistajissa. Havainto ei hyväksy vartijoiden muutosta,
uutta pitkää ajoa tai koko W7.5:tä.

<a id="w75-history-result100"></a>

## 8.11.2026, käytetyn sadan sekunnin kertamittauksen tulos

**Kertamittauksen tulos:** sama valmisteltu Electron-kooste ja nykyinen
lomakeketju hylkäsivät 150 sekunnin kokonaisrajaan ennen täyden 100 sekunnin
tulosodotuksen kulumista. Terminal-tulos ja poiston jälkeiset sisältö- ja
restart-väittämät eivät toteutuneet. Väliaikainen mittausaskel ja pidempi
odotus poistettiin; alkuperäinen testilähde palautui täsmälleen.
Prosessipuun poissaolo ja portin vapautus havaittiin, mutta runtimen hallittu
sulku jäi varmentamatta. Aineisto säilyy. [Mittauksen erillinen näyttö](release-0.3.0-integration-history.md#w75-recovery-ui-100s-20261108)
ei todista poiston jumittumista tai tarkkaa sisäistä odotuskohtaa.

<a id="w75-history-startup-writer"></a>

## 8.11.2026, suljetun startup-tuottajan osanäyttö

Kaksitoista kohdekontrollia ja tyypitys läpäisivät. Mukana ovat kolme
tallennettua aktiivivalintaa, alkuperäinen valintakysely, sen keskeytys,
muuttunut kohde, osittainen rakentaminen, jo palautetun lifecyclen odotettu
sulku, vapautusvirhe ja varauksen menetys. Sama oikean compositionin
synteettinen alkuperäisvirhe löytyi nykyisen salatun paketin puretuista
tavuista viesteineen, pinoineen ja syyketjuineen. Tiedosto- ja ajosidonnat
täsmäsivät; sisäinen testi pysyi punaisena eikä alkuperäinen syy tullut
julkiseen tulosteeseen. Rajattu katselmus ei löytänyt puutetta. Tässä
Main-koosteessa native-rajat ja lapsen exit ovat edelleen kontrolloituja,
eivät oikean Electron- tai pakettiajon näyttöä. Tämän jälkeen koko normaali
Main-sarja läpäisi kaikki 479 tapausta ilman uusintaa tai ohituksia.
Neljän kokonaisen lähitiedoston 444 regressiota läpäisi erikseen; osasarjoja
ei summata. Viimeisen testin julkisen virhehaaran yksityisyyskorjauksen
jälkeen tyypitys, salaus/purku ja kaikki 479 Main-tapausta läpäisivät uudella
testiversiolla. Sovelluslähde ja aikarajat säilyivät; desktop-käännös läpäisi.
[Osanäyttö ja valmisteluhylkäykset](release-0.3.0-integration-history.md#w75-startup-writer-handoff-20261108)
säilyvät erillään koko W7.5:n hyväksynnästä.

<a id="w75-history-native-terminal"></a>

## 8.11.2026, sisäisen Electron-ketjun rajattu näyttö

**8.11.2026, oikean Electron-ketjun rajattu näyttö:**
`DESK-DELETE-RECOVERY-001` läpäisi startup -> capability -> palvelu ->
poistokomento -> terminal -ketjun nykyisessä eristetyssä koosteessa.
Testikopion preload välittää alkuperäisen IPC-eventin, ei kutsu palvelua
suoraan. Oikea startup muodostaa kohteen ja kirjoittajapoissaolon ilman
testin syöttämää valtuutta. Tuontikeskeytyksen valmistelu käyttää todellista
varausta, omaa huoltoleaseä ja valittuihin tavuihin sidottuja journal-kirjoituksia;
mahdollinen writerin epävarma sulku ei vapauta varausta. Aloitettu työ
liittyy quit-sulkuun, eikä suljettu startup julkaise valmiutta.

Kohteen SQLite-/PDF-/SMTP-aineisto poistui, toinen yritys ja ulkoinen
tiedosto säilyivät, eikä rajattu hallinta käynnistänyt backendiä tai
automaattista paluuta. Käyttäjän erikseen pyytämä restart avasi aiemman
yrityksen normaalien tarkistusten kautta. Sulkukytkennän täsmennyksen jälkeen
175 regressiota seitsemässä kokonaisessa tiedostossa, tyypitykset ja katselmus
läpäisivät. Hallitun tuloksen taakse jäävä alkuperäinen syy löytyi erillisen
kontrollin puretusta salatusta paketista; siinä palveluraja oli mallinnettu.
[Tarkka näyttöraja ja valmistelun korjaukset](release-0.3.0-integration-history.md#w75-recovery-native-terminal-20261108)
eivät hyväksy tuotannon poistopainiketta, uuden pre-window-valinnan native-/quit-ketjua,
pakettia tai koko W7.5:ää. Oletuskäynnistysvalinta ja tuotannon delete-IPC
pysyvät suljettuina niiden nykyisiin portteihin asti.

<a id="w75-history-registry-production"></a>

## 7.11.2026, yhteisen rekisterilukijan lopullinen osanäyttö

Lopullisen lähteen kolmen kokonaisen vaikutustiedoston 291 testiä,
desktop-tyypitys ja desktop-käännös läpäisivät muuttumattomilla rajoilla.
Aiemmat osasarjat ovat päällekkäisiä, eivät lisättäviä hyväksyntämääriä.
Uuden testimokin union-tyypitysvirhe korjattiin täsmällisillä varianteilla,
ei tyyppisääntöjä ohittamalla. Mukana ovat väärän valitun lähteen esto,
hylättävän registry-sisällön normaali palautusvertailu, sidottu kahden
journal-slotin vastakontrolli, identiteetin vaihto sekä sulun ensisyy ja
keskeneräisen sisartyön odotus. Saman indexin ja tuotannon lukutyön
sulkuomistajan pakotettu alkuperäinen synteettinen virhe, pino ja syyketju
varmennettiin nykyisen salatun paketin puretuista tavuista; ajosidonta ja
tiivisteet täsmäsivät eikä alkuperäinen syy tullut julkiseen tulosteeseen.
Sisäinen koe jäi tarkoituksella punaiseksi. Tämä ei vielä rekisteröi havaintoa oikeaan
composition-käynnistykseen, siirrä koko kohdelukijaa tuotantoon, julkaise
v2-tilaa tai avaa delete-IPC:tä. Seuraava pala jatkaa samaa sopimusta;
native-/UI-/SQLite-/paketti- ja PR/main-portit sekä vanhat hylkäykset säilyvät.

<a id="w75-history-sources-production"></a>

## 7.11.2026, yhteisten lähdelukijoiden osanäyttö

Ensimmäisessä 250 testin siirtosarjassa 244 läpäisi; kuusi kielteistä
drift-tapausta hylkäsi vain vanhan testikoodin virheodotuksen. Ne estivät
muutoksen oikein uudella tuotannon turvallisella koodilla. Täsmennys säilytti
kaikki tavu- ja identiteettiväittämät. Kohdehavainnon lopullinen 251 testin
omistajatiedosto, desktop-tyypitys ja tuotantokäännös läpäisivät nykyrajoilla.
Käännöksessä ei ole tämän lukijan testiapuja tai kokeellista paikallisen
restoren valintaoptiota. Mukana ovat
tuotantokohteen vertailut neljälle omistajalle ja kolmelle aktiivivalinnalle,
vanhan paikallisen restoren kielteiset vastakontrollit, keskeneräisen
lähdeluvun odotus, täsmällinen alkuperäinen omistajuusvirhe sekä ennen
ensimmäistä odotusta kaapatut juuret, build-arvot ja callbackit.
Katselmus havaitsi viimeisen kokeen muuttavan build-arvoja aluksi liian
myöhään; muutos siirrettiin ensimmäiseen omistajuusodotukseen ennen niiden
kuluttamista. Rajattuun jälkikatselmukseen ei jäänyt löydöstä.
Aiemmat 250/251-ajot ja edeltävän palan sarjat ovat päällekkäistä näyttöä,
eivät yhteen laskettavia määriä. Tässä palassa ei ajettu uutta native-/UI-
tai pakettiketjua eikä avattu status-/delete-IPC:tä. Lähdevirheen todellinen
mainin ja salatun toimituksen yhteisliitos todistetaan sen kytkennän mukana;
aiempi startup-sulkuketjun purkunäyttö ei yksin todista tätä uutta polkua.

<a id="w75-history-selection-production"></a>

## 7.11.2026, jatkuvan valinnan lopullinen osanäyttö

Lopullisen lähteen kolmen kokonaisen vaikutustiedoston 319 testiä,
desktop-tyypitys ja tuotantokäännös läpäisivät nykyrajoilla. Mukana ovat
alkuperäisen rekisteri-/journal-/sidonta-/juurihavainnon muuttuminen,
myöhäinen paikallinen restore, luovutuksen kertakäyttöisyys, aloitettujen
lukujen liittyminen sulkuun ja sekä synkronisen että odottavan main-
omistajuuden menetyksen pysyvyys. Rajattuun jälkikatselmukseen ei jäänyt
löydöstä. Aiemmat valitut kontrollit ja kokonaiset välisarjat eivät ole
lisättäviä hyväksyntämääriä. Uuden testin virheellinen valmistelutila ja
siivousmuuttujan tyypitys korjattiin ilman tyyppi- tai testirajojen ohitusta;
ensimmäiset hylkäykset säilyvät erillisinä todisteina. Käännös ei sisällä
tämän ketjun testiapuja tai kokeellista paikallisen restoren valintaoptiota.
Tässä palassa ei avattu tuotannon entryä, v2-tilan julkaisua tai delete-IPC:tä,
ajettu uutta native-/SQLite-/paketti- tai CI-ketjua eikä suljettu vanhoja
hylkäyksiä. Koko W7.5:n jäljellä olevat portit säilyvät.


<a id="w75-history-preparation-implementation"></a>

## 7.11.2026, valmistelu- ja tulosvarianttien sisäiset lähdenostot

**7.11.2026, valmistelupalan sisäinen lähdenosto:** katselmoitu rajattu koe
hyödynsi vanhat kontrollit ja nykyisen main-valinnan sekä aidon varauksen.
Koeehdokkaan 476 tarkistusta läpäisivät. Vain valmistelijan ja selector-
lifecyclen suljetut variantit sekä pysyvät regressiot ovat nyt lähteessä;
production-composition ei vielä muodosta recovery-varianttia. Kokeessa
osoitettu recovery-identity-virheen elpyminen ja katselmuksen testikohdistus
korjattiin. [Näyttö ja jäljellä olevat liitokset](release-0.3.0-integration-history.md#w75-recovery-preparation-implementation-20261107)
erottavat koeversion läpäisyn lähteen omasta todennuksesta. Mainin varaus
on tässä todellinen; erillinen runtime-poissaoloportti ja julkaisu ovat
ohjattuja koerajoja. Vanhan kirjoittajan todellinen poistuminen ja native UI
säilyvät omina ehtoinaan. Palvelun,
continuation-/tulos- ja julkaisuliitoksen portit sekä näkyvän entryn sulku
säilyvät. Ei aikarajamuutosta.

**7.11.2026, jatko- ja tulosomistajan sisäinen lähdenosto:** suljetut
recovery-variantit ja pysyvät regressiot ovat nykyisessä main-omistajassa.
Palvelu välitti kokeessa saman leasen valmistelusta jatkoon; vapautusvirhe
esti tuloksen ja onnistuminen varmennettiin ilman vanhaa leasea tai
relaunchia. Koeehdokkaan 418 testiä läpäisivät. Katselmuksen
ensisyysuoja-, reentry- ja palautusarvoaukot korjattiin ennen lähdenostoa.
[Näyttö ja rajat](release-0.3.0-integration-history.md#w75-recovery-terminal-bindings-20261107)
erottavat kontrolloidun julkaisun/terminalin todellisesta poisto- ja
journalihandoffista. Composition ei vielä muodosta uusia variantteja;
näkyvä entry/delete-IPC sekä muut omat portit säilyvät suljettuina.

<a id="w75-history-service-composition"></a>

## 8.11.2026, palvelukoosteen kontrolloitu osanäyttö

Kolme pysyvää koostekontrollia ja kuusi saman main-/palvelu-/valmisteluketjun
kontrollia todentavat rajauksen; viiden kokonaisen vaikutustiedoston
473 testiä, tyypitys, desktop-käännös ja rajattu riippumaton katselmus
läpäisivät. [Näyttö ja rajat](release-0.3.0-integration-history.md#w75-recovery-composition-wiring-20261108)
erottavat ohjatun julkaisun/terminalin fyysisestä poistosta. Tämä ei vielä
anna portteja `desktopSelectorComposition`-kutsujasta tai todenna julkaisun
alkuperäisvalinnan siirtoa. Näkyvä entry/delete-IPC pysyy suljettuna.

<a id="w75-history-joint-experiment"></a>

## 7.11.2026, ensimmäisen synteettisen yhdistelmäkokeen tulokset

**C:n ensimmäinen yhdistelmäkoe 7.11.2026, vain synteettinen kooste:**
Tuonnin sidottu positiivinen havainto vaatii nyt testilukijassa v2-journalin;
sidottu v1 jää nykyiselle palautusreitille. Hallintapalvelun yhteiskoe
luovuttaa vain neljä yllä nimettyä sidottua omistajaa. Paikallinen restore-v1
hylätään ennen palvelulle luovutusta; aiempi erillinen lähdehavainto ei ole
poistolupa. Neljän omistajan kohdekokeet läpäisivät kolmella tallennetun
aktiivivalinnan muodolla. Erilliset v1- ja restore-estokontrollit läpäisivät.

Yksi tuonnin yhdistelmäkoe vei alkuperäisen kohdevalinnan palvelun
valmistelukutsuun ja nykyisen poistoluettelon julkaisijan todellisiin
tiedostotavuihin. Ennen aloitusjournalin kirjoitusta se kaappasi nykyisen
build-/vieraan palautuksen ulkoisen valinnan saman muistissa olevan journalin
ja rekisterin jälkitilan perusteella, tarkisti alkuperäisen valinnan ennen
ja jälkeen sekä sulki vanhan lukukuitin. Pysyvä main-varaus ja uusi ulkoinen
kuitti jäivät voimaan; alkuperäinen tuontijournal, rekisteri ja synteettinen
kohdetiedosto säilyivät. Kohteen tai vieraan yrityksen myöhäinen
palautusjournal sekä pääprosessin varauksen menetys pysäyttivät julkaisun
ennen omaa aloitusjournalia ja säilyttivät tiedostot. Inventaario oli
voinut jo syntyä näissä estotapauksissa; sitä ei väitetä peruuntuneeksi.
Kuusi nimettyä kohdetestiä sekä testikoosteen tyypitys läpäisivät. Ensimmäinen
uusi julkaisukoe aikakatkaisi viidessä sekunnissa, koska koesovitin luki
koko valinnan jokaisessa sisäisessä inventaariovartijassa. Ensihylkäys
säilyy; rajattu sisäinen omistajuusvartija ja täydet siirtokohdan sekä
julkaisun vertailut läpäisivät saman viiden sekunnin rajan. Tuotantokoodia,
aikarajaa tai nykyisiä poisto-/sync-vartijoita ei muutettu.

Koosteen neljä aiempaa julkaisutilannetta käyttivät edelleen `prepare`-
testisovitinta. Erillinen yhden kohteen tuontitilanne ajoi sen sijaan
oikean `prepareWorkspaceDeletion`-järjestyksen, nykyisen palvelun ja
julkaisijan samoilla synteettisillä tavuilla ja main-varauksella.
Kahden vahvistuksen, palvelusulun, kirjoitusten hiljentämisen,
kahvojen päättymisen ja journalijulkaisun järjestys sekä kohdetavujen
säilyminen läpäisivät. Ulkoisen valinnan kuitti kaapattiin ennen
aloitusjournalin kirjoitusta. Yhteissarjan 21 testiä ja koetyypitys
läpäisivät nykyisessä viiden sekunnin testirajassa. Ensimmäinen
`realPreparation`-koe loi testivirheen vuoksi myös vieraan restore-
journalin ja hylättiin oikein; virheellinen fixture-haara korjattiin.
Sen jälkeinen ensimmäinen täysi ajo aikakatkaisi viidessä sekunnissa,
yksi nimetty ajo läpäisi ja yhdistetty sarja
läpäisi. Aikakatkaisun syytä ei väitetä korjatuksi eikä sitä lasketa
läpäisyksi. Yhden kohteen rajaus koskee vain tätä valmistelun
omistajuustestiä; erilliset vieraan kohteen estokontrollit säilyvät.

Lisäksi nykyinen kooste julkaisi yhden aloitusjournalin erikseen
sidotulle tuonnille, adoptionille, korvaukselle ja kopioaktivoinnille.
Adoption ensimmäinen koe jätti virheellisesti fixturen tuontisidonnan
paikalleen; julkaisija hylkäsi kahden omistajan ristiriidan oikein.
Fixturen korjauksen jälkeen adoption kohdeajo, korvauksen ja aktivoinnin
kohdeajo sekä koko 24 testin yhteissarja läpäisivät. Korvauksen ja
aktivoinnin ensimmäiset viiden sekunnin aikakatkaisut säilyvät
avoimina; erillisten läpäisyjen määriä ei lasketa yhteissarjan päälle.
Kunkin omistajan alkuperäisjournalin tavut säilyivät. Tämä ei todista
omistajien samanaikaista kilpailua tai oikeaa kirjoittajaprosessia.

Seuraava rajattu kooste ajoi myös oikean `prepareWorkspaceDeletion`-
järjestyksen kaikille neljälle erikseen sidotulle omistajalle nykyisellä
viiden sekunnin testirajalla: neljä koetta läpäisi. Kukin julkaisi oman
aloitusjournalinsa säilyttäen alkuperäisjournalin, rekisterin ja kohteen
synteettiset tavut; kokeen prosessisulku on edelleen mallinnettu.
Sidotun v1-tuonnin normaaliin palautukseen jäävä raja on nyt lisäksi
työpuun testitiedostossa: sen kaikki 239 testiä ja desktop-tyypitys
läpäisivät. Nämä osanäytöt eivät sulje aiempia viiden sekunnin
aikakatkaisuja eivätkä todista neljän omistajan fyysistä jatkoa.

Yksi erillinen synteettinen v1-tuonnin yhteisketjun mittaus yhdisti
valmistelun, julkaisun ja W7.4:n fyysisen kylmäjatkon. Se valmistui
ja varmisti kohdetiedoston, alkuperäisjournalin ja
poistojournalin poistumisen sekä rekisterin lopputilan. Edeltävät 30 ja 60 sekunnin
mittaukset aikakatkaisivat; niiden säilyneitä välitiloja ei merkitä
onnistuneiksi. Yhden mittauskokeen 90 sekunnin testibudjetti ei muuta
nykyisiä pysyviä testirajoja eikä todista muita kolmea omistajaa,
paketoitua prosessia tai normaalia käyttäjäpolkua.
Saman koosteen adoption-omistajan ensimmäinen erillinen 90 sekunnin
mittaus aikakatkaisi. Sidonnan siivous päättyi ennen katkaisua, mutta
lopullinen valmistuminen ja siivoustila jäivät todistamatta. Sen
ensihylkäys säilyy; tuonnin läpäisyä ei yleistetä adoptioniin eikä
W7.4:n hyväksyttyä ketjua muuteta tämän mittauksen perusteella.

Todellinen native-vahvistus, fyysinen W7.4-jatko,
käynnistyksen composition-liitos, oikea
SQLite-/Electron-/UI-ketju ja seuraavan käynnistyksen terveys ovat
vielä todistamatta. Tuotantokytkentä, puhdas paketti sekä PR/main-portit
pysyvät avoimina. Vanhan main-CI:n ja uuden mainin ensihylkäyksiä ei
merkitä läpäistyiksi.

<a id="w75-history-compatibility"></a>

## 7.11.2026, palautusomistajien yhteensopivuuskokeen tulokset

**C:n yhteensopivuuskokeen toteutus 7.11.2026, vain testikooste:**
tuonti ja adoption käyttävät ensin nykyistä `inspectRecoverySelection`-
valintaa. Vain valitun lähteen täsmällisen sidonnan todistettu poissaolo
palauttaa nimetyn normaalireitin ilman pois jäävien sisarusten parsintaa.
Sidottu kohde vaatii edelleen nykyiset tiukat kaikki-slotit-tarkistukset;
niiden tavut ja identiteetit verrataan alkuperäiseen lähdehavaintoon.
Normaalireitin julkaisu odottaa aloitetut luvut ja tarkistaa varauksen
ennen havainnon päättämistä. Osittainen sidonta, muuttunut valinta ja
virheellinen valittu journal eivät saa fallbackia.

Vertailu käyttää itsenäisiä tiedostotavuja ja nykyisiä omistajia:
`WorkspaceBackupImportRecovery` ja `recoverWorkspaceLegacyAdoption`
ajetaan sekä suoraan että havaintovaiheen jälkeen. Seitsemän slottiyhdistelmän
lisäksi erotetaan hylättyjen sisarusten sisältö, eri operaatiot ja käänteiset
siirtymät. Viimeiset validoidaan ensin erikseen kelvollisiksi journaleiksi
ja niiden keskinäinen siirtymä todetaan kielletyksi. Tuonnin v1-hylkäys
ja adoptionin fresh/recoveryRequired-hylkäys säilyvät. Vertailu tarkistaa
myös todelliset poistuneet ja säilyneet tiedostot, ei vain tuloskoodia.
Candidate-sisältötyö ja osa nykyisen cold-fixtuurin omistajuudesta ovat
mallinnettuja; tämä ei ole SQLite-/Electron-/pakettiketjun näyttö.

Paikallinen restore ja kukin neljästä samalle kohteelle sidotusta
yhteisestä omistajasta voidaan kokeessa havaita yhdessä tallennetun
aktiiviosoitteen ollessa sama, toinen tai null. Nykyisen cold-admissionin
tulos säilyy. Tuonnin kolme yhdistelmää ajavat lisäksi oikean
palautusomistajan: normaali admission estää jatkon ennen payloadin lukua
myös hallintaan tarjoamisen jälkeen. Havainto ei anna poistolupaa.
Muiden yhteisten omistajien koko tavallista käynnistysketjua ei tällä
vertailulla väitetä todennetuksi.

Katselmus löysi yhden liian aikaisen kilpailuhookin ja käänteisen siirtymän
virheellisen fixtuurin; molemmat korjattiin ja alkuperäiset tulokset säilyvät.
Viimeiseen rajattuun lähdekatselmukseen ei jäänyt löydöstä. Viimeisen
fixtuurikorjauksen sisältävät yhdeksän kokonaista vaikutustiedostoa
läpäisivät 503 testiä ja desktop-tyypitys läpäisi. Aiempi 489 testin sarja
sekä viimeistä fixtuurikorjausta edeltänyt 503 testin sarja ovat osanäyttöjä;
niitä ei summata tai käytetä viimeisen lähteen korvikkeena.
Testiapuri pysyy tuotantokäännöksen
ulkopuolella. Aikarajoja, riippuvuuksia tai tuotannon palautuspolkuja
ei muutettu. Kaksi nimettyä vertailukontrollia todisti yhteisen activationin
ja paikallisen restoren laiskan valinnan eron koeluennan
kaikki-slotit-tarkistukseen. Yhteisen sidonnattoman activationin jatko on
alla; paikallinen raja säilyy avoimena eikä sitä kierretä catch-fallbackilla.
Varsinaisen startup-/palvelu-/IPC-liitoksen hyväksyntä
ja koko W7.5:n portit säilyvät erillisinä.

<a id="w75-history-restore-read"></a>

## 7.11.2026, paikallisen restore-lukijan osanäyttö

Yhdentoista kokonaisen vaikutustiedoston 1 092 testiä läpäisi ennen
viimeisiä testitäsmennyksiä. Lopullisen lähteen kolme kokonaista
lähitiedostoa läpäisi 298 testiä ja desktop-tyypitys läpäisi; sarjat ovat
päällekkäisiä eikä niitä summata. Rajatun katselmuksen testihakemiston
oikeus- ja täyden tavuvertailun puutteet korjattiin ennen viimeistä ajoa;
jälkikatselmukseen ei jäänyt löydöstä. Tämä ei ole Linux-ajon,
SQLite-/Electron-ketjun tai paketin hyväksyntä. Paikallisen restoren ja
muiden sidottujen reunatilojen kelpoisuusluokitus tarvitsee oman näytön
ennen startup-entryä.
Tämä rajattu sisäinen luentakoe ei aktivoi hallintaa, v2:ta tai delete-IPC:tä.

<a id="w75-history-local-payload"></a>

## 7.11.2026, paikallisen payload-havainnon vertailunäyttö

Vertailukokeen 22 kohdekontrollia läpäisi. Katselmuksessa tarkennettiin
pysyvän päättymisen väittämää: toinen kutsu säilyttää saman ensivirheolion
eikä kutsu tiedostolukijaa uudelleen. Uusien synteettisten hakemistojen
yksityiset oikeudet asetettiin myös Unix-järjestelmille; tämä on
testiaineiston korjaus, ei sovelluksen oikeusvaatimuksen lievennys.
Lähdehavaintokokeen 11 kokonaista vaikutustiedostoa läpäisi 1 121 testiä
ilman ohituksia tai uusintaa, ja desktop-tyypitys läpäisi. Sarja kattaa
myös edellä kuvatun yhteisen activationin havaintoportin viimeiset
testitäsmennykset. Aiemmat 503, 1 092 ja 298 testin sarjat sekä
kohdevalinnat ovat päällekkäisiä osanäyttöjä, eivät yhteen laskettava
hyväksyntämäärä. Rajattuun jälkikatselmukseen ei jäänyt löydöstä.
Tämä Windows-kehitysajo ei ole Linux-, SQLite-/Electron- tai
pakettihyväksyntä. Paikallinen vaihtoehto on edelleen erikseen valittava
testikooste, ei tuotannon uusi kelpoisuussääntö. Normaali oletus,
palautusomistajat, poistovartijat ja aikarajat säilyvät.

Omistajakohtainen ketjuvertailu käyttää nykyistä
`profileRestoreActivationTransaction.test.ts`-fixtuuria ja oikeita
`ProfileRestoreStartupRecovery`-/`ProfileRestoreActivationTransaction`-
omistajia. Kuusi tapausta erottaa valmistellun palautuksen, hylätyn
katkenneen sisaruksen, backup/next-valinnan, keskeytyneen eteenpäinsiirron,
keskeytyneen rollbackin ja synteettisen `failedSafe`-journalin. Suora
ja vain luku -havainnon jälkeinen valmistelu tuottivat saman tuloksen ja
vaiheen, turvalliset tapahtumat ja kaikkien runtime-tiedostojen täydet
tavut. Havainto ei tehnyt muutosta tai antanut palautusvaltuutta. Koe päättyy
ennen backendin avausta; tietokantanimiset tiedostot ovat synteettisiä
siirtotavuja, eivät SQLite-validoinnin näyttöä. Se ei vielä yhdistä
mainin kohdehakua, palvelun admissionia tai tuotannon hallintaentryä.
Kuusi kohdekontrollia ja kolme kokonaista palautustiedostoa (645 testiä)
läpäisivät nykyrajoilla ilman uusintaa, ja lopullinen desktop-tyypitys läpäisi.
Aiempi 1 121 testin sarja on
päällekkäinen ja edeltää näitä kuutta lisäystä; määriä ei summata.
Alkuperäinen uuden testin parametrikytkennän tyypityshylkäys säilyy:
korjaus käytti nykyistä kontekstin välittävää testimuotoa eikä muuttanut
sovelluskoodia. Vertailutyön sulku odottaa keskeneräisen työn ennen
yhteisten testimokkien palautusta ja säilyttää epäonnistuneen aineiston.
Rajattuun lähdekatselmukseen ei jäänyt löydöstä. Tämä on omistajan
todellinen ennen-backendia-ketju, ei vielä mainin ja palvelun yhteisketju.

<a id="w75-history-status-lifetime"></a>

## 7.11.2026, tilaluennan elinikäkokeen osanäyttö

Seitsemän kohdekontrollia läpäisi. Nykyisen palvelun vaihekontrollissa
yleinen admission esti komennon ennen sen toteuttajaa; tätä ei lasketa
uuden delete-admissionin tai fyysisen poistoketjun näytöksi. Erillinen
luenta ei muuttanut pääomistajan vertailupohjaa tai ensivirhettä, luovutus
odotti myös vanhentuneen pyynnön päättymisen ja sen jälkeen saapunut
pyyntö hylättiin ilman uutta tiedostolukua. Todellisen main-varauksen
menetys esti myös pääomistajan jatkon. Lopullisen lähteen neljä kokonaista
tiedostoa läpäisi 299 testiä ja desktop-tyypitys läpäisi. Rajattuun
jälkikatselmukseen ei jäänyt löydöstä. Aiempi 299 testin ajo edeltää
myöhäisen pääsyn väittämän täsmennystä; sarjoja ei summata.
Muutokset ovat vain testikoosteessa. V2-vastauksen tuotantolukija,
runtime-poissaolon todellinen startup-liitos, delete-palvelun rajattu
admission ja julkinen kanava säilyvät avoimina erillisine portteineen.

<a id="w75-history-status-projection"></a>

## 7.11.2026, idle-/busy-projektion osanäyttö

Kokeen 16 kohdekontrollia ja lopullisen lähteen viisi kokonaista
omistajatiedostoa (361 testiä) läpäisivät nykyrajoilla ilman uusintaa;
lopullinen desktop-tyypitys läpäisi. Rajattuun lähdekatselmukseen ei
jäänyt löydöstä. Kokeessa runtime-poissaolo on kontrolloitu erillinen
portti, ei oikean startupin poistumistodiste. Aiemmat sarjat ovat
päällekkäisiä osanäyttöjä; tämäkään ei hyväksy tuotannon tilajulkaisua,
palautushallintaan pääsyä tai poistokanavaa.

<a id="w75-history-runtime-separation"></a>

## 7.11.2026, tallennetun valinnan erottelukokeen tulos

Ehdokkaan 29 kontrollia ja neljä kokonaista tiedostoa (175 testiä)
läpäisivät nykyrajoilla ilman ohituksia tai automaattisia uusintoja.
Lopullinen ehdokkaan ja desktopin tyypitys läpäisi; lähdetiedostojen
muuttumattomuus varmennettiin. Rajattuun jälkikatselmukseen ei jäänyt
löydöstä. Katselmuksen kahden
aukon kontrollit hylkäsivät ensin puutteellisen ehdokkaan ja läpäisivät
korjauksen; näitä ajoja ei summata. Vanhan peruutuspalautustestin
yhden tapahtuman väittämä hylkäsi myös ilman koemuunnosta: nykyinen
palvelu kirjaa alkuvirheen ja erillisen siivousvirheen. Testi vaatii nyt
molemmat oikeassa järjestyksessä samalla korrelaatiolla ja ilman raakasyytä;
varsinaiset sulku- ja no-relaunch-väittämät säilyvät. Ensimmäiset
tyypitys-, fixture- ja väittämähylkäykset säilytetään kokeen aineistossa.
175 testin ajo ei korvaa aiempaa 361 testin tilaprojektiota tai koko
käynnistys-/palvelu-/UI-/pakettiketjun hyväksyntää.

<a id="w75-history-service-admission"></a>

## 7.11.2026, palveluadmissionin koetulos

Kokeen 24 kontrollia ja viisi kokonaista tiedostoa (179 testiä)
läpäisivät nykyrajoilla ilman ohituksia tai uusintaa. Lopullisen lähteen
tyypitys läpäisi; sovelluksen palvelulähde säilyi muuttumattomana.
Katselmuksen yksi uuden odotusrajan admission-aukko todennettiin ensin
hylkäävällä kontrollilla ja korjattiin ennen kokonaisajoa. Jälkikatselmukseen
ei jäänyt löydöstä. Ensimmäiset koetestien tyyppihylkäykset säilyvät
aineistossa; tiukkoja TypeScript-asetuksia ei muutettu. Aiemmat 21 ja 24
testin kohdeajot ovat päällekkäisiä osanäyttöjä. Tämä ei yhdistä
179 testin palvelukoetta aiempaan 175 testin runtime-kokeeseen eikä
hyväksy koko main-/palvelu-/renderer-/pakettiketjua.

<a id="w75-history-status-channel"></a>

## 7.11.2026, palvelu- ja tilakanavaliitoksen osanäyttö

Ensimmäinen koetesti hylkäsi virheellisen saman ajon uusintaoletuksen;
korjattu kahden erillisen valintatilanteen koe läpäisi 26 kontrollia.
Tuotantolähteellä 181 palvelu-/tilaregressiota ja 94 capability-/protokolla-
regressiota läpäisivät, samoin desktop-tyypitys. Koekontrollit siirrettiin
versionoiduksi palvelutestiksi. Lopullinen yhdeksän vaikutustiedoston
296 testin kohdeajo ja desktop-tyypitys läpäisivät nykyrajoilla.
Tämä liitos ei vielä
anna luotettua startup-tuottajaa, oikeaa runtime-poissaolotodistetta,
palautushallinnan composition-haaraa, näkyvää v2-näkymää tai delete-IPC:tä.
Ne ja koko native-/UI-/palautusketju ovat erillisiä näyttöportteja.

<a id="w75-history-reader-service"></a>

## 7.11.2026, tiedostolukijan ja palvelun yhteiskokeen tulos

Yhteiskokeen 18 kohdekontrollia ja seitsemän kokonaista tiedostoa
(462 testiä) läpäisivät nykyrajoilla ilman ohituksia tai uusintaa.
Lopullisen lähteen tyypitys läpäisi, ja lähdetavujen muuttumattomuus
varmennettiin kokonaisajon yli. Sarja sisältää nykyisen kylmätuonnin
byte-equivalence-/virheregressiot;
aiempia 179 ja 175 testin sarjoja ei lisätä tähän määrään.
Rajattuun lähdekatselmukseen ei jäänyt löydöstä. Uutta valmistelua tai
fyysistä poistoa ei hyväksytä kontrolloidun peruutusvastauksen perusteella.
Myös normaali palautus, julkinen kanava ja koko Goalin portit säilyvät
erillisinä. Synkronisen testiapuportin ainoat lähdekuluttajat ovat
nykyiset kaksi testitiedostoa; tuotantokutsua ei lisätty.

<a id="w75-history-result-runtime"></a>

## 7.11.2026, valmistumisen paluukokeen tulos

Lopullinen muistiehdokas läpäisi viiden kokonaisen tiedoston 464 testiä,
tyypityksen ja rajatun jälkikatselmuksen nykyrajoilla. Katselmuksen kaksi
ulomman odotusrajan aukkoa todennettiin ensin hylkäävillä kontrolleilla ja
korjattiin; loppuvalinta ja täsmälliset tavuväittämät täydennettiin ennen
lopullista sarjaa. Ensimmäiset koetyypitys- ja virhekoodiväittämän hylkäykset
säilyvät aineistossa. Aiemmat kohdeajot ja 462 testin palveluyhteiskoe ovat
päällekkäisiä osanäyttöjä, eivät lisättäviä hyväksyntämääriä. Sovelluslähteet,
aikarajat, formaatit ja julkisten kanavien sulku säilyivät muuttumattomina.

<a id="w75-history-startup-placement"></a>

## 7.11.2026, käynnistyssijoituksen koetulos

Kuusitoista uutta kontrollia ja kaksi nykyistä main-käynnistystestiä
läpäisivät nykyrajoilla. Muut Main-testit jäivät valitsematta, eivät
läpäisseiksi; vanha avoin Main-hylkäys säilyy. Lisäksi molemmat nykyisen
käynnistys-/quit-omistajan kokonaiset tiedostot (33 testiä) ja lopullinen
tyypitys läpäisivät. Ensimmäiset koetyypitysvirheet, omistajakaappauksen
hylkäävä kontrolli ja istuntovastaukseltaan puutteellisen koefixtuurin
hylkäykset säilyvät aineistossa. Fixtuurin korjaus säilyttää väärän
istunnon todellisen 401-vaatimuksen. Näitä osanäyttöjä ei yhdistetä
aiempaan paluukokeeseen tai koko W7.5:n hyväksyntään.

<a id="w75-history-early-read-results"></a>

## 6.11.2026, alkuperäisjournalien lukukokeet

**Ensimmäisen lukukokeen osanäyttö 6.11.2026:** nykyisen
`workspaceDeletionOriginalJournalSelection.test.ts`-fixturen 12 uutta
kontrollia yhdistävät oikean v2-rekisterin ja nykyisen alkuperäisjournalin
lukijan. Neljä sidottua omistajaa säilytti ei-null-aktiivivalinnan;
rekisterivalinnan, identiteetin ja sivuslottien muutos, väärä lineage,
puuttuva sidonta sekä viivästetyn luvun aikana menetetty työlupa tai
havaittu kirjoittaja estivät jatkon säilyttäen aineiston. Ei-null-valinta
esti tavallisen valitsimen; se ei vielä käyttänyt journalien konfliktihakua.
Erilliset nykyiset valitsin- ja yleisen hallintavartijan regressiot
läpäisivät samassa ajossa, eivät uuden todistuksen admission-ketjuna. Kolme kokonaista
tiedostoa läpäisi 128 testiä muuttamattomilla rajoilla. Aiemmat osanäytöt
ovat päällekkäisiä, eikä niitä summata tähän.
Katselmuksen viivästetyn luvun sulkunäytön puute korjattiin tarkistamalla
kokonainen tapahtumakierros ja lukutuloksen päättyminen ennen hylkäystä.
Koeapu on vain testissä, ei mainin uusi admission-omistaja. Se ei todista
rekisterin muutosta ensimmäisen kaappauksen aikana, koko sidottua vieraan
kohteen/activation-aliasien matriisia, kaikkia alkuperäisjournalien tiloja tai globaalia build-/vierasjournalivalintaa,
todellista prosessivarausta, peruutuksen paluuta tai uuden hallintatilan
käynnistys-/palvelu-/renderer-ketjua. Ne sekä tuotantokytkentä ovat avoinna.

**Lukukokeen vaihekohtainen jatko 6.11.2026:** sama koeapu kattaa nyt
importin seitsemän tilaa, legacy-adoptionin viisi tilaa ja kummankin
activation-omistajan 14 vaihetta nykyisessä journal-slotissa. Lisäksi
rekisterin valinta-/identiteettimuutos ensimmäisen kaappauksen aikana,
kaikkien neljän omistajan vieras kohdesidonta ja molemmat activation-aliasit
estivät todistuksen muodostamisen säilyttäen todelliset tavut.
Kolme kokonaista tiedostoa läpäisi 176 testiä muuttamattomilla rajoilla;
aiempi 128 testin ajo on päällekkäinen osanäyttö, ei lisättävä testimäärä.
Ensimmäisen jatkoajon tavusäiliötyypin vertailuvirhe korjattiin testiin:
`Buffer` ja `Uint8Array` verrataan samana täsmällisenä tavujonona.
Ensihylkäys säilyy, eikä tämä korjaa aiempia sovellus-/CI-aikakatkaisuja.
Yksittäisen nyky-slotin vaiheen tunnistus ei vielä todista vaiheiden
historiallista siirtymää, keskeytyneiden sivuslottien koko matriisia,
tuoretta build-/vierasjournalivalintaa tai todellista pääprosessivarausta.
Seuraava koe yhdistää nämä nykyisiin omistajiin ennen uuden admissionin
tai käyttöliittymän tuotantopäätöstä. Kohdekohtainen profile-restore ja
vanhat muodot säilyvät avoimina osana samaa täyttä W7.5-tavoitetta.
Lopullinen desktop-tyypitys läpäisi. Laajennuksen rajattu riippumaton
lähdekatselmus ei löytänyt puutetta; se ei ole koko Goalin loppukatselmus.

<a id="w75-history-early-conflict-results"></a>

## 6.11.2026, lukutyön sulun ja konfliktien jatkokokeet

Katselmuksen testiapurin valmistelu-, peruutus- ja varauskahvan
siivouspuutteet korjattiin: koko valmistelu ja aloitettu varauksen
palautustyö odotetaan loppuun ennen sulkua, ja palautuksen siivouselinikä
on erillinen perutusta havainnoinnista. Kuudes kontrolli todensi peruutuksen
oikean varauksen omistajuusluvun aikana sekä vanhan todistuksen hylkäyksen.
Korjatun lähteen kuuden kokonaisen vaikutustiedoston 282 testiä ja
desktop-tyypitys läpäisivät nykyrajoilla; aiemmat 215 ja 176 ovat
päällekkäisiä osanäyttöjä. Rajattu jälkikatselmus ei löytänyt puutetta.
Tämä ei ole koko fixturen pakotettu timeout-koe: esimerkiksi ensimmäisen
väliaikaisjuuren luonnin keskeytystä ei todennettu tällä kontrollilla.

**Konfliktien yhteiskoe 6.11.2026:** samassa testikoosteessa on nyt toinen
yritys ja seitsemän nimettyä estävää journalikohdetta: creation, switch,
W6-migration, julkaistu poisto, legacy-profiilin palautus, toisen yrityksen
palautus sekä vielä todistamaton kohteen oma paikallinen palautus.
Nykyiset polkuomistajat ja `hasAnyJournalSlot` tarkistavat kunkin current-,
next- ja backup-slotin. Kaikki 21 tapausta estivät lukutodistuksen ja
säilyttivät rekisterin sekä alkuperäisjournalin tavut. Myös ensimmäisen
kaappauksen aikana ilmestynyt vieras palautus estettiin; havaitun globaalin
ristiriidan poistuminen ei elvyttänyt vanhaa todistusta.
Kokeen oma paikallinen palautusesto on puuttuvan todistuksen rajaus,
ei hyväksytty pysyvä tuotantorajoitus tai W7.5:n kohdepoiston kavennus.
Kokeen ensimmäinen tyypitys havaitsi validoimattoman yritystunnisteen
apuparametrissa; korjaus käyttää nykyistä `validateWorkspaceId`-omistajaa
ilman tyyppipakotusta. Ensihylkäys säilyy.
Korjatun lähteen 29 yhdistelmäkontrollia, kuuden kokonaisen
vaikutustiedoston 305 testiä ja desktop-tyypitys läpäisivät nykyrajoilla.
Tämän kokeen jälkeen koeluettelon rajattu tuotantokatselmus oli avoin;
sen tulos ja jäljelle jäävät liitokset ovat alla yhteiskatselmuksessa.

<a id="w75-history-phase-proof"></a>

## 6.11.2026, vaihesuojan muistiehdokkaan tulokset

Katselmus täsmensi ensivirhekontrollin ja sulkuodotuksen väittämiä:
hylätyn tilaluvun jälkeen julkaisuvartijaa ei kutsuta korvaamaan ensisyytä,
ja todellinen capability-sulku odottaa pidettyä ulompaa vastaustyötä.
Lopullinen ehdokastyypitys sekä kuuden tiedoston 183 testiä läpäisivät,
joista 18 oli tämän ehdokkaan kontrolleja. Aiempi 182 testin ajo sekä
124 testin status-/palvelunäyttö ovat päällekkäisiä, eikä niitä summata.
Ensimmäiset koevalmistelun tyyppi-/tiedostovalintaongelmat korjattiin;
tiedostovalinnan ensimmäinen yritys ei suorittanut testejä.
Rajattuun jälkikatselmukseen ei jäänyt löydöstä.

Tämä on nykyisten Node-omistajien koe kontrolloidulla ikkunalla,
main-omistajavartijalla ja poistokutsulla, ei oikean Electron-IPC:n,
SQLite-palautuksen tai uuden v2-entryn hyväksyntä. Sovelluksen aikarajoja,
muutosvartijoita tai tavallisen v1:n merkitystä ei muutettu.
Seuraava erillinen tuotantopäätös voi koskea koetodettua muoto-/vaihesuojan
perustaa nykyisissä omistajissa pysyvine regressioineen. Uusi native-valinta,
palautushallinnan kytkentä ja delete-IPC säilyvät senkin ulkopuolella;
niiden myöhemmät portit ja koko W7.5:n hyväksyntä säilyvät.

<a id="w75-history-status-production"></a>

## 6.11.2026, pysyvän vaihesuojan osanäyttö

Seitsemän kokonaisen lähitiedoston 235 testiä, kahdeksan vaikutustiedoston
233 testiä, lopullinen tyypitys ja desktop-käännös läpäisivät nykyrajoilla.
Koetiedostoja ei tullut sovelluskäännökseen. Ensimmäinen vaikutusajo
hylkäsi kolme valmistumisen testiä: ne odottivat yhtä tapahtumaa, vaikka
jo edeltävä palvelu ja tapahtumakatalogi vaativat ensivirheen ja erillisen
`deleteCleanup`-virheen. Vain nämä väittämät korjattiin vaatimaan molemmat
tapahtumat järjestyksessä, samalla korrelaatiolla ja ilman raakasyytä.
Alkuperäisen syyn, sulun ja paluukäynnistyksen väittämät säilyivät;
sovelluksen tapahtumapolkua ei muutettu. Ensihylkäys säilytettiin.

Pysyvän testin pakotettu hylkäys todensi nykyisen keräys -> OpenPGP ->
purku-ketjun: alkuperäinen viesti, pino ja syyketju, raporttitavut,
tiivisteet sekä koko testisidonta säilyivät. Sisäinen testi jäi punaiseksi,
eikä raakasyy tullut julkiseen tulosteeseen. Rajattuihin toteutus- ja
testikorjauksen katselmuksiin ei jäänyt löydöstä. Tämä ei ole hosted-,
oikean Electron-IPC:n tai paketoidun palautuksen hyväksyntä. Uusi native-
valinta, palautushallinnan kytkentä, v2-julkaisu ja delete-IPC pysyvät
erillisen päätöksen ja todennuksen takana. Vanha koko Main-sarjan
aikakatkaisu ja W7.5:n integraatio-/julkaisuportit säilyvät avoimina.

<a id="w75-history-local-read-results"></a>

## 6.11.2026, paikallisen palautuksen ja sivuslottien lukukokeet

**Paikallisen palautuksen rajattu lukukoe 6.11.2026:** sama mainin oikeaa
IPC-varausta käyttävä fixture lukee nyt kohteen oman palautusjournalin ilman
tuonti- tai poistojournalia ja ilman jaetun activationin sidonnan lavastamista.
Kanonisen yritysjuuren identiteetti, nykyinen rekisterivalinta, build-valinta
ja palautusjournalin todelliset tavut/identiteetti yhdistyvät vain testissä.
Ensimmäisessä osakokeessa kaikki 14 vaihetta luettiin current-slotista;
tämä ei todista vaiheiden historiallisia siirtymiä. Puuttuva tai virheellinen
journal ei kelvannut myönteiseksi havainnoksi. Sivuslotin esto oli tämän
ensimmäisen osakokeen rajaus, ei pysyvä tuotantorajoitus; jatko on alla.

Rekisterissä on kolme yritystä, ja vieraat palautuspolut johdetaan kaikista
validoiduista ei-kohde-entryistä. Kummankin vieraan yrityksen kolme
journalislottia estivät kohteen lukutodisteen; kaikkien yritysten
sentinel-tavut, kohdejournal ja rekisteri säilyivät. Kohteen tavujen,
tiedostoidentiteetin, kansioidentiteetin tai slottivalinnan muutos sekä
main-varauksen luovutus päättivät vanhan havainnon pysyvästi.
Viivästetty kohdejournalin lukukutsu päättyi ennen peruutuksen palautumista;
tämä ei ole avoimen OS-tiedostokahvan tai kaikkien kirjoittajien
poissaolotodistus.

Katselmuksessa tarkennettiin kaksi näyttöaukkoa: viivästys kohdistuu nyt
juuri kohdejournalin operaation lukuun, ja kansioidentiteetin vaihdossa
journalin tavut sekä täydellinen tiedostoidentiteetti pysyvät samoina.
Rajattuun jälkikatselmukseen ei jäänyt löydöstä. Korjatun lähteen seitsemän
kokonaista vaikutustiedostoa läpäisi 398 testiä, joista 58 on tämän
yhdistelmäfixturen kontrolleja, ja desktop-tyypitys läpäisi.
Aiempi 52 testin osakoe ja 305 testin vaikutusajo ovat päällekkäisiä,
eivät lisättäviä testimääriä. Ensimmäinen tyypitys hylkäsi testiapurin
puutteellisen null-rajauksen; korjaus ei käytä tyyppipakotusta ja
ensihylkäys säilyy. Tämä 398 testin lähisarja ei ole erillisen
Main-tiedoston hyväksyntä: sen aiempi 401/402-tulos ja aikakatkaisun syy
pysyvät avoimina. Täysi sivuslottisiirtymien matriisi, myöhäiset yhdistelmäkonfliktit
sekä todellinen startup-/palvelu-/renderer-ketju ja tuotantohyväksyntä ovat
edelleen avoinna. Käynnistysvalinnan erillinen suunnittelu- ja koelupa
ei vielä hyväksy tuotantokytkentää.

**Sivuslottikokeen jatko 6.11.2026:** sama testikooste tarkistaa nyt
positiivisen yhden tai kahden slotin havainnon järjestyksessä
backup/current/next. Kahden slotin versionmuutos tarkistetaan nykyisellä
`assertProfileRestoreActivationJournalStep`-omistajalla, ei rinnakkaisella
tilakoneella. Kaikkien slottien tavut, identiteetit ja poissaolot verrataan
uudelleen ennen havainnon hyväksymistä; lukija ei korjaa tai julkaise niitä.
Yhdeksän kontrollia kattaa kolme slottiparia samalla versiolla,
forward-askeleella ja rollback-päätteellä. Kaksi kontrollia lukee pelkän
backup- tai next-slotin julkaisematta currentia. Neljä kielteistä kontrollia
säilyttää eri operaation, virheellisen revision/vaiheen tai kolme slottia.
Koosteessa on nyt 73 kontrollia; seitsemän kokonaista vaikutustiedostoa
läpäisi 413 testiä ja lopullinen desktop-tyypitys nykyrajoilla.
Rajattu riippumaton jatkokatselmus ei
löytänyt puutetta. Aiemmat 398 ja 305 testin osanäytöt ovat päällekkäisiä.
Tämä on edustava siirtymänäyttö, ei kaikkien historiallisten vaiheparien,
parillisten slottien erillisen muutos-/keskeytysmatriisin tai tuotantoon
kytketyn startupin hyväksyntä. Main-portin aiempi aikakatkaisu säilyy avoimena.

**Myöhäisten ristiriitojen jatko 6.11.2026:** kolme kontrollia lisää
juuri kohdejournalin lukukutsun aikana vieraan yrityksen palautuksen,
muuttuneen rekisterin tai kilpailevan yhteisen tuontijournalin. Kaikki
estivät havainnon ja säilyttivät muuttuneet tavut sekä kohdejournalin.
Neljäs kontrolli vaihtaa vain edeltäjäslotin tiedostoidentiteetin:
uusin versio, sen identiteetti ja kaikkien slottien tavut pysyvät ennallaan,
mutta vanha havainto hylätään. Rajattu riippumaton lähdekatselmus ei
löytänyt puutetta. Seitsemän kokonaista vaikutustiedostoa läpäisi 417 testiä,
joista 77 on yhdistelmäkontrolleja, ja desktop-tyypitys läpäisi.
Aiemmat 413/398/305-testiset ajot ovat päällekkäisiä osanäyttöjä.

<a id="w75-history-shutdown-experiments"></a>

## 6.11.2026, sulkusopimuksen ensimmäinen koe

**Sulkusopimuksen ensimmäinen koe 6.11.2026:** tuotantobuildista nykyisellä
`*TestSupport.ts`-rajauksella poissuljettu ehdokas käyttää nykyistä
`desktopBeforeQuit`-käsittelijää ja `runSafeDesktopStartup`-virherajaa.
Kolmetoista kontrollia todentaa sulun synkronisen reentryn, pidetyn
lukutyön ja dialogin erillisen päättymisen, myöhäisen lifecycle-kahvan
sulun, luovutuksen jälkeisen pysyvän sulkulipun sekä suoraa virhe-exitia
edeltävän odotuksen. Normaalin recoveryn valtuus ei riipu kokeen sulkulipusta.
Kokeen lifecycle-oliot eivät ole oikeita selector-/backend-käynnistyksiä.

<a id="w75-history-shutdown-native"></a>

## 6.11.2026, sulkusopimuksen yhteiskoe ja native-API

Sama ehdokas on yhdistetty yhteen nykyisen havaintofixturen oikean
main-varauksen ja viivästetyn kohdejournalin lukukutsun kokeeseen. Varaus
pysyi hallussa luvun aikana, kilpaileva hankinta estyi ja vasta luvun
päätyttyä nykyinen omistaja sulki varauksen. Se saatiin uudelleen haltuun;
journalin ja rekisterin tavut säilyivät. Tämä ei todista OS-tiedostokahvan,
kaikkien kirjoittajien tai native-dialogin päättymistä. Ensimmäinen ajo
hylkäsi uuden testin virheellisen loppuvirheodotuksen: suljetun varauksen
vartija ehtii ennen perutun havainnon omaa virhettä. Korjattu täsmällinen
odotus läpäisi, ja ensihylkäys säilyy.

Lopullinen desktop-tyypitys ja 11 kokonaisen vaikutustiedoston 489 testiä
läpäisivät nykyrajoilla. Mukana ovat aiemmat havaintotestit ja nykyiset
indexin tukivientiregressiot, eivät uuden index-kytkennän todennus.
Aiemmat 417/52-testiset osanäytöt ovat päällekkäisiä. Seuraavaksi sama
sopimus on todennettava oikeassa index-/composition-liitoksessa, myöhäisessä
`ready-to-show`-/relaunch-ketjussa ja oikean Windows-dialogin sulussa.
Näitä tai tuotantokytkentää ei hyväksytä tällä testikoosteella. Main-portin
aiempi aikakatkaisu ja W7.5:n muut päätös-/integraatioportit säilyvät avoimina.

**Oikean native-API:n rajattu jatkokoe 6.11.2026:** nykyisen eristetyn
Electron-fixturen backenditon tyhjä valitsin suorittaa nyt kokeen
`DESK-RECOVERY-DIALOG-001`. Testi kutsuu oikeaa `dialog.showMessageBox`-APIa
ilman omistajaikkunaa. Main tarkistaa samassa callbackissa odottavan tilan
välittömästi ennen omaa aborttia ja odottaa alkuperäisen Promisen
cancelId-vastauksen. Rekisteritavut, runtime-identiteetti ja nolla
backend-käynnistystä säilyvät. Lopuksi kokeen main-only-tila poistetaan
vasta dialogityön päätyttyä; nykyinen fixture vaatii omistetun puun,
portin ja testijuuren siivouksen. Ensivirhe ei peity erilliseen sulkuvirheeseen.

Katselmuksen cross-process-tarkistusväli korjattiin ennen native-ajoa.
Nykyinen valmisteluketju, E2E-tyypitys ja yksi nimetty Windows-koe läpäisivät
ilman uusintaa tai rajamuutosta. Testin pending-havainto ei yksin todista
OS-ikkunan ehtineen näkyä näytöllä. Tämä on oikean API:n peruutusnäyttö
valmiissa backendittomassa testiruntimessa, ei uuden pre-window-entryn,
varsinaisen index-sulkuliitoksen tai paketoidun tuotteen hyväksyntä.

<a id="w75-history-shutdown-production"></a>

## 6.11.2026, sulkuliitoksen toteutusnäyttö

**Sulkuliitoksen toteutusnäyttö 6.11.2026:** sama kokeiltu käynnistysomistaja
on nyt tuotantolähteessä; rinnakkaista koetoteutusta ei säilytetä.
Lopullinen tyypitys, viiden kokonaisen lähitiedoston 85 testiä ja seitsemän
omistajuus-/palautustiedoston 418 testiä läpäisivät. Kaksi nimettyä
composition-kontrollia todistaa aktiivisen ja backendittömän valitsimen
myöhäisen esityksen eston sekä nykyisen omistajan loppuvapautuksen.
Ne käyttävät kontrolloitua backendia ja ikkunaa, eivät oikeaa SQLite- tai
pakettiketjua; muut 420 Main-testiä eivät olleet tämän kohdeajon valinnassa.
Indexin regressiot kattavat jaetun sulun, myöhäisen kahvan, alkuperäisen
virheen, sallittavan ja estettävän relaunchin sekä asentimelle lykätyn quitin.
Rajatussa riippumattomassa katselmuksessa loppuvapautuksen testiväitettä
vahvistettiin, eikä avoimia löydöksiä jäänyt.

Nykyisen indexin virhehaaran pakotettu testihylkäys toimitti alkuperäisen
käynnistyssyyn ja pinon nykyisen salatun paketin purkuun; tavut, tiivisteet
ja testisidonta varmennettiin eikä raakasyy tullut julkiseen tulosteeseen.
Sisäinen testi jäi tarkoituksella punaiseksi. Tämä on kontrolloidun
composition-hylkäyksen ja oikean indexin todistus, ei uuden palautushallinnan
tai paketoidun tuotteen hyväksyntä. Nykyisen havaintotyön tuotantorekisteröinti
ja sen erilliset päätös-/näyttöportit ovat edelleen avoinna.
Vanha Main-portin aikakatkaisu säilyy avoimena; osanäyttöjä ei summata
aiempiin kokeisiin eikä aikarajoja muutettu.

Sulkuliitoksen nykyisestä lähteestä tehty Electron-valmistelu ja sama
`DESK-RECOVERY-DIALOG-001` läpäisivät myös tuotantolähteen muutosten jälkeen.
Koe todentaa oikean native-API:n peruutuksen ja nykyisen fixturen sulun,
ei indexin uutta havaintorekisteröintiä tai pre-window-hallinnan avaamista.
Tuotantobuild sisältää vain yhden käynnistysomistajan; testit ja
havaintokoetta palveleva `*TestSupport.ts` eivät sisälly siihen.

<a id="w75-history-terminal-prefix"></a>

## 9.11.2026, terminal-luennan vertailukokeen osanäyttö

**Rajattu koetulos:** kahden omistajan ehdokas ladattiin vain testiprosessin
muistiin. Koemalli käyttää nykyistä cold-omistajaa ja sen erillisiä vakaan
valinnan ja yhdistetyn varauksen portteja; admission- ja käyttöjärjestelmärajat
ovat edelleen ohjattuja. Se ei ole fyysisen varauksen kustannusmittaus tai
oikean cold-prosessiketjun hyväksyntä. Johtava metadatatyö väheni, mutta
onnistuvien vertailujen vakaan valinnan ja alkuperäistodisteiden järjestys
säilyi. Portiton/vanhanmuotoinen kutsu, palautuvan metadatan havaintoero,
kilpailevat ensisyyt ja todelliset tiedosto-/muutosrajat todennettiin.

Tarkennetut 26 kontrollia läpäisivät; neljä niiden päällekkäistä tavu- ja
virheidentiteettiväitettä varmennettiin vielä erikseen. Neljän nykyisen
vaikutustiedoston 86 testiä ja ehdokkaan tyypitys läpäisivät. Rajatun
katselmuksen sulku- ja sync-väitteiden puutteet korjattiin; jälkikatselmukseen
ei jäänyt löydöksiä. Koefixturen valmistelu- ja sulkuodotusten hylkäykset
säilyvät erillisinä, eivät sovelluskorjauksina. Lähteet ja aiemmat
käännöstavut eivät muuttuneet, eikä aikarajoja nostettu.

**Koko ketjun raja on edelleen avoin:** sekä lähtöversion että myöhemmän
ehdokasajon koko pienketju aikakatkaisi. Lähtöversion yksi sallittu
erillisdiagnoosi ja ehdokkaan aiempi koko pienketju läpäisivät, mutta ne
eivät sulje hylkäyksiä tai todista vakautta. Viimeisessä ehdokashylkäyksessä
retirement valmistui ja journal oli poistettu; loppuvalidoinnin onnistumista
ei silti saatu. Raportin ennen sulkuhookia ottamaa tilaa ei tulkita
lopulliseksi vaihekohtaiseksi sulkukuitiksi. Hiljaista uusintasarjaa ei
jatkettu. Tuotantokytkentä, mahdollinen uusi pitkän cold-ketjun todennus
sekä koko W7.5:n hyväksyntä tarvitsevat edelleen omat päätökset ja portit.

<a id="w75-history-terminal-production"></a>

## 9.11.2026, terminal-kytkennän osanäyttö

**Tuotantokytkennän rajattu näyttö:** hyväksytty kahden omistajan kytkentä
vastaa tarkasti katselmoitua ehdokasta. Pysyvien regressioiden viiden
tiedoston 123 testiä, tyypitys ja E2E-testiruntimen käännös läpäisivät.
Riippumaton katselmus tarkensi alkuperäisjuurten ja main-valinnan yhteistä
järjestysväittämää journalin lukurajan yli. Sen kolme täsmennettyä kontrollia
läpäisivät; aluksi väärä slottijärjestys korjattiin nykyisen omistajan
`current -> backup -> next` -järjestykseen. Sovelluskoodia ei muutettu
testiväitteen vuoksi. Jälkikatselmukseen ei jäänyt löydöksiä.

<a id="w75-history-terminal-resumed"></a>

## 10.11.2026, eristetyn desktop-komennon osanäyttö

Sittemmin [uusi eristetty normaali desktop-komento](release-0.3.0-integration-history.md#w75-desktop-resumed-20261110)
läpäisi kaikki kolme vaihettaan: tavallisen Vitest-sarjan, koko 23 kohteen
ketjun nykyisessä 180 sekunnin rajassa ja Node-jatkotestit. Erillinen
jälkivertailu varmisti lähteen, käännöksen ja aiemman aineiston säilymisen.
Vanhojen hylkäysten syitä ei suljeta. Native-/UI-/paketti- ja PR/main-portit
vaaditaan edelleen ennen kokonaisuuden hyväksyntää.

<a id="w75-history-a-error-result"></a>

## W7.5 A:n virhetulos- ja vastaanottorajan osanäyttö

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

<a id="w75-history-a-support-result"></a>

## W7.5 A:n tukivientipyynnön eliniän osanäyttö

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

<a id="w75-history-b-content-result"></a>

## W7.5 B:n sisältö- ja tiedostorajan osanäyttö

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

<a id="w75-history-ab-owner-result"></a>

## W7.5 A/B:n yhteisen vientiomistajan osanäyttö

Kuuden kokonaisen tukivientitiedoston 211 testiä ja tyypitys läpäisivät.
Kokeet kattavat peruutuksen, käytetyn native-luvan, dispose-/sukupolvi-
muutoksen dialogeissa, reentrantin tietolähteen ja oikeat tiedostotavut.
Katselmuksen virheellisen async-tietolähteen Promise-hylkäysaukko korjattiin;
neljä lisäkontrollia eivät odota tai hyväksy sen dataa, ja jälkikatselmukseen
ei jäänyt löydöstä. Nykyisen OpenPGP-kokeen neljä testiä läpäisivät myös
native-entryn alkuperäisen synteettisen virheen purun. Sama raporttien
tosiasiallinen tavusisältö ja testisidonta säilyivät, julkinen tuloste ei
sisältänyt raakasyytä. Tämä ei ole uuden aineistolajin keräyslupa.

Kumpaakaan uutta v3-entryä ei vielä ole liitetty mainin käynnistykseen tai
valitsimeen. Nykyisen todellisen hallintasukupolven, observerin ja ennen
pääikkunaa päättyvän startupin kertakäyttöisen valtuuden liitos on edelleen
avoin. Tätä ei korvata injektoidun vartijan onnistumisella. Nykyisen
main-tiedoston kaikki 398 regressiota läpäisivät ilman ohituksia yhteisen
vientityön muutoksen jälkeen. Sen Electron-/backend-rajat ovat edelleen
kontrolloituja; tämä ei ole uusien v3-entryjen native-todiste.
