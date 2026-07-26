# Invoicing Tax And Correction Roadmap

Tämä dokumentti kokoaa laskutuksen tuotantovalmiuteen liittyvät ALV-,
viivästyskorko- ja korjauspolkujen muistilistat. Dokumentti ei muuta nykyisen
MVP:n toteutusta.

## Nykyinen Rajaus

Normaali ALV, yrityskohtaiset ALV-kannat, `sent`- ja `cancelled`-tilat sekä
hyvityslaskut on toteutettu. Laskun summat, ALV-erittely ja hyväksytyn laskun
snapshotit muodostetaan Invoicing-domainin laskentasääntöjen kautta.

Rakennusalan käännetyn verovelvollisuuden toteutusmalli on päätetty
dokumentissa
`docs/architecture/invoice-tax-treatment-completion-plan.md`. Se toteutetaan
laskutason erikoiskäsittelynä muuttamatta nykyisen `normalVat`-polun tuloksia.

Tässä kokonaisuudessa ei toteuteta:

- automaattista korkolain mukaista viivästyskorkoa
- `paid`-tilaa tai maksusuorituksia
- `vatExempt`- tai `outsideVatScope`-käsittelyä
- rivikohtaisia sekalaskuja
- verkkolaskua

## ALV-Käsittelyt

Normaali ALV on nykyisen MVP:n oletettu käsittely. Muita ALV-käsittelyjä ei saa
toteuttaa sotkemalla normaalia ALV-mallia tai tulkitsemalla `0 %`-verokantaa
automaattisesti erikoistapaukseksi.

Tuleva laskutason tai rivitason käsittelymalli voi olla esimerkiksi:

- `normalVat`
- `reverseChargeConstruction`
- `vatExempt`
- `outsideVatScope`

Nämä ovat eri asioita kuin pelkkä `vatRateBasisPoints`-arvo. Hyväksytylle
laskulle tallennetaan myöhemmin käytetty ALV-käsittely ja tarvittavat
laskumerkinnät snapshot-tietoina.

## Rakennusalan Käännetty ALV

Rakennusalan käännetty ALV lisätään myöhemmin hallittuna
ALV-käsittelynä, jos sitä tarvitaan.

`reverseChargeConstruction`:

- vaatii käyttäjän erillisen valinnan
- ei saa perustua ohjelman arvaukseen asiakkaasta, rivistä tai verokannasta
- vaatii oikeat laskumerkinnät
- vaatii ostajan tunnistetiedot
- vaatii tarkistuksen kirjanpitäjältä ennen tuotantokäyttöä
- käyttää juridisena ostajana laskun customer-snapshotia
- pitää laskun vastaanottajan erillisenä toimitusosoitteena
- käyttää laskumerkintöjä `Käännetty verovelvollisuus` ja `AVL 8 c §`
- ei käytä `0 %`- tai `2550`-placeholderia

Tarkka persistence-, snapshot-, hyväksyntä-, hyvitys-, PDF- ja testimalli on
kuvattu completion planissa. Verohallinnon ajantasaiset ohjeet tarkistetaan
aina ennen tuotantokäyttöä.

## ALV-Kannat

ALV-kantojen käyttöliittymä voi myöhemmin näkyä Oma yritys /
Laskutusasetukset -alueella, mutta domain-omistaja on Invoicing.

Mahdollinen tuleva taulu:

```text
invoice_vat_rates
- id
- companyId
- rateBasisPoints
- label
- validFrom
- validTo
- isActive
- isDefault
- sortOrder
```

Domainia ei saa kovakoodata vain nykyisiin ALV-kantoihin. Hyväksytyt laskut
eivät saa muuttua, vaikka ALV-kantalista muuttuu myöhemmin. Hyväksytyllä
laskulla käytetty ALV-kanta, ALV-käsittely, rivit ja summat ovat snapshot-dataa.

Uusi `normalVat`-lasku ei saa R0-versiossa käyttää `0 %` verokantaa.
Historiallinen `0 %` snapshot säilyy luettavana, mutta sitä ei tulkita
uudelleen eikä muuteta automaattisesti. Verottomuus ja verotuksen
ulkopuolisuus toteutetaan myöhemmin omina käsittelyinään.

## Viivästyskorko

Nykyinen tekninen maksimi viivästyskorolle on liian korkea tuotantokäyttöön.
Tuleva tuotantopolku rajaa arvon realistisemmin ja käyttäjälle selkeämmin.

Lopullista automaattista korkolain mukaista mallia ei päätetä tässä vaiheessa.
Jos Eky myöhemmin ehdottaa viivästyskorkoa lain perusteella, ehdotuksen lähde,
voimassaolo ja käyttötapa tarkistetaan erikseen kirjanpitäjältä tai virallisesta
ohjeesta ennen tuotantokäyttöä.

Hyväksytty lasku snapshottaa käytetyn viivästyskoron. Vanha lasku ei saa
muuttua, vaikka asetusten oletusviivästyskorko muuttuu myöhemmin.

## Vanha Dev-Testidata

Vanhaa paikallista dev-laskudataa ei tarvitse korjata tuotantoa varten.
Tuotantoon lähdetään puhtaalla datalla tai erikseen tarkistetulla migraatiolla.

Nykyinen hyväksyntäpolku laskee laskun summat riveistä uudelleen ennen
hyväksytyn laskun snapshotia. Tämä vähentää riskiä, että vanha luonnosdata
siirtyy hyväksytyksi laskuksi väärillä koontisummilla.

## Lähetetty Lasku Ja Hyvityslasku

Nykyinen reopen-polku koskee hyväksyttyä laskua ennen lähetystä. Tuleva sääntö:

- `approved`-lasku voidaan palauttaa muokattavaksi ennen lähetystä
- `sent`-laskua ei saa enää reopen-muokata
- `sent`-laskun virhe korjataan hyvityslaskulla tai erillisellä korjauspolulla
- hyvityslasku saa oman laskunumeron
- hyvityslasku viittaa alkuperäiseen laskuun
- mahdollinen uusi korjattu lasku tehdään erillisenä uutena laskuna

Tulevat laskun tilat:

- `sent`
- `paid`
- `cancelled`
- `credited`

Näiden tarkka domain-malli, auditointi, UI ja tietokantatoteutus suunnitellaan
erillisinä vaiheina.
