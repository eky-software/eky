# Eky 0.3.0 -julkaisusuunnitelma ja tehtävälista

## Päätös ja nykyinen tila

[Nykyinen jatkamiskohta ja hyväksyntänäyttö](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Tämä roadmap omistaa julkaisun sisällön ja työjärjestyksen.

<details>
<summary>Aiemmat osiot ja pysyvät historialinkit</summary>

<p><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l1">Eky 0.3.0 -julkaisusuunnitelma ja tehtävälista (historia)</a></p>
<p><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l3">Päätös ja nykyinen tila (historia)</a></p>
<p><a id="pr-298n-hyväksyntää-edeltävä-toteutushistoria"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l280">PR #298:n hyväksyntää edeltävä toteutushistoria (historia)</a></p>
<p><a id="pr-282n-valmisteluhistoria"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l467">PR #282:n valmisteluhistoria (historia)</a></p>
<p><a id="integraatiota-edeltävä-checkpoint-2026-09-28"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l618">Integraatiota edeltävä checkpoint 2026-09-28 (historia)</a></p>
<p><a id="aiemmat-checkpointit"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l659">Aiemmat checkpointit (historia)</a></p>
<p><a id="aiemmat-checkpointit-ja-päätösnäyttö"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l789">Aiemmat checkpointit ja päätösnäyttö (historia)</a></p>
<p><a id="m0n-historiallinen-tapahtumaketju"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l901">M0:n historiallinen tapahtumaketju (historia)</a></p>

</details>

## Julkaisuun sovitut tehtävät

| Tunnus | Tehtävä ja tavoite | Tila |
| --- | --- | --- |
| R030-01 | Yhtenäinen latausikoni tai odotusilmaisin näkyviin käyttäjälle havaittaviin odotustiloihin eri toiminnoissa. | M4.1 hyväksytty PR #317:n ja uuden mainin omilla porteilla 24.10.2026. Tarkka näyttö ja avoimeksi jäänyt ensimmäinen Electron-timeout ovat M1:n jatkamiskohdassa. |
| R030-02 / W7 | Yritystyötilan turvallinen poistaminen käyttöliittymästä. | W7.0:n sopimus-/koevaihe sekä W7.1-W7.4 hyväksytty aiemmilla omilla porteillaan. Myös W7.5:n näkyvä poisto, turvallinen lopputulos ja rajattu tukivienti on hyväksytty [PR #330:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/330#issuecomment-6880745021) ja uuden mainin omilla porteilla 14.11.2026. Vanhat syy- ja siivousepävarmuudet säilyvät avoimina, eivät korjattuina. |
| R030-03 | Yrityksen nimi mukaan käyttäjän tallentaman varmuuskopion ehdotettuun tiedostonimeen päivämäärän lisäksi. | M4.2 hyväksytty PR #318:n ja uuden mainin omilla porteilla 24.10.2026. Nimeämis- ja palautusnäyttö sekä rajatun runtime-tietoturvapäivityksen hyväksyntä ovat M1:n jatkamiskohdassa. |
| D029-01 | Työtilatoiminnon tarkka turvallinen virhesyy lokiin, esimerkiksi väärän yrityksen varmuuskopion hylkäys. | K:n syyketju ja G:n täydentävä kattavuus hyväksytty. G:n rajaus ja erilliset PR/main-portit: PR #314:n loppuhyväksyntä M1:n kautta. |
| D029-02 | Päivitystapahtumat kulkemaan sovitusti diagnostiikan ja tukipaketin koko lukuketjussa. | G:n sovitut perhekohtaiset projektiot ja poissulut hyväksytty PR #314:n PR/main-porteilla. Ei yleinen lupa julkaista writerin kaikkea metadataa. |
| D029-03 | Tukipaketin uusimpien tapahtumien valinta ajan mukaan eri lokilähteistä. | H3 hyväksytty PR #315:n ja uuden mainin omilla porteilla; loppuhyväksyntä M1:n kautta. |
| D029-04 | Tyhjä, osittainen ja epäonnistunut lokin luku eroteltaviksi. | H4:n lukutilat ja todellinen lukuketju hyväksytty H:n PR/main-porteilla. Rajatun luvun kattavuutta ei väitetä koko historian terveydeksi. |
| D029-05 | Desktopin lokikirjoituksen häiriö näkyväksi turvallisesti. | H5:n ei-estävä ilmoitus, incident-yritys ja todellinen main/preload/UI-ketju hyväksytty H:n PR/main-porteilla. |
| R030-04 | Käyttäjäilmoitusten tarkennus, erityisesti odotetut estot ja saman version päivitysyrityksen palaute. | M5-valmistelussa täsmättävä nykyisiin toteutuksiin ja käyttäjäpolun näyttöön; ei vielä suljettu koko tehtävänä. Saman version torjunta ei itsessään ole vika. |
| R030-05 | Muuttuvien toimintojen ohjeet ja lyhyt virhetilanteen tukiohje ajan tasalle. | Muuttuneiden alueiden ohjeita on päivitetty paketeissa; M5-valmistelussa todennettava kokonaiskattavuus ja lyhyt tukiohje. Ei vielä koko tehtävän loppuhyväksyntää. |
| R030-08 | Diagnostiikan vanhempien tapahtumien selaaminen nykyisen yhden otoksen ulkopuolelle sekä paluu uudempiin tapahtumiin. Näytettävä aikaväli, jatkon saatavuus ja mahdolliset lukurajat näkyviin. | M4.3 hyväksytty [PR #319:n loppupäätöksellä](https://github.com/eky-software/eky/pull/319#issuecomment-6385011410), mukaan lukien samojen Windows-pakettitavujen selaus/palautus sekä täsmällisen PR:n ja uuden mainin omat portit. Avoimet ensihylkäykset säilyvät erillisinä. |

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
Omistaja hyväksyi 23.10.2026 suunnaksi myös vikatilaisen yrityksen tietojen
ja SMTP-salaisuuden poiston ilman piilokopioita. Quarantine on saman
poistotoiminnon välivaihe; keskeytynyt poisto ei ole onnistuminen.
Aktiivisen yrityksen onnistuneen poiston jälkeen palataan yritysvalintaan
ilman toisen yrityksen automaattista avausta. Viimeisen jälkeen tarjotaan
luonti tai tuonti ilman automaattista oletusyritystä.
Omistaja hyväksyi myös [yritysvalitsimen nimien yksilöllisyyden](local-company-workspace-plan.md#yritysvalitsimen-nimien-yksilöllisyys)
luonnissa, tuonnissa ja nimenmuutoksessa kirjainkoko- ja välilyöntivariantteineen.
Vanhat samannimiset säilytetään huomautuksella ilman automaattista
nimeämistä, yhdistämistä tai poistoa; tekninen erottelu säilyy työtilasuunnitelman mukaan.
Ulkoiset PDF-arkistokopiot ja käyttäjän vientibackupit säilyvät. Omistaja
hyväksyi aloitettujen lopullisten poistojen automaattisen jatkamisen
restartissa vain varmasti todetulle kohteelle, omistajuudelle ja
keskeytystilalle; epävarma tilanne pysyy keskeneräisenä.
Tarkka [poistoperiaate ja avoimet rajat](local-company-workspace-plan.md#w7n-hyväksytty-poistoperiaate)
omistetaan työtilasuunnitelmassa, ei uutena rinnakkaisena sopimuksena täällä.
Hyväksytty W7-toteutus säilyttää vähintään seuraavat sopimukset;
ne eivät ole uusi toteutusta edeltävä päätöslista:

- aktiivisen, passiivisen, viimeisen ja vikatilaisen yrityksen poiston
  tekninen sopimus sekä keskeytys- ja virhepolut
- kirjoitusten esto, prosessien hallittu sulkeminen, nimen kirjoittamalla
  tehtävä vahvistus ja Electron mainin native-vahvistus
- peruutus- ja keskeytysrajan tekninen kytkentä: omistaja hyväksyi perumisen
  viimeiseen vahvistukseen asti, ei enää käyttöliittymästä poiston alettua
- varmuuskopion tuoreuden ja tarkistuksen täsmällinen sopimus; omistaja
  hyväksyi ilman toimivaa kopiota poistamisen erillisellä tietojen menetyksen
  hyväksynnällä sekä molemmilla poistovahvistuksilla. Ei piilokopiointia
- quarantine-vaiheen tekninen järjestys, keskeytyksestä palautuminen ja
  lopullisen poiston raja ilman ajastettua säilytystä tai piilokopioita
- salaisuuksien, palautuspisteiden ja ulkoisten PDF-arkistojen tarkka
  cleanup-sopimus. Omistaja hyväksyi yrityksen omien palautuspisteiden poiston
  lopullisessa poistossa, myös viimeisen hyvän pisteen; muiden yritysten
  pisteet ja käyttäjän vientibackupit säilyvät
- yrityksen oman muutos-/tapahtumahistorian poistamisen todennus ilman
  erillistä kopiota; suunta on hyväksytty ja tekniset virhelokit säilyvät
  normaalien sääntöjen mukaan
- keskeytyminen, levy-/kirjoitusvirhe, restart ja turvallinen recovery.

Julkaisu vaatii alemman tason testien lisäksi oikean paketoidun Windows-
polun synteettisellä aineistolla ja muiden yritysten säilymisen todistuksen.
Pelkkä poistopainike tai onnistuva normaalitapaus ei täytä tehtävää.

### R030-03: Varmuuskopion nimi

Yrityksen nimi helpottaa kopioiden erottamista. Omistaja hyväksyi 23.10.2026
työtilan yritysvalitsimessa näkyvän nimen ja päivämäärän. Puuttuvan nimen
varavaihtoehto on nykyinen päivämääränimi. Nimi on ulkoista syötettä: pituus, Windowsin
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
| R030-06 | Ensikäyttö ilman automaattista oletusyritystä: luo yritys tai tuo kopio. | Ensiasennuksen muutos säilyy erikseen rajattavana jatkotoiveena. Omistaja hyväksyi 23.10.2026 W7:n viimeisen yrityksen poiston jälkeisen tyhjän tilan ilman automaattista oletusyritystä; se ei yksin hyväksy ensiasennuksen muutosta. Päivitys ei poista olemassa olevia yrityksiä. |
| D029-06 | Diagnostiikan Päivitä-toiminto, viimeisin onnistunut hakuaika ja osakohtainen virhetila. | Kirjattu suositus; mukaanotto päätetään ennen julkaisurajauksen lukitsemista. |
| R030-07 | Diagnostiikan virhe-/varoitussuodatus ja turvallisen virhekoodin kopiointi. | Valinnainen myöhempi lisä, ei muiden korjausten edellytys. |

## Muistissa mutta rajauksen ulkopuolella

- SMTP-salasanan suojaustavan parantaminen: erillinen arvio ja päätös;
  nykyistä salaisuusmallia ei muuteta tämän listauksen perusteella.
- Palautettavan varmuuskopion ja sitä uudempien merkintöjen yhdistäminen:
  jätetty ajatuksen tasolle. Nykyinen palautus ei yhdistä tietokantoja.
- Pilvipalvelut ensin ja työntekijän mobiilisovellus sen jälkeen ovat
  myöhempiä erikseen hyväksyttäviä kokonaisuuksia, eivät `0.3.0`:n sisältöä.
- I-paketin ohjeverkon haltuunotto ja tutkimushistorian erottaminen on
  hyväksytty aikaistettavaksi ennen D:tä omana dokumentaatiotyönään.
  Tämä ei hyväksy I:n CI-politiikan muutoksia. Mahdollinen myöhempi
  lisätiivistys ei siirrä I/M5:n ajantasaisuus-, lukureitti-, rakenne- tai
  tietoturvatarkistuksia julkaisun jälkeiseen aikaan.
  Muuttuvan alueen ohjeet pidetään kunnossa jo jokaisen toteutuspalan mukana;
  vaatimukset ja hyväksyntänäyttö säilyvät tiivistettäessä.
- Omistajan 12.10.2026 täsmennys: laaja ylläpidettävyyden siivous ja
  käyttäytymisen säilyttävä refaktorointi tehdään erillisenä työnä
  `0.3.0`:n jälkeen, ei keskeneräisen K:n rinnalla. Tämä ei siirrä
  [M5:n ennen toimitusta tehtävää rakennekatselmusta](#m5-uusi-katselmus-deep-scan-ja-julkaisuportti),
  sen julkaisun estäviä korjauksia tai muuttuvan alueen korvattujen
  toteutusten ja ohjeiden viimeistelyä myöhemmäksi.
- Ei piilotettuja varmuuskopioita, yleistä tietokannan salausuudistusta,
  uusia sähköpostiprovidereita, laajaa refaktorointia tai uutta
  riippuvuutta tämän suunnitelman sivutyönä.

## Eteneminen ja seuranta

Tämä tiedosto omistaa julkaisun sisällön ja kokonaisuuden työjärjestyksen.
Aktiivisen työn täsmällinen revisio, vaihe, näyttö ja seuraava askel
ylläpidetään vain [M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Omistavat moduuli-, diagnostiikka-, backup- ja update-suunnitelmat omistavat
tarkat sopimukset. Yksityiset tutkimusraportit säilyvät muuttamattomina
todisteina: niiden historiallinen testitulos ei ole uuden version hyväksyntä.

### M0: Nykyinen työ mainiin ennen korjauksia

**Valmis.** Alla säilyy M0:n hyväksyntäsopimus; sitä ei käynnistetä uudelleen
uutena työvaiheena. Nykyinen lähtörevisio on [M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).

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

<details>
<summary>M0:n integraatiota edeltävät valmistelu- ja testitulokset</summary>

<p><a id="m0-seuranta-2026-09-24-integraatiota-edeltävä-historia"></a><a href="release-0.3.0-m1-history.md#m1-source-roadmap-l1144">M0-seuranta 2026-09-24: integraatiota edeltävä historia (historia)</a></p>

</details>

### M1: Todistuksen ja päätösten valmistelu

**Tila:** suunnitteluvalmistelu sekä T1a/T1b, T2 ja T3/R28 on hyväksytty,
myös niiden omat PR/main-portit. [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä)
sulkee prosessiomistajuuden, oikeiden kuluttajien siirron ja korvatun
aktiivisen toteutuksen poiston hyväksytyssä rajauksessa. Aiemmat kokeet,
määrät ja hylkäysten syyepävarmuudet säilyvät omina checkpointteinaan.
Myös integraation jatkokorjaus on hyväksytty PR #281:n omissa main-porteissa.
M1:n sovelluskorjaukset ovat osittain valmiit: A1/R01 ja A2/R05 ovat
hyväksyttyjä yllä kuvatulla integraationäytöllä ja A2:n rajatulla
etenemispäätöksellä. Oma yritys -tallennuskorjauksen ja rajattujen
testikorjausten integraatio on hyväksytty PR #293:n mainissa.
Myös A3/R06 on hyväksytty PR #294:n mainissa; sen
[loppuhyväksyntä](https://github.com/eky-software/eky/pull/294#issuecomment-5980132408)
sulkee A-paketin kolme rajattua korjausta. Myös
[B1/B2](release-0.3.0-m1-preparation-plan.md#b1b2-rajattu-toteutus),
niiden rajattu sulkukorjaus ja salatun keräyksen jatko ovat hyväksyttyjä
[PR #297:n mainissa](https://github.com/eky-software/eky/pull/297#issuecomment-5992208049).
Myös B3-B5 on hyväksytty [PR #298:n mainissa](https://github.com/eky-software/eky/pull/298#issuecomment-6050339146).
Myös C on hyväksytty [PR #299:n mainissa](https://github.com/eky-software/eky/pull/299#issuecomment-6081351779)
ja K [PR #305:n mainissa](https://github.com/eky-software/eky/pull/305#issuecomment-6181885500).
I:n aikaistettu dokumentaatio-osuus sekä D ja E ovat myös hyväksyttyjä;
F/R15 on hyväksytty PR #313:n omilla PR/main-porteilla. Myös G/R20/R23 ja
D029-01/02 on hyväksytty PR #314:n omilla PR/main-porteilla.
Myös H/R21/R22/R24/R25/R26 ja D029-03/04/05 on hyväksytty
[PR #315:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918).
Myös I0-I3/R30/R31 on hyväksytty
[PR #316:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/316#issuecomment-6370140644).
M4.1-M4.3 ja W7.0-W7.5 on tämän jälkeen hyväksytty omissa rajauksissaan;
nykyinen työ on M5:n valmistelu, ei koko julkaisun hyväksyntä.
Täsmällinen näyttö ja nykytila ovat
[M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
T/A/B/C/K/D/E/F/G/H/I:tä ei avata uudelleen ilman niiden omaa todennettua regressiota.
Vanhat sulkuaikakatkaisut eivät
muutu korjatuiksi tämän integraation perusteella. B0:ssa tarkistettiin alkuperäiset
turvallisuushavainnot, B1-B5-toteutusjärjestys ja
revision, toimitussuojan sekä vanhan datan päätösportit. Omistaja hyväksyi
B-P1:n revisiosidonnan ja rajatut migraatiot. B-P2:ssa valittiin onnistuneen
testilähetyksen jälkeisen muokkaamisen säilyttävä toimitushistoria
suunnitteluun. B-P3:n säilyneen, tarkistetun legacy-PDF:n erikseen vahvistettu
uusi lähetys on hyväksytty ilman regenerointia tai takautuvaa varmuusväitettä.
Yleistä vanhan SMTP-historian estoa ei hyväksytty. B3/B4:n revisio-/PDF-/
toimitushistoria, legacy-uudelleenlähetyksen client/UI/native-ketju ja
B5-palautus on hyväksytty PR #298:n rajauksessa. Osahyvityksen
ALV-erittelyn lukupolun rajattu korjaus on todennettu
nykyisen kumulatiivisen laskentasäännön mukaan, vanhoja summia tai PDF:iä
muuttamatta. Tarkka nykytila ja hyväksyntänäyttö luetaan M1:n jatkamiskohdasta.
Kohdetestit eivät yksin sulje uuden revision integraatiota tai muita paketteja.
Voimassa olevat T1/T2/T3-sopimukset ovat
[testiympäristöohjeessa](e2e-test-environment.md), A:n UI-sopimukset
[laskutuksen käyttöliittymäohjeessa](invoicing-ui-roadmap.md).
M1 yhdistää nykyiset omistajat ja erillisen hyväksyntähistorian.
W7:n päätöslista on [työtilasuunnitelmassa](local-company-workspace-plan.md#w7-valmistelu-ja-paatosportti).
Suunnitelma itsessään ei korvaa kunkin palan toteutus- ja hyväksyntänäyttöä.

T-paketin testikytkennät ja testiruntimen edellytykset on hyväksytty
myöhempien pakettien perustaksi. I:n aikaistettu dokumentaatio-osuus
selkeyttää niiden lukureitit ennen D:tä, ei toteuta T:tä uudelleen.
Testin olemassaolo, sen ajokytkentä ja sen todellinen läpäisy todennetaan
erikseen. Tutkimusprobe, jonka PASS tarkoittaa virheen toistumista, ei
ole korjatun toiminnon hyväksyntätesti.

Lukitse seuraavan avoimen korjauspalan sopimus ja tarvittavat alla
luetellut omistajapäätökset ennen sen toteutusta. W7 valmistellaan ajoissa, jotta poiston
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

T-paketin T1a/T1b, T2 ja T3/R28 on hyväksytty niiden omien
integraatioiden näytöllä; [T3:n integraatiohyväksyntä](e2e-test-environment-history.md#t3n-integraatiohyväksyntä) ei perustu
pelkkään historialliseen T3c-W:n 4/4-koetulokseen. A-paketin A1/R01, A2/R05
ja A3/R06 ovat hyväksyttyjä; viimeisin hyväksyntä on PR #294:n mainissa.
F/R15 on hyväksytty [PR #313:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/313#issuecomment-6339105977).
G on hyväksytty [PR #314:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/314#issuecomment-6356610094).
H on hyväksytty [PR #315:n loppuhyväksynnällä](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918).
I0-I3/R30/R31 on hyväksytty [PR #316:n loppupäätöksellä](https://github.com/eky-software/eky/pull/316#issuecomment-6370140644).
D1-D3 ja niiden rajattu HTTP-sulun jatkokorjaus on hyväksytty PR #308:n
ja PR #309:n kautta mainissa `286cc3227ffe37dd44417750636ec30d460a61e1`.
[D:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/309#issuecomment-6324156808)
kirjaa erilliset PR/main-portit ja avoimiksi jätetyt historialliset havainnot.
PR #293:n aiemmat CS-1/CS-2-korjaukset säilyvät. E:n R09-R11 ja rajattu
Vitest-tietoturvahuolto on hyväksytty PR #311:n ja PR #312:n kautta;
[E:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/312#issuecomment-6329634460)
erottaa korjatun revision PR/main-portit avoimista historiallisista syistä.
[Asiakasinvarianttien suunnitelma](release-0.3.0-customer-invariants-plan.md)
säilyttää E:n sopimukset. Nykyinen työ luetaan
[M1:n jatkamiskohdasta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
H:n hyväksytyt lukutila- ja häiriöpalautesopimukset säilyvät; H ei toteuttanut
M4:n historian selausta. I ei muuta testisisältöä tai mainin täysiä vaatimuksia.
[D:n rajattu toteutussuunnitelma](release-0.3.0-company-settings-plan.md)
erottaa säilytettävät CS-1/CS-2-sopimukset, alkuluvun tallennuseston ja
17.10.2026 hyväksytyt D-P1:n salaisuusoperaation sekä D-P2/A:n saatavuuden ehdot.
B1/B2, niiden sulku-/keräysjatkot ja B3-B5 integraatiojatkoineen ovat
hyväksyttyjä. C on hyväksytty PR #299:n ja K PR #305:n mainissa.
Hyväksyntänäytön ja nykyisen jatkotyön tilan omistaa
[M1:n jatkamiskohta](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Muiden pakettien avoimet päätökset ratkaistaan ennen niiden vaikutusalueen
toteutusta. B:n hyväksyntä ei sulje muita paketteja tai koko M1:tä.

I-paketin dokumentaatiokatselmukseen kuuluu myös ohjelmanosittainen
ohjeiden löydettävyys: juuri- ja paikalliset `AGENTS.md`-tiedostot,
moduulivastuut, ADR:t sekä testaus-/diagnostiikka-/turvallisuusohjeet
muodostavat ehjän lukureitin. Aliagentit voivat tarkistaa eri alueet;
pääagentti kokoaa havaitut linkki-, ankkuri-, päällekkäisyys- ja
ajantasaisuuspuutteet sekä varmentaa korjaukset. Tämä dokumentaatio-osuus
tehtiin ennen D:tä omine lukureitti-, katselmus- ja integraatioportteineen;
se ei hyväksynyt koko I:tä tai sen erillisiä CI-politiikkamuutoksia.
PR #316:n hyväksytty I0-I3 täydensi muuttuneiden alueiden sopimusten
vastaavuuden ja R30:n täsmällisen neljän polun rajauksen, ei aloittanut
ohjehuoltoa alusta. Alkuperäiset syy- ja siivousepävarmuudet säilyvät
loppupäätöksessä, eivät korjattuina havaintoina.
Se täydentää jokaisen tehtävän pysyvää
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
skannerin tulokseksi. B0:ssa 4.10.2026 vertailtiin lisäksi B:n Invoicing-/SMTP-
tuotantopolut hyväksyttyyn PR #294:n mainiin: niiden toteutukset eivät olleet
muuttuneet skannauksen lähtörevisiosta. Tämä rajattu vertailu ei ole uusi
runtime-testi eikä muiden pakettien ajantasainen tarkastus.

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

K:n ja B:n alla luetellut päätökset ovat hyväksyttyjä, säilyviä sopimuksia,
eivät uusi valmistelujono. D/E/G/H:n päätökset säilyvät niiden hyväksytyissä
sopimuksissa; I:n mahdollinen politiikkamuutos ja W7:n avoimet päätökset
ratkaistaan ennen niiden toteutusta.
Uusi sopimusmuutos tarvitsee oman vaikutusarvionsa.

- K: versionmukaisen schema-attestoinnin omistaja ja kanonisointi,
  historiallinen yhteensopivuus sekä kertakäyttöisen backend-utilityn
  aikaraja, resurssirajat, exit-todiste ja virhesopimus ovat
  [backup-ohjeen](local-backup-and-restore-plan.md) ja
  [tietokantaohjeen](local-database-implementation-plan.md) omistamia.
  Hyväksytty ratkaisu on nykyiseen omistajuuteen rajattu attestointi ja
  eristetty tarkistus, ei koko tietokannan uudelleenrakennus tai mainin
  SQLite-ajuri. Pelkät PRAGMA-asetukset eivät korvaa näitä sopimuksia.
- B: revision/document-hashin atominen varaus, PDF:n ehdollinen julkaisu,
  toimituksen epävarmuuden sovitus ja tarvittava metadata/migraatio.
  Hyväksytty ratkaisu on Invoicingin oma elinkaarisopimus, ei yleinen
  manager-kerros tai globaali lukko. SMTP-verkkokutsua ei pidetä avoimen
  SQLite-transaktion sisällä. Hyvityksen laskenta seuraa hyväksyttyä
  laskentasopimusta; epäselvä pyöristysratkaisu hyväksytään ensin.
  [B0:n päätöstaulukko](release-0.3.0-m1-preparation-plan.md#päätökset-ennen-bn-toteutusta)
  erottaa hyväksytyn B-P1:n revisiosidonnan/migraatiot, B-P2:n valitun
  historiasuunnan ja B-P3:n hyväksytyn rajatun legacy-uudelleenlähetyksen.
  Onnistunut itselle tehty testilähetys ei saa aiheuttaa pysyvää
  muokkausestoa. Historiatietomalli ja backup/restore on hyväksytty B3-B5:n
  rajauksessa; legacy-resendin sisältövarmuuden raja säilyy myös muutoksissa.
  Nykyistä `sent`-sääntöä tai unresolved-toimituksen suojaa ei lievennetä.
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

**Tila 14.11.2026:** M4.1-M4.3 ja W7.0-W7.5 hyväksytty omissa
rajauksissaan; R030-04/R030-05:n loppuvarmistus kuuluu M5-valmisteluun.
W7.0:n tekninen sopimus ja pienet katselmoidut kokeet ovat valmiit:
yritysvalinta ilman aktiivista backendia, poiston inventaario, vahvistuksen
sidonta ja keskeytysrecovery. W7.1-W7.4 on hyväksytty omilla PR/main-porteillaan.
[W7.4:n toteutussopimuksen](local-company-workspace-plan.md#w74n-toteutussopimus)
A-F:n loppunäyttö on [PR #327:n hyväksynnässä](https://github.com/eky-software/eky/pull/327#issuecomment-6678341652).
W7.5:n näkyvä käyttöönotto ja tukivienti on hyväksytty
[PR #330:n loppupäätöksellä](https://github.com/eky-software/eky/pull/330#issuecomment-6880745021),
mukaan lukien sen täsmällisen PR-headin ja uuden mainin omat portit.
Tämä sulkee W7:n sovitun toteutuksen, ei 0.3.0-julkaisua. Hyväksyttyjä
kanavia ei kuvata enää suunnittelun vuoksi suljetuiksi tai toteuteta uudelleen.
Tarkka nykykoodikartta on
[työtilasuunnitelmassa](local-company-workspace-plan.md#w70n-lähtökartta-24102026).
[Omistava valmistelukohta](release-0.3.0-m1-preparation-plan.md#m4--käyttäjäkokemuksen-valmistelu)
erottaa hyväksytyt palat ja vielä täsmennettävät sopimukset.
Toteutusjärjestys oli odotuspalaute, backup-nimi, diagnostiikan selaus ja W7.
Tämä tilapäivitys ei muuta hyväksyttyjä sopimuksia tai julkaisun sisältöä.

Säilytä hyväksytyt R030-01, R030-02/W7, R030-03 ja R030-08 nykyisten
omistajiensa vastuulla. Diagnostiikan selaus tarvitsee G/H:n oikean lukuketjun
ja kattavuustiedon; W7 tarvitsee C/K:n turvallisen lifecycle/recovery-pohjan.
Ilmoitukset ja ohjeet R030-04/R030-05 valmistuvat jokaisen muutoksen mukana,
eivät vasta lopun kosmeettisena vaiheena. Latausikoni tai UI-esto ei korvaa
backendin invarianttia, atomista varausta tai prosessin exit-todistetta.

### M5: Uusi katselmus, Deep Scan ja julkaisuportti

**Valmistelu 14.11.2026:** hyväksytty W7.5 ei vielä hyväksy koko 0.3.0:aa.
Aktiivinen revisio ja seuraava rajattu työ ovat [M1:ssä](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Seuraava taulukko täsmentää alla jo sovittua järjestystä, ei lisää ominaisuuksia
tai aloita katselmusta, skannausta, versionnostoa tai toimitusta:

| Pala | Tulos ja portti seuraavaan vaiheeseen |
| --- | --- |
| M5.1: rajaus ja näyttökartta | Tunnuskohtainen R01-R31/S030-01-S030-05 sekä sovittujen R030-/D029-tehtävien toteutus-, testi-, revisio- ja hyväksyntäviite; erityisesti R030-04/R030-05:n loppuvarmistus. R030-06, D029-06 ja R030-07 säilyvät erillisinä rajauspäätöksinä, eivät automaattisina lisätöinä. |
| M5.2: koko sovelluksen katselmus | Alla määritelty koodi-, arkkitehtuuri-, ylläpidettävyys- ja testirakennekatselmus. Jokaiselle löydökselle lähde, omistaja, vaikutus ja todiste; toimitusta estävät korjaukset erotetaan julkaisun jälkeisestä laajasta siivouksesta. Sovitut korjaukset ja niiden vaikutusalueen portit valmiiksi ennen skannausehdokkaan jäädytystä. |
| M5.3: uusi Deep Scan | Tarkka puhdas ehdokasrevisio, sovittu kattavuus ja työbudjetti, käytössä olevan skannaustyökalun asetusten varmennus sekä loppuraportti. Löydökset ja aukot käsitellään; vanhaa keskeytettyä ajoa tai pelkkää lähdekatselmusta ei kirjata uudeksi läpäisyksi. |
| M5.4: lopullinen release-ehdokas | Tarkoituksellinen 0.3.0-versionosto vasta edeltävien korjausten jälkeen; saman revision nykyiset testit, auditointi ja PR/main-portit sekä build-once-paketin backup/restore-, installer/update/rollback- ja soveltuvat endurance-portit. Pelkkä tavallinen PR/main-MSI ei ole toimitettava release candidate. |
| M5.5: käyttäjätestaus ja toimitus | Nykyisen ehdokkaan synteettinen käyttäjätestiohje, todella raportoidut tulokset, käyttö-/tukiohje ja release security gate. Hyväksytty MSI/manifesti/checksum toimitetaan samoina tavuina nykyisen pilot-sopimuksen mukaan; ei rebuildiä tai automaattista asennusta. |

Käytä nykyisiä testejä, tarkistimia ja hyväksyntäomistajia. Tunnuskohtainen
näyttökartta ei ole kaikkien testien uudelleenkirjoitus. Vanha
[0.2.8:n käyttäjätestausohje](../product/pilot-0.2.8-user-testing.md) on
oman versionsa ohje, ei 0.3.0:n suoritus- tai hyväksyntätulos.
Tavalliset checkpointit eivät käynnistä koko matriisia uudelleen; lopullisen
muuttuneen revision ja toimitettavan paketin portit säilyvät alla kuvatusti.

#### M5.1: Hyväksyntänäytön täsmäytys

**Omistajan hyväksymä rajattu Goal 14.11.2026, toteutuksessa.** Lähtö on
main `4646f6dbabb881a65c0987f9c73711061bae4725` ja
[W7.5:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/330#issuecomment-6880745021).
Näyttökartta täsmää nykyiseen lähteeseen erikseen R01-R31-, S030-01-S030-05-
sekä sovitut R030-01/02/03/04/05/08- ja D029-01-05-kohdat.

Jokainen rivi nimeää nykyisen omistajan ja tuotantopolun, vaatimusta todella
suojaavan testiväitteen ja sen ajovalinnan, alkuperäisen PR/main-hyväksynnän
sekä kattavuusrajan tai puuttuvan näytön. Nykyisen lähteen tarkistus ei ole
uusi testiajo eikä vanhan paketin identiteetti muutu nykyiseksi mainiksi.
Päällekkäisiä testivalintoja ei lasketa uutena kattavuutena. Jo hyväksyttyä
pakettia ei toteuteta uudelleen ilman omaa todennettua löydöstä.

R030-04:n tarkistus erottaa odotetun eston, peruutuksen, teknisen virheen ja
epävarman lopputuloksen. Saman version päivityksen esto säilyy; sen
käyttäjäpalaute arvioidaan erikseen eston oikeellisuudesta. R030-05:n tulos
on nykyisiin toimintoihin perustuva löydettävä käyttöohje ja lyhyt
virhetilanteen tukiohje. Sanitoitu käyttäjän tukipaketti ei ole varmuuskopio
eikä salatun CI-virheaineiston vastine.

Valmius vaatii tunnuskohtaisen kartan, osoitettujen puutteiden käsittelyn,
rajatun riippumattoman katselmuksen, muuttuneiden linkkien ja historian
säilymisen tarkistuksen sekä täsmällisen PR:n ja uuden mainin nykyiset
soveltuvat portit ja auditoinnin. Puuttuvaa näyttöä, vanhaa ensihylkäystä tai
tuntematonta siivoustilaa ei suljeta myöhemmän läpäisyn perusteella.
M5.2:n koko sovelluksen katselmus, M5.3:n uusi Deep Scan, versionnosto,
release-paketointi ja todellinen käyttäjätestaus eivät sisälly tähän Goaliin.
R030-06, D029-06 ja R030-07 säilyvät erillisinä rajauspäätöksinä.

##### M5.1:n näyttökartta

**Lähdevertailu 14.11.2026, ei uusi testiajo tai koko sovelluksen katselmus.**
Taulukon nykyiset lähteet ja erottavat testiväitteet on tarkistettu mainin
`4646f6dbabb881a65c0987f9c73711061bae4725` puusta. Historiallinen hyväksyntä
säilyttää oman revisionsa; nykyisen mainin 40 työn ja erillisen auditoinnin
läpäisy ei muuta vanhoja paikallisia paketteja tämän revision ajoiksi.

Polkujen lyhenteet sovellusjuuresta: `B = apps/backend/src/`,
`D = apps/desktop/src/`, `W = apps/web/src/`, `T = apps/e2e/tests/`.
`I = B/modules/invoicing/`, `C = B/modules/companySettings/`,
`U = B/modules/customers/`, `Q = B/modules/diagnostics/infrastructure/`.
`X.test.ts` tarkoittaa saman nimetyn tuotantotiedoston sisartestiä.
Taulukko nimeää keskeisen invariantin, ei kaikkien tiedostojen call graphia.

Ajovalinnat on luettu nykyisistä `package.json`- ja Playwright-sopimuksista:
`UB/UD/UW/UA` = vastaavasti backendin/desktopin/webin/api-clientin nykyinen
`pnpm --filter @eky/<paketti> test`; `WEB` =
`pnpm --filter @eky/e2e e2e:web:critical`, `SYS` = saman paketin `e2e:system`,
`EL` = `e2e:electron:critical`. Playwright-komennot sisältävät nykyiset
valmistelunsa; suora Vitest-tiedostovalinta ei korvaa niitä tai native-porttia.
`CI` = juuren `pnpm test:ci`, `ED` = desktopin `test`-skriptin nimetty
Node-vaihe, `ET` = e2e-paketin `test`-skriptin nimetty Node-vaihe.
Tämä on löydettävyyskartta, ei pyyntö käynnistää koko matriisia uudelleen.

Hyväksyntäavaimen head/main-pari on alkuperäinen lähdecheckpoint.
PR-linkki tai omistava historialinkki sisältää sen omat portit ja rajaukset.
Tunnus voi viitata samaan toteutukseen kuin toinen tunnus; siitä ei synny
toista korjausta tai lisätestimäärää.

| Avain | Alkuperäinen hyväksyntä | PR-head → merge-main |
| --- | --- | --- |
| T1 | [PR #276](https://github.com/eky-software/eky/pull/276#issuecomment-5822861572) | `11b1ae70cf10347eb4ec18259f250b5bf8ddb748` → `da896643d5cc1895174e508bee4f6141f4489d56` |
| T2 | [PR #277](https://github.com/eky-software/eky/pull/277#issuecomment-5826768078) | `6b323284bf671ad684e8b5774d22bc566cf709c2` → `5cc58b7139a6616bc9403a5724f93d929e90cf25` |
| T3 | [T3:n integraatio](e2e-test-environment-history.md#t3n-integraatiohyväksyntä), PR #278 | `52cdaa1755ca2ed68318bd33fd52805a7753235e` → `816bc7755d5c13ec40e9cc9601bb9a662af8b785` |
| A | [PR #294:n A1-A3-loppuhyväksyntä](https://github.com/eky-software/eky/pull/294#issuecomment-5980132408); A1/A2:n aiempi näyttö säilyy [historiassa](release-0.3.0-integration-history.md#m1-source-preparation-l10096) | `f05abc25efa480f33ef9d9baa310730ebea73cf9` → `082e187bb680b1c7a8dc5d0a5e967adf33403a7a` |
| B12 | [B1/B2:n integraatio](release-0.3.0-invoice-revisions-history.md#m1-source-preparation-l8175), PR #297 | `5daac2545b3f6057a6e1763cda2377f398c6e425` → `8a08a6ea4a6d58eaed26b9b0de563bbe7271abc2` |
| B345 | [PR #298](https://github.com/eky-software/eky/pull/298#issuecomment-6050339146) | `681297217fc5812ab39994af15732f0de1bc4076` → `bd67742f1df9cbf989ec3c1afd078e95af356b1b` |
| C | [PR #299](https://github.com/eky-software/eky/pull/299#issuecomment-6081351779) | `447035fe2d0740d454ac79b32cf0e64c1c2906f9` → `250cd9c32914d1e6f35cea76f2b45055891534e2` |
| K | [PR #305](https://github.com/eky-software/eky/pull/305#issuecomment-6181885500) | `1a0bb3cae78fa4adde44b4bd8102b7b5cf18bbbd` → `c717406484df0471df23165a7c13db9b3f74c1b6` |
| D | [PR #309](https://github.com/eky-software/eky/pull/309#issuecomment-6324156808), D1-D3 ja sulkukorjaus; CS-1/CS-2 säilyvät | `33fd0bdb19709329721a87838b3f7d933552d4b9` → `286cc3227ffe37dd44417750636ec30d460a61e1` |
| E | Asiakaskorjaukset PR #311/main `d03e9a15`; [PR #312:n tietoturvajatkon loppuhyväksyntä](https://github.com/eky-software/eky/pull/312#issuecomment-6329634460) | `613a00c73f133e321beb7546126aebff74c5661a` → `d0d08bd182500c463fa06300978f06c295f3cac2` |
| F | [PR #313](https://github.com/eky-software/eky/pull/313#issuecomment-6339105977) | `04f7a0f6d5ed56cca9cc95ba6e7f788c723f6d26` → `96b62944087bec64970e6233e57a730ab31ec1ea` |
| G | [PR #314](https://github.com/eky-software/eky/pull/314#issuecomment-6356610094) | `9c5d3ffe08046c6be81e5e61de7852731ee22c98` → `80139f6dffc01f7df2ed0ef8779636d67c4ee23d` |
| H | [PR #315](https://github.com/eky-software/eky/pull/315#issuecomment-6364180918) | `bc44ffc20552d81ae27e69f5376f8cfdef6bdf51` → `7e2dba840f4434eeb6049feda70852751343e134` |
| I | [PR #316](https://github.com/eky-software/eky/pull/316#issuecomment-6370140644) | `a0bae6cea3f34f4c295903ce8ab7460da1becbd4` → `267bf6f2a1fc142d61308c7c2e730d2c0870eb11` |
| M4.1 | [PR #317](https://github.com/eky-software/eky/pull/317#issuecomment-6376623066) | `f245aec8f5a02b3402b18e1841de9a2f4a167e0d` → `00764a41fb5043aa4822998561f1150ff2e28528` |
| M4.2 | [PR #318](https://github.com/eky-software/eky/pull/318#issuecomment-6381002283) | `144f1dd0b000be5ff82c1a8ef46ae9d5bbcc68b6` → `7d47bc9e1cf3482ae165c07f77a4919e4a5a29d1` |
| M4.3 | [PR #319](https://github.com/eky-software/eky/pull/319#issuecomment-6385011410) | `26f0dc762b3266373bc1c978c507df12e8d95f2d` → `f38c1f77e9d5db864a3624bc0a4e8277a446a02d` |
| W7.5 | [PR #330](https://github.com/eky-software/eky/pull/330#issuecomment-6880745021); viitatut W7.0-W7.4-sopimukset säilyvät | `dba386457f720923710c578d02f48bb5eeac73f4` → `4646f6dbabb881a65c0987f9c73711061bae4725` |

| Tunnus | Nykyinen omistaja ja tuotantopolku | Erottava testiväite ja ajovalinta | Hyväksyntä ja kattavuusraja |
| --- | --- | --- | --- |
| R01 | Invoicing web: `W/features/invoicing/hooks/useInvoiceDraftEditor.ts`, keyed editor/save-session | `T/web/invoiceDraftOpeningJourneys.spec.ts`, INV-OPEN-001/002/003: viivästynyt A-vastaus ei muuta näkyvää B:tä tai sen tallennuskohdetta; A:n tavut säilyvät (`WEB`). | A; ohjatut GET-järjestykset, ei kaikkien ajoitusten todistus. |
| R02 | Invoicing: `I/infrastructure/reserveInvoiceEmailDelivery.ts`, `completeReservedInvoiceEmailDelivery.ts` | `invoiceEmailCompletion.test.ts`: muuttunut yritys/lasku/revisio/dokumentti/hash/koko hylätään muuttamatta pysyvää tilaa (`UB`). | B345; SQLite-ketju, ei SMTP-verkkotoimituksen koe. |
| R03 | Desktop lifecycle/update: `D/workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.ts`, `D/update/localUpdateHandoffCoordinator.ts` | Lifecycle-sisartestin ordinary-stop exited/forced/unknown ei muutu strict-update-suluksi; handoff-testi estää asentimen epävarmassa sulussa (`UD`). | C; prosessiraja ohjattu, ei uusi MSI-sulkuajo. |
| R04 | Päivityksen sama kirjoitussuoja: `D/update/localUpdateHandoffCoordinator.ts`, `profileProtectionComposition.ts` | Handoff-sisartestin menetetty fence estää shutdownin/installerin; `D/main/desktopRestoreStartup.test.ts` todentaa saman todellisen update-leasen lainauksen (`UD`). | C; unit/composition ei korvaa hyväksyttyä HTTP-/pakettitason jatkuvaa suojaa. Tämä ei ole R030-04. |
| R05 | Invoicing web: `W/features/invoicing/state/invoiceDraftSaveSession.ts` ja `hooks/useSaveInvoiceDraft.ts` | `T/web/invoiceDraftSavingJourneys.spec.ts`, INV-SAVE-001/002/006: yksi POST, sama saatu ID ja tuoreemmat muokkaukset säilyvät; epävarman luontikuittauksen jälkeen ei uutta POSTia (`WEB`). | A; ei uutta backend-idempotenssiprotokollaa. |
| R06 | Invoicing web: `W/features/invoicing/state/invoiceReadinessSession.ts`, `hooks/useInvoiceIssuanceReadiness.ts` | `T/web/invoiceReadinessJourneys.spec.ts`, INV-READY-001: vanha ready ei avaa uuden tallennetun revision hyväksyntää (`WEB`). | A; backendin oma hyväksyntävaltuus säilyy erillisenä. |
| R07 | Company Settings: `W/features/companySettings/CompanySettingsPageView.tsx` | `T/web/companySettingsLoadingJourneys.spec.ts`, COMPANY-LOAD: virheellinen GET estää lomakkeen/PUTin, käsin tehty uusi luku sallii yhden tallennuksen; vanhat sessionvastaukset sivuutetaan (`WEB`). | D; selainvasteen ohjaus ei todista aidon backend-virheen lokitusta. |
| R08 | Invoicing domain: `I/domain/calculateCreditInvoiceDraft.ts` | Sisartestin net/gross-veroryhmäpyöristys sekä kumulatiivinen osahyvitys käyttävät täsmällisen kapasiteetin ylittämättä senttirajaa (`UB`). | B12; ei historiallisten laskujen jälkilaskentaa. |
| R09 | Customers: `U/domain/customerRules.ts`, `U/infrastructure/sqliteCustomerRepository.ts` | `sqliteCustomerInvariants.test.ts`: aktiivinen ja passiivinen taloyhtiöviite estävät isännöitsijän tyypin vaihdon samassa transaktiossa; asiakas/audit säilyvät (`UB`); CUS-REL-005 (`WEB`). | E; yritysraja ja molemmat ohjatut commit-järjestykset, ei pilvikilpailumalli. |
| R10 | Customers: sama repository, tarkka merkkijononumerointi | `sqliteCustomerInvariants.test.ts`: yli JS:n tarkkuusrajan numerot kasvavat oikein; 50 numeromerkin ylitys ei kirjoita asiakasta/auditia (`UB`). | E; ei vanhojen numeroiden automaattista korjausta tai konfliktin uusintaa. |
| R11 | Customers UI ja `W/i18n/fi.ts` | `T/web/customerInvariantJourneys.spec.ts`, CUS-ERROR-001: tuntematon API-teksti ja prototype-avaimet eivät vuoda; muokkaukset säilyvät (`WEB`); tunnetut käännökset `fi.test.ts` (`UW`). | E; tarkoituksella ohjatut API-virheet, ei alkuperäisen backend-syyn näyttö. |
| R12 | SMTP: `B/infrastructure/email/smtp/smtpSession.ts` | Sisartestin lopullinen DATA-250 säilyy hyväksyttynä QUIT/deadline/close-virheestä huolimatta; hylätty/epävarma DATA ei muutu onnistumiseksi (`UB`). | B12; testiyhteys ei todista vastaanottajan postilaatikkoa tai DB-committia. |
| R13 | SMTP: `B/infrastructure/email/smtp/smtpReplyParser.ts` | Sisartestin samat tavut kokonaisina, tavuittain ja kahteen osaan jaettuna antavat saman tuloksen; protokolla-/kokorajat säilyvät (`UB`). | B12; rajatut erottavat jaot, ei mielivaltaisten virtojen fuzzing. |
| R14 | Company Settings/secret broker: `C/application/executeCompanyEmailSecretOperation.ts`, `D/secrets/secretBrokerClient.ts`, `secretBrokerMain.ts` | Broker-sisartesti sulkee uudet/jonossa olevat työt ennen timeout-vastausta; myöhäinen success ei elvytä. `T/system/secretAuditAdmission.spec.ts` ja `T/electron/companySecretShutdown.spec.ts` todentavat pending/audit/sulku/restart (`UD/SYS/EL`). | D; tuntematon vaikutus säilyy pendinginä, restart ei sovita historiaa. |
| R15 | HTTP: `B/http/app.ts`, `handleUnexpectedHttpError.ts`, `operationalLogging.ts` | `appHttpErrorHandling.test.ts`: oikea createApp palauttaa turvallisen 500:n, yhden korreloidun eventin lukijoihin, ei raakavirhettä/konsolia; writer-virhe ei korvaa vastausta (`UB`). | F; synteettinen testireitti, ei uusi tuotantoendpoint tai kaikkien moduulivirheiden kartoitus. |
| R16 | Company Settings composition: `B/composition/companySettingsComposition.ts`, `C/application/updateCompanySettings.ts` | Composition-sisartestin statusluvun virhe ei muuta dataa/auditia; precommit-status palautuu todellisen tallennetun rivin mukana ilman postcommit-lukua (`UB`). | D; hyväksytty statuspalvelun saatavuusriippuvuus säilyy. |
| R17 | Desktop prosessi: `D/runtime/backendProcess.ts`, `D/main/desktopComposition.ts` | Prosessi-sisartestin viivästetty exit säilyttää ensisyyn, myöhäinen ready sivuutetaan; thrown fork ei todista poissaoloa (`UD`). | C; ohjattu prosessiraja, ei uusi OS-exit-todiste. |
| R18 | Desktop kylmäpalautus: `D/main/desktopComposition.ts`, `D/workspaces/runtime/workspaceColdRecoveryAdmissionComposition.ts` | `desktopRestoreStartup.test.ts`: vartioitu create/import ratkeaa ennen backendia idempotentisti; journaliton plaintext säilyy ilman arvattua kirjoittajapoissaoloa (`UD`). | C; oikeat synteettiset tiedostot, backend/tarkistin ohjattu. |
| R19 | Build/installer: `D/release/packageBuildInfo.ts`, `apps/desktop/installer/installerReleaseContext.mjs` | Build-sisartesti vaatii koko 40-merkkisen HEADin oletuksena ja hylkää puuttuvan identiteetin (`UD`). | C; nykyisen helperin testi, ei uusi manifesti-/pakettitavujen vertailu. |
| R20 | Diagnostics/archive/update: `Q/diagnosticOperationalEventProjector.ts`, `diagnosticUpdateProjection.ts`, `D/supportBundle/supportBundleUpdateProjection.ts` | `T/system/diagnosticEventChain.spec.ts`, OBS-DIAGNOSTIC-CHAIN-001: writer→HTTP→strict-client→gzip→tarkastin, perhekohtaiset poissulut säilyvät (`SYS`). Projektorit torjuvat väärän vaiheen/tason/tuloksen (`UB`). | G; seedattu writer-ketju ei ole jokaisen oikean päivityksen uusi ajo. |
| R21 | Backend/desktop operational- ja incident-retention, startup-kutsujat | `B/http/appOperationalLogMaintenance.test.ts` ja `D/main/desktopRestoreStartup.test.ts`: tunnetun log-juuren listausvirhe ei estä muuten tervettä startupia; turvaton config hylätään (`UB/UD`). | H; ei database-/omistajuus-/recovery-porttien ohitusta. |
| R22 | Samat retention-omistajat: `B/observability/infrastructure/operationalLogRetention.ts`, desktop-vastineet | Retention-sisartesteissä tuleva kuukausi/vuosi ei syrjäytä kelvollista historiaa eikä muutu poistokohteeksi; kapasiteettilaskenta ei katoa (`UB/UD`). | H; osin ohjattu kokometadata, ei kaikkien lokien terveystodistus. |
| R23 | Workspace observer: `D/workspaces/management/workspaceManagementService.ts`, `workspaceBackupOperationalObserver.ts` | Service-sisartestin todellinen väärän lineagen hylkäys kirjoittaa yhden tarkan turvallisen syyn ennen leasea/sulkua; tiedot ja alkuperäinen syy säilyvät (`UD`); downstream-ketju (`SYS`). | G; cleanup on erillinen; fixture ei ole koko live-IPC-ketju. |
| R24 | Support-readerit: `Q/fileSystemSupportBundleDiagnosticEventReader.ts`, `fileSystemSupportBundleIncidentSummaryReader.ts` | Sisartestien limit=1 valitsee uusimman eri virroista ennen rajaa; incident-ryhmän määrä/ensimmäinen/viimeinen säilyvät (`UB`). | H; vain todella luettu rajattu aineisto, ei lukemattoman historian uusimman lupaus. |
| R25 | Diagnostics: `Q/fileSystemDiagnosticEventReader.ts`, summary-reader, API-client ja `W/features/diagnostics/components/DiagnosticsPageView.tsx` | `Q/diagnosticReadCoverage.test.ts` erottaa tyhjän/osittaisen/puuttuvan; `T/web/diagnosticReadJourneys.spec.ts` säilyttää kelvolliset rivit eikä näytä väärää tyhjää (`UB/WEB`). | H; nykyinen browse-transport on myöhempi M4.3, lista/summary eivät ole atominen snapshot. |
| R26 | Desktop failure sink/capability/main ja `W/app/DesktopOperationalLogNotice.tsx` | `incidentIndexDesktopLogFailureSink.test.ts`: oikea writer-virhe ei muuta business-tulosta, ei rekursiota. `T/electron/operationalLogFailure.spec.ts`, DESK-LOG-FAILURE-001/002: main/preload/UI-palkki, navigointi ja terve customer-create (`UD/EL`). | H; saman levyn incident on best effort, ei pysyvyyden takuu. |
| R27 | Desktop/installer-testien ajokytkentä: `apps/desktop/scripts/test-command-wiring.test.mjs` | T1-tiedostot ja oma kytkentätesti kuuluvat oikeisiin komentoihin; puuttuva/epäonnistunut pakollinen askel hylätään vaikka workflow olisi success (`ED`). | T1; valinta-/hyväksyntäsopimus ei ole uusi native-testisuoritus. |
| R28 | E2E omistettu prosessipuu: `apps/e2e/src/environment/startOwnedWindowsBackend.ts` ja nykyiset Windows/Linux-kuluttajat | `apps/e2e/experiments/processOwnership/adapterRootExitOrdering.test.mjs`: root-first ja portiton jälkeläinen, bridge ei valmistu ilman todistettua sulkua (`ET`); laajempi native-matriisi T3-checkpointissa. | T3; vanhaa pientä adapterikoetta ei nimetä koko nykyisen prosessipuun todistukseksi. |
| R29 | E2E script/config/staging: `apps/e2e/package.json`, `playwright.config.ts`, desktopin `prepare-electron-e2e-backend.mjs` | `apps/e2e/scripts/e2e-command-wiring.test.mjs` ja `T/system/testProjectSelection.spec.ts`: security/fault sisältävät täydet valmistelut ja kolme standardiprojektia, eivät endurancea (`ET/SYS`). | T2; lähde-/valintakontrolli ei ole uusi clean-checkout-build. |
| R30 | CI-riskipolitiikka: Git-juuren `.github/scripts/ciRiskPolicy.mjs`, `classifyCiChanges.mjs`, `ciRunAcceptance.mjs` | Sisartestit: vain neljä nimettyä customer-browser-tiedostoa saa fast-portit; tuntematon/sekamuutos ja main/schedule/manual säilyttävät täyden matriisin/toistot (`CI`). | I; fixturet eivät todista etärulesettiä tai oikeita ajoja. |
| R31 | Omistavat moduuli-/integraatio-/E2E-ohjeet suhteessa composition rootiin | I:n lähde-/linkkivertailu, G-projektorien ja D/H:n oikean kytkennän kontrollit (`UB/UD/EL`); M5.1 korjaa havaitut D/M4.3/W7.5:n vanhentuneet nykytilalauseet. | I; ei koko dokumentaation semanttista testioraakkelia tai M5.2-katselmusta. |
| S030-01 | K/schema: `B/database/migration/inspectAttestedMigrationHistory.ts`, `B/runtime/profileSnapshot/inspectSqliteProfileDatabase.ts` | Attestointi-sisartestin väärennetty view torjutaan ennen sen arviointia; muuttunut objekti ei kirjoita; historiallinen 038-prefix säilyy (`UB`). `T/electron/workspaceBackupSchemaRejection.spec.ts` import/replace (`EL`). | K; checksum/salaus ei korvaa schema-attestointia, ei uusi scan. |
| S030-02 | K/eristys: `D/profileBackup/runProfileSnapshotInspection.ts`, `D/runtime/profileInspectionProcess.ts`, backendin `profileInspectionSqlite.ts` | Process-sisartestin terminal ei riitä ennen exit/reclaimia; kill-success ei ole poissaolo, myöhäinen viesti ei hyväksy (`UD`). [Toimitetun nativen positiivinen koe](release-0.3.0-profile-validation-history.md#m1-source-preparation-l3777) vaatii rajan ylittävän SQL-allokaation NOMEM-hylkäyksen ja sen jälkeen onnistuvan tavallisen kyselyn; readback ei yksin riitä. | K; 35 s työ ja 3+3 s sulku, SQLite/V8-rajat eivät lupaa koko prosessin RSS-rajaa. Historiallinen native-koe säilyttää oman buildinsa; unsupported-runtime-negatiivinen testi ei korvaa sitä. |
| S030-03 | Invoicing revisio/toimitus: `I/infrastructure/reserveInvoiceEmailDelivery.ts`, `completeReservedInvoiceEmailDelivery.ts`, approval repository | `invoiceEmailReopen.test.ts`: attempted/outcomeUnknown estää reopenin myös uuden DB-yhteyden jälkeen, vanha revisio/PDF/event säilyvät (`UB`). | B345; oikea SQLite-reopen, ei OS-crash kaikissa SMTP/commit-väleissä. |
| S030-04 | Invoicing PDF: `I/application/generateApprovedInvoicePdfDocument.ts`, document repository | `invoiceRevisionPdfGeneration.test.ts`: viivästynyt vanha renderöinti hylätään, uudemmat tavut säilyvät; saman revision kilpailussa vain voittajan tiedosto jää (`UB`). | B345; synteettiset renderöintitavut, ei uusi native-esikatselu. |
| S030-05 | Invoicing cancel/reserve: `I/infrastructure/sqliteInvoiceCorrectionRepository.ts`, reserve ja SMTP application-polut | `B/composition/invoicingSmtpComposition.test.ts`: cancel-first ei kutsu provideria; reserve-first estää perumisen. `invoiceEmailCancel.test.ts`: kaksi yhteyttä ja pysyvä päätös reopenissa (`UB`). | B345; ohjatut järjestykset ja fake-provider, ei oikeaa SMTP:tä. |
| D029-01 | Sama workspace-syyketju kuin R23, K:n tarkistussyy säilyy | Sama väärän lineagen testiväite ja OBS-DIAGNOSTIC-CHAIN-001 (`UD/SYS`). | G/K; päällekkäinen vaatimus, ei lisätestisuoritus. |
| D029-02 | Sama update-projektio kuin R20 | Sama tapahtuma-/stage-matriisi ja writer→gzip-ketju (`UB/SYS`). | G; ei uusia version/channel/journal-raakametadatan kenttiä. |
| D029-03 | Sama newest-selection kuin R24 | Samat eri lähteiden limit=1- ja incident-ryhmäväittämät (`UB`). | H; lähde- ja tulosrajat säilyvät. |
| D029-04 | Sama rehellinen lukutila kuin R25; support-summaryn v2-projektio erillinen | Samat coverage/UI-kontrollit (`UB/WEB`); OBS-DIAGNOSTIC-CHAIN-001 tarkistaa täydellisen lukutilan projektion, gzipin osiot/checksumit ja v2-/legacy-tarkastimen (`SYS`). | H/M4.3; complete-tilan artifact-väite ei ole partial/unavailable-artifact-testi. Nämä tilat suojataan erillisillä reader/UI-väittämillä; ei D029-06:n lisäominaisuus. |
| D029-05 | Sama H5-failure sink ja ilmoitus kuin R26 | Samat todellisen writer-virheen ja DESK-LOG-FAILURE-001/002:n väittämät (`UD/EL`). | H; käynnistyksen ilmoitus ei lupaa incidentin pysyvyyttä. |
| R030-01 | Tilaton `W/shared/ui/LoadingStatus.tsx`, featureiden omat nykyiset tilat | Sisartesti: polite/atomic/escaping/tyhjä live-region. `T/web/loadingFeedbackJourneys.spec.ts`, UI-WAIT-001/002/003: ei tuplakutsua, peruutus/vanha vastaus, desktop/mobile/reduced-motion (`UW/WEB`). | M4.1; selainkomponenttiprobe ei ole kaikkien toimintojen native-todistus. |
| R030-02 | Nykyinen workspace service/delete/resume, main/capability/preload ja `W/features/workspaces/WorkspaceDeletionForm.tsx` | `T/electron/workspaceDeletionExecution.spec.ts`, DESK-DELETE-UI-001 ja RECOVERY-001: oikea lomake, kaksi native-vahvistusta, SQLite/PDF/secret, kohteen poissaolo/restart ja vieraat tavut (`EL`). | W7.5; 23 rivin/10 roolin syväketju ja build-once-paketti säilyttävät omat erilliset lähdeidentiteettinsä. |
| R030-03 | `D/profileBackup/portableProfileBackup.ts`, mainin tuore aktiivinen workspace-nimi saman backup-leasen sisällä | `portableProfileBackup.test.ts`: yritys+pvm, vaaralliset merkit, Unicode-raja ja date-only-fallback (`UD`); M4.2 sisältää native-/palautusnäytön. | M4.2; ehdotettu tiedostonimi ei ole omistajuus-/eheystodiste. |
| R030-04 | Nykyinen i18n, featuret ja mainin native-palaute; update trust/cache/capability erillisinä omistajina | Nykyinen `LocalUpdatePanel.test.tsx` säilyttää yleisvirheen (`UW`). M5.1:n policy/cache/capability-regressiot todentavat syyn alkuperän, vaihe-/roolirajan ja myöhäisen palautteen eston; `desktopRestoreStartup.test.ts` todentaa oikean policy/cache-ketjun kontrolloituun native-palautteeseen (`UD`). Workspace ja secret epävarmuus erotellaan omissa nykyisissä poluissaan. | Paikallinen rajattu toteutus: 136 update-vaikutustestiä, 531 main-testiä, desktop-tyypitys ja rajattu riippumaton toteutuskatselmus läpäisivät. Pakotettu alkuperäinen virhe säilyi nykyisessä salaus/purku-kokeessa. Ei koko desktopin tai aidon Windows-dialogin näyttö. Puhtaan lähteen paketti- ja PR/main-portit avoinna; ensihylkäykset säilyvät. |
| R030-05 | [Nykyinen käyttö- ja tukiohje](../product/local-desktop-user-guide.md), [ohjehakemisto](../README.md), omistavat moduuli-/support-ohjeet | Todelliset UI-tekstit/polut ja turvalliset virhetoimet täsmätty lähteeseen; linkki-/ankkuritarkistus ja rajattu riippumaton sisältökatselmus läpäisivät ohjeen kahden täsmennyksen jälkeen. Vanha 0.2.8-ohje ei muutu 0.3.0-testitulokseksi. | M5.1:n paikallinen dokumenttitoteutus; PR/main-portit vielä avoinna. |
| R030-08 | Diagnosticsin nykyinen rajattu browse-reader, HTTP/strict-client ja `W/features/diagnostics/hooks/useDiagnostics.ts` | `T/web/diagnosticBrowsingJourneys.spec.ts`, OBS-DIAGNOSTIC-BROWSE-UI-001/002/003: molemmat suunnat, append vasta Uusimmat-haussa, vanhojen rivien säilytys ja truncated-lähteen vanheneminen (`WEB`). | M4.3; ei atominen lokisnapshot tai rajaton haku; summary/tukipaketti erillisiä. |

**Jäljellä M5.1:ssä:** katselmoidun R030-04:n palautetäsmennyksen ja
R030-05:n ohjeiden puhtaan lähteen soveltuva paketti- ja PR/main-integraatio.
Vanhat ensivirheet ja tuntemattomat siivoustilat säilyvät alkuperäisissä
checkpoint-rajoissaan. Nykyinen kartta ei nimeä niitä korjatuiksi eikä
hyväksy M5.2:ta, uutta skannausta tai 0.3.0:n toimitusta.

**R030-04:n rajattu toteutussopimus:** nykyinen candidate-versionvertailu
tuottaa vain tunnetulle ei-uudemmalle versiolle suljetun sisäisen syyn.
Se säilytetään cache-kääreiden yli vain kyseisen policy-kutsun alkuperästä
ja todellisesta `sourceValidation`-vaiheesta. Main näyttää sille kiinteän
suomenkielisen native-ilmoituksen. IPC DTO, julkinen yleiskoodi ja nykyiset
diagnostiikkaprojektiot eivät muutu. Syytä ei päätellä viestistä, yleisestä
cause-ketjusta tai muun riippuvuuden samantyyppisestä virheestä. Exact-current-
palautuspaketin rekisteröinti ja journal-bound rollback säilyvät erillisinä.
Hylkäys tapahtuu ennen hash-tarkistusta eikä todista paketin eheyttä.

Muu palaute täsmätään tämän kartan nykyisiin polkuihin: perustietojen
lukuesto ja käsinluku R07, asiakkaiden estot ja turvallinen fallback R09-R11,
luonnoksen tallennus-/hyväksyntäesto R05-R06, salaisuusmuutoksen epävarmuus
R14/R16, toimituksen epävarmuus B/S030-03, backupin peruutus R030-01,
poiston lopputulos R030-02 ja diagnostiikan osittaisuus R25/R030-08.
Näiden vanhaa hyväksyntää ei korvata pelkällä käännösavaimen löytymisellä;
nykyiset erottavat testiväitteet ja kytkentärajat on nimetty niiden riveillä.

Katselmuksen lisäehto on palautteen tuoreus: keskeneräisen valinnan hylkäys
ei näytä myöhäistä ilmoitusta dispose-tilassa tai suljetun/väärän ikkunan tai
framen kautta. Nykyiset sender-/frame- ja handoff-sulkusuojat säilyvät.
Tämä ei peru alkanutta cache-I/O:ta tai anna uutta päivitysvaltuutta.
Kohdetestit todentavat syyn alkuperän, kilpailijoiden virhejärjestyksen,
current/candidate-erottelun, säilyvät slotit ja oikean main-liitoksen.
Vaadittu kaksiprosessinen hardened Windows
backup → inspect → restore → restart → compare -portti säilyy. Omistaja
hyväksyi 14.11.2026 vain nykyisten turvaporttien vaatiman eristetyn
synteettisen Windows-testipaketin valmistelun ja todennuksen osaksi M5.1:tä.
Tämä täsmentää Goalin yleistä paketointirajausta: unit-testi ei korvaa
pakollista porttia, mutta testipaketti ei avaa M5.4:n varsinaista versionnostoa,
release-ehdokasta, jakelua tai M5.5:n käyttäjätestihyväksyntää. Samat puhtaan
lähteen, build-once-artifactin, testieristyksen ja siivouksen ehdot säilyvät.

#### Myöhemmät M5-portit

Jokaisessa paketissa käytetään
[toiminnon valmistumisporttia](../ai/workflow.md#toiminnon-valmistumisportti):
oikeaa käyttäytymistä odottava regressio, todellinen runtime-kytkentä,
onnistuminen/esto/virhe/peruutus, turvallinen jäljitettävyys, sovitut
diagnostiikka- ja tukiprojektiot, ilmoitukset, ohje ja palautettavuus.
Uusi toiminto tuo nämä mukanaan eikä vain onnellisen polun testiä.

Koko korjaus- ja ominaisuuskokonaisuuden valmistuttua tehdään ensin koko
sovelluksen syvä koodi-, arkkitehtuuri- ja ylläpidettävyyskatselmus, vasta
sen jälkeen uusi Codex Security Deep Scan `Ultra`-päättelyllä. Omistajan
4.10.2026 täsmennys määrää tämän järjestyksen, ei uutta rinnakkaista roadmapia
tai kaikkien suurten tiedostojen automaattista uudelleenkirjoitusta.

Koodikatselmus kattaa backendin, webin, desktopin, jaetut paketit, jokaisen
toteutetun moduulin ja yhteisen testiperustan:

- vastaako todellinen riippuvuussuunta hyväksyttyä modulaarista monoliittia,
  Clean Architecture -kerrosrajoja sekä domain/application/port/adapter-jakoa
- säilyvätkö datan omistajuus, composition rootin vastuu ja moduulien julkiset
  luku-/kirjoitusportit ilman oikopolkuja tai kiertäviä riippuvuuksia
- löytyykö vaikeasti seurattavaa ohjausta, päällekkäistä logiikkaa tai usean
  vastuun koodikeskittymiä, joiden jakaminen oikeasti parantaa ylläpidettävyyttä;
  rivimäärä yksin ei ole refaktorointiperuste
- tarvitseeko todellinen toisto yhteisen työkalun vai kuuluuko se edelleen
  moduuliin; ei yleistä utils-kerrosta tai uutta riippuvuutta ennakolta
- ovatko uudet moduulit ja testit lisättävissä nykyisten pienten rajapintojen
  kautta, ja vastaavatko ohjeet, lukureitit, testit ja diagnostiikka toteutusta.

Tuloksena kirjataan lähdeviitteellinen, priorisoitu havaintolista, omistajat,
korjausten rajaus ja hyväksyntäehdot nykyiseen suunnitelmaan. Vertailuperustana
ovat hyväksytyt ADR:t, [moduulirajat](module-boundaries.md),
[integraatiomatriisi](module-integration-matrix.md) ja
[siivousroadmapin vastuusäännöt](codebase-cleanup-roadmap.md).
Korjaukset tehdään erillisinä katselmoituina paloina; laaja arkkitehtuurimuutos
vaatii edelleen päätöksen. Sovitut ennen julkaisua tarvittavat korjaukset ja
niiden regressiot valmistuvat ennen Deep Scanin ehdokasrevision jäädytystä.

Ajankohta on 0.3.0-toteutuskokonaisuuden jälkeen mutta ennen lopullista
toimitushyväksyntää. Deep Scan on uusi erikseen
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
