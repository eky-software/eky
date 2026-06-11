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

- Onko muutoksen luottamusraja ja ulkoinen syöte tunnistettu?
- Onko uuden tai muuttuneen HTTP-reitin autentikointi- ja verkkonäkyvyystila eksplisiittinen?
- Tarkistaako backend käyttöoikeudet?
- Noudatetaanko deny by default -periaatetta?
- Onko frontend vain käyttökokemusta varten, ei turvallisuuden lähde?
- Tulevatko käyttäjä ja `companyId` backendin vahvistamasta kontekstista eivätkä request bodysta tai querysta?
- Vuotaako salaisuuksia frontendiin?
- Palauttaako API vain käyttötapauksen tarvitsemat kentät?
- Kirjataanko kriittinen toiminto audit logiin?
- Estetäänkö toisen yrityksen datan käyttö?
- Onko syötteen tyyppi, muoto, pituus, rajat ja sallittu arvojoukko validoitu backendissä?
- Onko request bodyn ja tiedostojen kokorajat arvioitu?
- Voiko syöte vaikuttaa SQL:ään, HTTP-otsakkeisiin, tiedostopolkuihin, lokiin tai renderöityyn sisältöön?
- Ovatko virhevastaus ja lokitus turvallisia ilman stack trace-, salaisuus- tai henkilötietovuotoa?
- Onko local-MVP edelleen sidottu vain loopback-osoitteeseen?
- Käytetäänkö autentikoimattomassa MVP:ssä vain synteettistä testidataa?
- Käytetäänkö turvallisia ympäristömuuttujia salaisuuksille?
- Jos palvelu avataan verkkoon, onko auth-, permission-, HTTPS-, origin/CORS-, cookie/token-, CSRF- ja abuse-suojaus päätetty?

## Riippuvuudet

- Lisättiinkö uusi kirjasto?
- Ajettiinko dependency- tai lockfile-muutoksen jälkeen tuotantoriippuvuuksien audit?
- Jäikö tunnettu haavoittuvuus, ja onko sen riski sekä korjaussuunnitelma dokumentoitu?
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
- Testataanko puuttuva tai virheellinen identiteetti/token, kun auth on käytössä?
- Testataanko toisen yrityksen tunnisteella tehdyt luku- ja kirjoitusyritykset?
- Testataanko virheelliset, liian pitkät ja raja-arvot sisältävät syötteet?
- Testataanko relevantit injektio- ja tietovuotopolut?
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
