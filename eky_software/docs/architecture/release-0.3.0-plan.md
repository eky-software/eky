# Eky 0.3.0 -julkaisusuunnitelma ja tehtävälista

## Päätös ja nykyinen tila

**Nykytila 2026-09-24: M0 hyväksytty, rajattu M1-valmistelu katselmoitu.**
PR #275 on yhdistetty normaalisti. Paikallinen `main`, etäinen `main` ja
hyväksytty lähtörevisio ovat
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
Seuraava toteutukseen ehdotettu pala on T1a/T1b; sen hyväksyntä ja toteutus
ovat vielä avoinna. Valmistelun valmistuminen ei sulje M1:n testikorjauksia.

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

## Julkaisuun sovitut tehtävät

| Tunnus | Tehtävä ja tavoite | Tila |
| --- | --- | --- |
| R030-01 | Yhtenäinen latausikoni tai odotusilmaisin näkyviin käyttäjälle havaittaviin odotustiloihin eri toiminnoissa. | Suunniteltu; käyttökohteiden kartoitus tekemättä. |
| R030-02 / W7 | Yritystyötilan turvallinen poistaminen käyttöliittymästä. | Mukaan sovittu; valmistelu ja päätösjono kirjattu. Sopimusten hyväksyntä ja toteutus avoinna. |
| R030-03 | Yrityksen nimi mukaan käyttäjän tallentaman varmuuskopion ehdotettuun tiedostonimeen päivämäärän lisäksi. | Suunniteltu; nimen lähde ja turvallinen nimeämissääntö päätettävä. |
| D029-01 | Työtilatoiminnon tarkka turvallinen virhesyy lokiin, esimerkiksi väärän yrityksen varmuuskopion hylkäys. | Puute todettu; korjaus tekemättä. |
| D029-02 | Päivitystapahtumat kulkemaan sovitusti diagnostiikan ja tukipaketin koko lukuketjussa. | Puute todettu; korjaus tekemättä. |
| D029-03 | Tukipaketin uusimpien tapahtumien valinta ajan mukaan eri lokilähteistä. | Puute todettu; korjaus tekemättä. |
| D029-04 | Tyhjä, osittainen ja epäonnistunut lokin luku eroteltaviksi. | Puute todettu; tila- ja kattavuussopimus päätettävä ennen korjausta. |
| D029-05 | Desktopin lokikirjoituksen häiriö näkyväksi turvallisesti. | Puute todettu; häiriöilmoituksen sopimus päätettävä ennen korjausta. |
| R030-04 | Käyttäjäilmoitusten tarkennus, erityisesti odotetut estot ja saman version päivitysyrityksen palaute. | Tarkistettava ja rajattava; saman version torjunta ei itsessään ole vika. |
| R030-05 | Muuttuvien toimintojen ohjeet ja lyhyt virhetilanteen tukiohje ajan tasalle. | Suunniteltu; tarkistetaan toteutusten yhteydessä. |
| R030-08 | Diagnostiikan vanhempien tapahtumien selaaminen nykyisen yhden otoksen ulkopuolelle sekä paluu uudempiin tapahtumiin. Näytettävä aikaväli, jatkon saatavuus ja mahdolliset lukurajat näkyviin. | Mukaan sovittu 2026-09-22; sivutuksen käyttöliittymä ja turvallinen lukusopimus suunniteltava ennen toteutusta. |

Diagnostiikan `D029-*`-tunnukset ja sen vanha tiedostonimi säilytetään
jäljitettävyyden vuoksi. Niiden tavoitejulkaisu on nyt `0.3.0`.
Tarkat havainnot ja hyväksyntäehdot ovat
[diagnostiikan täydennyssuunnitelmassa](diagnostics-0.2.9-completion-plan.md).

### R030-01: Odotustilojen latausilmaisin

Kartoita ensin nykyiset tilat ja puuttuva palaute: tietojen haku ja
tallennus, PDF:n valmistelu, varmuuskopiointi ja tarkistus, palautus,
yrityksen vaihto, päivityksen valmistelu sekä sähköpostin valmistelu ja
lähetys. Kartoitus ei tarkoita saman peittävän odotusikkunan lisäämistä
kaikkiin toimintoihin eikä liiketoimintalogiikan muuttamista.

- Ilmaisin sidotaan toiminnon todelliseen tilaan ja näytetään sopivassa
  kohdassa painikkeessa tai työalueella. Pelkkä harmaa painike ei kerro,
  että työ on käynnissä. Käytetään nykyisiä UI-käytäntöjä ilman uutta
  riippuvuutta tai koko käyttöliittymän refaktorointia.
- Aloituspalaute estää epävarmuuden ja tahattomat kaksoiskäynnistykset.
  Mahdollinen animaation näyttöviive sovitaan erikseen välkkymisen
  välttämiseksi; se ei viivytä toimintoa tai sen valmistumista.
- Tuntemattomalle kestolle ei näytetä keksittyä prosenttia. Ilmaisin ei
  väitä onnistumista eikä käynnistä automaattista uudelleenyritystä.
- Onnistuminen, virhe, peruutus ja aikakatkaisu lopettavat odotustilan
  asianmukaiseen palautteeseen. Epäselvä lopputulos kerrotaan epäselväksi;
  esimerkiksi lähetystä ei kehoteta toistamaan sokkona.
- Ikoni ja teksti eivät siirrä painikkeita tai muuta työalueen mittoja.
  Tarkistetaan näppäimistö, fokus, ruudunlukijan tilailmoitus ja vähennetty
  liike. Ilmaisin ei ole ainoa saavutettava tieto odottamisesta.
- Testaa nopea ja hidas onnistuminen, virhe, peruutus, kaksoispainallus ja
  näkymän vaihtuminen. Native-dialogeja tai uudelleenkäynnistystä vaativan
  toiminnon palaute suunnitellaan sen elinkaaren mukaan.

UI-vastuut säilyvät [UI-periaatteissa](../design/ui-principles.md) ja
[jaettujen komponenttien tiekartassa](ui-design-system-roadmap.md).

### R030-02 / W7: Yrityksen poisto

Poisto on tämän julkaisun vaadittu ominaisuus, ei valinnainen myöhempi lisä.
Toteutus noudattaa [ADR-0011:tä](../decisions/ADR-0011-local-multi-workspace-company-model.md)
ja [työtilasuunnitelman W7-vaihetta](local-company-workspace-plan.md#w7-workspace-deletion).
Ennen toteutusta ratkaistaan vähintään:

- aktiivisen, passiivisen ja viimeisen yrityksen poistaminen sekä
  virhe-/palautumistilassa olevan työtilan rajaus
- kirjoitusten esto, prosessien hallittu sulkeminen, nimen kirjoittamalla
  tehtävä vahvistus ja Electron mainin native-vahvistus
- tuore validoitu varmuuskopio tai ADR:n edellyttämä nimenomainen
  riskihyväksyntä; ei uutta piilotettua varmuuskopiointia
- quarantine-vaiheen tarkoitus, käyttäjälle näkyvä palautumismenettely,
  säilytys ja lopullinen poisto; väliaikaista turvavaihetta ei esitetä
  erillisen varmuuskopion korvaajana
- salaisuuksien, palautuspisteiden ja ulkoisten PDF-arkistojen käsittely
  niin, ettei muita työtiloja tai niiden tiedostoja poisteta
- keskeytyminen, levy-/kirjoitusvirhe, restart ja turvallinen recovery.

Julkaisu vaatii alemman tason testien lisäksi oikean paketoidun Windows-
polun synteettisellä aineistolla ja muiden yritysten säilymisen todistuksen.
Pelkkä poistopainike tai onnistuva normaalitapaus ei täytä tehtävää.

### R030-03: Varmuuskopion nimi

Yrityksen nimi helpottaa kopioiden erottamista. Ennen toteutusta sovitaan,
käytetäänkö työtilan näyttönimeä vai Oma yritys -tietojen nimeä ja mikä on
puuttuvan nimen varavaihtoehto. Nimi on ulkoista syötettä: pituus, Windowsin
kielletyt nimet/merkit ja polkuerottimet käsitellään omistavassa runtimessa.
Käyttäjä valitsee edelleen tallennuskohteen native-dialogissa.

Yrityksen nimi näkyy tiedostonimestä myös silloin, kun sisältö on salattu.
Tämä kerrotaan nimeämisen käyttöohjeessa. Nimeä tai kokonaista polkua ei
lisätä lokeihin tai tukipakettiin. Tiedostonimi ei osoita yritysten samaa
alkuperää: palautuksen lineage-tarkistus, salaus ja formaatti säilyvät.
Testaa myös pitkät ja samannimiset yritykset sekä olemassa olevan tiedoston
käsittely nykyisen turvallisen tallennussopimuksen mukaan.

### R030-08: Diagnostiikan historian selaus

Käyttäjä pääsee selaamaan säilyneitä vanhempia diagnostiikkatapahtumia
nykyisen ensimmäisen otoksen ulkopuolelle ja palaamaan uudempiin.
Pelkkä taulukon vierityspalkki tai nykyisen tapahtumarajan kasvattaminen
ei täytä tavoitetta. Tapahtumat haetaan rajattuina erinä, ei koko historiaa
kerralla. Tarkka sivutus ja käyttöliittymän ohjaimet sovitaan toteutussuunnittelussa.

Näytetään näkyvän erän aikaväli ja erotetaan saatavilla oleva jatko,
historian loppu sekä puuttuva tai osittain luettu aineisto. Säilytysajan
vuoksi poistuneita tapahtumia ei luvata palautettaviksi. Lataus-, virhe-
ja tyhjän tuloksen tilat sekä selauskohdan säilyminen huomioidaan.
Rajaus ei lisää lokien säilytysaikaa, raakalogien näyttöä tai uusia
hakusuodattimia. Tarkat turvallisuus- ja testiehdot ovat
[diagnostiikan suunnitelman R030-08-kohdassa](diagnostics-0.2.9-completion-plan.md#r030-08-diagnostiikan-historian-selaus).

## Mukana suunnittelussa, toteutusraja vielä päätettävä

| Tunnus | Aiemmin esiin noussut asia | Päätöstilanne |
| --- | --- | --- |
| R030-06 | Ensikäyttö ilman automaattista oletusyritystä: luo yritys tai tuo kopio. | Säilyy jatkotoiveena W7:n yhteydessä. Viimeisen yrityksen jälkeinen tyhjä tila on ratkaistava W7:ssä joka tapauksessa; ensiasennuksen laajempi muutos rajataan erikseen. Päivitys ei poista olemassa olevia yrityksiä. |
| D029-06 | Diagnostiikan Päivitä-toiminto, viimeisin onnistunut hakuaika ja osakohtainen virhetila. | Kirjattu suositus; mukaanotto päätetään ennen julkaisurajauksen lukitsemista. |
| R030-07 | Diagnostiikan virhe-/varoitussuodatus ja turvallisen virhekoodin kopiointi. | Valinnainen myöhempi lisä, ei muiden korjausten edellytys. |

## Muistissa mutta rajauksen ulkopuolella

- SMTP-salasanan suojaustavan parantaminen: erillinen arvio ja päätös;
  nykyistä salaisuusmallia ei muuteta tämän listauksen perusteella.
- Palautettavan varmuuskopion ja sitä uudempien merkintöjen yhdistäminen:
  jätetty ajatuksen tasolle. Nykyinen palautus ei yhdistä tietokantoja.
- Pilvipalvelut ensin ja työntekijän mobiilisovellus sen jälkeen ovat
  myöhempiä erikseen hyväksyttäviä kokonaisuuksia, eivät `0.3.0`:n sisältöä.
- Ei piilotettuja varmuuskopioita, yleistä tietokannan salausuudistusta,
  uusia sähköpostiprovidereita, laajaa refaktorointia tai uutta
  riippuvuutta tämän suunnitelman sivutyönä.

## Eteneminen ja seuranta

Tämä tiedosto omistaa kokonaisuuden työjärjestyksen ja työpakettien tilan.
Omistavat moduuli-, diagnostiikka-, backup- ja update-suunnitelmat omistavat
tarkat sopimukset. Yksityiset tutkimusraportit säilyvät muuttamattomina
todisteina: niiden historiallinen testitulos ei ole uuden version hyväksyntä.

### M0: Nykyinen työ mainiin ennen korjauksia

Testi-, PR- ja merge-ajot noudattavat pysyvää
[CI-seurantaohjetta](../ai/workflow.md#ci-ajon-seuranta-ja-virhetodisteet).
Ajonaikainen seuranta ei korvaa testin omaa vaihehavaintoa tai hyväksyntäporttia.

1. Varmista tuore paikallinen ja etärevision tilanne, PR ja sen kohdehaara.
   Tarkista nykyisen käyttäjätestauksen oikeasti kirjatut tulokset ja avoimet
   kohdat; testiohje ei yksin todista testien valmistumista.
2. Käy olemassa olevat dokumenttimuutokset läpi ja säilytä ne hallitusti.
   Älä tyhjennä työpuuta palauttamalla muiden muutoksia tai lisää yksityisiä
   raportteja Gitiin. Tarkista julkaistava sisältö ja staged diff.
3. Yhdistä hotfix-haara normaalia PR-menettelyä käyttäen. Täsmällisen
   PR-revision vaadittujen tarkistusten on valmistuttava hyväksytysti.
   Aiemman pilottitoimituksen poikkeus ei ole lupa ohittaa tarkistuksia,
   branch protectionia tai merge-ehtoja.
4. Odota myös täsmällisen merge-commitin vaaditut `main`-ajot. Kirjaa
   hyväksytty lähtörevisio ja aloita korjaukset siitä puhtaissa, rajatuissa
   `codex/`-haaroissa. Dokumenttimuutokset eivät saa kadota tässä siirtymässä.

Jos tarkistus epäonnistuu, on kesken tai peruutettu, portti ei ole läpäisty.
Jos portin läpäisy vaatii korjauksen jo ennen mergeä, pysähdy ja pyydä
omistajalta päätös rajattuun valmistelukorjaukseen: merge-first-järjestystä
ei vaihdeta hiljaisesti eikä tarkistusta poisteta esteen kiertämiseksi.

Puhdas työpuu tarkoittaa jäljitettävää integraatiopohjaa, ei tunnettujen
virheiden poistumista eikä uuden tuotantojulkaisun hyväksyntää. Alla olevat
korjaustehtävät säilyvät avoimina myös vihreän lähtötilan jälkeen.

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

### M1: Todistuksen ja päätösten valmistelu

**Tila 2026-09-24:** rajattu suunnitteluvalmistelu tehty ja katselmoitu
hyväksytyltä M0-pohjalta; M1:n testikorjaukset eivät ole vielä toteutettuja.
Tarkka jako on [M1-suunnitelmassa](release-0.3.0-m1-preparation-plan.md):
T1a/T1b testien ajokytkentä, T2 projektivalinta ja build-edellytykset,
T3 testiprosessien omistajuus sekä A1:n rajattu kohdekorjaus.
W7:n päätöslista on [työtilasuunnitelmassa](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti).
Nämä suunnitelmat eivät merkitse korjauksia tai hyväksyntätestejä tehdyiksi.

Korjaa ensin tarvittavat T-paketin testikytkennät ja testiruntimen
edellytykset, jotta myöhempien pakettien näyttöön voidaan luottaa. Tämä
ei tarkoita kaikkien CI-uudistusten tekemistä ennen ensimmäistä korjausta.
Testin olemassaolo, sen ajokytkentä ja sen todellinen läpäisy todennetaan
erikseen. Tutkimusprobe, jonka PASS tarkoittaa virheen toistumista, ei
ole korjatun toiminnon hyväksyntätesti.

Lukitse rajatun ensimmäisen korjauspalan sopimus ja tarvittavat alla
luetellut omistajapäätökset. W7:n suunnittelu aloitetaan tässä, jotta poiston
päätökset eivät jää julkaisun loppuun; sen toteutus odottaa tarvittavaa
lifecycle-, backup- ja diagnostiikkapohjaa. Kaikkia päätöksiä ei tarvitse
ratkaista samassa keskustelussa.

### M2: Datan eheys ja turvallinen elinkaari

Ensimmäinen korjausaalto on A:n kohde-identiteetti, B:n lasku-/PDF-/
toimitusrevision sopimus, C:n update-/shutdown-/kirjoitussuojan rajat sekä
K:n varmuuskopion luottamus- ja resurssiraja. Nämä valmistellaan pieninä,
erikseen todennettavina muutoksina, ei yhtenä suurena refaktorointina.
Työpakettien kirjaimet eivät ole koodimoduuleja tai uusia palveluita.

| Paketti | Katselmuksen tunnukset | Omistaja ja suunniteltu hyväksyntä |
| --- | --- | --- |
| T: Testitodisteen luotettavuus | R27, R28, R29 | Desktop/E2E-harness ja CI-kytkentä: kaikki tarkoitetut testit ajettaviin komentoihin; testiprojektin prerequisite-buildit puhtaasta checkoutista; koko omistetun prosessipuun poistuminen, myös juuren ensin poistuessa. |
| A: Luonnoksen kohde ja asynkroninen UI | R01, R05, R06 | Invoicingin web-feature: tallennus pysyy oikeassa kohteessa, ensimmäinen create säilyttää luonnoksen ID:n, vanha readiness ei hyväksy muuttunutta lomaketta. Viivästetyt/väärässä järjestyksessä valmistuvat vastaukset ja backendin pysyvä jälkiluku. |
| B: Laskun sisältö ja toimitus | R02, R08, R12, R13; S030-03, S030-04, S030-05 | Invoicing omistaa snapshotin, PDF:n ja toimituksen revision; SMTP-adapteri protokollan. Vain oikea revisio voidaan julkaista/toimittaa/kuitata; epävarma toimitus säilyttää todisteensa. Hyvitykset käyttävät auktoritatiivista ALV-pyöristystä, lopullinen SMTP-kuittaus säilyy lopputuloksena ja parseri on chunk-jaosta riippumaton. |
| C: Desktopin elinkaari ja päivitys | R03, R04, R17, R18, R19 | Electron mainin olemassa olevat koordinaattorit: graceful-only update, katkeamaton kirjoitussuoja palautuspisteestä handoffiin, todettu prosessin exit ennen seuraavaa omistajaa, tuotantoon kytketty create/import-recovery ja yhdenmukainen build-/manifest-revisio. Todellinen composition ja oletuspaketointi testiin. |
| K: Varmuuskopion turvallinen tarkistus | S030-01, S030-02 | Backup-infrastruktuuri, backendin migration/schema- ja moduulien validointiportit: tuodun kannan schema todennetaan hyväksyttyyn versioon; epäluotetun tarkistuksen työ ja tulokset rajataan erilleen business-runtimesta. Tuonti, korvaus, inspection ja recovery testataan erikseen. |

### M3: Muut invariantit, diagnostiikka ja ylläpidettävyys

| Paketti | Katselmuksen tunnukset | Omistaja ja suunniteltu hyväksyntä |
| --- | --- | --- |
| D: Yritysasetukset ja salaisuusoperaatiot | R07, R14, R16 | Company Settings, oma web-feature ja yksityinen secret-broker: epäonnistunut luku ei oikeuta tyhjien oletusten tallennusta; timeout ja myöhempi sivuvaikutus sovitetaan; vastaus ja audit vastaavat todellista commitia. Tämä ei ole salasanan säilytysmallin uudistus. |
| E: Asiakasinvariantit | R09, R10, R11 | Customers: viitatun asiakastyypin muutos sovitulla säännöllä, numeroinnin tarkkuus ja loppuraja, turvallinen suomenkielinen tuntemattoman virheen fallback. Yrityseristys ja normaalit käyttötapaukset säilyvät. |
| F: Frameworkin virheketju | R15 | Backendin HTTP/observability-koostaminen: oikean framework-ketjun vastaus, rakenteinen loki ja konsoli käsitellään turvallisesti. Paketoidun stdion hiljaisuus ei yksin todista sanitointia. |
| G: Diagnostiikan tapahtumaketju | R20, R23; D029-01, D029-02 | Desktopin observerit ja Diagnosticsin projektiot: syy/vaihe säilyvät turvallisesti; tarkoitetut update- ja PDF-arkistotapahtumat kulkevat writer -> reader -> HTTP -> strict client -> UI/tukipaketti -ketjun. Tarkoitukselliset poissulut dokumentoidaan. |
| H: Diagnostiikan saatavuus ja oikeellisuus | R21, R22, R24, R25, R26; D029-03, D029-04, D029-05 | Lokihuolto, lukijat ja diagnostiikan tilasopimus: lukuvirhe ei estä tervettä startupia, tuleva päivä ei syrjäytä kelvollista historiaa, eri lähteistä valitaan aidosti uusimmat tapahtumat, osittaisuus erotetaan tyhjästä ja writer-häiriöllä on turvallinen ei-rekursiivinen fallback. |
| I: CI-politiikka ja ajantasaiset sopimukset | R30, R31 | CI:n riskiluokitus ja omistavat dokumentit: mahdollinen raskaan matriisin rajaus hyväksytään erikseen, tuntematon vaikutus fail-closed. Integration-matriisi, E2E-strategia ja lifecycle/recovery-ohjeet erottavat nykyisen tuotantokytkennän historiallisesta foundation-vaiheesta. |

R01-R31 esiintyvät yllä kukin yhdessä omistavassa paketissa. D029-kohdat
ovat samoja töitä G/H-paketeissa, eivät toinen korjausjono. PDF-arkiston
katalogisopimus ja retentionin reunaehdot täydentävät D029-listaa; niitä ei
kuitata valmiiksi pelkän vanhan diagnostiikkalistan läpäisyllä.

Kaikkien T/A/B/C/K/D/E/F/G/H/I-pakettien tila on **suunniteltu / korjaus ja
hyväksyntä tekemättä**. Päätösportin vaikutusalue odottaa hyväksyntää.

I-paketin dokumentaatiokatselmukseen kuuluu myös ohjelmanosittainen
ohjeiden löydettävyys: juuri- ja paikalliset `AGENTS.md`-tiedostot,
moduulivastuut, ADR:t sekä testaus-/diagnostiikka-/turvallisuusohjeet
muodostavat ehjän lukureitin. Aliagentit voivat tarkistaa eri alueet;
pääagentti kokoaa havaitut linkki-, ankkuri-, päällekkäisyys- ja
ajantasaisuuspuutteet sekä varmentaa korjaukset. Koko ohjeverkon katselmus
on vielä tekemättä. Se täydentää jokaisen tehtävän pysyvää
[ohjeiden tarkistusvelvoitetta](../ai/workflow.md#työn-aloitusjärjestys),
ei siirrä sitä myöhemmäksi tai rajoita sitä 0.3.0-julkaisuun.

Rajattu lukureittikatselmus 2026-09-24: pysyvä aloitus- ja CI-seurantaohje
on linkitetty juuri-ohjeeseen, testaukseen ja tarkistuslistaan. Kahden
aliagentin katselmuksessa täydennettiin desktop-/E2E-, moduulihakemisto-,
PDF- ja workspace-lukureittejä sekä oikaistiin UI-paketin vanha ohjaus
olemassa olevaan tiekarttaan. Muutettujen ohjeiden paikalliset linkit ja
otsikkoankkurit tarkistettiin rajatusti. Tämä ei hyväksy koko I-pakettia,
M0:aa tai kaikkien ohjeiden sisällön ajantasaisuutta.
Yksittäiset R- ja S030-tunnukset säilytetään paketin toteutusseurannassa;
osittainen paketti ei sulje koko ryhmää. Jos jokin havainto kumoutuu tai
rajataan myöhemmäksi, kirjaa vastanäyttö tai omistajan päätös ja jäännösriski.

### Skannauksen tuoma täydennys

Osittaisen, keskeytetyn Deep Scanin tallennetut tulokset täydentävät katselmusta;
ne eivät ole valmis koko repositorion turvatarkastus tai korjaustodiste. Sen
päällekkäiset havaintoinstanssit on ryhmitelty alla vain työn suunnitteluun.
Alkuperäisiä löytötunnuksia, vakavuusluokkia, näyttöä ja kattavuusaukkoja
ei kirjoiteta uudelleen. Tarkka vastaavuus säilyy yksityisessä liitteessä.
Raportin korjausehdotus ei tarkoita toteutettua tai testattua patchia.

M1-valmistelussa tallennetut 13 havaintoinstanssia ja korjausehdotukset
luettiin uudelleen lisäosasta. Ajon tila on yhä `canceled`, eikä suljettua
loppuraporttia ole saatavilla. Alla oleva viiden ryhmän työjako säilyy;
alkuperäisiä vakavuusluokkia tai validointirajoituksia ei yhdistetä uudeksi
skannerin tulokseksi. Nykyisen mainin tuotantolähteet näillä alueilla eivät
ole muuttuneet skannauksen jälkeen; tämä vertailu ei ole uusi runtime-testi.

| Tunnus | Suunniteltu turvasopimus | Suhde muuhun työhön |
| --- | --- | --- |
| S030-01 | Salattu ja checksum-tarkistettu tuonti ei yksin todista SQLite-scheman luotettavuutta. Todennetaan todelliset sallitut objektit ja määrittelyt version mukaan ennen epäluotettuja relaatiokyselyitä, kirjoitettavaa avausta tai migraatiota. | K:n uusi velvoite; sekä import-as-new että same-lineage-korvaus. Säilytetään hyväksytyt historialliset prefixit ja oikeat guard-triggerit. |
| S030-02 | Epäluotetun kannan tarkistus ei saa jumittaa aktiivista business-runtimea. Aika-, resurssi- ja tulosrajat sekä todettu tarkistusprosessin päättyminen ennen cleanupia/uudelleenkäyttöä. | K:n erillinen saatavuusraja, hyödyntää C:n prosessiomistajuutta ja T:n todistusta. Promise-timeout ei ole työn keskeytyksen todiste. |
| S030-03 | Toimitus varaa ja kuittaa täsmällisen muuttumattoman revision/document-identiteetin; attempted/outcomeUnknown ei oikeuta todisteen tuhoamiseen. | Laajentaa R02:ta B-paketissa; epävarma lopputulos ja restart mukana. |
| S030-04 | Asynkroninen PDF julkaistaan ja käytetään uudelleen vain sitä vastaavalle snapshotille; vanha kirjoittaja ei korvaa tai siivoa uutta artifactia. | B:n oma PDF-raja, ei pelkkä SMTP-korjauksen sivuvaikutus. |
| S030-05 | Peruuttaminen ja lähetyksen varaus ratkaistaan atomisesti. Jos peruutus voittaa, provideria ei kutsuta; varauksen jälkeen sovittu esto säilyy. | B:n toimitusta edeltävä raja; asiakaslähetys ja testilähetys testataan erikseen. |

Säilytetään nykyinen local-owner-, yritys-, permission- ja native-
vahvistusraja. Näistä havainnoista ei päätellä internetistä saavutettavaa
palvelua, käyttöjärjestelmän koodinsuoritusta tai yritysrajan ohitusta.
Katselmuksen correctness-havainto voi silti vaatia korjauksen, vaikka
skanneri ei vahvista sille erillistä hyökkääjän käyttämää turvavaikutusta.

Skannauksen keskeneräiset hypoteesit erotetaan korjausjonosta. A/B:n
regressioihin lisätään vanhentuneen sähköpostiesikatselun kohdevaihto, C:n
fault-testeihin saman scheman rollback ja keskeytyneet hyväksyntävaiheet.
Mainin pyyntörungon muistiraja, lokimäärän resurssiraja ja testipolkujen
containment jäävät rajatuiksi tarkistustehtäviksi, eivät vahvistetuiksi
uusiksi haavoittuvuuksiksi. Niille kirjataan näyttö tai rajauspäätös.
Lukematta jääneet lähteet, Windowsin native-käyttäytyminen ja ajantasaiset
riippuvuustiedot kuuluvat loppukatselmuksen kattavuuslistaan.

### Päätökset ennen niiden vaikutusalueen toteutusta

- K: versionmukaisen schema-attestoinnin omistaja ja kanonisointi,
  historiallinen yhteensopivuus sekä kertakäyttöisen backend-utilityn
  aikaraja, resurssirajat, exit-todiste ja virhesopimus. Ensisijainen
  suunnittelusuunta on nykyiseen omistajuuteen rajattu attestointi ja
  eristetty tarkistus, ei koko tietokannan uudelleenrakennus tai mainin
  SQLite-ajuri. Pelkät PRAGMA-asetukset eivät korvaa näitä sopimuksia.
- B: revision/document-hashin atominen varaus, PDF:n ehdollinen julkaisu,
  toimituksen epävarmuuden sovitus ja tarvittava metadata/migraatio.
  Suositus on Invoicingin oma pieni elinkaarisopimus, ei yleinen
  manager-kerros tai globaali lukko. SMTP-verkkokutsua ei pidetä avoimen
  SQLite-transaktion sisällä. Hyvityksen laskenta seuraa hyväksyttyä
  laskentasopimusta; epäselvä pyöristysratkaisu hyväksytään ensin.
- D/E: secret-operaation todennettu peruutus tai epävarman tilan sovitus,
  asetusten osittaisen saatavuuden palaute, viitatun asiakastyypin muutoksen
  esto tai hallittu siirto sekä numeroinnin loppurajan käyttäytyminen.
- G/H: turvalliset tapahtumaprojektiot, kattavuus-/häiriötila, fallback ja
  sivutuksen vakaa järjestys. I:n CI-riskiluokituksen keventäminen on
  erillinen päätös, ei korjausten edellyttämä automaattinen poikkeus.
- R030-02/W7 ja R030-03: yllä luetellut poisto-/recovery-päätökset ja
  backup-nimen lähde. R030-06, D029-06 ja R030-07 säilyvät omissa
  päätösluokissaan, eivät muutu pakollisiksi tämän roadmapin perusteella.

Turvallisuus voi edellyttää sopimuksen täsmennystä tai ADR-muutosta.
Kirjaa silloin nykyinen sääntö, ristiriita, ehdotettu muutos, vaikutus ja
testi-/palautumissuunnitelma; pyydä omistajan päätös ennen toteutusta.
Raportti tai agentin ehdotus ei kumoa ohjeita. Uusi riippuvuus vaatii aina
oman hyväksyntänsä. Yhteinen apu lisätään vain todelliseen toistuvaan
sopimukseen, ei tyhjien shared-pakettien täyttämiseksi tai tarkoituksellisen
luottamusrajavalidoinnin poistamiseksi.

### M4: Sovittu 0.3.0-käyttäjäkokemus

Toteuta korjatun pohjan päälle R030-01, R030-02/W7, R030-03 ja R030-08
rajattuina muutoksina. Diagnostiikan selaus tarvitsee G/H:n oikean lukuketjun
ja kattavuustiedon; W7 tarvitsee C/K:n turvallisen lifecycle/recovery-pohjan.
Ilmoitukset ja ohjeet R030-04/R030-05 valmistuvat jokaisen muutoksen mukana,
eivät vasta lopun kosmeettisena vaiheena. Latausikoni tai UI-esto ei korvaa
backendin invarianttia, atomista varausta tai prosessin exit-todistetta.

### M5: Uusi katselmus, Deep Scan ja julkaisuportti

Jokaisessa paketissa käytetään
[toiminnon valmistumisporttia](../ai/workflow.md#toiminnon-valmistumisportti):
oikeaa käyttäytymistä odottava regressio, todellinen runtime-kytkentä,
onnistuminen/esto/virhe/peruutus, turvallinen jäljitettävyys, sovitut
diagnostiikka- ja tukiprojektiot, ilmoitukset, ohje ja palautettavuus.
Uusi toiminto tuo nämä mukanaan eikä vain onnellisen polun testiä.

Koko korjaus- ja ominaisuuskokonaisuuden valmistuttua tehdään uusi vastaavan
laajuinen arkkitehtuuri-/ylläpidettävyyskatselmus ja uusi Codex Security
Deep Scan `Ultra`-päättelyllä. Ajankohta on 0.3.0-toteutuskokonaisuuden
jälkeen mutta ennen lopullista toimitushyväksyntää. Ajo on uusi erikseen
käynnistettävä tarkistus täsmälliseen ehdokasrevisioon, ei keskeytetyn ajon
automaattinen jatko tai tämän suunnitelmatyön sivutoimi. Varmista silloin
työkalun saatavuus ja asetukset; päättelytaso ei itsessään todista kattavuutta.

Loppuportti vaatii lisäksi:

- R01-R31- ja S030-01-S030-05-kohtaisen ratkaisun ja todisteen tai
  nimenomaisen omistajan rajauspäätöksen; ei pelkkää ryhmän sulkemista
- uusintaskannauksen havaintojen ja kattavuusaukkojen käsittelyn;
  peruutettua/osittaista tulosta ei kutsuta läpäistyksi täydeksi skannaukseksi
- tuoreet soveltuvat unit-, integration-, API-/sopimus-, system-, web- ja
  Electron-testit sekä ajantasainen riippuvuus- ja toimitusketjutarkistus
- backup/restore-/SQLite-/artifact-/profiili-/process lifecycle -muutoksille
  hardened Windows packaged backup -> inspect -> restore -> restart ->
  compare synteettisellä profiililla; vanha session torjutaan, salaisuudet
  eivät siirry ja muiden yritysten tiedot säilyvät
- erilliset installer/update/rollback-portit sekä tarvittavat keskeytys-,
  fault-, endurance- ja vähintään 30 minuutin soak-ajot nykyisten
  [testausohjeiden](../ai/testing-rules.md) ja omistavien harness-sopimusten mukaan
- käyttäjätestauksen päivitetyt, oikeasti raportoidut tulokset ja muuttuneiden
  polkujen uusinnat; vanhan version hyväksyntä ei siirry automaattisesti
- puhtaan commitin versionoston `0.3.0`:aan
  [versiointiohjeen](release-versioning-policy.md) mukaan, täsmällisen
  release-revision PR/main-portit sekä build-once-artifactin hyväksynnän:
  samoja testattuja tavuja käytetään hyväksyntäkuluttajissa ja toimituksessa.

Jos loppukatselmus muuttaa koodia, regressiot, vaikutusalueen turvatarkistus
ja tarvittavat packaged-portit uusitaan muuttuneelle revisiolle. Vanhan
ehdokkaan raportti ei hyväksy uutta buildia. Versioita ei nosteta jokaisen
työpaketin kohdalla; välijulkaisu vaatii oman päätöksensä.

Pidä tunnukset vakaina. Päivitä tehtävän tila työn edetessä:
`suunniteltu`, `päätös tarvitaan`, `toteutuksessa`, `toteutettu / testaus kesken`
tai `hyväksytty`. Hyväksyntään liitetään turvallinen testiviite ja tieto
siitä, onko muutos mukana toimitetussa julkaisussa. Ei todisteettomia
valmismerkintöjä eikä koko listan kuittaamista yhden testin perusteella.

Uusi toive lisätään joko sovittuun sisältöön, päätettäviin tai myöhempiin
asioihin. Julkaisurajaus muuttuu vain omistajan päätöksellä, ei listan
hiljaisella kasvattamisella tai sovitun yrityspoiston poistamisella.
