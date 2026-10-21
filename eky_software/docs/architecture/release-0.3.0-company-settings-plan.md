# 0.3.0: D-paketin toteutussuunnitelma

## Tila ja rajaus

**21.10.2026: D:n PR-integraatio on yhä hylätty; rajattu jatkoselvitys on hyväksytty.**
Lähtö on PR #307:n hyväksytty main
`da93cf53b7c608f825629d60404dce4c839dcb6a`.
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä)
omistaa ajantasaisen integraatiotilan; tämä tiedosto tarkentaa vain
[roadmapin D-paketin](release-0.3.0-plan.md#m3-muut-invariantit-diagnostiikka-ja-ylläpidettävyys)
R07/R14/R16-korjausten työjärjestyksen ja hyväksynnän. Se ei ole uusi roadmap.

T/A/B/C/K ja CS-1/CS-2 säilyvät hyväksyttyinä. Historiallisia timeout-syitä
ei selvitetä uudelleen ilman tähän muutokseen kohdistuvaa näyttöä.
Alkuperäinen valmistelu perustui lähdehavaintoihin. Alla oleva D1:n
kohdenäyttö ei vielä ole koko D:n tai uuden revision integraatiohyväksyntä.

Omistaja hyväksyi alla kuvatun D-P1:n ja D-P2:n vaihtoehdon A.
Omistaja hyväksyi 20.10.2026 myös kokeen jälkeisen D2-sulkusopimuksen
rajattuun toteutukseen ja testeihin. Tuotantokytkennän hyväksyntä edellyttää
edelleen alla nimettyä elinkaaritodistusta.
Toteutuksen, testien ja integraation hyväksyntä on avoin.

PR #308:n `a4e14bc3`-revision V2-kierros hylkäsi yrityksen
migraatioaktivoinnin ja päivityksen virhepalautuksen. Aktivoinnin sama
virhe toistui kohdekokeessa: hallittu backendin sulku ohitti mainin
salaisuusbrokerin sulkuvalmistelun. Koko migraatiocallbackin nykyiseen
composition-kytkentään tehty järjestyskorjaus säilyttää myös virhehaaran
ensisyyn ja epävarman drainin eston. Sen 118 kohderegressiota ja sama oikean
Electronin aktivointipolku läpäisivät. Myös desktopin koko testikomento,
työtilan tyypitys ja rajattu riippumaton katselmus läpäisivät. Uuden puhtaan
paketin palautusketju on sittemmin todennettu `fad384a2`-revisiolla;
sen PR/main-hyväksyntä on edelleen avoin.
Tämä ei nimeä kaikkien CI-hylkäysten tai vanhojen timeoutien syytä korjatuksi.
Toinen fault-toisto pysähtyi jo asentimen vastausta odottavaan ilmoitukseen;
sen prosessin ja asennuksen siivous varmennettiin, mutta estäjän tarkka
prosessi-identiteetti jäi avoimeksi. Se ei ole sama migraatioaktivoinnin vika.
Omistaja hyväksyi erikseen Hono 4.13.11:n, Vite 8.2.4:n ja sen vaatiman
Rolldown 1.2.4:n nykyisine sidottuine paketteineen. Rajatun lukitusmuutoksen
auditointi, rekisteriallekirjoitukset ja kohdetestit läpäisivät. Electron,
SQLite, tietomalli ja hyväksyntäehdot säilyvät. `fad384a2`-revision normaali
PR-kierros valmistui hylättynä. Tuore riippuvuustarkistus läpäisi.

Seuraava rajattu työ erottaa kolme havaintoa: MSI-ikkunatestin ensimmäisen
luetteloluvun aikakatkaisu, supervisorin ennen absoluuttista työrajaa
päättynyt odotus ja Electronin alkuvalmistelun sulkuvirhe. Viimeinen syntyi
ennen migraatioaktivoinnin koetta, ei aiemmassa `compatibleMigration`-vaiheessa.
Sen automaattinen uusinta läpäisi, mutta alkuperäinen syy on avoin ja
saman hylkäyksen uusintakiintiö käytetty. Säilyneen syyn puuttuvia osia ei
arvata; havaintoketjun korjaus ei yksin korjaa sammutusta.
Erillinen workspace-success-toisto peruttiin työn kokonaisrajaan; oma loki
ja salattu liite puuttuvat, joten syy ja siivous ovat tuntemattomat.
Omistaja hyväksyi 21.10.2026 ikkunatestin valmisteluun myös täsmällisen
todetun provider-aikakatkaisun sekä jatkamisen Goalin normaaleihin portteihin.
Mitattu luetteloluku vaaditaan edelleen täydellisenä nykyisissä aikarajoissa.

Paikallinen jatkokorjaus tarkistaa supervisorin alkuperäisen absoluuttisen
määräajan uudelleen suhteellisen odotuksen palattua. Hallittu aikaisen
paluun regressio hylkäsi vanhan algoritmin ja läpäisi korjauksen;
nykyinen oikean prosessiluonnin rajakoe läpäisi muuttamattomilla budjeteilla.
Electronin testivalmistelun korjaus säilyttää tunnetun sulkuvaiheen ja
syyluokan virhesiirrossa. Kohdetestit, tyypitys, testikomentojen kytkentä
ja viestisiirron kontrollin salaus/purku läpäisivät. Rajattu katselmus ei
löytänyt korjattavaa. Tämä ei todista vanhan sammutusvirheen juurisyytä,
todellista Electron-virhesiirtoa tai uuden revision PR/main-portteja.
Ikkunatestin hyväksytty valmistelumuutos on toteutettu molempiin lukijoihin.
Windowsin 168 sopimustestiä läpäisi; katselmuksessa löytyneen JavaScript-
lukijaehdon korjauksen jälkeen kolme ikkunalukijan, native-ketjun ja
salaus/purun kohdekoetta läpäisi. Desktopin koko testikomento läpäisi:
Vitestissä 4 351 onnistunutta ja viisi ohitettua, Node-osassa 412
onnistunutta ja 12 ohitettua. Erillisiä ajoja ei yhdistetä testisummaksi.
Jatkokatselmus ei löytänyt korjattavaa. Uusi puhdas paketti ja normaali
PR-kierros seuraavat ennen mahdollista mergeä.

### D1:n kohdenäyttö ja seuraava työ

D1:n nykyiseen muokkaussessioon ja latausyritykseen sidottu alkuluku,
virheen jälkeinen käsin tehtävä uudelleenluku sekä perustietolomakkeen
kirjoitusesto on toteutettu. Kahdeksan uutta latausregressiota ja kolme
aiempaa tallennusregressiota läpäisivät samassa ajossa. Neljä lataustapausta
todennettiin koko web-polussa ja neljä selainkomponentin todellisella
unmount-/client-vaihdolla; jälkimmäisiä ei nimetä koko navigoinnin E2E:ksi.
Myös nykyiset Company Settingsin web- ja API/audit-käyttöpolut,
webin 949 yksikkötestiä, webin tyypitys ja tuotantobuild läpäisivät.

Ensimmäisten uusien testien pyyntölaskenta ja virhetekstiodotus korjattiin:
aloitusnäkymän omat lukupyynnöt erotetaan testattavasta näkymästä
HTTP-vastausten avulla, ja virheellinen DTO odottaa nykyistä turvallista
virheviestiä. Tuotantokoodia tai aikarajoja ei muutettu näiden hylkäysten
vuoksi. Ensivirheet säilyvät erillään hyväksytystä kohdeajosta.
Rajattu riippumaton D1-tuotantokoodin ja päätösten katselmus ei löytänyt
korjattavaa. Tämä ei korvaa koko D:n loppukatselmusta tai PR/main-portteja.

**21.10.2026: D2:n rajattu toteutus ja kohdetodennus ovat työpuussa; integraatio on avoin.**
Brokerin sukupolvi-/request-sidonta, jonon sulku, viiden sekunnin drain ja
epävarmuuden pysyvyys on kytketty nykyisiin omistajiin. Backend erottaa
vaikutuksettoman virheen epävarmasta lopputuloksesta ja tarkistaa myös
auditin valmistumisen ennen hyväksyttyä sulkua. Käyttöliittymä ei tulkitse
epäselvää salasanatilaa puuttuvaksi eikä käytä vanhan session vastauksia.
Nykyinen salaus, tiedostokirjoittaja ja formaatti ovat muuttumattomat.

Desktopin viimeisimmät 456 kohdetestiä, backendin 151 kohdetestiä, API-clientin 21 ja
webin 13 kohdetestiä sekä työtilan tyypitys läpäisivät erillisinä ajoina.
Niitä ei lasketa yhdeksi integraation testimääräksi. Katselmuksen perusteella
epävarmuus sulkee uuden backend-operaation heti, ja epäonnistunut valmistelu
yrittää silti kaikki omistetut sulut. Näihin liittyvät vanhat testiodotukset
päivitettiin uuden sulkusopimuksen mukaisiksi. Adapterin regressiossa
korjattiin testin `resetModules`-rajan ylittänyt virheluokan identiteetti;
tuotannon tyyppitarkistusta ei löysennetty. Ensivirheet säilyvät.

Alkuperäisen broker-poikkeuksen koe sekä OpenPGP-salaus/purku läpäisivät.
Purettu aineisto säilytti alkuperäisen viestin, pinon, syyketjun ja testin
sidonnan, mutta julkinen tuloste ei sisältänyt niitä. Todistus koskee
nimettyä synteettistä muunnosrajaa, ei kaikkia adaptereita, pakkokatkaisua
tai hosted-CI:n latausta. Koe on kytketty nykyisiin CI-testikomentoihin.

Viisi selainkomponentin sessio-/virhe-/kaksoislähetyskoetta läpäisi.
Nykyinen Electronin salaisuuden tallennus/restart/poisto ja yritysvaihdon
A -> B -> A -polku läpäisivät: B:n alkuperäinen salaisuuden puuttuminen,
sen oma tallennus sekä molempien salattujen tiedostojen muuttumattomuus
palattaessa A:han tarkistettiin. Tämä ei yksin todista vaihdon aikaista
viivästettyä tiedostotyötä tai SMTP-tunnussidontaa. Työtilan tyypitys ja
CI-testikomentojen viisi kytkentätarkistusta läpäisivät myös uusien
selainkokeiden jälkeen.

Rajattu lisäregressio toisti vanhentuneen noEffect-ilmoitustilan. Uuden
nimenomaisen onnistuneen tallennuksen/poiston jälkeen sitä ei enää näytetä;
tilaluku tai epävarma tulos ei kuittaa sitä. Ensivirhe säilyy, eikä vanhan
operaation audit-historiaa muuteta. Sulun ensimmäinen turvallinen syykoodi
säilyy nyt nykyisen `desktop.shutdownFailed`-tapahtuman
`secretBrokerDrain`-vaiheessa erillään sulun yleisestä lopputuloksesta.
Kymmenen havaintoregressiota ja todellisen compositionin JSONL-kirjoitus
läpäisivät osana desktopin kohdeajoa. Havainto ei odota loggerin valmistumista
eikä sen oma virhe muuta sulkutulosta. Erillinen kirjoittajarajalta alkava
system-koe läpäisi: oikea JSONL ja incident-kirjoitus, backendin HTTP-luku,
API-clientin tarkka parseri, tukipaketin tarkka lukija, gzip ja checksumit
säilyttävät ensisyyt erillään yleisvirheestä myös backendin restartin yli.
Incident-projektio pysyy minimoituna. Tämä ei ole uusi Electron-UI- tai
paketoitu palautustodiste eikä korvaa compositionin havaitsijatestiä.
Viimeisen kytkennän jälkeen työtilan tyypitys sekä seitsemän alkuperäisen
virheen, salaus/purun ja CI-ajokytkennän tarkistusta läpäisivät.
Rajattu riippumaton havaintokytkennän katselmus ei löytänyt korjattavaa.
Tämä ei korvaa koko D:n loppukatselmusta tai alla olevia avoimia portteja.

D3:n säilyvän saatavuussopimuksen 68 kohdetestiä kolmessa tiedostossa
läpäisivät. Mukana ovat GETin odottava ja epäonnistunut tilaluku,
vaikutukseton virhe vastaan epävarman sukupolven esto, PUTin precommit-luku,
auditrollback sekä tallennettu vastaus ilman uutta tilakyselyä. Uudet
testit eivät muuttaneet tuotantokoodia tai hyväksyttyä saatavuusrajaa.

Backendin oikean HTTP-sulun ja auditin seitsemän regressiota läpäisivät:
socketin poistuminen ei todista kesken olevan store- tai audit-työn loppua.
Katselmuksessa tiukennettiin testin havaittavaa sulkujärjestystä ja kaikkien
omistettujen resurssien siivousyritystä, ei sovelluksen aikarajoja.
Erillinen composition-regressio vahvisti raakaa SMTP-readeria koskeneen
pääsyeston ohituksen. Reader on nyt saman epävarmuus- ja sulkutilan takana;
ennen omistettua valmistumista havaittu epävarmuus hylkää lukutuloksen,
mutta jo valmistunutta lukua tai alkanutta SMTP-transportia ei peruta.
Riippumaton katselmus löysi vielä sisäisen ja omistavan jatkon välisen
ajoitusaukon. Hallittu regressio toisti sen, ja viimeiseen omistavaan
jatkoon sijoitettu tarkistus sulki aukon. Tämän kytkennän 73 kohdetestiä
viidessä tiedostossa läpäisivät,
mukaan lukien vaikutukseton virhe ja normaali onnistuminen. SMTP-transport
on synteettinen; tämä ei vielä todista koko Electron-prosessiketjua.
Ensimmäinen kokeen asetusten puute ja sen jälkeen todennettu readerin
ohitus säilyvät erillisinä havaintoina. Rajattu jatkokatselmus ei löytänyt
korjattavaa. Backendin koko testikomento läpäisi tämän jälkeen: Vitest-osassa
3 827 testiä läpäisi ja viisi oli ohitettu. Ohituksia ei lasketa onnistumisiksi,
eikä tulos ole koko D:n integraatiohyväksyntä.

Oikean Electronin kaksi kuittausviivekoetta läpäisivät: set/remove-kutsu
kulki rendererin HTTP-protokollan, utility-backendin, yksityisen brokerin
ja nykyisen salatun tiedoston kautta. Sulku esti uuden kirjoituksen,
odotti pidätetyn kuittauksen sekä auditin ja päättyi ennen varmennettua
restartia. Lopputila ja yksi onnistunut audit-tapahtuma säilyivät.
Koe viivästää kuittausta, ei levy-I/O:ta. Katselmuksessa korjattu testin
siivous kirjaa vapautusvirheen erikseen peittämättä ensivirhettä;
rajattu jatkokatselmus ei löytänyt korjattavaa. Tämä ei korvaa paketoidun
sovelluksen palautus- tai PR/main-portteja.

Kahden erillisen backendin ja synteettisen SMTP-kuljetuksen lisäregressiot
läpäisivät: A:n myöhäinen lukutulos ei ohita sen epävarmuusestoa eikä
muuta B:n puuttuvaa tai omaa salasanaa ja lähettäjätunnusta. B:n toiminta
säilyy erillisenä. Tämä täydentää oikean Electronin A -> B -> A -näyttöä;
se ei ole tuotannon samanaikainen kahden yrityksen runtime tai oikea SMTP-ajo.
Testin alkuperäinen kahden fixture-kytkennän rekursiovirhe korjattiin
testissä; sitä ei tulkita sovelluksen yrityseristyksen viaksi.

Loppukatselmus havaitsi audit-incomplete-tilan pääsyeston puuttuvan
broker-clientin jo jonottamilta pyynnöiltä. Rajattu regressio toisti
puuttuvan kytkennän. Nykyiseen clientiin lisätty synkroninen pääsyn sulku
säilyttää aktiivisen työn kuittauksen mutta hylkää aloittamattoman työn.
Oikean compositionin, SQLite-auditin ja clientin yhteinen system-koe
läpäisi: ensimmäinen operaatio jäi pendingiksi, aktiivinen valmistui
succeeded-tilaan ja jonotettu jäi vaikutuksettomaksi failed-tulokseksi.
Korjauksen backendin 66 ja desktopin 133 kohdetestiä, työtilan tyypitys
sekä kaksi oikean Electronin sulku-/restart-koetta läpäisivät. Riippumaton
jatkokatselmus ei löytänyt korjattavaa. Testin epäonnistuneen tai
keskeneräisen aineiston säilytys tarkistettiin lisäksi kuudella
MessageChannel-tapauksella; tämä ei laajenna salatun keräyksen tietorajaa.

**Aiempi PR-valmistelu:** puhtaasta `a4e14bc3`-commitista rakennetun saman
paketin palautus läpäisi; ensimmäisen PR-kierroksen hylkäys ja seuraava työ
ovat tämän sivun alussa. Laajat paikalliset sarjat läpäisivät ennen
viimeistä jonokorjausta; korjauksen jälkeinen kohdenäyttö ei korvaa uuden
revision normaaleja kokonaisportteja. Loppukatselmuksen havaittu puute on
korjattu ja katselmoitu, mutta koko D:n integraatiohyväksyntä on avoin.
[Sulkusopimus](#sulkusopimusehdotus-kokeen-jälkeen) säilyy hyväksynnän ehtona;
työpuun kytkentä tai kohdetestit eivät yksin hyväksy D2:ta tai koko D:tä.

### D2:n lähtötilan näyttö ja avoin sulkupäätös

Nykyisen clientin, main-brokerin ja salatun tiedoston toteutuksilla tehty
11 tapauksen synteettinen koe vahvisti seuraavat erot. Koe käytti
hallittua transportia ja testisuojainta, ei Electronin todellista
prosessirajaa tai käyttöjärjestelmän salausta. Läpäisy tarkoittaa nykyisen
käyttäytymisen toistamista, ei vikojen korjaamista.

| Havainto | Korjauksessa vaadittu ero |
| --- | --- |
| Viivästetty set/remove voi vaikuttaa clientin timeoutin jälkeen; jonotettu luku ja uusi pyyntö voivat jatkua. | Timeout ei ole peruutus. Epävarmuus estää aloittamattomat ja uudet pyynnöt ennen niiden lähettämistä. |
| Mainin close voi palautua aktiivisen kirjoituksen päättymättä; clientin close yksin ei estä mainin jonotettua poistoa. | Päättynyt client, suljettu kanava ja päättynyt tiedostotyö todistetaan erikseen. |
| Read/has voi jatkaa varakappaleen palauttamista sulkemisen jälkeen. | Myös lukujen palautus- ja uudelleensalaustyö kuuluu samaan omistajuuteen. |
| Tallennuksen kuittaus voi kadota, vaikka uudet tavut ovat jo tiedostossa. | Epäselvä tulos säilyy pendinginä; myöhempi luku ei kuittaa sitä. |
| Kirjoitus voi epäonnistua uuden currentin julkaisun jälkeen; poisto voi epäonnistua osittaisena. | Yleinen tiedostovirhe ei todista vaikutuksettomuutta. |
| Ennen tiedostotyötä hylätty salaus säilyttää kaikki slotit; tavallinen set/has/read/remove toimii. | Todistettu vaikutuksettomuus ja normaali onnistuminen säilyvät erillisinä. |

Rajattu riippumaton lähdekatselmus vahvisti, ettei nykyinen backendin
sulkuraja tai HTTP-kirjoitusten odotusraja kata automaattisesti mainin
salaisuustyötä. Rajatonta odotusta tai toisen toiminnon aikarajaa ei lisätä
huomaamatta. Valmistelussa verrattiin välitöntä sulun hylkäystä ja rajattua
odotusta. Välitön hylkäys olisi pienempi muutos, mutta myös lyhyt aktiivinen
tilaluku voisi vaatia uudelleenkäynnistyksen. Omistaja hyväksyi jäljempänä
rajatun odotuskokeen. Kummassakaan vaihtoehdossa ajan loppuminen, työn
päättyminen ja muutoksen onnistuminen eivät tarkoita samaa asiaa.
Kokeen jälkeen hyväksytty sulkusopimus on jäljempänä; D-P1:n pending- ja
restart-ehdot säilyvät.

**Määrittelykeskustelun osapäätös 20.10.2026:** kun käyttäjä on jo
vahvistanut yrityksen vaihdon, alkanut salaisuusoperaatio valmistuu
odotusajan sisällä varmennetusti onnistuneena ja kaikki muut sulkemisen ja
yrityksen vaihdon ehdot täyttyvät, alkuperäinen vaihto jatkuu ilman toista vahvistusta.
Kyse on saman vahvistetun toiminnon jatkamisesta, ei automaattisesta
uusinnasta. Vanhentunut tulos, aiempi epävarmuus tai muu sulkuvirhe ei saa
vapauttaa jatkoa tämän päätöksen perusteella.

**Toinen osapäätös 20.10.2026:** varmasti vaikutukseton sähköpostisalasanan
tallennusvirhe ei yksin estä jo vahvistettua yrityksen vaihtoa. Työn on
oltava todistetusti päättynyt ja kaikkien muiden sulkemisen ja vaihdon
ehtojen täytyttävä. Käyttäjälle näytetään tallennuksen epäonnistumisesta
ilmoitus, joka ei saa kadota huomaamatta yrityksen vaihdossa. Tallennusta
ei merkitä onnistuneeksi eikä uusita automaattisesti. Epäselvä tulos,
keskeneräinen työ tai muu sulkuvirhe ei kuulu tähän jatkolupaan.

**Koelupa 20.10.2026:** omistaja hyväksyi viisi sekuntia rajatun odotuskokeen
lähtöarvoksi. Nykyinen salasanan asetus-, salaus- ja tallennuspolku säilyy;
koe koskee jo alkaneen työn sulkemista, ei uutta tallennusjärjestelmää.
Tyhjä tai aikaisemmin valmistuva työ jatkaa heti. Uusi sulkupyyntö ei aloita
budjettia uudelleen eikä määräajan täyttyminen todista työn päättymistä.
Koetulokset, kaikki sulkukutsujat ja koko sulkusopimus esitetään ennen
tuotantokytkennän päätöstä. Viisi sekuntia ei ole mitattu tuotantoraja eikä
lupaus yrityksen vaihdon kokonaisajasta.

Nykyisen yrityksen vaihtodialogin käynnissä olevan työn esto on lähtökohta;
uutta peruutuspolkua ei ole hyväksytty. Kokeen jälkeinen päätös hyväksyy
viiden sekunnin budjetin ja sulkusopimuksen toteutukseen, ei vielä sen
tuotantokytkennän todennusta.
D-P1:n epäselvän tuloksen käsittely säilyy ennallaan.

**Yrityseristyksen täsmennys 20.10.2026:** yrityksen vaihto ei kysy
sähköpostisalasanaa, tarkista sitä SMTP-palvelimelta tai siirrä edellisen
työtilan sähköpostiasetuksia ja salaisuutta uuteen työtilaan. Kohteen
puuttuvaa asetusta tai salasanaa ei täydennetä lähtöyrityksen tiedolla.
Kohde käyttää omaa tietokantaansa ja salattua storeaan; eristys sidotaan
työtilaan ja runtime-sukupolveen, ei vain `companyId`-arvoon. Vanhan
työtilan myöhäinen tulos ei saa muuttaa uuden työtilan tilaa, asetuksia,
salaisuutta tai lähetyksen tunnuksia.

D2:n todennus kattaa A -> B -> A -vaihdon eri synteettisillä
sähköpostiasetuksilla sekä B:n puuttuvalla ja omalla salasanalla.
Viivästetty A:n työ/vastaus ei saa vapauttaa B:n lähetyksiä tai muuttaa
B:n tilaa. SMTP:n tunnus- ja yrityssidonta todennetaan synteettisellä
kuljetuksella ilman oikeaa sähköpostilähetystä; salasanoja ei raportoida.
Nykyinen toisen yrityksen salaisuuden luku-/poistotesti ei yksin todista
tätä koko vaihto- ja viiveketjua. Sivun alun kohdenäyttö erottaa nyt oikean
Electron-vaihdon, IPC-kuittausviiveen ja synteettisen SMTP-eristyksen;
koko D:n integraatiohyväksyntä on edelleen avoin.

Sulkusopimuksen kutsujatarkistus kuuluu nykyisiin omistajiin:

| Kutsukohta | Ennen kytkentää vaadittu todiste |
| --- | --- |
| Mainin tavallinen lifecycle, yrityksen vaihto/create/import/replace ja update-sulku | Sulje salaisuuspyyntöjen pääsy valmistelussa, odota main-työ ennen backendin pysäytystä ja sulje transport vasta lopuksi. Sama ensimmäinen sulkutulos; epävarmuus estää clean-merkin ja jatkon. |
| `desktopComposition.ts`: live-palautuksen `stopBusinessRuntime` sekä startupin vastaava pysäytys | Nämä eivät saa ohittaa ehtoa kutsumalla backendin pysäytystä suoraan. Tarkistus on ennen profiilin muutosta tai palautusta. |
| `desktopComposition.ts`: startupin `validateAfterBackend`-kutsujen pysäytyscallbackit | Brokerin päättymistodiste on ennen callbackin jälkeistä rollbackia, ei vasta `relaunchRequired`-haaran lopussa. Tarkista myös ennen migraatioita tehtävä kutsu. |
| Startupin `relaunchRequired` ja catch/recovery | Ei profiilin muutosta, uuden brokerin käynnistystä tai varauksen vapautusta epävarman main-työn aikana; alkuperäinen virhe säilyy. |
| `backendRunner.ts`: normaali, update- ja restore-shutdown | Salaisuusoperaation ja auditin lopputulos tarkistetaan ennen clientin sulkemista tai SQLite-resurssien vapautusta. Clientin close tyhjentää odottavien joukon, joten sen jälkeinen tyhjyys ei ole todiste. |
| `desktopBeforeQuit.ts` | Uusi sulkupyyntö odottaa samaa tulosta. Rajattu sulkuvirheen käsittely voi johtaa koko sovelluksen poistumiseen, mutta ei todista hallittua sulkua tai nykytilan eheyttä. |

Edellä kuvattujen lähtökokeiden aikana sulkuvaihtoehtoja ei ollut kytketty
tuotantoon. Niiden jälkeen hyväksytty työpuun toteutus ja sen tämänhetkinen
näyttö on erotettu tämän sivun alussa; lähtökokeet eivät hyväksy kytkentää.

Sulkupäätöksestä erillinen 15 tapauksen jonokoe läpäisi. Koeehdokas käytti
nykyistä main-brokeria ja tiedostotallennusta: myöhäinen set/remove,
kadonnut kuittaus tai virheellinen vastaus eivät päästäneet seuraavaa
pyyntöä lähetykseen. Alkuperäinen pyyntöbudjetti säilyi myös jonotuksessa.
Koe ei vielä todista tuotannon runtime-sukupolvisidontaa, uusia mainin
tulosluokkia, auditia, Electronin IPC-rajaa tai mainin sulkemista. Nykyisen
protokollan virhevastaus käsiteltiin kokeessa varovaisesti tuntemattomana;
sitä ei hyväksytä lopullisen tulosluokituksen korvikkeeksi.

## Omistajat ja säilytettävät ehdot

- [Company Settings](../modules/company-settings.md) omistaa perustiedot,
  permissionit, salaisuusoperaation käyttötapauksen ja SQLiten lifecycle-auditin.
- [Sähköposti ja salaisuudet](email-delivery-and-secrets-plan.md) omistaa
  brokerin, salatun tallennuksen ja backend-only salaisuuden lukurajan.
- [Desktop](local-desktop-implementation-plan.md) omistaa prosessien ja
  profiilin elinkaaren. Main ei avaa business-SQLiteä.
- API-client validoi vastaukset; web näyttää tilan, ei päätä tallennuksen
  onnistumista tai myönnä uusia oikeuksia. Invoicingin toimitussäännöt säilyvät.
- CS-1: permission ja koko syöte validoidaan ensin. PUTin tilaluku tapahtuu
  ennen perustietojen ja auditin atomista kirjoitusta, ei commitin jälkeen.
  Tilaluvun häiriö ei nykyisessä sopimuksessa muuta tietoja tai auditia.
- CS-2: yksi tallennus kerrallaan; odotusaikana tehdyt uudet muokkaukset
  säilyvät. Vanhan session vastaus ei muuta uuden session tilaa.
- Normaali onnistuva perustietojen luku/tallennus ja salaisuuden
  set/status/remove säilyvät. Salaisuuden poisto ei poista perustietoja.
- Ei uusia riippuvuuksia, salasanan säilytysmallia, backup-formaattia,
  OAuth-provideria, yleistä manageria tai testialustaa. Ei oikeaa SMTP:tä,
  salasanoja tai käyttäjäaineistoa testeihin. Aika- ja CI-rajat säilyvät.

Toteuttaja lukee ensin juuri- ja kohde-AGENTS-ohjeet sekä
[aihekohtaisen lukureitin](../README.md). Desktopin, runtime-valtuuksien,
backupin tai diagnostiikan rajan koskettaminen edellyttää sen täysien
omistavien sopimusten lukemista; tämä suunnitelma ei korvaa niitä.

## Lähdehavainto ja vaikutusalue

Täydet polut ovat sovellusjuuresta; samassa solussa lyhennetty polku viittaa
edellä nimettyyn kansioon tai moduuliin. Ne nimeävät tarkastettavan omistajan,
eivät velvoita muuttamaan kaikkia mainittuja tiedostoja.

| Kohta | Nykyinen havainto | Ensisijaiset lähteet |
| --- | --- | --- |
| R07 | Epäonnistunut ensimmäinen GET päättää lataustilan mutta näyttää lomakkeen. Tallennus ei vaadi saman session onnistunutta alkulukua. | `apps/web/src/features/companySettings/CompanySettingsPageView.tsx`; nykyinen `companySettingsSavingJourneys.spec.ts`. |
| R14, transport | Client poistaa timeoutissa odottavan vastauksen. Mainin jo alkanut set/remove voi silti valmistua. Brokerin synkroninen `close()` ei odota aktiivista tiedostotyötä. | `apps/desktop/src/secrets/secretBrokerClient.ts`, `secretBrokerMain.ts`, `secretBrokerProtocol.ts`; `apps/desktop/src/runtime/backendRunner.ts` ja `apps/desktop/src/main/desktopComposition.ts`. |
| R14, tallennus | `write()` voi ilmoittaa virheen uuden current-tiedoston julkaisun jälkeisessä siivouksessa; `remove()` voi epäonnistua vasta osittaisen poiston jälkeen. Myös read/has voi vahvistaa recovery-slotin tai uudelleensalata sen. | `apps/desktop/src/secrets/encryptedSecretFile.ts`; `secretBrokerMain.ts`. |
| R14, audit | Store-poikkeus johtaa nykyisin failed-loppukuittaukseen, vaikka sivuvaikutus voi jäädä epäselväksi. Audit-loppukirjoituksen virhe jo säilyttää pending-rivin. | `apps/backend/src/modules/companySettings/application/executeCompanyEmailSecretOperation.ts`; moduulin audit-portti, SQLite-writer ja retention. |
| R16 | Commitin jälkeinen tilaluku on jo korjattu. GET odottaa yhä salaisuuden tilaa; sen häiriö estää myös perustietojen lukemisen. | `apps/backend/src/composition/companySettingsComposition.ts`; `application/updateCompanySettings.ts`; `packages/api-client/src/companySettings/`. |

Boolean `emailSecretConfigured` kulkee domain/read-mallista API-parseriin
ja webin form-malliin. SMTP- ja testilähetyksen saatavuus käyttävät sitä.
Oma yritys -salasanapaneelilla on erillinen `configured`-tilareitti.
Customers käyttää perustietovastauksesta oletustuntihintaa, Invoicing myös
asetuksia. Repositoryn oletus `false` ei ole todiste salaisuuden puuttumisesta.
Nykyistä erillistä salaisuuden tilareittiä ei voi siirtää kaikkien lukijoiden
käyttöön huomaamatta: se vaatii `manageCompanyEmailSecret`-permissionin ja
puuttuu selainkehityksestä. Oikeuksia ei laajenneta tämän työn sivutuotteena.

## D1: Perustietojen onnistunut alkuluku

**Toteutussuunta on rajattu; ei uutta business- tai tietomallipäätöstä.**

1. Sido onnistunut lataus nykyiseen muokkaussessioon ja latausyritykseen.
   Vain sen validoitu GET-vastaus saa alustaa lomakkeen ja sallia PUTin.
2. Estä tallennus itse käsittelijässä ja käyttöliittymässä ennen onnistunutta
   lukua. Älä näytä virheen jälkeen kirjoitettavia oletuksia tai edellisen
   session tietoja. Onnistunut tyhjä GET säilyy normaalina ensikäyttönä.
3. Tarjoa nimenomainen uudelleenluku. Ei automaattista tallennusta tai
   tallennuksen uusintaa. Vanha success/catch/finally ei muuta nykyistä tilaa.
4. Rajaa esto perustietolomakkeeseen. Erillisiä backup-, diagnostiikka- tai
   muiden asetusten polkuja ei suljeta tämän lomakkeen lukuvirheen vuoksi.

Laajenna nykyistä web-featureä, suomenkielisiä viestejä ja lisää alkuluvun
regressiot samaa fixtureä käyttävään `companySettingsLoadingJourneys.spec.ts`-
tiedostoon. Nykyinen `companySettingsSavingJourneys.spec.ts` säilyttää CS-2-kattavuuden.
Älä rakenna yleistä lomakeframeworkia. Clientin vaihtuminen tarvitsee
suoritettavan testin; pelkkä sivulta poistuminen ei todista samaa tapausta.

## D2: Salaisuusoperaation todellinen lopputulos

### D-P1: Hyväksytty epäselvän tuloksen jatkotapa

**Omistajan päätös 17.10.2026: rajattu epäselvä tila ja hallittu uudelleenkäynnistys.**
Timeoutia ei luvata peruutukseksi. Vain varmasti ennen vaikutusta hylätty
operaatio voidaan kirjata epäonnistuneeksi. Muut epäselvät tulokset jäävät
nykyiseen pending-auditiin, ja käyttäjälle kerrotaan epävarmuus.
Kaikki uudet ja vielä aloittamattomat jonotetut broker-operaatiot, myös
tilaluku ja salaisuuden käyttö SMTP:ssä, estetään kyseisessä epävarmassa
runtime-sukupolvessa. Jo alkanutta SMTP-toimitusta ei väitetä
perutuksi, eikä sen toimitushistoriaa muuteta. Muuta laskutusta ei estetä.

Jatkaminen edellyttää vanhan omistajan päättymisen todistavaa hallittua
uudelleenkäynnistystä ja salaisuuden nykytilan turvallista lukua. Tämä voi
palauttaa myös vanhan salaisuuden; epävarma poisto ei takaa sen poissaoloa.
Uusi käyttäjän vahvistama SMTP-lähetys saa käyttää tätä
validoitua nykytilaa. Salaisuuden uudelleensyöttöä ei pakoteta, mutta
käyttäjä voi tarvittaessa asettaa tai poistaa sen uudella nimenomaisella
operaatiolla. Tämä vapautusehto sisältyy D-P1-päätökseen. Jos jokaisen
epävarman muutoksen jälkeen vaaditaan uusi set/remove myös restartin yli,
sen pysyvä estotieto ja palautussäännöt on suunniteltava erikseen.
Sovellus ei käynnistä itseään automaattisesti
uudelleen eikä hävitä odottavia lomakemuokkauksia huomaamatta.

Purkamiskelvoton tai ristiriitainen sisältö ei muutu `false`-tilaksi eikä
restart lupaa korjata sitä. Mainin todettu exit poistaa vanhan suorittajan,
mutta ei yksin todista puhdasta sammutusta tai tiedostojen eheyttä.
Uusi käynnistys käy kaikki nykyiset validointiportit.

Nykytilan `hasSecret` ei todista vanhan operaation tulosta: vanha pending
säilyy ratkaisemattomana eikä muutu onnistumiseksi restartin perusteella.
Vanhoja pending-rivejä ei toisaalta tulkita ikuiseksi globaaliksi estoksi.
Pienimmässä vaihtoehdossa timeoutin jälkeinen vastaus sivuutetaan kuten
nykyisin; uutta taustalla tapahtuvaa auditin sovitusta ei lisätä.
Jos myöhemmin valitaan täsmällinen myöhäinen kuittaus, se tarvitsee erikseen
operaatio-/sukupolvisidonnan ja tietokannan elinaikasuojan. Suljettua
SQLiteä ei avata taustalta eikä uutta sessiota vapauteta vanhalla vastauksella.

**Haitta:** harvinainen epäselvä salasanamuutos voi vaatia käyttäjältä
uudelleenkäynnistyksen ja uuden syötön. Joidenkin vanhojen operaatioiden
tulos jää rehellisesti tuntemattomaksi. Nämä seuraukset kuuluvat hyväksyttyyn rajaukseen.

Vaihtoehto on pysyvä operaatiokohtainen kuittaus ja automaattinen sovitus.
Se tarvitsee myös poistetun salaisuuden tulostodisteen sekä erikseen
suunnitellut yhteensopivuus-, säilytys- ja palautussäännöt. Sitä ei lisätä
huomaamatta broker-korjaukseen. Pelkkä pidempi timeout, Promise-peruutus
tai automaattinen retry ei ratkaise kadonneen kuittauksen ongelmaa.

### Rajattu toteutussopimus

| Todettu tilanne | Audit ja vastaus |
| --- | --- |
| Permission/syöte hylätty ennen operaation aloitusta | Ei store-kutsua; nykyinen turvallinen hylkäys. |
| Pending-auditin luonti epäonnistuu | Ei store-kutsua eikä onnistumisväitettä. |
| Todistettu hylkäys ennen tiedostovaikutusta | Sama pending voidaan päättää failed-tilaan; turvallinen virhe. |
| Sama operaatio kuitataan valmistuneeksi ja auditin loppukirjoitus onnistuu | succeeded ja normaali onnistumisvastaus. |
| Timeout, katkennut kanava tai vaikutuksiltaan epäselvä tiedostovirhe | pending säilyy; turvallinen epäselvän tuloksen vastaus, ei automaattista uusintaa. |
| Tallennus kuitattu, mutta auditin loppukirjoitus epäonnistuu | Säilytä erillinen audit-incomplete-syy ja pending; älä ilmoita tallennuksen varmasti epäonnistuneen. |

Toteutus etenee kahdessa rajatussa palassa:

1. **Sopimus ja pieni kilpailukoe.** Nimeä backend-operaation,
   broker-pyynnön ja runtime-sukupolven sidonta sekä suljettu tulosluokitus.
   Käytä olemassa olevaa sarjallistettua brokeria ja virhekanavaa.
   Luokitus syntyy sivuvaikutuksen omistajassa; yleisestä virhekoodista ei
   arvata, oliko muutos jo tapahtunut. Tarkista myös epäonnistunut poisto
   ja commitin jälkeinen siivous. Ensimmäinen syy säilyy erillään siivouksesta.
2. **Kytkentä nykyisiin omistajiin.** Backend muuntaa todistetun tuloksen
   auditiksi ja turvalliseksi HTTP-vastaukseksi. Strict API-client ja
   salasanapaneeli erottavat tuntemattoman tilan puuttuvasta salaisuudesta.
   Vanha vastaus ei saa muuttaa uuden näkymän viestiä, tilaa tai lukkoa.

**Pakollinen elinkaaritodistus ennen tuotantokytkentää:** clientin close,
backendin exit ja mainin tiedostotyön päättyminen ovat eri tapahtumia.
Pelkkä backendin restart, uusi client tai suljettu portti ei aloita
turvallista uutta sukupolvea. Uusi broker, profiilin muuttaminen tai vanhojen resurssien siivous ei saa
alkaa ennen aktiivisen työn todettua päättymistä. Tämä sovitetaan nykyiseen
desktopin close-/workspace-omistajaan, ei uuteen valvojaan. Jonossa oleva
mutaatio ei saa käynnistyä suljetun omistajan jälkeen. Huomioi myös
read/has-kutsujen recovery- ja uudelleensalausvaikutukset.
Epävarma sulku säilyttää aineiston ja nykyiset suljetun virhepolun ehdot;
pelkkä odotuksen aikakatkaisu ei vapauta omistajuutta.

Kokeen on osoitettava muuttumaton onnistuva polku, timeout ennen työn alkua,
myöhäinen vaikutus, kadonnut kuittaus ja sulkeminen aktiivisen työn aikana.
Jos nykyisillä omistajilla ja aikarajoilla ei saada tätä todennettua,
pysähdy täsmälliseen vaihtoehtopäätökseen. Älä laajenna C:tä tai aloita
uutta yleistä lifecycle-hanketta.

### Kilpailukokeen tarkentama toteutussuunta

Seuraavat kohdat tarkentavat nykyisiin omistajiin rajattua ehdokasta.
Niiden toteutus- ja integraationäyttö on vielä avoin; sulkupolku riippuu
[edellä nimetystä päätöksestä](#d2n-lähtötilan-näyttö-ja-avoin-sulkupäätös).

- Ehdokkaassa nykyinen jaettu client lähettää yhden pyynnön kerrallaan. Seuraava ei
  lähde ennen nykyisen pyynnön identiteetin ja operaatiokohtaisen tuloksen
  validointia. Pelkkä yleisen vastausrakenteen validointi ei riitä.
  Nykyinen pyyntöbudjetti alkaa jonoon tulosta eikä käynnisty uudelleen
  lähetyksessä. Vanhentunut lähettämätön pyyntö ei saa lähteä viivästyneen
  ajastinkäsittelijän vuoksi.
- Lähetetyn pyynnön epäselvyys sulkee sukupolven ennen kutsujan kuittausta
  ja estää kaikki lähettämättömät pyynnöt. Viimeksi mainittujen oma
  vaikutuksettomuus voidaan todistaa. Main sulkee oman pääsynsä myös
  epäselvässä tiedostovirheessä tai kuittauksen lähetysvirheessä ennen
  seuraavan jonotetun työn aloitusta.
- Pyyntö ja vastaus sidotaan nykyiseen runtime-sukupolveen sekä täsmälliseen
  requestiin, operaatioon ja yrityskontekstiin. Backendin audit-operaation
  yhteys tähän kutsuun määritellään eksplisiittisesti. Suljettu tila ei saa
  nollautua luomalla uutta client-oliota; vanha vastaus ei vapauta sitä.
  Sisäinen protokollamuutos ei muuta salatun payloadin formaattia.
- Vaikutusluokitus syntyy mainin omistamassa työssä: ennen ensimmäistä
  mutatoivaa tiedostokutsua todistettu hylkäys erotetaan sen jälkeisestä
  epävarmuudesta. Read/hasin confirm ja uudelleensalaus ovat mutaatioita.
  Vain todistettu vaikutuksettomuus sallii backendin failed-loppukirjauksen.
- Nykyinen transport tarvitsee päättymishavainnon, joka sulkee pääsyn
  mutta ei väitä I/O:ta päättyneeksi. Sulkemisen virhe säilyy myös toisella
  close-kutsulla ja muiden sulkujen suoritus varmistetaan. Startupin
  recovery-/relaunch-haarassa suoja on oltava ennen profiilitiedostojen
  muuttamista, ei vasta brokerien loppusiivouksessa.

Kohdekokeen jälkeen todistetaan todellinen yksityinen IPC-raja sekä kaikki
saman brokerin sulkukutsujat. Pelkkä clientin yksikkötesti tai nykytilan
lähtökoe ei hyväksy tuotantokytkentää.

### Sulkusopimusehdotus kokeen jälkeen

**20.10.2026: omistajan hyväksymä toteutussopimus; kokonaiskytkennän näyttö on avoin.** Rajattu sulkukoe
läpäisi 17 tapausta ja tyyppitarkistuksen. Nykyisen muuttumattoman
salaisuustoteutuksen 24 testiä läpäisivät erikseen. Kokeessa käytettiin
nykyistä viestinkäsittelijää ja tiedostotallennusta; niiden ympärillä oleva
jono-/sulkuehdokas ja hallittu kello eivät muuta tuotantokoodia.
Katselmuksessa tarkennettiin aloittamattoman jonon välitöntä hylkäystä;
sama 17 tapauksen sarja ja tyypitys läpäisivät tarkennuksen jälkeen.
Lukumääriä ei lasketa yhteen uudeksi integraatiohyväksynnäksi.

Koe todentaa tyhjän sulun, viivästetyn set/remove-työn, read/has-palautuksen
ja uudelleensalauksen, ennen vaikutusta syntyvän virheen sekä julkaisemisen
jälkeisen epävarmuuden. Yhteinen määräaika ei nollaudu toisella sululla,
ja myöhäinen valmistuminen ei poista aiempaa estoa. Erilliset työtilat
eivät sekoitu samalla yritystunnisteella. Nykyisen lifecyclen koe osoittaa,
ettei backendin exit yksin riitä, jos mainin työ jää kesken.
Se ei vielä todista koko A -> B -> A -vaihtoa.

**Säilyvä toteutus:** backendin nykyinen permission-/audit-käyttötapaus,
yksityinen broker, mainin salaus ja nykyinen `EncryptedSecretFile` säilyvät
omistajina. Salasanan formaattia tai varmuuskopioiden sisältöä ei muuteta.
Nykyisiin omistajiin lisätään vain pääsyn sulku, työn päättymisen seuranta
ja täsmällinen tulos; ei uutta tallennus- tai elinkaarijärjestelmää.

1. **Pääsy kiinni.** Vahvistetun sulkutoiminnon valmistelussa main sulkee
   uudet ja aloittamattomat salaisuuspyynnöt heti. Jo alkanut työ säilyy
   nykyisen omistajan vastuulla. Lähettämätön hylkäys on vaikutukseton,
   mutta ei todista muun aktiivisen työn vaikutuksettomuutta.
2. **Yksi odotus.** Main-broker omistaa ensimmäisestä pääsyn sulusta alkavan
   viiden sekunnin monotonisen määräajan. Tyhjä tai aikaisemmin valmistuva
   työ jatkaa heti. Sama sulkutulos ja määräaika jaetaan kaikille kutsujille.
   Kello tarkistetaan myös valmistumisessa: viivästynyt ajastin ei oikeuta
   myöhäistä onnistumista. Tämä ei ole synkronisen työn pakkokeskeytys.
3. **Budjetit erillään.** Mainin odotus käynnistyy rinnakkain nykyisen
   HTTP-kirjoitusten enintään 30 sekunnin rauhoituksen kanssa, ei sen
   jälkeen lisättävänä odotuksena. Clientin nykyinen 10 sekunnin pyyntöraja
   ja backendin nykyinen 3 sekunnin hallitun pysäytyksen raja eivät kasva.
   Viisi sekuntia koskee mainin salaisuustyötä, ei koko yrityksen vaihtoa.
   GET/HEAD ei kuulu HTTP-kirjoituslaskuriin; esimerkiksi kadonnut tilaluvun
   vastaus voi edelleen estää turvallisen sulun. Rajat eivät ohita toisiaan.
4. **Vastaus ja audit loppuun.** Mainin työn päättyminen tai viestin
   lähetys ei vielä todista backendin vastaanottoa. Vastauskanava pidetään
   auki backendin nykyisen sulkukäsittelyn ajan. `backendRunner` tarkistaa
   ennen clientin sulkua koko omistetun salaisuusoperaation päättymisen,
   sen varmuustilan ja auditin loppukirjauksen. Havainto tulee nykyiseltä
   Company Settingsin käyttötapauksen omistajalta/compositionilta; uutta
   pysyvää kuittausjournalia ei lisätä. Pelkkä HTTP-yhteyksien päättyminen,
   clientin odotusjoukon tyhjeneminen tai store-kutsun valmistuminen ei riitä.
   Audit-incomplete ja aiempi epävarmuus eivät muutu onnistumiseksi.
5. **Jatkolupa vasta kokonaisuudesta.** Mainin päättymistodiste, backendin
   hyväksyttävä lopputulos ja todellinen exit sekä muut nykyiset omistajuus-
   ja palautusehdot tarvitaan yhdessä. Vasta silloin turvallinen profiilin
   vaihto/muutos voi edetä. Lopullinen porttien sulku ei korvaa näitä todisteita.
   Pakkopysäytystä ei tulkita salaisuusoperaation onnistumiseksi. Kaikki
   omistetut sulut yritetään virheessäkin, mutta ensimmäinen syy säilyy
   eikä epävarmaa varausta vapauteta tai profiilia siivota tämän perusteella.
6. **Käyttäjän palaute.** Varmasti onnistunut työ jatkaa alkuperäistä
   vahvistettua toimintoa kerran. Varmasti vaikutukseton tallennusvirhe
   sallii turvallisen yrityksen vaihdon muiden ehtojen täyttyessä, mutta
   epäonnistumisilmoitus näytetään ja kuitataan lähtöyrityksessä ennen
   uudelleenkäynnistystä. Käytetään nykyistä odotettavaa native-dialogia,
   ei itsestään katoavaa ilmoitusta tai salaisuuden siirtoa kohdeyritykseen.
   Ilmoituksen kuittaus ei ole uusi vaihdon vahvistus eikä kuluta mainin
   työbudjettia. Ilmoituksen epäonnistuminen ei saa johtaa hiljaiseen vaihtoon.
   Jos käyttäjä on jo tehnyt uuden nimenomaisen onnistuneen tallennuksen tai
   poiston, aiempaa vaikutuksettoman yrityksen ilmoitusta ei enää näytetä
   nykytilan virheenä. Pelkkä tilaluku ei kuittaa ilmoitustarvetta, eikä
   tämä muuta aiemman operaation audit-historiaa tai epävarman sulun estoa.
7. **Epävarmuus säilyy.** Ajan loppuminen, epäselvä vaikutus, auditin
   keskeneräisyys tai epävarma sulku estää vaarallisen jatkon. Myöhempi
   valmistuminen ei vapauta samaa epäonnistunutta sulkua. Jo suljettua
   sukupolvea ei palauteta aktiiviseksi yleisellä HTTP-rajoituksen
   poistolla. D-P1:n hallittu uusi käynnistys ja vanhan omistajan päättymisen
   todistus säilyvät; ohjelma ei käynnisty tai lähetä sähköpostia itse uudelleen.

**Viiden sekunnin perustelu ja näytön raja:** se on omistajan hyväksymä
lähtöarvo lyhyen paikallisen työn odottamiseen ilman välitöntä hylkäystä.
Hallittu koe osoittaa määräajan semantiikan, ei tuotannon viivejakaumaa tai
lupausta kaikkien töiden valmistumisesta siinä ajassa. Mahdollinen myöhempi
budjettimuutos tarvitsee näyttöä ja päätöksen, ei automaattista nostoa.

**Ennen tuotantokytkentää vielä todennettava:** nykyisellä IPC-fixturellä
viivästetyt muutokset, kadonnut/myöhäinen vastaus ja jo ennen sulkua syntynyt
timeout; oikean backend-käyttötapauksen audit-virhe/viive ja katkennut HTTP-
asiakasyhteys; kaikki yllä luetellut sulkukutsujat, myös startup ja live-restore;
ilmoituksen näkyminen sekä A -> B -> A -eristys. Main-kokeen suora Promise
ja sen dispose eivät todista transportin oikeaa elinaikaa tai auditia.
Kytkennän jälkeinen packaged-palautus sekä D:n nykyiset PR/main-portit säilyvät.
Rajattu riippumaton katselmus vahvisti tämän eron ja kutsujien tarkistuslistan.

## D3: Perustietojen saatavuus tilapalvelun häiriössä

### D-P2: Hyväksytty GET-käyttäytyminen

| Vaihtoehto | Hyöty ja seuraus |
| --- | --- |
| **A, pienin rajaus: säilytä nykyinen saatavuus** | Tilahäiriö estää yhä GETin ja PUTin. D1 estää virheellisen oletustallennuksen, CS-1 säilyy täysin. Käyttäjä voi joutua korjaamaan salaisuuspalvelun ennen perustietojen muokkausta. |
| B, erillinen perustietojen luku | Perustiedot voidaan näyttää tilahäiriössä. Tarvitaan hyväksytty erillinen projektio tai täsmällinen unknown-tila nykyiseen DTO:hon. PUT säilyy CS-1:n mukaisena; lukuvalmius ei lupaa tallennusvalmiutta. |
| C, erillinen luku ja tallennus | Perustiedot toimivat myös salaisuuspalvelun häiriössä, mutta tämä muuttaa hyväksytyn CS-1:n fail-closed-tilalukusääntöä ja molempien vastausten sopimuksia. |

**Omistaja hyväksyi vaihtoehdon A 17.10.2026.** Tämä on nimenomainen
saatavuusvalinta, ei väite R16:n kaikkien vaikutusten poistumisesta.
Vaihtoehdot B/C eivät kuulu D:n toteutukseen. Jos niitä myöhemmin harkitaan,
täsmennä ennen erillistä päätöstä DTO:n kaikki tuottajat ja
kuluttajat, permissionit, selainkehitys sekä SMTP:n unavailable-viesti.
Unknownia ei esitetä `false`-arvona tai merkitsemättömänä vanhana välimuistina.
Pelkkä kolmitilainen DTO ei rajaa loputtomasti odottavaa kutsua.

## Hyväksyntä ja testit

Käytä nykyisiä yksikkö-/sopimustestejä ja yhteisiä E2E-fixtureitä.
Uudet tapaukset lisätään oikeisiin ajokomentoihin ja
[testimatriisiin](r0-e2e-test-matrix.md#company-settings); testitiedoston
olemassaolo ei yksin todista ajamista.

| Taso | Vähimmäistodiste |
| --- | --- |
| D1, web | Pending/failed/malformed GET ei salli PUTia; onnistunut tyhjä GET toimii; käsin tehty uusi luku toimii; vanhat success/error/finally ja clientin vaihto eivät muuta nykyistä sessiota. CS-2:n uudet muokkaukset säilyvät. |
| D2, broker ja tiedosto | Hallittu viive ja menetetty kuittaus set/remove-operaatioissa, virhe ennen/jälkeen vaikutuksen, osittainen poisto, jonon sulku sekä aktiivisen read/has-recoveryn päättyminen. Todelliset testitavut verrataan, ei vain Promise-tulosta. |
| D2, backend ja HTTP | Oikea pending/failed/succeeded, auditin alku-/loppuvirhe, tuntematon tulos ja vanha operaatio; permission/yritys/session-raja. Ei uusia audit-rivejä myöhäisestä vastauksesta eikä false-successia. |
| D2, UI ja kuluttajat | Tuntematon tila ei näy puuttuvana salasanana; uudelleensyöttö-/restart-ohje, tuplapyyntö ja vanha session vastaus. Uusi salaisuutta tarvitseva SMTP-kutsu estyy, jo alkanutta toimitusta ei merkitä uudelleen. |
| D3 ja CS-1 | Valitun GET-säännön testit, precommit-tilaluku, pakollinen auditrollback ja muuttumaton persisted-response; ei commitin jälkeistä salaisuuskutsua. |
| Todellinen desktop | Backend -> yksityinen broker -> salattu tiedosto -> audit -> HTTP/UI. Salaisuuden synteettinen viive, close/restart ja uusi nimenomainen operaatio samalla testiprofiililla. Vanhasta pendingistä ei keksitä lopputulosta. |
| Palautus ja toimitus | Sama puhdas hardened Windows -paketti: backup -> inspect -> restore -> restart -> compare; konekohtaiset salaisuudet eivät siirry backupiin. Nykyinen native-/paketointi- ja CI-kattavuus säilyy. |

Nopeassa palautteessa käytetään pakettien nykyisiä Vitest-ajureita ja
tyyppitarkistuksia. Kokonaisportteina säilyvät `pnpm --filter @eky/backend test`,
`pnpm --filter @eky/desktop test`, `pnpm --filter @eky/api-client test`,
`pnpm --filter @eky/web test` sekä vaikutusalueen buildit ja nykyiset
`pnpm test:e2e:critical` / `pnpm test:e2e:electron:critical`-ajot.
Valmistelut, native-ajuri ja paikalliset komentopolut varmistetaan nykyisestä
runbookista. Koko D:n portit ovat edelleen avoimia; yllä mainittu D1:n
kohdenäyttö ei korvaa niitä.

## Palaute, diagnostiikka ja valmistuminen

- Käyttäjäviesti erottaa varmasti hylätyn muutoksen, epäselvän tuloksen ja
  auditin loppukirjoitusvirheen. Ei raakavirhettä tai salasanaa.
- Nykyinen turvallinen tapahtumaketju säilyttää vaiheen, suljetun syykoodin
  ja sivuvaikutuksen epävarmuuden. Jos tapahtuma/koodi muuttuu, päivitä
  [tapahtumakatalogi](r0-observability-event-catalog.md) ja testaa tarkoitettu
  writer -> reader -> HTTP -> client -> Diagnostics/tukipaketti -ketju.
- Pending/failed-salaisuusoperaatio ei muutu Activityn onnistuneeksi
  business-tapahtumaksi. Nykyinen retention säilyttää pending-aineiston.
- Julkiset lokit ja salattu testiaineisto noudattavat nykyisiä rajoja.
  Salaisuuksia, niiden tiivisteitä tai oikeita profiileja ei kerätä.
- D2:n virhepolkujen alkuperäinen testivirhe säilytetään nykyisellä
  virhekeräyksellä ennen yleiseksi virhekoodiksi muuntamista. Ennen
  kytkennän hyväksyntää pakotettu salaisuuksia sisältämätön virhe
  todennetaan nykyisen CI-keräyksen kautta puretusta salatusta paketista.
  Puuttuva aineisto tai kesken katkennut keräys raportoidaan sellaisena;
  salaus ei anna lupaa salaisuuksien tai profiilien keräämiseen.
- Kukin pala päivittää omistavan sopimuksen, testimatriisin ja lyhyen
  jatkamiskohdan. Korvattu toteutus poistetaan vasta kattavuuden todennuksella;
  rinnakkaista vanhaa ja uutta lifecyclea ei jätetä pysyvästi.

Loppukatselmus arvioi erityisesti unknown/failed-eron, aktiivisen työn
omistajuuden, sessionvaihdot ja muuttumattoman normaalikäytön. Sen jälkeen
jäädytetyn revision nykyiset PR-portit ja auditointi, normaali valtuutettu
merge sekä uuden mainin omat portit. Suunnitelma, paikalliset kohdetestit tai
yksi onnistunut koe eivät sulje D:tä. D:n jälkeen jatketaan roadmapin
seuraavaa pakettia, ei uutta testialusta- tai rakennesiivousta.
