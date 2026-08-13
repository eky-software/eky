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
- Hylätäänkö väärä JSON-kenttätyyppi ennen application serviceä ilman
  hiljaista muunnosta puuttuvaksi tai tyhjäksi arvoksi?
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
- Onko siirrettävä backup aina salattu ilman plaintext-fallbackia?
- Ovatko siirrettävä backup, konekohtainen palautuspiste, tukipaketti ja
  lasku-PDF:n arkistokopio eri vastuita?
- Tekeekö restore kaiken staging-profiiliin ennen aktiivisen profiilin
  vaihtoa?
- Estetäänkö traversal, symlink, junction, reparse point ja osittainen
  aktiivisen profiilin korvaus?
- Onko backup-salasana, avainmateriaali, payload ja paikallinen polku poissa
  rendereristä, lokeista ja tukipaketista?
- Vaatiiko schemaa muuttava päivitys validoidun pre-update-palautuspisteen?
- Vastaavatko `schema_migrations`, migration metadata ja packaged SQL-
  manifesti toisiaan ennen pending-migraation ensimmäistä kirjoitusta?
- Säilyvätkö legacy-baseline ja uutena ajettu migraatio erotettavina ilman
  tekaistua historiallista release-identiteettiä?
- Omistaako asennin vain binaarit eikä business dataa, salaisuuksia tai
  palautuspisteitä?
- Käynnistääkö Electron main updaterin ilman shell-merkkijonoa ja ilman
  rendererin antamia polkuja, URL:eja tai argumentteja?
- Kopioidaanko paikallinen update-paketti Eky-private stagingiin ja
  varmennetaanko staged tavut uudelleen ennen installer handoffia?
- Sitooko päivitysjournalin package identity koon, SHA-256:n, app-version,
  MSI-tuoteversion ja myöhemmän publisher-identiteetin samaan staged
  artifactiin?
- Erotetaanko tavujen eheys julkaisijan identiteetistä niin, ettei SHA-256:ta
  käsitellä allekirjoituksena?
- Estyykö allekirjoittamaton normaali in-app update ilman erikseen hyväksyttyä
  trust anchor -mallia?
- Jos käytössä on R0:n `localUnsignedPilot`, onko se rajattu `pilot`-kanavaan,
  yhteen hallittuun laitteeseen, paikalliseen mediaan ja käyttäjän
  vahvistukseen ilman verkko-, tausta-, hiljaista tai `stable`-polkua?
- Väittääkö dokumentaatio tai UI virheellisesti SHA-256:ta, sidecaria tai
  `unsigned-prototype`-tilaa publisher-luottamukseksi?
- Erotetaanko asennuksen onnistuminen uuden version first-start-
  hyväksynnästä?
- Onko business-datan rollback erotettu binary rollbackista ilman reverse
  SQL -migraatiota?

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
- Onko Dependabot-PR käsitelty ehdotuksena ilman automaattista mergeä?
- Säilyvätkö Dependabot version updates viikkorytmissä ja security updates
  tavallisen version-cooldownin ulkopuolella?
- Tarkistettiinko package- ja lockfile-diffistä suorat sekä transitiiviset
  muutokset, eikä vain Dependabotin otsikkoa?
- Ajettiinko dependency- tai lockfile-muutoksen jälkeen tuotantoriippuvuuksien audit?
- Ajettiinko tarvittaessa koko audit ja registry-allekirjoitusten tarkistus?
- Käynnistyikö read-only `Dependency security` jokaisesta `main`-PR:stä ja
  dependency-polkuun osuvasta `main`-pushista, ja onko sen päivittäinen UTC-ajo
  sekä `workflow_dispatch` säilynyt?
- Säilyikö dependency-päivitysten automaattinen merge pois käytöstä?
- Onko Dependency graph-, Dependabot alerts- ja Dependabot security updates
  -tila varmennettu autentikoidulla read-only-kutsulla tai repositoryn
  `Settings` -> `Security` -> `Advanced Security` -näkymästä ilman
  perusteetonta oletusta?
- Jäikö tunnettu haavoittuvuus, ja onko sen riski sekä korjaussuunnitelma dokumentoitu?
- Onko uusi riippuvuus perusteltu?
- Onko lisenssi tarkistettu?
- Voidaanko kirjasto eristää sisäisen kerroksen taakse?
- Onko transitiivisten riippuvuuksien määrä hyväksyttävä?
- Vaatiiko Electron-, native addon-, paketointi- tai testityökalupäivitys
  alustakohtaisen buildin, packaged smoken tai E2E-portin?
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
- Jaettiinko laaja työ toiminnallisiin checkpointteihin, joiden jälkeen
  muuttuneen vastuun kohdetestit ajettiin?
- Ajettiinko workspace-testit, typecheck ja tarvittavat buildit, kun
  checkpointit muodostivat eheän toiminnallisen kokonaisuuden?
- Valittiinko system-, web-, security-, fault- ja critical-E2E-testit muutoksen
  todellisten luottamusrajojen ja riskien perusteella ennen pull requestia?
- Rajattiinko Electron-E2E, Windows-paketointi ja packaged smoke vain
  Electron-, paketointi- tai desktop-capability-muutoksiin?
- Jätettiinkö stress- ja soak-testit erillisiksi manuaalisiksi release-porteiksi?
- Jos dokumentaatio- tai tyylimuutoksessa ei ajettu testejä, raportoitiinko
  perustelu?
- Onko jokainen commit oman vastuualueensa osalta käyttökelpoinen ilman
  tietoisesti rikkinäistä välitilaa?
- Lisättiinkö testi kriittiseen logiikkaan?
- Testataanko virhetilat?
- Testataanko käyttöoikeudet backendissä?
- Testataanko puuttuva tai virheellinen identiteetti/token, kun auth on käytössä?
- Testataanko toisen yrityksen tunnisteella tehdyt luku- ja kirjoitusyritykset?
- Testataanko virheelliset, liian pitkät ja raja-arvot sisältävät syötteet?
- Testataanko relevantit injektio- ja tietovuotopolut?
- Testataanko laskenta ja tilasiirtymät?
- Jos työnkulussa on useita peräkkäisiä tilasiirtymiä, todistaako nimetty
  ketjutesti niiden yhteistoiminnan ja pysyvän tilan?
- Onko relevantit vierekkäiset siirtymät tarkistettu, kuten
  reopen/reapprove, delivery/resend, payment/credit ja delete/restart?
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
- Jäävätkö kriittiset web-E2E:t yhden workerin, loopback-verkon,
  synteettisen datan ja fake-adapterien rajoihin myös CI:ssä?
- Tarvitaanko runtime-, persistence-, PDF-, loki- tai prosessimuutoksen jälkeen
  manuaalinen endurance-baseline, ja verrattiinko tulosta aiempaan ajoon ilman
  yhdestä koneesta johdettua haurasta absoluuttista muistirajaa?
- Päättyvätkö kaikki testiharnessin käynnistämät prosessit ja vapautuvatko
  loopback-portit myös failure- ja restart-polussa?
- Onko testiharnessin prosessiomistus sidottu vakaaseen identiteettiin eikä
  pelkkään nimeen tai mahdollisesti uudelleenkäytettyyn PID:iin?
- Ratkaistaanko cleanup todellisesta rajatun prosessipuun poissaolo-
  postconditionista eikä `taskkill`- tai muun apukomennon exit-koodista?
- Sisältääkö pitkäkestoisen Windows-portin progress vain suljetut scenario-,
  phase-, outcome- ja errorCode-arvot ilman PIDiä, polkua, komentoriviä,
  raakaa prosessitulostetta, stackia tai business-dataa?
- Edelsivätkö pitkän Windows-portin rerunia pienin reproduktio ja regressiotesti,
  ja perustuuko mahdollinen timeoutin muutos mitattuihin terveisiin kestoihin?
- Todistetaanko backupin palautettavuus hardened Windows -artifactilla eikä
  vain backup-tiedoston syntyminen?
- Kattavatko restore-testit stagingin, aktivoinnin, restartin jokaisessa
  journalivaiheessa ja rollbackin?
- Vertaako packaged restore palautetun tietokannan ennen backendin avausta ja
  auktoritatiiviset tiedostoartifactit uudessa prosessissa?
- Todistaako restore, että backupin ulkopuolinen konekohtainen salaisuus ei
  tule backupista eikä katoa palautuksessa?
- Sisältääkö packaged-smoken prosessien välinen tila vain synteettisiä hasheja
  ja tunnisteita ilman salasanaa, sessionia, polkua tai business dataa?
- Kattavatko update-testit suoran Setup-polun, sovelluksesta käynnistetyn
  päivityksen, migration-failuren, health-failuren ja binary rollbackin?

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
