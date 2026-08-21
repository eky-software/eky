# Moduulien Integraatiomatriisi

Tämä dokumentti on Eky-moduulien ja platform-kyvykkyyksien ylläpidettävä
arkkitehtuurikartta. Se täydentää moduulien omia `docs/modules/`-dokumentteja,
ADR-päätöksiä ja composition root -koodia. Matriisi ei ole runtime-rekisteri,
automaattinen discovery, code generator, event bus tai service locator.

`implemented` tarkoittaa, että rivi on johdettu nykyisestä koodista.
`planned` tarkoittaa suunnittelusuuntaa; planned-rivi ei lukitse vielä
TypeScript-rajapintaa, permission-nimeä, tietokantataulua tai adapteria.
`not applicable` tarkoittaa, ettei vastuu kuulu kyseiselle riville.
`open` tarkoittaa päätöstä, jota ei pidä arvata toteutuksessa.

## Ylläpitosääntö

- Uusi moduuli lisää oman rivinsä ennen cross-module-toteutusta.
- Julkisen cross-module-sopimuksen muutos päivittää sekä tarjoajan että
  kuluttajan rivin.
- Composition rootin, permissionin, backup/restore-sopimuksen tai moduulin
  omistajuuden muutos päivittää asianomaisen rivin.
- Tavallinen moduulin sisäinen toteutusmuutos ei vaadi matriisidiffiä.
- Matriisi kuvaa nykyiset rajat; se ei saa muuttua vaihtoehtoiseksi
  toteutusohjeeksi tai piilottaa avoimia päätöksiä.

## Liiketoimintamoduulit

| Moduuli | Status | Omistaa | Ei nimenomaisesti omista | Composition root | Tarjoaa julkisesti | Kuluttaa julkisesti | Cross-module-luvut | Cross-module-komennot / kirjoitukset | Permissionit | Business audit | Operational / security -eventit | Activity-projektio | Diagnostics-projektio | Support bundle | Incident index | Backup inclusion / exclusion | Artifact catalog | Restore-validator ja yhteensopivuus | Web / desktop / mobile -adapteri | Kriittinen cross-module E2E-näyttö |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customers | implemented | Asiakas-master data, asiakasnumero, tyyppi, isännöintisuhde, yhteystiedot, osoite, tuntihintaohitus ja tila yritysrajattuna | Laskut, kohteet, työmääräykset, kirjaukset, varasto ja raportointi | `apps/backend/src/composition/customersComposition.ts` | HTTP/customer API, `CustomerAccessReader`, `InvoiceCustomerTaxProfileReader`, `CustomerActivityReader` | Ei nykyistä business cross-module -porttia | Ei nykyistä | Ei nykyistä | Nykyiset customer CRUD -reitit käyttävät vahvistettua `ActorContext`-rajaa; erillistä customer-permissionia ei ole vielä nimetty | `customer_audit_events`, moduulin omistama | Turvalliset HTTP/runtime-eventit yhteisen backend-observabilityn kautta | Kyllä, `CustomerActivityReader` | Vain yhteisen operational-projektion kautta | Warn/error/security-politiikan mukaan; ei customer-master dataa | Vain tekninen failure/security; ei customer-tunnisteita | SQLite-profiili sisältyy; operational-logit ja salaisuudet eivät | Ei erillistä tiedostoartifactia | Yhteinen SQLite snapshot-, migraatio- ja profile validation -ketju | Web feature + API-client; desktop käyttää samaa web-sovellusta; mobile planned | Customer create/read/update ja customer-to-invoice-hinnoittelu nykyisessä E2E-matriisissa |
| Company Settings | implemented | Oman yrityksen master data, pankki- ja yhteystiedot, oletustuntihinta, pikavalinta ja ei-salaiset yleisasetukset | Asiakkaat, laskut, laskutuksen domain-asetukset, laskusnapshotit ja SMTP-salaisuusarvo | `apps/backend/src/composition/companySettingsComposition.ts` sekä desktopin secret broker -composition | HTTP/settings API, `InvoiceEmailSettingsReader`, `CompanySettingsActivityReader`, kapea email secret status/store -sopimus | OS-profiilin `CompanyEmailSecretStore` ja status-luku compositionista | Ei business cross-module -lukua; secret status adapterilta | Ei kirjoita toisen business-moduulin dataa | `manageCompanySettings`, `manageCompanyEmailSettings`, `manageCompanyEmailSecret` | `company_settings_audit_events` ja `company_email_secret_audit_events` | Secret lifecycle- ja audit failure -eventit ilman salaisuutta | Kyllä, `CompanySettingsActivityReader` | Vain turvalliset tekniset projektiot | Warn/error/security-politiikan mukaan; ei salaisuutta tai asetusten arvoja | Vain tekninen failure/security ilman tunnisteita | SQLite-master data sisältyy; `safeStorage`-salaisuusblob ei sisälly siirrettävään backupiin | Ei business-tiedostoartifactia; salaisuus on konekohtainen ja erillinen | SQLite yhteisessä profile validatorissa; secret store ei palaudu backupista | Web feature + API-client; Electron main omistaa secret-capabilityn; mobile planned | Company settings + invoice defaults/email integration ja secret-boundary E2E |
| Invoicing | implemented | Luonnokset, laskut, rivit, ALV, numerointi, maksut, snapshotit, dokumentit, toimitukset, korjaukset ja laskutuksen audit | Customer-master data, oman yrityksen master data, SMTP-salaisuudet, paikallinen arkistokansio ja retry-journal | `apps/backend/src/composition/invoicingComposition.ts` | HTTP/invoicing API, `InvoiceActivityReader`, `InvoiceBackupArtifactCatalog`, toimitus- ja PDF-sopimukset | `CustomerAccessReader`, `InvoiceCustomerTaxProfileReader`, `InvoiceEmailSettingsReader`, `CompanyEmailSecretReader`, `DeliveredInvoiceArchiveTaskSink` | Customersin laskutusprofiili ja Company Settingsin email/master-oletukset kapeiden porttien kautta | Arkistotehtävä vain `DeliveredInvoiceArchiveTaskSink`-porttiin; ei suoraa toisen business-moduulin kirjoitusta | `manageInvoiceSettings`, `manageInvoiceNumberingSeries`, `manageInvoiceCorrections`, `manageInvoicePayments`, `sendInvoices` sekä vahvistettu ActorContext | Invoice-, settings-, payment-, delivery- ja correction-audit moduulin omissa tauluissa/transaktioissa | Invoicing/SMTP/PDF/archive-eventit yhteisen katalogin mukaan | Kyllä, `InvoiceActivityReader` | Turvalliset tekniset projektiot; ei laskusisältöä | Warn/error/security-politiikan mukaan; ei lasku-, asiakas- tai pankkidataa | Vain failure/security-minimointi; ei invoice-, document- tai delivery-tunnisteita | SQLite-laskutusdata ja auktoritatiiviset current PDF:t sisältyvät; toimitettu PDF-arkistokopio ei ole backup | `InvoiceBackupArtifactCatalog` luetteloi `invoice_documents`-artifactit | Catalog, SHA-256, SQLite- ja artifact-vertailu sekä julkaistujen migraatioiden yhteensopivuus | Web feature + API-client; desktop PDF/email/archive-capabilityt; mobile planned | Draft -> approve -> PDF -> delivery -> sent, payment, correction/credit ja archive E2E |
| Activity | implemented | Turvallinen, yhdistetty ja vain lukuun tarkoitettu business activity -read model | Audit-kirjoitukset, audit-taulut, business data ja tekniset lokit | `apps/backend/src/composition/activityComposition.ts` | HTTP/activity API | `CustomerActivityReader`, `CompanySettingsActivityReader`, `InvoiceActivityReader` | Yritysrajatut turvalliset audit-projektiot kolmelta moduulilta | Ei kirjoituksia | `viewActivity` | Ei omaa auditia | Ei kirjoita operational/security-eventtejä | On itse Activity-projektio | Ei kuulu Diagnosticsiin | Ei kuulu tukipaketin tekniseen dataan | Ei kuulu incident-indeksiin | Oma dataa ei ole; lähdemoduulien audit sisältyy SQLite-profiiliin | Not applicable | Lähdemoduulien SQLite-validatorit; read model rakennetaan uudelleen | Web feature + API-client; desktop käyttää samaa web-sovellusta; mobile open | Yritysraja, kuukausi-, tulos- ja moduuliprojektiot E2E-matriisissa |
| Diagnostics | implemented | Turvallinen, vain lukuun tarkoitettu runtime-, operational- ja security-projektio sekä support bundle -backend-data | Operational-lokien kirjoitus, business audit, business data, desktop capabilityt ja support bundle -tiedostopolku | `apps/backend/src/composition/diagnosticsComposition.ts` ja desktop support bundle -composition | HTTP/diagnostics API ja main-only support bundle -read model | Kiinteä logs-root, SQLite system summary ja incident-index-readerit | Lukee vain validoituja teknisiä lähteitä; ei business-moduulien master dataa | Ei kirjoituksia | `viewDiagnostics`, `createSupportBundle` | Ei omaa auditia | Ei kirjoita tapahtumia; projisoi suljetun allowlistan | Ei kuulu Activityyn | On itse Diagnostics-projektio | Kyllä, vain warn/error/security ja minimoitu runtime-yhteenveto | Lukee minimoitua failure/security-indeksiä; ei lisää tunnisteita | Operational-logit, tukipaketit ja incident index eivät kuulu business-backupiin | Not applicable | Ei palaudu business-backupista; lähteet validoidaan joka luvulla | Web feature + API-client; Electron main omistaa lokikansion ja tukipaketin; mobile ei toteutettu | Diagnostics API, packaged UI ja support bundle create/inspect -smoke |
| Sites | planned | Päätetään ennen toteutusta moduulidokumentissa | Ei saa omia Customersin tai Invoicingin dataa | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | web/mobile planned; desktop mahdollinen | open |
| Work Orders | planned | Työmääräysten elinkaari suunnittelutasolla | Ei omista customer-master dataa, laskuja tai kirjattujen tuntien alkuperäistä vastuuta ilman erillistä päätöstä | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | web/mobile planned; desktop mahdollinen | open |
| Work Entries | planned | open | Ei omista laskua tai työmääräystä | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | mobile/web planned | open |
| Material Entries | planned | open | Ei omista varastosaldoa tai laskua | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | mobile/web planned | open |
| Inventory | planned | Varastosaldot ja varastotapahtumat suunnittelutasolla | Ei omista materiaalikirjausten tai laskujen alkuperäistä dataa | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | web/mobile planned | open |
| Accounting | planned | open | Ei päätetty | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open |
| Reporting | planned | Johdetut raportit ja read modelit suunnittelutasolla | Ei omista lähdemoduulien master dataa tai kirjoituspolkuja | open | open | open | open | Ei kirjoituksia lähdemoduuleihin ilman erillistä application-sopimusta | open | open | open | open | open | open | open | open | open | open | web planned | open |

## Platform- Ja Infrastructure-Kyvykkyydet

| Kyvykkyys | Status | Omistaa | Ei nimenomaisesti omista | Composition root | Tarjoaa julkisesti | Kuluttaa julkisesti | Cross-module-luvut | Cross-module-komennot / kirjoitukset | Permissionit | Business audit | Operational / security -eventit | Activity-projektio | Diagnostics-projektio | Support bundle | Incident index | Backup inclusion / exclusion | Artifact catalog | Restore-validator ja yhteensopivuus | Web / desktop / mobile -adapteri | Kriittinen cross-module E2E-näyttö |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime Trust | implemented | Local runtime session bootstrap, vahvistettu identity ja ActorContext | Business-data, permission-päätökset ja rendererille näkyvä session | Backend `createApp` + desktop runtime composition | Runtime trust middleware / ActorContext | Desktop mainin muistissa luotu session | Paikallisen identityn luku SQLite-profiilista | Ei business-kirjoituksia | Deny by default; permissionit välitetään vahvistettuun kontekstiin | Ei | Runtime session -security-eventit | Ei | Kyllä, turvallinen projektio | Security-politiikan mukaan | Security-minimointi | Runtime-session ei kuulu backupiin | Not applicable | Local identity kuuluu SQLite-profiiliin; session luodaan uudelleen | Desktop main + backend; browser dev on rajattu poikkeus; cloud/mobile planned | Session boundary system/security E2E ja packaged smoke |
| Permissions | implemented | Suljettu permission-union ja backendin require-check | Käyttäjäidentiteetti, UI:n näkyvyys tai business-säännöt | `packages/permissions` + module HTTP/application boundaries | `Permission`, `requirePermission` | ActorContextin permissionit | Ei | Ei | Suljettu allowlist | Ei | Denied-pyynnöt yhteisen operational/security-politiikan mukaan | Ei | Kyllä vain teknisestä tapahtumasta | Security-politiikan mukaan | Security-minimointi | Ei omaa persistenttiä dataa | Not applicable | Not applicable | Backend; UI voi vain peilata käytettävyyttä | Permission-deny system/security E2E |
| Identity / Users / Memberships | planned | User-identiteetit, yritysjäsenyydet, roolien liittäminen jäsenyyteen ja tuleva identity-adapteriraja | Employee/Worker-business-master data, moduulien business-säännöt tai nykyinen local-owner-bootstrap | open | Vahvistettu identity ja aktiivinen membership ActorContextille | Tuleva identity provider sekä nykyinen Permissions-platform | Yritysjäsenyyden ja aktiivisen yrityskontekstin rajattu luku | Käyttäjä-, jäsenyys- ja roolimuutokset vain tulevien application-palvelujen kautta | Tulevat permissionit päätetään käyttötapauksittain; deny by default | Membership- ja permission-muutokset planned | Identity/session-security-eventit planned ilman henkilötietoa | Planned turvallinen hallintaprojektio, ei nykyiseen Activityyn automaattisesti | Planned turvallinen identity/runtime-projektio | Security-politiikan mukaan; ei tokenia tai henkilötietoa | Planned failure/security-minimointi | Päätetään ennen persistenttiä toteutusta; salaisuudet ja sessionit excluded | Not applicable | Identity-, membership- ja session-yhteensopivuus päätetään ennen cloud/mobilea | Backend/cloud/mobile planned; desktopin local-owner säilyy erillisenä bootstrapina | Toinen käyttäjä, mobile login, tenant/membership deny ja session invalidation planned |
| Observability | implemented | Backend/desktop operational event catalogit, JSONL-streamit, retention ja incident-minimointi | Business audit, Activity ja business-operaation tulos | Backend `createApp`, desktop `desktopComposition` | Kapeat typed logger/observer -portit | Runtime-identiteetti ja kiinteä logs-root | Ei business-lukuja | Kirjoittaa vain teknisiä tiedostovirtoja | Lokien katselu Diagnostics-permissioneilla | Ei | On itse operational/security-lähde | Ei | Diagnostics projisoi suljetusti | Warn/error/security nykyisen politiikan mukaan | Vain failure/security ilman suoria tunnisteita | Lokit ja incident index excluded | Not applicable | Ei palauteta | Backend + Electron main; rendererillä ei log-write API:a | Observability integration, privacy ja packaged support bundle smoke |
| Profile Protection / Backup / Restore | implemented | Portable backup, recovery points, restore staging/activation/rollback ja recovery journal | Business-moduulien datan semantiikka, installer/update ja support bundle | Desktop `desktopComposition` + backend profile snapshot registration | Rajatut IPC-capabilityt, snapshot broker ja recovery service -sopimukset | SQLite snapshot service ja Invoicing artifact catalog | Lukee vain moduulin ilmoittaman catalogin ja validoidun snapshotin | Maintenance-, snapshot-, staging- ja activation-komennot kapeiden brokerien kautta | Trusted main frame; ei renderer-polkuja tai avaimia | Ei | `backup.*`, `recoveryPoint.*`, `restore.*`; `restore.activationFailed` sulkee epäonnistuneen aktivoinnin ja `restore.recoveryRequired` nimeää manuaalista palautusta vaativan tilan; observer on best effort eikä muuta operaation tulosta | Ei | Turvallinen projektio | Vain warn/error/security | Vain minimoitu failure ilman correlation/runtime/business-tunnisteita | Omistaa backup-formaatin ja recovery pointit; ei support bundlea, secret blobia, archive-kopiota tai update-artifactia | Invoicing tarjoaa nykyisen business-file-catalogin | Formaatti-, AEAD-, manifesti-, SQLite-, migraatio-, catalog- ja health-validointi ennen aktivointia | Electron main; backend snapshot broker; web näyttää vain desktop capabilityn; mobile ei | Hardened Windows backup -> inspect -> restore -> restart -> compare -smoke sekä activation/rollback-fault-regressiot |
| Local Company Workspace Registry / Coordinator | W1-W4 runtime foundation, W5A main-owned management foundation and W5B.1 selector implemented; W5B.2 active replace UI and W6 packaged release gate pending | Täsmällinen installation-scoped registry v1, opaque `workspaceId`, johdettu workspace-root, yksi aktiivinen osoitin, erilliset operation-journalit sekä hallittu create/import/replace/switch/adoption/rename-lifecycle | Yrityksen business-data, `companyId`, käyttäjän antama storage locator, backup-container, salaisuuden arvo, pilvitenant tai update-binaarit | Electron mainin production-startup ratkaisee/adoptoi aktiivisen workspacen ennen sessionia ja backendia; W5A:n management-palvelu sekä W5B.1:n capability- ja lifecycle-adapterit on koostettu | Versionoidut status/create-empty/import-as-new/switch/rename-capabilityt trusted main framelle; active replace ei ole rendererille avoin | Profile Protection, Runtime Trust, backend lifecycle, workspace-bound adapterit, yksi main-owned `WorkspaceMaintenanceLease` ja installation-scoped update gate kapeiden porttien kautta | Registry lukee strict v1 -minimimetadatan; bootstrap/adoption palauttaa vain validoidun readiness- ja lineage-tuloksen, ei SQLite-kahvaa | Maintenance lease quiesce-rajaa kirjoitukset; preRestore luodaan ennen snapshot-brokerin sulkemista; tämän jälkeen vanhat ikkunat, capabilityt, backend, SQLite-kahvat, session ja adapterit suljetaan ennen candidatea; enintään yksi business-SQLite-owner | Vain trusted main frame; renderer käyttää mainin turvallisesta projektiosta saatua workspaceId:tä, ja business-permissionit tarkistetaan uudessa ActorContextissa | Ei business auditia | Workspace lifecycle -eventit ilman polkua, companyId:tä, lineagea tai business-dataa | Ei | W5B.1:n rajattu installation/runtime-projektio | Ei registryä, lineagea, polkua tai business-dataa | Turvallinen failure/security-minimointi | Registry, active pointer, operation-journalit ja update state excluded; yksi workspace = yksi immutable companyId/SQLite/artifact-backup; secret ja archive config device-local | Kukin työtila käyttää omien moduuliensa artifact-catalogeja | Tyhjä candidate validoidaan ennen julkaisua; import uutena vain rekisteröimättömälle lineagelle; replace vain aktiiviselle exact-lineage-työtilalle; legacy-adoptio copy -> validate -> atomic publish | Electron main omistaa startupin, runtimen ja native backup/password -rajat; web näyttää W5B.1-valitsimen desktop-capabilityn kautta ja turvallisen fallbackin selaimessa; cloud/mobile eivät käytä local registryä | W1-W4 registry-, coordinator-, adoption- ja startup-testit, W5A management proof sekä W5B.1:n A -> B -> A-, encrypted import-, cancel- ja no-leak Electron-E2E toteutettu; full `WORKSPACE-ADOPTION/ISOLATION/SECRETS/LIFECYCLE/UPDATE/ARCHIVE-001` packaged proof W6:ssa; delete deferred W7 |
| PDF Archive | implemented; W4 workspace namespace active, W6 packaged isolation proof pending | Käyttäjän valitseman toimitettujen PDF-kopiohakemiston config, queue ja retry-journal; mainin johtama `<archiveRoot>/<workspaceId>/`-namespace | Auktoritatiivinen invoice PDF, laskun tila, backup tai rendereriltä saatu workspace-polku | Desktop `desktopComposition` + Invoicingin task sink | `DeliveredInvoiceArchiveTaskSink` backendille ja rajattu desktop capability | Invoicingin current PDF/download + delivery task | Vain tarkasti sidottu dokumentti/task | Kirjoittaa aktiivisen työtilan johdettuun kansioon ja workspace-journaliin; ei muuta toimitusta | Trusted desktop capability | Ei | `invoicePdfArchive.*` | Ei | Turvallinen failure/success-projektio | Failure-politiikan mukaan | Failure ilman business/polku-tunnisteita | Arkistokopio, root-asetus ja journal excluded; eivät ole backup | Not applicable | Ei palauteta business-backupista | Electron main + Company Settings -UI | Workspace-namespace- ja no-overwrite-testit toteutettu; full `WORKSPACE-ARCHIVE-001` packaged proof W6:ssa |
| Desktop Shell | implemented | Electron main, preload-allowlist, custom protocol, backend lifecycle, ikkunat ja OS-capabilityt | Domain, business-säännöt ja rendererin yleiset OS-oikeudet | `apps/desktop/src/main/desktopComposition.ts` | Kapeat preload/IPC-capabilityt ja paikallinen protokolla | Backend/API, Electronin hyväksytyt API:t | Ei suoria business-module importteja rendererissä | Käynnistää/valvoo backendin ja suorittaa rajatut OS-operaatiot | Trusted main frame + suljetut IPC-validatorit | Ei | Desktop/runtime/security-eventit | Ei | Kyllä | Warn/error/security-politiikan mukaan | Failure/security-minimointi | Desktop binaarit eivät kuulu business-backupiin | Not applicable | Päivitys ja rollback erillisen ADR-0010-portin takana | Desktop | Windows Electron critical E2E ja packaged smoke |
| Update Coordinator | foundation implemented | C1 omistaa strict pakettitarkastuksen, vaihdettavan trust-policyn, private staging/cachen ja current rollback -paketin rekisteröinnin; C2/C3 lisäävät journalin, pre-update-pisteen, handoffin, first-startin ja rollbackin | Business-datan migraatioiden reverse SQL, business backup, yritysprofiilien sisäiset polut ja asennusavaimet repossa | `apps/desktop/src/update/` composition | Nimetty `selectLocalUpdate()` ja myöhemmät confirm/apply/status-capabilityt | C1: build identity, manifest/MSI-inspektori ja installation-scoped cache; myöhemmin Profile Protection, runtime maintenance/shutdown, installer launcher ja journal | C1 ei lue yritysprofiilia tai business-dataa | C1 ei käynnistä asentajaa eikä kirjoita yritysprofiiliin | Trusted desktop capability; renderer ei anna polkua, executablea, argumentteja tai manifestia | Ei | Suljettu update lifecycle -eventtikatalogi C3:ssa | Ei | Planned turvallinen projektio | Planned politiikan mukaan | Planned failure/security-minimointi | Update-artifact ja binaarit excluded business-backupista; update koskee koko asennusta, ei yhtä profiilia | R0 strict local unsigned pilot metadata; signed package metadata future | ADR-0010:n package-, first-start-, per-profile migration- ja recovery-portit | Desktop foundation; UI piilossa C3:een asti | C0 cold-start ja C1 manifest/MSI/trust/staging/current-regressiot valmiit 11.8.2026; full update/rollback packaged E2E C2/C3 |
| Mobile Sync | planned | open | Ei saa ohittaa module application-, permission- tai tenant-rajoja | open | open | open | open | open | open | open | open | open | open | open | open | open | open | open | mobile planned | open |
| AI Agent Coordination | planned | Agenttien rajattu toimijuus ja jäljitettävä orchestration päätetään myöhemmin | Ei saa ohittaa domain-, permission-, tenant-, audit- tai API-rajoja | open | open | open | open | Vain omistavan moduulin application-sopimusten kautta | open | open | open | open | open | open | open | open | open | open | backend/cloud planned | open |

### Local Workspace W2.1 -checkpoint

W2.1 pitää workspace foundationin edelleen inerttinä ja production-buildistä
sekä package-payloadista suljettuna. Creation käyttää neutraaleja
`WorkspaceMaintenanceLease`-, `ActiveWorkspaceLifecyclePort`-,
`WorkspaceRuntimeAbsencePort`- ja `WorkspaceRegistryPort`-sopimuksia.
Quiescen jälkeen jokainen failure-polku varmistaa idempotentisti täsmälleen
yhden terveen aiemman runtimen, ja startup-recovery validoi julkaistua
työtilaa vasta runtimen todistetun poissaolon jälkeen.

W1-rekisteri ja W2-creation-journal säilyvät erillisinä persistence-vastuina.
W3 saa käyttää yhteisiä neutraaleja workspace-portteja, mutta se ei saa
kopioida niiden atomic-slot-toteutusta kolmatta kertaa eikä yhdistää
registry-, creation- ja import-semanttiikkaa geneeriseksi persistence-
kehykseksi. Mahdollinen kapea atomic-slot-primitive arvioidaan erikseen vasta
W3:n todellisen tarpeen perusteella.

### Local Workspace W3 -sopimus

W3 tuo autentikoidun, rekisteröimättömän lineagen uutena passiivisena
työtilana. Backup inspector omistaa containerin, workspace coordinator
järjestyksen, registry julkaisun ja backendin yksityinen import-portti
SQLite-/migration-/artifact-validoinnin. Electron main ei avaa SQLitea.

Ensimmäinen container-tarkastus ei avaa kantaa. Toinen tarkastus tehdään
maintenance-leasen ja aktiivisen runtimen todistetun sulkemisen jälkeen;
containerin sekä manifestin identiteetti ei saa muuttua tarkistusten välissä.
Candidate-root julkaistaan ennen registry-entryä. Uusi entry ei syrjäytä
olemassa olevaa aktiivista työtilaa eikä W3 käynnistä uutta runtimea.

W3 käyttää import-kohtaista journalia ja vain kapeaa yhteistä raakatavujen
atomic-slot-primitiiiviä. Registry-, creation- ja import-skeemoja,
tilakoneita, serializer-logiikkaa tai virheitä ei yhdistetä. W3b-korvaus,
W4-switch, legacy-adoptio ja käyttäjärajapinta eivät kuulu W3:een.

### Local Workspace W3b -sopimus

W3b korvaa vain aktiivisen `ready`-workspacen autentikoidusta exact-lineage-
backupista. Workspace replacement coordinator omistaa järjestyksen ja käyttää
W3:n backup-container- sekä private candidate -portteja, registryltä luettua
lineage-auktoriteettia, workspace-kohtaista preRestore-porttia ja nykyistä
restore activation transactionia. Electron main ei avaa SQLitea eikä backupin
business-arvoja käytetä oikeutuksena.

Korvaus vaihtaa koko portable business snapshotin atomisesti; se ei mergeä
tauluja, rivejä tai tiedostoja. Registry-entry ja active pointer säilyvät
muuttumattomina. Device-local SMTP/safeStorage-, PDF-arkisto-, update-,
diagnostiikka- ja lokitiedot sekä muiden workspacejen rootit ja palautuspisteet
eivät kuulu transactioniin. Failure palauttaa kohteen tietokannan ja
auktoritatiiviset artifactit byte-identtisesti ennen vanhan runtimen
terveystodistetta.

W3b on inertti foundation. Production-composition, todellinen Electron-
prosessilifecycle, preload/IPC/UI sekä legacy-adoptio kuuluvat W4:ään.

### Local Workspace W4 -checkpoint

W4 aktivoi Electron mainin production-startupissa installation-scoped
registry- ja active-pointer-ratkaisun sekä vanhan yhden profiilin
kertaluonteisen adoption. Aktiivinen workspace ratkaistaan ennen runtime-
sessionia, backendia ja workspace-bound-adaptereita. Business-SQLite,
lasku-PDF:t, snapshotit, salaisuusblob, PDF-arkiston config/journal sekä
backup/recovery-tila käyttävät aktiivisen workspacen johdettua rootia.

Operational-lokit, tukipaketit, update state ja packaged-smoke säilyvät
installation-scoped-tilana. PDF-arkiston ulkoinen juuri on device-local, mutta
kopiot kirjoitetaan vain mainin johtamaan `<archiveRoot>/<workspaceId>/`-
namespaceen. W4 ei paljasta registryä, polkuja tai privileged-operaatioita
rendererille. Mainin sisäinen W5A management-foundation on toteutettu;
hallintacapability sekä UI kuuluvat W5B:hen ja active/passive N ->
N+1 sekä full packaged isolation/recovery -matriisi kuuluvat W6:een.

### Local Workspace W5A -checkpoint

W5A koostaa Electron mainiin rajatun workspace management -palvelun,
production-lifecycle- ja private candidate -adapterit sekä saman
installation-scoped `WorkspaceMaintenanceLease`-instanssin, jota backup,
restore ja update vartioivat omien moduulirajojensa lisäksi. Create, import,
replace, switch ja rename on todennettu kohdetesteillä ja nykyisen
desktop-version Electron composition proofilla. Proof palauttaa vain suljetun
turvallisen projektion, johtaa lopulliset työtilamäärät registry-identiteeteistä
ja todentaa täsmällisen relaunch-deltan sekä proofin omistamien utility-
prosessien poistumisen. Renderer-, IPC-, preload-, web- tai public HTTP
-capabilitya ei ole avattu; ne kuuluvat W5B:hen. Täysi packaged usean
workspacen release-portti kuuluu W6:een.

### Local Workspace W5B.1 -checkpoint

W5B.1 avaa trusted main framelle vain viisi versionoitua ja strictiä
workspace-capabilitya: status, create empty, import backup as new, switch ja
rename. Electron main omistaa native backup -valinnan, salasanan ja runtimen
relaunch-lifecyclen. Preload ja web bridge eivät paljasta polkuja, `companyId`-
tai lineage-arvoja, runtime-sessionia, journalia tai salaisuuksia. Selainajo
säilyttää turvallisen staattisen fallbackin ilman desktop-capabilitya.

Electron-E2E todistaa käyttäjän A -> B -> A -polun asiakkaiden, laskujen ja
PDF-artifactien eristyksellä, oikean salatun backupin tuonnin sekä native file-
ja password-cancel-polut. Vanhan rendererin capability poistetaan ennen
runtime-omistajuuden vaihtoa, ja seuraava prosessi saa uuden capabilityn sekä
sessionin. Active exact-lineage replace kuuluu W5B.2:een, workspace deletion
W7:ään ja koko paketoitu multi-workspace-releaseportti W6:een.

### Local Workspace W6A.1 -checkpoint

W6A.1 lisää vain sisäisen read-only migration inventoryn. Electron main
validoi strictin registry v1:n, johtaa `ready`-työtilojen yksityiset juuret ja
käynnistää backend utilityt sarjallisesti. Backend omistaa SQLite-yhteyden,
migration manifestin ja identiteetin tarkastuksen. Main, preload, renderer ja
web eivät saa SQLite-kahvaa, polkua, migration chainia, `companyId`:tä,
`profileId`:tä tai runtime-sessionia.

Palautuva sisäinen projektio sisältää vain workspace-tunnisteen,
aktiivisuustiedon, `current` / `compatiblePending` / `invalidHistory`-tilan ja
applied/pending-lukumäärät. Checkpoint ei muuta registryä, työtilaa, aktiivista
osoitinta, accepted build -metadataa tai runtimea eikä aja migraatioita.
Production-first-start-kytkentä ja tilasiirtymät kuuluvat W6A.2:een.

### Local Workspace W6A.2A -checkpoint

W6A.2A lisää vain Electron mainin sisäisen, production-startupista irrallisen
first-start migration plan- ja registry transition -perustan. Puhdas
suunnitelma vaatii strictin registry v1:n ja W6A.1-inventaarion täsmällisen
vastaavuuden. Se palauttaa vain active entryn turvallisen migration-
luokituksen ja kanonisesti järjestetyt passiivisten `invalidHistory`-entryjen
ID:t.

Installation-scoped journal sitoo source/target build -identiteetit sekä
canonical source/transitioned registry -tavut. Registry-adapteri saa muuttaa
vain suunniteltujen passiivisten entryjen lifecycle-tilan
`recoveryRequired`-arvoon. Electron main ei avaa SQLitea, eikä checkpoint
käynnistä migraatiota, palautuspistettä, backendia, accepted build -kirjoitusta
tai renderer-capabilitya. Production first-start -kytkentä ja aktiivisen
workspacen migration/readiness kuuluvat W6A.2B:hen.

## Tarkistuslähteet

Implemented-rivit tarkistetaan ensisijaisesti seuraavista lähteistä:

- `apps/backend/src/http/app.ts`
- `apps/backend/src/composition/`
- `apps/backend/src/modules/*/ports/`
- `apps/desktop/src/main/desktopComposition.ts`
- `packages/permissions/src/permission.ts`
- `docs/modules/`
- `docs/decisions/ADR-0009-local-backup-encryption-and-recovery-points.md`
- `docs/decisions/ADR-0010-windows-installer-and-update-orchestration.md`
- `docs/decisions/ADR-0011-local-multi-workspace-company-model.md`

Jos matriisi ja nykyinen koodi ovat ristiriidassa, ristiriita tutkitaan eikä
matriisia tai koodia oleteta automaattisesti oikeaksi.
