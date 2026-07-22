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
| Paikallinen `AGENTS.md` | **Compliant** | **Compliant** | **Needs documentation update**: moduulilta puuttuu oma rajattu ohje |
| Datan omistajuus | **Compliant**: asiakasmaster ja asiakaskohtainen tuntihinta | **Compliant**: oman yrityksen master data ja oletukset | **Compliant**: luonnokset, hyväksytyt snapshotit, numerointi, maksuehdot, dokumentit ja toimitustapahtumat |
| Domain | **Acceptable because module is small**: asiakastyypit ja säännöt ovat erillään | **Compliant**: asetusten, pankki- ja sähköpostiarvojen säännöt ovat erillään | **Compliant**: laskenta, numerointi, viite, tilat ja toimitussäännöt ovat domainissa |
| Application | **Acceptable because module is small**: kolme selkeää käyttötapausta | **Compliant**: asetukset ja salaisuuden elinkaari on erotettu | **Compliant**: käyttötapaukset ovat erillisiä ja riippuvat porteista |
| Portit | **Compliant** moduulin sisällä | **Compliant** moduulin sisällä | **Compliant** moduulin sisällä; compositionin ulkoiset nimet tarvitsevat rajauksen |
| Infrastructure | **Acceptable because module is small**: yksi SQLite-adapteri | **Compliant**: repository ja salaisuusauditointi erillään | **Compliant**: SQLite-, PDF-, storage- ja provider-adapterit ovat rajojen takana |
| HTTP | **Compliant** yritysrajauksen osalta | **Compliant**: validointi ja turvalliset salaisuusvirheet | **Compliant**: reitit on jaettu query-, lifecycle-, document- ja delivery-vastuisiin |
| Composition | **Needs limited structural correction**: kytkentä on vielä suoraan `app.ts`:ssä | **Needs limited structural correction**: kytkentä ja salaisuustilan rikastus ovat vielä `app.ts`:ssä | **Compliant**, mutta sille pitää antaa lähdemoduulien repositoryjen sijaan kapeat Invoicing-readerit |
| `ActorContext` ja `companyId` | **Compliant**: HTTP ottaa yrityksen vahvistetusta kontekstista | **Compliant** | **Compliant** |
| Permissionit | **Future concern**: customer-kohtaisia permissioneja ei ole vielä mallinnettu | **Compliant** nykyisille muutos- ja salaisuustoiminnoille | **Future concern**: `sendInvoices` suojaa toimituspolun, mutta kaikkia tulevia laskutustoimintoja ei ole vielä eroteltu omiksi oikeuksiksi |
| Transaktiot | **Future concern**: automaattisen asiakasnumeron kilpailutilanne arvioidaan ennen multi-user-käyttöä | **Compliant** nykyisille yksittäisille upserteille; salaisuus- ja audit-adapterin välinen epäonnistumismalli on dokumentoitu | **Compliant**: laskuluonnos-, hyväksyntä-, numerointi-, audit- ja delivery-siirtymät omistavat atomiset rajansa |
| API-client | **Compliant**: oma feature-entrypoint ja testit | **Compliant**: oma feature-entrypoint ja testit | **Compliant**: invoice drafts-, numbering-, payment- ja approved invoice -rajat erillään |
| Web | **Compliant**: feature käyttää API-clientiä | **Compliant**: feature käyttää API-clientiä | **Compliant**: feature on jaettu controller-, view-, hook-, form- ja preview-vastuisiin |
| Cross-module-luku | **Needs limited structural correction**: nykyinen repository-luku rajataan compositionissa asiakaslukijaksi | **Needs limited structural correction**: nykyinen repository-luku rajataan compositionissa sähköpostiasetuslukijaksi | **Needs limited structural correction** composition-nimissä; hyväksynnän suora snapshot-lukija on dokumentoitava rajattu poikkeus |
| Cross-module-kirjoitus | **Compliant**: muut moduulit eivät kirjoita customer-masteriin | **Compliant**: muut moduulit eivät kirjoita company masteriin tai salaisuuksiin | **Compliant**: ei kirjoita Customers- tai Company Settings -tauluihin |
| Testit | **Future concern**: domain-, application- ja HTTP-testit ovat olemassa, mutta SQLite-adapterille ei ole omaa suoraa testiä | **Compliant**: domain-, application-, HTTP-, repository-, audit- ja boundary-testit | **Compliant**: laaja domain-, application-, HTTP-, adapteri-, transaktio- ja boundary-kate |
| Jaettu infra | **Compliant** | **Compliant**: secret store tulee ulkoa portin kautta | **Compliant**: yleinen SMTP-infra kytketään compositionissa, ei domainissa |

## Moduulikohtaiset Havainnot

### Customers

Customers on tarkoituksella pieni moduuli. Sen 14 tiedostoa sisältävät aidosti
tarvittavat domain-, application-, ports-, infrastructure- ja HTTP-vastuut.
Invoicingin rakenteen tai tiedostomäärän kopiointi ei parantaisi sitä.

Nykyinen puute on ylimmän tason kokoaminen. `app.ts` luo suoraan
`SqliteCustomerRepository`-adapterin ja sitoo kolme application serviceä
HTTP-reitteihin. Rajattu `customersComposition` tekisi moduulin julkisesta
backend-pinnasta näkyvän: reitit sekä Invoicingin tarvitsema
`CustomerAccessReader`. Konkreettista repositorya ei pidä palauttaa.

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

`app.ts` luo kuitenkin repositoryn, audit writerin, valinnaiset
salaisuusreitit ja sähköpostisalaisuuden tilarikastuksen. Nämä kuuluvat
rajattuun `companySettingsComposition`-funktioon. Sen julkinen tulos saa
sisältää vain reitit sekä Invoicingin tarvitseman
`InvoiceEmailSettingsReader`-sopimuksen. Repositorya, audit writeria tai secret
storea ei palauteta vapaasti käytettäväksi.

### Invoicing

Invoicing on muita nykyisiä moduuleja selvästi laajempi, koska se omistaa
laskennan, luonnokset, hyväksynnän, snapshotit, numeroinnin, PDF-dokumentit,
toimitustapahtumat ja sähköpostitoimituksen käyttötapaukset. Sen 183 tiedostoa
eivät ole tavoitemalli pienille moduuleille.

Nykyinen `invoicingComposition` on oikea moduulikohtainen composition-raja.
Sen vaihtoehdot ovat kuitenkin nimetty `customerRepository`- ja
`companySettingsRepository`-riippuvuuksiksi. Vaikka ne on rajattu `Pick`-
tyypeillä ja niitä käytetään vain lukemiseen, nimet ja tyypit kuvaavat
persistenceä eivätkä Invoicingin tarvitsemaa sopimusta. Compositionin pitää
vastaanottaa suoraan Invoicingin omistamat `CustomerAccessReader`- ja
`InvoiceEmailSettingsReader`-portit.

Invoicingin hyväksyntäadapterissa oleva `SqliteInvoiceApprovalSnapshotReader`
lukee `customers`- ja `company_settings`-tauluja suoraan parametrisoidulla,
`companyId`:llä rajatulla SQL:llä saman hyväksyntätransaktion sisällä. Se ei
kirjoita lähdemoduulien tauluihin eikä siirrä master-datan omistajuutta.
Ratkaisu säilyttää snapshotin atomisuuden, mutta ohittaa omistavien moduulien
nimetyt lukusopimukset. Tämä on rajattu nykyinen persistence-poikkeus, joka
arvioidaan erikseen ennen tietokantapinon irrottamista, pilvisynkronointia tai
moduulien eriyttämistä. Sitä ei korjata composition-siirron sivuvaikutuksena.

Invoicingilta puuttuu moduulikohtainen `AGENTS.md`. Se lisätään lyhyenä
ohjeena, joka nimeää moduulin omistajuuden, pakolliset dokumentit,
luottamusrajat, cross-module-sopimukset ja olennaiset testit kopioimatta juuri-
`AGENTS.md`:ää.

## `app.ts`:n Tavoiteltu Rajaus

Nykyinen `app.ts` omistaa sekä ylimmän runtimen että Customers- ja Company
Settings -moduulien sisäisen kokoamisen. Rajattujen korjausten jälkeen se
omistaa edelleen:

- tietokantayhteyden ja migraatioiden käynnistyksen
- paikallisen runtime-identiteetin ja trust-middlewaren
- health-reitin
- ulkoa tuotavat runtime-adapterit ja `CreateAppOptions`-sopimuksen
- kolmen nimetyn moduulicompositionin luonnin ja reittien mounttauksen

Se ei enää omista Customers- tai Company Settings -application servicejen,
repositoryjen tai HTTP-riippuvuuksien yksityiskohtaista sidontaa.

## Rajatut Korjaukset

Auditointi perustelee seuraavat käyttäytymistä säilyttävät korjaukset:

1. Lisää `customersComposition`, joka palauttaa vain reitit ja
   `CustomerAccessReader`-sopimuksen.
2. Lisää `companySettingsComposition`, joka palauttaa vain reitit ja
   `InvoiceEmailSettingsReader`-sopimuksen.
3. Muuta `invoicingComposition` vastaanottamaan nämä kapeat portit ilman
   Customers- tai Company Settings -repository-tyyppejä.
4. Lisää Invoicing-moduulille oma rajattu `AGENTS.md`.

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
composition-korjausten tekemisen.
