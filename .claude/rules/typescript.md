---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

<!-- Verdichtet aus everything-claude-code (rules/typescript/*.md),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md. -->

# TypeScript-Regeln für ExileForge

- `strict: true`; Lockerungen nur mit Kommentar und ADR.
- Exportierte Funktionen mit Parameter- und Rückgabetypen; lokale Typen
  inferieren lassen.
- `interface` für erweiterbare Objektformen, `type` für Unions/Utility-Typen;
  String-Literal-Unions statt `enum`.
- Kein `any`. Externe Daten sind `unknown` und werden per Schema validiert
  (IPC, MCP, PoB-Worker, Netz, KI-Antwort).
- Typen für das Build-Modell kommen aus `packages/schema` (generiert), nicht
  von Hand dupliziert.
- Unveränderlich arbeiten: neue Objekte statt Mutation; Build-Änderung =
  neue Revision.
- Fehler: `throw new Error(msg, { cause })`; keine leeren `catch`; keine
  Ersatzwerte für Spielzahlen.
- Async: kein `forEach(async …)`, keine fliegenden Promises, Timeouts für
  Kindprozesse und Netz.
- Kindprozesse nur mit `spawn`/`execFile` und Argument-Array.
- Kein `console.log` im Produktivcode; Logger mit Kontext (Build-ID, Stufe,
  PoB-Version).
- Benannte Konstanten statt magischer Zahlen; Spielregel-Konstanten mit
  Quelle und Spielversion.
- React: Funktionskomponenten, Hooks-Regeln, stabile `key`s, nur
  Design-Tokens.
