# Nykyisten Moduulien Yhdenmukaisuusauditointi

Tämä dokumentti kuvaa Customers-, Company Settings- ja Invoicing-moduulien
nykyisen suhteen Eky-projektin moduuli-, riippuvuus-, turvallisuus- ja
testausperiaatteisiin. Auditointi tehtiin 22.7.2026 commitin `f7780e8`
(`docs(ai): route module work through architecture checklist`) pohjalta.

Auditointi ei määrittele yhtä pakollista kansiopuuta tai tiedostomäärää.
Moduulin rakenteen pitää vastata sen todellisia vastuita. Auditointi käyttää
seuraavia tiloja:

- **Compliant**: nykyinen ratkaisu vastaa hyväksyttyä linjaa.
- **Acceptable because module is small**: kevyempi rakenne on perusteltu eikä
  puuttuva lisäkerros parantaisi vastuujakoa.
- **Needs documentation update**: toteutus on hyväksyttävä, mutta nykyinen
  ohjaus tai poikkeus ei ole riittävän näkyvä.
- **Needs limited structural correction**: rajattu käyttäytymistä säilyttävä
  rakennemuutos parantaa moduulirajaa.
- **Future concern**: ei estä nykyistä local-MVP:tä, mutta asia pitää ratkaista
  ennen sitä vastaavaa laajempaa käyttöä.

## Yhteenvetomatriisi

| Tarkistettava asia | Customers | Company Settings | Invoicing |
| --- | --- | --- | --- |
| Moduulidokumentti | **Compliant**: `docs/modules/customers.md` | **Compliant**: `docs/modules/company-settings.md` | **Compliant**: `docs/modules/invoicing.md` |
| Paikallinen `AGENTS.md` | **Compliant** | **Compliant** | **Compliant**: omistajuus, cross-module-rajat ja testivaatimukset on nimetty |
| Datan omistajuus | **Compliant**: asiakasmaster ja asiakaskohtainen tuntihinta | **Compliant**: oman yrityksen master data ja oletukset | **Compliant**: luonnokset, hyväksytyt snapshotit, numerointi, maksuehdot, dokumentit ja toimitustapahtumat |
| Domain | **Acceptable because module is small**: asiakastyypit ja säännöt ovat erillään | **Compliant**: asetusten, pankki- ja sähköpostiarvojen säännöt ovat erillään | **Compliant**: laskenta, numerointi, viite, tilat ja toimitussäännöt ovat domainissa |
| Application | **Acceptable because module is small**: kolme selkeää käyttötapausta | **Compliant**: asetukset ja salaisuuden elinkaari on erotettu | **Compliant**: käyttötapaukset ovat erillisiä ja riippuvat porteista |
| Portit | **Compliant** moduulin sisällä | **Compliant** moduulin sisällä | **Compliant**: myös composition vastaanottaa kuluttajan omistamat kapeat reader-portit |
| Infrastructure | **Acceptable because module is small**: yksi SQLite-adapteri | **Compliant**: repository ja salaisuusauditointi erillään | **Compliant**: SQLite-, PDF-, storage- ja provider-adapterit ovat rajojen takana |
| HTTP | **Compliant** yritysrajauksen osalta | **Compliant**: validointi ja turvalliset salaisuusvirheet | **Compliant**: reitit on jaettu query-, lifecycle-, document- ja delivery-vastuisiin |
| Composition | **Compliant**: oma composition palauttaa reitit ja kapean asiakaslukijan | **Compliant**: oma composition palauttaa reitit ja kapean sähköpostiasetuslukijan | **Compliant**: vastaanottaa Invoicingin omistamat reader-portit ilman lähdemoduulien repositoryja |
| `ActorContext` ja `companyId` | **Compliant**: HTTP ottaa yrityksen vahvistetusta kontekstista | **Compliant** | **Compliant** |
| Permissionit | **Future concern**: customer-kohtaisia permissioneja ei ole vielä mallinnettu | **Compliant** nykyisille muutos- ja salaisuustoiminnoille | **Future concern**: `sendInvoices` suojaa toimituspolun, mutta kaikkia tulevia laskutustoimintoja ei ole vielä eroteltu omiksi oikeuksiksi |
| Transaktiot | **Future concern**: automaattisen asiakasnumeron kilpailutilanne arvioidaan ennen multi-user-käyttöä | **Compliant** nykyisille yksittäisille upserteille; salaisuus- ja audit-adapterin välinen epäonnistumismalli on dokumentoitu | **Compliant**: laskuluonnos-, hyväksyntä-, numerointi-, audit- ja delivery-siirtymät omistavat atomiset rajansa |
| API-client | **Compliant**: oma feature-entrypoint ja testit | **Compliant**: oma feature-entrypoint ja testit | **Compliant**: invoice drafts-, numbering-, payment- ja approved invoice -rajat erillään |
| Web | **Compliant**: feature käyttää API-clientiä | **Compliant**: feature käyttää API-clientiä | **Compliant**: feature on jaettu controller-, view-, hook-, form- ja preview-vastuisiin |
| Cross-module-luku | **Compliant**: tarjoaa vain `CustomerAccessReader`-sopimuksen | **Compliant**: tarjoaa vain `InvoiceEmailSettingsReader`-sopimuksen | **Compliant** compositionissa; hyväksynnän suora snapshot-lukija säilyy dokumentoituna rajattuna poikkeuksena |
| Cross-module-kirjoitus | **Compliant**: muut moduulit eivät kirjoita customer-masteriin | **Compliant**: muut moduulit eivät kirjoita company masteriin tai salaisuuksiin | **Compliant**: ei kirjoita Customers- tai Company Settings -tauluihin |
| Testit | **Future concern**: domain-, application- ja HTTP-testit ovat olemassa, mutta SQLite-adapterille ei ole omaa suoraa testiä | **Compliant**: domain-, application-, HTTP-, repository-, audit- ja boundary-testit | **Compliant**: laaja domain-, application-, HTTP-, adapteri-, transaktio- ja boundary-kate |
| Jaettu infra | **Compliant** | **Compliant**: secret store tulee ulkoa portin kautta | **Compliant**: yleinen SMTP-infra kytketään compositionissa, ei domainissa |

## Moduulikohtaiset Havainnot

### Customers

Customers on tarkoituksella pieni moduuli. Sen 14 tiedostoa sisältävät aidosti
tarvittavat domain-, application-, ports-, infrastructure- ja HTTP-vastuut.
Invoicingin rakenteen tai tiedostomäärän kopiointi ei parantaisi sitä.

`customersComposition` luo repositoryn, sitoo kolme application serviceä
HTTP-reitteihin ja tarjoaa Invoicingille vain `CustomerAccessReader`-portin.
Konkreettista repositorya ei palauteta compositionista.

Customer-HTTP käyttää aina `ActorContext.companyId`-arvoa eikä luota bodyn tai
queryn yritystietoon. Erillisiä customer-permissioneja ei vielä ole
`@eky/permissions`-sopimuksessa. Tämä ei muuta nykyisen yhden local-owner-
käyttäjän yritysrajausta, mutta permissionit pitää suunnitella ennen
multi-user- tai roolipohjaista käyttöä.

### Company Settings

Company Settingsin laajempi tiedostomäärä on perusteltu pankki-, sähköposti- ja
salaisuuden elinkaarisäännöillä. Asetusmaster, salaisuuden portit ja
salaisuusauditointi ovat erillisiä. Salaisuutta ei tallenneta tavalliseen
SQLite-dataan eikä palauteta frontendille.

`companySettingsComposition` luo repositoryn, tarvittaessa audit writerin,
valinnaiset salaisuusreitit ja sähköpostisalaisuuden tilarikastuksen. Sen
julkinen tulos sisältää vain reitit sekä Invoicingin tarvitseman
`InvoiceEmailSettingsReader`-sopimuksen. Repositorya, audit writeria tai secret
storea ei palauteta vapaasti käytettäväksi.

### Invoicing

Invoicing on muita nykyisiä moduuleja selvästi laajempi, koska se omistaa
laskennan, luonnokset, hyväksynnän, snapshotit, numeroinnin, PDF-dokumentit,
toimitustapahtumat ja sähköpostitoimituksen käyttötapaukset. Sen 183 tiedostoa
auditointihetkellä eivät ole tavoitemalli pienille moduuleille.

`invoicingComposition` vastaanottaa suoraan Invoicingin omistamat
`CustomerAccessReader`- ja `InvoiceEmailSettingsReader`-portit. Se ei tunne
Customers- tai Company Settings -repository-tyyppejä.

Invoicingin hyväksyntäadapterissa oleva `SqliteInvoiceApprovalSnapshotReader`
lukee `customers`- ja `company_settings`-tauluja suoraan parametrisoidulla,
`companyId`:llä rajatulla SQL:llä saman hyväksyntätransaktion sisällä. Se ei
kirjoita lähdemoduulien tauluihin eikä siirrä master-datan omistajuutta.
Ratkaisu säilyttää snapshotin atomisuuden, mutta ohittaa omistavien moduulien
nimetyt lukusopimukset. Tämä on rajattu nykyinen persistence-poikkeus, joka
arvioidaan erikseen ennen tietokantapinon irrottamista, pilvisynkronointia tai
moduulien eriyttämistä. Sitä ei korjata composition-siirron sivuvaikutuksena.

Invoicingin moduulikohtainen `AGENTS.md` nimeää moduulin omistajuuden,
pakolliset dokumentit, luottamusrajat, cross-module-sopimukset ja olennaiset
testit kopioimatta juuri-`AGENTS.md`:ää.

## `app.ts`:n Nykyinen Rajaus

`app.ts` omistaa ylimmän runtimen ja:

- tietokantayhteyden ja migraatioiden käynnistyksen
- paikallisen runtime-identiteetin ja trust-middlewaren
- health-reitin
- ulkoa tuotavat runtime-adapterit ja `CreateAppOptions`-sopimuksen
- kolmen nimetyn moduulicompositionin luonnin ja reittien mounttauksen

Se ei enää omista Customers- tai Company Settings -application servicejen,
repositoryjen tai HTTP-riippuvuuksien yksityiskohtaista sidontaa.

## Valmistuneet Rajatut Korjaukset

| Muutos | Commit |
| --- | --- |
| Moduulityön ohjaus toteutuschecklistiin | `f7780e8` |
| Nykyisten moduulien lähtöauditointi | `b546438` |
| Customers-composition ja `CustomerAccessReader`-raja | `a0325d1` |
| Company Settings -composition ja `InvoiceEmailSettingsReader`-raja | `6109130` |
| PR #143: Invoicingin SQLite read model -vastuiden ja mappingien jako | `4eb809c`, `bc2ed0b` |

Invoicingin moduulikohtainen ohje ja nykytilan referenssit viimeistellään tämän
dokumentaatiovaiheen yhteydessä.

PR #143:ssa `ApprovedInvoiceReader`, `InvoiceCreditContextReader` ja
`SentInvoiceGroupReader` erotettiin omiksi SQLite-adaptereikseen. Yhteiset
muunnokset sijoitettiin tarkasti nimettyihin moduulikohtaisiin tiedostoihin
`approvedInvoiceReadModelMapping.ts` ja `sentInvoiceGroupMapping.ts`. Muutos
säilytti käyttäytymisen, API-sopimukset, skeeman, SQL-kyselyiden
tenant-rajaukset ja muut `companyId`-rajat ennallaan.

Korjaukset eivät muuta endpointteja, response-muotoja, `ActorContext`- tai
permission-sääntöjä, `CreateAppOptions`-sopimusta, SQL-kyselyitä,
transaktioita, tietokantaa, API-clientiä, webiä tai Electronia.

## Myöhemmät Huolet

Seuraavat eivät kuulu tähän rakenteelliseen korjaukseen:

- Customers- ja muiden liiketoimintatoimintojen tarkempi permission-malli
- Customers SQLite-adapterin suora characterization-testi
- automaattisen asiakasnumeron kilpailutilanne multi-user-käytössä
- hyväksyntäsnapshotin suoran cross-module SQL-lukemisen korvaaminen
  omistavien moduulien sopimuksilla atomisuutta menettämättä
- moduulien irrottaminen erillisiksi palveluiksi tai pilviread-modeleiksi

Auditoinnissa ei löytynyt aktiivista salaisuuden vuotoa, yritysrajauksen
ohitusta, toisen moduulin master-dataan kohdistuvaa kirjoitusta tai muuta
turvallisuuspoikkeamaa, joka estäisi yllä kuvattujen rajattujen
composition-korjausten hyväksymisen.

## R0 Observability -lähtöauditointi

Nykytila ennen observability-toteutusta:

- Invoicing omistaa `invoice_audit_events`- ja
  `invoice_delivery_events`-rakenteet.
- Company Settings omistaa sähköpostisalaisuuden erillisen lifecycle-auditin.
- Customersilla ei vielä ole moduulin omaa business audit -taulua.
- Company Settingsin tavallisilla master-data- ja laskutusasetusten
  kirjoituspoluilla ei vielä ole yhtenäistä moduulin omaa audit-taulua.
- Backendillä ja desktopilla ei vielä ole tyypitettyä, redaktoitua,
  rotatoivaa operational/security JSONL -pohjaa.
- Activity feed, diagnostics, turvallinen lokikansion avaus ja tukipaketti
  puuttuvat.

R0-observability rakentaa nämä rajat ilman globaalia business audit
-kirjoitustaulua. Moduulit omistavat write-auditinsa; Activity on vain
read-only composition.

Auditissa löytynyt erillinen pilotin release-blocker on viivästyskoron
`100000` basis pointin eli 1000 % tekninen yläraja. Se korjataan omana
laskutuksen domain-, UI- ja migraatiomuutoksenaan ennen oikeaa dataa eikä
observability-työn sivuvaikutuksena.

## R0 Observability -toteutuksen tila

Lähtöauditin jälkeen R0-observability on toteutettu seuraavina rajattuina
muutoksina:

| Muutos | Commit |
| --- | --- |
| Observability-perusta ja hyväksytyt turvallisuusrajat | `07b9f28` |
| Tyypitetyt operational event -sopimukset | `3c12720` |
| Rotatoivat ja säilytysajalla rajatut JSONL-lokit | `7e83f7c` |
| Kriittisten runtime-rajojen instrumentointi | `6840ed4` |
| Customers- ja Company Settings -kirjoitusten moduuliomisteinen auditointi | `93be675` |
| Read-only Activity-koontinäkymä | `327a54c` |
| Sanitoitu Diagnostics-näkymä | `2ca4bac` |
| Electron mainin hallitsema turvallinen operational log -kansion avaus | `3610932` |
| Electron mainin hallitsema sanitoitu tukipakettivienti | `2f016a2` |
| Tuki- ja historianäkymien ryhmittely Oma yritys -näkymään | `826286d` |
| Diagnostics-capabilityjen sisällytys Windows-pakettiin | `2e1aa92` |
| Laskutusasetusten auditointi ja business audit -retention | `bc1bf3e` |

Tukipaketti syntyy vain käyttäjän vahvistuksella ja Electron main -prosessin
omistaman kapean capabilityn kautta. Renderer ei anna vientipolkua,
backend-originia, runtime-sessionia, URL:ia tai tukipaketin sisältöä.
Backendin permission-tarkistettu tekninen read model palauttaa vain
sovellusversiot, tietokannan health- ja migraatioyhteenvedon sekä sanitoidut
viimeisen 30 päivän warn-, error- ja security-eventit. Paketti ei sisällä
asiakas- tai laskudataa, PDF:iä, master dataa, `companyId`- tai
actor-tunnisteita, polkuja, salaisuuksia, request/response-bodyja eikä raakoja
lokirivejä.

Activity säilyy read-only-koontina eikä omista business audit -kirjoituksia.
Diagnostics ei palauta raakoja operational eventejä, vaan erillisen
sanitoidun projection-mallin. Moduulit omistavat edelleen omat atomiset
business audit -kirjoituksensa.

Observabilityn fix-forward-vaihe täydensi toteutusta seuraavasti:

- Activity tukee kuukautta, moduulikategoriaa, lopputulosta ja rajattua
  sivutusta sekä näyttää turvallisesti myös epäonnistuneet, epäselvät ja
  kesken jääneet laskutoimitukset
- Invoicing omistaa ALV-kantojen, laskunumeroinnin ja maksuasetusten atomiset
  audit-kirjoitukset
- Company Settingsin Activity-projektio sisältää sähköpostisalaisuuden
  valmiit lifecycle-tapahtumat ilman salaisuustietoa
- Customers-, Company Settings- ja Invoicing-auditien retention kulkee
  moduulikohtaisten porttien kautta startup-maintenancessa
- operational-lokin kapasiteetti- ja kirjoitusvirheellä on ei-rekursiivinen,
  tunnisteeton incident-index-varapolku

Muutokset eivät siirrä audit-taulujen omistajuutta Activitylle eivätkä muuta
Activityä kirjoittavaksi moduuliksi.
