# Eky Local Company Workspace -toteutussuunnitelma

## Tila

Suunniteltu kokonaisuus. W0:n arkkitehtuuri- ja hyväksymissopimus sekä W0.1:n
lifecycle-tarkennukset on dokumentoitu. W1:n inertti foundation on yhdistetty
vihreänä `main`-haaraan commitissa `687a424`. W2:n tyhjän työtilan luonnin
inertti foundation on yhdistetty vihreänä `main`-haaraan commitissa
`3529840`. W2.1 koventaa yhteiset workspace-sopimukset, runtimen palautuksen
ja startup-recoveryn runtime-poissaolorajan ennen W3:a. W3:n uuden lineagen
backup-import on toteutettu inerttinä foundationina omalla feature-haarallaan.
W1-W3:n foundation on toteutettu ja W4 on aktivoinut registryyn sidotun
startupin, legacy-profiilin kertaluonteisen adoption sekä workspace-kohtaiset
runtime-resurssit production-compositionissa. W5 on jaettu Electron mainin
sisäiseen W5A management-foundationiin ja erikseen hyväksyttävään W5B
renderer/UI-toimitukseen. W5A on toteutettu ja hyväksytty paikallisella
testimatriisilla. W5B.1:n turvallinen workspace-valitsin sekä status-, create-,
import-as-new-, switch- ja rename-capabilityt on toteutettu ja hyväksytty
paikallisesti. Aktiivisen exact-lineage-workspacen replace-UI kuuluu W5B.2:een
ja W6:n täysi paketoitu usean työtilan release-matriisi on edelleen
toteuttamatta. Käyttäjälle ei julkaista tätä kokonaisuutta ennen W5B-W6-
porttien valmistumista.

Tämä suunnitelma toteuttaa
`docs/decisions/ADR-0011-local-multi-workspace-company-model.md`-päätöksen
pieninä, erikseen katselmoitavina checkpointteina.

## Tavoite

Eky Local tukee samalla Windows-käyttäjällä useita erillisiä paikallisia
yritystyötiloja siten, että:

- vain yksi työtila on aktiivinen kerrallaan
- jokainen työtila omistaa oman SQLite- ja business-artifact-juurensa
- renderer ei saa polkuja, sessionia tai salaisuuksia
- backendin `companyId` tulee aina aktiivisen työtilan validoidusta
  runtime-identiteetistä
- backup/restore käsittelee yhtä lineagea eikä yhdistä työtiloja
- installer ja update säilyvät asennustasoisina
- vanha 0.2.6-profiili adoptoidaan fail-closed-mallilla.

## Muuttumattomat rajat W1-W6:ssa

- Domain- ja application-logiikka eivät tunne Electron-polkuja.
- `companyId` ei tule rendereriltä tai työtilalabelista.
- Työtila ei ole käyttäjä, membership tai permission.
- Työtilat eivät jaa SQLitea, business-PDF:iä, recovery pointteja,
  restore-journalia, SMTP-secret-namespacea tai PDF-arkiston retry-journalia.
- Portable backup ei ole merge- eikä sync-formaatti.
- Uusi dependency, schema tai backup-formaatti vaatii erillisen omistajan
  päätöksen ennen toteutusta.
- Checkpointin sisällä saa tehdä pieniä paikallisia committeja ja ajaa
  kohdetestejä, mutta GitHubiin pushataan vain yksi koherentti, paikallisesti
  vihreä checkpoint. Lähtökohtaisesti checkpointilla on enintään yksi PR- ja
  CI-kierros kerrallaan; GitHubia ei käytetä ensisijaisena debuggerina.
- Seuraavaa checkpointia ei aloiteta ennen vihreää edellistä checkpointia ja
  dokumentoitua hyväksyntää. W1:n serializer-, store-, containment- ja
  recovery-osat kuuluvat samaan W1-PR:ään, eivät erillisiin kokeilu-PR:iin.

## W0: Architecture and acceptance contract

**Tila:** valmis dokumentaatiotasolla.

**Omistaja:** arkkitehtuuridokumentaatio; Electron mainin tuleva workspace-
composition.

**Muutettu:** ADR-0011, tämä suunnitelma, reititys, integraatiomatriisi ja
suunniteltu E2E-matriisi.

**Ei muutettu:** tuotantokoodi, SQLite, backup-formaatti, API, UI,
riippuvuudet, versio tai installer.

**Luottamusraja:** `workspaceId`, lineage identity, `companyId`, storage scope,
backup import/replace ja switch-lifecycle erotellaan.

**Hyväksymisportti:** dokumenttilinkit, ristiriidattomuus ADR-0008/0009/0010:n
kanssa sekä omistajan katselmus.

## W1: Installation-owned workspace registry

**Tila:** inertti foundation yhdistetty vihreänä `main`-haaraan commitissa
`687a424`; production-aktivointi ja käyttäjälle näkyvä toiminto eivät kuulu
W1:een.

**Omistaja:** Electron mainin rajattu workspace registry -adapteri ja
composition. Ei backend- tai business-moduuli.

**Muutettavat kerrokset:** desktop main, sisäinen registry schema/serializer,
composition ja testit. UI:ta ei vielä avata.

**Muuttumattomat kerrokset:** backend HTTP/API, domain, SQLite business-
schema, backup container, installer payload ja web-komponentit.

**Sopimus:**

- ADR-0011:n täsmällinen `LocalWorkspaceRegistryV1`, jossa ovat vain
  `formatVersion`, `activeWorkspaceId` ja `workspaces`
- entry sisältää vain `workspaceId`, `workspaceLabel`, versionoidun
  `lineageIdentity`-arvon, `layoutVersion = 1`, tilan `ready` tai
  `recoveryRequired` sekä strict UTC `createdAt`-arvon
- Electron mainin `crypto.randomUUID()`-funktiolla luoma canonical lowercase
  UUID v4 `workspaceId`; väärä case, versio, variantti tai muoto torjutaan
- trimmattu yhden rivin `workspaceLabel`, 1-80 Unicode-koodipistettä;
  C0/C1-control-, line separator- ja bidi override/isolate -merkit torjutaan,
  mutta samat labelit sallitaan
- `lineageIdentity.formatVersion = 1` ja täsmälleen 64 lowercase SHA-256-hex-
  merkkiä sisältävä `profileId`
- canonical UTC `createdAt` muodossa `YYYY-MM-DDTHH:mm:ss.sssZ`, jonka parseri
  todistaa parse- ja round-trip-tarkistuksella
- enintään 64 KiB UTF-8-tavuja ja 64 entryä; duplicate key, invalid UTF-8,
  unknown/prototype key, `null` ja type confusion torjutaan
- `activeWorkspaceId = null` vain ilman `ready`-entryä; muulloin osoitin viittaa
  täsmälleen yhteen `ready`-entryyn eikä koskaan `recoveryRequired`-entryyn
- mainin suljetulla säännöllä johtama
  `<userData>/workspaces/<workspaceId>/`-juuri; locatoria ei tallenneta
- crash-safe `workspace-registry-v1.json`, `.next` ja `.backup` -slotit sekä
  deterministinen recovery
- keskeneräiset create/import/switch/restore-tilat vain erillisissä
  operation journaleissa
- enintään yksi active pointer ja yksi workspace per lineage.

Registry v1 ei sisällä `revision`-, `locator`-, `companyId`-, `actorId`-,
`installationId`-, `secret`-, `journal`- tai business-kenttiä. Uusi kenttä tai
suurempi resurssiraja vaatii versionoidun päätöksen.

**Luottamusraja:** renderer ei lue tai kirjoita rekisteritiedostoa eikä saa
storage locatoria. Rekisteri, renderer tai backup eivät saa antaa työtilan
absoluuttista tai suhteellista polkua. Kaikki input validoidaan suljetulla
schema- ja pituusrajalla.

**Fail-closed-tilat:** unknown version/field/state, duplicate ID/lineage,
invalid ID tai timestamp, missing derived root, corrupt current ja
ristiriitaiset recovery-slotit.

**Maintenance lease:** sama installation-scoped lease serialisoi backup-,
restore-, update- ja workspace-maintenance-operaatiot. Tavallinen snapshot tai
portable backup käyttää nykyistä aktiivista SQLite-owneria eikä avaa candidate-
kantaa. Aktiivinen backend suljetaan todistetusti ennen candidate-SQLiten
avaamista create/import/replace/adopt/switch/migration-polussa.

**Testit:** serializer/parser, atomic replacement ja restart-recovery
kirjoituksen vikapisteissä, disk-full- ja short-write-tilat, rinnakkaisten
operaatioiden fail-closed-raja, unknown-field/null/prototype/path-korpus,
duplicate identity sekä tiedostokoon, käyttöoikeuksien, symlinkin, hardlinkin
ja containmentin rajat. POSIX-oikeusraja ajetaan POSIX-ympäristössä ja
Windowsin tiedostorajaukset Windowsissa.

**W1:n aktivointiraja:** registry codec, store ja testit käyttävät vain testin
yksityisiä temp-juuria. W1:tä ei kytketä tavalliseen production-startupiin,
nykyiseen 0.2.6-profiiliin tai käyttäjän `userData`-juureen. Se ei luo
rekisteriä, siirrä profiilia, vaihda runtime-juurta, muuta backup-/secret-
polkuja eikä adoptoi legacy-profiilia. Tuotantokytkentä alkaa vasta W4:ssä.

W1-W3:n inertti workspace-lähdekoodi kuuluu tavalliseen sourceen,
typecheckiin ja testeihin, mutta se suljetaan väliaikaisesti desktopin
production-buildistä ja package-payloadista. TypeScript-buildin exclusion ei
yksin ole turvallisuusraja: application-stage artifact inventory torjuu
fail-closed-tilassa kaiken `dist/workspaces/**`-sisällön myös silloin, jos
vahingossa lisätty importti saisi TypeScriptin kääntämään exclusionin takana
olevan tiedoston. Staattinen import-raja todistaa lisäksi, ettei registryä ole
kytketty desktopin production-entrypointteihin, preloadiin, Electron E2E:n
entryyn, webiin tai backendiin. Build exclusion ja inventory-raja poistetaan
tai korvataan vasta W4:n erikseen hyväksytyssä production-compositionissa.
W1-W3 eivät muuta käyttäjän AppDataa tai normaalia startupia.

**Dokumentit:** ADR-0011:n toteutustila ja integraatiomatriisi.

**Commit/PR/release:** yksi W1-PR; ei käyttäjälle näkyvää releasea.

## W2: Empty workspace creation

**Tila:** inertti foundation toteutettu ja paikallisesti todennettu. W2 ei ole
production-compositionissa eikä käyttäjälle näkyvä ominaisuus. Aktivointi
odottaa W4:n erillistä hyväksyntää ja checkpointia.

**Omistaja:** Electron mainin workspace coordinator; backendin nykyinen
fresh-profile bootstrap rajatun portin takana.

**Muutettavat kerrokset:** `apps/desktop/src/workspaces/`-alueen yksityinen
workspace root, luontijournal, lifecycle-portit, koordinaattori ja testit.
Mahdollinen production-composition tulee vasta W4:ssä ja UI vasta W5B:ssä.

**Muuttumattomat kerrokset:** business-domain, API-sopimukset,
backup-formaatti ja installer/update.

**Sopimus:** uusi työtila syntyy candidate-rootiin, saa uuden `workspaceId`:n
ja uuden SQLite `companyId`:n, migroituu nykyiseen manifestiin ja julkaistaan
rekisteriin vasta readiness-portin jälkeen.

Tyhjän työtilan luonti etenee aina seuraavassa järjestyksessä:

1. validoi käyttäjälle näkyvä label W1:n suljetulla säännöllä
2. varaa installation-scoped `WorkspaceMaintenanceLease`
3. estää uudet aktiivisen työtilan kirjoitukset
4. sulkee aktiivisen backendin ja todistaa sen tiedostokahvat suljetuiksi
5. luo uuden `operationId`:n ja `workspaceId`:n
6. johtaa samalla levyllä olevan yksityisen candidate-rootin vain näistä
   tunnisteista
7. julkaisee `prepared`-journalin ennen candidateen kirjoittamista
8. bootstraptaa tyhjän SQLite-profiilin backendin yksityisen portin kautta
9. ajaa kaikki nykyisen manifestin migraatiot
10. todistaa täsmällisen migration chainin, integrityn ja foreign keyt
11. todistaa tuoreen `companyId`:n, `local-owner`-actorin ja profile-lineagen
12. luo työtilan auktoritatiivisen business-artifact-juuren
13. nimeää candidate-rootin atomisesti lopulliseksi työtilajuureksi
14. julkaisee uuden `ready`-entryn atomisesti W1-rekisteriin
15. varmistaa idempotentisti, että aiemmalla aktiivisella työtilalla on
    täsmälleen yksi terve runtime
16. poistaa luontijournalin vasta terminal-tilassa ja vapauttaa leasen.

Jos rekisterissä on jo aktiivinen `ready`-työtila, osoitin ei muutu. Jos
rekisterissä ei ole yhtään `ready`-työtilaa, ensimmäinen uusi työtila saa
aktiivisen osoittimen, mutta W2 ei vielä käynnistä sitä. Samat labelit ovat
sallittuja; workspace-, company- ja lineage-identiteetit ovat aina erilliset.

Workspace coordinator varaa installation-scoped `WorkspaceMaintenanceLease`-
leasen ennen candidate-SQLiten avaamista. Aktiivinen backend ja kaikki sen
SQLite-kahvat suljetaan ensin, joten asennuksessa on myös maintenance-vaiheen
aikana enintään yksi business-SQLite-omistaja.

W2:n nimetyt ja kapeat portit ovat:

- `WorkspaceMaintenanceLease`
- `ActiveWorkspaceLifecyclePort`
- `WorkspaceRuntimeAbsencePort`
- `WorkspaceRegistryPort`
- `EmptyWorkspaceBootstrapPort`
- `WorkspaceCreationJournalStore`
- `EmptyWorkspaceCreationCoordinator`.

Lease-, runtime-lifecycle- ja registry-portit ovat neutraaleja workspace-
sopimuksia eivätkä creation-moduulin omistamia. Creation mapittaa niiden
virheet omiin suljettuihin virhekoodeihinsa. Jos quiesce epäonnistuu ennen
kirjoitusten pysäyttämistä, runtimea ei käynnistetä uudelleen. Kun quiesce on
onnistunut, jokainen myöhempi failure-polku käyttää idempotenttia
`ensurePreviousWorkspaceRunning`-operaatiota. Se hyväksyy jo terveen runtimen
mutta ei saa käynnistää rinnakkaista backendia; epäonnistuminen johtaa
`WORKSPACE_CREATION_RECOVERY_REQUIRED`-tilaan.

Electron main ei avaa SQLitea eikä tuo `better-sqlite3`:a. Bootstrap-portti
saa mainin johtaman candidate-profiilijuuren ja rajatun teknisen kontekstin.
Se palauttaa vain suljetun readiness-tuloksen: nykyinen migration chain,
integrity/FK-status, bootstrap-actor, tuore company-identiteetti, profile-
lineage ja todistus suljetuista kahvoista. SQLite-kahvaa, runtime-sessionia,
raakaa virhettä tai business-dataa ei palauteta.

### W2:n storage layout

Lopullinen juuri on aina:

`<userData>/workspaces/<workspaceId>/`

Candidate on samalla volumeella installation-owned operaatiojuuressa:

`<userData>/workspace-operations/<operationId>/<workspaceId>/`

Candidate säilyttää nykyisen profiilin sisäisen rakenteen:

- `runtime/data/eky.sqlite`
- `runtime/storage/invoices/`
- vain erikseen hyväksytyt workspace recovery/restore -juuret.

Candidate ei sisällä update-journalia, package cachea, accepted-build-
metadataa, diagnostiikkaa, operational-lokeja, support bundlea tai release-
artifacteja. Main johtaa kaikki polut. Canonical containment, private root,
symlink/reparse- ja hardlink-raja, olematon final-root sekä same-volume atomic
rename todistetaan ennen julkaisua.

### WorkspaceCreationJournalV1

W2 käyttää omaa tarkasti nimettyä luontijournalia, ei geneeristä operation-
frameworkia. Journalissa ovat täsmälleen:

- `formatVersion`
- `operationId`
- `workspaceId`
- validoitu `workspaceLabel`
- `previousActiveWorkspaceId`
- monotoninen `state`
- `createdAt`
- bootstrapin jälkeen validoitu `lineageIdentity`.

Tilat etenevät vain järjestyksessä `prepared`, `candidateRootCreated`,
`bootstrapCompleted`, `candidateValidated`, `rootPublished` ja
`registryPublished`. Journalissa ei ole polkuja, companyId:tä, actorId:tä,
SQL:ää, sessionia, salaisuuksia, raakaa virhettä, stackia tai business-dataa.
Codec on exact-key, kokorajoitettu ja torjuu duplicate/prototype/unknown-
avaimet. Store käyttää W1:n tavoin current/next/backup-slotteja, yksityisiä
oikeuksia ja atomista vaihtoa.

Restart-recovery sovittaa journalin, filesystemin ja rekisterin toisiinsa:

- ennen rootin julkaisua keskeneräinen candidate poistetaan turvallisesti
- jos final-root on julkaistu mutta journal ei edennyt, root validoidaan ja
  registry-publish jatketaan idempotentisti
- jos registry-entry on julkaistu mutta journal ei edennyt, entry, root ja
  lineage validoidaan ennen terminal-tilaa
- ristiriitainen final-root, entry, lineage tai journal johtaa
  `recoveryRequired`-/fail-closed-tilaan eikä arvaavaan cleanupiin
- julkaistu työtilajuuri validoidaan vain, kun
  `WorkspaceRuntimeAbsencePort` todistaa, ettei aktiivista workspace-runtimea
  ole käynnissä; aktiivinen tai tuntematon tila pysäyttää recoveryn ennen
  backendin tai SQLite-kahvan avaamista
- aiemmalle aktiiviselle työtilalle varmistetaan täsmälleen yksi terve runtime
  vasta candidate-kahvojen sulkeutumisen jälkeen.

**Luottamusraja:** label on käyttäjän syöte; polku ja identiteetit ovat mainin
luomia. Renderer ei saa päättää initial companyId:tä.

**Fail-closed-tilat:** lease, rootin luonti, bootstrap, migration,
integrity/FK, identity, lineage, shutdown, restart, atomic rename, journal,
registry publish, disk/short-write tai turvallinen cleanup epäonnistuu.
Candidate poistetaan vain, kun omistajuus ja tila voidaan todistaa; muuten se
karanteenoidaan tai operaatio jää `recoveryRequired`-tilaan. Aiempi registry,
aktiivinen työtila ja sen profiilitavut eivät muutu failure-polussa.

**Testit:** toteutetut kohdetestit kattavat ensimmäisen ja toisen tyhjän
työtilan, samat labelit, eri workspace/company/lineage-identiteetit,
aktiivisen osoittimen säännöt, nimetyt failure- ja crash-pisteet,
ID-törmäykset, symlink/reparse/containment-rajat, byte-identtisen aiemman
registryn ja profiilin failure-polussa sekä restart-recoveryn. Staattiset
rajatestit todistavat, ettei W2 vuoda production-entrypointteihin tai tuo
SQLite-ajuria Electron mainiin. System-E2E bootstraptaa aidosti tuoreen
yksityisen profiilin oikealla backend-prosessilla, ajaa nykyiset migraatiot,
todistaa kahvojen ja loopback-portin sulkeutumisen ja tarkastaa julkaistun
profiilin backendin nykyisellä trusted inspectorilla ilman testi-HTTP-reittiä
tai Electron mainin SQLite-avausta.

**Aktivointiraja:** W2-lähdekoodi pysyy W1:n production-build exclusionin,
package inventory -kiellon ja staattisen import-rajan takana. Se ei muuta
startupia, mainia, preloadia, IPC:tä, rendereriä, UI:ta, AppDataa, normaalia
profiilia tai release-käyttäytymistä.

**Dokumentit:** workspace storage layout, journal/recovery ja bootstrap-
lifecycle tässä suunnitelmassa sekä ADR-0011:n maintenance-raja.

**Commit/PR/release:** yksi W2-PR; ei vielä käyttäjälle näkyvää releasea.

### W2.1: Shared contracts and lifecycle hardening

**Tila:** toteutettu inerttinä kovennuksena ennen W3:a; production-
aktivointia, preloadia, IPC:tä, UI:ta tai HTTP-sopimusta ei lisätty.

W2.1 siirtää maintenance lease-, active runtime lifecycle- ja registry-portit
niiden neutraaleihin workspace-omistajiin. Creation saa käyttää portteja,
mutta neutraalit sopimukset eivät saa importata creation-moduulia.

Partial-stop-sopimus erottaa quiesceä edeltävän failure-polun kaikista
quiescen jälkeisistä poluista. Quiescen jälkeen aiemman runtimen terveys
varmistetaan myös osittaisen stopin, identiteetin luonnin, journalin,
bootstrapin ja cleanupin virheissä. Testeissä backend- ja SQLite-ownerien
enimmäismäärä pysyy yhdessä.

Startup-recovery käyttää erillistä `WorkspaceRuntimeAbsencePort`-sopimusta
ennen julkaistun työtilan yksityistä validointia. Sopimus ei ole yleinen
prosessilistauscapability eikä palauta PID:iä, komentoriviä tai prosessitietoa
rendererille.

### W1/W2 persistence reuse -audit

W1-rekisterin ja W2-luontijournalin toteutuksissa on tarkoituksellista,
täsmällistä toistoa seuraavissa turvallisuusmekanismeissa:

- private directory- ja regular-file-tarkistukset, symlink/reparse- ja
  hardlink-rajat sekä avatun tiedoston identiteetin uudelleentarkistus
- `current`, `next` ja `backup` -slotit, exclusive next-writer, fsync,
  atomiset rename-vaiheet ja deterministinen restart-recovery
- bounded UTF-8 JSON -luku, duplicate-key-torjunta ja canonical round-trip.

Semantiikaltaan eri vastuuta ovat tiedostonimet ja polkujen containment,
64 KiB registry- ja 16 KiB journalirajat, skeemat, canonical serializerit,
registry-validointi, journalin monotoninen state machine, operation-kohtaiset
remove/discard-ehdot sekä moduulikohtaiset virheet. Näitä ei yhdistetä.

W3 ei kopioi koko current/next/backup- ja filesystem-toteutusta kolmatta
kertaa. Jos W3:n toteutuksessa osoitetaan todellinen tarve, yhteiseksi voidaan
erottaa vain kapea, turvallinen atomic-slot-primitive omalla hyväksytyllä
vastuullaan. Import-journalin schema, state machine, serializer, validointi,
resurssirajat ja virheet pysyvät W3:n omistuksessa. Geneeristä JSON manageria,
operation frameworkia, base storea tai persistence manageria ei luoda.
Nykyistä W1/W2 persistenceä ei refaktoroida ennen W3:a ilman suoraa
turvallisuusvikaa ja erillistä rajattua päätöstä.

## W3: Import backup as new workspace

**Tila:** toteutettu inerttinä foundationina. Koordinaattori, kahden vaiheen
backup-tarkastus, private candidate, forward-migraatio, täysi validointi,
atominen root- ja registry-julkaisu sekä restart-recovery on toteutettu ja
todistettu unit-, fault-, recovery-, security- ja system-E2E-testeillä.
Production-compositionia, preloadia, IPC:tä, UI:ta tai julkista HTTP-reittiä
ei ole lisätty. W3b on toteutettu erillisenä inerttinä foundationina; W4:n
production-kytkentä on edelleen toteuttamatta.

**Omistaja:** Profile Protection / Backup / Restore yhdessä workspace
coordinatorin kanssa. Backup inspector säilyy backup-formaatin omistajana.

**Muutettavat kerrokset:** desktop backup/import-application service,
workspace candidate composition ja testit.

W3 saa käyttää neutraaleja `WorkspaceMaintenanceLease`-,
`ActiveWorkspaceLifecyclePort`-, `WorkspaceRuntimeAbsencePort`- ja
`WorkspaceRegistryPort`-sopimuksia. Se ei saa käyttää creation-journalin
schemaa, state machinea tai virheitä import-operaation mallina.

**Muuttumattomat kerrokset:** `.ekybackup` v1, kryptografia, business-schema,
HTTP/API ja nykyinen same-lineage restore.

**Sopimus:** autentikoitu backup, jonka lineagea ei ole rekisterissä, tuodaan
uutena työtilana private staging -> forward migration -> full validation ->
atomic root publish -> atomic registry publish -ketjulla. W3 on inertti
foundation: sitä ei kytketä production-compositioniin, preloadiin, IPC:hen,
rendereriin, webiin tai julkiseen backend-HTTP:hen.

Import hankkii installation-scoped `WorkspaceMaintenanceLease('import')`-
leasen ennen backupin autentikointia. Se torjuu ratkaisemattoman import-
journalin ja siivoaa W3:n tunnetut stale plaintext-payloadit ennen uuden
backupin lukemista. Candidate avataan vain saman
`WorkspaceMaintenanceLease`-
leasen aikana ja aktiivisen business-SQLite-omistajan sulkeutumisen jälkeen.
Failure sulkee candidate-kahvat ennen aiemman aktiivisen runtimen
uudelleenkäynnistystä.

### W3:n omistajuus ja elinkaari

- Backup inspector omistaa `.ekybackup` v1 -containerin autentikoinnin,
  kryptografian, suljetun manifestin ja payload-rajojen tarkastuksen.
- Workspace import coordinator omistaa operaation järjestyksen ja vain sen.
- Registry omistaa rekisterin validoinnin ja atomisen julkaisun.
- Workspace runtime/lifecycle omistaa aktiivisen backendin ja SQLite-
  kahvojen sulkemisen sekä aiemman runtimen palauttamisen.
- Backendin yksityinen import-bootstrap-/inspection-portti omistaa SQLite-
  migraatiot, integrityn, foreign keyt, identiteetin ja business-artifactien
  tarkastuksen. Electron main ei importoi SQLite-ajuria eikä avaa kantaa.

Koordinaattori etenee ADR-0011:n suljetussa järjestyksessä.
Ensimmäinen tarkastus autentikoi containerin ja lukee manifestin ilman
SQLitea. Leasen ja aktiivisen runtimen sulkemisen jälkeen tehtävä toinen
tarkastus purkaa candidateen ja todistaa container-SHA:n, `profileId`:n sekä
migration chain -identiteetin samoiksi. Vasta sitten backend saa avata
candidate-SQLiten ja ajaa puuttuvat forward-migraatiot.

Tuonnissa ei käytetä nykyisen aktiivisen profiilin preRestore-pistettä,
restore activation journalia tai active-profile replace -palvelua. W3 ei
yhdistä rivejä, korvaa olemassa olevaa työtilaa eikä käynnistä uutta
workspace-runtimea.

### W3 plaintext quarantine

W3 omistaa yhden kapean installation-scoped plaintext-karanteenin polulla
`<userData>/workspace-operations/workspace-import-plaintext-quarantine/`.
Renderer, backup, registry, workspace-label tai business-identiteetti eivät
anna sen polkua tai tiedostonimeä. Karanteeni hyväksyy vain canonical lowercase
UUID v4 -nimet muodossa `workspace-import-<uuid>.payload`, tavallisen rajatun
yhden linkin tiedoston, yksityiset oikeudet ja täsmällisen canonical
containmentin.

Normaali decrypt-polku luo payloadin exclusive-create-säännöllä ja poistaa sen
odotetussa `finally`-polussa. W3-recovery validoi ja poistaa tunnetut stale-
payloadit heti maintenance-leasen jälkeen myös ilman import-journalia. Se ei
avaa SQLitea tätä varten. Tuntematon entry, hakemistoksi naamioitu payload,
symlink, reparse point, hardlink, ylikokoinen tiedosto tai epäselvä juuri
johtaa `recoveryRequired`-tilaan eikä arvaavaan poistoon. Karanteeni ei kuulu
registryyn, portable backupiin, candidateen tai lopulliseen workspace-rootiin.

Tämä recovery-polku on W3:n inerttiä lähdekoodia. Sitä ei ole vielä kytketty
production-startupiin, packageen, preloadiin, IPC:hen tai UI:hin.

### WorkspaceBackupImportJournalV1

Import-journalin täsmällinen v1-muoto sisältää vain:

- `formatVersion: 1`
- `operationId`
- `workspaceId`
- validoidun `workspaceLabel`-arvon
- `previousActiveWorkspaceId: string | null`
- monotonisen `state`-arvon
- canonical UTC `createdAt`-arvon
- `lineageIdentity`, joka on `null` ennen täyttä validointia.

Sallitut tilat järjestyksessä ovat:

1. `prepared`
2. `candidateRootCreated`
3. `backupStaged`
4. `candidateMigrated`
5. `candidateValidated`
6. `rootPublished`
7. `registryPublished`.

Codec torjuu unknown- ja duplicate-keyt, prototype-avaimet, väärän version,
ylikokoisen tai invalidin UTF-8:n ja ei-kanonisen rakenteen. Store käyttää
crash-safe current/next/backup-slotteja ja yhtä kirjoittajaa. Journalin
schema, serializer, tilasiirtymät, kokoraja ja virheet kuuluvat importille,
vaikka raakatavujen atominen slot-kirjoitus jaetaan W1/W2/W3:n kesken.

Journalissa ei ole backup-polkua, salasanaa, avainta, `companyId`:tä,
`actorId`:tä, SQL:ää, business-dataa, PDF-nimiä, runtime-sessionia,
salaisuutta tai raakaa `Error`-arvoa.

### W3 restart-recovery

- Recovery hankkii `import`-leasen ja ratkaisee plaintext-karanteenin ennen
  import-journalin lukemista sekä ennen `nothingToRecover`-tulosta.
- Ennen `rootPublished`-tilaa keskeytynyt import sulkee mahdolliset private-
  kahvat, poistaa tai fail-closed-karanteenoi candidaten ja poistaa journalin.
  Operaatiota ei jatketa ilman käyttäjän uudelleen valitsemaa backupia ja
  salasanaa.
- `rootPublished` ennen `registryPublished`-tilaa vaatii runtimen poissaolon,
  lopullisen rootin täyden identity-, migration-, SQLite- ja artifact-
  validoinnin sekä uuden duplicate-lineage-tarkastuksen ennen registry-
  julkaisua.
- `registryPublished`-tila vaatii entryn, rootin ja lineagen täsmällisen
  vastaavuuden. Aktiivinen osoitin säilytetään tai asetetaan ensimmäiseen
  ready-entryyn sovitun säännön mukaan, minkä jälkeen journal voidaan poistaa.
- Puuttuva tai ristiriitainen journal, root, registry-entry tai lineage jää
  `recoveryRequired`-tilaan. Recovery ei arvaa eikä tarvitse lähdebackupia tai
  salasanaa.

**Luottamusraja:** backup ja salasana ovat ulkoisia syötteitä. Main omistaa
Open-dialogin; renderer ei saa tiedostopolkua tai salasanaa.

**Fail-closed-tilat:** väärä salasana, unknown format, future/changed/missing-
middle migration, duplicate lineage, invalid SQLite/artifact/identity,
levytila tai publish failure.

**Testit:** nykyinen synteettinen backup-korpus, historical prefix, PDF:t,
tyhjä artifact-katalogi, duplicate lineage molemmissa tarkistuspisteissä,
jokaisen journal-vaiheen restart, normaalin ja kaatumisesta jääneen plaintext-
payloadin cleanup, unknown-entryn fail-closed-torjunta, salaisuuksien poissulku,
cross-workspace isolation, lähdecontainerin muuttuminen tarkastusten välissä,
future/changed/reordered/missing-middle-historia, filesystem-boundaryt sekä
enintään yksi backend/SQLite-owner ja nolla orphan-prosessia. Oikeaa backupia,
salasanaa, AppData-profiilia tai business-dataa ei käytetä.

**Dokumentit:** backup-planin multi-workspace-osuus ja restore-runbook.

**Commit/PR/release:** yksi W3-PR; ei vielä user releasea.

## W3b: Replace existing workspace from same-lineage backup

**Tila:** toteutettu inerttinä foundationina. Koordinaattori, exact-lineage-
raja, workspace-kohtaiset polut, nykyisen restore activation transactionin
käyttö, byte-identtinen rollback ja todelliseen salattuun backupiin perustuva
system-E2E-todiste ovat valmiit. Polkua ei ole kytketty production-
compositioniin, preloadiin, IPC:hen, UI:hin, paketoituun sovellukseen tai
käyttäjän AppData-profiiliin. Tämä kytkentä kuuluu W4:n erilliseen vaiheeseen.

**Omistaja:** Profile Protection / Backup / Restore; coordinator lukitsee
kohdetyötilan ja aktivoinnin.

**Muutettavat kerrokset:** restore target resolution, workspace-scoped
recovery point, activation journal ja testit.

**Muuttumattomat kerrokset:** backup container, business-domain ja muiden
työtilojen data.

**Sopimus:** ensimmäisessä versiossa vain aktiivinen työtila ja exact lineage
saavat osallistua korvaukseen. Passiiviseen kohdetyötilaan vaihdetaan ensin
hallitulla switchillä. Korvaus on installation-scoped maintenance-leasen
takana tehtävä snapshot + staging + forward migration + validation + atomic
replace, ei taulu- tai tietuemerge.

Nykyisen restore-moottorin auditin perusteella
`ProfileRestoreActivationTransaction` on jo sidottavissa constructorissa
annettuihin aktiivisen tietokannan, artifact-juuren, stagingin, rollbackin,
failed-rootin ja activation journalin polkuihin. W3b käyttää tätä samaa
transactionia ja `ProfileRestoreStartupRecovery`-recoveryn tilakonetta
workspace-kohtaisilla poluilla. W3b ei luo rinnakkaista rollback-journalia,
activation transactionia tai tiedostonsiirtomoottoria.

Legacy-`ProfileRestoreStagingService` ja `ProfileRestoreActivationService`
säilyvät yhden aktiivisen legacy-profiilin composition-palveluina. Niiden
active-profile-, relaunch- tai tyhjän profiilin oletuksia ei kopioida W3b-
koordinaattoriin. Backup-containerin autentikointi sekä candidate-SQLiten
migraatio-, identity-, integrity-, foreign key- ja artifact-validointi
käyttävät W3:n nykyisiä kapeita portteja.

**Luottamusraja:** käyttäjä valitsee rekisteristä workspaceId:n; main todistaa
lineagen. Label, nimi tai Y-tunnus eivät oikeuta korvausta.

Ensimmäisen version exact-lineage-raja vaatii samanaikaisesti:

- registry on täysin validoitu ja kohdetyötila on `ready`
- `targetWorkspaceId === activeWorkspaceId`
- autentikoidun backupin `profileId` täsmää target-entryn lineage-
  `profileId`:hen
- registryssä on täsmälleen yksi entry kyseiselle lineagelle
- yksikään update-, import-, create-, switch-, restore- tai muu workspace-
  maintenance-operaatio ei ole ratkaisematta.

Nämä ehdot todistetaan ennen kirjoituksia ja uudelleen maintenance-leasen
saamisen jälkeen ennen runtimen pysäyttämistä. Registry-entry, workspaceId,
label, `createdAt`, lineage ja active pointer säilyvät byte-identtisinä.

**Fail-closed-tilat:** wrong lineage, duplicate lineage registryssä,
pre-restore failure, invalid staging, activation/rollback failure ja
`recoveryRequired`.

Suljettu suoritusjärjestys on: targetin ja operation-tilan validointi,
backupin autentikointi, exact-lineage-todistus, `replace`-lease, registry-
revalidointi, kirjoitusten quiesce, workspace-scoped preRestore-piste nykyisen
snapshot-brokerin ja SQLite-ownerin ollessa vielä hallitusti käytössä,
runtimen ja SQLite-kahvojen sulkeminen, runtime-absence, yksityinen staging,
forward-migraatiot, täydellinen validointi, nykyisen activation journalin
kirjoitus, atominen aktivointi, saman workspacen uusi runtime-session,
health/identity/artifact-validointi, transactionin hyväksyntä ja cleanup.
Virheessä sama activation transaction palauttaa vanhan tietokannan ja PDF-
artifact-juuren ennen vanhan runtimen terveeksi todistamista.

Korvaus käsittelee vain portable business snapshotia. SMTP-salaisuus,
safeStorage/DPAPI-envelope, ulkoisen PDF-arkiston root ja retry-journal,
update/cache-tila, operational-lokit, diagnostiikka sekä muiden workspacejen
palautuspisteet eivät kuulu stagingiin, aktivointiin tai rollbackiin.

**Testit:** same-lineage success, historical-prefixin forward-migraatio,
wrong-lineage deny ilman writeä, nimen tai Y-tunnuksen kelpaamattomuus
oikeutukseksi, inactive/recovery/duplicate-lineage-torjunnat, väärä salasana,
muuttunut container, vanhan datan poistuminen ilman mergeä, backupin datan ja
PDF:n palautuminen, device-local-tiedostojen jatkuvuus, keskeytys jokaisessa
activation journal -vaiheessa, byte-identtinen rollback sekä muiden
työtilojen ja lähdebackupin hashien muuttumattomuus. System-E2E käyttää oikeaa
salattua backup-containeria, SQLitea, migraatioita ja PDF-artifactia, mutta
inertin foundationin runtime-lifecycle-portti on synteettinen; oikea Electron-
prosessikytkentä todistetaan vasta W4:ssä.

**Dokumentit:** backup- ja recovery-runbook.

**Commit/PR/release:** yksi W3b-PR; ei user releasea.

## W4: Controlled workspace switch and legacy adoption

**Omistaja:** Electron mainin workspace coordinator.

**Muutettavat kerrokset:** desktop runtime composition, backend process
lifecycle, runtime-session, workspace-bound adapter composition, active
pointer journal ja 0.2.6 adoption.

**Muuttumattomat kerrokset:** domain, business API:n semantics, backup-format,
installer/update state ja cloud/mobile.

**Sopimus:** ADR-0011:n 12-vaiheinen switch sekä copy -> validate -> atomic
switch -adoptio nykyiselle 0.2.6-profiilille.

Main-owned build admission suoritetaan ennen workspace-ratkaisua ja ennen
adoption ensimmäistä filesystem-sivuvaikutusta. Initial install, exact
accepted build, valtuutettu newer build ja update-journalin täsmällinen target
ovat suljettuja hyväksymisluokkia. Same-version/different-revision, downgrade
ja mixed/unknown update identity pysähtyvät ennen adoption journalia,
candidatea, final-rootia tai registryä.

**Luottamusraja:** vain trusted main frame voi pyytää switchiä. Main hyväksyy
vain registryssä olevan workspaceId:n. Vanha session, backend, DB-kahvat ja
adapterit eivät saa selvitä vaihdosta.

**Fail-closed-tilat:** in-flight operation, unresolved update/restore,
shutdown failure, handle leak, candidate health/identity failure, pointer
failure, rollback failure ja `recoveryRequired`.

**Testit:** A -> B -> A, vanha session deny, concurrent switch deny,
write-in-flight, PDF window, secret namespace, archive config/journal,
backup/recovery scope, restart jokaisessa journal-vaiheessa, 0.2.6 adoption
kahdesti, same-version/different-revision ilman adoption sivuvaikutuksia,
julkaisemattoman keskeytyneen candidate/final-adoption täsmällinen cleanup ja
relaunch, enintään yksi business-SQLite-owner ja 0 orphan-processia.

W4 kytkee myös workspace-kohtaisen PDF-arkiston: käyttäjän valitsema juuri
säilyy device-local-asetuksena ja main kirjoittaa vain johdettuun
`<archiveRoot>/<workspaceId>/`-alikansioon. Samannimiset laskut eivät törmää
työtilojen välillä eikä asetusta tai ulkoisia kopioita siirretä backupissa.

**Dokumentit:** desktop implementation plan, update-planin per-workspace first
start ja operational runbook.

**Commit/PR/release:** W4 voidaan jakaa registry switch- ja legacy adoption
-PR:iin, jos kumpikin pysyy itsenäisesti suljettuna. Ei user releasea ennen
W5B-W6:ta.

**Toteutustila:** W4:n production-runtime on toteutettu. Electron main
ratkaisee aktiivisen workspacen ennen runtime-sessionia ja backendia, adoptoi
vanhan yhden profiilin datan copy -> validate -> atomic publish -ketjulla
enintään kerran ja sitoo business-SQLiten, lasku-PDF:t, snapshotit,
salaisuudet, PDF-arkiston asetuksen ja journalin sekä backup/recovery-tilan
aktiiviseen workspace-rootiin. Operational-lokit, tukipaketit, update state ja
packaged smoke säilyvät installation-scoped-tilana. PDF-arkistokopio johdetaan
aina `<archiveRoot>/<workspaceId>/`-alikansioon.

W4:n switch-koordinaattori ja recovery-sopimukset on todennettu
kohdetesteillä, mukaan lukien A -> B -> A, vanhojen runtime-omistajien
sulkeminen ja adoption idempotenssi. Käynnistys hyväksyy build-identiteetin
ennen workspace-sivuvaikutuksia. Keskeytyneen legacy-adoption recovery poistaa
vain journalista täsmällisesti johdetun, julkaisemattoman ja legacy-lähteen
kanssa byte-identtiseksi kahdesti todistetun candidate- tai final-kopion.
Turvaton, julkaistu, muuttunut tai tuntematon tila jää fail-closed-tilaan.
Rendererille ei ole lisätty workspace-
capabilitya eikä UI:ta; ne kuuluvat W5B:hen. W5A rakentaa niitä ennen vain
main-prosessin sisäisen hallinta- ja lifecycle-foundationin. Aktiivisen ja
passiivisen workspacen N -> N+1 -migraatio sekä koko packaged multi-workspace
-matriisi kuuluvat edelleen W6:een.

Jo aktiivisen työtilan valinta on idempotentti no-op, joka ei sulje runtimea
eikä käynnistä sovellusta uudelleen.

## W5A: Main-owned workspace management foundation

**Omistaja:** Electron main. Tämä vaihe ei avaa capabilitya rendererille.

**Muutettavat kerrokset:** mainin sisäinen management service, production-
lifecycle-adapteri, private candidate backend -adapterit, registry-labelin
rename sekä yhteinen installation-scoped maintenance lease.

**Muuttumattomat kerrokset:** preload, IPC, renderer, web, backendin julkinen
HTTP-API, schema, migraatiot, backup-formaatti, domain ja permission-malli.

**Sisäiset käyttötapaukset:** rajattu status, tyhjän workspacen luonti,
backup-import uutena, aktiivisen exact-lineage-workspacen korvaus, switch ja
labelin rename. Poisto ei kuulu W5A:han.

**Luottamusraja:** hallintapalvelu saa palauttaa vain validoidun status-
projektion sekä workspacen opaque tunnisteen, labelin, aktiivisuuden ja
saatavuuden. Polut, `companyId`, lineage, runtime-session, secret ref,
journalit, operationId, backup-sisältö ja raakavirheet eivät kuulu sopimukseen.

**Lifecycle:** create/import/replace/switch-koordinaattorit varaavat yhteisen
maintenance leasen itse. Backup, restore ja update käyttävät samaa main-owned
auktoriteettia omien moduulikohtaisten vartijoidensa lisäksi. Main ei avaa
SQLitea; private utility backend omistaa bootstrapin, migraatiot ja
validoinnin. Runtimeen sidotut resurssit suljetaan ja niiden poissaolo
todistetaan ennen omistajuuden vaihtoa.

**Testit:** status-parseri ja vuotokielto, create/import/replace/switch/rename,
ristiriidat kaikkien maintenance-tarkoitusten kanssa, exact-lineage,
registry/pointer-byte-identtisyys, runtime-sessionin kierto, yksi backend ja
SQLite-owner sekä nolla orphan-prosessia. Production-adapterien integraatio
käyttää vain synteettistä private userData -juurta.

**Commit/PR/release:** W5A on oma sisäinen feature-checkpoint. Sitä ei kuvata
käyttäjälle valmiina multi-workspace-toimintona eikä siitä nosteta versiota.

**Toteutustila:** valmis ja paikallisesti hyväksytty. Production-composition
käyttää yhtä main-owned maintenance lease- ja active workspace lifecycle
-instanssia. Status/create/import/replace/switch/rename on todennettu
kohdetesteillä sekä Electron composition proofilla, joka käyttää vain
synteettistä private userData -juurta ja private utility -candidateja. Proof
todentaa nykyisen desktop-version, lopullisen registry-tilan, täsmällisen yhden
relaunchin switchissä, enintään yhden mallinnetun backend- ja SQLite-ownerin
sekä sen, ettei proofin käynnistämiä utility-prosesseja jää eloon. Preloadia,
IPC:tä, renderer-capabilitya, web-UI:ta tai julkista backend-reittiä ei lisätty.
Täysi usean workspacen packaged isolation/update/recovery -todistus jää W6:een.

## W5B: Trusted workspace capability and UI

**Omistaja:** web feature paikallisen desktop-capabilityn päällä. Electron main
omistaa kaikki privileged toiminnot.

**Muutettavat kerrokset:** webin workspace-näkymä, i18n, preload-allowlist ja
rajattu trusted main frame -IPC. Backend business API ei saa
workspace-hallintareittejä.

### W5B.1: Selector, create, import, switch and rename

**Tila:** toteutettu ja paikallisesti hyväksytty 20.8.2026.

**Käyttäjäpolut:** listaa turvalliset labelit, luo tyhjä workspace, tuo
salattu backup uutena workspacena, vaihda työtila ja nimeä label uudelleen.
Valitsin sijaitsee sivupalkin vasemmassa yläkulmassa ja toimii myös sivupalkin
ollessa supistettu. Poisto- tai replace-toimintoa ei näytetä.

**Luottamusraja:** UI saa workspaceId:n vain capability-vastauksesta. Viisi
versionoitua capability-kutsua hyväksytään vain tunnetun pääikkunan main
framesta täsmällisellä argumentti- ja avainsopimuksella. UI ei
saa polkua, companyId:tä, lineagea, secret refiä tai journalia. Backupin
valinta ja salasana pysyvät Electron mainin omistamissa native-ikkunoissa.
Selainkehitys säilyttää turvallisen yhden workspacen fallbackin ilman
desktop-capabilitya.

**Fail-closed-tilat:** capability puuttuu webissä, invalid selection,
operation conflict, native confirmation cancel, switch/import failure ja
recoveryRequired. Viestit ovat turvallisia suomenkielisiä i18n-tekstejä.

**Testit:** preload/IPC-allowlist, trusted main frame, subframe/foreign frame
-torjunta, exact argumentit ja input-avaimet, web ilman capabilitya,
keyboard/focus, loading/error, double click, cancellation, duplicate label,
failed switch, UI reload ja vanhan workspace-datan katoaminen näkymästä.
Electron-E2E todistaa A -> B -> A -eristyksen asiakkailla, laskuilla ja
PDF-hasheilla sekä oikean salatun backupin tuonnin ja file/password-cancel-
polut ilman polun, salasanan, companyId:n, lineagen, sessionin tai journalin
vuotoa.

**Lifecycle:** switch ja onnistunut import johtavat main-owned relaunchiin.
Vanha renderer, runtime-session, backend ja SQLite-owner eivät jatka uuden
aktiivisen workspacen kanssa.

### W5B.2: Replace active workspace

**Tila:** toteutettu ja hyväksytty erillisenä W5B.2 UI/capability/Electron-E2E-
checkpointina. W5A:n sisäinen exact-lineage replace-palvelu, Electron mainin
capability-raja ja webin varoituspolku muodostavat yhden käyttötapauksen. W6:n
packaged pilot- ja release-portti on edelleen avoin.

W5B.2 sallii vain aktiivisen `ready`-työtilan korvaamisen saman lineagen
aiemmasta Eky-varmuuskopiosta. Yrityksen nimi, Y-tunnus, workspace-label tai
muu business-arvo eivät ole identiteettitodisteita. Renderer ei valitse
kohdetyötilaa eikä saa backup-polkuja, salasanaa, `companyId`:tä, lineagea,
runtime-sessionia, journalia tai raakavirhettä.

Käyttäjäpolku on kaksivaiheinen:

1. web-näkymä kertoo aktiivisen workspacen labelin, exact-lineage-vaatimuksen,
   preRestore-palautuspisteen ja hallitun uudelleenkäynnistyksen sekä pyytää
   käyttäjää jatkamaan tiedoston valintaan
2. Electron main valitsee `.ekybackup`-tiedoston, käyttää nykyistä
   salasanakontrolleria ja näyttää viimeisen native-varoituksen, jossa
   turvallinen oletus on aina peruuttaminen.

IPC-sopimus on versionoitu, nolla-argumenttinen ja hyväksytään vain tunnetun
pääikkunan main framesta. Electron main johtaa aktiivisen `workspaceId`:n
omasta turvallisesta statuksestaan ja kutsuu nykyistä
`replaceActiveFromBackup`-käyttötapausta. Tiedoston valinnan, salasanan tai
native-vahvistuksen peruminen ei saa muuttaa registryä, journalia tai runtimea.
Onnistunut korvaus ja onnistunut rollback päättyvät main-owned hallittuun
uudelleenkäynnistykseen; renderer ei yritä päivittää vanhaa runtimea.

UI näyttää toiminnon erillisenä ylläpito- ja varoitusalueena vain, kun desktop-
capability on käytettävissä, privileged-operaatio ei ole käynnissä ja
aktiivinen workspace on `ready`. Toiminto ei ole workspace-rivin action eikä
avaa passiivisen workspacen korvausta. Workspace-poisto ei kuulu W5B.2:een.

Testit kattavat trusted-main-frame-rajan, exact argumentit, suljetut DTO:t,
file/password/native-confirm-cancelit, väärän lineagen, activation- ja
rollback-faultit, hallitun relaunchin sekä polun, salasanan, lineagen,
companyId:n, sessionin ja journalin vuotamattomuuden.

W5B.2:n Electron-E2E-todiste käyttää yhtä auktoritatiivista synteettistä
lineagea legacy-adoptionissa, aktiivisessa registry-entryssä ja salatussa
backupissa. Se kattaa exact-lineage-korvauksen, väärän lineagen torjunnan sekä
native file-, password- ja final confirmation -peruutukset. Väärän lineagen
torjunta todistaa lisäksi, että korvausyrityksen jälkeen luotu aktiivisen
workspacen marker-data säilyy muuttumattomana.

**Commit/PR/release:** W5B on erillinen UI/capability-checkpoint. Ensimmäinen
release candidate voidaan nimetä vasta W6:n hyväksymisportin jälkeen.

## W6: E2E, packaged pilot and 0.2.6 -> 0.2.7 gate

**Omistaja:** E2E/test infrastructure sekä release process. Tuotantokoodia ei
korjata suoraan release-portin sisällä ilman paluuta omistavaan checkpointiin.

**Muuttuvat kerrokset:** testit, fixturet, CI-portit, release-dokumentaatio ja
erillinen lopullinen versionostocommit.

### W6A.1: Read-only migration inventory

W6A.1 on first-start-orchestraatiota edeltävä sivuvaikutukseton checkpoint.
Electron main lukee strictin registry v1:n, valitsee vain `ready`-entryt ja
johtaa niiden workspace-polut nykyisen main-owned path policyn kautta.
Yksityinen backend utility tarkastaa työtilat yksi kerrallaan aidosti read-only-
yhteydellä. Main ei avaa SQLitea, eikä samanaikaisia utility- tai SQLite-
ownereita sallita.

Jokainen tarkastettu työtila luokitellaan vain tilaan `current`,
`compatiblePending` tai `invalidHistory` ADR-0011:n määritelmien mukaan.
Sisäinen inventaario saa sisältää vain `workspaceId`:n, aktiivisuustiedon,
luokituksen sekä applied/pending-lukumäärät. Polkuja, migration-nimiä tai
-tiivisteitä, `companyId`:tä, `profileId`:tä, lineagea, sessionia tai raakaa
SQLite-virhettä ei palauteta eikä lokiteta.

`invalidHistory` on tietosisällön luokitus: kanoninen, tavallinen ja yhden
linkin tietokantatiedosto on voitu avata read-only-tilassa, mutta integrity-,
foreign key- tai migration history -tarkastus osoittaa sisällön vioittuneeksi
tai ristiriitaiseksi. Puuttuva tai turvaton workspace-juuri, puuttuva tai
ei-kanoninen tietokanta, avaamaton storage, väärä `profileId` taikka utility-,
protokolla- tai shutdown-virhe ei tuota entryä, vaan keskeyttää koko
inventaarion fail-closed.

Checkpoint ei kirjoita registryä tai tietokantaa, käynnistä workspace-
runtimea, aja migraatioita, luo recovery pointia, muuta aktiivista osoitinta
tai accepted build -metadataa eikä vielä kytkeydy production-startupiin.
`invalidHistory`-entryn mahdollinen `recoveryRequired`-siirtymä ja aktiivisen
`compatiblePending`-työtilan migraatio kuuluvat W6A.2:een.

### W6A.2A: First-start migration plan ja registry-siirtymäperusta

W6A.2A pysyy production-startupista irrallisena checkpointina. Se ottaa vain
strictisti validoidun registry v1:n, W6A.1:n valmiin migration inventoryn,
pre-workspace build admissionin sekä source- ja target-build-identiteetit.
Tuloksena on jäädytetty sisäinen suunnitelma, joka sisältää vain:

- `notRequired`- tai `required`-luokituksen
- aktiivisen `workspaceId`:n, migration-statuksen ja applied/pending-määrät
- kanonisesti järjestetyt passiivisten `invalidHistory`-työtilojen ID:t.

Suunnitelma ei sisällä polkua, labelia, lineagea, `profileId`:tä,
`companyId`:tä, migration-nimiä tai -tiivisteitä. Registryssä olevan jokaisen
`ready`-työtilan pitää esiintyä inventaariossa täsmälleen kerran eikä muita
entryjä sallita. Aktiivisen osoittimen pitää viitata `ready`-entryyn ja samaan
inventaarioentryyn. `recoveryRequired`-entryjä ei inventoida eikä suunnitella
uudelleen.

Suunnitelmaa tarvitaan vain `authorizedNewerBuild`- ja
`coordinatedUpdateTarget`-admissioneissa. Aktiivinen `current` on sallittu
ilman migration-oikeutta. Aktiivinen `compatiblePending` on sallittu vain
näissä update-admissioneissa, mutta W6A.2A ei vielä aja migraatiota.
Aktiivinen `invalidHistory` estää koko suunnitelman. Passiivinen
`compatiblePending` säilyy `ready`-tilassa ja byte-identtisenä; vain
passiivinen `invalidHistory` suunnitellaan `recoveryRequired`-tilaan.

Registry-siirtymä käyttää installation-scoped journalia tiloissa `prepared`
ja `registryTransitioned`. Journal kirjoitetaan crash-safe byte-slot -rajalla
ennen registryä. Registry-mutaatio saa muuttaa vain täsmälleen suunniteltujen
passiivisten entryjen `lifecycleState`-kentän. Aktiivinen osoitin, ID:t,
labelit, lineaget, layoutit ja `createdAt` säilyvät. Lähde- ja
kohderekisterit sidotaan canonical-serialisoinnin SHA-256-tiivisteisiin.

Recovery toimii vain todistetuissa tilanteissa:

1. `prepared` + lähderekisteri voidaan jättää jatkettavaksi tai perua
   nimetyllä toiminnolla ilman registry-kirjoitusta
2. `registryTransitioned` + hyväksytty source build palauttaa täsmällisen
   lähderekisterin ja poistaa journalin
3. `registryTransitioned` + hyväksytty target build hyväksyy vain täsmällisen
   transitioned-rekisterin ja poistaa journalin
4. muu hash-, build-, entry- tai lifecycle-ristiriita päättyy
   `recoveryRequired`-tulokseen ilman arvausta tai journalin poistoa.

W6A.2A ei kutsu migration runneria, recovery pointia, backend-starttia,
accepted build -kirjoitusta, update-journalia, renderer-capabilitya tai
relaunchia. Production first-start -kytkentä, aktiivisen workspacen
preMigration/migration/readiness sekä buildin hyväksyntä kuuluvat erilliseen
W6A.2B-checkpointiin.

### W6A.2B: Production first-start -kytkentä

W6A.2B kytkee W6A.2A:n suunnitelman production first-startiin. Electron mainin
omistama orchestraattori koordinoi vain workspace-inventaarion, suunnitelman ja
registry-journalin. Nykyinen `FirstStartUpdateCoordinator` säilyy aktiivisen
työtilan migraation, update/direct Setup -tilan ja accepted build -metadatan
ainoana auktoriteettina. Workspace-moduuli ei kirjoita update-journalia,
direct Setup recoverya tai accepted build -metadataa eikä aja SQL-migraatioita.

**Toteutustila 22.8.2026:** production first-start -kytkentä on toteutettu
unit-, integration- ja Electron-E2E-tasolla. `DESK-WORKSPACE-FIRST-START-001`
todistaa sekä mixed-skenaarion että all-current-skenaarion synteettisillä
yksityisillä testiprofiileilla. Mixed-skenaariossa aktiivinen
`compatiblePending` migroidaan ja hyväksytään, passiivinen
`compatiblePending` säilyy byte-identtisenä `ready`-tilassa ja passiivinen
`invalidHistory` siirtyy vain registryssä `recoveryRequired`-tilaan.
All-current-skenaario ei luo W6-journalia, ja täsmälleen hyväksytyn buildin
toinen käynnistys ohittaa inventaarion.

PreMigration-palautuspiste saa validoida katkeamattoman ja muuttumattoman
historiallisen migration-prefixin tarkoituskohtaisella
`compatibleHistoricalPrefix`-politiikalla. Kaikki normaalit, manuaaliset,
preUpdate-, preRestore-, automatic- ja portable backup -snapshotit vaativat
edelleen täsmälleen nykyisen migration manifestin. Tämä poikkeus ei löysennä
future-, missing-middle- tai changed-history-torjuntaa.

Production-järjestys on:

1. pre-workspace build admission
2. keskeneräisen W6 first-start -journalin recovery
3. adoption- ja switch-recovery sekä aktiivisen työtilan ratkaisu
4. vain update-admissionissa kaikkien `ready`-työtilojen sarjallinen read-only-
   inventaario
5. deterministinen migration plan
6. tarvittaessa `prepared` W6 -journal ennen business-backendia
7. aktiivisen business-backendin käynnistys
8. nykyisen `FirstStartUpdateCoordinator`-migration-auktoriteetin tarkistus
9. vain aktiivisen `compatiblePending`-työtilan migraatio
10. aktiivisen backendin health-, identity- ja artifact-validointi
11. aktiivisen workspace-startupin hyväksyntä
12. suunniteltujen passiivisten `invalidHistory`-entryjen registry-siirtymä
13. transitioned registry -hashin todistus
14. target buildin hyväksyntä update-auktoriteetilla
15. accepted build -metadatan target-todistus ja W6-journalin täsmällinen
    target-hyväksyntä sekä poisto
16. vasta tämän jälkeen UI-ikkunan avaaminen.

`development`, `initialInstall` ja `exactAcceptedBuild` eivät aja W6-
inventaarioa. `authorizedNewerBuild` ja `coordinatedUpdateTarget` ajavat sen
aina. All-current-update ei luo W6-journalia. Aktiivinen
`compatiblePending` vaatii journalin myös silloin, kun passiivisia
`invalidHistory`-entryjä ei ole ja source- sekä transitioned-registry-hash ovat
samat. Passiivinen `compatiblePending` pysyy `ready`-tilassa ja byte-
identtisenä; sen migraatio kuuluu ensimmäiseen myöhempään hallittuun
aktivointiin. Aktiivinen `invalidHistory` sekä structural-, identity-,
utility- tai protocol-virhe pysäyttävät first-startin ennen backendia.

Recovery ajetaan ennen uutta inventaariota. `noJournal` jatkaa normaalisti ja
`recoveredSource` jatkaa todistetulla source-registryllä. `acceptedTarget`
hyväksytään vain target-buildissa. `resumable` sallitaan vain target-buildin,
accepted source buildin, update-admissionin ja source-registry-hashin täsmätessä.
Exact accepted source build saa perua `prepared`-journalin vain täsmällisen
source-registry-todisteen jälkeen. Muut yhdistelmät ovat
`recoveryRequired`, jolloin inventaarioa, backendia tai registry-kirjoitusta
ei tehdä.

Jos inventaario tai suunnitelma epäonnistuu ennen
`FirstStartUpdateCoordinator.beforeMigrations()`-kutsua, vain update-moduulin
kapea pre-backend failure -raja saa siirtää koordinoidun update-journalin
`rollbackRequired`-tilaan. Direct Setupissa accepted source säilyy, targetia
ei hyväksytä eikä olemassa olevaa recovery-tilaa saa heikentää. Epäselvä
durable tila pysäyttää käynnistyksen fail closed.

### W6A.3: Passiivisen työtilan migraatio aktivoinnissa

Passiivinen `compatiblePending`-työtila migroidaan vasta käyttäjän hallitusti
käynnistämässä aktivoinnissa. Kohteen business-backendia tai käyttöliittymää
ei avata ennen kuin migraatio ja readiness-todisteet on hyväksytty. Lähteenä
oleva aktiivinen työtila pysyy koko operaation ajan muuttumattomana.

Migraatio on copy-on-write-operaatio. Electron main johtaa vain validoidut
workspace-polut eikä avaa SQLitea. Mainin käynnistämä rajattu backend-utility
tarkastaa kohteen migration historyn read-only, minkä jälkeen nykyinen
workspace-scoped preMigration-palautuspiste suojaa kohteen julkaistun
business-sisällön. Migraatiot ajetaan palautuspisteestä muodostettuun
yksityiseen candidate-juureen. Candidate todistetaan migration chainin,
workspace-identiteetin ja authoritative artifact/PDF -sulkeuman osalta ennen
atomista aktivointia. Julkaistua kohdetietokantaa ei migroida paikallaan.

W6A.3 ei lisää erillistä activation-migration-journalia. Jo hyväksytyt,
toisiaan täydentävät durable vastuut ovat:

- workspace switch -journal todistaa source/target-valinnan ja palauttaa
  aktiivisen osoittimen lähteeseen ennen hyväksyntää tapahtuvassa virheessä
- workspace-scoped preMigration-palautuspiste suojaa kohteen business-datan
- profile restore activation -journal omistaa candidate-swapin sekä vanhan
  kohteen byte-identtisen rollback-slotin
- update-journal, Direct Setup recovery, W6 first-start -journal ja accepted
  build -metadata eivät kuulu aktivointimigraation kirjoitusvastuuseen.

Target validation -esitarkastus ratkaisee polun ennen target-backendia:

- `current` jatkaa normaaliin startupiin ilman snapshotia, candidatea tai
  activation-journalia
- `compatiblePending` käynnistää tässä kuvattavan aktivointimigraation
- `invalidHistory` ei käynnistä target-backendia eikä tee targetiin business-
  kirjoituksia; switch recovery palauttaa lähteen aktiiviseksi ja registryn
  target-entry siirtyy täsmälliseen `recoveryRequired`-tilaan
- storage-, identity-, path-, protocol- tai utility-virhe pysäyttää operaation
  fail closed eikä sitä saa luokitella migration history -virheeksi.

Onnistuvan `compatiblePending`-polun järjestys on:

1. kohteen read-only migration inventory
2. switch-journalin ja maintenance leasen uudelleentodistus
3. kohteen workspace-scoped preMigration-palautuspiste
4. yksityisen candidate-profiilin muodostus palautuspisteestä
5. SQL-migraatiot vain candidateen
6. candidate-identiteetin ja artifact/PDF-sulkeuman validointi
7. candidate-profiilin atominen aktivointi rollback-slotin taakse
8. targetin normaali backend-start, health-, identity- ja artifact-readiness
9. switch-operaation hyväksyntä ja aktiivisen osoittimen terminal-todistus
10. activation-transactionin hyväksyntä ja journalien hallittu siivous
11. targetin business-UI:n avaaminen.

Virhe ennen candidate-swapia jättää kohteen julkaistut tavut ennalleen ja
palauttaa lähteen aktiiviseksi. Virhe swapin jälkeen palauttaa ensin kohteen
profile restore activation -transactionilla byte-identtisesti ja vasta sen
jälkeen lähteen switch recoverylla. Jos jommankumman palautuksen terminal-tila
ei ole yksiselitteisesti todistettavissa, käynnistys päättyy
`recoveryRequired`-tilaan ilman automaattista arvausta. Onnistuneen
aktivoinnin jälkeen kohteen seuraava startup on täsmällinen `current`-polku
ilman uutta migraatiota, snapshotia, candidatea tai journalia.

**Pakollinen näyttö:**

- `DESK-WORKSPACE-MIGRATION-INVENTORY-001` käyttää oikeaa paketoitua backend-
  runneria ja kolmea synteettistä työtilaa tiloissa `current`,
  `compatiblePending` ja `invalidHistory`
- registry, aktiivinen osoitin, tietokannan SHA-256/koko/mtime ja PDF-
  artifact-juuret säilyvät muuttumattomina eikä SQLite-sidecareja synny
- utility-tarkastukset ovat sarjallisia, normaali backend on suljettu ennen
  inventaariota ja testin jälkeen uusia utility-prosesseja on nolla
- `DESK-WORKSPACE-FIRST-START-001` käyttää oikeaa Electron main -compositionia,
  W6A.2A-journalia, `FirstStartUpdateCoordinator`-auktoriteettia ja oikeaa
  backend migration runneria
- todistuksessa aktiivinen historiallinen prefix migroidaan, passiivinen
  yhteensopiva prefix ja sen artifact-juuri säilyvät muuttumattomina,
  passiivinen invalidi historia rajataan registry-muutokseen ja target-build
  hyväksytään vasta koko ketjun jälkeen
- todistus sulkee backendin ja Electronin hallitusti, poistaa yksityisen
  testirootin ja jättää uusia backend- tai utility-prosesseja nolla
- `DESK-WORKSPACE-ACTIVATION-001` käyttää oikeaa Electron main -compositionia
  ja neljää synteettistä työtilaa: nykyistä sourcea, historiallista targetia,
  invalidia targetia ja fault-targetia
- aktivointitodiste migroi yhteensopivan targetin vasta ensimmäisessä
  hallitussa aktivoinnissa, todistaa seuraavan käynnistyksen idempotentiksi ja
  säilyttää business-rivit sekä authoritative PDF:n hashin
- invalidi target torjutaan ennen backendia ja siirtyy recovery-tilaan;
  pakotettu candidate-virhe palauttaa registryn ja kohteen byte-identtisesti,
  minkä jälkeen journalit, backend-kahvat ja utility-prosessit on vapautettu

- puhdas 0.2.6-asennus ja first/second startup
- synteettinen 0.2.6-profiili sekä erikseen turvallisesti johdettu paikallinen
  testiprofiili
- 0.2.6 -> 0.2.7 MSI major upgrade
- legacy-profiilin copy/validate/adopt
- vähintään kahden työtilan create/import/switch/isolation
- backup import as new ja same-lineage replace
- secret-, archive-, recovery- ja portable backup -scope
- first/second startup, graceful shutdown ja 0 orphan-processia
- failure/restart jokaisessa registry-, adoption-, switch- ja restore-
  journalin vaiheessa
- rollback palauttaa version ja kaikkien työtilojen täsmällisen tilan.
- N+1 first start tarkastaa kaikki migration historyt read-only, migroi vain
  aktiivisen työtilan ja jättää passiivisen migraation ensimmäiseen
  aktivointiin workspace-scoped preMigration-pisteen taakse
- virheellinen passiivinen historia siirtyy turvallisesti
  `recoveryRequired`-tilaan ilman muiden työtilojen kirjoituksia
- PDF-arkisto käyttää workspace-kohtaista alikansiota, samat tiedostonimet
  eivät törmää eikä archive-root siirry backupissa.

**Toteutustila 22.8.2026:** W6A.3:n aktivointimigraatio sekä sen success-,
invalid-history-, restart- ja fault-palautumistodiste on toteutettu unit-,
integration- ja Electron-E2E-tasolla testillä
`DESK-WORKSPACE-ACTIVATION-001`. Koko paketoitu multi-workspace W6
-releaseportti on edelleen avoin; yksittäinen W6A.3-todiste ei yksin täytä
sen MSI-, backup/restore-, isolation- ja kokonaisrollback-vaatimuksia.

### W6B: Full packaged multi-workspace acceptance

W6B sulkee W6:n paketoidun release-portin kahdella toisistaan erotetulla
lähtömallilla. W6B ei nosta sovellusversiota eikä tuota käyttäjälle jaettavaa
MSI:tä. Kaikki profiilit, salaisuudet, PDF:t, asennukset ja faultit ovat
ajokohtaisia synteettisiä fixtureitä.

Ensimmäinen lähtömalli todistaa käyttäjän todellisen siirtymän hyväksytystä
legacy-versiosta multi-workspace-versioon:

1. lähteenä käytetään täsmällistä hyväksyttyä 0.2.6 MSI-artifactia tai CI:ssä
   samasta hyväksytystä source-commitista deterministisesti rakennettua
   source-fixtureä
2. source-identiteetistä todistetaan app-versio, build-revisio, clean build,
   ProductCode, UpgradeCode ja SHA-256
3. tavallinen Windows Installer major upgrade asentaa numeerisesti eri
   synteettisen N+1-targetin
4. first start adoptoi yhden legacy-profiilin täsmälleen yhdeksi `ready`-
   työtilaksi ja asettaa aktiivisen osoittimen siihen
5. toinen startup todistaa hyväksytyn target-buildin ja adoption
   idempotenssin.

Satunnaista nykyisestä HEADista 0.2.6-versionumerolla rakennettua pakettia ei
hyväksytä legacy-lähteeksi. Jos hyväksyttyä artifactia tai sen tarkkaa
source-commitia ei voida todistaa, W6B pysähtyy ennen MSI-ajoa.

Toinen lähtömalli todistaa tulevan multi-workspace-version sisäisen
päivityksen. Synteettinen N ja N+1 käyttävät eri numeerisia fixture-versioita
sekä yksityiseen, Gitistä ohitettuun stagingiin kirjoitettuja manifesteja.
Canonical `package.json`- ja `installer-release.json`-tiedostoja ei muuteta.
Nykyinen update-, handoff-, first-start-, migration-, recovery- ja rollback-
polku säilyy testin production-polkuina; rinnakkaista testimoottoria ei luoda.

Onnistumismatriisi sisältää kolme työtilaa:

| Työtila | Lähtötila N+1:een nähden | Paketoidun todistuksen odotus |
| --- | --- | --- |
| A | aktiivinen `compatiblePending` | Migroidaan first startissa ennen target-buildin hyväksyntää |
| B | passiivinen `compatiblePending` | Säilyy first startissa byte-identtisenä ja migroidaan vasta ensimmäisessä aktivoinnissa |
| C | passiivinen `invalidHistory` | DB- ja PDF-juuret eivät muutu; registry-entry siirtyy `recoveryRequired`-tilaan |

Todistus vaihtaa B:hen, käynnistää B:n uudelleen idempotenssin osoittamiseksi,
vaihtaa takaisin A:han ja torjuu C:n aktivoinnin. Jokaisella työtilalla on
erilliset business-rivit, authoritative PDF, secret-namespace, archive-
konfiguraatio ja -journal sekä recovery point -juuri. Installation-scoped
update-tila säilyy yhtenä eikä saa sekoittua workspace-scoped-tilaan.

**W6B.2A success-checkpoint 25.8.2026:** paketoitu N -> N+1-
onnistumismatriisi on toteutettu pysyvällä
`pnpm --filter @eky/desktop installer:w6b2-success` -komennolla. Komento
rakentaa yhden yksityisen 0.2.7 -> 0.2.8 -fixtureparin ja ajaa saman parin
kahdesti. Todistus kattaa aktiivisen A:n first-start-migraation, passiivisen
B:n muuttumattomuuden ennen ensimmäistä aktivointia, B:n hallitun
aktivointimigraation ja idempotentin uudelleenkäynnistyksen, paluun A:han sekä
C:n `invalidHistory`-torjunnan `recoveryRequired`-tilaan. Jokainen ajo käyttää
ajokohtaista synteettistä profiilia, rajattuja vaihekohtaisia timeoutteja,
turvallista JSONL-observabilitya, omistettujen prosessien cleanupia ja nollan
orpoprosessin loppuehtoa. Canonical-versiot ja release-kanava eivät muutu.
CI ajaa kaksi toistoa erillisinä Windows-matriisiajoina. Yksi ajo rakentaa ja
tarkistaa oman muuttumattoman fixtureparinsa, käyttää vain valittua suljettua
`--run=1|2`-toistoa ja noudattaa 25 minuutin elinkaaribudjettia. Paikallinen ja
manuaalinen release-portti rakentaa yhden fixtureparin ja ajaa samat tavut
edelleen kahdesti; sen mitattu kokonaisbudjetti on 38 minuuttia. Uusi ajo
käynnistyy vain, jos sille on jäljellä nykyinen täysi 12 minuutin
skenaarioraja sekä vähintään 90 sekuntia fixture-cleanupiin. Budjetit perustuvat
GitHubin mitattuun noin yhdeksän minuutin hitaaseen fixtureparin buildiin.
Budjetin loppuminen tuottaa suljetun, allowlistatun terminal-tuloksen ennen
GitHub-jobin ulkoista aikarajaa; yksittäisen skenaarion aikarajaa ei tämän
vuoksi kasvateta.

Tämä checkpoint ei sulje koko W6-porttia. W6B.2B:n fault- ja rollback-
matriisi, installer repair/uninstall -jatkuvuus sekä lopullinen release-portti
ovat edelleen avoimia. W6B.2A ajetaan CI:ssä omana rajattuna Windows-jobina,
ei tavallisen MSI-release-gaten tai installer-unit-testien sisällä.

Paketoitu fault-matriisi on rajattu viiteen korkean riskin tapaukseen:

1. preUpdate-palautuspisteen virhe pysäyttää ennen runtime-sulkua ja handoffia
2. aktiivisen A:n migration- tai health-virhe palauttaa A:n business-datan,
   registryn, aktiivisen osoittimen ja source-binaariversion; B ja C säilyvät
   byte-identtisinä
3. kaatuminen registry-siirtymän ja target-buildin hyväksynnän välissä
   ratkaistaan W6 first-start -journalista ilman mixed registry/build -tilaa
4. B:n aktivointimigraation virhe palauttaa B:n byte-identtisesti sekä A:n
   aktiiviseksi ilman binary rollbackia
5. binary rollbackin virhe päättyy `recoveryRequired`-tilaan ilman
   automaattista retry-loopia tai väärän version käynnistystä.

**W6B.2B fault/rollback -checkpoint 27.8.2026:** matriisi on toteutettu
pysyvällä `pnpm --filter @eky/desktop installer:w6b2-fault-rollback`
-komennolla. Yksi rakennettu 0.2.7 -> 0.2.8 -fixturepari käytetään viiden
skenaarion kahdessa peräkkäisessä ajossa, yhteensä kymmenessä ajossa.
Todistus varmistaa skenaariokohtaisen source- tai rollback-lopputilan,
työtilojen ja installation-scopen eristyksen, suljetun recoveryRequired-
tilan siellä missä automaattinen palautuminen ei ole turvallista sekä nollan
omistetun orpoprosessin loppuehdon. Paikallinen koko matriisi,
W6B.2A-success-regressio ja legacy 0.2.6 -> 0.2.7 -hyväksyntä ovat vihreitä.
Matriisi ajetaan lisäksi omana Windows CI -jobinaan ennen mergeä.

Lisäksi install, reinstall/repair, uninstall ja reinstall todistetaan samalla
synteettisellä multi-workspace-profiililla. Uninstall saa poistaa vain
installation-owned binaarit, shortcutit, install-rootin ja Windows Installer
-rekisteröinnit. Workspace-registry, tietokannat, PDF:t, backupit, recovery
pointit ja secret-namespace säilyvät.

Kaikissa skenaarioissa inventoidaan ennen ja jälkeen SQLite, authoritative
PDF:t, workspace-registry ja sallitut workspace-scoped-juuret. Vanhat runtime-
sessionit torjutaan, uusia Electron-, backend-, utility- tai installer-
orpoprosesseja jää nolla eikä polkuja, salaisuuksia, raakaa MSI-tulostetta tai
business-dataa julkaista testiraporttiin.

W6B pysähtyy, jos fixture vaatisi tracked version -tiedostojen väliaikaista
muokkaamista, saman version käyttöä eri revisioille, uutta rinnakkaista
installer/update-moottoria, inventory-rajan nostoa, oikeaa käyttäjädataa tai
dependency-, schema-, migration SQL- tai backup-formaattimuutosta.

In-app update testataan erikseen vain, jos `localUnsignedPilot`-polku on
kyseisessä checkpointissa hyväksytty. MSI-gate ei piilota in-app update -puutetta.

**Release-raja:** ensimmäinen käyttäjälle näkyvä versio on `0.2.7` vain, jos
W1-W5B muodostavat koherentin käytettävän kokonaisuuden ja koko W6-portti on
vihreä. Pelkästä registry- tai sisäisestä checkpointista ei nosteta versiota.

**Commit/PR/release:** testihardening omana PR:nään; versionosto viimeisenä
erillisenä commitina vihreästä lähdepuusta.

## W7: Workspace deletion

**Tila:** deferred.

Poisto suunnitellaan erikseen vasta ensimmäisen multi-workspace-releasen
jälkeen. Se vaatii ADR-0011:n quarantine-, backup-, typed confirmation-,
native confirmation-, secret-, recovery- ja external artifact -rajat.

W7 ei saa tulla mukaan W1-W6-PR:iin tai 0.2.7-releaseen sivutoimintona.

## Checkpointien yhteinen Definition of Done

Jokaisessa vaiheessa:

1. lähimmät `AGENTS.md`- ja tehtävädokumentit on luettu
2. uusi riippuvuus, schema tai formaattimuutos on pysäytetty omaan
   hyväksyntäporttiinsa
3. tiedostot ja adapterit omistavat yhden koherentin vastuun
4. renderer-, Electron main-, backend- ja filesystem-luottamusrajat on
   testattu
5. vanha työtila, muut työtilat ja installation-scope ovat failure-polussa
   muuttumattomia
6. salaisuuksia, polkuja, sessionia tai business-dataa ei vuoda UI:hin,
   lokeihin tai testiraportteihin
7. unit/integration/E2E/packaged-testit skaalautuvat riskin mukaan
8. dokumentaatio ja integraatiomatriisi on päivitetty
9. versionostoa ei tehdä ennen W6:n release-porttia
10. asennuksessa on myös maintenance-operaatiossa enintään yksi business-
    SQLite-owner
11. työpuu ja artifact-identiteetti ovat puhtaat ennen seuraavaa vaihetta.

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `apps/e2e/AGENTS.md`
- `docs/architecture/e2e-test-environment.md`
- `docs/architecture/e2e-testing-strategy.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/module-integration-matrix.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/architecture/windows-update-operational-runbook.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
- `docs/decisions/ADR-0011-local-multi-workspace-company-model.md`
