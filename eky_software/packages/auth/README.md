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

Nykyiseen local-runtimeen ei ole lisätty Firebase-riippuvuutta. Tuleva cloud-
identity-adapteri arvioidaan ja hyväksytään erikseen.

Local-runtime muodostaa `ActorContext`-olion backendin vahvistamasta Electron-
sessionista ja tietokantaan tallennetusta local-identiteetistä. Tuleva
cloud-runtime muodostaa saman sopimuksen vahvistetusta cloud-identiteetistä ja
yritysjäsenyydestä. Frontendin request body ei ole luotettu actor-, company-
tai permission-tietojen lähde.
