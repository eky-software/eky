# Invoicing-moduuli

Tämä dokumentti kuvaa laskutusmoduulin.

Laskutus on kriittinen moduuli. Muutokset laskutukseen vaativat erityistä huolellisuutta.

## Tarkoitus

Invoicing-moduuli hallitsee laskuluonnoksia, laskuja, laskurivejä, laskun tiloja ja laskutuksen sääntöjä.

Laskutus toimii itsenäisesti. Manuaalinen lasku voidaan luoda suoraan asiakkaalle ilman kohdetta, työmääräystä, tuntikirjausta tai mobiilityönkulkua.

Laskutuksen ja valinnaisen työnohjauspolun rajat on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

Ensimmäisen manuaalisen laskuluonnos-MVP:n rajaus, classic-käyttöliittymä ja toteutusvaiheet on kuvattu dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

## Moduuli omistaa

- laskuluonnokset
- laskut
- laskurivit
- laskun tilat
- laskunumeroinnin
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

Myöhemmät tilat:

- sent
- paid
- cancelled

Tilasiirtymät määritellään domain-säännöillä.

Käyttäjä voi tallentaa laskun luonnoksena ja jatkaa myöhemmin tai hyväksyä valmiin laskun heti. Hyväksyntä ei saa ohittaa backend-validointia, numerointia, snapshotin muodostusta, käyttöoikeuksia tai auditointia.

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

Customers-moduuli omistaa asiakkaan perustiedot ja mahdollisen asiakaskohtaisen tuntihintaohituksen.

Company Settings -moduuli omistaa oman yrityksen tiedot ja oletustuntihinnan.

Invoicing omistaa laskulla käytetyt snapshot-arvot.

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

Laskutuksen pitää myöhemmin tukea hallittavia ALV-kantoja sekä prosentti- ja euromääräisiä alennuksia. Ensimmäinen suositeltu alennusmalli on rivikohtainen alennus, mutta arkkitehtuuri jättää tilaa myöhemmälle laskukohtaiselle alennukselle.

Ensimmäisen domain-koodivaiheen testattavat ALV-kannat ovat:

- 0,00 % eli 0 basis points
- 10,00 % eli 1000 basis points
- 13,50 % eli 1350 basis points
- 25,50 % eli 2550 basis points

Domainia ei kovakoodata sallimaan vain näitä arvoja, koska ALV-kantoja hallitaan myöhemmin laskutusasetuksista.

`14,00 %` eli `1400` basis points oli aiempi alennettu verokanta 31.12.2025 saakka. Se voidaan huomioida myöhemmin historiallisena tai legacy-arvona, jos `invoiceDate`- tai suoritusajankohtaan perustuva vanhojen verokantojen tuki tarvitaan.

Nollaverokanta `0,00 %` ja arvonlisäveroton toiminta eivät ole sama asia. Niiden tarkempi käyttötapa, verokohtelu ja laskulla tarvittava selite ratkaistaan myöhemmin laskutusasetuksissa tai laskurivimallissa.

Rivikohtainen laskenta tehdään deterministisesti:

1. määrä ja yksikköhinta muodostavat pyöristetyn lähtösumman
2. rivikohtainen alennus lasketaan ja pyöristetään lähtösummasta
3. net-tilassa ALV lasketaan alennetusta verottomasta summasta
4. gross-tilassa veroton osuus erotetaan alennetusta verollisesta summasta
5. kaikki rivin lopulliset summat tallennetaan kokonaislukusentteinä

Kaikki jakolaskut käyttävät samaa domainin sisäistä pyöristystä: lähimpään senttiin ja täsmälleen puolikas ylöspäin.

Laskun loppusummat ja ALV-erittely muodostetaan samoista valmiiksi pyöristetyistä riveistä. Summia ei lasketa laskutasolla uudelleen eri kaavalla.

Tavallisen laskurivin määrä, yksikköhinta ja loppusumma eivät saa olla negatiivisia MVP:ssä. Alennus saa pienentää rivin nollaan, mutta ei sen alle.

Nollahintaiset rivit sallitaan selitteille, huomautuksille, lisätiedoille ja veloituksettomille työn kuvauksille. Ne kulkevat normaalin validoinnin ja laskennan kautta.

Hyvityslaskut, laskukohtaiset alennukset ja muut adjustment-rakenteet toteutetaan myöhemmin erillisinä toimintoina, ei negatiivisina tavallisina laskuriveinä.

Tarkat kaavat ja laskentajärjestys on määritelty dokumentissa `docs/architecture/invoicing-mvp-implementation-plan.md`.

## Laskutusasetukset

Invoicing omistaa laskutuksen liiketoiminta-asetukset:

- ALV-kannat
- maksuehdot
- laskunumerosarjat
- seuraavan laskunumeron
- tilikauden

Uuden laskun oletusmaksuehto on 14 päivää netto. Maksuehtoa ja eräpäivää voi muuttaa laskulla.

Laskunumerointi ja tilikausi ovat yrityskohtaisia ja asetuksista hallittavia. Tilikausi ei aina ala tammikuussa. Laskutusnäkymässä ehdotettua laskunumeroa voidaan muokata hallitusti ennen hyväksyntää tai hyväksymisen yhteydessä, mutta backend vahvistaa lopullisen numeron.

Nykyinen Oma yritys on laajemman Asetukset-kokonaisuuden ensimmäinen osa. Käyttöliittymä voi myöhemmin koota samaan Asetukset-osioon Oma yritys-, laskutus-, ALV-, maksuehto-, numerointi- ja tilikausinäkymät, vaikka niiden data säilyy omistavissa moduuleissa.

## Avoimet kysymykset

- miten numerointi sovitetaan offline- ja cloud-käyttöön?
- tarvitaanko PDF ensimmäisessä versiossa?
- tarvitaanko sähköpostilähetys?
- tarvitaanko verkkolasku myöhemmin?
- kuka saa hyväksyä laskun?
- miten hyvityslasku tehdään?
- voiko hyväksyttyä laskua muuttaa?
