# 0.3.0: M1:n nykytila ja sopimusten lukureitti

Tämä tiedosto omistaa aktiivisen jatkamiskohdan ja hyväksyntänäytön.
[Julkaisuroadmap](release-0.3.0-plan.md) omistaa sisällön ja työjärjestyksen;
alla linkitetyt vastuuohjeet omistavat tekniset ja liiketoimintasopimukset.
Päivätyt tutkimusraportit eivät ole rinnakkainen toteutusjono.

## Jatka tästä

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
hallintatila. Rekisterin, metadatan ja käynnistyksen tilavalmistelun osarajat
on toteutettu ja kohdennetusti todennettu. Seuraavana on W6:n ja FirstStartin
todellinen yhteinen valtuusketju; W7.2:n tuotantokytkentä ei ole valmis.
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

**Seuraava työ:** FirstStart- ja W6-valtuuksien yhteinen kytkentä mainiin,
mukaan lukien täsmällinen sallittu rekisterisiirtymä ja todellinen
terminal-valtuus. Ensimmäisen yritysavauksen tilavalmistelu on nyt kytketty
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
FirstStartin uusi tila ei vielä ole tuotannon startupin käyttämä haara.
W6:n nimetty jatko tarvitsee vielä startup-omistajan todellisen kutsun,
ei yleistä B-baselinen store-adapteria tai teeskenneltyä uutta päivitystä.
Todellinen v2-julkaisu, historiallisen palautuksen terminal-kytkentä ja
source-null-composition jäävät pysyvien regressioiden ja integraation porteiksi.
Valitsimen readiness ei ole business-hyväksyntä, null-valinta ei luo
oletusyritystä eikä epävarma prosessisulku avaa uusia hallintakirjoituksia.
Sitten pysyvät regressiot ja oikean käynnistysketjun todistus ennen saman
puhtaan paketin sekä täsmällisen PR/mainin portteja.
W7-P1-P4:n hyväksyttyjä päätöksiä tai jo katselmoituja kokeita ei aloiteta
uudelleen ilman omaa havaintoa. Uusi nimeämätön päätös kysytään ennen kytkentää.

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

### M4 / Käyttäjäkokemuksen valmistelu

**Tila 25.10.2026:** M4.1-M4.3 ja W7.1 hyväksytty omine PR/main-portteineen.
W7.0:n tekninen sopimus ja pienet kokeet ovat valmiit; poistokoodin
tuotantototeutus ja integraatiotodennus ovat erilliset W7.2-W7.5-vaiheet.
Roadmap omistaa
julkaisuun sovitut R030-01, R030-02/W7, R030-03 ja R030-08.
R030-04/R030-05:n palaute ja käyttöohjeet kulkevat jokaisen palan mukana.
Alla oleva taulukko erottaa hyväksytyt palat vielä täsmennettävistä;
se ei ole rinnakkainen roadmap.

| Pala | Nykykoodista varmennettu lähtö | Suunnittelun tulos ja kohdenäyttö |
| --- | --- | --- |
| M4.1 / R030-01 | Yhteinen tilaton `LoadingStatus` käyttää featureiden nykyisiä tiloja. | Hyväksytty PR #317:n rajauksessa. Säilytä saavutettavuus ja nykyiset PDF-/SMTP-/backup-tilakoneet; vanha Electron-timeout jää avoimeksi. |
| M4.2 / R030-03 | Main lukee saman backup-leasen sisällä tuoreen validoidun aktiivisen yrityksen nimen native-dialogin ehdotukseen. | Hyväksytty PR #318:n rajauksessa turvallisine nimimuunnoksineen ja palautusnäyttöineen. Ei uutta toteutusjonoa. |
| M4.3 / R030-08 | Readerin rajattu jatkohaku korvaa tapahtumalistan vanhan tail-otoksen; summary ja tukipaketti säilyvät erillisinä. | Hyväksytty [PR #319:n loppupäätöksellä](https://github.com/eky-software/eky/pull/319#issuecomment-6385011410). Sopimus ja pysyvät regressiot säilyvät; ensihylkäykset eivät muutu korjatuiksi. |
| M4.4 / R030-02/W7 | Capability ja maintenance eivät vielä tunne poistoa. Registry v1 sallii null-aktiivisen vain ilman yhtään `ready`-entryä; nykyinen startup ja management-composition tarvitsevat aktiivisen kohteen. | W7.0:n [katselmoitu sopimus ja pienet kokeet](local-company-workspace-plan.md#w70n-jäljellä-olevat-sopimustäsmennykset) valmiit. Seuraavaksi W7.1-W7.5 nykyisten omistajien pohjalta; ei uutta testialustaa. |

Kartoitus on edustava lähdeluku, ei kaikkien odotustilojen tai koko
sovelluksen katselmus. Suositus on M4.1 -> M4.2 -> M4.3 -> M4.4;
W7:n käyttäytymispäätökset valmistellaan ajoissa erillään ensimmäisestä
pienestä UI-toteutuksesta. Pelkkä passiivisen yrityksen poisto ei täytä
koko W7:n julkaisuvaatimusta.

**Sovitut linjaukset ja avoimet päätökset ennen toteutusta:**

- R030-01: yhteinen tilailmaisin käyttää nykyistä feature-tilaa, ei uutta
  yleistä työnohjausta. Suositus on välitön saavutettava tilapalaute
  ilman uutta ajastinviivettä; animaatio ei muuta työn etenemistä.
  Yhteinen web-primitiivi perustellaan usean featuren todellisella tarpeella
  [UI-ohjeen mukaan](ui-design-system-roadmap.md); `packages/ui` ei aktivoidu.
- R030-03: omistaja hyväksyi 23.10.2026 nimen lähteeksi valitsimen validoidun
  `workspaceLabel`-nimen ja päivämäärän. Puuttuvan nimen varavaihtoehdoksi
  säilytetään nykyinen päivämääränimi. Turvallinen merkkien, pituuden ja
  tiedostonimen käsittely on hyväksytyssä backup-suunnitelman nimeämissopimuksessa.
  Ehdotus sidotaan samaan aktiiviseen työtilaan nykyisen maintenance-omistajan
  sisällä, ei rendererin lähettämään polkuun tai mielivaltaiseen nimeen.
  Yritysnimi on näkyvissä salatun tiedoston nimestä; formaatti, lineage,
  salaus, self-inspection ja olemassa olevan kohteen suoja säilyvät.
- R030-08: omistajan täsmennys 23.10.2026 on palvelinpuolinen lajittelu ja
  rajattu sivutus: käyttöliittymä saa vain pyydetyn erän, ei koko historiaa.
  Sama vastuunjako on jo asiakashistorian ja hyväksyttyjen laskujen listoissa;
  SQLiten offset-toteutusta ei kuitenkaan oleteta suoraan JSONL-lokien malliksi.
  Määritä tasatilanteiden järjestys, jatkon saatavuus ja
  muuttuneen/poistuneen lokin käyttäytyminen. Pelkkä aikaleimarajaus
  nykyisen tail-otoksen päälle ei riitä: myös vanhemmat säilyneet tavut
  pitää voida saavuttaa rajatuilla erillä. Jatkohakusyöte ei anna polkuja,
  muuta `viewDiagnostics`-oikeutta tai lupaa laajempaa raakaprojektiota.
  H:n erilliset lista-/yhteenvetotilat, retention ja tukipakettirajat säilyvät.
- W7: [omistava päätöslista](local-company-workspace-plan.md#omistajan-päätettävät-sopimukset)
  kirjaa viimeisen yrityksen poiston ja sen jälkeisen tyhjän hallintatilan
  rajatun hyväksynnän 23.10.2026: luonti tai tuonti, ei automaattista
  oletusyritystä. Myös [vikatilaisen yrityksen poisto ilman piilokopioita](local-company-workspace-plan.md#w7n-hyväksytty-poistoperiaate)
  on hyväksytty suunnaksi: tietokantaa ei tarvitse ensin korjata, mutta kohde
  tunnistetaan ja sitä käyttävien töiden päättyminen todistetaan. Quarantine
  on saman poistotoiminnon välivaihe; onnistunut poisto kattaa SMTP-slotit,
  keskeytyminen näkyy keskeneräisenä. W7-D4:n poisto ilman toimivaa backupia
  on hyväksytty: erillinen tietojen menetyksen hyväksyntä, yritysnimen
  kirjoitus ja native-vahvistus. Backupin virhe tai peruutus ei hyväksy riskiä.
  W7-D2:n aktiivisen yrityksen poiston jälkeinen yritysvalinta on hyväksytty:
  toista yritystä ei avata automaattisesti. W7-D8:n omien palautuspisteiden
  poisto, myös viimeisen hyvän pisteen, on hyväksytty rajatuksi poikkeukseksi
  normaaliin säilytykseen. Muiden yritysten pisteet ja käyttäjän vientibackupit
  säilyvät; pisteestä ei tehdä automaattista vientikopiota. W7-D6:n yrityksen
  oman muutos-/tapahtumahistorian ja business-auditin poisto on hyväksytty;
  tekniset virhelokit säilyvät normaalein säännöin ilman historiarivien kopiointia.
  W7-D3:n peruutus viimeiseen vahvistukseen asti on hyväksytty; varsinaisen
  poiston alettua käyttöliittymä ei peru sitä. Keskeytys ei ole peruutus tai
  onnistuminen. Myös [nimien yksilöllisyys](local-company-workspace-plan.md#yritysvalitsimen-nimien-yksilöllisyys)
  on hyväksytty luonnille, tuonnille ja nimenmuutokselle: kirjainkoko tai
  ylimääräiset välilyönnit eivät kierrä estoa. Vanhojen samannimisten
  säilyttäminen huomautuksella ilman automaattista nimeämistä on hyväksytty;
  pelkkä nimikaksoiskappale ei estä aiemmin käyttökelpoisen yrityksen avaamista.
  W7-D9:n käyttäjän ulkoisten PDF-arkistokopioiden säilyminen on hyväksytty,
  myös EKYn tekemien työtilakohtaisten kopioiden. Sisäiset auktoritatiiviset
  PDF:t poistuvat yrityksen mukana; arkistointityön päättyminen todistetaan
  ennen sisäisen asetuksen ja retry-journalin poistoa.
  W7-D5/D10:n aloitettua lopullista poistoa saa jatkaa automaattisesti
  restartissa vain varmasti todetun kohteen, omistajuuden ja keskeytystilan
  perusteella. Epävarma jatko pysähtyy näkyvään keskeneräiseen tilaan.
  Tämän keskustelun nimetyt käyttäytymisvalinnat on ratkaistu;
  [koottu W7-toteutusehdotus](local-company-workspace-plan.md#koottu-toteutusehdotus)
  omistaa seuraavan teknisen täsmennyksen ja katselmuksen.
  Vahvistusten tarkka kohdesidonta, tapahtumakytkentä, aineiston inventaario sekä
  poisto-/recovery- ja backendittoman tuen toteutussopimus ovat avoimia.
  Ei tuotantokytkennän tai registry-/journal-formaatin hyväksyntää.

**Säilyvät vastuut ja todistus:** feature omistaa käyttöliittymätilansa,
API-client HTTP-kulun, Diagnostics turvallisen lukuprojektion ja Electron
main native-dialogit, valtuudet sekä työtilan elinkaaren. Latausikoni ei
korvaa backendin invarianttia tai D/C/K:n todistettua sulkua. Uusia
riippuvuuksia, yleistä manageria, loggeria tai testialustaa ei ehdoteta.
R030-04 tarkistaa myös saman version päivitysyrityksen turvallisen palautteen,
ei poista sen estoa. D029-06:n erillinen Päivitä-toiminto ja R030-07:n
suodattimet eivät tule mukaan ilman omaa rajauspäätöstä.

Kukin toteutuspala käyttää nykyisiä kohdetestejä ja kolmea yhteistä
E2E-fixtureä riskinsä mukaan. Uusi turvalliseksi koodiksi muuttava raja
kytkee alkuperäisen testivirheen nykyiseen yksityiseen havaitsijaan ennen
muunnosta; salatun aineiston purkutodistus tehdään soveltuvalle uudelle
rajalle. Pakkokatkaisun puuttuvaa aineistoa ei luvata saatavaksi.
Tapahtumien Diagnostics-/tukipakettisisällytys tai poissulku ratkaistaan
omistavan sopimuksen mukaan. Backup-/profiili-/lifecycle-muutos tarvitsee
nykyisen hardened Windows backup -> inspect -> restore -> restart -> compare
-portin; W7 lisäksi omat muut yritykset säilyttävät packaged-/fault-porttinsa.
Testikattavuutta, aikarajoja tai CI-ehtoja ei muuteta tässä valmistelussa.
M5:n koko koodin katselmus, sen jälkeinen Deep Scan ja julkaisuhyväksyntä
ovat tämän jälkeen erikseen; laaja rakennesiivous ei kuulu M4:ään.

#### Koottu toteutusjärjestys

**Järjestys, päivitetty 25.10.2026:** M4.1-M4.3 on hyväksytty ja W7.0:n
sopimus-/koevaihe valmis. Seuraava toteutus alkaa W7.1:n nimirajasta ja
etenee W7.2:n yritysvalintaan, tästä valmistelu-Goalista erillään.
Omistajan roadmap-jatkovaltuus ja palakohtaiset hyväksyntäportit säilyvät;
uusia formaatteja tai turvarajojen lievennyksiä ei johdeta pelkästä
jatkovaltuudesta.

1. **M4.1, valmis:** säilytä hyväksytty odotustilojen käyttökohdelista ja
   saavutettava esityssopimus nykyisten feature-tilojen päällä. Ei uutta
   työnohjausta eikä jo toimivien PDF-/SMTP-tilakoneiden uudistusta.
2. **M4.2, valmis:** säilytä tuore yritysnimi ja päivämäärä nykyisessä mainin
   tallennuspolussa sekä PR #318:n hyväksytty tiedostonimi-/palautussopimus.
3. **M4.3, valmis:** säilytä hyväksytty erä-/jatkohakusopimus ja sen
   lukija -> service/HTTP -> strict-client -> käyttöliittymä -ketju.
   Älä korvaa koko historian selausta suuremmalla taililla.
4. **M4.4/W7:** W7.0:n inventaario-, sulku-, keskeytys- ja formaattisopimus
   sekä pienet kokeet on katselmoitu. Seuraava
   tuotantokytkentä kattaa W7.1-W7.5:n nimet, backendittoman
   valinnan, poiston, automaattijatkon ja todellisen palaute-/tukiketjun.
5. **Hyväksyntä:** jokaisen palan kohdetestit, käyttäjäpalaute, diagnostiikka,
   ohjeet ja korvattujen polkujen poisto samassa checkpointissa. Käytä
   nykyisen riskipolitiikan PR-portteja ja vaikutusalueen paketoituja
   todisteita. Suojattu merge ja mainin omat portit vasta valtuutetussa
   toteutusvaiheessa omistajan jatkovaltuudella. Uusi estävä havainto
   käsitellään nykyisten turva- ja hyväksyntärajojen mukaan.

#### M4.1: Odotustilojen toteutussopimus

Omistaja hyväksyi 23.10.2026 R030-01:n toteutuksen ja testit. Yhteinen
[esityssopimus](ui-design-system-roadmap.md#odotustilan-esitys) on webin
sisäinen ja tilaton. Nykyiset hookit, API-/native-capabilityt, virhekoodit,
salaisuuksien säilytys, business-päätökset ja elinkaaren sulut säilyvät.

| Käyttökohde | Nykyinen tilan omistaja ja palaute |
| --- | --- |
| Customers | Listan, yksittäisen asiakkaan, historian, laskujen ja tuntihinnan alkuluvut; nykyinen tallennustila ja peruutus/virhe säilyvät. |
| Company Settings | Perustietojen, SMTP-tilan, numeroinnin, maksuehdon ja ALV:n luku/tallennus; D:n alkuluvun portti ja CS-2:n odotusaikaiset muokkaukset säilyvät. |
| Backup | Nykyinen panelin busy-tila erotellaan vain esitystä varten status/backup/inspection/recoveryPoint-arvoihin. Main omistaa edelleen native-dialogin, salauksen ja palautuspisteet. |
| Paikallispäivitys ja PDF-arkisto | Nykyiset luku-/operaatiotilat, ei uutta päivitys-, kopiointi- tai retry-logiikkaa. Ilmaisin ei väitä taustajonon valmistuneen. |
| Invoicing | Nykyiset lista-/detail-/toimitus-/hyvitysluvut, tallennus, hyväksyntä, PDF, sähköpostin valmistelu/lähetys, maksu, mitätöinti ja luonnoksen poisto. Autosaven debouncesta ei tehdä aktiivista kirjoitusta. |
| Workspaces | Nykyinen brand-, lista-, toiminto- ja relaunch-tila; mainin vahvistukset ja prosessiomistajuus eivät siirry käyttöliittymään. |
| Activity ja Diagnostics | Nykyiset luvut; Diagnosticsin lista ja yhteenveto pysyvät erillisinä. Tukipaketin luominen käyttää nykyistä pending-lippua. Historian sivutusta ei toteuteta tässä. |

Nykyiset käyttäjän virhe-/onnistumisviestit säilyvät. Esitysmuutos ei lisää
audit- tai teknistä lokitapahtumaa: onnistumisen, hylkäyksen ja epäselvän
tuloksen nykyinen omistava tapahtuma ja lukuketju säilyvät. Uutta
turvalliseksi koodiksi muuttavaa virherajaa ei lisätä. Testit käyttävät
nykyistä alkuperäisen virheen ja salatun aineiston ketjua, eivät uutta loggeria.
Välitön, nopeasti päättyvä työ ei saa keinotekoista vähimmäisodotusta.
Natiivin lokikansion avaukseen ei lisätä keinotekoista pitkäkestoista tilaa.

**Hyväksyntä 24.10.2026:** M4.1:n omat PR/main-portit ja loppupäätös ovat
[PR #317:n loppuyhteenvedossa](https://github.com/eky-software/eky/pull/317#issuecomment-6376623066). Paikallinen CI:tä edeltävä näyttö
ja sen rajat säilyvät [integraatiohistoriassa](release-0.3.0-integration-history.md#m41n-citä-edeltävä-checkpoint-24102026).
Hyväksyntä ei väitä kaikkien näkymien manuaalista ruudunlukijakatsausta,
uutta native-palautustodistusta tai historiallisten timeoutien korjausta.

#### M4.2: Varmuuskopion tiedostonimisopimus

Omistajan hyväksymä yritysvalitsimen nimi ja päivämäärä muodostavat vain
mainin native Save -dialogin ehdotuksen. Nykyinen backup-maintenance-lease
hankitaan ennen tuoretta validoitua, sivuvaikutuksetonta rekisterilukua.
Sen aktiivisen workspaceId:n
on vastattava tämän runtimen työtilaa; ristiriitaa tai rekisterin lukuvirhettä
ei muuteta toisen yrityksen nimeksi. Luonti, nimenmuutos ja yrityksen vaihto
käyttävät samaa leasea. Renderer ei anna nimeä eikä polkua.

Nimen teknisen muunnoksen ja käyttöohjeen omistaa
[backup-suunnitelma](local-backup-and-restore-plan.md#siirrettävän-varmuuskopion-tiedostonimi).
Kohdetestit kattavat Unicode-/polkumerkit, puuttuvan nimen, saman päivän
törmäyksen nykyisen no-overwrite-suojan kautta, peruutuksen, lukuhäiriön,
huoltovarauksen ja myöhäisen sulun sekä todellisen compositionin tuoreen
nimen. Nykyinen kontti, salaus, lineage, sisältö ja vanhojen kopioiden
palautus pysyvät muuttumattomina. Uutta audit-tapahtumaa ei tarvita;
luonti käyttää nykyistä backup-tapahtumaa ja nimiluvun virhe turvallista
backup.failed-tapahtumaa ilman nimeä tai polkua.

**Hyväksyntä 24.10.2026:** vaikutusalueen testit, rajattu riippumaton katselmus,
puhtaan paketin hardened backup -> inspect -> restore -> restart -> compare
sekä täsmällisen PR-headin ja uuden mainin omat portit läpäisivät.
[Jatkamiskohdan näyttö](#jatka-tästä) kattaa myös erikseen hyväksytyn
Electron-/Undici-korjauksen; M4.2:ta ei avata uudelleen vanhan checkpointin vuoksi.

### I / CI-politiikan ja ajantasaisten sopimusten valmistelu

**Hyväksytty:** I0-I3/R30/R31, yllä linkitetty PR #316:n loppuhyväksyntä.
R30:n täsmällinen neljän polun valinta ja R31:n rajatut G/D/H-korjaukset
ovat toteutettuja; historiallista valmistelutekstiä ei käytetä uutena työjonona.
Nykyistä CI-politiikkaa omistavat toteutus ja [testausohje](../ai/testing-rules.md);
hyväksyntä ei ole koko sovelluksen tai kaikkien ohjeiden sisältökatselmus.

#### I:n säilytettävä CI-sopimus

[Hyväksytty rajaus ja alkuperäinen valmistelu](release-0.3.0-integration-history.md#in-säilytettävä-ci-sopimus)
säilyvät historiassa; nykyinen web-työn erillinen budjettipäätös on
[testausohjeessa](../ai/testing-rules.md#web-cin-kokonaisbudjetti).

#### I-P1: R30:n hyväksytty pienin muutos

[Hyväksytty polkulista ja sen perusteet](release-0.3.0-integration-history.md#i-p1-r30n-hyväksytty-pienin-muutos).

#### I:n toteutus- ja todistusjärjestys

[Alkuperäinen järjestys ja kohdenäyttö](release-0.3.0-integration-history.md#in-toteutus--ja-todistusjärjestys)
eivät avaa hyväksyttyä I:tä uudelleen.

### H / Diagnostiikan saatavuuden ja oikeellisuuden suunnitelma

**Hyväksytty:** H1-H5 ja niiden omat PR/main-portit
[PR #315:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918).
Alkuperäiset hylkäykset ja omistajan rajattu etenemispäätös on erotettu
hyväksytystä revisiosta yllä. H ei toteuttanut historian selausta tai
muuttanut tukipaketin formaattia.

Nykyiset tekniset velvoitteet omistavat
[Diagnostics](../modules/diagnostics.md),
[lokiretention](operational-log-retention-plan.md),
[tukipaketti](support-bundle-plan.md) ja
[tapahtumakatalogi](r0-observability-event-catalog.md).
[H:n hyväksytty suunnitelma ja päivätyt toteutuscheckpointit](release-0.3.0-integration-history.md#h--diagnostiikan-saatavuuden-ja-oikeellisuuden-suunnitelma)
säilyvät muuttamattomina historiassa. Siirto ei poista hyväksyttyä
sopimusta tai muuta sen turvallisuusrajoja.

<details>
<summary>H:n aiemmat osiot ja pysyvät linkit</summary>

<p><a id="hn-omistajat-ja-etenemisjärjestys"></a><a href="release-0.3.0-integration-history.md#hn-omistajat-ja-etenemisjärjestys">H:n omistajat ja etenemisjärjestys</a></p>
<p><a id="h-p1-hyväksytty-lukutilan-suunta"></a><a href="release-0.3.0-integration-history.md#h-p1-hyväksytty-lukutilan-suunta">H-P1: Hyväksytty lukutilan suunta</a></p>
<p><a id="h-p2-hyväksytty-writer-häiriön-palaute"></a><a href="release-0.3.0-integration-history.md#h-p2-hyväksytty-writer-häiriön-palaute">H-P2: Hyväksytty writer-häiriön palaute</a></p>
<p><a id="hn-pr-integraation-rajattu-jatko"></a><a href="release-0.3.0-integration-history.md#hn-pr-integraation-rajattu-jatko">H:n PR-integraation rajattu jatko</a></p>
<p><a id="hn-säilyvät-rajat-ja-valmistumisportti"></a><a href="release-0.3.0-integration-history.md#hn-säilyvät-rajat-ja-valmistumisportti">H:n säilyvät rajat ja valmistumisportti</a></p>

</details>

### G / Diagnostiikan tapahtumaketjun suunnitelma

**Tila:** G-P1/G-P2 ja G0-G4 hyväksytty PR #314:n ja uuden mainin
omilla porteilla 23.10.2026. Alla säilyy toteutuksen omistava sopimus.
[Roadmapin G](release-0.3.0-plan.md#m3-muut-invariantit-diagnostiikka-ja-ylläpidettävyys)
omistaa R20/R23:n ja D029-01/02:n rajauksen. Tavoite on täydentää nykyinen
turvallinen lukuketju, ei muuttaa laskutusta, päivitystä tai palautusta.
H:n saatavuus, retention, osittaisuus, writer-fallback ja uusimpien valinta
sekä M4:n historian selaus eivät kuulu tähän toteutukseen.

Rajattu riippumaton downstream-katselmus on tehty. Sen kaksi sopimuspuutetta
korjattiin suunnitelmaan: uuden workspace-eventin suljettu vastaanottotaulukko
ja G-eventtien/incidentien läsnäolon sekä semantiikan packaged-todistus.
Korjatuissa kohdissa ei jäänyt suunnitelmaestettä. Tämä on lähde- ja
suunnitelmakatselmus, ei omistajapäätös tai toteutuksen hyväksyntä.

Suunnittelun lähtökatselmus 22.10.2026 eteni UI:sta ja tukipaketista
strict-clientin, HTTP:n ja tiedostolukijan kautta todelliseen
writeriin/compositioniin. Tuolloin R20:n archive/update-katalogierot olivat
vielä lähteessä. K:n observer oli jo kytketty, mutta lineage-hylkäyksen
tarkka luokka ja muut kuin import/replace-virheet puuttuivat nimetystä
ketjusta. G korjasi nämä rajatussa sopimuksessaan; lähtöhavainto ei ole
nykyinen avoin toteutusjono eikä yksin korjauksen hyväksyntänäyttö.

#### G-P1: Hyväksytty projektiorajaus

Alla `D` tarkoittaa permission-suojattua Diagnostics-projektiota, `S`
sanitoitua tukipakettia. Alla oleva rajaus on hyväksytty toteutettavaksi.
S säilyttää nykyisen 30 päivän warn/error/security-valinnan, ei infoa.
Warn-tason onnistunut rollback-vaihe ei muutu failureksi eikä katoa vain
outcomen perusteella. Incident-indeksin nykyinen minimointi säilyy;
Activityyn tai business auditiin ei lisätä teknisiä tapahtumia.

| Perhe / nykyinen omistaja | D | S | Turvallinen sisältö ja nimetty poissulku |
| --- | --- | --- | --- |
| Backendin `invoicePdfArchive.queueFailed` / Invoicingin queue-failure-reporter | Kyllä | Kyllä | Nykyinen `INVOICE_PDF_ARCHIVE_QUEUE_FAILED`, `stage=queue`, `retryable=true`, `sideEffectState=none`; nykyinen runtime/build-konteksti. Ei business- tai dokumenttiviitteitä. |
| Desktopin `invoicePdfArchive.taskQueued` / archive-observer | Kyllä | Ei, info | Vain peruskentät ja nykyinen runtime/build-konteksti. Ei toimituksen tai kopion onnistumisväitettä. |
| Desktopin `invoicePdfArchive.copySucceeded` / archive-observer | Kyllä | Ei, info | Nykyinen kesto; detailed-lokin `attemptCount` tarkistetaan lähteessä mutta jätetään pois DTO:sta. Ei polkua tai PDF:n tiivistettä. |
| Desktopin `invoicePdfArchive.copyFailed` / archive-observer | Kyllä | Kyllä, warn | Nykyinen turvallinen koodi, kesto, retryable ja side-effect-state; `attemptCount` ei siirry DTO:hon. Ei muutosta laskutoimituksen tulokseen. |
| Desktopin `invoicePdfArchive.configurationChanged` / capability-callback | Kyllä | Ei, info | Vain `stage=enabled|disabled`; ei hakemiston nimeä tai polkua. |
| C2:n `update.operationStarted|operationCompleted|operationFailed` / historiallinen C2-sopimus | Kyllä | Nykyisen tason mukaan | Nimi ja `preUpdateRecovery|runtimeShutdown|installerHandoff|firstStartValidation` säilyvät; ei muunnosta C3C:n Succeeded-eventiksi eikä uutta rinnakkaista kirjoitusta. |
| C3C:n nimetyt Started/Succeeded/Failed-perheet / update-observer | Kyllä | Nykyisen tason mukaan | Alla nimetyt perheet, tapahtumakohtainen stage, nykyinen korrelaatio/kesto/koodi/retryable/side-effect-state. Ei journalista johdettua lisämetadataa. |
| `update.accepted|installerNotApplied|recoveryRequired` / update-state-observer | Kyllä | Nykyisen tason mukaan | Aidot nykyiset tilat; installer-exit tai handoff ei synnytä accepted-tulosta. |
| K:n `workspaceBackup.operationFailed|cleanupFailed` / workspace-observer | Säilyy | Säilyy | Nykyinen import/replace-sopimus ja ensisyyn/lisävirheen erottelu säilyvät; ei tuplakirjausta G:n vuoksi. |
| G-P2:n uusi `workspaceManagement.operationFailed` / nykyinen management-palvelu ja observer | Kyllä | Kyllä, error | Vain G-P2:ssa nimetty tekninen toiminto, vaihe ja syykoodi. Ei työtilan tunnistetta, labelia tai varmuuskopion nimeä. |

C3C:n täsmälliset perheet ovat `packageInspection`, `packageStaging`,
`currentPackageRegistration`, `candidateDiscard`, `confirmation`,
`recoveryPoint`, `runtimeShutdown`, `installerHandoff`,
`firstStartValidation`, `businessRollback`, `binaryRollback` ja
`restoreCompatibility`, kussakin nykyiset Started/Succeeded/Failed-nimet.
Nykyisen eventin `appVersion` säilyy. `currentVersion`, `targetVersion`,
`releaseChannel`, vapaa metadata, polut, journalit, manifestit, prosessien
argumentit ja raakavirheet rajataan pois. Uusia DTO-kenttiä tai
tukipakettiformaattia ei tarvita tämän rajauksen vuoksi.

#### G-P2: Hyväksytty workspace-virheen omistajuus

K:n inspection-virhe käyttää edelleen nykyistä workspaceBackup-perhettä.
Muu create/import/replace/switch/rename-hylkäys käyttää yhtä uutta
`workspaceManagement.operationFailed`-päätetapahtumaa, ei sen rinnalla
toista yleistä ensivirhettä. Tunnistettu lineage-hylkäys luokitellaan
ennen yleistä käyttäjävirhettä; käyttäjän viesti ja palautuksen esto säilyvät.
Todellinen erillinen cleanup-virhe kirjataan edelleen erikseen, ei ensisyyn
tilalle. Ennen toteutusta lukitaan haaravalinta testeillä myös silloin,
kun alkuperäinen syy on `unknown` tai operation guard estää työn.

Hyväksytty tapahtuma käyttää nykyisiä projektion kenttiä:

- `operationId` on suljetusti `workspace.create`, `workspace.import`,
  `workspace.replace`, `workspace.switch` tai `workspace.rename`, ei
  satunnainen business-ID tai työtilan tunniste.
- `stage` on `admission|operation|lineageCheck`. Viimeinen sallitaan vain
  alkuperäisen tyypitetyn replacement-lineage-hylkäyksen yhteydessä.
- `errorCode` on nykyinen `WorkspaceManagementErrorCode` tai täsmällinen
  `WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH`, ei poikkeuksen vapaa code/message.
  Koodi, toiminto ja vaihe tarkistetaan yhdessä; status-polling ei kuulu perheeseen.
- Korrelaatio, kesto ja build/runtime-konteksti käyttävät nykyisiä rajoja.
  Retryable ja sivuvaikutus eivät vahvistu jälkikäteen; epävarma tila pysyy
  epävarmana. Tunnistamatonta sisäistä syytä ei arvata tarkemmaksi.

Uuden tapahtuman vastaanottosopimus on suljettu:

| Kenttä / yhdistelmä | Hyväksytty täsmällinen sääntö |
| --- | --- |
| Kiinteät arvot | `eventName=workspaceManagement.operationFailed`, `component=desktop`, `category=workspaceManagement`, `level=error`, `outcome=failure`. |
| Pakollinen payload | UUID-`correlationId`, kokonaisluku `durationMs >= 0`, yllä nimetty `operationId`, `stage`, `errorCode`, boolean-`retryable` ja `sideEffectState=none|unknown`. |
| Busy | `WORKSPACE_MANAGEMENT_BUSY`, mikä tahansa viidestä toiminnosta, `stage=admission|operation`, `retryable=true`. |
| Invalid / recovery required | `WORKSPACE_MANAGEMENT_INVALID|WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED`, mikä tahansa viidestä toiminnosta, `stage=operation`, `retryable=false`. |
| Toimintokohtainen yleisvirhe | `WORKSPACE_MANAGEMENT_CREATE_FAILED`, `WORKSPACE_MANAGEMENT_IMPORT_FAILED`, `WORKSPACE_MANAGEMENT_REPLACE_FAILED`, `WORKSPACE_MANAGEMENT_SWITCH_FAILED` tai `WORKSPACE_MANAGEMENT_RENAME_FAILED`; vain vastaavalle `workspace.*`-toiminnolle, `stage=operation`, `retryable=false`. |
| Väärä lineage | Vain `WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH` + `operationId=workspace.replace` + `stage=lineageCheck`, `retryable=false`. |
| Sivuvaikutuksen muunnos | Vain havaittu `none` säilyy `none`:na. Muu epävarma virhetila on `unknown`; sisäistä onnistumisen `completed`-arvoa ei muunneta `committed`-arvoksi. Valmis onnistumistapahtuma ei kuulu perheeseen. Vastaanottaja torjuu `completed`, `committed` ja `rolledBack`. |
| Valinnaiset yhteiskentät | Nykyisen projektion validoidut `appVersion`, `buildRevision`, `runtimeInstanceId`; lähteen writer-identiteettivaatimus säilyy. Uusi perhe ei salli fingerprintiä, entity-kenttiä tai toisen perheen metadataa. |
| Tapahtuman peruskentät | Nykyiset validoidut tapahtumatunniste ja UTC-aika säilyvät; ei vapaata payload-objektia tai uusia yksilöiviä kenttiä. |

Backend-projektori, strict-client ja mainin tukipakettivastaanotin
tarkistavat saman tapahtumakohtaisen sopimuksen. Niiden regressiot
torjuvat väärän komponentin, kategorian, tason, outcomen, koodi/toiminto/
vaihe-yhdistelmän, puuttuvan pakollisen kentän ja väärän sivuvaikutuksen.

Management-toimintojen uusien aloitus- ja onnistumistapahtumien julkinen
projektointi rajataan pois tästä toteutuksesta; normaalin onnistumisen
toimivuus ja observerin vaikutuksettomuus silti testataan. Uusi perhe ei
ole uusi palvelu, journal tai logger. Mahdollinen observerin nimikorjaus
tehdään nykyisen omistajan sisällä vasta korvaavan kattavuuden kanssa.

#### G:n tiedostot ja toteutusjärjestys

**Hyväksytty 23.10.2026:** G0-G4:n toteutus, paikallinen ketju- ja
pakettinäyttö sekä riippumaton katselmus ovat mukana PR #314:n
[loppuhyväksynnässä](https://github.com/eky-software/eky/pull/314#issuecomment-6356610094).
PR:n ja uuden mainin omat portit ovat yllä. Alla oleva taulukko säilyttää
toteutuksen omistajat ja todennussopimukset; se ei ole avoin toteutusjono.
Päivätty paikallinen [toteutuscheckpoint](release-0.3.0-integration-history.md#aiempi-g-toteutuscheckpoint)
ja ensihylkäykset säilyvät erillisinä historiatietoina.

| Pala | Nykyiset omistajat / suunniteltu muutos | Todennus |
| --- | --- | --- |
| G0 | Tämä M1-suunnitelma, roadmap ja diagnostiikan täydennyssuunnitelman lukureitti | G-P1/P2:n päätös, rajattu riippumaton käänteinen katselmus ja linkit; ei tuotantomuutosta. |
| G1 | Backendin `diagnosticOperationalEventProjector.ts`, api-clientin `diagnosticsTypes.ts`/`diagnosticsResponse.ts`, mainin `supportBundleBackendData.ts`; tarvittaessa vastuun sisäiset projektiotiedostot | Writerin oikeista archive-tapahtumista HTTP/UI- ja tukipakettiketju; queueFailed ei enää kaada koko strict-vastausta. Ei yleistä validointiohitusta. |
| G2 | Samat lukijat ja nykyinen update-observer/catalog | Jokainen yllä nimetty update-perhe, oikea taso/outcome/stage ja pakolliset kentät; C2/C3C pidetään erillisinä. |
| G3 | `workspaceManagementService.ts`, `workspaceManagementTypes.ts`, nykyinen observer/composition ja event-/projektiovalidaattorit | Oikean koostamisen lineage-hylkäys ennen leasea/sulkua/kirjoituksia, yksi ensivirhe, erillinen cleanup, normaalit toiminnot ja writerin häiriö. |
| G4 | Nykyinen tukipakettivastaanotin, virallinen tarkastin, Diagnostics-UI ja nykyiset E2E/packaged-fixturet | Aidosti tuotettu artifacti sisältää nimetyt G-tapaukset; tarkistetaan jokainen G-event ja soveltuva G-incident-yhteenveto, ei vain vanhaa smoke-sentineliä tai tyhjää G-joukkoa. |

Kenttäsäännön omistaja pysyy nykyisessä moduulissa. Backend, API-client ja
desktop eivät importoi toistensa sisäisiä runtime-tyyppejä oikopolkuna.
Katalogitestissä jokaisella tarkoitetulla tapahtumalla on hyväksytty
projektio tai nimetty poissulku; tuntematon tapahtuma ei läpäise strict-clientiä.
Kenttämatriisi testataan alhaalla ja edustava oikea ketju korkeammalla;
kaikkia käyttötapauksia ei toisteta jokaisella testitasolla.

Packaged-todennus vaatii edustavat archive queue/copy-failure-, update-
failure- ja väärän lineagen workspace-failure-rivit tuotetusta artifactista
sekä vähintään yhden error-tason G-incident-yhteenvedon. Diagnosticsissa
todennetaan myös sovittu update-success. Info-eventtien ja kielletyn
metadatan poissulut tarkistetaan nimenomaisesti; puuttuva G-aineisto ei ole
onnistuminen. Negatiivisessa kontrollissa kelvolliset vanhat sentinelit
säilyvät, mutta G-event tai G-incident muutetaan virheelliseksi ja checksumit
lasketaan uudelleen. G:n semanttisen packaged-tarkistuksen on silti hylättävä
artifacti ilman raakasisällön tulostamista. Tämä ei muuta virallisen
tarkastimen alla erotettua säiliösopimusta.

G4 jatkaa nykyisiä kytkentöjä. `packagedSmoke.ts` kirjoittaa nimetyt
lukuketjun fixture-tapahtumat ennen Diagnostics-näkymää ja tukipakettia.
`packagedSupportBundleSmoke.ts` säilyttää vanhat sentinelit ja checksumit,
mutta käyttää lisäksi nykyistä strict-vastaanotinta jokaiseen riviin ja
vaatii G-incidentille vastaavan error-tapahtuman. UI:n tarkistus vaatii
`update.accepted`- ja warn-tason `update.businessRollbackSucceeded`-riveille
onnistumistekstin. System-testin `OBS-DIAGNOSTIC-CHAIN-001` nykyiset backend-
ja desktop-kirjoittajat kulkevat oikean HTTP:n ja gzip-tuotannon kautta.
Packaged-fixturen backend-rivi on suora tiedostosyöte, ei uusi mainin
backend-importti. Näitä kirjoittaja-/lukuketjun todisteita ei nimetä
käyttötapauksen tuotantokytkennän todisteiksi; G1:n ja G3:n composition-
testit sekä paketoidun UI:n näyttö säilyvät erillisinä. Ei uutta testialustaa.

Testit kattavat myös vanhat kelvolliset eventit, puuttuvan oikeuden,
virheellisen kenttätyypin, väärän perheen payloadin, symlink/polkurajan sekä
salaisuuksien, yritystunnisteiden, raakavirheiden ja PDF-sisällön poissulun.
K:n palautus- ja F:n HTTP-regressiot säilyvät; niitä ei korvata G-testeillä.
Mahdollisen uuden virhemuunnosrajan testihavaitsija kytketään ennen
muunnosta nykyiseen ensivirhekeräykseen, ja odottamattoman hylkäyksen syy
varmennetaan oikealla salaus/purku-kokeella. Odotettu virhetesti ei luo
uutta virheraporttia eikä tuotantoon lisätä raakakeräystä.

Virallisen `support:inspect`-tarkastimen nykyinen säiliö-/checksum-sopimus
ja historiallisten pakettien lukuyhteensopivuus erotetaan G:n tuottajan
tapahtumakohtaisesta hyväksynnästä. Checksum ei todista eventin semantiikkaa
tai tietojen minimointia. Tarkastimen mahdollinen tiukennus arvioidaan
erikseen ennen vanhojen pakettien hyväksymiskäytöksen muuttamista.

Valmistuminen vaatii kohderegressiot, vaikutusalueen testit, tyyppi/build-
tarkistukset, todellisen lukuketjun ja riskin mukaisen Windows packaged-
näytön. Backup/lifecycle-/profiilirajaan koskettaessa root-ohjeen
backup -> inspect -> restore -> restart -> compare säilyy; installerin
portti on siitä erillinen. Lopuksi rajattu riippumaton katselmus,
julkaisuyksityisyys, saman jäädytetyn PR-headin nykyiset portit ja auditointi,
normaali suojattu merge sekä uuden mainin omat portit. Uusi riippuvuus,
formaatin/retentionin muutos tai hyväksyntäehtojen lievennys ei kuulu lupaan.

### F / Frameworkin virheketjun rajattu suunnitelma

**Tila:** hyväksytty PR #313:n ja uuden mainin omilla porteilla 22.10.2026.
Näyttö on [F:n loppuhyväksynnässä](https://github.com/eky-software/eky/pull/313#issuecomment-6339105977).
Alla säilyy F:n omistava toteutussopimus ja sitä edeltävä todennushistoria,
ei uusi toteutusjono.
Paikallinen HTTP-korjaus, oikean `createApp`-kytkennän Diagnostics-/
tukipakettiluku sekä alkuperäisen testivirheen OpenPGP-purku on todennettu.
Koko työtilan testit ja tyypitys, backend-build, auditointi ja CI-ajokytkennän
regressiot läpäisivät. Riippumattoman katselmuksen finalisointiaukko toistettiin
ja korjattiin; lopullinen backend-sarja ja tyypitys läpäisivät.
Paikalliset tarkistukset eivät yksin olleet PR- tai main-hyväksyntä;
revision omien porttien erillinen loppuhyväksyntä on yllä.

Ensimmäisen PR-kierroksen kaksi web-virhepolkua odottivat vanhaa
virheellisen JSON-vastauksen ilmoitusta. F:n kiinteä JSON 500 kulkee nykyisen
API-clientin kautta toimintokohtaiseen turvalliseen suomenkieliseen
virheeseen. Korjaus tarkistaa sekä täsmällisen turvallisen JSONin että tämän
palautteen; PDF-metadatan, hyväksynnän rollbackin ja lokien ehdot säilyvät.
Ensihylkäystä ei hyväksytä uusinnalla, vaan muuttuneet testiodotukset
todennetaan uudella revisiolla.
R15:n lähtörevision lähdekoodi ja
rajattu synteettinen Hono-ketju vahvistavat, että frameworkin oletuskäsittelijä
saa alkuperäisen poikkeuksen konsoliin ennen EKYn middleware-catchia.
Turvallinen HTTP-vastaus ja operational-event eivät yksin sulje tätä vuotoa.
Kokeen onnistuminen todistaa puutteen, ei tuotantokorjausta.

Omistaja on backendin HTTP-adapteri, ei domain, moduulien application-kerros
tai uusi lokitusjärjestelmä. Sopimukset luetaan [virheperiaatteista](error-handling-principles.md),
[observability-ohjeesta](observability-and-audit-plan.md),
[HTTP-tapahtumakatalogista](r0-observability-event-catalog.md#http-ja-authorization)
sekä ADR-[0004](../decisions/ADR-0004-local-backend-runtime.md)/[0005](../decisions/ADR-0005-backend-framework-selection.md):stä.

Hyväksytty toteutussopimus:

1. `apps/backend/src/http/app.ts` kytkee nykyiseen Hono-instanssiin rajatun
   oman `onError`-käsittelijän ennen reittien kokoamista. Odottamaton poikkeus
   palauttaa kiinteän HTTP 500 / `{ error: "Internal server error." }`
   -vastauksen. Raakaa poikkeusta, sen `getResponse`-metodia, viestiä, pinoa,
   syyketjua tai otsakkeita ei kopioida vastaukseen eikä konsoliin.
2. `operationalLogging.ts` säilyy pyynnön operational-tapahtuman omistajana.
   Se erottaa frameworkin käsittelemän poikkeuksen normaalisti palautetusta
   5xx-vastauksesta nykyisillä `HTTP_HANDLER_FAILED`-/`HTTP_REQUEST_FAILED`-
   luokilla, säilyttää validoidun korrelaation ja sallitun toiminto-/vaihetiedon
   sekä yrittää kirjata enintään yhden `http.requestFailed`-tapahtuman.
   Myös muu kuin `Error`-olio päättyy samaan turvalliseen vastausrajaan.
   Ilman vastausta päättyvä käsittelijä tunnistetaan ennen middlewaren
   poistumista, jotta myöhempi frameworkin finalisointivirhe ei ohita
   korrelaatiota tai tapahtumaa.
3. HTTP-tapahtuman kirjoituksen virhe ei käynnistä rekursiivista kirjausta,
   palauta raakaa virhettä tai muuta jo valittua business-vastausta.
   Rajaus kattaa myös `logUnknownRoute`-kutsun ja `createApp`-kytkennän
   `invalidSession`-/`missingSession`-callbackit: lokituksen häiriö ei saa
   muuttaa niiden 404- tai session-estovastausta. Kirjoituksen epäselvää
   lopputulosta ei korjata uudella kirjoitusyrityksellä.
   Nykyinen writerin häiriöreitti säilyy; G/H:n yleistä fallback- tai
   kattavuustyötä ei toteuteta F:n sivutyönä.
4. Moduulien jo turvallisiksi vastauksiksi muunnetut 400/401/403/404/409/413/415-
   ja 5xx-polut sekä onnistuneet vastaukset säilyvät. Muutos ei keskitä niiden
   liiketoimintavirheiden tulkintaa. Nykyisessä tuotantolähteessä ei löytynyt
   tarkoituksellista `HTTPException`-käyttöä; sitä ei lisätä oikopoluksi.

Testit ja valmistumisportti:

- `operationalLogging.test.ts`: oikea Hono-dispatch, tavallinen ja async-
  poikkeus sekä heitetty merkkijono, objekti, `null` ja `undefined`.
  Käsittelemätön poikkeus tuottaa toimivalla writerilla yhden
  `HTTP_HANDLER_FAILED`-tapahtuman; turvalliseksi vastaukseksi jo muunnettu
  5xx tuottaa vain `HTTP_REQUEST_FAILED`-tapahtuman. Tarkista korrelaatio,
  konsolin kutsujen sisältö ja se, ettei poikkeuksen `getResponse`-metodia
  kutsuta. Pelkkä `console.error`-vaimennus ei ole hyväksyntä.
- Writerin poikkeus ennen tallennusta ja sen jälkeen: vastaus säilyy eikä
  uutta kirjoitusyritystä, rekursiota tai raakakonsolitulostetta synny.
  Häiriötestit kattavat myös 404- ja session-kirjaukset.
- `apps/backend/src/http/`-alueen composition-testi käyttää oikeaa
  `createApp`-kytkentää ja synteettistä aineistoa. Käsittelemätön poikkeus
  viedään tämän kytkennän läpi ilman testin omaa korvaavaa `onError`-
  rekisteröintiä. Tunnetut virheet, session-esto, 404 ja onnistuminen
  säilyvät ilman uusia tuotannon testireittejä.
- Käytä nykyistä JSONL-writeria ja tarkoitettuja Diagnostics-/tukipakettilukijoita
  edustavan HTTP-eventin todentamiseen. Kenttäsopimuksia ei laajenneta;
  Activityyn tai business auditiin ei lisätä teknistä virhettä.
- Synteettinen alkuperäinen virhe tarjotaan nykyiselle yksityiselle
  testihavaitsijalle ennen turvallista muunnosta. Kytkentä ja oikea
  salaus/purku todennetaan nykyisen [testausohjeen](../ai/testing-rules.md#alkuperäinen-testivirhe-oletuksena)
  ja [salatun aineiston sopimuksen](ci-encrypted-evidence.md) rajoissa;
  tavalliseen käyttäjäajoon ei avata raakakeräystä. Havaitsijan oma virhe
  ei muuta vastausta; odotettu virhetesti ei tuota virheraporttia.
  Odottamattoman hylkäyksen purettu aineisto todistaa alkuperäisen syyn
  sidonnan testitapaukseen, suoritusyritykseen ja käynnistyssukupolveen.
- Kohderegressiot, vaikutusalueen testit, tyypitys ja build, riippumaton
  rajattu katselmus sekä täsmällisen revision nykyiset PR/main-portit ja
  auditointi vaaditaan ennen F:n hyväksyntää. CI-riskiluokitusta ei muuteta.

Toteutus pysyy tässä rajauksessa. Ei uusia riippuvuuksia,
tietokanta-/backup-muutoksia, yleistä error-manageria, testialustaa,
salaisuuksia, oikeaa asiakasdataa, verkon avaamista tai aikarajamuutoksia.
Mahdollinen uusi luottamusraja tai tulossopimus tuodaan erikseen päätettäväksi.

### Edeltävien integraatioiden historia

Alla olevat keskeneräisyys- ja seuraavan työn merkinnät kuvaavat aiempia
revisioita, eivät nykyistä työjonoa. Sopimukset ja avoimet havainnot säilyvät.

**Hyväksytty lähtö (21.10.2026):** D1-D3 ja niiden rajattu HTTP-sulun
jatkokorjaus on hyväksytty PR #308:n ja PR #309:n kautta mainiin
`286cc3227ffe37dd44417750636ec30d460a61e1`.
[D:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/309#issuecomment-6324156808)
erottaa alkuperäisen main-hylkäyksen, toistetun sovelluspuutteen korjauksen
sekä uuden revision omat hyväksytyt portit. Mainin puu vastaa hyväksyttyä
PR-headia `33fd0bdb19709329721a87838b3f7d933552d4b9`.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR #309:n portit | [V2](https://github.com/eky-software/eky/actions/runs/39646188806): 27 onnistunutta työtä, kuusi tarkoituksella valitsematonta diagnostiikkatyötä. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39646188607) läpäisi. Molemmat ensimmäisellä suoritusyrityksellä. |
| Mainin omat portit | [V2](https://github.com/eky-software/eky/actions/runs/39652297393): 38 onnistunutta työtä, kuusi tarkoituksella valitsematonta diagnostiikkatyötä, kaikki 11 porttia ja kaksi vaadittua toistoa. [Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39653254508) läpäisi; HTTP-muutoksen polkurajauksen vuoksi käynnistettiin yksi erillinen ajo täsmälliselle mainille. Molemmat ensimmäisellä suoritusyrityksellä. |

**Nykyinen työ on E:n rajattu integraatiojatko (22.10.2026).**
R09-R11 on yhdistetty [PR #311:ssä](https://github.com/eky-software/eky/pull/311)
mainiin `d03e9a15a5c04e3d9fe56e81a69fda5e795b8e05`.
PR:n omat portit läpäisivät, mutta mainin erillinen auditointi hylkäsi
olemassa olevan Vitest-kehitystyökalun. Omistaja hyväksyi rajatun
Vitest `4.1.11 -> 4.1.12` -korjauksen ja normaalit tarkistukset;
E:n kokonaishyväksyntä on vielä avoinna. Ensihylkäystä tai erillisiä
toimintatestihavaintoja ei kuitata korjatuiksi työkalupäivityksellä.
[Toteutus- ja testisuunnitelma](release-0.3.0-customer-invariants-plan.md)
kirjaa hyväksytyn R09-eston myös passiivisten taloyhtiöiden viittauksille,
numeroinnin tarkkuuden, turvallisen virhepalautteen ja auditointiesteen
rajatun jatkon. Päivätty toteutuscheckpoint ja lopullinen PR/main-readback
pidetään erillään. Viimeisin kokonaan hyväksytty lähtö säilyy
[PR #310:n mainissa](https://github.com/eky-software/eky/pull/310#issuecomment-6325552971)
`5e338ae74bb48130620c9db514bbe52a2e787782`.
E:n lopullinen hyväksyntänäyttö kirjataan integraation PR-yhteenvetoon.
T/A/B/C/K/D säilyvät hyväksyttyinä; niitä
ei avata uudelleen historiallisten keskeneräisyysmerkintöjen perusteella.
Tämä ei hyväksy muita paketteja tai koko `0.3.0`-julkaisua.

**Avoimet havainnot:** aiempien MSI-odotusten estäjät ja vanhojen
sulkuviiveiden täsmälliset syyt jäävät avoimiksi. Ensivirheet, puuttuva
aineisto ja tuntemattomat siivoustilat säilyvät alla kuvattuina. Dependabotin
hälytykset 33-37 olivat loppulukemisessa vielä avoimia, vaikka main käyttää
niiden ilmoittamia korjattuja Hono 4.13.11- ja Vite 8.2.4 -versioita ja
auditointi läpäisi. Hälytysten sulkeutumista ei ole vahvistettu.

**Hyväksytty lähtö (17.10.2026):** jatkamissivun dokumentointikorjauksen
PR #307 on yhdistetty `main`-revisioon
`da93cf53b7c608f825629d60404dce4c839dcb6a`.
Hyväksytty PR-head on `5d60ef37d7dba60ccc4b45df0365f613966af803`;
mainin puu vastaa sitä.
[PR #307:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/307#issuecomment-6232246050)
kirjaa erilliset PR- ja main-portit. Ohjehuollon edellinen
[PR #306:n hyväksyntänäyttö](release-0.3.0-integration-history.md#ohjehuollon-hyväksyntä-16102026)
säilyy historiassa.

| Tarkistus | Hyväksytty näyttö |
| --- | --- |
| PR:n V2 | [`39017851936`](https://github.com/eky-software/eky/actions/runs/39017851936), ensimmäinen suoritusyritys: dokumenttimuutoksen 7 valittua työtä läpäisivät, 7 jäi tarkoituksella valitsematta. |
| PR:n riippuvuustarkistus | [`39017851905`](https://github.com/eky-software/eky/actions/runs/39017851905) läpäisi. |
| Mainin V2 | [`39018548493`](https://github.com/eky-software/eky/actions/runs/39018548493), ensimmäinen suoritusyritys: 38 onnistunutta työtä ja 6 tarkoituksella valitsematonta diagnostiikkatyötä. |
| Mainin riippuvuustarkistus | [`39018585375`](https://github.com/eky-software/eky/actions/runs/39018585375) läpäisi täsmälliselle main-revisiolle; käynnistettiin erikseen dokumenttimuutoksen polkurajauksen vuoksi. |

I-paketin aikaistettu ohjehuolto ja sen hyväksytyt integraatiokorjaukset ovat
valmiit tässä rajauksessa. T/A/B/C/K säilyvät hyväksyttyinä; niitä tai
ohjehuoltoa ei toteuteta uudelleen vanhojen keskeneräisyysmerkintöjen vuoksi.
Tämä ei hyväksy koko I:tä, D:tä tai `0.3.0`-julkaisua. Uuden muutoksen
omat hyväksyntäportit säilyvät.

**Avoimet havainnot säilyvät avoimina:**

- Edeltävän `b289a434`-mainin ajastettu V2 `39012174529` hylkäsi
  MSI-ikkunahavainnon stderr-sopimustestin ja yhden flakyksi jääneen
  web-testin. Ensivirheet ja saatavilla oleva salattu aineisto säilyvät.
  PR #307:n dokumenttimuutos tai uuden mainin läpäisy ei korjannut näiden
  alkuperäistä syytä. Tämä oli eri ajo kuin PR #306:n hyväksytyt push-portit.
- PR #306:n ensimmäisen V2-yrityksen legacy-toisto peruttiin 37 minuutin
  työrajalla. Sen oma loki ja salattu virheaineisto eivät valmistuneet;
  alkuperäinen syy ja siivoustila jäävät tuntemattomiksi. Yksi erikseen
  hyväksytty rajattu uusinta läpäisi muuttumattomalla lähteellä ja samoilla
  paketeilla. Se ei muuta alkuperäistä ajoa onnistuneeksi tai korjatuksi,
  eikä anna lupaa uusiin uusintoihin.
- Aiempien MSI-odotusten estäjäidentiteetti, Electron-relaunchin alkuperäinen
  syy, MSI-luettelon alkuperäiset osittaiset havainnot ja
  `blockedEvidence`-testin alkuperäinen ajoitussyy eivät selvinneet
  myöhemmistä läpäisyistä tai havaintoketjun korjauksista.
- Aiemman `recorded`/`timedOut`-hylkäyksen syy, alkuperäisen
  käännösvirheen puuttuva tuloste ja API-katkoksen syy säilyvät niiden
  omissa historiallisissa rajauksissa. Uusi `ETIMEDOUT`-luokitus ei
  jälkikäteen todista vanhan käännöshylkäyksen syytä.

[Aiemmat ohjehuollon ajokierrokset ja niiden rajaukset](release-0.3.0-integration-history.md#ohjehuollon-integraatiokierrokset-16102026)
ovat integraatiohistoriaa, eivät rinnakkainen työjono. Ensivirheiden
säilytysrajat, puuttuvan aineiston tiedot ja erilliset etenemispäätökset
säilyvät; tämä dokumentointikorjaus ei hyväksy uusia poikkeuksia.

**D:n hyväksyntää edeltävä integraatiotilanne:** [D:n toteutus](release-0.3.0-company-settings-plan.md).
PR #308:n `a5899a84`-head läpäisi [V2:n](https://github.com/eky-software/eky/actions/runs/39631941135)
(38 onnistunutta työtä, kuusi tarkoituksella valitsematonta diagnostiikkatyötä)
ja [riippuvuustarkistuksen](https://github.com/eky-software/eky/actions/runs/39631941030).
[Normaalin mergen hyväksyntä](https://github.com/eky-software/eky/pull/308#issuecomment-6321513979)
koskee täsmällistä PR-headia, ei automaattisesti uutta mainia `597cc8cf`.
Mainin [oma V2](https://github.com/eky-software/eky/actions/runs/39638415671)
hylkäsi Electronin ensikäynnistyksen alkuvalmistelun ensimmäisen yrityksen;
uusinta läpäisi, mutta työ jäi flakyksi. [Mainin riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39638415424)
läpäisi. D:n integraatio pysyy avoimena.

Uusi keräys säilytti ennen siivousta backendin sulun aloituksen sekä
alkuperäisen `backend/notGraceful`-syyn salattuun pakettiin. Rajattu
HTTP-regressio toisti sulun jälkeen joutilaaksi muuttuvan keep-alive-yhteyden
viiveen. Nykyisen HTTP-adapterin korjaus sulkee vain käyttämättömät yhteydet
vastauksen valmistumisen jälkeen; aktiivinen työ ja auditin portti säilyvät.
Vaikutusalueen regressiot, koko työtilan testit ja tyypitys, molemmat nimetyt
Electron-polut ilman uusintoja sekä rajattu katselmus läpäisivät. Seuraavaksi
vaaditaan saman puhtaan paketin palautustodennus ja uuden revision normaalit
PR/main-portit.
Historiallista MSI-estäjää tai mainin täsmällistä sulkuviiveen syytä ei vielä
merkitä ratkaistuksi tämän paikallisen löydön perusteella.

**Edeltävä keräyskorjaus ja sen lähtöhylkäys:** PR #308:n `8c25d9b2`-revision
[V2-kierros](https://github.com/eky-software/eky/actions/runs/39588909072)
päättyi hylättynä: 35 onnistunutta työtä, kolme hylkäystä koonti mukaan
lukien ja kuusi tarkoituksella valitsematonta diagnostiikkatyötä.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39588908925)
läpäisi. Electronin kaksi alkuvalmistelun sulkua hylättiin ensimmäisellä
yrityksellä; automaattiset uusinnat läpäisivät, mutta työ jäi flakyksi.
Erillinen workspace-success-toisto pysähtyi asentimen sulkemispyyntöön.
Prosessipuun ja asennusjälkien siivous varmennettiin, mutta asennuksen
sisältöhyväksyntä jäi tekemättä. Keruun työbudjetti ei enää loppunut;
valituille tiedostoille ei havaittu käyttäjäprosessia. Estäjän identiteetti
ja Electronin alkuperäisen sulkuviiveen syy säilyvät avoimina.

Rajattu jatkokorjaus käyttää myös ensikäynnistyskokeessa nykyistä sulkuvirheen
syysiirtoa sekä ottaa ensimmäisen setup-/testirunkovirheen backend-vaiheotteen
ennen siivousta. Aiempi käynnistysvirheen ote ei korvaudu. Keräys käyttää
nykyistä rajattua lukijaa ja salattua toimitusta; sovelluksen sulkua,
hyväksyntäehtoja tai aikarajoja ei muuteta. Kohderegressiot, tyypitys,
oikea salaus/purku ja molemmat nimetyt Electron-polut läpäisivät.
Tämä todistaa keräyskorjauksen, ei historiallisten viiveiden korjausta.
Tämän keräyskorjauksen PR-portit ja merge valmistuivat yllä kuvatusti;
mainin oma hylkäys pitää D:n hyväksynnän avoimena.

**Edeltävien kierrosten näyttö:** `02a93d71`-revision [V2-kierros](https://github.com/eky-software/eky/actions/runs/39552315208)
hylättiin asentimen sulkemispyynnön odotukseen; riippuvuustarkistus läpäisi.
Täsmällinen estäjäidentiteetti on avoin. Omistaja hyväksyi 21.10.2026 vain
nykyisen tiedostokäyttäjähavainnon 1 -> 10 sekunnin työbudjetin,
kohderegressiot, todellisen salaus/purku-ketjun ja yhden nimetyn
Windows-kokeen samoilla asennuspaketeilla. Keruukorjauksen kohdetestit,
oikea OpenPGP-ketju ja rajattu katselmus läpäisivät. Revision `3d48ac1c`
[nimetty Windows-koe](https://github.com/eky-software/eky/actions/runs/39586937937)
läpäisi samoilla asennuspaketeilla, pakollisella tulosvarmennuksella ja
siivoustodisteella. Seuraavaksi vaaditaan nykyisen PR-revision normaalit
portit ja mergen jälkeen mainin omat portit. Vanha estäjäidentiteetti pysyy avoimena.

PR #308:n `a4e14bc3`-revision ensimmäinen
[V2-kierros](https://github.com/eky-software/eky/actions/runs/39515111216)
ja [riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39515111131)
hylättiin. Migraatioaktivoinnin hallitun sulun D2-kytkentä on korjattu ja
todennettu kohdetesteillä sekä samalla oikealla Electron-polulla. Desktopin
koko testikomento, tyypitys ja rajattu katselmus läpäisivät. Erillinen
asentimen odotushavainto säilyy avoimena; sitä ei nimetä samalla korjatuksi.
Omistajan hyväksymä
rajattu Hono/Vite/Rolldown-päivitys läpäisi auditoinnin ja kohdetestit.
Puhtaan `fad384a2`-paketin palautusketju läpäisi, samoin sen
[riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39521078818).
[Seuraava V2-kierros](https://github.com/eky-software/eky/actions/runs/39521078890)
hylättiin: 29 työtä läpäisi, viisi hylättiin koonti mukaan lukien,
kahdeksan jäi valitsematta ja yksi peruttiin kokonaisaikarajaan.
Omistaja hyväksyi rajatun ikkunahavainnon, supervisorin absoluuttisen
odotusrajan ja Electronin sulkuvirheen syynvälityksen selvityksen sekä
kohdekokeet. Näistä ei päätellä, että vika olisi vain testeissä.
Viimeisen workspace-success-ajon oma loki ja salattu aineisto jäivät
puuttumaan; sen syy ja siivoustila ovat tuntemattomat. Toisen toiston ja
molempien fault-toistojen läpäisyt eivät korvaa tätä näyttöä.
Omistaja hyväksyi tämän jälkeen ikkunatestin täsmällisen kylmän
provider-aikakatkaisun valmisteluehdon sekä jatkamisen Goalin normaaleihin
portteihin. Näiden korjausten puhdas `bf697a40`-paketti ja sen palautusketju
läpäisivät. Revision [V2-kierros](https://github.com/eky-software/eky/actions/runs/39543955790)
valmistui: 36 työtä läpäisi, kaksi hylättiin koonti mukaan lukien ja kuusi
diagnostiikkatyötä jäi tarkoituksella valitsematta.
[Riippuvuustarkistus](https://github.com/eky-software/eky/actions/runs/39543955762)
läpäisi. Sovelluksen Electron-, asennus-, päivitys- ja palautustyöt läpäisivät;
supervisorin ensimmäinen toisto hylkäsi MSI-ikkunafixturen
`largeListBounded`-tarkistuksen. Alkuperäinen salattu aineisto säilyi,
mutta siinä oli vain tarkistuksen nimi, ei hylätyn näytteen tietoja.
Seuraava rajattu muutos säilyttää viimeisen havainnon nykyisessä
virhekuittiketjussa. Pakotettu native-virhe todensi lisäotteen oikean
salauksen ja purun läpi; tämä ei vielä selitä alkuperäistä hylkäystä.
Uuden revision PR-portit, merge ja main-portit ovat avoinna.
Ensivirheet säilyvät, eikä uuden korjauksen näyttö selitä vanhoja timeouteja.

`b93f4b3c`-revision [V2-kierroksen](https://github.com/eky-software/eky/actions/runs/39547900136)
molemmat supervisor-toistot läpäisivät. Web-käyttäjätesti hylättiin ennen
käyttäjäpolun alkua: alkuperäinen salattu prosessituloste osoitti backendin
ja Viten käyttäneen samaa porttia. Selainfixture valitsi molemmat vapaat
porttinumerot ennen backendin käynnistystä. Rajattu korjaus valitsee
web-portin vasta valmiin backendin jälkeen. Hallittu järjestysregressio
hylkäsi vanhan lähteen; korjauksen 71 elinkaarikoetta ja tyypitys läpäisivät.
Myös kuusi oikeaa selainpolkua ja rajattu riippumaton katselmus läpäisivät.
Kierros päättyi 35 onnistuneeseen työhön, kolmeen hylkäykseen koonti mukaan
lukien ja kuuteen valitsemattomaan diagnostiikkatyöhön. Toinen hylkäys oli
workspace-fault-toiston `binaryRollbackFailure`-skenaarion määräaika:
asentimen sulkemispyyntö odotti vastausta. Ikkunahavainto säilyi, mutta
estäjäprosessin täsmällinen omistajuus jäi varmistamatta. Prosessipuun ja
asennusjälkien siivous varmennettiin; skenaarion sisältöhyväksyntä jäi
tarkistamatta. Tätä MSI-havaintoa ei nimetä web-porttikorjauksen korjaamaksi.
Uuden korjausrevision normaali PR/main-hyväksyntä on avoin.
Automaattinen uusinta kulutti tämän web-hylkäyksen
uusintakiintiön; korjauksen todennus ei ole saman lähteen uusi uusinta.
Manuaalisen endurance-kuluttajan vastaava porttien ennakkovalinta jäi
tämän normaalin web-fixturen korjauksen ulkopuolelle erilliseksi jatkotyöksi;
stress-todennusta ei väitetä tehdyksi.

Omistaja hyväksyi 17.10.2026 D-P1:n epäselvän salaisuusoperaation
jatkotavan ja D-P2/A:n nykyisen saatavuussäännön säilyttämisen.
D1:n alkuluvun tallennusesto on toteutettu ja sen rajattu web-,
selainkomponentti- sekä aiemman tallennus-/audit-polun todennus läpäisi.
[D1:n kohdenäyttö](release-0.3.0-company-settings-plan.md#d1n-kohdenäyttö-ja-seuraava-työ)
erottaa tämän koko D:n hyväksynnästä. D2:n 11 tapauksen lähtökoe toisti
nykyisen brokerin epäselvän tuloksen ja sulkemisen riskit, ei niiden korjausta.
Erillinen 15 tapauksen jonokoe läpäisi ilman tuotantokytkentää.
[Sulkusopimuksen valmistelu](release-0.3.0-company-settings-plan.md#d2n-lähtötilan-näyttö-ja-avoin-sulkupäätös)
oli valmisteluvaihe. Omistaja hyväksyi 20.10.2026 viisi sekuntia rajatun
odotuskokeen lähtökohdaksi nykyisen salasanatallennuksen päälle.
17 tapauksen sulkukoe, sen tyypitys ja erikseen nykyiset 24 salaisuustestiä
läpäisivät. Tämä ei ole Electronin IPC-/audit-ketjun tai tuotantokytkennän
hyväksyntä. Omistaja hyväksyi tämän jälkeen
[koko sulkusopimuksen](release-0.3.0-company-settings-plan.md#sulkusopimusehdotus-kokeen-jälkeen)
rajattuun toteutukseen ja testeihin nykyistä salasanatallennusta muuttamatta.
D2:n brokerin, auditin ja sulkukutsujien rajattu kytkentä on työpuussa.
Kohderegressiot ja tyypitys läpäisivät; alkuperäinen synteettinen
broker-poikkeus todennettiin myös puretusta OpenPGP-paketista.
[D2:n kohdenäyttö ja rajat](release-0.3.0-company-settings-plan.md#d1n-kohdenäyttö-ja-seuraava-työ)
erottavat tämän varsinaisesta integraatiosta. Viisi selainkomponentin
sessio-/virhekoetta ja nykyiset Electronin salaisuus- sekä A -> B -> A
-yritysvaihtopolut läpäisivät. Sulun tarkka turvallinen syy on todennettu
nykyisen compositionin JSONL-lokiin. Kirjoittajarajalta alkava erillinen
system-testi todensi HTTP-/API-client-/tukipakettilukuketjun ja syyn
säilymisen backendin restartissa. D3:n nykyisen saatavuussäännön
kohderegressiot läpäisivät. Oikean HTTP-sulun ja auditin kohdetestit sekä
SMTP-readerin yhteisen pääsyeston korjaus läpäisivät rajatun sarjan.
Kaksi erillistä Electron-koetta todensi viivästetyn set/remove-kuittauksen
HTTP-/utility-/broker-/tiedosto-/audit-ketjun sekä sulun ja restartin.
Ne eivät viivästytä levy-I/O:ta tai käytä oikeaa SMTP-verkkotoimitusta.
Kahden backendin synteettinen SMTP-koe todensi lisäksi A:n myöhäisen
lukutuloksen eston ja B:n omat tunnukset ilman salaisuuden siirtymistä.
Se täydentää Electronin yritysvaihtoa, ei korvaa sitä. Loppukatselmuksen
havaitsema audit-virheen ja jo jonottavan broker-työn pääsyestoraja on
korjattu nykyiseen clientiin. Yhdistetty composition/SQLite/client-koe,
backendin ja desktopin kytkentätestit, työtilan tyypitys sekä oikean
Electronin kaksi sulku-/restart-koetta läpäisivät myös tämän muutoksen
jälkeen. Rajattu jatkokatselmus ei löytänyt korjattavaa. Puhtaan
`a4e14bc3`-paketin palautus läpäisi tämän jälkeen; yllä kuvattu ensimmäinen
PR-kierros kuitenkin hylättiin. Aiempi kohdenäyttö ei korvaa uuden
korjausrevision normaaleja kokonaisportteja.
CS-1/CS-2 säilyvät hyväksyttyinä; D:n kokonais- ja PR/main-hyväksyntä
ovat vielä avoinna.

Jatkaja varmentaa ensin työpuun, haaran, HEAD:n ja etätilan. Vanhaa SHA:ta
ei oleteta uudeksi lähtötilaksi. Tehtävän valtuus, voimassa olevat poikkeukset
ja ensivirheet tarkistetaan [työnkulun](../ai/workflow.md) ja
[testausohjeen](../ai/testing-rules.md) mukaan.

## Voimassa olevat sopimukset

Valitse tehtävän koskettama omistaja [ohjehakemistosta](../README.md).
Taulukko on reitti, ei lähteiden sääntöjen korvike tai käsky lukea kaikki
aihealueet joka tehtävässä.

| Aihe | Omistava lähde |
| --- | --- |
| SQLiten schema, migraatiohistoria ja avaamisen luottamus | [Tietokantatoteutus](local-database-implementation-plan.md); työtilakutsujalle [työtilasuunnitelma](local-company-workspace-plan.md). |
| Eristetty varmuuskopion tarkistus ja rajattu historiankäsittely | [Backup ja palautus](local-backup-and-restore-plan.md), [artifact-katalogi](local-backup-artifact-inventory.md), tarkistusajurin toimitukselle [desktop-riippuvuudet](local-desktop-dependency-review.md). |
| Palautuksen, journalin ja prosessien omistajuus | [Backup ja palautus](local-backup-and-restore-plan.md), [työtilat](local-company-workspace-plan.md), päivitykselle [asennin ja update](windows-installer-and-update-plan.md). |
| Laskurevisio, PDF ja toimitushistoria | [Hyväksyntä ja numerointi](invoice-approval-numbering-plan.md), [print-data](invoice-print-data-foundation-plan.md), [toimitustapahtumat](invoice-delivery-events-plan.md) ja [niiden persistence](sqlite-invoice-delivery-event-persistence-plan.md). |
| Näkymän omistajuus, tallennuspalaute ja diagnostiikka | [Laskutus-UI](invoicing-ui-roadmap.md), [Company Settings](../modules/company-settings.md), [tapahtumakatalogi](r0-observability-event-catalog.md) ja [virheperiaatteet](error-handling-principles.md). |
| Testiperusta, ensivirhe ja pakettien hyväksyntä | [Testaus](../ai/testing-rules.md), [E2E-ympäristö](e2e-test-environment.md), [Windows-harness](windows-installer-acceptance-harness-v2.md), [salattu aineisto](ci-encrypted-evidence.md). |
| Julkaisun sisältö, versiointi ja seuraavat päätökset | [Roadmap](release-0.3.0-plan.md), [versiointi](release-versioning-policy.md), [riippuvuudet](dependency-policy.md). |

## Hyväksyntähistoria

- [Integraatioiden historia](release-0.3.0-integration-history.md): A/B/C/K:n
  integraatiohavainnot, erilliset epäonnistumiset ja rajatut jatkopäätökset.
- [Varmuuskopion tarkistuksen historia](release-0.3.0-profile-validation-history.md):
  K:n schema-, resurssi-, journal- ja katalogikokeet sekä hylätyt vaihtoehdot.
- [Laskurevisioiden historia](release-0.3.0-invoice-revisions-history.md):
  B-P1/P2/P3 ja B3-B5:n päätökset, spesifikaatiot ja revisionmukainen näyttö.
- [M0/T/M1:n historia](release-0.3.0-m1-history.md): aiempi valmistelu,
  testiperustan hyväksyntä ja roadmapin päivätyt tilannekuvat.

MSI:n aiemman sulkemispyynnön estäjä, alkuperäisen käännösvirheen puuttuva
tuloste, API-katkoksen syy ja ilmoituskeruun satunnainen hylkäys säilyvät
niiden omissa historiallisissa rajauksissa. Myöhempi läpäisy tai parempi
keräys ei jälkikäteen todista niiden syytä. Käytetty kertakoelupa ei uusiudu
historian siirrossa, eikä epävarmaa aineistoa poisteta tämän työn perusteella.

<details>
<summary>Aiemmat osiot ja pysyvät historialinkit</summary>

<p><a id="030-m1--valmistelu"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l1">0.3.0 M1 -valmistelu (historia)</a></p>
<p><a href="release-0.3.0-integration-history.md#m1-source-preparation-l3">Jatka tästä (historia)</a></p>
<p><a id="päivätty-näyttö-ja-sopimukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l76">Päivätty näyttö ja sopimukset (historia)</a></p>
<p><a id="yhteisen-virhekeräyksen-windows-kohdetodennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l340">Yhteisen virhekeräyksen Windows-kohdetodennus (historia)</a></p>
<p><a id="virhekeräyksen-normaalin-pr-kierroksen-jatko"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l360">Virhekeräyksen normaalin PR-kierroksen jatko (historia)</a></p>
<p><a id="kn-nykyinen-pr-checkpoint-ja-valmistelukoe"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l500">K:n nykyinen PR-checkpoint ja valmistelukoe (historia)</a></p>
<p><a id="kn-ensimmäisen-pr-kierroksen-jatko"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l793">K:n ensimmäisen PR-kierroksen jatko (historia)</a></p>
<p><a id="kn-normaalin-kierroksen-resurssitestit"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l890">K:n normaalin kierroksen resurssitestit (historia)</a></p>
<p><a id="kn-kokonaiskytkennän-tarkistus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l958">K:n kokonaiskytkennän tarkistus (historia)</a></p>
<p><a id="kn-integraatiotestien-checkpoint"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l1034">K:n integraatiotestien checkpoint (historia)</a></p>
<p><a id="laskuhistorian-ennakkorajan-päätös"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1095">Laskuhistorian ennakkorajan päätös (historia)</a></p>
<p><a id="katalogin-muistivirheen-syyketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1146">Katalogin muistivirheen syyketju (historia)</a></p>
<p><a id="historian-eristetyn-ajon-kohdenäyttö"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1165">Historian eristetyn ajon kohdenäyttö (historia)</a></p>
<p><a id="laskuhistorian-inkrementaalisen-luennan-suunnitelma"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1198">Laskuhistorian inkrementaalisen luennan suunnitelma (historia)</a></p>
<p><a id="historian-luennan-toteutussopimus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1287">Historian luennan toteutussopimus (historia)</a></p>
<p><a id="paketoinnin-budjettipäätös"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l1490">Paketoinnin budjettipäätös (historia)</a></p>
<p><a id="suuren-katalogin-palautusraja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1510">Suuren katalogin palautusraja (historia)</a></p>
<p><a id="tarkistuskohtien-jatkosuunnittelu"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1615">Tarkistuskohtien jatkosuunnittelu (historia)</a></p>
<p><a id="hyväksyntäjournalin-viimeiset-lukuvälit"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1735">Hyväksyntäjournalin viimeiset lukuvälit (historia)</a></p>
<p><a id="tiedostoluettelon-rajatun-lukuerän-ehdotus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1782">Tiedostoluettelon rajatun lukuerän ehdotus (historia)</a></p>
<p><a id="pdf-luvun-ja-cold-journalin-tuotantokytkentä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1926">PDF-luvun ja cold-journalin tuotantokytkentä (historia)</a></p>
<p><a id="linux-tarkistuksen-ajopolun-päätös"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l1976">Linux-tarkistuksen ajopolun päätös (historia)</a></p>
<p><a id="candidate-tarkistuksen-avausportti"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2020">Candidate-tarkistuksen avausportti (historia)</a></p>
<p><a id="natiivin-muistivirheen-luokittelukorjaus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2061">Natiivin muistivirheen luokittelukorjaus (historia)</a></p>
<p><a id="aktiivivalidoinnin-kutsujakohtainen-omistajuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2100">Aktiivivalidoinnin kutsujakohtainen omistajuus (historia)</a></p>
<p><a id="ensimmäisen-käynnistyksen-ja-c-kutsun-kytkentä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2206">Ensimmäisen käynnistyksen ja C-kutsun kytkentä (historia)</a></p>
<p><a id="journalin-valinta--ja-sisältötarkistuksen-rajattu-koe"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2272">Journalin valinta- ja sisältötarkistuksen rajattu koe (historia)</a></p>
<p><a id="k-paketin-valmistelu-ja-hyväksyntärajat"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2395">K-paketin valmistelu ja hyväksyntärajat (historia)</a></p>
<p><a id="v2e-erillisen-tarkistuskopion-koe"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2496">V2e: erillisen tarkistuskopion koe (historia)</a></p>
<p><a id="v2f-kutsujien-aineiston-säilytys"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2558">V2f: kutsujien aineiston säilytys (historia)</a></p>
<p><a id="v2g-tarkistuskopio-todellisessa-utility-prosessissa"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2597">V2g: tarkistuskopio todellisessa utility-prosessissa (historia)</a></p>
<p><a id="v2h-wal-kuluttajaregressio-ja-kytkentäpäätös"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2648">V2h: WAL-kuluttajaregressio ja kytkentäpäätös (historia)</a></p>
<p><a id="v2i-tarkistuskopion-tuotantokuluttaja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2692">V2i: tarkistuskopion tuotantokuluttaja (historia)</a></p>
<p><a id="v2j-ylemmän-virheketjun-ensisyyn-säilyminen"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2751">V2j: ylemmän virheketjun ensisyyn säilyminen (historia)</a></p>
<p><a id="v2k-workspace-varmuuskopion-turvallinen-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2786">V2k: workspace-varmuuskopion turvallinen lukuketju (historia)</a></p>
<p><a id="v2l-backup--ja-palautuskuluttajien-sisäinen-ensisyy"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2835">V2l: backup- ja palautuskuluttajien sisäinen ensisyy (historia)</a></p>
<p><a id="v2m-portable-backupin-turvallinen-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2864">V2m: portable-backupin turvallinen lukuketju (historia)</a></p>
<p><a id="v2n-palautuskuluttajien-turvallinen-ensisyy"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2910">V2n: palautuskuluttajien turvallinen ensisyy (historia)</a></p>
<p><a id="hyväksynnän-loppuvaiheen-syytieto"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l2952">Hyväksynnän loppuvaiheen syytieto (historia)</a></p>
<p><a id="v2o-palautustapahtumien-lukijoiden-sopimustarkistus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3005">V2o: palautustapahtumien lukijoiden sopimustarkistus (historia)</a></p>
<p><a id="v2p-tuonnin-todellinen-mainipc-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3044">V2p: tuonnin todellinen main/IPC-lukuketju (historia)</a></p>
<p><a id="v2q-korvauksen-todellinen-mainipc-lukuketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3095">V2q: korvauksen todellinen main/IPC-lukuketju (historia)</a></p>
<p><a id="v2r-pysyvät-workspace-schema-hylkäystestit"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3147">V2r: pysyvät workspace-schema-hylkäystestit (historia)</a></p>
<p><a id="v2s-tarkistusajurin-erillinen-toimitus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3189">V2s: Tarkistusajurin erillinen toimitus (historia)</a></p>
<p><a id="v2t-inventaarion-suljettu-virhepolku"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3233">V2t: Inventaarion suljettu virhepolku (historia)</a></p>
<p><a id="v2u-omistetun-paikallisen-työtilan-kaatumispalautus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3281">V2u: Omistetun paikallisen työtilan kaatumispalautus (historia)</a></p>
<p><a id="v2v-eristetyn-tarkistuksen-prosessiraja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3329">V2v: Eristetyn tarkistuksen prosessiraja (historia)</a></p>
<p><a id="v2w-luotettu-konteksti-ja-tarkistuksen-koostaminen"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3386">V2w: Luotettu konteksti ja tarkistuksen koostaminen (historia)</a></p>
<p><a id="v2x-kevyt-broker-v10-konteksti"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3427">V2x: Kevyt broker-v10-konteksti (historia)</a></p>
<p><a id="v2y-omistettu-inspect-kuluttaja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3463">V2y: Omistettu Inspect-kuluttaja (historia)</a></p>
<p><a id="v2z-portablen-main-kuluttajaportti"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3507">V2z: Portablen main-kuluttajaportti (historia)</a></p>
<p><a id="v2aa-palautuspisteen-lähdevaraus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3564">V2aa: Palautuspisteen lähdevaraus (historia)</a></p>
<p><a id="v2ab-valmistellun-palautuksen-omistajuuden-siirto"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3602">V2ab: Valmistellun palautuksen omistajuuden siirto (historia)</a></p>
<p><a id="v2ac-snapshotin-hyväksyntäkäytännön-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3636">V2ac: Snapshotin hyväksyntäkäytännön sidonta (historia)</a></p>
<p><a id="v2ad-palautuspisteen-tallennuksen-native-kytkentä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3703">V2ad: Palautuspisteen tallennuksen native-kytkentä (historia)</a></p>
<p><a id="v2ae-odottavan-palautusstagingin-native-omistajuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3739">V2ae: Odottavan palautusstagingin native-omistajuus (historia)</a></p>
<p><a id="v2af-tarkistusajurin-alustakohtainen-todennus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3777">V2af: Tarkistusajurin alustakohtainen todennus (historia)</a></p>
<p><a id="v2ag-snapshot-muodostajan-eristetty-tarkistusketju"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3812">V2ag: Snapshot-muodostajan eristetty tarkistusketju (historia)</a></p>
<p><a id="v2ah-electron-testiruntimen-tarkistusajuritoimitus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3849">V2ah: Electron-testiruntimen tarkistusajuritoimitus (historia)</a></p>
<p><a id="v2ai-palautuksen-suljettu-kirjoitussuoja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3907">V2ai: Palautuksen suljettu kirjoitussuoja (historia)</a></p>
<p><a id="v2aj-palautuksen-nimetty-backend-pysäytys"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l3959">V2aj: Palautuksen nimetty backend-pysäytys (historia)</a></p>
<p><a id="v2ak-native-stagingin-durable-handoff"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4010">V2ak: Native-stagingin durable-handoff (historia)</a></p>
<p><a id="v2al-kylmäpalautuksen-vaihekohtainen-tiedostotarkistus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4064">V2al: Kylmäpalautuksen vaihekohtainen tiedostotarkistus (historia)</a></p>
<p><a id="v2am-kylmäpalautuksen-muuttamaton-journal-valinta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4111">V2am: Kylmäpalautuksen muuttamaton journal-valinta (historia)</a></p>
<p><a id="v2an-kylmäpalautuksen-tuore-forward-omistajuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4144">V2an: Kylmäpalautuksen tuore forward-omistajuus (historia)</a></p>
<p><a id="v2ao-kylmäpalautuksen-vaihekohtainen-sisältöydin"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4194">V2ao: Kylmäpalautuksen vaihekohtainen sisältöydin (historia)</a></p>
<p><a id="v2ap-kylmäsisällön-nimetty-prosessiraja"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4237">V2ap: Kylmäsisällön nimetty prosessiraja (historia)</a></p>
<p><a id="v2aq-kylmäsisältöportin-omistettu-tarkistuskopio"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4273">V2aq: Kylmäsisältöportin omistettu tarkistuskopio (historia)</a></p>
<p><a id="v2ar-valittujen-pdf-tiedostojen-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4334">V2ar: Valittujen PDF-tiedostojen sidonta (historia)</a></p>
<p><a id="v2as-startupin-tuore-sisältövaltuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4400">V2as: Startupin tuore sisältövaltuus (historia)</a></p>
<p><a id="v2at-loppuvaiheen-journal-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4455">V2at: Loppuvaiheen journal-sidonta (historia)</a></p>
<p><a id="v2au-keskeytyneen-rollbackin-slot-valinta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4505">V2au: Keskeytyneen rollbackin slot-valinta (historia)</a></p>
<p><a id="v2av-alkuperäissisällön-tarkistussopimus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4547">V2av: Alkuperäissisällön tarkistussopimus (historia)</a></p>
<p><a id="v2aw-rollbackin-loppusiivouksen-säilytys"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4694">V2aw: Rollbackin loppusiivouksen säilytys (historia)</a></p>
<p><a id="v2ax-backendin-jälkeisen-terminal-valtuuden-päätösrajat"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4729">V2ax: Backendin jälkeisen terminal-valtuuden päätösrajat (historia)</a></p>
<p><a id="v2az-hyväksynnän-pysyvyys-ja-alkuperäiskannan-poissaolo"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4765">V2az: Hyväksynnän pysyvyys ja alkuperäiskannan poissaolo (historia)</a></p>
<p><a id="v2ba-terminal-inventaario-ja-nimetty-siivous"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4809">V2ba: Terminal-inventaario ja nimetty siivous (historia)</a></p>
<p><a id="v2bb-live-terminalin-tuore-valtuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4846">V2bb: Live-terminalin tuore valtuus (historia)</a></p>
<p><a id="v2be-cn-business-valmistumisen-journal-sidonta"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4893">V2be: C:n business-valmistumisen journal-sidonta (historia)</a></p>
<p><a id="v2bh-journalittoman-cn-historiallinen-käynnistysadmissio"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l4950">V2bh: Journalittoman C:n historiallinen käynnistysadmissio (historia)</a></p>
<p><a id="v2bi-cn-palautuksen-rajattu-w6-valmistelu"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5019">V2bi: C:n palautuksen rajattu W6-valmistelu (historia)</a></p>
<p><a id="v2bj-aktiiviprofiilin-eristetyn-tarkistuksen-valmistelu"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5070">V2bj: Aktiiviprofiilin eristetyn tarkistuksen valmistelu (historia)</a></p>
<p><a id="v2bg-aktivoinnin-täsmällinen-journal-ja-valtuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5115">V2bg: Aktivoinnin täsmällinen journal ja valtuus (historia)</a></p>
<p><a id="v2bf-journalittoman-cn-valinnan-jatkuminen"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5180">V2bf: Journalittoman C:n valinnan jatkuminen (historia)</a></p>
<p><a id="v2bd-tarkistusvirheen-jälkeinen-rollback-valtuus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5223">V2bd: Tarkistusvirheen jälkeinen rollback-valtuus (historia)</a></p>
<p><a id="v2bc-cn-alkuperäisketjun-terminal"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5275">V2bc: C:n alkuperäisketjun terminal (historia)</a></p>
<p><a id="v2ay-cn-palautuskutsujan-sisäinen-ensisyy"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5340">V2ay: C:n palautuskutsujan sisäinen ensisyy (historia)</a></p>
<p><a id="muut-avoimet-k-päätökset"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5377">Muut avoimet K-päätökset (historia)</a></p>
<p><a id="k-p2n-tarkistusajurin-toimitusehdotus"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5431">K-P2:n tarkistusajurin toimitusehdotus (historia)</a></p>
<p><a id="kn-toteutussopimus-rakenne-ennen-sisältöä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5517">K:n toteutussopimus: rakenne ennen sisältöä (historia)</a></p>
<p><a id="kn-toteutussopimus-eristetty-tarkistus-ja-siivous"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5608">K:n toteutussopimus: eristetty tarkistus ja siivous (historia)</a></p>
<p><a id="kn-tiedostovastuut-ja-turvallinen-palaute"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5671">K:n tiedostovastuut ja turvallinen palaute (historia)</a></p>
<p><a id="kn-toteutusjärjestys-ja-hyväksyntä"></a><a href="release-0.3.0-profile-validation-history.md#m1-source-preparation-l5702">K:n toteutusjärjestys ja hyväksyntä (historia)</a></p>
<p><a id="cn-ensimmäisen-pr-kierroksen-rajattu-korjaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5766">C:n ensimmäisen PR-kierroksen rajattu korjaus (historia)</a></p>
<p><a id="cn-prosessijärjestysfixturen-täsmennys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5811">C:n prosessijärjestysfixturen täsmennys (historia)</a></p>
<p><a id="c-paketin-valmistelu-ja-hyväksyntärajat"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5845">C-paketin valmistelu ja hyväksyntärajat (historia)</a></p>
<p><a id="cn-toteutuspalat-ja-todennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5883">C:n toteutuspalat ja todennus (historia)</a></p>
<p><a id="cn-avoimet-sopimusrajat-ennen-toteutusta"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5943">C:n avoimet sopimusrajat ennen toteutusta (historia)</a></p>
<p><a id="cn-rajattu-toteutusehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l5995">C:n rajattu toteutusehdotus (historia)</a></p>
<p><a id="r18-prosessivarauksen-ja-journal-v2n-sopimusehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6295">R18: prosessivarauksen ja journal V2:n sopimusehdotus (historia)</a></p>
<p><a id="b3-b5n-integraatiohistoria"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6874">B3-B5:n integraatiohistoria (historia)</a></p>
<p><a id="b3-b5n-normaalin-integraatiokierroksen-testisopimukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6880">B3-B5:n normaalin integraatiokierroksen testisopimukset (historia)</a></p>
<p><a id="b3-b5n-ensimmäisen-pr-kierroksen-rajatut-korjaukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l6921">B3-B5:n ensimmäisen PR-kierroksen rajatut korjaukset (historia)</a></p>
<p><a id="legacy-testin-038039-migraatiotodisteen-korjausehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7269">Legacy-testin 038–039-migraatiotodisteen korjausehdotus (historia)</a></p>
<p><a id="b3-b5n-aikana-havaittu-riippuvuuspäivitys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7466">B3-B5:n aikana havaittu riippuvuuspäivitys (historia)</a></p>
<p><a id="b1b2-mainin-electron-sulkuhavainto"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7520">B1/B2-mainin Electron-sulkuhavainto (historia)</a></p>
<p><a id="a3r06-hyväksyntävalmiuden-vastaussidonta"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l7628">A3/R06: hyväksyntävalmiuden vastaussidonta (historia)</a></p>
<p><a id="b0-laskun-sisältö-ja-toimitus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7671">B0: laskun sisältö ja toimitus (historia)</a></p>
<p><a id="lähdepohja-ja-nykyiset-puutteet"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7679">Lähdepohja ja nykyiset puutteet (historia)</a></p>
<p><a id="rajattu-ratkaisusuunta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7708">Rajattu ratkaisusuunta (historia)</a></p>
<p><a id="päätökset-ennen-bn-toteutusta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7762">Päätökset ennen B:n toteutusta (historia)</a></p>
<p><a id="b-p2-toimitusversioiden-historia"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7785">B-P2: toimitusversioiden historia (historia)</a></p>
<p><a id="b-p3-turvallisen-uudelleenlähetyksen-vaihtoehto"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7855">B-P3: turvallisen uudelleenlähetyksen vaihtoehto (historia)</a></p>
<p><a id="b3b4-tietomalli-portit-ja-migraatiojärjestys"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l7966">B3/B4: tietomalli, portit ja migraatiojärjestys (historia)</a></p>
<p><a id="toteutuspalat-ja-hyväksyntänäyttö"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8060">Toteutuspalat ja hyväksyntänäyttö (historia)</a></p>
<p><a id="palaute-diagnostiikka-ja-palautettavuus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8111">Palaute, diagnostiikka ja palautettavuus (historia)</a></p>
<p><a id="b0n-jatkamiskohta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8144">B0:n jatkamiskohta (historia)</a></p>
<p><a id="b1b2-rajattu-toteutus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8175">B1/B2: rajattu toteutus (historia)</a></p>
<p><a id="b3-b5-toteutusvalmistelu"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8239">B3-B5: toteutusvalmistelu (historia)</a></p>
<p><a id="alv-lukupolun-tarkennus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8251">ALV-lukupolun tarkennus (historia)</a></p>
<p><a id="omistava-toteutuskartta"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8315">Omistava toteutuskartta (historia)</a></p>
<p><a id="tietomallin-katselmointiehdotus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8339">Tietomallin katselmointiehdotus (historia)</a></p>
<p><a id="snapshotin-julkaisu-ja-legacy-kopion-sql-ehdotus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8426">Snapshotin julkaisu ja legacy-kopion SQL-ehdotus (historia)</a></p>
<p><a id="b4-historian-käyttöpolun-checkpoint"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8839">B4-historian käyttöpolun checkpoint (historia)</a></p>
<p><a id="b4-legacy-uudelleenlähetyksen-checkpoint"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8878">B4-legacy-uudelleenlähetyksen checkpoint (historia)</a></p>
<p><a id="b5-katalogin-ja-palautuksen-checkpoint"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8913">B5-katalogin ja palautuksen checkpoint (historia)</a></p>
<p><a id="b5-katselmuksen-jatkokorjaukset"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9020">B5-katselmuksen jatkokorjaukset (historia)</a></p>
<p><a id="b4-reopened-editorin-jatkotodennus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9093">B4-reopened-editorin jatkotodennus (historia)</a></p>
<p><a id="säilytetyn-dokumentin-täsmäluku-ja-vahvistuksen-järjestys"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9373">Säilytetyn dokumentin täsmäluku ja vahvistuksen järjestys (historia)</a></p>
<p><a id="dokumentti--ja-tapahtumasidoksen-sql-osakoe"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9622">Dokumentti- ja tapahtumasidoksen SQL-osakoe (historia)</a></p>
<p><a id="porttien-katselmointiehdotus"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9688">Porttien katselmointiehdotus (historia)</a></p>
<p><a id="migraation-järjestyksen-näyttö-ja-jatko"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l9912">Migraation järjestyksen näyttö ja jatko (historia)</a></p>
<p><a id="valmistelun-porttien-tila"></a><a href="release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l10056">Valmistelun porttien tila (historia)</a></p>
<p><a id="a1r01-toteutus-ja-hyväksyntä"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10096">A1/R01: toteutus ja hyväksyntä (historia)</a></p>
<p><a id="a2r05-tallennuksen-omistajuus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10137">A2/R05: tallennuksen omistajuus (historia)</a></p>
<p><a id="oma-yritys-rajattu-tallennuskorjaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10215">Oma yritys: rajattu tallennuskorjaus (historia)</a></p>
<p><a id="msi-politiikkakokeen-virheaineisto"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10312">MSI-politiikkakokeen virheaineisto (historia)</a></p>
<p><a id="pnpm-bootstrapin-tietoturvahuolto"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10353">Pnpm-bootstrapin tietoturvahuolto (historia)</a></p>
<p><a id="pnpm-huollon-pr-porttien-rajatut-esteet"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10408">Pnpm-huollon PR-porttien rajatut esteet (historia)</a></p>
<p><a id="riskiperusteinen-jatko-1102026"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10489">Riskiperusteinen jatko 1.10.2026 (historia)</a></p>
<p><a id="normaalin-kierroksen-tulos-ja-rajatut-korjaukset"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10491">Normaalin kierroksen tulos ja rajatut korjaukset (historia)</a></p>
<p><a id="nykyisen-työn-rajaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10558">Nykyisen työn rajaus (historia)</a></p>
<p><a id="salatun-tutkimusaineiston-välitavoite"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10564">Salatun tutkimusaineiston välitavoite (historia)</a></p>
<p><a id="salatun-toimituksen-hyväksyntä"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10700">Salatun toimituksen hyväksyntä (historia)</a></p>
<p><a id="seuraava-etenemispäätös"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10724">Seuraava etenemispäätös (historia)</a></p>
<p><a id="aiemman-timeout-tutkimuksen-rajaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10748">Aiemman timeout-tutkimuksen rajaus (historia)</a></p>
<p><a id="lähtönäyttö-ja-uusinnan-raja"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10782">Lähtönäyttö ja uusinnan raja (historia)</a></p>
<p><a id="rajatun-uusinnan-tulos"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10829">Rajatun uusinnan tulos (historia)</a></p>
<p><a id="hyväksytty-katkaisukoe"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10900">Hyväksytty katkaisukoe (historia)</a></p>
<p><a id="katkaisukokeen-tulos"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10943">Katkaisukokeen tulos (historia)</a></p>
<p><a id="hyväksytty-workspace-success-havaintokoe"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l10982">Hyväksytty workspace-success-havaintokoe (historia)</a></p>
<p><a id="workspace-success-havaintokokeen-tulos"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11023">Workspace-success-havaintokokeen tulos (historia)</a></p>
<p><a id="tutkimuspaketin-päätösraportti"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11058">Tutkimuspaketin päätösraportti (historia)</a></p>
<p><a id="yksityisen-vientiaineiston-säilytysehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11120">Yksityisen vientiaineiston säilytysehdotus (historia)</a></p>
<p><a id="yksityisen-kertakokeen-valmisteluhylkäys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11277">Yksityisen kertakokeen valmisteluhylkäys (historia)</a></p>
<p><a id="korjatun-yksityisen-kertakokeen-päätösraportti"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11319">Korjatun yksityisen kertakokeen päätösraportti (historia)</a></p>
<p><a id="playwright-ensivirheen-jatkoehdotus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11360">Playwright-ensivirheen jatkoehdotus (historia)</a></p>
<p><a id="virhetiedon-ja-electron-päivityksen-rajattu-jatko"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11380">Virhetiedon ja Electron-päivityksen rajattu jatko (historia)</a></p>
<p><a id="rajattu-ongelmalista"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11395">Rajattu ongelmalista (historia)</a></p>
<p><a id="v1n-ensimmäinen-toteutuscheckpoint"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11437">V1:n ensimmäinen toteutuscheckpoint (historia)</a></p>
<p><a id="v1bn-toteutus-ja-todennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11455">V1b:n toteutus ja todennus (historia)</a></p>
<p><a id="v1bn-järjestysregressio"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11502">V1b:n järjestysregressio (historia)</a></p>
<p><a id="v2n-nykyinen-hyväksyntächeckpoint"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11526">V2:n nykyinen hyväksyntächeckpoint (historia)</a></p>
<p><a id="normaalin-pr-kierroksen-valmisteluhylkäys"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11633">Normaalin PR-kierroksen valmisteluhylkäys (historia)</a></p>
<p><a id="valmiuskyselyhavainnon-todennus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11675">Valmiuskyselyhavainnon todennus (historia)</a></p>
<p><a id="v2n-ensimmäisen-pr-ajon-rajatut-esteet"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11698">V2:n ensimmäisen PR-ajon rajatut esteet (historia)</a></p>
<p><a id="asennuskorjauksen-päätös"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11791">Asennuskorjauksen päätös (historia)</a></p>
<p><a id="pakettivälimuistin-testivalmistelun-rajaus"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l11986">Pakettivälimuistin testivalmistelun rajaus (historia)</a></p>
<p><a id="ohje-ja-historia"></a><a href="release-0.3.0-integration-history.md#m1-source-preparation-l12009">Ohje ja historia (historia)</a></p>
<p><a id="lukureitit"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12091">Lukureitit (historia)</a></p>
<p><a id="rajattu-toteutusjärjestys"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12112">Rajattu toteutusjärjestys (historia)</a></p>
<p><a id="skannaushavaintojen-vaikutus-jatkoon"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12133">Skannaushavaintojen vaikutus jatkoon (historia)</a></p>
<p><a id="valmistumisportti-pala-kerrallaan"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12156">Valmistumisportti pala kerrallaan (historia)</a></p>
<p><a id="päätösjono-ja-valmistelun-lopetus"></a><a href="release-0.3.0-m1-history.md#m1-source-preparation-l12172">Päätösjono ja valmistelun lopetus (historia)</a></p>

</details>
