# Promptausohjeet

Tämä dokumentti antaa ohjeet siihen, miten Eky-projektissa kannattaa pyytää AI:lta työtä.

Hyvä prompti vähentää virheitä, pitää arkkitehtuurin kasassa ja helpottaa koodin tarkistamista.

## Hyvän promptin rakenne

Hyvä prompti sisältää:

- tavoitteen
- kohdemoduulin
- kerroksen
- luettavat dokumentit
- mitä saa muuttaa
- mitä ei saa muuttaa
- hyväksymiskriteerit
- testitarpeen
- turvallisuushuomion, jos tehtävä liittyy dataan, käyttäjiin tai oikeuksiin

## Hyvä prompti

Esimerkki:

Lue `AGENTS.md`, `docs/architecture/module-boundaries.md` ja `docs/modules/customers.md`.

Luo alustava customer-domainin tyyppirakenne `packages/domain`-kansioon.

Älä lisää UI-koodia.
Älä lisää tietokantakoodia.
Älä lisää uusia riippuvuuksia.
Käytä englanninkielisiä kooditermejä.
Pidä tiedostot pieninä.
Lisää testit vain, jos lisäät toiminnallista domain-logiikkaa.

## Huono prompti

Vältä pyyntöjä kuten:

- tee asiakashallinta
- tee laskutus
- rakenna backend
- korjaa tämä paremmaksi
- tee tästä siisti
- lisää tarvittavat kirjastot
- tee kaikki valmiiksi

Nämä ovat liian laajoja ja johtavat helposti arkkitehtuurin rikkoutumiseen.

## Pyydä suunnitelma ennen koodausta

Laajoissa muutoksissa pyydä ensin suunnitelma.

Esimerkki:

Ennen koodin kirjoittamista anna lyhyt toteutussuunnitelma. Kerro mitä dokumentteja luet, mitä tiedostoja muokkaat, mihin kerroksiin muutos osuu ja tarvitaanko testejä.

## Rajaa kerros

Määritä, mihin kerrokseen työ kuuluu.

Esimerkkejä:

- tee vain domain-tyypit
- tee vain validointiskeema
- tee vain api-client-funktio
- tee vain backend service
- tee vain UI-komponentti
- tee vain testit

Älä pyydä kaikkia kerroksia samaan aikaan, ellei tehtävä ole hyvin pieni.

## Kerro mitä ei saa tehdä

Hyvä prompti kertoo myös rajat.

Esimerkkejä:

- älä lisää uusia riippuvuuksia
- älä muuta arkkitehtuuria
- älä koske backend-koodiin
- älä tee UI:ta
- älä muuta tietomallia
- älä muuta olemassa olevia testejä ilman syytä

## Turvallisuutta koskevat promptit

Jos työ liittyy käyttäjiin, rooleihin, yrityksiin, laskutukseen tai dataan, lisää promptiin turvallisuushuomio.

Esimerkki:

Muista, että backend tarkistaa käyttöoikeudet. Frontendin piilotettu painike ei riitä turvallisuudeksi.

## Kun prompti koskee laskutusta

Laskutus on kriittinen moduuli.

Promptissa pitää kertoa:

- muokataanko laskuluonnosta vai lopullista laskua
- koskeeko muutos laskurivejä
- koskeeko muutos ALV-laskentaa
- koskeeko muutos laskun tilaa
- tarvitaanko testi

## Kun prompti koskee dokumentaatiota

Dokumentaatiopromptissa kerro:

- mikä tiedosto päivitetään
- mitä asiaa täsmennetään
- halutaanko lyhyt vai laaja versio
- vältetäänkö päällekkäisyyttä muiden dokumenttien kanssa

## Hyväksymiskriteerit

Lisää promptiin valmiin työn ehdot.

Esimerkki:

Työ on valmis, kun tiedostot on luotu, koodi on englanniksi, uusia riippuvuuksia ei ole lisätty, domain ei riipu Reactista ja testit menevät läpi.