# 0.3.0 M1 -valmistelu

## Jatka tästä

**PR #283 ja sen main-integraatio on hyväksytty 2.10.2026.**
[Lopullinen checkpoint](https://github.com/eky-software/eky/pull/283#issuecomment-5959719891)
sulkee ennen A1:tä hyväksytyn [pnpm-tietoturvahuollon](#pnpm-bootstrapin-tietoturvahuolto)
ja Windowsin sekä Linuxin rajatun salatun ensivirhetoimituksen. PR #282:n
V1/V2-vakautuksen hyväksyntä säilyy. Myöhempi onnistuminen ei sulje vanhojen
timeout- tai siivoushavaintojen jälkikäteistä juurisyytä.
Alla päivätyt tutkimusvaiheet ovat historiaa, eivät rinnakkaisia työjonoja.

**T1/T2/T3, A1/R01, A2/R05, A3/R06 ja Oma yritys -tallennuskorjaukset
integraatiojatkoineen ovat hyväksyttyjä. B1/B2 ja niiden hyväksytyt sulku-/
keräysjatkot on hyväksytty PR #297:n mainissa. Nykyinen työ on
[B3-B5:n integraatio ja rajatut PR-korjaukset](#b3-b5n-ensimmäisen-pr-kierroksen-rajatut-korjaukset).** PR #294:n oma main-kierros
läpäisi; A2:n aiemman main-kierroksen tapauskohtainen etenemispäätös ja
alkuperäinen flaky-havainto säilyvät historiassa eivätkä muutu korjatuiksi.
Modulaarinen monoliitti ja
hyväksytty M1-rajaus säilyvät. Tämä sivu omistaa M1:n nykyisen jatkamiskohdan;
[julkaisusuunnitelma](release-0.3.0-plan.md) omistaa koko 0.3.0:n sisällön.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Hyväksytty lähtörevisio | PR #297:n main `8a08a6ea4a6d58eaed26b9b0de563bbe7271abc2`. [Loppuhyväksyntä](https://github.com/eky-software/eky/pull/297#issuecomment-5992208049) sitoo lähteen, katselmoidun puun sekä PR:n ja mainin näytön. PR #295:n B1/B2, PR #296:n sulkukorjaus ja aiemmat hyväksynnät säilyvät; alkuperäisten timeoutien syytä ei tämän perusteella nimetä korjatuksi. |
| Mainin omat portit | [CI 37288697199](https://github.com/eky-software/eky/actions/runs/37288697199) ja [ajastettu CI 37288771261](https://github.com/eky-software/eky/actions/runs/37288771261) läpäisivät samalla main-revisiolla ensimmäisellä yrityksellä: kaikki 11 porttia ja kaksi asennuskoetoistoa. System 815, web 65 ja Electron 39 läpäisivät ilman uusintoja tai flaky-tuloksia. Viittä valinnaista diagnostiikkaohitusta ei lasketa läpäisyiksi. PR:n erillinen riippuvuustarkistus ja [mainin ajastettu tarkistus 37290350442](https://github.com/eky-software/eky/actions/runs/37290350442) läpäisivät; main-push ei valinnut erillistä audit-workflowta nykyisellä polkusuodattimella. |
| Suljettu työ | T1/R27:n ajokytkentä, T2/R29:n puhtaan valmistelun suoja ja T3/R28:n todellisten kuluttajien koko prosessipuun omistajuus. Korvatut aktiiviset fallbackit on poistettu ja [pysyvä T3-matriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus) hyväksytty. PR #281 sulki tämän jälkeisen rollback-testiapurin integraatiojatkon. |
| Avoimet havainnot | Aiemmat satunnaiset Electron-käynnistys- ja packaged/legacy-timeoutit säilyvät epäonnistuneina havaintoina omille revisioilleen. Myöhempi vihreä ajo ei todista niiden kaikkia syitä korjatuiksi. [Hylkäysten historia](e2e-test-environment-history.md#dokumentti-mainin-hylkäys-ja-rajattu-diagnostiikkajatko) ja [rajattu apurikorjaus](e2e-test-environment-history.md#rollback-testiapurin-ennenaikaisen-poistumisen-korjaus) erotetaan toisistaan. |
| Nykyinen työ | B3:n revisio-/PDF-pohja, B4:n toimitus/historia ja hyväksytty legacy-selvitysesto ovat työpuussa kohdetodennettuja. [Historian client/UI/native-polku](#b4-historian-käyttöpolun-checkpoint) toimii hyväksytyllä laskulla ja reopened-editorissa. [Legacy-uudelleenlähetys ja peruutus](#b4-legacy-uudelleenlähetyksen-checkpoint) on todennettu oikean startup-migraation ja restartin yli. [B5-katalogin sekä moniversioisen ja legacy-aineiston paketoitu palautus](#b5-katalogin-ja-palautuksen-checkpoint) on todennettu kehityspaketilla. Legacy-testin CI-ajokytkentä on kohdetodennettu. [Katselmuksen jatkokorjaukset](#b5-katselmuksen-jatkokorjaukset), mukaan lukien hyväksytyn legacy-laskun ensimmäisen toimituksen revisiosiirtymä ja sen oikeusrajat, ovat kohdetodennettuja. Omistaja hyväksyi etenemisen loppukatselmukseen, puhtaan revision paketointiin ja yhteen normaaliin PR/CI-kierrokseen erillisen workspace-adoption timeoutin jäädessä avoimeksi; nykyiset palautus-, eheys-, siivous- ja main-portit säilyvät. B3/B4/B5 eivät ole kokonaisuutena hyväksyttyjä; osittaista migraatio–caller-ketjua ei julkaista. Hyväksyttyjä B1/B2- ja sulku-/keräystöitä ei uusita. |
| Ei vielä valmis | B:n toteutus ja hyväksyntä, W7, M1:n muu sovellustyö, D-paketin muut ehdot ja koko 0.3.0. Lähtörevision läpäisy ei hyväksy uuden revision puuttuvia portteja. |

Hyväksyntä on sidottu yllä olevaan revisioon, ei automaattisesti myöhempään
työpuuhun. Dokumenttimuutoksen toteutuneet tarkistukset ja mahdollisen
integraation lopputulos kirjataan sen omaan hyväksyntächeckpointiin;
pelkän tuloksen ilmoittamiseksi ei tehdä uutta tilakirjauscommittia.
Jokainen uusi toteutuspala alkaa omalla preflightilla. Sivulla ei ylläpidetä Goal-työkalun
ajonaikaista tilaa.

### B3-B5:n ensimmäisen PR-kierroksen rajatut korjaukset

[PR #298](https://github.com/eky-software/eky/pull/298):n lähde
`1c6abf69bd6f64165290c82a1a877c68c1238166` säilyy alkuperäisen kierroksen
lähtönä. [V2-ajo 37510139120](https://github.com/eky-software/eky/actions/runs/37510139120)
hylättiin; erillinen [riippuvuustarkistus 37510138692](https://github.com/eky-software/eky/actions/runs/37510138692)
läpäisi. Riippuvuuksien vihreys ei hyväksy toimintatestejä. Ensimmäisten
hylkäysten aineisto säilytetään, eikä myöhempi kohdetodennus muuta niiden
alkuperäistä tulosta.

Rajatut testisovitukset koskevat hyväksytyn packaged-legacy-konfiguraation
manifestiodotusta, nykyisen migraatiomäärän odotusta, eristetyn vieraan
yrityskontekstin muodostamista muuttumattoman laskun jälkikirjoituksen
sijasta sekä toimitushistorian UI-lukijaa ja rivitöntä tapahtumataulua.
Legacy-fixturen juurivertailu käyttää samaa native-kanonisointia kuin
testijuuren omistaja: Windowsin lyhyt alias ei saa hylätä samaa fyysistä
juurta. Linkkien, sisaruuden ja omistetun testijuuren suojat säilyvät.
Näiden kohdetestit läpäisivät; ne eivät vielä hyväksy uutta PR-revisiota.

Tuotantokorjaus erottaa aktiivisen profiilin **eheyden validoinnin**
normaalin backendin **nykyskeeman käynnistysportista**. Ennen migraatioita
rekisteröity validaattori voi tarkistaa eheän, metadataa sisältävän vanhan
prefixin sen oman katalogisopimuksen mukaan, vaikka forward-migraatio olisi
vielä tekemättä. Business-rollback vertaa tämän lisäksi odotettua vanhaa
chain-identiteettiä ennen binary rollbackia. Normaali backend ei kuitenkaan
avaa business-runtimea ennen onnistuneita migraatioita ja erillistä
nolla-pending-tarkistusta. Historian, identiteetin, katalogin, PDF-tavujen,
koon ja tiivisteen tarkistuksia ei löysennetä.

Todellisen backend-kokoamisen regressio hylättiin ensin väärään
pending-ehtoon ja läpäisi korjauksen jälkeen. Rajattu historian/profiilin
testijoukko sekä olemassa olevat first-start-/business-rollback-testit
läpäisivät; riippumaton staattinen katselmus ei löytänyt P1/P2-puutteita.
Uuden paketin palautustodennus ja uuden jäädytetyn revision PR/main-portit
ovat edelleen erillisiä hyväksyntäehtoja.

Hosted workspace-fault -ajon ensimmäinen hylkäys oli business-rollbackissa,
kun taas historical-legacy -ajo hylättiin jo ensimmäisessä kohdekäynnistyksessä.
Legacy-ajon myöhempi supervisor-deadline ja siivoustulos eivät ole sama
havainto kuin alkuperäinen käynnistysvirhe. Säilynyt aineisto ei vahvista
sen sovellustason juurisyytä. [Nykyisten suljettujen käynnistyskoodien
säilyttäminen](windows-installer-acceptance-harness-v2.md#legacy-käynnistyksen-hylkäyssyy)
tarkentaa raportointia, mutta ei yksin sulje tätä hylkäystä. Seuraavaksi
vaaditaan katselmoidun korjausrevision paketti- ja normaali PR-todennus;
aikarajat, eheysvaatimukset, prosessiomistajuus ja uusintarajat säilyvät.

Korjausrevision `cb44ec8bfbe8c018ab4a0dd0156e61ef34c1530c`
[V2-kierros 37519343905](https://github.com/eky-software/eky/actions/runs/37519343905)
päättyi hylkäykseen: 32 jobia läpäisi, kaksi varsinaista jobia ja
hyväksyntäkoonti hylättiin, yksi keskeytyi ja kuusi riippuvaista jobia
ohitettiin. Paketoidun workspace-fault-palautuksen molemmat toistot
läpäisivät, myös business-rollback sekä keskeytetyn palautuksen restart.
Erillinen [riippuvuustarkistus 37519343381](https://github.com/eky-software/eky/actions/runs/37519343381)
läpäisi. Koko kierros ei silti ole hyväksytty.

Electronin kolme determinististä hylkäystä toistuivat myös kohdeajossa:
first-start- ja activation-fixture kylvivät vanhan dokumenttirakenteen jo
nykyskeemaan, ja runtime-testi odotti vanhaa migraatiomäärää. Nykyinen
fixture muodostetaan nyt historiallisen syötteen kautta ja migroidaan
staged backendin omalla runnerilla vain testivalmistelussa. Business/PDF-
snapshot säilyy, ja olemassa oleva kandidaattilukija validoi historian,
katalogin ja nolla-pending-tilan ennen varsinaista koetta. Varsinaisten
first-start-/activation-kokeiden historialliset syötteet pysyvät pending-
tilassa siihen asti, kun testattava tuotantopolku migroi ne. Runtime-odotus
vastaa 39 migraatiota. Kolme kohdetapausta ja 16 alemman tason regressiota
läpäisivät ilman uusintaa; tyypitys ja riippumaton rajattu katselmus
läpäisivät. Tuotantokoodia tai hyväksyntäehtoja ei muutettu tässä palassa.

Historical-legacy-paketin valmistelu katkesi registry-allekirjoitusten
tarkistuksen yhteysvirheeseen ennen paketin rakentamista. Tätä ei tulkita
sovelluksen käynnistysvirheeksi tai hyväksytyksi legacy-todisteeksi.
Web-jobi keskeytyi nykyisellä 15 minuutin jobirajalla ilman lopullista
testiraporttia; yksittäiset valmistuneet tapaukset eivät hyväksy sarjaa.
Salattu keskeytyspaketti varmistettiin, mutta siinä ei ollut säilynyt
testikohtaista virhetietoa. Puute kirjataan, eikä siitä arvata jäätymisen
juurisyytä tai onnistunutta siivousta. Seuraava vaihe on katselmoidun
testisovitusrevision normaali PR-todennus samoilla valmistelu-, palautus-,
eheys-, aikaraja- ja main-porteilla; tämä ei ole uusinta vihreyteen asti.

Revision `394e09730426e7556f8b29ed380838bc4f90a10b`
[V2-kierroksella 37524315673](https://github.com/eky-software/eky/actions/runs/37524315673)
webin kriittinen sarja läpäisi ja aiemmat kolme Electron-fixturehylkäystä
läpäisivät. Electron-sarja kuitenkin hylättiin legacy-uudelleenlähetyksen
peruutustapauksen flaky-tulokseen. Ensimmäisessä yrityksessä PDF:n avausvirhe
oli näkyvissä lähetyksen peruutusilmoituksen rinnalla; automaattinen uusinta
ei muuta alkuperäistä yritystä onnistuneeksi.

Rajattu lähdekatselmus löysi testin ennenaikaisen sulkemismahdollisuuden:
esikatselun URL voi näkyä ennen native-avauspromisen valmistumista. Testi
odottaa nyt nykyisen avauspainikkeen valmistumistilaa ja vaatii virheettömän
näkymän sekä ennen sulkemista että sen jälkeen. PDF-virhettä ei suodateta
pois peruutusilmoituksen valitsimella. Native-latauksen ja kutsuketjun
valmistumisrajan hallitut sopimustestit sekä molemmat varsinaiset
legacy-uudelleenlähetyksen Electron-polut läpäisivät ilman uusintaa;
tyypitys ja riippumaton rajattu katselmus läpäisivät. Tuotantokoodia,
aikarajoja, toimitussisältöä tai hyväksyntäehtoja ei muuteta tässä palassa.
Tämä korjaa osoitetun testijärjestyksen puutteen, mutta ei yksin todista
alkuperäisen CI-hylkäyksen syy-yhteyttä tai uuden revision vakautta.
Uuden jäädytetyn revision PR/main-portit ovat edelleen erillisiä ehtoja.

**Kierroksen lopputila tarkistettu 7.10.2026:** V2-ajo päättyi
hylkäykseen: 34 jobia läpäisi, neljä hylättiin ja viisi valinnaista jobia
ohitettiin. Hylkäykset koskevat Electron-sarjaa, molempia historical-legacy-
toistoja ja niiden hyväksyntäkoontia. Tavallisten päivitys-, workspace-success-
ja workspace-fault-kokeiden molemmat toistot läpäisivät. Erillinen
[riippuvuustarkistus 37524315139](https://github.com/eky-software/eky/actions/runs/37524315139)
läpäisi; se ei hyväksy epäonnistuneita toimintaportteja.

Molempien legacy-toistojen salatut paketit purettiin ja niiden ajosidonnat
sekä säilyneiden tiedostojen tiivisteet varmennettiin. Niissä säilyvät
supervisorin lopputulos ja erillinen varmennettu siivous, mutta ei
alkuperäisen bootstrap-hylkäyksen sovellustason syytä. Tuon revision havaitsija
projektoi lokista vain elinkaaren identiteetin, ja testiprofiili poistuu
varmennetun siivouksen jälkeen ennen jälkikeräystä. Keräin ei lue profiilin
operational-lokeja. Lähdehaun `complete` ei tässä tarkoita täydellistä
syytietoa. Myöhempi deadline ei korvaa aiempaa bootstrap-hylkäystä.
Omistaja hyväksyi 7.10.2026 rajatun tämän käynnistyksen syy-/vaiheotteen
säilytyksen, regressiot ja yhden nimetyn Windows-todennuksen. Toteutus
käyttää nykyisen `fixtureCleanup`-vaiheen yhtä terminal-kirjoitusta ja
[salatun keräimen täsmällistä projektiota](ci-encrypted-evidence.md#legacy-käynnistyksen-rajattu-syyote).
Käynnistyssyy ei ole yleisen supervisor-deadlinen korvaaja. Puuttuva tai
varmentamaton syytieto estää alkuperäisen fixturen poiston.
Havaitsijan, oikean siivousvaiheen, sidontojen ja salatun keräysketjun
rajatut 112 regressiota ja 70 työnkulku-/toimitussopimustarkistusta
läpäisivät; ensimmäinen regressio toisti syykentän katoamisen ennen
korjausta. Riippumaton katselmus tarkisti myös synteettisen fixturen
revisio- ja lokisidonnan.

**Nimetty toimitustodennus 7.10.2026:**
[kertakoe 37601619299](https://github.com/eky-software/eky/actions/runs/37601619299)
käytti samaa olemassa olevaa muuttumatonta legacy-artifactia ja
keräyskorjauksen revisiota `ffbfb1a2`. Kohdeversion ensimmäinen käynnistys
hylättiin noin 1,1 sekunnissa. Salattu toimitus, paikallinen purku,
ajosidonnat ja kaikkien 42 säilyneen tiedoston tiivisteet varmennettiin.
Syyote sisälsi tämän käynnistyksen `DESKTOP_START_FAILED`-koodin ja
`startup`-vaiheen. Paketin jälkivarmennus sekä prosessien ja asennusten
siivoustodisteet läpäisivät; varsinaisen skenaarion myöhempi deadline
säilyi erillisenä hylkäyksenä.

Näin rajatun syyotteen toimitusketju on todennettu myös oikean
epäonnistuneen legacy-käynnistyksen jälkeen. Tämä ei sulje sovellusvikaa:
`DESKTOP_START_FAILED` on sovelluksen sallittu yleinen fallback, ei tarkka
juurisyy. Seuraava päätettävä tutkimus kohdistuu alkuperäisen poikkeuksen
syntypaikkaan ja turvalliseen luokitteluun, ei yleisen keräimen uusimiseen.
Yhtä läpäisemätöntä paikallista admission-sopimuskoetta ei merkitä
onnistuneeksi; puhtaan Windows-ympäristön normaali hyväksyntä vaaditaan
edelleen. Toista kertakoetta tai normaalia PR-kierrosta ei käynnistetä
tämän toimitusnäytön perusteella automaattisesti.
Mahdollinen sovelluskorjaus päätetään tarkemman näytön perusteella; uutta yleistä
loggeria, profiilin kopiointia tai aikarajojen muutosta ei oteta käyttöön.
B3-B5:n integraatio ja merge pysyvät avoimina.

**Alkuperäisen poikkeuksen rajattu jatko:** omistaja hyväksyi 7.10.2026 vain
synteettisen testikäynnistyksen ensimmäisen alkuperäisen viestin, pinon ja
syyketjun säilyttämisen ennen turvallista luokittelua. Rajaus ja poistumisrajan
avoin toimitusehto ovat [salatun aineiston omistavassa sopimuksessa](ci-encrypted-evidence.md#hyväksytty-alkuperäisen-poikkeuksen-rajaus).
Tämä ei ole uusi loggeri, testialusta tai lupa muuttaa normaaleja aikarajoja.
Omistaja hyväksyi tämän jälkeen vain eristetylle testikäynnistyksen virhepolulle
enintään 500 ms:n asynkronisen valmistumisodotuksen ennen hallittua poistumista.
Normaali ja onnistunut käynnistys eivät odota. Oikea Electron-poistumisraja,
prosessiomistajuus ja salattu toimitus todennetaan erillään sovelluksen
legacy-virheen selvityksestä.
Pakotettu prosessiraja ja oikea salaus/purku tarkistetaan ennen yhtä nimettyä
Windows-todennusta. Vanha artifact ei sisällä uutta runtime-kytkentää;
sen uudelleenajo ei todistaisi uuden poikkeuksen keräystä. Varsinainen
legacy-sovellusvika, jäädytetyn paketin todennus ja normaali hyväksyntä
säilyvät erillisinä avoimina kohtina.

**Rajattu keräystodennus valmistui:** [yksi nimetty no-MSI Windows-koe](https://github.com/eky-software/eky/actions/runs/37616471588)
läpäisi revisiolla `6c096474`. Oikea Electron-poistuminen, prosessipuun
poissaolo, salattu julkaisu ja yksityinen sisällön purkuvarmennus on
todennettu [omistavan sopimuksen mukaisesti](ci-encrypted-evidence.md#hyväksytty-alkuperäisen-poikkeuksen-rajaus).
Tämä ei merkitse alkuperäistä legacy-vikaa korjatuksi eikä sulje B3-B5:n
paketoituja hyväksyntäportteja. Seuraava sovellusvian todennus tarvitsee
uuden runtime-kytkennän sisältävän jäädytetyn paketin; vanhan artifactin
uusinta ei korvaa sitä. T3:n omistajuutta tai testialustaa ei avata uudelleen.

**Uuden paketin valmistelussa löytynyt testifixturen virhe:** [rajattu legacy-kierros](https://github.com/eky-software/eky/actions/runs/37623117906)
hylkäsi kaksi syyotteen siivousregressiota molemmissa core-toistoissa ennen
paketin valmistusta. Fixturen temp-juuren on käytettävä samaa kanonista
polkua kuin varsinaisen legacy-ajajan nykyinen admission-portti, myös
Windowsin 8.3-aliaksen kautta valmisteltuna. Korjaus rajataan testifixtureen
ja aidon aliaksen regressioon; nykyiset todiste-, linkki-, sisältö- ja
siivousvaatimukset säilyvät. Ensihylkäys ja sen aineisto säilytetään.
Seuraava nimetty todennus on korjatun jäädytetyn revision nykyinen
legacy-paketointikierros. Tämä valmisteluvirhe ei selitä vanhaa sovelluksen
käynnistysvirhettä, jota kierros ei vielä suorittanut.

**Fixture-korjaus läpäisi valmistelusopimukset:** [korjatun revision kierros](https://github.com/eky-software/eky/actions/runs/37625704938)
läpäisi kaikki 12 valmistelujobia, mukaan lukien molempien core-toistojen
605 testiä. Paketin esitesti löysi erillisen workflow-testin rajausvirheen:
`packaged-boundary-diagnostic`-jobin tarkistus ulottui seuraavaan,
tarkoituksella epäonnistuvaan synteettiseen poikkeuskokeeseen. Rajaus
korjataan omistavaan jobiin nykyisellä testien lukutavalla. Jobin ja
pakollisten askelten virheiden ohitus hylätään edelleen erillisillä
kielteisen muutoksen regressioilla; workflow ja sen loppuportti eivät muutu.
Tämäkin hylkäys tapahtui ennen paketin valmistusta ja varsinaista
sovelluskäynnistystä. Korjattu revisio tarvitsee oman nimetyn todennuksensa.

**Uusi paketti ja aidon käynnistysvirheen keräys todennettiin:** [nimetty kierros](https://github.com/eky-software/eky/actions/runs/37628169512)
revisiolla `5f2ad09a` läpäisi kaikki 12 valmistelujobia, paketin 65 esitestiä,
rakentamisen ja alkuvarmennuksen. Molemmat saman paketin legacy-kuluttajat
hylättiin uuden sovelluksen ensimmäisessä käynnistyksessä. Salattu toimitus,
yksityinen purku sekä poikkeuksen revisio-, suoritus- ja tiedostoeheys on
tarkistettu kummassakin. Talteen saatiin `runtimeStartup`-vaiheen viesti ja
pino, jotka rajaavat virheen backendin migraatiokäynnistysporttiin, mutta
eivät vielä todista sen alemman hylkäyksen syytä. Myöhempi aikakatkaisu on
erillinen havainto; prosessien ja tuotteiden siivous sekä paketin
jälkivarmennus läpäisivät.

**Rajattu keräyskorjaus revisiossa `502864d6`:** `beforeMigrations`-callbackin ja
`FirstStartUpdateCoordinator`-omistajan hylkäykset tarjotaan nyt nykyiselle
opt-in-havaitsijalle ennen yleistä virhekoodia ja palautussiivousta.
Composition välittää molemmille saman valinnaisen havaitsijan sekä nykyisen
session redaktion. Alkuperäistä poikkeusta ei lisätä julkisen virheen
`cause`-kenttään. Havaitsijan virhe ei estä aborttia tai recovery-journalin
siirtymää; havainto säilyy myös koordinaattorin jo pysäyttämän käynnistyksen
jälkeisessä hylkäyksessä. Ei uutta loggeria, kirjoitinta, odotusta tai
hyväksyntäehtoa.

Kohderegressiot kattavat syyn identiteetin, järjestyksen, opt-in-kytkennän,
session redaktion, ensimmäisen otteen säilymisen myöhempien wrapperien yli
ja onnistuvan polun. Tämä on keräysketjun korjaus, ei todistettu SQL- tai
palautuspistevika. Tarkistettava seuraava näyttö on korjatun, jäädytetyn
revision paketoitu käynnistys ja mahdollisen hylkäyksen salattu syyote.
Aiempaa koetulosta ei muuteta läpäisyksi, eikä tämän keräyskorjauksen
perusteella tehdä mergeä. B3-B5:n legacy-käynnistysportti pysyy avoimena.

[Nimetty Windows-todennus](https://github.com/eky-software/eky/actions/runs/37641940845)
päättyi GitHubin sisäiseen palvelinvirheeseen ennen pakettijobin luomista.
Kaikki 12 valmisteluryhmää läpäisivät, mutta asennuspakettia tai sovelluksen
käynnistyskoetta ei syntynyt. Myös rajatun uusinnan palvelupyynnöt hylättiin
ilman uutta suoritusta. Tämä ei todista keräyskorjauksen toimintaa aidossa
paketissa eikä muuta aiempaa sovelluksen käynnistyshylkäystä. Seuraava
todennus jatkuu samasta jäädytetystä revisiosta palveluesteen poistuttua;
hyväksyntäehtoja tai aikarajoja ei muuteta tämän vuoksi.

### B3-B5:n aikana havaittu riippuvuuspäivitys

Mainin samaan lähtörevisioon kohdistunut [ajastettu auditointi 6.10.2026](https://github.com/eky-software/eky/actions/runs/37441556812/job/112196274405)
hylättiin `source-map-js@1.2.1`-löydökseen
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
Se kulkee Viten/PostCSS:n kehitysriippuvuuden kautta myös Vitestiin.
Aiempi PR #297:n hyväksyntä säilyy historiallisena näyttönä, mutta ei korvaa
tämän uuden tietoturvahylkäyksen käsittelyä.

Omistaja hyväksyi rajatun täsmäpäivityksen `source-map-js@1.2.2`:een ja
auditointi-, tyypitys-, kohdetesti- sekä web-build-tarkistukset. Päivitys ei
muuta Electronia, SQLitea, sovelluksen tietomallia tai hyväksyntäehtoja.
Uusia riippuvuuksia tai varoajan poikkeusta ei tarvita. Tämä portti käsitellään
ennen seuraavaa B3-B5-toteutuspalaa. Paikallinen auditoinnin läpäisy,
toimintatestit ja myöhempi PR/main-hyväksyntä erotetaan toisistaan;
vanhan main-revision epäonnistunutta auditointia ei muuteta jälkikäteen
läpäistyksi.

**Rajattu työpuutodennus 6.10.2026:** täsmäoverride ja lukitustiedoston
PostCSS-kytkentä käyttävät versiota `1.2.2`; muut pakettiversiot ja
hyväksyntäasetukset säilyvät. Lukittu asennus, sekä tuotanto- että koko
riippuvuusketjun auditointi ja kaikkien 160 paketin rekisteriallekirjoitusten
tarkistus läpäisivät. Web-build, webin 867 testiä 148 tiedostossa ja
laskutuksen/compositionien 1 605 testiä 131 tiedostossa läpäisivät.
Rajattu riippumaton katselmus ei löytänyt korjattavaa päivitysdiffistä.

Ensimmäinen koko työpuun tyypitys löysi kaksi B3:n vanhaan PDF-varastoporttiin
jäänyttä E2E-kuluttajaa. Ne sovitettiin nykyiseen ehdokaskirjoitukseen ja
todennetun sisällön lukuun muuttamatta virheinjektiota, aikarajoja tai
testialustaa. Koko työpuun tyypitys sekä viisi todellisen eristetyn
backend-compositionin testiä läpäisivät sovituksen jälkeen. Olemassa oleva
`INV-PDF-FAIL-001` läpäisi myös selaimessa: PDF-levyvirhe jättää hyväksynnän
voimaan ilman osittaista metadataa, näyttää turvallisen palautteen ja
kulkee diagnostiikan sekä tukipaketin lukuketjun läpi. Rajatut E2E-ajot
läpäisivät ilman uusintoja ja nykyinen prosessisiivous varmistui. Ensimmäinen
hylkäys säilytetään erillään tästä korjaustodisteesta. Tämä ei ole vielä
B3-B5:n kokonaisuuden tai uuden PR/main-revision hyväksyntä.

**Omistajan hyväksymä järjestys 4.10.2026:** alla olevat kolme kohtaa on
hyväksytty PR #293:n ja PR #294:n main-revisioissa. Nykyinen työ on B0:n pohjalta B3-B5,
ei näiden vaiheiden uusiminen.

1. Rajattu palautustestin juurten omistajuus- ja siivouskorjaus sekä sen
   regressiot. Tuotannon palautuspolkua, aikarajoja tai sisältövaatimuksia
   ei muuteta.
2. Jo toteutettujen Oma yritys -korjausten hyväksyntä ja normaali PR/main-
   integraatio katselmuksineen ja täsmärevision nykyisine portteineen.
3. Sen jälkeen [A3/R06:n hyväksyntävalmiuden vastaussidonta](invoicing-ui-roadmap.md#a3-hyväksyntävalmiuden-vastaussidonta)
   omalla aloitusportillaan, toteutuksellaan ja hyväksynnällään.

Tämä järjestys ei avaa T3:a tai muuta vanhojen hylkäysten uusintarajoja.
Tuotannon staging-siivoamisen erillinen sopimushavainto käsitellään sen
omistavassa palautustyössä, ei tämän testikorjauksen sivuvaikutuksena.

## B1/B2-mainin Electron-sulkuhavainto

PR #295:n lähde `71240316d95ee22c4ee7269cc67c732e6cd9588f` läpäisi
omat porttinsa ja yhdistettiin mainiin
`b5dada6f6ca24c21ffc2cc817fa763070078fd1f`. [Loppuyhteenveto](https://github.com/eky-software/eky/pull/295#issuecomment-5983583757)
erottaa PR-hyväksynnän avoimesta main-hyväksynnästä.
[Main-ajo 37226396756](https://github.com/eky-software/eky/actions/runs/37226396756)
hylkäsi `DESK-WORKSPACE-REPLACE-CANCEL-003`:n ensimmäisen yrityksen
loppusiivouksen. Automaattinen uusinta läpäisi, mutta flaky-portti ja
kokonaishyväksyntä eivät läpäisseet. Alkuperäinen hylkäys säilyy.

Omistajan hyväksymä rajattu katselmus kattaa sovelluksen sulkemisketjun ja
testin sulkuvarmistuksen; koko Electronia tai T3:a ei rakenneta uudelleen.
Varmistettu raportointipuute: nykyisen sulkuapurin tarkempi julkisen sulun
virheluokka katosi fixturen yleiseen cleanup-hylkäykseen. Korjaus säilyttää
sen nykyisessä lifecycle-liitteessä erillään omistajan siivoustodisteesta.
Raportointikorjaus ei muuta tuotantokoodia. Aikarajat, retry-asetukset ja
hyväksyntäehdot säilyvät myös alla hyväksytyssä erillisessä sulkukorjauksessa.
Kohderegressiot ja oikean Windows-Electron-polun todennus eivät yksin sulje
alkuperäisen hylkäyksen syytä tai main-porttia. Yksi erikseen hyväksytty
rajattu uusinta ei tarkoita ajoja vihreään asti; tulokset arvioidaan erikseen.

**Erillinen sulkukorjaus hyväksytty 4.10.2026.** Katselmus löysi kaksi
toistettavaa sovelluspuutetta: uusi quit-pyyntö saattoi ohittaa keskeneräisen
sammutuksen, ja backendin pakkopysäytys saattoi kirjoittaa puhtaan
sammutuksen merkin. Näitä ei ole yhdistetty yllä olevan CI-hylkäyksen
juurisyyksi. Rajattu korjaus pitää quit-eston voimassa, palauttaa
rinnakkaisille composition-sulkukutsuille saman lopputuloksen ja välittää
backendin todellisen sulkuluokan markerin omistajalle. Ei uutta
prosessivalvojaa, riippuvuutta, schemaa tai business-sääntöä.

Saman marker-sopimuksen katselmus tarkensi myös virhekoodillisen
poistumisen: hallitun sulun `exit` hyväksytään vain koodilla 0. Pakkopysäytyksen
vahvistettu poistuminen säilyy erillisenä tuloksena. E2E-kääreet välittävät
saman sulkutuloksen eivätkä hävitä sitä `void`-sovitukseen.

[Desktopin sulkusopimus](local-desktop-implementation-plan.md#sovelluksen-sulkemisen-nykyinen-sopimus)
ja [palautuspisteen marker-sopimus](local-backup-and-restore-plan.md#machine-local-recovery-point)
omistavat pysyvän käyttäytymisen. Hyväksyntä vaatii kohderegressiot,
desktop-sarjan, tyypityksen, riippumattoman katselmuksen, hardened Windows
packaged backup -> inspect -> restore -> restart -> compare -todennuksen
ja oikean Electron-polun tarkistuksen. Paikallinen näyttö ei sulje
main-hylkäystä eikä korvaa uuden revision PR/main-portteja.

Kohdetodennus läpäisi: 47 sulku-/marker-regressiota, 90 system-sopimusta,
46 raportointi-/projektiosopimusta, desktopin 1 608 testiä ja 253
skriptitestiä sekä desktopin ja E2E:n tyypitys. Desktop-sarjan kolme
ennestään ohitettua testiä eivät ole läpäisyjä. Lopullisen testipaketin
backup -> inspect -> restore -> restart -> compare läpäisi; kriittisen
Electron-sarjan kaikki 39 tapausta, myös CANCEL-003, läpäisivät ilman
uusintoja tai flaky-tuloksia. Katselmus ei löytänyt korjaukseen uutta
hyväksynnän estävää puutetta. PR #296:n omat portit ja erillinen
riippuvuustarkistus läpäisivät, mutta alla kuvattu main-todennus hylättiin;
alkuperäistä CI-häiriötä ei nimetä korjatuksi paikallisen näytön perusteella.

**Keräysjatko hyväksytty 5.10.2026.** [PR #296](https://github.com/eky-software/eky/pull/296)
yhdistettiin mainiin `5af35c64dac7e5049fbb49e8511fab0761f5285e`.
Sen [oma CI 37238922484](https://github.com/eky-software/eky/actions/runs/37238922484)
hylkäsi `DESK-SECRET-001`:n ensimmäisen yrityksen loppusulun. Testirunko
läpäisi, mutta toisen käynnistyssukupolven julkinen sulku aikakatkaistiin.
Automaattinen uusinta läpäisi; flaky-portti ja hyväksyntäkoonti eivät.
Tämä käytti kyseisen tapauksen yhden uusinnan eikä anna lupaa yleiseen
uudelleenajoon. Muut pakolliset testijobit läpäisivät; viisi valinnaista
diagnostiikkaohitusta eivät ole läpäisyjä.

Uusi raportointi säilytti `publicCloseFailure`-syyn, mutta salatun keräimen
sallintalista ei ottanut mukaan fixturen jo kirjoittamaa
`electron-lifecycle.json`-tiedostoa. Raporttiprojektio poisti inline-liitteen
sisällön tarkoituksellisesti. Siksi toimitettu aineisto ei varmista
prosessinomistajan lopputilaa, eikä yleinen `runtime: unverified` yksilöi
omistajan siivousvirhettä. [Salatun aineiston sopimuksen](ci-encrypted-evidence.md#testiperheiden-virheaineisto)
rajattu täydennys säilyttää tämän yhden tiedostolähteen nykyisten rajojen
puitteissa. Hyväksyntänä ovat keräysregressiot ja yksi nimetty
Windows-Electron-todennus; ei uutta loggeria, sovellusmuutosta tai
aikarajan korotusta. Keräyskorjaus ei palauta vanhasta ajosta puuttuvaa
näyttöä eikä itsessään korjaa sulkuaikakatkaisua tai hyväksy mainia.

Keräyksen 77 kohdesopimusta läpäisi, mukaan lukien ensimmäisen
epäonnistuneen yrityksen ja uusinnan tavujen sekä tiivisteiden säilyminen
oikean OpenPGP-salauksen ja purun yli. Nimetty `DESK-SECRET-001` läpäisi
ilman uusintaa. Se ei kirjoittanut lifecycle-tiedostoa, koska tavallinen
onnistuminen ei kuulu fixturen kirjoitusehtoon. Erillinen keräyskytkennän
todistus käytti aiemman oikean Electron-fixturen säilynyttä tiedostoa ja
varmisti raporttiliitteen vastaavuuden sekä tavujen ja `ownership`-kenttien
säilymisen nykyisen keräimen läpi. Tämä ei ole uusi hosted-toimitus eikä
alkuperäisen sulkuvirheen toisto. PR #297:n integraatio ja sen täsmällisen
main-revision omat portit on sittemmin hyväksytty
[loppuyhteenvedossa](https://github.com/eky-software/eky/pull/297#issuecomment-5992208049).
Alkuperäiset hylkäykset ja puuttuva hosted-ensivirheen näyttö säilyvät;
vihreä integraatio ei ole sulkuaikakatkaisun juurisyytodistus.

**Erillinen avoin päivityshavainto:** staattinen katselmus osoittaa
`desktopComposition`-kytkennän antavan installer handoffille tavallisen,
pakkopysäytyksen sallivan `lifecycleHandle.shutdown()`-polun, vaikka
backend-kahvalla on myös tiukempi `stopForUpdate()`-portti. Tämä edeltää
nykyistä korjausta eikä ole sen regressio tai alkuperäisen CI-virheen
osoitettu syy. Omistaja on desktopin update-composition; jatkotyössä on
todennettava tuotannon handoff-kytkentä ja estettävä installerin käynnistys,
jos päivityksen hallittu sulku ei toteudu. Asennuksen sulkupolitiikkaa ei
muuteta tämän tavallisen sulun korjauspalassa. Havainto jää avoimeksi
0.3.0:n hyväksyntään, ei hiljaiseksi hyväksymispoikkeukseksi.

Integraation valmistelussa myös koko työtilan testit ja tyyppitarkistus
läpäisivät. Riippuvuuksia, aikarajoja tai CI-hyväksyntäehtoja ei muutettu.
Elinkaarimuutoksen erillinen 30 minuutin desktop-soak läpäisi samalla
jäädytetyllä lähteellä [nykyisen endurance-portin](e2e-desktop-endurance-baseline.md).
Se ei korvaa yllä hylättyä main-todennusta.

## A3/R06: hyväksyntävalmiuden vastaussidonta

**Hyväksytty 4.10.2026 PR #294:n mainissa.**
[Omistava UI-sopimus](invoicing-ui-roadmap.md#a3-hyväksyntävalmiuden-vastaussidonta)
rajaa työn laskutuksen readiness-hookkiin, sen featuren tilaan ja lomakkeen
vahvistuksen kytkentään. A1:n editoriavain ja A2:n kirjoitusomistaja säilyvät.

Kooditarkistuksessa readinessin tyhjentäminen ei mitätöinyt keskeneräistä
kyselyä. Jos käyttäjä ehti muokata ja tallentaa uudelleen, vanha ready-vastaus
saattoi avata vahvistuksen uudelle revisiolle. Myös vanha catch/finally saattoi
muuttaa nykyistä virhettä tai odotustilaa. Rajattu korjaus sitoo pyynnön ja
tuloksen kohteeseen, editorisessioon, revisioon ja tallennustilaan.

Hyväksyntään vaaditaan tilaregressiot, oikean UI:n hallitut vastausjärjestykset
ja backendin lopputilan jälkiluku, viereiset A1/A2-/hyväksyntätestit,
workspace-testit, tyypitys ja web-build, riippumaton katselmus sekä uuden
jäädytetyn revision normaalit PR/main-portit. Testimatriisi päivittyy
toteutuneen näytön mukaan, ei ennakolta läpäistyksi.

Kohdetodennus ennen PR-jäädytystä:

- Featuren 14 uutta tilaregressiota ja viereiset web-kohdetestit läpäisivät.
  Backendin nykyiset readiness-, hyväksyntä-, repository- ja HTTP-kohdetestit
  sekä workspace-testit, tyypitys ja web-build läpäisivät. Workspace-sarjan
  kahdeksan ennestään ohitettua testiä eivät ole läpäisyjä.
- Kahdeksan uutta [INV-READY-ketjua](r0-e2e-test-matrix.md#invoicing) ja koko
  web-sarja läpäisivät. Kirjoitukset, hyväksytty sisältö ja numerointi
  tarkistettiin aidon backendin jälkiluvulla; testifixturen siivous varmistui.
- Katselmus tarkensi uuden testiapurin täsmällisen verkkokohteen ja vastauksen
  kulutuksen odotuksen. Korjattu kohdesarja läpäisi ilman uusintoja.
  Kulutuksen havainto ei ole yleinen React-renderöinnin valmistumislupaus;
  tilainvariantit todistetaan erikseen deterministisillä testeillä.

[Lopullinen hyväksyntä](https://github.com/eky-software/eky/pull/294#issuecomment-5980132408)
vahvistaa myös PR:n ja mainin omat portit. A1, A2 ja A3 sulkevat A-paketin
kolme rajattua korjausta, eivät koko M1:tä tai 0.3.0-julkaisua.

Backendin permission, yritysraja, hyväksyntätransaktio ja audit ovat edelleen
auktoriteetti. Ei HTTP-/schema-/riippuvuusmuutosta, uutta tapahtumavirtaa tai
testialustan remonttia. UI:n vanhentunut lukutulos ei kuulu business-auditiin
eikä tukipakettiin; nykyiset oikeiden backend-virheiden turvalliset ketjut
säilytetään. Uuden revision hyväksyntä ei selitä vanhoja timeout-havaintoja.

## B0: laskun sisältö ja toimitus

**Valmistelu 4.10.2026; B-P1 hyväksytty, B-P2:n historiasuunta valittu ja
B-P3:n rajattu legacy-uudelleenlähetys hyväksytty.** Tämä on nykyisen
roadmapin B-paketin tarkennus, ei uusi roadmap tai uusi tietoturvaskannaus.
Lähtörevisio on sivun alun hyväksytty main. Alla olevat testit ovat
vaatimuksia, eivät tämän valmistelun aikana ajettuja tai läpäistyjä testejä.

### Lähdepohja ja nykyiset puutteet

Alkuperäisen katselmuksen R02/R08/R12/R13 sekä keskeytetyn Deep Scanin
S030-03/04/05:n tallennetut havainnot ja korjausehdotukset on luettu uudelleen.
Seitsemän skannerihavaintoinstanssia koskee näitä kolmea S030-ryhmää;
ryhmittely ei muuta alkuperäisiä vakavuuksia tai validoinnin rajoja.
Skannaus on edelleen `canceled`; suljettua loppuraporttia tai hyväksyttyä
korjauspakettia ei ole. Alkuperäisten instanssien vastaavuus ja yksityiskohtainen
näyttö säilytetään yksityisessä lähdeaineistossa, ei tämän sivun kopiona.

Nykyisen lähteen staattinen vertailu tukee korjausjonon säilyttämistä:
katselmuksen lähtörevisiosta hyväksyttyyn mainiin Invoicingin ja SMTP:n
tuotantototeutukset eivät ole muuttuneet. Tämä ei ole uusi runtime-toisto.
Vanhojen tutkimusprobejen odottama virhekäyttäytyminen ei ole korjauksen näyttö.

| Havainto | Nykyinen vastuukohta ja puute | Sulkemisen ehto |
| --- | --- | --- |
| R02 / S030-03 | `sendApprovedInvoiceEmailSmtp.ts`, `sqliteInvoiceApprovalRepository.ts` ja `sqliteInvoiceDeliveryEventRepository.ts`: providerin odotuksen aikana snapshot voidaan avata ja hyväksyä uudelleen samalla lasku-ID:llä. Lopullinen kuittaus ei sido sisältörevisiota; unresolved-eventin dokumenttiviite voi kadota reopenissa. | Atominen varaus ja loppukuittaus täsmälleen samalle laskurevisiolle ja dokumentille; reopen ei tuhoa keskeneräisen tai epävarman ulkoisen toimituksen todistetta, myös restartin jälkeen. |
| S030-04 | `generateApprovedInvoicePdfDocument.ts` ja dokumenttirepository/storage: välimuistin nopea polku ei tarkista snapshot-revisiota, julkaisu on ehdoton ja eri kirjoittajat käyttävät samaa tiedostopolkua. | Ehdollinen julkaisu ja uudelleenkäyttö; myöhäinen renderöinti tai sen siivous ei korvaa tai poista nykyistä PDF:ää. |
| S030-05 | Sama SMTP-käyttötapaus ja correction-repository: kelpoisuus tarkistetaan ennen asynkronista PDF-vaihetta, attempted-tallennus ei ratkaise peruutuskilpaa samassa transaktiossa. | Jos cancel tai reopen voittaa, provider-kutsuja on nolla. Jos varaus voittaa, sisällön tuhoava muutos estyy. Asiakas- ja testilähetys todistetaan erikseen. |
| R08 | `calculateCreditInvoiceDraft.ts`: alkuperäinen ALV-kapasiteetti summataan riveittäin, vaikka standardilaskenta pyöristää ALV-ryhmittäin. | Nykyinen ryhmäpyöristys ja kumulatiivinen hyvitys antavat samat auktoritatiiviset rajat; oikea täysi hyvitys sallitaan ja ylihyvitys estyy. |
| R12 | `smtpSession.ts`: QUITin aikabudjetin laskenta voi heittää lopullisen DATA-250-kuittauksen jälkeen ennen best-effort-catchia. | Jo vahvistettu SMTP-hyväksyntä säilyy, vaikka QUITin valmistelu tai sulku epäonnistuu. DB-commit ja vastaanottajan postilaatikkoon saapuminen eivät ole sama todiste. |
| R13 | `smtpReplyParser.ts`: yhden rivin raja kohdistuu ennen rivien erottelua usean rivin yhteiseen chunkkiin. | Samat vastaustavut tuottavat saman tuloksen pilkkomisesta riippumatta; rivi-, kokonais-, EOF- ja muistirajat säilyvät. |

Nykyinen luotettu actor/company, permission, native-vahvistus, kertakäyttöinen
valmistelutunniste ja vastaanottajasidonta säilyvät. Havainnot eivät osoita
internetistä avointa palvelua tai yritysrajan ohitusta. UI:n painike-esto
tukee käyttökokemusta, mutta ei korvaa backendin päätöstä.

### Rajattu ratkaisusuunta

Suositus on täydentää Invoicingin nykyisiä pieniä portteja ja transaktioita.
Application ohjaa käyttötapausta, domain määrittää sallitut siirtymät ja
SQLite-adapteri omistaa atomisuuden. SMTP-adapteri tietää protokollan, ei
laskun tilaa; PDF-renderer ei omista revision julkaisupäätöstä. Ei uutta
yleistä manageria, globaalia lukkoa, työjonoa, palvelua tai testikehystä.
Nykyiset kirjastot riittävät suunniteltuun työhön.

1. **Yhtenäinen snapshot-identiteetti.** Hyväksynnässä syntyy pysyvä
   sisältörevisio; uudelleenhyväksyntä vaihtaa sen. Laskunumero ja lasku-ID
   säilyvät. Revisio ja snapshot luetaan yhtenä eheänä kokonaisuutena,
   eivät erillisinä lukuina joiden väliin voi tulla muutos. `updatedAt`
   tai PDF-tavujen hash ei yksin ole snapshot-identiteetti.
2. **Omistettu PDF.** Renderöinti saa kyseisen snapshotin ja revision.
   Tavut kirjoitetaan operaatiokohtaiseen, runtime-juuresta johdettuun
   itsenäiseen tiedostoon ilman nykyisen artifactin ylikirjoitusta. Metadata
   julkaistaan vain, jos revisio ja tilan kelpoisuus ovat yhä samat.
   Kahdesta saman revision kirjoittajasta yksi voittaa; häviäjä siivoaa vain
   todistetusti oman julkaisemattoman tiedostonsa. Katalogoitua, toimitukseen
   sidottua tai omistajuudeltaan epävarmaa tiedostoa ei poisteta.
   Myös cache-lukuvirheen metadatan mitätöinti tarkistaa atomisesti odotetun
   document-ID:n, revision ja toimitussidonnan; laskukohtainen ehdoton poisto
   ei ole sallittu fallback. Toimitustodisteen lukuvirhe raportoidaan
   eheys-/selvitystarpeena, eikä todistetta hävitetä regeneroinnin tieltä.
3. **Atominen varaus.** PDF:n lukemisen ja native-vahvistuksen jälkeen
   repository tarkistaa samassa lyhyessä transaktiossa companyn, laskun
   tilan/revision, dokumentin ID:n/hash-arvon/koon ja estävät toimitukset sekä
   tallentaa attempted-varauksen. Tarkistus käyttää vahvistetun valmistelun
   samoja arvoja. Sekä reopen että cancel käyttävät samaa pysyvää päätösrajaa;
   jos ne ehtivät ensin, vanha valmistelu ei oikeuta provider-kutsuun.
4. **Verkko ja kuittaus.** SMTP suoritetaan transaktion ulkopuolella.
   Loppukuittaus tarkistaa varauksen identiteetin ja tilan ja päivittää
   delivery-eventin, mahdollisen `sent`-tilan ja auditin atomisesti.
   Myöhäinen tai toistettu kuittaus ei kohdistu toiseen revisioon eikä luo
   toista toimitusta. Asiakkaalle lähettäminen ja itselle testaaminen
   erotetaan pysyvässä metadatassa; testilähetys ei merkitse laskua lähetetyksi.
5. **Epävarmuus säilyy.** Prosessin kaatuminen tai restart ei vapauta
   unresolved-varausta. Lopullinen SMTP-hyväksyntä ja DB-committivirhe
   erotetaan: lähettämistä ei uusita automaattisesti eikä tulosta nimetä
   varmasti epäonnistuneeksi. Vähintään attempted ja sen alkuperäinen
   revision/document-sidonta säilyvät, jos outcomeUnknown-kirjauskin epäonnistuu.
   Lukkoa ei vapauteta kellon, UI:n tai muistissa olevan tokenin perusteella.

Muuttuvan koodin ensisijaiset omistajat ovat
`apps/backend/src/modules/invoicing/{domain,application,ports,infrastructure}`,
`apps/backend/src/infrastructure/email/smtp` sekä nykyinen
`apps/backend/src/composition/invoicingComposition.ts`.
Tietomallin hyväksytyt lisäykset kuuluvat `apps/backend/src/database`-alueeseen.
API-client, web-feature ja desktopin native-vahvistus muuttuvat vain, jos
täsmällinen sidonta tai turvallinen palaute vaatii niiden sopimuksen muutosta.
Uusi moduuli käyttää jatkossakin tavallisia kapeita portteja, ei B:n sisäistä
prosessi- tai tallennusmekanismia.

### Päätökset ennen B:n toteutusta

Omistajan 4.10.2026 päätökset korvaavat tämän valmistelun aikaisemmat
ehdotukset pysyvästä testilähetyksen jälkeisestä muokkausestosta ja vanhan
SMTP-historian yleisestä uudelleenlähetysestosta. Hyväksytty tavoite,
valittu suunnittelusuunta ja vielä avoin toteutusratkaisu erotetaan alla.

| Päätös | Omistajan päätös | Vaikutus ja jäljellä oleva valmistelu |
| --- | --- | --- |
| B-P1: pysyvä revisiosidonta | **Hyväksytty:** laskun, PDF:n ja toimituksen yhteinen pysyvä revisiosidonta sekä sen rajatut migraatiot ja testit. | Tarkat kentät, constraintit ja migraation järjestys katselmoidaan ennen toteutusta. Laskunumerointi, moduulirajat ja riippuvuudet säilyvät. Ei julkaistun SQL-migraation muokkausta tai koko DB:n uudelleenrakennusta. |
| B-P2: toimituksen jälkeen korjaaminen | **Suunnittelusuunta valittu:** onnistuneen itselle tehdyn SMTP-testilähetyksen jälkeen muokkaamisen pitää säilyä. Suunnitellaan muuttumaton toimitusversioiden historia. Pysyvää muokkausestoa ei valittu. | Säilytetään toimitetun revision snapshot, rivit ja PDF sekä niiden tapahtumaviitteet. Alla oleva tietomalli-, katalogi- ja käyttösopimus on jatkosuunnitelma, ei valmis toteutus. Keskeneräisen tai epävarman toimituksen esto sekä asiakkaalle toimitetun laskun nykyinen `sent`-sääntö säilyvät. |
| B-P3: vanha data | **Hyväksytty selvityksen jälkeen:** jo lähetetyn laskun säilyneen, tarkistetun legacy-PDF:n erikseen vahvistettu uusi lähetys alla kuvatuin rajauksin. | Ei regenerointia tai takautuvaa sisältövarmuuden väitettä. Puuttuva tai ristiriitainen aineisto ja ratkaisematon lähetys estävät tämän polun. Alkuperäiset rivit ja PDF:t säilyvät. Yleistä vanhan SMTP-historian muokkausestoa ei tällä hyväksytä eikä epäselvää vanhaa testimoodia arvata. |

**B-P2:n säilyvät rajat:** dry-run ei ole ulkoinen SMTP-toimitus, eikä sille lisätä
uutta pysyvää muokkausestoa tämän päätöksen perusteella. Nykyisiä cancelin
muita estoja ei samalla lievennetä. Todistetusti ennen ulkoista hyväksyntää
epäonnistunut uusi toimitus ei yksin lukitse laskua pysyvästi; virheluokituksen
pitää osoittaa tämä. Onnistunut asiakaslähetys noudattaa nykyistä `sent`-
sääntöä. Valmistelun hylkäys ja onnistunut esikatselu eivät ole toimituksia.
Epävarman toimituksen manuaalinen selvitys-/vapautuskäyttöliittymä ei sisälly
automaattisesti B:hen: ilman erikseen hyväksyttyä evidenssin säilyttävää
sovituspolkua tila pysyy estettynä ja käyttäjälle kerrotaan tarkistustarve.

### B-P2: toimitusversioiden historia

**Hyväksytty suunnittelusuunta; koko käyttökulun toteutus ja hyväksyntä
ovat vielä kesken.** Lähtörevision `sqliteInvoiceApprovalRepository.ts`
korvasi uudelleenhyväksynnässä saman laskun snapshotin ja rivit;
reopen poisti dokumenttimetadatan ja vanha delivery-event saattoi menettää
viitteensä. Työpuun kohdetodennettu reopen säilyttää historian; sen
käyttöpolun rajaus ja näyttö ovat alla B4-checkpointissa.
Historiaa ei siksi toteuteta pelkkänä
uutena revisiosarakkeena nykyisissä riveissä. Säilytämme laskun liiketoiminnallisen
identiteetin mutta erotamme sen muuttumattomasta hyväksytystä sisällöstä.

Suositeltu rajattu malli on Invoicingin oma relaatiopohjainen
revisiokohtainen snapshot ja rivit sekä laskun nykyisen revision viite.
Nykyiset lasku-/rivitaulut voivat säilyä vaiheistetusti nykytilan lukumallina;
niitä ja revision sisältöä ei muodosteta eri laskentalogiikoilla eikä muuteta
erillisissä transaktioissa. Koko laskutusmoduulin repository-uudistus tai
yleinen versiointikehys ei kuulu tähän. Tarkka skeema ja lukijoiden siirto
katselmoidaan B3:n tiedostokohtaisessa valmistelussa.

- Hyväksyntä ja uudelleenhyväksyntä muodostavat yhden validoidun snapshotin,
  pysyvän revision ja rivit samassa transaktiossa nykyisen numeroinnin,
  laskun nykytilan ja auditin kanssa. Saman laskun uusi revisio ei ole uusi
  lasku eikä kuluta uutta laskunumeroa. Historiaan sidottuja rivitunnisteita
  ei tulkita myöhemmän revision riveiksi; myös hyvityksen lähderiviviitteet
  ja palautuksen yritys-/laskurajat testataan.
- Snapshot omistaa laskun sisältöarvot, rivit ja hyväksytyt rahasummat,
  ei jatkuvasti muuttuvaa maksu-, toimitus- tai peruutustilaa. Nykyinen
  `ApprovedInvoiceView` sisältää näitä dynaamisia kenttiä: koko API-vastausta
  ei tallenneta sellaisenaan uudeksi auktoritatiiviseksi historiamalliksi.
  Laskenta tehdään kerran hyväksynnässä, ei uudelleen historian lukemisessa.
- PDF:n metadata ja itsenäiset tavut kuuluvat samaan revisioon.
  Reopen irrottaa nykyisen esikatselun, mutta ei poista säilytettävää versiota,
  sen PDF:ää tai tapahtumaviitteitä. Uusi hyväksyntä julkaisee uuden current-
  viitteen; historia ei ole vaihtoehtoinen current-PDF-välimuisti.
- Ennen ulkoista provider-kutsua attempted-varaus sitoo muuttumattomasti
  yrityksen, laskun, revision, dokumentin ja toimitusmoodin. Kaikki ulkoiseen
  varaukseen sidotut versiot säilyvät myös epävarman tai epäonnistuneen
  yrityksen jälkeen. B ei lisää historian automaattista poistoa tai retention-
  siivousta; julkaisemattoman operaatiotiedoston siivous on eri asia.
- Onnistunut itselle lähetys sallii reopenin, kun lasku on muuten siihen
  kelvollinen eikä estävää toimitusta ole. Vanha versio jää historiaan.
  Uudelleenhyväksynnän jälkeen tavallinen asiakkaalle lähetys käyttää vain
  nykyistä hyväksyttyä revisiota ja uutta native-vahvistusta. Vanhan version
  katselu tai vanha vahvistustunniste ei valtuuta sen lähettämiseen asiakkaalle.
- Keskeneräinen `attempted` tai `outcomeUnknown` estää edelleen sisällön
  muuttamisen, peruutuksen ja uuden ulkoisen lähetyksen. Historia ei ratkaise
  epävarmaa SMTP-toimitusta. Onnistuneen asiakaslähetyksen jälkeen nykyinen
  `sent`-sääntö pysyy: sisältöä ei korjata samannumeroisella uudella revisiolla.
- Toimitushistorian luku saa näyttää tapahtumaan sidotun alkuperäisen PDF:n
  erillään nykyisestä versiosta. Tavalliset listat, saatavat, maksuseuranta,
  hyvityskatot ja raportit laskevat edelleen laskun vain kerran. Historialla
  ei ole omaa laskunumerointia, maksutilaa tai myyntisaatavaa.
- Invoicingin snapshot-/catalog-portit luettelevat myös historialliset
  auktoritatiiviset PDF:t. Backup/restore tarkistaa revision, laskun,
  dokumentin ja delivery-eventin viiteketjun sekä kaikki nykyiset tiedosto-
  invariantit. Historia ei saa jäädä valinnaiseen PDF-arkistoon, lokiin,
  pelkkään audit-tapahtumaan tai backupista puuttuvaan kansioon.

Vaihtoehtojen rajaus: pelkkä PDF/hash-historia olisi pienempi mutta ei
säilyttäisi korvattuja laskurivejä tai palautettavaa sisältösnapshotia.
Versionoitu tiukasti validoitu snapshot-payload on mahdollinen adapterin
tallennusvaihtoehto, mutta se tarvitsee oman formaatti- ja migraatiosopimuksen;
raakaa API-JSONia ei käytetä oikotienä. Relaatiomalli seuraa nykyistä
tietomalliperiaatetta. Se lisää schema-/mapper- ja varmuuskopiointityötä sekä
levytilaa, mutta pitää vastuun Invoicingissa. Kasvun ja pitkän historian
lukemisen kustannukset todennetaan synteettisellä aineistolla; mittaustuloksia
ei ole vielä. Rajattu tapahtumakohtainen PDF-katselu kuuluu suunnitteluun,
laaja versiovertailu, palautus vanhaan versioon tai massauudelleenlähetys ei.

### B-P3: turvallisen uudelleenlähetyksen vaihtoehto

**Omistajan hyväksymä rajaus 4.10.2026, ei vielä toteutettu.** Vanhan tiedon kohdalla
erotamme kaksi väitettä: säilynyt PDF vastaa nyt tarkistettua metadataa, tai
PDF todistetusti vastaa aiemmin toimitettua laskurevisiota. Nykyinen
`delivery_event.document_id -> invoice_documents -> tiedosto` voi tukea
ensimmäistä väitettä, mutta ei yksin todista toista. Laskukohtainen polku on
voinut ylikirjoittua; R02 on voinut muuttaa snapshotia lähetyksen aikana ja
R12 on voinut merkitä jo hyväksytyn toimituksen epäonnistuneeksi. Historiallinen
`sent` tai `succeeded` ei korjaa tätä puuttuvaa revisiotodistetta.

Lähdeluvussa tarkentui myös nykyisen `getApprovedInvoicePdfDocument.ts`-
polun raja: se palauttaa luetut tavut vertaamatta niiden SHA-256:ta tai kokoa
metadataan. Valmistelutunniste sitoo metadatan, ei itsestään varmennettuja
tavuja. B3:n tarkistus koskee siksi sekä uutta että legacy-haaraa. Havainto
on lähdeperusteinen täsmennys S030-04:n sisältösidontaan, ei tässä ajettu koe
tai uusi skannerin havainto.

Hyväksytty vaihtoehto on rajattu **säilyneen legacy-PDF:n uusi vahvistettu lähetys** jo
`sent`-tilassa olevalle laskulle. Se ei esitä vanhaa historiaa varmennetuksi,
muuta laskun sisältöä tai avaa sitä uudelleen muokattavaksi. Käyttäjä tarkistaa
lähetettävän dokumentin ja saa näkyviin historiallisen sisältösidonnan rajan.
Tämä säilyttää käyttökelpoisen uudelleenlähetyspolun ehjälle aineistolle,
mutta jättää katkenneet ja ristiriitaiset tapaukset erilliseen selvitykseen.

1. Backend tunnistaa vanhan aineiston migraatiossa säilytetystä alkuperästä,
   ei UI:n antamasta legacy-lipusta. `sendInvoices`, luotettu company/actor,
   laskun kelpoisuus ja estävät toimitukset tarkistetaan normaalisti.
   Vain säilyneen tapahtuma-/dokumenttiketjun yksiselitteinen ehdokas kelpaa
   tähän rajattuun vaihtoehtoon. Null-viitettä ei liitetä jälkikäteen nykyiseen
   PDF:ään eikä vanhaa testimoodia päätellä vastaanottajaosoitteesta.
2. Luetaan rajatun storagen tavut, tarkistetaan tyyppi, containment, koko ja
   todellinen SHA-256 sekä dokumentin yritys-/laskusidos. Ei ensure-PDF-
   regenerointia, metadatan poistavaa fallbackia eikä nykyisestä snapshotista
   tuotettua korvaavaa liitettä. Puuttuva tai ristiriitainen tiedosto pysäyttää
   toiminnon säilyttäen nykyisen aineiston.
3. Tarkistetut tavut kiinnitetään uuden operaation itsenäiseen, muuttumattomaan
   dokumenttiin. Alkuperäinen metadata, tiedosto ja historialliset tapahtumat
   säilyvät. Uusi dokumentti on Invoicingin katalogissa ennen provider-kutsua,
   ei pelkkä muistipuskuri tai temp-tiedosto. Tämän dokumentin provenance
   erottaa vanhasta aineistosta säilytetyt tavut uudesta varmennetusta
   laskurevisiosta; nykyistä snapshotia ei nimetä sen historialliseksi lähteeksi.
4. PDF-esikatselu, kertavaltuutus ja native-vahvistus kohdistuvat juuri tähän
   dokumenttiin ja uuden lähetyksen vastaanottajaan/viestikenttiin. Näkyvä
   merkitys on säilyneen dokumentin uusi lähetys, ei vanhan sisällön varma
   toisto. Send tarkistaa sidonnan sekä luettujen tavujen hashin/koon uudelleen
   ja antaa providerille saman tarkistetun puskurin, ei polusta myöhemmin
   uudelleen haettavia tavuja. Muuttunut vahvistuskohde hylätään.
5. Varaus ja lopputulos kirjataan uutena toimitusyrityksenä samaa atomista
   omistavaa toimitusporttia käyttäen. Uuden yrityksen artifact-sidos on
   täsmällinen, vaikka vanhan tapahtuman revisio jää tuntemattomaksi. Laskun
   snapshot, numero, maksu- ja `sent`-tila sekä vanhat tapahtumat eivät muutu.
   Ei automaattista uusintaa tai uuden asiakaslaskun luomista.

Tämä vaihtoehto tarvitsee eksplisiittisen tyypitetyn eron varmennetun uuden
revision ja säilyneen legacy-artifactin välille. Yleinen nullable revision
ohittava polku ei ole hyväksyttävä. Katalogi ja restore-validator tarkistavat
variantin omat viitteet; vanhan aineiston rajaus ei löysennä uuden revision
varmennusta. Käyttäjän vahvistus ei ohita hash-virhettä, yritysrajaa,
ratkaisematonta toimitusta tai tunnettua sisältöristiriitaa.

| Vanhan aineiston tila | Hyväksytyn rajauksen mukainen käsittely |
| --- | --- |
| Hyväksytty lasku ilman ulkoisen SMTP-toimituksen historiaa | Hallittu siirtyminen nykyisestä snapshotista uuteen varmennettuun revisioon ennen uutta lähetystä. Ei väitettä vanhan cache-PDF:n vastaavuudesta. |
| Jo `sent`, yksiselitteinen säilynyt tapahtuma-/PDF-ketju, tavut vastaavat metadataa eikä avointa epävarmuutta tai tunnettua ristiriitaa | Yllä kuvattu eksplisiittinen legacy-artifactin uusi lähetys. Historiallinen revisio jää ilmoitetusti varmentamatta. |
| Null-viite, usea ristiriitainen ehdokas, puuttuva PDF, hash-/kokovirhe, tunnettu R02-poikkeama tai väärä yritys-/laskusidos | Ei tätä lähetyspolkua eikä regenerointia; alkuperäinen aineisto säilytetään erillistä selvitystä varten. |
| `attempted`, `outcomeUnknown` tai selvittämätön R12:een sopiva vanha `failed` | Ei automaattista vapautusta tai uusintaa. Pelkkä `failed` ei todista toimittamattomuutta; tarvittava sovituspäätös on erillinen. |
| Vanha `approved` ja SMTP-historia, jonka asiakas-/testimoodia ei voida todentaa | **Omistajan hyväksymä rajattu selvitysesto 6.10.2026:** lasku ja historia säilyvät luettavina, mutta reopen, uusi lähetys ja lähetetyksi merkitseminen estetään selkeällä selvitysohjeella. Ei päätellä testimoodia vastaanottajasta tai ajasta eikä sovelleta uuden B-P2:n muokkauslupaa takautuvasti. Esto ei koske uusia laskurevisioita tai yllä hyväksyttyä ehjän vanhan `sent`-laskun resend-politiikkaa. |

Selvityseston HTTP-sopimus on `409` ja turvallinen koodi
`INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED`. Käyttöliittymä valitsee oman
vakioidun ohjetekstinsä täsmällisestä status-/koodiparista, ei backendin
raakaviestistä. Tavanomainen konfliktipalaute säilyy muille virheille.
Esto tarkistetaan ennen valmistelun sivuvaikutuksia sekä uudelleen omistavan
kirjoitustransaktion sisällä. Se ei tarjoa automaattista vapautusta,
historiatietojen poistoa tai uutta sovitus-/hallintakäyttöliittymää.

Tekninen tapahtuma on nykyinen `invoiceDelivery.prepareBlocked`: sama
turvallinen koodi, `stage=prepare`, `retryable=false`, `sideEffectState=none`.
Se ei ole SMTP-providerin epäonnistuminen. Diagnostics ja tukipaketin
varoitusprojektio lukevat tapahtuman; tavallinen business-selvitysvaroitus
ei kuulu nykyisen politiikan pitkän ajan error/security-incident-indeksiin
eikä muuta business-auditia tai Activityä. Lokitusvirhe ei korvaa estoa.

Migraation säilyvät rajat:

- Uudet ja uudelleenhyväksytyt laskut saavat uuden pysyvän revision; vanhan
  rivin metadatamerkintä ei väitä jälkikäteen todistettua toimitushistoriaa.
- Vanha hyväksytty lasku ilman ulkoisen SMTP-toimituksen historiaa voidaan
  siirtää uuteen sidontaan generoimalla PDF nykyisestä snapshotista hallitusti
  ennen uutta lähetystä. Se ei muuta laskunumeroa tai laskun rahasummia.
  Vanhaa cache-PDF:ää ei merkitä oikeaksi vain siksi, että sen byte-hash täsmää.
  Korvaus vaatii todennetun palautumiskopion ja ehjän uuden artifactin;
  mitään PDF:ää ei ylikirjoiteta migraation sivuvaikutuksena.
- Vanha ulkoinen toimitushistoria ja PDF säilyvät muuttamattomina.
  Yllä oleva resend-vaihtoehto ei luo puuttuvia vanhoja revisioita, korjaa
  vanhoja tapahtumia tai estä lukemista. Aikaisempi blanket-esto ei ole
  hyväksytty toteutussuunta. Sen sijaan yllä rajattu uusi legacy-haara on
  hyväksytty. Sen jäljelle jäävä riski on, ettei vanhan
  toimituksen sisältöä voida todistaa edes ehjän nykyisen PDF:n avulla.
- Vanhan historian luku ei heikennä backupin hash-, tyyppi-, containment-,
  identiteetti- tai puuttuvan artifactin tarkistuksia. Jos nykyistä
  backup-formaattia ei voida käyttää uuden catalogin kanssa, formaattimuutos
  palautuu päätökseen ennen koodausta. Tässä ei hyväksytä K-paketin ratkaisua.

R08:n nykyinen ryhmäpyöristys ja kumulatiivinen laskentasääntö säilyvät.
Uusia verosääntöjä tai historiallisten hyvitysten korjausajoa ei ehdoteta.
Jos snapshotin summat ovat keskenään ristiriitaiset, niitä ei kirjoiteta
hiljaisesti uusiksi. R12/R13 säilyttävät nykyiset SMTP-aika-, koko- ja
protokollarajat; ei uusia yhteysyrityksiä tai rajojen kasvattamista.

### B3/B4: tietomalli, portit ja migraatiojärjestys

**Suunnittelusopimus, ei toteutusnäyttö.** Omistajuus säilyy Invoicingissa.
Alla olevat relaatiot kuvaavat rajatun toteutuksen vastuut; tarkka DDL,
kenttäkohtainen snapshot-mapper ja muutosdiff katselmoidaan ennen käyttöönottoa.
Uutta yleistä historiamoduulia tai repository-kehystä ei perusteta.

| Tallennettava kokonaisuus | Omistettu sisältö ja ehto |
| --- | --- |
| Laskun muuttumaton sisältörevisio ja sen rivit | Yritys-, lasku- ja revisioidentiteetti, hyväksynnän sisältösnapshot ja lasketut rahasummat. Snapshot erotetaan elävästä maksu-/toimitus-/peruutustilasta. Julkaistua sisältöä ei päivitetä paikallaan. |
| Nykyisen revision viite | Yksi laskukohtainen viite; komposiittinen yritys-/laskuraja estää vieraan revision valinnan. Viitteen, nykytilan projektion ja auditin kirjoitus kuuluu samaan hyväksyntätransaktioon. Reopened-tilassa vanha hyväksyntärevisio on historiaa, ei kelvollinen nykyinen lähetyskohde. |
| Dokumentti ja sen sisältösidonta | Säilytetään `invoice_documents` dokumentti-identiteetin omistajana. Nykyinen yhden PDF:n laskukohtainen unique-raja korvataan revisiokohtaisella ehdolla. Uudella dokumentilla on oma storage-polku ja joko varmennetun revision sidos tai eksplisiittinen säilytetyn legacy-artifactin alkuperä. Pelkkä puuttuva revisio ei valitse legacy-haaraa. |
| Toimituksen pysyvä varaus ja lopputulos | Yritys/lasku, dokumentti, sidontavariantti ja customer/test-moodi tallentuvat ennen ulkoista kutsua. Uusi tiukka sidos ja alkuperäinen legacy-tapahtuma erotetaan; vanhoja null-viitteitä tai tuntemattomia moodeja ei täydennetä arvaamalla. |

Nykyisten `invoices`-/rivitietojen säilyttäminen lukuprojektiona ei tarkoita
kahta kirjoittajaa. Hyväksyntä muodostaa yhden validoidun sisältöolion, josta
omistava adapteri kirjoittaa sekä revision että nykyisen projektion saman
transaktion sisällä. Historian luku käyttää revisiota; listat, saatavat ja
maksut käyttävät laskun nykytilaa. Hyvityksen lähderiviviitteet eivät saa
alkaa osoittaa uuden revision eri riveihin. Näiden lukijoiden ja kirjoittajien
tarkka luettelo kuuluu B3:n ensimmäiseen diff-katselmukseen.

Nykyisten porttien rajatut muutokset:

- `InvoiceApprovalRepository`: revision julkaisu sekä reopenin/cancelin
  estot samassa transaktiossa toimitusvarauksen kanssa. Reopen ei enää
  palauta säilytettävän historian tiedostoja poistettavaksi.
- `InvoiceDocumentRepository` ja storage: revisiokohtainen haku, ehdollinen
  julkaisu/mitätöinti ja itsenäisten tavujen kirjoitus. Laskukohtainen
  `deleteDocumentsForInvoice` ei jää uuden historian ohittavaksi poistopoluksi.
- Toimitusrepository ja finalizer: sama varauksen identiteetti kulkee prepare
  -> reserve -> provider -> complete. Asiakaslähetyksen onnistuminen ja
  testilähetyksen onnistuminen säilyvät eri lopputoimina; testi ei käytä
  asiakkaan `sent`-päivitystä. Myös failed/unknown-kuittaus kohdistuu vain
  alkuperäiseen varaukseen. Nykyisen manuaalisen toimituksen atominen
  event/tila/audit-kirjoitus ja unresolved-esto säilyvät.
- Historialuku tarvitsee yritysrajatun laskuidentiteetin myös reopened-
  tilassa. Nykyinen `listInvoiceDeliveryEvents` tarkistaa
  `ApprovedInvoiceReader`-lukijalla vain approved/sent/cancelled-laskut;
  sitä ei laajenneta globaalisti keskeneräisten laskujen lähetyskelpoisuudeksi.
  Rajattu historian lukija ja tapahtumaan sidottu PDF-luku pitävät omat
  permission- ja yritysrajansa. Nykyinen toimitushistorian `sendInvoices`-
  tarkistus ei poistu. PDF-luku ei generoi puuttuvaa historiallista PDF:ää.

Backup-yhteensopivuuden tarkistus tukee **nykyisen salatun containerin,
manifestin ja `snapshot-catalog-v1.json`-esityksen säilyttämistä**. Tiedoston
looginen nimi johdetaan document-ID:stä, ei invoice-ID:stä; useita saman
laskun PDF:iä voidaan siten luetteloida muuttamatta envelopea. Dokumenttityyppi
säilyy `approved_invoice_pdf`: revision tai legacy-alkuperän ero kuuluu
SQLite-sidontaan, ei uudeksi katalogin dokumenttityypiksi.

Katalogin tarkat kentät ja rajat säilyvät. Invoicingin
`SqliteInvoiceBackupArtifactCatalog` tarkistaa oman moduulinsa uuden
viiteketjun ja luettelee kaikki auktoritatiiviset dokumentit, ei vain current-
PDF:ää. `validateProfileArtifactCatalog` ja aktiivisen profiilin validointi
käyttävät tätä omistavaa sopimusta; yleinen backup-kerros ei kopioi moduulin
SQL:ää. Tarkistus erottaa varmennetun revision, alkuperäisen legacy-rivin ja
siitä uuden vahvistuksen yhteydessä säilytetyn artifactin. Tiukkoja parser-
avaimia tai katalogin formaattiversiota ei muuteta tämän suunnan perusteella.
Uudet sarakkeet ovat DB-skeemamuutos, eivät salausformaatin muutos.

Migraation ja palautuksen järjestys:

1. Varmennetaan lähtöskeema ja nykyinen pre-migration-palautuspiste.
   Lisätään vain uusia järjestysnumeroituja migraatioita; julkaistujen SQL-
   tiedostojen tavut, migraatioketju ja hyväksytty metadataa edeltävä ankkuri
   säilyvät. Tarkka seuraava numero varmistetaan toteutuspreflightissa.
2. Luodaan sisältöhistoria ja tiukat sidonnat omistavan migraatiomallin
   mukaisesti. Säilytetään alkuperäiset ID:t, snapshot-arvot, tapahtumat ja
   null-viitteet. Tarvittava `invoice_documents`-taulun rajattu muutos
   ei saa toteuttaa `ON DELETE SET NULL` -sivuvaikutusta vanhoille toimituksille.
   Foreign key -tarkistus ja tapahtumaviitteiden täsmävertailu vaaditaan.
3. Migraatio ei tee PDF-renderöintiä, tiedosto- tai verkkotoimia eikä lisää
   dokumenttiriviä ilman olemassa olevia tavuja. Vanhasta nykytilasta kopioitu
   sisältö merkitään alkuperältään erotettavaksi: se ei todista vanhan PDF:n
   vastaavuutta tai vanhan lähetyksen sisältöä. Uusi legacy-kopio syntyy vasta
   hyväksytyssä prepare-polussa, ei SQL-migraation sivuvaikutuksena.
4. Backupin staging validoidaan ensin sen tunnetun historiallisen skeeman
   mukaan. Migroinnin jälkeinen tarkistus vertaa alkuperäistä katalogia myös
   uuteen DB:hen; siksi vanhat document-ID:t, polut, hashit ja koot eivät
   vaihdu migraatiossa. Uuden skeeman puuttuva sidos on virhe, ei lupa pudota
   historialliseen validatoriin. Yksi omistava skeemakohtainen tarkistus
   palvelee katalogia, restorea ja aktiivisen profiilin validointia.
5. Ennen hyväksyntää todennetaan vanha backup -> migrate -> materialize ->
   restart sekä uusi moniversioinen backup -> inspect -> restore -> restart
   -> compare. Katkos ei jätä puolta historiaa käyttöön. Paluu käyttää
   palautuspistettä, ei reverse-migraatiota tai vanhaa binaaria uuden DB:n päällä.

Tämä ei ole todennettu formaattimuunnos: lopullinen näyttö tulee B5:ssä.
Jos toteutus tarvitsee uusia serialisoituja katalogikenttiä, dokumenttityypin,
muuttuvia vanhoja polkuja, suurempia rajoja tai uutta yhteensopivuuspoikkeusta,
se palautuu erilliseen päätökseen. Muistissa olevat tokenit, lokit tai
valinnainen PDF-arkisto eivät korvaa pysyvää sidontaa tai backup-sisältöä.

### Toteutuspalat ja hyväksyntänäyttö

| Järjestys | Omistettu muutos | Vaadittu näyttö |
| --- | --- | --- |
| B1: SMTP | R13:n riviparseri, sitten R12:n DATA-kuittaus ja niiden provider-kytkentä. | Samat tavut yhtenä chunkkina, riveittäin, tavuittain ja jokaisessa kahden osan katkaisukohdassa; CR/LF-, rivi-/kokonaisrajan ja keskeneräisen syötteen vastakontrollit. Lopullinen 250 ennen deadlinea ja QUITin alussa kulunut aika, synkroninen heitto ja Promise-hylkäys. Kielteinen tai kadonnut DATA-kuittaus ei muutu onnistumiseksi; yksi DATA, bounded cleanup ja puskurien nollaus. |
| B2: hyvitys | R08:n alkuperäisen ALV-kapasiteetin laskenta nykyisestä snapshotista samalla net/gross-ryhmäperiaatteella kuin laskulla. | Pienet rivit ja pyöristyseron molemmat suunnat, useat ALV-ryhmät, alennukset, täysi hyvitys ja osahyvitysten viimeiset sentit. Määrä-/summaylitys, väärä kanta ja safe-integer-rajat. Oikean standardilaskennan snapshot -> hyvitysluonnos -> atominen hyväksyntä ja rollback-/yritysrajat. |
| B3: revisio ja PDF | B-P1:n hyväksytty revisiosidonta ja B-P2:n toimitushistorian valmisteltu tietomalli; revision omistama PDF, ehdollinen julkaisu/uudelleenkäyttö ja cache-mitätöinti. B-P3:n legacy-haara vain sen hyväksytyn sopimuksen mukaan. | Renderöinnin ja reopen/reapprove/cancelin molemmat järjestykset. Kaksi kirjoittajaa, julkaisuvirhe, omistetun tiedoston siivous, nykyisen PDF:n säilyminen ja restart. Vanha cache-luku odottaa uuden revision/PDF:n julkaisun yli ja epäonnistuu: uuden dokumentin metadata, tavut ja toimitussidonta säilyvät. Todellinen hash/koko tarkistetaan luetuista lähetys- ja esikatselutavuista, ei vain metadatasta. |
| B4: toimituksen elinkaari | B-P2:n historian säilyttävä reopen, atominen varaus, täsmällinen finalizer ja epävarman tilan säilyminen; hyväksytyn B-P3:n rajattu resend ilman takautuvaa historian muuttamista. | Fake-providerin hallitut välivaiheet: cancel/reopen ennen varausta ja varauksen jälkeen, vanha native-token, rinnakkaiset yritykset, customer/test/dry-run, lopullisen 250:n jälkeen epäonnistuva DB-kirjoitus ja toistettu kuittaus. Restart ennen ja jälkeen providerin; ei automaattista uudelleenlähetystä tai väärän revision `sent`-merkintää. |
| B5: kokonaisuuden hyväksyntä | Tuotannon composition, käyttäjäpolut, palautettavuus ja ohjeet. | Synteettinen approve -> PDF -> native-vahvistus -> fake SMTP -> delivery/sent-jälkiluku, estot ja turvalliset ilmoitukset. Hardened Windows backup -> inspect -> restore -> restart -> compare myös usealla saman laskun versiolla, legacy-artifactilla ja alkuperäisillä PDF-tavuilla; historian migraatio- ja katkeamiskohdat sekä uuden jäädytetyn revision normaalit PR/main-portit. |

B1 ja B2 ovat itsenäisiä korjauspaloja. B3 ja B4 suunnitellaan yhtenä
eheänä sopimuksena ja toteutetaan sisäisesti pieninä muutoksina: puolitettua
revisiosidontaa ei julkaista valmiina korjauksena. SQL-transaktioon ei tehdä
verkko- tai tiedosto-`await`-kutsua. Jokainen pala alkaa tuoreella preflightilla;
tarkka tiedostolista, migraatiojärjestys ja omistavien ohjeiden täsmennykset
lukitaan ennen sen toteutusta. B1/B2 ei sulje S030-03/04/05:a.

B-P2/P3:n lisättyjen polkujen hyväksyntätapaukset:

- Testi-SMTP onnistuu revisiolle A -> reopen -> muutos -> reapprove B ->
  asiakaslähetys B. A:n snapshot, rivit ja tapahtuma säilyvät sisältövertailussa
  ja PDF byte-vertailussa; lasku-ID ja numero eivät vaihdu. A:n vanha token hylätään ja
  asiakaslähetys merkitsee vain B:n nykyisen laskun `sent`-tilaan.
- Maksut, saatavat, listat ja hyvityskatot eivät monistu versiomäärän mukana.
  Tilapäivitys ei muuta historiallista sisältöä. Historiallinen PDF-luku
  noudattaa samoja permission-/yritysrajoja kuin nykyisen laskun luku.
  Toimitustapahtuma ja sen säilynyt PDF ovat luettavissa myös reopenin
  aikana; tämä ei tee luonnoksesta tai vanhasta versiosta lähetyskelpoista.
- Hyväksytty legacy-resend lähettää täsmälleen tarkistetut säilyneet tavut
  ja jättää laskun nykyisen snapshotin ja alkuperäisen historian ennalleen.
  Katkennut viite, hash-virhe, puuttuva tiedosto ja tunnettu R02/R12-ristiriita
  hylätään ilman regenerointia tai provider-kutsua. UI ei voi nimetä uutta
  laskua legacyksi. Uuden historian puutteellinen revision kenttä ei putoa
  legacy-haaraan.
- Prepare/send-vaihdos, native-peruutus, vanha/käytetty token ja lopullisen
  SMTP-hyväksynnän jälkeen epäonnistuva finalizer säilyttävät oikean artifactin
  ja toimitusyrityksen sidonnan. Valmistelussa kaatuneen kopioinnin oma julkaisematon tiedosto
  voidaan siivota; katalogoitua tai varattua historiaa ei hävitetä.
- Migraatio ja palautus kattavat vanhan current-PDF:n, usean revision,
  legacy-variantin, katkenneen toimitusviitteen ja uuden unresolved-varauksen.
  Vanhan formaatin sallittu null-viite ei löysennä uuden sidonnan vaatimuksia.
  Varmennetut lukijat erottavat vanhan datan yhteensopivuuden uudesta
  viitevirheestä. Katkaistu migraatio ei jätä puoliksi siirrettyä historiaa.

Nykyiset unit-/repository-/fake-provider-testit todistavat järjestykset
ilman kiinteitä unia. Edustavat oikean HTTP-/UI-/native-rajan ketjut lisätään
nykyisiin kolmeen E2E-fixtureen ja [R0-matriisiin](r0-e2e-test-matrix.md#invoicing).
Ei oikeaa sähköpostipalvelinta, käyttäjädataa tai uutta prosessihallintaa.
Hash, metadata ja pysyvä business-tila tarkistetaan, ei vain UI-viesti.
Testin ajokytkentä ja todellinen läpäisy todistetaan erikseen.

### Palaute, diagnostiikka ja palautettavuus

- Tunnettu ristiriita kertoo turvallisesti, että lasku muuttui tai toimitus
  on selvitettävä. API-clientin strict-sopimus, suomenkielinen UI ja busy-tila
  vastaavat samaa tulosta. Vanha esikatselu tai vahvistus ei valtuuta muuttunutta
  kohdetta. Virheviesti ei paljasta polkuja, tarpeettomia vastaanottajatietoja
  tai raw-provider-virhettä; vahvistuksen tarkoituksellinen vastaanottajan
  tarkistaminen säilyy.
- Toimitustapahtuma ja business-audit säilyttävät oman auktoritatiivisen
  sisältönsä transaktion kanssa. Tekniseen lokiin lisätään vain tarvittava
  sallittu vaihe/syy; lasku-, dokumentti- tai vastaanottajatiedot eivät tule
  diagnostiikkaan tai tukipakettiin. Jokaisen uuden tapahtuman Activity-,
  Diagnostics-, tukipaketti- ja incident-sopivuus päätetään erikseen ja oikea
  writer -> reader -> projektio -kytkentä testataan. Ei uutta loggeria.
- Muuttuvat snapshot-, catalog- ja restore-invariantit päivitetään Invoicingin
  ohjeeseen, backup-artifact-inventaarioon ja moduulien integraatiomatriisiin
  toteutuksen mukana. Julkaisematon temp-PDF ei ole auktoritatiivinen backup;
  toimitustodisteeksi säilytettävä PDF ei saa jäädä orvoksi catalogin ulkopuolelle.
- Uusi schema vaatii uusia migraatioita sekä nykyisen pre-migration-
  palautuspisteen. Epäonnistuminen palautuu nykyisellä profile-recoveryllä,
  ei reverse-SQL:llä. Vanhaa binaaria ei avata uuden scheman päälle.
  Installer-päivitys ja rollback säilyttävät omat hyväksyntäporttinsa.
- Paikallinen palautuspiste ei peru jo lähtenyttä sähköpostia. Palautuksessa
  säilyvä epävarmuus ja ulkoinen sivuvaikutus kerrotaan recovery-ohjeessa;
  B ei lupaa SMTP:n exactly-once-toimitusta tai vanhan backupin tietävän
  myöhempien lähetysten tilaa.

Ensivirheiden säilytys ja yksi hallittu uusinta noudattavat nykyistä
[testauskäytäntöä](../ai/testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus).
Tunnettu sisältö-/yritysraja-/toimitusvirhe ei muutu hyväksytyksi uusinnalla.
Salattu tutkimusaineisto ja turvallinen julkinen raportti säilyvät erillisinä;
testialustaa, aikarajoja tai hyväksyntäehtoja ei muuteta B:n takia.

### B0:n jatkamiskohta

Valmistelussa tehtiin lähdevertailu, rajattu SMTP-/hyvityssopimusten tarkistus
ja riippumaton suunnitelmakatselmus. Katselmuksen PDF-cache-metadatan
mitätöintihavainto täsmennettiin sopimukseen ja B3:n testitapaukseen;
täsmennys tarkistettiin uudelleen. Muuttuneiden ohjeiden linkit, ankkurit,
diff-hygienia ja julkaistavan lisäyksen yksityisyys tarkistettiin.
Sovellus- tai CI-testejä ei ajettu eikä tuotantosopimuksia muutettu.
Päätösten jatkovalmistelussa legacy-resendin lähdeketju tarkistettiin erikseen.
Riippumaton B-P2:n suunnitelmakatselmus ei löytänyt suunnittelusuunnan estävää
puutetta; skeeman, lukumallin ja palautuksen toteutusnäyttö jää B3-B5:een.
Omistaja hyväksyi B-P1:n revisiosidonnan ja migraatiot, valitsi B-P2:n
muokkaamisen säilyttävän historian suunnitteluun sekä hyväksyi selvityksen
jälkeen B-P3:n rajatun legacy-uudelleenlähetyksen ilmoitettuine
sisältövarmuuden rajoineen. Näitä kolmea päätöstä ei kysytä uudelleen
muuttumattomalle rajaukselle. Aikaisempaa pysyvää testilähetyksen muokkausestoa
tai yleistä legacy-estomallia ei toteuteta. B3/B4:n schema-/portti-/katalogityö
noudattaa yllä täsmennettyjä omistajuuksia ja migraatiojärjestystä;
toteutuksen diff ja sen testinäyttö katselmoidaan erikseen.
Erillinen backup-lähdetarkistus tuki nykyisen containerin, manifestin ja
katalogiesityksen säilyttämistä. B3/B4:n täsmennetyn sopimuksen riippumaton
katselmus ei löytänyt estävää ristiriitaa. Viitteiden täsmäsäilytys,
varianttien tiukkuus, historialuvun oikeudet ja vanhan/uuden backupin
palautus ovat silti toteutuksen todentamisportteja, eivät tässä läpäistyjä
testejä. Kuuden suunnitteludokumentin lukureitit ja 216 suhteellista
linkkiä/ankkuria tarkistettiin; sovelluskoodia, migraatioita ja CI:tä ei ajettu.
Toteutus alkaa omistajan hyväksymästä palasta; B:n koko valmistuminen vaatii
kaikkien kuuden havaintorivin sopimukset ja B5:n näytön. B0:n hyväksyntä ei
merkitse haavoittuvuuksia korjatuiksi, uutta Deep Scania tehdyksi tai B:tä
valmiiksi. Koko ohjelman katselmus ja myöhempi Deep Scan pysyvät M5:ssä.

### B1/B2: rajattu toteutus

**Omistajan hyväksymä rajaus 4.10.2026; toteutus, katselmus ja integraatio
hyväksytty PR #297:n mainissa 5.10.2026.**
[Rajattu Electron-sulku- ja keräysjatko](#b1b2-mainin-electron-sulkuhavainto)
on myös hyväksytty, eikä B1/B2:ta toteuteta uudelleen.
Tämän toteutuksen lähtökohtana oli PR #294:n main. B0:n kuusi
suunnitteludokumenttia säilyvät suunnittelupohjana, eivät toteutusnäyttönä.

- B1/R13: käsitellään SMTP-vastaus riveinä ja vastauksina riippumatta
  verkkolohkojen rajoista. CRLF-, rivikoko-, vastauskoko- ja tilarajat säilyvät.
- B1/R12: lopullisen DATA-250:n jälkeen QUITin aikarajan laskenta,
  synkroninen virhe, hylätty Promise tai sulkuvirhe eivät kumoa hyväksyntää.
  Sulkuvirhe ei myöskään peitä alkuperäistä hylkäystä tai epäselvää lopputulosta.
  Ei automaattista uudelleenlähetystä tai uutta aikarajaa.
- B2/R08: alkuperäisen laskun ALV-kapasiteetti noudattaa saman laskun
  hyväksyttyä net/gross-ryhmäpyöristystä. Kumulatiiviset katot, ylitysten
  estot ja muuttumattoman hyväksytyn aineiston rajat säilyvät.

Tavallinen käyttäjäpolku, laskun identiteetti ja numerointi eivät muutu.
Ei riippuvuutta, migraatiota, historiallisten summien korjausajoa tai
versiopäivitystä. B3/B4:n revisiohistoria, legacy-resend ja backup-muutokset
eivät kuulu tähän rajaukseen; S030-03/04/05 jäävät avoimiksi.

Hyväksyntä edellyttää yllä B1/B2-taulukossa nimettyjä regressioita, todellista
provider-/repository-kytkentää, diagnostiikka- ja audit-vaikutusarviota,
riippumatonta katselmusta sekä uuden jäädytetyn revision nykyisiä PR/main-
portteja. Paikallinen läpäisy ei vielä sulje integraatiota. Virheiden
turvalliset koodit, nykyinen tapahtumien lukuketju ja ensimmäinen
epäonnistuminen säilytetään; uutta yleistä lokitusjärjestelmää ei lisätä.

Toteutuksen checkpoint ennen integraatiota:

- SMTP:n parseri-, session-, provider- ja connection-kytkennän regressiot
  läpäisivät. Mukana ovat jokainen kaksiosainen lohkoraja, tavukohtainen
  syöte, keskeneräisen liian pitkän syötteen välitön hylkäys sekä oikean
  connection-ajastimen läpi päättyvä vastaamaton QUIT. Testit eivät lähetä
  oikeaa sähköpostia.
- Hyvityksen 36 domain-/SQLite-testiä läpäisivät. Näyttö kattaa oikean
  standardilaskennan, tallennetun hyväksytyn snapshotin, hyvitysluonnoksen,
  atomisen hyväksynnän sekä audit-rollbackin ja yritysrajauksen.
- Työtilan testit, tyyppitarkistus ja backend-build läpäisivät checkpointissa.
  Kahdeksaa ennestään ohitettua testiä ei lasketa läpäisyiksi. Katselmuksen
  kaksi myöhempää testitäydennystä ja backendin tyyppitarkistus läpäisivät
  erikseen; lopullisen revision CI on edelleen oma porttinsa.
- Tuotantodiffin riippumaton B1/B2-katselmus ei löytänyt korjattavaa.
  Turvalliset virhekoodit ja providerin nykyinen onnistumis-/virheketju
  säilyvät. Lopullisen DATA-hyväksynnän jälkeinen sulku ei tuota väärää
  lähetysvirhettä. Hyvityksen nykyinen atominen audit säilyy.
- Käyttäjän lomakkeet, API-sopimukset, permissionit, yritysrajaus ja
  numerointisäännöt eivät muutu. Uutta pysyvää artifactia, backup-formaattia,
  migraatiota tai diagnostiikkatapahtumaa ei lisätä. Nykyiset palautus- ja
  paketointiportit säilyvät normaaleina integraation vaatimuksina.

Ensivirheiden aineisto säilytetään. Kaksi uusien testien fixture-/raja-arvon
virhettä korjattiin testikoodissa; tuotannon rajoja ei lievennetty niiden
läpäisemiseksi. Lopullinen integraationäyttö sidotaan PR:n lähteeseen,
testattuun merge-checkoutiin ja mainin omiin tarkistuksiin.

**Erillinen jatkohavainto, ei B2:n korjausväite:** hyväksytyn laskun raaka
ALV-lukuprojektio ja sovelluskerroksen normalisointi eivät ole sama sopimus.
Tavallisen laskun ja osahyvityksen vaikutus on tarkennettu alla B3:n
valmistelussa. B2:n hyväksyntä ei sulje tätä havaintoa.

### B3-B5: toteutusvalmistelu

**Aloitettu 5.10.2026 hyväksytystä mainista; tekninen toteutusehdotus on
katselmoitu ja numeroitu migraatio on työpuussa, ei vielä korjauksen hyväksyntä.**
Yksi alla nimetty vanhan aineiston toimintapäätös on edelleen avoin.
Omistajan hyväksymä jatko kattaa yllä olevan
B0/B-P1/B-P2/B-P3-sopimuksen. Valmistelu ei avaa uutta testialustatyötä tai
muuta vanhan skannauksen `canceled`-tilaa. Alkuperäiset seitsemän B:hen
kuuluvaa skannerihavaintoa korjausehdotuksineen on luettu säilyneestä
aineistosta; alkuperäistä R02-katselmusta ja nykyisiä toteutuspolkuja
verrataan niihin. Staattista havaintoa ei nimetä uudeksi runtime-toistoksi.

#### ALV-lukupolun tarkennus

Kaksi rajattua synteettistä lähtötilan koetta erottavat seuraavat tapaukset.
Ne ovat virheen/lukupolun toiston näyttöä, eivät korjauksen läpäisyjä.

- `approvedInvoiceReadModelMapping.ts` summaa tallennetut riviverot.
  Tavallisen laskun auktoritatiivinen loppusumma on ryhmäpyöristetty, joten
  raaka erittely voi poiketa siitä. `getApprovedInvoice.ts` ja uuden PDF:n
  `generateApprovedInvoicePdfDocument.ts` kuitenkin käyttävät
  `withCalculatedApprovedInvoiceVatBreakdown`-normalisointia. Koe vahvisti
  tavallisen laskun sovellusvastauksen ja PDF-renderöijän syötteen oikeaksi.
  Pelkkä raaka lukija ei siten todista tavallisen käyttöliittymän tai PDF:n
  näkyvää pyöristysvirhettä.
- Sama normalisointi pyöristää myös osahyvityksen uudelleen tavallisen
  laskun säännöllä. Nykyinen hyväksytty hyvityslaskenta on kumulatiivinen:
  viimeisen osahyvityksen erittelyn pitää säilyttää sille kohdistetut sentit.
  Koe toisti sovellusvastauksen ja uuden PDF-renderöijän syötteen
  ristiriidan, vaikka tallennettu laskutason loppusumma pysyy oikeana.
  Se käytti olemassa olevaa laskentaa ja oikeita application-polkuja;
  hyvityksen koko hyväksyntätransaktio, HTTP/UI ja lopullinen PDF eivät
  vielä olleet tämän kokeen todennuskohteita.

Jatkokoe käytti oikeaa standardilaskun hyväksyntää, tallennettua sent-
snapshotia, hyvitysluonnoksen muodostusta ja kahta hyvityshyväksyntää.
Net/gross-senttirajat kahdella ALV-kannalla toistivat erittelyn poikkeaman
sekä `getApprovedInvoice`-vastauksessa että uuden PDF:n renderer-syötteessä.
Tallennetut hyvityssummat kuluttivat alkuperäisen laskun kapasiteetin oikein,
eikä alkuperäislasku muuttunut. Samojen ketjujen virheettömät kontrollit
läpäisivät. Tämä täydentää oikean hyväksyntäketjun näyttöä, mutta ei vielä
todista korjausta, HTTP/UI-kytkentää tai lopullisen PDF:n sisältöä.

Rajattu korjaussopimus: tavallinen lasku käyttää nykyistä net/gross-
ryhmäpyöristystä, hyvitys valmiiksi kumulatiivisesti laskettuja rivejä ja
rakennusalan käännetty ALV tyhjää erittelyä. Näyttö ja uusi revisiosnapshot
eivät saa käyttää eri laskentasääntöjä. Uuteen snapshotiin tallennetaan
hyväksynnässä saatu erittely yhdessä loppusummien kanssa; historiaa ei
normalisoida joka lukukerralla uudelleen. Historiallisia summia tai
säilyneitä PDF:iä ei kirjoiteta hiljaisesti uusiksi. Ristiriitaista vanhaa
sisältöä ei nosteta varmennetuksi uudeksi revisioksi.

**Rajattu laskentakorjaus työpuussa:** `invoiceViewTotals.ts` valitsee
hyvitykselle saman `calculateCreditInvoiceDraft.ts`:n `sumCreditTotals`-
funktion kuin hyväksyntälaskenta. Nykyinen rivien lukuarvovalidointi on
jaettu `calculateInvoiceTotals.ts`:stä muuttamatta sen ehtoja; erittelyä
summattaessa säilyvät kokonaislukurajat ja saman ALV-kannan syöttötilan
yhtenäisyys. Tavallisen laskun ryhmäpyöristys ja käännetyn ALV:n tyhjä
erittely eivät muutu. Pysyviä rivejä, loppusummia tai PDF:iä ei päivitetä.

Oikean hyväksyntäketjun kuusi osahyvityksen rajatapausta hylkäsivät vanhan
lukupolun; net/gross-kontrollit, täyshyvitys, vapaa hyvitysrivi ja käännetty
ALV säilyivät toimivina. Korjauksen jälkeen laskutusmoduulin 793 testiä ja
backendin tyyppitarkistus läpäisivät. Näyttö sisältää virheellisten
lukuarvojen, ylitysten, puuttuvan ALV-kannan ja vanhan PDF:n säilymisen
regressiot sekä oikean SQLite-hyväksyntäketjun application- ja PDF-syötteen.
Laajempi backend-ajo läpäisi 1 473 testiä; viisi nykyistä alustakohtaista
testiä jäi ajon ulkopuolelle eikä ohitusehtoja muutettu. Rajattu riippumaton
suunnitelma- ja koodikatselmus eivät jättäneet avoimia korjaushavaintoja.
PDF-näyttö koskee rendererin syötettä, ei uuden ketjun lopullisen PDF:n
sisältötarkistusta. Mark-sent- ja dry-run-polkujen nykyiset testit läpäisivät,
mutta niiden omat uudet senttirajaregressiot eivät kuulu tähän näyttöön.
Vanha säilynyt PDF voi edelleen sisältää aiemman erittelyn; sitä ei korjata
tämän muutoksen sivuvaikutuksena. Tämä ei ole uuden revisioskeeman,
HTTP/UI-ketjun tai koko B3-B5:n hyväksyntä; PR/main-portit ovat vielä avoinna.

#### Omistava toteutuskartta

Polut alla ovat `apps/backend/src/modules/invoicing`-alueen sisällä, ellei
toisin mainita. Taulukko nimeää nykyiset omistajat, ei uusia yleispalveluja.

| Vastuu | Nykyinen omistaja ja rajattu jatko |
| --- | --- |
| Standardihyväksyntä ja uudelleenhyväksyntä | `infrastructure/sqliteInvoiceApprovalRepository.ts`, `invoiceApprovalPersistenceRows.ts`, `sqliteInvoiceApprovalStatements.ts`: yksi validoitu sisältö, revision/rivien/erittelyn julkaisu samaan numerointi-/audit-transaktioon. |
| Hyvityshyväksyntä | `infrastructure/sqliteInvoiceCreditApprovalRepository.ts`: käytä `calculateCreditInvoiceDraft`- tai reverse-charge-laskennan valmiita rivejä ja erittelyä; ei uutta laskentaa tallennuksen tai lukemisen yhteydessä. |
| Nykyisen sisällön luku | `infrastructure/sqliteApprovedInvoiceReader.ts`, `approvedInvoiceReadModelMapping.ts` ja `domain/invoiceViewTotals.ts`: erota sisältö dynaamisesta maksu-/peruutusprojektiosta ja säilytä tavallisen laskun sekä hyvityksen eri pyöristyssopimukset. |
| PDF | `application/generateApprovedInvoicePdfDocument.ts`, `getApprovedInvoicePdfDocument.ts`, `ports/invoiceDocumentRepository.ts`, `infrastructure/sqliteInvoiceDocumentRepository.ts` ja `localInvoiceDocumentStorage.ts`: revision tarkistus, ehdollinen julkaisu/mitätöinti ja vain oman julkaisemattoman tiedoston siivous. |
| Toimitus ja peruutus | Nykyiset prepare/send-käyttötapaukset, `sqliteInvoiceDeliveryEventRepository.ts` ja sen queries/statements sekä `sqliteInvoiceCorrectionRepository.ts`: sama atominen varausraja ja tarkka finalizer; manuaalinen toimitus, dry-run ja testimoodi tarkistetaan erikseen. |
| Pysyvyys ja palautus | `apps/backend/src/database/schema.ts`, `039_add_invoice_content_revisions.sql` ja `infrastructure/sqliteInvoiceBackupArtifactCatalog.ts`: eksplisiittiset variantit, vanhojen viitteiden täsmäsäilytys ja sama omistava tarkistus katalogissa sekä palautuksessa. Migraatiot 001–038 säilyvät muuttumattomina; uusi 039 on työpuussa, katalogin sovitus ja palautustodistus ovat vielä avoinna. |

Snapshotin kenttäluettelon lähtö on nykyinen `InvoiceTable` ja
`InvoiceLineTable`, ei koko `ApprovedInvoiceView`-API-vastaus. Sisältöön
kuuluvat laskun identiteetti-/numerointisnapshot, asiakas-/myyjä-/vastaanottaja-
snapshotit, päivämäärät, maksuehdot, sisältötekstit, verokäsittely,
suoritusjakso, hyväksyntäaika, rivit ja auktoritatiivinen ALV-erittely sekä
summat. Laskun elävä `status`, `updated_at`, `cancelled_*`,
`cancellation_reason`, `payment_state`, `paid_*` ja `payment_*` eivät kuulu
muuttumattomaan sisältöön. Hyvityksen viittaus ja sen lähderivit sidotaan
alkuperäiseen sisältöön, ei myöhemmin korvattavaan nykytilan riviin.

#### Tietomallin katselmointiehdotus

Alla on V1:n katselmoitu tekninen sopimus. Sen numeroitu 039-toteutus ja
versionoidut constraint-testit on nyt erikseen katselmoitu ja kohdetodennettu
alla kuvatulla näytöllä. **Yhtenäinen sovellusketju ja julkaisu eivät vielä
ole hyväksyttyjä**; migraatiota ei toimiteta ennen kirjoittajien sovitusta
ja palautustodistusta.
Kaikki taulut kuuluvat Invoicingiin. Ei uusia business-moduuleja,
yleiskäyttöistä historia-/lukituspalvelua tai backup-formaatin muutosta.

| Taulu / muutos | Avain, sisältö ja eheysraja |
| --- | --- |
| `invoice_content_revisions` | Opaque `id`; `company_id`, `invoice_id`; `origin` = `approval`, `legacySnapshot` tai `validatedLegacySnapshot`. Unique `(company_id, invoice_id, id)` ja komposiittinen FK saman yrityksen laskuun. Sisältö alla nimetyistä snapshot-kentistä; alkuperä ei ole UI:n antama valinta. Julkaistua revisiota ei päivitetä tai poisteta. |
| `invoice_revision_lines` | PK `(revision_id, line_id)`; unique `(revision_id, line_order)` sekä yritys-/lasku-/revisio-FK. Kaikki nykyisen `InvoiceLineTable`-snapshotin kentät, alkuperäinen `id` nimellä `line_id`. Lisäksi nullable `source_revision_id`, joka lähderivillisellä hyvityksellä sidotaan saman yrityksen hyvitetyn laskun muuttumattomaan lähderiviin. |
| `invoice_revision_vat_breakdown` | PK `(revision_id, vat_rate_basis_points)` sekä yritys-/lasku-/revisio-FK; `net_cents`, `vat_cents`, `gross_cents`. Uudessa hyväksynnässä erittely tulee jo lasketusta tuloksesta. `legacySnapshot` ei saa SQL-migraatiossa keksittyä erittelyä; sen saatavuus erotetaan alkuperällä. Käännetyn ALV:n erittely on tarkoituksellisesti tyhjä. |
| `invoice_current_revisions` | PK `(company_id, invoice_id)` ja `revision_id` komposiittisella FK:lla. Erillinen pieni osoitintaulu välttää koko nykyisen `invoices`-viiteverkon uudelleenluomisen. Hyväksynnän projektiot ja audit sekä osoitin vaihtuvat yhdessä; reopen poistaa vain nykyosoittimen, ei historiaa. |
| `invoice_documents` | Nykyiset kentät/ID:t säilyvät. Lisätään `binding_kind` = `revision`, `legacyOriginal` tai `preservedLegacy`, `revision_id` ja `source_document_id`. Variantin nullability on suljettu CHECK: revision vaatii revision ja kieltää legacy-lähteen; legacyOriginal kieltää molemmat; preservedLegacy vaatii legacy-lähteen ja kieltää revision. Kaikki uudet sidokset ovat komposiittisesti yritys-/laskurajattuja. |
| `invoice_delivery_events` | Nykyiset kentät/ID:t säilyvät. Lisätään pysyvä `send_mode` = `customer`, `smtpTest`, `dryRun`, `manual` tai `legacyUnknown`; `binding_kind`, `revision_id` ja varauksen dokumenttihash/koko. Uusi tapahtuma vaatii dokumentin ja varianttinsa täsmäsidonnan. Vain migroitu legacyOriginal sallii alkuperäisen puuttuvan dokumenttiviitteen ja legacyUnknown-moodin. |

Komposiitti-FK:iden vanhempien avaimet luodaan ennen riippuvia inserttejä:
`invoices(company_id, id)`, revision `(company_id, invoice_id, id)`,
revision rivin `(company_id, invoice_id, revision_id, line_id)` ja
dokumentin `(company_id, invoice_id, id)` ovat eksplisiittisiä UNIQUE-avaimia.
Pelkkä globaali `id`-PK ei riitä SQLiteen monisarakkeisen FK:n vanhemmaksi.
Dokumentin varianttia/revisiota sisältäville täsmäviitteille määritetään
vastaavat omat unique-avaimet. Nullable revision ei saa poistaa erillistä
ei-nullable yritys-/lasku-/dokumenttiviitettä. Tämä oli rajatun riippumattoman
skeemakatselmuksen täsmennys; lopullinen SQL tarkistetaan vielä erikseen.

Nykyinen `invoice_lines.id` voi tulla samasta luonnosrivistä uudelleenhyväksyntään.
Siksi historian PK ei saa olla pelkkä nykyinen line-ID. Nykyistä source-line-
FK:ta ja hyvitysten kapasiteettilukijaa ei poisteta tai kohdisteta uuteen
nykytilan riviin. Uusi lähdesidos tarkistetaan erikseen revision kautta;
vapaan hyvitysrivin lähde-ID ja lähderevisio ovat molemmat null.

Vanhan sent-standardilaskun hyvityksen lähde voi olla eksplisiittinen
`legacySnapshot` säilyneestä nykytilasta. Nykyinen yritys-/standard-/sent-
kelpoisuus, aikaisemmat kohdistukset ja kumulatiivinen laskenta säilyvät.
Tämä ei nosta lähdettä varmennetuksi toimitusrevisioksi, varmista vanhaa
PDF:ää, salli uudelleenlähetystä tai ratkaise tuntematonta SMTP-moodia.
Dokumentin julkaisuun vaadittavaa alkuperärajausta ei siis kopioida
hyvityksen lähdekelpoisuudeksi. Lähderevision ja sen rivin täsmäsidos sekä
nykyinen laskentavalidointi todistetaan täydessä snapshot-testissä.

Snapshot-mapper on nimetty, eksplisiittinen kenttäluettelo. SQL:n `SELECT *`
tai koko API-olion serialisointi ei määrittele julkaistun sisällön sopimusta.
Nykyisen `InvoiceTable`-tyypin säilytettävät kenttäryhmät ovat:

- `source_draft_id`, `invoice_kind`, `credited_invoice_id`, `invoice_number`,
  `reference_number`, `reference_number_type`, `series_key`, `sequence_scope`,
  `sequence_number`, `numbering_mode`, `customer_id`, `billing_recipient_customer_id`.
- Kaikki nykyiset `customer_*_snapshot`, `company_*_snapshot` ja
  `billing_recipient_*_snapshot`-kentät. Ne kopioidaan hyväksynnän jo
  muodostamasta oliosta, ei uudella master-data-haulla revision kirjoituksessa.
- `invoice_date`, `due_date`, `payment_term_days`, `reminder_period_days`,
  `late_payment_interest_basis_points`, `price_input_mode`, `subject`,
  `order_number`, `note`, `delivery_address_text`, `refund_iban_snapshot`.
- `tax_treatment`, `tax_treatment_label_snapshot`, `tax_legal_basis_snapshot`,
  `performance_date`, `performance_period_start`, `performance_period_end`,
  `total_net_cents`, `total_vat_cents`, `total_gross_cents`, `created_at`, `approved_at`.
- Hyvityksen `credited_invoice_number_snapshot` ja
  `credited_invoice_date_snapshot` sekä `credited_revision_id` otetaan
  samasta tarkistetusta lähderevisiosta. Historia ei tee myöhempää elävää
  lähdelaskuliitosta PDF:ään. Legacy-kopio merkitsee vain migraatiossa
  säilyneen nykytilan; sillä ei todisteta aiempaa lähetyssisältöä.

ID- ja enumerointikentät, nullable-parit, positiiviset järjestysnumerot,
safe-integer-rahat ja määrärajat tarkistetaan sekä omistavassa mapperissa
että soveltuvissa DB-ehdoissa. Uuden normaalisti verollisen revision
ALV-ryhmien summan on vastattava loppusummia. Käännetyllä ALV:lla erittely
on tyhjä; sen sijaan vaaditaan nollavero ja yhtä suuret net-/gross-summat.
Standardin riviverojen summa ei kuitenkaan ole uusi vaatimus:
sen hyväksytty ryhmäpyöristys säilyy. Muuttumattoman sisällön kirjoitus
keskitetään rajattuun Invoicingin persistence-helperiin; maksu-, listaus- ja
toimitustilan kirjoittajat eivät saa sitä muuttaa.

Kenttäkatselmuksen mukaan nykyinen `InvoiceTable` jakautuu kahteen
identiteettikenttään, 64 sisältökenttään ja yllä nimettyihin 11 elävään
tilakenttään. Kaikki 18 `InvoiceLineTable`-kenttää säilytetään, myös
API-näkymästä puuttuva rivin `created_at`. Mapperin eksplisiittiselle
luettelolle lisätään kattavuustesti, jotta uusi tietokantakenttä ei jää
huomaamatta luokittelematta. Tietokannan null-viitteitä ei korvata API:n
tyhjillä merkkijonoilla. Uudelleenhyväksyntä säilyttää alkuperäisen laskun
`created_at`-ajan, mutta julkaisee uuden hyväksyntäajan ja rivisnapshotin.
Nykyinen reopen/reapprove koskee standardilaskua; tämä työ ei lisää
hyvityslaskulle uutta uudelleenhyväksyntäpolkua.

##### Snapshotin julkaisu ja legacy-kopion SQL-ehdotus

Täyden kenttäjoukon eristetty ehdotus käyttää **header-last-julkaisua**:
rivit ja ALV-erittely lisätään ensin, muuttumaton revision otsikkorivi
viimeisenä ja current-osoitin tämän jälkeen saman nykyisen
hyväksyntätransaktion sisällä. Lapsitaulujen tarkat yritys-/lasku-/revisio-
viitteet ovat paikallisesti `DEFERRABLE INITIALLY DEFERRED`. Ilman otsikkoa
keskeneräinen kokoelma ei voi sitoutua. Otsikon lisäyksessä tarkistetaan
lähderevisio, rivien verokäsittely ja alkuperän mukainen erittelyn valmius.
Otsikon olemassaolo estää myös myöhemmän uuden rivin tai ALV-ryhmän
lisäämisen, ei vain vanhan rivin päivitystä tai poistoa. Erillistä seal-
tilakenttää, yleistä julkaisupalvelua tai uutta globaalia pragmaa ei lisätä.

Uudet muuttumattomat snapshot-taulut sekä uudelleen muodostettavat
dokumentti-/tapahtumataulut määritellään `WITHOUT ROWID`. Tämä sulkee
piilotetun rowid-avaimen kautta tehtävän korvauskäskyn reitin. Se ei korvaa
eksplisiittisten PK-/UNIQUE-ristiriitojen lisäyssuojia. Kielteiset kokeet
toistivat piilotetun rowid-korvauksen sekä riveille ja ALV-ryhmille että
dokumentti- ja tapahtumahistorialle ennen tarkennusta. Nullable-parien
CHECK ei saa hyväksyä osittaista sidosta SQL:n UNKNOWN-tuloksen vuoksi.
Adapterit eivät käytä historian kirjoitukseen REPLACE-käskyjä.

Legacy-kopio nimeää kaikki 64 sisältökenttää ja 18 rivikenttää
eksplisiittisesti. Kenttäkattavuuskoe vertaa luetteloa nykyiseen skeemaan.
Kopio säilyttää alkuperäiset arvot ja nullit, myös rivien aikaleimat;
vanhaa ALV-erittelyä ei lasketa oletuksena uudelleen. Ehdotuksen
`vat_breakdown_state` erottaa `unavailable`-legacy-tiedon uuden revision
`authoritative`-erittelystä. Käännetyn ALV:n tunnetusti tyhjä erittely
kuuluu jälkimmäiseen, ei puuttuvaan tietoon.

Migraation väliaikainen lasku -> opaque revision-ID -kartta poistetaan
samassa transaktiossa. Standardilaskujen otsikot julkaistaan ennen
riippuvia hyvityksiä. Lähdenumero ja -päivämäärä sidotaan samaan yritykseen,
lähdelaskuun ja -revisioon; lähderivillisen hyvityksen kaikki rivit käyttävät
juuri otsikon lähderevisiota. Vanhan rivin puuttuva vanhempi keskeyttää
migraation eikä saa pudota huomaamatta sisäliitoksen ulkopuolelle.
`reopened_for_edit` ei saa current-osoitinta. Vanhan sisällön kopio ei
muuta laskua lähetyskelpoiseksi tai todista aikaisempaa toimitussisältöä.

Ehdotuksen kokeet kattavat täsmäsäilymisen, idempotentin migraatiokutsun,
kokonaisen migraation rollbackin myös metadatakirjoituksen virheessä,
orvoksi jäävän kokoelman commit-hylkäyksen, jälkikäteen lisättävät rivit,
korvauskäskyt, yritys-/lähderevisiorajat sekä normaalin ryhmäpyöristyksen
ja käännetyn ALV:n säilymisen. Suora SQL-koe ei korvaa omistavan mapperin
nykyistä laskentavalidointia, numerointi-/audit-transaktiota, lähetysvarausta,
todellisia PDF-tavuja tai B5:n palautustodistusta. Täydellinen snapshot-DDL
ja aiempi dokumentti-/tapahtumaehdotus ajettiin tässä yhdessä ennen
numeroitua toteutusta. Teknisen kokonaisuuden myöhempi katselmus ei
korvaa alla nimetyn tuotantomigraation omaa näyttöä.

Yhdistetty tarkennettu ehdotus läpäisi 102 kohdetestiä: 43 täyden snapshotin
ja 59 dokumentti-/tapahtumasidoksen testiä. Ei-tyhjä vanha dokumentti- ja
lähetyshistoria säilyi, ja uuden dokumentin/tapahtuman sisältösidos pysyi
vanhassa revisiossa current-osoittimen vaihdon jälkeen. Rajattu riippumaton
SQL-katselmus tarkensi käännetyn ALV:n nykyisten täsmätekstien ja net-
syöttötilan säilyttämistä sekä yritysrajatestin eristystä. Korjattu
yritysrajatesti käyttää olemassa olevaa vieraan yrityksen lähdettä ja
yhtenäistä lähdetuplea, jotta muu ristiriita ei peitä yritysrajan hylkäystä.
Näyttö ei ole oikean lähetysvarauksen, lopullisen mapperin tai koko V1:n
hyväksyntä. Kohdetesteissä ei käytetty oikeaa SMTP:tä tai käyttäjädataa.

**Numeroidun toteutuksen checkpoint:** työpuun
`039_add_invoice_content_revisions.sql` toteuttaa yllä olevan snapshotin,
legacy-kopion sekä dokumentti-/tapahtumasidosten muutoksen nykyisen
migraatiorunnerin transaktiossa. `schema.ts` nimeää sisällön eksplisiittisesti
ja vaatii uudet dokumentti-/tapahtumakentät. Nykyisen migraatiorunnerin ja
39 tiedoston manifestin 17 testiä läpäisivät; vanhan 038-prefiksin pääte
säilyy erikseen tarkistettuna.

Numeroidun SQL-tiedoston 111 regressiota ja nykyisen käynnistystilan
6 tarkistusta läpäisivät yhdessä 117/117. Kuusi rajattua testitiedostoa
käyttää oikeita muuttumattomia 001–038-tiedostoja ja uutta 039:ää nykyisen
runnerin kautta, ei valmistelun yksityistä SQL-ehdotusta. Näyttö kattaa
vanhojen kenttien ja viitteiden täsmäsäilymisen, idempotenssin, virheen
rollbackin, sisältö-/yritys-/lähderevisiorajat, muuttumattomuuden sekä
dokumentti-/tapahtumasidokset. Levyllä olevan synteettisen kannan
sulkeminen ja avaaminen uudelleen säilytti myös moniversioisen sisällön
ja sen suojat. Uuden lähetystapahtuman muutosyritykset kohdistetaan
nimenomaan uuteen riviin, jotta vanhan historian suoja ei peitä niiden
todistusta. Rajattu riippumaton SQL-/tyyppikatselmus ei löytänyt
korjattavaa. Tämä ei vielä ole sovelluksen hyväksyntä-, PDF-, lähetys-
tai paketoidun palautuspolun näyttö.

Nykyiset PDF- ja lähetystapahtuman kirjoittajat sekä yksi niiden vanha
testirivi eivät vielä tuota vaadittuja sidontakenttiä. Backendin
tyyppitarkistus hylkää tämän keskeneräisen sovituksen. Kenttiä ei tehdä
valinnaisiksi eikä legacy-alkuperää keksitä vanhalle kirjoittajalle.
Tyypityksessä jäi vain kolme näihin vanhoihin kirjoittajiin/testiriviin
kohdistuvaa virhettä, ei uusien migraatio- tai hyväksyntätestien virheitä.
Omistavien kirjoitus-/lukupolkujen ja vanhojen fixtureiden yhtenäinen
sovitus on vielä kesken; koko backend-sarjan aiempi läpäisy ei koske tätä
migraatiota sisältävää välitilaa.
Työpuun välitila ei ole itsenäinen julkaisu- tai merge-ehdokas.

**Tavallisen hyväksynnän kirjoituscheckpoint:**
`invoiceContentRevisionPersistenceRows.ts` mapittaa sisältö- ja rivikentät
eksplisiittisesti. `publishInvoiceApprovalRevision.ts` käyttää jo laskettua
ALV-erittelyä muuttamatta sen pyöristystä. `SqliteInvoiceApprovalRepository`
kutsuu kirjoittajaa nykyisen IMMEDIATE-transaktion sisällä sekä uudessa
hyväksynnässä että uudelleenhyväksynnässä. Rivit ja ALV-erittely kirjoitetaan
ennen kokoelman sulkevaa otsaketta, nykyrevisio vasta sen jälkeen.
Auditointi ja luonnoksen hyväksyntäsidos kuuluvat samaan transaktioon.

13 kohdetestiä läpäisivät ensimmäisellä ajolla oikealla 001–039-ketjulla.
Näyttö kattaa 64 sisältökentän ja kaikkien rivikenttien säilymisen,
elävien tila-/maksukenttien poissulun, nullit ja aikaleimat, net/gross-
ryhmäpyöristyksen, käännetyn ALV:n sekä yritysrajan ja tuplahyväksynnän.
Kuusi pakotettua virhettä todistivat uuden hyväksynnän ja uudelleenhyväksynnän
rollbackin revision, auditin ja luonnossidoksen kohdalla. PDF:ttömässä
uudelleenhyväksynnässä vanha revisio ja laskunumero säilyivät, uusi sisältö
sai uuden revision ja nykyrevisio-osoitin siirtyi siihen. Tiedostokannan
uudelleenavaus säilytti sitoutuneen sisällön; rinnakkainen yhteys ei saanut
kirjoituslukkoa snapshotin lukemisen aikana.

Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Tämä näyttö
ei kata hyvityksen kirjoittajaa, jonka erillinen näyttö on alla, eikä vielä
revision palauttamista sisäiselle PDF-kutsujalle, revision lukijaa,
PDF-/SMTP-historian säilyttävää reopenia, katalogia tai B5:n paketoitua
palautusta. Nykyisen hyväksynnän julkista vastausta ei ole laajennettu
teknisellä revision tunnisteella.

**Hyvityksen revisiosidonnan kirjoituscheckpoint:**
`readCreditInvoiceRevisionSource.ts` tarkistaa nykyisen yritys-/standard-/
sent-kelpoisuuden mutta lukee sisällön ja rivit muuttumattomasta
nykyrevisiosta. `SqliteInvoiceCreditApprovalRepository` säilyttää nykyisen
kumulatiivisen laskennan ja aiempien kohdistusten lukijan. Se julkaisee
hyvityksen revision samalla rajatulla kirjoittajalla samassa IMMEDIATE-
transaktiossa numeron, laskun, rivien, auditin ja luonnoslinkin kanssa.
Hyvityksen lähdelasku, lähderevisio, numero ja päiväys ovat samaa tuplea;
lähderivit sidotaan sen revision rivitunnisteisiin. Vapaalla rivillä
lähde-ID ja lähderevisio ovat null. Eläviä maksu-/tilakenttiä ei kopioida
sisältösnapshotiin. Puuttuva tai ristiriitainen lähderevisio hylätään,
eikä elävää sisältöä käytetä fallbackina.

24 uutta testiä ja kaikki 23 aiempaa hyvityshyväksynnän testiä läpäisivät
yhdessä 47/47. Ensiajon kaksi hylkäystä olivat uusien kielteisten testien
lähtöaineiston CHECK-ristiriitoja ennen varsinaista kutsua; aineiston
korjauksen jälkeen kaikki tapaukset suoritettiin. Testejä tai tietokannan
ehtoja ei poistettu. Näyttö kattaa täydet sisältö-/rivikentät, modernin ja
oikealla 038→039-ketjulla muodostetun legacy-lähteen, saman line-ID:n eri
revision, net/gross-ryhmäpyöristyksen, käännetyn ALV:n, yritys-/lasku-/
revisiorajat sekä revision, auditin ja luonnoslinkin virheiden rollbackin.
Lähteen elävän sisällön muuttaminen luonnoksen jälkeen ei muuttanut
hyvityksen käyttämää snapshotia. Duplikaatti- ja kapasiteettirajat säilyivät;
legacy-toimitushistoriaa tai sen alkuperää ei muutettu.

Nykyisen application-/HTTP-ketjun 19 sopimustestiä läpäisivät erikseen;
niiden porttikorvikkeet eivät todista koko uutta ajonaikaista ketjua.
Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Lopullisessa
tyypityksessä säilyivät vain yllä nimetyt kolme PDF-/tapahtumakirjoittajien
puutetta, ei uusia hyvityskoodin tai sen testien virheitä. Täsmärevision
lukijan ja hyväksynnän sisäisen paluuarvon myöhempi näyttö on alla;
varsinainen PDF-kytkentä on vielä avoinna.
Osittaista sovitusta ei julkaista eikä puuttuvaa migraatiota kierretä
vanhan kirjoitustavan fallbackilla.

**Täsmärevision lukijan checkpoint:**
`InvoiceContentRevision` ja sen kapea reader-portti erottavat tallennetun
sisällön elävästä laskunäkymästä. SQLite-adapteri lukee pointerin, otsakkeen,
rivit, ALV-erittelyn ja hyvityksen lähdesidokset samassa lukutransaktiossa.
Yritys-/lasku-/revisioavain on täsmällinen; vanhan revision tilalle ei valita
uusinta. Puuttuva scoped-kohde palauttaa undefined, rikkinäinen ei-null-viite
tai sisältö turvallisen `InvoiceContentRevisionIntegrityError`-virheen.
Lukija ei kirjoita, laske summia uudelleen tai käytä elävää master dataa.
Legacy-snapshotin unavailable-erittely säilyy nullina, ei tyhjänä
authoritative-erittelynä.

97/97 kohdetestiä läpäisivät ensimmäisellä ajolla. Ne kattavat kaikki 64
sisältökenttää ja 18 alkuperäistä rivikenttää, lisätyt lähderevisiosidokset,
nullit, net/gross-ryhmäpyöristyksen, käännetyn ALV:n, legacy-summien säilymisen,
yritys-/lasku-/revisiorajat, rikkinäiset viitteet ja arvorajat. Vanha sisältö
säilyi uudelleenhyväksynnän ja oikean tiedostokannan uudelleenavauksen yli;
palautetun olion muokkaus ei muuttanut kantaa tai seuraavaa lukua.
Reopen-testin pointerin poisto on lukijasopimuksen testijärjestely, ei vielä
todiste tulevasta PDF-/SMTP-historian säilyttävästä reopen-käyttöpolusta.

Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Lopullinen
tyyppitarkistus hylkää edelleen yllä nimetyt kolme vanhaa dokumentti-/
tapahtumakirjoittajien kohtaa, ei uusia lukijan tai sen testien virheitä.
Portti on vielä sisäinen perusta: oikeat PDF-/HTTP-/diagnostiikkakytkennät,
backup-katalogi ja B5:n palautusnäyttö ovat avoinna. Lukija ei itsessään
myönnä katselu- tai lähetysoikeutta eikä luo uutta audit- tai lokijärjestelmää.

**Hyväksynnän sisäisen revisioavaimen checkpoint:**
tavallinen hyväksyntä, uudelleenhyväksyntä ja hyvityshyväksyntä palauttavat
samassa transaktiossa julkaistun revision yritys-/lasku-/revisioavaimen.
Uudelleenhyväksyntä palauttaa alkuperäisen lasku-ID:n, ei kutsun uuden
laskun ID-ehdokasta. Aiempi paluuarvo säilyy sidottuna vanhaan revisioon.
Application välittää avaimen sisäisesti; HTTP-adapterin eksplisiittinen
kenttälista säilyttää vanhan julkisen vastauksen ilman avainta tai muita
sisäisiä lisäkenttiä. Asiakas ei saa valita revisiota hyväksyntäpyynnössä.

Seitsemän application-/HTTP-/SQLite-testitiedoston 132 kohdetestiä
läpäisivät ensimmäisellä ajolla. Näyttö sisältää oikean hyväksynnän ja
uudelleenhyväksynnän avaimen, nykyiset rollback- ja numerointitarkistukset,
hyvityksen lähdesidonnan sekä vastauksen tietovuotosuojan ja syötteen eston.
Koko backendin tyypitys ei vielä läpäise: samat kolme keskeneräistä
dokumentti-/tapahtumakirjoittajien kohtaa säilyvät, uusia tämän palan
tyypitysvirheitä ei löytynyt. Oikea hyväksynnän PDF-hook, ehdollinen
dokumenttijulkaisu, toimitusketju ja B5 eivät kuulu tämän osatodisteen
hyväksyntään. Ei uutta HTTP-pintaa, audit-tapahtumaa, riippuvuutta tai
muutosta käyttöoikeuksiin, numerointiin, laskentaan tai testivaatimuksiin.
Rajattu riippumaton tämän palan tuotantokatselmus ei löytänyt korjattavaa;
se ei hyväksy vielä avoinna olevaa PDF-/toimituskytkentää.

**PDF-sisällön checkpoint:** `ApprovedInvoicePdfContent` rajaa rendererin
nykyisiin snapshot-/rivi-/summakenttiin ilman elävää status-, maksu- tai
peruutustilaa. `toInvoiceRevisionPdfContent` muuntaa lukijan validoiman
authoritative-revision eksplisiittisesti, kopioi alirakenteet ja säilyttää
tallennetut summat sekä hyvityksen lähdenumeron ja -päivän. Muunnos ei
laske ALV:tä uudelleen, hae master dataa tai myönnä julkaisuvaltuutta.
Kelvollinen legacySnapshot/unavailable tuottaa erillisen
`InvoiceRevisionPdfContentUnavailableError`-virheen; sitä ei nimetä
rikkinäiseksi historiaksi eikä korvata tyhjällä erittelyllä. Aidosti
ristiriitainen lähdevariantti on eheysvirhe.

Rendererin ja piirto-osioiden muutos koskee vain tyyppejä. Ulkoasu, tekstit,
muotoilu ja byte-paluu säilyvät. Muuntimen 24, oikean revision-rendererin
5 ja nykyisen rendererin 10 testiä läpäisivät. Uusi PDF-todiste tarkistaa
oikean rendererin tekstikutsut ja syntyvän PDF-rakenteen, ei vielä
tallennettua dokumenttia, koko käyttöpolkua tai visuaalista katselmusta.
Ensimmäinen yhdistetty tyypitys löysi kahden vanhan testifixturen
kontekstuaalisen tyyppipuutteen. Ne korjattiin nimetyillä tyypitetyillä
arvoilla muuttamatta dataa tai odotuksia. Uudet tyypitysvirheet poistuivat;
kolme aiempaa dokumentti-/tapahtumakirjoittajien kohtaa ovat edelleen auki.

Hyväksyntäavaimen ja PDF-sisällön yhdistetyt 171 kohdetestiä läpäisivät.
PDF-sisällön, muuntimen ja rendererin tyyppirajan riippumaton katselmus ei
löytänyt korjattavaa. Se ei ole tallennusketjun tai visuaalisen PDF:n hyväksyntä.
Seuraava työ on nykyisen generaattorin, revisiolukijan, PDF-hookin ja
ehdollisen tiedosto-/metadatajulkaisun yhtenäinen kytkentä. Pelkkä kapeampi
renderer-tyyppi ei poista vanhan generoijan race-/cache-/poistoriskejä.
Reopen, lähetyshistoria, backup-katalogi ja B5:n palautustodistus pysyvät
avoimina; osittaista toteutusta ei julkaista.

**Dokumenttijulkaisun rajattu toteutus:** dokumentin sisäinen tyyppi erottaa
revision, säilytetyn legacy-kopion ja vain luettavan alkuperäisen legacy-
rivin. `InvoiceDocumentRepository` tarjoaa tarkan revision ja dokumentti-ID:n
luvut sekä kaksi erillistä ehdollista julkaisuoperaatiota. Vanhat yleinen
tallennus ja laskukohtainen massapoisto on poistettu tästä portista ja sen
SQLite-adapterista; käyttöpolkujen ja fake-porttien yhtenäinen sovitus on
vielä kesken eikä työpuun tyypitys läpäise.

Revision julkaisu tarkistaa samassa `immediate`-transaktiossa yritys-/lasku-
rajan, nykyrevision, sallitun alkuperän sekä approved/sent-tilan. Tarkistus
edeltää myös aiemman dokumentin palautusta. Säilytetty kopio vaatii sent-tilan,
täsmällisen legacyOriginal-lähteen sekä samat hash/koko-arvot; nykyinen kaikkia
providereita koskeva attempted/outcomeUnknown-esto säilyy. Kumpikaan operaatio
ei korvaa tai poista historiaa. Ne eivät yksin myönnä SMTP-lupaa tai ratkaise
legacy-tapahtumaketjun yksiselitteisyyttä, vanhaa failed/R12-havaintoa tai
silloin avointa approved/SMTP-päätöstä (hyväksytty rajaus yllä 6.10.2026).

Uuden ehdokkaan suhteellinen tiedostopolku kuuluu sen omaan dokumentti-ID:hen.
Omistava tiedostopolitiikka keskittää polun muodostuksen ja nykyisen 10 MiB:n
rajan; uuden metadatan hash, koko ja polku tarkistetaan. Tämä metadatatarkistus
ei vielä todista tiedoston olemassaoloa, exclusive-kirjoitusta tai todellisten
tavujen vastaavuutta. Alla oleva tiedostotallennuksen checkpoint todentaa
näitä erikseen; varsinainen generaattorikytkentä on vielä kesken.

Julkaisuadapterin 42, säilytetyn legacy-dokumentin 23 ja polkusäännön 9
testiä läpäisivät. Näyttö kattaa tarkat sidokset, vanhentuneen julkaisun
eston, nykykelpoisuuden tarkistuksen ennen aiemman voittajan palautusta,
rollbackin, kahden tietokantayhteyden lukituksen sekä tiedostokannan
uudelleenavauksen. Legacy-testin tietokantakopio ei korvaa sovelluksen
backup-/palautus- tai native-todistusta. Todellisia PDF-tavuja ei tässä
adapterikokeessa kirjoiteta tai lueta.

PDF-metadatan molemmat HTTP-vastaukset palauttavat eksplisiittisesti vain
aiemmat julkiset kentät; sisäinen sidos tai ylimääräiset kentät eivät vuoda
vastaukseen. Reittien 10 testiä ja edellä mainitut 74 testiä läpäisivät
yhdessä, yhteensä 84/84. Rajatut repository- ja HTTP-katselmukset eivät
löytäneet korjattavaa. Tyypitys hylkää edelleen vanhat generaattori-/
lukijakutsut ja niiden testikorvikkeet sekä keskeneräisen tapahtumakirjoittajan;
uudet adapteri-, HTTP- ja testitiedostot eivät lisänneet tyypitysvirheitä.
Tämä ei ole koko B3/B4-ketjun hyväksyntä.

**Tiedostotallennuksen rajattu checkpoint:** `InvoiceDocumentStorage`
korvaa vapaan polun write/read/delete-operaatiot kahdella nimetyn vastuun
operaatiolla. `writeCandidate` muodostaa oman dokumentti-ID-polun, kopioi
kutsujan tavut ennen ensimmäistä odotusta ja kirjoittaa exclusive-tilassa.
Paluuarvossa ovat varmennetut polku/koko/tiiviste sekä vain tämän ehdokkaan
`discard`-sulku. Sovellus saa kutsua sitä vain todetusti julkaisemattomalle
ehdokkaalle, ei julkaistulle dokumentille tai epävarman julkaisun jälkeen.
`readVerifiedDocument` lukee metadataa vastaan enimmäiskoon rajaaman
yhden puskurin: tavallinen yksilinkkinen tiedosto, polun sisältävyys,
PDF-tunniste, koko ja SHA-256 vaaditaan. Tarkistus ei ole PDF-parseri tai
allekirjoitus eikä anna toimitusvaltuutta.

Polku- ja tavutarkistukset pysyvät Invoicingin infrastructure-kerroksessa;
portti ei tunne Node-tiedostokahvoja. Siivoussulku tarkistaa oman alkuperäisen
tiedostoidentiteetin ja tavut, eikä tarjoa mielivaltaisen polun poistoa.
Epävarma tai osittainen kirjoitus säilytetään, sitä ei arvata poistettavaksi.
Tiedostotallennuksen 73 kohdetestiä läpäisivät: exclusive-törmäys,
erilliset kirjoittajat, toistettu ja samanaikainen siivous, korvattu tiedosto,
caller-puskurin eristys, tarkka legacy-polku, kokorajat, virheelliset tavut,
symboliset linkit, junctionit, hardlinkit ja hallitut identiteetin vaihdot.
Ensiajon kaksi testijärjestelypuutetta korjattiin muuttamatta tuotantokoodia,
aikarajoja tai hyväksyntäehtoja; alkuperäinen tulos säilytettiin.
Rajattu riippumaton tuotantokatselmus ei löytänyt korjattavaa. Uudessa
tallennuksessa tai sen testeissä ei ole tyyppivirheitä. Backendin tyypitys
hylkää edelleen vanhat sovittamattomat kutsujat ja tapahtumakirjoittajan;
tämä ei ole koko sovelluksen, toimituspolun tai palautuksen hyväksyntä.
Generaattorin jatkokytkentä kuvataan seuraavassa checkpointissa. Lukijoiden
ja reopenin vanhat kutsut sovitetaan tämän jälkeen;
keskeneräistä työpuuta ei julkaista. Katalogi- ja native-palautustodistus
kuuluvat edelleen B5:een.

**Generaattorin ja hyväksyntäkoukkujen rajattu checkpoint:**
`generateInvoiceRevisionPdfDocument` käyttää tarkkaa revisioavainta,
muuttumatonta sisältöä ja tallennusportin todellista tavunäyttöä. Tavallisen
laskun ja hyvityksen production-composition välittävät juuri hyväksytyn
revision; myöhäinen työ ei vaihda kohteekseen uudempaa revisiota.
Manuaalisen generoinnin nykyavaimen valinta käyttää samaa täsmäpolkua.
Ehdollinen julkaisu joko omistaa oman ehdokkaan, palauttaa varmennetun
voittajan tai hylkää vanhentuneen työn. Vain oma varmasti julkaisematon
ehdokas siivotaan; heitetty julkaisupoikkeus säilyttää epävarman aineiston.

Välimuistin tarkistus ei käytä kirjoittavaa julkaisua: uusi kapea
`findCurrentDocumentForRevision` lukee samassa lukutransaktiossa kelpoisuuden
ja dokumentin. Historiallinen `findDocumentForRevision` säilyy erillisenä.
Puuttuvaa tai rikkinäistä PDF:ää ei regeneroida. Julkaisuristiriita palautuu
POST-reitiltä turvallisena 409-virheenä; sisäinen siivoustieto ei tule
HTTP-vastaukseen. Ensisijainen ristiriita ja mahdollinen ehdokkaan
siivousvirhe kirjautuvat nykyisen turvallisen PDF-virheen eri vaiheina.
Jo onnistunut laskuhyväksyntä ei peruunnu PDF-virheeseen.

Generaattorin 50 yksikkötestiä, tietokanta-/tiedosto-/hyvitys-/HTTP-polkujen
91 testiä, oikean hyväksyntä-/PDF-/lokitus-compositionin 7 testiä sekä
nykyisten diagnostiikka-/tukipaketti-/incident-lukijoiden 58 testiä läpäisivät
myös yhdistetyssä lopputarkistuksessa, yhteensä 206/206.
Testijärjestelyjen tavupuskurivertailu, vastauskenttä,
kaksinkertainen lähdeluonnos ja puuttuva nykyinen hyvitysoikeus korjattiin;
ensitulokset säilytettiin eikä tuotannon ehtoja lievennetty.
Riippumaton rajattu tuotantokatselmus ei löytänyt korjattavaa.
Tämän checkpointin tyypitys hylkäsi vielä vanhat PDF-lukijat, reopen-kutsujat,
niiden korvikkeet ja tapahtumakirjoittajan. Lukijoiden jatko kuvataan alla;
tämä ei ole koko B3/B4:n, toimitusten, B5:n tai julkaisun hyväksyntä.

**Nykyisen PDF:n lukuketjun rajattu checkpoint:**
`InvoiceDocumentPreviewReader` valitsee vain yritys-/laskurajatun nykyisen
esikatseludokumentin. Täsmädokumentin `readStoredInvoiceDocument` tarkistaa
metadatan identiteetin ja tallennusportin todelliset tavut; se ei valitse
uusinta versiota eikä anna lähetysvaltuutta. GET ja metadata käyttävät samaa
ketjua ja tarkistavat valinnan uudelleen tavulukemisen jälkeen. Vaihtunut
valinta tuottaa 409:n ilman automaattista uudelleenhakua. Puuttuva valinta
on 404, mutta rikkinäinen valittu viite tai PDF on erillinen eheysvirhe.
Lukeminen ei generoi, korjaa, poista eikä julkaise mitään.

`approved`, `sent` ja `cancelled` säilyttävät esikatselun; reopened-laskun
nykyesikatselu irrotetaan. Eksplisiittinen `legacySnapshot/unavailable`
voi näyttää alkuperäisen legacy-PDF:n ilman jälkikäteistä revisioväitettä.
Säilytettyä toimituskopiota ei valita alkuperäisen sijasta. Uuden revision
puuttuva PDF ei palaudu vanhaan revisioon tai legacy-alkuperäiseen.
Saman dokumentti-ID:n jälkitarkistus perustuu metadatan ja sidoksen
muuttumattomiin SQL-suojiin. Historiallinen tarkka luku ei vaadi nykyistä
kelpoisuutta; tapahtumavalinnan backend-kytkentä on kuvattu seuraavassa
checkpointissa, UI-/native-kytkentä on edelleen jatkotyötä.

Eheysvirhe kytkettiin olemassa olevaan `invoicePdf.storageFailed`-eventtiin
koodilla `INVOICE_PDF_INTEGRITY_FAILED`, vaiheella `read` ja ilman
sivuvaikutusta. Todellinen composition -> lokitiedosto -> Diagnostics ->
tukipaketin lukija / incident-yhteenveto on kohdetodennettu. Projektioissa
ei ole yritys-, lasku- tai dokumenttitunnisteita, PDF-tavuja, tiivisteitä,
polkuja tai raakavirhettä. Lokittajan virhe ei korvaa alkuperäistä virhettä.
Business Activityyn ei tehdä tapahtumaa pelkästä teknisestä lukemisesta.

Nykyisen ja legacy-PDF:n luku, rikkoutunut nykyosoitin, yritysraja,
muuttunut valinta, metadatan ja tiedostojen säilyminen sekä tietokannan
uudelleenavaus läpäisivät oikean SQLite-/tiedostokokeen. Generoinnin,
hyväksyntäkoukkujen, HTTP:n ja diagnostiikan kanssa lopputulos on 269/269.
Uuden testin tavupuskuriodotus ja unionin tyypitys korjattiin; ensitulokset
säilytettiin eikä tarkistusvaatimuksia lievennetty. Riippumaton rajattu
lukuketjun, sen testien ja diagnostiikkakytkennän katselmus ei löytänyt
korjattavaa tai olennaista testivajetta. Koko backendin
tyypitys ei vielä läpäise: kuusi virhettä on vanhassa reopen-kutsuketjussa
ja toimitustapahtuman kirjoittajassa/fixturessa. Tämä checkpoint ei sulje
B3/B4:ää, native-palautusnäyttöä eikä integraatiota.

**Tapahtumaan sidotun PDF-historian backend-checkpoint:**
`InvoiceDeliveryEventReader.findEventDocument` lukee tapahtuman ja tarkan
dokumenttisidoksen samassa SQLite-lukutransaktiossa. Dokumentin nykyinen
metadatan ja lähdeviitteen validointi on yhteinen täsmädokumenttiluvun kanssa.
Revision, sidontatyypin, tallennetun koon tai tiivisteen ristiriita torjutaan
ennen tiedoston lukemista. `legacyMissingDocument` on vain alkuperäisen
legacy-tapahtuman null-viite; katkennut ei-null-viite on eheysvirhe.
Luku ei muuta tapahtumaa, valitse nykyistä PDF:ää tai anna lähetysvaltuutta.

`getInvoiceDeliveryEventPdf` vaatii nykyisen `sendInvoices`-oikeuden ja käyttää
backendin vahvistamaa yrityskontekstia. GET
`/invoices/:id/delivery-events/:eventId/pdf` palauttaa tarkistetut tavut,
puuttuva tapahtuma 404:n, historiallinen null 409:n ja rikkinäinen sidos tai
tiedosto turvallisen 500:n. Vastaus ei palauta tallennuspolkua, raakavirhettä
tai sisäistä metadataa; PDF-vastaus on `no-store`. Historiallinen lukupolku
säilyttää alkuperän eikä väitä vanhan SMTP-toimituksen sisältöä varmaksi.
`listInvoiceDeliveryEvents` käyttää yritysrajattua laskuidentiteettiä myös
reopened-tilassa; yleisen approved-lukijan kelpoisuutta ei laajennettu.

Kohdetodisteet kattavat oikean SQLite-/tiedostopolun, legacy-migraation,
muuttumattomat vanhat sidokset, eri tavuisen uuden PDF:n julkaisun kesken
lukemisen, yritys-/lasku-/tapahtumarajan, tietokannan uudelleenavauksen sekä
todellisen HTTP/composition -> loki -> Diagnostics/tukilukijat-ketjun.
Yhdistetty lopputarkistus läpäisi 359/359 testiä. Riippumaton katselmus ei
löytänyt tuotantovikaa; sen havaitsema eri tavujen kilpailutestin puute
täydennettiin ennen loppuajoa. Uusien fixtureiden kaksi tyypitysvirhettä
korjattiin ja ensitulokset säilytettiin. Jäljellä ovat samat kuusi
keskeneräisen reopen-/tapahtumakirjoittajan tyypitysvirhettä.

Tämä aiempi checkpoint todisti historian backend-lukuosan. Silloin avoimia
varaus- ja reopen-osia tarkentaa alempi checkpoint; client/UI/native-luvun
nykyinen näyttö on seuraavassa osassa. Katalogi-/backup-/restart-ketju on
edelleen avoin. [Testimatriisin historiatapaukset](r0-e2e-test-matrix.md#invoicing)
eivät muutu kokonaan hyväksytyiksi alemman tason näytön perusteella.

### B4-historian käyttöpolun checkpoint

Historian turvallinen projektio erottaa tallennetun lähetysmoodin ja PDF:n
alkuperän. Ristiriitaiset yhdistelmät hylätään; alkuperäiselle legacy-nullille
ei näytetä avauspainiketta. Client, web ja desktop avaavat vain tapahtumaan
sidotun GET-kohteen. Luku ei regeneroi, lähetä tai anna lähetysvaltuutta.
Native-kutsun epäonnistuminen ei siirry selaimen varapolulle.

Testi-/dry-run-toimituksen jälkeen historia päivittyy myös muuttumattomassa
laskutilassa. Laskun ja historian luku sidotaan näkymän valintaan ja
pyyntösukupolveen: myöhäinen vastaus ei korvaa uutta valintaa. Todennetut
vanhan detail-vastauksen sekä StrictMode-aloituksen puutteet korjattiin.
Onnistunut kirjoitus päivittää yhteisen listan, vaikka valinta olisi jo
vaihtunut; vain valintakohtainen vastaus ohitetaan.

Kaksi oikean selaimen testiä todentaa itselle-testin historian, muokkauksen
jälkeiset uudet PDF-tavut, vanhan tapahtuman samat tavut, popupin virheen,
vanhentuneen laskuvastauksen sekä asiakaskortista avaamisen. Erillinen
development-Electron-koe todentaa renderer/main/backend-ketjun, historiallisen
PDF-ikkunan eristyksen ja sulkemisen. Sen aineisto valmistellaan API:n ja
synteettisen SMTP-providerin avulla; se ei ole aidon SMTP:n, legacy-ketjun
tai paketoidun palautuksen todistus. Ensimmäisen native-kokeen testiapuri
tunnisti vain nykyisen PDF:n URL:n, vaikka historiallinen PDF renderöityi.
Apuri käyttää nyt tuotannon kolmea täsmällistä PDF-kohdetta havaintoon ja
sulkemiseen; sallintaa tai aikarajoja ei laajennettu.

Lopullinen kohdenäyttö: laskutus/composition 1 795, koko web 939, desktopin
PDF/protokolla/testiapuri 160 ja clientin kohdesarja 80 testiä läpäisivät.
Selain- ja Electron-kokeet läpäisivät nimettyjen korjausten jälkeen ilman
uusintoja. Kapean ja työpöytänäkymän asettelu tarkistettiin kuvista ja
leveysväitteillä; taulukon vieritys pysyy omassa alueessaan. Riippumaton
rajattu katselmus valmistui. Ensihylkäykset säilyvät omana näyttönään.

Reopened-editorin historia käyttää nyt backendin vahvistamaa yhteyttä
luonnoksesta laskuidentiteettiin; sitä ei päätellä ID:n muodosta tai
käyttöliittymän muistista. Alla oleva jatkotodennus kattaa myös editorin.
Legacy-resendin native-polku on todennettu alla; B5, paketoitu palautus ja
PR/main-portit ovat avoinna.

### B4-legacy-uudelleenlähetyksen checkpoint

Synteettinen 038-profiili sisältää vanhan sent-laskun, alkuperäisen PDF:n ja
SMTP-tapahtuman ilman arvattua lähetysmoodia tai revisiota. Development-
Electronin oikea startup ajaa 039-migraation. Käyttäjä avaa laskun,
valmistelee säilytetyn liitteen, tarkistaa sen native-PDF-ikkunassa ja
hyväksyy tai peruuttaa erillisen vahvistuksen. Vain SMTP-provider ja
käyttöjärjestelmän dialogivastaus ovat testisovittimia.

`DESK-LEGACY-RESEND-001/002` läpäisivät ilman uusintaa: hyväksyntä tekee
yhden lähetyksen ja tapahtuman täsmälleen valittuun säilytettyyn dokumenttiin;
peruutus ei lähetä eikä muuta historiaa. Molemmat polut säilyttävät laskun,
alkuperäisen tapahtuman ja PDF-tavut restartin yli. Tapahtuman pysyvä
dokumentti-/alkuperäsidonta tarkistetaan erikseen vain lukevalla kyselyllä;
public history -projektioon ei lisätä tätä varten kenttiä.

Koe paljasti tuotannon palautepuutteen: desktopin oma turvallinen virhe
käytti `message`-kenttää yhteisen clientin vaatiman `error`-kentän sijasta.
Native-peruutus palauttaa nyt nykyisen HTTP-virhesopimuksen mukaisen viestin.
Tokenia ei luovuteta peruutuksessa eikä raakaa poikkeusta välitetä UI:hin.
Backendin vastaukset kulkevat edelleen muuttumattomina.

Rajatut protokollatestit (34), tietokannan valmistelun sulkutestit (2),
legacy-/lifecycle-sopimustestit (44), koko työpuun tyypitys ja kanoninen
Electron-valmistelu läpäisivät. Myös normaalirevision kaksi native-
vahvistustestiä läpäisivät virhevastauksen korjauksen jälkeen.
Riippumaton katselmus valmistui. Testin
valmistelu sulkee tietokannan virheessä ja säilyttää juuren sekä suljetun
valmisteluvaiheen nykyisessä lifecycle-liitteessä. Ensimmäiset testiaineiston,
projektion ja virhepalautteen hylkäykset säilyvät erillään korjausnäytöstä.

Seuraava työ on B5:n katalogi-, vanhan backupin migraatio- ja hardened
packaged backup/restore/restart/compare -näyttö. Tämä checkpoint ei hyväksy
koko B3/B4/B5-kokonaisuutta tai korvaa vaadittuja PR/main-portteja.

### B5-katalogin ja palautuksen checkpoint

B5:n katalogin valinta ja palautuksen kytkentä ovat työpuussa toteutettuja,
eivät enää pelkkä valmisteluehdotus. Katalogin skeema valitaan tarkistetusta
sovelletusta migraatiohistoriasta. Puuttuva sarake tai SQL-virhe ei salli
legacy-fallbackia. Invoicing tarkistaa myös PDF:tä vailla olevien revisioiden
sekä current/source/document/event-viitteiden eheyden ja luetteloi kaikki
säilytettävät PDF:t. Catalog-v1 ja portable-container säilyvät ennallaan.

Snapshot-katalogi kootaan laiskasti myös ennen migraatioita ja tyhjälle
kannalle. Valinta tehdään maintenance-rajan sisällä samalla ratkaistulla
migraatiohakemistolla kuin runner, myös oletushakemistoa käytettäessä.
Sisäiset tarkistetut migraationimet eivät vuoda strict-startup-viestiin tai
backup-manifestiin. Aktiivisen profiilin historiatarkistus edeltää katalogia.

Workspace candidate tarkistaa lähteen alkuperäisen katalogin ja PDF-tavut
ennen forward-migraatiota. Migraation jälkeen verrataan edelleen samaan
katalogiin ennen yhdenkään PDF:n materiaalistamista. Synteettinen ei-tyhjä
038-profiili on todennettu sekä metadatan kanssa että hyväksytyllä kiinteällä
metadataa vailla olevalla legacy-ankkurilla. Tietokannan uudelleenavaus
säilyttää laskut, rivit, alkuperäiset dokumenttisidokset ja PDF-tavut.

Rajattu nykyinen näyttö:

- Backendin laaja regressio läpäisi 2 730 testiä; viisi alustakohtaista
  ohitusta erotetaan läpäisyistä. Myöhempi oletushakemistokytkennän
  seitsemän testin regressio läpäisi erikseen.
- Workspace-tuonnin ja korvauksen viisi system-API-testiä läpäisivät.
  Testiapurit välittävät tarkistetun skeeman eksplisiittisesti.
- Candidate-operaation sarja läpäisi 30 testiä, yksi alustakohtainen ohitus.
  Se kattaa väärän katalogimäärän, rakenteeltaan kelvollisen väärän source-
  tai restore-viitteen sekä muuttuneen/puuttuvan PDF:n ennen ja jälkeen
  migraation. Kahden PDF:n ehjä kontrolli läpäisee; jälkimmäisen PDF:n virhe
  jättää kohteen tyhjäksi ja tietokannan muuttumattomaksi.
- Katalogin tuotantokytkentä ja rajatut testit on katselmoitu erikseen.
  Ensihylkäykset säilyvät erillään korjauksen jälkeen saadusta näytöstä.

Nykyiseen PDF-smoke-valmisteluun lisätty moniversioinen ketju on todennettu
hardened Windows -kehityspaketilla: saman laskun ensimmäinen PDF ja
verkoton dry-run-tapahtuma, muokkaus ja uudelleenhyväksyntä sekä toinen PDF.
Laskuidentiteetti ja numero säilyivät, PDF:t erosivat ja vanhan tapahtuman
PDF vastasi alkuperäistä. Backup -> inspect -> restore -> restart -> compare
läpäisi nykyisen kannan ja kaikkien katalogiartifaktien tarkan vertailun.
Valmistelun ja palautustilan 13 kohdetestiä sekä desktop-tyypitys läpäisivät.
Tämä ei ole oikean SMTP:n eikä vanhan 038-aineiston paketoitu todiste.

Paketoinnin alkuperäinen sovellusosan kokohylkäys säilytetään erillisenä
ensituloksena. Omistajan hyväksymä vain tämän osan 2,25 MiB:n kokobudjetti
on kuvattu [paketointisopimuksessa](windows-installer-and-update-plan.md#production-profile-and-packaging-cleanliness--checkpoint).
Inventaarion 43 ja paketointiketjun/virhetodisteiden 18 testiä läpäisivät.
Riippumaton rajattu katselmus ei löytänyt korjattavaa; uusi kehityspaketointi
läpäisi sisältöinventaarion ja nykyiset runtime-/kovennustarkistukset.

**Avoin hyväksyntä:** puhtaan revision uusi pakettisisällön baseline,
release-todennus, paketoidun legacy-testin CI-ajokytkentä,
koko B3-B5:n loppukatselmus ja uuden revision PR/main-portit.
Kehityspaketin läpäisy ei korvaa puhtaan releasekandidaatin näyttöä.

Legacy-paketointikokeen syötteelle on erillinen valmis sopimustodiste:
E2E:n olemassa oleva synteettinen 038-laskuprofiili kirjoitetaan nykyisellä
snapshot/container-ketjulla salatuksi varmuuskopioksi. Autentikointi ja
purku todistavat, ettei kantaa ole migroitu valmistelussa, ja että vanha
lähetysmerkintä sekä alkuperäisen PDF:n tavut ovat mukana. Kaksi uutta
valmistelijan ja kolme aiempaa profiilifixturen testiä sekä E2E-tyypitys
läpäisivät. Myös nykyisen workspace-tuonnin ja korvauksen viisi
system-testiä läpäisivät saman apurin nykyisellä oletuksella. Rajattu
riippumaton katselmus ei löytänyt muutoksesta korjattavaa. Väärä salasana
ja puuttuva E2E-merkki hylätään; tavallinen
backup-apuri vaatii edelleen nykyisen skeeman ilman erillistä historiallista
valintaa. Tämä ei käynnistä eikä hyväksy paketoitua legacy-palautusta.

Paketoitu jatko käyttää nykyistä workspace-managementin migraatio- ja
palautusketjua. Pelkkä backupin staging ei migroi kantaa, eikä uuden
työtilan tuonti yksin korvaa saman lineagen korvaus-/palautusnäyttöä.
Koefixturen suljetun lähdekannan valmistelu käyttää vain kolmea itsenäistä
tiedostokopiota uudessa packaged-smoke-juuressa: kanta, alkuperäinen PDF ja
salattu varmuuskopio. Kolme valmistelun sopimustestiä ja viisi aiempaa
legacy-fixturen testiä läpäisivät. Kohdekannan migraatio ei muuta lähteen
038-skeemaa; käytetty tai linkitetty kohde ei ylikirjoitu. Valmistelu ei
kirjoita workspace-rekisteriä käsin tai anna desktopille SQLite-ajurin
omistajuutta. Valmistelutesti yksin ei ole paketoidun palautuksen näyttö.
Uudelleenkäynnistys on todellinen prosessiraja: palautuksen tulosta ei
päätellä relaunch-pyynnön jälkeisestä muistissa olevasta onnistumisesta.

**Paketoitu legacy-jatko:** erillinen nykyistä smoke-ajuria käyttävä koe
läpäisi hardened Windows -kehityspaketilla. Aito 038-backup tarkistettiin ja
palautettiin saman lineagen workspace-management-ketjulla. Seuraava prosessi
vaati oikean replacement-journalin, vertasi suljetun kannan tavut ennen
backendia ja varmisti laskun, alkuperäisen tapahtuman sekä PDF:n. Nykyinen
sessionvaihdon, palautuksessa poistuvan muutoksen, synteettisen salaisuuden
ja toisen backupin tarkistus säilyi. Molemmat 120 sekunnin vaiherajat säilyivät.
Tavallinen moniversioinen smoke läpäisi samalla paketilla erikseen.

Riippumaton katselmus löysi testin sisältövertailun puutteen: migroidun
kannan hash ei yksin todista vanhan liiketoimintasisällön säilymistä. Korjattu
testi vertaa kaikkia alkuperäisiä lasku-, laskurivi-, dokumentti- ja
toimitustapahtumakenttiä ennen hash-sidontaa. Ehjä migraatio ja muuttuneen
historia-aikaleiman hylkäys todennettiin regressiolla; tarkennettu paketoitu
palautus läpäisi. Runtime-/vaihesopimuksen 19, ajurin virhetodisteiden 17
ja inventaarion 43 testiä läpäisivät. Ensimmäinen uuden helperin
nimilistahylkäys säilyy: vain kyseinen tarkka helper sallittiin, ei yleistä
smoke-tiedostojen poikkeusta. Tyypitys sekä ajokytkennän ja turvallisen
raportoinnin 106 sopimustestiä läpäisivät. Riippumaton jatkokatselmus
vahvisti vertailupuutteen korjauksen eikä löytänyt uusia puutteita.
[Ajotapa ja vertailun rajat](e2e-test-environment.md)
eivät muuta tätä kehityspaketin näyttöä puhtaan revision hyväksynnäksi.

### B5-katselmuksen jatkokorjaukset

**Loppukatselmuksen arkistohavainto:** valinnaisen desktop-arkiston lataaja
käytti nykyistä PDF:ää myös `preservedLegacy`-toimituksen tehtävälle, jolloin
eri dokumenttitunniste esti ehjän kopion arkistoinnin. Korjaus sitoo sekä
metadatan että tavujen haun toimitustapahtumaan nykyisen yritys- ja
oikeusrajatun historian lukupalvelulla. Arkistotehtävän tunniste-, koko- ja
tiivistevaatimukset säilyvät; ei fallbackia nykyiseen PDF:ään tai regenerointia.
Toimitus ja auktoritatiivinen PDF eivät peruunnu arkistovirheen vuoksi.
Backendin 37 ja desktop-arkiston 51 regressiota sekä koko työtilan tyypitys
läpäisivät. Viisi development-Electron-koetta todensi legacy-lähetyksen
oikean arkistokopion ja peruutuksen sekä arkiston virhe-, palautumis- ja
konfliktipolut. Riippumaton jatkokatselmus ei löytänyt jäljellä olevia
olennaisia puutteita. Puhtaan revision paketointi ja PR/main ovat yhä avoinna.

Legacy-palautuskoe on kytketty nykyiseen paketoidun sovelluksen CI-jobiin.
Jobin tuloskoonti vaatii sen onnistumisen; ohitus, peruutus tai hylkäys ei
hyväksy porttia. Rajattu salattu keräys sisältää sen olemassa olevat raportit,
ei testikantoja tai backup-sisältöä. Ajokytkennän 141 sopimustestiä läpäisivät.

Nykyisen PDF:n esikatselu ei enää käytä saman lasku-URL:n vanhaa ikkunaa
uudelleenhyväksynnän jälkeen. Täsmällisen historiallisesti sidotun PDF:n
ikkunan uudelleenkäyttö säilyy. Muutosta todentavat 149 kohdetestiä sekä
nykyisen ja historiallisen PDF:n kaksi development-Electron-koetta.
Historian odottamaton lukuvirhe palauttaa turvallisen 500-vastauksen ilman
raakaa stderr-tulostetta; 47 kohdetestiä ja koko työtilan tyypitys läpäisivät.
Näiden kahden puutteen riippumaton jatkokatselmus on suljettu.

**Kohdetodennettu korjaus:** katselmus löysi puuttuvan B-P3-siirtymän vanhalle
hyväksytylle laskulle, jolla ei ole SMTP-historiaa. Kaksi HTTP-regressiota
toisti ensimmäisen toimitusvalmistelun hylkäyksen. Rajattu toteutus käyttää
uutta moduulinsisäistä `InvoiceLegacyRevisionPromoter`-porttia: tarkka vanha
avain, hyväksytty tila, SMTP-/unresolved-estot, snapshotin ja nykyprojektion
vastaavuus sekä hyväksytyn laskentasäännön mukaiset summat tarkistetaan
samassa transaktiossa. Uusi `validatedLegacySnapshot` ja current-osoitin
julkaistaan atomisesti. Vanhaa revisiota, PDF:ää, summia, laskunumeroa,
maksuja tai toimitushistoriaa ei muuteta. Tietomalli tai migraatiot eivät
laajene. Toimitus käyttää palautettua täsmäavainta, ei uusinta vapaata lukua.
Rajatut 268 testiä ja laajan backend-sarjan 2 835 testiä läpäisivät;
jälkimmäisen viisi olemassa olevaa alustakohtaista ohitusta säilyivät.
Riippumaton katselmus löysi PDF-polun valtuutuspuutteen ja liian aikaisen
sähköpostiesikatselun laskennan. Molemmat korjattiin ja jatkokatselmus
suljettiin. Legacy-siirtymä vaatii PDF-wrapperissakin saman yrityksen
luotetun kontekstin ja `sendInvoices`-oikeuden; tavallinen varmennetun
revision PDF-polku säilyy. Rikkoutunut riviaritmetiikka hylätään ennen
esikatselulaskentaa turvallisesti ja nykyinen Diagnostics/tukipaketti/
incident-ketju on todennettu. Tyypityksen uuden testin puuttuva argumentti
korjattiin, minkä jälkeen backendin tyypitys läpäisi. Tämä ei vielä ole
puhtaan revision paketoitu palautus- tai PR/main-hyväksyntä.

Lisäksi suora SMTP-testin prepare/send ilman edeltävää PDF-esikatselua
todentaa revisiosiirtymän, providerille annettujen tavujen vastaavuuden
tapahtuma-PDF:ään ja muokkaamiseen palaamisen molemmat revisiot säilyttäen.
Kolmen composition-tiedoston 62 testiä läpäisivät. Testin ensimmäinen
tavukopion virhe säilyy havaintona: testisovittimen jaettu puskuri korvattiin
itsenäisellä kopiolla, tuotannon salaisuuksia sisältävien puskurien
nollauskäytäntöä muuttamatta. Riippumaton lisäkatselmus ei löytänyt puutteita.
Tämä on fake-providerilla tehty backend-näyttö, ei oikea SMTP/native-koe.

Koko työtilan regressioajossa erillinen workspace-adoption rollback-testi
ylitti nykyisen aikarajansa. Yksi rajattu saman lähteen uusinta läpäisi,
mutta syy jäi avoimeksi. Alkuperäinen hylkäys säilyy eikä koko sarjaa tai
mergevalmiutta merkitä vihreäksi sen perusteella. Backendin ja webin
erilliset laajat ajot läpäisivät.

**Omistajan rajattu etenemispäätös 6.10.2026:** loppukatselmus, puhtaan
revision paketointi ja yksi normaali PR/CI-kierros saadaan tehdä alkuperäisen
workspace-adoption timeoutin jäädessä avoimeksi. Päätös ei muuta vanhaa
ajoa läpäistyksi, todista juurisyytä tai salli yleisiä lisäuusintoja.
Nykyiset palautus-, eheys-, siivous- ja main-portit vaaditaan edelleen;
uusi hylkäys käsitellään ennen mergeä. Puhtaan revision paketointi,
vaaditut PR/main-portit ja koko B3-B5:n loppuhyväksyntä ovat avoinna.

### B4-reopened-editorin jatkotodennus


**Rajattu lukusopimus:** GET
`/invoice-drafts/:id/delivery-history` vaatii nykyisen `sendInvoices`-oikeuden
ja backendin vahvistaman yrityskontekstin. Erillinen laskutusmoduulin
lukijaportti tarkistaa yhdessä lukutransaktiossa muokattavan tavallisen
luonnoksen ja sen yritysrajatun `source_draft_id`-yhteyden. Tavallinen
luonnos ilman laskuidentiteettiä palauttaa null-identiteetin ja tyhjän
historian; ristiriitainen olemassa oleva sidos on turvallinen eheysvirhe,
ei tyhjä onnistuminen. Hyvitysluonnos ja ei-muokattava tai puuttuva kohde
eivät kuulu tähän polkuun. Luonnoksen kirjoitus-DTO, numerointi,
lähetyskelpoisuus ja tietomalli eivät muutu. Client validoi projektion ja
editori avaa vain sen palauttamaan laskuidentiteettiin sidotun tapahtuman
PDF:n. Näkymästä poistuminen tai luonnoksen vaihtaminen mitätöi vanhan
lukuvastauksen.

**Editorin jatkotodennus:** 39 application-, SQLite- ja composition-testiä
todentaa lukusopimuksen, permission-/yritysrajat, virheellisen sidoksen,
kirjoittamattomuuden sekä operational-lokista Diagnosticsiin ja tukipaketin
incident-projektioon kulkevan turvallisen virheen. Koko webin 947 ja
API-clientin 314 testiä sekä koko työtilan tyypitys läpäisivät. Kaksi
selainpolkua ja yksi development-Electron-polku todentavat vanhan PDF:n
avaamisen myös editorista. Selainpolku avaa luonnoksen uudelleen listalta;
Electron-polku muokkaa ja hyväksyy sen käyttöliittymän kautta ennen vanhan
PDF:n uutta avaamista. Laskuidentiteetti, numero, alkuperäiset PDF-tavut ja
toimitushistoria säilyvät. Native-ikkunan eristys ja sulku tarkistetaan.
Rajattu sopimus-, toteutus- ja turvallisuuskatselmus valmistui. Lopullinen
laskutuksen ja composition-kytkentöjen regressiosarja läpäisi 1 834 testiä.

Native-kokeen ensimmäinen jatko käytti taustalla API-hyväksyntää jo avatun
käyttöliittymän ohi ja odotti listan päivittyvän. Testi käyttää nyt normaalia
UI-muokkausta ja hyväksyntää; se ei lisää tuotantoon pollingia tai muuta
testien aikarajoja. Myös kahden apurin erilaisten palautusmuotojen vertailu
rajattiin tarkkoihin yhteisiin identiteettikenttiin. Ensivirheet säilyvät;
läpäisy ei sulje vanhoja erillisiä CI-timeout-havaintoja.

**B4:n varaus-, loppukuittaus- ja reopen-checkpoint:**
`reserveEmailDelivery` tarkistaa nykykelpoisuuden, täsmädokumentin ja
revision tai säilytetyn legacy-kopion sidoksen sekä kaikki saman laskun
ratkaisemattomat toimitukset samassa `IMMEDIATE`-transaktiossa. Onnistunut
varaus tallentaa `attempted`-tilan ennen mahdollista verkkokutsua.
Yleinen save-portti ei enää hyväksy SMTP-kirjausta varauksen ohitse.
Legacy-uudelleenlähetyksen adapteri ei generoi PDF:ää tai muuta alkuperäisen
tapahtuman provenanssia. Käyttötapauksen/native-vahvistuksen kytkentä on
vielä tekemättä, joten adapterinäyttö ei yksin hyväksy lähettämistä.

Loppukuittaus vaatii saman varauksen, moodin, revision/dokumentin sekä
tallennetun hashin ja koon. Sama päättynyt kuittaus on idempotentti;
eri lopputulos tai sidonta on konflikti. Vain onnistunut asiakaslähetys
merkitsee laskun `sent`-tilaan. Itselle-testin onnistuminen ei lukitse
muokkausta, eikä vanhan saman kuittauksen toisto muuta uutta revisiota.
Tapahtuman varausaika säilyy, ja kuittauksen event-/tila-/audit-kirjoitus
palautuu kokonaan, jos transaktio epäonnistuu.

Reopen irrottaa vain nykyisen revision osoittimen ja vapauttaa luonnoksen
samassa `IMMEDIATE`-transaktiossa tilan ja auditin kanssa. Revision snapshot,
PDF-metatiedot, tiedostot ja toimitustapahtumat säilyvät. `attempted` ja
`outcomeUnknown` estävät reopenin sekä myös suoran uudelleenhyväksynnän:
jälkimmäinen tarkistus suojaa aiemmassa versiossa jo avatun laskun
migroitua historiaa, vaikka current-osoitin puuttuu. HTTP palauttaa
turvallisen 409:n ilman raakavirhettä tai uusia tunnisteita. Nykyinen
auditointi säilyy; hylkäys ei kirjoita onnistumisen tapahtumaa.

Uudet varaus-/loppukuittaustestit läpäisivät ensin 36/36. Reopenin ja
olemassa olevien hyväksyntä-/HTTP-testien rajattu jatko läpäisi 169/169.
Lukituskilvan lisätarkistuksen, PDF-/historialuvun, hyvitysten ja revisioluvun
yhdistetty loppuajo läpäisi 650/650 testiä 36 tiedostossa ilman uusintoja.
Näyttö sisältää kaksi erillistä tietokantayhteyttä, kummatkin operaatioiden
järjestykset, todellisen kirjoituslukon, tietokannan uudelleenavauksen,
migroidun unresolved-historian, audit-rollbackin ja todellisen composition/
HTTP-polun vanhoilla sekä uusilla eri PDF-tavuilla. Tämä ei vielä ole koko
SMTP-/UI-/native-ketjun tai paketoidun palautuksen hyväksyntä.

Riippumattomat rajatut varaus-/kuittaus- ja reopen-katselmukset eivät
löytäneet korjattavaa tuotantokoodista. Reopen-katselmuksen nimeämä
uudelleenkäynnistyksen testivaje täydennettiin suoralla reopen-eston sekä
migroidun historian uudelleenhyväksyntäeston kokeella tietokannan
uudelleenavauksen jälkeen. Sama 650 testin sarja läpäisi täydennyksen jälkeen.

Vanhojen testiaineistojen migraatio-/sidonta-/revisio-odotukset ja uuden
synteettisen tiivisteen pituus korjattiin, ensitulokset säilytettiin.
Tuotannon eheysvaatimuksia tai aikarajoja ei lievennetty. Tämän aiemman
checkpointin backend-tyypityksessä oli 54 diagnostiikkaa yhdeksässä sovittamattomassa
vanhassa toimituskutsujan, tapahtumakirjoittajan tai testin tiedostossa;
uusi reopen-/adapteriketju ei lisää jäljellä olevia tyypitysvirheitä.
Silloinen seuraava työ oli näiden SMTP-, manual- ja dry-run-käyttöpolkujen
yhtenäinen siirto, valmistelu/token ja cancel-kilpailun koko ketjun todennus.
Vanhan approved + tuntemattoman päättyneen SMTP-moodin toimintapäätös oli
tässä checkpointissa avoin; unresolved-esto ei ratkaise tai arvaa sitä.
Omistajan myöhempi rajattu selvitysesto on kirjattu yllä B-P3-taulukkoon.

**B4:n SMTP-käyttötapausten checkpoint:** asiakas- ja itselle-testilähetys
käyttävät yhteistä `loadInvoiceEmailDeliveryDocument`-apua. Se lukee juuri
generoinnin valitseman dokumentin, tarkistaa muuttumattoman revision ja
metatietojen vastaavuuden sekä käyttää tallennusportin varmentamia todellisia
tavuja. Se ei valitse esikatselun uusinta dokumenttia eikä anna yksin
lähetysoikeutta. `invoice-email-send-v3` sitoo valtuutuksen myös revision tai
säilytetyn alkuperän avaimeen. Prepare tyhjentää väliaikaiset tavut eikä
varaa toimitusta; molemmat moodit hylkäävät pysyvän unresolved-historian.

Send varaa täsmäkohteen atomisesti ennen provider-kutsua ja käyttää juuri
saman tarkistetun puskurin. Loppukuittaus saa varauksesta palautetun kohteen
ja moodin. Tyypittämätön provider-virhe tai epäonnistunut loppukuittauksen
tallennus säilyttää epävarmuuden: pysyvää `attempted`-tapahtumaa ei poisteta,
jos edes `outcomeUnknown`-päivitys ei onnistu. Muistiin jäävän attempt-storen
vaihtuminen ei näin salli uutta lähetystä. Lopuksi puskuri tyhjennetään.

Asiakaslähetyksen vastaus lukee nykyisen laskun vasta durablen onnistumisen
jälkeen; resend-tieto tulee varaushetken tilasta. Tämän lukuvaiheen virhe
palauttaa turvallisen `INVOICE_DELIVERY_COMMITTED_READ_FAILED`-koodin, ei
lähetyksen failed-tulosta. Attempt säilyy onnistuneena, tapahtuma ja laskun
`sent`-tila säilyvät. Olemassa oleva `invoiceDelivery.finalizationFailed`
erottaa vaiheen `read`, tilan `committed` ja `retryable=false`; virhekulku
on kytketty myös Diagnosticsin, tukipaketin ja incident-indeksin lukijoihin.
Webin erityinen palaute on nyt kytketty API-clientin säilyttämään 409-
vastauksen täsmälliseen virhekoodiin. Se kertoo onnistuneesta lähetyksestä
ja ohjaa avaamaan laskun sekä tarkistamaan historian ilman uutta lähetystä.
Tuntemattomasta, väärän tyyppisestä tai eri statuksen vastauksesta ei päätellä
onnistumista; raakavirhettä ei näytetä. Desktopin nykyinen protokolla säilyttää
saman koodin eikä vahvista tai lähetä uudelleen. Diagnostiikan kirjoitus ei
saa peittää tulosta.

Regressio toisti ensin aiemman virheellisen kehotuksen valmistella lähetys
uudelleen. Korjauksen 38 hook-/lomake-/sivutestiä ja desktop-protokollan
21 kohdetestiä läpäisivät. Selaimen `INV-SMTP-COMMITTED-READ-UI-001`
läpäisi oikean lomakkeen ja API-clientin kautta: yksi fake-SMTP-toimitus
pysyi onnistuneena ja jälkilukuvirhe näkyi ilman uutta lähetystä. Tämä
selainkoe sovittaa vain onnistuneen HTTP-vastauksen kyseiseksi virheeksi;
varsinainen backend-lukuhäiriö sekä Diagnostics-/tukipaketti-/incident-
ketju todennetaan erillisessä composition-testissä. Näitä ei väitetä yhdeksi
paketoiduksi virheinjektiokokeeksi. Tietomalli, toimituksen transaktio,
native-valtuutus ja hyväksyntärajat eivät muuttuneet palautekorjauksessa.
Todellisen SMTP-compositionin 17 testiä ja koko webin 911 testiä
151 tiedostossa sekä lopullinen työtilan tyypitys ja web-build läpäisivät
tämän jälkeen. Buildin aiempi suuren chunkin varoitus säilyy, eikä sen
rajaa muutettu. Riippumaton palautekorjauksen ja
uusien testien katselmus ei löytänyt korjattavia puutteita.

Kohdetodennus kattaa alemman tason valtuutus- ja tavusidoksen, molemmat
SMTP-moodit, todellisen HTTP/composition-/SQLite-/tiedostoketjun,
reopenin voiton ennen varausta, providerin aikana estetyn reopenin ja
loppukuittauksen tallennusvirheen jälkeisen uuden sovellusinstanssin eston.
Provider on synteettinen: todellista SMTP-yhteyttä ei avata. Buildin ja
E2E-runtimen TypeScript-juurista suljetaan `*.fixture.ts` pois, mutta ne
säilyvät tavallisen tyypityksen piirissä; tätä rajaa testataan nykyisellä
TypeScriptillä ilman uutta riippuvuutta.

Riippumaton katselmus löysi PDF:n tarkistuksen aikaisen reopen-kilvan
virheluokituspuutteen. Neljä uutta molempien moodien prepare/send-tapausta
toisti geneerisen 500-vastauksen ennen korjausta. Nyt reitit palauttavat
turvallisen 409:n eikä asiakaslähetys kirjaa PDF-omistajan jo raportoimaa
konfliktia SMTP-providerin virheeksi. Varausta tai provider-kutsua ei synny.
Katselmuksen jälkeen yhdistetty 181 testin sarja 15 tiedostossa läpäisi
ilman uusintoja tai ohituksia. Tämä rajattu application-/adapteri-/HTTP-
näyttö ei korvaa koko backendin tyypitystä tai UI-/native-/palautusportteja.

Tämän SMTP-checkpointin hetkellä backendin tyypitys ei vielä läpäissyt: jäljellä oli 26 diagnostiikkaa viidessä
manual-/dry-run-tapahtumakirjoittajan tai vanhan repository-testin tiedostossa.
Niiden sovitus ja cancel-todistus kuvataan seuraavassa checkpointissa.
Vanhan approved + tuntemattoman päättyneen SMTP-moodin päätös oli silloin
avoin; yllä oleva 6.10.2026 hyväksyntä ratkaisee tämän päätösaukon.

**B4:n manual-/dry-run- ja cancel-checkpoint:** yleinen tapahtumakirjoittaja
on tyypitetty vain revision PDF:ään sidotuille dry-run-tuloksille. Adapteri
tarkistaa saman sopimuksen myös ajonaikaisesti ja kirjoittaa vasta
current-revision, tarkan dokumentin, tiivisteen ja koon tarkistuksen jälkeen.
SMTP ei voi käyttää tätä porttia varauksen ohitukseen. Manual/print käyttää
omaa `IMMEDIATE`-finalizeria: tapahtuma, sent-tila ja audit ovat atomisia;
`completed` ja `alreadySent` erotetaan, eikä jälkimmäinen luo arkistointia.

Manual ja dry-run prepare/send ottavat revision ennen laskun näkymän lukua
ja vertaavat sitä muodostettuun PDF:ään. Kohdetesti toistaa oikean
composition-/SQLite-/HTTP-ketjun väliin tulevan reopen/uudelleenhyväksynnän:
vanhaa laskunäkymää ei yhdistetä uuteen PDF:ään, vaan palautetaan turvallinen
409. Molempien yhtä aikaa approved-tilan lukeneiden manual-pyyntöjen testi
todistaa yhden tapahtuman ja juuri siihen liittyvän arkistointipyynnön.

Cancelin tuotantokoodia tai peruutussääntöä ei muutettu. Molempien
SMTP-moodien varaus/peruutusjärjestykset, eri tietokantayhteydet,
kirjoituslukko ja päätöksen säilyminen tietokannan uudelleenavauksessa on
todennettu. Oikea composition torjuu ennen varausta voittaneen peruutuksen
ennen provideria ja estää peruutuksen providerin aikana. Vanhan peruutustestin
aineisto muodostetaan nyt aidon 038 -> 039 -migraation kautta; suojia ei
poisteta vanhojen rivien lisäämiseksi. Vanhan repository-testin 24 testiryhmää
säilyvät uuden porttisopimuksen 58 tapauksena, myös legacy-unresolved-estot.

Rajattu 23 tiedoston sarja läpäisi 330/330 testiä. Laajempi regressio paljasti
Activity-lukijan vanhasta fixturestä kaksi 039-sidoksen puutetta; aineisto
siirrettiin todellisen 038 -> 039 -migraation läpi muuttamatta Activityn
tuotantokoodia tai odotettua read modelia. Composition-testi varmentaa
manuaalisen toimituksen sallitut historiakentät ja dry-runin tarkoituksellisen
poissulun. Riippumattoman katselmuksen jälkeen täydennettiin myös dry-runin
provider-odotuksen aikainen cancel/reopen/uudelleenhyväksyntä: myöhäinen
tulos hylätään ilman uutta tapahtumaa tai arkistointia.

Lopullinen laskutusmoduulin ja kolmen toimitus-/reopen-compositionin sarja
läpäisi 1 472/1 472 testiä 122 tiedostossa ilman ohituksia tai uusintoja.
Backendin koko tyypitys läpäisi uudelleen. Riippumaton rajattu lähdekatselmus
ja testitäydennysten tarkistus valmistuivat ilman korjattavia löydöksiä.
Tämä ei ole koko backendin, UI:n, native-runtimen tai palautusketjun
hyväksyntä eikä vielä sulje B4:ää tai V3:n hyväksyntäportteja.
Seuraavaksi kytketään legacy-vahvistus, client/UI/native sekä katalogi ja
palautus. Uusia riippuvuuksia, audit-/diagnostiikkatunnuksia tai
moduulien välisiä portteja ei lisätty tässä palassa. Sisäistä revisioavainta
ei julkaista vanhan HTTP-vastauksen uutena kenttänä.

**B-P3:n lähde- ja säilytyspala työpuussa; kohdetodennettu ja katselmoitu.** Invoicingin
erillinen lukijaportti valitsee `sent`/`legacySnapshot`-laskun yksiselitteisen
alkuperäisen dokumentin ja mahdollisen säilytetyn kopion. Sama historian
kelpoisuusehto tarkistetaan myös kopion julkaisun `IMMEDIATE`-transaktiossa
ja lähetysvarauksessa; olemassa oleva kopio ei ohita ehtoa. Valinnan jälkeen
application lukee varmennetut tavut ja julkaisee itsenäisen kopion nykyisillä
storage-/repository-porteilla ilman renderer- tai provider-kutsua.
Epäselvä julkaisun commit-tulos säilyttää ehdokkaan; vain varmasti hävinnyt
oma ehdokas voidaan siivota. Rajatut testit kattavat väärän kohteen, puuttuvan
ja epäselvän historian, estävät toimitukset, valmistelukilvan ja tiedostovirheen.
Tämä pala ei vielä avaa HTTP-/native-lähetyspolkua. Tässä checkpointissa
avoimeksi jääneet tunnetun R02-jälkitilan todennus ja approved + tuntematon
SMTP -päätös on käsitelty alla 6.10.2026 jatkossa; kokonaisketju jää kesken.

Ensimmäinen rajattu sarja läpäisi 91 testiä. Laajemman ajon kaksi
testijärjestelypuutetta korjattiin muuttamatta tuotannon suojaehtoja:
tietokantafixture kuuluu infrastructureen ja uuden kopion julkaisutesti
tarvitsee yksiselitteisen historian; puuttuvan vanhan viitteen lukutestit
säilyivät. Lisäksi todennettiin useita samaan alkuperäiseen viittaavia
tapahtumia ja säilytetyn kopion käyttö tietokannan uudelleenavauksen jälkeen.
Lopullinen laskutusmoduulin ja viiden compositionin sarja läpäisi
1 525/1 525 testiä 126 tiedostossa, ja backendin koko tyypitys läpäisi.
Riippumaton ehdokaskatselmus valmistui ilman korjattavia löydöksiä. Nämä eivät hyväksy HTTP-/UI-/
native-ketjua tai B5:n katalogi-/paketoitua palautusporttia. Valmistelun
sisäinen kopiointi ei luo toimitus- tai business-audit-tapahtumaa; vasta
varsinainen toimitus käyttää nykyistä tapahtumaporttia. Uutta loggeria,
riippuvuutta tai moduulien välistä porttia ei lisätty.

**B-P3:n selvitysesto ja tunnetun jälkitilan todennus, 6.10.2026.** Omistajan
hyväksymä rajaus on yllä [legacy-taulukossa](#b-p3-turvallisen-uudelleenlähetyksen-vaihtoehto).
Backendin alku- ja transaktiotarkistus torjuvat epäselvän vanhan approved-
laskun muokkaus-/lähetyspolut. Kahdeksan HTTP-toimintoa palauttaa turvallisen
409-koodin ennen PDF-, sähköpostiasetus-, valtuutus- tai provider-toimintoja.
Laskun, tapahtumien ja alkuperäisen PDF:n luku säilyy. Sama turvallinen syy
kulkee oikean loggerin läpi Diagnosticsiin ja tukipakettiin; sen varoitus
ei kuulu pitkän ajan incident-indeksiin. UI:n virhemäppäys käyttää vain
sovittua status-/koodiparia ja säilyttää muiden virheiden nykyiset palautteet.

Alkuperäisessä R02-ketjussa dokumenttimetadatan poisto jätti vanhalle
tapahtumalle `ON DELETE SET NULL` -viitteen. Myöhäinen success saattoi
koskea jo vaihtunutta snapshotia; epävarma lopputulos säilyi toisena
jälkitilana. Uusi regressio rakentaa nämä tunnetut pysyvät jälkitilat
038-skeemaan, käyttää todellista 039-migraatiota ja todistaa eston valinnassa,
kopion julkaisussa ja varauksessa. Myöhempi ehjä dokumentti/tapahtuma ei
korjaa vanhaa null-viitettä. Varauksella on kokeessa muuten kelvollinen
kohdedokumentti; puuttuva kohde ei yksin selitä hylkäystä. Ehjän saman
lähteen toistuvat sent-tapahtumat sallitaan kontrollina. Tämä ei ole vanhan
runtime-virheen uusi toisto eikä todista kaiken historiallisen PDF-sisällön
vastaavuutta. Uutta yleistä ristiriitalippua tai audit-aikaheuristiikkaa ei lisätty.

Rajattu sarja läpäisi 58 testiä. Laajempi laskutuksen ja compositionien
regressio läpäisi 1 587/1 587 testiä 130 tiedostossa ja backendin tyypitys
läpäisi. UI:n hook-/virhepalautesarja läpäisi 268/268 testiä 26 tiedostossa
ja webin tyypitys läpäisi. Tämä ei ole koko käyttöliittymän E2E-hyväksyntä.
Ensimmäisen koeaineiston puutteet ja väärät oletukset erotettiin
tuotantosopimuksesta; ensimmäinen hylkäys säilytettiin.

Riippumaton katselmus löysi UI-kytkennästä kaksi ennenaikaista PDF-pyyntöä:
manuaalinen lähetetyksi merkintä ja sähköpostin valmistelu saattoivat
pysähtyä PDF-virheeseen ennen selvityseston palautetta. Oikeiden sivun
callbackien testi toisti molemmat puutteet. Erilliset edeltävät PDF-pyynnöt
poistettiin; nykyiset backend-käyttötapaukset omistavat jo kelpoisuuden ja
PDF:n varmistamisen. Vain onnistumisen jälkeen päivitetään UI:n metadata
ilman uutta valmistelun odotusehtoa. Rajattu virhe- ja onnistumispolun
testi sekä sen jälkeinen laskutuksen web-sarja läpäisivät: 586/586 testiä
78 tiedostossa, webin tyypitys läpäisi uudelleen. Sama katselmoija vahvisti
löydön korjauksen ilman uusia löydöksiä. Tämä sivukytkennän todennus ei
ole selaimen tai paketoidun Electronin täysi E2E-testi.

Koko legacy-lähetyksen vahvistus/native-kytkentä, katalogi ja paketoitu
palautus sekä PR/main-portit ovat edelleen tekemättä. Uusia riippuvuuksia,
skeemamuutoksia tai hyväksyntäehtojen lievennyksiä ei lisätty tässä palassa.

##### Säilytetyn dokumentin täsmäluku ja vahvistuksen järjestys

**Rajattu lukupala työpuussa 6.10.2026.**
`readPreservedLegacyInvoiceDocument` lukee vain jo valmistellun,
eksplisiittisellä dokumentti-ID:llä nimetyn säilytetyn kopion. Se tarkistaa
lähetysoikeuden ja luotetun yritys-/laskurajan, lähteen ja kopion todelliset
tavut sekä historian kelpoisuuden uudelleen tiedostoluvun jälkeen.
Lukuri ei saa julkaisu-, generointi- tai poistamisporttia. Puuttuva kopio,
eri dokumentti tai muuttunut aineisto hylätään; uutta PDF:ää ei tehdä
varavaihtoehdoksi. Valmistelu ja luku käyttävät samoja kapeita metadatan
eheystarkistuksia. Tämä alkuperäinen lukupala ei vielä sisältänyt
HTTP-/native-kytkentää eikä lähetysvaltuutusta. Kytkennän nykytila on alla.

Uuden täsmälukijan 18 testiä sekä valmistelun, lähdevalinnan ja R02-
migraatiotapausten yhdistetty 56 testin ajo läpäisivät. Tämän jälkeen
laskutuksen ja compositionien 1 605 testiä 131 tiedostossa sekä backendin
tyypitys läpäisivät. Näyttö koskee backendin osaa, ei vielä koko vahvistuksen
toteutusta tai paketoitua palautusta. Rajattu riippumaton lähdekatselmus
ei löytänyt korjattavia ohituksia tai valmistelun käyttäytymisregressioita.

Kytkentä jatkuu hyväksytyn B-P3:n sisällä seuraavassa järjestyksessä:

1. Dokumentin valmistelu säilyttää tarkistetun kopion ja palauttaa täsmäkohteen
   sekä eksplisiittisen `preservedLegacy`-alkuperän, mutta ei vielä SMTP:n
   kertalupaa. Backend valitsee alkuperän; renderer ei saa päättää sitä.
2. Esikatselu lukee juuri nimetyn kopion. Nykyinen pelkällä lasku-ID:llä
   valittu PDF ja samalla avaimella uudelleenkäytetty esikatseluikkuna eivät
   kelpaa tämän kohdesidonnan todisteeksi. Kapea täsmälukureitti ja mainin
   esikatselukohde on vietävä olemassa olevaan allowlistiin ja controlleriin.
3. SMTP-prepare tarkistaa esikatselukohteen uudelleen. Callerilta saatu
   dokumenttitunniste on vertailuehto, ei lähetysoikeus tai luotettu alkuperä.
   Vasta tämän jälkeen syntyy nykyinen 60 sekunnin kertalupa ja mainin
   erillinen vahvistus näyttää säilyneen dokumentin historiallisen rajan,
   todellisen vastaanottajan ja viestin. Aikarajaa ei kasvateta eikä
   vanhentunutta lupaa uusita automaattisesti.
4. Send lukee saman kopion uudelleen, vertaa nykyistä fingerprint-sidontaa
   ja käyttää nykyistä atomista varausta. Vahvistuksen tai preview-lukemisen
   onnistuminen ei ohita välissä syntynyttä estävää toimitusta.

Response- ja request-parserien, API-clientin eksplisiittisen serialisoinnin
sekä native-vahvistuksen on kannettava sama täsmäkohde. Puuttuva tai
tuntematon alkuperä ei saa pudota tavalliseen resend-haaraan. Native-portti
on todennettava myös puuttuvan callbackin tapauksessa; pelkkä uuden reitin
allowlistaus ei osoita vahvistuksen toteutumista. Itselle tehtävä SMTP-testi
pysyy vain varmennetun revision polkuna. Nämä eivät lisää uutta lähetysmoodia,
pidennä tokenin elinaikaa tai avaa automaattista uudelleenlähetystä.

Nykyinen sähköpostilomakkeen avaaminen kulkee
`prepareApprovedInvoiceEmailDryRun`-käyttötapauksen kautta myös ennen
asiakas-SMTP:tä. **Esivalmistelun kytkentä on nyt työpuussa:** tavallinen
haara säilyttää revision PDF:n varmistamisen. Kelvollisen vanhan `sent`-
laskun haara käyttää samaa säilytetyn kopion valmistelua kuin B-P3:n
lukupohja, eikä regeneroi dokumenttia. Backend valitsee haaran. Vastauksen
pakollinen `documentTarget` sisältää vain `kind`-arvon (`revision` tai
`preservedLegacy`) ja liitteen kanssa saman `documentId`:n. API-client
validoi ne eksplisiittisesti; puuttuvaa tai tuntematonta varianttia ei arvata.
Sisäisiä polkuja, tiivisteitä tai lähderevisiota ei lisätä tähän DTO:hon.

Vanhan PDF:n viestipohja on neutraali: snapshotin rahasummia, eräpäivää,
viitettä tai maksutietoja ei esitetä varmennetuksi PDF-sisällöksi. Kopio
pysyy katalogissa ja lukuoperaation tilapäiset tavupuskurit tyhjennetään myös
lomakkeen valmistelun epäonnistuessa. Alkuperäisiä dokumentteja, laskua tai
toimitushistoriaa ei muuteta. Eheysvirhe käyttää nykyistä
`invoicePdf.storageFailed`-tapahtumaa; valmistelussa `sideEffectState=unknown`
ei lupaa, ettei kopiota ehtinyt syntyä. Diagnostiikan kirjoitusvirhe ei
korvaa varsinaista eheysvirhettä.

Rajatussa katselmuksessa löytyi julkaisukonfliktin jälkeisen
ehdokastiedoston siivousvirheen puuttuva diagnoosi. Kolme regressiota
toistivat puutteen ennen korjausta. Korjaus kirjaa nykyiseen
`invoicePdf.storageFailed`-tapahtumaan `INVOICE_PDF_CLEANUP_FAILED`-syyn,
`cleanup`-vaiheen ja epävarman sivuvaikutuksen. Alkuperäinen konflikti ja
historiallinen aineisto säilyvät myös loggerin epäonnistuessa. Korjauksen
33 kohdetestiä läpäisivät; mukana on oikea Diagnostics-/tukipaketti-/
incident-lukuketju eikä pelkkä kirjoittimen mock-tarkistus. Sopimus on
[nykyisessä tapahtumakatalogissa](r0-observability-event-catalog.md#laskudokumentit-ja-toimitus).

Lopullinen tämän palan laskutus-/composition-regressio läpäisi 1 621 testiä
132 tiedostossa. API-clientin koko 188 testin sarja ja webin 14 kohdetestiä
läpäisivät. Koko työtilan tyypitys läpäisi uuden DTO:n kanssa.
Client-regression ensimmäinen hylkäys johtui virheolion lisätietoja
koskevasta väärästä testiodotuksesta, ei parserin hyväksymästä väärästä
vastauksesta; odotus korjattiin muuttamatta tuotannon validointia.
Tämä ei ole vielä selaimen/native-polun tai paketoidun palautuksen todiste.
Backendin tyypitys läpäisi myös siivousdiagnoosin lopullisen korjauksen
jälkeen. Sama riippumaton katselmoija vahvisti siivouslöydön korjauksen;
rajatussa jatkokatselmuksessa ei ollut uusia löydöksiä.

Tämä on lomakkeen esivalmistelu, ei lähetysvaltuutus. Se ei luo SMTP-
kertalupaa, toimitusyritystä eikä avaa `preservedLegacy`-varianttia itselle-
testin tai dry-run-sendin varaukseen.

**Täsmäesikatselun backend-/desktop-rajat työpuussa 6.10.2026.**
`GET /invoices/:id/preserved-documents/:documentId/pdf` käyttää yllä olevaa
kirjoittamatonta lukijaa oikeassa compositionissa. Reitti hylkää query-
ohitukset ja palauttaa vain tarkistetut PDF-tavut turvallisilla kiinteillä
otsakkeilla; tilapäiset storage-puskurit tyhjennetään. API-client muodostaa
vain tämän reitin osoitteen, ei anna luku- tai lähetysoikeutta.

Desktopin olemassa oleva `openInvoicePdf(invoiceId, target?)` hyväksyy
valinnaisen tarkan `{ kind: 'preservedLegacy', documentId }`-kohteen.
Main tarkistaa lähettäjän, kentät ja tunnisteet, muodostaa URL:n itse sekä
käyttää sitä ikkunan täsmäavaimena. Tavallinen PDF, saman laskun eri
dokumentti ja eri laskun dokumentti eivät jaa esikatseluikkunan identiteettiä.
GET-allowlist, pääprosessin session, sandbox, navigointi- ja permission-
rajat säilyvät. Valinnainen kohde ei tuo uutta IPC-capabilityä. Kohteen
puuttuminen säilyttää aiemman toiminnon; virheellinen kohde hylätään.

Backendin 57 kohdetestiä, API-clientin kaikki 191 testiä sekä desktopin
87 kohdetestiä läpäisivät. Laajempi laskutus-/composition-sarja läpäisi
1 664 testiä 135 tiedostossa. Testit kattavat oikean backend-compositionin,
muuttuneen tiedoston ja IO:n aikana peruutetun laskun, oletuspolun säilymisen,
väärän kohteen sekä preloadin ja protokollan kytkennät. Electronin native-
rajat on näissä testeissä korvattu testisovittimilla; kyse ei ole oikean
Electron-ikkunan tai paketoidun palautuksen hyväksynnästä. Ensimmäisen
desktop-ajon uuden testin CTS-latausvirhe korjattiin suorittamalla preloadin
nykyisellä TypeScript-kääntäjällä tuotettu CommonJS eristetyssä testissä,
ei muuttamalla tuotantopreloadia tai testiehtoihin tehtävällä poikkeuksella.

Riippumaton katselmus löysi uuden lukurajan kaksi puutetta, jotka toistettiin
ennen korjausta: backend hyväksyi tunnisteiden välilyöntinormalisoinnin, ja
odottamaton reader-poikkeama päätyi kehyksen raakaan stderr-käsittelyyn.
Täsmälukija hylkää nyt normalisoinnin olemassa olevan tunnistepituusrajan
sisällä. HTTP-raja palauttaa odottamattomasta poikkeamasta geneerisen 500-
vastauksen ilman raakavirheen välitystä. Nykyinen HTTP-middleware kirjaa
`HTTP_REQUEST_FAILED`-luokan; tuntematonta virhettä ei nimetä perusteetta
PDF:n eheysvirheeksi. Korjausten 69 kohdetestiä läpäisivät. Kyse ei ollut
todennetusta yritysrajan ohituksesta eikä uudesta lokituskehyksestä.
Korjausten jälkeinen laskutus-/composition-/HTTP-lokitusregressio läpäisi
1 676 testiä 136 tiedostossa. Oikea lokikirjoitin sekä Diagnosticsin,
tukipaketin ja incident-indeksin lukijat säilyttivät turvallisen virheluokan
ilman raakapoikkeamaa tai polkuja. Koko työtilan tyypitys ja desktop-build
läpäisivät; backendin tyypitys läpäisi myös viimeisten tuotantokorjausten
jälkeen. Rakennettu preload pysyy yhtenä CommonJS-tiedostona, jonka ainoa
runtime-import on Electron.
Sama riippumaton katselmoija vahvisti molemmat tuotantokorjaukset ja
vuotosuojatestin Windows-escape-tarkennuksen ilman uusia löydöksiä.
Lopulliset 18 composition-lukurajatestiä läpäisivät myös testitarkennuksen
jälkeen. Tämä rajattu katselmus ei ole koko B3-B5:n loppukatselmus.

**Lomakkeen täsmäesikatselu työpuussa 6.10.2026.** Säilytetty liite avataan
sähköpostilomakkeen omasta toiminnosta backendin palauttamalla lasku- ja
dokumenttikohteella. `openPreservedInvoicePdf` ei saa generointiporttia:
desktop käyttää nykyistä kohdekohtaista capabilityä, selain vain täsmä-GET-
osoitetta. Native-virhe ei vaihda selainpolkuun. Estetty popup ja avausvirhe
saavat kiinteän palautteen; keskeneräinen avaus estää kaksoiskutsun. Palaute
sidotaan liitteeseen, joten vanhan avauksen valmistuminen ei muuta uuden
liitteen tilaa. Selaimen onnistunut avaus tarkoittaa navigoinnin käynnistystä,
ei PDF-vastauksen eheyden tai onnistumisen vahvistusta.

Riippumaton katselmus löysi nykyisestä valmisteluhookista vanhentuneen
vastauksen puutteen. Vanha liite palautui sekä 409/500-valmisteluvirheen
jälkeen että samalle laskulle palattaessa myöhäisestä vastauksesta. Kaikki
kolme tilannetta toistettiin ennen korjausta. Uusi valmistelu tyhjentää
aiemman esikatselun; clear/unmount mitätöi pyyntösukupolven. Vanha vastaus
ei palauta kohdetta, virhettä, pending-tilaa tai onnistumista callerille.
Sama katselmoija vahvisti lähdekorjauksen ilman uusia löydöksiä.

Webin 885 testiä 150 tiedostossa, web-build ja koko työtilan tyypitys
läpäisivät. Seitsemän esikatselun selaintapausta läpäisivät kohdeajoissa.
Vanhan pyynnön catch/finally-haaran valmistuminen todistetaan lisäksi
kolmessa yksikkötapauksessa odottamalla sen koko komentolupausta uudemman
pyynnön pysyessä pidätettynä. Pelkkä HTTP-vastauksen valmistuminen ei ole
riittävä todiste hookin tilakirjoitusten päättymisestä. Rajattu riippumaton
jatkokatselmus hyväksyi tämän näyttörajan. Ensimmäisten uusien testien
kaksi valitsinvirhettä korjattiin säilyneestä DOM-näytöstä; aikarajoja tai
hyväksyntäehtoja ei muutettu eikä hylättyjä ajoja nimetty läpäisyiksi.
Selainkokeet käyttävät nykyistä eristettyä web-fixtureä sekä
eksplisiittistä preserved-preflight-testisovitinta. Native-callback korvataan
testissä, ja popupin osoite todistetaan synteettisellä vastauksella, ei PDF-
renderöinnillä. Tavallisen laskun `INV-LIFECYCLE-001` läpäisi myös korjauksen
jälkeen. Varsinainen legacy-lähteen valinta ja PDF-tavut on todennettu yllä
backendissä; tämä osanäyttö ei yhdistä niitä vielä oikeaksi Electron-poluksi.
Uusi avauspainike tarkistettiin myös kapeassa näkymässä; koko nykyistä
työpöytälomaketta ei tämän perusteella nimetä mobiilikäyttöliittymäksi.

Popupin paikallinen virhe ei tuota business-auditia tai uutta lokityyppiä.
Backendin lukuvirheet käyttävät yllä todennettua nykyistä HTTP-diagnostiikkaa.
Esikatselu ei muuta toimitushistoriaa eikä anna lähetysvaltuutusta.
Tätä seurannut SMTP-kohdesidonta on kuvattu alla. Historian käyttöliittymä
ja B5:n katalogi-/palautushyväksyntä ovat edelleen avoinna.

**Asiakas-SMTP:n kohdesidonta työpuussa 6.10.2026.** Prepare ja send vaativat
saman esikatselun `documentTarget`-kohteen. Tunniste on normalisoimaton
1–100 merkin ASCII-resource-id; kohteessa sallitaan vain `kind` ja
`documentId`. Backend valitsee alkuperän pysyvästä revisiosta ja laskun
tilasta. Legacy-haara lukee jo olemassa olevan säilytetyn kopion ja lähteen
uudelleen; SMTP-valmistelu ei luo puuttuvaa kopiota tai regeneroi PDF:ää.
Tavallinen lähetys tarkistaa esikatselun dokumentin ja nykyrevision.
Fingerprint, nykyinen 60 sekunnin kertalupa, atominen varaus ja täsmäkuittaus
säilyvät. Välissä syntynyt estävä toimitus estää provider-kutsun.

API-client serialisoi vain nimetyt kentät ja validoi vastauksen variantin
sekä liitteen saman ID:n. Lomake säilyttää lähetetyn kohteen valmistelun
ajan; eri laskuun tai dokumenttiin viittaava vastaus ei käynnistä sendiä.
Säilytettyä liitettä ei voi käyttää itselle-SMTP-testissä tai dry-run-sendissä.
Desktop estää asiakasvalmistelun ennen backend-kutsua, jos native-vahvistaja
puuttuu. Main vertaa vastauksen kohdetta alkuperäiseen pyyntöön eikä luovuta
kertalupaa rendererille ennen hyväksyntää. Säilytetyn PDF:n vahvistus kertoo
vanhan sisällön todentamisen rajan ja näyttää todellisen vastaanottajan,
viestin sekä liitteen. Peruutus, poikkeama tai väärä kohde ei palauta tokenia.

Laskutuksen ja compositionien 1 747 testiä 137 tiedostossa, API-clientin
266 testiä, webin 50 kohdetestiä ja desktopin 72 kohdetestiä läpäisivät.
Koko työtilan tyypitys läpäisi. Ensimmäisen tyyppiajon uusi testifixture
korjattiin vertaamaan tallennusportin oikeaa tiedostoevidenssiä; tuotannon
eheysvaatimusta ei muutettu. Oikea legacy-composition todentaa tavut,
varauksen, historiallisen aineiston säilymisen ja olemassa olevan
Diagnostics-/tukipaketti-/incident-lukuketjun ilman raakasisällön vuotoa.
Rajattu riippumaton lähdekatselmus ei löytänyt uusia korjattavia puutteita.
Native-kohdetestit käyttävät Electron-sovitinta. Niiden jälkeiset kaksi
development-Electron-koetta läpäisivät oikean protokollan, mainin vahvistuksen
ja backendin kautta: hyväksyntä säilytti toimitustapahtumassa täsmälleen
alkuperäiset PDF-tavut, peruutus ei luovuttanut tokenia eikä luonut toimitusta.
Vain OS-dialogi ja SMTP-provider ovat näissä nykyisiä testisovittimia.
Tämä todistaa normaalirevision ketjun, ei vielä legacy-kokonaispolkua tai
paketoitua palautusta. Koko B3–B5:n PR-/main-portit ja loppukatselmus
säilyvät erillisinä.

Viiden selainpolun kohdeajo läpäisi: tavallinen laskun elinkaari,
peruminen, epävarman SMTP-tuloksen jälkeinen esto sekä kaksi täsmäkohteen
lomakekoetta. Jälkimmäiset käyttävät eksplisiittisiä prepare/send-
testisovittimia, eivät oikeaa legacy-SMTP- tai native-vahvistusta.
Ensimmäinen ajo hylkäsi uuden perumistestin valmistelukutsun ylimääräisen
JSON-rungon. Testi sovitettiin reitin olemassa olevaan rungottomaan
sopimukseen; tuotannon validointia, aikarajoja tai uusintaehtoja ei muutettu.

Koko web-sarja läpäisi tämän jälkeen 900 testiä 151 tiedostossa. E2E:n
JSON-runkojen sopimustesti, web-/desktop-buildit sekä uusien Electron-testien
tyypitys läpäisivät. Riippumaton loppukatselmus kattoi myös kaksi
Electron-testiä ilman uusia löydöksiä. Jälkilukuvirheen käyttäjäpalaute on
tämän jälkeen kohdetodennettu yllä kuvatusti. Historian käyttöliittymä ja
B5:n palautustodennus ovat seuraavat avoimet osat.

Dokumentin nykyinen unique `(company_id, invoice_id, document_type)` korvataan
revision unique-ehdolla. Alkuperäiselle legacy-riville säilyy oma partial-unique;
säilytetty legacy-kopio on yksilöity lähdedokumenttiin eikä joka prepare tee
uutta identtistä PDF:ää. Uusi storage-polku sisältää dokumentti-ID:n eikä
koskaan jaa vanhan tai toisen revision tiedostoa. Uuden polun törmäys myös
legacy-riviin torjutaan. Vanhat polut pysyvät sellaisinaan migraatiossa.

Uusien SMTP-tapahtumien partial-unique `(company_id, invoice_id)` estää
kahden `attempted`/`outcomeUnknown`-varauksen rinnakkaisuuden. Vanhoja useita
epäselviä tapahtumia ei poisteta indeksin luomiseksi: varaus tarkistaa myös
legacy-estot saman kirjoitustransaktion sisällä. `legacyUnknown` ei ole
uuden lähetyksen sallittu moodi. Nykyinen cancelin kaikkia providereita
koskeva onnistuneen/epäselvän toimituksen esto säilyy; B-P2:n rajattu
itselle-testin muokkauslupa koskee reopenia, ei uutta cancel-sääntöä.

##### Dokumentti- ja tapahtumasidoksen SQL-osakoe

Eristetty valmistelukoe käytti oikeaa nykyistä migraatiorunneria,
muuttumattomia migraatioita 001–038 ja ehdotettua dokumentti-/tapahtuma-DDL:ää.
Revision vanhempi oli tässä vain avainfixture: koe ei vielä toteuttanut
täydellistä sisältösnapshotia, historiallisten rivien lähdesidosta tai
hyväksynnän julkaisua. Tämä aiempi osakoe ei ole numeroidun migraation näyttö.

Täsmennetty viiteavainketju on seuraava; jokaisella vanhemman sarakejoukolla
on vastaava eksplisiittinen UNIQUE-avain:

- Dokumentin yritys/lasku sidotaan `invoices(company_id, id)`-avaimeen ja
  revision variantti lisäksi revision `(company_id, invoice_id, id)`-avaimeen.
- Tapahtuman `(company_id, invoice_id, document_id, binding_kind)` viittaa
  dokumentin samaan identiteettiin ja varianttiin. Tämä ehto pysyy voimassa
  myös preservedLegacy-variantissa, vaikka `revision_id` on null.
- Revision tapahtuma sidotaan lisäksi dokumentin
  `(company_id, invoice_id, id, revision_id)`-avaimeen. Uuden tapahtuman
  hash/koko sidotaan dokumentin `(company_id, invoice_id, id, sha256, size_bytes)`-
  avaimeen. Variantin CHECK vaatii nämä arvot; nullable-FK ei korvaa sitä.
- Säilytetyn legacy-kopion lähde sidotaan saman yrityksen/laskun alkuperäiseen
  dokumenttiin ja samoihin hash/koko-arvoihin. Lähteen legacyOriginal-variantti
  tarkistetaan erikseen. Kopio ei voi olla uuden kopion lähde.

Migraatio kopioi legacyOriginal/legacyUnknown-rivit ennen uusien lisäysten
suojien käyttöönottoa. Ajonaikainen kirjoitus ei saa luoda lisää tämän
provenanssin rivejä. Migroidun legacy-tapahtuman kaikki kentät, myös
lopputulos ja virhetieto, jäädytetään. Yleinen completion-operaatio ei saa
muuttaa vanhaa epäselvää lähetystä jälkikäteen epäonnistuneeksi tai
onnistuneeksi. Tämä ei ratkaise vanhan laskun tulevaa lähetyskelpoisuutta.
Julkaistun dokumentin sekä uuden tapahtuman identiteetin,
sidoksen, moodin ja alkuperäisten viestikenttien muutos/poisto torjutaan.
Pelkkä UPDATE/DELETE-trigger ei riitä: koe toisti `INSERT OR REPLACE`- ja
`UPDATE OR REPLACE`-käskyjen kautta syntyvän historian korvautumisen.
Ehdotuksen lisäys- ja päivityssuojat tarkistavat myös kilpailevat PK- ja
partial-unique-avaimet ennen korvausta. Adaptereissa ei käytetä REPLACEa
historian kirjoituksiin. Suojat eivät perustu muutokseen yhteyden
`recursive_triggers`-asetuksessa.

Korjatun ehdotuksen 57 rajattua koetta läpäisivät. Näyttö kattaa alkuperäisten
arvojen/nullien ja katalogin säilymisen, toistuvan migraatiokutsun,
viite-/variantti-/hash-/koko-/yritysrajat, revision oman PDF:n yksilöinnin,
uudet rinnakkaiset epäselvät SMTP-varaukset, historiarivien korvausyritykset
sekä metadatakirjoituksen epäonnistumisen täydellisen rollbackin.
Legacy-ankkuroinnin erillinen sitoutuminen todistettiin erikseen:
epäonnistunut uusi business-migraatio ei jää osittain voimaan.
Jo valmiiksi väärään laskuun viittaava vanha dokumenttisidos hylkäsi koko
siirron muuttamatta alkuperäistä; sitä ei korjattu nullittamalla. Säilymistä
testattiin myös ei-tyhjillä vanhoilla lopputuloskentillä ja kaikilla
nykyisillä provider-arvoilla. Legacy-kopion väärä hash/koko testattiin
erikseen ilman samanaikaista duplicate-source-ristiriitaa. Uusi
manuaalivariantti sallii vain nykyisen callerin manual/print-menetelmät ja
manual-providerin; vanhoja muita arvoja ei muuteta tämän rajauksen vuoksi.
Rajattu riippumaton kenttä-/portti- ja SQL-katselmus tarkensi legacy-
lopputuloksen jäädyttämisen, manuaalivariantin rajauksen ja kielteisten
kokeiden eristyksen. Näiden korjausten jälkiluku ei jättänyt avoimia
korjaushavaintoja tähän osaan; se ei ole koko V1:n katselmushyväksyntä.

Tämä on **DDL-ehdotuksen osatodiste**, ei valmis migraatio tai lähetysoikeus.
Uusien unresolved-rivien unique ei yksin estä vanhan legacy-historian
ohittamista: runtime-varauksen on edelleen tarkistettava kaikki legacy-estot,
status ja nykyrevisio samassa kirjoitustransaktiossa. SQL:n polkuvertailu ei
korvaa tiedostojärjestelmän containment-/tyyppi-/alias-/tavutarkistusta.
Lopullisen DDL:n testit tulevat versionhallintaan sen toteutuksen mukana;
valmistelukoe ei korvaa niitä tai B5:n palautustodistusta.

#### Porttien katselmointiehdotus

`InvoiceContentRevision` on muuttumaton sisältö, ei laajennettu elävä
`ApprovedInvoiceView`. `InvoiceDocumentBinding` erottaa tyypitettynä
`revision`- ja `preservedLegacy`-variantin. `legacyOriginal` on vain vanhan
aineiston luku-/migraatiotyyppi, ei uuden provider-kutsun varausvaihtoehto.
`InvoiceDeliveryReservation` sisältää pysyvän event-ID:n, company/invoice-
rajan, moodin, bindingin ja tarkistetun dokumentin hashin/koon. HTTP tai
renderer ei voi valita provenanssia tai luotettua company-kontekstia.

Tarkennettu sisäinen tyypitysehdotus sitoo myös sallitun moodin varianttiin.
Tässä `scope` tulee backendin luotetusta kontekstista, ei request-bodysta;
tyyppi ei itsessään korvaa oikeus-, sisältö- tai varaustarkistusta:

```ts
type InvoiceScope = Readonly<{ companyId: string; invoiceId: string }>;
type RevisionKey = InvoiceScope & Readonly<{ revisionId: string }>;
type RevisionBinding = Readonly<{
  kind: 'revision'; revisionId: string; sourceDocumentId?: never;
}>;
type PreservedLegacyBinding = Readonly<{
  kind: 'preservedLegacy'; sourceDocumentId: string; revisionId?: never;
}>;
type DocumentEvidence = Readonly<{
  documentId: string; sha256: string; sizeBytes: number;
}>;
type RevisionTarget = InvoiceScope & DocumentEvidence & RevisionBinding;
type PreservedLegacyTarget = InvoiceScope & DocumentEvidence & PreservedLegacyBinding;
type InvoiceDeliveryReservation =
  | Readonly<{ eventId: string; mode: 'customer'; target: RevisionTarget | PreservedLegacyTarget }>
  | Readonly<{ eventId: string; mode: 'smtpTest'; target: RevisionTarget }>;

type ReservedEmailFields = Readonly<{
  recipientEmail: string;
  ccEmail: string;
  subject: string;
  bodyPreview: string;
  createdAt: string;
  createdBy: string;
}>;
type ReserveEmailDeliveryInput = InvoiceDeliveryReservation & ReservedEmailFields;
type ReserveEmailDeliveryResult =
  | Readonly<{
      outcome: 'reserved';
      reservation: InvoiceDeliveryReservation;
      invoiceStatusAtReservation: 'approved' | 'sent';
    }>
  | Readonly<{ outcome: 'conflict' }>;
type EmailCompletionResult = Readonly<{
  outcome: 'completed' | 'alreadyCompleted';
}>;
type EmailSuccess = Readonly<{
  status: 'succeeded'; providerMessageId: string | null;
}>;
type EmailUnsuccessfulOutcome = Readonly<{
  status: 'failed' | 'outcomeUnknown';
  safeErrorMessage: string | null;
  technicalErrorCode: string | null;
}>;
type CustomerEmailCompletionInput = Readonly<{
  reservation: Extract<InvoiceDeliveryReservation, { mode: 'customer' }>;
  result: EmailSuccess;
}>;
type OtherEmailCompletionInput =
  | Readonly<{
      reservation: Extract<InvoiceDeliveryReservation, { mode: 'smtpTest' }>;
      result: EmailSuccess;
    }>
  | Readonly<{
      reservation: InvoiceDeliveryReservation;
      result: EmailUnsuccessfulOutcome;
    }>;
```

`ReservedEmailFields` säilyttää vain nykyisen tapahtuman viestikentät:
täyttä bodya, salaisuutta tai kertavaltuutuksen tokenia ei lisätä tauluun.
Application muodostaa nykyisten sääntöjen mukaisen bodyPreviewn. Asiakas-
lähetyksessä tallennetaan todelliset to/cc-arvot, itselle tehtävässä testissä
pakotettu testivastaanottaja ja tyhjä cc. Fingerprint sitoo edelleen koko
viestin, lähettäjän, aiotun vastaanottajan ja testin todellisen vastaanottajan.
Status varaushetkellä on adapterin lukema tulos, ei callerin päätös tai uusi
historiakenttä. Provider saa alkuperäisen vahvistetun viestin ja jo tarkistetut
PDF-tavut, ei tapahtuman lyhennettyä bodyPreviewta.

LegacyOriginal ei kuulu kumpaankaan varaukseen. Revision PDF:n julkaisu
ottaa vain `RevisionKey`-kohteen ja revision oman ehdokkaan; säilytetyn
legacy-kopion julkaisu on erillinen kapea operaatio, joka vaatii tarkan
lähdedokumentin. Molemmat palauttavat published/existing/conflict-tuloksen,
mutta tuloksen dokumenttityyppi vastaa kyseistä operaatiota. Saman
generointimetodin ei pidä hyväksyä kumpaakin varianttia valinnaisin kenttin.

`getCurrentRevision(scope)` ja `getRevision(key)` palauttavat sisällön sen
alkuperän erottelevana tyyppinä. Legacy-snapshotin saatavuudeltaan tuntematon
ALV-erittely ei ole sama kuin käännetyn ALV:n tunnetusti tyhjä erittely.
Hyväksyntäadapterin sisäinen paluuarvo välittää juuri julkaistun revision
PDF-hookille; hook ei lue myöhemmin määrittelemätöntä uusinta versiota.

Varaus ottaa tarkistetun kohteen ja nykyiset vastaanottaja-/viestikentät,
palauttaa reserved/reservation tai conflict ja muodostaa pysyvän attempted-
rivin ennen verkkoa. Onnistunut asiakaslähetys käyttää nykyistä
`InvoiceEmailDeliveryFinalizer`-vastuuta; testi- ja virhetulokset nykyistä
tapahtuman completion-vastuuta. Molemmat ehdollistetaan samaan varaukseen.
Sama terminal-kuittaus on idempotentti, eri kuittaus ristiriita; pelkkä
event-ID ei riitä. Aikatieto ei saa tehdä toistetusta samasta kuittauksesta
uutta toimitusta. Mahdollista erillistä completion-aikaleimaa ei lisätä
vahingossa vain rajapintaluonnoksen vuoksi.

Kuittauksen idempotenssi tarkoittaa pysyvien sivuvaikutusten toistamattomuutta,
ei myöhemmän laskunäkymän väittämistä alkuperäiseksi HTTP-vastaukseksi.
Finalizerin `alreadyCompleted` ei laske `wasResend`-arvoa uudelleen nyt
sent-tilassa olevasta laskusta eikä muuta `updated_at`-aikaa. Ensimmäisen
lähetyksen application-vastaus saa resend-tiedon juuri tehdyn varauksen
`invoiceStatusAtReservation`-arvosta ja ajantasaisen näkymän nykyiseltä
lukijalta. Saman kuittauksen tunnistaminen vertaa pysyvää event-ID:tä,
company/invoice-rajaa, moodia, koko dokumenttisidosta ja normalisoituja
lopputuloskenttiä; ristiriita käyttää nykyistä `InvoiceDeliveryConflictError`-
virhettä. `created_at` on varauksessa tallennettu nykyinen toimitusaika:
kuittaus ei ota uutta callerin `sentAt`-arvoa eikä luo toista tapahtumaa.
Kuittauksen toisto ei anna lupaa providerin uudelleenkutsuun. Restartin
jälkeen ratkaisematon varaus estää uuden lähetyksen; automaattista
lopputuloksen selvittämistä tai SMTP:n exactly-once-lupausta ei lisätä.

Historian `findEventDocument(scope, eventId)` erottaa document-,
legacyMissingDocument- ja ei-tapahtumaa-tuloksen. Historiallinen null on
sallittu vain omassa variantissaan. Ei-null-viitteen kadonnut tai väärä
dokumentti on eheysvirhe, ei lupa latest-fallbackiin tai regenerointiin.

| Omistava portti / adapteri | Tarkennettava operaatio ja käyttäjät |
| --- | --- |
| Uusi kapea `InvoiceContentRevisionReader` | Nykyinen tarkistettu sisältö hyväksyntä-/PDF-/prepare-poluille sekä erillinen tapahtuman sisältö historian lukuun. Ei muuta `ApprovedInvoiceReader`-lukijan yleistä statuskelpoisuutta. |
| Nykyiset approval-/credit-approval-adapterit | Julkaise yksi valmiiksi laskettu snapshot, rivit ja erittely samassa numerointi/projektio/audit-transaktiossa. Reapprove säilyttää lasku-ID:n ja numeron mutta julkaisee uuden revision. Legacy-siirtymä on erillinen alkuperästä ehdollinen kirjoitus, ei jokaisen luvun fallback. |
| `InvoiceDocumentRepository` | `findDocumentForRevision`, yritys-/laskurajattu tarkka ID-luku sekä `publishDocumentIfCurrent` odotetulla revision-ID:llä. Julkaisu palauttaa published/existing/conflict; olemassa olevan voittajan tiedostoa ei poisteta hävinneen kirjoittajan siivouksessa. Laskukohtainen massapoisto poistuu näiltä poluilta. |
| `InvoiceDocumentStorage` | Omalla uudella ID-polulla exclusive-kirjoitus; rajattu luku palauttaa yhden puskurin. PDF/containment/tyyppi/hash/koko tarkistetaan ennen käyttöä. Provider käyttää samaa puskuria, ei myöhempää uutta polkulukua. |
| `InvoiceDeliveryEventRepository` | Atominen `reserveEmailDelivery`: current-revisio/status, tarkka dokumenttisidos ja persistent unresolved/legacy-estot tarkistetaan `immediate`-transaktiossa ennen provideria. Hylkäys ei käynnistä verkkoa. Nykyinen yleinen `saveDeliveryEvent` ei saa jäädä SMTP:n ohituspoluksi. |
| Nykyinen email-finalizer ja tapahtuman completion | Kaikki lopputulokset ehdollistetaan saman varauksen ID:hen, moodiin ja bindingiin. Customer-success muuttaa vain sidotun nykyisen laskun sent-tilaan; smtpTest-success ei muuta tilaa. Terminal-kuittauksen toisto ei lisää tapahtumaa tai auditia; eri sisältöinen kuittaus torjutaan. |
| Nykyinen manual-finalizer / dry-run | Manuaalisen event/tila/audit-transaktion unresolved-esto säilyy ja saa tarkan revision/document-bindingin. Dry-run kirjataan omalla moodillaan eikä sitä tulkita ulkoiseksi SMTP-varaukseksi tai toimitusvarmuudeksi. Sen jo hyväksytty tilakäyttäytyminen säilyy. |
| `InvoiceDeliveryEventReader` ja historian PDF-käyttötapaus | Yritysrajattu laskuidentiteetin olemassaolo myös reopened-tilassa, tapahtuma -> tarkka katalogoitu dokumentti. Permissionit säilyvät. Historian luku ei palauta lähetysvaltuutta eikä generoi puuttuvaa PDF:ää. |

Toteutuksen tiedostorajaus ja sopimuksen sulkeminen:

- `domain/invoiceContentRevision.ts` määrittää eksplisiittisen muuttumattoman
  sisältötyypin yllä olevan kenttälistan mukaan. Domain ei importoi
  `database/schema.ts`:ää eikä kopioi koko API-vastausta. `legacySnapshot`
  erottaa unavailable-erittelyn authoritative-variantista; vain jälkimmäisen
  `approval`/`validatedLegacySnapshot` kelpaa uuden revision PDF-lähteeksi.
- `ports/invoiceContentRevisionReader.ts` sisältää
  `getCurrentRevision(InvoiceScope)` ja `getRevision(RevisionKey)`:
  `Promise<InvoiceContentRevision | undefined>`. Ei löydettyä kohdetta
  tarkoittaa vain olematonta scoped-avainta; rikkinäinen ei-null-viite tai
  virheellinen sisältö on eheysvirhe, ei undefined tai fallback.
- `domain/invoiceDocumentBinding.ts` omistaa yllä olevat suljetut bindingit;
  `ports/invoiceDocumentRepository.ts` omistaa revision ja preservedLegacy-
  julkaisujen erilliset input-/result-tyypit. Kummassakin tulos on
  published/document, existing/document tai conflict; palautuvan dokumentin
  variantti vastaa kutsua. `findDocumentForRevision(RevisionKey)` ja
  `findDocumentById(InvoiceScope & { documentId: string })` eivät muuta
  kelpoisuutta. Application tarkistaa nykyrevision erikseen ennen käyttöä.
- Julkaisun ehdokas sisältää omalla exclusive-polulla kirjoitetun tiedoston
  metadatan, ei callerin antamaa yhteistä storagePathia. Nykyinen
  `InvoiceDocumentStorage` säilyy tiedostovastuuna; exclusive-kirjoitus ja
  metadataa vastaan varmennettu rajattu luku ovat sen nimetyt operaatiot.
  Vain lukijan palauttama tarkistettu puskuri menee providerille.
- `ports/invoiceDeliveryEventRepository.ts` saa
  `reserveEmailDelivery(ReserveEmailDeliveryInput): Promise<ReserveEmailDeliveryResult>`
  ja `completeDeliveryEvent(OtherEmailCompletionInput): Promise<EmailCompletionResult>`.
  `ports/invoiceEmailDeliveryFinalizer.ts` saa
  `completeSuccessfulEmailDelivery(CustomerEmailCompletionInput): Promise<EmailCompletionResult>`.
  Nykyinen `SqliteInvoiceDeliveryEventRepository` toteuttaa nämä vastuut;
  uusi yleinen varaus-/historiapalvelu ei ole tarpeen.
- `recordInvoiceDeliveryEvent`/`saveDeliveryEvent` rajataan nykyisistä
  callereista vain erikseen tyypitettyyn dry-run-kirjaukseen. SMTP kulkee
  aina varausoperaation kautta, manual sen oman atomisen finalizerin kautta.
  Dry-run ei muuta laskun tilaa eikä esitä oikeaa SMTP-toimitusta.
  Uuden SMTP:n ja legacyUnknownin luonti yleisellä save-portilla torjutaan
  myös runtime-adapterissa, ei vain TypeScriptillä.
- Approval-/credit-approval-portit palauttavat uuden revision avaimen vain
  backendin sisäisessä tuloksessa PDF-hookille; julkinen strict-vastaus
  säilyy erillisessä mapperissa. Reopenin
  `removedDocumentStoragePaths`-paluuarvo ja sitä seuraava julkaistujen PDF:ien
  poistokierros poistuvat korvatuista callereista. Uusi current-osoitin ei
  anna oikeutta muuttaa vanhaa revisiota tai dokumenttia.

Tämän sopimuksen kohdetodisteet tehdään varsinaisten porttien toteutuksessa:
väärän moodin/variantin tyypityshylkäys, samanaikainen reopen/cancel/reserve,
väärä company/revisio/dokumentti/hash/koko, legacy-unresolved uusien
varausten edellä, viiveellinen vanhan revision PDF-julkaisu ja vain oman
ehdokkaan siivous. Finalizer testataan molemmissa moodeissa sekä kaikissa
lopputuloksissa: sama kuittaus on no-op, eri kuittaus hylätään ja onnistunut
testilähetys ei tee sent-siirtymää. Myös uudelleenlähetyksen resend-palaute,
viestin pysyvät kentät ja providerille menevät todelliset tavut todennetaan.
Pelkkä tyyppitarkistus tai SQL-ehdotuksen koe ei ole tämä runtime-näyttö.

Rajattu tyyppikoe tarkisti tämän dokumentin varsinaisen TypeScript-lohkon:
kuusi sallittua varausta/kuittausta hyväksyttiin ja neljä kiellettyä
moodi-/binding-yhdistelmää hylättiin. Kielteiset kontrollit poistamalla
odotettu virhemerkintä tuottivat kukin todellisen tyyppivirheen. Tämä on
luonnoksen tyypitysnäyttö, ei runtime-valtuus tai vielä tuotantoon kytketty
porttitoteutus.

Julkaistu dokumenttirivi on säilytettävää aineistoa. Epäonnistunut cache-luku
ei enää poista sitä eikä regeneroi päälle. Reopen mitätöi vain nykyisen
revision käyttökelpoisuuden. Julkaisemattoman hävinneen ehdokkaan siivous
rajoittuu sen omaan polkuun. Olemassa olevan dokumentin korruptio ilmoitetaan
turvallisesti ja säilytetään tutkittavaksi; tämä ei lisää automaattista
historiallisten PDF:ien korjaajaa.

Valmistelutunnisteen fingerprintiin kuuluvat revision/bindingin identiteetti,
dokumentti ja todellisista tavuista varmennettu hash/koko sekä nykyiset
vastaanottaja-/viestikentät. Native-vahvistus esittää juuri tämän kohteen.
Send ei vaihda valmistelun jälkeen uuteen current-PDF:ään automaattisesti.
In-memory-kertatunniste säilyy valtuusrajana, mutta sen katoaminen restartissa
ei vapauta pysyvää attempted/outcomeUnknown-varausta. DB-transaktioon ei
tule `await`-verkko- tai tiedostotoimintoa.

Nykyisten lukijoiden säilyvät vastuut: `getApprovedInvoice`,
`copyApprovedInvoiceToDraft`, credit-draftin create/get/update, approved-
summary-, sent-group-, payment- ja credit-context-lukijat saavat edelleen
yhden laskuidentiteetin nykytilan. Versioita ei liitetä listoihin tai
saataviin monistavalla liitoksella. `prepareApprovedInvoiceEmailSmtp`,
`prepareApprovedInvoiceEmailSmtpTest`, niiden send-polut, dry-run, manual-
delivery sekä approval/credit-approvalin PDF-kytkentä siirtyvät samaan
tarkkaan sisältösopimukseen. PDF metadata/download ja toimitetun arkistokopion
tehtävä käyttävät oikeaa document-ID:tä, eivät uutta laskukohtaista latest-hakua.

#### Migraation järjestyksen näyttö ja jatko

Rajattu synteettinen koe käytti nykyistä `runMigrations`-runneria sekä
kopioituja muuttamattomia historiallisia migraatioita ja yhtä lisättyä
koemigraatiota. Nykyiset dokumentti- ja tapahtumataulut kopioitiin uusiin
tauluihin. Vanha tapahtumataulu pudotettiin ennen vanhaa dokumenttitaulua,
minkä jälkeen uudet taulut nimettiin ja indeksit palautettiin. Dokumenttien
ja tapahtumien kaikki arvot, myös alkuperäinen null-viite, sekä nykyisen
omistavan katalogin tulos säilyivät. `foreign_key_check` oli puhdas ja
runnerin toinen kutsu ei tehnyt uutta migraatiota.

Viisi pakotettua virhekohtaa (luonti, kopiointi, vanhan lapsen poisto,
vanhan vanhemman poisto ja uudelleennimeäminen) palauttivat alkuperäisen
skeeman, rivit ja migraatiometadatan. Vastakontrolli toisti parent-first-
poiston `SET NULL` -haitan ja perui sen transaktiolla. **Tämä todistaa
korvausjärjestystä, ei vielä yllä ehdotetun uuden skeeman kaikkia ehtoja.**

Riippumaton lähdekatselmus varmisti rajatun FK-verkon: vain toimitustapahtumat
viittaavat dokumentteihin, eikä toimitustapahtumatauluun ole muista tauluista
FK:ta. Invoices-/invoice_lines-tauluja ei tarvitse korvata tämän siirron vuoksi.
Uusi metadata ja migraatiorivi kuuluvat kyseisen migraation transaktioon.
Sen sijaan nykyinen legacy-metadatan ankkurointi tapahtuu ennen sitä omassa
transaktiossaan ja voi jäädä voimaan myöhemmän migraation epäonnistuessa.
Tämä hyväksytty valmisteluvaihe ei ole osittain julkaistu business-migraatio;
sen erillinen rollback-tapaus ja uuden metadatakirjoituksen virhe testataan
varsinaisen SQL:n kanssa. Kiinteä 038-legacy-ankkuri säilyy muuttumattomana.

Varsinainen uusi numeroitu migraatio tekee samaan transaktioon revision
rakenteet, vanhan nykytilan eksplisiittisen legacy-kopion, tarvittavan
current-osoittimen ja doc/event-sidonnat. `reopened_for_edit` ei saa
lähetyskelpoista current-osoitinta. Vanhat tapahtumat saavat legacyOriginal/
legacyUnknown-provenanssin ilman document-ID:n, statuksen tai moodin arvailua.
Migraation ei tarvitse päätellä käyttäjän tarkoittamaa SMTP-käyttötapaa.
LegacySnapshotin hallittu nostaminen tarkistetuksi uudeksi sisältörevisioksi
edellyttää yllä hyväksyttyä ei-ulkoista-historiaa-politiikkaa ja nykyisten
summien yhteensopivuustarkistusta. Vanhaa PDF:ää ei sidota siihen.

Uuden dokumentti-FK:n delete-toiminto on `RESTRICT`, ei `SET NULL`.
Migraatio säilyttää vanhat sallitut nullit, mutta ei salli uuden sidotun
historian hiljaista katkaisemista. Uuden skeeman constraint-, variantti-,
foreign-company-, immutability-, credit-source- ja atomisen hyväksynnän
rollback-testit tehdään varsinaiselle SQL:lle. Ne eivät korvaudu tällä
taulunsiirtokokeella. Nykyisiä numeroituja SQL-tiedostoja ei editoida.

Katalogivalidointi valitsee tunnetun ennen B3:a olevan skeeman tai uuden
skeeman luotetusta migraatioprefixistä; puuttuva uusi sarake ei valitse
legacy-fallbackia. `SqliteInvoiceBackupArtifactCatalog` omistaa varianttien
viiteketjut ja listaa myös vanhat revisiot/legacy-kopiot. Ennen ja jälkeen
forward-migraation vaaditaan sama alkuperäinen katalogi. Uuden aineiston
palautus tarkistaa lisäksi history/current/source/doc/event-sidokset.
Backup-artifact-inventaario, Invoicingin moduuliohje, integraatiomatriisi ja
palautusohje päivitetään toteutuksessa; tämän suunnitelman ehdotusta ei vielä
merkitä niissä toteutuneeksi.

Versionvalinnan tarkennettu kytkentä, polut `apps/backend/src`-juuresta:

| Nykyinen lukukohta | B3/B5:ssa vaadittu välitys |
| --- | --- |
| `runtime/profileSnapshot/inspectSqliteProfileDatabase.ts` | Palauta jo tarkistetusta `MigrationHistoryInspection`-tuloksesta myös käytössä oleva tunnettu migraatioprefixi. `restoreCompatible` säilyttää nykyisen tarkan 038-legacy-ankkurin; virhe ei anna yleistä legacy-fallbackia. |
| `runtime/profileSnapshot/validateProfileSnapshot.ts` → `validateProfileArtifactCatalog.ts` | Välitä juuri tarkistetun staging-tietokannan prefixiin perustuva katalogitila. Ennen forward-migraatiota vanha katalogi validoidaan vanhalla sopimuksella; nykyisen sovelluksen pakettiversio ei yksin valitse uuden skeeman kyselyä. |
| `runtime/workspaceCandidate/runWorkspaceCandidateOperation.ts` | `migrateBackup` tarkistaa lähteen katalogin ja PDF:t lähdehistorian valitsemalla sopimuksella **ennen** `runMigrations`-kutsua. Containerin autentikointi ja purku eivät korvaa tätä. `validateAndMaterialize` käyttää tuoreesti vahvistettua, pending-migraatiotonta nykytilaa ja vertaa samaan alkuperäiseen katalogiin ennen materiaalistamista. `validateHistoricalPublished`/`historicalReadiness` säilyttää oman historiapolitiikkansa. |
| `runtime/profileSnapshot/validateActiveProfile.ts` | Callback palauttaa tarkistetun historian ennen katalogin valintaa; valinta ja palautettu chain kuuluvat samaan tarkastukseen. Eheän historiallisen prefixin pending-migraatio ei yksin hylkää eheyden tarkistusta. Normaalin business-runtimen nolla-pending-portti pysyy erillisenä migraatioiden jälkeen. |
| `http/app.ts`-snapshot-kokoaminen ja `composition/invoicingComposition.ts` | Snapshot-palvelut rekisteröidään jo ennen migraatiota, myös tyhjälle kannalle: portin kokoaminen on laiska, ja katalogitila valitaan `listAuthoritativeArtifacts()`-kutsussa luotetusta silloisesta historiasta maintenance-rajan sisällä. Normaali Invoicing-composition saa tilan vasta migraation jälkeisestä nykytilatarkistuksesta. Käytä samaa ratkaistua migrationsDirectorya kuin runner, myös kun optiona ei annettu hakemistoa. |
| `http/app.ts`-`beforeMigrations` ja desktopin `runtime/backendMessages.ts` | Sisäisesti rikastettu historiatulos **ei** mene sellaisenaan nykyiseen strict-viestiin. Eksplisiittinen projektio säilyttää neljä nykyistä kenttää: appliedMigrationCount, migrationChainIdentity, pendingMigrationCount ja profileState. Desktop-protokollaa ei laajenneta tällä valmistelulla. |
| `runtime/profileSnapshot/createConsistentProfileSnapshot.ts` → `stageProfileBusinessArtifacts.ts` | Nykyinen producer käyttää samaa yllä laiskasti koottua katalogiporttia. Snapshot-/broker-metadatan tai catalog-v1:n laajennus ei ole tarpeen. |

Invoicingin katalogiadapteri omistaa kaksi nimettyä skeemahaaraa ja niiden
SQL:n. Valinta ei tunnustele puuttuvia sarakkeita eikä käsittele SQL-virhettä
vanhan skeeman merkkinä. Uuden haaran tarkastus kattaa myös revision ja sen
sisällön viitesuhteet, vaikka kyseisellä revisiolla ei vielä olisi PDF:ää;
pelkkä dokumenttirivien läpikäynti ei todista koko historian eheyttä.
Sisäinen välitys käyttää nykyistä `MigrationHistoryInspection`-tulosta,
jossa ovat `readonly appliedMigrationNames` ja `migrationChainIdentity`.
`inspectSqliteProfileDatabase` palauttaa ne ja nykyisen `profileId`:n;
startup-tarkistus palauttaa nykyisen tuloksen sekä tarkistetut nimet
backendin sisäisenä `InspectedMigrationStartupState`-tyyppinä. Ulospäin
lähetettävä `MigrationStartupInspection` säilyy ennallaan. Tyhjällä kannalla
nimiluettelo on tyhjä, eikä siitä voi valita käyttökelpoista katalogia.

Pelkkä eheä pre-B3-prefix ei riitä. Nykyisen legacy-katalogin SQL vaatii
`018_create_invoice_documents.sql`:n, ja näissä profiilin backup/restore-
callereissa vaadittu identiteetti syntyy vasta
`025_create_local_runtime_identity.sql`:ssä. Profiilin tarkistus edellyttää
tämän nimetyn migraation sisältymistä vahvistettuun prefixiin sekä nykyisen
identiteettirivin validointia ennen katalogivalintaa. Jatkuva prefix takaa
samalla dokumentti-/tapahtumataulujen edeltävät migraatiot. Tämä nimeää
nykyisen aidosti migroidun profiilin edellytyksen, ei uutta lupausta kaikkien
025–038-julkaisujen backup-tuesta. Tyhjää tai tätä aikaisempaa historiaa ei
arvata legacy-katalogiksi. Metadataa sisältävälle historialle ei aseteta
uutta 038-minimiä metadataa vailla olevan erillisen poikkeuksen perusteella.

Invoicing-infrastruktuurin yksi nimetty valitsin
`selectInvoiceBackupArtifactCatalogSchema(history)` palauttaa
`'legacyDocuments' | 'revisionHistory'`. Uusi haara valitaan nimeltä
lukitun B3-tuotantomigraation esiintymisestä **tarkistetussa applied-prefixissä**,
ei manifestin viimeisestä tiedostosta tai pelkästä migraatiomäärästä.
Tuotantomigraation nimi keskitetään samaan omistavaan toteutukseen sen
lukitsemisen yhteydessä. Katalogin konstruktori,
`validateProfileArtifactCatalog` ja `InvoicingCompositionOptions` saavat
eksplisiittisen `schema`-arvon; optional/default-legacy-haaraa ei ole.
`CurrentActiveProfileValidationService` saa `readMigrationHistory`-callbackin, jota
kutsutaan kerran ennen katalogin SQL:ää ja jonka chain palautetaan tuloksessa.

Valittu katalogiskeema ja callerin historiapolitiikka eivät ole sama asia.
Nykyinen `inspectMigrationStartupState` voi hyväksyä eheän prefixin, jolla
on pending-migraatioita, myös `exactCurrentManifest`-nimisellä politiikalla.
Normaalin aktiivisen runtimen nolla-pending-portti säilyy erillisenä.
`validateActiveProfile` ei lisää tätä käynnistysporttia ennen migraatioita
rekisteröityyn eheyden tarkistukseen: business-rollback tarvitsee vanhan
profiilin validoinnin ennen binary rollbackia. Kutsuja vaatii oman
odotetun chain-identiteetin eikä validointi yksin avaa business-runtimea.
Historiallinen readiness säilyttää oman hyväksytyn pending-ehtonsa: joskus
myös revisionHistory-kanta voi olla historiallinen suhteessa myöhempään
manifestiin. Metadataa vailla oleva legacy-poikkeus säilyy vain nykyisessä
restoreCompatible-polussa kiinteän 038-ankkurin kautta; olemassa olevan
metadatan virhe ei koskaan valitse poikkeusta.

Versionvalinnan toteutustestit lukitaan seuraavasti:

- Tarkistettu vanha prefix nykyisine profiiliedellytyksineen, tyhjän ja
  liian aikaisen prefixin hylkäys, kiinteä 038-restore-poikkeus, sovellettu B3 ja
  B3 myöhempien pending-migraatioiden kanssa; puuttuva keskimmäinen,
  tuntematon tuleva tai väärän checksummin historia hylätään.
- Uuden historian puuttuva uusi sarake hylätään ilman fallbackia. Vanhan
  historian uuden näköiset sarakkeet eivät nosta sitä uuteen sopimukseen.
- Aktiivisen tarkistuksen callback suoritetaan kerran ennen katalogia;
  sen virhe estää katalogihaun ja palautuva chain on samasta tarkastuksesta.
- Workspace-tuonnin väärä lähdekatalogi estää migraation. Sama alkuperäinen
  katalogi vaaditaan migraation jälkeen; muutettu tai puuttuva dokumentti
  hylätään ennen materiaalistamista.
- Oikea composition: tyhjän kannan rekisteröinti, vanha pre-migration-
  snapshot, migraation jälkeinen snapshot, oletushakemiston käynnistys sekä
  ennallaan säilynyt nelikenttäinen desktop-viesti.
- Uuden katalogin tarkistus kattaa myös PDF:tä vailla olevan rikkinäisen
  revision, väärät company/current/source/doc/event-sidokset ja kaikki
  säilytettävät vanhat PDF:t. Koko ketju todennetaan B5:n paketoidussa
  backup -> inspect -> restore -> restart -> compare -ajossa.

Rajattu riippumaton katalogin lähdekatselmus löysi yllä täsmennetyt
pre-migration-, laiskan rekisteröinnin ja strict-viestin rajat. Ne ovat
toteutuksen ehtoja, eivät tässä jo tehtyjä korjauksia tai läpäistyjä testejä.
Tämä ei muuta catalog-v1:n avaimia, portable-containeria, rajoja tai
palautuksen no-merge-periaatetta eikä lisää yleistä migraatiopalvelua.

#### Valmistelun porttien tila

Päivitetty 6.10.2026: valmistelun aiempi approved/SMTP-päätöseste on
ratkaistu. Alla olevat osat eivät korvaa B3/B4:n tai B5:n kokonaisnäyttöä.

1. ALV-lukupolun rajattu korjaus on toteutettu ja kohdetodennettu yllä
   kuvatulla näytöllä. Uuden revisiosnapshotin tallennus ja koko toimituksen
   HTTP/UI/PDF-ketju todistetaan varsinaisessa B3/B4-toteutuksessa; nykyinen
   korjaus ei sulje niitä tai historiallisten PDF:ien ristiriitoja.
2. Kenttä-/DDL-/constraint-ehdotus ja migraation järjestys on valmisteltu.
   Erityinen portti on lähtöketjun `invoice_documents`-unique-rajan muutos
   säilyttäen toimitusviitteet: vanha FK käyttää `ON DELETE SET NULL`,
   joten taulun uudelleenluontia ei käsitellä tavallisena huoltosiirtona.
   Täysi eristetty snapshot-/dokumentti-/tapahtumaehdotus sisältää nyt
   myös kentät ja hyvityksen lähderevision ehdot; sen 102 läpäisyä olivat
   valmistelun näyttöä. Numeroitu 039 on nyt erikseen katselmoitu ja
   kohdetodennettu yllä kuvatulla 117/117-sarjalla. Tavallisen hyväksynnän
   revisiokirjoituksen 13 kohdetestiä läpäisivät. Myöhempien kirjoittajien,
   hyvityksen, PDF:n ja toimitusporttien osanäyttö on kirjattu yllä oleviin
   checkpointteihin. Koko käyttöliittymä-/native-/palautusketjun näyttöä
   ei merkitä niiden perusteella valmiiksi.
3. Revision, dokumentin, toimitusvarauksen ja kuittauksen tyyppisopimukset,
   luku-/kirjoituspolut sekä katalogin luotettu versionvalinta on nimetty
   yllä. Historialuku ei laajenna tavallisen lähetyksen kelpoisuutta.
   Katalogi-/backup-formaattirajat ja nykyinen desktop-viesti säilyvät.
4. B-P3-taulukon vanha `approved` + tuntematon SMTP-moodi ratkaistiin
   omistajan hyväksymällä rajatulla selvitysestolla 6.10.2026. Nykyinen
   metadata ei edelleenkään oikeuta arvaamaan testin ja asiakaslähetyksen
   eroa tai vapauttamaan epävarmaa historiaa automaattisesti.
5. Riippumaton valmistelun kokonaiskatselmus ei löytänyt uutta estävää
   integraatioristiriitaa. Katalogin erillinen lähdekatselmus johti yllä
   kuvattuihin täsmennyksiin. Migraation ja Invoicing-perustan toteutus
   säilyttää vanhan tiedon. Rajattu selvitysesto on nyt hyväksytty;
   automaattista vapautuspäätöstä ei hyväksytty. Valmistelun aiempaa
   päätösestettä ei avata uudelleen pelkän vanhan checkpointin perusteella.
   Tuotantomigraation ja kirjoittajien rajattu näyttö on kirjattu yllä.
   Koko B3/B4-ketjun testit sekä B5:n
   packaged-palautustodistus ja uuden revision PR/main-portit ovat vielä
   tekemättä. Osittaista migraatio–caller-yhdistelmää ei julkaista käyttäjälle.

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
avainta. A1 ei muuttanut myöhäisen kirjoitusvastauksen sopimusta; sen
myöhempi A2-toteutus ja hyväksyntä kuvataan alla.

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

**A2 ja rajattu integraatiojatko hyväksytty jatkokehitykseen 4.10.2026.**
PR #291:n [V2 37137894577](https://github.com/eky-software/eky/actions/runs/37137894577)
ja auditointi sekä PR #292:n
[V2 37144831349](https://github.com/eky-software/eky/actions/runs/37144831349)
ja auditointi läpäisivät. PR #292:n append-korjaus koskee vain synteettisen
MSI-kokeen lokia; tiukka validator ja alkuperäinen hylkäys säilyvät.
Mainin [CI 37146769411](https://github.com/eky-software/eky/actions/runs/37146769411)
hylkäsi DESK-BRIDGE-001:n `firstWindow`-aikakatkaisun: siivous varmennettiin
ja yksi automaattinen uusinta läpäisi. Electron-jobi ja koonti jäivät
flaky-politiikan mukaisesti punaisiksi; muut portit läpäisivät. Omistaja
hyväksyi 4.10.2026 vain tämän tapauksen jatkokehitykseen, ei yleistä
flaky-poikkeusta tai toimitushyväksyntää. Nykyinen vihreä main on erikseen yllä.
Se ei osoita alkuperäistä Electron-käynnistyssyytä korjatuksi.
Alla on toteutuksen kohdennettu näyttö ja aiempien päätösten historia.
A3:a ei toteutettu tämän jatkon osana.

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

**Rajattu etenemispäätös 3.10.2026:** omistaja hyväksyi PR #291:n
integraation jatkamisen myös revision `6e3a521e` yhden onnistuneen uusinnan
perusteella. [Ajossa 37130979386](https://github.com/eky-software/eky/actions/runs/37130979386)
ensimmäinen yritys aikakatkaistiin asennusodotukseen; toinen käytti samaa
lähdettä ja alkuperäistä pakettia sekä läpäisi palautus- ja siivousportit.
Ensivirhe ja sen tuntematon syy säilyvät seurantahavaintona, eivät korjattuna
vikana. Päätös koskee vain tätä tapausta, ei yleistä uusinnalla hyväksymistä.
Muut täsmärevision PR-portit ja mainin omat portit säilyvät. Samalla mukaan
otettava [uusintaohjeen täsmennys](../ai/testing-rules.md#rajattu-vianrajaus-ennen-uusintaa)
tarvitsee päivitetyn PR-revision tarkistukset eikä nollaa vanhan hylkäyksen
uusintarajaa tai muuta sovelluksen hyväksyntäehtoja.

Valmistumiseen tarvitaan hyväksytyn sopimuksen rajattu toteutus,
deterministiset UI-/backend-ketjut ja nykyiset viereiset regressiot,
riippumaton katselmus sekä täsmärevision PR- ja main-portit. Vanhojen
MSI-, timeout- ja ETL-havaintojen jälkiselitys ei ole A2:n tavoite eikä niitä
väitetä suljetuiksi. Uusi todellinen regressio tai pakollisen portin este
käsitellään nykyisen testauskäytännön mukaan.

## Oma yritys: rajattu tallennuskorjaus

**Tila 4.10.2026: toteutus, katselmus ja PR #293:n sekä mainin omat
portit hyväksytty.** Yllä oleva jatkamiskohta omistaa loppunäytön. Omistaja
hyväksyi kaksi toistettua sovellusvikaa korjattaviksi ennen seuraavaa
roadmap-palaa. [Company Settingsin tallennussopimus](../modules/company-settings.md#perustietojen-tallennusvastauksen-sopimus)
omistaa käyttäytymisen; tätä ei laajenneta koko D-paketin toteutukseksi.

| Kohta | Korjaus ja sulkemisehto |
| --- | --- |
| CS-1: statuskysely commitin jälkeen | Permission ja täysi validointi ennen secret-statusta, status ennen master-datan ja auditin atomista kirjoitusta. Pending/failed status ei muuta kantaa/auditia; onnistunut vastaus käyttää luettua todellista tilaa. Application-, composition-/HTTP- ja vuotosuojaregressiot. |
| CS-2: vanha vastaus korvaa uudemman syötteen | Yksi keskeneräinen perustietojen tallennus, session ja muokkausrevision tarkistus ennen response-hydraatiota. Uudempi syöte säilyy ilman väärää onnistumisilmoitusta; failure ja poistunut näkymä eivät hukkaa sitä. Oikea UI/backend-jälkiluku, seuraava käsintallennus ja refresh. |

Muutoksen yhteydessä tarkistetaan nykyinen turvallinen virhe-/operational-
ketju ja business audit. Uutta loggeria tai tapahtumaa ei lisätä pelkän
UI-vastauksen sivuuttamista varten. Riippuvuudet, tietomalli, SQL-adapteri,
secret-brokerin aikarajat, CI-ehdot ja prosessiomistajuus säilyvät.
Kohdesarja, viereiset Company Settings -polut, workspace-testit, tyypitys,
build ja riippumaton katselmus erotetaan myöhemmästä PR/main-hyväksynnästä.

Kohdennettu näyttö nykyisestä muutoksesta:

- Backendin 133 kohdetestiä läpäisivät, mukana aidon composition-/HTTP-
  kytkennän ja SQLite-repositoryn pending/failure/status/audit-rollback-
  tapaukset. Virhevastauksen ja operational-ketjun vuotosuojat tarkistettiin.
- Kolme uutta `COMPANY-SAVE-001...003`-selainregressiota ja kolme nykyistä
  viereistä käyttäjäpolkua läpäisivät oikealla backendillä. Prosessien
  siivous varmennettiin. Ensimmäisen kehitysajon virheellinen
  virheilmoitusselektori korjattiin; sen hylkäys säilyy erillisenä.
- Webin kaikki 690 testiä ja backendin 1 406 testiä läpäisivät. Backendin
  viisi ennestään ohitettua testiä eivät ole läpäisyjä. Workspace-tyypitys,
  E2E-tyypitys ja web-build läpäisivät.
- Riippumaton katselmus ei löytänyt korjattavaa. API-clientin vaihtumisen
  session suoja tarkistettiin koodista; lisätyt selaintestit todentavat
  näkymästä poistumisen ja palaamisen, eivät erillistä client-vaihtokoetta.

Ensimmäistä workspace-testiajoa ei hyväksytty. Muuttumaton desktopin
`resumes rollback normalization after either durable directory rename`
-testi aikakatkaistiin; yksi saman lähteen rajattu diagnostinen uusinta
läpäisi, mutta juurisyy jäi avoimeksi. Tämän jälkeen väärin rajattu
tarkistuskomento käynnisti tahattomasti myös juuren testiketjun. Siinä
muuttumaton `rejects a different valid container selected after inspection`
-palautustesti aikakatkaistiin ja sen siivous epäonnistui. Tätä ajoa ei
käsitellä onnistuneena korvaavana hyväksyntänä tai perusteena uudelle
uusintaketjulle. Ensivirheet ja epävarman siivouksen aineisto säilytetään.
Palautustestin yksi rajattu saman lähteen diagnostinen uusinta läpäisi;
alkuperäisen aikakatkaisun tai siivousvirheen syy ei silti varmistunut.
Desktop-testien omistaja selvittää nämä erilliset havainnot nykyisen
testauskäytännön mukaan; myöhempi integraatio vaatii omat porttinsa tai
nimenomaisen rajauspäätöksen. Aikakatkaisua ei luokitella pelkän uusinnan
perusteella ympäristöviaksi tai tämän sovelluskorjauksen regressioksi.

Rajattu koodikatselmus havaitsi lisäksi, että palautustestin yhteinen
`afterEach` voi poistaa juuren ennen aikakatkaistun testirungon valmistumista.
Tämä on testin siivousriski, ei todiste alkuperäisen hylkäyksen juurisyystä.
Omistajan hyväksymä hyväksyntävalmistelu rajataan tämän testitiedoston
juurten omistajuuteen ja epävarman valmistumisen aineiston säilyttämiseen
nykyisen siivoussopimuksen mukaan. Aikarajat, testin sisältöassertiot,
tuotantokoodi ja yhteinen T3-testialusta säilyvät. Testikohtainen siivous on
toteutettu: vain onnistunut, päättynyt ja keskeyttämätön testirunko sallii
omien juurtensa poiston. Kuusi regressiota tarkistavat onnistumisen,
keskeneräisen ja myöhäisen työn eristyksen, ensivirheen säilymisen,
keskeytyksen sekä siivousvirheen näkyvyyden. Kohdeajo läpäisi kaikki kuusi
alkuperäistä testiä ja nämä kuusi regressiota; desktopin tyypitys ja
riippumaton katselmus läpäisivät. Katselmuksen löytämä regression oman
konsolikaappauksen palautuspuute korjattiin ja myöhäinen hylkäys testattiin.

Siivouskorjauksen jälkeinen normaali workspace-ajo jäi erilliseen,
muuttumattomaan rollback-testin aikakatkaisuun. Palautustestin kaikki siinä
ajossa olleet tapaukset läpäisivät. Rollbackin viimeinen havaittu vaihe oli
toisen keskeytystapauksen normalisointi; testirunko oli kesken ja sen aineisto
säilytettiin. Tämä ei yksilöi juurisyytä. Aiempi uusintaraja säilyy eikä
lisäuusintaa tai PR-ajoa ole käynnistetty.

**Hyväksytty rajattu jatko 4.10.2026:** omistaja hyväksyi rollback-testin
kahden keskeytyskohdan erottamisen omiksi tuoreen fixturen testeikseen.
Molemmat säilyttävät sisältö-, eheyden jälkiluku- ja siivousvaatimukset sekä
nykyisen viiden sekunnin testikohtaisen aikarajan. Kahden testin yhteinen
enimmäisaika kasvaa aiempaan yhteiseen rajaan verrattuna. Tuotantokoodia ei
muuteta. Jako on toteutettu ja riippumattomasti katselmoitu ilman avoimia
löydöksiä. Molempien testitiedostojen kohdesarja läpäisi 41 testiä; koko
workspace-sarja läpäisi 5 400 testiä, ja kahdeksan ennestään ohitettua testiä
säilyi ohitettuna. Koko workspacen tyypitys läpäisi. Nämä eivät todista
vanhan aikakatkaisun juurisyytä korjatuksi eivätkä korvaa nykyisen revision
normaaleja PR/main-portteja. Ne läpäisivät myöhemmin yllä sidotussa
PR #293:n integraatiossa; tämä ei jälkikäteen selitä vanhoja aikakatkaisuja.

Sovelluksen staging-hylkäyspolun siivousvirheen nykyinen best-effort-käsittely
arvioidaan erikseen palautuksen omistavassa työssä, ei uutena sivumuutoksena
Company Settingsiin. Kumpaakaan havaintoa ei suljeta uusinnan läpäisyllä.

Korjaus ei selitä historiallista käyttöliittymän jähmettymistä tai
Electron-CI:n käynnistystimeoutia. D-paketin epäonnistuneen alkuluvun
tallennusesto ja secret-operaatioiden myöhäiset sivuvaikutukset jäävät omiin
kohtiin. Koko koodin myöhempi syväkatselmus ennen Deep Scania kuuluu
[M5:n järjestykseen](release-0.3.0-plan.md#m5-uusi-katselmus-deep-scan-ja-julkaisuportti).

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
| B | [B0:n päätösportti](#b0-laskun-sisältö-ja-toimitus), [Invoicingin ohje](../../apps/backend/src/modules/invoicing/AGENTS.md), [moduulivastuu](../modules/invoicing.md), [hyväksyntä ja reopen](invoice-approval-numbering-plan.md), [PDF-snapshot](invoice-print-data-foundation-plan.md), [toimitus](invoice-delivery-plan.md), [toimitustapahtumat](invoice-delivery-events-plan.md), [SQLite-toimituspysyvyys](sqlite-invoice-delivery-event-persistence-plan.md), [SMTP](email-delivery-and-secrets-plan.md), [hyvitykset](invoice-cancellation-and-credit-note-plan.md), [ADR-0006](../decisions/ADR-0006-local-database-and-query-layer.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [artifact-katalogi](local-backup-artifact-inventory.md), [backup/restore](local-backup-and-restore-plan.md), [E2E-pikaohje](../ai/e2e-test-authoring-guide.md). |
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
| A1 / R01 | Luonnoksen avaamisen kohde, näkyvät arvot ja tallennuksen kohde pysyvät samana myös vastausten valmistuessa väärässä järjestyksessä. | Hyväksytty PR #288:n mainissa; integraation myöhemmät jatkot ja nykyinen lähtörevisio ovat sivun alussa. |
| A2 / R05 | Ensimmäisen createn tunnisteen ja uudempien muokkausten säilyminen. | Hyväksytty jatkokehitykseen yllä kuvatulla A2:n integraationäytöllä ja rajatulla etenemispäätöksellä. |
| A3 / R06 | Muokatun lomakkeen vanhentuneen readinessin torjunta. | Hyväksytty PR #294:n mainissa sivun alun checkpointilla. Backendin hyväksyntäauktoriteetti säilyy. |
| B0 -> B1-B5 | Laskennan, SMTP:n sekä lasku-/PDF-/toimitusrevision rajatut korjaukset. | [Valmistelusuunnitelmassa](#b0-laskun-sisältö-ja-toimitus) B-P1 ja B-P3 on hyväksytty ja B-P2:n historiasuunta valittu. Toteutus ja hyväksyntänäyttö eivät ole vielä valmiita. |
| W7-valmistelu | Omistajan hyväksyttävä poisto-, karanteeni-, palautus- ja nollan työtilan sopimus. | Suunnittelu kulkee rinnalla; toteutus tarvitsee C/K/G/H:n nimetyt kyvykkyydet. |

T1/T2/T3:n sekä A1/A2/A3:n toteutus ja integraatio ovat valmiit. B käyttää
niiden nykyistä testiruntimea eikä avaa alustamekanismien tutkimusta uudelleen.
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
[Jatka tästä](#jatka-tästä) erottaa hyväksytyt T1/T2/T3-, A1/A2/A3- ja
Oma yritys -palat nykyisestä B0-valmistelusta ja B:n päätösjonosta.
Sovelluspalat käyttävät nykyistä feature-/API-sopimusta; jos rajaus vaatii
backendin tai navigoinnin uuden liiketoimintasäännön, se palautuu suunnitteluun.
W7:n päätöksiä ei kysytä yhtenä epämääräisenä lupana, vaan sen omistavan
suunnitelman päätöstaulukon mukaan ennen kunkin vaikutusalueen toteutusta.

Alkuperäisen M1-valmistelun hyväksyntä ja sen rajaus säilyvät
[valmistelun checkpointissa](release-0.3.0-m1-history.md#valmistelun-checkpoint).
Sen jälkeen hyväksytyt T1/T2/T3:n toteutukset eivät sulje A/W7:n tai koko
0.3.0:n valmistumisportteja. Jokaisen seuraavan palan suunnitelma, rajaus,
testit ja ohjeet tarkistetaan ennen toteutusta ja sen valmistuessa.
