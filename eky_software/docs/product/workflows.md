# Yrityksen työnkulut

Tämä dokumentti kuvaa yrityksen todellisia prosesseja.

AI ei saa arvata työnkulkuja, jos niitä ei ole kuvattu tässä dokumentissa tai moduulidokumenteissa.

## Tavoite

Tavoitteena on ymmärtää, miten yritys oikeasti toimii.

Ohjelmiston pitää tukea todellista arkea, ei keksittyä prosessia.

## Ensimmäinen oletettu päävirta

Alustava työnkulku voi olla:

1. asiakas perustetaan
2. asiakkaalle perustetaan kohde tai työmaa
3. työlle luodaan työmääräys
4. työntekijä tai toimisto kirjaa työtä ja materiaaleja
5. kirjaukset tarkastetaan tai hyväksytään
6. hyväksytyistä tiedoista muodostetaan laskuluonnos
7. laskuluonnosta muokataan tarvittaessa
8. lasku hyväksytään
9. lasku lähetetään
10. lasku merkitään maksetuksi

Tämä on alustava malli, ei lopullinen totuus.

## Perinteinen laskunkirjoitus

Ensimmäisessä MVP:ssä voidaan toteuttaa perinteinen laskunkirjoitus.

Virta:

1. käyttäjä valitsee asiakkaan
2. käyttäjä valitsee kohteen tarvittaessa
3. käyttäjä lisää laskurivit käsin
4. järjestelmä laskee summat ja ALV:n
5. käyttäjä tallentaa laskuluonnoksen
6. käyttäjä hyväksyy laskun
7. lasku voidaan myöhemmin tulostaa tai lähettää

Tämä malli muistuttaa perinteistä laskutusohjelmaa.

## Laajempi ERP-laskutus

Myöhemmässä vaiheessa lasku voidaan muodostaa hyväksytyistä kirjauksista.

Virta:

1. työntekijä kirjaa tunnit mobiilissa
2. työntekijä kirjaa materiaalit mobiilissa
3. tiedot synkronoituvat backendille
4. toimisto tai työnjohtaja hyväksyy kirjaukset
5. hyväksytyt kirjaukset liitetään laskuluonnokseen
6. lasku tarkastetaan ja lähetetään

## Asiakkaan perustaminen

Avoimet kysymykset:

- mitä tietoja asiakkaasta tarvitaan?
- voiko asiakas olla yksityishenkilö tai yritys?
- tarvitaanko Y-tunnus?
- tarvitaanko useita osoitteita?
- tarvitaanko useita yhteyshenkilöitä?

## Kohteen perustaminen

Avoimet kysymykset:

- onko yhdellä asiakkaalla monta kohdetta?
- tarvitaanko kohteelle oma osoite?
- tarvitaanko kohteelle yhteyshenkilö?
- liittyykö lasku aina kohteeseen?
- voiko työtä tehdä ilman kohdetta?

## Tuntikirjaus

Avoimet kysymykset:

- kuka kirjaa tunnit?
- kirjataanko aloitus- ja lopetusaika vai tuntimäärä?
- hyväksyykö joku tunnit?
- voiko työntekijä muokata vanhoja kirjauksia?
- milloin kirjaus voidaan laskuttaa?

## Materiaalikirjaus

Avoimet kysymykset:

- kirjataanko materiaalit vapaana tekstinä vai tuoterekisteristä?
- vaikuttaako materiaalikirjaus varastoon?
- kuka hyväksyy materiaalit?
- miten hinta määräytyy?
- voiko materiaali mennä suoraan laskulle?

## Laskutus

Avoimet kysymykset:

- miten laskunumerointi toimii?
- mitä maksuehtoja käytetään?
- tarvitaanko PDF heti?
- lähetetäänkö laskut sähköpostilla?
- tarvitaanko verkkolasku myöhemmin?
- miten hyvityslaskut käsitellään?
- kuka saa hyväksyä laskun?
- kuka saa lähettää laskun?

## Raportointi

Avoimet kysymykset:

- mitä raportteja tarvitaan ensimmäisenä?
- tarvitaanko asiakaskohtainen raportti?
- tarvitaanko työmaakohtainen raportti?
- tarvitaanko työntekijäkohtainen tuntiraportti?
- tarvitaanko myynnin tai laskutuksen kooste?

## Päivitysperiaate

Kun yrityksen todellinen prosessi selviää, tämä dokumentti päivitetään.

Jos prosessi muuttuu, myös moduulidokumentit ja mahdolliset testit päivitetään.