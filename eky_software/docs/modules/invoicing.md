# Invoicing-moduuli

Tämä dokumentti kuvaa laskutusmoduulin.

Laskutus on kriittinen moduuli. Muutokset laskutukseen vaativat erityistä huolellisuutta.

Laskenta-, SMTP- ja revisiokorjausten B-kokonaisuus sekä katalogin K on
hyväksytty. Nykyisen työn sääntöomistajat ovat alla, eivät M1:n vanhat
välivaiheiden checkpointit. Hyväksyntähistoria säilyy
[M1:n näytössä](../architecture/release-0.3.0-m1-preparation-plan.md#jatka-tästä).
Tämä ei hyväksy D:tä, julkaisua tai uuden muutoksen portteja.

## Tarkoitus

Invoicing-moduuli hallitsee laskuluonnoksia, laskuja, laskurivejä, laskun tiloja ja laskutuksen sääntöjä.

Laskutus toimii itsenäisesti. Manuaalinen lasku voidaan luoda suoraan asiakkaalle ilman kohdetta, työmääräystä, tuntikirjausta tai mobiilityönkulkua.

Laskutuksen ja valinnaisen työnohjauspolun rajat on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

Ensimmäisen manuaalisen laskuluonnos-MVP:n rajaus, classic-käyttöliittymä ja toteutusvaiheet on kuvattu dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

Laskun hyväksynnän, virallisen laskunumeron, numerointisarjojen, snapshotin ja auditoinnin periaatteet on kuvattu dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

Käytetyn numerointisarjan hallittu korvaaminen uudella immutable-sarjalla,
aktiivisen sarjan pointer ja append-only-vaihtohistoria on suunniteltu
dokumentissa
`docs/architecture/invoice-numbering-series-transition-plan.md`. Toteutettu
poikkeuspolku laskee backendissä pienimmän törmäyksettömän aloitusnumeron,
vaatii täsmällisen vahvistuksen ja vaihtaa aktiivisen pointerin atomisesti.
Se ei resetoi, poista, uudelleenaktivoi tai avaa vanhaa sarjaa muokattavaksi.
Aktivointi ei varaa laskunumeroa. Standardi- ja hyvityslaskun hyväksyntä
käyttävät transaktion sisällä luettua aktiivista sarjaa, mutta reapproval
säilyttää laskun alkuperäisen sarjan ja numeron.

Hyväksytyn laskun katselu-, print- ja PDF-polun tarvitsemat data- ja snapshot-valmiudet on kuvattu dokumentissa `docs/architecture/invoice-print-data-foundation-plan.md`.

Muuttumaton sisältö, sisäinen täsmärevisiolukija ja täydet 64/18/11-kentät
kuuluvat [hyväksyntäsopimukseen](../architecture/invoice-approval-numbering-plan.md#muuttumaton-sisältörevisio).
DDL, header-last-julkaisu ja migraatio kuuluvat
[SQLite-sopimukseen](../architecture/sqlite-invoice-approval-persistence-plan.md#nykyinen-revisiojulkaisu).

PDF-polun ensimmäinen teknologiakokeilu ja sisäisten PDF-apujen rajaus on
kuvattu dokumentissa `docs/architecture/pdf-and-internal-tools-planning.md`.

PDF-rendererin tai layoutin muutoksissa lue myös
[Approved Invoice PDF Layout Plan](../architecture/approved-invoice-pdf-layout-plan.md).
Se kuvaa commitin `25a0004` auditointibaselinen ennen käyttäytymisen
säilyttävää rakenteellista jakoa, ei uutta hyväksyntää layoutin tai
snapshot-sopimuksen muuttamiseen.

Hyväksytyn laskun toimitusputki, tulostuksen MVP-rajaus,
sähköpostitoimituksen turvallisuuslinja, `sent`-tila, laskun kopiointi,
peruutus ja hyvityslaskut on kuvattu dokumentissa
`docs/architecture/invoice-delivery-plan.md`.

Laskun peruutuksen, koko- ja osahyvityksen, hyvityksen kumulatiivisen
senttilaskennan sekä hyvityslaskun hyväksynnän tarkka toteutusmalli on kuvattu
dokumentissa
`docs/architecture/invoice-cancellation-and-credit-note-plan.md`.

Laskun toimitustapahtumien, lähetyslokin, delivery event -mallin ja
send-polun auditointiperiaatteet on kuvattu dokumentissa
`docs/architecture/invoice-delivery-events-plan.md`.

Toimitetun lasku-PDF:n valinnainen local desktop -arkistokopio on kuvattu
dokumentissa `docs/architecture/local-invoice-pdf-archive-plan.md`.
Invoicing jonottaa täsmälliseen delivery eventiin ja sen omaan
PDF-dokumenttiin sidotun tehtävän vasta durableen `succeeded`-tilaan
viimeistellyn SMTP-, manual- tai print-toimituksen jälkeen. Moduuli ei tunne
paikallista kansiota, tiedostonimeä, Electronia tai retry-journalia.
Arkistointivirhe ei muuta toimituksen tulosta eikä laskun `sent`-tilaa.
Jos tehtävän queue-vaihe epäonnistuu, Invoicing yrittää kirjata vain
minimoidun `invoicePdfArchive.queueFailed`-operational-eventin. Siinä ei ole
company-, invoice-, delivery event- tai document-tunnisteita, laskunumeroa,
polkua tai muuta business dataa. Myös eventin kirjoitusvirhe eristetään
onnistuneesta toimituksesta, ja seuraavat toimitukset voivat edelleen jonottaa
omat tehtävänsä.

Sähköpostilähetyksen provider-malli, dry-run-vaihe, SMTP/Gmail-linja ja
salaisuuksien hallinta on kuvattu dokumentissa
`docs/architecture/email-delivery-and-secrets-plan.md`.

Nykyinen hallittu DNA SMTP -testipolku käyttää prepare- ja send-vaiheita,
kertakäyttöistä sidottua valtuutusta, Electron main processin vahvistusta,
pakotettua testivastaanottajaa ja delivery event -auditointia. Testipolku ei
muuta laskua `sent`-tilaan.

Asiakaslähetys käyttää erillistä prepare/send-polkuansa. Molemmat
SMTP-moodit käyttävät samaa tarkistettua täsmädokumenttia ja revision sisältävää
kertavaltuutusta. Delivery event varataan atomisesti ennen SMTP-kutsua ja
loppukuittaus käyttää juuri palautettua varausta. Vain varmasti onnistunut SMTP-toimitus viimeistelee
eventin ja `approved` -> `sent` -tilasiirtymän samassa transaktiossa.
Epäonnistunut tai epäselvä toimitus jättää laskun tilan ennalleen.
Uudelleenlähetys luo uuden eventin mutta ei muuta `sent`-laskun identiteettiä
tai tilaa. Onnistuneen loppukuittauksen jälkeinen laskun lukuhäiriö ei muuta
toimituksen onnistumista; erillinen turvallinen virhekoodi erottaa tämän
tilanteen varsinaisesta lähetysvirheestä. UI tunnistaa tämän
täsmällisen virhekoodin ja ohjaa avaamaan laskun uudelleen sekä tarkistamaan
historian ilman uutta lähetystä. Se ei muuta laskun tilaa paikallisella
arvauksella eikä julkaise raakavirhettä. Uuden muutoksen hyväksyntäportit
säilyvät. Selainkehityksessä käytetään vain dry-run-polkuja ilman
SMTP-salaisuutta tai DNA-verkkoyhteyttä.

ALV-erikoiskäsittelyjen, ALV-kantojen tuotantopolun, viivästyskoron ja
lähetettyjen laskujen korjausperiaatteiden muistilista on kuvattu dokumentissa
`docs/architecture/invoicing-tax-and-correction-roadmap.md`.

## Moduuli omistaa

- laskuluonnokset
- laskut
- laskurivit
- laskun tilat
- laskunumeroinnin
- laskun hyväksymisen julkaisukelpoisuusrajan
- hyväksytyn laskun viitenumeron
- ALV-käsittelyn
- maksuehdot
- laskutuksen hintojen veroton/verollinen syöttötavan
- laskutuksen alennussäännöt
- laskutuksen numerointisarjat
- yrityskohtaisen tilikauden laskutuskäyttöön
- laskulla käytetyt hinta- ja osapuolitietojen snapshotit
- laskutuksen audit-tapahtumat
- laskun toimitustapahtumat ja delivery event -kirjaukset
- laskun peruutus ja hyvityslaskut
- laskun sähköpostitoimituksen liiketoimintasäännöt

## Moduuli ei omista

- asiakkaan perustietoja
- asiakaskohtaisia tuntihintaohituksia
- oman yrityksen oletustuntihintaa
- oman yrityksen pankkitilien master dataa
- kohteen perustietoja
- tuntikirjausten alkuperäistä dataa
- materiaalikirjausten alkuperäistä dataa
- varastosaldoja
- SMTP-salasanoja, OAuth-tokeneita tai teknisten email-providerien salaisuuksia
- yleistä backend email infrastructure -toteutusta
- käyttäjän paikallista PDF-arkistokansiota, arkiston tiedostoja tai
  desktopin retry-journalia

## Tärkeitä käsitteitä

- InvoiceDraft
- Invoice
- InvoiceLine
- InvoiceStatus
- InvoicePaymentState
- InvoicePaymentSource
- Vat
- PaymentTerm
- CreditInvoice

## Laskun julkaisukelpoisuus ennen hyväksyntää

Invoicing omistaa laskun hyväksymistä ja uudelleenhyväksymistä edeltävän
julkaisukelpoisuussäännön. Company Settings ja Customers saavat säilyttää
keskeneräisiä master-tietoja, mutta virallista laskua ei muodosteta ennen
kuin snapshotiin on saatavilla vähintään:

- myyjän nimi, Y-tunnus, ALV-tunnus, katuosoite, postinumero ja kaupunki
- myyjän IBAN-maksutili
- asiakkaan nimi, katuosoite, postinumero ja kaupunki
- laskun vastaanottajan nimi, katuosoite, postinumero ja kaupunki

Sääntö tarkistetaan backendissä sekä ensimmäisessä hyväksynnässä että
uudelleenhyväksynnässä ennen laskunumeron varaamista tai mitään kirjoitusta.
Puuttuva tieto torjuu hyväksynnän turvallisella yleisvirheellä. Se ei kuluta
laskunumeroa, muuta luonnosta, luo laskua tai laskurivejä eikä kirjoita
audit-tapahtumaa. Vanhojen hyväksyttyjen laskujen snapshotit eivät muutu,
vaikka master-data myöhemmin täydentyy tai muuttuu.

Web voi ennen käyttäjän hyväksyntävahvistusta pyytää standardiluonnoksen
julkaisukelpoisuuden read-only-projektion reitiltä
`GET /invoice-drafts/:id/issuance-readiness`. Reitti on yritysrajattu ja
palauttaa vain `isReady`-arvon sekä Invoicingin tuntemat puutekoodit. Tarkistus
kattaa julkaisukelpoisen snapshot-datan lisäksi aktiivisten
laskunumerointiasetusten olemassaolon. Se ei palauta Company Settings- tai
Customer-master-dataa, varaa laskunumeroa, muuta luonnosta tai kirjoita
audit-tapahtumaa. UI muuntaa puutekoodit turvallisiksi suomenkielisiksi
korjausohjeiksi ja ohjaa puuttuvan numeroinnin Oma yritys -näkymään.

Read-only-tarkistus on vain käyttäjän ennakko-ohjaus. Se ei ole
hyväksyntävaltuutus eikä korvaa hyväksyntä- tai uudelleenhyväksyntätransaktion
sisällä tehtävää samaan domain-sääntöön perustuvaa tarkistusta. Master-data
voi muuttua lukupyynnön jälkeen, joten varsinainen hyväksyntä tarkistaa
julkaisukelpoisuuden aina uudelleen ennen ensimmäistä kirjoitusta.

## Laskun tilat

Nykyisen laskun elinkaaren tilat:

- draft
- approved
- sent
- cancelled

Hyvitystila `none | partial | full` johdetaan alkuperäislaskun ja sen
ei-peruttujen hyvityslaskujen snapshot-summista. Sitä ei mallinneta
toimitustilan kanssa kilpailevaksi `credited`-statukseksi.

Maksutila `unpaid | paid` on elinkaari- ja toimitustilasta erillinen
Invoicingin omistama projektio. Hyvityslaskun julkinen read model käyttää
arvoa `notApplicable`. Maksutila ei muuta `sent`-tilaa, hyväksytyn laskun
snapshot-summia tai hyvitystilaa. Manuaalisen maksuseurannan pysyvät säännöt
on kuvattu dokumentissa
`docs/architecture/invoice-payment-tracking-plan.md`.

Tilasiirtymät määritellään domain-säännöillä.

Käyttäjä voi tallentaa laskun luonnoksena ja jatkaa myöhemmin tai hyväksyä valmiin laskun tietoisella hyväksyntätoiminnolla. Hyväksyntä ei saa tapahtua autosavessa, tavallisessa tallennuksessa, luonnoksen avaamisessa tai esikatselussa.

Hyväksyntä ei saa ohittaa backend-validointia, numerointia, snapshotin muodostusta, käyttöoikeuksia, transaktiota tai auditointia.

Virallinen laskunumero annetaan vasta hyväksynnässä. Luonnoksella on tekninen tunniste, mutta ei virallista laskunumeroa.

## Perinteinen laskutus

Ensimmäinen MVP voi sisältää perinteisen laskunkirjoituksen:

1. valitaan asiakas
2. valitaan kohde tarvittaessa
3. lisätään laskurivit
4. lasketaan summat ja ALV
5. tallennetaan laskuluonnos tai hyväksytään lasku heti
6. luonnos voidaan avata, muokata ja hyväksyä myöhemmin

`draft`-tilainen laskuluonnos voidaan poistaa pysyvästi vahvistuksen jälkeen.
Poisto tehdään aina Invoicing-application servicen ja yritysrajatun
repository-portin kautta. Hyväksyttyä tai numeroitua laskua ei poisteta, vaan
se perutaan tai hyvitetään myöhemmin hallitulla tilasiirtymällä.

Kohde on valinnainen. Work Orders -moduulia ei tarvita tämän polun käyttämiseen.

### Laskuluonnoksen Automaattitallennus

Auto- ja käsintallennus käyttävät yhtä muokkaussession kirjoitusomistajaa.
Ensimmäisen tallennuksen tunniste säilyy myös uudemman syötteen rinnalla;
vain lähetetty revisio vahvistetaan tallennetuksi. Epäselvä create-tulos
estää uuden luontiyrityksen samassa lomakkeessa ja ohjaa tarkistamaan tuoreen
luonnoslistan. Backendin validointi ja hyväksyntä pysyvät auktoriteettina.
Rajaus ja regressiot ovat [A2:n omistavassa sopimuksessa](../architecture/invoicing-ui-roadmap.md#a2-tallennusvastuun-valmistelu).

Web-UI voi tukea laskuluonnoksen automaattitallennusta käyttökokemuksen
parantamiseksi.

Autosave ei ole laskutuksen domain-sääntö eikä se korvaa manuaalista
tallennusta.

Uuden laskun kohdalla autosave saa luoda ensimmäisen laskuluonnoksen vasta,
kun pakolliset kentät ja vähintään yksi laskurivi ovat kelvollisia saman
validointimallin mukaan kuin käsin tallennuksessa. Tällöin UI käyttää
normaalia `createInvoiceDraft`-polkua eikä lähetä palvelimen omistamia kenttiä.

Kun ensimmäinen luonnos on tallennettu käsin tai automaattisesti, UI siirtyy
muokkaustilaan ja jatkotallennukset käyttävät vain luonnoksen päivityspolkua.
Autosave ei saa ohittaa backendin validointia, yritysrajausta,
käyttöoikeustarkistuksia tai myöhemmin lisättäviä audit-sääntöjä.

## ERP-laskutus myöhemmin

Myöhemmin lasku voi muodostua hyväksytyistä:

- tuntikirjauksista
- materiaalikirjauksista
- työmääräyksistä
- tarjouksista

Nämä eivät saa siirtyä lopulliseen laskuun ilman hallittua prosessia.

Työmääräyksestä tai kirjauksista muodostuva aineisto on laskuehdotus tai laskuluonnoksen lähtötieto. Toimisto tarkistaa aineiston ennen lopullista laskutusta.

## Laskun Lähde Suunnittelutasolla

Laskulla voi myöhemmin olla:

- pakollinen `customerId`
- valinnainen `siteId`
- `sourceType`, kuten `manual` tai `workOrder`
- valinnainen `sourceId`

Manuaalisessa laskussa `sourceType` voi olla `manual` ja `sourceId` tyhjä.

Työmääräyksestä muodostetussa laskuehdotuksessa `sourceType` voi olla `workOrder` ja `sourceId` työmääräyksen tunniste.

Tarkka tietomalli päätetään erillisessä toteutussuunnitelmassa.

## Hyväksyntä, Numerointi Ja Snapshotit

Hyväksyntä muuttaa laskuluonnoksen hyväksytyksi laskuksi hallitulla backendin tilasiirtymällä.

Hyväksynnässä Invoicing:

- validoi luonnoksen
- varaa laskunumeron
- muodostaa viitenumeron hyväksytylle laskulle
- luo laskun ja laskurivien snapshotit
- kirjaa audit-tapahtuman
- linkittää luonnoksen syntyneeseen hyväksyttyyn laskuun

Nämä tehdään samassa transaktiossa. Osittaista hyväksyntää ei saa jäädä.

Ensimmäisessä persistence-toteutuksessa hyväksytty lasku tallennetaan erilliseen
`invoices`-tauluun ja sen rivit `invoice_lines`-tauluun. Alkuperäinen luonnos
säilyy `invoice_drafts`-taulussa, mutta se lukitaan `approved_invoice_id`- ja
`approved_at`-kentillä. Luonnoksen muokkaus- ja poistopolut eivät saa enää
käsitellä hyväksyntään linkitettyä luonnosta. Hyväksyntään linkitetty draft ei
myöskään kuulu muokattavien draftien lukupolkuun; hyväksytty lasku luetaan
myöhemmin omasta `invoices`-polustaan.

Jos hyväksyttyä mutta vielä lähettämätöntä laskua pitää korjata, Invoicing voi
palauttaa sen hallitusti sisäiseen `reopened_for_edit`-tilaan ja vapauttaa
alkuperäisen lähdeluonnoksen muokattavaksi. Uudelleenhyväksyntä säilyttää saman
laskunumeron ja viitenumeron, päivittää nykytilan snapshot-projektion ja kirjaa
korjauksen audit-tapahtumana. Nykyisessä revisiomallissa vanha muuttumaton
revisio, PDF ja toimitustapahtumat säilyvät; reopen irrottaa vain current-
osoittimen, ja uudelleenhyväksyntä julkaisee uuden revision. Molempien
kirjoitustransaktio tarkistaa ensin saman laskun ratkaisemattomat toimitukset.
Onnistunut uuden mallin itselle tehty SMTP-testi ei estä reopenia.
Vanhalle yhä `approved`-tilan laskulle, jonka legacy-SMTP-historian tarkoitus
on tuntematon, on hyväksytty rajattu selvitysesto. Lasku, PDF ja historia
säilyvät luettavina, mutta reopen, uusi lähetys ja lähetetyksi merkitseminen
estetään; vastaanottaja tai aika ei todista vanhaa testimoodia. Turvallinen
HTTP 409 -koodi on `INVOICE_LEGACY_DELIVERY_REVIEW_REQUIRED`.
Tämä ei muuta uusien revisioiden muokkaussääntöä tai ehjän vanhan `sent`-
laskun hyväksyttyä [legacy-uudelleenlähetyspolitiikkaa](../architecture/email-delivery-and-secrets-plan.md#säilytetyn-pdfn-täsmävaltuutus).
Lähetettyjen laskujen korjaus tehdään
hyvityslaskulla, ei muokkaamalla lähetettyä laskua.

Lähetetty lasku voidaan kopioida uudeksi laskuluonnokseksi. Kopiointi ei peri
vanhan laskun laskunumeroa, viitenumeroa, PDF-dokumenttia tai `sent`-tilaa.
Uusi kopioitu luonnos saa oman laskunumeron ja viitenumeron vasta myöhemmässä
hyväksynnässä.

## Peruutus Ja Hyvityslaskut

Hyväksytty mutta vielä toimittamaton lasku voidaan perua hallitulla
`approved` -> `cancelled` -tilasiirtymällä. Peruutus säilyttää laskunumeron,
snapshotin, rivit ja PDF:n eikä vapauta numeroa uudelleen käytettäväksi.
Peruutuksen syy, aika ja vahvistettu actor tallennetaan laskulle, ja toiminto
kirjaa `invoice.cancelled`-audit-tapahtuman.

Lähetettyä tavallista laskua ei muokata tai peruta. Se korjataan erillisellä
hyvityslaskulla, joka:

- saa hyväksynnässä oman normaalin laskunumeron
- viittaa alkuperäiseen laskuun ja hyvitysriveillä alkuperäisiin riveihin
- tallentaa määrät ja rahasummat positiivisina magnitudeina
- esittää rivit, ALV:n ja summat käyttäjälle negatiivisina
- ei muodosta uutta maksuvaatimusta tai viitenumeroa
- käyttää hyväksynnän jälkeen samaa current PDF- ja toimitusputkea kuin
  tavallinen lasku

Hyvitys voi olla koko laskun hyvitys, lähderiveihin sidottu osahyvitys tai
alkuperäisen laskun jäljellä olevaan summa- ja ALV-kantakapasiteettiin rajattu
vapaa hyvitysrivi. Hyvitysluonnoksessa käyttäjä voi poistaa lähderivejä ja
pienentää niiden hyvitettävää määrää, mutta ei muuttaa lähderivin yksikköä,
hintaa, ALV-kantaa, alennusta, syöttötapaa tai lähdeviitettä. Vapaa hyvitysrivi
käyttää alkuperäisen laskun syöttötapaa ja ALV-kantoja sekä samaa
kokonaislukulaskentaa kuin muut laskurivit. Tavallisen laskun vapaata
negatiivista syötettä ei sallita.

Hyvitysluonnokselle voidaan antaa valinnainen palautus-IBAN. Backend validoi
ja normalisoi sen, ja hyväksyntä tallentaa sen hyvityslaskun snapshotiin.
Palautustili ei muuta Company Settings -masterdataa eikä näy hyvityslaskulla,
jos kenttä jätetään tyhjäksi.

Hyvityksen hyväksyntä laskee aiempien ei-peruttujen hyväksyttyjen ja
lähetettyjen hyvitysten käyttämän kapasiteetin ja jäljellä olevan määrän
transaktion sisällä. Ylihyvitys estetään sekä määrä- että senttitasolla.
Alkuperäisen laskun hyvitystila `none | partial | full` ja jäljellä oleva
hyvitettävä summa ovat snapshot-datasta johdettuja tietoja; ne eivät ole
frontendin tallentamia totuuksia.

Yhdellä alkuperäislaskulla saa olla vain yksi aktiivinen hyvitysluonnos.
Lähetettyjen laskujen listaus sivuttaa tavalliset juurilaskut ja palauttaa
niiden lähetetyt hyvityslaskut samassa palvelinpuolen ryhmässä. Laskun
detail-näkymä näyttää myös hyväksytyt hyvitykset ja mahdollisen aktiivisen
hyvitysluonnoksen. Käyttäjälle näkyvä koko tapahtuma-aikajana on myöhempi
rajattu vaihe, vaikka peruutus- ja hyvitystoiminnot kirjaavat jo audit-eventit.

Tarkat validointi-, transaktio-, PDF- ja ryhmittelysäännöt ovat dokumentissa
`docs/architecture/invoice-cancellation-and-credit-note-plan.md`.

Numerointiasetukset voivat näkyä käyttäjälle Oma yritys / Asetukset -kokonaisuudessa, mutta niiden domain-omistaja on Invoicing.

Tarkat säännöt on kuvattu dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

Web-käyttöliittymä voi näyttää draftin hyväksynnän jälkeen backendin
palauttaman laskunumeron ja viitenumeron, mutta se ei muodosta niitä itse.
Hyväksynnän jälkeen käyttäjää ei pidetä luonnoksen muokkaustilassa.
Hyväksytyn laskun varsinainen katselu-, print- ja lähetysnäkymä toteutetaan
myöhemmissä vaiheissa hyväksytyn laskun omien lukupolkujen päälle.

Hyväksytyn laskun ensimmäinen lukupolku on `GET /invoices/:id`. Se palauttaa
`ApprovedInvoiceView`-lukumallin, joka muodostetaan vain `invoices`- ja
`invoice_lines`-taulujen snapshot-datasta. Lukupolku ei hae laskulla näkyviä
tietoja Customer- tai Company Settings -master-datasta eikä laskuluonnoksesta.

`GET /invoices` palauttaa hyväksyttyjen tai lähetettyjen laskujen rajatun
snapshot-yhteenvetosivun. Backend rajaa haun aina vahvistetulla `companyId`- ja
`status`-yhdistelmällä, validoi päivämäärärajat, sivun, 20/50/100 rivin
sivukoon sekä sallitun järjestyksen. SQL:n arvot parametrisoidaan ja vapaa
`ORDER BY` -syöte estetään enum-kartoituksella. Listaus ei hae laskurivejä,
Customers-master-dataa tai Company Settings -master-dataa eikä aiheuta
N+1-kyselyitä.

Webin ensimmäinen hyväksytyn laskun katselunäkymä käyttää tätä
`ApprovedInvoiceView`-snapshotia. Se on tarkistusnäkymä ennen varsinaista
print-layoutia, PDF:ää ja lähetyspolkuja.

Invoicing omistaa muuttumattoman revision PDF:n, ehdollisen julkaisun ja
varmennetun täsmäluvun. Nykyisen [PDF-sopimuksen](../architecture/invoice-print-data-foundation-plan.md#revision-pdf-julkaisu-ja-täsmäluku)
vaatimukset korvaavat ensimmäisen version poisto-/regenerointimallin.
[Toimitustapahtumien sopimus](../architecture/invoice-delivery-events-plan.md)
omistaa historian projektion; [varaus ja loppukuittaus](../architecture/sqlite-invoice-delivery-event-persistence-plan.md#nykyinen-varaus-ja-loppukuittaus)
SMTP-, manual- ja dry-run-kirjoitusten atomisuuden. [Sähköpostisopimus](../architecture/email-delivery-and-secrets-plan.md#säilytetyn-pdfn-täsmävaltuutus)
omistaa legacy-kopion kelpoisuuden, täsmäesikatselun ja native-vahvistuksen.
Luku ei anna lähetysvaltuutta eikä tekninen dokumenttirevisio tee toista saatavaa.

Nykyinen PDF-polku:

- `POST /invoices/:id/pdf` luo tai palauttaa hyväksytyn laskun PDF-metadatan
- `GET /invoices/:id/pdf` palauttaa paikallisesti tallennetun PDF-tiedoston
- `GET /invoices/:id/pdf/metadata` tarkistaa, että PDF-metadata ja paikallinen tiedosto ovat olemassa
- web näyttää hyväksytyllä laskulla `Luo PDF` -toiminnon vain, jos PDF puuttuu
- web näyttää `Avaa PDF` -toiminnon vain, jos PDF on tarkistettu olemassa olevaksi
- PDF:n luonti ei merkitse laskua lähetetyksi
- PDF:n luonti ei muuta hyväksytyn laskun snapshot-tietoja

Tallennetun dokumentin puuttuva tai rikkinäinen PDF on eheysvirhe:
metadataa ei poisteta eikä PDF:ää regeneroida. Uuden authoritative-revision
ensimmäinen julkaisu on eri toiminto.

Hyväksytyn ja lähetetyn laskun toimitushistoria kuuluu Invoicing-moduulille.
Historia palauttaa yritysrajatusti vain turvallisen yhteenvedon ajasta,
toimitustavasta, providerista, vastaanottajasta, kopiosta, tilasta ja
turvallisesta virheviestistä. Se ei palauta MIME-runkoa, PDF-binääriä,
salaisuuksia tai providerin raakaa vastausta.
Ratkaisematon `attempted`- tai `outcomeUnknown`-tapahtuma estää uuden tavallisen
asiakaslähetyksen valmistelun ja manuaalisen toimituksen viimeistelyn.
Manuaalinen tulostus- tai muu toimitus kirjaa delivery eventin ja
audit-tapahtuman sekä muuttaa laskun `sent`-tilaan samassa transaktiossa vain,
kun epäselvää aiempaa toimitustapahtumaa ei ole.

Reopen irrottaa nykyosoittimen ja esikatselun, mutta kaikki julkaistut
revisiot, dokumentit ja tapahtumat säilyvät. Uudelleenhyväksyntä julkaisee
uuden revision samalla invoice-ID:llä ja numerolla. Ei uutta historian
retention- tai poistopolitiikkaa.

## Viitenumero Ja Maksutiedot

Ensimmäisessä hyväksyntävaiheessa hyväksytylle laskulle muodostetaan suomalainen
kotimainen viitenumero laskunumeron pohjalta. Viitenumero muodostetaan
hyväksyntätransaktiossa backendissä, eikä frontend tai API-client saa muodostaa
sitä lopullisena totuutena.

Viitenumero tallennetaan hyväksytylle laskulle ilman välilyöntejä. Jos
laskunumero ei ole puhtaasti numeerinen, hyväksyntä epäonnistuu hallitusti
eikä laskunumeroa tai viitenumeroa tallenneta osittain.

Oman yrityksen pankkitiedot kuuluvat Company Settings -master dataan, mutta
hyväksytylle laskulle tallennetaan maksutietojen snapshot. PDF, tulostus ja
sähköpostilähetys käyttävät hyväksytyn laskun snapshot-tietoja, eivät sen
hetkisiä muuttuvia yritysasetuksia.

Maksutietojen marssijärjestys:

1. viitenumero hyväksyntätransaktioon
2. Hyväksy laskuksi -UI näyttää laskunumeron ja viitenumeron
3. Oma yritys / Laskutusasetukset näyttää pankki-, viivästyskorko- ja huomautusajan oletukset
4. hyväksyntä snapshottaa laskulla käytetyt pankkitiedot, viivästyskoron ja huomautusajan
5. hyväksytyn laskun katselu ja print-layout
6. PDF
7. sähköpostilähetys

## Snapshot-Periaate

Laskulle tai laskuriville tallennetaan myöhemmin käytetyt hinnat snapshotiksi.

Tämä koskee esimerkiksi:

- käytettyä tuntihintaa
- asiakkaan laskuhetken tietoja
- oman yrityksen laskuhetken tietoja

Vanha lasku ei saa muuttua, vaikka myöhemmin muuttuvat:

- asiakkaan perustiedot
- asiakkaan asiakaskohtainen tuntihinta
- oman yrityksen oletustuntihinta
- oman yrityksen perustiedot
- oman yrityksen pankkitiedot

Customers-moduuli omistaa asiakkaan perustiedot ja mahdollisen asiakaskohtaisen tuntihintaohituksen.

Company Settings -moduuli omistaa oman yrityksen tiedot ja oletustuntihinnan.

Company Settings -moduuli omistaa myöhemmin oman yrityksen pankkitilien master
datan, kuten `iban`, `bic` ja valinnaisen `bankName`-arvon.

Invoicing omistaa laskulla käytetyt snapshot-arvot, mukaan lukien hyväksytylle
laskulle tallennettavat viitenumeron, pankkitietojen, viivästyskoron,
huomautusajan, asiakkaan, laskun vastaanottajan sekä toimitus- tai kohdetiedon
snapshotit.

Hyväksyntäpolku snapshottaa print/PDF-polun tarvitsemat ensimmäisen vaiheen
arvot dokumentin `docs/architecture/invoice-print-data-foundation-plan.md`
mukaisesti. Varsinainen hyväksytyn laskun katselu-, print-, PDF- ja
sähköpostipolku toteutetaan myöhemmissä vaiheissa tämän snapshot-datan päälle.

## Turvallisuus

Laskutus vaatii vahvat käyttöoikeudet.

Backend tarkistaa aina:

- saako käyttäjä nähdä laskun
- saako käyttäjä luoda laskuluonnoksen
- saako käyttäjä hyväksyä laskun
- saako käyttäjä lähettää laskun
- saako käyttäjä perua laskun

Laskutuksen tärkeistä muutoksista kirjataan audit log.

## Rahasummat

Rahasummat käsitellään kokonaislukusentteinä.

Määrä käsitellään sadasosina skaalattuna kokonaislukuna. Esimerkiksi `1,25` tallennetaan arvona `125`.

ALV-kanta ja prosenttialennus käsitellään basis points -mallilla. Esimerkiksi `25,50 %` on `2550` ja `5,00 %` on `500`.

Auktoritatiivinen laskenta ei käytä JavaScriptin liukulukulaskentaa.

Yritysasiakkaan uuden laskun oletushinnat syötetään verottomina ja
yksityisasiakkaan verollisina. Uuden laskun asiakasvalinta asettaa tämän
käyttöliittymäoletuksen, kunnes käyttäjä valitsee syöttötavan itse. Käyttäjän
manuaalista valintaa ei ylikirjoiteta myöhemmällä asiakasvaihdolla. Syöttötapa
tallennetaan laskennalle yksiselitteisenä eikä backend luota pelkkään
UI-oletukseen.

Classic-laskutusnäkymässä käyttäjä muokkaa vain aktiivisen syöttötavan mukaista hintaa. Toinen hinta voidaan näyttää laskettuna esikatseluna, mutta molempia ei muokata samanaikaisesti MVP:ssä.

Company Settingsin `hourlyRateShortcut` voi ehdottaa laskuriville tuntihintaa,
kun käyttäjä kirjoittaa pikavalinnan nimikkeeksi. Ehdotuksessa käytetään ensin
asiakkaan `hourlyRateOverrideCents`-arvoa ja sen puuttuessa oman yrityksen
`defaultHourlyRateCents`-arvoa.

Ehdotus tehdään lomakeriville enintään kerran. Se ei saa ylikirjoittaa käsin
muutettua tai tallennetusta luonnoksesta ladattua yksikköhintaa. Tämä on
web-UI:n käyttömukavuustoiminto, ei Invoicing-domainin piilotettu laskentasääntö.
Backend vastaanottaa ja validoi aina eksplisiittisen `unitPriceCents`-arvon.
Jos käyttäjä vaihtaa asiakkaan ennen hyväksyntää, web päivittää uuden asiakkaan
tuntihintaan vain sellaiset pikavalintarivit, joiden hinta on edelleen ohjelman
automaattisesti ehdottama. Käsin muutettu tai tallennetusta luonnoksesta ladattu
hinta säilyy. Jos uudelle asiakkaalle tai yritykselle ei löydy soveltuvaa hintaa,
vanha automaattinen hinta tyhjennetään ja käyttäjän pitää antaa hinta ennen
tallennusta.
Laskurivin `unit`-arvo voi olla vakiovalinta kuten `h`, `kpl`, `pv`, `km`,
`erä` tai `pak`, tai käyttäjän antama lyhyt oma yksikkö. Oma yksikkö on silti
validoitu rajattu arvo, ei vapaa pitkä kuvausteksti.

Laskutuksen ensimmäinen yrityskohtainen ALV-kantojen asetuskokoelma on
toteutettu Invoicing-moduuliin. Käyttäjä voi ylläpitää kannan arvoa, selitettä,
aktiivisuutta, järjestystä ja yhtä aktiivista oletuskantaa Oma yritys
-näkymästä. Prosentti- ja euromääräiset alennukset ovat rivikohtaisia;
arkkitehtuuri jättää tilaa myöhemmälle laskukohtaiselle alennukselle.

Ensimmäisen domain-koodivaiheen historialliset testikannat ovat:

- 0,00 % eli 0 basis points
- 10,00 % eli 1000 basis points
- 13,50 % eli 1350 basis points
- 25,50 % eli 2550 basis points

Domainia ei kovakoodata sallimaan vain näitä arvoja. Ensimmäinen asetusten
API-polku on `GET/PUT /invoice-vat-rates`, ja `companyId` tulee aina backendin
vahvistamasta `ActorContext`-kontekstista. Asetusten muuttaminen vaikuttaa
uuden laskurivin valintoihin ja oletukseen, ei tallennettujen laskujen
eksplisiittisiin arvoihin eikä hyväksyttyjen laskujen snapshotteihin.

`14,00 %` eli `1400` basis points oli aiempi alennettu verokanta 31.12.2025 saakka. Se voidaan huomioida myöhemmin historiallisena tai legacy-arvona, jos `invoiceDate`- tai suoritusajankohtaan perustuva vanhojen verokantojen tuki tarvitaan.

Nollaverokanta `0,00 %`, arvonlisäveroton toiminta ja käännetty
verovelvollisuus eivät ole sama asia. R0-versiossa uusi `normalVat`-lasku ei
saa käyttää `0 %` verokantaa. Historialliset `0 %` snapshotit säilyvät
luettavina, mutta vanhaa dataa ei muuteta eikä tulkita automaattisesti
käännetyksi verovelvollisuudeksi.

Invoicing omistaa laskutason `InvoiceTaxTreatment`-mallin:

- `normalVat` on oletus ja käyttää nykyistä verokantakohtaista laskentaa
- `reverseChargeConstruction` on rakennusalan käännetty verovelvollisuus

Käännetty verovelvollisuus ei käytä `vatRateBasisPoints: 0`- tai
`2550`-placeholderia. Sen riveillä ALV-kanta on persistencessä `NULL`, myyjän
ALV on nolla, netto ja brutto ovat samat eikä normaalia ALV-erittelyä
muodosteta. Sekalaskuja ei sallita.

Juridinen ostaja on laskun customer. Billing recipient säilyy erillisenä
laskun vastaanottajana eikä voi korvata ostajaa. Yksityisasiakas ja puuttuva
Y-tunnus estävät käännetyn verovelvollisuuden. Ohjelma ei kuitenkaan päättele
soveltuvuutta asiakastyypistä, Y-tunnuksesta, toimialasta tai rivitekstistä,
vaan käyttäjän pitää vahvistaa soveltuvuus hyväksynnässä.

Sama omistajuusraja koskee laskulistauksia:

- `customerId` määrittää juridisen asiakkaan ja asiakkaan omat laskut
- `billingRecipientCustomerId` määrittää erillisen laskun vastaanottajan
- lasku ei siirry vastaanottajan omaksi laskuksi
- Invoicing voi tarjota vastaanottajalle erillisen yritysrajatun read modelin
  hyväksytyistä ja lähetetyistä laskuista
- recipient-read model rajaa pois tapaukset, joissa juridinen asiakas ja
  vastaanottaja ovat sama asiakas
- recipient-read model käyttää laskulle tallennettua vastaanottajatunnistetta
  ja customer-snapshotia eikä päättele suhdetta Customersin nykyisestä
  `managedByCustomerId`-arvosta
- nykyisen asiakassuhteen muuttaminen ei muuta historiallisten laskujen
  vastaanottajanäkymää
- luonnoksia ei näytetä ensimmäisessä recipient-overview-versiossa

`customerId`- ja `billingRecipientCustomerId`-suodattimia ei saa käyttää
samassa listauspyynnössä. Molemmat rajataan aina backendin vahvistaman
`companyId`-kontekstin sisälle.

Recipient-listaus on server-side Invoicing-read model. Sitä ei saa muodostaa
Customers-UI:ssa lataamalla laajempaa laskulistaa ja suodattamalla rivejä
selaimessa. Juridisen asiakkaan ja vastaanottajan erottelu todistetaan
`CUS-RECIPIENT-001`-selaintestillä ja toisen yrityksen vuotamattomuus
`CUS-RECIPIENT-002`-system-testillä.

Laskun suoritusajankohta mallinnetaan laskutason
`InvoicePerformancePeriod`-tyyppinä: sama kuin laskun päivä, yksittäinen
suorituspäivä tai laskutusjakso. Hyväksytty lasku snapshottaa valinnan ja
hyvityslasku perii sen.

Tarkka malli, migraatio, hyvitysrajat, PDF-merkinnät ja testimatriisi on
kuvattu dokumentissa
`docs/architecture/invoice-tax-treatment-completion-plan.md`.

Rivikohtainen laskenta tehdään deterministisesti:

1. määrä ja yksikköhinta muodostavat pyöristetyn lähtösumman
2. rivikohtainen alennus lasketaan ja pyöristetään lähtösummasta
3. net-tilassa rivin veroton summa tallennetaan kokonaislukusentteinä
4. gross-tilassa rivin verollinen summa tallennetaan kokonaislukusentteinä
5. rivikohtaiset ALV-arvot voivat toimia näyttö- ja tarkistustietona, mutta laskun virallinen ALV lasketaan koontina verokannoittain

Kaikki jakolaskut käyttävät samaa domainin sisäistä pyöristystä: lähimpään senttiin ja täsmälleen puolikas ylöspäin.

Laskun loppusummat ja ALV-erittely muodostetaan verokannoittain koontipohjaisesti. Rivikohtaisesti pyöristettyjä ALV-arvoja ei summata laskun viralliseksi ALV-yhteissummaksi, koska pienet rivikohtaiset pyöristykset voivat muuten kertyä vääräksi kokonaissummaksi.

Tavallisen laskurivin määrä, yksikköhinta ja loppusumma eivät saa olla negatiivisia MVP:ssä. Alennus saa pienentää rivin nollaan, mutta ei sen alle.

Nollahintaiset rivit sallitaan selitteille, huomautuksille, lisätiedoille ja veloituksettomille työn kuvauksille. Ne kulkevat normaalin validoinnin ja laskennan kautta.

Hyvityslaskut toteutetaan erillisenä lähdelaskuun sidottuna toimintona, ei
negatiivisina tavallisina laskuriveinä. Laskukohtaiset alennukset ja muut
adjustment-rakenteet ratkaistaan myöhemmin erikseen.

Tarkat kaavat ja laskentajärjestys on määritelty dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

## Laskutusasetukset

Invoicing omistaa laskutuksen liiketoiminta-asetukset:

- ALV-kannat
- maksuehdot
- oletusviivästyskoron
- oletushuomautusajan
- laskunumerosarjat
- seuraavan laskunumeron
- tilikauden

ALV-kantojen hallinta näkyy local-MVP:ssä Oma yritys -näkymässä, mutta
Company Settings ei omista niiden dataa. Invoicing validoi kokoelman,
rajaa sen luotettuun yrityskontekstiin ja tallentaa muutoksen yhtenä
transaktiona. Vanhalla luonnoksella käytössä oleva poistettu tai passivoitu
kanta säilyy muokattavana legacy-valintana, jotta olemassa oleva laskudata ei
muutu asetusten mukana.

Uuden laskun oletusmaksuehto on 14 päivää netto. Maksuehtoa ja eräpäivää voi muuttaa laskulla.

Ensimmäinen maksuehtoasetusten malli sisältää myös käyttäjän syöttämän
oletusviivästyskoron ja oletushuomautusajan:

- `defaultLatePaymentInterestBasisPoints`
- `defaultReminderPeriodDays`

Viivästyskorko tallennetaan basis pointseina:

```text
9,50 % -> 950
10,50 % -> 1050
13,00 % -> 1300
```

Nämä asetukset voivat näkyä käyttäjälle Oma yritys / Laskutusasetukset
-kokonaisuudessa, mutta domain-omistaja on Invoicing. Uusi laskuluonnos voi
myöhemmin ehdottaa näitä arvoja oletuksina. Laskulle tallennetaan lopulta
käyttäjän hyväksymä laskukohtainen arvo, ja hyväksytty lasku snapshottaa
käytetyn viivästyskoron ja huomautusajan. Vanha hyväksytty lasku ei saa muuttua,
vaikka maksuehtoasetuksia muutetaan myöhemmin.

Laskunumerointi ja tilikausi ovat yrityskohtaisia ja asetuksista hallittavia. Tilikausi ei aina ala tammikuussa. Virallinen laskunumero annetaan hyväksynnässä, ja backend vahvistaa lopullisen numeron.

Numeroinnin ensimmäinen persistence-pohja erottaa numerointiasetukset
(`invoice_numbering_settings`) ja sarjan etenemän
(`invoice_number_sequences`). Sarjan etenemä tallentuu `series_key`- ja
`sequence_scope`-rajoilla, mutta virallinen laskunumero varataan vasta
myöhemmässä hyväksyntätransaktiossa.

Ensimmäisessä asetusten API-polussa käytetään vain oletussarjaa `default`.
Jos kyseistä sarjaa on jo käytetty, tavallinen asetustallennus ei saa muuttaa
numerointimallia, tilikauden aloituskuukautta, numeron pituutta tai ensimmäistä
sarjanumeroa. Sama-arvoinen tallennus saa onnistua idempotentisti.
Käytön jälkeinen hallittu numerointimuutos suunnitellaan myöhemmin erillisenä
toimintona.

Numerointisarjojen, tilikausipohjaisen numeroinnin, kalenterivuosipohjaisen numeroinnin, numerointiasetusten muuttamisen ja local/cloud-numeroinnin tarkemmat periaatteet on kuvattu dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

Nykyinen Oma yritys on laajemman Asetukset-kokonaisuuden ensimmäinen osa. Käyttöliittymä voi myöhemmin koota samaan Asetukset-osioon Oma yritys-, laskutus-, ALV-, maksuehto-, numerointi- ja tilikausinäkymät, vaikka niiden data säilyy omistavissa moduuleissa.

## Jatkokehityksen avoimet kysymykset

- tarvitaanko verkkolasku myöhemmin?
- kuka saa hyväksyä laskun?
- mikä on lopullinen permission-malli hyväksynnälle ja hyväksytyn laskun korjaukselle?
- tarvitaanko sähköpostin lisäksi uusia hallittuja toimitusprovidereita?

## R0-Closeout

Laskutuksen nykyinen R0-laajuus sisältää:

- normaali ALV (`normalVat`)
- rakennusalan käännetty ALV (`reverseChargeConstruction`)
- suorituspäivä ja laskutusjakso varsinaisessa laskulomakkeessa
- luonnoksen hyväksyntä, reopen ja reapproval
- virallinen numerointi ja hyväksytyn laskun snapshot
- PDF ja sähköpostitoimitus
- `sent`-, `cancelled`- ja credit note -polut

Suoritusajankohta kuuluu laskun perustietoihin eikä tax treatment
-lisäasetukseen. `sent`, `cancelled` ja hyvityslasku eivät enää ole tulevia
R0-toimintoja.

Manuaalinen `unpaid | paid`-maksutila, append-only-maksuhistoria sekä
Laskutuksen ja asiakaskortin Maksetut-näkymät kuuluvat nyt R0-laajuuteen.
Pankkitapahtumien automaattinen kohdistaminen jää myöhemmäksi.

Myöhempään laajuuteen jäävät:

- osamaksut ja pankkitapahtumien automaattinen kohdistaminen
- verkkolasku
- `vatExempt` ja `outsideVatScope`
- automaattinen perintä
- work order billing

Invoicing omistaa edelleen oman business audit trailinsa sekä
`invoice_delivery_events`-tapahtumat. Käyttäjälle näkyvä activity feed lukee
niistä vain turvallisen, yritys- ja permission-rajatun projektion. Tekninen
JSONL-loki ei korvaa laskutuksen audit trailia.

Observabilityn yhteiset rajat ovat dokumentissa
`docs/architecture/observability-and-audit-plan.md`.

## Backup-artifactien omistajuus

Invoicing omistaa lasku-PDF:ien auktoritatiivisen backup-catalog-portin.
Portti luetteloi kaikki snapshotin `invoice_documents`-rivit riippumatta
siitä, onko lasku hyväksytty, lähetetty, hyvitetty, peruttu tai
uudelleenhyväksytty. Backup-infrastruktuuri ei selaa storagea arvaamalla.

B3-B5:n revisiohistoriassa mukaan kuuluvat myös aikaisempien revisioiden
PDF:t, alkuperäiset legacy-dokumentit ja erikseen säilytetyt legacy-kopiot.
Invoicingin adapteri valitsee legacy- tai revisioskeeman backendin jo
tarkistaman migraatioprefixin perusteella; SQL-virhe ei valitse fallbackia.
Adapteri säilyttää täsmällisen natiivin `SQLITE_NOMEM`-poikkeuksen
omistavalle runtimelle; se ei tulkitse resurssivirhettä sisällön vioittumiseksi.
Tarkistusruntime omistaa turvallisen syykoodin muunnoksen, ei Invoicing.
Muu revisiokatalogin hylkäys säilyy ennallaan. Katso
[palautuksen omistava sopimus](../architecture/local-backup-and-restore-plan.md).
Revisiohaara tarkistaa historian, nykyrevision sekä lähde-, dokumentti- ja
toimitussidokset, myös silloin kun revisiolla ei vielä ole PDF:ää.
Palautus vaatii saman alkuperäisen katalogin ennen ja jälkeen migraation.
Tallennetun revision yksittäisten arvojen säännöt omistaa
`invoiceRevisionStoredValues`; otsikon, rivien ja ALV-koosteen
johdonmukaisuussäännöt omistaa `invoiceRevisionConsistency`.
`invoiceContentRevisionMapping` ja `validateInvoiceContentRevision` käyttävät
niitä tavallisessa lukupolussa. Säännöt tarkistavat tallennetun sisällön,
eivät laske historiaa uudelleen. Luennan on lisäksi todistettava yritys- ja
revisiosidokset, uniikkius ja verokantojen vastaavuus samasta lukukuvasta.
`validateInvoiceHistoryRelationEncoding` tarkistaa vain hyväksytyn
relaatiokenttäjoukon tekstikoodauksen ennen historian relaatiolukuja.
`invoiceHistoryRelationScan` omistaa tämän kiinteän kenttäjoukon,
varmennetun skeeman etenemisavaimet ja rajatut tavuprojektiot. Avaimet
pysyvät SQLiten sisällä; vanhojen rivitunnisteellisten taulujen nullable-ID
ei saa jättää riviä tarkistamatta. Muut tyyppi-, null- ja sisältösäännöt
säilyvät nykyisillä omistajillaan. Lukija ei normalisoi tunnisteita, muuta
vapaata tekstiä eikä aseta uutta tunnisteen tai historian kokorajaa.
`validateInvoiceRevisionIdentifiers` toimii rajatun revisiolukijan
nonblank- ja yksikköarvojen tarkistimena. Sen kiinteä kenttävalinta käyttää
samaa tavukuljetusta, mutta ei laajenna yllä olevaa koodauspolitiikkaa.
Yhteiset säännöt säilyttävät null-erot, JavaScriptin trimmauksen ja yksikön
UTF-16-pituuden. `createInvoiceHistoryTextDecoder` säilyttää tavallisen ajurin
tekstimuunnoksen rajatuissa osissa, myös UTF-16-tallennuksessa, ilman
vapaan tekstin uutta koodausestoa.
`invoiceRevisionScalarScanSql` ja `validateInvoiceRevisionScalars` omistavat
rajatut otsikko-/rivi-/ALV-projektiot. Ne jakavat normaalin mapperin
tyyppi-, provenienssi-, viite- ja summasäännöt eivätkä kokoa revision rivejä
tai verokantoja JavaScript-joukoiksi. ALV-kertymä koskee vain yhtä revisiota;
legacy-summia ei korjata tai lasketa uudelleen. Lukija edellyttää saman
lukukuvan skeema-, relaatiokoodaus- ja tunniste-/yksikkötarkistuksia.
`validateInvoiceRevisionCatalog` kokoaa nämä tarkistukset sekä
`validateInvoiceRevisionRelations`- ja `validateInvoiceRevisionPairs`-tarkistukset
samassa katalogin omistamassa lukutransaktiossa. Korvatut koko historian
taulukot, kartat ja joukot eivät jää rinnakkaiseksi tuotantopoluksi.
Nykyrevision kenttävertailu käyttää `invoiceContentRevisionPersistenceRows`-
kirjoittajan kanssa yhteisiä täsmällisiä kopiointikenttiä ja lähdesääntöä.
`invoiceRevisionPairScanSql` pitää avaimet SQLitessä ja palauttaa vain pienet
lukuosat. Parivertailu säilyttää dekoodatun tekstin, null-arvojen ja numeroiden
erot myös silloin, kun yhtäläisten tekstien tavumäärät eroavat.
Nykyiset rivit yhdistetään kummankin taulun yksilöllisellä järjestysavaimella;
molempien suuntien kattavuus ja kaikki rivikentät tarkistetaan. Järjestyksen
ei tarvitse olla aukoton. Hyvitys voi viitata ei-nykyiseen lähderevisioon,
ja lähderiviviite säilyy valinnaisena. Nykyisen laskun `credited_invoice_id`
vertaillaan dekoodattuna: se ei kuulu uuden koodauseston kenttäjoukkoon.
Sisäisten tarkistimien testit tarvitsevat saman lukukuvan. Varsinaisen katalogin
kutsujat käyttävät `SqliteInvoiceBackupArtifactCatalog`-porttitoteutusta,
eivät sen yksittäistä sisäistä tarkistinta ilman transaktiota.
`invoiceEventDocumentBinding` omistaa toimitustapahtuman dokumenttiviitteen
ja dokumenttisidoksen yhteiset säännöt. Tavallinen `readInvoiceEventDocument`
ja katalogin `invoiceHistoryEventScan` käyttävät niitä molemmat; tapahtuman
luenta ei anna lähetysvaltuutta. Katalogin tapahtumaluenta palauttaa vain
kiinteänkokoiset tarkistushavainnot, ei kokonaisia tapahtumia tai tunnisteita.
Ratkaisemattomien toimitusten päällekkäisyys tarkistetaan saman yrityksen ja
laskun sisällä ilman historian mukana kasvavaa JavaScript-joukkoa.
Tämä luenta edellyttää samaa lukutransaktiota sekä sitä edeltäviä skeeman,
relaatiokoodauksen, revisioiden ja rajatun dokumenttiluettelon tarkistuksia.
Legacy-tapahtuman alkuperäinen puuttuva dokumentti ja aikainen paluu säilyvät.
Lukijan sulku yritetään myös virheessä; sulkuvirhe ei peitä ensimmäistä syytä
eikä yksinään salli onnistumista. Pieni tulosprojektio ei korvaa eristetyn
prosessin natiivimuisti- tai aikarajaa.
K:n historian osissa luenta ja rajattu kokonaisuus on hyväksytty.
Nykyinen sopimus on tässä; hyväksyntähistoria ei vapauta myöhempää muutosta
natiivi-/palautus- ja PR/main-porteista.
K:n tarkistusrajaus käyttää portin omistamia nykyisiä katalogi- ja
tekstirajoja. Adapteri tarkistaa dokumenttimäärän rajatulla SQL-laskennalla
sekä tekstien tavupituudet ja numerokentän tyypin ennen dokumenttirivien
materialisointia tai revisiohistorian tarkistusta. Myös lopullinen
luettelokysely on rajattu. Backup-infrastruktuuri käyttää samoja nimettyjä
rajoja; formaatti, PDF-tavut ja revisio-/toimitussidosten tarkistukset säilyvät.
Hyväksytyt B5 ja K eivät muuta catalog-v1-formaattia tai moduulien omistajuutta.

Puuttuva tietokannan viittaama PDF estää backupin. Tuntematonta orpoa
storage-tiedostoa ei lisätä backupiin eikä poisteta backup-operaation
sivuvaikutuksena. Uusi ei-uudelleenmuodostettava Invoicing-artifact vaatii
catalog-, snapshot-, restore-validator- ja recovery-testipäivityksen ennen
käyttöönottoa.

### Katalogin säilytettävät sisältöehdot

Katalogi valitsee explicit `legacyDocuments` tai `revisionHistory` -skeeman
vain varmennetun applied-migraatioprefixin perusteella. Ei optional/default-
legacyä, sarakkeiden tunnustelua tai SQL-virheestä pääteltyä fallbackia.
Revision-haaran valitsee nimetty sovellettu 039-migraatio, ei pelkkä lukumäärä,
pakettiversio tai manifestin viimeinen tiedosto.
Profiilin edellytyksenä ovat varmennetun prefixin 025-identiteettimigraatio
ja validoitu identiteettirivi; sen edeltävä 018 dokumenttitaulu seuraa
jatkuvasta prefixistä. Tyhjä/liian varhainen historia ei valitse katalogia.
Tämä ei lupaa kaikkien 025-038-julkaisujen backup-tukea. Metadataa vailla oleva
poikkeus on vain restoreCompatible-polun kiinteä 038-ankkuri; rikkinäinen
olemassa oleva metadata ei valitse poikkeusta.

Katalogiskeema ja callerin historiapolitiikka ovat eri asioita.
Aktiivisen business-runtimen nolla-pending-porttia ei siirretä ennen migraatioita
tehtävään historiallisen profiilin eheystarkistukseen. Caller vaatii oman
chain-identiteettinsä; validointi ei avaa business-runtimea.
Snapshot-katalogin rekisteröinti on laiska myös tyhjälle kannalle.
Valinta tehdään maintenance-rajassa tuoreesta varmennetusta historiasta,
samalla ratkaistulla migrationsDirectorylla kuin runner.
Runtime omistaa tämän orkestroinnin, ei Invoicing. Sisäiset migraationimet
eivät laajenna desktopin strict-startup-viestiä tai backup-manifestia.

Kaikilla laskuilla on historia. Sallitut tilat ovat approved, sent,
cancelled ja reopened_for_edit; reopenedilla ei ole currentia, muilla on.
Nykyrevision ja projektiorivien vertailu säilyttää kaikki kentät,
rivitunnisteen, järjestysnumeron, null-erot ja molempien rivijonojen loppumisen.
Hyvityslähteen ei tarvitse olla current: yritys, standard-laji, täsmärevisio,
numero ja päivä tarkistetaan; lähderivin valinnaisuus säilyy.
ALV-ryhmän kanta ja kolme summaa ovat turvallisia ei-negatiivisia kokonaislukuja;
ryhmän net+vat=gross tarkistetaan ennen kokonaissummia. Verokantojen kattavuus
tarkistetaan molempiin suuntiin, ei lasketa historiallista ALV:tä uudelleen.
Käännetyn ALV:n aikainen haara ja legacy-unavailable säilyvät.

Rajatun luennan tavallinen mapper ja katalogi jakavat säännöt.
Pelkkä kokonaisen rivin iterate ei rajaa muistia: etenemisavaimet pysyvät
SQLitessä, myös yhden revision rivit ja ALV-ryhmät käsitellään osissa.
Kolme BigInt-kertymää nollataan revision vaihtuessa. Ei uusia tunniste-,
kuvaus-, yksikköwhitespace- tai historiakokorajoja eikä korvaavia tyhjiä olioita.
Vapaan tekstin UTF-16-muunnos käyttää samaa yhteyttä ja SQLite-tulkintaa;
muunnos valmistellaan ennen kursoria. Pieni projektio ei yksin todista
natiivimuistirajaa. Lukijoiden sulku yritetään virheessäkin; ensivirhe säilyy
erillään eikä aktiiviseksi jäävä kursori salli onnistumista.

Lähteen alkuperäinen katalogi ja kaikki PDF-tavut tarkistetaan ennen
forward-migraatiota; sama alkuperäinen katalogi tarkistetaan sen jälkeen
ennen yhdenkään PDF:n materiaalistamista. Revision eheyden tarkistus koskee
myös PDF:ttömiä revisioita. Väärä source/current/document/event-sidos tai
muuttunut/puuttuva PDF ei muutu legacy-fallbackiksi.
Valinnainen toimitusarkisto lukee metadatan ja tavut **toimitustapahtumasta**,
myös preservedLegacylle, ei nyky-PDF:stä. Arkistovirhe ei peruuta toimitusta,
eikä arkistokansio korvaa auktoritatiivista backupia.
