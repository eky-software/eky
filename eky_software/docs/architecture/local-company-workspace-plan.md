# Eky Local Company Workspace -toteutussuunnitelma

## Tila

Suunniteltu. W0:n arkkitehtuuri- ja hyväksymissopimus on dokumentoitu.
W1-tuotantokoodia ei ole aloitettu.

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
- Jokainen checkpoint valmistuu omana PR:nään. Seuraavaa checkpointia ei
  aloiteta ennen vihreää edellistä checkpointia ja dokumentoitua hyväksyntää.

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

**Omistaja:** Electron mainin rajattu workspace registry -adapteri ja
composition. Ei backend- tai business-moduuli.

**Muutettavat kerrokset:** desktop main, sisäinen registry schema/serializer,
composition ja testit. UI:ta ei vielä avata.

**Muuttumattomat kerrokset:** backend HTTP/API, domain, SQLite business-
schema, backup container, installer payload ja web-komponentit.

**Sopimus:**

- versionoitu asennuskohtainen rekisteri
- satunnainen opaque `workspaceId`
- muokattava `workspaceLabel`
- versionoitu lineage identity
- mainin omistama storage locator
- crash-safe current/next/backup-slotit ja recovery
- enintään yksi active pointer ja yksi workspace per lineage.

**Luottamusraja:** renderer ei lue tai kirjoita rekisteritiedostoa eikä saa
storage locatoria. Kaikki input validoidaan suljetulla schema- ja
pituusrajalla.

**Fail-closed-tilat:** unknown version, duplicate ID/lineage, invalid locator,
missing root, corrupt current ja ristiriitaiset recovery-slotit.

**Testit:** serializer/parser, atomic replacement jokaisen vikapisteen jälkeen,
unknown-field/null/prototype/path-korpus, duplicate identity ja käyttöoikeus-
sekä symlink/reparse-rajat.

**Dokumentit:** ADR-0011:n toteutustila ja integraatiomatriisi.

**Commit/PR/release:** yksi W1-PR; ei käyttäjälle näkyvää releasea.

## W2: Empty workspace creation

**Omistaja:** Electron mainin workspace coordinator; backendin nykyinen
fresh-profile bootstrap rajatun portin takana.

**Muutettavat kerrokset:** desktop composition, private workspace root,
backend lifecycle -adapteri ja testit. Mahdollinen UI tulee vasta W5:ssä.

**Muuttumattomat kerrokset:** business-domain, API-sopimukset,
backup-formaatti ja installer/update.

**Sopimus:** uusi työtila syntyy candidate-rootiin, saa uuden `workspaceId`:n
ja uuden SQLite `companyId`:n, migroituu nykyiseen manifestiin ja julkaistaan
rekisteriin vasta readiness-portin jälkeen.

**Luottamusraja:** label on käyttäjän syöte; polku ja identiteetit ovat mainin
luomia. Renderer ei saa päättää initial companyId:tä.

**Fail-closed-tilat:** rootin luonti, migration, integrity/FK, identity,
health tai registry publish epäonnistuu. Candidate poistetaan tai
karanteenoidaan; aktiivinen työtila ei muutu.

**Testit:** kaksi tyhjää työtilaa, samat labelit, eri workspace/company/lineage-
identiteetit, keskeytys jokaisessa vaiheessa, restart-idempotenssi ja ei
orpoja prosesseja.

**Dokumentit:** workspace storage layout ja bootstrap-runbook.

**Commit/PR/release:** yksi W2-PR; ei vielä käyttäjälle näkyvää releasea.

## W3: Import backup as new workspace

**Omistaja:** Profile Protection / Backup / Restore yhdessä workspace
coordinatorin kanssa. Backup inspector säilyy backup-formaatin omistajana.

**Muutettavat kerrokset:** desktop backup/import-application service,
workspace candidate composition ja testit.

**Muuttumattomat kerrokset:** `.ekybackup` v1, kryptografia, business-schema,
HTTP/API ja nykyinen same-lineage restore.

**Sopimus:** autentikoitu backup, jonka lineagea ei ole rekisterissä, tuodaan
uutena työtilana private staging -> forward migration -> full validation ->
atomic registry publish -ketjulla.

**Luottamusraja:** backup ja salasana ovat ulkoisia syötteitä. Main omistaa
Open-dialogin; renderer ei saa tiedostopolkua tai salasanaa.

**Fail-closed-tilat:** väärä salasana, unknown format, future/changed/missing-
middle migration, duplicate lineage, invalid SQLite/artifact/identity,
levytila tai publish failure.

**Testit:** nykyinen backup-korpus, 0.2.6 historical prefix, PDF:t, tyhjä
artifact-katalogi, duplicate lineage, restart, cleanup, salaisuuksien
poissulku ja cross-workspace isolation.

**Dokumentit:** backup-planin multi-workspace-osuus ja restore-runbook.

**Commit/PR/release:** yksi W3-PR; ei vielä user releasea.

## W3b: Replace existing workspace from same-lineage backup

**Omistaja:** Profile Protection / Backup / Restore; coordinator lukitsee
kohdetyötilan ja aktivoinnin.

**Muutettavat kerrokset:** restore target resolution, workspace-scoped
recovery point, activation journal ja testit.

**Muuttumattomat kerrokset:** backup container, business-domain ja muiden
työtilojen data.

**Sopimus:** vain exact lineage saa korvata olemassa olevan työtilan. Korvaus
on snapshot + staging + forward migration + validation + atomic replace, ei
taulu- tai tietuemerge.

**Luottamusraja:** käyttäjä valitsee rekisteristä workspaceId:n; main todistaa
lineagen. Label, nimi tai Y-tunnus eivät oikeuta korvausta.

**Fail-closed-tilat:** wrong lineage, duplicate lineage registryssä,
pre-restore failure, invalid staging, activation/rollback failure ja
`recoveryRequired`.

**Testit:** same-lineage success, wrong-lineage deny ilman writeä, vanhan datan
poistuminen, uudemman datan palautuminen, PDF-hashit, salaisuuden jatkuvuus,
keskeytys jokaisessa journal-vaiheessa ja muiden työtilojen hashien
muuttumattomuus.

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

**Luottamusraja:** vain trusted main frame voi pyytää switchiä. Main hyväksyy
vain registryssä olevan workspaceId:n. Vanha session, backend, DB-kahvat ja
adapterit eivät saa selvitä vaihdosta.

**Fail-closed-tilat:** in-flight operation, unresolved update/restore,
shutdown failure, handle leak, candidate health/identity failure, pointer
failure, rollback failure ja `recoveryRequired`.

**Testit:** A -> B -> A, vanha session deny, concurrent switch deny,
write-in-flight, PDF window, secret namespace, archive config/journal,
backup/recovery scope, restart jokaisessa journal-vaiheessa, 0.2.6 adoption
kahdesti ja 0 orphan-processia.

**Dokumentit:** desktop implementation plan, update-planin per-workspace first
start ja operational runbook.

**Commit/PR/release:** W4 voidaan jakaa registry switch- ja legacy adoption
-PR:iin, jos kumpikin pysyy itsenäisesti suljettuna. Ei user releasea ennen
W5-W6:ta.

## W5: Workspace management UI

**Omistaja:** web feature paikallisen desktop-capabilityn päällä. Electron main
omistaa kaikki privileged toiminnot.

**Muutettavat kerrokset:** webin workspace-näkymä, i18n, preload-allowlist ja
rajattu main IPC. Backend business API ei saa workspace-hallintareittejä.

**Muuttumattomat kerrokset:** storage-päätökset, backup-formaatti, domain ja
permission-malli.

**Käyttäjäpolut:** listaa turvalliset labelit, luo tyhjä, tuo backupista,
korvaa exact-lineage-workspace, vaihda työtila ja nimeä label uudelleen.
Poista-toimintoa ei näytetä.

**Luottamusraja:** UI saa workspaceId:n vain capability-vastauksesta. Se ei
saa polkua, companyId:tä, lineagea, secret refiä tai journalia.

**Fail-closed-tilat:** capability puuttuu webissä, invalid selection,
operation conflict, native confirmation cancel, switch/import failure ja
recoveryRequired. Viestit ovat turvallisia suomenkielisiä i18n-tekstejä.

**Testit:** web ilman desktop-capabilitya, keyboard/focus, loading/error,
double click, cancellation, duplicate label, failed switch, UI reload ja
vanhan workspace-datan katoaminen näkymästä vaihdossa.

**Dokumentit:** UI-periaatteet ja desktop capability -sopimus.

**Commit/PR/release:** yksi W5-PR. Ensimmäinen release candidate voidaan
nimetä vasta W6:n hyväksymisportin jälkeen.

## W6: E2E, packaged pilot and 0.2.6 -> 0.2.7 gate

**Omistaja:** E2E/test infrastructure sekä release process. Tuotantokoodia ei
korjata suoraan release-portin sisällä ilman paluuta omistavaan checkpointiin.

**Muuttuvat kerrokset:** testit, fixturet, CI-portit, release-dokumentaatio ja
erillinen lopullinen versionostocommit.

**Pakollinen näyttö:**

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

In-app update testataan erikseen vain, jos `localUnsignedPilot`-polku on
kyseisessä checkpointissa hyväksytty. MSI-gate ei piilota in-app update -puutetta.

**Release-raja:** ensimmäinen käyttäjälle näkyvä versio on `0.2.7` vain, jos
W1-W5 muodostavat koherentin käytettävän kokonaisuuden ja koko W6-portti on
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
10. työpuu ja artifact-identiteetti ovat puhtaat ennen seuraavaa vaihetta.

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `apps/e2e/AGENTS.md`
- `docs/architecture/e2e-test-environment.md`
- `docs/architecture/e2e-testing-strategy.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/module-integration-matrix.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/architecture/windows-update-operational-runbook.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
- `docs/decisions/ADR-0011-local-multi-workspace-company-model.md`
