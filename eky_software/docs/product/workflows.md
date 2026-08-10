# Yrityksen työnkulut

Tämä dokumentti kuvaa yrityksen todellisia prosesseja.

AI ei saa arvata työnkulkuja, jos niitä ei ole kuvattu tässä dokumentissa tai moduulidokumenteissa.

## Tavoite

Tavoitteena on ymmärtää, miten yritys oikeasti toimii.

Ohjelmiston pitää tukea todellista arkea, ei keksittyä prosessia.

## Valinnaiset Päävirrat

Eky tukee kahta toisiaan täydentävää laskutuspolkua.

Manuaalinen laskutus toimii itsenäisesti ilman kohteita, työmääräyksiä tai mobiilikirjauksia.

Laajempi ERP-työnkulku voi myöhemmin olla:

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

Laajempi ERP-polku ei ole perinteisen laskunkirjoituksen edellytys.

## Perinteinen laskunkirjoitus

Nykyinen local desktop -MVP tukee perinteistä laskunkirjoitusta.

Virta:

1. käyttäjä valitsee asiakkaan
2. käyttäjä valitsee kohteen tarvittaessa
3. käyttäjä lisää laskurivit käsin
4. järjestelmä laskee summat ja ALV:n
5. käyttäjä tallentaa laskuluonnoksen
6. käyttäjä hyväksyy laskun
7. hyväksytystä snapshotista muodostetaan current PDF
8. lasku toimitetaan käyttäjän vahvistamalla sähköpostilla tai merkitään
   manuaalisesti toimitetuksi
9. toimitettu lasku voidaan merkitä maksetuksi
10. virheellinen toimitettu lasku korjataan peruutus- tai hyvityspolulla

Tämä malli muistuttaa perinteistä laskutusohjelmaa.

Tämä polku toimii ilman Work Orders -moduulia. Kohde voidaan valita tarvittaessa, mutta se ei ole pakollinen.

## Laajempi ERP-laskutus

Myöhemmässä vaiheessa lasku voidaan muodostaa hyväksytyistä kirjauksista.

Virta:

1. työntekijä kirjaa tunnit mobiilissa
2. työntekijä kirjaa materiaalit mobiilissa
3. tiedot synkronoituvat backendille
4. toimisto tai työnjohtaja hyväksyy kirjaukset
5. hyväksytyt kirjaukset liitetään laskuluonnokseen
6. lasku tarkastetaan ja lähetetään

Mobiilista ja työmääräyksistä tuleva aineisto muodostaa ensin tarkistettavan laskuehdotuksen tai laskuluonnoksen lähtötiedot.

Tarkempi moduulirajaus on kuvattu dokumentissa `docs/architecture/invoicing-workflow-boundaries.md`.

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

Päätetyt ensimmäiset periaatteet:

- yritysasiakkaan oletushinta syötetään verottomana
- yksityisasiakkaan oletushinta syötetään verollisena
- uusi lasku käyttää oletuksena maksuehtoa 14 päivää netto
- maksuehtoa ja eräpäivää voidaan muuttaa käsin
- lasku voidaan tallentaa luonnoksena tai hyväksyä heti
- laskunumerointi ja tilikausi ovat yrityskohtaisia laskutusasetuksia
- tilikausi voidaan määrittää muuksi kuin kalenterivuodeksi
- alennuksia tarvitaan prosentti- ja euromääräisinä
- virallinen laskunumero annetaan vasta laskun hyväksynnässä
- hyväksyntä on käyttäjän tietoinen toiminto, ei autosave tai tavallinen tallennus
- hyväksynnässä lukitaan laskun snapshot ja kirjataan audit-tapahtuma
- hyväksytylle laskulle voidaan muodostaa ja tallentaa current PDF snapshot-
  datasta
- local desktopissa lasku voidaan toimittaa käyttäjän vahvistamalla DNA SMTP
  -lähetyksellä, ja vain varmasti onnistunut toimitus muuttaa laskun `sent`-
  tilaan
- PDF:n avaaminen tai tulostaminen ei yksin merkitse laskua lähetetyksi
- lähetetty lasku voidaan peruuttaa vain dokumentoiduilla rajoilla tai hyvittää
  koko- tai osahyvityksenä; hyvityslasku saa oman numeron ja viittaa
  alkuperäiseen laskuun
- toimitettu lasku voidaan merkitä maksetuksi ja maksumerkintä voidaan poistaa
  hallitulla auditointipolulla

Jäljellä olevat avoimet kysymykset:

- tarvitaanko verkkolasku myöhemmin?
- kuka saa hyväksyä laskun?
- kuka saa lähettää laskun?
- tarvitaanko myöhemmin muita sähköposti- tai toimitusprovidereita?

Laskun hyväksynnän, laskunumeroinnin, snapshotin, auditoinnin ja local/cloud-numeroinnin tarkempi suunnitelma on dokumentissa `docs/architecture/invoice-approval-numbering-plan.md`.

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
