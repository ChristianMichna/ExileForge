# @exileforge/agents

Die Planungsstufen von ExileForge als kleine, einzeln geprüfte Aufgaben
(keine Single-Shot-Prompts). Jede Stufe liefert eine `TaskSpec`: Anweisung,
Kontext, Antwortschema, erlaubte Werkzeuge und Prüfungen. Die Schleife
(`forge_attach/next/submit`) läuft in `apps/server`.

## Stand

| Stufe | Inhalt | Status |
|---|---|---|
| S0 | Hauptskill aus der Idee bestimmen (nur ohne `mainSkillId`) | fertig |
| S1 | Skill-Profil: `profileBase` rechnet der Server aus dem Katalog, `profileTask` ergänzt die KI | fertig |
| S2 | Archetyp-Kandidaten, eine Aufgabe je Kandidat | fertig |
| S3 | Skelett-Build je Kandidat, Baum per Optimierer, Messung mit PoB; läuft als Hintergrund-Job (`PlanStep` `job`) über den `SkeletonPort`; ohne PoB-Engine endet der Lauf mit `skeleton_unavailable` | fertig, im Server noch nicht verdrahtet |
| S4–S10 | brauchen Auswahl-Stufe, Crafting-Sim, Economy | Pipeline endet mit `stage_not_implemented` |

S3-Grenzen: Das Skelett hat keine Items und keine Ascendancy-Knoten (Kandidaten
mit gleicher Klasse und anderer Ascendancy werden gleich gemessen), und eine
unvollständige Optimierung wird nur geloggt. Jobs haben noch kein Zeitlimit und
keinen Abbruch.

## Regeln

- Keine Zahlen im Text; Zahlen kommen per `calcRef`.
- Entitäten nur mit Katalog-ID (G1, vom Server geprüft).
- Schwellen, Gem-Arten und Kandidatenzahl stehen in `config/agents/stages.json`.
- Prompts enthalten kein Spielwissen aus dem Modellgedächtnis.

`createForgePipeline(config)` liefert die Pipeline mit der ID `forge`.
