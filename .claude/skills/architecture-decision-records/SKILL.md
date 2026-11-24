---
name: architecture-decision-records
description: Hält Architekturentscheidungen von ExileForge als nummerierte ADRs in docs/adr/ fest (Kontext, Entscheidung, verworfene Alternativen, Folgen) und pflegt den Index. Verwenden, wenn zwischen Bibliotheken, Formaten oder Abläufen entschieden wird, eine ⚠-Annahme aus docs/architecture.md geklärt ist, oder jemand fragt, warum etwas so gebaut ist.
---

<!-- Adaptiert aus everything-claude-code (skills/architecture-decision-records),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md. -->

# Architekturentscheidungen (ADR)

`docs/architecture.md` beschreibt den aktuellen Stand; ADRs halten fest,
**warum** etwas so entschieden wurde. Besonders wichtig in ExileForge, weil
viele Punkte als „⚠ Annahme" starten (PoB headless, `.build`-Format,
Mod-Gewichte, Preisquelle, Tree-Icons, Verteilung/Abo-Regeln).

## Wann

- Wahl zwischen echten Alternativen (Bibliothek, Format, Prozessmodell).
- Eine ⚠-Annahme wurde durch einen Proof of Concept bestätigt oder
  widerlegt.
- Eine harte Regel aus `CLAUDE.md` wird präzisiert.
- Frage „Warum ist das so?" → erst `docs/adr/README.md` lesen.

Nicht für Kleinkram (Namen, Formatierung).

## Format

Datei `docs/adr/NNNN-kurzer-titel.md`, Deutsch, in 2 Minuten lesbar:

```markdown
# ADR-NNNN: Titel

**Datum**: JJJJ-MM-TT
**Status**: vorgeschlagen | angenommen | abgelöst durch ADR-NNNN | verworfen
**Beteiligt**: Christian, Claude

## Kontext
2–5 Sätze: Problem, Zwänge, Bezug zu docs/architecture.md §…

## Entscheidung
1–3 Sätze, Präsens („Wir nutzen …").

## Verworfene Alternativen
### Alternative: Name
- Pro: …
- Contra: …
- Warum nicht: …

## Folgen
- Positiv: …
- Negativ: …
- Risiken und Gegenmaßnahmen: …
- Belege: Links zu PoC, Messwerten, Quellen
```

## Ablauf

1. Gibt es `docs/adr/` nicht: Ordner mit `README.md` (Index) und
   `template.md` anlegen – das ist Teil des PRs, in dem die erste ADR kommt.
2. Nächste Nummer aus dem Index ableiten.
3. ADR als `vorgeschlagen` im selben PR wie die betroffene Änderung
   schreiben; Christian nimmt sie mit dem Merge an (Status dann
   `angenommen`).
4. Index ergänzen:

   ```markdown
   | ADR | Titel | Status | Datum |
   |-----|-------|--------|-------|
   | [0001](0001-pob-headless-bridge.md) | PoB-PoE2 headless über bridge.lua | angenommen | 2026-11-30 |
   ```

5. Betroffene Stelle in `docs/architecture.md` aktualisieren und auf die ADR
   verlinken; erledigte ⚠-Markierung entfernen.

## Regeln

- Verworfene Alternativen immer nennen; „einfach so" ist keine Begründung.
- Abgelöste ADRs nicht löschen, sondern auf die neue verweisen.
- Nachträglich erfasste Entscheidungen mit dem ursprünglichen Datum
  kennzeichnen.
