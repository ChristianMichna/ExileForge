# Entwickler-Werkzeuge

Stand: 2026-11-24. Was jeder Agent und jeder Mensch braucht, um in diesem
Repo zu arbeiten und seine Arbeit selbst zu prüfen. Agent-, Skill- und
Hook-Setup steht in `docs/agent-setup.md`.

## Schnellstart

```bash
tools/dev-setup.sh      # Linux, macOS, WSL, Claude-Code-Cloud, Devcontainer
pnpm check              # Typcheck, Lint, Format, Tests, Build
pnpm e2e                # Playwright mit Screenshot-Vergleich
```

Windows nativ: `powershell -ExecutionPolicy Bypass -File tools\dev-setup.ps1`
(ohne PoB; PoB headless unter Windows siehe `docs/pob-headless.md`).

`tools/dev-setup.sh` ist idempotent und überspringt, was schon erledigt ist:

| Schritt | Übersprungen, wenn |
|---|---|
| Node-Version prüfen (`.nvmrc`) | – |
| pnpm in der Version aus `package.json` (`packageManager`) | passende Version vorhanden |
| `pnpm install --frozen-lockfile` | Lockfile und Manifeste unverändert seit dem letzten Lauf |
| Playwright-Chromium | `PLAYWRIGHT_BROWSERS_PATH` hat schon eins (Claude-Code-Cloud) |
| `typescript-language-server` (für das Plugin `typescript-lsp`) | schon im `PATH` |
| PoB headless über `tools/setup_pob.sh` | `.pob/` ist auf dem gepinnten Commit; fehlt das Skript (vor PR #2), wird der Schritt gemeldet und übersprungen |

`--no-pob` lässt PoB weg (dann braucht es keinen C-Compiler).

### Devcontainer

`.devcontainer/devcontainer.json`: Node 22 und Python 3.12, ruft beim Anlegen
`tools/dev-setup.sh` auf, installiert die Systembibliotheken für Chromium mit
und empfiehlt die VS-Code-Erweiterungen für ESLint, Prettier und Playwright.

### Claude-Code-Cloud

Jede neue Cloud-Session soll startklar sein, ohne dass der Thread selbst
installiert. Dafür ruft das Setup-Skript der Cloud-Umgebung
`tools/dev-setup.sh` auf. Es läuft nur bei einem frisch gebauten Container,
danach ist der Stand im Cache.

## Monorepo

pnpm-Workspace (`apps/*`, `packages/*`) mit Turborepo. Gemeinsame Basis:
`tsconfig.base.json` (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), `eslint.config.mjs` (typescript-eslint strict,
React-Hooks, kein `any`, kein `console.log`), Prettier (`.prettierrc.json`,
Markdown ausgenommen, weil deutsche Tabellen von Hand umbrochen sind).

Jedes Paket bringt die Skripte `typecheck`, `test` und `build` mit, dann
greifen `pnpm typecheck|test|build` und die CI automatisch.

`apps/web` ist das Frontend (React + Vite) mit App-Gerüst, Build-Übersicht
und Design-System-Galerie (`#/design`), vorerst auf Beispieldaten.
Bausteine, Tokens und Schriften liegen in `packages/ui` (siehe dessen README).

## CI (GitHub Actions)

| Workflow | Wann | Was |
|---|---|---|
| `ci.yml` → *Checks* | jeder PR, Push auf `main` | `pnpm install`, Typcheck, Lint, Format (nur Linux), Vitest, Build – auf `ubuntu-latest` **und** `windows-latest` |
| `ci.yml` → *Playwright screenshots* | jeder PR, Push auf `main` | Build, `pnpm e2e` im Container `mcr.microsoft.com/playwright:v<Version>-noble`; Bericht, Testergebnisse und Screenshots als Artefakt `playwright-*` |
| `golden-builds.yml` | PRs und Pushes, die Rechenpfade ändern (Bridge, PoB-Pin, Calc, Verträge, Korpus); von Hand | Golden Builds gegen PoB (siehe unten); doppelt `real-builds.yml` bewusst nicht |
| `windows-pob.yml`, `real-builds.yml` | aus PR #2 | PoB headless unter Windows, echte Builds gegen PoB-GUI-Werte |

Ein Agent prüft seine Arbeit, indem er pusht und die Checks seines PRs liest;
lokal reicht `pnpm check`.

## Screenshots (Playwright)

- Tests liegen in `apps/<app>/e2e/`, Konfiguration in
  `apps/<app>/playwright.config.ts`. Zwei Fenstergrößen: `desktop`
  (1440×900) und `small-window` (1024×640), weil die App ein Desktop-Fenster
  ist.
- `expect(page).toHaveScreenshot()` vergleicht mit der Baseline in
  `e2e/__screenshots__/`. Erlaubt ist 1 % abweichender Pixel; Animationen sind
  aus.
- **Baselines entstehen nur im Playwright-Container**, in derselben Version wie
  `@playwright/test`. So sind Schriften und Rendering in CI und lokal gleich.
  Nur `*-linux.png` wird eingecheckt; Windows/macOS legen eigene, ignorierte
  Baselines an.
- In CI wird nie still eine Baseline geschrieben (`updateSnapshots: "none"`).
  Fehlt eine oder weicht sie ab, schlägt der Test fehl; im Artefakt liegen
  erwartetes Bild, tatsächliches Bild und Diff.
- Baselines erneuern, wenn sich die Oberfläche absichtlich ändert:
  - mit Docker: `tools/update-screenshots.sh`
  - ohne Docker: dem PR das Label `screenshots-update` geben. Die CI rendert
    neu und committet die Baselines in den PR-Branch. Danach das Label
    entfernen und die neuen Bilder im Diff ansehen.
- Versionswechsel von Playwright: `@playwright/test` in `apps/web/package.json`
  und das Container-Tag in `ci.yml` gemeinsam ändern, dann Baselines neu.

## Golden Builds

Feste Sammlung von Builds mit Sollwerten, die PoB selbst berechnet hat. Jede
Änderung rechnet dagegen; ein PoB-Update ist eine bewusste Neuaufzeichnung.
Details: `evals/golden/README.md`.

## MCP-Server und Plugins

Nur, was Umsetzung und Iteration wirklich verbessert. Im Repo stehen keine
Zugangsdaten; Keys kommen aus Umgebungsvariablen. Die Server in `.mcp.json`
sind in `.claude/settings.json` (`enabledMcpjsonServers`) freigegeben und
starten in jeder Claude-Code-Session im Repo, lokal wie in der Cloud.

| Was | Status | Warum |
|---|---|---|
| **Playwright MCP** (`.mcp.json`, Start über `tools/playwright-mcp.mjs`) | eingerichtet | Agents sehen die Oberfläche selbst: Seite öffnen, klicken, Screenshot, Konsole lesen. Ohne das ist „sieht es gut aus?" für einen Agenten blind. Headless, frisches Profil je Session; in der Cloud mit dem vorinstallierten Chromium. Version in `package.json` gepinnt. |
| **typescript-lsp** (Plugin aus `claude-plugins-official`, `.claude/settings.json`) | eingerichtet | Typfehler, Definitionen und Referenzen direkt nach jedem Edit statt erst bei `pnpm typecheck`. Spart viele Runden in einem strikt typisierten Monorepo. Braucht `typescript-language-server`, das `tools/dev-setup.sh` installiert. |
| **GitHub** | in Claude-Code-Cloud schon da; lokal Vorschlag | PRs, CI-Logs und Artefakte lesen. Lokal braucht der offizielle GitHub-MCP-Server ein Token, deshalb nicht in `.mcp.json`. Wer lokal will: Plugin `github` aus `claude-plugins-official` mit eigenem Token. |
| **Context7** (`.mcp.json`, Remote-Server `mcp.context7.com`) | eingerichtet | Aktuelle Doku zu Electron, Vite, Fastify, PixiJS, React Flow, MCP-SDK, Zod statt Modellgedächtnis; passt zur Regel „search-first". Der Gratis-Key kommt nur aus der Umgebungsvariable `CONTEXT7_API_KEY` (nie ins Repo); ohne Key läuft es mit niedrigerem Limit. Key holen: context7.com → Dashboard → API Key. Lokal unter Windows: `setx CONTEXT7_API_KEY "<key>"`, dann Claude neu starten. Cloud: in der Cloud-Umgebung `mcp.context7.com` erlauben und `CONTEXT7_API_KEY` als Variable eintragen. |
| **Astrolabe-MCP selbst** | später | Sobald `apps/server` den MCP-Endpunkt hat, per `claude mcp add --transport http` gegen die laufende App testen (Skill `mcp-server-patterns`). |

Bewusst weggelassen: Datenbank-MCPs (SQLite ist lokal und klein, Tests
reichen), Browser-Automatisierung der eigenen Chrome-Instanz (Playwright
genügt), allgemeine Code-Review-Plugins (eigene Reviewer-Agents decken das
projektspezifisch ab), Websuche-MCPs (in Claude Code eingebaut).
