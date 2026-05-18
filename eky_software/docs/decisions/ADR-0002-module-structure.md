# ADR-0002: Moduulirakenne ja dokumentaation jako

## Tila

Hyväksytty alustavasti.

## Päätös

Eky-projektissa käytetään dokumentoitua moduulirakennetta ja kerrosjakoa.

Dokumentaatio jaetaan seuraaviin alueisiin:

- `docs/ai`
- `docs/architecture`
- `docs/product`
- `docs/modules`
- `docs/decisions`

Koodirakenne tarkentuu myöhemmin, mutta alustava suunta on erottaa sovellukset ja sisäiset paketit.

## Konteksti

Projektia tehdään AI-avusteisesti.

Jotta AI ei riko arkkitehtuuria, sen pitää ymmärtää:

- miten projektissa työskennellään
- mikä kuuluu mihinkin moduuliin
- mitkä ovat turvallisuussäännöt
- mitä liiketoimintatermit tarkoittavat
- miten riippuvuuksia saa käyttää

## Päätetty dokumentaatiorakenne

Alustava dokumentaatiorakenne:

- `AGENTS.md`
- `docs/ai/workflow.md`
- `docs/ai/coding-rules.md`
- `docs/ai/testing-rules.md`
- `docs/ai/review-checklist.md`
- `docs/ai/prompt-guidelines.md`
- `docs/architecture/base-architecture.md`
- `docs/architecture/module-boundaries.md`
- `docs/architecture/dependency-policy.md`
- `docs/architecture/security-principles.md`
- `docs/architecture/tech-decisions.md`
- `docs/architecture/data-model-principles.md`
- `docs/product/business-context.md`
- `docs/product/glossary.md`
- `docs/product/user-roles.md`
- `docs/product/workflows.md`
- `docs/modules/`
- `docs/decisions/`

## Alustava koodirakenne

Alustava suunta:

- `apps/web`
- `apps/backend`
- `packages/domain`
- `packages/validation`
- `packages/api-client`
- `packages/auth`
- `packages/permissions`
- `packages/ui`
- `packages/config`

Tarkka rakenne päätetään teknisen aloituksen yhteydessä.

`packages/utils` ei kuulu ensimmäiseen skeleton-rakenteeseen. Se voidaan lisätä myöhemmin vain erillisellä päätöksellä ja tarkasti rajatulla vastuulla.

## Perustelut

Rakenne valitaan, koska:

- AI tarvitsee selkeät ohjeet
- dokumentaatio ei saa olla yhdessä valtavassa tiedostossa
- jokaisella dokumentilla pitää olla oma vastuu
- moduulirajat pitää pystyä tarkistamaan
- turvallisuus pitää olla näkyvästi mukana
- projektia pitää voida kasvattaa hallitusti

## Seuraukset

`AGENTS.md` toimii porttitiedostona.

Yksityiskohtaiset säännöt pidetään omissa dokumenteissaan.

Sama sääntö pyritään määrittelemään vain yhdessä paikassa.

Jos dokumentaatio alkaa toistaa itseään, sitä tiivistetään ja vastuutetaan uudelleen.

## Avoimet asiat

- lopullinen monorepo-työkalu
- lopullinen backend-kansiorakenne
- moduulikohtaiset `AGENTS.md`-tiedostot
- domain-pakettien tarkka jako
