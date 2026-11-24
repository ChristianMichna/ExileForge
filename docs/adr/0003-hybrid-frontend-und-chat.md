# ADR-0003: Hybrid – eigenes Frontend, KI-Schritte im Claude-Chat, geführt in kleinen Schritten

- Status: **angenommen** (Christian, 2026-11-24: „A klingt gut, aber eine etwas
  tiefere Integration wäre gut. Bitte keine Single-Shot-Prompts.")
- Datum: 2026-11-24
- Baut auf: [ADR-0001](0001-web-app-und-remote-mcp.md) (Web-App + Remote-MCP),
  [ADR-0002](0002-claude-abo-nur-ueber-connector.md) (Abo nur über Connector,
  Pipeline S0–S10 als Zustandsmaschine)

**⚠ Annahme** markiert ungeprüfte Punkte, die der Proof of Concept klären muss.

## Kontext

Christian will ein **eigenes Frontend** und nicht „alles im Claude-Chat".
Gleichzeitig soll die KI mit dem **eigenen Claude-Abo** jedes Freundes laufen.
Ein eigenes Frontend, das Claude direkt mit dem Abo der Nutzer anspricht, ist
nach Anthropics Bedingungen ohne vorherige Genehmigung nicht erlaubt. Christian
hat sich deshalb für den Hybrid entschieden und ausdrücklich **gegen
Single-Shot-Prompts** (ein großer Auftrag, eine große Antwort).

## Entscheidung

1. **Das Frontend ist der Ort, an dem der Nutzer arbeitet.** Intake, Auswahl,
   Eingriffe, Fortschritt, Guide, Export und Patch-Bericht passieren dort.
2. **Der Claude-Chat ist nur der Motor** für die LLM-Stufen. Er wird aus dem
   Frontend gestartet und arbeitet über den ExileForge-Remote-Connector.
3. **ExileForge führt, Claude arbeitet kleine Aufgaben ab.** Jede LLM-Stufe der
   Pipeline wird in viele kleine Aufgaben zerlegt. Claude bekommt nie den ganzen
   Build-Auftrag auf einmal.
4. **Jede Abgabe wird sofort mit PoB und den Gates geprüft.** Fehler gehen als
   konkreter Befund zurück; Claude korrigiert, bis die Aufgabe grün ist.
5. **Der Nutzer kann jederzeit im Frontend eingreifen**, und Claude bekommt den
   Eingriff bei der nächsten Aufgabe mit.

## 1. Betrieb: gehostet

Gehostet, wie in ADR-0001: Next.js-Frontend, API, Calc-Service und
MCP-Server auf einem Server. Der Grund ist zwingend: claude.ai im Browser kann
nur Connectors erreichen, die im Internet erreichbar sind. Ein lokaler Modus
(F-21) kann später dieselbe Schnittstelle über `localhost` bedienen
(Claude Desktop / Claude Code), ändert an diesem Entwurf aber nichts.

## 2. Connector: Transport und Anmeldung

- **Transport:** MCP über Streamable HTTP, ein Endpunkt `https://<host>/mcp`.
- **Anmeldung:** Der Nutzer hat ein **ExileForge-Konto** (eigener Login, z. B.
  E-Mail-Link oder Discord). Beim Eintragen des Connectors in claude.ai läuft
  der OAuth-Ablauf der MCP-Spezifikation: Claude leitet auf die
  ExileForge-Anmeldeseite, der Nutzer bestätigt, Claude erhält ein
  ExileForge-Zugriffstoken. Damit weiß ExileForge, **welcher ExileForge-Nutzer**
  hinter einem Werkzeugaufruf steht.
- ExileForge bekommt dabei **nie** Claude-Zugangsdaten zu sehen; das Token gilt
  nur für ExileForge.
- **⚠ Annahme:** claude.ai-Custom-Connectors unterstützen OAuth für Remote-MCP
  (laut Anthropic-Hilfe ja; im PoC mit echtem Konto prüfen). Rückfall:
  persönlicher Connector-Link mit geheimem Token in der URL.

## 3. Verknüpfung Frontend ⇄ Chat

### Start

1. Nutzer füllt im Frontend den Intake aus (S0) und klickt
   **„Mit Claude planen"**.
2. Der Server legt einen Pipeline-Lauf an (`runId`) und erzeugt einen kurzen
   **Sitzungscode** (z. B. `7F3K-QX`), 30 Minuten gültig.
3. Das Frontend öffnet Claude in einem neuen Tab mit einem vorausgefüllten
   Startsatz: „Starte ExileForge-Sitzung 7F3K-QX." und zeigt daneben einen
   Kopieren-Knopf.
   **⚠ Annahme:** claude.ai nimmt einen vorausgefüllten Prompt per URL an
   (`claude.ai/new?q=…`). Falls nicht: nur Kopieren-Knopf.
4. Claude ruft `forge.attach(code)` auf. Der Server prüft, dass Code und
   angemeldeter Connector-Nutzer zusammenpassen, und gibt die erste Aufgabe.
   Ein mitgelieferter MCP-Prompt (`/exileforge`) und die Werkzeugbeschreibungen
   sagen Claude, dass es die Schleife bis `done` fortsetzen soll.

### Arbeitsschleife

```
Claude                         ExileForge                       Frontend
  │ forge.next(runId) ───────▶ nächste Aufgabe + Kontext         Schritt "S5.3 läuft"
  │                            + Antwortschema + Feedback
  │ (denkt, nutzt Lese-/Rechen-Werkzeuge: calc.eval, catalog.search …)
  │ forge.submit(task, payload) ▶ Schema + PoB + Gates
  │ ◀── ok → nächste Aufgabe     │                              Zahlen/Tree live
  │ ◀── Befund → gleiche Aufgabe │                              "Korrektur 1/3"
  │ …                            │
  │ ◀── wait_user(frage) ────────┼────────────────────────────▶ Karte mit Frage
  │ forge.next (blockiert bis Antwort, max. ~60 s, dann "noch warten")
  │ ◀── done                     │                              Guide fertig
```

- **Werkzeuge der Führung:** `forge.attach`, `forge.next`, `forge.submit`,
  `forge.status`. Daneben die normalen Lese-/Rechenwerkzeuge (Katalog, `calc.*`,
  Optimierer, Preise), die Claude innerhalb einer Aufgabe frei nutzen darf.
- **Live-Status:** Der Server schickt jeden Zustandswechsel per Server-Sent
  Events an das Frontend (aktuelle Aufgabe, Abgaben, PoB-Zahlen, Befunde,
  Korrekturzähler).
- **Eingriffe im Frontend** (Variante wählen, Knoten/Items sperren oder
  ablehnen, „mehr Defensive", Stufe neu machen, Pause) landen in einer
  **Feedback-Warteschlange** des Laufs. Der Server baut sie in die nächste
  Aufgabe ein oder verwirft bereits abgegebene Ergebnisse, wenn der Eingriff sie
  ungültig macht.
- **Rückfragen von Claude** sind keine Chat-Fragen, sondern Aufgaben vom Typ
  `ask_user`: Claude formuliert die Frage per `forge.submit`, das Frontend zeigt
  sie als Karte, die Antwort kommt als Feedback zurück. So bleibt der Nutzer im
  Frontend.
- **Unterbrechung:** Endet Claudes Antwort, bevor `done` erreicht ist (Länge
  einer Antwort, Abo-Limit, Tab geschlossen), bleibt der Lauf auf dem Server
  stehen. Das Frontend zeigt „Pausiert – im Claude-Chat ‚weiter' schreiben"
  mit Link zum Chat. Mit derselben Sitzung oder einem neuen Code geht es an
  genau der Stelle weiter.
  **⚠ Annahme:** Wie viele Werkzeugaufrufe Claude in einer Antwort am Stück
  macht, messen wir im PoC. Ziel: ein Guide in wenigen „weiter".

## 4. Zerlegung der Pipeline in Aufgaben

Grundsatz: **Was deterministisch geht, rechnet der Server ohne Claude.** Claude
bekommt nur Aufgaben, die Urteil oder Text brauchen, und jede Aufgabe hat genau
ein kleines Antwortschema.

| Stufe | Wer | Aufgaben an Claude (je eine `forge.next`-Runde) |
| --- | --- | --- |
| S0 Intake | Frontend | – (Freitext-Normalisierung als 1 Aufgabe, falls nötig) |
| S1 Mechanik-Analyse | Server + Claude | 1 Aufgabe: Skalierungsideen und Synergien zum vorberechneten `SkillProfile` ergänzen |
| S2 Archetypen | Claude | 1 Aufgabe je Kandidat (3–6), danach 1 Aufgabe „Kandidaten gegeneinander abgrenzen" |
| S3 Schnellbewertung | Server | – (PoB rechnet Skelette, Matrix ins Frontend) |
| S4 Auswahl | **Nutzer im Frontend** | – (Claude wartet per `forge.next`) |
| S5 Ziel-Build | Claude + Optimierer | Schleife: Ascendancy → Gem-Setup → Tree-Schwerpunkte → Gear-Profile je Slot; jede Runde ein Teil, sofort G1–G5; Befund geht an genau diesen Teil |
| S6 Progression | Optimierer + Claude | 1 Aufgabe je Stufe (≥ 10): Leveling-Skills, Gem-Wechsel, Begründung; Tree-Delta macht der Optimierer, Claude prüft/ändert Schwerpunkte |
| S7 Gear & Budget | Server | – (Economy + Regeln); optional 1 Aufgabe für Erklärtexte |
| S8 Crafting | Planer + Claude | 1 Aufgabe je Rare-Slot: Methode wählen; Wahrscheinlichkeiten/Kosten rechnet der Crafting-Planer |
| S9 Autorenschaft | Claude | 1 Aufgabe je Guide-Abschnitt; Zahlen nur als Platzhalter |
| S10 Validierung | Gates + Claude | Gates deterministisch; 1 `critic`-Aufgabe je Phase; Befunde gehen an die verursachende Stufe zurück |

Grob 40–80 kleine Aufgaben pro Guide statt eines großen Prompts.
**⚠ Annahme**, im PoC messen; davon hängt ab, wie stark das Abo-Kontingent
belastet wird.

### Aufbau einer Aufgabe

```jsonc
{
  "task": "S5.gems",              // Stufe.Teil
  "attempt": 2,                    // Korrekturrunde
  "instructions": "…",            // aus packages/agents/prompts, kurz
  "context": { … },                // nur was diese Aufgabe braucht (IDs, PoB-Zahlen)
  "feedback": [ … ],               // Nutzer-Eingriffe seit der letzten Aufgabe
  "findings": [ … ],               // Gate-/PoB-Befunde der letzten Abgabe
  "schema": { … },                 // JSON Schema der erwarteten Abgabe
  "allowedTools": ["catalog.searchGems", "calc.eval"]
}
```

Gleiches Format für Modus A (BYOK): Dort führt das `llm-gateway` dieselben
Aufgaben serverseitig aus. Die Pipeline merkt keinen Unterschied (ADR-0002).

## Folgen

- Kein Single-Shot: Qualität entsteht durch viele kleine, geprüfte Schritte und
  gezielte Rückgaben, nicht durch einen großen Prompt.
- Der Nutzer sieht und steuert alles im eigenen Frontend; der Chat-Tab läuft
  nebenher.
- Der Server braucht Lauf-Zustand, Feedback-Warteschlange, SSE und eine
  Sitzungscode-Verwaltung (passt zu Temporal aus dem Projektplan: Signale für
  Eingriffe und S4).
- Grenzen: Der Chat-Tab muss während der Arbeit offen sein; lange Läufe brauchen
  ggf. ein „weiter"; die Abo-Limits des Nutzers gelten.

## Proof of Concept (klärt alle ⚠)

1. Remote-MCP mit OAuth als Custom Connector in claude.ai eintragen.
2. `forge.attach` / `forge.next` / `forge.submit` mit einer Dummy-Pipeline aus
   20 Aufgaben: Wie weit kommt Claude in einer Antwort? Hält es sich ans Schema?
3. Vorausgefüllter Prompt per URL.
4. Blockierendes `forge.next` (Warten auf Nutzer): Wie lange toleriert der
   Client einen Werkzeugaufruf?
