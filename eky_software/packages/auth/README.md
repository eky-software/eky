# Auth package

Tämä paketti sisältää autentikointiin liittyvät rajapinnat ja adapterit.

Nykyiset vastuut:

- ympäristöriippumaton, validoitu `ActorContext`
- local- ja Firebase-authentication mode -tyypit

Tulevat vastuut:

- käyttäjäsession malli
- tokenin käsittely
- Firebase Auth wrapper
- auth-tilan muutosten seuranta

Firebase ei saa vuotaa satunnaisiin komponentteihin, domainiin tai service-logiikkaan.

Skeleton-vaiheessa tähän pakettiin ei lisätä vielä Firebase-riippuvuutta.

`ActorContext` muodostetaan myöhemmin vain backendin vahvistamasta local- tai
cloud-identiteetistä. Frontendin request body ei ole luotettu actor-, company-
tai permission-tietojen lähde.
