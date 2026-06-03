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
- myöhemmin rajatut laskutusasetukset, jos ne päätetään kuuluvan tähän moduuliin

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

Customers-moduuli omistaa asiakaskohtaiset poikkeukset, kuten `hourlyRateOverride`.

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
- `defaultHourlyRate`
- `createdAt`
- `updatedAt`

Kenttien merkitys:

- `id` on asetusrivin tekninen tunniste.
- `companyId` rajaa tiedot nykyiseen yritykseen.
- `companyName` on oman yrityksen nimi.
- `businessId` on oman yrityksen Y-tunnus.
- `streetAddress`, `postalCode` ja `city` kuvaavat oman yrityksen pääosoitetta.
- `email` ja `phone` ovat oman yrityksen ensisijaiset yhteystiedot.
- `defaultHourlyRate` on oman yrityksen oletustuntihinta.

## Oletustuntihinta

`defaultHourlyRate` on oman yrityksen oletustuntihinta.

Sitä käytetään myöhemmin, jos asiakkaalla ei ole asiakaskohtaista tuntihintaa.

Hinnoittelun perussääntö:

```text
jos customer.hourlyRateOverride on asetettu
  -> käytä customer.hourlyRateOverride
muuten
  -> käytä companySettings.defaultHourlyRate
```

Oletustuntihintaa voidaan käyttää myöhemmin esimerkiksi:

- työmääräyksissä
- työkirjauksissa
- laskutusluonnoksissa
- laskurivien muodostuksessa

Lopullinen hinnan käyttö päätetään kuitenkin laskutus-, työmääräys- ja työkirjausmoduulien yhteydessä.

## Asiakaskohtainen Tuntihinta

Asiakaskohtainen tuntihinta ei kuulu Company Settings -moduulin omistamaan dataan.

Customers-moduuli voi myöhemmin omistaa kentän:

```ts
hourlyRateOverride: number | null
```

Säännöt:

- jos `hourlyRateOverride` on `null`, käytetään `companySettings.defaultHourlyRate`-arvoa
- jos `hourlyRateOverride` on annettu, se ohittaa oletustuntihinnan kyseiselle asiakkaalle
- `0` ei tarkoita "ei asetettu"
- `0` tarkoittaa nolla euroa
- puuttuva arvo kuvataan siksi `null`-arvolla

## Snapshot-Periaate

Oletustuntihinta ja asiakaskohtainen tuntihinta voivat muuttua ajan myötä.

Siksi laskulle tai laskuriville tallennetaan myöhemmin käytetty tuntihinta snapshotiksi.

Vanha lasku ei saa muuttua, vaikka:

- `companySettings.defaultHourlyRate` muuttuu
- `customer.hourlyRateOverride` muuttuu
- asiakkaan muut tiedot muuttuvat

Invoicing-moduuli omistaa laskulla käytetyn tuntihinnan snapshotin.

## Moduulirajat

Company Settings omistaa:

- oman yrityksen tiedot
- oletustuntihinnan
- myöhemmin rajatut laskutusasetukset

Customers omistaa:

- asiakaskohtaisen tuntihintaohituksen
- asiakas-master-datan

Invoicing omistaa:

- laskut
- laskurivit
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

Asiakaskortille voidaan myöhemmin lisätä Hinnoittelu-osio.

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
- ALV-sääntöjä
- useita hinnastoja
- tuoterekisteriä
- työroolikohtaisia hintoja
- työntekijäkohtaisia hintoja
- laskutusta
- maksuehtoja
- dokumenttipohjia

Nämä ovat todennäköisiä tulevia tarpeita, mutta ne eivät kuulu ensimmäiseen suunnitteluvaiheeseen.

## Suhde Muihin Dokumentteihin

Liittyvät dokumentit:

- `AGENTS.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/modules/customers.md`
- `docs/modules/invoicing.md`
- `docs/architecture/customer-overview-plan.md`
