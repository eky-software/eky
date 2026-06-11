# Testausohjeet

Tämä dokumentti määrittelee Eky-projektin testauksen periaatteet.

Testauksen tavoite on varmistaa, että liiketoimintasäännöt, turvallisuuskriittiset polut ja moduulirajat toimivat oikein.

## Testauksen pääperiaatteet

Testaa ensisijaisesti sääntöjä, laskentaa, tilasiirtymiä ja kriittisiä työnkulkuja.

Älä testaa vain sitä, että komponentti renderöityy, jos testillä ei ole todellista arvoa.

Pidä testit luettavina ja kohdistettuina.

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
