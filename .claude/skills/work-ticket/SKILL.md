---
name: work-ticket
description: Schreibt oder prüft ein Arbeitspaket für Astrolabe im Ticket-Format des Projektplans – Ziel, betroffene Pakete, Vertrags-Referenzen, prüfbare Akzeptanzkriterien, Testanforderungen, Feature-ID (F-xx), Workstream (WS0–WS9). Verwenden beim Anlegen eines Issues, beim Zerlegen einer Aufgabe in Arbeitspakete und als Gerüst für PR-Beschreibungen.
---

<!-- Eigenentwicklung für Astrolabe nach Projektplan 1.0
     („Umsetzung durch den Agent-Swarm"). -->

# Arbeitspaket (Ticket)

Jede Aufgabe, die ein Agent übernimmt, ist ein Ticket in diesem Format. Der
`pr-acceptance-reviewer` prüft den PR genau gegen diese Punkte.

## Vorlage

```markdown
## F-xx · WSn · Kurztitel

**Ziel:** ein bis zwei Sätze, welches Nutzer- oder Systemergebnis entsteht.

**Pakete:** `packages/…` (ein Paket; mehrere nur bei Vertragsänderung)

**Verträge:** welche Schemas aus dem Vertragspaket gelesen/geändert werden.
Änderung nötig? → zuerst eigener Vertrags-PR (Skill `contract-first`).

**Akzeptanzkriterien:**
- [ ] prüfbar, mit Eingabe → erwartetem Ergebnis
- [ ] Fehlerfall: … liefert Fehler X statt Ersatzwert
- [ ] Zahlen nur aus Calc (`calcRef`), Entitäten nur als Katalog-ID

**Tests:** Unit/Vertrag/Golden/Property/E2E – welche, gegen welche
Fixtures oder Fakes (`calc-fake`, `llm-replay`).

**Abhängigkeiten:** andere Tickets/Workstreams; bis fertig gegen Fakes.

**Nicht im Umfang:** …
```

## Gute Akzeptanzkriterien

- Beobachtbar und ohne Interpretation prüfbar („`calc.stats` liefert für
  Golden Build #3 alle Felder des Vertrags `CalcStats`").
- Keine Spielwerte aus dem Gedächtnis („Leben ≥ 3000" ist verboten; Schwellen
  kommen aus `config/`).
- Mindestens ein Fehler- oder Grenzfall.
- Bezug zu Gates (G1–G8), wenn das Ticket Guide-Inhalte betrifft.

## Zerlegen

- Ein Ticket = ein Paket = ein PR, in ein bis zwei Tagen Agentenarbeit
  machbar.
- Vertragsarbeit (WS0) vor Implementierung; Implementierungen gegen Fakes
  starten, Integration als eigenes Ticket.
- Feature-IDs und Workstreams aus `docs/projektplan.md` verwenden, keine
  neuen erfinden; fehlt eins, nachfragen.

## PR-Beschreibung

Gleiche Gliederung; Akzeptanzkriterien mit Belegen abhaken (Test, Datei:Zeile,
Ausgabe). Feature-ID in Titel und Commit (`F-04: …`).
