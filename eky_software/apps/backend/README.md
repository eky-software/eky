# Backend app

Tämä sovellus sisältää Eky-järjestelmän backend-rungon.

Backend on tällä hetkellä pieni Hono-pohjainen HTTP-adapteri, joka tarjoaa `/health`-terveystarkistusreitin.

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

## Vaatimukset

Backend tarvitsee Node.js-version, joka tukee `--env-file-if-exists`-lippua.

Käytännössä kehitysympäristössä käytetään modernia Node-versiota. `@hono/node-server` vaatii Node >= 20.

## Paikallinen ympäristö

Kopioi projektin juuressa oleva `.env.example` paikalliseksi `.env`-tiedostoksi:

```bash
cp .env.example .env
```

Windows PowerShellissä:

```powershell
Copy-Item .env.example .env
```

`.env` on paikallinen tiedosto eikä sitä commitoida Gitiin.

Nykyiset paikalliset asetukset:

```env
HOST=127.0.0.1
PORT=3000
```

`HOST` määrittää, mihin osoitteeseen paikallinen backend sitoutuu. Oletus on turvallisesti `127.0.0.1`.

`PORT` määrittää paikallisen backendin HTTP-portin. Oletus on `3000`.

## Komennot

Aja komennot projektin juuresta `eky_software/`.

Tyyppitarkistus:

```bash
pnpm typecheck
```

Backendin build:

```bash
pnpm --filter @eky/backend build
```

Backendin käynnistys:

```bash
pnpm --filter @eky/backend start
```

Build ja käynnistys samalla komennolla:

```bash
pnpm --filter @eky/backend dev
```

## Health endpoint

Kun backend on käynnissä, tarkista health endpoint:

```bash
curl http://127.0.0.1:3000/health
```

Vastaus:

```json
{ "status": "ok" }
```

Jos vaihdat portin `.env`-tiedostossa, käytä curl-komennossa samaa porttia.

## Rajaukset

Hono kuuluu vain backendin HTTP-adapterikerrokseen.

Hono ei saa vuotaa:

- domain-kerrokseen
- application service -logiikkaan
- repository-rajapintoihin
- `packages/*`-paketteihin

Tässä vaiheessa backendissä ei vielä ole asiakashallintaa, laskutusta, tietokantaa, autentikointia, synkronointia tai audit logia.
