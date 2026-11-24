# Abgleich: Projektplan 1.0 gegen bisherigen Stand

Stand: 2026-11-24. Maßgeblich ist ab jetzt der [Projektplan](projektplan.md)
(Konzeptversion 1.0). Dieses Dokument hält fest, was aus den bisherigen Arbeiten
übernommen wird, was dem Plan widerspricht und wie es aufgelöst wird.

Verglichen wurden:

- **PR #1** – Architektur v0.2 und Datenmodell (Branch `claude/project-thread-czs7ro`)
- **PR #2** – PoB-PoE2 headless per Python-Bridge, Windows-Test per GitHub Actions
  (Branch `claude/project-thread-3lzbxc`)
- **Agent-/Skill-Setup** (Branch `claude/project-thread-cy1h5f`)
- Christians nachträgliche Vorgaben: Web- **oder** Desktop-App, läuft mit
  regulärem Claude-Abo, leicht zugänglich für alle Freunde, PoE-tauglicher Look.

## Kurzfazit

Die Grundideen passen fast vollständig: Zahlen nur aus PoB, PoB unverändert
headless mit eigener Lua-Brücke, `.build`-Export, MCP als regelkonformer Weg fürs
Claude-Abo, Patch-Neuprüfung. Der eine echte Unterschied ist die **Betriebsform**:
Der Plan will eine gehostete Web-App, PR #1 eine lokale Electron-App.

Die Web-App des Plans erfüllt Christians Vorgaben sogar besser als PR #1, weil
der **Remote-MCP-Server (Plan-Modus B)** beides verbindet: Die Freunde planen in
claude.ai (Web, Desktop oder Handy) mit ihrem eigenen Abo, ExileForge liefert nur
Werkzeuge und Rechnungen vom Server, und niemand muss etwas installieren. Damit
fällt der Grund weg, aus dem v0.2 einen Server abgelehnt hatte (dort hätte der
Server Claude selbst aufrufen müssen, also API-Key statt Abo).

**Entscheidung (Christian, 2026-11-24):** Hybrid. ExileForge hat ein **eigenes
Frontend** für alles; nur die KI-Schritte laufen im Claude-Chat des Freundes über
den Remote-Connector, iterativ in kleinen Aufgaben statt Single-Shot-Prompts
([ADR-0003](adr/0003-hybrid-frontend-und-chat.md)).
PR #1 wird auf v0.3 umgeschrieben (dieser Stand), PR #2 bleibt als technischer
Kern, wird aber umgebaut.

## Was passt (wird übernommen)

| Thema | Bisher | Plan | Folge |
| --- | --- | --- | --- |
| Zahlen nur aus PoB | `Sourced<number>`, KI schreibt nur Platzhalter `{{calc…}}` | „Keine Zahl ohne Engine", `calcRef`, Zahlen-Linter | Identisch. `Sourced` wird zu `calcRef` in `packages/contracts`. |
| PoB headless | `HeadlessWrapper.lua` + eigene Lua-Brücke, JSON über stdio, gepinnte Version, LuaJIT | Gleiches Muster, Pool aus LuaJIT-Workern hinter JSON-RPC | PR #2 hat genau das bewiesen (PoB 0.23.1, echte Zahlen). |
| Abo-Regeln | Kein claude.ai-Login, keine Token, App ruft Claude nie mit Abo-Daten auf | Gleiche Lesart, Abo nur über Anthropic-Clients (MCP) | Identisch. |
| `.build`-Export | JSON v1 experimental, `level_interval`, `weapon_set`, ID-Mapping nötig | Gleich, plus Schema-Tests in CI | Recherche und Abbildungstabelle aus PR #1 bleiben gültig. |
| Patch-Neuprüfung | PoB-Release-Watcher, alle Builds neu rechnen, Diff | Daten-Release + Diff + Revalidierungsaufträge | Plan ist ausführlicher, Idee identisch. |
| Crafting-Zahlen | Herkunft `gamedata`/`market`/`derived` | Monte Carlo, „unkalibriert" wenn Gewichte fehlen | Herkunftskennzeichnung bleibt, Simulator kommt aus dem Plan. |
| Look | Dark Fantasy, Bronze/Altgold, Cinzel, eigene Ornamente, Seltenheitsfarben, PixiJS-Tree, React-Flow-Crafting | Gleiche Komponenten, eigene Gestaltung, GGG-Hinweis | Design-Richtung aus PR #1 wird Vorschlag für `packages/ui`. Plan ergänzt helles Thema und Mobile-first. |
| Werkzeuge | pnpm-Monorepo, TypeScript, React, Vitest | dito, plus Turborepo, Zod | Übernehmen. |

## Was widerspricht und wie es aufgelöst wird

### 1. Betriebsform: Desktop-App (PR #1) gegen Web-App (Plan)

- **PR #1:** Electron-App + `.mcpb`-Erweiterung, PoB läuft auf jedem PC, SQLite lokal,
  Installer mit SmartScreen-Warnung, Windows only.
- **Plan:** Next.js-Web-App, Fastify-API, Calc-Service auf einem Server (EU),
  Postgres; Guide-Leser mobil zuerst (zweiter Bildschirm beim Spielen).
- **Bewertung für „leicht zugänglich für Freunde":** Web gewinnt. Kein Installer,
  keine Windows-Abhängigkeit, Guide auf dem Handy, Builds sind Links statt Dateien,
  Updates ohne Zutun. Kosten: ein Server, den Christian betreibt und bezahlt.
- **Auflösung:** Web-App mit eigenem Frontend laut Plan
  ([ADR-0001](adr/0001-web-app-und-remote-mcp.md), [ADR-0003](adr/0003-hybrid-frontend-und-chat.md)). Electron, `.mcpb`,
  electron-updater, NSIS und SQLite entfallen. Der lokale Modus (F-21, R2) bleibt
  als spätere Option.

### 2. KI-Schicht: nur MCP (PR #1) gegen modellunabhängig (Plan)

- **PR #1:** Die App ruft nie selbst ein Modell auf; eigener API-Key „später optional".
- **Plan:** `llm-gateway` mit BYOK für viele Anbieter (Modus A), Remote-MCP (B),
  lokal mit `claude -p` (C), optional Betreiber-Key (D).
- **Kein echter Widerspruch:** Christians Vorgabe „läuft mit regulärem Claude-Abo"
  erfüllt Modus B. A ist ein Zusatzweg, der niemanden einschränkt.
- **Auflösung:** Für Freunde ist **B der Hauptweg**. Die Pipeline wird so gebaut,
  dass ihre Stufen entweder vom Gateway (A) oder vom Claude-Client über
  `forge.next`/`forge.submit` (B) ausgeführt werden; Zustand, Gates und Rechnungen
  liegen in beiden Fällen bei ExileForge. Das steht so schon im Plan und macht beide
  Wege gleichwertig. Modus C nur für Christians eigenen Gebrauch, D bleibt aus.

### 3. MCP-Transport: lokal stdio (PR #1) gegen Remote (Plan)

- **Auflösung:** Remote-MCP über Streamable HTTP ist der Hauptweg. Freunde tragen
  die Connector-URL einmal in claude.ai ein (Einstellungen → Connectors → eigenen
  Connector hinzufügen); das gilt dann auch in Claude Desktop und der Handy-App.
  stdio nur für den späteren lokalen Modus.
- **⚠ Annahme, prüfen:** Welche Claude-Pläne eigene Remote-Connectors erlauben
  (Pro/Max sicher, Free eingeschränkt) und wie viel Abo-Kontingent ein kompletter
  Guide verbraucht.

### 4. Reihenfolge und Day-0-Readiness bis 11.12.2026

- **PR #1:** PoB-PoC → MCP-PoC → Schema → `.build` → App → Skill → Installer → Patch.
  Ein **Daten-Katalog fehlt** dort ganz.
- **Plan:** Bis 11.12. nur das Fundament (R0): Daten-Pipeline, Katalog-API,
  Icons, Calc-Service. Generator danach.
- **Auflösung:** Reihenfolge des Plans (Erste Welle, Phase 0) gilt. Siehe
  [architecture.md, Abschnitt 6](architecture.md#6-day-0-readiness-bis-11122026).

### 5. Datenmodell

| PR #1 (v0.1) | Plan | Änderung |
| --- | --- | --- |
| JSON Schema in `packages/schema` | Zod in `packages/contracts`, daraus JSON Schema/OpenAPI | Zod übernehmen. |
| `Build` mit `variants`, `guide` | `BuildRequest` → `ArchetypeCandidate` → `TargetBuild` → `ProgressionPlan` → `GearPlan` / `CraftingPlan` → `GuideDocument` | Typen aus PR #1 werden auf diese Stufen-Verträge verteilt, Details in [data-model.md](data-model.md). |
| PoB-Knoten-IDs, GGG-IDs nur als Zusatzfeld | Kanonische IDs = interne Spiel-IDs (die auch `.build` nutzt) | Spiel-IDs werden Primärschlüssel, PoB-IDs Zusatzfeld. |
| Stufen: Akt 1–4 + Interludien | 1.0 hat **Akte 1–6**, Standard mind. 10 Stufen | Stufenliste korrigiert. |
| Prüfregeln (Resistenzen, Spirit, Attribute) | Gates G1–G8 + Vollständigkeits-Score ≥ 90 | Gates und Score aus dem Plan übernehmen. |
| `stats` mit fester Auswahl | Calc-Profile (`mapping`, `pinnacle`, `uber`) | Jedes `CalcResult` nennt sein Profil. |

### 6. PR #2 (PoB headless)

| Teil | Empfehlung |
| --- | --- |
| `pob_bridge/lua/runner.lua` | **Behalten.** Wird Kern von `apps/calc/lua/`, umgebaut zum langlebigen Worker mit zeilenweisem JSON-RPC (`build.load`, `calc.stats`, später `build.applyPatch`, `calc.evalBatch`). Heute startet jede Rechnung einen neuen Prozess. |
| `tools/setup_pob.sh`, LuaJIT-Build-Wissen | **Behalten.** Wird Teil des Calc-Docker-Images; PoB als Git-Submodul `vendor/PathOfBuilding-PoE2` gepinnt. |
| `tests/fixtures/witch_spark_lvl60.xml`, `tools/make_fixture.lua` | **Behalten**, erster Golden Build. |
| Python-Wrapper (`pob.py`, `__main__.py`) | **Ersetzen** durch Node-Supervisor in `apps/calc` (Plan: alles TypeScript außer Lua). Link-Auflösung und Code-Dekodierung nach TS portieren. |
| Windows-Workflow | **Nicht mehr nötig** für die Web-App (Server läuft unter Linux). Aufheben für den lokalen Modus oder entfernen. |

Vorschlag: PR #2 mergen wie er ist (er ist ein funktionierender, getesteter
Machbarkeitsnachweis) und den Umbau als ersten WS2-PR auf `main` machen.

### 7. Agent-/Skill-Setup

- `electron-security-reviewer` passt nur zur Desktop-Variante; für die Web-App
  eher ein Web-/API-Security-Reviewer (Auth, Rate Limits, Key-Speicherung).
- Die Arbeitsregeln des Plans (Ticket-Format mit F-IDs, ein Paket pro PR,
  Reviewer-Agent, „kein Spielwissen aus dem Modellgedächtnis", Konfiguration statt
  Konstanten) sollten in `CLAUDE.md`.
- `pob-number-auditor`, `contract-first`, `mcp-server-patterns`, `poe-ui-design`
  passen unverändert.

## Was für Freunde-Betrieb im Plan schlanker gehen kann

Der Tech-Stack des Plans ist Vorgabe (Änderungen per ADR). Für die ersten Wochen
ist es sinnvoll, ihn **gestaffelt** hochzufahren statt alles am ersten Tag:

- Phase 0 braucht: Postgres, Calc-Service, Daten-Releases als Dateien.
- Temporal kommt mit WS6 (Pipeline), Redis mit dem Calc-Cache, Langfuse/Sentry
  vor dem ersten Freunde-Test.
- Zugang zunächst nur auf Einladung (z. B. Discord-Login), damit Server, Kosten
  und GGG-/DSGVO-Pflichten einer öffentlichen Website erst später anfallen.

Das ändert keine Architekturentscheidung, nur den Zeitpunkt.
