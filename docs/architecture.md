# ExileForge – Architektur (Entwurf v0.3)

Stand: 2026-11-24. Grundlage ist der [Projektplan 1.0](projektplan.md); dieses
Dokument hält fest, **wie** wir ihn umsetzen und was aus den bisherigen Arbeiten
übernommen wird. Was sich gegenüber v0.2 (Desktop-App) geändert hat und warum,
steht im [Abgleich](plan-abgleich.md). Annahmen sind mit **⚠ Annahme** markiert.

## 0. Harte Vorgaben

1. Web- oder Desktop-App → **Web-App mit eigenem Frontend** ([ADR-0001](adr/0001-web-app-und-remote-mcp.md), [ADR-0003](adr/0003-hybrid-frontend-und-chat.md)).
2. KI läuft mit **regulärem Claude-Abo** → KI-Schritte im Claude-Chat des Freundes über den Remote-Connector, iterativ, keine Single-Shot-Prompts ([ADR-0002](adr/0002-claude-abo-nur-ueber-connector.md), [ADR-0003](adr/0003-hybrid-frontend-und-chat.md)).
3. **Leicht zugänglich für alle Freunde**: Browser + Claude-Konto, nichts installieren.
   Das ExileForge-Frontend ist die Oberfläche, nicht die Claude-App.
4. **Optisch ansprechend für PoE-Spieler**, eigene Gestaltung, kein Anschein offizieller Herkunft.
5. **Keine Zahl ohne Engine**, **keine Entität ohne Katalog-ID**, **patch-agnostisch**, **Verträge zuerst** (Leitprinzipien des Plans).
6. Export als **`.build`**-Datei; **Neuprüfung nach jedem Patch**.
7. **Day-0-Readiness bis 11.12.2026**: Daten-Pipeline, Katalog und Rechenkern lesen 1.0-Daten ein, sobald Spiel und passendes PoB-Release da sind.

## 1. Entscheidung in einem Satz

ExileForge ist eine **gehostete Web-App** (Next.js) mit **Calc-Service** aus
unverändertem Path of Building PoE2 und **eigenem Frontend** für alles. Nur die
KI-Schritte laufen im Claude-Chat des Freundes (eigenes Abo) über den
ExileForge-Remote-Connector, in vielen kleinen, sofort mit PoB geprüften Aufgaben.
Das Frontend zeigt live, was passiert, und der Freund greift dort ein.

## 2. Bausteine

```
 Freund (Browser / Handy)                 Freund in claude.ai / Claude Desktop / Handy-App
        │ HTTPS                                    │ eigenes Claude-Abo
        ▼                                          │ MCP (Streamable HTTP)
 ┌──────────────┐   REST    ┌────────────┐         ▼
 │ apps/web     │─────────▶ │ apps/api   │◀── apps/mcp  (forge.attach / forge.next / forge.submit,
 │ Next.js      │           │ Fastify    │              catalog.*, calc.*, optimize.*, …)
 └──────────────┘           └─────┬──────┘
                                  │
        ┌───────────────┬─────────┼──────────────┬──────────────────┐
        ▼               ▼         ▼              ▼                  ▼
 apps/worker      apps/calc    Postgres     Daten-Releases     llm-gateway
 Pipeline S0–S11  Node-Super-  Katalog,     (JSON, Icons)      nur BYOK (Modus A)
 (Temporal)       visor +      Guides,      aus apps/
                  LuaJIT-PoB   Nutzer       data-pipeline
```

Web und MCP sind zwei gleichwertige Eingänge in dieselbe Pipeline. Katalog und
Calc-Service nutzen dieselbe gepinnte PoB-Version. Einzelheiten zu jedem Baustein
stehen im Plan (Abschnitte Systemarchitektur, Datenplattform, Rechenkern,
KI-Schicht, Build-Pipeline, Optimierer, Frontend).

## 3. Konkretisierungen gegenüber dem Plan

### 3.1 Calc-Service aus dem Machbarkeitsnachweis (PR #2)

- PR #2 hat gezeigt: PoB-PoE2 v0.23.1 rechnet unverändert headless über
  `HeadlessWrapper.lua`, wenn LuaJIT exakt in PoBs eigener Version gebaut wird
  (PoB nutzt `+=` und `?.`) und `lua-utf8` mitkompiliert ist. Build-Codes müssen
  außerhalb von Lua dekodiert werden (zlib + Base64), weil PoBs Headless-Modus
  `Inflate/Deflate` nur als Platzhalter hat.
- Umbau für `apps/calc`:
  - `runner.lua` wird zum **langlebigen Worker** (PoB einmal laden, dann
    zeilenweises JSON-RPC über stdin/stdout). Ergebniszeilen behalten einen
    Marker, weil PoB selbst auf stdout loggt.
  - Python-Wrapper wird durch einen **Node-Supervisor** (TypeScript) ersetzt:
    Pool, Timeouts, Neustart, Recycling, Code-Dekodierung, Link-Auflösung.
  - PoB als Git-Submodul `vendor/PathOfBuilding-PoE2`; LuaJIT-Build aus
    `tools/setup_pob.sh` wandert ins Docker-Image des Calc-Service.
  - Erste RPC-Methoden: `meta.version`, `build.load`, `calc.stats`; danach
    `build.applyPatch`, `calc.evalBatch`, `calc.nodePower`, `calc.validate`.
- **⚠ Annahme:** Speicherbedarf und Kaltstart je Worker sind noch nicht gemessen;
  sie bestimmen Servergröße und Kosten (Phase 0).

### 3.2 Zugang für Freunde

- **Einmalig:** Connector-URL in claude.ai eintragen
  (Einstellungen → Connectors → eigenen Connector hinzufügen). Gilt danach auch in
  Claude Desktop und der Handy-App. Anmeldung am ExileForge-Konto per OAuth des
  eigenen Dienstes, damit Guides dem richtigen Nutzer gehören.
- **Planen:** Im ExileForge-Frontend Skill und Vorlieben wählen, „Mit Claude
  planen" drücken, Sitzungscode im Claude-Chat nennen (`forge.attach`). Claude arbeitet die
  Aufgaben über `forge.next`/`forge.submit` ab; Frontend zeigt Schritt, PoB-Zahlen
  und Tree live. Rückfragen (Aufgaben vom Typ `ask_user`) und Eingriffe (Variante wählen,
  Knoten/Items sperren, Schritt neu) passieren im Frontend.
  Ablauf im Detail: [ADR-0003](adr/0003-hybrid-frontend-und-chat.md).
- **Lesen:** Guide-Link im Browser, mobil zuerst.
- **Konto:** anfangs nur auf Einladung (z. B. Discord-Login). Öffentliche Website
  ist eine spätere Entscheidung (Plan, offene Entscheidung „Betriebsform").
- **⚠ Annahme, prüfen:** Welche Claude-Pläne eigene Remote-Connectors erlauben
  (Pro/Max ja, Free eingeschränkt) und wie viel Abo-Kontingent ein Guide kostet.

### 3.3 Gestaffeltes Hochfahren der Infrastruktur

Der Tech-Stack des Plans gilt. Hochgefahren wird er nach Bedarf:

| Ab | Dienst |
| --- | --- |
| Phase 0 | Postgres, Calc-Service, Daten-Releases als Dateien, CI |
| WS6 (Pipeline) | Temporal |
| Calc-Cache / Rate Limits | Redis |
| Icons über CDN | S3-kompatibler Speicher |
| vor dem ersten Freunde-Test | Sentry, Langfuse, OpenTelemetry |

### 3.4 Oberfläche – „optisch ansprechend für PoE-Spieler"

Vorschlag für die Design-Tokens in `packages/ui` (aus v0.2 übernommen):

- Dunkles Thema als Standard: Stein-Schwarz/Anthrazit, Bronze/Altgold für Rahmen
  und Akzente, gedämpftes Blutrot für Warnungen. Helles Thema laut Plan zusätzlich.
- Item-Seltenheiten in den vertrauten Konventionsfarben (Normal weiß, Magisch blau,
  Selten gelb, Unique orange).
- Schrift: Cinzel (OFL) für Überschriften, gut lesbare Sans für Text.
- Eigene SVG-Ornamente und Rahmen, keine kopierten Spielgrafiken, keine Logos,
  die offizielle Plattformen nachahmen. Footer-Hinweis laut GGG.
- Kontrast nach WCAG AA, Guide-Leser mobil zuerst.
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
- Der Nutzer lädt die Datei herunter und legt sie selbst in den
  BuildPlanner-Ordner. **⚠ Annahme:** `level_interval` meint das Charakterlevel;
  im Spiel testen.

### 3.6 Datenmodell

Verträge als Zod-Schemas in `packages/contracts`. Wie die Typen aus v0.1 auf die
Verträge des Plans verteilt werden, steht in [data-model.md](data-model.md).

## 4. Repo-Struktur

Wie im Plan (Abschnitt Repository-Struktur): `apps/{web,api,worker,calc,mcp,data-pipeline}`,
`packages/{contracts,catalog-sdk,calc-client,llm-gateway,agents,optimizer,crafting-sim,exporters,ui}`,
`vendor/PathOfBuilding-PoE2`, `config/`, `evals/`, `docs/adr/`.

## 5. Was aus v0.2 entfällt

Electron, electron-builder/NSIS, electron-updater, `.mcpb`-Paket, lokales SQLite,
Schreiben in den Spielordner, Windows-only. Der lokale Modus (F-21, Docker
Compose) bleibt als spätere Option im Plan.

## 6. Day-0-Readiness bis 11.12.2026

Ziel: Am Release-Tag laufen Pipeline, Katalog und Calc-Service gegen die
aktuellen 0.5-Daten, und ein neues PoB-Release lässt sich ohne Code-Änderung
einspielen. Reihenfolge nach der Ersten Welle des Plans:

| # | Aufgabe | WS | Grundlage |
| --- | --- | --- | --- |
| 1 | Monorepo-Gerüst (pnpm + Turborepo), CI, `contracts` v1: Catalog, CalcRPC, BuildRequest, GuideDocument | WS0 | dieses Dokument, data-model.md |
| 2 | Calc-Service: langlebiger LuaJIT-Worker + Node-Supervisor, `build.load`, `calc.stats`; Messung Kaltstart/Laufzeit/Speicher | WS2 | PR #2 |
| 3 | Daten-Pipeline: PoB-Daten per LuaJIT nach JSON, Abbildung auf das kanonische Schema, Validierung, Diff, Release | WS1 | Plan |
| 4 | Golden Builds (Ziel 20) mit Referenzwerten aus der PoB-Oberfläche | WS2/WS9 | Fixture aus PR #2 |
| 5 | Patch-Watcher: neues PoB-Release → Submodul-Bump-PR → Golden-Vergleich | WS1/WS2 | Plan |
| 6 | `.build`-Exporter mit Schema-Tests | WS8 | Recherche |
| 7 | ItemTooltip und Tree-Renderer gegen Fixture-Daten | WS7 | Design-Tokens 3.4 |
| 8 | Gateway (Anthropic + OpenAI-kompatibel), Eval-Gerüst | WS5/WS9 | Plan |

1–5 sind für Day-0 Pflicht, 6–8 können parallel laufen und dürfen über den
11.12. hinausgehen.

## 7. Offene Fragen

- PoC Hybrid-Ablauf: Werkzeugaufrufe pro Claude-Antwort, vorausgefüllter Prompt per URL ([ADR-0003](adr/0003-hybrid-frontend-und-chat.md)).
- Offene Entscheidungen des Plans (Monetarisierung, eigene Datenextraktion,
  Betreiber-Key, Sprache, Name/Domain, Kooperationen, Hosting-Budget).
- Remote-Connectors je Claude-Plan und Abo-Verbrauch pro Guide.
- Speicherbedarf je PoB-Worker → Servergröße.
- Lizenz für ExileForge selbst (PoB: MIT).

## Quellen

Siehe Projektplan, Abschnitt Quellen, zusätzlich:

- Anthropic, Legal and compliance (Claude Code): https://code.claude.com/docs/en/legal-and-compliance
- Anthropic Support, Agent SDK mit Claude-Abo: https://support.claude.com/en/articles/15036540
- GGG Developer Docs, Build Planner: https://www.pathofexile.com/developer/docs/game
- PathOfBuilding-PoE2: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2
