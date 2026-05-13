# Sanasto

Tämä dokumentti määrittelee Eky-projektin keskeiset termit.

Dokumentaatio voi käyttää suomenkielisiä termejä.

Koodissa käytetään englanninkielisiä termejä.

## Yleiset termit

### Yritys

Englanniksi koodissa: `Company`

Yritys, jonka dataan käyttäjät, asiakkaat, kohteet, laskut ja muut liiketoimintatiedot kuuluvat.

### Käyttäjä

Englanniksi koodissa: `User`

Järjestelmään kirjautuva henkilö.

### Rooli

Englanniksi koodissa: `Role`

Käyttäjän yleinen asema järjestelmässä, esimerkiksi admin tai worker.

### Käyttöoikeus

Englanniksi koodissa: `Permission`

Tarkempi oikeus tehdä jokin toiminto, esimerkiksi `invoices.create`.

## Asiakkaat ja kohteet

### Asiakas

Englanniksi koodissa: `Customer`

Yrityksen asiakas. Asiakas voi olla yksityishenkilö, yritys, taloyhtiö tai muu organisaatio.

### Yhteyshenkilö

Englanniksi koodissa: `ContactPerson`

Asiakkaaseen liittyvä henkilö, johon voidaan olla yhteydessä.

### Kohde

Englanniksi koodissa: `Site`

Rakennusalan kohde, työmaa tai paikka, jossa työ tehdään.

### Osoite

Englanniksi koodissa: `Address`

Asiakkaan, kohteen tai laskutuksen osoitetieto.

## Työ

### Työmääräys

Englanniksi koodissa: `WorkOrder`

Kuvaa mitä työtä tehdään, missä kohteessa ja mahdollisesti kuka sen tekee.

### Tuntikirjaus

Englanniksi koodissa: `WorkEntry`

Työntekijän kirjaama työaika, joka voi liittyä kohteeseen tai työmääräykseen.

### Materiaalikirjaus

Englanniksi koodissa: `MaterialEntry`

Työhön tai kohteeseen kirjattu käytetty materiaali.

### Työntekijä

Englanniksi koodissa: `Employee`

Henkilö, joka tekee työtä yritykselle. Voi olla myös järjestelmän käyttäjä.

## Laskutus

### Laskuluonnos

Englanniksi koodissa: `InvoiceDraft`

Muokattava laskun valmisteluvaihe.

### Lasku

Englanniksi koodissa: `Invoice`

Varsinainen liiketoimintadokumentti. Hyväksyttyä tai lähetettyä laskua ei käsitellä tavallisena muokattavana lomakkeena.

### Laskurivi

Englanniksi koodissa: `InvoiceLine`

Yksittäinen laskulla oleva rivi.

### Hyvityslasku

Englanniksi koodissa: `CreditInvoice`

Lasku, jolla hyvitetään aiempaa laskua. Toteutus päätetään myöhemmin.

### ALV

Englanniksi koodissa: `Vat`

Arvonlisävero.

### Maksuehto

Englanniksi koodissa: `PaymentTerm`

Ehto, joka määrittää esimerkiksi eräpäivän.

## Myynti

### Tarjous

Englanniksi koodissa: `Offer` tai `Quote`

Asiakkaalle annettu ehdotus hinnasta ja sisällöstä. Lopullinen termi päätetään myöhemmin.

### Tilaus

Englanniksi koodissa: `Order`

Hyväksytty myyntiin tai työhön liittyvä kokonaisuus. Lopullinen rooli päätetään myöhemmin.

## Varasto

### Tuote

Englanniksi koodissa: `Product`

Varastossa tai laskutuksessa käytettävä tuote tai materiaali.

### Varasto

Englanniksi koodissa: `Inventory`

Tuotteiden ja saldojen hallinta.

### Varastopaikka

Englanniksi koodissa: `StockLocation`

Paikka, jossa tuotteita säilytetään.

## Raportointi

### Raportti

Englanniksi koodissa: `Report`

Kooste järjestelmän datasta.

### Dashboard

Englanniksi koodissa: `Dashboard`

Näkymä, joka näyttää tärkeimmät mittarit ja tiedot.

## Audit ja turvallisuus

### Audit log

Englanniksi koodissa: `AuditLog`

Jäljitettävä loki tärkeistä tapahtumista.

### Tenant

Englanniksi koodissa: `Tenant`

Yritys- tai asiakkuuskohtainen eristys. Projektissa ensisijainen termi on `Company`, mutta tenant-ajattelu ohjaa arkkitehtuuria.

## Päätettävät termit

Seuraavat termit päätetään myöhemmin tarkemmin:

- tarjous: `Offer` vai `Quote`
- työmaa: `Site` vai `JobSite`
- tilaus: `Order` vai jokin muu
- projekti: `Project` vai osa `Site`-mallia