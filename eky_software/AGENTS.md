# Eky-projektin AI-ohjeet

Tämä tiedosto on pakollinen lähtökohta kaikelle AI-avusteiselle työlle tässä repositoriossa.

Lue tämä tiedosto aina ennen kuin teet muutoksia projektiin.

Eky-projektissa tekoäly ei saa arvata arkkitehtuuria, liiketoimintasääntöjä tai moduulien vastuita. Jos jokin asia on epäselvä, työ rajataan pienemmäksi tai kysytään lisäohje.

## Projektin tavoite

Eky on modulaarinen ERP-tyylinen ohjelmisto rakennusalan yrityksen käyttöön.

Ensimmäinen käytännön tavoite on web-pohjainen asiakaskortisto ja laskutusmoduuli. Myöhemmin järjestelmään voidaan lisätä esimerkiksi työmääräykset, tuntikirjaukset, materiaalikirjaukset, mobiilisovellus työntekijöille, raportointi, integraatiot, varastonhallinta ja AI-agenttien ohjaama automaatio.

Projektia ei rakenneta yksittäiseksi laskutusohjelmaksi, vaan pitkäikäiseksi ja laajennettavaksi Eky Base -järjestelmäksi.

## Työskentelymalli

Projektissa ihminen toimii ratkaisuarkkitehtina ja päätöksentekijänä.

AI-avustajat voivat auttaa suunnittelussa, arkkitehtuurin arvioinnissa, dokumentoinnissa, koodin luonnissa, testien tekemisessä ja vaihtoehtojen vertailussa.

Codex tai muu koodausagentti toimii toteuttajana, mutta ei saa tehdä laajoja arkkitehtuuripäätöksiä itsenäisesti.

## Pakollinen lukujärjestys

Lue aina ensin tämä tiedosto.

Lue lisäksi tehtävän mukaan seuraavat dokumentit:

- AI-työtapa: `docs/ai/workflow.md`
- Koodauskäytännöt: `docs/ai/coding-rules.md`
- Testausohjeet: `docs/ai/testing-rules.md`
- Tarkistuslista: `docs/ai/review-checklist.md`
- Promptausohjeet: `docs/ai/prompt-guidelines.md`
- Perusarkkitehtuuri: `docs/architecture/base-architecture.md`
- Moduulien rajat: `docs/architecture/module-boundaries.md`
- Riippuvuuksien hallinta: `docs/architecture/dependency-policy.md`
- Teknologiapäätökset: `docs/architecture/tech-decisions.md`
- Tietomallin periaatteet: `docs/architecture/data-model-principles.md`
- Liiketoimintakonteksti: `docs/product/business-context.md`
- Sanasto: `docs/product/glossary.md`
- Käyttäjäroolit: `docs/product/user-roles.md`
- Työnkulut: `docs/product/workflows.md`

Jos työ koskee tiettyä moduulia, lue myös kyseisen moduulin dokumentti `docs/modules/`-kansiosta.

Jos kohdekansiossa on oma `AGENTS.md`, se on luettava ennen muutosten tekemistä.

## Dokumentaation roolit

`docs/product/` kertoo mitä yritys tekee ja miksi ohjelmisto rakennetaan.

`docs/architecture/` kertoo miten järjestelmä rakennetaan.

`docs/modules/` kertoo mitä kukin moduuli tekee ja mitä se omistaa.

`docs/ai/` kertoo miten AI:n kanssa työskennellään tässä projektissa.

`docs/decisions/` sisältää tärkeät arkkitehtuuripäätökset ADR-muodossa.

## Ydinperiaatteet

1. Pidä järjestelmä modulaarisena.
2. Älä sekoita liiketoimintalogiikkaa käyttöliittymään.
3. Älä lisää uusia riippuvuuksia ilman perustelua.
4. Älä luo moduulien välisiä oikopolkuja.
5. Älä tee laajoja arkkitehtuurimuutoksia ilman erillistä hyväksyntää.
6. Suosi pieniä, selkeitä ja yhden vastuun tiedostoja.
7. Päivitä dokumentaatiota, jos arkkitehtuuri, työnkulku tai liiketoimintasääntö muuttuu.
8. Pidä domain-kerros riippumattomana käyttöliittymästä, tietokannasta, Firebasesta ja ulkoisista integraatioista.
9. Käyttöliittymä ei saa kutsua suoraan tietokantaa tai Firebase-palveluita.
10. AI-agentit eivät saa tulevaisuudessakaan ohittaa samoja sääntöjä, joita käyttöliittymä noudattaa.

## Arkkitehtuurin päälinja

Projektissa käytetään modulaarista monoliittia.

Tavoitteena ei ole rakentaa mikropalveluarkkitehtuuria ensimmäisessä vaiheessa.

Järjestelmä rakennetaan kuitenkin niin, että moduuleja voidaan myöhemmin irrottaa omiksi palveluikseen, jos siihen tulee todellinen tarve.

Ensimmäisessä vaiheessa tärkeintä on selkeä rakenne, ymmärrettävä domain ja hallitut moduulirajat.

## Suunniteltu korkean tason rakenne

Projektin alustava rakenne voi olla esimerkiksi:

~~~text
apps/
  web/
  backend/

packages/
  domain/
  validation/
  api-client/
  auth/
  permissions/
  ui/
  config/
  utils/
~~~

Lopullinen rakenne tarkentuu projektin edetessä, mutta periaate on, että sovellukset ja jaetut sisäiset paketit erotetaan toisistaan.

## Kerrossäännöt

Liiketoimintasäännöt kuuluvat domain-kerrokseen.

Validointi kuuluu validation-kerrokseen.

Frontendin API-kutsut kuuluvat api-client-kerrokseen.

Firebase Auth eristetään auth- tai infrastructure-kerroksen taakse.

Käyttöoikeuslogiikka keskitetään permissions-kerrokseen.

Uudelleenkäytettävät käyttöliittymäkomponentit kuuluvat ui-kerrokseen.

React-komponentit eivät saa sisältää varsinaista liiketoimintalogiikkaa.

Backendissä handler vastaanottaa pyynnön, service ohjaa käyttötapauksen ja repository hoitaa tietokantayhteyden.

## Riippuvuuksien eristäminen

Ulkoisia kirjastoja saa käyttää, mutta niitä ei saa päästää leviämään koko järjestelmään.

Esimerkkejä:

- React kuuluu vain web-käyttöliittymään.
- TanStack Query kuuluu vain frontendin datahakuihin ja hookeihin.
- React Hook Form kuuluu vain lomakelogiikkaan.
- Firebase kuuluu vain auth- tai infrastructure-kerroksen taakse.
- Zod kuuluu validointikerrokseen.
- Domain-kerros ei saa riippua näistä kirjastoista.

Jos kirjasto joudutaan joskus vaihtamaan, muutoksen pitää osua rajattuun kerrokseen, ei koko järjestelmään.

## Moduulien välinen toiminta

Moduuli saa omistaa oman datansa ja omat sääntönsä.

Toinen moduuli ei saa muuttaa suoraan toisen moduulin sisäistä dataa tai ohittaa sen palvelurajapintaa.

Esimerkiksi laskutusmoduuli ei saa muuttaa asiakasmoduulin dataa suoraan.

Moduulien välinen kommunikaatio tehdään selkeiden rajapintojen, palveluiden, DTO-rakenteiden tai myöhemmin tapahtumien kautta.

## Domain-kerroksen säännöt

Domain-kerros sisältää puhtaat liiketoimintasäännöt, tyypit, laskennat ja tilasiirtymät.

Domain-kerros ei saa sisältää:

- React-koodia
- Firebase-koodia
- HTTP-kutsuja
- tietokantakoodia
- selainriippuvuuksia
- käyttöliittymäkomponentteja
- ulkoisten palveluiden kutsuja

Domain-kerroksen pitää olla helposti testattava.

## Backendin säännöt

Backendissä käytetään selkeää vastuunjakoa.

Handler:

- vastaanottaa pyynnön
- tarkistaa perustiedot
- kutsuu service-kerrosta
- palauttaa vastauksen

Service:

- ohjaa käyttötapauksen
- käyttää domain-sääntöjä
- kutsuu repository-kerrosta
- huolehtii liiketoimintaprosessin etenemisestä

Repository:

- hoitaa tietokantayhteyden
- lukee ja kirjoittaa dataa
- ei sisällä varsinaisia liiketoimintasääntöjä

## Frontendin säännöt

Frontend näyttää dataa ja tarjoaa käyttäjälle toimintoja.

Frontend ei omista liiketoimintalogiikkaa.

React-komponentti ei saa kutsua suoraan tietokantaa, Firebasea tai raakaa `fetch`-kutsua, jos API-client-kerros on olemassa.

Frontend saa käyttää feature-kohtaisia hookeja, api-clientiä, validation-skeemoja ja ui-komponentteja.

## Tietomallin periaatteet

PostgreSQL on suunniteltu ERP-liiketoimintadatan ensisijaiseksi tietokannaksi.

Tietomallissa varaudutaan siihen, että järjestelmä voi myöhemmin palvella useampaa yritystä.

Keskeisissä liiketoimintaolioissa huomioidaan yleensä:

~~~text
companyId
createdAt
updatedAt
createdBy
status
~~~

Audit trail ja historiatieto huomioidaan alusta asti kriittisissä liiketoimintatoiminnoissa.

## Käyttöoikeudet

Frontendin käyttöoikeustarkistukset ovat käyttökokemusta varten.

Backendin käyttöoikeustarkistukset ovat turvallisuutta varten.

Käyttöoikeuslogiikkaa ei saa ripotella satunnaisesti ympäri sovellusta.

Käyttöoikeudet keskitetään selkeään permissions- tai authorization-kerrokseen.

## Laskutuksen periaatteet

Lasku on liiketoimintadokumentti, ei tavallinen lomakedata.

Laskuluonnosta voidaan muokata.

Hyväksyttyä, lähetettyä tai maksettua laskua ei saa kohdella tavallisena vapaasti muokattavana tietueena.

Laskutuksessa käytetään selkeitä tiloja, esimerkiksi:

~~~text
draft
approved
sent
paid
cancelled
~~~

Tuntikirjaukset ja materiaalikirjaukset eivät saa siirtyä suoraan lopulliseen laskuun ilman hallittua hyväksyntä- tai laskuluonnosvaihetta.

## AI-agenttien tuleva yhteensopivuus

Järjestelmä suunnitellaan niin, että tulevat AI-agentit voivat käyttää samoja backend-palveluita kuin käyttöliittymä.

AI-agentit eivät saa ohittaa domain-sääntöjä, käyttöoikeuksia tai audit trailia.

AI-agentit eivät saa kirjoittaa suoraan tietokantaan.

AI-agenttien toiminta pitää olla jäljitettävää.

## TypeScript-tyyli

Kirjoita TypeScript-koodi seuraavilla periaatteilla:

- 2 välilyönnin sisennys
- puolipisteet
- camelCase muuttujille ja funktioille
- PascalCase tyypeille, luokille ja React-komponenteille
- selkeät tyypitykset
- ei käyttämättömiä muuttujia
- ei turhaa `any`-tyyppiä
- pienet tiedostot
- yksi selkeä vastuu per tiedosto
- luettava koodi ennen liian nokkelaa koodia

Koodin tulee noudattaa ESLintin `eslint:recommended`-henkistä tyyliä, vaikka tarkka konfiguraatio päätetään myöhemmin.

## Koodin kieli

Kaikki koodi kirjoitetaan englanniksi.

Tämä koskee esimerkiksi:

- muuttujia
- funktioita
- luokkia
- tyyppejä
- rajapintoja
- tiedostonimiä
- kansioita
- tietokantatauluja
- tietokantakenttiä
- API-reittejä

Dokumentaatio, suunnittelu ja liiketoiminnan kuvaukset voidaan kirjoittaa suomeksi.

Koodissa käytetään englanninkielisiä termejä, esimerkiksi:

- `Customer`, ei `Asiakas`
- `Site`, ei `Kohde`
- `Invoice`, ei `Lasku`
- `InvoiceDraft`, ei `Laskuluonnos`
- `WorkEntry`, ei `Tuntikirjaus`
- `MaterialEntry`, ei `Materiaalikirjaus`

Käytä `docs/product/glossary.md`-sanastoa oikeiden termien varmistamiseen.

Älä sekoita suomea ja englantia samaan kooditermiin. Vältä esimerkiksi nimiä kuten `createLaskuDraft`, `asiakasService` tai `invoiceRivi`.

## Tiedostojen vastuu

Jokaisella tiedostolla pitää olla yksi selkeä vastuu.

Hyviä tiedostonimiä:

~~~text
calculateInvoiceTotal.ts
createCustomer.ts
customerSchema.ts
customersApi.ts
useCustomers.ts
CustomerForm.tsx
canEditInvoice.ts
~~~

Vältettäviä tiedostonimiä:

~~~text
helpers.ts
utils.ts
everything.ts
customerAndInvoiceStuff.ts
firebaseEverything.ts
~~~

Yleisiä `utils.ts`- tai `helpers.ts`-tiedostoja ei saa luoda ilman erityistä syytä.

## Uudet riippuvuudet

Uutta kolmannen osapuolen kirjastoa ei saa lisätä ilman perustelua.

Ennen uuden riippuvuuden lisäämistä vastaa:

1. Mitä ongelmaa kirjasto ratkaisee?
2. Onko ongelma infrastruktuuria vai Eky-projektin omaa liiketoimintalogiikkaa?
3. Voidaanko riippuvuus eristää oman Eky-kerroksen taakse?
4. Onko kirjasto aktiivisesti ylläpidetty?
5. Mikä lisenssi kirjastolla on?
6. Kuinka paljon transitiivisia riippuvuuksia se tuo?
7. Mitä tapahtuu, jos kirjasto pitää myöhemmin vaihtaa?

Jos vastausta ei ole, älä lisää riippuvuutta.

## Kun olet epävarma

Käytä tätä sääntöä:

~~~text
liiketoimintasääntö -> packages/domain
syötteen validointi -> packages/validation
frontendin API-kutsu -> packages/api-client
Firebase Auth -> packages/auth
uudelleenkäytettävä UI -> packages/ui
käyttöoikeussääntö -> packages/permissions
sivukohtainen web-ominaisuus -> apps/web/src/features
tietokantakoodi -> backend repository
käyttötapauksen ohjaus -> backend service
~~~

Älä ratkaise epävarmuutta luomalla yleistä `utils.ts`-, `helpers.ts`- tai `everything.ts`-tiedostoa.

## Ennen työn aloittamista

Ennen muutosten tekemistä:

0. Anna arkkitehdille lyhyt toteutussuunnitelma ennen koodin kirjoittamista.

Suunnitelmassa kerro:

- mitkä dokumentit luet tai olet lukenut kontekstiksi
- mitä tiedostoja aiot luoda tai muokata
- mihin arkkitehtuurin kerroksiin muutos osuu
- mitä moduulia muutos koskee
- syntyykö uusia riippuvuuksia
- tarvitaanko testejä
- onko jokin asia epäselvä

Odota hyväksyntää ennen varsinaista koodimuutosta, jos tehtävä on laaja, koskee arkkitehtuuria, lisää uuden moduulin, lisää uuden riippuvuuden tai muuttaa olemassa olevaa liiketoimintasääntöä.

Pienissä rajatuissa muutoksissa voit edetä ilman erillistä hyväksyntää, jos tehtävä on yksiselitteinen ja noudattaa olemassa olevia ohjeita.

1. Lue tämä tiedosto.
2. Lue tehtävään liittyvät dokumentit `docs/`-kansiosta.
3. Tarkista, onko kohdekansiossa oma `AGENTS.md`.
4. Tunnista oikea kerros ja moduuli.
5. Rajaa muutos mahdollisimman pieneksi.
6. Älä lisää riippuvuuksia ilman hyväksyntää.
7. Älä muuta arkkitehtuuria ilman hyväksyntää.

## Ennen kuin ilmoitat työn valmiiksi

Tarkista:

1. Noudattaako muutos moduulirajoja?
2. Vuotaako jokin riippuvuus väärään kerrokseen?
3. Onko liiketoimintalogiikka oikeassa paikassa?
4. Onko tiedostoilla selkeä vastuu?
5. Tarvitaanko testi?
6. Tarvitaanko dokumentaatiopäivitys?
7. Syntyikö uusi riippuvuus?
8. Muuttuiko jokin arkkitehtuuripäätös?
9. Onko muutos ymmärrettävä myös seuraavalle kehittäjälle?
10. Onko muutos linjassa Eky Base -ajatuksen kanssa?

Jos muutos rikkoo projektin periaatteita, älä tee sitä ilman erillistä hyväksyntää.