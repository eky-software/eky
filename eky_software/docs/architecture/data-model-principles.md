# Tietomallin periaatteet

Tämä dokumentti määrittelee Eky-projektin tietomallin yleiset säännöt.

Tarkkoja tauluja ei päätetä tässä dokumentissa, vaan moduulikohtaisessa suunnittelussa.

## Pääperiaate

Tietomallin pitää tukea turvallisuutta, modulaarisuutta, auditointia, mahdollista moniyrityskäyttöä ja myöhempää local-cloud-synkronointia.

Tietomallia ei suunnitella vain yhden yrityksen väliaikaiseksi rakenteeksi.

Tietomalli suunnitellaan relaatiopohjaiseksi niin, että paikallinen SQLite-profiili ja pilven PostgreSQL-profiili voidaan pitää hallittuina repository-adapterien takana.

## Yritysrajaus

Keskeinen liiketoimintadata kuuluu yritykselle.

Useimmissa ydintauluissa pitää olla yritysrajaus, esimerkiksi:

- `companyId`

Backend varmistaa, että käyttäjä saa käsitellä vain oman yrityksensä dataa.

## Peruskentät

Keskeisissä liiketoimintaolioissa harkitaan seuraavia kenttiä:

- `id`
- `companyId`
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`
- `status`

Kaikki kentät eivät kuulu kaikkiin tauluihin, mutta näitä harkitaan oletuksena.

## ID-käytännöt

ID:t suunnitellaan niin, että ne toimivat myös tulevaa offline- tai synkronointikäyttöä ajatellen.

ID:t eivät saa sisältää liiketoimintasalaista tietoa.

Paikallisesti syntyvien tietueiden ID-mallin pitää toimia ilman jatkuvaa pilviyhteyttä.

Laskunumerointi erotetaan teknisestä ID:stä.

## Laskunumerointi

Laskun numero ei ole sama asia kuin tietokannan tekninen ID.

Laskunumero generoidaan tai vahvistetaan hallitusti backendissä yrityksen laskutusasetusten perusteella.

Käyttäjä voi syöttää tai muokata ehdotettua laskunumeroa laskutusnäkymässä vain hallitun prosessin kautta. Frontend ei saa yksin päättää lopullista laskunumeroa.

Backend tarkistaa laskunumeron muodon, yritysrajauksen, uniikkiuden ja numerointisarjan säännöt.

Numerointisarjan seuraava numero ja tilikausi ovat yrityskohtaisia laskutusasetuksia.

## Rahasummat

Rahasummia ei käsitellä epätarkasti.

Rahasummien tallennustapa päätetään ennen laskutusmoduulin toteutusta.

Suositeltavia vaihtoehtoja:

- tallennus sentteinä kokonaislukuna
- tarkka decimal-tyyppi tietokannassa

Floating point -tyyppistä epätarkkaa laskentaa vältetään rahassa.

## Päivämäärät ja ajat

Aikaleimat tallennetaan yhtenäisellä tavalla.

Tuotantodatassa huomioidaan aikavyöhykkeet.

Tärkeissä tapahtumissa tallennetaan sekä tapahtuman aika että kirjausaika, jos niillä on liiketoiminnallinen ero.

## Soft delete

Poistaminen pitää suunnitella tapauskohtaisesti.

Kaikkea liiketoimintadataa ei saa poistaa fyysisesti ilman harkintaa.

Esimerkiksi laskutusta ja audit-logia koskeva data on erityisen herkkää.

Mahdollisia kenttiä:

- `deletedAt`
- `deletedBy`
- `isDeleted`

## Historiatieto

Kriittisissä liiketoimintatoiminnoissa muutoksista pitää jäädä jälki.

Historiatieto voidaan toteuttaa audit logilla, versioinnilla tai erillisillä historiatauluilla.

Tarkka ratkaisu päätetään moduulikohtaisesti.

## Status-kentät

Liiketoimintaolioilla voi olla tiloja.

Esimerkiksi lasku:

- `draft`
- `approved`
- `sent`
- `paid`
- `cancelled`

Status-siirtymät eivät saa olla satunnaisia merkkijonomuutoksia, vaan niiden pitää noudattaa domain-sääntöjä.

## Viittaukset moduulien välillä

Moduulien välisten viittausten pitää olla hallittuja.

Moduuli ei saa muuttaa toisen moduulin omistamaa dataa suoraan.

Esimerkiksi lasku voi viitata asiakkaaseen, mutta laskutusmoduuli ei omista asiakkaan perustietoja.

## Audit log

Audit logiin voidaan tallentaa:

- `companyId`
- `actorUserId`
- `action`
- `targetType`
- `targetId`
- `createdAt`
- `metadata`

Audit log ei saa tallentaa tarpeettomasti arkaluonteista dataa.

## Synkronointivalmius

Eky suunnitellaan niin, että paikallinen offline-käyttö ja myöhempi pilvisynkronointi ovat mahdollisia.

Kaikkiin tauluihin ei lisätä synkronointikenttiä varmuuden vuoksi, mutta kriittisissä liiketoimintaolioissa harkitaan esimerkiksi:

- `version`
- `sourceDeviceId`
- `syncStatus`
- `lastSyncedAt`
- `deletedAt`
- `updatedAt`

Mahdollisia synkronointitiloja voidaan myöhemmin määritellä esimerkiksi:

- `localOnly`
- `pendingSync`
- `synced`
- `syncFailed`
- `conflict`

Synkronointia ei toteuteta raakakopioimalla paikallista tietokantaa pilveen. Pilveen siirtyvät muutokset kulkevat hallitun backend-rajapinnan, validoinnin, käyttöoikeustarkistusten ja auditoinnin kautta.

## Liitteet ja tiedostot

Tiedostoja ei tallenneta suoraan relaatiotietokantaan ilman erityistä syytä.

Tietokantaan tallennetaan metatiedot ja viittaus tiedoston sijaintiin.

Tiedostojen käyttöoikeudet tarkistetaan backendissä.

## Avoimet kysymykset

- Lopullinen ID-malli
- Laskunumeroinnin toteutus
- Rahasummien tarkka tallennustapa
- Audit log -taulun rakenne
- Soft delete -käytännöt moduuleittain
- Offline-synkronoinnin tarvitsemat kentät
- Local-cloud-synkronoinnin konfliktien ratkaisu
