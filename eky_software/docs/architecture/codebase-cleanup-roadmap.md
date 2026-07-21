# Koodipohjan siivousroadmap

Tämä dokumentti ohjaa Eky-koodipohjan hallittua rakenteellista siivousta
laskutuksen ensimmäisen laajan toteutusvaiheen jälkeen.

Tämä dokumentti on auktoritatiivinen lähde koodipohjan siivouksen
prioriteeteille, työjärjestykselle ja etenemisen seurannalle. Se ei omista
webin visuaalista linjaa, kansiorakennetta eikä jaettujen UI-primitiivien
päätöksiä; ne määritellään dokumenteissa `docs/design/ui-principles.md`,
`docs/architecture/web-frontend-structure.md` ja
`docs/architecture/ui-design-system-roadmap.md`.

Roadmap perustuu 20.7.2026 tehtyyn koko repositorion read-only-auditointiin.
Auditoinnin Git-baseline oli `antsa`-haaran commit `095da06`
(`fix(invoicing): harden delivery confirmation`).
Auditoinnissa ei löytynyt akuuttia arkkitehtuurin rikkovaa P0-koodivirhettä.
Suurimmat ylläpidettävyysriskit liittyvät muutamien tiedostojen kasvaneeseen
vastuuseen, toistuvaan composition-koodiin, vanhentuneisiin
nykytilakuvauksiin ja ennen tuotantokäyttöä suljettaviin release-portteihin.

Tämä dokumentti ei korvaa moduulien omia suunnitelmia, hyväksyttyjä ADR-
päätöksiä tai turvallisuusohjeita. Ristiriidassa noudatetaan `AGENTS.md`-
tiedoston etusijajärjestystä.

## Tavoite

Siivouksen tavoitteena on:

- pienentää monen vastuun tiedostoja
- tehdä riippuvuuksien kokoamisesta ymmärrettävää
- vähentää todellista toistoa ilman ennenaikaisia abstraktioita
- säilyttää moduulien omistajuus ja nykyiset julkiset sopimukset
- tehdä tiedostojen ja vastuiden löytäminen helpoksi myös uusissa moduuleissa
- pitää local-, cloud- ja tuleva mobile-käyttö saman domain- ja application-
  ytimen päällä
- vahvistaa julkaisu-, migraatio-, varmistus- ja Windows-paketointipolkuja
- pitää dokumentaatio, testit ja toteutus samassa nykytilassa

Siivous ei ole framework-migraatio eikä ominaisuustyö.

## Rajaus

Siivousvaiheessa ei oletusarvoisesti:

- muuteta liiketoimintasääntöjä
- muuteta HTTP-endpointteja tai API-clientin julkista sopimusta
- muuteta tietokantataulujen merkitystä
- lisätä uusia riippuvuuksia
- luoda yleistä `utils`, `helpers`, `common` tai service locator -kerrosta
- siirtää moduulin domain-logiikkaa yleiseen `packages/domain`-pakettiin
- siirtää laskutuksen PDF-logiikkaa shared-pakettiin ilman toista todellista
  käyttötapausta
- korvata eksplisiittisiä turvallisuusallowlisteja automaattisella
  reittien julkaisemisella
- yhdistää refaktorointiin uutta käyttäjälle näkyvää ominaisuutta

Jos työ paljastaa oikean toiminnallisen tai turvallisuusvirheen, korjaus
rajataan omaan committiinsa. Sitä ei piiloteta rakenteellisen siirron sisään.

## Auditoinnin lähtötilanne

Auditointi vahvisti seuraavat hyvät perusasiat:

- domain-, application- ja port-kerrokset eivät riipu Reactista, HTTP-
  frameworkista, SQLitesta, Electronista tai Firebase-adaptereista
- moduulit eivät importtaa toistensa infrastructure-toteutuksia
- backend muodostaa käyttäjän ja `companyId`-arvon vahvistetusta
  `ActorContext`-kontekstista
- SQL-kyselyt ovat parametrisoituja ja yritysrajaus on mukana
- web käyttää `packages/api-client`-pakettia eikä raakaa `fetch`-logiikkaa
  React-komponenteissa
- Electron renderer on sandboxattu ja main process omistaa sessionin,
  privileged IPC:n, safeStoragen ja backend-protokollan allowlistin
- SMTP-, PDF-, storage- ja secret store -toteutukset ovat adapterirajojen
  takana
- moduulirajoille, laskennalle, yritysrajaukselle ja toimituspoluille on laaja
  automaattinen testikate

Auditointi tunnisti seuraavat suurimmat tiedostot ja vastuut:

| Tiedosto | Auditointihetken rivimäärä | Keskeinen kasvanut vastuu |
| --- | ---: | --- |
| `apps/backend/src/modules/invoicing/infrastructure/sqliteInvoiceApprovalRepository.ts` | 1233 | hyväksyntä, numerointi, snapshotit, audit ja tilasiirtymät |
| `apps/web/src/features/invoicing/components/InvoicingPage.tsx` | 902 | hook-koostaminen, näkymätila ja useat työtilanäkymät |
| `apps/web/src/i18n/fi.ts` | 811 | kaikkien featureiden suomenkieliset tekstit |
| `apps/web/src/features/invoicing/components/ApprovedInvoicePreview.tsx` | 746 | hyväksytyn laskun koko tarkistusnäkymä |
| `packages/api-client/src/invoicing/approvedInvoices/approvedInvoicesResponse.ts` | 730 | usean approved invoice -vastauksen parsinta |
| `apps/backend/src/modules/invoicing/infrastructure/sqliteInvoiceDraftRepository.ts` | 681 | luonnosten luku-, kirjoitus- ja mapping-vastuut |
| `apps/desktop/src/main/index.ts` | 660 | desktop-lifecycle, runtime, ikkunat, dialogit ja smoke |
| `apps/backend/src/modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.ts` | 654 | koko lasku-PDF:n layout |
| `apps/backend/src/modules/invoicing/http/approvedInvoiceRoutes.ts` | 623 | hyväksyttyjen laskujen query-, lifecycle-, PDF- ja delivery-reitit |
| `apps/backend/src/modules/invoicing/infrastructure/sqliteInvoiceDeliveryEventRepository.ts` | 457 | delivery event -luku, kirjoitus ja toimituksen viimeistely |
| `apps/backend/src/http/app.ts` | 446 | koko backendin composition root ja reittien kytkentä |

Rivimäärä ei yksin tee tiedostosta väärää. Siivous tehdään vain, kun tiedostossa
on erotettavissa useita oikeita vastuita ja jako parantaa riippuvuussuuntia tai
testattavuutta.

## Prioriteetit

Koodin vakavuus ja tuotantokäytön release-portti ovat kaksi eri ulottuvuutta.
Niitä ei yhdistetä yhdeksi prioriteetiksi.

### Code Severity

- `P0`: aktiivinen kriittinen tietoturva- tai datan eheysvirhe
- `P1`: vakava arkkitehtuuri- tai ylläpidettävyysriski
- `P2`: selvä tekninen velka
- `P3`: myöhempi parannus

Auditoinnissa ei löytynyt aktiivista `P0`-koodivirhettä.

`P1`-kohteet:

- Invoicing-webin työtilan ohjauksen ja näkymien keskittyminen samaan suureen
  tiedostoon
- Invoicing-moduulin backend-compositionin ja toistuvan PDF-kokoamisen
  keskittyminen `app.ts`-tiedostoon
- SQLite approval -adapterin hyväksyntä-, numerointi-, snapshot-, audit- ja
  tilasiirtymävastuiden keskittyminen

`P2`-kohteet:

- hyväksytyn laskun HTTP-reittien ja API-response-parserin koko
- draft-repositoryn luku-, kirjoitus- ja mapping-vastuiden keskittyminen
- Electron main processin composition-, ikkuna-, dialogi- ja smoke-vastuut
- PDF-rendererin layout-osioiden keskittyminen
- delivery event -adapterin useat muutosperusteet, jos tarkempi arvio vahvistaa
  niiden olevan aidosti erillisiä
- API-client-instanssin toistuva luonti web-featureissä
- tietokantayhteyden eksplisiittisen sulkemisen puuttuminen backend-lifecyclesta
- hyväksynnän jälkeisen automaattisen PDF-luonnin rajallinen näkyvyys

`P3`-kohteet:

- `fi.ts`-tiedoston jako, kun tekstien featureomistajuus on selvä ja muutos
  vähentää oikeasti merge-konflikteja
- testikattavuuden raportointi ja myöhempi kynnys kriittisille kerroksille
- CI-runnerin version lukitseminen
- lint- ja formatointityökalujen arviointi vain erillisellä
  riippuvuushyväksynnällä
- tyhjien skeleton-pakettien tarpeen uudelleenarviointi, kun niiden oikea
  käyttötapa on olemassa

### Release Gate

- `R0`: estää yhden hallitun koneen oikean asiakas- tai laskutusdatan käytön
- `R1`: tarvitaan ennen laajempaa loppukäyttäjäkäyttöönottoa
- `R2`: tarvitaan ennen pilvi-, synkronointi- tai multi-user-käyttöä

#### Datan Eheys: R0

- dokumentoitu ja testattu SQLite backup/restore -polku
- migraatioiden muuttumattomuus tai checksum-tarkistus
- edustavilla vanhoilla tietokannoilla ajettavat upgrade- ja recovery-testit

Nämä ovat `R0`-portteja, koska yhdenkin oikeaa dataa käyttävän asennuksen pitää
selvitä tiedoston vioittumisesta, epäonnistuneesta migraatiosta ja hallitusta
palautuksesta ilman laskutus- tai asiakasdatan hallitsematonta menetystä.

#### Turvallisuus: R0

- tuettu Electron-versio ja hyväksyttyjen runtime-riippuvuuksien
  tietoturvatarkistus
- paikallisen tietokannan, PDF-tiedostojen ja salattujen salaisuustiedostojen
  suojaus käyttöjärjestelmän käyttäjäprofiilissa
- loopback-, runtime-session-, ActorContext- ja permission-rajojen release-
  tarkistus
- turvallinen palautusmalli, joka ei ohita yritys-, session- tai
  salaisuusrajoja

Nämä ovat `R0`-portteja, koska yhden hallitun koneen käyttö ei saa muuttaa
local-runtimen luottamusrajoja tai tehdä oikeasta datasta tarpeettomasti
muiden paikallisten käyttäjien tai verkon saavutettavaa.

#### Jakelu: R1

- hallittu Windows-installer
- julkaisun eheystarkistus ja code signing
- testattu automaattinen tai muuten hallittu päivityspolku
- Windows-paketointi ja packaged smoke tuetulla julkaisuympäristöllä

Nämä ovat viimeistään `R1`-portteja ennen laajempaa jakelua. Code signing
nostetaan `R0`-portiksi vain, jos projektin omistaja päättää, ettei edes yhden
hallittuun koneeseen asennettavaa artifactia saa käyttää allekirjoittamattomana.
Tämä päätös kirjataan erikseen ennen ensimmäistä oikean datan asennusta.

#### Juridiset Velvoitteet: R1

- ajantasainen kolmannen osapuolen lisenssi-inventaario
- jaeltavaan artifactiin kuuluvat lisenssi- ja notice-tiedostot
- valitun jakelumallin tietosuoja- ja käyttöehtotarkistus

Juridiset jakeluvelvoitteet suljetaan viimeistään `R1`-portissa. Jos lisenssi
tai muu velvoite kieltää jo yhden hallitun asennuksen suunnitellulla tavalla,
siitä tulee kyseisen julkaisun `R0`-portti.

Selainpohjaiset kriittisten työnkulkujen E2E-testit ovat nykytilassa `P2` ja
viimeistään `R1`.

`R2`-portteja ovat muun muassa cloud identity, yritysjäsenyydet, rooli- ja
permission-hallinta, cloud secret manager, tenant-eristyksen tuotantomalli ja
synkronoinnin konfliktiturva.

Release gate -työ tehdään erillisissä commiteissa. Esimerkiksi indeksin tai
foreign keyn lisäämistä ei yhdistetä repositoryn käyttäytymisen säilyttävään
pilkkomiseen.

## Refaktoroinnin Käyttäytymisbaseline

Ennen suuren tiedoston ensimmäistä pilkkomista kirjataan kohdecommitin tai
tehtävän lähtötiedoksi:

- nykyinen julkinen API ja exportit
- nykyiset HTTP-polut, metodit ja response-sopimukset
- nykyinen käyttäjäpolku ja käyttäjälle näkyvä lopputulos
- nykyiset moduuli-, permission-, yritys- ja transaktiorajat
- nykyiset testit ja niiden kattamat invariantit
- tunnetut puuttuvat characterization-testit
- asiat, joita refaktorointi ei saa muuttaa

Jos keskeistä nykykäyttäytymistä ei ole suojattu testillä, lisätään ensin
mahdollisimman rajattu characterization-testi. Testi kuvaa nykyisen hyväksytyn
käyttäytymisen, ei vahingossa löytynyttä virhettä uutena vaatimuksena.

## Web-Invoicingin Tavoiterakenne

Nykyinen feature-rakenne säilyy. Uusi jako tehdään sen sisällä, eikä
Invoicing-logiikkaa siirretä app- tai shared-kerrokseen.

Suositeltu kasvusuunta:

```text
apps/web/src/features/invoicing/
  InvoicingPage.ts
  components/
    InvoicingPage.tsx
    InvoicingPageView.tsx
    InvoiceWorkspaceListView.tsx
    InvoiceDraftEditorView.tsx
    ApprovedInvoiceDetailView.tsx
  hooks/
  form/
  drafts/
  preview/
  state/
    invoicingPageState.ts
```

Vastuut:

- julkinen `InvoicingPage.ts` säilyttää app-tason import-polun
- `InvoicingPage.tsx` säilyy feature-tason workspace-controllerina ja kokoaa
  nykyiset hookit
- `InvoicingPageView.tsx` omistaa suuren renderöivän näkymärakenteen
- draft list-, draft editor- ja approved invoice -näkymät irrotetaan vasta,
  kun niille muodostuu selkeä ja rajattu props-sopimus
- nykyinen reducer tai nimetty state-malli omistaa
  list/detail/create/edit-siirtymät
  ja niihin liittyvät resetoinnit
- näkymäkomponentit saavat valmiin tilan ja nimetyt komennot propseina
- API-clientin luonti siirretään app-tason compositioniin, mutta feature-hookit
  säilyvät testattavina injektoitavalla clientillä

Ensimmäinen turvallinen pala saa olla vain `InvoicingPageView`-erotus. Jos
alempien näkymien irrottaminen vaatisi suuren geneerisen props-objektin tai
epäselvän managerin, työ pysäytetään siihen ja seuraava rajaus arvioidaan
erikseen.

Älä rakenna `useInvoicingManager`-, `genericWorkspaceController`-, yleistä
data fetching -frameworkia tai uutta React-contextia tämän jaon yhteydessä.

## Web UI Foundation Ja Saavutettavuus

Jaetun UI:n omistajuus etenee seuraavasti:

```text
apps/web/src/styles.css
  -> design tokenit ja aidosti yhteiset perustyylit

apps/web/src/features/<feature>/components
  -> featurekohtaiset komponentit ja liiketoimintakonteksti

apps/web/src/shared/ui
  -> vähintään 2-3 riippumattoman web-featuren aidosti yhteiset React-
     primitiivit

packages/ui
  -> vasta, jos sama vakaa UI tarvitaan useassa itsenäisessä sovelluksessa
```

Electron desktop käyttää samaa web-sovellusta rendererinä. Se ei yksin ole
toinen itsenäinen React-käyttöliittymä eikä perustele `packages/ui`-pakettia.

Ensimmäisiä arvioitavia `apps/web/src/shared/ui`-primitiivejä voivat olla:

- `Button`, jolla on rajatut `primary`, `secondary`, `ghost` ja `danger`-
  variantit sekä natiivin buttonin ominaisuudet
- `FormField`, joka kokoaa label-, required-, help- ja error-rakenteen mutta
  ei muodosta lomakeframeworkia
- `MessageBanner`
- `ConfirmationPanel`
- `StatusBadge`, jossa feature päättää edelleen domain-tilan ja tekstin

`Panel` tehdään komponentiksi vain, jos yhteinen käyttäytyminen ja rakenne
toistuvat. Pelkkä yhteinen CSS-luokka ei vaadi React-komponenttia.

UI-abstraktion perusteeksi ei riitä saman näköinen JSX. Komponentilla pitää
olla sama käyttäytyminen, saavutettavuussopimus ja muutosperuste useassa
riippumattomassa käyttökohteessa. Yksi primitiivi siirretään kerrallaan
muutamaan edustavaan Customers-, Company Settings- ja Invoicing-kohteeseen.

UI-refaktoroinnin characterization- ja komponenttitesteissä tarkistetaan
riskin mukaan:

- buttonin oikea `type`
- labelin ja inputin ohjelmallinen yhteys
- help- ja error-tekstien `aria-describedby`
- virheen `role="alert"` tai muu tarkoituksenmukainen ilmoitustapa
- näppäimistöfokus vahvistuksen, virheen ja näkymäsiirtymän jälkeen
- näkyvä focus state
- `disabled`- ja loading-tilojen ero
- riittävä kontrasti ja kosketuskohteiden koko
- responsiivisuus sekä 125-150 prosentin näyttöskaalaus

UI-siivous ei saa muuttua pelkäksi ulkoasun massamuutokseksi.

## Backend-Compositionin Tavoiterakenne

`apps/backend/src/http/app.ts` omistaa edelleen sovelluksen ylimmän composition
rootin, middlewaret ja moduulien mounttauksen. Moduulikohtainen konkreettisten
adapterien kokoaminen voidaan siirtää nimettyihin composition-funktioihin.

```text
apps/backend/src/
  composition/
    companySettingsComposition.ts
    customersComposition.ts
    invoicingComposition.ts
  http/
    app.ts
```

`invoicingComposition.ts` saa tuntea:

- Invoicing-moduulin konkreettiset SQLite-adapterit
- yleisen backend email infrastructure -adapterin
- storage- ja PDF-adapterit
- route factoryjen tarvitsemat application-riippuvuudet

Se ei saa:

- sisältää liiketoimintasääntöjä
- muodostua globaaliksi service locatoriksi
- palauttaa vapaasti haettavaa riippuvuusrekisteriä
- siirtää request-kohtaista `ActorContext`-tilaa singletoniin

Toistuva hyväksytyn laskun PDF-riippuvuuksien kokoaminen korvataan yhdellä
nimetyllä compositionilla. Eksplisiittiset käyttötapausriippuvuudet säilyvät.

## HTTP-Reittien Tavoiterakenne

Hyväksyttyjen laskujen reitit jaetaan käyttötarkoituksen mukaan:

```text
invoicing/http/
  approvedInvoiceQueryRoutes.ts
  approvedInvoiceLifecycleRoutes.ts
  approvedInvoiceDocumentRoutes.ts
  approvedInvoiceDeliveryRoutes.ts
  invoicingHttpErrorMapper.ts
```

Reittijako ei muuta URL-polkuja, metodeja, API-clientin sopimusta,
permissioneja tai turvallisia virhevastauksia.

Rajattu `invoicingHttpErrorMapper.ts` saa yhdistää vain aidosti samat
Invoicing application -virheet HTTP-vastauksiksi. Yleistä koko backendin error
manageria ei tehdä.

## SQLite-Adapterien Tavoiterakenne

Approval-adapteri voidaan jakaa sisäisiin vastuihin:

```text
invoicing/infrastructure/sqlite/approval/
  sqliteInvoiceApprovalRepository.ts
  invoiceApprovalQueries.ts
  invoiceApprovalRows.ts
  invoiceNumberSequencePersistence.ts
  invoiceApprovalAuditPersistence.ts
```

Pääsäännöt:

- application service omistaa käyttötapauksen
- repository-adapteri omistaa tietokantatransaktion rajan
- sisäiset query- ja mapper-tiedostot eivät tee itsenäisiä osatransaktioita
- approval, reapproval, reopen, sent ja delivery finalization säilyvät
  atomisina siellä, missä nykyinen liiketoimintasääntö sitä vaatii
- repository-portit eivät paljasta SQLite- tai `better-sqlite3`-tyyppejä
- SQL pysyy infrastructure-kerroksessa
- numeroinnin kilpailutilanteita ja audit-tapahtumia suojaavia testejä ei
  heikennetä jaon yhteydessä

Se, että delivery event -adapteri toteuttaa useita kapeita portteja, ei yksin
ole arkkitehtuurivirhe. Ensin arvioidaan, ovatko portit eri näkymiä samaan
atomiseen persistence-vastuuseen vai onko luokalla aidosti useita erillisiä
muutosperusteita. Sisäiset kyselyt, mapperit ja transaktio-orchestrator voidaan
pilkkoa ilman, että atominen adapteri hajotetaan keinotekoisesti. Eri
adapteriluokat tehdään vain, jos vastuuraja ja transaktio säilyvät selkeinä.
Yleistä repository base class -abstraktiota ei luoda.

## SQLite-Tietomallin Terveystarkistus

Repositoryjen siivouksen yhteydessä tehdään read-only-arvio seuraavista:

- foreign key -rajoitteet ja `PRAGMA foreign_keys`
- yritysrajattujen luku- ja kirjoituskyselyiden tarvitsemat indeksit
- uniikkiusrajat ja idempotenssia tukevat rajoitteet
- transaktion omistajuus
- rollback-testit osittaisen kirjoituksen estämiseksi
- migraatioiden muuttumattomuus ja checksum-politiikka
- edustavat vanhan tietokannan upgrade- ja recovery-fixturet

Terveystarkistus ei muuta tietokantaa repository-refaktoroinnin samassa
commitissa. Löydetyt indeksi-, foreign key- tai schema-muutokset suunnitellaan
ja toteutetaan erillisinä migraatio- ja testicommiteina.

## Import-Syklit Ja Boundary Enforcement

Ennen ja jälkeen vastuiden siirtämisen tarkistetaan ilman uutta riippuvuutta:

- syntyykö tai poistuuko suhteellisten importtien kiertoja
- käyttääkö `app/` vain featureiden julkisia entrypointteja
- importtaako feature toisen featuren sisäisiä komponentteja, hookkeja tai
  stateä
- importtaako backend-moduuli toisen moduulin infrastructurea
- vuotaako SQL-, Hono-, Electron-, React-, Firebase- tai storage-tyyppi väärään
  kerrokseen
- jäikö vanha export, tiedosto tai reitti kuolleeksi koodiksi

Nykyisiä moduuliraja- ja domain-boundary-testejä laajennetaan, jos uusi
vastuuraja ei muuten ole suojattu. Erillistä dependency graph -kirjastoa ei
lisätä ensimmäisessä vaiheessa.

## Electron Main Processin Tavoiterakenne

Electron pysyy infrastructure-kuorena. Main processin jakaminen ei saa avata
uutta yleistä IPC- tai URL-rajapintaa rendererille.

```text
apps/desktop/src/main/
  index.ts
  desktopComposition.ts
  applicationWindow.ts
  invoiceDeliveryConfirmation.ts
  packagedSmoke.ts
```

- `index.ts` omistaa vain sovelluksen ylimmän lifecycle-järjestyksen
- `desktopComposition.ts` kokoaa runtime-, protocol-, secret- ja PDF-
  controllerit
- `applicationWindow.ts` luo ja koventaa pääikkunan
- `invoiceDeliveryConfirmation.ts` omistaa Electron mainin luotetut
  toimitusvahvistukset
- `packagedSmoke.ts` omistaa vain paketoidun artifactin smoke-polun

Nykyiset sandbox-, CSP-, navigation-, permission-, preload-, protocol- ja fuse-
testit säilyvät pakollisina.

## PDF-Rendererin Tavoiterakenne

PDF-renderer pysyy Invoicing-moduulin infrastructure-kerroksessa.

```text
invoicing/infrastructure/pdf/
  approvedInvoicePdfRenderer.ts
  approvedInvoicePdfLayout.ts
  sections/
    drawHeader.ts
    drawRecipientAndMeta.ts
    drawAdditionalDetails.ts
    drawInvoiceLines.ts
    drawVatAndTotals.ts
    drawPaymentBar.ts
    drawFooter.ts
```

`approvedInvoicePdfRenderer.ts` orkestroi järjestyksen. Section-tiedostot
saavat vain tarvitsemansa snapshot-datan ja rajatun layout-kontekstin.
PDF-laskenta ei eriydy domain-laskennasta eikä renderer laske laskun
auktoritatiivisia summia uudelleen.

Shared PDF -pakettia ei tehdä ennen toista todellista ja toisesta moduulista
tulevaa PDF-käyttötapausta.

## API-Clientin Ja i18n:n Tavoiterakenne

Approved invoice -response-parsinta jaetaan HTTP-sopimuksen mukaisiin osiin:

```text
packages/api-client/src/invoicing/approvedInvoices/
  parseApprovedInvoice.ts
  parseApprovedInvoiceSummary.ts
  parseInvoiceDeliveryEvent.ts
  parseApprovedInvoiceEmailPreparation.ts
  parseApprovedInvoicePdfMetadata.ts
  approvedInvoiceResponseReaders.ts
```

Parserit jaetaan resurssin ja HTTP-vastuun mukaan. Yhteiset pienet lukijat ovat
approved invoices -featurekansion sisäisiä eivätkä muodosta yleistä parser-
frameworkia, `parsingUtils.ts`-kaatopaikkaa tai validointipakettia. Julkiset
exportit `index.ts`-tiedostojen kautta säilyvät.

Suomenkieliset tekstit voidaan jakaa featurekohtaisiin tiedostoihin:

```text
apps/web/src/i18n/
  fi.ts
  fi/
    app.ts
    customers.ts
    companySettings.ts
    invoicing.ts
```

Nykyinen `uiText`-käyttötapa säilyy. `fi.ts` ei ole ensimmäisen siivoussprintin
prioriteetti. Jako tehdään vasta, kun featurekohtaiset tekstiryhmät ovat
selvät, julkinen `uiText`-sopimus voidaan säilyttää ja muutos vähentää oikeasti
merge-konflikteja. Uutta i18n-riippuvuutta ei lisätä tämän siivouksen
yhteydessä.

## Toiston Arviointisääntö

Toisto irrotetaan vain, jos vähintään yksi seuraavista täyttyy:

- sama sääntö tai tekninen muunnos esiintyy vähintään 2-3 aidosti
  samanlaisessa käyttökohdassa
- toiston muuttaminen yhdessä paikassa mutta ei toisessa aiheuttaisi oikean
  virheriskin
- uusi nimetty vastuu on ymmärrettävä ilman alkuperäistä kutsupaikkaa
- abstraktio lyhentää riippuvuuspintaa eikä piilota liiketoimintasääntöä

Älä irrota vain samanmuotoista koodia, jos semantiikka, omistava moduuli,
transaktio tai turvallisuusraja on eri.

Esimerkiksi Electronin eksplisiittinen endpoint-allowlist on puolustava
turvallisuusraja. Sitä ei korvata automaattisella backend-reittien
läpiviennillä pelkän polkutoiston poistamiseksi.

## Vakioiden Ja Konfiguraation Omistajuus

Ekyyn ei tehdä yhtä juuritason constants- tai controller-tiedostoa kaikille
arvoille.

- laskennan rajat ja tilat kuuluvat omistavalle domainille
- HTTP-polut kuuluvat HTTP/API-client-sopimukseen
- SMTP-profiilin tekniset oletukset kuuluvat DNA provider -adapterille
- tiedosto- ja viestikokorajat kuuluvat niitä valvovalle infrastructure-
  adapterille
- PDF-layoutin mitat kuuluvat PDF-infrastructurelle
- käyttöliittymävaihtoehdot kuuluvat featurelle, kunnes niistä tulee
  käyttäjän hallittavia moduuliasetuksia
- salaisuuksia ei koskaan keskitetä tavalliseen config-pakettiin

`packages/config` otetaan käyttöön vasta aidosti usean runtimen jakamille,
ei-salaisille ja ympäristöriippumattomille konfiguraatiotyypeille.

## Tiedostonsiirron Pakollinen Tarkistusketju

Kun tiedosto tai vastuu siirretään, sama commit päivittää kaikki siihen
liittyvät viittaukset. Vanhaa väliaikaista polkua ei jätetä pysyvästi rinnalle.

Tarkista aina:

1. toteutustiedoston importit
2. tiedoston vieressä oleva testi ja testien importit
3. feature- tai pakettitason julkiset `index.ts`- ja entrypoint-exportit
4. `App.tsx`- ja composition root -importit
5. API-clientin julkiset exportit ja HTTP-sopimustestit
6. Electron protocol-/transport-allowlist ja metodirajaus, jos endpoint muuttuu
7. preload- ja IPC-sopimus, jos desktop-toiminto muuttuu
8. Vite proxy, build-, package- ja smoke-scriptit
9. `tsconfig`- ja package export -polut
10. dokumenttien tiedostopolut, koodiesimerkit ja keskinäiset linkit
11. `AGENTS.md`-lukusäännöt ja kohdekansion paikallinen `AGENTS.md`
12. GitHub Actions- ja release-komennot

Reitin tai julkisen sopimuksen muuttaminen ei ole tavallinen tiedostonsiirto.
Se vaatii oman päätöksen, API-client-muutoksen, Electron allowlist -tarkistuksen
ja sopimustestit.

Vanhojen viittausten tarkistus tehdään esimerkiksi `rg`-haulla vanhalla
tiedosto-, export-, endpoint- tai symbolinimellä ennen commitia.

## Refaktorointicommitin Työtapa

Jokainen commit pidetään peruttavana ja käyttäytymisen säilyttävänä:

1. varmista puhdas työpuu
2. kirjaa käyttäytymisbaseline ja aja kohteen nykyiset testit
3. lisää rajattu characterization-testi, jos keskeinen nykykäyttäytyminen ei
   ole suojattu; muutoin kirjaa lähtötilan tunnettu virhe
4. siirrä yksi vastuu tai yksi tarkasti rajattu tiedostoryhmä
5. siirrä testit toteutuksen mukana
6. päivitä kaikki importit, entrypointit, reitit ja dokumenttiviittaukset
7. älä muuta samalla nimiä, käyttäytymistä ja arkkitehtuuria enempää kuin jako
   vaatii
8. aja kohdepaketin testit ja typecheck
9. aja workspace-testit, buildit ja `git diff --check` riskin mukaan
10. tarkista `git status` ja varmista, ettei artifacteja tai salaisuuksia tullut
   mukaan
11. tee yksi tarkoituksellinen commit

Laskutus-, permission-, audit-, salaisuus-, SMTP-, PDF-, migration- ja
Electron-luottamusrajoja koskevissa refaktoroinneissa myös negatiivisten
turvallisuustestien pitää säilyä vihreinä.

## Suositeltu Commit-Järjestys

1. `docs(architecture): add codebase cleanup roadmap`
2. `refactor(web): split invoicing workspace views`
3. `refactor(web): split approved invoice preview sections`
4. `refactor(web): add first approved shared ui primitive`, jos käyttöpaikka-
   inventaario vahvistaa vähintään 2-3 riippumatonta tarvetta
5. `refactor(web): centralize api client composition`
6. `refactor(backend): isolate invoicing composition`
7. `refactor(invoicing): split approved invoice routes`
8. `refactor(api-client): split approved invoice response readers`
9. `refactor(invoicing): split approval persistence responsibilities`
10. `refactor(invoicing): split delivery and draft persistence`
11. `refactor(desktop): split main process composition`
12. `refactor(invoicing): split approved invoice pdf layout`
13. `refactor(web): split feature translations`, jos jako on silloin
    perusteltu
14. `chore(release): harden migrations backup and windows release gate`

Järjestystä voidaan muuttaa, jos uusi auditointihavainto tai tuotannon
release-tarve nostaa jonkin kohdan kiireellisemmäksi. Yhteen committiin ei
yhdistetä useaa taulukon työvaihetta ilman erillistä perustelua.

## Testien Terveystarkistus

Refaktorointisprintissä arvioidaan testien määrästä erillään niiden
luotettavuutta:

- suojaavatko testit julkista käyttäytymistä vai toteutuksen sisäisiä
  yksityiskohtia
- puuttuuko kriittisestä näkymäsiirtymästä tai tilasiirtymästä
  characterization-testi
- sisältävätkö fixturet toistuvaa epäjohdonmukaista dataa
- onko testidatan builderille vähintään 2-3 oikeaa käyttötarvetta ennen sen
  irrottamista
- testataanko transaction rollback, idempotenssi ja osittaisen kirjoituksen
  estyminen
- testataanko permission-, yritysrajaus-, virhe- ja väärinkäyttöpolut
- käyttävätkö web-testit tarvittaessa oikeaa käyttäjäinteraktiota pelkän
  staattisen renderöinnin lisäksi

Yleistä `test-utils`- tai fixture-kaatopaikkaa ei luoda. E2E-testit saavat
myöhemmin oman selkeästi nimetyn testialueensa, koska ne suojaavat usean
kerroksen käyttäjäpolkua eivätkä yhden tiedoston vastuuta.

## Testausportit

Dokumentaatiovaiheessa riittää:

```text
git diff --check
```

Yksittäisen paketin refaktoroinnissa ajetaan vähintään kohdepaketin testit,
typecheck ja build.

Laajan tai usean paketin rajaa koskevan refaktoroinnin vähimmäisportti:

```text
pnpm test
pnpm typecheck
pnpm --filter @eky/backend build
pnpm --filter @eky/web build
pnpm --filter @eky/desktop build
git diff --check
```

Desktopin package-, native addon-, safeStorage-, PDF- tai release-muutoksissa
ajetaan lisäksi Windows-paketointi ja packaged smoke hyväksytyssä Windows-
ympäristössä.

## Valmis-Määritelmä

Siivousaskel on valmis vasta, kun:

- käyttäytyminen ja julkiset sopimukset ovat säilyneet tai muutos on erikseen
  hyväksytty
- moduuli- ja kerrosrajat ovat vähintään yhtä vahvat kuin ennen muutosta
- tiedostolla ja kansiolla on yksi nimettävä vastuu
- vanha polku tai symboli ei jää tarpeettomasti rinnalle
- importit, entrypointit, testit, Electron-allowlistit ja dokumenttilinkit ovat
  ajantasaiset
- testit on siirretty toteutuksen mukana ja tarvittavat tarkistukset ovat
  vihreät
- riippuvuuksia tai lockfilea ei ole muuttunut ilman erillistä hyväksyntää
- tuotanto- tai henkilötietoa, salaisuuksia tai build-artifakteja ei ole tullut
  versionhallintaan
- commit on pieni, ymmärrettävä ja turvallisesti peruttavissa

## Seuranta

Tämä on elävä roadmap. Toteutetut kohdat merkitään tähän dokumenttiin tai
korvataan viittauksella uuteen hyväksyttyyn ADR- tai moduulisuunnitelmaan.

| Vaihe | Tila | Lähtöcommit | Valmis commit | Huomiot |
| --- | --- | --- | --- | --- |
| Cleanup- ja UI-dokumenttien tarkennus | Valmis | `195cce2` | `0f7add7` | Omistajuudet, release-portit ja seuranta tarkennettu |
| `InvoicingPageView`-erotus | Valmis | `0f7add7` | `4688d22` | Controller, näkymä ja näkymätesti erotettu; julkinen entrypoint säilytetty |
| `InvoiceWorkspaceListView`-erotus | Valmis | `4688d22` | `5286f19` | Draft-, approved- ja sent-listat sekä niiden testit erotettu rajatulla props-sopimuksella |
| `InvoiceDraftEditorView`-erotus | Valmis | `5286f19` | Tämä commit | Luonnoksen lataus-, virhe- ja editointinäkymä sekä niitä koskevat testit erotettu rajatulla props-sopimuksella |
| Muut cleanup-roadmapin vaiheet | Ei aloitettu | - | - | Vaativat projektin omistajan uuden luvan |

Roadmapia ei käytetä vanhojen ADR-päätösten historian uudelleenkirjoittamiseen.
Kun nykytila muuttuu, nykytilaa kuvaavat moduuli- ja arkkitehtuuridokumentit
päivitetään samassa muutoksessa.

Seuraava pienin turvallinen toteutusaskel on `ApprovedInvoiceDetailView`-erotus
ilman käyttäytymis-, API-, tietokanta- tai riippuvuusmuutoksia.
