# AI-työtapa Eky-projektissa

Tämä dokumentti määrittelee, miten AI-avustajia käytetään Eky-projektissa.

AI ei ole projektin arkkitehti. AI on suunnittelu-, dokumentointi- ja toteutusapuri.

## Perusperiaate

AI tekee töitä ihmisen määrittelemien rajojen sisällä.

Ihminen toimii ratkaisuarkkitehtina ja päätöksentekijänä.

AI voi ehdottaa, vertailla, kirjoittaa, refaktoroida ja testata, mutta se ei saa itsenäisesti muuttaa projektin arkkitehtuuria, lisätä uusia riippuvuuksia, muuttaa turvallisuusmallia tai keksiä uusia liiketoimintasääntöjä.

## AI:n roolit

- ChatGPT: arkkitehtuurin suunnittelu, dokumentointi, kriittinen arviointi ja kokonaisuuden jäsentäminen
- Gemini: vaihtoehtojen arviointi, tekninen sparraus ja toinen näkökulma
- Codex: koodin kirjoittaminen, refaktorointi, testien luonti ja tiedostojen muokkaus VS Codessa

AI-avustajien ehdotuksia ei hyväksytä automaattisesti. Ihminen tarkistaa, rajaa ja hyväksyy työn.

Agenttien ja aliagenttien käyttö on oletusarvoisesti sallittu jokaisella
työskentelykierroksella juuri-[AGENTS.md:n](../../AGENTS.md#agenttien-ja-aliagenttien-käyttö)
pysyvän delegointiluvan mukaisesti, ellei omistaja erikseen kiellä tai rajaa
sitä. Käytä delegointia tarpeen mukaan; pääagentti vastaa työn rajauksesta,
tulosten tarkistamisesta ja yhteisten hyväksyntäporttien noudattamisesta.

### Agenttien tarkoituksenmukainen käyttö

Pääagentti valitsee delegoinnin tehtävän hyödyn ja riskin perusteella ilman
uutta lupapyyntöä. Lupa ei tarkoita velvollisuutta käyttää aliagentteja.
Tavoite on vähentää päällekkäistä työtä, ei turvallisuutta tai tarkistuksia.

- Pieni, suoraviivainen muutos tehdään yleensä ilman aliagenttia. Rajatussa
  työssä yksi riippumaton katselmoija voi riittää; laajemmassa työssä
  lähtökohtana voi olla 1–2 aidosti erillistä osatehtävää. Nämä eivät ole
  ylärajoja: pääagentti voi käyttää enemmän agentteja, kun erillinen vastuu
  tai tarkistus tuo todellista hyötyä.
- Delegoi nimetty kysymys tai rajattu tulos, älä samaa kokonaistutkimusta
  usealle agentille ilman perusteltua riippumattoman vertailun tarvetta.
  Turvallisuuden, palautuksen, migraation ja prosessielinkaaren vaatimaa
  riippumatonta katselmusta ei poisteta säästön vuoksi. Toteuttajan oma
  jatkotarkistus ei korvaa riippumatonta katselmoijaa.
- Anna tehtävänanto, soveltuvat ajantasaiset ohjepolut, lähtörevisio,
  sallitut luku-/kirjoitusalueet, rajauksen ulkopuoliset asiat ja
  valmistumisehto. Linkitä olemassa oleva näyttö koko keskustelun tai
  raakalokien toistamisen sijaan. Aliagentti lukee oman vastuunsa pakolliset
  ohjeet; pääagentin tiivistelmä ei korvaa niitä.
- Pyydä tiivis tulos: havainnot ja niiden todisteviitteet, muuttuneet
  tiedostot, tehdyt tarkistukset sekä avoimet riskit. Raportin lyhyys ei saa
  piilottaa epäonnistumista tai puuttuvaa näyttöä. Pääagentti tarkistaa
  olennaisen lähde- ja testinäytön, ei vain aliagentin johtopäätöstä.
- Jatka läheistä osatehtävää samalla agentilla, jos sen konteksti on vielä
  käyttökelpoinen. Anna muuttuneet ohjeet ja revisio uudelleen. Älä jatka
  vanhentuneesta tilasta tai käytä toteuttajaa riippumattomana arvioijanaan.
  Sulje tarpeeton agentti tehtävän valmistuttua tai vastuun siirryttyä.
- Sovita aliagentin päättelyteho sen rajattuun tehtävään työkalujen
  mahdollisuuksien ja omistajan vähimmäistason puitteissa. Älä tilaa uutta
  täysimittaista analyysia pelkkää odottamista tai muuttumatonta tilatietoa
  varten. Käytä CI:ssä [yhtä seurantavastuuta](#ci-ajon-seuranta-ja-virhetodisteet)
  ja olemassa olevia keräystyökaluja.
- Kokoa toteutus ja katselmointi rajatuksi toiminnalliseksi checkpointiksi,
  älä automaattisesti omaksi kierrokseksi jokaista apufunktiota varten.
  Rajaa jatkokatselmus muuttuneeseen osaan ja sen vaikutuksiin; älä teetä
  jo tarkistettua kokonaisuutta uudelleen ilman uutta syytä. Pakolliset
  riippumattomat katselmukset, kohdetestit ja integraation loppuarvio säilyvät.

Arvioi delegoinnin hyötyä valmistuneiden tulosten ja päällekkäisen työn
perusteella. Älä lupaa tokenisäästön prosenttia ilman vertailukelpoista
mittausta. Näiden käytäntöjen vuoksi ei rakenneta uutta agentti- tai
seurantajärjestelmää.

### Mallin ja päättelytason valinta

Anna uuden tehtävän aloitusviestissä mallia ja päättelytasoa koskeva lyhyt
suositus sekä syy. Nykyisen mallin pitäminen voi olla paras valinta.
Arvioi tehtävän rajaus, epäselvyys, vastuurajat ja virheen seuraukset:
tavallinen ohjaus tai kirjaus tarvitsee yleensä vähemmän päättelyä kuin
usean vastuun suunnittelu tai vaikea turvallisuus-, data- tai elinkaarivirhe.
Laatu ja vaadittu näyttö ratkaisevat; pienin tokenikulutus ei ole tavoite
niiden kustannuksella.

Erota malli ja päättelytaso toisistaan ja suositus todellisesta asetuksesta.
Suosittele vain käytettävissä olevia vaihtoehtoja, älä väitä nähneesi tai
muuttaneesi asetusta ilman vahvistusta. Konekohtaiset mallitoiveet säilyvät
paikallisissa ohjeissa, eivät tässä yhteisessä dokumentissa. Tarkista
juuri-`AGENTS.md`:n osoittama paikallinen vähimmäistaso myös delegoinnissa.
Omistaja säätää keskustelun mallin suosituksen perusteella; suositus tai
ohjetiedoston muutos ei itsessään muuta ajonaikaista malliasetusta.

Jos vaikeus tai riski muuttuu olennaisesti, anna uusi suositus ennen siihen
liittyvää toteutusta. Jos työn turvallinen jatkaminen edellyttää suositeltua
vaihtoa tai omistaja on pyytänyt vaihtosuosituksen yhteydessä taukoa,
pysäytä kyseinen työ ja odota omistajan vaihtoa tai jatkopäätöstä.
Muulloin lyhyt suositus riittää eikä samaan tehtävään tarvita toistuvia
asetuskyselyjä. Kaikilla tasoilla noudatetaan samoja hyväksyntäportteja.

## Työn aloitusjärjestys

Aina luettava:

- `AGENTS.md`

Tehtävän mukaan luettavat dokumentit määritellään `AGENTS.md`-tiedostossa.

Jos kohdekansiossa on oma `AGENTS.md`, se on luettava ennen muutoksia.

Tämä on jokaisen tehtävän pysyvä aloitusportti, ei julkaisukohtainen tarkistus:

1. Nimeä kosketettavat sovellukset, moduulit, jaetut paketit ja vastuurajat.
2. Tarkista juuri-`AGENTS.md`:n aihekohtaiset lukureitit ja kohdepolkujen
   soveltuvat `AGENTS.md`-tiedostot. Lue niiden osoittamat voimassa olevat
   vastuuohjeet, ADR:t ja tehtävän omistava suunnitelma.
3. Tarkista myös vaikutusalueen testaus-, diagnostiikka-, tietoturva- ja
   palautettavuusohjeet. Kirjaa aloitukseen lyhyesti olennaiset luetut ohjeet
   ja avoimet päätökset; tiedostolista ei yksin osoita sisällön lukemista.
4. Jos tehtävän aikana sivutaan uutta osaa, toista tarkistus sen osalta ennen
   muutoksia. Anna aliagentille sama rajattu lukureitti; pääagentti tarkistaa
   tulosten ohjeenmukaisuuden.
5. Anna [malli- ja päättelytasosuositus](#mallin-ja-päättelytason-valinta)
   ja valitse [tarkoituksenmukainen agenttijako](#agenttien-tarkoituksenmukainen-käyttö).
   Pienessä tehtävässä pääagentin oma työ ja yhden virkkeen suositus riittävät.

Koko `docs`-kansiota ei lueta joka kerta, mutta ohjetta ei sivuuteta siksi,
ettei se ollut ensimmäisessä luetussa listassa. Etsi puuttuva reitti alueen
omistajan ja aiheen perusteella. Ristiriita tai puuttuva olennainen sopimus
rajataan ratkaistavaksi juuri-`AGENTS.md`:n etusija- ja pysäytyssäännöllä.

## Pienissä paloissa eteneminen

AI:lle ei anneta liian suuria tehtäviä kerralla.

Vältä pyyntöjä kuten:

- tee koko laskutusmoduuli
- rakenna asiakashallinta
- tee ERP:n backend
- luo kaikki tietokantataulut
- tee koko UI

Suosi pieniä ja rajattuja tehtäviä:

- luo customer-domainin alustavat tyypit
- tee validointiskeema asiakkaan luonnille
- lisää api-client-funktio asiakkaiden hakemiseen
- kirjoita yksikkötestit laskun summalaskennalle
- refaktoroi tämä tiedosto yhden vastuun periaatteen mukaiseksi

Nollaa konteksti säännöllisesti. Kun siirryt täysin uuteen tehtävään tai moduuliin, aloita uusi chat-sessio.

## Toteutussuunnitelma ennen koodaamista

### Toiminnon aloitusportti

Ennen jokaista rajattua toteutuspalaa, myös virhekorjausta, tarkista
voimassa olevat ohjeet, roadmapin tila ja edeltävän hyväksyntäportin näyttö.
Kirjaa lyhyesti tavoite, omistava vastuu, säilyvät sopimukset, rajauksen
ulkopuoliset asiat ja avoimet kysymykset. Koko roadmapin hyväksyntä ei
ratkaise sen erikseen päätettäviksi merkittyjä kysymyksiä.

Ratkaise toteutukseen vaikuttavat avoimet kysymykset ja tarvittavat
omistajapäätökset ennen koodimuutoksia. Jos uusi epäselvyys ilmenee työn
aikana, pysäytä sen vaikutusalue ja päivitä suunnitelma; älä keksi sopimusta
lennossa. Riippumaton, jo hyväksytty työ voi jatkua.

Valitse samalla tarvittava testinäyttö sekä arvioi ilmoitukset, lokitus,
diagnostiikka, auditointi, dokumentointi, tietoturva ja palautettavuus
[toiminnon valmistumisportin](#toiminnon-valmistumisportti) mukaan.
Soveltumaton kohta perustellaan. Päivitä roadmapin ja omistavan suunnitelman
tila aloituksessa, päätöksen muuttuessa ja hyväksynnässä, ei vasta julkaisun
lopuksi. Pieni tehtävä tarvitsee vain lyhyen kirjauksen, ei uutta
suunnitelmadokumenttia.

### Suunnitelman sisältö ja hyväksyntä

Laajoissa tai arkkitehtuuriin vaikuttavissa tehtävissä AI:n pitää antaa lyhyt toteutussuunnitelma ennen koodimuutoksia.

Suunnitelmassa pitää kertoa:

- mitkä dokumentit luetaan tai on luettu
- mitä tiedostoja aiotaan luoda
- mitä tiedostoja aiotaan muokata
- mihin kerroksiin muutos osuu
- mitä moduulia muutos koskee
- syntyykö uusia riippuvuuksia
- tarvitaanko testejä
- onko jokin asia epäselvä

Koodaamista ei aloiteta ennen hyväksyntää, jos tehtävä:

- muuttaa arkkitehtuuria
- lisää uuden moduulin
- lisää uuden riippuvuuden
- muuttaa liiketoimintasääntöä
- muuttaa tietomallia
- koskee turvallisuutta
- koskee laskutusta, käyttöoikeuksia tai audit trailia
- koskee useita kerroksia yhtä aikaa

Uusi riippuvuus vaatii aina oman hyväksyntänsä. Muun tehtävän tai kokonaisen
toteutusvaiheen hyväksyntä ei riitä, ellei projektin omistaja hyväksy samalla
nimenomaisesti nimettyä riippuvuutta. Jos riippuvuuden tarve havaitaan vasta
koodauksen aikana, työ pysäytetään ennen asennusta, importtia sekä
`package.json`- tai lockfile-muutosta ja asia tuodaan uudelleen projektin
omistajan päätettäväksi.

## Älä arvaa liiketoimintasääntöjä

AI ei saa keksiä yrityksen prosesseja omasta päästään.

Jos liiketoimintasääntö puuttuu dokumentaatiosta, AI:n pitää kysyä tai rajata tehtävä niin, ettei puuttuvaa sääntöä tarvitse päättää.

Esimerkkejä asioista, joita AI ei saa arvata:

- miten lasku hyväksytään
- milloin työ voidaan laskuttaa
- kuka saa muuttaa asiakastietoja
- miten materiaalit hinnoitellaan
- mitä tapahtuu, jos lasku perutaan
- miten työntekijän tuntikirjaus hyväksytään
- miten asiakas, kohde ja työmääräys liittyvät toisiinsa

Jos sääntö puuttuu, se kirjataan avoimeksi kysymykseksi oikeaan dokumenttiin.

## Dokumentaatio elää projektin mukana

Kun arkkitehtuuri, moduuliraja, teknologiapäätös, turvallisuussääntö tai liiketoimintasääntö muuttuu, dokumentaatio pitää päivittää.

Dokumentaation päivittäminen on osa muutosta.

Ohjeen löydettävyys on myös osa muutosta: kun ohje lisätään, siirretään,
nimetään uudelleen tai sen soveltamisala muuttuu, tarkista siihen johtava
lukureitti juuri- tai lähimmästä `AGENTS.md`:stä ja omistavasta moduuli- tai
arkkitehtuuridokumentista. Korjaa vaikutusalueen polut ja otsikkoankkurit.
Pidä sääntö yhdessä omistavassa dokumentissa ja linkitä siihen kopioimisen
sijaan. Erota voimassa oleva ohje historiallisesta checkpointista; yksityistä
runbookia tai sen konekohtaisia havaintoja ei siirretä yhteisiin ohjeisiin.

Kun työ valmistuu, korvaa sen vanhentunut nykytilaväite; älä vain lisää
uutta onnistumisriviä ristiriitaisen väitteen rinnalle. Roadmap kertoo
tilan, seuraavan työn ja hyväksyntäviitteen, omistava suunnitelma tarkan
sopimuksen. Tutkimushistoria säilyy erikseen nimettynä ja sitä luetaan
tarvittaessa, ei jokaisen tehtävän pakollisena lähtöaineistona.
Tiivistämisessä säilytetään vaatimukset, päätökset, todisteviitteet ja
toimivat lukureitit. Testien, diagnostiikan tai palautuksen kattavuutta ei
vähennetä ohjeiden lyhentämisen tai tokenisäästön vuoksi.

Seuraavan sovitun julkaisun sisältö ja jatkotoiveet pidetään yhteisessä
[0.3.0-tehtävälistassa](../architecture/release-0.3.0-plan.md). Päivitä
tehtävän tila, rajaus ja hyväksyntäviite työn edetessä. Erota sovittu sisältö,
vielä päätettävät ehdotukset ja myöhemmäksi jätetyt asiat; keskustelussa
esitettyä ideaa ei merkitä automaattisesti hyväksytyksi toteutukseksi.
Julkaisunumeroa ei nosteta jokaisesta pienestä korjauksesta tai commitista:
noudata [julkaisurytmiä ja versiointia](../architecture/release-versioning-policy.md#julkaisurytmi-ja-muutosten-kokoaminen).

Esimerkkejä:

- uusi teknologiapäätös -> `docs/architecture/tech-decisions.md`
- uusi moduuliraja -> `docs/architecture/module-boundaries.md`
- uusi riippuvuussääntö -> `docs/architecture/dependency-policy.md`
- uusi turvallisuussääntö -> `docs/architecture/security-principles.md`
- uusi liiketoimintatermi -> `docs/product/glossary.md`
- uusi työnkulku -> `docs/product/workflows.md`
- uusi moduuli -> `docs/modules/`

## AI ei saa kiertää arkkitehtuuria

Kiellettyjä esimerkkejä:

- React-komponentti kutsuu suoraan tietokantaa
- React-komponentti kutsuu suoraan Firebasea, jos auth-wrapper on olemassa
- business-logiikka kirjoitetaan JSX-komponenttiin
- laskutuslogiikka kirjoitetaan lomakkeeseen
- backend handler sisältää paljon liiketoimintalogiikkaa
- repository päättää liiketoimintasäännöistä
- moduuli muuttaa toisen moduulin dataa suoraan
- uusi kirjasto lisätään ilman perustelua
- yleinen `utils.ts` luodaan epäselvyyden piilottamiseksi

Jos oikea paikka on epäselvä, AI:n pitää pysähtyä ja kysyä.

## Git on tekoälyn turvaverkko

Tee Git-commit ennen kuin annat AI:lle luvan tehdä laajoja muutoksia, refaktorointia tai useaan tiedostoon osuvia muutoksia.

Kun AI saa yhden pienen palasen valmiiksi ja olet tarkistanut sen, tee uusi commit.

Hyviä commit-esimerkkejä:

- `docs(ai): add workflow rules`
- `feat(validation): add customer schema`
- `feat(domain): add invoice status model`
- `test(domain): add invoice total calculation tests`
- `refactor(api): isolate customer API client`

Älä anna AI:n tehdä suuria muutoksia likaisen työpuun päälle.

Tarkista ennen laajaa AI-muutosta:

`git status`

### Ennen julkaisemista

Jokaisen commitin, pushin, PR-/issue-tekstin ja artifact-latauksen edellä
noudata juuri-`AGENTS.md`:n konekohtaisten tietojen julkaisukieltoa ja
`docs/architecture/security-principles.md`:n omistajan tietojen julkaisurajaa.
Tarkista julkaistava sisältö, ei vain tiedoston nimeä tai Git-ohitusta.
Raporttiin saa jäädä projektin sopimus ja hyväksyntätila, ei omistajan
koneeseen liittyvää diagnostiikkaa. Epäselvä sisältö jää paikalliseksi,
kunnes julkaisukelpoisuus on ratkaistu. Jo julkaistu poikkeama kerrotaan
omistajalle; historian siivousta ei käynnistetä ilman erillistä päätöstä.

### Mergen valtuus hyväksytyssä Goalissa

Juuri-[AGENTS.md:n](../../AGENTS.md#mergen-valtuus-hyväksytyssä-goalissa)
pysyvä lupa kattaa pääagentin tekemän normaalin PR-mergen hyväksytyn,
käynnissä olevan Goalin sisällä. Erillistä merge-lupaa ei kysytä uudelleen
vain siksi, että hyväksytty työ saavutti integraatiovaiheen. Goalin rajaus,
omistajan nykyiset päätökset ja kaikki muut hyväksyntäportit säilyvät.
Omistajan myöhempi kielto, tauko tai täsmällisempi valtuusraja ohittaa
tämän yleisen luvan. Pelkkä automaattinen Goal-jatko ei kumoa niitä.

Ennen mergeä pääagentti varmistaa ja kirjaa nykyiseen hyväksyntächeckpointiin:

- PR kuuluu hyväksyttyyn Goaliin, eikä avoinna ole sen estävää päätöstä,
  katselmushavaintoa tai hyväksymätöntä poikkeusta.
- Base, head ja julkaistava diff ovat odotetut; PR ei ole draft ja merge on
  konfliktiton. Lähteen tai basen muutos vaatii hyväksyntänäytön tarkistuksen.
- Juuri kyseisen revision katselmus sekä valitut ja vaaditut tarkistukset
  ovat valmistuneet hyväksytysti. Pending-, cancelled- tai flaky-tulosta
  ei tulkita onnistumiseksi eikä ensivirhettä poisteta myöhemmän vihreyden vuoksi.
- Tavallinen suojattu merge tehdään eksplisiittisellä strategialla ja
  hyväksyttyyn head-revisioon sidottuna. Operaation tulos varmistetaan ja
  uuden main-revision omat vaaditut ajot seurataan loppuun.

Lupa ei kata force pushia, historian uudelleenkirjoitusta, admin-ohitusta,
branch-suojausten tai required checkien kiertämistä, punaisen tai
keskeneräisen PR:n mergeä eikä Goalin ulkopuolista työtä. Se ei ota käyttöön
GitHubin auto-mergeä eikä muuta Dependabot- tai muiden riippuvuuspäätösten
hyväksyntäkäytäntöä. Erillinen riippuvuus-, arkkitehtuuri-, tietosuoja- tai
julkaisupäätös pyydetään edelleen silloin, kun sellainen tarvitaan.

### CI-ajon seuranta ja virhetodisteet

Ennen tehtävään kuuluvaa testi- tai CI-ajoa nimeä seurannan omistaja ja
varmista käytettävissä oleva havainto- ja tallennusketju. Seuranta on
pääagentin tai rajatun, vain lukevan aliagentin vastuulla koko ajon ajan,
myös PR:n mergen jälkeisessä `main`-ajossa. Kun pääagentti tekee muuta työtä,
käytä erillistä seuranta-agenttia, jos se on saatavilla ja sallittu; muuten
pääagentti hoitaa seurannan itse. Älä jätä ajoa pelkän lopputuloksen varaan.

- Yhdellä ajolla on yksi nimetty aktiivinen seurantavastuu. Käytä nykyistä
  automaattista keräystä lokien ja tilamuutosten säilyttämiseen; se ei yksin
  korvaa agentin vastuuta havaintojen käsittelystä. Pääagentti ei toista
  seuranta-agentin tilakyselyjä rinnakkaisena kyselysilmukkana. Vastuun siirto
  kirjataan, eikä seuranta saa katketa säästön vuoksi.
- Seuranta-agentti ilmoittaa merkityksellisestä muutoksesta, ensimmäisestä
  hylkäyksestä, puuttuvasta aineistosta, valmistumisesta tai päätöstarpeesta.
  Muuttumattomia tiloja ei analysoida ja raportoida toistuvasti. Pääagentin
  oma lopullinen revision, kattavuuden ja hyväksyntänäytön tarkistus säilyy;
  se on eri tehtävä kuin jatkuvan tilaseurannan kahdentaminen.
- Sido seuranta lähderevisioon ja ajokomentoon; CI:ssä lisäksi todelliseen
  checkoutiin, run ID:hen, yritykseen ja valittuihin jobeihin.
  Käytä nykyisiä luku-/odotustyökaluja
  kohtuullisella tarkistusvälillä, älä tiheää kyselysilmukkaa.
- Tartu hylkäykseen heti, kun tieto on saatavilla: säilytä ensimmäisen
  epäonnistuneen yrityksen lokit, turvallinen virhekoodi, viimeinen havaittu
  vaihe, timeout-/cleanup-tulos ja olemassa olevat liitteet. Erota puuttuva
  havainto onnistumisesta. Jos palvelu antaa lokin tai artifactin vasta jobin
  loputtua, hae se silloin; pelkkä tilaseuranta ei ole live-lokivirta.
- Seuranta-agentti ei käynnistä testejä uudelleen, muuta koodia, peruuta ajoa
  tai mergeä. Pääagentti varmistaa havainnot ja omistaa hyväksyntäpäätöksen
  valmistelun. Julkaisu- ja yksityisyysrajat koskevat myös kerättyjä todisteita.
- Jos seuranta katkeaa, kirjaa katkos ja jatka saman ajon tunnisteista.
  Älä aloita korvaavaa ajoa tai väitä seurantaa katkeamattomaksi. Sulje
  seuranta-agentti vasta rajatun tehtävän päätyttyä tai vastuun siirryttyä.

Testin oma turvallinen vaihehavainto ja agentin ajoseuranta täydentävät
toisiaan. Agentti ei voi palauttaa tietoa, jota testi ei tallentanut.
Jos vianrajaus tai hyväksyntä tarvitsee puuttuvan havainnon, suunnittele sen
rajattu tallennus ennen kyseistä koetta; kaikkea mahdollista diagnostiikkaa
ei lisätä jokaisen ajon ehdoksi. Virhettä ei nimetä korjatuksi uusinta-ajon
vihreyden perusteella eikä hyväksyntäehtoja muuteta seurantaa varten.
Mahdollinen yksi hallittu uusinta ja rajattu kehityspoikkeus käsitellään
[testausohjeen](testing-rules.md#ensivirhe-uusinta-ja-rajattu-poikkeus) mukaan.
Punaisen tai jumittuneelta näyttävän ajon käytännön etenemisjärjestys on
[rajattu vianrajaus ennen uusintaa](testing-rules.md#rajattu-vianrajaus-ennen-uusintaa):
varmenna tila, säilytä ensivirhe, tarkista myös sovelluskoodi ja hyödynnä
saatavilla olevaa GitHubin tekoälyselitystä tarkistettavana hypoteesina.
Selvä vika korjataan; avoimeksi jäänyt syy ei yksin estä yhtä rajattua
uusintaa. Uusinnan salliminen ja tuloksen hyväksyminen ovat eri päätöksiä.
Seuranta-agentin vain lukeva rooli ei muutu.

## Puhdas baseline ja julkaistavan artifactin portti

Uuden toiminnallisen vaiheen oletus on vihreä baseline. Rajattu,
ei-kriittinen puute voi sallia siitä riippumattoman kehitystyön vain
[omistajan hyväksymällä määräaikaisella poikkeuksella](testing-rules.md#määräaikainen-kehityspoikkeus).
Ennen seuraavaa vaihetta pitää olla selvää,
mikä commit on kanoninen lähde ja mitkä sen vastuuseen kuuluvat paikalliset
sekä GitHub-tarkistukset ovat päättyneet vihreinä. Odottavaa, peruttua,
flakyksi merkittyä tai epäonnistunutta tarkistusta ei tulkita onnistuneeksi.

Kun työ tuottaa käyttäjälle annettavan desktop-, installer- tai update-
artifactin:

- lopullinen ehdokas rakennetaan puhtaasta commitista
- juuri samoille tavuille ajetaan dokumentoidut paikalliset packaged- ja
  lifecycle-portit; testin jälkeen ei rakenneta käyttäjälle uutta kopiota
- ehdokas käynnistetään ensimmäisen kerran, suljetaan hallitusti,
  käynnistetään uudelleen samalla synteettisellä profiililla ja tarkistetaan,
  ettei prosesseja jää eloon
- päivitysrajaa muuttava ehdokas todistetaan myös edellisen hyväksytyn,
  pienemmän version identiteettiä ja yhteensopivaa synteettistä profiilia
  vasten
- paikallinen kanoninen output korvataan ehdokkaalla vasta, kun ehdokas on
  läpäissyt portin
- pushin tai mergen jälkeen odotetaan kyseisen täsmällisen commitin omat
  vaaditut GitHub-ajot loppuun ennen kuin työ ilmoitetaan valmiiksi

Jos merge-commitin `main`-ajo epäonnistuu, pysäytä siihen nojaava kehitys ja
julkaisu, rajaa vaikutus ja korjaa baseline. Riippumaton kehitys edellyttää
yllä nimettyä poikkeuspäätöstä. PR:n aiempi vihreä ajo ei korvaa
merge-commitin omaa todistetta silloin, kun repository ajaa tarkistukset
myös `main`-pushille.

## Ihmisen tarkistus

AI:n tuottamaa koodia ei pidetä automaattisesti oikeana.

Ihmisen pitää tarkistaa erityisesti:

- moduulirajat
- liiketoimintasäännöt
- tietoturva
- käyttöoikeudet
- rahasummat
- laskutuksen tilat
- virheenkäsittely
- riippuvuudet
- testien järkevyys
- dokumentaation päivitys

AI voi tuottaa paljon koodia nopeasti, mutta arkkitehtuuri ja vastuu pysyvät ihmisellä.

## Toiminnon valmistumisportti

Uusi toiminto tai virhekorjaus arvioidaan kokonaisena käyttäjäpolkuna, ei
vain onnistuvana palvelukutsuna. Seuraavat kohdat tarkistetaan samassa
tehtävässä. Kirjaa olennaiset tulokset tehtävän yhteenvetoon muodossa
**todennettu**, **ei sovellu (perustelu)** tai **avoin (riski ja jatkotyö)**.
Turvallisuuden, datan eheyden tai sovitun hyväksyntäportin avoin kohta estää
valmiiksi ilmoittamisen. Testin ajamatta jättäminen ei ole läpäisy.

| Alue | Tarkistettava asia |
| --- | --- |
| Käyttäjäpolku | Onnistuminen, tyhjä tila, virheellinen syöte ja odotettu esto toimivat. Käyttäjä tietää, onnistuiko toiminto ja mitä tehdä seuraavaksi. |
| Keskeneräinen työ | Lataus/varattu-tila, kaksoispainallus, peruutus, aikakatkaisu ja yhteyskatko eivät tuota tuplatoimintoa tai väärää onnistumisilmoitusta. Epäselvää lopputulosta ei kutsuta epäonnistumiseksi ilman näyttöä. |
| Uudelleenyritys | Uudelleenyritys on turvallinen tai estetty; sivuvaikutus, idempotenssi ja tarvittaessa restart/recovery on huomioitu. Peruutusta ei oleteta jo valmistuneen kirjoituksen kumoamiseksi. |
| Ilmoitukset ja ohje | Suomenkielinen virhe kertoo turvallisesti ongelman ja seuraavan toimen. Näppäimistö, fokus, ruudunlukijan status/alert ja tekstien mahtuminen tarkistetaan muuttuvassa UI:ssa. Käyttöohje päivitetään, kun työnkulku muuttuu. |
| Lokitus ja jäljitettävyys | Omistava toiminto tuottaa sovitun tapahtuman myös virheessä. Vakaa syykoodi ja vaihe säilyvät sisäisessä turvallisessa luokituksessa, vaikka käyttäjälle palautetaan yleisempi virhe. Tarkista tuotannon composition-kytkentä, ei vain testiin injektoitua observeria. |
| Diagnostiikka ja tuki | Katalogi, writer, reader, projektio, strict client ja UI tukevat sovittua tapahtumaa. Tukipaketin ja incident-indeksin sisällytys tai poissulku on tarkoituksellinen. Osittainen, vanhentunut tai epäonnistunut luku ei saa näyttää täydeltä terveystarkistukselta. |
| Audit ja tietoturva | Business audit ja tekninen loki säilyvät erillisinä. Tarkista käyttöoikeus, yritysraja, syötteet ja tietovuodot myös estetyssä polussa. Lokin kirjoitusvirhe ei muuta business-tulosta; kriittisen auditin transaktiosääntö säilyy. |
| Pysyvä data | Migraatio, vanhan version/aineiston yhteensopivuus, backup inclusion/exclusion, restore ja rollback arvioidaan, jos muutos koskee pysyvää tilaa. Ei piilotettuja varmuuskopioita tai uusia retention-sääntöjä ilman päätöstä. |
| Rajat ja testit | Testaa onnistuminen, odotettu esto ja odottamaton virhe oikealla tasolla; huomioi koko-, aika-, levy- ja muistirajat, aikaleimat sekä rinnakkaisuus riskin mukaan. Lisää regressiotesti löydettyyn vikaan ja kytkentätesti kerrosten väliseen katkokseen. |
| Toimitus | Dokumentit, julkaisutiedot ja tarvittavat hyväksyntäportit vastaavat toteutusta. Raportoi ajetut testit, testaamatta jäänyt ja jäljelle jäävät riskit. Asennetun version toiminta, lähdekooditesti ja uusi julkaisu eivät ole sama todiste. |

Tämä ei määrää jokaiseen pieneen muutokseen uutta eventtiä, tukipakettiosiota
tai raskasta E2E-ajoa. Testitasot valitaan `testing-rules.md`:n ja voimassa
olevien packaged-/backup-/release-porttien mukaan. Moduulin omistaja päättää
tapahtumasopimuksen; epäselvä uusi sopimus rajataan päätettäväksi ennen
toteutusta. Soveltuvuuden tarkistus on aina pakollinen.

## Valmiin työn määritelmä

AI:n tekemä työ voidaan katsoa valmiiksi vasta, kun:

- tehtävän tavoite täyttyy
- muutos on oikeassa kerroksessa
- moduulirajat eivät rikkoudu
- turvallisuusperiaatteet on huomioitu
- uudet riippuvuudet on perusteltu tai niitä ei ole
- kriittiset testit on lisätty tai perustellusti jätetty lisäämättä
- toiminnon valmistumisportti on käyty läpi ja sovitut hyväksyntäehdot
  on todennettu myös virhepolussa
- dokumentaatio on päivitetty tarvittaessa
- koodi on luettavaa
- tiedostoilla on selkeä vastuu
- TypeScript-tyyliä noudatetaan
- tehtävän edellyttämät paikalliset tarkistukset ovat päättyneet vihreinä
- mahdolliset vaaditut GitHub-ajot ovat päättyneet vihreinä juuri raportoidulle
  commitille; keskeneräistä tai punaista ajoa ei kutsuta valmiiksi

## Turvallisuusvaikutuksen Raportointi

Kun muutos koskee koodia, API:a, dataa, tiedostoja, riippuvuuksia, integraatioita tai verkkonäkyvyyttä, AI raportoi ennen työn valmistumista:

- mitä luottamusrajoja muutos koski
- mitä ulkoista syötettä käsiteltiin
- missä backend-validointi ja käyttöoikeustarkistus tehdään
- miten yritysrajaus säilyy
- syntyikö uusi tietovuoto-, injektio-, salaisuus-, lokitus- tai dependency-riski
- mitä turvallisuustestejä ajettiin tai miksi niitä ei tarvittu
- onko nykyinen toteutus vain local development -tasoinen vai valmis oikealle datalle

Jos muutos paljastaa olemassa olevan haavoittuvuuden, sitä ei piiloteta raportista. Korjattava haavoittuvuus korjataan rajatusti tai työ pysäytetään projektin omistajan päätöstä varten.
