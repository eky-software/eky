# Company Settings -moduuli

Tämä dokumentti kuvaa ohjelmaa käyttävän yrityksen omien tietojen ja oletusasetusten moduulin.

Käyttäjälle näkyvä nimi voi olla esimerkiksi **Oma yritys**.

## Tarkoitus

Company Settings -moduuli sisältää ohjelmaa käyttävän yrityksen perustiedot ja oletusasetukset.

Se ei ole asiakas.

Se kuvaa yritystä, joka käyttää Ekyä ja joka myöhemmin muodostaa esimerkiksi laskun lähettäjän tiedot.

Ensimmäisessä vaiheessa moduulin tärkein tavoite on erottaa:

- ohjelmaa käyttävän yrityksen omat tiedot
- asiakkaiden tiedot
- laskutuksen myöhemmät snapshot-tiedot

## Moduuli Omistaa

Company Settings omistaa:

- oman yrityksen perustiedot
- oman yrityksen Y-tunnuksen
- oman yrityksen yhteystiedot
- oman yrityksen pääosoitteen
- oman yrityksen pankkitietojen master datan
- oletustuntihinnan
- tuntityön pikavalinnan
- oman yrityksen yleiset oletukset, jotka eivät kuulu toisen moduulin liiketoimintasäännöiksi

Laajempi käyttäjälle näkyvä Asetukset-osio voi sisältää usean moduulin näkymiä.

Invoicing omistaa omat liiketoimintakriittiset asetuksensa, kuten ALV-kannat,
maksuehdot, viivästyskoron, huomautusajan, numerointisarjat ja tilikauden.
Niitä ei siirretä Company Settingsin omistukseen vain siksi, että käyttöliittymä
näyttää asetukset samassa kokonaisuudessa.

## Moduuli Ei Omista

Company Settings ei omista:

- asiakkaita
- asiakaskohtaisia tuntihintaohituksia
- kohteita
- työmääräyksiä
- tuntikirjauksia
- materiaalikirjauksia
- laskuja
- laskurivejä
- laskulla käytettyjen tietojen snapshotteja
- maksutapahtumia

Customers-moduuli omistaa asiakaskohtaiset poikkeukset, kuten `hourlyRateOverrideCents`.

Invoicing-moduuli omistaa laskut, laskurivit ja laskulla käytetyt snapshot-arvot.

Käyttäjälle näkyvä Oma yritys -näkymä voi silti näyttää Invoicing-moduulin
omistamia laskutusasetuksia, kuten laskunumeroinnin, oletusviivästyskoron ja
huomautusajan. Tämä on UI-sijainti, ei moduuliomistajuuden muutos.

## MVP-Kentät

Ensimmäinen Company Settings MVP voi sisältää:

- `id`
- `companyId`
- `companyName`
- `businessId`
- `streetAddress`
- `postalCode`
- `city`
- `email`
- `phone`
- `iban`
- `bic`
- `bankName`
- `defaultHourlyRateCents`
- `hourlyRateShortcut`
- `createdAt`
- `updatedAt`

Kenttien merkitys:

- `id` on asetusrivin tekninen tunniste.
- `companyId` rajaa tiedot nykyiseen yritykseen.
- `companyName` on oman yrityksen nimi.
- `businessId` on oman yrityksen Y-tunnus.
- `vatNumber` voidaan lisätä seuraavassa print/PDF-data foundation -vaiheessa oman yrityksen ALV-tunnukseksi.
- `streetAddress`, `postalCode` ja `city` kuvaavat oman yrityksen pääosoitetta.
- `email` ja `phone` ovat oman yrityksen ensisijaiset yhteystiedot.
- `iban`, `bic` ja `bankName` kuvaavat oman yrityksen maksutilin master dataa.
- `defaultHourlyRateCents` on oman yrityksen oletustuntihinta sentteinä.
- `hourlyRateShortcut` on käyttäjän määrittämä laskurivin nimike, joka voi
  ehdottaa tuntihinnan laskutus-UI:ssa.

## Oletustuntihinta

`defaultHourlyRateCents` on oman yrityksen oletustuntihinta sentteinä.

Ensimmäisessä toteutuksessa tuntihinta tallennetaan kokonaislukuna sentteinä, ei liukulukuna euroina.

Esimerkki:

```text
65,00 €/h -> 6500
```

Sitä käytetään myöhemmin, jos asiakkaalla ei ole asiakaskohtaista tuntihintaa.

Hinnoittelun perussääntö:

```text
jos customer.hourlyRateOverrideCents on asetettu
  -> käytä customer.hourlyRateOverrideCents
muuten
  -> käytä companySettings.defaultHourlyRateCents
```

Oletustuntihintaa voidaan käyttää myöhemmin esimerkiksi:

- työmääräyksissä
- työkirjauksissa
- laskutusluonnoksissa
- laskurivien muodostuksessa

Lopullinen hinnan käyttö päätetään kuitenkin laskutus-, työmääräys- ja työkirjausmoduulien yhteydessä.

## Tuntityön Pikavalinta

`hourlyRateShortcut` on valinnainen, enintään 50 merkin mittainen yhden rivin
teksti, esimerkiksi `työ` tai `laskutus`.

Kun käyttäjä kirjoittaa uuden laskurivin nimikkeeksi täsmälleen tämän arvon,
laskutus-UI saa ehdottaa riville tuntiyksikköä ja voimassa olevaa tuntihintaa.
Vertailu tehdään trimmattuna ja kirjainkoosta riippumatta.
Asiakas pitää valita ennen pikavalinnan kirjoittamista, jotta mahdollinen
asiakaskohtainen tuntihinta voidaan huomioida oikein.

Hintalähde ratkaistaan seuraavassa järjestyksessä:

```text
customer.hourlyRateOverrideCents
  ?? companySettings.defaultHourlyRateCents
```

Automaattitäyttö tapahtuu yhdelle lomakeriville enintään kerran. Jos käyttäjä
on syöttänyt tai muuttanut yksikköhintaa käsin, pikavalinta ei saa ylikirjoittaa
sitä. Tallennetusta luonnoksesta avattua hintaa ei myöskään täytetä uudelleen.

Pikavalinta on käyttökokemuksen oletus, ei laskennan domain-sääntö. Invoicing
tallentaa laskuriville käyttäjän hyväksymän eksplisiittisen yksikköhinnan, ja
backend validoi sekä laskee rivin normaalisti. Tyhjä `hourlyRateShortcut`
poistaa toiminnon käytöstä.

## Asiakaskohtainen Tuntihinta

Asiakaskohtainen tuntihinta ei kuulu Company Settings -moduulin omistamaan dataan.

Customers-moduuli omistaa kentän:

```ts
hourlyRateOverrideCents: number | null
```

Säännöt:

- jos `hourlyRateOverrideCents` on `null`, käytetään `companySettings.defaultHourlyRateCents`-arvoa
- jos `hourlyRateOverrideCents` on annettu, se ohittaa oletustuntihinnan kyseiselle asiakkaalle
- `0` ei tarkoita "ei asetettu"
- `0` tarkoittaa nolla senttiä eli nolla euroa
- puuttuva arvo kuvataan siksi `null`-arvolla

## Snapshot-Periaate

Oletustuntihinta ja asiakaskohtainen tuntihinta voivat muuttua ajan myötä.

Siksi laskulle tai laskuriville tallennetaan myöhemmin käytetty tuntihinta snapshotiksi.

Vanha lasku ei saa muuttua, vaikka:

- `companySettings.defaultHourlyRateCents` muuttuu
- `customer.hourlyRateOverrideCents` muuttuu
- asiakkaan muut tiedot muuttuvat

Invoicing-moduuli omistaa laskulla käytetyn tuntihinnan snapshotin.

Oman yrityksen pankkitiedot ovat Company Settings -master dataa. Hyväksytylle
laskulle tallennetaan myöhemmin maksutietojen snapshot, jotta vanhat laskut
eivät muutu, vaikka Oma yritys -kohdan IBAN, BIC tai pankin nimi muuttuu.
PDF, print-layout ja sähköpostilähetys käyttävät hyväksytyn laskun
snapshot-tietoja, eivät suoraan muuttuvaa Company Settings -dataa.

Oman yrityksen ALV-tunnus kuuluu samaan master-data-ajatteluun. Kun `vatNumber`
lisätään Company Settingsiin, hyväksytty lasku snapshottaa sen arvon
`seller_vat_number`-kenttään eikä hae sitä myöhemmin muuttuvista asetuksista.

## Moduulirajat

Company Settings omistaa:

- oman yrityksen tiedot
- oletustuntihinnan
- oman yrityksen yleiset oletukset
- tuntityön pikavalinnan
- oman yrityksen pankkitietojen master datan

Customers omistaa:

- asiakaskohtaisen tuntihintaohituksen
- asiakas-master-datan

Invoicing omistaa:

- laskut
- laskurivit
- ALV-kannat
- maksuehdot
- viivästyskoron ja huomautusajan laskutusasetukset
- numerointisarjat
- tilikauden
- laskulla käytetyn tuntihinnan snapshotin
- laskulla käytetyt lähettäjä- ja asiakastiedot snapshotteina, jos ne päätetään tallentaa laskulle
- hyväksytylle laskulle tallennettavan maksutietojen snapshotin

Work Orders ja Work Entries omistavat:

- työt
- tunnit
- mahdolliset työkohtaiset kirjaukset
- mahdolliset työkohtaiset hintapäätökset, jos sellainen sääntö myöhemmin päätetään

Toinen moduuli ei saa muuttaa Company Settings -dataa suoraan.

## UI-Ajatus

Sivupalkkiin voidaan myöhemmin lisätä kohta:

```text
Oma yritys
```

Ensimmäinen näkymä voi sisältää:

- oman yrityksen perustiedot
- oman yrityksen yhteystiedot
- oman yrityksen osoitteen
- oman yrityksen pankkitiedot
- oletustuntihinnan
- tuntityön pikavalinnan

Myöhemmin sivupalkissa tai erillisessä Asetukset-kokonaisuudessa voidaan näyttää myös laskutusasetukset. Tällöin Oma yritys ja Laskutusasetukset ovat erilliset näkymät ja säilyttävät omat moduulirajansa.

Laskutusasetuksissa voidaan näyttää esimerkiksi:

- laskunumerointi
- numerointisarjat
- tilikausi
- maksuehdot
- ALV-kannat

Näiden UI-sijainti voi olla käyttäjän kannalta Oma yritys / Asetukset -kokonaisuudessa, mutta niiden domain-omistaja on Invoicing. Oma yritys -näkymä ei saa muodostaa laskunumeroita tai omistaa numerointisarjojen sääntöjä, vaikka se näyttäisi niiden lomakkeen käyttäjälle. Kun laskunumerointia on jo käytetty, Oma yritys -näkymän normaali numerointilomake lukitaan ja käyttäjälle näytetään varoitus, jotta laskunumerohistoriaa ei rikota. Laskunumeroinnin, hyväksynnän, snapshotin ja auditoinnin tarkempi periaate on kuvattu dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

Oma yritys omistaa yrityksen pankkitilien master datan. Ensimmäiset kentät ovat:

- `iban`
- `bic`
- `bankName`

Kentät ovat MVP:ssä valinnaisia. Kun pankkitiedot myöhemmin tarvitaan
hyväksytylle laskulle, Invoicing tallentaa laskulle maksutietojen snapshotin,
kuten `seller_iban`, `seller_bic` ja `seller_bank_name`. PDF, tulostus ja
sähköpostilähetys käyttävät hyväksytyn laskun snapshot-tietoja, eivät sen
hetkisiä muuttuvia Oma yritys -asetuksia.

Asiakaskortissa on Hinnoittelu-osio asiakaskohtaista tuntihintaa varten.

Asiakaskortin tuntihintakentän ohjeteksti voi olla:

```text
Jos kenttä jätetään tyhjäksi, käytetään oman yrityksen oletustuntihintaa.
```

Käyttöliittymä saa ehdottaa tuntihintaa ja auttaa käyttäjää ymmärtämään,
mistä ehdotus tulee. Käyttäjän hyväksymä yksikköhinta välitetään laskurivillä
eksplisiittisesti. Backend validoi syötteen ja laskee laskun auktoritatiiviset summat;
se ei päättele piilossa eri hintaa laskuriville.

## Turvallisuus

Company Settings sisältää yrityksen omaa liiketoimintadataa.

Backend tarkistaa myöhemmin, että vain oikean yrityksen käyttäjä voi nähdä tai muokata näitä tietoja.

Frontend voi piilottaa toimintoja, mutta backend tekee lopullisen käyttöoikeuspäätöksen.

Oman yrityksen tietoja ei saa vuotaa toisen yrityksen käyttäjille.

## Rajataan Myöhemmäksi

Ei lisätä nykyiseen Company Settings MVP:hen ilman erillistä päätöstä:

- useita pankkitilejä
- verkkolaskuasetuksia
- OVT-tunnusta
- verkkolaskuoperaattoria
- useita hinnastoja
- tuoterekisteriä
- työroolikohtaisia hintoja
- työntekijäkohtaisia hintoja
- laskutusta
- dokumenttipohjia

ALV-kannat, maksuehdot, numerointisarjat ja tilikausi suunnitellaan myöhemmin Invoicing-moduulin asetuksina, eivät Company Settings MVP:n kenttinä.

Nämä ovat todennäköisiä tulevia tarpeita, mutta ne eivät kuulu ensimmäiseen suunnitteluvaiheeseen.

## Suhde Muihin Dokumentteihin

Liittyvät dokumentit:

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/invoicing-workflow-boundaries.md`
- `docs/modules/customers.md`
- `docs/modules/invoicing.md`
- `docs/architecture/customer-overview-plan.md`
- `docs/architecture/company-settings-implementation-plan.md`
- `docs/architecture/invoice-print-data-foundation-plan.md`
