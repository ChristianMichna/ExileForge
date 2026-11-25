---
name: tdd-workflow
description: Testgetriebene Entwicklung in Astrolabe mit Vitest – erst fehlschlagender Test, dann minimale Umsetzung, dann Aufräumen; mit den Testebenen des Projektplans (Unit, Vertrag, Calc-Golden, Daten, Simulator-Property-Tests, Exporte, Halluzinations-Tests) und den Fakes calc-fake und llm-replay. Verwenden bei neuer Kernlogik und bei jedem Bugfix.
---

<!-- Adaptiert aus everything-claude-code (skills/tdd-workflow),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Stark gekürzt; an die Testebenen aus docs/projektplan.md angepasst. -->

# TDD in Astrolabe

## Zyklus

1. **Rot**: Test schreiben, der das gewünschte Verhalten (ein
   Akzeptanzkriterium des Tickets) beschreibt. Laufen lassen und sehen, dass
   er **aus dem richtigen Grund** fehlschlägt.
2. **Grün**: kleinste Änderung, die den Test bestehen lässt.
3. **Aufräumen**: Struktur verbessern, Tests bleiben grün.
4. Bei Bugfix: zuerst ein Test, der den Bug nachstellt.

Nur betroffene Tests erneut laufen lassen
(`pnpm --filter <paket> test -- <datei>`); die ganze Suite erst vor dem PR
(Skill `verification-loop`).

## Woher Testdaten kommen

**Kein Spielwissen aus dem Modellgedächtnis.** Erlaubt sind nur:

| Quelle | Wofür |
|---|---|
| Fixtures, **aus einem Daten-Release erzeugt** (Release-ID im Pfad/Kopf) | Katalog-Entitäten, IDs, Mods, Gems |
| Aufgezeichnete PoB-Ergebnisse (`evals/golden`, PoB-Version im Namen) | Erwartete Zahlen |
| `calc-fake` | Logiktests ohne PoB; deterministische, erkennbar fiktive Werte |
| `llm-replay` | Aufgezeichnete LLM-Antworten für Pipeline-Tests |

Keine echten LLM-Aufrufe und kein Netz in der Testsuite.

## Testebenen

| Ebene | Was | Werkzeug |
|---|---|---|
| Unit | Normalisierer, Optimierer-Bausteine, Exporter, Gates, Zahlen-Linter | Vitest, `it.each` |
| Vertrag | Schnittstellen gegen das Vertragspaket; generierte Clients kompilieren | Zod/JSON Schema, `tsc`, Schema-Snapshots |
| Calc-Golden | Referenz-Builds je PoB-Version mit Toleranz je Metrik | Runner in `evals/golden` |
| Daten | Referenzielle Integrität, Plausibilität, Diff je Daten-Release | Pipeline-Checks |
| Simulator | Invarianten (Prefix/Suffix-Grenzen, Familien-Ausschluss, kein Mod außerhalb des Pools); analytisch rechenbare Einfachfälle; fester Seed | fast-check |
| Exporte | `.build` gegen Format-Schema; PoB-Code-Roundtrip `decode(encode(x)) = x` | Vitest |
| Halluzination | PoE1-Begriffe, entfernte oder erfundene Items als Eingabe → werden abgelehnt/korrigiert (G1) | `llm-replay` + Gates |
| End-to-End | Kern-Journeys inkl. Mobilansicht | Playwright (sobald UI existiert) |

## Golden-Tests gegen PoB

- Erwartung: **von PoB erzeugte** Werte, nie von Hand geschrieben.
- Neu aufzeichnen nur bewusst (eigenes Skript), mit Diff und Begründung im
  PR (PoB-Bump, Bridge-Fix).
- Tests, die LuaJIT/PoB brauchen, mit `describe.skipIf(!hasPob)` kennzeichnen
  und im Bericht als übersprungen melden – nicht stillschweigend grün.

## Regeln

- Tests prüfen Verhalten, nicht Implementierungsdetails.
- Keine Tests deaktivieren oder Erwartungen „passend machen". Fehlschlag
  verstehen, dann beheben.
- Schwellen und Toleranzen aus `config/`, nicht im Test hart codiert.
- Zufall (Seeds) und Zeit (`fetchedAt`) fixieren.
- Eval-Kennzahlen dürfen sich durch einen PR nicht verschlechtern.
