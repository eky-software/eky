# Web customer UI plan

Tämä dokumentti kuvaa ensimmäisen minimaalisen web customer UI -palan.

Tämä ei ole koko frontend-sovelluksen, asiakashallinnan tai design systemin suunnitelma. Tarkoitus on rajata pieni toteutusaskel ennen React- ja Vite-riippuvuuksien lisäämistä.

## Tavoite

Ensimmäisen web customer UI -palan tavoite on todistaa koko ketju:

```text
React UI
  -> packages/api-client
    -> backend HTTP API
      -> customer application/domain
        -> SQLite
```

Tämä on ensimmäinen selainkäyttöliittymän kautta kulkeva päästä päähän -polku.

Tässä vaiheessa React UI on Eky Local UI eli paikallisen ohjelman käyttöliittymä paikalliselle backendille. Selaimessa pyöriminen ei tarkoita, että kyseessä on ensisijaisesti pilvisovellus.

Tavoitteena ei ole rakentaa valmista asiakaskortistoa, vaan todistaa että web voi käyttää backendin customer-slicea hallitun api-client-kerroksen kautta.

## Rajaus

Ensimmäinen web-pala sisältää vain:

- asiakaslistan näyttämisen
- asiakkaan lisäämisen yhdellä `name`-kentällä
- yksinkertaisen loading-tilan
- yksinkertaisen error-tilan
- `packages/api-client`-paketin käyttämisen backend-kutsuihin

Ensimmäinen web-pala ei sisällä:

- täydellistä asiakaskorttia
- asiakkaan muokkausta
- asiakkaan poistamista
- hakua
- suodatusta
- paginointia
- yhteyshenkilöitä
- useita osoitteita
- laskutusta
- authia
- Firebasea
- syncia
- mobiili-UI:ta
- raportointia

## Riippuvuuslinja

React ja Vite lisätään myöhemmässä toteutusvaiheessa vain `apps/web`-pakettiin.

Reactia tai Viteä ei lisätä:

- root `package.json` -tiedostoon
- `packages/*`-paketteihin
- `apps/backend`-pakettiin

Ensimmäisessä web-palassa ei lisätä:

- TanStack Queryä
- React Hook Formia
- UI-kirjastoa
- Zodia
- routing-kirjastoa
- Firebasea
- design system -riippuvuutta

`packages/ui`-pakettia ei oteta käyttöön vielä, ellei sille synny konkreettista tarvetta.

Lomake toteutetaan aluksi yksinkertaisella React state -mallilla.

Omaa form-helperiä ei luoda vielä. Jos sama lomake- tai validointikaava alkaa toistua useassa näkymässä, arvioidaan ensin pieni paikallinen helper ja vasta myöhemmin sisäinen Eky-paketti tai ulkoinen kirjasto.

## Alustava rakenne

Ensimmäinen rakenne voidaan pitää pienenä:

```text
apps/web/src/
  main.tsx
  App.tsx
  customers/
    CustomerPage.tsx
```

Rakenne voi tarkentua toteutuksessa, mutta ensimmäisessä palassa vältetään liian aikaista frontend-arkkitehtuurin paisuttamista.

## API-client-sääntö

Web UI käyttää backend API:a `packages/api-client`-paketin kautta.

React-komponentit eivät saa tehdä raakaa `fetch`-kutsua customer-endpointteihin.

React-komponentit eivät saa tuntea backendin sisäistä rakennetta, kuten:

- Hono-routeja toteutustasolla
- application service -tiedostoja
- repository-portteja
- SQLite-adapteria
- tietokantatauluja

Komponenttien pitää kutsua esimerkiksi:

```text
apiClient.listCustomers()
apiClient.createCustomer(...)
```

## Webin vastuut

Web UI:n vastuu:

- näyttää asiakkaat
- kerätä käyttäjän syöte
- kutsua api-clientiä
- näyttää loading- ja virhetilat
- näyttää onnistuneen luonnin jälkeen päivitetty lista tai lisätä luotu asiakas näkymään

Web UI ei omista:

- customer-domain-sääntöjä
- lopullista validointia
- käyttöoikeuspäätöksiä
- yritysrajausta
- tietokantakirjoituksia
- backend-reittien sisäistä toteutusta

Domain-säännöt pysyvät backend/domain-kerroksessa.

Backend tekee lopulliset tarkistukset.

## Local dev

Ensimmäisessä local dev -mallissa webin pitää pystyä käyttämään paikallista backendia, esimerkiksi:

```text
http://127.0.0.1:3000
```

`baseUrl` voidaan ensimmäisessä toteutuksessa antaa pienestä web-configista tai turvallisesta local dev -oletuksesta.

Lopullinen web-config-malli päätetään erikseen, kun ympäristöjä on enemmän kuin paikallinen kehitys.

Web ei saa koskaan kirjoittaa suoraan SQLiteen.

Web ei saa importata backendin sisäisiä moduuleja.

UI:n visuaalinen ja käytettävyydellinen peruslinja on kuvattu dokumentissa `docs/design/ui-principles.md`.

## Virheiden näyttäminen

Ensimmäisessä palassa virheet voidaan näyttää yksinkertaisena tekstinä.

Ei tehdä vielä:

- globaalia toast-järjestelmää
- lomakekirjastoa
- virhekoodikartastoa
- i18n-rakennetta
- design systemin virhekomponentteja

Kun virhemalli alkaa toistua, se arvioidaan omana pienenä parannuksena.

## Mitä ei tehdä vielä

Ensimmäisessä web customer UI -palassa ei tehdä:

- koko frontend-arkkitehtuuria
- reititystä
- kirjautumista
- käyttäjärooleja
- permission UI -mallia
- Firebase Authia
- pilvibackend-yhteyttä
- sync-logiikkaa
- laskutusnäkymiä
- mobiilinäkymää
- `packages/ui`-komponenttikirjastoa
- omaa design systemiä
- omaa form-helperiä
- ulkoista lomakekirjastoa
- ulkoista data fetching -kirjastoa

## Hyväksymiskriteerit tulevalle toteutukselle

Ensimmäinen web customer UI -toteutus on valmis vasta, kun:

- `apps/web` käynnistyy paikallisesti
- asiakaslista haetaan `packages/api-client`-paketin kautta
- asiakas luodaan `packages/api-client`-paketin kautta
- React-komponentit eivät tee raw `fetch` -kutsuja customer-endpointteihin
- React ja Vite on lisätty vain `apps/web`-pakettiin
- uusia web-riippuvuuksia ei lisätä ilman hyväksyntää
- `pnpm typecheck` menee läpi
- `pnpm test` menee läpi
- backend build menee läpi
- `packages/utils`-kansiota ei synny
- web ei importtaa backendin sisäisiä moduuleja

## Liittyvät dokumentit

- `AGENTS.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/customer-vertical-slice-plan.md`
- `docs/design/ui-principles.md`
- `docs/modules/customers.md`
- `packages/api-client/README.md`
