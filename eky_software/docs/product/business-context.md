# Liiketoimintakonteksti

Tämä dokumentti kuvaa, miksi Eky-järjestelmää rakennetaan ja mitä ongelmia sillä ratkaistaan.

## Tausta

Eky rakennetaan aluksi rakennusalan yrityksen käyttöön.

Ensimmäinen käytännön tarve on asiakaskortisto ja laskutus.

Järjestelmä suunnitellaan kuitenkin niin, että sitä voidaan myöhemmin laajentaa muihin yrityksen toimintoihin ja mahdollisesti käyttää myös muissa yrityksissä.

## Projektin tavoite

Tavoitteena on rakentaa turvallinen, modulaarinen ja laajennettava ERP-pohja.

Ensimmäinen versio tuottaa hyötyä laskutuksessa ja asiakashallinnassa.

Myöhemmät vaiheet voivat sisältää:

- työmääräykset
- tuntikirjaukset
- materiaalikirjaukset
- mobiilisovelluksen työntekijöille
- raportoinnin
- varastonhallinnan
- integraatiot
- AI-agentit

## Miksi oma järjestelmä

Oman järjestelmän avulla voidaan:

- sovittaa ohjelma yrityksen todelliseen työnkulkuun
- vähentää manuaalista kirjaamista
- yhdistää työmaa, asiakas ja laskutus
- mahdollistaa mobiilikirjaukset
- kehittää järjestelmää vaiheittain
- lisätä AI-agentteja myöhemmin hallitusti

## Ensimmäinen MVP

Nykyinen local desktop -MVP sisältää:

- asiakaskortistoon
- perinteiseen laskunkirjoitukseen
- laskuluonnoksiin
- hyväksynnän, laskunumeroinnin ja immutable snapshotit
- PDF:n, sähköposti- ja manuaalisen toimituksen sekä toimitushistorian
- maksutilan, peruutuksen ja koko- tai osahyvityksen
- salatun paikallisen backup/restore-ketjun

Kohteet, työmääräykset, työntekijät ja mobiilikirjaukset ovat seuraavia
liiketoimintamoduuleita. Installer, code signing ja hallittu päivityspolku ovat
erillisiä desktop-jakelun vaiheita.

## Pitkän aikavälin suunta

Pitkällä aikavälillä Eky voi toimia yrityksen toiminnanohjauksen pohjana.

Mahdollisia laajennuksia:

- työntekijän mobiilikirjaukset
- työmaakohtainen dokumentointi
- materiaalien seuranta
- raportointi
- tarjoushallinta
- varastonhallinta
- kirjanpitointegraatiot
- AI-agentit

## Turvallisuuden merkitys

Järjestelmä käsittelee yrityksen ja asiakkaiden tietoja.

Turvallisuus on ensisijainen vaatimus.

Käyttäjät, oikeudet, yritysrajaukset, laskutusdata ja audit trail pitää suunnitella huolellisesti.

## Monistettavuus

Vaikka järjestelmä rakennetaan ensin yhdelle yritykselle, sitä ei kovakoodata vain tämän yrityksen tarpeisiin.

Perusrakenne tehdään niin, että järjestelmä voidaan myöhemmin ottaa käyttöön myös muissa yrityksissä.

## Avoimet liiketoimintakysymykset

- Laskutetaanko tuntityötä, materiaaleja, urakoita vai näiden yhdistelmiä?
- Onko asiakkaana yksityisiä, yrityksiä, taloyhtiöitä vai kaikkia?
- Tarvitaanko verkkolasku myöhemmin?
- Kuka saa hyväksyä laskun?
- Miten työaika kirjataan nykyään?
- Miten materiaalit kirjataan nykyään?
- Mitä raportteja yritys tarvitsee?
