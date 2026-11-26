# @astrolabe/desktop

Electron-Hülle der lokalen Windows-App (ADR-0004, F-13/F-05). Sie startet den
lokalen Server (`apps/server`) im selben Prozess, zeigt das Frontend
(`apps/web`) an, verbindet Claude und installiert und aktualisiert sich selbst.
Der Kern (`contracts`, `server`, `calc`, `ui`) kennt Electron nicht.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `src/main/main.ts` | Start: Fenster, Protokoll, IPC, Server, Updates (dünner Kleber, nicht unit-getestet) |
| `src/main/app-protocol.ts` | `astrolabe://app/`: liefert das Frontend und leitet `/api/*` mit Token an den Server |
| `src/main/security.ts` | CSP, erlaubte Ursprünge und Schemas |
| `src/main/ipc-handlers.ts` | Aktionen des Fensters („Plan with Claude", Befehl kopieren, Erweiterung, Update) |
| `src/main/services.ts` | startet `startServer` und prüft den Health-Check |
| `src/main/resources.ts` | Ordnerlayout (installiert / Entwicklung), Wahl des Daten-Release |
| `src/main/data-sync.ts` | sucht neue Daten-Releases (GitHub Releases), installiert sie über `@astrolabe/release-sync` nach `<userData>/data-releases/<Release-ID>/`; neu geladene Daten gelten nach einem Neustart |
| `src/main/updater.ts` | `electron-updater` → Status; Installation erst nach fertigem Download |
| `src/preload.ts`, `src/shared/bridge.ts` | schmale Brücke `window.astrolabe` (Vertrag in `bridge.ts`) |
| `electron-builder.yml`, `scripts/` | Installer |

Einstellungen (Port, Fenstergröße, Claude-Link, Startsatz, Update-Takt) stehen
in `config/desktop/desktop.json`.

## Sicherheit

- Das Fenster lädt über ein eigenes Protokoll (`astrolabe://app/`), nicht über
  `file://` oder einen Webserver. `/api/*` leitet die Hülle an den lokalen Server
  weiter und setzt dabei das **Zugriffstoken**. Die Seite kennt das Token nie,
  und `/mcp` ist über das Fenster nicht erreichbar.
- `contextIsolation`, `sandbox`, kein Node im Fenster, `will-navigate` und
  `window.open` nur auf die eigene App, keine Berechtigungen (Kamera, Standort
  …), Netzanfragen nur an die App und den lokalen Server. CSP: nur eigene
  Skripte und Stile, `connect-src 'self'`.
- IPC nimmt nur Aufrufe von Frames mit App-Ursprung an und prüft Argumente.
  `shell.openExternal` öffnet nur Schemas aus der Konfig (`claude:`).
- Der Server lauscht nur auf `127.0.0.1`; eine zweite App-Instanz startet nicht
  (Einzelinstanz), damit sie nicht um den Port kämpft.
- Der Claude-Code-Befehl mit Token geht aus der Hülle direkt in die
  Zwischenablage und wird nicht an die Seite zurückgegeben.

## „Plan with Claude"

1. Frontend → Ansicht **Plan**: Skill-Idee und Vorlieben → `POST /api/runs`
   (Formular ist minimal; die volle Eingabe folgt mit F-05).
2. Knopf **Plan with Claude**: Die Hülle holt einen Sitzungscode vom Server,
   legt den Startsatz in die Zwischenablage und öffnet Claude Desktop
   (`desktopUrl` in der Konfig). Klappt das Öffnen nicht, steht das im Fenster;
   der Satz liegt trotzdem in der Zwischenablage.
3. **Install Claude extension** öffnet die mitgelieferte `astrolabe.mcpb`,
   **Copy Claude Code command** kopiert `claude mcp add …`.
4. Der Live-Status kommt aus dem Event-Stream des Laufs (SSE) und zeigt Phase,
   aktuelle Aufgabe, zurückgeschickte Antworten, Rechnungen, Fragen.

**Ungeprüft:** ob Claude Desktop unter Windows den Link `claude://` annimmt, ist
nicht gegen eine Installation getestet (hier gibt es kein Windows). Der Link
steht in der Konfig und lässt sich ändern.

## Entwickeln und Bauen

```bash
pnpm --filter @astrolabe/web build && pnpm --filter @astrolabe/desktop dev
```

`dev` baut die Hülle und startet Electron. Ohne Daten-Release endet der
Serverstart mit einer klaren Meldung im Fenster; dann
`ASTROLABE_DATA_RELEASE=<Ordner mit manifest.json>` setzen (z. B.
`data-snapshots/current/catalog` aus der Daten-Pipeline).

Installer (Windows):

```bash
pnpm build
pnpm --filter @astrolabe/mcp-bridge pack:mcpb
cp -r <Daten-Release> apps/desktop/data-release
pnpm --filter @astrolabe/desktop dist     # → apps/desktop/release/Astrolabe-Setup-<version>.exe
```

`scripts/stage.mjs` bricht mit einer Anleitung ab, wenn etwas fehlt (Frontend,
`.mcpb`, Daten-Release). In CI baut `.github/workflows/desktop.yml` das
automatisch: bei PRs als Artefakt zum Ausprobieren, per „Run workflow" mit
`publish` als GitHub-Release.

## Auto-Update

`electron-updater` prüft GitHub Releases (15 s nach dem Start, dann alle 6 h,
einstellbar), lädt im Hintergrund und installiert nur per Knopf
„Update … restart" in der Kopfzeile. Fehler erscheinen als Status, nie still.
Für ein Release: Version in `apps/desktop/package.json` erhöhen, dann den
Workflow mit `publish` starten.

## Windows-Warnung (keine Signatur)

Der Installer ist **nicht signiert**. Beim ersten Start zeigt Windows
SmartScreen „Der Computer wurde durch Windows geschützt": **Weitere
Informationen → Trotzdem ausführen**. Das gilt für jeden neuen Installer, bis
er genug Verbreitung hat oder signiert wird. Updates prüft `electron-updater`
über den Hash in `latest.yml` aus demselben GitHub-Release; ohne Signatur
schützt das nicht gegen ein manipuliertes Release-Konto. Eine Signatur
(Zertifikat, Azure Trusted Signing) ist ein eigener Schritt.

## Offen

- **PoB-Rechendienst**: Der Server nutzt noch `calc-fake`; die App zeigt das
  („PoB offline", Hinweis im Plan-Dialog). Sobald der Calc-Adapter fertig ist,
  gehören LuaJIT und PoB für Windows als `extraResources` in den Installer
  (`tools/build_windows_luajit.sh`, `apps/calc`).
- **Daten-Releases nachladen** (ADR-0004 Punkt 5): Die App findet heruntergeladene
  Releases schon (`<userData>/data-releases/`), der Download selbst fehlt noch.
- Windows-Verhalten (Installer, SmartScreen, Update, `claude://`) ist hier nur
  durch den CI-Build gedeckt, nicht durch einen Lauf auf einem Windows-PC.

## Neue Patches: Daten-Releases (F-01)

Ein neuer Spielpatch ist ein Daten-Release, kein App-Update. Die App prüft stündlich
(`dataSync` in `config/desktop/desktop.json`: Repo, Pre-Releases, Takt, Hosts, Größengrenzen), lädt ein neueres
Release, prüft Prüfsumme, Manifest und Shard-Hashes und legt es atomar ab. Der Server liest den Katalog beim
Start; das Fenster zeigt „New game data … restart“, der Knopf startet die App neu. Beim Start gewinnt das neueste
Release aus Downloads und mitgeliefertem Release (nach Spielversion und Revision). Fehler stehen als „Game data check
failed“ im Fenster und im Log; nichts wird still übersprungen. Derselbe Ordner ist `releasesDir` des Servers, aus dem
`guide_revalidate` die Release-Kette liest.
