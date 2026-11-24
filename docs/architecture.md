# ExileForge – Architektur (Entwurf v0.3, lokal zuerst)

Stand: 2026-11-24. Grundlage ist der [Projektplan 1.0](projektplan.md); dieses
Dokument hält fest, **wie** wir ihn umsetzen und was aus den bisherigen Arbeiten
übernommen wird. Was sich gegenüber v0.2 (Desktop-App) geändert hat und warum,
steht im [Abgleich](plan-abgleich.md). Annahmen sind mit **⚠ Annahme** markiert.

## 0. Harte Vorgaben

1. **Läuft lokal auf Christians PC** und lässt sich **einfach an Freunde schicken** ([ADR-0004](adr/0004-lokal-first.md)).
2. **Eigenes Frontend**, nicht die Claude-App als Oberfläche ([ADR-0003](adr/0003-hybrid-frontend-und-chat.md)).
3. KI läuft mit **regulärem Claude-Abo**: KI-Schritte im Claude-Chat (Claude Desktop/Code) des Nutzers über die ExileForge-Werkzeuge, iterativ in kleinen Aufgaben, keine Single-Shot-Prompts ([ADR-0002](adr/0002-claude-abo-nur-ueber-connector.md), [ADR-0003](adr/0003-hybrid-frontend-und-chat.md)).
4. **Optisch ansprechend für PoE-Spieler**, eigene Gestaltung, kein Anschein offizieller Herkunft.
5. **Keine Zahl ohne Engine**, **keine Entität ohne Katalog-ID**, **patch-agnostisch**, **Verträge zuerst** (Leitprinzipien des Plans).
6. Export als **`.build`**-Datei; **Neuprüfung nach jedem Patch**.
7. **Day-0-Readiness bis 11.12.2026**: Daten-Pipeline, Katalog und Rechenkern lesen 1.0-Daten ein, sobald Spiel und passendes PoB-Release da sind.

## 1. Entscheidung in einem Satz

ExileForge ist eine **lokale Windows-App** (Electron) mit eigenem Frontend,
lokalem Calc-Service aus unverändertem Path of Building PoE2 und einer
**Claude-Desktop-Erweiterung**: Der Nutzer arbeitet in der App, Claude erledigt im
eigenen Chat (eigenes Abo) die KI-Schritte in vielen kleinen, sofort mit PoB
geprüften Aufgaben. Weitergabe per Installer, kein Server.

## 2. Bausteine

```
 PC des Nutzers
┌──────────────────────────────────────────────────────────────────────────┐
│  ExileForge-App (Electron)                                               │
│  ┌──────────────┐  ┌────────────────────────────────────────────────┐    │
│  │ Frontend     │◀─│ lokaler Server 127.0.0.1 (Fastify)             │    │
│  │ React + Vite │  │  API · Live-Status (SSE) · MCP-Endpunkt /mcp   │    │
│  └──────────────┘  │  Pipeline-Zustandsmaschine (S0–S11)            │    │
│                    │  Katalog (Daten-Release) · SQLite              │    │
│                    │  Calc: Node-Supervisor + LuaJIT/PoB-Worker     │    │
│                    └───────────────▲────────────────────────────────┘    │
│                                    │ forge.attach / next / submit,       │
│                                    │ catalog.*, calc.*, optimize.*       │
│  Claude Desktop (eigenes Abo) ── ExileForge-Erweiterung (.mcpb, stdio-Brücke)
│  oder Claude Code ───────────── claude mcp add --transport http …/mcp     │
└──────────────────────────────────────────────────────────────────────────┘
        ▲ Installer, App-Updates, Daten-Releases, PoB-Versionen
        │ (GitHub Releases, gebaut in GitHub Actions)
```

Frontend und Claude sind zwei Eingänge in dieselbe Pipeline. Katalog und
Calc-Service nutzen dieselbe gepinnte PoB-Version. Fachliche Einzelheiten
(Datenplattform, Rechenkern, Build-Pipeline, Optimierer, Frontend) stehen im Plan;
was lokal anders läuft, steht in [ADR-0004](adr/0004-lokal-first.md).

## 3. Konkretisierungen gegenüber dem Plan

### 3.1 Calc-Service aus dem Machbarkeitsnachweis (PR #2)

- PR #2 hat gezeigt: PoB-PoE2 v0.23.1 rechnet unverändert headless über
  `HeadlessWrapper.lua`, wenn LuaJIT exakt in PoBs eigener Version gebaut wird
  (PoB nutzt `+=` und `?.`) und `lua-utf8` mitkompiliert ist. Build-Codes müssen
  außerhalb von Lua dekodiert werden (zlib + Base64), weil PoBs Headless-Modus
  `Inflate/Deflate` nur als Platzhalter hat.
- Umbau für `apps/calc` (läuft im App-Prozess):
  - `runner.lua` wird zum **langlebigen Worker** (PoB einmal laden, dann
    zeilenweises JSON-RPC über stdin/stdout). Ergebniszeilen behalten einen
    Marker, weil PoB selbst auf stdout loggt.
  - Python-Wrapper wird durch einen **Node-Supervisor** (TypeScript) ersetzt:
    Pool, Timeouts, Neustart, Recycling, Code-Dekodierung, Link-Auflösung.
    Nutzer brauchen kein Python.
  - PoB als Git-Submodul `vendor/PathOfBuilding-PoE2`; LuaJIT + `lua-utf8` werden
    in GitHub Actions **für Windows** gebaut (Windows-Workflow aus PR #2) und in
    den Installer gepackt.
  - Erste RPC-Methoden: `meta.version`, `build.load`, `calc.stats`; danach
    `build.applyPatch`, `calc.evalBatch`, `calc.nodePower`, `calc.validate`.
- **⚠ Annahme:** Kaltstart und Speicher je Worker sind noch nicht gemessen; sie
  bestimmen die Pool-Größe auf einem normalen Spiele-PC (Phase 0).

### 3.2 Einrichtung und Weitergabe

- **Installieren:** `ExileForge-Setup.exe` von der GitHub-Releases-Seite,
  Auto-Update über `electron-updater`. Ohne Code-Signing erscheint einmal die
  SmartScreen-Warnung.
- **Mit Claude verbinden:** Knopf in der App öffnet die `.mcpb`-Erweiterung, in
  Claude Desktop bestätigen. Für Claude Code zeigt die App den `claude mcp add`-Befehl.
  Voraussetzung: Claude Desktop oder Claude Code mit eigenem Abo.
- **Planen:** Im Frontend Skill und Vorlieben wählen, „Mit Claude planen"
  drücken, Startsatz mit Sitzungscode in Claude einfügen (`forge.attach`). Claude
  arbeitet die Aufgaben über `forge.next`/`forge.submit` ab; das Frontend zeigt
  Schritt, PoB-Zahlen und Tree live. Rückfragen (Aufgaben vom Typ `ask_user`) und
  Eingriffe (Variante wählen, Knoten/Items sperren, Schritt neu) passieren im
  Frontend. Ablauf im Detail: [ADR-0003](adr/0003-hybrid-frontend-und-chat.md)
  Abschnitte 3–4.
- **Teilen:** Guide als `.exileforge.json` an Freunde schicken (die importieren
  und rechnen ihn lokal nach), `.build` fürs Spiel, PoB-Codes je Stufe.
- **⚠ Annahme, prüfen:** Abo-Verbrauch pro Guide; ob ein Claude-Free-Konto
  lokale Erweiterungen nutzen kann.

### 3.3 Vereinfachter Stack für lokal

Der gehostete Stack des Plans (Next.js, Temporal, Postgres, Redis, S3, Langfuse)
wird lokal durch React + Vite, eine persistierte Zustandsmaschine und SQLite
ersetzt. Tabelle und Begründung: [ADR-0004](adr/0004-lokal-first.md). Der Kern
bleibt vom Electron-Teil getrennt, damit eine gehostete Variante später möglich
bleibt.

### 3.4 Oberfläche – „optisch ansprechend für PoE-Spieler"

Vorschlag für die Design-Tokens in `packages/ui` (aus v0.2 übernommen):

- Dunkles Thema als Standard: Stein-Schwarz/Anthrazit, Bronze/Altgold für Rahmen
  und Akzente, gedämpftes Blutrot für Warnungen. Helles Thema laut Plan zusätzlich.
- Item-Seltenheiten in den vertrauten Konventionsfarben (Normal weiß, Magisch blau,
  Selten gelb, Unique orange).
- Schrift: Cinzel (OFL) für Überschriften, gut lesbare Sans für Text.
- Eigene SVG-Ornamente und Rahmen, keine kopierten Spielgrafiken, keine Logos,
  die offizielle Plattformen nachahmen. Footer-Hinweis laut GGG.
- Kontrast nach WCAG AA. Guide-Leser so gebaut, dass er auch schmal (zweiter Bildschirm) gut lesbar ist.
- **⚠ Annahme:** Icons aus PoB bzw. der Spieldaten dürfen in einem
  nicht-kommerziellen Fan-Tool gezeigt werden; sonst eigene abstrakte Formen.

### 3.5 `.build`-Export (Erkenntnisse aus der Recherche)

- Format „Version 1 (Experimental)": `passives[]` mit String-IDs und
  `weapon_set`, `skills[]` mit `support_skills[]` (Pfade wie
  `Metadata/Items/Gems/…`), `inventory_slots[]` mit Unique-Name und Hinweistext,
  jeweils mit `level_interval` und `additional_text`. Meta-Gems werden nicht
  unterstützt, keine Item-Werte.
- Alle Stufen landen in einer Datei; die Progression steckt in `level_interval`.
- Weil der Katalog die internen Spiel-IDs als kanonische IDs nutzt, entfällt die
  in v0.2 geplante eigene Zuordnungstabelle weitgehend. **⚠ Annahme:** PoB-Daten
  enthalten diese String-IDs; sonst ergänzt sie die Daten-Pipeline.
- Die App bietet an, die Datei in den BuildPlanner-Ordner zu speichern; der
  Nutzer bestätigt den Speicherort selbst. **⚠ Annahme:** `level_interval` meint das Charakterlevel;
  im Spiel testen.

### 3.6 Datenmodell

Verträge als Zod-Schemas in `packages/contracts`. Wie die Typen aus v0.1 auf die
Verträge des Plans verteilt werden, steht in [data-model.md](data-model.md).

## 4. Repo-Struktur

Wie im Plan (Abschnitt Repository-Struktur), mit lokalen Anpassungen:
`apps/desktop` (Electron-Hülle, Installer, Updates), `apps/web` (React + Vite),
`apps/server` (lokaler Fastify-Server mit API, Pipeline und MCP-Endpunkt),
`apps/calc`, `apps/mcp-bridge` (`.mcpb`-Erweiterung), `apps/data-pipeline` (läuft in CI);
`packages/{contracts,catalog-sdk,calc-client,llm-gateway,agents,optimizer,crafting-sim,exporters,ui}`,
`vendor/PathOfBuilding-PoE2`, `config/`, `evals/`, `docs/adr/`.

## 5. Verhältnis zu v0.2 und zum Plan

v0.2 (PR #1) war bereits lokal mit Electron und Claude-Desktop-Erweiterung.
v0.3 übernimmt das, ergänzt aber aus dem Plan: Katalog und Daten-Releases,
Pipeline S0–S11 mit Gates und Score, kleine iterative Aufgaben statt eines großen
Planungs-Prompts, Optimierer und Crafting-Simulator. Vom gehosteten Plan-Stack
weicht v0.3 bewusst ab (ADR-0004).

## 6. Day-0-Readiness bis 11.12.2026

Ziel: Am Release-Tag laufen Pipeline, Katalog und Calc-Service gegen die
aktuellen 0.5-Daten, und ein neues PoB-Release lässt sich ohne Code-Änderung
einspielen. Reihenfolge nach der Ersten Welle des Plans:

| # | Aufgabe | WS | Grundlage |
| --- | --- | --- | --- |
| 1 | Monorepo-Gerüst (pnpm + Turborepo), CI, `contracts` v1: Catalog, CalcRPC, BuildRequest, GuideDocument | WS0 | dieses Dokument, data-model.md |
| 2 | Calc-Service: langlebiger LuaJIT-Worker + Node-Supervisor, `build.load`, `calc.stats`, unter Windows und Linux; Messung Kaltstart/Laufzeit/Speicher | WS2 | PR #2 |
| 3 | Daten-Pipeline (in GitHub Actions): PoB-Daten per LuaJIT nach JSON, Abbildung auf das kanonische Schema, Validierung, Diff, Daten-Release als Release-Datei | WS1 | Plan |
| 4 | Golden Builds (Ziel 20) mit Referenzwerten aus der PoB-Oberfläche | WS2/WS9 | Fixture aus PR #2 |
| 5 | Patch-Watcher: neues PoB-Release → Submodul-Bump-PR → Golden-Vergleich | WS1/WS2 | Plan |
| 6 | `.build`-Exporter mit Schema-Tests | WS8 | Recherche |
| 7 | ItemTooltip und Tree-Renderer gegen Fixture-Daten | WS7 | Design-Tokens 3.4 |
| 8 | PoC Claude-Anbindung: `.mcpb`-Brücke + `forge.attach/next/submit` mit Dummy-Pipeline (Server-Teil: `apps/server`, siehe dessen README) | WS8 | ADR-0003/0004 |
| 9 | Gateway (BYOK), Eval-Gerüst | WS5/WS9 | Plan |

1–5 sind für Day-0 Pflicht, 6–9 können parallel laufen und dürfen über den
11.12. hinausgehen.

## 7. Offene Fragen

- PoC Claude-Anbindung: `.mcpb`-Brücke, Werkzeugaufrufe pro Antwort (Recherche
  und Folgen: `apps/server/README.md`, Abschnitt „Lange Schleifen“),
  vorausgefüllter Start ([ADR-0004](adr/0004-lokal-first.md)).
- Offene Entscheidungen des Plans, soweit lokal noch relevant (eigene
  Datenextraktion, Sprache, Name, Kooperationen). Hosting-Budget und Betreiber-Key
  entfallen.
- Abo-Verbrauch pro Guide.
- Speicherbedarf je PoB-Worker → Pool-Größe auf dem PC.
- Code-Signing ja/nein.
- Lizenz für ExileForge selbst (PoB: MIT).

## Quellen

Siehe Projektplan, Abschnitt Quellen, zusätzlich:

- Anthropic, Legal and compliance (Claude Code): https://code.claude.com/docs/en/legal-and-compliance
- Anthropic Support, Agent SDK mit Claude-Abo: https://support.claude.com/en/articles/15036540
- GGG Developer Docs, Build Planner: https://www.pathofexile.com/developer/docs/game
- PathOfBuilding-PoE2: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2
