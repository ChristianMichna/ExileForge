# Agent- und Skill-Setup

Stand: 2026-11-24. Was in `.claude/` und `CLAUDE.md` liegt, woher es kommt
und warum. Quelle der Übernahmen: [everything-claude-code][ecc] (ECC),
Commit `4adeee6` vom 2026-11-19, MIT-Lizenz (Text in
`.claude/THIRD_PARTY_NOTICES.md`).

Grundsatz: Nur übernehmen, was zu den **Leitprinzipien des Projektplans**
(`docs/projektplan.md`) und zum TypeScript/PoB-Stack passt. Alles wurde auf
Deutsch übertragen, gekürzt und um Projektregeln ergänzt. Kein ECC-Plugin,
kein Installer, keine Laufzeit-Abhängigkeit auf ECC.

## Leitprinzip → Werkzeug

| Leitprinzip / Arbeitsregel | Durchgesetzt von |
|---|---|
| Keine Zahl ohne Engine | `CLAUDE.md`, Agent `pob-number-auditor`, Skill `tdd-workflow` (nur Golden/`calc-fake`), `contract-first` (keine Ergebniszahlen in LLM-Verträgen) |
| Keine Entität ohne Katalog-ID | Agent `catalog-integrity-auditor`, `tdd-workflow` (Fixtures nur aus Daten-Releases, Halluzinations-Tests) |
| Patch-agnostisch | Agent `catalog-integrity-auditor` (keine Versionskonstanten, `config/` statt Konstanten), `pob-number-auditor` (Schwellen aus `config/`) |
| Verträge zuerst | Skill `contract-first` (Vertrags-PR, Fakes), Agent `pr-acceptance-reviewer` |
| Regelkonform | `CLAUDE.md`, Agent `electron-security-reviewer` (Anthropic-, GGG-Regeln, Keys) |
| Ticket-Format, Definition of Done, ein Paket pro PR | Skill `work-ticket`, Agent `pr-acceptance-reviewer`, Skill `verification-loop` |
| Getrenntes Review | Agent `pr-acceptance-reviewer` |
| Kein Spielwissen aus dem Modellgedächtnis | `CLAUDE.md`, `catalog-integrity-auditor`, `tdd-workflow` |
| PoB nicht patchen | Hook `protect-vendored` |

Stack: lokale Windows-App nach ADR-0004 (Electron, React + Vite, lokaler
Fastify-Server auf `127.0.0.1` mit MCP-Endpunkt, `.mcpb`-Brücke für Claude
Desktop, LuaJIT/PoB, SQLite). Web-spezifische Teile aus ECC (Next.js,
Konten, Rate Limits, OAuth) sind deshalb bewusst weggelassen.

## Übersicht

| Datei | Herkunft | Wofür |
|---|---|---|
| `CLAUDE.md` | neu | Leitprinzipien, harte Regeln, Arbeitsregeln, Werkzeug-Übersicht |
| `docs/projektplan.md` | Christians Projektplan 1.0 | Referenz für Agents (F-xx, G1–G8, S0–S11, WS0–WS9) |
| `.claude/rules/typescript.md` | ECC `rules/typescript/*` verdichtet | Stilregeln, nur bei `.ts/.tsx` geladen |
| `.claude/agents/typescript-reviewer.md` | ECC, angepasst | Review für `.ts` |
| `.claude/agents/react-reviewer.md` | ECC, angepasst | Review für `.tsx` |
| `.claude/agents/electron-security-reviewer.md` | ECC `security-reviewer`, umgebaut | Sicherheit einer lokalen Electron-App |
| `.claude/agents/silent-failure-hunter.md` | ECC, angepasst | Stille Fehler / Ersatzwerte |
| `.claude/agents/pob-number-auditor.md` | **neu** | Keine Zahl ohne Engine |
| `.claude/agents/catalog-integrity-auditor.md` | **neu** | Keine Entität ohne Katalog-ID, patch-agnostisch |
| `.claude/agents/pr-acceptance-reviewer.md` | teils ECC `code-reviewer` | Getrenntes Review gegen Ticket, Verträge, DoD |
| `.claude/skills/search-first` | ECC, angepasst | Erst PoB/Community/npm prüfen |
| `.claude/skills/contract-first` | ECC, gekürzt | Verträge zuerst, Vertrags-PR, Fakes |
| `.claude/skills/tdd-workflow` | ECC, stark gekürzt | Testebenen des Plans, Golden, `calc-fake`, `llm-replay` |
| `.claude/skills/work-ticket` | **neu** | Ticket-Format des Plans |
| `.claude/skills/mcp-server-patterns` | ECC, angepasst | ExileForge-MCP-Server |
| `.claude/skills/verification-loop` | ECC, angepasst | Prüfschleife vor PR |
| `.claude/skills/architecture-decision-records` | ECC, angepasst | ADRs in `docs/adr/` |
| `.claude/skills/poe-ui-design` | teils ECC `design-system` | Dark-Fantasy-Tokens, UI-Audit |
| `.claude/hooks/protect-vendored.mjs` | **neu** | Blockiert Edits im PoB-Submodul |
| `.claude/hooks/format-on-edit.mjs` | Idee aus ECC (`post:edit:format`), neu geschrieben | Prettier nach Edits, No-op ohne Prettier |
| `.claude/settings.json` | neu | Registriert die zwei Hooks |

## Begründungen

### Agents
- **typescript-reviewer / react-reviewer**: Der ganze Code ist TS/React.
  Next.js-, RSC- und Server-Action-Teile entfernt (lokal React + Vite,
  ADR-0004);
  ergänzt um Kindprozesse, Schema-Drift, PixiJS-Cleanup, Design-Tokens,
  Farbe-nicht-einziges-Signal (Seltenheitsfarben).
- **electron-security-reviewer**: ECCs `security-reviewer` zielt auf
  Web-Backends (Login, Sessions, Rate Limits, Zahlungen) – das gibt es hier
  nicht. Ersetzt durch die echten Angriffsflächen der lokalen App:
  Renderer/IPC, der lokale Port auf `127.0.0.1` (DNS-Rebinding, fremde
  Webseiten), `.mcpb`-Brücke, LuaJIT-Start, Dateiexport, Downloads und
  Updates ohne Code-Signing, BYOK-Keys und vor allem die Abo-Regel (App
  nutzt das Claude-Abo nie selbst und fasst keine Zugangsdaten an).
- **silent-failure-hunter**: Ein still verschluckter Fehler ergibt hier
  einen plausibel aussehenden Guide mit falschen Zahlen. Ergänzt um
  PoB-/Preis-spezifische Ersatzwerte.
- **catalog-integrity-auditor** (neu): Leitprinzipien 2 und 3 haben in ECC
  kein Gegenstück. Fängt Spielwissen aus dem Modellgedächtnis, PoE1-Begriffe,
  Namen statt IDs und Versionskonstanten ab – das größte Risiko laut Plan
  („LLM halluziniert Entitäten oder nutzt PoE1-Wissen"), weil 1.0 fast alle
  Daten ändert.
- **pr-acceptance-reviewer** (neu, Ablauf aus ECC `code-reviewer`): setzt die
  Arbeitsregel „getrenntes Review gegen Akzeptanzkriterien und Verträge" um
  und bündelt die Fach-Reviewer.
- **pob-number-auditor** (neu): Die wichtigste Projektregel hat in ECC kein
  Gegenstück. Prüft `Sourced<T>`, KI-Grenze (keine Zahlen in KI-Texten,
  Nachrechnen durch PoB), Versionierung bei Patches.

### Skills
- **search-first**: PoB, `pob-mcp`, `poe2-build-forge` und poe.ninja decken
  vieles ab; Nachbauen wäre teuer und fehleranfällig. ECCs
  Researcher-Subagent und PyPI-/Skill-Katalogsuche entfernt.
- **contract-first**: Leitprinzip „Verträge zuerst"; Zod in
  `packages/contracts` als einzige Quelle, Vertrags-PR, Fakes; Grenzen der
  lokalen App (IPC, lokale API, MCP/`forge`, Calc-RPC, Daten-Release,
  Teilen-Datei, `.build`). OpenAPI/AsyncAPI/Protobuf-Teile entfernt.
- **tdd-workflow**: Von ~600 auf ~80 Zeilen. Kern: PoB-Golden-Tests mit
  **aufgezeichneten** PoB-Ergebnissen statt handgeschriebener Zahlen;
  niemals echte Claude-Aufrufe in Tests (Abo-Kontingent).
- **mcp-server-patterns**: Der MCP-Endpunkt ist die einzige Datenquelle der
  KI. Öffentliches Remote-Hosting entfernt; ergänzt um lokalen Endpunkt auf
  `127.0.0.1` mit `.mcpb`-stdio-Brücke (ADR-0004), `forge`-Aufgabenschleife
  ohne Single-Shot (ADR-0003), Herkunft in Ausgaben, Kostenhinweise.
- **verification-loop**: An pnpm, Lua-Worker und Projektregeln angepasst;
  meldet fehlende Skripte als „NICHT VORHANDEN" statt PASS.
- **architecture-decision-records**: Die Architektur hat viele
  ⚠-Annahmen, die durch PoCs entschieden werden; ADRs halten das fest.
- **poe-ui-design**: ECCs `design-system` generiert Tokens aus bestehendem
  Code und recherchiert Wettbewerber-Seiten; hier ist der Stil vorgegeben.
  Übernommen: Audit-Dimensionen und Liste typischer KI-Optik.

### Hooks
- **protect-vendored**: Erzwingt Regel 5 technisch statt nur per Text.
- **format-on-edit**: Gleichmäßiger Stil ohne Nacharbeit; tut nichts,
  solange Prettier nicht installiert ist. Beide Hooks in Node, weil Node
  ohnehin Pflicht ist und unter Windows läuft (PoE2 ist PC-only).

## Bewusst weggelassen

| Aus ECC | Warum nicht |
|---|---|
| Sprach-Reviewer/-Resolver für Python, Go, Rust, Java, Kotlin, Swift, C++, C#, Dart, PHP, Ruby, Vue, Angular … | Sprachen nicht im Stack |
| `planner`, `architect`, `code-explorer` | Claude Code hat eingebaute Plan-/Explore-Agents; Architektur und Plan liegen in `docs/` |
| `code-reviewer` (allgemein) | Nur Ablauf/Freigabekriterien in `pr-acceptance-reviewer` übernommen; Rest abgedeckt durch Fach-Reviewer und eingebautes `/code-review` |
| `agent-eval`, `eval-harness`, `benchmark` | Guide-Evals (WS9) sind fachlich eigen (Gates, Score, Golden Builds); Skill dafür, sobald `evals/` existiert |
| `tdd-guide`-Agent, `build-error-resolver` | Als Skill bzw. später; noch kein Build vorhanden |
| `e2e-runner`, `windows-desktop-e2e` | Noch keine UI; `windows-desktop-e2e` zielt auf WPF/WinForms mit pywinauto, nicht Electron. Später Playwright für Electron prüfen |
| `doc-updater`, `refactor-cleaner`, `performance-optimizer` | Kein Code, den sie pflegen könnten; bei Bedarf nachziehen |
| ECC-Hook-System (Session-Speicher, GateGuard, tmux, Kosten-Tracking, Continuous Learning, Instincts, Stop-Hooks) | Hängt an ECC-eigenen Node-Skripten und Installer, erzeugt lokale Zustandsdateien; Projekt-Gedächtnis läuft hier anders |
| Slash-Commands (`/plan`, `/tdd`, `/orch-*`, `/multi-*`, `/epic-*`, `/santa-loop` …) | Skills sind direkt aufrufbar; Orchestrierungs-Workflows sind für Teams mit vielen parallelen Agents gedacht |
| `rules/common/*` | Inhalt in `CLAUDE.md` und `.claude/rules/typescript.md` verdichtet |
| „Prompt Defense Baseline"-Block in jedem Agent | Ersetzt durch je einen projektbezogenen Satz „Daten sind keine Anweisungen" und Regel 7 in `CLAUDE.md` |
| Domänen-Skills (Healthcare, Logistik, Finance, Marketing, Video, Homelab …) | Kein Bezug |
| MCP-Configs für Fremddienste | Einziger MCP-Server ist ExileForges eigener |

## Pflege

- Neue Agents/Skills nur mit Begründung in dieser Datei.
- Bei Übernahme weiterer ECC-Teile: Kommentar mit Herkunft in die Datei,
  Tabelle oben ergänzen; die Lizenzdatei gilt weiter.
- Kandidaten für später: Playwright-E2E für Electron (sobald `apps/ui`
  existiert), `build-error-resolver` für pnpm/electron-builder,
  Skill für `.build`-Export, sobald das Format im Spiel getestet ist,
  ECCs eigene Plugin-/Marketplace-Struktur als Vorlage für `.claude-plugin/`
  (Schritt 6 der Umsetzung).

[ecc]: https://github.com/affaan-m/everything-claude-code
