# Windows-päivityksen diagnostiikkakäsikirja

## Tila

Tämä on tulevan Update Coordinatorin docs-first runbook. Tuotantokoodissa ei
ole vielä `update.*`-eventtejä eikä tässä dokumentissa lukita eventName-arvoja.
Tarkat nimet hyväksytään vasta transaction ownership- ja failure behavior
-toteutuspäätöksessä.

## Omistajuus

Update Coordinator omistaa yhden päivitysyrityksen teknisen lifecycle-
korrelaation. Se ei kirjoita business auditia eikä Activity-tapahtumia.
Turvallinen tekninen projektio kuuluu Diagnosticsiin. Failure/security-
tason minimoitu havainto voi kuulua incident indexiin nykyisen retention-
politiikan mukaan.

Sallitut kentät ovat vain:

- `correlationId`
- `currentVersion`
- `targetVersion`
- `releaseChannel`
- allowlistattu `stage`
- `durationMs`
- turvallinen `errorCode`
- `retryable`
- `sideEffectState`
- nykyisen build identity -politiikan sallima revision/runtime identity.

Kiellettyjä ovat raaka polku, komentorivi, executable, URL queryineen,
installer stdout/stderr, business data, `companyId`, backup- tai recovery-
payload, salaisuus, runtime-session, stack ja vapaa metadata.

## Stage-allowlist

Lopulliset nimet lukitaan toteutuksessa. Semanttisesti sallittuja vaiheita
ovat enintään:

- package inspection
- user confirmation
- pre-update recovery
- runtime maintenance
- runtime shutdown
- installer handoff
- awaiting first start
- first-start validation
- business rollback
- binary rollback
- accepted
- failed safe.

## Error code -runbook

| errorCode | Merkitys | Data-impact | Turvallinen retry | Käyttäjän toiminta | Tukitoiminta | Liittyvä vaihe | Käyttö pysäytetään |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `UPDATE_PACKAGE_INVALID` | Manifesti, identity, versio, arkkitehtuuri, koko, hash tai allekirjoitus ei kelpaa | Ei muutosta | Ei samalla paketilla | Valitse virallinen paketti uudelleen | Tarkista julkaisu ja manifesti ilman käyttäjän polkua | package inspection | Ei, nykyistä versiota voi käyttää |
| `UPDATE_PACKAGE_CHANGED` | Paketti muuttui tarkistuksen jälkeen | Ei muutosta | Vasta uudella inspectillä | Peruuta ja valitse paketti uudelleen | Tutki release-lähde; älä pyydä raakaa tiedostopolkua lokiin | package inspection | Ei |
| `UPDATE_RECOVERY_POINT_FAILED` | Pakollista pre-update-pistettä ei saatu valmiiksi | Ei installeria eikä skeemamuutosta | Kyllä syyn korjauksen jälkeen | Vapauta levytilaa tai ota yhteys tukeen | Tarkista Profile Protectionin turvallinen tila | pre-update recovery | Ei, nykyistä versiota voi käyttää |
| `UPDATE_MAINTENANCE_CONFLICT` | Backup, restore tai muu suojattu operaatio on kesken | Ei muutosta | Kyllä myöhemmin | Odota toiminnon valmistumista | Tarkista vain allowlistattu operation state | runtime maintenance | Ei |
| `UPDATE_SHUTDOWN_TIMEOUT` | Runtime ei sulkeutunut määräajassa | Installeria ei käynnistetä; journal voi vaatia tarkistuksen | Vain hallitun restartin jälkeen | Sulje Eky ja käynnistä uudelleen | Varmista orphan-prosessit turvallisesti | runtime shutdown | Kyllä päivitykseltä, ei välttämättä nykykäytöltä |
| `UPDATE_INSTALLER_START_FAILED` | Validoitua installeria ei voitu käynnistää | Business data ennallaan | Kyllä syyn korjauksen jälkeen | Käynnistä Eky uudelleen ja yritä virallisella paketilla | Tarkista signing, AV ja exit/spawn-luokka ilman komentoriviä | installer handoff | Ei |
| `UPDATE_INSTALLER_FAILED` | Installer palautti virheen | Binaarit voivat olla rollbackattu tai tila epäselvä | Ei ennen journalin tarkistusta | Älä käynnistä asennusta uudelleen sokkona | Tarkista installerin tila paikallisesti; stdout/stderr ei tukipakettiin | installer handoff | Kyllä |
| `UPDATE_FIRST_START_FAILED` | Uusi build ei läpäissyt migration-, integrity-, FK-, readiness- tai health-porttia | Uutta profiilia ei hyväksytä | Ei ennen rollbackia | Älä jatka business-käyttöä | Käynnistä business rollback ja arvioi binary rollback | first-start validation | Kyllä |
| `UPDATE_BUSINESS_ROLLBACK_FAILED` | Pre-update-profiilia ei saatu palautettua terveeksi | Business-datan käytettävyys epävarma | Ei | Lopeta ohjelman käyttö ja ota yhteys tukeen | Käytä ADR-0009:n recovery-required-menettelyä | business rollback | Kyllä |
| `UPDATE_BINARY_ROLLBACK_FAILED` | Edellistä binaariversiota ei saatu palautettua | Palautettu business data voi olla kunnossa, mutta sovellus ei ole käyttövalmis | Ei | Lopeta ohjelman käyttö ja ota yhteys tukeen | Asenna journalissa sidottu allekirjoitettu edellinen versio hallitusti | binary rollback | Kyllä |
| `UPDATE_STATE_INCONSISTENT` | Journalin ja runtime/build identityn tila ei täsmää | Vaikutus epäselvä | Ei | Älä jatka käyttöä | Tarkista journalin turvallinen yhteenveto ja recovery pointin tila | mikä tahansa | Kyllä |

## Tukipaketin raja

Tukipakettiin voidaan ottaa vain turvallinen nykytilan yhteenveto ja yllä
määritellyt sanitoidut tapahtumat. Päivityspakettia, manifestia,
päivitysjournalia, installer-logia, yritysprofiilia tai palautuspistettä ei
sisällytetä sellaisenaan.
