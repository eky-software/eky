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
| `longTermIncidentIndex` | anonyymi/minimaalinen incident-indeksi | 10 vuotta |
| `temporarySupportBundle` | runtimen väliaikainen tukipaketti | 30 päivää |

Käyttäjän itse ulkoiseen kohteeseen tallentamaa tukipakettikopiota Eky ei
poista automaattisesti.

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
- outcome
- turvallinen fingerprint

## Tiedostorakenne ja rotaatio

Desktop omistaa kiinteän juuren:

```text
userData/runtime/logs/
  backend/
  desktop/
  security/
  incident-index/
```

Kuukausitiedostot:

```text
backend-2026-07-001.jsonl
desktop-2026-07-001.jsonl
security-2026-07-001.jsonl
incident-index-2026.jsonl
```

- Uusi kuukausi aloittaa uuden tiedoston.
- Yksi kuukausisegmentti on enintään 5 MiB.
- Yhdelle component/category/kuukaudelle sallitaan enintään neljä segmenttiä.
- Kuukausibudjetin täyttyessä info-eventtejä voidaan jättää kirjoittamatta.
- Warn/error/security priorisoidaan ja kapasiteetista kirjoitetaan yksi
  turvallinen `logCapacityReached`-yhteenveto.
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
