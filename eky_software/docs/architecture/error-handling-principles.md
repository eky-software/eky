# Virheenkäsittelyn periaatteet

Tämä dokumentti määrittelee, miten virheet kulkevat Eky-järjestelmän
kerrosten läpi turvallisesti, ymmärrettävästi ja modulaarisesti.

Tavoitteena ei ole keskittää kaikkia virheitä yhteen suureen
error-manageriin. Jokainen kerros käsittelee vain oman vastuunsa:

```text
Domain / Application
  -> HTTP adapter
    -> API-client
      -> Web UI
```

Virhettä ei saa piilottaa, mutta sisäistä teknistä tietoa ei saa vuotaa
käyttäjälle.

## Perusperiaate

Virhe käsitellään siinä kerroksessa, joka tuntee sen merkityksen:

- domain ja application tunnistavat liiketoiminta- ja käyttötapausvirheet
- HTTP-adapteri muuntaa tunnetut virheet turvallisiksi HTTP-vastauksiksi
- API-client muuntaa HTTP-virheet hallittuun client-virhemuotoon
- web UI päättää virheen esitystavan ja käyttäjälle näkyvän kielen

Kerros ei saa ottaa vastuuta toisen kerroksen tehtävästä.

Esimerkiksi:

- domain ei tunne HTTP-statuskoodeja
- HTTP-reitti ei päätä laskennan liiketoimintasääntöjä
- API-client ei päätä käyttöoikeuksista
- web UI ei päätä, saako käyttäjä suorittaa toiminnon

## Tunnetut ja odottamattomat virheet

Tunnettu virhe on odotettu osa käyttötapausta, esimerkiksi:

- virheellinen syöte
- resurssia ei löydy
- uniikki arvo on jo käytössä
- käyttäjällä ei ole oikeutta toimintoon
- ulkoinen palvelu ei ole tilapäisesti käytettävissä

Odottamaton virhe on tekninen tai ohjelmointivirhe, jota käyttötapaus ei ole
tarkoittanut normaaliksi lopputulokseksi.

Tunnetut virheet muunnetaan hallitusti. Odottamatonta virhettä ei saa
naamioida onnistumiseksi eikä sen teknisiä yksityiskohtia saa palauttaa
käyttäjälle.

## Alustava virhejaottelu

Ekyssä voidaan käyttää seuraavia yleisiä virhekategorioita:

- `validation_error`
- `not_found`
- `conflict`
- `forbidden`
- `unauthorized`
- `external_service_error`
- `internal_error`

Tämä on yhteinen sanasto, ei vielä pakollinen keskitetty tyyppipaketti.

Moduulit saavat omistaa omat tarkat domain- ja application-virheensä.
Virhekategorioiden tarkoitus on helpottaa myöhempää HTTP-sopimusta,
API-clientiä ja lokalisoitua UI-esitystä.

Uutta `packages/errors`- tai vastaavaa jaettua pakettia ei luoda ennen
erillistä päätöstä ja todellista usean paketin tarvetta.

## HTTP-statuskoodien suunta

Alustava muunnos HTTP-rajalla:

| Virhekategoria | Tyypillinen status |
| --- | --- |
| `validation_error` | 400 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `conflict` | 409 |
| `external_service_error` | 502 tai 503 |
| `internal_error` | 500 |

Status valitaan käyttötapauksen merkityksen perusteella. Taulukko ei korvaa
moduulin päätöstä eikä oikeuta paljastamaan resurssin olemassaoloa.

## Turvallisuus

Käyttäjälle tai API-kutsujalle ei palauteta:

- stack tracea
- SQL-virhettä tai SQL-lausetta
- tiedostopolkua
- salaisuutta, tokenia tai ympäristömuuttujaa
- tarpeetonta henkilötietoa
- tietokantakirjaston virheoliota
- sisäistä infrastruktuurin rakennetta
- tietoa toisen yrityksen resurssin olemassaolosta

Käyttöoikeus- ja yritysrajausvirhe ei saa kertoa, löytyikö tunniste toisen
yrityksen datasta.

Esimerkiksi yritysrajattu haku voi palauttaa saman geneerisen `404`-vastauksen
sekä puuttuvalle resurssille että toisen yrityksen resurssille.

Frontend ei ole turvallisuuden lähde. Backend tarkistaa aina:

- autentikoinnin
- käyttöoikeuden
- yritysrajauksen
- syötteen
- liiketoimintasäännöt

Nykyinen autentikoimaton local-MVP pysyy vain loopback-osoitteessa ja käyttää
synteettistä kehitysdataa dokumentin
`docs/architecture/security-principles.md` mukaisesti.

## Domain ja application

Domain- ja application-kerrokset saavat käyttää nimettyjä, tyypitettyjä
virheitä, kun virheellä on käyttötapauksessa selkeä merkitys.

Esimerkkejä nykyisestä suunnasta:

- laskennan virhe
- laskuluonnoksen validointivirhe
- laskuluonnosta ei löydy

Domain- ja application-virheet:

- eivät tunne Honoa tai HTTP-statuskoodeja
- eivät sisällä SQL- tai tietokantakirjaston tyyppejä
- eivät sisällä käyttäjälle lokalisoitua UI-tekstiä
- eivät saa paljastaa toisen yrityksen dataa
- nimetään moduulin oman vastuun mukaan

Kaikkia virheitä ei tarvitse pakottaa yhden yhteisen kantaluokan alle.
Yhteinen abstraktio lisätään vasta, jos sillä poistetaan todellista toistoa
ilman moduulirajojen hämärtymistä.

## Backendin HTTP-adapteri

HTTP-adapteri:

- lukee ja validoi requestin kuljetusmuodon
- kutsuu application serviceä
- muuntaa tunnetut virheet turvallisiksi HTTP-vastauksiksi
- päästää odottamattoman virheen hallittuun ylimmän tason käsittelyyn
- ei sisällä liiketoiminta- tai laskentalogiikkaa

Nykyinen reittikohtainen virheenkäsittely on hyväksyttävä ensimmäisessä
MVP-vaiheessa.

Yhteinen HTTP error mapper voidaan lisätä myöhemmin backendin HTTP-kerrokseen,
jos sama status- ja vastausmuunnos alkaa toistua useissa moduuleissa.

Mapper:

- ei saa tuntea tietokantaa
- ei saa muuttaa domain-sääntöjä
- ei saa muuttua yleiseksi koko järjestelmän error-manageriksi
- käsittelee vain HTTP-esitysmuodon

Tuntemattoman virheen käyttäjävastaus on geneerinen `internal_error` /
HTTP 500. Tekninen virhe voidaan kirjata myöhemmin turvalliseen
tuotantolokitukseen.

## HTTP-virhesopimus

Nykyinen MVP käyttää vastauksia, joissa virhe on pääosin muodossa:

```json
{
  "error": "Safe error message."
}
```

Tätä ei tarvitse muuttaa kerralla.

Myöhemmin virhesopimusta voidaan laajentaa kieliriippumattomalla koodilla:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Safe fallback message."
  }
}
```

Kenttäkohtaisia virheitä voidaan myöhemmin lisätä rajattuna rakenteena, jos
lomakkeet tarvitsevat niitä.

Virhesopimuksen muutoksessa pitää:

- säilyttää turvallinen geneerinen fallback
- validoida response API-clientissä
- päivittää backend-, API-client- ja UI-testit
- välttää teknisten virheolioiden serialisointia
- päättää yhteensopivuus nykyisen `{ error: string }` -muodon kanssa

## API-client

API-client on HTTP-rajapinnan ja webin välinen raja.

API-client:

- muuntaa epäonnistuneen HTTP-vastauksen `EkyApiError`-muotoon
- säilyttää vähintään turvallisen viestin ja HTTP-statuskoodin
- validoi onnistuneen response-bodyn ennen palautusta
- ei laske liiketoimintasummia
- ei päätä käyttöoikeuksista
- ei näytä virhettä käyttäjälle
- ei palauta raakaa backend- tai tietokantavirhettä

Nykyinen `EkyApiError` sisältää:

- turvallisen viestin
- statuskoodin
- response-bodyn sisäistä jatkokäsittelyä varten

Web UI ei saa renderöidä `responseBody`-arvoa sellaisenaan.

Tulevassa rajatussa parannuksessa `EkyApiError` voi välittää myös:

- kieliriippumattoman virhekoodin
- kenttäkohtaiset validointivirheet

Tämä tehdään vasta, kun backendin virhesopimus on päätetty. API-client ei saa
arvata koodeja englanninkielisestä viestistä.

## Web UI

Web UI päättää, miten turvallinen virhe esitetään käyttäjälle.

Virhe voidaan näyttää:

- kentän yhteydessä, jos virhe kuuluu selvästi yhteen lomakekenttään
- lomakkeen tai sivupaneelin yhteydessä, jos tallennus epäonnistui
- näkymän yläosassa, jos koko näkymän lataus epäonnistui
- lyhyenä ilmoituksena, jos toiminnon tulos ei vaadi pysyvää virhepintaa

Käyttäjälle näkyvät virheet:

- ovat ensisijaisesti suomeksi
- tulevat webin i18n-rakenteen kautta
- eivät sisällä stack tracea tai teknisiä sisäisiä tietoja
- kertovat mahdollisuuksien mukaan, mitä käyttäjä voi tehdä seuraavaksi

Webiin voidaan myöhemmin lisätä pieni yhteinen API error presenter, kun sama
muunnos alkaa toistua useassa feature-moduulissa.

Se ei saa:

- sisältää domain-logiikkaa
- päättää käyttöoikeuksista
- korvata feature-kohtaista kenttävirheiden käsittelyä
- muuttua yleiseksi `utils`- tai `helpers`-kaatopaikaksi

React Error Boundary kuuluu odottamattomien renderöinti- ja komponenttipuun
virheiden käsittelyyn.

Error Boundary ei korvaa:

- API-kutsujen `try/catch`-käsittelyä
- lomakevalidointia
- backendin käyttöoikeustarkistuksia
- odotettujen käyttötapausvirheiden esittämistä

## Modulaarisuus

Virheenkäsittely jaetaan kerroksittain:

- moduuli omistaa omat domain- ja application-virheensä
- backendin HTTP-kerros omistaa HTTP-muunnoksen
- `packages/api-client` omistaa client-virhemuodon
- webin feature tai rajattu shared-esityskerros omistaa UI-esityksen

Älä luo:

- yhtä koko järjestelmän error-manageria
- `packages/errors`-pakettia ennakolta
- yleistä `utils`, `helpers` tai `common` -virhekansiota
- riippuvuutta, joka pakottaa domainin tuntemaan HTTP:n tai UI:n

Jaettu ratkaisu luodaan vasta, kun vastuu ja todellinen toisto ovat näkyvissä.

## Testaus

Virheenkäsittelyä muutettaessa testataan vaikutusalueen mukaan ainakin:

- tunnettu domain/application-virhe
- turvallinen HTTP-status ja response
- tuntematon resurssi ja toisen yrityksen resurssi samalla turvallisella tavalla
- virheellinen tai liian suuri request
- API-clientin virheellisen JSON-vastauksen käsittely
- API-clientin virheellisen response-rakenteen käsittely
- UI:n suomenkielinen fallback
- ettei stack trace, SQL, polku, salaisuus tai tarpeeton data vuoda

Frontendin virhe-esitys ei korvaa backendin negatiivisia turvallisuustestejä.

## Lokitus ja audit

Tuotantolokitus ja audit trail suunnitellaan erillisinä kokonaisuuksina ennen
tuotantokäyttöä.

Lokitus:

- auttaa teknisen vian tutkimisessa
- ei saa sisältää salaisuuksia tai tarpeetonta henkilötietoa
- voi myöhemmin käyttää request- tai correlation-tunnistetta

Audit trail:

- kertoo kuka teki liiketoimintakriittisen toiminnon
- ei ole sama asia kuin tekninen virheloki
- tarvitaan myöhemmin erityisesti laskutuksen hyväksyntään ja asetuksiin

Virheenkäsittelydokumentti ei vielä päätä tuotantolokituksen teknologiaa.

## Vaiheistus

### Vaihe 1: periaatteet

- tämä dokumentti
- lukusääntö juuri-`AGENTS.md`:ään
- ei tuotantokoodimuutoksia

### Vaihe 2: API-client

- tarkista `EkyApiError`-rakenne
- säilytä status ja turvallinen fallback
- lisää virhekoodi vasta backendin error-contract-päätöksen jälkeen
- lisää kohdistetut testit

### Vaihe 3: web

- luo rajattu API-virheen esitysmalli, kun toistoa on riittävästi
- pidä kenttävirheet feature-kohtaisina
- lisää React Error Boundary odottamattomille renderöintivirheille
- lisää käyttäjälle näkyvät tekstit i18n-rakenteeseen

### Vaihe 4: backend HTTP

- arvioi yhteinen HTTP error mapper vasta, kun reittikohtainen muunnos toistuu
- säilytä moduulien omat domain/application-virheet
- lisää turvalliset fallback- ja tietovuototestit

### Vaihe 5: tuotantovalmius

- turvallinen strukturoitu lokitus
- correlation-tunnisteet tarvittaessa
- audit trail kriittisille toiminnoille
- valvonta ja hälytykset
- release security review

## Seuraava suositeltu askel

Ennen laskutus-UI:n rakentamista tehdään pieni vaihe 2:

- auditoidaan nykyinen `EkyApiError`
- päätetään, tarvitseeko ensimmäinen laskutus-UI nykyistä
  `status + message` -mallia laajemman virhesopimuksen
- vältetään virhekoodien tai kenttävirheiden lisääminen ilman backendin
  yhteistä sopimusta

Tämän jälkeen laskutus-UI voidaan rakentaa niin, että se käyttää yhtä
hallitusti määriteltyä API-virhepolkua alusta lähtien.
