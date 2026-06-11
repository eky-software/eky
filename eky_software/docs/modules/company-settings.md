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
- oletustuntihinnan
- oman yrityksen yleiset oletukset, jotka eivät kuulu toisen moduulin liiketoimintasäännöiksi

Laajempi käyttäjälle näkyvä Asetukset-osio voi sisältää usean moduulin näkymiä.

Invoicing omistaa omat liiketoimintakriittiset asetuksensa, kuten ALV-kannat, maksuehdot, numerointisarjat ja tilikauden. Niitä ei siirretä Company Settingsin omistukseen vain siksi, että käyttöliittymä näyttää asetukset samassa kokonaisuudessa.

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
- `defaultHourlyRateCents`
- `createdAt`
- `updatedAt`

Kenttien merkitys:

- `id` on asetusrivin tekninen tunniste.
- `companyId` rajaa tiedot nykyiseen yritykseen.
- `companyName` on oman yrityksen nimi.
- `businessId` on oman yrityksen Y-tunnus.
- `streetAddress`, `postalCode` ja `city` kuvaavat oman yrityksen pääosoitetta.
- `email` ja `phone` ovat oman yrityksen ensisijaiset yhteystiedot.
- `defaultHourlyRateCents` on oman yrityksen oletustuntihinta sentteinä.

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

## Moduulirajat

Company Settings omistaa:

- oman yrityksen tiedot
- oletustuntihinnan
- oman yrityksen yleiset oletukset

Customers omistaa:

- asiakaskohtaisen tuntihintaohituksen
- asiakas-master-datan

Invoicing omistaa:

- laskut
- laskurivit
- ALV-kannat
- maksuehdot
- numerointisarjat
- tilikauden
- laskulla käytetyn tuntihinnan snapshotin
- laskulla käytetyt lähettäjä- ja asiakastiedot snapshotteina, jos ne päätetään tallentaa laskulle

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
- oletustuntihinnan

Myöhemmin sivupalkissa tai erillisessä Asetukset-kokonaisuudessa voidaan näyttää myös laskutusasetukset. Tällöin Oma yritys ja Laskutusasetukset ovat erilliset näkymät ja säilyttävät omat moduulirajansa.

Asiakaskortissa on Hinnoittelu-osio asiakaskohtaista tuntihintaa varten.

Asiakaskortin tuntihintakentän ohjeteksti voi olla:

```text
Jos kenttä jätetään tyhjäksi, käytetään oman yrityksen oletustuntihintaa.
```

Käyttöliittymä saa auttaa käyttäjää ymmärtämään, mistä tuntihinta tulee, mutta backend ja myöhemmin laskutuslogiikka tekevät lopullisen hinnan valinnan.

## Turvallisuus

Company Settings sisältää yrityksen omaa liiketoimintadataa.

Backend tarkistaa myöhemmin, että vain oikean yrityksen käyttäjä voi nähdä tai muokata näitä tietoja.

Frontend voi piilottaa toimintoja, mutta backend tekee lopullisen käyttöoikeuspäätöksen.

Oman yrityksen tietoja ei saa vuotaa toisen yrityksen käyttäjille.

## Rajataan Myöhemmäksi

Ei lisätä ensimmäiseen Company Settings MVP:hen ilman erillistä päätöstä:

- pankkitiliä
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
