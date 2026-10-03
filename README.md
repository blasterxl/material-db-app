# Materiálová databáza

Lokálna webappka na správu `databaza_materialov.json`.

## Spustenie

```powershell
node server.js
```

Potom otvor:

```text
http://localhost:4177
```

## JSON kontrakt

Hlavný súbor je `../databaza_materialov.json`. Každý materiál má základné polia:

```text
nazov, interny_kod, poradove_cislo, skratka, EAN_QR, merna_jednotka
```

A vlastnosti pre správu a integráciu:

```text
oblubeny, nedostupny, vyradeny, archivovany, skryty, skupiny, tagy, poznamka, updatedAt
```

Endpoint pre budúce zvýraznenie vo FaxCopy:

```text
http://localhost:4177/api/favorites
```

## Bezpečnosť pri zmenách

Pri každom zápise sa vytvorí záloha v `../zalohy_material_db_app`. Mazanie vyžaduje potvrdenie a posledné zmeny sa dajú vrátiť cez Undo počas behu servera.
