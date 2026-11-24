# Agent- und Skill-Setup

Stand: 2026-11-24. Was in `.claude/` und `CLAUDE.md` liegt, woher es kommt
und warum. Quelle der Übernahmen: [everything-claude-code][ecc] (ECC),
Commit `4adeee6` vom 2026-11-19, MIT-Lizenz (Text in
`.claude/THIRD_PARTY_NOTICES.md`).

Grundsatz: Nur übernehmen, was zu **diesem** Stack (Electron + React + TS,
MCP-Server, PoB headless in LuaJIT, `claude -p`) und **dieser** Kernregel
(„jede Zahl aus PoB") passt. Alles wurde auf Deutsch übertragen, gekürzt
und um Projektregeln ergänzt. Kein ECC-Plugin, kein Installer, keine
Laufzeit-Abhängigkeit auf ECC.

## Übersicht

| Datei | Herkunft | Wofür |
|---|---|---|
| `CLAUDE.md` | neu | Harte Regeln, Stack, Befehle, Arbeitsweise |
| `.claude/rules/typescript.md` | ECC `rules/typescript/*` verdichtet | Stilregeln, nur bei `.ts/.tsx` geladen |
| `.claude/agents/typescript-reviewer.md` | ECC, angepasst | Review für `.ts` |
| `.claude/agents/react-reviewer.md` | ECC, angepasst | Review für `.tsx` |
| `.claude/agents/electron-security-reviewer.md` | ECC `security-reviewer`, umgebaut | Sicherheit einer lokalen Electron-App |
| `.claude/agents/silent-failure-hunter.md` | ECC, angepasst | Stille Fehler / Ersatzwerte |
| `.claude/agents/pob-number-auditor.md` | **neu** | Kernregel „jede Zahl aus PoB" |
| `.claude/skills/search-first` | ECC, angepasst | Erst PoB/Community/npm prüfen |
| `.claude/skills/contract-first` | ECC, gekürzt | JSON Schema als Quelle der Wahrheit |
| `.claude/skills/tdd-workflow` | ECC, stark gekürzt | Vitest + PoB-Golden-Tests |
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
  Next.js-, RSC- und Server-Action-Teile entfernt (nicht im Stack);
  ergänzt um Kindprozesse, Schema-Drift, PixiJS-Cleanup, Design-Tokens,
  Farbe-nicht-einziges-Signal (Seltenheitsfarben).
- **electron-security-reviewer**: ECCs `security-reviewer` zielt auf
  Web-Backends (Login, Sessions, Rate Limits, Zahlungen) – das gibt es hier
  nicht. Ersetzt durch die echten Angriffsflächen: Renderer/IPC,
  `claude`- und LuaJIT-Start, Dateiexport, PoB-Downloads, MCP-Eingaben und
  vor allem die Abo-Regel (App fasst Claude-Zugangsdaten nie an).
- **silent-failure-hunter**: Ein still verschluckter Fehler ergibt hier
  einen plausibel aussehenden Guide mit falschen Zahlen. Ergänzt um
  PoB-/Preis-spezifische Ersatzwerte.
- **pob-number-auditor** (neu): Die wichtigste Projektregel hat in ECC kein
  Gegenstück. Prüft `Sourced<T>`, KI-Grenze (keine Zahlen in KI-Texten,
  Nachrechnen durch PoB), Versionierung bei Patches.

### Skills
- **search-first**: PoB, `pob-mcp`, `poe2-build-forge` und poe.ninja decken
  vieles ab; Nachbauen wäre teuer und fehleranfällig. ECCs
  Researcher-Subagent und PyPI-/Skill-Katalogsuche entfernt.
- **contract-first**: Die Architektur legt JSON Schema in `packages/schema`
  als Quelle der Wahrheit fest; sechs Grenzen (Modell, IPC, MCP, Worker,
  Planer-Antwort, `.build`). OpenAPI/AsyncAPI/Protobuf-Teile entfernt.
- **tdd-workflow**: Von ~600 auf ~80 Zeilen. Kern: PoB-Golden-Tests mit
  **aufgezeichneten** PoB-Ergebnissen statt handgeschriebener Zahlen;
  niemals echte `claude`-Aufrufe in Tests (Abo-Kontingent).
- **mcp-server-patterns**: Der MCP-Server ist die einzige Datenquelle der
  KI. Remote/HTTP entfernt (nur stdio), ergänzt um Herkunft in Ausgaben,
  Kostenhinweise in Tool-Beschreibungen, Test über `claude -p`.
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
| `planner`, `architect`, `code-explorer` | Claude Code hat eingebaute Plan-/Explore-Agents; Architektur liegt in `docs/` |
| `code-reviewer` (allgemein) | Abgedeckt durch TS-/React-Reviewer und eingebautes `/code-review` |
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
  Skill für `.build`-Export, sobald das Format im Spiel getestet ist.

[ecc]: https://github.com/affaan-m/everything-claude-code
