# ADR-0011: Local multi-workspace company model

## Tila

Hyväksytty arkkitehtuurisopimus. W1-W3:n registry-, creation-, import- ja
replacement-foundation on toteutettu. W4 on kytkenyt registryyn sidotun
startupin, legacy-profiilin adoption, workspace-kohtaiset runtime-resurssit
sekä hallitun switch-polun production-compositioniin. W5A:n Electron mainin
sisäinen management-palvelu, yhteinen maintenance-auktoriteetti,
production-lifecycle-adapteri ja private candidate -adapterit on toteutettu ja
hyväksytty paikallisella W5A-testimatriisilla. Renderer-capabilitya tai
käyttäjälle näkyvää usean workspacen hallintaa ei ole vielä toteutettu.

Tämä päätös jatkaa ADR-0008:n yhden aktiivisen yritystyötilan mallia. Se ei
kumoa ADR-0008:n R0-rajoja, vaan määrittää hallitun kasvupolun useaan erilliseen
paikalliseen yritystyötilaan.

## Päätös

Yksi Eky Local -asennus voi tulevaisuudessa rekisteröidä useita paikallisia
yritystyötiloja. Vain yksi työtila saa olla aktiivinen yhdessä desktop-
runtimessa.

Electron main omistaa:

- asennuskohtaisen työtilarekisterin
- aktiivisen työtilan osoittimen
- työtilan valinnan ja vaihdon orkestroinnin
- työtilakohtaisten filesystem-juurien muodostamisen
- backendin, runtime-sessionin ja privileged adapterien elinkaaren.

Renderer ei saa tietokanta-, artifact-, backup-, salaisuus- tai
työtilahakemistojen polkuja. Renderer saa vain rajatun, validoidun ja
Electron mainin tuntemaan `workspaceId`-arvoon perustuvan capabilityn.

## W5:n toimitusraja

W5 toimitetaan kahtena erillisenä porttina:

- W5A toteuttaa vain Electron mainin sisäisen workspace management
  -kyvykkyyden, production-lifecycle- ja candidate-adapterit sekä yhden
  installation-scoped maintenance-auktoriteetin. W5A ei lisää preloadia,
  IPC:tä, renderer-capabilitya, web-UI:ta tai backendin julkista reittiä.
- W5B lisää myöhemmin trusted main frame -rajatun IPC/preload-sopimuksen ja
  käyttäjälle näkyvän workspace-hallinnan erillisellä hyväksymisportilla.

Mainin sisäinen hallintapalvelu saa palauttaa vain rajatun status- ja
workspace-projektion. Polut, `companyId`, lineage, runtime-session,
salaisuusviitteet, journalit, operation-tunnisteet ja raakavirheet eivät kuulu
sopimukseen. W5A ei tee sisäisestä kyvykkyydestä rendererille käytettävää.

## Käsitteet ja identiteetit

### Installation

`Installation` tarkoittaa yhtä Eky Desktop -asennusta samalla Windows-
käyttäjällä. Se omistaa binaarit, päivitys- ja asennustilan sekä
työtilarekisterin. Asennus ei omista yrityksen liiketoimintadataa.

Nykyisessä 0.2.6-mallissa SQLite-taulun `local_runtime_identity.installation_id`
on legacy-bootstrap-metadataa. Se ei ole tuleva rekisterin omistama
asennustunniste, `workspaceId` tai backup-lineage. Sen mahdollinen siirto tai
säilytys ratkaistaan W1:n rekisterisopimuksessa ilman vanhan datan hiljaista
uudelleentulkintaa.

### Local company workspace

`Local company workspace` on yhden yrityksen suljettu paikallinen kokonaisuus:

- yksi SQLite-tietokanta
- yhden yrityksen `companyId`
- business-audit
- auktoritatiiviset lasku-PDF:t
- snapshot-katalogi
- varmuuskopio- ja palautuspisteiden tila
- työtilaan sidotut, konekohtaiset adapteriasetukset ja salaisuusviitteet.

Työtila ei ole käyttäjä, pilvitenant, yritysjäsenyys tai Windows-hakemisto.

### workspaceId

`workspaceId` on Electron mainin luoma satunnainen ja läpinäkymätön
asennuskohtainen tunniste.

- Electron main luo arvon Node-standardikirjaston `crypto.randomUUID()`-
  funktiolla
- v1 hyväksyy vain canonical lowercase UUID v4 -muodon
  `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`
- sitä ei johdeta `companyId`:stä, Y-tunnuksesta, yrityksen nimestä,
  hakemistopolusta tai backupin nimestä
- renderer, backup tai rekisteriin annettu ulkoinen syöte ei saa muodostaa,
  arvata tai normalisoida sitä
- väärä kirjainkoko, UUID-versio, variantti tai muoto torjutaan
- sitä käytetään vain rekisterissä ja main-prosessin rajatuissa capabilityissä
- se ei korvaa backendin vahvistettua `companyId`:tä.

### workspaceLabel

`workspaceLabel` on käyttäjälle näkyvä, muokattava paikallinen nimi. Se ei ole
auktoritatiivinen yritysnimi eikä identiteettiraja. Samannimiset työtilat ovat
sallittuja.

V1 tallentaa vain valmiiksi trimmatun, yhden rivin arvon, jonka pituus on
1-80 Unicode-koodipistettä. C0- ja C1-control-merkit, rivinvaihdot,
Unicode-rivierottimet sekä bidi override/isolate -ohjausmerkit torjutaan.
Labelia ei käytetä identiteetin, lineagen, storage-polun tai konfliktin
ratkaisemiseen.

### companyId ja ActorContext

`companyId` säilyy yrityksen liiketoimintadatan tenant-rajana. Backend lukee
sen aktiivisen työtilan validoidusta SQLite-identiteetistä ja muodostaa sen
vahvistettuun runtime-sessioniin sidottuun `ActorContext`-kontekstiin.

`companyId` luodaan tyhjälle työtilalle täsmälleen kerran ja säilyy
muuttumattomana työtilan koko elinkaaren ajan. Backupin tuonti säilyttää
backupin alkuperäisen `companyId`:n; import, restore, labelin vaihto tai
workspace switch eivät saa luoda sille uutta arvoa.

Nykyinen `actorId = local-owner` on yhden käyttäjän paikallisen runtimen
bootstrap-actor. Se ei ole `workspaceId`, käyttäjäidentiteetti, yrityksen
lineage tai asennuksen tunniste eikä sitä saa käyttää näiden johtamiseen.

Työtilan vaihtaminen ei koskaan tarkoita pelkän `companyId`-arvon vaihtamista
käynnissä olevassa prosessissa.

### Backup lineage identity

Nykyinen portable backup- ja recovery-polku käyttää `profileId`-arvoa
lineage-tunnisteena. Koodiauditin perusteella se muodostetaan
domain-erotellulla SHA-256-tiivisteellä SQLiteen tallennetusta `companyId`:stä.

Tästä seuraa:

- rekisterin `lineageIdentity.formatVersion` on täsmälleen `1`
- rekisterin `lineageIdentity.profileId` on täsmälleen 64 merkin lowercase
  SHA-256-hex-arvo
- tunniste säilyy backupin mukana ja on vertailukelpoinen toisella koneella
- se on eri esitysmuoto kuin `companyId`, mutta ei siitä riippumaton identiteetti
- sitä ei käytetä `workspaceId`:nä
- täsmälleen sama lineage saa kuulua rekisterissä enintään yhdelle työtilalle
- lineage-formaatin muuttaminen vaatii versionoidun backup-yhteensopivuuspäätöksen.

Yrityksen nimi tai Y-tunnus ei määritä lineagea. Eri lineageilla olevilla
työtiloilla saa olla sama nimi tai sama liiketoiminnallinen tunniste. UI voi
varoittaa mahdollisesta kaksoiskappaleesta, mutta se ei saa yhdistää tai
korvata työtiloja näiden kenttien perusteella.

## Omistajuus- ja storage-scope

Nykyisessä 0.2.6-runtimessa eri scopeihin kuuluvaa tilaa sijaitsee vielä saman
`<userData>/runtime`-juuren alla. Fyysinen sijainti ei muuta semanttista
omistajuutta. W1-W4 erottavat scopejen compositionin hallitusti.

### Nykytilan read-only-inventaario

W0:ssa koodista varmennettu nykyinen tallennusmalli on seuraava. Polut ovat
suhteellisia Electronin main-prosessin omistamaan `<userData>`-juureen, ellei
taulukossa muuta todeta. Inventaario kuvaa 0.2.6-rakennetta; se ei vielä
määrää W1:n lopullisia hakemistonimiä.

| Nykyinen sisältö | Nykyinen sijainti tai muoto | Nykyinen luonne | Tuleva omistaja |
| --- | --- | --- | --- |
| SQLite | `runtime/data/eky.sqlite` | Pysyvä ja auktoritatiivinen | workspace |
| Hyväksyttyjen laskujen PDF:t | `runtime/storage/invoices/` | Pysyvä ja auktoritatiivinen | workspace |
| Snapshot-katalogi | `snapshot-catalog-v1.json` yksityisessä snapshot-operaatiossa ja portable backupissa polulla `artifacts/snapshot-catalog-v1.json` | Snapshotin auktoritatiivinen artifact-luettelo, ei erillinen installation-rekisteri | workspace |
| Portable backup | Käyttäjän valitsema `.ekybackup`-tiedosto; viimeisin turvallinen UI-status polulla `runtime/profile-backup-state/portable-backup-status-v1.json` | Salattu export sekä konekohtainen status | yhden lineage-työtilan export / workspace device-local status |
| Recovery pointit | `runtime/recovery-points/` ja `runtime/recovery-point-state/clean-shutdown-v1.json` | Pysyvä konekohtainen palautustila | workspace device-local |
| Restore staging ja journal | `runtime/private-backup-staging/`, `runtime/profile-restore-rollback/`, `runtime/failed-profile-restores/`, `runtime/private-backup-quarantine/` ja `runtime/profile-restore-state/profile-restore-activation-journal-v1.json` | Operaatioon ja kohdetyötilaan sidottu transientti tila | workspace-bound transient |
| SMTP-salaisuus | `runtime/secrets/company-email-smtp-v1.dat` | DPAPI/safeStorage-suojattu konekohtainen salaisuus; ei business-backupiin | workspace-namespaced device secret |
| PDF-arkistointi | `runtime/settings/invoice-pdf-archive-v1.json` ja `runtime/archive/invoice-pdf-archive-journal-v1.json`; käyttäjän valitsema ulkoinen kansio on tämän juuren ulkopuolella | Konekohtainen asetus ja retry-journal; ulkoinen kopio ei ole auktoritatiivinen | workspace device-local |
| Operational- ja security-lokit | `runtime/logs/` | Retention-rajattu tekninen installation-loki | installation |
| Support bundle | Käyttäjän valitsema `.json.gz`-export; väliaikainen staging `runtime/support-bundles/temporary/` | Käyttäjän käynnistämä installation-export ja transientti staging | installation / transient |
| Runtime-session | Vain Electron mainin ja backendin prosessimuistissa | Transientti luottamusraja | aktiivinen workspace-runtime |
| Accepted build ja update journal | `update-state/accepted-build-v1.json` ja `update-state/local-update-journal-v1.json`; vanha `runtime/update-state/` on vain yhteensopivuuslähde | Pysyvä update- ja first-start-tila | installation |
| Update package cache | `update-cache/`, jonka suljetut roolit ovat current, candidate ja previous | Pysyvä mutta hallitusti siivottava asennustason pakettivälimuisti | installation |
| Diagnostics | Runtime-, loki-, incident- ja build-tiedosta muodostettu turvallinen read model | Projektionäkymä, ei oma business-datastore | installation projection |
| Muut temp-tiedostot | Käyttötapauksen yksityinen runtime- tai käyttöjärjestelmän temp-juuri | Operaatiosidonnainen ja siivottava | transient |

`profileId` on tämänhetkinen backup- ja recovery-lineagen todiste. Se on
stabiili koneiden välillä, koska se johdetaan SQLiteen tallennetusta
`companyId`:stä, mutta se ei ole tulevan työtilarekisterin identiteetti.
Nykyinen `local_runtime_identity.installation_id` puolestaan on työtilan
SQLiteen jäänyttä legacy-bootstrap-metadataa eikä kelpaa uuden
installation-rekisterin auktoriteetiksi.

| Sisältö | Tavoitescope | Päätös |
| --- | --- | --- |
| Sovellusbinaarit ja asennusjuuri | installation | Yksi versio palvelee kaikkia työtiloja. |
| Työtilarekisteri ja aktiivinen osoitin | installation | Electron mainin omistama; ei business-backupiin. |
| Build identity ja accepted build metadata | installation | Päivitys- ja first-start-portin tila. |
| Update journal, cache sekä current/candidate/previous MSI | installation | Ei työtilan backupiin eikä workspace switchin mukana siirrettäväksi. |
| SQLite ja `local_runtime_identity` | workspace | Yksi yritys ja yksi `companyId` per työtila. |
| Auktoritatiiviset invoice PDF:t | workspace | Kuuluvat työtilan backup-katalogiin. |
| Snapshot-katalogi | workspace | Johdetaan saman työtilan SQLite- ja artifact-snapshotista. |
| Portable backupin viimeisin turvallinen status | workspace, device-local | UI-metadata sidotaan työtilaan; ei polkua tai tunnisteita eikä backupiin. |
| Recovery pointit ja niiden index | workspace, device-local | Vain saman työtilan palautukseen; ei portable backupiin. |
| Restore staging, journal, rollback ja quarantine | workspace-bound transient | Operaatio sidotaan ennen purkua täsmälliseen kohde-workspaceen. |
| SMTP-salaisuus | workspace-namespaced device secret | DPAPI/safeStorage, ei SQLiteen, rendereriin tai backupiin. |
| PDF-arkistokansion asetus ja retry-journal | workspace, device-local | Ei business-backupiin; ulkoinen arkistokopio ei ole auktoritatiivinen artifact. |
| Operational- ja security-lokit | installation | Ei business-backupiin; tapahtuma ei saa vuotaa workspace- tai business-identiteettiä. |
| Incident index ja Diagnostics | installation projection | Saa näyttää vain aktiivisen runtimen turvallisen yhteenvedon. |
| Support bundle | installation export / transient staging | Ei työtilan backupiin; käyttäjän valitsema export ei ole registry-dataa. |
| W3-importin plaintext-karanteeni | installation-scoped transient | Vain W3:n allowlistattu, rajattu payload Electron mainin johtamassa yksityisessä juuressa; ei registryyn, backupiin tai workspace-rootiin. |
| Runtime-session | workspace-bound transient memory | Mitätöidään aina vaihdossa; ei levylle. |
| Temp-tiedostot | operation-bound transient | Suljettu root ja cleanup; eivät määritä työtilaa tai lineagea. |

Salaisuuden store-key tai secret reference sisältää työtilan namespaceen
sidotun tunnisteen, mutta salaisuuden arvo ei päädy rekisteriin. Työtilan
tuonti toiselle koneelle ei tuo SMTP-salasanaa mukanaan.

## Työtilarekisterin turvallisuusraja

Rekisterin ensimmäinen hyväksytty sopimus on täsmälleen:

```ts
interface LocalWorkspaceRegistryV1 {
  formatVersion: 1;
  activeWorkspaceId: string | null;
  workspaces: LocalWorkspaceRegistryEntryV1[];
}

interface LocalWorkspaceRegistryEntryV1 {
  workspaceId: string;
  workspaceLabel: string;
  lineageIdentity: {
    formatVersion: 1;
    profileId: string;
  };
  layoutVersion: 1;
  lifecycleState: 'ready' | 'recoveryRequired';
  createdAt: string;
}
```

Parseri on suljettu: tuntemattomat kentät ja arvot torjutaan. `createdAt` on
täsmälleen canonical UTC -muodossa `YYYY-MM-DDTHH:mm:ss.sssZ`. Parseri tekee
parse- ja round-trip-tarkistuksen. Aikaleima ei ole käyttöjärjestyksen,
identiteetin tai konfliktin lähde.

Registry v1:n resurssi- ja rakennerajat ovat:

- enintään 64 KiB UTF-8-tavuina ennen dekoodausta
- enintään 64 workspace-entryä
- invalid UTF-8, duplicate JSON object key, `null`, väärässä kohdassa oleva
  array/object, tuntematon kenttä ja prototype-key torjutaan
- suurempi byte- tai entry-raja vaatii uuden format- tai layout-version
  yhteensopivuuspäätöksen.

`activeWorkspaceId` saa olla `null` vain, kun rekisterissä ei ole yhtään
`ready`-työtilaa. Muulloin sen pitää viitata täsmälleen yhteen `ready`-entryyn.
`recoveryRequired`-entry ei saa olla aktiivinen business-runtime. Jos viimeinen
`ready`-entry siirtyy `recoveryRequired`-tilaan, osoitin vaihdetaan samassa
atomisessa registry-publishissa joko aiempaan todistettuun `ready`-työtilaan
tai `null`-arvoon. Puuttuvaan tai väärässä tilassa olevaan entryyn viittaava
osoitin torjutaan.

Rekisteriin ei tallenneta storage locatoria. Electron main johtaa työtilan
juuren aina suljetulla säännöllä
`<userData>/workspaces/<workspaceId>/` käyttäen vain validoitua
`workspaceId`:tä ja tunnettua `layoutVersion`-arvoa. Rekisteristä, rendereriltä
tai backupista ei hyväksytä absoluuttista tai suhteellista työtilapolkua.

`creating`, `candidate`, `importing`, `switching` ja `restoring` eivät ole
rekisterimerkinnän lifecycle-tiloja. Keskeneräinen operaatio kuuluu omaan
crash-safe, operaatiokohtaiseen journaliinsa. Rekisteriin julkaistaan vain
valmis `ready`-työtila tai jo julkaistun työtilan turvallisen avaamisen estävä
`recoveryRequired`-tila.

Rekisteri ei sisällä:

- yrityksen business-dataa
- asiakas- tai laskutietoa
- salasanaa, tokenia tai runtime-sessionia
- rendereriltä saatua tiedostopolkua
- backup-manifestin raakasisältöä
- `revision`-, `locator`-, `companyId`-, `actorId`-, `installationId`-,
  `secret`- tai `journal`-kenttää ilman uutta versionoitua päätöstä.

Installation-owned v1 -rekisterin kanoniset slotit ovat täsmälleen:

- `workspace-registry-v1.json`
- `workspace-registry-v1.json.next`
- `workspace-registry-v1.json.backup`.

Rekisterin kirjoitus on crash-safe ja versionoitu. Tuntematon versio,
duplikaatti `workspaceId`, duplikaatti lineage, puuttuva johdettu storage root,
virheellinen tila tai rakenne-/formaattivirhe estää työtilan avaamisen.

## Asennustasoinen maintenance-raja

Electron main omistaa tulevan `WorkspaceMaintenanceLease`-sopimuksen. Yhdessä
asennuksessa saa olla enintään yksi business-SQLite-omistaja myös create-,
import-, replace-, adopt-, switch-, update-, migration-, backup- ja restore-
operaatioiden aikana.

Lease serialisoi backup-, restore-, update- ja workspace-maintenance-
operaatiot. Tavallinen snapshot tai portable backup käyttää nykyistä yhtä
aktiivista SQLite-owneria eikä avaa candidate-tietokantaa. Create-, import-,
replace-, adopt-, switch- ja migration-polussa aktiivinen backend ja sen
SQLite-kahvat suljetaan ennen candidate-SQLiten avaamista.

Maintenance-operaatio:

1. varaa installation-scoped leasen ennen candidate-profiilin avaamista
2. estää uudet business-kirjoitukset ja odottaa rajatusti keskeneräiset työt
3. sulkee aktiivisen backendin, SQLite-yhteydet ja workspace-kahvat
4. avaa candidate-SQLiten vasta sulkeutumisen todistamisen jälkeen
5. sulkee failure-polussa candidate-kahvat ennen aiemman työtilan
   uudelleenkäynnistystä
6. vapauttaa leasen vasta terminal-tilassa.

Lease ei ole yleinen lukko rendererille eikä business-moduuleille. Se on
main-prosessin kapea process-lifecycle-sopimus, eikä epäonnistumisessa sallita
rinnakkaista vanhan ja uuden työtilan SQLite-omistajuutta.

## Tyhjän työtilan julkaiseminen

W2 toteuttaa tyhjän työtilan luomisen inerttinä platform-kyvykkyytenä. Se ei
vielä kytkeydy production-startupiin, preloadiin, IPC:hen tai UI:hin.

Electron main johtaa uuden opaque `workspaceId`:n, operation-scoped candidate-
juuren ja lopullisen `<userData>/workspaces/<workspaceId>/`-juuren. Backend
omistaa tyhjän SQLite-profiilin bootstrapin, migraatiot ja trusted-
tarkastuksen kapean `EmptyWorkspaceBootstrapPort`-sopimuksen takana. Electron
main ei avaa SQLitea eikä saa tietokantakahvaa.

Julkaisu tehdään kahdessa atomisessa rajassa:

1. validoitu same-volume candidate-root nimetään lopulliseksi työtilajuureksi
2. vasta tämän jälkeen W1-rekisteriin julkaistaan validoitu `ready`-entry.

Erillinen exact-key `WorkspaceCreationJournalV1` todistaa monotonisesti tilat
`prepared`, `candidateRootCreated`, `bootstrapCompleted`,
`candidateValidated`, `rootPublished` ja `registryPublished`. Journalissa ei
ole tiedostopolkuja, companyId:tä, actorId:tä, sessionia, salaisuuksia,
business-dataa tai raakaa virhettä. Crash recovery sovittaa journalin,
filesystemin ja rekisterin; ristiriitaa ei ratkaista arvaamalla eikä osittain
julkaistua työtilaa avata.

Jos valmis aktiivinen työtila on jo olemassa, uusi työtila julkaistaan
passiiviseksi. Ensimmäinen valmis työtila saa rekisterin active pointerin,
mutta inertti W2 ei vielä käynnistä sitä. Production-composition ja hallittu
aktivointi kuuluvat W4:ään.

## Hallittu workspace switch

Työtilan vaihto on maintenance-operaatio. Se etenee seuraavassa suljetussa
järjestyksessä:

1. main validoi lähde- ja kohde-`workspaceId`:t, varaa
   `WorkspaceMaintenanceLease`-leasen sekä estää rinnakkaisen backup-,
   restore-, update-, migration- ja switch-operaation
2. uudet business-kirjoitukset ja taustatehtävät estetään; keskeneräiset
   operaatiot viimeistellään tai vaihto torjutaan
3. PDF-esikatselut ja muut aktiiviseen työtilaan sidotut desktop-capabilityt
   suljetaan
4. backend lopettaa uusien pyyntöjen vastaanoton ja sulkeutuu hallitusti
5. SQLite-yhteyksien ja muiden workspace-tiedostokahvojen sulkeutuminen
   todistetaan
6. vanha runtime-session mitätöidään
7. secret-, archive-, backup-, recovery- ja muut workspace-adapterit
   vapautetaan
8. main kirjoittaa switch-journalin ja uuden aktiivisen osoittimen
   crash-safe candidate-vaiheeseen
9. kohteen adapterit ja backend koostetaan vain mainin validoidusta
   `workspaceId`:stä ja `layoutVersion`:stä johtamasta työtilajuuresta
10. kohteelle luodaan uusi runtime-session ja uusi ActorContext-bootstrap
11. health, SQLite integrity, foreign keys, migration chain, workspace/company
    identity ja auktoritatiivinen artifact-katalogi validoidaan
12. aktiivinen osoitin hyväksytään ja renderer ladataan uudelleen vasta
    onnistuneen validoinnin jälkeen.

Jos kohteen käynnistys epäonnistuu, main sulkee kohderuntimen ja palauttaa
edellisen rekisteriosoitteen sekä edellisen työtilan uutena runtimena. Jos
edellisen työtilan turvallista palautumista ei voida todistaa, sovellus menee
`recoveryRequired`-tilaan. Se ei arvaa työtilaa eikä avaa osittaista runtimea.

## Backupin tuonti ja olemassa olevan korvaaminen

Portable backup ei ole tietojen yhdistämisformaatti. Käyttäjälle tarjotaan
kaksi eri käyttötapausta.

### A. Tuo uutena työtilana

Tämä toiminto sallitaan vain, kun backupin validoitua lineagea ei ole
rekisterissä.

Tuonti käyttää nykyistä backup inspectoria formaatin, autentikoinnin,
kryptografian ja suljetun payloadin omistajana. Workspace import coordinator
omistaa järjestyksen, registry vain rekisterin ja backendin yksityinen
bootstrap-/inspection-portti SQLite-kahvan, migraatiot ja business-artifactien
validoinnin. Electron main ei avaa SQLitea.

Suljettu järjestys on:

1. validoi käyttäjän antama workspace-label
2. varaa installation-scoped maintenance lease tarkoituksella `import`
3. torju ratkaisematon import-journal ennen uuden backupin käsittelyä
4. validoi W3:n installation-scoped plaintext-karanteeni ja poista vain sen
   allowlistatut stale-payloadit
5. tarkasta ja autentikoi backup vain mainin omistaman yksityisen portin kautta
6. lue registry ja torju jo rekisteröity lineage
7. estä aktiivisen työtilan uudet kirjoitukset
8. sulje backend ja todista kaikkien aktiivisten SQLite-kahvojen sulkeutuminen
9. todista aktiivisen workspace-runtimen poissaolo
10. luo satunnaiset operation- ja workspace-tunnisteet
11. julkaise durable import-journal ennen candidate-juuren luontia
12. johda yksityinen, operation-scoped candidate-root vain mainin omista
    tunnisteista
13. autentikoi ja pura backup candidateen uudelleen
14. todista containerin SHA-256 sekä manifestin profile- ja migration-
    identiteetti samoiksi kuin ensimmäisessä tarkastuksessa
15. todista historiallinen migration-prefix
16. aja vain puuttuvat forward-migraatiot candidate-SQLitessa
17. aja SQLite integrity- ja foreign-key-tarkistukset
18. validoi company-, actor-, profile- ja lineage-identiteettien sopimus
19. validoi auktoritatiivisen PDF-/artifact-katalogin täydellinen sulkeuma
20. todista, ettei backupista tuoda salaisuuksia tai installation-statea
21. lue registry uudelleen ja torju kilpaileva lineage-julkaisu
22. nimeä validoitu candidate atomisesti lopulliseksi workspace-rootiksi
23. julkaise vasta tämän jälkeen `ready`-entry registryyn
24. säilytä aiempi aktiivinen osoitin, jos registryssä oli valmis työtila
25. jos valmista työtilaa ei ollut, osoita uusi entry aktiiviseksi käynnistämättä
    vielä runtimea
26. varmista aiempi runtime idempotentisti terveeksi, jos sellainen oli
27. poista import-journal vasta terminal-tilassa
28. vapauta maintenance lease.

Tuonti ei muuta aktiivista työtilaa ennen erillistä switchiä tai käyttäjän
vahvistamaa atomista aktivointia.

Ensimmäinen backup-tarkastus saa autentikoida containerin ja lukea suljetun
manifestin, mutta se ei saa avata SQLitea aktiivisen runtimen rinnalla.
Täysi SQLite- ja artifact-validointi tehdään vasta maintenance-leasen,
shutdownin ja runtime-absence-todisteen jälkeen. Samanaikaisia business-
SQLite-omistajia on aina enintään yksi.

W3:n decrypt-vaihe saa luoda vain canonical UUID v4 -nimisen, rajatun
plaintext-payloadin Electron mainin johtamaan installation-scoped
`workspace-operations/workspace-import-plaintext-quarantine`-juureen. Tämä
juuri ei ole työtilarekisteri, backup, candidate tai workspace-root. Normaali
`finally` poistaa payloadin. Prosessikaatumisen jälkeen W3-recovery hankkii
saman maintenance-leasen ja validoi sekä siivoaa vain allowlistatut stale-
payloadit myös silloin, kun import-journalia ei ole. Tuntematon nimi,
tiedostotyyppi, linkki, ylikokoinen payload tai epäselvä juuri pysäyttää
recoveryn `recoveryRequired`-tilaan; sisältöä ei poisteta arvaamalla.

W3 käyttää omaa exact-key `WorkspaceBackupImportJournalV1`-journalia, jonka
monotoniset tilat ovat `prepared`, `candidateRootCreated`, `backupStaged`,
`candidateMigrated`, `candidateValidated`, `rootPublished` ja
`registryPublished`. Journalissa ei ole lähdepolkua, salasanaa, avainta,
`companyId`:tä, SQL:ää, business-dataa, PDF-nimiä, sessionia eikä raakaa
virhettä. Lineage voidaan lisätä journaliin vasta täyden validoinnin jälkeen.

Restart-recovery ei tarvitse alkuperäistä backupia tai salasanaa. Se validoi
ja siivoaa plaintext-karanteenin heti leasen saamisen jälkeen ennen journalin
ratkaisua tai `nothingToRecover`-tulosta. Ennen
`rootPublished`-tilaa keskeytynyt tuonti sulkee candidate-kahvat ja poistaa tai
karanteenoi candidate-juuren, eikä jatka tuontia. `rootPublished`-tilassa
lopullinen root validoidaan uudelleen runtimen poissa ollessa ennen registry-
julkaisua. `registryPublished`-tilassa entryn, rootin ja lineagen vastaavuus
todistetaan ja journal poistetaan. Ristiriita johtaa `recoveryRequired`-
tilaan; tilaa ei päätellä tai korjata arvaamalla.

### B. Korvaa olemassa oleva työtila

Ensimmäisessä multi-workspace-versiossa korvaus sallitaan vain aktiiviselle
työtilalle ja täsmälleen samalle lineage identitylle. Jos käyttäjä haluaa
korvata passiivisen työtilan, hänen pitää ensin vaihtaa siihen hallitulla
workspace switchillä. Passiivista työtilaa ei avata kirjoitettavaksi samalla,
kun toinen työtila on aktiivinen.

1. main todistaa aktiivisen `workspaceId`:n ja paikantaa lineagea vastaavan
   ainoan rekisteröidyn työtilan
2. backup autentikoidaan ja exact lineage todistetaan ennen kirjoituksia
3. `replace`-maintenance-lease hankitaan ja registry sekä ratkaisemattomat
   update/import/create/switch/restore-operaatiot tarkistetaan uudelleen
4. aktiivisen runtimen hyväksytyt kirjoitukset quiesce-rajataan
5. työtilasta tehdään validoitu workspace-scoped pre-restore-palautuspiste,
   kun snapshot-broker ja nykyinen SQLite-owner ovat vielä hallitusti käytössä
6. aktiivinen runtime ja kaikki sen SQLite-kahvat suljetaan ja niiden poissaolo
   todistetaan
7. backup valmistellaan yksityiseen stagingiin ja migroidaan eteenpäin
8. kaikki samat identity-, SQLite-, migration- ja artifact-portit ajetaan
9. nykyinen restore activation journal julkaistaan ja aktiivinen sisältö
   korvataan atomisesti; tietueita ei yhdistetä
10. sama workspace käynnistetään uudella sessionilla ja validoidaan
11. failure palauttaa aiemman työtilan nykyisen activation transactionin
   rollback-rootista tai sulkee käytön `recoveryRequired`-
   tilaan.

Eri lineagea ei saa korvata olemassa olevan työtilan päälle. Jos sama lineage
löytyy rekisteristä useammin kuin kerran, operaatio pysähtyy rekisterin
eheysvirheeseen.

Korvaus käyttää samaa `ProfileRestoreActivationTransaction`- ja
`ProfileRestoreStartupRecovery`-auktoriteettia kuin nykyinen restore-polku,
mutta workspace-kohtaisilla poluilla. Erillistä W3b rollback-journalia tai
tiedostonsiirtomoottoria ei luoda. Registry-entryä, workspaceId:tä, labelia,
`createdAt`-arvoa, lineagea tai active pointeria ei muuteta.

## Migraatio- ja formaattiyhteensopivuus

Vanha työtila tai backup hyväksytään vain, kun sen migraatiohistoria on
nykyisen packaged manifestin todistettu historiallinen prefix:

- migraationimet ja järjestys täsmäävät
- lähde-SHA:t täsmäävät
- chain-SHA:t täsmäävät
- keskeltä ei puutu migraatiota
- tulevaa tai uudelleen kirjoitettua historiaa ei hyväksytä
- tunnettu legacy-ankkuri hyväksytään vain jo dokumentoidulla poikkeuksella.

Forward-migraatiot ajetaan ensin yksityisessä stagingissa. Aktivointi vaatii
onnistuneet `integrity_check`- ja `foreign_key_check`-tulokset, identiteetin,
migraatiometadatan, artifact-katalogin, PDF-hashien ja backend-readinessin.

Tuntematon backup-formaatti, future schema, changed history, missing middle,
reordered history, väärä lineage, vioittunut SQLite tai puuttuva artifact
torjutaan ennen aktiivisen työtilan muuttamista.

## Legacy 0.2.6 -työtilan adoptio

Nykyinen yhden työtilan 0.2.6-profiili adoptoidaan ensimmäisellä
multi-workspace-käynnistyksellä. Vaihtoehdot ovat:

1. **Adopt in place:** rekisteri osoittaa nykyiseen runtime-juureen.
   Ratkaisu säästää levytilaa, mutta yhdistää legacy installation-, workspace-
   ja transient-scopeja ja tekee keskeytyneen adoption rollbackista vaikean.
2. **Copy, validate, atomic switch:** nykyinen työtila kopioidaan yksityiseen
   candidate-workspaceen, validoidaan ja julkaistaan rekisteriin vasta lopuksi.
   Alkuperäinen säilyy koskemattomana, kunnes uusi runtime on todistettu.

Eky valitsee vaihtoehdon 2. Se on levytilaltaan kalliimpi, mutta pitää
adoption idempotenttina, estää scopejen sekoittumisen ja mahdollistaa
fail-closed-palautumisen. Adoption journal tunnistaa turvallisesti jo
valmistuneen, keskeytyneen ja rollbackia vaativan adoption.

## Update- ja installer-raja

Päivitys koskee yhtä asennusta ja kaikkia sen työtiloja. Update journal,
accepted build, MSI-paketit ja package cache eivät siirry workspace switchissä.

Työtilan vaihto, tuonti, korvaus ja adoptio estetään, jos update-, preUpdate-,
MSI-handoff-, first-start- tai binary rollback -tila on ratkaisematta.

Version N+1 first start toimii seuraavasti:

1. rekisterin rakenne, yksikäsitteisyys ja aktiivinen osoitin validoidaan
2. työtilojen migraatiohistoriat tarkastetaan yksi kerrallaan read-only-tilassa
3. vain aktiivinen työtila saa preMigration-palautuspisteen, migraation ja
   normaalin backend-readinessin first-startissa
4. passiiviseen työtilaan ei kirjoiteta eikä sitä migroida hiljaisesti
5. passiivinen työtila migroidaan vasta ensimmäisellä aktivointiyrityksellä
   installation-scoped maintenance-leasen ja workspace-scoped
   preMigration-palautuspisteen takana
6. tuntematon, future-, changed- tai missing-middle-historia estää kyseisen
   passiivisen työtilan avaamisen ja asettaa sen `recoveryRequired`-tilaan;
   muita työtiloja ei muuteta eikä virheellistä historiaa arvata
7. release hyväksytään aktiiviselle runtimelle vasta sen nykyisten
   first-start-porttien jälkeen; passiivisen `recoveryRequired`-työtilan tila
   näytetään turvallisesti ennen switchiä.

Kaikki tarkastukset ja migraatiot noudattavat yhden business-SQLite-omistajan
rajaa. Yhden työtilan failure ei saa johtaa muiden hiljaiseen migraatioon,
väärän työtilan avaamiseen tai installation-päivitystilan siirtymiseen
workspace-backupiin.

## PDF-arkiston workspace-eristys

Käyttäjä valitsee PDF-arkistoinnille ulkoisen arkistojuuren. Electron main
muodostaa varsinaisen työtilakohtaisen kohteen aina muodossa
`<archiveRoot>/<workspaceId>/`. Renderer ei saa muodostaa alikansiota eikä
antaa arkistointitehtävälle polkua.

Arkistojuuren asetus ja retry-journal ovat workspace-kohtaista device-local-
tilaa. Työtilan vaihto vaihtaa käytettävän asetuksen ja journalin. Sama
laskutiedoston nimi ei saa törmätä toisen työtilan kopioon, eikä workspace A:n
kopio saa näkyä workspace B:n arkiston namespacessa. Ulkoinen arkistokopio on
edelleen ei-auktoritatiivinen eikä arkistojuurta, asetusta tai journalia
siirretä portable backupissa.

## Käyttäjät ja käyttöoikeudet

W0-W6 eivät lisää käyttäjiä, kirjautumista, Employee/Worker-identiteettiä,
membershipejä, rooleja, permissioneja, pilvitenantteja tai mobiilikäyttöä.

Nykyinen local-owner-bootstrap säilyy. Jokainen uusi backend-runtime muodostaa
silti `ActorContext`:n aktiivisen työtilan vahvistetusta identitystä ja
permissionit tarkistetaan deny-by-default kuten ennenkin.

## Työtilan poistaminen

Työtilan poistaminen siirretään W7-vaiheeseen. Ensimmäinen multi-workspace-
release ei poista työtiloja.

Tuleva poisto vaatii vähintään:

- työtilan sulkemisen ja kirjoitusten eston
- tuoreen validoidun backupin tai nimenomaisen riskihyväksynnän
- typed confirmationin työtilan näkyvällä nimellä
- Electron mainin native-vahvistuksen
- quarantine-vaiheen ennen lopullista poistoa
- salaisuusnamespaceen, recovery pointteihin ja ulkoisiin artifacteihin
  liittyvän eksplisiittisen cleanup-sopimuksen.

## Seuraukset

Hyödyt:

- useat yritykset eivät jaa tietokantaa, sessionia tai business-artifactteja
- vanha yhden työtilan malli voidaan adoptoida ilman in-place-riskin kasvua
- backupin tuonti ja korvaava restore ovat eri, ymmärrettäviä toimintoja
- installer ja update säilyvät asennustason vastuuna
- web-, domain- ja application-kerrokset eivät riipu Electronin poluista.

Kustannukset:

- runtime switch on process lifecycle, ei kevyt UI-state-muutos
- adoptio tarvitsee tilapäisesti ylimääräistä levytilaa
- backup-, recovery-, secret- ja archive-adapterit on myöhemmin koostettava
  työtilakohtaisesti
- release gate tarvitsee kahden työtilan ja vanhan 0.2.6-profiilin packaged
  todistukset.

## Rajauksen ulkopuolelle jää edelleen

- työtilan valinta- tai hallinta-UI:ta
- tietokanta- tai backup-formaattimuutosta
- samanaikaista usean työtilan runtimea
- työtilojen tietojen mergeä
- cloud tenant-, identity- tai permission-mallia
- työtilan poistoa
- uutta riippuvuutta.

## Liittyvät dokumentit

- `AGENTS.md`
- `apps/desktop/AGENTS.md`
- `docs/architecture/local-company-workspace-plan.md`
- `docs/architecture/local-backup-and-restore-plan.md`
- `docs/architecture/local-invoice-pdf-archive-plan.md`
- `docs/architecture/local-runtime-trust-and-authorization-plan.md`
- `docs/architecture/module-integration-matrix.md`
- `docs/architecture/r0-e2e-test-matrix.md`
- `docs/architecture/windows-installer-and-update-plan.md`
- `docs/decisions/ADR-0006-local-database-and-query-layer.md`
- `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`
- `docs/decisions/ADR-0008-local-desktop-company-workspaces.md`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
