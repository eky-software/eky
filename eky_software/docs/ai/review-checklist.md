# Tarkistuslista ennen valmista muutosta

Tätä listaa käytetään ennen kuin AI:n tai ihmisen tekemä muutos hyväksytään valmiiksi.

## Arkkitehtuuri

- Noudattaako muutos modulaarista monoliittia?
- Onko muutos oikeassa kerroksessa?
- Rikkooko muutos moduulirajoja?
- Sisältääkö UI liiketoimintalogiikkaa?
- Sisältääkö repository liiketoimintalogiikkaa?
- Onko mahdollinen uusi rakenne dokumentoitu?

## Turvallisuus

- Tarkistaako backend käyttöoikeudet?
- Onko frontend vain käyttökokemusta varten, ei turvallisuuden lähde?
- Vuotaako salaisuuksia frontendiin?
- Kirjataanko kriittinen toiminto audit logiin?
- Estetäänkö toisen yrityksen datan käyttö?
- Onko syöte validoitu backendissä?
- Käytetäänkö turvallisia ympäristömuuttujia salaisuuksille?

## Riippuvuudet

- Lisättiinkö uusi kirjasto?
- Onko uusi riippuvuus perusteltu?
- Onko lisenssi tarkistettu?
- Voidaanko kirjasto eristää sisäisen kerroksen taakse?
- Onko transitiivisten riippuvuuksien määrä hyväksyttävä?
- Päivittyikö `dependency-policy.md`, jos sääntö muuttui?

## Koodi

- Onko koodi englanniksi?
- Onko tiedostoilla yksi vastuu?
- Onko nimi selkeä?
- Onko TypeScript-tyypitys riittävä?
- Onko vältetty turhaa `any`-tyyppiä?
- Onko virheenkäsittely hallittu?
- Onko lokituksessa vältetty salaisuuksia?
- Onko koodi luettavaa?

## Testit

- Tarvitaanko testi?
- Lisättiinkö testi kriittiseen logiikkaan?
- Testataanko virhetilat?
- Testataanko käyttöoikeudet backendissä?
- Testataanko laskenta ja tilasiirtymät?
- Ovatko testit luettavia?
- Käyttävätkö testit vain testidataa?

## Dokumentaatio

- Muuttuiko arkkitehtuuri?
- Muuttuiko moduuliraja?
- Muuttuiko teknologiapäätös?
- Muuttuiko liiketoimintasääntö?
- Syntyikö uusi termi?
- Tarvitseeko jokin `docs/`-tiedosto päivityksen?
- Tarvitaanko ADR-päätös?

## AI-työtapa

- Oliko tehtävä riittävän pieni?
- Annettiinko toteutussuunnitelma ennen laajaa muutosta?
- Luettiinko oikeat dokumentit?
- Onko Git-tila hallinnassa?
- Onko muutos helppo perua tarvittaessa?

## Valmiin työn minimitaso

Muutos voidaan hyväksyä, kun:

- tavoite täyttyy
- arkkitehtuuri ei rikkoudu
- turvallisuus on huomioitu
- testit on lisätty tai perustellusti jätetty pois
- dokumentaatio on päivitetty tarvittaessa
- koodi on luettavaa
- muutoksen vaikutusalue on ymmärrettävä