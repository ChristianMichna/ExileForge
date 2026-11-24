# ExileForge – Projektplan: KI-Buildgenerator für Path of Exile 2 (1.0)

Nov 24, 2026 · @Christian · Arbeitstitel, Konzeptversion 1.0

## Management Summary

ExileForge ist eine Web-Anwendung, die aus einem einzigen Wunsch des Spielers ("Ich will einen Build um Skill X") einen vollständigen, rechnerisch geprüften Build mit Leveling-, Gear- und Crafting-Guide für Path of Exile 2 erzeugt. Die KI plant und schreibt, aber jede Zahl im Guide stammt aus der echten Path-of-Building-Engine (PoE2-Fork), die headless als Rechendienst läuft.

PoE2 1.0 erscheint am 11. Dezember 2026, also in 17 Tagen. Das ist zu knapp für ein fertiges Produkt zum Launch. Das Ziel bis dahin ist deshalb "Day-0-Readiness": Datenpipeline, Katalog und Rechenkern stehen und können die 1.0-Daten einlesen, sobald das Spiel und das passende PoB-Release verfügbar sind. Der KI-Buildgenerator folgt in den Wochen danach.

**Die fünf Säulen:**

1. **Versionierter Spieldaten-Katalog** (Items, Mods, Gems, Passive Tree, Crafting-Währungen, Icons), pro Patch automatisch neu gebaut, mit Diff zur Vorversion.
2. **Rechenkern** = Path of Building PoE2, unverändert, als Pool aus LuaJIT-Workern hinter einer JSON-RPC-API.
3. **Modellunabhängige KI-Schicht**: API-Keys beliebiger Anbieter (Anthropic, OpenAI, Google, OpenRouter, lokale Modelle) plus regelkonforme Wege, ein Claude-Abo zu nutzen (MCP-Server, lokaler Modus).
4. **Mehrstufige Build-Pipeline**: Intake → Mechanik-Analyse → Archetypen → Optimierung → Progression → Crafting → Guide → Validierung. Die KI schlägt vor, die Engine prüft.
5. **Visuelles Frontend**: Item-Tooltips, interaktiver Passive Tree mit Level-Zeitleiste, Gem-Setups, Crafting-Flussdiagramme, Stat-Kurven je Stufe.

**Leitprinzipien für alle Implementierungs-Agenten:**

- **Keine Zahl ohne Engine.** DPS, EHP, Resistenzen, Spirit und Attribute kommen ausschließlich aus PoB-Berechnungen. Die KI darf keine Werte schätzen.
- **Keine Entität ohne Katalog-ID.** Jeder Skill, jedes Item, jeder Mod und jede Passive im Guide muss im Katalog der Ziel-Patchversion existieren. Das blockt Halluzinationen und PoE1-Verwechslungen.
- **Patch-agnostisch.** Nichts ist auf 1.0 hart codiert. Ein neuer Patch ist ein Daten-Release, kein Code-Release.
- **Verträge zuerst.** Schemas und Schnittstellen werden vor der Implementierung festgelegt, damit parallele Agenten unabhängig arbeiten können.
- **Regelkonform.** Anthropic-Auth-Regeln, GGG-Entwicklerrichtlinien und Lizenzen sind Architekturvorgaben, keine Nachgedanken (siehe "Ausgangslage & harte Rahmenbedingungen").

## Ausgangslage & harte Rahmenbedingungen

Vier externe Fakten bestimmen die Architektur: der 1.0-Umfang, die Anthropic-Regeln für Abo-Logins, die GGG-API-Richtlinien und die Datenlage. Alles Weitere im Plan leitet sich daraus ab.

### Spielstand PoE2 1.0

- Release am 11. Dezember 2026 (PST) auf PC, PS5 und Xbox, ab dann Free-to-Play ([RPG Site](https://www.rpgsite.net/news/21188-path-exile-2-reaches-its-10-full-release-on-december-11)).
- Neu: Akte 5 und 6, die Klassen Duelist (Knight, Master-at-Arms) und Shadow (Assassin, Infiltrator), damit 10 Klassen ([pathofexile.gg](https://pathofexile.gg/exilecon-2026-day-1/), [U4N](https://www.u4n.com/news/exilecon-2026-poe-2-1-0-update-all-major-changes-new-classes-and-features.html)).
- Passive Tree mit hunderten neuen Stats, alle Jewel Sockets in Cluster verschoben; Support Gems rebalanced; über 40 neue und über 70 überarbeitete Uniques; Atlas-Tree auf 70 Knoten reduziert ([ComicBook](https://comicbook.com/gaming/feature/path-of-exile-2s-1-0-release-is-shaping-up-to-be-much-more-than-a-full-launch/), [Senseos](https://senseos.gg/news/path-of-exile-2-1-0-everything-announced-shadow-conquerors/)).
- **Konsequenz:** Praktisch jeder bestehende Build und jeder Tree-Datensatz ist zu 1.0 veraltet. Das System muss am Release-Tag mit leeren Erfahrungswerten arbeiten und darf sich nicht auf Trainingswissen der Modelle stützen.

### Rahmenbedingungen und ihre Konsequenzen

| Thema | Fakt | Konsequenz für ExileForge |
| --- | --- | --- |
| Claude-Abo in Fremd-Apps | Anthropic erlaubt Drittentwicklern nicht, Claude.ai-Login anzubieten oder Anfragen über Free/Pro/Max-Zugangsdaten für ihre Nutzer zu leiten; Credentials oder Session-Tokens dürfen nicht gesammelt, gespeichert oder durchgereicht werden ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). | Die Website bekommt **keinen** "Mit Claude anmelden"-Button. Abo-Nutzung nur über Anthropic-eigene Clients (MCP-Server-Modus) oder den unveränderten Claude-Code-Binary, in den sich der Nutzer selbst einloggt. Details im Abschnitt KI-Schicht. |
| Claude Code in Produkten | Erlaubt unter den Commercial Terms, wenn der Binary unverändert läuft und jeder Endnutzer mit eigenem API-Key oder eigenem Abo authentifiziert ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). | Option "Lokaler Modus / Self-Hosted" ist zulässig, muss aber vor dem öffentlichen Betrieb rechtlich geprüft werden. |
| Agent SDK mit Abo | Mit eigenem Plan angemeldet zählen Agent SDK und `claude -p` weiter gegen die Abo-Limits; Max-, Ultra- und Team-Abos erhalten zusätzlich monatliche API-Credits für das API-Key-Setup ([Claude Help Center](https://support.claude.com/en/articles/15036540)). | Für den persönlichen Betrieb durch den Projektinhaber ist das Abo nutzbar. Max/Ultra-Nutzer können ihre API-Credits als BYOK-Key einsetzen. |
| GGG OAuth-API | Neuregistrierungen sind derzeit geschlossen ([Developer Docs](https://www.pathofexile.com/developer/docs)). Charakter-Endpunkte unterstützen den Realm `poe2` mit Skills-Feld, aber nur wenige APIs liefern PoE2-Daten ([API Reference](https://www.pathofexile.com/developer/docs/reference)). | Charakter-Import per OAuth ist ein späteres, optionales Feature. Import läuft initial über PoB-Codes und `.build`-Dateien. |
| GGG-Richtlinien | Pflicht: identifizierbarer User-Agent, sichtbarer Third-Party-Hinweis; verboten: Anschein offizieller Herkunft, Programme, die mit dem Spiel oder seinen Dateien interagieren, kommerzielle Verwertung von GGG-IP im Allgemeinen ([Developer Docs](https://www.pathofexile.com/developer/docs)). | Kein Client-Tool, das Spieldateien liest. Disclaimer im Footer. Monetarisierung ist eine offene Entscheidung mit rechtlichem Prüfbedarf. |
| Spieldaten | Es gibt keine offizielle Daten-API; Daten liegen in `.dat64`-Dateien und werden von der Community über das [dat-schema](https://github.com/poe-tool-dev/dat-schema) ausgelesen ([PoEDB](https://poedb.tw/us/markdown_raw?oldid=8311)). | Primärquelle sind bereits extrahierte, lizenzierte Daten (PoB-Repo). Eine eigene Extraktion läuft nur offline beim Betreiber. |
| poe.ninja | Nur die Economy-Endpunkte sind öffentlich unterstützt; Builds-, Charakter- und PoB-Endpunkte sind intern und nicht für Dritte freigegeben ([poe.ninja API](https://poe.ninja/docs/api)). | Preise ja, Build-Statistiken von poe.ninja nein. Meta-Daten müssen aus eigenen Quellen kommen. |
| Path of Building PoE2 | MIT-Lizenz ([GitHub](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)). Headless-Betrieb ist erprobt: [pob-mcp](https://raw.githubusercontent.com/juddisjudd/pob-mcp/HEAD/README.md) steuert eine echte PoB-Instanz per JSON-RPC, ohne die Engine nachzubauen. | Integration ohne Fork der Rechenlogik möglich. PoB wird als Git-Submodul gepinnt. |
| In-Game Build Planner | Seit 0.5 liest das Spiel `.build`-Dateien (JSON) mit Passives, Skills, Supports und Inventar-Hinweisen, jeweils mit `level_interval` und Notiztext ([Game Docs](https://web.poecdn.com/developer/docs/game)). | Perfektes Exportziel: Der Guide lässt sich direkt im Spiel abarbeiten. |

### Zeitliche Ausgangslage

PoB-PoE2 muss für 1.0 selbst erst aktualisiert werden (neuer Tree, neue Klassen, neue Mechaniken wie Stances). Bis dieses Update erscheint, kann ExileForge für 1.0 nichts zuverlässig berechnen. Die Roadmap plant diese Abhängigkeit ausdrücklich ein.

## Produktvision, Zielgruppen & User Journeys

Vision: "Von der Skill-Idee zum spielbaren, durchgerechneten Build in einer Sitzung, inklusive des Weges dorthin." ExileForge ersetzt nicht Path of Building, sondern übernimmt die Arbeit, die heute zwischen PoB, Trade-Seite, Wiki und Content-Creator-Guides verteilt ist.

### Zielgruppen

| Persona | Bedarf | Was ExileForge liefert |
| --- | --- | --- |
| Theorycrafter | Ungewöhnliche Skills ausprobieren, schnell die Decke eines Archetyps finden | Mehrere Archetypen pro Skill mit verifizierten Zahlen, editierbare PoB-Exporte, Sensitivitätsanalysen |
| League-Starter | Ein sicherer Start ohne viel Handel, klarer Leveling-Pfad | Kampagnen-Plan Akt 1–6, Budget-Stufen, SSF-taugliche Varianten |
| Gelegenheitsspieler / Einsteiger (F2P-Welle ab 1.0) | Verstehen, warum ein Build funktioniert; Schritt für Schritt folgen | Erklärte Guides, In-Game-`.build`-Export, Glossar, "Was mache ich jetzt"-Ansicht |
| Crafter | Konkrete Rezepte für Zielitems mit Kosten und Wahrscheinlichkeiten | Crafting-Pläne pro Slot mit erwarteten Kosten aus Live-Preisen |
| Content Creator | Guides schnell produzieren und pflegen | Guide-Editor, Patch-Diff-Warnungen, Export als Markdown/PDF/`.build` |

### Kern-Journey: "Ich finde Skill X cool"

1. **Einstieg:** Nutzer wählt einen Skill im Katalog (Suche, Filter nach Tags, Klasse, Waffe) oder klickt "Build um diesen Skill" auf der Skill-Seite.
2. **Intake-Dialog:** Kurzer, geführter Dialog mit Defaults: Softcore/Hardcore, Trade/SSF, Budget, Spielstil (Mapping-Speed vs. Boss vs. Allrounder), Defensivpräferenz, Klassen- oder Ascendancy-Vorlieben, Komplexitätstoleranz (Tastenanzahl, Kombo-Rotation).
3. **Detailplanung (sichtbar):** Das System zeigt live, was es tut: Skill-Mechanik analysiert, 3–6 Archetypen-Kandidaten erzeugt, jeweils in PoB angerechnet. Nutzer sieht eine Vergleichsmatrix und wählt einen Kandidaten oder lässt den besten nehmen.
4. **Ausarbeitung (asynchron):** Optimierung, Progression, Gear- und Crafting-Plan entstehen im Hintergrund. Fortschritt wird gestreamt; der Nutzer kann die Seite verlassen und bekommt eine Benachrichtigung.
5. **Guide-Ansicht:** Vollständiger Guide (Spezifikation siehe Qualitätsstandard) mit Stufen-Navigation, Tree-Zeitleiste, Item-Tooltips, Crafting-Flüssen.
6. **Iteration:** "Mehr Defensive", "günstiger", "ohne Unique X", "Hardcore-tauglich machen" als gezielte Nachplanungen, die nur betroffene Teile neu rechnen.
7. **Export:** `.build`-Datei für den In-Game-Planner, PoB-Code je Stufe, Markdown/PDF.

### Weitere Journeys

- **Build-Review:** Nutzer fügt einen PoB-Code ein → Analyse von Schwächen (Resistenzen, EHP-Lücken, Spirit-Verschwendung) → konkrete Upgrade-Pfade mit Kosten.
- **Item-Katalog stöbern:** Uniques, Basen, Mods mit Tiers und Gewichten, Gems mit allen Leveln, Passive Tree, jeweils pro Patch-Version und mit "Was hat sich geändert".
- **Patch-Day-Check:** Gespeicherter Guide wird nach einem Patch automatisch neu validiert; der Nutzer sieht, welche Stufen betroffen sind und bekommt Korrekturvorschläge.

## Funktionsumfang & Release-Schnitt

Das MVP (R1) ist erst erreicht, wenn ein Nutzer zu einem beliebigen unterstützten Skill einen vollständigen Guide nach dem Qualitätsstandard erhält. Ein Viewer ohne Generator ist kein MVP. Die IDs dienen den Agenten als Referenz in Tickets und Commits.

| ID | Feature | Kurzbeschreibung | Release |
| --- | --- | --- | --- |
| F-01 | Daten-Pipeline | Patch erkennen, Daten extrahieren, normalisieren, validieren, als versioniertes Daten-Release veröffentlichen | R0 |
| F-02 | Katalog-API | Lesezugriff auf alle Entitäten je Patch-Version, Volltextsuche, Filter, Diff zwischen Versionen | R0 |
| F-03 | Icon- und Asset-Pipeline | Item-, Gem- und Passive-Icons als WebP auf CDN, Sprite-Atlanten für den Tree | R0 |
| F-04 | Calc-Service | PoB-PoE2 headless im Worker-Pool, JSON-RPC, Batch-Auswertung, Delta-Berechnung | R0 |
| F-05 | Katalog-UI | Item-, Mod-, Gem-, Unique- und Tree-Browser mit In-Game-artigen Tooltips | R1 |
| F-06 | PoB-Import & Build-Viewer | PoB-Code einfügen, Build anzeigen, Stats aus dem Calc-Service | R1 |
| F-07 | LLM-Gateway | Provider-Abstraktion, BYOK-Verwaltung, Kosten- und Token-Tracking, Modell-Routing pro Pipeline-Stufe | R1 |
| F-08 | Build-Pipeline | Intake → Analyse → Archetypen → Optimierung → Progression → Gear → Crafting → Guide → Validierung | R1 |
| F-09 | Tree-Optimierer | Pfadsuche über den Passive Tree mit PoB-Delta-Bewertung und Constraints | R1 |
| F-10 | Gem-Optimierer | Support-Kombinationen, Spirit-Budget, Gem-Level-Zeitpunkte | R1 |
| F-11 | Guide-Renderer | Stufen-Navigation, Tree-Zeitleiste, Gear-Paperdoll, Checklisten | R1 |
| F-12 | `.build`-Export | In-Game-Build-Planner-Datei mit `level_interval` je Passive/Gem und Notizen | R1 |
| F-13 | MCP-Server | Calc-, Katalog- und Guide-Tools für Claude Desktop, claude.ai und Claude Code (Abo-Nutzung) | R1 |
| F-14 | Economy-Integration | Preise aus den poe.ninja-Economy-Endpunkten, Budget-Stufen, Kostenschätzung | R2 |
| F-15 | Crafting-Simulator | Monte-Carlo-Simulation von Crafting-Schritten auf Basis von Mod-Gewichten | R2 |
| F-16 | Crafting-Planer | Rezeptsuche für Zielitems, Erwartungskosten, Fallback-Pfade | R2 |
| F-17 | Nachplanung | Gezielte Änderungen ("mehr EHP", "günstiger") mit Teil-Neuberechnung | R2 |
| F-18 | Build-Review | Bestehenden PoB analysieren, Upgrade-Pfade vorschlagen | R2 |
| F-19 | Patch-Revalidierung | Gespeicherte Guides gegen neues Daten-Release prüfen und Abweichungen markieren | R2 |
| F-20 | Accounts & Sharing | Login (E-Mail/Discord), gespeicherte Guides, öffentliche Links, Forks | R2 |
| F-21 | Lokaler Modus | Self-Hosted-Paket (Docker Compose), optional mit Claude Code im Abo des Nutzers | R2 |
| F-22 | Lokalisierung | UI Deutsch/Englisch; Spieldaten in den von GGG gelieferten Sprachen | R3 |
| F-23 | Guide-Editor | Manuelle Bearbeitung durch Creator mit erneuter Validierung | R3 |
| F-24 | OAuth-Charakterimport | Eigene PoE2-Charaktere über GGG-OAuth laden, sobald eine Registrierung möglich ist | R3 |
| F-25 | Trade-Deep-Links | Vorbefüllte Suchen auf der offiziellen Trade-Seite für Ziel-Items, vom Nutzer manuell geöffnet | R3 |

**Bewusst ausgeschlossen:** Overlays oder Tools, die mit dem Spielclient, Logs oder dem Bildschirm interagieren; automatisierte Trade-Abfragen gegen nicht dokumentierte Endpunkte; Scraping von poe.ninja-Builds oder poe2db.

## Qualitätsstandard: der vollständige Guide

Ein Guide wird nur ausgeliefert, wenn er alle harten Gates besteht und einen Vollständigkeits-Score von mindestens 90 von 100 erreicht. Mini-Guides scheitern an den Gates automatisch, weil Pflichtbausteine fehlen. Der Guide ist ein strukturiertes JSON-Dokument (`GuideDocument`, Schema im Repo unter `packages/contracts`), kein Fließtext; die Prosa ist nur eine Schicht darauf.

### Pflichtstruktur eines Guides

1. **Build-Steckbrief:** Klasse, Ascendancy, Hauptskill, Schadensart und Skalierungsachsen, Defensivschichten, Spielstil, Komplexität, Stärken/Schwächen, Budget-Spanne, SC/HC/SSF-Eignung.
2. **Mechanik-Erklärung:** Wie der Skill funktioniert, welche Tags und Stats ihn skalieren, warum genau diese Supports, Ascendancy-Knoten und Uniques gewählt wurden. Jede Begründung verweist auf Katalog-IDs.
3. **Progressionsstufen** (konfigurierbar, Standard mindestens 10): Kampagne in Etappen pro Akt bzw. Level-Band, Übergang zu Maps, frühe Maps, Atlas-Fortschritt, Pinnacle-ready, Endgame-Ausbau, optional Luxus/Mirror-Tier.
4. **Pro Stufe zwingend:**
   - exakte Passive-Allokation als Delta zur Vorstufe, inklusive Weapon-Set-Passives und Respec-Hinweisen
   - Ascendancy-Punkte und Reihenfolge, sobald verfügbar
   - vollständige Gem-Setups: Skills, Supports, Spirit-Gems, Level-Ziele, Swap-Zeitpunkte
   - Ausrüstung pro Slot: Unique oder Rare-Zielprofil mit Mod-Prioritäten, Mindestwerten, Basistyp, Socketables
   - Stat-Checkpoints aus PoB: DPS gegen definierte Ziele, EHP, Resistenzen, Attribute, Spirit-Bilanz, Bewegungs- und Angriffsgeschwindigkeit
   - "Was jetzt zu tun ist": konkrete Aufgaben als Checkliste (z. B. "Resistenzen auf Cap bringen", "Gem X auf Level Y")
   - Gefahren dieser Stufe und Gegenmaßnahmen
5. **Gear-Plan:** Slot-Tabelle je Budget-Stufe (League-Start, Mid, Endgame, optional Mirror) mit Preisschätzung und Prioritätsreihenfolge der Upgrades nach "Gewinn pro Divine".
6. **Crafting-Plan:** für jeden Rare-Slot mindestens ein vollständiges Rezept: Basis, Item-Level, Schrittfolge, eingesetzte Währungen/Omens/Essences, Erfolgswahrscheinlichkeit je Schritt, Erwartungskosten, Abbruch- und Fallback-Regeln.
7. **Spielweise:** Rotation, Tastenbelegung, Mapping- vs. Boss-Setup, Positionierung, Umgang mit typischen Bossmechaniken.
8. **Atlas- und Endgame-Strategie:** passende Atlas-Tree-Ausrichtung, Waystone-Mods, die der Build meiden muss.
9. **Varianten & Swaps:** mindestens eine Alternative pro Schlüssel-Unique, HC-Anpassungen, SSF-Anpassungen.
10. **Troubleshooting & FAQ:** "Ich sterbe in Situation X", "Mein Schaden ist zu niedrig", Diagnose-Checkliste.
11. **Metadaten:** Patch- und Katalogversion, PoB-Version, Modellversionen, Generierungsdatum, Validierungsprotokoll.

### Harte Gates (alle müssen bestehen)

| Gate | Prüfung |
| --- | --- |
| G1 Entitäten | Jede referenzierte ID existiert in der Katalogversion des Guides |
| G2 Rechenbarkeit | Jede Stufe lädt fehlerfrei in PoB; nicht unterstützte Mods werden gelistet und erklärt |
| G3 Machbarkeit | Attribut- und Level-Anforderungen erfüllt, Spirit nicht überzogen, Punkteanzahl passt zum Level, Tree-Pfad zusammenhängend |
| G4 Defensiv-Minimum | Resistenzen ab definierter Stufe auf Cap; EHP- und Chaos-Res-Schwellen je Stufe aus Konfiguration |
| G5 Offensiv-Minimum | DPS-Schwellen je Stufe aus Konfiguration (pro Patch kalibriert) |
| G6 Kontinuität | Jede Stufe ist von der vorherigen erreichbar: keine verlorenen Gems, Respec-Kosten ausgewiesen |
| G7 Vollständigkeit | Alle Pflichtbausteine vorhanden; Crafting-Rezept für jeden Rare-Slot |
| G8 Konsistenz | Text und Daten widersprechen sich nicht (Prüfung durch Critic-Agent plus Regelprüfer) |

### Vollständigkeits-Score

Gewichtete Punkte für Abdeckung und Tiefe: Begründungsdichte je Entscheidung, Anzahl erklärter Alternativen, Qualität der Crafting-Pläne (Wahrscheinlichkeiten vorhanden, Kosten belegt), Abdeckung der FAQ. Die Gewichte stehen in `config/guide-scoring.yaml`, damit sie ohne Code-Änderung justiert werden können. Unter 90 Punkten läuft eine gezielte Nachbesserungsrunde für die schwächsten Bausteine; nach drei Runden ohne Erfolg geht der Guide mit sichtbarem Qualitätshinweis raus oder wird verworfen (Einstellung).

## Systemarchitektur

ExileForge besteht aus sechs Diensten um zwei gemeinsame Wahrheiten herum: den versionierten Katalog und den Calc-Service. Alles ist TypeScript außer dem PoB-Kern (Lua), damit Schemas einmal definiert und überall typsicher genutzt werden.

&#91;embedded content: Systemarchitektur · 11 Bausteine, 2 gemeinsame Datenquellen\]

Web und MCP sind zwei gleichwertige Eingänge in dieselbe Pipeline; Katalog und Calc-Service nutzen dieselbe gepinnte PoB-Version, deshalb passen angezeigte Daten und berechnete Zahlen immer zusammen.

### Tech-Stack (Vorgabe, Änderungen nur per ADR)

| Schicht | Wahl | Begründung |
| --- | --- | --- |
| Monorepo | pnpm Workspaces + Turborepo, TypeScript strict | Gemeinsame Verträge, parallele Agenten arbeiten in getrennten Paketen |
| Verträge | Zod-Schemas in `packages/contracts`, daraus JSON Schema und OpenAPI generiert | Eine Quelle für Validierung, API-Doku und LLM-Tool-Definitionen |
| Frontend | Next.js (App Router), React, Tailwind, TanStack Query, PixiJS (WebGL) für den Tree | SSR für Katalogseiten (SEO), WebGL für tausende Tree-Knoten |
| API | Fastify, OpenAPI aus Zod | Schnell, schlank, gute Typisierung |
| Workflows | Temporal (TypeScript SDK) | Lange, mehrstufige Pipelines mit Retries, Wiederaufnahme und Nutzer-Entscheidung (Signal) mitten im Lauf |
| Calc-Service | Node-Supervisor + Pool aus LuaJIT-Prozessen mit PoB-PoE2 | Echte PoB-Rechenlogik, horizontal skalierbar |
| Datenbank | PostgreSQL 16 mit pgvector | Katalog, Guides, Nutzer, Embeddings für die Wissensbasis in einem System |
| Cache/Queue | Redis | Calc-Ergebnis-Cache, Rate Limits, Sessions |
| Objektspeicher | S3-kompatibel (MinIO lokal), CDN davor | Icons, Daten-Releases, Exporte |
| LLM-Zugriff | Eigenes `llm-gateway`-Paket auf Basis des Vercel AI SDK, plus direkte Anbieter-SDKs wo nötig | Viele Anbieter hinter einer Schnittstelle, Tool-Calling einheitlich |
| MCP | Offizielles MCP TypeScript SDK | Abo-Nutzung über Anthropic-eigene Clients |
| Observability | OpenTelemetry, Langfuse (self-hosted) für LLM-Traces, Sentry | Kosten und Qualität pro Pipeline-Stufe sichtbar |
| Betrieb | Docker, Hosting in der EU (z. B. Hetzner, Standort Deutschland) | DSGVO, Kosten |

### Repository-Struktur

```
exileforge/
  apps/
    web/              Next.js-Frontend
    api/              öffentliche REST-API (Fastify)
    worker/           Temporal-Worker: Build-Pipeline, Revalidierung
    calc/             PoB-Supervisor + LuaJIT-Worker
    mcp/              MCP-Server (stdio + Streamable HTTP)
    data-pipeline/    CLI: Patch-Erkennung, Extraktion, Normalisierung, Release
  packages/
    contracts/        Zod-Schemas: Catalog, Build, Guide, CalcRPC, Events
    catalog-sdk/      typisierter Lesezugriff auf Daten-Releases
    calc-client/      Client für den Calc-Service inkl. Batch und Cache
    llm-gateway/      Provider-Abstraktion, Keys, Routing, Kosten
    agents/           Prompts, Tool-Definitionen, Pipeline-Stufen
    optimizer/        Tree-, Gem- und Gear-Optimierer
    crafting-sim/     Crafting-Regelwerk und Monte-Carlo-Simulator
    exporters/        .build, PoB-XML/-Code, Markdown, PDF
    ui/               Tooltip, Tree-Renderer, Gem-Setup, Charts
  vendor/
    PathOfBuilding-PoE2/   Git-Submodul, gepinnt auf Release-Tag
  config/             Gates, Scoring, Stufen, Modell-Routing (YAML)
  evals/              Golden Builds, Bewertungs-Rubriken, Benchmarks
  docs/adr/           Architekturentscheidungen
```

## Datenplattform & Item-Katalog

Der Katalog wird pro Patch als unveränderliches **Daten-Release** gebaut (z. B. `poe2-1.0.0.3+r2`), nicht händisch gepflegt. Ein Update zwischen Patches ist ein Pipeline-Lauf mit automatischem Diff, Validierung und Freigabe per Knopfdruck. Builds und Guides speichern immer die Release-ID, mit der sie erzeugt wurden.

### Quellen nach Priorität

| Rang | Quelle | Wofür | Status |
| --- | --- | --- | --- |
| 1 | Daten aus dem gepinnten [PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)-Release (`src/Data`, Tree-Daten) | Gems, Basen, Uniques, Mods, Passive Tree, alles, was die Rechnung betrifft | Primär. Garantiert, dass Katalog und Calc-Engine dieselben Daten sehen. MIT-lizenziert. |
| 2 | Eigene Offline-Extraktion aus den Spieldaten über [dat-schema](https://github.com/poe-tool-dev/dat-schema) und [pathofexile-dat](https://www.npmjs.com/package/pathofexile-dat) | Felder, die PoB nicht führt: Icons, Crafting-Währungen, Omens, Essences, Socketables, Lokalisierungen, eventuell Spawn-Gewichte | Sekundär. Nur beim Betreiber, nie im ausgelieferten Produkt. Rechtliche Freigabe ist offene Entscheidung. |
| 3 | Offizielle Patch Notes und Ankündigungen | Wissensbasis für Mechaniken und Änderungen | Manuell bzw. halbautomatisch importiert, kuratiert |
| 4 | [poe.ninja Economy-API](https://poe.ninja/docs/api) | Preise für Budget und Crafting-Kosten | Unterstützte öffentliche Endpunkte, mit Cache und Rücksicht auf Rate Limits |
| 5 | poe2db | Manueller Gegencheck, Verlinkung auf Detailseiten | Kein Scraping. Optional Kooperationsanfrage an den Betreiber |

### Pipeline-Ablauf (`apps/data-pipeline`)

1. **Erkennen:** Watcher prüft stündlich neue PoB-PoE2-Releases (GitHub Releases) und neue Spielversionen; Hotfixes lösen ebenfalls einen Lauf aus.
2. **Extrahieren:** PoB-Daten werden mit LuaJIT geladen und als JSON serialisiert (kein Lua-Parsing per Regex). Optional läuft die dat-Extraktion für Ergänzungsfelder.
3. **Normalisieren:** Abbildung auf das kanonische Schema in `packages/contracts/catalog`. Stabile IDs: die internen IDs des Spiels (z. B. `Metadata/Items/Gems/SkillGemEarthquake`, PassiveSkills-IDs), dieselben, die das `.build`-Format verwendet.
4. **Anreichern:** Stat-Übersetzungen zu lesbarem Mod-Text, Tier-Berechnung je Mod-Familie, Tag-Index für Skills, Suchindex, Icon-Konvertierung (DDS → WebP, Sprite-Atlanten).
5. **Validieren:** Schema-Validierung, referenzielle Integrität (jede Referenz löst auf), Plausibilitätsregeln (Tier-Lücken, leere Gewichte), Smoke-Test: 20 Golden Builds laden fehlerfrei in den Calc-Service.
6. **Diff:** Maschinenlesbarer Diff zur Vorversion (neu, entfernt, geändert, mit Feld-Details). Daraus entstehen die "Was hat sich geändert"-Seiten und die Revalidierungsaufträge für gespeicherte Guides.
7. **Veröffentlichen:** Release als komprimierte JSON-Pakete in den Objektspeicher, Import in Postgres, CDN-Invalidierung. Freigabe manuell (Admin-UI) oder automatisch, wenn alle Checks grün sind.

### Kanonisches Schema (Auszug)

| Entität | Wichtige Felder |
| --- | --- |
| `BaseItem` | id, Klasse, Tags, Anforderungen, Implicits, Basiswerte (Armour/Evasion/ES, Waffenwerte), Socket-Kapazität, Drop-Level, Icon |
| `Mod` | id, Familie/Gruppe, Generierungstyp (Prefix, Suffix, Implicit, Corrupted, Desecrated, Essence, …), Domain, Tier, Item-Level, Stat-Ranges, Spawn-Gewichte je Tag, Text-Template |
| `UniqueItem` | id, Basis, Mods mit Ranges, Varianten, Patch-Herkunft, Drop-Quellen soweit bekannt |
| `Gem` | id, Typ (Skill, Support, Spirit, Meta), Tags, Level-Tabellen, Kosten/Spirit-Reservierung, Anforderungen, Qualitätseffekte, Einschränkungen für Supports |
| `PassiveNode` | id, Stats, Typ (Small, Notable, Keystone, Jewel Socket, Ascendancy), Gruppe/Orbit/Position, Verbindungen, Klassenstart |
| `Ascendancy` | id, Klasse, Knoten, Punkte-Freischaltung |
| `CraftingAction` | id, Art (Währung, Omen, Essence, Socketable, …), maschinenlesbare Wirkungsregel für den Simulator, Voraussetzungen, Seltenheitsstufen |
| `StatTranslation` | Stat-IDs → Textvorlagen je Sprache, Formatierungsregeln |
| `DataRelease` | id, Spielversion, PoB-Version, Pipeline-Revision, Quell-Hashes, Erstellungszeit, Diff-Verweis |

**Regel für Agenten:** Crafting-Wirkungen werden als deklarative Regeln modelliert (z. B. "fügt zufälligen Mod aus Pool P hinzu, gewichtet"), nicht als Code pro Währung. Neue Währungen eines Patches sind dann meist reine Daten, Simulator-Code ändert sich nur für wirklich neue Mechaniken.

### Wissensbasis für die KI

Neben den Strukturdaten gibt es eine versionierte Wissensbasis (Postgres + pgvector): kuratierte Mechanik-Artikel (Schadensberechnung, Konvertierung, Ailments, Defensivschichten, Spirit, Weapon Sets), Patch-Notes je Version und generierte Kurzbeschreibungen jedes Skills aus den Strukturdaten. Jeder Eintrag trägt eine Gültigkeit (`validFrom`/`validTo` Release). Die Retrieval-Tools geben nur Einträge zurück, die für die Ziel-Version gelten. Das ist die zweite Verteidigungslinie gegen veraltetes oder PoE1-Wissen im Modell.

## Rechenkern: Path of Building PoE2 headless

Der Calc-Service führt eine unveränderte PoB-PoE2-Version als Pool von LuaJIT-Prozessen aus und bietet ihre Rechenlogik über JSON-RPC an. Die Machbarkeit ist durch bestehende Projekte belegt: [pob2-mcp](https://glama.ai/mcp/servers/o6yigxw097) treibt einen unveränderten PoB-PoE2-Checkout über eine eigene `bootstrap.lua` und eine JSON-Brücke an, und [pob-mcp](https://mcpservers.org/id/servers/juddisjudd/pob-mcp) bringt einen eigenen HeadlessWrapper mit, weil installierte PoB-Releases diesen nicht enthalten. ExileForge übernimmt dieses Muster, schreibt die Brücke aber selbst für Durchsatz und Batch-Betrieb.

### Aufbau

- **Submodul:** `vendor/PathOfBuilding-PoE2`, gepinnt auf ein Release-Tag. Keine Patches am PoB-Code; nötige Anpassungen nur in der eigenen Bootstrap-Schicht (`apps/calc/lua/`).
- **Worker:** Ein LuaJIT-Prozess lädt PoB einmal und bedient danach viele Anfragen. Kommunikation über stdin/stdout mit zeilenweisem JSON-RPC.
- **Supervisor (Node):** verwaltet N Worker je PoB-Version, verteilt Anfragen, erzwingt Timeouts, startet abgestürzte Worker neu und recycelt Worker nach einer konfigurierbaren Anzahl von Anfragen gegen Speicherwachstum.
- **Mehrere PoB-Versionen parallel:** Pools je `pobVersion`, damit ältere Guides nachrechenbar bleiben und neue Versionen vor der Umstellung im Schattenbetrieb laufen können.
- **Cache:** Ergebnisse werden in Redis unter einem Hash aus (pobVersion, Build-Zustand, Calc-Profil) abgelegt. Optimierer erzeugen viele identische Zwischenzustände.

### RPC-Schnittstelle (Vertrag in `packages/contracts/calc`)

| Methode | Zweck |
| --- | --- |
| `build.load` / `build.export` | PoB-XML oder PoB-Code laden bzw. ausgeben |
| `build.applyPatch` | Änderungen anwenden: Passives (de)allokieren, Ascendancy, Gems setzen, Item in Slot (als Item-Text), Konfiguration |
| `calc.stats` | Vollständiger Stat-Satz: Offense je Skill, Defense, EHP, Resistenzen, Attribute, Spirit, Anforderungen |
| `calc.evalBatch` | Liste alternativer Patches gegen einen Basiszustand, Rückgabe nur der Deltas der gewählten Zielmetriken |
| `calc.nodePower` | Delta jeder erreichbaren Passive (oder einer Kandidatenliste) für eine Zielfunktion |
| `calc.itemPower` | Wert einzelner Mods/Stats als Delta, Grundlage für Gear-Prioritäten und "Gewinn pro Divine" |
| `calc.validate` | Regelprüfung: Anforderungen, Spirit, Punkteanzahl, Verbundenheit, nicht unterstützte Mods |
| `meta.version` | PoB-Version, unterstützte Spielversion, Daten-Hash |

### Calc-Profile

Zahlen sind nur vergleichbar, wenn die Gegner- und Situationsannahmen fest sind. Profile wie `mapping`, `pinnacle`, `uber` legen Gegnertyp, Bedingungen (z. B. Gegner betroffen von Ailment X), Charges und Buffs fest. Sie liegen versioniert in `config/calc-profiles/`. Jede Zahl im Guide nennt ihr Profil.

### Zielwerte (in Phase 0 zu messen und dann festzuschreiben)

- Kaltstart eines Workers, Einzelrechnung `calc.stats`, Durchsatz von `calc.evalBatch` (Kandidaten pro Sekunde und Worker). Die Messwerte bestimmen die Pool-Größe und das Budget der Optimierer. Bis dahin gilt keine Zahl als zugesichert.

### Grenzen und Umgang damit

- PoB unterstützt nicht jede Mechanik vollständig. `calc.validate` liefert die Liste nicht geparster Mods; der Guide weist sie aus, und die KI darf zu diesen Effekten keine Zahlen behaupten.
- PoB-PoE2 braucht nach einem großen Patch Zeit für Updates. Bis zum passenden Release ist ExileForge für diese Version im Modus "Katalog only".
- Gefundene Rechenfehler werden als Issue oder PR an das PoB-Projekt gemeldet, nicht lokal gepatcht.

### Upgrade-Ablauf für neue PoB-Releases

1. Watcher erkennt das Release und öffnet automatisch einen PR mit Submodul-Bump.
2. CI startet einen neuen Pool, lädt die Golden Builds und vergleicht mit den Referenzwerten (Toleranzen je Metrik).
3. Abweichungen werden im PR als Tabelle kommentiert. Freigabe durch einen Menschen, dann läuft die Daten-Pipeline für das neue Release.

## KI-Schicht: Claude-Abo, API-Keys, beliebige Modelle

Die Pipeline spricht nie direkt mit einem Anbieter, sondern mit dem `llm-gateway`. Darüber laufen vier Zugangswege. Ein "Mit Claude-Abo anmelden" auf der Website ist nach den Anthropic-Regeln ausgeschlossen; die Abo-Nutzung läuft deshalb über Anthropic-eigene Clients oder den unveränderten Claude-Code-Binary.

### Zugangswege

| Modus | Wie es funktioniert | Wer zahlt | Regelkonformität |
| --- | --- | --- | --- |
| A. BYOK (Website) | Nutzer hinterlegt API-Key eines Anbieters: Anthropic, OpenAI, Google, OpenRouter oder einen OpenAI-kompatiblen Endpunkt (z. B. lokales Ollama/vLLM). Die Pipeline läuft serverseitig. | Nutzer über seinen Anbieter | Unkritisch. Max-, Ultra- und Team-Abonnenten können die monatlichen API-Credits ihres Abos über einen Console-Key nutzen. |
| B. MCP (Abo-kompatibel) | ExileForge stellt einen Remote-MCP-Server bereit. Nutzer verbindet ihn als Connector in claude.ai, Claude Desktop oder Claude Code. Claude führt die Pipeline, ExileForge liefert Tools, Daten, Rechnungen und Gates. | Nutzer über sein Claude-Abo | Konform: Anmeldung und Abrechnung bleiben vollständig bei Anthropic, ExileForge sieht keine Zugangsdaten. |
| C. Lokal / Self-Hosted | Docker-Compose-Paket auf dem Rechner des Nutzers. Die Worker können den unveränderten Claude-Code-CLI (`claude -p`) nutzen, in den sich der Nutzer selbst über Anthropics Flow eingeloggt hat. | Nutzer über sein Abo | Für eigenen Gebrauch vorgesehen. Wer das Paket als Produkt verteilt, muss die Bedingungen für Claude Code in Produkten erfüllen (unveränderter Binary, eigene Authentifizierung pro Nutzer). Vor Veröffentlichung rechtlich prüfen. |
| D. Betreiber-Key (optional) | Kontingentierter Gratis-Zugang mit günstigem Modell für Einsteiger. | Betreiber | Unkritisch, aber Kostenrisiko. Nur mit hartem Tages-Budget. |

**Modus B im Detail:** Der MCP-Server bietet neben Einzel-Tools einen geführten Workflow: `forge.start(skillId, preferences)` legt serverseitig einen Pipeline-Zustand an und gibt die nächste Aufgabe mit Anweisungen zurück; jedes `forge.submit(stage, payload)` wird validiert (Schema + Gates) und liefert die nächste Aufgabe oder konkrete Korrekturhinweise. So bleibt die Qualitätskontrolle bei ExileForge, auch wenn das Modell im Client läuft. Der fertige Guide erscheint als Link auf der Website.

### Modell-Routing

Jede Pipeline-Stufe fordert eine Fähigkeitsklasse an, nicht ein Modell. `config/model-routing.yaml` bildet Klassen auf konkrete Modelle je Anbieter ab:

| Klasse | Einsatz | Beispiel Anthropic |
| --- | --- | --- |
| `planner` | Mechanik-Analyse, Archetypen, Strategieentscheidungen | Claude Opus 5.5 |
| `writer` | Lange, erklärende Guide-Texte | Claude Sonnet 5.5 |
| `critic` | Konsistenzprüfung, Widerspruchssuche | Claude Opus 5.5 oder Sonnet 5.5 |
| `extractor` | Klassifizieren, Zusammenfassen, Formatieren | Claude Haiku 5.5 |

Mindestanforderungen an jedes Modell: zuverlässiges Tool-Calling, strukturierte Ausgabe nach JSON-Schema, großes Kontextfenster. Ob ein Modell sie erfüllt, entscheidet die Eval-Suite, nicht das Datenblatt. Modelle, die die Evals nicht bestehen, werden in der UI als "nicht empfohlen" markiert.

### Tools der Agenten

Die Agenten arbeiten in einer geschlossenen Welt: kein Web-Zugriff, nur diese Tools. Das ist Absicht, denn nur so ist garantiert, dass alles zur Ziel-Version passt.

- `catalog.search`, `catalog.get`, `catalog.diff` – Entitäten der Ziel-Version
- `kb.retrieve` – Wissensbasis, gefiltert nach Gültigkeit
- `calc.*` – Calc-Service (Stats, Batch, Node-Power, Validierung)
- `optimize.tree`, `optimize.gems`, `optimize.gear` – deterministische Optimierer
- `craft.simulate`, `craft.plan` – Crafting-Simulator und -Planer
- `economy.price` – Preise mit Zeitstempel und Konfidenz
- `guide.read`, `guide.patch` – strukturierter Zugriff auf das `GuideDocument`

### Gateway-Pflichten

- Einheitliche Schnittstelle für Chat, Tool-Calling und strukturierte Ausgabe; Prompt-Caching nutzen, wo der Anbieter es kann.
- Ausgabe jeder Stufe wird gegen ihr Zod-Schema validiert; bei Fehlern läuft eine Reparaturschleife mit maximal zwei Versuchen.
- Token- und Kosten-Erfassung je Job, Stufe und Modell; hartes Budget pro Job, Abbruch mit Teilergebnis.
- API-Keys: verschlüsselt mit Envelope-Encryption (KMS) oder auf Wunsch nur für die Sitzung im Speicher; nie in Logs oder Traces.
- Prompts liegen versioniert in `packages/agents/prompts`, jede Änderung läuft durch die Eval-Suite.

## Build-Generierungspipeline

Die Pipeline plant **vom Endgame rückwärts**: Erst steht ein validierter Ziel-Build, dann werden daraus die Progressionsstufen bis Level 1 abgeleitet. So führt jede Stufe nachweislich zum Ziel, statt dass ein Leveling-Guide in einer Sackgasse endet. Sie läuft als Temporal-Workflow; jede Stufe ist eine Activity mit typisiertem Ein- und Ausgang, damit sie einzeln getestet, wiederholt und von verschiedenen Agenten gebaut werden kann.

&#91;embedded content: Build-Pipeline · 12 Stufen in 3 Phasen, 1 Gate mit Rücksprung\]

Der Nutzer entscheidet einmal (S4); danach läuft die Ausarbeitung asynchron, und jeder Gate-Fehler geht gezielt an die Stufe zurück, die ihn verursacht hat.

### Stufen

| # | Stufe | Ausführung | Ergebnis (Vertrag) |
| --- | --- | --- | --- |
| S0 | Intake | UI-Dialog, `extractor` normalisiert Freitext | `BuildRequest`: Skill-ID, Modus (SC/HC, Trade/SSF), Budget, Spielstil, Präferenzen, Ausschlüsse |
| S1 | Mechanik-Analyse | deterministisch + `planner` | `SkillProfile`: Tags, Schadensarten, Skalierungs-Stats, Konvertierungsoptionen, kompatible Supports (Tag-Filter), relevante Uniques, Passives und Ascendancy-Knoten nach Stat-Relevanz |
| S2 | Archetypen | `planner` | 3–6 `ArchetypeCandidate`: Klasse/Ascendancy, Schadensroute, Defensivkonzept, Schlüssel-Items, Hypothese warum es funktioniert |
| S3 | Schnellbewertung | deterministisch | je Kandidat ein Skelett-Build (Kurz-Optimierung von Tree und Gems, generisches Rare-Profil je Budget), PoB-Zahlen, Vergleichsmatrix |
| S4 | Auswahl | Nutzer (Temporal-Signal) oder automatisch nach Gewichtung | gewählter Kandidat + Nutzer-Feedback |
| S5 | Ziel-Build | Schleife aus `planner` und Optimierern | `TargetBuild`: Endgame-Tree, Ascendancy, Gems, Gear-Zielprofile pro Slot, Uniques; muss G1–G5 bestehen |
| S6 | Progression | Optimierer mit Constraints + `planner` | `ProgressionPlan`: Stufen mit Tree-Deltas, Leveling-Skills bis der Hauptskill trägt, Gem-Wechsel, Respec-Plan, Stat-Checkpoints |
| S7 | Gear & Budget | deterministisch + Economy | `GearPlan`: Slot-Tabellen je Budget-Stufe, Preise, Upgrade-Reihenfolge nach Gewinn pro Divine |
| S8 | Crafting | Crafting-Planer + `planner` | `CraftingPlan` je Rare-Slot: Schritte, Wahrscheinlichkeiten, Erwartungskosten, Fallbacks |
| S9 | Autorenschaft | `writer`, Abschnitt für Abschnitt | `GuideDocument` mit allen Pflichtbausteinen |
| S10 | Validierung | Gates (deterministisch) + `critic` | Prüfbericht; bei Fehlern Rückgabe an die verursachende Stufe mit konkretem Befund |
| S11 | Veröffentlichung | deterministisch | gespeicherter Guide, Exporte (`.build`, PoB-Codes je Stufe, Markdown/PDF) |

### Regeln, die jede Stufe einhält

- **Die KI wählt, die Engine misst.** LLM-Stufen geben Entscheidungen und Begründungen aus, keine Zahlen. Zahlen kommen aus Tool-Ergebnissen und werden per Referenz (`calcRef`) in den Guide eingebunden.
- **Zahlen-Linter:** Jede Zahl im Guide-Text muss einem Datenfeld zugeordnet sein. Freie Zahlen im Text sind ein Gate-Fehler.
- **Stufen-Constraints in S6:** verfügbare Passive-Punkte je Level, Gem-Verfügbarkeit je Level, realistische Item-Level je Etappe, maximale Respec-Menge zwischen zwei Stufen (konfigurierbar). Der Optimierer bevorzugt Teilmengen-Beziehungen zwischen aufeinanderfolgenden Trees.
- **Gezielte Rücksprünge:** Ein Validierungsfehler in Resistenzen geht an S7, nicht an S2. Maximal drei Rücksprünge pro Stufe, danach Eskalation an den Nutzer mit Erklärung.
- **Nachplanung (F-17):** "Mehr Defensive" startet bei S5 mit geänderter Zielfunktion und rechnet nur nachgelagerte Stufen neu.
- **Transparenz:** Jede Stufe schreibt ein kurzes Entscheidungsprotokoll, das im Guide unter "Warum so?" sichtbar ist.

### Große Suchräume, kleine LLM-Rolle

Der Passive Tree und die Support-Kombinationen sind zu groß für reines Ausprobieren durch ein Sprachmodell. Die Arbeitsteilung ist deshalb fest: Das Modell legt Zielfunktion, Constraints und Kandidaten-Schlüsselelemente fest (z. B. "Keystone X ist Pflicht, Lebens-basiert, Ziel 70 % Schaden / 30 % EHP"). Die Optimierer durchsuchen den Raum. Das Modell bewertet die Ergebnisse qualitativ und passt Zielfunktion oder Constraints an.

## Optimierer & Crafting-Simulator

Alle Optimierer sind deterministische Bibliotheken in `packages/optimizer` und `packages/crafting-sim`, die über den Calc-Client bewerten. Sie sind ohne LLM lauffähig und damit isoliert testbar; das LLM liefert nur Zielfunktion und Constraints.

### Tree-Optimierer

Problem: Aus dem Klassenstart einen zusammenhängenden Teilgraphen mit k Punkten wählen, der eine Zielfunktion maximiert (gewichtete Kombination aus DPS im Profil, EHP, Pflicht-Schwellen).

1. **Vorbewertung:** `calc.nodePower` liefert Deltas für Notables, Keystones und Jewel-Sockets; kleine Knoten werden über ihre Cluster bewertet.
2. **Grobauswahl:** Prize-Collecting-Steiner-Heuristik: Knotenwert gegen Pfadkosten, gierig mit Lookahead.
3. **Verfeinerung:** lokale Suche mit Add/Remove/Swap und Beam Search; jede Kandidatenrunde wird als `calc.evalBatch` gerechnet, weil Stat-Interaktionen nicht additiv sind.
4. **PoE2-Spezifika:** Weapon-Set-Passives als eigene Allokationsebene (das `.build`-Format kennt `weapon_set` 0–2), Jewel-Sockets mit Jewel-Profilen, Attribut-Anforderungen als harte Constraints.
5. **Progressionsmodus:** Optimiert eine Folge von Trees gemeinsam mit Strafterm für Respecs zwischen Stufen.

### Gem-Optimierer

- Kompatible Supports per Tag-Regeln aus dem Katalog vorfiltern (deterministisch, keine LLM-Schätzung).
- Einzel-Deltas je Support berechnen, dann Kombinationen bis zur Socket-Anzahl mit Pruning auf den besten Einzelwerten bewerten.
- Spirit als Rucksackproblem über Persistent Buffs, Minions und Auren.
- Gem-Level-Plan je Charakterlevel für die Progression.

### Gear-Optimierer

- **Stat-Gewichte** je Stufe aus `calc.itemPower`.
- **Rare-Zielprofil je Slot:** nur Mods, die auf dieser Basis und diesem Item-Level rollen können, Prefix/Suffix-Grenzen beachtet, Mindest-Tier je Mod.
- **Resistenz- und Attributverteilung** über alle Slots als kleines lineares Optimierungsproblem (z. B. HiGHS als WebAssembly), damit nicht jeder Slot alles tragen muss.
- **Preisbezug:** Uniques und Währungen aus der Economy-API; Rare-Kosten über Crafting-Erwartungskosten, weil es keinen unterstützten Preis-Feed für Rares gibt. Der Guide nennt diese Kosten als Schätzung mit Konfidenzstufe.

### Crafting-Simulator

- **Zustand:** Basis, Item-Level, Seltenheit, Mods mit Werten, Flags (z. B. korrumpiert, nicht mehr modifizierbar), aktive Omens.
- **Aktionen:** Jede `CraftingAction` aus dem Katalog ist eine deklarative Regel (Pool wählen, gewichtet ziehen, Mod entfernen, Werte neu würfeln, Seltenheit ändern, Omen-Modifikatoren). Mod-Familien schließen sich aus, Prefix/Suffix-Grenzen gelten.
- **Monte Carlo:** Pro Strategie N Durchläufe (konfigurierbar) mit festem Seed, Ausgabe: Erfolgswahrscheinlichkeit, erwarteter Währungsverbrauch, Verteilung, Kosten über Live-Preise.
- **Kalibrierung:** Wo Spawn-Gewichte in den Daten fehlen, rechnet der Simulator nicht mit erfundenen Werten, sondern markiert das Ergebnis als "unkalibriert" und der Guide sagt das.

### Crafting-Planer

- Bibliothek bekannter Strategie-Muster als Daten (z. B. "Essence-Basis, dann gezielt ergänzen"), pro Patch pflegbar.
- Suche über Aktionsfolgen (Beam Search bzw. MCTS) mit Zielfunktion "erwartete Kosten bis Ziel-Mods mit Mindest-Tier".
- Ausgabe als Entscheidungsbaum: "Wenn Mod X getroffen, weiter mit Schritt 4, sonst Schritt 2 wiederholen oder Basis verwerfen". Das Frontend zeichnet ihn als Flussdiagramm.
- Alternative Pfade für SSF (nur selbst farmbare Ressourcen) und für kleines Budget.

## Frontend & grafische Darstellung

Das Frontend zeigt Items, Gems, Tree und Crafting so, wie Spieler sie aus dem Spiel kennen, aber in eigener Gestaltung: GGG verbietet, ein Projekt so darzustellen, als sei es offiziell, inklusive Logos, die offizielle Plattformen nachahmen. Ein wichtiger Nutzungsfall ist der zweite Bildschirm: Spieler lesen den Guide auf dem Handy, während sie spielen. Die Guide-Ansicht ist deshalb mobil zuerst gestaltet.

### Bildschirme

| Bildschirm | Inhalt |
| --- | --- |
| Startseite / Skill-Finder | Suche, Filter nach Tags, Klasse, Waffe, Schadensart; "Build um diesen Skill" |
| Katalog | Uniques, Basen, Mods (mit Tiers, Gewichten, Item-Level), Gems (alle Level), Passive Tree, Crafting-Aktionen; Versionsumschalter und "Änderungen seit“-Ansicht |
| Intake & Planung | Geführter Dialog, danach Live-Fortschritt der Pipeline und Archetypen-Vergleichsmatrix zur Auswahl |
| Guide-Leser | Stufen-Navigation, je Stufe Tree, Gems, Gear, Checkpoints, Checkliste, Gefahren; Crafting- und FAQ-Kapitel |
| Build-Viewer / Review | Import eines PoB-Codes, Stats, Schwachstellen, Upgrade-Vorschläge |
| Konto | Gespeicherte Guides, API-Keys, MCP-Verbindungsanleitung, Kostenübersicht |
| Admin | Daten-Releases freigeben, Diffs prüfen, Pipeline-Jobs, Eval-Ergebnisse |

### Kernkomponenten (`packages/ui`)

- **ItemTooltip:** rendert aus Katalog plus Item-Instanz; Seltenheitsfarben, Implicits, Prefix/Suffix-Markierung, Tier und Wertebereich beim Hover, Anforderungen gegen das aktuelle Stufen-Level geprüft.
- **PassiveTree (WebGL, PixiJS):** Positionen aus den Tree-Daten (Gruppen, Orbits), Zoom und Pan, Suche mit Hervorhebung, Ascendancy-Ansicht, Weapon-Set-Umschalter. **Level-Zeitleiste:** Ein Regler spielt die Allokation Stufe für Stufe ab; neue Knoten farbig, Respec-Knoten markiert.
- **GemSetup:** Skill mit Supports als Sockel-Darstellung, Spirit-Leiste, Level-Ziele, Swap-Hinweise.
- **GearPaperdoll:** Ausrüstungs-Silhouette mit Slot-Tooltips je Stufe und Budget-Umschalter.
- **CraftingFlow:** Entscheidungsbaum als Flussdiagramm (z. B. React Flow), Knoten mit Wahrscheinlichkeit und Kosten.
- **StatCharts:** DPS und EHP je Stufe als Linien, Resistenzen als Balken mit Cap-Linie; einheitliches Farbsystem für Hell und Dunkel.
- **Checklisten:** abhakbar, Zustand im Konto bzw. lokal gespeichert.

### Technische Vorgaben

- Katalogseiten statisch je Daten-Release generiert (ISR), damit sie schnell und suchmaschinenfreundlich sind.
- Icons vom CDN als WebP, Tree-Grafiken als Sprite-Atlas.
- Dunkles und helles Thema, Tastaturbedienung, Kontrastprüfung nach WCAG AA.
- Sichtbarer Hinweis im Footer: "This product isn't affiliated with or endorsed by Grinding Gear Games in any way." (Pflicht laut GGG).

## Exporte & Integrationen

Der wertvollste Export ist die `.build`-Datei, weil der Spieler den Guide damit direkt im Spiel abarbeitet. Das Format bildet die Progression nativ ab: Passives, Skills und Supports tragen ein `level_interval`, Inventar-Slots einen Unique-Namen und alle Einträge einen formatierbaren Notiztext ([Game Docs](https://web.poecdn.com/developer/docs/game)).

| Export / Integration | Inhalt | Hinweise |
| --- | --- | --- |
| `.build` (In-Game Build Planner) | Passives mit `level_interval` und `weapon_set`, Skills mit Supports und Level-Intervallen, Inventar-Hinweise je Slot, Notizen in der Markup-Syntax des Formats | Format ist "Version 1 (Experimental)"; Meta-Gems werden nicht unterstützt; IDs gegen die Tabellen prüfen, da das offizielle Beispiel uneinheitliche Pfade enthält. Export-Tests gegen das Schema in CI. Der Nutzer legt die Datei selbst in den BuildPlanner-Ordner; ExileForge schreibt nichts in Spielverzeichnisse. |
| PoB-Code je Stufe | Vollständiger PoB-Export pro Progressionsstufe | Aus dem Calc-Service, damit identisch mit den angezeigten Zahlen |
| Markdown / PDF | Lesbarer Guide für Foren, Discord, Druck | PDF serverseitig gerendert |
| Öffentlicher Guide-Link | Teilbare Seite mit Versionsstempel | Mit "veraltet"-Banner, wenn die Revalidierung Abweichungen meldet |
| MCP-Server | Tools: Katalog, Calc, Optimierer, Crafting, Guide-Workflow; Ressourcen: Daten-Release-Infos | stdio für lokal, Streamable HTTP für Remote; Nutzer-Authentifizierung beim ExileForge-Konto per OAuth des eigenen Dienstes |
| Öffentliche REST-API (später) | Lesender Katalog-Zugriff für Community-Tools | Rate Limits, API-Keys, gleiche Daten-Releases |
| Import | PoB-Code, pobb.in-Link, `.build`-Datei | OAuth-Charakterimport erst, wenn GGG Registrierungen wieder annimmt |

## Nicht-funktionale Anforderungen

Der kritische Engpass ist die Rechenzeit des Calc-Service, nicht das LLM. Konkrete Zielwerte werden nach den Messungen in Phase 0 eingetragen; bis dahin gelten die Anforderungen qualitativ.

| Bereich | Anforderung |
| --- | --- |
| Latenz | Katalogseiten aus dem Cache bzw. statisch; Archetypen-Matrix (S0–S3) als erster sichtbarer Zwischenstand; vollständiger Guide als asynchroner Job mit Fortschrittsanzeige und Benachrichtigung |
| Lastspitzen | Patch-Day und F2P-Launch erzeugen Spitzen. Calc-Worker horizontal skalierbar, Job-Queue mit Prioritäten und fairer Verteilung je Nutzer, Wartezeit wird angezeigt |
| Kosten | Token- und Calc-Kosten je Guide werden gemessen und je Stufe ausgewiesen; hartes Budget pro Job; Wiederverwendung: gleiche Anfrage-Parameter auf gleichem Daten-Release liefern einen bereits erzeugten Guide (Shared Guide Cache, opt-in für öffentliche Guides) |
| Reproduzierbarkeit | Jeder Guide speichert Daten-Release, PoB-Version, Calc-Profil, Modelle, Prompt-Versionen und Seeds; Zahlen sind jederzeit nachrechenbar |
| Zuverlässigkeit | Temporal-Workflows überstehen Neustarts; Worker-Crashes führen zu Retry, nicht zu Jobverlust |
| Sicherheit | API-Keys verschlüsselt (KMS) oder nur in der Sitzung; Secrets nie im Code; MCP-Zugriff mit kurzlebigen Tokens und Scope je Werkzeug; Rate Limits je Konto und IP |
| Datenschutz (DSGVO) | Hosting in der EU; Impressum und Datenschutzerklärung; Datenminimierung (Guides und Präferenzen, keine unnötigen Profildaten); Löschfunktion für Konto und Daten; Hinweis, dass bei BYOK der jeweilige LLM-Anbieter die Prompts verarbeitet; für Modus D Auftragsverarbeitungsvertrag mit dem Anbieter |
| Rechtliches | GGG-Third-Party-Hinweis, kein Anschein offizieller Herkunft, keine Interaktion mit Spiel oder Spieldateien beim Nutzer; Lizenzhinweise für PoB (MIT) und genutzte Community-Bibliotheken |
| Beobachtbarkeit | Traces über alle Dienste (OpenTelemetry), LLM-Traces mit Kosten in Langfuse, Fehler in Sentry, Dashboards für Queue-Länge, Calc-Durchsatz, Gate-Fehlerquoten |
| Wartbarkeit | Patch-Updates ohne Code-Release für reine Datenänderungen; ADRs für jede Architekturentscheidung |

## Qualitätssicherung & Evaluation

Die Guide-Qualität wird wie Software getestet: Jede Änderung an Prompts, Modellen, Optimierern oder Daten läuft gegen eine feste Benchmark-Suite, und ein Merge ist nur erlaubt, wenn sich die Kennzahlen nicht verschlechtern.

### Testebenen

| Ebene | Was | Werkzeug |
| --- | --- | --- |
| Unit | Normalisierer, Optimierer-Bausteine, Exporter, Gates | Vitest |
| Vertrag | Alle Schnittstellen gegen `packages/contracts`; generierte Clients kompilieren | Zod, tsc, Schema-Snapshots |
| Calc-Golden | 20+ Referenz-Builds je PoB-Version: Werte aus der PoB-Desktop-Oberfläche als Referenz, Toleranz je Metrik | eigener Runner in `evals/golden` |
| Daten | Referenzielle Integrität, Plausibilität, Diff-Review je Daten-Release | Pipeline-Checks |
| Simulator | Invarianten als Property-Tests (Prefix/Suffix-Grenzen, Familien-Ausschluss, keine Mods außerhalb des Pools); Abgleich mit analytisch berechenbaren Einfachfällen | fast-check, statistische Tests |
| Exporte | `.build` gegen Format-Spezifikation, PoB-Code-Roundtrip | Vitest |
| End-to-End | Kern-Journeys im Browser inkl. Mobilansicht | Playwright |
| LLM-Evals | Benchmark-Set aus Skills × Präferenzprofilen; automatische Bewertung über Gates und Score, zusätzlich LLM-Judge mit Rubrik, Stichprobe durch Menschen | `evals/guides`, Langfuse-Datasets |

### Benchmark-Suite für Guides

- Skills aus jeder Klasse und jeder Schadensart, inklusive Minion-, DoT-, Trap- und Stance-Skills, damit keine Mechanik-Familie fehlt.
- Pro Skill mehrere Profile: League-Start SC Trade, HC SSF, Endgame-Boss, Budget-Mapping.
- Kennzahlen: Gate-Bestehensquote, Vollständigkeits-Score, PoB-Zielwerte gegen Profil-Schwellen, Kosten und Laufzeit je Guide, Anzahl der Rücksprungrunden.
- **Halluzinations-Tests:** Anfragen mit PoE1-Begriffen, entfernten Items oder erfundenen Uniques müssen erkannt und abgelehnt bzw. korrigiert werden.
- **Modellvergleich:** Dieselbe Suite läuft je Anbieter und Modell; Ergebnis ist die Empfehlungsmatrix in der UI.

### Menschliche Prüfung

Vor dem öffentlichen Start prüft eine kleine Gruppe erfahrener Spieler Guides blind gegen Community-Guides. Ihr Feedback fließt in die Rubrik und in die Strategie-Bibliothek des Crafting-Planers. Nach dem Start: "Guide melden"-Funktion mit Kategorie (falsche Zahl, nicht spielbar, Erklärung unklar), die in die Eval-Daten eingeht.

## Roadmap & Meilensteine

Bis zum Spielrelease am 11.12.2026 entsteht das Fundament; der Generator-MVP folgt in den Wochen nach dem PoB-Update für 1.0. Die Dauern ab P2 sind Schätzungen für einen parallel arbeitenden Agent-Swarm und werden nach P0 anhand gemessener Geschwindigkeit neu geplant.

&#91;embedded content: Roadmap · 5 Phasen, 4 Gates\]

Eine Phase gilt erst als abgeschlossen, wenn ihr Gate grün ist; Arbeiten der Folgephase dürfen vorher beginnen, aber nicht ausgeliefert werden.

## Umsetzung durch den Agent-Swarm

Der Swarm arbeitet in zehn Workstreams, die nur über Verträge in `packages/contracts` gekoppelt sind. Ein Architekt-Agent besitzt die Verträge und die Integration; alle anderen Agenten dürfen Verträge nur per eigenem Vertrags-PR ändern, den der Architekt freigibt. Bis echte Abhängigkeiten fertig sind, arbeitet jeder Workstream gegen Fakes.

### Workstreams

| WS | Pakete / Apps | Verantwortung | Abhängig von | Start |
| --- | --- | --- | --- | --- |
| WS0 Architektur & Verträge | `contracts`, `docs/adr`, CI | Schemas v1, Monorepo, CI-Pipeline, Fakes, Integrationstests, Code-Review-Regeln | – | Tag 1 |
| WS1 Daten-Pipeline | `data-pipeline`, `catalog-sdk` | Extraktion, Normalisierung, Validierung, Diff, Release, Icons | WS0 | Tag 1 |
| WS2 Calc-Service | `calc`, `calc-client` | LuaJIT-Bridge, Supervisor, RPC, Cache, Golden Runner | WS0 | Tag 1 |
| WS3 Optimierer | `optimizer` | Tree-, Gem-, Gear-Optimierer | WS0, WS2 (Fake bis fertig) | Woche 2 |
| WS4 Crafting | `crafting-sim` | Regelwerk, Simulator, Planer, Strategie-Bibliothek | WS0, WS1 | Woche 3 |
| WS5 LLM-Gateway | `llm-gateway` | Provider, BYOK, Routing, Kosten, Reparaturschleife | WS0 | Woche 1 |
| WS6 Agenten & Pipeline | `agents`, `worker` | Prompts, Tools, Temporal-Workflow S0–S11, Gates, Zahlen-Linter | WS0, WS5; Fakes für WS2/WS3 | Woche 2 |
| WS7 Frontend | `web`, `ui` | Katalog, Tooltip, Tree-Renderer, Guide-Leser, Intake, Konto | WS0, WS1 (Fixture-Daten) | Woche 1 |
| WS8 Exporte & MCP | `exporters`, `mcp`, `api` | `.build`, PoB-Codes, Markdown/PDF, MCP-Server, REST-API | WS0, WS2 | Woche 2 |
| WS9 Evals & QA | `evals` | Golden Builds, Benchmark-Suite, Rubriken, Modellvergleich, E2E-Tests | WS0 | Woche 1 |

### Arbeitsregeln für alle Agenten

- **Ticket-Format:** Ziel, betroffene Pakete, Vertrags-Referenzen, Akzeptanzkriterien als prüfbare Liste, Testanforderungen, Feature-ID (F-xx).
- **Definition of Done:** Typecheck und Lint grün, Tests für neues Verhalten, keine Verschlechterung der Eval-Kennzahlen, Doku im Paket-README, bei Architekturfragen ein ADR.
- **Ein Paket pro PR**, außer bei Vertragsänderungen mit Folgeanpassungen.
- **Kein Wissen aus dem Modellgedächtnis über Spielinhalte** in Code, Tests oder Prompts. Spielfakten kommen aus dem Katalog oder aus Fixtures, die aus einem Daten-Release erzeugt wurden.
- **Fakes und Aufzeichnungen:** `calc-fake` (deterministische Fantasiewerte für Logiktests), `llm-replay` (aufgezeichnete Antworten für reproduzierbare Pipeline-Tests).
- **Getrenntes Review:** Ein Reviewer-Agent, der den Code nicht geschrieben hat, prüft jeden PR gegen Akzeptanzkriterien und Verträge.
- **Konfiguration statt Konstanten:** Schwellen, Gewichte, Stufen und Modellzuordnungen liegen in `config/` und sind versioniert.

### Erste Welle (Phase 0, sofort startbar)

- [ ] WS0: Monorepo-Gerüst, CI, `contracts` v1 für Catalog, CalcRPC, BuildRequest, GuideDocument
- [ ] WS1: PoB-Daten mit LuaJIT nach JSON exportieren und auf das kanonische Schema abbilden (aktuelle 0.5-Daten)
- [ ] WS2: LuaJIT-Bridge mit `build.load`, `calc.stats`, `build.applyPatch`; Supervisor mit Timeouts und Neustarts; erste Messung der Zielwerte
- [ ] WS2/WS9: 20 Golden Builds aus aktuellen PoB-Codes mit Referenzwerten
- [ ] WS5: Gateway mit Anthropic und OpenAI-kompatiblen Anbietern, strukturierte Ausgabe, Kosten-Erfassung
- [ ] WS7: ItemTooltip und PassiveTree-Renderer gegen Fixture-Daten
- [ ] WS8: `.build`-Exporter mit Schema-Tests
- [ ] WS9: Eval-Gerüst und Rubrik v1

## Risiken & Gegenmaßnahmen

Das größte Einzelrisiko ist die Abhängigkeit vom PoB-Update für 1.0: Ohne passende PoB-Version gibt es keine verlässlichen Zahlen und damit keinen Generator.

| Risiko | Gegenmaßnahme | Frühindikator |
| --- | --- | --- |
| PoB-PoE2 unterstützt 1.0 erst Wochen nach Release oder unvollständig | Katalog-only-Modus zum Launch; Pipeline und Generator gegen 0.5-Daten fertig entwickeln; Upstream-Beiträge zu fehlenden Mechaniken | PoB-Release-Notes, offene Issues zu 1.0 |
| LLM halluziniert Entitäten oder nutzt PoE1-Wissen | Geschlossene Welt, Gate G1, versionsgefilterte Wissensbasis, Halluzinations-Tests in der Suite | Fehlerquote von G1 in Evals |
| Guides sind formal vollständig, aber spielerisch schwach | Blindvergleich mit Community-Guides, Rubrik-Kalibrierung, Strategie-Bibliothek von Experten | Menschliche Bewertung, "Guide melden"-Quote |
| Calc-Durchsatz reicht für Optimierer nicht | Messung in Phase 0, Batch-RPC, Ergebnis-Cache, Heuristiken vor PoB-Bewertung, Skalierung der Worker | Optimiererlaufzeit je Job |
| LLM-Kosten pro Guide zu hoch | Modell-Routing nach Fähigkeitsklasse, Prompt-Caching, Shared Guide Cache, Budgets je Job | Kosten je Guide im Langfuse-Dashboard |
| Änderung der Anthropic-Regeln für Abo-Nutzung | Abo nur über Anthropic-eigene Clients (MCP) und unveränderten Claude Code; BYOK als gleichwertiger Pfad | Änderungen an [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) und am [Help-Center-Artikel](https://support.claude.com/en/articles/15036540) |
| GGG-Richtlinien (Datenextraktion, Monetarisierung, Branding) | Primärdaten aus PoB, eigene Extraktion nur offline, kein Client-Tool, Disclaimer, Monetarisierung erst nach rechtlicher Prüfung | GGG-Ankündigungen, Entwickler-Doku |
| Fehlende Spawn-Gewichte machen Crafting-Wahrscheinlichkeiten unsicher | Kennzeichnung "unkalibriert", Planer weicht auf deterministische Schritte aus | Anteil unkalibrierter Crafting-Pläne |
| Datenformate ändern sich zwischen Patches | Pipeline mit Schema-Validierung und Diff, Release nur bei grünen Checks, alte Releases bleiben nutzbar | Pipeline-Fehler am Patch-Tag |
| Lastspitze zum F2P-Launch | Warteschlange mit Anzeige, Katalog statisch, Calc-Autoscaling, Rate Limits | Queue-Länge |
| Scope zu groß für die Startphase | Strikter Release-Schnitt R0–R3, MVP-Definition über den Qualitätsstandard statt über Feature-Anzahl | Burn-down je Workstream |

## Offene Entscheidungen

Diese Punkte muss der Projektinhaber vor oder während Phase 0 entscheiden; die Agenten arbeiten bis dahin mit den markierten Annahmen.

- [ ] **Betriebsform:** Öffentliche Website, persönliches Tool oder beides? Annahme: beides, Website zuerst mit BYOK und MCP, lokaler Modus später.
- [ ] **Monetarisierung:** keine, Spenden, oder kostenpflichtige Komfortfunktionen? GGG untersagt im Allgemeinen, mit seiner IP kommerziellen Umsatz zu erzielen. Annahme: nicht kommerziell bis zur rechtlichen Prüfung.
- [ ] **Eigene Datenextraktion:** Nur PoB-Daten oder zusätzlich Offline-Extraktion aus Spieldaten (für Icons, Crafting-Details, Lokalisierung)? Annahme: PoB-Daten sofort, Extraktion vorbereitet, aber erst nach Freigabe aktiv.
- [ ] **Betreiber-Key (Modus D):** Gratis-Kontingent ja oder nein, und mit welchem Tagesbudget?
- [ ] **Standardmodell und Standardanbieter** für BYOK-Empfehlungen; Annahme: Anthropic als Referenz, finale Empfehlung aus dem Modellvergleich.
- [ ] **Sprache:** UI zunächst Deutsch und Englisch? Guides in der Sprache des Nutzers? Annahme: Englisch zuerst (Spielbegriffe), Deutsch als zweite Sprache.
- [ ] **Projektname** und Domain ("ExileForge" ist ein Arbeitstitel; Markenprüfung nötig).
- [ ] **Kooperationen:** Anfrage an die Betreiber von poe2db und an das PoB-Team (Feedback, Datenaustausch, gegenseitige Verlinkung)?
- [ ] **Hosting-Budget** für Calc-Worker in der Launch-Phase.

## Quellen

Stand der Recherche: 24.11.2026.

- [RPG Site: PoE2 1.0 Full Release am 11. Dezember](https://www.rpgsite.net/news/21188-path-exile-2-reaches-its-10-full-release-on-december-11)
- [pathofexile.gg: ExileCon 2026 Day 1](https://pathofexile.gg/exilecon-2026-day-1/)
- [Senseos: PoE2 1.0 Reveal](https://senseos.gg/news/path-of-exile-2-1-0-everything-announced-shadow-conquerors/)
- [U4N: ExileCon 2026 Übersicht](https://www.u4n.com/news/exilecon-2026-poe-2-1-0-update-all-major-changes-new-classes-and-features.html)
- [ComicBook: 1.0 Änderungen am Passive Tree](https://comicbook.com/gaming/feature/path-of-exile-2s-1-0-release-is-shaping-up-to-be-much-more-than-a-full-launch/)
- [Claude Code Docs: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude Help Center: Agent SDK mit Claude-Plan](https://support.claude.com/en/articles/15036540)
- [Path of Exile Developer Docs](https://www.pathofexile.com/developer/docs)
- [Path of Exile API Reference](https://www.pathofexile.com/developer/docs/reference)
- [Path of Exile Game Docs: Build Planner Format](https://web.poecdn.com/developer/docs/game)
- [PathOfBuilding-PoE2 auf GitHub](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)
- [pob-mcp README](https://raw.githubusercontent.com/juddisjudd/pob-mcp/HEAD/README.md)
- [pob2-mcp (Glama)](https://glama.ai/mcp/servers/o6yigxw097)
- [poe.ninja API-Dokumentation](https://poe.ninja/docs/api)
- [PoEDB: Developer API und Datenexport](https://poedb.tw/us/markdown_raw?oldid=8311)
- [poe-tool-dev/dat-schema](https://github.com/poe-tool-dev/dat-schema)
