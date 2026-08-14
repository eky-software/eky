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

## Työn aloitusjärjestys

Aina luettava:

- `AGENTS.md`

Tehtävän mukaan luettavat dokumentit määritellään `AGENTS.md`-tiedostossa.

Jos kohdekansiossa on oma `AGENTS.md`, se on luettava ennen muutoksia.

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

## Puhdas baseline ja julkaistavan artifactin portti

Uutta toiminnallista vaihetta ei aloiteta tietoisesti punaisen tai
keskeneräisen baselinen päälle. Ennen seuraavaa vaihetta pitää olla selvää,
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

Jos merge-commitin `main`-ajo epäonnistuu, uusi työ pysäytetään ja baseline
korjataan ensin. PR:n aiempi vihreä ajo ei korvaa merge-commitin omaa
todistetta silloin, kun repository ajaa tarkistukset myös `main`-pushille.

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

## Valmiin työn määritelmä

AI:n tekemä työ voidaan katsoa valmiiksi vasta, kun:

- tehtävän tavoite täyttyy
- muutos on oikeassa kerroksessa
- moduulirajat eivät rikkoudu
- turvallisuusperiaatteet on huomioitu
- uudet riippuvuudet on perusteltu tai niitä ei ole
- kriittiset testit on lisätty tai perustellusti jätetty lisäämättä
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
