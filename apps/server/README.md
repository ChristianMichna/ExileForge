# @exileforge/server

Lokaler ExileForge-Server (ADR-0004): läuft in der App, lauscht **nur auf
`127.0.0.1`** und bietet

- den **MCP-Endpunkt** `/mcp` (Streamable HTTP, zustandslos) für Claude Code
  und für die `.mcpb`-Brücke von Claude Desktop,
- die **REST-API** und **Live-Events (SSE)** für das Frontend,
- die **forge-Schleife** (ADR-0003) als Zustandsmaschine mit SQLite.

## forge-Schleife

Claude bekommt nie den ganzen Auftrag, sondern je Aufruf genau eine kleine
Aufgabe mit eigenem Antwortschema (`ForgeTask` aus `@exileforge/contracts`).
Jede Abgabe prüft der Server sofort, in dieser Reihenfolge:

1. **Schema** der Aufgabe (Zod → JSON-Pointer im Befund)
2. **G1** – jede ID existiert im Katalog des Daten-Release
3. **Zahlen** – `text`-Segmente enthalten keine Ziffern (`free_number`, G8);
   `calc`-Verweise zeigen auf ein vorhandenes Ergebnis und einen vorhandenen
   Stat (`unknown_calc_ref`, G2)
4. **eigene Prüfung** der Aufgabe (z. B. Ascendancy passt zur Klasse,
   Rechnung über die Engine; fehlgeschlagene Rechnung = Befund `calc_failed`)

Bei Befunden bleibt dieselbe Aufgabe offen (`attempt + 1`, Befunde in
`findings`). Nach `maxAttemptsPerTask` Fehlversuchen entscheidet der Nutzer im
Frontend (Frage „Retry the task" / „Abort the run"). Deterministische Schritte
(z. B. S3-Skelettrechnung) macht der Server ohne Claude.

| MCP-Werkzeug | Vertrag | Zweck |
| --- | --- | --- |
| `forge_attach` | `forge.attach` | Sitzungscode → Lauf, erste Aufgabe |
| `forge_next` | `forge.next` | nächste Aufgabe; wartet bis zu `waitLongPollSeconds`, solange der Nutzer dran ist |
| `forge_submit` | `forge.submit` | Abgabe; Antwort enthält Befunde und immer den nächsten Schritt |
| `forge_ask_user` | `forge.ask_user` | Rückfrage als Karte im Frontend |
| `forge_status` | `forge.status` | Zustand des Laufs |
| `catalog_search`, `catalog_get` | – | IDs und Katalogdaten (als Daten gekennzeichnet); `catalog_search` filtert nach Text, Art und `tags` (mindestens eines von beiden nötig ist nicht gefordert, ohne Filter kommen Einträge in Katalogreihenfolge) |
| `calc_evaluate` | – | Build-Zustand rechnen, Ergebnis mit `calcId`, Engine und PoB-Version |

Werkzeugnamen nutzen `_` statt `.`, weil Claude-Werkzeugnamen nur
`[a-zA-Z0-9_-]` erlauben; die Verträge behalten die Punkt-Namen. Dazu gibt es
den MCP-Prompt `exileforge` (Startsatz mit Sitzungscode) und Server-
Instructions, die Claude anweisen, die Schleife bis `done` selbst
weiterzuführen.

## REST-API (Frontend)

| Methode | Pfad | Inhalt |
| --- | --- | --- |
| `GET` | `/api/health` | `calcEngine` (`fake`/`pob`), `dataReleaseId` |
| `POST` | `/api/runs` | `{ request: BuildRequest, pipelineId? }` → `runId`, `sessionCode`, `expiresAt` |
| `GET` | `/api/runs/:runId` | ganzer Laufzustand (Ergebnisse, offene Fragen, aktuelle Aufgabe) |
| `POST` | `/api/runs/:runId/session-code` | neuer Code, z. B. für einen neuen Chat |
| `POST` | `/api/runs/:runId/interventions` | `UserIntervention` (Variante wählen, sperren, ablehnen, Pause, Antwort, Stufe neu) |
| `GET` | `/api/runs/:runId/events` | SSE, `id` = `seq` des Laufs; `Last-Event-ID` spielt Verpasstes nach |

Schutz:

- Anfragen mit fremdem `Host` (DNS-Rebinding) oder fremdem `Origin`
  (Webseiten im Browser) werden mit 403 abgewiesen; erlaubte Origins setzt die
  App (`allowedOrigins`, nur exakte Origins).
- **Zugriffstoken je Installation**: Alles außer `/api/health` verlangt
  `Authorization: Bearer <token>`. Der Server legt das Token beim ersten Start
  an (`%APPDATA%\ExileForge\access-token`, sonst
  `~/.config/exileforge/access-token`, nur für den Besitzer lesbar). Die
  `.mcpb`-Brücke liest es dort; Claude Code bekommt es per
  `claude mcp add --transport http exileforge http://127.0.0.1:47615/mcp --header "Authorization: Bearer <token>"`
  (die App zeigt den Befehl an).
- Falsche Sitzungscodes: höchstens `attachFailuresPerMinute` je Minute.
- Höchstens 16 offene Event-Streams, 1 MB je Anfrage.

## Pipelines

`Pipeline.plan(ctx)` liefert für den aktuellen Laufzustand deterministisch den
nächsten Schritt (`task`, `server`, `wait_user`, `done`). Dadurch übersteht ein
Lauf Neustarts und Chatwechsel. Enthalten ist nur die **PoC-Pipeline**
(`poc`: S2-Kandidaten → S3-Skelettrechnung → S4-Auswahl im Frontend →
S5-Gems → S5-Rechnung), die die Mechanik mit echten Vertragsschemas beweist.
Die echten Stufen und Prompts kommen aus `packages/agents`.

Einstellungen (Versuche, Wartezeiten, Code-Gültigkeit, Kandidatenzahl,
Calc-Profile) stehen in `config/forge/forge.json`.

## Rechnen

`CalcPort` ist die schmale Sicht des Servers auf den Rechendienst. Bis der
PoB-Worker-Pool (`apps/calc`) mit der Umwandlung BuildState → PoB angebunden
ist, rechnet **calc-fake**: deterministische Fantasiewerte mit Stat-Namen
`fake.*` und PoB-Version `v0.0.0-calc-fake`. Er muss ausdrücklich gewählt
werden (`--calc fake`), `GET /api/health` und `calc_evaluate` melden
`engine: "fake"`.

## Entwicklung

```bash
pnpm --filter @exileforge/server build
node apps/server/dist/main.js --catalog <daten-release-ordner> --calc fake \
  [--port 47615] [--db exileforge.sqlite] [--origin http://127.0.0.1:5173]
claude mcp add --transport http exileforge http://127.0.0.1:47615/mcp --header "Authorization: Bearer $(cat ~/.config/exileforge/access-token)"
```

Zum Ausprobieren ohne Abo-Verbrauch: `npx @modelcontextprotocol/inspector`.

Speicher: `node:sqlite` (in Node/Electron enthalten, kein natives Modul für
Windows zu bauen; ohne Flag ab Node 22.13, daher `engines` ≥ 22.13; Node meldet
es noch als experimentell). Rechenergebnisse werden mitgespeichert
(`PersistedCalc`), damit calc-Verweise einen Neustart überstehen.

## Lange Schleifen in Claude

Stand der Recherche (24.11.2026, nicht selbst in Claude Desktop gemessen):

- Claude Desktop/claude.ai beenden eine Antwort nach einer nicht
  veröffentlichten Zahl von Werkzeugaufrufen („Claude reached its tool-use
  limit for this turn", Berichte: etwa 20 seit März 2026) mit einem
  **Continue**-Knopf; der Kontext bleibt erhalten. Claude Code hat diese
  Grenze in der Praxis nicht so eng.
- Claude Desktop bricht MCP-Aufrufe nach etwa **60 s** ab (Fehlerberichte).

Folgen im Server:

- `forge_submit` liefert immer schon den nächsten Schritt mit, ein eigener
  `forge_next`-Aufruf je Aufgabe entfällt (≈ 1 Aufruf pro Aufgabe plus
  Katalog-/Rechenaufrufe).
- `forge_next` wartet höchstens `waitLongPollSeconds` (20 s), deutlich unter
  60 s, und meldet dann `wait_user` mit `retryAfterSeconds`.
- Der Lauf liegt vollständig im Server: Nach „Continue", einer neuen
  Antwort oder einem neuen Chat (neuer Code über
  `POST /api/runs/:runId/session-code`) geht es an derselben Stelle weiter.
- Erwartung für einen ganzen Guide (40–80 Aufgaben): in Claude Desktop
  mehrere „Continue", in Claude Code meist am Stück. Das Frontend soll
  „Paused in Claude – press Continue" anzeigen, wenn eine Weile keine
  Abgabe kommt. Messung im Ende-zu-Ende-Test mit echtem Abo steht aus.

Quellen: [startdebugging.net](https://startdebugging.net/2026/05/fix-claude-reached-its-tool-use-limit-for-this-turn/),
[jdhodges.com](https://www.jdhodges.com/blog/claude-reached-tool-use-limit-fix/),
[Fehlerbericht 60-s-Abbruch](https://claudeissues.com/issue/63379-bug-desktop-app-cancels-stdio-mcp-tool-calls-at-60s-and-ignores-mcp-tool-timeout).

## Offen

- Adapter `CalcPort` → `@exileforge/calc` (sobald BuildState → PoB existiert)
- echte Stufen-Aufgaben und Prompts aus `packages/agents`, Gates G3–G8
- Pipeline-Ergebnis als `GuideDocument`: Die PoC-Pipeline meldet `done` und
  `guide.ready` mit einer `guideId`, zu der es noch **kein** Guide-Dokument
  gibt; das Ergebnis sind die Stufenergebnisse unter `GET /api/runs/:runId`.
- calc-Verweise sind an Daten-Release und Calc-Profile des Laufs gebunden,
  noch nicht an den Lauf selbst (Herkunft je Lauf speichern).
- Ereignis-Nachlieferung per SSE seitenweise statt auf einmal; Grenzen für
  Anzahl und Größe gespeicherter Läufe; Log-Schwärzung (Pfade, später Keys).
- Einbindung in `apps/desktop` (Port, Pfade im App-Datenordner, Origin des Fensters)

## Pipelines

- `poc`: Proof of Concept (S2 → S3 → S4 → S5.gems) zum Prüfen der Schleife.
- `forge`: echte Planungsstufen aus `packages/agents` (S0 bis S2). Danach endet
  der Lauf mit dem `PlanStep` `blocked` und dem Fehler `stage_not_implemented`,
  bis S3 ff. gebaut sind. Einstellungen: `config/agents/stages.json`
  (Option `--stages`, Standard `config/agents/stages.json`).
