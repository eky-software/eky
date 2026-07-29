# Tarkistuslista ennen valmista muutosta

Tätä listaa käytetään ennen kuin AI:n tai ihmisen tekemä muutos hyväksytään valmiiksi.

## Arkkitehtuuri

- Noudattaako muutos modulaarista monoliittia?
- Onko muutos oikeassa kerroksessa?
- Rikkooko muutos moduulirajoja?
- Sisältääkö UI liiketoimintalogiikkaa?
- Sisältääkö repository liiketoimintalogiikkaa?
- Toteuttaako yksi adapteri useita toisistaan riippumattomia portteja?
- Onko readeriin kasaantunut detail-, context-, grouping- tai
  reporting-vastuita?
- Saako jokainen application service compositionista vain tarvitsemansa portin?
- Onko yhteinen mapping aidosti yhteistä muunnosta eikä piilotettu business- tai
  query-kerros?
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
- Onko business audit erotettu operational- ja security-lokeista?
- Onko eventName tyypitetty ja eventin kentät allowlistattu?
- Voiko eventtiin päästä nimi, osoite, sähköposti, IBAN, request body,
  salaisuus, raw error, stack tai paikallinen käyttäjäpolku?
- Onko pseudonyymi entity- tai actor-tunniste tunnistettu mahdolliseksi
  henkilötiedoksi?
- Onko retention luokiteltu tarkoituksen mukaan ja automaattinen poisto
  testattu?
- Korvaako technical log vahingossa moduulin atomisen business auditin?
- Onko tukipaketti sanitoitu ja erotettu backupista?

### Observability-laajennus

- Onko business-, operational- ja security-event catalog määritelty?
- Onko jokaisella tapahtumalla selvä omistaja?
- Onko transaction ownership määritelty kriittiselle business auditille?
- Ovatko sallitut ja kielletyt kentät tyypitettyjä ilman arbitrary metadataa?
- Onko henkilötieto- ja pseudonyymiluokitus tehty?
- Perustuuko retention tapahtuman tarkoitukseen?
- Onko Activity-projektio tai poissulku päätetty?
- Onko Diagnostics-projektio tai poissulku päätetty?
- Onko tukipakettisisällytys tai poissulku päätetty?
- Onko incident-index-kelpoisuus tai poissulku päätetty?
- Onko failure behavior päätetty erikseen business auditille ja technical
  logille?
- Torjuvatko testit raw errorin, stackin, request bodyn, salaisuudet,
  henkilötiedot ja tarpeettoman business-sisällön?
- Kattavatko yksikkö-, integraatio- ja E2E-testit myös rikkoutuvat polut?
- Käyttääkö muutos yhteistä R0-observabilitysopimusta rakentamatta omaa
  logger-manageria tai tukipakettiformaattia?
- Säilyvätkö business audit, technical log ja support bundle erillisinä
  vastuina?

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
- Päivitettiinkö R0 E2E -matriisi, jos moduuli, luottamusraja, sivuvaikutus,
  tilakone tai Electron-capability muuttui?
- Onko alemman tason kattavuus erotettu rehellisesti toteutetusta E2E:stä?
- Käyttääkö E2E vain loopbackia, synteettistä dataa, testikohtaista temp-rootia
  ja fake-adaptereita?
- Jäävätkö production-build, HTTP-pinta, preload ja renderer vapaiksi
  testikontrolleista ja fault injectionista?
- Todistetaanko onnistuvan polun lisäksi permission/tenant-esto sekä
  failure/recovery-polku oikealla testitasolla?

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
