# @astrolabe/revalidate

Patch-Revalidierung (F-19): prüft einen gespeicherten Guide gegen die Diffs neuerer Daten-Releases
und liefert einen `PatchStatus` (Vertrag in `@astrolabe/contracts`, 0.13.0).

- `collectGuideRefs(guide)` findet jede Katalog-Referenz eines `GuideDocument` samt JSON-Pointer und
  Stufe (`ProgressionStage.key`). Gefunden werden `{ kind, id }`-Objekte (Rich-Text-Segmente,
  Item-Specs) und Felder mit Katalog-IDs nach Feldname (`gemId`, `modId`, `allocationOrder` …).
  Keine Katalog-IDs sind `StatId` und Klassifikations-IDs; sie fehlen bewusst.
- `revalidateGuide({ guide, diffs, facts, checkedAt })` setzt die Diffs der Kette (vom Release des
  Guides bis zum geprüften) der Reihe nach zusammen: `before` vom ersten, `after` vom letzten
  Release, sich aufhebende Änderungen entfallen, entfernt und wieder hinzugefügt zählt als
  `changed` für die ganze Entität (`path: "/"`). Dazu kommen geänderte Release-Fakten (PoB-Version,
  Max-Level, Passivpunkte, Slots, Seltenheiten, Klassifikationen). Das Urteil leitet der Vertrag
  aus den Befunden ab.
- Passt die Kette nicht zum Guide (falscher Start, Lücke, leere Liste), wirft `RevalidationError`.
  Es gibt dann kein `unaffected`.

Nicht Teil dieses Pakets: Diffs und Release-Fakten laden (Server), Ersatzkandidaten für entfernte
Entitäten, Anzeige in der UI. Bekannte Grenze: Eine reine Umbenennung ohne ID-Wechsel ist `changed`.
