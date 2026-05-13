# ADR-0001: Modulaarinen monoliitti ensin

## Tila

Hyväksytty alustavasti.

## Päätös

Eky rakennetaan ensimmäisessä vaiheessa modulaarisena monoliittina.

Mikropalveluarkkitehtuuria ei käytetä ensimmäisessä vaiheessa.

## Konteksti

Eky-projektissa rakennetaan turvallista ja laajennettavaa ERP-pohjaa.

Järjestelmään tulee myöhemmin useita moduuleja, kuten asiakkaat, laskutus, työmääräykset, tuntikirjaukset, materiaalit, raportointi ja AI-agentit.

Projektin alkuvaiheessa tärkeintä on saada selkeä, hallittava ja turvallinen perusrakenne.

## Perustelut

Modulaarinen monoliitti valitaan, koska:

- se on helpompi toteuttaa ja ylläpitää alkuvaiheessa
- se sopii 4 kuukauden harjoittelujaksoon
- se vähentää infrastruktuurin monimutkaisuutta
- se mahdollistaa selkeät moduulirajat
- se antaa mahdollisuuden irrottaa osia myöhemmin erillisiksi palveluiksi
- se on turvallisempi hallita pienellä tiimillä kuin hajautettu mikropalveluarkkitehtuuri

## Seuraukset

Backend on aluksi yksi kokonaisuus.

Moduulit pidetään sisäisesti erillään.

Moduulien rajat dokumentoidaan.

Toinen moduuli ei saa muuttaa toisen moduulin dataa suoraan.

Jos myöhemmin jokin moduuli pitää irrottaa omaksi palvelukseen, se tehdään erillisellä päätöksellä.

## Vaihtoehdot

### Mikropalvelut heti

Hylättiin alkuvaiheessa.

Syyt:

- liikaa infrastruktuuria
- vaikeampi testata
- vaikeampi deploy
- vaatii enemmän DevOps-työtä
- lisää tietoturvan ja kommunikaation monimutkaisuutta

### Yksi sekava monoliitti

Hylättiin.

Syyt:

- vaikea ylläpitää
- vaikea laajentaa
- AI-koodaus voisi helposti sotkea rakenteen
- moduulirajat katoaisivat

## Milloin päätöstä voidaan muuttaa

Päätöstä voidaan arvioida uudelleen, jos:

- jokin moduuli vaatii itsenäistä skaalausta
- jokin integraatio vaatii erillisen palvelun
- AI-agenttien orkestrointi kannattaa erottaa omaksi palvelukseen
- deployment tai turvallisuus vaatii erottamista