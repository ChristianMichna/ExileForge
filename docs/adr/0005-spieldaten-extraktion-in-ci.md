# ADR-0005: Spieldaten-Extraktion nur in CI, begrenzt auf Crafting- und Levelkennzahlen

- Status: **angenommen** (Christian, 2026-11-25: „ja passt" auf die Freigabe, Spieldateien für
  Crafting-Daten zu lesen; Ergänzung 2026-11-25 per Entscheidungskarte: Zielstufe und nutzbare
  Passivpunkte pro Release aus Spieldaten)
- Datum: 2026-11-25
- Konkretisiert: Rang 2 der Quellen im Projektplan („Eigene Offline-Extraktion")

## Kontext

PoB führt keine Crafting-Währungen, Essenzen und Omens mit stabilen IDs, und die Maximalstufe
steht nicht in PoB-Daten. Der Katalog braucht beides (Crafting-Simulator, `economy.price`, S5).

## Entscheidung

- Die Extraktion läuft **nur in GitHub Actions** (Schritt „Game data" in `data-snapshot.yml`),
  mit `pathofexile-dat` 16.0.1 (MIT) und dem Community-Schema `dat-schema`. Nie beim Nutzer,
  nie im ausgelieferten Produkt, keine Interaktion mit dem Spielclient des Nutzers.
- Gelesen werden nur die in `config/data-pipeline/game-data.json` aufgeführten Tabellen:
  Crafting-Daten (Währungen, Essenzen, Omens, Tausch-Kategorien), die Basis-Tabellen
  `BaseItemTypes` und `ItemClasses` (nötig, um Währungs-IDs und Namen aufzulösen; alle Zeilen,
  weil Fremdschlüssel auf Zeilen verweisen) und `ExperienceLevels` (Maximalstufe).
- Der Export hält Patch-Version, Werkzeugversion und Hash des Schemas im Manifest fest. Fehlende
  optionale Tabellen werden dort vermerkt, alles andere bricht ab.
- Aus den Rohtabellen wird ein Katalogeintrag erst nach einem Vertrags-PR; die Rohtabellen
  werden nicht veröffentlicht.

## Bekannte Grenzen

- Das Schema ist „latest" und wird vom Werkzeug bei jedem Tabellenlauf neu geladen; der
  gespeicherte Hash belegt das Schema zum Zeitpunkt des Manifests, nicht jeden Einzellauf.
  Spalten- und `_index`-Prüfungen fangen Abweichungen ab.
- Die Bundle-Downloads des Werkzeugs nutzen dessen Standard-User-Agent; sie laufen nur auf
  dem CI-Runner und sind selten. Ein eigener Loader mit identifizierbarem User-Agent ist ein
  Folgeticket.

## Verworfen

- Extraktion beim Nutzer (widerspricht CLAUDE.md: keine Interaktion mit Spieldateien beim Nutzer).
- Namen aus dem Modellgedächtnis (widerspricht den harten Regeln).
