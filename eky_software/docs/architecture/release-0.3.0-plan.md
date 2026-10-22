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
| R030-01 | Yhtenäinen latausikoni tai odotusilmaisin näkyviin käyttäjälle havaittaviin odotustiloihin eri toiminnoissa. | Suunniteltu; käyttökohteiden kartoitus tekemättä. |
| R030-02 / W7 | Yritystyötilan turvallinen poistaminen käyttöliittymästä. | Mukaan sovittu; valmistelu ja päätösjono kirjattu. Sopimusten hyväksyntä ja toteutus avoinna. |
| R030-03 | Yrityksen nimi mukaan käyttäjän tallentaman varmuuskopion ehdotettuun tiedostonimeen päivämäärän lisäksi. | Suunniteltu; nimen lähde ja turvallinen nimeämissääntö päätettävä. |
| D029-01 | Työtilatoiminnon tarkka turvallinen virhesyy lokiin, esimerkiksi väärän yrityksen varmuuskopion hylkäys. | K:n nimetyt palautuksen syy- ja lukuketjukorjaukset hyväksytty. G:n jäljellä oleva tapahtumakohtainen kattavuus tarkistettava; K ei sulje koko D029-01:tä. |
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
F/R15 on hyväksytty PR #313:n omilla PR/main-porteilla. Nykyinen työ on
G/R20/R23:n rajattu toteutus. Omistaja hyväksyi G-P1/G-P2:n rajauksen,
toteutuksen ja testit 22.10.2026; integraatiohyväksyntä on vielä avoin.
Täsmällinen näyttö ja nykytila ovat
[M1:n jatkamiskohdassa](release-0.3.0-m1-preparation-plan.md#jatka-tästä).
T/A/B/C/K/D/E:tä ei avata uudelleen ilman niiden omaa todennettua regressiota.
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
G/H/I:n kokonaishyväksyntä on edelleen avoin.
D1-D3 ja niiden rajattu HTTP-sulun jatkokorjaus on hyväksytty PR #308:n
ja PR #309:n kautta mainissa `286cc3227ffe37dd44417750636ec30d460a61e1`.
[D:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/309#issuecomment-6324156808)
kirjaa erilliset PR/main-portit ja avoimiksi jätetyt historialliset havainnot.
PR #293:n aiemmat CS-1/CS-2-korjaukset säilyvät. E:n R09-R11 ja rajattu
Vitest-tietoturvahuolto on hyväksytty PR #311:n ja PR #312:n kautta;
[E:n loppuhyväksyntä](https://github.com/eky-software/eky/pull/312#issuecomment-6329634460)
erottaa korjatun revision PR/main-portit avoimista historiallisista syistä.
[Asiakasinvarianttien suunnitelma](release-0.3.0-customer-invariants-plan.md)
säilyttää E:n sopimukset. Nykyinen työ on
[G:n rajattu suunnittelu](release-0.3.0-m1-preparation-plan.md#g--diagnostiikan-tapahtumaketjun-suunnitelma).
G:n uudet tapahtumaprojektiopäätökset hyväksytään ennen tuotantokytkentää;
sen valmistelu ei avaa H/I:n tai M4:n työtä.
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
tehdään ennen D:tä omine lukureitti-, katselmus- ja integraatioportteineen;
sen nykytila luetaan M1:n jatkamiskohdasta. Se ei hyväksy I:n erillisiä
CI-politiikkamuutoksia. Se täydentää jokaisen tehtävän pysyvää
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
eivät uusi valmistelujono. D/E:n päätökset säilyvät niiden hyväksytyissä
sopimuksissa; G/H/W7:n avoimet päätökset ratkaistaan ennen niiden toteutusta.
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
