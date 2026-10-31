# 0.3.0: integraatioiden historia

Nykyisen työn ja hyväksyntänäytön omistaa
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Alla olevat päivätyt tilat ja jatkoehdotukset ovat syntyhetkensä historiaa,
eivät nykyinen työjono tai uusi valtuus.

## ASARin tietoturvakorjaus 31.10.2026

Ensimmäinen glob 14.0.2 / minimatch 11.0.1 -ehdokas läpäisi erillisen
kirjaston kontrollit ja auditoinnin, mutta jälkikatselmus löysi globin
oletusvienneistä vanhan sisäänrakennetun minimatch-kopion. Rajattu pysyvä
sarja läpäisi kahdeksan testiä ja hylkäsi nämä kaksi vientipolkua.
Ehdokasta ei yhdistetty mainiin. Omistaja hyväksyi julkaisijan
glob 14.0.3 / minimatch 11.0.2 -parin samoilla tarkistuksilla.
Uuden ehdokkaan hyväksyntä ei perustu vanhan ehdokkaan vihreisiin tuloksiin.
MSI-ikkunahavainnot ja niiden siivouksen näyttöraja säilyvät erillisinä.

### HTTP-adapterin mergeä edeltävä checkpoint

Alla oleva teksti on aiempi valmistelutilanne. PR #324 on sittemmin
yhdistetty ja loppuhyväksytty M1:n nykyisen jatkamiskohdan mukaisesti.

**29.10.2026: rajattu HTTP-adapterin tietoturvakorjaus ennen W7.4:n jatkoa.**
Hyväksytty lähtö on `main 11e0eadfee002806db01a1b7152532e04dec5ca4`,
[PR #323:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/323#issuecomment-6468900620).
Alla oleva W7.3:n mergeä edeltävä teksti on historiaa, ei uusi toteutusjono.

Saman main-revision uusi
[riippuvuusauditointi](https://github.com/eky-software/eky/actions/runs/40844462629)
hylkäsi `@hono/node-server@2.1.0`:n
[GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f)-löydöksen
vuoksi. Omistaja hyväksyi täsmäpäivityksen 2.1.3:een ja tarkistukset.
EKY ei käytä paketin haavoittuvaa `serveStatic`-toimintoa tuotannossa;
synteettinen oikean HTTP-rajapinnan regressio todistaa vanhan poikkeaman
ja korjatun hylkäyksen sekä säilyvän julkisen ja suojatun normaalipolun.
Väliversioiden otsakemuutosten vuoksi myös session, vastaustavujen ja sulun
regressiot kuuluvat tarkistukseen. Muut riippuvuudet ja hyväksyntäehdot säilyvät.

Korjauksen paikalliset auditoinnit ja rekisteriallekirjoitukset läpäisivät.
HTTP:n 61 kohdetestiä, katselmuksen täsmennyksen 25 testiä ja 15 system-tapausta
läpäisivät. Backendin yksi hallittu uusinta läpäisi 4 156 testiä, viisi jäi
suorittamatta. Ensimmäisen diagnostiikan sulkutestin aikakatkaisu säilyy
avoimena havaintona, ei korjattuna vikana. Tyypitys ja build läpäisivät;
sarjat ovat päällekkäistä näyttöä. Tämä on erillinen riippuvuuskorjaus,
ei keskeneräisen W7.4-toteutuksen hyväksyntä.

**Seuraavaksi:** tämän täsmällisen korjaushaaran normaalit PR-portit ja
riippuvuustarkistus, suojattu merge ja uuden main-revision omat portit.
Sen jälkeen W7.4 jatkuu omistavan työtilasuunnitelman mukaan.

## W7.2:n mainin ensimmäinen hylkäys 27.10.2026

[PR #321](https://github.com/eky-software/eky/pull/321) yhdistettiin
mainiin `e1f6ea0b186186efa4b93b9f1b8acc9b7c527e91`; mergepuu vastasi
hyväksyttyä headia `ad82c3c191f9d1221918851030dc27a8b882bd83`.
[Mainin V2:n ensimmäinen suoritusyritys](https://github.com/eky-software/eky/actions/runs/40408634962/attempts/1)
hylättiin: 31 työtä läpäisi, kolme hylättiin ja yksi peruttiin. Kahdeksan
ohitetun joukossa olivat kuusi diagnostiikkatyötä sekä legacy-producer ja
sen vielä muodostumaton kuluttajamatriisi. Tämä ei ole täysi hyväksyntä.
Erillinen riippuvuusauditointi läpäisi.

- Legacy-coresta läpäisi 768 testiä ja kaksi MSI-ikkunatestiä hylättiin.
  Purettu aineisto säilytti varsinaiset ikkunaluettelon tarjoajan
  aikakatkaisupoikkeukset. Yleinen stderr-koodi ei tarkoittanut vaaratonta
  tulostetta eikä oikeuttanut tarkistuksen löysentämiseen.
- Web-critical läpäisi 106 testiä ilman automaattista uusintaa, mutta työn
  20 minuutin kokonaisraja katkesi testin 107 aikana; valittuja testejä oli
  116. Lopullinen testiraportti puuttui. Säilynyt salattu liite ei sisältänyt
  varsinaisia kerättyjä tiedostoja, joten liitteen olemassaolo ei todista
  alkuperäisen syyn tai testiprosessien loppusiivouksen talteenottoa.
- Workspace-success jäi MSI:n sovellusten sulkemispyyntöön ja supervisorin
  aikaraja täyttyi. Ikkunahavainto ja kohdeasentimen loki säilyivät; nimettyä
  estäjää ei voitu sitoa tuoreella resurssihavainnolla todettuun prosessiin.
  Lopullinen caller varmisti prosessipuun ja tuotteiden poissaolon,
  asennusjäännösten sekä fixturen siivouksen ja business-datan säilymisen.

Legacy- ja workspace-pakettien ZIP-tiivisteet, ajo-/suoritusyritys-/job-/
lähdesidonta sekä kaikkien 28 ja 56 säilyneen tiedoston tiivisteet
varmennettiin paikallisessa purussa. Se ei muuta alkuperäistä testitulosta.
Kohdeuusinta käyttää samaa main-lähdettä ja jo valmiita producer-paketteja;
legacy-pakettia ei vielä ollut muodostettu. Syitä ei nimetä korjatuiksi,
siivouksen puuttuvaa näyttöä ei arvata eikä käytettyä uusintaa nollata
ohjehuollolla. Uusin hyväksyntätila kuuluu M1:n alkuun.

## W7.2:n integraatiota edeltävä jatkamiskohta 27.10.2026

Alla oleva aiempi M1-jatkamisteksti säilyy muuttamattomana. Päivätyt
tilat ja jatkoehdotukset ovat historiaa, eivät nykyinen työjono.

**Hyväksytty lähtö (25.10.2026):** W7.1 on hyväksytty
[PR #320:n loppupäätöksellä](https://github.com/eky-software/eky/pull/320#issuecomment-6397583475)
mainiin `8c762e5a4d85ab7ed9f73ea6c715cec3b02c6a27`.
Mainin puu vastaa katselmoitua PR-headia
`6612e01ec0bdc746c31b666f758c2a8d960b5c32`.
T/A/B/C/K/D/E/F/G/H/I, M4.1-M4.3 ja W7.1 säilyvät hyväksyttyinä
omissa rajauksissaan; niitä ei toteuteta uudelleen ilman omaa regressiota.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #320 | [V2, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40187931375) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40187931257) läpäisivät: kaikki 27 valittua työtä, 11 perhettä, viisi fault-skenaariota, riskin yksi toisto ja pakolliset askeleet varmennettiin. |
| Mainin omat portit | [V2, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40190293742) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40190321199) läpäisivät: kaikki 38 valittua työtä, 11 perhettä, viisi fault-skenaariota, molemmat toistot sekä auditointi-/allekirjoitusaskeleet varmennettiin. Audit käynnistettiin mainille nykyisen push-polkurajauksen vuoksi manuaalisesti. |

Kummassakin V2-ajossa kuusi diagnostiikkatyötä jätettiin tarkoituksella
valitsematta; ne eivät ole läpäisyjä. CI-uusintaa tai uutta hyväksyntäpoikkeusta
ei tarvittu. Aiemmat avoimet havainnot alla säilyvät avoimina.

W7.1 estää uusien nimikaksoiskappaleiden luonnin, tuonnin ja nimenmuutoksen,
mutta säilyttää vanhat nimet ja jo julkaistun create/import-kohteen
turvallisen palautumisen. Kohde-/core-/tyyppitestit, oikeat Electron- ja
diagnostiikan HTTP-polut sekä rajattu riippumaton katselmus läpäisivät.
Puhdas sovelluslähde `e8bfc387f7530c391b7d955b26ffec14b1eada47` läpäisi
saman hardened Windows-paketin backup -> inspect -> restore -> restart ->
compare -ketjun; sen jälkeinen delta päivitti vain M1:n näyttöä.
[W7.1:n sopimus](local-company-workspace-plan.md#w71n-toteutusraja)
erottaa tuotantotodisteet injektoiduista testirajoista.
Aiempi jatkamisteksti säilyy muuttamattomana
[historiassa](release-0.3.0-integration-history.md#w71n-integraatiota-edeltävä-jatkamiskohta-25102026).

**Nykyinen työ:** W7.2:n rekisteri v2, pysyvä yritysvalinta ja backenditon
hallintatila. Rekisterin, metadatan, tilavalmistelun, source-null-avauksen
terminal-valtuuden ja hallinnan omistajat ovat toteutettuina. Mainin
tavallinen null-haara käyttää nyt erillistä valitsinikkunaa ilman
business-sessionia, backendia, brokeria tai yritystietokannan avaamista.
Valitsimen näkyminen ei ole yrityksen FirstStart- tai terveystodiste.

**Yhteiskatselmuksen jatko 26.10.2026:** puhtaan revision
`f5e65d2874fe7dd8f26a49ab15c874fb31dce3a0` koko työtilan testikierros
läpäisi 13 446 testiä; 22 määriteltyä ohitusta eivät ole läpäisyjä.
Katselmus löysi silti kattamattoman puutteen: puuttuva rekisteri voitiin
rakentaa uudelleen keskeytyneen luonnin tai tuonnin julkaisun yhteydessä,
jolloin muiden yritysten merkinnät ja valitsimen null-tila eivät säilyneet.
Regressio toisti virheen. Admission ja molemmat palautusomistajat vaativat
nyt olemassa olevan rekisterin ennen aineiston siivousta. Puuttuminen
säilyttää aineiston ja estää käynnistyksen; kelvollinen tyhjä rekisteri,
slot-valinta ja historiallinen adoptio säilyvät. Korjauksen 557 kohdetestiä
ja rajattu riippumaton katselmus läpäisivät. Korjattu kokonaisuus läpäisi
myös uuden koko työtilan kierroksen: 13 470 testiä ja 22 määriteltyä ohitusta.
Tyyppitarkistus, auditointi, rekisteriallekirjoitukset ja ohjelinkit läpäisivät.
Uusi puhdas paketti, desktop-kuormitusportti ja 30 minuutin kestoajo
läpäisivät. PR/main-portit ovat vielä hyväksymättä.

**Avoin integraatio:** [PR #321](https://github.com/eky-software/eky/pull/321),
ensimmäisen kierroksen head `9a24b64d2289c8cb26fc42b983c89a8d9367f198`.
[Ensimmäinen V2-kierros](https://github.com/eky-software/eky/actions/runs/40391648974)
hylkäsi core-työn ja siitä riippuvan koonnin; 36 muuta valittua työtä
läpäisi ja kuusi diagnostiikkatyötä jäi tarkoituksella valitsematta.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/40391648728)
läpäisi. Core-hylkäyksen rajattu syy on viiden testitiedoston valmistelun
liian avoin kansio-oikeus POSIX-järjestelmässä. Korjaus vastaa tuotannon
yksityistä kansiota; lukijan turvatarkistusta ei muuteta. Kohdekorjauksen
katselmus ja tyyppitarkistus läpäisivät, mutta koko Linux-sarjan uusi
todennus puuttuu. Kaksi erillistä W7.2:n yhdistelmätestiä aikakatkaisi
kohdetarkistuksessa myös yhdessä sallitussa uusinnassa: cold-rollbackin
main-kytkentä ja switch-main-W6-hyväksyntäketju. Niiden syytä tai
korjausta ei vielä ole todistettu. Omistaja hyväksyi vain näiden kahden
tapauksen yhden vaiheistetun mittauskokeen kymmenen sekunnin koerajalla;
pysyviä aikarajoja, tuotantokoodia tai CI:n kokonaisrajoja ei muutettu.
Mittauskoe läpäisi molemmat nimetyt tapaukset sisältö- ja lopputarkistuksineen.
Väliaikaiset mittauslisäykset poistettiin ja testitiedostojen tavut varmennettiin
mittausta edeltäneiksi. Tämä ei yksin selitä aiempia aikakatkaisuja.
Omistaja hyväksyi tämän jälkeen pysyvän kymmenen sekunnin rajan vain
näille kahdelle tapaukselle. [Testausohje](../ai/testing-rules.md#palautustestin-erillinen-valmistelu)
omistaa tarkan rajauksen; muut variantit, sovelluksen aikarajat, CI:n
kokonaisrajat ja kaikki tarkistukset säilyvät. Rajattu riippumaton
katselmus, tyyppitarkistus ja ohjelinkit läpäisivät. Neljä kohdetiedostoa
läpäisi 85 testiä; POSIX-koe oli Windowsissa tarkoituksella ohitettu.
Main-käynnistyksen tiedosto läpäisi 315 testiä yhdessä sallitussa uusinnassa,
mutta ensimmäisen ajon muuttumattoman `publishReturn`-kuittauskatkotestin
aikakatkaisu ja sen aiheuttama keskeneräisen työn esto säilyvät avoimina.
Näitä osin päällekkäisiä ajoja ei lasketa uudeksi koko työtilan läpäisyksi.
Seuraavaksi uusi täsmällinen PR-revisio käy normaalit portit, myös koko
työtilan ja Linuxin tarkistukset. Ensivirheet ja salattu aineisto säilyvät;
PR/main- tai koko W7.2:n hyväksyntää ei vielä ole.

**Uusin pakettitodiste 26.10.2026:** puhdas lähderevisio
`9d7a2badc6797cd806f3d13ec5020508224fa394` läpäisi hardened Windows
-paketoinnin, sisältöinventaarion ja backup -> inspect -> restore -> restart
-> compare -smoken. Samat pakettitavut läpäisivät myös historiallisen
038-backupin sekä keskeytyneen luonnin ja tuonnin palautuskokeet.
ASAR:n sisältö vastasi valmisteltuja tiedostoja; koko paketin inventaario
ja lähdeidentiteetti varmistettiin muuttumattomiksi kokeiden jälkeen.
Tämä ei vielä ole PR/main- tai koko W7.2:n hyväksyntä.
Aiempi pakettitodiste lähteestä
`3404719c5aa4eef8e5f49f8c1c5cd53cb4453ad8` säilyy sitä koskevana näyttönä;
sitä ei käytetä korjatun lähteen uutena todisteena. Tämä viimeinen
jatkamiskohtapäivitys ei muuta paketoitua sovelluskoodia.

**Yritysavauksen osatodiste:** `DESK-SELECTOR-CREATE-001` läpäisi oikean UI:n,
tuotannon backend-käynnistimen ja FirstStartin kautta. Yritys luodaan
valitsimessa ilman automaattista valintaa; nimenomainen avaus käynnistää
business-runtimen. Synteettinen asiakas, yritysvalinta ja hyväksyntämetadata
säilyvät kokonaan uudessa Electron-prosessissa. Vanhat valitsin- ja
business-istunnot hylätään oikeassa backendissä.

Testiadapterin kiinteä istunto esti FirstStartin tarkoituksellisen
väärän istunnon kokeen, eikä tavallinen fake-backend suorita migraatioporttia.
Korjaukset käyttävät nykyistä istuntogeneraattoria ja vain nimetylle
tapaukselle tuotannon backend-omistajaa; sovelluskoodia tai aikarajoja
ei muutettu. Katselmuksen porttihavainto korjattiin nykyiseen fixtureen:
todellinen backend-portti varmennetaan puun sulun jälkeen ennen restartia
tai aineiston poistoa. Puuttuva havainto ei kelpaa siivoustodisteeksi.
Rajatut järjestelmä- ja adapteritestit sekä E2E-tyyppitarkistus läpäisivät.

Nykyinen 11 tapauksen Electron-kohdesarja läpäisi kymmenen tapausta,
myös uuden luontipolun ja vanhat FirstStart-/migraatio-/eristyskontrollit.
Virhepaluutestin käyttäjäpolku valmistui, mutta viimeisen prosessin
Playwright-sulku aikakatkaisi. Ulompi omistaja todisti puun poistumisen ja
portti vapautui; fixture säilytti hylkäyksen ja aineiston. Sulun tarkka syy
on avoin. Yksi sallittu kohdeuusinta läpäisi samalla lähteellä ja
varmennetulla siivouksella; koko ensimmäistä sarjaa tai vanhaa sulkua
ei merkitä hyväksytyksi sen perusteella. Rajattu riippumaton katselmus
läpäisi porttikorjauksen jälkeen.

Tämä on nykyisen tietokantaversion business-ketjun näyttö, ei asennuspäivitys
tai paketoitu palautus. [Aiempi virhepaluu](release-0.3.0-integration-history.md#w72n-valitsimen-virhepaluun-osatodennus-26102026)
ja [historiallisen kohteen avaus](release-0.3.0-integration-history.md#w72n-valitsimesta-avauksen-native-osatodennus-26102026)
säilyvät erillisinä todisteina. Ensimmäiset adapterihylkäykset ja avoimet
viiveet säilytetään; päällekkäisiä ajoja ei lasketa yhteen. Nykyinen rajattu
yksityinen keräys ei takaa jokaisen alkuperäisen poikkeuksen talteenottoa.

**Hyväksytty pakettirajaus 26.10.2026:** sovellusosan budjetti on enintään
448 tiedostoa ja 3,25 MiB; vain täsmällinen `resources/app.asar` saa saman
3,25 MiB:n tiedostorajan. Muut sisältö-, koko- ja eheysvaatimukset säilyvät.
[Omistava pakettisopimus](windows-installer-acceptance-harness-v2.md#sovellusosan-pakettibudjetti)
vaatii rajatestit, sisältökatselmuksen ja uuden puhtaan paketin todennuksen.
Puhtaan aiemman osarevision
`7d2ee2a1ecc9b364d4149157bd9b2c0a6b793f70` paketointi läpäisi käännökset
ja native-ajurin valmistelun, mutta sovellusosan tiedostomääräraja hylkäsi
inventaarion ennen paketin valmistumista. Rajattu jatkotarkistus osoitti
myös kokonaisbudjetin ylittymisen; tiedostonimi- ja tiedostotyyppitarkistus
ei havainnut kiellettyä sisältöä. Tämä ei ole valmis paketti tai koko
sisältövalidoinnin hyväksyntä. Alkuperäinen hylkäys säilyy erillisenä.
Koko työtilan tyyppitarkistus, riippuvuusauditointi ja rekisteriallekirjoitusten
tarkistus läpäisivät.

Hyväksyttyjen rajamuutosten jälkeen paketti-inventaarion 67 regressiota ja
koko palautuksen käynnistystiedoston 311 testiä läpäisivät. Ohjelinkit ja
rajattu riippumaton katselmus läpäisivät. Uuden puhtaan paketin näyttö
on kirjattu erikseen yllä; aiempaa pakettihylkäystä ei muuteta onnistuneeksi.

**Tuonnin lisänäyttö:** `DESK-SELECTOR-IMPORT-001` läpäisi backendittoman
valitsimen todellisen salatun tuonnin, native-salasanaikkunan, erikseen
vahvistetun yritysavauksen ja fyysisen business-restartin. Asiakas, lasku,
PDF ja metadata säilyivät, lähdebackup ja -tietokanta pysyivät muuttumattomina.
Testiadapterin laajennus on rajattu nimettyyn tapaukseen; tuotantokoodi,
riippuvuudet ja aikarajat säilyvät. Tyyppitarkistus, kymmenen
skenaario-/eristysregressiota ja viisi viereistä valitsimen native-kontrollia
läpäisivät. Katselmus tarkensi salaisuuksien näkymättömyyden tarkistuksen
jo tuonnin jälkeiseen valitsimeen sekä molempiin business-sukupolviin;
vahvistettu tuontitesti läpäisi. Tämä on testin kattavuustäsmennys,
ei havaittu salaisuusvuoto.

**Laajan ajon havainto:** työtilan ensimmäinen testikierros hylkäsi
desktopin yhden vanhentuneen testiohjaimen rakenneassertion. Se oletti
aina fake-backendin, vaikka nimetty luontitesti käyttää jo oikeaa backendia.
Assertion päivitettiin tarkistamaan sekä oikean backendin havainto että
muuttumaton fake-varavaihtoehto. Sen ja istuntogeneraattorin 24 regressiota
läpäisivät. Muut desktopin 5 846 testiä läpäisivät; viisi alustakohtaista
tapausta jäi ohitetuksi. Tämä ei ole koko työtilan hyväksyntä, eikä
muiden pakettien tai tekemättä jääneen jatkovaiheen läpäisyä oleteta.
Myöhempi yhtenäinen kierros ja katselmuksen korjaustarve on eroteltu yllä.

**Seuraava työ:** viimeistele kestoajo sekä täsmällisen PR-headin ja uuden
mainin omat portit. Laaja korjauksenjälkeinen sarja ja puhtaan paketin
palautuskontrollit on todennettu yllä. Säilytä vanhan
ei-null-avauksen ja erillisen Direct Setup -palautuksen kontrollit;
palautusomistajaa ei saa ohittaa. Katselmus on tehty, mutta integraatioportit
ovat vielä tekemättä; W7.2 ei ole hyväksytty.
[Toteutussopimus ja puuttuvat liitokset](local-company-workspace-plan.md#valitsimesta-avauksen-pysyvä-jatko)
omistavat rajat. Vanhoja palautuspolkuja tai hyväksyttyjä W7.0-päätöksiä
ei toteuteta uudelleen ilman omaa regressiota.

**Avoin aiempi viivehavainto:** passiivisen yrityksen siirtymän
variantti `passive: true, source-null: false` ylitti muuttumattoman
testikohtaisen rajan. Seitsemän tapauksen kohdeajossa kaksi läpäisi, tämä
tapaus aikakatkaisi ja keskeneräisen työn suoja esti neljän seuraavan
aloituksen. Yksi erillinen mittaus läpäisi kyseisen variantin kokeen
rajalla; se ei ole aiemman normaalin testirajan läpäisy. Omistaja hyväksyi
myös tämän variantin pysyvän kymmenen sekunnin rajan 26.10.2026.
Aineisto ja epävarma siivoustila
säilyvät; koko sarjaa tai vanhaa viivettä ei merkitä korjatuksi.

**Hyväksytty testirajaus 26.10.2026:** pysyvä kymmenen sekunnin testiraja
on toteutettu passiivisiirtymän molemmille source-null-varianteille ja
onnistuneelle kopioaktivoinnin rollbackille. Aiemmin hyväksytyt
source-null-avaus ja rollback läpäisivät normaalilla asetuksella,
tyyppitarkistus läpäisi ja rajatussa riippumattomassa katselmuksessa ei
löytynyt puutetta. Testirungot ja tarkistukset säilyvät, samoin muiden
varianttien, sovelluksen ja CI:n aikarajat.
[Testausohje](../ai/testing-rules.md#palautustestin-erillinen-valmistelu)
omistaa täsmällisen rajauksen. Alkuperäisen mittausavun virhe ja aiemmat
aikakatkaisut säilyvät erillisinä
[historiallisina havaintoina](release-0.3.0-integration-history.md#w72n-testibudjetin-mittaus-26102026).

Aiemmat valmistelu- ja osatodennukset säilyvät muuttamattomina
[W7.2:n kytkentähistoriassa](release-0.3.0-integration-history.md#w72n-valitsinkuluttajaa-edeltävä-jatkamiskohta-26102026).
Ne eivät ole rinnakkaisia nykytiloja tai nykyisen revision PR/main-todisteita.

W7.3-W7.5:n vahvistus, lopullinen poisto ja backenditon tukilaajennus jäävät
erillisiksi paloiksi; suunnittelunäyttö ei ole tuotannon hyväksyntä.
R030-06:n laajempi ensiasennusmuutos ja M5 ovat edelleen erillisiä.
Yksi asennusversio koskee kaikkia yrityksiä, mutta passiivisen yrityksen
DB-migraatio ja myöhemmän avauksen portit eivät ohitu.

**Avoimet M4.3-havainnot:** PR:n ensimmäisen kylmän MSI-ikkunahavainnon
hylkäys sekä workspace-faultin MSI:n vastausodotus säilyvät avoimina.
Jälkimmäisen prosessien poissaolo, asenninsiivous ja business-datan säilyminen
varmennettiin, mutta estävää prosessia ei tunnistettu varmasti. Mainin
ensimmäinen legacy-core hylkäsi kaksi osittaista MSI-ikkunahavaintoa.
Alkuperäiset native-poikkeukset säilyivät salatussa aineistossa; poikkeuspolun
koko jälkeläispuun siivouksesta ei saatu erillistä lopputodistetta.
PR:n 35 ja mainin 33 aiempaa onnistunutta suoritusta säilyivät uusinnassa;
valmiiden producer-artifactien identiteetit ja tavut eivät muuttuneet.
Mainin legacy-paketti syntyi vasta toisessa yrityksessä, minkä jälkeen sen
molemmat kuluttajat läpäisivät. Alkuperäisiä hylkäyksiä tai puuttuvia
siivoustodisteita ei muuteta onnistumisiksi. Tarkka näyttö on loppupäätöksessä.

**Avoimet havainnot:** M4.1:n mainin ensimmäinen Electron-yritys aikakatkaisi
ennen ensimmäistä ikkunaa. Sen automaattinen uusinta läpäisi, mutta ajo jäi
oikein flaky-hylkäykseksi. Ensivirheen salattu aineisto säilyi ja siivous
varmennettiin; viimeinen migraatiovaihe ei osoita juurisyytä.
Omistajan erikseen hyväksymä yksi Electron-/koontiuusinta läpäisi samalla
lähteellä. Muut 36 onnistunutta suoritusta ja neljä valmista producer-
artifactia säilyivät; Electron valmisteli oman saman lähteen pakettinsa,
ei todistetusti ensimmäisen Electron-yrityksen samoja tavuja.
Alkuperäinen syy jää avoimeksi, ei korjatuksi. I:n ensimmäisen native-valmistelun viiveen tarkka
syy jää avoimeksi. Sen omistettu käännösprosessipuu todettiin poistuneeksi,
mutta myöhemmin katkaistun koko työn loppusiivousta ei varmennettu.
Ensimmäinen legacy-pakettirakennus hylättiin ilman talteen jäänyttä
alkuperäistä syytä tai loppusiivoustodistetta. Omistajan erikseen hyväksymä
lisäuusinta tuotti ensimmäisen valmiin legacy-paketin; molemmat kuluttajat
varmensivat sisällön, toisen käynnistyksen ja siivouksen. Kolme aiempaa
valmista pakettia ja 34 onnistunutta suoritusta säilyivät ennallaan.
Loppupäätös hyväksyy rajatun etenemisen, ei ensihylkäyksiä korjatuiksi.
Myös aiempi API-katkoksen syy sekä H/G:n ja vanhempien pakettien syy- ja
siivousepävarmuudet säilyvät niiden omissa checkpointteissa. Aineistoa ei
poisteta eikä käytettyä uusintalupaa uusita dokumentoinnin perusteella.
[I:n aiempi jatkamiskohta ja suunnitelma](release-0.3.0-integration-history.md#in-integraatiota-edeltävä-jatkamiskohta-23102026)
sekä H:n aiemmat kierrokset säilyvät historiassa.

## W7.2:n valitsimen virhepaluun osatodennus 26.10.2026

Alla oleva edellisen osarajan teksti säilyy muuttamattomana. Uusin
business-avauksen fyysinen restart ja jäljellä oleva työ ovat M1:n alussa.

**Uusin osatodiste:** `DESK-SELECTOR-RETURN-001` läpäisi oikeassa Electron-
prosessiketjussa. Valitsimessa vahvistettu avaus kohtaa puuttuvan
työtilajuuren; nykyinen palautusomistaja palauttaa null-valinnan ja uuden
valitsinprosessin. Yritys jää `recoveryRequired`-tilaan, hyväksyntämetadata
säilyy eikä puuttuvaa yritystietokantaa luoda. Vielä yksi fyysinen restart
säilyttää tuloksen. Jokaisen prosessin puu ja portti suljetaan ennen jatkoa.
Synteettinen release-identiteetti käy tuotannon build-admissionin läpi.

Testiadapterista korjattiin tyypitetyn uudelleenkäynnistyspyynnön muuttuminen
tavalliseksi virheeksi. Tuotannon palautuslogiikkaa tai aikarajoja ei muutettu.
Regressio kulkee mainin todellisen resolverin läpi; samanniminen tavallinen
virhe ei kelpaa palautuskuitiksi. Testin aiempi puuttuva UI-vahvistus sekä
adapterin hylkäys säilyvät erillisinä ensimmäisinä epäonnistumisina.
Rajatut järjestelmä- ja adapteritestit, molemmat E2E-tyyppitarkistukset,
viisi vanhaa Electron-kontrollia ja riippumaton katselmus läpäisivät.
Prosessituloste käyttää nykyistä rajattua yksityistä keräystä, ei lupausta
jokaisen alkuperäisen poikkeuksen täydellisestä talteenotosta.

Tämä todistaa puuttuvan juuren hylkäyksen ennen business-käynnistystä,
ei tietokannan avaamisen jälkeistä rollbackia tai paketin hyväksyntää.
[Aiempi onnistuvan avauksen ja lykätyn hyväksynnän näyttö](release-0.3.0-integration-history.md#w72n-valitsimesta-avauksen-native-osatodennus-26102026)
säilyy: sen composition-restartit ovat samassa prosessissa ja edeltävä
asennuspäivitys on synteettinen lähtötila. Vanhoja viiveitä ei merkitä
korjatuiksi eikä päällekkäisiä ajoja lasketa yhteen.

## W7.2:n valitsimesta avauksen native-osatodennus 26.10.2026

Alla oleva edellisen osarajan teksti säilyy muuttamattomana. M1:n alku
omistaa uudemman virhepaluun näytön ja jäljellä olevan hyväksyntätyön.

**Uusin osatodiste:** nykyisen avauskokeen valitsinvariantit läpäisivät
oikealla SQLitellä, Electronilla ja preload/IPC-ketjulla. Business-hyväksytty
build sekä valitsimessa hyväksytyn päivityksen lykätty business-avaus
käyttävät historialliselle kohteelle nykyistä kopioaktivointia. Valitsimen
alussa ei synny backendia tai yrityssessiota; valinta ei muuta tietokantoja
eikä hyväksyntämetadataa. Lykätyn avauksen business-hyväksyntä syntyy vasta
oikeiden tarkistusten jälkeen, ja metadata säilyy seuraavassa käynnistyksessä.

Todisteen käynnistykset ovat compositionin uudelleenkäynnistyksiä samassa
Electron-prosessissa. Edeltävä asennuspäivitys ja valitsinhyväksyntä ovat
synteettinen lähtötila. Myöhemmät virhe- ja rollback-kontrollit käyttävät
ei-null-lähdettä; ne eivät todista source-null-virheen paluuta valitsimeen.
Fyysinen restart, tämä virhehaara ja puhtaan paketin todennus erotetaan
edelleen tästä näytöstä.

Valitun rekisteriformaatin, ensivirheen ja epävarman siivouksen säilymisen
regressiot sekä molemmat E2E-tyyppitarkistukset läpäisivät. Rajattu
katselmus ei korjausten jälkeen löytänyt vahvistettua puutetta.
Lopullisen testilähteen vanha FirstStart-/Direct Setup -kontrolli,
ei-null-aktivointi ja business-hyväksytty valitsinavaus läpäisivät.
Ensimmäiset testivalmistelun ja tyyppitarkistuksen hylkäykset säilyvät
erillisinä; päällekkäisiä ajoja ei lasketa yhdeksi hyväksyntämääräksi.
[Aiempi valitsimen UI-näyttö](release-0.3.0-integration-history.md#w72n-valitsimen-native-ui-osatodennus-26102026)
ja avoimet viivehavainnot säilyvät historiassa.

## W7.2:n valitsimen native-UI-osatodennus 26.10.2026

Alla oleva edellisen osarajan teksti säilyy muuttamattomana. Yritysavauksen
uudempi näyttö ja puuttuvat integraatiotodisteet ovat M1:n alussa.

**Uusin osatodiste:** backendittoman valitsimen kolme oikeaa Electron-
käyttäjäpolkua läpäisivät: tyhjä lista, avaamaton ready-yritys ja pelkät
recovery-kohteet. IPC-nimenmuutos ja null-valinta säilyivät restartissa;
business-reitit estyivät ilman backendin tai mainin yrityssession luontia.
Samassa ajossa vanhan business-tilan siltaeristyskontrolli läpäisi.
Testiaineistossa ei ole yritystietokantaa: tämä ei todista yritysavausta,
historiallista migraatiota, release-hyväksyntää tai paketoitua palautusta.

Nykyinen Electron-fixture säilyttää prosessien omistajuuden ja siivouksen.
Testikäynnistin välittää mainin täsmällisen valtuuden resolverille;
uutta testialustaa tai terveystodisteen korviketta ei lisätty.
Resolverin 10 kohdetestiä ja fixturen 53 kohdekontrollia läpäisivät,
samoin E2E-tyyppitarkistus ja puhdas Electron-valmistelu.
Rajatussa katselmuksessa löydetty testivalmistelun polkupoikkeama
korjattiin tiedostotavut säilyttävällä regressiolla. Jälkikatselmukseen
ei jäänyt vahvistettua puutetta.

Ensimmäisten ajojen väärä synteettinen tunnistemuoto ja väärä testireitti
säilyvät erillisinä hylkäyksinä; korjaukset koskivat testiaineistoa ja
tarkistusta, eivät sovelluksen hyväksyntäehtoja. Aiempi
[business-avauskytkennän näyttö](release-0.3.0-integration-history.md#w72n-business-avauskytkennän-osatodennus-26102026)
ja avoimet viivehavainnot säilyvät historiassa. Päällekkäisiä ajoja ei
lasketa yhdeksi hyväksyntämääräksi.

**Seuraava työ:** todenna yritysavaus oikeassa SQLite/Electron- ja
paketoidussa palautusketjussa. Erota normaali hyväksytty
avaus, kopioaktivoinnin uudelleenkäynnistys ja mahdollinen aiempi
Direct Setup -palautus; palautusomistajaa ei saa ohittaa. Sen jälkeen
rajattu katselmus sekä täsmällisen
PR:n ja uuden mainin omat portit. Ne ovat tekemättä; W7.2 ei ole hyväksytty.
[Toteutussopimus ja puuttuvat liitokset](local-company-workspace-plan.md#valitsimesta-avauksen-pysyvä-jatko)
omistavat rajat. Vanhoja palautuspolkuja tai hyväksyttyjä W7.0-päätöksiä
ei toteuteta uudelleen ilman omaa regressiota.

## W7.2:n business-avauskytkennän osatodennus 26.10.2026

Alla oleva edellisen osarajan teksti säilyy muuttamattomana. Valitsimen
oikean käyttöliittymäketjun uusin näyttö ja seuraava työ ovat M1:n alussa.

**Uusin osaraja:** business-hyväksytty metadata v1/v2 voi nyt jatkaa
source-null-yritysavausta normaalin FirstStartin kautta. Main sitoo
muuttumattoman metadatan ja mahdollisen hyväksytyn C-journalin lukuun,
joka ei korjaa tai poista ristiriitaisia slotteja. W6 säilyttää normaalin
`noJournal`/`notRequired`-ratkaisunsa; uutta lykättyä business-hyväksyntää
ei muodosteta. Switch ja runtime omistavat edelleen sisällön,
käynnistyksen, sulun ja valinnan lopulliset kirjoitukset.

**Todennettu nyt:** 54 main-kohdetapausta ja erillinen 277 testin
viereisten omistajien sarja läpäisivät. Mukana ovat molemmat
metadataformaatit, hyväksytty C-journal, prepared-/backup-valinta,
kesken käynnistyksen muuttunut metadata tai palautustila, omistajuuden
menetys sekä turvallisen paluun ja epävarman prosessisulun ero.
Vanhan ei-null-avauksen ja lykätyn business-avauksen kontrollit säilyvät.
Desktopin tyyppitarkistus läpäisi. Näyttö käyttää oikeita tiedostoja ja
main/composition-koodia mutta ohjattuja Electron-/native-rajoja;
se ei korvaa oikean prosessin tai paketin hyväksyntää.

Rajattu katselmus löysi liian aikaisen korjaavan C-journalin luvun sekä
palautustilan tuoreen tarkistuksen puuttumisen switch-journalin poistossa.
Korjaukset ja niiden regressiot on tehty nykyisiin omistajiin.
Jälkikatselmukseen ei jäänyt vahvistettua puutetta.
Hyväksyttyäkään Direct Setup -palautusta ei piiloteta normaaliksi
avaukseksi: ristiriitainen polku säilyttää aineiston eikä avaa businessia.
Sen oma olemassa oleva palautusomistaja säilyy erillisenä.

Aiemman null-paluun näyttö ja avoimet viivehavainnot säilyvät
[historiassa](release-0.3.0-integration-history.md#w72n-keskeytyneen-paluun-osatodennus-26102026).
Ensimmäiset hylkäykset pidetään erillään, eikä päällekkäisiä kohdeajoja
lasketa yhdeksi hyväksyntämääräksi.

## W7.2:n keskeytyneen paluun osatodennus 26.10.2026

Alla oleva edellisen osarajan teksti säilyy muuttamattomana. Nykyinen
business-metadatan avaus ja sen puuttuvat todisteet ovat M1:n alussa.

**Uusin osaraja:** keskeytynyt null-paluu käyttää nykyistä switch-omistajaa
ennen uuden yritysavauksen valmistelua. Tuore main-varaus, täsmällinen
valinta ja build-admission sekä muiden palautusten poissaolo vaaditaan
ennen korjaavaa kirjoitusta. Oma valittu switch-journal voidaan päättää;
muita palautusjournaleja ei ohiteta. Metadataa tai yrityksen sisältöä ei
muuteta. Kadonnut kirjoituskuittaus säilyy virheenä ja seuraava käynnistys
todistaa jatkon uudelleen.

**Todennettu nyt:** paluun slot- ja keskeytystilat, ristiriidassa säilyvät
tavut, omistajuuden menetys sekä kaksi aiempaa deferred-avauspolkua
läpäisivät 43 tapauksen main-kohdeajon yhdellä sallitulla uusinnalla.
Ensimmäisessä ajossa julkaisu-kuittauksen katoamista ja uutta käynnistystä
yhdistävä testi aikakatkaisi; keskeneräisen työn suoja esti jatkotapaukset.
Työn päättyminen ja yhteisten resurssien vapautus havaittiin myöhemmin,
aineisto säilytettiin. Viiveen syy jää avoimeksi; uusinta ei korjaa sitä.
Vieressä olevat omistajat läpäisivät erillisen 385 testin sarjan.
Sen jälkeen testien myöhäisen lifecycle-kahvan talteenotto korjattiin
ennen aikakatkaisusignaalin tarkistusta. Sen 28 kohdetapausta läpäisivät,
mukaan lukien hallittu keskeytys ja sulun päättymisen odotus.
Desktopin ja Electron-testien tyyppitarkistukset läpäisivät.
Näyttö käyttää oikeita tiedostoja ja main/composition-koodia mutta
ohjattuja Electron-/native-rajoja.
Se ei korvaa todellisen prosessin tai paketin hyväksyntää. Aiempi
[valitsinkuluttajan näyttö](release-0.3.0-integration-history.md#w72n-valitsinkuluttajan-osatodennus-26102026)
säilyy historiassa; päällekkäisiä kohdeajoja ei lasketa yhteen.

Rajattu katselmus löysi ulkoisen palautuseston vanhenemisen journalin
poistossa ja rekisterin korjaavassa kirjoituksessa. Molemmat toistettiin
ja korjattiin liittämällä ulkoisten ehtojen tarkistus nykyisen valitun
kirjoittajan molempiin vartijalukijoihin. Jälkikatselmukseen ei jäänyt
vahvistettua puutetta.
Uusi palautusjournal, muuttunut metadata tai menetetty omistajuus
kirjoituksen rajalla säilyttävät alkuperäisen switch-journalin sekä
rekisterin korjauksessa sen alkuperäiset slotit.
Ensimmäiset hylkäykset säilyvät erillisinä.

## W7.2:n valitsinkuluttajan osatodennus 26.10.2026

Alla oleva edellisen osarajan teksti säilyy muuttamattomana. Se ei ole
nykyinen työjono; keskeytyneen paluun jatko on M1:n alussa.

**Uusin osaraja:** main liittää nykyiset hallintapalvelun, IPC:n,
native-salasanavalinnan ja fyysisen prosessivarauksen sulkuportit samaan
valitsimen elinkaareen. Sulku estää uuden työn, odottaa jo aloitettuja
komentoja ja native-valintoja sekä varmentaa varauksen ennen vapautusta.
Myöhäinen tiedostovalinta ei käynnistä tuontia. Epävarma sulku säilyttää
varauksen. Web käyttää nykyistä yrityshallinnan käyttöliittymää ilman
business-API-clientia; main torjuu business-HTTP-reitit. Nykyinen H5:n
lokitushäiriöpalkki säilyy myös valitsimessa.

**Todennettu nyt:** valitsimen ja vanhan business-polun kohderegressiot,
vieressä olevat hallinta-/sulkuomistajat, protokolla, resolveri ja webin
koostaminen on tarkistettu. Desktopin, webin ja Electron-testien
tyyppitarkistukset sekä web-build läpäisivät. Näyttö käyttää oikeaa
main/composition-koodia ja tiedostoja mutta ohjattuja Electron-/native-
rajoja; web-testit eivät vielä ole oikean selaimen tai Electron-ikkunan
hyväksyntä. Päällekkäisiä kohdeajomääriä ei lasketa yhteen.
Ensimmäiset hylkäykset säilyvät.

Rajattu katselmus löysi liian myöhäisen eston vielä keskeneräiselle
business-metadatan source-null-avaukselle. Se toistettiin ja korjattiin:
tavallinen null-valtuus hylkää journalia sisältävän avauksen jo ennen
resolverin korjaavia lukuja tai session luontia. Kolmen journal-slotin
regressiot varmentavat myös rekisteri-, journal- ja metadatatavujen
säilymisen. Korjauksen jälkeinen 27 tapauksen main-kohdeajo ja
tyyppitarkistus läpäisivät; rajattu jälkikatselmus ei jättänyt löydöstä.

## W7.2:n valitsinkuluttajaa edeltävä jatkamiskohta 26.10.2026

Alla oleva aiempi jatkamisteksti säilyy muuttamattomana. Nykyinen valitsin-
kytkentä ja jäljellä olevat avaushaarat ovat M1:n alussa.

**Nykyinen työ:** W7.2:n rekisteri v2, pysyvä yritysvalinta ja backenditon
hallintatila. Rekisterin, metadatan, käynnistysvalmistelun ja tarkan
kopioaktivoinnin palautuskuitin osarajat on toteutettu. Mainin
deferred-source-null-avauksen switch/W6-terminal-valtuus ja resolverin
kytkentä ovat nyt toteutettuina, mutta eivät vielä kokonaan todennettuina.
Pelkkä null-valinta, `rollbackSelected`-restart, business-metadatan vastaava
avaus ja valitsimen käyttöliittymä ovat seuraavia kytkentöjä, eivät tämän
osarajan läpäisynäyttöä. Native-/paketti- ja PR/main-portit ovat tekemättä.

**Todennettu hallinnan osaraja:** nykyinen composition rakentaa backendittoman
hallinnan samoilla luonti-, tuonti-, nimenmuutos- ja vaihtoomistajilla.
Se ei luo aktiivista yritystä, business-sessionia tai korvauspalvelua.
Source-null-vaihto julkaisee valitun journalin ja rekisterin nykyisillä
tallentimilla sekä vapauttaa huoltovarauksen ennen relaunch-pyyntöä.
Katselmuksessa toistetut tilaluvun virheellinen ristiriita ja myöhäisen
nimenmuutoksen vanhentunut valtuus on korjattu; rajattu jälkikatselmus
ei löytänyt uutta P1/P2-puutetta. Vaikutusalueen 569 testiä läpäisivät.
Sen jälkeen vain testeihin tehty tyyppikorjaus ja neljä lisäreunatapausta
läpäisivät 51 testin kohdeajon sekä desktopin tyyppitarkistuksen.
Päällekkäisiä ajomääriä ei lasketa yhteen. Ensivirheet säilyvät erillisinä.

**Seuraava kytkentä:** liitä tämä hallinta ja aiemmin todennetut palvelun/IPC:n
sulkuportit mainin valitsinkuluttajaan. Mainin nykyinen selector-esto säilyy
siihen asti; valitsinikkunaa ei vielä avata. Luonti-/tuontireititys on tässä
composition-testissä ohjattu komentorajalta, ei SQLite/Electron-todiste.
Native-/paketti- ja PR/main-portit sekä alla olevat avaushaarat ovat vielä
tekemättä. Aiempien sulkutestien checkpoint säilyy
[historiassa](release-0.3.0-integration-history.md#w72n-hallinnan-sulkuporttien-checkpoint-26102026).

**Avoin ennen seuraavaa laajaa ajoa:** passiivisen yrityksen siirtymän
variantti `passive: true, source-null: false` ylitti muuttumattoman
testikohtaisen rajan. Seitsemän tapauksen kohdeajossa kaksi läpäisi, tämä
tapaus aikakatkaisi ja keskeneräisen työn suoja esti neljän seuraavan
aloituksen. Yksi erillinen mittaus läpäisi kyseisen variantin kokeen
rajalla; se ei ole normaalin testirajan läpäisy. Mahdollinen pysyvä
rajamuutos on erillisessä päätöksessä. Aineisto ja epävarma siivoustila
säilyvät; koko sarjaa tai vanhaa viivettä ei merkitä korjatuksi.

**Hyväksytty testirajaus 26.10.2026:** pysyvä kymmenen sekunnin testiraja
on toteutettu vain source-null-avauksen passiivisiirtymälle ja onnistuneelle
kopioaktivoinnin rollbackille. Molemmat läpäisivät normaalilla asetuksella,
tyyppitarkistus läpäisi ja rajatussa riippumattomassa katselmuksessa ei
löytynyt puutetta. Testirungot ja tarkistukset säilyvät, samoin muiden
varianttien, sovelluksen ja CI:n aikarajat.
[Testausohje](../ai/testing-rules.md#palautustestin-erillinen-valmistelu)
omistaa täsmällisen rajauksen. Alkuperäisen mittausavun virhe ja aiemmat
aikakatkaisut säilyvät erillisinä
[historiallisina havaintoina](release-0.3.0-integration-history.md#w72n-testibudjetin-mittaus-26102026).

**Rajattu näyttö:** terminal-helperin, resolverin ja valitun W6-persistenssin
68 testiä läpäisivät. Todellisen main-ketjun kaksi virhekontrollia säilyttivät
palautusaineiston ja estivät valitsimeen paluun sisältö- tai vapautusvirheessä.
Katselmuksen viimeisen poistovartijan puute toistettiin ja korjattiin:
runtime-valtuus tarkistetaan nyt myös W6-journalin viimeisessä synkronisessa
poistovartijassa. Desktopin, Electron-testien ja E2E:n tyyppitarkistukset
läpäisivät; rajatun tuotantodeltan katselmuksessa ei jäänyt vahvistettua
avointa löydöstä. Tämä on ohjattujen native-rajojen ja synteettisten tavujen
näyttöä, ei koko käynnistyssarjan tai W7.2:n hyväksyntä. Aiempi
[palautuskuitin checkpoint](release-0.3.0-integration-history.md#w72n-palautuskuitin-checkpoint-26102026)
säilyy historiassa. Päällekkäisiä testimääriä ei lasketa yhteen.

Cold-loppurajan vaikutusalueen yhdistetyssä ajossa yhdeksän tiedostoa
läpäisi (475 testiä). Mainin käynnistystiedoston yksi tapaus aikakatkaisi
käynnistysvaiheen jälkeen, jolloin keskeneräisen työn suoja esti muut
tapaukset. Sen yksi sallittu kohdeuusinta läpäisi 226 testiä samalla
lähteellä. Ensivirhe ja epävarma loppusiivous säilyvät avoimina; yhdistettyä
ajoa ei merkitä läpäistyksi eikä uusinta todista viiveen korjaantuneen.
Tämä ei ole W7.2:n integraatiohyväksyntä.
[Pysyvä valinta ja versioraja](local-company-workspace-plan.md#pysyvä-yritysvalinta-ja-versioraja),
[valitsimesta avauksen jatko](local-company-workspace-plan.md#valitsimesta-avauksen-pysyvä-jatko)
ja [W7.0-W7.5:n työjako](local-company-workspace-plan.md#koottu-toteutusehdotus)
omistavat sopimukset. V1-tavut, vanhat backupit, W7.1:n nimirajat ja
C/K/W6:n sisältö-, sulku- ja palautusportit säilyvät.

**Valmisteltu 25.10.2026:** hyväksytty kopioon perustuvan ensimmäisen
yritysavauksen suunnittelu ja keskeytyskoe läpäisivät 28 sopimuskoetta,
tyyppitarkistuksen ja rajatun riippumattoman katselmuksen. Tämä valmistelukoe ei
muuttanut tuotantokoodia. [Täsmällinen toteutussopimus ja kokeen rajat](local-company-workspace-plan.md#rajatun-kokeen-mukainen-toteutussopimus)
erottavat oikeat nykyiset journal-/tiedosto-omistajat injektoiduista
SQLite-, prosessi-, health- ja v2-metadataosuuksista. Katselmuksen koemallin
valinta- ja sukupolvisidonnan puutteet korjattiin vastatesteineen; niitä ei
nimetä nykyisen v1-tuotantopolun vioiksi.

**Tuotantokytkentä hyväksytty 25.10.2026:** omistaja hyväksyi rajatun
ensimmäisen yritysavauksen kytkennän sekä pysyvät regressiot, oikean
SQLite/Electron-ketjun, paketoidun palautuksen todennuksen ja katselmuksen.
Hyväksyntä ei ole toteutuksen tai koko W7.2:n läpäisynäyttö.

**Toteutettu osaraja 25.10.2026:** rekisterin v1/v2-esitys ja version säilyttävät
kirjoittajat sekä luonnin/tuonnin kylmäpalautuksen v2/null-jatko on toteutettu.
V1:n kanoniset tavut ja vanha valintakäyttäytyminen säilyvät. V2:n julkaisu
ei valitse yritystä; downgrade estetään. Rajattu sarja läpäisi 810 testiä
43 tiedostossa; kaksi alustakohtaista tapausta jäi ajamatta. Desktopin
tyyppitarkistus ja rajattu riippumaton lähdekatselmus läpäisivät.
Näyttö ei ole backendittoman compositionin, SQLite/Electron-ketjun,
paketoidun palautuksen tai W7.2:n PR/main-hyväksyntä. Vanhojen ja uusien
päällekkäisten kohdesarjojen määriä ei lasketa yhteen.

**Hyväksyntäketjun osaraja:** nykyinen tallennin ja lukijat säilyttävät
versionmukaisen arvon. Sovellusadmission käyttää sovellushyväksyntää,
palautuksen business-lähde baselinea ja valmistumistodisteet oikeaa
business-hyväksyntää. FirstStartin nimetty `deferredBusiness`-tila tarkistaa
tuoreen valtuuden ja sisällön ennen business-hyväksyntää; hylätty avaus ei
muuta vierasta palautusjournalia. Rajattu sarja läpäisi 515 testiä 26
tiedostossa, desktopin ja E2E:n tyyppitarkistukset sekä rajattu riippumaton
katselmus läpäisivät. Todiste käyttää oikeita metadatatavuja mutta injektoituja
profiili-, salaisuus- ja valtuusportteja: käynnistysketjun kytkentä ja
SQLite/Electron/paketoitu näyttö ovat yhä tekemättä. Aiempi 146 testin
codec-todiste ei ole erillinen lisäkattavuus.

Tallentimien seuraava osaraja on paikallisesti todennettu: metadatan ja
C-journalin kaikkien slottien sivuvaikutukseton tarkastus sekä C-journalin
täsmälliseen tiedostovalintaan sidottu poisto. Sen 219 testin vaikutusalueen
sarja, desktop/E2E-tyypit ja rajattu riippumaton katselmus läpäisivät. Tässä
aiemmassa osarajassa rajapintoja ei vielä käytetty startupissa;
slottihavainto yksin ei anna muutosvaltuutta.
Metadatan vastaava valintaan sidottu kirjoitus ja poisto ovat nyt toteutettuina:
ne säilyttävät keskeytyneet tavut ja alkuperäisen syyn myös sulkuvirheessä.
Vaikutusalueen 587 testiä 28 tiedostossa, desktop/E2E-tyypit ja rajatun
katselmuksen jälkitarkistus läpäisivät. Päällekkäisiä kohdesarjoja ei lasketa
yhteen. Tämä ei vielä ole oikean SQLite/Electron-käynnistyksen tai paketoidun
palautuksen näyttö.

**Tilavalmistelun seuraava osaraja:** nykyisen sijaintimuunnoksen omistajan
nimetty valitsinhaara tarkistaa kaikki metadata-/journal-/registry-slotit
ennen muutoksia. Legacy-kopio ja sen synkronointi varmennetaan ennen lähteen
poistoa, myös kadonneen kuittauksen jälkeen. Journalin terminalit sidotaan
sovellushyväksyntään, eivät business-baselineen. Vanhat korjaavat lukupolut
säilyvät erillään. Vaikutusalueen sarja läpäisi 677 testiä 24 tiedostossa;
yksi alustakohtainen tapaus jäi ajamatta. Rajatun katselmuksen havaitsemat
kopion synkronointi-, duplikaattiavain- ja poistovaltuuspuutteet korjattiin
regressioineen; jälkitarkistukseen ei jäänyt avoimia löydöksiä.
Desktopin ja E2E:n tyyppitarkistukset läpäisivät. Tämä on oikeiden
tiedostotavujen ja injektoidun valtuuden näyttö, ei native-prosessin tai
paketoidun palautuksen todiste. Tämä aiempi osaraja ei vielä kytkenyt startupia.

**Käynnistyskytkennän osaraja:** nykyinen startup käyttää nyt nimettyä
tilavalmistelua ja tuoretta installation-/recovery-valtuutta ennen
valitsinhaaran korjaavia lukuja. Build-admission sidotaan saman tarkistuksen
metadataan ja DSR-tavuihin. Vanha adoptio sekä create/import-palautus säilyvät;
palautuksen jälkeinen valinta ja build-admission luetaan uudelleen.
Vaikutusalueen 710 testiä 14 tiedostossa sekä desktop/E2E-tyypit läpäisivät.
Rajattu riippumaton lähdekatselmus korjauksineen on valmis.
Todiste kattaa oikean compositionin ja tiedostotavut ohjatuilla native- ja
Electron-rajoilla, ei valitsimen käyttöliittymää tai paketoitua ketjua.

**W6:n nimetty jatko:** lykkääntynyt business-hyväksyntä on toteutettu
nykyisiin suunnittelu-, journal- ja siirtymäomistajiin erillisellä
startup-valtuudella. Sovellusadmissionia ei muuteta uudeksi päivitykseksi.
Pysyvä keskeytys-/v1/v2-todennus ja vanhojen kutsujien vaikutusalueen sarja
läpäisivät 451 testiä 19 tiedostossa. Rajattu katselmus löysi korjaavan
lukemisen valtuusjärjestyksen puutteen; korjaus ja sivuslottien säilymisen
regressiot läpäisivät jälkitarkistuksen. Desktopin ja E2E:n tyyppitarkistukset
sekä ohjeiden linkkitarkistus läpäisivät. Tämä ei ole SQLiten, Electronin
tai koko yritysavauksen tuotantokytkennän näyttö.

**Valitsinavauksen lukuraja:** nykyinen switch-omistaja osaa tarkastaa
source-null-journalin v2:n ja rekisterin kaikki slotit muuttamatta niitä.
Yhteinen tilaluokitus tarkistaa koko rekisterin sidonnan ja omistajien
julkaisujärjestyksen; julkaisematon initial-next ei anna avausvaltuutta.
V1:n tavut ja vanhat tallennusmetodit säilyvät. Vaikutusalueen 931 testiä
30 tiedostossa ja desktopin tyyppitarkistus läpäisivät. Rajatussa
riippumattomassa lähdekatselmuksessa ei löytynyt korjattavaa virhettä.
Tämä on lukurajan näyttö, ei kirjoitus-/poistovaltuus tai valmis yritysavaus.

**Valitun tallennuksen osaraja:** nykyinen byte-slot-tallennin sekä registry-
ja switch-omistajat sitovat kirjoituksen, palautuksen ja siivouksen
tarkkoihin tavuihin, tiedostoidentiteettiin ja tuoreeseen valtuuteen.
Rajatut regressiot ja riippumaton katselmus korjauksineen läpäisivät.
Kuluttajien yhdistetyissä ajoissa palautustestit aikakatkaisivat; kahden
testipolun ennenaikainen siivous liitettiin nykyiseen elinkaarisuojaan.
Korjattu palautustiedosto ja sen tukiregressiot läpäisivät 200 testiä.
Alkuperäisen viiveen syy on edelleen avoin eikä yhdistettyjä hylkäyksiä
muuteta onnistumisiksi. Tämä ei ole koko startupin tai paketoidun ketjun
hyväksyntä.

**Kopioaktivoinnin valintaraja:** nykyiseen migraatiosuojaan on lisätty
source-null-avauksen täsmällinen rekisteri-/journal-/lineage-/valtuussidonta.
Tarkastus ei korjaa sivuslotteja tai käytä vanhan käynnistyksen kuittia.
Current-kohteen tarkistus jatkaa FirstStartiin; pending-kohde käyttää
nykyistä yhtä kopioaktivointia. Katselmuksessa havaittu vanhentuneen
valtuuden siivouspolku toistettiin ja suojattiin nykyisessä koordinaattorissa.
Päivitys- ja switch-kuluttajien lopullinen 376 testin sarja 21 tiedostossa
läpäisi. Mukana on oikeiden tallentimien, guardin ja startup-/inspector-
luokkien yhteinen koe ohjatuilla prosessi- ja sisältöporteilla sekä
koordinaattorin valtuudenmenetysten regressiot. Aiemmat osajoukot eivät ole
lisänä tähän testimäärään.
Rajattu riippumaton jälkikatselmus ei jättänyt avoimia P1/P2-havaintoja.
Tämä aiempi osaraja ei vielä muodostanut valtuutta valitsimen startupissa.
Se ei ole SQLiten, Electronin tai koko W7.2:n integraatiohyväksyntä.

**Valitsinavauksen startup:** workspace-resolverin uusi versionmukainen
haara sovittaa v2-slotit nykyisillä tallentimilla ja välittää valinnan
aktivoinnin suojaan. Yrityksetön tulos erotetaan ennen business-sessionin
luontia. Paluu, kohteen hylkäys ja hyväksyntä vaativat nykyisen päättymis-
todisteen; epävarma tai vanhentunut valtuus säilyttää aineiston. Kadonnut
kirjoituskuittaus ratkaistaan uuden käynnistyksen pysyvästä tilasta.
Katselmuksen identiteetti- ja vanhan v1-journalin keskeytystapaukset
toistettiin ja korjattiin; jälkiluku ei ota vierasta samantavuista tiedostoa
omakseen. Todellisen compositionin testi toisti myös legacy-adoption
ohittamisen null-valinnassa, ja aiempi palautusomistaja säilytettiin.
Lopullinen tallennus-/switch-/aktivointikuluttajien sarja läpäisi 700 testiä
35 tiedostossa; yksi alustakohtainen tapaus jäi ajamatta. Käynnistys- ja
palautuscompositionin erillinen sarja läpäisi 228 testiä. Osajoukkoja ei
lasketa näihin lisänä. Rajattu riippumaton jälkikatselmus ei jättänyt
avoimia P1/P2-havaintoja tähän osarajaan.
Tämän osarajan testit käyttävät oikeita tiedostoja ja ohjattuja terminal-
portteja. Main ei vielä toimita lopullista valtuutta: valitsimen ikkuna,
FirstStart/W6-kytkentä ja native-/paketoitu näyttö ovat edelleen avoinna.

**Peruutuksen ja julkaisun osaraja (26.10.2026):** W6:n valmistelu voidaan
perua vain tuoreen terminal-valtuuden sekä täsmällisten journal-tavujen ja
tiedostoidentiteetin perusteella. FirstStartin deferred-haara käyttää
korjaamattomia metadatalukuja ja alkuperäiseen tiedostoidentiteettiin sidottua
julkaisua nykyisen tallentimen kautta. Takaisinluku vaatii kirjoittajan
seuraaman identiteetin. Kummankaan rajan valtuusfunktioita ei vaihdeta kesken
operaation. Katselmuksen tiedosto- ja callback-vaihdot toistettiin ja
korjattiin vastatesteineen. Lopullinen kuluttajasarja läpäisi 1 194 testiä
65 tiedostossa; desktopin ja E2E:n tyyppitarkistukset sekä ohjeiden linkit
läpäisivät. Rajattu riippumaton jälkikatselmus ei jättänyt tähän osarajaan
avoimia P1/P2-havaintoja. Päällekkäisiä kohdesarjoja ei lasketa määrään
lisänä. Tämä ei vielä kytke mainin todellista terminal-valtuutta eikä hyväksy
native-/paketoitua ketjua.

**Uusin osatodennus (26.10.2026):** main käyttää tilavalmistelun valittuja
tiedostotavuja ja identiteettejä W6:n sekä FirstStartin yhteisessä
vaihekohtaisessa valtuudessa. Deferred-admission ei kutsu korjaavaa lukijaa.
FirstStart palauttaa oman julkaisunsa varmennetun identiteetin; main ei ota
myöhemmin löytyvää samantavuista tiedostoa omakseen. Ulkoiset tarkistukset
eivät lue omistajan keskeneräisiä kirjoitusslotteja. Kaikki rinnakkain
aloitetut ulkoiset lukijat päättyvät myös yhden lukijan virheessä.
Koko käynnistys-/palautustiedoston 226 testiä sekä viiden tiedoston 141
sopimustestiä läpäisivät. Viereisten kuluttajien lopullinen sarja läpäisi
729 testiä 37 tiedostossa; yksi alustakohtainen tapaus jäi ajamatta.
Päällekkäisiä kohdesarjoja ei lasketa yhteen. Desktopin, Electron-koetoteutuksen ja E2E:n
tyyppitarkistukset läpäisivät. Rajatussa riippumattomassa jälkikatselmuksessa
ei jäänyt vahvistettuja P1/P2-havaintoja. Testit käyttävät oikeita tiedostoja
ja compositionia mutta ohjattuja native-/Electron-rajoja; tämä ei ole
SQLite-/Electron- tai pakettihyväksyntä. Aiemman passiivisen siirtymän
aikakatkaisun tarkka syy säilyy avoimena.

**Seuraava työ:** source-null-avauksen todellinen terminal-valtuus ennen
valitsimeen paluuta tai hyväksyntää sekä sen main-kytkentä. Uuden candidaten
rollbackin kirjoittajan tarkka journal-kuitti välittyy nyt compositionille;
mainin on kytkettävä sen loppukäsittely nykyiseen palautuksen omistajaan.
Myöhempi luku vain tarkistaa valinnan, ei valitse sitä uudelleen.
Alkuperäisen normaalin startup-tilan perusteella ei saa olettaa myöhemmin
syntyneen palautusjournalin puuttumista. Lopputarkistusten jälkeen perutaan
W6:n oma valmistelu ennen null-valinnan julkaisua. Omistajien
luovutusrajapinta välittää alkuperäiset ja kirjoittajan varmentamat switch-/
registry-havainnot ennen työtilajuuren tarkistusta ja hyväksytyn switch-poiston
jälkeen. W6 hyväksyy vain saman rekisterisisällön kertaluonteisen siirron ennen
valmisteluaan. Tämän osan 531 vaikutusalueen testiä sekä 235 main-käynnistyksen
ja järjestysrajan testiä läpäisivät; ne eivät vielä ole terminal-, SQLite-/
Electron- tai paketoitu näyttö. Katselmuksen vanhentuneen kuitin ja käsitellyn
tarkistusvirheen jatkamisen puutteet toistettiin ja korjattiin regressioineen.
Rajattu riippumaton jälkikatselmus ei jättänyt avoimia P1/P2-havaintoja.
W6:n nykyisen compositionin deferred-haaran registry- ja
journal-kutsut käyttävät nyt kirjoituksen sisällä uusittavaa valtuutta ja
kirjoittajan tiedostoidentiteetin takaisinlukua; metadataluku ei korjaa
sivuslotteja. Rajatun katselmuksen kaksi valtuus-/jatkamispuutetta toistettiin
ja korjattiin vastatesteillä. Tämä aiempi tallennusosaraja ei yksin ollut
mainin, SQLite/Electronin tai paketoidun ketjun näyttö.
Vaikutusalueen lopullinen sarja läpäisi 908 testiä 35 tiedostossa; yksi
alustakohtainen tapaus jäi ajamatta. Desktopin, Electron-koetiedostojen ja
E2E-kuluttajien tyyppitarkistukset sekä ohjeiden linkkitarkistus läpäisivät.
Rajattuun jälkikatselmukseen ei jäänyt avoimia P1/P2-havaintoja.
Ensimmäisen yritysavauksen tilavalmistelu on nyt kytketty
pääprosessiin ennen korjaavia lukijoita: alkuperäiset metadatahavainnot,
rekisterivalinta, toimitettu build ja installation-valtuus tarkistetaan
ennen muutoksia. Vanhan v1-lukijan yhteensopivuus säilyy myös v2-rekisterissä;
ristiriitainen uusi hyväksyntä tai puuttuva rekisteri ei pääse siivoavaan
vanhaan polkuun. Lopullinen seitsemän tiedoston vaikutusalueen sarja läpäisi
362 testiä. Desktopin, Electron-koetoteutuksen ja E2E:n tyyppitarkistukset
sekä ohjeiden linkkitarkistus läpäisivät. Rajattu riippumaton jälkikatselmus ei jättänyt tähän osarajaan
avoimia P1/P2-havaintoja. Testit käyttävät oikeaa compositionia ja tiedostoja,
mutta ohjattuja native-/Electron-rajoja. Tämä ei vielä todista W6:n ja
FirstStartin myöhempiä mutaatioita tai koko yritysavausta.
Nimetty tilavalmistelu on toteutettu nykyisen metadatatallentimen päälle:
se tarkistaa keskeytysten yhteisen kirjoitusjärjestyksen ja säilyttää valitut
tavut sekä tiedostoidentiteetit myös palautuksen omassa keskeytyksessä.
Lopullinen kymmenen tiedoston vaikutusalueen sarja läpäisi 370 testiä;
nykyisen palautuscompositionin erillinen sarja läpäisi 191 testiä.
Rajattu riippumaton katselmus ja korjausten vastatestit on tehty.
Nämä aiemmat oikeiden tiedostojen kokeet eivät vielä todistaneet mainin
kutsua. SQLiten/Electronin ketju ja paketoitu palautus ovat yhä avoinna.
Mainin käynnistyksen voimassaolo on nyt sidottu nykyisen varausomistajan
elinkaareen myös hallitun lapsisiirron aikana. Yritysvalinnan myöhäinen
tulos ei ohita tätä tarkistusta session, relaunchin tai runtime-resurssien
avauksessa. Fyysinen varaus, kertakäyttöinen työlupa ja palautuksen
päättymistodiste säilyvät erillisinä vaatimuksina
[desktopin omistajasopimuksessa](local-desktop-implementation-plan.md#prosessivarauksen-adapteri-r18).
Tämän kytkennän kuuden tiedoston kohdesarja läpäisi 323 testiä. Viimeisen
testiadapterin paluuarvokorjauksen jälkeen kohdekoe sekä desktopin,
Electron-koetoteutuksen ja E2E:n tyyppitarkistukset läpäisivät. Rajattu
riippumaton katselmus ei jättänyt avoimia P1/P2-havaintoja. Tämä on
käynnistysvaltuuden osatodiste, ei native- tai pakettihyväksyntä.
Osittainen rekisterituki ei anna muunnosvaltuutta.
FirstStartin uusi tila ja W6:n nimetty jatko ovat nyt mainin käytössä
jo valitun yrityksen deferred-haarassa, ilman yleistä B-baselinen
store-adapteria tai teeskenneltyä uutta päivitystä. Historiallisen palautuksen
terminal-kytkentä ja source-null-composition jäävät integraation porteiksi.
Valitsimen readiness ei ole business-hyväksyntä, null-valinta ei luo
oletusyritystä eikä epävarma prosessisulku avaa uusia hallintakirjoituksia.
Sitten pysyvät regressiot ja oikean käynnistysketjun todistus ennen saman
puhtaan paketin sekä täsmällisen PR/mainin portteja.
W7-P1-P4:n hyväksyttyjä päätöksiä tai jo katselmoituja kokeita ei aloiteta
uudelleen ilman omaa havaintoa. Uusi nimeämätön päätös kysytään ennen kytkentää.


## W7.2:n hallinnan sulkuporttien checkpoint 26.10.2026

Alla oleva aiempi jatkamisteksti säilyy muuttamattomana. Hallinnan
compositionin myöhempi osanäyttö ja seuraava liitos ovat M1:n alussa.

**Seuraava kytkentä:** valitsimen rajattu elinkaariportti on toteutettu
nykyisen huolto- ja prosessivarauksen varaan. Nykyinen hallintapalvelu ja
IPC-kyvykkyys estävät uuden työn sulussa ja tarjoavat aloitetun työn
päättymisen odotuksen. Myöhäiset native-vastaukset eivät aloita uutta
tuontia tai korvausta. Journalilukujen liian aikainen palautuminen ja
suljetun vartijan myöhäinen hyväksyntä toistettiin ja korjattiin.
Vaikutusalueen 262 testiä, mainin 17 valittua sammutusregressiota sekä
desktopin tyyppitarkistus läpäisivät; rajattu jälkikatselmus valmistui.
Ensimmäisen uuden testin järjestysoletus korjattiin testissä, eikä sen
epäonnistumista tai vanhoja aikakatkaisuja kirjata onnistumisiksi.
Mainin varauskoodi on testissä todellinen, native-portit ohjattuja.
Seuraavaksi liitetään backenditon hallinta ja nämä sulkuportit mainin
valitsinkuluttajaan. Valitsinikkunaa ei vielä avata eikä tätä pidetä koko
W7.2:n hyväksyntänä.

## W7.2:n testibudjetin mittaus 26.10.2026

Mainin terminal-kytkennän onnistuvan avauksen passiivisiirtymän ja valitun
kopion rollbackin yhdistelmätestit ylittivät nykyisen testirajan. Ensivirheet
ja epävarma siivoustila säilyivät avoimina; yksi kohdeuusinta ei sulkenut
havaintoa. Ensimmäinen hyväksytty kahden nimetyn tapauksen mittauskoe ei
antanut kelvollista kestotodistetta: ylimääräinen mittausapu ja testi
korvasivat saman metodin, jolloin syntyi itseään kutsuva ketju. Toinen
tapaus estyi keskeneräisen työn suojassa. Mittausvirhe toistettiin pienellä
kontrollilla, eikä sitä tulkittu aiempien sovellusviiveiden syyksi.

Hyväksytty korjattu mittaus ilman ylimääräisiä koukkuja läpäisi molemmat
tapaukset. Omistaja hyväksyi pysyvän kymmenen sekunnin testirajan vain
source-null-avauksen passiivisiirtymälle ja onnistuneelle kopioaktivoinnin
rollbackille. Ne läpäisivät myös normaalilla testiasetuksella. Tyypit ja
rajattu riippumaton katselmus läpäisivät; testirunkojen sisältö säilyi.

Seitsemän variantin kohdeajo pysähtyi silti muuttumattoman
`passive: true, source-null: false` -tapauksen rajaan. Kaksi tapausta läpäisi,
yksi aikakatkaisi ja neljä estyi keskeneräisen työn suojassa. Erillinen
mittaus läpäisi kolmannen tapauksen kokeen rajalla. Se ei muuttanut sen
pysyvää rajaa eikä hyväksynyt koko käynnistyssarjaa. Kaikki aiemmat
hylkäykset säilytettiin erillisinä; seuraavan päätöksen omistaa M1.

## W7.2:n palautuskuitin checkpoint 26.10.2026

Terminal-kytkentää edeltävä mainin palautuskuitin kytkentä läpäisi
239 käynnistys-/palautustestiä, 206 viereisten omistajien regressiota ja
rajatun katselmuksen. Kilpailutilanneregressio toisti ja korjauksen jälkeen
esti palautusjuuren poiston viimeisen luennan aikana menetetyllä valtuudella.
Main käsitteli kopioaktivoinnin tarkan palautuskuitin nykyisellä cold-
omistajalla ja odotti myös I/O:n sekä varausten sulkeutumisen. Virhepolku
esti yleisen source-recoveryn ohituksen. Source-null-kutsujan koko switch/W6-
terminal-valtuus ja resolverikytkentä olivat seuraava työ.

Näyttö käytti synteettisiä tiedostotavuja ja hallittuja prosessi-/sisältö-
validointirajoja, ei oikeaa SQLite/Electron- tai paketoitua ketjua.
W7.2:n tuotantokytkentä ja integraatio eivät olleet valmiit.
Aiemmat aikakatkaisut ja epävarmat siivoustilat säilyivät avoimina.

## W7.1:n integraatiota edeltävä jatkamiskohta 25.10.2026

Seuraava aiempi M1-jatkamisteksti säilytetään muuttamattomana. Sen
keskeneräisyysväitteet kuvaavat integraatiota edeltävää vaihetta.
Myöhempi hyväksyntä on PR #320:n loppupäätöksessä ja M1:n nykytilassa.

**Hyväksytty lähtö (24.10.2026):** M4.3/R030-08 on hyväksytty
[PR #319:n loppupäätöksellä](https://github.com/eky-software/eky/pull/319#issuecomment-6385011410)
mainiin `f38c1f77e9d5db864a3624bc0a4e8277a446a02d`.
Mainin puu vastaa katselmoitua PR-headia
`26f0dc762b3266373bc1c978c507df12e8d95f2d`.
T/A/B/C/K/D/E/F/G/H/I sekä M4.1-M4.3 säilyvät hyväksyttyinä omissa rajauksissaan;
niitä ei toteuteta uudelleen ilman niiden omaa todennettua regressiota.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #319 | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/40091411333/attempts/2) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40091411237) läpäisivät. Kaikki 38 valittua työtä, 11 perhettä, viisi fault-skenaariota, molemmat toistot ja pakolliset askeleet varmennettiin; kuusi diagnostiikkatyötä jätettiin tarkoituksella valitsematta. |
| Mainin omat portit | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/40095610406/attempts/2) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40096462545) läpäisivät. Täysi kattavuus sekä asennus-, auditointi- ja allekirjoitusaskeleet varmennettiin erikseen. Audit käynnistettiin tälle mainille manuaalisesti nykyisen push-polkurajauksen vuoksi. |

M4.3:n rajattu historian selaus, todellinen HTTP-/selainketju ja readerin
kesken olevan tiedosto-I/O:n sulku on todennettu. Puhdas sovelluslähde
`3ff0bdd347915f4a5efb860d1bec3ff9e84e028f` läpäisi saman Windows-paketin
selaus-/tukipaketti- sekä backup -> inspect -> restore -> restart -> compare
-ketjun; sen jälkeinen PR-delta muutti vain kahta omistavaa dokumenttia.
[Diagnostiikkasuunnitelma](diagnostics-0.2.9-completion-plan.md#m43-jatkohakusopimuksen-ehdotus)
omistaa voimassa olevan sopimuksen. Tämä ei ole maksimikuorman
suorituskykylupaus. Integraatiota edeltävä checkpoint säilyy
[historiassa](release-0.3.0-integration-history.md#m43n-integraatiota-edeltävä-jatkamiskohta-24102026).

**Nykyinen työ (25.10.2026):** W7.1:n nimivertailun toteutus ja testit.
W7.0:n katselmoitu sopimus-/koevaihe on valmis ja säilytetty erillisessä
valmistelucommitissa `162f5ab2`. Main on edelleen yllä mainittu `f38c1f77`;
W7.1:n toteutus on integraatioehdokas toteutushaaralla; PR/main-porttien
hyväksyntä ja yhdistäminen ovat vielä kesken.
**Palautumiskorjaus todennettu kohdetasolla:** uuden append-eston ja jo
julkaistuun create/import-kohteeseen sidotun recoveryn nimipolitiikka on
erotettu. Neljä historiallista nimikonfliktia toistivat ensin hylkäyksen;
korjauksen lopullinen 12 tiedoston sarja läpäisi 511 tapausta ja desktopin
tyyppitarkistuksen. Tarkat ID-, lineage-, kapasiteetti-, sisältö-, omistajuus-
ja journal-portit sekä uusien operaatioiden nimiraja säilyvät.
Rajattu katselmus sekä siinä havaittujen virheluokitus- ja testiaineistopuutteiden
korjaus on tehty. Käynnistyscomposition käyttää oikeita tiedostotavuja,
mutta ohjattua tarkistusprosessia: tämä ei korvaa Electron-/packaged-näyttöä.
**UI-/diagnostiikkaketjun kohdenäyttö:** webin 82, desktopin 144,
Diagnosticsin 48 ja strict-clientin 31 kohdetestiä läpäisivät omissa
sarjoissaan. Testimäärät eivät muodosta yhtä integraatiokierrosta.
Oikean Electronin kolme polkua läpäisivät: historiallinen julkaistu
create/import-recovery sekä uuden luonti-/nimeämis- ja tuontiristiriidan
esto onnistuvine jatkoineen. Kahden jälkimmäisen täydennetty ajo todensi
myös syykoodin nykyisen lokituksen, HTTP:n ja strict-clientin läpi.
Historiallisen nimihuomautuksen selainkoe läpäisi; sen desktop-status on
injektoitu, joten se ei ole IPC- tai yritysvaihtotodiste. Kapean ja leveän
näkymän kuvat tarkistettiin. Uusimman rajatun katselmuksen tulos ei sisältänyt
avoimia löydöksiä. Koko työtilan tyyppitarkistus ja nykyisen core-CI:n mukainen
peräkkäinen testisarja läpäisivät ilman uusintaa. Alustakohtaiset ohitukset
eivät ole läpäisyjä tai Linux-näyttöä. Riippuvuusauditointi ja nykyisten
pakettien rekisteriallekirjoitukset läpäisivät.
**Puhtaan paketin näyttö:** katselmoidusta sovelluslähteestä
`e8bfc387f7530c391b7d955b26ffec14b1eada47` rakennettu hardened Windows-paketti
läpäisi nykyisen backup -> inspect -> restore -> restart -> compare -ketjun
ilman uusintaa. Paketin sisäinen lähderevisio ja puhdas build-tila tarkistettiin;
samat pakettitavut varmennettiin myös ajon jälkeen. Tämän jälkeinen delta
päivittää vain tämän jatkamissivun hyväksyntänäytön.
W7.1:n koko integraatio ei vielä ole hyväksytty.

[Omistava W7.0-sopimus](local-company-workspace-plan.md#w70n-turvallisuussopimusehdotus)
ja sen [valmiustaulukko](local-company-workspace-plan.md#w70n-jäljellä-olevat-sopimustäsmennykset)
nimeävät rekisterin v2:n, pysyvän null-valinnan, first-start/rollbackin,
kohdesidonnat, poiston journalin/kohdeluettelon, vahvistukset ja backendittoman
tuen. W7-P1-P4 sekä 25.10. hyväksytyt kohdeluettelo- ja
asennuspakettipäivityksen suunnat säilyvät. Vanhojen backupien tukea ei
poisteta; historiapoikkeusta ei ole valittu. Yksi sovellusversio koskee
kaikkia yrityksiä, mutta valitsimen hyväksyntä ei todista avaamattomien
yritysten tietokantojen muunnosta tai terveyttä.

**Viimeisten sopimusrajojen näyttö:** kohdeluettelon/journalin 44 tapausta
ja tyypit läpäisivät. Poistovahvistuksen 42 uutta tapausta, 18 nykyistä
capability-/protokollaregressiota ja tyypit läpäisivät. Katselmuksen kolme
rajattua puutetta toistettiin, korjattiin koeehdokkaisiin ja jälkitarkistettiin.
Aiemmat nimivertailu-, backup-kuitti-, selector-, kohdesidonta- ja tukikokeet
säilyvät erillisinä näyttöinään, eivät yhteen laskettavana integraatiomääränä.
Koekoodi on tuotannosta erillään. Native-sulku, oikeat IPC-/observer-lukijat,
kaikkien juurien inventaario ja oikea packaged/restart ovat edelleen
**tuotantototeutuksen portteja**, eivät näiden kokeiden läpäisytuloksia.
Aiempi vaihekohtainen jatkamisteksti säilyy muuttamattomana
[W7.0:n valmisteluhistoriassa](release-0.3.0-integration-history.md#w70n-sopimusvalmistelun-jatkamiskohta-25102026).

**Seuraava työ:** vie katselmoitu W7.1-diffi normaalin PR:n kautta
täsmällisen revision riskiperusteisiin portteihin ja riippuvuustarkistukseen.
Niiden hyväksynnän jälkeen tehdään suojattu merge ja uuden mainin omat portit.
Paikallinen kohde- ja pakettinäyttö ei korvaa PR/main-hyväksyntää.
Palautumiskorjausta ei aloiteta uudelleen
ilman omaa vastanäyttöä. Jatketaan
[nykyisen W7.0-W7.5-työjaon](local-company-workspace-plan.md#koottu-toteutusehdotus)
mukaisesti. W7.2 kytkee sen jälkeen versionmukaisen rekisterin, pysyvän
valinnan ja backendittoman tilan avaus-/rollback-rajat. Toteutetaan yksi omistajaraja
kerrallaan pysyvine regressioineen; jo katselmoituja suunnittelukokeita ei
aloiteta uudelleen ilman omaa löydöstä. W7-P4:n ehdollista toteutuslupaa ei
kysytä uudelleen. Uusi rajattu W7.1-Goal sisältää tämän palan toteutuksen,
testit, katselmuksen ja nykyiset integraatioportit; se ei toteuta W7.2-W7.5:tä.
W7 ja M5 ovat avoimia; R030-06:n laajempi ensiasennusmuutos jää erilliseksi
rajaukseksi. Avoimet historialliset virheet alla säilyvät avoimina.

## W7.0:n sopimusvalmistelun jatkamiskohta 25.10.2026

Seuraava aiempi M1-jatkamisteksti on säilytetty muuttamattomana. Sen
avoimet sopimuskohdat kuvaavat kyseistä välivaihetta, eivät uutta työjonoa.
Nykytila ja tuotantokytkennän erilliset portit löytyvät M1:n alusta.

**Nykyinen työ:** aktiivinen W7.0-valmistelu: sopimukset, pienet kokeet ja
katselmus saman kokonaisuuden sisällä, ei vielä tuotantokytkentää.
Omistaja hyväksyi 24.10.2026 W7-P1-P3:n suunnat ja W7-P4:n ehdollisen
toteutuksen: täsmälliset sopimukset, pienet keskeytys-/yhteensopivuuskokeet
ja katselmus ennen tuotantokytkentää. Samoja lupia ei kysytä uudelleen.
[W7:n nykykoodikartta](local-company-workspace-plan.md#w70n-lähtökartta-24102026)
ja [W7.0-W7.5:n työjako](local-company-workspace-plan.md#koottu-toteutusehdotus)
omistavat teknisen valmistelun. Aiemmin hyväksyttyjä käyttäytymispäätöksiä
ei avata uudelleen. [W7.0:n sopimusehdotus](local-company-workspace-plan.md#w70n-turvallisuussopimusehdotus)
erottaa pysyvän yritysvalinnan, lopullisen poiston aloituksen ja
keskeytysrecoveryn sekä uudet tekniset päätösportit. Rajattu riippumaton
ehdotuskatselmus on tehty; inventaarion historiallinen sidonta,
backenditon first-start sekä rajatun desktop-tuen sisältö ja käyttöoikeus
ovat edelleen teknisiä todennusportteja, eivät todistettua toimintaa.

W7-P1:n v2-rekisterisuunta on hyväksytty 24.10.2026
[kirjatulla yhteensopivuusrajalla](local-company-workspace-plan.md#pysyvä-yritysvalinta-ja-versioraja).
Nykyistä backup-tukea ei poisteta: mahdollinen vanhan testivaiheen poikkeus
on vielä nimeämättä. Tästä päätöksestä eteenpäin syntyvien kopioiden
yhteensopivuus sekä päivityksen rollback-todennus ovat pakollisia.

**Todennettu valmistelu:** nykyisen tallentimen ja vanhan rekisterilukijan
18 synteettistä tiedostokoetta sekä kymmenen eristetyn slot-admission-
ehdokkaan koetta läpäisivät samassa 28 tapauksen ajossa. Tämä on
karakterisointi ja pieni lukuehdokas, ei valmis v2- tai poistototeutus.
Erillisen v2-codec-/mutaationäytteen 41 tapausta ja tyyppitarkistus
läpäisivät: v1-tavut, null-valinta, nimenmuutoksen no-op ja lisäyksen
syykoodit säilyvät; kelvollisen JSON:n tarkka tavuraja todennettiin.
Rajattu katselmus ja löydösten jälkitarkistus valmistuivat.
Tämä ei todenna tuotannon muunnosvaltuutta, kaikkien slottien admissionia
tai käynnistystä; rajat on kirjattu samaan W7-sopimukseen.
[Sopimusnäyttö ja rajat](local-company-workspace-plan.md#w70n-ensimmäinen-sopimusnäyttö)
nimeävät kirjoittajat, kaikkien journal-slottien tarkistustarpeen ja
inventaarion kadonneen historiallisen kohdesidonnan. Omistaja hyväksyi
25.10.2026 nykyisen omistajan pysyvän kohdesidonnan suunnittelun ja pienen
kokeen, ei vielä tuotantokytkentää. Tunnistamattomia jäämiä ei poisteta.
[Kohdesidonnan ensimmäinen koe](local-company-workspace-plan.md#palautusjäännösten-kohdesidonnan-rajattu-koesopimus)
läpäisi 33 tapausta ja tyyppitarkistuksen; rajattu katselmus ei jättänyt
avoimia löydöksiä. Näyttö koskee replacement-metadatan säilymistä ja
hylkäysrajoja, ei jäännösten purgea tai muiden omistajien kytkentää.
Erilliset 12 nykyisen tukipaketin rajakoetta läpäisivät.
[Rajattu tukisopimusehdotus](support-bundle-plan.md#w70n-rajattu-tukisopimusehdotus)
erottaa nykyisen täyden v2-paketin backendittomasta jatkosta ilman
tekaistua DB-terveystietoa tai permission-fallbackia. Erillisen yksityisen
v3-ehdokkaan 29 ja jatkorajaehdokkaan 31 tapausta sekä tyyppitarkistus
läpäisivät. Tuotannon formaatti, tilanomistajan kytkentä ja oikea
Electron-ketju säilyvät todentamatta.
First-startin 18 nykykäytöksen rajakoetta ja tyyppitarkistus läpäisivät
oikeilla eristetyillä metadata-, registry- ja journal-tiedostoilla.
Nykyistä accepted-build-merkintää ei voi käyttää sellaisenaan valitsimen
hyväksyntään: se ohittaisi tarvittavan W6-inventaarion. Lukija-/kirjoittajakartta
on [W7-sopimuksessa](local-company-workspace-plan.md#pysyvä-yritysvalinta-ja-versioraja).
Uusi selector-hyväksyntä, oikea runtime/restart ja installer-ketju ovat
edelleen todentamatta; avoin vanha C-palautus säilyttää omat porttinsa.
Rajattu katselmus ja sen kahden koetäsmennyksen jälkitarkistus on tehty.
Erillinen hyväksynnän laajuuden lukuehdokas läpäisi 22 tapausta ja
tyyppitarkistuksen; rajattu katselmus ei jättänyt avoimia löydöksiä.
Se säilyttää viimeisen business-hyväksytyn lähtöversion
ja vaatii W6-inventaarion myöhemmässä avauksessa. Oikeiden eristettyjen
metadata-tavujen luku ennen registry-muunnosta todennettiin; varsinainen
muunnos, metadata-slottien yhteinen admission ja uuden päivityshaaran
rollback eivät sisältyneet kokeeseen. Tämä on ehdotus, ei tuotantokytkentä.
Omistaja hyväksyi 25.10.2026 yrityksettömän tilan päivityksen tavallisella
asennuspaketilla; sisäinen updater säilyy avatun yrityksen kautta.
Yksi sovelluspäivitys koskee kaikkia asennuksen yrityksiä. Yrityskohtaiset
tietokantamuunnokset säilyvät W6/W6A.3:n hallituissa avausporteissa;
valitsinhyväksyntä ei todista avaamattoman yrityksen muunnosta tai terveyttä.

**Poiston pieni koe:** kiinteän synteettisen hakemiston 26 tapausta ja
tyyppitarkistus läpäisivät oikeilla tiedostokutsuilla. Mukana olivat osittaisen poiston
jatkaminen sekä kokonaisen toisen testiyrityksen ja ulkoisten kopioiden
tavujen säilyminen. Tämä ei ole koko tuotantoinventaarion tai
prosessiomistajuuden näyttö. Katselmuksen kolme puutetta toistettiin,
korjattiin ja tarkistettiin uudelleen ilman tämän kokeen avoimia löydöksiä.
**Uusin osanäyttö (25.10.2026):** nimivertailun 56 uutta sopimustapausta,
58 nykyistä rekistericodecin regressiota ja tyypit läpäisivät; rajattu
katselmus valmistui ilman avoimia löydöksiä. Vanhojen nimien ja rekisterin
tavut säilyivät. Näyttö ei sisällä tuotannon lease-/julkaisu-, IPC/UI- tai
journal-recovery-kytkentää. Aiemmat osanäytöt säilyvät erillisinä:
poiston backup-todisteen 60 uutta
sopimustapausta, 10 nykyistä lähdetarkistimen regressiota ja tyypit läpäisivät.
Koe vertaa koko sisältökuittia, hylkää vanhentuneen sidonnan ja estää
myöntämisen/kulutuksen uusimisen. Kaksi synkronisen uudelleensisääntulon
koepuutetta toistettiin ja korjattiin; rajattu jälkikatselmus valmistui.
Todellinen snapshot-, salaus-, sulku- ja journal-julkaisuketju eivät
sisälly tähän osanäyttöön. Aiempi valitsimesta avauksen 47 tapauksen ja
33 v1-regression katselmoitu koe sekä terminal-/legacy-, inspection- ja
remnant-kokeet säilyvät erillisinä näyttöinään, eivät uutena yhteistestimääränä.
Tuotantokoodia ei muutettu.
Rajat ja jatkokohdat löytyvät [W7-sopimuksesta](local-company-workspace-plan.md#pysyvä-yritysvalinta-ja-versioraja).
Nämä eivät ole tuotannon tai koko W7.0:n hyväksyntä.
**Seuraava checkpoint:** [kaksi avointa sopimustäsmennystä](local-company-workspace-plan.md#w70n-jäljellä-olevat-sopimustäsmennykset):
poistojournalin aineistoroolit ja schema,
sekä poistopyynnön kentät ja vahvistussidonta.
Poistojournalin lähdekartoitus vahvisti, että vanhoja failed-operaatiojuuria
voi kertyä ilman kiinteää määrärajaa. Omistaja hyväksyi pienen journalin oman
muuttumattoman teknisen kohdeluettelon suunnittelun ja kokeen 25.10.2026.
Ehdotusta ei ole kytketty tuotantoon eikä tämän tallennusrajan koetta vielä
käynnistetty. Polkuomistajat ja ehdotuksen rajat on kirjattu omistavaan
suunnitelmaan; aikaisemmat kokeet säilyvät.
`source = null` -avauksen sopimusehdokasta ei rakenneta uudelleen ilman
uutta siihen kohdistuvaa löydöstä. Sulje avoimet nykyisiin omistajiin ja pieniin koetapauksiin;
jo todennettuja koeaihioita ei rakenneta uudelleen. Inspectionin alkuperäinen luontikuitti,
native-sulku ja W7:n purge-portti sekä selectorin todellinen julkaisuketju
säilyvät tuotantokytkennän portteina. Metadatan julkaisu ja registry-
muunnos säilyvät erillisinä palautumispisteinä.
Registry v1 ei salli `activeWorkspaceId: null` -arvoa, jos jokin
`ready`-yritys jää jäljelle; tätä ei kierretä avaamalla toinen yritys
automaattisesti tai muuttamalla sitä keinotekoisesti vikatilaiseksi.
Hyväksyttyjen suuntien ulkopuolinen uusi poikkeus tuodaan päätökseen;
tuotantokytkennän ehtoja ei merkitä täytetyiksi pelkän luvan perusteella.
R030-06:n aidon ensiasennuksen muutos
säilyy erillisenä rajauspäätöksenä. W7 ja koko `0.3.0`:n M5 ovat avoimia.
Omistajan roadmap-jatkovaltuus säilyy nykyisten päätös- ja turvaporttien mukaan.

## M4.3:n integraatiota edeltävä jatkamiskohta 24.10.2026

Seuraava M1-jatkamiskohta siirrettiin muuttamatta alkuperäistä tekstiä.
[PR #319:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/319#issuecomment-6385011410)
omistaa toteutuneen M4.3:n hyväksynnän. Alla olevat odottavat portit ovat
historiaa, eivät nykyinen työjono. Avoimet syyt ja siivousepävarmuudet säilyvät.

**Hyväksytty lähtö (24.10.2026):** M4.2/R030-03 sekä sen rajattu
Electron `43.8.1` / Undici `7.30.1` -tietoturvapäivitys on hyväksytty
[PR #318:n loppupäätöksellä](https://github.com/eky-software/eky/pull/318#issuecomment-6381002283)
mainiin `7d47bc9e1cf3482ae165c07f77a4919e4a5a29d1`.
Mainin puu vastaa katselmoitua PR-headia
`144f1dd0b000be5ff82c1a8ef46ae9d5bbcc68b6`.
T/A/B/C/K/D/E/F/G/H/I sekä M4.1/M4.2 säilyvät hyväksyttyinä omissa rajauksissaan;
niitä ei toteuteta uudelleen ilman niiden omaa todennettua regressiota.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #318 | [V2, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40065351144) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40065351119) läpäisivät. Kaikki 38 valittua työtä, 11 perhettä, viisi fault-skenaariota, molemmat toistot ja pakolliset askeleet varmennettiin; kuusi diagnostiikkatyötä jätettiin tarkoituksella valitsematta. |
| Mainin omat portit | [V2, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40067796689) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40067796674) läpäisivät. Sama täysi kattavuus ja pakolliset auditointi-/allekirjoitusaskeleet varmennettiin erikseen mainille. Uusintoja ei tarvittu; kuutta valitsematonta diagnostiikkatyötä ei laskettu läpäisyiksi. |

M4.2:n tuore nimisidonta, puhtaan paketin palautusketju sekä päivityksen
runtime-/SQLite-/Linux-todennus, stress ja täysi 30 minuutin soak läpäisivät.
`better-sqlite3 13.0.2`, tietomalli ja backup-formaatit säilyivät.
[Riippuvuusarvio](local-desktop-dependency-review.md#electron-4381-ja-undici-7301)
omistaa rajauksen. Aiempi auditointihylkäys ja integraatiota edeltävä tila
säilyvät [historiassa](release-0.3.0-integration-history.md#m42n-integraatiota-edeltävä-jatkamiskohta-24102026).

**Nykyinen työ:** M4.3/R030-08:n diagnostiikkaselauksen toteutus ja todennus.
Omistaja hyväksyi 24.10.2026 suunnitelman mukaisen jatkon Goalina.
[Diagnostiikan suunnitelma](diagnostics-0.2.9-completion-plan.md#m43-suunnittelu-ja-toteutusjärjestys)
omistaa hyväksytyn käyttötavan, tiedostot, lukijan esikokeen ja hyväksyntäehdot.
Kokonaisbudjetti, muuttuvan aineiston rajaus ja jatkotilan elinkaari on
koottu [hyväksytyksi sopimukseksi](diagnostics-0.2.9-completion-plan.md#m43-jatkohakusopimuksen-ehdotus).
Lukumalli/jatkotilakoe läpäisi 33 synteettistä tapausta ja tiukan
tyyppitarkistuksen. Mukana on myös mallin rajoja osoittavia tutkimustestejä.
Riippumattoman katselmuksen token- ja I/O-sulkutäsmennykset on käsitelty;
sopimustason estettä ei jäänyt. Omistaja hyväksyi jatkohakusopimuksen
toteutuksen ja testit. Reader/application/HTTP, nimetty sulkukytkentä,
strict-client ja web ovat nyt työpuussa pysyvine regressioineen. Oikea
HTTP-/selainketju todentaa molemmat suunnat, vanhan erän säilymisen,
muuttuneen lähteen vanhenemisen ja StrictMode-kaksoiskäynnistyksen eston.
Katkenneen HTTP-pyynnön todellinen tiedosto-I/O odotetaan sulussa loppuun;
alkuperäinen lukuvirhe on todennettu puretusta salatusta testipaketista.
**Paikallinen toteutuscheckpoint:** puhdas lähde
`3ff0bdd347915f4a5efb860d1bec3ff9e84e028f` läpäisi Windows-paketoinnin,
todellisen selaamisen vanhempaan erään ja takaisin, tukipaketin sekä
hardened backup -> inspect -> restore -> restart -> compare -ketjun.
Sama paketti ja build-identiteetti varmennettiin ennen ja jälkeen;
inventaario ei muuttunut. Riippumaton rajattu loppukatselmus on tehty.
Vanhentuneen selauksen virhetilan korjaus, tiukka syötevalidointi ja
testin omien rinnakkaisten lukujen odotusjärjestys on todennettu erikseen:
301 backend-kohdetestiä ja 12 selainpolkua läpäisivät. Normaali työtilan
testikierros ja tyyppitarkistus sekä tuotanto-/kehitysriippuvuuksien audit
läpäisivät; viimeisen kapean deltan tarkistukset on erotettu aiemmista
laajoista sarjoista. Laajan kriittisen ajon ensimmäinen hylkäys ja sen
aineisto säilyvät, eikä korjattu kohdeajo muuta sitä onnistuneeksi.
Seuraavaksi tämän lähteen dokumentointideltan sisältävän täsmä-PR-headin
normaalit portit ja auditointi, suojattu merge sekä uuden mainin omat portit.
Kohdenäyttö ei ole maksimikuorman tai koko integraation hyväksyntä.
M4.3:n toteutus ja integraatio ovat kesken. W7 sekä koko `0.3.0`:n
M5-hyväksyntä ovat erikseen avoimia.
Omistajan roadmap-jatkovaltuus säilyy nykyisten päätös- ja turvaporttien mukaan.

## M4.2:n integraatiota edeltävä jatkamiskohta 24.10.2026

Seuraavan M1-jatkamiskohdan asiasisältö säilytettiin; sen sisäinen
M4.2-sopimuslinkki kohdistettiin takaisin M1:een.
[PR #318:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/318#issuecomment-6381002283)
omistaa toteutuneen M4.2- ja runtime-päivityksen hyväksynnän. Alla olevat
odottavat portit ovat historiaa, eivät uusi työjono. Avoimia aiempia syitä
tai siivousepävarmuuksia ei merkitä tämän vuoksi korjatuiksi.

**Hyväksytty lähtö (24.10.2026):** M4.1/R030-01 on hyväksytty
[PR #317:n loppupäätöksellä](https://github.com/eky-software/eky/pull/317#issuecomment-6376623066)
mainiin `00764a41fb5043aa4822998561f1150ff2e28528`.
Mainin puu vastaa katselmoitua toteutusrevisiota
`f245aec8f5a02b3402b18e1841de9a2f4a167e0d`.
T/A/B/C/K/D/E/F/G/H/I ja M4.1 säilyvät hyväksyttyinä omissa rajauksissaan;
niitä ei toteuteta uudelleen ilman niiden omaa todennettua regressiota.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #317 | [V2, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40027303028) ja [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/40027302511) läpäisivät. PR:n valitut 27 työtä ja yksi toisto hyväksyttiin nykyisen riskisuunnitelman mukaan; kuusi diagnostiikkatyötä jätettiin tarkoituksella valitsematta. |
| Mainin omat portit | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/40031305853/attempts/2) ja [riippuvuustarkistus, suoritusyritys 1](https://github.com/eky-software/eky/actions/runs/40031398176) läpäisivät. Kaikki 38 valittua työtä, 11 perhettä, viisi fault-skenaariota, molemmat toistot ja pakolliset askeleet varmennettiin; kuusi diagnostiikkatyötä olivat tarkoituksella valitsematta. |

**Nykyinen työ:** M4.2/R030-03:n tiedostonimiehdotus nykyisessä backup-polussa
[alla olevan sopimuksen mukaan](release-0.3.0-m1-preparation-plan.md#m42-varmuuskopion-tiedostonimisopimus).
PR #318:n `7c5316dc` läpäisi valitut V2-portit, mutta riippuvuusauditointi
hylkäsi Electronin yhden High- ja Undicin kaksi Moderate-havaintoa.
Omistaja hyväksyi 24.10.2026 niiden täsmäpäivitykset `43.8.1` / `7.30.1`.
[Riippuvuusarvio](local-desktop-dependency-review.md#electron-4381-ja-undici-7301)
omistaa muuttumattoman SQLite-sopimuksen ja uuden runtime-todennuksen.
Päivitys ja sen PR/main-portit ovat kesken; vanha V2-läpäisy ei hyväksy
muuttunutta runtimea. M4.2:ta ei ole vielä yhdistetty tai hyväksytty.
Päivityksen frozen-asennus, molemmat auditoinnit, rekisteriallekirjoitukset,
työtilan testit ja tyyppitarkistus sekä koko Electron-kehitystestisarja
läpäisivät. Erillinen oikean Electronin SQLite-koe todensi nykyiset ja
historialliset rakenteet, tarkistusajurin muistirajan sekä väärän ajurin
hylkäyksen. Paketoitu palautus, endurance ja uuden revision PR/main-portit
ovat vielä erillisiä avoimia hyväksyntöjä.
Omistaja valtuutti 24.10.2026 hyväksytyn roadmapin jatkamisen normaaleine
tarkistuksineen ja integraatioineen ilman toistuvia ajo-/jatkokysymyksiä.
Tämä ei poista turvallisuus-, riippuvuus-, yksityisyys- tai hyväksyntäportteja.
M4.3 ja W7 säilyvät erillisinä; niiden tekniset sopimukset täsmennetään
ennen toteutusta. I:tä ja M4.1:tä ei avata uudelleen.
Omistaja hyväksyi aiempien M4/W7-suunnitelmadokumenttien mukaan ottamisen
omana valmistelucommitinaan; tämä ei hyväksy W7:n tuotantototeutusta.
Koko `0.3.0` ei ole valmis.

## M4.1:n CI:tä edeltävä checkpoint 24.10.2026

Seuraava checkpoint siirrettiin M1:stä muuttamatta alkuperäistä tekstiä.
Sen odottavat PR/main-portit ovat vaihehistoriaa;
[M4.1:n loppupäätös](https://github.com/eky-software/eky/pull/317#issuecomment-6376623066)
omistaa toteutuneen hyväksynnän. Ensihylkäysten tuntemattomia syitä ei suljeta.

**CI:tä edeltävä checkpoint 24.10.2026:** paikallinen toteutus,
webin komponenttisarja, työtilan
tyyppitarkistus ja 14 kohdistettua selainkoetta läpäisivät.
Selainkokeissa tarkistettiin nykyiset COMPANY-LOAD/SAVE-polut ja
UI-WAIT-001/002/003. Backup-panelin desktop/mobile-kuvat ja tekstiskaalaus
125/150 prosenttiin tarkistettiin; tämä ei ole kaikkien näkymien tai
oikean ruudunlukijaohjelman kattava hyväksyntä. Rajattu riippumaton
koodikatselmus ei löytänyt toteutusvirhettä.
Ensimmäisen uuden selainkokeen liian väljä status-valitsin korjattiin;
alkuperäinen hylkäys ja aineisto säilyvät erillään korjatusta kokeesta.
Koko pakettien testisarja ja web-build läpäisivät. Ei vielä PR-/main-
hyväksyntää: julkaisutarkistus sekä täsmällisen PR-revision ja uuden mainin
nykyiset pakolliset portit ovat avoinna.
Selainkomponentin hallittu native-vastaus ei ole varmuuskopion
palautettavuuden tai SMTP-verkkotoimituksen todiste. Uusia backend-,
profiili-, native-, salaisuus- tai lifecycle-polkuja ei tässä muuteta.

## I:n integraatiota edeltävä jatkamiskohta 23.10.2026

Seuraava jatkamiskohta ja I:n valmistelusopimus siirrettiin M1:stä
M4-valmistelun alkaessa muuttamatta alkuperäistä tekstiä. Sen avoimet
portit ja tulevaa työtä kuvaavat muodot ovat päivättyä historiaa.
[I:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/316#issuecomment-6370140644)
sitoo hyväksynnän katselmoituun PR-headiin, uuden mainin omiin portteihin
ja erilliseen omistajan päätökseen. Ensihylkäykset ja puuttuvat todisteet
eivät muutu korjatuiksi; nykyinen lähtö ja M4-valmistelu ovat M1:n alussa.

### I:n aiempi jatkamiskohta

**Hyväksytty lähtö (23.10.2026):** H1-H5/R21/R22/R24/R25/R26 ja
D029-03/04/05 on hyväksytty PR #315:n kautta mainiin
`7e2dba840f4434eeb6049feda70852751343e134`.
[H:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918)
erottaa katselmoidun PR-headin `bc44ffc20552d81ae27e69f5376f8cfdef6bdf51`,
uuden mainin omat portit ja omistajan rajatun loppupäätöksen. Mainin puu
vastaa hyväksyttyä PR-headia. T/A/B/C/K/D/E/F/G/H säilyvät hyväksyttyinä;
niitä ei toteuteta uudelleen ilman niiden omaa todennettua regressiota.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #315 | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/39919386542/attempts/2): 38 onnistunutta työtä ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39919386450) läpäisi ensimmäisellä suoritusyrityksellä. |
| Mainin omat portit | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/39936314545/attempts/2): 38 onnistunutta työtä ja samat kuusi valitsematonta diagnostiikkatyötä. [Mainin oma riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39936392065) läpäisi ensimmäisellä suoritusyrityksellä. Vaaditut työt ja askeleet, kaikki viisi fault-skenaariota ja molemmat toistot varmennettiin; ohituksia ei lasketa läpäisyiksi. |

**Nykyinen työ:** I/R30/R31:n hyväksytyn rajauksen toteutus ja todennus
[alla olevan rajauksen mukaan](#i--ci-politiikan-ja-ajantasaisten-sopimusten-valmistelu).
Omistaja hyväksyi 23.10.2026 esitetyn rajatun jatkon Goalina: neljän
nimetyn asiakasselaintestin CI-erottelu ja osoitettujen ohjevirheiden korjaus.
Kohderegressiot, nykyinen 425 testin CI-sopimussarja, riippuvuusauditointi
ja rajattu riippumaton katselmus ovat läpäisseet. [PR #316](https://github.com/eky-software/eky/pull/316)
ei ole vielä hyväksytty: ensimmäinen kierros ja sen yksi rajattu
kohdeuusinta säilyvät [integraatiocheckpointissa](https://github.com/eky-software/eky/pull/316#issuecomment-6366351666).
Supervisor ja Electron läpäisivät kohdeuusinnan, mutta web-työ katkaistiin
kokonaisaikarajaan. Erillinen laskun jälkiluvun yhteysvirhe ja ensimmäisten
yritysten aineisto-/siivouspuutteet jäävät avoimiksi, eivät korjatuiksi.

**Omistajan jatkopäätös 23.10.2026:** vain web-työn kokonaisraja nostetaan
15 minuutista 20 minuuttiin. Talteen saatu yhteysvirhe tutkitaan rajatusti
ennen yhtä uutta normaalia PR/CI-kierrosta. Testikohtaiset, runtime- ja
siivousrajat, flaky-hylkäys ja muut hyväksyntäehdot säilyvät
[testausohjeen rajauksen mukaan](../ai/testing-rules.md#web-cin-kokonaisbudjetti).
Mahdollinen sovelluskoodin muutos vaatii erillisen päätöksen. Jäädytetyn
uuden PR-headin ja uuden mainin omat portit vaaditaan edelleen.
Rajatussa lähdekatselmuksessa ei osoitettu yhteyskatkon korjattavaa syytä.
Nykyisen laskun elinkaaritestin yksi kohdeajo läpäisi ilman uusintaa ja
varmensi siivouksen. Tämä ei selitä alkuperäistä yhteysvirhettä eikä muuta
sitä korjatuksi; testiin tai sen kuljetuskerrokseen ei lisätty uusintaa.
I:n aiemmin hyväksyttyä ohjeverkon huoltoa ei tehdä uudelleen.

**Avoimet havainnot:** PR #315:n ensimmäisen kiintiö-/flush-testin
aikakatkaisun tarkka syy säilyy avoimena. Mainin ensimmäisessä
legacy-kokeessa prosessipuun poistumista ei saatu varmennettua
siivousbudjetissa; alkuperäinen siivoustila jää epävarmaksi. Keräyksen
rajaamassa aineistossa ei ollut kyseisen epäonnistuneen vaiheen tulosta.
Mainin ensimmäinen workspace-fault-ajo odotti MSI:n sulkemispyynnön
vastausta ennen kohteen keskeytysinjektiota. Tarkkaa estäjää tai syytä
ei tunnistettu. Sen loppusiivous ja business-datan säilyminen todennettiin,
mutta hylätyn skenaarion semanttista onnistumista ei tarkistettu.
Yksi hyväksytty kohdeuusinta läpäisi samalla lähteellä ja samoilla valmiin
workspace-paketin tavuilla. Se ei korjaa tai jälkikäteen hyväksy
ensihylkäyksiä; luvat on käytetty ja keräyksen kattavuusrajat säilyvät.
Myös G:n ja aiempien pakettien avoimet syyt sekä aineistoaukot säilyvät
niiden omissa checkpointteissa. [H:n edeltävä jatkamiskohta ja suunnitelma](release-0.3.0-integration-history.md#hn-integraatiota-edeltävä-jatkamiskohta-23102026)
ovat historiassa. I:n loppuosa sekä M4/M5 ovat vielä avoimia;
H:n hyväksyntä ei ole koko `0.3.0`:n hyväksyntä.

### I / CI-politiikan ja ajantasaisten sopimusten valmistelu

**Tila 23.10.2026:** rajattu toteutus hyväksytty Goalina, todennus kesken. I omistaa vain
CI-valinnan politiikan ja nykyisten sopimusten vastaavuuden tarkistuksen.
Se ei omista testiskenaarioita, prosessienhallintaa tai liiketoimintalogiikkaa.
Lähtöhavainnot R30/R31 on verrattu nykyiseen lähteeseen; historiallinen
havainto ei sellaisenaan todista nykyistä puutetta.

| Pala | Nykyinen havainto ja omistaja | Suunniteltu tulos |
| --- | --- | --- |
| I0: lähtö ja säilyvät sopimukset | Hyväksytty H-main sekä aiemman PR #306:n ohjehuollon ja myöhempien pakettien omat checkpointit. | Rajattu nykytila ja tiedosto-/testikartta; valmiita korjauksia tai ohjeiden reititystä ei rakenneta uudelleen. |
| I1 / R31: sopimusten vastaavuus | [Integraatiomatriisi](module-integration-matrix.md), [E2E-strategia](e2e-testing-strategy.md) ja niiden lifecycle/recovery-lähteet. | Vertaa voimassa olevat väitteet todellisiin kutsujiin. Korjaa vain osoitetut nykytilavirheet; säilytä päivätyt foundation-vaiheet historiana. Kirjaa myös jo korjatun havainnon vastanäyttö. |
| I2 / R30: rajattu valinta | Repositoryjuuren `.github/scripts/ciRiskPolicy.mjs` omistaa hyväksytyn neljän asiakasselaintestin täsmällisen listan. Muu `apps/e2e/` säilyttää aiemman luokituksen. | Kolme nopeaa perhettä vain nimettyjen testien PR-muutokseen; negatiiviset verrokit ja nykyiset hyväksyntäportit säilyvät. Ei kaikkien E2E-polkujen yleistä kevennystä. |
| I3: todistus ja integraatio | Nykyiset riskiluokittimen, diff-valinnan, tuloskoonnin ja workflow-kytkentöjen sopimustestit. | Hyväksytyn muutoksen regressiot, riippumaton katselmus ja täsmärevision omat PR/main-portit. Valmistelun tai yhden luokittelukokeen läpäisy ei sulje I:tä. |

**I1:n rajattu lähdekatselmus ja korjaus:** integraatiomatriisi kuvasi
Update Coordinatorin Diagnostics-/support-projektion G/D029-02:n
tulevaksi työksi, vaikka diagnostiikan omistava suunnitelma sulkee kohdan
ja nykyinen `diagnosticOperationalEventProjector.ts` käyttää
`diagnosticUpdateSpecs`-projektiota. Myös Company Settings -> Invoicing
-salaisuusrajan D- ja Diagnosticsin H-integraatiomerkinnät olivat jäljessä
hyväksytyistä porteista. Nämä status- ja omistajaviitteet on oikaistu;
tuotantopolkuja ei tarvitse rakentaa uudelleen. Matriisin W2-W6-tekstit
on jo nimetty historiallisiksi ja E2E-strategian kahden prosessin
packaged-palautus vastaa nykyistä smoke-ajuria. Tämä otoskatselmus ei
todista kaikkien ohjeiden sisällön ajantasaisuutta tai sulje vielä R31:tä.

#### I:n säilytettävä CI-sopimus

- Nykyinen controller on repositoryjuuren
  `.github/workflows/ci-cadence-contracts.yml`. Se käyttää
  `classifyCiChanges.mjs`:ää, `ciRiskPolicy.mjs`:ää,
  `verifyCiRun.mjs`:ää ja `ciJobCoverage.mjs`:ää. Sama suunnitelma
  välitetään nykyisille reusable-workfloweille; rinnakkaista valitsinta
  tai hyväksyntäkoontia ei lisätä.
- Nopea PR-valinta säilyttää `verify`-, `systemSecurity`- ja
  `webCritical`-perheet. Se ei tarkoita testien ohittamista.
  Desktopin jaetut fixturet, ympäristö, raportointi, buildit ja
  elinkaarikoodi säilyttävät nykyiset compatibility-/full-ehdot.
- Tuntematon polku, puuttuva/epätäydellinen vertailu, sekamuutoksen tiukin
  riski sekä siirron vanha ja uusi polku käsitellään suljetusti.
  `AGENTS.md`, riippuvuudet, SQL, tsconfig-/pakettimääritykset ja CI-politiikka
  säilyttävät täyden valinnan.
- Main-push, ajastettu ja manuaalinen controller-ajo säilyttävät kaikki
  nykyiset 11 perhettä, viisi fault-skenaariota ja kaksi toistoa.
  Vaaditut `V2 acceptance` ja `Audit dependencies` sekä mainin omat
  portit eivät muutu. R30-ehdotus nopeuttaisi vain nimettyjen PR-muutosten
  palautetta, ei mainin täyttä hyväksyntää.
- T1/T2/T3:n fixturet, prosessiomistajuus, sandbox, testitapaukset,
  aikarajat ja alkuperäisten virheiden salattu keräys säilyvät. Luku-,
  valinta- ja tulostodisteet erotetaan; puuttuvaa näyttöä ei arvata.

#### I-P1: R30:n hyväksytty pienin muutos

**Omistajan hyväksymä rajaus 23.10.2026:** käytä täsmällistä
tiedostoallowlistiä, älä koko `tests/web/`-hakemistoa. Listaan kuuluvat
`customerAndCompanyJourneys.spec.ts`, `customerOverviewJourneys.spec.ts`,
`customerRelationshipJourneys.spec.ts` ja `customerInvariantJourneys.spec.ts`
nykyisessä `apps/e2e/tests/web/`-kansiossa. Neljä skenaariota tarkistettiin
tukikutsuineen: nykyinen `isolatedWebTest`, loopback-API, browser/UI sekä
synteettisen aineiston DB-/lokiväitteet. Lasku-/PDF-kutsut käyttävät nykyistä
backend-API:a, eivät Electronia tai installer-/palautuspolkua. Salaisuusdata
on testiruntimen synteettistä dataa, ei käyttöjärjestelmän secret-store.
Yhteisen fixturen, datan, assertionien tai journey-tuen muutos säilyttää
compatibility-valinnan. Pelkkä tiedoston nimi ei todista sen kaikkia
tulevia muutoksia turvallisiksi.

Hyväksytty lista muuttaa vain näiden tiedostojen yksinomaisen PR-muutoksen
nykyiselle nopealle polulle. Uudet selaintiedostot, Electron-/packaged-/
endurance-testit, fixturet, apukoodi, konfiguraatio ja raportointi säilyvät
nykyisellä varovaisella polulla. Listaan otettavan testin vastuun myöhempi
muutos edellyttää myös riskikartan tarkistusta. Valitsematta jäi aiemman
konservatiivisen luokituksen säilyttäminen kaikille skenaarioille;
R30:n P3-havainto ei itsessään tarkoittanut sovelluksen correctness-virhettä.

**Paikallinen checkpoint:** viisi uutta väitettä hylkäsi aiemman luokittimen
odotetusti (35 testiä: 30 läpäisi, viisi hylkäsi). Korjauksen jälkeen kaikki
35 luokittelu-/diff-testiä läpäisivät. Ensihylkäys säilyy erillisenä;
kyse on ennen/jälkeen-regressiosta, ei saman revision vihreäksi uusimisesta.
Nykyinen koko `test:ci` läpäisi myös uuden selaintapauksen
`classifyCiRisk -> requiredCiJobs -> evaluateCiRun`-ketjun kanssa: 425 testiä,
ei hylkäyksiä tai ohituksia. Riippuvuusauditointi ja rajattu riippumaton
katselmus läpäisivät; katselmoija ei ajanut testejä itse. Dokumenttien
132 tiedoston 1 640 suhteellista linkkiä ja ankkuria tarkistettiin ilman
rikkinäistä kohdetta. Siirretyn H-tekstin ja aiemman historian säilyminen
varmennettiin erikseen. Nämä paikalliset tulokset eivät korvaa PR/main-portteja.

#### I:n toteutus- ja todistusjärjestys

1. Sulje I1/R31 lähdeviitteillä: nykyinen väite -> oikea tuotantokutsu ->
   säilyvä vastuuohje -> testi/portti. M1:n hyväksyntätilan oikaisu ei yksin
   todista koko ohjeverkon sisällön ajantasaisuutta.
2. Ratkaise I-P1 ja lopulliset polut ennen `ciRiskPolicy.mjs`:n muutosta.
   Käytä nykyisiä `ciRiskPolicy.test.mjs`-, `classifyCiChanges.test.mjs`-,
   `ciAcceptanceResult.test.mjs`-, `ciRunAcceptance.test.mjs`- ja
   `verifyCiRun.test.mjs`-testejä. Ei uutta testialustaa tai riippuvuutta.
3. Todista nimetty selaintapaus ja sen verrokit: uusi tuntematon testipolku,
   yhteinen fixture, Electron-/packaged-polku, riippuvuus-/SQL-/policy-muutos,
   siirto molempiin suuntiin, sekoitus ja polkujärjestys,
   epäonnistunut diff sekä main/ajastus/manuaaliajo.
   Virheellinen suunnitelma, puuttuva työ/askel/toisto tai sallimaton
   onnistuminen ei saa päästä koonnista läpi.
4. Varmenna muuttuneiden ohjeiden reitit, ankkurit, siirretyn tekstin
   säilyminen ja julkaisuyksityisyys. Nykyinen kohdekomento on `pnpm test:ci`;
   uuden kokeen alussa nimetään seurannan omistaja ja säilytysketju.
5. Rajattu riippumaton katselmus, jäädytetyn PR-headin normaalit portit ja
   auditointi, hyväksytyn Goalin valtuudella normaali suojattu merge sekä
   uuden mainin omat portit. CI-politiikkatiedoston muutos valitsee itsessään
   täyden matriisin. Vanhoja MSI-/cleanup-havaintoja ei suljeta vihreydellä.

I ei lisää runtime-, DB-, HTTP-, preload-, secret- tai backup-formaattimuutosta.
Siksi erillistä uutta toiminnon backup-/restore-toteutusta ei tarvita
pelkän dokumentti-/valintapolitiikan vuoksi; nykyiset paketti- ja
palautusportit säilyvät. M4:n ominaisuudet, W7:n käyttäytymisvalinnat,
M5:n koko sovelluksen katselmus/Deep Scan ja laaja refaktorointi jäävät
erillisiksi. Rajattu takaperin tehtävä tarkistus valinnasta toteutukseen
riittää I:lle; koko arkkitehtuuria ei suunnitella uudelleen.

## H:n integraatiota edeltävä jatkamiskohta 23.10.2026

Seuraava jatkamiskohta sekä H:n suunnitelma ja toteutuscheckpointit
siirrettiin M1:stä I-valmistelun alkaessa. Teksti säilytettiin; sen avoimet
portit kuvaavat syntyhetkensä tilaa, eivät uutta työjonoa.
[H:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918)
sitoo myöhemmän hyväksynnän PR-headin ja uuden mainin omiin portteihin.
Alkuperäinen legacy-siivousepävarmuus ja MSI-odotuksen tarkka syy säilyvät
avoimina. Nykyinen lähtö ja I:n valmistelu ovat M1:n alussa.

### Aiempi jatkamiskohta

**Hyväksytty lähtö (23.10.2026):** G/R20/R23 ja D029-01/02 on hyväksytty
PR #314:n kautta mainiin `80139f6dffc01f7df2ed0ef8779636d67c4ee23d`.
[G:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/314#issuecomment-6356610094)
erottaa hyväksytyn PR-headin `9c5d3ffe08046c6be81e5e61de7852731ee22c98`,
uuden mainin omat portit ja ensihylkäysten avoimet havainnot. Mainin puu
vastaa hyväksyttyä PR-headia. T/A/B/C/K/D/E/F/G säilyvät hyväksyttyinä;
niitä ei toteuteta uudelleen ilman niiden omaa todennettua regressiota.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #314 | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/39860418986/attempts/2): 38 onnistunutta työtä ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39860418852) läpäisi ensimmäisellä suoritusyrityksellä. |
| Mainin omat portit | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/39887988572/attempts/2): 38 onnistunutta työtä ja samat kuusi valitsematonta diagnostiikkatyötä. [Mainin oma riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39888226627) läpäisi ensimmäisellä suoritusyrityksellä. Ohituksia ei lasketa läpäisyiksi. |

**Nykyinen työ:** H:n hyväksytyn rajauksen toteutus
[alla olevan valmistelun mukaan](#h--diagnostiikan-saatavuuden-ja-oikeellisuuden-suunnitelma).
Omistaja hyväksyi 23.10.2026 H-P1:n kolmen lukutilan suunnan sekä H-P2:n
ei-estävän, deduplikoidun häiriöpalautteen ja koko H:n loppuunviennin Goalina.
H1-H3:n paikallinen korjauscheckpoint on tallennettu. H4:n lukutila kulkee
nykyisistä lukijoista HTTP:n ja strict-clientin kautta käyttöliittymään;
kohde-, selain- ja tukipakettiketjun näyttö on alla. H4:n katselmushavainto
on korjattu ja H5:n hyväksytty sovellusilmoitus on paikallisesti todennettu
main/preload/UI-ketjussa. Vaikutusalueen paikalliset loppusarjat, tyypitys,
auditointi ja katselmus ovat läpäisseet. Korjatun puhtaan revision
pakettitodistus on läpäissyt; seuraavaksi tehdään H:n PR/main-integraatio.
PR #315:n ensimmäinen kierros hylkäsi itsenäisen virheaineistofixturen
valmistelun; rajattu testikorjaus ja uusi täsmärevision kierros ovat kesken
[alla olevan checkpointin mukaan](#hn-pr-integraation-rajattu-jatko).
Uudet käyttäytymis-, turvallisuus-
tai muut erilliset päätökset ratkaistaan ennen niiden vaikutusalueen kytkentää;
samoja H-P1/H-P2-periaatteita ei kysytä uudelleen. Toteutus ja sen portit
ovat vielä avoimia.
I:n loppuosa ja M4/M5 odottavat; tämä ei ole koko 0.3.0:n hyväksyntä.

**Avoimet havainnot:** PR #314:n ensimmäinen legacy-ajo päättyi työn
37 minuutin kokonaisrajaan ilman saatavaa testilokia tai siivoustodistetta.
Omistaja hyväksyi rajatun etenemisen yhden samoilla paketeilla läpäisseen
kohdeuusinnan jälkeen; ensimmäinen syy ja siivoustila jäävät tuntemattomiksi.
Mainin ensimmäinen native-ikkunatestin valmistelu ylitti nykyisen
käännösrajan; alkuperäiset virheet säilyivät salatussa paketissa ja
prosessipuun poistuminen todennettiin. Viiveen tarkka syy jäi avoimeksi.
Mainin ensimmäinen web-ajo katkesi kokonaisrajaan ulkoisen
riippuvuusvalmistelun viivyttyä; osittainen testitulos ja puuttuva lopullinen
siivoustodiste eivät muutu läpäisyksi. Yksi kohdeuusinta läpäisi molemmat
työt ja niiden pakolliset seuraajat samalla lähteellä. Aiempien
palautustestien, PR #312/313:n ja vanhempien ajojen syyepävarmuudet sekä
aineiston säilytysrajat pysyvät avoimina.
G:n [edeltävä jatkamiskohta ja toteutuscheckpoint](release-0.3.0-integration-history.md#gn-integraatiota-edeltävä-jatkamiskohta-23102026)
säilyvät historiassa; yksittäinen onnistunut uusinta ei todista vikaa
korjatuksi.

### H / Diagnostiikan saatavuuden ja oikeellisuuden suunnitelma

**Tila 23.10.2026:** H-P1/H-P2:n suositukset ja H:n toteutus Goalina hyväksytty.
H1-H5:n korjaukset ovat paikallisesti toteutettuja ja rajatusti todennettuja;
PR-/main-portit ovat avoimia. Paikallinen puhdas pakettinäyttö on alla.
Alkuperäiset R21/R22/R24/R25/R26
on verrattu hyväksytyn G-mainin lähteeseen; taulukko kuvaa lähtöpuutteet,
korjausvastuut ja niiden todistusvaatimukset. R24/R25/R26 vastaavat D029-03/04/05:tä,
eivät erillisiä toteutusjonoja. [Roadmap](release-0.3.0-plan.md#m3-muut-invariantit-diagnostiikka-ja-ylläpidettävyys)
omistaa rajauksen ja [diagnostiikan täydennyssuunnitelma](diagnostics-0.2.9-completion-plan.md#korjauskohteet)
sen aiemmat synteettiset havainnot. Historiallista vikaprobea ei lasketa
nykyisen revision korjaustestiksi.

#### H:n omistajat ja etenemisjärjestys

| Pala / havainto | Nykyinen omistaja ja lähdehavainto | Rajattu suunniteltu korjaus ja todistus |
| --- | --- | --- |
| H1 / R21 | Backendin `operationalLogRetention.ts` ja `incidentIndexRetention.ts`, desktopin vastaavat `desktopOperationalLogRetention.ts` ja `desktopIncidentIndexRetention.ts`; `createBackendOperationalLogger.ts`, `http/app.ts` ja `desktopComposition.ts` kutsuvat huoltoa käynnistyksessä. Listaus- ja stat-poikkeuksia voi nousta ennen best-effort-rajaa. | Rajaa tunnetun lokijuuren I/O-virheet nykyiseen huoltovastuuseen, jatka muita turvallisesti tarkistettavia kohteita äläkä merkitse epäonnistunutta poistoa tehdyksi. Testaa EACCES, listauksen jälkeinen ENOENT ja muu stat-/readdir-/unlink-virhe kaikissa neljässä adapterissa sekä todellinen backend-/main-koostaminen. Väärä luotettu konfiguraatio, DB-/omistajuusvirhe tai epävarma palautus ei muutu onnistumiseksi tämän catchin kautta. |
| H2 / R22 | Molempien runtimejen detailed- ja incident-retention laskee tulevat kuukaudet/vuodet kokonaisbudjettiin ennen vanhimpien poistoa. Nykyinen tulevaisuustesti ei kata kiintiopainetta. | Tuleva tiedosto ei osallistu kelvollisen historian poistoperusteeseen eikä saa muuttua automaattiseksi poistokohteeksi. Testaa todellinen kiintiopaine, nykyinen aktiivisen tiedoston suoja, epäonnistuneen poiston laskurit ja vuosiraja. Retention-ajat ja kapasiteettirajat eivät muutu; tulevaisuusaineisto ei todista vanhan historian kattavuutta. |
| H3 / R24, D029-03 | Diagnosticsin `fileSystemSupportBundleDiagnosticEventReader.ts` ja `fileSystemSupportBundleIncidentSummaryReader.ts` katkaisevat valinnan tiedostojärjestyksessä ja lajittelevat vasta valitut rivit/ryhmät. | Valitse ajan ja vakaan tasatilanteen mukaan uusimmat tapahtumat/ryhmät luetusta, validoidusta aineistosta eri virtojen yli. Rajaa lähdeluku, ehdokkaat, muisti ja ulostulo erikseen; incidentin laskuri ja ensimmäinen/viimeinen aika kattavat vain todella käsitellyn aineiston. Testaa limit=1, lomittuvat ajat, tasatilanteet, duplikaatit, ryhmän myöhemmät rivit, lukumäärä-/tavu-/lähderajat ja rikkinäinen lähde. |
| H4 / R25, D029-04 | `fileSystemDiagnosticEventReader.ts` hukkaa rivin/lähteen lukuvirheen tyhjään listaan; `fileSystemOperationalLogDiagnosticSummaryReader.ts` päättelee saatavuuden tiedostoista. Portti, `listDiagnosticEvents.ts`, HTTP, strict API-client ja `useDiagnostics`/`DiagnosticsPageView` eivät välitä kattavuustilaa. | Hyväksy H-P1 ennen yhteistä reader -> application -> HTTP -> strict-client -> UI -muutosta. Tyhjä tulos, osittainen luku ja puuttuva tieto erotetaan. Kelvolliset rivit säilyvät muun lähteen hajotessa. Summaryn viimeisin virheaika ei lupaa rajattoman historian kattavuutta tai toimivaa writeriä. |
| H5 / R26, D029-05 | `desktopComposition.ts` ei anna `JsonLineDesktopOperationalLogger`:lle failure sinkiä; backendin `IncidentIndexOperationalLogFailureSink` toimii nykyisenä vertailuna. Ulompi incident-adapteri ei havaitse sisemmän info-kirjoituksen häiriötä. | Kytke nykyinen failure-sink-portti vasta H-P2:n jälkeen. Deduplikoi rajattu syy/virta prosessin sisällä, käytä olemassa olevaa minimoitua incident-indeksiä best effort -yritykseen ja testaa myös sen epäonnistuminen. Kirjoitus-/kapasiteettihäiriö ei muuta business-tulosta, toista business-operaatiota tai kutsu rikkoutunutta writeriä rekursiivisesti. |

H1/H2 ovat saman retention-vastuun korjauksia, eivät uusi huoltopalvelu.
H1/H2:n neljä adapteria läpäisivät 104 kohdetestiä. Oikean backendin
koostamisen kolme regressiota ja nykyisen desktop-koostamisen kaksi
käynnistysregressiota läpäisivät; writerin ja fallbackin kuusi viereistä
regressiota sekä backendin ja desktopin tyypitys läpäisivät. Desktopin koko
nykyinen käynnistys-/palautustiedosto ja kaksi writer-tiedostoa läpäisivät
myös 163 testin sarjana. Määrät ovat osittain päällekkäisiä, eivät erillinen
yhteistulos. Paketoitu näyttö on edelleen avoin.

H3:n uudet regressiot toistivat seitsemän odotettua valinta-/laskuripuutetta
ennen korjausta. Kahden lukijan viimeisin rajattu sarja läpäisi 31 testiä,
mukaan lukien ristiriitaisen saman tunnisteen valinta ja saman luetun
aineiston uudelleenlaskennan sekä incidentin täsmällisen aikaleimaformaatin
säilymisen todistus. Riippumaton H1-H3:n adapteri- ja
lukijakatselmus ei löytänyt korjattavaa; viimeiset käynnistystestit eivät
kuuluneet sen tarkistushetkeen. H4/H5:n näyttö on alla; loppusarjat,
pakettinäyttö ja H:n integraatiohyväksyntä ovat edelleen kesken.
H3 hyödyntää nykyistä `boundedJsonlSourceReader`-primitiiviä; projektio,
incident-ryhmittely ja budjetit säilyvät omissa adaptereissaan. Lopullinen
tapahtumajärjestys ja incident-ryhmän päivittyvä koko tarkistetaan myös
budjetin jälkeen. Kaikkia lähteitä ei lueta rajatta uusimman etsimiseksi:
lähdekatkaisu ilmoitetaan, eikä luetun otoksen uusinta väitetä koko
historian uusimmaksi. Tuntemattoman eventin tarkoituksellinen poissulku
erotetaan todetusta luku-/rakenneviasta ilman katalogin löysennystä.

#### H-P1: Hyväksytty lukutilan suunta

Omistajan hyväksymä suunta on pieni, suljettu lukutulos: tapahtumat sekä kattavuustila
`complete|partial|unavailable` ja vain tarpeelliset sallitut tekniset syyt.
Tyhjyys johdetaan tapahtumista, ei neljänneksi terveysväitteeksi.
`complete` tarkoittaa vain sovitun rajatun haun kattavuutta, ei koko
retention-historian tai writerin terveyden todistusta. Tulos-/lähderajan
tuleminen vastaan on `partial`, ei historian loppu. Puuttuva konfiguraatio
erotetaan todellisesta lukuvirheestä; tarkoituksella tyhjä browser-profiili
ei esitä lokihäiriötä. Kelvolliset rivit ja niiden osittaisuus voidaan
näyttää yhdessä. Tiedostoja löytyi -boolean ei korvaa tätä sopimusta.

Täsmällinen events-/summary-vastaus, yhdistelmäsäännöt ja puuttuvan
hakemiston tulkinta omistetaan [Diagnosticsin lukutilan sopimuksessa](../modules/diagnostics.md#lukutilan-sopimus).
Strict-client hylkää väärät kentät, arvot ja ristiriitaiset yhdistelmät.
Tässä on myös erillinen tukipakettiraja: `prepareSupportBundleDiagnosticData.ts`
liitti aiemmin `runtimeSummary`-olion vastaukseen sellaisenaan, mutta
mainin `supportBundleBackendData.ts` hylkää lisäkentät omalla strict-
validaattorillaan. Pelkkä julkisen API-clientin päivitys ei siis riittänyt.
H-P1:ssä hyväksytään siksi samalla uuden summaryn eksplisiittinen projektio
nykyiseen formaatti-2-yhteenvetoon ja olemassa oleviin katkaisulippuihin.
Nimetyt kentät mapataan erikseen; uusi lukutila ei valu artifactiin
spreadillä tai validaattorin yleisellä löysennyksellä. Pysyvä regressio
todistaa uuden summaryn -> tuotetun paketin -> nykyisen tarkastimen ketjun,
uuden lukutilan poissulun ja vanhan formaatin lukuyhteensopivuuden.
Jo käytössä oleva tukipaketin `sourceTruncated` ja formaatti 2 säilyvät.
Vanhoja `.json.gz`-/`.ekysupport`-paketteja ei kirjoiteta uudelleen.
Summary ja lista kuvaavat omia lukutuloksiaan, eivät atomista yhteissnapshotia.
Rajattu riippumaton H3/H4-suunnitelmakatselmus tunnisti tämän erillisen
summary-vastaanottorajan; yllä oleva täsmennys kuuluu samaan H-P1-päätökseen,
ei uuteen tukipakettiformaattiin tai toteutuksen hyväksyntään.

**H4:n toteutettu kytkentäsopimus (paikallinen näyttö, ei integraatiohyväksyntä):**

- Events-vastaus sisältää `diagnosticEvents`-listan ja `readState`-olion;
  summary saa erillisen `operationalLogReadState`-olion. Portti palauttaa
  saman lukutuloksen kuin application/HTTP/client, ei rinnakkaista
  yhteensopivuuslukijaa. Nykyiset kuluttajat päivitetään samassa palassa.
- Tilakentät ovat `status` ja `reasons`. Sallitut syyt ovat
  `notConfigured`, `sourceUnavailable`, `invalidEntries` ja `limitReached`.
  Syyt ovat yksilöllisiä ja rajattuja, eivät raakavirheitä. `complete`
  vaatii tyhjän syylistan. `partial` vaatii vähintään yhden muun syyn kuin
  `notConfigured`. `unavailable` käyttää vain syytä `notConfigured` tai
  `sourceUnavailable`, eikä palauta tapahtumia tai havaituiksi väitettyjä
  lokimittareita. Strict-client hylkää ristiriitaiset yhdistelmät.
- Konfiguroimaton browser-runtime on `unavailable/notConfigured`;
  puuttuva tai turvaton konfiguroitu juuri on
  `unavailable/sourceUnavailable`. Varmennetun lokijuuren puuttuva
  valinnainen virtakansio on tunnettu tyhjä lähde, ei itsessään virhe.
  Koko haun lukematta jääminen on `unavailable`; kelvollisten osatulosten
  rinnalla oleva lukuvirhe on `partial`. Luettava mutta rikkinäinen aineisto
  on `partial/invalidEntries`, ei onnistunut tyhjä historia.
- Tiedosto-, tavu- tai tulosrajan havaittu katkaisu on `limitReached`.
  Tuntemattoman tapahtumaperheen tarkoituksellinen poissulku erotetaan
  tunnetun perheen virheellisestä rivistä nykyisen katalogin omistajassa.
  Kelvollinen aineisto säilytetään muun lähteen hajotessa. Summaryn ajat ja
  tavumäärä kuvaavat havaittua aineistoa, eivät puuttuvan osan arvausta.
- UI erottaa tekstit "Diagnostiikkatapahtumia ei ole vielä.",
  "Diagnostiikkatiedot ovat osittaiset." ja
  "Diagnostiikkatietoja ei voitu lukea." Konfiguroimaton browser-lähde
  kerrotaan saatavuusrajoitteena, ei lokituksen toimivuuden väitteenä.
  Partial-lista näkyy ilmoituksen rinnalla; epäonnistunut summary ei muuta
  onnistunutta tapahtumahakua tyhjäksi. Tyhjyys ei osoita writerin terveyttä.
- Tukipaketin `runtimeSummary` saa vain nykyisen formaatin nimetyt kentät
  eksplisiittisestä projektiosta. Uutta lukutilaa ei serialisoida siihen.
  Vanhojen kenttien havaintoluonne dokumentoidaan; niiden tyhjyydestä ei
  päätellä täydellistä historiaa. Nykyiset `truncated`-liput johdetaan edelleen
  omista 30 päivän lukijoistaan, ei eri haun summary-tilasta. Epävarmaa
  summarya ei väitetä näillä lipuilla tarkasti mitatuksi tukipakettikatkaisuksi.

H4:n lukija- ja kuluttajamatriisi on päivitetty samassa muutoksessa.
Diagnostiikan ja todellisen HTTP-koostamisen 233 kohdetestin sarja sekä
laajempi 383 testin sarja nykyisine laskutuskuluttajineen läpäisivät.
API-clientin 555 testiä ja koko webin 966 testiä läpäisivät. Seitsemän
selainruntimen tapausta todensi osittaiset rivit, riippumattoman summary-
virheen, kaksi unavailable-syytä sekä komponentin molemmat valmistumis-
järjestykset ja myöhäisten virheiden torjunnan clientin vaihdossa/remountissa.
Kahden system-testin sarja todensi
HTTP/strict-clientin, generoidun gzipin/checksumit sekä nykyisen tarkastimen
`.json.gz`- ja `.ekysupport`-luvut. Määrät ovat eri rajojen näyttöjä, eivät
koko H:n tai saman revision kaikkien porttien yhteistulos.

Nykyisen yksityisen virheketjun kaksi salaus-/purkukoetta läpäisivät:
synteettisen lukijan alkuperäinen poikkeus, pino ja syyketju säilyivät ennen
turvallista muunnosta. Malformed-rivin sisältöä ei kerätä. Tavallinen
runtime ei kytke testihavaitsijaa. Ensimmäisten testiodotusten hylkäykset
säilytetään; korjaukset koskivat puuttuvaa lukutuloskuluttajaa, tarkkaa
nykyistä esitysmuotoa ja uuden testin yksiselitteistä otsikkovalitsinta.
Backendin, API-clientin ja E2E:n tyypitykset sekä web-build läpäisivät;
buildin nykyinen kokovaroitus ei ole poistunut. Tarkastimen 11 vanhan
formaatin regressiota läpäisivät. Riippumaton H4-katselmus löysi summaryn
puuttuvan latauspalautteen: oma palaute lisättiin ja yllä mainittu
viivästettyjen lukujen näyttö todensi korjauksen. Koko H:n loppukatselmus,
paketti- ja PR/main-portit ovat edelleen avoimia.

#### H-P2: Hyväksytty writer-häiriön palaute

Omistajan hyväksymä suunta on ei-estävä, deduplikoitu turvallinen häiriöilmoitus desktopin
nykyisessä main/UI-vastuussa sekä nykyinen minimoitu incident-yritys.
Saman levyn incident-kirjoitus voi epäonnistua yhdessä detailed-writerin
kanssa. Siksi pelkkä incident-tiedosto ei riitä näkyvyyden takeeksi, eikä
puuttuvista riveistä saa päätellä writerin toimivan. Ilmoituksen tarkka
näyttötapa, välitysketju, enimmäistiheys ja runtime-kohtaisen tilan elinkaari
päätetään ennen kytkentää; uutta yleistä tilapalvelua ei hyväksytä tällä
suunnitelmalla. Myös varailmoituksen oma virhe käsitellään ilman rekursiota,
odotussilmukkaa tai varmaa toimitusväitettä. Backendin nykyinen fallback
säilyy, eikä permission-rajaa ohiteta mainin ilmoituksen vuoksi.

Omistaja hyväksyi sovelluksen ei-estävän ilmoituspalkin, joka näkyy myös
Diagnostiikan ulkopuolella. Se säilyttää vain tiedon tässä käynnistyksessä
havaitusta lokitushäiriöstä, ei raakaa syytä, polkua tai yritystietoa.
Ei käyttöjärjestelmäilmoitusta, modaalista ikkunaa tai business-estoa.

H5:n rajattu kytkentäsopimus nykyisissä omistajissa:

- Nykyisen detailed-writerin failure-sink deduplikoi kaksi turvallista
  syykoodia ja kolme desktop-virtaa, enintään kuusi yhdistelmää prosessissa.
  Sama virhe ei käynnistä uutta kirjoitus- tai ilmoitusyritystä. Vain nykyinen
  minimoitu incident-kirjoitus on fallback-yritys, ei lupaus saman levyn
  toimivuudesta; sitä ei ohjata detailed-writerin kautta.
- Main säilyttää monotonisen `failureObserved`-booleanin muistissa tämän
  käynnistyksen ajan. Se ei ole writerin terveystodistus, kuittaus tai
  business-audit. Incident- tai ilmoitusadapterin virhe ei muuta tätä
  havaintoa tai alkuperäistä business-tulosta eikä toista operaatiota.
- Nykyiseen desktop-siltaan lisätään nolla-argumenttinen
  `getOperationalLogFailureStatus()` ja rajattu
  `onOperationalLogFailure(callback)`-tilaus. Snapshotin ainoa kenttä on
  boolean `failureObserved`; muutosilmoitus ei sisällä syytä tai muita
  arvoja. Main hyväksyy vain nykyisen pääikkunan pääframen, ja dispose
  poistaa handlerin sekä mainin tilauksen nykyisessä sulkuryhmässä.
- Preload ei paljasta Electron-tapahtumaoliota tai yleistä kanavanvalintaa.
  App-kerros validoi snapshotin täsmällisesti. UI tilaa ensin, lukee sitten
  alkutilan ja säilyttää jo havaitun true-tilan myös myöhäisen false-vastauksen
  yli. Tilaus poistetaan unmountissa; uusia ajastimia tai kyselysilmukoita
  ei lisätä. Selain ilman capabilityä säilyy ennallaan.
- Ilmoitusteksti kertoo vain, että lokituksessa havaittiin häiriö ja osa
  teknisistä tapahtumista voi puuttua. Se ei tarjoa automaattista uusintaa,
  väitä lokituksen korjaantuneen tai ohita Diagnosticsin permission-rajaa.
  Ilmoituksen oma epäonnistuminen käsitellään ilman rekursiivista lokitusta;
  näkyvyyttä ei väitetä varmaksi, jos sekä toimitus että alkuluku epäonnistuvat.

Regressiot todentavat writerin I/O:n, kapasiteetin, deduplikoinnin,
incident- ja ilmoitusvirheen, väärän senderin/framen/argumentit, alkutilan,
tilaus-/vastauskilpailun sekä nykyisen main/preload/UI-ketjun. Uutta
yleistä loggeria, tilapalvelua tai ilmoituskehystä ei rakenneta.

H5:n rajattu katselmus ei löytänyt korjattavaa. Writerin, incidentin,
capabilityn, preloadin ja viereisten rajojen 62 kohdetestiä sekä mainin
nykyisen käynnistys-/palautustiedoston 158 testiä läpäisivät. Webin
silta-/ilmoitus-/diagnostiikkakohdesarja läpäisi 69 testiä; ilmoituksen
kopiotesti ei yksin todista React-elinkaarta. Kaksi oikean Appin selainkoetta
todentavat tilaus-/alkulukukilpailun ja tilausvirheen turvallisen käsittelyn.
Määrät ovat osittain päällekkäisiä, eivät yksi kokonaisajon tulos.

Nimetty Windowsin development-Electron-ajo läpäisi viisi testiä yhdellä
suoritusyrityksellä. Mukana ovat nykyisen runtimen ja preload-rajan kontrollit
sekä kaksi todellista lokikirjoituksen main/preload/UI-virheketjua. Ilmoitus
säilyy näkymänvaihdossa, asiakkaan luonti onnistuu ja uuden main-prosessin
alkutila on false myös incident-yrityksen epäonnistumisen jälkeen. Tämä ei
vielä ole paketoidun sovelluksen palautus- tai PR/main-hyväksyntä.

Nykyisen salaus/purku-kokeen kolme tapausta läpäisivät: H5:n oikea
tiedostovirhe säilyy rajattuine alkuperäisine viesteineen ja writerin
kutsupinoineen puretussa salatussa paketissa. Olematonta syyketjua ei
keksitä, eikä julkinen tuloste sisällä alkuperäistä poikkeusta. Ensimmäiset
testivalmistelun hylkäykset säilytetään erillään onnistuneesta todennuksesta.
Normaalin tuotantomainin havaitsijaa ei kytketä tämän testin perusteella.

H5:n koko web-sarja läpäisi 996 testiä. Desktopin normaali skripti läpäisi
4 468 Vitest- ja 412 Node-testiä; viisi ja 12 nykyistä ohitusta eivät ole
läpäisyjä. Koko backendin sarja läpäisi 4 070 testiä ja viisi nykyistä
ohitusta. Viimeinen koko työtilan tyypitys läpäisi. HTTP-virhehavaitsijan
nykyiset onnistumis-, odotettu hylkäys- ja havaitsijavirheen kontrollit
läpäisivät muutetulla testiapurilla.
H5:n todellinen writer -> minimoitu incident -> HTTP -> strict support-
vastaanotin -> gzip -> nykyinen tarkastin -koe läpäisi. Sama häiriö ei
monistanut incidentiä, eikä incidentistä keksitty detailed-tapahtumaa.
Nämä ovat paikallisia revision työpuuhun sidottuja näyttöjä, eivät H:n
lopullinen PR/main-hyväksyntä.

Loppukatselmus löysi yhden testiaukon: selainkoe ei lukinnut tilauksen ja
alkuluvun todellista kutsujärjestystä. Testisilta tallentaa nyt nämä kaksi
kutsua ja koe vaatii tilauksen ensin; molemmat selainkokeet läpäisivät
uudella tarkistuksella. Rajattu uudelleenkatselmus ei löytänyt avoimia
korjattavia havaintoja. Riippuvuusauditointi läpäisi; riippuvuuksia ei muutettu.

Ensimmäinen puhdas H5-paketti hylättiin palautussmoken preload-
pintatarkistuksessa: nykyinen `hasRendererBridgeForSmoke` odotti edelleen
23 metodia, vaikka hyväksytty H5-pinta sisältää 25. Uusi regressio suorittaa
oikean tarkistuslausekkeen todellista transpiloitua preload-pintaa vasten ja
toisti puutteen ennen korjausta. Guard vaatii nyt molemmat H5-metodit ja
täsmälleen 25 avainta; jokaisen metodin puuttuminen, väärä tyyppi ja vieras
lisämetodi hylätään. Rajattu kolmen tiedoston sarja läpäisi 64 testiä eikä
uudelleenkatselmukseen jäänyt havaintoja. Ensihylkäyksen paketti ja aineisto
säilyvät; korjattu revisio tarvitsee uuden puhtaan paketti-/palautustodisteen.

Korjattu puhdas revisio `1b9423e4a0da2a469ef8b4819d34bb23c30101d0`
läpäisi Windows-paketoinnin, nykyisen runtime-/fuse-/sisältöinventaarion ja
hardened backup -> inspect -> restore -> restart -> compare -smoken.
Sama ajo tarkisti nykyisen paketoidun Diagnostiikka-käyttöliittymän ja
tukipaketin. Paketin koko inventaario ja ASAR-sisältö varmennettiin samoiksi
ennen ajoa ja sen jälkeen. Testien välissä ei tehty uutta buildiä.
Ensimmäinen hylätty paketti ja sen aineisto säilyvät erillisinä.
Tätä lähdettä seuraava checkpoint-muutos on vain dokumentaatiota; normaalit
PR-portit vaaditaan silti täsmälliselle PR-headille ja mergen jälkeiselle
mainille. H ei ole vielä integraatiohyväksytty.

#### H:n PR-integraation rajattu jatko

[PR #315:n ensimmäinen V2-kierros](https://github.com/eky-software/eky/actions/runs/39916113813)
hylkäsi kolme HTTP-/diagnostiikka-/desktop-writerin salauskoetta tunnuksella
`F_ORIGINAL_CAPTURE_MISSING`. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39916113723)
läpäisi. V2:n hylätyn valmistelun vuoksi suorittamatta jääneet jatkot eivät
ole läpäisyjä. Alkuperäinen loki ja salattu paketti säilytettiin; purun,
run/attempt/job-sidonnan, todellisen checkout-puun ja tiedostotiivisteiden
tarkistus läpäisi. Paketti sisältää parent-testien väitteet, ei sisemmän
koeprosessin alkuperäistä import-virhettä.

Lähdeanalyysi osoitti fixturen uuden `listDiagnosticEvents`-tuonnin hakevan
`@eky/permissions`-paketin build-exporttia, jota tämä itsenäinen CI-askel ei
valmista. Hallittu paikallinen koe toisti puuttuvan kaappauksen ja yksilöi
permission-tuonnin: käännettyjen työtilapakettien estäminen pysäytti testin
ennen sen runkoa. Fixturen täsmällinen lähdealias poistaa build-riippuvuuden;
sama estoregressio, tavalliset kontrollit ja kaikki kolme OpenPGP-ketjua
läpäisivät neljän parent-testin sarjana. Tämä paikallinen syynäyttö erotetaan
alkuperäisessä CI-paketissa säilyneestä tiedosta.

Korjaus koskee vain nykyistä testifixtureä ja sen regressiota, ei sovellusta,
CI-askelten sisältöä, salauksen rajoja tai hyväksyntäehtoja. Korjattu head
tarvitsee normaalit PR-portit. Hyväksyttyä puhdasta pakettia ei korvata
toisilla tavuilla pelkän testiapurikorjauksen vuoksi.

#### H:n säilyvät rajat ja valmistumisportti

Diagnostics säilyy read-only-projektiona. Kiinteä lokijuuri, backendin
`viewDiagnostics`-/`createSupportBundle`-oikeudet, uudelleenvalidointi,
G:n perhekohtaiset kentät ja poissulut, incidentin minimointi sekä
tukipaketin 30 päivän raja säilyvät. Ei uusia riippuvuuksia, yleistä
loggeria/manageria, telemetriaa, raakavirheitä tuotannon lokiin,
business-/DB-migraatiota tai salattujen CI-pakettien sisältörajan muutosta.
Lokihuolto ei käsittele yritysprofiileja, backupeja tai business-artifacteja.

Todennus etenee pienistä deterministisistä kohdetesteistä oikeaan
backend-/main-koostamiseen ja HTTP-/client-/UI-ketjuun. H3:n tuotetusta
gzip-tukipaketista tarkistetaan aidot uusimmat rivit, ryhmien laskurit,
budjetit, manifestin katkaisut ja checksumit. H4/H5:n tyhjä/partial/unavailable-
ja fallback-failure-tapaukset todistetaan myös tarkoitetussa
käyttöliittymässä, ei vain testiin injektoidulla no-op-loggerilla.
Hylätty testi tarjoaa alkuperäisen virheen nykyiseen salattuun
keräykseen ennen yleistä koodimuunnosta; tämä varmennetaan nykyisellä
salaus/purku-kokeella, ei uudella keräysjärjestelmällä.

Lopuksi vaikutusalueen normaalit sarjat, tyypitys/build, riippumaton rajattu
katselmus ja julkaisuyksityisyys. Desktop-startup-/lifecycle-rajaan
koskettaessa vaaditaan sama puhdas hardened Windows
backup -> inspect -> restore -> restart -> compare -paketti; installer on
erillinen portti. Jäädytetty PR-head ja mergen jälkeinen main tarvitsevat
omat nykyiset hyväksyntäporttinsa ja auditoinnin. Paikallinen koe ei sulje
H:ta. H:n integraatio odottaa näitä portteja; hyväksyttyä H-P2:n
ilmoituskytkentää ei tulkita koko H:n hyväksynnäksi.

R030-08:n historian selaus, D029-06:n erikseen päätettävä päivitystoiminto,
W7, I, M5:n syväkatselmus/Deep Scan sekä pilvi/mobiili jäävät erilleen.
H:n tilasopimus valmistelee myöhempää selausta mutta ei toteuta sitä.

## G:n integraatiota edeltävä jatkamiskohta 23.10.2026

Seuraava jatkamiskohta ja G:n toteutuscheckpoint siirrettiin M1:stä H:n
suunnittelun alkaessa. Teksti säilyi linkin kohteen sovitusta lukuun
ottamatta; se kuvaa G:n hyväksyntää edeltävää tilannetta, ei uutta työjonoa.
PR #314:n [loppuhyväksyntä](https://github.com/eky-software/eky/pull/314#issuecomment-6356610094)
erottaa lopulliset PR/main-portit alkuperäisistä hylkäyksistä. Nykyinen
lähtö ja seuraava työ ovat M1:n alussa.

### Aiempi jatkamiskohta

**Hyväksytty lähtö (22.10.2026):** F/R15 on hyväksytty PR #313:n kautta
mainiin `96b62944087bec64970e6233e57a730ab31ec1ea`.
[F:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/313#issuecomment-6339105977)
erottaa korjatun PR-headin, yhden hyväksytyn valmistelun kohdeuusinnan ja
uuden mainin omat portit. Mainin puu vastaa hyväksyttyä PR-headia
`04f7a0f6d5ed56cca9cc95ba6e7f788c723f6d26`.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #313 | [V2, suoritusyritys 2](https://github.com/eky-software/eky/actions/runs/39739184364/attempts/2): 38 onnistunutta työtä ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39739184332) läpäisi. |
| Mainin omat portit | [V2](https://github.com/eky-software/eky/actions/runs/39761715390): 38 onnistunutta työtä ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39761715368) läpäisi. Molemmat ensimmäisellä suoritusyrityksellä. |

**Nykyinen työ:** G/R20/R23:n rajattu toteutus
[alla olevan sopimuksen mukaan](release-0.3.0-m1-preparation-plan.md#g--diagnostiikan-tapahtumaketjun-suunnitelma).
Omistaja hyväksyi G-P1/G-P2:n rajauksen, toteutuksen ja testit 22.10.2026.
G1-G3:n paikalliset projektiot ja kohdetestit ovat työpuussa. G4:n
writer -> HTTP -> strict-client -> tuotettu tukipaketti -system-testi
läpäisi. Packaged-smoken G-fixture, UI:n onnistumistilan tarkistus ja
kaikkien G-rivien semanttinen tarkistus ovat toteutettuina; niiden
kohderegressiot ja tyypitys läpäisivät. Alkuperäisen synteettisen
smoke-virheen säilyminen nykyisessä salaus/purku-ketjussa on todennettu.
Normaali desktop-sarja ja vaikutusalueen neljän paketin tyypitys läpäisivät.
Puhtaan revision `ab53bf706db75351eb21cdc22a74487cfc94fd50` Windows-paketin
käyttöliittymä-, tukipaketti- ja backup -> inspect -> restore -> restart ->
compare -todennus läpäisi. Rajattu riippumaton loppukatselmus ei löytänyt
korjattavaa ja riippuvuusauditointi läpäisi. Seuraava portti on jäädytetyn
PR-headin normaalit tarkistukset ja niiden jälkeen uuden mainin omat portit.
Tämä paikallinen näyttö ei vielä ole G:n integraatiohyväksyntä.
Sitä edeltävä rajattu palautustestin aikabudjettimuutos on hyväksytty
ja paikallisesti todennettu alla kuvatulla rajauksella.
Backendin ja API-clientin laajat sarjat läpäisivät. Desktopin
muuttumattomassa `desktopRestoreStartup.test.ts`:ssä yksi aikakatkaisu
johti seuraavien tapausten `PREVIOUS_WORK_UNSETTLED`-suojaestoihin.
Yksi sallittu kohdeuusinta aikakatkaisi saman palautusketjun toisen
tapauksen. Ensivirheet, osittaiseksi rajautunut raportointi ja epävarma
siivoustila säilytetään; niitä ei merkitä korjatuiksi tai läpäisyiksi.
Juurisyytä tai yhteyttä G-muutokseen ei ole vielä todistettu.
Omistajan hyväksymä kolmen tapauksen rajattu aikarajakoe läpäisi.
Sen jälkeen omistaja hyväksyi pysyvän, vain näihin kolmeen testiin
rajatun kymmenen sekunnin testirajan sekä yhden normaalin desktop-sarjan.
Ennen migraatiota tehtävän tapauksen erillinen valmisteluraja säilyy
viidessä sekunnissa. Tarkka rajaus on
[testausohjeessa](../ai/testing-rules.md#palautustestin-erillinen-valmistelu).
Muutos on paikallisessa työpuussa. Yksi normaali desktop-sarja läpäisi
molemmat osansa: Vitest 282 tiedostoa ja 4 378 testiä, Node-testit 412 testiä.
Erikseen ohitetut 5 ja 12 tapausta eivät ole läpäisyjä.
Sarjan jälkeen tyypitys osoitti parametrisoidun testin aikarajakutsussa
tyyppivirheen. Kutsu korjattiin nykyisen rajapinnan asetusobjektimuotoon;
lopullisen muodon desktop-tyypitys ja kaikki kolme kohdetapausta läpäisivät.
G4:n toteutuksen jälkeen normaali desktop-sarja läpäisi myös tällä
kutsumuodolla: 283 tiedostoa ja 4 402 Vitest-testiä sekä 412 Node-testiä;
erikseen ohitetut 5 ja 12 tapausta eivät ole läpäisyjä.
Tämä näyttö ei korvaa aiempia hylkäyksiä eikä todista vanhan viiveen syytä
korjatuksi. Sovelluskoodi ja CI:n kokonaisrajat eivät muuttuneet tässä korjauksessa.
G:lle ei vielä ole toteutus- tai
PR/main-hyväksyntää. T/A/B/C/K/D/E/F säilyvät hyväksyttyinä;
H/I:n loppuosa ja M4/M5 odottavat.

**Avoimet havainnot:** PR #312:n ensimmäisen MSI-ikkunan luetteloluennan
viiveen syy ja sitä edeltävän mainin supervisor-havainnon puute jäävät
avoimiksi. Alkuperäinen virheaineisto säilytetään; hyväksytty uusinta tai
Vitest-päivitys ei todista niiden korjausta. Myös aikaisemmat MSI-odotukset,
sulkuviiveet, puuttuvat aineistot ja tuntemattomat siivoustilat säilyvät
historiallisissa rajauksissaan. PR #313:n ensimmäisen valmisteluhylkäyksen
alkuperäinen npm-alisyy jää myös tuntemattomaksi; onnistunut kohdeuusinta
ei todista sen korjausta. E:n hälytystilan loppulukeminen on päivätty
historiatieto, ei G-revision auditointitodiste. Edeltävä jatkamiskohta on
[integraatiohistoriassa](release-0.3.0-integration-history.md#fn-valmistelua-edeltävä-jatkamiskohta-22102026).

### Aiempi G-toteutuscheckpoint

**Toteutuscheckpoint (22.10.2026):** G1:n archive-projektio on paikallisessa
työpuussa. Backendin, strict-clientin ja mainin kohderegressiot sekä kolmen
paketin tyyppitarkistus läpäisivät. Oikea laskutoimitus -> queue-failure-
writer -> tiedostolukija -> Diagnostics-/tukipaketti-HTTP todennettiin myös
loggerin virheessä; toimitustulos säilyi. Rajattu riippumaton G1-katselmus
ei löytänyt korjattavaa. Myös G2:n update-projektio, kenttämatriisit,
tyypitys ja rajattu katselmus läpäisivät paikallisesti. G3:n haaravalinta,
kolmen vastaanottorajan kenttämatriisit, management-/K-regressiot ja tyypitys
läpäisivät; myös rajattu G3-katselmus päättyi ilman korjattavaa. Oikean replacement-coordinatorin
lineage-hylkäys tuottaa yhden tapahtuman lokitiedostoon ennen leasea,
sulkua tai profiilimuutosta. G4:n system-lukuketju, tuotetun artifactin
tiukka semantiikka ja alkuperäisen synteettisen smoke-virheen salaus/purku
läpäisivät kohdetodennuksen 23.10.2026. Rajattu katselmus havaitsi yhden
info-poissulun testidatan puutteen; muuten kelvollinen info-rivi korvasi sen
ja regressio läpäisi. Myös paketoidun käyttöliittymän ja palautuksen
todennus sekä rajattu loppukatselmus läpäisivät yllä nimetyllä revisiolla.
Nämä eivät vielä ole G:n PR/main-hyväksyntä.
Edeltävien palautustestien aikakatkaisujen syyt ja epävarma siivoustila
säilyvät avoimina; hyväksytyn rajatun testibudjetin näyttö on yllä.

## F:n valmistelua edeltävä jatkamiskohta 22.10.2026

Seuraava E:n hyväksyntään perustuva F-valmistelun checkpoint siirrettiin
M1:stä G-valmistelun alkaessa. Se kuvaa F:n loppuhyväksyntää edeltävää
tilannetta, ei avaa F:ää uudelleen. Nykyinen hyväksytty lähtö ja G:n päätökset
ovat M1:n alussa; alla säilyvät myös alkuperäiset avoimet havainnot.

**Hyväksytty lähtö (22.10.2026):** E:n R09-R11 ja rajattu Vitest-
tietoturvahuolto on hyväksytty PR #311:n ja PR #312:n kautta mainiin
`d0d08bd182500c463fa06300978f06c295f3cac2`.
[E:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/312#issuecomment-6329634460)
erottaa PR:n ensimmäisen hylkäyksen, yhden hyväksytyn kohdeuusinnan sekä
uuden mainin omat hyväksytyt portit. Mainin puu vastaa katselmoitua
PR-headia `613a00c73f133e321beb7546126aebff74c5661a`.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #312 | [V2](https://github.com/eky-software/eky/actions/runs/39685614769): 38 onnistunutta työtä ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä yhden rajatun legacy-core-uusinnan jälkeen. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39685614678) läpäisi. |
| Mainin omat portit | [V2](https://github.com/eky-software/eky/actions/runs/39693887305): 38 onnistunutta työtä ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39693887157) läpäisi. Molemmat ensimmäisellä suoritusyrityksellä. |
| Erillinen hälytystilan loppulukeminen | Dependabotissa ei ollut avoimia hälytyksiä 22.10.2026. Tämä on päivätty havainto, ei tulevien revisioiden auditointitodiste. |

**Nykyinen työ:** F/R15:n rajattu toteutus ja testit hyväksytyn sopimuksen
[mukaan](release-0.3.0-m1-preparation-plan.md#f--frameworkin-virheketjun-rajattu-suunnitelma). Omistaja hyväksyi
rajauksen 22.10.2026. [F:n integraatio on PR #313:ssa](https://github.com/eky-software/eky/pull/313).
Seuraa sen viimeisimmän revision portteja ja loppuhyväksyntää ennen seuraavaa
työpakettia; vanha toteutuscheckpoint ei ole uusi F-työjono.
F:n toteutus ja paikallinen todennus ovat valmiit. Integraation lopullinen
tila tarkistetaan PR #313:n loppuhyväksynnästä: ilman hyväksyttyjä PR/main-
portteja F on kesken; niiden jälkeen seuraava työ valitaan roadmapista.
T/A/B/C/K/D/E säilyvät hyväksyttyinä; G/H/I:n loppuosa ja M4/M5 odottavat.

**Avoimet havainnot:** PR #312:n ensimmäisen MSI-ikkunan luetteloluennan
viiveen syy ja sitä edeltävän mainin supervisor-havainnon puute jäävät
avoimiksi. Alkuperäinen virheaineisto säilytetään; hyväksytty uusinta tai
Vitest-päivitys ei todista niiden korjausta. Myös aikaisemmat MSI-odotukset,
sulkuviiveet, puuttuvat aineistot ja tuntemattomat siivoustilat säilyvät
historiallisissa rajauksissaan. Vanha Dependabot-tilanne erotetaan yllä
olevasta uudemmasta loppulukemisesta.

## Ohjehuollon hyväksyntä 16.10.2026

Seuraava hyväksyntänäyttö oli M1:n jatkamiskohdassa ennen PR #307:n
dokumentointikorjauksen hyväksyntää. Nykyinen lähtö luetaan M1:stä;
PR #306:n poikkeuspäätökset ja avoimet havainnot eivät muutu tässä siirrossa.

**Hyväksytty lähtö (16.10.2026):** ohjehuollon PR #306 on yhdistetty
`main`-revisioon `b289a4344d10cd67127e3ccebcd421cebdbec5d2`.
Hyväksytty PR-head on `e2f09d7b17494715c406a9ea0cf2cd02a9e06828`;
mainin puu vastaa sitä ja testattua merge-checkoutia.
[PR #306:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/306#issuecomment-6221858043)
kirjaa näiden revisioiden hyväksyntänäytön ja rajatun etenemispäätöksen:

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR:n V2 | [`38928755552`](https://github.com/eky-software/eky/actions/runs/38928755552), toinen suoritusyritys: 38 onnistunutta työtä ja 6 tarkoituksella valitsematonta diagnostiikkatyötä. |
| PR:n riippuvuustarkistus | [`38928755417`](https://github.com/eky-software/eky/actions/runs/38928755417) läpäisi. |
| Mainin V2 | [`38939885647`](https://github.com/eky-software/eky/actions/runs/38939885647), ensimmäinen suoritusyritys: 38 onnistunutta työtä ja samat 6 valitsematonta diagnostiikkatyötä. |
| Mainin riippuvuustarkistus | [`38939885593`](https://github.com/eky-software/eky/actions/runs/38939885593) läpäisi täsmälliselle main-revisiolle. |

## Ohjehuollon integraatiokierrokset 16.10.2026

Seuraava integraatiota edeltävä tilanne siirrettiin muuttamattomana
M1:n jatkamiskohdasta, jonka lähderevisio on
`b289a4344d10cd67127e3ccebcd421cebdbec5d2`. Siirto säilyttää
ensivirheet, avoimet syyt ja silloiset rajaukset. Alla olevat tulevaa
todennusta tai korjausta koskevat lauseet eivät avaa jo hyväksyttyä työtä.

### Integraatiota edeltänyt jatkamiskohta

**Nykyinen integraatiovaihe:** I-paketin aikaistettu ohjeverkon ylläpito ennen D:tä.
Inventaario, sääntöjen siirtokartta, omistavien ohjeiden päivitys ja historian
erottaminen ovat tämän revision dokumentointityötä. Sen hyväksyntä vaatii
suunnistuskokeet, riippumattoman katselmuksen ja omat PR/main-portit.
Varmenna ohjemuutoksen PR:n loppuyhteenveto ja täsmällisen main-revision ajot:
jos ne on jo hyväksytty, seuraava työ on alla kuvattu D:n valmistelu, ei
ohjehuollon uusiminen. Muuten viimeistele tämä integraatiovaihe. Tämä teksti
ei itsessään väitä portteja läpäistyiksi, avaa D:n toteutusta, muuta
CI-politiikkaa tai hyväksy koko I:tä.

**Viimeisin integraatiotilanne (16.10.2026):** PR #306:n aiempi head
`ca129026` hylättiin V2-ajossa `38826570804`; riippuvuustarkistus läpäisi.
Ensivirheet ja salattu aineisto säilyvät. MSI-odotusten estäjien identiteetti
ja Electron-relaunchin alkuperäinen syy jäivät avoimiksi. Niitä ei nimetä
korjatuiksi myöhempien läpäisyjen perusteella.

E2E-entrypoint käyttää nyt [yhteistä sulkusuojaa](e2e-test-environment.md#prosessien-elinkaari)
myös toisen quit-pyynnön aikana. Kytkentäregressio, kohdesarja 12/12,
tyyppitarkistus ja kolme todellista Electron-käyttäjäpolkua läpäisivät.
MSI:n nykyinen valinnainen kysely säilyttää sulkemispyynnön tiedostokäyttäjän
PID-/aloitusaikasidonnan ja Job-jäsenyyden nykyisessä salatussa paketissa.
Inventaarion ja runtimen sarjat 205/205, keräin 59/59 ja native-sopimukset
168/168 läpäisivät; alkuperäisen havainnon todellinen salaus/purku varmennettiin.

Nimetty [Windows-koe `38926951547`](https://github.com/eky-software/eky/actions/runs/38926951547)
läpäisi revisiolla `c613eb50` samoilla aiemmilla asennuspaketeilla.
Komento, pakollinen tulosverifier, siivous ja alkuperäisten pakettitavujen
jälkivarmennus läpäisivät. Asennusodotus ei toistunut. Tämän jälkeen
havaittu uuden valintatiedoston hakemistovälitys korjataan erikseen:
valinta kulkee workerin oman hakemiston sijasta sitä omistavan supervisorin
vaihehakemistoon. Molempien callerien kytkentä, Node-julkaisun todellinen
native-luku sekä keräys ja salaus/purku kuuluvat regressioihin.
Tämä korjaus tarvitsee nykyisen PR-revision omat normaalit portit; edellinen
nimetty ajo ei ole sen CI-todistus. Rajatut riippumattomat katselmukset
eivät löytäneet estettä. Seuraava työ on nykyisen PR:n integraatiotodennus,
sitten uuden mainin omat portit. Alla olevat kierrokset ovat aiempaa näyttöä.

**Ennen ohjehuoltoa hyväksytty lähtö:** `main`-revisio
`c717406484df0471df23165a7c13db9b3f74c1b6`, K:n
[PR #305:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/305#issuecomment-6181885500).
PR:n V2 `38652135291` ja riippuvuustarkistus `38652135087` sekä mainin omat
V2 `38655740443` ja riippuvuustarkistus `38655740472` läpäisivät.
T/A/B/C/K säilyvät hyväksyttyinä omissa rajauksissaan; niitä ei toteuteta
uudelleen vanhan keskeneräisyysmerkinnän vuoksi. Lähdekoodin hyväksyntä ei
ole uuden käyttäjäjulkaisun tai myöhemmän buildin hyväksyntä.

**Erillinen uusi havainto:** saman main-revision ajastettu V2
`38699658860` epäonnistui salatun virheaineiston oman sopimustestin kohdassa:
odotettu `recorded`, havaittu `timedOut`. Riippuvuustarkistus `38700163858`
läpäisi. Ensivirheen salattu aineisto säilyy. Syy ei ole varmistunut, eikä
tässä ohjehuollossa ole tehty korjausta tai uusintaa. Aiempi K-hyväksyntä
ja uusi hylkäys ovat eri havaintoja; nykytilaa ei kuvata yksiselitteisesti
vihreäksi. Uuden revision omia hyväksyntäportteja ei ohiteta.

**Ohjehuollon integraation rajattu korjaus:** PR #306:n ensimmäinen V2
`38795201629` hylättiin; riippuvuustarkistus `38795201470` läpäisi.
Hyväksytty jatko kattaa vain SQLite-testin täsmällisen tavuvertailun
ylimääräisen työn poistamisen, MSI-havaintotestin ensimmäisen näytteen
valmistelueristyksen ja Windows Electron -työn kokonaisrajan muutoksen
25 minuutista 35 minuuttiin. Kohdetestit, tyyppitarkistus, CI-sopimustestit
ja rajattu riippumaton katselmus läpäisivät; yksi normaali PR/CI-kierros
on sittemmin ajettu revision `8689abc4` lähteestä. V2 `38804005214`
hylättiin MSI-havaintotestin osittaisen tuloksen ja erillisen legacy-työn
10 minuutin kokonaisrajan vuoksi; riippuvuustarkistus `38804005089` läpäisi.
Electronin 3 paketoitua ja 47 development-testiä läpäisivät. MSI-työn yksi
kohdennettu uusinta läpäisi 159/159 testiä samalla lähteellä; alkuperäinen
osittainen havainto säilyy avoimena eikä uusinta yksin ole merge-hyväksyntä.
Legacy-valmistelun loki osoitti skriptiä edeltävän pnpm-riippuvuusasennuksen
ja verkkouusinnat. Sen rajattu korjaus poistaa automaattiasennuksen vain
riippuvuuksia tarvitsemattomasta clean/upgrade-sopimusryhmästä
[harnessin omistavan valmistelusopimuksen](windows-installer-acceptance-harness-v2.md#cleanupgrade-sopimustestien-valmistelu)
mukaan. Revision `0530fd0f` kohdetodennus ja katselmus läpäisivät;
V2-ajossa `38813654917` clean/upgrade-ryhmän molemmat 54 testin toistot
läpäisivät. Riippuvuustarkistus `38813654836` läpäisi. MSI-luettelon
osittainen havainto kuitenkin toistui supervisor- ja legacy-core-töissä.
Erillinen upgrade-paketin valmistelu epäonnistui `source/backendValidation`-
vaiheessa; salatussa paketissa ei ollut alkuperäistä syytä. Nämä estävät
integraation eivätkä kumoa läpäisseitä yksittäisiä tarkistuksia.
MSI-testin yksityinen virhekuitti säilyttää nyt myös luettelokutsun vaiheen
ja mahdollisen alkuperäisen virhekoodin. Revision `ef8fd904` rajattu hosted-
ajo `38817393696` läpäisi molemmat 159 testin sopimussarjat, myös todellisen
salaus- ja purkuketjun. Alkuperäinen katkos ei toistunut: tämä todentaa
virhekuittimuutoksen, ei vanhan luettelokatkoksen juurisyytä tai koko PR:ää.
V2 `38813654917` valmistui hylättynä; upgrade-valmistelun erillinen syy
ja normaalit uuden PR/main-revision portit ovat seuraavat integraatioesteet.
Käännöstyökalun todellinen `ETIMEDOUT` säilytetään nyt paketin nykyisessä
turvallisessa syykoodissa; rajatut regressiot todentavat myös oikean
aikakatkaisun ja keskeneräisen lokin lukueston. Tämä ei jälkikäteen nimeä
aiemman käännöksen syytä. Revision `22636451` normaalissa V2-ajossa
`38819009832` MSI-testin kylmä näyte hylättiin nyt täsmällisesti luokkaan
`listProcessId/budgetExpired`. Omistajan hyväksymä testin valmistelumuutos
säilyttää kylmän näytteen ja sallii vain tämän tarkasti rajatun osittaisen
valmistelutuloksen; sen jälkeen vaaditaan yksi täydellinen luetteloluku.
Muut virheet hylätään edelleen. [Tarkka sopimus ja virhetodisteet](ci-encrypted-evidence.md#asentimen-rajattu-ikkunahavainto)
erottavat tämän valmistellun providerin kokeen tuotannon valinnaisesta
havainnosta. Jatko on kohdetodennus, katselmus ja uuden jäädytetyn revision
normaalit PR/main-portit. Legacy-työn aikarajaa ei nosteta.
Sovelluskoodi ja yksittäiset testirajat säilyvät. Valmistelun hyväksyntärajan
muutos ei ole yleinen lupa hyväksyä osittaista havaintoa. Alkuperäiset
epäonnistumiset säilyvät eikä kohdeläpäisy todista niiden kaikkia syitä.

Revision `9d1d3ddb` normaalissa V2-ajossa `38822790613` MSI-ikkunatestit
läpäisivät. Legacy-core1:n erillinen `blockedEvidence`-testi aikakatkaisi
Node-ohjaimessa, vaikka sidottu native-tulos osoitti deadlinen ja
prosessipuun siivouksen valmistuneen. Nykyinen rajattu testikorjaus käyttää
[terminal-ensin-järjestystä](windows-installer-acceptance-harness-v2.md#valmistuneen-komennon-lokitulostetesti)
ja merkkien kertalukua. Pakollinen puuttuva näyttö pysyy hylkäyksenä;
alkuperäinen ajo ja sen avoin ajoitussyy säilyvät. Integraatio vaatii yhä
uuden täsmällisen revision omat PR/main-portit.

### Lopullinen hyväksyntä ja säilynyt ensivirhe

[PR #306:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/306#issuecomment-6221858043)
hyväksyi headin `e2f09d7b17494715c406a9ea0cf2cd02a9e06828` ja mainin
`b289a4344d10cd67127e3ccebcd421cebdbec5d2`. PR:n V2
[`38928755552`](https://github.com/eky-software/eky/actions/runs/38928755552)
läpäisi toisella suoritusyrityksellä ja riippuvuustarkistus
[`38928755417`](https://github.com/eky-software/eky/actions/runs/38928755417)
läpäisi. Mainin omat V2
[`38939885647`](https://github.com/eky-software/eky/actions/runs/38939885647)
ja riippuvuustarkistus
[`38939885593`](https://github.com/eky-software/eky/actions/runs/38939885593)
läpäisivät. Hyväksyntä kattaa rajatun ohjehuollon ja sen hyväksytyt
integraatiokorjaukset ennen D:n valmistelua, ei koko I:tä tai julkaisua.

PR:n ensimmäisen V2-yrityksen yksi legacy-toisto peruttiin 37 minuutin
työrajalla; sen oma loki ja salattu virheaineisto eivät valmistuneet.
Alkuperäinen syy ja siivoustila jäävät tuntemattomiksi. Erikseen hyväksytty
yksi rajattu uusinta käytti muuttumatonta lähdettä ja samoja pakettitavuja,
läpäisi caller/worker-, prosessipuun poistumis- ja artifactien
jälkivarmennukset eikä rakentanut paketteja uudelleen tai uusinut muita
läpäisseitä töitä. Alkuperäinen peruutus ei muutu onnistumiseksi tai
korjatuksi viaksi; tämä etenemispäätös ei anna lupaa uusiin uusintoihin.

<a id="m1-unit-preparation-1-75"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:1-75` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l1"></a>

# 0.3.0 M1 -valmistelu

<a id="m1-source-preparation-l3"></a>

## Jatka tästä

**Aktiivinen työ 15.10.2026: nykyisen K-integraation loppuunvienti.**
Tämä jatkamiskohta korvaa aiemman pitkän integraatiojatkon työjonona; se ei
aloita uutta Goalia eikä lisää vanhoja tutkimuksia pakollisiksi tehtäviksi.
T/A/B/C ovat hyväksyttyjä. K:n [hyväksytyt sopimukset](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395)
ja [toteutuksen hyväksyntärajat](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5702) säilyvät;
[julkaisusuunnitelma](release-0.3.0-plan.md) omistaa muun 0.3.0:n sisällön.

| Kohde | Varmennettu tila ja avoin asia |
| --- | --- |
| Main | `012fed60`: PR #304 yhdistetty, mutta mainin oma V2 hylättiin tarkistusajurin käännösvalmisteluun. Erillinen auditointi läpäisi; K ei ole hyväksytty. |
| PR #305 | Base `012fed60`, head `0a1d210b`. [Normaalin V2:n](https://github.com/eky-software/eky/actions/runs/38642369313) ensimmäinen yritys ja yksi erikseen hyväksytty web-uusinta hylättiin eri web-testien epävakauteen; muut valitut perheet läpäisivät. [Erillinen auditointi](https://github.com/eky-software/eky/actions/runs/38642369108) läpäisi. Uusi testikorjaus tarvitsee oman katselmuksen ja revision portit. |
| MSI-odotus | Revision `39ef904a` [koe](https://github.com/eky-software/eky/actions/runs/38613163463) osoitti vastausta odottavan sulkemispyynnön. Revision `50d6c31d` [nimetty jatkokoe](https://github.com/eky-software/eky/actions/runs/38630393550) läpäisi samoilla asennuspaketeilla myös pakollisen tulosverifioinnin. Estäjän identiteetti jää avoimeksi; ei juurisyykorjauksen tai normaalin PR-hyväksynnän väitettä. |
| Kääntäjähavainto | Alkuperäinen syy jäi puuttumaan. Rajattu keräyskorjaus ja [nimetty Windows-todennus](https://github.com/eky-software/eky/actions/runs/38591390653) läpäisivät; vanhaa syytä ei ole todistettu eikä yhdistetty MSI-odotukseen. |
| K:n korvatut polut | Revision `04fc68d2` poisto, kohderegressiot, tyypit, katselmus ja saman puhtaan paketin backup -> inspect -> restore -> restart -> compare läpäisivät. Vertailusnapshot käyttää eristettyä tarkistusta, receipt-sidontaa ja omistajan siivousta. Private broker v12 ei tarjoa kolmea korvattua raskasta komentoa. Normaalit PR/main-portit ovat avoinna. |
| Aiemmat kierroksen hylkäykset | Workflow-, keräin- ja Node-tuontikorjaukset läpäisivät revision `0a1d210b` porttinsa; myös natiivin ilmoitusfixturen sarjat läpäisivät. Alkuperäisen natiivihylkäyksen ja vanhan MSI-odotuksen syyt säilyvät avoimina. |
| Web-integraation este | `INV-LIFECYCLE-001`:n ensimmäinen API-katkos ei toistunut uusinnassa; syy on avoin. Uusinnan `INV-REVERSE-CREDIT-001` aikakatkaisi PDF-toiminnon tilanvaihdossa. Hallittu regressio toisti hyvitysapurista puuttuvan metadata-/painikevalmiuden odotuksen. Rajattu testiapurikorjaus, valmius- ja peruutuskontrollit, nykyiset kutsujat, kriittinen web-sarja, tyypit ja katselmus läpäisivät. Sovelluskoodi ja aikarajat säilyvät. Uusi revisio tarvitsee omat normaalit portit. Molempien ensivirheiden salattu aineisto säilyi ja varmennettiin. |

Rajatut workflow-, keräin- ja Node-tuontikorjaukset on kohdennetusti todennettu.
Tuontirajan regressio hylkäsi vanhan toteutuksen; korjattu Playwright-luenta
löytää jälleen kaikki kolme paketoitua palautustestiä. Revision `0a1d210b`
normaali kierros suoritti myös paketoidut palautustestit hyväksytysti;
web-hylkäys esti silti kokonaiskoonnin. Natiivin ilmoitustestin epäonnistuva ensimmäinen näyte säilyttää
nyt suljetut tulosluokat nykyisessä yksityisessä virhetulosteessa. Yksi nimetty
asennukseton [Windows-sopimuskoe](https://github.com/eky-software/eky/actions/runs/38639450894)
läpäisi revision `895d6048` molemmissa erillisissä ympäristöissä (159 testiä
kummassakin). Alkuperäisen hylkäyksen syy säilyy avoimena. Hallittu native-virhe
todensi tarkennetun merkinnän ja kutsupinon oikeasti puretusta OpenPGP-paketista;
epäonnistuva prosessi ja testiapurin hylkäys säilyivät. Saman puhtaan revision
Windows-paketti läpäisi backup -> inspect -> restore -> restart -> compare
-ketjun, ja paketin tavut säilyivät ennallaan. Nämä ovat rajattuja todisteita;
uuden PR-headin normaalit portit ja mainin omat tarkistukset tarvitaan edelleen.

**Seuraava työ järjestyksessä:**

1. Säilyneet täydelliset MSI-lokit tarkistettiin: estäjän identiteetti ei
   selvinnyt niistä. Hyväksytyn ilmoitusluettelon keräys, synteettiset
   rajatapaukset, todellinen salaus/purku ja 159 valvojan regressiota läpäisivät;
   katselmus valmistui. Nimetty jatkokoe läpäisi ilman uutta virhepakettia.
   Aiempi odotus ja puuttuva estäjäidentiteetti säilyvät avoimina.
   Mahdollinen myöhempi estäjä sidotaan testin prosessi-identiteettiin. Pelkkä nimi ei
   todista prosessin omistajuutta. Ikkunan sulkeutuminen, backendin päättyminen,
   main-prosessin poistuminen ja asentimen valmistuminen ovat eri todisteita.
2. Omistaja hyväksyi rajatun etenemisen: vanha MSI-odotus jää avoimeksi
   seurantahavainnoksi, ei korjatuksi viaksi. Korvattujen polkujen poisto on
   todennettu; hyvitysapurista puuttuvan PDF-valmiusrajan regressiot,
   nykyiset kutsujat ja katselmus läpäisivät. Vie korjaus nyt jäädytetyn
   revision normaaleihin PR/main-portteihin. Vanhaa API-katkoa ei nimetä tämän korjauksen syyksi.
   Uutta hylkäystä ei ohiteta eikä sisältö-,
   palautus- tai siivousehtoja muuteta. Korjaa vain
   osoitettu virhe nykyiseen omistajaan. Ei automaattista UI-vastausta,
   hiljaiseen asennukseen vaihtoa, yleistä prosessiskannausta tai uusia valvojia.
3. Testivalintojen tarkistus valmistui: workspace-success valitsee 11 ja fault
   12 tiedostoa, joista viisi on yhteisiä (yhteensä 18 eri tiedostoa).
   Molemmat valmistelevat runtimen samassa `workspace_artifact_contracts`-jobissa.
   Mahdollinen rajattu jatko on yksi valmistelu ja yhteiset viisi, successin
   kuusi sekä faultin seitsemän omaa tiedostoa tässä samassa jobissa.
   Ajokytkennän testi todistaisi täsmällisen kattavuuden ja valmistelujärjestyksen;
   varsinainen asennusmatriisi säilyisi. CI:tä ei muutettu tässä korjauksessa,
   eikä päällekkäisyyttä osoitettu MSI-odotuksen syyksi.
4. Kokoa mahdollinen vielä tarvittava tietosuojapäätös yhdeksi rajaukseksi
   ennen seuraavaa pitkää ajoa. Nykyiset keräysrajat säilyvät. Puuttuvaa
   aineistoa tai tuntematonta syytä ei korvata oletuksella.
5. Varmenna korjaus, korvattujen polkujen poistoehto ja jäädytetyn revision
   nykyiset PR-portit. Normaalia suojattua mergeä seuraavat uuden mainin omat
   portit. Ellei näyttö riitä ratkaisuun, esitä yksi täsmällinen
   vaihtoehtopäätös; älä jatka rajattomaan tutkimus- tai ohjekasvuun.

Päivitä tätä nykytilaa toteuman muuttuessa. Päivätty näyttö alla säilyttää
ensivirheet ja hyväksynnät; sen vanhat jatkoehdotukset eivät ole rinnakkainen
työjono. Sopimusosiot säilyvät voimassa myöhempine hyväksyttyine päätöksineen.


<a id="m1-unit-preparation-76-1094"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:76-1094` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l76"></a>

## Päivätty näyttö ja sopimukset

Seuraavat checkpointit ovat syntyhetkensä näyttöä. Lue niistä nykyisen työn
tarvitsemat viitteet, älä aloita jo valmistuneita vaiheita uudelleen.

**PR #283 ja sen main-integraatio on hyväksytty 2.10.2026.**
[Lopullinen checkpoint](https://github.com/eky-software/eky/pull/283#issuecomment-5959719891)
sulkee ennen A1:tä hyväksytyn [pnpm-tietoturvahuollon](release-0.3.0-integration-history.md#m1-source-preparation-l10353)
ja Windowsin sekä Linuxin rajatun salatun ensivirhetoimituksen. PR #282:n
V1/V2-vakautuksen hyväksyntä säilyy. Myöhempi onnistuminen ei sulje vanhojen
timeout- tai siivoushavaintojen jälkikäteistä juurisyytä.
Alla päivätyt tutkimusvaiheet ovat historiaa, eivät rinnakkaisia työjonoja.

**T1/T2/T3, A1/R01, A2/R05, A3/R06 ja Oma yritys -tallennuskorjaukset
integraatiojatkoineen ovat hyväksyttyjä. B1/B2 ja niiden hyväksytyt sulku-/
keräysjatkot on hyväksytty PR #297:n mainissa; B3-B5 ja niiden rajatut
integraatiokorjaukset on hyväksytty PR #298:n mainissa 8.10.2026.
C on hyväksytty PR #299:n mainissa 9.10.2026. Nykyinen työ on
[K-paketin toteutus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395).** PR #294:n oma main-kierros
läpäisi; A2:n aiemman main-kierroksen tapauskohtainen etenemispäätös ja
alkuperäinen flaky-havainto säilyvät historiassa eivätkä muutu korjatuiksi.
Modulaarinen monoliitti ja
hyväksytty M1-rajaus säilyvät. Tämä sivu omistaa M1:n nykyisen jatkamiskohdan;
[julkaisusuunnitelma](release-0.3.0-plan.md) omistaa koko 0.3.0:n sisällön.

**K-integraation checkpoint 14.10.2026:**
[PR #304:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/304#issuecomment-6170624775)
varmentaa revision `36477039` puhtaan paketoidun palautusketjun,
263 kohderegressiota, tyypit, katselmuksen sekä PR:n V2- ja audit-portit.
Normaali merge tuotti mainin `012fed60`.
Sen [oma V2-kierros](https://github.com/eky-software/eky/actions/runs/38580185629)
päättyi hylätyksi: inspector-native-ajurin käännös epäonnistui kriittisen
Electron E2E:n valmistelussa ennen Playwright-käyttäjäpolkujen käynnistymistä.
Saman jobin aiemmat paketointi-, packaged restore- ja legacy-kokeet
läpäisivät; myös muut valitut hyväksyntäjobit läpäisivät. Kierroksella oli
36 onnistunutta jobia, yksi varsinainen hylkäys ja siitä seuraava aggregaatin
hylkäys sekä kuusi tarkoituksellista diagnostiikkaohitusta.
Mainin [erillinen auditointi](https://github.com/eky-software/eky/actions/runs/38580335654)
läpäisi. K:n main-hyväksyntä on edelleen avoin.

Salattu aineisto ei säilyttänyt kääntäjän alkuperäistä tulostetta.
Omistaja hyväksyi [nimettyyn Windows-valmisteluun rajatun 64 KiB:n otteen](ci-encrypted-evidence.md#testiperheiden-virheaineisto),
omistajuus-/kokorajaregressiot, paikallisen salaus/purku-todennuksen ja
yhden nimetyn Windows-kokeen. Ensin todennetaan nykyinen keräysketju;
sen jälkeen korjataan vain näytön osoittama syy ja vaaditaan uuden revision
omat normaalit PR/main-portit. Tämä ei ole uusi testialusta, käännösvirheen
korjatuksi merkintä tai hyväksyntäehtojen muutos.

**Talteenoton kohdenäyttö:** revision `0f621f46` rajatut Windows- ja Linux-
kontrollit, nykyinen salatun aineiston sarja, desktopin tyypit ja riippumaton
katselmus läpäisivät. Valmistelija -> keräin -> OpenPGP -> erillinen testiavain-
purku todensi alkuperäiset tavut; se ei toistanut vanhaa kääntäjävirhettä.
[Nimetty Windows-ajo 38591390653](https://github.com/eky-software/eky/actions/runs/38591390653)
läpäisi ensimmäisellä yrityksellä: paketointi ja hardened-palautus, kolme
paketoitua legacy/cold-tapausta, 47 kriittistä Electron-testiä ja erillinen
käynnistyshavainnon kontrolli. Checkout, säilyneiden lokien tiivisteet sekä
lifecycle-liitteen alkuperä ja siivous tarkistettiin. Neljä valitsematta
jätettyä jobia eivät ole läpäisyjä. Tämä ei ole normaali V2-kierros eikä
vanhan käännösvirheen juurisyyn hyväksyntä.

**PR #305:n normaali kierros:** headin `3d703c07`
[V2-ajo 38596095316](https://github.com/eky-software/eky/actions/runs/38596095316)
hylättiin kahden workspace-kuluttajan kohdeasentimen odotukseen. Kierroksella
oli 35 onnistunutta jobia, kaksi varsinaista hylkäystä, niiden aggregaatin
hylkäys ja kuusi tarkoituksellista diagnostiikkaohitusta.
[Erillinen auditointi](https://github.com/eky-software/eky/actions/runs/38596095204)
läpäisi. Tämä ei ole sama hylkäys kuin aiempi ajurin käännösvirhe.
Asennuksen hyväksyntä, prosessi-/tuotesiivous ja havaintojen saatavuus
säilyvät erillisinä tuloksina; onnistunut siivous ei hyväksy asennusta.

Omistaja hyväksyi [testin omistaman asentajaikkunan rajatun havainnon](ci-encrypted-evidence.md#asentimen-rajattu-ikkunahavainto)
nykyiseen salattuun virhepakettiin. Ei uusia UI-toimia, lomakekenttiä,
testialustaa tai aikarajoja. Ensin vaaditaan omistajuus-, keskeytys-,
keräys- ja todellinen salaus/purku-näyttö sekä rajattu katselmus, sitten yksi
nimetty Windows-koe samalla säilyneellä asennuspaketilla. Se ei ole normaali
hyväksyntäkierros eikä lupa merkitä vanhaa odotusta korjatuksi.

**Havaintokytkennän tulos:** revision `39ef904a` omistajuus-, keskeytys-,
keräys- ja salaus/purku-regressiot sekä rajattu riippumaton katselmus läpäisivät.
[Nimetty Windows-koe 38613163463](https://github.com/eky-software/eky/actions/runs/38613163463)
hylättiin asennusodotuksen nykyiseen aikarajaan; salattu toimitus ja paikallinen
purku sekä säilyneiden tiedostojen eheys varmennettiin. Havainto osoittaa tämän
ajon odottaneen asentimen käyttäjävastausta sovellusten sulkemispyyntöön.
Tiedostoja käyttävää prosessia ei vielä yksilöity. Onnistunut siivous ja
asennuspaketin jälkivarmennus eivät korvaa asennuksen hyväksyntää.

**Kokeen jälkeinen ehdotus (historia):** yksilöi tämän odotuksen aiheuttava tiedostojen käyttäjä ennen
sovellus- tai testikorjausta. Uusi aineistolaji tai nimetty koe tarvitsee oman
rajauksen; tässä ei hyväksytä automaattista UI-vastausta, aikarajan nostoa tai
uutta uusintaa. Korjauksen jälkeen palataan täsmäheadin normaaleihin PR-portteihin.
K:n aiemmin sovittu vanhojen raskaiden broker-polkujen poistoehto on myös
varmennettava; diagnostiikkakorjaus ei sulje sitä. Merge ja uuden mainin
omat portit säilyvät erillisinä hyväksyntöinä. Alkuperäiset virheet ja
aikaisemmat kierrokset säilyvät, eikä PR #305:tä ole hyväksytty mergeen.

**Aiempi integraatiohistoria:** PR #303 yhdistettiin 14.10.2026 normaalisti
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

Revision `5ff4c7d9` [nimetty MSI-koe](https://github.com/eky-software/eky/actions/runs/38557586442)
läpäisi ensimmäisellä yrityksellä. Molempien vaihtoehtojen UI-/execute-
lokitodiste, tiedostopolitiikka ja siivous läpäisivät. Salatun aineiston
ajosidonta, kylmä purku ja kaikki säilyneiden tiedostojen tiivisteet on
varmennettu; neljä asennuslokia tarkistettiin uudelleen samalla tiukalla
lukijalla. Yksi koe ei todista aiemman lokihäiriön mekanismia tai sulje K:ta.

Laskuhistorian testistä poistetaan koko SQLite-kuvan yleisen oliovertailun
ylimääräinen työ, ei katalogin sisältövalidointia. Täsmällinen natiivi
tavujen vertailu säilyttää kaikki 1 001 tapahtumaa, suuret kentät,
allokointiehdot ja viiden sekunnin rajan. Muuttunut viimeinen tavu ja eri
pituus hylätään erillisillä kontrolleilla. Kohderegressiot ja backendin
tyyppitarkistus läpäisivät; tuotantokoodi ja riippuvuudet ovat ennallaan.
Revision `55d8d19f` normaali [PR #304:n kierros](https://github.com/eky-software/eky/actions/runs/38560213746)
läpäisi nämä kaksi korjauskohdetta ja erillisen riippuvuustarkistuksen,
mutta koko portti jäi hylätyksi. Legacy-core-sarjan toinen toisto keskeytyi
jobin aikarajaan ja workspace-successin toinen toisto kohdeasentajan
odotukseen. Sisarajojen onnistumiset eivät korvaa näitä tuloksia.
Kumpaakaan hylkäystä ei ole uusittu tai hyväksytty, eikä PR:ää ole yhdistetty.

Rajattu lähdekatselmus löysi erillisen korjattavan sulkujärjestyksen puutteen:
pääikkuna jäi auki MSI:n käynnistyskutsuun asti vastoin nykyistä
[asennussuunnitelmaa](windows-installer-and-update-plan.md#12-hallittu-shutdown).
Korjausehdokas sulkee ikkunan ennen kutsua ja suojaa prosessin poistumisen
handoffin journal-/virheviimeistelyyn asti. Käyttäjän sulkupyyntö ja
asentajan käynnistysvirhe kuuluvat samaan rajattuun todennukseen.
Tämä ei vielä osoita alkuperäisen CI-odotuksen aiheuttajaa.
Korjausehdokkaan 263 kohdetestiä, desktopin tyyppitarkistus ja rajattu
riippumaton katselmus läpäisivät. Seuraavat portit ovat puhtaan revision
hardened Windows packaged backup -> inspect -> restore ->
restart -> compare sekä nimetyn päivitysketjun ja uuden jäädytetyn revision
normaalien PR/main-porttien todennus. Ensimmäiset hylkäykset säilyvät.

**Aiempi PR-todennus ja avoin MSI-asennusodotus:**
[Hyväksytyn testijaon checkpoint](release-0.3.0-integration-history.md#m1-source-preparation-l500).
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

<a id="m1-source-preparation-l340"></a>

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

<a id="m1-source-preparation-l360"></a>

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
| Nykyinen työ | [V2ax:n hyväksytyt päätökset](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4729), [V2bb:n live-terminal](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4846) ja [V2bc:n C-alkuperäisketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5275) säilyvät. [V2bd](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5223) kytkee tuoreen rollback-valtuuden pysäytetyn backendin jälkeiseen virhehaaraan. [V2be](release-0.3.0-profile-validation-history.md#m1-source-preparation-l4893) säilyttää täsmällisen update-valinnan valmistumis- ja virhekirjoitukseen asti. Puuttuva tai vanhentunut valtuus ei oikeuta tiedostomuutoksia. Alkuperäiskannan poissaolo ei oikeuta uuden business-runtimen valintaa, vaikka tiedostorollback palauttaisi poissaolon oikein. Rajattu kohdenäyttö ei ole koko K:n hyväksyntä. |
| Seuraava työ | [Historian osissa luennan tuotantokytkentä](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1287) ja [katalogin muistivirheen syyketju](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1146) on kohdetodennettu; korvatut historian kokonaistaulukot ja kasvavat kartat/joukot on poistettu. [Historian eristetyn ajon kohdenäyttö](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1165) erottaa todellisen utility-ketjun ja ajurin muistirajakokeen koko K:n hyväksynnästä. K:n rajattu loppukatselmus, puhtaan revision paketointi sekä saman paketin nyky-/038- ja cold-palautukset läpäisivät alla nimetylle revisiolle. Seuraavaksi jäädytetyn PR-headin normaalit portit, mukaan lukien [Linux-ajopolun](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1976) oikea Electron-todennus ja binaarihandoff. [Pakettibudjetin](release-0.3.0-integration-history.md#m1-source-preparation-l1490) puhdas paketti läpäisi tarkistukset; uusi PR- tai main-revisio tarvitsee omat porttinsa. Hyväksytyt PDF-/journal-kytkennät säilyvät. Alkuperäisiä aikakatkaisuja ei merkitä korjatuiksi eikä [hylättyä hyväksyntäjournalin sijoitteluehdokasta](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1735) oteta käyttöön. |
| Ei vielä valmis | K, W7, M1:n muu sovellustyö, D-paketin muut ehdot ja koko 0.3.0. Lähtörevision läpäisy ei hyväksy uuden revision puuttuvia portteja. |
| Uusin käyttäjäpolkunäyttö | [V2ah:n toimitus- ja sulkujärjestyskorjaus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3849) läpäisi yhden nimetyn Windows-Electron-kohdeajon: tuonnin schema-hylkäys, korvauksen schema-hylkäys ja native-vahvistuksen peruutus. Ensihylkäykset säilyvät erillisinä. Tämä on kohdenäyttö, ei durable-aktivoinnin, hardened-paketin tai PR/main-porttien hyväksyntä. |

**Aktiivivalidoinnin nykyinen checkpoint:** [V2bj](release-0.3.0-profile-validation-history.md#m1-source-preparation-l5070)
on kytketty tavalliseen ja palautuksen jälkeiseen startupiin, live-päivityksen
valmisteluun ja handoffiin sekä ensimmäiseen käynnistykseen ja C-palautukseen
[kutsujakohtaisella omistajuudella](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2100).
Ensimmäinen käynnistys tekee uuden tarkistuksen, ja C välittää erikseen
täsmällisen update-valinnan sekä odotetun alkuperäisketjun. Näiden kutsujien
vanhaa raskasta broker-validaattoria ei enää käytetä. Koko vanhan protokollan
poistamista tai K:n hyväksyntää ei päätellä tästä kohdenäytöstä.
V2bi:n alkuperäiset aikakatkaisut pysyvät avoimina. Alla oleva katselmus
erottaa korjattujen kytkentöjen ja candidate-avausrajan kohdenäytön loppuporteista.

**K3:n rajattu syytietokorjaus on kohdetodennettu:** palautuksen hyväksynnän
loppuvaiheen turvallinen ensisyy ja vaihe välittyvät nykyiseen diagnostiikkaan
ja tukipakettiin. [Hyväksytty tapahtumasopimus ja näyttö](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2952)
eivät muuta journalin tarkistuskohtia tai selitä alkuperäistä aikakatkaisua.
K:n suuren katalogin, paketoinnin ja integraation avoimet portit säilyvät.

**Hyväksyntäjournalin nopeutusehdokkaita ei ole hyväksytty:** myös viimeisten
lukujen jälkeen tehtävän lisätarkistuksen koe hylättiin. Se sulki aiemmat
koeaukot mutta avasi journal-slottien muutosriskin. Tarkennettu koe löysi
lisäksi keskeneräisen K-työpuun nykyiseenkin polkuun yhteisen viimeisen
sisäisen luvun havaintorajan. [Jatkokokeen tulos](release-0.3.0-profile-validation-history.md#m1-source-preparation-l1735) erottaa synteettisen
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

<a id="m1-source-preparation-l500"></a>

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

<a id="m1-source-preparation-l793"></a>

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

<a id="m1-source-preparation-l890"></a>

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

<a id="m1-source-preparation-l958"></a>

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
| Candidate-kuluttajan kirjoittava avaus | Kolme tarkistusoperaatiota käyttää nyt yhteistä readonly-attestointia ennen kirjoitettavaa avausta; luontia ja tyhjää kantaa ei sallita. Puuttuvan kannan hylkäys, hot-journalin säilyminen sekä nyky-/038-/WAL-/PDF-kontrollit on kohdetodennettu. Kuusi oikean utility-ketjun tapausta todistaa puuttuvan kannan hylkäyksen ja ehjän WAL-kannan hyväksynnän, lapsen exitin sekä varauksen palautuksen. [Rajaus](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2020) ei sulje hardened-palautuksen tai K:n muita loppuportteja. |
| Eksplisiittinen muistirajavirhe | Nimetty schema-/historia-/eheystarkistuksen luokittelupuute on korjattu ja kohderegressiot läpäisivät. [Rajattu näyttö](release-0.3.0-profile-validation-history.md#m1-source-preparation-l2061) erottaa injektoidun natiivivirheen ja runnerin syykoodin todellisesta resurssirajasta sekä paketoidun palautuksen hyväksynnästä. Hylkäys pysyy suljettuna eikä raakapinoa julkaista. |
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

<a id="m1-source-preparation-l1034"></a>

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


<a id="m1-unit-preparation-1490-1509"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:1490-1509` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l1490"></a>

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


<a id="m1-unit-preparation-5766-6873"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:5766-6873` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l5766"></a>

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

<a id="m1-source-preparation-l5811"></a>

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

<a id="m1-source-preparation-l5845"></a>

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

<a id="m1-source-preparation-l5883"></a>

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

<a id="m1-source-preparation-l5943"></a>

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

<a id="m1-source-preparation-l5995"></a>

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

<a id="m1-source-preparation-l6295"></a>

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


<a id="m1-unit-preparation-6874-7627"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:6874-7627` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l6874"></a>

### B3-B5:n integraatiohistoria

Alla olevat checkpointit kuvaavat hyväksyntää edeltäneitä revisioita.
Nykyinen hyväksyntä on [PR #298:n loppuyhteenvedossa](https://github.com/eky-software/eky/pull/298#issuecomment-6050339146);
vanhojen hylkäysten tuloksia tai syyepävarmuutta ei kirjoiteta uudelleen.

<a id="m1-source-preparation-l6880"></a>

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

<a id="m1-source-preparation-l6921"></a>

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
rajattuun korjaukseen](release-0.3.0-integration-history.md#m1-source-preparation-l7269).
Alkuperäisen lähteen, PDF:ien, tiedostotyyppien, sisällön ja hyväksytyn
migraation tarkistukset säilyvät. Uutta diagnostiikkakerrosta ei lisätä;
korjauksen näyttö ja vielä avoin hyväksyntä ovat alla olevassa checkpointissa.

Rajattu diagnostiikkakoe ei ole normaali PR-hyväksyntä. PR #298:n vanhaa
`394e09730426e7556f8b29ed380838bc4f90a10b`-headia ei mergetä. Kun rajattu
näyttö täyttyy, sen lineaarinen jatko viedään PR:n täsmälliseksi headiksi
ja kaikki nykyiset PR- sekä uuden mainin portit vaaditaan erikseen.
B3-B5:n hyväksyntä ja merge ovat edelleen avoinna.

<a id="m1-source-preparation-l7269"></a>

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

<a id="m1-source-preparation-l7466"></a>

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

<a id="m1-source-preparation-l7520"></a>

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


<a id="m1-unit-preparation-7628-7670"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:7628-7670` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l7628"></a>

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


<a id="m1-unit-preparation-10096-10311"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:10096-10311` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l10096"></a>

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

<a id="m1-source-preparation-l10137"></a>

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

<a id="m1-source-preparation-l10215"></a>

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


<a id="m1-unit-preparation-10312-10488"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:10312-10488` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l10312"></a>

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

<a id="m1-source-preparation-l10353"></a>

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

<a id="m1-source-preparation-l10408"></a>

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


<a id="m1-unit-preparation-10489-11379"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:10489-11379` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.
> This projection generalizes one privacy-sensitive description; it is not byte-identical to the source.

<a id="m1-source-preparation-l10489"></a>

## Riskiperusteinen jatko 1.10.2026

<a id="m1-source-preparation-l10491"></a>

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

<a id="m1-source-preparation-l10558"></a>

### Nykyisen työn rajaus

Alla kuvattu timeout-tutkimus ja sen päätösraportti säilyvät historiana.
Omistajan uusin hyväksyntä lisää seuraavan rajatun toimitusvälitavoitteen;
se ei käynnistä yksityisiä kertakokeita uudelleen.

<a id="m1-source-preparation-l10564"></a>

### Salatun tutkimusaineiston välitavoite

**Nykytila 2.10.2026:** rajattu salattu toimitus/purku on hyväksytty
revisiolla `f69f3d76`, [ajo 36930438493](https://github.com/eky-software/eky/actions/runs/36930438493),
suoritusyritys 1. Paikallisesti toistettu Git-hakuvirhe korjattiin ja
hosted-toimitus sekä yksityinen purku läpäisivät. Tämä ei ole normaalin
workspace-testin, ETL-tallennuksen tai alkuperäisen timeoutin hyväksyntä.
Keräyksen julkisen avaimen vahvistus on voimassa; myöhempi normaali kierros
on erotettu [omaan checkpointiinsa](release-0.3.0-integration-history.md#m1-source-preparation-l10491).
Alla säilyvät aiempien vaiheiden tulokset, eivät rinnakkaiset
työjonot. Tarkka lopputulos on [hyväksyntächeckpointissa](release-0.3.0-integration-history.md#m1-source-preparation-l10700).

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

<a id="m1-source-preparation-l10700"></a>

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

<a id="m1-source-preparation-l10724"></a>

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

<a id="m1-source-preparation-l10748"></a>

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
[käynnistimen ennakkotarkistukseen](release-0.3.0-integration-history.md#m1-source-preparation-l11277).
Omistajan erikseen hyväksymä yksi korjattu koe samalla lähderevisiolla
[läpäisi tallennuksen ja vientianalyysin](release-0.3.0-integration-history.md#m1-source-preparation-l11319).
Aineisto säilytettiin ja varmennettiin paikallisesti
[hyväksytyn säilytysrajauksen](release-0.3.0-integration-history.md#m1-source-preparation-l11120)
mukaan. Rajattu vientitutkimus päättyy päätösraporttiin; kolmatta
diagnostista ajoa tai normaalia hyväksyntäkierrosta ei käynnistetä
automaattisesti. Alkuperäisen timeoutin valmistumisehto ei ole täyttynyt.
Playwrightin ensiyrityksen trace pysyy erillisenä työnä. Hyväksytyt V1- ja
T3-sopimukset eivät avaudu uudelleen.

<a id="m1-source-preparation-l10782"></a>

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

<a id="m1-source-preparation-l10829"></a>

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

<a id="m1-source-preparation-l10900"></a>

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

<a id="m1-source-preparation-l10943"></a>

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

<a id="m1-source-preparation-l10982"></a>

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

<a id="m1-source-preparation-l11023"></a>

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

<a id="m1-source-preparation-l11058"></a>

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

<a id="m1-source-preparation-l11120"></a>

### Yksityisen vientiaineiston säilytysehdotus

**Nykytila: ensimmäinen ajo päättyi valmistelun ennakkotarkistukseen.
Erikseen hyväksytty korjattu kertakoe läpäisi no-MSI-vientiketjun;
[päätösraportti](release-0.3.0-integration-history.md#m1-source-preparation-l11319) erottaa
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

**Kohde ja oikeudet.** Hyväksytty kohde on erillinen yksityinen
diagnoosirepo, ei julkisen EKY:n
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

<a id="m1-source-preparation-l11277"></a>

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
[tulos](release-0.3.0-integration-history.md#m1-source-preparation-l11319) on erillinen
diagnostinen yritys, ei alkuperäisen testin muuttumaton uusinta. Tämä
valmisteluhylkäys säilyy ensimmäisen ajon tuloksena; sitä ei korvata
myöhemmällä läpäisyllä.

Menetelmän lähde: [.NET SDK:n valinta ja global.json-hakujärjestys](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json).

<a id="m1-source-preparation-l11319"></a>

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

<a id="m1-source-preparation-l11360"></a>

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


<a id="m1-unit-preparation-11380-12090"></a>

> Historical source: `eky_software/docs/architecture/release-0.3.0-m1-preparation-plan.md:11380-12090` (original and provenance retained privately).
> Original source-unit checksums are retained privately. Historical pending states are not current authority.

<a id="m1-source-preparation-l11380"></a>

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

<a id="m1-source-preparation-l11395"></a>

### Rajattu ongelmalista

| Kohta | Havaittu puute ja omistaja | Tarvittava näyttö ja sulkemisehto |
| --- | --- | --- |
| V1a: syntypaikka ja viesti | Electronin E2E-backendin runner hukkaa poikkeuksen ja lähettää vain vaiheen. Brokerin sulkemisvirhe voi estää viestin. Omistaja: `apps/desktop/e2e` ja sen tiukka status-sopimus. | Suljettu syyluokitus tai `unknown`, täsmällinen lähettäjä/parseri/vastaanottaja, ensivirheen säilyminen ja brokerien erilliset sulkutulokset. Nopeat sopimus- ja vuotosuojatestit; ei tuotantokoodin muutosta. |
| V1b: säilyminen ja raportti | Prosessin muistihavainto voi puuttua poistumisen jälkeen; CI:n testikooste yleistää virheen `testError`-tasolle. Omistaja: nykyinen native-havaintotiedosto, Electron-fixture ja turvallinen CI-raportoija. | Todellinen ennen ensimmäistä ikkunaa epäonnistuva prosessiketju säilyttää tunnetun syyn lopullisessa suoritusyrityskohtaisessa raportissa. Testitapaus, suoritusyritys (`attempt`) ja käynnistyssukupolvi eivät sekoitu. Puuttuva/myöhäinen havainto, raportointivirhe ja epävarma cleanup pysyvät näkyvinä erillään. Nykyinen onnistumispolku säilyy. |
| V2a: riippuvuuden hyväksyntä | Hyväksytyn Electron-päivityksen runtime-/native- ja integraatioportit ovat kesken. Omistaja: [riippuvuusarvio](local-desktop-dependency-review.md#electron-4376--turvallisuuspäivitys). | Nykyisen täsmäversion, `better-sqlite3 13.0.2`:n ja synteettisen packaged-/palautuspolun portit sekä ennalta nimetyt vakausajot; lopullisen revision PR/main-todennus. |
| V2b: pakollisten porttien hylkäykset | Raportoinnin keräysriippuvuus ja MSI:n samaversion korvaussääntö on korjattu. Valmiuskyselyhavainto ja revision `8913dc48` E2E-perheet sekä installer-/legacy-ryhmät läpäisivät. Avoin hylkäys on saman PR-ajon packaged-workspace run 2:n job-aikaraja. Omistaja: nykyinen Windows acceptance -polku; [rajattu jatko](release-0.3.0-integration-history.md#m1-source-preparation-l10489). | Erota prosessin alkuperäinen vika, tuloksen saatavuus ja siivous; sovella yhteistä uusintakäytäntöä ilman hyväksyntäehtojen lievennystä. PR/main vaatii oman hyväksynnän; läpäisy ei todista vanhojen timeoutien syitä. Historiallisten hylkäysten täydellinen jälkiselitys ei ole uusi hyväksyntäehto. |

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

<a id="m1-source-preparation-l11437"></a>

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

<a id="m1-source-preparation-l11455"></a>

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

<a id="m1-source-preparation-l11502"></a>

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

<a id="m1-source-preparation-l11526"></a>

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

<a id="m1-source-preparation-l11633"></a>

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

<a id="m1-source-preparation-l11675"></a>

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

<a id="m1-source-preparation-l11698"></a>

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

<a id="m1-source-preparation-l11791"></a>

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

<a id="m1-source-preparation-l11986"></a>

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

<a id="m1-source-preparation-l12009"></a>

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
