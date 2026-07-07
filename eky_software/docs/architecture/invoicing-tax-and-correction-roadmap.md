# Invoicing Tax And Correction Roadmap

Tämä dokumentti kokoaa laskutuksen tuotantovalmiuteen liittyvät ALV-,
viivästyskorko- ja korjauspolkujen muistilistat. Dokumentti ei muuta nykyisen
MVP:n toteutusta.

## Nykyinen Rajaus

Nykyinen Invoicing MVP tukee normaalia ALV-laskutusta. Laskun summat,
ALV-erittely ja hyväksytyn laskun snapshotit muodostetaan Invoicing-domainin
laskentasääntöjen kautta.

Tässä vaiheessa ei toteuteta:

- rakennusalan käännettyä ALV:tä
- ALV-kantataulua
- automaattista korkolain mukaista viivästyskorkoa
- `sent`-, `paid`-, `cancelled`- tai `credited`-tiloja
- hyvityslaskua
- uusia migraatioita, API-reittejä tai UI-muutoksia

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
- vaatii tarkistuksen kirjanpitäjältä tai virallisesta ohjeesta ennen
  tuotantokäyttöä

Tarkka laskumerkintä, ostajan tunnistetiedot ja lainkohdan esitystapa
päätetään vasta toteutusvaiheessa. Toteutuksessa tarkistetaan ajantasaiset
Verohallinnon ohjeet.

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
