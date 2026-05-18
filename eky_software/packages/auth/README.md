# Auth package

Tämä paketti sisältää autentikointiin liittyvät rajapinnat ja adapterit.

Vastuut myöhemmin:

- käyttäjäsession malli
- tokenin käsittely
- Firebase Auth wrapper
- auth-tilan muutosten seuranta

Firebase ei saa vuotaa satunnaisiin komponentteihin, domainiin tai service-logiikkaan.

Skeleton-vaiheessa tähän pakettiin ei lisätä vielä Firebase-riippuvuutta.
