# Entwurf: Spiel-IDs für den .build-Export (Passive, Slots)

Status: **Entwurf, nicht freigegeben.** Es wird nichts gelesen und nichts gebaut, bis Christian
die zwei Tabellen freigibt (Stand 25.11.2026: Freigabe gilt nur für Crafting-Daten und die
Stufentabelle, ADR-0005). Der Entwurf soll nach der Freigabe sofort umsetzbar sein.

## Bedarf

Der `.build`-Export (architecture.md 3.5) braucht je Passiv-Knoten die String-ID des Spiels
(z. B. `strength89`), je Gem den BaseItemTypes-Pfad und je Ausrüstungsplatz die Inventory-ID
(z. B. `Weapon1`).

## Was PoB schon liefert (geprüft in PoB 0.23.1)

| Bedarf           | In PoB-Daten?                                                                                                                                                  | Beleg                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Gem-ID           | ja, Katalog-ID jedes Gems ist PoBs `gameId`                                                                                                                    | `Data/Gems.lua` (`gameId = "Metadata/Items/Gems/…"`) |
| Passiv-String-ID | nein, nur die numerische Knoten-ID (`skill`, im Katalog `pobNodeId`); Ausnahme: `aliasPassiveSocket` bei einzelnen Juwelsockeln (kann zur Gegenprüfung dienen) | `TreeData/*/tree.lua`                                |
| Slot-ID          | nein, PoB nennt Slots `Weapon 1`, `Ring 1` …                                                                                                                   | `Classes/ItemsTab.lua` (`baseSlots`)                 |

PoBs Export-Skript (`Export/Scripts/passivetree.lua`) zeigt, woher die numerische ID kommt:
`PassiveSkills` wird über die Spalte `PassiveSkillNodeId` gleich der Knoten-`skill` gelesen
(`dat("passiveskills"):GetRow("PassiveSkillNodeId", passive.id)`). Die String-ID steht in
derselben Zeile (`Id`).

## Vorschlag

1. **Konfiguration** `config/data-pipeline/game-data.json`: zwei Tabellen ergänzen.
   - `PassiveSkills`: Spalten `Id`, `PassiveSkillNodeId`, `Name` (Name nur zur Gegenprüfung).
   - `Inventories`: Spalte `Id`. Die Zuordnung zu PoBs Slot-Namen braucht eine Spalte oder
     Regel, die PoB selbst kennt; sie wird beim ersten Lauf aus den Tabellendaten festgelegt,
     nicht aus Namen geraten (offen, siehe unten).
2. **Vertrag (eigener PR, additiv)**: `PassiveNode.gameId` (optional, String; Name wie in
   data-model.md `ggId` oder `gameId`, eine Variante wählen und data-model.md nachziehen) und
   `DataRelease.itemSlots.slots[].gameId` (optional). Gems brauchen nichts (ID ist schon der Pfad).
3. **Pipeline**: Knoten über `pobNodeId == PassiveSkillNodeId` verbinden; `Name` der Zeile muss
   mit dem PoB-Namen übereinstimmen (PoB schreibt `escapeGGGString(Name)`; vor dem Vergleich gleich
   normalisieren), sonst Finding statt Zuordnung. Tabellenzeilen ohne PoB-Knoten (leerer Name,
   `[DNT]`-Zeilen, die PoB überspringt) sind kein Fehler. Kein Treffer, doppelte
   Treffer oder abweichender Name: Feld bleibt leer und zählt in der Zusammenfassung
   (`passivesWithoutGameId`), nichts wird erfunden.
4. **Validierung**: `gameId` eindeutig je Release (G1-Prüfung in `validateCatalog`).
5. **Herkunft**: `ItemSlots` hat nur ein `origin` für die ganze Struktur (heute PoB), `PassiveNode`
   keines je Feld. Der Vertrags-PR muss klären, wo die Herkunft `game-data` der neuen Felder
   steht (eigenes `origin` neben `gameId` oder ein eigener Release-Fakt); `sourceHashes` deckt
   die gelesenen Tabellen.
6. **Tests**: Fixture-Tabellen (Fantasie-IDs), Fälle: Treffer, kein Treffer, doppelter Treffer,
   Namensabweichung, Tabelle fehlt (Pflicht-Tabelle: Abbruch mit Fehler).

## Offene Fragen

- Wie die Inventory-Zeilen den PoB-Slot-Namen zugeordnet werden (Spalten der Tabelle). Das
  klärt der erste Probelauf im Snapshot-Workflow (nur Ausgabe im Log, keine Veröffentlichung),
  analog zum Vorgehen bei den Währungstabellen.
- Ob alle Knotenarten (Ascendancy, Mastery) im `.build`-Format gebraucht werden oder nur
  allokierbare Knoten.
- Ob PoBs Gem-Pfad exakt dem BaseItemTypes-Pfad im Spiel entspricht (Test im Spiel, oder
  Abgleich mit `BaseItemTypes.Id`, die bereits gelesen wird).

## Ablauf nach der Freigabe

Vertrags-PR, dann Pipeline-PR mit Konfiguration, Probelauf im Snapshot-Workflow, Release.
Die Feature-ID (F-01 oder eigene für den .build-Export) legt der Coordinator fest. Geschätzt zwei kleine PRs, ohne Änderung am Rest der Pipeline.
