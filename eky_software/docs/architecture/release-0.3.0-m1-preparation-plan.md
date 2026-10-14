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
keräysjatkot on hyväksytty PR #297:n mainissa; B3-B5 ja niiden rajatut
integraatiokorjaukset on hyväksytty PR #298:n mainissa 8.10.2026.
C on hyväksytty PR #299:n mainissa 9.10.2026. Nykyinen työ on
[K-paketin toteutus](#k-paketin-valmistelu-ja-hyväksyntärajat).** PR #294:n oma main-kierros
läpäisi; A2:n aiemman main-kierroksen tapauskohtainen etenemispäätös ja
alkuperäinen flaky-havainto säilyvät historiassa eivätkä muutu korjatuiksi.
Modulaarinen monoliitti ja
hyväksytty M1-rajaus säilyvät. Tämä sivu omistaa M1:n nykyisen jatkamiskohdan;
[julkaisusuunnitelma](release-0.3.0-plan.md) omistaa koko 0.3.0:n sisällön.

**Uusin K-jatkamiskohta:** PR #303 yhdistettiin 14.10.2026 normaalisti
mainiin revision `3fb7ad05` hyväksyttyjen PR-porttien jälkeen.
[PR-checkpoint](https://github.com/eky-software/eky/pull/303#issuecomment-6165741060)
varmentaa kaikki valitut jobit ja pakolliset vaiheet sekä erillisen
riippuvuustarkistuksen. Uuden mainin `f2955a06`
[oma V2-kierros](https://github.com/eky-software/eky/actions/runs/38546187248)
hylättiin: MSI-tiedostoversiosäännön `uiOverride`-kokeen lähdeasennuksen
lokitodiste oli puutteellinen, ja laskuhistorian rajatun tapahtumaluennan
muistinkäyttötesti aikakatkaisi. Kokonaisportin hylkäys seuraa näistä kahdesta
varsinaisesta hylkäyksestä. Muut 35 jobia läpäisivät; kuusi valinnaista
diagnostiikkajobia ohitettiin tarkoituksellisesti. Mainin erillinen
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38546187116)
läpäisi. K:n integraatio on siksi edelleen avoin: vihreä PR ei korvaa
mainin omaa hyväksyntää. Aiemmat kierrokset säilyvät historiana.

Omistaja hyväksyi yhden rajatun
[MSI-lokikokeen](windows-installer-acceptance-harness-v2.md#msi-tiedostoversiosäännön-koe):
synteettisen fixturen append-lokiin lisätään rivikohtainen flush, ja
komentorajauksen regressioiden sekä katselmuksen jälkeen ajetaan kerran
nykyinen nimetty koe. Puuttuva UI-järjestystodiste hylätään edelleen;
asennuksen onnistumiskoodi ei korvaa sitä. Laskuhistorian timeout tutkitaan
erikseen nykyisestä testistä ja sen kutsumasta koodista. Näiden perusteella
ei muuteta tuotannon asennuksia, liiketoimintasääntöjä, aineistomäärää,
aikarajoja tai hyväksyntäehtoja eikä nimetä aiempia timeout-syitä korjatuiksi.

**Aiempi PR-todennus ja avoin MSI-asennusodotus:**
[Hyväksytyn testijaon checkpoint](#kn-nykyinen-pr-checkpoint-ja-valmistelukoe).
Rajatut testikorjaukset läpäisivät normaalin CI:n, mutta asennusodotus
hylättiin myös yhdessä rajatussa uusinnassa. Myöhempi lokikoe läpäisi
varsinaisen palautusskenaarion; lokin 8 MiB:n ylitys esti fixture-poiston.
Omistajan hyväksymä 64 MiB:n korjaus sekä saman paketin uusi nimetty koe
läpäisivät. Koko MSI-loki, ajosidonta ja kylmä purku on varmennettu.
Korjausketju vietiin lineaarisesti PR-haaraan. Sen normaalista kierroksesta
löytyi vanhentunut upgrade-workflow-testin upload-kielto; rajattu korjaus on
kohdetodennettu. Kierros päättyi: workspace- ja legacy-kuluttajat läpäisivät,
mutta upgrade-valmistelu ja siitä riippuva kokonaisportti hylättiin.
Omistaja hyväksyi myös muiden salattujen lokien ja raporttien 64/128 MiB:n
budjetin noston; keräinten kokonaisbudjetti on 512 MiB. Korjausrevision
rajatestit, salaus/purku, CI-kytkennän kohdetestit ja katselmus läpäisivät.
Korjausrevision `507c095b` normaali [V2-kierros](https://github.com/eky-software/eky/actions/runs/38446355937)
päättyi: 36 jobia läpäisi, Electronin kriittinen jobi ja siitä riippuva
kokonaisportti hylättiin, kuusi valinnaista jobia ohitettiin.
Erillinen [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38446355963)
läpäisi. `DESK-WORKSPACE-MIGRATION-INVENTORY-001`:n ensimmäinen yritys
aikakatkaisi fixturen `firstWindow`-vaiheessa ennen testirunkoa; automaattinen
uusinta läpäisi. Ensivirheen salatun aineiston sidonta, purku ja tiedostojen
tiivisteet on varmennettu, ja prosessisiivous onnistui. Läpäissyt uusinta ei
muuta ensimmäistä hylkäystä onnistumiseksi tai osoita sen syytä korjatuksi.

Rajattu lähdekatselmus ja erillinen synteettinen migraation luonnehdintakoe
eivät vahvistaneet korjattavaa juurisyytä. Koe ei ollut hylätyn Electron-testin
uusinta eikä korvaa paketoidun runtimen tai CI:n näyttöä. Nykyinen yhden
uusinnan kiintiö on käytetty. PR:ää tai K:ta ei ole hyväksytty eikä mergeä tehty.

**Rajattu jatko työn alla:** migraation sisäisen vaiheen havainto nykyiseen
käynnistyshavaintoketjuun. Kytkentä erottaa manifestin luvun, alkutilan
rakennetarkistuksen, historian valmistelun, migraatioiden suorituksen,
loppurakennetarkistuksen, käynnistystä edeltävän jälkitarkistuksen ja
runtime-identiteetin luvun. Jokaisella on vain aloitus ja paluu; yksi
käynnistys tuottaa enintään 14 uutta havaintoa, ei riviä per migraatio.
Vaihe on viimeinen havaittu työ, ei virheen syy. Toteutuksessa pitää olla
yksi omistava vaiheiden määrittely ja täsmällinen lähettäjä/lukija-sopimus;
ei SQL:n, tiedostonimien, tunnisteiden tai raakatulosteiden keräystä.
Callback on valinnainen eikä odota kirjoitusta tai kuittausta.
Havaitsijan virhe ei saa korvata migraation tulosta, muuttaa valmiusehtoa
tai estää siivousta. Backendin callback on kytketty vain E2E-adapteriin;
tuotannon operatiiviseen lokiin, diagnostiikkaan, Activityyn tai tukipakettiin
ei lisätä tapahtumia. Rajatut migraatio-/app-/adapteritestit, suljetun
havaintoketjun regressiot ja riippumaton katselmus läpäisivät. Erillinen
synteettinen Electron utility -koe todensi uuden aloitushavainnon kulun IPC:n
yli sekä sen säilymisen lapsen päättymisen ja varmennetun prosessisiivouksen
jälkeen nykyisessä lifecycle-tiedostossa ja liitteessä. Koekäynnistimen oma
ensihylkäys säilyy erillisenä; korjattu koe ei ole alkuperäisen CI-testin uusinta.
Koe ei aja koko sovelluksen käynnistystä eikä todista viiveen syytä korjatuksi.
Seuraava CI-todennus käyttää yhtä jäädytettyä havaintokorjausrevisiota ja
nykyisen CI-työnkulun erillistä Windows Electron -jobia nykyisine
packaged-smoke-, legacy- ja käynnistyshavaintotarkistuksineen. Se ei korvaa
normaaleja PR-portteja eikä käynnistä koko asennusmatriisia. Uuden
virheen odotettu lisätieto on viimeinen migraation sisäinen aloitus tai paluu;
puuttuva havainto jää epävarmaksi. Täysi K-hyväksyntä ja PR/main-portit ovat
avoimia, eikä vanhaa `507c095b`-hylkäystä merkitä läpäisyksi.

**Havaintokorjauksen nimetty CI-todennus päättyi eri hylkäykseen:**
revision `99944c86` [Windows Electron -ajo](https://github.com/eky-software/eky/actions/runs/38459454266)
läpäisi paketoinnin, tavallisen packaged-smoken, alkuperäisen 038-kopion
palautuksen ja cold-create-palautuksen. `DESK-WORKSPACE-COLD-PACKAGED-IMPORT-001`
hylättiin ensimmäisen savutestiprosessin `invoicePdfArchive`-vaiheessa
koodilla `PACKAGED_SMOKE_FAILED` ja prosessin poistumiskoodilla 1. Tämä ei
ollut testin aikakatkaisu; varsinaiset Electron-käyttäjäpolut ja erillinen
käynnistyshavainnon CI-tarkistus eivät käynnistyneet. Salattu ensivirhepaketti,
ajosidonta ja kolmen tiedoston tiivisteet on varmennettu. Siivousraportti
on `notVerified`, eikä sitä tulkita onnistuneeksi. Alkuperäinen poikkeus
ei yksilöidy säilyneestä yleisestä koodista; viimeinen vaihe ei todista
arkistointivirheen juurisyytä. Uusintaa tai mergeä ei tehty, PR-head pysyy
edellisessä revisiossa. Seuraavaksi rajataan tämä hyväksynnän este nykyisestä
savutestistä ja sen kutsumasta koodista, erillään alkuperäisestä
`firstWindow`-viiveestä. Havaintokorjauksen hosted-todennus on yhä avoin.

**Alkuperäisten testivirheiden yhteinen kytkentä on hyväksytty toteutettavaksi:**
rajattu lähdekatselmus paikansi yleiseksi koodiksi muuntamisen
`desktopComposition.ts`:n savutestin catch-haaraan. Nykyinen salattu toimitus
säilytti sille annetut tiedostot; keräysbudjetti ei palauta jo korvattua
poikkeusta. Arkistopalvelun, hakemistojen tarkistuksen, laskun
monirevisiofixturen, savutestisopimuksen ja turvallisen startupin nykyiset
54 kohdetestiä läpäisivät. Tämä ei toista tai selitä CI-hylkäystä.
Omistajan uudempi päätös hyväksyi nykyisen salatun järjestelmän täydentämisen
testiperheiden oletuskytkennäksi. Yhteinen rajattu virheprojektio palvelee
Node-, Vitest-, Playwright- ja native-testejä; paketoidun savutestin catch
tarjoaa alkuperäisen poikkeuksen nykyiselle opt-in-havaitsijalle ennen
virhemuunnosta. Julkiset virheet sekä profiilien, tietokantojen ja
riippuvuustyökalujen yleisen raakatulosteen poissulku säilyvät. Ei uutta
testiruntimea, supervisoria, riippuvuutta tai hyväksyntäaikarajojen muutosta.
Nykyisen enintään 500 ms:n rajatun toimitusodotuksen tulos ei korvaa
testitulosta tai siivoustodistetta. Omistava käyttöohje on
[salatun virheaineiston yhteinen liitäntä](ci-encrypted-evidence.md#yhteinen-alkuperäisen-testivirheen-liitäntä).
Valmistuminen vaatii pakotetut virheet, alkuperäisen syyn todellisen
salaus/purku-todisteen, tuloksen säilymisen regressiot ja katselmuksen.
Näiden jälkeen seuraa yksi nimetty Windows-todennus. Tämä ei nimeä
arkistointivirhettä korjatuksi eikä sulje K:n PR/main-portteja.

**Yhteisen virhekeräyksen paikallinen checkpoint:** Node-, Vitest- ja
Playwright-runnerin sekä native command-phase/worker -ketjun pakotettu
alkuperäinen poikkeus, kutsupino ja syyketju on todennettu oikeasti puretusta
OpenPGP-paketista. Sama koe kattaa sisäisesti käsitellyn semantic-virheen,
ensivirheen säilymisen tiedostokiintiössä sekä synteettisen ASAR-sidonnaisen
packaged-poikkeuksen. Tunnetun testisalaisuuden peitto ja turvallisen
virhetuloksen säilyminen on todennettu. Native-kytkennän omistajapolku,
kiintiön keräysjärjestys ja paikallisesti käsitellyt poikkeukset korjattiin
katselmuksen perusteella; niille lisättiin regressiot. Aiempi Linuxin
riippuvuuksista vapaa salauskoe säilyy erillään asennettuja testityökaluja
käyttävistä kokeista. Desktopin palautus-/käynnistyskohdesarja ja
tyyppitarkistus läpäisivät. Tämä on rajattua paikallista näyttöä, ei uusi
PR/main-hyväksyntä. Seuraava työ on yksi jäädytetyn korjausrevision
Windows Electron -todennus nykyisessä työnkulussa; ensivirhe ja mahdollisen
salatun paketin alkuperäinen syy tarkistetaan ennen jatkopäätöstä.

### Yhteisen virhekeräyksen Windows-kohdetodennus

Korjausrevision `10459c8319fd7b7e4221629c97d94bc564d38f21`
[nimetty Windows-ajo 38475500390](https://github.com/eky-software/eky/actions/runs/38475500390)
läpäisi paketoinnin, tavallisen packaged-smoken, kaikki kolme paketoitua
legacy-/cold-palautustapausta, 47 kriittistä Electron-testiä ja yhden
erillisen käynnistyshavaintojen sopimustestin. Kaikki testit läpäisivät
ensimmäisellä yrityksellä. Neljä tähän kohdeajoon valitsematonta jobia
ohitettiin; niitä ei lasketa läpäisyiksi.

Onnistunut kohdeajo ei lähettänyt salattua virhepakettia. Alkuperäisen
poikkeuksen salaus ja todellinen purku on todennettu yllä kuvatuilla
pakotetuilla paikallisilla virheillä. Aiemmat `firstWindow`- ja
`invoicePdfArchive`-hylkäykset säilyvät omien revisioidensa havaintoina;
niiden juurisyytä ei nimetä tämän läpäisyn perusteella korjatuksi.
Kohdeajo mahdollistaa korjausketjun lineaarisen viennin PR #303:n haaraan.
Seuraava hyväksyntä on uuden PR-headin normaali kierros ja erillinen
riippuvuustarkistus, sitten valtuutettu merge ja uuden mainin omat portit.
Tämä kohdenäyttö ei sulje K:ta tai koko 0.3.0-julkaisua.

### Virhekeräyksen normaalin PR-kierroksen jatko

PR #303:n revision `b024b4e65573bce92ef5599da866e76253557625`
[normaali V2-kierros](https://github.com/eky-software/eky/actions/runs/38478269003)
päättyi hylkäykseen: 26 jobia läpäisi, neljä varsinaista jobia sekä niistä
riippuva kokonaisportti hylättiin ja kymmenen jobia ohitettiin. Molemmat
upgrade-/rollback-ajot läpäisivät. Erillinen
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38478268993)
läpäisi samalla headilla.

Neljän ensivirhepaketin ajosidonta, salauksen purku ja säilyneiden tiedostojen
tiivisteet on varmennettu. Workspace- ja legacy-sopimustestien alkuperäiset
assertion-virheet johtuvat uuden reporter-valinnan puuttumisesta testien
tarkoista komentojono-odotuksista. Odotukset on korjattu säilyttäen testien
täsmällinen tiedostoluettelo ja ryhmäjako. Laajempi ajokytkennän tarkistus
löysi saman poikkeaman myös E2E:n kahden testiryhmän odotuksista. Näiden
korjaus ja reporter-valinnan puuttumisen regressiot läpäisivät 71 tarkistusta.

Core-testisarjan ensimmäinen hylkäys oli C-palautuksen valtuustestin
aikakatkaisu. Keskeneräinen testirunko piti jaetun tilan suojan voimassa;
myöhemmät saman tiedoston suojahylkäykset eivät ole erillisiä sovellusvikoja.
Yksi rajattu erillisajo läpäisi, mutta alkuperäisen viiveen syy jää avoimeksi.
Keräimen tiedostokiintiö rajasi myöhempiä virheitä; ensimmäisen testin
alkuperäinen timeout ja kutsupino säilyivät. Kiintiötä ei muutettu.

Windows Electron -jobin tavallinen packaged-smoke pysähtyi `restoreRestart`-
vaiheeseen ennen E2E-testien aloitusta. Alkuperäinen syyketju osoittaa
backendin hallitun sulun aikakatkaisun. Siivouksen tila oli `notVerified`.
Lähdekatselmuksen erillinen HTTP-koe toisti käyttämättömän TCP-yhteyden
estämän sulun; tämän yhteys juuri CI-hylkäykseen on vielä todentamatta.
Rajattu korjaus sulkee yhteydet, joilta ei ole hyväksytty ensimmäistäkään
HTTP-pyyntöä. Aloitetut pyynnöt ja keskeneräiset POST-rungot valmistuvat
normaalin hallitun sulun kautta. Prosessin poistumisen, palautusjournalin,
kirjoitussuojan ja aikarajojen ehdot säilyvät. Kohdetestit eivät yksin
hyväksy paketoitua palautusta tai K:n PR/main-integraatiota.

HTTP-korjauksen seitsemän oikean yhteyden regressiota, 72 HTTP-alueen
tarkistusta ja 176 desktopin sulku-/palautusrajan tarkistusta läpäisivät.
Regressiot kattavat myös uuden yhteyden torjunnan keskeneräisen vastauksen
hallittuun sulkuun jäämisen aikana. Rajattu riippumaton lähdekatselmus ei
löytänyt estävää puutetta. Koko työtilan tyyppitarkistus läpäisi.

Korjatun lähteen laajassa työtilatestissä desktopin, webin ja molempien
E2E-infrastruktuuriryhmien testit läpäisivät. Backendin historian
muistiallokointia tarkistava testi ylitti nykyisen viiden sekunnin rajan;
sen yksi sallittu erillisajo läpäisi. Ensihylkäys ja avoin syy säilyvät,
eikä laajaa ajoa kirjata kokonaisläpäisyksi. Testiä, sen aineistoa tai
aikarajaa ei muutettu. Uuden revision normaalit PR-portit, samaan pakettiin
sidottu Windows-palautus ja Linux-todennus vaaditaan edelleen ennen mergeä.

**Revision `0ea87a3203afb2585b1f0eb949a25924d49227d0` uusi kierros:**
[V2](https://github.com/eky-software/eky/actions/runs/38524346602)
päättyi hylkäykseen: 36 jobia läpäisi, core-jobi ja siitä riippuva
kokonaisportti hylättiin, kuusi valinnaista jobia ohitettiin. Erillinen
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38524346682)
läpäisi. Windowsin installer-, Electron-, upgrade-, workspace- ja
legacy-portit läpäisivät; tämä ei silti hyväksy koko K:ta.

Core-jobin ensimmäinen virhe on edelleen nimetty C-palautustestin
aikakatkaisu. Salatun aineiston ajosidonta ja tiivisteet on varmennettu;
myöhään valmistunut testityö ja sen siivous erotetaan alkuperäisestä
hylkäyksestä. Muut saman tiedoston hylkäykset johtuvat keskeneräisen työn
suojasta, jota ei poisteta. Core-jobin myöhemmät build- ja Linux-todennukset
eivät tämän hylkäyksen jälkeen suorittuneet.

Rajattu lähde- ja riippumaton turvarajojen katselmus ei oikeuta poistamaan
journalin julkaisu-, poisto-, sisältö- tai omistajuustarkistuksia.
CI-loki vahvistaa usean paketin testien samanaikaisen ajon, mutta tämä ei
yksin todista aikakatkaisun syytä. Omistaja hyväksyi yhden pakettikokeen,
jonka peräkkäisessä vaiheessa desktopin, backendin, webin ja E2E-työkalujen
nykyiset testiskriptit läpäisivät. Lähde säilyi samana ajon ajan. Kokeen
valmistelu käynnisti lisäksi juuren tavallisen testiskriptin; sen tulokset
eivät muodosta toista riippumatonta hyväksyntää eikä päällekkäisiä testejä
lasketa yhteen. Tämä ei ole puhdas ajotapojen vertailu, hosted-näyttö tai
alkuperäisen timeoutin syyn todistus.

Omistajan hyväksymä kytkentä rajaa vain core-CI:n testivaiheen pakettisarjat
peräkkäisiksi ja sulkee juuren orkestroivan skriptin nimenomaisesti pois.
Pakettien nykyiset testiskriptit, sisäiset työntekijät, pretest-vaiheet,
reporterit sekä testien ja jobin aikarajat säilyvät. Kytkentä sisältää
nykyisen ajokytkentätestin ja [testausohjeen](../ai/testing-rules.md#core-cin-pakettisarjojen-ajo)
päivityksen. Omistaja hyväksyi
kytkennän ja yhden normaalin PR-kierroksen. Toteutus, kohdetarkistukset ja
rajattu katselmus läpäisivät: 125 ajokytkentätarkistusta ja 414 CI-sopimustestiä.
Valintakontrolli todensi nykyiset 11 alipakettia ilman juuren skriptiä.
Negatiiviset kontrollit hylkäävät rinnakkaisen pakettiajon, juuren
uudelleenkäynnistyksen, puuttuvan poissulun ja ensimmäisen virheen ohituksen.
Nykyinen riskiluokitin vaatii kaikista porttiryhmistä normaalin täyden
PR-kierroksen, kaksi matriisitoistoa ja viisi workspace-fault-skenaariota.
Aiempi uusinta ei saa uutta kiintiötä
HTTP-/reporter-korjauksen revisionvaihdosta. PR- ja main-hyväksyntä säilyvät
avoimina.

| Kohta | Nykyinen lähtötieto |
| --- | --- |
| Hyväksytty lähtörevisio | PR #299:n main `250cd9c32914d1e6f35cea76f2b45055891534e2`. [Loppuhyväksyntä](https://github.com/eky-software/eky/pull/299#issuecomment-6081351779) sitoo hyväksytyn headin `447035fe2d0740d454ac79b32cf0e64c1c2906f9`, katselmoidun puun sekä PR:n ja mainin näytön. PR #298:n ja aiempien integraatioiden hyväksynnät säilyvät; alkuperäisten timeoutien syytä ei tämän perusteella nimetä korjatuksi. |
| Mainin omat portit | [V2 37930080841](https://github.com/eky-software/eky/actions/runs/37930080841) ja erillinen [riippuvuustarkistus 37930079798](https://github.com/eky-software/eky/actions/runs/37930079798) läpäisivät yllä olevalla main-revisiolla. Myös PR:n [V2 37926940850](https://github.com/eky-software/eky/actions/runs/37926940850) ja [riippuvuustarkistus 37926940549](https://github.com/eky-software/eky/actions/runs/37926940549) läpäisivät hyväksytyllä headilla. Kumpikin V2-kierros läpäisi 38 jobia; kuusi valinnaista ohitusta eivät ole läpäisyjä. |
| Suljettu työ | T1/R27:n ajokytkentä, T2/R29:n puhtaan valmistelun suoja ja T3/R28:n todellisten kuluttajien koko prosessipuun omistajuus. Korvatut aktiiviset fallbackit on poistettu ja [pysyvä T3-matriisi](r0-e2e-test-matrix.md#t3-prosessipuun-omistajuus) hyväksytty. PR #281 sulki tämän jälkeisen rollback-testiapurin integraatiojatkon. |
| Avoimet havainnot | Aiemmat satunnaiset Electron-käynnistys- ja packaged/legacy-timeoutit säilyvät epäonnistuneina havaintoina omille revisioilleen. Myöhempi vihreä ajo ei todista niiden kaikkia syitä korjatuiksi. [Hylkäysten historia](e2e-test-environment-history.md#dokumentti-mainin-hylkäys-ja-rajattu-diagnostiikkajatko) ja [rajattu apurikorjaus](e2e-test-environment-history.md#rollback-testiapurin-ennenaikaisen-poistumisen-korjaus) erotetaan toisistaan. |
| Nykyinen työ | [V2ax:n hyväksytyt päätökset](#v2ax-backendin-jälkeisen-terminal-valtuuden-päätösrajat), [V2bb:n live-terminal](#v2bb-live-terminalin-tuore-valtuus) ja [V2bc:n C-alkuperäisketju](#v2bc-cn-alkuperäisketjun-terminal) säilyvät. [V2bd](#v2bd-tarkistusvirheen-jälkeinen-rollback-valtuus) kytkee tuoreen rollback-valtuuden pysäytetyn backendin jälkeiseen virhehaaraan. [V2be](#v2be-cn-business-valmistumisen-journal-sidonta) säilyttää täsmällisen update-valinnan valmistumis- ja virhekirjoitukseen asti. Puuttuva tai vanhentunut valtuus ei oikeuta tiedostomuutoksia. Alkuperäiskannan poissaolo ei oikeuta uuden business-runtimen valintaa, vaikka tiedostorollback palauttaisi poissaolon oikein. Rajattu kohdenäyttö ei ole koko K:n hyväksyntä. |
| Seuraava työ | [Historian osissa luennan tuotantokytkentä](#historian-luennan-toteutussopimus) ja [katalogin muistivirheen syyketju](#katalogin-muistivirheen-syyketju) on kohdetodennettu; korvatut historian kokonaistaulukot ja kasvavat kartat/joukot on poistettu. [Historian eristetyn ajon kohdenäyttö](#historian-eristetyn-ajon-kohdenäyttö) erottaa todellisen utility-ketjun ja ajurin muistirajakokeen koko K:n hyväksynnästä. K:n rajattu loppukatselmus, puhtaan revision paketointi sekä saman paketin nyky-/038- ja cold-palautukset läpäisivät alla nimetylle revisiolle. Seuraavaksi jäädytetyn PR-headin normaalit portit, mukaan lukien [Linux-ajopolun](#linux-tarkistuksen-ajopolun-päätös) oikea Electron-todennus ja binaarihandoff. [Pakettibudjetin](#paketoinnin-budjettipäätös) puhdas paketti läpäisi tarkistukset; uusi PR- tai main-revisio tarvitsee omat porttinsa. Hyväksytyt PDF-/journal-kytkennät säilyvät. Alkuperäisiä aikakatkaisuja ei merkitä korjatuiksi eikä [hylättyä hyväksyntäjournalin sijoitteluehdokasta](#hyväksyntäjournalin-viimeiset-lukuvälit) oteta käyttöön. |
| Ei vielä valmis | K, W7, M1:n muu sovellustyö, D-paketin muut ehdot ja koko 0.3.0. Lähtörevision läpäisy ei hyväksy uuden revision puuttuvia portteja. |
| Uusin käyttäjäpolkunäyttö | [V2ah:n toimitus- ja sulkujärjestyskorjaus](#v2ah-electron-testiruntimen-tarkistusajuritoimitus) läpäisi yhden nimetyn Windows-Electron-kohdeajon: tuonnin schema-hylkäys, korvauksen schema-hylkäys ja native-vahvistuksen peruutus. Ensihylkäykset säilyvät erillisinä. Tämä on kohdenäyttö, ei durable-aktivoinnin, hardened-paketin tai PR/main-porttien hyväksyntä. |

**Aktiivivalidoinnin nykyinen checkpoint:** [V2bj](#v2bj-aktiiviprofiilin-eristetyn-tarkistuksen-valmistelu)
on kytketty tavalliseen ja palautuksen jälkeiseen startupiin, live-päivityksen
valmisteluun ja handoffiin sekä ensimmäiseen käynnistykseen ja C-palautukseen
[kutsujakohtaisella omistajuudella](#aktiivivalidoinnin-kutsujakohtainen-omistajuus).
Ensimmäinen käynnistys tekee uuden tarkistuksen, ja C välittää erikseen
täsmällisen update-valinnan sekä odotetun alkuperäisketjun. Näiden kutsujien
vanhaa raskasta broker-validaattoria ei enää käytetä. Koko vanhan protokollan
poistamista tai K:n hyväksyntää ei päätellä tästä kohdenäytöstä.
V2bi:n alkuperäiset aikakatkaisut pysyvät avoimina. Alla oleva katselmus
erottaa korjattujen kytkentöjen ja candidate-avausrajan kohdenäytön loppuporteista.

**K3:n rajattu syytietokorjaus on kohdetodennettu:** palautuksen hyväksynnän
loppuvaiheen turvallinen ensisyy ja vaihe välittyvät nykyiseen diagnostiikkaan
ja tukipakettiin. [Hyväksytty tapahtumasopimus ja näyttö](#hyväksynnän-loppuvaiheen-syytieto)
eivät muuta journalin tarkistuskohtia tai selitä alkuperäistä aikakatkaisua.
K:n suuren katalogin, paketoinnin ja integraation avoimet portit säilyvät.

**Hyväksyntäjournalin nopeutusehdokkaita ei ole hyväksytty:** myös viimeisten
lukujen jälkeen tehtävän lisätarkistuksen koe hylättiin. Se sulki aiemmat
koeaukot mutta avasi journal-slottien muutosriskin. Tarkennettu koe löysi
lisäksi keskeneräisen K-työpuun nykyiseenkin polkuun yhteisen viimeisen
sisäisen luvun havaintorajan. [Jatkokokeen tulos](#hyväksyntäjournalin-viimeiset-lukuvälit) erottaa synteettisen
vastatapauksen todellisen omistajuussuojan ja asennetun version näytöstä.
Nykyinen yhteistyötä noudattavien Eky-prosessien omistajuussopimus säilyy;
koe ei laajenna sitä mielivaltaisten ulkopuolisten kirjoittajien estämiseen.
Uutta pitkää palautusajoa ei tehdä tämän perusteella.

**Erillinen lähtörevision seurantahavainto:** ajastettu
[V2-kierros 38229840996](https://github.com/eky-software/eky/actions/runs/38229840996)
hylättiin Electron-testin ensiyrityksen aikakatkaisun vuoksi, vaikka testin
uusinta läpäisi. Ajo käytti yllä olevaa lähtörevisiota, ei keskeneräistä K-puuta.
[Riippuvuustarkistus 38230906869](https://github.com/eky-software/eky/actions/runs/38230906869)
läpäisi erikseen. Ensivirheen salattu aineisto on säilytetty ja varmennettu;
historiallinen integraatiohyväksyntä, uusi seurantahylkäys ja K:n puuttuva
hyväksyntä eivät ole sama asia. Uutta ajoa ei käynnistetty tämän havainnon vuoksi.

### K:n nykyinen PR-checkpoint ja valmistelukoe

**Edellisen normaalin kierroksen checkpoint 13.10.2026:** PR #303:n head
`3e3420df107d55c89917409012e877089e64ac26` sisältää alla hyväksytyn yhden
palautustestin valmistelujaon sekä täsmällistä Playwright-sivua odottavan
PDF-testikorjauksen. [Normaali V2-kierros](https://github.com/eky-software/eky/actions/runs/38389745059)
ja sen yksi rajattu uusinta hylättiin. PR-merge-checkoutin
`eec0ff9a3bc730eb37b6705837722bdb04e16536` puu varmennettiin headin puuksi.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38389745075)
läpäisi erikseen.

Normaalissa kierroksessa koko työtilan testit, tyyppitarkistukset ja käännökset,
Linuxin oikea eristetty tarkistusprosessi siivouksineen sekä Windowsin
packaged-smoke ja kolme legacy-testiä läpäisivät. Electronin 47 ja webin 77
valittua käyttäjäpolkutestiä läpäisivät ilman uusintaa. System-sarjassa
831 testiä läpäisi ja yksi Windowsiin rajattu tapaus ohitettiin tarkoituksella;
ohitusta ei lasketa läpäisyksi. Näyttö korvaa alla olevan vanhemman headin
puuttuvat Linux- ja PDF-portit, mutta ei koko K:n integraatiohyväksyntää.

Ensimmäinen hylkäys koski workspace-fault-kuluttajan ensimmäistä toistoa,
`activeWorkspaceFirstStartFailure`-skenaarion `targetInstall`-odotusta.
Saman lähteen ja täsmälleen saman valmiin paketin yksi rajattu job-uusinta
läpäisi tämän skenaarion ja keskeytyspalautuksen, mutta hylättiin
`passiveWorkspaceMigrationFailure`-skenaarion samassa `targetInstall`-odotuksessa.
Kummassakin nykyinen MSI-havaitsija näki saman Windows-istunnon
asenninprosessin, eikä varsinaiseen skenaarion palautusvikaan asti päästy.
Prosessin olemassaolo ei todista sen etenemistä, odotuksen juurisyytä tai
GitHub-infrastruktuurin vikaa. Saman paketin toinen ennalta määrätty
workspace-fault-toisto läpäisi kaikki viisi skenaariota; se ei kumoa hylkäyksiä.

Molempien yritysten lokit ja salatut liitteet säilytettiin erillisinä,
sidonnat ja tiivisteet varmennettiin. Omistetun prosessipuun, asennuksen ja
testiaineiston siivous varmennettiin, mutta hylättyjen skenaarioiden
varsinainen palautustodistus jäi saavuttamatta. Nykyinen salattu keräys
säilytti vaiheiden tuloksia, ei kohdeasentimen alkuperäistä syylokia;
myös väliaikaistiedostojen keräysraja täyttyi. Rajan täyttyminen ei yksin
selitä puuttuvaa syylokia, eikä sen kasvattamista ole hyväksytty.

V2:n molempiin yrityksiin jäi 36 onnistunutta job-merkintää, yksi varsinainen
hylkäys, sen koontiportin hylkäys ja kuusi valitsematonta diagnostiikkajobia.
Uusinnan muiden jobien aiemmin valmistuneet tulokset eivät ole uusia ajoja.
Saman hylkäyksen uusintakiintiö on käytetty. Ei mergeä, kolmatta uusintaa,
aikarajamuutosta tai oletettua sovelluskorjausta. Seuraava rajaus on
MSI-asennusodotuksen puuttuvan syyn selvittäminen nykyisten tutkimusvälineiden
avulla; uusi keräys tai koe tarvitsee täsmällisen rajauksen ennen toteutusta.

**Hyväksytty rajaus:** omistaja hyväksyi rajatun suunnittelun ja synteettisen
kokeen, ei uutta pitkää CI-ajoa tai tuotantokytkentää. Tarkoitus on erottaa
testin täsmälliseen prosessiryhmään kuuluva MSI-asiakas, ryhmän ulkopuolella
havaittu asiakas ja epävarma havainto. Ulkopuolinen ei tarkoita testiin
liittymätöntä tai turvallisesti ohitettavaa: asennuspalvelun työ voi liittyä
samaan asennukseen. Nykyinen kaikkien saman istunnon MSI-asiakkaiden
nollavaatimus sekä tuotteen ja siivouksen hyväksyntäehdot säilyvät.

Synteettinen omistajuuskoe käyttää nykyistä Job- ja prosessikahvarajaa;
se ei asenna MSI:tä eikä muuta sovellusta. Tarkistus kattaa myös kesken
havainnon poistuvan prosessin ja havaintovirheen jättämisen epävarmaksi.
Mahdollinen seuraava kytkentä tarvitsee lisäksi rajatun havainnon toimituksen,
siivouksesta erillisen alkuperäisen virheen säilymisen ja salatun ketjun
todistuksen. Nykyisen kohdeasentimen alkuperäistä syytä ei väitetä löytyneeksi.
Olemassa olevan jälkikeräyksen pitäisi alkaa ennen valitun skenaarion
asentimen käynnistystä; eri skenaariota vasta myöhemmin tallentava koe ei
vastaa tähän näyttöaukkoon. Ei uutta loggeria, supervisoria, yleistä
testialustaa, aikarajamuutosta tai asennuksen käyttöliittymätilan muutosta.

Rajattu prosessijäsenyyden koe ja nykyisen havaitsijan, runtime-odotuksen sekä
fault-elinkaaren kohdetestit läpäisivät. Koemenetelmän riippumaton katselmus
ei löytänyt estävää puutetta; yhtä kattavuusväitettä täsmennettiin.
Tämä ei todista varsinaisen MSI-luetteloinnin, hitaan havaintokyselyn tai
uuden havainnon salatun toimituksen kytkentää. Molempien hylättyjen ajojen
säilyneissä liitteissä ei ole ETL-jälkeä, jota voisi käyttää tämän aukon
jälkikäteiseen tutkimiseen. Seuraava päätös koskee vain rajattua
testiharnessikytkentää ja sen synteettistä toimitus-/keskeytystodennusta.

Omistaja hyväksyi tämän rajatun kytkennän ja synteettiset regressiot.
Nykyiseen supervisoriin lisätään vain valinnainen suljettu jäsenyyshavainto;
hyväksyntä edelleen odottaa nykyistä MSI-nollatilaa ja tuotetarkistuksia.
Nykyisen manuaalisen jälkikeräyksen valitsin ja salattu sidonta kohdistetaan
oikeaan fault-vaiheeseen. [Havaintosopimus](windows-installer-acceptance-harness-v2.md#workspace-asennusodotuksen-havaintoraja)
ja [salatun keräyksen sopimus](ci-encrypted-evidence.md#workspace-keräys-ja-tulokset)
omistavat rajat. Rajattu kytkentä ja synteettiset regressiot on todennettu:
supervisorin tulos-/prosessisopimukset 157/157, keräys-/workflow-sopimukset
69/69 sekä oikean salaus-/purkukokeen ja CI-kytkentöjen sarja 60/60.
Luvut ovat eri sarjojen tuloksia, eivät koko K:n hyväksyntäluku.
Kyselyvirhe, pysyvästi keskeneräinen havainto, myöhäinen valmistuminen ja
hallittu keskeytys eivät muuttaneet vaadittua tulosta tai siivousvastuuta.
Molemmat valitut fault-sidonnat ja synteettiset jälkitavut säilyivät oikean
salauksen ja purun läpi. Puuttuva caller ei todistanut siivousta.

Kytkennän rajattu riippumaton katselmus ei löytänyt estävää puutetta.
Natiivin MSI-luetteloinnin 32/33-asiakasrajaa, istunnon ja exe-nimen suodatusta sekä
käyttöoikeushylkäystä ei tällä kohdenäytöllä todistettu; luokittelun
injektoitu testi ei korvaa niitä. Havainto on valinnainen, eikä tämä aukko
muuta asennuksen hyväksymisehtoja. Ohjeiden linkki- ja julkaisutarkistus
läpäisi. Asennusodotuksen alkuperäinen syy ja K:n PR-hylkäys ovat edelleen
avoimia. Rajatun kytkennän kohdetodennus ei vielä hyväksy PR:ää.

Omistaja hyväksyi 13.10.2026 jatkon normaaliin mergeen ja mainin omiin
portteihin asti. Seuraava nimetty koe jäädyttää yhden harness-revision ja
tallentaa `passiveWorkspaceMigrationFailure`-skenaarion ennen asenninhandoffia.
Koe käyttää säilynyttä pakettia, jonka build-revisio on
`eec0ff9a3bc730eb37b6705837722bdb04e16536`. Koerevisio valmistellaan
erillisellä haaralla; hyväksytty sama revisio viedään PR #303:n haaraan
lineaarisesti ennen normaaleja PR-portteja. Ensivirheet ja puuttuva syy
säilyvät avoimina havaintoina; normaali merge vaatii uuden headin
nykyiset pakolliset tarkistukset ja main tarvitsee omat porttinsa.
Uusi näyttö olisi Job-jäsenyyden suljettu havainto sekä juuri tämän
skenaarion pysäytetty ja salattu ETL, ei vain samat odotusmerkinnät.
Kokeen ja integraation tuloksia ei päätellä etukäteen tästä valtuudesta.

**Nimetyn koerevision tulos:**
`31026f0727566772afeec5171240c39d7cf008e6` valmisteltiin erilliselle
koehaaralle. [Kertakoe 38409576802](https://github.com/eky-software/eky/actions/runs/38409576802)
hylättiin valitun `passiveWorkspaceMigrationFailure`-tapauksen kohdeasennuksen
odotuksessa nykyisellä aikarajalla. Odotuksen aikana uusi havainto luokitteli
MSI-asiakkaan omistettuun Jobiin kuuluvaksi; se ei selitä, mitä asiakas odotti.
Omistetun puun ja asennuksen siivous varmennettiin erikseen.

Tallennus pysäytettiin, salattu liite toimitettiin ja sen palvelusidos,
kylmä purku sekä kaikkien 11 säilyneen tiedoston tiivisteet varmennettiin.
`capture.etl` jäi manifestissa `unverified`-tilaan eikä sen tavuja säilynyt
liitteessä. Tämän tilan perusteella ei tiedetä, johtuiko poisjäänti koosta,
tiedostoidentiteetistä, muutoksesta tai lukuvirheestä. Myös jälkianalyysin
`commandExport`-vaihe hylättiin. Tallenteen pysäytys, toimitetun liitteen
eheys, ETL:n puuttuminen ja asennusodotuksen hylkäys ovat erillisiä tuloksia.

PR #303 säilyy vanhassa headissa ja hylättynä. Tarkka säilynyt MSI tarkistettiin
avaamatta asennusta: paketissa ei ole omaa dialogitaulua tai sovellusta
käynnistävää custom actionia. Tämä ei sulje pois Windows Installerin omaa
virhe- tai tiedostonkäyttöikkunaa. Source-handoff käynnistää kohdeasentimen,
mutta sen käynnistyskuittaus ei ole asennuksen valmistumisen todiste.
Alkuperäinen asennusodotuksen syy on yhä avoin.

Omistaja hyväksyi aluksi vain synteettisen source-handoffin kohdeasentimen
Microsoft MSI -lokin, enintään 8 MiB:n salatun säilytyksen sekä yhden uuden
nimetyn kokeen uudesta testipaketista. Nykyiseen keräimeen lisättiin myös
suljetut säilytyksen hylkäysluokat; ne eivät paljasta raakavirhettä tai
ratkaise aiemman puuttuvan ETL:n syytä. [Omistava sopimus](ci-encrypted-evidence.md#testiperheiden-virheaineisto)
erottaa lokin, prosessipuun ja siivouksen todisteet.

Tavallisen handoffin argumentit ja käyttöliittymätila säilyvät. Rajattu
synteettinen käynnistys, oikea salaus/purku ja prosessiketjun hallittu
katkaisu on todennettu erillisinä kohdesarjoina. Katselmuksessa löydetty
kopioinnin aikaisen katoamisen käsittely korjattiin ja sen regressio läpäisi:
epävarma kopio ei anna lupaa alkuperäisen fixturen poistoon.
Nämä valmistelu- ja kokeiluportit tehtiin alla nimetylle revisiolle.
Normaaleja uuden revision PR-portteja tai mergeä ei ole vielä tehty.
Koetta ei hyväksytä vanhan timeoutin korjaukseksi pelkän läpäisyn perusteella.
Tietoturva-, sisältö-, aika- ja hyväksyntärajat säilyvät.

**Paketin valmistelun ensivirhe:**
[valmistelu 38423233041](https://github.com/eky-software/eky/actions/runs/38423233041)
pysähtyi uuden lokin salausregressioon ennen paketin rakentamista ja MSI:n
käynnistystä. Testin tilapäisjuuren vaihtoehtoinen polkuesitys toisti saman
hylkäyksen hallitussa kokeessa. Testiaineisto luodaan nyt kanonisoidun juuren
alle; samalla ympäristöerolla salaus/purku läpäisi. Keräimen polku- ja
linkkisuojia ei muutettu. Ensivirhe ja salattu liite säilytettiin; tämä ei
selitä alkuperäistä MSI-odotusta eikä kuluttanut silloin vielä aloittamatonta koetta.

**Lokin säilytysrajan korjaus:** puhtaan `7df999b435515664f347e83bf977576247ad59be`-
revision [paketin valmistelu 38424662411](https://github.com/eky-software/eky/actions/runs/38424662411)
läpäisi. Se valmisti synteettiset paketit ilman asennuskuluttajia.
Saman paketin [nimetty lokikoe 38427436693](https://github.com/eky-software/eky/actions/runs/38427436693)
hylättiin fixture-siivoamisessa. Sen `workspaceFaultCompleted`,
`workspaceFaultSemanticProofValidated`, tuotteiden poissaolo ja
business-aineiston säilyminen varmennettiin. Lokin säilytyskuitti osoitti
`sizeLimitExceeded`-hylkäyksen, joten alkuperäisen testikansion poisto
estettiin. Asennusodotuksen vanha timeout ei toistunut tässä kokeessa;
sen juurisyytä ei nimetä korjatuksi.

Salattu toimitus ja kylmä purku läpäisivät; kaikkien 12 säilyneen tiedoston
tiivisteet ja ajosidonta varmennettiin. MSI-lokin tavut ja tarkka koko eivät
mahtuneet aineistoon. Myös ETL:n poisjäänti luokiteltiin tässä uudessa
manifestissa kokoylitykseksi. Jälkianalyysin `commandExport` hylättiin.
Tämä ei jälkikäteen todista aikaisemman manifestin ETL-poisjäännin syytä.

Omistaja hyväksyi kohdeasentimen lokin rajan noston 8 MiB:stä 64 MiB:iin.
Raja keskitetään samaan vakioon sekä säilytyskopiolle että kummallekin
salatulle keräyspolulle. Muiden tiedostojen ja ETL:n rajat, kokonaisbudjetit,
prosessisiivous ja hyväksyntäehdot säilyvät. Keräyksen 60 kohdetestiä ja
salauksen/purun 26 testiä läpäisivät erillisinä sarjoina; täysi 64 MiB:n loki
säilyi molemmissa keräimissä ja 9 MiB:n loki todellisessa salauksessa/purussa.
Ylitys ja tavallisten lähteiden 8 MiB:n raja säilyivät. Myös desktopin
tyypitys ja ohjeiden linkkitarkistus läpäisivät. Kaksi erillistä lisäkoetta
todistivat, ettei suurempi loki ylitä kummankaan keräimen jäljellä olevaa
kokonaisbudjettia. Rajattu riippumaton katselmus läpäisi.

**Korjaus todennettu:** jäädytetty harness
`35f55db1fbf5bdd54b92b08198d8ee3959316f5d` käytti samoja aiemmin
varmennettuja `7df999b435515664f347e83bf977576247ad59be`-pakettitavuja
[kokeessa 38438225924](https://github.com/eky-software/eky/actions/runs/38438225924).
Pakollinen caller/verifier, palautusskenaario, business-aineiston säilyminen,
prosessien ja tuotteiden poissaolo sekä fixture-poisto läpäisivät.
Alkuperäisen 8 MiB:n rajan ylittävä koko MSI-loki säilyi ja vastasi
säilytyskuittia. Salattu toimitus, kylmä purku, ajosidonta ja kaikkien 13
säilyneen tiedoston tiivisteet varmennettiin.

ETL ylitti edelleen oman rajansa ja jälkianalyysin `commandExport` hylättiin;
niitä ei lasketa läpäisyiksi. Tämä korjaa todennetun MSI-lokin säilytysrajan,
mutta ei nimeä alkuperäistä asennusodotuksen timeoutia korjatuksi.
Seuraavaksi nykyinen lineaarinen korjausketju ja tämä checkpoint viedään
PR-haaraan. Normaalit portit sekä riippuvuustarkistus vaaditaan sen
täsmälliselle headille, ja mergen jälkeen uuden mainin omat tarkistukset.
Tämä checkpoint ei vielä hyväksy K:ta tai mergeä.

**Normaalin PR-kierroksen sopimushylkäys:** head
`28bd1fa902c36a7466d868d98ea568819379efc6` ja sen
[V2-kierros 38439943123](https://github.com/eky-software/eky/actions/runs/38439943123)
käynnistettiin; [riippuvuustarkistus 38439942927](https://github.com/eky-software/eky/actions/runs/38439942927)
läpäisi. Upgrade-artifactin valmistelu pysähtyi ennen rakentamista:
vanha testin yleinen `upload-artifact`-kielto hylkäsi yhteisen diagnostiikkajobin
jo hyväksytyn salatun workspace-virhepaketin. Sama hylkäys toistettiin
paikallisesti. Testi käyttää nyt legacy-testien kanssa samaa täsmällisesti
varmennettua upload-projektiota; muiden uploadien ja paketin uudelleenrakennuksen
kielto säilyy. Workflown tai sovelluksen toimintaa ei muutettu.

Upgrade-sarjan 23 testiä ja legacy-diagnostiikan erilliset 27 kohdetestiä
läpäisivät. Katselmus löysi projektion liian laajan YAML-askeleen rajauksen;
nimettömän ylimääräisen uploadin kontrolli toisti sen, ja korjattu rajaus
sekä regressio läpäisivät. Lopullisen rajauksen kaikki viisi nykyistä
legacy-kuluttajaa läpäisivät vielä erillisen kohdetarkistuksen.
Uusi rajattu katselmus hyväksyi korjauksen.
Ensivirheen komentoloki sekä salattu manifesti säilytettiin ja varmennettiin.
Manifestissa ei ollut tämän yksikkötestin raakatiedostoja; tarkka hylkäys
tuli alkuperäisestä komentolokista. Tämä ei ole testin läpäisy tai valmis K.
Kierros päättyi 34 läpäisseeseen, kahteen hylättyyn ja seitsemään ohitettuun
jobiin. Toinen hylkäys on valmistelusta riippuva kokonaisportti; molemmat
workspace-success-, workspace-fault- ja legacy-kuluttajat läpäisivät.
Ohituksia ei lasketa läpäisyiksi, eikä tämä hyväksy puuttuvia upgrade-portteja.
Kierrosta ei peruttu haarapäivityksellä. Korjattu revisio tarvitsee omat
normaalit PR- ja riippuvuusporttinsa.

**Salattujen lokien laajempi budjetti:** omistaja hyväksyi 64 MiB:n
tiedostorajan yleisen keräimen jo sallituille lokeille ja raporteille sekä
workspace-keräimen nimetyille teksti- ja virhelokeille. Suurin komentovienti
saa 128 MiB:n rajan, ja molempien keräinten säilytettyjen tiedostotavujen yhteisbudjetti on
512 MiB. ETL:n nykyinen 256 MiB ja pienet sidonta-/ohjausrajat säilyvät.
Muutos ei laajenna lähdeluetteloa, raaka-aineiston julkaisua tai testien
aikarajoja. [Omistava keräyssopimus](ci-encrypted-evidence.md#workspace-keräys-ja-tulokset)
erottaa säilytysbudjetin testin hyväksynnästä ja projektion alkuperäislähteestä.
Keräinten 69 kohdetestiä, 26 salaus-/purkutarkistusta ja 34 CI-kytkennän sekä
artifact-sopimuksen testiä läpäisivät, samoin desktopin tyyppitarkistus.
Rajattu riippumaton katselmus tarkensi kokonaisbudjetin dokumentointia;
koodista ei löytynyt uutta korjauskohtaa. Kokeet todistavat rajat ja suuremman
lokin säilymisen, eivät koko budjetin suorituskykyä kaikilla mahdollisilla
tavuilla. Normaali korjausrevision PR-todennus on vielä tekemättä; aiemman
kokeen näyttö pysyy sidottuna sen alkuperäiseen revisioon.

**Edellinen checkpoint:**

Headin `75e728ff4e8078f1013574c349c953c76169cf93`
[V2-kierros](https://github.com/eky-software/eky/actions/runs/38378109975)
hylättiin: 35 jobia läpäisi, kolme hylättiin ja kuusi valitsematta jätettyä
diagnostiikkajobia ohitettiin. Kaksi itsenäistä hylkäystä ovat core-testin
palautusaikakatkaisu ja Electronin PDF-esikatselutesti; kolmas on
kokonaisportin hylkäys. Erillinen
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38378109934)
läpäisi. Ensivirheet säilyvät, eikä saman lähteen uusintaa aloitettu.

Saman PR-ajon Windows-paketti läpäisi `smoke:windows`-portin ja kaikki kolme
packaged-legacy-palautustestiä ilman uusintaa ennen Electron-käyttäjäpolkujen
hylkäystä. Linuxin eristetty tarkistusprosessi jäi core-testien hylkäyksen
vuoksi ajamatta; ohitus ei ole sen hyväksyntä. Seuraavan revision normaali
kierros tarvitsee edelleen nämä portit, koko valitun Electron-sarjan sekä
muut riskisuunnitelman valitsemat tarkistukset. Main varmennetaan erikseen.

PDF-testin native-URL-havainto ei vielä todista Playwrightin sivun valmiutta.
Rajattu korjaus odottaa myös täsmällistä sivun URL:ää ennen kummankin
esikatseluikkunan valintaa. Nykyiset sisältö-, revisionvaihto- ja sulkuväitteet
säilyvät. Yksi oikea Electron-kohdeajo ja tyyppitarkistus läpäisivät.

Palautustestin keskeneräisen työn suoja esti seuraavat saman tiedoston
testit; niitä ei tulkita itsenäisiksi sovellusvioiksi. Omistajan hyväksymässä
kokeessa vain `uses fresh original authority after C pre-migration validation
fails` saa erillisen enintään viiden sekunnin valmistelun ja nykyisen viiden
sekunnin palautusosuuden. Oikeat journal-luennat, sisältö- ja omistajuusväitteet
säilyvät. Yksi kohdekoe, 13 elinkaariregressiota ja tyyppitarkistus läpäisivät.
Todellinen tarkoituksellinen valmisteluaikakatkaisu esti testirungon,
vapautti yhteiset resurssit vasta työn päätyttyä ja säilytti myös myöhäiset
tiedostot. Kokeen odotettu hylkäys ei ole tavallisen testin läpäisy.

Omistaja hyväksyi 13.10.2026 jaon pysyväksi vain tähän testiin: valmistelu
enintään viisi sekuntia ja palautus tarkistuksineen edelleen enintään viisi
sekuntia. Näiden vaiheiden yhteisbudjetti kasvaa enintään kymmeneen sekuntiin.
[Rajattu testauskäytäntö](../ai/testing-rules.md#palautustestin-erillinen-valmistelu)
säilyttää keskeneräisen työn suojan ja aineiston. Tuotantokoodia, muiden
testien aikarajoja tai CI:n kokonaisrajaa ei muuteta. Koe ei todista aiemman
CI-aikakatkaisun juurisyytä korjatuksi. Koko palautuskäynnistyksen
testitiedosto ja sen elinkaarituen regressiot läpäisivät normaalilla
testiasetuksella: 154 testiä, ei uusintaa. Rajattu riippumaton katselmus ei
löytänyt lisäpuutteita. Korjausrevisio tarvitsee edelleen nykyiset PR- ja
main-porttinsa.

### K:n ensimmäisen PR-kierroksen jatko

**Aikaisempi normaali PR-checkpoint:** korjausrevision
`b0daaaf662785f7ce20f7f86d47e6b2cd2b1fe77`
[V2-kierros](https://github.com/eky-software/eky/actions/runs/38332004647)
valmistui hylättynä: 31 jobia läpäisi, seitsemän hylättiin ja kuusi
valitsematta jätettyä diagnostiikkajobia ohitettiin.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38332004601)
läpäisi erikseen. Korjattu testivalmistelu, työtilan testit ja käännökset,
system-/web-käyttäjäpolut sekä molemmat paketoidut legacy-ajot läpäisivät.
PR-merge-checkoutin puu varmennettiin headin puuksi. Hylkäykset erotetaan:

- Linuxin oikea Electron-tarkistus keskeytyi hiekkalaatikon valmistelussa
  ennen varsinaista tarkistustulosta. Prosessipuun siivoustodiste jäi
  erikseen varmentamatta. Alustaoikeuksien muutos vaatii päätöksen;
  sandboxia tai nykyistä oikeuksien korottamisen estoa ei poisteta.
- Neljä Windows-workspace-kuluttajaa hylättiin profiilivalmistelun
  `profileMigrationHistoryFailed`-vaiheessa. Fixture muuttaa migraation
  tiivisteen ja odottaa edelleen tavallista `invalidHistory`-tulosta,
  vaikka hyväksytty K-sopimus pysäyttää todentamattoman historian jo ennen
  sisältölukua. Suljetun virhepolun ja luotetun rakenteen tavallisen
  sisältövirheen kattavuus on säilytettävä erillisinä korjauksessa.
- Windows-Electronin aktivointitodistus hylättiin molemmilla testiyrityksillä
  `compatibleMigration`-vaiheessa koodilla `DESKTOP_START_FAILED`.
  Siivous läpäisi. Tätä ei yhdistetä yllä olevaan fixture-havaintoon ilman
  erillistä näyttöä. Muut 46 valittua kriittistä Electron-testiä läpäisivät.
- Seitsemäs hylkäys on kokonaisportti, ei uusi itsenäinen sovellusvika.

Ensivirheiden lokit ja salatut liitteet on säilytetty. K:ta ei hyväksytä,
PR:ää ei mergetä eikä samaa lähdettä uusita vihreyden vuoksi.
Seuraava työ rajautuu näihin kolmeen havaintoon; aiempia hyväksyttyjä
T/A/B/C-kokonaisuuksia ei avata uudelleen ilman omaa regressiota.

**Rajatut Windows-korjaukset:**

- W6B.2-fixturen C käyttää nykyisen first-start-todisteen yksilöityä
  sisältövirhettä muuttamatta schemaa tai migraatiohistoriaa. Evidence-lukija
  vaatii ehjän SQLite-rakenteen, täsmälleen nimetyn tapahtumarivin ja yhden
  siihen kuuluvan viitevirheen. Muu korruptio hylätään; A/B sekä C ennen
  injektiota vaativat virheettömät viitteet. Väärän migraatiometadatan
  hylkäyskattavuus säilyy erillisenä. Fixturen 40 regressiota sekä backendin
  kolme valittua rakenne-/sisältörajatestiä läpäisivät. Ne eivät korvaa
  oikeiden paketoitujen workspace-kuluttajien vielä puuttuvaa todennusta.
- Aktivointimigraation staging poisti materialisoidun juuren suoraan, vaikka
  tarkistusasiakas omisti edelleen sen varauksen. Korjaus käyttää samaa
  `removeProfileSnapshot`-omistajaporttia, ei uutta poistomekanismia.
  [Aktivoinnin sopimus](local-company-workspace-plan.md#w6a3-passiivisen-työtilan-migraatio-aktivoinnissa)
  säilyttää polku-, omistajuus- ja epävarman aineiston säilytysrajat.
  Kaksi regressiota toisti vanhan poiston puutteet; korjauksen 142 kohdetestiä
  ja `DESK-WORKSPACE-ACTIVATION-001`-käynnistysketju läpäisivät ilman uusintaa.
  Riippumaton rajattu katselmus ei löytänyt lisäpuutteita.

Korjausrevisio `bb10a02c0bdbe4e430cccd437f2701bd0d2d6b24` tallennettiin
puhtaaksi ja siitä rakennettu paketti läpäisi nykyisen Windowsin
backup/inspect/restore/restart-portin. Sama paketti läpäisi myös kolme
uusinnatonta testiä: alkuperäinen 038-varmuuskopio sekä create-/import-
kylmäpalautus. Paketin lähdeidentiteetti, sisältörajat, natiivikirjasto ja
kaikkien pakettitavujen säilyminen tarkistettiin. Työtilan tyyppitarkistus
ja omistavien dokumenttien linkkitarkistus läpäisivät.

Linuxin rajattu kertakoe hyväksyttiin ja ajettiin erillisellä diagnostisella
revisiolla `820d33e42ab4c3c4943edf7ede46770d3402a1a8`.
[Kertakoe](https://github.com/eky-software/eky/actions/runs/38358946711)
todensi nimetyn sandbox-edellytyksen sekä rajatun profiilin latauksen ja
poiston. Se hylättiin kuitenkin tarkistusajurin käännösvalmistelussa koodilla
`PROFILE_INSPECTION_NATIVE_BUILD_FAILED`, ennen varsinaisia Electronin
tarkistustapauksia. Salatun virhepaketin sidonta ja molempien säilytettyjen
tiedostojen eheys varmennettiin; käännöksen tarkempi alkuperäinen loki ei
kuulunut nykyiseen keräysrajaukseen. Käännösvian syytä tai alkuperäisen
sandbox-hylkäyksen korjausta ei vielä väitetä todistetuksi.

Seuraava rajaus kohdistuu tähän valmistelupuutteeseen. Kertakoe ei anna lupaa
uuteen ajoon tai tavallisen CI:n suojausasetusten muuttamiseen. K:n
korjausrevisiota ei vielä pushattu eikä uutta normaalia PR-kierrosta aloitettu.
Kohde- ja pakettinäyttö
eivät korvaa Linuxia, paketoituja installer-workspace-kuluttajia, uuden
revision PR-portteja tai mergen jälkeisiä main-portteja. K pysyy avoimena.

**Linuxin korjattu kohdenäyttö ja hyväksytty CI-kytkentä:**
[Kertakoe 38363380159](https://github.com/eky-software/eky/actions/runs/38363380159)
läpäisi revisiolla `a7895d177be81dd9e741baa267438262e6cbc60d` ilman uusintaa.
Valmistelun nykyisen Noden polku säilyy myös GYP:n sisäisissä kutsuissa.
Kolme oikeaa tarkistustapausta, prosessipuun poistuminen, erillinen
sandbox-kontrolli, globaalin suojan ja binääritavujen säilyminen sekä rajatun
profiilin siivous läpäisivät. Viisi valitsematta jätettyä tavallista jobia
eivät ole läpäisyjä. Käännösvirheen tarkempi salattu keräys on kohdetodennettu,
mutta onnistunut ajo ei tuota virhepakettia eikä todista vanhan käännösvirheen
kaikkia syitä jälkikäteen.

Omistaja hyväksyi saman rajatun esivaatimusketjun kytkemisen nykyiseen
Linux-komentoon sekä yhden normaalin PR-kierroksen. Tarkistusketju ajetaan
vain kerran; testien aikarajat ja T3:n prosessiomistajuus säilyvät.
Kertakokeen raakalokipoikkeus ei kytkeydy tavallisiin CI-jobeihin, ja
väliaikainen kokeen CI-käynnistin poistetaan. K:n Windows-korjausketju ja
kokeen korjaukset säilyvät lineaarisessa historiassa. Täsmällisen uuden
PR-revision ja mergen jälkeisen mainin normaali hyväksyntä on edelleen avoin.

### K:n normaalin kierroksen resurssitestit

Revision `58960d85de1e9b05f3ffff3135469f8c11b6be0a`
[V2-kierros](https://github.com/eky-software/eky/actions/runs/38367077414)
hylättiin core-testivaiheessa. Ensimmäinen yritys aikakatkaisi palautuksen
käynnistystestin; saman tiedoston keskeneräisen työn suoja esti seuraavat
testit. Työn myöhempi valmistuminen ei hyväksy aikakatkaissutta testiä.
Muut 36 valittua jobia ja erillinen
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38367077261)
läpäisivät; kuusi valitsematta jätettyä diagnostiikkajobia eivät ole läpäisyjä.

Omistaja hyväksyi yhden core-jobin ja sen koonnin uusinnan samalla lähteellä
sekä rajatun etenemisen vain kaikkien muuttumattomien porttien läpäistyä.
Toinen yritys läpäisi koko desktop-testisarjan, mutta hylkäsi backendin
tapahtumahistorian resurssitestin viiden sekunnin aikakatkaisuun.
Kyseessä on eri hylkäys, ei alkuperäisen palautustestin toistuminen.
Linuxin varsinainen tarkistus ei ehtinyt käynnistyä kummassakaan yrityksessä.
Ensivirheet ja yritysten salatut liitteet säilytetään erillisinä; kolmatta
saman revision uusintaa ei tehdä.

Rajattu testimuutos tarkistaa edelleen jokaisen 1 001 rivin kaikki 13 arvoa,
mutta muodostaa yhden testiväitteen rivin arvojen yhteisestä ehdosta.
Kenttämäärän, suurten tunniste-/tekstiarvojen, katalogituloksen ja kannan
muuttumattomuuden tarkistukset sekä alkuperäinen aikaraja säilyvät.
Tuotannon SQL, validointi, riippuvuudet ja testiaineisto eivät muutu.
Kohdetiedoston 42 testiä ja backendin tyyppitarkistus läpäisivät.
Rajattu riippumaton katselmus varmisti testin hyväksyntäehtojen säilymisen.
Tämä ei todista CI-viiveen juurisyytä
korjatuksi eikä hyväksy uutta CI-kierrosta tai mergeä. Korjausrevision
normaalit PR-portit ja uuden mainin omat portit vaaditaan edelleen.

[PR #303:n](https://github.com/eky-software/eky/pull/303) ensimmäinen
[V2-kierros](https://github.com/eky-software/eky/actions/runs/38329010187)
hylättiin headilla `2a7e239bbf487e52ded02090ccf475f01b4ddb2c`.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/38329010178)
läpäisi erikseen. V2:n 22 onnistunutta jobia eivät hyväksy kahdeksaa hylättyä
jobia tai niiden vuoksi käynnistymättä jääneitä kuluttajia. Kuusi erikseen
valitsematta jätettyä diagnostiikkajobia ovat ohituksia, eivät läpäisyjä.
CI:n PR-merge-checkoutin puu varmennettiin samaksi kuin kyseisen headin puu.
Ensivirheet ja salatut liitteet säilytetään; yhden liitteen tiedostomääräraja
jätti osan käynnistysaineistosta ulkopuolelle. Puuttuvaa havaintoa ei tulkita
onnistumiseksi.

Korjaus rajautuu nykyisen testikytkennän osoitettuihin puutteisiin:

- Kahden desktop-E2E-todistuksen backend-kahva välittää myös uuden
  `stopForRestore`-operaation ja vapauttaa omistajuuden vasta onnistuneen
  sulun jälkeen. Puute esti käännöksen ennen käyttäjäpolkujen ajoa.
- Synteettinen Windows-startup-fixture määrittää oman käyttöjärjestelmärajansa;
  katalogifixture luo Linuxissa vaaditut yksityiset hakemistot. Tuotannon
  polku- tai omistajuustarkistuksia ei kevennetä.
- E2E:n tarkoitukselliset tietokantavirheet asennetaan vasta oikean
  schema-attestoinnin jälkeen synkronisesti ennen seuraavaa I/O-kierrosta ja
  käyttökahvan palautusta. Testitriggerit eivät kuulu tuotannon sallittuun
  rakenteeseen. Epäkelpoista lähtörakennetta ei korjata testivalmistelussa.
- Legacy-fixturen lähdemoduulin täsmällinen tuonti sovitetaan Noden suoraan
  TypeScript-lukuun. Sovitus poistetaan heti latauksen jälkeen; tuotannon
  käännös- ja riippuvuussopimus säilyy.

Rajatut käännös-, tyyppi-, tietokanta-, palautus- ja legacy-tarkistukset sekä
aiemmin hylätyt numerointi- ja web-virhepolut läpäisivät ilman uusintaa.
Legacy-lähdelataus todennettiin myös Linuxissa. Riippumaton rajattu katselmus
ei löytänyt uutta korjattavaa; Linuxin alustakohtaiset palautus- ja oikean
Electron-prosessin tarkistukset vaaditaan edelleen CI:ssä.
Kohdetodennukset ja riippumaton rajattu katselmus eivät korvaa korjausrevision
normaaleja PR-portteja. K, merge ja uuden mainin tarkistukset ovat edelleen
avoimia. Uusintaa ei käytetä alkuperäisen kierroksen hylkäysten hyväksymiseen.

### K:n kokonaiskytkennän tarkistus

**Katselmuksen päivitetty checkpoint 13.10.2026: ei vielä julkaisuvalmis K.**
Schema-portti, eristetty tarkistusajuri, omistettu kertakopio ja nykyisten
palautuskuluttajien valtuusketjut ovat työpuussa. Niiden vaihekohtainen
testinäyttö ei hyväksy koko mainin palautusketjua. Rajattu riippumaton
backend-katselmus ja desktopin kutsuketjujen tarkistus nostivat seuraavat
integraatioesteet; tämä ei ollut koko repositorion Security-scan.

**Rajattu loppukatselmus:** historian luennan kytkennän jälkeen backendin
ja desktopin palautusketjut katselmoitiin erillisinä vastuualueina.
Backendistä löytyi yksi jäljellä oleva rajattoman tulosluvun kohta:
`CurrentActiveProfileValidationService` keräsi kaikki viiteavainvirheet
taulukkoon. Se lukee nyt vain ensimmäisen virherivin, kuten eristetty
snapshot-tarkistin. Ehjä kanta hyväksytään ja yksikin viitevirhe hylätään
entisellä virhesopimuksella; uutta aineiston kokorajaa ei lisätä.
Nykyisen ja metadatattoman 038-kannan todelliset candidate-kutsujat
todentavat rajatun luennan, suljetut yhteydet sekä alkuperäisten tavujen
ja tiedostoluettelon säilymisen. Vaikutusalueen 152 testiä läpäisivät;
yksi ennestään oleva ohitus ei ole läpäisy. Tyyppitarkistus läpäisi.
Korjauksen erillinen katselmus ei löytänyt hyväksynnän heikennystä.
Desktopin tarkistetuista omistajuus-, journal- ja handoff-kytkennöistä ei
löytynyt uusia konkreettisia regressioita. Tämä ei korvaa paketoitua näyttöä.

Samalla palautettiin desktopin testikomennosta pudonnut
`w6b2PackagedWorkspaceMigrationHistory.test.ts`. Sen kaksi testiä,
ajokytkennän 115 tarkistusta ja CI-sopimusten 392 tarkistusta läpäisivät.
Nykyinen kytkentäsuoja hylkää myös tämän tiedoston puuttumisen tai väärän
ajoryhmän. Aiempi koko työtilan läpäisy koski silloista testiluetteloa,
ei jälkikäteen palautettua tiedostoa. Aikarajat ja hyväksyntäehdot säilyvät.

**Puhtaan paketin kohdenäyttö 13.10.2026:** lähderevision
`2ed5d0c13de0644e3a18548a9aa34f8d99130167` Windows-paketti läpäisi
nykyiset sisältö-, koko-, native-ajuri- ja Electron-suojaustarkistukset.
Samoilla pakettitavuilla läpäisivät normaali synteettinen backup -> inspect ->
restore -> restart -> compare sekä kolme paketoitua yhteensopivuustestiä:
alkuperäinen 038-varmuuskopio ja keskeytyneen yrityksen luonnin sekä tuonnin
cold-palautus. Paketin inventaario ja sisältöidentiteetti säilyivät muuttumattomina
testien yli. Tämä ei ole käyttäjäaineiston, Linux-Electronin, binaarihandoffin
tai PR/main-porttien hyväksyntä. Niiden normaalit tarkistukset vaaditaan
integroitavalle revisiolle erikseen; pakettia ei julkaista uutena sovellusversiona.

| Kohta | Näyttö ja sulkemisehto |
| --- | --- |
| Aktiivivalidoinnin virhe ja rollback | Tavallisen ja palautuksen jälkeisen startupin, ensimmäisen käynnistyksen sekä C:n kytkentä lainaa mainin täsmällistä restore-varausta. Kutsujatestit todistavat saman omistajan jatkuvan hylkäyksestä varmennetun stopin ja alkuperäisaineiston rollbackin yli. Epävarma tarkistajan tai backendin sulku estää rollbackin. Koko main-palautustiedoston 139 testiä läpäisivät; oikea journaliton C-ketju on todennettu rajatusti. Tämä ei sulje alkuperäistä C-aikakatkaisua eikä K:n loppuportteja. |
| Päivityksen jo omistama varaus | Live-prepare/handoff on kytketty koordinaattorin täsmälliseen update-omistajaan. Yhteinen tarkistusmoottori säilyy; varausta ei hankita uudelleen eikä update-fenceä vaihdeta restore-fenceksi. Kuittaamaton tarkistussiivous ja pre-update-palautuspisteen todettu cleanup-epävarmuus estävät abort-vapautuksen. Kohde-, main- ja eristetyn prosessin näyttö sekä erillinen ensimmäisen käynnistyksen/C:n kytkentänäyttö on kirjattu alle. K:n loppuportit säilyvät. |
| Candidate-kuluttajan kirjoittava avaus | Kolme tarkistusoperaatiota käyttää nyt yhteistä readonly-attestointia ennen kirjoitettavaa avausta; luontia ja tyhjää kantaa ei sallita. Puuttuvan kannan hylkäys, hot-journalin säilyminen sekä nyky-/038-/WAL-/PDF-kontrollit on kohdetodennettu. Kuusi oikean utility-ketjun tapausta todistaa puuttuvan kannan hylkäyksen ja ehjän WAL-kannan hyväksynnän, lapsen exitin sekä varauksen palautuksen. [Rajaus](#candidate-tarkistuksen-avausportti) ei sulje hardened-palautuksen tai K:n muita loppuportteja. |
| Eksplisiittinen muistirajavirhe | Nimetty schema-/historia-/eheystarkistuksen luokittelupuute on korjattu ja kohderegressiot läpäisivät. [Rajattu näyttö](#natiivin-muistivirheen-luokittelukorjaus) erottaa injektoidun natiivivirheen ja runnerin syykoodin todellisesta resurssirajasta sekä paketoidun palautuksen hyväksynnästä. Hylkäys pysyy suljettuna eikä raakapinoa julkaista. |
| Journal-guardien kertautuva sisältötyö | Rajattu toteutus, katselmus, kohderegressiot, nimetty palautussarja ja C-käynnistyskoe läpäisivät. Tuore sisältötarkistus säilyy cold-forward-/rollback-kirjoitusten mutaatiorajoilla; muut kutsujat säilyttävät yhdistetyn tarkistuksen. Tämä kohta ei enää odota journal-erottelun toteutuslupaa. K:n loppuportit ovat erillisiä, eikä alkuperäisiä aikakatkaisuja merkitä korjatuiksi pelkän läpäisyn perusteella. |

**Aktiivivalidoinnin vähimmäiskutsujamatriisi ennen vaihtoa:**

| Kutsuja | Säilytettävä ero ja todennus |
| --- | --- |
| Tavallinen startup | Nykyinen schema ja profiili; ei UI:ta ennen onnistumista. Virheessä hallittu shutdown. |
| Palautuksen jälkeinen startup | Sama onnistumispolku; hylkäyksessä ensin backendin ja tarkistajien varmennettu stop, sitten alkuperäisaineiston tuore rollback-valtuus. |
| C:n ennen-migraatio-palautus | Täsmällinen update-valinta ja alkuperäisketju, sekä restore-journalin kanssa että ilman sitä. Normaalia eteenpäin migraatiota tai UI:ta ei käynnistetä. Journaliton haara tarvitsee oman todistetun sidontansa. |
| Live-päivityksen valmistelu ja handoff | Koordinaattorin jo omistama update-lease; handoffin update-fence säilyy. Sama tarkistus ei ota kilpailevaa restore-varausta. |
| Päivityksen ensimmäisen käynnistyksen hyväksyntä | Nykyinen `FirstStartUpdateCoordinator` ja sen hyväksyntä-/rollback-järjestys. Sitä ei hyväksytä pelkällä tavallisen startupin näytöllä. |

**Jatko:** sulje nämä nimetyt kohdat nykyisissä omistajissa. Todista korjattu
metadata-/virhe-/omistusketju todellisilla kutsujilla ennen vanhan raskaan
validaattorin poistamista. Älä laajenna työksi yleistä rakennesiivousta,
uutta loggeria tai uutta prosessinomistajaa. V2bi:n hyväksytty rollback-only-
W6-valmistelu säilyy; normaali W6-inventaario ja aiempien journalien recovery
eivät muutu. V2ai:n kirjoitussuoja ja V2aj:n sulku säilyvät.

**K:n loppuportit säilyvät:** koko mainin startup-/palautusketju ja oikea
binaarihandoff; Linux-runtime/CI; suuren katalogin koko terminal-ketjun
resurssinäyttö; hyväksytyn pakettibudjetin puhtaan paketin todennus; hardened Windows backup ->
inspect -> restore -> restart -> compare nyky-/038-aineistolla;
korvattujen kutsujien poisto vasta vastaavan kattavuuden jälkeen;
riippumaton loppukatselmus sekä jäädytetyn revision PR- ja uuden mainin portit.
Nykyisiä aikarajoja, sisältövaatimuksia tai hyväksyntäehtoja ei muuteta.
Alla olevat V2-vaiheet säilyvät näyttöhistoriana, eivät uutena työjonona.

### K:n integraatiotestien checkpoint

Koko työtilan ensimmäinen testikierros hylättiin desktopin palautustestien
aikakatkaisuihin. Viiden hylätyn tiedoston yksi sallittu kohdeuusinta läpäisi,
mutta tämä ei selitä ensihylkäyksen syytä eikä hyväksy koko testikierrosta.
Mainin kolmen C-palautustapauksen testielinkaari on sidottu nykyiseen
aineistonsäilytysapuriin: epäonnistuminen tai keskeneräinen testirunko ei
oikeuta juuren poistamista tai jaettujen riippuvuuksien ennenaikaista nollausta.
Siivoussuojan kohdetodennus läpäisi; sovelluskoodia, testien aikarajoja tai
rinnakkaisuusasetuksia ei muutettu tämän korjauksen vuoksi.

Backendin erillinen integraatioajo osoitti päivitysbrokerin testituplien
käyttävän vanhaa tarkistusrajapintaa. Testi on kytketty nykyiseen
`ProfileSnapshotInspectionClient`- ja palautuspistesopimukseen: oikea
viestikanava, HTTP-kirjoitusesto, salattu piste ja itsenäinen tarkistusstaging
säilyvät. Tässä testitasossa natiivin prosessin ja varauksen rajat ovat
synteettisiä; se ei korvaa oikean utility-prosessin todennusta.
Siivous edellyttää prosessin poistumista ja palautunutta omistajuutta,
ei pelkkää broker-kuittausta. Vanhan broker-protokollan omat regressiot
säilyvät erillisinä. Kohteen 24 testiä, sen erillinen tyyppitarkistus,
backendin 3 251 testiä ja webin 949 testiä läpäisivät. Backendin viisi
olemassa olevaa ohitusta eivät ole läpäisyjä. Desktopin normaalin testikomennon
erillinen skriptiosuus läpäisi 346 testiä.
Rajattu katselmus sulki kaksi testin siivouspuutetta: aloitettu operaatio
odotetaan loppuun myös havaintovirheessä, ja operaation oma siivous
tarkistetaan ennen inspectorin loppusulkua. Epäonnistuneen testin tiedostot
säilyvät. Erilliset riippuvuusauditoinnit ja rekisteriallekirjoitusten
tarkistus läpäisivät; ne eivät korvaa revision CI-tarkistuksia.

Omistajan hyväksymä yksi desktopin enintään neljän työntekijän koe läpäisi
4 127 testiä 271 tiedostossa. Kaksi olemassa olevaa ohitusta eivät ole
läpäisyjä. Koe käytti normaalia testiluetteloa ja nykyisiä testiaikarajoja;
rinnakkaisuusrajaa ei kokeen yhteydessä kytketty oletuskomentoon tai CI:hin.
Omistaja hyväksyi 12.10.2026 pysyvän desktop-kohtaisen enintään neljän
työntekijän rajan, joka säilyttää pienemmän nykyisen run-tilan oletuksen,
sekä regressiot, ohjeen ja yhden normaalin koko työtilan testikierroksen.
[Testausohje](../ai/testing-rules.md#desktopin-vitest-rinnakkaisuus) omistaa
nykyisen asetuksen. Rajauksen ja ajokytkennän 112 tarkistusta sekä rajattu
riippumaton katselmus läpäisivät. Yksi normaali koko työtilan `pnpm test`
-kierros läpäisi 10 381 testiä ilman hylkäyksiä. Seitsemän ennestään olevaa
ohitusta säilyi; niitä ei lasketa läpäisyiksi. Desktopin osuus sisälsi
4 127 Vitest-testiä ja 354 skriptitestiä, backend 3 251 Vitest-testiä ja
14 native-valmistelun sopimustestiä. Lähdesisältö säilyi samana koko ajon ajan.
Testit, aikarajat ja CI-hyväksyntäehdot säilyvät; läpäisy ei yksin yksilöi
vanhan hylkäyksen syytä.

**Avoin jatkoraja:** alkuperäinen aikakatkaisu säilyy avoimena havaintona;
hyväksytyn rinnakkaisuusmuutoksen todennus ei nimeä sen juurisyytä korjatuksi
eikä muuta ensimmäistä ajoa hyväksytyksi. Normaali työtilan testikierros on
nyt todennettu tällä muutoksella. K:n paketoidut palautusportit, Linuxin
todellinen tarkistusprosessi, loppukatselmus ja revision oma PR/main-CI
säilyvät erillisinä vielä avoimina hyväksyntäportteina.

Integraation testipaketti rakennetaan puhtaasta revisiosta nykyisellä
`package:windows`-polulla ja tarkistetaan `smoke:windows`-ajolla sekä saman
paketin legacy-palautustestillä, kuten tavallisessa Windows-CI:ssä.
Tämä ei ole käyttäjälle toimitettava julkaisu. Lopullisen julkaisuversion
erillinen `smoke:windows:release-candidate`-portti ja uuden version vaatimus
säilyvät [julkaisuohjeessa](release-versioning-policy.md#nykyinen-pilot-paketoinnin-portti).
Niitä ei ohiteta eikä sovellusversiota nosteta pelkän K-välivaiheen vuoksi.

### Laskuhistorian ennakkorajan päätös

Rajattu loppukatselmus vahvisti K-P1:n sisältöluennan ennakkorajassa puutteen:
PDF-luettelo on rajattu, mutta laskut, sisältörevisiot, rivit, ALV-erittelyt,
nykyrevision osoittimet ja toimitustapahtumat luetaan vielä kokonaisina
muistirakenteina. PDF:ttömän revision historia kuuluu samaan eheystarkistukseen.
Pelkkä SQLiten tai tarkistusprosessin muistiraja ei korvaa ennen
materialisointia tehtävää tarkistusta. Omistaja hyväksyi 12.10.2026 rajatun
suunnittelun ja synteettiset kokeet, ei tuotantokytkentää tai uutta kokorajaa.

SQL-ennakkotarkistuksen koe laskee rivit ja arvojen tavumäärät tietokannassa
ennen nykyisiä eheysvalidoijia. Vain rajatut laskentatulokset siirtyvät tässä
vaiheessa JavaScriptiin. Samassa lukutransaktiossa säilyvät nykyinen
schema-portti, koko historian tarkistus, PDF-metadatan rajat ja katalogin
muodostus. Koetodennus kattaa myös ylimääräisen schema-sarakkeen hylkäyksen,
raja-arvot, UTF-8-/BLOB-arvot, historian loppupään virheen ja PDF:ttömän
vanhan revision. Nykyisen 038 -> 039 -synteettisen kopion katalogi säilyi
muuttumattomana. Kokeen 24 tapausta ja erillinen tyyppitarkistus läpäisivät;
ne eivät ole tuotantokorjauksen, native-resurssirajan tai koko K:n hyväksyntä.

**Valittu jatkosuunta 12.10.2026:** omistaja hyväksyi pienissä osissa
lukevan historiantarkistuksen jatkosuunnittelun. Uutta koko laskuhistorian
rivi-/tavurajaa ei valita ratkaisuksi; yllä oleva ennakkorajaprototyyppi
säilyy vertailukokeena, ei tuotantoon kytkettävänä korjauksena.
Tämä päätös ei vielä hyväksy tuotantokytkentää, uutta hyväksyntärajaa tai
nykyisten aika-/resurssirajojen muutosta.

Suunnitelman pitää nimetä korvattavat koko historian luvut ja muistissa
pidettävät kartat: pelkkä `.all()`-kutsun vaihto iteraattoriin ei riitä.
Nykyisen moduulin eheysvalidoijien säännöt ja sama johdonmukainen
tietokantakuva säilyvät. Myös erien väliset viittaukset, historian loppupään
virheet ja PDF:ttömät revisiot tarkistetaan. Yksittäisen arvon, rivin ja
revision käsittely rajataan ennen mahdollista suurta materialisointia;
suunnittelussa ei oleteta koko yhden laskun historiankaan mahtuvan muistiin.
Nykyisiä PDF-määrä-, metadatateksti- tai HTTP-syöterajoja ei tulkita uuden
historiallisten varmuuskopioiden hyväksyntärajan luvaksi.

Ennen tuotantokytkentäpäätöstä vaaditaan rajattu suunnitelmakatselmus ja
synteettinen näyttö vanhojen tuettujen kopioiden säilymisestä, erien
ylittävien virheiden hylkäyksestä, rajatusta luennasta sekä virheen ja
peruutuksen siivouksesta. Muutos käyttää nykyistä tarkistinta ja sen
testiperustaa; uutta yleistä streamaus-, lokitus- tai prosessikehystä ei
lisätä. Tuettujen formaattien säilyttäminen ei lupaa rajoittamatonta
aineistokokoa tai suoritusaikaa.

Erillinen saman katalogin syyhäviö toistettiin hallitulla
`SQLITE_NOMEM`-poikkeuksella: yleinen virhemuunnos hävittää alkuperäisen syyn.
Tämä ei ole mitattu muistin loppuminen tai vanhan timeoutin juurisyy.
Korjauksen pitää säilyttää turvallinen resurssirajan syy nykyiseen
diagnostiikkaketjuun ilman raakoja virheitä tai rinnakkaista loggeria.

### Katalogin muistivirheen syyketju

Yllä nimetty syyhäviö on korjattu rajatusti. Katalogi säilyttää täsmällisen
natiivin `SQLITE_NOMEM`-poikkeuksen; muu revisiokatalogin hylkäys pysyy
`INVOICE_BACKUP_CATALOG_INVALID`-virheenä eikä käynnistä legacy-fallbackia.
Stagingin sekä cold-palautuksen molempien sisältöpolkujen omistava runtime
luokittelee muistivirheen nykyiseksi `PROFILE_INSPECTION_LIMIT_EXCEEDED`-
syyksi ennen mahdollista sulkuvirheiden yhdistämistä. Alkuperäinen poikkeus
säilyy vain sisäisessä syyketjussa. Natiivikoodia ei päätellä viestistä tai
myöhemmästä siivousvirheestä, eikä julkista statuskanavaa laajenneta.

Uudet SQL-kutsuihin kohdistetut regressiot toistivat puutteen ennen korjausta
ja läpäisivät korjattuina. Kohdenäyttö kattaa nykyisen ja tuetun vanhan
katalogin, aktivoinnin valmistelun, molemmat cold-sisältöpolut, ensivirheen
ennen sulkuvirhettä, lähdetavujen säilymisen sekä nykyisen desktop-statuskanavan.
Muiden katalogikutsujien testit läpäisivät; alustakohtaiset ohitukset eivät
ole läpäisyjä. Tämä on syyketjun näyttö, ei aito muistirajan täyttymiskoe,
uusi prosessirajan todennus, hardened-palautus tai koko K:n hyväksyntä.

### Historian eristetyn ajon kohdenäyttö

Historian tuotantokytkentä on ajettu nykyisen Electronin pääprosessin omistaman
`runProfileSnapshotInspection`-polun ja oikean Electron-tarkistusutilityn
kautta. Ehjän synteettisen revisio- ja tapahtumahistorian tarkistus sekä
aktivoinnin valmistelu läpäisivät. Erikseen vioitettu tekninen tunniste
hylättiin ilman onnistumiskuittia. Tarkistuslapsen poistuminen, varauksen
palautuminen, omistetun tarkistuskopion siivous ja lähdekannan sekä katalogin
tavujen säilyminen todennettiin erikseen. Muun kuin nimetyn turvallisen
syyn hylkäys säilyttää nykyisen `unknown`-luokituksen; julkista virhesopimusta
ei laajennettu koetta varten. Aktiivisen profiilin konteksti annettiin kokeessa
synteettisenä; oikean brokerin kontekstihakua ei todisteta tällä kokeella.

Erillinen nykyisen natiiviajurin Electron-koe läpäisi varsinaisen
SQLite-muistirajan ylityksen hylkäyksen ja sen jälkeisen tavallisen kyselyn,
readonly-suojan sekä nykyisen ja tuetun historiallisen scheman tarkistuksen.
Myös puuttuva, muuttunut tai väärän alustan ajuritoimitus hylättiin.
Tämä on eri näyttö kuin katalogiin injektoidun muistivirheen syyketju:
aidon muistirajan täyttymistä juuri historiakatalogin sisällä ei väitetä
toistetuksi. Kokeet eivät osoita koko prosessin RSS-kattoa tai kaiken
formaattirajoihin mahtuvan historian valmistumista työaikarajassa.

Tuotantokoodi, tuetut formaatit ja hyväksytyt resurssirajat säilyivät.
Ensimmäisen koevalmistelun virhe korjattiin vain synteettiseen aineistoon;
se ei ollut sovelluksen tarkistusajon epäonnistuminen.
Rajattu riippumaton koenäytön katselmus ei löytänyt estävää puutetta.
Historian kytkennän jälkeinen yksi normaali työtilan testikierros ja yhteinen
tyyppitarkistus läpäisivät muuttumattomilla asetuksilla. Ohituksia ei laskettu läpäisyiksi eikä
testiperustan sopimustestejä väitetä varsinaisiksi E2E-käyttäjäpoluiksi.
Oikea Linux-Electron-ajopolku, puhtaan paketin mittaus, hardened-palautus,
binaarihandoff sekä PR/main-portit ovat yhä erillisiä avoimia ehtoja.
Näitä tuloksia ei lasketa koko K:n tai aiempien timeoutien hyväksynnäksi.

### Laskuhistorian inkrementaalisen luennan suunnitelma

**Rajattu suunnittelu ja luentakoe, ei tuotantokytkentä.** Omistajan valitsema
suunta säilyy: koko historialle ei lisätä uutta rivi- tai tavumäärärajaa.
Koe erottaa muistissa pidettävän työjoukon aineiston hyväksyntärajasta.
Tarkistettavaa historiaa ei typistetä eikä suurta arvoa hyväksytä pelkän
alkuosan perusteella. Nykyiset prosessin aika- ja resurssirajat säilyvät.

Muutos rajataan nykyisiin Invoicingin infrastructure-validoijiin:

| Nykyinen vastuu | Suunniteltu muutos ja säilyvä sääntö |
| --- | --- |
| `SqliteInvoiceBackupArtifactCatalog` | Omistaa edelleen yhden lukutransaktion, version mukaisen katalogin ja nykyiset dokumenttirajat. Schema-portti edeltää sisältöä. Virhe ei julkaise osittaista hyväksyttyä katalogia. |
| `validateInvoiceRevisionCatalog` | Kokonaisten invoice-/revision-/current-taulukoiden ja kasvavien karttojen tilalle rajatut projektiot sekä nimetyt viite- ja duplikaattitarkistukset. Myös PDF:ttömät revisiot käsitellään. |
| `invoiceContentRevisionMapping` ja `validateInvoiceContentRevision` | Otsikon, rivin, ALV-ryhmän ja loppuehtojen nykyiset säännöt erotetaan yhteiskäyttöön; normaali mapper ja inkrementaalinen tarkistus käyttävät samaa sääntöä. Ei keinotekoisia sisältöolioita, korvaustekstejä tai rinnakkaista laskentaa. |
| Yhden revision rivit ja ALV | Myös nämä luetaan osissa. Täsmälliset summat kertyvät `BigInt`-arvoina; rivitunnisteiden, järjestysten ja verokantojen tarkistus ei kasvata rajaamatonta JavaScript-joukkoa. Historiallisia summia ei lasketa uudelleen laskuriveistä. |
| Nykyrevision vertailu | Persistence-mapperin täsmälliset sisältökentät ja järjestetyt rivit säilyvät vertailussa. Maksu-, toimitus- tai peruutustilaa ei lisätä muuttumattoman sisällön vertailuun. |
| Hyvitysviitteet | Viite kohdistuu täsmärevisioon, ei laskun nykyrevisioon. Yritys, alkuperäislasku, standard-laji, numeron/päivän snapshotit ja lähderivin jäsenyys säilyvät. Legacy-lähteen nykyinen hyväksyntä ei muutu. |
| `validateInvoiceRevisionCatalogDocuments` ja `readInvoiceEventDocument` | Dokumenttien nykyinen rajattu validointi säilytetään. Tapahtumien koko taulukko ja kasvava ratkaisemattomien lähetysten joukko korvataan. Sidossääntö jaetaan nykyisen lukijan kanssa; `legacyMissingDocument`, preserved-kopio ja testin/asiakaslähetyksen erot säilyvät. |

**Luennan rajat:** 039:n historiataulut ovat osin `WITHOUT ROWID` -tauluja.
Niille ei oleteta numeerista `rowid`-jatkoavainta eikä mahdollisesti pitkää
tekstitunnistetta siirretä kokonaisena vain sivutusta varten. Kokeen
SQLite-kursori palauttaa rajattuja skalaariprojektioita; pitkän tekstin
jatkoluku käyttää samaa tietokantakuvaa ja yksikäsitteistä järjestystä.
Kokeen ordinal/OFFSET-jatkoa ei vielä hyväksytä tuotannon hakuratkaisuksi:
sen kertautuva työ ja indeksien hyödyntäminen on arvioitava ennen kytkentää.

**Semanttinen portti:** JavaScriptin merkkijonon dekoodaus, tarkka yhtäsuuruus,
`trim()` ja UTF-16-pituus eivät kaikissa tapauksissa vastaa SQL-vertailua.
Koe toisti kahden eri virheellisen UTF-8-tavujonon muuttumisen samaksi
JavaScript-merkkijonoksi. Pelkkä SQL-join voi tällöin ohittaa nykyisen
duplikaatti- tai viitesäännön. Paloittainen dekoodattu vertailu läpäisi
rajatut kontrollit, mutta koko tunnistehaun ja duplikaattitarkistuksen
korvausta ei ole vielä todistettu. Uutta merkkikoodaus- tai yksittäisen
arvon hylkäysrajaa ei hyväksytä tämän kokeen perusteella. Myös tietokannan
merkistön ja schema-portin edellytykset kirjataan ennen tuotantototeutusta.

**Kohdenäyttö:** koe todensi rajatun JavaScriptiin luennan, pitkän arvon ja
avaimen, Unicode-/NUL-käsittelyn, myöhemmän tapahtuman virheen, lukukuvan
säilymisen toisen yhteyden kirjoittaessa sekä lukijan sulkemisen virheessä
ja hallitussa peruutuksessa. Jatkoluku katettiin usealla pitkällä rivillä
sekä kesken yhden arvon lukemisen tehtävällä WAL-kirjoituksella. Tekstivertailu
hylkää myös samanpituisen arvon viimeisen merkin eron. Ensivirhe säilyy
erillään sulkuvirheestä; pelkkäkään sulkuvirhe ei tuota onnistumistulosta.
Nykyisen 038 -> 039 -fixturen katalogi säilyi. Lopullisen rajatun koesarjan
37 tapausta ja tyyppitarkistus läpäisivät. Riippumaton lukupohjainen
katselmus ei löytänyt korjatusta luentakokeesta avointa oikeellisuusvirhettä.
Tämä ei todista koko uuden validaattorin sääntövastaavuutta, natiivin
muistikattoa, ulkopuolelta tulevaa prosessiperuutusta tai paketoitua palautusta.
Sulkuvirhekoe todistaa virheiden erottelun, ei natiivisti sulkematta jäävän
kursorin onnistunutta siivousta.

**Aiempi rajattu suunnitteluportti:** täsmennä yhteisten sääntöjen
kenttäkohtainen jako sekä koko avain-/viitevertailun rajattu toteutustapa ja
todista niiden vastaavuus nykyiseen tarkistimeen. Ei uutta yleistä tekstin-
streamaus- tai validointikehystä. Riippumaton katselmus ja tämän portin
näyttö edeltävät erillistä tuotantokytkentäpäätöstä. Tämän portin jälkeinen
hyväksytty toteutusrajaus on alla. K:n muut loppuportit ja
erillinen muistivirheen syyketjukorjaus säilyvät.

Indeksoitu SQL-haku edellyttää molempien puolten tyyppi-, dekoodaus-,
collation- ja null-sääntöjen vastaavuutta. Poikkeavien dekoodattujen
avainten duplikaattitarkistusta ei saa tehdä vain SQL-haun puuttuessa:
ristiriita voi olla olemassa myös täsmällisen SQL-osuman rinnalla.
Tämä on kokeen nimenomainen hylkäyskontrolli, ei uusi
hyväksyntäpolitiikka tai lupa tunnisteiden normalisointiin.

**Viitevertailun jatkokoe ja rajattu suunnittelupäätös:** erilliset 12 synteettistä
avainvertailutapausta sekä tyyppitarkistus läpäisivät. Nykyinen katalogi voi
hyväksyä PDF:ttömän legacy-revision, jonka tekninen tunniste sisältää
virheellisesti koodattuja tavuja. Tallennettujen tavujen SQL-vertailu,
dekoodatun tunnisteen vertailu ja sen palauttaminen SQL-parametriksi eivät
ole tällöin sama sääntö. Tämä ei osoita koko varmuuskopioketjun hyväksyntää
eikä koske havaintoa käyttäjän aineistosta. Kelvollisen Unicoden ja pitkän
tunnisteen kontrollit säilyivät.

Omistaja hyväksyi jatkosuunnitelman suunnaksi virheellisen koodauksen
hylkäämisen nimetyissä relaatiotunnisteissa. Tämä on hyväksyntäkäytöksen
rajattu muutos, ei väite vanhan tarkistimen täydestä vastaavuudesta.
Vanha tuettu skeema ja siitä tehtävä migraatio eivät ole vioittunut tunniste;
niiden yhteensopivuus pitää edelleen todistaa. Tunnisteita ei normalisoida,
korjata tai poisteta automaattisesti. Yhteinen katalogi osallistuu myös uuden varmuuskopion luontiin
ja palautumisen tarkistuksiin, joten päätös ei koske vain vanhan kopion
tuontia. Vapaata tekstiä, kelvollisia Unicode-merkkejä, formaattien nykyistä
tukea tai kokorajoja ei muuteta tällä suunnittelulla. Täsmällinen kenttärajaus,
rajattu toteutustapa ja katselmus viimeistellään ennen erillistä
tuotantokytkentäpäätöstä.

#### Historian luennan toteutussopimus

**Omistaja hyväksyi rajatun tuotantokytkennän ja testit 13.10.2026.**
Hyväksyntä kattaa alla nimetyn osissa luennan, yhteiset tarkistussäännöt ja
rajatun virheellisen tunnistekoodauksen hylkäyksen. Se ei hyväksy K:n
kokonaisuutta tai mergeä eikä muuta formaatteja, riippuvuuksia tai rajoja.

Suunnittelu koskee nykyisen katalogin `revisionHistory`-haaraa.
`legacyDocuments`-valinta säilyy varmennetun skeemaversion perusteella;
vanhaa aineistoa ei käsitellä uuden skeeman kyselyillä. Migraation jälkeinen
revisiohistoria tarkistetaan uuden haaran sopimuksella. Historiallisia
migraatioita, palautusformaattia, laskentasääntöjä tai tavallisen sovelluksen
kokonaisia laskumalleja ei muuteta tämän luentatavan vuoksi.

Tuotantoehdokas korvaa katalogin kasvavat rakenteet yhtenä rajattuna muutoksena:

1. Invoicingin sisäiset, täsmällisesti nimetyt SQL-projektiot palauttavat
   rajattuja numero-/tekstihavaintoja. Etenemisavaimet pysyvät SQLiten
   sisällä; pitkää tunnistetta ei lueta kokonaisena JavaScriptiin sivutusta
   varten. Pelkkä `.iterate()` koko riville ei täytä muistirajausta.
2. Nykyisen mapperin otsikko-, rivi-, ALV-ryhmä- ja loppusäännöt erotetaan
   pieniksi saman moduulin yhteisiksi tarkistuksiksi. Normaali mapper ja
   varmuuskopion tarkistin käyttävät niitä molemmat. Ei korvaavia tyhjiä
   sisältöolioita, toista laskentaa tai yleistä validointikehystä.
3. Nykyrevision vertailu käyttää persistence-mapperin yhteisiä täsmällisiä
   kopio-/lähdekenttiä ja lähteen tarkistusta. Kenttäkohtainen kattavuustesti
   estää uuden snapshot-kentän unohtumisen vertailusta. Null-ero, dekoodatun
   tekstin yhtäsuuruus ja molempien järjestettyjen rivijonojen loppuminen
   säilyvät. `invoices.credited_invoice_id` ei kuulu uuden koodauseston
   kenttiin: sen lähdevertailu säilyy dekoodattuna, ei uutena SQL-oikopolkuna.
4. Nimetyt orpo-, historia-, nykyrevisio- ja hyvityslähdekyselyt korvaavat
   kasvavat kartat ja joukot. Jokaisella laskulla on historia; sallitut tilat
   ovat `approved`, `sent`, `cancelled` ja `reopened_for_edit`. Uudelleenavatulla
   ei ole nykyrevisioviitettä, muilla on. Hyvityslähteen ei tarvitse olla
   nykyinen: sen yritys, täsmärevisio, standard-laji, numero ja päivä säilyvät
   tarkistuksessa. Null-lähderiviviite ei muutu pakolliseksi.
5. Myös yhden revision rivit ja ALV-ryhmät käsitellään osissa. Jokaisen
   ALV-ryhmän verokanta ja kolme summaa ovat ei-negatiivisia turvallisia
   kokonaislukuja; ryhmän oma `net + vat = gross` tarkistetaan ennen
   kokonaissummia. Verokantajoukkojen vastaavuus tarkistetaan molempiin suuntiin.
6. Tapahtumaluenta jakaa nykyisen dokumenttisidoksen säännön sen lukijan
   kanssa. Legacy-tapahtuman nykyinen aikainen paluu ja PDF:n puuttumisen
   poikkeus säilyvät. Nykyisin rajattua dokumenttiluetteloa ei kirjoiteta
   uudelleen. Korvatut historian kokonaistaulukot poistetaan vasta vastaavan
   kattavuuden jälkeen; rinnakkaista vanhaa katalogitarkistinta ei jätetä.

**Rajattu tekstitarkistin:** `validateInvoiceRevisionIdentifiers` käyttää
samassa lukutransaktiossa kiinteitä otsikko- ja rivikenttiä sekä aiempaa
natiiviavaimella etenevää tavuluentaa. Tavallisen mapperin nonblank-sääntö
ja yksikön trimmatun UTF-16-pituuden sääntö ovat yhteisiä. Vain työmuisti
rajataan: pitkä tunniste, kuvaus tai yksikön ympäröivä tyhjätila ei saa
uutta kokorajaa. Null, tyhjä ja whitespace-only säilyvät eri arvoina.
Tämä kenttäjoukko ei laajenna relaatiotunnisteiden koodausestoa.

Vapaan tekstin tulkinta säilyy tavallisen tietokanta-ajurin mukaisena.
UTF-16-tallennuksen osissa luenta käyttää rajattujen fragmenttien SQLite-
muunnosta samalla yhteydellä; tavallinen tekstidekooderi yksin ei säilyttänyt
kaikkien virheellisesti koodattujen vapaiden arvojen aiempaa tulkintaa.
Muunnos valmistellaan ennen kursorin avaamista. Ensimmäinen lukuvirhe
säilyy sulkuvirheestä erillään, ja yhä varattu kursori estää onnistumisen.
Tekstitarkistin kuuluu nyt alla kuvatun yhtenäisen katalogikytkennän osaksi.
Sen oma kohdenäyttö ei yksin todista koko K:n muistirajaa tai palautusta.
Tekstiosan seitsemän tiedoston regressiokierros ja tyyppitarkistus läpäisivät.
Rajattu riippumaton katselmus ei löytänyt avointa toteutusvirhettä;
sen pyytämät natiivin muunnosvirheen ja samanaikaisen sulkuvirheen kontrollit
läpäisivät. Koko historian kytkentä ja jäljempänä vaaditut loppuportit säilyvät.

**Rajattu numero-, tila- ja ALV-lukija:** `validateInvoiceRevisionScalars`
käsittelee otsikot, rivit ja järjestetyt ALV-ryhmät samassa lukutransaktiossa.
`invoiceRevisionScalarScanSql` palauttaa vain kiinteät tyyppi-/viitehavainnot,
numerot ja nykyisen kieliopin rajaamat pienet enum-/päiväarvot. Tunnisteita
tai vapaita tekstejä ei palauteta kokonaisina. Se edellyttää skeeman,
relaatiokoodauksen ja nonblank-/yksikköarvojen tarkistusta samassa lukukuvassa.
Skeeman varmennetut avaimet takaavat rivien järjestysnumeroiden ja
ALV-kantojen yksilöllisyyden; kyselysuunnitelman tarkistus kattaa järjestetyn
luennan ilman tulosjoukon kokoista välilajittelua.

Tavallinen mapper ja uusi lukija jakavat provenienssin, kokonaislukujen,
tilojen, rivisuhteiden ja summien säännöt. Kolme `BigInt`-kertymää nollataan
revision vaihtuessa. Verokantojen vastaavuus tarkistetaan molempiin suuntiin;
laskurivien summista ei lasketa uudelleen historiallista ALV-erittelyä.
Legacy-erittelyn puuttuminen ja käännetyn verovelvollisuuden aikainen haara
säilyvät. UTF-16:n tavallisen ajurin ohittama pariton lopputavu ei saa
muuttaa pienen vapaan kentän hyväksyntää uudeksi koodausestoksi.

Skalaarilukijan, tavallisen lukijan ja nykyisten katalogien regressiokierros,
tyyppitarkistus sekä rajattu riippumaton katselmus läpäisivät. Kontrollit
kattavat vanhan skeeman migraation, suuren rivijoukon myöhemmän virheen,
tarkat summat, WAL-lukukuvan sekä alkuperäisen virheen säilymisen myös
kursorin sulkemisen epäonnistuessa. Lukija kuuluu nyt yhtenäiseen
katalogikytkentään; vanha materialisoiva tarkistin on korvattu eikä jää
sen rinnalle tai uuden luennan perään.
Tämä osatulos ei vielä todista koko prosessin resurssirajaa tai palautusta.

**Nykyrevision ja hyvityslähteen luenta:** `validateInvoiceRevisionCatalog`
käyttää rajattuja teksti-, skalaari-, suhde- ja paritarkistuksia yhden
lukukuvan sisällä. Vanha laskujen/revisioiden/rivien kokonaisluenta sekä
sen kasvavat kartat ja joukot on poistettu. Katalogin omistava transaktio,
skeeman valinta ja erikseen rajattu dokumenttiluettelo säilyvät.

Tallennus ja vertailu jakavat `invoiceContentRevisionPersistenceRows`-
kenttäsopimuksen ja lähdesäännön. Natiivien järjestysavainten varaan tehtävä
riviparitus tarkistaa kattavuuden molempiin suuntiin sekä kaikki rivikentät,
myös rivitunnisteen ja järjestysnumeron. Näin se säilyttää järjestettyjen
jonojen vertailun ilman kokonaisia rivejä muistissa. Aukottomia
järjestysnumeroita ei vaadita. Hyvityksen täsmällisen lähderevision ei
tarvitse olla nykyinen, eikä null-lähderivistä tule pakollista viitettä.

Vapaat vertailutekstit dekoodataan rajatuissa osissa tavallisen ajurin
säännöillä. Eri tavumäärä tai lukupalojen eri pituus ei yksin tarkoita
sisältöeroa. Null-, teksti- ja numeroeroja ei peitetä SQL-muunnoksilla.
Nykyisen laskun koodauseston ulkopuolinen `credited_invoice_id` säilyy
dekoodattuna vertailuna. Kummankin lukijan sulku yritetään myös virheessä;
sulkuvirhe ei korvaa ensivirhettä. Yksikään aktiiviseksi jäävä lukija ei
oikeuta onnistunutta tulosta.

Pariluennan ja nykyisten katalogien kohderegressiot sekä rajattu riippumaton
katselmus läpäisivät. Sisäistä tarkistinta suoraan käyttäneet legacy-testit
on sovitettu katalogin oikeaan transaktio-omistajaan, ja palautusketjun
kutsujatestit läpäisivät. Sisältö- ja historiavaatimuksia ei kevennetty.
Tämä on katalogikytkennän checkpoint, ei koko K:n hyväksyntä.
[Muistivirheen turvallinen syyketju](#katalogin-muistivirheen-syyketju) on
kohdetodennettu erikseen. Eristetyn ajurin resurssitodennus, paketoitu
palautus sekä PR/main-portit pysyvät erillisinä loppuehtoina.

**Lukutavan jatkonäyttö:** kiinteän revisiotaulun natiivi etenemiskoe läpäisi
31 tapausta sekä tyyppitarkistuksen. Rajattu näyttö sisältää pitkät avaimet
ja tekstit, myöhemmän rivin virheen, lähdetavujen säilymisen, keskeytyksessä
sulkeutuvan lukijan sekä samassa lukukuvassa pysymisen toisen kirjoittajan
muuttaessa seuraavia tavuja. Ensimmäisen koeversion oma tekstimuotoinen
SQL-rakennetarkistus korjattiin; sen hylkäys säilyy erillisenä.
Lukutavan omissa kokeissa sulkuvirhe ei peitä ensivirhettä eikä yksinään
tuota onnistumista. Koefixturen siivous yrittää myös muiden omistettujen
yhteyksien sulkua yhden tallennus- tai sulkuvirheen jälkeen; epävarma siivous
estää tutkimusaineiston poistamisen.

Kokeen yksi alkuarvo ja enintään yksi seuraaja käyttävät `UNION ALL` -kyselyä.
Todennettu kyselysuunnitelma käyttää pääavainhakuja ja co-routine-luentaa.
SQLiten [rekursiivisen kyselyn kuvaus](https://www.sqlite.org/lang_with.html#recursive_common_table_expressions)
selittää jonon ja duplikaattiseurannan eron, mutta se ei korvaa oman kyselyn
todennusta. Pitkä avain ja tietokantamoottorin välitulokset kuluttavat silti
natiivimuistia: tämä ei ole koko prosessin muistirajan todiste.

**Ennen kytkennän hyväksyntänäyttöä:** pysyvät regressiot kattavat myös yhdistelmä-
ja nullable-avaimet, kaikki yllä nimetyt säännöt, nykyisen ja historiallisen
aineiston, pitkät yksittäiset arvot ja suuren määrän pieniä revisioita,
parivertailut sekä virheen/sulkemisen erottelun. Vanhaan tarkistimeen verrataan
hyväksyntätulosta kaikissa muissa tapauksissa kuin erikseen hyväksytyissä
virheellisen tunnistekoodauksen poikkeuksissa. Natiivin tarkistusajurin ja
paketoidun palautuksen näyttö vaaditaan edelleen. Erillinen `SQLITE_NOMEM`-
syyn säilyttäminen tehdään nykyiseen virheketjuun. Ei uusia riippuvuuksia,
aikarajoja, historiakokorajoja tai testialustaa. Tämä on hyväksytty toteutusrajaus,
ei ilmoitus koko tarkistimen tai K:n valmistumisesta.

**Ensimmäinen toteutuspala:** tallennettujen arvojen sekä otsikon, rivien ja
ALV-koosteen säännöt on erotettu Invoicingin sisäisiksi yhteisiksi funktioiksi
ja kytketty tavalliseen revisiolukijaan. Rajattu riippumaton katselmus ei
löytänyt hyväksyntäsäännön regressiota. Katselmuksen jälkeen säilytettiin
käännetyn ALV:n aikainen paluu ja lisättiin oikean lukijan Unicode- sekä
usean samanaikaisen virheen kontrollit. Lopullinen 12 tiedoston kohdeajo
läpäisi 373 testiä ja backendin tyyppitarkistuksen, mukaan lukien vanhan
skeeman migraatio ja palautuksen valmistelu. Nämä eivät ole koko työtilan tai paketoidun ketjun
hyväksyntä.

**Relaatiotunnisteiden toteutuspala:** nimetyn kenttäjoukon koodausesto on
kytketty katalogin nykyiseen lukutransaktioon ennen historiatarkistuksia.
Kiinteät SQL-projektiot pitävät etenemisavaimet SQLitessä ja palauttavat
vain rajattuja tavupaloja. Yhdistelmäavaimet sekä vanhojen taulujen todelliset
rivitunnisteet käsitellään erikseen; nullable-ID ei saa aiheuttaa rivin
ohitusta. UTF-8- ja UTF-16-tallennuksen käsittely ei muuta skeeman erillistä
yhteensopivuuspäätöstä. Vain nimettyjen tekstiviitteiden virheellinen koodaus
hylätään tällä säännöllä; muut tyyppi- ja null-säännöt jäävät nykyisille
tarkistimille. Pitkän avaimen natiivimuisti kuuluu edelleen eristetyn
tarkistusprosessin nykyisiin rajoihin, ei JavaScript-palakoosta johdettuun
oletukseen. Historian muut rajatut projektiot, parivertailut ja kasvavien
katalogirakenteiden korvaaminen ovat edelleen kesken.
Tämän palan rajattu katselmus ei löytänyt toteutusvirhettä. Sen nimeämät
tyhjän/täsmämittaisen tekstin ja palarajan ylittävän UTF-16-merkin kontrollit
lisättiin. Lopullinen kuuden tiedoston kohdeajo läpäisi 221 testiä; yksi
ennestään ohitettu tapaus pysyi ohitettuna. Erillinen palautuskutsujien ajo
läpäisi 217 testiä kolmella ennestään ohitetulla tapauksella. Backendin
tyyppitarkistus läpäisi. Nämä ovat lähdekoodin kohdetodennuksia, eivät
paketoidun palautuksen tai koko K:n hyväksyntä.

**Toimitushistorian toteutuspala:** tapahtumien kokonaistaulukko ja
ratkaisemattomien toimitusten kasvava muistijoukko on korvattu kiinteillä
SQL-tarkistushavainnoilla. Dokumenttisidoksen sääntö on yhteinen tavallisen
historian PDF-lukijan kanssa. Katalogin tapahtumaluenta tapahtuu vasta
relaatiokoodauksen, revisioiden ja rajattujen dokumenttien tarkistuksen
jälkeen samassa lukutransaktiossa. Legacy-null, legacy-haaran aikainen paluu,
yritysrajaus sekä nykyiset toimitus- ja todistevaatimukset säilyvät.
Korvattu algoritmi on vain testiorakkelina, ei rinnakkaisena tuotantopolkuna.
Rajattu riippumaton katselmus ei löytänyt hyväksymissäännön regressiota;
sen nimeämät tunnisteiden tyyppi-/Unicode- ja rajauskontrollit lisättiin.
Lopullinen kahdeksan tiedoston kohdeajo läpäisi 219 testiä yhdellä ennestään
ohitetulla tapauksella. Mukana ovat vanhan skeeman palautuksen valmistelu,
tavallinen historian PDF-luku, muuttumaton lukukuva toisen kirjoittajan
aikana sekä ensivirheen ja sulkuvirheen erottelu. Backendin tyyppitarkistus
läpäisi. Nämä ovat kohdetodennuksia, eivät koko K:n hyväksyntä.
Revision otsikoiden, rivien, ALV-ryhmien ja nykyrevision parivertailun
kokonaistaulukoiden korvaaminen sekä natiivi- ja palautusportit ovat yhä
avoimia. Tätä palaa ei tulkita koko katalogin muistirajan hyväksynnäksi.

### Paketoinnin budjettipäätös

**Omistaja hyväksyi rajamuutoksen ja tarkistukset 12.10.2026.** K:n sovellusosan
sisältö ylitti aiemman paketti-inventaarion tiedostomäärä- ja kokobudjetin.
Ennen päätöstä tehty sisältötarkistus ja 59 paketointisopimustestiä
eivät itsessään hyväksyneet rajamuutosta tai pakettia.

Hyväksytty rajaus on sovellusosan tiedostomäärä 352 -> 400 sekä
sovellusosan kokonaiskoko ja täsmällisen `resources/app.asar`-tiedoston
kokobudjetti 2,25 -> 2,75 MiB. Rajattu toteutus ja 66 paketti-inventaarion
rajatestiä läpäisivät. Täsmällinen `resources/app.asar` on ainoa tämän
muutoksen laajemman tiedostokokorajan saava paketoitu tiedosto; muiden
tiedostojen ja vaiheiden rajat säilyvät. Puhtaan paketin mittaus ja sisällön
loppukatselmus ovat vielä avoimia.
Muiden artifactien rajat, sallitut sisällöt ja eheysvaatimukset säilyvät.
Toteutuksen raja-arvo- ja ylitysregressiot sekä nykyisen työpuun erillinen
sisältö-/kokomittaus läpäisivät. Puhtaan revision uusi paketti-inventaario
vaaditaan edelleen. Jaeltavaa artifactia ei rakenneta
dirty-työpuusta, eikä tutkimusmittausta nimetä release-hyväksynnäksi.

### Suuren katalogin palautusraja

Nimetty suuremman synteettisen PDF-katalogin koe ei vielä läpäise cold-forward-
palautuksen nykyistä yhteistä työbudjettia. Tarkistusutility valmistui ja
poistui, mutta sen jälkeen saman sisällön toistuvat tarkistukset saavuttivat
aikarajan ennen live-terminalin hyväksyntää. Rajattu vaihehavainto erotti
tämän tarkistusprosessin jumittumisesta. Alkuperäinen tietokanta, PDF:t,
staging-aineisto ja journal säilyivät; siivousvaltuutta ei päätelty tästä.
Ensimmäisen ajon erillinen varauksen sulkuvirhe säilyy omana havaintonaan.

Tarkistuskohtien lähdekartoitus ja pieni synteettinen koe erottivat
journal-kirjoitukset, korjaavat luvut ja business-tiedostomuutokset.
Koe käytti nykyistä journal-storea ja siirtotransaktiota oikeisiin
synteettisiin tiedostoihin; sisällön tarkistus oli rajattu hash-kontrolli,
ei SQLite-, native-omistajuus- tai suorituskykytodistus.

Rajattu riippumaton suunnittelukatselmus vahvisti, ettei business-siirron
myöhempi hylkäys korvaa journalin omia tarkistuskohtia: ilman niitä muuttunut
sisältö voisi sallia uuden journal-välitilan julkaisemisen tai edeltäjän
poistamisen. `read` puolestaan voi korjata tai poistaa sivuslotin. Puuttuvan
slotin havainnon jälkeen ei saa jättää suojaamatonta poistokutsua, joka voisi
osua myöhemmin ilmestyneeseen tiedostoon.

**Rajattu lukutehon koe hyväksytty 12.10.2026, ei tuotantokytkentää.**
Omistaja hyväksyi suunnittelun ja synteettisen kokeen enintään neljän PDF-tiedoston rinnakkaisesta luvusta
yhden sisältötarkistuksen sisällä. Tietokannan luku säilyisi erillisenä,
journalin ja transaktion tarkistuspaikat ennallaan. Koe ei käytä vanhan
tarkistuksen hashia, aikaleimaa tai kuittia uusien tavujen korvikkeena.
Erillinen koeehdokas on toteutettu ilman tuotannon lähde- tai build-muutoksia.

Kokeen vähimmäisehdot ovat samat koko-, hash-, PDF-alkutunniste-,
polku-/kahvaidentiteetti- ja linkkitarkistukset sekä viimeinen uudelleensidonta
tuoreen valtuustarkistuksen jälkeen. Rinnakkaisuus ja puskurit rajataan;
virhe tai peruutus estää seuraavan erän aloittamisen. Käynnissä olevien
lukujen ja kahvojen päättyminen todetaan ennen onnistumista tai vapautusta,
ja ensimmäinen virhe säilyy erillään mahdollisista sulkuvirheistä. Myöhäinen
luku ei anna poisto- tai jatkovaltuutta. Nykyinen epävarman aineiston
säilytyssääntö pätee edelleen.

Ensin verrataan muuttuneiden samankokoisten tavujen, vanhentuneen valtuuden,
slot-ristiriitojen ja sulkuvirheiden hylkäyksiä nykyisiin kohderegressioihin.
Vasta vastaavan turvallisuuskäyttäytymisen jälkeen nimetään rajattu
vertailu samalla synteettisellä aineistolla. Jos hyöty ei riitä, tulos
kirjataan ja vaihtoehdot tuodaan omistajan päätettäväksi; tästä ei seuraa
automaattista tarkistusten vähentämistä, yleistä välimuistia tai uutta
testialustaa. Tuotantokytkentä ja oikean palautusketjun hyväksyntä ovat
erillisiä myöhempiä portteja.

Koeehdokkaan ja nykyisen sarjaluennan sekä koeraportin 50 kontrollia läpäisivät.
Mukana ovat DB-/PDF-slottiyhdistelmät, muuttuneet tavut ja tiedostoidentiteetti,
myöhäinen muutos viimeisessä valtuustarkistuksessa, vanhentunut valtuus sekä
kesken lukuerän tapahtuva peruutus, määräajan päättyminen ja luku-/sulkuvirhe.
Hallittu suoritusjärjestys todisti, ettei uusi erä tai tietokannan luku ala
epäonnistuneen erän jälkeen eikä tulos valmistu keskeneräisten lukujen yli.
Varmistamattoman sulun koe jäi hylätyksi ja säilytti aineiston; koeharnessin
myöhempi kahvan sulkeminen ei ollut tarkistimen onnistumista.
Katselmuksen osoittamat koepuutteet korjattiin: hash-hylkäys erotettiin
alkutunnisteen hylkäyksestä, ensivirheen säilyminen todistettiin ensimmäisen
sulun ollessa edelleen estettynä ja lähdetiivistevirheen loppuraportti
todennettiin erillään alkuperäisestä virheestä.

Ensimmäinen koe pysähtyi suurten PDF:ien kontrollin virheelliseen täsmällisen
rinnakkaisuusmäärän odotukseen. Sallittu raja on enintään neljä; erillinen
hallitun järjestyksen koe todistaa neljän yhtäaikaisen luvun. Vain tämä
testiodotus korjattiin ennen nimettyä uutta koetta. Ensihylkäys säilyy.
Rajattu sarja-/eräluvun vertailu osoitti nopeushyötyä samoilla synteettisillä
tavuilla, mutta ei todenna koko cold-palautuksen aikabudjettia. Kokeen
tietokantatiedosto oli tarkoituksella pelkkiä testitavuja, ei SQLite-kanta;
native-omistajuutta, RSS-rajaa tai paketoitua palautusta ei tällä hyväksytä.
Riippumaton rajattu koekatselmus ei jättänyt korjattavaa tarkennettuihin
kontrolleihin. Tuotantokytkentä ja koko palautusketjun jatkoratkaisu ovat
edelleen avoinna; ne eivät seuraa automaattisesti yksittäisen lukijan nopeutumisesta.

**Jatkokokeen tulos 12.10.2026: lukunopeutus ei yksin riitä.** Erillinen
koekytkentä läpäisi Node- ja Electron-tarkistukset sekä rajatun katselmuksen.
Lukijan todellinen käyttö, tarkka koetoteutus ja lähteiden muuttumattomuus
varmennettiin; pelkkää moduulin lataamista ei tulkittu käyttötodisteeksi.
Koekytkennän ensimmäisen tarkistuksen oma käynnistysvirhe säilyy erillisenä
koeharnessin havaintona, ei sovelluksen vikana.

Yksi nimetty suuren katalogin oikean prosessiketjun koe eteni aiempaa
pidemmälle mutta hylättiin edelleen nykyisessä yhteisessä aikabudjetissa.
Ensimmäinen tarkistusutility valmistui ja poistui; toistuva sisältötyö kulutti
budjetin ennen seuraavan slottivalinnan erillisen tarkistuksen valmistumista.
Myös tämän tarkistajan poistuminen havaittiin. Live-terminalin hyväksyntään
ei päästy. Alkuperäinen kanta ja PDF:t, palautettavat tavut ja journal
varmennettiin säilyneiksi. Tämä ei todista koko ulomman prosessipuun puuttumista
eikä anna aineiston poisto- tai palautusvaltuutta.

Vain koepääprosessi käytti erälukuehdokasta. Tuotannon lähde ja build sekä
utilityn, journalin, aikarajan ja siivouksen sopimukset pysyivät muuttumattomina.
Tuotantokytkentää tai uutta pitkää uusinta-ajoa ei tehdä tämän tuloksen perusteella.
Seuraava päätös koskee koko palautuksen tarkistustyön rajattua suunnittelua,
ei uuden loggerin rakentamista. Journalin teknisten välivaiheiden ja varsinaisen
sisällön julkaisu-/siirtorajojen erottaminen on vasta ehdotus: nykyistä
sisältöporttisopimusta ei muuteta ilman omistajan päätöstä ja regressiotodistusta.

Tämän aiemman kokeen aikana [viiden mutaatiorajan sopimus](#journalin-valinta--ja-sisältötarkistuksen-rajattu-koe)
säilyi voimassa. Myöhempi erillinen [tuotantopäätös](#pdf-luvun-ja-cold-journalin-tuotantokytkentä)
hyväksyi alla kuvatut tarkistuskohtamuutokset; se ei hyväksynyt hylättyä
hyväksyntäjournalin nopeutusta tai muiden tarkistusten poistamista.
Aika- ja muistirajat säilyvät. Kohdekokeita ei nimetä suuren katalogin
onnistumisen, hardened-palautuksen, enimmäisformaatin tai historiallisten
CI-aikakatkaisujen ratkaisuksi.

#### Tarkistuskohtien jatkosuunnittelu

**Alkuperäinen päätös 12.10.2026 koski vain rajattua suunnittelua ja synteettistä koetta.**
Tuotannon viiden sisältöportin sopimus säilyy kokeen aikana. Seuraavat kolme
muutosta arvioidaan erillisinä ja yhdessä nykyisten omistajien koekopioilla:

1. Journalin `write`: nextin luonti/kirjoitus ja currentin siirto backupiksi
   käyttäisivät tuoretta omistajuus-, valinta- ja slottitarkistusta. Koko
   sisällön tarkistus säilyisi ennen nextin julkaisua ja ennen edeltäjän
   poistamista. Avatun nextin identiteetti ja muuttumattomat journal-tavut
   tarkistetaan edelleen; erillistä sisältöporttia vailla oleva kutsuja ei
   saa tätä kevennystä.
2. Journalin `read`: jos poistettava sivuslotti on aidosti poissa, sille ei
   tehdä poistokutsua lainkaan. Läsnä olevan slotin korjaus/poisto vaatii
   edelleen nykyisen valtuuden. Poissaolohavainto ei oikeuta myöhemmin
   ilmestyneen tiedoston poistamista. `clear` säilyy ennallaan.
3. Cold-forward-siirron kohdekansion valmistelu erotettaisiin payloadin
   siirrosta. Kansion luonti/oikeuksien rajaus säilyttäisi tuoreen omistajuuden,
   journal-valinnan sekä tuoreen rakenteen, slottien ja polkujen tarkistuksen
   ennen jokaista valmistelumuutosta; varsinainen rename ja
   aktivoitujen DB-/PDF-kohteiden oikeusmuutos vaatisivat edelleen tuoreen
   sisältötarkistuksen. Yhdistettyä vanhaa valtuutta käyttävät kutsujat ja
   rollbackin siirtovaltuus säilyvät ennallaan.

Tämä muuttaisi sallittuja teknisiä välitiloja: sisältövirhe voisi jättää
nextin, siirtää nykyisen journalin backupiksi tai valmistella kohdekansion
ennen hylkäystä. Se ei saa julkaista tarkistamatonta nextiä, siirtää business-
sisältöä tai poistaa palautusaineistoa. Uusi käynnistys tarkistaa sisällön
uudelleen; tekninen journal-valinta ei itsessään ole palautusvaltuus.

Kokeessa säilytetään ensivirhe ja molemmat aineistot. Muuttuneet DB-/PDF-tavut,
vanhentunut valtuus, next-/backup-ristiriidat ja keskeytykset ennen julkaisua
sekä ennen poistoa katetaan. Onnistuvan forward-polun lisäksi vanhat yhdistetyt
kirjoittajat ja rollback toimivat kontrollina. Tarkistusmäärä mitataan samalla
pienellä tiedostoaineistolla, mutta siitä ei päätellä suuren katalogin
suorituskykyä. Ei hash-välimuistia, tarkistuskuitin siirtämistä toiseen
slottiin, uutta rajapintakehystä, prosessia tai aikarajamuutosta.
Riippumaton suunnittelukatselmus ja koe edeltävät mahdollista tuotantopäätöstä.

**Rajattu koetulos:** korjattu ehdokas läpäisi 61 synteettistä tapausta.
Samalla pienellä aineistolla koko sisältö tarkistettiin lähtöpolussa 70 kertaa,
journal-muutoksen jälkeen 43, poissaolevien slottien no-op-erottelulla 39 ja
rakenteen tarkistavalla kansiovalmistelulla 27 kertaa. Nämä ovat kokeen
tarkistusmääriä, eivät suuren aineiston suorituskyky- tai aikarajatodistus.

Katselmus osoitti koekansion valmistelussa puuttuvan polkuselvityksen ennen
muutosta. Hakemistolinkkikoe toisti puutteen; koekopio korjattiin käyttämään
nykyistä forward-rakennetarkistusta omistajuus-/valintatarkistusten välissä.
Korjattu koe hylkää linkin ennen kansiomuutoksia. Tuotannon nykyiseen
toteutukseen tätä koepuutetta ei siirretty. Muut katselmuspuutteet katettiin
sisältöhylkäysten täydellisellä journal-slottien läsnäolo-/tiivistevertailulla,
siirron jälkeisillä hylkäyksillä sekä erillistä sisältöporttia käyttävän cold-
rollbackin keskeytys- ja jatkamiskokeilla. Aiemmat koetulokset jäävät historiaksi.

Muuttumaton nykyinen palautuskoodi jatkoi kahdeksasta tiedostosiirron jälkeisestä
intent-/completed-välitilasta ja hylkäsi muuttuneen aineiston ennen korjauksia.
Tämä ei ollut aiemman julkaistun ohjelmaversion tai käyttöjärjestelmän
kaatumiskoe. Cold-rollbackin jatko todettiin koekopiossa, ei vanhassa binäärissä.
Riippumaton lähdekatselmus ei jättänyt estävää löydöstä korjattuun rajaukseen;
tuotannon lähde ja build säilyivät muuttumattomina.

Omistaja hyväksyi seuraavaksi yhden nimetyn oikean palautusketjun kokeen, joka
yhdistää tarkistuskohtien ehdokkaan ja aiemman erälukuehdokkaan vain
koepääprosessissa. Koe käyttää oikeaa SQLitea ja tuhatta synteettistä PDF:ää
nykyisen aikarajan sisällä. Se ei ole hyväksytty tuotantokytkentä, aikarajan nosto
tai lupa toistaa koetta vihreäksi. K:n native-/Linux-/hardened-/PR-/main-portit
säilyvät erillisinä.

Nimetty yhdistetty koe on ajettu, mutta koko palautusketjun hyväksyntä puuttuu.
Live-terminalin loppusiivouksen rajattu lähde- ja työmääräkartoitus sekä
riippumaton tulkintakatselmus on tehty. Ne eivät sulje aikarajahavaintoa tai
hyväksy oikean palautusketjun loppusiivousta. Tarkempi aineisto säilyy paikallisena.

Nykyisen poistovaltuuden regressiot on täsmennetty erottamaan koko inventaarion
tarkistus yksittäisen poistokohteen odotettavasta identiteettiluvusta. Testit
todistavat, että sen aikana menetetty live-kirjoitussuoja tai sitä seuraavan
journal-luvun aikana vanhentunut valtuus estää poiston ja säilyttää hyväksytyn
journalin sekä alkuperäisen ja palautetun aineiston. Kahden testitiedoston
263 tapausta ja desktopin tyyppitarkistus läpäisivät. Tämä on nykyisen sopimuksen
regressionäyttöä testiadaptereilla, ei native-varausten, suorituskyvyn tai koko
palautusketjun hyväksyntä eikä lupa muuttaa tarkistuspisteitä.

Omistaja hyväksyi rajatun suunnittelun ja synteettisen kokeen vain
hyväksyntäjournalin toistuvien tiedostoluettelotarkistusten vähentämiseksi.
Inventaario todistaa
tiedostoidentiteettejä ja rakennetta, ei korvaa sisältövalidointia. Mahdollisen
suunnittelu- ja synteettisen kokeen pitää säilyttää tuore live-valtuus, täsmällinen
journal-valinta sekä jokaisen nimetyn tiedostopoiston valtuustarkistus myös
odotettujen lukujen jälkeen. Nykyistä sopimusta ei muuteta tämän kartoituksen
perusteella. Kylmävaiheen koekorjaukset eivät oikeuta muuttamaan poiston
valtuusrajoja, uuteen pitkään kokeeseen tai ehdokkaiden tuotantokytkentään.

Koe rajataan `commitAcceptance`-journalikirjoituksen nykyiseen
`separateContent`-sopimukseen. Journalin viisi mutaatioporttia, hyväksynnän
alkutarkistus, sisältövalidointi, muiden kutsujien sopimus ja nimettyjen
aineistopoistojen tarkistukset säilyvät. Erilliset muuttuneen aineiston,
vanhentuneen valtuuden ja journal-ristiriidan kokeet arvioivat myös odotusten
väliin jäävät rajat. Tarkistusmäärän väheneminen ei yksin hyväksy muutosta;
tuotantokytkentä vaatii kokeen ja katselmuksen jälkeen erillisen päätöksen.

**Hyväksyntäjournalin koetulos: ehdokas hylätty.** Rajattu koe valmistui ja
toisti kaksi turvallisuuseroa nykyiseen polkuun: journalin odotettavan luvun
aikana muuttunut inventaario voi tulla hylätyksi vasta `accepted`-julkaisun
jälkeen, tai journalin edellinen `.backup`-versio voi ehtiä poistua ilman
hylkäystä. Nykyinen yhdistetty tarkistus estää nämä samat koetilanteet ennen
kyseistä muutosta. Pelkkä lopullisen virheen tarkistus ei siis riitä; myös
pysyvät välivaiheet on verrattava. `.backup` tarkoittaa tässä journal-slottia,
ei käyttäjän varmuuskopiota tai alkuperäisten business-tiedostojen poistoa.

Onnistumispolku, viiden portin edellä tehdyt muutokset, omistajan menetys ja
journal-ristiriidat sekä keskeytystilat katettiin. Kahden myöhäisen lukuvälin
negatiivinen näyttö riittää hylkäämään tämän ehdokkaan; kaikkia mahdollisia
odotusvälejä ei väitetä katetuiksi. Synteettinen omistaja ja merkkitiedostot
eivät todista native-varauksen tai sisältövalidoinnin toteutusta. Nykyistä
tuotanto- tai build-koodia ei muutettu. Riippumaton lähde- ja koekatselmus
vahvisti hylkäyspäätöksen; säilytetyn aineiston jälkitarkistus läpäisi.
Mahdollinen uusi tarkistusten
sijoittelu on ensin suunniteltava näiden vastatapausten pohjalta; nykyiset
aineistopoistojen suojat, aikarajat ja K:n loppuportit säilyvät.

##### Hyväksyntäjournalin viimeiset lukuvälit

Omistaja hyväksyi seuraavaksi vain rajatun suunnittelun ja synteettisen
kokeen kahden myöhäisen lukuvälin sulkemiseksi. Koekopio säilyttää nykyiset
viisi sisältöporttia ja arvioi lisätarkistusta ennen julkaisua sekä
journalin edeltäjäversion poistoa. Myös lisätarkistuksen aikana muuttuneet
journal-slotit, sisäisen valtuustarkistuksen viimeinen odotettava luku ja
yhteisten cold-kutsujien käyttäytyminen kuuluvat vertailuun. Pysyvät
välivaiheet ja säilyneet tiedostot ratkaisevat, ei pelkkä lopullinen
virhekoodi. Tämä ei hyväksy tuotantokytkentää, pitkää palautusajoa tai
muutosta nykyisiin aika-, sisältö- tai poistovaatimuksiin.

**Jatkokoe valmistui, ehdokas hylätty.** Lisätarkistukset estivät aiemmin
toistetut muutokset suorien journal-lukujen aikana. Viimeisen
lisätarkistuksen aikana muuttunut `.next` tai edeltäjän `.backup` voi
kuitenkin jäädä valitsematta: `peek` lukee kulloinkin ensisijaisen slotin,
ei kaikkia sivuslotteja. Seurauksena voi olla muuttuneen nextin julkaisu
tai journalin varakappaleen poisto ennen ristiriidan havaitsemista.
Näitä koekorjauksia ei kytketty tuotantoon.

Kunkin vaihtoehdon onnistumispolusta tunnistettiin myös viimeinen odotettava
journal-luku ennen julkaisua ja edeltäjän poistoa. Siihen ajoitettu
inventaarion tai valitun journalin muutos toistui myös nykyisen,
julkaisemattoman K-työpuun vertailupolussa; omistajan menettäminen estettiin.
Tämä on tiedostotransaktion koe testikorvatulla omistajuudella, ei todellisen
native-varauksen ohitustodiste tai asennetun version virhehavainto.
Kaikki alkuperäiset ja tuotavat koetavut säilytettiin tarkoituksellisia
virhemuutoksia lukuun ottamatta. Onnistuvat cold-forward-/rollback-kontrollit
eivät korvaa niiden kaikkia virhe- tai resurssikokeita. Lähde ja build
säilyivät muuttumattomina; tuotantokytkentä ja K:n loppuportit ovat avoinna.
Pelkkää tarkistusten toistamista ei pidetä näiden tulosten perusteella
riittävänä korjaussuunnitelmana.

Riippumaton lähde-, koe- ja tuloskatselmus sekä säilyneen aineiston
jälkitarkistus valmistuivat. Rajattu suunnittelu ja koe suljetaan kielteiseen
päätökseen, ei tuotantokytkentään. Nykyisen polun kanssa yhteiset
pakotetut tiedostomuutokset ohittivat kokeen omistajuussopimuksen; kokeessa
ei osoitettu vastaavaa kilpailevaa, valtuutettua Eky-kirjoittajaa.
[ADR-0009:n uhkarajaus](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md)
ja nykyinen yksinomaisen operaatio-omistajan sopimus eivät lupaa
käyttöjärjestelmätason atomisuutta saman tilin ulkopuolisille kirjoittajille.
Yhteinen havaintoraja ei siis yksin avaa uutta arkkitehtuuri- tai
omistajuusremonttia. Ehdokkaan uudet slot-regressiot hylätään silti nykyisiä
nimenomaisia suojia vasten. Seuraavan nopeutusehdotuksen pitää säilyttää
nämä suojat nykyisen omistajuussopimuksen sisällä; uutta ehdokasta tai
tuotantokytkentää ei hyväksytä tällä koetuloksella.

##### Tiedostoluettelon rajatun lukuerän ehdotus

**Tila: rajattu tuotantokytkentä hyväksytty ja toteutettu työpuuhun;
laajemman todennuksen erillinen hylkäys jää avoimeksi.** Journalin
tarkistuskohtien siirtämisen sijaan muutos koskee vain jo kaapatun, muuttumattoman
tiedostoluettelon merkintöjen uudelleentarkistusta enintään neljän erissä.
Omistaja on nykyinen `assertTerminalCleanupCensus`. Erä voi sisältää
sekä tiedostoja että kansioita; pelkkä vierekkäisten tiedostojen erä ei kata
hierarkkisen PDF-arkiston lukutyötä. Tämä ei ole aiempi PDF-sisältötavujen
erälukuehdotus tai uusi yhteinen ajastin.

Rajattu riippumaton lähdekatselmus ei löytänyt kaapatun lapsimerkinnän
tarkistuksesta riippuvuutta vanhemman tarkistustulokseen. Sen metatietoluku
voisi kuitenkin alkaa ennen vanhemman hylkäystä. Koe ei siis saisi luvata
identtistä virhehetken lukujärjestystä tai käyttöjärjestelmätason atomisuutta.
Alkuperäinen puun keräys, polkujen ja linkkien tarkistukset sekä nykyinen
yksinomaisen operaatio-omistajan uhkarajaus säilyvät.

Hyväksytyn kokeen ja tuotantokytkennän rajat:

- Kaikki nykyiset census-provenienssi-, journal-/revisio-, juuri- ja
  ankkuritarkistukset säilyvät samoissa kohdissa. Journalin yhdistettyjä
  suojia, sisältöportteja tai nimetyn tiedostopoiston ketjua ei muuteta.
- Kukin merkintä suorittaa nykyiset identiteetti-, tiedostotyyppi-, linkki-
  ja kansiosisältötarkistuksensa samassa sisäisessä järjestyksessä.
  Puuttuvan tai jo poistetun kohteen tarkistukset ja juurten vaihdot pysyvät
  sarjallisina; käynnissä oleva erä päättyy ennen niitä.
- Enintään neljä merkintää saa olla tarkistuksessa kerrallaan. Jokainen
  aloitettu tarkistus odotetaan loppuun ennen erän tulosta; hylätyn erän
  jälkeen ei aloiteta uutta. Useasta virheestä säilytetään census-järjestyksen
  ensimmäisen hylätyn merkinnän alkuperäinen syy, ei nopeimman lupauksen syytä.
  Ulompi aikaraja ja valtuuden menetys eivät oikeuta myöhäistä muutosta;
  lupauksen hylkäystä ei väitetä käyttöjärjestelmän lukupyynnön peruutukseksi.
- Hallittu viivytys ja synkroninen/asynkroninen hylkäys todistavat erärajan,
  kaikkien aloitettujen lukujen päättymisen ja jatkon eston. Muuttunut tiedosto,
  kansio tai linkki, ylimääräinen lapsi, osittain poistettu aineisto sekä
  menetetty omistajuus tarkistetaan myös säilyneiden tavujen ja journalien
  avulla. Nykyiset viimeisen journal-luvun ja poistovaltuuden regressiot
  sekä onnistumispolku säilyvät vertailussa.

**Koetulos:** nykyisen ja eräehdokkaan hierarkkisen synteettisen aineiston
42 vertailu- ja kontrollitapausta valmistuivat hyväksytysti. Mukana ovat
sama onnistuvan luvun jäsenyys ja tarkistusjärjestys merkinnän sisällä,
eräraja ja kaikkien aloitettujen tarkistusten päättyminen, alkuperäisen
virheen säilyminen, muuttunut/linkitetty aineisto, osittainen poisto,
vanhentunut valtuus sekä nykyiset journal-julkaisun ja nimetyn poiston suojat.
Varsinainen ajokomento hylättiin silti loppuvertailussa: kahden odotetun
tiedostovirheen teksteissä oli eri synteettisen operaation tunniste.
Alkuperäinen hylkäys säilytettiin. Erillinen jälkitarkistus sitoi viestit
täsmällisiin säilyneisiin journaleihin ja varmisti tapausraportit,
säilyneet tiedostot sekä lähde- ja koekopiot ilman uutta koeajoa.

Tämä on tiedostojärjestelmä- ja journal-näyttöä korvatulla omistajuudella,
ei native-varauksen, SQLite-sisällön tai koko palautusketjun aikarajan
todennus. Odottavan lukulupauksen päättyminen ei todista käyttöjärjestelmän
lukupyynnön peruuttamista. Riippumaton tuloskatselmus ei löytänyt rajatusta
ehdokkaasta tai jälkitarkistuksesta etenemisen estettä. Kokeessa lähde ja build eivät
muuttuneet; tuotantokytkentä,
uusi pitkä Windows-palautusajo, aikarajan muutos tai K:n muiden porttien
ohittaminen eivät sisälly koetulokseen.

**Hyväksytty rajattu tuotantokytkentä:** kytkettiin vain nykyisen
`assertTerminalCleanupCensus`-tarkistuksen tunnetun luettelon lukusilmukkaan
enintään neljän merkinnän erä. Rajalla on omistavan moduulin nimetty
vakio; uutta yleistä ajuria, rajapintaa tai riippuvuutta ei lisätä. Puuttuvien
ja poistettujen merkintöjen sekä juurten sarjalliset rajat, kaikkien
aloitettujen tarkistusten päättyminen ja alkuperäisen census-järjestyksen
virhe säilyvät. Journalin tarkistuskohdat, sisältövalidointi ja poistojen
suojat eivät muutu. Pysyvät regressiot ovat transaktion vieressä omassa
rajatussa testitiedostossa; vaikutusalueen palautustodennus ja sen
hylkäykset käsitellään erikseen. Tämä päätös ei kata uutta pitkää Windows-ajoa
eikä K:n jäljellä olevien hyväksyntäporttien ohittamista.

**Rajattu toteutusnäyttö:** uusi 11 tapauksen pysyvä regressiosarja läpäisi.
Se todistaa erärajan, ensimmäisen luettelojärjestyksen virheen säilymisen,
aloitettujen tarkistusten päättymisen myös hylkäyksessä, osittaisen erän
odottamisen ennen poissaolotarkistusta sekä journalin lopputarkistuksen.
Riippumaton katselmus ei löytänyt tuotantokoodista estettä. Katselmuksessa
vahvistettiin yhden testin osittaisen erän todistus ennen lopullista ajoa.
Desktopin tyyppitarkistus ja build läpäisivät.

Laajemmassa palautus-, päivityspalautus- ja käynnistysketjun sarjassa
896 tapausta läpäisi ja yksi `desktopRestoreStartup`-testi aikakatkaistiin.
Sen jälkeinen testikansion siivous epäonnistui erikseen. Testi tarkistaa
terveyshylkäyksen jälkeistä rollbackia ennen hyväksyntää. Yksi sääntöjen
mukainen, samaa lähdettä käyttävä eristetty uusinta läpäisi; alkuperäistä
ajoa ei merkitä hyväksytyksi eikä juurisyytä korjatuksi. Tämä havainto ja
aiempi suuren katalogin palautusaikakatkaisu pidetään erillään. K:n
laajempi hyväksyntä jää avoimeksi, eikä rajattu eräluenta ole vielä koko
palautusketjun suorituskyky- tai paketoidun toimituksen todistus.

**Avoimen käynnistystestin rajaus:** lähdekoodin mukaan nimetty testi tekee
palautuksen valmistelun ja lykätyn validoinnin, hylkää toisen terveyskyselyn
ja peruu palautuksen pysäytetyn backendin jälkeen. Hyväksynnän
`commitAcceptance`-kutsua tai sen uutta census-erälukua ei tällä tarkoitetulla
polulla saavuteta. Tämä erottaa muutosalueet, mutta ei todista alkuperäisen
aikakatkaisun käynnissä ollutta vaihetta tai syytä.

Testitiedoston yhteinen `afterEach` poistaa rekisteröidyt juuret ja palauttaa
mokit myös aikakatkaisun jälkeen ilman testirungon päättymistodistetta.
Siksi siivous voi kilpailla kesken olevan testityön kanssa ja hävittää
ensivirheen aineistoa. Säilynyt aineisto on osittainen. Tämä on erillinen
testin elinkaaripuute, ei näyttö sovelluksen palautusvirheen juurisyystä.

**Hyväksytty aineistonsäilytyksen korjaus on kohdetodennettu.** Nimetty testi
käyttää nykyisten `profileRestoreStagingService`- ja `localUpdatePackageCache`-
testien mallin mukaista testikohtaista omistajuutta ja `onTestFinished`-koukkua.
Sen rajattu `desktopRestoreStartupTestSupport`-apuri säilyttää epäonnistuneen,
keskeytetyn tai vielä käynnissä olevan testirungon tiedostot. Myöhäinen jatko
ei siirrä juuria seuraavan testin siivouslistaan. Aloitettu ja valmistunut
vaihe, rungon päättyminen sekä resurssisiivouksen tulos erotetaan juurisyystä
suljetuilla testihavainnoilla; polkuja tai raakavirheitä ei lisätä tulosteeseen.

Broker-asiakkaiden sulku ja mokkien palautus odottavat tämän testirungon
päättymistä. Seuraavan testin valmistelu hylätään ennen yhteisten mokkien
nollausta, jos edeltävä työ tai sen resurssisiivous on vielä epävarma.
Jokainen sulku ja palautus yritetään erillisen virheen jälkeenkin. Myöhäisen
siivousvirheen turvallinen luokka jää havaintoon ilman uutta siivouskutsua;
sitä ei heitetä alkuperäisen virheen päälle. Tämä ei ole käyttöjärjestelmän
prosessipuun tai koko testialustan uusi elinkaarisopimus.

Seitsemän hallitun keskeytyksen, myöhäisen jatkon, aineistonsäilytyksen ja
resurssisiivouksen regressiota sekä desktopin tyyppitarkistus läpäisivät.
Riippumaton katselmus sulki myöhäisen siivousvirheen raportointipuutteen;
rajauksessa ei jäänyt uusia löydöksiä. Yksi nimetty kohdeajo läpäisi alkuperäisen
rollback-tapauksen ja sitä seuraavan sulkuvirhekontrollin, joka käyttää
tavallista testisiivousta. Muut tiedoston tapaukset rajattiin tästä ajosta pois,
eikä niiden todennusta uusittu. Käännöksen lähdeluettelo vahvisti, että apuri
ja testit jäävät tuotantokäännöksen ulkopuolelle.

Sovelluskoodi, nykyinen testiaikaraja ja palautuksen sisältöehdot säilyvät.
Korjatun aineistonsäilytyksen kohdenäyttö ei selitä alkuperäistä aikakatkaisua,
hyväksy aiempaa hylättyä sarjaa tai korvaa K:n puuttuvia loppuportteja.
Pitkää Windows-palautusajoa, uutta alustaa tai CI-kierrosta ei käynnistetty.

**Omistaja hyväksyi seuraavan valmistelun ja yhden koko ketjun kokeen.**
Hyväksytty census-eräluku yhdistetään vain koepääprosessissa aiempiin PDF-luku-
ja tarkistuskohtien koeehdokkaisiin. Nykyiset lähteet, kytkentä ja rajatut
kontrollit varmennetaan ennen yhtä oikean SQLiten ja synteettisen PDF-katalogin
Windows-koetta. Vanhan kokeen aineistoa ei korvata. Kysymys on myös
live-terminalin loppusiivouksen valmistumisesta nykyisissä aikarajoissa,
ei vain cold-vaiheen onnistumisesta. Tämä ei hyväksy journal- tai PDF-ehdokkaita
tuotantoon, hylättyä hyväksyntäjournalin sijoitteluehdokasta tai aikarajamuutosta.

##### PDF-luvun ja cold-journalin tuotantokytkentä

**Yhdistetty koe läpäisi; erillinen tuotantokytkentä hyväksyttiin 12.10.2026.**
Nykyisiin lähteisiin sidottu valmistelu ja rajatut kytkentäkontrollit
todennettiin ennen yhtä nimettyä koetta. Oikean SQLiten ja tuhannen
synteettisen PDF:n ketju läpäisi cold-palautuksen, backendin terveystarkistuksen,
live-terminalin hyväksynnän ja loppusiivouksen nykyisissä aikarajoissa.
Tarkistajien päättyminen, varausten palautuminen, journal-slottien ja
operaation työkansioiden poistuminen sekä kaikkien kohde-PDF:ien tarkat
tavut varmennettiin. Vanhoja epäonnistumisia ei korvattu tällä tuloksella.
Koekytkentä ei vielä ole pysyvän tuotantototeutuksen tai koko K:n hyväksyntä.

Omistajan uusi päätös hyväksyy pysyvän toteutuksen, regressiot ja katselmuksen:

- PDF-lukija käsittelee korkeintaan neljä tiedostoa erässä. Kaikki aloitetut
  luvut ja sulut päättyvät ennen jatkoa; alkuperäinen virhe säilyy myös
  sulkuvirheen yhteydessä. DB-tarkistus, oikeat tiivisteet, koot, polku- ja
  kahvaidentiteetit sekä omistajuus säilyvät.
- Cold-journalin edeltäjäkirjoituksen tekninen valmistelu käyttää tuoretta
  omistajuutta ja täsmällistä slottivalintaa. Sisältö tarkistetaan uudelleen
  ennen nextin julkaisua ja ennen edeltäjän poistoa. Muuttuneet next-tavut,
  vieras backup tai uudelleen ilmestynyt next säilyttävät aineiston.
- Korjaava journal-luku ei poista todetusti puuttuvaa sivuslottia.
  Läsnä olevan sivuslotin poisto vaatii ennallaan säilyvän valtuuden.
- Cold-forwardin kansiovalmistelu käyttää tuoretta rakenne-, valinta- ja
  omistajuustarkistusta. Sisältösiirrot ja aktivoitujen tiedostojen
  oikeusmuutokset pysyvät tuoreen sisältötarkistuksen suojaamina.

`clear`, alkujulkaisu, tavallisten kutsujien yhdistetty tarkistus, rollbackin
siirtovaltuus ja hyväksyntäjournalin nykyiset tarkistuskohdat säilyvät.
Hylättyä hyväksyntäjournalin nopeutusehdotusta ei siirretä tuotantoon.
Pysyvä tuotantokytkentä, rajatut regressiot ja riippumaton katselmus läpäisivät.
PDF-eräluvun 22 testiä kattavat erärajan, aloitetun työn ja sulkujen
päättymisen, ensivirheen luokittelun sekä muuttuneen sisällön ja valtuuden
hylkäykset. Journal-storen 48 testiä, sisältövaltuuden 24 testiä ja koko
siirtotransaktion 249 testiä läpäisivät. Kansiovalmistelun jälkeinen
samankokoinen DB- tai PDF-muutos estää siirron todellisen tiivistetarkistuksen
perusteella; kansion luonnin aikana menetetty valtuus estää oikeusmuutoksen
ja siirron. Testit vertaavat myös säilynyttä aineistoa.

Vaikutusalueen muut cold-/rollback-/käynnistys-/hyväksyntä- ja
virheluokittelutestit, desktopin tyyppitarkistus ja build läpäisivät.
Ensimmäiset testimokkien kytkennän ja testiapurin tyypin hylkäykset säilyvät
erillisinä; niitä ei tulkita sovelluksen palautusvirheiksi tai hyväksytyiksi
ajoiksi. Katselmuksen kaksi regressionäytön puutetta korjattiin ja suljettiin.

Laajemmat palautusportit, puhtaan paketin mittaus ja Linux-todennus ovat
edelleen avoimia. Tämä kohdenäyttö ei muuta aikarajoja, muistirajaa tai
formaattirajaa eikä hyväksy koko K:ta tai mergeä.

### Linux-tarkistuksen ajopolun päätös

Nykyisellä backend-buildillä ajettu erillisen Linux-tarkistusajurin seitsemän
kohdekontrollia läpäisivät. Ne kattavat nykyisen ja hyväksytyn historiallisen
rakenteen, todellisen SQLite-muistirajan hylkäyksen ja tarkistusresurssin
virhepolut. Tämä on Node-ajurin näyttöä, ei Electron-utilityn tai CI:n hyväksyntä.

Nykyiseen [Linux-testinomistajaan](e2e-test-environment.md#tuetut-suoritusympäristöt)
on lisätty vain varmuuskopion tarkistukseen rajattu `profileInspection`-hosti
backend-, Vite- ja Chromium-profiilien rinnalle. Omistaja hyväksyi rajatun
kytkennän ja testit 12.10.2026. Käynnistys-, tulos-, siivous- ja
ajokytkentäsopimusten kohdetestit läpäisivät; varsinainen Linux-Electron- ja
normaalien PR/main-porttien hyväksyntä on edelleen avoin; yllä nimetty
erillinen Linux-Electron-kertakoe läpäisi. Electron-käyttäjäpolut ovat Windows-only.
Linux-käyttäjäpolkuja
ei laajenneta, uutta supervisoria ei rakenneta eikä sandboxia tai prosessipuun
poistumisen vaatimusta ohiteta. Puuttuvat järjestelmätyökalut eivät saa johtaa
automaattiseen asennukseen tai varapolkuun.

Ajokytkentä kuuluu nykyiseen Linux-verifiointiin backend- ja desktop-buildien
jälkeen, nykyisine komento- ja vaihepeittosuojineen. Nimetty komento on
`pnpm --filter @eky/desktop inspection:proof:linux`.
Valmistelu käyttää hyväksyttyä native-käännöstä ja itsenäisten resurssitavujen
toimitusporttia; koe käyttää todellista mainin tarkistusporttia ja utilitya.
Vanha Windows-toimitusadapteri ja T3:n muut käyttäjät eivät muutu tämän perusteella.

Koe vaatii kolme erillistä tulosta: ehjän nykykopion hyväksynnän, muutetun
rakenteen schema-hylkäyksen ja puuttuvan tarkistusajurin hylkäyksen. Kukin käyttää
omaa operaatiota ja alkuperäistä rajattua elinkaarta. Todellinen utilityn
poistumiskoodi, mainille palautunut varaus, lähdetavujen säilyminen ja ulomman
Linux-omistajan koko puun pysähtyminen tarkistetaan erikseen. Puuttuva tai
vanhaan suoritukseen sidottu tulos estää hyväksynnän. Epäonnistuneen tapauksen
aineisto säilyy; rajattu prosessituloste kuuluu nykyiseen salattuun keräykseen.
Testihostin normaali nollapoistuminen vaaditaan tämän rajatun profiilin
työprosessilta erikseen; onnistunut tulostiedosto ei ohita myöhempää
epänormaalia poistumista. Katselmuksessa korjattiin puuttuvan ajurin
fixturen hakemistoraja, tämä poistumistodiste sekä valmistelun turvallisen
ensisyyn säilyminen. Rajatut sopimus-, kytkentä- ja tyyppitarkistukset
läpäisivät. Yllä nimetty oikean Linux-Electron-ajon kohdenäyttö läpäisi,
mutta normaalin PR/main-integraation hyväksyntä on yhä avoin.
Kohdetestien mockit eivät korvaa tätä oikeaa prosessinäyttöä. Kolme tapausta
eivät myöskään yksin kata historiallisia formaatteja, muistirajaa tai hardened
Windows -palautusporttia.

### Candidate-tarkistuksen avausportti

`validatePublished`, `validateHistoricalPublished` ja `validateAndMaterialize`
käyttävät `openAttestedMigrationDatabase`-apua ilman uuden tai tyhjän kannan
hyväksyntää. Olemassa olevan tiedoston polku-, tyyppi- ja linkkirajat sekä
readonly-yhteyden schema/history-attestointi edeltävät `fileMustExist`-
kirjoitusavausta. Uusi yhteys attestoi rakenteen uudelleen; nykyiset pending-,
identiteetti-, eheys-, FK- ja PDF-katalogitarkistukset säilyvät. Vain
historiallinen tarkistus käyttää hyväksyttyä `restoreCompatible`-politiikkaa.
Tämä ei anna yhdellekään näistä operaatioista hot-journalin recovery-valtuutta.

Pelkkää pysyvää readonly-yhteyttä ei valittu: ehjä WAL-kanta voisi jättää
sivutiedostoja ja rikkoa seuraavan julkaisuportin täsmällisen tiedostojoukon.
Yhteinen avausapu säilyttää luotettavan kannan nykyisen natiivin sulkemisen;
sivutiedostoja ei poisteta uudella omalla poistologiikalla. Alkuperäisen
tuontisnapshotin erillinen kertakopiosopimus ei muutu.

Tarkistusvirhe säilyy ensimmäisenä myös readonly-esitarkistuksen tai lopullisen
kahvan sulkemisen epäonnistuessa. Sulkemisvirhe jää erilliseksi lisävirheeksi;
ulompi käyttäjä-/IPC-virhesopimus ja julkaisuraja eivät muutu.

Ennen korjausta kuusi rajattua regressiota toisti puuttuvan kannan luomisen
ja hot-journalin kulumisen ennen hylkäystä. Esitarkistuksen kaksi lisätapausta
toistivat ensivirheen peittymisen ja sulkemisvirheen puuttuvan erottelun. Korjattu candidate-/avaus-
sarja läpäisi 138 testiä (kolme alustakohtaista ohitusta), ja yhteisen avausavun
muiden kutsujien sarja läpäisi 48 testiä. Sarjat ovat osin päällekkäisiä.
Tyypintarkistus ja backend-build läpäisivät.
Erillinen 17 testin laskuhistoriasarja läpäisi myös ei-tyhjän PDF-katalogin
ja WAL-kannan yhdistelmän sekä 038-metadatan kanssa että ilman sitä.
Rajattu riippumaton lähdekatselmus ei löytänyt uutta ohitusta tai regressiota.
Sulkemisvirheet on injektoitu oikean sulkemisen jälkeen; ne todistavat
virheiden järjestyksen, eivät aidosti auki jäävän natiivikahvan siivousta.
Nykyiset prosessin exit- ja epävarman siivouksen säilytysrajat pysyvät voimassa.

Oikean Electron-utilityn kuusi tapausta kattavat kunkin operaation puuttuvan
kannan sekä ehjän WAL-kannan; historiallinen kontrolli käyttää hyväksyttyä
metadataa vailla olevaa 038-kantaa. Puuttuva tiedosto ei synny, terveiden
kantojen tavut ja suljettu tiedostojoukko säilyvät, lapsen exit todetaan ja
mainin varaus palautuu. Tämä on kohdenäyttö kehitysruntimessa, ei hardened-
paketin, Linuxin tai PR/mainin hyväksyntä. Alkuperäiset hylkäykset säilyvät.

### Natiivin muistivirheen luokittelukorjaus

Kokonaiskytkennän katselmuksessa nimetty puute on korjattu rajatusti.
Scheman ja migraatiohistorian lukijat säilyttävät poikkeuksen täsmällisen
`SQLITE_NOMEM`-koodin, ja tarkistusoperaatio muuntaa sen nykyiseksi
`PROFILE_INSPECTION_LIMIT_EXCEEDED`-syyksi. Sama luokitus kattaa tarkistimen
eheys-, FK- ja identiteettiluvun sekä rajatut readonly-/referenssiavausvirheet.
Virheviestistä ei päätellä natiivikoodia; muu schema- tai historiahylkäys
säilyttää oman syynsä. Allokaation hylkäys ei yksin todista, mikä resurssi
loppui tai että juuri asetettu muistikatto tuli vastaan.

Alkuperäinen poikkeus säilyy prosessin sisäisenä syynä, ei julkisena
virhetekstinä. Tarkistuksen ensivirhe edeltää mahdollista sulkemisvirhettä;
pelkkä siivouksen muistivirhe ei korvaa aiempaa schema-hylkäystä. Nykyinen
tiukka statuskanava välittää vain sallitun turvallisen ensisyyn. Uutta
lokitusta, protokollaa, riippuvuutta tai resurssirajaa ei lisätty.

Kahdeksan uutta tapausta toisti luokittelupuutteen ennen korjausta.
Lopullinen backendin kohdesarja läpäisi 152 testiä kahdeksasta tiedostosta
ja desktopin runner-/virhe-/prosessisarja 116 testiä kolmesta tiedostosta,
ilman ohituksia. Näyttö käyttää injektoituja natiivipoikkeuksia todellisessa
tarkistusoperaatiossa ja erillisiä runnerin sopimustestejä. Se ei ole uusi
oikean utility-prosessin muistirajamittaus tai hardened-palautustodistus.
Backendin ja desktopin tyyppitarkistukset sekä backendin build läpäisivät.
Rajattu riippumaton lähdekatselmus ei löytänyt korjauksesta estävää havaintoa;
myös alla kuvattu testijako tarkistettiin erikseen. Katselmukset eivät kata
koko K:n vielä keskeneräistä kytkentää.

Kohdesarjan ensimmäinen ajo hylkäsi lisäksi kaksi aiempaa cold-palautuksen
matriisitestiä aikakatkaisulla ja yhden niitä seuranneen mock-kutsumäärän
tarkistuksen. Yksi muuttumattoman lähteen diagnostinen uusinta toisti vain
molemmat aikakatkaisut. Omistajan erillisellä hyväksynnällä kaksi neljän
sijaintiyhdistelmän silmukkatestiä jaettiin kahdeksaksi itsenäiseksi
testiksi. Jokainen säilyttää samat sisältö- ja omistajuustarkistukset sekä
viiden sekunnin rajan; nykyinen jälkisiivous suoritetaan jokaisen jälkeen.
Koko matriisin sallittu testiaika kasvoi hyväksytysti. Uusi kohdeajo läpäisi,
mutta alkuperäiset hylkäykset säilyvät eikä niiden juurisyytä nimetä
korjatuksi pelkän läpäisyn perusteella. Tämä testijako ei muuta sovellusta.

### Aktiivivalidoinnin kutsujakohtainen omistajuus

Rajattu lähdekatselmus täsmensi seuraavan kytkennän. Tavallinen ja palautuksen
jälkeinen startup, live-päivityksen valmistelu ja handoff sekä ensimmäinen
käynnistys ja erillinen C-konteksti on kytketty alla kuvatusti.
Nykyinen eristetty tarkistusmoottori ja `captureCurrentOwner` riittävät;
yleistä varauksen siirto- tai pakkovapautusrajapintaa ei lisätä.

- Tavallinen ja palautuksen jälkeinen startup saavat nimenomaisen,
  mainin omistaman restore-varauksen. Tarkistin lainaa sen täsmällistä
  omistajuutta; se ei vapauta lainaamaansa varausta. Onnistuminen vapauttaa
  varauksen vasta nykyisten tarkistus- ja siivousehtojen täytyttyä.
- Hylätty palautus voi jatkaa samalla varauksella alkuperäisen aineiston
  rollbackiin vasta tarkistajien ja backendin varmennetun pysähtymisen sekä
  main-varauksen palautumisen jälkeen. Cold-rollback-kutsuja ei hanki samaa
  varausta uudelleen eikä vapauta lainaamaansa omistajuutta. Epävarma stop,
  kadonnut omistaja tai siivousvirhe estää jatkon ja säilyttää aineiston.
- Live-päivityksen valmistelu lainaa koordinaattorin jo omistamaa
  update-varausta. Ennen update-fenceä tehtävässä tarkistuksessa käytetään
  nykyistä tavallista snapshot-suojaa; journalin ja update-fencen nykyistä
  valmistelujärjestystä ei muuteta tämän kytkennän perusteella.
- Handoff lainaa samaa update-varausta ja jo voimassa olevaa update-fenceä.
  Snapshot muodostetaan sen operaatiotunnuksella vasta aiemman saman
  tunnuksen snapshotin todistetun poistamisen jälkeen. Tarkistus välittää
  update-kontekstin erikseen eikä päättele sitä varauksen kiireisyydestä.
  Update-fencen vapauttaminen jää koordinaattorille, ei tarkistimelle.
- Päivityksen ensimmäinen käynnistys on uusi runtime. Sen tarkistus
  säilyttää nykyisen validointi-, salaisuusidentiteetti-, hyväksyntä- ja
  siivousjärjestyksen sekä tilakohtaisen ketjuvertailun. Sitä ei rinnasteta
  elävän vanhan runtimen handoffiin tai hyväksytä vain tavallisella
  startup-testillä. Se tekee tuoreen eristetyn tarkistuksen mainin uudella
  restore-varauksella eikä käytä aiemman startup-tarkistuksen tulosta.
- C:n oma `validateActiveProfileForRollback`-portti välittää odotetun
  alkuperäisketjun ja koko valitun update-journalin tuoreen tarkistusfunktion.
  Kontekstia ei päätellä kiireisestä varauksesta tai globaalista fence-tilasta.
  Sama sidonta koskee journalitonta valmistumiskutsua ja restore-journalin
  terminal-kutsua. Vanhentunut valinta estää hyväksynnän ja journal-kirjoituksen.

Live-päivityksen sisäinen `validateActiveProfileForUpdate`-portti välittää
täsmällisen operaation ja vaiheen sekä kutsun elinikään sidotun omistajuuden
ja siivouskuittauksen. Main tarkistaa lisäksi todellisen update-leasen,
elävän sovellusinstanssin ja sen, ettei sulku ole alkanut. Startupin jo
päättynyttä valtuutta ei lainata live-päivitykseen. Tarkistimen puuttuva
kuittaus, varmentamaton lapsen poistuminen, poistovirhe tai suojan menetys
säilyttää omistajuuden. Myöhäinen vastaus ei kuittaa päättynyttä kutsua.
Siististi päättynyt sisältöhylkäys voi käyttää nykyistä abort-vapautusta
vasta omistetun aineiston poiston ja suojan tarkistuksen jälkeen.
Myös pre-update-palautuspisteen nykyinen tunnistettu cleanup-epävarmuus
estää vapautuksen. Alkuperäinen virhe säilyy sisäisenä syynä; julkinen
operational-tapahtuma käyttää nykyistä turvallista koodia ja tarvittaessa
`unknown`-sivuvaikutustilaa. Uutta protokollaa tai yleistä omistajaa ei lisätty.

Todennukseen kuuluvat oikea lease ja nykyiset kutsujat: onnistuva vapautus,
saman omistajan jatkuminen hylkäyksestä rollbackiin, väärä tai vanhentunut
omistaja, epävarma tarkistaja-/backend-stop, myöhäinen vastaus sekä
päivityksen valmistelu ja handoff ilman kaksoisvarausta tai fence-vaihtoa.
V2bj:n vanha konservatiivinen itse omistetun varauksen polku säilyy, kunnes
korvaavien kutsujien näyttö on olemassa. Journalittoman C-palautuksen
alkuperäisketjun sidonnan kohdenäyttö on kirjattu alle; koko K:n loppuportit
eivät sulkeudu sen perusteella.

**Startupin rajattu kytkentänäyttö:** omistajuuden, tarkistusclientin, cold-recoveryn ja
käynnistysrajojen kuuden tiedoston 234 testiä läpäisivät. Viisi nimettyä mainin
regressiota läpäisivät: sama omistaja kahdessa rollback-polussa, epävarma
tarkistajan poistuminen sekä alkuperäisen syyn säilyminen stop-/rollback-virheessä.
Lineage hylätään nyt jo validoinnissa; myöhempi virhe käyttää nykyistä
`PROFILE_RESTORE_RECOVERY_REQUIRED`-koodia ja säilyttää alkuperäisen syyn.
Koko main-sarjan ensimmäinen ajo ei läpäissyt: kahden virhekoodiodotuksen
lisäksi aiempi C:n ennen migraatioita tapahtuvan hylkäyksen rollback-testi
ylitti rajansa myös yhdessä muuttumattoman lähteen erillisajossa. Ensimmäisen
ajon siivoushylkäys säilyy erillisenä; aikarajaa ei muutettu eikä koko sarjaa
merkitä hyväksytyksi kohdetestien perusteella.

Eristetyn utilityn ja native-varauksen kahdeksan tapausta läpäisivät nyky-/038-
aineistolla sekä väärällä ketjulla ja muutetulla schemalla. Sekä itse omistettu
että lainattu varaus tarkistettiin; kaikki lapset poistuivat ja alkuperäiset
tavut säilyivät. Snapshot-muodostaja oli tässä rajattu testiadapteri: tämä ei
ole koko mainin, todellisen backup-muodostajan tai hardened-paketin hyväksyntä.
Desktopin tyyppitarkistus, build ja rajattu riippumaton lähdekatselmus
läpäisivät. Päivityksen vanhaa validaattoria ei poistettu tämän startup-näytön nojalla.

**Live-päivityksen rajattu kytkentänäyttö:** yhdeksän tiedoston 265 kohdetestiä
läpäisivät ilman ohituksia. Mainin erillisessä kohdeajossa 14 nimettyä testiä
läpäisivät; muut 121 eivät kuuluneet rajaukseen. Mukana ovat todellinen
update-lease, valmistelu ja handoff, epävarman tarkistussiivouksen omistajuus
sekä päällekkäisten ordinary/update-sulkujen nykyiset turvallisuusehdot.
Kun ordinary-sulku on jo alkanut, handoff hylätään ennen tarkistusta eikä
installer käynnisty. Vastakkaisen järjestyksen olemassa oleva odotus säilyy.
Ensimmäinen main-ajo paljasti väärän startup-valtuuden käytön live-kutsussa;
se korjattiin elävän instanssin ja sulkutilan tarkistuksella. Seuraavan ajon
kaksi vanhaa vaiheodotusta korjattiin todentamaan aikaisempi suljettu hylkäys,
ei pidentämällä aikarajaa tai poistamalla sulkuassertioita.

Eristetyn utilityn ja native-varauksen neljä live-päivitystapausta läpäisivät:
nykyinen ja muutettu schema sekä valmistelussa että handoffissa. Jokaisen
lapsen poistuminen, alkuperäisten tavujen säilyminen, siivouskuittaus ja
lainatun update-omistajan säilyminen todistettiin. Handoff ei vapauttanut
kirjoitussuojaa. Snapshot-muodostaja oli edelleen rajattu testiadapteri;
tämä ei ole oikean asentajan, koko main-ketjun tai hardened-paketin hyväksyntä.
Desktopin tyyppitarkistus ja build läpäisivät. Rajatun riippumattoman
katselmuksen löytämä pre-update-siivouksen vapautusaukko korjattiin ja
katettiin regressiolla; korjauksen uusintakatselmuksessa ei ollut avoimia
löydöksiä. Tässä live-päivitysvaiheessa ensimmäinen käynnistys ja C käyttivät
vielä vanhaa validaattoria; niiden myöhempi kytkentä on kuvattu alla.
Alkuperäistä C-aikakatkaisua ei merkitä korjatuksi.

#### Ensimmäisen käynnistyksen ja C-kutsun kytkentä

FirstStart ja C käyttävät nyt mainin omistamaa eristettyä tarkistusta.
Ensimmäisen käynnistyksen hyväksyntä ei lainaa tavallisen startupin vanhaa
tulosta: se hankkii oman täsmällisen restore-varauksensa, tekee uuden
tarkistuksen ja jatkaa vasta sen jälkeen nykyisessä hyväksyntäjärjestyksessä.
Tarkistusvirheen alkuperäinen sisäinen syy säilyy `FirstStartUpdateError`-
syyketjussa ja nykyisessä yksityisessä havaitsijassa. Havaitsijan virhe ei
peitä ensivirhettä; julkista virhe- tai lokisopimusta ei laajenneta.

C:n erillinen portti välittää valitun journalin alkuperäisketjun sekä
täsmällisen valinnan tarkistuksen yhteiselle tarkistusapurille. Odotuksen
aikana muuttunut journal hylätään, myös silloin kun operaation tunnus,
tila ja revisio näyttävät samoilta mutta muu sidottu sisältö muuttuu.
Sisältöhylkäyksen jälkeen main pitää samaa restore-omistajaa varmennetun
tarkistaja-/backend-sulun ja alkuperäisaineiston rollbackin yli.
Epävarma sulku säilyttää palautusaineiston ja estää jatkon; UI tai
binaaripalautus ei avaudu sillä perusteella.

Koordinaattorien ja tarkistusapurien viiden tiedoston 129 testiä sekä koko
main-palautustiedoston 139 testiä läpäisivät ilman ohituksia. Uudet main-
tapaukset kattavat tuoreen FirstStart-tarkistuksen onnistumisen ja hylkäyksen,
C:n saman omistajan jatkuvuuden sekä epävarman tarkistaja-/backend-sulun.
Ensimmäisten kohdeajojen fixture-virheet säilyvät erillisinä hylkäyksinä;
session-hylkäyksen stub ja sulkutodiste korjattiin nykyisen sopimuksen
mukaisiksi. Rajatun katselmuksen löytämä liian heikko journal-kilpailutestin
väite vahvistettiin todentamaan oikean virhehaaran saavuttaminen ja koko
korvaavan journalin säilyminen. Uusintakatselmuksessa ei ollut avoimia löydöksiä.

Journaliton C-käynnistys läpäisi kuusi oikean prosessiketjun tapausta:
nykyinen ja metadataa vailla oleva 038-kanta kussakin kolmessa business-
palautustilassa. Kaikkien 30 utility-prosessin poistuminen ja varausten
palautuminen todistettiin. Koe käyttää todellista main-/W6-/backend-ketjua,
mutta tarkistusresurssien kehitystoimitusadapteria ja hallittua binaarikoordinaattoria.
Se ei ole varsinaisen asentajan, hardened-paketin tai Linuxin hyväksyntä.
Desktopin tyyppitarkistus ja build läpäisivät. Aikarajoja, riippuvuuksia tai eheysvaatimuksia ei muutettu;
aiemman C-aikakatkaisun juurisyytä ei päätellä myöhemmästä läpäisystä.

**Restore-journalillisen C:n native-kohdenäyttö:** nykyinen ja metadataa
vailla oleva 038-kanta läpäisivät oikean main-/W6-/backend-ketjun.
Ennen hallittua binaarikoordinaattorin kutsua koe vaatii kolme eristettyä
sisältötarkistusta, `businessRollbackCompleted`-tilan, restore-journalin
poistumisen, alkuperäisen DB:n ja rekisterin tavujen säilymisen sekä kaikkien
lasten exitit. Nykykannan PDF-katalogi on ei-tyhjä; 038-kontrollin PDF-joukko
on tyhjä. Molempien tapausten kahdeksan utility-prosessia poistuivat ja
mainin varaus palautui. Uutta käyttöliittymää tai migraatiota ei avattu.
Katselmuksen kaksi liian väljää ajoitus-/määräväitettä tiukennettiin ennen
lopullista kohdeajoa. Binaarikoordinaattori on yhä kontrolloitu, ei oikea MSI.

**FirstStartin native-kohdenäyttö:** nykyisen scheman synteettinen direct-Setup-
tilanne läpäisi sekä ehjän toisen tarkistuksen että nimenomaan toiseen
snapshotiin injektoidun schema-hylkäyksen. Aiempi startup-tarkistus ei riitä
version hyväksynnäksi. Ehjä toinen tarkistus edeltää uutta accepted-build-
tietoa; hylkäys säilyttää vanhan tiedon ja alkuperäisen DB:n, rekisterin sekä
ei-tyhjän PDF-katalogin. Turvallinen ensisyy säilyy todellisen utility-rajan
yli, lasten exitit havaitaan ja mainin varaus palautuu.
Onnistumiskontrolli pysähtyy hallitusti vasta hyväksynnän jälkeen ennen UI:ta;
se ei todista business-UI:n normaalia käyttöä. Tässä kontrollissa ei ole
odottavia migraatioita eikä pre-migration-palautuspistettä; W6:n haara on
`notRequired`. Katselmuksen jälkeen testiväitteet vaativat koko hyväksyntä-
metadatan ja kummankin snapshotin omaan operaatioon sekä sukupolveen sidotun
inspector-tuloksen ja exitin. Lopullinen kohdeajo ja rajattu uusintakatselmus
läpäisivät. Molemmat kokeet
käyttävät nykyistä kehitystoimitusadapteria, eivät hardened-pakettia.
K:n paketointi-, Linux-, resurssi-, palautus- ja PR/main-loppuportit säilyvät.

### Journalin valinta- ja sisältötarkistuksen rajattu koe

Tämä osio säilyttää alkuperäisen viiden sisältöportin kokeen ja toteutuksen
historian. Voimassa oleva myöhempi rajaus on
[PDF-luvun ja cold-journalin tuotantokytkentä](#pdf-luvun-ja-cold-journalin-tuotantokytkentä).

**Omistajan hyväksymä suunnittelu, koe ja myöhempi rajattu toteutus 12.10.2026.**
Tavoite on erottaa kevyt omistajuuden ja täsmällisen journal-valinnan tarkistus
tuoreesta sisältötodisteesta nykyisen kirjoitusketjun sisällä. Alkuperäinen
koelupa ei hyväksynyt tuotantokytkentää; omistaja hyväksyi sen erikseen kokeen
jälkeen vain alla nimetyille kutsujille. Ei yleistä välimuistia, uutta valvojaa
tai aikarajamuutosta.

Ensimmäinen koe on rajattu `ProfileRestoreActivationJournalStore.write`-
metodin olemassa olevan edeltäjän siirtymään. Sisäiset omistajuus- ja
valintatarkistukset säilyvät. Erillinen sisältöportti vaaditaan ennen
next-slotin luontia, next-tavujen kirjoitusta, current -> backup -siirtoa,
next -> current -julkaisua ja edeltäjän poistamista. Odotettujen slottien ja
valtuuden tarkistus toistetaan odotetun sisältötyön jälkeen. Julkaistun nextin
tavut ja poistettavan backupin täsmällinen edeltäjä luetaan tarvittaessa
uudelleen; vanha sisältökuitti ei oikeuta muuttuneen journalin julkaisua.

Uuden journalin luonti ilman edeltäjää, palautuksen business-tiedostosiirrot,
terminal-siivous sekä `read`- ja `clear`-metodit säilyvät tässä kokeessa
ennallaan. `read` voi korjata ja poistaa journal-slotin, joten sitä ei saa
käsitellä yleisesti kevyenä lukuna. Sen nykyistä mutaatiosuojaa ei poisteta.

**Rajattu näyttö:** 17 synteettistä tapausta läpäisi. Koe käytti nykyistä
transaktiota oikeisiin forward-/rollback-tiedostosiirtoihin sekä journal-
Storen erillistä koekopiota. Todellisista synteettisistä tavuista lasketut
tiivisteet toimivat sisältökontrollina; SQLite-, native-varaus- tai main-
runtimeketjua ei tällä korvata tai väitetä todennetuksi. Tapaukset kattavat
muuttuneen samankokoisen sisällön, vanhentuneen valtuuden, vaihdetun journalin,
muuttuneen next-/backup-slotin, puuttuvan sisältöportin, onnistuvan siirto-
ja palautusketjun sekä business-siirtoa edeltävän DB-/PDF-hylkäyksen.
Julkaisun jälkeinen virhe säilyttää epävarman palautusaineiston ja ensisyyn.

Hyväksytty tuotantosovitus rajataan nykyisten cold-forward- ja rollback-
kirjoittajien nimenomaiseen valtuusvarianttiin, jossa molemmat portit ovat
pakolliset. Muiden kutsujien nykyinen yhdistetty tarkistus säilytetään;
pelkkään kevyeen callbackiin ei saa pudota oletuksena. Koekopion rajapinta
ei sellaisenaan ole kaikkien nykyisten kirjoittajien hyväksytty sopimus.

Katselmuksen kaksi slot-havaintoa toistettiin sekä lähtötoteutuksessa että
koekopiossa: muuttunut avattu next saattoi ylikirjoittua, ja uudelleen
ilmestynyt next jäi huomaamatta ennen backupin poistoa. Ne eivät syntyneet
erottelusta. Korjattu koekopio läpäisi 20 valittua tapausta; lähtötoteutuksen
kaksi tunnettua hylkäystä rajattiin tästä korjatun ehdokkaan ajosta pois eikä
niitä merkitty läpäisseiksi. Alkuperäinen hylkäysnäyttö säilyy.

Työpuun toteutus käyttää nimenomaista `separateContent`-valtuutta vain
sisältöä tarkistavissa cold-forward-/rollback-kirjoituksissa. Muut kutsujat
säilyttävät yhdistetyn tarkistuksen. Avatun nextin kahva/polku/tyhjyys sekä
nextin poissaolo ennen backupin poistoa tarkistetaan myös yhdistetyissä
edeltäjäkirjoituksissa. Tuotannon kohdetestit todentavat nämä rajat erikseen.
Rajattu riippumaton lähdekatselmus ei löytänyt estettä nykyisen yksinomaisen
operaatio-omistajan mallissa; tämä ei lupaa atomisuutta saman käyttäjätilin
haitallisille kirjoittajille eikä korvaa runtime-todennusta.

Tuotantokytkennän journal-/transaktioregressiot läpäisivät 309 testiä kolmesta
tiedostosta ilman ohituksia; mukana ovat slot-virheet sekä tavallisen ja
cold-kutsujan erilliset valtuusvariantit. Desktopin tyyppitarkistus ja käännös
läpäisivät. Nimetty palautussarja läpäisi 227 testiä neljästä tiedostosta
ilman aikarajamuutoksia. Tavallisen aktivoinnin, käynnistyspalautuksen ja
cold-valmistelun erillinen kutsujasarja läpäisi 123 testiä neljästä tiedostosta.
Kummassakaan sarjassa ei ollut ohituksia. Aiemmat hylkäykset säilyvät omalle
lähteelleen; muuttuneen lähteen läpäisy ei selitä kaikkia vanhoja aikakatkaisuja.
Nykyisen ja historiallisen 038-testikannan kuusi C-käynnistystapausta läpäisivät
myös varsinaisen main-/W6-kytkennän kokeessa. Tarkistusprosessien poistuminen,
varausten palautuminen ja alkuperäisketjun säilyminen varmennettiin. Kokeen
binaaripalautuksen koordinaattori oli hallittu korvike: näyttö ei kata oikeaa
asenninkutsua, erillistä cold-rollback-kuluttajaa tai hardened-pakettia.
Kohdenäyttö ei sulje alkuperäisiä aikakatkaisuja, suuren katalogin resurssirajoja
tai K:n packaged-/Linux-/PR-/main-portteja. Tavallisen live-palautuksen
todellinen runtime-näyttö säilyy erillisenä vaatimuksena.

**Native-toimituksen hyväksyntä:** [rajattu toimitussopimus](#k-p2n-tarkistusajurin-toimitusehdotus)
hyväksyttiin 10.10.2026. [V2s](#v2s-tarkistusajurin-erillinen-toimitus)
erottaa toteutetun kohdenäytön keskeneräisistä toimitus- ja palautusporteista.
Business-ajurin vaihtamista tai resurssirajojen kasvattamista ei hyväksytty.

**Nykyinen K3-käyttäjäpolkutodennus:** [V2ah](#v2ah-electron-testiruntimen-tarkistusajuritoimitus)
omistaa eristetyn tarkistusajurin kytkennän jälkeisen näytön ja ensihylkäykset.
Sen korjatun sulkujärjestyksen kolme käyttäjäpolkua läpäisivät yhden
nimetyn Windows-Electron-ajon ilman uusintaa.
[V2r:n pysyvien regressioiden](#v2r-pysyvät-workspace-schema-hylkäystestit)
aiempi tuonti-/korvausläpäisy säilyy oman toteutusvaiheensa historiassa;
se ei hyväksy myöhemmin muuttunutta tarkistusketjua. PR/CI- ja packaged-portit
ovat edelleen avoinna.
[V2q](#v2q-korvauksen-todellinen-mainipc-lukuketju)
todentaa same-lineage-korvauksen schema-hylkäyksen, native-vahvistuksen ja
varmuuskopion jälkeen lisättyjen tietojen säilymisen. [V2p](#v2p-tuonnin-todellinen-mainipc-lukuketju)
todentaa vastaavan import-as-new-polun. Molemmat käyttävät oikeaa Electron-mainia,
native-salasanaikkunaa ja hallittua uudelleenkäynnistystä. Sama turvallinen
ensisyy säilyy yksityiskohtaisessa lokissa, Diagnostics/API-projektiossa ja
tarkistetussa gzip-tukipaketissa; incident-indeksi pysyy minimoituna.
[V2o](#v2o-palautustapahtumien-lukijoiden-sopimustarkistus)
tarkistaa backup-/restore-projektion tapahtumakohtaisesti myös API-clientissä
ja tukipaketissa. Nykyisten kuluttajien erilliset tiedostoketjut läpäisivät
muuttuneilla lukijoilla. [V2n:n ensisyy](#v2n-palautuskuluttajien-turvallinen-ensisyy),
rollbackin lisävirhe ja selvitystä vaativa lopputila säilyvät erillisinä.
[V2m:n portable-ketju](#v2m-portable-backupin-turvallinen-lukuketju) ja
[V2l:n sisäinen syysidonta](#v2l-backup--ja-palautuskuluttajien-sisäinen-ensisyy)
säilyvät pohjana. K3:n muiden kuluttajien todelliset runtime-polut, K2 sekä yllä
olevat päätös- ja hyväksyntäportit ovat avoinna.

**C:n hyväksyntää edeltävän kokonaisajon historia:** desktopin
testikomento läpäisi 9.10.2026 revisiolla `b6416bcc` yhteensä 2 595 Vitest-testiä ja 270 Node-sopimustestiä.
Kolme ennestään alustakohtaista testiä ohitettiin, eikä niitä lasketa
läpäisyiksi. Näyttö kattaa myös R04:n kirjoitussuojan ja R18-varauksen alemmat testikytkennät,
mutta tämä testikomento ei yksin todista todellisia
packaged-/installer-/PR-/main-portteja. Saman puhtaan revision hardened-
palautus ja kolme packaged-palautustapausta läpäisivät erikseen. Muiden kohdeajojen määriä ei summata
tähän yhteistarkistukseen, koska kattavuus on päällekkäinen. Myöhemmän
muutoksen kohdenäyttö ei päivitä tätä kokonaisajon hyväksyntää.

Hyväksyntä on sidottu yllä olevaan revisioon, ei automaattisesti myöhempään
työpuuhun. Dokumenttimuutoksen toteutuneet tarkistukset ja mahdollisen
integraation lopputulos kirjataan sen omaan hyväksyntächeckpointiin;
pelkän tuloksen ilmoittamiseksi ei tehdä uutta tilakirjauscommittia.
Jokainen uusi toteutuspala alkaa omalla preflightilla. Sivulla ei ylläpidetä Goal-työkalun
ajonaikaista tilaa.

### K-paketin valmistelu ja hyväksyntärajat

**Valmistelun checkpoint 9.10.2026:** lähtö on yllä hyväksytty PR #299:n
main. Alkuperäisen keskeytetyn Security-skannauksen S030-01/S030-02-
havaintojen näyttö ja korjausehdotukset on luettu uudelleen. Scan ei ole
valmis koko repositorion tarkastus. Nykyisestä lähteestä tarkistettu
kutsuketju tukee alla olevia puutteita; K:n runtime-toistoa tai korjausta
ei vielä ole todennettu. Riippumaton rajattu lähdekatselmus vahvisti myös
candidate-migraation, julkaistun kohteen ja palautuskäynnistyksen
kattavuustarpeen. Alla oleva 9.10.2026 toteutussuunnitelma täsmentää nämä
rajat. Sen riippumaton rajattu suunnitelmakatselmus ei löytänyt estettä.
Omistaja hyväksyi K-P1/K-P2/K-P3-päätökset 9.10.2026; toteutuksen näyttö
on vielä avoin.
**V2a:n työpuu 9.10.2026:** yhteinen luotetuista migraatiotavuista muodostuva
schema-referenssi, rajattu teknisen scheman ja historiarivien luku sekä
täsmällinen objektivertailu on toteutettu. Snapshot-tarkistin käyttää niitä
ennen sisältökyselyitä. Alkuperäinen rajattu toisto hyväksyi ylimääräiset
table/view/trigger-objektit; korjauksen jälkeen ne hylätään. Rajattu sarja
kattaa myös muutetut guardit, constraintit/defaultit/indeksit, identity-view'n,
teknisen historiataulun korvaamisen näkymällä ja liian suuret arvot.
Aiemman julkaisun tekniseen DDL:ään sekä hyväksyttyyn 038-ketjuun sidotut
fixturet läpäisevät metadataa sisältävänä ja ilman metadataa; 038 -> 039
säilyttää profiili-identiteetin. Yhdistetty migraatio-/snapshot-regressio
läpäisi 226 testiä; kaksi ennestään alustakohtaista ohitusta eivät ole
läpäisyjä. Tämän jälkeen backendin koko testikomento läpäisi 2 904 testiä
259 tiedostossa; viisi ennestään alustakohtaista ohitusta eivät ole
läpäisyjä. Kohdesarjoja ei summata tähän päälle. Backendin tyyppitarkistus
ja tuotantobuild läpäisivät; uudet testit ja fixture eivät sisälly
tuotantobuildiin. Riippumaton rajattu koodikatselmus ei löytänyt konkreettista
ohitusreittiä tai regressiota tässä palassa. Tämä on työpuun kohdenäyttö,
ei paketoidun sovelluksen, PR:n tai mainin hyväksyntä. V2b/V2c/V3 sekä
K1/K2:n kokonaisuuden sulkeminen ovat avoinna. V2c:n pre-write-kytkentä ja
sitä todistavat vakoilutestit eivät sisälly tähän hyväksyttyyn kohdenäyttöön.

**V2b:n ensimmäinen checkpoint 9.10.2026:** stagingin tarkistus ja
activation-materialisointi on erotettu palveluun, jolle ei anneta aktiivista
tietokantayhteyttä. Nykyinen broker-adapteri säilyttää entisen lopputuloksen;
se poistetaan vasta utility-/broker-v10-siirron todennuksen jälkeen. Schema,
eheys, identity ja artifact-katalogi tarkistetaan samalla readonly-yhteydellä,
joka suljetaan myös hylkäyksessä. Kohde- ja backend-regressiot läpäisivät
(koko backend 2 915 testiä, viisi ennestään alustakohtaista ohitusta), samoin
tyyppitarkistus ja tuotantobuild. Riippumaton rajattu koodikatselmus ei
löytänyt tässä valmistelupalassa konkreettista ohitusreittiä tai regressiota.
Tämä ei vielä eristä kuormaa aktiivisesta backendistä.

**V2c:n käynnistys-/migraatiokytkentä 9.10.2026:**
`inspectMigrationStartupState` käyttää yhteistä schema-tarkistinta.
`runMigrations` tarkistaa rakenteen ennen ensimmäistä valmistelu-/migraatio-
kirjoitusta ja uudelleen ennen onnistunutta paluuta. Sen aiempi täsmällisen
legacy-prefixin baseline on erillinen sisäinen politiikka, ei palautuksen
038-poikkeuksen laajennus. Ensitoisto hyväksyi view-only-kannan tyhjänä,
ylimääräisen triggerin ja näkymäksi korvatun historiataulun; regressiot
hylkäävät ne nyt ennen kirjoituksia. Migraation kesken syntyvän virheen
testit käyttävät statement-vakoilua ylimääräisen scheman sijaan ja todistavat
business-SQL:n ehtineen suoritukseen ennen rollbackia. Loppuattestoinnin
virhe säilyttää jo valmistuneiden migraatioiden määrän.
Kohdesarja läpäisi 296 testiä, ja koko backendin testikomento 2 924 testiä
260 tiedostossa. Molempien viisi ennestään alustakohtaista ohitusta eivät
ole läpäisyjä; kohdemäärää ei summata kokonaisajoon. Tyyppitarkistus ja
tuotantobuild läpäisivät; vikainjektion fixture ei kuulu tuotantobuildiin.
Riippumaton rajattu lähdekatselmus ei löytänyt konkreettista ohitusreittiä tai
regressiota tässä palassa. Readonly-esitarkistus ennen kirjoitettavaa avausta,
kopiointi-/käyttösidonta, julkaistun kohteen tarkistusjärjestys ja K3:n
syyraportointi ovat avoinna. Erityisesti julkaistun kohteen nykyinen
identity-before-invalidHistory-järjestys on sovitettava schema-before-content-
vaatimukseen niin, ettei epäluotettu identity-luku tai väärän profiilin
palautus tule mahdolliseksi. Tässä checkpointissa sitä ei ole muutettu.
Paketoitu sovellus sekä PR-/main-portit eivät ole vielä hyväksyttyjä.

**V2c:n readonly-avausjatko 9.10.2026, hyväksymätön ehdokas:** backendin `createApp` käyttää
yhteistä `openAttestedMigrationDatabase`-porttia ennen palvelurekisteröintiä.
Se tarkistaa olemassa olevan kannan readonly-yhteydellä, sulkee sen ja
attestoi myös kirjoittavan yhteyden ennen luovutusta. Puuttuvan kannan
luonti on erillinen lupa; kadonnutta jo tarkistettua tiedostoa ei luoda
uudelleen. Sisäinen runner-baseline ja portillisen restore-käynnistyksen
038-raja säilyvät erillään. Ensitoisto osoitti avausten väärän järjestyksen;
korjauksen 203 kohdetestiä läpäisivät, samoin tyyppitarkistus.
Koko backendin testikomento läpäisi 2 941 testiä 262 tiedostossa; viisi
ennestään alustakohtaista ohitusta eivät ole läpäisyjä. Myöhemmin lisätty
oikean sovelluskoosteen legacy-baseline-regressio läpäisi erillisessä
seitsemän testin sarjassa; sitä ei lasketa aiemman kokonaisajon luvuksi.
Tuotantobuild läpäisi, eikä apurin testi sisälly buildiin. Riippumaton
katselmus löysi kaatumispalautusregression: hot rollback journal vaatii
SQLiten oman palautuksen ennen schema-lukua, mutta readonly-yhteys estää
sen `SQLITE_READONLY_ROLLBACK`-virheellä. Pieni erillinen synteettinen
keskeytyskoe vahvisti löydön. Uusi portti hylkäsi käynnistyksen tiedostoja
muuttamatta, kun aiempi kirjoittava avaus palautti commitoidut rivit ja
hylkäsi keskeneräisen transaktion oikein. Koe on regressiota vahvistava
näyttö, ei korjauksen läpäisy. Aiempi vihreä testisarja ei sulje löydöstä.
Ehdokasta ei hyväksytä eikä julkaista ennen ratkaisua.

**Kaatumispalautus hyväksytty 10.10.2026; toteutus ja kohdenäyttö [V2u:ssa](#v2u-omistetun-paikallisen-työtilan-kaatumispalautus).**
Rajattu poikkeus sallii vain todistetusti omistetun paikallisen työtilan SQLiten
natiivin kaatumispalautuksen ennen tiukkaa schema-porttia. Tuotu backup
ei saa poikkeusta; business-kyselyt ja migraatiot jäävät portin taakse.
Omistajuustodiste, sivuvaikutukset ja oikean keskeytyksen regressio
vaaditaan. Tämä tarkentaa aiempaa ennen kirjoittavaa avausta -sääntöä;
poikkeus perustuu erilliseen päätökseen, ei pelkkään K:n toteutuslupaan.
Candidate-kopiointi-/käyttösidonta, K2, K3 ja
paketoidun sovelluksen hyväksyntä eivät valmistu tästä kohdeajosta.

#### V2e: erillisen tarkistuskopion koe

**Checkpoint 9.10.2026, ei hyväksytty tuotantokytkentä.** Candidate-kopioinnin
ehdokas tarkistaa lähteen ennen kohteen luontia, sitoo lähteen ja kopion
todelliseen SHA-256:een sekä kokoon ja lukee kohteen tavut takaisin.
Eksklusiivisen luonnin törmäys ei poista olemassa olevaa tiedostoa;
epävarma sulkeminen säilyttää osittaisen kopion. Schema ja artifact-katalogi
tarkistetaan samalla readonly-yhteydellä ennen kirjoittavaa avausta.
Rajattu regressiosarja läpäisi 314 testiä; viisi ennestään alustakohtaista
ohitusta eivät ole läpäisyjä. Tyyppitarkistus ja tuotantobuild läpäisivät.
Myöhempi WAL-kontrolli kuitenkin hylättiin: suljetun, ehjän WAL-tilasta
tehdyn snapshotin readonly-avaus loi sivutiedostot, jotka ehdokas tulkitsi
ristiriidaksi. Sama sarja läpäisi 29 muuta testiä ja ohitti yhden entisen
alustakohtaisen tapauksen. Ehdokas ei ole hyväksytty; aiempi vihreä näyttö
ei sulje tätä regressiota.

Omistaja hyväksyi rajatun jatkosuunnittelun ja synteettisen kokeen, jossa
SQLite avaa vain uuden kertakäyttöisen kopion operaation omassa kansiossa.
Alkuperäistä snapshotia tai tuntemattomia sivutiedostoja ei poisteta.
Testi `workspaceSnapshotIsolationExperiment.test.ts` todensi seitsemän
tapausta: onnistuneen tarkistuksen ja sulkemisen sekä säilytyksen, kun
sulkemistodiste puuttuu, kansion identiteetti vaihtuu, kansiossa on vieras
tiedosto tai rollback-journal, WAL ei ole tyhjä tai SHM on hardlinkitetty.
Koekansion poistaminen edellytti todettua sulkemista, samaa omistettua
kansiota ja täsmällisesti sallittua sisältöä. Alkuperäisen snapshotin koko
ja tiiviste säilyivät. Tämä on testin oman kansion näyttö, ei utilityn
prosessipoistumisen, C-varauksen tai ylemmän siivouksen hyväksyntä.
Koelogiikkaa ei ole kytketty tuotantopolkuun.

**Rajattu jatkosuunnitelma ennen kytkentää:**

1. Käytä nykyisen candidate-operaation validoidun `candidateRoot`-juuren
   omaa uutta tarkistusalikansiota, ei lähdesnapshotin kansiota eikä
   julkaisukelpoista runtime/data-kansiota. Sido kopio todellisiin lähde-
   ja kopiotavuihin nykyisillä rajatuilla luku-, tyyppi-, polku- ja
   linkkitarkistuksilla. Epäselvä lähde tai ennestään oleva sivutiedosto
   ei saa muuttua hiljaiseksi onnistumiseksi.
2. Kokoa readonly-schema-, identity-, eheys- ja katalogitarkistus samaan
   omistettuun koekopioon. Vältä alkuperäisen tai lopullisen ehdokkaan
   toista readonly-avausta, joka palauttaisi saman WAL-sivutiedostoriskin.
   Varmenna kohteen todelliset tavut ennen kirjoittavaa avausta ja säilytä
   nykyinen saman kirjoittavan yhteyden pre-/post-migration-attestointi.
3. Todista SQLite-yhteyden ja tiedostokahvojen sulkeminen, operaation
   omistajuus sekä virhepolulla myös nykyisen prosessiomistajan vaatima
   poistuminen. Poista vain todistetusti tämän operaation luoma koekansio.
   Epäselvä sisältö, sulkeminen tai omistajuus säilyttää aineiston ja estää
   jatkamisen. Sulkemis-/siivousvirhe ei peitä ensivirhettä.
4. Säilytys myös caller-tasolla import-, replacement- ja
   activation-migration-poluissa on kohdetodennettu
   [V2f-checkpointissa](#v2f-kutsujien-aineiston-säilytys). Korvauksen
   `discardBeforeActivation` tarkistaa nyt lähdestagingin ja ehdokasjuuren
   ennen ensimmäistä poistoa. Epävarmaa koekansiota ei lisätä yleiseen
   rekursiiviseen poistolupaan. Koekopion omistajan prosessipoistuminen
   ja sen todellinen utility-kytkentä ovat edelleen todistettavia;
   caller-testit eivät korvaa C:n prosessivarausta.
5. Ennen kytkennän hyväksyntää tarvitaan WAL- ja tavallisen snapshotin
   todelliset kuluttajaregressiot, ennestään olevien ja kesken ilmestyvien
   sivutiedostojen säilytys, sisältömuutokset, keskeytys, sulkemisvirhe ja
   vanhan 038-backupin migraatio. Tämän jälkeen vaaditaan edelleen K:n
   packaged-/PR-/main-portit. Tämä koe ei anna native-käännös-,
   kaatumispalautus- tai publisher-päätöstä eikä aloita uutta kehystä.

#### V2f: kutsujien aineiston säilytys

**Rajattu työpuukorjaus 9.10.2026:** lähdeaineiston säilytys ei saanut
riippua vasta myöhemmin tarkistettavasta ehdokaskansiosta. Kolme
regressiota osoitti, että korvauksen `discardBeforeActivation` poisti
lähdestagingin ennen kuin se hylkäsi ylimääräisen tarkistuskansion,
WAL-tiedoston tai hardlinkitetyn ehdokaskannan. Nyt molemmat puut
tarkistetaan ennen ensimmäistä poistoa. Poistokohteet, allowlist,
linkki-/polkutarkistukset ja turvallinen virhekoodi/vaihe säilyvät.
Lähteen hardlink-hylkäys säilyttää myös ehdokkaan. Uutena tuonnin
juurisiivous validoi ennestään koko osittaisen operaatiopuun ennen poistoa;
sen toteutusta ei muutettu.

Oikeiden koordinaattorien ja tiedostoadapterien synteettiset testit
todistavat lähteen, ehdokkaan ja epäselvän koekansion säilymisen.
Korvaus ei aktivoi eikä käynnistä vanhaa runtimea siivouksen hylkäyksen
jälkeen; tämä kattaa myös relaunch-handoffin. Activation migration
säilyttää palautuspisteen stagingin, vaatii recoveryn eikä valitse lähdettä
tai relaunchaa. Uutena tuonti säilyttää journalin ja rekisterin eikä julkaise
ehdokasta. Sen nykyinen, erillinen aiemman runtimen palautussääntö säilyy:
todennettu runtime-poissaolo sallii tunnetun aiemman työtilan käynnistyksen,
mutta puuttuva tai epäselvä omistajuustodiste estää sen edelleen.

Viiden kohdetiedoston 66 testiä läpäisivät. Laajempi import-, replacement-
ja update-palautusregressio läpäisi 338 testiä 28 tiedostossa; päällekkäisiä
kohdeajoja ei summata tähän. Desktopin tyyppitarkistus ja tuotantokäännös
läpäisivät. Juurisiivouksen riippumaton rajattu katselmus ei löytänyt
korjattavaa. Tämä ei tee monen kansion poistosta atomista: tarkistuksen
jälkeinen tiedostomuutos tai osittainen poistovirhe eivät saa tämän
checkpointin perusteella yleistä säilytystakuuta.

Koekopio on edelleen testilogiikkaa, ei hyväksytty tuotantokytkentä.
Tämän checkpointin jälkeen utilityn omistajuus-/sulkemis-/exit-ketjun
rajattu synteettinen koe on todennettu [V2g:ssä](#v2g-tarkistuskopio-todellisessa-utility-prosessissa).
Tuotantokuluttajan todellinen kytkentä ja WAL-kuluttajaregressio,
K3:n ensisyy ja siivoustulos sekä packaged-/PR-/main-portit ovat avoinna.
Tämä korjaus ei ratkaise alla olevia kolmea omistajapäätöstä eikä muuta
varmuuskopioformaattia, riippuvuuksia tai C:n prosessiomistajuutta.

#### V2g: tarkistuskopio todellisessa utility-prosessissa

**Rajattu synteettinen koe 9.10.2026, ei tuotantokytkentä.** Nykyinen
`ElectronWorkspaceCandidateRuntimeFactory`, `workspaceCandidateRunner`
ja mainin C-varausomistaja suorittivat viisi tapausta oikealla
`utilityProcess`-lapsella. Vain lapsen koeaineistoon kohdistuva backend-
operaatio korvattiin testilogiikalla. Main loi uuden koekansion todetun
varauksen ja nykyisen import-ylläpitolukon aikana, ennen luovutusta.
Poistoon käytettiin mainin omaa kansioidentiteettiä, ei lapsen antamaa
poistopolkua. SQLite avasi vain kopion; alkuperäisen snapshotin koko,
tiiviste ja sivutiedostottomuus säilyivät kaikissa tapauksissa.

- Normaali readonly-schema-/sisältötarkistus ja natiivi sulkeminen
  läpäisivät. Terminal-viesti ei vielä palauttanut varauksen omistajuutta.
  Main sai sen takaisin vasta todetun lapsen poistumisen jälkeen.
- Todellinen ylimääräisen schema-objektin hylkäys säilytti turvallisen
  ensimmäisen syyn erillisessä koehavainnossa. Omistettu koekopio voitiin
  poistaa vasta yhteyden sulkemisen, lapsen poistumisen ja varauksen
  palautuksen jälkeen; alkuperäinen virheellinen snapshot säilyi.
- Puuttuva sulkemiskuittaus säilytti koekopion, vaikka testin todellinen
  SQLite-yhteys oli suljettu. Tämä on kuittausepävarmuuden simulointi,
  ei toteutunut native-sulkuvirhe.
- Avoimen SQLite-yhteyden kanssa tarkoituksella kesken jätetty operaation
  Promise ei valmistunut pelkästä peruutuksesta. Nykyinen C-factory
  pakkopysäytti vain omistetun lapsen, todensi poistumisen ja palautti
  varauksen. Operaatio hylättiin ja koekopio säilyi. Pelkkä exit-koodi
  nolla ei tehnyt tästä onnistunutta tarkistusta.
- Vieras koekansion tiedosto esti poiston myös onnistuneen sulkemisen,
  poistumisen ja varauksen palautuksen jälkeen. Vieras sisältö sekä
  alkuperäinen snapshot säilyivät.

Kaikki viisi koetapausta läpäisivät korjatulla valmistelulla. Aiemmat
valmisteluhylkäykset säilytettiin: ne eivät olleet natiivin tarkistuksen
läpäisyjä tai tuotantovikoja. Koefixturen käynnistys ja polut sovitettiin
nykyisiin entrypoint-, parser- ja loader-ehtoihin; tuotantofactory,
runner, varaus, riippuvuudet ja niiden aikarajat pysyivät muuttumattomina.
Katselmuksessa löytynyt kokeen havaintokirjoituksen ensisyyn peitto
korjattiin. Kaksi suoraa natiivioperaation virhekoetta todensivat, että
kirjoitusvirhe säilyy erillisenä ja schema-hylkäys pysyy ensisyynä.
Korjauksen jälkeen kaikki viisi utility/C-tapausta läpäisivät uudelleen.
Rajattu riippumaton katselmus suljettiin ilman avoimia deltalöydöksiä.
Kirjoitusvirhekoe ei ole utility/C:n toimitusvirhepolun hyväksyntä;
kokeen ensisyyn säilytys ei vielä todista K3:n varsinaista diagnostiikan
tai käyttäjäpalautteen lukuketjua.

Tämä näyttö täydentää V2e:n kansiorajojen ja V2f:n caller-säilytyksen
testejä. Se ei vielä hyväksy varsinaista kopiointi-/migraatiokuluttajaa,
artifact-katalogin utility-kytkentää, raskaan syötteen muistibudjettia,
historiallista backupia, palautusta tai hardened packaged -ketjua.
Kolme alla olevaa päätöstä ja K:n PR-/main-portit pysyvät avoimina.

#### V2h: WAL-kuluttajaregressio ja kytkentäpäätös

**Checkpoint 9.10.2026, vain regressiot ja suunnittelu.** Varsinaisen
`runWorkspaceCandidateOperation`-migraation kuusi synteettistä tapausta
ajettiin nykyistä ehdokasta vastaan. Kolme hylkäystä vahvisti korjaustarpeen:
ehjä nykyinen ja metadataa vailla oleva hyväksytty 038-WAL-backup eivät
migroidu, ja virheellisen scheman hylkäys jättää lähdekansioon tarkistuksen
luomat WAL-/SHM-tiedostot. Alkuperäisen tietokantatiedoston tavut säilyivät.
Kolme ennestään olevan WAL-, SHM- tai journal-tiedoston säilytystestiä
läpäisi ilman tarkistus- tai kirjoittavaa avausta. Muut 20 testiä rajattiin
pois tästä kohdeajosta; niitä ei merkitä läpäisyiksi. Backendin
tyyppitarkistus läpäisi. Tämä on ehdokkaan regressiota todentava näyttö,
ei korjauksen, tuotantokytkennän tai asennetun sovelluksen hyväksyntä.

Rajattu riippumaton lähdekatselmus ja sen tarkistus osoittivat
kytkentäkohdan nykyisessä `ElectronWorkspaceCandidateRuntimeFactory`ssa:
`migrateBackup` tarvitsee oman tarkistuskopion elinkaaren. Mainin nykyinen
C-varaus koskee asennusjuurta, ei tarkistuskansiota; sitä ei korvata uuden
kansion varauksella. Mainin luoma kansio ja sen paikallinen identiteetti
on valmisteltava nykyisen omistus-/valtuustarkistuksen aikana ennen
varauksen luovutusta. Lapsen ilmoittama polku ei anna poistolupaa.

Nykyinen epäonnistunut terminal-viesti ei todista tarkistusyhteyden
sulkemista tai kuljeta tarkkaa turvallista ensisyytä. Kytkentäsuunnitelmassa
nykyisen tiukan yksityisen viestisopimuksen tuottaja, parseri ja vastaanottaja
on sovitettava yhteen; metadata-ketjun tunniste ei korvaa kopiotavujen
koko-/tiivistesidontaa. Siivous vaatii todetun sulkemisen, lapsen poistumisen,
prepare-/grant-kutsujen valmistumisen ja C-varauksen palautuksen. Virheen
turvallinen siivous ja migraation onnistuminen ovat eri tuloksia;
nykyistä onnistumisen ehtoa ei löysennetä. Caller-allowlistat ja epäselvän
aineiston säilytys pysyvät ennallaan. Ensisyy säilytetään erillään
siivous-/recovery-virheestä nykyisessä K3-ketjussa, ei uudella loggerilla.

**Kytkentäpäätös 9.10.2026:** omistaja hyväksyi rajatun tuotantokytkennän
V2e/V2g/V2h:n omistajuus-, tavusidonta- ja siivousrajoilla. Main valmistaa
operaation oman kansion ennen nykyisen C-varauksen luovutusta; backend
tarkistaa siinä samat kopiotavut ennen migraatiota. Tuettujen aiempien
backupien, mukaan lukien hyväksytty metadataa vailla oleva 038-ankkuri,
yhteensopivuus säilyy hyväksyntäehtona. Formaattia, riippuvuuksia,
aikarajoja tai caller-allowlistoja ei tämän päätöksen perusteella muuteta.
Kytkentä ja sen todennus ovat kesken, eikä ehdokasta ole hyväksytty.
Alla olevat kolme aiempaa päätöstä, K2/K3 sekä packaged-/PR-/main-portit
ovat edelleen avoinna; tämä hyväksyntä ei ratkaise niitä.

#### V2i: tarkistuskopion tuotantokuluttaja

**Työpuun kytkentä 9.10.2026, ei julkaisuhyväksyntä.**
`ElectronWorkspaceCandidateRuntimeFactory` sitoo migraatioon oman
generaatioon sidotun tarkistusjuuren. Nykyisen main-varauksen `prepare`
suorittaa kansion eksklusiivisen valmistelun omistus-/valtuusrajan sisällä,
tarkistaa omistajuuden uudelleen ja vasta sitten luovuttaa nykyisen C-varauksen.
Varaus koskee edelleen asennusjuurta. Uutta prosessiomistajaa ei lisätä.

Backend kopioi ensin suljetun lähteen itsenäiset tavut tarkistuskansioon.
Schema/history, identiteetti, eheys ja artifact-katalogi luetaan samasta
readonly-yhteydestä. Vasta sen sulkemisen jälkeen lähteen uusi kopiointi
voi luoda migraatiokohteen; koko ja SHA-256 vaativat juuri tarkistettujen
tavujen vastaavuuden. Alkuperäistä eikä lopullista migraatiokohdetta avata
tässä välissä readonly-tarkistukseen. Kirjoittavan yhteyden pre-/post-migraation
schema- ja identiteettitarkistukset säilyvät.

Nykyinen yksityinen terminal-kanava välittää vain todetun tarkistusyhteyden
sulkemiskuittauksen ja suljetun turvallisen ensisyyluokan. Main hyväksyy
siivouksen vasta sidotun terminalin, todellisen lapsen poistumisen,
prepare-/grant-kutsujen valmistumisen sekä varauksen palautuksen jälkeen.
Kansion ja sen vanhemman identiteetit tulevat mainin omasta receiptistä,
eivät lapsen ilmoittamasta polusta. Journal, vieras sisältö, hardlink,
korvattu juuri, ei-tyhjä WAL tai epävarma kuittaus säilyttää aineiston.
Kopiointivirhe ei poista edes suljettua osakopiota lapsiprosessissa.
Main tarkistaa sisältöjoukon ja tiedostoidentiteetit uudelleen ennen
nimettyjen tiedostojen poistoa. Siivouksen keskeytyminen estää seuraavat
poistokutsut; jo aloitettu tiedosto-operaatio voi silti valmistua.
Poisto ei käytä rekursiivista vieraan sisällön siivousta; caller-allowlistat
ja operaation onnistumisen ehdot eivät muutu. K3:n koko ylempi palautusketju
on edelleen erikseen todennettava.

Ensimmäiset hylkäykset säilyvät: uuden sisäisen parametrin fixture-kutsut,
vanhan avaustavan varaan jäänyt mutaatiokoe ja parserin tyyppirajaus.
Kokeen havainnointikohta siirrettiin uuteen readonly-kopioon, eikä saman
kokoisten lähdemuutosten torjuntavaatimusta muutettu. Rajattu riippumaton
katselmus havaitsi osakopion ennenaikaisen poiston, aikarajan jälkeen
jatkuvat poistokutsut sekä sulkemisvirheen voivan peittää tuntemattoman
ensisyyn. Nämä korjattiin regressioineen; jälkikatselmuksessa ei jäänyt
näihin korjauksiin avointa löydöstä. AggregateErrorin ensimmäinen syyhaara
luokitellaan itsenäisesti: tuntematon syy pysyy `unknown`-arvona eikä muutu
sulkemisen syyksi.

Lopullisen työpuun backendin 52 koetta ja viiden desktop-sopimustiedoston
116 koetta läpäisivät. Backendin yksi alustakohtainen koe jäi ajamatta.
Työtilojen tuonnin, korvauksen, aktivoinnin ja muiden nykyisten callerien
regressiokokonaisuus läpäisi 1 133 koetta; kaksi alustakohtaista koetta jäi
ajamatta. Nämä määrät ovat osin päällekkäisiä, eikä niitä summata.
Backendin ja desktopin tyypintarkistukset sekä build läpäisivät.
Todellinen main/factory/runner/backend-utilityketju todennettiin uudelleen
viimeisten korjausten jälkeen: nykyinen WAL-backup, metadataa vailla oleva
038-WAL-backup ja virheellisen scheman hylkäys läpäisivät. Alkuperäinen
tiedosto ja lähdekansion sisältö säilyivät; sulkeminen, poistuminen,
C-palautus ja kansion poisto todennettiin. Kertakokeen ensimmäinen
käynnistinkutsu pysähtyi ennen koetta väärään työhakemistoon; tulos säilyi
epäonnistumisena ja korjattu käynnistin pääsi samaan varsinaiseen kokeeseen.
Kohdenäyttö ja staattinen katselmus eivät korvaa K2-, packaged-, PR- tai
main-portteja.

#### V2j: ylemmän virheketjun ensisyyn säilyminen

**Rajattu työpuun toteutuspala, kohdetodennettu 9.10.2026.** K3:n lähdejäljitys osoitti,
että candidate-prosessin jo toimittama turvallinen syy katoaa import- ja
replacement-virheen muunnoksessa. Palautuksen lisävirhe tai ylläpitovarauksen
vapautuksen virhe voi lisäksi korvata alkuperäisen poikkeuksen. Korjaus
käyttää näiden nykyisten virhetyyppien sisäistä `Error.cause`-sidontaa ja
`AggregateError`-haaroja: ensivirhe on ensimmäinen, palautuksen ja vapautuksen
virheet erillisiä myöhempiä haaroja. Nykyinen ulompi koodi/vaihe sekä
palautus-, omistajuus- ja siivousjärjestys säilyvät. Raakaa ketjua ei
serialisoida rendererille, lokiin tai tukipakettiin.

Kohderegressiot vaativat alkuperäisen syyn säilymisen tavallisessa
hylkäyksessä sekä palautuksen ja vapautuksen yhteisvirheessä. Tuntematonta
ensisyytä ei korvata lisävirheen luokituksella. Yleinen management-virhe
säilyttää sisäisen ketjun mutta palauttaa edelleen vain nykyisen turvallisen
käyttäjäkoodin. Uutta virhekehystä, loggeria tai riippuvuutta ei lisätä.

Ensimmäinen regressioajo toisti kaikki 11 uutta syyn säilytyspuutetta.
Ensimmäisen korjauksen jälkeen yksi testi osoitti vielä restart-virheen
muunnoksen katkoksen; se korjattiin muuttamatta palautuksen ehtoja.
Tyypintarkistuksen uusi testiparametri täsmennettiin ilman runtime-muutosta.
Lopulliset 77 kohdetestiä läpäisivät, mukaan lukien oikean capability-handlerin
IPC-vuotosuoja. Työtilojen 1 145 regressiota läpäisivät; kaksi ennestään
alustakohtaista ohitusta eivät ole läpäisyjä. Määrät ovat päällekkäisiä,
eikä niitä summata. Desktopin tyypintarkistus ja tuotantobuild läpäisivät.
Rajattu riippumaton staattinen katselmus ei löytänyt uutta konkreettista
vikaa tai tietovuotoa; se ei korvaa runtime- tai packaged-todennusta.

V2j-checkpointissa `WorkspaceManagementService`-havaitsin oli compositionissa
kytkemättä. Sen myöhempi tuotantokytkentä ja rajattu lokitiedoston lukuketju
kuvataan seuraavassa V2k:ssa, ei tämän aiemman kohdeajon hyväksyntänä.
K3:n muiden kuluttajien näyttö, kolme muuta K-päätöstä, packaged-portti sekä
PR/main-portit säilyvät avoimina.

#### V2k: workspace-varmuuskopion turvallinen lukuketju

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Tuonnin ja
same-lineage-korvauksen hallintapalvelu luokittelee sisäisen ensivirhehaaran
rajatusti ja toimittaa vain tunnetun teknisen syyn tai `unknown`-arvon
nykyiseen observeriin. Ordered aggregate erottaa aikaisimman lisävirheen;
se ei saa korvata tuntematonta ensisyytä tai aikaisempaa tuntematonta
siivoussyytä myöhemmällä tunnetulla syyllä. Rikkoutunut ketju ei luo
olemattomasta siivousvirheestä havaintoa. Nykyinen turvallinen ulompi
käyttäjäkoodi, IPC-sanitointi, palautusjärjestys ja siivousvastuu säilyvät.

Main ja workspace-composition välittävät nykyisen operational-loggerin ja
runtime-identiteetin havaitsijalle. Se kirjoittaa
`workspaceBackup.operationFailed`- ja tarvittaessa erillisen
`workspaceBackup.cleanupFailed`-tapahtuman samalla korrelaatiolla.
Operational-validator, backendin projektori, API-client ja mainin
tukipakettilukija vaativat suljetun syyn, `import|replace`-vaiheen ja
tapahtumakohtaiset kentät. Raakaa poikkeusta, kutsupinoa, polkua tai
tietokantasisältöä ei kirjoiteta. Tapahtumien tekninen vaihe ei todista
sisäistä juurisyytä tai onnistunutta rollbackia. Error-tason incident-
projektio säilyttää nykyisen minimoidun virhekoodiyhteenvedon ilman
correlation-/runtime-/business-tunnisteita. Ei uutta loggeria, manageria,
riippuvuutta, formaattia, retentionia tai odotusmekanismia.

Rajatut desktop-regressiot läpäisivät 148 testiä, Diagnosticsin projektori-
ja tiedostolukijat 69 testiä ja API-client 25 testiä. Lukijoiden positiiviset
regressiot kattavat kaikki 15 sallittua syytä; vapaat syyt, vaiheet,
ristiriitaiset tilat ja muiden tapahtumien kentät hylätään. Ensimmäisen
kokeen löydös korjattiin erottamalla puuttuva cleanup-havainto tuntemattoman
cleanup-syyn havainnosta. Ensivirhettä ei merkitä myöhemmin läpäistyksi.
Riippumaton rajattu staattinen katselmus ei löytänyt uutta konkreettista
vikaa tämän lukuketjun lopullisesta tuotantototeutuksesta.

Erillinen synteettinen koe käytti oikeaa hallintapalvelua, nykyisiä JSONL-
ja incident-kirjoittajia, tiedostolukijoita, strict-clientiä sekä sanitoidun
gzip-tukipaketin virallista eheystarkastajaa. 34 virhetoimintoa tuottivat
38 turvallista tapahtumaa; ensisyy ja neljä lisävirhettä pysyivät erillisinä.
Kaksi onnistuvaa porttikontrollia säilyivät ennallaan. Virheellinen
lähdetapahtuma ohitettiin ja tukipaketin lukukattavuus merkittiin osittaiseksi.

Tämä koe ei ajanut oikeaa tarkistusprosessia, Electron mainia tai
käyttöliittymää eikä korvaa hardened-paketin hyväksyntää. K3:n muut
backup-/restore-kuluttajat ja koko K:n integraationäyttö ovat edelleen
avoinna. Tarkat tapahtumat ja tukitoimet on päivitetty
[katalogiin](r0-observability-event-catalog.md#desktop-operational-ja-security),
[Diagnostics-ohjeeseen](../modules/diagnostics.md),
[tukipakettisopimukseen](support-bundle-plan.md) ja
[palautus-runbookiin](local-restore-recovery-runbook.md#tarkistushylkäys-ja-lisävirhe).

#### V2l: backup- ja palautuskuluttajien sisäinen ensisyy

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Tavallisen
varmuuskopion luonti ja tarkistus, autentikoidun sisällön staging sekä
palautuksen ja päivityspalautuspisteen aktivointikutsujat säilyttävät
alkuperäisen poikkeuksen nykyisen virhetyypin sisäisessä `Error.cause`-
sidonnassa. Aktivoinnin ja rollbackin yhteisvirheessä ordered aggregate
pitää ensivirheen ensin ja rollbackin lisävirheen toisena. Ulompi virhekoodi,
väärän salasanan yhteinen palaute, tilatieto, palautusjärjestys ja
tiedostojen siivousvastuu eivät muutu.

Ensitoisto osoitti syytiedon katoamisen 11 regressiossa; 38 kontrollia
läpäisi. Korjauksen lopullinen kahdeksan tiedoston kohdesarja läpäisi
68 testiä. Se kattaa viisi K:n teknistä tarkistussyytä ja tuntemattoman
poikkeuksen, kaksi sisäistä muunnosta, aktivointia edeltävän hylkäyksen,
rollback-lisävirheen sekä IPC:n ja observerien vuotosuojan. Ulompi IPC-virhe
ei sisällä syyoliota. Tyypintarkistus ja desktopin käännös läpäisivät.
Rajattu riippumaton staattinen katselmus ei löytänyt uutta konkreettista
vikaa tästä sisäisestä syysidonnasta.

Tämä on sisäisen syyn säilytys, ei muiden backup-/restore-tapahtumien
täydellisen Diagnostics-ketjun hyväksyntä. Raakaa syyoliota ei projisoida
lokiin, käyttöliittymään tai tukipakettiin. K2:n eristetty tarkistusportti,
todellinen exit-/varaus-/siivoustodiste, muut K3-kuluttajat sekä hardened-
backup -> inspect -> restore -> restart -> compare ja PR/main-portit
ovat edelleen avoinna. [V2k:n](#v2k-workspace-varmuuskopion-turvallinen-lukuketju)
workspace-lukuketjun näyttö säilyy erillisenä; sitä ei yleistetä näihin
kuluttajiin. Alla olevia päätösportteja ei tämän työn perusteella ohiteta.

#### V2m: portable-backupin turvallinen lukuketju

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Mainin
`profileBackupCapability` kirjaa `backup.failed`- ja
`backup.inspectionFailed`-tapahtumaan K-P3:n viidestä hyväksytystä teknisestä
syystä vain ensivirheen haarasta löytyvän tarkan koodin. Tuntematon,
syklinen, liian syvä tai poikkeuksen heittävä syyketju säilyttää nykyisen
yleiskoodin. Ordered aggregaten siivoushaaraa tai raakaa viestiä ei nosteta
ensisyyksi. IPC:hen palautetaan edelleen uusi yleinen virhe ilman sisäistä
`cause`-oliota; käyttäjän ilmoitus, tilat, ylläpitovaraus ja siivous eivät muutu.

Nykyinen rajattu ensisyyhaku on yksi runtime-apu, jota työtilatoiminnot ja
portable-backupin kaksi kuluttajaa käyttävät omilla suljetuilla syyjoukoillaan.
K:n viisi koodia on keskitetty desktopin omistajaan; työtilaprotokollan
hyväksytty syyjoukko ja versio eivät muutu. Uutta loggeria, tapahtumaformaattia,
kirjoittajaa tai prosessienhallintaa ei lisätä.

Ensitoisto hylkäsi kymmenen puuttuvan teknisen syyn regressiota; 30 kontrollia
läpäisi. Korjauksen seitsemän tiedoston kohdesarja läpäisi 123 testiä ja
erillinen neljän olemassa olevan työtilakuluttajan sarja 64 testiä.
Tyypintarkistus ja desktopin käännös läpäisivät. Riippumaton rajattu
staattinen katselmus ei löytänyt konkreettista uutta vikaa tästä muutoksesta.

Synteettinen koe käytti oikeaa capability-toteutusta injektoiduilla
backup-porteilla sekä nykyistä operational- ja incident-kirjoittajaa,
tiedostolukijoita, API-parseria, tukipaketin validointia, gzip-muodostusta
ja virallista tarkastinta. 14 hylättyä operaatiota, kaksi onnistumista ja
kaksi peruutusta tuottivat 24 turvallista eventtiä. Tukipakettiin päätyi
14 warn/error-eventtiä ja incident-yhteenvetoon seitsemän error-tapahtumaa.
Info- ja warn-poissulut incidentistä säilyvät tarkoituksellisina.
Polku, salasana, raakaviesti, pino tai sisäinen syyolio ei päätynyt ketjuun.

Kokeen ensimmäinen loppuväite oletti yleiselle backup-tukipakettilukijalle
tapahtumakohtaisen vaiheallowlistan. Nykyinen lukija tarkistaa vaiheelle
tunnistemuodon, kun taas backendin projektori tarkistaa backup-vaiheen
`portable`-arvoon. Korjattu koeväite todentaa nykyisen sopimuksen eikä
muuta tuotantovalidointia tai väitä tätä eroa korjatuksi. Yleisten
backup-lukijoiden tapahtumakohtainen uudelleenvalidointi kuuluu jäljellä
olevaan K3-sopimuskatselmukseen.

Koe ei suorita todellista Electron-mainia, renderer-IPC:tä, eristettyä
tarkistusprosessia tai paketoitua palautusta. Restore-/recovery-kuluttajien
erillinen kohdenäyttö on [V2n:ssä](#v2n-palautuskuluttajien-turvallinen-ensisyy);
sitä ei päätellä tästä kokeesta. Native-toimituksen päätös, K2:n omistajuus
ja koko V3:n packaged-/PR-/main-portit pysyvät avoimina. Tämä ei sulje K:ta.

#### V2n: palautuskuluttajien turvallinen ensisyy

**Rajattu työpuun toteutuspala, kohdetodennettu 10.10.2026.** Palautuksen tarkistus, staging,
aktivointi ja käynnistysvalidointi sekä palautuspisteen luonti ja
automaattinen tarkistus käyttävät V2m:n bounded ensisyyhakua vain
operational-tapahtuman K-P3-koodin valintaan. Nykyinen ulompi virhe,
saatavuustilan tulkinta, rollback, journal, varaus ja siivous säilyvät.
`restore.recoveryRequired` ja rollbackin lisävirhe pysyvät erillisinä;
siivoushaaraa ei nosteta ensisyyksi.

Ensitoisto hylkäsi 41 syytiedon katoamisen regressiota; 61 kontrollia läpäisi.
Lopullinen seitsemän tiedoston kohdesarja läpäisi 120 testiä. Se sisältää
myös tunnetun tarkistusvirheen ja todellisen rollback-lisävirheen yhteistestin:
ensivirheen koodi ja järjestetty sisäinen ketju säilyvät, mutta
`restore.rollbackFailed` ja `restore.recoveryRequired` käyttävät edelleen
omaa selvityskoodiaan. Tyypintarkistus ja desktopin käännös läpäisivät.
Rajattu riippumaton staattinen katselmus ei löytänyt konkreettista uutta
tuotantovikaa tästä viiden kuluttajatiedoston muutoksesta.

Synteettinen koe suoritti nykyiset palvelut injektoiduilla porteilla sekä
oikean operational- ja incident-kirjoituksen, tiedostolukijat, API-parserin,
tukipaketin validoinnin, gzip-muodostuksen ja virallisen tarkastimen.
Viiden suljetun syyn kahdeksan käyttötapaa tuottivat 40 epäonnistunutta
operaatiota ja 75 turvallista eventtiä. Tukipaketin 55 warn/error-eventtiä
ja incident-indeksin 25 error-tapahtumaa säilyivät tarkoitettujen
poissulkujen mukaisina. Raakaa viestiä, pinoa tai sisäistä syyoliota ei
kirjoitettu. Backend hylkäsi lisäksi väärän vaihe-arvon lukuaineistosta.

Kokeen ensimmäinen tukipakettiväite hylättiin, koska synteettisestä
aineistosta puuttui pakollinen runtime-yhteenveto. Korjattiin vain
koeaineisto; lukijan vaatimuksia ei muutettu. Ensimmäinen hylkäys säilyy
erillisenä, eikä sitä nimetä sovelluksen palautusviaksi.

Koe ei suorita todellista Electron-mainia, renderer-IPC:tä, native-
tarkistusta tai palautuksen prosessiomistajuutta. Native-toimitus,
paketoitu palautus ja PR/main-portit ovat avoinna. Yleisten API-/
tukipakettilukijoiden tapahtumakohtainen uudelleenvalidointi ei sisälly
V2n:n näyttöön, vaan sen erillinen todennus on
[V2o:ssa](#v2o-palautustapahtumien-lukijoiden-sopimustarkistus).
Backendin vaiheallowlistan hylkäys ei yksin todista tätä muissa lukijoissa.
Tämä kohdetulos ei sulje K:ta.

##### Hyväksynnän loppuvaiheen syytieto

**Omistajan hyväksymä rajattu korjaus on toteutettu ja kohdetodennettu
12.10.2026; koko K ei ole valmis.** Alkuperäinen palvelu- ja lukuketjukoe
osoitti hyväksynnän ensisyyn katoamisen operational-tapahtumista, vaikka
se säilyi sisäisessä virheketjussa. Havainto koski sisältövalidoinnin
jälkeistä työtä, eikä tehnyt onnistunutta validointia virheelliseksi.

Nykyinen `ProfileRestoreStartupRecovery.finishAcceptance` kirjaa yhden
`restore.acceptanceFailed`-tapahtuman ennen virheen välittämistä. Sama raja
kattaa välittömän ja lykätyn hyväksynnän, aiemmin hyväksytyn journalin
siivouksen sekä valtuuden vapautusvirheen. Korrelaatio otetaan valitusta
journalista ennen mahdollista onnistunutta poistoa. Vaiheet ovat
`acceptancePreparation`, `acceptanceCommit` ja `acceptedCleanup`.
Vaihe kertoo viimeisen aloitetun työn, ei juurisyytä tai varmaa lopputilaa.
Pakolliset nykyiset failure-kentät ja kuusi sallittua syykoodia on lukittu
[tapahtumakatalogiin](r0-observability-event-catalog.md#desktop-operational-ja-security).
Tuntematon ensisyy säilyttää yleiskoodin; siivouksen lisävirhe ei korvaa sitä.

Epävarman hyväksynnän composition-käärintä säilyttää alkuperäisen sisäisen
syyn. `restore.validationCompleted` pysyy totena ja `restore.recoveryRequired`
erillisenä selvitystilana. Hallittu rollback/relaunch voi edelleen palauttaa
ilman `desktop.bootstrapFailed`-tapahtumaa; uusi virhetapahtuma syntyy ennen
tätä haaraa. Ohjaus, rollback, journal-portit, tiedostot, aikarajat ja
poistumiskäyttäytyminen eivät muutu.

Desktopin writer, Diagnostics-projektori, API-client ja tukipaketin lukija
validoivat saman rajatun tapahtuma- ja vaihesopimuksen. Desktop käyttää
yhteistä nykyistä katalogiaan; muut vastuurajat säilyttävät omat
wire-sopimustarkistuksensa. Error-tason minimoitu incident-yhteenveto ei
sisällä vaihetta, kestoa tai korrelaatiota. Activity ja business audit ovat
edelleen poissuljettuja. Ei uutta loggeria, lokikanavaa, kuittausodotusta,
payload-kenttää, riippuvuutta tai raakavirheen julkaisua.

Kohderegressiot läpäisivät: kolme vaihetta, K-P3:n viisi ensisyytä,
tuntematon syy, ensivirhe/lisävirhe-erottelu, observerin virhe, jatkettu
accepted-siivoaminen, valtuuden vapautusvirhe ja onnistumiskontrollit.
Todellisen composition-funktion testit kattavat hallitun relaunchin,
epävarman hyväksynnän ja loppusiivouksen hylkäyksen molemmilla
profiilityypeillä; koko nykyinen käynnistys-/palautustestitiedosto läpäisi.
Erillinen tiedostokoe todensi tapahtuman oikeasta JSONL-kirjoittimesta
Diagnostics/API-lukijoihin, incident-indeksiin ja gzip-tukipaketin
viralliseen tarkistimeen. Virheellisen vaiheen torjunta, salaisuuksien
poissulku ja onnistuneen polun säilyminen todennettiin. Rajattu riippumaton
lähdekatselmus ei löytänyt hyväksynnän estävää puutetta; tyypintarkistukset
ja muuttuneiden pakettien käännökset läpäisivät.

Composition-testien hallitut prosessi- ja UI-rajat sekä palvelukokeen
injektoidut portit eivät todista native-omistajuutta tai hardened-palautusta.
Tämä korjaus ei hyväksy uutta pitkää palautusajoa, tarkistusten kevennystä,
paketointirajaa tai K:n PR/main-integraatiota. Suuren katalogin loppuportti
ja muut K:n avoimet päätökset säilyvät erillisinä.

#### V2o: palautustapahtumien lukijoiden sopimustarkistus

**Rajattu K3-lukuketju kohdetodennettu 10.10.2026; K ei ole valmis.**
API-clientin ja tukipaketin tunnistemuotoinen vaihevalidointi on tarkennettu tapahtumakohtaiseksi
nykyisen operational-katalogin mukaan. Desktopin omistavat tapahtumaspecit,
pakolliset payload-kentät ja vaihejoukko käytetään uudelleen samassa
desktop-moduulissa. HTTP-clientin oma vastevalidointi pysyy riippumattomana
backendin ja desktopin sisäisistä tyypeistä. Ei uutta pakettia, loggeria,
protokollaversiota, metadataa tai tapahtumaa.

Sallitun vanhan projektion valinnaiset app/build/runtime-kentät sekä
duration-, retryable- ja side-effect-tiedon tarkoituksellinen puuttuminen
säilyvät. Aktivointivirheen ja `recoveryRequired`-tapahtuman jo pakolliset
kentät eivät muutu valinnaisiksi. Väärä perhe, vaihe, kind tai epäyhtenäinen
palautumistila ja toisen perheen metadata torjutaan. Turvallinen
virhetapahtuman sormenjälki säilyy sallittuna nykyisen katalogin mukaan.
Backendin lähdeprojektio hylkää näiden tapahtumien väärät payload-kentät
sekä puuttuvan tai nykyisen HTTP-rajan ylittävän virhekoodin.

Ensitoiston 29 regressiota vahvistivat väärän vaiheen hyväksymisen.
Lopullinen kohdesarja läpäisi 236 testiä 22 tiedostossa:
API-client 54, desktopin observability/tukipaketti 75 ja backendin
Diagnostics 107. Aiemmat suppeammat ajot ovat päällekkäistä näyttöä,
eivät lisätestejä. Muuttuneiden osien tyypintarkistus ja käännös läpäisivät.
Rajattu riippumaton katselmus ei löytänyt uutta tuotantovikaa; sen
nostamat valinnaisen app/build/runtime-kontekstin ja puuttuvan
`recoveryPoint.failed`-kindin kontrollit lisättiin pysyviin regressioihin.

Oikea tapahtumakirjoittaja, operational-/incident-tiedostot, backendin
projektori ja lukijat, API-client, tukipaketin gzip sekä virallinen tarkastin
läpäisivät 20 tapahtumanimen ja kaikkien 29 vaihesopimuksen kokeen.
58 kelvollista tapahtumaa ja 174 hylkäysvarianttia todennettiin; tukipaketin
38 warn/error-tapahtumaa noudattivat nykyisiä poissulkuja. Virheelliset
rivit eivät syrjäyttäneet kelvollisia; tukipaketin lähteen osittaisuus näkyi.
V2k/V2m/V2n:n erilliset nykyisten kuluttajien synteettiset tiedostoketjut
läpäisivät muuttuneilla lukijoilla. Tämä ei ole todellisen Electron-mainin
tai palautusprosessin hyväksyntä. Native-päätökset, prosessiomistajuus,
todellinen main/IPC, packaged ja PR/main pysyvät erillisinä portteina.

#### V2p: tuonnin todellinen main/IPC-lukuketju

**Import-as-new-polun schema-hylkäys kohdetodennettu 10.10.2026; K ei ole valmis.**
Koe käyttää olemassa olevaa eristettyä Electron-testipohjaa ja tuotannon
compositionia. Synteettinen kelvollinen varmuuskopio läpäisee tarkistuksen;
sen omassa kertakopiossa lisätty hyväksymätön schema-objekti hylätään.
Muokatun, uudelleen salatun säiliön todennus ja checksumit läpäisevät,
joten schema-hylkäystä ei korvata container-virheellä.

Oikea yritysvalitsin, native-tiedostovalinta ja mainin salasanaikkuna
käynnistävät tuonnin. Candidate-utilityn `PROFILE_SCHEMA_UNSUPPORTED`
säilyy mainin operational-tiedostossa sekä backendin HTTP-projektiossa,
API-clientin strict parserissa ja gzip-tukipaketissa. Virallinen tukipaketin
tarkastin ja osioiden checksumit läpäisevät. Yksityiskohtainen tapahtuma
ja incident-indeksi luetaan erillisinä projektioina: yksi tapahtuma
kummassakin, sama turvallinen syy, mutta incidentissä ei korrelaatio-,
runtime- tai business-tunnisteita. Ensisyy ja sivuvaikutusten `unknown`
säilyvät; vaihe tai onnistunut uudelleenkäynnistys eivät väitä kaikkia
sivuvaikutuksia olemattomiksi.

Hylkäys käynnistää nykyisen hallitun paluun edelliseen yritykseen.
Vanha ikkuna sulkeutuu, runtime/session vaihtuu ja aiempi yritys sekä
backend avautuvat terveinä. Alkuperäinen lähdetietokanta, valittu säiliö,
yritysrekisterin tavut ja asiakaslista säilyvät. Kokeen tietosuojatarkistus
kattaa molempien runtime-sukupolvien native-havainnot, rendererin,
Diagnosticsin ja tukipaketin. Synteettisiä salaisuuksia tai lähdepolkuja
ei havaittu näissä ulostuloissa. Tavallinen onnistuva tuonti ja nykyinen
workspace-koostetodistus läpäisivät erillisinä kontrolleina.

Koostetodistuksen testikuluttaja päivitettiin K:n nykyiseen porttiin:
pakollinen operational-konteksti sekä todellinen `assertMainOwned` ja
`prepareMainOwned` välitetään nykyiselle varausomistajalle. Testin
liiketoiminta-, eristys-, poistumis- ja palautusvaatimuksia ei muutettu.
Porttiregression ensitoisto vahvisti puuttuvan kytkennän; korjatun portin
ja nykyisten varaussopimusten 19 kohdetestiä sekä E2E-käännös läpäisivät.
Koostetestin no-op-loggeri ei ole diagnostiikan hyväksyntänäyttö;
yllä oleva erillinen main-koe käyttää oikeaa tiedostolokitusta.

Kokeen aiemmat fixture-/lukija-/kyselyvirheet säilyvät epäonnistumisina,
eivätkä ole sovelluksen palautusvikoja tai onnistuneita testejä. Rajattu
riippumaton katselmus korjautti kahden runtime-sukupolven havaintojen
tietosuojatarkistuksen. Tämä ei ole koko K:n loppukatselmus.

Vanhan snapshot-brokerin erillinen tarkistuspolku voi yhä pelkistää
schema-syyn yleiseksi virheeksi. Sitä ei yhdistetä tämän tuontikokeen
polkuun eikä korjata rinnakkaisella fallbackilla: hyväksytty K2:n
utility-/broker-v10-siirto omistaa sen poistamisen ja korvaavan ketjun
todennuksen. K3:n muiden kuluttajien todelliset runtime-polut, native-
tuotantopäätös, hot-journal-palautus, inventaarion järjestys, hardened-
paketti sekä PR/main ovat erillisiä avoimia portteja.

#### V2q: korvauksen todellinen main/IPC-lukuketju

**Yhden same-lineage-korvauksen schema-hylkäys kohdetodennettu 10.10.2026;
K ei ole valmis.** Rajattu erilliskoe käyttää nykyistä eristettyä
Electron-testipohjaa, tuotannon compositionia ja aktiivisen synteettisen
yrityksen todellista salattua varmuuskopiota. Kelvollinen alkuperäinen
läpäisee tarkistuksen. Hyväksymätön schema-objekti lisätään vain purettuun
omistettuun kopioon; uudelleen salatun säiliön autentikointi, checksumit ja
sama lineage todistetaan erikseen. Hylkäys ei siis johdu väärästä yrityksestä,
salasanasta tai muuttuneesta container-checksumista.

Oikea yritysvalitsin, mainin tiedostovalinta, salasanaikkuna ja viimeinen
native-vahvistus käynnistävät korvauksen. Schema-portti hylkää candidate-
käsittelyn ennen aktiivisen sisällön vaihtamista. Vanha runtime on tässä
vaiheessa jo suljettu, joten nykyinen koordinaattori pyytää yhden hallitun
uudelleenkäynnistyksen. Vanha ikkuna sulkeutuu, runtime/session vaihtuu ja
sama aktiivinen yritys käynnistyy terveenä.

`PROFILE_SCHEMA_UNSUPPORTED` säilyy yksityiskohtaisessa desktop-lokissa,
backendin HTTP-projektiossa, strict-API-clientissä ja gzip-tukipaketissa
vaiheella `replace`. Incident-indeksiin tulee erillinen minimoitu projektio
samasta syystä ilman korrelaatio-, runtime- tai business-tunnisteita.
Virallinen tukipaketin tarkastin ja kaikki osioiden checksumit läpäisevät.
Ensisyyn `sideEffectState: unknown` säilyy; onnistunut toipuminen ei muuta
tapahtuman lupausta jälkikäteen sivuvaikutuksettomaksi. Erillistä
`workspaceBackup.cleanupFailed`-tapahtumaa ei tässä tapauksessa synny.

Varmuuskopion jälkeen lisätty asiakas, ennestään oleva asiakas, laskun
API-sisältö, PDF-tavut, rekisterin tavut ja aktiivisen yrityksen identiteetti
säilyvät. Myös valittu muokattu container ja kokeen oma SQLite-syöte pysyvät
muuttumattomina. Tämä ei väitä aktiivisen SQLite-tiedoston raakatavujen
säilyvän samoina normaalin WAL-sulkemisen ja uudelleenkäynnistyksen yli.
Molempien runtime-sukupolvien native-havainnot, renderer, lokiprojektiot,
Diagnostics ja tukipaketti tarkistetaan nimettyjen salaisuuksien ja
kiellettyjen business-arvojen varalta.

Rajattu riippumaton katselmus korjautti kokeen tietosuojatarkistuksen:
JSONin puretut merkkijonoarvot ja avaimet tarkistetaan, jotta Windows-polun
merkkikoodaus ei peitä mahdollista vuotoa. Tarkistuksen regressio ja sama
korvauskoe läpäisivät korjatulla testillä; aiempi näyttö säilytetään erillään.
Kyse oli tarkistuspuutteesta, ei havaitusta tietovuodosta. Rajattu katselmus
ei korvaa koko K:n loppukatselmusta.

Nimetty hylkäyskoe läpäisi ensimmäisellä ajolla. Tavallinen saman yrityksen
korvaus ja väärän yrityksen esto läpäisivät erillisinä muuttumattomina
kontrolleina. Tämä on rajattu erillistodistus, ei uusi pysyvä
CI-skenaario tai koko K:n hyväksyntä. Sovelluskoodia, riippuvuuksia,
aikarajoja, prosessiomistajuutta tai normaaleja testiehtoja ei tämän kokeen
perusteella muutettu. K2, muiden kuluttajien todellinen näyttö, native-
tuotantopäätös, hot-journal-palautus, inventaarion järjestys sekä hardened-
paketti ja PR/main pysyvät erillisinä avoimina portteina.

#### V2r: pysyvät workspace-schema-hylkäystestit

**Kaksi pysyvää Electron-regressiota kohdetodennettu 10.10.2026;
K ja PR/main-portit ovat avoinna.**
[Nykyinen testitiedosto](../../apps/e2e/tests/electron/workspaceBackupSchemaRejection.spec.ts)
käyttää samaa eristettyä Electron-fixtureä sekä tavallista ajovalintaa:
`DESK-WORKSPACE-IMPORT-SCHEMA-001` ja
`DESK-WORKSPACE-REPLACE-SCHEMA-001` kuuluvat kriittisiin recovery-/security-
testeihin. Uutta testiruntimea, riippuvuutta tai aikarajaa ei lisätty.

Valmistelu muuttaa vain omistettua purettua kopiota ja muodostaa oikean
autentikoidun säiliön uudelleen. Vertailu vaatii muuttuneen tietokannan
todellisen koon ja tiivisteen; muut manifestikentät ja tiedosto-osat
säilyvät täsmällisinä. Ensimmäinen ajo pysähtyi uuden testiapurin
virheelliseen alkuperäisen tietokantatiivisteen odotukseen, ei sovelluksen
hylkäyspolkuun. Tämä odotus korjattiin; alkuperäistä epäonnistumista ei
merkitty läpäisyksi.

Lopullinen paikallinen kohdeajo läpäisi molemmat korjatut testit.
Ne todentavat tiedostovalinnan, native-salasanaikkunan, korvauksen
erillisen vahvistuksen, main/IPC-käsittelyn ja hallitun uudelleenkäynnistyksen.
Schema-syy säilyy yksityiskohtaisessa lokissa, minimoidussa incident-indeksissä,
strict-Diagnostics-lukijassa sekä virallisen tarkastimen ja checksumien
varmentamassa tukipaketissa. Nimetyt salaisuudet ja kielletyt business-arvot
tarkistetaan puretuista merkkijonoista ja avaimista, ei JSONin
merkkikoodauksesta.

Asiakaslista, varmuuskopion jälkeen lisätty asiakas, laskun API-sisältö,
PDF-tavut, aktiivisen yrityksen identiteetti, rekisteri ja omistetut
syötetiedostot säilyvät. Aktiivisen SQLite-tiedoston raakatavujen
identtisyyttä normaalin WAL-sulkemisen yli ei väitetä. V2p/V2q:n aiemmat
erilliskokeet säilyvät omana näyttönään; pysyvien testien todellinen
PR/CI-ajotodistus ja paketoitu palautus ovat erillisiä avoimia portteja.
Rajattu riippumaton katselmus täydensi loppulukijoiden vertailuja:
myös alkuperäinen `unknown`-sivuvaikutusluokitus ja `retryable: false`
vaaditaan Diagnosticsissa ja tukipaketissa. Korjattu testipari ja
E2E-tyyppitarkistus läpäisivät; katselmuksen jälkitarkistus ei löytänyt
saman havainnon jäljellä olevaa estettä. Tämä ei ole koko K:n loppukatselmus.
Native-toimituksen, hot-journal-palautuksen ja inventaarion päätökset
hyväksyttiin erikseen 10.10.2026; niiden toteutusnäyttö ja K2/K3:n muut
ehdot pysyvät erillisinä.

#### V2s: Tarkistusajurin erillinen toimitus

**Työpuun rajattu kohdenäyttö 10.10.2026; ei koko K:n hyväksyntä.**
[Hyväksytty toimitussopimus](#k-p2n-tarkistusajurin-toimitusehdotus)
on toteutettu erillisenä build-/toimituspolkuna. Yksi database/infrastructure-
omistajan suljettu sopimus nimeää ajuriversion, eheydet, kohdealustan,
native-tavut ja metatiedon. Käännös varmennetaan lukituista lähteistä,
ympäristö rajataan ja ainoa lähdepatch on muistiseurannan asetus.
Buildin yksityinen työalue säilyy erillään pakkausvaiheen tyhjentämistä
hakemistoista. Epävarmaa käännös- tai kopioaineistoa ei poisteta.

Toimitus käyttää itsenäisiä tavukopioita, kiinteää kahden tiedoston
resurssia ja avattuun tiedostoon sidottua kokorajattua lukua. Linkki,
muuttunut lähde, väärä metadata/alusta tai puuttuva ajuri hylätään.
Katselmuksessa löydetty kasvavan lähteen kopiointiraja on korjattu ja
toistettu regressiossa. Kohde varmennetaan uudelleen pakkaajan jälkeen;
pelkkä stage-tiiviste ei hyväksy toimitettua tiedostoa.

Tarkistusyhteyden factory vaatii tämän ajurin kaikille omistetuille
yhteyksille, myös luotetun vertailuscheman muistiyhteydelle. Business-
oletusajuri ja sen pakkausportit säilyvät. Node- ja Electron-utilityn
seitsemän erillistä synteettistä kontrollia läpäisivät: nykyinen 039,
tuettu metadatallinen ja metadataless 038, pitkä resurssipolku sekä
puuttuva, muuttunut ja väärän alustan ajuri. Todellinen SQLite-rajan
ylitys torjuttiin ja tavallinen vain-luku-kontrolli läpäisi sen jälkeen.
Omistetut sulut ja utilityn poistuminen todennettiin. Tämä ei todista
K2:n varsinaista operaatiovarausta, broker-kytkentää tai prosessin RSS-kattoa.

Erilliset käännös-, luokittelu-, toimitus-, hash-/kopio- ja pakkauskytkennän
regressiot sekä tyyppitarkistukset läpäisivät. Windows-pakkaus muodosti
sovellusosan ja erillisen resurssin; kaikkien pakattujen sovellustiedostojen
tavuvastaavuus ja toimitetun ajurin sidonta läpäisivät erillistarkistuksen.
**Koko paketin inventaario hylkäsi silti pakkaustiedoston kokorajaan.**
Rajaa ei muutettu eikä tätä ajoa merkitä läpäistyksi. Mahdollinen
pakkaustiedoston rajapoikkeus on erillinen päätös ja vaatii rajatestit;
Windowsin kohdetulos ei hyväksy Linux-vastinetta tai hardened-palautusta.

Seuraavaksi tarvitaan K2:n main-owned entrypoint, varausluovutus ja
broker-v10 sekä hyväksytyn hot-journal-politiikan kytkentä.
Inventaarion toteutus ja erillinen kohdenäyttö ovat [V2t:ssä](#v2t-inventaarion-suljettu-virhepolku).
Sama testattu output, Linux-vastine, todelliset kuluttajapolut,
hardened-palautus, loppukatselmus ja täsmärevision PR/main-portit ovat
edelleen avoimia. K:n välitilaa ei julkaista.

#### V2t: Inventaarion suljettu virhepolku

**Työpuun rajattu toteutus 10.10.2026; ei koko K:n hyväksyntä.**
Julkaistun työtilan tarkistus todistaa koko scheman ja migraatiohistorian
ennen identity-, integrity- tai foreign-key-lukua. Tuntematon schema,
muuttunut tai vajaa historia ja korruptoitunut tiedosto keskeyttävät koko
inventaarion. Identityä tai turvallista migraatioprefixiä ei arvata.
Todennetun scheman tavallinen sisältövirhe säilyttää `invalidHistory`-
luokituksen. Backend ei muuta lähdetietokantaa.

Registry-portin erillinen `inspect()` lukee nykyisen slotin tai puuttuessa
backup-/next-slotin ilman korjaamista, siirtoa tai poistoa. Inventaario ja
normaali first-start/active-valinta käyttävät tätä porttia; journalin
omistamat erilliset recovery-polut ja kirjoittava `read()` säilyvät.
Virheellisen korkeamman slotin jälkeen ei vaihdeta alemman auktoriteettiin.
Vastaavat nykyohjeet on päivitetty [ADR-0011:een](../decisions/ADR-0011-local-multi-workspace-company-model.md)
ja [workspace-suunnitelmaan](local-company-workspace-plan.md).

Turvallinen schema/history-ensisyy säilyy nykyisen candidate-kanavan,
inventaarion, first-startin ja aktivoinnin virheketjussa. Peruutus sulkemisen
aikana säilyttää jo syntyneen syyn mutta pitää peruutuksen oman lopputilan.
Raakavirheitä tai identiteettejä ei lisätä julkisiin projektioihin.
Ennen korjausta tehdyt toistot ja katselmuksen kaksi syytiedon puutetta
on erotettu korjatusta kohdenäytöstä. Backendin 62 kohdetestiä sekä koko
backendin 3 031 testiä ja neljä build-kontrollia läpäisivät; viisi aiempaa
ohitusta eivät ole läpäisyjä. Korjatut desktopin 129 kohdetestiä ja yhteinen
tyyppitarkistus läpäisivät. Määriä ei summata päällekkäisen kattavuuden vuoksi.

Desktopin kokonaisajossa kaksi olemassa olevaa palautustestiä ylitti oman
aikarajansa; myös keskeneräisen testin siivous epäonnistui. Alkuperäinen
näyttö säilyy. Yksi sallittu kohdennettu uusinta läpäisi 86 testiä, mutta se
ei muuta kokonaisajoa onnistuneeksi tai selitä timeoutien syytä. Kokonaisajon
jälkeinen Node-testivaihe ei käynnistynyt.

Todelliset Electron-kontrollit käyttävät samaa testipohjaa: luotetun scheman
sisältövirhe, epäluotettu schema ja väärä historia, pysäytys ennen myöhempiä
työtiloja sekä kolmen registry-slotin, tietokanta-/artifact-tavujen ja
prosessiomistajuuden säilyminen. Kolme nimettyä nykyisen Electron-development-
runtimen testiä (inventory, first-start ja activation) läpäisivät ensimmäisellä
yrityksellä nykyisin aikarajoin. Ensisyy- ja peruutusregressiot sekä
Electron-koeaineiston muutos on katselmoitu; rajattu jälkitarkistus ei löytänyt
uutta estettä. Inventoryn hylkäyskoe käyttää oikeaa koordinaattoria ja
candidatea, ei koko first-start-koosteen hylkäyspolkua. Tämän koosteen
hyväksytyn buildin tilan säilyminen, backup-/next-only-slotit ja epävarman
siivouksen todellinen polku tarvitsevat vielä oman todennuksensa.
Hardened-palautus ja PR/main-portit ovat vielä avoinna. Kohdenäyttö ei sulje
K2:n utility-, muistibudjetti- tai varausluovutussopimusta eikä hot-journal-poikkeusta.

#### V2u: Omistetun paikallisen työtilan kaatumispalautus

**Hyväksytty rajaus ja työpuun toteutus 10.10.2026; ei koko K:n hyväksyntä.**
Backendin `recoverOwnedLocalDatabase` sallii SQLiten natiivin rollbackin
ennen schema-lukua vain yksityisen, elävän omistajuusportin kautta.
Main johtaa valinnan normaalin rekisteröidyn työtilan tai strictin
inventaarion `ready`-entryn juuresta. Yksityinen valinta sitoo juuren
tiedostojärjestelmäidentiteetin; child johtaa täsmällisen tietokantapolun
samasta profiililayoutista ja tarkistaa nykyisen prosessivarauksen,
käynnistyssukupolven ja peruutuksen. Pelkkä path, operaatio tai DTO ei anna
palautusoikeutta. Childin funktiovalta ei tule rendereriltä tai backupista.

Poikkeus on kytketty vain normaaliin local-käynnistykseen ja julkaistun
paikallisen työtilan inventaarioon. Adoption-, migration-activation-,
restore-/rollback-validation-, import-/replacement- ja snapshot-polut eivät
saa sitä. Tietokanta ja journal ovat kanonisia yhden linkin tiedostoja;
ristiriitaiset WAL/SHM-sivutiedostot, muuttunut identiteetti, katkennut varaus
tai peruutus estävät etenemisen. SQLite itse palauttaa journalin;
sovellus ei tulkitse, poista tai muokkaa sen sisältöä. Vain
`trusted_schema=OFF`, `query_only=ON` ja lukevan `main.schema_version`-
pragman alkuperäinen pager-käsittely ovat sallittuja tässä vaiheessa.
Sen jälkeen yhteys suljetaan ja normaali koko scheman/historyn portti
suoritetaan ennen identity-, business- tai migraatiokyselyitä.

Palautus voi muuttaa tietokantaa ja journalia, vaikka myöhempi schema- tai
omistajuusportti hylkää käynnistyksen. Sivuvaikutusta ei silloin merkitä
olemattomaksi. Ensimmäinen syy säilyy sisäisessä ketjussa; julkinen
database-/migration-virhe pysyy turvallisena. Epävarma omistajuus ei
käynnistä omaa tiedostokorjausta tai poistoa. Terveen tiedoston, tyhjän
TRUNCATE-journalin sekä nykyisen WAL-käynnistyksen normaali polku säilyy.

Rajatut backend- ja desktop-regressiot sekä tyyppitarkistus ovat
läpäisseet. Kolme nimettyä Electron development -kontrollia läpäisivät:
inventory todellisine keskeytyksineen, ensimmäisen käynnistyksen migraatio
ja passiivisen yrityksen aktivointi. Inventory todistaa kirjoittajan exitin
ennen uutta candidatea, muuttuneiden tietokantatavujen täsmällisen palautumisen,
keskeneräisen muutoksen peruutuksen, rekisteri-/artifact-tavujen säilymisen
ja seuraavan inventaarion sivuvaikutuksettomuuden. Riippumaton katselmus
löysi yhden palautus-/schema-portin testinäytön puutteen; korjattu regressio
todistaa aidon levyspillauksen, alkuperäisten tavujen palautumisen ja
schema-hylkäyksen ennen kirjoitettavaa avausta tai palvelurekisteröintiä.
Kohdetesti ja löydöksen uudelleenkatselmus läpäisivät. Tämä ei vielä todista
kaikkia main-compositionin palautusvalintoja tai testikirjoittajan jokaista
epäonnistumis-/säilytyshaaraa; ne huomioidaan jäljellä olevassa todennuksessa.
Linux, hardened backup -> inspect -> restore -> restart -> compare ja
PR/main-portit ovat erillisiä, vielä avoimia hyväksyntäportteja. V2t:n
kokonaisajon epäonnistumista ei muuteta myöhemmällä kohdenäytöllä läpäisyksi.

#### V2v: Eristetyn tarkistuksen prosessiraja

**Työpuun rajattu perusta kohdetodennettu 10.10.2026; kuluttajakytkentä avoinna.**
Backendin `runProfileInspection` käyttää pakollista erillistä tarkistusajuria
ja samoja nykyisiä schema-, sisältö- ja artifact-portteja. Yksi omistettu
readonly-tarkistus palauttaa kuitin todellisista tietokanta- ja katalogitavuista;
identiteetit sekä koko/hash tarkistetaan myös työn jälkeen. Activationin
valmistelu ei tee toista rinnakkaista tarkistusta. Sulkemisen lisävirhe ei
peitä aiempaa tarkistusvirhettä eikä anna onnistunutta kuittia.

Desktopin `profileInspectionMessages`, `profileInspectionRunner` ja
`profileInspectionProcess` muodostavat suljetun private-sopimuksen,
kiinteän utility-entrypointin ja rajatun poistumisketjun. Niissä säilyvät
K-P2:n resurssibudjetit, yksi terminal ja operation/generation/session-sidonta.
Main luovuttaa vain operaation oman varauksen, ei installation-writerin
varausta. Oikea onnistunut exit ja palautunut varaus tarvitaan ennen
hyväksyntää; killin palautus tai exit-koodi yksin ei riitä. Myöhäinen
valmistelu, peruutus tai uudelleen sisään tuleva omistajuuscallback ei saa
julkaista tulosta. Tunnettu ensisyy ja epävarma cleanup pysyvät erillisinä.

Backendin ja desktopin rajatut regressiot, yhteinen tyyppitarkistus sekä
tuotantobuildit läpäisivät. Samassa oikeassa Electron-utilityssa kahdeksan
synteettistä tapausta todensi nykyisen ja kummankin tuetun 038-muodon,
activation-valmistelun, epäluotetun scheman, puuttuvan tarkistusresurssin,
ennenaikaisen exitin ja kesken työn tehdyn pakkopysäytyksen. Kuitit,
todellinen exit, varauksen palautuminen ja lähteen muuttumattomuus
tarkistettiin erikseen. Ensimmäiset koejärjestelyn epäonnistumiset säilyvät;
käynnistimen korjaus tai ennen työtä tapahtunut keskeytys ei ole näyttö
sovelluksen historiallisten vikojen syystä.

Riippumaton katselmus löysi kolme rajattua puutetta: SQL-katalogin liian
myöhäinen määräraja, vain varauksen palautuksessa syntyvän virheen liian
yleinen syy ja valmisteluvaiheen sidotun failure-terminalin syyn katoaminen.
Kohdetoistot vahvistivat puutteet. Korjaus tarkistaa Invoicingin omistamat
dokumenttirajat ennen rivien materialisointia ja säilyttää valmisteluvirheen
ensisyyksi; varauksen palautuksen oma virhe luokitellaan erikseen.
Virheellinen tai ennen valmistelulupaa tuleva terminal ei saa tätä poikkeusta.
Lukumäärän lisäksi dokumenttikatalogin tekstiarvojen tavuraja ja numeerisen
kokokentän tyyppi tarkistetaan ennen materialisointia. Nykyinen sallittu
määräraja säilyy; rajalla oleva katalogi läpäisee. Korjatun ehdokkaan
kohderegressiot, tyyppitarkistus ja tuotantobuildit läpäisivät.
Riippumaton täsmällisten löydösten jälkikatselmus sulki kaikki kolme puutetta.
Sen jälkeen sama kahdeksan tapauksen oikean prosessirajan koe läpäisi
lopullisella ehdokkaalla; myös katalogin todellinen koko/hash ja lähteen
muuttumattomuus varmennettiin. Tämä ei hyväksy kytkemättömiä kuluttajia.

Tämä perusta ei vielä kytke tavallista Inspectiä, portable-backupin tai
recovery pointin itsevalidointia eikä restore-aktivointia utilityyn.
V2v:n koehetkellä broker oli versiossa 9; [V2x](#v2x-kevyt-broker-v10-konteksti)
täydentää sen kevyen kontekstin. Vanha raskas käsittely säilyy väliaikaisesti
kunnes todelliset kuluttajat ja niiden siivous-/maintenance-ehdot on todennettu.
Installation-kohtainen busy-portti ja päivitysoperaation uudelleentarkistus
kuuluvat tähän seuraavaan kytkentään, eivät tämän perustan valmiusväitteeseen.
Kytkentävaiheen katselmus, Linux, koko paketti, hardened-palautus ja PR/main-
portit ovat avoinna. V2t:n epäonnistunutta kokonaisajoa ei hyväksytä näillä
päällekkäisillä kohdeajoilla.

#### V2w: Luotettu konteksti ja tarkistuksen koostaminen

**Rajattu koostamispala kohdetodennettu 10.10.2026; broker- ja kuluttajakytkentä avoinna.**
Backendin `activeProfileInspectionContext` lukee vain jo hyväksytyn aktiivisen
yhteyden profiilisidonnan ja tyhjyystilan. `createApp` rekisteröi tämän
nimetyn portin; tuodun kannan tarkistaja ei saa aktiivista tietokantayhteyttä.
Nykyinen väliaikainen snapshot-adapteri käyttää samaa kontekstin lukijaa.

Mainin `runProfileSnapshotInspection` koostaa nykyisen julkisen validointituloksen
luotetusta kontekstista ja eristetyn tarkistimen private-kuitista. Konteksti
tarkistetaan ennen työtä ja uudelleen todellisen exitin sekä varauksen
palautumisen jälkeen. Profiilin tai elävän auktoriteetin vaihtuminen hylkää
tuloksen. Sama alkuperäinen työmääräaika kattaa kontekstihaut ja tarkistuksen;
valmistelun myöhäinen valmistuminen ei käynnistä uutta työtä. Vain operaation
oma varaus luovutetaan, ja prosessilla on uusi private-generation sekä session.
Kuitin tiedostotiivisteet eivät siirry validoinnin julkisiin kenttiin.

Rajatut backend- ja desktop-testit, yhteinen tyyppitarkistus sekä kyseisten
pakettien buildit läpäisivät. Oikean prosessirajan 13 synteettistä tapausta
todensivat nykyisen ja tuetut historialliset aineistot, valmistelun,
sisältöhylkäykset, peruutukset, kontekstin vaihtumisen sekä operaatiokansion
identiteetin vaihtumisen ennen työtä ja sen jälkeen. Viimeisissä tapauksissa
aineisto säilyi, eikä vanha varaustieto antanut poisto- tai käyttöoikeutta.

Riippumaton rajattu katselmus löysi epäonnistuneen kontekstihaun vanhentuneen
siivousvarmuuden sekä mitätöinnin lisävirheen aiheuttaman ensisyyn katoamisen.
Korjaus varmentaa omistajuuden tuoreeltaan nykyisen rajatun siivousbudjetin
sisällä ja säilyttää alkuperäisen syyn. Jälkikatselmuksen löytämä myöhäisen
Promise-tuloksen rajatapaus tarkistaa myös monotonisen määräajan, ei vain
ajastimen suoritusta. Regressiot kattavat nämä haarat, ja täsmällinen
jälkikatselmus sulki kaikki kolme puutetta.

Kooste ei vielä ole tavallisten backup-/restore-kutsujien production-portti.
Broker-v10, update-/maintenance-omistajan tarkistus oikeassa kanavassa,
installation-busy, varauksen koko staging-elinkaari ja hallittu shutdown
ovat seuraavan yhtenäisen kytkennän ehtoja. Vanha raskas adapteri poistetaan
vasta vastaavan kattavuuden todennuksen jälkeen; varapolkua ei jätetä.
Linux, kokonaispaketti, hardened-palautus, todellinen diagnostiikkaketju ja
PR/main-portit jäävät avoimiksi. Tämä pala ei sulje koko K:ta tai alkuperäistä
Security-havaintoa.

#### V2x: Kevyt broker-v10-konteksti

**Kevyt kontekstiketju ja rajattu katselmus valmistuneet 10.10.2026; kuluttajakytkentä avoinna.**
Nykyinen private snapshot-broker käyttää versiota 10 ja nimettyä
`readProfileInspectionContext`-pyyntöä. Tarkistin saa vain luotetun aktiivisen
profiilin sidonnan ja tyhjyystilan, ei polkuja, rivejä, katalogia tai salaisuuksia.
Lähettäjä, parseri, vastaanottaja ja `backendRunner`-rekisteröintiadapteri
käyttävät samaa suljettua sopimusta. Vanha versio ja ylimääräiset kentät hylätään.

Kutsujan sama monotoninen määräaika kattaa valmiusviestin odottamisen ja
kontekstivastauksen; valmius tai myöhäinen vastaus ei aloita uutta budjettia.
Peruutus sulkee pyynnön kuuntelijat, ja vanhan yksityisen kanavan sulkeminen
mitätöi sen auktoriteetin myös silloin, kun uusi runtime käyttää samaa profiilia.
Restore-valmistelu edellyttää täsmällistä tavallisen maintenance-operaation
omistajaa. Päivitys edellyttää eksplisiittistä update-omistajaa ennen kontekstin
luovutusta ja uudelleen vastauksen hyväksymisessä; katko ei avaa kirjoituksia.

Rajatut protokolla-, backend-, koostamis- ja adapteritestit sekä yhteinen
tyyppitarkistus ja buildit läpäisivät. Oikean Electron-viestikanavan 17
synteettistä tapausta todensivat tarkistusutilityn onnistumiset ja hylkäykset,
varauksen palautuksen, alku-/loppukontekstin katkot ja update-suojan
mitätöitymisen. Epävarman kansion alkuperäiset tavut säilyivät, ja tuore varaus
varmennettiin erikseen mainin poistumisen jälkeen. Tämä ei ole koko
tuotantobackendin utility-rekisteröinnin tai tavallisten kuluttajien hyväksyntä.
Riippumaton rajattu lähdekatselmus ei löytänyt tästä muutoksesta uutta ohitusta
tai regressiota; se ei korvaa yllä rajattua runtime- tai pakettinäyttöä.

Vanhoja raskaita broker-operaatioita ei ole vielä poistettu. Tätä yksityistä
välitilaa ei commitoida tai julkaista, eikä uusi kontekstipolku käytä vanhaa
raskasta operaatiota varapolkuna. Seuraava yhtenäinen kytkentä siirtää todelliset
kuluttajat, installation-busy-rajan, nykyisen runtime-generationin sekä varauksen
koko inspect -> käyttö -> siivous -elinkaaren ja hallitun sulun. Vasta vastaavan
kattavuuden jälkeen korvattu raskas käsittely poistetaan. K3:n todellinen
diagnostiikkaketju, Linux, hardened-palautus, loppukatselmus ja PR/main-portit
säilyvät avoimina. Tämä osatulos ei sulje K:ta tai Security-havaintoa.

#### V2y: Omistettu Inspect-kuluttaja

**Rajattu kuluttajatoteutus 10.10.2026; tämän checkpointin main-kytkentä oli avoin.**
`inspectOwnedEncryptedProfileBackup` käyttää nykyistä autentikoitua purkajaa
ja kiinteää tarkistusutilitya. Operaation varaus on pakollinen, eikä raskas
business-backend-operaatio toimi varapolkuna. Yhteinen staging-palvelu ei enää
poista tarkistuskansiota hylätyn validointipyynnön perusteella: hylätty Promise
tai aikakatkaisu ei todista lukevan prosessin poistumista.

Varauksen hankinta, luotettu konteksti ja utility-työ käyttävät yhtä alkuperäistä
tarkistusbudjettia. Myöhäinen hankinta ei anna työlupaa eikä poisto-oikeutta;
kutsuja voi välittää jäljellä olevan monotonisen määräajan, mutta ei kasvattaa
budjettia. Containerin autentikointi/purku säilyttää nykyiset omat formaatti- ja
sisältörajansa, eikä samaa budjettia aloiteta uudelleen kontekstissa tai lapsessa.

Yhteenveto palautetaan vasta todetun utility-exitin, varauksen takaisinoton,
tuoreen main-omistajuustarkistuksen ja omistetun siivouksen jälkeen. Ensivirhe
ja siivouksen varmuus säilyvät erillisinä. Myöhäinen siivoushavainto ei käynnistä
poistoa; vaihtunut kansio tai epävarma exit/takaisinotto säilyttää aineiston.
Alkuperäistä salattua varmuuskopiota ei poisteta eikä muokata.

Rajattu regressio kattaa tämän kuluttajan ja nykyiset purkuhelperin kuluttajat.
Todellinen Electron-development-koe käyttää tuotannon varausadapteria,
viestikanavaa, MEMSTATUS-ajuria ja kiinteää utilitya. Sen synteettiset nyky- ja
038-varmuuskopiot sekä schema-, manifesti-, toimitus-, exit- ja peruutusvirheet
erottavat ensisyyn turvallisesta siivouksesta. Kansion vaihtumisen alkuperäiset
tavut säilyvät; varauksen vapautuminen tarkistetaan erikseen mainin poistuttua.
Lopullinen kohdesarja läpäisi 94 testiä viidessä tiedostossa; yhteinen
tyyppitarkistus, desktop-build ja yhdeksän todellista prosessitapausta
läpäisivät samalla katselmoidulla lähteellä. Määräaikarajalla tapahtuvan
hankinnan katselmointilöydös toistettiin ensin erillisellä regressiolla:
kahvan hyväksyntä oli tarkistettava myös `await`-jatkossa ennen siivouslupaa.
Korjaus ja täsmällinen regressio sulkeutuivat saman rajatun katselmuksen
jälkitarkistuksessa. Aikaisemmat kohdeajot säilyvät erillisinä, eikä niitä
summata tähän tulokseen. Tämä ei korvaa kokonaisuuden hyväksyntäportteja.

Tässä checkpointissa uutta funktiota ei vielä ollut kytketty tavallisen UI:n tuotantocompositioniin.
Portable-backupin lähdesnapshot, recovery point, palautusta odottava staging,
activation/discard, cold-recovery ja shutdown tarvitsevat yhtenäisen jäljellä
olevan omistajuuskytkennän. Vanhoja raskaita broker-operaatioita ei poisteta
ennen vastaavaa kattavuutta, eikä niitä lisätä uuden kuluttajan fallbackiksi.
Linux, hardened-palautus, koko K:n katselmus ja PR/main-portit ovat avoinna.
Tätä välitilaa ei julkaista eikä Security-havaintoa merkitä korjatuksi.

#### V2z: Portablen main-kuluttajaportti

**Rajattu tuotantokytkentä 10.10.2026; muiden kuluttajien vaihto jatkuu.**
Mainin `ProfileSnapshotInspectionClient` toteuttaa pakollisen
`ProfileSnapshotInspectionPort`-sopimuksen. Portable-varmuuskopion luonti
ja tarkistus käyttävät kiinteää utilitya; aktiivinen business-backend antaa
vain luotetun kontekstin ja lähdesnapshotin. Erillinen toimitussopimus
johdetaan validoidusta backend-resurssista, ei toisesta native-ajuriversiosta.
Palveluun ei lisätä raskasta tarkistusta varapolkuna.

Operaation lähdekansio säilyy C-varauksella tarkistuksen, containerin
kirjoituksen ja riippumattoman itsevalidoinnin yli. Kirjoitettavat tietokanta-
ja katalogitavut sekä PDF-määrä, koko ja täsmällinen polku-/koko-/SHA-256-joukko
sidotaan tarkistusreceiptin sisältöön. PDF:n tallennusnimi johdetaan nykyisestä
dokumentti-identiteetistä, ei PDF-tavujen tiivisteestä. [V2ah](#v2ah-electron-testiruntimen-tarkistusajuritoimitus)
korjaa tämän kuittisidonnan muuttamatta tallennusnimiä tai backup-formaattia.
Itsevalidointi käyttää eri omistettua kansiota;
lähdekansion varaus ei vapaudu sen ajaksi. Tavallinen varmuuskopioformaatti
ja tuettu historiallinen 038-yhteensopivuus säilyvät.

Portable-operaatio, myös pelkkä Inspect, hankkii nykyisen installation-leasen.
Main sulkee uuden työn pääsyn synkronisesti ennen hallittua sulkua ja odottaa
rajatusti koko omistettua kuluttajaa, ei vain päättynyttä tarkistusutilitya.
Ennen lähdetavujen käyttöä tarkistetaan sekä tuore natiiviomistajuus että
receiptin nykyinen yksityinen backend-generation; `await` ei säilytä vanhaa
työlupaa. Myöhäinen snapshot-vastaus tai epävarma kirjoittaja ei anna toiselle
operaatiolle käyttö- tai siivousoikeutta.

Varmentamaton siivous säilyttää lähdeaineiston ja estää puhtaan sammutuksen
merkinnän. Muut omistetut sulut yritetään siitä huolimatta. Portable-luonnin
ensisyy ja siivouksen epävarmuus säilyvät erillisinä, eikä epävarmaa poistoa
yritetä toistamiseen tai merkitä turvallisesti uusittavaksi. Käyttäjärajan
yleinen virheilmoitus säilyy; operational-lukija saa vain sallitun ensisyyn,
uusittavuuden ja sivuvaikutustilan, ei poikkeuksen raakasisältöä.

Rajattu lähdekatselmus löysi kaksi toistettavaa puutetta: työlupa oli
tarkistettava vielä natiiviawaitin jälkeen ja luonnin siivouksen epävarmuus
oli säilytettävä ensisyyn rinnalla. Molempien regressiot hylkäsivät korjausta
edeltävän toteutuksen; korjaukset suljettiin saman katselmuksen jälkitarkistuksessa.
Lopullinen kohdesarja läpäisi 184 testiä yhdeksässä tiedostossa, desktopin
tyyppitarkistus ja build läpäisivät. Kahdeksan todellista Electron-koetta
käyttivät tuotannon kuluttajapalvelua, viestikanavaa, varausadapteria,
MEMSTATUS-ajuria ja kiinteää utilitya. Nyky-/038-containerit, schema-hylkäys,
ennenaikainen exit, peruutus ja kansion identiteetin menetys erottivat
ensisyy-, exit-, takaisinotto- ja säilytystulokset. Luontikoe todensi myös
riippumattoman itsevalidoinnin. Lähde- ja build-tavut säilyivät samoina kokeessa.

Todennus käyttää hallittua synteettistä snapshot-kirjoittajaa ja kontekstin
lukijaa. Se ei korvaa koko tavallisen UI:n backend-käynnistyksen,
recovery-/restore-kuluttajien, cold-recoveryn tai paketoidun palautuksen
hyväksyntää. Palautusta odottavan aineiston varaus sekä activation/discard
ja durable-handoff toteutetaan seuraavassa rajatussa kytkennässä. Vanha
raskas broker palvelee vielä vain vaihtamattomia kuluttajia; se poistetaan
ennen koko K:n hyväksyntää vastaavan kattavuuden jälkeen. Linux,
hardened-kokonaispaketti, loppukatselmus ja PR/main-portit pysyvät avoinna.
Tämä kohdetulos ei sulje K:ta tai Security-havaintoja eikä julkaise välitilaa.

#### V2aa: Palautuspisteen lähdevaraus

**Lähdekuluttajan kytkentä 10.10.2026; Store ja palautus ovat avoinna.**
`RecoveryPointService` käyttää mainin pakollista inspection-porttia kaikissa
lähdesnapshotin luontitavoissa. Yksi omistettu operaatio kattaa muodostamisen,
eristetyn tarkistuksen, tallennuksen, rotationin, tilapäivityksen ja siivouksen.
Tietokanta- ja katalogitavut sekä PDF-inventaario sidotaan receiptin sisältöön
ennen tallennusta; varaus säilyy koko kuluttajatyön yli.

Päivityksen caller-owned maintenancea ei hankita tai vapauteta uudelleen.
Erillinen update-omistaja välittyy tarkistukseen, ja voimassaolo tarkistetaan
ennen käyttöä sekä siivouksen jälkeen ennen onnistumiskuittausta. Myöhäinen
suojan menetys säilyttää jo tallennetun hyvän palautuspisteen. Lähteen poistoon
kelpaa vain natiiviomistajan todistus, ei brokerin assertion-kuittaus tai
ehdoton tiedostopoisto. Epävarma siivous säilyttää ensisyyn, estää turvallisen
uusinnan ilmoittamisen ja pitää palvelun unavailable-tilassa. Automaattisen
luonnin onnistumistapahtuma tulee vasta tämän elinkaaren jälkeen.

Alkuperäiset regressiot toistivat puuttuvan käyttövarauksen, receiptin
sisältöeron, ensisyyn rinnalta katoavan siivousepävarmuuden ja ennenaikaisen
onnistumistapahtuman. Lopullinen kohdesarja läpäisi 90 testiä seitsemässä
tiedostossa; erillinen päivityssuojan composition-sarja läpäisi seitsemän
testiä. Tyyppitarkistus ja build läpäisivät. Yhdeksän todellista Electron-
prosessikoetta todensivat nyky-/038-lähteet, update-omistajan, schema- ja
tavuhylkäyksen, peruutuksen, sulun kesken tallennuksen ja myöhäisen suojan
menetyksen. Exit, varauksen takaisinotto ja alkuperäisten tavujen säilyminen
tarkistettiin erikseen; lähde ja build eivät muuttuneet kokeen aikana.

Kokeen snapshot-kirjoittaja, kontekstinlukija ja Store-callback ovat hallittuja.
Katselmus vahvisti muodostajan nykyisen eristämättömän kopiotarkistuksen:
`createSqliteSnapshot` kutsuu `inspectSqliteProfileDatabase`-funktiota ennen
mainin eristettyä utilitya. Tämä on avoin koko K:n este, ei uuden lähde-
elinkaaren regressio eikä kokeella suljettu polku. Store-containerin
itsevalidointi ja materialisointi käyttävät vielä vanhaa tarkistuspolkua;
ne eivät ole uuden lähdekuluttajan fallback. Niiden sekä restore-stagingin,
activation/discardin, cold-recoveryn, todellisen muodostajan, Linuxin,
hardened-palautuksen ja PR/mainin hyväksyntä on edelleen avoin.

#### V2ab: Valmistellun palautuksen omistajuuden siirto

**Valmistellun slotin esitason kohdetoteutus 10.10.2026; native-kytkentä on avoin.**
Tavallinen restore-staging ja palautuspisteen staging käyttävät samaa
yksinomaista prepared-slotin claimia. Claim estää kilpailevan valmistelun,
aktivoinnin ja discardin ennen ensimmäistä odotusta. Valmistelun pysyvä
journal tai epävarma readback siirtää slotin recovery-omistukseen ennen
runtimen sulkua. Metadataa ei enää voi käyttää uuden aktivoinnin lupana.
Vanha vapautettu claim ei vapauta uuden kutsun omistajuutta.

Hylätty prepare-kutsu ei todista journalin puuttumista. Puhdas hylkäys
edellyttää myös operaation rollback- ja failed-kansioiden puuttumista;
jäljelle jäävää aineistoa ei poisteta tai nimetä uudelleen arvaamalla.
Palvelun catch ei vapauta maintenancea pysyvässä tai epävarmassa handoffissa.
Alkuperäinen turvallinen syy säilyy `restore.activationFailed`-tapahtumassa,
ja erillinen `restore.recoveryRequired` käyttää täsmällistä `activation`-
vaihetta kaikissa nykyisissä lukijoissa. Se ei väitä rollbackin alkaneen.

Lopulliset kohderegressiot läpäisivät erikseen desktopissa 216 testiä
13 tiedostossa, backend-lukijoissa 80 testiä ja API-clientissä 55 testiä.
Tyyppitarkistus ja käännökset läpäisivät. Käännetyn Windows-kuluttajan
seitsemän synteettistä tapausta todensivat todellisen journalin ja
tiedostojärjestyksen, ensisyyn/lisävirheen sekä nykyisen observerin,
JSONL:n, Diagnosticsin ja API-clientin kytkennän. Lukijapariteetin erillinen
tiedostokoe tarkisti 30 tapahtuma/vaihe-sopimusta, myös tukipakettiin asti.
Tarkistuksen snapshot- ja Store-portit ovat näissä hallittuja, eivät
todellinen eristetty native-tarkistin tai backend-prosessin exit-todiste.

Native-varauksen säilyminen odottavan stagingin ja durable-handoffin yli,
vanhan brokerin ajastettu/katkeamisen jälkeinen vapautus, Store-itsevalidointi,
C:n offline-kulutus ja cold-recovery jäävät avoimiksi integraatioehdoiksi.
Myös todellinen muodostaja, Linux, hardened-palautus ja PR/main vaaditaan.
Tämä prerequisite ei sulje K:ta, S030-havaintoja tai koko palautussuojaa.

#### V2ac: Snapshotin hyväksyntäkäytännön sidonta

**Rajattu muodostajapolun edellytys; kohdetodennus läpäissyt.** Muodostetun
snapshotin `exactCurrentManifest` tai `compatibleHistoricalPrefix` säilytetään
mainin yksityisessä operaatiotietueessa ja välitetään pakollisena eristetyn
tarkistimen prepare-pyyntöön. Tuodun aineiston tarkistus käyttää erikseen
`restoreCompatible`-käytäntöä. Puuttuvaa tai tuntematonta käytäntöä ei
korvata oletuksella prosessirajalla. Vastaanottaja käyttää samaa nykyistä
schema-/migraatiotarkistusta; kuittauksen käytännön pitää vastata pyyntöä
sekä runnerissa että mainissa ennen tiedostojen käyttöoikeutta.

Regressiot vaativat täyden nykyketjun hyväksynnän, tavallisen snapshotin
vajaan ketjun hylkäyksen, eksplisiittisen historiallisen prefixin hyväksynnän
ja julkaistun 038-palautuksen rajojen säilymisen. Eri käytännön kuittaus,
puuttuva kenttä tai väärän lähteen uudelleenkäyttö ei saa tuottaa onnistumista.
Omistajuus, poistumistodiste, resurssirajat ja ensimmäinen syy säilyvät.

Tämän checkpointin aikaan Store- ja durable-kutsujat käyttivät vielä vanhaa
brokeria. Store-kytkentä on tämän jälkeen kohdetodennettu [V2ad:ssa](#v2ad-palautuspisteen-tallennuksen-native-kytkentä),
mutta durable-aktivointi on avoin. Vanhaa muodostajan kopiotarkistusta ei
poisteta vielä. Poisto tehdään vasta kaikkien muodostetun snapshotin todellisten
kutsujien vastaavan eristetyn tarkistuksen todennuksen jälkeen. Tämän vaiheen
olemassa olevaan fixtureen perustuva oikean muodostajan ja utility-prosessin
koe ei korvaa hardened-palautusta, Linuxia tai PR/main-portteja.

Ensimmäinen oikean WAL-muodostajan koe hylättiin ennen prosessitapausten
hyväksyntää. Muodostajan vanha readonly-kopiotarkistus jätti snapshot-juureen
SQLite-sivutiedostoja, joita tiukka katalogin sisältötarkistus ei hyväksy.
Alkuperäinen aineisto säilyy. Jatko käyttää jo hyväksyttyä erillisen
tarkistuskopion omistajuusmallia; sisältöjoukkoa ei väljennetä eikä
alkuperäisiä sivutiedostoja poisteta arvaamalla. Vanhan muodostajavaiheen
poisto ja kaikkien sen kutsujien vastaava todennus ovat edelleen avoinna.

Main johtaa erillisen tarkistuskansion sidotusta prosessisukupolvesta ja
luo sen nykyisen varauksen valmistelucallbackissa ennen luovutusta.
Callbackin toteutuminen on pakollinen onnistumisehto. Eristetty tarkistin
sitoo lähdekannan ja katalogin tavut, tekee nykyisellä rajatulla kopiointiapurilla
itsenäisen kopion ja lukee schema/historyn, identiteetin, eheyden ja katalogin
vain siitä samalla readonly-yhteydellä. Sulkemisen jälkeen sekä kopion että
alkuperäisen aineiston identiteetti, koko ja tiiviste tarkistetaan uudelleen.
Alkuperäisen snapshot-juuren tiukka sisältöjoukko säilyy muuttumattomana.

Siivous kuuluu mainille ja vaatii utilityn todellisen poistumisen, varauksen
palautuksen, tuoreen kansio-omistajuuden ja rajatun keskeytyssignaalin.
Vain todistetusti oma tyhjä käyttämätön kansio saa tyhjän kansion poistopolun;
muut kopiot noudattavat nykyistä tiukkaa tiedosto- ja WAL-sääntöä. Myös
viimeisen hakemistoluvun aikana tullut keskeytys estää uuden poistokutsun.
Epävarma poistuminen, vieras sisältö tai siivousvirhe säilyttää aineiston
ja estää onnistumisen. Ensimmäinen prosessisyy ja siivoustulos ovat erilliset.

Lopullinen kohdesarja läpäisi desktopissa 228 testiä kahdeksassa tiedostossa.
Backendin erillinen kohdesarja läpäisi 64 testiä kolmessa tiedostossa;
yksi ennestään alustakohtainen ohitus ei ole läpäisy. Tyyppitarkistus ja
desktop/backend-käännökset läpäisivät. Riippumaton rajattu katselmus löysi
keskeytysaukon; korjattu kohta ja sen täsmällinen regressio tarkistettiin
uudelleen ilman jäljelle jäävää löydöstä tässä rajauksessa.

Seitsemän synteettistä tapausta todensi lopullisen koodin todellisessa
tarkistusprosessissa: nykyinen ketju, eksplisiittinen historiallinen prefix,
038-palautus ja tarkoitukselliset hylkäykset pysyivät erillään. Neljä lähdettä
muodostettiin nykyisellä oikealla WAL-muodostajalla. Hyväksyttävät syötteet
siirrettiin hallitusti vain ilmoitetuista loogisista tiedostoista itsenäisiin
juuriin; vanhan muodostajan sivutiedostoja sisältävä juuri hylättiin edelleen.
Tämä koe todentaa mainin kopio-/varauskytkennän, native-exitin ja siivouksen,
ei tuotannon muodostajavaiheen eristystä tai Store-/restore-vaihtoa.
Linux, koko käynnistys, hardened-palautus ja PR/main-portit jäävät avoimiksi.

#### V2ad: Palautuspisteen tallennuksen native-kytkentä

**Store-kuluttaja kohdetodennettu; durable-palautus avoinna.** Oikea main-
composition antaa `RecoveryPointStore`-tallennukselle nykyisen
`ProfileSnapshotInspectionClient`-portin. Salatun palautuspisteen purku ja
itsevalidointi vaativat pakollisen operaation seurannan, kuittaukseen sidotun
tiedostokäytön ja omistetun siivouksen. Valinnainen settlement-kuittaus ja
suora staging-poisto eivät enää anna native-tarkistuksen poistolupaa.
Lähdesnapshotin oma varaus säilyy sisäkkäisen itsevalidoinnin yli; tarkistin
käyttää toisen operaation riippumatonta juurta eikä siirrä lähteen varausta.

Tarkistuksen ensivirhe säilyy erillään epävarmasta siivouksesta. Epävarma
siivous jättää stagingin, salatun palautuspisteen ja avainkuoren selvitystä
varten; pistettä ei merkitä `validatedGood`-tilaan. Todennettu hylkäys
siivoaa vain omistajan portin kautta. Tavallinen onnistuminen poistaa
itsevalidoinnin stagingin kerran. `stageForRestore` jättää onnistuneen
materialisoinnin varauksen jatkavalle palautusomistajalle; sisältöristiriidan
poisto käyttää samaa omistettua porttia. Formaatit, historiakäytännöt,
nykyiset resurssirajat ja business-ajuri säilyvät.

Kohderegressiot läpäisivät 100 testiä viidessä tiedostossa; tyyppitarkistus
ja desktop-käännös läpäisivät. Riippumaton rajattu lähdekatselmus ei löytänyt
uutta korjattavaa tässä kytkennässä. Todellisen Electron-/native-ketjun
neljä synteettistä tapausta todensivat tavallisen ja päivitystä edeltävän
pisteen itsevalidoinnin, historiallisen prefixin, schema-hylkäyksen ja
nykyisen sekä historiallisen palautuspisteen omistetun purun. Raskaita
broker-tarkistuksia ei kutsuttu; kaikki odotetut prosessit poistuivat.
Kokeen lähdemuodostaja, kontekstinlukija ja avainsuojaus olivat hallittuja.
Näyttö ei todista koko käynnistystä tai `safeStorage`-toimitusta.

Vanhan muodostajan eristämätön tarkistus ja vanhat durable-aktivoinnit
eivät vielä ole vaihdettuja. Erityisesti C:n offline-palautus tarvitsee oman
luotetun kontekstin ja varauksen; elävä broker ei korvaa runtime-absence-
tai cold-recovery-valtuutta. Pysyvä kirjoitussuoja, journal-handoff,
Linux, hardened-palautus, koko K:n katselmus sekä PR/main-portit vaaditaan.

#### V2ae: Odottavan palautusstagingin native-omistajuus

**Valmistelukuluttajat kohdetodennettu; aktivointi avoinna.** Portable-
palautuksen `ProfileRestoreStagingService` ja palautuspisteen
`RecoveryPointRestoreStagingService` käyttävät pakollista mainin native-porttia.
Tarkistus ja valmistelu kuuluvat nykyiseen operaation seurantaan. Valmisteltu
metadata julkaistaan vasta kuittaukseen sidotun tiedostokäytön viimeisen
omistajuustarkistuksen jälkeen. Odottava aineisto pysyy varattuna; V2ab:n
claim estää kilpailevan aktivoinnin ja peruutuksen.

Tavallinen portable-peruutus käyttää vain omistettua poistopolkua.
Epävarma siivous säilyttää tavut, estää uuden valmistelun ja claimin eikä
tarjoa epävarmaa metadataa aktivoitavaksi. Ensisyy säilyy erillään
siivousvirheestä. Peruutuksen hylkäys kulkee olemassa olevan
`restore.stagingFailed`-tapahtuman kautta; epävarma sivuvaikutus merkitään
`unknown`-tilaksi ja uudelleenyritys estetään. Uutta loggeria tai
tapahtumaformaattia ei lisätty.

Lopullinen kohdesarja läpäisi 151 testiä kahdeksassa tiedostossa; koko
työpuun tyyppitarkistus ja desktop-käännös läpäisivät. Riippumaton rajattu
lähdekatselmus ja viimeisen lisäyksen erillinen tarkistus eivät löytäneet
korjattavaa. Todellisen Electron-/native-ketjun neljä synteettistä tapausta
todensivat portable-tarkistuksen, odottavan varauksen, estetyn ja tavallisen
peruutuksen sekä nykyisen ja historiallisen palautuspisteen valmistelun.
Prosessit poistuivat ja lähdetavut säilyivät. Viimeistelyn ensimmäinen
prosessikoe hylkäsi vanhentuneen tapahtumaodotuksen; korjattu koe vaatii
nyt myös estetyn peruutuksen täsmällisen syy- ja tilatiedon. Tuotantotavut
ja aikarajat eivät muuttuneet kokeen korjauksessa.

Lähdemuodostaja, kontekstinlukija, avainsuojaus ja portable-polun
pre-restore-callback olivat kokeessa hallittuja. Todennus ei kata journalin
omistajuushandoffia, pysyvää kirjoitussuojaa, offline/cold-palautusta,
koko käynnistystä, Linuxia, `safeStorage`-toimitusta tai hardened-palautusta.
Nämä sekä koko K:n katselmus ja PR/main-portit ovat edelleen avoinna.
Palautuksen kirjoitussuojan suljettu virhepolku hyväksyttiin myöhemmin
[V2ai:ssa](#v2ai-palautuksen-suljettu-kirjoitussuoja); tämä valmistelun
kohdenäyttö ei vielä todista sitä. Välitilaa ei julkaista.

#### V2af: Tarkistusajurin alustakohtainen todennus

**Ajuri ja resurssi kohdetodennettu; koko toimitus avoinna.** Hyväksytyn
tarkistusajurin tuotantokäännös läpäisi Windowsissa ja Linuxissa. Kääntäjän
sisäisen tiedostoaliaksen vuoksi käännöstoimitus tekee nyt erillisen
varmennetun kopion ennen latausta ja toimitusta. Vain käännöksen oman
täsmällisen kahden nimen pari voidaan hyväksyä välituotteena; tuntematon
lisälinkki, väärä identiteetti ja linkitetty hakemisto hylätään. Kopion pitää
olla yksilinkkinen, eri tiedostoidentiteettiä ja samoja varmennettuja tavuja.
Toimitettavan resurssin tyyppi-, koko-, hash- ja linkkirajat eivät löysene.

Samat 14 käännössopimustestiä läpäisivät kummallakin alustalla ilman
ohituksia. Riippumaton rajattu lähdekatselmus ei löytänyt korjattavaa.
Linuxin Node-prosessit sekä Windowsin Node- ja Electron-utility-prosessit
läpäisivät kukin seitsemän synteettistä ajuritapausta: nykyinen rakenne,
historiallinen prefix metadataa käyttäen ja ilman sitä, pitkä resurssipolku
sekä puuttuvan, muutetun ja väärän alustan ajurin hylkäys. Varsinainen
SQLite-muistirajan ylitys torjuttiin; tavallinen kysely läpäisi sen jälkeen.
Readonly säilyi, kaikki havaitut native-yhteydet sulkeutuivat, prosessit
poistuivat ja oletusajurin normaali luku/kirjoitus sekä tavut säilyivät.
Alustojen lähde- ja patch-identiteetit sekä SQLite-lähdetunniste täsmäsivät;
eri alustojen binääritavujen tai kääntäjäasetusten samuutta ei väitetä.

Resurssin riippumaton toimitus ja kohdesidonta läpäisivät kummallakin
alustalla seitsemän kontrollia. Linuxissa käytettiin nykyistä backendin
resurssiporttia, ei Windowsille tarkoitettua paketointivarmenninta.
Synteettinen resurssiasettelu ei ole koko sovelluksen paketointihyväksyntä.
Ensihylkäykset säilyvät erillisinä myöhemmästä korjatusta kohdenäytöstä.

Tämä ei sulje Linuxin Electron/runtime- ja CI-toimitusta, varausluovutusta,
durable-aktivointia, pysyvää kirjoitussuojaa, offline/cold-valtuutta,
muodostajan eristystä, hardened-palautusta tai PR/main-portteja. Ajuri-,
tietomalli- ja backup-versiot sekä nykyiset resurssirajat säilyvät.
Välitilaa ei julkaista; V2ae:n avoin kirjoitussuojapäätös säilyy.

#### V2ag: Snapshot-muodostajan eristetty tarkistusketju

**Oikean muodostajan kohdenäyttö hyväksytty; koko K avoinna.**
`SqliteProfileSnapshotService` muodostaa nyt suljetut snapshot-tavut
nykyisellä SQLite backup -API:lla avaamatta kopiota uudelleen business-
backendin SQLite-tarkistukseen. Muodostajan tiedosto-, koko-, hash-,
peruutus- ja maintenance-rajat säilyvät. Muodostuksen tulos ei ole
hyväksyntäkuittaus: portable-varmuuskopio ja palautuspisteen muodostus
vaativat edelleen native-validoinnin ja samoihin tavuihin sidotun
kuittauksen ennen salausta ja julkaisua. Schema/history-, integrity-,
foreign-key- ja katalogitarkistukset ovat eristetyn tarkistimen vastuulla.
Migraatiokäytäntöä ei poisteta tarkistusportista tai aktiivisesta runtimesta.

Muodostajan, nykyisten kuluttajien ja tarkistimien 213 kohdetestiä
läpäisivät 12 testitiedostossa. Yksi ennestään Windowsissa ohitettu
POSIX-symbolilinkkitesti ei ole läpäisy. Backendin ja E2E:n kokonaiset
tyyppitarkistukset sekä backend-build läpäisivät. Poistetun tarkistuksen
kutsumisen todentanut ensihylkäys säilyy erillisenä myöhemmästä
korjausnäytöstä. Riippumaton rajattu lähdekatselmus ei löytänyt korjattavaa.

Oikean Electron-mainin ja utilityn kahdeksan kontrollia läpäisivät.
Viisi tapausta käytti todellista nykyisestä tai historiallisesta WAL-
työtilasta muodostettua snapshotia ilman hallittua loogisten tiedostojen
siirtoa. Nykyinen tiukka käytäntö, hyväksytty historiallinen prefix ja
eksplisiittinen legacy-restore säilyivät erillisinä. Väärä käytäntö,
muutettu schema ja tuntematon sivutiedosto hylättiin; alkuperäiset tavut
ja tuntematon aineisto säilyivät. Todellinen native-exit, varauksen palautus
ja mainin oman tarkistuskopion siivous todennettiin. Koe ei käytä koko
sovelluksen käynnistystä tai paketoidun palautuksen hyväksyntäketjua.

Tämä sulkee muodostajan eristämättömän kopiotarkistuksen nimetyn puutteen,
ei durable-aktivointia, pysyvää kirjoitussuojaa, offline/cold-valtuutta,
vanhan raskaan brokerin kaikkien kuluttajien vaihtoa, Linuxin koko runtime-/
CI-toimitusta, hardened-palautusta tai PR/main-portteja. V2ae:n avoin
kirjoitussuojapäätös ja nykyiset resurssi- sekä yhteensopivuusrajat säilyvät.
Välitilaa ei julkaista.

#### V2ah: Electron-testiruntimen tarkistusajuritoimitus

**Rajattu toimitus- ja kuluttajakorjaus; koko K avoinna.** Kanoninen
Electron-valmistelu muodostaa backendin ja tarkistusajurin tuoreisiin
toimituskansioihin paketoinnin samalla rajatulla ajuriportilla.
Puuttuva kääntäjä tai epäonnistunut käännös hylkää valmistelun;
vanhaa ajuria ei käytetä fallbackina. Testiruntime saa itsenäiset
ajuri-/metadatatavut sekä runnerin mainin todelliseen `dist/runtime`-
käynnistyspaikkaan. Resurssihakemiston toinen runner-kopio ei yksin riitä.
Windows-only-Electron-, T3- ja resurssirajat säilyvät.

Todellinen PDF-muodostaja nimeää tiedoston dokumentti-identiteetistä.
Kuittivertailun aiempi oletus nimen yhtäsuuruudesta PDF:n sisältötiivisteen
kanssa hylkäsi ehjän snapshotin. Yksityinen tarkistusreceipt sitoo nyt
validoidun artifact-joukon täsmälliset loogiset polut, koot ja todelliset
SHA-256:t kanoniseksi sisältöidentiteetiksi. Utility ja main käyttävät
samaa protokollan omistavaa laskentaa; backend saa sen kiinteän utilityn
sisäisenä funktiona, ei sovellusten välisenä lähdeimporttina. Tarkistus
käyttää samaa yhtä tietokanta-avausta. Tiedostojen vaihto tai uudelleennimeäminen
hylätään edelleen. Tietomalli, tallennusnimet, containerit ja historiallinen
backup-yhteensopivuus eivät muutu, eikä receipt laajene julkiseen HTTP:hen,
rendererille tai diagnostiikkaan.

Sisältösidonnan ja nykyisten desktop-kuluttajien sarja läpäisi 329 testiä
15 tiedostossa; backendin 53 testiä läpäisivät kahdessa tiedostossa ja yksi
ennestään Windowsissa ohitettu POSIX-testi ei ole läpäisy. Valmistelun ja
komentokytkentöjen 108 Node-sopimustestiä sekä backendin, desktopin ja E2E:n
kokonaiset tyyppitarkistukset läpäisivät. Todellinen PDF-stager todensi
tallennusnimen yhteensopivuuden erillään utilityn varsinaisesta kytkennästä.
Nämä sarjat eivät ole keskenään yhteen laskettavia kattavuusmääriä.

Käyttäjäpolkujen ensihylkäykset erottivat puuttuvan runnerin, väärän
PDF-kuittioletuksen ja preRestorea edeltävän liian aikaisen sulun.
Workspace-korvauksen kirjoitusquiesce pysäyttää ajastimen, mutta sen pitää
säilyttää tarkistusportti turvapalautuspisteen luontiin asti. Portti suljetaan
jo olemassa olevassa lopullisessa capability-disposalissa; tavallinen
shutdown sulkee uuden työn pääsyn edelleen synkronisesti. Tuotantokytkennän
uusi regressio hylkäsi korjausta edeltävän sulkujärjestyksen. Korjauksen
jälkeiset 130 kohdetestiä kuudessa tiedostossa, desktopin tyyppitarkistus ja
tuore kanoninen valmistelu läpäisivät. Kirjoitusten quiesce, maintenance-lease,
native-omistajuus ja puhtaan sammutuksen ehdot eivät kevene.

Korjatun toteutuksen kolme Windows-Electron-käyttäjäpolkua läpäisivät
yhden nimetyn kohdeajon ilman uusintaa. Tuonti-/korvaushylkäys todensi
alkuperäisen schema-syyn säilymisen todellisessa operational-, Diagnostics-
ja tarkistetussa tukipakettiketjussa sekä muuttumattoman yritysdatan ja
hallitun restartin. Korvaus loi ensin oikean turvapalautuspisteen PDF:ineen.
Native-vahvistuksen peruutus todensi oikean dialogin ja nollan lisävirheikkunaa;
se päättyy ennen korvauksen tarkistusutilitya eikä todista sen käyttöä.
Lähde-, build- ja ajuritavut säilyivät samoina kokeessa. Riippumattomat
rajatut lähdekatselmukset eivät löytäneet korjattavaa. Ensihylkäykset
säilyvät erillisinä eivätkä muutu myöhemmän läpäisyn perusteella onnistuneiksi.

Durable-aktivointi, palautuksen pysyvän kirjoitussuojan toteutus, offline/cold-
valtuus, vanhan raskaan brokerin poisto, koko Linux-runtime/CI,
hardened backup -> inspect -> restore -> restart -> compare ja PR/main-portit
ovat edelleen avoinna. Tätä välitilaa ei julkaista eikä K:ta suljeta.

#### V2ai: Palautuksen suljettu kirjoitussuoja

**Omistajan päätös hyväksytty; tilakone ja broker kohdetodennettu. Aktivoinnin
ja offline/cold-polun kytkentä on kesken.** Palautuksen
kymmenen minuutin suoja-ajan päättyminen, yksityisen hallintayhteyden
katkeaminen tai epävarma palautusjournal pysäyttää jatkamisen ja säilyttää
business-kirjoitusten eston hallittuun uudelleenkäynnistykseen sekä
turvalliseen palautumistarkistukseen asti. Tiedostot ja journal säilytetään.
Uudelleenkäynnistys ei yksin hyväksy ratkaisemattoman tilan avaamista.
Onnistuminen tai ennen pysyviä muutoksia todennettu turvallinen peruutus
saa vapauttaa edelleen voimassa olevan suojan normaalisti. Tavallisen
backupin vapautus, formaatit, riippuvuudet ja nykyiset aikarajat säilyvät.

Ensimmäinen toteutuspala täydentää nykyistä `ProfileMaintenanceState`a
palautuksen omistajuudella ja tiukkaa yksityistä snapshot-brokeria nimetyillä
begin/assert/end/invalidate-operaatioilla. Väärä omistaja tai tavallinen
end/force-end ei vapauta palautusta. Odottavan vastauksen on tarkistettava
sama suojan omistaja ennen kuittausta. Tiukasti validoitu exact-owner-
mitätöinti käsitellään odottavasta työjonosta riippumatta; muut operaatiot
säilyvät sarjajonossa. Protokollaversio erottaa uuden
sopimuksen vanhasta; julkinen HTTP, preload ja renderer eivät saa uusia
operaatioita. Journalin turvallisuuden todistaminen kuuluu mainin
nykyiselle palautusomistajalle, ei backendin arvaamalle journalitilalle.

Kohderegressiot vaativat turvallisen vapautuksen, väärän omistajan,
drain-virheen, monotonic-expiryn ilman ajastimen callbackia, yhteyskatkon,
epävarmuuden lukituksen sekä myöhäisen kuittauksen hylkäyksen. Sama
tilakone ja todellinen yksityinen kanava on todennettava yhdessä. Sen
jälkeen durable-aktivoinnin ja offline/cold-palautuksen kytkentä käyttää
samaa sopimusta. Pelkkä tilakoneen tai brokerin läpäisy ei hyväksy näitä
kutsujia, hardened-palautusta tai koko K:n PR/main-portteja.

Tilakoneen 22 ja broker-sopimuksen 58 kohdetestiä, nykyiset tyyppitarkistukset
sekä backend-/desktop-käännökset läpäisivät. Rajattu katselmus löysi jonossa
viivästyvän mitätöinnin, joka toistettiin asiakkaan kautta ennen korjausta;
sen regressiot ja uusintakatselmus läpäisivät. Oikea tilakone ja Electronin
yksityinen viestikanava läpäisivät korjatulla toteutuksella yhdeksän
kontrollia, myös mitätöinnin kirjoituksen drainin ja kontekstikyselyn aikana.
Tämä ei ole backend-utilityn pysäytyksen, journal-handoffin, Linuxin tai
paketoidun palautuksen hyväksyntä. Alkuperäiset epäonnistumiset säilyvät.

Seuraava kytkentä koskee molempia nykyisiä durable-palautuskuluttajia:
valmisteltu native-slot tarkistetaan suojatun restore-omistajan alla,
journalin pysyvyys luetaan takaisin ja snapshotin omistajuus luovutetaan
ennen koko tarkistusasiakkaan sulkua. Sulku ei saa odottaa omaa kuluttajaansa
tai poistaa journalin omistamaa aineistoa. Backendin saman restore-omistajan
nimetty pysäytyspohja on todennettu alla V2aj:ssa; aktivointikuluttajan on
käytettävä sitä nykyisellä todellisella exit- ja varauksen palautumistodisteella.
Offline-vaiheen sekä cold-recoveryn valtuus
ja journal-sidonta todistetaan erikseen ennen vanhan raskaan polun poistoa.
Tämä on hyväksytyn K-kytkennän vaiheistus, ei uusi prosessienhallintakehys.

#### V2aj: Palautuksen nimetty backend-pysäytys

**Nimetty pysäytyspohja kohdetodennettu; ei aktivoinnin tai palautuksen
hyväksyntää.** Nykyisessä backend-command-sopimuksessa on exact-operation-`shutdownForRestore`
ja lähettäjän `stopForRestore()`. Backend vaatii valmistuneen käynnistyksen
sekä saman restore-suojan ennen ja jälkeen odottavan palvelinsulun. Ensimmäinen
sulun tarkoitus säilyy; eri operation tai update/restore-ristiriita ei saa
tuottaa onnistumista. Kaikki omistetut broker-sulut yritetään virheessäkin.
Main vaatii nykyisen todellisen graceful-exitin ja varauksen palautuksen;
kolmen sekunnin strict-raja sekä ordinary/update-käyttäytyminen säilyvät.

Kohdenäyttö kattaa viestiparserin, runnerin suojan menetyksen sulun aikana,
ristiriitaiset seuraajat ja lähettäjän exit-/reservation-rajat. Oikean
utility-prosessin, oikean business-palvelimen, brokerin ja main-varauksen
ketju läpäisi kuusi synteettistä kontrollia: suojattu palautussulku,
puuttuva suoja, väärä omistaja, mitätöity suoja sekä ordinary/update-verrokit.
Jokaisessa todettiin prosessin exit ja varauksen takaisinotto; virhe-exit
ei muuttunut graceful-hyväksynnäksi. Tämä on development-prosessinäyttö,
ei durable-aktivoinnin tai paketoidun palautuksen hyväksyntä.

Rajattu katselmus ei löytänyt tuotantoregressiota, mutta löysi seuraajien
hyväksynnän rajatestiaukon. Täydennetty testiketju läpäisi: voimassa oleva
suoja hyväksyy saman restore-pyynnön ja ordinary-seuraajan; ristiriita
pysyy hylkäyksenä myöhempien hyväksyttyjen seuraajien yli. Viisi kohdetiedostoa
ja 207 testiä läpäisivät. Laajennus havaitsi myös composition-fixturen
puuttuvan toimitusmetadatan ennen backend-käynnistystä. Puute toistettiin
nykyisellä startup-observerilla ja korjattiin vain synteettiseen fixtureen.
Ensimmäiset epäonnistumiset säilyvät erillään korjauksen näytöstä.

Electronin synteettinen testibackend hylkää sekä update- että restore-
pysäytyksen: se ei voi todistaa tuotannon maintenance-suojaa. Sen yhdeksän
kohdetestiä ja backendin, desktopin sekä E2E:n tyyppitarkistukset läpäisivät.
Tavallinen testisammutus säilyy, eikä sen läpäisy korvaa suojatun sulun näyttöä.

Kylmäkäynnistyksen migraatioportin oma pysäytys ei muutu valmiin
business-backendin pysäytykseksi. Native-slotin receipt-, claim- ja journal-
handoff on seuraava erillinen kytkentä; koko K:n portit säilyvät avoinna.

**Seuraavan kytkennän lähderaja:** sekä tavallinen profile-aktivointi että
päivityksen palautuspisteaktivointi käyttävät samaa activation-palvelua,
mutta niiden pysäytysvaltuudet ovat erilliset. Migraatioportissa snapshot-
palvelu on rekisteröity, vaikka business-backend ei ole vielä ready.
Se mahdollistaa valmistelun nykyisen startup-omistajan alla; valmiille
backendille tarkoitettua `stopForRestore()`-hyväksyntää ei saa käyttää
startup-stopin korvikkeena. Journalin `prepared`-readback ja native-slotin
luovutus on tehtävä ennen inspectorin globaalia sulkua kummassakin
kuluttajassa. Journalin epävarmuus säilyttää sekä staging-claimin että
tarkistusasiakkaan aineiston; pelkkä claim ei vielä estä jälkimmäisen
automaattista cleanupia. Alla oleva V2ak todentaa tämän live-kytkennän;
offline/cold-portit säilyvät avoimina. Journaliformaatti ei muutu.

#### V2ak: Native-stagingin durable-handoff

**Live-kuluttajat kohdetodennettu; ei koko palautuksen tai K:n hyväksyntää.**
Molemmat `ProfileRestoreActivationService`-kuluttajat käyttävät rajattua
restore-inspection-porttia, eivät business-backendin raskasta tarkistusta.
Yksi native-valmistelu tarkistaa ja materialisoi saman operaation tavut
exact-operation-restore-suojan alla. Valmistelun turvallinen validointitulos
ja tarkistajan receipt-sidonta eivät anna offline- tai cold-valtuutta.

Tarkistajan poistamisen esto asetetaan ennen mahdollista journal-kirjoitusta.
Sekä kuittauksen että kirjoitusvirheen jälkeen luetaan täsmällinen
`prepared`/`notPrepared`-tila. Vain hylätyn kirjoituksen todennettu
`notPrepared` sekä tuore restore-, main- ja native-varausvaltuus sallivat
säilytysesteen peruutuksen. Suojan vapautuksen kuittaus ja sitä seuraava
tuore omistajuustarkistus kuuluvat samaan seurattuun peruutukseen; poistoeste
purkautuu vasta koko peruutuksen onnistuttua. Shutdown odottaa tätä nykyisellä
rajatulla drainilla eikä voi väliin poistaa tiedostoja. Onnistumiskuittaus ilman `prepared`-todistetta,
ristiriitainen journal, lukuvirhe tai epävarma varaus säilyttää claimin ja
aineiston sekä mitätöi palautusvaltuuden. Alkuperäinen virhe säilyy ennen
readback-/peruutusvirhettä; yleinen UI-virhe ei korvaa turvallista syyketjua.

Varmistetussa handoffissa native-varaus vapautetaan tiedostoja poistamatta
ennen tarkistajan globaalia sulkua. Sulku vapauttaa myös epävarman journalin
säilytetyn, mutta todistetusti päättyneen tarkistuksen varauksen poistamatta
sen tiedostoja. Epävarma prosessi tai siivous säilyttää molemmat. Säilytettyä
operaatiota ei saa tarkistaa uudelleen, käyttää tavallisena backup-lähteenä
tai poistaa. Aktivointia ei lisätä tarkistajan omaan drain-odotukseen.
Tavallisen backupin siivous- ja vapautussääntö säilyy.

Valmis backend pysäytetään `stopForRestore(operationId)`-portilla.
Migraatiokutsujassa käytetään edelleen juuri sen pending-startupin
`stopStartupRuntime()`-valtuutta, ei ready-only-porttia. Tiedostosiirto
alkaa vasta omistetun backendin todellisen poistumisen ja varauksen
palautumisen jälkeen. Molemmat oikean Electron-utilityn, native-ajurin,
brokerin ja durable-journalin kontrollit läpäisivät; staged DB:n tavut
säilyivät varauksen luovutuksessa ja täsmäsivät aktivoituun tiedostoon.
Lähde ja build pysyivät muuttumattomina kokeen aikana.

Ensiregressio toisti vanhan sulun poistavan journalille kuuluvan tiedoston.
Korjattu sama testi sekä rajatut journal-, omistajuus-, sulku- ja composition-
testit läpäisivät. Kattavuus sisältää kirjoituskuittauksen epävarmuuden,
hylätyn mutta sitoutuneen kirjoituksen, suojan menetyksen, failed cleanupin
sekä sulun journal-kirjoituksen ja varauksen vapautuksen aikana. Katselmuksen
löytämä peruutuksen liian aikainen poistoesteen purku toistettiin ennen
korjausta. Korjauksen jälkeinen riippumaton lähdekatselmus ei löytänyt siitä
jäljelle jäävää puutetta; yhdistetyt seitsemän kohdetiedostoa ja 277 testiä,
backendin/desktopin/E2E:n tyyppitarkistukset ja backendin/desktopin buildit
läpäisivät. Molempien todellisten kuluttajien prosessikoe todennettiin myös
tämän korjauksen jälkeen. Kohdesarjoja ei summata päällekkäisenä kattavuutena.
Kylmäpalautus, koko käynnistyshyväksyntä, vanhan raskaan polun poisto,
Linux-runtime/CI, nyky-/038-paketin hardened-palautus ja PR/main-portit
säilyvät avoimina. Tämä ei muuta journalin tai backupin formaattia,
riippuvuuksia, tietomallia tai aikarajoja.

#### V2al: Kylmäpalautuksen vaihekohtainen tiedostotarkistus

**Forward-polun tiedostopaikat kohdetodennettu; cold-valtuus ja eristetty
sisältötodiste vielä avoinna.** Nykyinen activation transaction tarkistaa
ennen startupin forward-jatkoa saman journalin operationin, revision,
vaiheen ja alkuperäisten slottien läsnäololiput. Vaiheiden järjestys tulee
samasta journalin omistavasta määrittelystä kuin tiedostosiirroissa.
Valmistuneen vaiheen ohittaminen ei korvaa sen tiedostojen tarkistusta.

Tietokannan ja PDF-kansion active-, staging- ja rollback-slotit vastaavat
journalin vaihetta erikseen. Siirron intent-vaihe hyväksyy täsmälleen yhden
lähde- tai kohdeslotin myös keskeytyksessä juuri renamen jälkeen. Tyhjä
alkuperäinen slotti ei oikeuta ylimääräistä rollback- tai active-sisältöä.
Tiedostotyypit, linkit ja canonical-polut tarkistetaan; puuttuvan slotin
ensimmäinen olemassa oleva vanhempi tarkistetaan ennen mahdollista mkdir-
tai chmod-toimea. Failed-rootin epävarma aineisto estää forward-jatkon.

Startup ottaa journalista muuttumattoman kopion. Tarkistuksen molemmat
readbackit ja forward-jatkon ensimmäinen journal-luku vaativat samat
kentät. Puuttuva, muuttunut tai lukukelvoton jatko-journal ei valtuuta
uuden operationin omaksumista tai automaattista rollbackia. Tarkistusvirhe
säilyttää tiedostot ja journalin sekä ensisyyn nykyisessä virheketjussa.
Nykyinen turvallinen `restore.recoveryRequired`-tapahtuma
kertoo selvitystarpeesta eikä julkaise raakaa poikkeusta.
Tämä ei lisää uutta lokitus- tai prosessienhallintakerrosta.

Ensiregressiot toistivat puuttuvan valmistuneen tietokanta-/PDF-slotin sekä
journalin vaihdon ja puuttuvan slotin linkitetyn vanhemman. Korjauksen
jälkeinen 12 kohdetiedoston ja 368 testin sarja sekä backendin, desktopin
ja E2E:n tyyppitarkistukset läpäisivät. Sarja sisältää oikeat synteettiset
tiedostot kaikissa forward-vaiheissa, alkuperäisten slottien yhdistelmät,
siirtokeskeytykset, journalin vaihtumisen sekä nykyiset startup-, yrityksen
korvaus- ja live-handoff-verrokit. Backendin ja desktopin buildit läpäisivät.
Rajattu riippumaton loppukatselmus ei löytänyt korjausten jälkeen jäljelle
jäävää puutetta tämän portin lähteestä ja testiapureista. Katselmus ei
hyväksy koko kylmäpalautusta tai K:ta. Testisarjoja ei summata päällekkäin.

Tiedostopaikkojen census ei ole schema-, sisältö-, lineage- tai receipt-
todiste eikä osoita aiemman tarkistusprosessin poissaoloa. Seuraava K-työ
kytkee tuoreen main-/operaatio-omistajuuden ja bounded-native-tarkistuksen
täsmällisiin vaihekohtaisiin lähdetavuihin ennen mutaatiota. `accepted`,
rollback ja niiden cleanup vaativat omat nykyiset valtuutensa; niille ei
anneta forward-valtuutta tämän tarkistuksen perusteella. C offline,
koko startup, raskaan polun poisto, Linux-runtime/CI, hardened nyky-/038-
palautus ja PR/main-portit säilyvät avoimina. Journalin ja backupin formaatti,
riippuvuudet, business-säännöt ja aikarajat eivät muutu.

#### V2am: Kylmäpalautuksen muuttamaton journal-valinta

**Alkuvalinta kohdetodennettu; ei vielä korjaus- tai sisältövaltuutta.**
Activation-journalin `peek()` ja korjaava `read()` käyttävät samaa
laiskaa nykyinen -> backup -> next -prioriteettia. Valitun slotin
virhe estää valinnan; alempaa slottia ei käytetä virheen kiertämiseen.
`peek()` palauttaa muuttumattoman journal-arvon eikä nimeä, poista tai
kirjoita tiedostoja. Nykyisen `read()`-polun korjausjärjestys säilyy.

Startup käyttää muuttamatonta valintaa sekä profile-palautuksen että
yrityksen korvauksen journalille. Päivitysjournalin erillinen politiikka
ei muutu. Valinta ei ota operaatiovarausta eikä todista aiemman prosessin
poissaoloa, sisältöä tai journalin säilymistä myöhemmän odotuksen yli.
Korjaava luku ja mutaatiot tarvitsevat edelleen tuoreen omistajuuden ja
saman journalin readbackin; aiempi muistissa ollut receipt ei anna niitä.

Journal-storen testit tarkistavat valinnan prioriteetin, hylkäykset,
muuttumattomat tiedostot ja vanhan korjauspolun. Todellisen compositionin
kuusi rajattua testiä pysähtyvät ennen palautusvaltuuden ratkaisemista ja
todistavat slotin säilymisen kummallakin restore-polulla kaikista kolmesta
lähtöslotista. Testin alkuperäinen poikkeus säilyy yksityisessä observerissa;
käynnistyksen julkinen virhe säilyy turvallisena.

Yhdistetty 12 kohdetiedoston ja 382 testin sarja, backendin, desktopin ja
E2E:n tyyppitarkistukset sekä backendin ja desktopin buildit läpäisivät.
Rajattu riippumaton lähdekatselmus ei löytänyt valintamuutoksesta
konkreettista ohitusreittiä tai regressiota. Kohdesarjoja ei summata
V2al:n aiempaan määrään. Tämä ei ole native-, packaged-, PR- tai main-
hyväksyntä. Seuraava kytkentä todistaa operaation tuoreen varauksen ennen
korjaavaa lukua sekä vaihekohtaisten tavujen eristetyn tarkistuksen ennen
siirtoja. Terminal-, rollback-, C offline-, Linux-, hardened- ja koko K:n
portit säilyvät avoimina. Formaatti, riippuvuudet ja aikarajat eivät muutu.

#### V2an: Kylmäpalautuksen tuore forward-omistajuus

**Forward-omistajuus kohdetodennettu; sisältö- ja terminal-portit avoinna.**
Kummankin startupin restore-polun forward-jatko ottaa nykyisen yhteisen
installation-leasen ja mainin globaalin omistajuuden lisäksi natiivivarauksen
täsmälliseen olemassa olevaan operaatiokansioon. Puuttuvaa kansiota ei luoda
uudelleen varauksen hankkimiseksi. Muuttumaton journal ja sen kuusi kenttää
tarkistetaan ennen varausta ja uudelleen sen jälkeen. Korjaava luku vaatii
saman journalin sekä tuoreen valtuuden valinnan jälkeen ennen slotin
promootiota tai sivutiedoston poistamista.

Vaihekohtaisen tiedostocensuksen molemmat journal-readbackit ovat
muuttamattomia `peek()`-lukuja. Forward-mutaatiot tarkistavat valtuuden
intent-kirjauksen, hakemiston luonnin, käyttöoikeusmuutoksen ja jokaisen
nykyiseen rajattuun rename-uusintaan kuuluvan siirtoyrityksen yhteydessä.
Valtuusvirhe ei kuulu siirron uusittaviin virheisiin. Nykyiset siirron
odotukset ja aikarajat säilyvät.

Forward-valtuus ei anna rollback-valtuutta. Tällä rajatulla startup-polulla
myös tavallinen siirtovirhe säilyttää alkuperäisen syyn, journalin ja
palautusaineiston sekä pysäyttää jatkon selvitykseen. Vanhan ilman uutta
admissionia toimivan polun käsittely ei muutu. Terminal-vaiheita ei hyväksytä
forward-admissionilla; niiden omistajuus ja cleanup todennetaan erikseen.
Operaatiovaraus säilyy forward-jatkon yli ja suljetaan ennen backendin
käynnistystä. Leasen vapautusta yritetään erikseen myös varauksen
sulkuvirheessä. Ensivirhe ja järjestetyt sulkuvirheet säilyvät erillään;
varmentamaton sulku estää käynnistyksen. Tämä apuri ei poista aineistoa.
Selvitystarve kulkee nykyisen turvallisen `restore.recoveryRequired`-
havainnon kautta, ei uuden loggerin tai raakavirheen julkaisun kautta.

Ensimmäiset viisi hylkäysregressiota sekä riippumattoman katselmuksen kolme
konkreettista löydöstä toistettiin ennen korjausta. Viimeinen 17 kohdetiedoston
ja 486 testin sarja, backendin, desktopin ja E2E:n tyyppitarkistukset sekä
backendin ja desktopin buildit läpäisivät. Sarja kattaa oikean natiivivarauksen
kilpailun ja puuttuvan juuren, molemmat composition-kuluttajat, kaikki
forward-vaiheet, journalin vaihtumisen, mutaatiota edeltävän valtuushylkäyksen,
rename-odotuksen yli kadonneen valtuuden sekä ensivirheen ja sulkujen erottelun.
Rajattu lähteiden uusintakatselmus ei löytänyt jäljelle jäävää konkreettista
puutetta näissä rajoissa. Agentti ei ajanut testejä; yllä oleva näyttö on
erillinen toteutuksen todennus. Kohdesarjoja ei summata aiempiin sarjoihin.

Natiivivaraus sulkee pois saman varausrajapinnan kilpailevan omistajan.
Se ei yksin todista mielivaltaisten vieraiden prosessien poissaoloa eikä
tietokannan tai PDF:ien sisältöä, schemaa tai lineagea. Vaihekohtaisten
lähdetavujen eristetty tarkistus ennen siirtoja, terminal-/rollback-valtuus,
C offline, koko startup, vanhan raskaan polun korvaaminen, Linux-runtime/CI,
hardened nyky-/038-palautus ja PR/main-portit säilyvät avoimina. Tämä ei ole
paketoidun kylmäpalautuksen tai koko K:n hyväksyntä. Journalin ja backupin
formaatti, riippuvuudet, business-säännöt ja aikarajat eivät muutu.

#### V2ao: Kylmäpalautuksen vaihekohtainen sisältöydin

**Sisältöydin kohdetodennettu; prosessi- ja startup-kytkentä avoinna.**
Aktivointitransaktio palauttaa saman muuttumattoman journalin ja strict-
tiedostocensuksen perusteella tietokannan ja dokumenttien lähdeslotit
itsenäisesti. Vanhan `assertForwardRecoveryState()`-portin void-sopimus
säilyy. Pelkkä lähdevalinta ei anna sisältö- tai siirtovaltuutta.

Backendin rajattu `inspectColdRestoreContent`-operaatio johtaa kiinteät
polut valitusta työtila- ja operaatiokansiosta. Se sitoo alkuperäiset tavut,
luo oman riippumattoman tarkistuskopion ja varmentaa scheman sekä historian
yhdestä readonly-yhteydestä ennen identiteetti-, eheys- ja katalogilukuja.
Nykyinen rajattu laskuartifact-adapteri valitsee PDF:t oikeasta lähteestä;
niiden todellinen koko, tiiviste, PDF-alku, polku ja tiedostoidentiteetti
tarkistetaan. Tuntemattomat sivutiedostot tai linkitetty aineisto hylätään
poistamatta alkuperäistä aineistoa. Tiedostokahvat suljetaan erikseen;
ensivirhe säilyy ennen mahdollista sulkuvirhettä.

Kopio sidotaan uudelleen viimeisen valtuusodotuksen jälkeen ennen SQLite-
avausta. Kaikki callerin valtuusodotukset päättyvät ennen viimeistä PDF-
sidontakierrosta. Erillinen cold-receipt sisältää lähdeslotit, tietokannan
tavusidonnan, profiilin, migration-ketjun ja artifact-joukon identiteetin;
se ei väitä puuttuvaa portable-katalogitiedostoa tarkistetuksi. Siirrettävän
backupin nykyinen operaatiomuoto ja receipt säilyvät erillisinä.

Viimeinen backendin seitsemän kohdetiedoston sarja läpäisi 134 testiä;
yksi ennestään alustakohtainen ohitus ei ole läpäisy. Desktopin neljän
slot-/palautustiedoston sarja läpäisi 186 testiä. Backendin, desktopin ja
E2E:n tyyppitarkistukset sekä rajattu riippumaton uusintakatselmus läpäisivät.
Katselmuksen kaksi odotusikkunaa toistettiin ennen tarkistusjärjestyksen
korjausta. Backendin ja desktopin buildit läpäisivät. Kuusi erillistä
native-lapsiprosessikoetta todisti alkuperäisten tietokantatavujen säilymisen
ja varauksen palautumisen vasta todellisen poistumisen jälkeen. Näiden
katalogit olivat tyhjiä: näyttö ei kata PDF:ien native-kytkentää, Electron-
protokollaa tai startup-kuluttajaa. Sarjoja ei summata aiempiin K-vaiheisiin.

Ydin ei vielä ole startupin käyttämä tarkistus. Sen seuraava kytkentä käyttää
nykyistä utility-prosessia ja tarkkaa cold-protokollaa sekä todistaa exitin,
varauksen palautumisen ja tuoreen journal-/census-/sisältö-/lineage-sidonnan
ennen siirtoja. Terminal-, rollback-, C offline-, Linux-, hardened- ja PR/main-
portit sekä koko K säilyvät avoimina. Riippuvuuksia, backup- tai journal-
formaattia, liiketoimintasääntöjä tai aikarajoja ei muutettu.

#### V2ap: Kylmäsisällön nimetty prosessiraja

**Utility-raja kohdetodennettu; startup-kuluttaja on vielä avoin.**
Nykyisen tarkistusprotokollan nimetty `inspectColdRestoreContent`-prepare
sisältää vain valitun työtilajuuren ja itsenäiset database/documents-slotit.
Se ei tarjoa yleistä tiedostopolkua, SQL:ää, komentoa tai executable-valintaa.
Cold-policy on aina `restoreCompatible`. `coldCompleted` on erillinen,
tarkasti parsittu tulos ilman portable-katalogitiedostoa; portable- ja
cold-kuittia ei voi käyttää toistensa onnistumisena. Molemmat lähdeslotit
tarkistetaan jäädytettyä preparea vastaan myös vastaanottajassa.

Runner valitsee vain nimetyn kiinteän backend-moduulin. Cold ja portable
käyttävät samaa nykyistä prepare/grant/work/shutdown/exit/reclaim-ketjua.
Uusi nimetty main-API ei muuta portable-API:n tyypitystä tai kuluttajaa.
Vain cold-receiptin tarkka kenttämäärä poikkeaa; yhteinen viestikoko,
työ-/sulkuajat, heap-raja sekä sisältömäärä-/koko-/hash-rajat säilyvät.
Tulosta ei hyväksytä ennen onnistunutta todellista poistumista ja varauksen
palautumista. Ensimmäinen turvallinen syy säilyy erillään cleanup-tuloksesta.

Yhdeksän kohdetiedoston sarja läpäisi 284 testiä. Desktopin ja E2E:n
tyyppitarkistukset, desktop-build ja rajattu riippumaton katselmus läpäisivät.
Seitsemän oikean utility-prosessin cold-tapausta todisti neljä lähdeparia,
038-historian, schema-hylkäyksen ja poistumisen ilman terminalia.
Alkuperäiset tietokantatavut säilyivät ja varaus palautui vasta poistumisen
jälkeen. Kahdeksan portable-tapauksen utility-regressio läpäisi nykyisen
copy-prepare-sopimuksen mukaisella fixturellä. Fixturen ensimmäinen hylkäys
säilyy erillisenä valmistelupuutteena, ei sovelluksen korjauksena.

Utility-kokeiden katalogit olivat tyhjiä; ne eivät osoita PDF:ien koko native-
ketjua. V2ao:n PDF-kohderegressiot säilyvät eri näyttönä. Prosessikuitti ei ole
siirtovaltuus: startupin täytyy vielä sitoa tuore journal/census, lähdetavut,
luotettu profiililineage ja nykyinen omistajuus ennen mutaatiota. Omistetun
kopion valmistelu ja cleanup kuuluvat edelleen callerille. Terminal-/rollback-,
C offline-, Linux-, hardened- ja PR/main-portit sekä koko K ovat avoimia.
Riippuvuuksia, formaatteja, liiketoimintasääntöjä tai aikarajoja ei muutettu.

#### V2aq: Kylmäsisältöportin omistettu tarkistuskopio

**Cold-kuluttajan orkestrointi kohdetodennettu; startup-siirtovaltuus avoin.**
Nimetty `runProfileRestoreColdInspection` valmistaa oman sukupolvisidonnaisen
kopion nykyisellä reservation-transferilla. Lähdepari parsitaan jäädytetyksi
ennen prosessityötä ja luetaan uudelleen oikean poistumisen, reclaimin ja
kopiosiivoamisen jälkeen. Työtilajuuren tai kumman tahansa slotin muutos
hylkää tuloksen. Cold-receiptiin ei hyväksytä portable-katalogia tai muuta
policya. Luotetun callerin lineage-tarkistus tehdään viimeisen omistajuus-
odotuksen molemmin puolin; main ei avaa SQLitea.

Portable ja cold käyttävät yhtä nykyisestä toteutuksesta erotettua
kopio-/deadline-/exit-/cleanup-orkestrointia, eivät rinnakkaisia valvojia.
Nimetyt prosessi- ja sisältöportit säilyvät erillisinä. Epävarma poistuminen
tai reclaim estää kopion poiston. Cleanup-virhe ei korvaa tunnettua ensisyytä;
allowlistin ulkopuolinen syy säilyy `unknown`-luokkana. Yhteinen työdeadline
ei uusiudu lähdekyselyn, prosessin tai loppuhyväksynnän välillä.

Yhdentoista kohdetiedoston sarja läpäisi 477 testiä. Desktopin ja E2E:n
tyypit, desktop-build ja rajattu riippumaton katselmus läpäisivät. Seitsemän
oikean cold-utility-prosessin tapausta todisti neljä lähdeparia, 038-historian,
schema-hylkäyksen ja poistumisen ilman terminalia sekä caller-owned-kopion
siivouksen. Kahdeksan nykyistä portable-caller-native-tapausta läpäisi samalla
buildilla; nykyiset/historialliset policyt ja alkuperäisen aineiston
säilyttäminen todennettiin. Ensimmäinen kohdeajon hylkäys oli testin oman
lineage-kutsumäärän virhe ja säilyy erillisenä, ei sovellusvikana.

Ensimmäisten native-kokeiden katalogit olivat tyhjiä. Täydentävä kuuden
utility-tapauksen koe käytti kahta synteettistä PDF:ää ja nykyiseen revisio-
malliin oikeilla migraatioilla sidottua katalogia. Kaikki neljä tietokanta-/
PDF-lähdeparia läpäisivät; puuttuva ja muuttunut PDF hylättiin. Tuloskuittiin
tuleva lukumäärä, tavumäärä ja aggregate tarkistettiin tunnetuista fixture-
tavuista. Prosessin todellinen poistuminen, reclaim, kopiosiivoaminen ja
alkuperäisten tietokanta-/PDF-tavujen säilyminen todennettiin myös hylkäyksissä.
PDF-hylkäysten turvallinen syy pysyy nykyisen allowlistin `unknown`-luokkana;
sen perusteella ei väitetä eritellyn perussyyn lukuketjua valmiiksi.

Erillinen kuuden Linux-backend-native-tapauksen koe läpäisi neljä lähdeparia,
038-historian ja schema-hylkäyksen. Oikean lapsiprosessin poistuminen,
varauksen takaisin hankkiminen ja lähdetavujen säilyminen todennettiin.
Tämä Linux-koe käytti tyhjiä katalogeja eikä Electron-utilitya tai koko
startupia; se ei korvaa Linux-runtime/CI- tai hardened-porttia. Nykyinen
tuotantolähde ja build säilyivät muuttumattomina näissä lisäkokeissa.

Lisänäyttö ei todista nykyisen startup-compositionin kytkentää. Lähdeparin yhtäsuuruus
ei todista kaikkien valittujen tavujen säilymistä myöhempien await- ja move-
rajojen yli. Cold-receiptin aggregate ei paljasta mainille auktoritatiivisen
PDF-joukon suhteellisia tiedostopolkuja; main ei saa ratkaista tätä lukemalla
SQLitea tai skannaamalla/korvaamalla koko dokumenttihakemistoa arvaamalla.

**Rajattu jatkopäätös hyväksytty ja kohdetoteutus todennettu V2ar:ssa:**
utilityn oman kertakopiokansion tarkka tiedostosidonta luetaan vasta
exit/reclaim-todistuksen jälkeen nykyisillä katalogi- ja sisältörajoilla.
Tämä V2aq-vaiheen orkestrointinäyttö ei itsessään todista myöhempää
tiedostosidontaa; [V2ar](#v2ar-valittujen-pdf-tiedostojen-sidonta) omistaa sen
nykyisen sopimuksen ja näytön. Tuore journal,
census, tavut ja lineage ennen jokaista mutaatiota sekä terminal-/rollback-,
C offline-, Linux-, hardened- ja PR/main-portit vaaditaan edelleen. Koko K
on kesken; riippuvuuksia, formaatteja, liiketoimintasääntöjä tai aikarajoja
ei muutettu.

#### V2ar: Valittujen PDF-tiedostojen sidonta

**Hyväksytty tiedostosidonta kohdetodennettu; startup-kytkentä vielä avoin.**
Utility tuottaa schema-, identiteetti-, eheys- ja katalogitarkistuksen
valitsemista PDF:istä jäädytetyn luettelon omaan sukupolvisidonnaiseen
tarkistuskopioon. Kiinteä `cold-document-bindings-v1.json` sisältää vain
formaattiversion sekä loogiset ja suhteelliset tallennuspolut, koot ja
SHA-256:t. Tämä on lyhytikäinen yksityinen prosessitulos, ei backup-katalogi,
uusi backup-formaatti, journal tai business-rivien kopio. SQLite suljetaan
ennen tulostiedoston kirjoitusta, ja alkuperäiset tietokanta-/PDF-tavut
sidotaan vielä uudelleen kirjoituksen jälkeen ennen onnistumiskuittia.

Cold-receiptin tarkka `documentBindings`-kenttä sitoo luettelon todellisen
koon ja SHA-256:n. Mainin nimetty lukija johtaa polun nykyisestä omistetusta
tarkistuskopiosta, ei childin vapaasta polusta. Luku tapahtuu vasta
utility-exitin ja varauksen reclaimin jälkeen, ennen kopiosiivoamista.
Lukija tarkistaa kansio- ja tiedostoidentiteetin, tavut, koon, hashin sekä
luettelon tarkat kentät, turvalliset suhteelliset polut, yksiselitteiset
viitteet ja receiptin lukumäärän/tavumäärän/aggregaten. Tuloksen lista ja
rivit ovat muuttumattomia. Portable-receipt ja sen katalogisopimus säilyvät
erillisinä; vain cold-kopion poisto sallii uuden kiinteän tulostiedoston.

Nykyiset rajat säilyvät: IPC 4 KiB, luettelo 64 MiB, enintään 100 000
dokumenttia, yksi PDF 10 MiB, PDF-joukko 20 GiB, tietokanta 24 GiB,
työdeadline 35 sekuntia, sulkuraja 3 sekuntia ja utility-heap 512 MiB.
Sarjoituksen tavuraja tarkistetaan myös ennen koko JSON-tuloksen muodostusta.
Epäonnistunut tai aikakatkaistu mainin luku/sulku säilyttää tarkistuskopion
ja estää jatkovaltuuden: lapsen poissaolo ei todista mainin keskeneräisen
tiedostokahvan sulkeutumista. Myöhäinen luku ei käynnistä uutta poistoa.
Ensimmäinen syy ja epävarma cleanup pysyvät erillisinä.

`assertProfileRestoreColdSourceBytes` tarkistaa valitut lähdetavut mainissa
avaamatta SQLitea tai skannaamatta koko PDF-hakemistoa. Sama slot-pari,
receipt ja jäädytetty lista ohjaavat rajoitettua kahvalukua; polut,
tiedostoidentiteetit, PDF-alku, koot ja hashit varmennetaan. Lopputarkistus
huomaa myös aiemmin luetun PDF:n muutoksen myöhemmän tietokantaluvun aikana.
Tämä portti ei yksin anna siirtovaltuutta: omistava kuluttaja sitoo lisäksi
tuoreen journalin, censuksen, varauksen ja lineagen ennen jokaista mutaatiota
ja käyttää alkuperäistä yhteistä deadlinea. V2ar:n osanäyttö ei vielä
kytkenyt startup-compositionia; myöhempi [V2as](#v2as-startupin-tuore-sisältövaltuus)
omistaa forward-kuluttajien nykyisen kytkennän.

Lopullinen 13 kohdetiedoston sarja läpäisi 384 testiä. Kaikkien
työtilapakettien tyyppitarkistus sekä backend- ja desktop-buildit läpäisivät.
Rajattu riippumaton katselmus löysi mainin keskeneräisen lukutehtävän
siivousriskin; säilytysehto ja timeout-/myöhäinen vastaus -regressio korjasivat
sen, ja uusintakatselmuksessa ei löytynyt muita raportoitavia puutteita.
Kuusi todellista Windows-utility-tapausta todisti kahden synteettisen PDF:n
luettelon välityksen, lähdetavujen uudelleenvarmennuksen kaikissa neljässä
slot-parissa sekä puuttuvan ja muuttuneen PDF:n hylkäyksen. Seitsemän tyhjän
tai historiallisen cold-tapauksen ja kahdeksan portable-tapauksen native-
regressiot läpäisivät samalla buildilla. Näyttömääriä ei summata aiempiin
K-vaiheisiin; hylkäysten syy pysyy nykyisen allowlistin mukaisena.

Kuusi Linux-backendin native-lapsiprosessitapausta läpäisi samalla
tuotantolähteellä ja buildilla: neljä slot-paria, 038-historia sekä
schema-hylkäys. Todellinen exit, reclaim ja lähdetavujen säilyminen
varmennettiin. Näissä katalogit olivat tyhjiä; tämä ei todista Linuxin
Electron-utilitya, main-calleria, ei-tyhjää PDF-ketjua tai koko startupia.

Koko startup-, terminal-/rollback-, C offline-, Linux-runtime/CI- ja
hardened current/038 backup -> inspect -> restore -> restart -> compare
-portit sekä loppukatselmus ja PR/main-hyväksyntä ovat avoimia. Uusi
riippuvuus, yleinen valvoja, loggeri tai muutos backup-formaattiin,
liiketoimintasääntöihin tai hyväksyntärajoihin ei kuulu tähän osaan.

#### V2as: Startupin tuore sisältövaltuus

**Forward-kytkentä ja rajatut kuluttajakokeet todennettu; koko K on kesken.** Molemmat forward-
startup-kuluttajat käyttävät samaa nimettyä sisältövaltuutta nykyisen
activation transactionin ja operation-varauksen kautta. Ensimmäinen
eristetty tarkistus jäädyttää hyväksytyn sisällön. Census valitsee edelleen
tietokannan ja PDF:ien slotit toisistaan riippumatta. Slotin muuttuessa
nykyinen utility todentaa uuden lähdeparin; sen sisältöidentiteetin ja
valittujen PDF-sidontojen on vastattava ensimmäistä hyväksyttyä sisältöä.
Receiptin slotteja ei kirjoiteta uudelleen. Sama alkuperäinen työdeadline
koskee tarkistuksia ja forward-admissionia; se ei ala uudelleen siirrossa.

Ennen forward-kirjoitusta vaaditaan tuore täsmällinen journal, strict census,
elävä varaus, installation-lease, luotettu lineage ja valittujen tavujen
varmennus. Nykyinen rename-retry käyttää samaa rajaa jokaisella yrityksellä.
Journalin staged kirjoitus ja commit käyttävät vanhaa valtuutettua vaihetta;
onnistuneen commitin jälkeinen siivous käyttää uutta vaihetta. Epävarma
kirjoitus tai omistajuuden menetys ei oikeuta palauttavaan renameen tai
aineiston poistoon. Ensimmäinen syy ja vapautusvirheet säilyvät erillisinä.

Käynnistyskytkennän regressio paljasti kylmätarkistuksen väärän aktiivisen
polkuoletuksen. Sekä utility että main johtavat nyt aktiivisen tietokannan
ja PDF:t työtilan kanonisesta `runtime`-juuresta; staged-polut säilyvät.
Väärään layoutiin ei lisätty fallbackia, eikä runtime- tai backup-layoutia
muutettu. Testit hylkäävät väärin sijoitetun tietokannan. Lopullinen
metadatasidonta tapahtuu vasta awaited journal-/census-/owner-tarkistusten
jälkeen; PDF:n muutos tuossa odotusvälissä hylätään.

Lopullinen kohdesarja läpäisi 873 testiä 38 tiedostossa ilman ohituksia.
Kaikkien työtilapakettien tyyppitarkistus sekä backend- ja desktop-build
läpäisivät. Rajattu riippumaton katselmus ei löytänyt jäljelle jäävää
raportoitavaa puutetta journal-guardista, lopullisesta tavusidonnasta tai
polkukorjauksesta. Neljä todellista native-forward-tapausta käytti nykyisiä
profileRestore- ja workspaceReplacement-kuluttajia sekä nyky- ja 038-aineistoa.
Valittujen tavujen säilyminen, alkuperäinen rollback-aineisto, kolmen
utility-sukupolven exit/reclaim sekä operaatiovarauksen vapautuminen
varmennettiin. Koe päättyi `validationStarting`-rajaan; koko main-composition,
backendin jälkivalidointi, terminal-/rollback ja hardened-paketti eivät ole
tämän kokeen läpäisyjä. Kuusi erillistä native-caller-tapausta todensi myös
kaikki neljä DB/PDF-lähdeparia sekä puuttuvan ja muuttuneen PDF:n hylkäyksen
samalla korjatulla buildilla.

Kuusi Linux-backendin native-regressiota läpäisi korjatulla polkujohdannalla:
neljä lähdeparia, 038-aineisto ja schema-hylkäys. Näissä katalogit olivat
tyhjiä; tulos ei todista Linuxin Electron-utilitya, forward-compositionia,
ei-tyhjää PDF-ketjua tai nykyisen revision CI-portteja.

Todennus kattaa journalin commit-rajan, jokaisen aktivointivaiheen,
legitiimin slot-vaihdon, sisällön muutoksen, lineagen/omistajuuden menetyksen,
yhteisen deadlinen ja ensimmäisen virheen säilymisen. Koko startupin
toimitusnäyttö vaaditaan edelleen rajattujen kuluttajakokeiden lisäksi. Terminal/rollback,
C offline, Linux-runtime/CI, hardened nyky-/038-palautus sekä koko K:n
katselmus ja PR/main-portit pysyvät avoimina. Riippuvuudet, backup-formaatit,
liiketoimintasäännöt ja hyväksyntärajat eivät muutu.

#### V2at: Loppuvaiheen journal-sidonta

**Rajattu jatko kohdetodennettu:** terminaaliin siirtymisen slot-census tarkistetaan
ennen `validationStarting`-hyväksyntää tai forward-vaiheen rollback-intentiä.
Puuttuva alkuperäinen rollback-slot ei saa tehdä uuden aktiivisen sisällön
tavuista vanhaa profiilia. Nykyinen strict-census hylkää myös päällekkäisen
staging-slotin ja odottamattoman failed-aineiston ennen journal-mutaatiota.
Neljä uutta regressiota toisti puutteen ennen korjausta. Tämä ei yksin ratkaise
jo `rollbackStarting`-vaiheessa olevan cold-recoveryn sisältövaltuutta.

**Rajattu työpuukorjaus; koko K:n hyväksyntä on avoinna.** Startupin
hyväksyntä, rollback ja `rolledBack`-siivous käyttävät jäädytettyä valittua
journalia. Transaction tarkistaa saman operaation, vaiheen, revision ja
alkuperäiset slot-liput ennen mutaatioita, rename-retryn yrityksiä ja
journalin kirjoitusta. Tuore valtuus voidaan tarkistaa samalla nykyisellä
callbackilla; journal-sidonta ei itsessään todista prosessipoissaoloa,
sisältöä tai lineagea eikä korvaa niiden omistavia portteja.

Journalin poisto käsittelee sivuslotit ennen auktoritatiivista pääslottia.
Kesken katkennut siivous ei poista jäljellä olevaa journalia valtuuden
menettämisen jälkeen. Rollbackin lisävirhe säilyttää ensimmäisen syyn.
Tavallisen forwardin keskeytyksessä nonmutating `peek` saa valita vain
saman operaation täsmällisesti sallitun vaihe/revision-etenemän; tuore
strict census ja rollbackin exact guardit vaaditaan sen jälkeenkin.
Vierasta, taaksepäin mennyttä tai ristiriitaista tilaa ei korjata arvaamalla.
Cold-forwardin virhe ei anna tämän fallbackin valtuutta.

Katselmuksessa löydetty oman vaihepäivityksen jälkeinen rollback-regressio
korjattiin ennen hyväksymistä. Nykyinen kohdesarja läpäisi 910 testiä
38 tiedostossa ilman ohituksia; työtilan tyyppitarkistus ja desktop-build
läpäisivät. Journal-korjauksen ja census-jatkon rajatut riippumattomat
katselmukset eivät löytäneet jäljelle jäävää raportoitavaa puutetta näistä
muutoksista.

Kahdeksan natiivia kuluttajakoetta läpäisi samalla muuttumattomalla buildilla:
molemmat restore-kuluttajat, nyky-/038-aineisto sekä hyväksyntä ja rollbackin
jälkeinen startup-validointi. Alkuperäisen ja tuotavan tietokannan tavut
erotettiin, ja kumpikin lopputila varmennettiin todellisella eristetyllä
SQLite-tarkistuksella. Kaikkien 36 utilityn poistuminen ja varauksen palautuminen
varmennettiin. Business-backendin health ja uudelleenkäynnistys olivat tässä
kontrolloidut rajat, eivät todellisen backendin tai hardened-paketin läpäisyjä.
Kokeen valmistelu- ja fixture-hylkäykset säilyvät erillisinä; niiden korjaus
ei muuttanut sovellusta tai hyväksyntäehtoja.

Terminal-/rollback-sisältö- ja native-valtuuksien tuotantokytkentä, C offline,
koko startup, Linux-runtime/CI, hardened nyky-/038-palautus, paketointirajat,
koko K:n loppukatselmus sekä PR/main-portit ovat edelleen avoinna. Tämä
muutos ei lisää riippuvuuksia, loggeria, valvojaa tai uutta testialustaa
eikä muuta backup-formaattia, liiketoimintalogiikkaa tai aikarajoja.

#### V2au: Keskeytyneen rollbackin slot-valinta

**Rajattu työpuukorjaus kohdetodennettu; koko K avoinna.** Nykyinen palautustransaktio
valitsee `rollbackStarting`- ja `rolledBack`-vaiheissa alkuperäisen
tietokanta- ja dokumenttislotin täsmällisestä tiedostotilasta. Alkuperäinen
voi olla vielä rollback-slotissa, jo aktiivinen tai journalin mukaan
alun perin puuttuva. Tuotavan sisällön pitää samalla löytyä täsmälleen
yhdestä aktiivisesta, staging- tai failed-slotista. Puuttuvaa tai
päällekkäistä sisältöä ei arvata palautetuksi alkuperäiseksi.

Yksivastuinen slot-valinta ja nykyisen transactionin census tarkistetaan
ennen rollback-mutaatiota, rename-retryä ja terminal-journalin siivousta.
Kesken katkennut siirto jatkuu nykyisessä dokumentit-ennen-tietokantaa-
järjestyksessä; epävarma aineisto säilyy. Valittu journal ja nykyinen
omistajuuscallback pysyvät tuoreina. Uutta IPC-sopimusta, loggeria,
valvojaa, riippuvuutta tai aikarajaa ei lisätä.

Todennus sisältää sallitut ja hylättävät slot-yhdistelmät, siirtojen
väliset keskeytykset, alkuperäisen puuttumisen, journal-/omistajuuskatkon
sekä siivouksen keskeytyksen. Tämä tiedostotilan valinta ei ole schema-,
lineage-, sisältö- tai native-valtuustodistus. Kylmän rollbackin
sisältövaltuus ja koko K:n integraatioportit pysyvät erillisinä avoimina
vaatimuksina.

Viisi uutta regressiota toisti puutteen ennen korjausta: puuttuva
alkuperäinen saattoi jäädä uuden aktiivisen sisällön varaan, päällekkäinen
staging päästä rollback-siirtoihin tai terminal-journal poistua palautetun
slotin puuttuessa. Lopullinen kohdesarja läpäisi 958 testiä 43 tiedostossa
ilman ohituksia. Tyyppitarkistus ja desktop-build läpäisivät. Todellinen
startup-kuluttaja säilyttää hylkäyksen syyketjun ja nykyiset turvalliset
rollback- ja selvitystarvetapahtumat. Uuden observer-testin väärä odotus
korjattiin vastaamaan olemassa olevaa aloitus-/hylkäysjärjestystä;
tuotantolokitusta ei muutettu. Rajattu riippumaton lähdekatselmus ei
löytänyt tästä korjauksesta raportoitavaa puutetta.

Kahdeksan nyky-/038-aineiston natiivia kuluttajakoetta läpäisi nykyisellä
desktop-buildilla. Utilityjen poistuminen ja varauksen palautuminen
varmennettiin erikseen. Kokeen business-backend, health ja seuraava
startup olivat edelleen kontrolloidut rajat, eivät todellisen koko
käynnistyksen tai hardened-paketin hyväksyntöjä. Tämä ei sulje kylmän
rollbackin sisältövaltuutta, C offlinea tai K:n PR/main-portteja.

#### V2av: Alkuperäissisällön tarkistussopimus

**P1/P2-päätökset hyväksytty 11.10.2026; P1 ja P2:n startup-rollback kohdetodennettu.** Loppusiivous ja koko K:n portit ovat erikseen avoinna. V2au valitsee
alkuperäisen slotin mutta ei tarkista sen sisältöä. Nykyinen
`inspectColdRestoreContent` käsittelee vain tuotavan sisällön `active`- ja
`staged`-slotit. Sen kuittia ei uudelleennimetä alkuperäisen sisällön
todisteeksi. Tarkistus pysyy nykyisessä eristetyssä utilityssa ja käyttää
samaa schema-, artifact-, kertakopio-, exit- ja reclaim-ketjua.

**V2av-P1 / hyväksytty nimetty private-sopimus:** erillinen
`inspectColdRestoreOriginal`-komento ja täsmällinen alkuperäistulos.
Main valitsee jäädytetyn journalin ja tuoreen V2au-censuksen perusteella
riippumattomat tietokanta- ja dokumenttislotit `active`, `rollback` tai
journalin todistama `absent`. Molempien palautuskuluttajien lähdepolut
johdetaan niiden omistamista kiinteistä layouteista; komentoon ei lisätä
yleistä tiedosto-, SQL- tai suorituskohdetta. Vastaanottaja tarkistaa saman
suljetun sopimuksen. Operation/generation/session, lähderooli ja slotit
sidotaan tulokseen; forward- tai eri operationin tulos hylätään.

Olemassa olevan alkuperäiskannan schema/history varmennetaan ennen
identityä ja katalogia nykyisellä `restoreCompatible`-politiikalla.
Tietokantakyselyt tehdään vain todellisiin lähdetavuihin sidotusta erillisestä
kopiosta. Katalogiin kuuluvien PDF:ien koko, tiiviste ja valitut
dokumenttisidonnat tarkistetaan nykyisillä rajatuilla lähdetavujen luvuilla;
uutta PDF-kopiohistoriaa ei muodosteta.
Alkuperäiskannan puuttuminen ei tuota `healthy`-, schema- tai
profile-identity-kuittia, eikä puuttuvaa kantaa luoda tarkistuksessa.
Puuttuva dokumenttislotti ei kelpaa, jos varmennettu katalogi vaatii PDF:iä.
Ilman alkuperäiskantaa dokumenttikansion säilyminen ei ole todiste
business-katalogista; nykyinen puuttumis- ja säilytyssopimus pidetään
erillään. Ensimmäinen varmennettu alkuperäissisältö säilyy siirtojen
vertailuperustana. Kuitti ei todista takautuvasti journalin syntyhetken
tavuja eikä anna mutaatiolupaa yksinään.

**V2av-P2 / hyväksytty siirroissa säilyvä omistaja:** muuttumaton staging-varaus ei
kelpaa sen oman juuren siirron jälkeen. Samoin rollback-juureen sidottu
varaus ei voi valtuuttaa journalin poistoa sen oman juuren poistamisen
jälkeen. Hyväksytty rajaus käyttää valitun operaation nykyistä `failedOperationRoot`-
kansiota tarkistuksen paikallaan pysyvänä ankkurina. Sen valmistelu
siirtyy vain teknisenä tyhjän kansion luontina alkuperäistarkistuksen
eteen: ensin tuore journal, census, asennuslease ja nykyisten lähdejuurten
native-poissaolo. Vierasta tai epäselvää kansiota ei omaksuta eikä poisteta.
Alkuperäistarkistus ei siirrä aktiivisen työtilan writer-varausta utilitylle.

Nykyisten siirtyvien tai poistettavien juurten erilliset varaukset
suljetaan vasta todetun lapsen exitin/reclaimin ja päättyneiden lukujen
jälkeen, juuri ennen niiden omaa nimettyä siirto- tai poistorajaa.
Asennusomistajuus, lease, valittu journal ja paikallaan pysyvä ankkuri
säilyvät; vanhan polun descriptorin uudelleenkirjoitus ei ole sallittu
oikotie. Tuore census ja alkuperäistavut tarkistetaan ennen jokaista
rollback-mutaatiota ja retryä. Epävarma sulku, myöhäinen lukija tai
vaihtunut juuri säilyttää aineiston ja estää jatkamisen.

Toteutus jaetaan nykyisen native-palvelun nimetyn alkuperäistarkistuksen
sekä molempien startup-kuluttajien rollback-kytkennän todennukseen.
Testit kattavat erilliset ja sekoittuneet alkuperäisslotit, puuttumisen,
nyky-/038-scheman, PDF-ristiriidan, muuttuneet tavut, väärän roolin/generationin,
keskeytyksen sekä omistajuuden ennen ja jälkeen staging-siirron.
Oikean utilityn exit/reclaim ja turvallisen ensisyyn lukuketju vaaditaan.
Myöhemmän business-backendin mahdollisesti muuttamia tavuja ei hyväksytä
vanhalla pre-rollback-kuitilla. `accepted`-/`rolledBack`-loppusiivouksen
ja C offline -polun omat valtuudet todennetaan edelleen erikseen.

Rajattu riippumaton lähdekatselmus vahvisti vanhan root-varauksen
rename-/poistorajan. Pieni nykyisen varausprimitiven synteettinen koe
todensi identiteetin säilymisen rename:ssa, vanhan polun hylkäyksen,
poissulkemisen jatkumisen vapautukseen asti ja tuoreen kohdevarauksen.
Se ei testannut Electronin luovutusta, utility-lasta, SQLitea tai
tuotannon rollbackia. P1/P2:n hyväksyntä on omistajan erillinen päätös,
ei tämän varauskokeen tulos. Riippuvuudet, durable-formaatit,
35 sekunnin työraja ja nykyiset hyväksyntäportit säilyvät.

**P1:n toteutusnäyttö:** original-komento ja suljettu tulos on lisätty
nykyiseen parseriin, runneriin ja prosessikutsuun. Samassa backendin
utility-moduulissa alkuperäisaineiston kaksi kiinteää layoutia käyttävät
nykyistä schema/history-, katalogi-, PDF- ja lähdetavujen sidontaa.
Poissaolotulos ei sisällä tietokantaterveyttä, profile-identityä tai
tietokanta-/dokumenttikuittia. Portable- ja forward-kutsut eivät hyväksy
original-terminalia. Operation/generation/session säilyvät original-tuloksen
vastaanottajalle asti; tulos palautuu vasta todellisen exitin ja reclaimin jälkeen.

`runProfileRestoreOriginalInspection` käyttää nykyistä kertakopion,
exit/reclaimin ja siivouksen omistajaa. Dokumenttisidonnat luetaan vasta
prosessirajan todennuksen jälkeen ja valittu lähde tarkistetaan uudelleen
ennen tuloksen palautusta. Poissaolotulos ei keksi katalogia tai lineageä;
sen siivous vaatii tyhjän kopion. Ristiriitainen tai myöhemmin ilmestynyt
sisältö säilyttää kopion ja estää hyväksynnän. Present-, forward- ja
portable-kuluttajien normaalit siivousvaatimukset säilyvät. Kesken jäävä
mainin luku ei anna lupaa siivota tai vapauttaa epävarmaa omistajaa.

Lopullinen kohdesarja läpäisi 1 036 testiä ilman ohituksia, myös nykyisille
portable-, forward- ja startup-kuluttajille. Koko projektin tyyppitarkistus
sekä backendin ja desktopin buildit läpäisivät. Rajattu riippumaton
lähdekatselmus ei löytänyt original-haaroista raportoitavaa puutetta.
Main-kuluttajan katselmuksessa todettu poissaolon siivouspuute toistettiin
regressiolla, korjattiin yllä kuvattuun tyhjän kopion sopimukseen ja
katselmoitiin uudelleen ilman löydöksiä.
Nimetyn main-kuluttajan utility-kokeen 12 tapausta kattoivat
molemmat layoutit, sekoittuneet slotit, nykyisen ja 038-kannan, alkuperäiskannan
poissaolon aktiivisen kohteen rinnalla sekä puuttuvan valitun kannan/PDF:n
hylkäyksen. Todelliset lapsen exitit, mainin poissulkeminen, varauksen
vapautuminen ja lähteiden säilyminen varmennettiin erikseen.
Kertakopion siivous ja present-kannan trusted-lineage-tarkistus todentuivat
samassa oikeassa kuluttajaketjussa; poissaolo ei saanut lineage-tarkistusta.
Tämä P1-näyttö koskee sisältökutsua; startupin siirtovaltuuden näyttö on alla.

**P2:n startup-rollback-kytkentä:** molemmat startup-kuluttajat käyttävät
valitun `rollbackStarting`-/`rolledBack`-journalin alkuperäistarkistusta.
Stationary-anchor valmistellaan vasta nykyisten lähdejuurten
identiteettisidottujen varausten jälkeen. Tuntematon rakenne, vaihtunut
juuri tai kilpaileva varaus ei anna lupaa journalin korjaukseen tai siirtoon.
Puuttuvan ankkurin viimeinen kansio luodaan yksinomaisesti; olemassa olevaa
vierasta kansiota ei korvata. Installation-valtuus ja lähdevaraukset
säilyvät utility-luovutuksen aikana. Ankkurin main-omistajuus vaaditaan
ennen tarkistusta ja todetun exitin/reclaimin jälkeen, ei luovutuksen aikana.

Alkuperäiskannan ja PDF:ien tavut sidotaan nykyiseen yhteiseen
tiedostovalidointiin. Receiptin ensimmäinen sisältö ei vaihdu siirtojen
mukana; slot-vaihdos vaatii uuden nimetyn tarkistuksen samoilla työrajoilla.
Tuore journal, census, lineage ja tavuvertailu portittavat korjaavan
journal-luvun sekä rollbackin siirrot ja oman `rolledBack`-revision.
Keskeneräinen luku tai menetetty valtuus estää jatkon; cold-haara ei
kirjoita `failedSafe`-journalia menetetyllä valtuudella.
Staging-varaus suljetaan vasta päättyneiden lukujen ja utilityn
exit/reclaimin jälkeen. Juuren talteen otettu identiteetti tarkistetaan
vapautuksen jälkeen, jokaisessa nykyisessä rename-uusinnassa ja kohteessa
siirron jälkeen. Vapautettua vanhan polun descriptoria ei käytetä uudelleen.

Kohdesarja läpäisi 348 testiä ilman ohituksia; koko projektin tyyppitarkistus
ja desktopin build läpäisivät. Tavallisen live-/forward-
palautuksen regressiot sekä oikean compositionin molemmat cold-kuluttajat
ovat mukana; viimeksi mainitun native-utility-raja on kontrolloitu.
Oikean Electron-utilityn ja SQLite-tarkistusajurin kahdeksan synteettistä
tapausta kattoivat molemmat layoutit, nyky-/038-kannan, sekoittuneet slotit,
jo siirretyn stagingin ja `rolledBack`-tilan ilman rollback-juurta.
Alkuperäinen palautui, korvattu sisältö säilyi, uusi cold-jatko läpäisi ja
varausten vapautuminen sekä 22 lapsen todelliset exit/reclaim-rajat
varmennettiin. Natiivikokeen business-backend oli poissa; se ei ole koko
compositionin, paketoidun palautuksen tai business-terveystarkistuksen näyttö.
Riippumaton rajattu lähdekatselmus löysi luovutuksen main-valtuuden ja
vapautetun stagingin identiteetin puutteet. Ne korjattiin regressioineen;
uudelleenkatselmuksessa ei löytynyt näistä poluista jäljelle jäävää puutetta.

Post-backend-terminal, C offline, Linux-runtime/CI, hardened-palautus,
koko K:n loppukatselmus ja PR/main-portit ovat edelleen avoinna. Vanhaa
pre-backend-receiptiä ei saa käyttää business-backendin jälkeisiin muutoksiin.

#### V2aw: Rollbackin loppusiivouksen säilytys

**Rajattu työpuukorjaus kohdetodennettu; terminal-valtuus ja koko K avoinna.**
Palautuneen rollback-juuren rekursiivinen poisto saattoi hävittää sinne
ilmestyneen tuntemattoman sisällön ja poistaa journalin. Kuusi uutta
regressiota toisti puutteen ennen korjausta; keskeytyneen tyhjän siivouksen
jotkin kansiot saavat edelleen olla jo poissa.

`clearRolledBack` sallii nyt vain tyhjän `data`- ja `storage`-rakennekansion
sekä niiden tyhjän operation-juuren poiston. Poisto ei ole rekursiivinen:
myöhäinen tiedosto pysäyttää sen. Viimeisen ulkoisen valtuustarkistuksen
jälkeen tehdään kanoninen rakennetarkistus; journalin jokainen poistovartija
vaatii lopuksi rollback-juuren puuttumisen. Vaihtunut ancestor tai uudelleen
ilmestynyt juuri säilyttää aineiston ja auktoritatiivisen journalin.
Riippumaton katselmus löysi näiden kahden viimeisen await-rajan puutteet;
molemmat toistettiin, korjattiin ja katselmoitiin uudelleen ilman jäljelle
jäävää löydöstä kyseisissä poluissa. Tämä ei todista yleistä filesystemin
kilpailuttomuutta eikä korvaa native-omistajuutta.

Lopullinen kohdesarja läpäisi 398 testiä yhdeksässä tiedostossa ilman
ohituksia. Mukana ovat tavallinen live-aktivointi, cold-/forward-ketjut,
molemmat palautuskuluttajat ja startup-composition. Koko työtilan
tyyppitarkistus ja desktop-build läpäisivät. Todellinen startup-kuluttaja
välittää siivoushylkäyksen nykyisiin turvallisiin validation/recovery-
tapahtumiin; journal ja alkuperäiset tavut säilyvät.

Neljä todellista utility-/native-tapausta todensi cleanup-hylkäyksen
molemmilla kuluttajilla nyky-/038-aineistolla. Kaikki 20 lapsen exit/reclaim-
rajat sekä aineiston ja varausten säilytys/vapautus tarkistettiin.
Samalla muuttumattomalla buildilla kahdeksan tavallista hyväksyntä-/rollback-
kontrollia läpäisi; 36 lapsen exit/reclaim ja eri alkuperäis-/kohdetavut
varmennettiin. Natiivikokeen business-backend ja health olivat kontrolloidut
rajat, eivät koko mainin tai hardened-paketin läpäisyjä. Näitä tuloksia ei
summata aiempien vaiheiden hyväksyntänäytöksi.

#### V2ax: Backendin jälkeisen terminal-valtuuden päätösrajat

**Omistaja hyväksyi kaikki kolme päätöstä 11.10.2026. Toteutus ja sen
hyväksyntänäyttö ovat vielä kesken.**
Katselmus vahvisti, että ennen backendin avaamista saadun kuittauksen
valtuus päättyy sen oman operaation sulkemiseen. Sallittu metadata-baseline,
migraatio ja startup-retention voivat muuttaa tietokantatavuja ja chainia.
Niitä ei hylätä pelkän vanhan byte-equalityn vuoksi, mutta myöhempi tarkistus
ei myöskään takautuvasti todista alkuperäistä sisältöä.

1. **Live-loppuhyväksyntä:** hyväksytty rajaus säilyttää business-backendin käynnissä
   normaalissa onnistumisessa. Nykyinen maintenance sulkee kirjoitukset;
   nykyinen snapshot-/eristetty tarkistus todistaa tuoreen versionmukaisen
   sisällön. Poistettavien operation-juurten native-omistajuus, lease,
   jäädytetty journal ja lineage varmennetaan erikseen. Uutta manageria,
   rinnakkaista schema/PDF-validaattoria tai ylimääräistä onnistumisen
   uudelleenkäynnistystä ei ehdoteta. Kuitti ei anna yleistä mutaatiolupaa.
2. **Accepted-cold-jatko:** hyväksytty rajaus lykkää jo hyväksytyn journalin
   keskeytyneen siivouksen uuden normaalin backend-/sisältövalidoinnin
   jälkeen. Osittain poissa olevat cleanup-juuret ovat sallittuja vain
   oman terminal-censuksen mukaan. Hyväksyttyä palautusta ei päätellä
   epäonnistuneeksi siivousvirheestä eikä käynnistetä vanhaa rollbackia.
3. **Alkuperäiskannan poissaolo:** hyväksytty rajaus pysäyttää rollbackin automaattisen
   business-käynnistyksen selvitykseen ennen uuden tyhjän kannan luontia.
   Kyse on journalin osoittamasta alkuperäiskannan puuttumisesta, ei tyhjästä
   asiakaslistasta tai tavallisen historiallisen varmuuskopion tuonnista.
   Tiedostot ja journal säilyvät; dokumenttislotin poissaolo pysyy erillisenä.

Rollbackin nykyinen tiukka restore-sulku, todellinen exit/reclaim ja tuore
alkuperäistarkistus vaaditaan ennen tiedostomuutoksia. Tavallinen pakotetun
stopin poissaolohavainto ei anna tätä valtuutta, eikä restore-aineistolle
laajenneta owned-local hot-journal -poikkeusta. Tämä nimenomainen hyväksyntä
ei muuta muita avoimia K-portteja. Toteutuksessa nimeä täsmällinen
kuluttajakytkentä ja todista oikea backend/migraatio/terminal-ketju; pelkkä
suurempi kohdetestimäärä tai V2aw:n siivousnäyttö ei sulje sitä.

#### V2az: Hyväksynnän pysyvyys ja alkuperäiskannan poissaolo

**Rajattu tilakytkentä työpuussa; koko terminal-valtuus ei vielä ole valmis.**
Transactionin `commitAcceptance` julkaisee hyväksytyn journalin ja palauttaa
täsmällisen, jäädytetyn readbackin ilman juurten poistoa. `clearAccepted`
siivoaa erikseen saman valitun hyväksytyn journalin. Nykyinen `accept`
säilyy yhteensopivuuskutsuna näiden kahden operaation yli.

StartupRecovery erottaa aloittamattoman, varmentamattoman ja varmennetun
hyväksynnän. Kuittauksen puuttuminen ei anna rollback-valtuutta, vaikka
journalin julkaisu olisi voinut jo onnistua. Molempien startup-kuluttajien
composition säilyttää epäselvän palautustilan suojan eikä päättele hyväksyntää
uuden korjaavan journal-valinnan perusteella. Jo hyväksytty kylmä journal
odottaa uuden backendin sisältö-/terveystarkistusta. Sisällön tarkistuksen
onnistuminen ja myöhempi siivousvirhe eivät ole sama tapahtuma; ensisyy
säilyy sisäisenä, julkinen yleisvirheraja ei laajene. Hyväksytyn tai epävarman
hyväksynnän jälkeen ei käynnistetä vanhaa profiili-/workspace-rollbackia.

Journalin todistama alkuperäiskannan poissaolo pysäyttää sekä
`rollbackStarting`- että `rolledBack`-käynnistyksen ennen business-backendia.
Puuttuva kanta ei muutu uudeksi tyhjäksi kannaksi eikä journalia poisteta.
Tavallinen forward-palautus alun perin puuttuvaan kantaan säilyy erillisenä.

Kolme uutta regressiota toisti lähtöpuutteet. Lopullinen 422 testin
kohdesarja yhdeksässä tiedostossa, desktopin tyypit ja build läpäisivät.
Composition-näyttö käyttää kontrolloitua backendia ja todellisia journal-
ja tiedostotavuja; se ei ole paketoitu käyttäjäpolkutodiste. Neljä todellista
utility/native-tapausta nyky-/038-aineistolla todensi hyväksytyn journalin
siivousvirheen, sisällön säilymisen ja kylmän jatkon validoinnin. Kaikki
20 lapsen exit-/reclaim-rajat varmennettiin. Saman käännöksen kahdeksan
tavallisen hyväksynnän ja rollbackin native-kontrollitapausta läpäisivät;
niiden 36 lapsen exit-/reclaim-rajat varmennettiin. Business-/health-raja
on näissä kontrolloitu. Rajattu riippumaton ehdokaskatselmus havaitsi,
että alkuperäiskannan poissaolon esto saattoi hukata sitä edeltäneen
forward- tai validointivirheen. Kaksi regressiota toisti puutteen;
korjaus säilyttää ensisyyn sisäisessä ketjussa. Löydöksen jälkikatselmus
ei jättänyt uusia konkreettisia deltalöydöksiä. Tämä ei ole koko K:n katselmus.

Live-snapshotin tuore sisältötodiste, terminal-juurten census ja native-
poistovaltuus, oikea backend/migraatio/terminal-ketju, C offline ja K:n
Linux-, hardened-, paketointi- sekä integraatioportit pysyvät avoimina.
Tilakytkentä ei hyväksy vanhan receiptin uudelleenkäyttöä eikä yksin sulje
S030-01/S030-02-havaintoja.

#### V2ba: Terminal-inventaario ja nimetty siivous

**Rajattu filesystem-kytkentä työpuussa; sisältö- ja native-valtuus ovat avoinna.**
Transaction jäädyttää valitun journalin, staging-/rollback-juuret, ankkurit,
tiedostoidentiteetit ja hakemistojen sallitut lapsilistat. Linkki, vaihtunut
tiedosto tai juuri ja sallitun rakenteen ulkopuolinen sisältö estävät jatkon.
Accepted-jatko sallii osittain poissa olevat juuret luomatta niitä uudelleen.

Siivous käyttää vain inventoituja `unlink`-/`rmdir`-kohteita, ei rekursiivista
poistoa. Myöhäinen tuntematon sisältö tai uudelleen ilmestynyt juuri säilyttää
hyväksytyn journalin; osittainen siivous ei anna rollback-valtuutta.
Journalin poisto vaatii lopuksi juurten poissaolon ja nykyiset vartijat.
Inventaario ei yksin todista, ettei juuri ollut vaihtunut jo ennen sen lukua.

Riippumaton katselmus löysi kokolaskennan yhteensopivuuspuutteen:
katalogin rajaa sovellettiin toistuviin absoluuttisiin polkuihin ja lapsilistoihin.
Korjaus säilyttää juuripolun kerran ja jäädytetyt vanhempi/nimi-rivit;
kompaktin kirjanpidon rajat pysyvät 64 MiB:n ja 100 000 PDF:n rajoissa.
Tyhjät hakemistotkin lasketaan. Rajatesti vertaa normaalin 100 000 dokumentin
rakenteen esityksiä, ei suorita sen koko filesystemiä eikä todista RAM- tai
aikarajaa tai jokaista historiallisen polun ääritapausta. Jälkikatselmus
sulki tämän rajatun löydöksen ilman uusia konkreettisia deltalöydöksiä.

Lopullinen 446 testin kohdesarja 11 tiedostossa ilman ohituksia, desktopin
tyypit ja build läpäisivät. Kaksitoista todellista utility/native-tapausta
nyky-/038-aineistolla kattaa molemmat palautuskuluttajat: accepted-cold-jatkon
sekä tavallisen hyväksynnän ja rollbackin. Kaikki 56 exit-/reclaim-rajat
varmennettiin. Business-backend ja health ovat näissä kontrolloidut rajat,
eivät mainin, Linuxin, hardened-paketin tai PR/main-porttien hyväksyntä.
Utility-kokeen ensihylkäys johtui fixturen laskuarkistoon lisäämästä ylimääräisestä
tekstitiedostosta. Fixture korjattiin katalogiin sidottuihin PDF-tavuihin;
tuotannon sallittua rakennetta ei laajennettu ja ensihylkäys säilytettiin.

Tuore live-sisältötodiste, sen sidonta journalin julkaisuun, juurikohtaiset
native-varaukset ja valtuuden säilyminen mutaatioon asti pysyvät V2ax:n
seuraavana työnä. Tämä vaihe ei yksin sulje S030-01/S030-02:ta tai koko K:ta.

#### V2bb: Live-terminalin tuore valtuus

**Rajattu live-kytkentä ja oikean backendin kohdenäyttö; koko K on kesken.**
Molempien startup-palautuskuluttajien loppuhyväksyntä ottaa nykyisen
installation-leasen ja exact-owner restore-kirjoitussuojan, luo tuoreen
snapshotin ja tarkistaa sen nykyisellä eristetyllä tarkistusprosessilla.
Lineage ja versionmukainen sisältö varmennetaan migraation jälkeen;
onnistunut normaali polku ei sammuta business-backendiä uudelleen.

Snapshotin oma native-varaus säilyy paikallaan koko terminalin ajan.
Poistettavien operation-juurten varaukset sidotaan ennen niiden ottamista
jäädytettyyn inventaarioon. Journalin korjaava luku, hyväksynnän julkaisu
ja jokainen nimetty poisto vaativat tuoreen valtuuden; async-luku ja
inventaarion tarkistus eivät saa ohittaa valtuuden vanhentumista.
Jo poistettu juuri ei voi todistaa journalin poistovaltuutta.
Puuttuva accepted-juuri jätetään poissa olevaksi eikä sitä varata tai luoda.

Accepted-cold-kuluttaja käyttää ei-muuttavaa journal-valintaa ja säilyttää
myös sivuslotit tuoreeseen backend-/sisältövalidointiin asti. Siivouksen
epäonnistuminen säilyttää hyväksytyn tilan, ei anna rollback-valtuutta.
Valtuuden tai siivouksen epävarmuus säilyttää tutkimusaineiston ja
kirjoitussuojan. Myöhäinen tulos ei saa jatkaa mutaatioita valtuuden päätyttyä.

Riippumaton katselmus löysi brokerin liian suppean restore-context-ehdon,
valtuuden vanhentumisaukon viimeisessä journal-odotuksessa ja liian aikaisen
accepted-cold-sivuslotien siivouksen. Rajatut korjaukset ja niiden
jälkikatselmus kattavat nämä kolme lähdehavaintoa. Broker sallii vain saman
voimassa olevan restore-operaation inspect-lukukontekstin; vieras, päättynyt
tai update-omistaja ei saa uutta lupaa. Protokollaa tai riippuvuuksia ei lisätty.

Lopullinen kohdesarja läpäisi 566 testiä 15 tiedostossa ilman ohituksia;
desktopin tyypit ja build läpäisivät. Neljä normaalia ja neljä
accepted-cold-tapausta läpäisi oikealla business-backendillä,
snapshot-brokerilla, eristetyllä tarkistimella ja native-varauksilla.
Molemmat palautuskuluttajat sekä nykyinen ja historiallinen 038-aineisto
katettiin; kaikki 40 utility-/backend-poistumista ja varausten palautumiset
varmennettiin. Accepted-cold-koe aloittaa synteettisestä jo hyväksytystä,
osittain siivotusta tilasta; se ei ole todellisen kaatumisen koko main -koe.
Fixturen kaksi valmisteluhylkäystä korjattiin vastaamaan mainin nykyistä
snapshot-parentin valmistelua ja restoreCompatible-migraatiovalintaa.
Ensihylkäykset säilyivät eikä tuotannon sisältö- tai aikarajaa lievennetty.

Näyttö ei hyväksy ennen migraatioita toimivaa C-offline-kuluttajaa,
koko mainin palautusketjua, suuren katalogin koko terminal-resurssipolkua,
Linuxia, hardened-pakettia tai PR/main-portteja. Nämä ovat seuraavat
hyväksyntärajat, eivät uusilla kohdetestimäärillä korvattavia ehtoja.

#### V2be: C:n business-valmistumisen journal-sidonta

**Rajattu kohdetoteutus; journaliton jatko ja koko K:n hyväksyntä ovat avoinna.**
Mainin C-palautus välittää alkuperäisen, validoidun update-journalin
`completeAfterProfileValidation`- ja `requireRecoveryAfterRestoreRollback`-
kutsuihin. Sama valinta tarkistetaan ennen ja jälkeen profiilivalidoinnin.
`readForLiveOwner()` ei korjaa sivuslotteja tai valitse uudempaa operaatiota
hiljaisesti. Myös jo valmistuneen journalin jatko tarvitsee muuttumattoman
valinnan; puuttuva kirjoitustarve ei anna oikeutta ohittaa tarkistusta.

Nykyisen journalivaraston ehdollinen kirjoitus vertaa koko validoitua
edeltävää journalia, ei vain korrelaatiota, tilaa tai revision alarajaa.
Vertailu ja julkaisu ovat saman store-instanssin nykyisen exclusive-operaation
sisällä. Mainin omistajuustarkistus on synkroninen; asynkronista tai
reentrant-kutsun lupausta ei hyväksytä valtuudeksi. Vieras `.backup` tai
`.next` estää live-kirjoituksen ja säilyy. Omistajuus tarkistetaan vielä
heti ennen ensimmäistä currentin siirtoa, ennen uuden currentin julkaisua ja
edellisen version loppusiivousta. Awaitista paluu ei yksin säilytä valtuutta.
Julkaisun jälkeinen valtuuden menetys säilyttää currentin ja backupin
selvitystä varten. Muut journal-kirjoittajat säilyttävät nykyisen sopimuksensa.
Havaittu currentin katoaminen ennen siirtoa hylätään; sitä ei käsitellä
ensimmäisen journalin luontina. Tämä ei lisää prosessien välistä CAS-palvelua
eikä lupaa estää kaikkia valtuussopimuksen ulkopuolisia tiedostokirjoittajia.

Virhehaara ei korvaa muuttunutta tai osittain julkaistua journalia vanhasta
valinnasta muodostetulla `recoveryRequired`-kirjoituksella. Alkuperäinen virhe
säilyy ennen mahdollista journalin lisävirhettä. Jos jo siirretyn currentin
takaisin palautus epäonnistuu, myös palautusvirhe säilyy erillisenä alkuperäisen
syyn jälkeen; backupia ei poisteta onnistuneen palautuksen oletuksella.
Turvallinen julkinen
`update.*`-tapahtumasopimus ja käyttäjän recovery-palaute eivät laajene;
raw-journalia, pakettitiivisteitä tai polkuja ei lisätä lokiin.

Viisi regressiota toisti alkuperäisen valinnan ylikirjoituksen tai väärän
valmistumisen ennen korjausta. Erillinen loppusiivousregressio toisti
valtuuden menetyksen jälkeisen backupin poistamisen; molempien versioiden
säilyminen on nyt kontrolloitu. Erillinen katoamisregressio toisti stale-
julkaisun ilman currentia; tämäkin hylätään. Rajatapaukset kattavat muuttuneen
paketti-identiteetin, jo valmistuneen tilan, stale-valinnan ennen tarkistusta,
julkaisun jälkeisen kirjoitusvirheen sekä async-/reentrant-valtuuden hylkäyksen.
Katselmuksen löytämä viimeisen awaitin jälkeinen valtuusaukko ja epäonnistuneen
takaisin siirron katoava syy toistettiin ennen korjausta. Kohdetodennuksen
229 testiä seitsemässä tiedostossa, desktopin tyyppitarkistus ja build
läpäisivät. Mukana ovat journalin muiden kirjoittajien nykyiset regressiot,
kutsujan valtuuden välittyminen ja samaan revisioon muuttunut paketti.
Riippumaton katselmus hyväksyi rajatun korjausdiffin; tämä ei sulje koko K:ta.

Olemassa olevan Electron/backend/native-kokeen normaalit ja muuttuvan
update-valinnan kontrollit kattavat nykyisen ja historiallisen 038-kannan.
Ehjä valinta valmistuu; muutettu valinta säilyy ja estää valmistumisen.
Neljän tapauksen kaikki 20 omistettua prosessia poistuivat onnistuneesti;
native-varauksen vapautuminen ja uudelleenvaraus varmennettiin.
Tämä on oikeiden palveluiden ennen migraatioita toimiva ketju, ei koko
mainin, oikean binaariasentimen tai hardened-paketin hyväksyntä. Journaliton
C-jatko, vanhan raskaan aktiivivalidoinnin korvaaminen, Linux, suuren
katalogin resurssinäyttö, K:n loppukatselmus ja PR/main-portit ovat avoinna.

#### V2bh: Journalittoman C:n historiallinen käynnistysadmissio

**Rajattu pre-open-kytkentä; koko K:n hyväksyntä on avoin.** C:n alussa
valittu update-journal tarkistetaan lukevasti ennen backendin käynnistystä.
Vain täsmällisen käynnissä olevan kohteen `rollbackRequired`-,
`businessRollbackStarting`- tai `businessRollbackCompleted`-tila sekä
säilynyt palautuspisteviite ja alkuperäinen migraatioketju sallivat
`restoreCompatible`-schema-politiikan. Eksplisiittinen journalin poissaolo
ei adoptoi uutta operaatiota. Main varmennuttaa saman valinnan uudelleen
nykyisen varauksen prepare- ja grant-kohdissa. Muuttunut valinta tai
kutsujan valtuuden menetys estää käynnistyksen eikä kirjoita journalia.

Tämä valtuus koskee vain nykyisen schema-tarkistimen hyväksyttyä
yhteensopivuuspolitiikkaa. Metadataan sidotut historialliset prefixit
toimivat jo tavallisessa tiukassa polussa; metadataa vailla oleva hyväksytty
038-rakenne tarvitsee tämän palautuspoikkeuksen. Schema attestoi edelleen
ennen kirjoitettavaa avausta ja uudelleen samalla kirjoittavalla yhteydellä.
Admissio ei korvaa sisältö- tai PDF-tarkistusta eikä anna tiedostomutaatio-,
terminal- tai siivousvaltuutta. C:n nykyinen ennen migraatioita toimiva
alkuperäisketjun ja sisällön portti säilyy. Oman tavallisen paikalliskannan
hot-journal-poikkeusta ei yhdistetä tähän palautuspolitiikkaan.

Kolme main-kytkennän regressiota toisti historiallisen politiikan hylkäyksen
ennen korjausta. Rajattu desktop-sarja läpäisi 275 testiä viidessä
tiedostossa ilman ohituksia; nykyisen backendin erillinen schema- ja
migraatiokontrolli läpäisi 29 testiä kolmessa tiedostossa. Desktopin
tyyppitarkistus ja build läpäisivät. Kontrollit erottavat muuttuneen
valinnan, prepare-/grant-vaiheen hylkäyksen ja tavallisen käynnistyksen.

Nykyisen oikean backend-/Electron-/inspection-utility-kokeen kuusi
tapausta kattavat nyky- ja 038-kannan kaikissa kolmessa C-tilassa.
Kaikki 24 omistettua lapsiprosessia poistuivat onnistuneesti, varaus
palautui ja alkuperäisketju säilyi ennen binaarihandoffia. Koe mallintaa
journalittoman keskeytystilan hallitusti; se ei todista koko mainin
palautuskytkentää, oikeaa binaariasenninta, Linuxia tai hardened-pakettia.
Rajattu riippumaton diffikatselmus ei löytänyt uutta admissionin tai
prepare-/grant-sidonnan ohitusta, mutta löysi aiemman yhteensopivuusesteen:
rekisteröidyn työtilan W6-valmistelu inventoi kannan ennen tätä admissionia.
Metadataa vailla oleva 038-kanta hylätään tarkoituksellisesti tavallisessa
inventaarion schema-portissa. Mainin rajatut testit ohjaavat W6-valmistelua
mockilla eivätkä todista tämän rajan läpäisyä. V2bh ei siis ole tämän
historiallisen koko startup-polun hyväksyntä.

Oikean 038-fixturen metadataa käyttävä ja metadataa vailla oleva kontrolli
vahvistavat eron: ensimmäinen inventoidaan muuttumattomana, toinen hylätään
ennen identity-lukua ja ilman tiedostomuutosta. Niiden ja nykyisen
schema-avaussarjan 32 testiä kahdessa tiedostossa sekä backendin
tyyppitarkistus läpäisivät. Tämä kontrolli ei hyväksy järjestysmuutosta.

**Omistaja hyväksyi 11.10.2026:** eteenpäin päivityksen uusi W6-inventaario
ja valmistelu rajataan pois vain täsmällisesti valitusta C:n rollback-only-
käynnistyksestä. Hyväksytty rajaus säilyttää olemassa olevan W6-journalin
pakollisen recovery-käsittelyn, build-/registry-hash-todisteet sekä C:n
tuoreen schema-, alkuperäisketju-, sisältö-, artifact- ja soveltuvan lineage-
tarkistuksen. Palautushaara ei saa migroida eteenpäin, hyväksyä targetia,
siirtää passiivista registryä tai avata business-UI:ta. Binaarihandoff vaatii
edelleen varmennetun backendin pysähtymisen. Muuttunut valinta, omistajuuden
ristiriita tai epävarma palautuminen pysäyttää ketjun; siitä ei saa pudota
tavalliseen käynnistykseen. Myöhempi tavallinen forward-startup inventoi
edelleen normaalisti. Nykyinen [W6B-sopimus](windows-installer-and-update-plan.md)
ja [ADR-0011](../decisions/ADR-0011-local-multi-workspace-company-model.md)
päivitetään vastaamaan tätä hyväksyttyä rajattua poikkeusta.
Hyväksytyn valmistelurajauksen toteutus ja sen jälkitarkistus kuvataan
[V2bi:ssä](#v2bi-cn-palautuksen-rajattu-w6-valmistelu). Ensimmäisen ehdokkaan
225 kohdetestin läpäisy ei ole myöhemmän korjatun ehdokkaan hyväksyntä.
Rajattu käynnistysnäyttö, lähdekatselmus ja palautussarjan avoin hylkäys
pidetään erillään. Päätös ja kohdenäyttö eivät yksin hyväksy koko K:ta.
Yllä nimetyt koko K:n hyväksyntäportit säilyvät avoimina.

#### V2bi: C:n palautuksen rajattu W6-valmistelu

Omistajan 11.10.2026 hyväksymä poikkeus erottaa uuden forward-valmistelun
epäonnistuneen päivityksen palautuksesta. Main jäädyttää C-valinnan ennen
W6-valmistelua. Olemassa oleva W6-recovery säilyy; jatkettava `prepared`-
journal varmennetaan edelleen täsmälliseen source/target-buildiin,
active-valintaan ja registry-tiivisteisiin. Vain `coordinatedUpdateTarget`
voi vastaanottaa tämän tuoreen C-valtuuden. `rollbackOnly` ei anna
forward-migraatio-, registry-siirtymä-, target-hyväksyntä- tai UI-valtuutta,
eikä sen jälkeen voi jatkaa tavalliseen päivityksen hyväksyntään.

Sama C-valinta, palautusomistajuus ja hyväksytyn lähdebuildin
versio/revisio/kanava tarkistetaan valmistelun ja backendin prepare-/grant-
kohdissa. Tämä koskee sekä journalitonta C:tä että C:n omaa keskeneräistä
palautusjournalia. Varauksen siirto käyttää olemassa olevan omistajan
vaihekohtaisia tarkistuksia; mainin hallussa olevaa varausta ei vaadita
sen jälkeen, kun siirto on jo alkanut. Schema-, sisältö-, alkuperäisketju-,
lineage- ja backendin pysäytysportit säilyvät ennallaan.

Ensimmäinen riippumaton rajattu katselmus löysi kaksi prepare/grant-
puutetta: omaa palautusjournalia käyttävän C:n guard ja hyväksytyn sourcen
tuoreus. Molemmat toistettiin regressioina ja korjattiin samaan nykyiseen
admission-ketjuun. Saman katselmuskierroksen korjatun diffiehdokkaan
lähdetarkistuksessa ei jäänyt näitä ohituksia. Tyyppitarkistus ja build
läpäisivät. Kuuden tapauksen oikea main-/W6-/Electron-koe kattaa nyky- ja
038-kannan kolmessa C-tilassa: kaikki 24 omistettua lapsiprosessia poistuivat,
mainin varaus vapautui, alkuperäiset tietokanta- ja registry-tavut säilyivät
eikä business-UI avautunut. Kehitysresurssien sijoitus ja binaariasentimen
käynnistys ovat kokeen hallittuja rajoja; tämä ei hyväksy hardened-pakettia
tai oikeaa binaariasenninta.

**Kohdehyväksyntä on avoin:** korjatun ehdokkaan palautussarjassa läpäisi
223 testiä ja neljä testiä ylitti nykyisen testikohtaisen aikarajan.
Niiden jälkeinen siivous epäonnistui myös; siivousvirhe ei korvaa ensivirhettä.
Yksi rajattu saman lähteen diagnostinen uusinta toisti kolme aikakatkaisua
ja läpäisi kaksi kontrollia. Hylkäykset koskevat sekä C:n että tavallisen
palautuksen polkuja, eikä niiden syytä ole vahvistettu. Testiehtoja tai
aikarajoja ei muutettu. Ensivirheet säilyvät, eikä uusinta tai onnistunut
käynnistyskoe hyväksy palautussarjan hylkäystä.
Erillinen yhden synteettisen forward-tapauksen tiedostotyön mittaus osoitti
lyhyiden lukutarkistusten kertautumisen. Se ei ole uusi hyväksyntäuusinta,
kaikkien aikakatkaisujen juurisyy tai lupa poistaa tuoreustarkistuksia.
Rajattu jatkosuunnittelu erottaisi omistajuus-/valintatarkistuksen raskaasta
sisältötarkistuksesta säilyttäen vaaditut julkaisu- ja mutaatiorajat;
tämän vaihtoehdon suunnittelu ja koe odottavat omistajan päätöstä.
Tuotantokytkentä vaatisi ensin sopimuksen ja kilpailuregressioiden todennuksen
sekä katselmuksen. Nykyiset aikarajat ja eheysvaatimukset säilyvät.
Jäljellä olevat raskaat aktiivivalidoinnit, koko K:n palautus- ja
resurssinäyttö sekä PR/main-portit säilyvät avoimina. Niiden eristetyn
käyttötapauksen valmistelu kuvataan [V2bj:ssä](#v2bj-aktiiviprofiilin-eristetyn-tarkistuksen-valmistelu).

#### V2bj: Aktiiviprofiilin eristetyn tarkistuksen valmistelu

**Valmistelu on testattu; tuotantokutsujia ei ole vielä vaihdettu.**
`validateOwnedActiveProfile` käyttää nykyistä `ProfileSnapshotInspectionClient`-
porttia, installation-leasea ja täsmällisen operaation restore-kirjoitussuojaa.
Tavallinen startup vaatii `exactCurrentManifest`-tarkistuksen. Vain erikseen
sidottu C:n ennen-migraatio-palautus käyttää nykyistä `restoreCompatible`-
käytäntöä ja vaatii alkuperäisen ketjun täsmällisen vastaavuuden.
Muodostajan yhteensopivuusvalinta ei ohita backendin jo hyväksyttyä
schema-/katalogikäytäntöä. Uutta protokolla- tai schema-poikkeusta ei lisätä.

Tuloksena annetaan vain muuttumaton validointimetadata; se ei anna
palautus-, julkaisu- tai tiedostopoistovaltuutta. Käyttötapaus kuuluu
startupiin ennen UI:n avaamista. Epäonnistuminen vaatii omistavan kutsujan
hallitun runtime-sulun; helper ei yksin todista runtime-poissaoloa.
Fencen vapautus on viimeinen odotettava työ, ja lopulliset synkroniset
valtuus-/lineage-tarkistukset tehdään ennen installation-leasen vapautusta.
Puuttuva vapautuskuittaus ei ole onnistuminen. Virheessä lease pysyy
varattuna uudelleenkäynnistykseen asti, ja snapshot jää nykyisen asiakkaan
seurantaan; varmennettu asiakkaan shutdown saa siivota vain omistetun kopion.
Epävarma poistuminen tai omistajuus säilyttää aineiston. Myöhäinen vastaus
ei aloita uutta C-tarkistusta aikakatkaisun jälkeen. Ensisyy ja siivousvirhe
säilyvät erillisinä nykyisessä virheketjussa.

Rajattu katselmus löysi valmistelusta neljä korjattavaa valtuus-/cleanup-
kohtaa, jotka korjattiin ja katettiin regressioilla. Korjatun lähteen
90 kohdetestiä, desktopin tyyppitarkistus ja build läpäisivät. Neljän
tapauksen oikea utility-/native-varauskoe todensi nyky- ja metadataa vailla
olevan 038-kannan hyväksynnän sekä väärän ketjun ja muutetun scheman hylkäyksen,
prosessipoistumisen, omistetun siivouksen ja alkuperäisten tavujen säilymisen.
Snapshot-muodostus on tässä kokeessa hallittu; se ei hyväksy todellista
muodostajaa, backendin ennen-migraatio-kytkentää, koko main-startupia,
hardened-pakettia tai Linuxia. Viimeisen rajatun lähdekatselmuksen blocker
poistui, mutta tuotantokytkentä on katselmoimatta.

**Kytkentäeste:** [kokonaiskytkennän tarkistus](#kn-kokonaiskytkennän-tarkistus)
toisti ehdokkaan virheleasen ja rollbackin ristiriidan sekä päivityksen
jo omistaman leasen ristiriidan. Yllä kuvattu helperin virhesopimus ei siten
ole sellaisenaan hyväksytty kaikkien kutsujien sopimukseksi. Ratkaise
kutsujamatriisi ennen tuotantokytkentää; poista korvattu raskas validaattori
vasta vastaavan todellisen kutsujanäytön jälkeen. V2bi:n aikakatkaisut ja
hyväksytyn guard-/sisältötarkistuksen tuotantokytkennän todennus säilyvät
erillisenä avoimena työnä. Nykyisiä aikarajoja, riippuvuuksia, eheysvaatimuksia
tai koko K:n hyväksyntäportteja ei muutettu.

#### V2bg: Aktivoinnin täsmällinen journal ja valtuus

**Rajattu activation-kytkentä; koko K:n hyväksyntä on avoin.** Valmistelu
tallentaa oman jäädytetyn `prepared@0`-kuittinsa ennen journalin julkaisua.
Readback vertaa kaikkia kenttiä tähän kuittiin eikä korjaa sivuslotteja tai
adoptoi pelkän operation-ID:n perusteella löytyvää journalia. Hylätty
kirjoitus voi olla julkaistu: readback tehdään myös hylkäyksen jälkeen,
ensivirhe säilyy ja epävarma tulos säilyttää stagingin recovery-omistuksen.
Vain todistettu journalin ja recovery-juurten poissaolo sallii retentionin
perumisen. Valmistelun alkuperäinen kutsumuoto säilyy sisarkuluttajille.

Transaktion initial-julkaisu vaatii current-, next- ja backup-slottien poissaolon
myös silloin, kun kutsuja ei anna erillistä valtuusfunktiota. Forward-julkaisu
sitoo aina edeltävän journalin ja oman uuden slotin jokaiseen julkaisuvaiheeseen;
kutsujan mahdollinen valtuus täydentää tätä sidontaa, ei kytke sitä päälle.
Vierasta sivuslottia ei
poisteta julkaisemisen tieltä. Julkaisun jälkeinen hylkäys säilyttää
palautusaineiston; se ei anna lupaa journalin takaisinpäinkirjoitukseen.
Tämä käyttää nykyistä installation-/writer-omistajuutta, eikä ole lupaus
käyttöjärjestelmätason compare-and-swapista tai suojasta saman tilin haittaohjelmaa vastaan.

Main välittää C:n täsmällisen update-valinnan activation-palveluun.
Live-valmistelu käyttää restore-maintenance-fenceä. Vasta varmennettu
runtime-stop sallii tiedostosiirrot; sen jälkeen omistajuus varmennetaan
mainin palautuneesta työtilavarauksesta, ei suljetun brokerin kutsulla.
Tavallisen jo käynnistyneen sovelluksen valtuus on sen elävän runtimen ja
single-instance-omistuksen valtuus, ei päättyneen startupin valtuus.
Aloitettu runtime-shutdown estää tämän polun.

Oman tavallisen forward-virheen jälkeen rollback saa vain täsmällisen
etenemän: operaation ja alkuperäisslottien liput säilyvät, revision ero
vastaa kanonisten forward-vaiheiden eroa ja tuore slot-census täsmää.
Sama matcher palvelee nykyistä startup-virhehaaraa; rinnakkaista
palautusjärjestelmää ei lisätä. Valinnan tai valtuuden menetys säilyttää
aineiston eikä anna kompensaatiolupaa. Alkuperäinen virhe ja mahdollinen
rollback-virhe pysyvät erillisinä. Cold-forward ei saa automaattista
rollbackia tämän live-kytkennän perusteella.

Todennus kattaa journalin julkaisun rajat, täsmällisen readbackin,
alkuperäisen syyn ja retentionin, oikean tiedostotransaktion keskeytyksen
ja sidotun rollbackin sekä tavallisen runtimen valtuuden startupin jälkeen.
Erillinen neljän tapauksen Electron-koe käyttää oikeaa business-backendiä,
inspection-utilitya, journalia ja varausluovutusta sekä valmiissa että
migraatiota odottavassa runtimessa. Kummankin onnistuva forward ja oman
keskeytyksen rollback erotetaan. Tämä ei todista koko mainin historiallista
journalitonta policy-valintaa, binaarihandoffia, Linuxia, hardened-
palautusta tai lopullista PR/main-integraatiota. Nämä säilyvät seuraavina
K-portteina, samoin vanhan raskaan aktiivivalidoinnin siirto nykyiseen eristettyyn porttiin.

Katselmuksessa löytynyt oletuskutsun julkaisun ohitus toistettiin ennen
korjausta sekä initial-sloteilla että muuttuneella forward-edeltäjällä.
Pelkkä sama operation-ID ei hyväksy muuttuneita alkuperäisslottien lippuja.
Nykyiset korvaus- ja migraatiokutsumuodot säilyvät tämän yhteisen suojan takana.
Ensivirheen järjestystä testaava readback-häiriö sidotaan forward-kutsun
todelliseen hylkäykseen, ei journalin vaiheeseen, joka näkyy jo julkaisun
jälkitarkistuksessa.

Lopullinen rajattu kohdekierros läpäisi 583 testiä kahdeksassa tiedostossa
ilman ohituksia; desktopin tyyppitarkistus ja build läpäisivät. Mukana ovat
korvauksen ja migraation nykyiset sisarkutsujat. Riippumaton rajattu katselmus
ja sen saman kierroksen korjausreadback eivät löytäneet jäljellä olevaa
ohitusta tai uutta regressiota tarkistetusta diffistä. Neljän prosessitapauksen
kaikki kahdeksan lapsiprosessia poistuivat onnistuneesti ja varaus palautui.
Kohdenäyttö ei korvaa tämän osion yllä nimettyjä koko K:n hyväksyntäportteja.

#### V2bf: Journalittoman C:n valinnan jatkuminen

**Rajattu käynnistys- ja staging-sidonnan checkpoint.** Sen activation-
jatko on [V2bg](#v2bg-aktivoinnin-täsmällinen-journal-ja-valtuus); koko K on avoin.
Main välittää alussa valitun update-journalin myös journalittomaan
`startIfRequired`-kutsuun. Eksplisiittinen poissaolo ei löydä uutta
operaatiota; luku ei korjaa sivuslotteja. Käynnistystulos sisältää saman
jäädytetyn journalin tai vain tämän oman täsmällisen starting-seuraajan.
Main käyttää tätä kuittia loppuvalidoinnissa eikä tee uutta valintaa.
Myös jo valmistunut journal säilyttää täsmällisen sidonnan ilman uutta
starting-kirjoitusta. Tilan, revision, operaation, palautuspisteen tai
samaversion pakettitiivisteen tai koon muuttuminen hylätään.

Starting- ja failed-safe-julkaisu käyttää nykyistä exact-selection-guardia
sekä mainin synkronista omistajuustarkistusta. Alkuperäinen palautusvirhe
säilyy ennen mahdollista journalin lisävirhettä. Valinta tarkistetaan
stagingin jälkeen ennen activation-kutsua. Kesken muuttunut valinta estää
tämän handoffin. Tämä alkuperäinen rajaus ei vielä suojannut activation-transaktion
sisäisiä journal-kirjoituksia tai poista sen omaa journal-valinnan aukkoa.
Tavallisen palautuksen kutsusopimus, turvallinen julkinen tapahtuma ja
hyväksyntäehdot säilyvät. Uutta loggeria, manageria tai riippuvuutta ei lisätä.

Korjatun checkpointin 437 kohdetestiä kuudessa tiedostossa, desktopin tyypit
ja build läpäisivät. Tavalliset journalittomat starting-/completed-kontrollit ja
vanhan palautusketjun regressiot säilyvät. Erillinen oikean backendin
neljän tapauksen koe todensi sidonnan restore-journalin poistumisen jälkeen
nyky-/038-aineistolla, mukaan lukien samaversion pakettikoon muutos.
Kaikki 20 omistettua lapsiprosessia poistuivat ja varaukset palautuivat.
Tämä koe antaa historiallisen restore-policyn eksplisiittisesti; se ei
vielä todista koko mainin historiallista journalitonta käynnistysvalintaa.
Katselmuksen löytämä väärä guarded-rollback-kutsu poistettiin ehdokkaasta;
se ei jää osaksi toteutusta. Tarkka palautusjournalin valinta ja valtuuden
säilyminen initial-/forward-julkaisun sisäisten awaitien yli olivat tämän checkpointin avoin jatko.
Ne vaativat oikean transaktion virhe- ja rollback-todisteen, eivät pelkkiä
service-mockeja. Nykyistä palautuspalvelua ei muutettu tässä checkpointissa.
Ennen backendin avausta vaadittava historiallisen journalittoman jatkon
policy-valinta, vanhan raskaan aktiivivalidoinnin siirto eristettyyn
tarkistukseen sekä lopullisen binary-handoffin sidonta ovat edelleen
avoimia. Activationin exact-journal- ja julkaisusopimuksen jatko on V2bg.
Tavallisen käynnistyksen schema-rajaa ei tämän työn perusteella
löysennetä. Koko mainin, Linuxin, suuren katalogin resurssipolun, hardened-
palautuksen, loppukatselmuksen ja PR/main-porttien näyttö vaaditaan erikseen.

#### V2bd: Tarkistusvirheen jälkeinen rollback-valtuus

**Rajattu palautuksen virhehaaran kytkentä; koko K:n hyväksyntä on avoin.**
Epäonnistunut profiilitarkistus pysäyttää ensin omistetun backendin.
Main varmentaa myös tarkistusprosessien sulkemisen ja työtilavarauksen
palautumisen ennen tuoretta alkuperäissisällön tarkistusta. Sama nykyinen
alkuperäisinspektori, maintenance-lease sekä paikallaan pysyvän ankkurin ja
siirtyvien juurten native-varaukset palvelevat kylmäkäynnistystä ja tätä
virhehaaraa; uutta palautus- tai tarkistusjärjestelmää ei lisätä.

`validationStarting@r` voi edetä vain saman operaation
`rollbackStarting@r+1`- ja `rolledBack@r+2`-tiloihin. Alkuperäinen sisältö,
journal ja varaukset tarkistetaan ennen korjaavaa journal-lukua,
rollback-intentin julkaisua ja tiedostosiirtoja. Ennen intentiä alkuperäiset
slotit ovat rollback-juuressa tai journalin mukaisesti poissa; siirtoja ei
saa jo olla tehty. Tarkistusankkurin luominen ei yksin anna mutaatiolupaa.
Lykätty päätös käyttää samaa recovery-instanssia eikä nollaa sen tilaa
uudella startup-valmistelulla. Aloitettu tai epävarma hyväksyntä estää
rollbackin. Alkuperäiskannan poissaolo ei valtuuta tyhjän business-kannan
luontia. Ensivirhe ja rollback-/sulkuvirhe säilyvät erillisinä.
Puuttuva rollback-valtuus hylätään myös suorassa startup-kuluttajassa;
valtuudeton fallback ei korvaa tuotannon kytkentää. Valtuuden voimassaolo
tarkistetaan uudelleen viimeisen asynkronisen journal-lukemisen jälkeen.

Molemmat mainin palautuskuluttajat käyttävät tätä valtuutta. Hylätty valtuus
estää myös yleisen työtilapalautuksen kautta tapahtuvan uuden runtimen
valinnan. Myös onnistunut tiedostorollback, joka palauttaa alkuperäiskannan
poissaolon, lukitsee tämän yleisen runtimen palautuspolun; yritysrekisteri
ja journal säilyvät selvitystä varten. C:n ennen migraatioita toimiva virhehaara tarkistaa lisäksi saman
jäädytetyn update-journalin valtuuden odotusten ja sisältötarkistuksen yli.
Tämän jälkeinen valmistumis- ja virhekirjoituksen sidonta on toteutettu
rajatusti [V2be:ssä](#v2be-cn-business-valmistumisen-journal-sidonta).
Journaliton jatko ja koko palautusketjun hyväksyntä ovat edelleen avoinna.

Kohderegressiot kattavat alkuperäissisällön hylkäyksen, vanhentuneen
journalin tai sisällön, pysäytysvirheen, täsmällisen revisioetenemän ja
normaalin palautumisen. Kuuden tiedoston kohdesarja läpäisi 428 testiä ilman
ohituksia. Katselmuksen kolme rajattua havaintoa toistettiin ennen niiden
korjausta; ensihylkäykset säilytettiin. Oikean utility-/native-ketjun neljä tapausta
kattavat molemmat palautuslayoutit sekä nykyisen ja historiallisen 038-
aineiston; 14 poistumista ja varausten palautumista varmennettiin.
Tässä prosessikokeessa business-backendin pysäytys on kontrolloitu,
ei koko mainin tai paketoidun sovelluksen todiste. Composition-testit
todentavat erikseen molemmat kuluttajat sekä C:n virhehaaran ja
update-journalin muutoksen. Hardened-paketti, Linux, suuren katalogin
resurssinäyttö, loppukatselmus sekä PR/main-portit säilyvät avoimina.
Desktopin tyyppitarkistus ja build läpäisivät korjatulla lähteellä.
Rajattu riippumaton jatkokatselmus vahvisti kolmen havainnon korjaukset;
niihin ei löytynyt uutta konkreettista regressiota. Korjattu build toisti
yllä kuvatun neljän utility-/native-tapauksen näytön. Tämä katselmus ja
prosessikoe eivät korvaa koko K:n loppukatselmusta tai paketoitua ajoa.

#### V2bc: C:n alkuperäisketjun terminal

**Rajattu ennen migraatioita toimiva kohdenäyttö; koko C/K-kytkentä on kesken.**
C:n `businessRollbackStarting`- ja restore-journalin valinta sidotaan
täsmälliseen operaatiopariin. Käynnistysinspectionin on osoitettava olemassa
oleva kanta ja journalin alkuperäinen `preUpdateMigrationChainIdentity`
ennen palautuksen hyväksyntää tai siivousta. Jäädytetty update-journal
sisältää myös paketti-identiteetit; muutos async-tarkistuksen aikana estää
terminalin. Jo hyväksytty restore-journal saa saman erillisen C-jatkon eikä
hyväksyttyä sisältöä palauteta takaisin siivouksen epäonnistumisen vuoksi.

Tavallinen live-terminal käyttää edelleen `exactCurrentManifest`-policya.
C käyttää eristetyn tarkistimen olemassa olevaa `restoreCompatible`-policya
sekä täsmälleen journalin alkuperäistä ketjua, ei mielivaltaista prefixiä.
Clientin nimenomainen `createRestoredProfileSnapshot` vaatii saman operaation
restore-kirjoitussuojan sekä voimassa olevan kanavan ennen ja jälkeen
odotuksen. Brokerin snapshot-pyyntö käyttää entistä
`compatibleHistoricalPrefix`-arvoa; protokollaa ei laajenneta. Snapshotin
luontipolicy ja tarkistimen policy pidetään erillisinä ja receipt sidotaan
juuri valittuun tarkistuspolitiikkaan. Tavallinen snapshot-kutsu ei hyväksy
restore-policya eikä heikompaa kuittia.

Backendin aktiiviprofiilin ja snapshot-katalogin schema-reader käyttää
palautuksen jo hyväksyttyä käynnistyspolicya vain `beforeMigrations`-gaten
aikana. Gaten päättyminen palauttaa tiukan policyn myös virheessä. Portti
ei luo legacy-metadataa tai aja migraatioita; tavallisen business-käynnistyksen
nykyisen historian ja nolla-pending-tarkistus säilyy. Muuten metadataa vailla
oleva kelvollinen 038-kanta hylkäytyisi tämän lukijan kautta, vaikka kylmä
palautus ja ensimmäinen käynnistysinspection olisivat hyväksyneet sen.

Kohdesarja läpäisi 237 desktop-testiä viidessä tiedostossa ja erillinen
backend-sarja 24 testiä kolmessa tiedostossa ilman ohituksia. Molempien
alueiden tyyppitarkistukset ja build läpäisivät. Composition-regressiot
kattavat tavallisen ja accepted-C-jatkon, alkuperäisketjun poikkeaman ja
update-journalin muutoksen odotuksen aikana. Backendin reset-kontrolli käyttää
samaa kelvollista metadatatonta 038-schemaa ennen gatea ja sen päätyttyä,
eikä vain poistettua metadataa nykyisestä schemasta.
Rajattu riippumaton katselmus tarkisti C-kytkennän, snapshot-clientin
policy-/kanava-/valtuusrajat ja backendin policy-resetin. Katselmuksen
löytämä liian heikko reset-testin loppukontrolli korjattiin ja tarkistettiin
uudelleen. Lopullisessa rajatussa jälkikatselmuksessa ei löytynyt uusia
korjattavia puutteita; tämä ei ole koko K:n loppukatselmus.

Kaksi normaalia ja kaksi jo hyväksytyn osittaisen siivouksen tapausta
läpäisivät oikean backendin käynnistysgaten, snapshot-brokerin, eristetyn
tarkistimen ja native-varaukset. Nykyinen ja metadataa vailla oleva 038-kanta
katettiin; kaikki 20 utility-/backend-poistumista ja varausten palautumiset
varmennettiin. Business-palautuksen valmistuminen ja startupin hallittu
pysäytys toteutuivat ennen eteenpäin vieviä migraatioita. Accepted-koe alkaa
synteettisestä jo hyväksytystä tilasta, ei todellisesta kaatumisesta.
Kaksi policy-hylkäystä paljastivat yllä korjatut lukuketjujen erot;
accepted-kokeen erillinen fixture-hylkäys johtui peittyneestä tilalipusta.
Ensihylkäykset säilytettiin eikä tuotannon hyväksyntäehtoja lievennetty.

Näyttö yhdistää oikeat C-palvelut ja backendin gaten, mutta ei ole koko mainin
tai oikean binaariasentimen koe. Mainin composition-testi käyttää
kontrolloitua inventory-valmistelua ja binaarihandoffia. V2bc:n jälkeen
epäonnistuneen live-validoinnin rollback-valtuus on kytketty [V2bd:ssä](#v2bd-tarkistusvirheen-jälkeinen-rollback-valtuus).
Update-valinnan valmistumiskirjoitus on tämän jälkeen rajatusti kytketty
[V2be:ssä](#v2be-cn-business-valmistumisen-journal-sidonta). Journaliton jatko ja
jäljellä olevien raskaiden aktiivisten validatorien siirto eristettyyn porttiin
säilyvät seuraavina töinä. Linux,
suuren katalogin terminal-resurssinäyttö, hardened-paketti ja PR/main-portit
pysyvät avoimina. Tämä checkpoint ei sulje S030-01/S030-02:ta tai koko K:ta.

#### V2ay: C:n palautuskutsujan sisäinen ensisyy

**Rajattu K3-korjaus työpuussa; ei offline- tai terminal-hyväksyntä.**
`UpdateBusinessRollbackCoordinator` säilyttää aktivoinnin tai palautetun
profiilin tarkistuksen alkuperäisen poikkeuksen sisäisen `Error.cause`-
sidonnan kautta. `failedSafe`- tai `recoveryRequired`-journalin lisävirhe
säilyy erillisessä järjestetyssä haarassa eikä peitä ensivirhettä tai estä
turvallisen failure-tapahtuman yrittämistä. Restore-transactionin tekemän
rollbackin jälkeinen journalivirhe säilyy saman yleisen recovery-virheen
sisäisenä syynä. Kirjoituksen epäonnistuminen ei todista durable-tilasiirtymää.
Ulompi viesti, update-tapahtumien yleiskoodi, hyväksyntäjärjestys ja
onnistuneen palautuksen käytös eivät muutu. Raakaa syyketjua ei julkaista.

Yhdeksän uutta regressiota toisti puutteen ennen korjausta. Lopullinen
227 testin kohdesarja yhdeksässä tiedostossa sisältää koordinaattorin
19 testiä ja säilytti myös live-palautuksen, startup-compositionin ja
nykyiset päivityspolut. Katselmuksen testitäsmennys tarkistaa alkuperäiset
olioviitteet, hyväksyntäjournalin kirjoitusvirheen sekä onnistumisen
observerhäiriöstä huolimatta. Tuntematon ensisyy ei luokitu lisävirheen
perusteella. Tyyppitarkistus, desktop-build ja rajattu riippumaton katselmus
läpäisivät. Todellisen journal-kirjoituksen osittainen onnistuminen ei saa
erillistä näyttöä näistä kontrolloiduista porteista. Kohdetuloksia ei summata
V2aw:n tai aiempien K-vaiheiden hyväksyntänäytöksi.

**C:n seuraavan kytkennän nykyinen lähdereitti:** main kokoaa palautuspisteen
staging-palvelun ja aktivointipalvelun samoihin omistajiin kuin muu palautus.
`beforeMigrations` kutsuu business rollback -koordinaattoria; stagingin
onnistuminen ei hyväksy palautusta. Palautetun profiilin erillinen
sisältö-/chain-tarkistus vaaditaan ennen `businessRollbackCompleted`-tilaa,
startup-backendin sulkua ja binaaripalautuksen omistajan kutsua. Nykyinen
broker- ja tarkistusclient-kytkentä ei itsessään todista K:n cold/offline-
mutaatiovaltuutta. Valittu update-journal, restore-journal, tuore valtuus ja
todellinen exit/reclaim pitää todistaa tämän callerin kautta. Älä korvaa
pending-startupin nimettyä sulkua valmiin backend-kahvan sululla tai rakenna
rinnakkaista schema-/PDF-validointia. V2ax:n avoimet päätökset, oikean
palautusketjun näyttö ja koko K:n hyväksyntäportit säilyvät.

#### Muut avoimet K-päätökset

Omistaja hyväksyi 10.10.2026 alla olevat kolme rajattua tuotantopäätöstä.
Päätösportit ovat ratkaistut; niiden toteutus ja hyväksyntänäyttö eivät vielä
ole valmiit. Aiempi tarkistuskopion tai käännöskokeen lupa ei yksin hyväksynyt
niitä. Yllä oleva paikallisen hot-journal-palautuksen poikkeus säilyy erillisenä
tuodun varmuuskopion tarkistuksesta.

**Julkaistun kohteen hyväksytty rajaus:** ADR-0011:n nykyinen `invalidHistory`
voi johtaa passiivisen yrityksen registry-siirtymään `recoveryRequired`.
Kun koko schema/history ei ole luotettu, identityä ei voida lukea ensin
vain tämän luokituksen säilyttämiseksi. Omistaja hyväksyi rajatun
fail-closed-vaihtoehdon: tällainen hylkäys keskeyttää koko inventaarion ennen
registry-muutosta; todennetun scheman sisältövirhe säilyttää entisen
luokituksen. Tiedostot säilytetään; yhden epäluotettavan työtilan vuoksi
normaali käynnistys voi estyä selvitykseen asti. Kytkentä ja ADR:n vastaava
tarkennus on toteutettu [V2t:ssä](#v2t-inventaarion-suljettu-virhepolku);
sen kohdenäyttö ei hyväksy koko K:n integraatiota.

**K-P2:n hyväksytyn runtime-päätöksen peruste:** nykyisen lukitun `better-sqlite3`-ajurin
`SQLITE_DEFAULT_MEMSTATUS=0` poistaa muistiseurannan oletuksena. Erillinen
synteettinen prosessikoe osoitti, ettei positiivinen `hard_heap_limit`-
readback yksin todista valvontaa. Tämä vastaa [SQLiten dokumentoimaa
rajoitusta](https://www.sqlite.org/c3ref/hard_heap_limit64.html).
Valmisteltu utilityn alustustarkistus hylkää tämän ajurin ennen tuodun
tietokannan avausta; sitä ei ole kytketty nykyiseen aktiiviseen backendiin.
Hylkäysregression läpäisy ei ole hyväksytyn muistibudjetin läpäisy.
Ennen K2:n sulkemista tarvitaan hyväksytty toteutustapa ja sekä rajan ylityksen
torjunta että tavallisen aineiston läpäisy oikeassa paketoidussa runtimessa.
Omistaja hyväksyi 9.10.2026 rajatun, eristetyssä koekansiossa tehtävän saman
`better-sqlite3@13.0.2`-version käännös- ja muistirajakokeen. Koe muuttaa vain
muistiseurannan käännösasetusta ja käyttää synteettistä aineistoa. Lähteen
eheys, todellinen rajan ylityksen torjunta ja normaalin kyselyn läpäisy
varmennetaan erikseen. Hyväksyntä ei anna lupaa korvata nykyistä
esikäännettyä ajuria, asentaa uusia järjestelmätyökaluja tai kasvattaa budjettia.
**Rajattu koenäyttö (9.10.2026):** saman ajuriversion muistiseurannalla
käännetyn ehdokkaan kontrollitapaukset läpäisivät sekä Node-prosessissa
että Electron-utilityssa. Hyväksytyn SQLite-muistirajan ylitys torjuttiin
`SQLITE_NOMEM`-virheellä; normaali synteettinen vain-luku-kontrolli läpäisi
myös ylitysyrityksen jälkeen. Todellinen utility-exit todennettiin.
Koe ei korvannut projektin ajuria, manifestia tai lukitusta.

Tämä kohdenäyttö ei todista koko prosessin RSS-kattoa, kaikkien tuettujen
profiilien läpäisyä, Linux-vastinetta tai hardened-paketin hyväksyntää.
Tuotantotapa hyväksyttiin erikseen 10.10.2026: tarkistusajurin rajaus ja toimitus,
toistettava käännös, eheyssidos, ylläpito sekä nykyiset paketti-/runtime-/
yhteensopivuusportit ovat alla olevan toimitussopimuksen mukaiset.
Kokeen lupa ei hyväksy aktiivisen business-ajurin vaihtamista tai
muistibudjetin kasvattamista. Kokeen tulos ja tuotantotavan päätös
pidetään erillisinä; ensimmäinen epäonnistuminen säilytetään erillään
myöhemmästä hyväksytystä kohdenäytöstä.
Utility, varausluovutus, broker-v10, V2c ja packaged-/PR-/main-portit ovat
edelleen avoinna. Kokonaisuutta ei julkaista tässä välitilassa.

#### K-P2:n tarkistusajurin toimitusehdotus

**Hyväksytty tuotantorajaus 10.10.2026; toteutus ja portit avoinna.** Sopimus koskee
vain K-P2:n lyhytikäisen tarkistusutilityn SQLite-ajuria. Nykyinen
`better-sqlite3@13.0.2`, Electron, tietokantamalli, backup-formaatit ja
aktiivisen business-runtimen oletusajuri säilyvät. Nykyinen
[prebuild-paketointisääntö](local-desktop-dependency-review.md#electron-43-ja-better-sqlite3)
säilyy business-ajurille. Omistajan hyväksymä poikkeus sallii vain alla
olevan erillisen tarkistusajurin käännöksen ja toimituksen. Uusia
järjestelmätyökaluja ei asenneta tällä luvalla.

1. **Lähde ja käännös.** Käytä saman lukitun ajuriversion eheydellä
   varmennettua upstream-lähdettä sekä nykyistä hyväksyttyä addon-api-lähdettä
   erillisessä build-kansiossa. Ainoa tarkoitettu lähdepoikkeama on
   `SQLITE_DEFAULT_MEMSTATUS=1`. Lukitse käännöksen syötteet, rajattu patch,
   kohdealusta ja työkaluketju sekä tallenna syntyneen tiedoston koko ja
   tiiviste build-todisteeseen. Kääntäjän metatieto voi erota upstream-
   prebuildistä; ero nimetään eikä väitetä kaikkien asetusten tai binääritavujen
   olevan samoja. Ei pnpm-varaston muokkausta, lifecycle-asennusta,
   C++-forkkia, `prebuild-install`-palautusta tai loppukäyttäjän koneella
   tehtävää käännöstä. Puuttuva käännöstyökalu on uusi päätösportti.
2. **Toimitus ja alkuperä.** Erillinen inspection-native-tiedosto sijoitetaan
   vain buildin omistamaan tarkistusresurssiin; se ei korvaa paketin
   `prebuilds`-tiedostoja. Main ratkaisee kiinteän tarkistusentrypointin ja
   ajuripolun omasta varmennetusta resurssijuurestaan. Backendin nykyiset
   build-metadata- ja paketti-inventaariotyökalut laajennetaan kattamaan
   tarkistusresurssin alkuperä, kohdealusta, koko, tavut ja erillinen vastuu.
   Resurssin mukana ei toimiteta build-työkaluja, lähdearkistoa, profiilia
   tai kokeen tietokantoja. Native-tiiviste todistaa tavujen sidonnan,
   ei julkaisijan luottamusta. Yksi testattu output säilyy samoina tavuina
   seuraaviin pakettiportteihin asti.
   Kääntäjän omistettu välituote kopioidaan ennen latausta yksilinkkiseksi
   erilliseksi tiedostoksi. Mahdollinen kääntäjän sisäinen linkkipari
   varmennetaan täsmällisinä niminä ja identiteetteinä ennen ja jälkeen
   kopioinnin; tuntematon linkki ei ole poikkeus toimitusrajaan.
3. **Lataus ja kaikki yhteydet.** Nykyisen ajurin oma `nativeBinding`-
   rajapinta sallii erillisen tiedoston latauksen muuttamatta oletusajuria.
   Tarkistusutilityn rajattu yhteydenluonti käyttää tätä valintaa pakollisesti:
   budjettia alustava muistiyhteys, tuodun kannan readonly-yhteys ja luotetun
   migration-scheman muistiyhteys käyttävät samaa valvottua ajuria. Nykyiset
   `profileInspectionSqlite.ts`, `inspectStagedProfileSnapshot.ts`,
   `inspectSqliteProfileDatabase.ts` ja `migrationSchemaReference.ts`
   tarkistetaan tämän yhteydenluonnin kuluttajina. Pelkkä ensimmäisen
   yhteyden vaihto ei riitä. Utilityssa ei sallita oletusprebuild-fallbackia;
   business-runtimen composition ja ajurivalinta eivät muutu. Tuotu aineisto,
   renderer tai broker-pyyntö ei valitse executablea, ajuripolkua tai
   käännösasetuksia.
4. **Rajan toiminta ja omistajuus.** Varmenna ajurin identiteetti ja
   muistiseuranta ennen tuodun tiedoston avausta. SQLite-rajan readback sekä
   todellinen ylitysvirhe ovat eri todisteet. Säilytä K-P2:n 256 MiB SQLite-,
   512 MiB V8-, 35 000 ms työ- ja nykyiset sulkubudjetit. V8/SQLite eivät
   todista koko prosessin RSS-kattoa. Varausluovutus, yksi terminal,
   havaittu exit ja mainin palautunut varaus vaaditaan edelleen ennen
   tuloksen hyväksyntää, cleanupia tai uudelleenkäyttöä. Ajurin vaihtaminen
   ei itsessään korjaa näitä prosessiehtoihin liittyviä puutteita.
5. **Pienin toimitustodistus.** Testaa puuttuva, väärän alustan tai
   ristiriitainen ajuri sekä oletusfallbackin esto; nämä eivät avaa tuodun
   kannan tiedostoa. Todista erillisessä oikeassa utilityssa budjetin
   ylityksen torjunta ja nykyisen sekä tuetun historiallisen synteettisen
   profiilin läpäisy samalla ajurilla. Varmenna readonly, kaikki omistetut
   sulut/exit, lähteen muuttumattomuus sekä aktiivisen backendin normaali
   luku/kirjoitus muuttumattomalla ajurilla. Windowsin paketoitu output ja
   nykyinen Linux-CI tarvitsevat kumpikin oman lähde-/ajuri-/runtime-
   todisteen; Windows-koe ei hyväksy Linuxia. Sen jälkeen vaaditaan K:n
   kuluttajamatriisi, hardened backup -> inspect -> restore -> restart ->
   compare, riippumaton katselmus sekä täsmällisen revision PR/main-portit.

**Ylläpitoraja.** Ajuriversion tai lähdeasetusten myöhempi muutos avaa tämän
rajatun native-todennuksen uudelleen. Ei lupa päivittää muita riippuvuuksia,
nostaa rajoja tai jättää epäluotettua SQL:ää aktiiviseen backendiin. Lähde-
ja toimitusrajaus sekä tarvittava dokumentointipoikkeus on hyväksytty;
nykyisiä dependency-, runtime- ja testausohjeita päivitetään toteutuksen
mukana vain hyväksytyltä osalta. Hot-journal-palautus ja julkaistun kohteen
schema-hylkäyspolitiikka ovat erikseen hyväksyttyjä, mutta niiden toteutus
ja regressiotodennus pysyvät omissa paloissaan.

Tämä osio tarkentaa roadmapin K:ta, ei luo
rinnakkaista työjonoa.

| Raja | Nykyinen lähde ja valmisteluhavainto | Korjauksen vaatimus |
| --- | --- | --- |
| K1 / S030-01 | Backendin `inspectSqliteProfileDatabase.ts` tarkistaa eheyttä, viitteitä ja migration-historiaa, mutta ei vertaa kannan todellisia objekteja ja SQL-määrittelyjä hyväksyttyyn schemaan ennen business-relaatioiden lukemista. | Todennetaan versionmukainen schema ennen epäluotettuja relaatiokyselyitä, kirjoitettavaa avausta tai migraatiota. Salattu container, checksum, readonly ja migration-ledger eivät yksin täytä tätä rajaa. |
| K1:n muut kuluttajat | Import ja korvaus käyttävät `runWorkspaceCandidateOperation.ts`:n kopioitua, kirjoitettavasti avattua kantaa. Julkaistun kohteen tarkistus sekä `app.ts`:n palautuskäynnistys tarvitsevat oman kattavuutensa. | Pelkkä Inspectin helperin muutos ei sulje K1:tä. Todiste sidotaan tarkistettuihin tavuihin myös uudelleenavauksen, kopion, migraation ja julkaisun yli; nykyiseksi migroitunut rakenne tarkistetaan uudelleen. |
| K2 / S030-02 | Tavallisen Inspectin `stageValidatedProfileBackup.ts` kutsuu private brokeria; `app.ts` kytkee `StagedProfileSnapshotValidationService`-palvelun aktiiviseen backendiin. Sen SQLite-tarkistukset ovat synkronisia. `ProfileSnapshotBrokerClient`-aikakatkaisu poistaa odottajan, ei keskeytä kyselyä. | Epäluotetun tarkistuksen työ eristetään business-runtimesta. Wall-clock-, resurssi- ja tulosrajat sekä todettu prosessin päättyminen ovat eri velvoitteita. |
| K2:n siivous | Inspectin ja stagingin virhepolut poistavat tarkistustiedostoja; broker-vastauksen aikakatkaisu ei itsessään todista niiden käyttäjän päättymistä. | Sama operaation omistaja todistaa tarkistusprosessin päättymisen ennen cleanupia tai uudelleenkäyttöä. Ensivirhe ja siivoustulos säilyvät erillisinä; epävarma siivous säilyttää aineiston. |

#### K:n toteutussopimus: rakenne ennen sisältöä

**Hyväksytty K-P1 (9.10.2026).** Backendin database/infrastructure omistaa yhden
schema-tarkistuksen. Se muodostaa odotusrakenteet tyhjään muistissa olevaan
tietokantaan sovelluksen omasta, muuttumattomasta SQL-manifestista ja
`migrationMetadata.ts`:n omistamista teknisten taulujen määrittelyistä.
Tuodun kannan SQL:ää ei suoriteta odotusrakenteen muodostamiseksi.
Migraatioita ei kopioida käsin toiseen DDL-luetteloon. Ei uutta SQL-parseria,
riippuvuutta, business-migraatiota, backup-formaattia tai tuodun kannan
uudelleenrakennusta. Odotuskanta on hetkellinen tekninen apu, ei uusi
varmuuskopioitava business-artifacti.

Tarkistusjärjestys on seuraava:

1. Validoi omistettu tiedosto ja juuren identiteetti nykyisillä path/type/link-
   säännöillä. Avaa tarkistettava SQLite vain lukuun. Ota `trusted_schema=OFF`
   ja `query_only=ON` käyttöön ennen tietokantarelaatioiden kyselyjä;
   laajennuksia tai tuotuja SQL-funktioita ei rekisteröidä.
   Ainoa tätä avausta edeltävä kirjoittava poikkeus on erikseen hyväksytty
   [oman paikallisen työtilan natiivi kaatumispalautus](#v2u-omistetun-paikallisen-työtilan-kaatumispalautus).
   Tuotu backup tai staging ei saa poikkeusta.
2. Lue ensin vain rajattu `main.sqlite_schema`-inventaario. Varmista ledgerin
   ja mahdollisen metadata-taulun todellinen rakenne ennen niiden rivejä.
   Rivi- ja merkkijonobudjetit johdetaan luotettujen odotusrakenteiden
   enimmäiskoosta; ylimääräinen rivi tai liian suuri määrittely hylätään
   ennen suurten arvojen materialisointia. Ei rajaamatonta `.all()`-lukua.
3. Tarkista ledgerin ja metadatan rajatut rivit nykyisellä manifesti- ja
   prefix-sopimuksella. Kutsuja valitsee yhteensopivuuspolitiikan, ei backup.
   Vertaa sitten koko objektijoukko valitun hyväksytyn prefixin rakenteeseen.
4. Vertaa täsmällisesti `type`, `name`, `tbl_name` ja SQLiten tallentama `sql`.
   Fyysinen `rootpage` ei ole sama asia kuin looginen schema eikä sitä
   verrata. SQLite-autoindeksien `sql=null` on sallittu vain vastaavan
   luotetun objektin kohdalla. `sqlite_*` ei ole yleinen ohituslista.
   Ylimääräinen tai puuttuva table/index/trigger/view sekä muutettu SQL
   hylätään; nykyinen tuotantoschema ei tarvitse view- tai virtual table
   -poikkeusta. Litteraaleja, ehtoja, lainausmerkkejä tai välilyöntejä ei
   normalisoida arvaamalla. Historiallinen esitystapa hyväksytään vain
   luotettuun julkaisuun sidotulla erikseen todennetulla vastineella.
5. Vasta tämän jälkeen tehdään nykyiset integrity-, foreign-key-, identity-,
   moduulisisältö- ja artifact-tarkistukset. FK-virheistä riittää ensimmäinen
   rajattu havainto. Katalogin SQL-rivit ja niiden tekstikentät rajataan
   ennen materialisointia; nykyiset PDF-tavu-, hash- ja kokotarkistukset
   säilyvät. Schema-todiste ei korvaa sisältövalidointia.

SQLiten oma [schema-taulu](https://www.sqlite.org/schematab.html) on
inventaarion lähde, ei todiste luottamuksesta. `trusted_schema=OFF` on
[lisäsuoja](https://www.sqlite.org/security.html), ei korvaava
trigger-/constraint-vertailu. Kaikkien triggerien poistaminen olisi väärin:
ALV-, maksu-, numerointi- ja revisioguardien on säilyttävä.

**Historiallinen yhteensopivuus.** Nykyinen manifesti on 001-039.
Metadatallinen täsmällinen prefix voi läpäistä migration-historian, mutta
profiilin hyväksyntä tarvitsee edelleen käyttötapauksen identity- ja
artifact-sopimukset. `exactCurrentManifest`-nimi ei yksin kerro, vaatiiko
kutsuja kaikki nykyiset migraatiot vai salliiko käynnistys vielä pending-
migraatioita; nämä nykyiset ehdot säilytetään erillisinä.
Metadatatonta restore-poikkeusta ei laajenneta: vain nykyinen nimetty
038-anchor kelpaa `restoreCompatible`-valtuudella. Virheellinen metadata
ei muutu poikkeukseksi. Uuden tyhjän kannan schema sallitaan vain nykyisessä
työtilan luonti-/alustuspolussa, ei valmiina tuotuna backupina.

**Sidonta käyttöön asti.** Tarkistuspalvelu palauttaa suljetun, vain
prosessien sisäisen kuitin: operation, generation, valittu policy,
migration-chain, DB:n todellinen koko/hash sekä artifact-katalogin
nykyinen sisältösidonta. Kuitin profile-/hash-tiedot eivät kuulu julkiseen
lokiin tai Diagnosticsiin. Omistettu staging pysyy varattuna tarkistuksesta
kopiointiin tai aktivoinnin luovutukseen asti. Kopion todelliset tavut
verrataan lähteeseen; jokainen kirjoittava avaus tekee lisäksi schema-
tarkistuksen samassa yhteydessä ennen business-lukua tai migraation DDL/DML:ää.
Migraation jälkeen tarkistetaan uusi nykyinen schema ja koko sisältö uudelleen.
Vanhentunut kuitti, vaihtunut generation, polkuidentiteetti tai tavut
hylätään. Aktiivista WAL-kantaa ei sidota pelkän päätiedoston hashilla:
sen snapshot syntyy vain nykyisellä SQLite backup -API:lla.

| Kuluttaja | K1:n pakollinen sijoitus | K2:n työn omistaja |
| --- | --- | --- |
| Tavallinen Inspect ja restore-staging | Autentikointi/purku -> schema -> sisältö -> manifestin vastaavuus. Ei aktiivisen yrityksen tietokantakyselyitä tuodulle kannalle. | Uusi rajattu tarkistusutility, native-main omistaa operaation. |
| Portable backupin ja recovery pointin itsevalidointi | Sama tarkistin myös omalle snapshotille; oma alkuperä ei ohita eheyttä. | Sama tarkistusportti; nykyinen maintenance ja C:n update-sidonta säilyvät. |
| `prepareProfileRestoreActivation` | Tarkista staging ja sidonta uudelleen ennen nykyisen activation-sisällön valmistelua. | Sama utility saa kopioida vain tämän operaation uuteen activation-stagingiin nykyisellä materialisointipalvelulla; SQLite pysyy readonly. |
| Import uutena ja same-lineage-korvaus | Tarkista lähde ennen kopion kirjoittavaa avausta, kopio ennen migraatiota, nykyinen schema ja PDF-katalogi migraation jälkeen. | Nykyinen eristetty workspace candidate; C:n writer-varaus ei muutu. |
| Julkaistu candidate, migraatioinventaario ja cold recovery | Todista julkaistun kohteen schema/content ennen registry-/journal-päätöstä ja normaalia avaamista. | Nykyinen candidate-/käynnistysomistaja; samoja backend-helper-portteja käytetään. |
| `app.ts`:n restore-/rollback-/normaali käynnistys | Olemassa olevan tiedoston readonly-esitarkistus ennen kirjoittavaa avausta, sitten saman yhteyden tarkistus ennen migraatiota ja healthia. Uusi tyhjä kanta erotetaan. | Desktopin käynnistysomistajan rajattu valmistelu ennen business-readinessia; ei luottamista pelkkään journalin vaiheeseen. |

Normaalia käynnistystä ei muuteta kaikkien PDF-tavujen uudeksi skannaukseksi.
K1:n esitarkistus kohdistuu schemaan ja historiaan; kokonainen
backup-/artifact-tarkistus pysyy nykyisissä sitä vaativissa palautusporteissa.
Mahdollinen suora backend-käynnistys ei saa kiertää ennen migraatiota
tehtävää tarkistusta. Schema-tarkistus ei lupaa suojaa samanaikaisesti
samalla käyttöjärjestelmätilillä toimivalta haittaohjelmalta; ADR-0009:n
uhkamallin rajaus säilyy.

#### K:n toteutussopimus: eristetty tarkistus ja siivous

**Hyväksytty K-P2 (9.10.2026).** Electron main käynnistää yhden lyhytikäisen utilityn
kiinteästä paketoidusta entrypointista. Backendin puhdas tarkistuspalvelu
suorittaa schema- ja sisältötyön siinä. Utility ei käynnistä HTTP-palvelua,
avaa aktiivista profiilia, peri session-/SMTP-salaisuuksia tai luo lapsiprosesseja.
Se ei aja tuotuja komentoja. Tämä on aktiivisen backendin kuorman eristys,
ei väite erillisestä käyttöjärjestelmäsandboxista.

Nykyinen `StagedProfileSnapshotValidationService` erotetaan aktiivisen
yrityksen kontekstin luvusta. Kevyt private broker -operaatio palauttaa vain
nykyisen sallitun tarkistuskontekstin. Sama palvelun julkinen lopputulos
koostetaan mainissa; profiilin vaihto tai vanhentunut runtime-generation
mitätöi tuloksen. Restore-aktivointi tarkistaa kontekstin uudelleen nykyisen
maintenance-suojan alla. C:n `updateMaintenanceOperationId` tarkistetaan
edelleen omistavassa backendissä ennen työn luovutusta ja onnistumisen
hyväksymistä; yhteyskatko ei vapauta update-kirjoitussuojaa.
Private brokerin versio 9 muutetaan eksplisiittisesti versioon 10, koska
kontekstipyyntö ja vanhojen raskaiden operaatioiden poisto muuttavat sopimusta;
lähettäjä, parseri, vastaanottaja ja testit päivitetään yhdessä.
Rendererin backup-capability ja durable-formaatit eivät vaihdu.

| Raja | Suunniteltu ensimmäinen toteutus ja todennus |
| --- | --- |
| Rinnakkaisuus | Enintään yksi tarkistusutility installation-omistajaa kohti. Uusi rinnakkainen pyyntö saa nykyisen busy/unavailable-palautteen; ei rajatonta jonoa. |
| Työaika | Tarkistuspyynnön alusta terminal-tulokseen enintään nykyisen snapshot-brokerin 35 000 ms. Luotetun kontekstin haku, spawn ja valmistelu kuuluvat samaan määräaikaan. Ei aikarajan nollausta vaiheesta tai viestistä; decryptin ja candidate-migraation nykyisiä omia rajoja ei muuteta. |
| Pysäytys | Nykyinen 3 000 ms hallittu sulku ja 3 000 ms killin jälkeinen exit-odotus; nämä ovat siivousta, eivät jatkoa validointityölle. Killin palautusarvo tai tulosviesti ei ole exit-todiste. |
| SQLite-muisti | Hyväksytty 256 MiB `hard_heap_limit` asetetaan erillisessä utilityssa luotetun muistiyhteyden kautta ennen tuodun kannan avausta. Readbackin lisäksi valvonnan toiminta vaaditaan; `MEMSTATUS=0`-ajuria ei hyväksytä pelkän readbackin perusteella. `mmap_size=0`, rajattu cache ja muistissa pysyvä temp. Ei prosessiglobaalia heap-rajaa aktiiviseen backendiin. |
| JavaScript-muisti | Hyväksytty 512 MiB V8 old-space -raja utilityn kiinteässä käynnistyksessä. Tämä ja SQLite-raja eivät yhdessä todista koko prosessin RSS-kattoa. IPC-, Buffer-, katalogi- ja rivirajat tarvitaan lisäksi. |
| Syöte/tulos | Suljettu, versioitu private-protokolla, enintään 4 KiB viesti. Main omistaa pathit, operation/generation/policy-sidonnan; renderer ei valitse niitä. Vastaukseksi vain yhteenveto/kuitti tai turvallinen syy, ei SQL:ää, katalogia, rivejä tai raw-poikkeusta. Yksi terminal, väärä/ylimääräinen terminal hylätään. |
| Nykyiset sisältörajat | Container 32 GiB, entry 24 GiB, artifact-katalogi 64 MiB / 100 000 kohdetta, PDF 10 MiB ja artifactit yhteensä 20 GiB säilyvät. Suurin formaatin sallima koko ei lupaa valmistumista resurssibudjetissa. Tiedostot hashataan virtana. |

Budjetit ovat omistajan 9.10.2026 hyväksymät rajat, eivät tässä valmistelussa
todennettuja kaikkien suurten aineistojen läpäisyrajoja. Ensimmäinen
toteutuskoe varmentaa asetusten toiminnan nykyisessä paketoidussa Electronissa,
nimetyt raja-arvot ja hyväksytyt historialliset fixturet. Jos tarvitaan eri
budjetti tai hyväksytty normaali aineisto ei sovi, tulos tuodaan päätettäväksi;
rajoja ei kasvateta vihreyden vuoksi. SQLite- ja Electron-rajat perustuvat
nykyisiin [pragma-rajapintoihin](https://www.sqlite.org/pragma.html) ja
[utilityProcess-rajapintaan](https://www.electronjs.org/docs/latest/api/utility-process).

**Prosessivaraus ja cleanup:** käytetään nykyistä
`acquireWorkspaceProcessReservation`-primitiveä tarkistusoperaation oman
yksityisen juuren identiteetillä. Aktiivisen asennuksen writer-varausta ei
siirretä tarkistimelle. Utility hankkii operaatiovarauksen ennen tiedoston
avausta; main sitoo luvan elävään kanavaan ja käynnistyssukupolveen.
Parentin/childin luovutusaukko ei saa sallia cleanupia ja myöhäistä avausta
samalle juurelle. Tämä todennetaan ennen varsinaiseen backup-polkuun kytkentää.

Tulos hyväksytään vasta oikean terminalin ja onnistuneen exitin jälkeen.
Lopullinen mainin hallitsema varaus estää uuden lukijan ennen käyttöä tai
siivousta. Timeout/cancel säilyttää ensisyyn, odottaa rajatusti exitiä ja
tarkistaa varauksen. Epävarma exit/varaus estää poiston, aktivoinnin ja saman
stagingin uudelleenkäytön. Hallittu sovellussulku odottaa tätä omistettua
työtä nykyisessä sulkubudjetissa. Pakkokatkaisun jälkeen startup yrittää
varata tunnetun staging-juuren ennen poistoa; busy/epäselvä juuri säilytetään
selvitysohjeella. Parentin kuoleman ei oleteta todistavan lapsen poistumista.
Vanha staging ilman uutta kuitin muistia tarkistetaan uudelleen, sitä ei
hyväksytä journalin tai iän perusteella. Uutta yleistä supervisoria,
PID-hakua, pysyvää journaliformaattia tai T3-remonttia ei tarvita.

#### K:n tiedostovastuut ja turvallinen palaute

| Omistaja | Rajattu muutos |
| --- | --- |
| `apps/backend/src/database/migration/` | Odotusscheman muodostus, schema-attestointi ja rajattu migration-historian luku. Metadata-DDL pysyy yhdessä omistajassa. Yksi yhteinen tarkistin myös kirjoittaville kuluttajille. |
| `apps/backend/src/runtime/profileSnapshot/` | `inspectSqliteProfileDatabase.ts`: järjestys; `validateProfileSnapshot.ts`: irti aktiivisesta DB:stä; `validateProfileArtifactCatalog.ts`: rivirajat ennen materialisointia. Nykyinen artifact-materialisointi säilyy omassa helperissään. |
| `apps/backend/src/runtime/workspaceCandidate/` ja `apps/backend/src/http/app.ts` | Readonly-esitarkistus ennen kirjoittavaa avausta, yhteyskohtainen tarkistus ennen migraatiota, julkaistun/migroidun scheman varmennus. Nykyinen varaus, numerointi ja transaktiot säilyvät. |
| `apps/desktop/src/profileBackup/` ja `apps/desktop/src/runtime/` | Kapea tarkistusportti, parseri ja utility-adapteri/entrypoint; nykyinen broker vain luotettuun kontekstiin ja aktiivisen snapshotin muodostamiseen. Kiinteä paketoitu polku sekä olemassa olevan reservation-primitiven sovitus. |
| Backup-, restore-, recovery point- ja workspace-composition | Kaikki nykyiset `validateProfileSnapshot`-/activation-kutsujat siirretään saman portin taakse. Vanha aktiivisen backendin raskas käsittely poistetaan kattavuuden todennuksen jälkeen; ei rinnakkaista fallbackia. |
| Nykyinen observability-/Diagnostics-ketju | Allowlistatut koodit, vaihe, kesto ja erillinen cleanup-tulos sekä todellinen käyttöliittymä-/tukipakettiprojektio. Ei uutta loggeria. |

**Hyväksytty K-P3:n palaute (9.10.2026):** pidä väärän salasanan ja autentikointivirheen
yhteinen ilmoitus muuttumattomana. Uudet suljetut tekniset syyt ovat
`PROFILE_SCHEMA_UNSUPPORTED`, `PROFILE_INSPECTION_LIMIT_EXCEEDED`,
`PROFILE_INSPECTION_TIMEOUT`, `PROFILE_INSPECTION_PROTOCOL_INVALID` ja
`PROFILE_INSPECTION_CLEANUP_UNVERIFIED`. Tuntematon poikkeus pysyy tuntemattomana;
OOM:ia tai tiettyä schema-poikkeamaa ei päätellä pelkästä exit-koodista.
Sisältöhylkäys, keskeytys ja uudelleenkäynnistystä/selvitystä vaativa
siivoushylkäys erotetaan käyttäjälle turvallisesti. Raaka SQL, polku,
profiilitunniste tai checksum ei näy ilmoituksessa, Diagnosticsissa tai
tukipaketissa. Ensivirhe ei vaihdu cleanup-virheeksi.

Päivitä toteutuksen mukana nykyiset backup-/restore-/recovery-tapahtumat ja
`r0-observability-event-catalog.md`, virhekoodien allowlistat sekä
`local-restore-recovery-runbook.md`. Todista mainin todellinen observer ->
operational-loki -> Diagnostics -> sanitoitu tukipaketti; error-tason
incident-projektio noudattaa nykyistä minimointia. Activityyn ja business-
auditiin ei lisätä teknisiä backup-tapahtumia. Opastuksen on kerrottava,
että keskeytynyt tarkistus ei ole osittainen palautus eikä aktiivisen
yrityksen dataa korvata sen vuoksi.

#### K:n toteutusjärjestys ja hyväksyntä

**V1 / suunnitelma, hyväksytty 9.10.2026:** lähdevertailu ja rajattu luotettujen migraatioiden
muistissa muodostamisen valmistelukoe on tehty. Koe tukee toteutustapaa,
ei ole hyökkäys-, yhteensopivuus- tai korjauksen hyväksyntänäyttö.
Riippumaton suunnitelmakatselmus ei löytänyt konkreettista estettä.
Historiallisten esitysmuotojen, oikean utilityn resurssirajojen ja varauksen
luovutuskilpailujen todennus jäi tarkoituksellisesti toteutuksen porteiksi.
Omistaja hyväksyi molemmat päätöskysymykset: K-P1:n schema-portin sekä
K-P2/K-P3:n eristetyn tarkistuksen rajoineen. Tämä sulkee V1:n;
V2a:n schema-tarkistus ja kohderegressiot on aloitettu; V3:n
hyväksyntänäyttöä ei vielä ole.

**V2a / rakenne:** toteuta yhteinen odotusschema ja attestointi. Testaa
current 039, hyväksytty metadatallinen historia ja metadataless 038, aidot
guardit/autoindeksit, muuttunut trigger/constraint/default/index, poistettu
guard, ylimääräinen objekti, identity-view, väärä ledger-rakenne,
metadata-poikkeusyritys sekä SQL:n litteraalien/quotejen muuttuminen.
Testi ei saa luoda odotusta samasta hyökkääjän kannasta. Historiallinen
fixture perustuu aiempaan hyväksyttyyn toteutukseen, ei vain uuteen
generaattoriin. Kirjoittavan avauksen vakoilu todistaa, ettei hylätyn
lähteen trigger tai migraatio pääse suorittumaan.

**V2b / eristys:** toteuta portti ja yksi utility. Todista ensin pienillä
prosessi-fixtureillä raskaan SQL:n katkaisu, ensimmäisen ikkunan ulkopuolinen
virhe, myöhäinen/puuttuva/väärä tulos, exit ennen tulosta, tulos ilman exitiä,
rajat, peruutus, parentin kuolema ja varausluovutuksen kilpailut.
Samalla todista aktiivisen backendin health sekä normaali asiakkaan luku/
tallennus. Ei kiinteää nukkumista tai onnistumisen vaatimaa ajan nostoa.

**V2c / oikeat kuluttajat:** kytke yllä olevan taulukon kaikki entrypointit,
siivous, virhekoodit ja current/legacy-sopimukset. Kopiointi-/avaus-/restart-
väliin vaihdetut tavut hylätään, myöhäinen vastaus ei hyväksy uutta
generationia. Testaa myös normaali itsebackup, C:n pre-update-suoja,
import/replace sekä epävarman cleanupin restart. Poista korvattu aktiivisen
backendin tarkistus vasta näiden kohdetestien läpäistyä. Päivitä omistavat
backup-, workspace-, database-, event- ja recovery-ohjeet samassa palassa.

**V3 / integraatio:** kohdetestit ja tyyppitarkistus jokaisen palan jälkeen;
sen jälkeen nykyiset composition-/HTTP-/native-/security-portit ja hardened
Windows backup -> inspect -> restore -> restart -> compare nykyisellä sekä
hyväksytyllä historiallisella synteettisellä aineistolla. Paketoitu entrypoint,
ajuri ja muistibudjetin readback todennetaan Windowsissa ja nykyisessä
Linux-portissa. Riippumaton rajattu loppukatselmus, julkaisun yksityisyys ja
jäädytetyn revision normaali PR/riippuvuusajo edeltävät suojattua mergeä;
uusi main tarvitsee omat nykyiset pakolliset porttinsa. Vanha CI-timeout
säilyy omana havaintonaan. Ei peräkkäisiä ajoja kunnes vihreä.

**Omistajapäätös 9.10.2026:** K-P1:n täsmällinen versionmukainen
schema-portti sekä K-P2/K-P3:n eristetty tarkistus, yllä nimetyt resurssi- ja
private-protokollarajat ja turvallinen hylkäys-/säilytyskäyttäytyminen
on hyväksytty toteutettaviksi. Hyväksyntä ei korvaa toteutuksen todennusta.
Nykyinen toimintatapa terveellä varmuuskopiolla säilyy: tarkista, vahvista
ja palauta. Tuntematonta rakennetta ei hiljaisesti korjata tai hyväksytä.
Tarve uudelle riippuvuudelle, formaattimuutokselle, laajemmalle legacy-
poikkeukselle tai uudelle yleiselle omistajuusmekanismille palaa erikseen
päätettäväksi.

V1-valmistelu ei muuttanut tuotantokoodia. V2a:n työpuussa on yllä rajattu
schema-toteutus ja kohdenäyttö. Riippuvuuksia, backup-formaattia tai
CI-ehtoja ei ole muutettu eikä K:n kokonaishyväksyntäkierrosta ajettu.
Alkuperäiset havainnot eivät ole korjatuiksi merkittyjä. W7, D/E/F/G/H/I,
GitHub-asetukset ja julkaisun uusi Deep Scan säilyvät erillisinä töinä.

### C:n ensimmäisen PR-kierroksen rajattu korjaus

Ensimmäinen V2-kierros yllä olevalla PR-headilla
`0c503d3ac07f5227e3190fc1d975f0d801b4ed36` päättyi 31 onnistuneeseen,
seitsemään epäonnistuneeseen ja kuuteen valinnaiseen ohitettuun jobiin.
Hylkäys sisältää kuusi varsinaista jobia ja hyväksyntäkoonnin; koonti ei
ole seitsemäs riippumaton sovellusvika. Ensivirheet säilyvät epäonnistuneina.

- **Testifixturen omistajuus:** rekisteri ja private journal kuuluvat nimettyyn
  `apps/desktop/e2e/workspaceColdRecoveryPackagedFixture.ts`-porttiin;
  E2E-kuluttaja omistaa vain synteettisen tietokannan ja artifactin valmistelun.
  Tuotannon build ei sisällä tätä testifixtureä. Rajat ja kuusi järjestelmätestiä
  läpäisivät korjauksen jälkeen.
- **Tuonnin tarkka elinkaari:** system-testit vaativat kaikki kolme todellista
  `runtime.absent`-tarkistusta oikeassa järjestyksessä: stop, migrate ja validate.
  Vanha yhden tarkistuksen odotus oli testisopimuksen poikkeama, ei lupa
  vähentää tuotannon poissaolotodistuksia.
- **R04:n salattu itsevalidointi:** oikea palautuspistepalvelu, salattu store,
  MessagePort-broker, maintenance-state ja HTTP-kirjoitusraja toistivat
  `PROFILE_MAINTENANCE_OPERATION_MISMATCH`-hylkäyksen ennen korjausta.
  Snapshotin sisältö-/health-portti on tässä synteettinen testisovitin.
  Korjaus sitoo erillisen tarkistusstagingin eksplisiittiseen update-omistajaan
  [nykyisen palautuspistesopimuksen](local-backup-and-restore-plan.md#päivityksen-kirjoitussuojan-erillinen-vapautussääntö)
  mukaan. Yksityisen protokollan versio on 9; durable-formaatit ja aikarajat
  eivät muutu. Tämä alempi näyttö ei vielä sulje neljän paketoidun handoff-
  hylkäyksen syytä tai hyväksy installer-polkua.
  Keskeneräisen tarkistuksen staging poistetaan vasta samalla brokerilla
  saadun sarjallisen valmistumiskuittauksen jälkeen. Epäonnistunut kuittaus
  säilyttää stagingin ja alkuperäisen virheen; yhteyskatko ei vapauta
  päivityksen kirjoitussuojaa.

Korjauksen normaali testisarja ja tyyppitarkistukset läpäisivät, myös
broker-rajan 22 regressiota ja backendin E2E-testin erillinen tiukka
tyyppitarkistus. Riippumaton rajattu katselmus ei jättänyt korjattavaa
havaintoa. Todellinen paketoitu Windows-todennus on erillinen
hyväksyntäportti, ei näiden alempien tulosten johtopäätös. Sen myöhempi
`b6416bcc`-näyttö erotetaan seuraavassa checkpointissa.

Korjausrevisio tarvitsee omat tarkistuksensa, riippumattoman katselmuksen,
puhtaan paketin ja PR/main-portit. Aiemman puhtaan paketin hardened-palautus
ja kolme packaged-tapausta läpäisivät ennen tätä korjausta; tuloksia ei
siirretä automaattisesti myöhemmälle revisiolle. Mahdollisen salatun
diagnostiikka-aineiston osittaisuus erotetaan sovelluksen ja siivouksen
tuloksista; puuttuvaa aineistoa ei lasketa talteen otetuksi.

### C:n prosessijärjestysfixturen täsmennys

Headin `b6416bcc` normaali V2-kierros päättyi 33 onnistuneeseen, kahteen
epäonnistuneeseen ja kahdeksaan ohitettuun jobiin. Varsinainen hylkäys oli
`empty Job before exit observation preserves exitNonZero`; toinen hylkäys
oli siitä riippuva hyväksyntäkoonti. Ohituksia ei lasketa läpäisyiksi.
Päivityksen ja rollbackin sekä workspace-success- ja fault-recoveryn
molemmat suoritukset läpäisivät. R04:n korjattu itsevalidointi on siten
todennettu myös oikeassa paketoidussa päivitysketjussa. Koko C:n PR/main-
hyväksyntä on silti avoin.

Hylkäyksen säilynyt strict-tulos vahvistaa todellisen virhepoistumisen ja
Jobin tyhjenemisen. Puuttui testifixturen oma järjestysmerkintä: havaitsija
salli poistumiskuittauksen, jos prosessikahva oli signaloitu ennen kuin
sen erillinen Job-kysely näki nollan. Tällöin tarkoitettu vastakkaisjärjestys
ei koskaan pakottunut. Tämä on fixture-puute, ei näyttö sovelluksen tai
tuotannon supervisorin virheestä.

Nykyinen `ProcessBoundaryContract` pidättää testihavaitsijan kuittauksen
Jobin tyhjenemiseen ja kahteen tyhjän Jobin havaintoon asti. Supervisor
lukee laskurin ennen havaitsijaa, joten seuraava kierros ehtii varmasti
todentaa `rootExitReceiptPending`-välitilan. Pakotettu aikaisen kuittauksen
variantti toisti puuttuvan merkinnän ennen korjausta. Molemmat variantit
vaativat edelleen todellisen nolla- tai virhepoistumisen, strict-tuloksen,
koko prosessipuun poissaolon ja muuttumattoman siivoustuloksen.

Muutos koskee vain nykyistä C#-testifixtureä ja sen Node-sopimustestejä.
Tuotannon prosessiomistajuus, aikarajat, worker-vaatimukset, hyväksyntäehdot,
riippuvuudet ja julkinen diagnostiikka säilyvät. Ei uutta odotusmekanismia
tai yleistä loggeria. Neljä rajattua prosessikoetta läpäisivät korjauksen
jälkeen; tämä ei yksin hyväksy koko installer-matriisia. Korjausrevision
katselmus, puhtaan paketin portit ja normaali PR/main-todennus vaaditaan.
Ensivirhe ja sen salattu aineisto säilyvät erillään uudesta korjausajosta.

### C-paketin valmistelu ja hyväksyntärajat

**C:n lopullinen hyväksyntä 9.10.2026:** PR #299 ja mainin omat portit
läpäisivät [loppuhyväksynnän](https://github.com/eky-software/eky/pull/299#issuecomment-6081351779)
täsmärevisioilla. Nykyinen jatkamiskohta on sivun alussa. Alla oleva
valmistelu-, toteutus- ja hylkäysaineisto on C:n hyväksyntähistoriaa;
se ei käynnistä korjattuja paloja uudelleen tai selitä takautuvasti
kaikkia historiallisia timeout-havaintoja.

**Valmistelun lähdevertailu 8.10.2026:** tämän lähtötilanteen jälkeen tehdyt
omistajan päätökset, toteutukset ja näyttö erotetaan alla.
Vertailu koskee PR #298:n mainia `bd67742f1df9cbf989ec3c1afd078e95af356b1b` ja alkuperäisen katselmuksen
R03/R04/R17/R18/R19-tunnuksia. Keskeytetty Deep Scan ei ole valmis scan.
Alla olevat havainnot ovat nykyisen kutsuketjun staattista näyttöä, eivät
uusia suoritettuja toisto- tai korjaustestejä. Myöhempien C-P2/R17-toteutusten
sekä R19-toteutuksen rajattu näyttö on kirjattu tämän osion loppuun. B:stä siirretty updater-
handoff-havainto kuuluu R03:een, ei uuteen rinnakkaiseen korjausjonoon.

| Tunnus | Nykyinen lähde ja omistaja | Valmistelussa vahvistettu raja |
| --- | --- | --- |
| R03 | Desktop main: `desktopComposition.ts`, `mainOwnedActiveWorkspaceLifecycle.ts`, `backendProcess.ts` ja `localUpdateHandoffCoordinator.ts`. | Päivityksen `shutdownRuntime` kutsuu tavallista lifecycle-sammutusta. Backendin `stop()` voi palauttaa `forced`, jonka lifecycle-adapteri muuttaa onnistuneeksi `void`-tulokseksi. B:n sulkukorjaus estää jo väärän clean-shutdown-merkinnän; updaterin graceful-only-kytkentä jää silti puuttumaan. Nykyinen `stopForUpdate()` on tiukempi, mutta ei tässä tuotannon handoff-ketjussa käytössä. |
| R04 | Update/profile protection: `localUpdateHandoffCoordinator.ts`, `profileProtectionComposition.ts` ja `recoveryPointService.ts`. | Palautuspisteen snapshot-suoja ja valmistelun `WorkspaceMaintenanceLease` vapautuvat ennen erillistä handoff-kutsua. Handoff tarkistaa paketin uudelleen ennen omaa business-maintenancea. Pelkkä lease tai muuttumaton migration chain ei todista, ettei palautuspisteen jälkeen hyväksytty business-kirjoitusta. |
| R17 | Backend-prosessin ja startupin omistajuus: `backendProcess.ts` ja `desktopComposition.ts`. | Readiness-timeout ja backendin failed-status voivat hylätä käynnistyksen heti kill-pyynnön jälkeen. Start ei anna tällöin handlea kutsujalle; compositionin startup-catch voi tulkita puuttuvan handlen onnistuneeksi pysäytykseksi. Hylkäys tai kill-pyyntö ei todista todellista exitiä ennen rollbackia tai seuraavaa runtimea. |
| R18 | Workspace creation/import ja main startup: `emptyWorkspaceCreationRecovery.ts`, `workspaceBackupImportRecovery.ts`, `resolveActiveWorkspaceStartup.ts`, `resolveDesktopWorkspaceStartup.ts` ja `desktopComposition.ts`. | Hyväksytyt recovery-luokat ja journalit ovat olemassa, mutta tuotannon startup ei kutsu create/import-recoveryjä. Managementin guard estää ratkaisemattoman journalin jälkeiset muutokset. Importin plaintext-karanteeni siivotaan nykyisen recoveryn sisällä, ei tuotannon startup-ketjussa. Cold-startin täsmällinen orkestrointi puuttuu. |
| R19 | Build ja installer: `packageBuildInfo.ts` sekä `installerReleaseContext.mjs`. | Oletus-build lukee `git rev-parse --short=12 HEAD`; manifestin release context lukee täyden HEADin. Ympäristöstä annettu yhtenäinen revisio peittää eron. Eheyden porttiin ei lisätä lyhyen ja pitkän revision prefix-vastaavuutta. |

Valmistelun lukureitti: [desktopin ADR](../decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md),
[backup/recoveryn ADR](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md),
[installer/updaten ADR](../decisions/ADR-0010-windows-installer-and-update-orchestration.md),
[multi-workspacen ADR](../decisions/ADR-0011-local-multi-workspace-company-model.md),
[desktopin toteutussopimus](local-desktop-implementation-plan.md),
[update-suunnitelma](windows-installer-and-update-plan.md),
[workspace-suunnitelma](local-company-workspace-plan.md),
[palautuksen runbook](local-restore-recovery-runbook.md) ja
[versiointisopimus](release-versioning-policy.md).
Testit käyttävät nykyisiä [testipohjia](../ai/e2e-test-authoring-guide.md) ja
[installer-harnessia](windows-installer-acceptance-harness-v2.md).

#### C:n toteutuspalat ja todennus

Tämä on vaiheistusehdotus, ei vielä lupa ratkaista alla avoimia rajoja
itsenäisesti. Omistaja on hyväksynyt C-paketin tavoitteet; uusia
riippuvuuksia, formaatteja, yleistä lifecycle-kehystä tai arvaavaa repair-
kyvykkyyttä ei lisätä.

1. **R19: oletuspaketoinnin build-identiteetti.** Käytä oletuksena täyttä
   lähderevisiota ja säilytä vanhan build-metadatan hyväksytty lukuyhteensopivuus.
   `packageBuildInfo.test.ts` todistaa myös oikean Git-komennon.
   Paketin, manifestin ja nykyisen cache/trust-ketjun todiste käyttää
   ympäristömuuttujan sijaan oletuspolkua; mismatch hylätään edelleen.
2. **R17 ja R03: prosessin lopetuksen todiste.** Nykyinen backend-owner
   säilyttää ensisyyn ja rajatun stop-/exit-tuloksen myös ennen handlen
   palautumista. Update käyttää graceful-only-politiikkaa oikeassa main-
   compositionissa; ordinary close ja sen todettu forced-fallback säilyvät.
   `backendProcess.test.ts`, `mainOwnedActiveWorkspaceLifecycle.test.ts`
   ja `localUpdateHandoffCoordinator.test.ts` täydentyvät oikean compositionin
   testillä. Update vaatii graceful-exitin: forced estää installer-handoffin
   eikä tuota clean-merkintää. Ordinary forced todetulla exitillä kelpaa
   runtime-poissaolon todisteeksi, mutta seuraava runtime tai rollback vaatii
   lisäksi omat hyväksyntäporttinsa. Puuttuva tai tuntematon exit estää
   molemmat. Myöhäinen exit, failed-status, readiness-timeout, reentry ja
   normaali graceful testataan erillisinä tiloina; aikarajat eivät muutu.
3. **R04: palautuspisteen ja handoffin yhteinen kirjoitussuoja.** Käytä
   nykyistä lease-/maintenance-mekanismia yhdellä eksplisiittisellä
   omistajuudella. Snapshotin sisäinen maintenance ei saa vapauttaa
   handoffin pidempää suojaa. `profileProtectionComposition.test.ts` ja
   `localUpdateHandoffCoordinator.test.ts` täydentyvät todellisella HTTP-
   kirjoitusyrityksellä palautuspisteen jälkeisen revalidation-barrierin
   aikana. Oikean sessionin business-kirjoitus estyy, väärä session ei saa
   oikeuksia ja palautuspiste vastaa suojattua sisältöä. Virheen,
   peruutuksen, sammutuksen ja restartin vapautusehdot todistetaan.
4. **R18: nykyisten recoveryjen tuotantokytkentä.** Kytke hyväksytyt
   creation/import-luokat startupiin ennen business-sessionia ja aktiivisen
   business-backendin käynnistystä, kun journalijärjestys ja runtime-
   poissaolo on ratkaistu. Backendin rajattu validaattori säilyy SQLite-
   auktoriteettina. `resolveDesktopWorkspaceStartup.test.ts` ja
   `resolveActiveWorkspaceStartup.test.ts` sekä nykyiset recovery-testit
   täydentyvät oikean compositionin keskeytys/restart-matriisilla:
   julkaisematon candidate, julkaistu root, julkaistu registry, ristiriita,
   unknown runtime, slot-recovery ja journaliton plaintext-karanteeni.
   Jokaisen journalivaiheen keskeytys ja julkaisu-journalipäivityksen väli,
   toisen startupin idempotenssi, `previousActiveWorkspaceId=null`, no-ready
   ja samanaikaiset recovery-journalit ovat erikseen nimettyjä tapauksia.
   Create/importin startup-kytkennälle vaaditaan myös paketoitu
   keskeytys/restart-todistus; tavallinen backup/restore ei korvaa sitä.
   Entryä, lineagea tai active pointeria ei päätellä tai vaihdeta arvaamalla.
5. **C:n yhteinen integraatio.** Jäädytetty puhdas revisio todistaa
   hardened Windows packaged backup -> inspect -> restore -> restart ->
   compare -polun synteettisellä profiililla. Installer/update, binary- ja
   business-rollback, monityötila ja oletuspaketointi ovat erillisiä
   hyväksyntäehtoja. Nykyiset T3-fixturet, virhetodisteiden salattu toimitus,
   PR-portit ja uuden mainin omat portit säilyvät.

Jokaisen palan mukana tarkistetaan turvallinen käyttäjäpalaute, ensisyyn
ja cleanupin erottelu sekä tapahtuman tarkoitettu operational/diagnostics/
tukiketju [valmistumisportin](../ai/workflow.md#toiminnon-valmistumisportti)
mukaan. Tämä ei toteuta G/H-pakettien koko diagnostiikkaremonttia.

#### C:n avoimet sopimusrajat ennen toteutusta

**C-P1, omistajan päätös 8.10.2026:** päivityksen kirjoitussuojan nykyisen
kymmenen minuutin enimmäiskeston täyttyminen tai snapshot-brokerin yhteyden
katkeaminen keskeyttää päivityksen ja jättää business-kirjoitukset estetyiksi
hallittuun uudelleenkäynnistykseen asti. Asentajaa ei käynnistetä tästä
virhetilasta. Tavallisen varmuuskopioinnin nykyinen vapautus säilyy; rajaa
ei nosteta. Päätös ei itsessään valtuuta automaattista tietojen palautusta.
Käynnistys ratkaisee olemassa olevan update-journalin nykyisten ehtojen
mukaan ennen business-runtimen avaamista.

**C-P2 / R18, omistajan päätös 8.10.2026:** create/import-operaation
kylmäkäynnistyspalautuksen terminal on tiedostojen, rekisterin ja täsmällisen
jatkettavan ready-työtilan varmistus. Journal poistetaan vasta tämän jälkeen.
Business-runtime avataan erikseen normaalien käynnistys-, lineage- ja
terveystarkistusten läpäistyä; recoveryn valmistuminen ei väitä runtimea
terveeksi. Ristiriita tai puuttuva jatkettava työtila säilyttää journalin ja
estää avaamisen. Tavallisen, jo käynnissä olevan sovelluksen recovery säilyttää
nykyisen aiemman runtimen terveystarkistuksensa. Kaksivaiheista journalia tai
uutta journaliformaattia ei lisätä.

Nykyinen `profileSnapshotBrokerBackend.ts` vapauttaa ordinary-maintenancea
sekä aikarajalla että brokerin sulussa. Siksi pelkkä mainin leasen pito tai
kahden metodikutsun yhdistäminen ei riitä R04:n korjaukseksi. Päivityksen
omistettu suoja ja sen virhetilan säilyminen todistetaan myös backendissä.

- **Shutdown/exit:** miten olemassa oleva start-/shutdown-portti palauttaa
  tai säilyttää auktoritatiivisen exit-todisteen ilman handlea; graceful-
  update ja ordinary forced-close eivät saa sekoittua. Puuttuva handle
  tai valmis Promise ei ole itsessään todiste runtime-poissaolosta.
- **Maintenance:** mistä hetkestä suoja otetaan ja kuka omistaa sen
  prepare/handoff-rajalla; miten sisäinen snapshot-operaatio käyttää samaa
  suojaa ja miten epäonnistuminen, peruutus sekä keskeytyksen jälkeinen
  journal estävät liian aikaisen vapautuksen tai rinnakkaisen kirjoittajan.
- **Cold-start:** create/import-recoveryn prioriteetti suhteessa update-,
  registry-migration-, adoption- ja switch-recoveryyn; aiemman workspacen
  `ensurePreviousWorkspaceRunning`-semantiikka ja journalin terminal/poisto
  ennen business-runtimen olemassaoloa, myös kun
  `previousActiveWorkspaceId=null`. Registry luetaan uudelleen recoveryn
  jälkeen ennen aktiivisen työtilan valintaa. Recoveryn jälkeinen no-ready-
  tila rajataan fail closed; backenditon hallintatila tai hiljainen uusi
  adoptio eivät tule hyväksytyiksi sivuvaikutuksena. Aktiivinen tai
  tuntematon runtime sekä ristiriitaiset journalit pysäyttävät toiminnon.
  Valmiin active-lifecyclen `active`-alkutilaa ei käytetä cold-start-
  poissaolon oletuksena.

Nämä rajat ratkaistaan nykyisten porttien ja hyväksyttyjen ADR:ien mukaan,
ja toteutusvalmis ehdotus katselmoidaan riippumattomasti. Uusi
arkkitehtuuri-/turvallisuus-/palautuspäätös kysytään ennen kyseisen alueen
koodausta. V1 valmistuu vasta tämän sopimuksen lukituksesta; yllä oleva
lähdeinventaario ei vielä sulje V1:tä, C:tä tai 0.3.0:aa.

#### C:n rajattu toteutusehdotus

Alla oleva ehdotus tarkentaa nykyisiä omistajia. R18:n terminal-päätös on
hyväksytty C-P2:ssa; toteutuspalojen riippumaton katselmus ja testinäyttö
vaaditaan edelleen eikä kohtia merkitä tämän perusteella toteutetuiksi.
Erillisen palan toteutus voi alkaa sen oman sopimuksen katselmuksen jälkeen,
kun toisen palan avoin päätös ei vaikuta siihen. Koko V1 suljetaan vasta
kaikkien C-sopimusten valmistuttua.

- **R19 / build identity:** `packageBuildInfo.ts` käyttää oletuksena
  `git rev-parse HEAD` -komentoa. Vanhan build-metadatan 7-40 merkin luku
  ja eksplisiittinen build-syöte säilyvät; installer vaatii edelleen täyden
  revision ja exact-match-trustin. Testi tarkistaa Git-argumentit sekä
  oletus-buildin, manifestin ja current-cache-rekisteröinnin ketjun ilman
  `EKY_BUILD_REVISION`-ohitusta. Lyhyt saman prefixin revisio ei vastaa
  pitkää. Kohdetesti ei korvaa puhtaan revision oikeaa oletuspaketointia.
- **R17 / start ownership:** `backendProcess.ts` omistaa exit-havainnon
  myös ennen handlen palauttamista. Ensimmäinen startup-syy lukitaan ennen
  kill-pyyntöä; poissaolo todistetaan exit-tapahtumasta tai todetusta
  forkia edeltävästä epäonnistumisesta, ei puuttuvasta handlesta. Nykyisen
  shutdown-omistajan rajattu odotus asennetaan ennen lopetuspyyntöä, jotta
  välitön exit ei katoa. Tuntematon exit jää epävarmaksi eikä muuttunut
  kill-paluuarvo todista poistumista. Sisäinen tyypitetty startup-virhe
  säilyttää turvallisen ensikoodin ja omistajuustuloksen ilman raakaa
  syyketjua. `desktopComposition.ts` erottaa aloittamattoman startin,
  todetun poistumisen ja epävarman startin ennen recoveryä. Keskeneräinen
  migration-gate-callback ei anna lupaa rinnakkaiseen recoveryyn.
  Myöhäinen ready/exit ei avaa jo hylättyä startupia uudelleen.
  Hallittu startup-stop odottaa vain prosessia, ei omaa kutsuvaa callbackiaan.
  Callbackin alkuperäinen viiden minuutin takaraja säilyy myös prosessin
  poistumisen jälkeen; sitä ei käynnistetä uudelleen. Tavallisen
  käynnistysvirheen rajattu exit-odotus palauttaa muuttumattoman
  omistajuustilanteen ilman keskeneräisen callbackin odottamista.
  Epävarma fork-poikkeus ei todista, ettei prosessia syntynyt. Tämä
  R17-toteutussopimus on katselmoitu erikseen. Alla oleva rajattu näyttö
  ei vielä korvaa packaged- tai integraatioportteja.
- **R03 / strict update stop:** `MainOwnedActiveWorkspaceLifecycle`
  säilyttää backendin todellisen sulkutuloksen. Sen main-only update-polku
  käyttää `stopForUpdate()`-sopimusta, ordinary close edelleen omaa
  forced-fallbackiaan. Molemmat käyttävät samaa omistajaa ja yhteistä
  shutdown-tehtävää: jo käynnissä olevaa ordinary-sulkua ei nimetä
  jälkikäteen gracefulksi. Update saa jatkaa vain todistetun graceful-
  tuloksen jälkeen. Strict-polun virhesiivous ei kutsu ordinary stopia
  pakkopysäytyksen kiertotienä. Brokereiden ja capabilityjen muut sulut
  yritetään edelleen; ensivirhe ja cleanup-tulos eivät sekoitu.
  Strict-quiescence-/scheduler-virhe sulkee mainin admissionin; ordinary
  workspace-quiescen palautumissääntö säilyy. Myös sulkuryhmien sisäiset
  operaatiot eristetään, ja clean-merkki kirjoitetaan vasta kaikkien
  sulkujen onnistuttua sekä graceful-exitin jälkeen. Management-guardin
  dispose ei peru käynnissä olevan operaation journal-/relaunch-viimeistelyä.
- **R04 / one preparation owner:** `LocalUpdateHandoffCoordinator`
  pitää saman installation-leasen ja backendin operation-sidotun
  kirjoitussuojan pre-update-snapshotin alusta handoffiin. Prepare ja
  handoff jakavat saman muistissa olevan omistuksen; pelkkä levyltä luettu
  `recoveryPointValidated`-journal ei luo uutta live-handoff-valtuutta.
  `RecoveryPointService` saa rajatun caller-owned pre-update-polun, joka
  käyttää jo hankittua samaa suojaa eikä vapauta sitä sisäisessä finallyssä.
  Backend tarkistaa snapshotin operation-sidonnan nykyiseen tapaan.
  Ennen runtime-stopin alkua turvallisesti keskeytynyt valmistelu voidaan
  vapauttaa vasta terminal-journalin ja voimassa olevan omistuksen jälkeen.
  Epävarma stop, suojan menetys tai epävarma terminal-kirjoitus jää suljetuksi.
  Käyttäjän normaali peruutus on edelleen ennen valmistelun alkua.
- **R04 / backend fence:** nykyinen snapshot-broker saa täsmällisen
  update-kohtaisen begin-/validointisopimuksen. C-P1:n aikakatkaisu ja
  yhteyden katkeaminen mitätöivät tämän operaation mutta eivät vapauta
  business-kirjoituksia. Tavallinen backup ei muutu. Päivityksen graceful-
  shutdown on sidottu samaan operationiin myös `backendMessages.ts` /
  `backendRunner.ts` -ketjussa: suoja tarkistetaan ennen sulkua ja viimeisen
  asynkronisen palvelusulun jälkeen ennen onnistunutta exitiä. Näin suojan
  vanheneminen mainin tarkistuksen ja backendin exitin välissä ei voi antaa
  väärää onnistumista. Sisäisen broker-protokollan lähettäjä, parseri,
  vastaanottaja ja versio päivitetään yhtenä sopimuksena; durable backup-,
  workspace- ja update-journaliformaatit säilyvät.

R04 toteutetaan ensin rajattuna backend/broker-palana. Nykyinen
`ProfileMaintenanceState` omistaa tavallisesta huollosta erotetun
update-operaation ja sen mitätöitymisen. Nimetyt `beginUpdateMaintenance`,
`assertUpdateMaintenance` ja `endUpdateMaintenance` kulkevat nykyisessä
yksityisessä snapshot-brokerissa. Tavallinen end ei vapauta update-suojaa;
force-end, drain-virhe tai yhteyskatko mitätöi sen mutta säilyttää busy-tilan.
Vain edelleen voimassa olevan, drainin läpäisseen update-operaation
nimenomainen end voi palauttaa normal-tilan. Nykyinen 30 sekunnin drain ja
sen jälkeen alkava 10 minuutin enimmäiskesto säilyvät. Backend tarkistaa
monotonisen takarajan myös synkronisesti: viivästynyt ajastin ei jatka
valtuutta. Myös synkroninen assert vaatii päättyneen drainin. Snapshotin ja
validoinnin myöhäinen tulos tarkistetaan ennen onnistumisvastausta käyttäen
ennen odotusta talteen otettua update-sidontaa; brokerin siivouksessa
poistunut paikallinen tunniste ei ohita tarkistusta. Restore-aktivointia
ei sallita update-suojan alla. Begin, snapshot ja end pysyvät samassa
sarjallisessa jonossa; end ei ohita keskeneräistä snapshotia.

Ensimmäisen palan näyttö yhdistää oikean state-omistajan, brokerin,
asiakkaan ja HTTP-kirjoitusmiddlewaren hallitulla viestikuljetuksella.
Se kattaa katkoksen myös kesken drainin, myöhäisen snapshotin, väärän
operaation, vanhentuneen suojan ja tavallisen backupin vapautuskontrollit.
Caller-owned palautuspisteen rajattu palvelupolku käyttää tämän jälkeen
samaa operationia ilman begin/end-kutsua. Se tarkistaa suojan ennen
onnistumista myös tallennuksen ja siivouksen jälkeen. Epävarman snapshotin
tai validoinnin siivous vaatii nykyisen broker-jonon kuittauksen; ilman
sitä staging ja ensivirhe säilyvät. Tavallinen backup ei muutu.
Operation-sidotun graceful-exitin backend-vastaanottaja on tämän jälkeen
toteutettu. Mainin lähettäjä/lifecycle ja prepare/handoff-ownerin
tuotantokytkentä käyttävät nyt samaa operationia. Osatodistukset eivät korvaa
oikean prosessin ja packaged-ketjun todistusta.

R17:n rajatut regressiot kattavat timeoutin, failed-statusin, synkronisen
ja viivästyneen exitin, puuttuvan exitin, fork-virheen, myöhäisen ready-
viestin sekä keskeneräisen migration-gaten. `desktopRestoreStartup.test.ts`
käyttää oikeaa compositionia ja todistaa, ettei epävarma omistajuus muuta
profiilitiedostoja, aktiivista osoitinta tai käynnistä toista runtimea.
R03:n testit erottavat ordinary graceful/forced/unknown-tulokset ja strict-
sulun sekä samanaikaiset sulkupyynnöt.

R04:n regressiot kattavat snapshotin jälkeisen todellisen HTTP-kirjoituksen,
revalidationin viiveen, kilpailevan maintenancen, väärän operationin,
terminal-kirjoituksen epäonnistumisen, aikarajan ennen sulkua ja sulun aikana,
broker-katkoksen ja restartin. Normaali backupin auto-release säilyy omana
kontrollinaan. `w6b2PackagedProofController` ja sen fault-controller
käyttävät samaa suojattua preparationia: niiden keskeytykset säilyttävät
nykyisen recovery-näytön, eivät ohita uuden suojan tarkistusta.

**R18:n cold-start-ehdotus:** read-only admission tarkistaa create/import-
sekä kilpailevien journalien current/next/backup-slotit ennen mutatoivia
recovery-lukuja, myös ennen legacy-update-tilan korjaavaa siirtoa.
Nykyinen build-admission säilyy workspace-muutosten edellä. Sen jälkeen
valittu create/import-recovery toistaa admissionin oman installation-leasensa
alla ennen mutaatioita; vasta sen jälkeen nykyinen first-start-registry-
recovery ja uusi registry-luku edeltävät adoption/switch-valintaa sekä
business-sessionia. Kilpailevaa first-start-journalia ei siis ensin korjata
huomaamatta pois. `none` säilyttää muiden startup-recoveryjen oman polun
eikä valtuuta plaintext-siivousta. Sama installation-lease jatkuu business-
runtimen käyttöön, eikä composition ota sitä toistamiseen recoveryn ympärille.
Cold absence ei käytä active-lifecyclen alkutilaa:
mainin yksittäisinstanssiraja, vielä aloittamaton runtime ja suljettujen
validaattorien todisteet vaaditaan. Yksittäisinstanssilukon saaminen ei
yksin ole edellisen mainin lasten poistumisen todiste. Tämän prosessirajan
ratkaisu suunnitellaan ennen tuotantokytkentää; muistissa oleva
`notStarted`-tila, puuttuva nykyinen kahva tai pid-arvon tallentaminen ei
korvaa poistumisen tai keskinäisen poissulun varmistusta. Edellisen kaatuneen
mainin utility-prosessien elinkaari todistetaan erikseen paketoidulla
keskeytys/restartilla.
Tuntematon poissaolo estää myös candidate- ja plaintext-siivouksen.

Nykyisten recovery-luokkien nimenomainen `beforeRuntimeStart`-completion
käyttää samaa reconciliation-logiikkaa ordinary-polun kanssa eikä vastaanota
lifecycle-käynnistysporttia. Se ei esitä no-op-callbackia terveenä
aiempana runtimena. Ennen journalin poistoa fresh registry todistaa juuri
aiemman aktiivisen ready-workspacen tai ensimmäisen julkaistun workspacen,
kun previous ID oli null. Julkaisematon ensimmäinen yritys ilman jatkettavaa
ready-workspacea säilyttää journalin; seuraava startup ei aloita hiljaista
adoptiota. Cold-terminal noudattaa yllä hyväksyttyä C-P2-päätöstä.

**R18:n ensimmäinen toteutuspala:** cold-terminal on lisätty nykyisiin
create/import-recoveryihin. Yhteinen rajattu continuation-tarkistus vertaa
tuoreen strict registryn kanonisia tavuja odotettuun tilaan ja tarkistaa
johdetun työtilajuuren. Julkaistun rootin polku vertaa rekisteriä myös ennen
omaa julkaisuaan alkuperäiseen snapshotiin: validoinnin aikana muuttunutta
rekisteriä ei ylikirjoiteta, ja puuttuva sekä tyhjä rekisteri erotetaan.
Tämä on operaation loppuehto, ei business-runtimen
terveystodiste. Ordinary-polun käynnistyssemantiikka säilyy. Tämä ensimmäinen
pala ei sisältänyt tuotannon startup-kytkentää, journal-admissionia tai
paketoitua keskeytys/restart-todennusta. Admissionin myöhempi osatodiste
on alla; R18 ja C pysyvät avoimina.

Kohdistetut 128 testiä ja laajemman workspace-/startup-sarjan 811 testiä
läpäisivät; kaksi ennestään alustakohtaista testiä oli ohitettu.
Joukot ovat päällekkäisiä, eivät yhteen laskettava testimäärä. Desktopin
tyypitys läpäisi testin lukukohdan korjauksen jälkeen. Testit kattavat
publication-välit, first-workspacen, tuntemattoman runtimen, muuttuvan
rekisterin, puuttuvan juuren ja epäonnistuvan journalin poiston. Oikean
compositionin rajatesti todistaa molemmille recoveryille, että journalin
poiston jälkeenkin virheellinen synteettinen tietokanta hylätään normaalissa
käynnistystarkistuksessa eikä business-ikkunaa avata. Prosessi- ja broker-
rajat ovat tässä testissä korvattuja; tämä ei ole packaged-käynnistystodiste.
Uusia virhekoodeja tai diagnostiikkakanavia ei lisätty: nykyiset turvalliset
recovery-virheet säilyvät. Niiden tuotannon lukuketju varmennetaan R18:n
startup-kytkennän mukana. Näyttö ei vielä hyväksy C:n julkaisuintegraatiota.
Riippumaton tämän rajatun muutoksen katselmus hyväksyi korjatun toteutuksen;
270 ohjeiden suhteellista linkkiä/ankkuria sekä `git diff --check` läpäisivät.

**R18:n toinen rajattu toteutuspala:** journal-admissionin matriisi on
toteutettu erillään tuotannon polkukoosteesta ja käynnistyskytkennästä.
Molemmat create/import-omistajat ja kilpailevat keskeneräiset journalit
estetään ennen korjaavaa lukua. Terminal-poikkeukset käyttävät nykyisiä
update-/Setup-parsereita. Yhteinen täysin lukeva apu korvaa management-
guardin aiemman paikallisen toteutuksen; se tarkistaa hakemistopolut ja
lukee sisällön nykyisellä rajatulla tiedostolukijalla. Väärän hakemistotyypin
ja katkenneen linkin tulkitseminen puuttuvaksi tilaksi toistettiin uusilla
regressioilla ja korjattiin. Ensimmäisten hylkäysten näyttö säilyy.
[Workspace-ohje](local-company-workspace-plan.md) erottaa omistajan valinnan
recoveryn mutaatio-, poissaolo- ja terveystodisteista. Rekisterin
auktoritatiivinen slot-prioriteetti ja journaliformaatit eivät muutu.
Tämä toinen pala ei vielä sisältänyt polkukoostetta. Sen myöhempi toteutus
on kuvattu alla; tuotantokytkentä ja paketoitu todennus ovat edelleen
avoimia, eikä tätä merkitä koko R18:n hyväksynnäksi.

Katselmuksen korjausten jälkeinen workspace-/runtime-/composition-kohdesarja
läpäisi 1 023 testiä; kaksi ennestään alustakohtaista testiä oli ohitettu.
Desktopin tyypitys, 283 ohjeiden suhteellista linkkiä/ankkuria ja
`git diff --check` läpäisivät. Riippumattomassa rajatussa
loppukatselmuksessa ei jäänyt korjattavaa koodilöydöstä. Nämä ovat
alemman tason todisteita, eivät tuotannon cold-start- tai packaged-portteja.

**R18:n kolmas rajattu toteutuspala:** mainin juuresta johdettu polkukooste
tarkistaa nykyisen admissionin oikeilla omistavilla polkurakentajilla.
Legacy-profiili, valitun create/import-journalin kohde ja aiempi työtila sekä
auktoritatiivisen rekisterin kaikki työtilat kuuluvat tarkistukseen.
Jaetun slottivaraston uusi vain lukeva `inspect` käyttää samaa laiskaa
current/backup/next-valintaa kuin korjaava luku. Virheellinen valittu tieto
estää käsittelyn ilman fallbackia; syrjäytettyä tyhjää nextiä ei lueta.
Rekisterin jäsenjoukon nykyiset muutokset ja journalin kattavuus on
katselmoitu. W7 tai muu jäsenjoukon muuttaminen vaatii uuden kattavuusarvion.
Polkukooste ei vielä ole tuotannon startupissa eikä todista runtime-poissaoloa.
Sen tarkistus toistetaan leasen alla ennen omistajan mutatoivaa recoveryä.
Tuotantokoodin laajempi workspace-/runtime-/composition-sarja läpäisi
1 104 testiä; kaksi ennestään alustakohtaista testiä oli ohitettu.
Katselmuksen jälkeen täydennetty 97 testin kohdesarja ja desktopin tyypitys
läpäisivät. Joukot ovat päällekkäisiä. Täydennykset todistavat omistajan
poistumisen tai vaihtumisen ennen lopullista tarkistusta sekä nykyisen
palautuksen tarkan poisto-/siirto-/sync-järjestyksen. Riippumaton rajattu
katselmus ei jättänyt korjattavaa löydöstä. Ohjeiden 284 suhteellista
linkkiä/ankkuria ja `git diff --check` läpäisivät. Tätä ei lasketa
packaged- tai integraationäytöksi.

Cold-recoveryjen leasen sisäinen admission-portti on nyt pakollinen, ja
sen oikea juuresta johdettu tarkistus vaatii odotetun omistajan. Tyyppinen
admission-hylkäys ei muutu omistajakohtaiseksi yleisvirheeksi, ja ulompi
startup säilyttää nimetyt nykyiset recovery-koodit suljetun allowlistin
kautta. Raaka poikkeus tai koodiin liitetty lisätieto ei vuoda palautteeseen.
Rajatut 244 testiä ja desktopin tyypitys läpäisivät, mukaan lukien ordinary-recoveryjen kontrollit,
omistajan vaihtuminen/katoaminen, muuttumaton aineisto ja ulompi virheraja.
Laajempi workspace-/runtime-/startup-sarja läpäisi 1 127 testiä; kaksi
ennestään alustakohtaista testiä ohitettiin. Joukot ovat päällekkäisiä.
Ohjeiden 284 suhteellista linkkiä/ankkuria ja `git diff --check` läpäisivät.
Tämä täydentää edellistä palaa, ei todista tuotannon cold-start-kytkentää tai
edellisen pääprosessin lasten poistumista. Rajatun toteutuksen riippumaton
katselmus ei jättänyt korjattavaa löydöstä. Prosessirajan ratkaisu ja
tuotantokytkentä sekä packaged-portti pysyvät avoimina.

**R18:n avoin prosessirajapäätös:** edellisen mainin utility-prosessien
poistumisen tai keskinäisen poissulun pitää kattaa myös uuden mainin
tiedostomutaatiot ja validaattorin työskentely. Nykyinen main-lukko ja
muistinsisäinen lease eivät yksin ole tämä sopimus. Rajattu prosessien
välinen varaus nykyisen Node/Electron-runtimen avulla on suunnitteluvaihtoehto.
Omistaja hyväksyi ensin sen rajatun suunnittelun ja synteettisen kokeen, ei
tuotantokytkentää tai journal-formaatin muutosta. Vanhojen keskeytysten
yhteensopivuusrajaus on myöhemmin hyväksytty alla erillisenä päätöksenä.
Koe erottaa suojatun työn pääprosessin kuoleman jälkeen, myöhässä varausta
hakevan lapsen sekä vanhan varaamattoman prosessin. Nykyinen testien
prosessiomistaja vastaa kokeen eristyksestä ja siivouksesta. Ennen tuotantokytkentää
ratkaistaan valtuutuksen siirtyminen mainin ja utilityn välillä sekä
hyväksytyn yhteensopivuusrajauksen täsmällinen toteutus. Varauksen puuttuminen
ei saa muuttua vanhan prosessin poissaolon oletukseksi. Tämä erillinen
päätös ei avaa T3:a tai yleistä prosessikehystä uudelleen.

Rajattu kolmen synteettisen tapauksen toteutettavuuskoe läpäisi.
Hyväksyntä vaati testityöntekijän sidotun lopputulosviestin, valvojan
onnistumisen ja koko omistetun prosessipuun poistumisen. Koe kattoi
suojatun lapsen työn pääprosessin poistumisen jälkeen, uuden omistajan
varauksen vuoksi estetyn myöhäisen lapsen sekä suojaamattoman vanhan
toimintamallin vastatapauksen. Viimeinen ei ole turvallisuuden läpäisy:
se vahvistaa, ettei vapaa varaus todista vanhan suojaamattoman työn loppua.
Kokeen hyväksyntäketju katselmoitiin riippumattomasti ennen ajoa.
Tämä ei hyväksy tuotantokytkentää. Työluvan kaikki siirtymäjärjestykset,
pysyvä varauksen identiteetti ja vanhan käynnistyksen yhteensopivuusrajan
todentaminen ovat vielä ratkaistavia; kokeen ajokohtainen tunniste ei todista niitä.

**R18:n hyväksytty vanhojen keskeytysten käsittely:** jos vanhan kirjoittavan
prosessin pysähtymistä ei voida varmistaa, kesken jääneen yrityksen luonnin
tai tuonnin automaattinen palautus estetään. Tiedostot ja palautusjournal
säilytetään selvitystä varten; epävarmuus ei valtuuta siivousta tai journalin
poistoa. Päätös ei aseta estoja tavallisesti valmistuneille yrityksille eikä
vanhoille laskuille pelkän iän vuoksi. Vapaan uuden varauksen saaminen ei
ole vanhan suojaamattoman prosessin pysähtymistodiste. Tämä ratkaisee
käyttäytymisrajauksen, ei hyväksy vielä uutta journal-formaattia tai yksilöi
prosessien välisen suojan teknistä toteutusta. Sen tarkka sopimus ja
todennus valmistellaan ennen tuotantokytkentää.

**R18:n työluvan lähdekartoitus, ei toteutuspäätös:** kandidaattiruntime
odottaa jo `workspaceCandidateRunner`-luokassa `start`-viestiä ennen
`loadOperation`-kutsua. `electronWorkspaceCandidateRuntimeFactory` lähettää
sen nykyisen `ready`-viestin jälkeen; tämä ready ei vielä todista prosessien
välistä varausta. Tavallisen backendin `backendProcess` lähettää `start`-
viestin heti `spawn`-tapahtumasta. `backendRunner`-luokan nykyinen `ready`
lähetetään vasta `startServer`- ja migration-gate-ketjun jälkeen, joten sitä
ei voi käyttää ensimmäisen kirjoittavan työn ennakkovaltuutuksena.
Molempien polkujen mahdollinen suojattu työluvan siirto pitää siksi nimetä
erikseen nykyisissä viestisopimuksissa ennen tuotantokytkentää. Nykyinen
migration gate ja R17:n poistumis-/callback-todisteet säilyvät erillisinä.

Lisätodisteen pitää erottaa lapsen ennen työluvan saamista voittama varaus,
mainin kuolema suojatun valmiuden jälkeen ennen lupaa sekä jo jonossa olevan
luvan käsittely mainin kuoleman jälkeen. Näitä ei hyväksytä kolmen aiemman
kokeen perusteella. Parentin poistumisilmoituksen käsittely ei yksin suojaa
synkronisen työn aikana; kilpailevan mainin mutaatioiden poissulku ja uuden
luvan kelpoisuus ovat erillisiä ehtoja. Cold-admissionin paikka säilyy ennen
korjaavia journal-lukuja ja workspace-valintaa, ei vasta backendin forkissa.
Tämä lähdekartoitus ei muuta journal-formaattia, protokollaa tai vanhojen
keskeytyneiden operaatioiden yhteensopivuussääntöä.

##### R18: prosessivarauksen ja journal V2:n sopimusehdotus

**Rajattu tekninen toteutus ja testaus hyväksytty 8.10.2026.** Omistaja
hyväksyi alla kuvatun prosessivarauksen, työluvan ja journal V2:n sekä
niiden vaiheistetun todennuksen. Aiempi hyväksytty legacy-estopolitiikka
ja cold-terminal säilyvät. Tavoite on kytkeä nykyiset
create/import-recoveryt tuotantoon, ei lisätä yleistä lifecycle-kehystä.
Uusia riippuvuuksia, business-tietokannan migraatiota tai siirrettävän
varmuuskopion formaatin muutosta ei tehdä. Hyväksyntä ei vielä ole
toteutus- tai julkaisutodiste. Täsmällinen tekninen päätös kattaa:

1. **Varaus ja sen identiteetti.** Nykyisen Node `net` -rajapinnan paikallinen
   IPC-varaus kuuluu koko mainin validoimalle `userData`-juurelle, ei yksittäiselle
   profiilille, operaatiolle tai buildille. Windows käyttää nimettyä putkea;
   nykyisen Linux-kehityspolun vastaava vaihtoehto on abstrakti Unix-socket.
   Endpoint ei tarjoa komentoja tai TCP-palvelua; yhteydenotto ei anna työoikeutta.
   Nimi johdetaan yhden vakionimiavaruuden ja juurihakemiston todellisen
   tiedostoidentiteetin (`dev`/`ino`, bigint) tiivisteestä. Identiteetti luetaan
   mainin luotetusta juuresta ja varmennetaan uudelleen ennen siirtoa; lapsi
   varmentaa saman juuren yksityisesti saadusta kuvauksesta. Puuttuva, muuttunut
   tai epäluotettava identiteetti (myös nolla-inode), linkkijuuri tai tueton alusta estää suojatun
   työn; satunnaisnimeen, PID:hen tai pelkkään merkkijonopolkuun ei pudota.
   Saman hakemiston hyväksytyt polkualiaset sekä eri juurten erillisyys pitää
   todistaa nykyisillä runtimeilla ennen tuotantokytkentää. Juurta ei siirretä
   tai korvata käynnissä olevien runtimejen aikana. Varaus on yhteistyötä
   noudattavien Eky-prosessien poissulku, ei suoja saman käyttäjätilin hyökkääjää
   vastaan eikä vanhan suojaamattoman prosessin poissaolotodiste.
2. **Nykyisten käynnistyskanavien kaksivaiheinen työlupa.** Main omistaa ensin
   single-instance-lukon ja varauksen. Se valmistelee yhden nimetyn lapsen
   nykyiseen yksityiseen kanavaan sidotulla käynnistyssukupolvella. Varaus
   vapautetaan lapsen hankittavaksi vasta kun main ei tee ristiriitaista työtä.
   Lapsi saa ladata kirjoittavan backendin/validaattorin vasta hankittuaan
   varauksen, ilmoitettuaan sidotun varausvalmiuden ja saatuaan mainilta erillisen
   saman sukupolven työluvan. Main tarkistaa yhä oman omistajuutensa ja operaation
   ennen lupaa. Pelkkä fork, spawn, generic-ready tai jonossa oleva valmistelu
   ei käynnistä työtä. Backendin nykyinen application-ready ja migration gate
   säilyvät tämän jälkeisinä erillisinä ehtoina. Viestit validoidaan exact-key-
   sopimuksella; väärä, vanha tai ristiriitainen siirtymä estää työn. Nykyiset
   startup-/operation-/shutdown-aikarajat säilyvät koko ketjulle, eivät nollaudu
   joka vaiheessa. Työluvaton orpo ei aloita työtä ja poistuu rajatusti.
3. **Omistajuuden jatkuvuus.** Sekä business-backend että nykyisen candidate-
   factoryn bootstrap-, validointi-, migraatio- ja inventaariotyöt osallistuvat.
   Työtä tekevä utility pitää varauksen itse koko työn ja omistettujen kahvojen
   sulun ajan. Main ei tee kilpailevaa cold-recoveryä, profiilin vaihtoa,
   julkaisua tai poistoa lapsen työluvan aikana. Nykyiset samaa aktiivista
   runtimea palvelevat brokerit ja snapshot-suojat säilyvät omissa sopimuksissaan;
   varaus ei kiellä kaikkea mainin loki-/broker-työtä eikä korvaa R04:n fenceä.
   Mainin seuraava ristiriitainen mutaatio vaatii todetun lapsen exitin ja
   varauksen uudelleenhankinnan. Ulomman recoveryn aloittaminen vaatii lisäksi
   R17:n mukaisen keskeneräisen startup-callbackin valmistumisen. Saman
   `beforeMigrations`-callbackin jo omistama sulun jälkeinen migraatio- tai
   rollback-jatko ei odota omaa valmistumistaan: se säilyttää nykyisen
   operaatiovaltuutuksen ja vaatii exitin sekä varauksen takaisinoton.
   Näin ulompi recovery ei ohita keskeneräistä jatkoa eikä sisäinen jatko
   jää odottamaan itseään.
   Terminal-viesti, kill-paluu tai vapaa varaus yksin ei riitä. Varausvirhe tai
   epäselvä handoff sulkee mutation-admissionin ja säilyttää aineiston;
   varauksen vapautus ei saa edeltää yhä käynnissä olevaa kirjoitusta.
   Todetun exitin jälkeinen takaisinotto saa odottaa yhä varatun OS-resurssin
   vapautumista vain kutsujan nykyisen sulkumääräajan sisällä. Vain puhtaasti
   päättynyt `busy`-hankintayritys tarkistetaan uudelleen keskeytettävällä
   10 ms:n tahdistuksella; epävarmaa siivousta tai muuta virhettä ei uusita.
   Omistajuus ja täsmällinen siirtosukupolvi tarkistetaan joka yrityksellä,
   sama juuri-identiteetti vaaditaan ja myöhäinen hankinta vapautetaan.
   Odotus ei anna kirjoitusoikeutta. Aikaraja tai omistajuuden menetys jää
   suljetuksi virheeksi. Ensimmäinen ja kylmäkäynnistyksen hankinta eivät
   käytä tätä odotusta. Windowsin `busy`-luokka ei yksin todista toista
   omistajaa; myös siihen mapattu natiivi käyttöoikeusvirhe voi kuluttaa tämän
   saman rajatun odotuksen, mutta ei koskaan antaa omistajuutta.
4. **Uusien keskeytysten journal V2.** Create/import saavat eksplisiittisen
   `formatVersion: 2` -tyypin. Muut nykyiset kentät, slottipolut (myös niiden
   `-v1`-nimet), kokorajat ja current/backup/next-auktoriteetti säilyvät.
   Version merkitys on suojatun sopimuksen alaisena aloitettu operaatio, ei
   reaaliaikainen poissaolo tai recovery-lupa. V2 julkaistaan vasta nykyisen
   runtimen todetun sulun ja mainin varauksen jälkeen ennen candidate-kirjoitusta.
   V1 luetaan omana legacy-tyyppinään; sitä ei muuteta V2:ksi tai oleteta
   suojatuksi. Saman operaation versiota ei saa vaihtaa myöhemmässä kirjoituksessa.
   Erillistä sidecaria tai valinnaista `guarded`-kenttää ei lisätä. Vanhan
   lukijan pitää hylätä V2 muuttamatta slottisisältöä; tätä ei oleteta ilman testiä.
5. **Cold-admission ja uudelleenkäynnistys.** Vain lukeva journal-admission
   tapahtuu ennen korjaavia store-lukuja, plaintext-siivoamista tai workspace-
   valintaa. V1 ja tuntematon vanha kirjoittaja estävät automaattisen palautuksen
   aineistoa muuttamatta; yleistä ohitus- tai pakotetun siivouksen kyvykkyyttä
   ei lisätä. V2 vaatii tuoreen varauksen lisäksi nykyisen journalien keskinäisen
   admissionin, installation-leasen, build-portin ja omistajakohtaiset tarkistukset.
   Validaattori käyttää yllä olevaa siirtoketjua, minkä jälkeen main hankkii
   varauksen takaisin ennen loppumutaatiota. Production-lifecycle pyytää tällä
   hetkellä lykättyä relaunchia, ei välitöntä backend-starttia: tavallinen
   onnistuminen poistaa journalin ennen varsinaista relaunchia. Virheessä säilynyt
   journal käsitellään seuraavan startupin admissionissa ennen business-backendiä.
   Ordinary-recoveryn omat terveystarkistukset säilyvät; cold-terminal poistaa
   journalin vasta hyväksytyn tiedosto-/rekisteri-/jatkettavuustodisteen jälkeen.
   Journalin puuttuminen ei muutu yleiseksi vanhojen prosessien poissaolotodisteeksi.

**Rajattu tiedostokartta:** uusi runtime-adapteri
`workspaceProcessReservation.ts` ja sen kohdetestit omistavat varauksen sekä
identiteetin; nykyiset `backendMessages.ts` / `backendProcess.ts` /
`backendRunner.ts` ja `workspaceCandidateMessages.ts` /
`electronWorkspaceCandidateRuntimeFactory.ts` / `workspaceCandidateRunner.ts`
omistavat omat käynnistyssiirtymänsä. Mahdollinen yhteinen descriptor-/parser-
tiedosto sisältää vain saman varausarvon sopimuksen, ei uutta koordinaattoria.
Creation/importin nykyiset `Types`, `JournalValidation`, `JournalBytes`,
`JournalSerializer` ja `JournalStore` erottavat V1/V2:n. Nykyiset koordinaattorit,
recoveryt, `workspaceColdRecoveryAdmissionComposition` ja `desktopComposition`
kytkevät päätetyn järjestyksen; moduulien business-vastuut eivät siirry mainiin.

**Toteutusjärjestys ja hyväksyntä:** ensin nykyisen synteettisen kokeen puuttuvat
työlupajärjestykset sekä vakaan identiteetin ja Linux-vastineen näyttö. Orvon
voittama varaus ilman lupaa, parentin kuolema ennen lupaa sekä jonossa oleva lupa
parentin kuoleman jälkeen testataan tapahtumaohjatusti. Vasta sitten adapteri ja
molemmat nykyiset käynnistyskanavat, V1/V2-codecit ja transition-testit sekä
tuotannon startup/recovery-kytkentä. Fail-closed-hylkäyksen pitää säilyttää myös
plaintext ja kaikki auktoritatiiviset slotit; crash-before-grant, terminal-before-
exit, failed-exit, pending-callback, restart journalin poiston ympärillä ja
retained-journal-relaunch kuuluvat matriisiin. Onnistunut tavallinen käynnistys,
ordinary-recovery, backup ja update eivät saa muuttua virhepoluiksi.

**Rajattu varausnäyttö 8.10.2026:** kolme puuttunutta Windows-Electronin
työlupajärjestystä on todennettu nykyisen prosessivalvojan alaisina. Ilman
työlupaa varauksen saanut lapsi ei kirjoita; jo myönnetyn jonossa olevan luvan
käsittely mainin poistuttua ei päästä seuraajaa ristiriitaiseen työhön.
Hyväksytyt tapaustulokset vaativat sidotun worker-terminalin sekä koko omistetun
prosessipuun poissaolon. Ensimmäisen ajon kaksi hylkäystä säilyvät: koe ei
pitänyt työluvatonta lasta elossa seuraajan varausyritykseen asti. Vain niiden
koejärjestelyyn lisättiin nykyisen rajan sisäinen tapahtumaohjattu pito, ja
molemmat kohdetapaukset läpäisivät. Tämä ei ole tuotantovirheen korjaustodiste
eikä uusi aikaraja tai hyväksyntäpoikkeus.

Linuxin erillinen pieni prosessikoe todensi abstraktin paikallisen socketin
päällekkäisen varauksen eston sekä uudelleenhankinnan hallitun ja pakotetun
poistumisen jälkeen. Kokeet todensivat synteettisen juuren identiteetin
valituilla hyväksytyillä polkualiasilla ja eri juurten erillisyyden. Linux-koe
ei ole koko Electron-käynnistysketjun testi. Koekytkennän rajattu katselmus
sulki sulkemisen toteamista ja ensivirheen säilymistä koskeneet puutteet ennen
Windows-ajoa. Työluvattoman orvon tuotannon poistumismalli, journal V2 ja
tuotannon startup/recovery-kytkentä ovat edelleen toteutettavia ja
todennettavia; yllä olevat packaged- ja integraatioportit säilyvät.

**Adapteripala 8.-9.10.2026 (ei tuotantokytkentää):**
`workspaceProcessReservation.ts` toteuttaa hyväksytyn juuri-identiteetin,
paikallisen IPC-varauksen, omistajuuden uudelleentarkistuksen ja eksplisiittisen
vapautuksen ilman uusia riippuvuuksia. Sen
[käyttösopimus](local-desktop-implementation-plan.md#prosessivarauksen-adapteri-r18)
erottaa varauksen varsinaisesta työluvasta. Kohdetestit (28 yksikkötestiä ja
3 oikean IPC:n testiä) sekä desktopin tyyppitarkistus läpäisivät. Erillinen
Linux-prosessikoe todensi saman adapterin päällekkäisen omistajan eston ja
uudelleenhankinnan hallitun sekä pakotetun poistumisen jälkeen. Riippumaton
rajattu katselmus ei löytänyt korjattavaa; sen nimeämät kaksi testiaukkoa
(viivästynyt sulkukuittaus ja keskeytys bindin jälkeisessä identiteetin
tarkistuksessa) katettiin kohdetesteissä.

Ensimmäisen testivalmistelun hylkäykset erotetaan toteutuksen hyväksynnästä:
testinimessä ollut bigint-tulostus ja testiapurin valinnaisen kentän tyyppi
korjattiin muuttamatta adapterin ehtoja. Erilliskäännöksen valmistelussa
korjattiin kääntäjän työskentelykansio ja yksittäistiedoston asetuskutsu;
projektin normaali tyyppitarkistus on erillinen läpäissyt portti. R18 ei ole
valmis: tuotannon loki-/palautekytkentä, kahden käynnistyskanavan todennus,
journal V2 sekä hardened packaged-, update- ja PR/main-portit ovat avoinna.

**Viestikerroksen valmistelupala 9.10.2026:** yhteinen yksityinen varausarvo
sitoo kanonisen käynnistyssukupolven, juuri-identiteetin ja validoitavan
juuripolun. Se ei myönnä työlupaa tai väitä omistajuutta. Nykyisen backend-
kanavan käynnistys- ja statuslukijat hylkäävät ylimääräiset kentät.
170 kohdetestiä ja desktopin tyyppitarkistus läpäisivät; mukana ovat
myös nykyiset backendin käynnistys-/sulku- ja candidate-viestiregressiot.
Tämän jälkeinen koko desktopin testikierros läpäisi yllä ilmoitetuin määrin;
kohdeajon testejä ei summata siihen uudelleen.
Viestikerroksen riippumaton rajattu katselmus ei löytänyt korjattavaa.
Tämä on arvon ja lukijan näyttö, ei vielä kaksivaiheisen käynnistyksen,
työluvattoman orvon poistumisen tai palautuksen tuotantokytkennän todiste.

**Candidate-lapsen käynnistyspala 9.10.2026 (kytkentä kesken):** lapsi vaatii
erillisen, samaan pyyntöön sidotun työluvan hankitun varauksen jälkeen ennen
kirjoittavan moduulin lataamista. Kohdenäyttö kattaa väärän järjestyksen,
väärät sidonnat, varauksen menetyksen, keskeytyksen viivästyneen latauksen
aikana sekä alkuperäiseen käynnistysbudjettiin rajatun työluvattoman orvon.
133 kohdetestiä ja desktopin tyyppitarkistus läpäisivät. Ensimmäinen
tyyppitarkistus havaitsi parentin terminal-lukijassa uuden ei-terminal-viestin;
lukija hylkää sen turvallisesti eikä tulkitse sitä valmistuneeksi tulokseksi.
Rajattu katselmus löysi pre-import-polun kaksi puutetta: keskeytyksen jälkeen
valmistuva polkutarkistus saattoi vielä ladata moduulin, ja keskeneräinen
omistajuustarkistus esti määräaikaisen poistumisen. Molemmille lisättiin
rajattu korjaus ja regressio; todellinen lataaja ei arvioi synteettistä
moduulia peruutuksen jälkeen, eikä keskeneräistä tarkistusta odoteta ennen
pre-import-poistumista. Aloitetun kirjoittavan työn sulkuraja säilyy erillisenä.
Korjausdeltaan kohdistunut riippumaton jälkikatselmus ei löytänyt uutta
korjattavaa; katselmus ei kattanut vielä puuttuvaa parent-integraatiota.

**Candidate-parentin kytkentäpala 9.10.2026 (edelleen kesken):** nykyinen
factory odottaa mainin valmistelua, sidottua `reservationReady`-viestiä ja
tuoretta operaatiovaltuutusta ennen `start`-työlupaa. Asynkronisen tarkistuksen
jälkeen tehdään vielä synkroninen saman valtuutuksen tarkistus juuri ennen
lähettämistä. Tulosta ei anneta käyttöön ennen todettua exitiä, valmistelu-
ja lupacallbackien valmistumista sekä mainin varauksen takaisinottoa.
Keskeytys ei saa päästää myöhäistä callbackia lähettämään työlupaa.
Puuttuva exit, epäselvä protokolla tai epäonnistunut takaisinotto mitätöi
siirron pysyvästi; myös siivouksen kutsujan on kunnioitettava tätä tilaa.
Odotettua sidottua peruutuksen `failed`-terminalia ei sekoiteta
protokollavirheeseen. Nykyiset käynnistys- ja sulkubudjetit käyttävät
monotonista kelloa eivätkä pitene järjestelmäkellon muutoksesta.

Rajattu katselmus havaitsi nämä kolme tuoreen kytkentäkoodin puutetta:
asynkronisen lupatarkistuksen jälkeinen vanhentuminen, peruutuksen kuittauksen
virheellinen hylkäys ja seinäkelloon perustuvan sulkubudjetin venyminen.
Korjauksille lisättiin kohdetestit. Ensimmäisen kohdeajon testiaineiston väärä
tilanimi korjattiin nykyiseen `current`-sopimukseen, ei lukijaa lieventämällä.
Korjattu kohdekokonaisuus läpäisi 152 testiä ilman ohituksia. Mukana ovat
myös oikean parent- ja child-tilakoneen kytketyt peruutukset synteettisessä
viestikanavassa; ne eivät vielä todenna Electron-prosessirajaa tai mainin
oikeaa varausomistajaa. Dokumenttilinkkien tarkistus läpäisi.
Korjauksiin kohdistuneessa riippumattomassa jälkikatselmuksessa ei löytynyt
jäljellä olevaa korjattavaa tästä parent-kättelyn muutoksesta; tuotannon
main-omistajan kytkentä ei kuulunut tähän katselmukseen.

Varausomistaja on factoryn pakollinen riippuvuus, ei valinnainen ohitus.
Tämän parent-vaiheen tyyppitarkistus osoitti kolme kytkemätöntä tuotannon kohtaa:
`workspaceFirstStartMigrationComposition`, `workspaceActivationMigrationComposition`
ja `workspaceManagementComposition`. Alla oleva jatko korvaa tämän välitilan.
Tavallisen candidate-ketjun
toimintaa, packaged-hyväksyntää tai merge-valmiutta ei väitetä kohdetestien
perusteella. Virhesiivouksen on odotettava samaa poistumis- ja
takaisinottotodistetta; terminal tai start-Promisen hylkäys ei riitä.

**R18:n main-kytkennän rajattu jatko:** sama main-omistaja on nyt välitetty
edellä mainittuihin kolmeen compositioniin ja business-backendiin. Tuore
single-instance-tarkistus ja täsmällinen startup-/huoltolupa tarkistetaan myös
odotusten jälkeen. Create/import-virhesiivous ei aloita korjaavaa journalin
lukua tai aineiston poistoa, jos takaisinotto jää epävarmaksi. Yksi nykyinen
lifecycle ja huoltovaraus säilyvät. Kohdeajot läpäisivät: omistajuus ja
composition 53 testiä, laajennettu siivouskokonaisuus 108 testiä sekä
startupin turvalliset virhekoodit ja operational-kytkentä 78 testiä.
Ajot ovat päällekkäisiä, eivät yhteenlaskettava hyväksyntä. Desktopin
tyyppitarkistus läpäisi; E2E:n erilliset todennuskutsujat ovat vielä avoinna.
Omistaja-apurin katselmuksessa löytynyt varauksen hankinnan ja peruutuksen
välinen kilpailu korjattiin regressiolla. Tämän välitilan journal- ja
cold-recovery-jatko on alla. Koko tuotantokytkennän katselmus, diagnostiikan
koko lukuketju sekä paketoidut ja integraatioportit ovat edelleen tekemättä.

**R18:n journal- ja cold-recovery-kytkentä 9.10.2026:** uusien operaatioiden
V2, erillinen legacy-V1 sekä saman operaation versionvaihdon esto on toteutettu
nykyisissä codeceissa ja kirjoittajissa. Valittu V1 estää kylmäpalautuksen
ennen korjaavaa lukua tai siivousta. Journal-kokonaisuuden 378 kohdetestiä
läpäisi; erillinen historiallisella lukijalla ajettu 12 tapauksen koe todensi
V1:n lukemisen ja V2:n hylkäyksen muuttamatta current/backup/next-tavuja.
Se ei ole vanhan paketoidun sovelluksen hyväksyntätesti.

Startup lukee admissionin ennen korjaavia työtilatoimia, varmentaa buildin
ja käyttää nykyisiä recovery-luokkia saman varauksen sekä huoltoleasen alla.
V2-tuonti voi siivota oman plaintext-karanteeninsa; journaliton tai luontiin
liittyvä epäselvä plaintext estää avaamisen ja säilyy. Normaali business-
käynnistys ja terveystarkistus tapahtuvat vasta cold-terminalin jälkeen.
Omistajuus tarkistetaan uudelleen julkaistun kohteen validoinnin jälkeen
ennen siivousta ja jatkotyötilan lukujen jälkeen ennen journalin poistamista.

Rajattu käynnistys-/recovery-kokonaisuus läpäisi 200 testiä sekä desktopin
tyyppitarkistuksen. Mukana ovat oikea composition-kutsuketju synteettisellä
Electron-rajalla, kaikkien kolmen journal-slotin V1-esto ja V2-palautus,
ristiriitainen palautus, puuttuva jatkotyötila, uusi käynnistys sekä virheellinen
tietokanta journalin poiston jälkeen. Ajot ovat päällekkäisiä muiden
kohdeajojen kanssa. Ensihylkäykset säilyvät: kytkentämäärän ja uuden
omistajuustarkistuksen testiodotukset sekä testioperaation tyypitetty
polkurakentaja korjattiin ilman sopimusten lieventämistä.

Rajattu riippumaton katselmus löysi vielä startup-callbackin sulkuriskin:
exitin jälkeen takaisin saatu varaus saattoi vapautua, vaikka callback oli
yhä kesken. Sticky-invalidation estää nyt ulomman sulun. Oikean backend-
parentin ja compositionin hallittu regressio sekä jälkikatselmus hyväksyivät
korjauksen. Tämä ei korvaa julkaistun kohteen Electron-validointia, paketoitua
keskeytys/restart-todistusta tai C:n muita hyväksyntäportteja.

**R18:n testikutsujat ja julkaistun juuren rajattu todennus:** erilliset
ensikäynnistys-, aktivointi-, inventaario-, management- ja W6B-valmistelut
käyttävät nyt samaa nimenomaista prosessivarausta. Valmistelun ja tarkistuksen
varaus suljetaan ennen tuotannon compositionin avaamista, ja saman juuren
ehdokasvalmistelut suoritetaan peräkkäin. Vanhentunut testiapuri torjutaan
ennen tiedostomuutoksia. Ensivirhe ja siivouksen epäonnistuminen säilyvät
erillisinä; epäonnistuneen kokeen juurta tai migraatioprefiksiä ei poisteta.
Rajatut 15 apuritestiä ja erillinen E2E-tyypitys läpäisivät. Kahden
apurilöydöksen riippumaton jälkikatselmus ei jättänyt korjattavaa.

Julkaistun luonti- ja tuontikohteen kylmäpalautus testataan nyt oikealla
compositionilla ja kandidaattilapsen parentilla, mutta hallitulla Electron-
prosessirajalla. Neljä uutta tapausta odottaa todellista exit-havaintoa myös
terminal-viestin jälkeen, eikä journalia tai rekisteriä muuteta odotuksen
aikana. Epäonnistunut validointi säilyttää julkaistun aineiston ja journalin.
Tämän composition-tiedoston 62 testiä läpäisivät. Mukana on myös brokerin
sulkuvirhe kesken jääneen callbackin rinnalla: omistajuus lukitaan ennen
virhealttiita sulkuja, kaikki sulut yritetään ja ensivirhe säilyy.
Rajattu riippumaton jälkikatselmus hyväksyi tämän korjauksen. Kyseessä ei vielä ole
todellisen Electron-lapsen tai hardened-paketin hyväksyntä.

Todellisen Electron-kokeen viisi työtilatestiä hylkääntyivät ensimmäisen
ikkunan valmistelussa. Lähde ja talteen jäänyt vaihehavainto yksilöivät
testibackendin vanhan start-viestin: se ei sisältänyt parserin nyt vaatimaa
sukupolvea eikä toteuttanut varauksen siirtoa. Nykyinen testiadapteri on
sovitettu samaan prepare/reservationReady/grant-sopimukseen ja todelliseen
OS-varaukseen; main saa varauksen takaisin vasta lapsen poistuttua.
Rajatut 18 parent/child-regressiota, E2E-build ja riippumaton jälkikatselmus
läpäisivät. Aikarajat ja testin update-shutdownin hylkäys säilyvät.
Korjatulla kytkennällä kaikki viisi alkuperäistä Electron-testiä saavuttivat
ensimmäisen ikkunan. Startup/adoption läpäisi, mutta neljä muuta hylkääntyi
sulussa tai lähdetyötilan luonnissa. Rajattu erottelu osoitti takaisinoton
voivan epäonnistua heti lapsen exitin jälkeen ja onnistua myöhemmin samassa
mainissa. Yllä kuvattu nykyisen määräajan sisäinen takaisinotto ja sen
regressiot on toteutettu. Kaikki viisi todellista Electron-työtilatestiä
läpäisivät korjatulla kytkennällä; omistajan 26 regressiota sekä rajattu
riippumaton jälkikatselmus hyväksyivät takaisinoton rajat.
Ensihylkäyksiä ei merkitä onnistuneiksi eikä GitHubin ajoitusongelmaksi.

`DESK-WORKSPACE-STARTUP-001` kattaa lisäksi V2:n julkaistun tyhjän
luontikohteen ja tuontikohteen kylmäpalautuksen todellisella Electron-
kandidaatilla. Oikea composition varmentaa jatkotyötilan, poistaa journalin
ja pysähtyy tarkoitukselliseen testirajaan ennen business-backendin avaamista.
Koe vertaa täsmällistä rekisteriä sekä tietokanta- ja dokumenttitavuja ja
toistaa palautuksen samalla aineistolla. Molemmat polut läpäisivät.
Luontifixturen ensihylkäys korjattiin tyhjän yrityksen nykyiseen sopimukseen;
tuotannon validointia ei muutettu. Tämä ei vielä ole täysi business-restart
tai hardened-paketin näyttö. Myöhempi pelkän virhehaaran tarkennus säilyttää
ensivirheen ja varauksen siivousvirheen erillisinä sekä epäonnistuneen kokeen
aineiston; apurin ja omistajan 43 regressiota sekä katselmus läpäisivät.

Koko työtilan normaali testisarja läpäisi. E2E-järjestelmätestien kaksi
vanhaa kutsurajaa sovitettiin nykyiseen sopimukseen: testibackendin
prepare/grant-kättely ja Node-fixturen omistamien työkuormien todellinen
poistuminen ennen yrityksen luontikoordinaattorin jatkoa. Näiden 23
kohdetestiä läpäisivät. Node-fixture ei väitä todistavansa Electronin
OS-varauksen siirtoa. Kriittisen Electron-sarjan, puhtaan revision
paketoinnin, installer/update- ja PR/main-porttien hyväksyntä on erillinen.

Laaja kriittinen Electron-kierros läpäisi 44 tapausta ja hylkäsi yhden:
startup-palautustestin sisältöehdot täyttyivät, mutta sovelluksen kaikkien
prosessien määrä poikkesi alku- ja loppumittauksessa. Kohdennettu yksityinen
prosessilajit erottava koe läpäisi muuttamatta ehtoa. Se ei yksilöi
alkuperäisen poikkeaman syytä eikä muuta hylättyä kierrosta hyväksytyksi.
Yksi tämän jälkeen ajettu normaali kriittinen Electron-kierros läpäisi
kaikki 45 testiä samoilla ehdoilla. Ensihylkäys säilyy avoimena havaintona;
uutta lähdettä koskevat paketti-, PR- ja main-portit vaaditaan edelleen.

Paketoidun C-palautusnäytön valmistelu käyttää nykyistä smoke-kutsujaa:
erilliset V2 `rootPublished` -luonti- ja tuontisyötteet palautetaan oikean
paketoidun startupin kautta. Alkuperäinen aktiivinen työtila käy normaalin
backup/inspect/restore/restart-polun; palautettu toinen työtila säilyy
passiivisena. Molempien suljettujen vaiheiden jälkeen verrataan tarkka
rekisteri, kaikkien journal-slottien puuttuminen ja säilytettävät tietokanta-/PDF-tavut
todellisen varauksen alla. Valmistelun kolme regressiota, smoke-kutsujan
onnistumis-/virhepolut ja tyypitys läpäisivät. Varsinainen paketoitu ajo on
vielä tekemättä. Uusia sovelluksen testiohjaimia tai aikarajoja ei lisätty.

Diagnostiikan, tukipaketin tapahtumien ja incident-yhteenvetojen 31 lukutestiä
läpäisivät; varaus- ja kylmäpalautusvirheiden turvalliset koodit säilyvät
nykyisessä `desktop.bootstrapFailed`-projektiossa ilman yksityisiä polkuja
tai business-tunnisteita. Tämä on lukijasopimusten kohdenäyttö erillään
compositionin todellisesta operational-kirjoitustestistä ja paketoidun
sovelluksen koko HTTP-/UI-/tukipakettiketjun todennuksesta.

Käyttäjälle käytetään nykyistä turvallista recoveryRequired-palautetta ja
startupin nimettyjä virhekoodeja, ei raw-polkuja, putkinimiä tai identiteettejä.
Todellinen operational-tapahtuman ja diagnostiikan lukuketju varmennetaan;
uusi syykoodi lisätään vain omistavan nykyisen sopimuksen kautta tarvittaessa.
Tekninen käynnistyksen esto ei luo business-audit-tapahtumaa. Hyväksynnän jälkeen
ADR-0007/0011, workspace-/desktop-ohjeet, palautuksen runbook ja nykyinen
testimatriisi päivitetään toteutuksen mukana. Synteettinen näyttö ei korvaa
C:n packaged-keskeytys/restart-, backup/restore-, update- tai PR/main-portteja.

Rajattu riippumaton suunnitelmakatselmus vahvisti deferred-relaunch-järjestyksen
sekä journal-provenancen ja live-poissaolon eron. Sen pyytämä callbackin
itseodotuksen esto on täsmennetty yllä. Nykyisen tiedostolukijan sallima
nolla-inode ei ole varauksen hyväksytty identiteetti. Katselmus koski
päätösehdotusta, ei toteutuksen tai puuttuvien runtime-kokeiden hyväksyntää.

**R19:n rajattu toteutuspala:** oletus-build käyttää nyt täyttä
`git rev-parse HEAD` -tunnistetta. Ympäristösyötteen, vanhan 7-40 merkin
metadatan lukijan, manifestin ja trust-politiikan sopimuksia ei muutettu.
Tarkat Git-argumentit ja oikea tiedostopohjainen cache/trust-ketju on
testattu ilman `EKY_BUILD_REVISION`-ohitusta; Git-tuloste ja MSI-identiteetin
tarkastaja ovat tässä synteettisiä. Täysi identiteetti rekisteröityy ja
uudelleenvalidoituu; molemmat lyhyt/pitkä-suunnat sekä saman alkuosan
eri loppu hylätään ennen cache-slottia. Lukutestit säilyttävät 7, 12 ja
40 merkin tunnisteet muuttumattomina.

Integraatiokatselmus löysi RC-smoken ja W6B:n nykyrevision kuluttajista
vielä vanhan lyhennysodotuksen. Ne käyttävät nyt täyttä current-revisiota
valmistelusta descriptorin ja profiilitodisteen kautta jälkiehtoihin.
Lyhyt nykyrevisio ja saman alkuosan eri loppu hylätään; historiallinen
legacy-lähde ja RC:n aiempien julkaisujen identiteetit säilyvät muuttumattomina.
Rajatut kuluttajatarkistukset läpäisivät 218 ja 61 testiä (osittain päällekkäiset).
Lähdekatselmus ei jättänyt tämän rajauksen avoimia löydöksiä.

Rajattu release-/cache-/manifest-/trust-sarja läpäisi 62 testiä,
olemassa olevat installer-/paketointisopimukset 12 testiä ja desktopin
tyypitys läpäisi. Katselmuksen pyytämä vastakkaisen prefix-suunnan
regressio on mukana. Tuotantokorjaus koskee vain oletusrevision lukukomentoa;
riippuvuuksia, formaatteja tai tietokantoja ei muutettu.
[Versiointiohje](release-versioning-policy.md#paketoidun-buildin-identiteetti)
erottaa oletuskirjoittajan ja vanhan metadatan lukuyhteensopivuuden.
Puhtaan revision todellinen oletuspaketointi, installer-manifestin sidonta
ja nykyiset PR-/main-portit ovat edelleen avoimia; tätä alempaa näyttöä
ei lasketa R19:n tai C-kokonaisuuden loppuhyväksynnäksi.

**R03:n rajattu toteutuspala:** mainin update-handoff käyttää nyt nykyisen
lifecycle-ownerin strict-sulkua. Ordinary- ja update-kutsut jakavat
ensimmäisen tehtävän tuloksen; forced/unknown-tulos ei muutu gracefulksi,
eikä epäonnistunut strict-sulku käynnistä ordinary-fallbackia. Yksittäinen
capability-/broker-virhe ei estä muita sulkuja eikä mahdollista clean-merkkiä.
Lifecycle-/workspace-/main- ja operational-validoinnin sarja läpäisi
1 361 testiä; kaksi ennestään alustakohtaista testiä ohitettiin. Desktopin
tyypitys läpäisi. Aiempi lähdekooditesti vaati vanhan helperin täsmällistä
kirjoitusasua; se päivitettiin nykyiseen owner-kytkentään. Sulkujärjestyksen
toiminnallinen todennus säilyy lifecycle- ja composition-regressioissa.
Riippumaton koodikatselmus valmistui. Sen kaksi havaintoa korjattiin:
turvallinen ensisyy säilyy erillään siivousvirheistä, ja compositionin
kilpailutesti todentaa liittymisen vielä keskeneräiseen sulkuun. Näiden
korjausten kohdetestit, laajempi yllä nimetty sarja, tyypitys ja rajattu
jatkokatselmus läpäisivät. Julkinen lokisopimus ei muuttunut.
[Nykyohje](local-desktop-implementation-plan.md#päivityksen-hallittu-sulku)
ja desktopin AGENTS kuvaavat muuttuneen kytkennän. R04:n backend-fence,
hardened packaged backup/restore, installer-todennus ja PR/main-portit
pysyvät erillisinä avoimina ehtoina. R03:a tai C:tä ei vielä merkitä
kokonaisuutena hyväksytyksi.

**R04:n backend/broker-osatoteutus:** update-kohtainen begin/assert/end,
mitätöitymisen säilyttävä state ja version 8 tiukka sisäinen protokolla
ovat työpuussa. Backendin monotoninen deadline estää myöhäisen valtuuden
myös ennen ajastimen callbackia. Sulku omistaa keskeneräisen beginin;
jonossa odottava pyyntö ei hanki suojaa sulun jälkeen. Snapshotin ja
validoinnin tulos tarkistaa talteen otetun omistuksen odotuksen jälkeen.
Tavallisen backupin vapautus säilyy omana kontrollinaan.

Backendin maintenance-/snapshot-/HTTP-sarja läpäisi 77 testiä ja kaksi
ennestään alustakohtaista testiä ohitettiin. Desktopin backup-/runtime-/
update-sarja läpäisi 569 testiä ja yksi ennestään alustakohtainen testi
ohitettiin. Molempien pakettien tyypitys läpäisi. Rajattu riippumaton
lähdekatselmus ja sen jatkotarkistus valmistuivat ilman avointa löydöstä.
Jonojärjestyksen testit täsmennettiin katselmuksen perusteella: ne odottavat
pyynnön saapumista brokerin tilaajalle ennen snapshotin vapautusta tai sulkua.
Tämän 12 testin rajattu jatkoajo läpäisi; sarjoja ei lasketa yhteen.
Pakettirajat ylittävän testin erillinen tiukka tyypitys löysi lisäksi
fixturen kehämäisen tyyppipäätelmän. Siivouslistan rajattu eksplisiittinen
tyyppi korjasi sen; kohdetiedoston tyypitys ja lopulliset 24 kohdetestiä
läpäisivät. Sovelluskoodia tai testien vaatimuksia ei muutettu tämän vuoksi.

Rajapintatesti käyttää oikeaa statea, brokeria, clientia, HTTP-middlewarea
ja saman prosessin MessagePort-kanavaa; snapshotin sisältö on testisovitin.
Se ei ole todistus erillisen utility-prosessin exitistä, aidosta
palautuspisteestä tai paketoidusta päivityksestä. Uutta julkista tapahtumaa
tai virhekoodia ei lisätty; nykyiset turvalliset broker-koodit säilyvät.
Prepare/handoffin yhteinen omistus, caller-owned palautuspisteen
tuotantokytkentä ja saman operaation välitys graceful-exitin lähettäjässä
ovat seuraava R04-työ. Backendin vastaanottajan näyttö on eritelty alla. Näiden
todellinen palautteen/diagnostiikan kytkentä sekä packaged-/PR-/main-portit
ovat yhä avoinna. Sisäinen protokollaversio ei muuta pysyviä formaatteja.

**R04:n operation-sidottu sulkuvastaanottaja:** `backendMessages` hyväksyy
vain täsmällisen update-sulkuviestin ja saman operation-tunnistesäännön kuin
snapshot-broker. `backendRunner` vaatii valmistuneen startupin, tarkistaa
suojan ennen palvelimen sulkua ja odotuksen jälkeen sekä sulkee brokerit
vasta sen jälkeen. Ristiriitainen toinen update-pyyntö ja jokainen
sulkuvirhe säilyttävät epäonnistumisen; muut omistetut sulut yritetään.
Raakavirhettä, uutta julkista tapahtumaa tai pysyvää formaattia ei lisätty.
Runtime-/broker-sarjan 125 testiä ja desktopin tyypitys läpäisivät.
Riippumaton katselmus valmistui; sen nimeämä keskeneräisen startupin
regressio lisättiin ja läpäisi. Testit käyttävät oikeaa runner-listeneriä ja
parseria, mutta palvelin, broker-sulut, suojan tarkistus ja prosessin exit
ovat testisovittimia. Ensimmäinen testiajo pysähtyi synteettisen moduulin
lataukseen; testiaineisto korjattiin oikeaksi väliaikaiseksi ES-moduuliksi
ilman tuotannon loaderin, riippuvuuksien tai aikarajojen muuttamista.
Vastaanottajan osatestit eivät yksin todista mainin operation-välitystä,
oikeaa prosessipoistumista tai päivityksen valmistelu-/luovutusketjua.

**R04:n yhteinen owner ja lähetysketju:** preparation säilyttää saman
installation-leasen sekä update-suojan snapshotista handoffiin. Journalin
live-luku on muuttamaton ja recovery-slotit estävät live-valtuutuksen.
Ensimmäinen omistajuusristiriita tai lukuvirhe lukitsee epävarmuuden; sitä
ei tulkita uudelleen onnistuneella abort-lukukerralla. Kirjoitusyrityksen
epävarmuus alkaa ennen awaitia. Turvallinen pre-stop-abort vaatii tarkan
terminal-kirjoituksen/takaisinluvun sekä validin saman suojan; epävarma
kirjoitus, menetetty suoja tai aloitettu stop säilyttää omistuksen.
Main/lifecycle/process-sender ja packaged-koevälittäjät säilyttävät
operationin. Ordinary-first ei kelpaa updateksi edes exit-zero-tuloksella.

Desktopin laaja regressioajo läpäisi 2 170 testiä; kolme ennestään
alustakohtaista testiä ohitettiin. Erilliset 16 broker/HTTP-regressiota
läpäisivät, mukaan lukien coordinatorin viivästetty handoff, suojan
vanheneminen/katkos sekä turvallisen pre-stop-abortin vapautus.
HTTP-ketju käyttää oikeaa brokeria ja maintenance-middlewarea, mutta
snapshot-palvelu, journal ja runtime-stop ovat tässä testisovittimia.
Todellisen main-compositionin testissä on oikea journal-store mutta
kontrolloitu backend. Ensimmäinen laajempi ajo hylkäsi vanhan ordinary-
sulun hyväksyvän testiodotuksen; odotus muutettiin uuden operation-
sopimuksen mukaiseksi. Ensivirhe säilyy, testirajoja ei lievennetty.
Riippumaton katselmus löysi kertaluonteisen journal-epävarmuuden
vapautusriskin; korjaus ja kaksi once-only-regressiota on tarkistettu.
Oikeaprosessi-, packaged-, PR- ja main-portit ovat edelleen avoimia.

R04:n oikeaprosessinäyttö kohdistetaan nykyisen W6B.2-ketjun
`sourceHandoff`-vaiheeseen: `desktopComposition` antaa testiohjaimelle saman
tuotannon handoff-coordinatorin, joka käyttää update-suojaa ja strict-sulkua.
`buildW6b2PackagedSuccessInstallers` vaatii lähde- ja kohdepaketille saman
puhtaan revision. Synteettiset versionumerot eivät tarkoita vanhaa runtimea;
lähteen historiallinen valmistelu rajaa migraatiojoukkoa, ei vaihda
desktopin tai backendin ajokoodia. Normaali success-polku ja nykyinen
`preUpdateRecoveryPointFailure` säilyvät eri todisteina. Tavallinen packaged
backup/restore-smoke käyttää ordinary-sulkua eikä yksin todista R04:ää;
myöskään historiallisen legacy-lähdepaketin ajo ei korvaa korjatun lähteen
handoffia. Rajatut 59 builder-/lifecycle-sopimustestiä ja 50 proof-controller-
tarkistusta läpäisivät. Ne käyttävät testisovittimia eivätkä ole MSI-asennus-
tai oikean utility-prosessin hyväksyntä. Seuraava packaged-ajo tehdään vasta
puhtaasta katselmoidusta revisiosta nykyisillä eristys- ja hyväksyntärajoilla.

SourceHandoffin success-koetta on täydennetty työpuussa aidon
HTTP-kirjoitusrajan tarkistuksella. Main käyttää samaa muistissa pidettyä
runtime-sessionia ja loopback-backendia: kiinteä virheellinen JSON-pyyntö
asiakasreitille antaa ennen valmistelua 400:n ja palautuspisteen jälkeen,
ennen handoffia, 503:n sekä `PROFILE_MAINTENANCE_ACTIVE`-koodin.
Virheellinen JSON ei voi luoda asiakasta myöskään suojan puuttuessa.
Väärä vastaus estää koehandoffin nykyisellä turvallisella concurrency-
virhekoodilla. Tämä ei muuta sovelluksen julkista HTTP-pintaa, normaalia
päivityskulkua, fault-skenaarioita tai supervisorin määräaikoja. Alemmat
koeohjaimen ja vastausluennan regressiot eivät korvaa paketoitua todistusta.
Rajatut 71 probe-/success-/fault-controller-testiä ja desktopin tyypitys
läpäisivät. Mukana ovat vaiheiden valmistumisen odotus, osissa saapuvan
vastauksen kokoraja sekä luku- ja peruutusvirheet. Olemassa oleva backendin
virheellisen JSON-pyynnön testi läpäisi ja todensi, ettei create-palvelua
kutsuta. Rajattu riippumaton toteutus- ja täydennyskatselmus valmistui ilman
avoimia löydöksiä. Todellinen paketoitu HTTP-/utility-/handoff-ketju on
edelleen erillinen tekemätön hyväksyntäportti.

**R04:n caller-owned palautuspistepalvelu:** nimetty
`createPreUpdateWithMaintenance(operationId)` on työpuussa. Suoja
varmennetaan ennen snapshotia ja tallennusta sekä siivouksen jälkeen ennen
onnistumista. Snapshot-/validointivastauksen epävarmuus sallii stagingin
poiston vain nykyisen broker-jonon rajatun kuittauksen jälkeen. Säilytetty
ensivirhe ei vaihdu kuittauksen virheeksi eikä myöhäinen vastaus käynnistä
siivousta. Uusi polku ei kutsu begin/end-metodeja. Tavallinen backup ja
pre-migration säilyvät ennallaan.

Palvelun 19 kohdetestiä sekä backup-/profileProtection-sarjan 269 testiä
läpäisivät; yksi ennestään alustakohtainen testi ohitettiin. Uuden testin
Promise-apu ei aluksi sopinut nykyiseen TypeScript-kohteeseen. Testiapuri
sovitettiin nykyiseen kohteeseen ilman kielitason tai riippuvuuksien
muutosta; tyypitys ja 19 kohdetestiä läpäisivät tämän jälkeen.
Todellinen broker-client todentaa kahden aikakatkaisun jälkeen myöhäisten
vastausten hylkäyksen; remote-snapshot ja palautuspistetallennus ovat tässä
palvelutestissä testisovittimia. Tämä ei vielä todista oikeaa utility-
prosessia, salattua palautuspistettä tai koko päivitysketjua. Vanha
`createPreUpdate()` on poistettu yhteisen omistuksen kytkennässä;
handoff käyttää vain caller-owned palautuspistepolkua.
Rajattu riippumaton kahden lähdetiedoston katselmus valmistui ilman
korjattavaa löydöstä. Päivitettyjen omistavien ohjeiden ja desktopin
lukureitin 267 suhteellista linkkiä ja otsikkoankkuria läpäisivät tarkistuksen.

**R17:n rajattu toteutuspala:** startup-omistaja lukitsee ensikoodin ennen
lopetuspyyntöä, odottaa poistumista nykyisellä rajalla ja palauttaa
muuttumattoman absent/unknown- ja callback-settled-havainnon. Composition
ei tulkitse puuttuvaa backend-kahvaa pysähtyneeksi runtimeksi. Hallitun
startup-stopin alkuperäinen migraatiotakaraja säilyy; epäonnistunut,
myöhäinen tai kesken oleva valmistelu ei avaa recoveryä. Shutdownin
exit-kuuntelija asennetaan ennen viestiä myös tavallisessa sulussa.
Ennen pyyntöä tapahtunut odottamaton exit ei muutu graceful-todisteeksi.

Nykyisen runtime-/workspace-/composition-kohteen 916 testiä läpäisivät;
kaksi ennestään alustakohtaista testiä ohitettiin. Desktop-tyypitys läpäisi
vakaan kahvareferenssin korjauksen jälkeen. Näyttö kattaa synkronisen,
myöhäisen ja puuttuvan exitin, kill-/viestipoikkeamat, callback-kilpailut,
alkuperäisen takarajan sekä normaalin polun. Oikea startup-toteutus
on lisäksi ajettu compositionin kautta kontrolloidulla Electron-prosessilla:
todettu poissaolo sallii nykyisen lähdetyötilan recoveryn, epävarma fork
säilyttää journalit/tavut ja turvallinen ensikoodi löytyy oikeasta
operational-lokitiedostosta. Prosessi on tässä kontrolloitu, ei packaged-
hyväksyntä. R17:n riippumattomassa koodikatselmuksessa ei jäänyt
korjattavaa löydöstä; lisäregressiot täydentävät havaintorajoja.
[Omistava käyttöohje](local-desktop-implementation-plan.md#käynnistyksen-omistajuus-ennen-backend-kahvaa)
ja desktopin AGENTS on päivitetty. Seuraavaksi ratkaistaan R18:n
admissionin cold-start-kytkentä sekä muut
vielä avoimet C-sopimukset. Yhteinen packaged- ja integraationäyttö
vaaditaan edelleen ennen C:n hyväksymistä.
R17:n ohjepäivityksen 282 suhteellista linkkiä/ankkuria sekä
`git diff --check` läpäisivät.

### B3-B5:n integraatiohistoria

Alla olevat checkpointit kuvaavat hyväksyntää edeltäneitä revisioita.
Nykyinen hyväksyntä on [PR #298:n loppuyhteenvedossa](https://github.com/eky-software/eky/pull/298#issuecomment-6050339146);
vanhojen hylkäysten tuloksia tai syyepävarmuutta ei kirjoiteta uudelleen.

### B3-B5:n normaalin integraatiokierroksen testisopimukset

Revision `0feabeeab441170713e362b786c79a2086511dc3`
[V2-kierros 37701326723](https://github.com/eky-software/eky/actions/runs/37701326723)
hylättiin testien valmistelu- ja sopimusporteissa. Webin ja Electronin
kriittiset käyttäjäpolut läpäisivät. Erillinen
[riippuvuustarkistus 37701326643](https://github.com/eky-software/eky/actions/runs/37701326643)
läpäisi. Tämä ei hyväksy koko integraatiota tai muuta aiempien hylkäysten
tuloksia. Ensivirheet säilytetään ennen korjausrevision normaalia kierrosta.

Rajattu korjaus koskee viittä testikytkentää: lukitun pnpm:n työluettelo
sisältää myös hyväksytyn synteettisen poistumiskokeen, upgrade-workflowtesti
rajaa vain omistavan jobin, legacy-ryhmien suljettu inventaario sisältää jo
ajossa olevan migraatiotodisteen ja oikean loggerin testi vertaa aikaleimaa
kirjoitettuun tapahtumaan. ASAR-työkalu ladataan vasta vaaditussa paketin
lukemisessa, ei riippuvuudettomien supervisor-sopimusten importissa.
Puuttuva työkalu hylkää varsinaisen pakettisidonnan, eikä synny unpacked-
varapolkua. Paketin sisältö-, eheys- ja siivousehdot säilyvät ennallaan.

Kohdistetut 190 tarkistusta, 232 tarkistuksen legacy-ketju ja 149 tarkistuksen
native-supervisor-sarja läpäisivät; joukot ovat osin päällekkäisiä.
Tyypitys ja omistavien ohjeiden linkit läpäisivät. Riippumaton katselmus ja
uuden täsmällisen revision PR/main-portit vaaditaan edelleen.
Tässä palassa ei muuteta sovelluskoodia,
tietomallia, riippuvuusversioita, aikarajoja tai prosessiomistajuutta.

Tämän korjausrevision
[V2-kierros 37703655890](https://github.com/eky-software/eky/actions/runs/37703655890)
toisti workspace-success-jälkiehdon hylkäyksen molemmissa toistoissa.
Varsinainen skenaario, business-sisällön säilyminen ja siivous valmistuivat;
checkpointin kenttäsopimus hylkäsi yhteisestä legacy-lukijasta tulleen
aikaleiman. Oikean loggerin kautta kulkeva rajattu regressio toisti saman
keräys–validaattoriristiriidan. Korjaus rajaa workspace-projektion sen
nykyisiin viiteen identiteettikenttään; virhetapahtumat säilyvät hylkäävinä
ja legacy-ensivirheen laajempi aineisto säilyy. Kenttä-, sisältö-, eheys-,
siivous- ja CI-vaatimuksia ei lievennetä. Uuden revision omat normaalit
PR/main-portit tarvitaan edelleen ennen B3-B5:n hyväksyntää.
Korjauksen kohdesarja läpäisi 77 tarkistusta ja kanoninen workspace-sarja
333 tarkistusta ilman ohituksia; joukot ovat osin päällekkäisiä.
Desktop-tyypitys ja omistavien ohjeiden linkit läpäisivät.

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

[Saman revision seuraava kertatodennus](https://github.com/eky-software/eky/actions/runs/37643766654)
valmistui hylättynä. Kaikki 12 valmisteluryhmää ja paketin valmistus
läpäisivät. Molemmat legacy-toistot hylättiin `targetFirstStartup`-vaiheessa
koodiin `targetBootstrapFailed` ennen myöhempää aikakatkaisua. Siivousvaiheet
ja paketin jälkivarmennus valmistuivat; näistä ei seuraa sovelluksen
käynnistys- tai migraatiohyväksyntää.

Molempien salatut virhepaketit sekä alkuperäinen asennuspaketti on säilytetty
ja niiden palvelutiivisteet sekä suoritus-/revisiosidonta varmennettu.
Salatun sisällön purku ja tiedostokohtainen sidonta on tämän jälkeen
varmennettu. Molempien alkuperäinen käynnistyshylkäys rajautuu
pre-migration-tietokantasnapshotiin. Semanttinen siivous, täsmällisten
asennustuotteiden poissaolo sekä omistetun fixturen poistuminen varmistuivat
erikseen. Tämä ei vielä yksilöi snapshotin sisäistä alkuperäistä poikkeusta.

**Rajattu snapshot-polun korjaus:** syntetisoitu pitkän staging-polun
regressio toisti sovelluksen käynnistysportin hylkäyksen. SQLite-kopiointi
ja sen kaksi readonly-validointia käyttävät nyt ajurirajalla Noden
`toNamespacedPath`-muunnosta. Se tukee Windowsin pitkää tiedostopolkua;
muilla alustoilla polku säilyy ennallaan. Runtime-juuria, tiedostonimiä,
manifestien loogisia polkuja, katalogia, migraatiopolitiikkaa tai
tiedostoturvallisuuden tarkistuksia ei muuteta. Kopiota ei siirretä
lyhyempään julkiseen temp-kansioon.

Regressio kattaa historiallisen ja nykyisen skeeman sekä säilyneen PDF:n
samassa compositionissa ja tarkistaa myös snapshotin jälkivalidoinnin.
Rajattu snapshot-/composition-sarja läpäisi 59 testiä; kaksi olemassa olevaa
alustakohtaista ohitusta eivät ole läpäisyjä. Backendin tyypitys ja
riippumaton rajattu katselmus läpäisivät. Jäädytetyn korjausrevision
`5cd9ef1475ee03e8449c331583ed4bd0e118047e` hardened Windows -paketointi ja
backup -> inspect -> restore -> restart -> compare -smoke läpäisivät.

[Saman revision nimetty legacy-todennus](https://github.com/eky-software/eky/actions/runs/37653984615)
päättyi GitHubin `Internal server error` -ilmoitukseen ennen kahden
varsinaisen päivitysjobin luomista. Kaikki 12 valmisteluryhmää ja vanhan sekä
uuden paketin valmistus läpäisivät. Alkuperäinen paketti on säilytetty ja sen
palvelutiiviste sekä revisiosidonta varmennettu. Päivitysajoa ei merkitä
läpäistyksi eikä tämän palveluvirheen perusteella tehdä sovelluskorjausta.
Alkuperäisen snapshot-hylkäyksen juurisyytä ei nimetä varmaksi pelkän
paikallisen toiston perusteella.

[Saman paketin rajattu caller-koe 37657587639](https://github.com/eky-software/eky/actions/runs/37657587639)
läpäisi valmistelun ja artifactin tarkistuksen, mutta jäi skenaariovaiheen
terminal-odotukseen. Ajo peruttiin eikä jälkikeräys valmistunut. Sovelluksen
sisäinen vaihe, lopullinen prosessi- ja asennussiivous sekä juurisyy eivät
varmistuneet. Tätä ei yhdistetä snapshot-korjauksen syyksi eikä hyväksynnäksi.

**Nykyinen integraatiojatko:** olemassa olevaan havaintoketjuun lisätään
[rajattu työntekijä- ja terminal-odotuksen erottelu](windows-installer-acceptance-harness-v2.md#legacy-työntekijän-eteneminen-terminal-odotuksen-aikana).
Omistettu prosessi on skenaariovaiheen Node-työntekijä; supervisor vaatii
sen poistumiskuittauksen ja koko Jobin tyhjenemisen ennen tiukkaa terminalin
lukua. Suljetut havainnot erottavat valmistelun, lifecycle-vaiheen, lapsen
poistumisen, tuloksen julkaisun ja supervisorin odotusluokan. Uutta loggeria,
supervisoria, kriittistä kirjoitusodotusta tai aikarajan muutosta ei lisätä.
Synteettinen odotus ja ennen terminalia poistuva lapsi, normaalin onnistumisen
säilyminen sekä nykyinen kanavan siivous on kohdetodennettu; riippumaton
katselmus ei löytänyt avointa korjauskohtaa. Nopea onnistuminen ei vaadi
valinnaisen viestin toimitusta. Puuttuva terminal tai perutun ajon jälkikeräys
ei anna siivouskuittausta.

Nimetty [havaintokoe 37674889811](https://github.com/eky-software/eky/actions/runs/37674889811)
käytti jäädytettyä harnessia ja samaa hyväksyttyä pakettia. Se päättyi
`targetFirstStartup`-hylkäykseen, ei uuteen pitkään odotukseen: kohdesovelluksen
sekä sulkupyynnön poistumiset ja tiukan hylkäystuloksen julkaisu havaittiin.
Prosessipuun poissaolo, semanttinen asennussiivous ja tarkkojen tuotteiden
poissaolo varmennettiin erikseen. Fixture jäi säilytettäväksi; sen poistoa
ei merkitä onnistuneeksi. Artifactin jälkivarmennus sekä salatun aineiston
toimitus ja sidottu purku läpäisivät. Tämä ei sulje perutun ajon vanhaa
odotushavaintoa eikä todista nykyisen jälkitarkistuksen juurisyytä.

Rajattu lähdetarkistus löysi nykyisestä luokittelusta puutteen:
profiilin jälkitarkistuksen ennalta nimetyt hylkäykset katosivat yleisen
käynnistysvaihekoodin taakse. Nykyinen syykoodiluettelo täydennetään ja
neljä muuttumatonta sisältövertailua erotetaan. Tuntematon virhe säilyy
yleisenä, eikä sisältö- tai siivousvaatimuksia muuteta. Ennen mahdollista
uutta nimettyä todentamista vaaditaan regressio ja oikean prosessirajan
näyttö sekä katselmus. Seuraava epäonnistuminen voi silloin erottaa
hyväksytyn buildin, rekisterin, adoption jäämän tai tarkan sisältövertailun
hylkäyksen; sama yleinen vaiherivi ei yksin perustele uutta pitkää ajoa.

**Syyn rajaus 7.10.2026:** [nimetty syykooditodennus 37680733028](https://github.com/eky-software/eky/actions/runs/37680733028)
käytti harness-revisiota `f39407078b9184689962ed198ce471deda798ba3`
ja samoja sovelluspaketin `5cd9ef14`-tavuja. Ensimmäisen käynnistyksen
jälkitarkistus hylkäsi tuloksen koodilla
`WINDOWS_ACCEPTANCE_LEGACY_ADOPTED_DATA_MISMATCH`. Suljettu ensimmäinen syy
säilyi callerin tuloksessa myös prosessin poistumisen jälkeen; salatun
aineiston sidonta, purku ja tiedostotiivisteet varmennettiin. Prosessipuun
poissaolo, semanttinen asennussiivous ja tarkkojen tuotteiden poissaolo
läpäisivät erikseen. Fixture jäi jälleen säilytettäväksi, eikä sen poistoa
merkitä läpäistyksi. Tämä hylkäys ei ollut deadline eikä normaali hyväksyntä.

Rajattu lähdevertailu osoitti sopimusristiriidan: historiallinen lähde
`6ed99f53` sisältää migraatiot 001–038 ja kohde `5cd9ef14` myös hyväksytyn
039-migraation. `captureLegacyTargetEvidence` vertaa ensimmäisen
käynnistyksen jälkeistä koko data-inventaariota silti alkuperäiseen
lähdeinventaarioon. Migraation schema- ja historiakirjoitukset muuttavat
SQLite-tavuja tarkoituksellisesti. Tämä ei yksin osoita, että todetun ajon
kaikki erot olivat sallittuja tai että liiketoimintatiedot säilyivät oikein.

Tästä edettiin omistajan hyväksymään [migraatiotodisteen
rajattuun korjaukseen](#legacy-testin-038039-migraatiotodisteen-korjausehdotus).
Alkuperäisen lähteen, PDF:ien, tiedostotyyppien, sisällön ja hyväksytyn
migraation tarkistukset säilyvät. Uutta diagnostiikkakerrosta ei lisätä;
korjauksen näyttö ja vielä avoin hyväksyntä ovat alla olevassa checkpointissa.

Rajattu diagnostiikkakoe ei ole normaali PR-hyväksyntä. PR #298:n vanhaa
`394e09730426e7556f8b29ed380838bc4f90a10b`-headia ei mergetä. Kun rajattu
näyttö täyttyy, sen lineaarinen jatko viedään PR:n täsmälliseksi headiksi
ja kaikki nykyiset PR- sekä uuden mainin portit vaaditaan erikseen.
B3-B5:n hyväksyntä ja merge ovat edelleen avoinna.

#### Legacy-testin 038–039-migraatiotodisteen korjausehdotus

**Tila: omistajan jatkoluvalla rajattu toteutus käynnissä, ei vielä todennettu.**
Tämä kuuluu nykyisen B3-B5-integraation rajaukseen. Sovelluksen migraatioita,
liiketoimintasopimusta, moduulirajoja tai prosessien omistajuutta ei muuteta.

**Paketoidun ajon uusi hylkäys ja rajattu korjaus.** Nimetty ajo
`37691934073` revisiosta `d9248549` läpäisi historiallisella lähteellä
asennuksen, käynnistyksen ja business-polun sekä kohteen major-upgraden,
mutta hylättiin `legacyDatabasePackageBindingInvalid`-syyllä ennen kohteen
sovelluskäynnistystä. Prosessipuun poissaolo, exact-tuotesiivous,
fixture-poisto ja artifactien jälkivarmennus läpäisivät erikseen. Tämä ei
ollut timeout eikä sovelluksen bootstrap-hylkäys. Ensivirheen salattu
aineisto säilytettiin ja varmennettiin.

Testilukija oletti `resources/app/dist/build-info.json`-tavallisen
tiedoston, vaikka muuttumaton alkuperäinen MSI sisältää tunnistetiedot
`resources/app.asar`-arkistossa. Sama hylkäys toistettiin alkuperäisistä
pakettitavuista staattisesti ilman asennusta; SQL-ketju vastasi sopimusta.
Testifixturen aiempi tavallinen hakemisto peitti tämän puutteen. Omistaja
hyväksyi jo lukitun `@electron/asar@4.2.1`:n suoran testityökalusidonnan.
Lukija ja fixture käyttävät nyt todellista ASAR-muotoa ilman vaihtoehtoista
polkua tai testiehtojen lievennystä. Korjattu staattinen luku läpäisi samat
alkuperäiset pakettitavut. Production- ja full audit sekä 160
rekisteriallekirjoitusta läpäisivät. Rajatut alemmat regressiot 222/222 ja
desktopin tyypitys läpäisivät; mukaan kuuluu ASARin väärien jäsenmuotojen
hylkäys, välimuistin vaihtuminen sekä worker/caller/postcondition-ketju.
Riippumaton rajattu katselmus ei löytänyt korjattavaa.

ASAR-korjauksen nimetty Windows-ajo `37696523242` revisiosta `daa26068`
läpäisi kohdepaketin sidonnan. Kohdesovellus käynnistyi ja sulkeutui
hallitusti, mutta ensimmäisen käynnistyksen sisältötodiste hylättiin
`legacyDatabaseCatalogInvalid`-syyllä. Tämä on uusi katalogihavainto,
ei vanhan ASAR-virheen uusiutuminen tai timeout. Salattu ensivirheen aineisto
säilytettiin ja sen sidonta sekä kaikki 42 talteenotettua otetta varmennettiin.
Prosessipuun poissaolo ja exact-tuotesiivous todettiin erikseen; fixture
säilyi varmentamattomana, eikä koko siivousta merkitä hyväksytyksi.

Rajattu lähdetarkistus osoitti testin toisen polkuoletuksen: tietokannan
PDF-viite on moduulijuureen suhteellinen, mutta lukija vertasi sitä koko
`runtime/storage`-inventaarioon. Myös fixture kopioi aiemmin moduuliprefixin
tietokantaviitteeseen ja peitti virheen. Oikea runtime-layout ja
moduulisuhteellinen viite toistivat katalogihylkäyksen paikallisesti kolmessa
tapauksessa. Lukija johtaa nyt prefixin nykyisestä polkuomistajasta; täysi
tiedostojoukko, hash-, koko-, tyyppi- ja read-only-ehdot säilyvät.
Polkukorjauksen sama yhdeksän tiedoston baseline-ketju läpäisi 231/231
testiä. Mukana ovat sekä nykyiset kuluttajat että moduulijuuren ulkopuolisen,
puuttuvan, muuttuneen ja ylimääräisen PDF:n sekä väärän katalogikoon
hylkäykset. Riippumaton rajattu katselmus ei löytänyt korjattavaa.
Seuraava näyttö on yksi nimetty jäädytetyn revision Windows-ajo samalla
alkuperäisellä paketilla. Sen näyttö, normaalit PR-portit ja uuden mainin
portit ovat yhä avoimia.

**Todettu ristiriita.** Historiallisen lähteen ja kohteen migraatiot 001–038
ovat samoja SQL-tavuja; kohde lisää 039:n. Myös historiallinen runner
kirjoittaa `schema_migration_metadata`-taulun: puuttuvan tai ristiriitaisen
metadatan salliminen ei kuulu tämän nimetyn testiaineiston korjaukseen.
039 luo revision tunnisteet `randomblob`-kutsulla ja säilyttää vanhat lasku-,
rivi-, dokumentti- ja tapahtumakentät. Siksi kahden erikseen oikein
migroidun kopion koko SQLite-hashkaan ei ole sopiva odotusarvo. Tunnettua
ristiriitaa ei ratkaista uusinnalla, hyväksymällä ensimmäinen kohde
sellaisenaan tai muuttamalla migraation tunnisteiden muodostamista.

**Ehdotettu todistusraja:**

1. Historiallisen lähteen koko `data` ja `storage` säilyvät alkuperäiseen
   inventaarioon nähden byte-identtisinä. Kohteen tiedosto- ja hakemistoluettelo,
   tiedostotyypit, linkki-/polkurajat sekä kaikki muut kuin täsmälleen nimetty
   `eky.sqlite` säilyvät nykyisessä tarkassa vertailussa. Kaikki PDF-tavut,
   koot ja tiivisteet sekä niiden tietokantaviitteet tarkistetaan; PDF:ää ei
   muodosteta uudelleen.
2. Vain todistettu 038→039-siirtymä saa käyttää alla olevaa tietokannan
   sisältövertailua ensimmäisellä kohdekäynnistyksellä. Sama migraatioketju
   käyttää edelleen koko tiedoston byte-vertailua. Tuntematon siirtymä,
   väärä SQL-tiiviste tai puuttuva todistus hylätään, ei ohiteta.
3. Odotuksen omistaa testikohtainen, versionhallittu 038/039-sopimus.
   Se sitoo historiallisten ja uusien SQL-tavujen tiivisteet sekä odotetut
   schema-objektit, kentät ja sidokset. Sopimus muodostetaan ja katselmoidaan
   muuttumattomasta SQL-ketjusta ja nykyisistä migraatioregressioista, ei
   epäonnistuneen kohteen sisällöstä. Sen suljettu rakenne sisältää
   sopimusversion, lähde-/kohdeketjun tiivisteet, migraatioiden nimikohtaiset
   tiivisteet sekä kummankin scheman tarkat objektit ja sarakkeet. Schema-
   odotus johdetaan tyhjään eristettyyn testikantaan ajetusta hyväksytystä
   ketjusta ja tallennetaan testisopimuksena; sitä ei opita tutkitusta
   business-profiilista. Kohteen SQL-ketju luetaan jo
   payload-identiteetiltään varmennetusta asennuspaketista; checkoutin
   nykyinen versio ei korvaa paketin identiteettiä. Schemaan kuuluu myös
   indeksien, triggerien, constraintien ja SQLite-managed-objektien tarkka
   odotettu joukko. Yleistä tuntemattomien objektien poissulkua ei lisätä.
4. Kaikkien alkuperäisten taulujen kaikki alkuperäiset sarakkeet ja rivit
   verrataan arvo-, tyyppi- ja monikertasäilyttävästi. Pelkkä rivimäärä,
   valikoidut summat tai olemassa olevan W6B.2-fixturen seitsemän rivin
   projektio eivät riitä. Audit-, identiteetti- tai historiatauluja ei
   ohiteta yleisellä listalla. Vanhan migraatioledgerin rivit säilyvät
   täsmälleen; vain nimetty 039-rivi ja sen oikea metadata saavat tulla lisää.
   Uuden rivin aika validoidaan sovitun kanonisen aikaleimasopimuksen mukaan
   ja sen on oltava sama kuin metadatan `recorded_at`. Metadatan alkuperä on
   `applied`; release ja runtime-build vastaavat varmennetun paketin
   build-identiteettiä, eivät vain syntaktisesti kelvollista versiota tai
   SHA:ta. SQL-/ketjutiivisteet sidotaan samaan kohdepakettiin. Uuden ajan
   tarkkaa kellonaikaa ei arvata eikä vanhoja aikaleimoja normalisoida.
5. Uudet revisiot tarkistetaan täydellisenä suhteena alkuperäisiin laskuihin,
   riveihin ja hyvityslähteisiin. Tunnisteiden muoto, yksikäsitteisyys,
   täsmällinen lukumäärä ja kaikki ristiinviitteet vaaditaan; tunnisteita ei
   vain poisteta vertailusta. 039:n tunniste on 32 pientä hex-merkkiä, ei
   UUID-v4. Snapshotin kaikki sisältökentät kopioituvat
   alkuperäisinä, ilman ALV:n tai summien uudelleenlaskentaa. Nykyrevision
   osoitin puuttuu vain sopimuksen mukaiselta uudelleenavatulta laskulta.
   Vanhojen dokumenttien ja toimitustapahtumien uudet provenance-kentät
   vastaavat 039:ää; vanhaa lähetystarkoitusta ei arvata. Legacy-ALV-erittely
   pysyy tyhjänä. Ylimääräinen, puuttuva tai väärään laskuun sidottu rivi
   hylätään, vaikka vierasavaintarkistus yksin läpäisisi.
6. Luku tehdään synteettisestä profiilista nykyisen hallitun sulun jälkeen
   readonly-yhteydellä. Se ei käynnistä sovellusta, migroi, korjaa, checkpointtaa
   SQLitea tai luo palautuspistettä. Ratkaisematon WAL/SHM/journal-tila
   hylätään ennen avausta; sitä ei siivota hyväksynnän vuoksi. Nykyiset
   inventaariot ja tiedostoidentiteetit tarkistetaan ennen ja jälkeen luvun.
   SQLite-integrity, vierasavaimet ja dokumenttikatalogin sulkeuma vaaditaan.
7. Vasta kaikkien ensimmäisen käynnistyksen tarkistusten jälkeen talletetaan
   kohteen täysi inventaario olemassa olevaan todisteeseen. Toinen käynnistys
   ja lopullinen erillinen postcondition vaativat saman tietokannan ja
   storage-puun byte-identtisyyden, eri runtime-instanssin ja samat
   workspace-/registry-sidokset. Postcondition tarkistaa myös sisältösopimuksen
   uudelleen; aiempi onnistumisboolean ei riitä.

**Toteutusraja.** Nykyinen `legacyUpgradeProfileEvidence.mjs` säilyy
profiilitodisteen omistajana. Sen viereen rajataan yksi nimetty readonly-
`legacyUpgradeDatabaseEvidence.mjs` ja vain 038/039:ää kuvaava testisopimus
sekä niiden regressiot. Käytetään nykyisen testityökaluketjun `node:sqlite`-
lukutapaa, ei uutta riippuvuutta tai tuotannon DB-porttia. SQL-odotukset
eivät siirry Electron mainiin tai sovelluksen business-logiikaksi.
Manifestin nimeämis-, jatkuvuus- ja ketjutiivistyssopimus käytetään nykyisestä
`migrationManifest.ts`-toteutuksesta testiapurin kautta; toista heikompaa
tiivistysalgoritmia ei kopioida audit-skriptistä. Testisopimuksen generointi
on erillinen kohdetestin valmistelu, ei uusi ajonaikainen migration runner.
`legacyUpgradeWindowsRuntime.mjs` välittää varmennetun pakettisidoksen;
`legacyUpgradePostcondition.mjs` käyttää samaa tarkistajaa jälkitodennuksessa.
Myös postconditionin asennetun payloadin tarkistus tehdään ennen sen SQL:n
käyttöä odotuksen lähteenä; nykyinen tarkistus vasta profiilin lukemisen
jälkeen ei riitä tähän uuteen sidokseen. Lopullinen artifactin jälkivarmennus
säilyy lisäksi omana porttinaan.
Strict readerit, nykyiset suljetut syykoodit ja niitä koskevat testit
päivitetään yhdessä vain tarvittavilta osin. Laskurivejä tai tietokantakopioita
ei lisätä julkiseen lokiin eikä salatun tutkimuspaketin sisältörajaukseen.

**Todennus ennen pitkää ajoa.** Käytä todellista muuttumatonta 039-SQL:ää
nykyiseen synteettiseen 038-fixtureen: vanhan byte-ehdon pitää hylätä sen
muutos, ja uuden sisältötodisteen pitää hyväksyä vain oikea lopputulos.
Negatiiviset regressiot kattavat muuttuneen vanhan arvon tai tyypin,
puuttuvan/ylimääräisen rivin tai schema-objektin (myös muuttumattomilla riveillä
puuttuvan immutable-triggerin), virheellisen ledgerin ja
pakettisidoksen, väärät revisio-/hyvitys-/dokumentti-/tapahtumaviitteet,
muuttuneen PDF:n, keskeneräisen SQLite-tilan sekä itse lukemisen aiheuttaman
muutoksen. Toisen käynnistyksen byte-muutos hylätään myös semanttisesti saman
sisällön tapauksessa. Mukana ovat pitkän Windows-polun luku sekä nykyiset
onnistuva polku, syyn välitys ja erillinen siivoustulos.
Nykyisten kevyiden profiilitestien `sqlite-fixture`-merkkijono säilyy vain
tiedostoturvan fixturena: semanttinen hyväksyntä todennetaan oikeilla
SQLite-tavuilla, eikä SQL-tarkistusta ohittava testikytkentä saa vuotaa
workerin tai erillisen postconditionin oikeaan polkuun.

Kohdetestien ja riippumattoman katselmuksen jälkeen jäädytetään yksi korjaus-
revisio ja ajetaan yksi nimetty Windows legacy -todennus samoilla hyväksytyillä
pakettitavuilla ja nykyisillä aikarajoilla. Seuraava hylkäys erottaa
tiedostojoukon, scheman/ledgerin, alkuperäissisällön, uusien sidosten sekä
readonly-tarkistuksen epäonnistumisen nykyisellä syykanavalla. Jos täsmällistä
alkuperäistä artifactia ei enää saada, siitä kirjataan erillinen valmistelueste;
uutta buildia ei esitetä samana pakettina. Läpäisy avaa normaalit täsmällisen
PR-headin ja uuden mainin portit, ei ohita niitä tai ratkaise vanhaa peruttua
timeout-havaintoa.

**Rajattu toteutus- ja kohdenäyttö 8.10.2026:** tarkistaja, riippumaton
038/039-schema-/SQL-sopimus ja niiden oikeilla SQLite-tavuilla toimivat
regressiot on kytketty profiilinäyttöön, runtimeen ja erilliseen
postconditioniin. Uudet testit kuuluvat nykyiseen legacy-core-komentoon.
Target-evidencen versio 2 sitoo sisältöodotuksen sekä paketin release-/build-
identiteetin; postcondition vaatii täydellisen todistuksen ja toistaa luvun.
Paketoidun backendin oikea `dist/database/migrations`-asettelu ja
inventaarion varmennus ennen SQL-sidontaa testataan oikeassa lukuketjussa.

Rajattu ketjusarja läpäisi ensin 145/145 ja laajennettu syy-/caller-/worker-
ketju 215/215 testiä. Mukana ovat kaikki 64 kopioitua
header-kenttää, vanhan arvon ja tyypin säilyminen, schema-/trigger-/ledger-
virheet, uudet revisio-, rivi-, hyvitys- ja provenance-sidokset, PDF-katalogi,
WAL/SHM/journal, readonly-luvun aiheuttama muutos, pitkä Windows-polku sekä
toisen käynnistyksen semanttisesti saman tietokannan tavumuutoksen hylkäys.
Toteutusvaiheen fixturen valmistelu- ja pakettiasettelupoikkeamat säilyvät
erillisinä eivätkä ole uusia sovellus- tai alkuperäisen CI-ajon vikapäätelmiä.
Nykyinen tekninen sopimus ja lukureitti ovat
[hyväksyntäharnessin ohjeessa](windows-installer-acceptance-harness-v2.md#legacy-038039--sisältötodiste).
Riippumaton toteutuskatselmus on tehty. Siinä havaittu pakettisidoksen
ensisyykoodin yleistyminen payload-vaiheessa korjattiin nykyiseen suljettuun
syykanavaan ja todennettiin regressioilla; muiden vaiheiden syyrajat eivät
laajentuneet. Katselmuksen täsmädeltassa ei jäänyt avoimia havaintoja.
Nimetty saman paketin Windows-todennus ja nykyiset PR/main-portit ovat vielä
erillisiä hyväksyntäportteja; kohdetestien tulos ei korvaa niitä.

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
| C | [C:n hyväksyntähistoria](#c-paketin-valmistelu-ja-hyväksyntärajat), [desktopin ADR](../decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md), [workspace-suunnitelma](local-company-workspace-plan.md), [update-suunnitelma](windows-installer-and-update-plan.md), [recovery-runbook](local-restore-recovery-runbook.md). |
| K | [K:n valmistelu ja päätösrajat](#k-paketin-valmistelu-ja-hyväksyntärajat), [ADR-0006](../decisions/ADR-0006-local-database-and-query-layer.md), [ADR-0009](../decisions/ADR-0009-local-backup-encryption-and-recovery-points.md), [tietokannan toteutussopimus](local-database-implementation-plan.md), [backup/restore](local-backup-and-restore-plan.md), [artifact-katalogi](local-backup-artifact-inventory.md), [Desktop-ohje](../../apps/desktop/AGENTS.md), [E2E-pikaohje](../ai/e2e-test-authoring-guide.md). |
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
| B0 -> B1-B5 | Laskennan, SMTP:n sekä lasku-/PDF-/toimitusrevision rajatut korjaukset. | Hyväksytty PR #297:n ja PR #298:n mainissa sivun alun checkpointin mukaisesti. [Valmistelu ja sen päätökset](#b0-laskun-sisältö-ja-toimitus) säilyvät hyväksyntähistoriana. |
| C / R03/R04/R17/R18/R19 | Desktopin sammutus-, päivityssuoja-, startup-, cold-recovery- ja build-identiteettirajat. | Hyväksytty PR #299:n mainissa sivun alun checkpointilla. Vanhoja hylkäyksiä ei merkitä jälkikäteen onnistuneiksi. |
| K / S030-01/S030-02 | Varmuuskopion todelliset schema-objektit ja eristetyn tarkistuksen rajat. | V1:n sopimus ja alkuperäiset päätökset on hyväksytty. [Nykyinen jatkamiskohta](#jatka-tästä) erottaa kohdetodennetut V2-palat avoimista tuotantotavan ja palautuskäyttäytymisen päätöksistä; K:n koko korjaustodennus on kesken. |
| W7-valmistelu | Omistajan hyväksyttävä poisto-, karanteeni-, palautus- ja nollan työtilan sopimus. | Suunnittelu kulkee rinnalla; toteutus tarvitsee C/K/G/H:n nimetyt kyvykkyydet. |

T1/T2/T3:n, A1/A2/A3:n sekä B/C:n toteutus ja integraatio ovat valmiit. K käyttää
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
Oma yritys -palat sekä B/C:n nykyisestä K-valmistelusta ja K:n päätösjonosta.
Sovelluspalat käyttävät nykyistä feature-/API-sopimusta; jos rajaus vaatii
backendin tai navigoinnin uuden liiketoimintasäännön, se palautuu suunnitteluun.
W7:n päätöksiä ei kysytä yhtenä epämääräisenä lupana, vaan sen omistavan
suunnitelman päätöstaulukon mukaan ennen kunkin vaikutusalueen toteutusta.

Alkuperäisen M1-valmistelun hyväksyntä ja sen rajaus säilyvät
[valmistelun checkpointissa](release-0.3.0-m1-history.md#valmistelun-checkpoint).
Sen jälkeen hyväksytyt T1/T2/T3:n toteutukset eivät sulje A/W7:n tai koko
0.3.0:n valmistumisportteja. Jokaisen seuraavan palan suunnitelma, rajaus,
testit ja ohjeet tarkistetaan ennen toteutusta ja sen valmistuessa.
