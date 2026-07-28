# Operational-lokien retention ja rotaatio

Tämä dokumentti määrittelee Eky R0:n oletusretentionin. Luokat perustuvat
tarkoitukseen ja tietojen minimointiin. Ne eivät tee technical logista
kirjanpitoaineistoa.

## Retention-luokat

| Luokka | Sisältö | Oletussäilytys |
| --- | --- | --- |
| `businessDetailed` | moduulin oma minimaalinen audit trail | tapahtumavuoden jälkeen seitsemän täyttä kalenterivuotta |
| `operationalInfo` | rajatut info-eventit | 12 kuukautta |
| `operationalWarningError` | warn/error-eventit | 24 kuukautta |
| `securityDetailed` | rajatut security-eventit | 24 kuukautta |
| `debugTemporary` | erikseen aktivoitu kehitysdiagnostiikka | 30 päivää |
| `longTermIncidentIndex` | minimoitu incident-indeksi ilman suoria tunnisteita | 10 vuotta |
| `temporarySupportBundle` | runtimen väliaikainen tukipaketti | 30 päivää |

Käyttäjän itse ulkoiseen kohteeseen tallentamaa tukipakettikopiota Eky ei
poista automaattisesti.

Tukipakettiin luetaan vain täsmällisesti viimeisen 30 päivän rajattu
warning/error- ja security-aineisto sekä saman aikavälin minimoidut
incident-yhteenvedot. Tämä lukuraja ei pidennä lähdelokien retentionia.
Runtimen väliaikaiset tukipakettitiedostot poistetaan 30 päivän jälkeen;
käyttäjän ulkoiseen kohteeseen tallentaman salaamattoman paketin säilytys ja
poistaminen ovat käyttäjän hallinnassa.

`businessDetailed` voi sisältää pseudonyymejä entity- ja actor-tunnisteita ja
on siksi henkilötietojen käsittelyä silloin, kun tunniste voidaan yhdistää
henkilöön. Se on permission- ja company-rajattu. Tavallinen onnistunut
customer update ei päädy 10 vuoden incident-indeksiin.

`longTermIncidentIndex` ei sisällä nimiä, osoitteita, sähköposteja, IBANia,
entity- tai actor-tunnisteita, entity-sisältöä, stackia eikä paikallisia
polkuja. Se sisältää vain:

- timestamp
- eventName
- errorCode
- component
- appVersion
- buildRevision
- outcome
- turvallinen fingerprint

Incident-indeksiin ei kirjoiteta `runtimeInstanceId`-, `correlationId`- tai
`operationId`-tunnisteita. Ne ovat vain lyhyemmän retentionin paikallista
vianrajausta varten.

SMTP:n transport-diagnostiikan etä-IP kuuluu vain paikalliseen detailed-
virtaan. Onnistuneessa info-eventissä se poistuu 12 kuukauden ja
warning/error-eventissä 24 kuukauden retentionilla. Etä-IP:tä ei kirjoiteta
10 vuoden incident-indeksiin, Diagnostics-projektioon eikä tukipakettiin.

## Business-auditin automaattinen retention

Moduulien business audit -tauluja ei käsitellä teknisten JSONL-lokien
tiedostomaintenancella. Customers, Company Settings ja Invoicing tarjoavat
omat rajatut retention-porttinsa, ja backendin startup-maintenance koordinoi
niitä tietämättä audit-rivien sisältöä.

Startupissa poistetaan tapahtumat, joiden tapahtumavuoden jälkeen on
kulunut seitsemän täyttä kalenterivuotta. Raja lasketaan UTC-vuosina ja poisto
on tiukasti ennen cutoff-ajankohtaa. Esimerkiksi vuonna 2026 poistetaan ennen
`2019-01-01T00:00:00.000Z` syntyneet tapahtumat. Vuonna 2026 syntynyt tapahtuma
voidaan siten poistaa aikaisintaan `2034-01-01T00:00:00.000Z`.

Retention koskee:

- Customers-moduulin customer audit -tapahtumia
- Company Settingsin master data -auditia
- Company Settingsin valmiiksi päättyneitä sähköpostisalaisuuden
  lifecycle-tapahtumia
- Invoicingin laskutusasetusten auditia

Sähköpostisalaisuuden `pending`-tapahtumaa ei poisteta automaattisesti, koska
se voi vaatia reconciliation-käsittelyä. Jokainen moduuli tekee omat poistonsa
transaktiossa. Maintenance on startupissa best effort: virhe lokitetaan
turvallisena yhteenvetona, mutta se ei estä paikallisen sovelluksen
käynnistymistä.

Yhteenveto sisältää vain poistettujen tapahtumien kokonaismäärän. Audit-rivien
company-, actor- tai entity-tunnisteita, sisältöä tai yksittäisiä
taulukohtaisia määriä ei kopioida tekniseen lokiin.

## Tiedostorakenne ja rotaatio

Desktop omistaa kiinteän juuren:

```text
userData/runtime/logs/
  backend/
  desktop/
  security/
  incident-index/
```

Paketoidussa Windows-sovelluksessa tämä tarkoittaa oletuksena polkua
`%APPDATA%\Eky\runtime\logs`. Polku on runtime-infrastruktuurin omistama eikä
sitä hyväksytä rendereriltä tai HTTP-pyynnöstä.

Kuukausitiedostot:

```text
backend-info-2026-07-001.jsonl
backend-warning-error-2026-07-001.jsonl
desktop-info-2026-07-001.jsonl
desktop-warning-error-2026-07-001.jsonl
backend-security-2026-07-001.jsonl
desktop-security-2026-07-001.jsonl
backend-incident-index-2026.jsonl
desktop-incident-index-2026.jsonl
```

Backend ja Electron main eivät kirjoita samaan tiedostovirtaan. Security-
hakemiston `backend-security`- ja `desktop-security`-virrat yhdistetään vasta
diagnostiikan lukuprojektiossa.

- Uusi kuukausi aloittaa uuden tiedoston.
- Yksi kuukausisegmentti on enintään 5 MiB.
- Yhdelle component/category/kuukaudelle sallitaan enintään neljä segmenttiä.
- Kuukausibudjetin täyttyessä info-eventtejä voidaan jättää kirjoittamatta.
- Warn/error/security priorisoidaan ja kapasiteetista kirjoitetaan yksi
  turvallinen `operationalLog.capacityReached`-yhteenveto.
- Detailed logs -kokonaisbudjetti on 500 MiB.
- Incident index -budjetti on 25 MiB.

## Turvallinen maintenance

Maintenance käsittelee vain kiinteän logs-rootin sisällä Eky-patterniin sopivia
tiedostonimiä. Se ei seuraa symlinkkejä, poista aktiivista tiedostoa eikä ota
polkua requestista tai rendereriltä.

Retention suoritetaan:

- startupissa
- uuden kuukauden ensimmäisellä kirjoituksella
- rotaatiossa
- tukipaketin muodostuksen yhteydessä read-only-tarkistuksena

Vanhimmat retentioniin kuuluvat tiedostot poistetaan myös kokonaisbudjetin
ylittyessä. Tulevaisuuteen päivätty tiedosto ei saa aiheuttaa muiden
tiedostojen poistamista. Katkennut JSONL-rivi ei estä muiden rivien lukemista.
Maintenance-virhe ei kaada sovellusta.

Yhteenvetoeventissä sallitaan vain:

- deletedFileCount
- deletedByteCount
- oldestRemainingMonth
- outcome

Yksittäisiä polkuja tai poistettujen business-entityjen tunnisteita ei
lokiteta.

## Hallinnollinen tarkistus

Ennen oikean henkilödatan pilotointia rekisterinpitäjä dokumentoi, miksi kukin
henkilötietoja sisältävä audit-luokka on tarpeellinen ja kuinka kauan sitä
tarvitaan. Jos tarkoitus päättyy aiemmin, data poistetaan tai anonymisoidaan.
Kirjanpitolain lasku- ja tositesäilytys ei automaattisesti oikeuta kaikkien
teknisten tai audit-eventien samaa säilytysaikaa.
