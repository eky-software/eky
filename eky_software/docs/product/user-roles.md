# Käyttäjäroolit ja oikeudet

Tämä dokumentti kuvaa Eky-järjestelmän alustavat käyttäjäroolit ja oikeuksien periaatteet.

Tarkka permission-malli päätetään myöhemmin.

## Periaate

Frontend voi piilottaa toimintoja roolin perusteella.

Backend tarkistaa aina lopullisesti, saako käyttäjä tehdä toiminnon.

Rooli ei yksin välttämättä riitä, vaan myöhemmin voidaan käyttää tarkempia permission-sääntöjä.

## Alustavat roolit

### Owner

Yrityksen pääomistaja tai korkein pääkäyttäjä.

Mahdollisia oikeuksia:

- yrityksen asetusten hallinta
- käyttäjien hallinta
- roolien hallinta
- laskutuksen hallinta
- audit logien tarkastelu
- moduulien käyttöönotto

### Admin

Pääkäyttäjä.

Mahdollisia oikeuksia:

- käyttäjien hallinta
- asiakkaiden hallinta
- kohteiden hallinta
- laskutuksen hallinta
- raporttien tarkastelu

### Office

Toimistokäyttäjä.

Mahdollisia oikeuksia:

- asiakkaiden hallinta
- kohteiden hallinta
- laskuluonnosten tekeminen
- laskujen valmistelu
- työ- ja materiaalikirjausten tarkastelu

### Manager

Työnjohtaja tai vastaava.

Mahdollisia oikeuksia:

- työmääräysten hallinta
- työntekijöiden kirjausten tarkastelu
- tuntien hyväksyntä
- materiaalikirjausten hyväksyntä
- kohteiden tilan tarkastelu

### Worker

Työntekijä.

Mahdollisia oikeuksia:

- omien tuntien kirjaaminen
- omien materiaalien kirjaaminen
- omien työmääräysten tarkastelu
- mobiilisovelluksen käyttö

### Accountant

Kirjanpitoon tai taloushallintoon liittyvä käyttäjä.

Mahdollisia oikeuksia:

- laskujen tarkastelu
- raporttien tarkastelu
- kirjanpitointegraatioihin liittyvät toiminnot

### Viewer

Katselija.

Mahdollisia oikeuksia:

- rajattu lukuoikeus
- ei muokkausoikeuksia

### AiAgent

Tulevaisuuden järjestelmätoimija.

AI-agentilla pitää olla rajatut oikeudet.

AI-agentti ei saa ohittaa käyttöoikeuksia, domain-sääntöjä tai audit logia.

## Permission-esimerkkejä

Mahdollisia permissioneja:

- `customers.read`
- `customers.create`
- `customers.update`
- `customers.delete`
- `sites.read`
- `sites.create`
- `invoices.read`
- `invoices.create`
- `invoices.approve`
- `invoices.send`
- `invoices.cancel`
- `workEntries.create`
- `workEntries.approve`
- `materialEntries.create`
- `materialEntries.approve`
- `users.manage`
- `roles.manage`
- `settings.manage`
- `auditLogs.read`

## Tärkeät säännöt

- käyttäjä kuuluu yhteen tai useampaan yritykseen
- data kuuluu yritykseen
- backend tarkistaa yritysrajauksen
- backend tarkistaa oikeudet
- frontend ei ole turvallisuuden lähde
- oikeuksien muutoksista pitää jäädä audit log

## Avoimet kysymykset

- Voiko sama käyttäjä kuulua useaan yritykseen?
- Tarvitaanko eri roolit eri yrityksissä?
- Voiko työntekijä nähdä vain omat kirjauksensa?
- Kuka saa hyväksyä laskun?
- Kuka saa lähettää laskun?
- Kuka saa nähdä audit logit?