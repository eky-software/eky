# EKY-ohjeiden lukureitit

Tämä hakemisto omistaa aihekohtaisen lukureitin, ei lähdedokumenttien sääntöjä.
Lue ensin [pääohje](../AGENTS.md). Valitse tehtävän koskettamat alueet alla;
lue niiden voimassa olevat lähteet ennen muutoksia. Linkki tai otsikon
tunteminen ei tarkoita lähteen lukemista. Koko hakemiston lähteitä ei tarvitse
lukea jokaisessa tehtävässä.

## Aloitus ja omistajuus

- Työtapa, aloitus ja valmistuminen: [workflow](ai/workflow.md).
- Moduulin sisäinen työ: [moduulihakemisto](modules/README.md), moduulin oma
  vastuudokumentti ja toteutuspolun paikallinen `AGENTS.md`.
- Moduulirajan ylitys: molempien moduulien sopimukset sekä
  [integraatiomatriisi](architecture/module-integration-matrix.md).
- Julkaisun sisältö ja järjestys: [0.3.0-roadmap](architecture/release-0.3.0-plan.md).
  Aktiivinen työ ja hyväksyntänäyttö: [M1:n jatkamiskohta](architecture/release-0.3.0-m1-preparation-plan.md#jatka-tästä).
- Git-juuren `.github`-työ: sovelluksen pääohje, workflow'n CI-seuranta,
  [testausohje](ai/testing-rules.md), [riippuvuusohje](architecture/dependency-policy.md)
  ja muutettavan testiperheen reitti alla. Git-juuri ja sovelluksen työjuuri
  ovat eri hakemistoja; ajopolku varmistetaan ennen komentoa.

ADR omistaa hyväksytyn päätöksen, moduulidokumentti liiketoimintavastuun ja
arkkitehtuuriohje yhteisen teknisen sopimuksen. Suunnitelma ei kumoa niitä.
Päivätty raportti on näyttöä silloisesta revisiosta, ei uusi työjono.
Lähteiden taustaviitteet eivät käske lukemaan jo luettua dokumenttia uudelleen;
tehtäväkohtaiset pakolliset lähteet ja pääohjeen portit säilyvät.

## Aihekohtaiset reitit

Valitse tarvittavat reitit: [yhteiset lähteet](#yhteiset-lähteet),
[moduulit](#moduulit), [diagnostiikka](#diagnostiikka),
[backup ja palautus](#backup-ja-palautus), [asennin](#asennin),
[testaus](#testaus), [rakenne](#rakenne), [runtime ja identiteetti](#runtime-ja-identiteetti),
[tietokanta](#tietokanta), [asiakkaat ja web](#asiakkaat-ja-web),
[Oma yritys](#oma-yritys), [laskutus](#laskutus),
[siivous ja julkaisu](#siivous-ja-julkaisu), [UI ja virheet](#ui-ja-virheet).

### Yhteiset lähteet

Lue lisäksi tehtävän mukaan seuraavat dokumentit:

- AI-työtapa: [ai/workflow.md](ai/workflow.md)
- Koodauskäytännöt: [ai/coding-rules.md](ai/coding-rules.md)
- Testausohjeet: [ai/testing-rules.md](ai/testing-rules.md)
- Tarkistuslista: [ai/review-checklist.md](ai/review-checklist.md)
- Promptausohjeet: [ai/prompt-guidelines.md](ai/prompt-guidelines.md)
- Perusarkkitehtuuri: [architecture/base-architecture.md](architecture/base-architecture.md)
- Ensimmäisen rungon suunnitelma: [architecture/initial-skeleton-plan.md](architecture/initial-skeleton-plan.md)
- Local-cloud-synkronointi: [architecture/local-cloud-sync.md](architecture/local-cloud-sync.md)
- Moduulien rajat: [architecture/module-boundaries.md](architecture/module-boundaries.md)
- Riippuvuuksien hallinta: [architecture/dependency-policy.md](architecture/dependency-policy.md)
- Turvallisuusperiaatteet: [architecture/security-principles.md](architecture/security-principles.md)
- Virheenkäsittelyn periaatteet: [architecture/error-handling-principles.md](architecture/error-handling-principles.md)
- Observability ja auditointi: [architecture/observability-and-audit-plan.md](architecture/observability-and-audit-plan.md)
- Teknologiapäätökset: [architecture/tech-decisions.md](architecture/tech-decisions.md)
- Tietomallin periaatteet: [architecture/data-model-principles.md](architecture/data-model-principles.md)
- Liiketoimintakonteksti: [product/business-context.md](product/business-context.md)
- Sanasto: [product/glossary.md](product/glossary.md)
- Käyttäjäroolit: [product/user-roles.md](product/user-roles.md)
- Työnkulut: [product/workflows.md](product/workflows.md)
- UI-periaatteet: [design/ui-principles.md](design/ui-principles.md)

### Moduulit

Jos työ koskee tiettyä moduulia, lue myös sen vastuudokumentti
[moduulihakemistosta](modules/README.md) ja toteutuspolun soveltuva
`AGENTS.md`. Hakemisto on lukureitti, ei moduulin varsinaisen ohjeen korvike.

Jos työ koskee käyttäjälle näkyvää tapahtumahistoriaa, Activity-moduulia tai
moduulien audit-tapahtumista muodostettua turvallista read modelia, lue myös
[modules/activity.md](modules/activity.md) ja [architecture/observability-and-audit-plan.md](architecture/observability-and-audit-plan.md).

### Diagnostiikka

Jos työ koskee teknistä diagnostiikkanäkymää, operational-lokien lukemista,
lokikansion avaamista tai tukipakettia, lue myös
[modules/diagnostics.md](modules/diagnostics.md), [architecture/operational-log-retention-plan.md](architecture/operational-log-retention-plan.md)
ja [architecture/support-bundle-plan.md](architecture/support-bundle-plan.md).
Tapahtuman kenttiä tai lukuketjua muuttava työ lukee lisäksi
[tapahtumakatalogin](architecture/r0-observability-event-catalog.md);
avoimen 0.3.0-työn rajaus löytyy
[diagnostiikan täydennyssuunnitelmasta](architecture/diagnostics-0.2.9-completion-plan.md).

### Backup ja palautus

Jos työ koskee paikallisen business-datan varmuuskopiointia, palautusta,
`.ekybackup`-formaattia, salattua siirrettävää varmuuskopiota, konekohtaista
palautuspistettä, restore-stagingia tai profiilin rollbackia, lue myös
[decisions/ADR-0009-local-backup-encryption-and-recovery-points.md](decisions/ADR-0009-local-backup-encryption-and-recovery-points.md) ja
[architecture/local-backup-and-restore-plan.md](architecture/local-backup-and-restore-plan.md). Jos työ koskee
palautuksen keskeytymisen tai rollbackin jälkeen vaadittavaa manuaalista
tarkistusta, lue myös
[architecture/local-restore-recovery-runbook.md](architecture/local-restore-recovery-runbook.md). Tukipakettia tai
toimitettujen laskujen valinnaista PDF-arkistokansiota ei saa käsitellä
varmuuskopiona.
Tietokannan tarkistus lukee myös [schema- ja migraatiosopimuksen](architecture/local-database-implementation-plan.md).
Pysyvien moduulitiedostojen tai laskuhistorian palautus lukee
[backup-artifactien omistajuuden ja katalogin](architecture/local-backup-artifact-inventory.md)
sekä kyseisen moduulin sisältösopimuksen. Backup-infrastruktuuri ei päätä
moduulin liiketoimintasääntöjä.

### Asennin

Jos työ koskee Windows-asenninta, Setup-päivitystä, sovelluksesta
käynnistettävää päivitystä, update coordinatoria, päivitysjournalia,
pre-update-palautuspistettä, binary rollbackia, code signingia tai
julkaisukanavaa, lue myös
[decisions/ADR-0010-windows-installer-and-update-orchestration.md](decisions/ADR-0010-windows-installer-and-update-orchestration.md),
[architecture/windows-installer-and-update-plan.md](architecture/windows-installer-and-update-plan.md),
[architecture/release-versioning-policy.md](architecture/release-versioning-policy.md) ja
[architecture/local-desktop-dependency-review.md](architecture/local-desktop-dependency-review.md).
Jos työ koskee Windows installer -hyväksyntäharnessia, W6B-, W6B.2A- tai
W6B.2B-skenaarioita, niiden prosessiomistajuutta, timeout-/cleanup-mallia tai
raskaan Windows-matriisin CI-kadenssia, lue myös
[architecture/windows-installer-acceptance-harness-v2.md](architecture/windows-installer-acceptance-harness-v2.md).

### Testaus

Jos työ koskee E2E-testejä, Playwrightia, selain- tai Electron development
-käyttäjäpolkuja, testiruntimea, fault injectionia, hyökkäyssimulaatioita tai
packaged-smoken testikattavuutta, lue myös
[architecture/e2e-testing-strategy.md](architecture/e2e-testing-strategy.md),
[architecture/r0-e2e-test-matrix.md](architecture/r0-e2e-test-matrix.md) ja
[architecture/e2e-test-environment.md](architecture/e2e-test-environment.md) sekä
[testinkirjoittajan pikaohje](ai/e2e-test-authoring-guide.md).
Pikaohje yhdistää nykyiset testipohjat, ajokomennot ja virhetodisteet;
päivätty koehistoria ei korvaa nykyistä runtime-sopimusta.
Jos muutat `apps/e2e`-aluetta, lue myös sen oma `AGENTS.md`.

### Rakenne

Jos työ koskee uuden liiketoimintamoduulin tai moduulikansion perustamista,
`docs/modules/`-vastuudokumenttia, moduulikohtaista `AGENTS.md`-tiedostoa,
composition rootia, moduulien välistä luku- tai kirjoitussopimusta,
repository-, HTTP-, application- tai frontend-rakennetta, lue myös
[architecture/new-module-implementation-checklist.md](architecture/new-module-implementation-checklist.md). Jos työ koskee
uutta moduulia, moduulin omistajuutta, composition rootia, julkista porttia,
cross-module-lukua tai -kirjoitusta tai moduulin backup/restore-sopimusta, lue
ja päivitä tarvittaessa myös
[architecture/module-integration-matrix.md](architecture/module-integration-matrix.md).

Jos työ koskee teknistä perustaa, skeleton-rakennetta, local-first-mallia, pilvivalmiutta tai synkronointia, lue myös [decisions/ADR-0003-technical-foundation.md](decisions/ADR-0003-technical-foundation.md).

Jos työ koskee modulaarisen monoliitin päälinjaa, moduulirakenteen dokumentointia tai dokumentaation jakoa, lue myös [decisions/ADR-0001-modular-monolith-first.md](decisions/ADR-0001-modular-monolith-first.md) ja [decisions/ADR-0002-module-structure.md](decisions/ADR-0002-module-structure.md).

### Runtime ja identiteetti

Jos työ koskee paikallista backend-runtimea, pilvibackendin ajotapaa, backend-frameworkia tai `apps/backend`-rakennetta, lue myös [decisions/ADR-0004-local-backend-runtime.md](decisions/ADR-0004-local-backend-runtime.md) ja [decisions/ADR-0005-backend-framework-selection.md](decisions/ADR-0005-backend-framework-selection.md).

Jos työ koskee local desktop -paketointia, Electronia, Tauria, desktop shelliä,
backend-prosessin hallintaa, preload-/IPC-rajaa tai local-sessionin bootstrapia,
lue myös [decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md](decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md).

Jos työ koskee paikallisia yritystyötiloja, useita paikallisia profiileja,
profiilin vaihtoa, profiilikohtaisia tietokantoja tai local desktopin
multi-company-mallia, lue myös
[decisions/ADR-0008-local-desktop-company-workspaces.md](decisions/ADR-0008-local-desktop-company-workspaces.md),
[decisions/ADR-0011-local-multi-workspace-company-model.md](decisions/ADR-0011-local-multi-workspace-company-model.md) ja
[architecture/local-company-workspace-plan.md](architecture/local-company-workspace-plan.md).

Jos työ koskee toista ihmiskäyttäjää, käyttäjähallintaa, kirjautumista,
User- tai Employee/Worker-identiteettiä, yritysjäsenyyttä, rooleja,
permissionien laajentamista, mobiilikirjautumista, etänä tehtävää
business-kirjoitusta tai kirjoittavaa AI-actoria, lue myös
[product/user-roles.md](product/user-roles.md),
[architecture/local-runtime-trust-and-authorization-plan.md](architecture/local-runtime-trust-and-authorization-plan.md) ja
[architecture/module-integration-matrix.md](architecture/module-integration-matrix.md). Näitä toimintoja ei
toteuteta ennen projektin omistajan hyväksymää Users / Identity /
Memberships / Roles / Permissions -vaihetta.

Jos työ koskee Electron-runtimen ensimmäistä toteutusta, `apps/desktop`-
rakennetta, Electronin development- ja production-profiileja, Windows-
paketointispikeä, desktop-transporttia tai paketoidun backendin, SQLiten ja
PDFKitin yhteensopivuuden todentamista, lue myös
[architecture/local-desktop-implementation-plan.md](architecture/local-desktop-implementation-plan.md) ja
[architecture/local-desktop-dependency-review.md](architecture/local-desktop-dependency-review.md).

Jos työ koskee Electron-version, `better-sqlite3`-version, N-API-paketoinnin
tai desktopin native-runtimen yhteensopivuuden muuttamista, lue lisäksi
[architecture/electron-43-better-sqlite3-13-compatibility-plan.md](architecture/electron-43-better-sqlite3-13-compatibility-plan.md).

### Tietokanta

Jos työ koskee tietokantaa, query layeria, repository-portteja, tietokanta-adaptereita, SQLitea, PostgreSQL:ää tai tietomallin moduuliomistusta, lue myös [decisions/ADR-0006-local-database-and-query-layer.md](decisions/ADR-0006-local-database-and-query-layer.md).

Jos työ koskee ensimmäisen paikallisen tietokantapinon toteutusta, SQLite-ajuria, SQL-kyselyitä, migraatiomallia tai paikallisen SQLite-tiedoston sijaintia, lue myös [architecture/local-database-implementation-plan.md](architecture/local-database-implementation-plan.md).

Jos työ koskee SQL-kyselyitä tai repository-adaptereita, noudata lisäksi [architecture/dependency-policy.md](architecture/dependency-policy.md)-dokumentin SQL-adapterisääntöjä.

### Asiakkaat ja web

0.3.0:n asiakassuhteen tyypinmuutosta, numeroinnin tarkkuutta ja turvallista
virhepalautetta koskeva työ lukee myös [E-paketin suunnitelman](architecture/release-0.3.0-customer-invariants-plan.md).

Jos työ koskee ensimmäistä customer-slicea, asiakasmoduulin toteutusta, customer-reittejä, customer repository -portteja tai customer-tietomallia, lue myös [architecture/customer-vertical-slice-plan.md](architecture/customer-vertical-slice-plan.md).

Jos työ koskee ensimmäistä web customer UI -palaa, React customer -näkymää, `apps/web`-toteutusta tai customer-kutsuja webistä, lue myös [architecture/web-customer-ui-plan.md](architecture/web-customer-ui-plan.md).

Jos työ koskee `apps/web/src`-kansiorakennetta, web-featureitä, sovelluksen kokoamista tai webin jaettuja apukokonaisuuksia, lue myös [architecture/web-frontend-structure.md](architecture/web-frontend-structure.md).

Jos työ koskee asiakaskortiston käyttökokemusta, customer-näkymän lomakerakennetta, asiakaslistaa, asiakasnumeron auto/manual-käyttöliittymää tai customer UI:n seuraavaa refaktorointia, lue myös [architecture/customer-ui-ux-plan.md](architecture/customer-ui-ux-plan.md).

Jos työ koskee asiakkaan avaamista, asiakkaan koontinäkymää, asiakkaaseen liittyvien muiden moduulien tietojen näyttämistä tai customer overview -rakennetta, lue myös [architecture/customer-overview-plan.md](architecture/customer-overview-plan.md).

### Oma yritys

Jos työ koskee Oma yritys / Company Settings -moduulia, oman yrityksen perustietoja, oletustuntihintaa tai yrityksen asetuksia, lue myös [modules/company-settings.md](modules/company-settings.md).

`company_settings`-taulun, `GET /company-settings`- ja `PUT /company-settings`-reittien,
API-clientin ja Oma yritys -web-näkymän nykyiset velvoitteet luetaan
[Company Settings -sopimuksesta](modules/company-settings.md) ja kohdepolun
`AGENTS.md`:stä; sähköpostin ja salaisuuksien muutoksissa lisäksi
[email-sopimuksesta](architecture/email-delivery-and-secrets-plan.md).
[Ensitoteutussuunnitelma](architecture/company-settings-implementation-plan.md)
luetaan, kun tutkitaan ensimmäistä toteutusta tai sen historiallisia päätöksiä;
se ei ole nykyisten vastuuohjeiden rinnakkainen toteutusresepti.

### Laskutus

Jos työ koskee laskutusta, kohteita, työmääräyksiä, tunti- tai materiaalikirjauksia, laskuehdotuksia tai mobiilista laskutukseen johtavaa työnkulkua, lue myös [architecture/invoicing-workflow-boundaries.md](architecture/invoicing-workflow-boundaries.md).

Jos työ koskee ensimmäistä manuaalista laskutus-MVP:tä, laskuluonnosta, laskurivejä, laskennan domain-sääntöjä, classic-laskutusnäkymää, laskun päiväyksiä, maksuehtoa, eräpäivää, ALV-laskentaa, pyöristyksiä, laskun tiloja, laskunumerointia tai laskutuksen snapshotteja, lue myös [architecture/invoicing-mvp-implementation-plan.md](architecture/invoicing-mvp-implementation-plan.md).

Jos työ koskee laskun hyväksyntää, virallista laskunumeroa, numerointisarjoja, tilikausipohjaista numerointia, hyväksytyn laskun snapshotteja, laskutuksen auditointia tai hyväksynnän local/cloud-numerointia, lue myös [architecture/invoice-approval-numbering-plan.md](architecture/invoice-approval-numbering-plan.md).

Numerointisarjan siirtymää muuttava työ lukee
[siirtymäsopimuksen](architecture/invoice-numbering-series-transition-plan.md).
Verokäsittelyä tai korjauksen verovaikutusta muuttava työ lukee
[verokäsittelyn sopimuksen](architecture/invoice-tax-treatment-completion-plan.md)
ja [verotuksen ja korjaamisen rajauksen](architecture/invoicing-tax-and-correction-roadmap.md).
Suunniteltua verokäsittelyä ei päätellä toteutetuksi pelkästä listauksesta.

Jos työ koskee hyväksytyn laskun katselua, print-layoutia, PDF:ää, laskulla näkyviä myyjän, asiakkaan tai vastaanottajan tietoja, toimitus- tai kohdetietoa, maksutietojen snapshotia tai laskun print/PDF-data foundation -vaihetta, lue myös [architecture/invoice-print-data-foundation-plan.md](architecture/invoice-print-data-foundation-plan.md).

Jos työ koskee hyväksytyn laskun toimittamista, tulostusta, sähköpostilähetystä,
SMTP/Gmail/Microsoft-sähköpostiadaptereita, `sent`-tilaa, laskun kopiointia,
peruutusta, hyvityslaskua tai lähetyslokia, lue myös
[architecture/invoice-delivery-plan.md](architecture/invoice-delivery-plan.md).

Jos työ koskee toimitetun lasku-PDF:n valinnaista paikallista arkistokopiota,
käyttäjän valitsemaa desktop-kansiota, arkistoinnin retry-journalia tai
backendin ja Electron main -prosessin välistä arkistointibrokeria, lue myös
[architecture/local-invoice-pdf-archive-plan.md](architecture/local-invoice-pdf-archive-plan.md).

Jos työ koskee hyväksytyn laskun peruutusta, hyvitysluonnosta, koko- tai
osahyvitystä, hyvityksen kumulatiivista laskentaa, hyvityslaskun hyväksyntää,
hyvityksen PDF:ää tai alkuperäislaskun ja hyvitysten ryhmittelyä, lue myös
[architecture/invoice-cancellation-and-credit-note-plan.md](architecture/invoice-cancellation-and-credit-note-plan.md).

Jos työ koskee laskun toimitustapahtumia, delivery event -mallia,
lähetyslokia, sähköpostin send-endpointtia, dry-run-send-polun auditointia tai
lähetetyn laskun uudelleenlähetystä, lue myös
[architecture/invoice-delivery-events-plan.md](architecture/invoice-delivery-events-plan.md).
Toimitusvarauksen, finalisoinnin tai tapahtumien tallennuksen muutoksessa
luetaan myös [toimituksen persistence-sopimus](architecture/sqlite-invoice-delivery-event-persistence-plan.md).

Jos työ koskee laskun maksutilaa, manuaalista maksumerkintää, maksumerkinnän
poistoa, maksettujen laskujen listausta tai tulevaa pankkikohdistusta, lue myös
[architecture/invoice-payment-tracking-plan.md](architecture/invoice-payment-tracking-plan.md).

Jos työ koskee laskun sähköpostilähetystä, SMTP/Gmail/Microsoft-provideria,
dry-run-sähköpostia, sähköpostiasetuksia, sähköpostisalaisuuksia, OAuth-tokenia,
Windows Credential Manageria, Secret Manageria tai sähköpostiproviderin
rajapintaa, lue myös
[architecture/email-delivery-and-secrets-plan.md](architecture/email-delivery-and-secrets-plan.md).

Jos työ koskee paikallisen runtimen autentikointia, local-sessionia,
`ActorContext`-mallia, permissioneja, luotettua `companyId`-kontekstia,
loopback-backendin arkaluonteisia reittejä tai local/cloud-yhteistä
identity-adapteria, lue myös
[architecture/local-runtime-trust-and-authorization-plan.md](architecture/local-runtime-trust-and-authorization-plan.md).

### Siivous ja julkaisu

Jos työ koskee koko koodipohjan siivousta, suurten tiedostojen pilkkomista,
composition root -rakennetta, tiedostojen tai vastuiden siirtämistä,
teknisen velan purkua tai usean moduulin käyttäytymisen säilyttävää
refaktorointia, lue myös
[architecture/codebase-cleanup-roadmap.md](architecture/codebase-cleanup-roadmap.md).

Jos työ koskee sovellusversion nostamista, build-identiteettiä,
release-artifactia, Git-revision välittämistä, dirty-buildia tai runtimen
jäljitettävyyttä, lue myös
[architecture/release-versioning-policy.md](architecture/release-versioning-policy.md).

### UI ja virheet

Jos työ koskee laskutuksen web-käyttöliittymää, laskuluonnoslistaa, Classic-laskutusnäkymää, uuden laskun lomaketta tai laskuluonnoksen avaamista ja muokkaamista webissä, lue myös [architecture/invoicing-ui-roadmap.md](architecture/invoicing-ui-roadmap.md).

Jos työ koskee web-käyttöliittymän ulkoasua, layoutia, komponenttirakennetta, värejä tai Eky-työpöytäkokemusta, lue myös [design/ui-principles.md](design/ui-principles.md).

Jos työ koskee `packages/ui`-pakettia, jaettuja UI-komponentteja, UI-teknisen
velan purkua tai yhteisten lomake-, painike-, panel- tai viestikomponenttien
luomista, lue myös [architecture/ui-design-system-roadmap.md](architecture/ui-design-system-roadmap.md).

Jos työ koskee käyttäjälle näkyviä UI-tekstejä, kielivalintaa, i18n-rakennetta tai käännöksiä, lue myös [design/ui-principles.md](design/ui-principles.md).

Jos työ koskee domain- tai application-virheitä, HTTP-virhevastauksia, API-clientin `EkyApiError`-rakennetta, webin virheilmoituksia, React Error Boundarya, virhelokitusta tai virhekoodien sopimusta, lue myös [architecture/error-handling-principles.md](architecture/error-handling-principles.md).

Jos kohdekansiossa on oma `AGENTS.md`, se on luettava ennen muutosten tekemistä.
