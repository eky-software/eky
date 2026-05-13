# Moduulidokumenttien yleisohje

Tämä kansio sisältää Eky-järjestelmän moduulikohtaiset kuvaukset.

Moduulidokumentti kertoo, mitä moduuli tekee, mitä se omistaa ja mitä se ei omista.

## Moduulidokumentin tarkoitus

Moduulidokumentti auttaa ihmistä ja AI:ta ymmärtämään moduulin rajat.

AI ei saa keksiä moduulin vastuita omasta päästään.

## Jokaisessa moduulidokumentissa kuvataan

- tarkoitus
- vastuut
- mitä moduuli omistaa
- mitä moduuli ei omista
- tärkeät käsitteet
- suhde muihin moduuleihin
- turvallisuus- ja käyttöoikeushuomiot
- avoimet kysymykset

## Moduulien pääperiaate

Moduuli omistaa oman datansa ja sääntönsä.

Toinen moduuli ei saa muuttaa suoraan toisen moduulin sisäistä dataa.

Moduulien välinen kommunikaatio tehdään hallitusti.

## Dokumentoitavat moduulit

Alustavat moduulit:

- customers
- sales
- invoicing
- inventory
- work-orders
- reporting

Mahdollisia myöhempiä moduuleja:

- sites
- work-entries
- material-entries
- documents
- audit
- integrations
- ai-agents

## Moduulin lisääminen

Kun uusi moduuli lisätään:

1. lisää dokumentti `docs/modules/`
2. määrittele moduulin vastuut
3. määrittele mitä moduuli ei omista
4. päivitä `module-boundaries.md`
5. lisää tarvittaessa ADR-päätös
6. lisää koodikansioon oma `AGENTS.md`, jos moduuli vaatii erityissääntöjä