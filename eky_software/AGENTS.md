# Eky-projektin AI-ohjeet

Tämä tiedosto on pakollinen lähtökohta kaikelle AI-avusteiselle työlle tässä repositoriossa.

Lue tämä tiedosto aina ennen kuin teet muutoksia projektiin.

Eky-projektissa tekoäly ei saa arvata arkkitehtuuria, liiketoimintasääntöjä, turvallisuussääntöjä tai moduulien vastuita. Jos jokin asia on epäselvä, työ rajataan pienemmäksi tai kysytään lisäohje.

## Projektin tavoite

Eky on modulaarinen ERP-tyylinen ohjelmisto rakennusalan yrityksen käyttöön.

Ensimmäinen käytännön tavoite on web-pohjainen asiakaskortisto ja laskutusmoduuli. Myöhemmin järjestelmään voidaan lisätä työmääräykset, tuntikirjaukset, materiaalikirjaukset, mobiilisovellus työntekijöille, raportointi, integraatiot, varastonhallinta ja AI-agenttien ohjaama automaatio.

Projektia ei rakenneta yksittäiseksi laskutusohjelmaksi, vaan pitkäikäiseksi, turvalliseksi ja laajennettavaksi Eky Base -järjestelmäksi.

## Työskentelymalli

Ihminen toimii ratkaisuarkkitehtina ja päätöksentekijänä.

AI-avustajat voivat auttaa suunnittelussa, arkkitehtuurin arvioinnissa, dokumentoinnissa, koodin luonnissa, testien tekemisessä ja vaihtoehtojen vertailussa.

Codex tai muu koodausagentti toimii toteuttajana, mutta ei saa tehdä laajoja arkkitehtuuripäätöksiä itsenäisesti.

## Ohjeiden etusija ja ristiriitatilanteet

Jos kaksi projektin ohjetta vaikuttavat ristiriitaisilta, noudata seuraavaa etusijajärjestystä:

1. Projektin omistajan nykyisessä tehtävässä antama nimenomainen päätös.
2. Repositorion juuri-`AGENTS.md` ja sen ydinperiaatteet.
3. Kohdekansion lähin `AGENTS.md`, joka tarkentaa kyseisen kansion työtä.
4. Hyväksytyt ADR-päätökset `docs/decisions/`-kansiossa.
5. Arkkitehtuuri-, turvallisuus-, riippuvuus- ja tietomalliohjeet `docs/architecture/`-kansiossa.
6. Moduulien vastuut `docs/modules/`-kansiossa.
7. Rajatut toteutus- ja vaiheistussuunnitelmat.

Kohdekansion `AGENTS.md` saa tarkentaa juuri-`AGENTS.md`:ää, mutta se ei saa kumota tämän tiedoston ydinperiaatteita ilman projektin omistajan nimenomaista päätöstä.

Vanha suunnitelmadokumentti ei saa kumota myöhemmin hyväksyttyä ADR-päätöstä tai projektin omistajan uudempaa päätöstä.

Jos ristiriitaa ei voida ratkaista varmasti etusijajärjestyksen avulla:

- älä valitse tulkintaa itsenäisesti
- älä jatka ristiriidan vaikutusalueella
- rajaa muu turvallisesti tehtävissä oleva työ erilleen
- kerro projektin omistajalle, mitkä ohjeet ovat ristiriidassa
- pyydä projektin omistajalta päätös ennen jatkamista

Sama pysäytyssääntö koskee tilannetta, jossa liiketoimintasääntö, moduulin omistajuus, turvallisuusvaatimus tai arkkitehtuurin vaikutus jää epäselväksi.

## Pakollinen lukujärjestys

Lue aina ensin tämä tiedosto.

Lue lisäksi tehtävän mukaan seuraavat dokumentit:

- AI-työtapa: `docs/ai/workflow.md`
- Koodauskäytännöt: `docs/ai/coding-rules.md`
- Testausohjeet: `docs/ai/testing-rules.md`
- Tarkistuslista: `docs/ai/review-checklist.md`
- Promptausohjeet: `docs/ai/prompt-guidelines.md`
- Perusarkkitehtuuri: `docs/architecture/base-architecture.md`
- Ensimmäisen rungon suunnitelma: `docs/architecture/initial-skeleton-plan.md`
- Local-cloud-synkronointi: `docs/architecture/local-cloud-sync.md`
- Moduulien rajat: `docs/architecture/module-boundaries.md`
- Riippuvuuksien hallinta: `docs/architecture/dependency-policy.md`
- Turvallisuusperiaatteet: `docs/architecture/security-principles.md`
- Virheenkäsittelyn periaatteet: `docs/architecture/error-handling-principles.md`
- Teknologiapäätökset: `docs/architecture/tech-decisions.md`
- Tietomallin periaatteet: `docs/architecture/data-model-principles.md`
- Liiketoimintakonteksti: `docs/product/business-context.md`
- Sanasto: `docs/product/glossary.md`
- Käyttäjäroolit: `docs/product/user-roles.md`
- Työnkulut: `docs/product/workflows.md`
- UI-periaatteet: `docs/design/ui-principles.md`

Jos työ koskee tiettyä moduulia, lue myös kyseisen moduulin dokumentti `docs/modules/`-kansiosta.

Jos työ koskee uuden liiketoimintamoduulin tai moduulikansion perustamista,
`docs/modules/`-vastuudokumenttia, moduulikohtaista `AGENTS.md`-tiedostoa,
composition rootia, moduulien välistä luku- tai kirjoitussopimusta,
repository-, HTTP-, application- tai frontend-rakennetta, lue myös
`docs/architecture/new-module-implementation-checklist.md`.

Jos työ koskee teknistä perustaa, skeleton-rakennetta, local-first-mallia, pilvivalmiutta tai synkronointia, lue myös `docs/decisions/ADR-0003-technical-foundation.md`.

Jos työ koskee modulaarisen monoliitin päälinjaa, moduulirakenteen dokumentointia tai dokumentaation jakoa, lue myös `docs/decisions/ADR-0001-modular-monolith-first.md` ja `docs/decisions/ADR-0002-module-structure.md`.

Jos työ koskee paikallista backend-runtimea, pilvibackendin ajotapaa, backend-frameworkia tai `apps/backend`-rakennetta, lue myös `docs/decisions/ADR-0004-local-backend-runtime.md` ja `docs/decisions/ADR-0005-backend-framework-selection.md`.

Jos työ koskee local desktop -paketointia, Electronia, Tauria, desktop shelliä,
backend-prosessin hallintaa, preload-/IPC-rajaa tai local-sessionin bootstrapia,
lue myös `docs/decisions/ADR-0007-local-desktop-shell-and-session-bootstrap.md`.

Jos työ koskee Electron-runtimen ensimmäistä toteutusta, `apps/desktop`-
rakennetta, Electronin development- ja production-profiileja, Windows-
paketointispikeä, desktop-transporttia tai paketoidun backendin, SQLiten ja
PDFKitin yhteensopivuuden todentamista, lue myös
`docs/architecture/local-desktop-implementation-plan.md` ja
`docs/architecture/local-desktop-dependency-review.md`.

Jos työ koskee tietokantaa, query layeria, repository-portteja, tietokanta-adaptereita, SQLitea, PostgreSQL:ää tai tietomallin moduuliomistusta, lue myös `docs/decisions/ADR-0006-local-database-and-query-layer.md`.

Jos työ koskee ensimmäisen paikallisen tietokantapinon toteutusta, SQLite-ajuria, SQL-kyselyitä, migraatiomallia tai paikallisen SQLite-tiedoston sijaintia, lue myös `docs/architecture/local-database-implementation-plan.md`.

Jos työ koskee SQL-kyselyitä tai repository-adaptereita, noudata lisäksi `docs/architecture/dependency-policy.md`-dokumentin SQL-adapterisääntöjä.

Jos työ koskee ensimmäistä customer-slicea, asiakasmoduulin toteutusta, customer-reittejä, customer repository -portteja tai customer-tietomallia, lue myös `docs/architecture/customer-vertical-slice-plan.md`.

Jos työ koskee ensimmäistä web customer UI -palaa, React customer -näkymää, `apps/web`-toteutusta tai customer-kutsuja webistä, lue myös `docs/architecture/web-customer-ui-plan.md`.

Jos työ koskee `apps/web/src`-kansiorakennetta, web-featureitä, sovelluksen kokoamista tai webin jaettuja apukokonaisuuksia, lue myös `docs/architecture/web-frontend-structure.md`.

Jos työ koskee asiakaskortiston käyttökokemusta, customer-näkymän lomakerakennetta, asiakaslistaa, asiakasnumeron auto/manual-käyttöliittymää tai customer UI:n seuraavaa refaktorointia, lue myös `docs/architecture/customer-ui-ux-plan.md`.

Jos työ koskee asiakkaan avaamista, asiakkaan koontinäkymää, asiakkaaseen liittyvien muiden moduulien tietojen näyttämistä tai customer overview -rakennetta, lue myös `docs/architecture/customer-overview-plan.md`.

Jos työ koskee Oma yritys / Company Settings -moduulia, oman yrityksen perustietoja, oletustuntihintaa tai yrityksen asetuksia, lue myös `docs/modules/company-settings.md`.

Jos työ koskee Company Settings -moduulin ensimmäistä toteutusta, `company_settings`-taulua, `GET /company-settings`- tai `PUT /company-settings`-reittejä, Company Settings API-clientiä tai Oma yritys -web-näkymää, lue myös `docs/architecture/company-settings-implementation-plan.md`.

Jos työ koskee laskutusta, kohteita, työmääräyksiä, tunti- tai materiaalikirjauksia, laskuehdotuksia tai mobiilista laskutukseen johtavaa työnkulkua, lue myös `docs/architecture/invoicing-workflow-boundaries.md`.

Jos työ koskee ensimmäistä manuaalista laskutus-MVP:tä, laskuluonnosta, laskurivejä, laskennan domain-sääntöjä, classic-laskutusnäkymää, laskun päiväyksiä, maksuehtoa, eräpäivää, ALV-laskentaa, pyöristyksiä, laskun tiloja, laskunumerointia tai laskutuksen snapshotteja, lue myös `docs/architecture/invoicing-mvp-implementation-plan.md`.

Jos työ koskee laskun hyväksyntää, virallista laskunumeroa, numerointisarjoja, tilikausipohjaista numerointia, hyväksytyn laskun snapshotteja, laskutuksen auditointia tai hyväksynnän local/cloud-numerointia, lue myös `docs/architecture/invoice-approval-numbering-plan.md`.

Jos työ koskee hyväksytyn laskun katselua, print-layoutia, PDF:ää, laskulla näkyviä myyjän, asiakkaan tai vastaanottajan tietoja, toimitus- tai kohdetietoa, maksutietojen snapshotia tai laskun print/PDF-data foundation -vaihetta, lue myös `docs/architecture/invoice-print-data-foundation-plan.md`.

Jos työ koskee hyväksytyn laskun toimittamista, tulostusta, sähköpostilähetystä,
SMTP/Gmail/Microsoft-sähköpostiadaptereita, `sent`-tilaa, laskun kopiointia,
peruutusta, hyvityslaskua tai lähetyslokia, lue myös
`docs/architecture/invoice-delivery-plan.md`.

Jos työ koskee laskun toimitustapahtumia, delivery event -mallia,
lähetyslokia, sähköpostin send-endpointtia, dry-run-send-polun auditointia tai
lähetetyn laskun uudelleenlähetystä, lue myös
`docs/architecture/invoice-delivery-events-plan.md`.

Jos työ koskee laskun sähköpostilähetystä, SMTP/Gmail/Microsoft-provideria,
dry-run-sähköpostia, sähköpostiasetuksia, sähköpostisalaisuuksia, OAuth-tokenia,
Windows Credential Manageria, Secret Manageria tai sähköpostiproviderin
rajapintaa, lue myös
`docs/architecture/email-delivery-and-secrets-plan.md`.

Jos työ koskee paikallisen runtimen autentikointia, local-sessionia,
`ActorContext`-mallia, permissioneja, luotettua `companyId`-kontekstia,
loopback-backendin arkaluonteisia reittejä tai local/cloud-yhteistä
identity-adapteria, lue myös
`docs/architecture/local-runtime-trust-and-authorization-plan.md`.

Jos työ koskee koko koodipohjan siivousta, suurten tiedostojen pilkkomista,
composition root -rakennetta, tiedostojen tai vastuiden siirtämistä,
teknisen velan purkua tai usean moduulin käyttäytymisen säilyttävää
refaktorointia, lue myös
`docs/architecture/codebase-cleanup-roadmap.md`.

Jos työ koskee laskutuksen web-käyttöliittymää, laskuluonnoslistaa, Classic-laskutusnäkymää, uuden laskun lomaketta tai laskuluonnoksen avaamista ja muokkaamista webissä, lue myös `docs/architecture/invoicing-ui-roadmap.md`.

Jos työ koskee web-käyttöliittymän ulkoasua, layoutia, komponenttirakennetta, värejä tai Eky-työpöytäkokemusta, lue myös `docs/design/ui-principles.md`.

Jos työ koskee `packages/ui`-pakettia, jaettuja UI-komponentteja, UI-teknisen
velan purkua tai yhteisten lomake-, painike-, panel- tai viestikomponenttien
luomista, lue myös `docs/architecture/ui-design-system-roadmap.md`.

Jos työ koskee käyttäjälle näkyviä UI-tekstejä, kielivalintaa, i18n-rakennetta tai käännöksiä, lue myös `docs/design/ui-principles.md`.

Jos työ koskee domain- tai application-virheitä, HTTP-virhevastauksia, API-clientin `EkyApiError`-rakennetta, webin virheilmoituksia, React Error Boundarya, virhelokitusta tai virhekoodien sopimusta, lue myös `docs/architecture/error-handling-principles.md`.

Jos kohdekansiossa on oma `AGENTS.md`, se on luettava ennen muutosten tekemistä.

## Pakollinen turvallisuusportti

Turvallisuusarvio tehdään aina, kun työ koskee:

- tuotantokoodia
- HTTP- tai API-reittejä
- käyttäjän tai ulkoisen järjestelmän syötettä
- tietokantaa, tiedostoja tai henkilötietoja
- autentikointia, käyttöoikeuksia tai yritysrajausta
- ympäristömuuttujia, salaisuuksia tai lokitusta
- riippuvuuksia tai lockfilea
- synkronointia, integraatioita, tiedostotuontia tai AI-agentteja

Näissä tehtävissä lue aina myös:

- `docs/architecture/security-principles.md`
- `docs/ai/review-checklist.md`
- `docs/ai/testing-rules.md`

Ennen muutoksen hyväksymistä tarkista vähintään:

1. Mitkä arvot ja pyynnöt tulevat luottamusrajan ulkopuolelta?
2. Validoiko backend tyypin, muodon, pituuden, rajat ja liiketoimintasäännöt?
3. Tulevatko käyttäjän identiteetti ja `companyId` luotetusta backendin vahvistamasta kontekstista?
4. Onko käyttöoikeus deny by default ja tarkistetaanko se backendissä?
5. Voiko syöte vaikuttaa SQL:ään, HTTP-otsakkeisiin, tiedostopolkuihin, lokiin tai renderöityyn sisältöön?
6. Vuotaako vastauksissa, virheissä tai lokeissa salaisuuksia tai tarpeetonta henkilötietoa?
7. Tarvitaanko audit-tapahtuma tai turvallisuustesti?
8. Muuttuuko palvelun verkkonäkyvyys, CORS-, cookie-, token- tai deployment-malli?
9. Onko muuttuneiden riippuvuuksien tietoturvatila tarkistettu?

Jos jokin kohta jää epäselväksi, kyseistä vaikutusaluetta ei toteuteta ennen projektin omistajan päätöstä.

## Dokumentaation roolit

`docs/product/` kertoo mitä yritys tekee ja miksi ohjelmisto rakennetaan.

`docs/architecture/` kertoo miten järjestelmä rakennetaan.

`docs/modules/` kertoo mitä kukin moduuli tekee ja mitä se omistaa.

`docs/ai/` kertoo miten AI:n kanssa työskennellään tässä projektissa.

`docs/decisions/` sisältää tärkeät arkkitehtuuripäätökset ADR-muodossa.

`docs/design/` kertoo miltä Eky-käyttöliittymän pitää tuntua ja miten UI-periaatteita sovelletaan.

## Ydinperiaatteet

1. Turvallisuus ensin.
2. Pidä järjestelmä modulaarisena.
3. Älä sekoita liiketoimintalogiikkaa käyttöliittymään.
4. Älä lisää uusia riippuvuuksia ilman projektin omistajan erillistä,
   nimenomaista hyväksyntää.
5. Älä luo moduulien välisiä oikopolkuja.
6. Älä tee laajoja arkkitehtuurimuutoksia ilman erillistä hyväksyntää.
7. Suosi pieniä, selkeitä ja yhden vastuun tiedostoja.
8. Päivitä dokumentaatiota, jos arkkitehtuuri, työnkulku tai liiketoimintasääntö muuttuu.
9. Pidä domain-kerros riippumattomana käyttöliittymästä, tietokannasta, Firebasesta ja ulkoisista integraatioista.
10. Käyttöliittymä ei saa kutsua suoraan tietokantaa tai Firebase-palveluita.
11. Backend tarkistaa aina käyttöoikeudet.
12. AI-agentit eivät saa tulevaisuudessakaan ohittaa samoja sääntöjä, joita käyttöliittymä noudattaa.
13. Nykyistä autentikoimatonta local-MVP:tä ei avata verkkoon eikä käytetä oikealla asiakas- tai laskutusdatalla.

## Arkkitehtuurin päälinja

Projektissa käytetään modulaarista monoliittia.

Tavoitteena ei ole rakentaa mikropalveluarkkitehtuuria ensimmäisessä vaiheessa.

Järjestelmä rakennetaan kuitenkin niin, että moduuleja voidaan myöhemmin irrottaa omiksi palveluikseen, jos siihen tulee todellinen tarve.

Eky suunnitellaan paikallisesti toimivaksi ja pilveen laajennettavaksi ERP-järjestelmäksi.

Sama domain- ja service-logiikka pyritään pitämään käytettävissä paikallisessa offline-versiossa, pilviversiossa ja myöhemmin mobiilissa.

## Suunniteltu korkean tason rakenne

Alustava rakenne:

- `apps/web`
- `apps/backend`
- `packages/domain`
- `packages/validation`
- `packages/api-client`
- `packages/auth`
- `packages/permissions`
- `packages/ui`
- `packages/config`

Lopullinen rakenne tarkentuu projektin edetessä.

`packages/utils` ei kuulu ensimmäiseen skeleton-rakenteeseen. Se voidaan lisätä myöhemmin vain erillisellä päätöksellä ja tarkasti rajatulla vastuulla.

## Kerrossäännöt

Liiketoimintasäännöt kuuluvat domain-kerrokseen.

Validointi kuuluu validation-kerrokseen.

Frontendin API-kutsut kuuluvat api-client-kerrokseen.

Firebase Auth eristetään auth- tai infrastructure-kerroksen taakse.

Käyttöoikeuslogiikka keskitetään permissions- tai authorization-kerrokseen.

Uudelleenkäytettävät käyttöliittymäkomponentit kuuluvat ui-kerrokseen.

Backendissä handler vastaanottaa pyynnön, service ohjaa käyttötapauksen ja repository hoitaa tietokantayhteyden.

## Koodin kieli

Dokumentaatio, suunnittelu ja liiketoiminnan kuvaukset voidaan kirjoittaa suomeksi.

Kaikki koodi kirjoitetaan englanniksi.

Tämä koskee muuttujia, funktioita, luokkia, tyyppejä, rajapintoja, tiedostonimiä, kansioita, tietokantatauluja, tietokantakenttiä ja API-reittejä.

Käytä `docs/product/glossary.md`-sanastoa oikeiden termien varmistamiseen.

Älä sekoita suomea ja englantia samaan kooditermiin.

Käyttäjälle näkyvät käyttöliittymätekstit ovat ensisijaisesti suomeksi.

UI-tekstien rakenne pidetään sellaisena, että muita kieliä voidaan lisätä myöhemmin hallitusti ilman laajaa uudelleenkirjoitusta.

## Ennen työn aloittamista

Ennen muutosten tekemistä:

1. Lue tämä tiedosto.
2. Lue tehtävään liittyvät dokumentit `docs/`-kansiosta.
3. Tarkista, onko kohdekansiossa oma `AGENTS.md`.
4. Anna lyhyt toteutussuunnitelma, jos tehtävä on laaja tai arkkitehtuuriin vaikuttava.
5. Tunnista oikea kerros ja moduuli.
6. Rajaa muutos mahdollisimman pieneksi.
7. Älä lisää riippuvuuksia ilman hyväksyntää.
8. Älä muuta arkkitehtuuria ilman hyväksyntää.

## Ennen kuin ilmoitat työn valmiiksi

Tarkista:

1. Noudattaako muutos moduulirajoja?
2. Vuotaako jokin riippuvuus väärään kerrokseen?
3. Onko liiketoimintalogiikka oikeassa paikassa?
4. Onko turvallisuus huomioitu?
5. Onko käyttöoikeudet huomioitu backendissä?
6. Onko tiedostoilla selkeä vastuu?
7. Tarvitaanko testi?
8. Tarvitaanko dokumentaatiopäivitys?
9. Syntyikö uusi riippuvuus?
10. Muuttuiko jokin arkkitehtuuripäätös?

Jos muutos rikkoo projektin periaatteita, älä tee sitä ilman erillistä hyväksyntää.

## Pakollinen riippuvuuksien hyväksyntäportti

Uusi kolmannen osapuolen runtime- tai development-riippuvuus hyväksytään aina
erillisenä päätöksenä. Laajan tehtävän, toteutusvaiheen tai suunnitelman
hyväksyminen ei samalla hyväksy siinä nimeämätöntä riippuvuutta.

Ennen riippuvuuden asentamista, importointia tai `package.json`- ja
lockfile-muutosta AI:n pitää:

1. nimetä ehdotettu riippuvuus ja tarkka käyttötarkoitus
2. vertailla projektin omaa toteutusta ja jo hyväksyttyjä vaihtoehtoja
3. raportoida ylläpito-, tietoturva-, toimitusketju- ja paketointivaikutukset
4. pyytää projektin omistajalta riippuvuudelle nimenomainen hyväksyntä

Jos riippuvuuden todellinen tarve ilmenee ensimmäisen kerran vasta koodauksen
aikana, työ pysäytetään juuri siinä kohdassa. Riippuvuutta ei saa kokeeksi
asentaa tai kirjoittaa toteutukseen ennen uutta hyväksyntää. Näin ratkaisu
voidaan vielä perua, rajata tai korvata omalla toteutuksella ennen kuin se
juurtuu koodiin tai lockfileen.

AI ei saa tulkita omaa riippuvuusarviotaan hyväksynnäksi. Jos riippuvuus on
lisätty vahingossa ilman tätä porttia, työtä ei commitoida tai pushata. Tilanne
raportoidaan heti ja muutos pidetään peruttavana projektin omistajan päätökseen
asti.
