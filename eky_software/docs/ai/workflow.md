# AI-työtapa Eky-projektissa

Tämä dokumentti määrittelee, miten AI-avustajia käytetään Eky-projektissa.

Tavoitteena on hyödyntää AI:ta tehokkaasti ilman, että projektin arkkitehtuuri, moduulirajat tai liiketoimintasäännöt hajoavat.

AI ei ole projektin arkkitehti. AI on suunnittelu-, dokumentointi- ja toteutusapuri.

## Perusperiaate

Eky-projektissa AI tekee töitä ihmisen määrittelemien rajojen sisällä.

Ihminen toimii ratkaisuarkkitehtina ja päätöksentekijänä.

AI voi ehdottaa, vertailla, kirjoittaa, refaktoroida ja testata, mutta se ei saa itsenäisesti muuttaa projektin arkkitehtuuria, lisätä uusia riippuvuuksia tai keksiä uusia liiketoimintasääntöjä.

## AI:n roolit projektissa

Projektissa voi olla useita AI-avustajia eri tehtäviin.

Esimerkkejä:

- ChatGPT: arkkitehtuurin suunnittelu, dokumentointi, kriittinen arviointi ja kokonaisuuden jäsentäminen
- Gemini: vaihtoehtojen arviointi, tekninen sparraus ja toinen näkökulma
- Codex: koodin kirjoittaminen, refaktorointi, testien luonti ja tiedostojen muokkaus VS Codessa

AI-avustajien ehdotuksia ei hyväksytä automaattisesti. Ihminen tarkistaa, rajaa ja hyväksyy työn.

## Työn aloitusjärjestys

Ennen kuin AI tekee muutoksia projektiin, sen pitää lukea oikea konteksti.

Aina luettava:

- `AGENTS.md`

Tehtävän mukaan luettavia dokumentteja:

- `docs/ai/coding-rules.md`
- `docs/ai/testing-rules.md`
- `docs/ai/review-checklist.md`
- `docs/ai/prompt-guidelines.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/tech-decisions.md`
- `docs/architecture/data-model-principles.md`
- `docs/product/business-context.md`
- `docs/product/glossary.md`
- `docs/product/user-roles.md`
- `docs/product/workflows.md`
- `docs/modules/README.md`
- tehtävään liittyvä moduulidokumentti `docs/modules/`-kansiosta

Jos kohdekansiossa on oma `AGENTS.md`, se on aina luettava ennen muutoksia.

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
- luo tyhjä customer-feature-rakenne
- kirjoita yksikkötestit laskun summalaskennalle
- refaktoroi tämä tiedosto yhden vastuun periaatteen mukaiseksi

Pieni tehtävä on helpompi tarkistaa, korjata ja hyväksyä.

Nollaa konteksti säännöllisesti: kun siirryt täysin uuteen tehtävään tai moduuliin, aloita uusi chat-sessio. Näin tekoälyn työmuistiin ei jää roikkumaan edellisen tehtävän sääntöjä, oletuksia tai koodinpätkiä, jotka voisivat sekoittaa uuden työn.

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
- koskee laskutusta, käyttöoikeuksia tai audit trailia
- koskee useita kerroksia yhtä aikaa

Pienissä ja yksiselitteisissä muutoksissa AI voi edetä suoraan, jos muutos noudattaa olemassa olevia ohjeita.

## Älä arvaa liiketoimintasääntöjä

AI ei saa keksiä yrityksen prosesseja omasta päästään.

Jos liiketoimintasääntö puuttuu dokumentaatiosta, AI:n pitää kysyä tai rajata tehtävä niin, ettei puuttuvaa sääntöä tarvitse päättää.

Esimerkkejä asioista, joita AI ei saa arvata:

- miten lasku hyväksytään
- milloin työ voidaan laskuttaa
- kuka saa muuttaa asiakastietoja
- miten materiaalit hinnoitellaan
- mitä tapahtuu, jos lasku perutaan
- miten hyvityslasku muodostetaan
- miten työntekijän tuntikirjaus hyväksytään
- miten asiakas, kohde ja työmääräys liittyvät toisiinsa

Jos sääntö puuttuu, se kirjataan avoimeksi kysymykseksi oikeaan dokumenttiin.

## Dokumentaatio elää projektin mukana

Kun arkkitehtuuri, moduuliraja, teknologiapäätös tai liiketoimintasääntö muuttuu, dokumentaatio pitää päivittää.

Dokumentaation päivittäminen ei ole erillinen lisätyö, vaan osa muutosta.

Esimerkkejä:

- uusi teknologiapäätös -> päivitä `docs/architecture/tech-decisions.md`
- uusi moduuliraja -> päivitä `docs/architecture/module-boundaries.md`
- uusi riippuvuussääntö -> päivitä `docs/architecture/dependency-policy.md`
- uusi liiketoimintatermi -> päivitä `docs/product/glossary.md`
- uusi työnkulku -> päivitä `docs/product/workflows.md`
- uusi moduuli -> lisää tai päivitä dokumentti `docs/modules/`-kansioon

Jos dokumentaatiota ei päivitetä, projekti alkaa vähitellen erkaantua omista säännöistään.

## AI ei saa kiertää arkkitehtuuria

AI ei saa tehdä pikaratkaisuja, jotka rikkovat projektin kerrosmallia.

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

## Suunnittelun ja koodauksen ero

Kaikki suunnittelu ei johda heti koodiin.

Projektissa voidaan ensin kirjoittaa:

- päätöksiä
- moduulirajoja
- sanastoa
- työnkulkuja
- avoimia kysymyksiä
- vaihtoehtojen vertailuja

Koodia kirjoitetaan vasta, kun tavoite ja oikea kerros ovat riittävän selvät.

Erityisesti projektin alkuvaiheessa suunnittelu on tärkeämpää kuin nopea koodin määrä.

## Moduulikohtainen työskentely

Kun työ koskee tiettyä moduulia, AI:n pitää tarkistaa:

- mitä moduuli omistaa
- mitä moduuli ei omista
- mihin muihin moduuleihin se saa viitata
- mitä rajapintoja sen pitää käyttää
- onko moduulilla oma dokumentti `docs/modules/`
- onko moduulin koodikansiossa oma `AGENTS.md`

Esimerkki:

Jos työ koskee laskutusta, lue vähintään:

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/product/glossary.md`
- `docs/product/workflows.md`
- `docs/modules/invoicing.md`

Jos työ koskee asiakkaita, lue vähintään:

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/product/glossary.md`
- `docs/modules/customers.md`

## Kerroskohtainen työskentely

AI:n pitää tunnistaa, mihin kerrokseen työ kuuluu.

Yleinen sääntö:

~~~text
liiketoimintasääntö -> domain
syötteen validointi -> validation
frontendin API-kutsu -> api-client
Firebase Auth -> auth tai infrastructure
käyttöoikeussääntö -> permissions tai authorization
uudelleenkäytettävä UI -> ui
sivukohtainen toiminto -> web feature
backendin käyttötapaus -> service
tietokantakoodi -> repository
~~~

Jos muutos osuu moneen kerrokseen, se kannattaa jakaa vaiheisiin.

Esimerkki hyvästä vaiheistuksesta:

1. domain-tyypit
2. validointiskeema
3. backend service
4. repository
5. api-client
6. frontend hook
7. UI-komponentti
8. testit

Kaikkea ei tarvitse tehdä yhdellä kertaa.

## Testaaminen AI-työssä

AI:n pitää ehdottaa testejä, kun muutos koskee:

- domain-logiikkaa
- laskutusta
- rahasummia
- käyttöoikeuksia
- tilasiirtymiä
- validointia
- tietomallin muunnoksia
- integraatioita
- kriittisiä työnkulkuja

Jos testiä ei tehdä, syy pitää pystyä perustelemaan.

Tarkemmat testausperiaatteet määritellään tiedostossa:

- `docs/ai/testing-rules.md`

## Riippuvuuksien lisääminen

AI ei saa lisätä uutta kirjastoa vain siksi, että se nopeuttaa yhtä pientä tehtävää.

Ennen uuden riippuvuuden lisäämistä pitää tarkistaa:

- onko kirjasto oikeasti tarpeellinen
- voiko ongelman ratkaista olemassa olevilla työkaluilla
- kuuluuko ongelma Eky-projektin omaan domainiin
- voidaanko kirjasto eristää oman kerroksen taakse
- mikä lisenssi kirjastolla on
- kuinka aktiivisesti sitä ylläpidetään
- paljonko transitiivisia riippuvuuksia se tuo

Tarkemmat säännöt ovat tiedostossa:

- `docs/architecture/dependency-policy.md`

## Kielen käyttö AI-työssä

Dokumentaatio, suunnittelu ja liiketoimintakeskustelu voidaan kirjoittaa suomeksi.

Koodi kirjoitetaan englanniksi.

Jos AI ei tiedä oikeaa englanninkielistä kooditermiä, sen pitää tarkistaa `docs/product/glossary.md`.

Vältä finglishiä.

Esimerkiksi:

- hyvä: `Customer`
- huono: `Asiakas`
- hyvä: `InvoiceDraft`
- huono: `LaskuDraft`
- hyvä: `WorkEntry`
- huono: `TuntiKirjaus`

## Git on tekoälyn turvaverkko

Tekoälyn nopeus vaatii tiukkaa versionhallintakuria ihmiseltä.

Tee Git-commit aina ennen kuin annat AI:lle luvan tehdä laajoja muutoksia, refaktorointia tai useaan tiedostoon osuvia muutoksia.

Kun AI saa yhden pienen palasen valmiiksi ja olet tarkistanut sen, tee uusi commit.

Esimerkkejä hyvistä commiteista:

~~~text
docs(ai): add AI workflow rules
feat(validation): add customer schema
feat(domain): add invoice status model
test(domain): add invoice total calculation tests
refactor(api): isolate customer API client
~~~

Jos AI:n tuottama koodi menee solmuun, poistaa tärkeitä rivejä tai rikkoo arkkitehtuuria, palaa viimeisimpään toimivaan commitiin sen sijaan, että korjaisit suuren sotkun käsin.

Älä anna AI:n tehdä suuria muutoksia likaisen työpuun päälle.

Tarkista ennen laajaa AI-muutosta:

~~~text
git status
~~~

Jos työpuussa on tärkeitä keskeneräisiä muutoksia, commit tai stashaa ne ennen AI:n seuraavaa isoa muutosta.

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
- uudet riippuvuudet on perusteltu tai niitä ei ole
- kriittiset testit on lisätty tai perustellusti jätetty lisäämättä
- dokumentaatio on päivitetty tarvittaessa
- koodi on luettavaa
- tiedostoilla on selkeä vastuu
- TypeScript-tyyliä noudatetaan
- muutokset ovat riittävän pieniä arvioitavaksi

## Hyvä AI-pyyntö

Hyvä pyyntö AI:lle sisältää:

- tavoitteen
- kohdemoduulin
- kerroksen
- mitä dokumentteja pitää lukea
- mitä saa muuttaa
- mitä ei saa muuttaa
- hyväksymiskriteerit

Esimerkki:

~~~text
Lue AGENTS.md, docs/architecture/module-boundaries.md ja docs/modules/customers.md.

Luo alustava customer-domainin tyyppirakenne packages/domain-kansioon.

Älä lisää UI-koodia.
Älä lisää tietokantakoodia.
Älä lisää uusia riippuvuuksia.
Käytä englanninkielisiä kooditermejä.
Pidä tiedostot pieninä.
~~~

## Huono AI-pyyntö

Huono pyyntö on liian laaja tai epäselvä.

Esimerkkejä:

~~~text
Tee asiakashallinta.
Tee laskutus.
Rakenna backend.
Korjaa tämä paremmaksi.
Tee tästä siisti.
Lisää tarvittavat kirjastot.
~~~

Tällaiset pyynnöt johtavat helposti arkkitehtuurin rikkoutumiseen.

## Lopuksi

AI:n tehtävä tässä projektissa on nopeuttaa työtä, ei ohittaa suunnittelua.

Jos AI on epävarma, sen pitää pysähtyä.

Jos tehtävä on liian iso, se pitää pilkkoa.

Jos sääntö puuttuu, se pitää dokumentoida.

Jos muutos rikkoo arkkitehtuuria, sitä ei tehdä ilman erillistä päätöstä.