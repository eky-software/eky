# UI principles

Tämä dokumentti kuvaa Eky-ohjelman ensimmäiset käyttöliittymäperiaatteet.

Tarkoitus on ohjata nykyisen React-käyttöliittymän jatkokehitystä ennen kuin siitä tehdään ERP-työpöytämäisempi.

## Eky Local ensin, Cloud myöhemmin

Ensimmäinen käyttöliittymä on Eky Local UI.

Se tarkoittaa:

```text
Eky Local UI
  -> local backend
    -> SQLite
```

Nykyinen React UI toimii tässä vaiheessa ensisijaisesti paikallisen ohjelman käyttöliittymänä paikalliselle backendille ja paikalliselle SQLite-tietokannalle.

Se, että käyttöliittymä toimii selaimessa, ei tarkoita, että kyseessä on ensisijaisesti pilvisovellus.

Sama tai läheinen UI voidaan myöhemmin ajaa myös pilvessä:

```text
Eky Cloud UI
  -> cloud backend
    -> PostgreSQL
```

Cloud web on myöhempi ajotapa, ei nykyisen local-first-mallin korvaaja.

## Eky On Työohjelma

Eky ei ole landing page tai markkinointisivu.

Eky UI:n pitää tuntua ERP-työpöydältä:

- selkeä
- rauhallinen
- luotettava
- tehokas
- datan lukemiseen sopiva
- lomake- ja taulukkotyöskentelyyn sopiva
- pitkäaikaiseen päivittäiseen käyttöön sopiva

Vältetään:

- isoja hero-alueita
- koristeellisia efektejä
- liiallista pyöreyttä
- liiallisia varjoja
- liian väljää landing page -asettelua
- markkinointisivumaista visuaalista kieltä

## Käyttöliittymän Kieli

Eky-käyttöliittymän ensisijainen kieli on suomi.

Ensimmäinen paikallinen versio rakennetaan suomenkieliseksi, koska ohjelman ensimmäinen käyttökohde on suomalainen rakennusalan yritys.

UI-koodin nimet, komponentit, funktiot, muuttujat ja tiedostonimet pidetään englanniksi projektin koodikielisäännön mukaisesti.

Käyttäjälle näkyvät tekstit ovat suomeksi.

Käyttäjälle näkyviä tekstejä ei pidä hajottaa satunnaisesti komponenttien sisään, jos teksti alkaa toistua tai liittyy laajempaan näkymään.

Ensimmäisessä vaiheessa voidaan käyttää `apps/web`-sovelluksen sisäistä kevyttä tekstikarttaa, esimerkiksi:

```text
apps/web/src/i18n/
  fi.ts
```

Tämä ei ole vielä varsinainen monikielisyysjärjestelmä.

Tavoite on kuitenkin pitää rakenne sellaisena, että myöhemmin voidaan lisätä esimerkiksi englanti tai ruotsi ilman että koko UI pitää kirjoittaa uudelleen.

Ulkoinen i18n-kirjasto lisätään vain erillisellä päätöksellä, jos oma kevyt tekstimalli ei enää riitä.

Backendin tai API-clientin teknisiä virheitä ei näytetä käyttäjälle englanniksi, jos ne tunnetaan ja voidaan kääntää UI-rajalla.

Myöhemmin virheille voidaan lisätä kieliriippumattomat virhekoodit, jolloin UI valitsee näkyvän tekstin käyttäjän kielen mukaan.

## Visuaalinen Peruslinja

Eky-tyylin alustava päälinja:

- sinivalkoinen päälinja
- vaalea siniharmaa tausta
- valkoiset työalueet
- tumma sinimusta teksti
- hillitty sininen päätoimintoväri
- musta tai hyvin tumma väri korostuksiin
- selkeät rajat
- maltillinen border radius
- maltilliset varjot vain tarvittaessa
- hyvä kontrasti ja luettavuus

Käyttöliittymän pitää näyttää modernilta työkalulta, ei koristeelliselta sivustolta.

## Layout-Periaate

Ensimmäinen ERP-työpöytämäinen rakenne voidaan rakentaa web-sovelluksen sisään:

```text
apps/web/src/
  app/
    App.tsx

  features/
    customers/
    companySettings/

  shared/
    money/

  layout/
    AppLayout.tsx
    Sidebar.tsx
    TopBar.tsx

  i18n/
```

Webin suuret toiminnalliset näkymät sijoitetaan `features/`-kansion alle.

Pienet ja aidosti useamman featuren käyttämät apukokonaisuudet voidaan sijoittaa `shared/`-kansion alle. `shared/` ei saa muuttua yleiseksi utils-, common- tai helpers-kaatopaikaksi.

Tarkempi web-kansiorakenne on kuvattu dokumentissa `docs/architecture/web-frontend-structure.md`.

Sovelluksen kokoava `app/`-kerros käyttää featureiden julkisia entrypointteja,
kuten `features/customers/CustomerPage.ts`,
`features/companySettings/CompanySettingsPage.ts` ja
`features/invoicing/InvoicingPage.ts`. Se ei importtaa suoraan featureiden
sisäisiä `components/`, `hooks/`, `form/`, `drafts/`, `preview/` tai
`state/` -polkuja.

Kun feature kasvaa, sen sisäinen rakenne jaetaan selkeisiin vastuisiin, kuten
`components/`, `hooks/`, `form/`, `list/` tai `drafts/`, `preview/` ja
`state/`.

Komponenttien omat tyylit pidetään komponentin vieressä CSS Module -tiedostoissa.
Globaali `styles.css` sisältää vain sovelluksen yleiset
perustyylit, design tokenit ja aidosti usean näkymän yhteiset UI-primitiivit.
Se ei sisällä feature- eikä layout-komponenttien omia tyylejä.
CSS Module sijoitetaan omistavan komponentin viereen. Se saa olla
feature-kansion juuressa vain silloin, kun myös omistava komponentti on siellä.

Komponentin responsiiviset tyylit ja liikeasetukset kuuluvat samaan CSS
Moduleen komponentin muiden tyylien kanssa. Featuret eivät importtaa toistensa
CSS Moduleita, eikä yleisiä `common.css`- tai `utils.css`-tiedostoja luoda.
Tarkka CSS-omistajuusportti on dokumentissa
`docs/architecture/web-frontend-structure.md`.

Layout-ajatus:

- `TopBar` näyttää sovelluksen nimen, tilan ja myöhemmin local/cloud-statuksen
- `Sidebar` sisältää moduulinavigaation
- `Sidebar` voidaan jakaa selkeisiin osioihin, kuten Päätoiminnot ja Yritys
- `Sidebar` voidaan supistaa kapeaksi reunapalkiksi, jotta tietotiheille työpinnoille jää enemmän vaakasuuntaista tilaa
- sivupalkin avaamiseen ja sulkemiseen käytetään desktopissa koko
  näkymän korkuista, aina saavutettavaa reunakaistaa; mobiilissa ohjain pysyy
  kompaktina yläkulmapainikkeena
- navigaation sisältö ja moduulirajat eivät muutu sivupalkin tilan mukana
- `Main area` sisältää aktiivisen työalueen
- Asiakkaat on ensimmäinen aktiivinen moduuli
- Oma yritys kuuluu sivupalkin Yritys-osioon
- Laskutus, työmääräykset ja muut moduulit voivat näkyä myöhemmin passiivisina tai tulevina osioina

Työaluekortteja käytetään oikeisiin työpintoihin, ei koristeeksi.

## Desktop Ensin

Eky on ensin työpöytäkäyttöön suunnattu ERP-työkalu.

Desktop-käyttö ohjaa ensimmäistä UI-rakennetta.

Responsiivisuus huomioidaan, mutta mobiili ei ohjaa ensimmäistä web-UI-ratkaisua.

Mobiili voi myöhemmin olla oma käyttöliittymänsä tai erillinen sovellus, joka käyttää samaa backend/API-ajattelua.

## UI-Riippuvuuslinja

Ensimmäisessä vaiheessa käytetään `apps/web`-sovelluksen omaa CSS:ää ja tarvittaessa design token -tyyppisiä CSS-muuttujia.

Ei lisätä vielä:

- UI-kirjastoa
- Tailwindia
- shadcnia
- Material UI:ta
- Bootstrapia
- React Hook Formia
- TanStack Queryä
- Zodia
- ulkoista i18n-kirjastoa
- `packages/ui`-pakettia
- design system -pakettia

UI-riippuvuuksia voidaan arvioida myöhemmin uudelleen, jos oma CSS ja omat komponentit alkavat hidastaa kehitystä tai heikentää laatua.

Mahdollinen UI-kirjasto saa koskea vain web-UI-kerrosta. Se ei saa levitä domainiin, api-clientiin, backendiin tai tietokantakerroksiin.

## Komponenttien Kasvupolku

Aluksi komponentit pidetään `apps/web`-sovelluksen sisällä ja feature-kohtaiset komponentit oman `features/<featureName>`-kansionsa alla.

Komponentteja ei nosteta `packages/ui`-pakettiin varmuuden vuoksi.

Jos sama komponenttityyppi alkaa toistua 2-3 eri näkymässä, voidaan harkita `packages/ui`-pakettia.

Mahdollisia myöhempiä jaettavia komponentteja:

- Button
- Input
- Panel
- Table
- PageHeader
- EmptyState

`packages/ui` luodaan vasta todelliseen toistuvaan tarpeeseen.

Ei luoda yleistä `utils`- tai `helpers`-pakettia.

## Lomakkeet Ja Validointi

Ensimmäisessä customer UI -palassa yksinkertainen React state riittää.

React Hook Formia ei lisätä vielä.

Zodia ei lisätä vielä.

Yksinkertainen käyttöliittymävalidointi voi olla paikallista UI-koodia.

Backend tekee lopullisen validoinnin ja domain-sääntöjen tarkistuksen.

Jos sama lomake- tai validointikaava alkaa toistua useassa näkymässä, arvioidaan ensin pieni paikallinen helper ja vasta myöhemmin sisäinen Eky-paketti tai ulkoinen kirjasto.

## API-Yhteys

React-komponentit eivät tee raakaa `fetch`-kutsua.

Web käyttää `packages/api-client`-pakettia.

Web ei tunne backendin sisäisiä moduuleja.

Web ei kirjoita suoraan SQLiteen.

Web ei sisällä varsinaista liiketoimintalogiikkaa.

## Nykyinen Kasvupolku

Webin yleinen ERP-työpöytärakenne on toteutettu `AppLayout`-, `TopBar`- ja
`Sidebar`-komponenteilla.

Uudet toiminnalliset näkymät rakennetaan feature-kohtaisesti dokumentin
`docs/architecture/web-frontend-structure.md` mukaisesti. Kukin feature
vastaa omasta työpinnastaan, paikallisista komponenteistaan ja
käyttöliittymätilastaan.

Laskutuksen Classic-työpinnan vaiheistus on kuvattu dokumentissa
`docs/architecture/invoicing-ui-roadmap.md`.

Classic-näkymissä tavoitellaan vanhojen taloushallinto-ohjelmien
käytännöllisyyttä, tietotiheyttä ja ennakoitavaa työjärjestystä ilman niiden
brändin tai ulkoasun kopiointia. Eky säilyttää oman modernin, sinivalkoisen ja
rauhallisen visuaalisen linjansa.

Tässä vaiheessa ei tehdä `packages/ui`-pakettia eikä oteta käyttöön
UI-kirjastoa ilman todellista toistuvaa tarvetta ja erillistä päätöstä.
