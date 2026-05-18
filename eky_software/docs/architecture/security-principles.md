# Turvallisuusperiaatteet

Tämä dokumentti määrittelee Eky-projektin turvallisuuden pääperiaatteet.

Turvallisuus on ensisijainen vaatimus koko projektissa.

## Pääperiaate

Frontend ei ole luotettu ympäristö.

Backend tarkistaa aina:

- käyttäjän tunnistamisen
- käyttöoikeudet
- yritysrajauksen
- syötteen oikeellisuuden
- liiketoimintasäännöt

## Liikenne

Tuotannossa kaikki liikenne kulkee salattuna.

Perusmalli:

- frontend -> backend: HTTPS
- backend -> tietokanta: salattu tai hallittu pilviyhteys
- backend -> ulkoiset palvelut: salattu yhteys

Lokaalissa kehityksessä voidaan käyttää `localhost`-yhteyksiä, mutta tuotantoturvallisuutta ei saa suunnitella paikallisen oletuksen varaan.

## Salaisuudet

Salaisuuksia ei tallenneta frontendiin.

Salaisuuksia ovat esimerkiksi:

- API-avaimet
- tietokannan salasanat
- service account -avaimet
- yksityiset tokenit
- webhook-salaisuudet

Salaisuudet hallitaan ympäristömuuttujilla tai pilven salaisuuksien hallintapalvelulla.

## Autentikointi

Firebase Auth on alustava valinta käyttäjän tunnistamiseen.

Backend tarkistaa käyttäjän tokenin.

Pelkkä frontendissä näkyvä kirjautumistila ei riitä turvallisuudeksi.

## Käyttöoikeudet

Käyttöoikeudet tarkistetaan backendissä.

Frontend voi piilottaa painikkeita tai näkymiä käyttökokemuksen vuoksi, mutta se ei ole varsinainen suojaus.

Käyttöoikeuksissa noudatetaan deny by default -periaatetta: jos oikeutta ei ole nimenomaisesti annettu, toimintoa ei sallita.

Käyttöoikeudet voivat perustua:

- rooleihin
- permission-sääntöihin
- yritysjäsenyyteen
- moduulikohtaisiin oikeuksiin

## Tenant-eristys

Järjestelmä suunnitellaan niin, että sitä voidaan myöhemmin käyttää useassa yrityksessä.

Keskeinen periaate:

- käyttäjä kuuluu yritykseen
- data kuuluu yritykseen
- backend varmistaa, että käyttäjä saa käsitellä vain oman yrityksensä dataa

Tärkeissä tauluissa käytetään `companyId`-tyyppistä yritysrajausta.

## Syötteen validointi

Kaikki ulkoinen syöte validoidaan backendissä.

Ulkoinen syöte voi tulla:

- frontendistä
- mobiilista
- AI-agentilta
- integraatiosta
- tiedostotuonnista
- webhookista

Frontend-validointi ei korvaa backend-validointia.

## Audit trail

Kriittisistä toiminnoista kirjataan audit log.

Audit logiin voidaan kirjata esimerkiksi:

- kuka teki toiminnon
- milloin toiminto tehtiin
- mitä toimintoa tehtiin
- mihin kohteeseen toiminto liittyi
- mistä lähteestä toiminto tuli
- mitä oleellista muuttui

Audit logia tarvitaan erityisesti laskutuksessa, käyttöoikeuksissa ja yritysasetuksissa.

## Hashaus ja salaus

Hashausta käytetään oikeisiin käyttötarkoituksiin.

Esimerkkejä:

- salasanoja ei tallenneta itse, jos käytetään Firebase Authia
- tokenit ja salaisuudet eivät saa tallentua raakamuodossa
- tiedoston eheyteen voidaan käyttää hashia
- audit trailiin voidaan myöhemmin harkita hash-pohjaista muuttumattomuuden tarkistusta

Kaikkea dataa ei hashata. Liiketoimintadata suojataan käyttöoikeuksilla, yhteyksien salauksella, tietokannan suojauksella ja audit traililla.

## AI-agentit

AI-agentit ovat järjestelmän toimijoita, eivät poikkeuksia turvallisuuteen.

AI-agentit eivät saa:

- kirjoittaa suoraan tietokantaan
- ohittaa käyttöoikeuksia
- ohittaa domain-sääntöjä
- ohittaa audit logia
- käyttää salaisuuksia suoraan ilman hallittua rajapintaa

AI-agenttien toiminta pitää olla jäljitettävää.

## Paikallinen käyttö

Paikallinen kehityskäyttö ei saa heikentää tuotantoturvaa.

Local development voi käyttää paikallista tietokantaa ja kehitysautentikointia.

Tuotantokäytössä oikea autentikointi, käyttöoikeudet ja salattu liikenne ovat pakollisia.

## Kiellettyjä ratkaisuja

Älä tee:

- API-avaimia frontendiin
- käyttöoikeuksia vain frontendissä
- suoria tietokantakutsuja frontendistä
- tuotantodatan käyttöä testidatana
- salaisuuksien logitusta
- kovakoodattuja salasanoja
- kovakoodattuja yritys-ID:itä
- AI-agentille suoraa tietokantaoikeutta

## Avoimet turvallisuuskysymykset

- Tarkka rooli- ja permission-malli
- Audit login rakenne
- Tuotantoympäristön salaisuuksien hallinta
- Firebase Auth tokenin tarkistustapa backendissä
- Mobiilin offline-synkronoinnin konfliktiturva
- Tenant-eristyksen tarkka tietomalli
