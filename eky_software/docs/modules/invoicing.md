# Invoicing-moduuli

Tämä dokumentti kuvaa laskutusmoduulin.

Laskutus on kriittinen moduuli. Muutokset laskutukseen vaativat erityistä huolellisuutta.

## Tarkoitus

Invoicing-moduuli hallitsee laskuluonnoksia, laskuja, laskurivejä, laskun tiloja ja laskutuksen sääntöjä.

Laskutus toimii itsenäisesti. Manuaalinen lasku voidaan luoda suoraan asiakkaalle ilman kohdetta, työmääräystä, tuntikirjausta tai mobiilityönkulkua.

Laskutuksen ja valinnaisen työnohjauspolun rajat on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

Ensimmäisen manuaalisen laskuluonnos-MVP:n rajaus, classic-käyttöliittymä ja toteutusvaiheet on kuvattu dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

Laskun hyväksynnän, virallisen laskunumeron, numerointisarjojen, snapshotin ja auditoinnin periaatteet on kuvattu dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

Hyväksytyn laskun katselu-, print- ja PDF-polun tarvitsemat data- ja snapshot-valmiudet on kuvattu dokumentissa `docs/architecture/invoice-print-data-foundation-plan.md`.

PDF-polun ensimmäinen teknologiakokeilu ja sisäisten PDF-apujen rajaus on
kuvattu dokumentissa `docs/architecture/pdf-and-internal-tools-planning.md`.

Hyväksytyn laskun toimitusputki, tulostuksen MVP-rajaus,
sähköpostitoimituksen turvallisuuslinja, `sent`-tila, laskun kopiointi,
peruutus ja hyvityslaskut on kuvattu dokumentissa
`docs/architecture/invoice-delivery-plan.md`.

ALV-erikoiskäsittelyjen, ALV-kantojen tuotantopolun, viivästyskoron ja
lähetettyjen laskujen korjausperiaatteiden muistilista on kuvattu dokumentissa
`docs/architecture/invoicing-tax-and-correction-roadmap.md`.

## Moduuli omistaa

- laskuluonnokset
- laskut
- laskurivit
- laskun tilat
- laskunumeroinnin
- hyväksytyn laskun viitenumeron
- ALV-käsittelyn
- maksuehdot
- laskutuksen hintojen veroton/verollinen syöttötavan
- laskutuksen alennussäännöt
- laskutuksen numerointisarjat
- yrityskohtaisen tilikauden laskutuskäyttöön
- laskulla käytetyt hinta- ja osapuolitietojen snapshotit
- laskutuksen audit-tapahtumat
- hyvityslaskut myöhemmin

## Moduuli ei omista

- asiakkaan perustietoja
- asiakaskohtaisia tuntihintaohituksia
- oman yrityksen oletustuntihintaa
- oman yrityksen pankkitilien master dataa
- kohteen perustietoja
- tuntikirjausten alkuperäistä dataa
- materiaalikirjausten alkuperäistä dataa
- varastosaldoja

## Tärkeitä käsitteitä

- InvoiceDraft
- Invoice
- InvoiceLine
- InvoiceStatus
- Vat
- PaymentTerm
- CreditInvoice

## Laskun tilat

MVP:n vähimmäistilat:

- draft
- approved
- sent

Myöhemmät tilat:

- paid
- cancelled
- credited

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
laskunumeron ja viitenumeron, korvaa hyväksytyn laskun snapshotit ja kirjaa
korjauksen audit-tapahtumana. Lähetettyjen laskujen korjaus tehdään myöhemmin
hyvityslaskulla, ei muokkaamalla lähetettyä laskua.

Lähetetty lasku voidaan kopioida uudeksi laskuluonnokseksi. Kopiointi ei peri
vanhan laskun laskunumeroa, viitenumeroa, PDF-dokumenttia tai `sent`-tilaa.
Uusi kopioitu luonnos saa oman laskunumeron ja viitenumeron vasta myöhemmässä
hyväksynnässä.

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

Webin ensimmäinen hyväksytyn laskun katselunäkymä käyttää tätä
`ApprovedInvoiceView`-snapshotia. Se on tarkistusnäkymä ennen varsinaista
print-layoutia, PDF:ää ja lähetyspolkuja.

PDF muodostetaan `ApprovedInvoiceView`-snapshotista Invoicing-moduulin
infrastructure-kerroksessa. Ensimmäinen local-MVP:n tuotantopolku tallentaa
hyväksytyn laskun PDF-metadatan `invoice_documents`-tauluun ja PDF-tiedoston
paikalliseen tiedostovarastoon.

Ensimmäinen PDF-polku:

- `POST /invoices/:id/pdf` luo tai palauttaa hyväksytyn laskun PDF-metadatan
- `GET /invoices/:id/pdf` palauttaa paikallisesti tallennetun PDF-tiedoston
- `GET /invoices/:id/pdf/metadata` tarkistaa, että PDF-metadata ja paikallinen tiedosto ovat olemassa
- web näyttää hyväksytyllä laskulla `Luo PDF` -toiminnon vain, jos PDF puuttuu
- web näyttää `Avaa PDF` -toiminnon vain, jos PDF on tarkistettu olemassa olevaksi
- PDF:n luonti ei merkitse laskua lähetetyksi
- PDF:n luonti ei muuta hyväksytyn laskun snapshot-tietoja

Jos PDF-metadata on olemassa mutta paikallinen tiedosto puuttuu, manuaalinen
`POST /invoices/:id/pdf` saa muodostaa PDF:n uudelleen samasta hyväksytyn laskun
snapshotista. Tämä on local-MVP:n korjauspolku ennen myöhempää pilvi- ja
storage-mallia.

Hyväksytyllä laskulla saa olla local-MVP:ssä yksi voimassa oleva
`approved_invoice_pdf`-dokumentti per yritys ja lasku. Jos hyväksytty mutta
lähettämätön lasku palautetaan muokattavaksi, vanhan PDF:n metadata poistetaan
ja paikallinen tiedosto yritetään poistaa. Uudelleenhyväksyntä luo uuden PDF:n
samalle laskunumerolle ja viitenumerolle päivitetystä hyväksytyn laskun
snapshotista.

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

Yritysasiakkaan uuden laskun oletushinnat syötetään verottomina ja yksityisasiakkaan verollisina. Syöttötapa tallennetaan laskennalle yksiselitteisenä eikä backend luota pelkkään UI-oletukseen.

Classic-laskutusnäkymässä käyttäjä muokkaa vain aktiivisen syöttötavan mukaista hintaa. Toinen hinta voidaan näyttää laskettuna esikatseluna, mutta molempia ei muokata samanaikaisesti MVP:ssä.

Company Settingsin `hourlyRateShortcut` voi ehdottaa laskuriville tuntihintaa,
kun käyttäjä kirjoittaa pikavalinnan nimikkeeksi. Ehdotuksessa käytetään ensin
asiakkaan `hourlyRateOverrideCents`-arvoa ja sen puuttuessa oman yrityksen
`defaultHourlyRateCents`-arvoa.

Ehdotus tehdään lomakeriville enintään kerran. Se ei saa ylikirjoittaa käsin
muutettua tai tallennetusta luonnoksesta ladattua yksikköhintaa. Tämä on
web-UI:n käyttömukavuustoiminto, ei Invoicing-domainin piilotettu laskentasääntö.
Backend vastaanottaa ja validoi aina eksplisiittisen `unitPriceCents`-arvon.
Laskurivin `unit`-arvo voi olla vakiovalinta kuten `h`, `kpl`, `pv`, `km`,
`erä` tai `pak`, tai käyttäjän antama lyhyt oma yksikkö. Oma yksikkö on silti
validoitu rajattu arvo, ei vapaa pitkä kuvausteksti.

Laskutuksen pitää myöhemmin tukea hallittavia ALV-kantoja sekä prosentti- ja euromääräisiä alennuksia. Ensimmäinen suositeltu alennusmalli on rivikohtainen alennus, mutta arkkitehtuuri jättää tilaa myöhemmälle laskukohtaiselle alennukselle.

Ensimmäisen domain-koodivaiheen testattavat ALV-kannat ovat:

- 0,00 % eli 0 basis points
- 10,00 % eli 1000 basis points
- 13,50 % eli 1350 basis points
- 25,50 % eli 2550 basis points

Domainia ei kovakoodata sallimaan vain näitä arvoja, koska ALV-kantoja hallitaan myöhemmin laskutusasetuksista.

`14,00 %` eli `1400` basis points oli aiempi alennettu verokanta 31.12.2025 saakka. Se voidaan huomioida myöhemmin historiallisena tai legacy-arvona, jos `invoiceDate`- tai suoritusajankohtaan perustuva vanhojen verokantojen tuki tarvitaan.

Nollaverokanta `0,00 %` ja arvonlisäveroton toiminta eivät ole sama asia. Niiden tarkempi käyttötapa, verokohtelu ja laskulla tarvittava selite ratkaistaan myöhemmin laskutusasetuksissa tai laskurivimallissa.

Käännetty verovelvollisuus on oma laskutus- ja ALV-käsittelynsä. Sitä ei saa
päätellä vain arvosta `vatRateBasisPoints: 0`. Jos Ekyyn lisätään esimerkiksi
rakennusalan käännetty verovelvollisuus, Invoicing tarvitsee myöhemmin
hallittavan `vatTreatment`-tyyppisen mallin ja hyväksytylle laskulle
snapshotattavan laskumerkinnän.

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

Hyvityslaskut, laskukohtaiset alennukset ja muut adjustment-rakenteet toteutetaan myöhemmin erillisinä toimintoina, ei negatiivisina tavallisina laskuriveinä.

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

## Avoimet kysymykset

- tarvitaanko PDF ensimmäisessä versiossa?
- tarvitaanko sähköpostilähetys?
- tarvitaanko verkkolasku myöhemmin?
- kuka saa hyväksyä laskun?
- miten hyvityslasku tehdään?
- mikä on lopullinen permission-malli hyväksynnälle ja hyväksytyn laskun korjaukselle?
