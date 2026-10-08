# Approved Invoice PDF Layout Plan

Tämä dokumentti omistaa hyväksytyn laskun PDF-rendererin piirtojärjestyksen
ja muuttumattomat layout-sopimukset. Rakenteellista jakoa edeltävän
auditoinnin historiallinen baseline on commit `25a0004`.

Dokumentti ei muuta laskun snapshot-dataa, summia, PDF:n ulkoasua,
tiedostotallennusta tai generointipolkua.

## Renderöintipolku

`renderApprovedInvoicePdf` saa kapean `ApprovedInvoicePdfContent`-sisällön.
Siinä ovat vain nykyisen piirron tarvitsemat snapshot-kentät, rivit sekä
valmiit summat ja ALV-erittely, eivät elävä status, maksut tai peruutustiedot.
Renderer luo A4-kokoisen `PDFDocument`-olion, kerää byte-chunkit muistiin, kutsuu
piirto-orkestrointia ja palauttaa lopuksi yhden `Uint8Array`-arvon.

Keskeneräisessä [B3-sovituksessa](release-0.3.0-m1-preparation-plan.md#b3-b5-toteutusvalmistelu)
`toInvoiceRevisionPdfContent` muuntaa validoidun täsmärevision tähän muotoon
ilman summien uudelleenlaskentaa. `approval` ja `validatedLegacySnapshot`
vaativat authoritative-erittelyn; kelvollinen legacy/unavailable-historia
tuottaa erillisen turvallisen unavailable-virheen eikä lupaa regeneroida.
Puuttuva hyvityksen viite esitetään tyhjänä, mutta pysyvä null ei muutu.

Työpuun generointikäyttötapa lukee nyt täsmärevision eikä käytä elävää
`ApprovedInvoiceView`-näkymää tai laske ALV-erittelyä uudelleen. Tavallisen
laskun ja hyvityksen hyväksyntä välittävät juuri palautuneen revisioavaimen
PDF-hookille. Manuaalinen generointi valitsee nykyavaimen ja käyttää samaa
täsmällistä polkua. Tavut kirjoitetaan oman ehdokkaan polkuun ennen
ehdollista metadatan julkaisua. Vanhan työn valmistuminen ei korvaa uudempaa
revisiota; välimuisti varmennetaan tavutasolla ja sen nykykelpoisuus luetaan
ilman kirjoitusta. Puuttuvaa tai rikkinäistä historiatiedostoa ei regeneroida.
Generaattori, hyväksyntäkoukut ja nykyesikatselun GET-/metadataluku ovat
kohdetodennettuja. Esikatselu valitsee täsmädokumentin, varmentaa tavut ja
tarkistaa valinnan uudelleen. Muuttunut valinta hylätään eikä luku koskaan
generoi tai korjaa PDF:ää. Peruutettu lasku säilyy luettavana, reopened-
esikatselu irrotetaan ja eksplisiittinen legacy-alkuperäinen säilyttää oman
provenanssinsa. Tapahtumaan sidotun historian backend-luku varmentaa tarkan
dokumentin myös nykyrevision vaihtuessa; se ei käytä rendereriä tai
nykyesikatselun valintaa. Historiallinen null on eri tulos kuin rikkinäinen
ei-null-viite. Historian client/UI/native-ketju, toimitusketju ja B5:n
palautusnäyttö ovat vielä kesken.
Renderer ei lue tietokantaa, Company Settingsiä,
Customers-moduulia tai laskuluonnosta eikä laske laskun summia uudelleen.

## Piirtojärjestys Ja Osiot

| Osio | Snapshot-input | Keskeinen layout | Fontit, värit ja tekstit | Paluu ja sivunvaihto |
| --- | --- | --- | --- | --- |
| Header | yrityksen nimi, osoite ja kotipaikka, laskunumero ja päiväys | vasen x = margin, oikea x = 385, y = 42/64/78, erotinviiva y = 112 | Helvetica-Bold 16/11, Helvetica 9, musta | ei paluuarvoa eikä sivunvaihtoa |
| Recipient and meta | laskun vastaanottajan fallback-snapshot, asiakkaan nimi ja numero, tilausnumero, maksuehto, eräpäivä, huomautusaika, viivästyskorko ja viitenumero | aloitus y = 128; laatikot x = margin ja 338, leveydet 270/215, korkeus 150; sisältö +10/+30 | sininen `#003f8f` osio-otsikko, mustat label/value-rivit, nykyiset suomenkieliset tekstit | palauttaa `y + 150`; ei sivunvaihtoa |
| Additional details | toimitus/kohde ja lisätieto | aloitus `metaBottom + 10`; sisältöleveys `contentWidth - 20`; label 88; dynaaminen korkeus, minimi 32 | Helvetica-Bold/Helvetica 8.5, nykyiset tekstit | tyhjänä palauttaa alku-y:n, muuten laatikon alareunan; ei sivunvaihtoa |
| Invoice lines | rivien snapshotit ja `priceInputMode` | aloitus `detailsBottom + 16`; sarakkeet suhteessa marginiin; otsikko ja erotinviivat; rivikorkeus vähintään 17 | Helvetica-Bold 10/8, Helvetica 8.5, alennus 7 ja `#4f6075`; nykyiset otsikot | sivu vaihtuu, kun `currentY + rowHeight > footerTop - 20`; uusi otsikko alkaa marginaalista; palauttaa riviosion alareunan |
| VAT and totals | snapshotin ALV-erittely sekä valmiit netto-, ALV- ja bruttosummat | aloitus `linesBottom + 18`; ALV x = margin; totals x = 342; totals-rivien y sidotaan alimman ALV-rivin tasoon | Helvetica-Bold 10/8, Helvetica 8.5/9, loppusumma Bold 10; nykyiset tekstit | palauttaa ALV- ja summalohkon alimman y-arvon; ei sivunvaihtoa |
| Payment bar | viitenumero, eräpäivä ja bruttosumma | y = `max(totalsBottom + 18, 628)`; teksti y + 11; viivat y ja y + 32 | Helvetica-Bold 10, paluu Helvetica 9 | ei paluuarvoa eikä sivunvaihtoa |
| Footer | yrityksen osoite-, yhteys-, ALV/Y-tunnus/kotipaikka- ja pankkisnapshotit | y = `footerTop + 4`; neljä 110/120 leveää saraketta x = margin, +130, +260 ja +390 | Helvetica-Bold 8 otsikot, Helvetica 8 arvot; nykyiset tekstit | piirretään nykyiselle viimeiselle sivulle, ei paluuarvoa |
| Page numbers | buffered page range | x = 460, y = 24, width = 90 | Helvetica 8, `#4f6075`, teksti `Sivu n / määrä` | käy kaikki bufferoidut sivut piirtojärjestyksen lopuksi |

## Vastaanottajan Fallback

Jos `billingRecipientCustomerId` on asetettu, vastaanottajalohko käyttää
laskun vastaanottajan snapshot-kenttiä. Muussa tapauksessa se käyttää asiakkaan
snapshot-kenttiä. Fallback on osa hyväksytyn laskun muuttumatonta näkymäsopimusta
eikä renderer hae puuttuvia tietoja master datasta.

## Laskurivien Sarakkeet

Sarakkeet säilyvät nykyisillä suhteellisilla sijainneilla ja leveyksillä:

- Koodi: x, 55
- Nimike: x + 58, 235
- Määrä: x + 298, 42, oikealle
- Yks: x + 345, 28
- A-hinta: x + 374, 74, oikealle
- Yhteensä: x + 452, 59, oikealle

`priceInputMode` vaikuttaa vain nykyiseen A-hinnan otsikkoon ja rivisumman
valintaan. Nykyistä yksikköhinnan redundanttia ternaryä ei korjata
rakenteellisen siirron yhteydessä.

## Muuttumattomat Sopimukset

- sivukoko on A4
- marginaali on `42`
- `bufferPages` pysyy käytössä sivunumeroita varten
- sisältöleveys on `511.28`, sivun leveys `595.28` ja korkeus `841.89`
- footer alkaa y-arvosta `720`
- osiojärjestys on header, recipient/meta, details, lines, VAT/totals,
  payment bar, footer ja page numbers
- payment barin minimi-y on `628`
- laskurivin sivunvaihtoraja on `footerTop - 20`
- uuteen sivuun piirretään nykyinen laskurivien otsikko samasta marginaalista
- kaikki x-, y-, leveys-, korkeus-, väri-, fontti- ja fonttikokoarvot säilyvät
- kaikki käyttäjälle näkyvät PDF-tekstit säilyvät
- `gross`- ja `net`-otsikot sekä riviloppusumman valinta säilyvät
- nykyiset `formatPdf*`-funktiot säilyvät ainoana PDF-formatointipolkuna
- renderer käyttää valmiita snapshot-summia eikä tee rahalaskentaa
- PDF-metadata, chunkien keräys ja bytejen palautustapa säilyvät
- `renderApprovedInvoicePdf`-export ja byte-paluu säilyvät; B3:n kavennettu
  sisältöparametri kuvataan yllä, eikä se tuo rendereriin julkaisuvaltuutta

Historiallinen `25a0004`-auditointi koski piirto-osioiden rakenteellista
jakoa ilman yleistä PDF-frameworkia tai shared-pakettia. Se ei ole B3:n
revision, tallennusrajan tai toimitushistorian hyväksyntätodiste.
