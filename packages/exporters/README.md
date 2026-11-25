# @astrolabe/exporters

Exporte eines veröffentlichten Guides (`PublishedGuide`).

| Export | Stand |
|---|---|
| Markdown (`guideToMarkdown`) | fertig; Namen und Zahlen kommen über `MarkdownResolvers` (Katalog, gespeicherte Berechnungen). Nicht auflösbare Referenzen lassen den Export mit allen Fundstellen fehlschlagen. |
| `.build` (In-Game-Planner) | offen: braucht die Spiel-IDs der Passive (PassiveSkills.Id) und Slots (Inventories-Id), die der Katalog nicht hat |
| PoB-Code je Stufe | offen |
