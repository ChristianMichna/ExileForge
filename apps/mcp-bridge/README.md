# @astrolabe/mcp-bridge

Claude-Desktop-Erweiterung (`.mcpb`) für Astrolabe (ADR-0004): eine **dünne
stdio↔HTTP-Brücke** zum MCP-Endpunkt der laufenden App auf
`http://127.0.0.1:<port>/mcp`. Keine Werkzeuglogik, keine eigenen Daten; alle
Werkzeuge, Prompts und Prüfungen kommen aus `apps/server`.

- **Nur 127.0.0.1**: einstellbar ist nur der Port (`user_config.port` →
  `ASTROLABE_PORT`, Standard 47615), nie der Host.
- **Zugriffstoken**: liest bei jeder Anfrage das Token der App
  (`%APPDATA%\Astrolabe\access-token`, sonst `~/.config/astrolabe/access-token`,
  überschreibbar mit `ASTROLABE_TOKEN_FILE`) und sendet es als
  `Authorization: Bearer`. So funktioniert die Brücke auch, wenn die App erst
  nach Claude Desktop startet.
- **Klare Fehler statt Hängen**, je nach Ursache: keine Verbindung oder keine
  Token-Datei → „app is not running … Start Astrolabe"; HTTP 401/403 →
  „refused the access token … Reconnect Claude from the Astrolabe app";
  beschädigte Token-Datei → „token … is damaged"; sonst eine allgemeine
  App-Fehlermeldung. Keine Pfade oder Stacktraces an Claude.
- **Beim Freund ohne Entwicklerwerkzeuge**: Das Paket enthält eine gebündelte
  Datei (`server/index.js`, esbuild) und nutzt das in Claude Desktop
  eingebaute Node. Installation per Doppelklick auf `astrolabe.mcpb`.
- Diagnose nur auf stderr (MCP-Log von Claude Desktop), stdout gehört dem
  Protokoll.

## Bauen

```bash
pnpm --filter @astrolabe/mcp-bridge pack:mcpb   # → apps/mcp-bridge/dist/astrolabe.mcpb
```

`manifest.json` folgt dem MCPB-Manifest v0.3 und wird beim Packen mit
`mcpb validate` geprüft. Die Werkzeugliste im Manifest ist nur Anzeige in
Claude Desktop; maßgeblich ist, was der Server bei `tools/list` meldet.

## Tests

`pnpm --filter @astrolabe/mcp-bridge test`: Weiterleitung in beide
Richtungen (In-Memory gegen einen Fake-MCP-Server), echte HTTP-Strecke gegen
einen `node:http`-Fake (Token- und Host-Header, 401, 500, fehlende
Token-Datei), keine laufende App, Port-Prüfung (nur Ziffern, 1024–65535 wie im
Manifest), beschädigte Token-Datei. Ende zu Ende (manuell,
verbraucht Abo-Kontingent): `.mcpb` in Claude Desktop installieren, App
starten, Sitzung mit dem Code aus der App beginnen.

## Offen

- Lizenz im Manifest ist `UNLICENSED`, bis die Lizenz für Astrolabe
  entschieden ist (offene Frage in `docs/architecture.md`). Die Lizenztexte
  der gebündelten Abhängigkeiten liegen als `server/index.js.LEGAL.txt` im
  Paket.
- Werkzeugliste und Prompt-Text im Manifest sind Anzeige-Kopien des Servers;
  ein Abgleich-Test kommt mit `apps/desktop`, das beide Pakete kennt.

- Signieren des Pakets (`mcpb sign`) und Auslieferung mit dem Installer
  (`apps/desktop`, Knopf „Mit Claude verbinden").
- Symbol (`icon`) im Stil des Design-Systems, ohne offizielle Spielgrafiken.
