# Testausohjeet

Tämä dokumentti määrittelee Eky-projektin testauksen periaatteet.

Testauksen tavoite on varmistaa, että liiketoimintasäännöt, turvallisuuskriittiset polut ja moduulirajat toimivat oikein.

## Testauksen pääperiaatteet

Testaa ensisijaisesti sääntöjä, laskentaa, tilasiirtymiä ja kriittisiä työnkulkuja.

Älä testaa vain sitä, että komponentti renderöityy, jos testillä ei ole todellista arvoa.

Pidä testit luettavina ja kohdistettuina.

Onnistuva normaalipolku ei yksin riitä kriittiselle toiminnolle. Testeissä
huomioidaan riskin mukaan myös virheelliset syötteet, raja-arvot, odottamattomat
toimintajärjestykset, toistuvat pyynnöt, käyttöoikeuksien puuttuminen,
yritysrajan ylitysyritykset ja turvalliset virhevastaukset.

Poikkeavia tapauksia ei testata satunnaisesti vain testimäärän kasvattamiseksi.
Testit johdetaan toiminnon luottamusrajoista, liiketoimintasäännöistä ja
todellisista väärinkäyttö- tai rikkoutumistavoista.

## Testien Sijainti

Yksikkö- ja komponenttitestit pidetään lähtökohtaisesti testattavan tiedoston
vieressä.

Esimerkiksi:

```text
invoiceRowFormState.ts
invoiceRowFormState.test.ts
```

Kun toteutus siirtyy moduulin sisällä, sen testi siirtyy mukana. Yksikkötesteille
ei luoda juureen toteutusrakennetta peilaavaa yleistä `tests/`-kansiota.

Laajemmat integraatio-, sopimus- ja E2E-testit voidaan myöhemmin sijoittaa omiin
selkeästi nimettyihin kansioihinsa, jos niiden testattava kokonaisuus ei kuulu
yhdelle tiedostolle tai moduulin sisäiselle vastuulle.

Yleistä `test-utils`-kaatopaikkaa ei luoda. Toistuva testi-infrastruktuuri
irrotetaan vasta todelliseen tarpeeseen ja nimetään vastuun mukaan.

## Mitä testataan aina

Lisää testit aina, kun muutos koskee:

- laskutusta
- rahasummia
- ALV-laskentaa
- laskun tiloja
- käyttöoikeuksia
- domain-logiikkaa
- validointia
- audit trailia
- tietomallin muunnoksia
- kriittisiä työnkulkuja

## Yksikkötestit

Yksikkötestit sopivat erityisesti:

- domain-funktioille
- laskentafunktioille
- validointisäännöille
- permission-säännöille
- mapper-funktioille
- puhtaille apufunktioille

Domain-kerroksen pitää olla helposti yksikkötestattava.

## Integraatiotestit

Integraatiotestejä tarvitaan, kun useampi kerros toimii yhdessä.

Esimerkkejä:

- backend handler -> service -> repository
- API-kutsu ja tietokantakirjoitus
- käyttäjän oikeuksien tarkistus backendissä
- laskuluonnoksen luonti hyväksytyistä riveistä

Integraatiotestit eivät saa käyttää tuotantodataa.

## Frontend-testit

Frontendissä testataan erityisesti:

- käyttäjän kriittinen työnkulku
- lomakkeen validointi
- virhetilojen näyttö
- käyttöoikeuksien vaikutus näkymään
- tärkeät painikkeet ja toimintopolut

Frontendin käyttöoikeustesti ei korvaa backendin käyttöoikeustestiä.

## Turvallisuustestit

Testaa turvallisuuskriittiset tilanteet:

- käyttäjä ei saa nähdä toisen yrityksen dataa
- käyttäjä ei saa tehdä toimintoa ilman oikeutta
- frontendistä lähetetty väärä data hylätään backendissä
- token puuttuu tai on virheellinen
- yritysrajaus `companyId` toimii oikein
- käyttäjän lähettämää `companyId`-arvoa ei luoteta backendin yrityskontekstina
- liian pitkät arvot, väärät tyypit ja sallitut rajat ylittävät numerot hylätään
- SQL-, otsake-, polku- ja lokiinjektion kannalta relevantit syötteet käsitellään turvallisesti
- API ei palauta toisen yrityksen tietoja tai käyttötapaukselle tarpeettomia arkaluonteisia kenttiä
- turvallinen virhevastaus ei paljasta stack tracea, SQL:ää, tiedostopolkuja tai salaisuuksia

Jos autentikointi, permission-malli tai audit trail ei ole vielä toteutettu, testi ei saa teeskennellä niiden olevan kunnossa. Rajaus dokumentoidaan ja toteutusta käytetään vain hyväksytyssä local development -tilassa synteettisellä datalla.

## Automaattinen CI-Tarkistus

GitHub Actions ajaa testit ja staattiset tarkistukset automaattisesti `antsa`-
ja `main`-haarojen push-tapahtumissa sekä `main`-haaraan kohdistuvissa pull
requesteissa.

CI:n vähimmäisportti on:

```text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm --filter @eky/backend build
pnpm --filter @eky/web build
```

CI täydentää paikallista testausta, mutta ei korvaa sitä. Muutos testataan
paikallisesti ennen commitia silloin, kun paikallinen ympäristö sen sallii.

CI:

- käyttää lukittua lockfilea
- ei käytä tuotanto- tai henkilötietoja
- ei tarvitse sovelluksen salaisuuksia nykyisessä testiputkessa
- saa vain työn tarvitsemat GitHub-oikeudet
- käyttää GitHub Action -toiminnoille lukittuja commit-SHA-versioita
- ei tee deployta eikä kirjoita liiketoimintadataa

Vihreä CI ei yksin todista liiketoimintasäännön tai turvallisuusmallin olevan
oikea. Katselmoinnissa tarkistetaan edelleen testien laatu, puuttuvat negatiiviset
tapaukset ja nykyisen local-MVP:n dokumentoidut turvallisuusrajat.

## Testidatan periaatteet

Testidata ei saa sisältää oikeita henkilötietoja, asiakastietoja, laskuja tai salaisuuksia.

Käytä selkeitä testinimiä.

Esimerkkejä:

- `Example Customer Oy`
- `Test Site 1`
- `Invoice Draft A`

## Milloin testi voidaan jättää tekemättä

Testi voidaan jättää tekemättä vain, jos muutos on dokumentaatiota, kommentti, pieni tyylimuutos tai muu selvästi ei-toiminnallinen muutos.

Jos testi jätetään pois toiminnallisesta muutoksesta, syy pitää kertoa.

## AI:n testausvastuu

Kun AI tekee muutoksen, sen pitää arvioida tarvitaanko testi.

Jos muutos koskee kriittistä logiikkaa, AI:n pitää ehdottaa testiä.

Jos testiä ei tehdä, AI:n pitää perustella miksi.

## Valmiin testauksen tarkistus

Ennen kuin muutos katsotaan valmiiksi, tarkista:

- testit kohdistuvat oikeaan asiaan
- testit ovat luettavia
- testit eivät nojaa tuotantodataan
- kriittinen virhepolku on huomioitu
- käyttöoikeudet on testattu backendissä
- domain-logiikka on testattu puhtaasti
