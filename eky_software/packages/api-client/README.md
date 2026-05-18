# API client package

Tämä paketti sisältää frontendin hallitun yhteyden backend API:in.

Vastuut:

- piilottaa backend-reitit web-sovellukselta
- tarjota myöhemmin tyyppiturvallisia API-funktioita
- keskittää perusmuotoinen virheenkäsittely
- lisätä myöhemmin auth-token kutsuihin

React-komponentit eivät saa tehdä raakaa `fetch`-kutsua suoraan, jos api-client-funktio on olemassa.
