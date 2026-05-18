# Backend app

Tämä sovellus sisältää Eky-järjestelmän backend-rungon.

Vastuut:

- vastaanottaa API-kutsut
- tarkistaa myöhemmin autentikointi
- tarkistaa käyttöoikeudet ja yritysrajaus
- validoida syöte
- kutsua application service -kerrosta
- käyttää domain-logiikkaa
- käyttää repository-adaptereita
- kirjata myöhemmin audit log -tapahtumat

Backend on luotettu kerros. Frontend ei saa ohittaa backend- tai service-kerrosta.
