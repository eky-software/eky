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
- Teknologiapäätökset: `docs/architecture/tech-decisions.md`
- Tietomallin periaatteet: `docs/architecture/data-model-principles.md`
- Liiketoimintakonteksti: `docs/product/business-context.md`
- Sanasto: `docs/product/glossary.md`
- Käyttäjäroolit: `docs/product/user-roles.md`
- Työnkulut: `docs/product/workflows.md`
- UI-periaatteet: `docs/design/ui-principles.md`

Jos työ koskee tiettyä moduulia, lue myös kyseisen moduulin dokumentti `docs/modules/`-kansiosta.

Jos työ koskee teknistä perustaa, skeleton-rakennetta, local-first-mallia, pilvivalmiutta tai synkronointia, lue myös `docs/decisions/ADR-0003-technical-foundation.md`.

Jos työ koskee paikallista backend-runtimea, pilvibackendin ajotapaa, backend-frameworkia tai `apps/backend`-rakennetta, lue myös `docs/decisions/ADR-0004-local-backend-runtime.md` ja `docs/decisions/ADR-0005-backend-framework-selection.md`.

Jos työ koskee tietokantaa, query layeria, repository-portteja, tietokanta-adaptereita, SQLitea, PostgreSQL:ää tai tietomallin moduuliomistusta, lue myös `docs/decisions/ADR-0006-local-database-and-query-layer.md`.

Jos työ koskee ensimmäisen paikallisen tietokantapinon toteutusta, SQLite-ajuria, SQL-kyselyitä, migraatiomallia tai paikallisen SQLite-tiedoston sijaintia, lue myös `docs/architecture/local-database-implementation-plan.md`.

Jos työ koskee SQL-kyselyitä tai repository-adaptereita, noudata lisäksi `docs/architecture/dependency-policy.md`-dokumentin SQL-adapterisääntöjä.

Jos työ koskee ensimmäistä customer-slicea, asiakasmoduulin toteutusta, customer-reittejä, customer repository -portteja tai customer-tietomallia, lue myös `docs/architecture/customer-vertical-slice-plan.md`.

Jos työ koskee ensimmäistä web customer UI -palaa, React customer -näkymää, `apps/web`-toteutusta tai customer-kutsuja webistä, lue myös `docs/architecture/web-customer-ui-plan.md`.

Jos työ koskee web-käyttöliittymän ulkoasua, layoutia, komponenttirakennetta, värejä tai Eky-työpöytäkokemusta, lue myös `docs/design/ui-principles.md`.

Jos kohdekansiossa on oma `AGENTS.md`, se on luettava ennen muutosten tekemistä.

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
4. Älä lisää uusia riippuvuuksia ilman perustelua.
5. Älä luo moduulien välisiä oikopolkuja.
6. Älä tee laajoja arkkitehtuurimuutoksia ilman erillistä hyväksyntää.
7. Suosi pieniä, selkeitä ja yhden vastuun tiedostoja.
8. Päivitä dokumentaatiota, jos arkkitehtuuri, työnkulku tai liiketoimintasääntö muuttuu.
9. Pidä domain-kerros riippumattomana käyttöliittymästä, tietokannasta, Firebasesta ja ulkoisista integraatioista.
10. Käyttöliittymä ei saa kutsua suoraan tietokantaa tai Firebase-palveluita.
11. Backend tarkistaa aina käyttöoikeudet.
12. AI-agentit eivät saa tulevaisuudessakaan ohittaa samoja sääntöjä, joita käyttöliittymä noudattaa.

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
